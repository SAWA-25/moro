export const CHAR_AVATAR_FROM_USER_IMAGE_EVENT = 'char-avatar-from-user-image';

export interface CharAvatarEventDetail {
    charId: string;
    reason?: string;
}

export function extractCharAvatarDirective(content: string): { useAvatar: boolean; reason?: string; content: string } {
    let useAvatar = false;
    let reason: string | undefined;
    const cleaned = (content || '').replace(
        /\[\[\s*(?:SET_CHAR_AVATAR_FROM_LAST_IMAGE|USE_LAST_USER_IMAGE_AS_CHAR_AVATAR)\s*(?:[：:]\s*([^\]]*?))?\s*\]\]/gi,
        (_match, rawReason) => {
            useAvatar = true;
            if (!reason && rawReason) reason = String(rawReason).trim();
            return '';
        },
    );
    return { useAvatar, reason, content: cleaned.trim() };
}
