/**
 * LLM 预设系统 —— SillyTavern Chat Completion 预设的 Moro 移植。
 *
 * 三块职责：
 *  1. 导入 / 导出：与酒馆预设 JSON 字段级兼容（prompts / prompt_order / 采样参数），
 *     未映射字段进 preset.raw 兜底，导出时原样合并回去，保证「导入再导出不丢字段」。
 *  2. 运行时组装：把预设的提示词骨架套到 buildChatRequestPayload 产出的
 *     [system(核心上下文), ...history] 上 —— 相对提示词按 prompt_order 排进消息流，
 *     绝对提示词（@Depth）按 ST 语义注入聊天历史（深度从末尾数，order 大的更靠近末尾，
 *     同深度同 order 内 role 按 assistant→user→system 的时间顺序出现，与 ST 逐字节对齐）。
 *  3. PresetRuntime：开关 / 激活预设的 localStorage 读写 + DB 取数，给
 *     chatRequestPayload / useChatAI 这类非 React 调用方用。
 *
 * marker 映射（ST 的占位符在 Moro 里如何落地）：
 *  - chatHistory                       → 聊天历史消息
 *  - charDescription 等核心 marker      → Moro 的角色核心上下文（ContextBuilder.buildCoreContext
 *    把人设/世界书/记忆/印象全部拼在一个 system 块里），注入在 prompt_order 中
 *    第一个启用的核心 marker 的位置；其余核心 marker 只作排序占位，不重复注入。
 */

import type {
    PresetPrompt,
    PresetPromptOrderCharacter,
    PresetPromptOrderEntry,
    TavernPreset,
} from '../types';
import { DB } from './db';
import { substituteMacros, type MacroContext } from './macros';

// ---------------------------------------------------------------------------
// 常量

/** ST 注入位置枚举 */
export const INJECTION_POSITION = { RELATIVE: 0, ABSOLUTE: 1 } as const;

/** ST 约定的 prompt_order character_id：单聊默认 / 群聊默认 */
export const ORDER_CHAR_ID_SINGLE = 100000;
export const ORDER_CHAR_ID_GROUP = 100001;

/**
 * 这些 marker 在 ST 里各自填充角色卡的一部分；Moro 的核心上下文（人设 + 世界书 +
 * 用户档案 + 记忆）是一个整体 system 块，所以它们共同映射到同一个注入点。
 */
export const CORE_CONTEXT_MARKERS = new Set([
    'worldInfoBefore',
    'charDescription',
    'charPersonality',
    'scenario',
    'personaDescription',
    'worldInfoAfter',
    'dialogueExamples',
]);

export const CHAT_HISTORY_MARKER = 'chatHistory';

/** 已知 marker 的展示名 + 在 Moro 里的落点说明（UI 用） */
export const MARKER_HINTS: Record<string, { name: string; hint: string }> = {
    chatHistory: { name: 'Chat History', hint: '聊天历史消息在此插入' },
    charDescription: { name: 'Char Description', hint: 'Moro 角色核心上下文（人设+世界书+记忆+印象）的注入点' },
    charPersonality: { name: 'Char Personality', hint: '已并入角色核心上下文，此处仅作排序占位' },
    scenario: { name: 'Scenario', hint: '已并入角色核心上下文，此处仅作排序占位' },
    personaDescription: { name: 'Persona Description', hint: '用户人设块（人设 App 激活人设的名字+描述；未建人设时为档案 App 的内容）在此注入' },
    worldInfoBefore: { name: 'World Info (before)', hint: '世界书已并入角色核心上下文，此处仅作排序占位' },
    worldInfoAfter: { name: 'World Info (after)', hint: '世界书已并入角色核心上下文，此处仅作排序占位' },
    dialogueExamples: { name: 'Chat Examples', hint: '角色的对话示例（神经链接编辑页「对话示例」栏 / 角色卡 mes_example）在此注入' },
};

// localStorage keys
const ENABLED_KEY = 'os_preset_enabled';
const ACTIVE_ID_KEY = 'os_preset_active_id';
const APPLY_SAMPLING_KEY = 'os_preset_apply_sampling';

// ---------------------------------------------------------------------------
// 默认预设（对齐 ST default/content/presets/openai/Default.json 的 prompts / order）

