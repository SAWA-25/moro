import { afterEach, describe, expect, it, vi } from 'vitest';
import { callChatCompletion, completeText, fetchModelList, testChatConnection } from './llmClient';
import { makeApiUsageMeta } from './apiUsageCatalog';

const API = { baseUrl: 'https://api.example.test/v1/chat/completions', apiKey: '', model: 'm' };

function res(body: any, ok = true, status = 200) {
    return {
        ok,
        status,
        statusText: ok ? 'OK' : 'Bad Request',
        text: async () => typeof body === 'string' ? body : JSON.stringify(body),
    } as unknown as Response;
}

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('llmClient', () => {
    it('calls chat completions through normalized endpoint and sk-none auth', async () => {
        const fetchFn = vi.fn(async () => res({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }));
        global.fetch = fetchFn as unknown as typeof fetch;
        const meta = makeApiUsageMeta('chat.privateReply', { apiRole: 'main' });

        await callChatCompletion(API, { messages: [{ role: 'user', content: 'hi' }] }, { meta });

        const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit & { __moroMeta?: any }];
        expect(url).toBe('https://api.example.test/v1/chat/completions');
        expect((init.headers as any).Authorization).toBe('Bearer sk-none');
        expect(init.__moroMeta.featureId).toBe('chat.privateReply');
        expect(JSON.parse(String(init.body)).model).toBe('m');
    });

    it('fetches model lists through normalized endpoint', async () => {
        const fetchFn = vi.fn(async () => res({ data: [{ id: 'model-a' }, { id: 'model-b' }] }));
        global.fetch = fetchFn as unknown as typeof fetch;

        await expect(fetchModelList({ baseUrl: 'https://api.example.test/v1/models', apiKey: 'k' }))
            .resolves.toEqual(['model-a', 'model-b']);
        expect((fetchFn.mock.calls[0] as unknown as [string])[0]).toBe('https://api.example.test/v1/models');
    });

    it('tests chat connection and extracts visible content', async () => {
        global.fetch = vi.fn(async () => res({ choices: [{ message: { content: 'pong' }, finish_reason: 'stop' }] })) as unknown as typeof fetch;
        await expect(testChatConnection({ ...API, apiKey: 'k' })).resolves.toBe('pong');
    });

    it('continues text on finish_reason length', async () => {
        const q = [
            res({ choices: [{ message: { content: '上半句' }, finish_reason: 'length' }] }),
            res({ choices: [{ message: { content: '下半句。' }, finish_reason: 'stop' }] }),
        ];
        const fetchFn = vi.fn(async () => q.shift()!);
        global.fetch = fetchFn as unknown as typeof fetch;

        await expect(completeText({ ...API, apiKey: 'k' }, [{ role: 'user', content: 'hi' }], { continueRounds: 2 }))
            .resolves.toBe('上半句下半句。');
        expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it('surfaces provider errors from JSON bodies', async () => {
        global.fetch = vi.fn(async () => res({ error: { message: 'bad key' } }, false, 401)) as unknown as typeof fetch;
        await expect(fetchModelList({ baseUrl: 'https://api.example.test/v1', apiKey: 'bad' }))
            .rejects.toThrow('bad key');
    });

    it.each([400, 401, 403, 404, 429])('surfaces HTTP %s provider errors', async (status) => {
        global.fetch = vi.fn(async () => res({ error: { message: `provider ${status}` } }, false, status)) as unknown as typeof fetch;
        await expect(callChatCompletion(API, { messages: [{ role: 'user', content: 'hi' }] }, { maxRetries: 0 }))
            .rejects.toThrow(`provider ${status}`);
    });

    it('surfaces HTML error pages with a friendly diagnostic', async () => {
        global.fetch = vi.fn(async () => ({
            ok: false,
            status: 502,
            statusText: 'Bad Gateway',
            text: async () => '<html><head><title>Cloudflare 502</title></head></html>',
        } as unknown as Response)) as unknown as typeof fetch;

        await expect(callChatCompletion(API, { messages: [{ role: 'user', content: 'hi' }] }, { maxRetries: 0 }))
            .rejects.toThrow('API返回了HTML而非JSON');
    });

    it('assembles SSE responses returned to non-stream callers', async () => {
        const sse = [
            'data: {"choices":[{"delta":{"role":"assistant","content":"你"}}]}',
            'data: {"choices":[{"delta":{"content":"好。"},"finish_reason":"stop"}],"usage":{"total_tokens":7}}',
            'data: [DONE]',
            '',
        ].join('\n');
        global.fetch = vi.fn(async () => res(sse)) as unknown as typeof fetch;

        await expect(completeText({ ...API, apiKey: 'k' }, [{ role: 'user', content: 'hi' }]))
            .resolves.toBe('你好。');
    });

    it('retries retryable statuses before succeeding', async () => {
        vi.useFakeTimers();
        const fetchFn = vi.fn()
            .mockResolvedValueOnce(res({ error: { message: 'slow down' } }, false, 429))
            .mockResolvedValueOnce(res({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }));
        global.fetch = fetchFn as unknown as typeof fetch;

        const promise = callChatCompletion(API, { messages: [{ role: 'user', content: 'hi' }] }, { maxRetries: 1 });
        await vi.advanceTimersByTimeAsync(1000);
        await expect(promise).resolves.toMatchObject({ choices: expect.any(Array) });
        expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it('aborts stalled requests when timeoutMs is set', async () => {
        vi.useFakeTimers();
        global.fetch = vi.fn((_url, init: RequestInit = {}) => new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
                const err = new Error('aborted');
                err.name = 'AbortError';
                reject(err);
            });
        })) as unknown as typeof fetch;

        const promise = expect(callChatCompletion(API, { messages: [{ role: 'user', content: 'hi' }] }, { maxRetries: 0, timeoutMs: 10 }))
            .rejects.toThrow(/aborted|timeout/i);
        await vi.advanceTimersByTimeAsync(10);
        await promise;
    });
});
