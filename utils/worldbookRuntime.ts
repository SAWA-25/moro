/**
 * 世界书运行时（Worldbook Runtime）
 *
 * 统一处理 Moro 世界书的作用域、开关、ST 式关键词激活、递归扫描、概率、
 * 预算和插入位置。React 状态由 OSContext.sync() 推进这里，非 React 的
 * prompt 构造层只读这份模块级镜像。
 */

import { CharacterProfile, Worldbook, WorldbookPosition, WorldbookSelectiveLogic } from '../types';
import { applyRegexToText } from './regex/store';
import { regex_placement } from './regex/engine';
import { wrapHiddenPromptBlock } from './promptPrivacy';

export const GROUP_TOGGLES_KEY = 'worldbook_group_toggles';
export const GROUP_SCOPES_KEY = 'worldbook_group_scopes';
export const GROUP_SETTINGS_KEY = 'worldbook_group_settings';

export type WorldbookGroupScope = 'local' | 'global';

export interface WorldbookGroupSettings {
    /** 递归扫描：已激活条目的正文可继续触发同书关键词条目 */
    recursiveScanning?: boolean;
    /** 估算 token 预算。undefined/0 = 不裁剪，避免旧书突然丢内容 */
    tokenBudget?: number;
    /** 最大递归轮数。recursiveScanning=true 且未填时默认 4 */
    maxRecursionSteps?: number;
}

/**
 * 未填分组时的默认分组名。必须与世界书 App / 聊天设置面板展示用的兜底一致 ——
 * 整书开关按分组名存 localStorage，两边兜底不同名会导致「整书已关却仍注入」。
 */
export const DEFAULT_WB_CATEGORY = '未分类设定 (General)';

export interface ResolvedWbEntry {
    id: string;
    title: string;
    content: string;
    category: string;
    scope: 'local' | 'global';
    position: WorldbookPosition;
    depth: number;
    order: number;
    ignoreBudget?: boolean;
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
const DEFAULT_MAX_RECURSION_STEPS = 4;

// ---------------------------------------------------------------------------
// 注册表
// ---------------------------------------------------------------------------

let liveBooks: Worldbook[] = [];
let groupToggles: Record<string, boolean> = {};
let groupScopes: Record<string, WorldbookGroupScope> = {};
let groupSettings: Record<string, WorldbookGroupSettings> = {};

/**
 * 关键词扫描上下文（旧→新）。主聊天链路在构建 prompt 前喂入最近消息；
 * 无上下文时关键词条目不注入，常驻条目不受影响。
 */
let scanMessages: string[] | null = null;

/**
 * 额外注入的世界书分组（人设世界书移植，对应 ST persona lorebook）。
 */
let extraCategories: Set<string> | null = null;

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

export const loadGroupScopesFromStorage = (): Record<string, WorldbookGroupScope> => {
    try {
        const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(GROUP_SCOPES_KEY) : null;
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') return parsed;
        }
    } catch { /* 损坏的 JSON 当作默认局部 */ }
    return {};
};

export const saveGroupScopesToStorage = (scopes: Record<string, WorldbookGroupScope>) => {
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(GROUP_SCOPES_KEY, JSON.stringify(scopes));
        }
    } catch { /* 存储满等场景静默失败，开关只影响本次会话 */ }
};

export const loadGroupSettingsFromStorage = (): Record<string, WorldbookGroupSettings> => {
    try {
        const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(GROUP_SETTINGS_KEY) : null;
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') return parsed;
        }
    } catch { /* 损坏的 JSON 当作无高级设置 */ }
    return {};
};

export const saveGroupSettingsToStorage = (settings: Record<string, WorldbookGroupSettings>) => {
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(GROUP_SETTINGS_KEY, JSON.stringify(settings));
        }
    } catch { /* 存储满等场景静默失败，高级设置只影响本次会话 */ }
};

const categoryOf = (category: string | undefined) => category || DEFAULT_WB_CATEGORY;
const makeBookKey = (category: string | undefined, title: string) =>
    `${categoryOf(category)}\u0000${title}`;

