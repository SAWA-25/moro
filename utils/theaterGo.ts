/**
 * 幕间集·围棋。
 * ============
 * 19 路休闲规则：吃子、禁自杀、简单 ko，可停着；双方连续停着后用面积法估算胜负。
 * 模型负责按完整角色设定判断棋力、生成互动对白；本地引擎负责合法落子与兜底。
 *
 * 📌 prompt 文案集中在 utils/theaterPrompts.ts（[拾贰] 围棋 区段）。
 */

import type {
    CharacterProfile,
    GoDialogueKind,
    GoDifficultyLevel,
    GoDifficultyMode,
    GoMove,
    GoMoveEvent,
    GoPlayerRole,
    GoPoint,
    GoScore,
    GoStone,
    TheaterGoGame,
    UserProfile,
} from '../types';
import type { ResolvedApi } from './auxApi';
import { ContextBuilder } from './context';
import { callChatCompletion, stripThink } from './llmClient';
import { makeApiUsageMeta } from './apiUsageCatalog';
import { extractContent, extractJson } from './safeApi';
import {
    goDialogueSystem,
    goDialogueUser,
    goDifficultySystem,
    goOpeningDifficultyUser,
    goPerMoveDifficultyUser,
} from './theaterPrompts';

export const GO_BOARD_SIZE = 19;
export const GO_KOMI = 6.5;
export type GoCell = GoStone | null;
export type GoBoard = GoCell[][];

export const GO_DIFFICULTY_LEVELS: GoDifficultyLevel[] = ['novice', 'casual', 'steady', 'sharp', 'master'];
export const GO_DIFFICULTY_LABELS: Record<GoDifficultyLevel, string> = {
    novice: '新手',
    casual: '休闲',
    steady: '稳健',
    sharp: '锋利',
    master: '高手',
};
export const GO_DIFFICULTY_MODE_LABELS: Record<GoDifficultyMode, string> = {
    opening: '开局定档',
    per_move: '每步评估',
};

const NEIGHBORS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
const genId = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const clampText = (text: unknown, max = 80): string => String(text || '').replace(/\s+/g, ' ').trim().slice(0, max);
const roleOpponent = (role: GoPlayerRole): GoPlayerRole => role === 'user' ? 'char' : 'user';

export const opponentGoStone = (stone: GoStone): GoStone => stone === 'black' ? 'white' : 'black';

export const goStoneForRole = (game: Pick<TheaterGoGame, 'charStone'>, role: GoPlayerRole): GoStone =>
    role === 'char' ? game.charStone : opponentGoStone(game.charStone);

export const goRoleForStone = (game: Pick<TheaterGoGame, 'charStone'>, stone: GoStone): GoPlayerRole =>
    stone === game.charStone ? 'char' : 'user';

export function createEmptyGoBoard(size = GO_BOARD_SIZE): GoBoard {
    return Array.from({ length: size }, () => Array<GoCell>(size).fill(null));
}

export function isInsideGoBoard(row: number, col: number, size = GO_BOARD_SIZE): boolean {
    return Number.isInteger(row) && Number.isInteger(col) && row >= 0 && row < size && col >= 0 && col < size;
}

export function cloneGoBoard(board: GoBoard): GoBoard {
    return board.map(row => [...row]);
}

export function goBoardHash(board: GoBoard): string {
    return board.map(row => row.map(cell => cell === 'black' ? 'b' : cell === 'white' ? 'w' : '.').join('')).join('/');
}

export function buildGoBoard(moves: Pick<GoMove, 'row' | 'col' | 'stone' | 'pass' | 'captured'>[], size = GO_BOARD_SIZE): GoBoard {
    const board = createEmptyGoBoard(size);
    for (const move of moves || []) {
        if (move.pass) continue;
        if (!isInsideGoBoard(Number(move.row), Number(move.col), size)) continue;
        if (!board[move.row!][move.col!]) board[move.row!][move.col!] = move.stone;
        for (const p of move.captured || []) {
            if (isInsideGoBoard(p.row, p.col, size)) board[p.row][p.col] = null;
        }
    }
    return board;
}

function pointKey(row: number, col: number): string {
    return `${row},${col}`;
}

function parsePointKey(key: string): GoPoint {
    const [row, col] = key.split(',').map(Number);
    return { row, col };
}

