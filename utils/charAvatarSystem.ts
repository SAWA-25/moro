import type { Message } from '../types';

export const CHAR_AVATAR_FROM_USER_IMAGE_EVENT = 'char-avatar-from-user-image';

export type CharAvatarChangeSource = 'autonomous' | 'user_request';

export interface CharAvatarEventDetail {
    charId: string;
    reason?: string;
    source?: CharAvatarChangeSource;
    sourceMessageId?: number;
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
