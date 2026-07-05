/**
 * llmComplete —— 折子戏/副 API 的统一「聊天补全」入口（OpenAI 兼容）。
 * ============================================================================
 * 解决两类截断：
 *  1) 思维链吃 token：推理模型先在 <think> 里消耗一大截预算，正文解读/番外被 max_tokens 砍半句；
 *  2) 长篇番外：用户的「番外指令」常要求「不少于 5000/10000 字」，单次回复装不下。
 *
 * 做法：调一次 chat/completions；若服务端回 finish_reason='length'（被长度截断）且已有可见正文，
 * 就把已写内容回灌、追加一句「接着写」，最多续 continueRounds 轮，拼成完整结果。
 *  · continueRounds 默认 0 = 不续写（短问答 / 结构化 JSON 场景用）。
 *  · 返回值已去掉 <think> 思维链（含被截断的残缺 think）。
 *
 * interpret.ts（解牌）、theaterExtra.ts（番外）都从这里取，别再各自内联 fetch+stripThink。
 */

import type { ResolvedApi } from './auxApi';
import type { ApiCallMeta } from './apiCallLog';
import type { PresetScopeKey } from '../types';
import type { PresetGenParams, PresetMacroCtx } from './presets';
import { completeText, stripThink, type ChatMsg } from './llmClient';

export type { ChatMsg } from './llmClient';

export interface CompleteOptions extends PresetGenParams {
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
    /** 回复因长度被截断（finish_reason='length'）时自动「接着写」的最大续写轮数。默认 0（不续写）。 */
    continueRounds?: number;
    /** true = 调用方传入的 max_tokens / maxTokens 不被预设采样参数覆盖。 */
    preserveMaxTokens?: boolean;
    /** API 后台流水标注。 */
    meta?: ApiCallMeta;
    /** 可选：按活字盘作用范围套预设；默认不套，保护 JSON/工具任务。 */
    presetScope?: PresetScopeKey | false;
    /** 可选：给活字盘里的 {{char}} / {{user}} 等宏提供真实上下文。 */
    presetMacros?: PresetMacroCtx;
}

export { stripThink };

/**
 * 聊天补全；按需自动续写（finish_reason='length' 时）。返回拼好的完整正文（已去思维链）。
 */
export async function llmComplete(api: ResolvedApi, messages: ChatMsg[], opts: CompleteOptions = {}): Promise<string> {
    return completeText(api, messages, opts);
}
