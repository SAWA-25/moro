import { describe, expect, it } from 'vitest';
import type { CharacterProfile, GroupProfile } from '../types';
import { mergeCharacterProfileUpdate, mergeGroupProfileUpdate } from './profileUpdateMerge';

const baseChar = (): CharacterProfile => ({
  id: 'char-a',
  modelId: 'model-a',
  name: 'A',
  avatar: '',
  description: '',
  systemPrompt: '',
  memories: [],
  contextLimit: 500,
  convoSettings: {
    proactiveCallEnabled: true,
    autoOffline: true,
    allowCharAvatarFromUserImage: true,
    liveChatOverride: 'on',
  },
  socialProfile: {
    handle: 'moro_a',
    region: '上海',
    bio: 'old bio',
  },
  cityConfig: {
    mode: 'virtual',
    virtualName: '云港',
    prototypeCity: '杭州',
    fictionLevel: 60,
  },
  emotionConfig: {
    enabled: true,
    moodApi: { baseUrl: 'https://mood.example', apiKey: 'k', model: 'mood' },
  },
  proactiveConfig: {
    enabled: true,
    intervalMinutes: 60,
    randomMode: true,
  },
});

const baseGroup = (): GroupProfile => ({
  id: 'group-a',
  name: 'Group A',
  members: ['char-a', 'char-b'],
  createdAt: 1,
  convoSettings: {
    bubbleStyleMode: 'whole',
    personaDrivenMessageLength: true,
    liveChatOverride: 'on',
    translationEnabled: true,
    translateSourceLang: '日本語',
    translateTargetLang: '中文',
    allowedEmojiCategoryIds: ['cat-a'],
  },
});

describe('profile update merging', () => {
  it('merges private chat convo setting patches without dropping siblings', () => {
    const merged = mergeCharacterProfileUpdate(baseChar(), {
      convoSettings: { forceReplyEnabled: true, autoOffline: false },
    });

    expect(merged.convoSettings).toMatchObject({
      proactiveCallEnabled: true,
      allowCharAvatarFromUserImage: true,
      forceReplyEnabled: true,
      autoOffline: false,
    });
  });

  it('keeps explicit undefined patches so settings can return to defaults', () => {
    const merged = mergeCharacterProfileUpdate(baseChar(), {
      convoSettings: { liveChatOverride: undefined },
    });

    expect(merged.convoSettings).toHaveProperty('liveChatOverride', undefined);
    expect(merged.convoSettings?.proactiveCallEnabled).toBe(true);
  });

  it('merges other private settings bags used by the chat settings page', () => {
    const merged = mergeCharacterProfileUpdate(baseChar(), {
      socialProfile: { handle: 'moro_a', bio: 'new bio' },
      cityConfig: { mode: 'real', realCity: '成都' },
      emotionConfig: { enabled: false },
      proactiveConfig: { enabled: false, intervalMinutes: 60 },
    });

    expect(merged.socialProfile).toEqual({ handle: 'moro_a', region: '上海', bio: 'new bio' });
    expect(merged.cityConfig).toMatchObject({ mode: 'real', realCity: '成都', prototypeCity: '杭州' });
    expect(merged.emotionConfig?.moodApi?.model).toBe('mood');
    expect(merged.emotionConfig?.enabled).toBe(false);
    expect(merged.proactiveConfig).toMatchObject({ enabled: false, intervalMinutes: 60, randomMode: true });
  });

  it('merges group convo setting patches without dropping siblings', () => {
    const merged = mergeGroupProfileUpdate(baseGroup(), {
      convoSettings: { narrationMode: true, liveChatOverride: undefined },
    });

    expect(merged.convoSettings).toMatchObject({
      bubbleStyleMode: 'whole',
      personaDrivenMessageLength: true,
      translationEnabled: true,
      narrationMode: true,
    });
    expect(merged.convoSettings).toHaveProperty('liveChatOverride', undefined);
  });
});
