/**
 * 网易云「我的」主页
 * - 未登录: 扫码登录 / 手机验证码登录
 * - 已登录: 昵称 + 头像 + 签名 + VIP + 签到 + 我的歌单 + 播放记录 + 云盘
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOS } from '../../context/OSContext';
import { useMusic, musicApi, toHttps, Song } from '../../context/MusicContext';
import {
  C, Sparkle, MizuHeader, BokehBg, MiniPlayer, isMusicAvatarImage,
} from './MusicUI';
import { MagnifyingGlass, Gear, User as UserIcon } from '@phosphor-icons/react';
import NeteaseLoginPanel from './NeteaseLoginPanel';
import QQMusicLoginPanel from './QQMusicLoginPanel';

interface Playlist {
  id: number | string;
  name: string;
  coverImgUrl: string;
  trackCount: number;
  subscribed: boolean;
  creatorNickname?: string;
  source?: MusicSource;
}

interface RecordItem {
  song: Song;
  score: number;
  playCount: number;
}

interface Props {
  onBack: () => void;
  onOpenPlayer: () => void;
  onOpenSearch?: () => void;
  onOpenSettings?: () => void;
  onVisitChar?: (charId: string) => void;
  onQQMusicConnected?: () => void;
}

type MusicSource = 'netease' | 'qq';

interface ProfileView {
  userId: string;
  nickname: string;
  avatarUrl: string;
  signature?: string;
  backgroundUrl?: string;
  vipType?: number;
  follows?: number;
  followeds?: number;
  playlistCount?: number;
}

const playlistKey = (pl: Playlist) => `${pl.source || 'netease'}:${pl.id}`;

// ─── 「一起写的歌」本地专辑卡 — 写歌 App 同步过来的 ACE-Step / MiniMax 出歌 ───
interface LocalAlbumCardProps {
  songs: Song[];
  expanded: boolean;
  setExpanded: (next: ((v: boolean) => boolean) | boolean) => void;
  currentId: number | null;
  playing: boolean;
  onPlay: (song: Song, idx: number) => void;
  onRemove: (id: number) => void;
}
const LocalAlbumCard: React.FC<LocalAlbumCardProps> = ({ songs, expanded, setExpanded, currentId, playing, onPlay, onRemove }) => (
  <div
    className="rounded-2xl overflow-hidden relative"
    style={{
      background: `linear-gradient(135deg, ${C.sakura}25, ${C.lavender}22, ${C.glow}20)`,
      border: `1px solid ${C.sakura}50`,
      boxShadow: `0 4px 18px ${C.sakura}25, inset 0 1px 0 rgba(255,255,255,0.5)`,
    }}
  >
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 opacity-50"
      style={{ background: `radial-gradient(ellipse at 80% 20%, ${C.sakura}40 0%, transparent 50%)` }}
    />
    <button
      onClick={() => setExpanded((v: boolean) => !v)}
      className="relative w-full flex items-center gap-3 p-2.5 text-left"
    >
      <div className="relative w-12 h-12 shrink-0">
        <div className="absolute inset-0 rounded-xl flex items-center justify-center overflow-hidden"
          style={{
            background: `linear-gradient(135deg, ${C.primary}, ${C.accent})`,
            border: `1.5px solid ${C.glow}80`,
            boxShadow: `0 2px 8px ${C.glow}40`,
          }}
        >
          <Sparkle size={20} color="white" delay={0} />
        </div>
        <Sparkle size={9} className="absolute -top-1 -right-1" color={C.sakura} delay={0.5} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium tracking-wider"
            style={{ color: C.primary, fontFamily: `'Georgia', 'Noto Serif SC', serif` }}>
            一起写的歌
          </span>
          <span className="text-[8px] px-1.5 py-[1px] rounded-full font-bold"
            style={{
              background: `linear-gradient(135deg, ${C.sakura}, ${C.lavender})`,
              color: 'white',
              letterSpacing: '0.1em',
            }}>
            OURS
          </span>
        </div>
        <div className="text-[10px] truncate mt-0.5" style={{ color: C.muted }}>
          {songs.length} 首 · 你和 char 共同创作
        </div>
      </div>
      <div className="text-[10px] shrink-0" style={{ color: C.sakura }}>
        {expanded ? '收起' : '展开'}
      </div>
    </button>
    {expanded && (
      <div className="relative border-t px-1 py-1" style={{ borderColor: `${C.sakura}30` }}>
        {songs.map((s, idx) => {
          const active = currentId === s.id;
          return (
            <div key={s.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/30 transition-colors">
              <button
                onClick={() => onPlay(s, idx)}
                className="flex-1 flex items-center gap-2 min-w-0 text-left"
              >
                <div className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
                  style={{ background: active ? `linear-gradient(135deg, ${C.primary}, ${C.accent})` : `${C.faint}25` }}>
                  {active && playing ? (
                    <span className="flex gap-0.5">
                      <span className="w-0.5 h-2 bg-white rounded-full" style={{ animation: 'shizuku-twinkle 0.6s ease-in-out infinite' }} />
                      <span className="w-0.5 h-3 bg-white rounded-full" style={{ animation: 'shizuku-twinkle 0.8s ease-in-out 0.15s infinite' }} />
                      <span className="w-0.5 h-2 bg-white rounded-full" style={{ animation: 'shizuku-twinkle 0.7s ease-in-out 0.3s infinite' }} />
                    </span>
                  ) : (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill={active ? 'white' : C.muted}>
                      <path d="M8 5v14l11-7L8 5z" />
                    </svg>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] truncate" style={{ color: active ? C.primary : C.text, fontWeight: active ? 600 : 400 }}>
                    {s.name}
                  </div>
                  <div className="text-[9.5px] truncate" style={{ color: C.muted }}>
                    {s.artists}
                  </div>
                </div>
              </button>
              <button
                onClick={() => {
                  if (typeof window !== 'undefined' && window.confirm(`从专辑移除《${s.name}》？`)) onRemove(s.id);
                }}
                className="text-[10px] px-1.5 py-0.5 rounded shrink-0 transition-colors"
                style={{ color: C.faint }}
                title="移除"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
    )}
  </div>
);

const NeteaseProfilePage: React.FC<Props> = ({ onBack, onOpenPlayer, onOpenSearch, onOpenSettings, onVisitChar, onQQMusicConnected }) => {
  const { addToast, characters, userProfile } = useOS();
  const {
    cfg, setCfg, profile, refreshProfile, playSong,
    current, playing, togglePlay, nextSong, prevSong,
    listeningTogetherWith, removeListeningPartner,
    localAlbumSongs, removeLocalSong,
    regeneratingId, regeneratingStatus,
  } = useMusic();
  const [localAlbumExpanded, setLocalAlbumExpanded] = useState(false);
  const [showNeteaseLogin, setShowNeteaseLogin] = useState(false);
  const [showQQMusicLogin, setShowQQMusicLogin] = useState(false);
  const [activeSource, setActiveSource] = useState<MusicSource>(() => (cfg.qqMusic && (!cfg.cookie || !profile) ? 'qq' : 'netease'));

  // 伴听 char 名单（MiniPlayer 徽章用）—— 带头像
  const companions = useMemo(() => {
    return listeningTogetherWith
      .map(id => characters.find(c => c.id === id))
      .filter((c): c is typeof characters[number] => !!c)
      .map(c => ({ id: c.id, name: c.name, avatar: c.avatar }));
  }, [listeningTogetherWith, characters]);

  const [tab, setTab] = useState<'playlist' | 'record' | 'cloud'>('playlist');
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [cloud, setCloud] = useState<Song[]>([]);
  const [qqProfile, setQQProfile] = useState<ProfileView | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedPl, setExpandedPl] = useState<string | null>(null);
  const [plTracks, setPlTracks] = useState<Record<string, Song[]>>({});
  const [signedIn, setSignedIn] = useState(false);

  const hasNetease = !!cfg.cookie && !!profile;
  const hasQQ = !!cfg.qqMusic;
  const uid = profile?.userId;
  const qqAccount = cfg.qqMusic || null;

  // 把不稳定的引用（每秒重建的 addToast 和 cfg 对象）收到 ref 里，
  // 否则 reload 的 deps 会爆炸 → useEffect 循环触发。
  const toastRef = useRef(addToast);
  toastRef.current = addToast;
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;

  useEffect(() => {
    if (activeSource === 'netease' && !hasNetease && hasQQ) {
      setActiveSource('qq');
    } else if (activeSource === 'qq' && !hasQQ && hasNetease) {
      setActiveSource('netease');
    } else if (!hasNetease && !hasQQ && activeSource !== 'netease') {
      setActiveSource('netease');
    }
  }, [activeSource, hasNetease, hasQQ]);

  useEffect(() => {
    setPlaylists([]);
    setRecords([]);
    setCloud([]);
    setExpandedPl(null);
    setPlTracks({});
    setSignedIn(false);
  }, [activeSource, uid, qqAccount?.uin]);

  const neteaseProfileView = useMemo<ProfileView | null>(() => {
    if (!profile) return null;
    return {
      userId: String(profile.userId),
      nickname: profile.nickname,
      avatarUrl: profile.avatarUrl,
      signature: profile.signature,
      backgroundUrl: profile.backgroundUrl,
      vipType: profile.vipType,
      follows: profile.follows,
      followeds: profile.followeds,
      playlistCount: profile.playlistCount,
    };
  }, [profile]);

  const qqFallbackProfile = useMemo<ProfileView | null>(() => {
    if (!qqAccount) return null;
    return {
      userId: qqAccount.uin,
      nickname: qqAccount.nickname || 'QQ 音乐用户',
      avatarUrl: toHttps(qqAccount.avatarUrl || `https://q1.qlogo.cn/g?b=qq&nk=${encodeURIComponent(qqAccount.uin)}&s=100`),
      signature: 'QQ 音乐',
      backgroundUrl: '',
      vipType: 0,
      follows: 0,
      followeds: 0,
      playlistCount: playlists.length,
    };
  }, [qqAccount, playlists.length]);

  const viewProfile = activeSource === 'qq' ? (qqProfile || qqFallbackProfile) : neteaseProfileView;
  const sourceLabel = activeSource === 'qq' ? 'QQ 音乐' : '网易云';

  // VIP 标签 —— 无论登录与否都必须先算（hooks 必须恒定顺序，不能放到 early-return 后）
  const vipLabel = useMemo(() => {
    if (activeSource === 'qq') return 'QQ 音乐';
    const v = profile?.vipType || 0;
    if (v >= 110) return '黑胶 SVIP';
    if (v >= 10) return '黑胶 VIP';
    if (v > 0) return 'VIP';
    return '普通用户';
  }, [activeSource, profile]);

  // 加载当前来源的歌单 / 播放记录 / 云盘
  // 重点：cfg / toast 通过 ref 读取，避免 OSContext 每秒 tick 触发循环刷新
  const reload = useCallback(async () => {
    const curCfg = cfgRef.current;
    if (activeSource === 'netease' && (!uid || !curCfg.cookie)) return;
    if (activeSource === 'qq' && !curCfg.qqMusic) return;
    setLoading(true);
    try {
      if (activeSource === 'qq') {
        const r = await musicApi.qqUserPlaylist(curCfg);
        if (r?.profile) {
          setQQProfile({
            userId: String(r.profile.userId || curCfg.qqMusic?.uin || ''),
            nickname: r.profile.nickname || curCfg.qqMusic?.nickname || 'QQ 音乐用户',
            avatarUrl: toHttps(r.profile.avatarUrl || curCfg.qqMusic?.avatarUrl || ''),
            signature: r.profile.signature || 'QQ 音乐',
            backgroundUrl: toHttps(r.profile.backgroundUrl || ''),
            vipType: r.profile.vipType || 0,
            follows: r.profile.follows || 0,
            followeds: r.profile.followeds || 0,
            playlistCount: r.profile.playlistCount || r.playlist?.length || 0,
          });
        }
        const arr = (r?.playlist || []).map((p: any): Playlist => ({
          id: String(p.id),
          name: p.name || '',
          coverImgUrl: toHttps(p.coverImgUrl || ''),
          trackCount: p.trackCount || 0,
          subscribed: !!p.subscribed,
          creatorNickname: p.creatorNickname,
          source: 'qq',
        }));
        setPlaylists(arr);
        setRecords([]);
        setCloud([]);
        return;
      }
      if (!uid) return;

      const [plRes, recRes, clRes] = await Promise.allSettled([
        musicApi.userPlaylist(curCfg, uid),
        musicApi.userRecord(curCfg, uid, 1),
        musicApi.userCloud(curCfg),
      ]);

      if (plRes.status === 'fulfilled') {
        const arr = (plRes.value?.playlist || []).map((p: any): Playlist => ({
          id: p.id,
          name: p.name,
          coverImgUrl: toHttps(p.coverImgUrl || ''),
          trackCount: p.trackCount || 0,
          subscribed: !!p.subscribed,
          creatorNickname: p.creator?.nickname,
          source: 'netease',
        }));
        setPlaylists(arr);
      }

      if (recRes.status === 'fulfilled') {
        const weekly = recRes.value?.weekData || recRes.value?.allData || [];
        const mapped: RecordItem[] = weekly.map((r: any): RecordItem => ({
          score: r.score || 0,
          playCount: r.playCount || 0,
          song: {
            id: r.song?.id,
            name: r.song?.name || '',
            artists: (r.song?.ar || []).map((a: any) => a.name).join(' / '),
            album: r.song?.al?.name || '',
            albumPic: toHttps(r.song?.al?.picUrl || ''),
            duration: (r.song?.dt || 0) / 1000,
            fee: r.song?.fee ?? 0,
          },
        }));
        setRecords(mapped);
      }

      if (clRes.status === 'fulfilled') {
        const clData = clRes.value?.data || [];
        const mapped: Song[] = clData.map((c: any): Song => ({
          id: c.songId || c.simpleSong?.id,
          name: c.songName || c.simpleSong?.name || '',
          artists: c.artist || (c.simpleSong?.ar || []).map((a: any) => a.name).join(' / '),
          album: c.album || c.simpleSong?.al?.name || '',
          albumPic: toHttps(c.simpleSong?.al?.picUrl || ''),
          duration: (c.simpleSong?.dt || 0) / 1000,
          fee: 0,
        }));
        setCloud(mapped);
      }
    } catch (e: any) {
      toastRef.current(`加载失败：${e.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [activeSource, uid, qqAccount?.uin]);

  useEffect(() => { reload(); }, [reload]);

  // 展开歌单 — 同样用 ref 去稳定化 cfg / addToast
  const expandPlaylist = useCallback(async (pl: Playlist) => {
    const key = playlistKey(pl);
    if (expandedPl === key) { setExpandedPl(null); return; }
    setExpandedPl(key);
    if (plTracks[key]) return;
    try {
      if ((pl.source || activeSource) === 'qq') {
        const r = await musicApi.qqPlaylistDetail(cfgRef.current, pl.id);
        const songs: Song[] = (r?.songs || []).map((s: any) => ({
          id: s.id,
          name: s.name || '',
          artists: s.artists || '',
          album: s.album || '',
          albumPic: toHttps(s.albumPic || ''),
          duration: s.duration || 0,
          fee: s.fee ?? 0,
          source: 'qq',
          qqSongMid: s.qqSongMid,
          qqMediaMid: s.qqMediaMid,
        }));
        setPlTracks(prev => ({ ...prev, [key]: songs }));
      } else {
        const r = await musicApi.playlistTrackAll(cfgRef.current, pl.id as number, 100, 0);
        const songs: Song[] = (r?.songs || []).map((s: any) => ({
          id: s.id,
          name: s.name,
          artists: (s.ar || []).map((a: any) => a.name).join(' / '),
          album: s.al?.name || '',
          albumPic: toHttps(s.al?.picUrl || ''),
          duration: (s.dt || 0) / 1000,
          fee: s.fee ?? 0,
          source: 'netease',
        }));
        setPlTracks(prev => ({ ...prev, [key]: songs }));
      }
    } catch (e: any) {
      toastRef.current(`加载歌单失败：${e.message}`, 'error');
    }
  }, [activeSource, expandedPl, plTracks]);

  // 签到
  const doSignIn = useCallback(async () => {
    if (activeSource === 'qq') {
      toastRef.current('QQ 音乐暂不支持每日签到', 'info');
      return;
    }
    try {
      await musicApi.dailySignin(cfgRef.current, 1);
      setSignedIn(true);
      toastRef.current('签到成功 +5', 'success');
    } catch (e: any) {
      if (String(e.message).includes('重复')) {
        setSignedIn(true);
        toastRef.current('今天已经签过了', 'info');
      } else {
        toastRef.current(`签到失败：${e.message}`, 'error');
      }
    }
  }, [activeSource]);

  // 登出
  const doLogout = useCallback(async () => {
    const curCfg = cfgRef.current;
    if (activeSource === 'qq') {
      setCfg({ ...curCfg, qqMusic: null });
      setActiveSource(curCfg.cookie ? 'netease' : 'netease');
      setQQProfile(null);
      toastRef.current('已退出 QQ 音乐', 'success');
      return;
    }
    try { await musicApi.logout(curCfg); } catch {}
    setCfg({ ...curCfg, cookie: '' });
    if (curCfg.qqMusic) setActiveSource('qq');
    toastRef.current('已退出', 'success');
    await refreshProfile();
  }, [activeSource, setCfg, refreshProfile]);

  const connectQQMusic = useCallback((account: NonNullable<typeof cfg.qqMusic>) => {
    setCfg({ ...cfgRef.current, qqMusic: account });
    setActiveSource('qq');
    toastRef.current(`已连接 QQ 音乐：${account.nickname}`, 'success');
    setShowQQMusicLogin(false);
    onQQMusicConnected?.();
  }, [setCfg, onQQMusicConnected]);

  if (showQQMusicLogin) {
    return (
      <QQMusicLoginPanel
        onBack={() => setShowQQMusicLogin(false)}
        onConnected={connectQQMusic}
      />
    );
  }

  if (showNeteaseLogin) {
    return (
      <NeteaseLoginPanel
        onBack={() => setShowNeteaseLogin(false)}
        onLoggedIn={async (cookie) => {
          setCfg({ ...cfgRef.current, cookie });
          setActiveSource('netease');
          await new Promise(r => setTimeout(r, 300));
          await refreshProfile();
          toastRef.current('登录成功', 'success');
          setShowNeteaseLogin(false);
        }}
      />
    );
  }

  // 两个音乐账号都未登录 → 展示本地专辑 + 两种账号登录入口。
  // ⚠️ 所有 hooks 必须在这个 early-return **之前** 声明完。
  if (!hasNetease && !hasQQ) {
    return (
      <div className="flex flex-col h-full relative"
        style={{ background: `linear-gradient(180deg, #ffffff 0%, ${C.bg} 50%, ${C.bgDeep} 100%)` }}>
        <BokehBg />
        <MizuHeader title="My Cloud" onBack={onBack} />
        <div className="relative z-10 flex-1 overflow-y-auto pb-24 px-3 pt-3 shizuku-scrollbar">
          {localAlbumSongs.length > 0 && (
            <LocalAlbumCard
              songs={localAlbumSongs}
              expanded={localAlbumExpanded}
              setExpanded={setLocalAlbumExpanded}
              currentId={current?.id ?? null}
              playing={playing}
              onPlay={(s, idx) => playSong(s, { alsoSetQueue: true, replaceQueue: localAlbumSongs, startIdx: idx })}
              onRemove={removeLocalSong}
            />
          )}
          {/* 登录入口卡 */}
          <button
            onClick={() => setShowNeteaseLogin(true)}
            className="mt-3 w-full rounded-2xl shizuku-glass p-4 flex items-center gap-3 transition-all active:scale-[0.99]"
          >
            <div className="w-10 h-10 rounded-full flex items-center justify-center"
              style={{ background: `linear-gradient(135deg, ${C.faint}40, ${C.muted}30)`, border: `1px solid ${C.faint}40` }}>
              <UserIcon size={18} color={C.muted} weight="duotone" />
            </div>
            <div className="flex-1 text-left">
              <div className="text-sm" style={{ color: C.text }}>登录网易云</div>
              <div className="text-[10.5px]" style={{ color: C.muted }}>解锁海量曲库 · 自己的歌单 · 一起听</div>
            </div>
            <span className="text-[12px]" style={{ color: C.accent }}>→</span>
          </button>
          <button
            onClick={() => setShowQQMusicLogin(true)}
            className="mt-3 w-full rounded-2xl shizuku-glass p-4 flex items-center gap-3 transition-all active:scale-[0.99]"
          >
            <div className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-semibold"
              style={{ background: `linear-gradient(135deg, ${C.primary}, ${C.accent})`, color: 'white', border: `1px solid ${C.faint}40` }}>
              QQ
            </div>
            <div className="flex-1 text-left min-w-0">
              <div className="text-sm" style={{ color: C.text }}>
                {cfg.qqMusic ? `已连接 QQ 音乐：${cfg.qqMusic.nickname}` : '连接 QQ 音乐'}
              </div>
              <div className="text-[10.5px] truncate" style={{ color: C.muted }}>
                扫码后在同一个「我的」页面查看 QQ 音乐主页和歌单
              </div>
            </div>
            <span className="text-[12px]" style={{ color: C.accent }}>→</span>
          </button>
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
            regenStatus={current.id === regeneratingId ? regeneratingStatus : undefined}
          />
        )}
      </div>
    );
  }

  if (!viewProfile) {
    return null;
  }

  return (
    <div className="flex flex-col h-full relative"
      style={{ background: `linear-gradient(180deg, #ffffff 0%, ${C.bg} 50%, ${C.bgDeep} 100%)` }}>
      <BokehBg />
      <MizuHeader
        title="My Cloud"
        onBack={onBack}
        right={
          <div className="flex items-center gap-1">
            {onOpenSearch && (
              <button
                onClick={onOpenSearch}
                className="p-1.5 rounded-full transition-all"
                style={{ color: C.primary }}
                title="搜索"
              >
                <MagnifyingGlass size={16} weight="bold" />
              </button>
            )}
            {onOpenSettings && (
              <button
                onClick={onOpenSettings}
                className="p-1.5 rounded-full transition-all"
                style={{ color: C.primary }}
                title="设置"
              >
                <Gear size={16} weight="bold" />
              </button>
            )}
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto relative z-10 shizuku-scrollbar pb-20">
        {/* Banner 头图 */}
        <div className="relative h-32 overflow-hidden">
          {viewProfile.backgroundUrl ? (
            <img src={viewProfile.backgroundUrl} className="absolute inset-0 w-full h-full object-cover" alt="" />
          ) : (
            <div className="absolute inset-0" style={{ background: `linear-gradient(135deg, ${C.accent}40, ${C.sakura}40, ${C.lavender}40)` }} />
          )}
          <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, transparent 0%, ${C.bg}CC 100%)` }} />
        </div>

        {/* 用户卡 */}
        <div className="-mt-12 mx-4 rounded-3xl p-4 shizuku-glass-strong relative z-10"
          style={{ boxShadow: `0 10px 40px ${C.glow}15` }}>
          <div className="flex items-center gap-3">
            <div className="relative shrink-0">
              <img
                src={viewProfile.avatarUrl || 'https://p1.music.126.net/y19E5SadGUmSR8SZxkrNtw==/109951163965029180.jpg'}
                alt=""
                className="w-16 h-16 rounded-2xl object-cover"
                style={{ border: `2px solid ${C.glow}60`, boxShadow: `0 4px 20px ${C.glow}30` }}
              />
              <div className="absolute -bottom-1 -right-1">
                <Sparkle size={10} color={C.sakura} delay={0.3} />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-base font-semibold truncate" style={{ color: C.text, fontFamily: `'Noto Serif', serif` }}>
                {viewProfile.nickname}
              </div>
              <div className="text-[10px] mt-0.5 truncate" style={{ color: C.muted }}>
                {viewProfile.signature || '—'}
              </div>
              <div className="flex items-center gap-1.5 mt-1.5">
                <span className="text-[9px] px-2 py-0.5 rounded-full text-white font-medium"
                  style={{ background: `linear-gradient(135deg, ${C.vip}, #8c8578)`, letterSpacing: '0.05em' }}>
                  {vipLabel}
                </span>
                <span className="text-[9px] px-2 py-0.5 rounded-full" style={{ color: C.muted, border: `1px solid ${C.faint}40` }}>
                  {activeSource === 'qq' ? 'QQ' : 'UID'} · {viewProfile.userId}
                </span>
              </div>
            </div>
          </div>

          {(hasNetease || hasQQ) && (
            <div className="mt-3 flex items-center gap-1 shizuku-glass rounded-full p-1">
              <button
                onClick={() => hasNetease ? setActiveSource('netease') : setShowNeteaseLogin(true)}
                className="flex-1 py-1.5 rounded-full text-[10px] transition-all"
                style={{
                  background: activeSource === 'netease' ? `linear-gradient(135deg, ${C.primary}, ${C.accent})` : 'transparent',
                  color: activeSource === 'netease' ? 'white' : C.muted,
                }}
              >
                网易云
              </button>
              <button
                onClick={() => hasQQ ? setActiveSource('qq') : setShowQQMusicLogin(true)}
                className="flex-1 py-1.5 rounded-full text-[10px] transition-all"
                style={{
                  background: activeSource === 'qq' ? `linear-gradient(135deg, ${C.primary}, ${C.accent})` : 'transparent',
                  color: activeSource === 'qq' ? 'white' : C.muted,
                }}
              >
                QQ 音乐
              </button>
            </div>
          )}

          {/* 统计行 */}
          <div className="grid grid-cols-3 gap-2 mt-3 text-center">
            <StatCell label="歌单" value={playlists.length || viewProfile.playlistCount || 0} />
            <StatCell label="关注" value={viewProfile.follows ?? 0} />
            <StatCell label="粉丝" value={viewProfile.followeds ?? 0} />
          </div>

          {/* 快捷按钮 */}
          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={doSignIn}
              className="flex-1 py-2 rounded-xl text-[11px] transition-all shizuku-glass"
              style={{ color: signedIn ? C.muted : C.primary, border: `1px solid ${signedIn ? C.faint : C.primary}30` }}
            >
              {signedIn ? '已签到 ✓' : '每日签到'}
            </button>
            <button
              onClick={async () => {
                if (activeSource === 'qq') {
                  addToast('QQ 音乐暂不支持每日推荐，先从你的 QQ 歌单里听吧', 'info');
                  return;
                }
                try {
                  const r = await musicApi.recommendSongs(cfg);
                  const songs: Song[] = (r?.data?.dailySongs || r?.recommend || []).map((s: any): Song => ({
                    id: s.id, name: s.name,
                    artists: (s.ar || s.artists || []).map((a: any) => a.name).join(' / '),
                    album: s.al?.name || s.album?.name || '',
                    albumPic: toHttps(s.al?.picUrl || s.album?.picUrl || ''),
                    duration: (s.dt || s.duration || 0) / 1000,
                    fee: s.fee ?? 0,
                  }));
                  if (!songs.length) { addToast('还没有每日推荐', 'info'); return; }
                  playSong(songs[0], { replaceQueue: songs, startIdx: 0 });
                  onOpenPlayer();
                } catch (e: any) { addToast(`获取失败：${e.message}`, 'error'); }
              }}
              className="flex-1 py-2 rounded-xl text-[11px] transition-all text-white"
              style={{ background: `linear-gradient(135deg, ${C.primary}, ${C.accent})`, boxShadow: `0 2px 10px ${C.glow}30` }}
            >
              每日推荐
            </button>
            <button
              onClick={async () => {
                if (activeSource === 'qq') {
                  addToast('QQ 音乐暂不支持私人 FM，先从你的 QQ 歌单里听吧', 'info');
                  return;
                }
                try {
                  const r = await musicApi.personalFm(cfg);
                  const songs: Song[] = (r?.data || []).map((s: any): Song => ({
                    id: s.id, name: s.name,
                    artists: (s.artists || s.ar || []).map((a: any) => a.name).join(' / '),
                    album: s.album?.name || s.al?.name || '',
                    albumPic: toHttps(s.album?.picUrl || s.al?.picUrl || ''),
                    duration: (s.duration || s.dt || 0) / 1000,
                    fee: s.fee ?? 0,
                  }));
                  if (!songs.length) { addToast('FM 暂无歌曲', 'info'); return; }
                  playSong(songs[0], { replaceQueue: songs, startIdx: 0 });
                  onOpenPlayer();
                } catch (e: any) { addToast(`FM 失败：${e.message}`, 'error'); }
              }}
              className="flex-1 py-2 rounded-xl text-[11px] transition-all shizuku-glass"
              style={{ color: C.accent, border: `1px solid ${C.accent}30` }}
            >
              私人 FM
            </button>
          </div>

          <button
            onClick={doLogout}
            className="w-full mt-2 py-1.5 rounded-xl text-[10px] transition-all"
            style={{ color: C.faint }}
          >
            退出{sourceLabel}
          </button>
        </div>

        {/* 拜访 · 其他人的音乐角落 */}
        {onVisitChar && characters.length > 0 && (
          <div className="mx-4 mt-4">
            <div className="flex items-center gap-2 mb-2 px-1">
              <Sparkle size={6} color={C.lavender} delay={0.4} />
              <span className="text-[10px] tracking-[0.2em] uppercase" style={{ color: C.muted }}>
                去拜访 · 他们的音乐角落
              </span>
            </div>
            <div className="flex items-center gap-2.5 overflow-x-auto pb-2 shizuku-scrollbar">
              {characters.map(ch => {
                const initialized = !!ch.musicProfile?.initializedAt;
                const avatar = ch.avatar || '';
                const isImage = isMusicAvatarImage(avatar);
                return (
                  <button
                    key={ch.id}
                    onClick={() => onVisitChar(ch.id)}
                    className="shrink-0 text-center group"
                    title={initialized ? `拜访 ${ch.name} 的音乐角落` : `${ch.name} 还没开启音乐角落`}
                  >
                    <div className="relative w-14 h-14 mx-auto">
                      {isImage ? (
                        <img
                          src={avatar}
                          alt=""
                          className="w-14 h-14 rounded-full object-cover transition-transform group-active:scale-95"
                          style={{
                            border: `2px solid ${initialized ? C.accent : C.faint}60`,
                            boxShadow: initialized ? `0 2px 12px ${C.glow}40` : 'none',
                            opacity: initialized ? 1 : 0.55,
                          }}
                        />
                      ) : (
                        <div
                          className="w-14 h-14 rounded-full flex items-center justify-center text-white text-lg font-semibold transition-transform group-active:scale-95"
                          style={{
                            background: initialized
                              ? `linear-gradient(135deg, ${C.primary}, ${C.lavender})`
                              : `linear-gradient(135deg, ${C.faint}, ${C.muted})`,
                            border: `2px solid ${initialized ? C.accent : C.faint}60`,
                            boxShadow: initialized ? `0 2px 12px ${C.glow}40` : 'none',
                            opacity: initialized ? 1 : 0.7,
                            fontFamily: `'Noto Serif', serif`,
                          }}
                        >
                          {avatar || ch.name.slice(0, 1)}
                        </div>
                      )}
                      {!initialized && (
                        <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold"
                          style={{ background: C.bg, color: C.muted, border: `1px solid ${C.faint}60` }}>
                          +
                        </div>
                      )}
                    </div>
                    <div className="text-[10px] mt-1 max-w-[60px] truncate"
                      style={{ color: initialized ? C.text : C.faint }}>
                      {ch.name}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="mx-4 mt-5 flex items-center gap-1 shizuku-glass rounded-full p-1">
          {([
            { k: 'playlist', label: '歌单' },
            { k: 'record', label: '最近' },
            { k: 'cloud', label: '云盘' },
          ] as const).map(t => (
            <button
              key={t.k}
              onClick={() => setTab(t.k)}
              className="flex-1 py-1.5 rounded-full text-[11px] tracking-wider transition-all"
              style={{
                background: tab === t.k ? `linear-gradient(135deg, ${C.primary}, ${C.accent})` : 'transparent',
                color: tab === t.k ? 'white' : C.muted,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loading && (
          <div className="text-center text-[10px] mt-6" style={{ color: C.faint }}>
            <span className="inline-block w-3 h-3 border-2 rounded-full animate-spin"
              style={{ borderColor: `${C.faint}40`, borderTopColor: C.primary }} />
            <span className="ml-2">loading...</span>
          </div>
        )}

        {tab === 'playlist' && (
          <div className="px-3 mt-3 space-y-2">
            {localAlbumSongs.length > 0 && (
              <LocalAlbumCard
                songs={localAlbumSongs}
                expanded={localAlbumExpanded}
                setExpanded={setLocalAlbumExpanded}
                currentId={current?.id ?? null}
                playing={playing}
                onPlay={(s, idx) => playSong(s, { alsoSetQueue: true, replaceQueue: localAlbumSongs, startIdx: idx })}
                onRemove={removeLocalSong}
              />
            )}
            {playlists.length === 0 && !loading && localAlbumSongs.length === 0 && (
              <div className="text-center text-[11px] py-10" style={{ color: C.faint }}>还没有歌单</div>
            )}
            {playlists.map(pl => (
              <div key={playlistKey(pl)} className="rounded-2xl shizuku-glass overflow-hidden">
                {(() => {
                  const key = playlistKey(pl);
                  const tracks = plTracks[key] || [];
                  return (
                    <>
                      <button
                        onClick={() => expandPlaylist(pl)}
                        className="w-full flex items-center gap-3 p-2.5 text-left"
                      >
                        <img src={pl.coverImgUrl || 'https://p1.music.126.net/y19E5SadGUmSR8SZxkrNtw==/109951163965029180.jpg'} alt=""
                          className="w-12 h-12 rounded-xl object-cover"
                          style={{ border: `1px solid ${C.faint}30` }} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm truncate" style={{ color: C.text }}>{pl.name}</div>
                          <div className="text-[10px] truncate" style={{ color: C.muted }}>
                            {pl.trackCount} 首 · {pl.subscribed ? '收藏' : '创建'}
                            {pl.creatorNickname && ` · ${pl.creatorNickname}`}
                          </div>
                        </div>
                        <div className="text-[10px] shrink-0" style={{ color: C.accent }}>
                          {expandedPl === key ? '收起' : '展开'}
                        </div>
                      </button>
                      {expandedPl === key && (
                        <div className="border-t px-2 py-1" style={{ borderColor: `${C.faint}20` }}>
                          {tracks.slice(0, 30).map(s => (
                            <button key={`${s.source || 'netease'}-${s.id}`}
                              onClick={() => {
                                playSong(s, { replaceQueue: tracks, startIdx: tracks.findIndex(x => x.id === s.id) });
                                onOpenPlayer();
                              }}
                              className="w-full text-left flex items-center gap-2 py-1.5 px-1">
                              <img src={s.albumPic || 'https://p1.music.126.net/y19E5SadGUmSR8SZxkrNtw==/109951163965029180.jpg'} alt="" className="w-7 h-7 rounded-md object-cover" />
                              <div className="flex-1 min-w-0">
                                <div className="text-[11px] truncate" style={{ color: C.text }}>{s.name}</div>
                                <div className="text-[9px] truncate" style={{ color: C.muted }}>{s.artists}</div>
                              </div>
                            </button>
                          ))}
                          {tracks.length === 0 && (
                            <div className="text-[10px] text-center py-2" style={{ color: C.faint }}>加载中...</div>
                          )}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            ))}
          </div>
        )}

        {tab === 'record' && (
          <div className="px-3 mt-3 space-y-1">
            {activeSource === 'qq' && records.length === 0 && !loading && (
              <div className="text-center text-[11px] py-10" style={{ color: C.faint }}>QQ 音乐最近播放暂未接入，歌单可以正常播放</div>
            )}
            {activeSource !== 'qq' && records.length === 0 && !loading && (
              <div className="text-center text-[11px] py-10" style={{ color: C.faint }}>最近一周还没有播放记录</div>
            )}
            {records.map((r, i) => (
              <button key={r.song.id + '-' + i}
                onClick={() => {
                  const q = records.map(x => x.song);
                  playSong(r.song, { replaceQueue: q, startIdx: i });
                  onOpenPlayer();
                }}
                className="w-full flex items-center gap-3 p-2 rounded-2xl text-left transition-all"
                style={{ background: 'rgba(255,255,255,0.06)' }}
              >
                <div className="text-[10px] w-5 text-center shrink-0" style={{ color: C.faint }}>{i + 1}</div>
                <img src={r.song.albumPic} alt="" className="w-10 h-10 rounded-lg object-cover" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate" style={{ color: C.text }}>{r.song.name}</div>
                  <div className="text-[10px] truncate" style={{ color: C.muted }}>{r.song.artists}</div>
                </div>
                <div className="text-[9px] shrink-0 text-right" style={{ color: C.accent }}>
                  <div>×{r.playCount}</div>
                  <div className="opacity-60">{Math.round(r.score)}°</div>
                </div>
              </button>
            ))}
          </div>
        )}

        {tab === 'cloud' && (
          <div className="px-3 mt-3 space-y-1">
            {activeSource === 'qq' && cloud.length === 0 && !loading && (
              <div className="text-center text-[11px] py-10" style={{ color: C.faint }}>QQ 音乐没有对应的网易云盘入口</div>
            )}
            {activeSource !== 'qq' && cloud.length === 0 && !loading && (
              <div className="text-center text-[11px] py-10" style={{ color: C.faint }}>云盘里还没有歌曲</div>
            )}
            {cloud.map((s, i) => (
              <button key={s.id + '-' + i}
                onClick={() => { playSong(s, { replaceQueue: cloud, startIdx: i }); onOpenPlayer(); }}
                className="w-full flex items-center gap-3 p-2 rounded-2xl text-left transition-all"
                style={{ background: 'rgba(255,255,255,0.06)' }}
              >
                <img src={s.albumPic || 'https://p1.music.126.net/y19E5SadGUmSR8SZxkrNtw==/109951163965029180.jpg'}
                  alt="" className="w-10 h-10 rounded-lg object-cover" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate" style={{ color: C.text }}>{s.name}</div>
                  <div className="text-[10px] truncate" style={{ color: C.muted }}>{s.artists} · {s.album}</div>
                </div>
              </button>
            ))}
          </div>
        )}
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
          regenStatus={current.id === regeneratingId ? regeneratingStatus : undefined}
        />
      )}
    </div>
  );
};

const StatCell: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="rounded-xl py-1.5 shizuku-glass">
    <div className="text-base font-light" style={{ color: C.primary, fontFamily: `'Noto Serif', serif` }}>{value}</div>
    <div className="text-[9px] tracking-wider" style={{ color: C.muted }}>{label}</div>
  </div>
);

export default NeteaseProfilePage;