const DEFAULT_PROMPTS = (): PresetPrompt[] => [
    { name: 'Main Prompt', system_prompt: true, role: 'system', content: "Write {{char}}'s next reply in a fictional chat between {{char}} and {{user}}.", identifier: 'main' },
    { name: 'Auxiliary Prompt', system_prompt: true, role: 'system', content: '', identifier: 'nsfw' },
    { identifier: 'dialogueExamples', name: 'Chat Examples', system_prompt: true, marker: true },
    { name: 'Post-History Instructions', system_prompt: true, role: 'system', content: '', identifier: 'jailbreak' },
    { identifier: 'chatHistory', name: 'Chat History', system_prompt: true, marker: true },
    { identifier: 'worldInfoAfter', name: 'World Info (after)', system_prompt: true, marker: true },
    { identifier: 'worldInfoBefore', name: 'World Info (before)', system_prompt: true, marker: true },
    { identifier: 'enhanceDefinitions', role: 'system', name: 'Enhance Definitions', content: "If you have more knowledge of {{char}}, add to the character's lore and personality to enhance them but keep the Character Sheet's definitions absolute.", system_prompt: true, marker: false },
    { identifier: 'charDescription', name: 'Char Description', system_prompt: true, marker: true },
    { identifier: 'charPersonality', name: 'Char Personality', system_prompt: true, marker: true },
    { identifier: 'scenario', name: 'Scenario', system_prompt: true, marker: true },
    { identifier: 'personaDescription', name: 'Persona Description', system_prompt: true, marker: true },
];

const DEFAULT_ORDER = (): PresetPromptOrderEntry[] => [
    { identifier: 'main', enabled: true },
    { identifier: 'worldInfoBefore', enabled: true },
    { identifier: 'charDescription', enabled: true },
    { identifier: 'charPersonality', enabled: true },
    { identifier: 'scenario', enabled: true },
    { identifier: 'enhanceDefinitions', enabled: false },
    { identifier: 'nsfw', enabled: true },
    { identifier: 'worldInfoAfter', enabled: true },
    { identifier: 'dialogueExamples', enabled: true },
    { identifier: 'chatHistory', enabled: true },
    { identifier: 'jailbreak', enabled: true },
];

export function createDefaultPreset(name = 'Default'): TavernPreset {
    const now = Date.now();
    return {
        id: crypto.randomUUID(),
        name,
        createdAt: now,
        updatedAt: now,
        temperature: 1,
        frequency_penalty: 0,
        presence_penalty: 0,
        top_p: 1,
        top_k: 0,
        top_a: 0,
        min_p: 0,
        repetition_penalty: 1,
        openai_max_context: 4095,
        openai_max_tokens: 8000,
        prompts: DEFAULT_PROMPTS(),
        prompt_order: [
            { character_id: ORDER_CHAR_ID_SINGLE, order: DEFAULT_ORDER() },
            { character_id: ORDER_CHAR_ID_GROUP, order: DEFAULT_ORDER() },
        ],
    };
}

// ---------------------------------------------------------------------------
// 导入 / 导出

const SAMPLING_FIELDS = [
    'temperature', 'frequency_penalty', 'presence_penalty', 'top_p', 'top_k',
    'top_a', 'min_p', 'repetition_penalty', 'openai_max_context', 'openai_max_tokens',
] as const;

