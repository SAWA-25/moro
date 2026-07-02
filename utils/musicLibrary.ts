import type { Song } from '../context/MusicContext';
import type {
  MusicLibraryPlaylist,
  MusicLibrarySource,
  MusicLibraryTrack,
  MusicPlaylistItem,
  MusicPlayEvent,
  MusicRecommendCacheEntry,
  MusicSearchHistoryItem,
} from '../types';
import { DB } from './db';

export type MusicPlaySource = NonNullable<MusicPlayEvent['playSource']>;

const MAX_SEARCH_HISTORY = 30;
const MAX_PLAY_EVENTS = 500;

const clean = (value: unknown, max = 300): string =>
  String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);

const finiteNumber = (value: unknown, fallback = 0): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const genId = (prefix: string, now = Date.now()) =>
  `${prefix}-${now}-${Math.random().toString(36).slice(2, 8)}`;

export const getSongLibrarySource = (song: Song): MusicLibrarySource => {
  if (song.source === 'qq') return 'qq';
  if (song.source === 'local' || song.local) return 'local';
  if (song.source === 'user') return 'user';
  if (song.source === 'discovered') return 'discovered';
  return 'netease';
};

export const getSongLibrarySourceId = (song: Song): string => {
  const source = getSongLibrarySource(song);
  if (source === 'qq') return clean(song.qqSongMid || song.qqSongId || song.qqMediaMid || song.id, 120);
  if (source === 'local') return clean(song.localAssetKey || song.id, 160);
  return clean(song.id, 120);
};

export const getSongLibraryTrackId = (song: Song): string => {
  const source = getSongLibrarySource(song);
  const sourceId = getSongLibrarySourceId(song) || clean(song.name || song.id, 120);
  return `${source}:${sourceId}`;
};

export function normalizeSongToTrack(song: Song, now = Date.now()): MusicLibraryTrack {
  const source = getSongLibrarySource(song);
  const sourceId = getSongLibrarySourceId(song) || String(song.id || now);
  return {
    id: `${source}:${sourceId}`,
    source,
    sourceId,
    numericId: Number.isFinite(song.id) ? song.id : undefined,
    name: clean(song.name, 160) || '未命名歌曲',
    artists: clean(song.artists, 220),
    album: clean(song.album, 220),
    albumPic: clean(song.albumPic, 1000),
    duration: Math.max(0, finiteNumber(song.duration, 0)),
    fee: finiteNumber(song.fee, 0),
    qqSongMid: song.qqSongMid,
    qqMediaMid: song.qqMediaMid,
    qqSongId: song.qqSongId,
    local: !!song.local,
    localAssetKey: song.localAssetKey,
    localMimeType: song.localMimeType,
    localCoverStyle: song.localCoverStyle,
    customAuthorCharIds: Array.isArray(song.customAuthorCharIds) ? song.customAuthorCharIds.slice(0, 20) : undefined,
    localLyrics: song.localLyrics,
    lyricLineTimings: Array.isArray(song.lyricLineTimings) ? song.lyricLineTimings.slice() : undefined,
    firstSeenAt: now,
    updatedAt: now,
  };
}

export function songFromTrack(track: MusicLibraryTrack): Song {
  return {
    id: track.numericId ?? stableNumericId(track.id),
    name: track.name,
    artists: track.artists,
    album: track.album,
    albumPic: track.albumPic,
    duration: track.duration,
    fee: track.fee,
    source: track.source,
    qqSongMid: track.qqSongMid,
    qqMediaMid: track.qqMediaMid,
    qqSongId: track.qqSongId,
    local: track.local,
    localAssetKey: track.localAssetKey,
    localMimeType: track.localMimeType,
    localCoverStyle: track.localCoverStyle,
    customAuthorCharIds: track.customAuthorCharIds,
    localLyrics: track.localLyrics,
    lyricLineTimings: track.lyricLineTimings,
  };
}

const stableNumericId = (key: string): number => {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = ((hash * 31) + key.charCodeAt(i)) | 0;
  return -Math.abs(hash || 1);
};

export async function upsertMusicTrack(song: Song, now = Date.now()): Promise<MusicLibraryTrack> {
  const next = normalizeSongToTrack(song, now);
  const prev = await DB.getMusicTrack(next.id).catch(() => null);
  const merged: MusicLibraryTrack = {
    ...next,
    ...pickPersistentTrackFields(prev),
    firstSeenAt: prev?.firstSeenAt || next.firstSeenAt,
    updatedAt: now,
  };
  await DB.saveMusicTrack(merged);
  return merged;
}

const pickPersistentTrackFields = (track: MusicLibraryTrack | null | undefined): Partial<MusicLibraryTrack> => {
  if (!track) return {};
  return {
    tags: track.tags,
    liked: track.liked,
    playCount: track.playCount,
    lastPlayedAt: track.lastPlayedAt,
  };
};

