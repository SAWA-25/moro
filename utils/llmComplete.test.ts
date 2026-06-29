import { describe, it, expect, afterEach, vi } from 'vitest';
import { llmComplete } from './llmComplete';
import type { ResolvedApi } from './auxApi';

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
});
