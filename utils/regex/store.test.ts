import { describe, it, expect, vi } from 'vitest';
import {
    findDisplayRegexSpans, splitOutDisplayRegexSegments,
    collectRegexScripts, getPresetRegexScripts, setPresetRegexScripts, saveGlobalRegexScripts,
} from './store';
import { regex_placement } from './engine';
import { CharacterProfile, RegexScriptData } from '../../types';

const script = (over: Partial<RegexScriptData>): RegexScriptData => ({
    id: over.id || 's1',
    scriptName: '测试脚本',
    findRegex: '',
    replaceString: '',
    trimStrings: [],
    placement: [regex_placement.AI_OUTPUT],
    disabled: false,
    markdownOnly: true,
    promptOnly: false,
    runOnEdit: false,
    substituteRegex: 0,
    minDepth: null,
    maxDepth: null,
    ...over,
});

const charWith = (scripts: RegexScriptData[]): CharacterProfile => ({
    id: 'c1',
    name: '角色A',
    avatar: '',
    description: '',
    systemPrompt: '',
    memories: [],
    regexScripts: scripts,
} as any);

describe('显示层正则命中区间（分泡保护用）', () => {
    it('markdownOnly + AI_OUTPUT 脚本的命中区间整块保护', () => {
        const char = charWith([script({ findRegex: '/<status>[\\s\\S]*?<\\/status>/g' })]);
        const text = '前文\n<status>HP: 10\nMP: 5</status>\n后文';
        const segs = splitOutDisplayRegexSegments(text, char);
        expect(segs.map(s => s.kind)).toEqual(['text', 'rich', 'text']);
        expect(segs[1].content).toBe('<status>HP: 10\nMP: 5</status>');
    });

    it('禁用脚本 / 非显示层脚本不参与保护', () => {
        const char = charWith([
            script({ id: 'off', findRegex: '/<a>.*?<\\/a>/', disabled: true }),
            script({ id: 'raw', findRegex: '/<b>.*?<\\/b>/', markdownOnly: false }),
        ]);
        expect(findDisplayRegexSpans('<a>x</a> <b>y</b>', char)).toEqual([]);
    });

    it('重叠区间合并；无命中返回单个 text 段', () => {
        const char = charWith([
            script({ id: '1', findRegex: '/aaab/' }),
            script({ id: '2', findRegex: '/abbb/' }),
        ]);
        expect(findDisplayRegexSpans('aaabbb', char)).toEqual([[0, 6]]);
        expect(splitOutDisplayRegexSegments('没有命中', char)).toEqual([{ kind: 'text', content: '没有命中' }]);
    });

    it('非法正则 / 空文本不抛错', () => {
        const char = charWith([script({ findRegex: '/[未闭合/' })]);
        expect(findDisplayRegexSpans('随便什么', char)).toEqual([]);
        expect(findDisplayRegexSpans('', char)).toEqual([]);
    });
});

