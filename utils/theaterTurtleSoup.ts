/**
 * 幕间集·海龟汤。
 * ================
 * 暗黑汤；系统或正式角色当主持人，用户与 1-5 位正式角色一起提问/猜谜。
 * 模型负责出题、主持判定、角色猜题实力与对白；本地状态机负责存档推进、
 * 枚举校验和失败兜底。
 *
 * prompt 文案集中在 utils/theaterPrompts.ts（[拾肆] 海龟汤 区段）。
 */

import type {
    CharacterProfile,
    TheaterTurtleSoupGame,
    TurtleSoupCase,
    TurtleSoupDialogueKind,
    TurtleSoupDifficultyLevel,
    TurtleSoupDifficultyMode,
    TurtleSoupGuessResult,
    TurtleSoupHost,
    TurtleSoupPlayer,
    TurtleSoupTurn,
    TurtleSoupVerdict,
    UserProfile,
} from '../types';
import type { ResolvedApi } from './auxApi';
import { makeApiUsageMeta } from './apiUsageCatalog';
import { buildFullActiveUserSetting } from './characterPromptProfile';
import { ContextBuilder } from './context';
import { callChatCompletion, stripThink } from './llmClient';
import { extractContent, extractJson } from './safeApi';
import {
    turtleSoupCaseSystem,
    turtleSoupCaseUser,
    turtleSoupCharacterActionSystem,
    turtleSoupCharacterActionUser,
    turtleSoupDialogueSystem,
    turtleSoupDialogueUser,
    turtleSoupDifficultySystem,
    turtleSoupFinalGuessUser,
    turtleSoupHostJudgeSystem,
    turtleSoupHostJudgeUser,
    turtleSoupOpeningDifficultyUser,
    turtleSoupPerMoveDifficultyUser,
} from './theaterPrompts';

export const TURTLE_SOUP_DIFFICULTY_LEVELS: TurtleSoupDifficultyLevel[] = ['novice', 'casual', 'steady', 'sharp', 'master'];
export const TURTLE_SOUP_DIFFICULTY_LABELS: Record<TurtleSoupDifficultyLevel, string> = {
    novice: '新手',
    casual: '休闲',
    steady: '稳健',
    sharp: '锋利',
    master: '高手',
};
export const TURTLE_SOUP_DIFFICULTY_MODE_LABELS: Record<TurtleSoupDifficultyMode, string> = {
    opening: '开局定档',
    per_move: '每轮评估',
};
export const TURTLE_SOUP_VERDICT_LABELS: Record<TurtleSoupVerdict, string> = {
    yes: '是',
    no: '否',
    irrelevant: '无关',
};

const genId = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const clampText = (text: unknown, max = 160): string => String(text || '').replace(/\s+/g, ' ').trim().slice(0, max);
const uniq = <T,>(items: T[]): T[] => Array.from(new Set(items));

export function sanitizeTurtleSoupDifficultyLevel(value: unknown, fallback: TurtleSoupDifficultyLevel = 'steady'): TurtleSoupDifficultyLevel {
    const v = String(value || '').trim().toLowerCase();
    if (v === 'novice' || v === '新手') return 'novice';
    if (v === 'casual' || v === '休闲') return 'casual';
    if (v === 'steady' || v === '稳健') return 'steady';
    if (v === 'sharp' || v === '锋利') return 'sharp';
    if (v === 'master' || v === '高手') return 'master';
    return fallback;
}

export function sanitizeTurtleSoupDifficultyMode(value: unknown, fallback: TurtleSoupDifficultyMode = 'opening'): TurtleSoupDifficultyMode {
    const v = String(value || '').trim().toLowerCase();
    if (v === 'per_move' || v === 'per-move' || v === 'dynamic' || v === '每步评估' || v === '每轮评估') return 'per_move';
    if (v === 'opening' || v === 'fixed' || v === '开局定档') return 'opening';
    return fallback;
}

export function sanitizeTurtleSoupVerdict(value: unknown, fallback: TurtleSoupVerdict = 'irrelevant'): TurtleSoupVerdict {
    const v = String(value || '').trim().toLowerCase();
    if (v === 'yes' || v === '是') return 'yes';
    if (v === 'no' || v === '否') return 'no';
    if (v === 'irrelevant' || v === 'unknown' || v === '无关') return 'irrelevant';
    return fallback;
}

export function sanitizeTurtleSoupGuessResult(value: unknown, fallback: TurtleSoupGuessResult = 'wrong'): TurtleSoupGuessResult {
    const v = String(value || '').trim().toLowerCase();
    if (v === 'correct' || v === '答对' || v === '正确') return 'correct';
    if (v === 'close' || v === '接近') return 'close';
    if (v === 'wrong' || v === '错误' || v === '答错') return 'wrong';
    return fallback;
}

