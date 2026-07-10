import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Compass, MagnifyingGlass, MusicNotes, Play, UserCircle, UsersThree } from '@phosphor-icons/react';
import { useOS } from '../../context/OSContext';
import { musicApi, Song, toHttps, useMusic } from '../../context/MusicContext';
import type { CharPlaylistSong } from '../../types';
import { computeCurrentListening } from '../../utils/charMusicSchedule';
import { getLocalDateKey } from '../../utils/dateKey';
import { DB } from '../../utils/db';
import { listMusicSearchHistory, listRecentMusicSongs, upsertMusicTrack } from '../../utils/musicLibrary';
import { BokehBg, C, MiniPlayer, MizuHeader, SongRow, Sparkle, isMusicAvatarImage } from './MusicUI';

const fmtTime = (s: number) => {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${m}:${ss.toString().padStart(2, '0')}`;
};

const FALLBACK_COVER = 'https://p1.music.126.net/y19E5SadGUmSR8SZxkrNtw==/109951163965029180.jpg';

interface Props {
  onClose: () => void;
  onOpenSearch: (keyword?: string) => void;
  onOpenLibrary: () => void;
  onOpenProfile: () => void;
  onOpenPlayer: () => void;
  onVisitChar: (charId: string) => void;
  onShareSong: (song: Song) => void;
  tabBar?: React.ReactNode;
}

const songFromNetease = (s: any): Song => ({
  id: s.id,
  name: s.name,
  artists: (s.ar || s.artists || []).map((a: any) => a.name).join(' / '),
  album: s.al?.name || s.album?.name || '',
  albumPic: toHttps(s.al?.picUrl || s.album?.picUrl || '') || FALLBACK_COVER,
  duration: (s.dt || s.duration || 0) / 1000,
  fee: s.fee ?? 0,
});

const songFromCharSong = (s: CharPlaylistSong): Song => ({
  id: s.id,
  name: s.name,
  artists: s.artists,
  album: s.album,
  albumPic: s.albumPic || FALLBACK_COVER,
  duration: s.duration,
  fee: s.fee,
  source: s.source || 'discovered',
});

const SectionTitle: React.FC<{ children: React.ReactNode; action?: React.ReactNode }> = ({ children, action }) => (
  <div className="flex items-center justify-between px-1 mb-2">
    <div className="flex items-center gap-2">
      <div className="w-1 h-3 rounded-full" style={{ background: `linear-gradient(180deg, ${C.primary}, ${C.accent})` }} />
      <span className="text-[11px] tracking-wider font-medium" style={{ color: C.text, fontFamily: `'Noto Serif', serif` }}>
        {children}
      </span>
    </div>
    {action}
  </div>
);

const MusicDiscoveryPage: React.FC<Props> = ({
  onClose,
  onOpenSearch,
  onOpenLibrary,
  onOpenProfile,
  onOpenPlayer,
  onVisitChar,
  onShareSong,
  tabBar,
}) => {
  const { characters, addToast, userProfile } = useOS();
  const {
    cfg, current, playing, togglePlay, nextSong, prevSong, playSong,
    localAlbumSongs, libraryVersion, listeningTogetherWith, removeListeningPartner,
  } = useMusic();
  const [recentSongs, setRecentSongs] = useState<Song[]>([]);
  const [dailySongs, setDailySongs] = useState<Song[]>([]);
  const [searchTerms, setSearchTerms] = useState<string[]>([]);
  const [loadingDaily, setLoadingDaily] = useState(false);
  const [loadingChartId, setLoadingChartId] = useState<string | number | null>(null);
  const [toplists, setToplists] = useState<Array<{
    id: string | number;
    name: string;
    coverImgUrl?: string;
    updateFrequency?: string;
    description?: string;
  }>>([]);
  const [charNow, setCharNow] = useState<Array<{ charId: string; name: string; avatar?: string; song: Song; vibe?: string }>>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      listRecentMusicSongs(12),
      listMusicSearchHistory(8),
    ]).then(([recent, history]) => {
      if (cancelled) return;
      setRecentSongs(recent);
      setSearchTerms(history.map(item => item.keyword));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [libraryVersion]);

  useEffect(() => {
    let cancelled = false;
    musicApi.toplist(cfg)
      .then(r => {
        if (cancelled) return;
        const list = (r?.list || [])
          .filter((item: any) => item?.id && item?.name)
          .map((item: any) => ({
            id: item.id,
            name: String(item.name || ''),
            coverImgUrl: toHttps(String(item.coverImgUrl || '')) || FALLBACK_COVER,
            updateFrequency: item.updateFrequency,
            description: item.description,
          }));
        setToplists(list);
      })
      .catch(() => {
        if (!cancelled) setToplists([]);
      });
    return () => { cancelled = true; };
  }, [cfg.workerUrl, cfg.cookie]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const today = getLocalDateKey();
      const rows: Array<{ charId: string; name: string; avatar?: string; song: Song; vibe?: string }> = [];
      for (const char of characters.slice(0, 12)) {
        if (!char.musicProfile?.initializedAt) continue;
        const schedule = await DB.getDailySchedule(char.id, today).catch(() => null);
        const now = computeCurrentListening(char, schedule);
        if (!now) continue;
        rows.push({
          charId: char.id,
          name: char.name,
          avatar: char.avatar,
          vibe: now.vibe,
          song: {
            id: now.songId,
            name: now.songName,
            artists: now.artists,
            album: '',
            albumPic: now.albumPic,
            duration: 0,
            fee: 0,
            source: 'discovered',
          },
        });
      }
      if (!cancelled) setCharNow(rows);
    })();
    return () => { cancelled = true; };
  }, [characters, libraryVersion]);

  const companions = useMemo(() => listeningTogetherWith
    .map(id => characters.find(c => c.id === id))
    .filter((c): c is typeof characters[number] => !!c)
    .map(c => ({ id: c.id, name: c.name, avatar: c.avatar })), [characters, listeningTogetherWith]);

  const momentSongs = useMemo(() => {
    const pool: Array<{ song: Song; reason: string }> = [];
    for (const char of characters) {
      const profile = char.musicProfile;
      if (!profile?.playlists?.length) continue;
      const songs = profile.playlists.flatMap(pl => pl.songs || []);
      if (!songs.length) continue;
      const pick = songs[(new Date().getHours() + pool.length) % songs.length];
      if (pick) pool.push({ song: songFromCharSong(pick), reason: `${char.name} 可能会推荐` });
    }
    recentSongs.slice(0, 4).forEach(song => pool.push({ song, reason: '最近常听' }));
    localAlbumSongs.slice(0, 3).forEach(song => pool.push({ song, reason: '一起写的歌' }));
    const seen = new Set<string>();
    return pool.filter(item => {
      const key = `${item.song.source || 'netease'}:${item.song.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 6);
  }, [characters, localAlbumSongs, recentSongs]);

  const featuredToplists = useMemo(() => {
    const priority = ['飙升', '热歌', '新歌', '原创', '云音乐', '欧美', 'ACG'];
    return [...toplists]
      .sort((a, b) => {
        const ai = priority.findIndex(word => a.name.includes(word));
        const bi = priority.findIndex(word => b.name.includes(word));
        return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
      })
      .slice(0, 6);
  }, [toplists]);

  const mixSongs = useMemo(() => {
    const seen = new Set<string>();
    return [...momentSongs.map(item => item.song), ...recentSongs, ...localAlbumSongs]
      .filter(song => {
        const key = `${song.source || 'netease'}:${song.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 30);
  }, [localAlbumSongs, momentSongs, recentSongs]);

  const continueSong = current || recentSongs[0] || localAlbumSongs[0] || momentSongs[0]?.song || null;

  const playDaily = useCallback(async () => {
    setLoadingDaily(true);
    try {
      const r = await musicApi.recommendSongs(cfg);
      const songs: Song[] = (r?.data?.dailySongs || r?.recommend || []).map(songFromNetease);
      if (!songs.length) throw new Error('还没有每日推荐');
      await Promise.all(songs.slice(0, 30).map(s => upsertMusicTrack(s).catch(() => null)));
      setDailySongs(songs);
      await playSong(songs[0], { replaceQueue: songs, startIdx: 0, playSource: 'discover' });
      onOpenPlayer();
    } catch (e: any) {
      const fallback = recentSongs[0] || localAlbumSongs[0];
      if (fallback) {
        addToast('每日推荐暂时没接上，先从本地最近播放继续', 'info');
        await playSong(fallback, { replaceQueue: [fallback, ...recentSongs.filter(s => s.id !== fallback.id)], startIdx: 0, playSource: 'discover' });
        onOpenPlayer();
      } else {
        addToast(`每日推荐失败：${e?.message || '未知错误'}`, 'error');
      }
    } finally {
      setLoadingDaily(false);
    }
  }, [addToast, cfg, localAlbumSongs, onOpenPlayer, playSong, recentSongs]);

  const playFm = useCallback(async () => {
    try {
      const r = await musicApi.personalFm(cfg);
      const songs: Song[] = (r?.data || []).map(songFromNetease);
      if (!songs.length) throw new Error('FM 暂无歌曲');
      await Promise.all(songs.map(s => upsertMusicTrack(s).catch(() => null)));
      await playSong(songs[0], { replaceQueue: songs, startIdx: 0, playSource: 'discover' });
      onOpenPlayer();
    } catch (e: any) {
      addToast(`私人 FM 失败：${e?.message || '未知错误'}`, 'error');
    }
  }, [addToast, cfg, onOpenPlayer, playSong]);

  const playMix = useCallback(async () => {
    if (!mixSongs.length) {
      onOpenSearch();
      return;
    }
    await playSong(mixSongs[0], { replaceQueue: mixSongs, startIdx: 0, playSource: 'discover' });
    onOpenPlayer();
  }, [mixSongs, onOpenPlayer, onOpenSearch, playSong]);

  const playToplist = useCallback(async (chart: { id: string | number; name: string }) => {
    setLoadingChartId(chart.id);
    try {
      const id = Number(chart.id);
      if (!Number.isFinite(id)) throw new Error('榜单编号不可用');
      const r = await musicApi.playlistTrackAll(cfg, id, 60, 0);
      const songs: Song[] = (r?.songs || []).map(songFromNetease);
      if (!songs.length) throw new Error('榜单里暂时没有可播放歌曲');
      await Promise.all(songs.slice(0, 30).map(s => upsertMusicTrack(s).catch(() => null)));
      await playSong(songs[0], { replaceQueue: songs, startIdx: 0, playSource: 'discover' });
      onOpenPlayer();
    } catch (e: any) {
      addToast(`榜单加载失败：${e?.message || '未知错误'}`, 'error');
    } finally {
      setLoadingChartId(null);
    }
  }, [addToast, cfg, onOpenPlayer, playSong]);

  const songCards = dailySongs.length ? dailySongs : recentSongs;

  return (
    <div className="flex flex-col h-full relative" style={{ background: `linear-gradient(180deg, #ffffff 0%, ${C.bg} 52%, ${C.bgDeep} 100%)` }}>
      <BokehBg />
      <MizuHeader
        title="发现"
        onClose={onClose}
        right={<button onClick={onOpenProfile} className="p-1.5 rounded-full" style={{ color: C.primary }} title="我的"><UserCircle size={18} weight="bold" /></button>}
      />
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-36 relative z-10 shizuku-scrollbar">
        <div className="rounded-3xl p-4 mb-3 shizuku-glass-strong overflow-hidden relative"
          style={{ boxShadow: `0 8px 30px ${C.glow}18` }}>
          <div className="absolute inset-y-0 right-0 w-32 opacity-20 pointer-events-none"
            style={{ background: `linear-gradient(135deg, transparent, ${C.primary}33)` }} />
          <div className="relative flex items-center gap-3">
            <div className="w-14 h-14 rounded-2xl overflow-hidden shrink-0"
              style={{ border: `1.5px solid ${C.glow}70`, background: C.soft }}>
              {continueSong ? (
                <img src={continueSong.albumPic || FALLBACK_COVER} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <MusicNotes size={24} weight="fill" color={C.primary} />
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] tracking-[0.18em] uppercase" style={{ color: C.muted }}>Today Mix</div>
              <div className="text-base truncate mt-0.5" style={{ color: C.text, fontFamily: `'Noto Serif', serif` }}>
                {continueSong ? continueSong.name : '从第一首歌开始'}
              </div>
              <div className="text-[10px] truncate mt-0.5" style={{ color: C.muted }}>
                {continueSong ? continueSong.artists : '搜索、账号歌单和角色推荐会一起汇入这里'}
              </div>
            </div>
            <button
              onClick={() => void (continueSong ? playSong(continueSong, { replaceQueue: mixSongs.length ? mixSongs : [continueSong], startIdx: Math.max(0, mixSongs.findIndex(s => s.id === continueSong.id)), playSource: 'discover' }).then(onOpenPlayer) : playMix())}
              className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 active:scale-95 transition-transform"
              style={{ background: `linear-gradient(135deg, ${C.primary}, ${C.accent})`, color: 'white', boxShadow: `0 4px 18px ${C.primary}25` }}
              title="继续播放"
              aria-label="继续播放"
            >
              <Play size={18} weight="fill" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button onClick={playDaily} disabled={loadingDaily} className="rounded-2xl p-4 text-left shizuku-glass-strong active:scale-[0.98] transition-transform">
            <Compass size={22} weight="fill" color={C.primary} />
            <div className="text-sm mt-2" style={{ color: C.text }}>今日推荐</div>
            <div className="text-[10px] mt-1" style={{ color: C.muted }}>{loadingDaily ? '正在取歌...' : '从账号日推和本地记录继续'}</div>
          </button>
          <button onClick={playFm} className="rounded-2xl p-4 text-left shizuku-glass active:scale-[0.98] transition-transform">
            <MusicNotes size={22} weight="fill" color={C.accent} />
            <div className="text-sm mt-2" style={{ color: C.text }}>私人 FM</div>
            <div className="text-[10px] mt-1" style={{ color: C.muted }}>随机开一段今天的流</div>
          </button>
        </div>

        {mixSongs.length > 0 && (
          <div className="mt-5">
            <SectionTitle action={<button onClick={() => void playMix()} className="text-[10px]" style={{ color: C.accent }}>播放全部</button>}>
              今日混合
            </SectionTitle>
            <button onClick={() => void playMix()} className="w-full rounded-2xl p-3 text-left shizuku-glass active:scale-[0.99] transition-transform">
              <div className="flex items-center gap-3">
                <div className="flex -space-x-3 shrink-0">
                  {mixSongs.slice(0, 4).map((song, i) => (
                    <img key={`${song.id}-${i}`} src={song.albumPic || FALLBACK_COVER} alt="" className="w-10 h-10 rounded-xl object-cover"
                      style={{ border: `2px solid ${C.bg}`, boxShadow: `0 2px 10px ${C.glow}25` }} />
                  ))}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate" style={{ color: C.text }}>本地记录 × 角色口味 × 创作社</div>
                  <div className="text-[10px] truncate mt-0.5" style={{ color: C.muted }}>{mixSongs.length} 首 · 适合直接续上</div>
                </div>
                <Play size={18} weight="fill" color={C.primary} />
              </div>
            </button>
          </div>
        )}

        {featuredToplists.length > 0 && (
          <div className="mt-5">
            <SectionTitle>榜单速听</SectionTitle>
            <div className="grid grid-cols-3 gap-2">
              {featuredToplists.map(chart => (
                <button
                  key={chart.id}
                  onClick={() => void playToplist(chart)}
                  className="rounded-2xl overflow-hidden text-left shizuku-glass active:scale-[0.98] transition-transform"
                  style={{ minHeight: 116 }}
                >
                  <div className="aspect-square overflow-hidden relative" style={{ background: C.soft }}>
                    <img src={chart.coverImgUrl || FALLBACK_COVER} alt="" className="w-full h-full object-cover" />
                    {loadingChartId === chart.id && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/35">
                        <span className="w-5 h-5 border-2 border-white/50 border-t-white rounded-full animate-spin" />
                      </div>
                    )}
                  </div>
                  <div className="p-2">
                    <div className="text-[10px] truncate" style={{ color: C.text }}>{chart.name}</div>
                    <div className="text-[8px] truncate mt-0.5" style={{ color: C.faint }}>{chart.updateFrequency || '榜单'}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {searchTerms.length > 0 && (
          <div className="mt-5">
            <SectionTitle action={<button onClick={() => onOpenSearch()} className="text-[10px]" style={{ color: C.accent }}>搜索</button>}>最近在找</SectionTitle>
            <div className="flex gap-2 overflow-x-auto pb-1 shizuku-scrollbar">
              {searchTerms.map(term => (
                <button key={term} onClick={() => onOpenSearch(term)} className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[11px] shizuku-glass" style={{ color: C.primary }}>
                  <MagnifyingGlass size={11} />{term}
                </button>
              ))}
            </div>
          </div>
        )}

        {charNow.length > 0 && (
          <div className="mt-5">
            <SectionTitle>他们此刻在听</SectionTitle>
            <div className="space-y-2">
              {charNow.slice(0, 4).map(row => (
                <button key={row.charId} onClick={() => onVisitChar(row.charId)} className="w-full flex items-center gap-3 p-2 rounded-2xl shizuku-glass text-left active:scale-[0.99]">
                  {isMusicAvatarImage(row.avatar)
                    ? <img src={row.avatar} alt="" className="w-10 h-10 rounded-full object-cover" />
                    : <span className="w-10 h-10 rounded-full flex items-center justify-center text-white" style={{ background: `linear-gradient(135deg, ${C.sakura}, ${C.lavender})` }}>{row.avatar || row.name.slice(0, 1)}</span>}
                  <div className="flex-1 min-w-0">
                    <div className="text-xs truncate" style={{ color: C.text }}>{row.name} · {row.song.name}</div>
                    <div className="text-[10px] truncate" style={{ color: C.muted }}>{row.song.artists}{row.vibe ? ` · ${row.vibe}` : ''}</div>
                  </div>
                  <UsersThree size={15} weight="fill" color={C.accent} />
                </button>
              ))}
            </div>
          </div>
        )}

        {momentSongs.length > 0 && (
          <div className="mt-5">
            <SectionTitle>适合此刻的歌</SectionTitle>
            <div className="grid grid-cols-2 gap-2">
              {momentSongs.map((item, i) => (
                <button
                  key={`${item.song.source || 'netease'}-${item.song.id}-${i}`}
                  onClick={() => { playSong(item.song, { replaceQueue: momentSongs.map(row => row.song), startIdx: i, playSource: 'discover' }); onOpenPlayer(); }}
                  className="rounded-2xl p-2.5 text-left shizuku-glass active:scale-[0.98] transition-transform min-w-0"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <img src={item.song.albumPic} alt="" className="w-10 h-10 rounded-xl object-cover shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] truncate" style={{ color: C.text }}>{item.song.name}</div>
                      <div className="text-[9px] truncate" style={{ color: C.muted }}>{item.song.artists}</div>
                    </div>
                  </div>
                  <div className="mt-2 text-[9px] truncate" style={{ color: C.accent }}>{item.reason}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-5">
          <SectionTitle action={<button onClick={onOpenLibrary} className="text-[10px]" style={{ color: C.accent }}>资料库</button>}>
            {songCards.length ? '最近常听 / 继续播放' : '先从这里开始'}
          </SectionTitle>
          {songCards.length ? (
            <div className="space-y-1">
              {songCards.slice(0, 8).map((song, i) => (
                <SongRow
                  key={`${song.source || 'netease'}-${song.id}-${i}`}
                  name={song.name}
                  artists={song.artists}
                  album={song.album}
                  albumPic={song.albumPic}
                  duration={fmtTime(song.duration)}
                  isVip={song.fee === 1}
                  isActive={current?.id === song.id}
                  onClick={() => { playSong(song, { replaceQueue: songCards, startIdx: i, playSource: 'discover' }); onOpenPlayer(); }}
                  onShare={() => onShareSong(song)}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl p-5 text-center shizuku-glass" style={{ color: C.muted }}>
              <Sparkle size={18} color={C.glow} />
              <div className="text-xs mt-2">搜索一首歌，或先去「我的」同步账号歌单。</div>
            </div>
          )}
        </div>
      </div>
      {tabBar}
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

export default MusicDiscoveryPage;
