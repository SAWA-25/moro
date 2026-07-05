import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterProfile, UserProfile } from '../types';
import { DB } from './db';
import {
  clearOfflineSession,
  commitOfflineSessionToContext,
  DEFAULT_OFFLINE_POV,
  generateOfflineOpening,
  hasOfflineSession,
  isOfflineSessionActive,
  loadOfflineWordLimit,
  loadOfflineSession,
  markOfflineSessionActive,
  prepareOfflineGeneratedText,
  saveOfflineSession,
  saveOfflineWordLimit,
  type OfflineEntry,
} from './offlineMode';

const entries: OfflineEntry[] = [
  { role: 'scene', text: '雨停在门口。', at: 1 },
  { role: 'char', text: '你来了。', at: 2 },
  { role: 'user', text: '我把伞收起来。', at: 3 },
];

describe('offline mode draft sessions', () => {
  beforeEach(async () => {
    localStorage.clear();
    await DB.deleteDB();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps draft sessions isolated per character id', () => {
    saveOfflineSession('char-1', entries);
    saveOfflineSession('char-2', [{ role: 'scene', text: '另一处灯光。', at: 4 }]);

    expect(hasOfflineSession('char-1')).toBe(true);
    expect(loadOfflineSession('char-1')).toEqual(entries);

    clearOfflineSession('char-1');

    expect(hasOfflineSession('char-1')).toBe(false);
    expect(loadOfflineSession('char-1')).toEqual([]);
    expect(loadOfflineSession('char-2')).toEqual([{ role: 'scene', text: '另一处灯光。', at: 4 }]);
  });

  it('treats empty or missing draft data as no active session', () => {
    expect(loadOfflineSession('missing')).toEqual([]);
    expect(hasOfflineSession('missing')).toBe(false);
    expect(isOfflineSessionActive('missing')).toBe(false);

    saveOfflineSession('empty', []);

    expect(loadOfflineSession('empty')).toEqual([]);
    expect(hasOfflineSession('empty')).toBe(false);
    expect(isOfflineSessionActive('empty')).toBe(false);
  });

  it('tracks an active offline scene before the first draft entry exists', () => {
    markOfflineSessionActive('char-1');

    expect(loadOfflineSession('char-1')).toEqual([]);
    expect(hasOfflineSession('char-1')).toBe(false);
    expect(isOfflineSessionActive('char-1')).toBe(true);

    clearOfflineSession('char-1');

    expect(isOfflineSessionActive('char-1')).toBe(false);
  });

  it('persists custom word limits per character id', () => {
    saveOfflineWordLimit('char-1', { maxChars: 160 });

    expect(loadOfflineWordLimit('char-1')).toEqual({ maxChars: 160 });
    expect(loadOfflineWordLimit('char-2')).toEqual({});

    saveOfflineWordLimit('char-1', { maxChars: 5000 });
    expect(loadOfflineWordLimit('char-1')).toEqual({ maxChars: 5000 });

    saveOfflineWordLimit('char-1', {});
    expect(loadOfflineWordLimit('char-1')).toEqual({});
  });

  it('prepares generated takeout directives without leaking them into offline entries', () => {
    const result = prepareOfflineGeneratedText('千夜把袋子往桌边轻轻一放：“先喝点热的。”\n[[TAKEOUT_ORDER: 鲜虾干贝软糯海鲜粥]]');

    expect(result.takeoutDesc).toBe('鲜虾干贝软糯海鲜粥');
    expect(result.content).toBe('千夜把袋子往桌边轻轻一放：“先喝点热的。”');
    expect(result.content).not.toContain('TAKEOUT_ORDER');
  });

  it('commits offline sessions as concise event records without leaking follow-up rules', async () => {
    const char = { id: 'char-1', name: 'Mia', avatar: 'mia.png' } as CharacterProfile;

    const info = await commitOfflineSessionToContext(char, 'Me', [
      ...entries,
      { role: 'scene', text: '两个人说好先等外卖，外卖还没有到。', at: 4 },
    ]);

    expect(info?.messageId).toBeGreaterThan(0);
    expect(info?.timestamp).toBeGreaterThan(0);

    const messages = await DB.getMessagesByCharId('char-1', true);
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe(info?.messageId);
    expect(messages[0].timestamp).toBe(info?.timestamp);
    expect(messages[0].content).toContain('[线下模式记录]');
    expect(messages[0].content).toContain('你（Mia）和 Me 刚刚线下见面');
    expect(messages[0].content).toContain('现场简记如下');
    expect(messages[0].content).toContain('外卖还没有到');
    expect(messages[0].content).not.toContain('上下文');
    expect(messages[0].content).not.toContain('这不是要求');
    expect(messages[0].content).not.toContain('严格保持时间边界');
    expect(messages[0].content).not.toContain('外卖送达');
    expect(messages[0].content).not.toContain('总结报告');
  });

  it('generates offline openings with system-first messages so presets can apply', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: '门口的雨声轻了。' }, finish_reason: 'stop' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const char = {
      id: 'char-1',
      name: 'Mia',
      avatar: 'mia.png',
      systemPrompt: '安静，话少，但很细心。',
    } as CharacterProfile;
    const userProfile = { name: 'Me', avatar: 'me.png', bio: '喜欢雨天。' } as UserProfile;

    const result = await generateOfflineOpening(
      char,
      userProfile,
      { baseUrl: 'https://api.example.test/v1', apiKey: 'test-key', model: 'test-model' },
      DEFAULT_OFFLINE_POV,
      'Me 到 Mia 家门口见面。',
    );

    expect(result).toBe('门口的雨声轻了。');
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content).toContain('### [线下模式]');
    expect(body.messages[0].content).toContain('Me 到 Mia 家门口见面。');
    expect(body.messages[1]).toMatchObject({
      role: 'user',
      content: '请根据上面的全部规则，直接输出本轮线下现场正文，不要前缀或解释。',
    });
    expect(body.max_tokens).toBe(2400);
  });

  it('continues offline openings when the model response is cut by length', async () => {
    const queue = [
      { content: '深夜三点半，房间里只有手机屏幕的冷光，一个像素风的猫娘形象', finish_reason: 'length' },
      { content: '从屏幕边缘轻轻跳出来，尾巴扫过对话框。“我到了。”', finish_reason: 'stop' },
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

    const char = {
      id: 'char-1',
      name: 'Mia',
      avatar: 'mia.png',
      systemPrompt: '像素风猫娘。',
    } as CharacterProfile;
    const userProfile = { name: 'Me', avatar: 'me.png' } as UserProfile;

    const result = await generateOfflineOpening(
      char,
      userProfile,
      { baseUrl: 'https://api.example.test/v1', apiKey: 'test-key', model: 'test-model' },
      DEFAULT_OFFLINE_POV,
      'Me 点开了和 Mia 的线下面对面窗口。',
    );

    expect(result).toBe('深夜三点半，房间里只有手机屏幕的冷光，一个像素风的猫娘形象从屏幕边缘轻轻跳出来，尾巴扫过对话框。“我到了。”');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('adds custom word limits to offline generation prompts', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: '短短一段。' }, finish_reason: 'stop' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const char = {
      id: 'char-1',
      name: 'Mia',
      avatar: 'mia.png',
      systemPrompt: '安静，话少。',
    } as CharacterProfile;
    const userProfile = { name: 'Me', avatar: 'me.png' } as UserProfile;

    await generateOfflineOpening(
      char,
      userProfile,
      { baseUrl: 'https://api.example.test/v1', apiKey: 'test-key', model: 'test-model' },
      DEFAULT_OFFLINE_POV,
      'Me 到 Mia 家门口见面。',
      undefined,
      { maxChars: 90 },
    );

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    const prompt = body.messages[0].content;
    expect(prompt).toContain('写出见面那一刻的开场（不超过90字）');
    expect(prompt).toContain('字数上限是 90 字');
    expect(body.max_tokens).toBe(1290);
  });
});
