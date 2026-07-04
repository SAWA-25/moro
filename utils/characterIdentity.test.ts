import { describe, expect, it } from 'vitest';
import type { AmbientSocialContact, AmbientSocialEntry, CharacterProfile, UserProfile } from '../types';
import { ambientSocialToCharacter, ensureAmbientSocialState, getAmbientSocialLinkedCharacterIds, getAmbientSocialLinkedGroupIds, isAmbientSocialCharacter, isAmbientSocialCharacterForUser, isRejectedAmbientGeneratedName, removeAmbientSocialEntry, shouldHideAmbientSocialRecordForUser } from './ambientSocial';
import { buildCharacterIdentityAnchorPrompt, createCharacterId, ensureCharacterModelId, formatCharacterWithId, getCharacterModelId, resolveCharacterByModelId } from './characterIdentity';

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

  it('uses modelId as the model-visible identity when present', () => {
    const char = { id: 'db-row-a', modelId: 'identity-a', name: 'Same Name' } as CharacterProfile;

    expect(getCharacterModelId(char)).toBe('identity-a');
    expect(formatCharacterWithId(char)).toBe('Same Name (ID: identity-a)');
  });

  it('builds a reusable model-visible identity anchor prompt', () => {
    const char = { id: 'db-row-a', modelId: 'identity-a', name: 'Same Name' } as CharacterProfile;

    const prompt = buildCharacterIdentityAnchorPrompt(char, { taskLabel: 'a schedule task' });

    expect(prompt).toContain('targetModelCharId: "identity-a"');
    expect(prompt).toContain('targetLocalCharId: "db-row-a"');
    expect(prompt).toContain('Same Name (ID: identity-a)');
    expect(prompt).toContain('Do not merge, substitute, or borrow');
  });

  it('resolves model-visible ids back to local character records', () => {
    const chars = [
      { id: 'row-a', modelId: 'model-a', name: 'Same Name' },
      { id: 'row-b', modelId: 'model-b', name: 'Same Name' },
    ] as CharacterProfile[];

    expect(resolveCharacterByModelId(chars, 'model-b')?.id).toBe('row-b');
    expect(resolveCharacterByModelId(chars, 'row-a')?.modelId).toBe('model-a');
  });

  it('backfills missing modelId from the persistent row id', () => {
    const char = { id: 'legacy-row', name: 'Legacy' } as CharacterProfile;
    const normalized = ensureCharacterModelId(char);

    expect(normalized.modelId).toBe('legacy-row');
    expect(normalized.id).toBe('legacy-row');
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
    expect(isAmbientSocialCharacter(a)).toBe(true);
  });

  it('recognizes legacy ambient social characters for list filtering', () => {
    const legacy = {
      id: 'ambient-old-123',
      name: 'Old Street Friend',
      avatar: '',
      description: '从絮语里自然接入的人。有自己的生活、社交圈和日常节奏。',
      systemPrompt: '',
      memories: [],
    } as CharacterProfile;

    expect(isAmbientSocialCharacter(legacy)).toBe(true);
  });

  it('tracks converted ambient social entries linked to existing formal records', () => {
    const entries = [
      {
        id: 'ambient-contact',
        kind: 'contact',
        name: 'Existing Friend',
        relation: 'friend',
        relationLabel: 'friend',
        avatar: '',
        note: '',
        lastMessage: '',
        lastAt: 1,
        linkedCharId: 'char-existing',
        createdAt: 1,
      },
      {
        id: 'ambient-group',
        kind: 'group',
        name: 'Existing Group',
        relation: 'group',
        relationLabel: 'group',
        avatar: '',
        note: '',
        memberNames: ['A', 'B'],
        lastMessage: '',
        lastAt: 1,
        linkedGroupId: 'group-existing',
        createdAt: 1,
      },
    ] as AmbientSocialEntry[];

    const existing = { id: 'char-existing', name: 'Existing Friend' } as CharacterProfile;

    expect(isAmbientSocialCharacter(existing)).toBe(false);
    expect(getAmbientSocialLinkedCharacterIds(entries).has(existing.id)).toBe(true);
    expect(getAmbientSocialLinkedGroupIds(entries).has('group-existing')).toBe(true);
  });

  it('removes ambient social entries instead of leaving hidden tombstones', () => {
    const state = {
      version: 1,
      seededAt: 1,
      entries: [
        {
          id: 'ambient-delete-me',
          kind: 'contact',
          name: 'Delete Me',
          relation: 'friend',
          relationLabel: 'friend',
          avatar: '',
          note: '',
          lastMessage: '',
          lastAt: 1,
          createdAt: 1,
        },
        {
          id: 'ambient-keep-me',
          kind: 'contact',
          name: 'Keep Me',
          relation: 'friend',
          relationLabel: 'friend',
          avatar: '',
          note: '',
          lastMessage: '',
          lastAt: 2,
          createdAt: 1,
        },
      ],
    } as UserProfile['ambientSocial'];

    const next = removeAmbientSocialEntry(state, 'ambient-delete-me');

    expect(next.entries.map(entry => entry.id)).toEqual(['ambient-keep-me']);
    expect(next.entries.some(entry => entry.id === 'ambient-delete-me')).toBe(false);
  });

  it('purges old hidden unlinked ambient contacts during normalization', async () => {
    const profile = {
      name: 'User',
      avatar: '',
      bio: '',
      ambientSocial: {
        version: 1,
        seededAt: 1,
        entries: [
          {
            id: 'ambient-hidden-old',
            kind: 'contact',
            name: 'Hidden Old',
            relation: 'friend',
            relationLabel: 'friend',
            avatar: '',
            note: '',
            lastMessage: '',
            lastAt: 1,
            hidden: true,
            createdAt: 1,
          },
          {
            id: 'ambient-linked',
            kind: 'contact',
            name: 'Linked',
            relation: 'friend',
            relationLabel: 'friend',
            avatar: '',
            note: '',
            lastMessage: '',
            lastAt: 2,
            hidden: true,
            linkedCharId: 'char-linked',
            createdAt: 1,
          },
        ],
      },
    } as UserProfile;

    const next = await ensureAmbientSocialState(profile, [], { baseUrl: '', apiKey: '', model: '' } as any, 2);

    expect(next.entries.map(entry => entry.id)).toEqual(['ambient-linked']);
  });

  it('rejects placeholder-like ambient social generated names', () => {
    expect(isRejectedAmbientGeneratedName('絮语向导-07')).toBe(true);
    expect(isRejectedAmbientGeneratedName('絮语助手')).toBe(true);
    expect(isRejectedAmbientGeneratedName('NPC_12')).toBe(true);
    expect(isRejectedAmbientGeneratedName('邻居阿南')).toBe(false);
  });

  it('treats linked ambient contacts as hidden when the user social circle is off', () => {
    const profile = {
      name: 'User',
      avatar: '',
      bio: '',
      ambientSocialEnabled: false,
      ambientSocial: {
        version: 1,
        seededAt: 1,
        entries: [{
          id: 'ambient-contact',
          kind: 'contact',
          name: 'Existing Friend',
          relation: 'friend',
          relationLabel: 'friend',
          avatar: '',
          note: '',
          lastMessage: '',
          lastAt: 1,
          linkedCharId: 'char-existing',
          createdAt: 1,
        }],
      },
    } as UserProfile;
    const existing = { id: 'char-existing', name: 'Existing Friend' } as CharacterProfile;

    expect(isAmbientSocialCharacterForUser(existing, profile)).toBe(true);
    expect(shouldHideAmbientSocialRecordForUser(profile)).toBe(true);
  });
});
