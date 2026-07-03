import { describe, it, expect } from 'vitest';
import {
    regexFromString,
    runRegexScript,
    getRegexedString,
    normalizeRegexScript,
    createEmptyRegexScript,
    diagnoseRegexScriptRun,
    regex_placement,
    substitute_find_regex,
} from './engine';
import { RegexScriptData } from '../../types';

const makeScript = (patch: Partial<RegexScriptData>): RegexScriptData => ({
    ...createEmptyRegexScript(),
    scriptName: 'test',
    ...patch,
});

describe('regexFromString', () => {
    it('解析 /pattern/flags 形式', () => {
        const re = regexFromString('/foo/gi')!;
        expect(re.source).toBe('foo');
        expect(re.flags).toContain('g');
        expect(re.flags).toContain('i');
    });

    it('裸 pattern 按无 flags 处理', () => {
        const re = regexFromString('foo\\d+')!;
        expect('bar foo12'.match(re)?.[0]).toBe('foo12');
    });

    it('非法 flags 时整串当 pattern（同 ST 行为）', () => {
        expect(regexFromString('/a/zz')).toBeDefined();
    });
});

describe('runRegexScript', () => {
    it('基本替换 + $1 捕获组', () => {
        const script = makeScript({ findRegex: '/「(.+?)」/g', replaceString: '<$1>' });
        expect(runRegexScript(script, '他说「你好」和「再见」')).toBe('他说<你好>和<再见>');
    });

    it('{{match}} 宏等价 $0', () => {
        const script = makeScript({ findRegex: '/\\d+/g', replaceString: '[{{match}}]' });
        expect(runRegexScript(script, 'a1b22')).toBe('a[1]b[22]');
    });

    it('命名捕获组 $<name>', () => {
        const script = makeScript({ findRegex: '/(?<word>\\w+)!/g', replaceString: '$<word>?' });
        expect(runRegexScript(script, 'hello! world!')).toBe('hello? world?');
    });

    it('trimStrings 从命中片段里删除', () => {
        const script = makeScript({
            findRegex: '/^.*$/s',
            replaceString: '{{match}}',
            trimStrings: ['<thinking>', '</thinking>'],
        });
        expect(runRegexScript(script, '<thinking>想法</thinking>')).toBe('想法');
    });

    it('替换串里的 {{user}}/{{char}} 宏', () => {
        const script = makeScript({ findRegex: '/我/g', replaceString: '{{user}}' });
        expect(runRegexScript(script, '我来了', { userName: '小明' })).toBe('小明来了');
    });

    it('substituteRegex=ESCAPED 时查找串里的宏值被正则转义', () => {
        const script = makeScript({
            findRegex: '{{user}}',
            replaceString: 'X',
            substituteRegex: substitute_find_regex.ESCAPED,
        });
        expect(runRegexScript(script, 'a.b 说话', { userName: 'a.b' })).toBe('X 说话');
        // 未转义的 a.b 会把 axb 也吃掉；转义后不会
        expect(runRegexScript(script, 'axb 说话', { userName: 'a.b' })).toBe('axb 说话');
    });

    it('disabled 脚本不执行', () => {
        const script = makeScript({ findRegex: '/a/g', replaceString: 'b', disabled: true });
        expect(runRegexScript(script, 'aaa')).toBe('aaa');
    });

    it('replaceString 为空 = 删除命中内容', () => {
        const script = makeScript({ findRegex: '/<sys>[\\s\\S]*?<\\/sys>/g', replaceString: '' });
        expect(runRegexScript(script, 'x<sys>内部</sys>y')).toBe('xy');
    });
});

describe('getRegexedString', () => {
    const aiScript = makeScript({ findRegex: '/foo/g', replaceString: 'bar', placement: [regex_placement.AI_OUTPUT] });

    it('placement 匹配才执行', () => {
        expect(getRegexedString('foo', regex_placement.AI_OUTPUT, [aiScript])).toBe('bar');
        expect(getRegexedString('foo', regex_placement.USER_INPUT, [aiScript])).toBe('foo');
    });

    it('markdownOnly 只在 isMarkdown 时执行', () => {
        const s = makeScript({ ...aiScript, markdownOnly: true });
        expect(getRegexedString('foo', regex_placement.AI_OUTPUT, [s])).toBe('foo');
        expect(getRegexedString('foo', regex_placement.AI_OUTPUT, [s], { isMarkdown: true })).toBe('bar');
    });

    it('promptOnly 只在 isPrompt 时执行', () => {
        const s = makeScript({ ...aiScript, promptOnly: true });
        expect(getRegexedString('foo', regex_placement.AI_OUTPUT, [s])).toBe('foo');
        expect(getRegexedString('foo', regex_placement.AI_OUTPUT, [s], { isPrompt: true })).toBe('bar');
    });

    it('两个 only 都不勾的脚本在 isMarkdown/isPrompt 路径不执行（只改原文）', () => {
        expect(getRegexedString('foo', regex_placement.AI_OUTPUT, [aiScript], { isMarkdown: true })).toBe('foo');
        expect(getRegexedString('foo', regex_placement.AI_OUTPUT, [aiScript], { isPrompt: true })).toBe('foo');
    });

    it('minDepth/maxDepth 过滤（depth 0 = 最后一条）', () => {
        const s = makeScript({ ...aiScript, promptOnly: true, minDepth: 1, maxDepth: 3 });
        const run = (depth: number) => getRegexedString('foo', regex_placement.AI_OUTPUT, [s], { isPrompt: true, depth });
        expect(run(0)).toBe('foo');
        expect(run(1)).toBe('bar');
        expect(run(3)).toBe('bar');
        expect(run(4)).toBe('foo');
    });

    it('isEdit 时跳过 runOnEdit=false 的脚本', () => {
        expect(getRegexedString('foo', regex_placement.AI_OUTPUT, [aiScript], { isEdit: true })).toBe('foo');
        const s = makeScript({ ...aiScript, runOnEdit: true });
        expect(getRegexedString('foo', regex_placement.AI_OUTPUT, [s], { isEdit: true })).toBe('bar');
    });

    it('多脚本按数组顺序串联', () => {
        const s1 = makeScript({ findRegex: '/a/g', replaceString: 'b', placement: [regex_placement.AI_OUTPUT] });
        const s2 = makeScript({ findRegex: '/b/g', replaceString: 'c', placement: [regex_placement.AI_OUTPUT] });
        expect(getRegexedString('a', regex_placement.AI_OUTPUT, [s1, s2])).toBe('c');
    });
});

