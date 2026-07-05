import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { CharacterProfile, GroupProfile, UserProfile } from '../types';
import { DB } from './db';
import {
  DEFAULT_GROUP_OFFLINE_POV,
  clearGroupOfflineSession,
  commitGroupOfflineSessionToContext,
  formatGroupOfflineTranscript,
  generateGroupOfflineOpening,
  generateGroupOfflineTurn,
  hasGroupOfflineSession,
  loadGroupOfflinePov,
  loadGroupOfflineSession,
  loadGroupOfflineWordLimit,
  saveGroupOfflinePov,
  saveGroupOfflineSession,
  saveGroupOfflineWordLimit,
  type GroupOfflineEntry,
  type GroupOfflinePov,
} from './groupOfflineMode';

const entries: GroupOfflineEntry[] = [
  { role: 'scene', text: 'The table by the window is already set.', at: 1 },
  { role: 'char', speakerId: 'char-a', speakerName: 'Mia', text: 'I saved you a seat.', at: 2 },
  { role: 'user', text: 'I sit down with everyone.', at: 3 },
  { role: 'char', speakerId: 'char-b', speakerName: 'Noah', text: 'We ordered tea.', at: 4 },
];

const group: GroupProfile = {
  id: 'group-1',
  name: 'Weekend Table',
  members: ['char-a', 'char-b'],
  createdAt: 1,
};

const members = [
  { id: 'char-a', name: 'Mia', avatar: 'mia.png' },
  { id: 'char-b', name: 'Noah', avatar: 'noah.png' },
] as CharacterProfile[];

const userProfile = {
  name: 'Me',
  avatar: 'me.png',
  bio: 'Likes quiet tables.',
} as UserProfile;

const api = {
  baseUrl: 'https://api.example.test/v1/',
  apiKey: 'test-key',
  model: 'test-model',
};

const mockFetchContent = (content: string) => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

