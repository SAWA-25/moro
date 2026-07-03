import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useOS } from '../../context/OSContext';
import { Moon, Sun, Skull, ArrowsClockwise, Trash, PawPrint, Crosshair } from '@phosphor-icons/react';
import { WerewolfGame, WerewolfPlayer } from '../../types';
import { DB } from '../../utils/db';
import { resolveAuxApi } from '../../utils/auxApi';
import {
    WEREWOLF_ROLE_CN, WEREWOLF_ROLE_EMOJI,
    createWerewolfGame, playerBySeat, userPlayer, livingPlayers, livingWolves,
    checkWinner, mkLog, resolveNightAI, generateDaySpeeches, collectVotes, tallyVotes, hunterShotTarget,
    normalizeWerewolfGame, guardablePlayers, voteTargetPlayers, resolveNightDeathReasons, applyVoteExile,
    type NightAIResult,
} from '../../utils/theaterWerewolf';
import { PaperShell, ScrapScroll, ScrapHeader, Polaroid, ScrapButton, SectionTag, PaperCard, WashiTape, INK, INK_SOFT } from '../ui/insScrapKit';

/**
 * 折子戏·狼人杀（捌）：拉一桌熟人开一局。
 * user 与所选角色各占一座、随机发牌（狼/预言家/女巫/守卫/白痴/猎人/平民）。
 * AI 玩家按各自隐藏身份夜里行动、白天发言、投票放逐——会伪装、会推理、贴人设说话。
 * 黑白拼贴手账皮肤。引擎在 utils/theaterWerewolf.ts，文案在 utils/theaterPrompts.ts（[捌]）。
 */

interface Props { onExit: () => void; }

type Step =
    | 'night'        // 夜晚：按 user 身份给行动面板
    | 'seerResult'   // 预言家查验结果
    | 'witchDecide'  // 女巫用药（已知今晚刀谁）
    | 'resolving'    // 推演中
    | 'dayReveal'    // 天亮·公布昨夜
    | 'discuss'      // 白天发言
    | 'voteCast'     // 投票
    | 'hunter'       // 猎人开枪（user 猎人）
    | 'over';        // 终局

