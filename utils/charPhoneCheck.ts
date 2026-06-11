/**
 * 角色主动查用户手机的指令通道。
 *
 * 触发路径有两条：
 * 1. 概率触发：会话设置「允许 char 看手机」开启时，AI 回复落定后小概率发起（Chat.tsx 内联逻辑）。
 * 2. 指令触发：用户通过「系统命令」（如"对用户发起查手机"）下达后，角色在回复里输出
 *    `[[CHECK_PHONE]]` 指令；applyAssistantPostProcessing 在渲染前剥离该指令并广播
 *    CHAR_PHONE_CHECK_EVENT，Chat.tsx 监听后弹出 CharPhoneCheckOverlay。
 *    用户不在该角色聊天页时用 pending 标记兜底，下次进入聊天时再弹。
 */

export const CHECK_PHONE_RE = /\[\[\s*CHECK_PHONE\s*\]\]/gi;
export const CHAR_PHONE_CHECK_EVENT = 'moro-char-phone-check';

const pendingKey = (charId: string) => `moro_char_phone_check_pending_${charId}`;

/** 从 AI 输出中剥离 [[CHECK_PHONE]] 指令并返回是否命中 */
export const extractCheckPhoneDirective = (content: string): { content: string; checkPhone: boolean } => {
    if (!content) return { content, checkPhone: false };
    CHECK_PHONE_RE.lastIndex = 0;
    const checkPhone = CHECK_PHONE_RE.test(content);
    if (!checkPhone) return { content, checkPhone: false };
    return { content: content.replace(CHECK_PHONE_RE, '').trim(), checkPhone: true };
};

/** 用户不在该角色聊天页时标记 pending，进聊天时兜底弹窗 */
export const setPhoneCheckPending = (charId: string): void => {
    try { localStorage.setItem(pendingKey(charId), '1'); } catch { /* ignore */ }
};
export const consumePhoneCheckPending = (charId: string): boolean => {
    try {
        const hit = localStorage.getItem(pendingKey(charId)) === '1';
        if (hit) localStorage.removeItem(pendingKey(charId));
        return hit;
    } catch { return false; }
};