describe('group offline mode', () => {
  beforeEach(async () => {
    localStorage.clear();
    await DB.deleteDB();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps draft sessions isolated per group id', () => {
    saveGroupOfflineSession('group-1', entries);
    saveGroupOfflineSession('group-2', [{ role: 'scene', text: 'Another room.', at: 5 }]);

    expect(hasGroupOfflineSession('group-1')).toBe(true);
    expect(loadGroupOfflineSession('group-1')).toEqual(entries);

    clearGroupOfflineSession('group-1');

    expect(hasGroupOfflineSession('group-1')).toBe(false);
    expect(loadGroupOfflineSession('group-2')).toEqual([{ role: 'scene', text: 'Another room.', at: 5 }]);
  });

  it('persists narration POV per group id', () => {
    const pov: GroupOfflinePov = { members: 'first', user: 'second' };

    saveGroupOfflinePov('group-1', pov);

    expect(loadGroupOfflinePov('group-1')).toEqual(pov);
    expect(loadGroupOfflinePov('group-2')).toEqual(DEFAULT_GROUP_OFFLINE_POV);
  });

  it('persists custom word limits per group id', () => {
    saveGroupOfflineWordLimit('group-1', { maxChars: 180 });

    expect(loadGroupOfflineWordLimit('group-1')).toEqual({ maxChars: 180 });
    expect(loadGroupOfflineWordLimit('group-2')).toEqual({});

    saveGroupOfflineWordLimit('group-1', { maxChars: 5000 });
    expect(loadGroupOfflineWordLimit('group-1')).toEqual({ maxChars: 5000 });

    saveGroupOfflineWordLimit('group-1', {});
    expect(loadGroupOfflineWordLimit('group-1')).toEqual({});
  });

  it('formats a mixed group offline transcript with speaker names', () => {
    expect(formatGroupOfflineTranscript(entries, 'Me')).toBe([
      '(scene) The table by the window is already set.',
      'Mia: I saved you a seat.',
      'Me: I sit down with everyone.',
      'Noah: We ordered tea.',
    ].join('\n'));
  });

  it('commits a group offline session into the group context', async () => {
    const info = await commitGroupOfflineSessionToContext(group, 'Me', [
      ...entries,
      { role: 'scene', text: '大家等着外卖，外卖还没到。', at: 5 },
    ]);

    const messages = await DB.getGroupMessages(group.id);
    expect(messages).toHaveLength(1);
    expect(info?.messageId).toBe(messages[0].id);
    expect(info?.timestamp).toBe(messages[0].timestamp);
    expect(messages[0].groupId).toBe(group.id);
    expect(messages[0].charId).toBe('system');
    expect(messages[0].role).toBe('system');
    expect(messages[0].type).toBe('text');
    expect(messages[0].content).toContain('[group offline session]');
    expect(messages[0].content).toContain('Weekend Table');
    expect(messages[0].content).toContain('Mia: I saved you a seat.');
    expect(messages[0].content).toContain('现场简记如下');
    expect(messages[0].content).toContain('外卖还没到');
    expect(messages[0].content).not.toContain('上下文');
    expect(messages[0].content).not.toContain('这不是要求');
    expect(messages[0].content).not.toContain('严格保持时间边界');
    expect(messages[0].content).not.toContain('外卖送达');
    expect(messages[0].content).not.toContain('总结报告');
    expect(messages[0].metadata).toEqual(expect.objectContaining({
      groupId: group.id,
      groupOfflineSession: true,
    }));
  });

  it('keeps group auto-offline opt-in and documents the director trigger rule', () => {
    const source = readFileSync('apps/ChatHub.tsx', 'utf8');

    expect(source).toContain('autoOffline: !!raw.autoOffline');
    expect(source).toContain('聊着聊着就赴约');
    expect(source).toContain('[[OFFLINE_START]]');
    expect(source).toContain('只有当群聊剧情已经明确进入线下现场时');
    expect(source).toContain('明天下午三点楼下见');
    expect(source).toContain('系统会在约定时间自动打开群聊赴约窗口');
    expect(source).toContain('本群没有开启自动赴约');
  });

  it('generates a group opening with roster, recent chat, and selected scenario', async () => {
    const fetchMock = mockFetchContent('Opening scene');
    await DB.saveMessage({
      charId: 'user',
      groupId: group.id,
      role: 'user',
      type: 'text',
      content: 'See you at 7.',
    } as any);
    await DB.saveMessage({
      charId: 'char-a',
      groupId: group.id,
      role: 'assistant',
      type: 'text',
      content: 'I will bring snacks.',
    } as any);

    const result = await generateGroupOfflineOpening(
      group,
      members,
      userProfile,
      api,
      DEFAULT_GROUP_OFFLINE_POV,
      'Meet at the tea house.',
    );

    expect(result).toBe('Opening scene');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.test/v1/chat/completions');
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual(expect.objectContaining({
      Authorization: 'Bearer test-key',
    }));
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.model).toBe('test-model');
    const prompt = body.messages[0].content;
    expect(prompt).toContain('Weekend Table');
    expect(prompt).toContain('Mia (ID: char-a)');
    expect(prompt).toContain('Noah (ID: char-b)');
    expect(prompt).toContain('See you at 7.');
    expect(prompt).toContain('I will bring snacks.');
    expect(prompt).toContain('Meet at the tea house.');
    expect(body.max_tokens).toBe(2400);
  });

  it('continues group offline openings when the model response is cut by length', async () => {
    const queue = [
      { content: '窗边的桌子刚拼好，几个人的影子落在杯沿上，Mia 正要抬手', finish_reason: 'length' },
      { content: '招呼 Me 过去，Noah 已经把空椅子往外拉了一点。', finish_reason: 'stop' },
    ];
    const fetchMock = vi.fn().mockImplementation(async () => {
      const next = queue.shift();
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ choices: [{ message: { content: next?.content || '' }, finish_reason: next?.finish_reason || 'stop' }] }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateGroupOfflineOpening(
      group,
      members,
      userProfile,
      api,
      DEFAULT_GROUP_OFFLINE_POV,
      'Meet at the tea house.',
    );

    expect(result).toBe('窗边的桌子刚拼好，几个人的影子落在杯沿上，Mia 正要抬手招呼 Me 过去，Noah 已经把空椅子往外拉了一点。');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps same-name group members separate with hidden ids in prompts', async () => {
    const fetchMock = mockFetchContent('Opening scene');
    const sameNameMembers = [
      { id: 'char-a', modelId: 'model-a', name: 'Same', avatar: 'a.png' },
      { id: 'char-b', modelId: 'model-b', name: 'Same', avatar: 'b.png' },
    ] as CharacterProfile[];

    await generateGroupOfflineOpening(
      group,
      sameNameMembers,
      userProfile,
      api,
      DEFAULT_GROUP_OFFLINE_POV,
      'Meet in the lobby.',
    );

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    const prompt = body.messages[0].content;
    expect(prompt).toContain('Same (ID: model-a)');
    expect(prompt).toContain('Same (ID: model-b)');
    expect(prompt).not.toContain('Same (ID: char-a)');
    expect(prompt).not.toContain('Same (ID: char-b)');
  });

  it('generates a group turn from the local scene transcript and user action', async () => {
    const fetchMock = mockFetchContent('Next turn');

    const result = await generateGroupOfflineTurn(
      group,
      members,
      userProfile,
      api,
      entries,
      'I wave at the table.',
      DEFAULT_GROUP_OFFLINE_POV,
      undefined,
      { maxChars: 120 },
    );

    expect(result).toBe('Next turn');
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    const prompt = body.messages[0].content;
    expect(prompt).toContain('Weekend Table');
    expect(prompt).toContain('Mia: I saved you a seat.');
    expect(prompt).toContain('Noah: We ordered tea.');
    expect(prompt).toContain('I wave at the table.');
    expect(prompt).toContain('续写接下来的一小段群体现场互动（不超过120字）');
    expect(prompt).toContain('字数上限是 120 字');
    expect(body.max_tokens).toBe(1320);
  });
});
