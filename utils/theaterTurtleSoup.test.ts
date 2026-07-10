import { describe, expect, it } from 'vitest';
import type { CharacterProfile, TurtleSoupCase } from '../types';
import {
    applyTurtleSoupFinalGuess,
    applyTurtleSoupQuestion,
    characterTurtleSoupHost,
    chooseTurtleSoupCharacterAction,
    createTurtleSoupGame,
    createTurtleSoupPlayers,
    fallbackTurtleSoupFinalGuessResult,
    fallbackTurtleSoupQuestionVerdict,
    normalizeTurtleSoupCase,
    parseTurtleSoupDifficultyResult,
    parseTurtleSoupFinalGuessResult,
    parseTurtleSoupHostVerdictResult,
    revealTurtleSoupAnswer,
    sanitizeTurtleSoupDifficultyMode,
    systemTurtleSoupHost,
} from './theaterTurtleSoup';

const char = (id: string, name: string, extra: Partial<CharacterProfile> = {}): CharacterProfile => ({
    id,
    modelId: `model-${id}`,
    name,
    avatar: '',
    description: '',
    systemPrompt: '',
    createdAt: Date.now(),
    ...extra,
} as CharacterProfile);

const soupCase: TurtleSoupCase = {
    title: '湿伞',
    surface: '雨停后，屋里出现一把湿伞。所有人都说没人来过，但门内写着别让他进来。',
    answer: '敲门声来自门内侧。死者已经死亡，凶手用湿伞伪造外来者痕迹，并写下警告掩盖藏尸。',
    keyPoints: ['敲门声来自门内侧', '死者已经死亡', '湿伞伪造外来者痕迹', '警告掩盖藏尸'],
    redHerrings: ['鬼魂'],
    contentWarnings: ['死亡'],
};

const makeGame = () => {
    const a = char('c1', '阿迟', { systemPrompt: '冷静的侦探，擅长推理。' });
    const b = char('c2', '小满');
    return createTurtleSoupGame('我', systemTurtleSoupHost(), createTurtleSoupPlayers('我', [a, b]), soupCase, {
        difficultyMode: 'opening',
        difficultyLevels: { c1: 'sharp', c2: 'casual' },
    });
};

describe('theater turtle soup engine', () => {
    it('creates and normalizes a dark turtle soup game with separated host and players', () => {
        const host = characterTurtleSoupHost(char('host', '主持人'));
        const game = createTurtleSoupGame('玩家', host, createTurtleSoupPlayers('玩家', [char('c1', '阿迟')]), soupCase);

        expect(game.status).toBe('playing');
        expect(game.tone).toBe('dark');
        expect(game.host.charId).toBe('host');
        expect(game.players.map(p => p.id)).toEqual(['user', 'c1']);
        expect(game.charIds).toEqual(['c1', 'host']);
    });

    it('sanitizes mode and case payloads with stable fallbacks', () => {
        expect(sanitizeTurtleSoupDifficultyMode('每轮评估')).toBe('per_move');
        const normalized = normalizeTurtleSoupCase({ title: '短', surface: '汤面', answer: '' }, soupCase);
        expect(normalized.answer).toBe(soupCase.answer);
        expect(normalized.keyPoints).toEqual(soupCase.keyPoints);
    });

    it('judges fallback yes/no/irrelevant questions with strict host text', () => {
        const game = makeGame();
        expect(fallbackTurtleSoupQuestionVerdict(game, '敲门声来自门内侧吗？')).toEqual({ verdict: 'yes', hostText: '是' });
        expect(fallbackTurtleSoupQuestionVerdict(game, '不是死者已经死亡吗？')).toEqual({ verdict: 'no', hostText: '否' });
        expect(fallbackTurtleSoupQuestionVerdict(game, '这和鬼魂有关吗？')).toEqual({ verdict: 'no', hostText: '否' });
        expect(fallbackTurtleSoupQuestionVerdict(game, '为什么会这样？')).toEqual({ verdict: 'irrelevant', hostText: '无关' });
    });

    it('records questions, rotates turns, and blocks moves after reveal', () => {
        const game = makeGame();
        const asked = applyTurtleSoupQuestion(game, 'user', '死者已经死亡吗？', 'yes');
        expect(asked.ok).toBe(true);
        if (!asked.ok) return;
        expect(asked.turn.hostText).toBe('是');
        expect(asked.game.turns).toHaveLength(1);
        expect(asked.game.currentSpeakerId).toBe('c1');

        const revealed = revealTurtleSoupAnswer(asked.game);
        expect(revealed.status).toBe('revealed');
        const blocked = applyTurtleSoupQuestion(revealed, 'user', '还能问吗？', 'irrelevant');
        expect(blocked.ok).toBe(false);
    });

    it('scores final guesses and ends the game only when correct', () => {
        const game = makeGame();
        const close = fallbackTurtleSoupFinalGuessResult(game, '死者已经死亡，湿伞是伪造的。');
        expect(close.result).toBe('close');

        const correct = fallbackTurtleSoupFinalGuessResult(game, soupCase.answer);
        expect(correct.result).toBe('correct');
        const applied = applyTurtleSoupFinalGuess(game, 'c1', soupCase.answer, correct.result, correct.hostText);
        expect(applied.ok).toBe(true);
        if (!applied.ok) return;
        expect(applied.game.status).toBe('solved');
        expect(applied.game.solvedById).toBe('c1');
    });

    it('chooses legal local character actions across difficulty levels', () => {
        const game = makeGame();
        for (const level of ['novice', 'casual', 'steady', 'sharp', 'master'] as const) {
            const action = chooseTurtleSoupCharacterAction(game, 'c1', level);
            expect(['question', 'final_guess']).toContain(action.kind);
            expect(action.text.length).toBeGreaterThan(0);
        }
    });

    it('parses malformed LLM JSON into stable fallbacks', () => {
        expect(parseTurtleSoupDifficultyResult({ difficultyLevel: 'impossible' }, 'steady').difficultyLevel).toBe('steady');
        expect(parseTurtleSoupHostVerdictResult({ verdict: 'maybe', hostText: '当然不是啦' }, { verdict: 'no', hostText: '否' }))
            .toEqual({ verdict: 'no', hostText: '否' });
        expect(parseTurtleSoupFinalGuessResult({ result: 'almost' }, { result: 'wrong', hostText: '不对。' }))
            .toEqual({ result: 'wrong', hostText: '不对。' });
    });
});
