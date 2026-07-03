import { describe, it, expect, afterEach, vi } from 'vitest';
import {
    applyCoupleAutoCareDraft,
    applyCoupleQuestionAnswer,
    buildCoupleSpacePromptBlock,
    COUPLE_EYES_BODY_MAX,
    ensureCoupleSpace,
    generateCharQuestionAnswer,
    generateCharWhisperReply,
    generateCoupleEyesCard,
    generateCoupleRecap,
    isCoupleAutoCareEnabled,
    shouldRunCoupleAutoCare,
    type CoupleApi,
} from './coupleSpace';
import { DB } from './db';
import type { CharacterProfile, CoupleSpace } from '../types';

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

    // 回归：推理模型（gemini-3.1-pro / DeepSeek-R1 …）先吃一大截 token 做思维链，再吐正文。
    // 之前 max_tokens 只按答案长度给（100~240），思维链没想完就撞顶被截断、正文为空 → 整个
    // 情侣空间退回模板（用户报「后台调用成功、扣了 token，界面却没有 AI 回复」）。修复是给答案
    // 预算叠加思维链 headroom；这里钉死「发出去的 max_tokens 必须远大于答案长度」，防回归。
    it('请求带足够 max_tokens：给推理模型思维链留 headroom（防回归到 100~240）', async () => {
        const fn = mockFetch(jsonRes({ content: '嗯～' }));
        await generateCharQuestionAnswer({ char, userName: '小明', api: API, question: '在吗' });
        // mockFetch 的签名是无参的，calls 类型推断成空元组 → 取 fetch(url, init) 的第 2 个实参要绕过类型
        const [, init] = (fn.mock.calls[0] as unknown as [string, RequestInit]);
        const body = JSON.parse(init.body as string);
        // 思维链 headroom 远超答案长度：至少要 1000 才够推理模型想完
        expect(body.max_tokens).toBeGreaterThanOrEqual(1000);
    });
});

