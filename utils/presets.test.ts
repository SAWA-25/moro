import { describe, it, expect } from 'vitest';
import {
    INJECTION_POSITION,
    ORDER_CHAR_ID_SINGLE,
    ORDER_CHAR_ID_GROUP,
    applyPresetToMessages,
    createDefaultPreset,
    exportTavernPreset,
    getPresetGenParams,
    importTavernPreset,
    substitutePresetMacros,
} from './presets';
import type { TavernPreset } from '../types';

const MACROS = { charName: '小明', userName: '阿罗' };

/** ST Default.json 的结构性子集（字段名与酒馆导出一致） */
const ST_PRESET_JSON = {
    chat_completion_source: 'openai',
    openai_model: 'gpt-4-turbo',
    temperature: 0.7,
    frequency_penalty: 0.1,
    presence_penalty: 0.2,
    top_p: 0.95,
    top_k: 40,
    repetition_penalty: 1.1,
    openai_max_context: 32000,
    openai_max_tokens: 2000,
    impersonation_prompt: '[Impersonate]',
    prompts: [
        { name: 'Main Prompt', system_prompt: true, role: 'system', content: 'Write {{char}} reply to {{user}}.', identifier: 'main' },
        { name: 'Aux', system_prompt: true, role: 'system', content: '', identifier: 'nsfw' },
        { identifier: 'chatHistory', name: 'Chat History', system_prompt: true, marker: true },
        { identifier: 'charDescription', name: 'Char Description', system_prompt: true, marker: true },
        { identifier: 'worldInfoBefore', name: 'World Info (before)', system_prompt: true, marker: true },
        { name: 'Post-History', system_prompt: true, role: 'system', content: 'PHI text', identifier: 'jailbreak' },
        {
            name: '深度注入', identifier: 'uuid-deep-1', role: 'assistant', content: 'deep note',
            injection_position: 1, injection_depth: 2, injection_order: 100, system_prompt: false,
        },
    ],
    prompt_order: [
        {
            character_id: 100000,
            order: [
                { identifier: 'main', enabled: true },
                { identifier: 'worldInfoBefore', enabled: true },
                { identifier: 'charDescription', enabled: true },
                { identifier: 'nsfw', enabled: false },
                { identifier: 'chatHistory', enabled: true },
                { identifier: 'jailbreak', enabled: true },
                { identifier: 'uuid-deep-1', enabled: true },
            ],
        },
    ],
};

const history = [
    { role: 'user', content: 'u1' },
    { role: 'assistant', content: 'a1' },
    { role: 'user', content: 'u2' },
    { role: 'assistant', content: 'a2' },
];
const baseMessages = [{ role: 'system', content: 'CORE' }, ...history];

describe('importTavernPreset', () => {
    it('完整映射 ST 预设：采样参数 / prompts / prompt_order / raw 兜底', () => {
        const p = importTavernPreset(ST_PRESET_JSON, 'fallback');
        expect(p.temperature).toBe(0.7);
        expect(p.top_k).toBe(40);
        expect(p.openai_max_tokens).toBe(2000);
        expect(p.prompts.map(x => x.identifier)).toContain('uuid-deep-1');
        expect(p.prompt_order[0].character_id).toBe(ORDER_CHAR_ID_SINGLE);
        expect(p.prompt_order[0].order.find(e => e.identifier === 'nsfw')?.enabled).toBe(false);
        // 未映射字段保留在 raw，导出时不丢
        expect(p.raw?.impersonation_prompt).toBe('[Impersonate]');
        expect(p.raw?.openai_model).toBe('gpt-4-turbo');
        expect(p.name).toBe('fallback');
    });

    it('order 引用悬空 identifier 时补占位 prompt 而不是报错', () => {
        const p = importTavernPreset({
            prompts: [{ identifier: 'main', name: 'Main', role: 'system', content: 'x' }],
            prompt_order: [{ character_id: 100000, order: [
                { identifier: 'main', enabled: true },
                { identifier: 'ghost', enabled: true },
                { identifier: 'chatHistory', enabled: true },
            ] }],
        }, 'n');
        expect(p.prompts.some(x => x.identifier === 'ghost')).toBe(true);
        expect(p.prompts.find(x => x.identifier === 'chatHistory')?.marker).toBe(true);
    });

    it('缺 prompts / prompt_order 时落默认结构', () => {
        const p = importTavernPreset({ temperature: 1.2 }, 'bare');
        expect(p.prompts.length).toBeGreaterThan(0);
        expect(p.prompt_order.map(po => po.character_id)).toEqual([ORDER_CHAR_ID_SINGLE, ORDER_CHAR_ID_GROUP]);
    });

    it('非对象输入抛错', () => {
        expect(() => importTavernPreset([1, 2], 'x')).toThrow();
        expect(() => importTavernPreset('str', 'x')).toThrow();
    });
});

