import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CharacterProfile, UserProfile, Message, SocialPost, GalleryImage, Anniversary, AppID } from '../../types';
import { DB } from '../../utils/db';
import { safeResponseJson, extractContent } from '../../utils/safeApi';
import { INSTALLED_APPS, DOCK_APPS } from '../../constants';
import { useOS } from '../../context/OSContext';
import AppIcon from '../os/AppIcon';

/**
 * 角色查用户手机（反向查手机）。
 *
 * 会话设置「允许 char 看手机」开启时，角色会在聊天间隙主动拿走用户的手机翻看：
 * 界面变成用户的桌面，由 AI 生成的"浏览脚本"驱动角色一步步点开 App（仿真人查
 * 手机/桌面远程画面），每一步左下角弹出角色此刻的想法框。在聊天 App 里角色能看到
 * 真实的消息列表与对话记录，并可按人设决定：代替用户回复 / 拉黑 / 删好友 / 无视。
 *
 * 用户可点右上角申请退出，但必须 征得对方同意 / 回答角色出的三个问题 / 强制退出
 * 才能解除。全程行为合成一条 system 消息进入上下文，结束后由宿主触发角色主动发消息。
 *
 * 注：脚本里的「删好友」出于数据安全实际执行的是拉黑（聊天记录与角色不真删），
 * 在记录里如实标注，角色行为语义不变。
 */

type StepApp = 'home' | 'chat-list' | 'chat-thread' | 'moments' | 'schedule' | 'gallery' | 'music';

interface ScriptAction {
    type: 'none' | 'reply' | 'block' | 'delete' | 'ignore';
    content?: string;
}

interface ScriptStep {
    app: StepApp;
    targetName?: string;
    thought: string;
    action?: ScriptAction;
}

interface CheckScript {
    steps: ScriptStep[];
    exitQuestions: string[];
    endHint?: string;
}

interface ContactSnap {
    char: CharacterProfile;
    preview: string;
    lastAt: number;
}

interface CharPhoneCheckOverlayProps {
    char: CharacterProfile;            // 正在查手机的角色
    userProfile: UserProfile;
    characters: CharacterProfile[];    // 全部联系人（含 char 自己）
    apiConfig: { baseUrl: string; apiKey: string; model: string };
    updateCharacter: (id: string, updates: Partial<CharacterProfile>) => Promise<void> | void;
    addToast: (msg: string, type: 'info' | 'success' | 'error') => void;
    /** 结束（记录已落库）。exitMode 用于宿主提示文案 */
    onEnd: (exitMode: 'consent' | 'questions' | 'forced' | 'finished') => void;
}

const STEP_MS = 6500;            // 每一步停留时长（想法框阅读时间）
const TAP_MS = 950;              // 「点开 App」动画时长：先回桌面按图标，再进入页面
// 浏览步骤 → 桌面图标（点开动画里高亮哪个图标）
const STEP_ICON: Record<Exclude<StepApp, 'home'>, string> = {
    'chat-list': 'Chat',
    'chat-thread': 'Chat',
    'moments': 'Social',
    'schedule': 'Schedule',
    'gallery': 'Gallery',
    'music': 'Music',
};

// 与 Launcher 同源的桌面布局持久化 key：角色看到的就是用户真实排列的桌面
const DESK_ORDER_KEY = 'moro_desktop_items_v1';
const LEGACY_APP_ORDER_KEY = 'moro_launcher_app_order';

/** 按用户真实桌面顺序排出全部非 dock App（与 Launcher 的 deskOrder/legacy 迁移一致） */
const loadUserDeskApps = () => {
    const base = INSTALLED_APPS.filter(a => !DOCK_APPS.includes(a.id) && a.id !== AppID.CharCreatorDev);
    let orderedIds: string[] = [];
    try {
        const deskRaw = JSON.parse(localStorage.getItem(DESK_ORDER_KEY) || '[]');
        if (Array.isArray(deskRaw)) {
            orderedIds = deskRaw
                .filter((k): k is string => typeof k === 'string' && k.startsWith('app:'))
                .map(k => k.slice(4));
        }
    } catch { /* 布局读取失败时退回默认顺序 */ }
    if (orderedIds.length === 0) {
        try {
            const legacyRaw = JSON.parse(localStorage.getItem(LEGACY_APP_ORDER_KEY) || '[]');
            if (Array.isArray(legacyRaw)) orderedIds = legacyRaw.filter((k): k is string => typeof k === 'string');
        } catch { /* ignore */ }
    }
    const ordered: typeof INSTALLED_APPS = [];
    for (const id of orderedIds) {
        const app = base.find(a => a.id === id);
        if (app && !ordered.includes(app)) ordered.push(app);
    }
    for (const app of base) {
        if (!ordered.includes(app)) ordered.push(app);
    }
    return ordered;
};

/** 壁纸值 → CSS background（与 PhoneShell 的处理一致：链接/dataURL 包 url()，渐变原样用） */
const wallpaperBackground = (wallpaper?: string): React.CSSProperties => {
    if (!wallpaper) return { background: 'linear-gradient(160deg, #6d83b2 0%, #a4b0c8 55%, #d8c8b8 100%)' };
    const isImage = wallpaper.startsWith('http') || wallpaper.startsWith('data:') || wallpaper.startsWith('blob:');
    return isImage
        ? { backgroundImage: `url(${wallpaper})`, backgroundSize: 'cover', backgroundPosition: 'center' }
        : { background: wallpaper };
};

