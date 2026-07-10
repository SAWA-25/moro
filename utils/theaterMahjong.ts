/**
 * 幕间集·麻将。
 * 四人本机休闲麻将：136 张无花，大众简化规则；模型只决定正式角色牌力与对白。
 */

import type {
    CharacterProfile,
    MahjongClaimAction,
    MahjongDialogueKind,
    MahjongDifficultyLevel,
    MahjongDifficultyMode,
    MahjongHuAnalysis,
    MahjongMeld,
    MahjongMeldType,
    MahjongMove,
    MahjongMoveEvent,
    MahjongPlayerRole,
    MahjongScoreSummary,
    MahjongSeatWind,
    MahjongTile,
    TheaterMahjongGame,
    UserProfile,
} from '../types';
import type { ResolvedApi } from './auxApi';
import { ContextBuilder } from './context';
import { callChatCompletion, stripThink } from './llmClient';
import { makeApiUsageMeta } from './apiUsageCatalog';
import { extractContent, extractJson } from './safeApi';
import {
    mahjongDialogueSystem,
    mahjongDialogueUser,
    mahjongDifficultySystem,
    mahjongOpeningDifficultyUser,
    mahjongPerMoveDifficultyUser,
} from './theaterPrompts';

export const MAHJONG_ROLES: MahjongPlayerRole[] = ['user', 'charA', 'charB', 'charC'];
export const MAHJONG_SEATS: MahjongSeatWind[] = ['east', 'south', 'west', 'north'];
export const MAHJONG_DIFFICULTY_LEVELS: MahjongDifficultyLevel[] = ['novice', 'casual', 'steady', 'sharp', 'master'];
export const MAHJONG_DIFFICULTY_LABELS: Record<MahjongDifficultyLevel, string> = {
    novice: '新手',
    casual: '休闲',
    steady: '稳健',
    sharp: '锋利',
    master: '高手',
};
export const MAHJONG_DIFFICULTY_MODE_LABELS: Record<MahjongDifficultyMode, string> = {
    opening: '开局定档',
    per_move: '每步评估',
};
export const MAHJONG_SEAT_LABELS: Record<MahjongSeatWind, string> = {
    east: '东',
    south: '南',
    west: '西',
    north: '北',
};

const SUIT_ORDER: Record<MahjongTile['suit'], number> = { wan: 0, tong: 1, tiao: 2, honor: 3 };
const HONOR_ORDER = ['east', 'south', 'west', 'north', 'zhong', 'fa', 'bai'] as const;
const HONOR_LABELS: Record<string, string> = {
    east: '东',
    south: '南',
    west: '西',
    north: '北',
    zhong: '中',
    fa: '发',
    bai: '白',
};
const CN_NUM = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

const genId = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const clampText = (value: unknown, max = 120): string => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);

const roleIndex = (role: MahjongPlayerRole) => MAHJONG_ROLES.indexOf(role);
const codeSuit = (code: string) => code[0];
const codeRank = (code: string) => Number(code.slice(1));
const isSuitCode = (code: string) => ['W', 'D', 'B'].includes(codeSuit(code));

export function sanitizeMahjongDifficultyLevel(value: unknown, fallback: MahjongDifficultyLevel = 'steady'): MahjongDifficultyLevel {
    return MAHJONG_DIFFICULTY_LEVELS.includes(value as MahjongDifficultyLevel) ? value as MahjongDifficultyLevel : fallback;
}

export function sanitizeMahjongDifficultyMode(value: unknown, fallback: MahjongDifficultyMode = 'opening'): MahjongDifficultyMode {
    const text = String(value || '').toLowerCase();
    if (value === 'per_move' || /per[_ -]?move|dynamic|每步|每手|每轮/.test(text)) return 'per_move';
    if (value === 'opening' || /opening|fixed|开局|定档/.test(text)) return 'opening';
    return fallback;
}

export function createMahjongDeck(): MahjongTile[] {
    const tiles: MahjongTile[] = [];
    const addTile = (base: Omit<MahjongTile, 'id' | 'copy'>) => {
        for (let copy = 0; copy < 4; copy += 1) {
            tiles.push({ ...base, id: `${base.code}_${copy}`, copy });
        }
    };
    for (let rank = 1; rank <= 9; rank += 1) {
        addTile({ suit: 'wan', rank, code: `W${rank}`, label: `${CN_NUM[rank]}万` });
        addTile({ suit: 'tong', rank, code: `D${rank}`, label: `${CN_NUM[rank]}筒` });
        addTile({ suit: 'tiao', rank, code: `B${rank}`, label: `${CN_NUM[rank]}条` });
    }
    HONOR_ORDER.forEach((honor, idx) => {
        addTile({ suit: 'honor', honor, code: `H${idx + 1}`, label: HONOR_LABELS[honor] });
    });
    return tiles;
}

const tileSortValue = (tile: MahjongTile) =>
    SUIT_ORDER[tile.suit] * 100 + (tile.suit === 'honor' ? HONOR_ORDER.indexOf(tile.honor as any) + 1 : tile.rank || 0) * 4 + tile.copy;

export function sortMahjongTiles(tiles: MahjongTile[]): MahjongTile[] {
    return [...tiles].sort((a, b) => tileSortValue(a) - tileSortValue(b));
}

