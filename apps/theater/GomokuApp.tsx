import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowClockwise, Flag, Play } from '@phosphor-icons/react';
import { useOS } from '../../context/OSContext';
import type { CharacterProfile, GomokuDifficultyMode, GomokuMoveEvent, Message, TheaterGomokuGame, TheaterGomokuInvitation } from '../../types';
import { PaperShell, ScrapScroll, ScrapHeader, PaperCard, ScrapButton, SectionTag, Stamp, INK, INK_SOFT } from '../ui/insScrapKit';
import { DB } from '../../utils/db';
import { resolveAuxApi } from '../../utils/auxApi';
import {
    GOMOKU_BOARD_SIZE,
    GOMOKU_DIFFICULTY_LABELS,
    GOMOKU_DIFFICULTY_MODE_LABELS,
    addGomokuDialogue,
    applyGomokuMove,
    chooseGomokuMove,
    createGomokuGame,
    decideGomokuOpeningDifficulty,
    decideGomokuPerMoveDifficulty,
    fallbackGomokuDialogue,
    generateGomokuDialogue,
    normalizeGomokuGame,
    stoneForRole,
} from '../../utils/theaterGomoku';

export interface GomokuLaunchPayload {
    invitationId?: string;
    charId?: string;
    gameId?: string;
}

interface GomokuAppProps {
    onExit: () => void;
    launch?: GomokuLaunchPayload | null;
}

const modeOptions: Array<{ id: GomokuDifficultyMode; label: string; note: string }> = [
    { id: 'opening', label: '开局定档', note: '模型开局判断 TA 这一整局的棋力。' },
    { id: 'per_move', label: '每步评估', note: '每次 TA 落子前按局势重新判断。' },
];

const fmtTime = (ts?: number) => ts ? new Date(ts).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '刚刚';
const charDisplay = (char?: CharacterProfile | null) => char?.convoSettings?.remarkName?.trim() || char?.name || '某人';

const updateInviteCardMessage = async (invitation: TheaterGomokuInvitation, status: TheaterGomokuInvitation['status'], acceptedGameId?: string) => {
    try {
        const messages = await DB.getMessagesByCharId(invitation.charId, true);
        const target = [...messages].reverse().find((m: Message) => (m.metadata as any)?.gomokuInvite?.invitationId === invitation.id);
        if (!target?.id) return;
        await DB.updateMessageMetadata(target.id, (prev: any) => ({
            ...(prev || {}),
            gomokuInvite: {
                ...(prev?.gomokuInvite || {}),
                status,
                acceptedGameId,
            },
        }));
    } catch { /* ignore */ }
};

