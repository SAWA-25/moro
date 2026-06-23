import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useOS } from '../../context/OSContext';
import { ArrowsClockwise, Trash, PaperPlaneRight, Sparkle } from '@phosphor-icons/react';
import { TruthDareSession, TruthDarePlayer, TruthDareKind, TruthDareSpice } from '../../types';
import { DB } from '../../utils/db';
import { resolveAuxApi } from '../../utils/auxApi';
import {
    TD_KIND_CN, TD_KIND_EMOJI, TD_SPICE_LABEL, TD_SPICE_DESC, USER_ID,
    createTruthDareSession, playerById, spinBottle, pickPoser,
    genUserChallenge, genCharRound, genCharAnswer,
} from '../../utils/theaterTruthDare';
import { PaperShell, ScrapScroll, ScrapHeader, Polaroid, ScrapButton, SectionTag, PaperCard, WashiTape, INK, INK_SOFT } from './scrapbook';

/**
 * 折子戏·真心话大冒险（玖）：和角色们围一圈转瓶子。
 * 转瓶子选受题者 → 挑真心话 / 大冒险 → 另一人出题 → 受题者作答。
 * user 与 AI 都能受题 / 出题；AI 贴人设玩，尺度可调（轻松 / 暧昧 / 大胆）。黑白拼贴手账皮肤。
 */

interface Props { onExit: () => void; }

type Phase = 'idle' | 'userPick' | 'userAnswer' | 'charChoice' | 'userPose';

const SPICES: TruthDareSpice[] = ['light', 'flirty', 'bold'];

