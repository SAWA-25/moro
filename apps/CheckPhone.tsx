import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { CharacterProfile, PhoneEvidence, PhoneCustomApp, PhoneProfile, SocialPost } from '../types';
import { ContextBuilder } from '../utils/context';
import Modal from '../components/os/Modal';
import { safeResponseJson } from '../utils/safeApi';
import { resolveAuxApi } from '../utils/auxApi';
import { injectMemoryPalace } from '../utils/memoryPalace/pipeline';
import { buildPhoneCityHint } from '../utils/charCity';
import { evaluatePhoneLockSubmission, isPhoneLocked, sanitizePhoneLockPasscode } from '../utils/phoneLock';
import PhoneLockExitUnlockSheet from '../components/chat/PhoneLockExitUnlockSheet';
import {
    User, Phone, ChatCircleDots, ShoppingBag, Hamburger, CircleNotch, Wrench, Compass, GearSix, Tray, Plus, SignOut,
    NotePencil, Wallet, MusicNotes, ImageSquare, Heartbeat, CalendarBlank, GlobeHemisphereWest, MagicWand, Quotes,
} from '@phosphor-icons/react';

// ── 角色专属手机皮肤：按 char.id 确定性派生一套配色（千人千面，无需联网） ──
interface PhoneTheme { id: string; grad: string; accent: string; text: string; sub: string; tile: string; border: string; dock: string }
const PHONE_PALETTES: PhoneTheme[] = [
    { id: 'dusk',   grad: 'linear-gradient(165deg,#312a52 0%,#1e1830 60%,#15111f 100%)', accent: '#a78bfa', text: '#ece9f8', sub: '#a9a2c9', tile: 'rgba(255,255,255,0.08)', border: 'rgba(255,255,255,0.12)', dock: 'rgba(30,24,48,0.6)' },
    { id: 'sea',    grad: 'linear-gradient(165deg,#173a4a 0%,#102733 60%,#0b1a22 100%)', accent: '#38bdf8', text: '#e3f2f7', sub: '#a3c0cb', tile: 'rgba(255,255,255,0.08)', border: 'rgba(255,255,255,0.12)', dock: 'rgba(16,39,51,0.6)' },
    { id: 'rose',   grad: 'linear-gradient(165deg,#4a2336 0%,#321826 60%,#22111b 100%)', accent: '#fb7185', text: '#f7e6ec', sub: '#caa6b4', tile: 'rgba(255,255,255,0.08)', border: 'rgba(255,255,255,0.12)', dock: 'rgba(50,24,38,0.6)' },
    { id: 'forest', grad: 'linear-gradient(165deg,#1f3a2c 0%,#16291f 60%,#0e1b15 100%)', accent: '#34d399', text: '#e4f3ea', sub: '#a6c4b3', tile: 'rgba(255,255,255,0.08)', border: 'rgba(255,255,255,0.12)', dock: 'rgba(22,41,31,0.6)' },
    { id: 'amber',  grad: 'linear-gradient(165deg,#48331c 0%,#322312 60%,#21170c 100%)', accent: '#fbbf24', text: '#f6ecdc', sub: '#cbb89a', tile: 'rgba(255,255,255,0.08)', border: 'rgba(255,255,255,0.12)', dock: 'rgba(50,35,18,0.6)' },
    { id: 'plum',   grad: 'linear-gradient(165deg,#3a2747 0%,#271830 60%,#190f20 100%)', accent: '#d8b4fe', text: '#f1e8f8', sub: '#bda6cb', tile: 'rgba(255,255,255,0.08)', border: 'rgba(255,255,255,0.12)', dock: 'rgba(39,24,48,0.6)' },
    { id: 'mono',   grad: 'linear-gradient(165deg,#33343a 0%,#212227 60%,#161619 100%)', accent: '#cbd5e1', text: '#eceef2', sub: '#a7adba', tile: 'rgba(255,255,255,0.08)', border: 'rgba(255,255,255,0.12)', dock: 'rgba(33,34,39,0.6)' },
    { id: 'sky',    grad: 'linear-gradient(165deg,#24364f 0%,#172435 60%,#0e1722 100%)', accent: '#7dd3fc', text: '#e6f1f9', sub: '#a6bdd0', tile: 'rgba(255,255,255,0.08)', border: 'rgba(255,255,255,0.12)', dock: 'rgba(23,36,53,0.6)' },
];
const hashStr = (s: string): number => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };
const paletteFor = (char: CharacterProfile | null): PhoneTheme => PHONE_PALETTES[char ? hashStr(char.id) % PHONE_PALETTES.length : 0];

// ── 可检查的全套 App（每个 App 一类记录，统一走 LLM 取数） ──
interface CatalogApp { key: string; type: string; name: string; Icon: React.FC<any>; tint: string; logPrefix: string; instruction?: string; cityHint?: boolean }
const APP_CATALOG: CatalogApp[] = [
    { key: 'chat',    type: 'chat',     name: '信息',   Icon: ChatCircleDots,      tint: '#34d399', logPrefix: '聊天软件' },
    { key: 'call',    type: 'call',     name: '电话',   Icon: Phone,               tint: '#60a5fa', logPrefix: '通话记录' },
    { key: 'taobao',  type: 'order',    name: '购物',   Icon: ShoppingBag,         tint: '#fb923c', logPrefix: '购物APP', cityHint: true },
    { key: 'waimai',  type: 'delivery', name: '外卖',   Icon: Hamburger,           tint: '#f59e0b', logPrefix: '外卖APP', cityHint: true },
    { key: 'social',  type: 'social',   name: '动态',   Icon: CircleNotch,         tint: '#f472b6', logPrefix: '朋友圈' },
    { key: 'notes',   type: 'notes',    name: '备忘录', Icon: NotePencil,          tint: '#fbbf24', logPrefix: '备忘录',   instruction: '生成 3 条该角色备忘录/便签里的内容（待办、随手记、藏起来的心事、清单等，贴人设）。\n格式JSON数组: [{ "title": "便签标题", "detail": "内容" }]' },
    { key: 'wallet',  type: 'wallet',   name: '钱包',   Icon: Wallet,              tint: '#4ade80', logPrefix: '钱包',     instruction: '生成该角色钱包里的账户余额 + 2~3 笔最近收支（金额必须符合人设身份）。\n格式JSON数组: [{ "title": "项目(如 账户余额/某笔支出)", "detail": "说明", "value": "金额(如 ¥1,280 / -¥68)" }]' },
    { key: 'album',   type: 'album',    name: '相册',   Icon: ImageSquare,         tint: '#22d3ee', logPrefix: '相册',     instruction: '生成 3~4 条该角色相册里照片的文字描述（拍了什么、当时的场景与心情，贴人设）。\n格式JSON数组: [{ "title": "照片主题", "detail": "画面与心情描述" }]' },
    { key: 'music',   type: 'music',    name: '音乐',   Icon: MusicNotes,          tint: '#a78bfa', logPrefix: '音乐',     instruction: '生成该角色最近在听的 3~4 首歌（歌名+歌手+为什么循环它，贴人设与近期心境）。\n格式JSON数组: [{ "title": "歌名 - 歌手", "detail": "为什么在听/循环了多少次" }]' },
    { key: 'browser', type: 'browser',  name: '浏览',   Icon: GlobeHemisphereWest, tint: '#38bdf8', logPrefix: '浏览记录', instruction: '生成 3~4 条该角色最近的浏览器搜索/浏览记录（搜了什么，能侧面透出 TA 的关心或小秘密，贴人设）。\n格式JSON数组: [{ "title": "搜索词/网页标题", "detail": "备注" }]' },
    { key: 'map',     type: 'map',      name: '地图',   Icon: Compass,             tint: '#14b8a6', logPrefix: '地图足迹', cityHint: true, instruction: '生成 3~4 条该角色最近在地图/定位/打车软件里的地点记录（去过哪里、收藏了什么地点、搜过哪条路线）。地点要贴合角色城市与人设，不要都写景点。\n格式JSON数组: [{ "title": "地点/路线", "detail": "为什么出现这条记录/时间/备注" }]' },
    { key: 'health',  type: 'health',   name: '健康',   Icon: Heartbeat,           tint: '#f87171', logPrefix: '健康',     instruction: '生成该角色今天的健康数据（步数、睡眠、心率等 3~4 项，数值贴人设作息）。\n格式JSON数组: [{ "title": "指标(如 今日步数)", "detail": "说明", "value": "数值" }]' },
    { key: 'calendar',type: 'calendar', name: '日历',   Icon: CalendarBlank,       tint: '#fb7185', logPrefix: '日历',     instruction: '生成 3~4 条该角色日历上的日程/待办（贴人设的工作、约会、提醒）。\n格式JSON数组: [{ "title": "事项", "detail": "时间/地点/备注" }]' },
];
const catalogByType = (type: string): CatalogApp | undefined => APP_CATALOG.find(a => a.type === type);

