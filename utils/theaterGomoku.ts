/**
 * 幕间集·五子棋。
 * ==============
 * 15x15 休闲规则：无禁手，五连或长连即胜。模型负责按完整角色设定判断棋力、
 * 生成互动对白；本地引擎负责合法落子、胜负判定、低难度降级与兜底。
 *
 * 📌 prompt 文案集中在 utils/theaterPrompts.ts（[拾壹] 五子棋 区段）。
 */

import { GomokuSolution } from '@algorithm.ts/gomoku';
import type {
    CharacterProfile,
    GomokuDialogueKind,
    GomokuDifficultyLevel,
    GomokuDifficultyMode,
    GomokuMove,
    GomokuMoveEvent,
    GomokuPlayerRole,
    GomokuStone,
    TheaterGomokuGame,
    UserProfile,
} from '../types';
import type { ResolvedApi } from './auxApi';
import { ContextBuilder } from './context';
import { callChatCompletion, stripThink } from './llmClient';
import { makeApiUsageMeta } from './apiUsageCatalog';
import { extractContent, extractJson } from './safeApi';
import {
    gomokuDialogueSystem,
    gomokuDialogueUser,
    gomokuDifficultySystem,
    gomokuOpeningDifficultyUser,
    gomokuPerMoveDifficultyUser,
} from './theaterPrompts';

export const GOMOKU_BOARD_SIZE = 15;
export type GomokuCell = GomokuStone | null;
export type GomokuBoard = GomokuCell[][];

export const GOMOKU_DIFFICULTY_LEVELS: GomokuDifficultyLevel[] = ['novice', 'casual', 'steady', 'sharp', 'master'];
export const GOMOKU_DIFFICULTY_LABELS: Record<GomokuDifficultyLevel, string> = {
    novice: '新手',
    casual: '休闲',
    steady: '稳健',
    sharp: '锋利',
    master: '高手',
};
export const GOMOKU_DIFFICULTY_MODE_LABELS: Record<GomokuDifficultyMode, string> = {
    opening: '开局定档',
    per_move: '每步评估',
};

const DIRECTIONS = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
] as const;

const genId = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const clampText = (text: unknown, max = 80): string => String(text || '').replace(/\s+/g, ' ').trim().slice(0, max);
const roleOpponent = (role: GomokuPlayerRole): GomokuPlayerRole => role === 'user' ? 'char' : 'user';
const algorithmPlayerId = (stone: GomokuStone): 0 | 1 => stone === 'white' ? 0 : 1;

export const opponentStone = (stone: GomokuStone): GomokuStone => stone === 'black' ? 'white' : 'black';

export const stoneForRole = (game: Pick<TheaterGomokuGame, 'charStone'>, role: GomokuPlayerRole): GomokuStone =>
    role === 'char' ? game.charStone : opponentStone(game.charStone);

export const roleForStone = (game: Pick<TheaterGomokuGame, 'charStone'>, stone: GomokuStone): GomokuPlayerRole =>
    stone === game.charStone ? 'char' : 'user';

export function createEmptyGomokuBoard(size = GOMOKU_BOARD_SIZE): GomokuBoard {
    return Array.from({ length: size }, () => Array<GomokuCell>(size).fill(null));
}

export function isInsideGomokuBoard(row: number, col: number, size = GOMOKU_BOARD_SIZE): boolean {
    return Number.isInteger(row) && Number.isInteger(col) && row >= 0 && row < size && col >= 0 && col < size;
}

export function buildGomokuBoard(moves: Pick<GomokuMove, 'row' | 'col' | 'stone'>[], size = GOMOKU_BOARD_SIZE): GomokuBoard {
    const board = createEmptyGomokuBoard(size);
    for (const move of moves || []) {
        if (!isInsideGomokuBoard(move.row, move.col, size)) continue;
        if (board[move.row][move.col]) continue;
        board[move.row][move.col] = move.stone;
    }
    return board;
}

export function validateGomokuPoint(board: GomokuBoard, row: number, col: number): { ok: true } | { ok: false; reason: string } {
    const size = board.length || GOMOKU_BOARD_SIZE;
    if (!isInsideGomokuBoard(row, col, size)) return { ok: false, reason: '棋子要落在棋盘内。' };
    if (board[row][col]) return { ok: false, reason: '这里已经有棋子了。' };
    return { ok: true };
}

