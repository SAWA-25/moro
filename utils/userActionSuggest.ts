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
    '4. 每条只写「我会打出来的那句话本身」。严禁加任何标签 / 前缀 / 说明，',
    '   尤其不要写 “Tone 1: Casual/”“*Tone 2: Playful/”“语气X：”“【调侃】”“风格：走心” 这类语气或方向标注，',
    '   也不要旁白、解释、引号、星号、Markdown、序号。语言跟随聊天记录（中文聊天就全中文）。',
    '5. 必须给满我要求的条数（不少于 4 条），宁可多想几条也别偷懒少给。',
    '只输出一个 JSON 字符串数组，每个元素就是纯粹的一句话，例如：["在干嘛呀","你是不是在忙","刚才那事我想了想……"]，不要任何额外文字。',
].join('\n');

/**
 * 剥掉模型偶尔泄漏在每条候选开头的「语气/方向标签」前缀。
 * 实测模型有时会在数组元素里塞 “*Tone 2: Playful/ 你在忙吗”“语气1：在干嘛”“【调侃】…”，
 * JSON 解析路径不会处理这些，导致选项里出现 “*Tone 2: Playful/” 这种半截标签。这里统一清掉。
 */
function stripLabel(input: string): string {
    let t = (input || '').trim();
    if (!t) return '';
    // 成对的 markdown 加粗/斜体包裹整句时去掉
    t = t.replace(/^\*\*([\s\S]*)\*\*$/, '$1').replace(/^\*([\s\S]*)\*$/, '$1').trim();
    const labelPatterns: RegExp[] = [
        /^[*\-•·–—]+\s*/,                                                                 // 项目符号 / 星号
        /^tone\s*\d*\s*[:：][^/／\n]*[\/／]\s*/i,                                          // Tone 2: Playful/
        /^(casual|playful|serious|flirty|teasing|caring|sincere|funny|warm|sweet|cool|honest|direct|soft)\b\s*[:：/／-]?\s*/i,
        /^(语气|方向|风格|选项|路线|类型|方案)\s*[0-9一二三四五六七八九十]*\s*[)）.、:：/／-]\s*/,   // 语气1： 方向二、
        /^[【\[（(][^】\]）)]{0,12}[】\]）)]\s*/,                                          // 【调侃】[走心]（提问）
        /^\d{1,2}\s*[.)、）]\s+/,                                                          // 1. 2) 3、（仅列表序号，不吃「12:30」这类时间）
    ];
    let changed = true;
    while (changed) {
        changed = false;
        for (const re of labelPatterns) {
            const next = t.replace(re, '');
            if (next !== t) { t = next.trim(); changed = true; }
        }
    }
    return t.replace(/^["'“”]+/, '').replace(/["'“”]+$/, '').trim();
}

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
                return arr
                    .map(x => {
                        // 兼容模型偶尔吐出对象 {text:"…"} / {content:"…"} 的情况
                        if (x && typeof x === 'object') {
                            const v = (x as any).text ?? (x as any).content ?? (x as any).message ?? '';
                            return stripLabel(String(v));
                        }
                        return stripLabel(String(x));
                    })
                    .filter(Boolean);
            }
        } catch { /* 落到按行兜底 */ }
    }
    // 2) 兜底：按行拆，去掉序号 / 引号 / 项目符号 / 泄漏的语气标签
    return body
        .split(/\r?\n/)
        .map(l => stripLabel(l))
        .filter(Boolean);
}

function recentTranscript(recent: Message[], charName: string, userName: string): string {
    return recent
        .filter(m => m.role !== 'system' && typeof m.content === 'string' && m.content.trim())
        .slice(-12)
        .map(m => `${m.role === 'user' ? userName : charName}：${String(m.content).slice(0, 160)}`)
        .join('\n');
}

/** 生成若干条「我接下来可以发的话」候选（默认 6 条，至少 4 条）。 */
export async function suggestUserActions(args: {
    api: ResolvedApi;
    char: CharacterProfile;
    userProfile: UserProfile;
    recent: Message[];
    count?: number;
    signal?: AbortSignal;
}): Promise<string[]> {
    const { api, char, userProfile, recent, count = 6, signal } = args;
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
