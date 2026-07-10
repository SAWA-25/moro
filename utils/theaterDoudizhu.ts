/**
 * 幕间集·斗地主。
 * ==============
 * 三人经典休闲规则：54 张牌，叫分 1/2/3/不叫，三张底牌，炸弹/王炸翻倍，
 * 春天/反春天结算。模型只判断正式角色牌力与对白；本地引擎负责合法牌型、
 * 出牌选择和兜底。
 *
 * prompt 文案集中在 utils/theaterPrompts.ts（[拾叁] 斗地主 区段）。
 */

import type {
    CharacterProfile,
    DoudizhuBid,
    DoudizhuCard,
    DoudizhuDialogueKind,
    DoudizhuDifficultyLevel,
    DoudizhuDifficultyMode,
    DoudizhuHandAnalysis,
    DoudizhuHandType,
    DoudizhuMove,
    DoudizhuMoveEvent,
    DoudizhuPlayerRole,
    DoudizhuScoreSummary,
    TheaterDoudizhuGame,
    UserProfile,
} from '../types';
import type { ResolvedApi } from './auxApi';
import { ContextBuilder } from './context';
import { callChatCompletion, stripThink } from './llmClient';
import { makeApiUsageMeta } from './apiUsageCatalog';
import { extractContent, extractJson } from './safeApi';
import {
    doudizhuDialogueSystem,
    doudizhuDialogueUser,
    doudizhuDifficultySystem,
    doudizhuOpeningDifficultyUser,
    doudizhuPerMoveDifficultyUser,
} from './theaterPrompts';

export const DOUDIZHU_DIFFICULTY_LEVELS: DoudizhuDifficultyLevel[] = ['novice', 'casual', 'steady', 'sharp', 'master'];
export const DOUDIZHU_DIFFICULTY_LABELS: Record<DoudizhuDifficultyLevel, string> = {
    novice: '新手',
    casual: '休闲',
    steady: '稳健',
    sharp: '锋利',
    master: '高手',
};
export const DOUDIZHU_DIFFICULTY_MODE_LABELS: Record<DoudizhuDifficultyMode, string> = {
    opening: '开局定档',
    per_move: '每步评估',
};

export const DOUDIZHU_ROLES: DoudizhuPlayerRole[] = ['user', 'charA', 'charB'];
const ROLE_ORDER = new Map<DoudizhuPlayerRole, number>(DOUDIZHU_ROLES.map((role, index) => [role, index]));
const SUITS = ['spade', 'heart', 'club', 'diamond'] as const;
const RANKS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;
const RANK_LABELS: Record<number, string> = {
    3: '3',
    4: '4',
    5: '5',
    6: '6',
    7: '7',
    8: '8',
    9: '9',
    10: '10',
    11: 'J',
    12: 'Q',
    13: 'K',
    14: 'A',
    15: '2',
    16: '小王',
    17: '大王',
};
const SUIT_PREFIX: Record<DoudizhuCard['suit'], string> = {
    spade: 'S',
    heart: 'H',
    club: 'C',
    diamond: 'D',
    joker: 'J',
};

const genId = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const clampText = (text: unknown, max = 96): string => String(text || '').replace(/\s+/g, ' ').trim().slice(0, max);
const nextRole = (role: DoudizhuPlayerRole): DoudizhuPlayerRole => DOUDIZHU_ROLES[((ROLE_ORDER.get(role) || 0) + 1) % DOUDIZHU_ROLES.length];
const cardSortValue = (card: DoudizhuCard) => card.rank * 10 + (card.suit === 'joker' ? 9 : SUITS.indexOf(card.suit as any));
const nowId = () => Date.now().toString(36);

export const doudizhuRoleName = (game: Pick<TheaterDoudizhuGame, 'players' | 'userName'>, role: DoudizhuPlayerRole): string => {
    if (role === 'user') return game.userName || '你';
    return game.players.find(p => p.role === role)?.name || (role === 'charA' ? '上家' : '下家');
};

export const doudizhuCampOf = (game: Pick<TheaterDoudizhuGame, 'landlord'>, role: DoudizhuPlayerRole) =>
    game.landlord === role ? 'landlord' : 'farmers';

export function createDoudizhuDeck(): DoudizhuCard[] {
    const cards: DoudizhuCard[] = [];
    for (const suit of SUITS) {
        for (const rank of RANKS) {
            cards.push({
                id: `${SUIT_PREFIX[suit]}${rank}`,
                suit,
                rank,
                label: RANK_LABELS[rank],
            });
        }
    }
    cards.push({ id: 'J16', suit: 'joker', rank: 16, label: RANK_LABELS[16] });
    cards.push({ id: 'J17', suit: 'joker', rank: 17, label: RANK_LABELS[17] });
    return cards;
}

export function sortDoudizhuCards(cards: DoudizhuCard[], desc = false): DoudizhuCard[] {
    return [...cards].sort((a, b) => desc ? cardSortValue(b) - cardSortValue(a) : cardSortValue(a) - cardSortValue(b));
}

