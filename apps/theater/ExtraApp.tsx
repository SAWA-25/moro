import React, { useState } from 'react';
import { useOS } from '../../context/OSContext';
import { ListChecks, ChatsCircle, Fire, NotePencil, ArrowClockwise, PaperPlaneTilt, Sparkle, ListBullets } from '@phosphor-icons/react';
import { resolveAuxApi } from '../../utils/auxApi';
import { DB } from '../../utils/db';
import {
    inferQuestionCount, genNextQuestion, genCharAnswer, genExtraPiece, type ExtraKind,
} from '../../utils/theaterExtra';
import {
    PaperShell, ScrapScroll, ScrapHeader, PaperCard, Polaroid, WashiTape, Stamp, SectionTag,
    WASHI, INK, INK_SOFT, type WashiColor,
} from './scrapbook';

/**
 * 小剧场·番外：选一个角色一起做「番外」。
 *  - 问卷番外：输入想要的问卷（恋爱相性100问 / MBTI / 价值观 / 性癖测试 / 无厘头…），
 *    系统一题一题出题，角色作答 + 用户作答，做完为止；
 *  - 贴吧帖 / 聊天记录 / 热梗 / 自定义：围绕角色一次性生成一段主题番外。
 *
 * 界面＝拼贴手账「剪贴册」：问卷像一页页答题卡，主题番外像贴进册子的剪报。
 */

interface Props { onExit: () => void; }

type Mode = 'home' | 'quiz' | 'piece';
interface QA { question: string; charAnswer: string; userAnswer: string }

const QUIZ_PRESETS = ['恋爱相性100问', 'MBTI 测试问卷', '性癖测试问卷50问', '价值观问卷', '无厘头问卷50题', '灵魂拷问36问'];

