import type { CharacterProfile } from '../types';

type CharacterIdSource = 'char' | 'ambient' | 'import' | 'roam' | 'test' | string;
type CharacterIdentityLike = Pick<CharacterProfile, 'id' | 'modelId'>;

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
