/**
 * 正则脚本存取与聊天管线挂载点。
 *
 * 存储分两层（同 ST 的 GLOBAL / SCOPED）：
 * - 全局脚本：localStorage `moro_global_regex_scripts`（补丁铺「满铺通用」标签管理）
 * - 角色局部脚本：char.regexScripts（随角色存 IndexedDB、随备份/角色卡走）
 *
 * 执行顺序：全局在前、局部在后（与 ST SCRIPT_TYPES 优先级一致）。
 *
 * 聊天管线四个挂载点（与 ST 语义对齐）：
 * 1. 用户发送（Chat.tsx handleSendText）— USER_INPUT，改写消息原文
 * 2. AI 输出落库前（applyAssistantPostProcessing Step 1.4）— AI_OUTPUT，改写消息原文
 * 3. 提示词组装（chatPrompts.buildMessageHistory）— promptOnly 脚本，带深度
 * 4. 气泡渲染（Chat.tsx displayMessages，传给 MessageItem 前替换 content）— markdownOnly 脚本
 */

import { CharacterProfile, RegexScriptData } from '../../types';
import { getRegexedString, getScriptFindRegex, normalizeRegexScript, regex_placement, substitute_find_regex, RegexApplyParams } from './engine';

const LS_KEY = 'moro_global_regex_scripts';

/** 全局脚本变更广播（补丁铺保存后发出，聊天页可监听刷新） */
export const REGEX_SCRIPTS_UPDATED_EVENT = 'moro-regex-scripts-updated';

let globalCache: RegexScriptData[] | null = null;

export const getGlobalRegexScripts = (): RegexScriptData[] => {
    if (globalCache) return globalCache;
    try {
        const raw = localStorage.getItem(LS_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        globalCache = Array.isArray(parsed)
            ? parsed.map(normalizeRegexScript).filter((s): s is RegexScriptData => !!s)
            : [];
    } catch {
        globalCache = [];
    }
    return globalCache;
};

export const saveGlobalRegexScripts = (scripts: RegexScriptData[]): void => {
    globalCache = scripts;
    try { localStorage.setItem(LS_KEY, JSON.stringify(scripts)); } catch { /* ignore quota */ }
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(REGEX_SCRIPTS_UPDATED_EVENT));
    }
};

// ── 预设自带正则（SillyTavern PRESET 作用域）─────────────────────────────────
//
// 预设 JSON 的 extensions.regex_scripts 导入时挂到 preset.regexScripts 上，只有该
// 预设被激活、且印坊开印时才生效。聊天管线四个挂载点都是同步的（collectRegexScripts
// 不能 await IndexedDB 里的激活预设），所以这里维持一份模块级缓存 —— 与 globalCache
// 同款手法。缓存由 presets.ts 的 refreshPresetRegexCache（App 启动）、
// chatRequestPayload（每次发送，复用已取到的激活预设）、活字盘（选预设 / 开关 /
// 改动正则时即时反映）三处刷新。
let presetCache: RegexScriptData[] = [];
let presetCacheSig = '';

/** 缓存内容指纹：只在「真正影响执行/显示」的字段变化时才广播刷新（见 setPresetRegexScripts） */
const presetCacheSignature = (scripts: RegexScriptData[]): string =>
    scripts.map(s => JSON.stringify([
        s.id, s.disabled ? 0 : 1, s.findRegex, s.replaceString,
        s.placement, s.markdownOnly, s.promptOnly, s.runOnEdit,
        s.trimStrings, s.substituteRegex, s.minDepth ?? null, s.maxDepth ?? null,
    ])).join('|');

/** 当前生效的「预设自带正则」（无激活预设 / 印坊歇业时为空数组） */
export const getPresetRegexScripts = (): RegexScriptData[] => presetCache;

/**
 * 设置当前生效的「预设自带正则」。传 null/空 = 没有激活预设或预设没带正则。
 * 仅在内容指纹变化时更新并广播 REGEX_SCRIPTS_UPDATED_EVENT —— chatRequestPayload
 * 每次发送都会调用本函数（传入新对象引用），靠指纹去重避免每条消息都触发气泡层重渲染。
 */
export const setPresetRegexScripts = (scripts: RegexScriptData[] | null | undefined): void => {
    const next = Array.isArray(scripts) ? scripts.filter((s): s is RegexScriptData => !!s) : [];
    const sig = presetCacheSignature(next);
    if (sig === presetCacheSig) return;
    presetCache = next;
    presetCacheSig = sig;
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(REGEX_SCRIPTS_UPDATED_EVENT));
    }
};

