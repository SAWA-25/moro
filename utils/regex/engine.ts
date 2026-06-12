/**
 * SillyTavern 正则脚本引擎移植（public/scripts/extensions/regex/engine.js）。
 *
 * 纯函数、零 React 依赖：脚本数组由调用方传入（全局脚本见 ./store.ts，
 * 角色局部脚本在 char.regexScripts）。语义与 ST 对齐：
 * - placement 决定脚本作用的文本类别（用户输入 / AI 输出 / 世界书 / 推理）
 * - markdownOnly 仅在渲染显示时生效；promptOnly 仅在组装提示词时生效；
 *   两者都不勾 = 直接改写消息原文（落库前）
 * - minDepth/maxDepth 按消息深度过滤（0 = 最后一条），仅在调用方传 depth 时启用
 * - findRegex 支持 "/pattern/flags" 与裸 pattern；{{user}}/{{char}} 宏按
 *   substituteRegex 设置替换（ESCAPED 时做正则转义）
 * - replaceString 支持 $1..$n、$<name> 捕获组与 {{match}}（= $0）宏，
 *   命中片段先去 trimStrings 再回填
 */

import { RegexScriptData } from '../../types';

/** 与 ST regex_placement 数值对齐（4 = 已废弃的 sendAs） */
export const regex_placement = {
    /** @deprecated ST 中已废弃 */
    MD_DISPLAY: 0,
    USER_INPUT: 1,
    AI_OUTPUT: 2,
    SLASH_COMMAND: 3,
    WORLD_INFO: 5,
    REASONING: 6,
} as const;

export const substitute_find_regex = {
    NONE: 0,
    RAW: 1,
    ESCAPED: 2,
} as const;

export const PLACEMENT_LABELS: Record<number, string> = {
    [regex_placement.USER_INPUT]: '用户输入',
    [regex_placement.AI_OUTPUT]: 'AI 输出',
    [regex_placement.SLASH_COMMAND]: '斜杠命令',
    [regex_placement.WORLD_INFO]: '世界书',
    [regex_placement.REASONING]: '推理内容',
};

/** 宏替换环境：Moro 没有 ST 的完整宏系统，这里支持最常用的 {{user}}/{{char}} */
export interface RegexEnvironment {
    userName?: string;
    charName?: string;
}

export interface RegexApplyParams extends RegexEnvironment {
    /** 渲染显示路径（命中 markdownOnly 脚本） */
    isMarkdown?: boolean;
    /** 提示词组装路径（命中 promptOnly 脚本） */
    isPrompt?: boolean;
    /** 编辑消息路径（跳过 runOnEdit=false 的脚本） */
    isEdit?: boolean;
    /** 消息深度（0 = 最后一条）。不传则跳过深度过滤 */
    depth?: number;
}

/**
 * "/pattern/flags" → RegExp；不是斜杠包裹格式则按裸 pattern 处理。
 * 与 ST utils.js regexFromString 行为一致（非法 flags 时整串当 pattern）。
 */
export function regexFromString(input: string): RegExp | undefined {
    try {
        const m = input.match(/(\/?)(.+)\1([a-z]*)/i);
        if (!m) return undefined;
        if (m[3] && !/^(?!.*?(.).*?\1)[gmixXsuUAJ]+$/.test(m[3])) {
            return new RegExp(input);
        }
        return new RegExp(m[2], m[3]);
    } catch {
        return undefined;
    }
}

/** 编译结果 LRU 缓存（同 ST RegexProvider，上限 1000） */
const regexCache = new Map<string, RegExp | null>();
const REGEX_CACHE_MAX = 1000;

function getCachedRegex(regexString: string): RegExp | null {
    if (regexCache.has(regexString)) {
        const cached = regexCache.get(regexString)!;
        regexCache.delete(regexString);
        regexCache.set(regexString, cached);
        if (cached && (cached.global || cached.sticky)) cached.lastIndex = 0;
        return cached;
    }
    const compiled = regexFromString(regexString) ?? null;
    if (regexCache.size >= REGEX_CACHE_MAX) {
        const firstKey = regexCache.keys().next().value;
        if (firstKey !== undefined) regexCache.delete(firstKey);
    }
    regexCache.set(regexString, compiled);
    return compiled;
}

