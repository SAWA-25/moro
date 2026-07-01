/**
 * llmComplete —— 折子戏/副 API 的统一「聊天补全」入口（OpenAI 兼容）。
 * ============================================================================
 * 解决两类截断：
 *  1) 思维链吃 token：推理模型先在 <think> 里消耗一大截预算，正文解读/番外被 max_tokens 砍半句；
 *  2) 长篇番外：用户的「番外指令」常要求「不少于 5000/10000 字」，单次回复装不下。
 *
 * 做法：调一次 chat/completions；若服务端回 finish_reason='length'（被长度截断）且已有可见正文，
 * 就把已写内容回灌、追加一句「接着写」，最多续 continueRounds 轮，拼成完整结果。
 *  · continueRounds 默认 0 = 不续写（短问答 / 结构化 JSON 场景用）。
 *  · 返回值已去掉 <think> 思维链（含被截断的残缺 think）。
 *
 * interpret.ts（解牌）、theaterExtra.ts（番外）都从这里取，别再各自内联 fetch+stripThink。
 */

import type { ResolvedApi } from './auxApi';
import type { ApiCallMeta } from './apiCallLog';
import { safeResponseJson, extractContent } from './safeApi';

export interface ChatMsg { role: string; content: string }

export interface CompleteOptions {
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
    /** 回复因长度被截断（finish_reason='length'）时自动「接着写」的最大续写轮数。默认 0（不续写）。 */
    continueRounds?: number;
    /** API 后台流水标注。 */
    meta?: ApiCallMeta;
}

/** 去思维链：成对 <think>…</think>，以及被 max_tokens 截断、没收尾的残缺 <think>…（到结尾）。 */
export function stripThink(s: string): string {
    return (s || '')
        .replace(/<(think|thinking|thought)>[\s\S]*?<\/\1>/gi, '')
        .replace(/<(?:think|thinking|thought)>[\s\S]*$/i, '')
        .trim();
}

/**
 * 启发式判断一段正文是否「像被截断了」（没写完）。
 * 用于代理不回 finish_reason（很多 OpenAI 兼容代理 stream:false 下不给 / 给 null）时兜底续写：
 * 正常收尾的文字会以句末标点 / 引号 / 收尾括号结束；停在汉字、逗号、半个词上 → 多半被砍。
 */
function looksTruncated(s: string): boolean {
    const t = (s || '').replace(/\s+$/, '');
    if (!t) return false;
    // 句末/收尾字符：中英文句号问号叹号省略号、引号、各类收尾括号、收尾书名号
    return !/[。．.!！?？…⋯”’"'」』）)\]】〉》>~～—]$/.test(t);
}

/** 调一次 chat/completions，回 { 可见正文, finish_reason }。 */
async function callOnce(
    api: ResolvedApi,
    messages: ChatMsg[],
    opts: CompleteOptions,
): Promise<{ content: string; finishReason: string | null }> {
    const baseUrl = (api.baseUrl || '').replace(/\/+$/, '');
    if (!baseUrl || !api.model) throw new Error('请先在「文具盒」里配置 API');
    const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${api.apiKey || 'sk-none'}` },
        body: JSON.stringify({
            model: api.model,
            messages,
            temperature: opts.temperature ?? 0.85,
            max_tokens: opts.maxTokens ?? 1200,
            stream: false,
        }),
        signal: opts.signal,
        ...(opts.meta ? { __moroMeta: opts.meta } : {}),
    } as RequestInit & { __moroMeta?: unknown });
    if (!res.ok) throw new Error(`API ${res.status}`);
    const data = await safeResponseJson(res);
    const finishReason: string | null = data?.choices?.[0]?.finish_reason ?? null;
    return { content: extractContent(data) || '', finishReason };
}

/**
 * 聊天补全；按需自动续写（finish_reason='length' 时）。返回拼好的完整正文（已去思维链）。
 */
export async function llmComplete(api: ResolvedApi, messages: ChatMsg[], opts: CompleteOptions = {}): Promise<string> {
    const rounds = Math.max(0, opts.continueRounds ?? 0);
    let convo = messages.slice();
    let full = '';
    for (let round = 0; round <= rounds; round++) {
        const { content, finishReason } = await callOnce(api, convo, opts);
        const chunk = stripThink(content);
        full += chunk;
        // 是否还需续写：被长度截断（finish_reason='length'），
        // 或代理没给 finish_reason（null/undefined）但正文像是停在半句上（启发式兜底）。
        // 注意：finish_reason 明确是 'stop' 等正常收尾时，一律信任、不强续。
        const needMore = finishReason === 'length'
            || (finishReason == null && looksTruncated(full));
        // 收尾条件：不需要续写 / 没拿到可见增量 / 已用尽续写轮数
        if (!needMore || !chunk.trim() || round === rounds) break;
        convo = [
            ...convo,
            { role: 'assistant', content: chunk },
            { role: 'user', content: '直接从刚才断开的地方接着写下去，自然衔接，不要重复已经写过的内容，不要任何前缀、说明或重新开头。' },
        ];
    }
    return full;
}
