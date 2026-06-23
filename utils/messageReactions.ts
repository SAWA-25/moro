/**
 * 消息表情回应（QQ/微信 tap-to-react）。
 *
 * 数据落在 message.metadata.reactions：`{ emoji, by }[]`，by 里是回应者 id（'user' 或 charId）。
 * 用户长按消息从快捷条选表情回应，或点已有回应小药丸切换自己的回应；
 * 角色可在回复里输出 `[[REACT: 表情]]` 给用户最近一条消息贴表情。
 *
 * 这里只放纯函数 + 指令解析，方便 vitest 覆盖，不依赖 React / DB。
 */

export interface MessageReaction {
    emoji: string;
    by: string[]; // 'user' 或 charId
}

/** 快捷回应条的常用表情（参照 QQ/微信回应面板）。 */
export const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🎉', '👏'];

/**
 * 切换某人对某表情的回应（纯函数，返回新数组）：
 * - 该表情不存在 → 新增 `{ emoji, by: [reactorId] }`
 * - 存在且 reactorId 未回应 → 把 reactorId 加进去
 * - 存在且 reactorId 已回应 → 移除；移除后 by 为空则删掉整条
 * 始终保持表情的相对顺序稳定（新表情追加到末尾）。
 */
export function toggleReaction(
    reactions: MessageReaction[] | undefined,
    emoji: string,
    reactorId: string,
): MessageReaction[] {
    const list: MessageReaction[] = Array.isArray(reactions)
        ? reactions.map(r => ({ emoji: r.emoji, by: [...(r.by || [])] }))
        : [];
    const idx = list.findIndex(r => r.emoji === emoji);
    if (idx === -1) {
        list.push({ emoji, by: [reactorId] });
        return list;
    }
    const entry = list[idx];
    if (entry.by.includes(reactorId)) {
        entry.by = entry.by.filter(id => id !== reactorId);
        if (entry.by.length === 0) list.splice(idx, 1);
    } else {
        entry.by.push(reactorId);
    }
    return list;
}

export const CHAR_REACT_EVENT = 'moro-char-react';

// 角色给用户消息贴表情：[[REACT: 👍]]（表情可带可不带空格）。
const REACT_RE = /\[\[\s*REACT\s*[:：]\s*([^\]]+?)\s*\]\]/i;
const REACT_RE_G = /\[\[\s*REACT\s*[:：]\s*[^\]]+?\s*\]\]/gi;

/** 从 AI 输出里剥离 [[REACT: 表情]] 并返回表情（取第一个命中）。 */
export const extractReactDirective = (content: string): { content: string; emoji: string | null } => {
    if (!content) return { content, emoji: null };
    const m = content.match(REACT_RE);
    if (!m) return { content, emoji: null };
    const emoji = (m[1] || '').trim();
    const stripped = content.replace(REACT_RE_G, '').trim();
    return { content: stripped, emoji: emoji || null };
};
