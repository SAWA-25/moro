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
 *  - worldInfoBefore / worldInfoAfter  → 剪报夹世界书运行时分段
 *  - personaDescription / dialogueExamples → 剪影集用户身份 / 角色台词样张
 *  - charDescription / charPersonality / scenario → 剪影集角色核心上下文
 */

import type {
    PresetPrompt,
    PresetPromptOrderCharacter,
    PresetPromptOrderEntry,
    PresetSnapshot,
    PresetScopeKey,
    RegexScriptData,
    TavernPreset,
} from '../types';
import { DB } from './db';
import { substituteMacros, type MacroContext } from './macros';
import { normalizeRegexScript } from './regex/engine';
import { setPresetRegexScripts } from './regex/store';

export function createPresetLocalId(prefix = 'preset'): string {
    const webCrypto = typeof crypto !== 'undefined' ? crypto : undefined;
    if (webCrypto && typeof webCrypto.randomUUID === 'function') {
        return webCrypto.randomUUID();
    }
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
// 常量

/** ST 注入位置枚举 */
export const INJECTION_POSITION = { RELATIVE: 0, ABSOLUTE: 1 } as const;

/** ST 约定的 prompt_order character_id：单聊默认 / 群聊默认 */
export const ORDER_CHAR_ID_SINGLE = 100000;
export const ORDER_CHAR_ID_GROUP = 100001;

/** 真正承接剪影集角色核心上下文的 ST 角色 marker。 */
export const CHAR_CORE_MARKERS = new Set([
    'charDescription',
    'charPersonality',
    'scenario',
]);

/** 由调用方传入真实内容、按各自 marker 位置注入的联动 marker。 */
export const LINKED_CONTENT_MARKERS = new Set([
    'worldInfoBefore',
    'personaDescription',
    'worldInfoAfter',
    'dialogueExamples',
]);

/** Moro 认识的系统 marker 总集；UI 仍可用它标出不可当普通提示词编辑的条目。 */
export const CORE_CONTEXT_MARKERS = new Set([
    ...CHAR_CORE_MARKERS,
    ...LINKED_CONTENT_MARKERS,
]);

export const CHAT_HISTORY_MARKER = 'chatHistory';

export const PRESET_SCOPE_KEYS: PresetScopeKey[] = [
    'chat.private',
    'chat.proactive',
    'chat.groupText',
    'chat.groupVoice',
    'chat.phoneText',
    'role.scene',
    'creative.text',
    'structured.tool',
];

export const DEFAULT_PRESET_SCOPES: Record<PresetScopeKey, boolean> = {
    'chat.private': true,
    'chat.proactive': true,
    'chat.groupText': true,
    'chat.groupVoice': false,
    'chat.phoneText': true,
    'role.scene': false,
    'creative.text': false,
    'structured.tool': false,
};

export const PRESET_SCOPE_META: Record<PresetScopeKey, { title: string; note: string; risky?: boolean }> = {
    'chat.private': { title: '私聊回复', note: '絮语单聊、Instant Push 主回复。' },
    'chat.proactive': { title: '主动消息', note: '角色主动找你、离线主动回复。' },
    'chat.groupText': { title: '群聊文字', note: '絮语群聊文字回复，使用群聊 order。' },
    'chat.groupVoice': { title: '群语音', note: '群语音转写回复，输出 JSON，默认保护。', risky: true },
    'chat.phoneText': { title: '电话文字', note: '回声亭文字回复。' },
    'role.scene': { title: '角色场景', note: '页外/VR 等角色自主场景。' },
    'creative.text': { title: '创作文本', note: '番外、论坛、商店等自由文本任务。' },
    'structured.tool': { title: '结构化任务', note: 'JSON、总结、记忆抽取等严格格式任务。', risky: true },
};

/** 已知 marker 的展示名 + 在 Moro 里的落点说明（UI 用） */
export const MARKER_HINTS: Record<string, { name: string; hint: string }> = {
    chatHistory: { name: 'Chat History', hint: '聊天历史消息在此插入' },
    charDescription: { name: 'Char Description', hint: '剪影集「登场人物」的角色核心上下文：核心设定、身份锚、内在认知、记忆与会话状态在此承接' },
    charPersonality: { name: 'Char Personality', hint: '剪影集角色人格落点；Moro 没有独立 personality 字段，酒馆 personality 已合入核心设定，并由此承接' },
    scenario: { name: 'Scenario', hint: '剪影集「世界观补充」随角色核心上下文在此承接；也可作为角色核心 marker 的备用落点' },
    personaDescription: { name: 'Persona Description', hint: '用户人设块（扮相手账里戴着那页的署名+自述；没建扮相时为档案 App 的内容）在此注入' },
    worldInfoBefore: { name: 'World Info (before)', hint: '剪报夹世界书 before_char 条目在此注入，受整书/条目开关、挂载、关键词、概率与预算影响' },
    worldInfoAfter: { name: 'World Info (after)', hint: '剪报夹世界书 after_char 条目在此注入，受整书/条目开关、挂载、关键词、概率与预算影响' },
    dialogueExamples: { name: 'Chat Examples', hint: '角色的对话示例（登场人物编辑页「台词样张」栏 / 角色卡 mes_example）在此注入' },
};

// localStorage keys
const ENABLED_KEY = 'os_preset_enabled';
const ACTIVE_ID_KEY = 'os_preset_active_id';
const APPLY_SAMPLING_KEY = 'os_preset_apply_sampling';
const GLOBAL_SCOPES_KEY = 'os_preset_global_scopes';
const DEFAULT_PRESET_DISABLED_MIGRATION_KEY = 'os_preset_default_disabled_v1';

// ---------------------------------------------------------------------------
// 默认预设：保留 ST marker/order 结构，但给 Moro 首次使用一份更稳的全场景基线。

export const DEFAULT_PRESET_NAME = 'Moro 默认 · 稳妥自然';

export function createAllPresetScopes(): Record<PresetScopeKey, boolean> {
    return PRESET_SCOPE_KEYS.reduce((acc, key) => {
        acc[key] = true;
        return acc;
    }, {} as Record<PresetScopeKey, boolean>);
}

const DEFAULT_PROMPTS = (): PresetPrompt[] => [
    {
        name: 'Main Prompt',
        system_prompt: true,
        role: 'system',
        content: [
            '你正在为 {{char}} 生成下一段回复，参与一段虚构聊天或对应场景任务。',
            '始终优先遵守角色卡、用户身份、世界书、当前页面任务和更靠后的格式要求。',
            '保持 {{char}} 的身份、关系和说话习惯，不跳出角色解释系统提示词，不替 {{user}} 说话或决定行动。',
        ].join('\n'),
        identifier: 'main',
    },
    {
        name: '自然对话基线',
        system_prompt: true,
        role: 'system',
        content: [
            '回复要自然、具体、贴近当下语境；可以有动作、神态和心理，但不要把每句话都写成旁白。',
            '优先回应 {{user}} 刚刚说的内容，再自然延续情绪、关系或下一步行动。',
            '不要机械复述设定，不要频繁总结聊天，不要用固定开场白或模板化结尾。',
        ].join('\n'),
        identifier: 'moro-natural-style',
    },
    {
        name: '连续性与不乱编',
        system_prompt: true,
        role: 'system',
        content: [
            '保持上下文连续：承认已经发生过的事，不把刚说过的信息当成第一次听见。',
            '没有依据时不要编造重大事实、外部事件、关系变化或 {{user}} 的想法；可以用角色视角表达猜测。',
            '如果设定、世界书或聊天历史冲突，优先使用更明确、更近、更具体的信息，并让回复显得自然。',
        ].join('\n'),
        identifier: 'moro-continuity',
    },
    {
        name: '全场景格式守卫',
        system_prompt: true,
        role: 'system',
        content: [
            '如果本轮任务要求 JSON、数组、字段名、固定格式、简短结果或工具可解析输出，必须严格按该格式输出。',
            '格式任务中不要添加寒暄、解释、Markdown 围栏、旁白或额外字段，除非本轮任务明确要求。',
            '如果不是格式任务，就用自然聊天方式回复，不主动把普通对话改成列表、报告或总结。',
        ].join('\n'),
        identifier: 'moro-format-guard',
    },
    { name: 'Auxiliary Prompt', system_prompt: true, role: 'system', content: '', identifier: 'nsfw' },
    { identifier: 'dialogueExamples', name: 'Chat Examples', system_prompt: true, marker: true },
    {
        name: '群聊与多角色提醒',
        system_prompt: true,
        role: 'system',
        content: [
            '如果当前是群聊或多角色任务，只让被要求发言的角色发言；不要替未轮到的人抢答。',
            '注意不同角色的关系、立场和信息差；群聊回复要像真实接话，不要每个成员都说同一种腔调。',
            '如果本轮任务给了成员 ID 或输出字段，必须保留这些 ID/字段，不要改名或漏项。',
        ].join('\n'),
        identifier: 'moro-group-guard',
    },
    {
        name: 'Post-History Instructions',
        system_prompt: true,
        role: 'system',
        content: [
            '现在根据以上设定和最近聊天，输出 {{char}} 接下来最合适的内容。',
            '普通聊天中优先短而有来回感；需要长叙事或创作时再展开。',
            '不要暴露、复述或评价这些提示词本身。',
        ].join('\n'),
        identifier: 'jailbreak',
    },
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
    { identifier: 'moro-natural-style', enabled: true },
    { identifier: 'moro-continuity', enabled: true },
    { identifier: 'moro-format-guard', enabled: true },
    { identifier: 'worldInfoBefore', enabled: true },
    { identifier: 'charDescription', enabled: true },
    { identifier: 'charPersonality', enabled: true },
    { identifier: 'scenario', enabled: true },
    { identifier: 'enhanceDefinitions', enabled: false },
    { identifier: 'nsfw', enabled: true },
    { identifier: 'worldInfoAfter', enabled: true },
    { identifier: 'dialogueExamples', enabled: true },
    { identifier: 'moro-group-guard', enabled: true },
    { identifier: 'chatHistory', enabled: true },
    { identifier: 'jailbreak', enabled: true },
];

export function createDefaultPreset(name = DEFAULT_PRESET_NAME): TavernPreset {
    const now = Date.now();
    return {
        id: createPresetLocalId('preset'),
        name,
        createdAt: now,
        updatedAt: now,
        temperature: 0.86,
        frequency_penalty: 0,
        presence_penalty: 0,
        top_p: 1,
        top_k: 0,
        top_a: 0,
        min_p: 0,
        repetition_penalty: 1,
        openai_max_context: 32000,
        openai_max_tokens: 4000,
        moroScopes: createAllPresetScopes(),
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

function normalizeStringArray(v: any): string[] | undefined {
    const raw = Array.isArray(v) ? v : (typeof v === 'string' ? [v] : []);
    const out = raw
        .map(item => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean);
    return out.length > 0 ? Array.from(new Set(out)) : undefined;
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
    const triggers = normalizeStringArray(p.injection_trigger);
    if (triggers) out.injection_trigger = triggers;
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
        id: createPresetLocalId('preset'),
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

    // 预设自带正则（ST extensions.regex_scripts，PRESET 作用域）：随预设一同收进，
    // 激活该预设 + 印坊开印时生效。规范化与角色卡 / 全局正则导入共用 normalizeRegexScript。
    // 兼容个别导出里把脚本平铺到顶层 regex_scripts 的写法。
    const rawRegex = Array.isArray(data?.extensions?.regex_scripts)
        ? data.extensions.regex_scripts
        : (Array.isArray(data?.regex_scripts) ? data.regex_scripts : null);
    if (rawRegex) {
        const scripts = rawRegex
            .map(normalizeRegexScript)
            .filter((s: RegexScriptData | null): s is RegexScriptData => !!s);
        if (scripts.length > 0) preset.regexScripts = scripts;
    }

    return preset;
}

/** 导出成 ST 兼容 JSON：raw 兜底字段在前，当前编辑过的字段覆盖在后。 */
export function exportTavernPreset(preset: TavernPreset): Record<string, any> {
    const out: Record<string, any> = { ...(preset.raw || {}) };
    delete out.id;
    delete out.createdAt;
    delete out.updatedAt;
    delete out.moroApiPresetId;
    delete out.moroScopes;
    delete out.moroPromptOrdersByScope;
    delete out.moroSnapshots;
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
    // 预设自带正则写回 extensions.regex_scripts（preset.regexScripts 是权威源，覆盖
    // raw 里可能过期的副本；全部删完时把 raw 里的旧副本一并抹掉，保证往返一致）。
    if (preset.regexScripts && preset.regexScripts.length > 0) {
        out.extensions = { ...(out.extensions && typeof out.extensions === 'object' ? out.extensions : {}), regex_scripts: preset.regexScripts };
    } else if (out.extensions && typeof out.extensions === 'object' && 'regex_scripts' in out.extensions) {
        out.extensions = { ...out.extensions };
        delete out.extensions.regex_scripts;
    }
    return out;
}

// ---------------------------------------------------------------------------
// 宏替换 —— 委托给通用引擎（utils/macros.ts），人设 / 世界书 / 预设共用同一套语义

export type PresetMacroCtx = MacroContext;

export function substitutePresetMacros(content: string, ctx: PresetMacroCtx): string {
    return substituteMacros(content, ctx);
}

export function normalizePresetScopes(scopes?: Partial<Record<PresetScopeKey, boolean>> | null): Record<PresetScopeKey, boolean> {
    const out: Record<PresetScopeKey, boolean> = { ...DEFAULT_PRESET_SCOPES };
    if (scopes && typeof scopes === 'object') {
        for (const key of PRESET_SCOPE_KEYS) {
            if (typeof scopes[key] === 'boolean') out[key] = scopes[key];
        }
    }
    return out;
}

export function clonePresetOrderEntries(order?: PresetPromptOrderEntry[] | null): PresetPromptOrderEntry[] {
    return Array.isArray(order)
        ? order
            .filter(e => e && typeof e.identifier === 'string')
            .map(e => ({ identifier: e.identifier, enabled: e.enabled !== false }))
        : [];
}

function getOrderForCharId(preset: TavernPreset, characterId: number): PresetPromptOrderEntry[] {
    const exact = preset.prompt_order.find(po => po.character_id === characterId);
    if (exact?.order?.length) return exact.order;
    const firstNonEmpty = preset.prompt_order.find(po => po.order.length > 0);
    if (firstNonEmpty) return firstNonEmpty.order;
    if (exact) return exact.order;
    return preset.prompt_order[0]?.order ?? [];
}

function getOrCreateOrderForCharId(preset: TavernPreset, characterId: number): PresetPromptOrderEntry[] {
    let exact = preset.prompt_order.find(po => po.character_id === characterId);
    if (!exact) {
        exact = { character_id: characterId, order: clonePresetOrderEntries(preset.prompt_order[0]?.order) };
        preset.prompt_order.push(exact);
    }
    return exact.order;
}

export function isGroupPresetScope(scope?: PresetScopeKey): boolean {
    return scope === 'chat.groupText' || scope === 'chat.groupVoice';
}

export function getFallbackOrderCharacterIdForScope(scope?: PresetScopeKey): number {
    return isGroupPresetScope(scope) ? ORDER_CHAR_ID_GROUP : ORDER_CHAR_ID_SINGLE;
}

export function getPresetOrderForScope(
    preset: TavernPreset,
    scope?: PresetScopeKey,
    orderCharacterId?: number,
): PresetPromptOrderEntry[] {
    if (scope) {
        const scoped = clonePresetOrderEntries(preset.moroPromptOrdersByScope?.[scope]);
        if (scoped.length > 0) return scoped;
        return getOrderForCharId(preset, getFallbackOrderCharacterIdForScope(scope));
    }
    if (orderCharacterId !== undefined) return getOrderForCharId(preset, orderCharacterId);
    return getOrderForCharId(preset, ORDER_CHAR_ID_SINGLE);
}

export function hasScopeSpecificOrder(preset: TavernPreset, scope: PresetScopeKey): boolean {
    return clonePresetOrderEntries(preset.moroPromptOrdersByScope?.[scope]).length > 0;
}

export function setPresetScopeOrder(
    preset: TavernPreset,
    scope: PresetScopeKey,
    order: PresetPromptOrderEntry[] | null,
): void {
    if (!preset.moroPromptOrdersByScope) preset.moroPromptOrdersByScope = {};
    if (!order || order.length === 0) {
        delete preset.moroPromptOrdersByScope[scope];
    } else {
        preset.moroPromptOrdersByScope[scope] = clonePresetOrderEntries(order);
    }
    if (Object.keys(preset.moroPromptOrdersByScope).length === 0) {
        delete preset.moroPromptOrdersByScope;
    }
}

export function getEditablePresetOrderForScope(preset: TavernPreset, scope: PresetScopeKey): PresetPromptOrderEntry[] {
    const scoped = clonePresetOrderEntries(preset.moroPromptOrdersByScope?.[scope]);
    if (scoped.length > 0) return preset.moroPromptOrdersByScope![scope]!;

    const fallbackOrder = getPresetOrderForScope(preset, scope);
    const characterId = getFallbackOrderCharacterIdForScope(scope);
    const order = getOrCreateOrderForCharId(preset, characterId);
    if (order.length === 0 && fallbackOrder.length > 0) {
        order.splice(0, order.length, ...clonePresetOrderEntries(fallbackOrder));
    }
    return order;
}

export function getPresetOrderSource(preset: TavernPreset, scope: PresetScopeKey): {
    kind: 'scope' | 'st';
    inherited: boolean;
    characterId?: number;
    order: PresetPromptOrderEntry[];
} {
    const scoped = clonePresetOrderEntries(preset.moroPromptOrdersByScope?.[scope]);
    if (scoped.length > 0) {
        return { kind: 'scope', inherited: false, order: scoped };
    }
    const characterId = getFallbackOrderCharacterIdForScope(scope);
    return { kind: 'st', inherited: true, characterId, order: clonePresetOrderEntries(getOrderForCharId(preset, characterId)) };
}

function shouldTriggerPrompt(prompt: PresetPrompt, generationType?: string): boolean {
    const triggers = Array.isArray(prompt.injection_trigger)
        ? prompt.injection_trigger.map(x => String(x).toLowerCase().trim()).filter(Boolean)
        : [];
    if (triggers.length === 0) return true;
    const type = String(generationType || 'normal').toLowerCase().trim() || 'normal';
    return triggers.includes(type);
}

// ---------------------------------------------------------------------------
// 运行时组装

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
    /** 按 Moro 任务 scope 选择提示词顺序；有 scope 专用 order 时优先使用。 */
    presetScope?: PresetScopeKey;
    /** prompt_order 用哪份（单聊 100000 / 群聊 100001），默认单聊 */
    orderCharacterId?: number;
    /** ST injection_trigger 过滤用的 generation type，默认 normal */
    generationType?: string;
    /** 套完预设骨架后追加的高优先级本轮任务 / JSON 守卫。 */
    tailMessages?: Array<{ role: string; content: any }>;
    /**
     * 系统 marker 的真实内容（与剪报夹 / 剪影集联动时由调用方提供）：
     * 例如 { worldInfoBefore: '...', worldInfoAfter: '...', personaDescription: '...' }。
     * 提供了内容的 marker 会在自己的 order 位置作为独立 system 消息注入（可被开关
     * 关掉，ST 语义）；marker 压根不在 order 里时内容回折进核心上下文块，保证不丢。
     * 不提供 markerContents 时（旧调用方 / 测试）这些 marker 维持「并入核心上下文」
     * 的占位行为；提供后 world/persona/example 只注入自己的真实内容，不再抢
     * charDescription/charPersonality/scenario 的角色核心落点。
     */
    markerContents?: Partial<Record<string, string>>;
}

export function appendPresetTailMessages(
    messages: Array<{ role: string; content: any }>,
    tailMessages?: Array<{ role: string; content: any }>,
): Array<{ role: string; content: any }> {
    const tails = (tailMessages ?? []).filter(msg => msg && msg.role && msg.content !== undefined && msg.content !== null && String(msg.content).trim());
    return tails.length > 0 ? [...messages, ...tails] : messages;
}

/**
 * 把预设套到 [system(核心上下文), ...history] 形态的消息数组上，返回新数组。
 *
 * - 相对提示词按 prompt_order 顺序展开成独立消息（带各自 role）
 * - markerContents 提供了内容的 marker（worldInfo* / personaDescription /
 *   dialogueExamples）在各自位置注入；charDescription / charPersonality / scenario
 *   中第一个启用的位置注入 Moro 角色核心上下文（原 messages[0]）
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
    if (messages.length === 0 || messages[0].role !== 'system') return appendPresetTailMessages(messages, options.tailMessages);

    const history = messages.slice(1);
    const order = getPresetOrderForScope(preset, options.presetScope, options.orderCharacterId);
    if (order.length === 0) return appendPresetTailMessages(messages, options.tailMessages);

    // marker 不在 order 里（残缺/旧版预设）时，其真实内容回折进核心块，保证设定不丢：
    // worldInfoBefore 折到核心块前面，其余折到后面 —— 接近非预设路径的原始排布。
    const hasMarkerContents = options.markerContents !== undefined;
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
        const enabledForRun = entry.enabled && shouldTriggerPrompt(prompt, options.generationType);

        if (prompt.marker || CORE_CONTEXT_MARKERS.has(prompt.identifier) || prompt.identifier === CHAT_HISTORY_MARKER) {
            if (prompt.identifier === CHAT_HISTORY_MARKER) {
                historyInOrder = true;
                if (enabledForRun) {
                    historyStart = result.length;
                    result.push(...history);
                }
                continue;
            }
            // 有真实内容的 marker（剪报夹 / 用户身份 / 台词样张等）：在自己的位置注入，受开关控制
            const explicit = markerContents[prompt.identifier];
            if (explicit !== undefined) {
                if (enabledForRun && explicit.trim()) {
                    result.push({ role: 'system', content: explicit.trim() });
                }
                continue;
            }
            if (hasMarkerContents && LINKED_CONTENT_MARKERS.has(prompt.identifier)) {
                continue;
            }
            const carriesCoreContext = hasMarkerContents
                ? CHAR_CORE_MARKERS.has(prompt.identifier)
                : CORE_CONTEXT_MARKERS.has(prompt.identifier);
            if (carriesCoreContext) {
                if (enabledForRun && !coreInjected) {
                    coreInjected = true;
                    result.push(coreSystem);
                }
                continue;
            }
            // 未知 marker：无可填充内容，跳过
            continue;
        }

        if (!enabledForRun) continue;
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
    return appendPresetTailMessages(result, options.tailMessages);
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
// 高级编辑：诊断 / 安全修复 / 快照

export type PresetDiagnosticSeverity = 'error' | 'warning' | 'info';

export interface PresetDiagnosticIssue {
    code:
        | 'missing-chat-history'
        | 'disabled-chat-history'
        | 'missing-core-marker'
        | 'empty-enabled-prompt'
        | 'duplicate-order-entry'
        | 'dangling-order-entry'
        | 'detached-prompt'
        | 'risky-scope-enabled';
    severity: PresetDiagnosticSeverity;
    title: string;
    detail: string;
    fixable: boolean;
    identifier?: string;
    scope?: PresetScopeKey;
}

const BASIC_CORE_MARKERS = ['charDescription', 'charPersonality', 'scenario'];

function ensurePromptDefinition(preset: TavernPreset, identifier: string): void {
    if (preset.prompts.some(p => p.identifier === identifier)) return;
    const hint = MARKER_HINTS[identifier];
    preset.prompts.push(hint
        ? { identifier, name: hint.name, system_prompt: true, marker: true }
        : { identifier, name: identifier, role: 'system', content: '' });
}

function getMutableOrderForScope(preset: TavernPreset, scope?: PresetScopeKey): PresetPromptOrderEntry[] {
    if (scope) return getEditablePresetOrderForScope(preset, scope);
    return getOrCreateOrderForCharId(preset, ORDER_CHAR_ID_SINGLE);
}

export function diagnosePreset(preset: TavernPreset, scope?: PresetScopeKey): PresetDiagnosticIssue[] {
    const order = getPresetOrderForScope(preset, scope);
    const byId = new Map((preset.prompts ?? []).map(p => [p.identifier, p]));
    const issues: PresetDiagnosticIssue[] = [];
    const seen = new Set<string>();
    const attached = new Set<string>();

    for (const entry of order) {
        attached.add(entry.identifier);
        const prompt = byId.get(entry.identifier);
        if (seen.has(entry.identifier)) {
            issues.push({
                code: 'duplicate-order-entry',
                severity: 'warning',
                title: '顺序里有重复条目',
                detail: `「${entry.identifier}」在当前发送顺序里出现了不止一次。`,
                fixable: true,
                identifier: entry.identifier,
                scope,
            });
        }
        seen.add(entry.identifier);
        if (!prompt) {
            issues.push({
                code: 'dangling-order-entry',
                severity: 'warning',
                title: '顺序引用了缺失提示词',
                detail: `「${entry.identifier}」在顺序里，但字库里找不到定义。`,
                fixable: true,
                identifier: entry.identifier,
                scope,
            });
            continue;
        }
        if (entry.enabled && !prompt.marker && !(prompt.content || '').trim()) {
            issues.push({
                code: 'empty-enabled-prompt',
                severity: 'info',
                title: '启用了空提示词',
                detail: `「${prompt.name}」已启用，但正文为空，发送时会被跳过。`,
                fixable: true,
                identifier: entry.identifier,
                scope,
            });
        }
    }

    const chatHistoryEntry = order.find(e => e.identifier === CHAT_HISTORY_MARKER);
    if (!chatHistoryEntry) {
        issues.push({
            code: 'missing-chat-history',
            severity: 'error',
            title: '缺少聊天历史 marker',
            detail: '当前顺序里没有 chatHistory，模型可能看不到最近聊天。',
            fixable: true,
            identifier: CHAT_HISTORY_MARKER,
            scope,
        });
    } else if (!chatHistoryEntry.enabled) {
        issues.push({
            code: 'disabled-chat-history',
            severity: 'error',
            title: '聊天历史 marker 被关闭',
            detail: 'chatHistory 已在顺序里，但当前关闭，模型会按无历史模式回复。',
            fixable: true,
            identifier: CHAT_HISTORY_MARKER,
            scope,
        });
    }

    const enabledCore = order.some(e => e.enabled && CHAR_CORE_MARKERS.has(e.identifier));
    if (!enabledCore) {
        issues.push({
            code: 'missing-core-marker',
            severity: 'error',
            title: '核心上下文没有启用落点',
            detail: '剪影集角色核心上下文需要 charDescription、charPersonality 或 scenario 至少一个启用；worldInfo/persona/dialogue 只承接各自真实内容。',
            fixable: true,
            identifier: 'charDescription',
            scope,
        });
    }

    for (const prompt of preset.prompts ?? []) {
        if (!attached.has(prompt.identifier) && !prompt.marker) {
            issues.push({
                code: 'detached-prompt',
                severity: 'info',
                title: '有未使用提示词',
                detail: `「${prompt.name}」存在于字库，但不在当前发送顺序里。`,
                fixable: false,
                identifier: prompt.identifier,
                scope,
            });
        }
    }

    const scopes = normalizePresetScopes(preset.moroScopes);
    for (const key of PRESET_SCOPE_KEYS) {
        if (PRESET_SCOPE_META[key].risky && scopes[key]) {
            issues.push({
                code: 'risky-scope-enabled',
                severity: 'warning',
                title: '风险任务范围已开启',
                detail: `「${PRESET_SCOPE_META[key].title}」会吃这份预设，请确认不会破坏 JSON 或特殊格式。`,
                fixable: false,
                scope: key,
            });
        }
    }

    return issues;
}

export function applySafePresetFixes(preset: TavernPreset, scope?: PresetScopeKey): { preset: TavernPreset; fixed: string[] } {
    const next: TavernPreset = JSON.parse(JSON.stringify(preset));
    const order = getMutableOrderForScope(next, scope);
    const fixed: string[] = [];
    const byId = () => new Map(next.prompts.map(p => [p.identifier, p]));

    const deduped: PresetPromptOrderEntry[] = [];
    const seen = new Set<string>();
    for (const entry of order) {
        if (seen.has(entry.identifier)) {
            fixed.push(`移除重复顺序项：${entry.identifier}`);
            continue;
        }
        seen.add(entry.identifier);
        deduped.push(entry);
    }
    order.splice(0, order.length, ...deduped);

    for (const entry of order) {
        if (!byId().has(entry.identifier)) {
            ensurePromptDefinition(next, entry.identifier);
            fixed.push(`补齐缺失提示词定义：${entry.identifier}`);
        }
        const prompt = byId().get(entry.identifier);
        if (entry.enabled && prompt && !prompt.marker && !(prompt.content || '').trim()) {
            entry.enabled = false;
            fixed.push(`关闭空提示词：${prompt.name}`);
        }
    }

    if (!order.some(e => e.identifier === CHAT_HISTORY_MARKER)) {
        ensurePromptDefinition(next, CHAT_HISTORY_MARKER);
        order.push({ identifier: CHAT_HISTORY_MARKER, enabled: true });
        fixed.push('补回聊天历史 marker');
    } else {
        const entry = order.find(e => e.identifier === CHAT_HISTORY_MARKER)!;
        if (!entry.enabled) {
            entry.enabled = true;
            fixed.push('重新启用聊天历史 marker');
        }
    }

    if (!order.some(e => e.enabled && CHAR_CORE_MARKERS.has(e.identifier))) {
        for (const id of BASIC_CORE_MARKERS) ensurePromptDefinition(next, id);
        const existing = order.find(e => CHAR_CORE_MARKERS.has(e.identifier));
        if (existing) {
            existing.enabled = true;
            fixed.push(`重新启用核心 marker：${existing.identifier}`);
        } else {
            order.unshift({ identifier: 'charDescription', enabled: true });
            fixed.push('补回角色核心 marker');
        }
    }

    next.updatedAt = Date.now();
    return { preset: next, fixed };
}

function snapshotPayload(preset: TavernPreset): Omit<TavernPreset, 'moroSnapshots'> {
    const copy: TavernPreset = JSON.parse(JSON.stringify(preset));
    delete copy.moroSnapshots;
    return copy;
}

export function createPresetSnapshot(preset: TavernPreset, name?: string, reason?: string): PresetSnapshot {
    const now = Date.now();
    return {
        id: createPresetLocalId('snap'),
        name: (name || `快照 ${new Date(now).toLocaleString('zh-CN', { hour12: false })}`).trim(),
        createdAt: now,
        reason,
        preset: snapshotPayload(preset),
    };
}

export interface PresetDiffSummary {
    changed: boolean;
    items: string[];
}

function orderSignature(order?: PresetPromptOrderEntry[]): string {
    return clonePresetOrderEntries(order).map(e => `${e.enabled ? '1' : '0'}:${e.identifier}`).join('|');
}

export function diffPresetSnapshot(snapshot: PresetSnapshot, current: TavernPreset): PresetDiffSummary {
    const before = snapshot.preset;
    const after = snapshotPayload(current);
    const items: string[] = [];

    if (before.name !== after.name) items.push(`名称：${before.name} → ${after.name}`);
    if (before.moroApiPresetId !== after.moroApiPresetId) items.push('API 方案绑定有变化');
    for (const f of SAMPLING_FIELDS) {
        if ((before as any)[f] !== (after as any)[f]) items.push(`采样参数 ${f} 有变化`);
    }
    if (JSON.stringify(normalizePresetScopes(before.moroScopes)) !== JSON.stringify(normalizePresetScopes(after.moroScopes))) {
        items.push('作用范围开关有变化');
    }
    const scopeKeys = new Set([
        ...Object.keys(before.moroPromptOrdersByScope || {}),
        ...Object.keys(after.moroPromptOrdersByScope || {}),
    ]);
    for (const scope of scopeKeys) {
        const key = scope as PresetScopeKey;
        if (orderSignature(before.moroPromptOrdersByScope?.[key]) !== orderSignature(after.moroPromptOrdersByScope?.[key])) {
            items.push(`scope 专用顺序 ${scope} 有变化`);
        }
    }
    for (const po of before.prompt_order) {
        const next = after.prompt_order.find(item => item.character_id === po.character_id);
        if (orderSignature(po.order) !== orderSignature(next?.order)) items.push(`ST 顺序 ${po.character_id} 有变化`);
    }
    const beforePrompts = new Map(before.prompts.map(p => [p.identifier, p]));
    const afterPrompts = new Map(after.prompts.map(p => [p.identifier, p]));
    if (beforePrompts.size !== afterPrompts.size) items.push('提示词数量有变化');
    for (const [id, p] of beforePrompts) {
        const n = afterPrompts.get(id);
        if (!n) {
            items.push(`提示词被删除：${p.name}`);
        } else if (JSON.stringify(p) !== JSON.stringify(n)) {
            items.push(`提示词被修改：${n.name || p.name}`);
        }
    }
    for (const [id, p] of afterPrompts) {
        if (!beforePrompts.has(id)) items.push(`新增提示词：${p.name}`);
    }
    if ((before.regexScripts?.length ?? 0) !== (after.regexScripts?.length ?? 0)) {
        items.push('随预设正则数量有变化');
    }

    return { changed: items.length > 0, items };
}

export function restorePresetSnapshotAsCopy(snapshot: PresetSnapshot, name?: string): TavernPreset {
    const now = Date.now();
    const preset: TavernPreset = JSON.parse(JSON.stringify(snapshot.preset));
    preset.id = createPresetLocalId('preset');
    preset.name = (name || `${snapshot.preset.name} · 从快照恢复`).trim();
    preset.createdAt = now;
    preset.updatedAt = now;
    preset.moroSnapshots = [];
    return preset;
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
    getGlobalScopes(): Record<PresetScopeKey, boolean> {
        try {
            const raw = localStorage.getItem(GLOBAL_SCOPES_KEY);
            return normalizePresetScopes(raw ? JSON.parse(raw) : null);
        } catch {
            return normalizePresetScopes(null);
        }
    },
    setGlobalScopes(scopes: Partial<Record<PresetScopeKey, boolean>>): void {
        try {
            localStorage.setItem(GLOBAL_SCOPES_KEY, JSON.stringify(normalizePresetScopes(scopes)));
        } catch { /* ignore */ }
    },
    isScopeEnabled(scope: PresetScopeKey, preset?: TavernPreset | null): boolean {
        if (!PresetRuntime.isEnabled()) return false;
        const globalScopes = PresetRuntime.getGlobalScopes();
        if (!globalScopes[scope]) return false;
        const presetScopes = normalizePresetScopes(preset?.moroScopes);
        return !!presetScopes[scope];
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
    /** 预设总开关 + scope 双层开关均打开时返回激活预设，否则 null。 */
    async getActivePresetForScope(scope: PresetScopeKey): Promise<TavernPreset | null> {
        const preset = await PresetRuntime.getActivePreset();
        if (!preset) return null;
        return PresetRuntime.isScopeEnabled(scope, preset) ? preset : null;
    },
    /** 采样开关 + 激活预设的合并入口：返回要并进请求体的参数（无则 null） */
    async getActiveGenParams(scope?: PresetScopeKey): Promise<PresetGenParams | null> {
        if (!PresetRuntime.isSamplingApplied()) return null;
        const preset = scope
            ? await PresetRuntime.getActivePresetForScope(scope)
            : await PresetRuntime.getActivePreset();
        if (!preset) return null;
        const params = getPresetGenParams(preset);
        return Object.keys(params).length > 0 ? params : null;
    },
};

