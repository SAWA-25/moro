/**
 * 折子戏·真心话大冒险（玖）——引擎。
 * ================================
 * 和角色们围一圈转瓶子：每轮转瓶子选一个「受题者」，TA 挑真心话 / 大冒险，
 * 另一个人出题，受题者当场作答 / 执行。user 与 AI 都能当受题者 / 出题者。
 *
 * 本文件只管「纯函数（转瓶子 / 选出题者 / 上下文拼接）」与「三类 AI 调用」：
 *   ① 给 user 出题（某角色向 user 抛题）
 *   ② 角色整轮（角色自己挑 + 被出题 + 作答，一次 JSON 拿全）
 *   ③ 角色答 user 出的题
 * UI 流程在 apps/theater/TruthDareApp.tsx。复用主/副 API（调用方 resolveAuxApi 解析好）。
 * 解析失败一律退回兜底文案，绝不卡死。📌 prompt 文案在 utils/theaterPrompts.ts（[玖] 区段）。
 */

import { CharacterProfile, UserProfile, TruthDareSession, TruthDarePlayer, TruthDareKind, TruthDareSpice } from '../types';
import type { ResolvedApi } from './auxApi';
import { ContextBuilder } from './context';
import { extractContent, extractJson } from './safeApi';
import { truthDareSystem, truthDarePoseUser, truthDareCharRoundUser, truthDareAnswerUser } from './theaterPrompts';
import { callChatCompletion } from './llmClient';
import { makeApiUsageMeta } from './apiUsageCatalog';

export const TD_KIND_CN: Record<TruthDareKind, string> = { truth: '真心话', dare: '大冒险' };
export const TD_KIND_EMOJI: Record<TruthDareKind, string> = { truth: '💬', dare: '🔥' };
export const TD_SPICE_LABEL: Record<TruthDareSpice, string> = { light: '轻松', flirty: '暧昧', bold: '大胆' };
export const TD_SPICE_DESC: Record<TruthDareSpice, string> = {
    light: '温馨好笑，朋友间的尺度',
    flirty: '带点心动与调侃',
    bold: '敢爱敢恨、火辣直接（点到为止）',
};