describe('diagnoseRegexScriptRun', () => {
    it('报告非法正则', () => {
        const s = makeScript({ findRegex: '/[未闭合/' });
        const result = diagnoseRegexScriptRun(s, '随便什么');
        expect(result.validRegex).toBe(false);
        expect(result.error).toContain('无法编译');
        expect(result.output).toBe('随便什么');
    });

    it('报告命中后输出为空', () => {
        const s = makeScript({ findRegex: '/删掉/g', replaceString: '', placement: [regex_placement.AI_OUTPUT] });
        const result = diagnoseRegexScriptRun(s, '请删掉', { placement: regex_placement.AI_OUTPUT });
        expect(result.matched).toBe(true);
        expect(result.changed).toBe(true);
        expect(result.outputEmpty).toBe(false);

        const all = makeScript({ findRegex: '/^[\\s\\S]*$/', replaceString: '', placement: [regex_placement.AI_OUTPUT] });
        expect(diagnoseRegexScriptRun(all, '整段删除', { placement: regex_placement.AI_OUTPUT }).outputEmpty).toBe(true);
    });

    it('报告运行模式过滤', () => {
        const s = makeScript({ findRegex: '/foo/g', replaceString: 'bar', promptOnly: true, placement: [regex_placement.AI_OUTPUT] });
        const raw = diagnoseRegexScriptRun(s, 'foo', { placement: regex_placement.AI_OUTPUT, mode: 'raw' });
        expect(raw.matched).toBe(true);
        expect(raw.changed).toBe(false);
        expect(raw.skippedByMode).toBe(true);

        const prompt = diagnoseRegexScriptRun(s, 'foo', { placement: regex_placement.AI_OUTPUT, mode: 'prompt' });
        expect(prompt.changed).toBe(true);
        expect(prompt.output).toBe('bar');
    });

    it('报告深度过滤', () => {
        const s = makeScript({ findRegex: '/foo/g', replaceString: 'bar', promptOnly: true, minDepth: 2, maxDepth: 3, placement: [regex_placement.AI_OUTPUT] });
        const skipped = diagnoseRegexScriptRun(s, 'foo', { placement: regex_placement.AI_OUTPUT, mode: 'prompt', depth: 0 });
        expect(skipped.matched).toBe(true);
        expect(skipped.changed).toBe(false);
        expect(skipped.skippedByDepth).toBe(true);

        const applied = diagnoseRegexScriptRun(s, 'foo', { placement: regex_placement.AI_OUTPUT, mode: 'prompt', depth: 2 });
        expect(applied.changed).toBe(true);
    });
});

describe('normalizeRegexScript（酒馆 JSON 导入）', () => {
    it('完整 ST 导出对象无损规范化', () => {
        const st = {
            id: 'uuid-1',
            scriptName: '去除星号动作',
            findRegex: '/\\*.*?\\*/g',
            replaceString: '',
            trimStrings: ['*'],
            placement: [1, 2],
            disabled: false,
            markdownOnly: true,
            promptOnly: false,
            runOnEdit: true,
            substituteRegex: 0,
            minDepth: -1,
            maxDepth: null,
        };
        const s = normalizeRegexScript(st)!;
        expect(s.id).toBe('uuid-1');
        expect(s.placement).toEqual([1, 2]);
        expect(s.markdownOnly).toBe(true);
        expect(s.minDepth).toBe(-1);
        expect(s.maxDepth).toBeNull();
    });

    it('老版 substituteRegex 布尔值兼容', () => {
        expect(normalizeRegexScript({ scriptName: 'x', findRegex: '/a/', substituteRegex: true })!.substituteRegex)
            .toBe(substitute_find_regex.RAW);
    });

    it('缺 id 自动补全；非脚本对象返回 null', () => {
        expect(normalizeRegexScript({ scriptName: 'x', findRegex: '/a/' })!.id).toBeTruthy();
        expect(normalizeRegexScript({ foo: 1 })).toBeNull();
        expect(normalizeRegexScript(null)).toBeNull();
    });
});