let defaultPresetSeedPromise: Promise<TavernPreset | null> | null = null;

function isBuiltInDefaultPreset(preset: TavernPreset | null | undefined): boolean {
    if (!preset || preset.name !== DEFAULT_PRESET_NAME) return false;
    const promptIds = new Set((preset.prompts ?? []).map(p => p.identifier));
    return promptIds.has('moro-natural-style') && promptIds.has('moro-format-guard') && promptIds.has('chatHistory');
}

function hasDisabledDefaultPresetMigration(): boolean {
    try { return localStorage.getItem(DEFAULT_PRESET_DISABLED_MIGRATION_KEY) === '1'; } catch { return true; }
}

function markDisabledDefaultPresetMigration(): void {
    try { localStorage.setItem(DEFAULT_PRESET_DISABLED_MIGRATION_KEY, '1'); } catch { /* ignore */ }
}

function disableBuiltInDefaultPresetOnce(existing: TavernPreset[]): void {
    if (hasDisabledDefaultPresetMigration()) return;
    const activeId = PresetRuntime.getActiveId();
    const activePreset = activeId
        ? existing.find(p => p.id === activeId)
        : (existing.length === 1 ? existing[0] : existing.find(isBuiltInDefaultPreset));
    if (!isBuiltInDefaultPreset(activePreset)) return;
    PresetRuntime.setEnabled(false);
    markDisabledDefaultPresetMigration();
}