function countOneSide(board: GomokuBoard, row: number, col: number, stone: GomokuStone, dr: number, dc: number) {
    let r = row + dr;
    let c = col + dc;
    let count = 0;
    while (isInsideGomokuBoard(r, c, board.length) && board[r][c] === stone) {
        count++;
        r += dr;
        c += dc;
    }
    const open = isInsideGomokuBoard(r, c, board.length) && board[r][c] === null;
    return { count, open, endRow: r, endCol: c };
}

export function checkGomokuWinner(board: GomokuBoard, lastMove?: Pick<GomokuMove, 'row' | 'col' | 'stone'>): {
    winnerStone: GomokuStone | null;
    winLine?: Array<{ row: number; col: number }>;
    draw: boolean;
} {
    const targets = lastMove ? [lastMove] : board.flatMap((row, r) => row.map((stone, c) => stone ? { row: r, col: c, stone } : null).filter(Boolean) as Array<{ row: number; col: number; stone: GomokuStone }>);
    for (const move of targets) {
        for (const [dr, dc] of DIRECTIONS) {
            const neg = countOneSide(board, move.row, move.col, move.stone, -dr, -dc);
            const pos = countOneSide(board, move.row, move.col, move.stone, dr, dc);
            const total = neg.count + 1 + pos.count;
            if (total >= 5) {
                const line: Array<{ row: number; col: number }> = [];
                for (let i = -neg.count; i <= pos.count; i++) {
                    line.push({ row: move.row + dr * i, col: move.col + dc * i });
                }
                return { winnerStone: move.stone, winLine: line, draw: false };
            }
        }
    }
    return { winnerStone: null, draw: board.every(row => row.every(Boolean)) };
}

function boardWithMove(board: GomokuBoard, row: number, col: number, stone: GomokuStone): GomokuBoard {
    const next = board.map(r => [...r]);
    next[row][col] = stone;
    return next;
}

function occupiedPoints(board: GomokuBoard): Array<{ row: number; col: number; stone: GomokuStone }> {
    const out: Array<{ row: number; col: number; stone: GomokuStone }> = [];
    board.forEach((line, row) => line.forEach((stone, col) => {
        if (stone) out.push({ row, col, stone });
    }));
    return out;
}

function candidatePoints(board: GomokuBoard, distance = 2): Array<{ row: number; col: number }> {
    const occupied = occupiedPoints(board);
    if (!occupied.length) {
        const center = Math.floor(board.length / 2);
        return [{ row: center, col: center }];
    }
    const seen = new Set<string>();
    const out: Array<{ row: number; col: number }> = [];
    for (const p of occupied) {
        for (let dr = -distance; dr <= distance; dr++) {
            for (let dc = -distance; dc <= distance; dc++) {
                if (Math.abs(dr) + Math.abs(dc) > distance + 1) continue;
                const row = p.row + dr;
                const col = p.col + dc;
                const key = `${row},${col}`;
                if (!isInsideGomokuBoard(row, col, board.length) || board[row][col] || seen.has(key)) continue;
                seen.add(key);
                out.push({ row, col });
            }
        }
    }
    return out.length ? out : board.flatMap((line, row) => line.map((cell, col) => cell ? null : { row, col }).filter(Boolean) as Array<{ row: number; col: number }>);
}

export function findImmediateWinningMoves(board: GomokuBoard, stone: GomokuStone): Array<{ row: number; col: number }> {
    return candidatePoints(board, 2).filter(p => {
        const next = boardWithMove(board, p.row, p.col, stone);
        return checkGomokuWinner(next, { ...p, stone }).winnerStone === stone;
    });
}

function lineScoreForMove(board: GomokuBoard, row: number, col: number, stone: GomokuStone): number {
    let score = 0;
    for (const [dr, dc] of DIRECTIONS) {
        const neg = countOneSide(board, row, col, stone, -dr, -dc);
        const pos = countOneSide(board, row, col, stone, dr, dc);
        const count = neg.count + 1 + pos.count;
        const open = (neg.open ? 1 : 0) + (pos.open ? 1 : 0);
        if (count >= 5) score += 1_000_000;
        else if (count === 4 && open === 2) score += 80_000;
        else if (count === 4 && open === 1) score += 24_000;
        else if (count === 3 && open === 2) score += 8_000;
        else if (count === 3 && open === 1) score += 1_200;
        else if (count === 2 && open === 2) score += 420;
        else if (count === 2 && open === 1) score += 90;
        else if (count === 1 && open === 2) score += 18;
    }
    const center = (board.length - 1) / 2;
    score += Math.max(0, 12 - Math.abs(row - center) - Math.abs(col - center));
    return score;
}

