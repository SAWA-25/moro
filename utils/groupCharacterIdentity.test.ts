import { describe, expect, it } from 'vitest';
import type { CharacterProfile, GroupProfile } from '../types';
import { parseGroupMemberLensMap, resolveGroupMemberStorageId } from './groupCharacterIdentity';

const members = [
  { id: 'local-a', modelId: 'model-a', name: 'Same', avatar: 'a.png' },
  { id: 'local-b', modelId: 'model-b', name: 'Same', avatar: 'b.png' },
] as CharacterProfile[];

const group = {
  id: 'group-1',
  name: 'Test Group',
  members: ['local-a', 'local-b'],
  createdAt: 1,
} as GroupProfile;

describe('group character identity helpers', () => {
  it('maps model char ids back to local group member ids', () => {
    expect(resolveGroupMemberStorageId(group, members, 'model-a')).toBe('local-a');
    expect(resolveGroupMemberStorageId(group, members, 'local-b')).toBe('local-b');
    expect(resolveGroupMemberStorageId(group, members, 'local-a')).toBe('local-a');
    expect(resolveGroupMemberStorageId(group, members, 'Same')).toBeUndefined();
  });

  it('normalizes generated member lens keys before storing drafts', () => {
    const parsed = parseGroupMemberLensMap(JSON.stringify({
      'model-a': 'A sees this as a quiet rivalry.',
      'model-b': { note: 'B is warmer but still cautious.' },
      'Same': 'name-only keys are ignored',
    }), members);

    expect(parsed).toEqual({
      'local-a': 'A sees this as a quiet rivalry.',
      'local-b': 'B is warmer but still cautious.',
    });
  });

  it('normalizes array-style generated member lens ids before storing drafts', () => {
    const parsed = parseGroupMemberLensMap(JSON.stringify({
      items: [
        { charId: 'model-b', text: 'B keeps a little distance.' },
        { targetId: 'local-a', summary: 'A notices every pause.' },
      ],
    }), members);

    expect(parsed).toEqual({
      'local-a': 'A notices every pause.',
      'local-b': 'B keeps a little distance.',
    });
  });
});