function asNumber(v: any): number | undefined {
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function normalizeRole(v: any): PresetPrompt['role'] {
    return v === 'user' || v === 'assistant' ? v : 'system';
}

function normalizePrompt(p: any): PresetPrompt | null {
    if (!p || typeof p !== 'object' || typeof p.identifier !== 'string') return null;
    const out: PresetPrompt = {
        identifier: p.identifier,
        name: typeof p.name === 'string' ? p.name : p.identifier,
    };
    if (p.system_prompt !== undefined) out.system_prompt = !!p.system_prompt;
    if (p.marker) out.marker = true;
    if (!p.marker) {
        out.role = normalizeRole(p.role);
        out.content = typeof p.content === 'string' ? p.content : '';
    }
    if (p.injection_position !== undefined) out.injection_position = asNumber(p.injection_position) ?? INJECTION_POSITION.RELATIVE;
    if (p.injection_depth !== undefined) out.injection_depth = asNumber(p.injection_depth) ?? 4;
    if (p.injection_order !== undefined) out.injection_order = asNumber(p.injection_order) ?? 100;
    if (p.forbid_overrides !== undefined) out.forbid_overrides = !!p.forbid_overrides;
    if (p.enabled !== undefined) out.enabled = !!p.enabled;
    return out;
}

/**
 * 把一份酒馆预设 JSON（或任何兼容子集）规整成 TavernPreset。
 * 容错：缺 prompts / prompt_order 时补默认；order 引用了不存在的 identifier 时
 * 自动补一条占位 prompt（与 ST 的宽容行为一致——不会因为单条引用悬空整体报错）。
 */
export function importTavernPreset(data: any, fallbackName: string): TavernPreset {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('不是有效的预设 JSON（顶层应为对象）');
    }
    const now = Date.now();
    const preset: TavernPreset = {
        id: crypto.randomUUID(),
        name: (typeof data.name === 'string' && data.name.trim()) || fallbackName,
        createdAt: now,
        updatedAt: now,
        prompts: [],
        prompt_order: [],
        raw: { ...data },
    };
    for (const f of SAMPLING_FIELDS) {
        const v = asNumber(data[f]);
        if (v !== undefined) (preset as any)[f] = v;
    }

    const prompts: PresetPrompt[] = Array.isArray(data.prompts)
        ? data.prompts.map(normalizePrompt).filter((p: PresetPrompt | null): p is PresetPrompt => !!p)
        : [];
    if (prompts.length === 0) prompts.push(...DEFAULT_PROMPTS());

    let promptOrder: PresetPromptOrderCharacter[] = [];
    if (Array.isArray(data.prompt_order)) {
        promptOrder = data.prompt_order
            .filter((po: any) => po && typeof po === 'object' && Array.isArray(po.order))
            .map((po: any) => ({
                character_id: asNumber(po.character_id) ?? ORDER_CHAR_ID_SINGLE,
                order: po.order
                    .filter((e: any) => e && typeof e.identifier === 'string')
                    .map((e: any) => ({ identifier: e.identifier, enabled: e.enabled !== false })),
            }));
    }
    if (promptOrder.length === 0) {
        promptOrder = [
            { character_id: ORDER_CHAR_ID_SINGLE, order: DEFAULT_ORDER() },
            { character_id: ORDER_CHAR_ID_GROUP, order: DEFAULT_ORDER() },
        ];
    }

    // order 里引用了缺失的 prompt → 补占位，UI / 组装两侧都不用再判空
    const known = new Set(prompts.map(p => p.identifier));
    for (const po of promptOrder) {
        for (const e of po.order) {
            if (known.has(e.identifier)) continue;
            known.add(e.identifier);
            const hint = MARKER_HINTS[e.identifier];
            prompts.push(hint
                ? { identifier: e.identifier, name: hint.name, system_prompt: true, marker: true }
                : { identifier: e.identifier, name: e.identifier, role: 'system', content: '' });
        }
    }

    preset.prompts = prompts;
    preset.prompt_order = promptOrder;
    return preset;
}

/** 导出成 ST 兼容 JSON：raw 兜底字段在前，当前编辑过的字段覆盖在后。 */
export function exportTavernPreset(preset: TavernPreset): Record<string, any> {
    const out: Record<string, any> = { ...(preset.raw || {}) };
    delete out.id;
    delete out.createdAt;
    delete out.updatedAt;
    out.name = preset.name;
    for (const f of SAMPLING_FIELDS) {
        const v = (preset as any)[f];
        if (v !== undefined) out[f] = v;
    }
    out.prompts = preset.prompts.map(p => ({ ...p }));
    out.prompt_order = preset.prompt_order.map(po => ({
        character_id: po.character_id,
        order: po.order.map(e => ({ identifier: e.identifier, enabled: e.enabled })),
    }));
    return out;
}

// ---------------------------------------------------------------------------
// 宏替换 —— 委托给通用引擎（utils/macros.ts），人设 / 世界书 / 预设共用同一套语义

export type PresetMacroCtx = MacroContext;

