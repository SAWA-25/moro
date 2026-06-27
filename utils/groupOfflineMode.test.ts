import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  saveGroupOfflinePov,
  saveGroupOfflineSession,
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
    text: async () => JSON.stringify({ choices: [{ message: { content } }] }),
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

  it('formats a mixed group offline transcript with speaker names', () => {
    expect(formatGroupOfflineTranscript(entries, 'Me')).toBe([
      '(scene) The table by the window is already set.',
      'Mia: I saved you a seat.',
      'Me: I sit down with everyone.',
      'Noah: We ordered tea.',
    ].join('\n'));
  });

  it('commits a group offline session into the group context', async () => {
    await commitGroupOfflineSessionToContext(group, 'Me', entries);

    const messages = await DB.getGroupMessages(group.id);
    expect(messages).toHaveLength(1);
    expect(messages[0].groupId).toBe(group.id);
    expect(messages[0].charId).toBe('system');
    expect(messages[0].role).toBe('system');
    expect(messages[0].type).toBe('text');
    expect(messages[0].content).toContain('[group offline session]');
    expect(messages[0].content).toContain('Weekend Table');
    expect(messages[0].content).toContain('Mia: I saved you a seat.');
    expect(messages[0].metadata).toEqual(expect.objectContaining({
      groupId: group.id,
      groupOfflineSession: true,
    }));
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
    expect(prompt).toContain('Mia');
    expect(prompt).toContain('Noah');
    expect(prompt).toContain('See you at 7.');
    expect(prompt).toContain('I will bring snacks.');
    expect(prompt).toContain('Meet at the tea house.');
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
    );

    expect(result).toBe('Next turn');
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    const prompt = body.messages[0].content;
    expect(prompt).toContain('Weekend Table');
    expect(prompt).toContain('Mia: I saved you a seat.');
    expect(prompt).toContain('Noah: We ordered tea.');
    expect(prompt).toContain('I wave at the table.');
  });
});