describe('预设自带正则缓存（ST PRESET 作用域）', () => {
    it('collectRegexScripts 按 全局 → 预设 → 角色 顺序合并（对齐 ST getRegexScripts）', () => {
        saveGlobalRegexScripts([script({ id: 'g', scriptName: 'G' })]);
        setPresetRegexScripts([script({ id: 'p', scriptName: 'P' })]);
        const char = charWith([script({ id: 'c', scriptName: 'C' })]);
        expect(collectRegexScripts(char).map(s => s.id)).toEqual(['g', 'p', 'c']);
        // 清理，避免污染其它用例
        setPresetRegexScripts(null);
        saveGlobalRegexScripts([]);
    });

    it('setPresetRegexScripts(null) 清空缓存', () => {
        setPresetRegexScripts([script({ id: 'x' })]);
        expect(getPresetRegexScripts()).toHaveLength(1);
        setPresetRegexScripts(null);
        expect(getPresetRegexScripts()).toEqual([]);
    });

    it('只改 placement / 只改显示·只改寄出 等字段也会刷新缓存（活字盘里编辑预设正则即时生效）', () => {
        // 修复「编辑了预设正则却不生效」：旧指纹只看 id/disabled/find/replace，改 placement、
        // markdownOnly、trimStrings、深度等不会触发刷新 → 缓存早退、编辑白改。现在指纹覆盖
        // 全部影响执行/显示的字段，下面用「缓存内容确实变了」证明刷新已发生。
        const base = script({ id: 'p1', findRegex: '/x/', replaceString: 'y', placement: [regex_placement.AI_OUTPUT], markdownOnly: false });
        setPresetRegexScripts([base]);
        expect(getPresetRegexScripts()[0].placement).toEqual([regex_placement.AI_OUTPUT]);

        // 只改 placement（find/replace/disabled 都没动）—— 旧实现会因指纹相同而早退不更新
        setPresetRegexScripts([{ ...base, placement: [regex_placement.USER_INPUT] }]);
        expect(getPresetRegexScripts()[0].placement).toEqual([regex_placement.USER_INPUT]);

        // 只切 markdownOnly 也要反映到缓存
        setPresetRegexScripts([{ ...base, placement: [regex_placement.USER_INPUT], markdownOnly: true }]);
        expect(getPresetRegexScripts()[0].markdownOnly).toBe(true);

        // 只改 trimStrings 同样要刷新
        setPresetRegexScripts([{ ...base, placement: [regex_placement.USER_INPUT], markdownOnly: true, trimStrings: ['剪掉'] }]);
        expect(getPresetRegexScripts()[0].trimStrings).toEqual(['剪掉']);

        setPresetRegexScripts(null);
    });

    it('预设正则落 localStorage：刷新页面（模块重载）后首帧同步可用，不靠异步预热', async () => {
        // 修复「预设正则在聊天界面不生效」的根因：原本预设正则只活在内存里，靠异步
        // refreshPresetRegexCache 填充，刷新页面后第一帧 presetCache 为空 → 显示层
        // markdownOnly 脚本命不中，伪 XML（如 <Human_inputs>）露在气泡里。现在与全局脚本
        // 同款持久化到 localStorage，模块重载后懒预热即可同步拿到，无需等 IndexedDB。
        const persisted = script({
            id: 'persist', scriptName: '隐藏 Human_inputs 包裹',
            findRegex: '/<Human_inputs>\\s*([\\s\\S]*?)\\s*<\\/Human_inputs>/g', replaceString: '$1',
            placement: [regex_placement.USER_INPUT], markdownOnly: true,
        });
        setPresetRegexScripts([persisted]);
        expect(localStorage.getItem('moro_preset_regex_scripts')).toBeTruthy();

        // 模拟刷新：重置模块，让 presetCache 回到「未预热」状态，再 import 一份全新的 store。
        vi.resetModules();
        const fresh = await import('./store');
        // 没有任何异步填充，直接读 —— 应当从 localStorage 同步预热出刚才那条脚本。
        expect(fresh.getPresetRegexScripts().map(s => s.id)).toEqual(['persist']);
        expect(fresh.collectRegexScripts(null).map(s => s.id)).toEqual(['persist']);

        // 端到端：模拟气泡渲染（挂载点 4）首帧那次调用 —— 伪 XML 标签应当当场被剥掉，
        // 而不是等异步预热后才消失（正是截图里 <Human_inputs> 露出来的那个 bug）。
        const stripped = fresh.applyRegexToText(
            '<Human_inputs>\n我想说\n</Human_inputs>',
            regex_placement.USER_INPUT,
            { isMarkdown: true },
        );
        expect(stripped).toBe('我想说');

        // 清空（同时抹掉 LS），避免污染其它用例
        fresh.setPresetRegexScripts(null);
        setPresetRegexScripts(null);
        expect(localStorage.getItem('moro_preset_regex_scripts')).toBeNull();
    });
});