function getGroup(board: GoBoard, row: number, col: number): { stone: GoStone; stones: GoPoint[]; liberties: Set<string> } | null {
    const stone = board[row]?.[col];
    if (!stone) return null;
    const seen = new Set<string>();
    const liberties = new Set<string>();
    const stones: GoPoint[] = [];
    const stack: GoPoint[] = [{ row, col }];
    while (stack.length) {
        const p = stack.pop()!;
        const key = pointKey(p.row, p.col);
        if (seen.has(key)) continue;
        seen.add(key);
        stones.push(p);
        for (const [dr, dc] of NEIGHBORS) {
            const nr = p.row + dr;
            const nc = p.col + dc;
            if (!isInsideGoBoard(nr, nc, board.length)) continue;
            const cell = board[nr][nc];
            if (cell === null) liberties.add(pointKey(nr, nc));
            else if (cell === stone && !seen.has(pointKey(nr, nc))) stack.push({ row: nr, col: nc });
        }
    }
    return { stone, stones, liberties };
}

function allGroups(board: GoBoard, stone?: GoStone): Array<{ stone: GoStone; stones: GoPoint[]; liberties: Set<string> }> {
    const seen = new Set<string>();
    const groups: Array<{ stone: GoStone; stones: GoPoint[]; liberties: Set<string> }> = [];
    board.forEach((line, row) => line.forEach((cell, col) => {
        if (!cell || (stone && cell !== stone) || seen.has(pointKey(row, col))) return;
        const group = getGroup(board, row, col);
        if (!group) return;
        group.stones.forEach(p => seen.add(pointKey(p.row, p.col)));
        groups.push(group);
    }));
    return groups;
}

function occupiedGoPoints(board: GoBoard): Array<{ row: number; col: number; stone: GoStone }> {
    const out: Array<{ row: number; col: number; stone: GoStone }> = [];
    board.forEach((line, row) => line.forEach((stone, col) => {
        if (stone) out.push({ row, col, stone });
    }));
    return out;
}

function candidateGoPoints(board: GoBoard, distance = 2): GoPoint[] {
    const occupied = occupiedGoPoints(board);
    if (!occupied.length) {
        const center = Math.floor(board.length / 2);
        return [{ row: center, col: center }];
    }
    const seen = new Set<string>();
    const out: GoPoint[] = [];
    for (const p of occupied) {
        for (let dr = -distance; dr <= distance; dr++) {
            for (let dc = -distance; dc <= distance; dc++) {
                if (Math.abs(dr) + Math.abs(dc) > distance + 1) continue;
                const row = p.row + dr;
                const col = p.col + dc;
                const key = pointKey(row, col);
                if (!isInsideGoBoard(row, col, board.length) || board[row][col] || seen.has(key)) continue;
                seen.add(key);
                out.push({ row, col });
            }
        }
    }
    return out.length ? out : board.flatMap((line, row) => line.map((cell, col) => cell ? null : { row, col }).filter(Boolean) as GoPoint[]);
}

export function validateGoMove(
    board: GoBoard,
    row: number,
    col: number,
    stone: GoStone,
    previousBoardHash?: string,
): { ok: true; board: GoBoard; captured: GoPoint[]; boardHash: string } | { ok: false; reason: string } {
    const size = board.length || GO_BOARD_SIZE;
    if (!isInsideGoBoard(row, col, size)) return { ok: false, reason: '棋子要落在棋盘内。' };
    if (board[row][col]) return { ok: false, reason: '这里已经有棋子了。' };

    const next = cloneGoBoard(board);
    next[row][col] = stone;
    const captured: GoPoint[] = [];
    const opp = opponentGoStone(stone);
    const checked = new Set<string>();
    for (const [dr, dc] of NEIGHBORS) {
        const nr = row + dr;
        const nc = col + dc;
        if (!isInsideGoBoard(nr, nc, size) || next[nr][nc] !== opp) continue;
        const key = pointKey(nr, nc);
        if (checked.has(key)) continue;
        const group = getGroup(next, nr, nc);
        if (!group) continue;
        group.stones.forEach(p => checked.add(pointKey(p.row, p.col)));
        if (group.liberties.size === 0) {
            for (const p of group.stones) {
                next[p.row][p.col] = null;
                captured.push(p);
            }
        }
    }

    const own = getGroup(next, row, col);
    if (!own || own.liberties.size === 0) return { ok: false, reason: '这里没有气，不能自杀。' };
    const hash = goBoardHash(next);
    if (previousBoardHash && hash === previousBoardHash) return { ok: false, reason: '这一手会立即复现上一形，简单 ko 不允许。' };
    return { ok: true, board: next, captured, boardHash: hash };
}