export const systemTurtleSoupHost = (): TurtleSoupHost => ({ kind: 'system', name: '汤面主持' });

export const characterTurtleSoupHost = (char: CharacterProfile): TurtleSoupHost => ({
    kind: 'character',
    name: char.convoSettings?.remarkName?.trim() || char.name,
    charId: char.id,
    avatar: char.avatar,
});

export const createTurtleSoupPlayers = (userName: string, chars: CharacterProfile[]): TurtleSoupPlayer[] => [
    { id: 'user', name: userName || '你', isUser: true },
    ...chars.slice(0, 5).map(char => ({
        id: char.id,
        name: char.convoSettings?.remarkName?.trim() || char.name,
        isUser: false,
        charId: char.id,
        avatar: char.avatar,
    })),
];

export function fallbackTurtleSoupCase(seed = ''): TurtleSoupCase {
    const suffix = seed ? `（${seed.slice(0, 12)}）` : '';
    return {
        title: `门后的雨声${suffix}`,
        surface: '雨停以后，楼道里只剩一把湿伞。房间里的人都说没有听见敲门声，可门内侧却多了一行刚写下的字：别让他进来。',
        answer: '真正敲门的人早已在雨夜中死去。房间里的人听不见敲门声，是因为声音来自门内侧：有人用湿伞伪造了外来者的痕迹，想让同伴相信死者还会回来，从而掩盖自己刚刚写下警告并藏起尸体的事实。',
        keyPoints: ['敲门声来自门内侧', '湿伞是伪造痕迹', '死者已经死亡', '有人用警告掩盖藏尸'],
        redHerrings: ['真正的鬼魂', '邻居恶作剧'],
        contentWarnings: ['死亡', '藏尸', '心理压迫'],
    };
}

export function normalizeTurtleSoupCase(raw: Partial<TurtleSoupCase> | null | undefined, fallback = fallbackTurtleSoupCase()): TurtleSoupCase {
    const title = clampText(raw?.title, 40) || fallback.title;
    const surface = clampText(raw?.surface, 240) || fallback.surface;
    const answer = clampText(raw?.answer, 360) || fallback.answer;
    const keyPoints = (Array.isArray(raw?.keyPoints) ? raw?.keyPoints : [])
        .map(item => clampText(item, 80))
        .filter(Boolean)
        .slice(0, 6);
    const redHerrings = (Array.isArray(raw?.redHerrings) ? raw?.redHerrings : [])
        .map(item => clampText(item, 60))
        .filter(Boolean)
        .slice(0, 6);
    const contentWarnings = (Array.isArray(raw?.contentWarnings) ? raw?.contentWarnings : [])
        .map(item => clampText(item, 24))
        .filter(Boolean)
        .slice(0, 6);
    return {
        title,
        surface,
        answer,
        keyPoints: keyPoints.length ? keyPoints : fallback.keyPoints,
        redHerrings,
        contentWarnings,
    };
}

function difficultyRank(level: TurtleSoupDifficultyLevel): number {
    return TURTLE_SOUP_DIFFICULTY_LEVELS.indexOf(level);
}

export function heuristicCharacterTurtleSoupDifficulty(char: CharacterProfile): TurtleSoupDifficultyLevel {
    const text = `${char.name} ${char.description || ''} ${char.systemPrompt || ''} ${char.worldview || ''}`.toLowerCase();
    if (/侦探|推理|刑警|法医|律师|心理|逻辑|棋|谋略|detective|logic|investigator/.test(text)) return 'sharp';
    if (/天才|大师|教授|神探|mastermind|genius/.test(text)) return 'master';
    if (/笨拙|迷糊|小孩|新手|单纯|迟钝/.test(text)) return 'novice';
    if (/谨慎|冷静|理性|观察|医生|研究/.test(text)) return 'steady';
    return 'casual';
}

