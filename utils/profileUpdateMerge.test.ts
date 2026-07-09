import { describe, expect, it } from 'vitest';
import type { CharacterProfile, GroupProfile } from '../types';
import { mergeCharacterProfileUpdate, mergeGroupProfileUpdate, preserveCharacterEmotionState } from './profileUpdateMerge';

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
    charAvatarOverride: 'data:image/png;base64,current',
    charAvatarChangeReason: '就用这张',
    charAvatarUpdatedAt: 123,
    charAvatarChangeSource: 'user_request',
    charAvatarSourceMessageId: 9,
    charAvatarPreviousOverride: 'data:image/png;base64:old',
    charAvatarHistory: [{ sourceMessageId: 9, reason: '就用这张', source: 'user_request', at: 100 }],
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

  it('keeps char avatar change metadata while merging sibling convo settings', () => {
    const merged = mergeCharacterProfileUpdate(baseChar(), {
      convoSettings: { charAvatarOverride: 'data:image/png;base64,new' },
    });

    expect(merged.convoSettings?.allowCharAvatarFromUserImage).toBe(true);
    expect(merged.convoSettings?.charAvatarChangeReason).toBe('就用这张');
    expect(merged.convoSettings?.charAvatarHistory?.[0]).toMatchObject({
      sourceMessageId: 9,
      source: 'user_request',
    });
    expect(merged.convoSettings?.charAvatarOverride).toBe('data:image/png;base64,new');
    expect(merged.convoSettings?.charAvatarPreviousOverride).toBe('data:image/png;base64:old');
    expect(merged.convoSettings?.charAvatarUpdatedAt).toBe(123);
    expect(merged.convoSettings?.charAvatarSourceMessageId).toBe(9);
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

  it('keeps newer persisted emotion buffs when an unrelated background patch saves a stale character snapshot', () => {
    const stale = {
      ...baseChar(),
      activeBuffs: [{ id: 'old', name: 'old_mood', label: '旧心情', intensity: 2 as const }],
      buffInjection: '旧的情绪底色',
    };
    const latest = {
      ...stale,
      activeBuffs: [{ id: 'new', name: 'new_mood', label: '新心情', intensity: 3 as const }],
      buffInjection: '新的情绪底色',
    };
    const updates: Partial<CharacterProfile> = { hideBeforeMessageId: 100 };
    const candidate = mergeCharacterProfileUpdate(stale, updates);
    const merged = preserveCharacterEmotionState(candidate, latest, updates);

    expect(merged.activeBuffs?.[0]?.id).toBe('new');
    expect(merged.buffInjection).toBe('新的情绪底色');
    expect(merged.hideBeforeMessageId).toBe(100);
  });

  it('allows explicit emotion buff patches to clear or replace buffs', () => {
    const current = {
      ...baseChar(),
      activeBuffs: [{ id: 'old', name: 'old_mood', label: '旧心情', intensity: 2 as const }],
      buffInjection: '旧的情绪底色',
    };
    const latest = {
      ...current,
      activeBuffs: [{ id: 'new', name: 'new_mood', label: '新心情', intensity: 3 as const }],
      buffInjection: '新的情绪底色',
    };
    const updates: Partial<CharacterProfile> = { activeBuffs: [], buffInjection: '' };
    const candidate = mergeCharacterProfileUpdate(current, updates);
    const merged = preserveCharacterEmotionState(candidate, latest, updates);

    expect(merged.activeBuffs).toEqual([]);
    expect(merged.buffInjection).toBe('');
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
