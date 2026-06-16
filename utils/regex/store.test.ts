import { describe, it, expect, beforeEach } from 'vitest';
import {
    findDisplayRegexSpans, splitOutDisplayRegexSegments,
    collectRegexScripts, getPresetRegexScripts, setPresetRegexScripts, saveGlobalRegexScripts,
    applyRegexToText,
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
    it('collectRegexScripts 按 全局 → 预设 → 角色 顺序合并（对齐 ST getRegexScripts），内置剥离脚本追加在尾部', () => {
        saveGlobalRegexScripts([script({ id: 'g', scriptName: 'G' })]);
        setPresetRegexScripts([script({ id: 'p', scriptName: 'P' })]);
        const char = charWith([script({ id: 'c', scriptName: 'C' })]);
        // 用户脚本（global → preset → scoped）在前，内置剥离脚本兜底在后
        const ids = collectRegexScripts(char).map(s => s.id);
        expect(ids.filter(id => !id.startsWith('__builtin_strip_'))).toEqual(['g', 'p', 'c']);
        expect(ids.filter(id => id.startsWith('__builtin_strip_'))).toHaveLength(6);
        // 内置脚本紧跟在用户脚本之后（顺序：g, p, c, ...内置）
        expect(ids.slice(0, 3)).toEqual(['g', 'p', 'c']);
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

describe('内置显示层剥离脚本（防御预设作者把 <Human_inputs> 包裹配成改原文）', () => {
    // 这些用例不动 global / preset / scoped 用户脚本：纯靠 collectRegexScripts 末尾
    // 追加的 BUILTIN_DISPLAY_STRIPS 把渲染层包裹剥干净。每个 it 前先清空 global/preset，
    // 避免上一个 describe 的残留污染（jsdom localStorage 在同 file 跨 describe 共享）。
    beforeEach(() => {
        saveGlobalRegexScripts([]);
        setPresetRegexScripts(null);
    });

    const STRIP_PAIRS = [
        ['<Human_inputs>', '</Human_inputs>'],
        ['<user_input>', '</user_input>'],
        ['<User>', '</User>'],
        ['<Assistant_response>', '</Assistant_response>'],
        ['<assistant_output>', '</assistant_output>'],
        ['<Assistant>', '</Assistant>'],
    ] as const;

    it.each(STRIP_PAIRS)('isMarkdown=true 时剥掉 %s …%s 包裹（user 消息）', (open, close) => {
        const text = `${open}\n我想说\n${close}`;
        // user 消息走 USER_INPUT placement
        const out = applyRegexToText(text, regex_placement.USER_INPUT, { isMarkdown: true });
        expect(out).toBe('我想说');
    });

    it.each(STRIP_PAIRS)('isMarkdown=true 时剥掉 %s …%s 包裹（AI 消息）', (open, close) => {
        const text = `${open}你好\n世界${close}`;
        const out = applyRegexToText(text, regex_placement.AI_OUTPUT, { isMarkdown: true });
        expect(out).toBe('你好\n世界');
    });

    it('isMarkdown=false 不剥（落库前路径保持原文不动）', () => {
        const text = '<Human_inputs>我想说</Human_inputs>';
        const out = applyRegexToText(text, regex_placement.USER_INPUT);
        expect(out).toBe(text);
    });

    it('isPrompt=true 不剥（buildMessageHistory 给 LLM 的 prompt 保持原文）', () => {
        const text = '<Human_inputs>我想说</Human_inputs>';
        const out = applyRegexToText(text, regex_placement.USER_INPUT, { isPrompt: true });
        expect(out).toBe(text);
    });

    it('裸单 tag 不剥（只剥配对，不误伤用户真发的 XML 教学）', () => {
        const text = '我教你这个 tag：<Human_inputs>，效果如下';
        const out = applyRegexToText(text, regex_placement.USER_INPUT, { isMarkdown: true });
        expect(out).toBe(text);
    });

    it('一条消息里多对包裹都剥（混合标签）', () => {
        const text = '<Human_inputs>问</Human_inputs> 然后 <User>追问</User>';
        const out = applyRegexToText(text, regex_placement.USER_INPUT, { isMarkdown: true });
        expect(out).toBe('问 然后 追问');
    });

    it('用户的同名 markdownOnly 脚本先生效（替换包裹后内置剥离不会再误伤）', () => {
        // 用户给 <Human_inputs> 包裹自定义了「替换成 (我说：)」 —— 内置剥离不会再把 (我说：) 剥掉
        const char = charWith([script({
            id: 'user_owned',
            findRegex: '/<Human_inputs>([\\s\\S]*?)<\\/Human_inputs>/g',
            replaceString: '(我说：$1)',
            placement: [regex_placement.USER_INPUT],
            markdownOnly: true,
        })]);
        const out = applyRegexToText('<Human_inputs>我想说</Human_inputs>', regex_placement.USER_INPUT, {
            char, isMarkdown: true,
        });
        expect(out).toBe('(我说：我想说)');
    });

    it('分泡保护不把内置剥离命中区间当 rich-block（splitOutDisplayRegexSegments 跳过）', () => {
        // splitOutDisplayRegexSegments 应只考虑用户/全局/预设脚本的命中区间，
        // 不把内置剥离的「包裹标签」误判为 rich-block 防拆泡——否则拆泡会被搅乱。
        const segs = splitOutDisplayRegexSegments('<Assistant_response>你好</Assistant_response>');
        expect(segs).toEqual([{ kind: 'text', content: '<Assistant_response>你好</Assistant_response>' }]);
    });

    it('collectRegexScripts 末尾追加 6 条内置脚本（无用户脚本时）', () => {
        saveGlobalRegexScripts([]);
        setPresetRegexScripts(null);
        const list = collectRegexScripts(null);
        // 6 个内置剥离都在尾部，且都带 __builtin_strip_ 前缀
        const builtins = list.filter(s => s.id.startsWith('__builtin_strip_'));
        expect(builtins).toHaveLength(6);
        expect(builtins.every(s => s.markdownOnly === true)).toBe(true);
    });
});
