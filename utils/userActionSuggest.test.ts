import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseActions, suggestUserActions } from './userActionSuggest';
import { extractContent, safeResponseJson } from './safeApi';

describe('parseActions —— 帮 user 回复候选解析', () => {
    it('正常 JSON 数组', () => {
        expect(parseActions('["在干嘛呀","你是不是在忙","刚才那事我想了想"]'))
            .toEqual(['在干嘛呀', '你是不是在忙', '刚才那事我想了想']);
    });

    it('模型把数组包进对象 {"suggestions":[…]} 也能解析（不再空白）', () => {
        expect(parseActions('{"suggestions":["在干嘛","吃了吗","想你了"]}'))
            .toEqual(['在干嘛', '吃了吗', '想你了']);
        expect(parseActions('{"actions":["走起","下次约"]}')).toEqual(['走起', '下次约']);
    });

    it('```json 代码块包裹', () => {
        const raw = '```json\n["想你了","早点睡","明天见"]\n```';
        expect(parseActions(raw)).toEqual(['想你了', '早点睡', '明天见']);
    });

    it('被 max_tokens 截断（缺收尾 ]、最后一句没闭合）→ 打捞已完整的、丢半截', () => {
        // 复现 bug：截断后旧逻辑会把 ```json、[、半截串当成 3 条选项漏出来
        const raw = '```json\n[\n"讨饶没有，讨个",\n"那我先撤了哈",\n"你不理我我可走了，真的很';
        const out = parseActions(raw);
        expect(out).toEqual(['讨饶没有，讨个', '那我先撤了哈']);
        // 绝不能把 ```json / [ / 半截串漏成选项
        expect(out).not.toContain('```json');
        expect(out).not.toContain('[');
        expect(out.some(s => s.includes('你不理我'))).toBe(false);
    });

    it('完全不是 JSON（纯换行列表）→ 按行兜底，过滤 JSON 残骸', () => {
        const raw = '在干嘛\n你忙吗\n```json\n[\n想你了';
        const out = parseActions(raw);
        expect(out).toContain('在干嘛');
        expect(out).toContain('你忙吗');
        expect(out).toContain('想你了');
        expect(out).not.toContain('```json');
        expect(out).not.toContain('[');
    });

    it('剥掉泄漏的语气标签前缀', () => {
        const raw = '["*Tone 2: Playful/ 你在忙吗","【调侃】少来这套","语气1：在干嘛"]';
        expect(parseActions(raw)).toEqual(['你在忙吗', '少来这套', '在干嘛']);
    });

    it('对象数组 {text:...} 兼容', () => {
        const raw = '[{"text":"在吗"},{"content":"想你"}]';
        expect(parseActions(raw)).toEqual(['在吗', '想你']);
    });

    it('字符串里含中文引号/逗号也能完整保留（长消息不被截断）', () => {
        const long = '我刚才想了好久，还是觉得那句话说得有点重，对不起，我不是故意的';
        expect(parseActions(`["${long}","没事吧"]`)).toEqual([long, '没事吧']);
    });

    it('空输入返回空数组', () => {
        expect(parseActions('')).toEqual([]);
    });
});

