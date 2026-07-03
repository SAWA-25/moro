import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterProfile, SocialPost } from '../types';

const mocks = vi.hoisted(() => ({
  getLifeEvents: vi.fn(),
  getSocialPosts: vi.fn(),
  saveSocialPost: vi.fn(),
  generateAutoCharacterMoment: vi.fn(),
}));

vi.mock('./db', () => ({
  DB: {
    getLifeEvents: mocks.getLifeEvents,
    getSocialPosts: mocks.getSocialPosts,
    saveSocialPost: mocks.saveSocialPost,
  },
}));

vi.mock('./auxApi', () => ({
  resolveAuxApi: vi.fn(() => ({})),
}));

vi.mock('./autonomousLife', () => ({
  sanitizeLifeText: (value: unknown) => String(value || ''),
}));

vi.mock('../components/moments/momentsGen', () => ({
  generateAutoCharacterMoment: mocks.generateAutoCharacterMoment,
}));

import { momentsAutoPostPrompt } from './laiwangPrompts';
import { maybeRunMomentsAutoPost } from './momentsAutoPost';

const HOUR = 60 * 60 * 1000;
const NOW = 24 * HOUR;
const apiConfig = { apiKey: 'key', model: 'model' } as any;
const userProfile = { name: '小夏' } as any;

const char = (id: string, momentsAutoPost: 'off' | 'random' | number) => ({
  id,
  name: `角色${id}`,
  avatar: '',
  convoSettings: { momentsAutoPost },
}) as CharacterProfile;

const post = (id: string, charId: string): SocialPost => ({
  id,
  authorName: `角色${charId}`,
  authorAvatar: '',
  title: '',
  content: '刚好路过一家花店。',
  images: [],
  likes: 0,
  isCollected: false,
  isLiked: false,
  comments: [],
  timestamp: NOW,
  tags: ['主动此刻'],
  authorType: 'character',
  authorCharId: charId,
  likedBy: [],
  repostOf: null,
  visibility: 'public',
  lastActivityAt: NOW,
  unreadForUser: true,
  source: 'auto',
}) as SocialPost;

describe('maybeRunMomentsAutoPost', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.getLifeEvents.mockResolvedValue([]);
    mocks.getSocialPosts.mockResolvedValue([]);
    mocks.saveSocialPost.mockResolvedValue(undefined);
    mocks.generateAutoCharacterMoment.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not run when auto post is off', async () => {
    const result = await maybeRunMomentsAutoPost({
      characters: [char('c1', 'off')],
      userProfile,
      apiConfig,
      trigger: 'startup',
      now: NOW,
    });

    expect(result).toEqual([]);
    expect(mocks.generateAutoCharacterMoment).not.toHaveBeenCalled();
  });

  it('skips ambient social characters when the user social circle is disabled', async () => {
    const ambient = {
      ...char('ambient-1', 1),
      ambientSocialSource: { entryId: 'amb-1' },
    } as CharacterProfile;

    const result = await maybeRunMomentsAutoPost({
      characters: [ambient],
      userProfile: { ...userProfile, ambientSocialEnabled: false } as any,
      apiConfig,
      trigger: 'startup',
      now: NOW,
    });

    expect(result).toEqual([]);
    expect(mocks.generateAutoCharacterMoment).not.toHaveBeenCalled();
  });

  it('records a random roll even when the dice misses', async () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);

    await maybeRunMomentsAutoPost({
      characters: [char('c1', 'random')],
      userProfile,
      apiConfig,
      trigger: 'startup',
      now: NOW,
    });
    await maybeRunMomentsAutoPost({
      characters: [char('c1', 'random')],
      userProfile,
      apiConfig,
      trigger: 'startup',
      now: NOW + 60 * 1000,
    });

    expect(localStorage.getItem('moro_moments_auto_roll_v1_c1')).toBe(String(NOW));
    expect(randomSpy).toHaveBeenCalledTimes(1);
    expect(mocks.generateAutoCharacterMoment).not.toHaveBeenCalled();
  });

  it('keeps the random roll cooldown when the model chooses not to post', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.01);
    mocks.generateAutoCharacterMoment.mockResolvedValue(null);

    await maybeRunMomentsAutoPost({
      characters: [char('c1', 'random')],
      userProfile,
      apiConfig,
      trigger: 'autonomous-life-catchup',
      now: NOW,
    });
    await maybeRunMomentsAutoPost({
      characters: [char('c1', 'random')],
      userProfile,
      apiConfig,
      trigger: 'autonomous-life-catchup',
      now: NOW + 60 * 1000,
    });

    expect(mocks.generateAutoCharacterMoment).toHaveBeenCalledTimes(1);
    expect(mocks.saveSocialPost).not.toHaveBeenCalled();
  });

  it('limits random mode to one generated post per trigger', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.01);
    mocks.generateAutoCharacterMoment.mockResolvedValue(post('p1', 'c1'));

    const result = await maybeRunMomentsAutoPost({
      characters: [char('c1', 'random'), char('c2', 'random')],
      userProfile,
      apiConfig,
      trigger: 'focus',
      now: NOW,
    });

    expect(result).toHaveLength(1);
    expect(mocks.generateAutoCharacterMoment).toHaveBeenCalledTimes(1);
    expect(mocks.saveSocialPost).toHaveBeenCalledTimes(1);
  });

  it('does not apply random roll cooldown to fixed hourly frequency', async () => {
    const randomSpy = vi.spyOn(Math, 'random');
    localStorage.setItem('moro_moments_auto_roll_v1_c1', String(NOW));
    mocks.generateAutoCharacterMoment.mockResolvedValue(post('p1', 'c1'));

    const result = await maybeRunMomentsAutoPost({
      characters: [char('c1', 1)],
      userProfile,
      apiConfig,
      trigger: 'startup',
      now: NOW,
    });

    expect(result).toHaveLength(1);
    expect(randomSpy).not.toHaveBeenCalled();
    expect(localStorage.getItem('moro_moments_auto_last_v1_c1')).toBe(String(NOW));
  });
});

describe('momentsAutoPostPrompt', () => {
  it('keeps auto posts optional and preserves the JSON array contract', () => {
    const prompt = momentsAutoPostPrompt({
      userName: '小夏',
      charName: '阿迟',
      charBlock: '<<< 角色档案 >>>',
      trigger: 'startup',
      recentLife: '',
      feedDigest: '(朋友圈暂时是空的)',
    });

    expect(prompt).toContain('默认可以不发');
    expect(prompt).toContain('startup / focus / proactive-message-sent / autonomous-life-catchup');
    expect(prompt).toContain('输出 []');
    expect(prompt).toContain('JSON Array');
    expect(prompt).toContain('"charId"');
  });
});
