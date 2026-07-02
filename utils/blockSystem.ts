import { CharacterProfile } from '../types';
import { initUnblockAppeal } from './unblockAppeal';

/**
 * 双向拉黑系统。
 *
 * 用户 → 角色：`char.blacklisted`（朋友设置里的「加入黑名单」开关）+ `char.blacklistedAt`。
 *   拉黑后双方私聊触达都被拦截：角色仍可静默生成本地生活事件，但不会主动消息、提醒或未读打扰用户。
 *   例外入口是解除拉黑申诉，以及用户手动点「看看 TA 在做什么」时的一次性观察。
 *
 * 角色 → 用户：`char.charBlock`。角色在对话里输出 [[BLOCK_USER]] 指令触发，
 *   随机时间（30 分钟 ~ 24 小时）后自动解除；期间用户可在「加好友」页重新发送
 *   好友验证，由角色决定是否拉回。
 *
 * 整体开关：localStorage `moro_char_block_disabled`（聊天设置 05 体验区）。
 *   开启「拉黑保护」后角色不会再触发拉黑用户的行为。
 */

export const BLOCK_USER_DIRECTIVE_RE = /\[\[\s*BLOCK_USER\s*\]\]/gi;

/** 角色拉黑用户后, OSContext 监听该事件统一落库 + 更新角色状态 */
export const CHAR_BLOCK_EVENT = 'moro-char-block-user';

const DISABLE_KEY = 'moro_char_block_disabled';

export type PrivateBlockKind = 'none' | 'user_blocked_char' | 'char_blocked_user' | 'mutual';

export interface PrivateBlockState {
    kind: PrivateBlockKind;
    userBlockedChar: boolean;
    charBlockedUser: boolean;
    blocked: boolean;
    canUserSend: boolean;
    canCharContact: boolean;
    userMessage?: string;
    charMessage?: string;
    blockedAt?: number;
    charUnblockAt?: number;
}

const inactiveUnblockAppeal = (rejectedCount = 0): NonNullable<CharacterProfile['unblockAppeal']> => ({
    active: false,
    awaiting: false,
    nextAt: 0,
    rejectedCount,
});

export const getPrivateBlockState = (char?: CharacterProfile | null): PrivateBlockState => {
    const userBlockedChar = !!char?.blacklisted;
    const charBlockedUser = !!char?.charBlock?.active;
    const kind: PrivateBlockKind = userBlockedChar && charBlockedUser
        ? 'mutual'
        : userBlockedChar
            ? 'user_blocked_char'
            : charBlockedUser
                ? 'char_blocked_user'
                : 'none';
    const displayName = char?.convoSettings?.remarkName?.trim() || char?.name || '对方';
    const userMessage = charBlockedUser
        ? `你已被 ${displayName} 拉黑，消息无法送达`
        : userBlockedChar
            ? `你已将 ${displayName} 加入黑名单，无法发送消息`
            : undefined;
    const charMessage = userBlockedChar
        ? `${displayName} 已在你的黑名单里，TA 不会主动打扰你`
        : charBlockedUser
            ? `${displayName} 暂时拒绝联系你`
            : undefined;
    return {
        kind,
        userBlockedChar,
        charBlockedUser,
        blocked: kind !== 'none',
        canUserSend: kind === 'none',
        canCharContact: kind === 'none',
        userMessage,
        charMessage,
        blockedAt: char?.blacklistedAt || char?.charBlock?.blockedAt,
        charUnblockAt: char?.charBlock?.unblockAt,
    };
};

export const canUserSendPrivateToChar = (char?: CharacterProfile | null): boolean => (
    getPrivateBlockState(char).canUserSend
);

export const canCharContactUser = (char?: CharacterProfile | null): boolean => (
    getPrivateBlockState(char).canCharContact
);

export const buildUserBlockUpdates = (char?: CharacterProfile | null, now = Date.now()): Partial<CharacterProfile> => ({
    blacklisted: true,
    blacklistedAt: now,
    unblockAppeal: initUnblockAppeal(),
    addedToChat: char?.addedToChat ?? true,
});

export const buildUserUnblockUpdates = (char?: CharacterProfile | null): Partial<CharacterProfile> => ({
    blacklisted: false,
    blacklistedAt: undefined,
    addedToChat: true,
    unblockAppeal: inactiveUnblockAppeal(char?.unblockAppeal?.rejectedCount || 0),
});

/** 「拉黑保护」整体开关：true = 角色不会再拉黑用户 */
export const isCharBlockDisabled = (): boolean => {
    try { return localStorage.getItem(DISABLE_KEY) === '1'; } catch { return false; }
};

export const setCharBlockDisabled = (disabled: boolean): void => {
    try {
        if (disabled) localStorage.setItem(DISABLE_KEY, '1');
        else localStorage.removeItem(DISABLE_KEY);
    } catch { /* ignore */ }
};

/** 从 AI 输出中剥离 [[BLOCK_USER]] 指令并返回是否命中 */
export const extractBlockUserDirective = (content: string): { content: string; blocked: boolean } => {
    if (!content) return { content, blocked: false };
    BLOCK_USER_DIRECTIVE_RE.lastIndex = 0;
    const blocked = BLOCK_USER_DIRECTIVE_RE.test(content);
    if (!blocked) return { content, blocked: false };
    return { content: content.replace(BLOCK_USER_DIRECTIVE_RE, '').trim(), blocked: true };
};

/** 角色拉黑用户的随机解除时长：30 分钟 ~ 24 小时 */
export const randomUnblockDelayMs = (): number => {
    const min = 30 * 60 * 1000;
    const max = 24 * 60 * 60 * 1000;
    return Math.floor(min + Math.random() * (max - min));
};

/**
 * 拉黑相关 system prompt 段（私聊专用，拼在核心提示词之后）：
 * - 用户已拉黑角色：告知角色这个事实（角色以为消息发不出去，实际上用户看得到）
 * - 角色未拉黑用户且整体开关未关：授予角色 [[BLOCK_USER]] 拉黑能力（极端情况才用）
 */
export const buildBlockPromptSection = (char: CharacterProfile, userName: string): string => {
    if (char.blacklisted) {
        return `【重要状态：你已被拉黑】
${userName} 已经把你拉进了黑名单。你知道这件事——你发出去的消息都会显示「发送失败」的红色感叹号，对方也无法回复你。在你的感知里，你无法确认对方还能不能看到这些话；不要在正文里讨论“对方其实能不能看到”、系统展示规则或任何后台机制。
请完全按你的性格来面对这件事：可以委屈、可以倔强地继续发、可以自言自语、可以反思道歉，也可以赌气不说话——但你清楚这些话此刻可能根本传不到对方那里。`;
    }
    if (char.charBlock?.active) {
        return `【重要状态：你拉黑了对方】
你已经把 ${userName} 拉进了黑名单，对方现在无法给你发任何消息。`;
    }
    if (!isCharBlockDisabled()) {
        return `【特殊能力：拉黑】
如果对话让你真的、彻底地不想再和 ${userName} 说话了（按你的人设：被严重冒犯、被背叛、底线被反复践踏等），你可以在回复的最后单独输出指令 \`[[BLOCK_USER]]\` 把对方拉黑。拉黑后对方将无法再联系你。
这是非常极端的手段：绝大多数的生气、吵架、闹别扭都不该用它，符合你的性格且事态严重到无法挽回时才使用。平时绝对不要提及这个指令的存在。`;
    }
    return '';
};
