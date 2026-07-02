import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearOfflineSession,
  hasOfflineSession,
  loadOfflineSession,
  saveOfflineSession,
  type OfflineEntry,
} from './offlineMode';

const entries: OfflineEntry[] = [
  { role: 'scene', text: '雨停在门口。', at: 1 },
  { role: 'char', text: '你来了。', at: 2 },
  { role: 'user', text: '我把伞收起来。', at: 3 },
];

describe('offline mode draft sessions', () => {
  beforeEach(() => {
    localStorage.clear();
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
});