const GomokuApp: React.FC<GomokuAppProps> = ({ onExit, launch }) => {
    const { characters, userProfile, apiConfig, auxApiConfig, updateCharacter, addToast } = useOS();
    const [games, setGames] = useState<TheaterGomokuGame[]>([]);
    const [invitations, setInvitations] = useState<TheaterGomokuInvitation[]>([]);
    const [selectedCharId, setSelectedCharId] = useState<string>('');
    const [difficultyMode, setDifficultyMode] = useState<GomokuDifficultyMode>('opening');
    const [game, setGame] = useState<TheaterGomokuGame | null>(null);
    const [busy, setBusy] = useState(false);
    const [highlightInviteId, setHighlightInviteId] = useState<string | undefined>();

    const api = useMemo(() => resolveAuxApi(auxApiConfig, apiConfig), [apiConfig, auxApiConfig]);
    const userName = userProfile?.name || '你';
    const selectedChar = useMemo(() => characters.find(c => c.id === selectedCharId) || characters[0] || null, [characters, selectedCharId]);
    const activeGames = useMemo(() => games.filter(g => g.status !== 'ended'), [games]);
    const pendingInvites = useMemo(() => invitations.filter(i => i.status === 'pending'), [invitations]);

    const reload = useCallback(async () => {
        const [allGames, allInvites] = await Promise.all([
            DB.getAllTheaterGomokuGames().catch(() => []),
            DB.getAllTheaterGomokuInvitations().catch(() => []),
        ]);
        setGames(allGames.map(normalizeGomokuGame));
        setInvitations(allInvites);
    }, []);

    useEffect(() => { void reload(); }, [reload]);

    useEffect(() => {
        if (selectedCharId || !characters.length) return;
        setSelectedCharId(launch?.charId || characters[0].id);
    }, [characters, launch?.charId, selectedCharId]);

    useEffect(() => {
        let alive = true;
        const openLaunch = async () => {
            if (!launch) return;
            if (launch.charId) setSelectedCharId(launch.charId);
            if (launch.invitationId) {
                setHighlightInviteId(launch.invitationId);
                return;
            }
            if (launch.gameId) {
                const found = await DB.getTheaterGomokuGame(launch.gameId);
                if (alive && found) setGame(normalizeGomokuGame(found));
            }
        };
        void openLaunch();
        return () => { alive = false; };
    }, [launch]);

    const persistGame = useCallback(async (next: TheaterGomokuGame) => {
        const clean = normalizeGomokuGame(next);
        setGame(clean);
        await DB.saveTheaterGomokuGame(clean);
        setGames(prev => [clean, ...prev.filter(g => g.id !== clean.id)].sort((a, b) => b.lastActiveAt - a.lastActiveAt));
    }, []);

    const charTurn = useCallback(async (input: TheaterGomokuGame, seedEvents: GomokuMoveEvent[] = []) => {
        const clean = normalizeGomokuGame(input);
        if (clean.status === 'ended' || clean.currentTurn !== 'char') return clean;
        const char = characters.find(c => c.id === clean.charId);
        if (!char) return clean;
        setBusy(true);
        let thinking = addGomokuDialogue(clean, 'thinking', fallbackGomokuDialogue('thinking', char.name), 'char', undefined);
        await persistGame(thinking);
        let level = thinking.difficultyLevel;
        if (thinking.difficultyMode === 'per_move') {
            const assessed = await decideGomokuPerMoveDifficulty(char, userProfile, api, thinking, seedEvents);
            level = assessed.difficultyLevel;
            thinking = { ...thinking, difficultyLevel: level };
        }
        const picked = chooseGomokuMove(thinking, level);
        const applied = applyGomokuMove(thinking, picked.row, picked.col, 'char');
        if (!applied.ok) {
            const fallback = chooseGomokuMove({ ...thinking, moves: thinking.moves, charStone: thinking.charStone, boardSize: thinking.boardSize }, 'master');
            const retry = applyGomokuMove(thinking, fallback.row, fallback.col, 'char');
            if (!retry.ok) {
                setBusy(false);
                return thinking;
            }
            const text = await generateGomokuDialogue(char, userProfile, api, retry.game, retry.events, retry.move);
            const withLine = addGomokuDialogue(retry.game, retry.events[0] || 'normal', text, 'char', retry.move.no);
            await persistGame(withLine);
            setBusy(false);
            return withLine;
        }
        const text = await generateGomokuDialogue(char, userProfile, api, applied.game, applied.events, applied.move);
        const withLine = addGomokuDialogue(applied.game, applied.events[0] || 'normal', text, 'char', applied.move.no);
        await persistGame(withLine);
        setBusy(false);
        return withLine;
    }, [api, characters, persistGame, userProfile]);

    const startGame = useCallback(async (char: CharacterProfile, mode: GomokuDifficultyMode, opts?: { invitation?: TheaterGomokuInvitation; charStarts?: boolean }) => {
        setBusy(true);
        try {
            const assessed = await decideGomokuOpeningDifficulty(char, userProfile, api, mode, !!opts?.invitation);
            let next = createGomokuGame(userName, char, {
                difficultyMode: mode,
                difficultyLevel: assessed.difficultyLevel,
                charStarts: !!opts?.charStarts,
                invitationId: opts?.invitation?.id,
            });
            const opening = assessed.reason
                ? `我按自己的感觉来下。${GOMOKU_DIFFICULTY_LABELS[assessed.difficultyLevel]}档，理由先不告诉你。`
                : fallbackGomokuDialogue('invite', char.name);
            next = addGomokuDialogue(next, 'invite', opts?.invitation?.message || opening, 'char');
            await persistGame(next);
            if (opts?.invitation) {
                const accepted = { ...opts.invitation, status: 'accepted' as const, acceptedGameId: next.id, updatedAt: Date.now() };
                await DB.saveTheaterGomokuInvitation(accepted);
                await updateInviteCardMessage(accepted, 'accepted', next.id);
                setInvitations(prev => prev.map(i => i.id === accepted.id ? accepted : i));
            }
            addToast(`五子棋开局：${charDisplay(char)} · ${GOMOKU_DIFFICULTY_LABELS[assessed.difficultyLevel]}`, 'success');
            if (next.currentTurn === 'char') await charTurn(next);
        } catch {
            addToast('五子棋开局失败了，稍后再试一次', 'error');
        } finally {
            setBusy(false);
        }
    }, [addToast, api, charTurn, persistGame, userName, userProfile]);

    const onUserMove = useCallback(async (row: number, col: number) => {
        if (!game || busy || game.status === 'ended' || game.currentTurn !== 'user') return;
        const char = characters.find(c => c.id === game.charId);
        if (!char) return;
        setBusy(true);
        const applied = applyGomokuMove(game, row, col, 'user');
        if (!applied.ok) {
            const warned = addGomokuDialogue(game, 'illegal', applied.reason, 'system');
            await persistGame(warned);
            setBusy(false);
            return;
        }
        const text = await generateGomokuDialogue(char, userProfile, api, applied.game, applied.events, applied.move);
        const withLine = addGomokuDialogue(applied.game, applied.events[0] || 'normal', text, 'char', applied.move.no);
        await persistGame(withLine);
        if (withLine.status !== 'ended') {
            await charTurn(withLine, applied.events);
        } else {
            setBusy(false);
        }
    }, [api, busy, charTurn, characters, game, persistGame, userProfile]);

    const resign = useCallback(async () => {
        if (!game || game.status === 'ended') return;
        const ended = addGomokuDialogue({ ...game, status: 'ended', winner: 'char', endedAt: Date.now(), lastActiveAt: Date.now() }, 'lose', '我认输。这局算你赢。', 'system');
        await persistGame(ended);
    }, [game, persistGame]);

    const declineInvite = useCallback(async (inv: TheaterGomokuInvitation) => {
        const next = { ...inv, status: 'declined' as const, updatedAt: Date.now() };
        await DB.saveTheaterGomokuInvitation(next);
        await updateInviteCardMessage(next, 'declined');
        setInvitations(prev => prev.map(i => i.id === inv.id ? next : i));
    }, []);

    const toggleProactive = useCallback((char: CharacterProfile) => {
        updateCharacter(char.id, {
            convoSettings: {
                ...(char.convoSettings || {}),
                proactiveGomokuInvite: !char.convoSettings?.proactiveGomokuInvite,
            },
        });
    }, [updateCharacter]);

    if (game) {
        const char = characters.find(c => c.id === game.charId) || null;
        return (
            <PaperShell>
                <ScrapHeader
                    title="五子棋"
                    en="GOMOKU"
                    onBack={() => { setGame(null); void reload(); }}
                    right={<ScrapButton variant="ghost" className="h-9 px-3 text-[12px]" onClick={onExit}>幕间集</ScrapButton>}
                />
                <ScrapScroll className="px-4 pb-10">
                    <PlaySurface
                        game={game}
                        char={char}
                        userName={userName}
                        busy={busy}
                        onMove={onUserMove}
                        onResign={resign}
                        onRestart={() => char && void startGame(char, game.difficultyMode, { charStarts: game.charStone === 'black' })}
                    />
                </ScrapScroll>
            </PaperShell>
        );
    }

    return (
        <PaperShell>
            <ScrapHeader title="五子棋" en="GOMOKU" onBack={onExit} />
            <ScrapScroll className="px-4 pb-10">
                <div className="space-y-5">
                    <PaperCard className="px-5 py-5 overflow-hidden">
                        <div className="text-[9px] tracking-[0.32em] mb-1" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>ACT XI</div>
                        <div className="text-[30px] font-black" style={{ color: INK }}>拾壹 · 五子棋</div>
                        <p className="mt-2 text-[12.5px] leading-relaxed" style={{ color: '#5b554a' }}>
                            15x15 休闲规则，无禁手；五连或长连即胜。TA 的棋力由模型按完整设定判断，本地棋盘负责合法落子和兜底。
                        </p>
                    </PaperCard>

                    {pendingInvites.length > 0 && (
                        <section>
                            <SectionTag en="INVITES">待处理邀请</SectionTag>
                            <div className="mt-3 space-y-3">
                                {pendingInvites.map(inv => {
                                    const char = characters.find(c => c.id === inv.charId);
                                    const highlighted = inv.id === highlightInviteId;
                                    return (
                                        <PaperCard key={inv.id} className={`px-4 py-4 ${highlighted ? 'ring-2 ring-[#1f1d1a]' : ''}`}>
                                            <div className="flex items-start gap-3">
                                                <Avatar char={char} />
                                                <div className="min-w-0 flex-1">
                                                    <div className="text-[14px] font-black" style={{ color: INK }}>{inv.charName} 约你下一局</div>
                                                    <div className="mt-1 text-[12px] leading-relaxed" style={{ color: '#5b554a' }}>{inv.message || '要不要来一局五子棋？'}</div>
                                                    <div className="mt-1 text-[10px]" style={{ color: INK_SOFT }}>{GOMOKU_DIFFICULTY_MODE_LABELS[inv.difficultyMode || difficultyMode]} · {fmtTime(inv.createdAt)}</div>
                                                </div>
                                            </div>
                                            <div className="mt-3 flex gap-2">
                                                <ScrapButton className="h-9 px-4 text-[12px] flex-1" disabled={busy || !char} onClick={() => char && startGame(char, inv.difficultyMode || difficultyMode, { invitation: inv, charStarts: true })}>接受</ScrapButton>
                                                <ScrapButton variant="ghost" className="h-9 px-4 text-[12px]" disabled={busy} onClick={() => declineInvite(inv)}>婉拒</ScrapButton>
                                            </div>
                                        </PaperCard>
                                    );
                                })}
                            </div>
                        </section>
                    )}

                    <section>
                        <SectionTag en="NEW GAME">手动开局</SectionTag>
                        <PaperCard className="mt-3 px-4 py-4">
                            <div className="text-[12px] font-black mb-2" style={{ color: INK }}>选择对手</div>
                            <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                                {characters.map(c => (
                                    <button key={c.id} onClick={() => setSelectedCharId(c.id)} className="shrink-0 text-left active:scale-95 transition">
                                        <div className="w-[88px] rounded-[14px] px-2 py-2" style={{ background: selectedCharId === c.id ? '#1f1d1a' : '#fffdfa', color: selectedCharId === c.id ? '#fff' : INK, border: '1px solid rgba(31,29,26,0.1)' }}>
                                            <img src={c.convoSettings?.charAvatarOverride || c.avatar} className="h-12 w-12 rounded-full object-cover mx-auto" />
                                            <div className="mt-1 text-[11px] font-black truncate text-center">{charDisplay(c)}</div>
                                        </div>
                                    </button>
                                ))}
                            </div>
                            <div className="mt-4 grid grid-cols-2 gap-2">
                                {modeOptions.map(opt => (
                                    <button key={opt.id} onClick={() => setDifficultyMode(opt.id)} className="rounded-[14px] px-3 py-3 text-left active:scale-[0.98]" style={{ background: difficultyMode === opt.id ? '#f4efe2' : '#fffdfa', border: '1px solid rgba(31,29,26,0.1)' }}>
                                        <div className="text-[12px] font-black" style={{ color: INK }}>{opt.label}</div>
                                        <div className="mt-1 text-[10px] leading-relaxed" style={{ color: INK_SOFT }}>{opt.note}</div>
                                    </button>
                                ))}
                            </div>
                            {selectedChar && (
                                <div className="mt-4 flex items-center justify-between gap-3 rounded-[14px] px-3 py-3" style={{ background: '#fffdfa', border: '1px solid rgba(31,29,26,0.08)' }}>
                                    <div className="min-w-0">
                                        <div className="text-[12px] font-black" style={{ color: INK }}>允许 TA 主动约棋</div>
                                        <div className="text-[10px] mt-0.5" style={{ color: INK_SOFT }}>旧角色默认关闭；打开后聊天主动消息可生成邀请卡。</div>
                                    </div>
                                    <button onClick={() => toggleProactive(selectedChar)} className="relative h-7 w-12 shrink-0 rounded-full transition" style={{ background: selectedChar.convoSettings?.proactiveGomokuInvite ? '#1f1d1a' : '#e6e1d8' }}>
                                        <span className="absolute top-1 h-5 w-5 rounded-full bg-white transition-all" style={{ left: selectedChar.convoSettings?.proactiveGomokuInvite ? 24 : 4 }} />
                                    </button>
                                </div>
                            )}
                            <ScrapButton className="mt-4 h-11 w-full text-[13px]" disabled={!selectedChar || busy} icon={busy ? <ArrowClockwise className="animate-spin" size={16} /> : <Play size={16} weight="fill" />} onClick={() => selectedChar && startGame(selectedChar, difficultyMode, { charStarts: false })}>
                                用户执黑开局
                            </ScrapButton>
                        </PaperCard>
                    </section>

                    {activeGames.length > 0 && (
                        <section>
                            <SectionTag en="CONTINUE">待续棋局</SectionTag>
                            <div className="mt-3 space-y-3">
                                {activeGames.slice(0, 5).map(g => (
                                    <PaperCard key={g.id} onClick={() => setGame(normalizeGomokuGame(g))} className="px-4 py-3 flex items-center gap-3">
                                        <Stamp size={38}>五</Stamp>
                                        <div className="min-w-0 flex-1">
                                            <div className="text-[13px] font-black truncate" style={{ color: INK }}>{g.charName}</div>
                                            <div className="text-[10.5px] mt-0.5 truncate" style={{ color: INK_SOFT }}>{g.moves.length} 手 · {GOMOKU_DIFFICULTY_LABELS[g.difficultyLevel]} · {g.currentTurn === 'user' ? '轮到你' : '轮到 TA'}</div>
                                        </div>
                                        <div className="text-[9px]" style={{ color: INK_SOFT }}>{fmtTime(g.lastActiveAt)}</div>
                                    </PaperCard>
                                ))}
                            </div>
                        </section>
                    )}
                </div>
            </ScrapScroll>
        </PaperShell>
    );
};