export function createTurtleSoupGame(
    userName: string,
    host: TurtleSoupHost,
    players: TurtleSoupPlayer[],
    soupCase: TurtleSoupCase,
    opts?: {
        difficultyMode?: TurtleSoupDifficultyMode;
        difficultyLevels?: Partial<Record<string, TurtleSoupDifficultyLevel>>;
        invitationId?: string;
    },
): TheaterTurtleSoupGame {
    const now = Date.now();
    const normalizedPlayers = players.some(p => p.id === 'user')
        ? players
        : [{ id: 'user', name: userName || '你', isUser: true }, ...players];
    const cleanCase = normalizeTurtleSoupCase(soupCase);
    const charIds = uniq([
        ...normalizedPlayers.map(p => p.charId).filter(Boolean) as string[],
        host.charId,
    ].filter(Boolean) as string[]);
    return {
        id: genId('turtle_soup'),
        title: cleanCase.title || '一碗海龟汤',
        userName: userName || '你',
        status: 'playing',
        tone: 'dark',
        host,
        players: normalizedPlayers.slice(0, 6),
        charIds,
        difficultyMode: sanitizeTurtleSoupDifficultyMode(opts?.difficultyMode, 'opening'),
        difficultyLevels: opts?.difficultyLevels || {},
        case: cleanCase,
        turns: [],
        dialogue: [],
        currentSpeakerId: 'user',
        createdAt: now,
        lastActiveAt: now,
        invitationId: opts?.invitationId,
    };
}

export function normalizeTurtleSoupGame(game: TheaterTurtleSoupGame): TheaterTurtleSoupGame {
    const userName = game.userName || '你';
    const host = game.host?.kind ? game.host : systemTurtleSoupHost();
    const players = Array.isArray(game.players) && game.players.length
        ? game.players
        : [{ id: 'user', name: userName, isUser: true }];
    const charIds = uniq([
        ...(Array.isArray(game.charIds) ? game.charIds : []),
        ...players.map(p => p.charId).filter(Boolean) as string[],
        host.charId,
    ].filter(Boolean) as string[]);
    return {
        ...game,
        title: game.title || game.case?.title || '一碗海龟汤',
        userName,
        status: game.status || 'playing',
        tone: 'dark',
        host,
        players,
        charIds,
        difficultyMode: sanitizeTurtleSoupDifficultyMode(game.difficultyMode, 'opening'),
        difficultyLevels: game.difficultyLevels || {},
        case: normalizeTurtleSoupCase(game.case),
        turns: Array.isArray(game.turns) ? game.turns : [],
        dialogue: Array.isArray(game.dialogue) ? game.dialogue : [],
        currentSpeakerId: game.currentSpeakerId || 'user',
        createdAt: game.createdAt || Date.now(),
        lastActiveAt: game.lastActiveAt || game.createdAt || Date.now(),
    };
}

export function turtleSoupPlayerName(game: Pick<TheaterTurtleSoupGame, 'players' | 'host' | 'userName'>, id: string): string {
    if (id === 'user') return game.userName || '你';
    if (id === 'host') return game.host?.name || '主持人';
    if (id === 'system') return '汤局';
    return game.players.find(p => p.id === id || p.charId === id)?.name || '某位玩家';
}

export function nextTurtleSoupSpeaker(game: TheaterTurtleSoupGame, fromId = game.currentSpeakerId): string {
    const players = game.players.length ? game.players : [{ id: 'user', name: game.userName || '你', isUser: true }];
    const index = players.findIndex(p => p.id === fromId);
    return players[(index + 1 + players.length) % players.length]?.id || 'user';
}

export function addTurtleSoupDialogue(
    game: TheaterTurtleSoupGame,
    kind: TurtleSoupDialogueKind,
    text: string,
    by = 'system',
    turnNo?: number,
): TheaterTurtleSoupGame {
    const g = normalizeTurtleSoupGame(game);
    const clean = clampText(text, 140);
    if (!clean) return g;
    const player = g.players.find(p => p.id === by || p.charId === by);
    const line = {
        id: genId('turtle_line'),
        by,
        byName: turtleSoupPlayerName(g, by),
        charId: player?.charId || (by === 'host' ? g.host.charId : undefined),
        kind,
        text: clean,
        at: Date.now(),
        turnNo,
    };
    return {
        ...g,
        dialogue: [...g.dialogue, line].slice(-80),
        lastActiveAt: Date.now(),
    };
}

function addTurn(game: TheaterTurtleSoupGame, turn: Omit<TurtleSoupTurn, 'no' | 'at'>): TheaterTurtleSoupGame {
    const g = normalizeTurtleSoupGame(game);
    const nextTurn: TurtleSoupTurn = {
        ...turn,
        no: (g.turns[g.turns.length - 1]?.no || 0) + 1,
        at: Date.now(),
    };
    return {
        ...g,
        turns: [...g.turns, nextTurn].slice(-120),
        lastActiveAt: Date.now(),
    };
}

