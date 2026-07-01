import {
  getManualUpdateNotices,
  type ManualUpdateNotice,
} from '../apps/manual/manualData';

export const MANUAL_UPDATE_NOTICE_SEEN_KEY = 'moro_manual_update_notice_seen_v1';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

const browserStorage = (): StorageLike | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

const readSeenIds = (storage: StorageLike | null = browserStorage()): Set<string> => {
  const seen = new Set<string>();
  if (!storage) return seen;
  try {
    const raw = storage.getItem(MANUAL_UPDATE_NOTICE_SEEN_KEY) || '';
    if (!raw) return seen;
    if (raw.trim().startsWith('[')) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        parsed.forEach(id => {
          if (typeof id === 'string' && id.trim()) seen.add(id.trim());
        });
        return seen;
      }
    }
    raw.split(',').forEach(id => {
      if (id.trim()) seen.add(id.trim());
    });
  } catch {
    return seen;
  }
  return seen;
};

export const getLatestManualUpdateNotice = (): ManualUpdateNotice | null =>
  getManualUpdateNotices()[0] || null;

export const getPendingManualUpdateNotices = (
  storage: StorageLike | null = browserStorage(),
): ManualUpdateNotice[] => {
  const seen = readSeenIds(storage);
  return getManualUpdateNotices().filter(notice => !seen.has(notice.id));
};

export const getPendingManualUpdateNotice = (
  storage: StorageLike | null = browserStorage(),
): ManualUpdateNotice | null => getPendingManualUpdateNotices(storage)[0] || null;

export const markManualUpdateNoticeSeen = (
  noticeId: string,
  storage: StorageLike | null = browserStorage(),
) => {
  if (!noticeId || !storage) return;
  try {
    const seen = readSeenIds(storage);
    seen.add(noticeId);
    storage.setItem(MANUAL_UPDATE_NOTICE_SEEN_KEY, JSON.stringify([...seen]));
  } catch {
    // Ignore storage failures; the popup is still dismissible for this session.
  }
};
