import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowClockwise, Flag, Play } from '@phosphor-icons/react';
import { useOS } from '../../context/OSContext';
import type { CharacterProfile, MahjongClaimAction, MahjongMoveEvent, MahjongPlayerRole, MahjongTile, Message, TheaterMahjongGame, TheaterMahjongInvitation } from '../../types';
import { PaperShell, ScrapScroll, ScrapHeader, PaperCard, ScrapButton, SectionTag, Stamp, INK, INK_SOFT } from '../ui/insScrapKit';
import { DB } from '../../utils/db';
import { resolveAuxApi } from '../../utils/auxApi';
import {
    MAHJONG_DIFFICULTY_LABELS,
    MAHJONG_DIFFICULTY_MODE_LABELS,
    MAHJONG_ROLES,
    MAHJONG_SEAT_LABELS,
    addMahjongDialogue,
    analyzeMahjongHu,
    applyMahjongClaim,
    applyMahjongDiscard,
    applyMahjongDraw,
    applyMahjongSelfGang,
    applyMahjongSelfWin,
    chooseMahjongClaim,
    chooseMahjongDiscard,
    createMahjongGame,
    decideMahjongOpeningDifficulty,
    decideMahjongPerMoveDifficulty,
    fallbackMahjongDialogue,
    formatMahjongTiles,
    generateMahjongDialogue,
    getMahjongClaimActions,
    mahjongRoleName,
    normalizeMahjongGame,
    resignMahjongGame,
    sanitizeMahjongDifficultyMode,
} from '../../utils/theaterMahjong';

export interface MahjongLaunchPayload {
    invitationId?: string;
    charId?: string;
    gameId?: string;
}

interface MahjongAppProps {
    onExit: () => void;
    launch?: MahjongLaunchPayload | null;
}

const modeOptions = [
    { id: 'opening' as const, label: '开局定档', note: '模型开局判断三位角色整局牌力。' },
    { id: 'per_move' as const, label: '每手评估', note: '每次角色行动前按局势重新判断。' },
];

const smallButtonClass = 'h-8 px-3 text-[12px]';

const fmtTime = (ts?: number) => ts ? new Date(ts).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '刚刚';
const charDisplay = (char?: CharacterProfile | null) => char?.convoSettings?.remarkName?.trim() || char?.name || '某人';
const tileTone = (tile: MahjongTile) => tile.suit === 'wan' ? '#9d2f2f' : tile.suit === 'tiao' ? '#2d6a46' : tile.suit === 'tong' ? '#295d9b' : '#1f1d1a';

const updateInviteCardMessage = async (invitation: TheaterMahjongInvitation, status: TheaterMahjongInvitation['status'], acceptedGameId?: string) => {
    try {
        const messages = await DB.getMessagesByCharId(invitation.charId, true);
        const target = [...messages].reverse().find((m: Message) => (m.metadata as any)?.mahjongInvite?.invitationId === invitation.id);
        if (!target?.id) return;
        await DB.updateMessageMetadata(target.id, (prev: any) => ({
            ...(prev || {}),
            mahjongInvite: {
                ...(prev?.mahjongInvite || {}),
                status,
                acceptedGameId,
            },
        }));
    } catch { /* ignore */ }
};