function scoreGoBoard(board: GoBoard, komi = GO_KOMI): GoScore {
    const seen = new Set<string>();
    let blackStones = 0;
    let whiteStones = 0;
    let blackTerritory = 0;
    let whiteTerritory = 0;

    board.forEach(row => row.forEach(cell => {
        if (cell === 'black') blackStones++;
        if (cell === 'white') whiteStones++;
    }));

    for (let row = 0; row < board.length; row++) {
        for (let col = 0; col < board.length; col++) {
            if (board[row][col] !== null || seen.has(pointKey(row, col))) continue;
            const region: GoPoint[] = [];
            const borders = new Set<GoStone>();
            const stack: GoPoint[] = [{ row, col }];
            seen.add(pointKey(row, col));
            while (stack.length) {
                const p = stack.pop()!;
                region.push(p);
                for (const [dr, dc] of NEIGHBORS) {
                    const nr = p.row + dr;
                    const nc = p.col + dc;
                    if (!isInsideGoBoard(nr, nc, board.length)) continue;
                    const cell = board[nr][nc];
                    if (cell) borders.add(cell);
                    else if (!seen.has(pointKey(nr, nc))) {
                        seen.add(pointKey(nr, nc));
                        stack.push({ row: nr, col: nc });
                    }
                }
            }
            if (borders.size === 1) {
                if (borders.has('black')) blackTerritory += region.length;
                if (borders.has('white')) whiteTerritory += region.length;
            }
        }
    }

    return {
        blackStones,
        whiteStones,
        blackTerritory,
        whiteTerritory,
        komi,
        black: blackStones + blackTerritory,
        white: whiteStones + whiteTerritory + komi,
    };
}

function winnerFromScore(game: Pick<TheaterGoGame, 'charStone'>, score: GoScore): GoPlayerRole | 'draw' {
    if (Math.abs(score.black - score.white) < 0.001) return 'draw';
    const winnerStone: GoStone = score.black > score.white ? 'black' : 'white';
    return goRoleForStone(game, winnerStone);
}

function moveScore(board: GoBoard, row: number, col: number, stone: GoStone, previousBoardHash?: string): number | null {
    const valid = validateGoMove(board, row, col, stone, previousBoardHash);
    if (!valid.ok) return null;
    const group = getGroup(valid.board, row, col);
    const opp = opponentGoStone(stone);
    let score = 0;
    const center = (board.length - 1) / 2;
    const distCenter = Math.abs(row - center) + Math.abs(col - center);
    const edgeDist = Math.min(row, col, board.length - 1 - row, board.length - 1 - col);
    score += Math.max(0, 18 - distCenter) * 2;
    score += edgeDist >= 2 && edgeDist <= 5 ? 18 : edgeDist < 2 ? -8 : 4;
    score += valid.captured.length * 950;
    score += (group?.liberties.size || 0) * 18;

    for (const [dr, dc] of NEIGHBORS) {
        const nr = row + dr;
        const nc = col + dc;
        if (!isInsideGoBoard(nr, nc, board.length)) continue;
        const beforeNeighbor = board[nr][nc];
        const afterNeighbor = valid.board[nr][nc];
        if (beforeNeighbor === stone) score += 42;
        if (beforeNeighbor === opp) {
            const beforeGroup = getGroup(board, nr, nc);
            const afterGroup = afterNeighbor ? getGroup(valid.board, nr, nc) : null;
            if (beforeGroup && !afterGroup) score += 380;
            else if (beforeGroup && afterGroup) score += Math.max(0, beforeGroup.liberties.size - afterGroup.liberties.size) * 70;
        }
    }

    const ownAtariBefore = allGroups(board, stone).some(g => g.liberties.size === 1 && g.liberties.has(pointKey(row, col)));
    if (ownAtariBefore) score += 430;
    return score;
}

const chooseByDifficulty = <T,>(items: T[], difficulty: GoDifficultyLevel, rng: () => number): T => {
    if (difficulty === 'master') return items[0];
    if (difficulty === 'sharp') return rng() < 0.84 ? items[0] : items[Math.min(1, items.length - 1)];
    if (difficulty === 'steady') return items[Math.min(Math.floor(rng() * Math.min(4, items.length)), items.length - 1)];
    if (difficulty === 'casual') return rng() < 0.62
        ? items[Math.min(Math.floor(rng() * Math.min(8, items.length)), items.length - 1)]
        : items[Math.min(Math.floor(rng() * Math.min(20, items.length)), items.length - 1)];
    return rng() < 0.24
        ? items[Math.min(Math.floor(rng() * Math.min(12, items.length)), items.length - 1)]
        : items[Math.floor(rng() * items.length)];
};

