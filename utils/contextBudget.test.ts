import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    AUX_CHAT_CONTEXT_BUDGET_ENABLED_KEY,
    MAIN_CHAT_CONTEXT_BUDGET_ENABLED_KEY,
    budgetChatMessages,
    budgetChatRequestBody,
    estimateMessagesChars,
    isContextOverflowError,
    learnFromContextOverflow,
    parseContextOverflowError,
    resolveInputTokenBudget,
    isAuxContextBudgetEnabled,
    isMainContextBudgetEnabled,
    setAuxContextBudgetEnabled,
    setMainContextBudgetEnabled,
} from './contextBudget';

describe('contextBudget', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('compacts old image payloads while keeping the newest image when possible', () => {
        const oldImage = 'data:image/jpeg;base64,' + 'a'.repeat(5000);
        const newImage = 'data:image/jpeg;base64,' + 'b'.repeat(100);
        const result = budgetChatMessages([
            { role: 'system', content: 'core' },
            { role: 'user', content: [{ type: 'text', text: 'old image' }, { type: 'image_url', image_url: { url: oldImage } }] },
            { role: 'user', content: [{ type: 'text', text: 'new image' }, { type: 'image_url', image_url: { url: newImage } }] },
        ], {
            maxChars: 10_000,
            keepRecentImages: 1,
        });

        expect(JSON.stringify(result.messages[1].content)).not.toContain(oldImage);
        expect(JSON.stringify(result.messages[2].content)).toContain(newImage);
        expect(result.compactedMedia).toBe(1);
    });

    it('drops old history before protected recent messages', () => {
        const messages = [
            { role: 'system', content: 'core' },
            ...Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `old-${i} ${'x'.repeat(1200)}` })),
            { role: 'user', content: 'latest question' },
            { role: 'assistant', content: 'latest answer' },
        ];
        const result = budgetChatMessages(messages, {
            maxChars: 8_000,
            protectedTail: 2,
            keepRecentImages: 0,
        });

        expect(result.messages[0].content).toBe('core');
        expect(result.messages[result.messages.length - 2]?.content).toBe('latest question');
        expect(result.messages[result.messages.length - 1]?.content).toBe('latest answer');
        expect(result.removedMessages).toBeGreaterThan(0);
        expect(estimateMessagesChars(result.messages)).toBeLessThanOrEqual(8_000);
    });

    it('can be disabled by the main API 文具盒 switch', () => {
        const storage = new Map<string, string>();
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => { storage.set(key, value); },
        });
        setMainContextBudgetEnabled(false);

        const messages = [
            { role: 'system', content: 'core' },
            { role: 'user', content: 'x'.repeat(20_000) },
            { role: 'assistant', content: 'latest' },
        ];
        const result = budgetChatMessages(messages, { maxChars: 1_000, protectedTail: 1 });

        expect(result.messages).toBe(messages);
        expect(result.removedMessages).toBe(0);
        expect(result.afterChars).toBe(result.beforeChars);
    });

    it('trims oldest history by token budget, keeping system blocks and the latest turn', () => {
        const messages = [
            { role: 'system', content: 'core' },
            ...Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `第${i}条${'很长的中文内容'.repeat(60)}` })),
            { role: 'system', content: 'reminder' },
            { role: 'user', content: 'latest question' },
        ];
        const result = budgetChatMessages(messages, { maxTokens: 3_000, protectedTail: 2, enabled: true });

        expect(result.messages[0].content).toBe('core');
        expect(result.messages.some(m => m.content === 'reminder')).toBe(true);
        expect(result.messages[result.messages.length - 1].content).toBe('latest question');
        expect(result.messages.some(m => String(m.content).startsWith('第0条'))).toBe(false);
        expect(result.messages.some(m => String(m.content).startsWith('第39条'))).toBe(true);
        expect(result.afterTokens).toBeLessThanOrEqual(3_000);
    });

    it('learns the real limit from a context overflow error and shrinks the next request', () => {
        const storage = new Map<string, string>();
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => { storage.set(key, value); },
            removeItem: (key: string) => { storage.delete(key); },
        });
        const err = "This model's maximum context length is 32768 tokens. However, you requested 50000 tokens (46000 in the messages, 4000 in the completion).";
        expect(isContextOverflowError(err)).toBe(true);
        expect(parseContextOverflowError(err)).toEqual({ limit: 32768, actual: 46000 });
        expect(isContextOverflowError('Invalid API key')).toBe(false);

        const before = resolveInputTokenBudget({ model: 'm', maxTokens: 4000 });
        learnFromContextOverflow('m', err, 40_000);
        const after = resolveInputTokenBudget({ model: 'm', maxTokens: 4000 });
        expect(after).toBeLessThan(before);
        expect(after).toBeLessThan(32768 - 4000);

        const body = JSON.stringify({
            model: 'm',
            max_tokens: 4000,
            messages: [
                { role: 'system', content: 'core' },
                ...Array.from({ length: 200 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: '字'.repeat(500) })),
            ],
        });
        const budgeted = budgetChatRequestBody(body, true)!;
        expect(budgeted.changed).toBe(true);
        expect(budgeted.estimatedTokens).toBeLessThanOrEqual(after);
        expect(JSON.parse(budgeted.body).messages[0].content).toBe('core');
    });

    it('keeps main API and aux API switches independent', () => {
        const storage = new Map<string, string>();
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => { storage.set(key, value); },
        });

        setMainContextBudgetEnabled(false);
        setAuxContextBudgetEnabled(true);

        expect(isMainContextBudgetEnabled()).toBe(false);
        expect(isAuxContextBudgetEnabled()).toBe(true);
        expect(storage.get(MAIN_CHAT_CONTEXT_BUDGET_ENABLED_KEY)).toBe('0');
        expect(storage.get(AUX_CHAT_CONTEXT_BUDGET_ENABLED_KEY)).toBe('1');
    });
});