const PIECE_TABS: { kind: ExtraKind; label: string; icon: React.ReactNode; color: WashiColor; hint: string; ph: string }[] = [
    { kind: 'tieba', label: '贴吧帖', icon: <ChatsCircle size={18} weight="bold" />, color: 'sky', hint: '以 TA 为话题的求助/讨论帖 + 网友回复', ph: '想发什么帖？（如：求助 TA 最近好奇怪 / 这角色到底什么来头）' },
    { kind: 'chatlog', label: '聊天记录', icon: <NotePencil size={18} weight="bold" />, color: 'sage', hint: '围绕 TA 的一段群聊/对话截图文字稿', ph: '聊天背景（如：群里突然聊到 TA / 闺蜜八卦）' },
    { kind: 'meme', label: '热梗', icon: <Fire size={18} weight="bold" />, color: 'rose', hint: '把 TA 套进当下流行梗里', ph: '想玩哪方面的梗？（留空＝TA 的性格名场面）' },
    { kind: 'custom', label: '自定义', icon: <Sparkle size={18} weight="bold" />, color: 'lilac', hint: '你说要什么番外，就写什么', ph: '描述你想要的番外…' },
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

    // ── 选人：拍立得横排 ──
    const CharStrip = () => (
        <div>
            <SectionTag en="WITH" color="rose" className="mb-2.5">和谁一起</SectionTag>
            <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1.5 px-0.5">
                {characters.length === 0 && <div className="text-[12px] py-3" style={{ color: INK_SOFT }}>还没有角色，先去创建一个吧</div>}
                {characters.map((c, i) => (
                    <Polaroid key={c.id} src={c.avatar} caption={c.name} size={52} rotate={i % 2 ? 1.8 : -2} selected={pickCharId === c.id} onClick={() => setPickCharId(c.id)} />
                ))}
            </div>
        </div>
    );

    // ============ 问卷番外 ============
    if (mode === 'quiz') {
        const cur = items[idx];
        return (
            <PaperShell>
                <ScrapHeader title="问卷番外" en="QUIZ" onBack={() => { resetQuiz(); setMode('home'); }} backLabel="番外" />
                <ScrapScroll className="px-5 pb-12 pt-1 space-y-4">
                    {items.length === 0 ? (
                        <>
                            <CharStrip />
                            <PaperCard tilt={-0.5} tape="amber" className="p-4 space-y-3">
                                <div className="text-[13px]" style={{ color: '#6b6456' }}>想做哪份问卷？市面上的都行——写名字就生成（每份至少 50 题）。</div>
                                <input value={topic} onChange={e => setTopic(e.target.value)} placeholder="如：恋爱相性100问 / 性癖测试50问 / MBTI"
                                    className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={inputStyle} />
                                <div className="flex flex-wrap gap-1.5">
                                    {QUIZ_PRESETS.map(p => (
                                        <button key={p} onClick={() => setTopic(p)} className="px-2.5 py-1 rounded-full text-[11px] font-bold active:scale-95" style={{ background: WASHI.butter.base, color: WASHI.butter.ink }}>{p}</button>
                                    ))}
                                </div>
                                <button onClick={() => void startQuiz()} disabled={busy} className="w-full py-2.5 rounded-full text-sm font-black active:scale-95 disabled:opacity-50" style={inkBtn}>
                                    {busy ? '正在出第一题…' : '✎ 开始答题'}
                                </button>
                            </PaperCard>
                        </>
                    ) : finished ? (
                        <PaperCard tilt={-0.6} tape="rose" pin className="p-6 space-y-3 text-center">
                            <div className="text-4xl select-none">🎉</div>
                            <div className="text-[19px] font-black" style={{ color: INK }}>做完啦！</div>
                            <div className="text-[12px]" style={{ color: '#6b6456' }}>和 {char?.name} 一起完成了《{topic}》共 {items.length} 题。</div>
                            <div className="flex gap-2 pt-1">
                                <button onClick={() => void exportQuizToChat()} className="flex-1 py-2.5 rounded-full text-sm font-black active:scale-95 inline-flex items-center justify-center gap-1.5" style={paperBtn}><PaperPlaneTilt size={16} weight="bold" />发到聊天</button>
                                <button onClick={() => { resetQuiz(); }} className="flex-1 py-2.5 rounded-full text-sm font-black active:scale-95" style={inkBtn}>再来一份</button>
                            </div>
                        </PaperCard>
                    ) : cur ? (
                        <>
                            {/* 进度：手缝针脚 */}
                            <div className="flex items-center gap-2.5">
                                <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'rgba(176,162,138,0.3)' }}>
                                    <div className="h-full rounded-full" style={{ width: `${Math.round((idx / total) * 100)}%`, background: '#3a3630', backgroundImage: 'repeating-linear-gradient(90deg, rgba(255,255,255,0.25) 0 3px, transparent 3px 7px)' }} />
                                </div>
                                <span className="text-[11px] font-black tabular-nums" style={{ color: INK_SOFT }}>{idx + 1}/{total}</span>
                            </div>
                            {/* 题目 */}
                            <PaperCard tilt={-0.5} className="p-4">
                                <div className="text-[10px] tracking-widest mb-1.5" style={{ fontFamily: 'var(--font-label)', color: WASHI.amber.ink }}>Q{idx + 1} · {topic}</div>
                                <div className="text-[15px] font-black leading-relaxed" style={{ color: INK }}>{cur.question}</div>
                            </PaperCard>
                            {/* 角色作答 */}
                            <PaperCard tilt={0.5} tape="rose" className="p-4">
                                <div className="flex items-center justify-between mb-1.5">
                                    <div className="flex items-center gap-2">
                                        {char && <img src={char.avatar} className="w-6 h-6 rounded-full object-cover" alt="" />}
                                        <span className="text-[12px] font-black" style={{ color: WASHI.rose.ink }}>{char?.name} 的回答</span>
                                    </div>
                                    <button onClick={() => void regenCharAnswer()} disabled={busy} className="active:scale-90 disabled:opacity-40" style={{ color: WASHI.rose.ink }} title="让 TA 重答">
                                        <ArrowClockwise size={15} weight="bold" />
                                    </button>
                                </div>
                                <div className="text-[13px] leading-relaxed whitespace-pre-wrap" style={{ color: '#5b5346' }}>{busy && !cur.charAnswer ? '思考中…' : cur.charAnswer}</div>
                            </PaperCard>
                            {/* 用户作答 */}
                            <PaperCard tilt={-0.4} className="p-4">
                                <div className="text-[12px] font-black mb-1.5" style={{ color: '#6b6456' }}>{userName} 的回答</div>
                                <textarea value={answerInput} onChange={e => setAnswerInput(e.target.value)} placeholder="也写下你的答案…（可留空）"
                                    rows={2} className="w-full rounded-xl px-3 py-2 text-sm outline-none resize-none" style={inputStyle} />
                            </PaperCard>
                            <button onClick={() => void nextQuestion()} disabled={busy} className="w-full py-2.5 rounded-full text-sm font-black active:scale-95 disabled:opacity-50" style={inkBtn}>
                                {busy ? '出下一题…' : (items.length >= total ? '完成 ✓' : '下一题 →')}
                            </button>
                        </>
                    ) : null}
                </ScrapScroll>
            </PaperShell>
        );
    }

    // ============ 一次性番外（贴吧/聊天记录/热梗/自定义） ============
    if (mode === 'piece') {
        const tab = PIECE_TABS.find(t => t.kind === pieceKind)!;
        return (
            <PaperShell>
                <ScrapHeader title="番外工坊" en="WORKSHOP" onBack={() => { setPiece(''); setMode('home'); }} backLabel="番外" />
                <ScrapScroll className="px-5 pb-12 pt-1 space-y-4">
                    <CharStrip />
                    <div className="grid grid-cols-4 gap-2.5">
                        {PIECE_TABS.map(t => {
                            const on = pieceKind === t.kind;
                            return (
                                <button key={t.kind} onClick={() => { setPieceKind(t.kind); setPiece(''); }}
                                    className="flex flex-col items-center gap-1.5 py-3 rounded-xl active:scale-95 transition-transform"
                                    style={on ? { background: '#3a3630', color: '#fcf8ef', boxShadow: '0 10px 18px -12px rgba(58,54,48,0.6)' } : { background: 'rgba(255,253,247,0.96)', color: '#6b6456', border: '1px solid rgba(196,184,160,0.8)' }}>
                                    {t.icon}<span className="text-[10px] font-black">{t.label}</span>
                                </button>
                            );
                        })}
                    </div>
                    <div className="text-[11px] px-1" style={{ color: INK_SOFT }}>{tab.hint}</div>
                    <textarea value={piecePrompt} onChange={e => setPiecePrompt(e.target.value)} placeholder={tab.ph}
                        rows={2} className="w-full rounded-xl px-3 py-2.5 text-sm outline-none resize-none" style={inputStyle} />
                    <button onClick={() => void runPiece()} disabled={busy} className="w-full py-2.5 rounded-full text-sm font-black active:scale-95 disabled:opacity-50" style={inkBtn}>
                        {busy ? '生成中…' : '✂ 生成番外'}
                    </button>
                    {piece && (
                        <PaperCard tilt={-0.5} tape={tab.color} className="p-4 space-y-3">
                            <div className="text-[13px] leading-relaxed whitespace-pre-wrap" style={{ color: '#5b5346' }}>{piece}</div>
                            <div className="flex gap-2">
                                <button onClick={() => void runPiece()} className="flex-1 py-2 rounded-full text-[12px] font-black active:scale-95 inline-flex items-center justify-center gap-1.5" style={paperBtn}><ArrowClockwise size={14} weight="bold" />再生成</button>
                                <button onClick={() => void exportPieceToChat()} className="flex-1 py-2 rounded-full text-[12px] font-black active:scale-95 inline-flex items-center justify-center gap-1.5" style={inkBtn}><PaperPlaneTilt size={14} weight="bold" />发到聊天</button>
                            </div>
                        </PaperCard>
                    )}
                </ScrapScroll>
            </PaperShell>
        );
    }

    // ============ 番外首页 ============
    return (
        <PaperShell>
            <ScrapHeader title="番外" en="SIDE STORY" onBack={onExit} backLabel="回小剧场" />
            <ScrapScroll className="px-5 pb-12 pt-1 space-y-5">
                <PaperCard tilt={-0.6} className="px-6 py-6 relative overflow-hidden">
                    <WashiTape color="amber" rotate={-18} className="absolute -top-3 -left-4 w-20 h-6 rounded-[2px]" />
                    <div className="flex items-end gap-2.5">
                        <span className="text-[40px] font-black leading-none" style={{ color: INK }}>番外</span>
                        <span aria-hidden className="text-2xl -mb-0.5 -rotate-6 select-none">📎</span>
                    </div>
                    <div className="leading-none mt-1.5" style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 18, color: '#8a7c5e' }}>Side Story</div>
                    <p className="text-[12px] leading-relaxed mt-3" style={{ color: '#6b6456' }}>挑个角色，一起做问卷、看 TA 上贴吧热搜、翻 TA 的聊天记录——剪下来贴进册子。</p>
                </PaperCard>

                <ProgramCard onClick={() => setMode('quiz')} color="amber" icon={<ListChecks size={22} weight="bold" />} cn="问卷番外" en="QUIZ — 一起答题" tilt={0.8}
                    desc="恋爱相性100问、MBTI、性癖测试、价值观、无厘头…想要啥写啥。系统一题一题出，角色答、你也答，做完为止。" />
                <ProgramCard onClick={() => setMode('piece')} color="sky" icon={<ListBullets size={22} weight="bold" />} cn="番外工坊" en="WORKSHOP — 主题番外" tilt={-0.9}
                    desc="求助贴吧帖、群聊天记录、把 TA 套进热梗…围绕角色一键生成一段主题番外，可发回聊天。" />
            </ScrapScroll>
        </PaperShell>
    );
};