export function chooseGoMove(
    game: Pick<TheaterGoGame, 'moves' | 'boardSize' | 'charStone' | 'previousBoardHash'>,
    difficulty: GoDifficultyLevel = 'steady',
    rng: () => number = Math.random,
): { row: number; col: number; score: number; pass?: false } | { pass: true; score: number } {
    const board = buildGoBoard(game.moves, game.boardSize || GO_BOARD_SIZE);
    const candidates = candidateGoPoints(board, difficulty === 'novice' ? 1 : 2);
    const scored = candidates
        .map(p => {
            const score = moveScore(board, p.row, p.col, game.charStone, game.previousBoardHash);
            return score === null ? null : { ...p, score: score + rng() * 0.001 };
        })
        .filter(Boolean) as Array<{ row: number; col: number; score: number }>;
    if (!scored.length) return { pass: true, score: 0 };
    scored.sort((a, b) => b.score - a.score);

    const captureNow = scored.filter(p => {
        const valid = validateGoMove(board, p.row, p.col, game.charStone, game.previousBoardHash);
        return valid.ok && valid.captured.length > 0;
    });
    if (captureNow.length && difficulty !== 'novice' && (difficulty !== 'casual' || rng() < 0.72)) {
        return chooseByDifficulty(captureNow, difficulty, rng);
    }

    const picked = chooseByDifficulty(scored, difficulty, rng);
    if ((difficulty === 'novice' || difficulty === 'casual') && game.moves.length > 60 && rng() < 0.05) {
        return { pass: true, score: picked.score * 0.5 };
    }
    return picked;
}

function boardBeforeLastMove(game: Pick<TheaterGoGame, 'moves' | 'boardSize'>): GoBoard {
    return buildGoBoard((game.moves || []).slice(0, -1), game.boardSize || GO_BOARD_SIZE);
}

export function classifyGoMove(
    gameBefore: Pick<TheaterGoGame, 'moves' | 'boardSize' | 'charStone'>,
    move: GoMove,
    outcome?: { winner?: GoPlayerRole | 'draw' },
): GoMoveEvent[] {
    const tags = new Set<GoMoveEvent>();
    if (outcome?.winner === 'draw') tags.add('draw');
    if (outcome?.winner === 'char') tags.add('win');
    if (outcome?.winner === 'user') tags.add('lose');
    if (move.pass) tags.add('pass');
    if ((move.captured || []).length > 0) tags.add(move.by === 'char' ? 'capture' : 'captured');

    if (!move.pass && move.row !== undefined && move.col !== undefined) {
        const before = buildGoBoard(gameBefore.moves, gameBefore.boardSize || GO_BOARD_SIZE);
        const valid = validateGoMove(before, move.row, move.col, move.stone);
        const after = valid.ok ? valid.board : before;
        const opponent = opponentGoStone(move.stone);
        const opponentInAtari = allGroups(after, opponent).some(g => g.liberties.size === 1);
        const ownSaved = allGroups(before, move.stone).some(g => g.liberties.size === 1 && g.liberties.has(pointKey(move.row!, move.col!)));
        if (move.by === 'char' && opponentInAtari) tags.add('attack');
        if (move.by === 'user' && opponentInAtari) tags.add('danger');
        if (move.by === 'char' && ownSaved) tags.add('block');
        if (move.by === 'user' && ownSaved) tags.add('blocked');
    }

    if (!tags.size) tags.add('normal');
    return Array.from(tags);
}

export function createGoGame(
    userName: string,
    char: Pick<CharacterProfile, 'id' | 'name'>,
    opts: {
        difficultyMode?: GoDifficultyMode;
        difficultyLevel?: GoDifficultyLevel;
        charStarts?: boolean;
        invitationId?: string;
        now?: number;
    } = {},
): TheaterGoGame {
    const now = opts.now || Date.now();
    const charStone: GoStone = opts.charStarts ? 'black' : 'white';
    return {
        id: genId('go'),
        title: `${new Date(now).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })} 的围棋`,
        charId: char.id,
        charName: char.name,
        userName: userName || '你',
        status: 'active',
        boardSize: GO_BOARD_SIZE,
        difficultyMode: opts.difficultyMode || 'opening',
        difficultyLevel: opts.difficultyLevel || 'steady',
        charStone,
        currentTurn: charStone === 'black' ? 'char' : 'user',
        moves: [],
        dialogue: [],
        captures: { black: 0, white: 0 },
        consecutivePasses: 0,
        createdAt: now,
        lastActiveAt: now,
        invitationId: opts.invitationId,
    };
}

