import { describe, expect, it } from 'vitest';
import type { AmbientSocialContact, CharacterProfile } from '../types';
import { ambientSocialToCharacter } from './ambientSocial';
import { createCharacterId, formatCharacterWithId, getCharacterModelId } from './characterIdentity';

describe('character identity helpers', () => {
  it('creates non-empty unique character ids with a source prefix', () => {
    const ids = Array.from({ length: 20 }, () => createCharacterId('char'));

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every(id => /^char-[a-z0-9]+-[a-z0-9]+$/i.test(id))).toBe(true);
  });

  it('formats the model-visible character identity label', () => {
    const char = { id: 'char-a', name: 'Same Name' } as CharacterProfile;

    expect(getCharacterModelId(char)).toBe('char-a');
    expect(formatCharacterWithId(char)).toBe('Same Name (ID: char-a)');
    expect(formatCharacterWithId(char, 'Alias')).toBe('Alias (ID: char-a)');
  });

  it('gives ambient social contacts distinct formal character ids', () => {
    const entry = {
      id: 'ambient-entry',
      kind: 'contact',
      name: 'Street Friend',
      relation: 'friend',
      relationLabel: 'friend',
      note: 'Met through ambient social.',
      lastMessage: 'see you',
      lastAt: 1,
      createdAt: 1,
    } as AmbientSocialContact;

    const a = ambientSocialToCharacter(entry, 'User');
    const b = ambientSocialToCharacter({ ...entry, id: 'ambient-entry-2' }, 'User');

    expect(a.id).toMatch(/^ambient-/);
    expect(b.id).toMatch(/^ambient-/);
    expect(a.id).not.toBe(b.id);
  });
});
