import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowClockwise, Eye, Flag, Play, Question, SealCheck } from '@phosphor-icons/react';
import { useOS } from '../../context/OSContext';
import type {
    CharacterProfile,
    Message,
    TheaterTurtleSoupGame,
    TheaterTurtleSoupInvitation,
    TurtleSoupDialogueKind,
    TurtleSoupDifficultyMode,
    TurtleSoupPlayer,
} from '../../types';
import { PaperShell, ScrapScroll, ScrapHeader, PaperCard, ScrapButton, SectionTag, Stamp, INK, INK_SOFT } from '../ui/insScrapKit';
import { DB } from '../../utils/db';
import { resolveAuxApi } from '../../utils/auxApi';
import {
    TURTLE_SOUP_DIFFICULTY_LABELS,
    TURTLE_SOUP_DIFFICULTY_MODE_LABELS,
    TURTLE_SOUP_VERDICT_LABELS,
    addTurtleSoupDialogue,
    applyTurtleSoupFinalGuess,
    applyTurtleSoupQuestion,
    characterTurtleSoupHost,
    createTurtleSoupGame,
    createTurtleSoupPlayers,
    decideTurtleSoupOpeningDifficulty,
    decideTurtleSoupPerMoveDifficulty,
    fallbackTurtleSoupDialogue,
    generateTurtleSoupCase,
    generateTurtleSoupCharacterAction,
    generateTurtleSoupDialogue,
    judgeTurtleSoupFinalGuess,
    judgeTurtleSoupQuestion,
    normalizeTurtleSoupGame,
    revealTurtleSoupAnswer,
    systemTurtleSoupHost,
    turtleSoupPlayerName,
} from '../../utils/theaterTurtleSoup';

export interface TurtleSoupLaunchPayload {
    invitationId?: string;
    charId?: string;
    gameId?: string;
}

interface TurtleSoupAppProps {
    onExit: () => void;
    launch?: TurtleSoupLaunchPayload | null;
}

const modeOptions: Array<{ id: TurtleSoupDifficultyMode; label: string; note: string }> = [
    { id: 'opening', label: '开局定档', note: '模型开局判断角色整局猜题实力。' },
    { id: 'per_move', label: '每轮评估', note: '每次角色行动前按局势重新判断。' },
];

const fmtTime = (ts?: number) => ts ? new Date(ts).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '刚刚';
const charDisplay = (char?: CharacterProfile | null) => char?.convoSettings?.remarkName?.trim() || char?.name || '某人';
const clamp = (text: string, max = 160) => text.replace(/\s+/g, ' ').trim().slice(0, max);

const updateInviteCardMessage = async (invitation: TheaterTurtleSoupInvitation, status: TheaterTurtleSoupInvitation['status'], acceptedGameId?: string) => {
    try {
        const messages = await DB.getMessagesByCharId(invitation.charId, true);
        const target = [...messages].reverse().find((m: Message) => (m.metadata as any)?.turtleSoupInvite?.invitationId === invitation.id);
        if (!target?.id) return;
        await DB.updateMessageMetadata(target.id, (prev: any) => ({
            ...(prev || {}),
            turtleSoupInvite: {
                ...(prev?.turtleSoupInvite || {}),
                status,
                acceptedGameId,
            },
        }));
    } catch { /* ignore */ }
};

