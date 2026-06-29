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

export interface BudgetChatMessagesOptions {
    maxChars?: number;
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
    removedMessages: number;
    compactedMedia: number;
}

export function budgetChatMessages(
    input: ApiMessage[],
    options: BudgetChatMessagesOptions = {},
): BudgetChatMessagesResult {
    const enabled = options.enabled ?? isMainContextBudgetEnabled();
    const beforeChars = estimateMessagesChars(input);
    if (!enabled) {
        return {
            messages: input,
            beforeChars,
            afterChars: beforeChars,
            removedMessages: 0,
            compactedMedia: 0,
        };
    }

    const maxChars = options.maxChars ?? getChatRequestCharBudget();
    const protectedTail = Math.max(1, options.protectedTail ?? DEFAULT_PROTECTED_TAIL);
    const keepRecentImages = Math.max(0, options.keepRecentImages ?? 1);
    const preserveFirst = options.preserveFirst !== false;
    let { messages, compacted } = compactHistoricalMedia(input, keepRecentImages);
    let currentChars = estimateMessagesChars(messages);
    let removedMessages = 0;

    if (currentChars > maxChars) {
        const first = preserveFirst ? messages[0] : null;
        let body = preserveFirst ? messages.slice(1) : messages.slice();
        const protectedStart = Math.max(0, body.length - protectedTail);
        const kept: ApiMessage[] = [];

        for (let i = body.length - 1; i >= 0; i--) {
            const msg = body[i];
            const msgChars = estimateMessageChars(msg);
            const isProtected = i >= protectedStart;
            if (isProtected || currentChars - msgChars < maxChars) {
                kept.unshift(msg);
            } else {
                currentChars -= msgChars;
                removedMessages++;
            }
        }

        messages = first ? [first, ...kept] : kept;
        currentChars = estimateMessagesChars(messages);
    }

    // If even the protected tail is too large, degrade remaining image payloads
    // to text placeholders. This can happen with a single full-size data URL.
    if (currentChars > maxChars) {
        let didCompactProtected = false;
        messages = messages.map(msg => {
            if (!messageHasLargeMedia(msg)) return msg;
            didCompactProtected = true;
            return compactLargeMediaMessage(msg);
        });
        if (didCompactProtected) {
            compacted += 1;
            currentChars = estimateMessagesChars(messages);
        }
    }

    // Last-resort history thinning: keep only a small recent tail plus the first
    // system/core message. The latest exchange still survives; older context is
    // recoverable through summaries/vector memory.
    if (currentChars > maxChars && messages.length > (preserveFirst ? 5 : 4)) {
        const first = preserveFirst ? messages[0] : null;
        const body = preserveFirst ? messages.slice(1) : messages.slice();
        const hardTail = body.slice(-4);
        removedMessages += Math.max(0, body.length - hardTail.length);
        messages = first ? [first, ...hardTail] : hardTail;
        currentChars = estimateMessagesChars(messages);
    }

    // Absolute fallback for pathological text-only payloads: trim the largest
    // string blocks from the middle. This avoids a hard 400 while preserving the
    // beginning/end of each block, where user intent and instructions usually sit.
    if (currentChars > maxChars) {
        messages = trimLargestTextMessages(messages, maxChars);
        currentChars = estimateMessagesChars(messages);
    }

    return {
        messages,
        beforeChars,
        afterChars: currentChars,
        removedMessages,
        compactedMedia: compacted,
    };
}

function trimLargestTextMessages(messages: ApiMessage[], maxChars: number): ApiMessage[] {
    let out = messages.slice();
    let current = estimateMessagesChars(out);
    if (current <= maxChars) return out;

    const guard = 32;
    let loops = 0;
    while (current > maxChars && loops++ < guard) {
        let bestIdx = -1;
        let bestLen = 0;
        for (let i = 0; i < out.length; i++) {
            const content = out[i]?.content;
            let len = 0;
            if (typeof content === 'string') len = content.length;
            else if (Array.isArray(content)) {
                len = content.reduce((sum, part) => sum + (part?.type === 'text' && typeof part.text === 'string' ? part.text.length : 0), 0);
            }
            if (len > bestLen) {
                bestLen = len;
                bestIdx = i;
            }
        }
        if (bestIdx < 0 || bestLen <= 2_000) break;
        const excess = current - maxChars;
        const targetLen = Math.max(1_200, bestLen - Math.max(excess + 8_000, Math.floor(bestLen * 0.35)));
        out[bestIdx] = trimMessageText(out[bestIdx], targetLen);
        const next = estimateMessagesChars(out);
        if (next >= current) break;
        current = next;
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
