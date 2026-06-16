import React, { useState } from 'react';
import { useOS } from '../../context/OSContext';
import { ArrowLeft, Sparkle, ListChecks, ChatsCircle, Fire, NotePencil, ArrowClockwise, PaperPlaneTilt, WechatLogo, Camera, Megaphone, ImagesSquare } from '@phosphor-icons/react';
import { resolveAuxApi } from '../../utils/auxApi';
import { DB } from '../../utils/db';
import {
    inferQuestionCount, genNextQuestion, genCharAnswer, genExtraPiece, genFauxPiece,
    type ExtraKind, type FauxKind, type FauxResult,
} from '../../utils/theaterExtra';
import { WeChatScreenshot, MomentsCard, XhsCard, ForumThread } from '../../components/theater/faux/FauxRenderers';

/**
 * 小剧场·番外：选一个角色一起做「番外」。
 *  - 问卷番外：输入想要的问卷（恋爱相性100问 / MBTI / 价值观 / 性癖测试 / 无厘头…），
 *    系统一题一题出题，角色作答 + 用户作答，做完为止；
 *  - 贴吧帖 / 聊天记录 / 热梗 / 自定义：围绕角色一次性生成一段主题番外。
 */

interface Props { onExit: () => void; }

type Mode = 'home' | 'quiz' | 'piece' | 'faux';
interface QA { question: string; charAnswer: string; userAnswer: string }

const QUIZ_PRESETS = ['恋爱相性100问', 'MBTI 测试问卷', '性癖测试问卷50问', '价值观问卷', '无厘头问卷50题', '灵魂拷问36问'];

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