export function applyTurtleSoupQuestion(
    game: TheaterTurtleSoupGame,
    by: string,
    question: string,
    verdict: TurtleSoupVerdict,
): { ok: true; game: TheaterTurtleSoupGame; turn: TurtleSoupTurn; event: TurtleSoupDialogueKind } | { ok: false; reason: string; game: TheaterTurtleSoupGame } {
    const g = normalizeTurtleSoupGame(game);
    if (g.status !== 'playing') return { ok: false, reason: '这碗汤已经结束。', game: g };
    const clean = clampText(question, 180);
    if (!clean) return { ok: false, reason: '先写下要问主持人的问题。', game: g };
    const safeVerdict = sanitizeTurtleSoupVerdict(verdict);
    const hostText = TURTLE_SOUP_VERDICT_LABELS[safeVerdict];
    const withTurn = addTurn(g, {
        by,
        byName: turtleSoupPlayerName(g, by),
        kind: 'question',
        text: clean,
        verdict: safeVerdict,
        hostText,
    });
    const turn = withTurn.turns[withTurn.turns.length - 1];
    const event: TurtleSoupDialogueKind = safeVerdict === 'yes' ? 'answer_yes' : safeVerdict === 'no' ? 'answer_no' : 'irrelevant';
    return {
        ok: true,
        game: { ...withTurn, currentSpeakerId: nextTurtleSoupSpeaker(withTurn, by) },
        turn,
        event,
    };
}

export function applyTurtleSoupFinalGuess(
    game: TheaterTurtleSoupGame,
    by: string,
    guess: string,
    result: TurtleSoupGuessResult,
    hostText?: string,
): { ok: true; game: TheaterTurtleSoupGame; turn: TurtleSoupTurn; event: TurtleSoupDialogueKind } | { ok: false; reason: string; game: TheaterTurtleSoupGame } {
    const g = normalizeTurtleSoupGame(game);
    if (g.status !== 'playing') return { ok: false, reason: '这碗汤已经结束。', game: g };
    const clean = clampText(guess, 260);
    if (!clean) return { ok: false, reason: '先写下你的终猜。', game: g };
    const safeResult = sanitizeTurtleSoupGuessResult(result);
    const feedback = clampText(hostText, 90) || (safeResult === 'correct' ? '答对了。' : safeResult === 'close' ? '很接近，但还差一处关键。' : '不对。');
    const withTurn = addTurn(g, {
        by,
        byName: turtleSoupPlayerName(g, by),
        kind: 'final_guess',
        text: clean,
        result: safeResult,
        hostText: feedback,
    });
    const turn = withTurn.turns[withTurn.turns.length - 1];
    const event: TurtleSoupDialogueKind = safeResult === 'correct' ? 'correct_guess' : safeResult === 'close' ? 'close_guess' : 'wrong_guess';
    const ended = safeResult === 'correct';
    return {
        ok: true,
        game: {
            ...withTurn,
            status: ended ? 'solved' : 'playing',
            currentSpeakerId: ended ? by : nextTurtleSoupSpeaker(withTurn, by),
            solvedById: ended ? by : withTurn.solvedById,
            endedAt: ended ? Date.now() : withTurn.endedAt,
        },
        turn,
        event,
    };
}

export function revealTurtleSoupAnswer(game: TheaterTurtleSoupGame, by = 'host'): TheaterTurtleSoupGame {
    const g = normalizeTurtleSoupGame(game);
    const withTurn = addTurn(g, {
        by,
        byName: turtleSoupPlayerName(g, by),
        kind: 'reveal',
        text: g.case.answer,
        hostText: g.case.answer,
    });
    return {
        ...withTurn,
        status: 'revealed',
        endedAt: Date.now(),
        lastActiveAt: Date.now(),
    };
}

export function endTurtleSoupGame(game: TheaterTurtleSoupGame): TheaterTurtleSoupGame {
    const g = normalizeTurtleSoupGame(game);
    return {
        ...g,
        status: 'ended',
        endedAt: Date.now(),
        lastActiveAt: Date.now(),
    };
}

const tokenize = (text: string): string[] => {
    const normalized = text.toLowerCase();
    const matches = normalized.match(/[\p{Script=Han}]{2,}|[a-z0-9]{3,}/gu) || [];
    const chunks: string[] = [];
    for (const match of matches) {
        chunks.push(match);
        if (/[\p{Script=Han}]/u.test(match) && match.length > 2) {
            for (let i = 0; i < match.length - 1; i++) chunks.push(match.slice(i, i + 2));
        }
    }
    return uniq(chunks);
};

const overlapScore = (text: string, target: string): number => {
    const source = new Set(tokenize(text));
    return tokenize(target).filter(token => source.has(token)).length;
};

