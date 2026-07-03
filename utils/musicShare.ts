import type { MusicCfg, Song } from '../context/MusicContext';
import { musicApi, parseLyric } from '../context/MusicContext';
import { getCharLyricSnippet } from './charLyricCache';
import { lyricLinesFromRaw, lyricLinesFromTimedLines } from './musicLyricContext';

export const MUSIC_PENDING_CHAT_SHARE_KEY = 'moro_music_pending_chat_share_v1';

export type MusicShareMode = 'user_to_char';

export interface MusicShareSongSnapshot {
    /** New canonical id. */
    id: number;
    /** Legacy chat-card id kept for older renderers/context formatters. */
    songId: number;
    name: string;
    artists: string;
    album: string;
    albumPic: string;
    duration: number;
    fee: number;
    source?: Song['source'];
    qqSongMid?: string;
    qqMediaMid?: string;
    qqSongId?: string | number;
    local?: boolean;
    localAssetKey?: string;
    localMimeType?: string;
    localCoverStyle?: string;
    customAuthorCharIds?: string[];
    localLyrics?: string;
    lyricLineTimings?: number[];
}

export interface MusicPendingChatSharePayload {
    id: string;
    targetId: string;
    charId: string;
    shareMode: MusicShareMode;
    song: MusicShareSongSnapshot;
    createdAt: number;
    userName?: string;
}

type NormalizeOptions = string[] | {
    validCharIds?: string[];
};

const isPlainObject = (value: unknown): value is Record<string, any> => (
    !!value && typeof value === 'object' && !Array.isArray(value)
);

