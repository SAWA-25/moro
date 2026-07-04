import { describe, it, expect, afterEach, vi } from 'vitest';
import { llmComplete } from './llmComplete';
import type { ResolvedApi } from './auxApi';
import { PresetRuntime, createDefaultPreset } from './presets';

/**
 * 锁定「解牌防截断」：续写既要认 finish_reason='length'，
 * 也要在代理不回 finish_reason（null）但正文停在半句上时启发式兜底续写，
 * 同时要信任 finish_reason='stop'（不强续）。
 */

const API: ResolvedApi = { baseUrl: 'https://x/v1', apiKey: 'k', model: 'm' };

/** 造一个 OpenAI 兼容的非流式响应。 */
function res(content: string, finishReason: string | null) {
    return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ choices: [{ message: { content }, finish_reason: finishReason }] }),
    } as unknown as Response;
}

/** 把一串响应排成队列，fetch 依次返回。 */
function queueFetch(responses: Response[]) {
    const q = responses.slice();
    const fn = vi.fn(async () => q.shift() || res('', 'stop'));
    global.fetch = fn as unknown as typeof fetch;
    return fn;
}

afterEach(() => { vi.restoreAllMocks(); });

describe('llmComplete 续写', () => {
    it('finish_reason=length → 续写并拼接', async () => {
        const fetchFn = queueFetch([res('上半句', 'length'), res('下半句。', 'stop')]);
        const out = await llmComplete(API, [{ role: 'user', content: 'hi' }], { continueRounds: 2 });
        expect(out).toBe('上半句下半句。');
        expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it('finish_reason 缺失 + 停在半句 → 启发式续写', async () => {
        const fetchFn = queueFetch([res('牌面在警告你，你将要面对', null), res('的其实是自己。', null)]);
        const out = await llmComplete(API, [{ role: 'user', content: 'hi' }], { continueRounds: 2 });
        expect(out).toBe('牌面在警告你，你将要面对的其实是自己。');
        expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it('finish_reason 缺失 + 正常句末标点 → 不续写', async () => {
        const fetchFn = queueFetch([res('一切都已写在牌里了。', null), res('多余的话', null)]);
        const out = await llmComplete(API, [{ role: 'user', content: 'hi' }], { continueRounds: 2 });
        expect(out).toBe('一切都已写在牌里了。');
        expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('finish_reason=stop 即便停在半句也信任、不强续', async () => {
        const fetchFn = queueFetch([res('我只想说到这', 'stop'), res('不该出现', 'stop')]);
        const out = await llmComplete(API, [{ role: 'user', content: 'hi' }], { continueRounds: 2 });
        expect(out).toBe('我只想说到这');
        expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('continueRounds=0（默认）→ 永远只调一次（JSON / 短问答场景不受影响）', async () => {
        const fetchFn = queueFetch([res('半句被截', 'length'), res('不该出现', 'stop')]);
        const out = await llmComplete(API, [{ role: 'user', content: 'hi' }]);
        expect(out).toBe('半句被截');
        expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('presetScope 关闭时不改 messages，但可合并 scoped 采样参数', async () => {
        vi.spyOn(PresetRuntime, 'getActiveGenParams').mockResolvedValue({ temperature: 0.42, max_tokens: 123 });
        vi.spyOn(PresetRuntime, 'getActivePresetForScope').mockResolvedValue(null);
        const fetchFn = queueFetch([res('ok。', 'stop')]);
        await llmComplete(API, [{ role: 'system', content: 'CORE' }, { role: 'user', content: 'hi' }], { presetScope: 'creative.text' });
        const firstCall = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
        const body = JSON.parse(String(firstCall[1].body));
        expect(body.temperature).toBe(0.42);
        expect(body.max_tokens).toBe(123);
        expect(body.messages).toEqual([{ role: 'system', content: 'CORE' }, { role: 'user', content: 'hi' }]);
    });

    it('presetScope 的采样参数优先级高于调用点默认参数', async () => {
        vi.spyOn(PresetRuntime, 'getActiveGenParams').mockResolvedValue({
            temperature: 0.42,
            max_tokens: 123,
            top_p: 0.7,
            frequency_penalty: 0.2,
            presence_penalty: 0.3,
            top_k: 40,
            min_p: 0.1,
            top_a: 0.25,
            repetition_penalty: 1.12,
        });
        vi.spyOn(PresetRuntime, 'getActivePresetForScope').mockResolvedValue(null);
        const fetchFn = queueFetch([res('ok。', 'stop')]);

        await llmComplete(API, [{ role: 'user', content: 'hi' }], {
            presetScope: 'creative.text',
            temperature: 0.99,
            maxTokens: 999,
            top_p: 0.95,
        });

        const firstCall = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
        const body = JSON.parse(String(firstCall[1].body));
        expect(body.temperature).toBe(0.42);
        expect(body.max_tokens).toBe(123);
        expect(body.top_p).toBe(0.7);
        expect(body.frequency_penalty).toBe(0.2);
        expect(body.presence_penalty).toBe(0.3);
        expect(body.top_k).toBe(40);
        expect(body.min_p).toBe(0.1);
        expect(body.top_a).toBe(0.25);
        expect(body.repetition_penalty).toBe(1.12);
    });

    it('presetScope 开启且首条是 system 时套预设骨架', async () => {
        vi.spyOn(PresetRuntime, 'getActiveGenParams').mockResolvedValue(null);
        const preset = createDefaultPreset();
        const main = preset.prompts.find(p => p.identifier === 'main')!;
        main.content = 'PRESET {{user}}';
        preset.prompt_order = [{ character_id: 100000, order: [{ identifier: 'main', enabled: true }, { identifier: 'chatHistory', enabled: true }] }];
        vi.spyOn(PresetRuntime, 'getActivePresetForScope').mockResolvedValue(preset);
        const fetchFn = queueFetch([res('ok。', 'stop')]);
        await llmComplete(API, [{ role: 'system', content: 'CORE' }, { role: 'user', content: 'hi' }], { presetScope: 'creative.text' });
        const firstCall = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
        const body = JSON.parse(String(firstCall[1].body));
        expect(body.messages.map((m: any) => m.content)).toEqual(['CORE', 'PRESET 用户', 'hi']);
    });

    it('presetScope can use caller-provided macro names', async () => {
        vi.spyOn(PresetRuntime, 'getActiveGenParams').mockResolvedValue(null);
        const preset = createDefaultPreset();
        const main = preset.prompts.find(p => p.identifier === 'main')!;
        main.content = 'PRESET {{char}} / {{user}}';
        preset.prompt_order = [{ character_id: 100000, order: [{ identifier: 'main', enabled: true }, { identifier: 'chatHistory', enabled: true }] }];
        vi.spyOn(PresetRuntime, 'getActivePresetForScope').mockResolvedValue(preset);
        const fetchFn = queueFetch([res('ok。', 'stop')]);

        await llmComplete(API, [{ role: 'system', content: 'CORE' }, { role: 'user', content: 'hi' }], {
            presetScope: 'creative.text',
            presetMacros: { charName: '阿澈', userName: '小雨' },
        });

        const firstCall = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
        const body = JSON.parse(String(firstCall[1].body));
        expect(body.messages.map((m: any) => m.content)).toEqual(['CORE', 'PRESET 阿澈 / 小雨', 'hi']);
    });

    it('structured presetScope keeps the default format guard in the request skeleton', async () => {
        vi.spyOn(PresetRuntime, 'getActiveGenParams').mockResolvedValue(null);
        vi.spyOn(PresetRuntime, 'getActivePresetForScope').mockResolvedValue(createDefaultPreset());
        const fetchFn = queueFetch([res('{"ok":true}', 'stop')]);

        await llmComplete(API, [
            { role: 'system', content: 'CORE' },
            { role: 'user', content: 'Return JSON only' },
        ], { presetScope: 'structured.tool' });

        const firstCall = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
        const body = JSON.parse(String(firstCall[1].body));
        expect(body.messages.some((m: any) => typeof m.content === 'string' && m.content.includes('JSON'))).toBe(true);
        expect(body.messages.map((m: any) => m.content)).toEqual(expect.arrayContaining(['CORE', 'Return JSON only']));
    });
});
