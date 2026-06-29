import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    AUX_CHAT_CONTEXT_BUDGET_ENABLED_KEY,
    MAIN_CHAT_CONTEXT_BUDGET_ENABLED_KEY,
    budgetChatMessages,
    estimateMessagesChars,
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
