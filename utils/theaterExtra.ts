/**
 * 小剧场·番外 —— 生成逻辑（走副 API）。
 * ============================================
 * 提供几类「番外」内容的生成：
 *  - 问卷番外：系统一题一题出题（恋爱相性100问 / MBTI / 价值观 / 性癖 / 无厘头…，
 *    用户输入想要的问卷名即可），角色作答 + 用户作答，做完为止；
 *  - 贴吧/论坛帖番外、聊天记录番外、热梗番外：一次性生成一段主题内容。
 *
 * 纯函数，UI 在 apps/theater/ExtraApp.tsx。失败抛错由调用方兜底。
 * 📌 全部 prompt 文案集中在 utils/theaterPrompts.ts（[贰] 番外 区段），改文案去那里。
 */

import type { CharacterProfile, UserProfile } from '../types';
import type { ResolvedApi } from './auxApi';
import { extractJson } from './safeApi';
import { llmComplete } from './llmComplete';
import {
    EXTRA_QUIZ_QUESTION_SYS, extraQuizQuestionUser, extraQuizAnswerSys, extraQuizAnswerUser,
    extraPiecePrompt, extraFauxPrompt,
} from './theaterPrompts';

/** 聊天补全（去思维链，按需续写）。短问答 / JSON 不续写；长篇番外传 continueRounds 自动写完。 */
async function chat(api: ResolvedApi, messages: { role: string; content: string }[], opts?: { temperature?: number; maxTokens?: number; signal?: AbortSignal; continueRounds?: number }): Promise<string> {
    return llmComplete(api, messages, {
        temperature: opts?.temperature ?? 0.9,
        maxTokens: opts?.maxTokens ?? 900,
        continueRounds: opts?.continueRounds,
        signal: opts?.signal,
    });
}

/** 从问卷名里尽量解析题量（如「恋爱相性100问」「性癖测试50题」），解析不到给 50（且不少于 50）。 */
export function inferQuestionCount(topic: string, fallback = 50): number {
    const m = (topic || '').match(/(\d{1,3})\s*(?:问|题|道|个)/);
    if (m) {
        const n = parseInt(m[1], 10);
        if (isFinite(n) && n > 0) return Math.min(Math.max(n, 1), 200);
    }
    return Math.max(fallback, 50);
}

/** 去掉模型给题目带的序号/引号/前缀，只留题干。 */
function cleanQuestion(s: string): string {
    return (s || '')
        .replace(/^\s*(?:第?\s*\d+\s*[\.、:：)）]\s*|[-*•]\s*|Q\d*[\.:：]?\s*)/i, '')
        .replace(/^["'“”]+|["'“”]+$/g, '')
        .trim();
}

/**
 * 出下一题。基于问卷主题 + 已出过的题（避免重复），一次只出一题。
 */
export async function genNextQuestion(args: {
    api: ResolvedApi; topic: string; index: number; total: number; asked: string[];
    /** 你写好的题库题目（来自 theaterExtraBank）。本题在范围内就直接取，不走 AI。 */
    bankQuestions?: string[];
    signal?: AbortSignal;
}): Promise<string> {
    const { api, topic, index, total, asked, bankQuestions, signal } = args;
    // 题库优先：本题落在你写的题库范围内，就直接用你的题，不调用 AI 出题。
    if (bankQuestions && index < bankQuestions.length) {
        const q = cleanQuestion(bankQuestions[index] || '');
        if (q) return q;
    }
    const recent = asked.slice(-12).map((q, i) => `${asked.length - Math.min(12, asked.length) + i + 1}. ${q}`).join('\n');
    const raw = await chat(api, [
        { role: 'system', content: EXTRA_QUIZ_QUESTION_SYS },
        { role: 'user', content: extraQuizQuestionUser({ topic, index, total, recent }) },
    ], { temperature: 0.95, maxTokens: 500, signal });
    return cleanQuestion(raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean)[0] || raw) || `（第 ${index + 1} 题生成失败，点重试）`;
}

/** 角色按人设作答某一题。 */
export async function genCharAnswer(args: {
    api: ResolvedApi; char: CharacterProfile; userProfile: UserProfile; topic: string; question: string; signal?: AbortSignal;
}): Promise<string> {
    const { api, char, userProfile, topic, question, signal } = args;
    const userName = (userProfile?.name || '').trim() || '对方';
    return (await chat(api, [
        { role: 'system', content: extraQuizAnswerSys({ charName: char.name, topic, description: char.description || '', userName }) },
        { role: 'user', content: extraQuizAnswerUser({ charName: char.name, question }) },
    ], { temperature: 0.9, maxTokens: 800, signal })) || '……（TA 没说话）';
}

export type ExtraKind = 'tieba' | 'chatlog' | 'meme' | 'custom';

/** 一次性生成一段主题番外（贴吧帖 / 聊天记录 / 热梗 / 自定义）。 */
export async function genExtraPiece(args: {
    api: ResolvedApi; kind: ExtraKind; char: CharacterProfile; userProfile: UserProfile; prompt?: string; signal?: AbortSignal;
}): Promise<string> {
    const { api, kind, char, userProfile, prompt, signal } = args;
    const userName = (userProfile?.name || '').trim() || '我';
    const { sys, user } = extraPiecePrompt({ kind, charName: char.name, description: char.description || '', prompt, userName });
    // 番外指令常要求「不少于 5000/10000 字」的长篇——大幅放宽 max_tokens，并在被长度截断时自动续写写完。
    return (await chat(api, [{ role: 'system', content: sys }, { role: 'user', content: user }], { temperature: 1.0, maxTokens: 4096, continueRounds: 5, signal })) || '（这次没生成出来，换个说法再试试）';
}

// ── 仿真图文番外（结构化 JSON，UI 渲染成仿微信/朋友圈/小红书/论坛） ──────────────

export type FauxKind = 'wechat' | 'moments' | 'xhs' | 'forum';

/** 仿真番外结果：解析成功给 data，失败给 fallbackText（UI 退回纯文本展示）。 */
export interface FauxResult {
    kind: FauxKind;
    data: any | null;
    fallbackText: string;
}

/**
 * 生成一段仿真图文番外，返回结构化 JSON（供 UI 仿真渲染）。
 * 失败或解析不出 JSON 时，data=null + fallbackText 原文，UI 退回纯文本。
 */
export async function genFauxPiece(args: {
    api: ResolvedApi; kind: FauxKind; char: CharacterProfile; userProfile: UserProfile; keyword?: string; signal?: AbortSignal;
}): Promise<FauxResult> {
    const { api, kind, char, userProfile, keyword, signal } = args;
    const userName = (userProfile?.name || '').trim() || '我';
    const { sys, user } = extraFauxPrompt({ kind, charName: char.name, description: char.description || '', userName, userBio: userProfile?.bio || '', keyword });
    const raw = await chat(api, [{ role: 'system', content: sys }, { role: 'user', content: user }], { temperature: 0.95, maxTokens: 2600, signal });
    const data = extractJson(raw);
    return { kind, data: data ?? null, fallbackText: raw || '（这次没生成出来，换个关键词再试试）' };
}

