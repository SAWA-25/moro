import type { CharacterProfile } from '../types';

type CharacterIdSource = 'char' | 'ambient' | 'import' | 'roam' | 'test' | string;
type CharacterIdentityLike = Pick<CharacterProfile, 'id' | 'modelId'>;
type CharacterIdentityPromptLike = Pick<CharacterProfile, 'id' | 'modelId' | 'name'>;

const randomSuffix = (): string => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    }
    return Math.random().toString(36).slice(2, 10);
};

const normalizeSource = (source: CharacterIdSource): string => {
    const raw = String(source || 'char').trim().toLowerCase();
    const safe = raw.replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
    return safe || 'char';
};

export function createCharacterId(source: CharacterIdSource = 'char'): string {
    return `${normalizeSource(source)}-${Date.now().toString(36)}-${randomSuffix()}`;
}

export function getCharacterModelId(char: CharacterIdentityLike | null | undefined): string {
    return String(char?.modelId || char?.id || '').trim();
}

export function ensureCharacterModelId<T extends CharacterIdentityLike>(char: T, fallbackSource: CharacterIdSource = 'char'): T {
    const existing = String(char?.modelId || '').trim();
    if (existing) return char;
    const fallback = String(char?.id || '').trim() || createCharacterId(fallbackSource);
    return { ...char, modelId: fallback };
}

export function formatCharacterWithId(
    char: Pick<CharacterProfile, 'id' | 'modelId' | 'name'>,
    displayName?: string,
): string {
    const name = (displayName || char.name || '角色').trim();
    const id = getCharacterModelId(char);
    return id ? `${name} (ID: ${id})` : name;
}

export function buildCharacterIdentityAnchorPrompt(
    char: CharacterIdentityPromptLike,
    options: {
        heading?: string;
        taskLabel?: string;
        includeLocalRowId?: boolean;
    } = {},
): string {
    const heading = options.heading || 'Moro Character Identity Anchor';
    const taskLabel = options.taskLabel || 'this task';
    const modelId = getCharacterModelId(char);
    const localRowId = String(char.id || '').trim();
    const lines = [
        `### ${heading}`,
        modelId ? `- targetModelCharId: "${modelId}"` : '',
        localRowId && options.includeLocalRowId !== false ? `- targetLocalCharId: "${localRowId}"` : '',
        `- targetCharacter: ${formatCharacterWithId(char)}`,
        '',
        `This API call is only for the target character above. Keep persona, memories, schedules, social posts, relationship state, and generated records attached to that identity anchor while doing ${taskLabel}.`,
        'Do not merge, substitute, or borrow from another character even if their name, persona, relationship, city, or recent plot is similar.',
        'The identity values are internal anchors. Do not mention them to the user unless the current JSON schema explicitly asks for a character id or the user directly asks for an identifier.',
    ].filter(Boolean);
    return lines.join('\n');
}

export function resolveCharacterByModelId<T extends CharacterIdentityPromptLike>(
    characters: T[],
    modelOrLocalId: string | undefined | null,
): T | undefined {
    const id = String(modelOrLocalId || '').trim();
    if (!id) return undefined;
    return characters.find(c => getCharacterModelId(c) === id)
        || characters.find(c => c.id === id);
}