export function substitutePresetMacros(content: string, ctx: PresetMacroCtx): string {
    return substituteMacros(content, ctx);
}

// ---------------------------------------------------------------------------
// 运行时组装

function getOrderForCharId(preset: TavernPreset, characterId: number): PresetPromptOrderEntry[] {
    const exact = preset.prompt_order.find(po => po.character_id === characterId);
    if (exact) return exact.order;
    return preset.prompt_order[0]?.order ?? [];
}

interface AbsolutePromptResolved {
    role: string;
    content: string;
    depth: number;
    order: number;
}

/**
 * 把绝对（@Depth）提示词注入聊天历史段。语义与 ST populationInjectionPrompts 对齐：
 * depth 从历史末尾数（0 = 最后一条消息之后）；同一深度内 order 大的更靠近末尾；
 * 同 order 内时间顺序为 assistant → user → system；同深度同 order 同 role 用 \n 合并。
 * 从深到浅插入，浅位的 length-depth 自然把先插的深位算进去 —— 与 ST 的
 * totalInsertedMessages 补偿等价（Moro 世界书 spliceDepthMessages 同款手法）。
 */
function injectAbsolutePrompts(
    messages: Array<{ role: string; content: any }>,
    historyStart: number,
    historyLen: number,
    absolutes: AbsolutePromptResolved[],
): void {
    if (absolutes.length === 0) return;

    const byDepth = new Map<number, AbsolutePromptResolved[]>();
    for (const p of absolutes) {
        const d = Math.max(0, p.depth);
        if (!byDepth.has(d)) byDepth.set(d, []);
        byDepth.get(d)!.push(p);
    }

    // 深度只在聊天历史段内计算（depth 0 = 最后一条历史之后、post-history 提示词之前），
    // 历史段后面的相对提示词（如 jailbreak）不参与计数 —— 与 ST 一致。
    let historyEnd = historyStart + historyLen;
    const depths = [...byDepth.keys()].sort((a, b) => b - a);
    for (const depth of depths) {
        const group = byDepth.get(depth)!;
        const orders = [...new Set(group.map(p => p.order))].sort((a, b) => a - b);
        const inserted: Array<{ role: string; content: string }> = [];
        for (const order of orders) {
            // 时间顺序 assistant→user→system = ST 反转数组后的最终形态
            for (const role of ['assistant', 'user', 'system']) {
                const joined = group
                    .filter(p => p.order === order && p.role === role)
                    .map(p => p.content.trim())
                    .filter(Boolean)
                    .join('\n');
                if (joined) inserted.push({ role, content: joined });
            }
        }
        if (inserted.length === 0) continue;
        const idx = Math.max(historyStart, historyEnd - depth);
        messages.splice(idx, 0, ...inserted);
        // 从深到浅插入，浅位目标随 historyEnd 后移 —— 等价于 ST 的 totalInsertedMessages 补偿
        historyEnd += inserted.length;
    }
}

export interface ApplyPresetOptions {
    macros: PresetMacroCtx;
    /** prompt_order 用哪份（单聊 100000 / 群聊 100001），默认单聊 */
    orderCharacterId?: number;
    /**
     * marker 的真实内容（与世界书 / 神经链接人设 / 用户档案联动时由调用方提供）：
     * 例如 { worldInfoBefore: '...', worldInfoAfter: '...', personaDescription: '...' }。
     * 提供了内容的 marker 会在自己的 order 位置作为独立 system 消息注入（可被开关
     * 关掉，ST 语义）；marker 压根不在 order 里时内容回折进核心上下文块，保证不丢。
     * 不提供时（旧调用方 / 测试）这些 marker 维持「并入核心上下文」的占位行为。
     */
    markerContents?: Partial<Record<string, string>>;
}

/**
 * 把预设套到 [system(核心上下文), ...history] 形态的消息数组上，返回新数组。
 *
 * - 相对提示词按 prompt_order 顺序展开成独立消息（带各自 role）
 * - markerContents 提供了内容的 marker（worldInfo* / personaDescription）在各自
 *   位置注入；其余核心 marker 中第一个启用的位置注入 Moro 核心上下文（原 messages[0]）
 * - chatHistory marker 处插入历史消息；order 里没有该 marker 时兜底追加到末尾
 *   （被显式关掉则尊重 ST 语义不发历史）
 * - 绝对提示词注入聊天历史段（见 injectAbsolutePrompts）
 *
 * messages[0] 不是 system 时（DevDebug 跳过 prompt build 等）原样返回不套预设。
 */
