import { describe, expect, it } from 'vitest';
import { buildListenTogetherPrompt, type DiscussInput } from './listenTogether';

const baseInput = (overrides: Partial<DiscussInput> = {}): DiscussInput => ({
  char: {
    id: 'char-a',
    modelId: 'char-a',
    name: '林夏',
    avatar: '',
    description: '',
    systemPrompt: '你说话自然、真诚。',
    memories: [],
    musicProfile: {
      bio: '',
      genreTags: ['独立流行'],
      signatureArtists: [{ name: '落日飞车' }],
      playlists: [],
      likedSongIds: [],
      recentPlays: [],
      reviews: [],
      canReadUserMusic: true,
      updatedAt: 1,
    },
  } as any,
  user: { name: '小禾', avatar: '', bio: '' } as any,
  api: { baseUrl: 'https://example.com', apiKey: 'key', model: 'model' },
  song: {
    name: '雨天样本',
    artists: 'Moro Band',
    album: 'Test Album',
    duration: 198,
    progress: 63,
    playing: true,
    lyricCurrent: '雨落在窗台',
    lyricWindow: ['风慢下来', '雨落在窗台', '你没有回头'],
    lyricActiveIdx: 1,
    lyricPreview: ['风慢下来', '雨落在窗台', '你没有回头'],
    lyricSource: 'synced',
  },
  playing: true,
  history: [],
  trigger: 'enter',
  ...overrides,
});

describe('buildListenTogetherPrompt', () => {
  it('includes playback progress and the active lyric window', () => {
    const prompt = buildListenTogetherPrompt(baseInput());

    expect(prompt).toContain('你不是只看到歌名');
    expect(prompt).toContain('进度 1:03 / 3:18');
    expect(prompt).toContain('实时进度');
    expect(prompt).toContain('当前歌词窗口');
    expect(prompt).toContain('.. 风慢下来');
    expect(prompt).toContain('>> 雨落在窗台');
    expect(prompt).toContain('.. 你没有回头');
    expect(prompt).toContain('{"kind":"seek","seconds":83}');
    expect(prompt).toContain('{"kind":"previous"}');
  });

  it('supports progress-check prompts for live lyric co-listening', () => {
    const prompt = buildListenTogetherPrompt(baseInput({ trigger: 'progress_check' }));

    expect(prompt).toContain('对方让你听听此刻播放到哪里');
    expect(prompt).toContain('你能感知播放器给出的当前进度和歌词窗口');
  });

  it('nudges the character to answer user humming naturally', () => {
    const prompt = buildListenTogetherPrompt(baseInput({ trigger: 'user', userMsg: '♪ 雨落在窗台' }));

    expect(prompt).toContain('如果对方像在打字跟唱 / 哼唱歌词');
    expect(prompt).toContain('小禾 刚说：♪ 雨落在窗台');
  });

  it('tells the character not to invent lyrics when none are available', () => {
    const prompt = buildListenTogetherPrompt(baseInput({
      song: {
        name: '夜航',
        artists: 'Moro Band',
        playing: true,
        lyricWindow: [],
        lyricPreview: [],
        lyricSource: 'none',
      },
    }));

    expect(prompt).toContain('歌词暂时不可用');
    expect(prompt).toContain('不要编造具体歌词');
    expect(prompt).toContain('如果歌词不可用，就不要假装知道歌词');
  });
});