export function shuffleMahjongDeck(rng: () => number = Math.random): MahjongTile[] {
    const deck = createMahjongDeck();
    for (let i = deck.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rng() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

export function dealMahjongTiles(deck = shuffleMahjongDeck(), dealer: MahjongPlayerRole = 'user'): Pick<TheaterMahjongGame, 'hands' | 'wall' | 'deadWall'> {
    const wall = [...deck];
    const hands: Record<MahjongPlayerRole, MahjongTile[]> = { user: [], charA: [], charB: [], charC: [] };
    for (const role of MAHJONG_ROLES) {
        const count = role === dealer ? 14 : 13;
        hands[role] = sortMahjongTiles(wall.splice(0, count));
    }
    return {
        hands,
        wall: wall.slice(0, Math.max(0, wall.length - 14)),
        deadWall: wall.slice(Math.max(0, wall.length - 14)),
    };
}

const countCodes = (tiles: MahjongTile[]) => {
    const map = new Map<string, number>();
    for (const tile of tiles) map.set(tile.code, (map.get(tile.code) || 0) + 1);
    return map;
};

const cloneCounts = (counts: Map<string, number>) => new Map(counts);
const dec = (counts: Map<string, number>, code: string, n = 1) => counts.set(code, (counts.get(code) || 0) - n);

function canFormSets(counts: Map<string, number>, neededSets: number): boolean {
    const first = [...counts.entries()].find(([, count]) => count > 0)?.[0];
    if (!first) return neededSets === 0;
    if (neededSets <= 0) return false;

    if ((counts.get(first) || 0) >= 3) {
        const next = cloneCounts(counts);
        dec(next, first, 3);
        if (canFormSets(next, neededSets - 1)) return true;
    }

    if (isSuitCode(first)) {
        const suit = codeSuit(first);
        const rank = codeRank(first);
        const c2 = `${suit}${rank + 1}`;
        const c3 = `${suit}${rank + 2}`;
        if (rank <= 7 && (counts.get(c2) || 0) > 0 && (counts.get(c3) || 0) > 0) {
            const next = cloneCounts(counts);
            dec(next, first);
            dec(next, c2);
            dec(next, c3);
            if (canFormSets(next, neededSets - 1)) return true;
        }
    }
    return false;
}

function isSevenPairs(tiles: MahjongTile[], melds: MahjongMeld[] = []) {
    if (melds.length || tiles.length !== 14) return false;
    const counts = [...countCodes(tiles).values()];
    return counts.length === 7 && counts.every(count => count === 2);
}

function hasStandardShape(tiles: MahjongTile[], melds: MahjongMeld[] = []) {
    const neededSets = 4 - melds.length;
    if (neededSets < 0 || tiles.length !== neededSets * 3 + 2) return false;
    const counts = countCodes(tiles);
    for (const [code, count] of counts.entries()) {
        if (count < 2) continue;
        const next = cloneCounts(counts);
        dec(next, code, 2);
        if (canFormSets(next, neededSets)) return true;
    }
    return false;
}

function isQingYiSe(tiles: MahjongTile[], melds: MahjongMeld[] = []) {
    const all = [...tiles, ...melds.flatMap(m => m.tiles)];
    const suited = all.filter(tile => tile.suit !== 'honor');
    return all.length > 0 && suited.length === all.length && new Set(suited.map(tile => tile.suit)).size === 1;
}

function concealedAllTriplets(tiles: MahjongTile[], melds: MahjongMeld[] = []) {
    if (melds.some(m => m.type === 'chi')) return false;
    const neededSets = 4 - melds.length;
    if (neededSets < 0 || tiles.length !== neededSets * 3 + 2) return false;
    const counts = countCodes(tiles);
    for (const [code, count] of counts.entries()) {
        if (count < 2) continue;
        const next = cloneCounts(counts);
        dec(next, code, 2);
        let sets = 0;
        let ok = true;
        for (const value of next.values()) {
            if (value === 0) continue;
            if (value !== 3) ok = false;
            sets += value / 3;
        }
        if (ok && sets === neededSets) return true;
    }
    return false;
}

export function analyzeMahjongHu(tiles: MahjongTile[], melds: MahjongMeld[] = []): MahjongHuAnalysis {
    const hand = sortMahjongTiles(tiles);
    const fanNames: string[] = [];
    let ok = false;
    let pattern: MahjongHuAnalysis['pattern'];
    let fan = 0;

    if (isSevenPairs(hand, melds)) {
        ok = true;
        pattern = 'seven_pairs';
        fan = 2;
        fanNames.push('七对');
    } else if (hasStandardShape(hand, melds)) {
        ok = true;
        pattern = 'standard';
        fan = 1;
        fanNames.push('平胡');
    }

    if (!ok) return { ok: false, fan: 0, fanNames: [] };
    if (concealedAllTriplets(hand, melds)) {
        fan = Math.max(fan, 2);
        fanNames.push('碰碰胡');
    }
    if (isQingYiSe(hand, melds)) {
        fan = Math.max(fan, 4);
        fanNames.push('清一色');
    }
    return { ok, pattern, fan: Math.max(1, fan), fanNames: [...new Set(fanNames)] };
}

export const canMahjongHu = (tiles: MahjongTile[], melds: MahjongMeld[] = []) => analyzeMahjongHu(tiles, melds).ok;

export const mahjongRoleName = (game: Pick<TheaterMahjongGame, 'players' | 'userName'>, role: MahjongPlayerRole): string =>
    game.players.find(p => p.role === role)?.name || (role === 'user' ? game.userName : role);

export function nextMahjongRole(game: Pick<TheaterMahjongGame, 'players'>, role: MahjongPlayerRole): MahjongPlayerRole {
    const ordered = [...game.players].sort((a, b) => MAHJONG_SEATS.indexOf(a.seat) - MAHJONG_SEATS.indexOf(b.seat)).map(p => p.role);
    const idx = ordered.indexOf(role);
    return ordered[(idx + 1 + ordered.length) % ordered.length] || MAHJONG_ROLES[(roleIndex(role) + 1) % MAHJONG_ROLES.length];
}

const handHasIds = (hand: MahjongTile[], ids: string[]) => ids.every(id => hand.some(tile => tile.id === id));
const removeTileIds = (hand: MahjongTile[], ids: string[]) => {
    const remaining = [...hand];
    for (const id of ids) {
        const idx = remaining.findIndex(tile => tile.id === id);
        if (idx >= 0) remaining.splice(idx, 1);
    }
    return sortMahjongTiles(remaining);
};

export function listMahjongChiOptions(hand: MahjongTile[], discard: MahjongTile): MahjongTile[][] {
    if (discard.suit === 'honor' || !discard.rank) return [];
    const options: MahjongTile[][] = [];
    const ranks = [[discard.rank - 2, discard.rank - 1], [discard.rank - 1, discard.rank + 1], [discard.rank + 1, discard.rank + 2]];
    for (const pair of ranks) {
        if (pair.some(rank => rank < 1 || rank > 9)) continue;
        const picked: MahjongTile[] = [];
        for (const rank of pair) {
            const found = hand.find(tile => tile.suit === discard.suit && tile.rank === rank && !picked.some(p => p.id === tile.id));
            if (found) picked.push(found);
        }
        if (picked.length === 2) options.push(sortMahjongTiles(picked));
    }
    return options;
}

const codeTiles = (hand: MahjongTile[], code: string) => hand.filter(tile => tile.code === code);
const removeClaimedDiscard = (discards: TheaterMahjongGame['discards'], from: MahjongPlayerRole, tile: MahjongTile) => {
    const list = [...(discards[from] || [])];
    const idx = [...list].reverse().findIndex(t => t.id === tile.id);
    if (idx >= 0) list.splice(list.length - 1 - idx, 1);
    return { ...discards, [from]: list };
};

export function getMahjongClaimActions(game: TheaterMahjongGame, role: MahjongPlayerRole, discard = game.pendingClaim?.discard, from = game.pendingClaim?.from): MahjongClaimAction[] {
    if (!discard || !from || role === from || game.status !== 'playing') return [];
    const hand = game.hands[role] || [];
    const melds = game.melds[role] || [];
    const actions: MahjongClaimAction[] = [];
    if (canMahjongHu([...hand, discard], melds)) actions.push('hu');
    if (codeTiles(hand, discard.code).length >= 3) actions.push('gang');
    if (codeTiles(hand, discard.code).length >= 2) actions.push('peng');
    if (nextMahjongRole(game, from) === role && listMahjongChiOptions(hand, discard).length) actions.push('chi');
    return actions;
}

function buildPendingClaim(game: TheaterMahjongGame, tile: MahjongTile, from: MahjongPlayerRole, moveNo: number): TheaterMahjongGame['pendingClaim'] | undefined {
    const actions: Partial<Record<MahjongPlayerRole, MahjongClaimAction[]>> = {};
    for (const role of MAHJONG_ROLES) {
        const options = getMahjongClaimActions({ ...game, pendingClaim: undefined }, role, tile, from).filter(a => a !== 'pass');
        if (options.length) actions[role] = options;
    }
    return Object.keys(actions).length ? { discard: tile, from, moveNo, actions, passed: [] } : undefined;
}

function moveBase(game: TheaterMahjongGame, type: MahjongMove['type'], by: MahjongMove['by'], now: number): MahjongMove {
    return { no: (game.moves || []).length + 1, type, by, at: now };
}

function normalizePlayers(userName: string, chars: CharacterProfile[], dealer: MahjongPlayerRole) {
    const base: Array<{ role: MahjongPlayerRole; name: string; charId?: string }> = [
        { role: 'user', name: userName },
        { role: 'charA', name: chars[0]?.name || '一号角色', charId: chars[0]?.id },
        { role: 'charB', name: chars[1]?.name || '二号角色', charId: chars[1]?.id },
        { role: 'charC', name: chars[2]?.name || '三号角色', charId: chars[2]?.id },
    ];
    const dealerIndex = Math.max(0, base.findIndex(p => p.role === dealer));
    return base.map((player, index) => ({
        ...player,
        seat: MAHJONG_SEATS[(index - dealerIndex + MAHJONG_SEATS.length) % MAHJONG_SEATS.length],
    }));
}

export function createMahjongGame(
    userName: string,
    chars: [CharacterProfile, CharacterProfile, CharacterProfile],
    opts: {
        difficultyMode?: MahjongDifficultyMode;
        difficultyLevels?: Partial<Record<MahjongPlayerRole, MahjongDifficultyLevel>>;
        invitationId?: string;
        dealer?: MahjongPlayerRole;
        rng?: () => number;
    } = {},
): TheaterMahjongGame {
    const dealer = opts.dealer || 'user';
    const dealt = dealMahjongTiles(shuffleMahjongDeck(opts.rng), dealer);
    const players = normalizePlayers(userName, chars, dealer);
    return {
        id: genId('mahjong'),
        title: '一桌麻将',
        userName,
        charIds: chars.map(c => c.id).filter(Boolean),
        players,
        status: 'playing',
        phase: 'discard',
        difficultyMode: sanitizeMahjongDifficultyMode(opts.difficultyMode, 'opening'),
        difficultyLevels: {
            charA: sanitizeMahjongDifficultyLevel(opts.difficultyLevels?.charA, 'steady'),
            charB: sanitizeMahjongDifficultyLevel(opts.difficultyLevels?.charB, 'steady'),
            charC: sanitizeMahjongDifficultyLevel(opts.difficultyLevels?.charC, 'steady'),
        },
        dealer,
        currentTurn: dealer,
        wall: dealt.wall,
        deadWall: dealt.deadWall,
        hands: dealt.hands,
        melds: { user: [], charA: [], charB: [], charC: [] },
        discards: { user: [], charA: [], charB: [], charC: [] },
        moves: [{ no: 1, type: 'deal', by: 'system', at: Date.now(), eventTags: ['deal'] }],
        dialogue: [],
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        invitationId: opts.invitationId,
    };
}

export function normalizeMahjongGame(game: TheaterMahjongGame): TheaterMahjongGame {
    const hands = game.hands || {} as TheaterMahjongGame['hands'];
    const melds = game.melds || {} as TheaterMahjongGame['melds'];
    const discards = game.discards || {} as TheaterMahjongGame['discards'];
    return {
        ...game,
        status: game.status === 'ended' ? 'ended' : 'playing',
        phase: game.status === 'ended' ? 'ended' : (game.phase || 'discard'),
        difficultyMode: sanitizeMahjongDifficultyMode(game.difficultyMode, 'opening'),
        difficultyLevels: {
            charA: sanitizeMahjongDifficultyLevel(game.difficultyLevels?.charA, 'steady'),
            charB: sanitizeMahjongDifficultyLevel(game.difficultyLevels?.charB, 'steady'),
            charC: sanitizeMahjongDifficultyLevel(game.difficultyLevels?.charC, 'steady'),
        },
        dealer: game.dealer || 'user',
        currentTurn: game.currentTurn || game.dealer || 'user',
        wall: game.wall || [],
        deadWall: game.deadWall || [],
        hands: {
            user: sortMahjongTiles(hands.user || []),
            charA: sortMahjongTiles(hands.charA || []),
            charB: sortMahjongTiles(hands.charB || []),
            charC: sortMahjongTiles(hands.charC || []),
        },
        melds: {
            user: melds.user || [],
            charA: melds.charA || [],
            charB: melds.charB || [],
            charC: melds.charC || [],
        },
        discards: {
            user: discards.user || [],
            charA: discards.charA || [],
            charB: discards.charB || [],
            charC: discards.charC || [],
        },
        moves: game.moves || [],
        dialogue: game.dialogue || [],
    };
}

function drawSupplement(game: TheaterMahjongGame) {
    const deadWall = [...game.deadWall];
    const wall = [...game.wall];
    const tile = deadWall.shift() || wall.pop();
    return { tile, deadWall, wall };
}

export function applyMahjongDraw(input: TheaterMahjongGame, by: MahjongPlayerRole, now = Date.now()): { ok: true; game: TheaterMahjongGame; tile?: MahjongTile; events: MahjongMoveEvent[] } | { ok: false; game: TheaterMahjongGame; reason: string; events: MahjongMoveEvent[] } {
    const game = normalizeMahjongGame(input);
    if (game.status === 'ended') return { ok: false, game, reason: '牌局已经结束。', events: ['illegal'] };
    if (game.pendingClaim || game.phase !== 'draw' || game.currentTurn !== by) return { ok: false, game, reason: '还没轮到这里摸牌。', events: ['illegal'] };
    const wall = [...game.wall];
    const tile = wall.shift();
    if (!tile) {
        const score: MahjongScoreSummary = { fan: 0, fanNames: ['流局'], deltas: { user: 0, charA: 0, charB: 0, charC: 0 }, draw: true };
        return {
            ok: true,
            tile: undefined,
            events: ['draw_game'],
            game: { ...game, status: 'ended', phase: 'ended', score, wall, endedAt: now, lastActiveAt: now, moves: [...game.moves, { ...moveBase(game, 'liuju', 'system', now), eventTags: ['draw_game'] }] },
        };
    }
    const move: MahjongMove = { ...moveBase(game, 'draw', by, now), tile, eventTags: ['draw'] };
    return {
        ok: true,
        tile,
        events: ['draw'],
        game: {
            ...game,
            wall,
            drawnTile: tile,
            phase: 'discard',
            hands: { ...game.hands, [by]: sortMahjongTiles([...(game.hands[by] || []), tile]) },
            moves: [...game.moves, move],
            lastActiveAt: now,
        },
    };
}

export function applyMahjongDiscard(input: TheaterMahjongGame, by: MahjongPlayerRole, tileId: string, now = Date.now()): { ok: true; game: TheaterMahjongGame; move: MahjongMove; events: MahjongMoveEvent[] } | { ok: false; game: TheaterMahjongGame; reason: string; events: MahjongMoveEvent[] } {
    const game = normalizeMahjongGame(input);
    if (game.status === 'ended') return { ok: false, game, reason: '牌局已经结束。', events: ['illegal'] };
    if (game.pendingClaim || game.phase !== 'discard' || game.currentTurn !== by) return { ok: false, game, reason: '现在不能出这张。', events: ['illegal'] };
    const hand = game.hands[by] || [];
    const tile = hand.find(t => t.id === tileId);
    if (!tile) return { ok: false, game, reason: '手里没有这张牌。', events: ['illegal'] };
    const nextHands = { ...game.hands, [by]: removeTileIds(hand, [tileId]) };
    const move: MahjongMove = { ...moveBase(game, 'discard', by, now), tile, eventTags: ['discard', 'normal'] };
    const afterDiscard: TheaterMahjongGame = {
        ...game,
        hands: nextHands,
        discards: { ...game.discards, [by]: [...(game.discards[by] || []), tile] },
        drawnTile: game.drawnTile?.id === tile.id ? undefined : game.drawnTile,
        moves: [...game.moves, move],
        lastActiveAt: now,
    };
    const pendingClaim = buildPendingClaim(afterDiscard, tile, by, move.no);
    if (!pendingClaim) {
        return {
            ok: true,
            move,
            events: ['discard', 'normal'],
            game: { ...afterDiscard, phase: 'draw', currentTurn: nextMahjongRole(afterDiscard, by), pendingClaim: undefined },
        };
    }
    return {
        ok: true,
        move,
        events: ['discard', 'normal', 'block'],
        game: { ...afterDiscard, phase: 'claim', pendingClaim },
    };
}

export function passMahjongClaim(input: TheaterMahjongGame, by: MahjongPlayerRole, now = Date.now()) {
    const game = normalizeMahjongGame(input);
    const pending = game.pendingClaim;
    if (!pending || !pending.actions[by]) return { ok: false as const, game, reason: '当前没有可过的牌。', events: ['illegal'] as MahjongMoveEvent[] };
    const passed = [...new Set([...pending.passed, by])];
    const active = Object.keys(pending.actions) as MahjongPlayerRole[];
    const move: MahjongMove = { ...moveBase(game, 'pass', by, now), tile: pending.discard, from: pending.from, eventTags: ['blocked'] };
    if (active.every(role => passed.includes(role))) {
        return {
            ok: true as const,
            game: { ...game, pendingClaim: undefined, phase: 'draw', currentTurn: nextMahjongRole(game, pending.from), moves: [...game.moves, move], lastActiveAt: now },
            move,
            events: ['blocked'] as MahjongMoveEvent[],
        };
    }
    return {
        ok: true as const,
        game: { ...game, pendingClaim: { ...pending, passed }, moves: [...game.moves, move], lastActiveAt: now },
        move,
        events: ['blocked'] as MahjongMoveEvent[],
    };
}

function chooseChiTiles(hand: MahjongTile[], discard: MahjongTile, tileIds?: string[]) {
    if (tileIds?.length === 2 && handHasIds(hand, tileIds)) return tileIds.map(id => hand.find(tile => tile.id === id)!).filter(Boolean);
    return listMahjongChiOptions(hand, discard)[0] || [];
}

export function applyMahjongClaim(input: TheaterMahjongGame, by: MahjongPlayerRole, action: MahjongClaimAction, tileIds: string[] = [], now = Date.now()): { ok: true; game: TheaterMahjongGame; move: MahjongMove; events: MahjongMoveEvent[] } | { ok: false; game: TheaterMahjongGame; reason: string; events: MahjongMoveEvent[] } {
    const game = normalizeMahjongGame(input);
    const pending = game.pendingClaim;
    if (!pending || !pending.actions[by]?.includes(action)) return { ok: false, game, reason: '这个动作现在不能做。', events: ['illegal'] };
    if (action === 'pass') return passMahjongClaim(game, by, now) as any;
    const hand = game.hands[by] || [];
    const discard = pending.discard;
    const melds = game.melds[by] || [];

    if (action === 'hu') {
        const analysis = analyzeMahjongHu([...hand, discard], melds);
        if (!analysis.ok) return { ok: false, game, reason: '这手还不能胡。', events: ['illegal'] };
        const score = scoreMahjongWin(game, by, pending.from, 'dianpao', analysis);
        const move: MahjongMove = { ...moveBase(game, 'hu', by, now), tile: discard, from: pending.from, eventTags: ['dianpao', 'win', 'block'] };
        return {
            ok: true,
            move,
            events: ['dianpao', 'win', 'block'],
            game: { ...game, status: 'ended', phase: 'ended', winner: by, loser: pending.from, score, pendingClaim: undefined, moves: [...game.moves, move], endedAt: now, lastActiveAt: now },
        };
    }

    let used: MahjongTile[] = [];
    let meldType: MahjongMeldType;
    let events: MahjongMoveEvent[];
    if (action === 'peng') {
        used = codeTiles(hand, discard.code).slice(0, 2);
        meldType = 'peng';
        events = ['peng', 'block'];
    } else if (action === 'gang') {
        used = codeTiles(hand, discard.code).slice(0, 3);
        meldType = 'ming_gang';
        events = ['gang', 'block', 'ganged'];
    } else {
        used = chooseChiTiles(hand, discard, tileIds);
        meldType = 'chi';
        events = ['chi', 'block'];
    }
    if ((action === 'chi' && used.length !== 2) || (action === 'peng' && used.length !== 2) || (action === 'gang' && used.length !== 3)) {
        return { ok: false, game, reason: '手牌不足，不能这样吃碰杠。', events: ['illegal'] };
    }
    const meld: MahjongMeld = { id: genId('mjm'), type: meldType, by, from: pending.from, tiles: sortMahjongTiles([...used, discard]), claimedTile: discard, at: now };
    let nextHand = removeTileIds(hand, used.map(tile => tile.id));
    let wall = game.wall;
    let deadWall = game.deadWall;
    if (action === 'gang') {
        const supplement = drawSupplement(game);
        wall = supplement.wall;
        deadWall = supplement.deadWall;
        if (supplement.tile) nextHand = sortMahjongTiles([...nextHand, supplement.tile]);
    }
    const move: MahjongMove = { ...moveBase(game, action === 'gang' ? 'ming_gang' : action, by, now), tile: discard, tiles: meld.tiles, from: pending.from, eventTags: events };
    return {
        ok: true,
        move,
        events,
        game: {
            ...game,
            wall,
            deadWall,
            hands: { ...game.hands, [by]: nextHand },
            melds: { ...game.melds, [by]: [...melds, meld] },
            discards: removeClaimedDiscard(game.discards, pending.from, discard),
            pendingClaim: undefined,
            phase: 'discard',
            currentTurn: by,
            moves: [...game.moves, move],
            lastActiveAt: now,
        },
    };
}

export function applyMahjongSelfWin(input: TheaterMahjongGame, by: MahjongPlayerRole, now = Date.now()): { ok: true; game: TheaterMahjongGame; move: MahjongMove; events: MahjongMoveEvent[] } | { ok: false; game: TheaterMahjongGame; reason: string; events: MahjongMoveEvent[] } {
    const game = normalizeMahjongGame(input);
    const analysis = analyzeMahjongHu(game.hands[by] || [], game.melds[by] || []);
    if (game.status === 'ended' || game.phase !== 'discard' || game.currentTurn !== by || !analysis.ok) {
        return { ok: false as const, game, reason: '现在还不能自摸。', events: ['illegal'] as MahjongMoveEvent[] };
    }
    const score = scoreMahjongWin(game, by, undefined, 'zimo', analysis);
    const move: MahjongMove = { ...moveBase(game, 'zimo', by, now), eventTags: ['zimo', 'win'] };
    const endedGame: TheaterMahjongGame = { ...game, status: 'ended', phase: 'ended', winner: by, score, moves: [...game.moves, move], endedAt: now, lastActiveAt: now };
    return { ok: true as const, game: endedGame, move, events: ['zimo', 'win'] as MahjongMoveEvent[] };
}

export function applyMahjongSelfGang(input: TheaterMahjongGame, by: MahjongPlayerRole, code?: string, now = Date.now()) {
    const game = normalizeMahjongGame(input);
    if (game.status === 'ended' || game.phase !== 'discard' || game.currentTurn !== by) return { ok: false as const, game, reason: '现在不能杠。', events: ['illegal'] as MahjongMoveEvent[] };
    const hand = game.hands[by] || [];
    const targetCode = code || [...countCodes(hand).entries()].find(([, count]) => count >= 4)?.[0];
    if (!targetCode) return { ok: false as const, game, reason: '没有可杠的牌。', events: ['illegal'] as MahjongMoveEvent[] };
    let used = codeTiles(hand, targetCode).slice(0, 4);
    let type: MahjongMeldType = 'an_gang';
    let nextMelds = [...(game.melds[by] || [])];
    const pengIndex = nextMelds.findIndex(m => m.type === 'peng' && m.tiles[0]?.code === targetCode);
    if (used.length < 4 && pengIndex >= 0 && codeTiles(hand, targetCode).length >= 1) {
        used = codeTiles(hand, targetCode).slice(0, 1);
        type = 'bu_gang';
        nextMelds[pengIndex] = { ...nextMelds[pengIndex], type, tiles: sortMahjongTiles([...nextMelds[pengIndex].tiles, used[0]]) };
    } else if (used.length === 4) {
        nextMelds.push({ id: genId('mjm'), type, by, tiles: used, at: now });
    } else {
        return { ok: false as const, game, reason: '没有可杠的牌。', events: ['illegal'] as MahjongMoveEvent[] };
    }
    const supplement = drawSupplement(game);
    const nextHand = sortMahjongTiles([...removeTileIds(hand, used.map(tile => tile.id)), ...(supplement.tile ? [supplement.tile] : [])]);
    const events: MahjongMoveEvent[] = type === 'an_gang' ? ['an_gang', 'gang'] : ['bu_gang', 'gang'];
    const move: MahjongMove = { ...moveBase(game, type, by, now), tiles: used, eventTags: events };
    return {
        ok: true as const,
        game: { ...game, wall: supplement.wall, deadWall: supplement.deadWall, hands: { ...game.hands, [by]: nextHand }, melds: { ...game.melds, [by]: nextMelds }, moves: [...game.moves, move], lastActiveAt: now },
        move,
        events,
    };
}

export function scoreMahjongWin(game: TheaterMahjongGame, winner: MahjongPlayerRole, from: MahjongPlayerRole | undefined, winType: 'zimo' | 'dianpao', analysis: MahjongHuAnalysis): MahjongScoreSummary {
    const fan = Math.max(1, analysis.fan || 1);
    const point = 2 ** (fan - 1);
    const deltas: Record<MahjongPlayerRole, number> = { user: 0, charA: 0, charB: 0, charC: 0 };
    if (winType === 'zimo') {
        for (const role of MAHJONG_ROLES) {
            if (role === winner) continue;
            deltas[role] -= point;
            deltas[winner] += point;
        }
    } else {
        const loser = from || nextMahjongRole(game, winner);
        deltas[loser] -= point;
        deltas[winner] += point;
    }
    return { winner, from, winType, pattern: analysis.pattern, fan, fanNames: analysis.fanNames, deltas };
}

export function resignMahjongGame(input: TheaterMahjongGame, by: MahjongPlayerRole, now = Date.now()): TheaterMahjongGame {
    const game = normalizeMahjongGame(input);
    const winner = MAHJONG_ROLES.find(role => role !== by) || 'user';
    const deltas: Record<MahjongPlayerRole, number> = { user: 0, charA: 0, charB: 0, charC: 0 };
    deltas[by] = -1;
    deltas[winner] = 1;
    return { ...game, status: 'ended', phase: 'ended', winner, loser: by, score: { winner, from: by, winType: 'dianpao', fan: 1, fanNames: ['认输'], deltas }, endedAt: now, lastActiveAt: now };
}

const tileEfficiency = (hand: MahjongTile[], tile: MahjongTile) => {
    const same = codeTiles(hand, tile.code).length - 1;
    if (tile.suit === 'honor') return same * 5;
    const near = [-2, -1, 1, 2].reduce((sum, delta) => sum + hand.filter(t => t.suit === tile.suit && t.rank === (tile.rank || 0) + delta).length, 0);
    return same * 5 + near;
};

export function chooseMahjongDiscard(game: TheaterMahjongGame, role: MahjongPlayerRole, difficulty: MahjongDifficultyLevel = 'steady', rng: () => number = Math.random): MahjongTile | null {
    const hand = sortMahjongTiles(game.hands[role] || []);
    if (!hand.length) return null;
    if (difficulty === 'novice') return hand[Math.floor(rng() * hand.length)] || hand[0];
    const ranked = hand.map(tile => ({ tile, score: tileEfficiency(hand, tile) + (tile.suit === 'honor' ? 0.5 : 0) }))
        .sort((a, b) => a.score - b.score || tileSortValue(a.tile) - tileSortValue(b.tile));
    if (difficulty === 'casual') return ranked[Math.min(ranked.length - 1, Math.floor(rng() * Math.min(4, ranked.length)))]?.tile || ranked[0].tile;
    if (difficulty === 'master' || difficulty === 'sharp') return ranked[0].tile;
    return ranked[Math.min(1, ranked.length - 1)]?.tile || ranked[0].tile;
}

export function chooseMahjongClaim(game: TheaterMahjongGame, role: MahjongPlayerRole, difficulty: MahjongDifficultyLevel = 'steady', rng: () => number = Math.random): MahjongClaimAction {
    const actions = game.pendingClaim?.actions[role] || [];
    if (!actions.length) return 'pass';
    if (actions.includes('hu') && (difficulty !== 'novice' || rng() > 0.15)) return 'hu';
    if (difficulty === 'novice') return rng() > 0.72 ? (actions.includes('peng') ? 'peng' : actions[actions.length - 1]) : 'pass';
    if (difficulty === 'casual') return actions.includes('peng') && rng() > 0.35 ? 'peng' : (actions.includes('chi') && rng() > 0.55 ? 'chi' : 'pass');
    if (actions.includes('gang') && (difficulty === 'sharp' || difficulty === 'master')) return 'gang';
    if (actions.includes('peng')) return 'peng';
    if (actions.includes('chi')) return 'chi';
    return 'pass';
}

export function addMahjongDialogue(game: TheaterMahjongGame, kind: MahjongDialogueKind, text: string, by: MahjongPlayerRole | 'system' = 'system', moveNo?: number, now = Date.now()): TheaterMahjongGame {
    const clean = clampText(text, 120);
    if (!clean) return game;
    return { ...game, dialogue: [...(game.dialogue || []), { id: genId('mjd'), by, kind, text: clean, at: now, moveNo }].slice(-140), lastActiveAt: now };
}

function eventText(events: MahjongMoveEvent[]) {
    const labels: Record<MahjongMoveEvent, string> = {
        deal: '发牌',
        thinking: '角色思考',
        draw: '摸牌',
        discard: '出牌',
        normal: '普通出牌',
        chi: '吃',
        peng: '碰',
        gang: '杠',
        an_gang: '暗杠',
        bu_gang: '补杠',
        block: '拦牌',
        blocked: '被拦/过',
        ganged: '被杠',
        danger: '危险牌',
        zimo: '自摸',
        dianpao: '点炮',
        win: '胜利',
        lose: '落败',
        draw_game: '流局',
        illegal: '非法操作提示',
    };
    return events.map(e => labels[e] || e).join('、');
}

export function mahjongGameSummary(game: TheaterMahjongGame, limit = 16): string {
    const g = normalizeMahjongGame(game);
    const players = g.players.map(p => `${MAHJONG_SEAT_LABELS[p.seat]} ${p.name} 手牌${g.hands[p.role]?.length || 0} 副露${g.melds[p.role]?.length || 0}`).join('；');
    const last = g.moves.slice(-limit).map(m => {
        const by = m.by === 'system' ? '系统' : mahjongRoleName(g, m.by);
        return `${m.no}. ${by} ${m.type}${m.tile ? ` ${m.tile.label}` : ''}${m.tiles?.length ? ` ${m.tiles.map(t => t.label).join(' ')}` : ''}`;
    }).join('\n');
    return [`状态：${g.status}/${g.phase}，牌墙${g.wall.length}，当前${mahjongRoleName(g, g.currentTurn)}`, `座位：${players}`, `最近动作：\n${last || '暂无'}`].join('\n');
}

export function fallbackMahjongDialogue(kind: MahjongDialogueKind, charName: string, events: MahjongMoveEvent[] = []): string {
    if (kind === 'illegal') return '这张不合规，先别急着推出去。';
    if (events.includes('zimo') || kind === 'zimo') return '自摸。牌声落下来的时候刚刚好。';
    if (events.includes('dianpao') || kind === 'dianpao') return '这张点得有点痛，我记住了。';
    if (events.includes('gang') || kind === 'gang') return '杠一下，牌墙后面还藏着一口气。';
    if (events.includes('peng') || kind === 'peng') return '碰。这个节奏不能让你顺着走。';
    if (events.includes('chi') || kind === 'chi') return '吃进来，先把路接上。';
    if (events.includes('block') || kind === 'block') return '这张我拦一下，不让它白白溜过去。';
    if (events.includes('blocked') || kind === 'blocked') return '过，先忍一手。';
    if (events.includes('draw_game') || kind === 'draw_game') return '摸尽了也没见真章，这桌有点硬。';
    if (events.includes('win') || kind === 'win') return '和了。今天这口气算是顺了。';
    if (events.includes('lose') || kind === 'lose') return '这局让你收得漂亮，下局我会盯紧一点。';
    if (kind === 'thinking') return `${charName}把牌拢了拢，像是在重新算路。`;
    if (kind === 'invite') return '四个人刚好，来打一圈简化麻将？';
    return '我打这张。';
}

export function parseMahjongDifficultyResult(raw: unknown, fallbackLevel: MahjongDifficultyLevel = 'steady', fallbackMode?: MahjongDifficultyMode) {
    const parsed = typeof raw === 'string' ? extractJson(raw) : raw;
    const obj = parsed && typeof parsed === 'object' ? parsed as any : {};
    return {
        difficultyLevel: sanitizeMahjongDifficultyLevel(obj.difficultyLevel ?? obj.level ?? obj.difficulty, fallbackLevel),
        difficultyMode: obj.difficultyMode || obj.mode ? sanitizeMahjongDifficultyMode(obj.difficultyMode ?? obj.mode, fallbackMode || 'opening') : fallbackMode,
        reason: clampText(obj.reason, 80) || undefined,
    };
}

export function heuristicCharacterMahjongDifficulty(char: CharacterProfile): MahjongDifficultyLevel {
    const text = [char.name, (char as any).description, (char as any).personality, (char as any).scenario, (char as any).systemPrompt].filter(Boolean).join('\n').toLowerCase();
    if (/麻将|雀|牌|赌|算牌|胜负|策略|老练|精明|高手|天才|侦探|军师/.test(text)) return 'sharp';
    if (/聪明|理性|冷静|谨慎|推理|数学|计划|观察/.test(text)) return 'steady';
    if (/笨|迷糊|冒失|随性|幼稚|第一次|新手/.test(text)) return 'casual';
    return 'steady';
}

async function callMahjongJson(api: ResolvedApi, char: CharacterProfile, userName: string, system: string, user: string, maxTokens = 360): Promise<any | null> {
    if (!api.baseUrl || !api.model) throw new Error('请先在「文具盒」里配置 API');
    const data = await callChatCompletion(api, {
        model: api.model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        temperature: 0.72,
        max_tokens: maxTokens,
        stream: false,
    }, {
        meta: makeApiUsageMeta('theater.mahjong', {
            charId: char.id,
            charName: char.name,
            apiRole: api.apiRole || 'aux',
            apiBinding: api.apiBinding,
        }),
        presetScope: 'role.scene',
        presetMacros: { charName: char.name, userName },
    });
    return extractJson(stripThink(extractContent(data) || ''));
}

async function mahjongSystem(char: CharacterProfile, userProfile: UserProfile) {
    const userName = (userProfile.name || '').trim() || '用户';
    const core = await ContextBuilder.buildFullCoreContext(char, userProfile, true);
    return { userName, system: mahjongDifficultySystem({ core, charName: char.name, userName }) };
}

export async function decideMahjongOpeningDifficulty(char: CharacterProfile, userProfile: UserProfile, api: ResolvedApi | null | undefined, mode: MahjongDifficultyMode, invite = false): Promise<{ difficultyLevel: MahjongDifficultyLevel; reason?: string; source: 'llm' | 'fallback' }> {
    const fallback = heuristicCharacterMahjongDifficulty(char);
    if (!api?.baseUrl || !api.model) return { difficultyLevel: fallback, source: 'fallback' };
    try {
        const { system, userName } = await mahjongSystem(char, userProfile);
        const raw = await callMahjongJson(api, char, userName, system, mahjongOpeningDifficultyUser({ mode, charName: char.name, userName, invite }));
        const parsed = parseMahjongDifficultyResult(raw, fallback);
        return { difficultyLevel: parsed.difficultyLevel, reason: parsed.reason, source: 'llm' };
    } catch {
        return { difficultyLevel: fallback, source: 'fallback' };
    }
}

export async function decideMahjongPerMoveDifficulty(char: CharacterProfile, userProfile: UserProfile, api: ResolvedApi | null | undefined, game: TheaterMahjongGame, role: MahjongPlayerRole, events: MahjongMoveEvent[]): Promise<{ difficultyLevel: MahjongDifficultyLevel; reason?: string; source: 'llm' | 'fallback' }> {
    const fallback = sanitizeMahjongDifficultyLevel(game.difficultyLevels?.[role], heuristicCharacterMahjongDifficulty(char));
    if (!api?.baseUrl || !api.model) return { difficultyLevel: fallback, source: 'fallback' };
    try {
        const { system, userName } = await mahjongSystem(char, userProfile);
        const raw = await callMahjongJson(api, char, userName, system, mahjongPerMoveDifficultyUser({
            charName: char.name,
            userName,
            difficultyLevel: fallback,
            table: mahjongGameSummary(game),
            event: eventText(events),
        }));
        const parsed = parseMahjongDifficultyResult(raw, fallback);
        return { difficultyLevel: parsed.difficultyLevel, reason: parsed.reason, source: 'llm' };
    } catch {
        return { difficultyLevel: fallback, source: 'fallback' };
    }
}

export async function generateMahjongDialogue(char: CharacterProfile, userProfile: UserProfile, api: ResolvedApi | null | undefined, game: TheaterMahjongGame, role: MahjongPlayerRole, events: MahjongMoveEvent[], move?: MahjongMove): Promise<string> {
    const kind = (events.find(e => e !== 'normal') || 'normal') as MahjongDialogueKind;
    if (!api?.baseUrl || !api.model) return fallbackMahjongDialogue(kind, char.name, events);
    try {
        const userName = (userProfile.name || '').trim() || game.userName || '用户';
        const core = await ContextBuilder.buildFullCoreContext(char, userProfile, true);
        const system = mahjongDialogueSystem({ core, charName: char.name, userName });
        const lastMove = move
            ? `${mahjongRoleName(game, move.by as MahjongPlayerRole)} ${move.type}${move.tile ? ` ${move.tile.label}` : ''}${move.tiles?.length ? ` ${move.tiles.map(t => t.label).join(' ')}` : ''}`
            : '尚未行动';
        const raw = await callMahjongJson(api, char, userName, system, mahjongDialogueUser({
            charName: char.name,
            userName,
            event: eventText(events),
            table: mahjongGameSummary(game),
            difficultyLevel: game.difficultyLevels?.[role] || 'steady',
            lastMove,
        }), 240);
        const text = clampText((raw as any)?.text || raw, 80);
        return text || fallbackMahjongDialogue(kind, char.name, events);
    } catch {
        return fallbackMahjongDialogue(kind, char.name, events);
    }
}

export const formatMahjongTiles = (tiles: MahjongTile[]) => sortMahjongTiles(tiles).map(tile => tile.label).join(' ');
