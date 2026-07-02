import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WorldbookRuntime, type WorldbookGroupScope, type WorldbookGroupSettings } from './worldbookRuntime';
import { CharacterProfile, Worldbook } from '../types';

const wb = (over: Partial<Worldbook> & { id: string; title: string; content: string }): Worldbook => ({
    category: '测试书',
    createdAt: 0,
    updatedAt: 0,
    activation: 'keyword',
    keys: ['测试'],
    ...over,
});

const charWith = (mounted: { id: string; title: string; content: string; category?: string; enabled?: boolean }[]): CharacterProfile => ({
    id: 'c1',
    name: '角色A',
    avatar: '',
    description: '',
    systemPrompt: '',
    memories: [],
    mountedWorldbooks: mounted,
});

const syncBooks = (
    books: Worldbook[],
    toggles: Record<string, boolean> = {},
    scopes: Record<string, WorldbookGroupScope> = {},
    settings: Record<string, WorldbookGroupSettings> = {},
) => WorldbookRuntime.sync(books, toggles, scopes, settings);

describe('WorldbookRuntime 解析与开关', () => {
    beforeEach(() => {
        syncBooks([]);
        WorldbookRuntime.setScanContext(['这是测试消息']);
        WorldbookRuntime.setExtraCategories(null);
    });

    it('局部书需挂载；全局书无需挂载，但条目触发方式不变', () => {
        syncBooks([
            wb({ id: 'a', title: '局部A', content: 'A内容', category: '局部书' }),
            wb({ id: 'b', title: '全局B', content: 'B内容', category: '全局书' }),
        ], {}, { 全局书: 'global' });

        const none = WorldbookRuntime.resolveForChar(charWith([]));
        expect(none.local).toHaveLength(0);
        expect(none.global.map(e => e.id)).toEqual(['b']);

        const some = WorldbookRuntime.resolveForChar(charWith([{ id: 'a', title: '局部A', content: '旧快照', category: '局部书' }]));
        expect(some.local.map(e => e.id)).toEqual(['a']);
        expect(some.local[0].content).toBe('A内容');
        expect(some.global.map(e => e.id)).toEqual(['b']);
    });

    it('整本全局不会把条目改成常驻：关键词仍需命中，常驻才无条件注入', () => {
        syncBooks([
            wb({ id: 'kw', title: '关键词', content: 'K', category: '全局书', activation: 'keyword', keys: ['魔法'] }),
            wb({ id: 'always', title: '常驻', content: 'A', category: '全局书', activation: 'always' }),
        ], {}, { 全局书: 'global' });

        WorldbookRuntime.setScanContext(null);
        expect(WorldbookRuntime.resolveForChar(charWith([])).global.map(e => e.id)).toEqual(['always']);

        WorldbookRuntime.setScanContext(['说到魔法']);
        expect(WorldbookRuntime.resolveForChar(charWith([])).global.map(e => e.id)).toEqual(['kw', 'always']);
    });

    it('旧条目 scope 不再决定整本作用域：未设整本全局时仍需挂载', () => {
        syncBooks([
            wb({ id: 'legacy', title: '旧全局条目', content: 'L', scope: 'global' }),
        ]);

        expect(WorldbookRuntime.resolveForChar(charWith([])).global).toHaveLength(0);
        const mounted = WorldbookRuntime.resolveForChar(charWith([{ id: 'legacy', title: '旧全局条目', content: '旧快照' }]));
        expect(mounted.local.map(e => e.id)).toEqual(['legacy']);
    });

    it('条目开关与整书开关都会拦截（局部书与全局书一致）', () => {
        syncBooks([
            wb({ id: 'a', title: 'A', content: 'x', enabled: false }),
            wb({ id: 'b', title: 'B', content: 'x', category: '全局书', enabled: false }),
            wb({ id: 'c', title: 'C', content: 'x', category: '关掉的书' }),
        ], { 关掉的书: false }, { 全局书: 'global', 关掉的书: 'global' });

        const r = WorldbookRuntime.resolveForChar(charWith([{ id: 'a', title: 'A', content: 'x' }]));
        expect(r.local).toHaveLength(0);
        expect(r.global).toHaveLength(0);
    });

    it('挂载的局部书切为整本全局后不重复：只出现在全局侧', () => {
        syncBooks([wb({ id: 'a', title: 'A', content: 'x' })], {}, { 测试书: 'global' });
        const r = WorldbookRuntime.resolveForChar(charWith([{ id: 'a', title: 'A', content: 'x' }]));
        expect(r.local).toHaveLength(0);
        expect(r.global.map(e => e.id)).toEqual(['a']);
    });

    it('没有 live 记录的挂载快照按旧行为生效（向后兼容）', () => {
        syncBooks([]);
        const r = WorldbookRuntime.resolveForChar(charWith([{ id: 'ghost', title: '旧卡快照', content: '内容', category: '某书' }]));
        expect(r.local.map(e => e.id)).toEqual(['ghost']);
    });

    it('整本挂载实况同步：书里新加的条目自动注入，已禁用的新条目不注入', () => {
        syncBooks([
            wb({ id: 'a', title: '老条目', content: 'A' }),
            wb({ id: 'new1', title: '后来加的', content: 'N1' }),
            wb({ id: 'new2', title: '后来加的但已关', content: 'N2', enabled: false }),
            wb({ id: 'other', title: '别的书的条目', content: 'O', category: '别的书' }),
        ]);

        const r = WorldbookRuntime.resolveForChar(charWith([{ id: 'a', title: '老条目', content: '旧快照' }]));
        expect(r.local.map(e => e.id).sort()).toEqual(['a', 'new1']);
    });

    it('未填分组的条目：整书开关用「未分类设定 (General)」键（与世界书 App 展示一致）', () => {
        syncBooks([
            wb({ id: 'a', title: '无分组', content: 'x', category: undefined as any }),
        ], { '未分类设定 (General)': false });

        const r = WorldbookRuntime.resolveForChar(charWith([{ id: 'a', title: '无分组', content: 'x' }]));
        expect(r.local).toHaveLength(0);
    });
});

