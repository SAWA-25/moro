import { describe, expect, it } from 'vitest';
import {
  QQ_MUSIC_LIKES_STORAGE_KEY,
  getQQMusicLikeAccountKey,
  getQQMusicLikeSongKey,
  isQQMusicSongLiked,
  loadQQMusicLikeEntries,
  loadQQMusicLikedKeys,
  setQQMusicSongLiked,
  toggleQQMusicSongLiked,
  type StorageLike,
} from './musicQQLikes';

const makeStorage = (): StorageLike & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
  };
};

const song = {
  id: -1,
  source: 'qq',
  name: '晴天',
  artists: '周杰伦',
  album: '叶惠美',
  albumPic: 'https://example.com/cover.jpg',
  duration: 269,
  qqSongMid: '0039MnYb0qxYhV',
  qqMediaMid: '0039MnYb0qxYhV',
  qqSongId: 97773,
} as const;

describe('musicQQLikes', () => {
  it('builds stable account and song keys', () => {
    expect(getQQMusicLikeAccountKey(' 12345 ')).toBe('uin:12345');
    expect(getQQMusicLikeAccountKey('')).toBe('local');
    expect(getQQMusicLikeSongKey(song)).toBe('songmid:0039MnYb0qxYhV');
    expect(getQQMusicLikeSongKey({ ...song, qqSongMid: '', qqMediaMid: 'media-1' })).toBe('media:media-1');
    expect(getQQMusicLikeSongKey({ ...song, source: 'netease' })).toBe('');
  });

  it('persists add and remove operations with song metadata', () => {
    const storage = makeStorage();
    const accountKey = getQQMusicLikeAccountKey('10001');

    const liked = setQQMusicSongLiked(song, accountKey, true, storage, 1710000000000);
    expect(liked.liked).toBe(true);
    expect(loadQQMusicLikedKeys(accountKey, storage).has('songmid:0039MnYb0qxYhV')).toBe(true);
    expect(loadQQMusicLikeEntries(accountKey, storage)[0]).toMatchObject({
      key: 'songmid:0039MnYb0qxYhV',
      name: '晴天',
      artists: '周杰伦',
      likedAt: 1710000000000,
    });

    setQQMusicSongLiked(song, accountKey, false, storage, 1710000001000);
    expect(isQQMusicSongLiked(song, accountKey, storage)).toBe(false);
    expect(loadQQMusicLikeEntries(accountKey, storage)).toHaveLength(0);
  });

  it('keeps different QQ accounts isolated', () => {
    const storage = makeStorage();
    setQQMusicSongLiked(song, getQQMusicLikeAccountKey('10001'), true, storage, 1);

    expect(isQQMusicSongLiked(song, getQQMusicLikeAccountKey('10001'), storage)).toBe(true);
    expect(isQQMusicSongLiked(song, getQQMusicLikeAccountKey('20002'), storage)).toBe(false);
  });

  it('toggles the same song without duplicating entries', () => {
    const storage = makeStorage();
    const accountKey = getQQMusicLikeAccountKey('10001');

    expect(toggleQQMusicSongLiked(song, accountKey, storage, 1).liked).toBe(true);
    expect(toggleQQMusicSongLiked(song, accountKey, storage, 2).liked).toBe(false);
    expect(toggleQQMusicSongLiked(song, accountKey, storage, 3).liked).toBe(true);
    expect(loadQQMusicLikeEntries(accountKey, storage)).toHaveLength(1);
    expect(JSON.parse(storage.data.get(QQ_MUSIC_LIKES_STORAGE_KEY) || '{}').version).toBe(1);
  });

  it('recovers from malformed storage data', () => {
    const storage = makeStorage();
    storage.setItem(QQ_MUSIC_LIKES_STORAGE_KEY, '{broken');

    expect(loadQQMusicLikeEntries(getQQMusicLikeAccountKey('10001'), storage)).toEqual([]);
  });
});
