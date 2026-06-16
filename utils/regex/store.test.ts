import { describe, it, expect } from 'vitest';
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
});