// ── 内置显示层剥离脚本（防御预设作者把「Human_inputs 包裹」配成改原文）─────────
//
// SillyTavern 社区里有一类预设脚本爱给用户消息加 `<Human_inputs>…</Human_inputs>`
// 之类的「提示词工程包裹」标签——本意是「只改寄出给 LLM 的提示词」（promptOnly=true）。
// 但常被作者错配成 placement=[USER_INPUT] + promptOnly=false + markdownOnly=false：
// ST 语义这叫「直接改原文」，于是包裹就落库了，历史气泡里全是 <Human_inputs>。
//
// 这里追加一组内置 markdownOnly 显示层脚本，对配对出现的包裹标签做透明剥离：
// 只动渲染、不动落库原文（开印停印都生效，没法关；想看见原文进编辑态即可）。
// 只剥「开 + 对应闭」的配对，不剥裸单 tag，避免误伤用户真的发了一段 XML 教学。
const stripPairScript = (id: string, openTag: string, closeTag: string): RegexScriptData => ({
    id: `__builtin_strip_${id}`,
    scriptName: `内置剥离 ${openTag}…${closeTag}`,
    // 注意 [\s\S] 跨行匹配 + 非贪婪 + 不捕获组：只把包裹本身剥掉，里头内容保留
    findRegex: `/${openTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*([\\s\\S]*?)\\s*${closeTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/g`,
    replaceString: '$1',
    trimStrings: [],
    placement: [regex_placement.USER_INPUT, regex_placement.AI_OUTPUT],
    disabled: false,
    markdownOnly: true,  // 只动气泡渲染，不动落库 / 不动发给 LLM 的 prompt
    promptOnly: false,
    runOnEdit: false,
    substituteRegex: substitute_find_regex.NONE,
    minDepth: null,
    maxDepth: null,
});

const BUILTIN_DISPLAY_STRIPS: RegexScriptData[] = [
    // 用户消息包裹
    stripPairScript('human_inputs', '<Human_inputs>', '</Human_inputs>'),
    stripPairScript('user_input', '<user_input>', '</user_input>'),
    stripPairScript('user_cap', '<User>', '</User>'),
    // AI 回复包裹
    stripPairScript('assistant_response', '<Assistant_response>', '</Assistant_response>'),
    stripPairScript('assistant_output', '<assistant_output>', '</assistant_output>'),
    stripPairScript('assistant_cap', '<Assistant>', '</Assistant>'),
];

/** 全局（在前）+ 预设自带（居中）+ 角色局部（在后）+ 内置剥离（兜底）合并，含禁用项
 *  （engine 内部跳过 disabled）。顺序与 ST getRegexScripts 一致：GLOBAL → PRESET → SCOPED；
 *  内置剥离脚本追加在尾部、只在显示层（markdownOnly）生效，详见上方 BUILTIN_DISPLAY_STRIPS。 */
export const collectRegexScripts = (char?: CharacterProfile | null): RegexScriptData[] => {
    const scoped = Array.isArray(char?.regexScripts) ? char!.regexScripts! : [];
    return [...getGlobalRegexScripts(), ...presetCache, ...scoped, ...BUILTIN_DISPLAY_STRIPS];
};

export interface ApplyRegexOptions extends Omit<RegexApplyParams, 'charName'> {
    char?: CharacterProfile | null;
}

/** 一站式入口：合并脚本 + 执行。任何异常都回退原文，绝不让正则把聊天搞挂。 */
export const applyRegexToText = (
    text: string,
    placement: number,
    { char, userName, ...params }: ApplyRegexOptions = {},
): string => {
    if (typeof text !== 'string' || !text) return text;
    try {
        const scripts = collectRegexScripts(char);
        if (scripts.length === 0) return text;
        const out = getRegexedString(text, placement, scripts, { userName, charName: char?.name, ...params });
        // Dev-only 调试钩子：浏览器控制台敲 `window.__moroDebugRegex = true` 后，每次
        // 正则入口都会 console.debug 一行命中摘要（placement / 脚本数 / 前后 30 字）。
        // 便于排查「脚本没生效」「包裹没剥干净」之类的疑似问题（详见 docs/dev-debug.md）。
        if (typeof window !== 'undefined' && (window as any).__moroDebugRegex && out !== text) {
            const preview = (s: string) => s.length > 30 ? s.slice(0, 30) + '…' : s;
            console.debug('[Regex]', { placement, scripts: scripts.length, in: preview(text), out: preview(out), isMarkdown: !!params.isMarkdown, isPrompt: !!params.isPrompt });
        }
        return out;
    } catch (e) {
        console.warn('[Regex] 执行失败，返回原文:', e);
        return text;
    }
};