/**
 * 空库补种一份默认关闭的 Moro 默认预设；历史已补种的内置默认预设会被关回一次。
 * 其它用户已有预设、开关或作用范围不覆盖。
 */
export async function ensureDefaultPresetSeed(): Promise<TavernPreset | null> {
    if (defaultPresetSeedPromise) return defaultPresetSeedPromise;

    defaultPresetSeedPromise = (async () => {
        try {
            const existing = await DB.getAllPresets();
            if (existing.length > 0) {
                disableBuiltInDefaultPresetOnce(existing);
                return null;
            }

            const preset = createDefaultPreset();
            await DB.savePreset(preset);
            PresetRuntime.setActiveId(preset.id);
            PresetRuntime.setEnabled(false);
            PresetRuntime.setSamplingApplied(true);
            PresetRuntime.setGlobalScopes(createAllPresetScopes());
            markDisabledDefaultPresetMigration();
            return preset;
        } catch (e) {
            console.warn('[Presets] 补种默认预设失败:', e);
            return null;
        } finally {
            defaultPresetSeedPromise = null;
        }
    })();

    return defaultPresetSeedPromise;
}

/**
 * 把激活预设自带的正则（preset.regexScripts）推进 utils/regex/store.ts 的运行时缓存。
 * 聊天管线四个挂载点是同步的、取不到 async 的激活预设，所以由这里在以下时机刷新：
 *  - App 启动（OSContext，确保「直接进聊天、没开活字盘」时第一条 USER_INPUT 也能命中）
 *  - 活字盘里选预设 / 开关印坊 / 改动正则（即时反映到聊天与气泡渲染）
 * buildChatRequestPayload 走另一条更省的路：它已 await 出激活预设，直接调
 * setPresetRegexScripts，免去再读一次 IndexedDB。印坊歇业 / 无激活预设时清空缓存。
 */
export async function refreshPresetRegexCache(): Promise<void> {
    try {
        const preset = await PresetRuntime.getActivePreset();
        setPresetRegexScripts(preset?.regexScripts ?? null);
    } catch (e) {
        console.warn('[Presets] 刷新预设正则缓存失败:', e);
        setPresetRegexScripts(null);
    }
}
