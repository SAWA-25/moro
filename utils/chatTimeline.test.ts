import { describe, expect, it } from 'vitest';
import { buildChatTimelineItems, timelineItemsForDigest } from './chatTimeline';
import type { CharacterProfile, GroupProfile, Message } from '../types';

const char = { id: 'c1', name: '阿迟', avatar: '', description: '', systemPrompt: '', memories: [] } as CharacterProfile;
const group = { id: 'g1', name: '小群', members: ['c1'], createdAt: 1 } as GroupProfile;

describe('chatTimeline', () => {
  it('merges private, group, moment, couple, life and followup signals', () => {
    const items = buildChatTimelineItems({
      characters: [{ ...char, relationship: { stage: 'friend', label: '朋友', since: 1, updatedAt: 80 } }],
      groups: [group],
      privateMessages: [{ id: 1, charId: 'c1', role: 'assistant', type: 'text', content: '今晚雨很大', timestamp: 100 } as Message],
      groupMessages: [{ id: 2, charId: 'c1', groupId: 'g1', role: 'assistant', type: 'text', content: '群里也在聊雨', timestamp: 90 } as Message],
      socialPosts: [{ id: 'p1', authorName: '阿迟', content: '发了一张雨天照片', timestamp: 70 } as any],
      lifeEvents: [{ id: 'l1', charId: 'c1', timestamp: 60, activity: '在窗边等雨停', summary: '雨声很吵', source: 'catchup' } as any],
      followups: [{ id: 'f1', source: 'private_message', targetKind: 'char', targetId: 'c1', title: '稍后回', status: 'open', createdAt: 50, updatedAt: 50 } as any],
      digests: [{ id: 'd1', date: '2026-07-03', range: { from: 0, to: 1 }, sourceItemIds: [], summary: '今日摘要', highlights: [], createdAt: 40 }],
    });

    expect(items.map(item => item.source)).toEqual(expect.arrayContaining(['private', 'group', 'moments', 'life', 'followup', 'digest', 'relationship']));
    expect(items.find(item => item.source === 'followup')?.openTarget?.kind).toBe('char');
    expect(items.find(item => item.source === 'group')?.openTarget?.groupId).toBe('g1');
  });

  it('keeps digest source ordered by recency', () => {
    const items = buildChatTimelineItems({
      characters: [char],
      privateMessages: [
        { id: 1, charId: 'c1', role: 'user', type: 'text', content: 'old', timestamp: 1 } as Message,
        { id: 2, charId: 'c1', role: 'assistant', type: 'text', content: 'new', timestamp: 5 } as Message,
      ],
    });

    expect(timelineItemsForDigest(items, 1)[0].summary).toBe('new');
  });
});