export function fallbackTurtleSoupQuestionVerdict(game: TheaterTurtleSoupGame, question: string): { verdict: TurtleSoupVerdict; hostText: string } {
    const g = normalizeTurtleSoupGame(game);
    const q = clampText(question, 180);
    if (!q || /为什么|怎么|解释|提示|答案|谜底|真相/.test(q)) {
        return { verdict: 'irrelevant', hostText: '无关' };
    }
    const negative = /不是|没有|没|并非|无/.test(q);
    const keyOverlap = g.case.keyPoints.reduce((sum, point) => sum + overlapScore(q, point), 0);
    const answerOverlap = overlapScore(q, g.case.answer);
    const redOverlap = (g.case.redHerrings || []).reduce((sum, point) => sum + overlapScore(q, point), 0);
    if (keyOverlap > 0 || answerOverlap >= 2) {
        const verdict: TurtleSoupVerdict = negative ? 'no' : 'yes';
        return { verdict, hostText: TURTLE_SOUP_VERDICT_LABELS[verdict] };
    }
    if (redOverlap > 0 || /鬼|梦|外星|动物|机器人|游戏/.test(q)) {
        return { verdict: 'no', hostText: '否' };
    }
    return { verdict: 'irrelevant', hostText: '无关' };
}

export function fallbackTurtleSoupFinalGuessResult(game: TheaterTurtleSoupGame, guess: string): { result: TurtleSoupGuessResult; hostText: string } {
    const g = normalizeTurtleSoupGame(game);
    const clean = clampText(guess, 300);
    const hits = g.case.keyPoints.filter(point => overlapScore(clean, point) > 0).length;
    const ratio = g.case.keyPoints.length ? hits / g.case.keyPoints.length : 0;
    if (ratio >= 0.7 || overlapScore(clean, g.case.answer) >= 12) return { result: 'correct', hostText: '答对了。' };
    if (ratio >= 0.3 || overlapScore(clean, g.case.answer) >= 5) return { result: 'close', hostText: '很接近，但还差一处关键。' };
    return { result: 'wrong', hostText: '不对。' };
}

export function chooseTurtleSoupCharacterAction(
    game: TheaterTurtleSoupGame,
    playerId: string,
    level: TurtleSoupDifficultyLevel,
): { kind: 'question' | 'final_guess'; text: string } {
    const g = normalizeTurtleSoupGame(game);
    const rank = difficultyRank(level);
    const askedText = g.turns.map(t => t.text).join('\n');
    const remaining = g.case.keyPoints.filter(point => overlapScore(askedText, point) === 0);
    if (rank >= 4 && g.turns.length >= Math.max(2, Math.min(4, g.case.keyPoints.length))) {
        return { kind: 'final_guess', text: g.case.answer };
    }
    if (rank >= 3 && remaining.length <= 1 && g.turns.length >= 3) {
        return { kind: 'final_guess', text: g.case.answer };
    }
    const point = remaining[0] || g.case.keyPoints[g.turns.length % Math.max(1, g.case.keyPoints.length)] || '汤面里的异常';
    if (rank <= 0) {
        const red = g.case.redHerrings?.[0] || '鬼魂';
        return { kind: 'question', text: `这件事和${red}有关吗？` };
    }
    if (rank === 1) return { kind: 'question', text: `这件事主要发生在汤面提到的房间里吗？` };
    return { kind: 'question', text: `这件事和「${point}」有关吗？` };
}

function dialogueEventText(kind: TurtleSoupDialogueKind): string {
    const labels: Record<string, string> = {
        invite: '邀请开局',
        case: '读汤面',
        thinking: '角色思考',
        question: '普通提问',
        answer_yes: '主持回答是',
        answer_no: '主持回答否',
        irrelevant: '主持判无关',
        wrong_guess: '答错',
        close_guess: '接近真相',
        correct_guess: '答对',
        stuck: '猜不出',
        character_question: '角色提问',
        character_guess: '角色终猜',
        solved: '结案',
        reveal: '揭晓真相',
        illegal: '非法输入提示',
        host: '主持回应',
        normal: '普通互动',
    };
    return labels[kind] || kind;
}

export function fallbackTurtleSoupDialogue(kind: TurtleSoupDialogueKind, charName: string): string {
    if (kind === 'thinking') return `${charName}盯着汤面停了几秒，像是在把每个词重新摆位。`;
    if (kind === 'answer_yes') return '是的话，范围就突然窄了很多。';
    if (kind === 'answer_no') return '否，那我刚才那条线得整根划掉。';
    if (kind === 'irrelevant') return '无关……这个方向白走了。';
    if (kind === 'wrong_guess') return '不对？那最怪的地方还没被碰到。';
    if (kind === 'close_guess') return '差一点，我能感觉到答案就在旁边。';
    if (kind === 'correct_guess' || kind === 'solved') return '原来是这样。这个答案比汤面本身还冷。';
    if (kind === 'stuck') return '我卡住了，先别急着揭。';
    if (kind === 'character_question') return '我先问一个能缩小范围的问题。';
    if (kind === 'character_guess') return '我试着把真相拼起来。';
    if (kind === 'reveal') return '揭开以后反而更安静了。';
    if (kind === 'invite') return '来一碗海龟汤？我当心里有数的那种玩家。';
    if (kind === 'illegal') return '这句主持人没法判，换成是或否的问题试试。';
    return '这碗汤的味道有点不对。';
}

