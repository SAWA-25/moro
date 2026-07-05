import { afterEach, describe, expect, it, vi } from 'vitest';
import { callChatCompletion, completeText, fetchModelList, resolvePresetScopeForApiCall, testChatConnection } from './llmClient';
import { makeApiUsageMeta } from './apiUsageCatalog';
import { DB } from './db';
import { createDefaultPreset, PresetRuntime } from './presets';

const API = { baseUrl: 'https://api.example.test/v1/chat/completions', apiKey: '', model: 'm' };

function res(body: any, ok = true, status = 200) {
    return {
        ok,
        status,
        statusText: ok ? 'OK' : 'Bad Request',
        text: async () => typeof body === 'string' ? body : JSON.stringify(body),
    } as unknown as Response;
}

function presetWithMain(content = 'PRESET {{user}}') {
    const preset = createDefaultPreset();
    const main = preset.prompts.find(p => p.identifier === 'main')!;
    main.content = content;
    preset.prompt_order = [{
        character_id: 100000,
        order: [
            { identifier: 'main', enabled: true },
            { identifier: 'chatHistory', enabled: true },
        ],
    }];
    return preset;
}

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('llmClient', () => {
    it('infers preset scope from API usage features', () => {
        expect(resolvePresetScopeForApiCall({ meta: makeApiUsageMeta('chat.phoneTextReply') })).toBe('chat.phoneText');
        expect(resolvePresetScopeForApiCall({ meta: makeApiUsageMeta('forum.generate') })).toBe('creative.text');
        expect(resolvePresetScopeForApiCall({ meta: makeApiUsageMeta('memoryPalace.extraction') })).toBe('structured.tool');
        expect(resolvePresetScopeForApiCall({ meta: makeApiUsageMeta('vrWorld.session') })).toBe('role.scene');
        expect(resolvePresetScopeForApiCall({ meta: makeApiUsageMeta('settings.mainApi.fetchModels') })).toBeNull();
    });

    it('applies inferred creative preset scope in callChatCompletion', async () => {
        vi.spyOn(PresetRuntime, 'getActiveGenParams').mockResolvedValue({ temperature: 0.42, max_tokens: 123 });
        vi.spyOn(PresetRuntime, 'getActivePresetForScope').mockResolvedValue(presetWithMain('PRESET {{user}}'));
        const fetchFn = vi.fn(async () => res({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }));
        global.fetch = fetchFn as unknown as typeof fetch;

        await callChatCompletion(API, {
            messages: [{ role: 'system', content: 'CORE' }, { role: 'user', content: 'hi' }],
            temperature: 0.99,
            max_tokens: 999,
        }, { meta: makeApiUsageMeta('forum.generate') });

        expect(PresetRuntime.getActiveGenParams).toHaveBeenCalledWith('creative.text');
        expect(PresetRuntime.getActivePresetForScope).toHaveBeenCalledWith('creative.text');
        const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
        const body = JSON.parse(String(init.body));
        expect(body.temperature).toBe(0.42);
        expect(body.max_tokens).toBe(123);
        expect(body.messages.map((m: any) => m.content)).toEqual(['CORE', 'PRESET 用户', 'hi']);
    });

    it('can preserve caller max_tokens over preset sampling in completeText', async () => {
        vi.spyOn(PresetRuntime, 'getActiveGenParams').mockResolvedValue({ temperature: 0.42, max_tokens: 123 });
        vi.spyOn(PresetRuntime, 'getActivePresetForScope').mockResolvedValue(null);
        const fetchFn = vi.fn(async () => res({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }));
        global.fetch = fetchFn as unknown as typeof fetch;

        await completeText(API, [{ role: 'user', content: 'hi' }], {
            presetScope: 'creative.text',
            maxTokens: 777,
            preserveMaxTokens: true,
        });

        const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
        const body = JSON.parse(String(init.body));
        expect(body.temperature).toBe(0.42);
        expect(body.max_tokens).toBe(777);
    });

    it('maps structured tasks to structured.tool without changing messages when the scope is inactive', async () => {
        vi.spyOn(PresetRuntime, 'getActiveGenParams').mockResolvedValue(null);
        vi.spyOn(PresetRuntime, 'getActivePresetForScope').mockResolvedValue(null);
        const fetchFn = vi.fn(async () => res({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }] }));
        global.fetch = fetchFn as unknown as typeof fetch;

        await callChatCompletion(API, {
            messages: [{ role: 'system', content: 'CORE' }, { role: 'user', content: 'Return JSON only' }],
        }, { meta: makeApiUsageMeta('memoryPalace.extraction') });

        expect(PresetRuntime.getActiveGenParams).toHaveBeenCalledWith('structured.tool');
        expect(PresetRuntime.getActivePresetForScope).toHaveBeenCalledWith('structured.tool');
        const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
        expect(JSON.parse(String(init.body)).messages).toEqual([
            { role: 'system', content: 'CORE' },
            { role: 'user', content: 'Return JSON only' },
        ]);
    });

    it('can apply inferred presets to legacy user-only creative requests without leaving a blank system message', async () => {
        vi.spyOn(PresetRuntime, 'getActiveGenParams').mockResolvedValue(null);
        vi.spyOn(PresetRuntime, 'getActivePresetForScope').mockResolvedValue(presetWithMain('PRESET {{user}}'));
        const fetchFn = vi.fn(async () => res({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }));
        global.fetch = fetchFn as unknown as typeof fetch;

        await callChatCompletion(API, {
            messages: [{ role: 'user', content: 'legacy prompt' }],
        }, { meta: makeApiUsageMeta('forum.generate') });

        const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
        const body = JSON.parse(String(init.body));
        expect(body.messages.map((m: any) => m.content)).toEqual(['PRESET 用户', 'legacy prompt']);
        expect(body.messages.some((m: any) => m.role === 'system' && !String(m.content).trim())).toBe(false);
    });

    it('respects explicit presetScope=false for calls that already applied a preset skeleton', async () => {
        const genSpy = vi.spyOn(PresetRuntime, 'getActiveGenParams').mockResolvedValue({ temperature: 0.1 });
        const presetSpy = vi.spyOn(PresetRuntime, 'getActivePresetForScope').mockResolvedValue(presetWithMain());
        const fetchFn = vi.fn(async () => res({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }));
        global.fetch = fetchFn as unknown as typeof fetch;

        await callChatCompletion(API, {
            messages: [{ role: 'system', content: 'ALREADY PRESET' }, { role: 'user', content: 'hi' }],
            temperature: 0.8,
        }, { meta: makeApiUsageMeta('forum.generate'), presetScope: false });

        expect(genSpy).not.toHaveBeenCalled();
        expect(presetSpy).not.toHaveBeenCalled();
        const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
        const body = JSON.parse(String(init.body));
        expect(body.temperature).toBe(0.8);
        expect(body.messages.map((m: any) => m.content)).toEqual(['ALREADY PRESET', 'hi']);
    });

    it('completeText infers meta scope and applies the preset only once', async () => {
        vi.spyOn(PresetRuntime, 'getActiveGenParams').mockResolvedValue(null);
        vi.spyOn(PresetRuntime, 'getActivePresetForScope').mockResolvedValue(presetWithMain('PRESET {{user}}'));
        const fetchFn = vi.fn(async () => res({ choices: [{ message: { content: 'ok。' }, finish_reason: 'stop' }] }));
        global.fetch = fetchFn as unknown as typeof fetch;

        await expect(completeText(API, [
            { role: 'system', content: 'CORE' },
            { role: 'user', content: 'hi' },
        ], { meta: makeApiUsageMeta('forum.generate') })).resolves.toBe('ok。');

        expect(PresetRuntime.getActivePresetForScope).toHaveBeenCalledTimes(1);
        const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
        const body = JSON.parse(String(init.body));
        expect(body.messages.map((m: any) => m.content).filter((text: string) => text.includes('PRESET'))).toEqual(['PRESET 用户']);
    });

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

    it('injects the model-visible character identity when meta has charId', async () => {
        await DB.saveCharacter({
            id: 'row-llm-identity',
            modelId: 'model-llm-identity',
            name: 'Same Name',
            avatar: '',
            description: '',
            systemPrompt: '',
            memories: [],
        } as any);
        const fetchFn = vi.fn(async () => res({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }));
        global.fetch = fetchFn as unknown as typeof fetch;
        const meta = makeApiUsageMeta('chat.privateReply', {
            apiRole: 'main',
            charId: 'row-llm-identity',
            charName: 'Same Name',
        });

        await callChatCompletion(API, { messages: [{ role: 'user', content: 'hi' }] }, { meta });

        const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
        const body = JSON.parse(String(init.body));
        expect(body.messages[0].role).toBe('system');
        expect(body.messages[0].content).toContain('Moro Character Identity Anchor');
        expect(body.messages[0].content).toContain('targetModelCharId: "model-llm-identity"');
        expect(body.messages[0].content).toContain('targetLocalCharId: "row-llm-identity"');
        expect(body.messages[1]).toEqual({ role: 'user', content: 'hi' });
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