export function normalizeGoGame(game: TheaterGoGame): TheaterGoGame {
    return {
        ...game,
        boardSize: game.boardSize || GO_BOARD_SIZE,
        difficultyMode: game.difficultyMode || 'opening',
        difficultyLevel: sanitizeGoDifficultyLevel(game.difficultyLevel, 'steady'),
        status: game.status || 'active',
        currentTurn: game.currentTurn || 'user',
        moves: game.moves || [],
        dialogue: game.dialogue || [],
        captures: game.captures || { black: 0, white: 0 },
        consecutivePasses: game.consecutivePasses || 0,
        lastActiveAt: game.lastActiveAt || game.createdAt || Date.now(),
    };
}

export function applyGoMove(
    input: TheaterGoGame,
    row: number,
    col: number,
    by: GoPlayerRole,
    now = Date.now(),
): { ok: true; game: TheaterGoGame; move: GoMove; events: GoMoveEvent[] } | { ok: false; game: TheaterGoGame; reason: string; events: GoMoveEvent[] } {
    const game = normalizeGoGame(input);
    if (game.status === 'ended') return { ok: false, game, reason: '这局已经结束了。', events: ['illegal'] };
    if (game.currentTurn !== by) return { ok: false, game, reason: '还没轮到这一方落子。', events: ['illegal'] };
    const board = buildGoBoard(game.moves, game.boardSize);
    const beforeHash = goBoardHash(board);
    const stone = goStoneForRole(game, by);
    const valid = validateGoMove(board, row, col, stone, game.previousBoardHash);
    if (!valid.ok) return { ok: false, game, reason: valid.reason, events: ['illegal'] };

    const baseMove: GoMove = { no: game.moves.length + 1, row, col, stone, by, at: now, captured: valid.captured };
    const events = classifyGoMove(game, baseMove);
    const move = { ...baseMove, eventTags: events };
    const captures = { ...game.captures, [stone]: (game.captures?.[stone] || 0) + valid.captured.length };
    return {
        ok: true,
        move,
        events,
        game: {
            ...game,
            moves: [...game.moves, move],
            captures,
            currentTurn: roleOpponent(by),
            consecutivePasses: 0,
            previousBoardHash: beforeHash,
            lastActiveAt: now,
        },
    };
}

export function applyGoPass(
    input: TheaterGoGame,
    by: GoPlayerRole,
    now = Date.now(),
): { ok: true; game: TheaterGoGame; move: GoMove; events: GoMoveEvent[] } | { ok: false; game: TheaterGoGame; reason: string; events: GoMoveEvent[] } {
    const game = normalizeGoGame(input);
    if (game.status === 'ended') return { ok: false, game, reason: '这局已经结束了。', events: ['illegal'] };
    if (game.currentTurn !== by) return { ok: false, game, reason: '还没轮到这一方。', events: ['illegal'] };
    const stone = goStoneForRole(game, by);
    const passCount = game.consecutivePasses + 1;
    const board = buildGoBoard(game.moves, game.boardSize);
    const score = passCount >= 2 ? scoreGoBoard(board) : undefined;
    const winner = score ? winnerFromScore(game, score) : undefined;
    const move: GoMove = { no: game.moves.length + 1, stone, by, at: now, pass: true, eventTags: ['pass'] };
    const events = classifyGoMove(game, move, { winner });
    const ended = passCount >= 2;
    return {
        ok: true,
        move: { ...move, eventTags: events },
        events,
        game: {
            ...game,
            moves: [...game.moves, { ...move, eventTags: events }],
            status: ended ? 'ended' : 'active',
            currentTurn: ended ? game.currentTurn : roleOpponent(by),
            consecutivePasses: passCount,
            winner,
            score,
            endedAt: ended ? now : game.endedAt,
            lastActiveAt: now,
        },
    };
}