export function turtleSoupGameSummary(game: TheaterTurtleSoupGame, limit = 16): string {
    const g = normalizeTurtleSoupGame(game);
    const players = g.players.map(p => p.name).join('、');
    const turns = g.turns.slice(-limit).map(turn => {
        if (turn.kind === 'question') return `${turn.no}. ${turn.byName} 问：${turn.text} / 主持：${turn.hostText || TURTLE_SOUP_VERDICT_LABELS[turn.verdict || 'irrelevant']}`;
        if (turn.kind === 'final_guess') return `${turn.no}. ${turn.byName} 终猜：${turn.text} / ${turn.result}`;
        return `${turn.no}. 揭晓：${turn.text}`;
    }).join('\n');
    return [
        `标题：${g.case.title}`,
        `状态：${g.status}；主持：${g.host.name}；玩家：${players}`,
        `汤面：${g.case.surface}`,
        `最近记录：\n${turns || '暂无'}`,
    ].join('\n');
}

function parseDifficultyResult(raw: any, fallback: TurtleSoupDifficultyLevel) {
    const level = sanitizeTurtleSoupDifficultyLevel(raw?.difficultyLevel || raw?.level, fallback);
    return {
        difficultyLevel: level,
        reason: clampText(raw?.reason, 80) || undefined,
    };
}

export function parseTurtleSoupDifficultyResult(raw: any, fallback: TurtleSoupDifficultyLevel = 'steady') {
    return parseDifficultyResult(raw, fallback);
}

export function parseTurtleSoupCaseResult(raw: any, fallback = fallbackTurtleSoupCase()): TurtleSoupCase {
    return normalizeTurtleSoupCase(raw, fallback);
}

export function parseTurtleSoupHostVerdictResult(raw: any, fallback: { verdict: TurtleSoupVerdict; hostText: string }) {
    const verdict = sanitizeTurtleSoupVerdict(raw?.verdict, fallback.verdict);
    const hostText = TURTLE_SOUP_VERDICT_LABELS[verdict];
    return { verdict, hostText };
}

export function parseTurtleSoupFinalGuessResult(raw: any, fallback: { result: TurtleSoupGuessResult; hostText: string }) {
    const result = sanitizeTurtleSoupGuessResult(raw?.result, fallback.result);
    const hostText = clampText(raw?.hostText, 90) || fallback.hostText;
    return { result, hostText };
}

async function callTurtleSoupJson(
    api: ResolvedApi,
    args: {
        char?: CharacterProfile;
        userName: string;
        system: string;
        user: string;
        maxTokens?: number;
    },
): Promise<any | null> {
    if (!api.baseUrl || !api.model) throw new Error('请先在「文具盒」里配置 API');
    const meta = makeApiUsageMeta('theater.turtleSoup', {
        charId: args.char?.id,
        charName: args.char?.name,
        apiRole: api.apiRole || 'aux',
        apiBinding: api.apiBinding,
    });
    const runtime: any = { meta };
    if (args.char) {
        runtime.presetScope = 'role.scene';
        runtime.presetMacros = { charName: args.char.name, userName: args.userName };
    }
    const data = await callChatCompletion(api, {
        model: api.model,
        messages: [{ role: 'system', content: args.system }, { role: 'user', content: args.user }],
        temperature: 0.72,
        max_tokens: args.maxTokens || 420,
        stream: false,
    }, runtime);
    return extractJson(stripThink(extractContent(data) || ''));
}

async function turtleSoupRoleSystem(char: CharacterProfile, userProfile: UserProfile): Promise<{ core: string; userName: string }> {
    const userName = (userProfile.name || '').trim() || '你';
    const core = await ContextBuilder.buildFullCoreContext(char, userProfile, true);
    return { core, userName };
}

