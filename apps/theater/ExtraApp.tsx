import React, { useState } from 'react';
import { useOS } from '../../context/OSContext';
import { Sparkle, ListChecks, ChatsCircle, Fire, NotePencil, ArrowClockwise, PaperPlaneTilt, WechatLogo, Camera, Megaphone, ImagesSquare, Scroll } from '@phosphor-icons/react';
import { resolveAuxApi } from '../../utils/auxApi';
import { DB } from '../../utils/db';
import {
    inferQuestionCount, genNextQuestion, genCharAnswer, genExtraPiece, genFauxPiece,
    type ExtraKind, type FauxKind, type FauxResult,
} from '../../utils/theaterExtra';
import {
    bankQuizNames, getBankQuestions, isBankQuiz,
    instructionsForKind, pickInstruction, EXTRA_INSTRUCTIONS, type ExtraBankKind,
} from '../../utils/theaterExtraBank';
import { WeChatScreenshot, MomentsCard, XhsCard, ForumThread } from '../../components/theater/faux/FauxRenderers';
import { PaperShell, ScrapScroll, ScrapHeader, Polaroid, ScrapButton, PaperCard, Stamp, SectionTag, INK, INK_SOFT } from './scrapbook';
import type { CharacterProfile } from '../../types';

/**
 * 折子戏·番外（贰）：选一个角色一起做「番外」。
 *  - 问卷番外：输入想要的问卷，系统一题一题出题，角色作答 + 用户作答；
 *  - 番外工坊 / 仿真图文：围绕角色一次性生成贴吧帖 / 聊天记录 / 热梗 / 微信朋友圈等主题番外。
 * 黑白拼贴手账皮肤（仿真图文渲染保留原样，模拟真 App 观感）。
 * 📌 题库（问卷题目）& 番外指令库都在 utils/theaterExtraBank.ts（用户可自由增删）：
 *    问卷带「题库」标的从你的题库取题；工坊/仿真图文可点指令芯片或「随机挑一条」从你的列表里选。
 */

interface Props { onExit: () => void; }

type Mode = 'home' | 'quiz' | 'piece' | 'faux';
interface QA { question: string; charAnswer: string; userAnswer: string }

// 题库里的问卷名排在前（带「题库」标），再接默认示例；去重。
const QUIZ_PRESETS = [...new Set([
    ...bankQuizNames(),
    '恋爱相性100问', 'MBTI 测试问卷', '性癖测试问卷50问', '价值观问卷', '无厘头问卷50题', '灵魂拷问36问',
])];

const FAUX_TABS: { kind: FauxKind; label: string; icon: React.ReactNode; hint: string; ph: string }[] = [
    { kind: 'wechat', label: '微信聊天', icon: <WechatLogo size={18} weight="fill" />, hint: '仿“捡手机”看到的、极真实接地气的 user×char 微信聊天记录', ph: '聊天关键词（如：深夜报备 / 吵架冷战 / 出差想你）' },
    { kind: 'moments', label: '朋友圈', icon: <Camera size={18} weight="bold" />, hint: '一条仿微信朋友圈，配图 + 点赞 + 评论，藏点两人的暗流', ph: '想发什么内容？（留空＝深扒两人近况）' },
    { kind: 'xhs', label: '小红书', icon: <ImagesSquare size={18} weight="bold" />, hint: '图文并茂的小红书笔记，标题党 + 话题 + 评论', ph: '笔记主题（如：深扒我对象 / 和 TA 的100件小事）' },
    { kind: 'forum', label: '匿名论坛', icon: <Megaphone size={18} weight="bold" />, hint: '匿名帖 + 多层跟帖吃瓜，深扒 char×user 的八卦', ph: '想开什么帖？（留空＝关于 TA 的瓜）' },
];

