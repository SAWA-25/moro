import { afterEach, describe, it, expect, vi } from 'vitest';
import {
    DEFAULT_PRESET_NAME,
    DEFAULT_PRESET_SCOPES,
    INJECTION_POSITION,
    ORDER_CHAR_ID_SINGLE,
    ORDER_CHAR_ID_GROUP,
    PresetRuntime,
    applyPresetToMessages,
    createAllPresetScopes,
    createDefaultPreset,
    ensureDefaultPresetSeed,
    exportTavernPreset,
    getPresetGenParams,
    importTavernPreset,
    normalizePresetScopes,
    substitutePresetMacros,
} from './presets';
import { DB } from './db';
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

afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
});

describe('Moro default preset seed', () => {
    it('createDefaultPreset builds the refined all-scope baseline without empty output messages', () => {
        const preset = createDefaultPreset();
        const promptIds = preset.prompts.map(p => p.identifier);

        expect(preset.name).toBe(DEFAULT_PRESET_NAME);
        expect(promptIds).toEqual(expect.arrayContaining([
            'main',
            'moro-natural-style',
            'moro-continuity',
            'moro-format-guard',
            'moro-group-guard',
            'chatHistory',
            'worldInfoBefore',
            'worldInfoAfter',
            'personaDescription',
            'dialogueExamples',
        ]));
        expect(preset.prompt_order.map(po => po.character_id)).toEqual([ORDER_CHAR_ID_SINGLE, ORDER_CHAR_ID_GROUP]);
        expect(preset.moroScopes).toEqual(createAllPresetScopes());

        const out = applyPresetToMessages(baseMessages, preset, { macros: MACROS });
        expect(out.some(m => String(m.content).includes('JSON'))).toBe(true);
        expect(out.some(m => m.content === 'CORE')).toBe(true);
        expect(out.map(m => m.content)).toEqual(expect.arrayContaining(['u1', 'a1', 'u2', 'a2']));
        expect(out.every(m => typeof m.content !== 'string' || m.content.trim().length > 0)).toBe(true);
    });

    it('ensureDefaultPresetSeed seeds an active selection but keeps the master switch off by default', async () => {
        await DB.deleteDB();

        const seeded = await ensureDefaultPresetSeed();
        const list = await DB.getAllPresets();

        expect(seeded).toBeTruthy();
        expect(list).toHaveLength(1);
        expect(list[0].id).toBe(seeded!.id);
        expect(PresetRuntime.getActiveId()).toBe(seeded!.id);
        expect(PresetRuntime.isEnabled()).toBe(false);
        expect(PresetRuntime.isSamplingApplied()).toBe(true);
        expect(PresetRuntime.getGlobalScopes()).toEqual(createAllPresetScopes());
        await expect(PresetRuntime.getActivePreset()).resolves.toBeNull();

        PresetRuntime.setEnabled(true);
        await expect(PresetRuntime.getActivePreset()).resolves.toMatchObject({ id: seeded!.id });
    });

    it('ensureDefaultPresetSeed turns an already-seeded built-in default preset off once', async () => {
        await DB.deleteDB();
        const existing = createDefaultPreset();
        await DB.savePreset(existing);
        PresetRuntime.setActiveId(existing.id);
        PresetRuntime.setEnabled(true);

        await expect(ensureDefaultPresetSeed()).resolves.toBeNull();
        expect(PresetRuntime.isEnabled()).toBe(false);

        PresetRuntime.setEnabled(true);
        await expect(ensureDefaultPresetSeed()).resolves.toBeNull();
        expect(PresetRuntime.isEnabled()).toBe(true);
    });

    it('ensureDefaultPresetSeed does not override existing presets or local switches', async () => {
        await DB.deleteDB();
        const existing = createDefaultPreset('existing');
        await DB.savePreset(existing);
        PresetRuntime.setActiveId(existing.id);
        PresetRuntime.setEnabled(true);
        PresetRuntime.setSamplingApplied(false);
        PresetRuntime.setGlobalScopes(DEFAULT_PRESET_SCOPES);

        await expect(ensureDefaultPresetSeed()).resolves.toBeNull();
        const list = await DB.getAllPresets();

        expect(list).toHaveLength(1);
        expect(list[0].id).toBe(existing.id);
        expect(PresetRuntime.getActiveId()).toBe(existing.id);
        expect(PresetRuntime.isEnabled()).toBe(true);
        expect(PresetRuntime.isSamplingApplied()).toBe(false);
        expect(PresetRuntime.getGlobalScopes()).toEqual(DEFAULT_PRESET_SCOPES);
    });
});

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

    it('保留 ST injection_trigger 字段并去重规范化', () => {
        const p = importTavernPreset({
            prompts: [{ identifier: 'main', name: 'Main', role: 'system', content: 'x', injection_trigger: ['quiet', 'normal', 'quiet', ''] }],
            prompt_order: [{ character_id: 100000, order: [{ identifier: 'main', enabled: true }] }],
        }, 'n');
        expect(p.prompts[0].injection_trigger).toEqual(['quiet', 'normal']);
        expect(exportTavernPreset(p).prompts[0].injection_trigger).toEqual(['quiet', 'normal']);
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

    it('导出时剥离 Moro 本地字段：API 绑定与作用范围不写入 ST JSON', () => {
        const p = importTavernPreset(ST_PRESET_JSON, 'n');
        p.moroApiPresetId = 'api-local';
        p.moroScopes = { 'chat.private': true, 'structured.tool': true };
        if (p.raw) {
            (p.raw as any).moroApiPresetId = 'raw-api';
            (p.raw as any).moroScopes = { 'chat.groupText': true };
        }
        const out = exportTavernPreset(p);
        expect(out.moroApiPresetId).toBeUndefined();
        expect(out.moroScopes).toBeUndefined();
    });
});