export async function generateTurtleSoupCase(
    hostChar: CharacterProfile | null | undefined,
    userProfile: UserProfile,
    api: ResolvedApi | null | undefined,
    playerChars: CharacterProfile[] = [],
): Promise<{ soupCase: TurtleSoupCase; source: 'llm' | 'fallback' }> {
    const fallback = fallbackTurtleSoupCase(hostChar?.name);
    if (!api?.baseUrl || !api.model) return { soupCase: fallback, source: 'fallback' };
    try {
        const userName = (userProfile.name || '').trim() || '你';
        const playerNames = playerChars.map(c => c.convoSettings?.remarkName?.trim() || c.name).join('、');
        const core = hostChar
            ? (await turtleSoupRoleSystem(hostChar, userProfile)).core
            : await buildFullActiveUserSetting(userProfile, { fallback: `用户名：${userName}` });
        const hostName = hostChar?.name || '汤面主持';
        const raw = await callTurtleSoupJson(api, {
            char: hostChar || undefined,
            userName,
            system: turtleSoupCaseSystem({ core, hostName, userName, playerNames, tone: 'dark' }),
            user: turtleSoupCaseUser({ hostName, userName, playerNames }),
            maxTokens: 620,
        });
        return { soupCase: parseTurtleSoupCaseResult(raw, fallback), source: 'llm' };
    } catch {
        return { soupCase: fallback, source: 'fallback' };
    }
}

export async function decideTurtleSoupOpeningDifficulty(
    char: CharacterProfile,
    userProfile: UserProfile,
    api: ResolvedApi | null | undefined,
    mode: TurtleSoupDifficultyMode,
    invite = false,
): Promise<{ difficultyLevel: TurtleSoupDifficultyLevel; reason?: string; source: 'llm' | 'fallback' }> {
    const fallback = heuristicCharacterTurtleSoupDifficulty(char);
    if (!api?.baseUrl || !api.model) return { difficultyLevel: fallback, source: 'fallback' };
    try {
        const { core, userName } = await turtleSoupRoleSystem(char, userProfile);
        const raw = await callTurtleSoupJson(api, {
            char,
            userName,
            system: turtleSoupDifficultySystem({ core, charName: char.name, userName }),
            user: turtleSoupOpeningDifficultyUser({ mode, charName: char.name, userName, invite }),
        });
        const parsed = parseTurtleSoupDifficultyResult(raw, fallback);
        return { difficultyLevel: parsed.difficultyLevel, reason: parsed.reason, source: 'llm' };
    } catch {
        return { difficultyLevel: fallback, source: 'fallback' };
    }
}

export async function decideTurtleSoupPerMoveDifficulty(
    char: CharacterProfile,
    userProfile: UserProfile,
    api: ResolvedApi | null | undefined,
    game: TheaterTurtleSoupGame,
    playerId: string,
    event: TurtleSoupDialogueKind,
): Promise<{ difficultyLevel: TurtleSoupDifficultyLevel; reason?: string; source: 'llm' | 'fallback' }> {
    const fallback = sanitizeTurtleSoupDifficultyLevel(game.difficultyLevels?.[playerId], heuristicCharacterTurtleSoupDifficulty(char));
    if (!api?.baseUrl || !api.model) return { difficultyLevel: fallback, source: 'fallback' };
    try {
        const { core, userName } = await turtleSoupRoleSystem(char, userProfile);
        const raw = await callTurtleSoupJson(api, {
            char,
            userName,
            system: turtleSoupDifficultySystem({ core, charName: char.name, userName }),
            user: turtleSoupPerMoveDifficultyUser({
                charName: char.name,
                userName,
                difficultyLevel: fallback,
                soup: turtleSoupGameSummary(game),
                event: dialogueEventText(event),
            }),
        });
        const parsed = parseTurtleSoupDifficultyResult(raw, fallback);
        return { difficultyLevel: parsed.difficultyLevel, reason: parsed.reason, source: 'llm' };
    } catch {
        return { difficultyLevel: fallback, source: 'fallback' };
    }
}

export async function judgeTurtleSoupQuestion(
    hostChar: CharacterProfile | null | undefined,
    userProfile: UserProfile,
    api: ResolvedApi | null | undefined,
    game: TheaterTurtleSoupGame,
    question: string,
): Promise<{ verdict: TurtleSoupVerdict; hostText: string; source: 'llm' | 'fallback' }> {
    const fallback = fallbackTurtleSoupQuestionVerdict(game, question);
    if (!api?.baseUrl || !api.model) return { ...fallback, source: 'fallback' };
    try {
        const userName = (userProfile.name || '').trim() || game.userName || '你';
        const core = hostChar
            ? (await turtleSoupRoleSystem(hostChar, userProfile)).core
            : await buildFullActiveUserSetting(userProfile, { fallback: `用户名：${userName}` });
        const raw = await callTurtleSoupJson(api, {
            char: hostChar || undefined,
            userName,
            system: turtleSoupHostJudgeSystem({ core, hostName: game.host.name, userName }),
            user: turtleSoupHostJudgeUser({
                surface: game.case.surface,
                answer: game.case.answer,
                keyPoints: game.case.keyPoints.join('；'),
                history: turtleSoupGameSummary(game, 10),
                question,
            }),
            maxTokens: 160,
        });
        return { ...parseTurtleSoupHostVerdictResult(raw, fallback), source: 'llm' };
    } catch {
        return { ...fallback, source: 'fallback' };
    }
}

