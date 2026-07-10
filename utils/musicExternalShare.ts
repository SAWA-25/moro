import type { Song } from '../context/MusicContext';
import type { MusicRichShareKind } from './musicShare';

export type MusicExternalSource = 'netease' | 'qq' | 'auto';

export interface MusicExternalShareItem {
  kind: MusicRichShareKind;
  title: string;
  subtitle?: string;
  text?: string;
  image?: string;
  url?: string;
  song?: Song;
  source?: MusicExternalSource;
  id?: string | number;
}

const enc = (value: string | number): string => encodeURIComponent(String(value));

export const buildMusicExternalUrl = (item: MusicExternalShareItem, preferred: MusicExternalSource = 'auto'): string => {
  const source = preferred === 'auto'
    ? (item.song?.source === 'qq' ? 'qq' : item.source === 'qq' ? 'qq' : 'netease')
    : preferred;

  if (item.url) return item.url;

  if (item.kind === 'song' && item.song) {
    if (source === 'qq') {
      const mid = item.song.qqSongMid || item.song.qqMediaMid || item.song.qqSongId || item.song.id;
      return `https://y.qq.com/n/ryqq/songDetail/${enc(mid)}`;
    }
    return `https://music.163.com/#/song?id=${enc(item.song.id)}`;
  }

  if (item.kind === 'playlist' && item.id != null) {
    return source === 'qq'
      ? `https://y.qq.com/n/ryqq/playlist/${enc(item.id)}`
      : `https://music.163.com/#/playlist?id=${enc(item.id)}`;
  }

  if (item.kind === 'artist' && item.id != null) {
    return source === 'qq'
      ? `https://y.qq.com/n/ryqq/singer/${enc(item.id)}`
      : `https://music.163.com/#/artist?id=${enc(item.id)}`;
  }

  if (item.kind === 'profile' && item.id != null) {
    return source === 'qq'
      ? `https://y.qq.com/n/ryqq/profile/${enc(item.id)}`
      : `https://music.163.com/#/user/home?id=${enc(item.id)}`;
  }

  if (item.kind === 'comment' && item.song) {
    return buildMusicExternalUrl({ kind: 'song', title: item.song.name, song: item.song }, source);
  }

  return source === 'qq' ? 'https://y.qq.com/' : 'https://music.163.com/';
};

export const shareToExternalMusicApp = async (
  item: MusicExternalShareItem,
  preferred: MusicExternalSource = 'auto',
): Promise<'shared' | 'opened'> => {
  const url = buildMusicExternalUrl(item, preferred);
  const text = [item.subtitle, item.text].filter(Boolean).join('\n');
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: item.title, text, url });
      return 'shared';
    } catch (err: any) {
      if (err?.name === 'AbortError') throw err;
    }
  }
  if (typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
  return 'opened';
};