const TurtleSoupApp: React.FC<TurtleSoupAppProps> = ({ onExit, launch }) => {
    const { characters, userProfile, apiConfig, auxApiConfig, updateCharacter, addToast } = useOS();
    const [games, setGames] = useState<TheaterTurtleSoupGame[]>([]);
    const [invitations, setInvitations] = useState<TheaterTurtleSoupInvitation[]>([]);
    const [hostId, setHostId] = useState<string>('system');
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [difficultyMode, setDifficultyMode] = useState<TurtleSoupDifficultyMode>('opening');
    const [game, setGame] = useState<TheaterTurtleSoupGame | null>(null);
    const [input, setInput] = useState('');
    const [busy, setBusy] = useState(false);
    const [highlightInviteId, setHighlightInviteId] = useState<string | undefined>();
    const [inviteHostIds, setInviteHostIds] = useState<Record<string, boolean>>({});
    const [inviteExtraIds, setInviteExtraIds] = useState<Record<string, string[]>>({});

    const api = useMemo(() => resolveAuxApi(auxApiConfig, apiConfig), [apiConfig, auxApiConfig]);
    const userName = userProfile?.name || '你';
    const playableChars = useMemo(() => characters.filter(c => !!c.id), [characters]);
    const hostChar = useMemo(() => hostId === 'system' ? null : playableChars.find(c => c.id === hostId) || null, [hostId, playableChars]);
    const playerChars = useMemo(() => selectedIds.map(id => playableChars.find(c => c.id === id)).filter(Boolean) as CharacterProfile[], [playableChars, selectedIds]);
    const activeGames = useMemo(() => games.filter(g => g.status === 'playing'), [games]);
    const pendingInvites = useMemo(() => invitations.filter(i => i.status === 'pending'), [invitations]);

    const reload = useCallback(async () => {
        const [allGames, allInvites] = await Promise.all([
            DB.getAllTheaterTurtleSoupGames().catch(() => []),
            DB.getAllTheaterTurtleSoupInvitations().catch(() => []),
        ]);
        setGames(allGames.map(normalizeTurtleSoupGame));
        setInvitations(allInvites);
    }, []);

    useEffect(() => { void reload(); }, [reload]);

    useEffect(() => {
        if (selectedIds.length || !playableChars.length) return;
        const first = launch?.charId && playableChars.find(c => c.id === launch.charId) ? launch.charId : playableChars[0].id;
        setSelectedIds([first]);
    }, [launch?.charId, playableChars, selectedIds.length]);

    useEffect(() => {
        let alive = true;
        const openLaunch = async () => {
            if (!launch) return;
            if (launch.charId) setSelectedIds(prev => prev.includes(launch.charId!) ? prev : [launch.charId!, ...prev].slice(0, 5));
            if (launch.invitationId) {
                setHighlightInviteId(launch.invitationId);
                return;
            }
            if (launch.gameId) {
                const found = await DB.getTheaterTurtleSoupGame(launch.gameId);
                if (alive && found) setGame(normalizeTurtleSoupGame(found));
            }
        };
        void openLaunch();
        return () => { alive = false; };
    }, [launch]);

    const persistGame = useCallback(async (next: TheaterTurtleSoupGame) => {
        const clean = normalizeTurtleSoupGame(next);
        setGame(clean);
        await DB.saveTheaterTurtleSoupGame(clean);
        setGames(prev => [clean, ...prev.filter(g => g.id !== clean.id)].sort((a, b) => b.lastActiveAt - a.lastActiveAt));
    }, []);

    const charForPlayerId = useCallback((g: TheaterTurtleSoupGame, playerId: string) => {
        const player = g.players.find(p => p.id === playerId || p.charId === playerId);
        return player?.charId ? characters.find(c => c.id === player.charId) || null : null;
    }, [characters]);

    const hostForGame = useCallback((g: TheaterTurtleSoupGame) => {
        return g.host.charId ? characters.find(c => c.id === g.host.charId) || null : null;
    }, [characters]);

    const advanceAiTurns = useCallback(async (inputGame: TheaterTurtleSoupGame, seedEvent: TurtleSoupDialogueKind = 'normal') => {
        let current = normalizeTurtleSoupGame(inputGame);
        setBusy(true);
        try {
            for (let guard = 0; guard < 12; guard++) {
                if (current.status !== 'playing' || current.currentSpeakerId === 'user') break;
                const playerId = current.currentSpeakerId;
                const char = charForPlayerId(current, playerId);
                if (!char) break;

                let thinking = addTurtleSoupDialogue(current, 'thinking', fallbackTurtleSoupDialogue('thinking', char.name), playerId);
                await persistGame(thinking);

                let level = thinking.difficultyLevels[playerId] || 'steady';
                if (thinking.difficultyMode === 'per_move') {
                    const assessed = await decideTurtleSoupPerMoveDifficulty(char, userProfile, api, thinking, playerId, seedEvent);
                    level = assessed.difficultyLevel;
                    thinking = { ...thinking, difficultyLevels: { ...thinking.difficultyLevels, [playerId]: level } };
                }

                const action = await generateTurtleSoupCharacterAction(char, userProfile, api, thinking, playerId, seedEvent);
                const hostChar = hostForGame(thinking);
                if (action.kind === 'final_guess') {
                    const judged = await judgeTurtleSoupFinalGuess(hostChar, userProfile, api, thinking, action.text);
                    const applied = applyTurtleSoupFinalGuess(thinking, playerId, action.text, judged.result, judged.hostText);
                    if (!applied.ok) break;
                    let withHost = addTurtleSoupDialogue(applied.game, applied.event, `${turtleSoupPlayerName(applied.game, playerId)}：${action.text} / 主持：${applied.turn.hostText}`, 'host', applied.turn.no);
                    const line = await generateTurtleSoupDialogue(char, userProfile, api, withHost, playerId, applied.event, action.text);
                    current = addTurtleSoupDialogue(withHost, applied.event, line, playerId, applied.turn.no);
                    await persistGame(current);
                    continue;
                }

                const judged = await judgeTurtleSoupQuestion(hostChar, userProfile, api, thinking, action.text);
                const applied = applyTurtleSoupQuestion(thinking, playerId, action.text, judged.verdict);
                if (!applied.ok) break;
                let withHost = addTurtleSoupDialogue(applied.game, applied.event, `${turtleSoupPlayerName(applied.game, playerId)}：${action.text} / 主持：${TURTLE_SOUP_VERDICT_LABELS[applied.turn.verdict || judged.verdict]}`, 'host', applied.turn.no);
                const line = await generateTurtleSoupDialogue(char, userProfile, api, withHost, playerId, applied.event, action.text);
                current = addTurtleSoupDialogue(withHost, 'character_question', line, playerId, applied.turn.no);
                await persistGame(current);
                seedEvent = applied.event;
            }
        } finally {
            setBusy(false);
        }
        return current;
    }, [api, charForPlayerId, hostForGame, persistGame, userProfile]);

    const startGame = useCallback(async (hostChoice: CharacterProfile | null, chars: CharacterProfile[], mode: TurtleSoupDifficultyMode, opts?: { invitation?: TheaterTurtleSoupInvitation; inviteMessage?: string }) => {
        const cleanChars = chars.filter(Boolean).filter((c, index, arr) => arr.findIndex(x => x.id === c.id) === index).slice(0, 5);
        if (cleanChars.length < 1) {
            addToast('海龟汤至少需要一位正式角色一起猜', 'error');
            return;
        }
        setBusy(true);
        try {
            const soup = await generateTurtleSoupCase(hostChoice, userProfile, api, cleanChars);
            const levels = await Promise.all(cleanChars.map(async char => {
                const assessed = await decideTurtleSoupOpeningDifficulty(char, userProfile, api, mode, !!opts?.invitation);
                return [char.id, assessed.difficultyLevel] as const;
            }));
            let next = createTurtleSoupGame(
                userName,
                hostChoice ? characterTurtleSoupHost(hostChoice) : systemTurtleSoupHost(),
                createTurtleSoupPlayers(userName, cleanChars),
                soup.soupCase,
                {
                    difficultyMode: mode,
                    difficultyLevels: Object.fromEntries(levels),
                    invitationId: opts?.invitation?.id,
                },
            );
            next = addTurtleSoupDialogue(next, 'case', `${next.host.name}念出汤面：${next.case.surface}`, 'host');
            if (opts?.inviteMessage) next = addTurtleSoupDialogue(next, 'invite', opts.inviteMessage, opts.invitation?.charId || 'host');
            await persistGame(next);
            if (opts?.invitation) {
                const accepted = { ...opts.invitation, status: 'accepted' as const, acceptedGameId: next.id, updatedAt: Date.now() };
                await DB.saveTheaterTurtleSoupInvitation(accepted);
                await updateInviteCardMessage(accepted, 'accepted', next.id);
                setInvitations(prev => prev.map(i => i.id === accepted.id ? accepted : i));
            }
            addToast(`海龟汤开局：${next.case.title}`, 'success');
            if (next.currentSpeakerId !== 'user') await advanceAiTurns(next);
        } catch {
            addToast('海龟汤开局失败了，稍后再试一次', 'error');
        } finally {
            setBusy(false);
        }
    }, [addToast, advanceAiTurns, api, persistGame, userName, userProfile]);

    const submitQuestion = useCallback(async () => {
        if (!game || busy || game.status !== 'playing' || game.currentSpeakerId !== 'user') return;
        const text = clamp(input, 180);
        if (!text) return;
        setBusy(true);
        setInput('');
        const judged = await judgeTurtleSoupQuestion(hostForGame(game), userProfile, api, game, text);
        const applied = applyTurtleSoupQuestion(game, 'user', text, judged.verdict);
        if (!applied.ok) {
            await persistGame(addTurtleSoupDialogue(game, 'illegal', applied.reason, 'system'));
            setBusy(false);
            return;
        }
        const withHost = addTurtleSoupDialogue(applied.game, applied.event, `你：${text} / 主持：${TURTLE_SOUP_VERDICT_LABELS[applied.turn.verdict || judged.verdict]}`, 'host', applied.turn.no);
        await persistGame(withHost);
        if (withHost.currentSpeakerId !== 'user') await advanceAiTurns(withHost, applied.event);
        else setBusy(false);
    }, [advanceAiTurns, api, busy, game, hostForGame, input, persistGame, userProfile]);

    const submitGuess = useCallback(async () => {
        if (!game || busy || game.status !== 'playing' || game.currentSpeakerId !== 'user') return;
        const text = clamp(input, 260);
        if (!text) return;
        setBusy(true);
        setInput('');
        const judged = await judgeTurtleSoupFinalGuess(hostForGame(game), userProfile, api, game, text);
        const applied = applyTurtleSoupFinalGuess(game, 'user', text, judged.result, judged.hostText);
        if (!applied.ok) {
            await persistGame(addTurtleSoupDialogue(game, 'illegal', applied.reason, 'system'));
            setBusy(false);
            return;
        }
        const withHost = addTurtleSoupDialogue(applied.game, applied.event, `你终猜：${text} / 主持：${applied.turn.hostText}`, 'host', applied.turn.no);
        await persistGame(withHost);
        if (withHost.status === 'playing' && withHost.currentSpeakerId !== 'user') await advanceAiTurns(withHost, applied.event);
        else setBusy(false);
    }, [advanceAiTurns, api, busy, game, hostForGame, input, persistGame, userProfile]);

    const reveal = useCallback(async () => {
        if (!game || game.status !== 'playing') return;
        const next = addTurtleSoupDialogue(revealTurtleSoupAnswer(game), 'reveal', game.case.answer, 'host');
        await persistGame(next);
    }, [game, persistGame]);

    const declineInvite = useCallback(async (inv: TheaterTurtleSoupInvitation) => {
        const next = { ...inv, status: 'declined' as const, updatedAt: Date.now() };
        await DB.saveTheaterTurtleSoupInvitation(next);
        await updateInviteCardMessage(next, 'declined');
        setInvitations(prev => prev.map(i => i.id === inv.id ? next : i));
    }, []);

    const toggleSelected = useCallback((id: string) => {
        setSelectedIds(prev => {
            const without = prev.filter(x => x !== id);
            if (without.length !== prev.length) return without;
            return [...prev, id].slice(0, 5);
        });
    }, []);

    const toggleProactive = useCallback((char: CharacterProfile) => {
        updateCharacter(char.id, {
            convoSettings: {
                ...(char.convoSettings || {}),
                proactiveTurtleSoupInvite: !char.convoSettings?.proactiveTurtleSoupInvite,
            },
        });
    }, [updateCharacter]);

    if (game) {
        return (
            <PaperShell>
                <ScrapHeader
                    title="海龟汤"
                    en="TURTLE SOUP"
                    onBack={() => { setGame(null); void reload(); }}
                    right={<ScrapButton variant="ghost" className="h-9 px-3 text-[12px]" onClick={onExit}>幕间集</ScrapButton>}
                />
                <ScrapScroll className="px-4 pb-10">
                    <PlaySurface
                        game={game}
                        busy={busy}
                        input={input}
                        setInput={setInput}
                        onAsk={submitQuestion}
                        onGuess={submitGuess}
                        onReveal={reveal}
                        onEnd={async () => game && persistGame({ ...game, status: 'ended', endedAt: Date.now(), lastActiveAt: Date.now() })}
                        onRestart={() => {
                            const host = hostForGame(game);
                            const chars = game.players.map(p => p.charId ? characters.find(c => c.id === p.charId) : null).filter(Boolean) as CharacterProfile[];
                            void startGame(host, chars, game.difficultyMode);
                        }}
                    />
                </ScrapScroll>
            </PaperShell>
        );
    }

    return (
        <PaperShell>
            <ScrapHeader title="海龟汤" en="TURTLE SOUP" onBack={onExit} />
            <ScrapScroll className="px-4 pb-10">
                <div className="space-y-5">
                    <PaperCard className="px-5 py-5 overflow-hidden">
                        <div className="text-[9px] tracking-[0.32em] mb-1" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>ACT XIV</div>
                        <div className="text-[30px] font-black" style={{ color: INK }}>拾肆 · 海龟汤</div>
                        <p className="mt-2 text-[12.5px] leading-relaxed" style={{ color: '#5b554a' }}>
                            暗黑汤面，由系统或角色主持。主持人只答“是 / 否 / 无关”，你和角色们轮流提问、终猜，角色的猜题实力与对白由模型按完整设定判断。
                        </p>
                    </PaperCard>

                    {pendingInvites.length > 0 && (
                        <PaperCard className="px-4 py-4">
                            <SectionTag>待应汤局</SectionTag>
                            <div className="mt-3 space-y-2">
                                {pendingInvites.map(inv => {
                                    const inviter = playableChars.find(c => c.id === inv.charId) || null;
                                    const inviterAsHost = !!inviteHostIds[inv.id];
                                    const extraIds = inviteExtraIds[inv.id] || [];
                                    const extraChars = extraIds.map(id => playableChars.find(c => c.id === id)).filter(Boolean) as CharacterProfile[];
                                    const chars = inviterAsHost ? extraChars : [inviter, ...extraChars].filter(Boolean) as CharacterProfile[];
                                    return (
                                        <div key={inv.id} className={`rounded-[12px] border px-3 py-3 ${highlightInviteId === inv.id ? 'ring-2 ring-[#1f1d1a]' : ''}`} style={{ borderColor: 'rgba(31,29,26,0.16)', background: '#fffdfa' }}>
                                            <div className="flex items-start gap-3">
                                                <Avatar char={inviter} />
                                                <div className="min-w-0 flex-1">
                                                    <div className="text-[13px] font-black" style={{ color: INK }}>{inv.charName} 约你喝海龟汤</div>
                                                    <div className="mt-1 text-[12px] leading-relaxed" style={{ color: '#5b554a' }}>{inv.message || '来一碗海龟汤？'}</div>
                                                    <button onClick={() => setInviteHostIds(prev => ({ ...prev, [inv.id]: !prev[inv.id] }))} className="mt-2 w-full rounded-[10px] px-3 py-2 flex items-center justify-between" style={{ border: '1px dashed rgba(31,29,26,0.2)', background: '#fbfaf6', color: INK }}>
                                                        <span className="text-[12px] font-bold">让 {inv.charName} 当主持人</span>
                                                        <span className="text-[11px] font-black">{inviterAsHost ? '已选' : '不当'}</span>
                                                    </button>
                                                    <div className="mt-2 grid grid-cols-2 gap-1">
                                                        {playableChars.filter(c => c.id !== inv.charId).slice(0, 8).map(c => {
                                                            const on = extraIds.includes(c.id);
                                                            return (
                                                                <button key={c.id} onClick={() => setInviteExtraIds(prev => {
                                                                    const current = prev[inv.id] || [];
                                                                    const next = current.includes(c.id) ? current.filter(id => id !== c.id) : [...current, c.id].slice(0, inviterAsHost ? 5 : 4);
                                                                    return { ...prev, [inv.id]: next };
                                                                })} className="rounded-[9px] px-2 py-1 text-left text-[11px] font-bold" style={{ background: on ? INK : '#f1ede3', color: on ? '#f6f3ec' : INK }}>
                                                                    {charDisplay(c)}
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                    <div className="mt-2 flex gap-2">
                                                        <ScrapButton disabled={!inviter || chars.length < 1 || busy} onClick={() => inviter && void startGame(inviterAsHost ? inviter : null, chars, inv.difficultyMode || difficultyMode, { invitation: inv, inviteMessage: inv.message })}>接受</ScrapButton>
                                                        <ScrapButton variant="ghost" disabled={busy} onClick={() => void declineInvite(inv)}>婉拒</ScrapButton>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </PaperCard>
                    )}

                    <PaperCard className="px-4 py-4">
                        <SectionTag>开新汤</SectionTag>
                        {playableChars.length < 1 ? (
                            <div className="mt-3 text-[12.5px] leading-relaxed" style={{ color: '#7b7164' }}>至少需要一位正式角色一起猜海龟汤。</div>
                        ) : (
                            <div className="mt-3 space-y-3">
                                <label className="block">
                                    <div className="mb-1 text-[10px] font-black tracking-[0.2em]" style={{ color: INK_SOFT }}>主持人</div>
                                    <select value={hostId} onChange={e => {
                                        setHostId(e.target.value);
                                        if (e.target.value !== 'system') setSelectedIds(prev => prev.filter(id => id !== e.target.value));
                                    }} className="w-full rounded-[12px] border px-3 py-2 text-[12px] font-bold" style={{ borderColor: 'rgba(31,29,26,0.18)', background: '#fffdfa', color: INK }}>
                                        <option value="system">系统主持</option>
                                        {playableChars.map(c => <option key={c.id} value={c.id}>角色主持：{charDisplay(c)}</option>)}
                                    </select>
                                </label>
                                <div>
                                    <div className="mb-2 text-[10px] font-black tracking-[0.2em]" style={{ color: INK_SOFT }}>猜题角色（1–5 位）</div>
                                    <div className="grid grid-cols-2 gap-2">
                                        {playableChars.filter(c => c.id !== hostChar?.id).map(c => {
                                            const on = selectedIds.includes(c.id);
                                            return (
                                                <button key={c.id} onClick={() => toggleSelected(c.id)} className="rounded-[12px] px-3 py-2 text-left active:scale-[0.99]" style={{ background: on ? INK : '#fffdfa', color: on ? '#f6f3ec' : INK, border: '1px solid rgba(31,29,26,0.16)' }}>
                                                    <div className="text-[12px] font-black truncate">{charDisplay(c)}</div>
                                                    <div className="mt-1 text-[10px] opacity-75">{c.convoSettings?.proactiveTurtleSoupInvite ? '可主动约汤' : '主动约汤关闭'}</div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    {modeOptions.map(opt => (
                                        <button key={opt.id} onClick={() => setDifficultyMode(opt.id)} className="rounded-[12px] px-3 py-2 text-left active:scale-[0.99]" style={{ background: difficultyMode === opt.id ? INK : '#fffdfa', color: difficultyMode === opt.id ? '#f6f3ec' : INK, border: '1px solid rgba(31,29,26,0.16)' }}>
                                            <div className="text-[12px] font-black">{opt.label}</div>
                                            <div className="mt-1 text-[10.5px] leading-snug opacity-75">{opt.note}</div>
                                        </button>
                                    ))}
                                </div>
                                <ScrapButton disabled={playerChars.length < 1 || busy} onClick={() => void startGame(hostChar, playerChars, difficultyMode)}>
                                    <Play size={15} weight="fill" /> 生成汤面
                                </ScrapButton>
                                {playerChars[0] && (
                                    <button onClick={() => toggleProactive(playerChars[0])} className="w-full rounded-[12px] px-3 py-2 flex items-center justify-between" style={{ border: '1px dashed rgba(31,29,26,0.2)', background: '#fffdfa', color: INK }}>
                                        <span className="text-[12px] font-bold">允许 {charDisplay(playerChars[0])} 主动约海龟汤</span>
                                        <span className="text-[11px] font-black">{playerChars[0].convoSettings?.proactiveTurtleSoupInvite ? '已开' : '关闭'}</span>
                                    </button>
                                )}
                            </div>
                        )}
                    </PaperCard>

                    <PaperCard className="px-4 py-4">
                        <SectionTag>待续与记录</SectionTag>
                        <div className="mt-3 space-y-2">
                            {activeGames.length === 0 && games.length === 0 && <div className="text-[12px]" style={{ color: INK_SOFT }}>还没有汤局。</div>}
                            {[...activeGames, ...games.filter(g => g.status !== 'playing').slice(0, 8)].map(g => (
                                <button key={g.id} onClick={() => setGame(normalizeTurtleSoupGame(g))} className="w-full rounded-[12px] border px-3 py-3 text-left" style={{ borderColor: 'rgba(31,29,26,0.14)', background: '#fffdfa' }}>
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="text-[13px] font-black truncate" style={{ color: INK }}>{g.title || g.case?.title || '一碗海龟汤'}</div>
                                        <Stamp>{g.status === 'playing' ? '待续' : g.status === 'solved' ? '解出' : '终局'}</Stamp>
                                    </div>
                                    <div className="mt-1 text-[11px]" style={{ color: INK_SOFT }}>{g.turns?.length || 0} 问 · {fmtTime(g.lastActiveAt || g.createdAt)}</div>
                                </button>
                            ))}
                        </div>
                    </PaperCard>
                </div>
            </ScrapScroll>
        </PaperShell>
    );
};

const Avatar: React.FC<{ char?: CharacterProfile | null; fallback?: string }> = ({ char, fallback }) => (
    <div className="h-10 w-10 shrink-0 overflow-hidden rounded-[12px]" style={{ background: '#e6e1d8', border: '1px solid rgba(31,29,26,0.18)' }}>
        {char?.avatar ? <img src={char.avatar} alt="" className="h-full w-full object-cover grayscale" /> : <div className="h-full w-full flex items-center justify-center text-[15px] font-black" style={{ color: INK }}>{(char?.name || fallback || '?').slice(0, 1)}</div>}
    </div>
);

const PlaySurface: React.FC<{
    game: TheaterTurtleSoupGame;
    busy: boolean;
    input: string;
    setInput: (value: string) => void;
    onAsk: () => void;
    onGuess: () => void;
    onReveal: () => void;
    onEnd: () => void;
    onRestart: () => void;
}> = ({ game, busy, input, setInput, onAsk, onGuess, onReveal, onEnd, onRestart }) => {
    const canAct = !busy && game.status === 'playing' && game.currentSpeakerId === 'user';
    const latestDialogue = [...(game.dialogue || [])].slice(-8).reverse();
    const turns = [...(game.turns || [])].slice(-18).reverse();
    const revealed = game.status !== 'playing';

    return (
        <div className="space-y-4">
            <PaperCard className="px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <div className="text-[10px] tracking-[0.24em]" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>TURTLE SOUP</div>
                        <div className="text-[22px] font-black truncate" style={{ color: INK }}>{game.case.title}</div>
                    </div>
                    <Stamp>{TURTLE_SOUP_DIFFICULTY_MODE_LABELS[game.difficultyMode]}</Stamp>
                </div>
                <p className="mt-3 text-[13px] leading-relaxed" style={{ color: '#4e493f' }}>{game.case.surface}</p>
                <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]" style={{ color: '#5b554a' }}>
                    <div className="rounded-[10px] px-2 py-2 bg-[#fffdfa] border border-black/10">主持：{game.host.name}</div>
                    <div className="rounded-[10px] px-2 py-2 bg-[#fffdfa] border border-black/10">当前：{turtleSoupPlayerName(game, game.currentSpeakerId)}</div>
                </div>
                {!!game.case.contentWarnings?.length && (
                    <div className="mt-2 text-[10px]" style={{ color: INK_SOFT }}>主题提示：{game.case.contentWarnings.join(' / ')}</div>
                )}
            </PaperCard>

            <PaperCard className="px-4 py-4">
                <SectionTag>玩家</SectionTag>
                <div className="mt-3 grid grid-cols-2 gap-2">
                    {game.players.map((p: TurtleSoupPlayer) => (
                        <div key={p.id} className="rounded-[12px] px-3 py-2" style={{ background: game.currentSpeakerId === p.id ? INK : '#fffdfa', color: game.currentSpeakerId === p.id ? '#f6f3ec' : INK, border: '1px solid rgba(31,29,26,0.14)' }}>
                            <div className="text-[12px] font-black truncate">{p.name}</div>
                            <div className="mt-1 text-[10px] opacity-75">{p.isUser ? '你' : TURTLE_SOUP_DIFFICULTY_LABELS[game.difficultyLevels[p.id] || 'steady']}</div>
                        </div>
                    ))}
                </div>
            </PaperCard>

            <PaperCard className="px-4 py-4">
                <SectionTag>提问记录</SectionTag>
                <div className="mt-3 space-y-2">
                    {turns.length === 0 && <div className="text-[12px]" style={{ color: INK_SOFT }}>还没有人提问。</div>}
                    {turns.map(turn => (
                        <div key={turn.no} className="rounded-[12px] px-3 py-2" style={{ background: '#fffdfa', border: '1px solid rgba(31,29,26,0.12)' }}>
                            <div className="flex items-center justify-between gap-2">
                                <div className="text-[10px] font-black" style={{ color: INK_SOFT }}>{turn.byName} · {turn.kind === 'final_guess' ? '终猜' : turn.kind === 'reveal' ? '揭晓' : '提问'}</div>
                                {turn.verdict && <Stamp>{TURTLE_SOUP_VERDICT_LABELS[turn.verdict]}</Stamp>}
                                {turn.result && <Stamp>{turn.result === 'correct' ? '答对' : turn.result === 'close' ? '接近' : '不对'}</Stamp>}
                            </div>
                            <div className="mt-1 text-[12.5px] leading-relaxed" style={{ color: INK }}>{turn.text}</div>
                            {turn.hostText && <div className="mt-1 text-[11px] font-bold" style={{ color: '#5b554a' }}>主持：{turn.hostText}</div>}
                        </div>
                    ))}
                </div>
            </PaperCard>

            <PaperCard className="px-4 py-4">
                <SectionTag>对白</SectionTag>
                <div className="mt-3 space-y-2">
                    {latestDialogue.length === 0 && <div className="text-[12px]" style={{ color: INK_SOFT }}>汤局还很安静。</div>}
                    {latestDialogue.map(line => (
                        <div key={line.id} className="rounded-[12px] px-3 py-2" style={{ background: line.by === 'host' || line.by === 'system' ? '#f1ede3' : '#fffdfa', border: '1px solid rgba(31,29,26,0.12)' }}>
                            <div className="text-[10px] font-black" style={{ color: INK_SOFT }}>{line.byName}</div>
                            <div className="text-[12.5px] leading-relaxed" style={{ color: INK }}>{line.text}</div>
                        </div>
                    ))}
                </div>
            </PaperCard>

            {game.status === 'playing' && (
                <PaperCard className="px-4 py-4">
                    <SectionTag>你的行动</SectionTag>
                    <textarea
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        placeholder={canAct ? '写一个是/否问题，或直接写终猜。' : busy ? '角色正在思考。' : '还没轮到你。'}
                        disabled={!canAct}
                        className="mt-3 min-h-[92px] w-full rounded-[12px] border px-3 py-3 text-[13px] leading-relaxed outline-none resize-none"
                        style={{ borderColor: 'rgba(31,29,26,0.18)', background: '#fffdfa', color: INK }}
                    />
                    <div className="mt-3 grid grid-cols-2 gap-2">
                        <ScrapButton disabled={!canAct || !input.trim()} onClick={onAsk}><Question size={15} /> 问主持</ScrapButton>
                        <ScrapButton disabled={!canAct || !input.trim()} onClick={onGuess}><SealCheck size={15} /> 终猜</ScrapButton>
                    </div>
                </PaperCard>
            )}

            {revealed && (
                <PaperCard className="px-4 py-4">
                    <SectionTag>汤底</SectionTag>
                    <p className="mt-3 text-[13px] leading-relaxed" style={{ color: INK }}>{game.case.answer}</p>
                </PaperCard>
            )}

            <div className="grid grid-cols-3 gap-2">
                <ScrapButton variant="ghost" disabled={busy || game.status !== 'playing'} onClick={onReveal}><Eye size={15} /> 揭晓</ScrapButton>
                <ScrapButton variant="ghost" disabled={busy || game.status !== 'playing'} onClick={onEnd}><Flag size={15} /> 收局</ScrapButton>
                <ScrapButton variant="ghost" disabled={busy} onClick={onRestart}><ArrowClockwise size={15} /> 重开</ScrapButton>
            </div>
        </div>
    );
};

export default TurtleSoupApp;