function estimateTokens(text: string): number {
    if (!text) return 0;
    let cjk = 0;
    for (const ch of text) {
        if (/[\u3000-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(ch)) cjk++;
    }
    return Math.ceil(cjk + (text.length - cjk) / 3.5);
}

const normalizeEntry = (wb: Worldbook, scope: WorldbookGroupScope = 'local'): ResolvedWbEntry => ({
    id: wb.id,
    title: wb.title,
    content: wb.content,
    category: categoryOf(wb.category),
    scope,
    position: wb.position || 'after_char',
    depth: typeof wb.depth === 'number' && wb.depth >= 0 ? wb.depth : DEFAULT_DEPTH,
    order: typeof wb.order === 'number' ? wb.order : DEFAULT_ORDER,
    ignoreBudget: wb.ignoreBudget === true,
});

const normalizeProbability = (wb: Worldbook): number => {
    if (wb.useProbability === false) return 100;
    if (typeof wb.probability !== 'number' || !Number.isFinite(wb.probability)) return 100;
    return Math.max(0, Math.min(100, wb.probability));
};

const parseRegexKey = (needle: string): RegExp | null => {
    const match = needle.match(/^\/(.+)\/([gimsuy]*)$/);
    if (!match) return null;
    try {
        return new RegExp(match[1], match[2].replace(/g/g, ''));
    } catch {
        return null;
    }
};

export function matchWorldbookKey(haystack: string, needle: string, opts: { caseSensitive?: boolean; matchWholeWords?: boolean } = {}): boolean {
    const key = needle.trim();
    if (!key) return false;

    const regex = parseRegexKey(key);
    if (regex) return regex.test(haystack);

    const caseSensitive = opts.caseSensitive === true;
    const hay = caseSensitive ? haystack : haystack.toLowerCase();
    const cmp = caseSensitive ? key : key.toLowerCase();
    if (!opts.matchWholeWords) return hay.includes(cmp);

    const words = cmp.split(/\s+/).filter(Boolean);
    if (words.length > 1) return hay.includes(cmp);
    return new RegExp(`(?:^|\\W)(${escapeRegExp(cmp)})(?:$|\\W)`).test(hay);
}

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function logicFromNumber(value: any): WorldbookSelectiveLogic | undefined {
    if (value === 1) return 'not_all';
    if (value === 2) return 'not_any';
    if (value === 3) return 'and_all';
    if (value === 0) return 'and_any';
    return undefined;
}

export function normalizeSelectiveLogic(value: any): WorldbookSelectiveLogic | undefined {
    if (value === 'and_any' || value === 'not_all' || value === 'not_any' || value === 'and_all') return value;
    return logicFromNumber(value);
}

function entryBookFallbackSettings(category: string): WorldbookGroupSettings {
    const entries = liveBooks.filter(wb => categoryOf(wb.category) === category);
    for (const wb of entries) {
        const data = wb.stData;
        if (!data) continue;
        const out: WorldbookGroupSettings = {};
        if (typeof data.recursiveScanning === 'boolean') out.recursiveScanning = data.recursiveScanning;
        if (typeof data.tokenBudget === 'number' && data.tokenBudget > 0) out.tokenBudget = data.tokenBudget;
        const max = data.bookExtensions?.max_recursion_steps ?? data.bookExtensions?.maxRecursionSteps;
        if (typeof max === 'number' && max >= 0) out.maxRecursionSteps = max;
        if (Object.keys(out).length > 0) return out;
    }
    return {};
}

function effectiveGroupSettings(category: string): WorldbookGroupSettings {
    const normalized = categoryOf(category);
    return { ...entryBookFallbackSettings(normalized), ...(groupSettings[normalized] || {}) };
}

function getGroupBudget(category: string): number | undefined {
    const budget = effectiveGroupSettings(category).tokenBudget;
    return typeof budget === 'number' && budget > 0 ? budget : undefined;
}

function maxRecursionStepsFor(entries: ResolvedWbEntry[]): number {
    let max = 0;
    for (const entry of entries) {
        const s = effectiveGroupSettings(entry.category);
        if (!s.recursiveScanning) continue;
        const value = typeof s.maxRecursionSteps === 'number' && s.maxRecursionSteps >= 0
            ? s.maxRecursionSteps
            : DEFAULT_MAX_RECURSION_STEPS;
        max = Math.max(max, value);
    }
    return max;
}

function shouldRunRecursiveFor(entry: ResolvedWbEntry): boolean {
    return effectiveGroupSettings(entry.category).recursiveScanning === true;
}

function sourceWorldbookFromEntry(entry: ResolvedWbEntry): Worldbook | undefined {
    return liveBooks.find(wb => wb.id === entry.id);
}

function isKeywordEntryTriggered(wb: Worldbook, extraScanText = ''): boolean {
    if (wb.activation !== 'keyword') return true;
    if (!scanMessages || scanMessages.length === 0) return false;

    const keys = (wb.keys || []).map(k => k.trim()).filter(Boolean);
    if (keys.length === 0) return false;

    const depth = typeof wb.scanDepth === 'number' && wb.scanDepth > 0 ? wb.scanDepth : DEFAULT_DEPTH;
    const hay = [scanMessages.slice(-depth).join('\n'), extraScanText].filter(Boolean).join('\n');
    const hit = (k: string) => matchWorldbookKey(hay, k, {
        caseSensitive: wb.caseSensitive,
        matchWholeWords: wb.matchWholeWords,
    });

    if (!keys.some(hit)) return false;
    const secondary = (wb.secondaryKeys || []).map(k => k.trim()).filter(Boolean);
    if (!wb.selective || secondary.length === 0) return true;

    const hits = secondary.map(hit);
    switch (normalizeSelectiveLogic(wb.selectiveLogic) || 'and_any') {
        case 'and_all':
            return hits.every(Boolean);
        case 'not_any':
            return !hits.some(Boolean);
        case 'not_all':
            return !hits.every(Boolean);
        case 'and_any':
        default:
            return hits.some(Boolean);
    }
}

function resolveActivatedCandidates(candidates: ResolvedWbEntry[]): ResolvedWbEntry[] {
    if (candidates.length === 0) return [];

    const byId = new Map(candidates.map(e => [e.id, e]));
    const activated = new Map<string, ResolvedWbEntry>();
    const failedProbability = new Set<string>();
    const usedBudget = new Map<string, number>();
    let recursionText = '';
    let round = 0;
    const maxRecursion = maxRecursionStepsFor(candidates);

    while (true) {
        const recursiveRound = round > 0;
        if (recursiveRound && round > maxRecursion) break;

        const possible: ResolvedWbEntry[] = [];
        for (const entry of candidates) {
            if (activated.has(entry.id) || failedProbability.has(entry.id)) continue;
            const wb = sourceWorldbookFromEntry(entry);
            if (!wb) {
                // 快照没有关键词字段，按常驻处理；只允许首轮进入，避免递归重复。
                if (!recursiveRound) possible.push(entry);
                continue;
            }
            if (recursiveRound && wb.activation !== 'keyword') continue;
            if (recursiveRound && !shouldRunRecursiveFor(entry)) continue;
            if (!isKeywordEntryTriggered(wb, recursiveRound ? recursionText : '')) continue;
            possible.push(entry);
        }

        if (possible.length === 0) break;

        const acceptedThisRound: ResolvedWbEntry[] = [];
        for (const entry of possible) {
            const wb = sourceWorldbookFromEntry(entry);
            const probability = wb ? normalizeProbability(wb) : 100;
            if (probability <= 0 || (probability < 100 && Math.random() * 100 >= probability)) {
                failedProbability.add(entry.id);
                continue;
            }

            const budget = getGroupBudget(entry.category);
            if (budget !== undefined && !entry.ignoreBudget) {
                const used = usedBudget.get(entry.category) || 0;
                const cost = estimateTokens(entry.content);
                if (used + cost > budget) continue;
                usedBudget.set(entry.category, used + cost);
            }

            activated.set(entry.id, entry);
            acceptedThisRound.push(entry);
        }

        if (acceptedThisRound.length === 0) break;
        recursionText = [recursionText, acceptedThisRound.map(e => e.content).join('\n')].filter(Boolean).join('\n');

        round += 1;
        if (round > maxRecursion || maxRecursion === 0) break;
    }

    return candidates.filter(entry => byId.has(entry.id) && activated.has(entry.id));
}

function applyWorldInfoRegex(entries: ResolvedWbEntry[], char: CharacterProfile): ResolvedWbEntry[] {
    return entries.map(e => {
        const out = applyRegexToText(e.content, regex_placement.WORLD_INFO, { char });
        return out === e.content ? e : { ...e, content: out };
    });
}

export const WorldbookRuntime = {
    /** OSContext 在 worldbooks / 整书设置变化时调用，保持镜像最新 */
    sync(
        books: Worldbook[],
        toggles: Record<string, boolean>,
        scopes: Record<string, WorldbookGroupScope> = {},
        settings: Record<string, WorldbookGroupSettings> = {},
    ) {
        liveBooks = books;
        groupToggles = toggles;
        groupScopes = scopes;
        groupSettings = settings;
    },

    /** 整书开关：undefined 视为开（向后兼容） */
    isBookEnabled(category: string): boolean {
        return groupToggles[categoryOf(category)] !== false;
    },

    /** 整本作用域：undefined 视为局部（需挂载） */
    getBookScope(category: string): WorldbookGroupScope {
        return groupScopes[categoryOf(category)] === 'global' ? 'global' : 'local';
    },

    isBookGlobal(category: string): boolean {
        return WorldbookRuntime.getBookScope(category) === 'global';
    },

    getBookSettings(category: string): WorldbookGroupSettings {
        return effectiveGroupSettings(category);
    },

    /** 条目是否生效 = 条目开关 && 整书开关 */
    isEntryActive(wb: Worldbook): boolean {
        return wb.enabled !== false && WorldbookRuntime.isBookEnabled(categoryOf(wb.category));
    },

    /** 主聊天链路设置 / 清空关键词扫描上下文（最近消息文本，旧→新） */
    setScanContext(messages: string[] | null) {
        scanMessages = messages;
    },

    /** 主聊天链路设置 / 清空额外注入分组（当前激活人设绑定的世界书，=ST persona lorebook） */
    setExtraCategories(categories: string[] | null) {
        extraCategories = categories && categories.length > 0 ? new Set(categories.map(categoryOf)) : null;
    },

    /** 安全运行时上下文 helper：自动恢复上一个扫描 / 额外分组状态 */
    async withContext<T>(
        ctx: { scanMessages?: string[] | null; extraCategories?: string[] | null },
        fn: () => Promise<T> | T,
    ): Promise<T> {
        const prevScan = scanMessages;
        const prevExtra = extraCategories ? new Set(extraCategories) : null;
        if ('scanMessages' in ctx) WorldbookRuntime.setScanContext(ctx.scanMessages ?? null);
        if ('extraCategories' in ctx) WorldbookRuntime.setExtraCategories(ctx.extraCategories ?? null);
        try {
            return await fn();
        } finally {
            scanMessages = prevScan;
            extraCategories = prevExtra;
        }
    },

    /**
     * 条目激活判定（不含概率/预算）：供测试与 UI 诊断使用。
     */
    isEntryTriggered(wb: Worldbook): boolean {
        return isKeywordEntryTriggered(wb);
    },

    /**
     * 解析某个角色当前生效的世界书条目。
     *
     * local：局部书中，角色已挂载的分组；extraCategories 中的局部分组也视同挂载。
     * global：注册表里所有「整本作用域 = global」且生效的条目，无需挂载。
     */
    resolveForChar(
        char: CharacterProfile,
        opts: { skipIds?: Set<string>; skipGlobal?: boolean } = {},
    ): { local: ResolvedWbEntry[]; global: ResolvedWbEntry[] } {
        const skipIds = opts.skipIds;
        const liveById = new Map(liveBooks.map(b => [b.id, b]));
        const liveByKey = new Map<string, Worldbook>();
        for (const b of liveBooks) {
            const key = makeBookKey(b.category, b.title);
            if (!liveByKey.has(key)) liveByKey.set(key, b);
        }

        const local: ResolvedWbEntry[] = [];
        const seen = new Set<string>();

        const pushLiveLocal = (wb: Worldbook) => {
            if (WorldbookRuntime.isBookGlobal(categoryOf(wb.category))) return;
            if (seen.has(wb.id) || skipIds?.has(wb.id)) return;
            if (!WorldbookRuntime.isEntryActive(wb)) return;
            if (!wb.content?.trim()) return;
            local.push(normalizeEntry(wb, 'local'));
            seen.add(wb.id);
        };

        for (const mounted of (char.mountedWorldbooks || [])) {
            if (!mounted.id || seen.has(mounted.id)) continue;
            if (skipIds?.has(mounted.id)) continue;
            const live = liveById.get(mounted.id)
                ?? liveByKey.get(makeBookKey(mounted.category, mounted.title));
            if (live) {
                pushLiveLocal(live);
            } else {
                if (mounted.enabled === false) continue;
                if (!WorldbookRuntime.isBookEnabled(categoryOf(mounted.category))) continue;
                if (!mounted.content?.trim()) continue;
                local.push(normalizeEntry({
                    ...mounted,
                    category: categoryOf(mounted.category),
                    createdAt: 0,
                    updatedAt: 0,
                    activation: 'always',
                } as Worldbook, 'local'));
                seen.add(mounted.id);
            }
        }

        const mountedCategories = new Set<string>();
        for (const mounted of (char.mountedWorldbooks || [])) {
            if (!mounted.id) continue;
            const live = liveById.get(mounted.id)
                ?? liveByKey.get(makeBookKey(mounted.category, mounted.title));
            mountedCategories.add(categoryOf(live?.category ?? mounted.category));
        }

        for (const wb of liveBooks) {
            if (!mountedCategories.has(categoryOf(wb.category))) continue;
            pushLiveLocal(wb);
        }

        if (extraCategories) {
            for (const wb of liveBooks) {
                if (!extraCategories.has(categoryOf(wb.category))) continue;
                pushLiveLocal(wb);
            }
        }

        const global: ResolvedWbEntry[] = [];
        if (!opts.skipGlobal) {
            for (const wb of liveBooks) {
                if (!WorldbookRuntime.isBookGlobal(categoryOf(wb.category))) continue;
                if (seen.has(wb.id) || skipIds?.has(wb.id)) continue;
                if (!WorldbookRuntime.isEntryActive(wb)) continue;
                if (!wb.content?.trim()) continue;
                global.push(normalizeEntry(wb, 'global'));
                seen.add(wb.id);
            }
        }

        const ordered = [...local.sort((a, b) => a.order - b.order), ...global.sort((a, b) => a.order - b.order)];
        const active = resolveActivatedCandidates(ordered);
        const activeIds = new Set(active.map(e => e.id));
        return {
            local: applyWorldInfoRegex(local.filter(e => activeIds.has(e.id)), char),
            global: applyWorldInfoRegex(global.filter(e => activeIds.has(e.id)), char),
        };
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
     * 永远不会插到首条 system prompt 之前。同 role+depth 的条目合并成一条消息。
     */
    spliceDepthMessages(
        messages: Array<{ role: string; content: any }>,
        depthEntries: ResolvedWbEntry[],
    ): void {
        if (depthEntries.length === 0) return;

        const roleOf = (p: WorldbookPosition): string =>
            p === 'depth_user' ? 'user' : p === 'depth_assistant' ? 'assistant' : 'system';

        const groups = new Map<string, { role: string; depth: number; contents: string[] }>();
        for (const e of depthEntries) {
            const role = roleOf(e.position);
            const key = `${role}@${e.depth}`;
            if (!groups.has(key)) groups.set(key, { role, depth: e.depth, contents: [] });
            groups.get(key)!.contents.push(wrapHiddenPromptBlock(
                `worldbook-depth-${e.scope}`,
                `### @Depth 扩展设定 (${e.scope === 'global' ? 'Global Worldbook' : 'Worldbook'})\n#### [${e.category}]\n**Title: ${e.title}**\n${e.content}`,
            ));
        }

        const sorted = [...groups.values()].sort((a, b) => b.depth - a.depth);
        for (const g of sorted) {
            const idx = Math.max(1, messages.length - g.depth);
            messages.splice(idx, 0, { role: g.role, content: g.contents.join('\n\n') });
        }
    },

    /** 群聊共享场景块用：全局条目渲染一次（局部条目仍在各角色块/共享挂载块里） */
    buildGlobalSharedBlock(skipIds?: Set<string>): string {
        const entries = liveBooks
            .filter(wb => WorldbookRuntime.isBookGlobal(categoryOf(wb.category))
                && !skipIds?.has(wb.id)
                && WorldbookRuntime.isEntryActive(wb)
                && !!wb.content?.trim())
            .map(wb => normalizeEntry(wb, 'global'))
            .sort((a, b) => a.order - b.order);
        const active = resolveActivatedCandidates(entries);
        return renderScopedBlocks([], active, '', '### 全局扩展设定 (Global Worldbooks)');
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
        text += wrapHiddenPromptBlock('worldbook-local', `${localHeader}\n${renderGrouped(local)}`);
    }
    if (global.length > 0) {
        text += wrapHiddenPromptBlock('worldbook-global', `${globalHeader}\n（以下为全局生效的扩展设定，对所有对话生效）\n${renderGrouped(global)}`);
    }
    return text;
};