function scoreCandidate(board: GomokuBoard, row: number, col: number, stone: GomokuStone): number {
    const ownBoard = boardWithMove(board, row, col, stone);
    const own = lineScoreForMove(ownBoard, row, col, stone);
    const opp = opponentStone(stone);
    const oppBoard = boardWithMove(board, row, col, opp);
    const defense = lineScoreForMove(oppBoard, row, col, opp) * 0.92;
    return own + defense;
}

function chooseAlgorithmGomokuMove(board: GomokuBoard, stone: GomokuStone): { row: number; col: number; score: number } | null {
    try {
        const size = board.length || GOMOKU_BOARD_SIZE;
        const solution = new GomokuSolution({
            MAX_ROW: size,
            MAX_COL: size,
            MAX_ADJACENT: 5,
            MAX_DISTANCE_OF_NEIGHBOR: 2,
        });
        for (const p of occupiedPoints(board)) {
            solution.forward(p.row, p.col, algorithmPlayerId(p.stone));
        }
        const [row, col] = solution.minimaxSearch(algorithmPlayerId(stone));
        if (!validateGomokuPoint(board, row, col).ok) return null;
        return { row, col, score: scoreCandidate(board, row, col, stone) + 1_200_000 };
    } catch {
        return null;
    }
}

const chooseByDifficulty = <T,>(items: T[], difficulty: GomokuDifficultyLevel, rng: () => number): T => {
    if (difficulty === 'master') return items[0];
    if (difficulty === 'sharp') return rng() < 0.86 ? items[0] : items[Math.min(1, items.length - 1)];
    if (difficulty === 'steady') return items[Math.min(Math.floor(rng() * Math.min(3, items.length)), items.length - 1)];
    if (difficulty === 'casual') return rng() < 0.62
        ? items[Math.min(Math.floor(rng() * Math.min(5, items.length)), items.length - 1)]
        : items[Math.min(Math.floor(rng() * Math.min(12, items.length)), items.length - 1)];
    return rng() < 0.28
        ? items[Math.min(Math.floor(rng() * Math.min(8, items.length)), items.length - 1)]
        : items[Math.floor(rng() * items.length)];
};

export function chooseGomokuMove(
    game: Pick<TheaterGomokuGame, 'moves' | 'boardSize' | 'charStone'>,
    difficulty: GomokuDifficultyLevel = 'steady',
    rng: () => number = Math.random,
): { row: number; col: number; score: number } {
    const board = buildGomokuBoard(game.moves, game.boardSize || GOMOKU_BOARD_SIZE);
    const legal = candidatePoints(board, difficulty === 'novice' ? 1 : 2);
    if (!legal.length) return { row: 0, col: 0, score: 0 };
    const scored = legal
        .map(p => ({ ...p, score: scoreCandidate(board, p.row, p.col, game.charStone) + rng() * 0.001 }))
        .sort((a, b) => b.score - a.score);
    const mustWin = findImmediateWinningMoves(board, game.charStone);
    if (mustWin.length && difficulty !== 'novice') {
        const picked = mustWin[Math.floor(rng() * mustWin.length)];
        return { ...picked, score: 1_000_000 };
    }
    const mustBlock = findImmediateWinningMoves(board, opponentStone(game.charStone));
    if (mustBlock.length && (difficulty === 'steady' || difficulty === 'sharp' || difficulty === 'master' || rng() < 0.55)) {
        const picked = mustBlock[Math.floor(rng() * mustBlock.length)];
        return { ...picked, score: 900_000 };
    }
    const algorithmMove = (difficulty === 'steady' || difficulty === 'sharp' || difficulty === 'master')
        ? chooseAlgorithmGomokuMove(board, game.charStone)
        : null;
    if (algorithmMove) {
        if (difficulty === 'master') return algorithmMove;
        if (difficulty === 'sharp' && rng() < 0.86) return algorithmMove;
        if (difficulty === 'steady' && rng() < 0.48) return algorithmMove;
    }
    return chooseByDifficulty(scored, difficulty, rng);
}

function hasPoint(points: Array<{ row: number; col: number }>, move: Pick<GomokuMove, 'row' | 'col'>): boolean {
    return points.some(p => p.row === move.row && p.col === move.col);
}

