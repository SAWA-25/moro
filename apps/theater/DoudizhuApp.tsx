import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowClockwise, Flag, Play } from '@phosphor-icons/react';
import { useOS } from '../../context/OSContext';
import type { CharacterProfile, DoudizhuCard, DoudizhuDifficultyMode, DoudizhuMoveEvent, DoudizhuPlayerRole, Message, TheaterDoudizhuGame, TheaterDoudizhuInvitation } from '../../types';
import { PaperShell, ScrapScroll, ScrapHeader, PaperCard, ScrapButton, SectionTag, Stamp, INK, INK_SOFT } from '../ui/insScrapKit';
import { DB } from '../../utils/db';
import { resolveAuxApi } from '../../utils/auxApi';
import {
    DOUDIZHU_DIFFICULTY_LABELS,
    DOUDIZHU_DIFFICULTY_MODE_LABELS,
    DOUDIZHU_ROLES,
    addDoudizhuDialogue,
    analyzeDoudizhuCards,
    applyDoudizhuBid,
    applyDoudizhuPlay,
    chooseDoudizhuBid,
    chooseDoudizhuMove,
    createDoudizhuGame,
    decideDoudizhuOpeningDifficulty,
    decideDoudizhuPerMoveDifficulty,
    doudizhuCampOf,
    doudizhuRoleName,
    fallbackDoudizhuDialogue,
    formatDoudizhuCards,
    generateDoudizhuDialogue,
    normalizeDoudizhuGame,
    resignDoudizhuGame,
    sortDoudizhuCards,
} from '../../utils/theaterDoudizhu';

export interface DoudizhuLaunchPayload {
    invitationId?: string;
    charId?: string;
    gameId?: string;
}

interface DoudizhuAppProps {
    onExit: () => void;
    launch?: DoudizhuLaunchPayload | null;
}

const modeOptions: Array<{ id: DoudizhuDifficultyMode; label: string; note: string }> = [
    { id: 'opening', label: '开局定档', note: '模型开局判断两位角色整局牌力。' },
    { id: 'per_move', label: '每手评估', note: '每次角色行动前按局势重新判断。' },
];

const fmtTime = (ts?: number) => ts ? new Date(ts).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '刚刚';
const charDisplay = (char?: CharacterProfile | null) => char?.convoSettings?.remarkName?.trim() || char?.name || '某人';
const roleLabel = (role: DoudizhuPlayerRole) => role === 'user' ? '你' : role === 'charA' ? '一号角色' : '二号角色';

const updateInviteCardMessage = async (invitation: TheaterDoudizhuInvitation, status: TheaterDoudizhuInvitation['status'], acceptedGameId?: string) => {
    try {
        const messages = await DB.getMessagesByCharId(invitation.charId, true);
        const target = [...messages].reverse().find((m: Message) => (m.metadata as any)?.doudizhuInvite?.invitationId === invitation.id);
        if (!target?.id) return;
        await DB.updateMessageMetadata(target.id, (prev: any) => ({
            ...(prev || {}),
            doudizhuInvite: {
                ...(prev?.doudizhuInvite || {}),
                status,
                acceptedGameId,
            },
        }));
    } catch { /* ignore */ }
};

