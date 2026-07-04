import { afterEach, describe, expect, it, vi } from 'vitest';
import { streamChatCompletion } from './streamChat';

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('streamChatCompletion', () => {
    it('aborts stalled stream requests when timeoutMs is set', async () => {
        vi.useFakeTimers();
        global.fetch = vi.fn((_url, init: RequestInit = {}) => new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
                const err = new Error('aborted');
                err.name = 'AbortError';
                reject(err);
            });
        })) as unknown as typeof fetch;

        const promise = expect(streamChatCompletion(
            'https://api.example.test/v1/chat/completions',
            { headers: {}, body: { model: 'm', messages: [] }, timeoutMs: 10 },
            () => {},
        )).rejects.toThrow(/aborted|timeout/i);

        await vi.advanceTimersByTimeAsync(10);
        await promise;
    });
});
