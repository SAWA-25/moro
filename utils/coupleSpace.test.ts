import { describe, it, expect, afterEach, vi } from 'vitest';
import { generateCharQuestionAnswer, generateCharWhisperReply, type CoupleApi } from './coupleSpace';
import type { CharacterProfile } from '../types';

/**
 * 回归：情侣空间 AI 调用必须能消化「主聊天能用」的各种响应形态。
 * 之前 callCoupleLLM 自己内联 res.json()+message.content，遇到 SSE 流式 / 思考型模型
 * （正文在 reasoning_content）会静默拿到空串 → 整个情侣空间退回模板兜底（本地无 AI）。
 * 改走 llmComplete 后，这些都应正确解析出正文。
 */

const API: CoupleApi = { baseUrl: 'https://x/v1', apiKey: 'k', model: 'm' };
const char = { name: '流浪者', systemPrompt: '一个浪子' } as unknown as CharacterProfile;

/** 普通非流式 OpenAI 响应。 */
function jsonRes(message: Record<string, any>) {
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message, finish_reason: 'stop' }] }) } as unknown as Response;
}
/** SSE 流式响应（代理无视 stream:false 强行流式）。 */
function sseRes(parts: string[]) {
    const body = parts.map(p => `data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}`).join('\n')
        + `\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\ndata: [DONE]\n`;
    return { ok: true, status: 200, text: async () => body } as unknown as Response;
}
function mockFetch(r: Response | (() => Promise<never>)) {
    const fn = typeof r === 'function' ? vi.fn(r) : vi.fn(async () => r);
    global.fetch = fn as unknown as typeof fetch;
    return fn;
}

afterEach(() => { vi.restoreAllMocks(); });

describe('情侣空间 LLM 调用（callCoupleLLM via llmComplete）', () => {
    it('普通响应：提问箱能拿到角色回答', async () => {
        mockFetch(jsonRes({ content: '第一次见你那天，我的心跳漏了一拍。' }));
        const ans = await generateCharQuestionAnswer({ char, userName: '小明', api: API, question: '第一次见我时你什么感觉？' });
        expect(ans).toContain('心跳漏了一拍');
    });

    it('SSE 流式响应：以前会拿到空串 → 现在能拼出正文', async () => {
        mockFetch(sseRes(['第一次', '见你', '，就移不开眼了。']));
        const ans = await generateCharQuestionAnswer({ char, userName: '小明', api: API, question: '第一次见我时你什么感觉？' });
        expect(ans).toBe('第一次见你，就移不开眼了。');
    });

    it('思考型模型：content 为空、正文在 reasoning_content → 能回退取到', async () => {
        mockFetch(jsonRes({ content: '', reasoning_content: '其实我早就喜欢你了。' }));
        const ans = await generateCharWhisperReply({ char, userName: '小明', api: API, whisper: '你喜欢我吗' });
        expect(ans).toContain('喜欢你');
    });

    it('正文被 <think> 包裹 → 思维链被剥掉只留台词', async () => {
        mockFetch(jsonRes({ content: '<think>该温柔点</think>当然喜欢你呀。' }));
        const ans = await generateCharWhisperReply({ char, userName: '小明', api: API, whisper: '在吗' });
        expect(ans).toBe('当然喜欢你呀。');
        expect(ans).not.toContain('think');
    });

    it('未配置 API（空 baseUrl）→ 返回空串，不发请求（组件据此用模板兜底）', async () => {
        const fn = mockFetch(jsonRes({ content: 'x' }));
        const ans = await generateCharQuestionAnswer({ char, userName: '小明', api: { baseUrl: '', model: '' }, question: 'q' });
        expect(ans).toBe('');
        expect(fn).not.toHaveBeenCalled();
    });

    it('网络/解析异常 → 失败全吞返回空串（不抛错阻塞 UI）', async () => {
        mockFetch(async () => { throw new Error('network down'); });
        const ans = await generateCharQuestionAnswer({ char, userName: '小明', api: API, question: 'q' });
        expect(ans).toBe('');
    });
});
