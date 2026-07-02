import { beforeEach, describe, expect, it } from 'vitest';
import type { Song } from '../context/MusicContext';
import { DB } from './db';
import {
  addSongToMusicPlaylist,
  createMusicPlaylist,
  getMusicPlaylistSongs,
  getSongLibraryTrackId,
  listMusicSearchHistory,
  normalizeSongToTrack,
  recordMusicPlay,
  removeSongFromMusicPlaylist,
  saveMusicSearch,
  songFromTrack,
  upsertMusicTrack,
} from './musicLibrary';

const baseSong = (overrides: Partial<Song> = {}): Song => ({
  id: 101,
  name: '雨天样本',
  artists: 'Moro Band',
  album: 'Test Album',
  albumPic: 'https://example.com/cover.jpg',
  duration: 198,
  fee: 0,
  ...overrides,
});

describe('music library', () => {
  beforeEach(async () => {
    await DB.deleteDB();
  });

  it('normalizes NetEase, QQ and local songs to stable track ids', () => {
    expect(getSongLibraryTrackId(baseSong())).toBe('netease:101');
    expect(getSongLibraryTrackId(baseSong({ source: 'qq', qqSongMid: '003abc', id: -1 }))).toBe('qq:003abc');
    expect(getSongLibraryTrackId(baseSong({ source: 'local', local: true, localAssetKey: 'asset-a' }))).toBe('local:asset-a');

    const track = normalizeSongToTrack(baseSong({ source: 'qq', qqSongMid: '003abc', qqMediaMid: 'media-a' }), 123);
    expect(track).toMatchObject({ id: 'qq:003abc', source: 'qq', firstSeenAt: 123, qqMediaMid: 'media-a' });
    expect(songFromTrack(track)).toMatchObject({ source: 'qq', qqSongMid: '003abc' });
  });

  it('upserts tracks without losing local library fields', async () => {
    const first = await upsertMusicTrack(baseSong(), 100);
    await DB.saveMusicTrack({ ...first, liked: true, playCount: 3, lastPlayedAt: 150 });

    const second = await upsertMusicTrack(baseSong({ album: 'New Album' }), 200);
    expect(second.firstSeenAt).toBe(100);
    expect(second.album).toBe('New Album');
    expect(second.liked).toBe(true);
    expect(second.playCount).toBe(3);
    expect(second.lastPlayedAt).toBe(150);
  });

  it('records play events and updates play count', async () => {
    const event = await recordMusicPlay(baseSong(), { playSource: 'discover', listenTogetherWith: ['char-a'], now: 300 });
    const tracks = await DB.getAllMusicTracks();
    const events = await DB.getAllMusicPlayEvents();

    expect(event.trackId).toBe('netease:101');
    expect(event.playSource).toBe('discover');
    expect(event.listenTogetherWith).toEqual(['char-a']);
    expect(tracks[0]).toMatchObject({ id: 'netease:101', playCount: 1, lastPlayedAt: 300 });
    expect(events).toHaveLength(1);
  });

  it('creates playlists and adds/removes songs without deleting tracks', async () => {
    const playlist = await createMusicPlaylist({ title: '深夜歌单', now: 100 });
    await addSongToMusicPlaylist(playlist.id, baseSong(), { now: 120 });

    expect(await getMusicPlaylistSongs(playlist.id)).toHaveLength(1);
    await removeSongFromMusicPlaylist(playlist.id, 'netease:101');

    expect(await getMusicPlaylistSongs(playlist.id)).toHaveLength(0);
    expect(await DB.getMusicTrack('netease:101')).not.toBeNull();
  });

  it('deduplicates search history and keeps newest first', async () => {
    await saveMusicSearch('晴天', 3, 100);
    await saveMusicSearch('稻香', 2, 120);
    await saveMusicSearch('晴天', 4, 140);

    const history = await listMusicSearchHistory();
    expect(history.map(item => item.keyword)).toEqual(['晴天', '稻香']);
    expect(history[0]).toMatchObject({ count: 2, resultCount: 4, updatedAt: 140 });
  });
});
