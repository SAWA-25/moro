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
});