/** ESCAPED 模式下宏值的正则转义（同 ST sanitizeRegexMacro） */
const sanitizeRegexMacro = (x: string): string =>
    x.replace(/[\n\r\t\v\f\0.^$*+?{}[\]\\/|()]/gs, s => {
        switch (s) {
            case '\n': return '\\n';
            case '\r': return '\\r';
            case '\t': return '\\t';
            case '\v': return '\\v';
            case '\f': return '\\f';
            case '\0': return '\\0';
            default: return '\\' + s;
        }
    });

const substituteMacros = (text: string, env: RegexEnvironment, sanitizer?: (v: string) => string): string => {
    const sub = (v: string) => (sanitizer ? sanitizer(v) : v);
    let out = text;
    if (env.userName) out = out.replace(/\{\{user\}\}/gi, sub(env.userName));
    if (env.charName) out = out.replace(/\{\{char\}\}/gi, sub(env.charName));
    return out;
};

/** 命中片段去 trimStrings（同 ST filterString） */
const filterString = (rawString: string, trimStrings: string[], env: RegexEnvironment): string => {
    let finalString = rawString;
    for (const trimString of trimStrings || []) {
        const subTrim = substituteMacros(trimString, env);
        finalString = finalString.split(subTrim).join('');
    }
    return finalString;
};

/**
 * 编译脚本的 findRegex（含 {{user}}/{{char}} 宏替换），失败返回 null。
 * 供「分泡保护」等需要只做匹配（不替换）的调用方复用，保证与执行时
 * 编译出的正则完全一致。
 */
export function getScriptFindRegex(regexScript: RegexScriptData, env: RegexEnvironment = {}): RegExp | null {
    if (!regexScript?.findRegex) return null;
    const src = (() => {
        switch (Number(regexScript.substituteRegex)) {
            case substitute_find_regex.RAW:
                return substituteMacros(regexScript.findRegex, env);
            case substitute_find_regex.ESCAPED:
                return substituteMacros(regexScript.findRegex, env, sanitizeRegexMacro);
            default:
                return regexScript.findRegex;
        }
    })();
    return getCachedRegex(src);
}

/** 对单条脚本执行替换（同 ST runRegexScript） */
export function runRegexScript(regexScript: RegexScriptData, rawString: string, env: RegexEnvironment = {}): string {
    let newString = rawString;
    if (!regexScript || regexScript.disabled || !regexScript.findRegex || !rawString) {
        return newString;
    }

    const getRegexString = (): string => {
        switch (Number(regexScript.substituteRegex)) {
            case substitute_find_regex.NONE:
                return regexScript.findRegex;
            case substitute_find_regex.RAW:
                return substituteMacros(regexScript.findRegex, env);
            case substitute_find_regex.ESCAPED:
                return substituteMacros(regexScript.findRegex, env, sanitizeRegexMacro);
            default:
                return regexScript.findRegex;
        }
    };
    const findRegex = getCachedRegex(getRegexString());
    if (!findRegex) return newString;

    newString = rawString.replace(findRegex, function (...args: any[]) {
        const replaceString = String(regexScript.replaceString ?? '').replace(/\{\{match\}\}/gi, '$0');
        const replaceWithGroups = replaceString.replace(/\$(\d+)|\$<([^>]+)>/g, (_, num, groupName) => {
            let match: any;
            if (num !== undefined) {
                match = args[Number(num)];
            } else if (groupName) {
                const groups = args[args.length - 1];
                match = groups && typeof groups === 'object' ? groups[groupName] : undefined;
            }
            if (!match) return '';
            return filterString(String(match), regexScript.trimStrings || [], env);
        });
        return substituteMacros(replaceWithGroups, env);
    });

    return newString;
}

