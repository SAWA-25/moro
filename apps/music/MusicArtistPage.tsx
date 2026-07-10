import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { PaperPlaneRight, ShareNetwork } from '@phosphor-icons/react';
import { musicApi, Song, toHttps, useMusic } from '../../context/MusicContext';
import { shareToExternalMusicApp } from '../../utils/musicExternalShare';
import { BokehBg, C, MiniPlayer, MizuHeader, SongRow, isMusicAvatarImage } from './MusicUI';
import { useOS } from '../../context/OSContext';

const fmtTime = (s: number) => {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${m}:${ss.toString().padStart(2, '0')}`;
};

export interface MusicArtistRef {
  id?: number | string;
  name: string;
  source?: 'netease' | 'qq';
}

interface Props {
  artist: MusicArtistRef;
  onBack: () => void;
  onOpenPlayer: () => void;
  onShareSong: (song: Song) => void;
  onShareArtist: (artist: MusicArtistRef & { image?: string; description?: string; url?: string }) => void;
  onOpenArtist: (artist: MusicArtistRef) => void;
}

const songFromNetease = (s: any): Song => ({
  id: s.id,
  name: s.name,
  artists: (s.ar || s.artists || []).map((a: any) => a.name).join(' / '),
  artistIds: (s.ar || s.artists || [])
    .map((a: any) => ({ id: a.id, name: a.name, source: 'netease' as const }))
    .filter((a: any) => a.id && a.name),
  album: s.al?.name || s.album?.name || '',
  albumPic: toHttps(s.al?.picUrl || s.album?.picUrl || ''),
  duration: (s.dt || s.duration || 0) / 1000,
  fee: s.fee ?? 0,
  source: 'netease',
});

const MusicArtistPage: React.FC<Props> = ({ artist, onBack, onOpenPlayer, onShareSong, onShareArtist, onOpenArtist }) => {
  const { addToast, characters, userProfile } = useOS();
  const { cfg, current, playing, togglePlay, nextSong, prevSong, playSong, listeningTogetherWith, removeListeningPartner } = useMusic();
  const [resolved, setResolved] = useState<MusicArtistRef>(artist);
  const [detail, setDetail] = useState<any>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setResolved(artist);
    setDetail(null);
    setSongs([]);
  }, [artist.id, artist.name, artist.source]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (resolved.source === 'qq') return;
      setLoading(true);
      try {
        let id = resolved.id;
        if (!id && resolved.name) {
          const found = await musicApi.artistSearch(cfg, resolved.name, 5);
          const first = (found?.result?.artists || [])[0];
          if (first?.id) {
            id = first.id;
            if (!cancelled) setResolved({ id, name: first.name || resolved.name, source: 'netease' });
          }
        }
        if (!id) throw new Error('没有找到歌手 ID');
        const [detailRes, songsRes] = await Promise.all([
          musicApi.artistDetail(cfg, id),
          musicApi.artistSongs(cfg, id, 50, 0),
        ]);
        if (cancelled) return;
        const a = detailRes?.artist || detailRes?.data?.artist || detailRes?.data || {};
        setDetail(a);
        const hotSongs = songsRes?.songs || songsRes?.hotSongs || detailRes?.hotSongs || [];
        setSongs(hotSongs.map(songFromNetease).filter((s: Song) => !!s.id));
      } catch (e: any) {
        if (!cancelled) addToast(`歌手页加载失败：${e?.message || '未知错误'}`, 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [addToast, cfg, resolved.id, resolved.name, resolved.source]);

  const companions = useMemo(() => listeningTogetherWith
    .map(id => characters.find(c => c.id === id))
    .filter((c): c is typeof characters[number] => !!c)
    .map(c => ({ id: c.id, name: c.name, avatar: c.avatar })), [characters, listeningTogetherWith]);

  const artistName = detail?.name || resolved.name || '歌手';
  const image = toHttps(detail?.picUrl || detail?.img1v1Url || '');
  const description = String(detail?.briefDesc || detail?.alias?.join(' / ') || '').trim();
  const externalUrl = resolved.source === 'qq'
    ? `https://y.qq.com/n/ryqq/singer/${resolved.id || encodeURIComponent(artistName)}`
    : resolved.id ? `https://music.163.com/#/artist?id=${resolved.id}` : undefined;

  const shareArtistExternal = useCallback(() => {
    void shareToExternalMusicApp({
      kind: 'artist',
      title: artistName,
      subtitle: description || '歌手主页',
      image,
      url: externalUrl,
      id: resolved.id,
      source: resolved.source || 'netease',
    }).catch(() => {});
  }, [artistName, description, externalUrl, image, resolved.id, resolved.source]);

  return (
    <div className="flex flex-col h-full relative" style={{ background: `linear-gradient(180deg, #ffffff 0%, ${C.bg} 55%, ${C.bgDeep} 100%)` }}>
      <BokehBg />
      <MizuHeader title="歌手" onBack={onBack} right={
        <button onClick={shareArtistExternal} className="p-1.5 rounded-full" style={{ color: C.primary }} title="分享到外部音乐 App">
          <ShareNetwork size={17} weight="bold" />
        </button>
      } />
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-32 relative z-10 shizuku-scrollbar">
        <div className="rounded-3xl p-4 shizuku-glass-strong flex items-center gap-4">
          {image ? (
            <img src={image} alt="" className="w-20 h-20 rounded-2xl object-cover shrink-0" />
          ) : (
            <div className="w-20 h-20 rounded-2xl flex items-center justify-center text-2xl text-white shrink-0" style={{ background: `linear-gradient(135deg, ${C.primary}, ${C.accent})` }}>
              {artistName.slice(0, 1)}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="text-xl truncate" style={{ color: C.text, fontFamily: `'Noto Serif', serif` }}>{artistName}</div>
            <div className="text-[10px] mt-1 line-clamp-2" style={{ color: C.muted }}>
              {description || (resolved.source === 'qq' ? 'QQ 音乐歌手主页，可跳转到外部 App 查看更多。' : '热门歌曲和歌手主页')}
            </div>
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => onShareArtist({ ...resolved, name: artistName, image, description, url: externalUrl })}
                className="px-3 py-1.5 rounded-full text-[10px] inline-flex items-center gap-1 shizuku-glass"
                style={{ color: C.primary }}
              >
                <PaperPlaneRight size={12} weight="fill" /> 分享给角色
              </button>
              <button onClick={shareArtistExternal} className="px-3 py-1.5 rounded-full text-[10px] shizuku-glass" style={{ color: C.accent }}>
                外部打开
              </button>
            </div>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between px-1">
          <span className="text-[11px] tracking-wider" style={{ color: C.text }}>热门歌曲</span>
          {loading && <span className="text-[10px]" style={{ color: C.faint }}>加载中…</span>}
        </div>
        <div className="mt-2 space-y-1">
          {songs.length === 0 && !loading ? (
            <div className="text-center text-[11px] py-10" style={{ color: C.faint }}>
              暂时没有拿到歌曲，试试外部打开歌手页。
            </div>
          ) : songs.map((song, i) => (
            <SongRow
              key={`${song.source || 'netease'}-${song.id}-${i}`}
              name={song.name}
              artists={song.artists}
              artistIds={song.artistIds}
              album={song.album}
              albumPic={song.albumPic}
              duration={fmtTime(song.duration)}
              isVip={song.fee === 1}
              isActive={current?.id === song.id}
              onClick={() => { void playSong(song, { replaceQueue: songs, startIdx: i, playSource: 'account' }); onOpenPlayer(); }}
              onShare={() => onShareSong(song)}
              onArtistClick={onOpenArtist}
            />
          ))}
        </div>
      </div>
      {current && (
        <MiniPlayer
          name={current.name}
          artists={current.artists}
          albumPic={current.albumPic}
          playing={playing}
          onTap={onOpenPlayer}
          onPrev={prevSong}
          onToggle={togglePlay}
          onNext={nextSong}
          userAvatar={userProfile?.avatar}
          userName={userProfile?.name}
          companions={companions}
          onKickCompanion={removeListeningPartner}
        />
      )}
    </div>
  );
};

export default MusicArtistPage;