export async function judgeTurtleSoupFinalGuess(
    hostChar: CharacterProfile | null | undefined,
    userProfile: UserProfile,
    api: ResolvedApi | null | undefined,
    game: TheaterTurtleSoupGame,
    guess: string,
): Promise<{ result: TurtleSoupGuessResult; hostText: string; source: 'llm' | 'fallback' }> {
    const fallback = fallbackTurtleSoupFinalGuessResult(game, guess);
    if (!api?.baseUrl || !api.model) return { ...fallback, source: 'fallback' };
    try {
        const userName = (userProfile.name || '').trim() || game.userName || '你';
        const core = hostChar
            ? (await turtleSoupRoleSystem(hostChar, userProfile)).core
            : await buildFullActiveUserSetting(userProfile, { fallback: `用户名：${userName}` });
        const raw = await callTurtleSoupJson(api, {
            char: hostChar || undefined,
            userName,
            system: turtleSoupHostJudgeSystem({ core, hostName: game.host.name, userName }),
            user: turtleSoupFinalGuessUser({
                surface: game.case.surface,
                answer: game.case.answer,
                keyPoints: game.case.keyPoints.join('；'),
                history: turtleSoupGameSummary(game, 10),
                guess,
            }),
            maxTokens: 220,
        });
        return { ...parseTurtleSoupFinalGuessResult(raw, fallback), source: 'llm' };
    } catch {
        return { ...fallback, source: 'fallback' };
    }
}

export async function generateTurtleSoupCharacterAction(
    char: CharacterProfile,
    userProfile: UserProfile,
    api: ResolvedApi | null | undefined,
    game: TheaterTurtleSoupGame,
    playerId: string,
    event: TurtleSoupDialogueKind = 'thinking',
): Promise<{ kind: 'question' | 'final_guess'; text: string; source: 'llm' | 'fallback' }> {
    const level = sanitizeTurtleSoupDifficultyLevel(game.difficultyLevels?.[playerId], heuristicCharacterTurtleSoupDifficulty(char));
    const fallback = chooseTurtleSoupCharacterAction(game, playerId, level);
    if (!api?.baseUrl || !api.model) return { ...fallback, source: 'fallback' };
    try {
        const { core, userName } = await turtleSoupRoleSystem(char, userProfile);
        const raw = await callTurtleSoupJson(api, {
            char,
            userName,
            system: turtleSoupCharacterActionSystem({ core, charName: char.name, userName }),
            user: turtleSoupCharacterActionUser({
                charName: char.name,
                difficultyLevel: level,
                soup: turtleSoupGameSummary(game),
                event: dialogueEventText(event),
            }),
            maxTokens: 260,
        });
        const kind = raw?.kind === 'final_guess' ? 'final_guess' : 'question';
        const text = clampText(raw?.text, kind === 'final_guess' ? 260 : 180);
        if (!text) return { ...fallback, source: 'fallback' };
        return { kind, text, source: 'llm' };
    } catch {
        return { ...fallback, source: 'fallback' };
    }
}

export async function generateTurtleSoupDialogue(
    char: CharacterProfile,
    userProfile: UserProfile,
    api: ResolvedApi | null | undefined,
    game: TheaterTurtleSoupGame,
    playerId: string,
    kind: TurtleSoupDialogueKind,
    lastAction = '暂无',
): Promise<string> {
    if (!api?.baseUrl || !api.model) return fallbackTurtleSoupDialogue(kind, char.name);
    try {
        const { core, userName } = await turtleSoupRoleSystem(char, userProfile);
        const raw = await callTurtleSoupJson(api, {
            char,
            userName,
            system: turtleSoupDialogueSystem({ core, charName: char.name, userName }),
            user: turtleSoupDialogueUser({
                charName: char.name,
                userName,
                event: dialogueEventText(kind),
                soup: turtleSoupGameSummary(game),
                difficultyLevel: game.difficultyLevels?.[playerId] || 'steady',
                lastAction,
            }),
            maxTokens: 220,
        });
        const text = clampText((raw as any)?.text || raw, 90);
        return text || fallbackTurtleSoupDialogue(kind, char.name);
    } catch {
        return fallbackTurtleSoupDialogue(kind, char.name);
    }
}
