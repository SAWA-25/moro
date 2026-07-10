import { describe, expect, it } from 'vitest';
import type { ListenMsg } from './listenTogether';
import {
  buildListenActionNotice,
  clearListenTogetherSession,
  loadListenTogetherSession,
  saveListenTogetherSession,
  selectListenTogetherSessionForPartners,
} from './listenTogetherSession';

const memoryStorage = () => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
};

describe('listen together session cache', () => {
  it('saves and restores the current listen-together discussion', () => {
    const storage = memoryStorage();
    const messages: ListenMsg[] = [
      { role: 'user', text: '这句别丢', at: 1 },
      { role: 'char', text: '我还在听。', action: { kind: 'pause' }, at: 2 },
    ];

    saveListenTogetherSession({
      charId: 'char-a',
      messages,
      input: '还没发出去',
      songId: 99,
      songName: '雨夜',
      updatedAt: 100,
    }, storage);

    expect(loadListenTogetherSession(storage, 200)).toMatchObject({
      charId: 'char-a',
      messages,
      input: '还没发出去',
      songId: 99,
      songName: '雨夜',
    });
  });

  it('only resumes a cached session for active listening partners', () => {
    const storage = memoryStorage();
    saveListenTogetherSession({
      charId: 'char-a',
      messages: [{ role: 'char', text: '回来啦', at: 1 }],
      input: '',
      updatedAt: Date.now(),
    }, storage);

    expect(selectListenTogetherSessionForPartners(['char-b'], storage)).toBeNull();
    expect(selectListenTogetherSessionForPartners(['char-a'], storage)?.charId).toBe('char-a');
  });

  it('clears only the matching cached partner session', () => {
    const storage = memoryStorage();
    saveListenTogetherSession({
      charId: 'char-a',
      messages: [],
      input: '',
      updatedAt: Date.now(),
    }, storage);

    clearListenTogetherSession('char-b', storage);
    expect(loadListenTogetherSession(storage, 200)?.charId).toBe('char-a');
    clearListenTogetherSession('char-a', storage);
    expect(loadListenTogetherSession(storage, 200)).toBeNull();
  });
});

describe('listen together action notification copy', () => {
  it('formats playback action notices with the actor name', () => {
    expect(buildListenActionNotice('林夏', { kind: 'pause' })).toMatchObject({
      title: '林夏 暂停了音乐',
      toast: '林夏 暂停了音乐',
    });

    expect(buildListenActionNotice('林夏', { kind: 'change_song', query: '旅行 落日飞车' }, '旅行')).toMatchObject({
      title: '林夏 换了一首歌',
      body: '现在播放《旅行》。',
      toast: '林夏 换到《旅行》',
    });

    expect(buildListenActionNotice('林夏', { kind: 'seek', seconds: 83 })).toMatchObject({
      title: '林夏 拖动了进度条',
      body: 'TA 想听 1:23 附近的这一段。',
      toast: '林夏 跳到 1:23',
    });

    expect(buildListenActionNotice('林夏', { kind: 'previous' })).toMatchObject({
      title: '林夏 回到上一首',
      toast: '林夏 回到上一首',
    });
  });
});
