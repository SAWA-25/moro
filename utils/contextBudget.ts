/**
 * Chat/context request budgeting.
 *
 * Upstream models still have a hard context window even when the app should not
 * impose a user-facing word limit. This module trims only the payload sent to
 * the model: old history first, and bulky media payloads before recent text.
 */

export type ApiMessage = { role: string; content: any; [key: string]: any };

const DEFAULT_MAX_REQUEST_CHARS = 520_000;
const DEFAULT_PROTECTED_TAIL = 12;
const COMPACT_IMAGE_CHARS = 2_000;
export const MAIN_CHAT_CONTEXT_BUDGET_ENABLED_KEY = 'moro_main_context_budget_enabled';
export const AUX_CHAT_CONTEXT_BUDGET_ENABLED_KEY = 'moro_aux_context_budget_enabled';
const LEGACY_CHAT_CONTEXT_BUDGET_ENABLED_KEY = 'moro_chat_context_budget_enabled';

function readContextBudgetEnabled(key: string): boolean {
    try {
        if (typeof localStorage === 'undefined') return true;
        const value = localStorage.getItem(key);
        if (value !== null) return value !== '0';
        return localStorage.getItem(LEGACY_CHAT_CONTEXT_BUDGET_ENABLED_KEY) !== '0';
    } catch {
        return true;
    }
}

function writeContextBudgetEnabled(key: string, enabled: boolean): void {
    try {
        if (typeof localStorage === 'undefined') return;
        localStorage.setItem(key, enabled ? '1' : '0');
    } catch {
        // localStorage may be unavailable in private/webview modes; fail open.
    }
}

export function isMainContextBudgetEnabled(): boolean {
    return readContextBudgetEnabled(MAIN_CHAT_CONTEXT_BUDGET_ENABLED_KEY);
}

export function setMainContextBudgetEnabled(enabled: boolean): void {
    writeContextBudgetEnabled(MAIN_CHAT_CONTEXT_BUDGET_ENABLED_KEY, enabled);
}

export function isAuxContextBudgetEnabled(): boolean {
    return readContextBudgetEnabled(AUX_CHAT_CONTEXT_BUDGET_ENABLED_KEY);
}

export function setAuxContextBudgetEnabled(enabled: boolean): void {
    writeContextBudgetEnabled(AUX_CHAT_CONTEXT_BUDGET_ENABLED_KEY, enabled);
}

function readNumberStorage(key: string): number | null {
    try {
        if (typeof localStorage === 'undefined') return null;
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const n = parseInt(raw, 10);
        return Number.isFinite(n) && n > 0 ? n : null;
    } catch {
        return null;
    }
}

/**
 * Character budget for one chat/completions request. Advanced users can tune it
 * without code changes; default is intentionally below huge model windows
 * because base64 images and CJK text can tokenize densely through proxies.
 */
export function getChatRequestCharBudget(): number {
    const configured = readNumberStorage('moro_chat_request_char_budget');
    if (configured) return Math.max(80_000, configured);
    return DEFAULT_MAX_REQUEST_CHARS;
}

export function estimateMessageChars(message: ApiMessage): number {
    if (!message) return 0;
    const content = message.content;
    if (typeof content === 'string') return content.length + message.role.length + 16;
    try {
        return JSON.stringify(content).length + message.role.length + 16;
    } catch {
        return 10_000;
    }
}

export function estimateMessagesChars(messages: ApiMessage[]): number {
    return messages.reduce((sum, msg) => sum + estimateMessageChars(msg), 0);
}

function isLargeImageUrl(url: unknown): url is string {
    return typeof url === 'string' && (url.startsWith('data:') || url.length > COMPACT_IMAGE_CHARS);
}

export function messageHasLargeMedia(message: ApiMessage): boolean {
    const content = message?.content;
    if (!Array.isArray(content)) return false;
    return content.some(part => part?.type === 'image_url' && isLargeImageUrl(part?.image_url?.url));
}

