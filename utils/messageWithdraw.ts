/**
 * 角色撤回自己上一条消息的指令通道（QQ/微信式「对方撤回了一条消息」）。
 *
 * 触发：角色在回复里自行输出 `[[WITHDRAW]]`（想收回刚说的话——口误、说漏嘴、后悔、
 * 害羞、改主意…）。applyAssistantPostProcessing 在渲染前剥离该指令并广播
 * CHAR_WITHDRAW_EVENT，Chat.tsx 监听后把该角色「最近一条未撤回的 assistant 消息」标记为
 * 已撤回（recalled + recalledContent）。原文仍存在 metadata 里，用户可点提示「偷看」。
 *
 * 注意：`[[RECALL: YYYY-MM]]` 是「调取记忆」的既有指令，与本撤回无关，切勿混用同一 token。
 */

export const WITHDRAW_RE = /\[\[\s*WITHDRAW\s*\]\]/gi;
export const CHAR_WITHDRAW_EVENT = 'moro-char-withdraw';

/** 从 AI 输出中剥离 [[WITHDRAW]] 指令并返回是否命中 */
export const extractWithdrawDirective = (content: string): { content: string; withdraw: boolean } => {
    if (!content) return { content, withdraw: false };
    WITHDRAW_RE.lastIndex = 0;
    const withdraw = WITHDRAW_RE.test(content);
    if (!withdraw) return { content, withdraw: false };
    return { content: content.replace(WITHDRAW_RE, '').trim(), withdraw: true };
};
