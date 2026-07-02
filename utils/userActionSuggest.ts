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
import { extractContent, extractJson } from './safeApi';
import { USER_ACTION_SUGGEST_SYSTEM, userActionSuggestUserPrompt } from './laiwangPrompts';
import { callChatCompletion } from './llmClient';
import { makeApiUsageMeta } from './apiUsageCatalog';

// 文案见 utils/laiwangPrompts.ts → [6] 行动建议
const SYSTEM = USER_ACTION_SUGGEST_SYSTEM;

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

/** 从模型输出里宽松抠出字符串数组；JSON 截断 / 失败时尽力打捞，再按行兜底。
 *  exported 供单测（修复「```json / [ / 半截串」漏成选项的 bug）。 */
export function parseActions(raw: string): string[] {
    if (!raw) return [];
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const body = (fenced ? fenced[1] : raw).trim();

    const fromArray = (arr: any[]): string[] => arr
        .map(x => {
            // 兼容模型偶尔吐出对象 {text:"…"} / {content:"…"} 的情况
            if (x && typeof x === 'object') {
                const v = (x as any).text ?? (x as any).content ?? (x as any).message ?? '';
                return stripLabel(String(v));
            }
            return stripLabel(String(x));
        })
        .filter(Boolean);

    // 1) 优先用通用 JSON 容错解析（处理 ```fence```、尾逗号、单引号、未转义内引号等）
    const parsed = extractJson(body);
    if (Array.isArray(parsed)) return fromArray(parsed);
    // 模型有时把数组包进对象：{"actions":[…]} / {"suggestions":[…]} / {"options":[…]}
    if (parsed && typeof parsed === 'object') {
        const arr = Object.values(parsed).find(v => Array.isArray(v));
        if (Array.isArray(arr)) { const r = fromArray(arr); if (r.length) return r; }
    }

    // 2) JSON 被 max_tokens 截断（缺收尾 ]）时，打捞数组里已完整的字符串元素，
    //    丢掉最后那截没闭合的半句——避免把 ```json、[、半截串当成选项漏出来。
    const start = body.indexOf('[');
    if (start >= 0) {
        const slice = body.slice(start + 1);
        const salvaged: string[] = [];
        // 逐个匹配「成对引号」的字符串字面量（允许 \" 转义），未闭合的尾串自然不被匹配
        const re = /"((?:[^"\\]|\\.)*)"/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(slice)) !== null) {
            try { salvaged.push(stripLabel(JSON.parse(`"${m[1]}"`))); }
            catch { salvaged.push(stripLabel(m[1])); }
        }
        const cleaned = salvaged.filter(Boolean);
        if (cleaned.length) return cleaned;
    }

    // 3) 最后兜底：按行拆，去掉序号 / 引号 / 项目符号 / 泄漏标签 / JSON 残骸
    return body
        .split(/\r?\n/)
        .map(l => stripLabel(l))
        .map(l => l.replace(/^```(?:json)?$/i, '').replace(/^[\[\]{},]+$/g, '').trim())
        .filter(l => l && !/^```/.test(l));
}

function recentTranscript(recent: Message[], charName: string, userName: string): string {
    return recent
        .filter(m => m.role !== 'system' && typeof m.content === 'string' && m.content.trim())
        .slice(-12)
        .map(m => `${m.role === 'user' ? userName : charName}：${String(m.content).slice(0, 160)}`)
        .join('\n');
}

/** 保底真实候选条数：少于这个数就再要一轮补齐（与 UI 的 MIN_OPTIONS 对齐）。 */
const MIN_REQUIRED = 4;

/** 单次向模型要候选并解析（内部用，suggestUserActions 负责补齐到 MIN_REQUIRED）。 */
async function requestActionsOnce(args: {
    api: ResolvedApi;
    char: CharacterProfile;
    userName: string;
    transcript: string;
    count: number;
    avoid: string[];
    signal?: AbortSignal;
}): Promise<string[]> {
    const { api, char, userName, transcript, count, avoid, signal } = args;
    const userMsg = userActionSuggestUserPrompt({ charName: char.name, userName, transcript, count, avoid });

    const data = await callChatCompletion(api, {
        model: api.model,
        // 给足额度：思考型模型（gemini-3.1-pro 等）会先用掉一大截 token 推理，
        // 1000 常被推理吃光、正文 JSON 数组被截断 → 解析为空 → 前台「没想出来」。
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: userMsg }],
        temperature: 1.0,
        max_tokens: 4000,
        stream: false,
    }, {
        signal,
        meta: makeApiUsageMeta('chat.userActionSuggest', {
            apiRole: api.apiRole || 'aux',
            apiBinding: api.apiBinding,
            charId: char.id,
            charName: char.name,
        }),
    });
    return parseActions(extractContent(data) || '');
}

/**
 * 生成若干条「我接下来可以发的话」候选（默认目标 6 条，**保底至少 4 条真候选**）。
 * 单轮模型少给 / 截断时，自动再要一轮补齐到 MIN_REQUIRED，避免出现「只有两条 + 两个空槽」。
 */
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

    const seen = new Set<string>();
    const out: string[] = [];
    const target = Math.max(count, MIN_REQUIRED);
    // 第一轮要满 target；只有「还没到保底 MIN_REQUIRED」时才补轮（最多再补 2 轮），
    // 避免为了凑满 6 条无限要——到 4 条即可收手，剩下交给 UI 的空槽。
    const MAX_ROUNDS = 3;
    let lastErr: any = null;
    for (let round = 0; round < MAX_ROUNDS; round++) {
        // 第一轮无条件要；之后只在「不足保底」时继续补
        if (round > 0 && out.length >= MIN_REQUIRED) break;
        const need = Math.max(target - out.length, MIN_REQUIRED);
        try {
            const actions = await requestActionsOnce({
                api, char, userName, transcript, count: need, avoid: out, signal,
            });
            const before = out.length;
            for (const a of actions) {
                const t = a.trim();
                if (!t || seen.has(t)) continue;
                seen.add(t);
                out.push(t);
                if (out.length >= target) break;
            }
            // 这一轮一条新的都没补进来：再要也多半还是空，收手
            if (out.length === before) break;
        } catch (e) {
            lastErr = e;
            break; // 网络/接口错误：把已有的返回（可能为空，调用方兜底）
        }
    }
    // 一条都没有且确实报错过 → 把错误抛给调用方（保留它的 toast 文案）
    if (out.length === 0 && lastErr) throw lastErr;
    return out;
}