/**
 * 对一段文本按 placement 跑全部脚本（同 ST getRegexedString）。
 * scripts 顺序即执行顺序（调用方负责全局在前、局部在后）。
 */
export function getRegexedString(
    rawString: string,
    placement: number,
    scripts: RegexScriptData[],
    { userName, charName, isMarkdown, isPrompt, isEdit, depth }: RegexApplyParams = {},
): string {
    if (typeof rawString !== 'string' || !rawString || placement === undefined) {
        return typeof rawString === 'string' ? rawString : '';
    }
    let finalString = rawString;
    const env: RegexEnvironment = { userName, charName };

    for (const script of scripts) {
        if (!script || script.disabled) continue;
        const applies =
            (script.markdownOnly && isMarkdown) ||
            (script.promptOnly && isPrompt) ||
            (!script.markdownOnly && !script.promptOnly && !isMarkdown && !isPrompt);
        if (!applies) continue;
        if (isEdit && !script.runOnEdit) continue;

        if (typeof depth === 'number') {
            const minDepth = script.minDepth;
            const maxDepth = script.maxDepth;
            if (typeof minDepth === 'number' && !isNaN(minDepth) && minDepth >= -1 && depth < minDepth) continue;
            if (typeof maxDepth === 'number' && !isNaN(maxDepth) && maxDepth >= 0 && depth > maxDepth) continue;
        }

        if (Array.isArray(script.placement) && script.placement.includes(placement)) {
            finalString = runRegexScript(script, finalString, env);
        }
    }
    return finalString;
}

const newScriptId = (): string =>
    (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
        ? crypto.randomUUID()
        : `regex-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

/** 空白脚本模板（新建用） */
export function createEmptyRegexScript(): RegexScriptData {
    return {
        id: newScriptId(),
        scriptName: '',
        findRegex: '',
        replaceString: '',
        trimStrings: [],
        placement: [regex_placement.AI_OUTPUT],
        disabled: false,
        markdownOnly: false,
        promptOnly: false,
        runOnEdit: false,
        substituteRegex: substitute_find_regex.NONE,
        minDepth: null,
        maxDepth: null,
    };
}

/**
 * 把任意来源（酒馆导出 JSON / 角色卡 extensions.regex_scripts / 本地备份）
 * 的脚本对象规范化为 RegexScriptData。不是脚本则返回 null。
 */
export function normalizeRegexScript(raw: any): RegexScriptData | null {
    if (!raw || typeof raw !== 'object') return null;
    const findRegex = typeof raw.findRegex === 'string' ? raw.findRegex : '';
    const scriptName = typeof raw.scriptName === 'string' ? raw.scriptName : '';
    if (!findRegex && !scriptName) return null;
    const num = (v: any): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const placement = Array.isArray(raw.placement)
        ? raw.placement.filter((p: any) => typeof p === 'number')
        : [regex_placement.AI_OUTPUT];
    return {
        id: typeof raw.id === 'string' && raw.id ? raw.id : newScriptId(),
        scriptName: scriptName || '未命名正则',
        findRegex,
        replaceString: typeof raw.replaceString === 'string' ? raw.replaceString : '',
        trimStrings: Array.isArray(raw.trimStrings) ? raw.trimStrings.filter((s: any) => typeof s === 'string') : [],
        placement: placement.length > 0 ? placement : [regex_placement.AI_OUTPUT],
        disabled: !!raw.disabled,
        markdownOnly: !!raw.markdownOnly,
        promptOnly: !!raw.promptOnly,
        runOnEdit: !!raw.runOnEdit,
        substituteRegex: typeof raw.substituteRegex === 'number' ? raw.substituteRegex
            : (raw.substituteRegex === true ? substitute_find_regex.RAW : substitute_find_regex.NONE),
        minDepth: num(raw.minDepth),
        maxDepth: num(raw.maxDepth),
    };
}