function strongestThreatTag(board: GomokuBoard, stone: GomokuStone): 'attack' | 'danger' | null {
    if (findImmediateWinningMoves(board, stone).length) return 'danger';
    const best = candidatePoints(board, 2).reduce((max, p) => Math.max(max, scoreCandidate(board, p.row, p.col, stone)), 0);
    return best >= 24_000 ? 'attack' : null;
}

export function classifyGomokuMove(
    gameBefore: Pick<TheaterGomokuGame, 'moves' | 'boardSize' | 'charStone'>,
    move: Pick<GomokuMove, 'row' | 'col' | 'stone' | 'by'>,
    outcome?: { winner?: GomokuPlayerRole | 'draw' },
): GomokuMoveEvent[] {
    const before = buildGomokuBoard(gameBefore.moves, gameBefore.boardSize || GOMOKU_BOARD_SIZE);
    const after = boardWithMove(before, move.row, move.col, move.stone);
    const tags = new Set<GomokuMoveEvent>();
    if (outcome?.winner === 'draw') tags.add('draw');
    if (outcome?.winner === 'char') tags.add('win');
    if (outcome?.winner === 'user') tags.add('lose');

    const opp = opponentStone(move.stone);
    const oppWinsBefore = findImmediateWinningMoves(before, opp);
    if (hasPoint(oppWinsBefore, move)) tags.add(move.by === 'char' ? 'block' : 'blocked');

    const selfThreat = strongestThreatTag(after, move.stone);
    if (selfThreat === 'danger') tags.add(move.by === 'char' ? 'attack' : 'danger');
    else if (selfThreat === 'attack' && move.by === 'char') tags.add('attack');

    const userStone = opponentStone(gameBefore.charStone);
    if (findImmediateWinningMoves(after, userStone).length && !tags.has('lose')) tags.add('danger');
    if (!tags.size) tags.add('normal');
    return Array.from(tags);
}

export function createGomokuGame(
    userName: string,
    char: Pick<CharacterProfile, 'id' | 'name'>,
    opts: {
        difficultyMode?: GomokuDifficultyMode;
        difficultyLevel?: GomokuDifficultyLevel;
        charStarts?: boolean;
        invitationId?: string;
        now?: number;
    } = {},
): TheaterGomokuGame {
    const now = opts.now || Date.now();
    const charStone: GomokuStone = opts.charStarts ? 'black' : 'white';
    return {
        id: genId('gomoku'),
        title: `${new Date(now).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })} 的五子棋`,
        charId: char.id,
        charName: char.name,
        userName: userName || '你',
        status: 'active',
        boardSize: GOMOKU_BOARD_SIZE,
        difficultyMode: opts.difficultyMode || 'opening',
        difficultyLevel: opts.difficultyLevel || 'steady',
        charStone,
        currentTurn: charStone === 'black' ? 'char' : 'user',
        moves: [],
        dialogue: [],
        createdAt: now,
        lastActiveAt: now,
        invitationId: opts.invitationId,
    };
}

export function normalizeGomokuGame(game: TheaterGomokuGame): TheaterGomokuGame {
    return {
        ...game,
        boardSize: game.boardSize || GOMOKU_BOARD_SIZE,
        difficultyMode: game.difficultyMode || 'opening',
        difficultyLevel: sanitizeGomokuDifficultyLevel(game.difficultyLevel, 'steady'),
        status: game.status || 'active',
        currentTurn: game.currentTurn || 'user',
        moves: game.moves || [],
        dialogue: game.dialogue || [],
        lastActiveAt: game.lastActiveAt || game.createdAt || Date.now(),
    };
}