export function applyPresetToMessages(
    messages: Array<{ role: string; content: any }>,
    preset: TavernPreset,
    options: ApplyPresetOptions,
): Array<{ role: string; content: any }> {
    if (messages.length === 0 || messages[0].role !== 'system') return messages;

    const history = messages.slice(1);
    const order = getOrderForCharId(preset, options.orderCharacterId ?? ORDER_CHAR_ID_SINGLE);
    if (order.length === 0) return messages;

    // marker 不在 order 里（残缺/旧版预设）时，其真实内容回折进核心块，保证设定不丢：
    // worldInfoBefore 折到核心块前面，其余折到后面 —— 接近非预设路径的原始排布。
    const markerContents = options.markerContents ?? {};
    const orderIds = new Set(order.map(e => e.identifier));
    let corePrefix = '';
    let coreSuffix = '';
    for (const [id, content] of Object.entries(markerContents)) {
        if (!content || !content.trim() || orderIds.has(id)) continue;
        if (id === 'worldInfoBefore') corePrefix += `${content.trim()}\n\n`;
        else coreSuffix += `\n\n${content.trim()}`;
    }
    const coreSystem = (corePrefix || coreSuffix)
        ? { role: 'system', content: `${corePrefix}${messages[0].content}${coreSuffix}` }
        : messages[0];

    const byId = new Map(preset.prompts.map(p => [p.identifier, p]));
    const result: Array<{ role: string; content: any }> = [];
    const absolutes: AbsolutePromptResolved[] = [];

    let coreInjected = false;
    let historyStart = -1;
    let historyInOrder = false;

    for (const entry of order) {
        const prompt = byId.get(entry.identifier);
        if (!prompt) continue;

        if (prompt.marker || CORE_CONTEXT_MARKERS.has(prompt.identifier) || prompt.identifier === CHAT_HISTORY_MARKER) {
            if (prompt.identifier === CHAT_HISTORY_MARKER) {
                historyInOrder = true;
                if (entry.enabled) {
                    historyStart = result.length;
                    result.push(...history);
                }
                continue;
            }
            // 有真实内容的 marker（世界书块 / 用户档案块）：在自己的位置注入，受开关控制
            const explicit = markerContents[prompt.identifier];
            if (explicit !== undefined) {
                if (entry.enabled && explicit.trim()) {
                    result.push({ role: 'system', content: explicit.trim() });
                }
                continue;
            }
            if (CORE_CONTEXT_MARKERS.has(prompt.identifier)) {
                if (entry.enabled && !coreInjected) {
                    coreInjected = true;
                    result.push(coreSystem);
                }
                continue;
            }
            // 未知 marker：无可填充内容，跳过
            continue;
        }

        if (!entry.enabled) continue;
        const content = substitutePresetMacros(prompt.content || '', options.macros).trim();
        if (!content) continue;

        if (prompt.injection_position === INJECTION_POSITION.ABSOLUTE) {
            absolutes.push({
                role: prompt.role || 'system',
                content,
                depth: prompt.injection_depth ?? 4,
                order: prompt.injection_order ?? 100,
            });
        } else {
            result.push({ role: prompt.role || 'system', content });
        }
    }

    // 核心上下文一个 marker 都没启用时仍兜底注入到最前 —— 否则角色人设 / 记忆全部丢失，
    // 聊天会静默劣化成无人设裸模型（用户极难定位原因），这里偏安全而不偏 ST 字面语义。
    if (!coreInjected) {
        result.unshift(coreSystem);
        if (historyStart >= 0) historyStart += 1;
    }
    // order 里压根没有 chatHistory（残缺预设）→ 兜底把历史追加到末尾
    if (!historyInOrder) {
        historyStart = result.length;
        result.push(...history);
    }

    if (historyStart >= 0) {
        injectAbsolutePrompts(result, historyStart, history.length, absolutes);
    }
    return result;
}

// ---------------------------------------------------------------------------
// 采样参数