const TwemojiImg: React.FC<{ code: string; alt?: string; className?: string }> = ({ code, alt, className = 'w-4 h-4 inline-block' }) => (
  <img src={`https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/${code}.png`} alt={alt || ''} className={className} draggable={false} />
);

// --- Debug Component ---
const LayoutInspector: React.FC = () => {
    const [stats, setStats] = useState({ w: 0, h: 0, vh: 0, top: 0 });
    
    useEffect(() => {
        const update = () => {
            setStats({
                w: window.innerWidth,
                h: window.innerHeight,
                vh: window.visualViewport?.height || 0,
                top: window.visualViewport?.offsetTop || 0
            });
        };
        window.addEventListener('resize', update);
        window.visualViewport?.addEventListener('resize', update);
        window.visualViewport?.addEventListener('scroll', update);
        update();
        return () => {
            window.removeEventListener('resize', update);
            window.visualViewport?.removeEventListener('resize', update);
            window.visualViewport?.removeEventListener('scroll', update);
        };
    }, []);

    return (
        <div className="absolute top-0 right-0 z-[9999] bg-red-500/80 text-white text-[10px] font-mono p-1 pointer-events-none select-none">
            Win: {stats.w}x{stats.h}<br/>
            VV: {stats.vh.toFixed(0)} (y:{stats.top.toFixed(0)})
        </div>
    );
};

interface CheckPhoneProps {
    /** 从聊天 + 号面板进入时直接连上当前角色的手机，跳过选择页 */
    initialCharId?: string;
    /** 作为聊天内嵌浮层时的退出回调（替代 closeApp / 返回选择页） */
    onExit?: () => void;
    /** 把翻到的内容「塞进剧情」：传入后每条记录会多一个「拿去对峙」按钮，
     *  点了就把这条证据以用户口吻抛进聊天，让角色当场解释 / 狡辩 / 评价。 */
    onConfront?: (framedText: string) => void;
}

