/**
 * 世界书运行时（Worldbook Runtime）
 *
 * 解决两个问题：
 * 1. ContextBuilder 是纯静态工具，拿不到 React 状态里的全量世界书——
 *    这里用模块级注册表存一份镜像，由 OSContext 在 worldbooks / 整书开关
 *    变化时调用 sync() 刷新。
 * 2. 局部 / 全局作用域 + SillyTavern 式插入位置的统一解析：
 *    - 局部（scope='local'，默认）：仅当角色挂载（char.mountedWorldbooks）后注入
 *    - 全局（scope='global'）：任意消息都注入，无需挂载
 *    - 两者都尊重条目开关（wb.enabled）与整书开关（按 category，存 localStorage）
 *    - 同一位置内先写局部、再写全局，各自按 order 升序（小的在前，同 ST 净效果）
 *
 * 位置语义见 types.ts 的 WorldbookPosition。@Depth 条目只在主聊天链路
 * （buildChatRequestPayload）按深度插成独立消息；其他调用方内联降级。
 */

import { CharacterProfile, Worldbook, WorldbookPosition } from '../types';

export const GROUP_TOGGLES_KEY = 'worldbook_group_toggles';

export interface ResolvedWbEntry {
    id: string;
    title: string;
    content: string;
    category: string;
    scope: 'local' | 'global';
    position: WorldbookPosition;
    depth: number;
    order: number;
}

export interface WorldbookPromptSections {
    /** 注入到「### 你的身份」之前的文本（可为空串） */
    beforeChar: string;
    /** 注入到现有「扩展设定集」位置的文本（可为空串） */
    afterChar: string;
    /** @Depth 条目（inlineDepth=false 时返回，由聊天链路插成消息） */
    depthEntries: ResolvedWbEntry[];
}

const DEFAULT_DEPTH = 4;
const DEFAULT_ORDER = 100;

// ---------------------------------------------------------------------------
// 注册表
// ---------------------------------------------------------------------------

let liveBooks: Worldbook[] = [];
let groupToggles: Record<string, boolean> = {};

/**
 * 关键词扫描上下文（ST 世界书关键词激活移植）。
 * 主聊天链路在构建 prompt 前用 setScanContext 喂入最近的消息文本，
 * activation='keyword' 的条目据此判定是否注入；构建结束后清空。
 * 为 null 时（约会等无聊天上下文的调用方）关键词条目一律不注入 —— 同 ST：
 * 没有可扫描的文本就不会有命中。常驻条目（默认）不受影响。
 */
let scanMessages: string[] | null = null;

export const loadGroupTogglesFromStorage = (): Record<string, boolean> => {
    try {
        const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(GROUP_TOGGLES_KEY) : null;
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') return parsed;
        }
    } catch { /* 损坏的 JSON 当作全开 */ }
    return {};
};

export const saveGroupTogglesToStorage = (toggles: Record<string, boolean>) => {
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(GROUP_TOGGLES_KEY, JSON.stringify(toggles));
        }
    } catch { /* 存储满等场景静默失败，开关只影响本次会话 */ }
};

const normalizeEntry = (wb: Worldbook): ResolvedWbEntry => ({
    id: wb.id,
    title: wb.title,
    content: wb.content,
    category: wb.category || '通用设定 (General)',
    scope: wb.scope === 'global' ? 'global' : 'local',
    position: wb.position || 'after_char',
    depth: typeof wb.depth === 'number' && wb.depth >= 0 ? wb.depth : DEFAULT_DEPTH,
    order: typeof wb.order === 'number' ? wb.order : DEFAULT_ORDER,
});