export function compactLargeMediaMessage(message: ApiMessage): ApiMessage {
    if (!messageHasLargeMedia(message)) return message;
    const textParts: string[] = [];
    for (const part of message.content) {
        if (part?.type === 'text' && typeof part.text === 'string' && part.text.trim()) {
            textParts.push(part.text.trim());
        } else if (part?.type === 'image_url') {
            textParts.push('[历史图片已省略：为避免请求超过模型上下文，只保留文字占位。]');
        }
    }
    return { ...message, content: textParts.join('\n') || '[历史图片已省略]' };
}

function compactHistoricalMedia(messages: ApiMessage[], keepRecentImages: number): { messages: ApiMessage[]; compacted: number } {
    let imagesKept = 0;
    let compacted = 0;
    const out = messages.slice();
    for (let i = out.length - 1; i >= 0; i--) {
        if (!messageHasLargeMedia(out[i])) continue;
        if (imagesKept < keepRecentImages) {
            imagesKept++;
            continue;
        }
        out[i] = compactLargeMediaMessage(out[i]);
        compacted++;
    }
    return { messages: out, compacted };
}

// ---------------------------------------------------------------------------
// Token 预算（对齐 SillyTavern：上下文上限 − 回复预留 = 可用输入 token，按 token 裁旧历史）

const DEFAULT_CONTEXT_TOKEN_LIMIT = 128_000;
const MIN_CONTEXT_TOKEN_LIMIT = 4_000;
const MAX_CONTEXT_TOKEN_LIMIT = 2_000_000;
const DEFAULT_RESPONSE_RESERVE = 4_096;
const IMAGE_TOKEN_COST = 1_000;
export const CONTEXT_TOKEN_LIMIT_KEY = 'moro_context_token_limit';
export const LEARNED_MODEL_CONTEXT_KEY = 'moro_learned_model_context_limits';

function isCjkCode(c: number): boolean {
    return (c >= 0x2e80 && c <= 0x9fff)
        || (c >= 0xac00 && c <= 0xd7af)
        || (c >= 0xf900 && c <= 0xfaff)
        || (c >= 0xff00 && c <= 0xffef)
        || (c >= 0x3000 && c <= 0x303f);
}

/** 保守粗估：CJK 记 1 token/字，其余约 3.2 字符/token（宁可多估，少挨 400）。 */
export function estimateTextTokens(text: string): number {
    if (!text) return 0;
    let cjk = 0;
    const n = text.length;
    for (let i = 0; i < n; i++) {
        if (isCjkCode(text.charCodeAt(i))) cjk++;
    }
    return Math.ceil(cjk + (n - cjk) / 3.2);
}

export function estimateMessageTokens(message: ApiMessage): number {
    if (!message) return 0;
    let total = 6;
    const content = message.content;
    if (typeof content === 'string') {
        total += estimateTextTokens(content);
    } else if (Array.isArray(content)) {
        for (const part of content) {
            if (part?.type === 'text' && typeof part.text === 'string') total += estimateTextTokens(part.text);
            else if (part?.type === 'image_url' || part?.type === 'image' || part?.type === 'input_image') total += IMAGE_TOKEN_COST;
            else {
                try { total += estimateTextTokens(JSON.stringify(part)); } catch { total += 200; }
            }
        }
    } else if (content != null) {
        try { total += estimateTextTokens(JSON.stringify(content)); } catch { total += 200; }
    }
    if (message.tool_calls) {
        try { total += estimateTextTokens(JSON.stringify(message.tool_calls)); } catch { /* ignore */ }
    }
    return total;
}

export function estimateMessagesTokens(messages: ApiMessage[]): number {
    return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
}

/** 文具盒「上下文上限（tokens）」：整个请求（输入 + 回复）允许的最大 token 数，同 ST 的 Context Size。 */
export function getContextTokenLimit(): number {
    const configured = readNumberStorage(CONTEXT_TOKEN_LIMIT_KEY);
    if (!configured) return DEFAULT_CONTEXT_TOKEN_LIMIT;
    return Math.max(MIN_CONTEXT_TOKEN_LIMIT, Math.min(MAX_CONTEXT_TOKEN_LIMIT, configured));
}

