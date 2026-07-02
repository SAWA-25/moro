import { describe, expect, it } from 'vitest';
import type { Song } from '../context/MusicContext';
import {
    buildMusicPendingChatSharePayload,
    buildMusicShareSongSnapshot,
    normalizeMusicPendingChatSharePayload,
    songFromMusicShareSnapshot,
} from './musicShare';

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

describe('music chat share snapshots', () => {
    it('round-trips NetEase songs and keeps legacy songId', () => {
        const snapshot = buildMusicShareSongSnapshot(baseSong());
        const song = songFromMusicShareSnapshot(snapshot);

        expect(snapshot.id).toBe(101);
        expect(snapshot.songId).toBe(101);
        expect(song).toMatchObject({
            id: 101,
            name: '雨天样本',
            artists: 'Moro Band',
            album: 'Test Album',
        });
    });

    it('round-trips QQ Music playback fields', () => {
        const snapshot = buildMusicShareSongSnapshot(baseSong({
            id: -42,
            source: 'qq',
            qqSongMid: 'qq-song-mid',
            qqMediaMid: 'qq-media-mid',
            qqSongId: '123456',
        }));
        const song = songFromMusicShareSnapshot(snapshot);

        expect(song).toMatchObject({
            id: -42,
            source: 'qq',
            qqSongMid: 'qq-song-mid',
            qqMediaMid: 'qq-media-mid',
            qqSongId: '123456',
        });
    });

    it('round-trips local generated song fields', () => {
        const snapshot = buildMusicShareSongSnapshot(baseSong({
            source: 'local',
            local: true,
            localAssetKey: 'asset-1',
            localMimeType: 'audio/wav',
            localCoverStyle: 'linear-gradient(#111,#222)',
            customAuthorCharIds: ['char-a', 'char-b'],
            localLyrics: '[Verse]\n第一句\n第二句',
            lyricLineTimings: [0, 3.5],
        }));
        const song = songFromMusicShareSnapshot(snapshot);

        expect(song).toMatchObject({
            source: 'local',
            local: true,
            localAssetKey: 'asset-1',
            localMimeType: 'audio/wav',
            localLyrics: '[Verse]\n第一句\n第二句',
            lyricLineTimings: [0, 3.5],
        });
    });

    it('normalizes pending payloads and rejects invalid targets or empty songs', () => {
        const payload = buildMusicPendingChatSharePayload({
            song: baseSong(),
            targetId: 'char-a',
            userName: '用户',
            now: 123,
            id: 'music-share-test',
        });

        expect(normalizeMusicPendingChatSharePayload(payload, { validCharIds: ['char-a'] })?.id).toBe('music-share-test');
        expect(normalizeMusicPendingChatSharePayload(payload, { validCharIds: ['char-b'] })).toBeNull();
        expect(normalizeMusicPendingChatSharePayload({
            targetId: 'char-a',
            song: { id: 1, songId: 1, name: '   ' },
        }, { validCharIds: ['char-a'] })).toBeNull();
    });

    it('converts legacy songId-only card metadata to playable Song', () => {
        const song = songFromMusicShareSnapshot({
            songId: 456,
            name: '旧卡片',
            artists: 'Old Artist',
            album: '',
            albumPic: '',
            duration: 120,
            fee: 0,
        });

        expect(song).toMatchObject({
            id: 456,
            name: '旧卡片',
            artists: 'Old Artist',
        });
    });
});