export const WorldbookRuntime = {
    /** OSContext 在 worldbooks / 整书开关变化时调用，保持镜像最新 */
    sync(books: Worldbook[], toggles: Record<string, boolean>) {
        liveBooks = books;
        groupToggles = toggles;
    },

    /** 整书开关：undefined 视为开（向后兼容） */
    isBookEnabled(category: string): boolean {
        return groupToggles[category || '通用设定 (General)'] !== false;
    },

    /** 条目是否生效 = 条目开关 && 整书开关 */
    isEntryActive(wb: Worldbook): boolean {
        return wb.enabled !== false && WorldbookRuntime.isBookEnabled(wb.category || '通用设定 (General)');
    },

    /** 主聊天链路设置 / 清空关键词扫描上下文（最近消息文本，旧→新） */
    setScanContext(messages: string[] | null) {
        scanMessages = messages;
    },

    /**
     * 关键词激活判定（ST 绿灯条目语义）：
     * - activation 缺省 / 'always' → 恒真（常驻）
     * - 'keyword' → 扫最近 scanDepth 条消息，任一主关键词命中即激活；
     *   selective=true 且有二级词时需同时命中任一二级词。
     *   无扫描上下文 / 无关键词 → 不激活。
     */
    isEntryTriggered(wb: Worldbook): boolean {
        if (wb.activation !== 'keyword') return true;
        const keys = (wb.keys || []).map(k => k.trim()).filter(Boolean);
        if (keys.length === 0) return false;
        if (!scanMessages || scanMessages.length === 0) return false;

        const depth = typeof wb.scanDepth === 'number' && wb.scanDepth > 0 ? wb.scanDepth : DEFAULT_DEPTH;
        const cs = wb.caseSensitive === true;
        const hay = scanMessages.slice(-depth).join('\n');
        const hayCmp = cs ? hay : hay.toLowerCase();
        const hit = (k: string) => hayCmp.includes(cs ? k : k.toLowerCase());

        if (!keys.some(hit)) return false;
        const secondary = (wb.secondaryKeys || []).map(k => k.trim()).filter(Boolean);
        if (wb.selective && secondary.length > 0 && !secondary.some(hit)) return false;
        return true;
    },

    /**
     * 解析某个角色当前生效的世界书条目。
     *
     * local：char.mountedWorldbooks 逐条对照注册表——
     *   - 注册表里有 live 记录：用 live 的内容与设置；scope 已切到 global 的
     *     跳过（由 global 侧统一收录，避免重复）；条目/整书开关关掉的跳过
     *   - 注册表里没有（书已删 / 卡片自带快照）：按挂载快照原样生效（向后兼容）
     * global：注册表里所有 scope='global' 且生效的条目，无需挂载。
     */
    resolveForChar(
        char: CharacterProfile,
        opts: { skipIds?: Set<string>; skipGlobal?: boolean } = {},
    ): { local: ResolvedWbEntry[]; global: ResolvedWbEntry[] } {
        const skipIds = opts.skipIds;
        const liveById = new Map(liveBooks.map(b => [b.id, b]));
        const seen = new Set<string>();

        const local: ResolvedWbEntry[] = [];
        for (const mounted of (char.mountedWorldbooks || [])) {
            if (!mounted.id || seen.has(mounted.id)) continue;
            if (skipIds?.has(mounted.id)) continue;
            const live = liveById.get(mounted.id);
            if (live) {
                if (live.scope === 'global') continue;          // 全局侧统一收录
                if (!WorldbookRuntime.isEntryActive(live)) continue;
                if (!WorldbookRuntime.isEntryTriggered(live)) continue;  // 关键词条目按扫描结果决定
                if (!live.content?.trim()) continue;
                local.push(normalizeEntry(live));
            } else {
                // 没有 live 记录的挂载快照：维持旧行为，整书开关按快照分组名判断
                if (!WorldbookRuntime.isBookEnabled(mounted.category || '通用设定 (General)')) continue;
                if (!mounted.content?.trim()) continue;
                local.push(normalizeEntry({
                    ...mounted,
                    category: mounted.category || '通用设定 (General)',
                    createdAt: 0,
                    updatedAt: 0,
                } as Worldbook));
            }
            seen.add(mounted.id);
        }
        local.sort((a, b) => a.order - b.order);

        const global: ResolvedWbEntry[] = [];
        if (!opts.skipGlobal) {
            for (const wb of liveBooks) {
                if (wb.scope !== 'global') continue;
                if (seen.has(wb.id) || skipIds?.has(wb.id)) continue;
                if (!WorldbookRuntime.isEntryActive(wb)) continue;
                if (!WorldbookRuntime.isEntryTriggered(wb)) continue;
                if (!wb.content?.trim()) continue;
                global.push(normalizeEntry(wb));
                seen.add(wb.id);
            }
            global.sort((a, b) => a.order - b.order);
        }

        return { local, global };
    },

    /**
     * 生成 system prompt 用的世界书分段。
     * inlineDepth=true（默认）：@Depth 条目降级并入 afterChar 块（单 prompt 调用方用）；
     * inlineDepth=false：@Depth 条目原样返回，由聊天链路插成消息。
     * 每个位置内的顺序：局部条目在前、全局在后，各自按 order 升序。
     */
    buildPromptSections(
        char: CharacterProfile,
        opts: { skipIds?: Set<string>; skipGlobal?: boolean; inlineDepth?: boolean } = {},
    ): WorldbookPromptSections {
        const inlineDepth = opts.inlineDepth !== false;
        const { local, global } = WorldbookRuntime.resolveForChar(char, opts);

        const isDepth = (e: ResolvedWbEntry) => e.position.startsWith('depth_');
        const pick = (list: ResolvedWbEntry[], pos: WorldbookPosition) => list.filter(e => e.position === pos);

        const depthEntries = inlineDepth ? [] : [...local.filter(isDepth), ...global.filter(isDepth)];
        // 内联降级：@Depth 条目排到 after_char 块尾部（局部仍在全局前）
        const afterLocal = inlineDepth
            ? [...pick(local, 'after_char'), ...local.filter(isDepth)]
            : pick(local, 'after_char');
        const afterGlobal = inlineDepth
            ? [...pick(global, 'after_char'), ...global.filter(isDepth)]
            : pick(global, 'after_char');

        return {
            beforeChar: renderScopedBlocks(pick(local, 'before_char'), pick(global, 'before_char'),
                '### 前置扩展设定 (Worldbooks · Before Character)',
                '### 前置全局设定 (Global Worldbooks · Before Character)'),
            afterChar: renderScopedBlocks(afterLocal, afterGlobal,
                '### 扩展设定集 (Worldbooks)',
                '### 全局扩展设定 (Global Worldbooks)'),
            depthEntries,
        };
    },

    /**
     * 把 @Depth 条目插进完整消息数组（[system, ...history, (reminder)]）。
     * 深度语义同 ST：depth=0 插在最后一条之后，depth=d 插在倒数第 d 条之前；
     * 永远不会插到首条 system prompt 之前。同 role+depth 的条目合并成一条消息
     * （局部在前、全局在后，order 升序，调用方传入的 depthEntries 已按此排好）。
     */
    spliceDepthMessages(
        messages: Array<{ role: string; content: any }>,
        depthEntries: ResolvedWbEntry[],
    ): void {
        if (depthEntries.length === 0) return;

        const roleOf = (p: WorldbookPosition): string =>
            p === 'depth_user' ? 'user' : p === 'depth_assistant' ? 'assistant' : 'system';

        // 按 role+depth 分组合并；记住组内首条的先后次序，保证插入稳定
        const groups = new Map<string, { role: string; depth: number; contents: string[] }>();
        for (const e of depthEntries) {
            const role = roleOf(e.position);
            const key = `${role}@${e.depth}`;
            if (!groups.has(key)) groups.set(key, { role, depth: e.depth, contents: [] });
            groups.get(key)!.contents.push(e.content);
        }

        // 从深到浅插入，避免先插的浅位移动深位的目标下标
        const sorted = [...groups.values()].sort((a, b) => b.depth - a.depth);
        for (const g of sorted) {
            const idx = Math.max(1, messages.length - g.depth);
            messages.splice(idx, 0, { role: g.role, content: g.contents.join('\n\n') });
        }
    },

    /** 群聊共享场景块用：全局条目渲染一次（局部条目仍在各角色块/共享挂载块里） */
    buildGlobalSharedBlock(skipIds?: Set<string>): string {
        const entries = liveBooks
            .filter(wb => wb.scope === 'global'
                && !skipIds?.has(wb.id)
                && WorldbookRuntime.isEntryActive(wb)
                && WorldbookRuntime.isEntryTriggered(wb)
                && !!wb.content?.trim())
            .map(normalizeEntry)
            .sort((a, b) => a.order - b.order);
        return renderScopedBlocks([], entries, '', '### 全局扩展设定 (Global Worldbooks)');
    },
};