describe('suggestUserActions —— 保底至少 4 条（不足自动补轮）', () => {
    const api = { baseUrl: 'https://x.test/v1', apiKey: 'k', model: 'm' };
    const char: any = { id: 'c', name: '流浪者', description: '' };
    const userProfile: any = { name: '我', avatar: '', bio: '' };
    const recent: any[] = [{ id: 1, role: 'user', type: 'text', content: '在吗', timestamp: 0 }];

    afterEach(() => vi.restoreAllMocks());

    const mockReplies = (...batches: string[][]) => {
        let i = 0;
        vi.stubGlobal('fetch', vi.fn(async () => {
            const arr = batches[Math.min(i, batches.length - 1)];
            i++;
            const payload = JSON.stringify({ choices: [{ message: { content: JSON.stringify(arr) } }] });
            return {
                ok: true,
                text: async () => payload,
                json: async () => JSON.parse(payload),
            } as any;
        }));
    };

    it('第一轮只给 2 条 → 自动再要一轮补到 ≥4', async () => {
        mockReplies(['被你看穿了', '你怎么知道的'], ['那我先撤了', '逗你的啦', '不理我啦']);
        const out = await suggestUserActions({ api, char, userProfile, recent });
        expect(out.length).toBeGreaterThanOrEqual(4);
        // 不重复
        expect(new Set(out).size).toBe(out.length);
    });

    it('发给模型的行动建议请求带完整角色设定、用户设定和世界书', async () => {
        mockReplies(['a', 'b', 'c', 'd']);
        const fullChar: any = {
            ...char,
            description: '剪影集列表备注不能丢',
            systemPrompt: '完整核心人设不能丢',
            worldview: '世界观长文不能丢',
            lifeProfile: { content: '生活侧写正文不能丢' },
            mountedWorldbooks: [{
                id: 'wb-1',
                title: '剪报夹条目',
                category: '世界书分组',
                content: '剪报夹完整正文不能丢',
                enabled: true,
            }],
        };
        const fullUserProfile: any = {
            ...userProfile,
            bio: '用户完整自述不能丢',
            patSuffix: '拍一拍后缀不能丢',
        };

        await suggestUserActions({ api, char: fullChar, userProfile: fullUserProfile, recent });

        const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
        const system = body.messages.find((m: any) => m.role === 'system')?.content || '';
        expect(system).toContain('full-character-user-settings');
        expect(system).toContain('完整核心人设不能丢');
        expect(system).toContain('剪影集列表备注不能丢');
        expect(system).toContain('世界观长文不能丢');
        expect(system).toContain('生活侧写正文不能丢');
        expect(system).toContain('剪报夹完整正文不能丢');
        expect(system).toContain('用户完整自述不能丢');
        expect(system).toContain('拍一拍后缀不能丢');
    });

    it('第一轮就给满 6 条 → 不再补轮（只调用一次 fetch）', async () => {
        mockReplies(['a', 'b', 'c', 'd', 'e', 'f']);
        const out = await suggestUserActions({ api, char, userProfile, recent });
        expect(out).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
        expect((globalThis.fetch as any).mock.calls.length).toBe(1);
    });

    it('模型每轮都只给同样 2 条 → 补轮后去重无新增即收手，返回这 2 条（不死循环）', async () => {
        mockReplies(['就这两条', '没别的了']);
        const out = await suggestUserActions({ api, char, userProfile, recent });
        expect(out).toEqual(['就这两条', '没别的了']);
        // 第一轮 + 至多一轮补（发现没新增即停）
        expect((globalThis.fetch as any).mock.calls.length).toBeLessThanOrEqual(2);
    });
});

describe('extractContent —— 兼容思考型模型 / 分片 content', () => {
    it('content 为字符串：正常取出', () => {
        expect(extractContent({ choices: [{ message: { content: '你好' } }] })).toBe('你好');
    });
    it('content 为分片数组（Gemini 风）：拍平拼接，不再崩成空白', () => {
        const data = { choices: [{ message: { content: [{ type: 'text', text: '前半' }, { type: 'text', text: '后半' }] } }] };
        expect(extractContent(data)).toBe('前半后半');
    });
    it('content 空 → 回退 reasoning_content / reasoning', () => {
        expect(extractContent({ choices: [{ message: { content: '', reasoning_content: '推理里的答案' } }] })).toBe('推理里的答案');
        expect(extractContent({ choices: [{ message: { content: '', reasoning: '另一个字段' } }] })).toBe('另一个字段');
    });
    it('去掉成对 <think> 思维链', () => {
        expect(extractContent({ choices: [{ message: { content: '<think>想一想</think>["a","b"]' } }] })).toBe('["a","b"]');
    });
});

describe('safeResponseJson —— SSE reasoning 保留', () => {
    it('代理强行返回 SSE 时保留 reasoning_content，供「看看思绪」展示', async () => {
        const body = [
            `data: ${JSON.stringify({ choices: [{ delta: { reasoning: '先想一下', content: '' } }] })}`,
            `data: ${JSON.stringify({ choices: [{ delta: { content: '你好' }, finish_reason: 'stop' }] })}`,
            'data: [DONE]',
        ].join('\n');
        const res = { status: 200, text: async () => body } as unknown as Response;
        const data = await safeResponseJson(res);
        expect(data.choices[0].message.content).toBe('你好');
        expect(data.choices[0].message.reasoning_content).toBe('先想一下');
    });
});
