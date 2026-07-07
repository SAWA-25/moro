import type { CharacterProfile, Message } from '../types';

export const CHAR_AVATAR_FROM_USER_IMAGE_EVENT = 'char-avatar-from-user-image';
export const CHAR_AVATAR_FROM_USER_IMAGE_APPLIED_EVENT = 'char-avatar-from-user-image-applied';
export const CHAR_AVATAR_NOTICE_DISMISSED_KEY = 'moro_char_avatar_notice_dismissed_v1';
export const CHAR_AVATAR_NOTICE_DISMISSED_LIMIT = 100;
export const CHAR_AVATAR_HISTORY_LIMIT = 20;

export type CharAvatarChangeSource = 'autonomous' | 'user_request';

export interface CharAvatarEventDetail {
    charId: string;
    reason?: string;
    source?: CharAvatarChangeSource;
    sourceMessageId?: number;
}

export interface CharAvatarAppliedEventDetail extends CharAvatarEventDetail {
    image: string;
    previousOverride?: string;
    at: number;
    systemMessageId?: number;
    noticeKey?: string;
}

export interface CharAvatarNoticeDraft extends CharAvatarAppliedEventDetail {
    noticeKey: string;
}

export interface CharAvatarApplyPatchResult {
    updates?: Partial<CharacterProfile>;
    applied: CharAvatarNoticeDraft;
    shouldWriteSystemMessage: boolean;
    systemMessageContent: string;
    systemMessageMetadata: {
        charAvatarChanged: true;
        sourceMessageId?: number;
        reason?: string;
        source: CharAvatarChangeSource;
    };
    duplicate: boolean;
}

export interface CharAvatarDirectiveResult {
    useAvatar: boolean;
    reason?: string;
    content: string;
}

export interface PendingUserAvatarRequest {
    imageMessageId: number;
    imageUrl: string;
    requestText: string;
}

const normalizeAvatarReason = (value?: string): string | undefined => {
    const text = (value || '').trim();
    return text || undefined;
};

export function makeCharAvatarNoticeKey(input: {
    charId?: string;
    at?: number;
    sourceMessageId?: number;
    source?: CharAvatarChangeSource;
}): string | null {
    if (!input.charId || typeof input.at !== 'number' || !Number.isFinite(input.at)) return null;
    if (typeof input.sourceMessageId !== 'number') return null;
    return `${input.charId}:${Math.trunc(input.at)}:${input.sourceMessageId}:${input.source || 'autonomous'}`;
}

export function parseDismissedCharAvatarNoticeKeys(raw: string | null | undefined): string[] {
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        const keys = parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
        return Array.from(new Set(keys)).slice(0, CHAR_AVATAR_NOTICE_DISMISSED_LIMIT);
    } catch {
        return [];
    }
}

export function isCharAvatarNoticeDismissed(keys: string[], noticeKey: string | null | undefined): boolean {
    return !!noticeKey && keys.includes(noticeKey);
}

export function markCharAvatarNoticeDismissed(keys: string[], noticeKey: string | null | undefined): string[] {
    if (!noticeKey) return keys.slice(0, CHAR_AVATAR_NOTICE_DISMISSED_LIMIT);
    return [noticeKey, ...keys.filter(key => key !== noticeKey)].slice(0, CHAR_AVATAR_NOTICE_DISMISSED_LIMIT);
}

export function buildCharAvatarNoticeFromCharacter(char: CharacterProfile): CharAvatarNoticeDraft | null {
    const cs = char.convoSettings;
    if (!cs?.charAvatarOverride || typeof cs.charAvatarUpdatedAt !== 'number') return null;
    if (typeof cs.charAvatarSourceMessageId !== 'number') return null;
    const source = cs.charAvatarChangeSource || 'autonomous';
    const noticeKey = makeCharAvatarNoticeKey({
        charId: char.id,
        at: cs.charAvatarUpdatedAt,
        sourceMessageId: cs.charAvatarSourceMessageId,
        source,
    });
    if (!noticeKey) return null;
    return {
        charId: char.id,
        image: cs.charAvatarOverride,
        reason: normalizeAvatarReason(cs.charAvatarChangeReason),
        source,
        sourceMessageId: cs.charAvatarSourceMessageId,
        previousOverride: cs.charAvatarPreviousOverride,
        at: cs.charAvatarUpdatedAt,
        noticeKey,
    };
}