// ---------------------------------------------------------------------------
// 渲染
// ---------------------------------------------------------------------------

/** 与原「扩展设定集」相同的分组渲染格式：#### [分组] + **Title** + 内容 */
const renderGrouped = (entries: ResolvedWbEntry[]): string => {
    let text = '';
    const grouped: Record<string, ResolvedWbEntry[]> = {};
    entries.forEach(e => {
        if (!grouped[e.category]) grouped[e.category] = [];
        grouped[e.category].push(e);
    });
    Object.entries(grouped).forEach(([category, books]) => {
        text += `#### [${category}]\n`;
        books.forEach(wb => {
            text += `**Title: ${wb.title}**\n${wb.content}\n---\n`;
        });
        text += `\n`;
    });
    return text;
};

/** 局部块在前、全局块在后（需求：系统提示里先写局部绑定、再写全局） */
const renderScopedBlocks = (
    local: ResolvedWbEntry[],
    global: ResolvedWbEntry[],
    localHeader: string,
    globalHeader: string,
): string => {
    let text = '';
    if (local.length > 0) {
        text += `${localHeader}\n${renderGrouped(local)}`;
    }
    if (global.length > 0) {
        text += `${globalHeader}\n（以下为全局生效的扩展设定，对所有对话生效）\n${renderGrouped(global)}`;
    }
    return text;
};