describe('预设自带正则（extensions.regex_scripts，PRESET 作用域）', () => {
    const REGEX_PRESET = {
        ...ST_PRESET_JSON,
        extensions: {
            regex_scripts: [
                { id: 'r1', scriptName: '剥离思考', findRegex: '/<think>[\\s\\S]*?<\\/think>/g', replaceString: '', placement: [2], promptOnly: true },
                { id: 'r2', scriptName: '状态栏美化', findRegex: '/<status>([\\s\\S]*?)<\\/status>/g', replaceString: '$1', placement: [2], markdownOnly: true },
            ],
        },
    };

    it('导入：extensions.regex_scripts → preset.regexScripts，逐条规范化', () => {
        const p = importTavernPreset(REGEX_PRESET, 'n');
        expect(p.regexScripts).toHaveLength(2);
        expect(p.regexScripts?.[0].id).toBe('r1');
        expect(p.regexScripts?.[0].scriptName).toBe('剥离思考');
        expect(p.regexScripts?.[0].promptOnly).toBe(true);
        // normalizeRegexScript 补齐缺省字段
        expect(p.regexScripts?.[1].trimStrings).toEqual([]);
        expect(p.regexScripts?.[1].markdownOnly).toBe(true);
    });

    it('导入：兼容平铺到顶层的 regex_scripts', () => {
        const p = importTavernPreset({ ...ST_PRESET_JSON, regex_scripts: REGEX_PRESET.extensions.regex_scripts }, 'n');
        expect(p.regexScripts).toHaveLength(2);
    });

    it('导入：没带正则时 preset.regexScripts 为 undefined（不留空数组噪声）', () => {
        const p = importTavernPreset(ST_PRESET_JSON, 'n');
        expect(p.regexScripts).toBeUndefined();
    });

    it('导出：preset.regexScripts 写回 extensions.regex_scripts', () => {
        const p = importTavernPreset(REGEX_PRESET, 'n');
        const out = exportTavernPreset(p);
        expect(out.extensions.regex_scripts).toHaveLength(2);
        expect(out.extensions.regex_scripts[0].id).toBe('r1');
    });

    it('往返：导入→导出→再导入，正则不丢', () => {
        const out = exportTavernPreset(importTavernPreset(REGEX_PRESET, 'n'));
        const again = importTavernPreset(out, 'n2');
        expect(again.regexScripts).toHaveLength(2);
        expect(again.regexScripts?.map(s => s.id)).toEqual(['r1', 'r2']);
    });

    it('导出：删光正则后，raw 里的旧副本一并抹掉', () => {
        const p = importTavernPreset(REGEX_PRESET, 'n');
        p.regexScripts = [];
        const out = exportTavernPreset(p);
        expect(out.extensions?.regex_scripts).toBeUndefined();
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

    it('按 ST injection_trigger 过滤提示词，默认 generationType=normal', () => {
        const p = createDefaultPreset();
        p.prompts.push(
            { identifier: 'normal-only', name: 'normal', role: 'system', content: 'NORMAL', injection_trigger: ['normal'] },
            { identifier: 'quiet-only', name: 'quiet', role: 'system', content: 'QUIET', injection_trigger: ['quiet'] },
        );
        for (const po of p.prompt_order) {
            po.order.push({ identifier: 'normal-only', enabled: true }, { identifier: 'quiet-only', enabled: true });
        }
        expect(applyPresetToMessages(baseMessages, p, { macros: MACROS }).map(m => m.content)).toContain('NORMAL');
        expect(applyPresetToMessages(baseMessages, p, { macros: MACROS }).map(m => m.content)).not.toContain('QUIET');
        expect(applyPresetToMessages(baseMessages, p, { macros: MACROS, generationType: 'quiet' }).map(m => m.content)).toContain('QUIET');
    });

    it('群聊链路可使用 100001 的 prompt_order', () => {
        const p = createDefaultPreset();
        const main = p.prompts.find(prompt => prompt.identifier === 'main')!;
        main.content = 'single {{char}}';
        p.prompts.push({ identifier: 'group-main', name: 'Group Main', role: 'system', content: 'group {{char}}' });
        p.prompt_order = [
            { character_id: ORDER_CHAR_ID_SINGLE, order: [{ identifier: 'main', enabled: true }, { identifier: 'chatHistory', enabled: true }] },
            { character_id: ORDER_CHAR_ID_GROUP, order: [{ identifier: 'group-main', enabled: true }, { identifier: 'chatHistory', enabled: true }] },
        ];
        const out = applyPresetToMessages(baseMessages, p, { macros: MACROS, orderCharacterId: ORDER_CHAR_ID_GROUP });
        expect(out.map(m => m.content)).toEqual(['CORE', 'group 小明', 'u1', 'a1', 'u2', 'a2']);
    });

    it('tailMessages 总是在预设骨架之后追加，用于 JSON 守卫', () => {
        const p = createDefaultPreset();
        const out = applyPresetToMessages(baseMessages, p, {
            macros: MACROS,
            tailMessages: [{ role: 'system', content: 'JSON ONLY' }],
        });
        expect(out[out.length - 1]).toEqual({ role: 'system', content: 'JSON ONLY' });
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

describe('预设作用范围', () => {
    it('默认 scope：私聊/主动/群聊文字/电话开，群语音/场景/创作/结构化关', () => {
        expect(normalizePresetScopes(null)).toEqual(DEFAULT_PRESET_SCOPES);
        expect(DEFAULT_PRESET_SCOPES['chat.private']).toBe(true);
        expect(DEFAULT_PRESET_SCOPES['chat.proactive']).toBe(true);
        expect(DEFAULT_PRESET_SCOPES['chat.groupText']).toBe(true);
        expect(DEFAULT_PRESET_SCOPES['chat.phoneText']).toBe(true);
        expect(DEFAULT_PRESET_SCOPES['chat.groupVoice']).toBe(false);
        expect(DEFAULT_PRESET_SCOPES['structured.tool']).toBe(false);
    });

    it('最终生效 = 总开关 + 全局 scope + 当前预设 scope', () => {
        const preset = createDefaultPreset();
        preset.moroScopes = { ...DEFAULT_PRESET_SCOPES, 'chat.private': true };
        vi.spyOn(PresetRuntime, 'isEnabled').mockReturnValue(true);
        vi.spyOn(PresetRuntime, 'getGlobalScopes').mockReturnValue({ ...DEFAULT_PRESET_SCOPES, 'chat.private': false });
        expect(PresetRuntime.isScopeEnabled('chat.private', preset)).toBe(false);
        vi.mocked(PresetRuntime.getGlobalScopes).mockReturnValue({ ...DEFAULT_PRESET_SCOPES, 'chat.private': true });
        preset.moroScopes = { ...DEFAULT_PRESET_SCOPES, 'chat.private': false };
        expect(PresetRuntime.isScopeEnabled('chat.private', preset)).toBe(false);
        preset.moroScopes = { ...DEFAULT_PRESET_SCOPES, 'chat.private': true };
        expect(PresetRuntime.isScopeEnabled('chat.private', preset)).toBe(true);
    });

    it('scoped getActiveGenParams 尊重采样开关与 scope 取到的预设', async () => {
        const preset = createDefaultPreset();
        preset.temperature = 0.66;
        vi.spyOn(PresetRuntime, 'isSamplingApplied').mockReturnValue(true);
        vi.spyOn(PresetRuntime, 'getActivePresetForScope').mockResolvedValue(null);
        await expect(PresetRuntime.getActiveGenParams('structured.tool')).resolves.toBeNull();
        vi.mocked(PresetRuntime.getActivePresetForScope).mockResolvedValue(preset);
        await expect(PresetRuntime.getActiveGenParams('chat.private')).resolves.toMatchObject({ temperature: 0.66 });
        vi.mocked(PresetRuntime.isSamplingApplied).mockReturnValue(false);
        await expect(PresetRuntime.getActiveGenParams('chat.private')).resolves.toBeNull();
    });
});

describe('applyPresetToMessages · markerContents 联动（世界书 / 用户档案）', () => {
    it('worldInfo / personaDescription 有真实内容时在各自 order 位置注入', () => {
        const p = importTavernPreset({
            prompts: [
                { identifier: 'main', name: 'Main', role: 'system', content: 'M' },
                { identifier: 'worldInfoBefore', name: 'WIB', system_prompt: true, marker: true },
                { identifier: 'charDescription', name: 'CD', system_prompt: true, marker: true },
                { identifier: 'worldInfoAfter', name: 'WIA', system_prompt: true, marker: true },
                { identifier: 'personaDescription', name: 'PD', system_prompt: true, marker: true },
                { identifier: 'chatHistory', name: 'CH', system_prompt: true, marker: true },
            ],
            prompt_order: [{ character_id: 100000, order: [
                { identifier: 'main', enabled: true },
                { identifier: 'worldInfoBefore', enabled: true },
                { identifier: 'charDescription', enabled: true },
                { identifier: 'worldInfoAfter', enabled: true },
                { identifier: 'personaDescription', enabled: true },
                { identifier: 'chatHistory', enabled: true },
            ] }],
        }, 'n');
        const out = applyPresetToMessages(baseMessages, p, {
            macros: MACROS,
            markerContents: { worldInfoBefore: 'WB前', worldInfoAfter: 'WB后', personaDescription: '用户档案' },
        });
        expect(out.map(m => m.content)).toEqual(['M', 'WB前', 'CORE', 'WB后', '用户档案', 'u1', 'a1', 'u2', 'a2']);
    });

    it('marker 被关掉时内容被丢弃（ST 开关语义）', () => {
        const p = importTavernPreset({
            prompts: [
                { identifier: 'worldInfoBefore', name: 'WIB', system_prompt: true, marker: true },
                { identifier: 'charDescription', name: 'CD', system_prompt: true, marker: true },
                { identifier: 'chatHistory', name: 'CH', system_prompt: true, marker: true },
            ],
            prompt_order: [{ character_id: 100000, order: [
                { identifier: 'worldInfoBefore', enabled: false },
                { identifier: 'charDescription', enabled: true },
                { identifier: 'chatHistory', enabled: true },
            ] }],
        }, 'n');
        const out = applyPresetToMessages(baseMessages, p, {
            macros: MACROS,
            markerContents: { worldInfoBefore: 'WB前' },
        });
        expect(out.map(m => m.content)).toEqual(['CORE', 'u1', 'a1', 'u2', 'a2']);
    });

    it('marker 不在 order 里时内容回折进核心块（不丢设定）', () => {
        const p = importTavernPreset({
            prompts: [
                { identifier: 'charDescription', name: 'CD', system_prompt: true, marker: true },
                { identifier: 'chatHistory', name: 'CH', system_prompt: true, marker: true },
            ],
            prompt_order: [{ character_id: 100000, order: [
                { identifier: 'charDescription', enabled: true },
                { identifier: 'chatHistory', enabled: true },
            ] }],
        }, 'n');
        const out = applyPresetToMessages(baseMessages, p, {
            macros: MACROS,
            markerContents: { worldInfoBefore: 'WB前', personaDescription: '用户档案' },
        });
        expect(out[0].content).toBe('WB前\n\nCORE\n\n用户档案');
        expect(out.map(m => m.content).slice(1)).toEqual(['u1', 'a1', 'u2', 'a2']);
    });

    it('不传 markerContents 时维持旧行为（核心 marker 占位合并）', () => {
        const p = importTavernPreset(ST_PRESET_JSON, 'n');
        p.prompt_order[0].order = p.prompt_order[0].order.filter(e => e.identifier !== 'uuid-deep-1');
        const out = applyPresetToMessages(baseMessages, p, { macros: MACROS });
        expect(out.map(m => m.content)).toEqual([
            'Write 小明 reply to 阿罗.', 'CORE', 'u1', 'a1', 'u2', 'a2', 'PHI text',
        ]);
    });
});
