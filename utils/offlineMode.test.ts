import { beforeEach, describe, expect, it } from 'vitest';
import type { CharacterProfile } from '../types';
import { DB } from './db';
import {
  clearOfflineSession,
  commitOfflineSessionToContext,
  hasOfflineSession,
  loadOfflineSession,
  prepareOfflineGeneratedText,
  saveOfflineSession,
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

    saveOfflineSession('empty', []);

    expect(loadOfflineSession('empty')).toEqual([]);
    expect(hasOfflineSession('empty')).toBe(false);
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
});
