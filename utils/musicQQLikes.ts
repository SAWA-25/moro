export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface QQMusicLikeSongLike {
  id?: number | string;
  source?: string;
  name?: string;
  artists?: string;
  album?: string;
  albumPic?: string;
  duration?: number;
  qqSongMid?: string;
  qqMediaMid?: string;
  qqSongId?: string | number;
}

export interface QQMusicLikeEntry {
  key: string;
  songmid?: string;
  mediaMid?: string;
  qqSongId?: string | number;
  id?: number | string;
  name: string;
  artists: string;
  album: string;
  albumPic: string;
  duration: number;
  likedAt: number;
}

interface QQMusicLikeStore {
  version: 1;
  accounts: Record<string, QQMusicLikeEntry[]>;
}

export const QQ_MUSIC_LIKES_STORAGE_KEY = 'moro_music_qq_likes_v1';
const DEFAULT_ACCOUNT_KEY = 'local';

const clean = (value: unknown): string => String(value ?? '').trim();

const browserStorage = (): StorageLike | null => {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
};

export const getQQMusicLikeAccountKey = (uin?: string | number | null): string => {
  const value = clean(uin);
  return value ? `uin:${value}` : DEFAULT_ACCOUNT_KEY;
};

export const getQQMusicLikeSongKey = (song: QQMusicLikeSongLike | null | undefined): string => {
  if (!song || song.source !== 'qq') return '';
  const songmid = clean(song.qqSongMid);
  if (songmid) return `songmid:${songmid}`;
  const mediaMid = clean(song.qqMediaMid);
  if (mediaMid) return `media:${mediaMid}`;
  const qqSongId = clean(song.qqSongId);
  if (qqSongId) return `songid:${qqSongId}`;
  const id = clean(song.id);
  return id ? `id:${id}` : '';
};

const emptyStore = (): QQMusicLikeStore => ({ version: 1, accounts: {} });

const normalizeEntry = (entry: any): QQMusicLikeEntry | null => {
  const key = clean(entry?.key);
  if (!key) return null;
  return {
    key,
    songmid: clean(entry?.songmid) || undefined,
    mediaMid: clean(entry?.mediaMid) || undefined,
    qqSongId: entry?.qqSongId,
    id: entry?.id,
    name: clean(entry?.name),
    artists: clean(entry?.artists),
    album: clean(entry?.album),
    albumPic: clean(entry?.albumPic),
    duration: Number(entry?.duration || 0) || 0,
    likedAt: Number(entry?.likedAt || 0) || 0,
  };
};

export const readQQMusicLikeStore = (storage: StorageLike | null = browserStorage()): QQMusicLikeStore => {
  if (!storage) return emptyStore();
  try {
    const raw = storage.getItem(QQ_MUSIC_LIKES_STORAGE_KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw);
    const accounts = parsed?.accounts && typeof parsed.accounts === 'object' ? parsed.accounts : {};
    const normalized: Record<string, QQMusicLikeEntry[]> = {};
    for (const [accountKey, entries] of Object.entries(accounts)) {
      if (!Array.isArray(entries)) continue;
      const seen = new Set<string>();
      normalized[accountKey] = entries
        .map(normalizeEntry)
        .filter((entry): entry is QQMusicLikeEntry => {
          if (!entry || seen.has(entry.key)) return false;
          seen.add(entry.key);
          return true;
        });
    }
    return { version: 1, accounts: normalized };
  } catch {
    return emptyStore();
  }
};

const writeQQMusicLikeStore = (
  store: QQMusicLikeStore,
  storage: StorageLike | null = browserStorage(),
): void => {
  if (!storage) throw new Error('本地存储不可用');
  storage.setItem(QQ_MUSIC_LIKES_STORAGE_KEY, JSON.stringify(store));
};

export const loadQQMusicLikeEntries = (
  accountKey: string,
  storage: StorageLike | null = browserStorage(),
): QQMusicLikeEntry[] => {
  const store = readQQMusicLikeStore(storage);
  return [...(store.accounts[accountKey || DEFAULT_ACCOUNT_KEY] || [])];
};

export const loadQQMusicLikedKeys = (
  accountKey: string,
  storage: StorageLike | null = browserStorage(),
): Set<string> => new Set(loadQQMusicLikeEntries(accountKey, storage).map(entry => entry.key));

export const isQQMusicSongLiked = (
  song: QQMusicLikeSongLike | null | undefined,
  accountKey: string,
  storage: StorageLike | null = browserStorage(),
): boolean => {
  const key = getQQMusicLikeSongKey(song);
  return !!key && loadQQMusicLikedKeys(accountKey, storage).has(key);
};

const makeEntry = (song: QQMusicLikeSongLike, key: string, likedAt: number): QQMusicLikeEntry => ({
  key,
  songmid: clean(song.qqSongMid) || undefined,
  mediaMid: clean(song.qqMediaMid) || undefined,
  qqSongId: song.qqSongId,
  id: song.id,
  name: clean(song.name),
  artists: clean(song.artists),
  album: clean(song.album),
  albumPic: clean(song.albumPic),
  duration: Number(song.duration || 0) || 0,
  likedAt,
});

export const setQQMusicSongLiked = (
  song: QQMusicLikeSongLike,
  accountKey: string,
  liked: boolean,
  storage: StorageLike | null = browserStorage(),
  now: number = Date.now(),
): { key: string; liked: boolean; entries: QQMusicLikeEntry[] } => {
  const key = getQQMusicLikeSongKey(song);
  if (!key) throw new Error('这首 QQ 音乐缺少收藏标识');

  const normalizedAccountKey = accountKey || DEFAULT_ACCOUNT_KEY;
  const store = readQQMusicLikeStore(storage);
  const existing = store.accounts[normalizedAccountKey] || [];
  const withoutSong = existing.filter(entry => entry.key !== key);
  const entries = liked ? [makeEntry(song, key, now), ...withoutSong] : withoutSong;
  store.accounts[normalizedAccountKey] = entries;
  writeQQMusicLikeStore(store, storage);
  return { key, liked, entries };
};

export const toggleQQMusicSongLiked = (
  song: QQMusicLikeSongLike,
  accountKey: string,
  storage: StorageLike | null = browserStorage(),
  now: number = Date.now(),
): { key: string; liked: boolean; entries: QQMusicLikeEntry[] } => {
  const key = getQQMusicLikeSongKey(song);
  if (!key) throw new Error('这首 QQ 音乐缺少收藏标识');
  const liked = !loadQQMusicLikedKeys(accountKey, storage).has(key);
  return setQQMusicSongLiked(song, accountKey, liked, storage, now);
};