const safeParseScript = (raw: string): CheckScript | null => {
    const clean = (raw || '').replace(/```json/gi, '').replace(/```/g, '').trim();
    const tryParse = (s: string) => { try { return JSON.parse(s); } catch { return null; } };
    let obj = tryParse(clean);
    if (!obj) {
        const start = clean.indexOf('{');
        const end = clean.lastIndexOf('}');
        if (start >= 0 && end > start) obj = tryParse(clean.slice(start, end + 1));
    }
    if (!obj || !Array.isArray(obj.steps) || obj.steps.length === 0) return null;
    const steps: ScriptStep[] = obj.steps
        .filter((s: any) => s && typeof s.thought === 'string')
        .map((s: any) => ({
            app: (['home', 'chat-list', 'chat-thread', 'moments', 'schedule', 'gallery', 'music'].includes(s.app) ? s.app : 'home') as StepApp,
            targetName: typeof s.targetName === 'string' ? s.targetName : undefined,
            thought: String(s.thought).slice(0, 300),
            action: s.action && typeof s.action === 'object'
                ? {
                    type: (['none', 'reply', 'block', 'delete', 'ignore'].includes(s.action.type) ? s.action.type : 'none') as ScriptAction['type'],
                    content: typeof s.action.content === 'string' ? s.action.content.slice(0, 300) : undefined,
                }
                : undefined,
        }));
    const exitQuestions = (Array.isArray(obj.exitQuestions) ? obj.exitQuestions : [])
        .filter((q: any) => typeof q === 'string' && q.trim())
        .slice(0, 3);
    while (exitQuestions.length < 3) exitQuestions.push('你刚才有什么瞒着我的事吗？');
    return { steps: steps.slice(0, 8), exitQuestions, endHint: typeof obj.endHint === 'string' ? obj.endHint : undefined };
};

