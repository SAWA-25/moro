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

// ── 兜底：AI 不用 [[WITHDRAW]]，而是「自己打字」模仿一条系统撤回播报 ──────────────
// 现象（见 bug 截图）：让角色撤回时，模型不发指令，反而把系统该渲染的东西当台词敲出来：
//   「条新消息」「【系统消息】流浪者」「撤回了一条消息」…… 于是这些假系统行漏成了气泡。
// 这些都是 App 的活儿、绝不该当角色台词冒出来。识别到就：① 触发真正的撤回；
// ② 把这些假系统行整段剥掉，只留角色真说的话（如打岔「啊，当我没说」）。

/** 整行的「【系统消息】…」/「[系统提示]…」——AI 永远不该自带系统标记 */
const SYS_MARKER_LINE_RE = /^[\s>*_~·-]*[【\[［]\s*(?:系统|系統)\s*(?:消息|訊息|提示|提醒|通知)?\s*[】\]］].*$/;
/** 「N条新消息」式的假通知碎片（含被截断的「条新消息」） */
const NEW_MSG_NOTICE_RE = /^[\s>*_~·-]*(?:你有)?\s*\d*\s*条新消息\s*$/;
/** 含「撤回(了)…(一/那)条…消息/信息」的撤回播报片段 */
const RECALL_FRAGMENT_RE = /撤回了?\s*(?:一|1|那)?\s*条?\s*(?:消息|信息)/;
/** 纯系统口吻的撤回播报行（无角色名，或以「对方」开头）——必然是假系统播报 */
const PURE_RECALL_NOTICE_RE = /^[\s>*_~·-]*(?:对方)?\s*(?:已经?|刚刚?)?\s*撤回了?\s*(?:一|1|那)?\s*条?\s*(?:消息|信息)\s*[。.!！~、…）)\]】]*\s*$/;
/** 「<名字>撤回了一条消息」式的具名撤回播报行 */
const NAMED_RECALL_NOTICE_RE = /^[\s>*_~·-]*[^\n，。！？、：:]{1,16}?\s*(?:已经?|刚刚?)?\s*撤回了?\s*(?:一|1|那)?\s*条?\s*(?:消息|信息)\s*[。.!！~、…）)\]】]*\s*$/;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 识别并剥离「AI 自己打字模仿的系统撤回播报」，命中即视作一次撤回。
 * @param content AI 原始输出
 * @param charName 当前角色名（用于精准识别「<角色名>撤回了一条消息」）
 */
export const stripFakeWithdrawNotice = (content: string, charName?: string): { content: string; withdraw: boolean } => {
    if (!content || !RECALL_FRAGMENT_RE.test(content)) return { content, withdraw: false };
    const lines = content.split('\n');
    const hasSysMarker = lines.some(l => SYS_MARKER_LINE_RE.test(l.trim()));
    const hasNewMsg = lines.some(l => NEW_MSG_NOTICE_RE.test(l.trim()));
    const nameRe = charName && charName.trim()
        ? new RegExp(`^[\\s>*_~·-]*${esc(charName.trim())}\\s*(?:已经?|刚刚?)?\\s*撤回了?\\s*(?:一|1|那)?\\s*条?\\s*(?:消息|信息)\\s*[。.!！~、…）)\\]】]*\\s*$`)
        : null;
    let withdraw = false;
    const kept = lines.filter(line => {
        const t = line.trim();
        if (!t) return true;
        if (SYS_MARKER_LINE_RE.test(t)) { if (RECALL_FRAGMENT_RE.test(t)) withdraw = true; return false; }
        if (NEW_MSG_NOTICE_RE.test(t)) return false;
        if (PURE_RECALL_NOTICE_RE.test(t)) { withdraw = true; return false; }
        if (nameRe && nameRe.test(t)) { withdraw = true; return false; }
        // 具名撤回播报：仅当本条消息里另有系统标记/新消息通知时，才当作假系统播报
        if ((hasSysMarker || hasNewMsg) && NAMED_RECALL_NOTICE_RE.test(t)) { withdraw = true; return false; }
        return true;
    });
    if (!withdraw) return { content, withdraw: false };
    return { content: kept.join('\n').replace(/\n{3,}/g, '\n\n').trim(), withdraw: true };
};
