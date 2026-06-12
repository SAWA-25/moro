/**
 * 正则脚本存取与聊天管线挂载点。
 *
 * 存储分两层（同 ST 的 GLOBAL / SCOPED）：
 * - 全局脚本：localStorage `moro_global_regex_scripts`（正则 App「全局」标签管理）
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
import { getRegexedString, getScriptFindRegex, normalizeRegexScript, regex_placement, RegexApplyParams } from './engine';

const LS_KEY = 'moro_global_regex_scripts';

/** 全局脚本变更广播（正则 App 保存后发出，聊天页可监听刷新） */
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

/** 全局（在前）+ 角色局部（在后）合并，含禁用项（engine 内部跳过 disabled） */
export const collectRegexScripts = (char?: CharacterProfile | null): RegexScriptData[] => {
    const scoped = Array.isArray(char?.regexScripts) ? char!.regexScripts! : [];
    return [...getGlobalRegexScripts(), ...scoped];
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
        return getRegexedString(text, placement, scripts, { userName, charName: char?.name, ...params });
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

/** 当前对 AI 输出生效的显示层（markdownOnly）脚本 */
const collectDisplayScripts = (char?: CharacterProfile | null): RegexScriptData[] =>
    collectRegexScripts(char).filter(s =>
        s && !s.disabled && s.markdownOnly
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