const genId = () => `td_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const pick = <T,>(arr: T[]): T | undefined => arr[Math.floor(Math.random() * arr.length)];

export const USER_ID = 'user';

/** 开局：user + 所选角色围成一圈。 */
export function createTruthDareSession(userName: string, userAvatar: string | undefined, chars: CharacterProfile[], spice: TruthDareSpice): TruthDareSession {
    const players: TruthDarePlayer[] = [
        { id: USER_ID, name: userName || '你', isUser: true, avatar: userAvatar },
        ...chars.map(c => ({ id: c.id, name: c.name, isUser: false, charId: c.id, avatar: c.avatar })),
    ];
    const now = Date.now();
    return {
        id: genId(),
        title: `${new Date(now).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })} 的一圈`,
        createdAt: now, lastActiveAt: now, players, spice, rounds: [],
    };
}

export const playerById = (s: TruthDareSession, id: string) => s.players.find(p => p.id === id);

/** 转瓶子：随机选一个受题者（可含 user）。 */
export function spinBottle(s: TruthDareSession): TruthDarePlayer {
    return pick(s.players) as TruthDarePlayer;
}

/** 选出题者：受题者之外随机一人；preferChar=true 时尽量挑个角色来出题。 */
export function pickPoser(s: TruthDareSession, exceptId: string, preferChar = false): TruthDarePlayer {
    const others = s.players.filter(p => p.id !== exceptId);
    if (preferChar) {
        const chars = others.filter(p => !p.isUser);
        if (chars.length) return pick(chars) as TruthDarePlayer;
    }
    return (pick(others) as TruthDarePlayer) ?? others[0];
}

/** 最近几轮的内容，拼给 prompt 当上下文。 */
export function recentText(s: TruthDareSession, n = 4): string {
    return s.rounds.slice(-n).map(r =>
        `· ${r.targetName} 选了${TD_KIND_CN[r.kind]}，${r.poserName} 问：${r.challenge} → ${r.targetName}：${r.answer}`,
    ).join('\n');
}

// ── LLM ────────────────────────────────────────────────────────────────────
async function systemFor(char: CharacterProfile, userProfile: UserProfile, spice: TruthDareSpice): Promise<string> {
    const core = await ContextBuilder.buildFullCoreContext(char, userProfile, true);
    const userName = (userProfile?.name || '').trim() || '对方';
    return truthDareSystem({ core, charName: char.name, userName, spice });
}

async function callRaw(api: ResolvedApi, system: string, user: string, maxTokens = 500): Promise<string> {
    if (!api.baseUrl || !api.model) throw new Error('请先在「文具盒」里配置 API');
    const data = await callChatCompletion(api, {
        model: api.model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        temperature: 0.95,
        max_tokens: maxTokens,
        stream: false,
    }, {
        meta: makeApiUsageMeta('theater.truthDare', {
            apiRole: api.apiRole || 'aux',
            apiBinding: api.apiBinding,
        }),
    });
    return (extractContent(data) || '').trim();
}

const findChar = (chars: CharacterProfile[], id?: string) => chars.find(c => c.id === id);

/** ① 给 user 出题：poser（角色）向 user 抛一道真心话 / 大冒险。 */
export async function genUserChallenge(
    s: TruthDareSession, poser: TruthDarePlayer, kind: TruthDareKind,
    api: ResolvedApi, chars: CharacterProfile[], userProfile: UserProfile,
): Promise<string> {
    const poserChar = findChar(chars, poser.charId);
    const userName = (userProfile?.name || '').trim() || '你';
    if (!poserChar) return kind === 'truth' ? '说说看，你现在最不敢告诉别人的一个小秘密是什么？' : '学一段刚才在场某个人说话的样子，要像！';
    const sys = await systemFor(poserChar, userProfile, s.spice);
    const user = truthDarePoseUser({ poserName: poser.name, targetName: userName, kind, spice: s.spice, recent: recentText(s) });
    try { return (await callRaw(api, sys, user, 300)) || '（题面卡住了，再转一次吧）'; }
    catch { return kind === 'truth' ? '老实交代，这一圈里你最想跟谁多待一会儿？' : '现场比一个你觉得最像自己的表情，保持十秒。'; }
}

/** ② 角色整轮：target 当受题者——自己挑、被 poser 出题、再作答，一次拿全。 */
export async function genCharRound(
    s: TruthDareSession, target: TruthDarePlayer, poser: TruthDarePlayer,
    api: ResolvedApi, chars: CharacterProfile[], userProfile: UserProfile, forcedKind?: TruthDareKind,
): Promise<{ kind: TruthDareKind; challenge: string; answer: string }> {
    const targetChar = findChar(chars, target.charId);
    const fallback = { kind: (forcedKind || (Math.random() < 0.5 ? 'truth' : 'dare')) as TruthDareKind, challenge: '（大家起哄让 TA 来一个）', answer: `${target.name} 笑着应付了过去。` };
    if (!targetChar) return fallback;
    const sys = await systemFor(targetChar, userProfile, s.spice);
    const user = truthDareCharRoundUser({ targetName: target.name, poserName: poser.name, spice: s.spice, recent: recentText(s), forcedKind });
    try {
        const j = extractJson(await callRaw(api, sys, user, 600));
        const kind: TruthDareKind = (j?.kind === 'dare' || j?.kind === 'truth') ? j.kind : fallback.kind;
        const challenge = (typeof j?.challenge === 'string' && j.challenge.trim()) || fallback.challenge;
        const answer = (typeof j?.answer === 'string' && j.answer.trim()) || fallback.answer;
        return { kind: forcedKind || kind, challenge, answer };
    } catch { return fallback; }
}

/** ③ 角色答 user 出的题。 */
export async function genCharAnswer(
    s: TruthDareSession, target: TruthDarePlayer, kind: TruthDareKind, challenge: string,
    api: ResolvedApi, chars: CharacterProfile[], userProfile: UserProfile,
): Promise<string> {
    const targetChar = findChar(chars, target.charId);
    const userName = (userProfile?.name || '').trim() || '你';
    if (!targetChar) return `${target.name} 认真地完成了。`;
    const sys = await systemFor(targetChar, userProfile, s.spice);
    const user = truthDareAnswerUser({ targetName: target.name, userName, kind, challenge, spice: s.spice, recent: recentText(s) });
    try { return (await callRaw(api, sys, user, 400)) || `${target.name} 红着脸照做了。`; }
    catch { return kind === 'truth' ? `${target.name} 想了想，还是诚实地点了点头。` : `${target.name} 鼓起勇气完成了挑战。`; }
}