const PIECE_TABS: { kind: ExtraKind; label: string; icon: React.ReactNode; hint: string; ph: string }[] = [
    { kind: 'tieba', label: '贴吧帖', icon: <ChatsCircle size={18} weight="bold" />, hint: '以 TA 为话题的求助/讨论帖 + 网友回复', ph: '想发什么帖？（如：求助 TA 最近好奇怪 / 这角色到底什么来头）' },
    { kind: 'chatlog', label: '聊天记录', icon: <NotePencil size={18} weight="bold" />, hint: '围绕 TA 的一段群聊/对话截图文字稿', ph: '聊天背景（如：群里突然聊到 TA / 闺蜜八卦）' },
    { kind: 'meme', label: '热梗', icon: <Fire size={18} weight="bold" />, hint: '把 TA 套进当下流行梗里', ph: '想玩哪方面的梗？（留空＝TA 的性格名场面）' },
    { kind: 'custom', label: '自定义', icon: <Sparkle size={18} weight="bold" />, hint: '你说要什么番外，就写什么', ph: '描述你想要的番外…' },
];

const paperInput: React.CSSProperties = { background: 'rgba(255,253,247,0.85)', color: '#3a362f', border: '1px solid rgba(176,170,158,0.7)' };

// ⚠️ 下面这几个积木**必须放在组件外**：若放进 ExtraApp 体内，每次 render 都会生成新组件标识，
// React 会把 <Page> 整棵子树（PaperShell + 内容）卸载重挂，PaperShell 的 animate-fade-in 随之重放。
// 而 useOS() 的 virtualTime 每秒一跳 → ExtraApp 每秒 re-render → 三个子页（问卷/工坊/仿真图文）一直闪屏。
// 提到模块级后标识稳定，每秒只是就地 reconcile，不再重挂、不再闪。

// 选项卡（仿真/工坊）墨纸切换
const tabStyle = (on: boolean): React.CSSProperties => on
    ? { background: '#1f1d1a', color: '#f6f3ec', border: '1px solid #1f1d1a' }
    : { background: 'rgba(255,253,247,0.7)', color: '#5b554a', border: '1px solid rgba(176,170,158,0.65)' };

// 黑白页壳
const Page: React.FC<{ title: string; en: string; onBack: () => void; backLabel?: string; children: React.ReactNode }> = ({ title, en, onBack, backLabel = '返回', children }) => (
    <PaperShell>
        <ScrapHeader title={title} en={en} onBack={onBack} backLabel={backLabel} />
        <ScrapScroll className="px-5 pb-10 space-y-4 pt-1">{children}</ScrapScroll>
    </PaperShell>
);

// 角色选择条（拍立得）
const CharPicker: React.FC<{ characters: CharacterProfile[]; pickCharId: string; setPickCharId: (id: string) => void }> = ({ characters, pickCharId, setPickCharId }) => (
    <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1 px-0.5">
        {characters.length === 0 && <div className="text-xs py-2" style={{ color: INK_SOFT }}>还没有角色，先去创建一个吧</div>}
        {characters.map((c, i) => (
            <Polaroid key={c.id} src={c.avatar} caption={c.name} size={48} rotate={i % 2 ? 1.5 : -1.5} selected={pickCharId === c.id} onClick={() => setPickCharId(c.id)} />
        ))}
    </div>
);

// 指令库（你的文档 theaterExtraBank）：芯片点选 = 自己挑；随机挑一条 = 系统从你列表里替你选。
// 选中即填进输入框，可再编辑。用在番外工坊 / 仿真图文。
const InstructionRow: React.FC<{ kind: ExtraBankKind; onPick: (s: string) => void }> = ({ kind, onPick }) => {
    if (!EXTRA_INSTRUCTIONS.length) return null;
    const list = instructionsForKind(kind);
    return (
        <div className="space-y-1.5">
            <div className="flex items-center justify-between">
                <span className="text-[10px] tracking-[0.18em]" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>指令库 · 你的文档</span>
                <button onClick={() => { const ins = pickInstruction(kind); if (ins) onPick(ins.instruction); }} className="text-[11px] font-bold active:scale-95" style={{ color: INK }}>🎲 随机挑一条</button>
            </div>
            {list.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    {list.map((ins, i) => (
                        <button key={i} onClick={() => onPick(ins.instruction)} title={ins.instruction} className="px-2.5 py-1 rounded-full text-[11px] font-bold active:scale-95" style={tabStyle(false)}>{ins.label}</button>
                    ))}
                </div>
            )}
        </div>
    );
};