const TruthDareApp: React.FC<Props> = ({ onExit }) => {
    const { characters, apiConfig, auxApiConfig, userProfile, addToast } = useOS();
    const api = resolveAuxApi(auxApiConfig, apiConfig);
    const apiReady = !!(api.baseUrl && api.model);

    const [view, setView] = useState<'home' | 'play'>('home');
    const [history, setHistory] = useState<TruthDareSession[]>([]);
    const [picked, setPicked] = useState<Set<string>>(new Set());
    const [spice, setSpice] = useState<TruthDareSpice>('flirty');

    const [session, setSession] = useState<TruthDareSession | null>(null);
    const [phase, setPhase] = useState<Phase>('idle');
    const [busy, setBusy] = useState(false);
    const [spinning, setSpinning] = useState(false);
    const [error, setError] = useState('');

    // 当前回合的临时态
    const [target, setTarget] = useState<TruthDarePlayer | null>(null);
    const [pendingKind, setPendingKind] = useState<TruthDareKind | null>(null);
    const [pendingPoser, setPendingPoser] = useState<TruthDarePlayer | null>(null);
    const [pendingChallenge, setPendingChallenge] = useState('');
    const [userAnswer, setUserAnswer] = useState('');
    const [userPoseKind, setUserPoseKind] = useState<TruthDareKind>('truth');
    const [userPoseText, setUserPoseText] = useState('');

    const feedRef = useRef<HTMLDivElement>(null);
    const spinTimer = useRef<number | null>(null);

    const reload = useCallback(async () => { setHistory(await DB.getAllTruthDareSessions().catch(() => [])); }, []);
    useEffect(() => { void reload(); }, [reload]);
    useEffect(() => { if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight; }, [session?.rounds.length, phase, busy]);
    useEffect(() => () => { if (spinTimer.current) window.clearTimeout(spinTimer.current); }, []);

    const userName = (userProfile?.name || '').trim() || '你';
    const clone = (s: TruthDareSession): TruthDareSession => ({ ...s, lastActiveAt: Date.now(), players: s.players.map(p => ({ ...p })), rounds: [...s.rounds] });
    const commit = (s: TruthDareSession) => { setSession(s); void DB.saveTruthDareSession(s).catch(() => {}); };

    const resetRound = () => {
        setTarget(null); setPendingKind(null); setPendingPoser(null); setPendingChallenge('');
        setUserAnswer(''); setUserPoseText(''); setUserPoseKind('truth'); setPhase('idle');
    };

    // ── 开局 / 历史 ──
    const startGame = () => {
        if (!apiReady) { addToast('还没配置 API，去「文具盒」填好再来', 'error'); return; }
        const chosen = characters.filter(c => picked.has(c.id));
        if (chosen.length < 1) { addToast('至少拉 1 个角色一起玩', 'info'); return; }
        if (chosen.length > 6) { addToast('一圈最多 6 个角色（加你共 7 人）', 'info'); return; }
        const s = createTruthDareSession(userName, userProfile?.avatar, chosen, spice);
        commit(s); setView('play'); resetRound(); setError('');
    };
    const resumeGame = (s: TruthDareSession) => { setSession(s); setView('play'); resetRound(); setError(''); };
    const deleteGame = async (id: string) => { await DB.deleteTruthDareSession(id); await reload(); if (session?.id === id) { setSession(null); setView('home'); } };

    const recordRound = (s: TruthDareSession, r: { target: TruthDarePlayer; kind: TruthDareKind; poser: TruthDarePlayer; challenge: string; answer: string }) => {
        const next = clone(s);
        next.rounds.push({
            no: next.rounds.length + 1, targetId: r.target.id, targetName: r.target.name,
            kind: r.kind, poserId: r.poser.id, poserName: r.poser.name, challenge: r.challenge, answer: r.answer, at: Date.now(),
        });
        commit(next);
        resetRound();
    };

    // ── 转瓶子 ──
    const spin = () => {
        if (!session || busy || spinning) return;
        setError(''); resetRound(); setSpinning(true);
        spinTimer.current = window.setTimeout(() => {
            const t = spinBottle(session);
            setTarget(t); setSpinning(false);
            setPhase(t.isUser ? 'userPick' : 'charChoice');
        }, 850);
    };

    // ── user 受题：挑真心话/大冒险 → 角色出题 ──
    const userPickKind = async (kind: TruthDareKind) => {
        if (!session) return;
        const poser = pickPoser(session, USER_ID, true);
        setPendingKind(kind); setPendingPoser(poser); setBusy(true);
        try {
            const ch = await genUserChallenge(session, poser, kind, api, characters, userProfile);
            setPendingChallenge(ch); setPhase('userAnswer');
        } catch (e: any) { setError(e?.message || String(e)); } finally { setBusy(false); }
    };
    const submitUserAnswer = () => {
        if (!session || !target || !pendingKind || !pendingPoser) return;
        const ans = userAnswer.trim() || '（我笑着糊弄了过去～）';
        recordRound(session, { target, kind: pendingKind, poser: pendingPoser, challenge: pendingChallenge, answer: ans });
    };

    // ── 角色受题：让大家出题（AI 整轮）/ 我来出题 ──
    const charAutoRound = async () => {
        if (!session || !target) return;
        const poser = pickPoser(session, target.id, true);
        setBusy(true);
        try {
            const r = await genCharRound(session, target, poser, api, characters, userProfile);
            recordRound(session, { target, kind: r.kind, poser, challenge: r.challenge, answer: r.answer });
        } catch (e: any) { setError(e?.message || String(e)); } finally { setBusy(false); }
    };
    const submitUserPose = async () => {
        if (!session || !target) return;
        const challenge = userPoseText.trim();
        if (!challenge) { addToast('先写下你要出的题', 'info'); return; }
        setBusy(true);
        try {
            const ans = await genCharAnswer(session, target, userPoseKind, challenge, api, characters, userProfile);
            const userP = playerById(session, USER_ID)!;
            recordRound(session, { target, kind: userPoseKind, poser: userP, challenge, answer: ans });
        } catch (e: any) { setError(e?.message || String(e)); } finally { setBusy(false); }
    };

    // ════════════════════════ 渲染 ════════════════════════
    if (view === 'home') return renderHome();
    if (!session) { setView('home'); return null; }
    return renderPlay(session);

    function renderHome() {
        const canStart = picked.size >= 1 && picked.size <= 6;
        return (
            <PaperShell>
                <ScrapHeader title="真心话大冒险" en="TRUTH OR DARE" onBack={onExit} backLabel="回戏单" />
                <ScrapScroll className="px-5 pb-10">
                    <div className="text-center mt-2 mb-5 select-none">
                        <div className="text-[34px]">🍾</div>
                        <div className="text-[26px] font-black mt-1" style={{ color: INK }}>真心话大冒险</div>
                        <div className="text-[12px] mt-1.5 leading-relaxed" style={{ color: '#6b6558' }}>和角色们围一圈转瓶子。<br />瓶口指向谁，谁就挑一个：真心话，还是大冒险？</div>
                    </div>

                    {!apiReady && (
                        <PaperCard tilt={-0.5} className="px-4 py-3 mb-5 text-[12px]" style={{ color: '#7a3b2e' }}>
                            还没配置 API。去「文具盒」填好主/副 API，角色才能出题、作答。
                        </PaperCard>
                    )}

                    <SectionTag en="WHO" className="mb-3">拉谁一起玩（1–6 位）</SectionTag>
                    {characters.length === 0 ? (
                        <div className="text-[12px] py-4" style={{ color: INK_SOFT }}>还没有角色，先去创建一个吧。</div>
                    ) : (
                        <div className="flex flex-wrap gap-3.5 pb-1">
                            {characters.map((c, i) => (
                                <Polaroid key={c.id} src={c.avatar} caption={c.name} size={56} rotate={i % 2 ? 1.5 : -1.5}
                                    selected={picked.has(c.id)} grayscale
                                    onClick={() => setPicked(prev => { const n = new Set(prev); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; })} />
                            ))}
                        </div>
                    )}

                    <SectionTag en="SPICE" className="mt-6 mb-3">尺度</SectionTag>
                    <div className="flex gap-2">
                        {SPICES.map(sp => {
                            const on = spice === sp;
                            return (
                                <button key={sp} onClick={() => setSpice(sp)} className="flex-1 px-2 py-2.5 rounded-xl text-center transition active:scale-95" style={{
                                    background: on ? '#1f1d1a' : 'rgba(255,253,247,0.9)', color: on ? '#f6f3ec' : '#5b554a',
                                    border: on ? 'none' : '1px solid rgba(176,170,158,0.7)',
                                }}>
                                    <div className="text-[13px] font-black">{TD_SPICE_LABEL[sp]}</div>
                                    <div className="text-[9px] mt-0.5 leading-tight" style={{ color: on ? 'rgba(243,236,223,0.75)' : INK_SOFT }}>{TD_SPICE_DESC[sp]}</div>
                                </button>
                            );
                        })}
                    </div>

                    <ScrapButton variant="ink" className="w-full mt-6 h-12 text-[14px]" disabled={!canStart || !apiReady} onClick={startGame}
                        icon={<span className="text-[15px]">🍾</span>}>围一圈 · 开始转瓶子</ScrapButton>

                    {history.length > 0 && (
                        <div className="mt-8">
                            <SectionTag en="PAST" className="mb-3">玩过的局</SectionTag>
                            <div className="space-y-3">
                                {history.map((s, i) => (
                                    <PaperCard key={s.id} tilt={i % 2 ? 0.5 : -0.5} className="px-3.5 py-3 flex items-center gap-3">
                                        <span className="text-[20px] shrink-0">🍾</span>
                                        <button onClick={() => resumeGame(s)} className="flex-1 min-w-0 text-left">
                                            <div className="text-[13px] font-black truncate" style={{ color: INK }}>{s.title}</div>
                                            <div className="text-[10.5px] truncate mt-0.5" style={{ color: INK_SOFT }}>{s.players.length} 人 · {TD_SPICE_LABEL[s.spice]} · {s.rounds.length} 回合</div>
                                        </button>
                                        <button onClick={() => void deleteGame(s.id)} className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center active:scale-90 transition" style={{ color: INK_SOFT }} title="删除">
                                            <Trash size={15} weight="bold" />
                                        </button>
                                    </PaperCard>
                                ))}
                            </div>
                        </div>
                    )}
                </ScrapScroll>
            </PaperShell>
        );
    }

    // 玩家圈头像条（高亮受题者）
    function circle(s: TruthDareSession) {
        return (
            <div className="flex gap-2 overflow-x-auto no-scrollbar px-4 py-2 shrink-0">
                {s.players.map(p => {
                    const on = target?.id === p.id;
                    return (
                        <div key={p.id} className="shrink-0 flex flex-col items-center gap-0.5" style={{ width: 46 }}>
                            <div className="w-9 h-9 rounded-full overflow-hidden transition" style={{ boxShadow: on ? '0 0 0 2px #f6f3ec, 0 0 0 4px #1f1d1a' : `0 0 0 1.5px #f6f3ec, 0 0 0 2.5px ${p.isUser ? INK : 'rgba(176,170,158,0.8)'}`, transform: on ? 'scale(1.08)' : undefined }}>
                                {p.avatar ? <img src={p.avatar} className="w-full h-full object-cover" style={{ filter: 'grayscale(1) contrast(1.05)' }} alt="" /> : <div className="w-full h-full flex items-center justify-center text-[15px]" style={{ background: '#e6e2d8' }}>🙂</div>}
                            </div>
                            <span className="text-[9px] font-bold leading-none truncate w-full text-center" style={{ color: on ? INK : INK_SOFT }}>{p.isUser ? '你' : p.name.slice(0, 3)}</span>
                        </div>
                    );
                })}
            </div>
        );
    }

    // 回合记录流
    function feed(s: TruthDareSession) {
        return (
            <div ref={feedRef} className="relative z-10 flex-1 overflow-y-auto no-scrollbar px-4 py-2 space-y-3">
                {s.rounds.length === 0 && !target && (
                    <div className="text-center text-[12px] py-8" style={{ color: INK_SOFT }}>转瓶子，开始第一回合吧 🍾</div>
                )}
                {s.rounds.map(r => (
                    <PaperCard key={r.no} tilt={r.no % 2 ? 0.4 : -0.4} className="px-3.5 py-3">
                        <div className="flex items-center gap-2 mb-1.5">
                            <span className="text-[10px] px-2 py-0.5 rounded-full font-black" style={{ background: '#1f1d1a', color: '#f6f3ec' }}>{TD_KIND_EMOJI[r.kind]} {TD_KIND_CN[r.kind]}</span>
                            <span className="text-[11.5px] font-black truncate" style={{ color: INK }}>{r.targetName}</span>
                            <span className="text-[10px]" style={{ color: INK_SOFT }}>· {r.poserName} 出题</span>
                            <span className="ml-auto text-[9px]" style={{ color: INK_SOFT }}>第{r.no}轮</span>
                        </div>
                        <div className="text-[12.5px] leading-relaxed px-2.5 py-1.5 mb-1.5" style={{ background: 'rgba(255,253,247,0.96)', color: '#3a362f', border: '1px solid rgba(176,170,158,0.7)', borderRadius: '4px 12px 12px 12px' }}>{r.challenge}</div>
                        <div className="text-[12.5px] leading-relaxed px-2.5 py-1.5 whitespace-pre-wrap" style={{ background: '#1f1d1a', color: '#f3ecdf', borderRadius: '12px 4px 12px 12px' }}>{r.answer}</div>
                    </PaperCard>
                ))}
                {busy && <div className="text-center text-[11px] py-2" style={{ color: INK_SOFT }}>· · · {target ? target.name : '大家'}正在想 · · ·</div>}
            </div>
        );
    }

    function kindToggle(value: TruthDareKind, onChange: (k: TruthDareKind) => void) {
        return (
            <div className="flex gap-2 mb-2">
                {(['truth', 'dare'] as TruthDareKind[]).map(k => {
                    const on = value === k;
                    return (
                        <button key={k} onClick={() => onChange(k)} className="flex-1 px-3 py-2 rounded-xl text-[13px] font-black transition active:scale-95" style={{
                            background: on ? '#1f1d1a' : 'rgba(255,253,247,0.9)', color: on ? '#f6f3ec' : '#5b554a',
                            border: on ? 'none' : '1px solid rgba(176,170,158,0.7)',
                        }}>{TD_KIND_EMOJI[k]} {TD_KIND_CN[k]}</button>
                    );
                })}
            </div>
        );
    }

    function actionPanel(s: TruthDareSession) {
        if (error) {
            return (
                <div className="text-center">
                    <div className="text-[12px] mb-2" style={{ color: '#7a3b2e' }}>{error}</div>
                    <ScrapButton variant="paper" className="px-4 py-2 text-[12px]" onClick={() => setError('')}>知道了</ScrapButton>
                </div>
            );
        }
        if (spinning) return <div className="text-center text-[13px] py-3" style={{ color: INK }}><span className="inline-block animate-spin text-[22px]">🍾</span><div className="text-[11px] mt-1" style={{ color: INK_SOFT }}>瓶子转呀转……</div></div>;
        if (busy) return <div className="text-center text-[12px] py-4" style={{ color: INK_SOFT }}><ArrowsClockwise size={16} className="inline animate-spin mr-1.5" />正在出题 / 作答……</div>;

        if (phase === 'idle') {
            return <ScrapButton variant="ink" className="w-full h-12 text-[14px]" onClick={spin} icon={<span className="text-[16px]">🍾</span>}>转瓶子</ScrapButton>;
        }
        if (phase === 'userPick' && target) {
            return (
                <div>
                    <div className="text-[12.5px] font-bold mb-2 text-center" style={{ color: INK }}>瓶口指向了你！挑一个 👇</div>
                    {kindToggle(pendingKind || 'truth', k => void userPickKind(k))}
                    <div className="text-[10.5px] text-center" style={{ color: INK_SOFT }}>选好后，会有人立刻给你出题</div>
                </div>
            );
        }
        if (phase === 'userAnswer' && target && pendingKind) {
            return (
                <div>
                    <div className="text-[11px] mb-1.5" style={{ color: INK_SOFT }}>{pendingPoser?.name} 给你出的【{TD_KIND_CN[pendingKind]}】：</div>
                    <div className="text-[12.5px] leading-relaxed px-3 py-2 mb-2" style={{ background: 'rgba(255,253,247,0.96)', color: '#3a362f', border: '1px solid rgba(176,170,158,0.7)', borderRadius: 10 }}>{pendingChallenge}</div>
                    <div className="flex items-end gap-2">
                        <textarea value={userAnswer} onChange={e => setUserAnswer(e.target.value)} rows={1} placeholder={pendingKind === 'truth' ? '诚实回答…（可留空跳过）' : '描述你怎么完成…（可留空跳过）'}
                            className="flex-1 px-3 py-2 rounded-2xl text-[12.5px] outline-none resize-none max-h-24"
                            style={{ background: 'rgba(255,253,247,0.92)', color: '#3a362f', border: '1px solid rgba(176,170,158,0.75)' }} />
                        <ScrapButton variant="ink" className="px-4 h-10 text-[12.5px]" onClick={submitUserAnswer} icon={<PaperPlaneRight size={14} weight="fill" />}>交卷</ScrapButton>
                    </div>
                </div>
            );
        }
        if (phase === 'charChoice' && target) {
            return (
                <div>
                    <div className="text-[12.5px] font-bold mb-2 text-center" style={{ color: INK }}>瓶口指向了 {target.name}！</div>
                    <div className="flex gap-2">
                        <ScrapButton variant="ink" className="flex-1 h-11 text-[12.5px]" onClick={() => void charAutoRound()} icon={<Sparkle size={14} weight="fill" />}>让大家出题</ScrapButton>
                        <ScrapButton variant="paper" className="flex-1 h-11 text-[12.5px]" onClick={() => { setUserPoseKind('truth'); setUserPoseText(''); setPhase('userPose'); }}>我来出题</ScrapButton>
                    </div>
                </div>
            );
        }
        if (phase === 'userPose' && target) {
            return (
                <div>
                    <div className="text-[11px] mb-1.5" style={{ color: INK_SOFT }}>你给 {target.name} 出题——先替 TA 挑：</div>
                    {kindToggle(userPoseKind, setUserPoseKind)}
                    <div className="flex items-end gap-2">
                        <textarea value={userPoseText} onChange={e => setUserPoseText(e.target.value)} rows={1} placeholder={userPoseKind === 'truth' ? `问 ${target.name} 一个真心话…` : `让 ${target.name} 做个大冒险…`}
                            className="flex-1 px-3 py-2 rounded-2xl text-[12.5px] outline-none resize-none max-h-24"
                            style={{ background: 'rgba(255,253,247,0.92)', color: '#3a362f', border: '1px solid rgba(176,170,158,0.75)' }} />
                        <ScrapButton variant="ink" className="px-4 h-10 text-[12.5px]" onClick={() => void submitUserPose()} icon={<PaperPlaneRight size={14} weight="fill" />}>出题</ScrapButton>
                    </div>
                    <button onClick={() => setPhase('charChoice')} className="text-[10.5px] mt-2" style={{ color: INK_SOFT }}>← 还是让大家出</button>
                </div>
            );
        }
        return <ScrapButton variant="ink" className="w-full h-12 text-[14px]" onClick={spin} icon={<span className="text-[16px]">🍾</span>}>转瓶子</ScrapButton>;
    }

    function renderPlay(s: TruthDareSession) {
        return (
            <PaperShell>
                <ScrapHeader title="真心话大冒险" en={`${TD_SPICE_LABEL[s.spice]} · ${s.rounds.length} 回合`} onBack={() => { setView('home'); void reload(); }} backLabel="离席"
                    right={<WashiTape color="ink" rotate={-3} className="px-2 py-0.5 rounded-[3px] text-[9px] tracking-[0.2em]" style={{ fontFamily: 'var(--font-label)' }}>🍾 SPIN</WashiTape>} />
                {circle(s)}
                {feed(s)}
                <div className="relative z-10 shrink-0 px-3 py-3" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 12px)', borderTop: '1px dashed rgba(150,144,132,0.5)' }}>
                    {actionPanel(s)}
                </div>
            </PaperShell>
        );
    }
};

export default TruthDareApp;