export interface PresetGenParams {
    temperature?: number;
    top_p?: number;
    frequency_penalty?: number;
    presence_penalty?: number;
    top_k?: number;
    min_p?: number;
    top_a?: number;
    repetition_penalty?: number;
    max_tokens?: number;
}

/**
 * 取预设里要随请求下发的采样参数。temperature / top_p / 频率惩罚 / 存在惩罚 /
 * max_tokens 是 OpenAI 兼容端点的标准字段；top_k / min_p / top_a /
 * repetition_penalty 只在非默认值时附带（多数代理接受，标准端点会忽略）。
 */
export function getPresetGenParams(preset: TavernPreset): PresetGenParams {
    const out: PresetGenParams = {};
    if (preset.temperature !== undefined) out.temperature = preset.temperature;
    if (preset.top_p !== undefined) out.top_p = preset.top_p;
    if (preset.frequency_penalty !== undefined) out.frequency_penalty = preset.frequency_penalty;
    if (preset.presence_penalty !== undefined) out.presence_penalty = preset.presence_penalty;
    if (preset.openai_max_tokens !== undefined && preset.openai_max_tokens > 0) out.max_tokens = preset.openai_max_tokens;
    if (preset.top_k !== undefined && preset.top_k > 0) out.top_k = preset.top_k;
    if (preset.min_p !== undefined && preset.min_p > 0) out.min_p = preset.min_p;
    if (preset.top_a !== undefined && preset.top_a > 0) out.top_a = preset.top_a;
    if (preset.repetition_penalty !== undefined && preset.repetition_penalty !== 1) out.repetition_penalty = preset.repetition_penalty;
    return out;
}

// ---------------------------------------------------------------------------
// Token 粗估（UI 展示用：CJK 记 1 token/字，其余按 3.5 字符/token）

export function estimateTokens(text: string): number {
    if (!text) return 0;
    let cjk = 0;
    for (const ch of text) {
        if (/[\u3000-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(ch)) cjk++;
    }
    return Math.ceil(cjk + (text.length - cjk) / 3.5);
}

// ---------------------------------------------------------------------------
// PresetRuntime —— 非 React 调用方（chatRequestPayload / useChatAI）的入口

export const PresetRuntime = {
    isEnabled(): boolean {
        try { return localStorage.getItem(ENABLED_KEY) === '1'; } catch { return false; }
    },
    setEnabled(on: boolean): void {
        try { localStorage.setItem(ENABLED_KEY, on ? '1' : '0'); } catch { /* ignore */ }
    },
    /** 采样参数是否随预设下发（默认开；关掉则预设只管提示词，参数仍走全局 API 设置） */
    isSamplingApplied(): boolean {
        try { return localStorage.getItem(APPLY_SAMPLING_KEY) !== '0'; } catch { return true; }
    },
    setSamplingApplied(on: boolean): void {
        try { localStorage.setItem(APPLY_SAMPLING_KEY, on ? '1' : '0'); } catch { /* ignore */ }
    },
    getActiveId(): string | null {
        try { return localStorage.getItem(ACTIVE_ID_KEY); } catch { return null; }
    },
    setActiveId(id: string | null): void {
        try {
            if (id) localStorage.setItem(ACTIVE_ID_KEY, id);
            else localStorage.removeItem(ACTIVE_ID_KEY);
        } catch { /* ignore */ }
    },
    /** 预设总开关开 + 有激活预设时返回它，否则 null（调用方据此走原始路径） */
    async getActivePreset(): Promise<TavernPreset | null> {
        if (!PresetRuntime.isEnabled()) return null;
        const id = PresetRuntime.getActiveId();
        if (!id) return null;
        try {
            return (await DB.getPreset(id)) ?? null;
        } catch (e) {
            console.error('[Presets] 读取激活预设失败:', e);
            return null;
        }
    },
    /** 采样开关 + 激活预设的合并入口：返回要并进请求体的参数（无则 null） */
    async getActiveGenParams(): Promise<PresetGenParams | null> {
        if (!PresetRuntime.isSamplingApplied()) return null;
        const preset = await PresetRuntime.getActivePreset();
        if (!preset) return null;
        const params = getPresetGenParams(preset);
        return Object.keys(params).length > 0 ? params : null;
    },
};