const Avatar: React.FC<{ char?: CharacterProfile | null }> = ({ char }) => (
    <div className="h-11 w-11 shrink-0 overflow-hidden rounded-full" style={{ background: '#e8e1d5', border: '1px solid rgba(31,29,26,0.12)' }}>
        {char?.avatar ? <img src={char.convoSettings?.charAvatarOverride || char.avatar} className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center font-black">五</div>}
    </div>
);

const PlaySurface: React.FC<{
    game: TheaterGomokuGame;
    char: CharacterProfile | null;
    userName: string;
    busy: boolean;
    onMove: (row: number, col: number) => void;
    onResign: () => void;
    onRestart: () => void;
}> = ({ game, char, userName, busy, onMove, onResign, onRestart }) => {
    const board = useMemo(() => {
        const rows = Array.from({ length: game.boardSize || GOMOKU_BOARD_SIZE }, () => Array<'black' | 'white' | null>(game.boardSize || GOMOKU_BOARD_SIZE).fill(null));
        game.moves.forEach(m => { if (rows[m.row]?.[m.col] === null) rows[m.row][m.col] = m.stone; });
        return rows;
    }, [game]);
    const last = game.moves[game.moves.length - 1];
    const userStone = stoneForRole(game, 'user');
    const charStone = stoneForRole(game, 'char');
    const turnLabel = game.status === 'ended'
        ? game.winner === 'draw' ? '平局' : game.winner === 'user' ? `${userName} 胜` : `${game.charName} 胜`
        : game.currentTurn === 'user' ? '轮到你落子' : `${game.charName} 正在想`;
    return (
        <div className="space-y-4">
            <PaperCard className="px-4 py-4">
                <div className="flex items-center gap-3">
                    <Avatar char={char} />
                    <div className="min-w-0 flex-1">
                        <div className="text-[16px] font-black" style={{ color: INK }}>{game.charName} vs {userName}</div>
                        <div className="text-[10px] mt-0.5" style={{ color: INK_SOFT }}>
                            {GOMOKU_DIFFICULTY_MODE_LABELS[game.difficultyMode]} · {GOMOKU_DIFFICULTY_LABELS[game.difficultyLevel]} · TA 执{charStone === 'black' ? '黑' : '白'}，你执{userStone === 'black' ? '黑' : '白'}
                        </div>
                    </div>
                    <div className="text-right">
                        <div className="text-[12px] font-black" style={{ color: INK }}>{turnLabel}</div>
                        <div className="text-[9px]" style={{ color: INK_SOFT }}>{game.moves.length} 手</div>
                    </div>
                </div>
            </PaperCard>

            <PaperCard className="p-3">
                <div className="mx-auto aspect-square w-full max-w-[min(92vw,560px)] rounded-[14px] p-[10px]" style={{ background: '#d8c39b', border: '1px solid rgba(31,29,26,0.20)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.25)' }}>
                    <div
                        className="grid h-full w-full"
                        style={{
                            gridTemplateColumns: `repeat(${game.boardSize || GOMOKU_BOARD_SIZE}, minmax(0, 1fr))`,
                            gridTemplateRows: `repeat(${game.boardSize || GOMOKU_BOARD_SIZE}, minmax(0, 1fr))`,
                            backgroundImage: 'linear-gradient(rgba(31,29,26,0.42) 1px, transparent 1px), linear-gradient(90deg, rgba(31,29,26,0.42) 1px, transparent 1px)',
                            backgroundSize: `${100 / ((game.boardSize || GOMOKU_BOARD_SIZE) - 1)}% ${100 / ((game.boardSize || GOMOKU_BOARD_SIZE) - 1)}%`,
                            backgroundPosition: 'center',
                        }}
                    >
                        {board.flatMap((row, r) => row.map((stone, c) => {
                            const isLast = last?.row === r && last?.col === c;
                            const inWin = game.winLine?.some(p => p.row === r && p.col === c);
                            return (
                                <button
                                    key={`${r}-${c}`}
                                    className="relative flex items-center justify-center rounded-full outline-none"
                                    disabled={busy || game.status === 'ended' || game.currentTurn !== 'user' || !!stone}
                                    onClick={() => onMove(r, c)}
                                    aria-label={`第 ${r + 1} 行第 ${c + 1} 列`}
                                >
                                    {stone && (
                                        <span
                                            className="block h-[76%] w-[76%] rounded-full"
                                            style={{
                                                background: stone === 'black' ? '#1d1b18' : '#fffaf0',
                                                border: stone === 'black' ? '1px solid #050505' : '1px solid rgba(31,29,26,0.28)',
                                                boxShadow: stone === 'black' ? '0 2px 5px rgba(0,0,0,0.35)' : '0 2px 5px rgba(64,42,20,0.18)',
                                                outline: inWin ? '2px solid #e85f7a' : isLast ? '2px solid rgba(255,255,255,0.9)' : undefined,
                                            }}
                                        />
                                    )}
                                </button>
                            );
                        }))}
                    </div>
                </div>
            </PaperCard>

            <div className="grid grid-cols-3 gap-2">
                <ScrapButton variant="ghost" className="h-10 text-[12px]" icon={<Flag size={15} />} disabled={game.status === 'ended' || busy} onClick={onResign}>认输</ScrapButton>
                <ScrapButton variant="paper" className="h-10 text-[12px] col-span-2" icon={<ArrowClockwise size={15} />} disabled={busy} onClick={onRestart}>按本局设置重开</ScrapButton>
            </div>

            <section>
                <SectionTag en="DIALOGUE">棋盘旁白</SectionTag>
                <div className="mt-3 space-y-2">
                    {(game.dialogue || []).slice(-8).map(line => (
                        <div key={line.id} className={`flex ${line.by === 'system' ? 'justify-center' : 'justify-start'}`}>
                            <div className="max-w-[88%] rounded-[14px] px-3 py-2 text-[12px] leading-relaxed" style={line.by === 'system' ? { background: 'rgba(31,29,26,0.06)', color: INK_SOFT } : { background: '#fffdfa', color: INK, border: '1px solid rgba(31,29,26,0.08)' }}>
                                {line.by === 'char' && <span className="mr-1 font-black">{game.charName}：</span>}{line.text}
                            </div>
                        </div>
                    ))}
                    {!(game.dialogue || []).length && (
                        <PaperCard className="px-4 py-4 text-[12px]" style={{ color: INK_SOFT }}>棋盘还很安静，第一颗棋子落下后，TA 会开始说话。</PaperCard>
                    )}
                </div>
            </section>
        </div>
    );
};

export default GomokuApp;