const isImageUrlLike = (value: string): boolean =>
    /^data:image\//i.test(value || '') ||
    /^https?:\/\/.+\.(?:png|jpe?g|gif|webp|avif)(?:[?#].*)?$/i.test(value || '');

export const isUserImageAvatarCandidate = (m: Partial<Message> | undefined | null): m is Message =>
    !!m &&
    m.role === 'user' &&
    m.type === 'image' &&
    typeof m.content === 'string' &&
    !!m.content &&
    (!!m.metadata?.charAvatarCandidate || isImageUrlLike(m.content));

export function extractCharAvatarDirective(content: string): CharAvatarDirectiveResult {
    let useAvatar = false;
    let reason: string | undefined;
    const cleaned = (content || '').replace(
        /\[\[\s*(?:SET_CHAR_AVATAR_FROM_LAST_IMAGE|USE_LAST_USER_IMAGE_AS_CHAR_AVATAR)\s*(?:[：:]\s*([^\]]*?))?\s*\]\]/gi,
        (_match, rawReason) => {
            useAvatar = true;
            if (rawReason) reason = String(rawReason).trim().slice(0, 160);
            return '';
        },
    );
    return { useAvatar, reason, content: cleaned.trim() };
}

const normalizeText = (text: string): string =>
    (text || '')
        .replace(/\s+/g, '')
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .trim();

const AVATAR_REQUEST_RE =
    /(换|用|设|改|当|做|作为|变成|弄成|换成).{0,14}(头像|头图|头像照|头像照片|头像图)|(?:头像|头图).{0,14}(换|用|设|改|当|做|作为|变成|弄成|换成)|给你当头像|当你头像|做你头像|作为你头像|你换这(?:个|张)|换这(?:个|张)|用这(?:个|张)/;

export function findPendingUserAvatarRequest(messages: Message[]): PendingUserAvatarRequest | null {
    const block: Message[] = [];
    for (let i = messages.length - 1; i >= 0; i -= 1) {
        const m = messages[i];
        if (!m || m.role !== 'user') break;
        if (m.metadata?.hidden) continue;
        block.unshift(m);
    }
    if (block.length === 0) return null;

    const texts = block
        .filter(m => m.type === 'text' && typeof m.content === 'string')
        .map(m => m.content)
        .join('\n');
    if (!AVATAR_REQUEST_RE.test(normalizeText(texts))) return null;

    const image = [...block].reverse().find(isUserImageAvatarCandidate);
    if (!image || typeof image.id !== 'number') return null;
    return { imageMessageId: image.id, imageUrl: image.content, requestText: texts.trim() };
}

const AVATAR_ACCEPT_RE =
    /^(好|好啊|好呀|好吧|可以|可以啊|行|行啊|成|成啊|没问题|ok|okay|听你的|就这张|就用这张|用这张|我换上|换上了|我用这张|那我用这张|那就这张|给我吧|发来我就换|挺适合|很适合)|(?:我|那我|就|现在)?(?:换上|用这张|设成头像|当头像|换成这张)|听你的|就它了|就这张/iu;

const AVATAR_REJECT_RE =
    /(不换|不要|不行|不可以|不好|不太想|不想|不愿意|不合适|不喜欢|别闹|算了|算了吧|谁要|换不上|不要吧|不了|先不|暂时不|还想.{0,8}换上|让我换上[？?]|换上[？?]|可以吗[？?]|好不好[？?])/iu;

export function assistantAcceptsAvatarRequest(content: string): boolean {
    const normalized = normalizeText(extractCharAvatarDirective(content || '').content);
    if (!normalized) return false;
    if (AVATAR_REJECT_RE.test(normalized)) return false;
    return AVATAR_ACCEPT_RE.test(normalized);
}

export function selectCharAvatarCandidateMessage(messages: Message[], sourceMessageId?: number): Message | null {
    if (typeof sourceMessageId === 'number') {
        const exact = messages.find(m => m.id === sourceMessageId);
        if (isUserImageAvatarCandidate(exact)) return exact;
    }
    return [...messages].reverse().find(isUserImageAvatarCandidate) || null;
}

export function buildCharAvatarApplyPatch(input: {
    char: CharacterProfile;
    target: Message;
    detail?: Partial<CharAvatarEventDetail>;
    now?: number;
}): CharAvatarApplyPatchResult | null {
    const { char, target } = input;
    if (!isUserImageAvatarCandidate(target)) return null;
    const cs = char.convoSettings || {};
    const source = input.detail?.source || 'autonomous';
    const reason = normalizeAvatarReason(input.detail?.reason);
    const sourceMessageId = typeof target.id === 'number' ? target.id : input.detail?.sourceMessageId;
    const existingSource = cs.charAvatarChangeSource || 'autonomous';
    const duplicate =
        cs.charAvatarOverride === target.content &&
        cs.charAvatarSourceMessageId === sourceMessageId &&
        existingSource === source &&
        normalizeAvatarReason(cs.charAvatarChangeReason) === reason;
    const at = duplicate && typeof cs.charAvatarUpdatedAt === 'number'
        ? cs.charAvatarUpdatedAt
        : input.now || Date.now();
    const previousOverride = duplicate ? cs.charAvatarPreviousOverride : cs.charAvatarOverride;
    const noticeKey = makeCharAvatarNoticeKey({
        charId: char.id,
        at,
        sourceMessageId,
        source,
    });
    if (!noticeKey) return null;

    const systemMessageContent = source === 'user_request'
        ? `「${char.name || 'TA'}」同意把你发来的图片换成本会话头像${reason ? `：${reason}` : ''}`
        : `「${char.name || 'TA'}」把你刚发的图片设成了自己的头像${reason ? `：${reason}` : ''}`;
    const applied: CharAvatarNoticeDraft = {
        charId: char.id,
        image: target.content,
        reason,
        source,
        sourceMessageId,
        previousOverride,
        at,
        noticeKey,
    };

    if (duplicate) {
        return {
            applied,
            shouldWriteSystemMessage: false,
            systemMessageContent,
            systemMessageMetadata: { charAvatarChanged: true, sourceMessageId, reason, source },
            duplicate: true,
        };
    }

    const historyEntry = { sourceMessageId, reason, source, at };
    const oldHistory = cs.charAvatarHistory || [];
    const shouldAddHistory =
        oldHistory[0]?.sourceMessageId !== sourceMessageId ||
        normalizeAvatarReason(oldHistory[0]?.reason) !== reason ||
        oldHistory[0]?.source !== source;
    const nextHistory = (shouldAddHistory ? [historyEntry, ...oldHistory] : oldHistory)
        .slice(0, CHAR_AVATAR_HISTORY_LIMIT);

    return {
        updates: {
            convoSettings: {
                charAvatarOverride: target.content,
                charAvatarChangeReason: reason,
                charAvatarUpdatedAt: at,
                charAvatarChangeSource: source,
                charAvatarSourceMessageId: sourceMessageId,
                charAvatarPreviousOverride: previousOverride,
                charAvatarHistory: nextHistory,
            },
        },
        applied,
        shouldWriteSystemMessage: true,
        systemMessageContent,
        systemMessageMetadata: { charAvatarChanged: true, sourceMessageId, reason, source },
        duplicate: false,
    };
}