const ExtraApp: React.FC<Props> = ({ onExit }) => {
    const { characters, apiConfig, auxApiConfig, userProfile, addToast } = useOS();
    const api = resolveAuxApi(auxApiConfig, apiConfig);
    const apiReady = !!(api.baseUrl && api.model);
    const userName = (userProfile?.name || '').trim() || '你';

    const [mode, setMode] = useState<Mode>('home');
    const [pickCharId, setPickCharId] = useState('');
    const char = characters.find(c => c.id === pickCharId);

    // ── 问卷状态 ──
    const [topic, setTopic] = useState('');
    const [total, setTotal] = useState(50);
    const [items, setItems] = useState<QA[]>([]);
    const [idx, setIdx] = useState(0);
    const [answerInput, setAnswerInput] = useState('');
    const [busy, setBusy] = useState(false);
    const [finished, setFinished] = useState(false);

    // ── 一次性番外状态 ──
    const [pieceKind, setPieceKind] = useState<ExtraKind>('tieba');
    const [piecePrompt, setPiecePrompt] = useState('');
    const [piece, setPiece] = useState('');

    // ── 仿真图文状态 ──
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
        // 发到聊天用文字摘要（仿真 UI 只在 app 内看；聊天里落可读文本）
        const summary = fauxResult.data
            ? JSON.stringify(fauxResult.data, null, 2)
            : fauxResult.fallbackText;
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
        const n = inferQuestionCount(t);
        setTotal(n); setItems([]); setIdx(0); setAnswerInput(''); setFinished(false); setBusy(true);
        try {
            const q = await genNextQuestion({ api, topic: t, index: 0, total: n, asked: [] });
            const a = await genCharAnswer({ api, char, userProfile, topic: t, question: q });
            setItems([{ question: q, charAnswer: a, userAnswer: '' }]);
        } catch (e: any) {
            addToast('出题失败：' + (e?.message || e), 'error');
        } finally { setBusy(false); }
    };

    const nextQuestion = async () => {
        if (!char) return;
        // 先把当前这题的用户作答存下
        const committed = items.map((it, i) => i === idx ? { ...it, userAnswer: answerInput.trim() } : it);
        setItems(committed);
        if (committed.length >= total) { setFinished(true); return; }
        setBusy(true); setAnswerInput('');
        try {
            const asked = committed.map(it => it.question);
            const q = await genNextQuestion({ api, topic, index: committed.length, total, asked });
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

    // ── 角色选择条（问卷/番外页共用） ──
    const CharPicker = () => (
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
            {characters.length === 0 && <div className="text-white/40 text-xs py-2">还没有角色，先去创建一个吧</div>}
            {characters.map(c => (
                <button key={c.id} onClick={() => setPickCharId(c.id)}
                    className={`shrink-0 flex flex-col items-center gap-1 px-2 py-1.5 rounded-2xl border transition-all ${pickCharId === c.id ? 'border-amber-300/60 bg-amber-300/10' : 'border-white/10 bg-white/[0.03]'}`}>
                    <img src={c.avatar} className="w-11 h-11 rounded-full object-cover" alt={c.name} />
                    <span className="text-[10px] text-white/70 max-w-[56px] truncate">{c.name}</span>
                </button>
            ))}
        </div>
    );

    const Header = ({ title, back }: { title: string; back: () => void }) => (
        <div className="relative flex items-center px-4 pt-3 pb-2 shrink-0 z-10">
            <button onClick={back} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-[11px] font-bold bg-white/10 hover:bg-white/15 text-white/80 active:scale-95 transition-all border border-white/10">
                <ArrowLeft size={14} weight="bold" /> 返回
            </button>
            <div className="absolute left-1/2 -translate-x-1/2 text-[11px] tracking-[0.3em] text-white/45 select-none">{title}</div>
        </div>
    );

    // ============ 问卷番外 ============
    if (mode === 'quiz') {
        const cur = items[idx];
        return (
            <div className="absolute inset-0 flex flex-col bg-[#14101c] text-white animate-fade-in overflow-hidden" style={{ paddingTop: 'var(--safe-top)' }}>
                <Header title="问卷番外" back={() => { resetQuiz(); setMode('home'); }} />
                <div className="flex-1 overflow-y-auto no-scrollbar px-5 pb-10 space-y-4 z-10">
                    {items.length === 0 ? (
                        <>
                            <CharPicker />
                            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
                                <div className="text-[13px] text-white/70">想做哪份问卷？市面上的都行——写名字就生成（每份至少 50 题）。</div>
                                <input value={topic} onChange={e => setTopic(e.target.value)} placeholder="如：恋爱相性100问 / 性癖测试50问 / MBTI"
                                    className="w-full bg-black/30 rounded-xl px-3 py-2.5 text-sm outline-none border border-white/10 focus:border-amber-300/40" />
                                <div className="flex flex-wrap gap-1.5">
                                    {QUIZ_PRESETS.map(p => (
                                        <button key={p} onClick={() => setTopic(p)} className="px-2.5 py-1 rounded-full text-[11px] bg-white/[0.06] border border-white/10 text-white/70 active:scale-95">{p}</button>
                                    ))}
                                </div>
                                <button onClick={() => void startQuiz()} disabled={busy}
                                    className="w-full py-2.5 rounded-xl text-sm font-black bg-amber-300/90 text-[#14101c] active:scale-95 disabled:opacity-50">
                                    {busy ? '正在出第一题…' : '开始答题'}
                                </button>
                            </div>
                        </>
                    ) : finished ? (
                        <div className="rounded-2xl border border-amber-300/20 bg-amber-300/[0.06] p-5 space-y-3 text-center">
                            <Sparkle size={30} weight="fill" className="text-amber-300 mx-auto" />
                            <div className="text-lg font-black">做完啦！</div>
                            <div className="text-[12px] text-white/60">和 {char?.name} 一起完成了《{topic}》共 {items.length} 题。</div>
                            <div className="flex gap-2 pt-1">
                                <button onClick={() => void exportQuizToChat()} className="flex-1 py-2.5 rounded-xl text-sm font-bold bg-white/10 active:scale-95 inline-flex items-center justify-center gap-1.5"><PaperPlaneTilt size={16} weight="bold" />发到聊天</button>
                                <button onClick={() => { resetQuiz(); }} className="flex-1 py-2.5 rounded-xl text-sm font-bold bg-amber-300/90 text-[#14101c] active:scale-95">再来一份</button>
                            </div>
                        </div>
                    ) : cur ? (
                        <>
                            {/* 进度 */}
                            <div className="flex items-center gap-2">
                                <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                                    <div className="h-full bg-amber-300/80" style={{ width: `${Math.round((idx / total) * 100)}%` }} />
                                </div>
                                <span className="text-[11px] text-white/50 tabular-nums">{idx + 1}/{total}</span>
                            </div>
                            {/* 题目 */}
                            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                                <div className="text-[10px] tracking-widest text-amber-300/70 font-mono mb-1.5">Q{idx + 1} · {topic}</div>
                                <div className="text-[15px] font-bold leading-relaxed">{cur.question}</div>
                            </div>
                            {/* 角色作答 */}
                            <div className="rounded-2xl border border-rose-300/15 bg-rose-500/[0.06] p-4">
                                <div className="flex items-center justify-between mb-1.5">
                                    <div className="flex items-center gap-2">
                                        {char && <img src={char.avatar} className="w-6 h-6 rounded-full object-cover" alt="" />}
                                        <span className="text-[12px] font-bold text-rose-100">{char?.name} 的回答</span>
                                    </div>
                                    <button onClick={() => void regenCharAnswer()} disabled={busy} className="text-rose-200/70 active:scale-90 disabled:opacity-40" title="让 TA 重答">
                                        <ArrowClockwise size={15} weight="bold" />
                                    </button>
                                </div>
                                <div className="text-[13px] text-white/80 leading-relaxed whitespace-pre-wrap">{busy && !cur.charAnswer ? '思考中…' : cur.charAnswer}</div>
                            </div>
                            {/* 用户作答 */}
                            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                                <div className="text-[12px] font-bold text-white/70 mb-1.5">{userName} 的回答</div>
                                <textarea value={answerInput} onChange={e => setAnswerInput(e.target.value)} placeholder="也写下你的答案…（可留空）"
                                    rows={2} className="w-full bg-black/30 rounded-xl px-3 py-2 text-sm outline-none border border-white/10 focus:border-amber-300/40 resize-none" />
                            </div>
                            <button onClick={() => void nextQuestion()} disabled={busy}
                                className="w-full py-2.5 rounded-xl text-sm font-black bg-amber-300/90 text-[#14101c] active:scale-95 disabled:opacity-50">
                                {busy ? '出下一题…' : (items.length >= total ? '完成' : '下一题')}
                            </button>
                        </>
                    ) : null}
                </div>
            </div>
        );
    }

    // ============ 仿真图文番外（微信/朋友圈/小红书/论坛） ============
    if (mode === 'faux') {
        const tab = FAUX_TABS.find(t => t.kind === fauxKind)!;
        const d = fauxResult?.data;
        return (
            <div className="absolute inset-0 flex flex-col bg-[#14101c] text-white animate-fade-in overflow-hidden" style={{ paddingTop: 'var(--safe-top)' }}>
                <Header title="仿真图文" back={() => { setFauxResult(null); setMode('home'); }} />
                <div className="flex-1 overflow-y-auto no-scrollbar px-5 pb-10 space-y-4 z-10">
                    <CharPicker />
                    <div className="grid grid-cols-4 gap-2">
                        {FAUX_TABS.map(t => (
                            <button key={t.kind} onClick={() => { setFauxKind(t.kind); setFauxResult(null); }}
                                className={`flex flex-col items-center gap-1 py-2.5 rounded-2xl border transition-all ${fauxKind === t.kind ? 'border-amber-300/60 bg-amber-300/10 text-amber-100' : 'border-white/10 bg-white/[0.03] text-white/60'}`}>
                                {t.icon}<span className="text-[10px] font-bold">{t.label}</span>
                            </button>
                        ))}
                    </div>
                    <div className="text-[11px] text-white/45 px-1">{tab.hint}</div>
                    <textarea value={fauxKeyword} onChange={e => setFauxKeyword(e.target.value)} placeholder={tab.ph}
                        rows={2} className="w-full bg-black/30 rounded-xl px-3 py-2.5 text-sm outline-none border border-white/10 focus:border-amber-300/40 resize-none" />
                    <button onClick={() => void runFaux()} disabled={busy}
                        className="w-full py-2.5 rounded-xl text-sm font-black bg-amber-300/90 text-[#14101c] active:scale-95 disabled:opacity-50">
                        {busy ? '生成中…' : '生成仿真图文'}
                    </button>

                    {fauxResult && (
                        <div className="space-y-3">
                            {/* 仿真渲染；解析失败回退纯文本 */}
                            {d && fauxKind === 'wechat' && <WeChatScreenshot data={d} charAvatar={char?.avatar} userAvatar={userProfile?.avatar} />}
                            {d && fauxKind === 'moments' && <MomentsCard data={d} avatar={char?.avatar} />}
                            {d && fauxKind === 'xhs' && <XhsCard data={d} />}
                            {d && fauxKind === 'forum' && <ForumThread data={d} />}
                            {!d && (
                                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-[13px] text-white/80 leading-relaxed whitespace-pre-wrap">
                                    <div className="text-[10px] text-amber-200/60 mb-1.5">（这次没解析成结构化，先看文字稿）</div>
                                    {fauxResult.fallbackText}
                                </div>
                            )}
                            <div className="text-center text-[10px] text-white/35">长按 / 用手机系统截屏即可保存这张图</div>
                            <div className="flex gap-2">
                                <button onClick={() => void runFaux()} className="flex-1 py-2 rounded-xl text-[12px] font-bold bg-white/10 active:scale-95 inline-flex items-center justify-center gap-1.5"><ArrowClockwise size={14} weight="bold" />再生成</button>
                                <button onClick={() => void exportFauxToChat()} className="flex-1 py-2 rounded-xl text-[12px] font-bold bg-amber-300/90 text-[#14101c] active:scale-95 inline-flex items-center justify-center gap-1.5"><PaperPlaneTilt size={14} weight="bold" />发到聊天</button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // ============ 一次性番外（贴吧/聊天记录/热梗/自定义） ============
    if (mode === 'piece') {
        const tab = PIECE_TABS.find(t => t.kind === pieceKind)!;
        return (
            <div className="absolute inset-0 flex flex-col bg-[#14101c] text-white animate-fade-in overflow-hidden" style={{ paddingTop: 'var(--safe-top)' }}>
                <Header title="番外工坊" back={() => { setPiece(''); setMode('home'); }} />
                <div className="flex-1 overflow-y-auto no-scrollbar px-5 pb-10 space-y-4 z-10">
                    <CharPicker />
                    <div className="grid grid-cols-4 gap-2">
                        {PIECE_TABS.map(t => (
                            <button key={t.kind} onClick={() => { setPieceKind(t.kind); setPiece(''); }}
                                className={`flex flex-col items-center gap-1 py-2.5 rounded-2xl border transition-all ${pieceKind === t.kind ? 'border-amber-300/60 bg-amber-300/10 text-amber-100' : 'border-white/10 bg-white/[0.03] text-white/60'}`}>
                                {t.icon}<span className="text-[10px] font-bold">{t.label}</span>
                            </button>
                        ))}
                    </div>
                    <div className="text-[11px] text-white/45 px-1">{tab.hint}</div>
                    <textarea value={piecePrompt} onChange={e => setPiecePrompt(e.target.value)} placeholder={tab.ph}
                        rows={2} className="w-full bg-black/30 rounded-xl px-3 py-2.5 text-sm outline-none border border-white/10 focus:border-amber-300/40 resize-none" />
                    <button onClick={() => void runPiece()} disabled={busy}
                        className="w-full py-2.5 rounded-xl text-sm font-black bg-amber-300/90 text-[#14101c] active:scale-95 disabled:opacity-50">
                        {busy ? '生成中…' : '生成番外'}
                    </button>
                    {piece && (
                        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 space-y-3">
                            <div className="text-[13px] text-white/85 leading-relaxed whitespace-pre-wrap">{piece}</div>
                            <div className="flex gap-2">
                                <button onClick={() => void runPiece()} className="flex-1 py-2 rounded-xl text-[12px] font-bold bg-white/10 active:scale-95 inline-flex items-center justify-center gap-1.5"><ArrowClockwise size={14} weight="bold" />再生成</button>
                                <button onClick={() => void exportPieceToChat()} className="flex-1 py-2 rounded-xl text-[12px] font-bold bg-amber-300/90 text-[#14101c] active:scale-95 inline-flex items-center justify-center gap-1.5"><PaperPlaneTilt size={14} weight="bold" />发到聊天</button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // ============ 番外首页 ============
    return (
        <div className="absolute inset-0 flex flex-col bg-[#14101c] text-white animate-fade-in overflow-hidden" style={{ paddingTop: 'var(--safe-top)' }}>
            <div aria-hidden className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-[140%] h-72 rounded-full blur-3xl opacity-40 bg-gradient-to-b from-amber-400/50 via-rose-500/20 to-transparent" />
            <Header title="番外 · SIDE STORY" back={onExit} />
            <div className="flex-1 overflow-y-auto no-scrollbar px-5 pb-10 space-y-5 pt-2 z-10">
                <div className="relative rounded-3xl px-7 py-7 overflow-hidden border border-white/10 bg-gradient-to-br from-white/[0.08] to-white/[0.02] shadow-2xl">
                    <div className="text-[9px] tracking-[0.3em] text-amber-300/70 font-mono mb-2">SIDE STORY · 番外</div>
                    <div className="text-4xl font-black tracking-wide bg-clip-text text-transparent bg-gradient-to-r from-amber-200 via-rose-200 to-amber-300">番外</div>
                    <div className="text-[12px] text-white/55 mt-2 leading-relaxed">挑个角色，一起做问卷、看 TA 上贴吧热搜、翻 TA 的聊天记录。</div>
                </div>

                <button onClick={() => setMode('quiz')}
                    className="relative w-full text-left rounded-3xl px-7 py-8 overflow-hidden border border-amber-300/15 bg-gradient-to-br from-amber-500/15 to-rose-500/[0.07] active:scale-[0.98] transition-transform shadow-lg">
                    <div className="text-[9px] tracking-[0.3em] text-amber-200/70 font-mono mb-2">QUIZ — 一起答题</div>
                    <div className="flex items-center gap-2.5">
                        <ListChecks size={26} weight="bold" className="text-amber-200/90" />
                        <div className="text-3xl font-black tracking-wide text-amber-50">问卷番外</div>
                    </div>
                    <div className="text-[11px] text-white/55 mt-3 leading-relaxed">恋爱相性100问、MBTI、性癖测试、价值观、无厘头…想要啥写啥。系统一题一题出，角色答、你也答，做完为止。</div>
                </button>

                <button onClick={() => { setMode('piece'); }}
                    className="relative w-full text-left rounded-3xl px-7 py-8 overflow-hidden border border-rose-300/15 bg-gradient-to-br from-rose-500/15 to-fuchsia-500/[0.07] active:scale-[0.98] transition-transform shadow-lg">
                    <div className="text-[9px] tracking-[0.3em] text-rose-200/70 font-mono mb-2">WORKSHOP — 主题番外</div>
                    <div className="flex items-center gap-2.5">
                        <ChatsCircle size={26} weight="bold" className="text-rose-200/90" />
                        <div className="text-3xl font-black tracking-wide text-rose-50">番外工坊</div>
                    </div>
                    <div className="text-[11px] text-white/55 mt-3 leading-relaxed">求助贴吧帖、群聊天记录、把 TA 套进热梗…围绕角色一键生成一段主题番外，可发回聊天。</div>
                </button>

                <button onClick={() => { setMode('faux'); }}
                    className="relative w-full text-left rounded-3xl px-7 py-8 overflow-hidden border border-emerald-300/15 bg-gradient-to-br from-emerald-500/15 to-teal-500/[0.07] active:scale-[0.98] transition-transform shadow-lg">
                    <div className="text-[9px] tracking-[0.3em] text-emerald-200/70 font-mono mb-2">FAUX — 仿真图文</div>
                    <div className="flex items-center gap-2.5">
                        <ImagesSquare size={26} weight="bold" className="text-emerald-200/90" />
                        <div className="text-3xl font-black tracking-wide text-emerald-50">仿真图文</div>
                    </div>
                    <div className="text-[11px] text-white/55 mt-3 leading-relaxed">仿“捡手机”的微信聊天记录、朋友圈、小红书图文、匿名论坛吃瓜帖——图文并茂、深扒你和 TA 的八卦，截屏即可保存。</div>
                </button>
            </div>
        </div>
    );
};

export default ExtraApp;