export function resignGoGame(input: TheaterGoGame, by: GoPlayerRole, now = Date.now()): TheaterGoGame {
    const game = normalizeGoGame(input);
    const winner = roleOpponent(by);
    return {
        ...game,
        status: 'ended',
        winner,
        endedAt: now,
        lastActiveAt: now,
    };
}

export function addGoDialogue(game: TheaterGoGame, kind: GoDialogueKind, text: string, by: 'char' | 'system' = 'char', moveNo?: number, now = Date.now()): TheaterGoGame {
    const clean = clampText(text, 120);
    if (!clean) return game;
    return {
        ...game,
        dialogue: [...(game.dialogue || []), { id: genId('god'), by, kind, text: clean, at: now, moveNo }].slice(-80),
        lastActiveAt: now,
    };
}

export function isGoDifficultyLevel(value: unknown): value is GoDifficultyLevel {
    return GO_DIFFICULTY_LEVELS.includes(String(value || '').toLowerCase() as GoDifficultyLevel);
}

export function sanitizeGoDifficultyLevel(value: unknown, fallback: GoDifficultyLevel = 'steady'): GoDifficultyLevel {
    const raw = String(value || '').trim().toLowerCase();
    const aliases: Record<string, GoDifficultyLevel> = {
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
    if (isGoDifficultyLevel(raw)) return raw;
    return aliases[raw] || fallback;
}

export function sanitizeGoDifficultyMode(value: unknown, fallback: GoDifficultyMode = 'opening'): GoDifficultyMode {
    const raw = String(value || '').trim().toLowerCase();
    if (raw === 'opening' || raw === 'fixed' || raw.includes('开局')) return 'opening';
    if (raw === 'per_move' || raw === 'per-move' || raw === 'dynamic' || raw.includes('每步')) return 'per_move';
    return fallback;
}

export function parseGoDifficultyResult(raw: unknown, fallbackLevel: GoDifficultyLevel = 'steady', fallbackMode?: GoDifficultyMode): {
    difficultyLevel: GoDifficultyLevel;
    difficultyMode?: GoDifficultyMode;
    reason?: string;
} {
    const parsed = typeof raw === 'string' ? extractJson(raw) : raw;
    const obj = parsed && typeof parsed === 'object' ? parsed as any : {};
    return {
        difficultyLevel: sanitizeGoDifficultyLevel(obj.difficultyLevel ?? obj.level ?? obj.difficulty, fallbackLevel),
        difficultyMode: obj.difficultyMode || obj.mode ? sanitizeGoDifficultyMode(obj.difficultyMode ?? obj.mode, fallbackMode || 'opening') : fallbackMode,
        reason: clampText(obj.reason || obj.note, 80) || undefined,
    };
}

function normalizeAiCoordPair(raw: any, size: number): GoPoint | null {
    const rowRaw = Number(raw?.row ?? raw?.r ?? raw?.y);
    const colRaw = Number(raw?.col ?? raw?.column ?? raw?.c ?? raw?.x);
    if (!Number.isFinite(rowRaw) || !Number.isFinite(colRaw)) return null;
    const row = Math.trunc(rowRaw);
    const col = Math.trunc(colRaw);
    if (isInsideGoBoard(row, col, size)) return { row, col };
    if (row >= 1 && row <= size && col >= 1 && col <= size) return { row: row - 1, col: col - 1 };
    return null;
}

export function sanitizeGoMoveResult(
    raw: unknown,
    board: GoBoard,
    stone: GoStone,
    fallback: { row: number; col: number } | { pass: true },
    previousBoardHash?: string,
): { row: number; col: number; reason?: string; usedFallback: boolean; pass?: false } | { pass: true; reason?: string; usedFallback: boolean } {
    const parsed = typeof raw === 'string' ? extractJson(raw) : raw;
    const obj = parsed && typeof parsed === 'object' ? parsed as any : {};
    if (obj.pass === true || String(obj.move || '').toLowerCase() === 'pass' || String(obj.action || '').includes('停')) {
        return { pass: true, reason: clampText(obj.reason, 80) || undefined, usedFallback: false };
    }
    const pair = normalizeAiCoordPair(obj, board.length);
    if (pair && validateGoMove(board, pair.row, pair.col, stone, previousBoardHash).ok) {
        return { ...pair, reason: clampText(obj.reason, 80) || undefined, usedFallback: false };
    }
    return 'pass' in fallback ? { pass: true, usedFallback: true } : { ...fallback, usedFallback: true };
}

export function heuristicCharacterGoDifficulty(char: CharacterProfile): GoDifficultyLevel {
    const text = [
        char.name,
        (char as any).description,
        (char as any).personality,
        (char as any).worldview,
        (char as any).systemPrompt,
        (char as any).scenario,
    ].filter(Boolean).join('\n').toLowerCase();
    if (/围棋|手谈|棋士|棋手|棋院|棋圣|棋|策略|谋略|计算|推理|侦探|军师|ai|人工智能|天才|master|genius|strateg/.test(text)) return 'sharp';
    if (/笨|迷糊|随性|孩子气|新手|不会|天然|冒失/.test(text)) return 'casual';
    return 'steady';
}

export function goBoardSummary(game: Pick<TheaterGoGame, 'moves' | 'boardSize' | 'charStone' | 'charName' | 'userName' | 'captures'>, limit = 14): string {
    const board = buildGoBoard(game.moves, game.boardSize || GO_BOARD_SIZE);
    const charStoneLabel = game.charStone === 'black' ? '黑' : '白';
    const userStoneLabel = game.charStone === 'black' ? '白' : '黑';
    const recent = (game.moves || []).slice(-limit).map(m => {
        const who = m.by === 'char' ? game.charName : game.userName;
        const color = m.stone === 'black' ? '黑' : '白';
        return m.pass
            ? `${m.no}. ${who} ${color} 停着`
            : `${m.no}. ${who} ${color} (${(m.row ?? 0) + 1},${(m.col ?? 0) + 1})${m.captured?.length ? ` 提 ${m.captured.length} 子` : ''}`;
    }).join('\n') || '尚未落子';
    const charAtari = allGroups(board, game.charStone).filter(g => g.liberties.size === 1).length;
    const userAtari = allGroups(board, opponentGoStone(game.charStone)).filter(g => g.liberties.size === 1).length;
    const score = scoreGoBoard(board);
    return `棋盘：${game.boardSize || GO_BOARD_SIZE}x${game.boardSize || GO_BOARD_SIZE}
${game.charName} 执${charStoneLabel}，${game.userName} 执${userStoneLabel}
提子：黑 ${game.captures?.black || 0}，白 ${game.captures?.white || 0}
最近落子：
${recent}
${game.charName} 被叫吃的棋块数：${charAtari}
${game.userName} 被叫吃的棋块数：${userAtari}
当前面积粗估：黑 ${score.black.toFixed(1)}，白 ${score.white.toFixed(1)}（含贴目 ${score.komi}）`;
}

function eventText(events: GoMoveEvent[]): string {
    const labels: Record<GoMoveEvent, string> = {
        normal: '普通落子',
        thinking: '角色思考',
        attack: '角色正在进攻/叫吃',
        block: '角色补棋或脱先前危险',
        blocked: '用户补住了角色的威胁',
        capture: '角色提子',
        captured: '用户提走了角色的棋',
        danger: '用户形成危险局面',
        pass: '停着',
        win: '角色获胜',
        lose: '角色落败',
        draw: '平局',
        illegal: '非法落子提示',
    };
    return events.map(e => labels[e] || e).join('、');
}

export function fallbackGoDialogue(kind: GoDialogueKind, charName: string, events: GoMoveEvent[] = []): string {
    if (kind === 'illegal') return '这手没有气，换个落点吧。';
    if (events.includes('win') || kind === 'win') return '数完了。看来这片棋盘，最后还是我多一点。';
    if (events.includes('lose') || kind === 'lose') return '你这一路收得很好，我认这盘。';
    if (events.includes('draw') || kind === 'draw') return '居然数成半目不让，挺有意思。';
    if (events.includes('pass') || kind === 'pass') return '我先停一手，看看这盘该怎么收。';
    if (events.includes('capture') || kind === 'capture') return '这几颗我先提掉，气口不能白给。';
    if (events.includes('captured') || kind === 'captured') return '被你提走了啊，那里我贪了一点。';
    if (events.includes('block') || kind === 'block') return '这里先补住，不然味道太坏。';
    if (events.includes('blocked') || kind === 'blocked') return '被你补到了，那我换个方向试试。';
    if (events.includes('danger') || kind === 'danger') return '这边有点薄，我得小心一点。';
    if (events.includes('attack') || kind === 'attack') return '我靠近一点，看看你这块怎么安定。';
    if (kind === 'thinking') return `${charName}看着棋盘，像是在数一口还没落下的气。`;
    if (kind === 'invite') return '要不要手谈一局？不急，我们慢慢下。';
    return '我落这里。';
}

async function callGoJson(
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
        meta: makeApiUsageMeta('theater.go', {
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

async function goSystem(char: CharacterProfile, userProfile: UserProfile): Promise<{ system: string; userName: string }> {
    const userName = (userProfile.name || '').trim() || '你';
    const core = await ContextBuilder.buildFullCoreContext(char, userProfile, true);
    return {
        userName,
        system: goDifficultySystem({ core, charName: char.name, userName }),
    };
}

export async function decideGoOpeningDifficulty(
    char: CharacterProfile,
    userProfile: UserProfile,
    api: ResolvedApi | null | undefined,
    mode: GoDifficultyMode,
    invite = false,
): Promise<{ difficultyLevel: GoDifficultyLevel; reason?: string; source: 'llm' | 'fallback' }> {
    const fallback = heuristicCharacterGoDifficulty(char);
    if (!api?.baseUrl || !api.model) return { difficultyLevel: fallback, source: 'fallback' };
    try {
        const { system, userName } = await goSystem(char, userProfile);
        const raw = await callGoJson(api, char, userName, system, goOpeningDifficultyUser({ mode, charName: char.name, userName, invite }));
        const parsed = parseGoDifficultyResult(raw, fallback);
        return { difficultyLevel: parsed.difficultyLevel, reason: parsed.reason, source: 'llm' };
    } catch {
        return { difficultyLevel: fallback, source: 'fallback' };
    }
}

export async function decideGoPerMoveDifficulty(
    char: CharacterProfile,
    userProfile: UserProfile,
    api: ResolvedApi | null | undefined,
    game: TheaterGoGame,
    events: GoMoveEvent[],
): Promise<{ difficultyLevel: GoDifficultyLevel; reason?: string; source: 'llm' | 'fallback' }> {
    const fallback = sanitizeGoDifficultyLevel(game.difficultyLevel, heuristicCharacterGoDifficulty(char));
    if (!api?.baseUrl || !api.model) return { difficultyLevel: fallback, source: 'fallback' };
    try {
        const { system, userName } = await goSystem(char, userProfile);
        const raw = await callGoJson(api, char, userName, system, goPerMoveDifficultyUser({
            charName: char.name,
            userName,
            difficultyLevel: fallback,
            board: goBoardSummary(game),
            event: eventText(events),
        }));
        const parsed = parseGoDifficultyResult(raw, fallback);
        return { difficultyLevel: parsed.difficultyLevel, reason: parsed.reason, source: 'llm' };
    } catch {
        return { difficultyLevel: fallback, source: 'fallback' };
    }
}

export async function generateGoDialogue(
    char: CharacterProfile,
    userProfile: UserProfile,
    api: ResolvedApi | null | undefined,
    game: TheaterGoGame,
    events: GoMoveEvent[],
    move?: GoMove,
): Promise<string> {
    const kind = (events.find(e => e !== 'normal') || 'normal') as GoDialogueKind;
    if (!api?.baseUrl || !api.model) return fallbackGoDialogue(kind, char.name, events);
    try {
        const userName = (userProfile.name || '').trim() || game.userName || '你';
        const core = await ContextBuilder.buildFullCoreContext(char, userProfile, true);
        const system = goDialogueSystem({ core, charName: char.name, userName });
        const lastMove = move
            ? move.pass
                ? `${move.by === 'char' ? char.name : userName} 停着`
                : `${move.by === 'char' ? char.name : userName} 在 (${(move.row ?? 0) + 1},${(move.col ?? 0) + 1}) 落${move.stone === 'black' ? '黑' : '白'}${move.captured?.length ? `，提 ${move.captured.length} 子` : ''}`
            : '尚未落子';
        const raw = await callGoJson(api, char, userName, system, goDialogueUser({
            charName: char.name,
            userName,
            event: eventText(events),
            board: goBoardSummary(game),
            difficultyLevel: game.difficultyLevel,
            lastMove,
        }), 240);
        const text = clampText((raw as any)?.text || raw, 80);
        return text || fallbackGoDialogue(kind, char.name, events);
    } catch {
        return fallbackGoDialogue(kind, char.name, events);
    }
}

export const getGoScore = (game: Pick<TheaterGoGame, 'moves' | 'boardSize'>): GoScore =>
    scoreGoBoard(buildGoBoard(game.moves, game.boardSize || GO_BOARD_SIZE));

export const getGoBoardBeforeLastMove = boardBeforeLastMove;