export function setContextTokenLimit(limit: number): void {
    try {
        if (typeof localStorage === 'undefined') return;
        if (!Number.isFinite(limit) || limit <= 0) {
            localStorage.removeItem(CONTEXT_TOKEN_LIMIT_KEY);
            return;
        }
        const n = Math.max(MIN_CONTEXT_TOKEN_LIMIT, Math.min(MAX_CONTEXT_TOKEN_LIMIT, Math.round(limit)));
        localStorage.setItem(CONTEXT_TOKEN_LIMIT_KEY, String(n));
    } catch {
        // ignore
    }
}

export interface LearnedModelContext {
    /** 从服务端报错里读到的真实上下文上限 */
    limit?: number;
    /** 真实 token / 本地估算 token 的比例，用于校正估算偏差 */
    ratio?: number;
    updatedAt?: number;
}

function readLearnedMap(): Record<string, LearnedModelContext> {
    try {
        if (typeof localStorage === 'undefined') return {};
        const raw = localStorage.getItem(LEARNED_MODEL_CONTEXT_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

export function getLearnedModelContext(model?: string): LearnedModelContext | null {
    const key = String(model || '').trim();
    if (!key) return null;
    return readLearnedMap()[key] || null;
}

export function rememberModelContext(model: string | undefined, patch: LearnedModelContext): void {
    const key = String(model || '').trim();
    if (!key) return;
    try {
        if (typeof localStorage === 'undefined') return;
        const map = readLearnedMap();
        map[key] = { ...(map[key] || {}), ...patch, updatedAt: Date.now() };
        localStorage.setItem(LEARNED_MODEL_CONTEXT_KEY, JSON.stringify(map));
    } catch {
        // ignore
    }
}

export function clearLearnedModelContexts(): void {
    try {
        if (typeof localStorage !== 'undefined') localStorage.removeItem(LEARNED_MODEL_CONTEXT_KEY);
    } catch {
        // ignore
    }
}

/**
 * 可用于输入（messages）的估算 token 预算：
 * min(文具盒上限, 该模型已学到的真实上限) − 回复预留，再按估算偏差比例校正。
 */
export function resolveInputTokenBudget(opts: { model?: string; maxTokens?: number } = {}): number {
    const learned = getLearnedModelContext(opts.model);
    let limit = getContextTokenLimit();
    if (learned?.limit && learned.limit > 0) limit = Math.min(limit, learned.limit);
    const requested = typeof opts.maxTokens === 'number' && opts.maxTokens > 0 ? opts.maxTokens : DEFAULT_RESPONSE_RESERVE;
    const reserve = Math.max(256, Math.min(requested, Math.floor(limit * 0.5)));
    const ratio = learned?.ratio && learned.ratio > 0 ? learned.ratio : 1;
    return Math.max(1_500, Math.floor(((limit - reserve) * 0.95) / ratio));
}

export interface BudgetChatMessagesOptions {
    maxChars?: number;
    /** 输入 token 预算（估算口径）；省略 = 按文具盒上限 resolveInputTokenBudget() */
    maxTokens?: number;
    /** Number of tail messages that should survive even when the old history is huge. */
    protectedTail?: number;
    /** Number of most recent image messages that may keep image_url payloads. */
    keepRecentImages?: number;
    /** Keep the first message, normally the core system prompt. */
    preserveFirst?: boolean;
    /** Explicit override; omitted means read the main API 文具盒 switch. */
    enabled?: boolean;
}

export interface BudgetChatMessagesResult {
    messages: ApiMessage[];
    beforeChars: number;
    afterChars: number;
    beforeTokens: number;
    afterTokens: number;
    removedMessages: number;
    compactedMedia: number;
}

/**
 * ST 式历史选择：首条核心 system、所有 system 块（预设 / 世界书 / 提醒）和末尾保护区固定保留；
 * 其余对话历史从最新往旧装，装不下就停 —— 丢的是最旧的，而不是中间的。
 */
function selectHistory(
    messages: ApiMessage[],
    protectedTail: number,
    preserveFirst: boolean,
    maxChars: number,
    maxTokens: number,
): { messages: ApiMessage[]; removed: number } {
    const n = messages.length;
    const protectedStart = Math.max(0, n - protectedTail);
    const pinned = new Array<boolean>(n).fill(false);
    let usedChars = 0;
    let usedTokens = 0;
    for (let i = 0; i < n; i++) {
        const msg = messages[i];
        if ((preserveFirst && i === 0) || i >= protectedStart || msg?.role === 'system') {
            pinned[i] = true;
            usedChars += estimateMessageChars(msg);
            usedTokens += estimateMessageTokens(msg);
        }
    }
    const keep = pinned.slice();
    let full = false;
    for (let i = n - 1; i >= 0; i--) {
        if (pinned[i]) continue;
        if (full) continue;
        const c = estimateMessageChars(messages[i]);
        const t = estimateMessageTokens(messages[i]);
        if (usedChars + c <= maxChars && usedTokens + t <= maxTokens) {
            keep[i] = true;
            usedChars += c;
            usedTokens += t;
        } else {
            full = true;
        }
    }
    const out: ApiMessage[] = [];
    let removed = 0;
    for (let i = 0; i < n; i++) {
        if (keep[i]) out.push(messages[i]);
        else removed++;
    }
    return { messages: out, removed };
}

export function budgetChatMessages(
    input: ApiMessage[],
    options: BudgetChatMessagesOptions = {},
): BudgetChatMessagesResult {
    const enabled = options.enabled ?? isMainContextBudgetEnabled();
    const beforeChars = estimateMessagesChars(input);
    const beforeTokens = estimateMessagesTokens(input);
    if (!enabled) {
        return {
            messages: input,
            beforeChars,
            afterChars: beforeChars,
            beforeTokens,
            afterTokens: beforeTokens,
            removedMessages: 0,
            compactedMedia: 0,
        };
    }

    const maxChars = options.maxChars ?? getChatRequestCharBudget();
    const maxTokens = options.maxTokens ?? resolveInputTokenBudget();
    const protectedTail = Math.max(1, options.protectedTail ?? DEFAULT_PROTECTED_TAIL);
    const keepRecentImages = Math.max(0, options.keepRecentImages ?? 1);
    const preserveFirst = options.preserveFirst !== false;
    let { messages, compacted } = compactHistoricalMedia(input, keepRecentImages);
    const isOver = (msgs: ApiMessage[]) => estimateMessagesChars(msgs) > maxChars || estimateMessagesTokens(msgs) > maxTokens;
    let removedMessages = 0;

    if (isOver(messages)) {
        const selected = selectHistory(messages, protectedTail, preserveFirst, maxChars, maxTokens);
        messages = selected.messages;
        removedMessages += selected.removed;
    }

    // 保护区本身太大：收缩到只保留最后 2 条（最近一来一回）再选一次。
    if (isOver(messages) && protectedTail > 2) {
        const selected = selectHistory(messages, 2, preserveFirst, maxChars, maxTokens);
        messages = selected.messages;
        removedMessages += selected.removed;
    }

    // If even the protected tail is too large, degrade remaining image payloads
    // to text placeholders. This can happen with a single full-size data URL.
    if (isOver(messages)) {
        let didCompactProtected = false;
        messages = messages.map(msg => {
            if (!messageHasLargeMedia(msg)) return msg;
            didCompactProtected = true;
            return compactLargeMediaMessage(msg);
        });
        if (didCompactProtected) compacted += 1;
    }

    // Absolute fallback for pathological text-only payloads (e.g. a giant
    // system prompt): trim the largest string blocks from the middle.
    if (isOver(messages)) {
        messages = trimLargestTextMessages(messages, maxChars, maxTokens);
    }

    return {
        messages,
        beforeChars,
        afterChars: estimateMessagesChars(messages),
        beforeTokens,
        afterTokens: estimateMessagesTokens(messages),
        removedMessages,
        compactedMedia: compacted,
    };
}

// ---------------------------------------------------------------------------
// 请求级兜底：所有 /chat/completions 请求（含群聊 / 主动消息 / 各 App 裸 fetch）
// 发出前统一按 token 预算裁一次；撞到服务端「上下文过长」报错时记住真实上限并自动重发一次。

const CONTEXT_ERROR_PATTERN = /context[_\s-]*(?:length|window|size)|maximum context|context_length_exceeded|too many tokens|prompt is too long|input is too long|tokens? exceed|exceeds? (?:the )?(?:maximum|max)|maximum (?:input )?tokens|reduce the length|上下文|超出.*(?:长度|token)|token.*(?:超|上限)|输入过长/i;

export function isContextOverflowError(text: string): boolean {
    return !!text && CONTEXT_ERROR_PATTERN.test(text);
}

function toInt(s: string | undefined): number | undefined {
    if (!s) return undefined;
    const n = parseInt(s.replace(/[,_\s]/g, ''), 10);
    return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** 从各家报错里抠「真实上限」和「实际输入 token」。抠不到返回空字段。 */
export function parseContextOverflowError(text: string): { limit?: number; actual?: number } {
    const t = String(text || '');
    const N = '(\\d[\\d,_]*)';
    const limitPatterns = [
        new RegExp(`maximum context length is ${N}`, 'i'),
        new RegExp(`context (?:length|window|size)(?: limit)?(?: is| of|:)? ${N}`, 'i'),
        new RegExp(`> ?${N} ?(?:maximum|max)`, 'i'),
        new RegExp(`(?:maximum|max|limit)(?: number of)?(?: input)? tokens?(?: allowed)?(?: is| of|:)? ?\\(?${N}`, 'i'),
        new RegExp(`(?:limit|上限|最大)[^\\d]{0,12}${N}`, 'i'),
    ];
    const actualPatterns = [
        new RegExp(`${N} in the messages`, 'i'),
        new RegExp(`(?:you requested|requested|prompt has|prompt is too long:?|input token count\\s*\\(?|messages resulted in|got) ?${N}`, 'i'),
    ];
    const first = (ps: RegExp[]) => { for (const p of ps) { const m = t.match(p); const n = toInt(m?.[1]); if (n && n >= 500) return n; } return undefined; };
    return { limit: first(limitPatterns), actual: first(actualPatterns) };
}

/**
 * 记住一次上下文溢出：有真实上限就记上限；有真实输入 token 就校正估算比例；
 * 什么都抠不到则把估算比例放大 25%，保证下一次一定比这次小。
 */
export function learnFromContextOverflow(model: string | undefined, errorText: string, estimatedInputTokens: number): void {
    const { limit, actual } = parseContextOverflowError(errorText);
    const prev = getLearnedModelContext(model) || {};
    const patch: LearnedModelContext = {};
    if (limit) patch.limit = limit;
    if (actual && estimatedInputTokens > 0) {
        patch.ratio = Math.max(prev.ratio || 1, Math.min(4, (actual / estimatedInputTokens) * 1.05));
    }
    if (!patch.limit && !patch.ratio) patch.ratio = Math.min(4, (prev.ratio || 1) * 1.25);
    rememberModelContext(model, patch);
}

/**
 * 对 JSON 字符串请求体做 token 预算。返回 null = 不是聊天请求或无需改动。
 */
export function budgetChatRequestBody(body: string, enabled: boolean): { body: string; model?: string; estimatedTokens: number; changed: boolean } | null {
    let parsed: any;
    try { parsed = JSON.parse(body); } catch { return null; }
    if (!parsed || !Array.isArray(parsed.messages) || parsed.messages.length === 0) return null;
    const model = typeof parsed.model === 'string' ? parsed.model : undefined;
    const maxTokens = typeof parsed.max_tokens === 'number' ? parsed.max_tokens
        : typeof parsed.max_completion_tokens === 'number' ? parsed.max_completion_tokens : undefined;
    const result = budgetChatMessages(parsed.messages, {
        enabled,
        maxTokens: resolveInputTokenBudget({ model, maxTokens }),
        preserveFirst: parsed.messages[0]?.role === 'system',
        protectedTail: 12,
        keepRecentImages: 1,
    });
    const changed = result.messages !== parsed.messages && (result.removedMessages > 0 || result.compactedMedia > 0 || result.afterChars !== result.beforeChars);
    if (changed) {
        console.warn(`[ContextBudget] request ≈${result.beforeTokens}→${result.afterTokens} tokens (model=${model || '?'}), removedHistory=${result.removedMessages}, compactedMedia=${result.compactedMedia}`);
    }
    return {
        body: changed ? JSON.stringify({ ...parsed, messages: result.messages }) : body,
        model,
        estimatedTokens: result.afterTokens,
        changed,
    };
}

function messageTextLength(message: ApiMessage): number {
    const content = message?.content;
    if (typeof content === 'string') return content.length;
    if (Array.isArray(content)) {
        return content.reduce((sum, part) => sum + (part?.type === 'text' && typeof part.text === 'string' ? part.text.length : 0), 0);
    }
    return 0;
}

function trimLargestTextMessages(messages: ApiMessage[], maxChars: number, maxTokens: number): ApiMessage[] {
    let out = messages.slice();
    let chars = estimateMessagesChars(out);
    let tokens = estimateMessagesTokens(out);
    const guard = 32;
    let loops = 0;
    while ((chars > maxChars || tokens > maxTokens) && loops++ < guard) {
        let bestIdx = -1;
        let bestLen = 0;
        for (let i = 0; i < out.length; i++) {
            const len = messageTextLength(out[i]);
            if (len > bestLen) {
                bestLen = len;
                bestIdx = i;
            }
        }
        if (bestIdx < 0 || bestLen <= 2_000) break;
        const charsPerToken = tokens > 0 ? chars / tokens : 1;
        const excess = Math.max(chars - maxChars, Math.ceil((tokens - maxTokens) * charsPerToken), 0);
        const targetLen = Math.max(1_200, bestLen - Math.max(excess + 4_000, Math.floor(bestLen * 0.2)));
        out[bestIdx] = trimMessageText(out[bestIdx], targetLen);
        const nextChars = estimateMessagesChars(out);
        const nextTokens = estimateMessagesTokens(out);
        if (nextChars >= chars && nextTokens >= tokens) break;
        chars = nextChars;
        tokens = nextTokens;
    }
    return out;
}

function trimMessageText(message: ApiMessage, maxTextChars: number): ApiMessage {
    const content = message.content;
    if (typeof content === 'string') {
        return { ...message, content: trimTextMiddle(content, maxTextChars) };
    }
    if (Array.isArray(content)) {
        let remaining = maxTextChars;
        const nextParts = content.map(part => {
            if (part?.type !== 'text' || typeof part.text !== 'string') return part;
            const text = part.text;
            if (remaining <= 0) return { ...part, text: '[此段过长，已省略]' };
            const budget = Math.min(text.length, remaining);
            remaining -= budget;
            return { ...part, text: trimTextMiddle(text, budget) };
        });
        return { ...message, content: nextParts };
    }
    return message;
}

export function trimTextMiddle(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;
    if (maxChars <= 32) return text.slice(0, maxChars);
    const head = Math.floor(maxChars * 0.62);
    const tail = Math.max(0, maxChars - head - 24);
    return `${text.slice(0, head)}\n...[中间省略，避免超过模型上下文]...\n${tail > 0 ? text.slice(-tail) : ''}`;
}