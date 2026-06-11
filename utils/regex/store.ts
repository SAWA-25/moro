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
import { getRegexedString, normalizeRegexScript, RegexApplyParams } from './engine';

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
