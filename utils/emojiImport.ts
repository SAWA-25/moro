import { Emoji } from '../types';

export interface ParsedEmojiImport {
    name: string;
    url: string;
    categoryId?: string;
    description?: string;
}

export interface EmojiImageDraftInput {
    fileName: string;
    url: string;
    name?: string;
    description?: string;
}

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|avif)$/i;
const IMAGE_URL_RE = /\.(png|jpe?g|gif|webp|bmp|avif)([?#].*)?$/i;

export const DEFAULT_EMOJI_CATEGORY_ID = 'default';

export const cleanEmojiText = (value: string | undefined | null): string => (
    (value || '').replace(/\s+/g, ' ').trim()
);

export const emojiNameFromFileName = (fileName: string, fallback = '新表情'): string => {
    const base = cleanEmojiText(
        (fileName || '')
            .replace(/\\/g, '/')
            .split('/')
            .pop()
            ?.replace(IMAGE_EXT_RE, '') || ''
    );
    return base || fallback;
};

export const makeUniqueEmojiName = (rawName: string, usedNames: Set<string>, fallback = '新表情'): string => {
    const base = cleanEmojiText(rawName) || fallback;
    let candidate = base;
    let index = 2;
    while (usedNames.has(candidate)) {
        candidate = `${base}${index}`;
        index += 1;
    }
    usedNames.add(candidate);
    return candidate;
};

export const normalizeEmojiCategoryId = (categoryId?: string): string => (
    cleanEmojiText(categoryId) || DEFAULT_EMOJI_CATEGORY_ID
);

const looksLikeUrlPiece = (value: string): boolean => (
    /^(https?:|data:|\/\/|blob:)/i.test(value) || IMAGE_URL_RE.test(value)
);

export const parseEmojiImportText = (text: string, categoryId?: string): ParsedEmojiImport[] => {
    const targetCategoryId = normalizeEmojiCategoryId(categoryId);
    return (text || '')
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .map((line): ParsedEmojiImport | null => {
            const parts = line.split('--');
            if (parts.length < 2) return null;
            const name = cleanEmojiText(parts[0]);
            let urlParts = parts.slice(1);
            let description = '';
            if (urlParts.length > 1) {
                const last = cleanEmojiText(urlParts[urlParts.length - 1]);
                if (!last) {
                    urlParts = urlParts.slice(0, -1);
                } else if (!looksLikeUrlPiece(last)) {
                    description = last;
                    urlParts = urlParts.slice(0, -1);
                }
            }
            const url = urlParts.join('--').trim();
            if (!name || !url) return null;
            return {
                name,
                url,
                categoryId: targetCategoryId,
                ...(description ? { description } : {}),
            } satisfies ParsedEmojiImport;
        })
        .filter((item): item is ParsedEmojiImport => !!item);
};

export const buildEmojiRecordsFromImageDrafts = (
    drafts: EmojiImageDraftInput[],
    existingEmojis: Emoji[] = [],
    categoryId?: string,
): ParsedEmojiImport[] => {
    const usedNames = new Set(existingEmojis.map(e => e.name));
    const targetCategoryId = normalizeEmojiCategoryId(categoryId);
    return drafts
        .filter(draft => !!draft.url)
        .map(draft => {
            const rawName = cleanEmojiText(draft.name) || emojiNameFromFileName(draft.fileName);
            const name = makeUniqueEmojiName(rawName, usedNames);
            const description = cleanEmojiText(draft.description);
            return {
                name,
                url: draft.url,
                categoryId: targetCategoryId,
                ...(description ? { description } : {}),
            };
        });
};
