import { describe, expect, it } from 'vitest';
import type { CharacterProfile, TheaterGomokuGame } from '../types';
import {
    applyGomokuMove,
    buildGomokuBoard,
    checkGomokuWinner,
    chooseGomokuMove,
    classifyGomokuMove,
    createEmptyGomokuBoard,
    createGomokuGame,
    parseGomokuDifficultyResult,
    sanitizeGomokuMoveResult,
} from './theaterGomoku';

const char = { id: 'char-1', name: '棋友' } as CharacterProfile;

const makeGame = (overrides: Partial<TheaterGomokuGame> = {}) => ({
    ...createGomokuGame('用户', char, { now: 1000 }),
    ...overrides,
}) as TheaterGomokuGame;

describe('theater gomoku rules', () => {
    it('initializes a 15x15 board', () => {
        const board = createEmptyGomokuBoard();
        expect(board).toHaveLength(15);
        expect(board.every(row => row.length === 15)).toBe(true);
        expect(board.flat().every(cell => cell === null)).toBe(true);
    });

    it('applies legal moves and rejects occupied or out-of-board points', () => {
        const game = makeGame();
        const first = applyGomokuMove(game, 7, 7, 'user', 1001);
        expect(first.ok).toBe(true);
        if (!first.ok) return;
        expect(first.game.moves[0]).toMatchObject({ row: 7, col: 7, stone: 'black', by: 'user' });
        expect(applyGomokuMove(first.game, 7, 7, 'char').ok).toBe(false);
        expect(applyGomokuMove(first.game, 20, 7, 'char').ok).toBe(false);
    });

    it('detects horizontal, vertical, and diagonal five-in-a-row', () => {
        const horizontal = buildGomokuBoard([0, 1, 2, 3, 4].map(col => ({ row: 2, col, stone: 'black' as const })));
        expect(checkGomokuWinner(horizontal, { row: 2, col: 4, stone: 'black' }).winnerStone).toBe('black');

        const vertical = buildGomokuBoard([0, 1, 2, 3, 4].map(row => ({ row, col: 2, stone: 'white' as const })));
        expect(checkGomokuWinner(vertical, { row: 4, col: 2, stone: 'white' }).winnerStone).toBe('white');

        const diagonal = buildGomokuBoard([0, 1, 2, 3, 4].map(i => ({ row: i, col: i, stone: 'black' as const })));
        expect(checkGomokuWinner(diagonal, { row: 4, col: 4, stone: 'black' }).winnerStone).toBe('black');

        const antiDiagonal = buildGomokuBoard([0, 1, 2, 3, 4].map(i => ({ row: i, col: 8 - i, stone: 'white' as const })));
        expect(checkGomokuWinner(antiDiagonal, { row: 4, col: 4, stone: 'white' }).winnerStone).toBe('white');
    });

    it('treats overlines as wins', () => {
        const board = buildGomokuBoard([0, 1, 2, 3, 4, 5].map(col => ({ row: 5, col, stone: 'black' as const })));
        const result = checkGomokuWinner(board, { row: 5, col: 5, stone: 'black' });
        expect(result.winnerStone).toBe('black');
        expect(result.winLine?.length).toBeGreaterThanOrEqual(6);
    });

    it('detects draw on a full board without five-in-a-row', () => {
        const board = createEmptyGomokuBoard(3);
        const stones = ['black', 'white', 'black', 'white', 'white', 'black', 'black', 'black', 'white'] as const;
        stones.forEach((stone, i) => { board[Math.floor(i / 3)][i % 3] = stone; });
        const result = checkGomokuWinner(board);
        expect(result.winnerStone).toBeNull();
        expect(result.draw).toBe(true);
    });

    it('prevents further moves after a win', () => {
        let game = makeGame();
        for (let i = 0; i < 5; i++) {
            const u = applyGomokuMove(game, 0, i, 'user');
            expect(u.ok).toBe(true);
            if (!u.ok) return;
            game = u.game;
            if (i < 4) {
                const c = applyGomokuMove(game, 1, i, 'char');
                expect(c.ok).toBe(true);
                if (!c.ok) return;
                game = c.game;
            }
        }
        expect(game.status).toBe('ended');
        expect(game.winner).toBe('user');
        expect(applyGomokuMove(game, 2, 2, 'char').ok).toBe(false);
    });

    it('classifies blocking and being blocked', () => {
        const charBlocksUser = makeGame({
            currentTurn: 'char',
            moves: [
                { no: 1, row: 0, col: 0, stone: 'black', by: 'user', at: 1 },
                { no: 2, row: 1, col: 0, stone: 'white', by: 'char', at: 2 },
                { no: 3, row: 0, col: 1, stone: 'black', by: 'user', at: 3 },
                { no: 4, row: 1, col: 1, stone: 'white', by: 'char', at: 4 },
                { no: 5, row: 0, col: 2, stone: 'black', by: 'user', at: 5 },
                { no: 6, row: 1, col: 2, stone: 'white', by: 'char', at: 6 },
                { no: 7, row: 0, col: 3, stone: 'black', by: 'user', at: 7 },
            ],
        });
        expect(classifyGomokuMove(charBlocksUser, { row: 0, col: 4, stone: 'white', by: 'char' })).toContain('block');

        const userBlocksChar = makeGame({
            currentTurn: 'user',
            moves: [
                { no: 1, row: 1, col: 0, stone: 'black', by: 'user', at: 1 },
                { no: 2, row: 0, col: 0, stone: 'white', by: 'char', at: 2 },
                { no: 3, row: 1, col: 1, stone: 'black', by: 'user', at: 3 },
                { no: 4, row: 0, col: 1, stone: 'white', by: 'char', at: 4 },
                { no: 5, row: 1, col: 2, stone: 'black', by: 'user', at: 5 },
                { no: 6, row: 0, col: 2, stone: 'white', by: 'char', at: 6 },
                { no: 7, row: 2, col: 2, stone: 'black', by: 'user', at: 7 },
                { no: 8, row: 0, col: 3, stone: 'white', by: 'char', at: 8 },
            ],
        });
        expect(classifyGomokuMove(userBlocksChar, { row: 0, col: 4, stone: 'black', by: 'user' })).toContain('blocked');
    });

    it('chooses legal moves across low and high difficulties', () => {
        const game = makeGame({
            moves: [
                { no: 1, row: 7, col: 7, stone: 'black', by: 'user', at: 1 },
                { no: 2, row: 7, col: 8, stone: 'white', by: 'char', at: 2 },
            ],
        });
        for (const level of ['novice', 'casual', 'steady', 'sharp', 'master'] as const) {
            const move = chooseGomokuMove(game, level, () => 0.42);
            expect(move.row).toBeGreaterThanOrEqual(0);
            expect(move.row).toBeLessThan(15);
            expect(move.col).toBeGreaterThanOrEqual(0);
            expect(move.col).toBeLessThan(15);
            expect(game.moves.some(m => m.row === move.row && m.col === move.col)).toBe(false);
        }
    });

    it('falls back stably when LLM difficulty or move JSON is invalid', () => {
        expect(parseGomokuDifficultyResult('{"difficultyLevel":"cosmic"}', 'steady').difficultyLevel).toBe('steady');
        expect(parseGomokuDifficultyResult('{"level":"master"}', 'steady').difficultyLevel).toBe('master');
        expect(parseGomokuDifficultyResult('not json', 'casual').difficultyLevel).toBe('casual');

        const board = createEmptyGomokuBoard();
        board[7][7] = 'black';
        expect(sanitizeGomokuMoveResult('{"row":99,"col":99}', board, { row: 7, col: 8 })).toMatchObject({ row: 7, col: 8, usedFallback: true });
        expect(sanitizeGomokuMoveResult('{"row":7}', board, { row: 6, col: 6 })).toMatchObject({ row: 6, col: 6, usedFallback: true });
        expect(sanitizeGomokuMoveResult('{"row":8,"col":9}', board, { row: 6, col: 6 })).toMatchObject({ row: 8, col: 9, usedFallback: false });
    });
});