export async function recordMusicPlay(
  song: Song,
  options: {
    playSource?: MusicPlaySource;
    listenTogetherWith?: string[];
    now?: number;
  } = {},
): Promise<MusicPlayEvent> {
  const now = options.now ?? Date.now();
  const track = await upsertMusicTrack(song, now);
  const updatedTrack: MusicLibraryTrack = {
    ...track,
    playCount: (track.playCount || 0) + 1,
    lastPlayedAt: now,
    updatedAt: now,
  };
  await DB.saveMusicTrack(updatedTrack);
  const event: MusicPlayEvent = {
    id: genId('mplay', now),
    trackId: track.id,
    source: track.source,
    sourceId: track.sourceId,
    startedAt: now,
    duration: song.duration || track.duration,
    playSource: options.playSource || 'unknown',
    listenTogetherWith: options.listenTogetherWith?.slice(0, 20),
  };
  await DB.saveMusicPlayEvent(event);
  void trimPlayEvents();
  return event;
}

export async function finishMusicPlayEvent(
  eventId: string | null | undefined,
  details: { endedAt?: number; progress?: number; duration?: number } = {},
): Promise<void> {
  if (!eventId) return;
  const events = await DB.getAllMusicPlayEvents();
  const event = events.find(e => e.id === eventId);
  if (!event) return;
  const duration = Math.max(0, finiteNumber(details.duration ?? event.duration, 0));
  const progress = Math.max(0, finiteNumber(details.progress, 0));
  const completedRatio = duration > 0 ? Math.min(1, progress / duration) : undefined;
  await DB.saveMusicPlayEvent({
    ...event,
    endedAt: details.endedAt ?? Date.now(),
    progress,
    duration,
    completedRatio,
    completed: completedRatio !== undefined ? completedRatio >= 0.82 : undefined,
  });
}

export async function saveMusicSearch(keyword: string, resultCount = 0, now = Date.now()): Promise<MusicSearchHistoryItem | null> {
  const cleaned = clean(keyword, 80);
  if (!cleaned) return null;
  const id = cleaned.toLowerCase();
  const all = await DB.getAllMusicSearchHistory();
  const prev = all.find(item => item.id === id || item.keyword.toLowerCase() === id);
  const next: MusicSearchHistoryItem = {
    id,
    keyword: cleaned,
    resultCount,
    count: (prev?.count || 0) + 1,
    createdAt: prev?.createdAt || now,
    updatedAt: now,
  };
  await DB.saveMusicSearchHistoryItem(next);
  const overflow = [...all.filter(item => item.id !== id), next]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(MAX_SEARCH_HISTORY);
  await Promise.all(overflow.map(item => DB.deleteMusicSearchHistoryItem(item.id)));
  return next;
}

export async function listMusicSearchHistory(limit = 12): Promise<MusicSearchHistoryItem[]> {
  const all = await DB.getAllMusicSearchHistory();
  return all.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
}