export function applyGomokuMove(
    input: TheaterGomokuGame,
    row: number,
    col: number,
    by: GomokuPlayerRole,
    now = Date.now(),
): { ok: true; game: TheaterGomokuGame; move: GomokuMove; events: GomokuMoveEvent[] } | { ok: false; game: TheaterGomokuGame; reason: string; events: GomokuMoveEvent[] } {
    const game = normalizeGomokuGame(input);
    if (game.status === 'ended') return { ok: false, game, reason: '这局已经结束了。', events: ['illegal'] };
    if (game.currentTurn !== by) return { ok: false, game, reason: '还没轮到这一方落子。', events: ['illegal'] };
    const board = buildGomokuBoard(game.moves, game.boardSize);
    const valid = validateGomokuPoint(board, row, col);
    if (!valid.ok) return { ok: false, game, reason: valid.reason, events: ['illegal'] };

    const stone = stoneForRole(game, by);
    const baseMove: GomokuMove = { no: game.moves.length + 1, row, col, stone, by, at: now };
    const afterBoard = boardWithMove(board, row, col, stone);
    const result = checkGomokuWinner(afterBoard, baseMove);
    const winner = result.winnerStone ? roleForStone(game, result.winnerStone) : result.draw ? 'draw' : undefined;
    const events = classifyGomokuMove(game, baseMove, { winner });
    const move = { ...baseMove, eventTags: events };
    const ended = !!winner;
    return {
        ok: true,
        move,
        events,
        game: {
            ...game,
            moves: [...game.moves, move],
            status: ended ? 'ended' : 'active',
            currentTurn: ended ? game.currentTurn : roleOpponent(by),
            winner,
            winLine: result.winLine,
            endedAt: ended ? now : game.endedAt,
            lastActiveAt: now,
        },
    };
}

export function addGomokuDialogue(game: TheaterGomokuGame, kind: GomokuDialogueKind, text: string, by: 'char' | 'system' = 'char', moveNo?: number, now = Date.now()): TheaterGomokuGame {
    const clean = clampText(text, 120);
    if (!clean) return game;
    return {
        ...game,
        dialogue: [...(game.dialogue || []), { id: genId('gmd'), by, kind, text: clean, at: now, moveNo }].slice(-80),
        lastActiveAt: now,
    };
}

export function isGomokuDifficultyLevel(value: unknown): value is GomokuDifficultyLevel {
    return GOMOKU_DIFFICULTY_LEVELS.includes(String(value || '').toLowerCase() as GomokuDifficultyLevel);
}

export function sanitizeGomokuDifficultyLevel(value: unknown, fallback: GomokuDifficultyLevel = 'steady'): GomokuDifficultyLevel {
    const raw = String(value || '').trim().toLowerCase();
    const aliases: Record<string, GomokuDifficultyLevel> = {
        beginner: 'novice',
        easy: 'novice',
        normal: 'steady',
        medium: 'steady',
        hard: 'sharp',
        expert: 'master',
        新手: 'novice',
        初学: 'novice',
        休闲: 'casual',
        普通: 'casual',
        稳健: 'steady',
        中等: 'steady',
        锋利: 'sharp',
        困难: 'sharp',
        高手: 'master',
        大师: 'master',
    };
    if (isGomokuDifficultyLevel(raw)) return raw;
    return aliases[raw] || fallback;
}

export function sanitizeGomokuDifficultyMode(value: unknown, fallback: GomokuDifficultyMode = 'opening'): GomokuDifficultyMode {
    const raw = String(value || '').trim().toLowerCase();
    if (raw === 'opening' || raw === 'fixed' || raw.includes('开局')) return 'opening';
    if (raw === 'per_move' || raw === 'per-move' || raw === 'dynamic' || raw.includes('每步')) return 'per_move';
    return fallback;
}

export function parseGomokuDifficultyResult(raw: unknown, fallbackLevel: GomokuDifficultyLevel = 'steady', fallbackMode?: GomokuDifficultyMode): {
    difficultyLevel: GomokuDifficultyLevel;
    difficultyMode?: GomokuDifficultyMode;
    reason?: string;
} {
    const parsed = typeof raw === 'string' ? extractJson(raw) : raw;
    const obj = parsed && typeof parsed === 'object' ? parsed as any : {};
    return {
        difficultyLevel: sanitizeGomokuDifficultyLevel(obj.difficultyLevel ?? obj.level ?? obj.difficulty, fallbackLevel),
        difficultyMode: obj.difficultyMode || obj.mode ? sanitizeGomokuDifficultyMode(obj.difficultyMode ?? obj.mode, fallbackMode || 'opening') : fallbackMode,
        reason: clampText(obj.reason || obj.note, 80) || undefined,
    };
}

function normalizeAiCoordPair(raw: any, size: number): { row: number; col: number } | null {
    const rowRaw = Number(raw?.row ?? raw?.r ?? raw?.y);
    const colRaw = Number(raw?.col ?? raw?.column ?? raw?.c ?? raw?.x);
    if (!Number.isFinite(rowRaw) || !Number.isFinite(colRaw)) return null;
    const row = Math.trunc(rowRaw);
    const col = Math.trunc(colRaw);
    if (isInsideGomokuBoard(row, col, size)) return { row, col };
    if (row >= 1 && row <= size && col >= 1 && col <= size) return { row: row - 1, col: col - 1 };
    return null;
}