export function shuffleDoudizhuDeck(rng: () => number = Math.random): DoudizhuCard[] {
    const deck = createDoudizhuDeck();
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

export function dealDoudizhuCards(deck = shuffleDoudizhuDeck()): Pick<TheaterDoudizhuGame, 'hands' | 'bottomCards'> {
    const hands: Record<DoudizhuPlayerRole, DoudizhuCard[]> = { user: [], charA: [], charB: [] };
    deck.slice(0, 51).forEach((card, index) => {
        hands[DOUDIZHU_ROLES[index % 3]].push(card);
    });
    return {
        hands: {
            user: sortDoudizhuCards(hands.user),
            charA: sortDoudizhuCards(hands.charA),
            charB: sortDoudizhuCards(hands.charB),
        },
        bottomCards: sortDoudizhuCards(deck.slice(51)),
    };
}

function normalizeBidScore(score: number): 0 | 1 | 2 | 3 {
    return score === 1 || score === 2 || score === 3 ? score : 0;
}

export function sanitizeDoudizhuDifficultyLevel(value: unknown, fallback: DoudizhuDifficultyLevel = 'steady'): DoudizhuDifficultyLevel {
    const v = String(value || '').trim().toLowerCase();
    if (v === 'novice' || v === '新手') return 'novice';
    if (v === 'casual' || v === '休闲') return 'casual';
    if (v === 'steady' || v === '稳健') return 'steady';
    if (v === 'sharp' || v === '锋利') return 'sharp';
    if (v === 'master' || v === '高手') return 'master';
    return fallback;
}

export function sanitizeDoudizhuDifficultyMode(value: unknown, fallback: DoudizhuDifficultyMode = 'opening'): DoudizhuDifficultyMode {
    const v = String(value || '').trim().toLowerCase();
    if (v === 'per_move' || v === 'per-move' || v === 'dynamic' || v === '每步评估') return 'per_move';
    if (v === 'opening' || v === 'fixed' || v === '开局定档') return 'opening';
    return fallback;
}

const rankCounts = (cards: DoudizhuCard[]) => {
    const map = new Map<number, number>();
    for (const card of cards) map.set(card.rank, (map.get(card.rank) || 0) + 1);
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
};

const isConsecutive = (ranks: number[]) => {
    if (!ranks.length || ranks.some(rank => rank >= 15)) return false;
    for (let i = 1; i < ranks.length; i++) {
        if (ranks[i] !== ranks[i - 1] + 1) return false;
    }
    return true;
};

const findTrioRun = (counts: Array<[number, number]>, minLen = 2): number[] | null => {
    const ranks = counts.filter(([rank, count]) => rank < 15 && count >= 3).map(([rank]) => rank);
    let best: number[] = [];
    let current: number[] = [];
    for (const rank of ranks) {
        if (!current.length || rank === current[current.length - 1] + 1) current.push(rank);
        else {
            if (current.length > best.length) best = current;
            current = [rank];
        }
    }
    if (current.length > best.length) best = current;
    return best.length >= minLen ? best : null;
};

export function analyzeDoudizhuCards(cards: DoudizhuCard[]): DoudizhuHandAnalysis | null {
    const clean = sortDoudizhuCards(cards);
    const n = clean.length;
    if (!n) return null;
    const counts = rankCounts(clean);
    const ranks = counts.map(([rank]) => rank);
    const countValues = counts.map(([, count]) => count).sort((a, b) => b - a);
    const maxRank = Math.max(...ranks);

    if (n === 2 && ranks.includes(16) && ranks.includes(17)) {
        return { type: 'rocket', rank: 17, length: 1, count: n };
    }
    if (n === 4 && counts.length === 1) {
        return { type: 'bomb', rank: ranks[0], length: 1, count: n };
    }
    if (n === 1) return { type: 'single', rank: ranks[0], length: 1, count: n };
    if (n === 2 && counts.length === 1 && ranks[0] < 16) return { type: 'pair', rank: ranks[0], length: 1, count: n };
    if (n === 3 && counts.length === 1) return { type: 'trio', rank: ranks[0], length: 1, count: n };
    if (n === 4 && countValues[0] === 3) {
        const main = counts.find(([, count]) => count === 3)?.[0] || maxRank;
        return { type: 'trio_single', rank: main, length: 1, count: n };
    }
    if (n === 5 && countValues[0] === 3 && countValues[1] === 2) {
        const main = counts.find(([, count]) => count === 3)?.[0] || maxRank;
        return { type: 'trio_pair', rank: main, length: 1, count: n };
    }
    if (n >= 5 && counts.every(([, count]) => count === 1) && isConsecutive(ranks)) {
        return { type: 'straight', rank: maxRank, length: n, count: n };
    }
    if (n >= 6 && n % 2 === 0 && counts.every(([, count]) => count === 2) && isConsecutive(ranks)) {
        return { type: 'pair_straight', rank: maxRank, length: n / 2, count: n };
    }

    const trioRun = findTrioRun(counts);
    if (trioRun) {
        const trioLen = trioRun.length;
        const trioCards = trioLen * 3;
        const tailCounts = counts
            .filter(([rank]) => !trioRun.includes(rank))
            .map(([, count]) => count);
        if (n === trioCards && counts.every(([rank, count]) => trioRun.includes(rank) ? count === 3 : count === 0)) {
            return { type: 'plane', rank: trioRun[trioRun.length - 1], length: trioLen, count: n };
        }
        if (n === trioCards + trioLen && tailCounts.reduce((sum, count) => sum + count, 0) === trioLen) {
            return { type: 'plane_singles', rank: trioRun[trioRun.length - 1], length: trioLen, count: n };
        }
        if (n === trioCards + trioLen * 2 && tailCounts.length === trioLen && tailCounts.every(count => count === 2)) {
            return { type: 'plane_pairs', rank: trioRun[trioRun.length - 1], length: trioLen, count: n };
        }
    }

    if (n === 6 && countValues[0] === 4) {
        const main = counts.find(([, count]) => count === 4)?.[0] || maxRank;
        return { type: 'four_two_singles', rank: main, length: 1, count: n };
    }
    if (n === 8 && countValues[0] === 4) {
        const main = counts.find(([, count]) => count === 4)?.[0] || maxRank;
        const tails = counts.filter(([rank]) => rank !== main).map(([, count]) => count);
        if (tails.length === 2 && tails.every(count => count === 2)) {
            return { type: 'four_two_pairs', rank: main, length: 1, count: n };
        }
    }
    return null;
}

export function canDoudizhuBeat(candidate: DoudizhuHandAnalysis | null, target?: DoudizhuHandAnalysis | null): boolean {
    if (!candidate) return false;
    if (!target) return true;
    if (candidate.type === 'rocket') return target.type !== 'rocket';
    if (target.type === 'rocket') return false;
    if (candidate.type === 'bomb' && target.type !== 'bomb') return true;
    if (target.type === 'bomb' && candidate.type !== 'bomb') return false;
    return candidate.type === target.type && candidate.length === target.length && candidate.count === target.count && candidate.rank > target.rank;
}

function hasCards(hand: DoudizhuCard[], ids: string[]) {
    const available = new Map<string, number>();
    for (const card of hand) available.set(card.id, (available.get(card.id) || 0) + 1);
    for (const id of ids) {
        const left = available.get(id) || 0;
        if (left <= 0) return false;
        available.set(id, left - 1);
    }
    return true;
}

const removeCards = (hand: DoudizhuCard[], ids: string[]) => {
    const remove = new Set(ids);
    return hand.filter(card => !remove.has(card.id));
};

const cardsByRank = (hand: DoudizhuCard[]) => {
    const map = new Map<number, DoudizhuCard[]>();
    for (const card of sortDoudizhuCards(hand)) {
        const list = map.get(card.rank) || [];
        list.push(card);
        map.set(card.rank, list);
    }
    return map;
};

const pushUniqueMove = (moves: DoudizhuCard[][], seen: Set<string>, cards: DoudizhuCard[]) => {
    const key = cards.map(card => card.id).sort().join('|');
    if (!key || seen.has(key)) return;
    seen.add(key);
    moves.push(sortDoudizhuCards(cards));
};

function consecutiveRuns(ranks: number[], minLen: number): number[][] {
    const out: number[][] = [];
    let current: number[] = [];
    for (const rank of ranks.filter(rank => rank < 15).sort((a, b) => a - b)) {
        if (!current.length || rank === current[current.length - 1] + 1) current.push(rank);
        else {
            for (let len = minLen; len <= current.length; len++) {
                for (let start = 0; start + len <= current.length; start++) out.push(current.slice(start, start + len));
            }
            current = [rank];
        }
    }
    for (let len = minLen; len <= current.length; len++) {
        for (let start = 0; start + len <= current.length; start++) out.push(current.slice(start, start + len));
    }
    return out;
}

export function listDoudizhuLegalPlays(hand: DoudizhuCard[], target?: DoudizhuHandAnalysis | null): DoudizhuCard[][] {
    const byRank = cardsByRank(hand);
    const moves: DoudizhuCard[][] = [];
    const seen = new Set<string>();
    const groups = [...byRank.entries()].sort((a, b) => a[0] - b[0]);
    const addIfBeats = (cards: DoudizhuCard[]) => {
        const analysis = analyzeDoudizhuCards(cards);
        if (canDoudizhuBeat(analysis, target)) pushUniqueMove(moves, seen, cards);
    };

    for (const [, cards] of groups) {
        addIfBeats(cards.slice(0, 1));
        if (cards.length >= 2 && cards[0].rank < 16) addIfBeats(cards.slice(0, 2));
        if (cards.length >= 3) addIfBeats(cards.slice(0, 3));
        if (cards.length === 4) addIfBeats(cards.slice(0, 4));
    }
    const jokers = [byRank.get(16)?.[0], byRank.get(17)?.[0]].filter(Boolean) as DoudizhuCard[];
    if (jokers.length === 2) addIfBeats(jokers);

    const singles = groups.map(([, cards]) => cards[0]).filter(Boolean);
    const pairs = groups.filter(([rank, cards]) => rank < 16 && cards.length >= 2).map(([, cards]) => cards.slice(0, 2));
    const trios = groups.filter(([, cards]) => cards.length >= 3).map(([rank, cards]) => ({ rank, cards: cards.slice(0, 3) }));

    for (const trio of trios) {
        for (const single of singles.filter(card => card.rank !== trio.rank)) addIfBeats([...trio.cards, single]);
        for (const pair of pairs.filter(cards => cards[0].rank !== trio.rank)) addIfBeats([...trio.cards, ...pair]);
    }

    const singleRanks = groups.filter(([, cards]) => cards.length >= 1).map(([rank]) => rank);
    for (const run of consecutiveRuns(singleRanks, 5)) {
        addIfBeats(run.map(rank => byRank.get(rank)![0]));
    }
    const pairRanks = groups.filter(([rank, cards]) => rank < 15 && cards.length >= 2).map(([rank]) => rank);
    for (const run of consecutiveRuns(pairRanks, 3)) {
        addIfBeats(run.flatMap(rank => byRank.get(rank)!.slice(0, 2)));
    }
    const trioRanks = groups.filter(([rank, cards]) => rank < 15 && cards.length >= 3).map(([rank]) => rank);
    for (const run of consecutiveRuns(trioRanks, 2)) {
        const body = run.flatMap(rank => byRank.get(rank)!.slice(0, 3));
        addIfBeats(body);
        const attachSingles = singles.filter(card => !run.includes(card.rank)).slice(0, run.length);
        if (attachSingles.length === run.length) addIfBeats([...body, ...attachSingles]);
        const attachPairs = pairs.filter(cards => !run.includes(cards[0].rank)).slice(0, run.length);
        if (attachPairs.length === run.length) addIfBeats([...body, ...attachPairs.flat()]);
    }

    for (const [rank, cards] of groups.filter(([, cards]) => cards.length === 4)) {
        const restSingles = singles.filter(card => card.rank !== rank).slice(0, 2);
        if (restSingles.length === 2) addIfBeats([...cards, ...restSingles]);
        const restPairs = pairs.filter(pair => pair[0].rank !== rank).slice(0, 2);
        if (restPairs.length === 2) addIfBeats([...cards, ...restPairs.flat()]);
    }

    return moves.sort((a, b) => {
        const aa = analyzeDoudizhuCards(a)!;
        const bb = analyzeDoudizhuCards(b)!;
        const bombA = aa.type === 'rocket' ? 2 : aa.type === 'bomb' ? 1 : 0;
        const bombB = bb.type === 'rocket' ? 2 : bb.type === 'bomb' ? 1 : 0;
        if (bombA !== bombB) return bombA - bombB;
        if (a.length !== b.length) return a.length - b.length;
        return aa.rank - bb.rank;
    });
}

const chooseByDifficulty = <T,>(items: T[], difficulty: DoudizhuDifficultyLevel, rng: () => number): T => {
    if (difficulty === 'master') return items[0];
    if (difficulty === 'sharp') return rng() < 0.88 ? items[0] : items[Math.min(1, items.length - 1)];
    if (difficulty === 'steady') return items[Math.min(Math.floor(rng() * Math.min(3, items.length)), items.length - 1)];
    if (difficulty === 'casual') return items[Math.min(Math.floor(rng() * Math.min(5, items.length)), items.length - 1)];
    return items[Math.floor(rng() * items.length)];
};

export function chooseDoudizhuBid(game: TheaterDoudizhuGame, role: DoudizhuPlayerRole, difficulty: DoudizhuDifficultyLevel = 'steady'): 0 | 1 | 2 | 3 {
    const hand = game.hands[role] || [];
    const counts = rankCounts(hand);
    const bombs = counts.filter(([, count]) => count === 4).length + (hand.some(c => c.rank === 16) && hand.some(c => c.rank === 17) ? 1 : 0);
    const high = hand.filter(c => c.rank >= 14).length;
    const twos = hand.filter(c => c.rank === 15).length;
    const score = high + twos * 1.2 + bombs * 4 + hand.filter(c => c.rank >= 16).length * 1.8;
    const currentMax = Math.max(0, ...game.bidHistory.map(b => b.score));
    let target: 0 | 1 | 2 | 3 = score >= 12 ? 3 : score >= 9 ? 2 : score >= 6 ? 1 : 0;
    if (difficulty === 'novice' && target > 0 && Math.random() < 0.35) target = (target - 1) as 0 | 1 | 2;
    if (difficulty === 'master' && bombs && target < 2) target = 2;
    if (target <= currentMax) return 0;
    return normalizeBidScore(target);
}

export function chooseDoudizhuMove(game: TheaterDoudizhuGame, role: DoudizhuPlayerRole, difficulty: DoudizhuDifficultyLevel = 'steady', rng: () => number = Math.random): { cards: DoudizhuCard[]; pass?: boolean } {
    const hand = game.hands[role] || [];
    const target = game.lastPlay?.by && game.lastPlay.by !== role ? game.lastPlay.analysis : null;
    const legal = listDoudizhuLegalPlays(hand, target);
    if (!legal.length) return { cards: [], pass: true };
    if (target && difficulty !== 'master' && difficulty !== 'sharp') {
        const nonBomb = legal.filter(cards => {
            const type = analyzeDoudizhuCards(cards)?.type;
            return type !== 'bomb' && type !== 'rocket';
        });
        if (nonBomb.length) {
            if (difficulty === 'novice' && rng() < 0.45) return { cards: [], pass: true };
            if (difficulty === 'casual' && rng() < 0.18) return { cards: [], pass: true };
            return { cards: chooseByDifficulty(nonBomb, difficulty, rng) };
        }
        if ((difficulty === 'novice' || difficulty === 'casual') && rng() < 0.7) return { cards: [], pass: true };
    }
    if (!target) {
        const leadMoves = legal
            .filter(cards => {
                const type = analyzeDoudizhuCards(cards)?.type;
                return type !== 'bomb' && type !== 'rocket';
            })
            .sort((a, b) => {
                const aa = analyzeDoudizhuCards(a)!;
                const bb = analyzeDoudizhuCards(b)!;
                const shedA = difficulty === 'master' || difficulty === 'sharp' ? -a.length : a.length;
                const shedB = difficulty === 'master' || difficulty === 'sharp' ? -b.length : b.length;
                if (shedA !== shedB) return shedA - shedB;
                return aa.rank - bb.rank;
            });
        return { cards: chooseByDifficulty(leadMoves.length ? leadMoves : legal, difficulty, rng) };
    }
    return { cards: chooseByDifficulty(legal, difficulty, rng) };
}

export function createDoudizhuGame(
    userName: string,
    charA: CharacterProfile,
    charB: CharacterProfile,
    opts: {
        difficultyMode?: DoudizhuDifficultyMode;
        difficultyLevels?: Partial<Record<DoudizhuPlayerRole, DoudizhuDifficultyLevel>>;
        invitationId?: string;
        rng?: () => number;
        bidStarter?: DoudizhuPlayerRole;
        now?: number;
    } = {},
): TheaterDoudizhuGame {
    const now = opts.now || Date.now();
    const dealt = dealDoudizhuCards(shuffleDoudizhuDeck(opts.rng));
    return {
        id: `ddz_${nowId()}_${Math.random().toString(36).slice(2, 8)}`,
        title: `斗地主 · ${charA.name} / ${charB.name}`,
        userName: userName || '你',
        charIds: [charA.id, charB.id],
        players: [
            { role: 'user', name: userName || '你' },
            { role: 'charA', charId: charA.id, name: charA.name },
            { role: 'charB', charId: charB.id, name: charB.name },
        ],
        status: 'bidding',
        difficultyMode: opts.difficultyMode || 'opening',
        difficultyLevels: {
            charA: sanitizeDoudizhuDifficultyLevel(opts.difficultyLevels?.charA, 'steady'),
            charB: sanitizeDoudizhuDifficultyLevel(opts.difficultyLevels?.charB, 'steady'),
        },
        currentTurn: opts.bidStarter || 'user',
        bidStarter: opts.bidStarter || 'user',
        bidHistory: [],
        baseScore: 1,
        multiplier: 1,
        bottomCards: dealt.bottomCards,
        hands: dealt.hands,
        moves: [],
        dialogue: [],
        passCount: 0,
        createdAt: now,
        lastActiveAt: now,
        invitationId: opts.invitationId,
        redealCount: 0,
    };
}

function redealDoudizhuGame(game: TheaterDoudizhuGame, now = Date.now()): TheaterDoudizhuGame {
    const dealt = dealDoudizhuCards(shuffleDoudizhuDeck());
    return {
        ...game,
        status: 'bidding',
        currentTurn: game.bidStarter || 'user',
        bidHistory: [],
        baseScore: 1,
        multiplier: 1,
        landlord: undefined,
        bottomCards: dealt.bottomCards,
        hands: dealt.hands,
        moves: [],
        lastPlay: undefined,
        passCount: 0,
        winner: undefined,
        winningRole: undefined,
        score: undefined,
        lastActiveAt: now,
        redealCount: (game.redealCount || 0) + 1,
    };
}

export function normalizeDoudizhuGame(game: TheaterDoudizhuGame): TheaterDoudizhuGame {
    return {
        ...game,
        status: game.status || 'bidding',
        difficultyMode: sanitizeDoudizhuDifficultyMode(game.difficultyMode, 'opening'),
        difficultyLevels: {
            charA: sanitizeDoudizhuDifficultyLevel(game.difficultyLevels?.charA, 'steady'),
            charB: sanitizeDoudizhuDifficultyLevel(game.difficultyLevels?.charB, 'steady'),
        },
        charIds: game.charIds || game.players?.map(p => p.charId).filter(Boolean) as string[] || [],
        currentTurn: game.currentTurn || 'user',
        bidStarter: game.bidStarter || 'user',
        bidHistory: game.bidHistory || [],
        bottomCards: sortDoudizhuCards(game.bottomCards || []),
        hands: {
            user: sortDoudizhuCards(game.hands?.user || []),
            charA: sortDoudizhuCards(game.hands?.charA || []),
            charB: sortDoudizhuCards(game.hands?.charB || []),
        },
        moves: game.moves || [],
        dialogue: game.dialogue || [],
        multiplier: Math.max(1, game.multiplier || 1),
        baseScore: Math.max(1, game.baseScore || 1),
        passCount: game.passCount || 0,
    };
}

export function applyDoudizhuBid(input: TheaterDoudizhuGame, by: DoudizhuPlayerRole, score: 0 | 1 | 2 | 3, now = Date.now()): { ok: true; game: TheaterDoudizhuGame; events: DoudizhuMoveEvent[]; bid: DoudizhuBid } | { ok: false; game: TheaterDoudizhuGame; reason: string; events: DoudizhuMoveEvent[] } {
    const game = normalizeDoudizhuGame(input);
    if (game.status !== 'bidding') return { ok: false, game, reason: '现在不是叫分阶段。', events: ['illegal'] };
    if (game.currentTurn !== by) return { ok: false, game, reason: '还没轮到这位叫分。', events: ['illegal'] };
    const bid: DoudizhuBid = { by, score: normalizeBidScore(score), at: now };
    const bidHistory = [...game.bidHistory, bid];
    const maxBid = Math.max(0, ...bidHistory.map(b => b.score));
    const maxBidder = [...bidHistory].reverse().find(b => b.score === maxBid && b.score > 0)?.by;
    const shouldFinish = bid.score === 3 || bidHistory.length >= 3;
    if (!shouldFinish) {
        return {
            ok: true,
            bid,
            events: ['bid'],
            game: { ...game, bidHistory, currentTurn: nextRole(by), lastActiveAt: now },
        };
    }
    if (!maxBidder) {
        return {
            ok: true,
            bid,
            events: ['bid', 'deal'],
            game: redealDoudizhuGame({ ...game, bidHistory }, now),
        };
    }
    const hands = {
        ...game.hands,
        [maxBidder]: sortDoudizhuCards([...(game.hands[maxBidder] || []), ...game.bottomCards]),
    };
    return {
        ok: true,
        bid,
        events: ['bid', 'landlord'],
        game: {
            ...game,
            status: 'playing',
            bidHistory,
            landlord: maxBidder,
            baseScore: maxBid,
            multiplier: 1,
            hands,
            currentTurn: maxBidder,
            lastActiveAt: now,
        },
    };
}

function dangerEvents(game: TheaterDoudizhuGame): DoudizhuMoveEvent[] {
    return DOUDIZHU_ROLES.some(role => (game.hands[role]?.length || 0) > 0 && (game.hands[role]?.length || 0) <= 2) ? ['danger'] : [];
}

function scoreDoudizhuGame(game: TheaterDoudizhuGame, winningRole: DoudizhuPlayerRole): DoudizhuScoreSummary {
    const landlord = game.landlord || winningRole;
    const landlordWins = winningRole === landlord;
    const landlordPlayCount = game.moves.filter(m => m.by === landlord && !m.pass && m.cards.length > 0).length;
    const farmerPlayCount = game.moves.filter(m => m.by !== landlord && !m.pass && m.cards.length > 0).length;
    const spring = landlordWins && farmerPlayCount === 0;
    const antiSpring = !landlordWins && landlordPlayCount <= 1;
    const finalMultiplier = Math.max(1, game.multiplier || 1) * (spring || antiSpring ? 2 : 1);
    const unit = Math.max(1, game.baseScore || 1) * finalMultiplier;
    const deltas: Record<DoudizhuPlayerRole, number> = { user: 0, charA: 0, charB: 0 };
    for (const role of DOUDIZHU_ROLES) {
        const isLandlord = role === landlord;
        if (landlordWins) deltas[role] = isLandlord ? unit * 2 : -unit;
        else deltas[role] = isLandlord ? -unit * 2 : unit;
    }
    return {
        baseScore: Math.max(1, game.baseScore || 1),
        multiplier: finalMultiplier,
        spring,
        antiSpring,
        winner: landlordWins ? 'landlord' : 'farmers',
        winningRole,
        deltas,
    };
}

export function applyDoudizhuPlay(input: TheaterDoudizhuGame, by: DoudizhuPlayerRole, cardIds: string[], now = Date.now()): { ok: true; game: TheaterDoudizhuGame; move: DoudizhuMove; events: DoudizhuMoveEvent[] } | { ok: false; game: TheaterDoudizhuGame; reason: string; events: DoudizhuMoveEvent[] } {
    const game = normalizeDoudizhuGame(input);
    if (game.status !== 'playing') return { ok: false, game, reason: '牌局还没开始出牌。', events: ['illegal'] };
    if (game.currentTurn !== by) return { ok: false, game, reason: '还没轮到你出牌。', events: ['illegal'] };
    const ids = Array.from(new Set(cardIds));
    if (!ids.length) {
        if (!game.lastPlay || game.lastPlay.by === by) {
            return { ok: false, game, reason: '这一轮你需要先出牌。', events: ['illegal'] };
        }
        const move: DoudizhuMove = { no: game.moves.length + 1, by, at: now, cards: [], pass: true, eventTags: ['pass', 'cannot'] };
        const moves = [...game.moves, move];
        if ((game.passCount || 0) + 1 >= 2) {
            return {
                ok: true,
                move,
                events: ['pass', 'cannot'],
                game: { ...game, moves, currentTurn: game.lastPlay.by, lastPlay: undefined, passCount: 0, lastActiveAt: now },
            };
        }
        return {
            ok: true,
            move,
            events: ['pass', 'cannot'],
            game: { ...game, moves, currentTurn: nextRole(by), passCount: (game.passCount || 0) + 1, lastActiveAt: now },
        };
    }
    const hand = game.hands[by] || [];
    if (!hasCards(hand, ids)) return { ok: false, game, reason: '这些牌不在你的手牌里。', events: ['illegal'] };
    const cards = sortDoudizhuCards(ids.map(id => hand.find(card => card.id === id)!).filter(Boolean));
    const analysis = analyzeDoudizhuCards(cards);
    if (!analysis) return { ok: false, game, reason: '这组牌型不合法。', events: ['illegal'] };
    const target = game.lastPlay?.by && game.lastPlay.by !== by ? game.lastPlay.analysis : null;
    if (!canDoudizhuBeat(analysis, target)) return { ok: false, game, reason: '这手牌压不过上一手。', events: ['illegal'] };

    const events: DoudizhuMoveEvent[] = [];
    if (!target) events.push('lead');
    else events.push('follow', 'press', 'block');
    if (analysis.type === 'bomb') events.push('bomb');
    if (analysis.type === 'rocket') events.push('rocket');
    const nextMultiplier = (analysis.type === 'bomb' || analysis.type === 'rocket') ? Math.max(1, game.multiplier || 1) * 2 : Math.max(1, game.multiplier || 1);
    const nextHands = { ...game.hands, [by]: removeCards(hand, ids) };
    const move: DoudizhuMove = { no: game.moves.length + 1, by, at: now, cards, analysis, eventTags: events };
    let next: TheaterDoudizhuGame = {
        ...game,
        hands: nextHands,
        moves: [...game.moves, move],
        currentTurn: nextRole(by),
        lastPlay: move,
        passCount: 0,
        multiplier: nextMultiplier,
        lastActiveAt: now,
    };
    if (nextHands[by].length === 0) {
        const score = scoreDoudizhuGame(next, by);
        const endEvents: DoudizhuMoveEvent[] = ['win'];
        if (score.spring) endEvents.push('spring');
        if (score.antiSpring) endEvents.push('anti_spring');
        next = {
            ...next,
            status: 'ended',
            winner: score.winner,
            winningRole: by,
            score,
            endedAt: now,
            currentTurn: by,
            moves: [...game.moves, { ...move, eventTags: [...events, ...endEvents] }],
        };
        return { ok: true, game: next, move: next.moves[next.moves.length - 1], events: [...events, ...endEvents] };
    }
    return { ok: true, game: next, move, events: [...events, ...dangerEvents(next)] };
}

export function resignDoudizhuGame(input: TheaterDoudizhuGame, by: DoudizhuPlayerRole, now = Date.now()): TheaterDoudizhuGame {
    const game = normalizeDoudizhuGame(input);
    const landlord = game.landlord || 'user';
    const winningRole = by === landlord ? DOUDIZHU_ROLES.find(role => role !== landlord)! : landlord;
    const score = scoreDoudizhuGame({ ...game, landlord }, winningRole);
    return {
        ...game,
        landlord,
        status: 'ended',
        winner: score.winner,
        winningRole,
        score,
        endedAt: now,
        lastActiveAt: now,
    };
}

export function addDoudizhuDialogue(game: TheaterDoudizhuGame, kind: DoudizhuDialogueKind, text: string, by: DoudizhuPlayerRole | 'system' = 'system', moveNo?: number, now = Date.now()): TheaterDoudizhuGame {
    const clean = clampText(text, 120);
    if (!clean) return game;
    return {
        ...game,
        dialogue: [...(game.dialogue || []), { id: genId('ddzd'), by, kind, text: clean, at: now, moveNo }].slice(-120),
        lastActiveAt: now,
    };
}

export function parseDoudizhuDifficultyResult(raw: unknown, fallbackLevel: DoudizhuDifficultyLevel = 'steady', fallbackMode?: DoudizhuDifficultyMode): {
    difficultyLevel: DoudizhuDifficultyLevel;
    difficultyMode?: DoudizhuDifficultyMode;
    reason?: string;
} {
    const parsed = typeof raw === 'string' ? extractJson(raw) : raw;
    const obj = parsed && typeof parsed === 'object' ? parsed as any : {};
    return {
        difficultyLevel: sanitizeDoudizhuDifficultyLevel(obj.difficultyLevel ?? obj.level ?? obj.difficulty, fallbackLevel),
        difficultyMode: obj.difficultyMode || obj.mode ? sanitizeDoudizhuDifficultyMode(obj.difficultyMode ?? obj.mode, fallbackMode || 'opening') : fallbackMode,
        reason: clampText(obj.reason, 80) || undefined,
    };
}

export function heuristicCharacterDoudizhuDifficulty(char: CharacterProfile): DoudizhuDifficultyLevel {
    const text = [
        char.name,
        (char as any).description,
        (char as any).personality,
        (char as any).scenario,
        (char as any).systemPrompt,
    ].filter(Boolean).join('\n').toLowerCase();
    if (/赌|牌|扑克|斗地主|博弈|策略|算牌|老练|精明|高手|天才|侦探|军师/.test(text)) return 'sharp';
    if (/聪明|理性|冷静|谨慎|棋|推理|数学|计划/.test(text)) return 'steady';
    if (/笨|迷糊|冒失|随性|幼稚|第一次|新手/.test(text)) return 'casual';
    return 'steady';
}

function handTypeText(analysis?: DoudizhuHandAnalysis | null) {
    if (!analysis) return '不出';
    const labels: Record<DoudizhuHandType, string> = {
        single: '单张',
        pair: '对子',
        trio: '三张',
        trio_single: '三带一',
        trio_pair: '三带一对',
        straight: '顺子',
        pair_straight: '连对',
        plane: '飞机',
        plane_singles: '飞机带单',
        plane_pairs: '飞机带对',
        four_two_singles: '四带二',
        four_two_pairs: '四带两对',
        bomb: '炸弹',
        rocket: '王炸',
    };
    return `${labels[analysis.type] || analysis.type}(${RANK_LABELS[analysis.rank] || analysis.rank})`;
}

function eventText(events: DoudizhuMoveEvent[]): string {
    const labels: Record<string, string> = {
        deal: '重新发牌',
        bid: '叫分',
        landlord: '地主确认',
        thinking: '角色思考',
        normal: '普通出牌',
        lead: '首攻',
        follow: '跟牌',
        press: '压过上一手',
        pressed: '被压',
        block: '拦牌',
        pass: '不要',
        cannot: '要不起',
        bomb: '炸弹',
        rocket: '王炸',
        danger: '有人只剩一两张',
        win: '胜利',
        lose: '落败',
        spring: '春天',
        anti_spring: '反春天',
        illegal: '非法出牌提示',
    };
    return events.map(e => labels[e] || e).join('、');
}

export function doudizhuGameSummary(game: TheaterDoudizhuGame, limit = 12): string {
    const g = normalizeDoudizhuGame(game);
    const landlord = g.landlord ? `${doudizhuRoleName(g, g.landlord)} 是地主` : '尚未确定地主';
    const hands = DOUDIZHU_ROLES.map(role => `${doudizhuRoleName(g, role)} ${g.landlord === role ? '地主' : '农民'} 剩 ${g.hands[role]?.length || 0} 张`).join('；');
    const bids = g.bidHistory.length
        ? g.bidHistory.map(b => `${doudizhuRoleName(g, b.by)} ${b.score ? `叫 ${b.score}` : '不叫'}`).join('，')
        : '尚未叫分';
    const last = g.moves.slice(-limit).map(m => {
        const cards = m.pass ? '不要' : `${handTypeText(m.analysis)}：${m.cards.map(c => c.label).join(' ')}`;
        return `${m.no}. ${doudizhuRoleName(g, m.by)} ${cards}`;
    }).join('\n');
    return [
        `状态：${g.status}；${landlord}；倍数 ${g.multiplier || 1}`,
        `叫分：${bids}`,
        `手牌：${hands}`,
        `最近出牌：\n${last || '暂无'}`,
    ].join('\n');
}

export function fallbackDoudizhuDialogue(kind: DoudizhuDialogueKind, charName: string, events: DoudizhuMoveEvent[] = []): string {
    if (kind === 'illegal') return '这手牌不成型，换一组试试。';
    if (events.includes('rocket') || kind === 'rocket') return '王炸。先把桌面安静一下。';
    if (events.includes('bomb') || kind === 'bomb') return '炸一下，这口气我不想让。';
    if (events.includes('spring') || kind === 'spring') return '春天？这局有点太顺了。';
    if (events.includes('anti_spring') || kind === 'anti_spring') return '反春天，地主这次被按住了。';
    if (events.includes('win') || kind === 'win') return '收牌。这一局我先拿下了。';
    if (events.includes('lose') || kind === 'lose') return '行，你这手收得漂亮。再来我会盯紧点。';
    if (events.includes('danger') || kind === 'danger') return '有人牌快见底了，不能再放松。';
    if (events.includes('pass') || events.includes('cannot') || kind === 'pass' || kind === 'cannot') return '要不起，你先走。';
    if (events.includes('press') || kind === 'press') return '我压一手，看你接不接。';
    if (events.includes('block') || kind === 'block') return '这轮我先拦住，别让你顺着跑。';
    if (kind === 'thinking') return `${charName}把手牌拢了拢，像是在重新数牌。`;
    if (kind === 'bid') return '这牌能打，我叫。';
    if (kind === 'landlord') return '地主定了，底牌翻开吧。';
    if (kind === 'invite') return '来一局斗地主？三个人刚好成桌。';
    return '我出这些。';
}

async function callDoudizhuJson(
    api: ResolvedApi,
    char: CharacterProfile,
    userName: string,
    system: string,
    user: string,
    maxTokens = 360,
): Promise<any | null> {
    if (!api.baseUrl || !api.model) throw new Error('请先在「文具盒」里配置 API');
    const data = await callChatCompletion(api, {
        model: api.model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        temperature: 0.72,
        max_tokens: maxTokens,
        stream: false,
    }, {
        meta: makeApiUsageMeta('theater.doudizhu', {
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

async function doudizhuSystem(char: CharacterProfile, userProfile: UserProfile): Promise<{ system: string; userName: string }> {
    const userName = (userProfile.name || '').trim() || '你';
    const core = await ContextBuilder.buildFullCoreContext(char, userProfile, true);
    return {
        userName,
        system: doudizhuDifficultySystem({ core, charName: char.name, userName }),
    };
}

export async function decideDoudizhuOpeningDifficulty(
    char: CharacterProfile,
    userProfile: UserProfile,
    api: ResolvedApi | null | undefined,
    mode: DoudizhuDifficultyMode,
    invite = false,
): Promise<{ difficultyLevel: DoudizhuDifficultyLevel; reason?: string; source: 'llm' | 'fallback' }> {
    const fallback = heuristicCharacterDoudizhuDifficulty(char);
    if (!api?.baseUrl || !api.model) return { difficultyLevel: fallback, source: 'fallback' };
    try {
        const { system, userName } = await doudizhuSystem(char, userProfile);
        const raw = await callDoudizhuJson(api, char, userName, system, doudizhuOpeningDifficultyUser({ mode, charName: char.name, userName, invite }));
        const parsed = parseDoudizhuDifficultyResult(raw, fallback);
        return { difficultyLevel: parsed.difficultyLevel, reason: parsed.reason, source: 'llm' };
    } catch {
        return { difficultyLevel: fallback, source: 'fallback' };
    }
}

export async function decideDoudizhuPerMoveDifficulty(
    char: CharacterProfile,
    userProfile: UserProfile,
    api: ResolvedApi | null | undefined,
    game: TheaterDoudizhuGame,
    role: DoudizhuPlayerRole,
    events: DoudizhuMoveEvent[],
): Promise<{ difficultyLevel: DoudizhuDifficultyLevel; reason?: string; source: 'llm' | 'fallback' }> {
    const fallback = sanitizeDoudizhuDifficultyLevel(game.difficultyLevels?.[role], heuristicCharacterDoudizhuDifficulty(char));
    if (!api?.baseUrl || !api.model) return { difficultyLevel: fallback, source: 'fallback' };
    try {
        const { system, userName } = await doudizhuSystem(char, userProfile);
        const raw = await callDoudizhuJson(api, char, userName, system, doudizhuPerMoveDifficultyUser({
            charName: char.name,
            userName,
            difficultyLevel: fallback,
            table: doudizhuGameSummary(game),
            event: eventText(events),
        }));
        const parsed = parseDoudizhuDifficultyResult(raw, fallback);
        return { difficultyLevel: parsed.difficultyLevel, reason: parsed.reason, source: 'llm' };
    } catch {
        return { difficultyLevel: fallback, source: 'fallback' };
    }
}

export async function generateDoudizhuDialogue(
    char: CharacterProfile,
    userProfile: UserProfile,
    api: ResolvedApi | null | undefined,
    game: TheaterDoudizhuGame,
    role: DoudizhuPlayerRole,
    events: DoudizhuMoveEvent[],
    move?: DoudizhuMove,
): Promise<string> {
    const kind = (events.find(e => e !== 'normal') || 'normal') as DoudizhuDialogueKind;
    if (!api?.baseUrl || !api.model) return fallbackDoudizhuDialogue(kind, char.name, events);
    try {
        const userName = (userProfile.name || '').trim() || game.userName || '你';
        const core = await ContextBuilder.buildFullCoreContext(char, userProfile, true);
        const system = doudizhuDialogueSystem({ core, charName: char.name, userName });
        const lastMove = move
            ? move.pass
                ? `${doudizhuRoleName(game, move.by)} 要不起`
                : `${doudizhuRoleName(game, move.by)} 出 ${handTypeText(move.analysis)}：${move.cards.map(c => c.label).join(' ')}`
            : '尚未出牌';
        const raw = await callDoudizhuJson(api, char, userName, system, doudizhuDialogueUser({
            charName: char.name,
            userName,
            event: eventText(events),
            table: doudizhuGameSummary(game),
            difficultyLevel: game.difficultyLevels?.[role] || 'steady',
            lastMove,
        }), 240);
        const text = clampText((raw as any)?.text || raw, 80);
        return text || fallbackDoudizhuDialogue(kind, char.name, events);
    } catch {
        return fallbackDoudizhuDialogue(kind, char.name, events);
    }
}

export const formatDoudizhuCards = (cards: DoudizhuCard[]) => sortDoudizhuCards(cards).map(card => card.label).join(' ');