// ── 显示层正则 × 富渲染联动 ─────────────────────────────────────────────────
//
// markdownOnly（仅格式显示）脚本在气泡渲染时才执行（挂载点 4）。但 AI 回复落库前
// 会被 chunkText 按换行拆成多条气泡 —— 如果脚本要匹配的片段（如 <status>…</status>
// 状态栏伪 XML）被拆散到不同气泡里，渲染层正则就永远匹配不上，美化脚本注入的
// HTML 也就渲染不出来。这里把「显示层脚本能匹配到的整段」找出来，交给
// applyAssistantPostProcessing 当作富块整块保护（不拆泡、不被 sanitize 误伤）。

/** 当前对 AI 输出生效的显示层（markdownOnly）脚本。
 *  排除内置剥离脚本：它们做的是「擦掉包裹标签」而不是「美化整段」，
 *  不该把命中区间当 rich-block 整块保护（否则反而阻碍正常拆泡）。 */
const collectDisplayScripts = (char?: CharacterProfile | null): RegexScriptData[] =>
    collectRegexScripts(char).filter(s =>
        s && !s.disabled && s.markdownOnly
        && !s.id.startsWith('__builtin_strip_')
        && Array.isArray(s.placement) && s.placement.includes(regex_placement.AI_OUTPUT));

/**
 * 找出文本里所有「显示层脚本命中的区间」（已合并重叠），返回 [start, end) 列表。
 * 任何异常都返回空数组 —— 保护逻辑失效时退回旧的分泡行为，不影响聊天。
 */
export const findDisplayRegexSpans = (
    text: string,
    char?: CharacterProfile | null,
    userName?: string,
): Array<[number, number]> => {
    if (typeof text !== 'string' || !text) return [];
    const spans: Array<[number, number]> = [];
    try {
        const env = { userName, charName: char?.name };
        for (const script of collectDisplayScripts(char)) {
            const re = getScriptFindRegex(script, env);
            if (!re) continue;
            const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
            let m: RegExpExecArray | null;
            let guard = 0;
            while ((m = g.exec(text)) !== null && guard++ < 500) {
                if (m[0]) spans.push([m.index, m.index + m[0].length]);
                if (m.index === g.lastIndex) g.lastIndex++;   // 空匹配防死循环
            }
        }
    } catch (e) {
        console.warn('[Regex] 显示层匹配区间计算失败:', e);
        return [];
    }
    if (spans.length === 0) return [];
    spans.sort((a, b) => a[0] - b[0]);
    const merged: Array<[number, number]> = [spans[0]];
    for (let i = 1; i < spans.length; i++) {
        const last = merged[merged.length - 1];
        if (spans[i][0] <= last[1]) last[1] = Math.max(last[1], spans[i][1]);
        else merged.push(spans[i]);
    }
    return merged;
};

/**
 * 把文本按显示层脚本命中区间切成 { kind: 'rich' | 'text' } 段（rich = 命中区间，
 * 必须整块保留成一条气泡）。无命中时返回单个 text 段。
 */
export const splitOutDisplayRegexSegments = (
    text: string,
    char?: CharacterProfile | null,
    userName?: string,
): Array<{ kind: 'rich' | 'text'; content: string }> => {
    const spans = findDisplayRegexSpans(text, char, userName);
    if (spans.length === 0) return [{ kind: 'text', content: text }];
    const out: Array<{ kind: 'rich' | 'text'; content: string }> = [];
    let pos = 0;
    for (const [start, end] of spans) {
        if (start > pos) out.push({ kind: 'text', content: text.slice(pos, start) });
        out.push({ kind: 'rich', content: text.slice(start, end) });
        pos = end;
    }
    if (pos < text.length) out.push({ kind: 'text', content: text.slice(pos) });
    return out;
};

// ── 导入 / 导出 ────────────────────────────────────────────────────────────

/** 解析酒馆正则 JSON（单条对象或数组），返回规范化脚本列表 */
export const parseRegexImportJson = (jsonText: string): RegexScriptData[] => {
    const data = JSON.parse(jsonText);
    const list = Array.isArray(data) ? data : [data];
    const scripts = list.map(normalizeRegexScript).filter((s): s is RegexScriptData => !!s);
    if (scripts.length === 0) throw new Error('文件里没有可识别的正则脚本');
    return scripts;
};

/** 导出为酒馆兼容 JSON（数组） */
export const exportRegexScriptsJson = (scripts: RegexScriptData[]): string =>
    JSON.stringify(scripts, null, 4);
