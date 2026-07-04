import type { CharacterProfile, UserProfile } from '../types';

const TEXT_MACRO_FIELDS = new Set<keyof CharacterProfile>([
    'systemPrompt',
    'worldview',
    'mesExample',
    'firstMes',
]);

export function bakeCharacterEditorMacros(
    text: string,
    char: Pick<CharacterProfile, 'name'>,
    userProfile?: Pick<UserProfile, 'name' | 'bio'>,
): string {
    const charName = (char.name || '').trim() || '角色';
    const userName = (userProfile?.name || '').trim() || '用户';
    return text
        .replace(/\{\{char\}\}/gi, charName)
        .replace(/\{\{user\}\}/gi, userName)
        .replace(/<char>/gi, charName)
        .replace(/<bot>/gi, charName)
        .replace(/<user>/gi, userName);
}

export function applyCharacterEditorMacros<T>(
    field: keyof CharacterProfile,
    value: T,
    char: Pick<CharacterProfile, 'name'>,
    userProfile?: Pick<UserProfile, 'name' | 'bio'>,
): T {
    if (typeof value === 'string' && TEXT_MACRO_FIELDS.has(field)) {
        return bakeCharacterEditorMacros(value, char, userProfile) as T;
    }
    if (field === 'alternateGreetings' && Array.isArray(value)) {
        return value.map(item =>
            typeof item === 'string' ? bakeCharacterEditorMacros(item, char, userProfile) : item,
        ) as T;
    }
    return value;
}
