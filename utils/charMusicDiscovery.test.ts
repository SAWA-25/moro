import { describe, expect, it } from 'vitest';
import type { CharacterProfile, CharMusicProfile, CharPlaylistSong, DailySchedule } from '../types';
import {
  buildPlaylistSearchRequests,
  collectCharacterMusicInterestTerms,
  pickDiversePlaylistSongs,
  type PlaylistSongCandidate,
} from './charMusicDiscovery';

const char: CharacterProfile = {
  id: 'char-music',
  name: '林夏',
  avatar: '',
  description: '',
  systemPrompt: '她喜欢摄影、胶片相机、雨天写诗，也经常打 RPG 游戏。性格慢热，常在咖啡馆写作。',
  worldview: '城市里有很多旧书店和海边车站。',
  memories: [],
  lifeProfile: { content: '日常会带相机出门，夜里读小说，偶尔玩主机游戏。', generatedAt: 1 },
};

const profile: CharMusicProfile = {
  bio: '我把旧照片听成歌。',
  genreTags: ['city pop', '后摇', '独立民谣', 'J-rock', 'lofi'],
  signatureArtists: [
    { name: '陈绮贞' },
    { name: '落日飞车' },
    { name: '草东没有派对' },
    { name: '宇多田光' },
    { name: '王菲' },
  ],
  playlists: [
    { id: 'pl-a', title: '雨天暗房', description: '冲洗胶片时听。', coverStyle: 'gradient-01', songs: [], mood: 'dreamy', createdAt: 1, updatedAt: 1 },
    { id: 'pl-b', title: '夜车打怪', description: '长途车和游戏存档点。', coverStyle: 'gradient-02', songs: [], mood: 'epic', createdAt: 1, updatedAt: 1 },
    { id: 'pl-c', title: '咖啡馆写诗', description: '给慢吞吞的下午。', coverStyle: 'gradient-03', songs: [], mood: 'chill', createdAt: 1, updatedAt: 1 },
  ],
  likedSongIds: [],
  recentPlays: [],
  initializedAt: 1,
  updatedAt: 1,
};

const song = (id: number, name: string, artists: string, album = ''): CharPlaylistSong => ({
  id,
  name,
  artists,
  album,
  albumPic: '',
  duration: 180,
  fee: 0,
});

describe('char music discovery', () => {
  it('extracts character hobbies as music discovery terms', () => {
    const terms = collectCharacterMusicInterestTerms(char);

    expect(terms.join(' ')).toContain('胶片');
    expect(terms.join(' ')).toContain('游戏音乐');
    expect(terms.join(' ')).toContain('爵士');
  });

  it('builds playlist-specific search requests from playlist, taste, and rotated artists', () => {
    const a = buildPlaylistSearchRequests(char, profile, profile.playlists[0]).map(r => r.keyword);
    const b = buildPlaylistSearchRequests(char, profile, profile.playlists[1]).map(r => r.keyword);

    expect(a.join(' ')).toContain('雨天暗房');
    expect(a.join(' ')).toContain('陈绮贞');
    expect(a.join(' ')).toContain('胶片');
    expect(b.join(' ')).toContain('夜车打怪');
    expect(b.join(' ')).toContain('草东没有派对');
    expect(a.slice(0, 8)).not.toEqual(b.slice(0, 8));
  });

  it('includes recent plays, current listening, and schedule context in search seeds', () => {
    const schedule: DailySchedule = {
      id: 'char-music-2026-06-30',
      charId: char.id,
      date: '2026-06-30',
      generatedAt: 1,
      slots: [
        {
          startTime: '20:00',
          endTime: '22:00',
          activity: '深夜写作',
          description: '在咖啡馆赶稿',
          location: '咖啡馆',
          mood: '专注',
          innerThought: '今天想听点安静的歌。',
        },
      ],
    };
    const seededProfile: CharMusicProfile = {
      ...profile,
      recentPlays: [
        { song: song(11, '昨日', '王菲'), at: 10, context: '雨天散步' },
        { song: song(12, '旅行', '落日飞车'), at: 20, context: '坐地铁回家' },
      ],
      currentListening: {
        songId: 12,
        songName: '旅行',
        artists: '落日飞车',
        albumPic: '',
        vibe: '准备继续听点氛围的。',
        startedAt: 1,
      },
    };

    const requests = buildPlaylistSearchRequests(char, seededProfile, seededProfile.playlists[0], {
      schedule,
      now: new Date('2026-06-30T20:30:00+08:00'),
      currentListening: seededProfile.currentListening,
    }).map(r => r.keyword);

    expect(requests.join(' ')).toContain('旅行');
    expect(requests.join(' ')).toContain('落日飞车');
    expect(requests.join(' ')).toContain('咖啡馆');
    expect(requests.join(' ')).toContain('写作');
  });

  it('picks diverse songs, removes used songs, and prefers character taste matches', () => {
    const request = buildPlaylistSearchRequests(char, profile, profile.playlists[0])[0];
    const candidates: PlaylistSongCandidate[] = [
      { song: song(1, '已在别处', '陈绮贞'), request, rank: 0 },
      { song: song(2, '胶片里的雨', '陈绮贞'), request, rank: 1 },
      { song: song(3, '旅行的意义', '陈绮贞'), request, rank: 2 },
      { song: song(4, '还是会寂寞', '陈绮贞'), request, rank: 3 },
      { song: song(5, '我是一只鱼', '落日飞车'), request, rank: 4 },
      { song: song(6, '海边车站', '宇多田光'), request, rank: 5 },
    ];

    const picked = pickDiversePlaylistSongs({
      char,
      profile,
      playlist: profile.playlists[0],
      candidates,
      usedSongIds: new Set([1]),
      count: 4,
    });

    expect(picked.map(s => s.id)).not.toContain(1);
    expect(picked).toHaveLength(4);
    expect(picked.filter(s => s.artists === '陈绮贞')).toHaveLength(2);
    expect(picked.some(s => s.artists === '落日飞车')).toBe(true);
  });
});
