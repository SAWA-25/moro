/**
 * 「行动选择器」候选生成。
 * ================================
 * 来往·聊天里点最后一轮的 user 头像时，根据最近上下文生成几条「你接下来可以说/做的事」，
 * 让用户从里面挑、改、删、加再发出去。纯手动触发，无开关。
 *
 * 走副 API（resolveAuxApi 已在调用方解析好）；prompt 短、失败抛错由调用方兜底。
 */

import { CharacterProfile, UserProfile, Message } from '../types';
import type { ResolvedApi } from './auxApi';
import { safeResponseJson, extractContent } from './safeApi';

const SYSTEM = [
    '你是“替我想想接下来怎么接话”的助手。下面给你一段两个人的聊天记录，',
    '请站在【我】（user）的角度，想出几条「我接下来可以发给对方的话 / 可以做的小动作」，供我挑选。',
    '要求：',
    '1. 用第一人称、口语，像我自己会打出来的微信消息；每条简短（一般不超过 25 字）。',
    '2. 几条之间方向/语气要拉开差距：可以有顺着聊的、有岔开话题的、有调侃的、有走心的、有提问的、有发起邀约的等等，别都一个味儿。',
    '3. 紧扣最近的聊天内容与气氛，自然承接，不要答非所问。',
    '4. 不要旁白、不要解释、不要引号，只输出内容本身。',
    '只输出一个 JSON 字符串数组，例如：["……","……","……","……"]，不要任何额外文字。',
].join('\n');

/** 从模型输出里宽松抠出字符串数组；失败时按行兜底。 */
function parseActions(raw: string): string[] {
    if (!raw) return [];
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const body = (fenced ? fenced[1] : raw).trim();
    // 1) 优先按 JSON 数组解析
    const start = body.indexOf('[');
    const end = body.lastIndexOf(']');
    if (start >= 0 && end > start) {
        try {
            const arr = JSON.parse(body.slice(start, end + 1));
            if (Array.isArray(arr)) {
                return arr.map(x => String(x).trim()).filter(Boolean);
            }
        } catch { /* 落到按行兜底 */ }
    }
    // 2) 兜底：按行拆，去掉序号 / 引号 / 项目符号
    return body
        .split(/\r?\n/)
        .map(l => l.replace(/^\s*[-*•\d.、)）"'“”\[\]]+\s*/, '').replace(/["'“”]+$/g, '').trim())
        .filter(Boolean);
}

function recentTranscript(recent: Message[], charName: string, userName: string): string {
    return recent
        .filter(m => m.role !== 'system' && typeof m.content === 'string' && m.content.trim())
        .slice(-12)
        .map(m => `${m.role === 'user' ? userName : charName}：${String(m.content).slice(0, 160)}`)
        .join('\n');
}

/** 生成若干条「我接下来可以发的话」候选（默认 4 条）。 */
export async function suggestUserActions(args: {
    api: ResolvedApi;
    char: CharacterProfile;
    userProfile: UserProfile;
    recent: Message[];
    count?: number;
    signal?: AbortSignal;
}): Promise<string[]> {
    const { api, char, userProfile, recent, count = 4, signal } = args;
    const baseUrl = (api.baseUrl || '').replace(/\/+$/, '');
    if (!baseUrl || !api.model) throw new Error('请先在「文具盒」里配置 API');
    const userName = (userProfile.name || '').trim() || '我';
    const transcript = recentTranscript(recent, char.name, userName);
    const userMsg = [
        `对方是「${char.name}」，我是「${userName}」。`,
        '',
        '最近的聊天：',
        transcript || '（你们还没怎么聊过，给我几条自然的开场/搭话）',
        '',
        `请给我 ${count} 条接下来可以发的话（JSON 字符串数组）。`,
    ].join('\n');

    const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${api.apiKey || 'sk-none'}` },
        body: JSON.stringify({
            model: api.model,
            messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: userMsg }],
            temperature: 1.0,
            max_tokens: 400,
            stream: false,
        }),
        signal,
    });
    if (!res.ok) throw new Error(`API ${res.status}`);
    const data = await safeResponseJson(res);
    const actions = parseActions(extractContent(data) || '');
    // 去重 + 截断
    const seen = new Set<string>();
    const out: string[] = [];
    for (const a of actions) {
        const t = a.trim();
        if (!t || seen.has(t)) continue;
        seen.add(t);
        out.push(t);
        if (out.length >= count) break;
    }
    return out;
}