const cleanText = (value: unknown, max = 240): string => {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, Math.max(0, max - 1)).trim()}…` : text;
};

const cleanLongText = (value: unknown, max = 5000): string | undefined => {
    if (typeof value !== 'string') return undefined;
    const text = value.trim();
    if (!text) return undefined;
    return text.length > max ? text.slice(0, max) : text;
};

const finiteNumber = (value: unknown, fallback = 0): number => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
};

const normalizeSource = (value: unknown): Song['source'] | undefined => {
    return value === 'netease' || value === 'qq' || value === 'local' || value === 'user' || value === 'discovered'
        ? value
        : undefined;
};

const cleanStringArray = (value: unknown, max = 12): string[] | undefined => {
    if (!Array.isArray(value)) return undefined;
    const arr = value.map(v => cleanText(v, 80)).filter(Boolean).slice(0, max);
    return arr.length ? arr : undefined;
};

const cleanNumberArray = (value: unknown, max = 500): number[] | undefined => {
    if (!Array.isArray(value)) return undefined;
    const arr = value.map(v => finiteNumber(v, NaN)).filter(Number.isFinite).slice(0, max);
    return arr.length ? arr : undefined;
};

export function normalizeMusicShareSongSnapshot(input: unknown): MusicShareSongSnapshot | null {
    if (!isPlainObject(input)) return null;
    const id = finiteNumber(input.id ?? input.songId, NaN);
    if (!Number.isFinite(id)) return null;
    const name = cleanText(input.name, 120);
    if (!name) return null;
    const source = normalizeSource(input.source) || (input.local || input.localAssetKey ? 'local' : undefined);
    const localAssetKey = cleanText(input.localAssetKey, 240) || undefined;
    const localMimeType = cleanText(input.localMimeType, 120) || undefined;
    return {
        id,
        songId: finiteNumber(input.songId ?? input.id, id),
        name,
        artists: cleanText(input.artists, 180),
        album: cleanText(input.album, 180),
        albumPic: typeof input.albumPic === 'string' ? input.albumPic.trim().slice(0, 1200) : '',
        duration: Math.max(0, finiteNumber(input.duration, 0)),
        fee: Math.max(0, finiteNumber(input.fee, 0)),
        source,
        qqSongMid: cleanText(input.qqSongMid, 120) || undefined,
        qqMediaMid: cleanText(input.qqMediaMid, 120) || undefined,
        qqSongId: typeof input.qqSongId === 'number' || typeof input.qqSongId === 'string' ? input.qqSongId : undefined,
        local: Boolean(input.local || source === 'local' || localAssetKey),
        localAssetKey,
        localMimeType,
        localCoverStyle: cleanText(input.localCoverStyle, 400) || undefined,
        customAuthorCharIds: cleanStringArray(input.customAuthorCharIds),
        localLyrics: cleanLongText(input.localLyrics),
        lyricLineTimings: cleanNumberArray(input.lyricLineTimings),
    };
}

export function buildMusicShareSongSnapshot(song: Song): MusicShareSongSnapshot {
    const id = finiteNumber(song.id, 0);
    return normalizeMusicShareSongSnapshot({
        id,
        songId: id,
        name: song.name,
        artists: song.artists,
        album: song.album,
        albumPic: song.albumPic,
        duration: song.duration,
        fee: song.fee,
        source: song.source,
        qqSongMid: song.qqSongMid,
        qqMediaMid: song.qqMediaMid,
        qqSongId: song.qqSongId,
        local: song.local,
        localAssetKey: song.localAssetKey,
        localMimeType: song.localMimeType,
        localCoverStyle: song.localCoverStyle,
        customAuthorCharIds: song.customAuthorCharIds,
        localLyrics: song.localLyrics,
        lyricLineTimings: song.lyricLineTimings,
    })!;
}

export const songToMusicShareMetadata = buildMusicShareSongSnapshot;

export function songFromMusicShareSnapshot(input: unknown): Song | null {
    const snapshot = normalizeMusicShareSongSnapshot(input);
    if (!snapshot) return null;
    return {
        id: snapshot.id,
        name: snapshot.name,
        artists: snapshot.artists,
        album: snapshot.album,
        albumPic: snapshot.albumPic,
        duration: snapshot.duration,
        fee: snapshot.fee,
        source: snapshot.source,
        qqSongMid: snapshot.qqSongMid,
        qqMediaMid: snapshot.qqMediaMid,
        qqSongId: snapshot.qqSongId,
        local: snapshot.local,
        localAssetKey: snapshot.localAssetKey,
        localMimeType: snapshot.localMimeType,
        localCoverStyle: snapshot.localCoverStyle,
        customAuthorCharIds: snapshot.customAuthorCharIds,
        localLyrics: snapshot.localLyrics,
        lyricLineTimings: snapshot.lyricLineTimings,
    };
}

export const songFromMusicShareMetadata = songFromMusicShareSnapshot;

export function buildMusicPendingChatSharePayload(args: {
    song: Song;
    targetId: string;
    userName?: string;
    now?: number;
    id?: string;
}): MusicPendingChatSharePayload {
    const now = args.now ?? Date.now();
    const targetId = cleanText(args.targetId, 120);
    return {
        id: args.id || `music-share-${now}-${Math.random().toString(36).slice(2, 8)}`,
        targetId,
        charId: targetId,
        shareMode: 'user_to_char',
        song: buildMusicShareSongSnapshot(args.song),
        createdAt: now,
        userName: cleanText(args.userName, 80) || undefined,
    };
}

export function normalizeMusicPendingChatSharePayload(
    input: unknown,
    opts?: NormalizeOptions,
): MusicPendingChatSharePayload | null {
    if (!isPlainObject(input)) return null;
    const validCharIds = Array.isArray(opts) ? opts : opts?.validCharIds;
    const targetId = cleanText(input.targetId || input.charId, 120);
    if (!targetId) return null;
    if (validCharIds && !validCharIds.includes(targetId)) return null;
    const song = normalizeMusicShareSongSnapshot(input.song || input.snapshot || input.metadata?.song);
    if (!song) return null;
    return {
        id: cleanText(input.id, 120) || `music-share-${Date.now()}`,
        targetId,
        charId: targetId,
        shareMode: 'user_to_char',
        song,
        createdAt: finiteNumber(input.createdAt, Date.now()),
        userName: cleanText(input.userName, 80) || undefined,
    };
}

export async function lyricPreviewFromMusicShareSong(
    songInput: Song | MusicShareSongSnapshot | unknown,
    cfg?: MusicCfg | null,
    options: { seed?: string; lineCount?: number } = {},
): Promise<string[]> {
    const song = songFromMusicShareSnapshot(songInput);
    if (!song) return [];
    const lineCount = options.lineCount ?? 4;
    if (lineCount <= 0) return [];

    if (song.localLyrics) {
        return lyricLinesFromRaw(song.localLyrics, { lineCount });
    }

    if (!cfg) return [];

    if (song.source === 'qq') {
        const songmid = String(song.qqSongMid || song.qqMediaMid || '').trim();
        if (!songmid) return [];
        try {
            const res = await musicApi.qqLyric(cfg, songmid);
            const raw = res?.data?.lyric || res?.lyric || '';
            const parsed = lyricLinesFromTimedLines(parseLyric(raw), { lineCount });
            return parsed.length ? parsed : lyricLinesFromRaw(raw, { lineCount });
        } catch {
            return [];
        }
    }

    if (song.source === 'local') return [];
    try {
        const snippet = await getCharLyricSnippet(cfg, song.id, options.seed || `music-share-${song.id}`, lineCount);
        return lyricLinesFromTimedLines(snippet, { lineCount });
    } catch {
        return [];
    }
}