const CheckPhone: React.FC<CheckPhoneProps> = ({ initialCharId, onExit, onConfront }) => {
    const { closeApp, characters, activeCharacterId, updateCharacter, apiConfig, auxApiConfig, addToast, userProfile } = useOS();
    // 查岗（生成 TA 的手机内容）属「聊天以外」的功能：走副 API（未配置时回退主 API）
    const auxApi = { ...apiConfig, ...resolveAuxApi(auxApiConfig, apiConfig) };
    const [view, setView] = useState<'select' | 'phone'>(initialCharId ? 'phone' : 'select');
    // activeAppId: 'home' | 'chat_detail' | 'app_id'
    const [activeAppId, setActiveAppId] = useState<string>('home');
    const [targetChar, setTargetChar] = useState<CharacterProfile | null>(
        () => (initialCharId && characters.find(c => c.id === initialCharId)) || null
    );
    const [isLoading, setIsLoading] = useState(false);
    
    // Chat Detail State
    const [selectedChatRecord, setSelectedChatRecord] = useState<PhoneEvidence | null>(null);
    const chatEndRef = useRef<HTMLDivElement>(null);
    
    // Custom App Creation State
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [newAppName, setNewAppName] = useState('');
    const [newAppIcon, setNewAppIcon] = useState('App');
    const [newAppColor, setNewAppColor] = useState('#3b82f6');
    const [newAppPrompt, setNewAppPrompt] = useState('');
    const [chatReplyText, setChatReplyText] = useState('');
    const [showMomentComposer, setShowMomentComposer] = useState(false);
    const [momentText, setMomentText] = useState('');
    const [intrusionNotice, setIntrusionNotice] = useState<{ title: string; body: string; shouldExit?: boolean } | null>(null);
    const [phoneLockExitOpen, setPhoneLockExitOpen] = useState(false);
    const [phoneLockExitCode, setPhoneLockExitCode] = useState('');
    const [phoneLockExitError, setPhoneLockExitError] = useState('');
    const [phoneLockExitBusy, setPhoneLockExitBusy] = useState(false);

    // Debug Toggle
    const [showDebug, setShowDebug] = useState(false);
    // AI「装点这台手机」：生成设备名 / 桌面副标 / 强调色，存进 phoneState.profile
    const [isDecorating, setIsDecorating] = useState(false);

    // Derived state for evidence records
    const records = targetChar?.phoneState?.records || [];
    const customApps = targetChar?.phoneState?.customApps || [];
    const phoneProfile: PhoneProfile = targetChar?.phoneState?.profile || {};
    const activePhoneLock = isPhoneLocked(targetChar?.phoneState?.lock) ? targetChar?.phoneState?.lock : null;

    // 角色专属手机皮肤：确定性配色 + 可选 LLM 装点覆盖
    const theme = useMemo<PhoneTheme>(() => {
        const base = paletteFor(targetChar);
        return phoneProfile.accent ? { ...base, accent: phoneProfile.accent } : base;
    }, [targetChar?.id, phoneProfile.accent]);
    const deviceName = phoneProfile.deviceName || (targetChar ? `${targetChar.name} 的手机` : '手机');
    const tagline = phoneProfile.tagline || '一台属于 TA 的手机';

    // 把一条记录框成「对峙台词」抛进剧情
    const confrontWith = (record: PhoneEvidence) => {
        if (!onConfront || !targetChar) return;
        const appName = catalogByType(record.type)?.name || customApps.find(a => a.id === record.type)?.name || '手机';
        const framed = record.type === 'chat'
            ? `（我翻了你的手机，看到你和「${record.title}」的聊天：\n${record.detail}）\n——这是怎么回事？你跟我说清楚。`
            : `（我翻了你的手机，看到${appName}里这条：「${record.title}」${record.detail ? ` — ${record.detail}` : ''}${record.value ? `（${record.value}）` : ''}）\n——你解释一下吧。`;
        onConfront(framed);
    };

    useEffect(() => {
        if (targetChar) {
            // Keep targetChar in sync with global state if it updates (e.g. deletion)
            const updated = characters.find(c => c.id === targetChar.id);
            if (updated) {
                setTargetChar(updated);
                // Update selected record ref if open
                if (selectedChatRecord) {
                    const freshRecord = updated.phoneState?.records?.find(r => r.id === selectedChatRecord.id);
                    if (freshRecord) setSelectedChatRecord(freshRecord);
                }
            }
        }
    }, [characters]);

    // Reset page scroll on navigation to prevent mobile layout shift
    useEffect(() => {
        window.scrollTo(0, 0);
    }, [activeAppId, view]);

    // Auto scroll to bottom of chat detail
    // NOTE: Do NOT use scrollIntoView - it propagates to page scroll on mobile, shifting the entire layout up
    useEffect(() => {
        if (activeAppId === 'chat_detail' && chatEndRef.current) {
            const container = chatEndRef.current.parentElement;
            if (container) {
                container.scrollTop = container.scrollHeight;
            }
        }
    }, [selectedChatRecord?.detail, activeAppId]);

    const handleSelectChar = (c: CharacterProfile) => {
        setTargetChar(c);
        setView('phone');
        setActiveAppId('home');
    };

    // 聊天内嵌模式：进来就直连当前角色的手机
    useEffect(() => {
        if (!initialCharId) return;
        const c = characters.find(ch => ch.id === initialCharId);
        if (c) handleSelectChar(c);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialCharId]);

    const handleExitPhone = () => {
        if (onExit) { onExit(); return; }
        setView('select');
        setTargetChar(null);
        setActiveAppId('home');
    };

    const requestPhoneLockExit = () => {
        setPhoneLockExitCode('');
        setPhoneLockExitError('');
        setPhoneLockExitOpen(true);
    };

    const cancelPhoneLockExit = () => {
        if (phoneLockExitBusy) return;
        setPhoneLockExitOpen(false);
        setPhoneLockExitCode('');
        setPhoneLockExitError('');
    };

    const submitPhoneLockExit = async () => {
        if (!targetChar || !activePhoneLock) {
            handleExitPhone();
            return;
        }
        if (!activePhoneLock.passcode) {
            setPhoneLockExitError('这次没有设置口令答案，只能等 Ta 完成题目自动解锁。');
            return;
        }
        const passcodeInput = sanitizePhoneLockPasscode(phoneLockExitCode);
        if (!passcodeInput) {
            setPhoneLockExitError('先代 Ta 输入口令。');
            return;
        }
        setPhoneLockExitBusy(true);
        setPhoneLockExitError('');
        const evaluated = evaluatePhoneLockSubmission(activePhoneLock, {
            passcodeInput,
            answers: [],
            reply: `${targetChar.name} 由退出口令解锁离开。`,
            mood: '想先回到密谈',
        });
        if (!evaluated.unlocked) {
            setPhoneLockExitBusy(false);
            setPhoneLockExitError('口令不对，Ta 还解不开。');
            return;
        }
        await updateCharacter(targetChar.id, {
            phoneState: { records: targetChar.phoneState?.records || [], ...targetChar.phoneState, lock: evaluated.nextLock },
        });
        addToast(`${targetChar.name} 口令正确，已回到密谈`, 'success');
        setPhoneLockExitBusy(false);
        setPhoneLockExitOpen(false);
        setPhoneLockExitCode('');
        handleExitPhone();
    };

    const handleDeleteRecord = async (record: PhoneEvidence) => {
        if (!targetChar) return;
        
        const newRecords = (targetChar.phoneState?.records || []).filter(r => r.id !== record.id);
        updateCharacter(targetChar.id, { 
            phoneState: { ...targetChar.phoneState, records: newRecords } 
        });

        if (record.systemMessageId) {
            await DB.deleteMessage(record.systemMessageId);
        }

        if (selectedChatRecord?.id === record.id) {
            setActiveAppId('chat'); // Go back to list
            setSelectedChatRecord(null);
        }

        addToast('记录已删除', 'success');
    };

    const handleDeleteApp = (appId: string) => {
        if (!targetChar) return;
        const newApps = (targetChar.phoneState?.customApps || []).filter(a => a.id !== appId);
        updateCharacter(targetChar.id, {
            // phoneState 可能尚不存在：展开 undefined 会把必填的 records 字段写丢
            phoneState: { records: targetChar.phoneState?.records || [], ...targetChar.phoneState, customApps: newApps }
        });
        addToast('App 已卸载', 'success');
    };

    const handleCreateCustomApp = () => {
        if (!targetChar || !newAppName || !newAppPrompt) return;
        
        const newApp: PhoneCustomApp = {
            id: `app-${Date.now()}`,
            name: newAppName,
            icon: newAppIcon,
            color: newAppColor,
            prompt: newAppPrompt
        };

        const currentApps = targetChar.phoneState?.customApps || [];
        updateCharacter(targetChar.id, {
            phoneState: { records: targetChar.phoneState?.records || [], ...targetChar.phoneState, customApps: [...currentApps, newApp] }
        });

        setShowCreateModal(false);
        setNewAppName('');
        setNewAppPrompt('');
        addToast(`已安装 ${newAppName}`, 'success');
    };

    const awarenessFallback = (action: string): { caught: boolean; shouldEnd: boolean; reply: string } => {
        if (!targetChar) return { caught: false, shouldEnd: false, reply: '' };
        const profileText = `${targetChar.name} ${targetChar.description || ''} ${targetChar.systemPrompt || ''}`.toLowerCase();
        let score = 0.32;
        if (/(敏感|警惕|多疑|占有|控制|侦探|杀手|黑客|安全|边界|洁癖|细节|反侦察)/i.test(profileText)) score += 0.28;
        if (/(迟钝|大条|粗心|天然|信任|温柔|随和)/i.test(profileText)) score -= 0.16;
        if (action.includes('发动态')) score += 0.12;
        const caught = Math.random() < Math.max(0.08, Math.min(0.82, score));
        return {
            caught,
            shouldEnd: caught && Math.random() < 0.68,
            reply: caught
                ? `你是不是动了我的手机？这个痕迹太明显了。`
                : `（暂时没有察觉。）`,
        };
    };

    const judgeIntrusion = async (action: string, detail: string) => {
        if (!targetChar) return;
        let result = awarenessFallback(action);
        if (auxApi.apiKey && auxApi.baseUrl) {
            try {
                const context = ContextBuilder.buildCoreContext(targetChar, userProfile, true);
                const prompt = `${context}

### [Task: 角色是否察觉手机被动过]
${userProfile.name || '用户'} 正在查岗并翻看「${targetChar.name}」的手机，刚刚做了一个越界操作：
- 操作：${action}
- 内容：${detail}

请按「${targetChar.name}」的人设、警觉度、占有欲、边界感、对 ${userProfile.name || '用户'} 的信任程度，判断 TA 是否会察觉，以及是否会立刻结束这次查岗。
只输出 JSON，不要 markdown：
{"caught": true或false, "shouldEnd": true或false, "reply": "如果察觉，TA 此刻说的一句话；没察觉则写一句很短的旁白"}`;
                const res = await fetch(`${auxApi.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${auxApi.apiKey}` },
                    body: JSON.stringify({ model: auxApi.model, messages: [{ role: 'user', content: prompt }], temperature: 0.85 }),
                });
                if (res.ok) {
                    let raw = (await safeResponseJson(res)).choices?.[0]?.message?.content || '';
                    raw = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
                    const s = raw.indexOf('{'); const e = raw.lastIndexOf('}');
                    if (s >= 0 && e > s) raw = raw.slice(s, e + 1);
                    const obj = JSON.parse(raw);
                    result = {
                        caught: !!obj.caught,
                        shouldEnd: !!obj.shouldEnd,
                        reply: typeof obj.reply === 'string' && obj.reply.trim() ? obj.reply.trim().slice(0, 120) : result.reply,
                    };
                }
            } catch {
                // fallback above is good enough for offline / parse failures
            }
        }

        if (result.caught) {
            await DB.saveMessage({
                charId: targetChar.id,
                role: 'system',
                type: 'text',
                content: `[查岗察觉] ${targetChar.name} 察觉到 ${userProfile.name || '用户'} 在查岗时动了 TA 的手机：${action}（${detail}）。${result.shouldEnd ? 'TA 决定立刻结束这次查岗。' : 'TA 暂时没有结束，但已经记住了。'}TA 当时说：「${result.reply}」`,
                metadata: { phoneIntrusionCaught: true },
            } as any);
            setIntrusionNotice({ title: `${targetChar.name} 察觉了`, body: result.reply, shouldExit: result.shouldEnd });
        } else {
            setIntrusionNotice({ title: '暂时没被发现', body: result.reply || `${targetChar.name} 还没察觉手机被动过。` });
        }
    };

    const handleSendAsCharacter = async () => {
        if (!targetChar || !selectedChatRecord) return;
        const text = chatReplyText.trim();
        if (!text) return;
        const updatedRecord = {
            ...selectedChatRecord,
            detail: `${selectedChatRecord.detail.trim()}\n我: ${text}`,
            timestamp: Date.now(),
        };
        setSelectedChatRecord(updatedRecord);
        setChatReplyText('');
        const allRecords = targetChar.phoneState?.records || [];
        const updatedRecords = allRecords.map(r => r.id === updatedRecord.id ? updatedRecord : r);
        await updateCharacter(targetChar.id, {
            phoneState: { ...targetChar.phoneState, records: updatedRecords },
        });
        await DB.saveMessage({
            charId: targetChar.id,
            role: 'system',
            type: 'text',
            content: `[查岗记录] ${userProfile.name || '用户'} 翻看 ${targetChar.name} 的手机时，冒用 ${targetChar.name} 的名义给「${selectedChatRecord.title}」发了一条消息：「${text}」。这件事可能会被 ${targetChar.name} 察觉。`,
            metadata: { userSentAsCharacter: true },
        } as any);
        await judgeIntrusion('冒用 TA 的名义给联系人发消息', `给「${selectedChatRecord.title}」发：「${text}」`);
    };

    const handlePostMomentAsCharacter = async () => {
        if (!targetChar) return;
        const text = momentText.trim();
        if (!text) return;
        const post: SocialPost = {
            id: `phone-check-moment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            authorName: targetChar.name,
            authorAvatar: targetChar.avatar,
            title: '',
            content: text,
            images: [],
            likes: 0,
            isCollected: false,
            isLiked: false,
            comments: [],
            timestamp: Date.now(),
            tags: ['查岗代发'],
            authorType: 'character',
            authorCharId: targetChar.id,
            likedBy: [],
            repostOf: null,
            visibility: 'public',
        };
        await DB.saveSocialPost(post);
        const newRecord: PhoneEvidence = {
            id: `rec-${Date.now()}-${Math.random()}`,
            type: 'social',
            title: '刚刚 · 此刻',
            detail: text,
            timestamp: Date.now(),
            value: '已发布',
        };
        await updateCharacter(targetChar.id, {
            phoneState: {
                ...targetChar.phoneState,
                records: [...(targetChar.phoneState?.records || []), newRecord],
            },
        });
        await DB.saveMessage({
            charId: targetChar.id,
            role: 'system',
            type: 'text',
            content: `[查岗记录] ${userProfile.name || '用户'} 翻看 ${targetChar.name} 的手机时，用 ${targetChar.name} 的此刻发布了一条动态：「${text}」。这件事可能会被 ${targetChar.name} 察觉。`,
            metadata: { userPostedMomentAsCharacter: true, momentPostId: post.id },
        } as any);
        setMomentText('');
        setShowMomentComposer(false);
        addToast('已用 TA 的此刻发出', 'success');
        await judgeIntrusion('用 TA 的此刻发动态', text);
    };

    // Calculate Time Gap - Duplicated logic from other apps for consistent experience
    const getTimeGapHint = (lastMsgTimestamp: number | undefined): string => {
        if (!lastMsgTimestamp) return '这是初次见面。';
        const now = Date.now();
        const diffMs = now - lastMsgTimestamp;
        const diffMins = Math.floor(diffMs / (1000 * 60));
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffDays = Math.floor(diffHours / 24);

        if (diffMins < 5) return '你们刚刚还在聊天。';
        if (diffMins < 60) return `距离上次互动只有 ${diffMins} 分钟。`;
        if (diffHours < 24) return `距离上次互动已经过了 ${diffHours} 小时。`;
        return `距离上次互动已经过了 ${diffDays} 天。`;
    };

    // --- Core Generation Logic ---

    const handleGenerate = async (type: string, customPrompt?: string) => {
        if (!targetChar || !auxApi.apiKey) {
            addToast('配置错误', 'error');
            return;
        }
        setIsLoading(true);

        try {
            // Include full memory details for accuracy
            await injectMemoryPalace(targetChar);
            const context = ContextBuilder.buildCoreContext(targetChar, userProfile, true);
            const msgs = await DB.getMessagesByCharId(targetChar.id);
            
            const lastMsg = msgs[msgs.length - 1];
            const timeGap = getTimeGapHint(lastMsg?.timestamp);

            const recentMsgs = msgs.slice(-50).map(m => {
                const roleName = m.role === 'user' ? userProfile.name : targetChar.name;
                const content = m.type === 'text' ? m.content : `[${m.type}]`;
                return `${roleName}: ${content}`;
            }).join('\n');

            let promptInstruction = "";
            let logPrefix = "";

            if (customPrompt) {
                promptInstruction = `用户正在查看你的手机 App: "${type}"。
该 App 的功能/用户想看的内容是: "${customPrompt}"。
请生成 2-4 条符合该 App 功能的记录。
必须符合你的人设（例如银行余额要符合身份，备忘录要符合性格）。
格式JSON数组: [{ "title": "标题/项目名", "detail": "详细内容/金额/状态", "value": "可选的数值状态(如 +100)" }, ...]`;
                const customApp = customApps.find(a => a.id === type);
                logPrefix = customApp ? customApp.name : type;
            } else {
                if (type === 'chat') {
                    promptInstruction = `生成 3 个该角色手机聊天软件(Message/Line)中的**对话片段**。
    要求：
    1. **自动匹配角色**: 根据人设，虚构 3 个合理的联系人（如：如果是学生，联系人可以是“辅导员”、“社团学长”；如果是杀手，联系人可以是“中间人”）。不要使用“User”作为联系人。
    2. **对话感**: 内容必须是有来有回的对话脚本（3-4句），体现他们之间的关系。
    3. **格式**: 必须严格使用 "我:..." 代表主角(你)，"对方:..." 或 "人名:..." 代表联系人。
    格式JSON数组: [{ "title": "联系人名称 (身份)", "detail": "对方: 最近怎么样？\\n我: 还活着。\\n对方: 那就好。" }, ...]`;
                    logPrefix = "聊天软件";
                } else if (type === 'call') {
                    promptInstruction = `生成 3 条该角色的近期**通话记录**。
    格式JSON数组: [{ "title": "联系人名称", "value": "呼入 (5分钟) / 未接 / 呼出 (30秒)", "detail": "关于下周聚会的事..." }, ...]`;
                    logPrefix = "通话记录";
                } else if (type === 'order') {
                    promptInstruction = `生成 3 条该角色最近的购物订单。${buildPhoneCityHint(targetChar)}
    格式JSON数组: [{ "title": "商品名", "detail": "状态" }, ...]`;
                    logPrefix = "购物APP";
                } else if (type === 'delivery') {
                    promptInstruction = `生成 3 条该角色最近的外卖记录。${buildPhoneCityHint(targetChar)}
    格式JSON数组: [{ "title": "店名", "detail": "菜品" }, ...]`;
                    logPrefix = "外卖APP";
                } else if (type === 'social') {
                    promptInstruction = `生成 2 条该角色的朋友圈/社交媒体动态。
    格式JSON数组: [{ "title": "时间/状态", "detail": "正文内容" }, ...]`;
                    logPrefix = "朋友圈";
                } else {
                    // 其余全套 App（备忘录 / 钱包 / 相册 / 音乐 / 浏览 / 健康 / 日历…）走目录里的取数指令
                    const cat = catalogByType(type);
                    if (cat?.instruction) {
                        promptInstruction = `${cat.instruction}${cat.cityHint ? `\n${buildPhoneCityHint(targetChar)}` : ''}`;
                        logPrefix = cat.logPrefix;
                    }
                }
            }

            if (!promptInstruction) { setIsLoading(false); addToast('这个 App 暂不支持检查', 'info'); return; }

            const fullPrompt = `${context}\n\n### [Current Status]\n时间距离上次互动: ${timeGap}\n\n### [Recent Chat Context]\n${recentMsgs}\n\n### [Task]\n${promptInstruction}\n请根据[Current Status]和人设调整生成内容的时间戳和情绪。如果很久没聊天，记录可能是近期的独处状态；如果刚聊过，记录可能与聊天内容相关。`;

            const response = await fetch(`${auxApi.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${auxApi.apiKey}` },
                body: JSON.stringify({
                    model: auxApi.model,
                    messages: [{ role: "user", content: fullPrompt }],
                    temperature: 0.8
                })
            });

            if (!response.ok) throw new Error('API Error');
            const data = await safeResponseJson(response);
            let content = data.choices[0].message.content;
            content = content.replace(/```json/g, '').replace(/```/g, '').trim();
            const firstBracket = content.indexOf('[');
            const lastBracket = content.lastIndexOf(']');
            if (firstBracket > -1 && lastBracket > -1) content = content.substring(firstBracket, lastBracket + 1);
            
            let json = [];
            try { json = JSON.parse(content); } catch (e) { json = []; }

            const newRecordsToAdd: PhoneEvidence[] = [];

            if (Array.isArray(json)) {
                for (const item of json) {
                    const recordTitle = item.title || 'Unknown';
                    const recordDetail = item.detail || '...';
                    
                    let sysMsgContent = "";
                    if (type === 'chat') {
                        sysMsgContent = `[系统: ${targetChar.name} 与 "${recordTitle}" 的聊天记录-内容涉及: ${recordDetail.replace(/\n/g, ' ')}]`;
                    } else {
                        sysMsgContent = `[系统: ${targetChar.name}的手机(${logPrefix}) 显示: ${recordTitle} - ${recordDetail}]`;
                    }
                    
                    await DB.saveMessage({
                        charId: targetChar.id,
                        role: 'system',
                        type: 'text',
                        content: sysMsgContent
                    });
                    
                    const currentMsgs = await DB.getMessagesByCharId(targetChar.id);
                    const savedMsg = currentMsgs[currentMsgs.length - 1];
                    
                    newRecordsToAdd.push({
                        id: `rec-${Date.now()}-${Math.random()}`,
                        type: type, 
                        title: recordTitle,
                        detail: recordDetail,
                        value: item.value,
                        timestamp: Date.now(),
                        systemMessageId: savedMsg?.id 
                    });
                    
                    await new Promise(r => setTimeout(r, 50)); 
                }
            }

            const existingRecords = targetChar.phoneState?.records || [];
            updateCharacter(targetChar.id, {
                phoneState: { ...targetChar.phoneState, records: [...existingRecords, ...newRecordsToAdd] }
            });

            addToast(`已刷新 ${newRecordsToAdd.length} 条数据`, 'success');

        } catch (e: any) {
            console.error(e);
            addToast('解析失败，请重试', 'error');
        } finally {
            setIsLoading(false);
        }
    };

    // --- AI 装点这台手机：让设备名 / 桌面副标 / 强调色更贴角色 ---
    const handleDecorate = async () => {
        if (!targetChar || !auxApi.apiKey) { addToast('配置错误', 'error'); return; }
        setIsDecorating(true);
        try {
            const persona = [
                `名字: ${targetChar.name}`,
                targetChar.description ? `备注: ${String(targetChar.description).slice(0, 200)}` : '',
                targetChar.systemPrompt ? `人设: ${String(targetChar.systemPrompt).slice(0, 800)}` : '',
            ].filter(Boolean).join('\n');
            const prompt = `根据下面这个角色的人设，为 TA 的手机设计一套贴人设的"桌面皮肤"。
${persona}

只输出一个 JSON 对象，不要任何其它文字：
{"deviceName":"设备名(像 TA 会给自己手机起的名字，10字内，可带 TA 的名字)","tagline":"锁屏/桌面上的一句话副标(20字内，像 TA 的签名/心情)","accent":"一个最贴 TA 气质的强调色十六进制(如 #a78bfa)"}`;
            const res = await fetch(`${auxApi.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${auxApi.apiKey}` },
                body: JSON.stringify({ model: auxApi.model, messages: [{ role: 'user', content: prompt }], temperature: 0.9 }),
            });
            if (!res.ok) throw new Error(`API ${res.status}`);
            let content = (await safeResponseJson(res)).choices?.[0]?.message?.content || '';
            content = content.replace(/```json/gi, '').replace(/```/g, '').trim();
            const s = content.indexOf('{'); const e = content.lastIndexOf('}');
            if (s >= 0 && e > s) content = content.slice(s, e + 1);
            const obj = JSON.parse(content);
            const accent = typeof obj.accent === 'string' && /^#?[0-9a-fA-F]{6}$/.test(obj.accent.replace('#', '')) ? (obj.accent.startsWith('#') ? obj.accent : `#${obj.accent}`) : undefined;
            const nextProfile: PhoneProfile = {
                ...phoneProfile,
                deviceName: typeof obj.deviceName === 'string' ? obj.deviceName.slice(0, 16) : phoneProfile.deviceName,
                tagline: typeof obj.tagline === 'string' ? obj.tagline.slice(0, 30) : phoneProfile.tagline,
                accent: accent || phoneProfile.accent,
                generated: true,
                generatedAt: Date.now(),
            };
            updateCharacter(targetChar.id, {
                phoneState: { records: targetChar.phoneState?.records || [], ...targetChar.phoneState, profile: nextProfile },
            });
            addToast('已为 TA 的手机换上新皮肤', 'success');
        } catch (err: any) {
            console.error(err);
            addToast('装点失败，请重试', 'error');
        } finally {
            setIsDecorating(false);
        }
    };

    // --- Continue Chat Logic ---

    const handleContinueChat = async () => {
        if (!selectedChatRecord || !targetChar || !auxApi.apiKey) return;
        setIsLoading(true);

        try {
            await injectMemoryPalace(targetChar);
            const context = ContextBuilder.buildCoreContext(targetChar, userProfile, true); // Enable detailed context
            const prompt = `${context}

### [Task: Continue Conversation]
Roleplay: You are "${targetChar.name}". You are chatting on your phone with "${selectedChatRecord.title}".
Current History:
"""
${selectedChatRecord.detail}
"""

Task: Please continue this conversation for 3-5 more turns. 
Style: Casual, IM style.
Format: 
- Use "我: ..." for yourself (${targetChar.name}).
- Use "对方: ..." for the contact (${selectedChatRecord.title}).
- Only output the new dialogue lines. Do NOT repeat history.
`;

            const response = await fetch(`${auxApi.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${auxApi.apiKey}` },
                body: JSON.stringify({
                    model: auxApi.model,
                    messages: [{ role: "user", content: prompt }],
                    temperature: 0.85
                })
            });

            if (response.ok) {
                const data = await safeResponseJson(response);
                let newLines = data.choices[0].message.content.trim();
                
                // Clean up any markdown
                newLines = newLines.replace(/```/g, '');

                // Append to existing record
                const updatedDetail = `${selectedChatRecord.detail}\n${newLines}`;
                
                // Update Local State
                const updatedRecord = { ...selectedChatRecord, detail: updatedDetail };
                setSelectedChatRecord(updatedRecord);

                // Update Character Profile
                const allRecords = targetChar.phoneState?.records || [];
                const updatedRecords = allRecords.map(r => r.id === updatedRecord.id ? updatedRecord : r);
                updateCharacter(targetChar.id, {
                    phoneState: { ...targetChar.phoneState, records: updatedRecords }
                });
                
                // Note: We deliberately do NOT add a system message to the main chat context here.
                // This is "pure viewing" mode.
            }

        } catch (e) {
            console.error(e);
            addToast('续写失败', 'error');
        } finally {
            setIsLoading(false);
        }
    };

    // --- Renderers ---

    const renderHeader = (title: string, backAction: () => void, extraAction?: React.ReactNode) => (
        <div className="h-14 flex items-center justify-between px-4 bg-white/80 backdrop-blur-md text-slate-800 shrink-0 z-20 border-b border-slate-200">
            <button onClick={backAction} className="p-2 -ml-2 rounded-full hover:bg-slate-100 transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                </svg>
            </button>
            <span className="font-bold text-base tracking-wide truncate max-w-[200px]">{title}</span>
            <div className="w-8 flex justify-end">{extraAction}</div>
        </div>
    );

    const renderChatList = () => {
        const list = records.filter(r => r.type === 'chat').sort((a,b) => b.timestamp - a.timestamp);
        return (
            <div className="absolute inset-0 w-full h-full flex flex-col bg-slate-50 z-10">
                {renderHeader('Message', () => setActiveAppId('home'))}
                <div className="flex-1 overflow-y-auto p-4 space-y-4 no-scrollbar pb-24 overscroll-contain">
                    {list.length === 0 && <div className="text-center text-slate-400 mt-20 text-xs">暂无聊天记录</div>}
                    {list.map(r => (
                        <div 
                            key={r.id} 
                            onClick={() => { setSelectedChatRecord(r); setActiveAppId('chat_detail'); }}
                            className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 relative group animate-slide-up active:scale-98 transition-transform cursor-pointer"
                        >
                            <div className="flex items-center gap-3">
                                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-100 to-indigo-100 flex items-center justify-center shadow-inner shrink-0">
                                    <User size={24} className="text-indigo-400" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex justify-between items-baseline mb-1">
                                        <div className="font-bold text-slate-700 text-sm truncate">{r.title}</div>
                                        <div className="text-[10px] text-slate-400">{new Date(r.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</div>
                                    </div>
                                    <div className="text-xs text-slate-500 truncate">
                                        {r.detail.split('\n').pop() || '...'}
                                    </div>
                                </div>
                            </div>
                            <button onClick={(e) => { e.stopPropagation(); handleDeleteRecord(r); }} className="absolute top-2 right-2 w-6 h-6 bg-red-100 text-red-500 rounded-full flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity z-10">×</button>
                        </div>
                    ))}
                </div>
                <div className="absolute bottom-8 w-full flex justify-center pointer-events-none z-30">
                    <button disabled={isLoading} onClick={() => handleGenerate('chat')} className="pointer-events-auto bg-green-500 text-white px-6 py-2.5 rounded-full shadow-xl font-bold text-xs flex items-center gap-2 active:scale-95 transition-transform">
                        {isLoading ? '连接中...' : '刷新消息列表'}
                    </button>
                </div>
            </div>
        );
    };

  const renderChatDetail = () => {
    if (!selectedChatRecord || !targetChar) return null;

    // Parse logic: look for "Me:" or "我:" vs others
    const lines = selectedChatRecord.detail.split('\n').filter(l => l.trim());
    const parsedLines = lines.map(line => {
        const isMe = line.startsWith('我') || line.startsWith('Me') || line.startsWith('Me:') || line.startsWith('我:');
        const content = line.replace(/^(我|Me|对方|Them|[\w\u4e00-\u9fa5]+)[:：]\s*/, '');
        return { isMe, content };
    });

    return (
        // 关键修复：添加不透明背景色，确保完全覆盖
      <div className="absolute inset-0 w-full h-full flex flex-col bg-[#f2f2f2] z-[100] overflow-hidden">
            {renderHeader(selectedChatRecord.title, () => setActiveAppId('chat'))}
            
            {/* 聊天内容区域 */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 no-scrollbar overscroll-contain min-h-0">
                {parsedLines.map((msg, idx) => (
                    <div key={idx} className={`flex ${msg.isMe ? 'justify-end' : 'justify-start'}`}>
                        {!msg.isMe && (
                            <div className="w-9 h-9 rounded-md bg-gray-300 flex items-center justify-center text-xs text-gray-500 mr-2 shrink-0">
                                {selectedChatRecord.title[0]}
                            </div>
                        )}
                        <div className={`px-3 py-2 rounded-lg max-w-[75%] text-sm leading-relaxed shadow-sm break-words relative ${msg.isMe ? 'bg-[#95ec69] text-black' : 'bg-white text-black'}`}>
                            {msg.isMe && <div className="absolute top-2 -right-1.5 w-3 h-3 bg-[#95ec69] rotate-45"></div>}
                            {!msg.isMe && <div className="absolute top-3 -left-1 w-2.5 h-2.5 bg-white rotate-45"></div>}
                            <span className="relative z-10">{msg.content}</span>
                        </div>
                        {msg.isMe && (
                            <img src={targetChar.avatar} className="w-9 h-9 rounded-md object-cover ml-2 shrink-0 shadow-sm" />
                        )}
                    </div>
                ))}
                {isLoading && (
                    <div className="flex justify-center py-4">
                        <div className="flex gap-1">
                            <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce"></div>
                            <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce delay-100"></div>
                            <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce delay-200"></div>
                        </div>
                    </div>
                )}
                <div ref={chatEndRef} />
            </div>

            {/* 底部按钮 - 关键修复：移除复杂的 env() 计算，使用固定 padding */}
            <div className="shrink-0 w-full p-4 bg-[#f7f7f7] border-t border-gray-200 space-y-2">
                {onConfront && (
                    <div className="flex gap-2">
                        <input
                            value={chatReplyText}
                            onChange={e => setChatReplyText(e.target.value)}
                            placeholder={`冒用 ${targetChar.name} 的名义发一条...`}
                            className="flex-1 min-w-0 px-3 py-2.5 bg-white border border-gray-300 rounded-xl text-[12px] outline-none focus:border-emerald-300"
                            disabled={isLoading}
                        />
                        <button
                            onClick={handleSendAsCharacter}
                            disabled={isLoading || !chatReplyText.trim()}
                            className="shrink-0 px-3 py-2.5 rounded-xl text-[12px] font-bold text-white bg-emerald-500 shadow-sm active:scale-95 transition-transform disabled:opacity-45"
                        >
                            代发
                        </button>
                    </div>
                )}
                <div className="flex gap-2">
                    <button
                        onClick={handleContinueChat}
                        disabled={isLoading}
                        className="flex-1 py-3 bg-white border border-gray-300 rounded-xl text-sm font-bold text-slate-600 shadow-sm active:bg-gray-50 transition-colors flex items-center justify-center gap-2"
                    >
                        {isLoading ? '对方正在输入...' : '偷看后续 / 拱火'}
                    </button>
                    {onConfront && (
                        <button
                            onClick={() => confrontWith(selectedChatRecord)}
                            disabled={isLoading}
                            className="shrink-0 px-4 py-3 rounded-xl text-sm font-bold text-white shadow-sm active:scale-95 transition-transform flex items-center justify-center gap-1.5"
                            style={{ background: '#e26b84' }}
                        >
                            <Quotes size={14} weight="fill" /> 拿去对峙
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

    const renderCallList = () => {
        const list = records.filter(r => r.type === 'call').sort((a,b) => b.timestamp - a.timestamp);
        return (
            <div className="absolute inset-0 w-full h-full flex flex-col bg-white z-10">
                {renderHeader('Recents', () => setActiveAppId('home'))}
                <div className="flex-1 overflow-y-auto no-scrollbar pb-24 overscroll-contain">
                    {list.length === 0 && <div className="text-center text-slate-400 mt-20 text-xs">暂无通话记录</div>}
                    {list.map(r => {
                        const isMissed = r.value?.includes('未接') || r.value?.includes('Missed');
                        const isOutgoing = r.value?.includes('呼出') || r.value?.includes('Outgoing');
                        return (
                            <div key={r.id} className="flex items-center gap-4 px-6 py-4 border-b border-slate-50 relative group animate-fade-in hover:bg-slate-50 transition-colors">
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isMissed ? 'bg-red-50 text-red-500' : 'bg-green-50 text-green-500'}`}>
                                    <Phone size={20} />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className={`font-bold text-sm truncate ${isMissed ? 'text-red-500' : 'text-slate-800'}`}>{r.title}</div>
                                    <div className="text-[10px] text-slate-400 flex items-center gap-1">
                                        <span>{isMissed ? '未接来电' : (isOutgoing ? '呼出' : '呼入')}</span>
                                        {r.value && !isMissed && <span>• {r.value.replace(/.*?\((.*?)\).*/, '$1')}</span>}
                                    </div>
                                    {r.detail && <div className="text-[10px] text-slate-500 mt-1 italic truncate">"{r.detail}"</div>}
                                </div>
                                {onConfront && (
                                    <button onClick={() => confrontWith(r)} title="拿去对峙" className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center active:scale-90 transition-transform" style={{ color: '#e26b84', background: '#e26b8418' }}>
                                        <Quotes size={13} weight="fill" />
                                    </button>
                                )}
                                <div className="text-[10px] text-slate-300">{new Date(r.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</div>
                                <button onClick={() => handleDeleteRecord(r)} className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 bg-red-100 text-red-500 rounded-full flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity">×</button>
                            </div>
                        );
                    })}
                </div>
                <div className="absolute bottom-8 w-full flex justify-center pointer-events-none z-30">
                    <button disabled={isLoading} onClick={() => handleGenerate('call')} className="pointer-events-auto bg-slate-800 text-white px-6 py-2.5 rounded-full shadow-xl font-bold text-xs flex items-center gap-2 active:scale-95 transition-transform">
                        {isLoading ? '...' : '刷新通话记录'}
                    </button>
                </div>
            </div>
        );
    };

    const renderGenericList = (appId: string, appName: string, customPrompt?: string) => {
        const list = records.filter(r => r.type === appId).sort((a,b) => b.timestamp - a.timestamp);
        const cat = catalogByType(appId);
        const tint = cat?.tint || '#1f2937';

        return (
            <div className="absolute inset-0 w-full h-full flex flex-col bg-slate-50 z-10">
                {renderHeader(appName, () => setActiveAppId('home'), appId === 'social' && onConfront ? (
                    <button
                        onClick={() => setShowMomentComposer(true)}
                        className="px-2.5 py-1.5 rounded-full text-[11px] font-bold text-white active:scale-95 transition-transform"
                        style={{ background: tint }}
                    >
                        代发
                    </button>
                ) : undefined)}

                <div className="flex-1 overflow-y-auto p-4 space-y-3 no-scrollbar pb-24 overscroll-contain">
                    {list.length === 0 && (
                        <div className="flex flex-col items-center justify-center h-64 text-slate-400 gap-2">
                            <Tray size={48} className="opacity-20 text-slate-400" />
                            <span className="text-xs">暂无数据，点下方刷新让 TA 的{appName}长出内容</span>
                        </div>
                    )}
                    {list.map(r => (
                        <div key={r.id} className="bg-white rounded-xl p-4 border border-slate-100 shadow-sm relative group animate-slide-up">
                            <div className="flex justify-between items-start mb-1">
                                <span className="font-bold text-slate-700 text-sm line-clamp-1">{r.title}</span>
                                {r.value && <span className="text-xs font-bold px-2 py-0.5 rounded" style={{ color: tint, background: `${tint}1a` }}>{r.value}</span>}
                            </div>
                            <div className="text-xs text-slate-500 leading-relaxed whitespace-pre-wrap">{r.detail}</div>
                            <div className="flex items-center justify-between mt-2">
                                {onConfront ? (
                                    <button onClick={() => confrontWith(r)} className="text-[10px] font-bold px-2 py-1 rounded-full flex items-center gap-1 active:scale-95 transition-transform" style={{ color: tint, background: `${tint}14` }}>
                                        <Quotes size={11} weight="fill" /> 拿去对峙
                                    </button>
                                ) : <span />}
                                <div className="text-[10px] text-slate-300">{new Date(r.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</div>
                            </div>
                            <button onClick={() => handleDeleteRecord(r)} className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity shadow-md">×</button>
                        </div>
                    ))}
                </div>

                <div className="absolute bottom-8 w-full flex justify-center pointer-events-none z-30">
                    <button
                        disabled={isLoading}
                        onClick={() => handleGenerate(appId, customPrompt)}
                        className="pointer-events-auto text-white px-6 py-2.5 rounded-full shadow-xl font-bold text-xs flex items-center gap-2 active:scale-95 transition-transform"
                        style={{ background: tint }}
                    >
                        {isLoading ? <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> : <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" /></svg>}
                        刷新数据
                    </button>
                </div>
            </div>
        );
    };

    // 桌面 App 图标：iOS 风格圆角方块，底色按 App 自己的 tint（千人千面靠角色配色 + 壁纸）
    const Tile: React.FC<{
        label: string;
        onClick: () => void;
        onDelete?: () => void;
        tint?: string;
        muted?: boolean;
        children: React.ReactNode;
    }> = ({ label, onClick, onDelete, tint, muted, children }) => (
        <div className="flex flex-col items-center gap-1.5 relative group">
            <button
                onClick={onClick}
                className="w-[54px] h-[54px] rounded-[16px] flex items-center justify-center transition-all active:scale-90 duration-200 relative overflow-hidden text-white shadow-[0_6px_16px_-6px_rgba(0,0,0,0.5)]"
                style={muted
                    ? { background: theme.tile, border: `1px solid ${theme.border}`, color: theme.sub }
                    : { background: tint ? `linear-gradient(150deg, ${tint}, ${tint}cc)` : theme.tile, border: `1px solid rgba(255,255,255,0.18)` }}
            >
                <span className="relative z-10 drop-shadow-sm">{children}</span>
            </button>
            <span className="text-[9px] tracking-wide font-medium leading-none truncate max-w-[58px] text-center" style={{ color: theme.sub }}>{label}</span>
            {onDelete && (
                <button
                    onClick={(e) => { e.stopPropagation(); onDelete(); }}
                    className="absolute -top-1.5 -right-0.5 w-4 h-4 bg-black/60 text-white rounded-full flex items-center justify-center text-[10px] leading-none opacity-0 group-hover:opacity-100 transition-opacity z-20 hover:bg-rose-500"
                >×</button>
            )}
        </div>
    );

    const renderDesktop = () => {
        const hasBg = !!targetChar?.dateBackground;
        const clock = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

        if (activePhoneLock) {
            const firstQuestion = activePhoneLock.questions[0]?.text || '完成任意一道题目即可解锁';
            return (
                <div className="absolute inset-0 flex flex-col overflow-hidden" style={{ background: '#202124', color: '#f7f7f7' }}>
                    <div className="h-10 px-6 pt-3 flex items-center justify-between text-[12px] font-semibold tabular-nums opacity-85">
                        <span>{clock}</span>
                        <span className="tracking-[0.16em]">5G 60%</span>
                    </div>
                    <button
                        onClick={requestPhoneLockExit}
                        className="absolute right-4 top-12 z-10 px-3 py-1.5 rounded-full text-[11px] font-bold active:scale-95"
                        style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}
                    >
                        试解锁
                    </button>
                    <div className="px-6 pt-12 text-center">
                        {targetChar?.avatar && <img src={targetChar.avatar} className="mx-auto w-16 h-16 rounded-2xl object-cover ring-1 ring-white/15 shadow-xl" alt="" />}
                        <div className="mt-4 text-[24px] font-black">{targetChar?.name}</div>
                        <div className="mt-3 text-[16px] tracking-[0.28em] opacity-60">手机已锁住</div>
                    </div>
                    <div className="flex-1 flex flex-col justify-center px-8 pb-16">
                        <div className="text-center text-[24px] leading-[1.65] font-serif font-bold whitespace-pre-wrap">
                            {activePhoneLock.note || activePhoneLock.message}
                        </div>
                        <div className="mt-10 space-y-3">
                            <div className="rounded-2xl px-4 py-3" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                                <div className="text-[11px] opacity-55 mb-1">解锁口令</div>
                                <div className="text-[16px] font-black tracking-[0.2em] opacity-65">等待 TA 输入</div>
                            </div>
                            <div className="rounded-2xl px-4 py-3" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                                <div className="text-[11px] opacity-55 mb-1">第 1 题</div>
                                <div className="text-[14px] leading-relaxed">{firstQuestion}</div>
                            </div>
                            <div className="py-3 rounded-2xl text-center text-[13px] font-black" style={{ background: '#f5f5f5', color: '#202124' }}>
                                口令正确或任意题完成后自动解锁
                            </div>
                        </div>
                    </div>
                </div>
            );
        }

        return (
            <div className="absolute inset-0 flex flex-col z-0 overflow-hidden" style={{ background: theme.grad }}>
                {/* 壁纸：有约会底图就用它（角色专属），叠一层暗化保证图标可读 */}
                {hasBg && (
                    <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: `url(${targetChar!.dateBackground})`, backgroundSize: 'cover', backgroundPosition: 'center', opacity: 0.42 }} />
                )}
                <div className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.18), transparent 28%, transparent 60%, rgba(0,0,0,0.4))' }} />

                {/* Status bar */}
                <div className="h-8 flex justify-between px-6 items-center z-20 relative pt-3" style={{ color: theme.text }}>
                    <span className="text-[12px] font-semibold tracking-tight tabular-nums">{clock}</span>
                    <div className="flex gap-1.5 items-center opacity-90">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3"><path d="M2 22h3V10H2v12zm6 0h3V6H8v16zm6 0h3V2h-3v20zm6 0h3v-8h-3v8z"/></svg>
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3"><path fillRule="evenodd" d="M1.371 8.143c5.858-5.857 15.356-5.857 21.213 0a.75.75 0 0 1 0 1.061l-.53.53a.75.75 0 0 1-1.06 0c-4.98-4.979-13.053-4.979-18.032 0a.75.75 0 0 1-1.06 0l-.53-.53a.75.75 0 0 1 0-1.06Zm3.182 3.182c4.1-4.1 10.749-4.1 14.85 0a.75.75 0 0 1 0 1.061l-.53.53a.75.75 0 0 1-1.062 0 8.25 8.25 0 0 0-11.667 0 .75.75 0 0 1-1.06 0l-.53-.53a.75.75 0 0 1 0-1.06Zm3.204 3.182a6 6 0 0 1 8.486 0 .75.75 0 0 1 0 1.061l-.53.53a.75.75 0 0 1-1.061 0 3.75 3.75 0 0 0-5.304 0 .75.75 0 0 1-1.06 0l-.53-.53a.75.75 0 0 1 0-1.06Zm3.182 3.182a1.5 1.5 0 0 1 2.122 0 .75.75 0 0 1 0 1.061l-.53.53a.75.75 0 0 1-1.061 0l-.53-.53a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" /></svg>
                        <div className="w-4 h-2 border border-current rounded-[2px] relative"><div className="absolute left-0 top-0 bottom-0 bg-current w-3/4"></div></div>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 px-6 pt-5 pb-28 z-10 overflow-y-auto no-scrollbar overscroll-none">
                    {/* Header：头像 + 设备名 + 副标 + 装点 */}
                    <div className="mb-7 flex items-center gap-3">
                        {targetChar?.avatar && (
                            <img src={targetChar.avatar} className="w-12 h-12 rounded-2xl object-cover shrink-0 ring-1 ring-white/25 shadow-lg" alt="" />
                        )}
                        <div className="min-w-0 flex-1">
                            <h1 className="text-[18px] font-bold leading-tight truncate" style={{ color: theme.text }}>{deviceName}</h1>
                            <p className="text-[11px] mt-0.5 truncate" style={{ color: theme.sub }}>{tagline}</p>
                        </div>
                        <button
                            onClick={handleDecorate}
                            disabled={isDecorating}
                            title="让 TA 的桌面更贴人设"
                            className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center active:scale-90 transition-transform disabled:opacity-60"
                            style={{ background: theme.tile, border: `1px solid ${theme.border}`, color: theme.accent }}
                        >
                            {isDecorating ? <div className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: `${theme.accent}55`, borderTopColor: theme.accent }} /> : <MagicWand size={18} weight="fill" />}
                        </button>
                    </div>

                    {/* Apps grid：全套可检查 App + 自定义 App + 安装 */}
                    <div className="grid grid-cols-4 gap-y-5 gap-x-2 place-items-center content-start">
                        {APP_CATALOG.map(app => (
                            <Tile key={app.key} label={app.name} tint={app.tint} onClick={() => setActiveAppId(app.key)}>
                                <app.Icon size={26} weight="fill" />
                            </Tile>
                        ))}

                        {customApps.map(app => (
                            <Tile key={app.id} label={app.name} tint={app.color} onClick={() => setActiveAppId(app.id)} onDelete={() => handleDeleteApp(app.id)}>
                                <span className="text-xl">{app.icon}</span>
                            </Tile>
                        ))}

                        <Tile label="安装" muted onClick={() => setShowCreateModal(true)}>
                            <Plus size={24} weight="bold" />
                        </Tile>
                        <Tile label="Debug" muted onClick={() => setShowDebug(!showDebug)}>
                            <Wrench size={22} weight="bold" />
                        </Tile>
                    </div>
                </div>

                {/* Dock */}
                <nav className="absolute bottom-4 left-1/2 -translate-x-1/2 w-[90%] z-40">
                    <div className="backdrop-blur-xl rounded-[22px] flex justify-around items-center px-4 py-3" style={{ background: theme.dock, border: `1px solid ${theme.border}` }}>
                        <button onClick={() => setActiveAppId('call')} className="flex items-center justify-center p-2.5 rounded-xl active:scale-90 duration-200" style={{ color: theme.sub }}>
                            <Phone size={22} weight="fill" />
                        </button>
                        <button onClick={() => setActiveAppId('chat')} className="flex items-center justify-center p-2.5 rounded-xl active:scale-90 duration-200" style={{ color: theme.sub }}>
                            <ChatCircleDots size={22} weight="fill" />
                        </button>
                        <button onClick={handleExitPhone} className="flex items-center justify-center rounded-xl p-2.5 active:scale-90 duration-200 text-white" aria-label="断开连接" style={{ background: theme.accent }}>
                            <SignOut size={22} weight="bold" />
                        </button>
                        <button onClick={() => setActiveAppId('browser')} className="flex items-center justify-center p-2.5 rounded-xl active:scale-90 duration-200" style={{ color: theme.sub }}>
                            <Compass size={22} weight="fill" />
                        </button>
                        <button onClick={() => setActiveAppId('album')} className="flex items-center justify-center p-2.5 rounded-xl active:scale-90 duration-200" style={{ color: theme.sub }}>
                            <ImageSquare size={22} weight="fill" />
                        </button>
                    </div>
                </nav>
            </div>
        );
    };

    if (view === 'select') {
        return (
            <div className="absolute inset-0 flex flex-col bg-[#faf9f6] scrap-panel font-light overflow-hidden">
                <div className="h-20 pt-4 flex items-center justify-between px-4 border-b border-dashed border-[#d9d4c8] bg-white/80 backdrop-blur-md sticky top-0 z-10 shrink-0">
                    <button onClick={onExit || closeApp} className="p-2 -ml-2 rounded-full hover:bg-black/5 text-[#2b2933]">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
                    </button>
                    <span className="font-bold text-[#2b2933] label-mono text-sm">想偷看谁的手机</span>
                    <div className="w-8"></div>
                </div>
                <div className="scrap-list flex-1 min-h-0 p-6 grid grid-cols-2 gap-5 overflow-y-auto pb-20 no-scrollbar overscroll-contain content-start">
                    {characters.map(c => (
                        <div key={c.id} onClick={() => handleSelectChar(c)} className="scrap-card aspect-[3/4] rounded-2xl p-4 flex flex-col items-center justify-center gap-4 cursor-pointer active:scale-95 transition-all group hover:!border-[#2b2933]">
                            <div className="w-20 h-20 rounded-full p-[2px] border-2 border-[#e7e2d8] group-hover:border-[#2b2933] transition-colors">
                                <img src={c.avatar} className="w-full h-full rounded-full object-cover grayscale group-hover:grayscale-0 transition-all" />
                            </div>
                            <div className="text-center">
                                <div className="font-bold text-[#2b2933] text-sm">{c.name}</div>
                                <div className="text-[10px] text-slate-400 font-mono mt-1">
  CONNECT &gt;
</div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    // Phone View Container
    // FIXED: Use absolute inset-0 to force fill parent container properly
    return (
        <div className="absolute inset-0 bg-slate-900 overflow-hidden font-sans overscroll-none">
            {showDebug && <LayoutInspector />}
            {activeAppId === 'home' ? renderDesktop() : (
                (() => {
                    if (activeAppId === 'chat') return renderChatList();
                    if (activeAppId === 'chat_detail') return renderChatDetail();
                    if (activeAppId === 'call') return renderCallList();
                    const cat = APP_CATALOG.find(a => a.key === activeAppId);
                    if (cat) return renderGenericList(cat.type, cat.name);
                    const custom = customApps.find(a => a.id === activeAppId);
                    if (custom) return renderGenericList(custom.id, custom.name, custom.prompt);
                    return null;
                })()
            )}

            <PhoneLockExitUnlockSheet
                open={phoneLockExitOpen}
                charName={targetChar?.name}
                clue={activePhoneLock?.note || activePhoneLock?.message}
                value={phoneLockExitCode}
                error={phoneLockExitError}
                disabledReason={activePhoneLock && !activePhoneLock.passcode ? '这次没有设置口令答案，只能等 Ta 完成题目自动解锁。' : undefined}
                busy={phoneLockExitBusy}
                onChange={(value) => {
                    setPhoneLockExitCode(sanitizePhoneLockPasscode(value));
                    setPhoneLockExitError('');
                }}
                onCancel={cancelPhoneLockExit}
                onSubmit={() => { void submitPhoneLockExit(); }}
            />

            <Modal
                isOpen={showMomentComposer}
                title={`用 ${targetChar?.name || 'TA'} 的此刻发动态`}
                onClose={() => setShowMomentComposer(false)}
                footer={
                    <button onClick={handlePostMomentAsCharacter} disabled={!momentText.trim()} className="w-full py-3 bg-[#2b2933] text-white font-bold rounded-2xl shadow-lg shadow-slate-300/70 disabled:opacity-40">
                        发布到此刻
                    </button>
                }
            >
                <textarea
                    value={momentText}
                    onChange={e => setMomentText(e.target.value)}
                    placeholder="这条动态会以 TA 的名义公开发出。"
                    className="w-full h-28 bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm resize-none outline-none focus:border-pink-300"
                />
                <p className="text-[10px] text-slate-400 mt-2">越界操作可能被 TA 察觉，敏感、警惕或占有欲强的角色更容易当场结束查岗。</p>
            </Modal>

            <Modal
                isOpen={!!intrusionNotice}
                title={intrusionNotice?.title || ''}
                onClose={() => {
                    const shouldExit = intrusionNotice?.shouldExit;
                    setIntrusionNotice(null);
                    if (shouldExit) handleExitPhone();
                }}
                footer={
                    <button
                        onClick={() => {
                            const shouldExit = intrusionNotice?.shouldExit;
                            setIntrusionNotice(null);
                            if (shouldExit) handleExitPhone();
                        }}
                        className="w-full py-3 bg-[#2b2933] text-white font-bold rounded-2xl shadow-lg shadow-slate-300/70"
                    >
                        {intrusionNotice?.shouldExit ? '结束查岗' : '知道了'}
                    </button>
                }
            >
                <div className="text-sm leading-relaxed text-slate-700 whitespace-pre-wrap">{intrusionNotice?.body}</div>
            </Modal>

            {/* Create App Modal */}
            <Modal isOpen={showCreateModal} title="安装自定义 App" onClose={() => setShowCreateModal(false)} footer={<button onClick={handleCreateCustomApp} className="w-full py-3 bg-[#2b2933] text-white font-bold rounded-2xl shadow-lg shadow-slate-300/70">安装到桌面</button>}>
                <div className="space-y-4">
                    <div className="flex gap-4">
                        <div className="w-16 h-16 rounded-xl flex items-center justify-center text-3xl shadow-md border-2 border-slate-100 shrink-0" style={{ background: newAppColor }}>
                            {newAppIcon}
                        </div>
                        <div className="flex-1 space-y-2">
                            <input value={newAppName} onChange={e => setNewAppName(e.target.value)} placeholder="App 名称 (如: 银行)" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm" />
                            <div className="flex gap-2">
                                <input value={newAppIcon} onChange={e => setNewAppIcon(e.target.value)} placeholder="Emoji" className="w-16 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-center" />
                                <input type="color" value={newAppColor} onChange={e => setNewAppColor(e.target.value)} className="h-9 flex-1 cursor-pointer rounded-lg bg-transparent" />
                            </div>
                        </div>
                    </div>
                    <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">功能指令 (AI Prompt)</label>
                        <textarea 
                            value={newAppPrompt} 
                            onChange={e => setNewAppPrompt(e.target.value)} 
                            placeholder="例如: 显示该用户的存款余额、近期的转账记录以及理财收益。" 
                            className="w-full h-24 bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs resize-none"
                        />
                        <p className="text-[9px] text-slate-400 mt-1">AI 将根据此指令生成该 App 内部的数据。</p>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default CheckPhone;
