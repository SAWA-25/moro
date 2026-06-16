import { describe, it, expect } from 'vitest';
import { parseActions } from './userActionSuggest';

describe('parseActions —— 帮 user 回复候选解析', () => {
    it('正常 JSON 数组', () => {
        expect(parseActions('["在干嘛呀","你是不是在忙","刚才那事我想了想"]'))
            .toEqual(['在干嘛呀', '你是不是在忙', '刚才那事我想了想']);
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