export function sanitizeGomokuMoveResult(
    raw: unknown,
    board: GomokuBoard,
    fallback: { row: number; col: number },
): { row: number; col: number; reason?: string; usedFallback: boolean } {
    const parsed = typeof raw === 'string' ? extractJson(raw) : raw;
    const obj = parsed && typeof parsed === 'object' ? parsed as any : {};
    const pair = normalizeAiCoordPair(obj, board.length);
    if (pair && validateGomokuPoint(board, pair.row, pair.col).ok) {
        return { ...pair, reason: clampText(obj.reason, 80) || undefined, usedFallback: false };
    }
    return { ...fallback, usedFallback: true };
}

export function heuristicCharacterGomokuDifficulty(char: CharacterProfile): GomokuDifficultyLevel {
    const text = [
        char.name,
        (char as any).description,
        (char as any).personality,
        (char as any).worldview,
        (char as any).systemPrompt,
        (char as any).scenario,
    ].filter(Boolean).join('\n').toLowerCase();
    if (/棋|围棋|将棋|象棋|策略|谋略|计算|推理|侦探|军师|ai|人工智能|天才|master|genius|strateg/.test(text)) return 'sharp';
    if (/笨|迷糊|随性|孩子气|新手|不会|天然|冒失/.test(text)) return 'casual';
    return 'steady';
}

export function gomokuBoardSummary(game: Pick<TheaterGomokuGame, 'moves' | 'boardSize' | 'charStone' | 'charName' | 'userName'>, limit = 14): string {
    const board = buildGomokuBoard(game.moves, game.boardSize || GOMOKU_BOARD_SIZE);
    const charStoneLabel = game.charStone === 'black' ? '黑' : '白';
    const userStoneLabel = game.charStone === 'black' ? '白' : '黑';
    const recent = (game.moves || []).slice(-limit).map(m => {
        const who = m.by === 'char' ? game.charName : game.userName;
        const color = m.stone === 'black' ? '黑' : '白';
        return `${m.no}. ${who} ${color} (${m.row + 1},${m.col + 1})`;
    }).join('\n') || '尚未落子';
    const charWins = findImmediateWinningMoves(board, game.charStone).map(p => `(${p.row + 1},${p.col + 1})`).join('、') || '无';
    const userWins = findImmediateWinningMoves(board, opponentStone(game.charStone)).map(p => `(${p.row + 1},${p.col + 1})`).join('、') || '无';
    return `棋盘：${game.boardSize || GOMOKU_BOARD_SIZE}x${game.boardSize || GOMOKU_BOARD_SIZE}
${game.charName} 执${charStoneLabel}，${game.userName} 执${userStoneLabel}
最近落子：
${recent}
${game.charName} 下一手可直接成五的位置：${charWins}
${game.userName} 下一手可直接成五的位置：${userWins}`;
}

function eventText(events: GomokuMoveEvent[]): string {
    const labels: Record<GomokuMoveEvent, string> = {
        normal: '普通落子',
        thinking: '角色思考',
        attack: '角色正在进攻',
        block: '角色拦住了用户的威胁',
        blocked: '用户拦住了角色的威胁',
        danger: '用户形成危险局面',
        win: '角色获胜',
        lose: '角色落败',
        draw: '平局',
        illegal: '非法落子提示',
    };
    return events.map(e => labels[e] || e).join('、');
}

export function fallbackGomokuDialogue(kind: GomokuDialogueKind, charName: string, events: GomokuMoveEvent[] = []): string {
    if (kind === 'illegal') return '这格已经不合适了，换一处落吧。';
    if (events.includes('win') || kind === 'win') return '五连。承让，这一手我收下了。';
    if (events.includes('lose') || kind === 'lose') return '啊，被你连起来了。再来一局我会认真一点。';
    if (events.includes('draw') || kind === 'draw') return '棋盘都满了，看来我们谁也没松手。';
    if (events.includes('block') || kind === 'block') return '这口气我先挡住，不然你就要冲起来了。';
    if (events.includes('blocked') || kind === 'blocked') return '被你看见了啊，那我换条线。';
    if (events.includes('danger') || kind === 'danger') return '等等，这边有点危险了。';
    if (events.includes('attack') || kind === 'attack') return '我往这里压一手，看看你怎么拆。';
    if (kind === 'thinking') return `${charName}盯着棋盘，指尖在边线上轻轻停了一下。`;
    if (kind === 'invite') return '要不要来一局五子棋？我想看看你会怎么下。';
    return '我下这里。';
}

