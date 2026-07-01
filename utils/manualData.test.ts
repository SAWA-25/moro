import { describe, expect, it } from 'vitest';
import { getManualUpdateNotices, MANUAL_UPDATE_NOTICES } from '../apps/manual/manualData';
import {
  getLatestManualUpdateNotice,
  getPendingManualUpdateNotice,
  getPendingManualUpdateNotices,
  MANUAL_UPDATE_NOTICE_SEEN_KEY,
  markManualUpdateNoticeSeen,
} from './manualUpdateNotice';

const fakeStorage = () => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
  };
};

describe('manual update notices', () => {
  it('uses unique ids', () => {
    const ids = MANUAL_UPDATE_NOTICES.map(notice => notice.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has complete user-facing content', () => {
    for (const notice of MANUAL_UPDATE_NOTICES) {
      expect(notice.id.trim()).toBeTruthy();
      expect(Number.isNaN(Date.parse(notice.date))).toBe(false);
      expect(notice.title.trim()).toBeTruthy();
      expect(notice.summary.trim()).toBeTruthy();
      expect(notice.items.length).toBeGreaterThan(0);
      expect(notice.items.every(item => item.trim().length > 0)).toBe(true);
    }
  });

  it('returns notices newest first', () => {
    const sorted = getManualUpdateNotices();

    for (let i = 1; i < sorted.length; i += 1) {
      expect(Date.parse(sorted[i - 1].date)).toBeGreaterThanOrEqual(Date.parse(sorted[i].date));
    }
  });

  it('queues every unseen notice once', () => {
    const storage = fakeStorage();
    const latest = getLatestManualUpdateNotice();
    expect(latest).toBeTruthy();

    expect(getPendingManualUpdateNotices(storage).map(notice => notice.id)).toEqual(
      getManualUpdateNotices().map(notice => notice.id),
    );
    expect(getPendingManualUpdateNotice(storage)?.id).toBe(latest!.id);
    markManualUpdateNoticeSeen(latest!.id, storage);

    expect(JSON.parse(storage.getItem(MANUAL_UPDATE_NOTICE_SEEN_KEY) || '[]')).toContain(latest!.id);
    expect(getPendingManualUpdateNotices(storage).some(notice => notice.id === latest!.id)).toBe(false);
    expect(getPendingManualUpdateNotices(storage).length).toBe(Math.max(0, MANUAL_UPDATE_NOTICES.length - 1));
  });

  it('does not queue already-read notices again on later checks', () => {
    const storage = fakeStorage();
    for (const notice of getManualUpdateNotices()) {
      markManualUpdateNoticeSeen(notice.id, storage);
    }

    expect(getPendingManualUpdateNotice(storage)).toBeNull();
    expect(getPendingManualUpdateNotices(storage)).toEqual([]);
  });

  it('keeps legacy single-id seen storage compatible', () => {
    const storage = fakeStorage();
    const latest = getLatestManualUpdateNotice();
    expect(latest).toBeTruthy();
    storage.setItem(MANUAL_UPDATE_NOTICE_SEEN_KEY, latest!.id);

    expect(getPendingManualUpdateNotices(storage).some(notice => notice.id === latest!.id)).toBe(false);
  });
});