const ExtraApp: React.FC<Props> = ({ onExit }) => {
    const { characters, apiConfig, auxApiConfig, userProfile, addToast } = useOS();
    const api = resolveAuxApi(auxApiConfig, apiConfig);
    const apiReady = !!(api.baseUrl && api.model);
    const userName = (userProfile?.name || '').trim() || '你';

    const [mode, setMode] = useState<Mode>('home');
    const [pickCharId, setPickCharId] = useState('');
    const char = characters.find(c => c.id === pickCharId);

    const [topic, setTopic] = useState('');
    const [total, setTotal] = useState(50);
    const [items, setItems] = useState<QA[]>([]);
    const [idx, setIdx] = useState(0);
    const [answerInput, setAnswerInput] = useState('');
    const [busy, setBusy] = useState(false);
    const [finished, setFinished] = useState(false);

    const [pieceKind, setPieceKind] = useState<ExtraKind>('tieba');
    const [piecePrompt, setPiecePrompt] = useState('');
    const [piece, setPiece] = useState('');

    const [fauxKind, setFauxKind] = useState<FauxKind>('wechat');
    const [fauxKeyword, setFauxKeyword] = useState('');
    const [fauxResult, setFauxResult] = useState<FauxResult | null>(null);

    const runFaux = async () => {
        if (!char) { addToast('先选一个角色', 'info'); return; }
        if (!apiReady) { addToast('还没配置 API，去「文具盒」填好再来', 'error'); return; }
        setBusy(true); setFauxResult(null);
        try {
            const out = await genFauxPiece({ api, kind: fauxKind, char, userProfile, keyword: fauxKeyword.trim() || undefined });
            setFauxResult(out);
        } catch (e: any) { addToast('生成失败：' + (e?.message || e), 'error'); } finally { setBusy(false); }
    };

    const exportFauxToChat = async () => {
        if (!char || !fauxResult) return;
        const tab = FAUX_TABS.find(t => t.kind === fauxKind);
        const summary = fauxResult.data ? JSON.stringify(fauxResult.data, null, 2) : fauxResult.fallbackText;
        try {
            await DB.saveMessage({ charId: char.id, role: 'system', type: 'text', content: `【番外·${tab?.label || ''}】\n${summary}`, timestamp: Date.now() });
            addToast(`已发到与 ${char.name} 的聊天`, 'success');
        } catch { addToast('发送失败', 'error'); }
    };

    const resetQuiz = () => { setItems([]); setIdx(0); setAnswerInput(''); setFinished(false); setTopic(''); };

    const startQuiz = async () => {
        if (!char) { addToast('先选一个一起答题的角色', 'info'); return; }
        const t = topic.trim();
        if (!t) { addToast('想做哪份问卷？写一个名字～', 'info'); return; }
        if (!apiReady) { addToast('还没配置 API，去「文具盒」填好再来', 'error'); return; }
        const bank = getBankQuestions(t);          // 题库里有这份问卷就用你的题
        const n = bank ? bank.length : inferQuestionCount(t);
        setTotal(n); setItems([]); setIdx(0); setAnswerInput(''); setFinished(false); setBusy(true);
        try {
            const q = await genNextQuestion({ api, topic: t, index: 0, total: n, asked: [], bankQuestions: bank ?? undefined });
            const a = await genCharAnswer({ api, char, userProfile, topic: t, question: q });
            setItems([{ question: q, charAnswer: a, userAnswer: '' }]);
        } catch (e: any) {
            addToast('出题失败：' + (e?.message || e), 'error');
        } finally { setBusy(false); }
    };

    const nextQuestion = async () => {
        if (!char) return;
        const committed = items.map((it, i) => i === idx ? { ...it, userAnswer: answerInput.trim() } : it);
        setItems(committed);
        if (committed.length >= total) { setFinished(true); return; }
        setBusy(true); setAnswerInput('');
        try {
            const asked = committed.map(it => it.question);
            const bank = getBankQuestions(topic);
            const q = await genNextQuestion({ api, topic, index: committed.length, total, asked, bankQuestions: bank ?? undefined });
            const a = await genCharAnswer({ api, char, userProfile, topic, question: q });
            setItems([...committed, { question: q, charAnswer: a, userAnswer: '' }]);
            setIdx(committed.length);
        } catch (e: any) {
            addToast('出下一题失败：' + (e?.message || e), 'error');
        } finally { setBusy(false); }
    };

    const regenCharAnswer = async () => {
        if (!char || busy) return;
        setBusy(true);
        try {
            const a = await genCharAnswer({ api, char, userProfile, topic, question: items[idx].question });
            setItems(items.map((it, i) => i === idx ? { ...it, charAnswer: a } : it));
        } catch (e: any) { addToast('重答失败：' + (e?.message || e), 'error'); } finally { setBusy(false); }
    };

    const exportQuizToChat = async () => {
        if (!char) return;
        const done = items.filter(it => it.userAnswer || it.charAnswer);
        const body = [`【番外·${topic}】我和 ${char.name} 一起做完了这份问卷：`, '',
            ...done.map((it, i) => `${i + 1}. ${it.question}\n  · ${char.name}：${it.charAnswer || '—'}\n  · ${userName}：${it.userAnswer || '—'}`),
        ].join('\n');
        try {
            await DB.saveMessage({ charId: char.id, role: 'system', type: 'text', content: body, timestamp: Date.now() });
            addToast(`已整理发到与 ${char.name} 的聊天`, 'success');
        } catch { addToast('发送失败', 'error'); }
    };

    const runPiece = async () => {
        if (!char) { addToast('先选一个角色', 'info'); return; }
        if (!apiReady) { addToast('还没配置 API，去「文具盒」填好再来', 'error'); return; }
        setBusy(true); setPiece('');
        try {
            const out = await genExtraPiece({ api, kind: pieceKind, char, userProfile, prompt: piecePrompt.trim() || undefined });
            setPiece(out);
        } catch (e: any) { addToast('生成失败：' + (e?.message || e), 'error'); } finally { setBusy(false); }
    };

    const exportPieceToChat = async () => {
        if (!char || !piece) return;
        const tab = PIECE_TABS.find(t => t.kind === pieceKind);
        try {
            await DB.saveMessage({ charId: char.id, role: 'system', type: 'text', content: `【番外·${tab?.label || ''}】\n${piece}`, timestamp: Date.now() });
            addToast(`已发到与 ${char.name} 的聊天`, 'success');
        } catch { addToast('发送失败', 'error'); }
    };

    // ============ 问卷番外 ============
    if (mode === 'quiz') {
        const cur = items[idx];
        return (
            <Page title="问卷番外" en="THE QUIZ" onBack={() => { resetQuiz(); setMode('home'); }}>
                {items.length === 0 ? (
                    <>
                        <CharPicker characters={characters} pickCharId={pickCharId} setPickCharId={setPickCharId} />
                        <PaperCard tilt={-0.5} className="p-4 space-y-3">
                            <div className="text-[13px]" style={{ color: '#4a463e' }}>想做哪份问卷？市面上的都行——写名字就生成（每份至少 50 题）。带「题库」标的用你在文档里写好的题。</div>
                            <input value={topic} onChange={e => setTopic(e.target.value)} placeholder="如：恋爱相性100问 / 性癖测试50问 / MBTI"
                                className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={paperInput} />
                            <div className="flex flex-wrap gap-1.5">
                                {QUIZ_PRESETS.map(p => (
                                    <button key={p} onClick={() => setTopic(p)} className="px-2.5 py-1 rounded-full text-[11px] font-bold active:scale-95 inline-flex items-center gap-1" style={tabStyle(false)}>
                                        {p}{isBankQuiz(p) && <span className="text-[8px] px-1 rounded-[3px]" style={{ background: '#1f1d1a', color: '#f6f3ec' }}>题库</span>}
                                    </button>
                                ))}
                            </div>
                            <ScrapButton variant="ink" className="w-full py-2.5 text-sm" disabled={busy} onClick={() => void startQuiz()}>{busy ? '正在出第一题…' : '开始答题'}</ScrapButton>
                        </PaperCard>
                    </>
                ) : finished ? (
                    <PaperCard tilt={-0.6} tape="ink" className="p-5 space-y-3 text-center">
                        <Sparkle size={30} weight="fill" className="mx-auto" style={{ color: INK }} />
                        <div className="text-lg font-black" style={{ color: INK }}>做完啦！</div>
                        <div className="text-[12px]" style={{ color: '#6b6558' }}>和 {char?.name} 一起完成了《{topic}》共 {items.length} 题。</div>
                        <div className="flex gap-2 pt-1">
                            <ScrapButton variant="paper" className="flex-1 py-2.5 text-sm" onClick={() => void exportQuizToChat()} icon={<PaperPlaneTilt size={16} weight="bold" />}>发到聊天</ScrapButton>
                            <ScrapButton variant="ink" className="flex-1 py-2.5 text-sm" onClick={() => { resetQuiz(); }}>再来一份</ScrapButton>
                        </div>
                    </PaperCard>
                ) : cur ? (
                    <>
                        {/* 进度 */}
                        <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(31,29,26,0.1)' }}>
                                <div className="h-full" style={{ width: `${Math.round((idx / total) * 100)}%`, background: '#1f1d1a' }} />
                            </div>
                            <span className="text-[11px] tabular-nums" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>{idx + 1}/{total}</span>
                        </div>
                        {/* 题目 */}
                        <PaperCard tilt={-0.4} className="p-4">
                            <div className="text-[10px] tracking-[0.2em] mb-1.5" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>Q{idx + 1} · {topic}</div>
                            <div className="text-[15px] font-black leading-relaxed" style={{ color: INK }}>{cur.question}</div>
                        </PaperCard>
                        {/* 角色作答（墨色相版） */}
                        <div className="rounded-[14px] p-4" style={{ background: 'linear-gradient(180deg,#26231f,#1c1a17)', color: '#f3ecdf', border: '1px solid rgba(31,29,26,0.8)', outline: '1px dashed rgba(246,243,236,0.2)', outlineOffset: -5, transform: 'rotate(0.4deg)' }}>
                            <div className="flex items-center justify-between mb-1.5">
                                <div className="flex items-center gap-2">
                                    {char && <img src={char.avatar} className="w-6 h-6 rounded-full object-cover" style={{ filter: 'grayscale(1) contrast(1.1)' }} alt="" />}
                                    <span className="text-[12px] font-black">{char?.name} 的回答</span>
                                </div>
                                <button onClick={() => void regenCharAnswer()} disabled={busy} className="active:scale-90 disabled:opacity-40" style={{ color: 'rgba(246,243,236,0.7)' }} title="让 TA 重答">
                                    <ArrowClockwise size={15} weight="bold" />
                                </button>
                            </div>
                            <div className="text-[13px] leading-relaxed whitespace-pre-wrap" style={{ color: 'rgba(246,243,236,0.9)' }}>{busy && !cur.charAnswer ? '思考中…' : cur.charAnswer}</div>
                        </div>
                        {/* 用户作答 */}
                        <PaperCard tilt={0.4} className="p-4">
                            <div className="text-[12px] font-black mb-1.5" style={{ color: '#4a463e' }}>{userName} 的回答</div>
                            <textarea value={answerInput} onChange={e => setAnswerInput(e.target.value)} placeholder="也写下你的答案…（可留空）"
                                rows={2} className="w-full rounded-xl px-3 py-2 text-sm outline-none resize-none" style={paperInput} />
                        </PaperCard>
                        <ScrapButton variant="ink" className="w-full py-2.5 text-sm" disabled={busy} onClick={() => void nextQuestion()}>{busy ? '出下一题…' : (items.length >= total ? '完成' : '下一题')}</ScrapButton>
                    </>
                ) : null}
            </Page>
        );
    }

    // ============ 仿真图文番外 ============
    if (mode === 'faux') {
        const tab = FAUX_TABS.find(t => t.kind === fauxKind)!;
        const d = fauxResult?.data;
        return (
            <Page title="仿真图文" en="FAUX SCREENS" onBack={() => { setFauxResult(null); setMode('home'); }}>
                <CharPicker characters={characters} pickCharId={pickCharId} setPickCharId={setPickCharId} />
                <div className="grid grid-cols-4 gap-2">
                    {FAUX_TABS.map(t => (
                        <button key={t.kind} onClick={() => { setFauxKind(t.kind); setFauxResult(null); }} className="flex flex-col items-center gap-1 py-2.5 rounded-2xl transition-all active:scale-95" style={tabStyle(fauxKind === t.kind)}>
                            {t.icon}<span className="text-[10px] font-bold">{t.label}</span>
                        </button>
                    ))}
                </div>
                <div className="text-[11px] px-1" style={{ color: '#6b6558' }}>{tab.hint}</div>
                <textarea value={fauxKeyword} onChange={e => setFauxKeyword(e.target.value)} placeholder={tab.ph}
                    rows={2} className="w-full rounded-xl px-3 py-2.5 text-sm outline-none resize-none" style={paperInput} />
                <InstructionRow kind={fauxKind} onPick={setFauxKeyword} />
                <ScrapButton variant="ink" className="w-full py-2.5 text-sm" disabled={busy} onClick={() => void runFaux()}>{busy ? '生成中…' : '生成仿真图文'}</ScrapButton>

                {fauxResult && (
                    <div className="space-y-3">
                        {d && fauxKind === 'wechat' && <WeChatScreenshot data={d} charAvatar={char?.avatar} userAvatar={userProfile?.avatar} />}
                        {d && fauxKind === 'moments' && <MomentsCard data={d} avatar={char?.avatar} />}
                        {d && fauxKind === 'xhs' && <XhsCard data={d} />}
                        {d && fauxKind === 'forum' && <ForumThread data={d} />}
                        {!d && (
                            <PaperCard className="p-4 text-[13px] leading-relaxed whitespace-pre-wrap" style={{ color: '#3a362f' }}>
                                <div className="text-[10px] mb-1.5" style={{ color: INK_SOFT }}>（这次没解析成结构化，先看文字稿）</div>
                                {fauxResult.fallbackText}
                            </PaperCard>
                        )}
                        <div className="text-center text-[10px]" style={{ color: INK_SOFT }}>长按 / 用手机系统截屏即可保存这张图</div>
                        <div className="flex gap-2">
                            <ScrapButton variant="paper" className="flex-1 py-2 text-[12px]" onClick={() => void runFaux()} icon={<ArrowClockwise size={14} weight="bold" />}>再生成</ScrapButton>
                            <ScrapButton variant="ink" className="flex-1 py-2 text-[12px]" onClick={() => void exportFauxToChat()} icon={<PaperPlaneTilt size={14} weight="bold" />}>发到聊天</ScrapButton>
                        </div>
                    </div>
                )}
            </Page>
        );
    }

    // ============ 一次性番外 ============
    if (mode === 'piece') {
        const tab = PIECE_TABS.find(t => t.kind === pieceKind)!;
        return (
            <Page title="番外工坊" en="THE WORKSHOP" onBack={() => { setPiece(''); setMode('home'); }}>
                <CharPicker characters={characters} pickCharId={pickCharId} setPickCharId={setPickCharId} />
                <div className="grid grid-cols-4 gap-2">
                    {PIECE_TABS.map(t => (
                        <button key={t.kind} onClick={() => { setPieceKind(t.kind); setPiece(''); }} className="flex flex-col items-center gap-1 py-2.5 rounded-2xl transition-all active:scale-95" style={tabStyle(pieceKind === t.kind)}>
                            {t.icon}<span className="text-[10px] font-bold">{t.label}</span>
                        </button>
                    ))}
                </div>
                <div className="text-[11px] px-1" style={{ color: '#6b6558' }}>{tab.hint}</div>
                <textarea value={piecePrompt} onChange={e => setPiecePrompt(e.target.value)} placeholder={tab.ph}
                    rows={2} className="w-full rounded-xl px-3 py-2.5 text-sm outline-none resize-none" style={paperInput} />
                <InstructionRow kind={pieceKind} onPick={setPiecePrompt} />
                <ScrapButton variant="ink" className="w-full py-2.5 text-sm" disabled={busy} onClick={() => void runPiece()}>{busy ? '生成中…' : '生成番外'}</ScrapButton>
                {piece && (
                    <PaperCard tilt={-0.4} className="p-4 space-y-3">
                        <div className="text-[13px] leading-relaxed whitespace-pre-wrap" style={{ color: '#3a362f' }}>{piece}</div>
                        <div className="flex gap-2">
                            <ScrapButton variant="paper" className="flex-1 py-2 text-[12px]" onClick={() => void runPiece()} icon={<ArrowClockwise size={14} weight="bold" />}>再生成</ScrapButton>
                            <ScrapButton variant="ink" className="flex-1 py-2 text-[12px]" onClick={() => void exportPieceToChat()} icon={<PaperPlaneTilt size={14} weight="bold" />}>发到聊天</ScrapButton>
                        </div>
                    </PaperCard>
                )}
            </Page>
        );
    }

    // ============ 番外首页 ============
    const ENTRIES: { mode: Mode; name: string; en: string; desc: string; Icon: React.FC<any> }[] = [
        { mode: 'quiz', name: '问卷番外', en: 'THE QUIZ', desc: '恋爱相性100问、MBTI、性癖测试、价值观、无厘头…想要啥写啥。一题一题出，角色答、你也答，做完为止。', Icon: ListChecks },
        { mode: 'piece', name: '番外工坊', en: 'THE WORKSHOP', desc: '求助贴吧帖、群聊天记录、把 TA 套进热梗…围绕角色一键生成一段主题番外，可发回聊天。', Icon: ChatsCircle },
        { mode: 'faux', name: '仿真图文', en: 'FAUX SCREENS', desc: '仿“捡手机”的微信聊天、朋友圈、小红书、匿名论坛吃瓜帖——图文并茂深扒你和 TA，截屏即存。', Icon: ImagesSquare },
    ];
    return (
        <PaperShell>
            <ScrapHeader title="番外" en="SIDE LEAVES" onBack={onExit} backLabel="回戏单" />
            <ScrapScroll className="px-5 pb-10 space-y-4 pt-1">
                <PaperCard tilt={-0.8} tape="ink" className="px-6 py-6 overflow-hidden">
                    <div className="text-[9px] tracking-[0.36em] mb-1.5" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>SIDE LEAVES · 番 外 篇</div>
                    <div className="flex items-end gap-2">
                        <div className="text-[40px] leading-none font-black" style={{ color: INK }}>番外</div>
                        <Scroll size={24} weight="duotone" className="mb-1.5" style={{ color: INK }} />
                    </div>
                    <div className="text-[12px] mt-2.5 leading-relaxed" style={{ color: '#54504a' }}>挑个角色，一起做问卷、看 TA 上贴吧热搜、翻 TA 的聊天记录。</div>
                </PaperCard>

                {ENTRIES.map((e, i) => (
                    <PaperCard key={e.mode} tilt={i % 2 ? 0.6 : -0.6} tape={(['amber', 'sage', 'lilac'] as const)[i]} onClick={() => setMode(e.mode)} className="px-4 py-4 flex items-center gap-3.5">
                        <Stamp size={46}><e.Icon size={24} weight="duotone" /></Stamp>
                        <div className="flex-1 min-w-0">
                            <div className="flex items-baseline gap-2">
                                <div className="text-[19px] font-black" style={{ color: INK }}>{e.name}</div>
                                <div className="text-[8px] tracking-[0.28em] uppercase" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>{e.en}</div>
                            </div>
                            <div className="text-[11px] mt-1 leading-relaxed" style={{ color: '#6b6558' }}>{e.desc}</div>
                        </div>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="M9 6l6 6-6 6" /></svg>
                    </PaperCard>
                ))}
            </ScrapScroll>
        </PaperShell>
    );
};

export default ExtraApp;
