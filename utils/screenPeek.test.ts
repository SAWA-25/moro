import { describe, expect, it } from 'vitest';
import type { CharacterProfile, PhoneEvidence, UserProfile } from '../types';
import {
  buildScreenPeekSnapshot,
  screenPeekCardUsesScreenshot,
  screenPeekRecordKind,
} from './screenPeek';

const char: CharacterProfile = {
  id: 'char-1',
  modelId: 'char-model-1',
  name: '阿迟',
  avatar: 'avatar.png',
  description: '',
  personality: '',
  scenario: '',
  firstMessage: '',
  systemPrompt: '',
  tags: [],
  memories: [],
  createdAt: 1,
  updatedAt: 1,
} as CharacterProfile;

const user: UserProfile = {
  name: '小夏',
  avatar: 'user.png',
} as UserProfile;

const rec = (input: Partial<PhoneEvidence> & Pick<PhoneEvidence, 'id' | 'type' | 'title' | 'detail'>): PhoneEvidence => ({
  timestamp: 1000,
  ...input,
});

describe('screen peek snapshot selection', () => {
  it('keeps music records on a music snapshot instead of falling into delivery UI', () => {
    const music = rec({
      id: 'music-1',
      type: 'music',
      title: '便利店新品',
      detail: '网易云音乐 · 循环到一半的歌。',
      meta: { appName: '网易云音乐', relatedXunjiRunId: 'run-1' },
    });

    expect(screenPeekRecordKind(music)).toBe('music');

    const snapshot = buildScreenPeekSnapshot({
      char,
      userProfile: user,
      generatedAt: 2000,
      records: [
        rec({
          id: 'delivery-1',
          type: 'delivery',
          title: '常点的店铺',
          detail: '外卖收藏页',
          timestamp: 500,
          meta: { appName: '饭票' },
        }),
        music,
      ],
    });

    expect(snapshot.appKind).toBe('music');
    expect(snapshot.appName).toBe('网易云音乐');
    expect(snapshot.records.map(item => item.id)).toEqual(['music-1']);
  });

  it('scopes the screenshot list to the selected app and source', () => {
    const snapshot = buildScreenPeekSnapshot({
      char,
      userProfile: user,
      generatedAt: 3000,
      records: [
        rec({ id: 'm1', type: 'music', title: 'A', detail: '歌 A', timestamp: 300, meta: { appName: '网易云音乐', relatedXunjiRunId: 'run-1' } }),
        rec({ id: 'm2', type: 'music', title: 'B', detail: '歌 B', timestamp: 200, meta: { appName: '网易云音乐', relatedXunjiRunId: 'run-1' } }),
        rec({ id: 'm3', type: 'music', title: 'C', detail: '歌 C', timestamp: 100, meta: { appName: 'QQ音乐', relatedXunjiRunId: 'run-1' } }),
      ],
    });

    expect(snapshot.appKind).toBe('music');
    expect(snapshot.records.map(item => item.id)).toEqual(['m1', 'm2']);
  });

  it('falls back to home when no phone records are available', () => {
    const snapshot = buildScreenPeekSnapshot({
      char,
      userProfile: user,
      generatedAt: 4000,
      records: [],
    });

    expect(snapshot.source).toBe('phone_home');
    expect(snapshot.appKind).toBe('home');
  });

  it('detects screenshot-backed cards', () => {
    expect(screenPeekCardUsesScreenshot({ screenshotDataUrl: 'data:image/png;base64,abc' })).toBe(true);
    expect(screenPeekCardUsesScreenshot({ screenshotDataUrl: 'https://example.test/a.png' })).toBe(false);
    expect(screenPeekCardUsesScreenshot({})).toBe(false);
  });
});
