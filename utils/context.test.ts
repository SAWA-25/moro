import { describe, expect, it } from 'vitest';
import type { CharacterProfile, UserProfile } from '../types';
import { ContextBuilder } from './context';

const char = {
  id: 'char-a',
  modelId: 'model-a',
  name: 'Same Name',
  avatar: '',
  description: '',
  systemPrompt: 'Stay distinct.',
  memories: [],
  contextLimit: 500,
} as CharacterProfile;

const user = {
  name: 'User',
  avatar: '',
  bio: 'tester',
} as UserProfile;

describe('ContextBuilder character identity anchor', () => {
  it('includes the hidden character id in core context', () => {
    const context = ContextBuilder.buildCoreContext(char, user, false);

    expect(context).toContain('角色ID: model-a');
    expect(context).toContain('Same Name (ID: model-a)');
    expect(context).toContain('不要与其他角色合并');
    expect(context).toContain('日常对话里不要主动念给用户听');
  });

  it('includes the hidden character id in role settings context', () => {
    const context = ContextBuilder.buildRoleSettingsContext(char, { skipMemories: true });

    expect(context).toContain('Hidden Character ID');
    expect(context).toContain('角色ID: model-a');
    expect(context).toContain('Same Name (ID: model-a)');
    expect(context).toContain('不要与其他角色合并');
  });
});