const CharPhoneCheckOverlay: React.FC<CharPhoneCheckOverlayProps> = ({
    char, userProfile, characters, apiConfig, updateCharacter, addToast, onEnd,
}) => {
    // 角色看到的是用户**实时真实**的桌面：真壁纸 + 真实安装的全部 App + 真实 dock
    const { theme } = useOS();
    const deskApps = useMemo(loadUserDeskApps, []);
    const dockApps = useMemo(
        () => DOCK_APPS.map(id => INSTALLED_APPS.find(a => a.id === id)).filter((a): a is typeof INSTALLED_APPS[number] => !!a),
        []
    );
    const [phase, setPhase] = useState<'loading' | 'browsing' | 'finished'>('loading');
    const [script, setScript] = useState<CheckScript | null>(null);
    const [stepIdx, setStepIdx] = useState(0);
    const [contacts, setContacts] = useState<ContactSnap[]>([]);
    const [threadMsgs, setThreadMsgs] = useState<Message[]>([]);
    const [actionLog, setActionLog] = useState<string[]>([]);
    // 手机里的真实数据快照（朋友圈 / 相册 / 纪念日）——角色翻到对应页面时展示
    const [moments, setMoments] = useState<SocialPost[]>([]);
    const [galleryImgs, setGalleryImgs] = useState<GalleryImage[]>([]);
    const [annivs, setAnnivs] = useState<Anniversary[]>([]);
    // 「点开 App」动画：非 null 时画面回到桌面、高亮目标图标（仿真人逐个点开）
    const [opening, setOpening] = useState<StepApp | null>(null);
    // 退出闸门
    const [exitOpen, setExitOpen] = useState(false);
    const [exitTab, setExitTab] = useState<'menu' | 'consent' | 'questions'>('menu');
    const [exitBusy, setExitBusy] = useState(false);
    const [consentReply, setConsentReply] = useState('');
    const [answers, setAnswers] = useState<string[]>(['', '', '']);
    const [judgeComment, setJudgeComment] = useState('');
    const endedRef = useRef(false);
    const appliedStepsRef = useRef<Set<number>>(new Set());
    const actionLogRef = useRef<string[]>([]);
    actionLogRef.current = actionLog;

    const llm = async (prompt: string, temperature = 0.9): Promise<string> => {
        const res = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
            body: JSON.stringify({ model: apiConfig.model, messages: [{ role: 'user', content: prompt }], temperature }),
        });
        if (!res.ok) throw new Error(`API ${res.status}`);
        return (extractContent(await safeResponseJson(res)) || '').trim();
    };

    const personaBlock = useMemo(() => [
        `名字: ${char.name}`,
        char.description ? `备注: ${String(char.description).slice(0, 200)}` : '',
        char.systemPrompt ? `人设: ${String(char.systemPrompt).slice(0, 1500)}` : '',
    ].filter(Boolean).join('\n'), [char]);

    // ── 启动：取联系人快照 + 生成浏览脚本 ──
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const snaps: ContactSnap[] = [];
                for (const c of characters) {
                    try {
                        const recent = await DB.getRecentMessagesByCharId(c.id, 3);
                        const lastVisible = [...recent].reverse().find(m => m.role !== 'system');
                        snaps.push({
                            char: c,
                            preview: lastVisible ? String(lastVisible.content || '').slice(0, 60) : '（暂无消息）',
                            lastAt: lastVisible?.timestamp || 0,
                        });
                    } catch {
                        snaps.push({ char: c, preview: '（暂无消息）', lastAt: 0 });
                    }
                }
                snaps.sort((a, b) => b.lastAt - a.lastAt);
                if (cancelled) return;
                setContacts(snaps);

                // 最近活跃的几个对话给角色"翻记录"的素材
                const excerptTargets = snaps.filter(s => s.lastAt > 0).slice(0, 4);
                const excerpts: string[] = [];
                for (const t of excerptTargets) {
                    try {
                        const msgs = await DB.getRecentMessagesByCharId(t.char.id, 12);
                        const lines = msgs
                            .filter(m => m.role !== 'system' && typeof m.content === 'string')
                            .map(m => `${m.role === 'user' ? userProfile.name : t.char.name}: ${String(m.content).slice(0, 80)}`)
                            .join('\n');
                        if (lines) excerpts.push(`【与「${t.char.name}」的最近对话】\n${lines}`);
                    } catch { /* 单个对话取不到不阻塞 */ }
                }
                if (cancelled) return;

                // 朋友圈 / 相册 / 纪念日真实快照：页面展示 + 喂给脚本生成（想法贴真实内容）
                let momentsSnap: SocialPost[] = [];
                let gallerySnap: GalleryImage[] = [];
                let annivSnap: Anniversary[] = [];
                try {
                    momentsSnap = (await DB.getSocialPosts())
                        .filter(p => p.visibility !== 'private')
                        .sort((a, b) => b.timestamp - a.timestamp)
                        .slice(0, 6);
                } catch { /* 取不到不阻塞 */ }
                try {
                    gallerySnap = (await DB.getGalleryImages())
                        .sort((a, b) => b.timestamp - a.timestamp)
                        .slice(0, 9);
                } catch { /* ignore */ }
                try {
                    annivSnap = (await DB.getAllAnniversaries()).slice(0, 8);
                } catch { /* ignore */ }
                if (cancelled) return;
                setMoments(momentsSnap);
                setGalleryImgs(gallerySnap);
                setAnnivs(annivSnap);

                const momentsBrief = momentsSnap
                    .map(p => `- ${p.authorName}：「${String(p.content || p.title || '').slice(0, 60)}」${p.images?.length ? `（配图${p.images.length}张）` : ''}`)
                    .join('\n');
                const annivBrief = annivSnap
                    .map(a => `- ${a.date} ${a.title}`)
                    .join('\n');

                const prompt = `### 任务
你在扮演角色「${char.name}」。此刻 TA 拿到了 ${userProfile.name}（TA 的聊天对象/亲密的人）的手机，正在翻看。请按 TA 的人设生成一份"查手机浏览脚本"。

### 你的人设
${personaBlock}

### ${userProfile.name} 手机里的聊天列表（按最近活跃排序）
${snaps.map(s => `- ${s.char.name}${s.char.id === char.id ? '（这是你自己和TA的对话）' : ''}：最后一条「${s.preview}」`).join('\n')}

### 可翻看的对话记录节选
${excerpts.join('\n\n') || '（手机里几乎没有聊天记录）'}

### 朋友圈最近的动态
${momentsBrief || '（朋友圈没什么动态）'}

### 日程里记着的纪念日
${annivBrief || '（日程是空的）'}

### 相册
${gallerySnap.length > 0 ? `最近存了 ${gallerySnap.length} 张照片/聊天图` : '（相册几乎是空的）'}

### 要求
生成 4~7 步浏览动作。第一步必须是 "home"（刚拿到手机看桌面）。可用的 app：
- "home" 桌面 / "chat-list" 聊天列表 / "chat-thread" 点开某人的对话（targetName 填上面列表里的名字）/ "moments" 朋友圈 / "schedule" 日程 / "gallery" 相册 / "music" 音乐
每一步都要有 thought：${char.name} 看到当前页面时的真实想法（第一人称，30~80字，完全贴合人设——可以吃醋、好奇、欣慰、酸溜溜、占有欲，看到自己的对话框也会有感想）。
翻到 moments / schedule / gallery 时，想法要针对上面给出的真实朋友圈动态、纪念日、相册情况来写，不要凭空编造内容。
chat-thread 步骤可以带 action：
- {"type":"reply","content":"…"} 代替 ${userProfile.name} 回复对方（content 是以 ${userProfile.name} 口吻发出的内容）
- {"type":"block"} 把这个联系人拉黑
- {"type":"delete"} 删掉这个好友
- {"type":"ignore"} 看完冷哼一声不动
是否做这些动作、做哪种，严格按人设性格来：温柔的角色多半只看不动，占有欲强/醋劲大的角色才会下手。不要为了戏剧性乱拉黑。
另外生成 exitQuestions：3 个问题。${userProfile.name} 想中途拿回手机时，${char.name} 会要求 TA 先回答这 3 个问题（按人设出题：可以是审问、撒娇、试探）。
endHint：一句话，描述 ${char.name} 翻完手机后的整体心情（用于之后 TA 主动发消息的语气基调）。

### 输出
只输出一个 JSON 对象，不要任何其它文字：
{"steps":[{"app":"home","thought":"…"},{"app":"chat-thread","targetName":"…","thought":"…","action":{"type":"reply","content":"…"}}],"exitQuestions":["…","…","…"],"endHint":"…"}`;

                const raw = await llm(prompt);
                if (cancelled) return;
                const parsed = safeParseScript(raw);
                if (!parsed) throw new Error('浏览脚本解析失败');
                setScript(parsed);
                setPhase('browsing');
            } catch (e: any) {
                if (cancelled) return;
                addToast(`查手机启动失败：${e?.message || e}`, 'error');
                onEnd('forced');
            }
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const currentStep = script?.steps[stepIdx] || null;
    const targetChar = useMemo(() => {
        if (!currentStep?.targetName) return null;
        return characters.find(c => c.name === currentStep.targetName)
            || characters.find(c => currentStep.targetName && c.name.includes(currentStep.targetName))
            || null;
    }, [currentStep, characters]);

    // chat-thread 步骤：拉真实对话记录展示
    useEffect(() => {
        if (!currentStep || currentStep.app !== 'chat-thread' || !targetChar) { setThreadMsgs([]); return; }
        let cancelled = false;
        DB.getRecentMessagesByCharId(targetChar.id, 40)
            .then(msgs => { if (!cancelled) setThreadMsgs(msgs.filter(m => m.role !== 'system')); })
            .catch(() => { if (!cancelled) setThreadMsgs([]); });
        return () => { cancelled = true; };
    }, [stepIdx, currentStep, targetChar]);

    // 执行当前步骤的副作用动作（每步只执行一次）
    useEffect(() => {
        if (phase !== 'browsing' || !currentStep?.action || appliedStepsRef.current.has(stepIdx)) return;
        appliedStepsRef.current.add(stepIdx);
        const act = currentStep.action;
        const target = targetChar;
        const log = (line: string) => setActionLog(prev => [...prev, line]);
        (async () => {
            try {
                if (act.type === 'reply' && target && act.content) {
                    await DB.saveMessage({
                        charId: target.id,
                        role: 'user',
                        type: 'text',
                        content: act.content,
                        metadata: { sentByCharPhoneCheck: char.id, sentByCharPhoneCheckName: char.name },
                    } as any);
                    log(`在与「${target.name}」的对话里，以${userProfile.name}的名义回复了：「${act.content}」`);
                } else if ((act.type === 'block' || act.type === 'delete') && target && target.id !== char.id) {
                    await updateCharacter(target.id, { blacklisted: true, blacklistedAt: Date.now() });
                    log(act.type === 'block'
                        ? `把「${target.name}」拉黑了`
                        : `想把「${target.name}」删掉，最终把对方加入了黑名单（删好友按拉黑执行）`);
                } else if (act.type === 'ignore' && target) {
                    log(`看完了与「${target.name}」的对话，什么都没做`);
                }
            } catch (e) {
                console.warn('[CharPhoneCheck] 执行动作失败:', e);
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [stepIdx, phase, currentStep]);

    // 「点开 App」动画：每步开始时先回到桌面、高亮目标图标 TAP_MS 后再进入页面，
    // 仿照真人查手机（参考桌面远程画面）逐个点开 App 的节奏
    useEffect(() => {
        if (phase !== 'browsing' || !currentStep || currentStep.app === 'home') { setOpening(null); return; }
        // 连续两步都在聊天 App 内（chat-list → chat-thread）不回桌面，直接页内切换
        const prevStep = stepIdx > 0 ? script?.steps[stepIdx - 1] : null;
        const sameAppFamily = prevStep && STEP_ICON[prevStep.app as Exclude<StepApp, 'home'>] === STEP_ICON[currentStep.app as Exclude<StepApp, 'home'>];
        if (sameAppFamily) { setOpening(null); return; }
        setOpening(currentStep.app);
        const t = setTimeout(() => setOpening(null), TAP_MS);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [phase, stepIdx]);

    // 自动推进
    useEffect(() => {
        if (phase !== 'browsing' || !script || exitOpen) return;
        const timer = setTimeout(() => {
            if (stepIdx < script.steps.length - 1) setStepIdx(i => i + 1);
            else setPhase('finished');
        }, STEP_MS);
        return () => clearTimeout(timer);
    }, [phase, stepIdx, script, exitOpen]);

    // ── 结束：合成记录落库 → 通知宿主 ──
    const finish = async (exitMode: 'consent' | 'questions' | 'forced' | 'finished', extra?: string) => {
        if (endedRef.current) return;
        endedRef.current = true;
        try {
            const browsed = (script?.steps || []).slice(0, Math.min(stepIdx + 1, script?.steps.length || 0))
                .map((s, i) => {
                    const where = s.app === 'chat-thread' && s.targetName ? `点开了与「${s.targetName}」的对话` :
                        s.app === 'chat-list' ? '看了聊天列表' :
                        s.app === 'moments' ? '翻了朋友圈' :
                        s.app === 'schedule' ? '看了日程' :
                        s.app === 'gallery' ? '翻了相册' :
                        s.app === 'music' ? '看了在听的歌' : '看了桌面';
                    return `${i + 1}. ${where}，心想：${s.thought}`;
                }).join('\n');
            const exitDesc = exitMode === 'finished' ? `${char.name} 自己翻完了，把手机还了回去。`
                : exitMode === 'consent' ? `${userProfile.name} 开口请求拿回手机，${char.name} 同意了。`
                : exitMode === 'questions' ? `${userProfile.name} 回答了 ${char.name} 出的三个问题，通过后拿回了手机。`
                : `${userProfile.name} 强行抢回了手机。`;
            const ops = actionLogRef.current.length ? `\n${char.name} 翻手机期间做的事：\n${actionLogRef.current.map(l => `- ${l}`).join('\n')}` : '';
            await DB.saveMessage({
                charId: char.id,
                role: 'system',
                type: 'text',
                content: `[查手机记录] 刚才 ${char.name} 拿走了 ${userProfile.name} 的手机翻看。\n${char.name} 的浏览过程与内心想法：\n${browsed || '（刚拿到就被打断了）'}${ops}\n${exitDesc}${extra ? `\n${extra}` : ''}${script?.endHint ? `\n${char.name} 此刻的心情基调：${script.endHint}` : ''}\n（这段经历你们双方都知情，接下来请 ${char.name} 主动就刚才看到的内容发消息。）`,
                metadata: { charPhoneCheck: true },
            } as any);
        } catch (e) {
            console.warn('[CharPhoneCheck] 记录落库失败:', e);
        }
        onEnd(exitMode);
    };

    // 翻完自动收尾
    useEffect(() => {
        if (phase === 'finished') {
            const t = setTimeout(() => { void finish('finished'); }, 2200);
            return () => clearTimeout(t);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [phase]);

    // ── 退出闸门 ──
    const askConsent = async () => {
        setExitBusy(true);
        setConsentReply('');
        try {
            const raw = await llm(`你在扮演「${char.name}」（人设如下），正翻看 ${userProfile.name} 的手机看到一半，${userProfile.name} 开口想拿回手机。
${personaBlock}
你翻到现在的想法：${(script?.steps || []).slice(0, stepIdx + 1).map(s => s.thought).join('；')}
按人设决定是否把手机还给TA。只输出 JSON：{"allow": true或false, "reply": "你对TA说的一句话（贴人设，30字内）"}`);
            const clean = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
            let obj: any = null;
            try { obj = JSON.parse(clean); } catch {
                const s = clean.indexOf('{'); const e = clean.lastIndexOf('}');
                if (s >= 0 && e > s) { try { obj = JSON.parse(clean.slice(s, e + 1)); } catch { /* ignore */ } }
            }
            const allow = !!obj?.allow;
            const reply = typeof obj?.reply === 'string' ? obj.reply : (allow ? '……好吧，还你。' : '不行，我还没看完。');
            setConsentReply(reply);
            if (allow) {
                setTimeout(() => { void finish('consent', `${char.name} 还手机时说：「${reply}」`); }, 1600);
            }
        } catch (e: any) {
            addToast(`请求失败：${e?.message || e}`, 'error');
        } finally {
            setExitBusy(false);
        }
    };

    const submitAnswers = async () => {
        if (answers.some(a => !a.trim())) { addToast('三个问题都要回答', 'info'); return; }
        setExitBusy(true);
        setJudgeComment('');
        try {
            const qs = script?.exitQuestions || [];
            const raw = await llm(`你在扮演「${char.name}」（人设如下），正翻看 ${userProfile.name} 的手机。TA 想拿回手机，你要求TA先回答你出的三个问题。现在TA答完了，按人设判断这些回答是否让你满意、愿意还手机。
${personaBlock}
${qs.map((q, i) => `问题${i + 1}：${q}\nTA的回答：${answers[i]}`).join('\n')}
只输出 JSON：{"pass": true或false, "comment": "你听完回答后对TA说的一句话（贴人设，40字内）"}`);
            const clean = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
            let obj: any = null;
            try { obj = JSON.parse(clean); } catch {
                const s = clean.indexOf('{'); const e = clean.lastIndexOf('}');
                if (s >= 0 && e > s) { try { obj = JSON.parse(clean.slice(s, e + 1)); } catch { /* ignore */ } }
            }
            const pass = !!obj?.pass;
            const comment = typeof obj?.comment === 'string' ? obj.comment : (pass ? '算你过关。' : '这答案我可不信。');
            setJudgeComment(comment);
            if (pass) {
                const qa = qs.map((q, i) => `问：${q} 答：${answers[i]}`).join('；');
                setTimeout(() => { void finish('questions', `问答内容：${qa}\n${char.name} 听完说：「${comment}」`); }, 1600);
            }
        } catch (e: any) {
            addToast(`提交失败：${e?.message || e}`, 'error');
        } finally {
            setExitBusy(false);
        }
    };

    // ── 各页面渲染 ──
    const renderScreen = () => {
        // 点开动画期间强制回到桌面（高亮目标图标）
        const app = phase === 'finished' ? 'home' : (opening ? 'home' : (currentStep?.app || 'home'));
        if (app === 'chat-list') {
            return (
                <div className="flex-1 overflow-hidden flex flex-col">
                    <div className="px-5 py-3 text-[15px] font-bold text-slate-800 border-b border-slate-100 bg-white/90">絮语</div>
                    <div className="flex-1 overflow-y-auto no-scrollbar bg-white/80">
                        {contacts.map(({ char: c, preview }) => (
                            <div key={c.id} className={`px-4 py-3 flex items-center gap-3 border-b border-slate-50 ${targetChar?.id === c.id ? 'bg-amber-50' : ''}`}>
                                <img src={c.avatar} className="w-11 h-11 rounded-lg object-cover shrink-0" alt="" />
                                <div className="flex-1 min-w-0">
                                    <div className="text-[14px] font-medium text-slate-800 truncate">{c.name}</div>
                                    <div className="text-[12px] text-slate-400 truncate">{preview}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            );
        }
        if (app === 'chat-thread' && targetChar) {
            return (
                <div className="flex-1 overflow-hidden flex flex-col">
                    <div className="px-5 py-3 text-[15px] font-bold text-slate-800 border-b border-slate-100 bg-white/90 flex items-center gap-2">
                        <img src={targetChar.avatar} className="w-6 h-6 rounded-md object-cover" alt="" />
                        {targetChar.name}
                    </div>
                    <div className="flex-1 overflow-y-auto no-scrollbar bg-[#f3f3f3] px-3 py-3 space-y-2">
                        {threadMsgs.length === 0 && <div className="text-center text-xs text-slate-400 pt-8">（没有聊天记录）</div>}
                        {threadMsgs.map(m => (
                            <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-[75%] px-3 py-2 rounded-xl text-[12px] leading-relaxed whitespace-pre-wrap break-words ${m.role === 'user' ? 'bg-[#95ec69] text-slate-800' : 'bg-white text-slate-700'}`}>
                                    {m.type === 'image' ? '[图片]' : m.type === 'emoji' ? '[表情]' : m.type === 'voice' ? '[语音]' : String(m.content || '').slice(0, 200)}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            );
        }
        if (app === 'moments') {
            return (
                <div className="flex-1 overflow-hidden flex flex-col">
                    <div className="px-5 py-3 text-[15px] font-bold text-slate-800 border-b border-slate-100 bg-white/90">朋友圈</div>
                    <div className="flex-1 overflow-y-auto no-scrollbar bg-white/80 px-4 py-3 space-y-4">
                        {moments.length === 0 && <div className="text-center text-xs text-slate-400 pt-10">（朋友圈空空如也）</div>}
                        {moments.map(p => (
                            <div key={p.id} className="border-b border-slate-50 pb-3">
                                <div className="flex items-center gap-2 mb-1.5">
                                    {p.authorAvatar
                                        ? <img src={p.authorAvatar} className="w-8 h-8 rounded-lg object-cover shrink-0" alt="" />
                                        : <div className="w-8 h-8 rounded-lg bg-slate-200 shrink-0" />}
                                    <span className="text-[13px] font-bold text-slate-700">{p.authorName}</span>
                                </div>
                                <div className="text-[12px] text-slate-600 leading-relaxed line-clamp-3 whitespace-pre-wrap">{p.content || p.title}</div>
                                {(p.images?.length || 0) > 0 && (
                                    <div className="flex gap-1.5 mt-2">
                                        {p.images.slice(0, 3).map((img, i) => (
                                            <img key={i} src={img} className="w-16 h-16 rounded-lg object-cover" alt="" loading="lazy" />
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            );
        }
        if (app === 'schedule') {
            return (
                <div className="flex-1 overflow-hidden flex flex-col">
                    <div className="px-5 py-3 text-[15px] font-bold text-slate-800 border-b border-slate-100 bg-white/90">日程</div>
                    <div className="flex-1 overflow-y-auto no-scrollbar bg-white/80 px-4 py-3 space-y-2">
                        {annivs.length === 0 && <div className="text-center text-xs text-slate-400 pt-10">（日程上什么都没记）</div>}
                        {annivs.map(a => (
                            <div key={a.id} className="flex items-center gap-3 bg-slate-50 rounded-xl px-3 py-2.5">
                                <div className="text-[11px] font-mono text-cyan-600 shrink-0">{a.date}</div>
                                <div className="text-[13px] text-slate-700 truncate">{a.title}</div>
                            </div>
                        ))}
                    </div>
                </div>
            );
        }
        if (app === 'gallery') {
            return (
                <div className="flex-1 overflow-hidden flex flex-col">
                    <div className="px-5 py-3 text-[15px] font-bold text-slate-800 border-b border-slate-100 bg-white/90">相册</div>
                    <div className="flex-1 overflow-y-auto no-scrollbar bg-white/80 p-2">
                        {galleryImgs.length === 0 && <div className="text-center text-xs text-slate-400 pt-10">（相册里没有照片）</div>}
                        <div className="grid grid-cols-3 gap-1.5">
                            {galleryImgs.map(g => (
                                <img key={g.id} src={g.url} className="w-full aspect-square rounded-lg object-cover" alt="" loading="lazy" />
                            ))}
                        </div>
                    </div>
                </div>
            );
        }
        if (app === 'music') {
            return (
                <div className="flex-1 overflow-hidden flex flex-col">
                    <div className="px-5 py-3 text-[15px] font-bold text-slate-800 border-b border-slate-100 bg-white/90">音乐</div>
                    <div className="flex-1 bg-white/80 flex flex-col items-center justify-center gap-3 text-slate-400">
                        <div className="text-5xl">🎧</div>
                        <div className="text-xs">TA 在看你最近在听什么…</div>
                    </div>
                </div>
            );
        }
        // home / finished / opening：用户实时真实的桌面（真壁纸 + 全部 App + dock；
        // opening 时高亮即将点开的图标）
        const openingIcon = opening && opening !== 'home' ? STEP_ICON[opening as Exclude<StepApp, 'home'>] : null;
        return (
            <div className="flex-1 overflow-hidden flex flex-col relative" style={wallpaperBackground(theme.wallpaper)}>
                <div className="text-white text-sm font-bold pt-5 pb-3 text-center" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.45)' }}>
                    {userProfile.name} 的手机
                </div>
                <div className="flex-1 overflow-y-auto no-scrollbar px-3 pb-2">
                    <div className="grid grid-cols-4 gap-x-1 gap-y-3">
                        {deskApps.map(a => {
                            const isTapped = openingIcon === a.icon;
                            return (
                                <div
                                    key={a.id}
                                    className={`flex justify-center transition-all duration-300 rounded-2xl ${isTapped ? 'scale-90 ring-4 ring-white/70 bg-white/30' : ''}`}
                                >
                                    <AppIcon app={a} onClick={() => { /* 角色在翻手机：禁点 */ }} size="sm" />
                                </div>
                            );
                        })}
                    </div>
                </div>
                {openingIcon && (
                    <div className="text-center text-white text-xs animate-fade-in pb-1" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.45)' }}>
                        {char.name} 点开了「{INSTALLED_APPS.find(a => a.icon === openingIcon)?.name}」…
                    </div>
                )}
                {phase === 'finished' && (
                    <div className="text-center text-white text-sm font-medium animate-fade-in pb-1" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.45)' }}>
                        {char.name} 翻完了，把手机放回了原处…
                    </div>
                )}
                {/* 真实 dock（与桌面同款配置） */}
                <div className="shrink-0 flex justify-center px-4 pb-3">
                    <div className="glass-pill rounded-full px-4 py-2 flex gap-4 items-center max-w-full overflow-x-auto no-scrollbar">
                        {dockApps.map(a => (
                            <AppIcon key={a.id} app={a} onClick={() => { /* 角色在翻手机：禁点 */ }} variant="dock" size="sm" />
                        ))}
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="absolute inset-0 z-[430] flex flex-col overflow-hidden animate-fade-in"
            style={{ background: 'linear-gradient(165deg, #f4f2ed 0%, #eae7e0 55%, #efe7dd 100%)', paddingTop: 'max(8px, var(--safe-top))' }}>
            {/* 顶栏：状态 + 退出申请（奶白手帐风：墨色文字 + 白描边头像） */}
            <div className="shrink-0 px-4 py-2.5 flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                    <img src={char.avatar} className="w-7 h-7 rounded-full object-cover ring-2 ring-white shadow-sm shrink-0" alt="" />
                    <span className="text-xs font-bold text-slate-600 truncate">
                        {phase === 'loading' ? `${char.name} 拿走了你的手机…` : `${char.name} 正在看你的手机`}
                    </span>
                </div>
                {phase !== 'loading' && !endedRef.current && (
                    <button
                        onClick={() => { setExitOpen(true); setExitTab('menu'); setConsentReply(''); setJudgeComment(''); }}
                        className="shrink-0 px-3 py-1.5 rounded-full bg-white text-slate-600 text-[11px] font-bold border border-slate-200 shadow-[0_8px_16px_-10px_rgba(50,48,60,0.4)] active:scale-95 transition-all"
                    >
                        我想拿回手机
                    </button>
                )}
            </div>

            {/* 主屏 */}
            {phase === 'loading' ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-4 text-slate-500">
                    <div className="w-9 h-9 border-4 border-slate-200 border-t-slate-700 rounded-full animate-spin" />
                    <div className="text-xs">{char.name} 拿起了你的手机，解锁了屏幕…</div>
                </div>
            ) : (
                <div className="flex-1 min-h-0 mx-3 mb-3 rounded-3xl overflow-hidden flex flex-col border border-white/70 bg-slate-100/70 backdrop-blur shadow-[0_24px_48px_-20px_rgba(50,48,60,0.4)]">
                    {renderScreen()}
                </div>
            )}

            {/* 左下角想法框 */}
            {phase === 'browsing' && currentStep && (
                <div key={stepIdx} className="absolute left-3 bottom-5 max-w-[78%] z-10 animate-fade-in">
                    <div className="bg-[#0b0b12]/90 backdrop-blur text-white rounded-2xl rounded-bl-md px-4 py-3 shadow-xl border border-white/10">
                        <div className="flex items-center gap-1.5 mb-1">
                            <img src={char.avatar} className="w-4 h-4 rounded-full object-cover" alt="" />
                            <span className="text-[9px] font-bold opacity-60 tracking-wider">{char.name} 的想法</span>
                        </div>
                        <div className="text-[12px] leading-relaxed">{currentStep.thought}</div>
                    </div>
                </div>
            )}

            {/* 退出闸门弹窗 */}
            {exitOpen && (
                <div className="absolute inset-0 z-20 flex items-center justify-center animate-fade-in p-6" style={{ background: 'rgba(20,20,28,0.4)', backdropFilter: 'blur(4px)' }}>
                    <div className="w-full max-w-[320px] bg-white rounded-[1.6rem] overflow-hidden shadow-2xl relative">
                        {/* 右上角书签缎带 */}
                        <div className="absolute top-0 right-6 w-4 h-7 bg-slate-900" style={{ clipPath: 'polygon(0 0, 100% 0, 100% 100%, 50% 70%, 0 100%)' }} />
                        <div className="px-5 pt-5 pb-3 text-center">
                            <div className="text-[15px] font-bold text-slate-800">想拿回手机？</div>
                            <div className="text-[12px] text-slate-500 mt-1.5 leading-relaxed">
                                {char.name} 还没看完。你可以征求 TA 同意、回答 TA 的问题，或者……直接抢回来。
                            </div>
                        </div>

                        {exitTab === 'menu' && (
                            <div className="px-5 pb-5 space-y-2">
                                <button onClick={() => { setExitTab('consent'); void askConsent(); }} disabled={exitBusy}
                                    className="w-full py-2.5 rounded-2xl bg-slate-900 text-white text-[13px] font-bold shadow-lg shadow-slate-200 active:scale-95 transition-all disabled:opacity-50">
                                    好声好气地要回来（征得同意）
                                </button>
                                <button onClick={() => setExitTab('questions')} disabled={exitBusy}
                                    className="w-full py-2.5 rounded-2xl bg-slate-100 text-slate-700 text-[13px] font-bold active:scale-95 transition-all disabled:opacity-50">
                                    回答 TA 的三个问题
                                </button>
                                <button onClick={() => { void finish('forced', `${userProfile.name} 一把抢回了手机，${char.name} 没看完。`); }} disabled={exitBusy}
                                    className="w-full py-2.5 rounded-2xl bg-white text-rose-500 text-[13px] font-bold border border-rose-200 active:scale-95 transition-all disabled:opacity-50">
                                    强制抢回（TA 会记住的）
                                </button>
                                <button onClick={() => setExitOpen(false)}
                                    className="w-full py-2 text-[12px] text-slate-400">算了，让 TA 继续看</button>
                            </div>
                        )}

                        {exitTab === 'consent' && (
                            <div className="px-5 pb-5 space-y-3">
                                {exitBusy ? (
                                    <div className="flex items-center justify-center gap-2 py-4 text-xs text-slate-400">
                                        <div className="w-4 h-4 border-2 border-slate-200 border-t-slate-500 rounded-full animate-spin" />
                                        {char.name} 在考虑…
                                    </div>
                                ) : consentReply ? (
                                    <div className="bg-slate-50 rounded-xl px-4 py-3 text-[13px] text-slate-700 leading-relaxed">
                                        {char.name}：「{consentReply}」
                                    </div>
                                ) : null}
                                {!exitBusy && consentReply && (
                                    <button onClick={() => { setExitTab('menu'); setConsentReply(''); }}
                                        className="w-full py-2 text-[12px] text-slate-400">TA 不同意…换个方式</button>
                                )}
                            </div>
                        )}

                        {exitTab === 'questions' && (
                            <div className="px-5 pb-5 space-y-3">
                                {(script?.exitQuestions || []).map((q, i) => (
                                    <div key={i}>
                                        <div className="text-[12px] font-medium text-slate-600 mb-1">{i + 1}. {q}</div>
                                        <input
                                            value={answers[i]}
                                            onChange={e => setAnswers(prev => prev.map((a, j) => j === i ? e.target.value : a))}
                                            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-[12px] outline-none focus:border-indigo-300"
                                            placeholder="你的回答…"
                                            disabled={exitBusy}
                                        />
                                    </div>
                                ))}
                                {judgeComment && (
                                    <div className="bg-slate-50 rounded-xl px-4 py-3 text-[13px] text-slate-700 leading-relaxed">
                                        {char.name}：「{judgeComment}」
                                    </div>
                                )}
                                <button onClick={() => void submitAnswers()} disabled={exitBusy}
                                    className="w-full py-2.5 rounded-2xl bg-slate-900 text-white text-[13px] font-bold shadow-lg shadow-slate-200 active:scale-95 transition-all disabled:opacity-50">
                                    {exitBusy ? 'TA 在听…' : '交卷'}
                                </button>
                                <button onClick={() => { setExitTab('menu'); setJudgeComment(''); }}
                                    className="w-full py-1.5 text-[12px] text-slate-400">返回</button>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default CharPhoneCheckOverlay;