const MahjongApp: React.FC<MahjongAppProps> = ({ onExit, launch }) => {
    const { characters, userProfile, apiConfig, auxApiConfig, updateCharacter, addToast } = useOS();
    const [games, setGames] = useState<TheaterMahjongGame[]>([]);
    const [invitations, setInvitations] = useState<TheaterMahjongInvitation[]>([]);
    const [selectedAId, setSelectedAId] = useState('');
    const [selectedBId, setSelectedBId] = useState('');
    const [selectedCId, setSelectedCId] = useState('');
    const [difficultyMode, setDifficultyMode] = useState<'opening' | 'per_move'>('opening');
    const [game, setGame] = useState<TheaterMahjongGame | null>(null);
    const [selectedTileId, setSelectedTileId] = useState('');
    const [busy, setBusy] = useState(false);
    const [highlightInviteId, setHighlightInviteId] = useState<string | undefined>();

    const api = useMemo(() => resolveAuxApi(auxApiConfig, apiConfig), [apiConfig, auxApiConfig]);
    const userName = userProfile?.name || '你';
    const playableChars = useMemo(() => characters.filter(c => !!c.id), [characters]);
    const selectedA = useMemo(() => playableChars.find(c => c.id === selectedAId) || playableChars[0] || null, [playableChars, selectedAId]);
    const selectedB = useMemo(() => playableChars.find(c => c.id === selectedBId && c.id !== selectedA?.id) || playableChars.find(c => c.id !== selectedA?.id) || null, [playableChars, selectedA?.id, selectedBId]);
    const selectedC = useMemo(() => playableChars.find(c => c.id === selectedCId && c.id !== selectedA?.id && c.id !== selectedB?.id) || playableChars.find(c => c.id !== selectedA?.id && c.id !== selectedB?.id) || null, [playableChars, selectedA?.id, selectedB?.id, selectedCId]);
    const activeGames = useMemo(() => games.filter(g => g.status !== 'ended'), [games]);
    const pendingInvites = useMemo(() => invitations.filter(i => i.status === 'pending'), [invitations]);

    const reload = useCallback(async () => {
        const [allGames, allInvites] = await Promise.all([
            DB.getAllTheaterMahjongGames().catch(() => []),
            DB.getAllTheaterMahjongInvitations().catch(() => []),
        ]);
        setGames(allGames.map(normalizeMahjongGame));
        setInvitations(allInvites);
    }, []);

    useEffect(() => { void reload(); }, [reload]);

    useEffect(() => {
        if (selectedAId || playableChars.length < 3) return;
        const first = launch?.charId && playableChars.find(c => c.id === launch.charId) ? launch.charId : playableChars[0].id;
        const second = playableChars.find(c => c.id !== first)?.id || '';
        const third = playableChars.find(c => c.id !== first && c.id !== second)?.id || '';
        setSelectedAId(first);
        setSelectedBId(second);
        setSelectedCId(third);
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
                const found = await DB.getTheaterMahjongGame(launch.gameId);
                if (alive && found) setGame(normalizeMahjongGame(found));
            }
        };
        void openLaunch();
        return () => { alive = false; };
    }, [launch]);

    const persistGame = useCallback(async (next: TheaterMahjongGame) => {
        const clean = normalizeMahjongGame(next);
        setGame(clean);
        setSelectedTileId('');
        await DB.saveTheaterMahjongGame(clean);
        setGames(prev => [clean, ...prev.filter(g => g.id !== clean.id)].sort((a, b) => b.lastActiveAt - a.lastActiveAt));
    }, []);

    const charForRole = useCallback((g: TheaterMahjongGame, role: MahjongPlayerRole) => {
        const player = g.players.find(p => p.role === role);
        return player?.charId ? characters.find(c => c.id === player.charId) || null : null;
    }, [characters]);

    const advanceAiTurns = useCallback(async (input: TheaterMahjongGame, seedEvents: MahjongMoveEvent[] = []) => {
        let current = normalizeMahjongGame(input);
        setBusy(true);
        try {
            for (let guard = 0; guard < 36; guard += 1) {
                if (current.status === 'ended') break;
                if (current.pendingClaim?.actions.user?.length) break;
                if (!current.pendingClaim && current.currentTurn === 'user') break;

                if (current.pendingClaim) {
                    const responders = (Object.keys(current.pendingClaim.actions) as MahjongPlayerRole[]).filter(role => role !== 'user' && !current.pendingClaim?.passed.includes(role));
                    if (!responders.length) break;
                    let acted = false;
                    for (const role of responders) {
                        const char = charForRole(current, role);
                        if (!char) continue;
                        const level = current.difficultyLevels[role] || 'steady';
                        const action = chooseMahjongClaim(current, role, level);
                        if (action === 'pass') {
                            const passed = applyMahjongClaim(current, role, 'pass');
                            if (passed.ok) {
                                current = passed.game;
                                await persistGame(current);
                            }
                            continue;
                        }
                        const claimed = applyMahjongClaim(current, role, action);
                        if (!claimed.ok) continue;
                        const text = await generateMahjongDialogue(char, userProfile, api, claimed.game, role, claimed.events, claimed.move);
                        current = addMahjongDialogue(claimed.game, claimed.events[0] || 'normal', text, role, claimed.move.no);
                        await persistGame(current);
                        acted = true;
                        break;
                    }
                    if (!acted && current.pendingClaim) break;
                    continue;
                }

                const role = current.currentTurn;
                const char = charForRole(current, role);
                if (!char) break;
                if (current.phase === 'draw') {
                    const drawn = applyMahjongDraw(current, role);
                    if (!drawn.ok) break;
                    current = drawn.game;
                    await persistGame(current);
                    if (current.status === 'ended') break;
                    continue;
                }

                let thinking = addMahjongDialogue(current, 'thinking', fallbackMahjongDialogue('thinking', char.name), role);
                await persistGame(thinking);
                let level = thinking.difficultyLevels[role] || 'steady';
                if (thinking.difficultyMode === 'per_move') {
                    const assessed = await decideMahjongPerMoveDifficulty(char, userProfile, api, thinking, role, seedEvents);
                    level = assessed.difficultyLevel;
                    thinking = { ...thinking, difficultyLevels: { ...thinking.difficultyLevels, [role]: level } };
                }
                const hu = analyzeMahjongHu(thinking.hands[role] || [], thinking.melds[role] || []);
                if (hu.ok && level !== 'novice') {
                    const won = applyMahjongSelfWin(thinking, role);
                    if (won.ok) {
                        const text = await generateMahjongDialogue(char, userProfile, api, won.game, role, won.events, won.move);
                        current = addMahjongDialogue(won.game, 'zimo', text, role, won.move.no);
                        await persistGame(current);
                        break;
                    }
                }
                if ((level === 'sharp' || level === 'master') && Math.random() > 0.72) {
                    const gang = applyMahjongSelfGang(thinking, role);
                    if (gang.ok) {
                        const text = await generateMahjongDialogue(char, userProfile, api, gang.game, role, gang.events, gang.move);
                        current = addMahjongDialogue(gang.game, 'gang', text, role, gang.move.no);
                        await persistGame(current);
                        continue;
                    }
                }
                const picked = chooseMahjongDiscard(thinking, role, level);
                if (!picked) break;
                const discarded = applyMahjongDiscard(thinking, role, picked.id);
                if (!discarded.ok) break;
                const text = await generateMahjongDialogue(char, userProfile, api, discarded.game, role, discarded.events, discarded.move);
                current = addMahjongDialogue(discarded.game, discarded.events[0] || 'normal', text, role, discarded.move.no);
                await persistGame(current);
            }
        } finally {
            setBusy(false);
        }
        return current;
    }, [api, charForRole, persistGame, userProfile]);

    const startGame = useCallback(async (chars: [CharacterProfile, CharacterProfile, CharacterProfile], opts?: { invitation?: TheaterMahjongInvitation }) => {
        setBusy(true);
        try {
            const mode = sanitizeMahjongDifficultyMode(opts?.invitation?.difficultyMode || difficultyMode, difficultyMode);
            const levels = await Promise.all(chars.map(char => decideMahjongOpeningDifficulty(char, userProfile, api, mode, !!opts?.invitation)));
            let next = createMahjongGame(userName, chars, {
                difficultyMode: mode,
                difficultyLevels: { charA: levels[0].difficultyLevel, charB: levels[1].difficultyLevel, charC: levels[2].difficultyLevel },
                dealer: opts?.invitation ? 'charA' : 'user',
                invitationId: opts?.invitation?.id,
            });
            next = addMahjongDialogue(next, 'invite', opts?.invitation?.message || '四个人刚好，来打一圈麻将？', opts?.invitation ? 'charA' : 'system');
            await persistGame(next);
            if (opts?.invitation) {
                const accepted = { ...opts.invitation, status: 'accepted' as const, acceptedGameId: next.id, updatedAt: Date.now() };
                await DB.saveTheaterMahjongInvitation(accepted);
                await updateInviteCardMessage(accepted, 'accepted', next.id);
                setInvitations(prev => prev.map(i => i.id === accepted.id ? accepted : i));
            }
            addToast(`麻将开桌：${chars.map(charDisplay).join(' / ')}`, 'success');
            if (next.currentTurn !== 'user') await advanceAiTurns(next);
        } catch {
            addToast('麻将开桌失败了，稍后再试一次', 'error');
        } finally {
            setBusy(false);
        }
    }, [addToast, advanceAiTurns, api, difficultyMode, persistGame, userName, userProfile]);

    const startSelected = useCallback(async () => {
        if (!selectedA || !selectedB || !selectedC || new Set([selectedA.id, selectedB.id, selectedC.id]).size < 3) {
            addToast('麻将至少需要三位正式角色一起开桌', 'error');
            return;
        }
        await startGame([selectedA, selectedB, selectedC]);
    }, [addToast, selectedA, selectedB, selectedC, startGame]);

    const acceptInvite = useCallback(async (inv: TheaterMahjongInvitation) => {
        const inviter = playableChars.find(c => c.id === inv.charId);
        const b = selectedB?.id !== inviter?.id ? selectedB : playableChars.find(c => c.id !== inviter?.id);
        const c = selectedC?.id !== inviter?.id && selectedC?.id !== b?.id ? selectedC : playableChars.find(x => x.id !== inviter?.id && x.id !== b?.id);
        if (!inviter || !b || !c) {
            addToast('接受麻将邀请还需要再选两位正式角色', 'error');
            return;
        }
        await startGame([inviter, b, c], { invitation: inv });
    }, [addToast, playableChars, selectedB, selectedC, startGame]);

    const declineInvite = useCallback(async (inv: TheaterMahjongInvitation) => {
        const next = { ...inv, status: 'declined' as const, updatedAt: Date.now() };
        await DB.saveTheaterMahjongInvitation(next);
        await updateInviteCardMessage(next, 'declined');
        setInvitations(prev => prev.map(i => i.id === inv.id ? next : i));
    }, []);

    const toggleProactiveInvite = useCallback((char?: CharacterProfile | null) => {
        if (!char) return;
        updateCharacter(char.id, {
            convoSettings: {
                ...(char.convoSettings || {}),
                proactiveMahjongInvite: !char.convoSettings?.proactiveMahjongInvite,
            },
        });
    }, [updateCharacter]);

    const afterUserGame = useCallback(async (next: TheaterMahjongGame, events: MahjongMoveEvent[] = []) => {
        await persistGame(next);
        if (next.status !== 'ended') await advanceAiTurns(next, events);
    }, [advanceAiTurns, persistGame]);

    const onUserDraw = useCallback(async () => {
        if (!game || busy) return;
        const drawn = applyMahjongDraw(game, 'user');
        if (!drawn.ok) {
            await persistGame(addMahjongDialogue(game, 'illegal', drawn.reason, 'system'));
            return;
        }
        await afterUserGame(drawn.game, drawn.events);
    }, [afterUserGame, busy, game, persistGame]);

    const onUserDiscard = useCallback(async () => {
        if (!game || busy || !selectedTileId) return;
        const discarded = applyMahjongDiscard(game, 'user', selectedTileId);
        if (!discarded.ok) {
            await persistGame(addMahjongDialogue(game, 'illegal', discarded.reason, 'system'));
            return;
        }
        const withLine = addMahjongDialogue(discarded.game, discarded.events[0] || 'normal', `你打出 ${discarded.move.tile?.label || ''}。`, 'system', discarded.move.no);
        await afterUserGame(withLine, discarded.events);
    }, [afterUserGame, busy, game, persistGame, selectedTileId]);

    const onUserClaim = useCallback(async (action: MahjongClaimAction) => {
        if (!game || busy) return;
        const claimed = applyMahjongClaim(game, 'user', action);
        if (!claimed.ok) {
            await persistGame(addMahjongDialogue(game, 'illegal', claimed.reason, 'system'));
            return;
        }
        const text = action === 'pass' ? '你过了这一张。' : `你${action === 'hu' ? '胡' : action === 'gang' ? '杠' : action === 'peng' ? '碰' : '吃'}了 ${claimed.move.tile?.label || ''}。`;
        const withLine = addMahjongDialogue(claimed.game, claimed.events[0] || 'normal', text, 'system', claimed.move.no);
        await afterUserGame(withLine, claimed.events);
    }, [afterUserGame, busy, game, persistGame]);

    const onUserSelfWin = useCallback(async () => {
        if (!game || busy) return;
        const won = applyMahjongSelfWin(game, 'user');
        if (!won.ok) {
            await persistGame(addMahjongDialogue(game, 'illegal', won.reason, 'system'));
            return;
        }
        await persistGame(addMahjongDialogue(won.game, 'zimo', '你自摸和牌。', 'system', won.move.no));
    }, [busy, game, persistGame]);

    const onUserGang = useCallback(async () => {
        if (!game || busy) return;
        const gang = applyMahjongSelfGang(game, 'user');
        if (!gang.ok) {
            await persistGame(addMahjongDialogue(game, 'illegal', gang.reason, 'system'));
            return;
        }
        await afterUserGame(addMahjongDialogue(gang.game, 'gang', '你杠了一组牌，补了一张。', 'system', gang.move.no), gang.events);
    }, [afterUserGame, busy, game, persistGame]);

    const onResign = useCallback(async () => {
        if (!game || busy) return;
        await persistGame(addMahjongDialogue(resignMahjongGame(game, 'user'), 'lose', '你认输了，这桌麻将结算。', 'system'));
    }, [busy, game, persistGame]);

    if (game) {
        return (
            <PaperShell>
                <ScrapHeader title="麻将" en="MAHJONG" onBack={() => setGame(null)} />
                <MahjongTable
                    game={game}
                    busy={busy}
                    selectedTileId={selectedTileId}
                    onSelectTile={setSelectedTileId}
                    onDraw={onUserDraw}
                    onDiscard={onUserDiscard}
                    onClaim={onUserClaim}
                    onSelfWin={onUserSelfWin}
                    onGang={onUserGang}
                    onResign={onResign}
                />
            </PaperShell>
        );
    }

    return (
        <PaperShell>
            <ScrapHeader title="麻将" en="MAHJONG" onBack={onExit} />
            <ScrapScroll className="px-4 pb-24 pt-2">
                <div className="mx-auto max-w-5xl">
                    <PaperCard className="p-5">
                        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                            <div>
                                <Stamp>拾伍 · 麻将</Stamp>
                                <div className="mt-2 text-[30px] font-black" style={{ color: INK }}>四人开桌，摸打有声</div>
                                <div className="mt-2 max-w-2xl text-[13px] leading-relaxed" style={{ color: INK_SOFT }}>
                                    大众简化麻将：吃、碰、杠、自摸、点炮和流局都由本地规则兜底；角色牌力和桌边对白按完整人设判断。
                                </div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {modeOptions.map(option => (
                                    <button key={option.id} onClick={() => setDifficultyMode(option.id)} className="rounded-[8px] border px-3 py-2 text-left text-[12px]" style={{ borderColor: difficultyMode === option.id ? INK : 'rgba(31,29,26,0.16)', background: difficultyMode === option.id ? '#1f1d1a' : '#fffdfa', color: difficultyMode === option.id ? '#f8f4e8' : INK }}>
                                        <div className="font-black">{option.label}</div>
                                        <div className="opacity-70">{option.note}</div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </PaperCard>

                    {pendingInvites.length > 0 && (
                        <>
                            <SectionTag en="INVITES" className="mt-5 mb-3">待处理邀请</SectionTag>
                            <div className="grid gap-3 md:grid-cols-2">
                                {pendingInvites.map(inv => (
                                    <PaperCard key={inv.id} className="p-4" style={highlightInviteId === inv.id ? { outline: '2px solid #1f1d1a' } : undefined}>
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <div className="text-[13px] font-black" style={{ color: INK }}>{inv.charName} 约你开麻将桌</div>
                                                <div className="mt-1 text-[12px] leading-relaxed" style={{ color: INK_SOFT }}>{inv.message || '四个人刚好，来打一圈？'}</div>
                                                <div className="mt-2 text-[10px] font-bold" style={{ color: '#8a8172' }}>{MAHJONG_DIFFICULTY_MODE_LABELS[sanitizeMahjongDifficultyMode(inv.difficultyMode, 'opening')]} · {fmtTime(inv.updatedAt)}</div>
                                            </div>
                                            <div className="flex shrink-0 gap-2">
                                                <ScrapButton className={smallButtonClass} onClick={() => void acceptInvite(inv)} disabled={busy}>接受</ScrapButton>
                                                <ScrapButton className={smallButtonClass} variant="ghost" onClick={() => void declineInvite(inv)} disabled={busy}>婉拒</ScrapButton>
                                            </div>
                                        </div>
                                    </PaperCard>
                                ))}
                            </div>
                        </>
                    )}

                    <SectionTag en="NEW TABLE" className="mt-5 mb-3">开新桌</SectionTag>
                    <PaperCard className="p-4">
                        {playableChars.length < 3 ? (
                            <div className="text-[13px] leading-relaxed" style={{ color: INK_SOFT }}>麻将至少需要三位正式角色一起上桌。先去剪影集添加角色，再回来开桌。</div>
                        ) : (
                            <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
                                <div className="grid gap-3 md:grid-cols-3">
                                    <CharacterPicker label="东/邀请者位" chars={playableChars} value={selectedA?.id || ''} exclude={[]} onChange={setSelectedAId} />
                                    <CharacterPicker label="西位角色" chars={playableChars} value={selectedB?.id || ''} exclude={[selectedA?.id || '']} onChange={setSelectedBId} />
                                    <CharacterPicker label="北位角色" chars={playableChars} value={selectedC?.id || ''} exclude={[selectedA?.id || '', selectedB?.id || '']} onChange={setSelectedCId} />
                                </div>
                                <div className="flex flex-col justify-end gap-2">
                                    <ScrapButton icon={<Play size={15} weight="fill" />} onClick={() => void startSelected()} disabled={busy}>开桌</ScrapButton>
                                    <ScrapButton variant="ghost" onClick={() => toggleProactiveInvite(selectedA)}>允许 {charDisplay(selectedA)} 主动约麻将：{selectedA?.convoSettings?.proactiveMahjongInvite ? '已开' : '关闭'}</ScrapButton>
                                </div>
                            </div>
                        )}
                    </PaperCard>

                    <SectionTag en="CONTINUE" className="mt-5 mb-3">最近牌局</SectionTag>
                    <div className="grid gap-3 md:grid-cols-2">
                        {activeGames.length ? activeGames.map(g => (
                            <button key={g.id} onClick={() => setGame(normalizeMahjongGame(g))} className="rounded-[12px] border px-3 py-3 text-left" style={{ borderColor: 'rgba(31,29,26,0.14)', background: '#fffdfa' }}>
                                <div className="text-[13px] font-black truncate" style={{ color: INK }}>{g.title || '一桌麻将'}</div>
                                <div className="mt-1 text-[11px]" style={{ color: INK_SOFT }}>{g.players.map(p => p.name).join(' / ')}</div>
                                <div className="mt-2 text-[10px] font-bold" style={{ color: '#8a8172' }}>{fmtTime(g.lastActiveAt)} · 牌墙 {g.wall?.length || 0}</div>
                            </button>
                        )) : <div className="text-[12px]" style={{ color: INK_SOFT }}>还没有待续麻将桌。</div>}
                    </div>
                </div>
            </ScrapScroll>
        </PaperShell>
    );
};

const CharacterPicker: React.FC<{ label: string; chars: CharacterProfile[]; value: string; exclude: string[]; onChange: (id: string) => void }> = ({ label, chars, value, exclude, onChange }) => (
    <label className="block">
        <div className="mb-1 text-[11px] font-black tracking-[0.08em]" style={{ color: INK }}>{label}</div>
        <select value={value} onChange={e => onChange(e.target.value)} className="w-full rounded-[8px] border bg-[#fffdfa] px-3 py-2 text-[13px]" style={{ borderColor: 'rgba(31,29,26,0.18)', color: INK }}>
            {chars.filter(c => !exclude.includes(c.id) || c.id === value).map(char => <option key={char.id} value={char.id}>{charDisplay(char)}</option>)}
        </select>
    </label>
);

const MahjongTable: React.FC<{
    game: TheaterMahjongGame;
    busy: boolean;
    selectedTileId: string;
    onSelectTile: (id: string) => void;
    onDraw: () => void;
    onDiscard: () => void;
    onClaim: (action: MahjongClaimAction) => void;
    onSelfWin: () => void;
    onGang: () => void;
    onResign: () => void;
}> = ({ game, busy, selectedTileId, onSelectTile, onDraw, onDiscard, onClaim, onSelfWin, onGang, onResign }) => {
    const userActions = game.pendingClaim?.actions.user || [];
    const userCanSelfWin = game.currentTurn === 'user' && game.phase === 'discard' && analyzeMahjongHu(game.hands.user || [], game.melds.user || []).ok;
    const latestDialogue = [...(game.dialogue || [])].slice(-6).reverse();
    const orderedPlayers = [...game.players].sort((a, b) => ['north', 'west', 'east', 'south'].indexOf(a.seat) - ['north', 'west', 'east', 'south'].indexOf(b.seat));

    return (
        <ScrapScroll className="px-3 pb-24 pt-2">
            <div className="mx-auto max-w-6xl">
                <div className="grid gap-3 lg:grid-cols-[280px_1fr_280px]">
                    <PaperCard className="p-3">
                        <SectionTag en="PLAYERS">四方</SectionTag>
                        <div className="mt-3 space-y-2">
                            {orderedPlayers.map(p => (
                                <div key={p.role} className="rounded-[10px] border px-3 py-2" style={{ borderColor: game.currentTurn === p.role ? INK : 'rgba(31,29,26,0.12)', background: game.currentTurn === p.role ? '#f5ecd7' : '#fffdfa' }}>
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="min-w-0">
                                            <div className="truncate text-[12px] font-black" style={{ color: INK }}>{MAHJONG_SEAT_LABELS[p.seat]} · {p.name}</div>
                                            <div className="mt-0.5 text-[10px]" style={{ color: INK_SOFT }}>{p.role === 'user' ? '你' : MAHJONG_DIFFICULTY_LABELS[game.difficultyLevels[p.role] || 'steady']}</div>
                                        </div>
                                        <Stamp>{game.hands[p.role]?.length || 0} 张</Stamp>
                                    </div>
                                    <div className="mt-2 flex flex-wrap gap-1">
                                        {(game.melds[p.role] || []).map(m => <MiniMeld key={m.id} tiles={m.tiles} label={m.type} />)}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </PaperCard>

                    <div className="space-y-3">
                        <PaperCard className="p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                    <div className="text-[18px] font-black" style={{ color: INK }}>{game.title || '一桌麻将'}</div>
                                    <div className="mt-1 text-[11px]" style={{ color: INK_SOFT }}>
                                        {MAHJONG_DIFFICULTY_MODE_LABELS[game.difficultyMode]} · 当前 {mahjongRoleName(game, game.currentTurn)} · 牌墙 {game.wall.length} · 王牌 {game.deadWall.length}
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                    <ScrapButton className={smallButtonClass} icon={<ArrowClockwise size={14} />} onClick={() => window.location.reload()} variant="ghost">刷新</ScrapButton>
                                    <ScrapButton className={smallButtonClass} icon={<Flag size={14} />} onClick={onResign} disabled={busy || game.status === 'ended'} variant="ghost">认输</ScrapButton>
                                </div>
                            </div>
                        </PaperCard>

                        <PaperCard className="p-3">
                            <SectionTag en="RIVERS">弃牌河</SectionTag>
                            <div className="mt-3 grid gap-3 md:grid-cols-2">
                                {game.players.map(p => (
                                    <div key={p.role} className="min-h-[72px] rounded-[10px] bg-[#f5f0e4] p-2">
                                        <div className="mb-1 text-[10px] font-black" style={{ color: INK }}>{MAHJONG_SEAT_LABELS[p.seat]} · {p.name}</div>
                                        <div className="flex flex-wrap gap-1">
                                            {(game.discards[p.role] || []).map(tile => <TileFace key={tile.id} tile={tile} mini />)}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </PaperCard>

                        <PaperCard className="p-3">
                            <SectionTag en="YOUR HAND">你的手牌</SectionTag>
                            <div className="mt-3 flex min-h-[78px] flex-wrap items-end gap-1.5">
                                {(game.hands.user || []).map(tile => (
                                    <button key={tile.id} type="button" onClick={() => onSelectTile(tile.id)} disabled={busy || game.status === 'ended'} className="transition-transform" style={{ transform: selectedTileId === tile.id ? 'translateY(-10px)' : 'none' }}>
                                        <TileFace tile={tile} selected={selectedTileId === tile.id} />
                                    </button>
                                ))}
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                                {game.pendingClaim?.actions.user?.length ? (
                                    <>
                                        {userActions.includes('hu') && <ScrapButton className={smallButtonClass} onClick={() => onClaim('hu')} disabled={busy}>胡</ScrapButton>}
                                        {userActions.includes('gang') && <ScrapButton className={smallButtonClass} onClick={() => onClaim('gang')} disabled={busy}>杠</ScrapButton>}
                                        {userActions.includes('peng') && <ScrapButton className={smallButtonClass} onClick={() => onClaim('peng')} disabled={busy}>碰</ScrapButton>}
                                        {userActions.includes('chi') && <ScrapButton className={smallButtonClass} onClick={() => onClaim('chi')} disabled={busy}>吃</ScrapButton>}
                                        <ScrapButton className={smallButtonClass} variant="ghost" onClick={() => onClaim('pass')} disabled={busy}>过</ScrapButton>
                                    </>
                                ) : (
                                    <>
                                        {game.currentTurn === 'user' && game.phase === 'draw' && <ScrapButton className={smallButtonClass} onClick={onDraw} disabled={busy}>摸牌</ScrapButton>}
                                        {game.currentTurn === 'user' && game.phase === 'discard' && <ScrapButton className={smallButtonClass} onClick={onDiscard} disabled={busy || !selectedTileId}>打出</ScrapButton>}
                                        {userCanSelfWin && <ScrapButton className={smallButtonClass} onClick={onSelfWin} disabled={busy}>自摸</ScrapButton>}
                                        {game.currentTurn === 'user' && game.phase === 'discard' && <ScrapButton className={smallButtonClass} variant="ghost" onClick={onGang} disabled={busy}>杠</ScrapButton>}
                                    </>
                                )}
                            </div>
                        </PaperCard>
                    </div>

                    <PaperCard className="p-3">
                        <SectionTag en="TABLE TALK">对白</SectionTag>
                        <div className="mt-3 space-y-2">
                            {latestDialogue.length ? latestDialogue.map(line => (
                                <div key={line.id} className="rounded-[12px] px-3 py-2" style={{ background: line.by === 'system' ? '#eee8d8' : '#fffdfa', border: '1px solid rgba(31,29,26,0.12)' }}>
                                    <div className="text-[10px] font-black" style={{ color: '#8a8172' }}>{line.by === 'system' ? '牌桌' : mahjongRoleName(game, line.by)}</div>
                                    <div className="mt-1 text-[12px] leading-relaxed" style={{ color: INK }}>{line.text}</div>
                                </div>
                            )) : <div className="text-[12px]" style={{ color: INK_SOFT }}>牌声还没响起。</div>}
                        </div>
                        {game.score && (
                            <div className="mt-4 rounded-[12px] border p-3" style={{ borderColor: 'rgba(31,29,26,0.16)', background: '#f7f1e5' }}>
                                <div className="text-[12px] font-black" style={{ color: INK }}>{game.score.draw ? '流局' : `${game.score.winner ? mahjongRoleName(game, game.score.winner) : '牌桌'} 和牌`}</div>
                                <div className="mt-1 text-[11px]" style={{ color: INK_SOFT }}>{game.score.fanNames.join(' / ') || '结算'}</div>
                                <div className="mt-2 grid grid-cols-2 gap-1 text-[11px]">
                                    {MAHJONG_ROLES.map(role => <span key={role}>{mahjongRoleName(game, role)}：{game.score?.deltas[role] || 0}</span>)}
                                </div>
                            </div>
                        )}
                    </PaperCard>
                </div>
            </div>
        </ScrapScroll>
    );
};

const MiniMeld: React.FC<{ tiles: MahjongTile[]; label: string }> = ({ tiles, label }) => (
    <div className="flex items-center gap-0.5 rounded-[6px] bg-[#efe6d3] px-1 py-1">
        {tiles.map(tile => <TileFace key={tile.id} tile={tile} mini />)}
        <span className="ml-1 text-[9px] font-black" style={{ color: INK_SOFT }}>{label}</span>
    </div>
);

const TileFace: React.FC<{ tile: MahjongTile; selected?: boolean; mini?: boolean }> = ({ tile, selected, mini }) => (
    <span
        className="inline-flex shrink-0 items-center justify-center rounded-[6px] border font-black shadow-sm"
        style={{
            width: mini ? 23 : 36,
            height: mini ? 31 : 50,
            background: 'linear-gradient(180deg,#fffef8 0%,#f5eedf 70%,#ded0b4 100%)',
            borderColor: selected ? '#1f1d1a' : 'rgba(31,29,26,0.2)',
            color: tileTone(tile),
            fontSize: mini ? 12 : 17,
            boxShadow: selected ? '0 8px 14px rgba(31,29,26,0.2)' : '0 3px 6px rgba(31,29,26,0.12)',
        }}
        title={tile.label}
    >
        {tile.label}
    </span>
);

export default MahjongApp;