describe('exportTavernPreset', () => {
    it('导入再导出：raw 字段原样保留，编辑过的字段覆盖', () => {
        const p = importTavernPreset(ST_PRESET_JSON, 'n');
        p.temperature = 1.5;
        const out = exportTavernPreset(p);
        expect(out.temperature).toBe(1.5);
        expect(out.impersonation_prompt).toBe('[Impersonate]');
        expect(out.chat_completion_source).toBe('openai');
        expect(out.prompts.length).toBe(p.prompts.length);
        expect(out.id).toBeUndefined();
        expect(out.createdAt).toBeUndefined();
        // 导出物可再导入（往返兼容）
        const again = importTavernPreset(out, 'n2');
        expect(again.temperature).toBe(1.5);
    });
});

describe('substitutePresetMacros', () => {
    it('替换 {{char}} / {{user}}，未知宏原样保留', () => {
        expect(substitutePresetMacros('{{char}}对{{user}}说{{unknown}}', MACROS)).toBe('小明对阿罗说{{unknown}}');
        expect(substitutePresetMacros('{{CHAR}}', MACROS)).toBe('小明'); // 大小写不敏感（同 ST）
    });
});

describe('applyPresetToMessages', () => {
    it('按 prompt_order 展开：相对提示词成独立消息，核心上下文落在第一个启用的核心 marker', () => {
        const p = importTavernPreset(ST_PRESET_JSON, 'n');
        // 去掉绝对注入，先看骨架
        p.prompt_order[0].order = p.prompt_order[0].order.filter(e => e.identifier !== 'uuid-deep-1');
        const out = applyPresetToMessages(baseMessages, p, { macros: MACROS });
        // main → 核心(worldInfoBefore 是第一个启用核心 marker) → (charDescription 跳过) →
        // (nsfw 关闭) → history×4 → jailbreak
        expect(out.map(m => m.content)).toEqual([
            'Write 小明 reply to 阿罗.',
            'CORE',
            'u1', 'a1', 'u2', 'a2',
            'PHI text',
        ]);
        expect(out[0].role).toBe('system');
    });

    it('绝对提示词按 @深度注入聊天历史（深度从末尾数）', () => {
        const p = importTavernPreset(ST_PRESET_JSON, 'n');
        const out = applyPresetToMessages(baseMessages, p, { macros: MACROS });
        // depth=2 → 距历史末尾 2 条：u1, a1, [deep note], u2, a2
        const contents = out.map(m => m.content);
        const i = contents.indexOf('deep note');
        expect(i).toBeGreaterThan(-1);
        expect(contents[i - 1]).toBe('a1');
        expect(contents[i + 1]).toBe('u2');
        expect(out[i].role).toBe('assistant');
    });

    it('同深度多条：order 大的更靠近末尾；同 order 内时间顺序 assistant→user→system', () => {
        const p = createDefaultPreset();
        p.prompts.push(
            { identifier: 'd1', name: 'd1', role: 'system', content: 'S-100', injection_position: INJECTION_POSITION.ABSOLUTE, injection_depth: 1, injection_order: 100 },
            { identifier: 'd2', name: 'd2', role: 'assistant', content: 'A-100', injection_position: INJECTION_POSITION.ABSOLUTE, injection_depth: 1, injection_order: 100 },
            { identifier: 'd3', name: 'd3', role: 'system', content: 'S-200', injection_position: INJECTION_POSITION.ABSOLUTE, injection_depth: 1, injection_order: 200 },
        );
        for (const po of p.prompt_order) {
            po.order.push({ identifier: 'd1', enabled: true }, { identifier: 'd2', enabled: true }, { identifier: 'd3', enabled: true });
        }
        const out = applyPresetToMessages(baseMessages, p, { macros: MACROS });
        const contents = out.map(m => m.content);
        const lastIdx = contents.indexOf('a2');
        // 末尾前 1 条处，按 order 升序排：A-100, S-100, S-200 紧贴在 a2 之前
        expect(contents.slice(lastIdx - 3, lastIdx)).toEqual(['A-100', 'S-100', 'S-200']);
    });

    it('chatHistory 不在 order 里时兜底把历史追加到末尾', () => {
        const p = importTavernPreset({
            prompts: [{ identifier: 'main', name: 'Main', role: 'system', content: 'M' }],
            prompt_order: [{ character_id: 100000, order: [{ identifier: 'main', enabled: true }] }],
        }, 'n');
        const out = applyPresetToMessages(baseMessages, p, { macros: MACROS });
        // 核心 marker 全缺 → 核心兜底注到最前；历史兜底追加
        expect(out.map(m => m.content)).toEqual(['CORE', 'M', 'u1', 'a1', 'u2', 'a2']);
    });

    it('核心 marker 全被关闭时仍兜底注入核心上下文（防止人设静默丢失）', () => {
        const p = importTavernPreset(ST_PRESET_JSON, 'n');
        for (const e of p.prompt_order[0].order) {
            if (['worldInfoBefore', 'charDescription'].includes(e.identifier)) e.enabled = false;
        }
        const out = applyPresetToMessages(baseMessages, p, { macros: MACROS });
        expect(out.some(m => m.content === 'CORE')).toBe(true);
        expect(out[0].content).toBe('CORE');
    });

    it('messages[0] 不是 system（DevDebug 跳过 prompt build）时原样返回', () => {
        const p = createDefaultPreset();
        const msgs = [{ role: 'user', content: 'hi' }];
        expect(applyPresetToMessages(msgs, p, { macros: MACROS })).toBe(msgs);
    });

    it('空内容的相对提示词不产生空消息', () => {
        const p = importTavernPreset(ST_PRESET_JSON, 'n');
        for (const e of p.prompt_order[0].order) {
            if (e.identifier === 'nsfw') e.enabled = true; // nsfw content 为空
        }
        const out = applyPresetToMessages(baseMessages, p, { macros: MACROS });
        expect(out.every(m => typeof m.content !== 'string' || m.content.length > 0)).toBe(true);
    });
});

describe('getPresetGenParams', () => {
    it('标准字段始终带上，扩展字段只在非默认值时附带', () => {
        const p: TavernPreset = createDefaultPreset();
        p.temperature = 0.8;
        p.top_k = 0;             // 默认 → 不带
        p.repetition_penalty = 1; // 默认 → 不带
        p.openai_max_tokens = 4096;
        const params = getPresetGenParams(p);
        expect(params.temperature).toBe(0.8);
        expect(params.max_tokens).toBe(4096);
        expect(params.top_k).toBeUndefined();
        expect(params.repetition_penalty).toBeUndefined();
        p.top_k = 50;
        p.repetition_penalty = 1.15;
        const params2 = getPresetGenParams(p);
        expect(params2.top_k).toBe(50);
        expect(params2.repetition_penalty).toBe(1.15);
    });
});
