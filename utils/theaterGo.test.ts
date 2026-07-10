import { describe, expect, it } from 'vitest';
import type { CharacterProfile, TheaterGoGame } from '../types';
import {
    applyGoMove,
    applyGoPass,
    buildGoBoard,
    chooseGoMove,
    classifyGoMove,
    createEmptyGoBoard,
    createGoGame,
    goBoardHash,
    parseGoDifficultyResult,
    sanitizeGoMoveResult,
    validateGoMove,
} from './theaterGo';

const char = { id: 'char-1', name: '棋友' } as CharacterProfile;

const makeGame = (overrides: Partial<TheaterGoGame> = {}) => ({
    ...createGoGame('用户', char, { now: 1000 }),
    ...overrides,
}) as TheaterGoGame;

describe('theater go rules', () => {
    it('initializes a 19x19 board', () => {
        const board = createEmptyGoBoard();
        expect(board).toHaveLength(19);
        expect(board.every(row => row.length === 19)).toBe(true);
        expect(board.flat().every(cell => cell === null)).toBe(true);
    });

    it('applies legal moves and rejects occupied or out-of-board points', () => {
        const game = makeGame();
        const first = applyGoMove(game, 9, 9, 'user', 1001);
        expect(first.ok).toBe(true);
        if (!first.ok) return;
        expect(first.game.moves[0]).toMatchObject({ row: 9, col: 9, stone: 'black', by: 'user' });
        expect(applyGoMove(first.game, 9, 9, 'char').ok).toBe(false);
        expect(applyGoMove(first.game, 20, 9, 'char').ok).toBe(false);
    });

    it('rejects suicide moves unless they capture', () => {
        const board = buildGoBoard([
            { row: 0, col: 1, stone: 'black' as const },
            { row: 1, col: 0, stone: 'black' as const },
            { row: 1, col: 2, stone: 'black' as const },
            { row: 2, col: 1, stone: 'black' as const },
        ]);
        expect(validateGoMove(board, 1, 1, 'white').ok).toBe(false);

        const captureBoard = buildGoBoard([
            { row: 0, col: 1, stone: 'black' as const },
            { row: 1, col: 0, stone: 'black' as const },
            { row: 1, col: 2, stone: 'black' as const },
            { row: 2, col: 1, stone: 'white' as const },
            { row: 3, col: 0, stone: 'white' as const },
            { row: 3, col: 1, stone: 'white' as const },
            { row: 3, col: 2, stone: 'white' as const },
        ]);
        const move = validateGoMove(captureBoard, 2, 0, 'white');
        expect(move.ok).toBe(true);
    });

    it('captures opponent stones with no liberties', () => {
        const game = makeGame({
            moves: [
                { no: 1, row: 1, col: 1, stone: 'white', by: 'char', at: 1 },
                { no: 2, row: 0, col: 1, stone: 'black', by: 'user', at: 2 },
                { no: 3, row: 1, col: 0, stone: 'black', by: 'user', at: 3 },
                { no: 4, row: 2, col: 1, stone: 'black', by: 'user', at: 4 },
            ],
            currentTurn: 'user',
        });
        const result = applyGoMove(game, 1, 2, 'user', 5);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.move.captured).toEqual([{ row: 1, col: 1 }]);
        expect(result.events).toContain('captured');
        expect(buildGoBoard(result.game.moves)[1][1]).toBeNull();
    });

    it('prevents immediate simple ko recapture', () => {
        const beforeKo = buildGoBoard([
            { row: 0, col: 1, stone: 'black' as const },
            { row: 1, col: 0, stone: 'black' as const },
            { row: 2, col: 1, stone: 'black' as const },
            { row: 1, col: 1, stone: 'white' as const },
            { row: 0, col: 2, stone: 'white' as const },
            { row: 1, col: 3, stone: 'white' as const },
            { row: 2, col: 2, stone: 'white' as const },
        ]);
        const game = makeGame({
            moves: [
                { no: 1, row: 0, col: 1, stone: 'black', by: 'user', at: 1 },
                { no: 2, row: 0, col: 2, stone: 'white', by: 'char', at: 2 },
                { no: 3, row: 1, col: 0, stone: 'black', by: 'user', at: 3 },
                { no: 4, row: 1, col: 1, stone: 'white', by: 'char', at: 4 },
                { no: 5, row: 2, col: 1, stone: 'black', by: 'user', at: 5 },
                { no: 6, row: 1, col: 3, stone: 'white', by: 'char', at: 6 },
                { no: 7, row: 2, col: 2, stone: 'white', by: 'char', at: 7 },
                { no: 8, row: 1, col: 2, stone: 'black', by: 'user', at: 8, captured: [{ row: 1, col: 1 }] },
            ],
            currentTurn: 'char',
            previousBoardHash: goBoardHash(beforeKo),
        });
        expect(applyGoMove(game, 1, 1, 'char').ok).toBe(false);
    });

    it('ends and scores after two consecutive passes', () => {
        const first = applyGoPass(makeGame(), 'user', 1);
        expect(first.ok).toBe(true);
        if (!first.ok) return;
        expect(first.game.status).toBe('active');
        const second = applyGoPass(first.game, 'char', 2);
        expect(second.ok).toBe(true);
        if (!second.ok) return;
        expect(second.game.status).toBe('ended');
        expect(second.game.score).toBeTruthy();
        expect(second.events.some(e => e === 'win' || e === 'lose' || e === 'draw' || e === 'pass')).toBe(true);
    });

    it('classifies attack, block, and capture events', () => {
        const captureMove = {
            no: 5,
            row: 1,
            col: 2,
            stone: 'black' as const,
            by: 'user' as const,
            at: 5,
            captured: [{ row: 1, col: 1 }],
        };
        const captureGame = makeGame({
            moves: [
                { no: 1, row: 1, col: 1, stone: 'white', by: 'char', at: 1 },
                { no: 2, row: 0, col: 1, stone: 'black', by: 'user', at: 2 },
                { no: 3, row: 1, col: 0, stone: 'black', by: 'user', at: 3 },
                { no: 4, row: 2, col: 1, stone: 'black', by: 'user', at: 4 },
            ],
        });
        expect(classifyGoMove(captureGame, captureMove)).toContain('captured');

        const blockGame = makeGame({
            charStone: 'black',
            currentTurn: 'char',
            moves: [
                { no: 1, row: 1, col: 1, stone: 'black', by: 'char', at: 1 },
                { no: 2, row: 0, col: 1, stone: 'white', by: 'user', at: 2 },
                { no: 3, row: 1, col: 0, stone: 'white', by: 'user', at: 3 },
                { no: 4, row: 2, col: 1, stone: 'white', by: 'user', at: 4 },
            ],
        });
        expect(classifyGoMove(blockGame, { no: 5, row: 1, col: 2, stone: 'black', by: 'char', at: 5 })).toContain('block');
    });

    it('chooses legal moves or passes across low and high difficulties', () => {
        const game = makeGame({
            moves: [
                { no: 1, row: 9, col: 9, stone: 'black', by: 'user', at: 1 },
                { no: 2, row: 9, col: 10, stone: 'white', by: 'char', at: 2 },
            ],
        });
        const board = buildGoBoard(game.moves);
        for (const level of ['novice', 'casual', 'steady', 'sharp', 'master'] as const) {
            const move = chooseGoMove(game, level, () => 0.42);
            if ('pass' in move) {
                expect(move.pass).toBe(true);
                continue;
            }
            expect(move.row).toBeGreaterThanOrEqual(0);
            expect(move.row).toBeLessThan(19);
            expect(move.col).toBeGreaterThanOrEqual(0);
            expect(move.col).toBeLessThan(19);
            expect(validateGoMove(board, move.row, move.col, game.charStone).ok).toBe(true);
        }
    });

    it('falls back stably when LLM difficulty or move JSON is invalid', () => {
        expect(parseGoDifficultyResult('{"difficultyLevel":"cosmic"}', 'steady').difficultyLevel).toBe('steady');
        expect(parseGoDifficultyResult('{"level":"master"}', 'steady').difficultyLevel).toBe('master');
        expect(parseGoDifficultyResult('not json', 'casual').difficultyLevel).toBe('casual');

        const board = createEmptyGoBoard();
        board[9][9] = 'black';
        expect(sanitizeGoMoveResult('{"row":99,"col":99}', board, 'white', { row: 9, col: 10 })).toMatchObject({ row: 9, col: 10, usedFallback: true });
        expect(sanitizeGoMoveResult('{"row":9}', board, 'white', { row: 8, col: 8 })).toMatchObject({ row: 8, col: 8, usedFallback: true });
        expect(sanitizeGoMoveResult('{"row":10,"col":11}', board, 'white', { row: 8, col: 8 })).toMatchObject({ row: 10, col: 11, usedFallback: false });
        expect(sanitizeGoMoveResult('{"pass":true}', board, 'white', { row: 8, col: 8 })).toMatchObject({ pass: true, usedFallback: false });
    });
});