const ProgramCard: React.FC<{ onClick: () => void; color: WashiColor; icon: React.ReactNode; cn: string; en: string; desc: string; tilt: number }> = ({ onClick, color, icon, cn, en, desc, tilt }) => (
    <PaperCard onClick={onClick} tilt={tilt} tape={color} className="px-5 py-5">
        <div className="text-[9px] tracking-[0.3em] uppercase mb-1.5" style={{ fontFamily: 'var(--font-label)', color: WASHI[color].ink }}>{en}</div>
        <div className="flex items-center gap-2.5">
            <Stamp color={color} size={38}>{icon}</Stamp>
            <span className="text-[24px] font-black tracking-wide" style={{ color: INK }}>{cn}</span>
        </div>
        <p className="text-[11.5px] leading-relaxed mt-2.5" style={{ color: '#6b6456' }}>{desc}</p>
    </PaperCard>
);

const inputStyle: React.CSSProperties = { background: '#fffdf8', border: '1px solid rgba(196,184,160,0.8)', color: INK };
const inkBtn: React.CSSProperties = { background: '#3a3630', color: '#fcf8ef', outline: '1px dashed rgba(255,255,255,0.3)', outlineOffset: -4, boxShadow: '0 12px 22px -12px rgba(58,54,48,0.6)' };
const paperBtn: React.CSSProperties = { background: 'rgba(255,253,247,0.96)', color: '#3a3630', border: '1px solid rgba(196,184,160,0.85)' };

export default ExtraApp;