describe('情侣空间 2.0 数据兼容与后台自经营', () => {
    const now = new Date(2026, 6, 3, 12, 0, 0).getTime();

    function oldSpace(partial: Partial<CoupleSpace> = {}): CoupleSpace {
        return {
            intimacy: 12,
            moments: [],
            anniversaries: [],
            photos: [],
            tasks: [],
            whispers: [],
            interactions: [],
            createdAt: now - 10_000,
            updatedAt: now - 5_000,
            ...partial,
        } as CoupleSpace;
    }

    it('ensureCoupleSpace 会给旧空间补齐 v2 字段，且旧空间默认开启后台自经营', () => {
        const space = ensureCoupleSpace({ coupleSpace: oldSpace() });

        expect(space.settings?.theme).toBe('clean');
        expect(space.settings?.autoCareEnabled).toBeUndefined();
        expect(space.profile?.rituals).toEqual([]);
        expect(space.memoryCards).toEqual([]);
        expect(space.recaps).toEqual([]);
        expect(space.dailyCheckins).toEqual([]);
        expect(space.autoCare).toEqual({});
        expect(space.eyesCards).toEqual([]);
        expect(isCoupleAutoCareEnabled(space)).toBe(true);
    });

    it('ensureCoupleSpace 会把旧提问箱记录默认视为已回答', () => {
        const space = ensureCoupleSpace({
            coupleSpace: oldSpace({
                questions: [{ id: 'qa-old', question: '你会想我吗', answer: '会。', at: now }],
            }),
        });

        expect(space.questions?.[0]).toMatchObject({
            id: 'qa-old',
            status: 'answered',
            visibility: 'anonymous',
            source: 'questionBox',
        });
    });

    it('单个空间关闭 autoCareEnabled=false 后不会触发自动经营', () => {
        const space = ensureCoupleSpace({ coupleSpace: oldSpace({ settings: { autoCareEnabled: false, theme: 'clean' } }) });

        expect(isCoupleAutoCareEnabled(space)).toBe(false);
        expect(shouldRunCoupleAutoCare(space, now)).toMatchObject({ shouldRun: false, reason: 'disabled' });
    });

    it('后台自经营遵守每日动态上限与三天回顾冷却', () => {
        const fresh = ensureCoupleSpace({ coupleSpace: oldSpace() });
        expect(shouldRunCoupleAutoCare(fresh, now)).toMatchObject({ shouldRun: true, allowRecap: true });

        const todayAndRecentRecap = ensureCoupleSpace({
            coupleSpace: oldSpace({ autoCare: { lastMomentAt: now - 60_000, lastRecapAt: now - 60_000 } }),
        });
        expect(shouldRunCoupleAutoCare(todayAndRecentRecap, now)).toMatchObject({ shouldRun: false, allowRecap: false, reason: 'cooldown' });

        const recapOnly = ensureCoupleSpace({
            coupleSpace: oldSpace({ autoCare: { lastMomentAt: now - 60_000, lastRecapAt: now - 4 * 24 * 60 * 60 * 1000 } }),
        });
        expect(shouldRunCoupleAutoCare(recapOnly, now)).toMatchObject({ shouldRun: true, allowRecap: true, reason: 'recap-only' });
    });

    it('applyCoupleAutoCareDraft 写入自动产物；失败/none 全吞但记录状态', () => {
        const space = ensureCoupleSpace({ coupleSpace: oldSpace() });
        const applied = applyCoupleAutoCareDraft(space, { kind: 'moment', text: '路过花店时突然想把这束花贴进来。', mood: '🌷' }, { source: 'proactive', text: '路过花店', at: now }, now);

        expect(applied.applied).toBe('moment');
        expect(applied.space.moments[0]).toMatchObject({ author: 'char', text: '路过花店时突然想把这束花贴进来。', mood: '🌷' });
        expect(applied.space.autoCare?.lastMomentAt).toBe(now);

        const failed = applyCoupleAutoCareDraft(applied.space, null, { source: 'catchup', text: '补齐离线生活', at: now + 1 }, now + 1);
        expect(failed.applied).toBe('none');
        expect(failed.space.autoCare?.lastSource).toBe('catchup');
    });

    it('手动回顾不受后台自动经营开关和三天冷却影响', () => {
        const space = ensureCoupleSpace({
            coupleSpace: oldSpace({
                settings: { autoCareEnabled: false, theme: 'clean' },
                autoCare: { lastRecapAt: now - 60_000 },
            }),
        });
        const applied = applyCoupleAutoCareDraft(space, {
            kind: 'recap',
            title: '本周回顾',
            text: '这周的心事被好好留在空间里。',
            highlights: ['一起完成了一个约定'],
        }, { source: 'manual', text: '用户手动生成情侣空间回顾', at: now }, now);

        expect(applied.applied).toBe('recap');
        expect(applied.space.recaps?.[0].title).toBe('本周回顾');
        expect(applied.space.memoryCards?.[0]).toMatchObject({ kind: 'recap', title: '本周回顾' });
    });

    it('generateCoupleRecap 能解析 summary 格式 JSON 并保留建议项', async () => {
        mockFetch(jsonRes({
            content: JSON.stringify({
                title: '雨天回顾',
                summary: '你们把一个普通雨天过成了两个人的暗号。',
                highlights: ['一起记下雨声', '把晚安说得很认真'],
                suggestedTasks: ['周末一起散步'],
                suggestedWishes: ['去看海'],
            }),
        }));
        const space = ensureCoupleSpace({ coupleSpace: oldSpace({ moments: [{ id: 'm1', author: 'user', text: '今天雨声很好听', createdAt: now, comments: [], likedByChar: false, likedByUser: false }] }) });

        const draft = await generateCoupleRecap({ char, userName: '小明', api: API, space, period: 'week' });
        expect(draft).toMatchObject({
            kind: 'recap',
            title: '雨天回顾',
            text: '你们把一个普通雨天过成了两个人的暗号。',
            suggestedTasks: ['周末一起散步'],
            suggestedWishes: ['去看海'],
        });
    });

    it('generateCoupleEyesCard 能解析 JSON、剥离 think 并限制正文长度', async () => {
        vi.spyOn(DB, 'getRecentMessagesByCharId').mockResolvedValue([
            { id: 1, charId: 'c1', role: 'user', type: 'text', content: '今天我有点累', timestamp: now - 2_000 },
            { id: 2, charId: 'c1', role: 'assistant', type: 'text', content: '那就靠一会儿。', timestamp: now - 1_000 },
        ] as any);
        mockFetch(jsonRes({
            content: `<think>先想想</think>${JSON.stringify({
                summary: 'TA 记得你很累的时候也会努力温柔。',
                tags: ['疲惫', '靠近', '被看见', '会被裁掉', '也会被裁掉'],
                body: '你'.repeat(COUPLE_EYES_BODY_MAX + 80),
                innerVoice: '其实我想把你接住。',
            })}`,
        }));
        const space = ensureCoupleSpace({ coupleSpace: oldSpace({ whispers: [{ id: 'w1', author: 'user', text: '今天有点想你', at: now - 500 }] }) });

        const card = await generateCoupleEyesCard({ char: { ...char, id: 'c1' } as CharacterProfile, userName: '小明', api: API, space, era: 'past' });

        expect(card).toMatchObject({
            era: 'past',
            summary: 'TA 记得你很累的时候也会努力温柔。',
            tags: ['疲惫', '靠近', '被看见', '会被裁掉'],
            innerVoice: '其实我想把你接住。',
            sourceMessageIds: [1, 2],
        });
        expect(card!.body).toHaveLength(COUPLE_EYES_BODY_MAX);
        expect(card!.body).not.toContain('think');
    });

    it('generateCoupleEyesCard 遇到空 API 配置返回 null 且不读取聊天', async () => {
        const spy = vi.spyOn(DB, 'getRecentMessagesByCharId').mockResolvedValue([] as any);
        const fn = mockFetch(jsonRes({ content: '{"summary":"x","body":"y"}' }));

        const card = await generateCoupleEyesCard({ char: { ...char, id: 'c1' } as CharacterProfile, userName: '小明', api: { baseUrl: '', model: '' }, space: ensureCoupleSpace({ coupleSpace: oldSpace() }), era: 'present' });

        expect(card).toBeNull();
        expect(spy).not.toHaveBeenCalled();
        expect(fn).not.toHaveBeenCalled();
    });

    it('提问箱 pending 回填只更新目标问题，不覆盖并发写入', () => {
        const space = ensureCoupleSpace({
            coupleSpace: oldSpace({
                questions: [
                    { id: 'qa1', question: '你会想我吗', answer: '', at: now, status: 'pending', visibility: 'anonymous', source: 'questionBox' },
                    { id: 'qa2', question: '并发写入的问题', answer: '', at: now + 1, status: 'pending', visibility: 'anonymous', source: 'questionBox' },
                ],
            }),
        });

        const next = applyCoupleQuestionAnswer(space, 'qa1', '会，但我不一定承认。', now + 2);

        expect(next.questions?.find(q => q.id === 'qa1')).toMatchObject({
            answer: '会，但我不一定承认。',
            status: 'answered',
            answeredAt: now + 2,
        });
        expect(next.questions?.find(q => q.id === 'qa2')).toMatchObject({
            question: '并发写入的问题',
            answer: '',
            status: 'pending',
        });
    });

    it('聊天上下文注入包含档案、回顾、记忆卡且数量受限', () => {
        const testChar = {
            ...char,
            name: '流浪者',
            coupleSpace: ensureCoupleSpace({
                coupleSpace: oldSpace({
                    profile: { homeName: '雨天备用拥抱处', loveLanguage: '先抱抱再讲道理', rituals: ['睡前互道晚安', '吵架后先牵手', '周五一起吃甜点', '这条应被裁剪'] },
                    memoryCards: [1, 2, 3, 4].map(i => ({ id: `mc${i}`, kind: 'manual', title: `记忆卡${i}`, text: `第${i}张记忆卡`, createdAt: now - i })),
                    recaps: [1, 2, 3].map(i => ({ id: `rc${i}`, period: 'week', periodKey: `2026-W0${i}`, title: `回顾${i}`, summary: `第${i}份关系回顾`, highlights: [], suggestedTasks: [], suggestedWishes: [], sourceIds: [], createdAt: now - i })),
                    eyesCards: [1, 2, 3].map(i => ({ era: (i === 1 ? 'past' : i === 2 ? 'present' : 'future') as any, summary: `第${i}张眼中卡`, tags: [`标签${i}`], body: `正文${i}`, generatedAt: now - i })),
                }),
            }),
        } as CharacterProfile;

        const block = buildCoupleSpacePromptBlock(testChar, '小明');
        expect(block).toContain('情侣档案');
        expect(block).toContain('雨天备用拥抱处');
        expect(block).toContain('先抱抱再讲道理');
        expect(block).toContain('记忆卡1');
        expect(block).toContain('记忆卡3');
        expect(block).not.toContain('记忆卡4');
        expect(block).toContain('回顾1');
        expect(block).toContain('回顾2');
        expect(block).not.toContain('回顾3');
        expect(block).toContain('第1张眼中卡');
        expect(block).toContain('第2张眼中卡');
        expect(block).not.toContain('第3张眼中卡');
        expect(block).toContain('睡前互道晚安');
        expect(block).not.toContain('这条应被裁剪');
    });
});