const WerewolfApp: React.FC<Props> = ({ onExit }) => {
    const { characters, apiConfig, auxApiConfig, userProfile, addToast } = useOS();
    const api = resolveAuxApi(auxApiConfig, apiConfig);
    const apiReady = !!(api.baseUrl && api.model);

    const [view, setView] = useState<'home' | 'play'>('home');
    const [history, setHistory] = useState<WerewolfGame[]>([]);
    const [picked, setPicked] = useState<Set<string>>(new Set());

    const [game, setGame] = useState<WerewolfGame | null>(null);
    const [step, setStep] = useState<Step>('night');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    // 夜晚 / 投票 / 猎人的临时态
    const [seerResult, setSeerResult] = useState<{ seat: number; isWolf: boolean } | null>(null);
    const [nightKill, setNightKill] = useState<number | null>(null);      // 女巫面板用：今晚被刀者
    const [guardProtect, setGuardProtect] = useState<number | null>(null);
    const [witchHeal, setWitchHeal] = useState(false);
    const [witchPoison, setWitchPoison] = useState<number | null>(null);
    const [userVote, setUserVote] = useState<number | null>(null);
    const [userSpeech, setUserSpeech] = useState('');
    const [hunterPending, setHunterPending] = useState<number | null>(null);

    const aiNightRef = useRef<NightAIResult | null>(null);
    const processedHuntersRef = useRef<Set<number>>(new Set());
    const continueRef = useRef<((g: WerewolfGame) => void) | null>(null);
    const logRef = useRef<HTMLDivElement>(null);

    const reload = useCallback(async () => { setHistory((await DB.getAllWerewolfGames().catch(() => [])).map(normalizeWerewolfGame)); }, []);
    useEffect(() => { void reload(); }, [reload]);
    useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [game?.log.length, step]);

    const userName = (userProfile?.name || '').trim() || '你';
    const clone = (g: WerewolfGame): WerewolfGame => {
        const n = normalizeWerewolfGame(g);
        return { ...n, lastActiveAt: Date.now(), players: n.players.map(p => ({ ...p })), log: [...n.log] };
    };
    const commit = (g: WerewolfGame) => {
        const n = normalizeWerewolfGame(g);
        setGame(n);
        void DB.saveWerewolfGame(n).catch(() => {});
    };

    // ── 开局 ──────────────────────────────────────────────────────────────
    const startGame = () => {
        if (!apiReady) { addToast('还没配置 API，去「文具盒」填好再来', 'error'); return; }
        const chosen = characters.filter(c => picked.has(c.id));
        if (chosen.length < 5) { addToast('至少凑齐 5 位角色才好开扩展板子', 'info'); return; }
        if (chosen.length > 8) { addToast('一桌最多 8 位角色（加你共 9 人）', 'info'); return; }
        const g = createWerewolfGame(userName, userProfile?.avatar, chosen);
        g.log.push(mkLog(0, 'system', `开局！${g.players.length} 人入座，随机发牌。天黑请闭眼……`));
        processedHuntersRef.current = new Set();
        aiNightRef.current = null;
        resetNightTransient();
        commit(g);
        setView('play');
        setStep('night');
        setError('');
    };

    const resumeGame = (g: WerewolfGame) => {
        const n = normalizeWerewolfGame(g);
        setGame(n);
        setView('play');
        setError('');
        processedHuntersRef.current = new Set();
        resetNightTransient();
        if (n.phase === 'over' || n.winner) { setStep('over'); return; }
        if (n.phase === 'vote') { setStep('voteCast'); return; }
        if (n.phase === 'day') {
            const hasSpeech = n.log.some(e => e.round === n.round && e.kind === 'speech');
            setStep(hasSpeech ? 'discuss' : 'dayReveal');
            return;
        }
        setStep('night');
    };

    const deleteGame = async (id: string) => { await DB.deleteWerewolfGame(id); await reload(); if (game?.id === id) { setGame(null); setView('home'); } };

    const resetNightTransient = () => {
        setSeerResult(null); setNightKill(null); setGuardProtect(null); setWitchHeal(false); setWitchPoison(null); setUserVote(null); setUserSpeech('');
        aiNightRef.current = null;
    };

    // ── 死亡结算（猎人连锁 + 胜负判定）────────────────────────────────────
    const resolveHunterShots = (g: WerewolfGame, processed: Set<number>): number | null => {
        // 返回需要 user 决策的猎人座位；AI 猎人就地开枪（可连锁）。
        while (true) {
            const h = g.players.find(p => !p.alive && p.role === 'hunter' && p.deadRound === g.round
                && (p.deadReason === 'wolf' || p.deadReason === 'vote' || p.deadReason === 'shot' || p.deadReason === 'guard_heal_conflict') && !processed.has(p.seat));
            if (!h) return null;
            processed.add(h.seat);
            if (h.isUser) return h.seat;
            const target = hunterShotTarget(g, h.seat);
            if (target != null) {
                const tp = playerBySeat(g, target)!;
                tp.alive = false; tp.deadRound = g.round; tp.deadReason = 'shot';
                g.log.push(mkLog(g.round, 'result', `🏹 ${h.seat}号 ${h.name}（猎人）倒下时开枪，带走了 ${tp.seat}号 ${tp.name}（${WEREWOLF_ROLE_CN[tp.role]}）。`, { seat: h.seat, name: h.name }));
            }
        }
    };

    const settleDeaths = (g: WerewolfGame, onContinue: (g: WerewolfGame) => void) => {
        continueRef.current = onContinue;
        const needSeat = resolveHunterShots(g, processedHuntersRef.current);
        if (needSeat != null) { setGame(g); void DB.saveWerewolfGame(g).catch(() => {}); setHunterPending(needSeat); setStep('hunter'); return; }
        const winner = checkWinner(g);
        if (winner) {
            g.winner = winner; g.phase = 'over';
            g.log.push(mkLog(g.round, 'result', winner === 'good' ? '🎉 好人阵营获胜！所有狼人都被找了出来。' : '🐺 狼人阵营获胜……天亮时，已无人能挡。'));
            commit(g); setStep('over'); return;
        }
        onContinue(g);
    };

    // ── 夜晚结算 ──────────────────────────────────────────────────────────
    const applyNight = (g0: WerewolfGame, finalKill: number | null, healed: boolean, poison: number | null, protectedSeat: number | null, narration: string) => {
        const g = clone(g0);
        g.log.push(mkLog(g.round, 'narration', narration));
        if (healed) g.witchHealUsed = true;
        if (poison != null) g.witchPoisonUsed = true;
        g.lastGuardedSeat = protectedSeat ?? null;
        const meNow = userPlayer(g);
        if (protectedSeat != null && meNow?.role === 'guard') {
            const guarded = playerBySeat(g, protectedSeat);
            g.log.push(mkLog(g.round, 'result', `🛡️ 第${g.round}夜你守护了 ${guarded?.seat}号 ${guarded?.name}。`, { privateToUser: true }));
        }
        const deathReasons = resolveNightDeathReasons({ wolfKill: finalKill, witchHeal: healed, witchPoison: poison, guardProtect: protectedSeat });
        const die = (seat: number, reason: WerewolfPlayer['deadReason']) => {
            const p = playerBySeat(g, seat);
            if (p && p.alive) {
                p.alive = false; p.deadRound = g.round; p.deadReason = reason;
                const extra = reason === 'guard_heal_conflict' ? '，同守同救' : '';
                g.log.push(mkLog(g.round, 'death', `☠️ 第${g.round}夜，${p.seat}号 ${p.name} 倒下了（身份：${WEREWOLF_ROLE_CN[p.role]}${extra}）。`, { seat: p.seat, name: p.name }));
            }
        };
        const deadSeats = Object.keys(deathReasons).map(Number);
        for (const seat of deadSeats) die(seat, deathReasons[seat]);
        if (deadSeats.length === 0) g.log.push(mkLog(g.round, 'death', `🌅 第${g.round}夜风平浪静——昨夜是个平安夜，无人离场。`));
        g.phase = 'day'; g.pendingKill = null;
        settleDeaths(g, (gg) => { commit(gg); setStep('dayReveal'); });
    };

    const me = game ? userPlayer(game) : undefined;
    const meAlive = !!me?.alive;
    const aliveWolfTargets = (g: WerewolfGame) => g.players.filter(p => p.alive && p.role !== 'wolf');
    const aliveOthers = (g: WerewolfGame, seat?: number) => g.players.filter(p => p.alive && p.seat !== seat);

    const witchPlayer = game ? game.players.find(p => p.alive && p.role === 'witch') : undefined;
    const seerPlayer = game ? game.players.find(p => p.alive && p.role === 'seer') : undefined;
    const guardPlayer = game ? game.players.find(p => p.alive && p.role === 'guard') : undefined;
    const witchIsAI = !!witchPlayer && !witchPlayer.isUser;
    const seerIsAI = !!seerPlayer && !seerPlayer.isUser;
    const guardIsAI = !!guardPlayer && !guardPlayer.isUser;

    // user 是狼：选刀后结算
    const submitWolfKill = async (target: number) => {
        if (!game) return;
        setStep('resolving'); setBusy(true); setError('');
        try {
            const ai = await resolveNightAI(game, characters, api, { needWolfKill: false, needWitch: witchIsAI, needSeer: seerIsAI, needGuard: guardIsAI, knownKill: target });
            applyNight(game, target, ai.witchHeal, ai.witchPoison, ai.guardProtect, ai.narration);
        } catch (e: any) { setError(e?.message || String(e)); setStep('night'); } finally { setBusy(false); }
    };
    // user 是预言家：查验
    const submitSeerCheck = (target: number) => {
        if (!game) return;
        const p = playerBySeat(game, target); if (!p) return;
        const isWolf = p.role === 'wolf';
        setSeerResult({ seat: target, isWolf });
        const g = clone(game);
        g.log.push(mkLog(g.round, 'check', `🔮 第${g.round}夜你查验了 ${p.seat}号 ${p.name}，结果是【${isWolf ? '狼人' : '好人'}】。`, { privateToUser: true }));
        commit(g);
        setStep('seerResult');
    };
    const seerContinue = async () => {
        if (!game) return;
        setStep('resolving'); setBusy(true); setError('');
        try {
            const ai = await resolveNightAI(game, characters, api, { needWolfKill: true, needWitch: witchIsAI, needSeer: false, needGuard: guardIsAI });
            applyNight(game, ai.wolfKill, ai.witchHeal, ai.witchPoison, ai.guardProtect, ai.narration);
        } catch (e: any) { setError(e?.message || String(e)); setStep('seerResult'); } finally { setBusy(false); }
    };
    // user 是女巫：先算出今晚刀谁，再决定用药
    const witchPeek = async () => {
        if (!game) return;
        setStep('resolving'); setBusy(true); setError('');
        try {
            const ai = await resolveNightAI(game, characters, api, { needWolfKill: true, needWitch: false, needSeer: seerIsAI, needGuard: guardIsAI });
            aiNightRef.current = ai;
            setNightKill(ai.wolfKill);
            setGuardProtect(ai.guardProtect);
            setWitchHeal(false); setWitchPoison(null);
            setStep('witchDecide');
        } catch (e: any) { setError(e?.message || String(e)); setStep('night'); } finally { setBusy(false); }
    };
    const submitWitch = () => {
        if (!game) return;
        const ai = aiNightRef.current;
        applyNight(game, nightKill, witchHeal, witchPoison, ai?.guardProtect ?? guardProtect, ai?.narration || '夜色深沉，药香在指间散开……');
    };
    const submitGuard = async (target: number) => {
        if (!game) return;
        setStep('resolving'); setBusy(true); setError('');
        try {
            const ai = await resolveNightAI(game, characters, api, {
                needWolfKill: true, needWitch: witchIsAI, needSeer: seerIsAI, needGuard: false, knownGuardProtect: target,
            });
            applyNight(game, ai.wolfKill, ai.witchHeal, ai.witchPoison, target, ai.narration);
        } catch (e: any) { setError(e?.message || String(e)); setStep('night'); } finally { setBusy(false); }
    };
    // user 不是夜间角色（平民/猎人/已出局）：直接推演
    const passiveNight = async () => {
        if (!game) return;
        setStep('resolving'); setBusy(true); setError('');
        try {
            const ai = await resolveNightAI(game, characters, api, { needWolfKill: true, needWitch: witchIsAI, needSeer: seerIsAI, needGuard: guardIsAI });
            applyNight(game, ai.wolfKill, ai.witchHeal, ai.witchPoison, ai.guardProtect, ai.narration);
        } catch (e: any) { setError(e?.message || String(e)); setStep('night'); } finally { setBusy(false); }
    };

    // ── 白天发言 ──────────────────────────────────────────────────────────
    const composeDeathNote = (g: WerewolfGame): string => {
        const deaths = g.players.filter(p => !p.alive && p.deadRound === g.round && (p.deadReason === 'wolf' || p.deadReason === 'poison' || p.deadReason === 'shot' || p.deadReason === 'guard_heal_conflict'));
        if (!deaths.length) return '昨晚是个平安夜，没有人离场。';
        return '昨晚倒下的是：' + deaths.map(p => `${p.seat}号 ${p.name}`).join('、') + '。';
    };
    const startDiscussion = async () => {
        if (!game) return;
        setBusy(true); setError('');
        try {
            const speeches = await generateDaySpeeches(game, characters, api, composeDeathNote(game));
            const g = clone(game);
            for (const s of speeches) {
                const p = playerBySeat(g, s.seat);
                g.log.push(mkLog(g.round, 'speech', s.speech, { seat: s.seat, name: p?.name }));
            }
            commit(g); setStep('discuss');
        } catch (e: any) { setError(e?.message || String(e)); addToast(`发言生成失败：${e?.message || e}`, 'error'); } finally { setBusy(false); }
    };
    const toVote = () => {
        if (!game) return;
        const g = clone(game);
        const txt = userSpeech.trim();
        if (meAlive && txt && me) g.log.push(mkLog(g.round, 'speech', txt, { seat: me.seat, name: me.name }));
        g.phase = 'vote';
        commit(g);
        setUserSpeech(''); setUserVote(null);
        setStep('voteCast');
    };

    // ── 投票 ──────────────────────────────────────────────────────────────
    const runVote = async () => {
        if (!game) return;
        setBusy(true); setError('');
        try {
            const aiVotes = await collectVotes(game, characters, api);
            const g = clone(game);
            const meNow = userPlayer(g);
            const allVotes = [...aiVotes];
            if (meNow?.alive && !meNow.idiotRevealed && userVote != null) allVotes.push({ seat: meNow.seat, target: userVote });
            const summary = allVotes.length
                ? allVotes.map(v => { const t = playerBySeat(g, v.target); return `${v.seat}→${t?.seat}号${t?.name || ''}`; }).join('，')
                : '无人投票';
            g.log.push(mkLog(g.round, 'vote', `第${g.round}天投票：${summary}`));
            const { target } = tallyVotes(allVotes);
            if (target != null) {
                const p = playerBySeat(g, target);
                if (p) {
                    const result = applyVoteExile(g, target);
                    if (result === 'idiot-revealed') {
                        g.log.push(mkLog(g.round, 'result', `🃏 ${p.seat}号 ${p.name} 被投票放逐时翻开【白痴】身份，免除这次出局；之后不能投票，也不能再被投票。`, { seat: p.seat, name: p.name }));
                    } else if (result === 'dead') {
                        g.log.push(mkLog(g.round, 'death', `🗳️ ${p.seat}号 ${p.name} 被票出，身份是【${WEREWOLF_ROLE_CN[p.role]}】。`, { seat: p.seat, name: p.name }));
                    }
                }
            } else {
                g.log.push(mkLog(g.round, 'result', '本轮平票，无人出局。'));
            }
            setUserVote(null);
            settleDeaths(g, (gg) => {
                gg.round += 1; gg.phase = 'night';
                resetNightTransient();
                commit(gg); setStep('night');
            });
        } catch (e: any) { setError(e?.message || String(e)); addToast(`唱票失败：${e?.message || e}`, 'error'); } finally { setBusy(false); }
    };

    // ── 猎人开枪（user）──────────────────────────────────────────────────
    const userHunterShoot = (target: number | null) => {
        if (!game) return;
        const g = clone(game);
        if (target != null) {
            const tp = playerBySeat(g, target);
            if (tp && tp.alive) {
                tp.alive = false; tp.deadRound = g.round; tp.deadReason = 'shot';
                g.log.push(mkLog(g.round, 'result', `🏹 你（猎人）开枪带走了 ${tp.seat}号 ${tp.name}（${WEREWOLF_ROLE_CN[tp.role]}）。`));
            }
        } else {
            g.log.push(mkLog(g.round, 'result', '你（猎人）扣下了扳机，却终究没有开枪。'));
        }
        setHunterPending(null);
        const cont = continueRef.current || (() => {});
        settleDeaths(g, cont);
    };

    // ════════════════════════ 渲染 ════════════════════════
    if (view === 'home') return renderHome();
    if (!game) { setView('home'); return null; }
    return renderPlay(game);

    // ── 主页：选人 + 历史 ──
    function renderHome() {
        const canStart = picked.size >= 5 && picked.size <= 8;
        return (
            <PaperShell>
                <ScrapHeader title="狼人杀" en="THE WOLF NIGHT" onBack={onExit} backLabel="回戏单" />
                <ScrapScroll className="px-5 pb-10">
                    <div className="text-center mt-2 mb-5 select-none">
                        <PawPrint size={32} weight="fill" className="mx-auto" style={{ color: INK }} />
                        <div className="text-[28px] font-black mt-2" style={{ color: INK }}>狼人杀</div>
                        <div className="text-[12px] mt-1.5 leading-relaxed" style={{ color: '#6b6558' }}>拉一桌熟人，天黑请闭眼。<br />狼/预言家/女巫/守卫/白痴/猎人随机发牌，谁能笑到天亮？</div>
                    </div>

                    {!apiReady && (
                        <PaperCard tilt={-0.5} className="px-4 py-3 mb-5 text-[12px]" style={{ color: '#7a3b2e' }}>
                            还没配置 API。去「文具盒」填好主/副 API，AI 玩家才能在夜里行动、白天发言。
                        </PaperCard>
                    )}

                    <SectionTag en="THE TABLE" className="mb-3">入座（选 5–8 位角色）</SectionTag>
                    {characters.length < 5 ? (
                        <div className="text-[12px] py-4" style={{ color: INK_SOFT }}>角色不够，先去多创建几个，才能凑一桌。</div>
                    ) : (
                        <div className="flex flex-wrap gap-3.5 pb-1">
                            {characters.map((c, i) => (
                                <Polaroid key={c.id} src={c.avatar} caption={c.name} size={56} rotate={i % 2 ? 1.5 : -1.5}
                                    selected={picked.has(c.id)}
                                    onClick={() => setPicked(prev => { const n = new Set(prev); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; })} />
                            ))}
                        </div>
                    )}

                    <div className="mt-3 text-[11px]" style={{ color: INK_SOFT }}>已选 {picked.size} 位 · 连你共 {picked.size + 1} 人 · 6 人起含守卫/白痴</div>

                    <ScrapButton variant="ink" className="w-full mt-5 h-12 text-[14px]" disabled={!canStart || !apiReady} onClick={startGame}
                        icon={<Moon size={16} weight="fill" />}>开局发牌 · 天黑请闭眼</ScrapButton>

                    {history.length > 0 && (
                        <div className="mt-8">
                            <SectionTag en="PAST GAMES" className="mb-3">过往牌局</SectionTag>
                            <div className="space-y-3">
                                {history.map((g, i) => {
                                    const wolves = g.players.filter(p => p.role === 'wolf').length;
                                    const done = g.phase === 'over' || !!g.winner;
                                    return (
                                        <PaperCard key={g.id} tilt={i % 2 ? 0.5 : -0.5} className="px-3.5 py-3 flex items-center gap-3">
                                            <span className="text-[22px] shrink-0">{done ? (g.winner === 'wolf' ? '🐺' : '🎉') : '🌙'}</span>
                                            <button onClick={() => resumeGame(g)} className="flex-1 min-w-0 text-left">
                                                <div className="text-[13px] font-black truncate" style={{ color: INK }}>{g.title}</div>
                                                <div className="text-[10.5px] truncate mt-0.5" style={{ color: INK_SOFT }}>
                                                    {g.players.length} 人（{wolves} 狼）· {done ? (g.winner === 'wolf' ? '狼人胜' : '好人胜') : `进行中 · 第${g.round}${g.phase === 'night' ? '夜' : '天'}`}
                                                </div>
                                            </button>
                                            <button onClick={() => void deleteGame(g.id)} className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center active:scale-90 transition" style={{ color: INK_SOFT }} title="删除">
                                                <Trash size={15} weight="bold" />
                                            </button>
                                        </PaperCard>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </ScrapScroll>
            </PaperShell>
        );
    }

    // ── 牌桌头像条 ──
    function seatsStrip(g: WerewolfGame) {
        return (
            <div className="flex gap-2 overflow-x-auto no-scrollbar px-4 py-2 shrink-0">
                {g.players.map(p => {
                    const dead = !p.alive;
                    return (
                        <div key={p.seat} className="shrink-0 flex flex-col items-center gap-0.5" style={{ width: 46, opacity: dead ? 0.5 : 1 }}>
                            <div className="relative">
                                <div className="w-9 h-9 rounded-full overflow-hidden" style={{ boxShadow: `0 0 0 1.5px #f6f3ec, 0 0 0 2.5px ${p.isUser ? INK : 'rgba(176,170,158,0.8)'}` }}>
                                    {p.avatar ? <img src={p.avatar} className="w-full h-full object-cover" style={{ filter: dead ? 'opacity(0.55)' : 'contrast(1.02)' }} alt="" /> : <div className="w-full h-full flex items-center justify-center text-[15px]" style={{ background: '#e6e2d8' }}>🙂</div>}
                                </div>
                                {dead && <span className="absolute -top-1 -right-1 text-[11px]"><Skull size={13} weight="fill" style={{ color: INK }} /></span>}
                            </div>
                            <span className="text-[9px] font-bold leading-none truncate w-full text-center" style={{ color: INK }}>{p.seat}{p.isUser ? '·你' : ''}</span>
                            <span className="text-[8px] leading-none truncate w-full text-center" style={{ color: INK_SOFT }}>{dead ? WEREWOLF_ROLE_CN[p.role] : p.idiotRevealed ? '白痴翻牌' : p.name.slice(0, 3)}</span>
                        </div>
                    );
                })}
            </div>
        );
    }

    // ── 我的底牌 ──
    function myHand(g: WerewolfGame) {
        const m = userPlayer(g); if (!m) return null;
        const teammates = m.role === 'wolf' ? g.players.filter(p => p.role === 'wolf' && p.seat !== m.seat) : [];
        const checks = g.log.filter(e => e.kind === 'check');
        return (
            <PaperCard tilt={-0.4} className="mx-4 mt-2 px-3.5 py-2.5">
                <div className="flex items-center gap-2">
                    <span className="text-[18px]">{WEREWOLF_ROLE_EMOJI[m.role]}</span>
                    <div className="min-w-0">
                        <div className="text-[12.5px] font-black" style={{ color: INK }}>你是 {m.seat}号 · {WEREWOLF_ROLE_CN[m.role]}{!m.alive && ' （已出局）'}</div>
                        {teammates.length > 0 && <div className="text-[10.5px] mt-0.5" style={{ color: INK_SOFT }}>狼队友：{teammates.map(t => `${t.seat}号${t.name}`).join('、')}</div>}
                        {m.role === 'witch' && <div className="text-[10.5px] mt-0.5" style={{ color: INK_SOFT }}>解药{g.witchHealUsed ? '已用' : '可用'} · 毒药{g.witchPoisonUsed ? '已用' : '可用'}</div>}
                        {m.role === 'guard' && <div className="text-[10.5px] mt-0.5" style={{ color: INK_SOFT }}>{g.lastGuardedSeat ? `昨夜守过 ${g.lastGuardedSeat}号，今夜不能连守 TA` : '可守自己；守卫不知道今晚谁被刀'}</div>}
                        {m.role === 'idiot' && m.idiotRevealed && <div className="text-[10.5px] mt-0.5" style={{ color: INK_SOFT }}>你已翻牌留场：可以发言，但不能投票 / 被投票。</div>}
                        {checks.length > 0 && <div className="text-[10.5px] mt-0.5 truncate" style={{ color: INK_SOFT }}>查验：{checks.map(c => c.text.replace(/^🔮[^你]*你查验了\s*/, '')).slice(-3).join(' / ')}</div>}
                    </div>
                </div>
            </PaperCard>
        );
    }

    // ── 日志流 ──
    function logFeed(g: WerewolfGame) {
        return (
            <div ref={logRef} className="relative z-10 flex-1 overflow-y-auto no-scrollbar px-4 py-2 space-y-2">
                {g.log.map((e, i) => {
                    if (e.kind === 'speech') {
                        const p = e.seat != null ? playerBySeat(g, e.seat) : undefined;
                        const isUserSp = p?.isUser;
                        return (
                            <div key={i} className={`flex items-start gap-2 ${isUserSp ? 'flex-row-reverse' : ''}`}>
                                {p?.avatar
                                    ? <img src={p.avatar} className="w-6 h-6 rounded-full object-cover mt-0.5 shrink-0" style={{ filter: 'contrast(1.02)', boxShadow: '0 0 0 1.5px #f6f3ec, 0 0 0 2.5px rgba(176,170,158,0.7)' }} alt="" />
                                    : <span className="w-6 h-6 rounded-full bg-[#e6e2d8] flex items-center justify-center text-[11px] shrink-0">🙂</span>}
                                <div className="max-w-[78%]">
                                    <div className={`text-[9.5px] mb-0.5 ${isUserSp ? 'text-right' : ''}`} style={{ color: INK_SOFT }}>{e.seat}号 {e.name}</div>
                                    <div className="px-3 py-1.5 text-[12.5px] leading-relaxed whitespace-pre-wrap" style={isUserSp
                                        ? { background: '#1f1d1a', color: '#f3ecdf', borderRadius: '14px 4px 14px 14px' }
                                        : { background: 'rgba(255,253,247,0.96)', color: '#3a362f', border: '1px solid rgba(176,170,158,0.7)', borderRadius: '4px 14px 14px 14px' }}>{e.text}</div>
                                </div>
                            </div>
                        );
                    }
                    const tone =
                        e.kind === 'narration' ? { color: INK_SOFT, fontStyle: 'italic' as const } :
                        e.kind === 'check' ? { color: '#5a4636' } :
                        e.kind === 'death' || e.kind === 'result' ? { color: INK, fontWeight: 800 as const } :
                        { color: INK_SOFT };
                    return (
                        <div key={i} className="text-center text-[11.5px] leading-relaxed px-3 py-1" style={tone}>
                            {e.kind === 'vote' ? <span className="opacity-80">{e.text}</span> : e.text}
                        </div>
                    );
                })}
                {busy && <div className="text-center text-[11px] py-2" style={{ color: INK_SOFT }}>· · · 正在推演 · · ·</div>}
            </div>
        );
    }

    // 目标选择小网格
    function targetGrid(g: WerewolfGame, targets: WerewolfPlayer[], selected: number | null, onPick: (seat: number) => void) {
        return (
            <div className="flex flex-wrap gap-2">
                {targets.map(p => {
                    const on = selected === p.seat;
                    return (
                        <button key={p.seat} onClick={() => onPick(p.seat)} className="px-2.5 py-1.5 rounded-full text-[12px] font-bold transition active:scale-95 flex items-center gap-1.5" style={{
                            background: on ? '#1f1d1a' : 'rgba(255,253,247,0.9)', color: on ? '#f6f3ec' : '#5b554a',
                            border: on ? 'none' : '1px solid rgba(176,170,158,0.7)',
                        }}>{p.seat}号 {p.name}</button>
                    );
                })}
            </div>
        );
    }

    // ── 底部行动面板（按 step） ──
    function actionPanel(g: WerewolfGame) {
        const m = userPlayer(g);
        const role = m?.role;
        const alive = !!m?.alive;

        if (busy || step === 'resolving') {
            return <div className="text-center text-[12px] py-4" style={{ color: INK_SOFT }}><ArrowsClockwise size={16} className="inline animate-spin mr-1.5" />天黑请闭眼，正在推演这一夜……</div>;
        }
        if (error) {
            return (
                <div className="text-center">
                    <div className="text-[12px] mb-2" style={{ color: '#7a3b2e' }}>{error}</div>
                    <ScrapButton variant="paper" className="px-4 py-2 text-[12px]" onClick={() => setError('')}>知道了</ScrapButton>
                </div>
            );
        }

        // 夜晚
        if (step === 'night') {
            if (!alive) return <ScrapButton variant="ink" className="w-full h-11 text-[13px]" onClick={() => void passiveNight()} icon={<Moon size={15} weight="fill" />}>你已出局，旁观这一夜 · 推进到天亮</ScrapButton>;
            if (role === 'wolf') return (
                <div>
                    <div className="text-[12px] font-bold mb-2" style={{ color: INK }}>🐺 狼人行动：今晚刀谁？</div>
                    {targetGrid(g, aliveWolfTargets(g), nightKill, s => setNightKill(s))}
                    <ScrapButton variant="ink" className="w-full mt-3 h-11 text-[13px]" disabled={nightKill == null} onClick={() => nightKill != null && void submitWolfKill(nightKill)}>下刀</ScrapButton>
                </div>
            );
            if (role === 'seer') return (
                <div>
                    <div className="text-[12px] font-bold mb-2" style={{ color: INK }}>🔮 预言家：查验谁的身份？</div>
                    {targetGrid(g, aliveOthers(g, m!.seat), nightKill, s => setNightKill(s))}
                    <ScrapButton variant="ink" className="w-full mt-3 h-11 text-[13px]" disabled={nightKill == null} onClick={() => nightKill != null && submitSeerCheck(nightKill)}>查验</ScrapButton>
                </div>
            );
            if (role === 'witch') return (
                <div className="text-center">
                    <div className="text-[12px] mb-2" style={{ color: INK }}>🧪 女巫：先看看今晚发生了什么……</div>
                    <ScrapButton variant="ink" className="w-full h-11 text-[13px]" onClick={() => void witchPeek()}>睁眼·查看今夜</ScrapButton>
                </div>
            );
            if (role === 'guard') {
                const targets = guardablePlayers(g);
                return (
                    <div>
                        <div className="text-[12px] font-bold mb-1.5" style={{ color: INK }}>🛡️ 守卫行动：今晚守护谁？</div>
                        <div className="text-[10.5px] mb-2" style={{ color: INK_SOFT }}>{g.lastGuardedSeat ? `上一夜守过 ${g.lastGuardedSeat}号，本夜不能连续守 TA。` : '你不知道今晚狼刀和女巫用药，只能盲守。'}</div>
                        {targetGrid(g, targets, guardProtect, s => setGuardProtect(s))}
                        <ScrapButton variant="ink" className="w-full mt-3 h-11 text-[13px]" disabled={guardProtect == null} onClick={() => guardProtect != null && void submitGuard(guardProtect)}>守护</ScrapButton>
                    </div>
                );
            }
            // 平民 / 猎人 / 白痴
            return <ScrapButton variant="ink" className="w-full h-11 text-[13px]" onClick={() => void passiveNight()} icon={<Moon size={15} weight="fill" />}>安睡到天亮（{WEREWOLF_ROLE_CN[role!]}夜里无行动）</ScrapButton>;
        }

        if (step === 'seerResult' && seerResult) {
            const tp = playerBySeat(g, seerResult.seat);
            return (
                <div className="text-center">
                    <div className="text-[13px] font-black mb-2" style={{ color: INK }}>查验结果：{tp?.seat}号 {tp?.name} 是【{seerResult.isWolf ? '🐺 狼人' : '🧑 好人'}】</div>
                    <ScrapButton variant="ink" className="w-full h-11 text-[13px]" onClick={() => void seerContinue()}>记下了，等待天亮</ScrapButton>
                </div>
            );
        }

        if (step === 'witchDecide') {
            const kp = nightKill != null ? playerBySeat(g, nightKill) : null;
            const healLeft = !g.witchHealUsed && nightKill != null;
            const poisonLeft = !g.witchPoisonUsed;
            return (
                <div>
                    <div className="text-[12px] font-bold mb-2" style={{ color: INK }}>🧪 女巫之夜：{kp ? `今晚 ${kp.seat}号 ${kp.name} 被狼袭击了。` : '今晚似乎无人被刀。'}</div>
                    {healLeft && (
                        <label className="flex items-center gap-2 text-[12px] mb-2 cursor-pointer" style={{ color: INK }}>
                            <input type="checkbox" checked={witchHeal} onChange={e => setWitchHeal(e.target.checked)} />
                            用解药救下 {kp?.seat}号 {kp?.name}
                        </label>
                    )}
                    {poisonLeft && (
                        <div className="mb-2">
                            <div className="text-[11px] mb-1.5" style={{ color: INK_SOFT }}>用毒药毒一人（可不用）：</div>
                            {targetGrid(g, aliveOthers(g, m!.seat), witchPoison, s => setWitchPoison(witchPoison === s ? null : s))}
                        </div>
                    )}
                    {!healLeft && !poisonLeft && <div className="text-[11px] mb-2" style={{ color: INK_SOFT }}>药都用完了，今夜只能旁观。</div>}
                    <ScrapButton variant="ink" className="w-full mt-1 h-11 text-[13px]" onClick={submitWitch}>结束我的回合</ScrapButton>
                </div>
            );
        }

        if (step === 'dayReveal') {
            return (
                <div className="text-center">
                    <div className="text-[12px] mb-2" style={{ color: INK }}>🌅 第{g.round}天天亮了。{composeDeathNote(g)}</div>
                    <ScrapButton variant="ink" className="w-full h-11 text-[13px]" onClick={() => void startDiscussion()} icon={<Sun size={15} weight="fill" />}>开始白天讨论</ScrapButton>
                </div>
            );
        }

        if (step === 'discuss') {
            return (
                <div>
                    {meAlive ? (
                        <div className="flex items-end gap-2">
                            <textarea value={userSpeech} onChange={e => setUserSpeech(e.target.value)} rows={1} placeholder="轮到你发言（可留空跳过）…"
                                className="flex-1 px-3 py-2 rounded-2xl text-[12.5px] outline-none resize-none max-h-24"
                                style={{ background: 'rgba(255,253,247,0.92)', color: '#3a362f', border: '1px solid rgba(176,170,158,0.75)' }} />
                            <ScrapButton variant="ink" className="px-4 h-10 text-[12.5px]" onClick={toVote}>说完 · 投票</ScrapButton>
                        </div>
                    ) : (
                        <ScrapButton variant="ink" className="w-full h-11 text-[13px]" onClick={toVote}>你已出局 · 进入投票</ScrapButton>
                    )}
                </div>
            );
        }

        if (step === 'voteCast') {
            const canVote = !!m?.alive && !m.idiotRevealed;
            return (
                <div>
                    <div className="text-[12px] font-bold mb-2" style={{ color: INK }}>🗳️ 第{g.round}天投票：放逐谁？</div>
                    {canVote ? targetGrid(g, voteTargetPlayers(g, m!.seat), userVote, s => setUserVote(userVote === s ? null : s)) : <div className="text-[11px] mb-2" style={{ color: INK_SOFT }}>{m?.idiotRevealed ? '你已翻牌留场，不能参与投票。' : '你已出局，只能旁观这轮投票。'}</div>}
                    <ScrapButton variant="ink" className="w-full mt-3 h-11 text-[13px]" onClick={() => void runVote()} icon={<Crosshair size={15} weight="bold" />}>
                        {canVote ? (userVote != null ? '投票并唱票' : '弃票并唱票') : '唱票'}
                    </ScrapButton>
                </div>
            );
        }

        if (step === 'hunter' && hunterPending != null) {
            return (
                <div>
                    <div className="text-[12px] font-bold mb-2" style={{ color: INK }}>🏹 你（猎人）倒下了！开枪带走一人，或选择不开枪。</div>
                    {targetGrid(g, aliveOthers(g, hunterPending), null, s => userHunterShoot(s))}
                    <ScrapButton variant="paper" className="w-full mt-3 h-10 text-[12.5px]" onClick={() => userHunterShoot(null)}>不开枪</ScrapButton>
                </div>
            );
        }

        return null;
    }

    // ── 终局 ──
    function renderOver(g: WerewolfGame) {
        const win = g.winner;
        return (
            <PaperShell>
                <ScrapHeader title="散场" en="CURTAIN" onBack={() => { setView('home'); void reload(); }} backLabel="回戏单" />
                <ScrapScroll className="px-5 pb-10">
                    <PaperCard tilt={-0.6} className="px-5 py-7 mt-3 text-center overflow-hidden">
                        <WashiTape color="ink" rotate={-6} className="absolute -top-2 left-6 w-20 h-6 rounded-[2px] text-[8px] tracking-[0.3em]" style={{ fontFamily: 'var(--font-label)' }}>THE END</WashiTape>
                        <div className="text-[44px] leading-none mt-2">{win === 'wolf' ? '🐺' : '🎉'}</div>
                        <div className="text-[24px] font-black mt-3" style={{ color: INK }}>{win === 'wolf' ? '狼人阵营获胜' : '好人阵营获胜'}</div>
                        <div className="text-[12px] mt-2" style={{ color: INK_SOFT }}>第 {g.round} 天落幕</div>
                    </PaperCard>

                    <SectionTag en="REVEAL" className="mt-7 mb-3">身份揭晓</SectionTag>
                    <div className="space-y-2">
                        {g.players.map(p => (
                            <PaperCard key={p.seat} tilt={p.seat % 2 ? 0.4 : -0.4} className="px-3.5 py-2.5 flex items-center gap-3">
                                <span className="text-[20px]">{WEREWOLF_ROLE_EMOJI[p.role]}</span>
                                <div className="flex-1 min-w-0">
                                    <div className="text-[13px] font-black truncate" style={{ color: INK }}>{p.seat}号 {p.name}{p.isUser ? '（你）' : ''}</div>
                                    <div className="text-[10.5px] mt-0.5" style={{ color: INK_SOFT }}>{WEREWOLF_ROLE_CN[p.role]} · {p.alive ? (p.idiotRevealed ? '翻牌留场到终局' : '存活到终局') : `第${p.deadRound}${p.deadReason === 'vote' ? '天被票' : p.deadReason === 'poison' ? '夜被毒' : p.deadReason === 'shot' ? '轮被枪' : p.deadReason === 'guard_heal_conflict' ? '夜同守同救出局' : '夜出局'}`}</div>
                                </div>
                                {p.role === 'wolf' ? <PawPrint size={16} weight="fill" style={{ color: INK }} /> : null}
                            </PaperCard>
                        ))}
                    </div>

                    <ScrapButton variant="ink" className="w-full mt-7 h-12 text-[14px]" onClick={() => { setView('home'); setPicked(new Set()); void reload(); }}>再开一桌</ScrapButton>
                </ScrapScroll>
            </PaperShell>
        );
    }

    // ── 牌桌主界面 ──
    function renderPlay(g: WerewolfGame) {
        if (step === 'over' || g.winner) return renderOver(g);
        const phaseLabel = g.phase === 'night' ? `第 ${g.round} 夜` : g.phase === 'vote' ? `第 ${g.round} 天 · 投票` : `第 ${g.round} 天`;
        return (
            <PaperShell>
                <ScrapHeader title="狼人杀" en={phaseLabel} onBack={() => { setView('home'); void reload(); }} backLabel="离席"
                    right={<span className="text-[10px] px-2 py-1 rounded-full" style={{ background: '#1f1d1a', color: '#f6f3ec' }}>{g.phase === 'night' ? <Moon size={11} weight="fill" className="inline" /> : <Sun size={11} weight="fill" className="inline" />} {livingPlayers(g).length}/{g.players.length} 存活 · {livingWolves(g).length} 狼</span>} />
                {seatsStrip(g)}
                {myHand(g)}
                {logFeed(g)}
                <div className="relative z-10 shrink-0 px-3 py-3" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 12px)', borderTop: '1px dashed rgba(150,144,132,0.5)' }}>
                    {actionPanel(g)}
                </div>
            </PaperShell>
        );
    }
};

export default WerewolfApp;