async function callGomokuJson(
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
        meta: makeApiUsageMeta('theater.gomoku', {
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

async function gomokuSystem(char: CharacterProfile, userProfile: UserProfile): Promise<{ system: string; userName: string }> {
    const userName = (userProfile.name || '').trim() || '你';
    const core = await ContextBuilder.buildFullCoreContext(char, userProfile, true);
    return {
        userName,
        system: gomokuDifficultySystem({ core, charName: char.name, userName }),
    };
}

export async function decideGomokuOpeningDifficulty(
    char: CharacterProfile,
    userProfile: UserProfile,
    api: ResolvedApi | null | undefined,
    mode: GomokuDifficultyMode,
    invite = false,
): Promise<{ difficultyLevel: GomokuDifficultyLevel; reason?: string; source: 'llm' | 'fallback' }> {
    const fallback = heuristicCharacterGomokuDifficulty(char);
    if (!api?.baseUrl || !api.model) return { difficultyLevel: fallback, source: 'fallback' };
    try {
        const { system, userName } = await gomokuSystem(char, userProfile);
        const raw = await callGomokuJson(api, char, userName, system, gomokuOpeningDifficultyUser({ mode, charName: char.name, userName, invite }));
        const parsed = parseGomokuDifficultyResult(raw, fallback);
        return { difficultyLevel: parsed.difficultyLevel, reason: parsed.reason, source: 'llm' };
    } catch {
        return { difficultyLevel: fallback, source: 'fallback' };
    }
}

export async function decideGomokuPerMoveDifficulty(
    char: CharacterProfile,
    userProfile: UserProfile,
    api: ResolvedApi | null | undefined,
    game: TheaterGomokuGame,
    events: GomokuMoveEvent[],
): Promise<{ difficultyLevel: GomokuDifficultyLevel; reason?: string; source: 'llm' | 'fallback' }> {
    const fallback = sanitizeGomokuDifficultyLevel(game.difficultyLevel, heuristicCharacterGomokuDifficulty(char));
    if (!api?.baseUrl || !api.model) return { difficultyLevel: fallback, source: 'fallback' };
    try {
        const { system, userName } = await gomokuSystem(char, userProfile);
        const raw = await callGomokuJson(api, char, userName, system, gomokuPerMoveDifficultyUser({
            charName: char.name,
            userName,
            difficultyLevel: fallback,
            board: gomokuBoardSummary(game),
            event: eventText(events),
        }));
        const parsed = parseGomokuDifficultyResult(raw, fallback);
        return { difficultyLevel: parsed.difficultyLevel, reason: parsed.reason, source: 'llm' };
    } catch {
        return { difficultyLevel: fallback, source: 'fallback' };
    }
}

export async function generateGomokuDialogue(
    char: CharacterProfile,
    userProfile: UserProfile,
    api: ResolvedApi | null | undefined,
    game: TheaterGomokuGame,
    events: GomokuMoveEvent[],
    move?: GomokuMove,
): Promise<string> {
    const kind = (events.find(e => e !== 'normal') || 'normal') as GomokuDialogueKind;
    if (!api?.baseUrl || !api.model) return fallbackGomokuDialogue(kind, char.name, events);
    try {
        const userName = (userProfile.name || '').trim() || game.userName || '你';
        const core = await ContextBuilder.buildFullCoreContext(char, userProfile, true);
        const system = gomokuDialogueSystem({ core, charName: char.name, userName });
        const lastMove = move ? `${move.by === 'char' ? char.name : userName} 在 (${move.row + 1},${move.col + 1}) 落${move.stone === 'black' ? '黑' : '白'}` : '尚未落子';
        const raw = await callGomokuJson(api, char, userName, system, gomokuDialogueUser({
            charName: char.name,
            userName,
            event: eventText(events),
            board: gomokuBoardSummary(game),
            difficultyLevel: game.difficultyLevel,
            lastMove,
        }), 240);
        const text = clampText((raw as any)?.text || raw, 80);
        return text || fallbackGomokuDialogue(kind, char.name, events);
    } catch {
        return fallbackGomokuDialogue(kind, char.name, events);
    }
}