export async function createMusicPlaylist(input: {
  title: string;
  description?: string;
  kind?: MusicLibraryPlaylist['kind'];
  source?: MusicLibraryPlaylist['source'];
  coverStyle?: string;
  now?: number;
}): Promise<MusicLibraryPlaylist> {
  const now = input.now ?? Date.now();
  const title = clean(input.title, 80) || '新歌单';
  const playlist: MusicLibraryPlaylist = {
    id: genId('mpl', now),
    kind: input.kind || 'user',
    title,
    description: clean(input.description, 300),
    source: input.source,
    coverStyle: input.coverStyle || `gradient-0${Math.floor(Math.random() * 6) + 1}`,
    trackCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  await DB.saveMusicPlaylist(playlist);
  return playlist;
}

export async function updateMusicPlaylist(
  id: string,
  updates: Partial<Pick<MusicLibraryPlaylist, 'title' | 'description' | 'coverUrl' | 'coverStyle' | 'pinned'>>,
  now = Date.now(),
): Promise<MusicLibraryPlaylist | null> {
  const prev = await DB.getMusicPlaylist(id);
  if (!prev) return null;
  const next: MusicLibraryPlaylist = {
    ...prev,
    ...updates,
    title: updates.title !== undefined ? clean(updates.title, 80) || prev.title : prev.title,
    description: updates.description !== undefined ? clean(updates.description, 300) : prev.description,
    updatedAt: now,
  };
  await DB.saveMusicPlaylist(next);
  return next;
}

export async function deleteMusicPlaylist(id: string): Promise<void> {
  const items = await DB.getAllMusicPlaylistItems();
  await Promise.all(items.filter(item => item.playlistId === id).map(item => DB.deleteMusicPlaylistItem(item.id)));
  await DB.deleteMusicPlaylist(id);
}

export async function addSongToMusicPlaylist(
  playlistId: string,
  song: Song,
  options: { source?: MusicPlaylistItem['source']; charId?: string; now?: number } = {},
): Promise<MusicPlaylistItem | null> {
  const playlist = await DB.getMusicPlaylist(playlistId);
  if (!playlist) return null;
  const now = options.now ?? Date.now();
  const track = await upsertMusicTrack(song, now);
  const items = await DB.getAllMusicPlaylistItems();
  const existing = items.find(item => item.playlistId === playlistId && item.trackId === track.id);
  if (existing) return existing;
  const position = Math.max(0, ...items.filter(item => item.playlistId === playlistId).map(item => item.position)) + 1;
  const item: MusicPlaylistItem = {
    id: `${playlistId}:${track.id}`,
    playlistId,
    trackId: track.id,
    position,
    source: options.source || 'user',
    charId: options.charId,
    addedAt: now,
  };
  await DB.saveMusicPlaylistItem(item);
  await DB.saveMusicPlaylist({
    ...playlist,
    coverUrl: playlist.coverUrl || track.albumPic,
    trackCount: (playlist.trackCount || 0) + 1,
    updatedAt: now,
  });
  return item;
}

export async function removeSongFromMusicPlaylist(playlistId: string, trackId: string): Promise<void> {
  const items = await DB.getAllMusicPlaylistItems();
  const item = items.find(entry => entry.playlistId === playlistId && entry.trackId === trackId);
  if (!item) return;
  await DB.deleteMusicPlaylistItem(item.id);
  const playlist = await DB.getMusicPlaylist(playlistId);
  if (playlist) {
    const nextCount = Math.max(0, (playlist.trackCount || 1) - 1);
    await DB.saveMusicPlaylist({ ...playlist, trackCount: nextCount, updatedAt: Date.now() });
  }
}

export async function getMusicPlaylistSongs(playlistId: string): Promise<Song[]> {
  const [items, tracks] = await Promise.all([
    DB.getAllMusicPlaylistItems(),
    DB.getAllMusicTracks(),
  ]);
  const trackMap = new Map(tracks.map(track => [track.id, track]));
  return items
    .filter(item => item.playlistId === playlistId)
    .sort((a, b) => a.position - b.position)
    .map(item => trackMap.get(item.trackId))
    .filter((track): track is MusicLibraryTrack => !!track)
    .map(songFromTrack);
}

export async function saveMusicRecommendCache(
  input: Omit<MusicRecommendCacheEntry, 'generatedAt' | 'expiresAt'> & { ttlMs?: number; now?: number },
): Promise<MusicRecommendCacheEntry> {
  const now = input.now ?? Date.now();
  const entry: MusicRecommendCacheEntry = {
    id: input.id,
    kind: input.kind,
    key: input.key,
    title: input.title,
    trackIds: input.trackIds,
    reason: input.reason,
    generatedAt: now,
    expiresAt: now + (input.ttlMs ?? 30 * 60 * 1000),
  };
  await DB.saveMusicRecommendCache(entry);
  return entry;
}

export async function getValidMusicRecommendCache(kind: MusicRecommendCacheEntry['kind'], key: string, now = Date.now()) {
  const all = await DB.getAllMusicRecommendCache();
  return all.find(entry => entry.kind === kind && entry.key === key && entry.expiresAt > now) || null;
}

export async function buildMusicLibrarySnapshot() {
  const [tracks, playlists, playlistItems, playEvents, searchHistory, recommendCache] = await Promise.all([
    DB.getAllMusicTracks(),
    DB.getAllMusicPlaylists(),
    DB.getAllMusicPlaylistItems(),
    DB.getAllMusicPlayEvents(),
    DB.getAllMusicSearchHistory(),
    DB.getAllMusicRecommendCache(),
  ]);
  return { tracks, playlists, playlistItems, playEvents, searchHistory, recommendCache };
}

export async function listRecentMusicSongs(limit = 30): Promise<Song[]> {
  const tracks = await DB.getAllMusicTracks();
  return tracks
    .filter(track => !!track.lastPlayedAt)
    .sort((a, b) => (b.lastPlayedAt || 0) - (a.lastPlayedAt || 0))
    .slice(0, limit)
    .map(songFromTrack);
}

export async function listLikedMusicSongs(limit = 100): Promise<Song[]> {
  const tracks = await DB.getAllMusicTracks();
  return tracks
    .filter(track => !!track.liked)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit)
    .map(songFromTrack);
}

export async function setMusicTrackLiked(song: Song, liked: boolean, now = Date.now()): Promise<MusicLibraryTrack> {
  const track = await upsertMusicTrack(song, now);
  const next = { ...track, liked, updatedAt: now };
  await DB.saveMusicTrack(next);
  return next;
}

async function trimPlayEvents(): Promise<void> {
  const events = await DB.getAllMusicPlayEvents().catch(() => []);
  if (events.length <= MAX_PLAY_EVENTS) return;
  const overflow = events.sort((a, b) => b.startedAt - a.startedAt).slice(MAX_PLAY_EVENTS);
  await Promise.all(overflow.map(event => DB.deleteMusicPlayEvent(event.id)));
}
