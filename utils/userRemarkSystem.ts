// 角色主动给用户换备注（角色对用户的称呼）系统。
// 角色在 1v1 聊天里可输出 [[SET_USER_REMARK: 新备注|动机]] 主动改对用户的称呼；
// applyAssistantPostProcessing 剥离指令后广播事件，OSContext 落 convoSettings + 系统消息，
// Chat.tsx 监听弹「换备注」弹窗（点开可看动机）。动机可省略。

export const CHAR_USER_REMARK_EVENT = 'moro-char-user-remark';

export interface UserRemarkEventDetail {
    charId: string;
    remark: string;
    motivation?: string;
}

export interface UserRemarkDirectiveResult {
    /** 剥离指令后的正文 */
    content: string;
    /** 新备注（取最后一次出现，截断到 24 字） */
    remark?: string;
    /** 换备注的动机（竖线后的部分，可空，截断到 300 字） */
    motivation?: string;
}

const RE_GLOBAL = /\[\[SET_USER_REMARK\s*[:：]\s*[\s\S]*?\]\]/g;
const RE_CAPTURE = /\[\[SET_USER_REMARK\s*[:：]\s*([\s\S]*?)\]\]/g;

/**
 * 解析并剥离 [[SET_USER_REMARK: 新备注|动机]]。
 * 半角/全角冒号都吃；一条消息里出现多次只认最后一次（一轮反复改名没意义）。
 */
export function extractUserRemarkDirective(content: string): UserRemarkDirectiveResult {
    if (!content || !content.includes('SET_USER_REMARK')) return { content };
    let m: RegExpExecArray | null;
    let last: RegExpExecArray | null = null;
    RE_CAPTURE.lastIndex = 0;
    while ((m = RE_CAPTURE.exec(content)) !== null) last = m;
    const stripped = content.replace(RE_GLOBAL, '').trim();
    if (!last) return { content: stripped };
    const raw = (last[1] || '').trim();
    const [remarkPart, ...motivationParts] = raw.split('|');
    const remark = remarkPart.trim().slice(0, 24);
    const motivation = motivationParts.join('|').trim().slice(0, 300);
    if (!remark) return { content: stripped };
    return { content: stripped, remark, motivation: motivation || undefined };
}