describe('buildPromptSections 位置与顺序', () => {
    beforeEach(() => {
        syncBooks([]);
        WorldbookRuntime.setScanContext(['这是测试消息']);
        WorldbookRuntime.setExtraCategories(null);
    });

    it('同一位置内：局部在前、全局在后，各自按 order 升序', () => {
        syncBooks([
            wb({ id: 'l2', title: '局部慢', content: 'L2', order: 20, category: '局部书' }),
            wb({ id: 'l1', title: '局部快', content: 'L1', order: 10, category: '局部书' }),
            wb({ id: 'g1', title: '全局快', content: 'G1', order: 1, category: '全局书' }),
        ], {}, { 全局书: 'global' });

        const char = charWith([
            { id: 'l2', title: '局部慢', content: 'L2', category: '局部书' },
            { id: 'l1', title: '局部快', content: 'L1', category: '局部书' },
        ]);
        const { afterChar, beforeChar } = WorldbookRuntime.buildPromptSections(char);
        expect(beforeChar).toBe('');

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
        syncBooks([
            wb({ id: 'pre', title: '前置', content: 'P', position: 'before_char' }),
            wb({ id: 'post', title: '后置', content: 'Q' }),
            wb({ id: 'd', title: '深度', content: 'D', category: '全局书', position: 'depth_user', depth: 2 }),
        ], {}, { 全局书: 'global' });

        const char = charWith([
            { id: 'pre', title: '前置', content: 'P' },
            { id: 'post', title: '后置', content: 'Q' },
        ]);
        const inline = WorldbookRuntime.buildPromptSections(char);
        expect(inline.beforeChar).toContain('前置');
        expect(inline.afterChar).toContain('后置');
        expect(inline.afterChar).toContain('深度');
        expect(inline.depthEntries).toHaveLength(0);

        const split = WorldbookRuntime.buildPromptSections(char, { inlineDepth: false });
        expect(split.afterChar).not.toContain('深度');
        expect(split.depthEntries).toHaveLength(1);
        expect(split.depthEntries[0]).toMatchObject({ id: 'd', position: 'depth_user', depth: 2 });
    });

    it('skipGlobal（群聊场景）下不输出全局段，共享全局块仍按整本作用域渲染', () => {
        syncBooks([wb({ id: 'g', title: '全局', content: 'G', category: '全局书', activation: 'always' })], {}, { 全局书: 'global' });
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
        id,
        title: id,
        content,
        category: 'c',
        scope: 'global' as const,
        position,
        depth,
        order: 100,
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

describe('关键词激活（ST 绿灯条目移植）', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        syncBooks([]);
        WorldbookRuntime.setScanContext(null);
        WorldbookRuntime.setExtraCategories(null);
    });

    const kw = (over: Partial<Worldbook> & { id: string }): Worldbook => ({
        title: over.id,
        content: `${over.id}内容`,
        category: '局部书',
        createdAt: 0,
        updatedAt: 0,
        activation: 'keyword',
        ...over,
    });

    const mountedKwChar = () => charWith([{ id: 'k1', title: 'k1', content: 'k1内容', category: '局部书' }]);

    it('无扫描上下文时关键词条目不注入，常驻条目不受影响', () => {
        syncBooks([
            kw({ id: 'k1', keys: ['魔法'] }),
            kw({ id: 'g1', category: '全局书', keys: ['不会扫描'] }),
            kw({ id: 'g2', category: '全局书', activation: 'always' }),
        ], {}, { 全局书: 'global' });

        const { local, global } = WorldbookRuntime.resolveForChar(mountedKwChar());
        expect(local).toHaveLength(0);
        expect(global.map(e => e.id)).toEqual(['g2']);
    });

    it('扫描命中主关键词才注入（默认大小写不敏感）', () => {
        syncBooks([
            kw({ id: 'k1', keys: ['Magic'] }),
            kw({ id: 'k2', keys: ['龙族'] }),
        ]);
        WorldbookRuntime.setScanContext(['今天聊聊 mAgIc 的事']);
        const { local } = WorldbookRuntime.resolveForChar(mountedKwChar());
        expect(local.map(e => e.id)).toEqual(['k1']);
    });

    it('大小写敏感时不同 case 不命中', () => {
        syncBooks([kw({ id: 'k1', keys: ['Magic'], caseSensitive: true })]);
        WorldbookRuntime.setScanContext(['说说 magic']);
        expect(WorldbookRuntime.resolveForChar(mountedKwChar()).local).toHaveLength(0);
        WorldbookRuntime.setScanContext(['说说 Magic']);
        expect(WorldbookRuntime.resolveForChar(mountedKwChar()).local).toHaveLength(1);
    });

    it('selective：主关键词 + 任一二级词需同时命中', () => {
        syncBooks([
            kw({ id: 'k1', keys: ['魔法'], secondaryKeys: ['学院'], selective: true }),
        ]);
        WorldbookRuntime.setScanContext(['魔法真有趣']);
        expect(WorldbookRuntime.resolveForChar(mountedKwChar()).local).toHaveLength(0);
        WorldbookRuntime.setScanContext(['魔法学院开学了']);
        expect(WorldbookRuntime.resolveForChar(mountedKwChar()).local).toHaveLength(1);
    });

    it('selectiveLogic 支持 ST 四种二级词逻辑', () => {
        const triggered = (selectiveLogic: Worldbook['selectiveLogic'], text: string) => {
            syncBooks([kw({ id: 'k1', keys: ['主线'], secondaryKeys: ['红', '蓝'], selective: true, selectiveLogic })]);
            WorldbookRuntime.setScanContext([text]);
            return WorldbookRuntime.resolveForChar(mountedKwChar()).local.length > 0;
        };

        expect(triggered('and_any', '主线 红')).toBe(true);
        expect(triggered('and_any', '主线')).toBe(false);
        expect(triggered('and_all', '主线 红 蓝')).toBe(true);
        expect(triggered('and_all', '主线 红')).toBe(false);
        expect(triggered('not_any', '主线')).toBe(true);
        expect(triggered('not_any', '主线 红')).toBe(false);
        expect(triggered('not_all', '主线 红')).toBe(true);
        expect(triggered('not_all', '主线 红 蓝')).toBe(false);
    });

    it('整词匹配避免词内命中，/regex/i 关键词按正则执行', () => {
        syncBooks([
            kw({ id: 'k1', keys: ['cat'], matchWholeWords: true }),
            kw({ id: 'k2', keys: ['/dragon\\d+/i'] }),
        ]);
        WorldbookRuntime.setScanContext(['concatenate DRAGON42']);
        expect(WorldbookRuntime.resolveForChar(mountedKwChar()).local.map(e => e.id)).toEqual(['k2']);

        WorldbookRuntime.setScanContext(['a cat appears']);
        expect(WorldbookRuntime.resolveForChar(mountedKwChar()).local.map(e => e.id)).toEqual(['k1']);
    });

    it('触发概率：0 必定失败，100 必定通过，中间值按 Math.random 判定', () => {
        syncBooks([
            kw({ id: 'p0', activation: 'always', probability: 0 }),
            kw({ id: 'p100', activation: 'always', probability: 100 }),
            kw({ id: 'p50', activation: 'always', probability: 50 }),
        ]);
        const random = vi.spyOn(Math, 'random').mockReturnValue(0.49);
        const mounted = charWith([{ id: 'p0', title: 'p0', content: 'p0内容', category: '局部书' }]);
        expect(WorldbookRuntime.resolveForChar(mounted).local.map(e => e.id)).toEqual(['p100', 'p50']);

        random.mockReturnValue(0.5);
        expect(WorldbookRuntime.resolveForChar(mounted).local.map(e => e.id)).toEqual(['p100']);
    });

    it('整书 token 预算按 order 裁剪，ignoreBudget 条目不计入预算', () => {
        syncBooks([
            kw({ id: 'a', activation: 'always', order: 1, content: 'abcdefghij' }),
            kw({ id: 'b', activation: 'always', order: 2, content: 'extra' }),
            kw({ id: 'c', activation: 'always', order: 3, content: 'ignored', ignoreBudget: true }),
        ], {}, {}, { 局部书: { tokenBudget: 3 } });

        expect(WorldbookRuntime.resolveForChar(charWith([{ id: 'a', title: 'a', content: 'a内容', category: '局部书' }])).local.map(e => e.id)).toEqual(['a', 'c']);
    });

    it('递归扫描：已激活条目正文可触发同书关键词条目', () => {
        syncBooks([
            kw({ id: 'seed', activation: 'always', order: 1, content: '传闻里提到了龙门。' }),
            kw({ id: 'k1', keys: ['龙门'], order: 2, content: '龙门是隐藏地点。' }),
        ], {}, {}, { 局部书: { recursiveScanning: true, maxRecursionSteps: 2 } });
        WorldbookRuntime.setScanContext(['今天聊普通日常']);
        expect(WorldbookRuntime.resolveForChar(charWith([{ id: 'seed', title: 'seed', content: 'seed', category: '局部书' }])).local.map(e => e.id)).toEqual(['seed', 'k1']);

        syncBooks([
            kw({ id: 'seed', activation: 'always', order: 1, content: '传闻里提到了龙门。' }),
            kw({ id: 'k1', keys: ['龙门'], order: 2, content: '龙门是隐藏地点。' }),
        ]);
        WorldbookRuntime.setScanContext(['今天聊普通日常']);
        expect(WorldbookRuntime.resolveForChar(charWith([{ id: 'seed', title: 'seed', content: 'seed', category: '局部书' }])).local.map(e => e.id)).toEqual(['seed']);
    });

    it('扫描深度只看最近 N 条消息', () => {
        syncBooks([kw({ id: 'k1', keys: ['魔法'], scanDepth: 2 })]);
        WorldbookRuntime.setScanContext(['提到了魔法', '别的话', '更多别的话']);
        expect(WorldbookRuntime.resolveForChar(mountedKwChar()).local).toHaveLength(0);
        WorldbookRuntime.setScanContext(['别的话', '提到了魔法', '更多别的话']);
        expect(WorldbookRuntime.resolveForChar(mountedKwChar()).local).toHaveLength(1);
    });

    it('局部关键词条目必须挂载整本书后才按扫描结果注入', () => {
        syncBooks([kw({ id: 'k1', keys: ['咒语'] })]);
        WorldbookRuntime.setScanContext(['念一段咒语']);
        expect(WorldbookRuntime.resolveForChar(charWith([])).local).toHaveLength(0);
        expect(WorldbookRuntime.resolveForChar(mountedKwChar()).local).toHaveLength(1);
    });

    it('全局书里的关键词条目无需绑定角色，但仍必须命中关键词', () => {
        syncBooks([
            kw({ id: 'g1', category: '全局书', keys: ['咒语'] }),
        ], {}, { 全局书: 'global' });

        WorldbookRuntime.setScanContext(['平平无奇的一天']);
        expect(WorldbookRuntime.resolveForChar(charWith([])).global).toHaveLength(0);
        WorldbookRuntime.setScanContext(['念一段咒语']);
        expect(WorldbookRuntime.resolveForChar(charWith([])).global.map(e => e.id)).toEqual(['g1']);
    });
});
