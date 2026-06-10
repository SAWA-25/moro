import { describe, it, expect, beforeEach } from 'vitest';
import { WorldbookRuntime } from './worldbookRuntime';
import { CharacterProfile, Worldbook } from '../types';

const wb = (over: Partial<Worldbook> & { id: string; title: string; content: string }): Worldbook => ({
    category: '测试书',
    createdAt: 0,
    updatedAt: 0,
    ...over,
});

const charWith = (mounted: { id: string; title: string; content: string; category?: string }[]): CharacterProfile => ({
    id: 'c1',
    name: '角色A',
    avatar: '',
    description: '',
    systemPrompt: '',
    memories: [],
    mountedWorldbooks: mounted,
});

describe('WorldbookRuntime 解析与开关', () => {
    beforeEach(() => WorldbookRuntime.sync([], {}));

    it('局部条目：挂载才生效；全局条目：无需挂载', () => {
        WorldbookRuntime.sync([
            wb({ id: 'a', title: '局部A', content: 'A内容' }),
            wb({ id: 'b', title: '全局B', content: 'B内容', scope: 'global' }),
        ], {});
        // 未挂载任何书
        const none = WorldbookRuntime.resolveForChar(charWith([]));
        expect(none.local).toHaveLength(0);
        expect(none.global.map(e => e.id)).toEqual(['b']);
        // 挂载了 a
        const some = WorldbookRuntime.resolveForChar(charWith([{ id: 'a', title: '局部A', content: '旧快照' }]));
        expect(some.local.map(e => e.id)).toEqual(['a']);
        expect(some.local[0].content).toBe('A内容'); // 以 live 内容为准
        expect(some.global.map(e => e.id)).toEqual(['b']);
    });

    it('条目开关与整书开关都会拦截（局部与全局一致）', () => {
        WorldbookRuntime.sync([
            wb({ id: 'a', title: 'A', content: 'x', enabled: false }),
            wb({ id: 'b', title: 'B', content: 'x', scope: 'global', enabled: false }),
            wb({ id: 'c', title: 'C', content: 'x', scope: 'global', category: '关掉的书' }),
        ], { '关掉的书': false });
        const r = WorldbookRuntime.resolveForChar(charWith([{ id: 'a', title: 'A', content: 'x' }]));
        expect(r.local).toHaveLength(0);
        expect(r.global).toHaveLength(0);
    });

    it('挂载条目转为全局后不重复：只出现在全局侧', () => {
        WorldbookRuntime.sync([wb({ id: 'a', title: 'A', content: 'x', scope: 'global' })], {});
        const r = WorldbookRuntime.resolveForChar(charWith([{ id: 'a', title: 'A', content: 'x' }]));
        expect(r.local).toHaveLength(0);
        expect(r.global.map(e => e.id)).toEqual(['a']);
    });

    it('没有 live 记录的挂载快照按旧行为生效（向后兼容）', () => {
        WorldbookRuntime.sync([], {});
        const r = WorldbookRuntime.resolveForChar(charWith([{ id: 'ghost', title: '旧卡快照', content: '内容', category: '某书' }]));
        expect(r.local.map(e => e.id)).toEqual(['ghost']);
    });
});

describe('buildPromptSections 位置与顺序', () => {
    it('同一位置内：局部在前、全局在后，各自按 order 升序', () => {
        WorldbookRuntime.sync([
            wb({ id: 'l2', title: '局部慢', content: 'L2', order: 20 }),
            wb({ id: 'l1', title: '局部快', content: 'L1', order: 10 }),
            wb({ id: 'g1', title: '全局快', content: 'G1', order: 1, scope: 'global' }),
        ], {});
        const char = charWith([
            { id: 'l2', title: '局部慢', content: 'L2' },
            { id: 'l1', title: '局部快', content: 'L1' },
        ]);
        const { afterChar, beforeChar } = WorldbookRuntime.buildPromptSections(char);
        expect(beforeChar).toBe('');
        // 局部块整体在全局块之前（即使全局 order 更小）
        const iL1 = afterChar.indexOf('局部快');
        const iL2 = afterChar.indexOf('局部慢');
        const iG1 = afterChar.indexOf('全局快');
        expect(iL1).toBeGreaterThan(-1);
        expect(iL1).toBeLessThan(iL2);
        expect(iL2).toBeLessThan(iG1);
        expect(afterChar).toContain('### 扩展设定集 (Worldbooks)');
        expect(afterChar).toContain('### 全局扩展设定 (Global Worldbooks)');
    });

    it('before_char 与 after_char 分别产出；inlineDepth=false 时 @Depth 条目单独返回', () => {
        WorldbookRuntime.sync([
            wb({ id: 'pre', title: '前置', content: 'P', position: 'before_char' }),
            wb({ id: 'post', title: '后置', content: 'Q' }),
            wb({ id: 'd', title: '深度', content: 'D', position: 'depth_user', depth: 2, scope: 'global' }),
        ], {});
        const char = charWith([
            { id: 'pre', title: '前置', content: 'P' },
            { id: 'post', title: '后置', content: 'Q' },
        ]);
        const inline = WorldbookRuntime.buildPromptSections(char);
        expect(inline.beforeChar).toContain('前置');
        expect(inline.afterChar).toContain('后置');
        expect(inline.afterChar).toContain('深度'); // 内联降级
        expect(inline.depthEntries).toHaveLength(0);

        const split = WorldbookRuntime.buildPromptSections(char, { inlineDepth: false });
        expect(split.afterChar).not.toContain('深度');
        expect(split.depthEntries).toHaveLength(1);
        expect(split.depthEntries[0]).toMatchObject({ id: 'd', position: 'depth_user', depth: 2 });
    });

    it('skipGlobal（群聊场景）下不输出全局段', () => {
        WorldbookRuntime.sync([wb({ id: 'g', title: '全局', content: 'G', scope: 'global' })], {});
        const r = WorldbookRuntime.buildPromptSections(charWith([]), { skipGlobal: true });
        expect(r.afterChar).toBe('');
        expect(WorldbookRuntime.buildGlobalSharedBlock()).toContain('全局');
    });
});

describe('spliceDepthMessages @Depth 注入', () => {
    const baseMessages = () => ([
        { role: 'system', content: 'SYS' },
        { role: 'user', content: 'm1' },
        { role: 'assistant', content: 'm2' },
        { role: 'user', content: 'm3' },
    ]);

    const entry = (id: string, position: any, depth: number, content: string) => ({
        id, title: id, content, category: 'c', scope: 'global' as const, position, depth, order: 100,
    });

    it('depth=0 插在最末，depth=2 插在倒数第 2 条之前，role 正确', () => {
        const msgs = baseMessages();
        WorldbookRuntime.spliceDepthMessages(msgs, [
            entry('tail', 'depth_system', 0, 'TAIL'),
            entry('mid', 'depth_assistant', 2, 'MID'),
        ]);
        expect(msgs.map(m => m.content)).toEqual(['SYS', 'm1', 'MID', 'm2', 'm3', 'TAIL']);
        expect(msgs[2].role).toBe('assistant');
        expect(msgs[5].role).toBe('system');
    });

    it('超大深度被钳制在首条 system 之后；同 role+depth 合并为一条', () => {
        const msgs = baseMessages();
        WorldbookRuntime.spliceDepthMessages(msgs, [
            entry('a', 'depth_user', 99, 'A'),
            entry('b', 'depth_user', 99, 'B'),
        ]);
        expect(msgs).toHaveLength(5);
        expect(msgs[1]).toEqual({ role: 'user', content: 'A\n\nB' });
    });
});