const DoudizhuApp: React.FC<DoudizhuAppProps> = ({ onExit, launch }) => {
    const { characters, userProfile, apiConfig, auxApiConfig, updateCharacter, addToast } = useOS();
    const [games, setGames] = useState<TheaterDoudizhuGame[]>([]);
    const [invitations, setInvitations] = useState<TheaterDoudizhuInvitation[]>([]);
    const [selectedAId, setSelectedAId] = useState<string>('');
    const [selectedBId, setSelectedBId] = useState<string>('');
    const [difficultyMode, setDifficultyMode] = useState<DoudizhuDifficultyMode>('opening');
    const [game, setGame] = useState<TheaterDoudizhuGame | null>(null);
    const [selectedCardIds, setSelectedCardIds] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);
    const [highlightInviteId, setHighlightInviteId] = useState<string | undefined>();

    const api = useMemo(() => resolveAuxApi(auxApiConfig, apiConfig), [apiConfig, auxApiConfig]);
    const userName = userProfile?.name || '你';
    const playableChars = useMemo(() => characters.filter(c => !!c.id), [characters]);
    const selectedA = useMemo(() => playableChars.find(c => c.id === selectedAId) || playableChars[0] || null, [playableChars, selectedAId]);
    const selectedB = useMemo(() => playableChars.find(c => c.id === selectedBId && c.id !== selectedA?.id) || playableChars.find(c => c.id !== selectedA?.id) || null, [playableChars, selectedA?.id, selectedBId]);
    const activeGames = useMemo(() => games.filter(g => g.status !== 'ended'), [games]);
    const pendingInvites = useMemo(() => invitations.filter(i => i.status === 'pending'), [invitations]);

    const reload = useCallback(async () => {
        const [allGames, allInvites] = await Promise.all([
            DB.getAllTheaterDoudizhuGames().catch(() => []),
            DB.getAllTheaterDoudizhuInvitations().catch(() => []),
        ]);
        setGames(allGames.map(normalizeDoudizhuGame));
        setInvitations(allInvites);
    }, []);

    useEffect(() => { void reload(); }, [reload]);

    useEffect(() => {
        if (selectedAId || !playableChars.length) return;
        const first = launch?.charId && playableChars.find(c => c.id === launch.charId) ? launch.charId : playableChars[0].id;
        setSelectedAId(first);
        setSelectedBId(playableChars.find(c => c.id !== first)?.id || '');
    }, [launch?.charId, playableChars, selectedAId]);

    useEffect(() => {
        let alive = true;
        const openLaunch = async () => {
            if (!launch) return;
            if (launch.charId) setSelectedAId(launch.charId);
            if (launch.invitationId) {
                setHighlightInviteId(launch.invitationId);
                return;
            }
            if (launch.gameId) {
                const found = await DB.getTheaterDoudizhuGame(launch.gameId);
                if (alive && found) setGame(normalizeDoudizhuGame(found));
            }
        };
        void openLaunch();
        return () => { alive = false; };
    }, [launch]);

    const persistGame = useCallback(async (next: TheaterDoudizhuGame) => {
        const clean = normalizeDoudizhuGame(next);
        setGame(clean);
        setSelectedCardIds([]);
        await DB.saveTheaterDoudizhuGame(clean);
        setGames(prev => [clean, ...prev.filter(g => g.id !== clean.id)].sort((a, b) => b.lastActiveAt - a.lastActiveAt));
    }, []);

    const charForRole = useCallback((g: TheaterDoudizhuGame, role: DoudizhuPlayerRole) => {
        const player = g.players.find(p => p.role === role);
        return player?.charId ? characters.find(c => c.id === player.charId) || null : null;
    }, [characters]);

    const advanceAiTurns = useCallback(async (input: TheaterDoudizhuGame, seedEvents: DoudizhuMoveEvent[] = []) => {
        let current = normalizeDoudizhuGame(input);
        setBusy(true);
        try {
            for (let guard = 0; guard < 16; guard++) {
                if (current.status === 'ended' || current.currentTurn === 'user') break;
                const role = current.currentTurn;
                const char = charForRole(current, role);
                if (!char) break;
                if (current.status === 'bidding') {
                    const level = current.difficultyLevels[role] || 'steady';
                    const bidScore = chooseDoudizhuBid(current, role, level);
                    const bid = applyDoudizhuBid(current, role, bidScore);
                    if (!bid.ok) break;
                    const kind = bid.events.includes('landlord') ? 'landlord' : 'bid';
                    const text = bid.events.includes('deal')
                        ? '都不叫？那就重新洗一轮。'
                        : bidScore ? `我叫 ${bidScore} 分。` : '不叫，先让你们看看。';
                    current = addDoudizhuDialogue(bid.game, kind, text, role);
                    await persistGame(current);
                    continue;
                }

                let thinking = addDoudizhuDialogue(current, 'thinking', fallbackDoudizhuDialogue('thinking', char.name), role);
                await persistGame(thinking);
                let level = thinking.difficultyLevels[role] || 'steady';
                if (thinking.difficultyMode === 'per_move') {
                    const assessed = await decideDoudizhuPerMoveDifficulty(char, userProfile, api, thinking, role, seedEvents);
                    level = assessed.difficultyLevel;
                    thinking = { ...thinking, difficultyLevels: { ...thinking.difficultyLevels, [role]: level } };
                }
                const picked = chooseDoudizhuMove(thinking, role, level);
                const applied = applyDoudizhuPlay(thinking, role, picked.cards.map(card => card.id));
                if (!applied.ok) {
                    const fallback = chooseDoudizhuMove(thinking, role, 'master');
                    const retry = applyDoudizhuPlay(thinking, role, fallback.cards.map(card => card.id));
                    if (!retry.ok) break;
                    const text = await generateDoudizhuDialogue(char, userProfile, api, retry.game, role, retry.events, retry.move);
                    current = addDoudizhuDialogue(retry.game, retry.events[0] || 'normal', text, role, retry.move.no);
                    await persistGame(current);
                    continue;
                }
                const text = await generateDoudizhuDialogue(char, userProfile, api, applied.game, role, applied.events, applied.move);
                current = addDoudizhuDialogue(applied.game, applied.events[0] || 'normal', text, role, applied.move.no);
                await persistGame(current);
            }
        } finally {
            setBusy(false);
        }
        return current;
    }, [api, charForRole, persistGame, userProfile]);

    const startGame = useCallback(async (charA: CharacterProfile, charB: CharacterProfile, mode: DoudizhuDifficultyMode, opts?: { invitation?: TheaterDoudizhuInvitation }) => {
        if (!charA || !charB || charA.id === charB.id) return;
        setBusy(true);
        try {
            const [aLevel, bLevel] = await Promise.all([
                decideDoudizhuOpeningDifficulty(charA, userProfile, api, mode, !!opts?.invitation),
                decideDoudizhuOpeningDifficulty(charB, userProfile, api, mode, !!opts?.invitation),
            ]);
            let next = createDoudizhuGame(userName, charA, charB, {
                difficultyMode: mode,
                difficultyLevels: { charA: aLevel.difficultyLevel, charB: bLevel.difficultyLevel },
                invitationId: opts?.invitation?.id,
            });
            next = addDoudizhuDialogue(next, 'invite', opts?.invitation?.message || '三个人刚好，来一局斗地主？', 'charA');
            await persistGame(next);
            if (opts?.invitation) {
                const accepted = { ...opts.invitation, status: 'accepted' as const, acceptedGameId: next.id, updatedAt: Date.now() };
                await DB.saveTheaterDoudizhuInvitation(accepted);
                await updateInviteCardMessage(accepted, 'accepted', next.id);
                setInvitations(prev => prev.map(i => i.id === accepted.id ? accepted : i));
            }
            addToast(`斗地主开桌：${charDisplay(charA)} / ${charDisplay(charB)}`, 'success');
            if (next.currentTurn !== 'user') await advanceAiTurns(next);
        } catch {
            addToast('斗地主开桌失败了，稍后再试一次', 'error');
        } finally {
            setBusy(false);
        }
    }, [addToast, advanceAiTurns, api, persistGame, userName, userProfile]);

    const onUserBid = useCallback(async (score: 0 | 1 | 2 | 3) => {
        if (!game || busy || game.status !== 'bidding' || game.currentTurn !== 'user') return;
        setBusy(true);
        const applied = applyDoudizhuBid(game, 'user', score);
        if (!applied.ok) {
            await persistGame(addDoudizhuDialogue(game, 'illegal', applied.reason, 'system'));
            setBusy(false);
            return;
        }
        const text = applied.events.includes('deal') ? '这一轮没人叫，重新发牌。' : score ? `你叫了 ${score} 分。` : '你选择不叫。';
        const withLine = addDoudizhuDialogue(applied.game, applied.events.includes('landlord') ? 'landlord' : 'bid', text, 'system');
        await persistGame(withLine);
        if (withLine.status !== 'ended' && withLine.currentTurn !== 'user') await advanceAiTurns(withLine, applied.events);
        else setBusy(false);
    }, [advanceAiTurns, busy, game, persistGame]);

    const onUserPlay = useCallback(async (pass = false) => {
        if (!game || busy || game.status !== 'playing' || game.currentTurn !== 'user') return;
        setBusy(true);
        const applied = applyDoudizhuPlay(game, 'user', pass ? [] : selectedCardIds);
        if (!applied.ok) {
            await persistGame(addDoudizhuDialogue(game, 'illegal', applied.reason, 'system'));
            setBusy(false);
            return;
        }
        const text = applied.move.pass ? '你要不起。' : `你出了 ${formatDoudizhuCards(applied.move.cards)}。`;
        const withLine = addDoudizhuDialogue(applied.game, applied.events[0] || 'normal', text, 'system', applied.move.no);
        await persistGame(withLine);
        if (withLine.status !== 'ended' && withLine.currentTurn !== 'user') await advanceAiTurns(withLine, applied.events);
        else setBusy(false);
    }, [advanceAiTurns, busy, game, persistGame, selectedCardIds]);

    const resign = useCallback(async () => {
        if (!game || game.status === 'ended') return;
        const ended = addDoudizhuDialogue(resignDoudizhuGame(game, 'user'), 'lose', '你认输了，这局交给牌桌结算。', 'system');
        await persistGame(ended);
    }, [game, persistGame]);

    const declineInvite = useCallback(async (inv: TheaterDoudizhuInvitation) => {
        const next = { ...inv, status: 'declined' as const, updatedAt: Date.now() };
        await DB.saveTheaterDoudizhuInvitation(next);
        await updateInviteCardMessage(next, 'declined');
        setInvitations(prev => prev.map(i => i.id === inv.id ? next : i));
    }, []);

    const toggleProactive = useCallback((char: CharacterProfile) => {
        updateCharacter(char.id, {
            convoSettings: {
                ...(char.convoSettings || {}),
                proactiveDoudizhuInvite: !char.convoSettings?.proactiveDoudizhuInvite,
            },
        });
    }, [updateCharacter]);

    if (game) {
        return (
            <PaperShell>
                <ScrapHeader
                    title="斗地主"
                    en="DOU DIZHU"
                    onBack={() => { setGame(null); void reload(); }}
                    right={<ScrapButton variant="ghost" className="h-9 px-3 text-[12px]" onClick={onExit}>幕间集</ScrapButton>}
                />
                <ScrapScroll className="px-4 pb-10">
                    <PlaySurface
                        game={game}
                        userName={userName}
                        busy={busy}
                        selectedCardIds={selectedCardIds}
                        setSelectedCardIds={setSelectedCardIds}
                        onBid={onUserBid}
                        onPlay={() => onUserPlay(false)}
                        onPass={() => onUserPlay(true)}
                        onResign={resign}
                        onRestart={() => {
                            const a = charForRole(game, 'charA');
                            const b = charForRole(game, 'charB');
                            if (a && b) void startGame(a, b, game.difficultyMode);
                        }}
                    />
                </ScrapScroll>
            </PaperShell>
        );
    }

    return (
        <PaperShell>
            <ScrapHeader title="斗地主" en="DOU DIZHU" onBack={onExit} />
            <ScrapScroll className="px-4 pb-10">
                <div className="space-y-5">
                    <PaperCard className="px-5 py-5 overflow-hidden">
                        <div className="text-[9px] tracking-[0.32em] mb-1" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>ACT XIII</div>
                        <div className="text-[30px] font-black" style={{ color: INK }}>拾叁 · 斗地主</div>
                        <p className="mt-2 text-[12.5px] leading-relaxed" style={{ color: '#5b554a' }}>
                            三人经典牌局：叫分抢地主、三张底牌、炸弹翻倍，结算春天与反春天。TA 的牌力由模型按完整设定判断，本地牌桌负责合法出牌。
                        </p>
                    </PaperCard>

                    {pendingInvites.length > 0 && (
                        <PaperCard className="px-4 py-4">
                            <SectionTag>待应牌局</SectionTag>
                            <div className="mt-3 space-y-2">
                                {pendingInvites.map(inv => {
                                    const inviter = playableChars.find(c => c.id === inv.charId) || null;
                                    const partner = playableChars.find(c => c.id !== inv.charId && c.id === selectedBId) || playableChars.find(c => c.id !== inv.charId) || null;
                                    return (
                                        <div key={inv.id} className={`rounded-[12px] border px-3 py-3 ${highlightInviteId === inv.id ? 'ring-2 ring-[#1f1d1a]' : ''}`} style={{ borderColor: 'rgba(31,29,26,0.16)', background: '#fffdfa' }}>
                                            <div className="flex items-start gap-3">
                                                <Avatar char={inviter} />
                                                <div className="min-w-0 flex-1">
                                                    <div className="text-[13px] font-black" style={{ color: INK }}>{inv.charName} 约你斗地主</div>
                                                    <div className="mt-1 text-[12px] leading-relaxed" style={{ color: '#5b554a' }}>{inv.message || '来一局斗地主？'}</div>
                                                    <select value={partner?.id || ''} onChange={e => setSelectedBId(e.target.value)} className="mt-2 w-full rounded-[10px] border px-2 py-2 text-[12px]" style={{ borderColor: 'rgba(31,29,26,0.18)', background: '#fbfaf6', color: INK }}>
                                                        {playableChars.filter(c => c.id !== inv.charId).map(c => <option key={c.id} value={c.id}>第三席：{charDisplay(c)}</option>)}
                                                    </select>
                                                    <div className="mt-2 flex gap-2">
                                                        <ScrapButton disabled={!inviter || !partner || busy} onClick={() => inviter && partner && void startGame(inviter, partner, inv.difficultyMode || difficultyMode, { invitation: inv })}>接受</ScrapButton>
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
                        <SectionTag>开新桌</SectionTag>
                        {playableChars.length < 2 ? (
                            <div className="mt-3 text-[12.5px] leading-relaxed" style={{ color: '#7b7164' }}>至少需要两位正式角色才能开一桌斗地主。</div>
                        ) : (
                            <div className="mt-3 space-y-3">
                                <div className="grid grid-cols-2 gap-2">
                                    <CharacterSelect label="一号角色" value={selectedA?.id || ''} chars={playableChars} excludeId={selectedB?.id} onChange={setSelectedAId} />
                                    <CharacterSelect label="二号角色" value={selectedB?.id || ''} chars={playableChars} excludeId={selectedA?.id} onChange={setSelectedBId} />
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    {modeOptions.map(opt => (
                                        <button key={opt.id} onClick={() => setDifficultyMode(opt.id)} className="rounded-[12px] px-3 py-2 text-left active:scale-[0.99]" style={{ background: difficultyMode === opt.id ? INK : '#fffdfa', color: difficultyMode === opt.id ? '#f6f3ec' : INK, border: '1px solid rgba(31,29,26,0.16)' }}>
                                            <div className="text-[12px] font-black">{opt.label}</div>
                                            <div className="mt-1 text-[10.5px] leading-snug opacity-75">{opt.note}</div>
                                        </button>
                                    ))}
                                </div>
                                <ScrapButton disabled={!selectedA || !selectedB || busy} onClick={() => selectedA && selectedB && void startGame(selectedA, selectedB, difficultyMode)}>
                                    <Play size={15} weight="fill" /> 开始叫分
                                </ScrapButton>
                                {selectedA && (
                                    <button onClick={() => toggleProactive(selectedA)} className="w-full rounded-[12px] px-3 py-2 flex items-center justify-between" style={{ border: '1px dashed rgba(31,29,26,0.2)', background: '#fffdfa', color: INK }}>
                                        <span className="text-[12px] font-bold">允许 {charDisplay(selectedA)} 主动约斗地主</span>
                                        <span className="text-[11px] font-black">{selectedA.convoSettings?.proactiveDoudizhuInvite ? '已开' : '关闭'}</span>
                                    </button>
                                )}
                            </div>
                        )}
                    </PaperCard>

                    <PaperCard className="px-4 py-4">
                        <SectionTag>待续与记录</SectionTag>
                        <div className="mt-3 space-y-2">
                            {activeGames.length === 0 && games.length === 0 && <div className="text-[12px]" style={{ color: INK_SOFT }}>还没有牌局。</div>}
                            {[...activeGames, ...games.filter(g => g.status === 'ended').slice(0, 8)].map(g => (
                                <button key={g.id} onClick={() => setGame(normalizeDoudizhuGame(g))} className="w-full rounded-[12px] border px-3 py-3 text-left" style={{ borderColor: 'rgba(31,29,26,0.14)', background: '#fffdfa' }}>
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="text-[13px] font-black truncate" style={{ color: INK }}>{g.title || '一局斗地主'}</div>
                                        <Stamp>{g.status === 'ended' ? '终局' : g.status === 'bidding' ? '叫分' : '待续'}</Stamp>
                                    </div>
                                    <div className="mt-1 text-[11px]" style={{ color: INK_SOFT }}>{g.moves?.length || 0} 手 · {fmtTime(g.lastActiveAt || g.createdAt)}</div>
                                </button>
                            ))}
                        </div>
                    </PaperCard>
                </div>
            </ScrapScroll>
        </PaperShell>
    );
};

const CharacterSelect: React.FC<{ label: string; value: string; chars: CharacterProfile[]; excludeId?: string; onChange: (id: string) => void }> = ({ label, value, chars, excludeId, onChange }) => (
    <label className="block">
        <div className="mb-1 text-[10px] font-black tracking-[0.2em]" style={{ color: INK_SOFT }}>{label}</div>
        <select value={value} onChange={e => onChange(e.target.value)} className="w-full rounded-[12px] border px-3 py-2 text-[12px] font-bold" style={{ borderColor: 'rgba(31,29,26,0.18)', background: '#fffdfa', color: INK }}>
            {chars.filter(c => c.id !== excludeId).map(c => <option key={c.id} value={c.id}>{charDisplay(c)}</option>)}
        </select>
    </label>
);

const Avatar: React.FC<{ char?: CharacterProfile | null; fallback?: string }> = ({ char, fallback }) => (
    <div className="h-10 w-10 shrink-0 overflow-hidden rounded-[12px]" style={{ background: '#e6e1d8', border: '1px solid rgba(31,29,26,0.18)' }}>
        {char?.avatar ? <img src={char.avatar} alt="" className="h-full w-full object-cover grayscale" /> : <div className="h-full w-full flex items-center justify-center text-[15px] font-black" style={{ color: INK }}>{(char?.name || fallback || '?').slice(0, 1)}</div>}
    </div>
);

const LENORMAND_POKER_FACE: Record<string, number> = {
    'heart-9': 1,
    'diamond-6': 2,
    'spade-10': 3,
    'heart-13': 4,
    'heart-7': 5,
    'club-13': 6,
    'club-12': 7,
    'diamond-9': 8,
    'spade-12': 9,
    'diamond-11': 10,
    'club-11': 11,
    'diamond-7': 12,
    'spade-11': 13,
    'club-9': 14,
    'club-10': 15,
    'heart-6': 16,
    'heart-12': 17,
    'heart-10': 18,
    'spade-6': 19,
    'spade-8': 20,
    'club-8': 21,
    'diamond-12': 22,
    'club-7': 23,
    'heart-11': 24,
    'club-14': 25,
    'diamond-10': 26,
    'spade-7': 27,
    'heart-14': 28,
    'spade-14': 29,
    'spade-13': 30,
    'diamond-14': 31,
    'heart-8': 32,
    'diamond-8': 33,
    'diamond-13': 34,
    'spade-9': 35,
    'club-6': 36,
};

const suitGlyph = (suit: DoudizhuCard['suit']) =>
    suit === 'spade' ? '♠' : suit === 'heart' ? '♥' : suit === 'club' ? '♣' : suit === 'diamond' ? '♦' : '★';
const isRedCard = (card: DoudizhuCard) => card.suit === 'heart' || card.suit === 'diamond' || card.rank === 17;
const pokerFaceSrc = (card: DoudizhuCard) => {
    const number = LENORMAND_POKER_FACE[`${card.suit}-${card.rank}`];
    return number ? `/lenormand/${number}.png` : undefined;
};

const PokerFallbackFace: React.FC<{ card: DoudizhuCard; compact?: boolean }> = ({ card, compact }) => {
    const red = isRedCard(card);
    const color = red ? '#c92922' : '#171514';
    const rank = card.rank === 16 ? 'JOKER' : card.rank === 17 ? 'JOKER' : card.label;
    const suit = suitGlyph(card.suit);
    const numeric = card.rank >= 2 && card.rank <= 10;
    const pipCount = numeric ? Math.min(10, card.rank) : 0;
    const corner = (
        <div className="flex flex-col items-center leading-none" style={{ color }}>
            <span className={compact ? 'text-[9px]' : 'text-[11px]'} style={{ fontWeight: 900 }}>{rank}</span>
            <span className={compact ? 'text-[9px]' : 'text-[12px]'}>{suit}</span>
        </div>
    );
    if (card.suit === 'joker') {
        return (
            <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ color }}>
                <span className={compact ? 'text-[9px]' : 'text-[11px]'} style={{ writingMode: 'vertical-rl', fontWeight: 900, letterSpacing: 1 }}>JOKER</span>
                <span className={compact ? 'text-[12px]' : 'text-[18px]'}>{card.rank === 17 ? '★' : '☆'}</span>
            </div>
        );
    }
    return (
        <>
            <div className="absolute left-[7%] top-[6%]">{corner}</div>
            <div className="absolute bottom-[6%] right-[7%] rotate-180">{corner}</div>
            <div className="absolute inset-[18%] flex items-center justify-center" style={{ color }}>
                {numeric ? (
                    <div className="grid grid-cols-2 gap-x-1 gap-y-0.5 text-center leading-none">
                        {Array.from({ length: pipCount }).map((_, i) => (
                            <span key={i} className={compact ? 'text-[10px]' : 'text-[16px]'}>{suit}</span>
                        ))}
                    </div>
                ) : (
                    <div className="flex flex-col items-center leading-none">
                        <span className={compact ? 'text-[15px]' : 'text-[28px]'} style={{ fontWeight: 900 }}>{rank}</span>
                        <span className={compact ? 'text-[14px]' : 'text-[24px]'}>{suit}</span>
                    </div>
                )}
            </div>
        </>
    );
};

const CardTile: React.FC<{ card: DoudizhuCard; selected?: boolean; onClick?: () => void; compact?: boolean }> = ({ card, selected, onClick, compact }) => {
    const [broken, setBroken] = useState(false);
    const src = pokerFaceSrc(card);
    const showImage = !!src && !broken;
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={`${card.label}${card.suit === 'joker' ? '' : suitGlyph(card.suit)}`}
            className={`relative shrink-0 overflow-hidden rounded-[7px] bg-[#f7f0e3] transition ${compact ? 'h-12 w-[34px]' : 'h-20 w-14'} ${selected ? '-translate-y-3' : ''}`}
            style={{
                border: '1px solid rgba(31,29,26,0.26)',
                boxShadow: selected ? '0 14px 22px -14px rgba(31,29,26,0.8)' : '0 8px 15px -12px rgba(31,29,26,0.58)',
                filter: showImage ? 'grayscale(0.05) contrast(1.04)' : undefined,
            }}
        >
            {showImage ? (
                <img
                    src={src}
                    alt=""
                    onError={() => setBroken(true)}
                    draggable={false}
                    className="h-full w-full object-contain"
                    style={{ padding: compact ? 1 : 2 }}
                />
            ) : (
                <PokerFallbackFace card={card} compact={compact} />
            )}
        </button>
    );
};

const PlaySurface: React.FC<{
    game: TheaterDoudizhuGame;
    userName: string;
    busy: boolean;
    selectedCardIds: string[];
    setSelectedCardIds: (ids: string[]) => void;
    onBid: (score: 0 | 1 | 2 | 3) => void;
    onPlay: () => void;
    onPass: () => void;
    onResign: () => void;
    onRestart: () => void;
}> = ({ game, busy, selectedCardIds, setSelectedCardIds, onBid, onPlay, onPass, onResign, onRestart }) => {
    const hand = sortDoudizhuCards(game.hands.user || [], true);
    const selectedCards = hand.filter(card => selectedCardIds.includes(card.id));
    const selectedAnalysis = analyzeDoudizhuCards(selectedCards);
    const canAct = !busy && game.currentTurn === 'user' && game.status !== 'ended';
    const latestDialogue = [...(game.dialogue || [])].slice(-5).reverse();
    const lastMove = game.lastPlay;

    const toggleCard = (id: string) => {
        setSelectedCardIds(selectedCardIds.includes(id) ? selectedCardIds.filter(x => x !== id) : [...selectedCardIds, id]);
    };

    return (
        <div className="space-y-4">
            <PaperCard className="px-4 py-4">
                <div className="flex items-center justify-between gap-2">
                    <div>
                        <div className="text-[10px] tracking-[0.24em]" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>DOU DIZHU TABLE</div>
                        <div className="text-[22px] font-black" style={{ color: INK }}>{game.status === 'bidding' ? '叫分阶段' : game.status === 'ended' ? '本局结算' : '出牌阶段'}</div>
                    </div>
                    <Stamp>{DOUDIZHU_DIFFICULTY_MODE_LABELS[game.difficultyMode] || '模型定档'}</Stamp>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                    {DOUDIZHU_ROLES.map(role => (
                        <div key={role} className="rounded-[12px] px-2 py-2" style={{ background: game.currentTurn === role ? INK : '#fffdfa', color: game.currentTurn === role ? '#f6f3ec' : INK, border: '1px solid rgba(31,29,26,0.14)' }}>
                            <div className="text-[11px] font-black truncate">{doudizhuRoleName(game, role)}</div>
                            <div className="mt-1 text-[10px] opacity-75">{game.landlord === role ? '地主' : game.landlord ? '农民' : roleLabel(role)} · {game.hands[role]?.length || 0} 张</div>
                        </div>
                    ))}
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]" style={{ color: '#5b554a' }}>
                    <div className="rounded-[10px] px-2 py-2 bg-[#fffdfa] border border-black/10">底分 {game.baseScore}</div>
                    <div className="rounded-[10px] px-2 py-2 bg-[#fffdfa] border border-black/10">倍数 x{game.score?.multiplier || game.multiplier || 1}</div>
                    <div className="rounded-[10px] px-2 py-2 bg-[#fffdfa] border border-black/10">{game.landlord ? `${doudizhuRoleName(game, game.landlord)} 地主` : '未定地主'}</div>
                </div>
            </PaperCard>

            <PaperCard className="px-4 py-4">
                <SectionTag>桌面</SectionTag>
                <div className="mt-3 flex items-center justify-between gap-2">
                    <div>
                        <div className="text-[10px] font-black" style={{ color: INK_SOFT }}>底牌</div>
                        <div className="mt-1 flex gap-1">{game.bottomCards.map(card => <CardTile key={card.id} card={card} compact />)}</div>
                    </div>
                    <div className="text-right min-w-0">
                        <div className="text-[10px] font-black" style={{ color: INK_SOFT }}>上一手</div>
                        <div className="mt-1 text-[12px] font-bold truncate" style={{ color: INK }}>
                            {lastMove ? `${doudizhuRoleName(game, lastMove.by)} ${lastMove.pass ? '不要' : formatDoudizhuCards(lastMove.cards)}` : '还没人出牌'}
                        </div>
                    </div>
                </div>
                {game.status === 'ended' && game.score && (
                    <div className="mt-3 rounded-[12px] px-3 py-3" style={{ background: '#fffdfa', border: '1px solid rgba(31,29,26,0.14)', color: INK }}>
                        <div className="text-[13px] font-black">{game.score.winner === 'landlord' ? '地主胜' : '农民胜'} · {doudizhuRoleName(game, game.score.winningRole)} 收牌</div>
                        <div className="mt-1 text-[11px]" style={{ color: INK_SOFT }}>
                            倍数 x{game.score.multiplier}{game.score.spring ? ' · 春天' : ''}{game.score.antiSpring ? ' · 反春天' : ''}
                        </div>
                        <div className="mt-2 grid grid-cols-3 gap-1 text-[11px]">
                            {DOUDIZHU_ROLES.map(role => <div key={role} className="rounded-[8px] px-2 py-1 bg-[#f1ede3]">{doudizhuRoleName(game, role)} {game.score!.deltas[role] > 0 ? '+' : ''}{game.score!.deltas[role]}</div>)}
                        </div>
                    </div>
                )}
            </PaperCard>

            <PaperCard className="px-4 py-4">
                <SectionTag>对白</SectionTag>
                <div className="mt-3 space-y-2">
                    {latestDialogue.length === 0 && <div className="text-[12px]" style={{ color: INK_SOFT }}>牌桌还很安静。</div>}
                    {latestDialogue.map(line => (
                        <div key={line.id} className="rounded-[12px] px-3 py-2" style={{ background: line.by === 'system' ? '#f1ede3' : '#fffdfa', border: '1px solid rgba(31,29,26,0.12)' }}>
                            <div className="text-[10px] font-black" style={{ color: INK_SOFT }}>{line.by === 'system' ? '牌桌' : doudizhuRoleName(game, line.by)}</div>
                            <div className="text-[12.5px] leading-relaxed" style={{ color: INK }}>{line.text}</div>
                        </div>
                    ))}
                </div>
            </PaperCard>

            {game.status === 'bidding' && (
                <PaperCard className="px-4 py-4">
                    <SectionTag>你的叫分</SectionTag>
                    <div className="mt-3 grid grid-cols-4 gap-2">
                        {([0, 1, 2, 3] as const).map(score => (
                            <ScrapButton key={score} disabled={!canAct} onClick={() => onBid(score)}>{score ? `${score} 分` : '不叫'}</ScrapButton>
                        ))}
                    </div>
                </PaperCard>
            )}

            {game.status === 'playing' && (
                <PaperCard className="px-4 py-4">
                    <SectionTag>你的手牌</SectionTag>
                    <div className="mt-5 flex flex-wrap gap-1.5 min-h-[72px]">
                        {hand.map(card => <CardTile key={card.id} card={card} selected={selectedCardIds.includes(card.id)} onClick={() => canAct && toggleCard(card.id)} />)}
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-2">
                        <div className="text-[11px]" style={{ color: selectedAnalysis ? INK : INK_SOFT }}>{selectedAnalysis ? `已选 ${selectedCards.length} 张` : '请选择合法牌型'}</div>
                        <div className="flex gap-2">
                            <ScrapButton disabled={!canAct || !selectedAnalysis} onClick={onPlay}>出牌</ScrapButton>
                            <ScrapButton variant="ghost" disabled={!canAct} onClick={onPass}>要不起</ScrapButton>
                        </div>
                    </div>
                </PaperCard>
            )}

            <div className="grid grid-cols-2 gap-2">
                <ScrapButton variant="ghost" disabled={busy || game.status === 'ended'} onClick={onResign}><Flag size={15} /> 认输</ScrapButton>
                <ScrapButton variant="ghost" disabled={busy} onClick={onRestart}><ArrowClockwise size={15} /> 重开</ScrapButton>
            </div>
        </div>
    );
};

export default DoudizhuApp;
