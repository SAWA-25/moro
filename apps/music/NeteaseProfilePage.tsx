/**
 * 网易云「我的」主页
 * - 未登录: 扫码登录 / 手机验证码登录
 * - 已登录: 昵称 + 头像 + 签名 + VIP + 签到 + 我的歌单 + 播放记录 + 云盘
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOS } from '../../context/OSContext';
import { useMusic, musicApi, toHttps, Song } from '../../context/MusicContext';
import { shareToExternalMusicApp, type MusicExternalShareItem } from '../../utils/musicExternalShare';
import {
  C, Sparkle, MizuHeader, BokehBg, MiniPlayer, isMusicAvatarImage,
} from './MusicUI';
import { MagnifyingGlass, Gear, Heart, User as UserIcon, PaperPlaneRight, ShareNetwork, X } from '@phosphor-icons/react';
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
  onShareSong?: (song: Song) => void;
  onOpenArtist?: (artist: { id?: number | string; name: string; source?: 'netease' | 'qq' }) => void;
  onSharePlaylist?: (playlist: Playlist) => void;
  onShareExternal?: (item: MusicExternalShareItem) => void;
  openUserProfile?: { userId: string | number; nickname?: string; avatarUrl?: string; source?: MusicSource } | null;
  onConsumedOpenUserProfile?: () => void;
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

interface SocialUser {
  userId: number | string;
  nickname: string;
  avatarUrl: string;
  signature?: string;
}

const mapSocialUser = (u: any): SocialUser | null => {
  const userId = u?.userId ?? u?.user_id ?? u?.id;
  const nickname = u?.nickname || u?.userName || u?.name || '';
  if (userId == null || !nickname) return null;
  return {
    userId,
    nickname,
    avatarUrl: toHttps(u?.avatarUrl || u?.avatar || ''),
    signature: u?.signature || u?.description || '',
  };
};

const playlistKey = (pl: Playlist) => `${pl.source || 'netease'}:${pl.id}`;

const stableQQSongId = (key: string) => {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash += (hash << 5) + key.charCodeAt(i);
  return -Math.max(1, hash & 2147483647);
};

const mapQQSong = (s: any): Song => {
  const qqSongMid = String(s?.qqSongMid || s?.songmid || s?.song_mid || s?.mid || '').trim();
  const qqMediaMid = String(s?.qqMediaMid || s?.mediaMid || s?.strMediaMid || qqSongMid).trim();
  const id = Number(s?.id) || stableQQSongId(`qq:${qqSongMid || s?.name || s?.songname || ''}`);
  return {
    id,
    name: s?.name || s?.songname || '',
    artists: s?.artists || s?.singername || '',
    artistIds: Array.isArray(s?.singers)
      ? s.singers
        .map((a: any) => ({ id: a.mid || a.id || a.singer_mid, name: a.name || a.singer_name, source: 'qq' as const }))
        .filter((a: any) => a.id && a.name)
      : undefined,
    album: s?.album || s?.albumname || '',
    albumPic: toHttps(s?.albumPic || s?.albumurl || s?.pic || ''),
    duration: Number(s?.duration || s?.interval || 0) || 0,
    fee: s?.fee ?? 0,
    source: 'qq',
    qqSongMid,
    qqMediaMid,
    qqSongId: s?.qqSongId || s?.rawSongId || s?.songid,
  };
};

const SongLikeButton: React.FC<{
  song: Song;
  liked: boolean;
  onToggle: (song: Song) => void;
}> = ({ song, liked, onToggle }) => (
  <button
    type="button"
    onClick={(e) => {
      e.stopPropagation();
      onToggle(song);
    }}
    className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-all active:scale-90"
    style={{
      color: liked ? C.sakura : C.faint,
      background: liked ? `${C.sakura}18` : 'rgba(255,255,255,0.18)',
      border: `1px solid ${liked ? C.sakura : C.faint}30`,
    }}
    title={liked ? '取消喜欢' : '喜欢'}
    aria-label={liked ? `取消喜欢 ${song.name}` : `喜欢 ${song.name}`}
  >
    <Heart size={14} weight={liked ? 'fill' : 'regular'} />
  </button>
);

// ─── 「一起写的歌」本地专辑卡 — 写歌 App 同步过来的 ACE-Step / MiniMax 出歌 ───
interface LocalAlbumCardProps {
  songs: Song[];
  expanded: boolean;
  setExpanded: (next: ((v: boolean) => boolean) | boolean) => void;
  currentId: number | null;
  playing: boolean;
  onPlay: (song: Song, idx: number) => void;
  onRemove: (id: number) => void;
  onShare?: (song: Song) => void;
}
const LocalAlbumCard: React.FC<LocalAlbumCardProps> = ({ songs, expanded, setExpanded, currentId, playing, onPlay, onRemove, onShare }) => (
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
              {onShare && (
                <button
                  type="button"
                  onClick={() => onShare(s)}
                  className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 transition-all active:scale-90"
                  style={{ color: C.accent, background: `${C.glow}28`, border: `1px solid ${C.faint}35` }}
                  title="分享给角色"
                  aria-label="分享给角色"
                >
                  <PaperPlaneRight size={12} weight="fill" />
                </button>
              )}
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

const NeteaseProfilePage: React.FC<Props> = ({ onBack, onOpenPlayer, onOpenSearch, onOpenSettings, onVisitChar, onQQMusicConnected, onShareSong, onOpenArtist, onSharePlaylist, onShareExternal, openUserProfile, onConsumedOpenUserProfile }) => {
  const { addToast, characters, userProfile } = useOS();
  const {
    cfg, setCfg, profile, refreshProfile, playSong,
    current, playing, togglePlay, nextSong, prevSong,
    listeningTogetherWith, removeListeningPartner,
    localAlbumSongs, removeLocalSong,
    isSongLiked, toggleSongLike,
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
  const [remoteProfile, setRemoteProfile] = useState<ProfileView | null>(null);
  const [socialPanel, setSocialPanel] = useState<{ kind: 'follows' | 'followeds'; owner: ProfileView; users: SocialUser[]; loading: boolean } | null>(null);

  const hasNetease = !!remoteProfile || (!!cfg.cookie && !!profile);
  const hasQQ = !!cfg.qqMusic;
  const uid = profile?.userId;
  const activeUid = remoteProfile?.userId || uid;
  const qqAccount = cfg.qqMusic || null;

  // 把不稳定的引用（每秒重建的 addToast 和 cfg 对象）收到 ref 里，
  // 否则 reload 的 deps 会爆炸 → useEffect 循环触发。
  const toastRef = useRef(addToast);
  toastRef.current = addToast;
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;

  const toggleTrackLike = useCallback((song: Song) => {
    void toggleSongLike(song);
  }, [toggleSongLike]);

  const openSongArtist = useCallback((song: Song) => {
    const first = song.artistIds?.[0];
    const fallbackName = song.artists.split(/\s*\/\s*/).find(Boolean)?.trim();
    const name = first?.name || fallbackName;
    if (!name) return;
    onOpenArtist?.({
      id: first?.id,
      name,
      source: first?.source || (song.source === 'qq' ? 'qq' : 'netease'),
    });
  }, [onOpenArtist]);

  useEffect(() => {
    if (activeSource === 'netease' && !hasNetease && hasQQ) {
      setActiveSource('qq');
    } else if (activeSource === 'qq' && !hasQQ && hasNetease) {
      setActiveSource('netease');
    } else if (!hasNetease && !hasQQ && activeSource !== 'netease') {
      setActiveSource('netease');
    }
  }, [activeSource, hasNetease, hasQQ]);

  const openNeteaseUser = useCallback(async (user: { userId: string | number; nickname?: string; avatarUrl?: string }) => {
    const userId = Number(user.userId);
    if (!Number.isFinite(userId)) return;
    setActiveSource('netease');
    setSocialPanel(null);
    setRemoteProfile({
      userId: String(userId),
      nickname: user.nickname || '网易云用户',
      avatarUrl: toHttps(user.avatarUrl || ''),
      signature: '',
      follows: 0,
      followeds: 0,
      playlistCount: 0,
    });
    setTab('playlist');
    try {
      const r = await musicApi.userDetail(cfgRef.current, userId);
      const p = r?.profile || r?.data?.profile || {};
      setRemoteProfile(prev => ({
        userId: String(p.userId || userId),
        nickname: p.nickname || prev?.nickname || user.nickname || '网易云用户',
        avatarUrl: toHttps(p.avatarUrl || prev?.avatarUrl || user.avatarUrl || ''),
        signature: p.signature || '',
        backgroundUrl: toHttps(p.backgroundUrl || ''),
        vipType: p.vipType || 0,
        follows: p.follows || 0,
        followeds: p.followeds || 0,
        playlistCount: p.playlistCount || 0,
      }));
    } catch {
      // 个人详情失败时保留传入的头像和昵称，歌单列表仍可继续尝试加载。
    }
  }, []);

  useEffect(() => {
    if (!openUserProfile) return;
    if (openUserProfile.source === 'qq') {
      addToast('QQ 音乐用户主页会在外部打开', 'info');
      onShareExternal?.({ kind: 'profile', title: openUserProfile.nickname || 'QQ 音乐主页', id: openUserProfile.userId, source: 'qq' });
    } else {
      void openNeteaseUser(openUserProfile);
    }
    onConsumedOpenUserProfile?.();
  }, [addToast, onConsumedOpenUserProfile, onShareExternal, openNeteaseUser, openUserProfile]);

  useEffect(() => {
    setPlaylists([]);
    setRecords([]);
    setCloud([]);
    setExpandedPl(null);
    setPlTracks({});
    setSignedIn(false);
  }, [activeSource, activeUid, qqAccount?.uin]);

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

  const profileIsRemote = activeSource === 'netease' && !!remoteProfile;
  const viewProfile = profileIsRemote ? remoteProfile : (activeSource === 'qq' ? (qqProfile || qqFallbackProfile) : neteaseProfileView);
  const sourceLabel = activeSource === 'qq' ? 'QQ 音乐' : '网易云';

  // VIP 标签 —— 无论登录与否都必须先算（hooks 必须恒定顺序，不能放到 early-return 后）
  const vipLabel = useMemo(() => {
    if (activeSource === 'qq') return 'QQ 音乐';
    const v = viewProfile?.vipType || 0;
    if (v >= 110) return '黑胶 SVIP';
    if (v >= 10) return '黑胶 VIP';
    if (v > 0) return 'VIP';
    return '普通用户';
  }, [activeSource, viewProfile?.vipType]);

  // 加载当前来源的歌单 / 播放记录 / 云盘
  // 重点：cfg / toast 通过 ref 读取，避免 OSContext 每秒 tick 触发循环刷新
  const reload = useCallback(async () => {
    const curCfg = cfgRef.current;
    const targetUid = Number(activeUid || uid);
    if (activeSource === 'netease' && !targetUid) return;
    if (activeSource === 'qq' && !curCfg.qqMusic) return;
    setLoading(true);
    try {
      if (activeSource === 'qq') {
        const [plRes, recRes] = await Promise.allSettled([
          musicApi.qqUserPlaylist(curCfg),
          musicApi.qqUserRecord(curCfg),
        ]);
        if (plRes.status === 'rejected' && recRes.status === 'rejected') throw plRes.reason;
        const r = plRes.status === 'fulfilled' ? plRes.value : null;
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
        if (recRes.status === 'fulfilled') {
          const mappedRecords: RecordItem[] = (recRes.value?.records || [])
            .map((r: any, i: number): RecordItem => ({
              score: Number(r?.score ?? Math.max(1, 100 - i * 3)) || 0,
              playCount: Number(r?.playCount ?? r?.play_count ?? 1) || 1,
              song: mapQQSong(r?.song || r),
            }))
            .filter((r: RecordItem) => !!r.song.qqSongMid);
          setRecords(mappedRecords);
        } else {
          setRecords([]);
        }
        setCloud([]);
        return;
      }
      if (!targetUid) return;

      const [plRes, recRes, clRes] = await Promise.allSettled([
        musicApi.userPlaylist(curCfg, targetUid),
        musicApi.userRecord(curCfg, targetUid, 1),
        targetUid === uid ? musicApi.userCloud(curCfg) : Promise.resolve(null),
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
            artistIds: (r.song?.ar || [])
              .map((a: any) => ({ id: a.id, name: a.name, source: 'netease' as const }))
              .filter((a: any) => a.id && a.name),
            album: r.song?.al?.name || '',
            albumPic: toHttps(r.song?.al?.picUrl || ''),
            duration: (r.song?.dt || 0) / 1000,
            fee: r.song?.fee ?? 0,
          },
        }));
        setRecords(mapped);
      }

      if (clRes.status === 'fulfilled' && clRes.value) {
        const clData = clRes.value?.data || [];
        const mapped: Song[] = clData.map((c: any): Song => ({
          id: c.songId || c.simpleSong?.id,
          name: c.songName || c.simpleSong?.name || '',
          artists: c.artist || (c.simpleSong?.ar || []).map((a: any) => a.name).join(' / '),
          artistIds: (c.simpleSong?.ar || [])
            .map((a: any) => ({ id: a.id, name: a.name, source: 'netease' as const }))
            .filter((a: any) => a.id && a.name),
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
  }, [activeSource, activeUid, uid, qqAccount?.uin]);

  useEffect(() => { reload(); }, [reload]);

  const openSocialList = useCallback(async (kind: 'follows' | 'followeds', owner: ProfileView) => {
    const ownerUid = Number(owner.userId);
    if (!Number.isFinite(ownerUid)) return;
    if (activeSource !== 'netease') {
      toastRef.current('QQ 音乐关注列表暂不支持在 Moro 内查看', 'info');
      return;
    }
    setSocialPanel({ kind, owner, users: [], loading: true });
    try {
      const res = kind === 'follows'
        ? await musicApi.userFollows(cfgRef.current, ownerUid, 60, 0)
        : await musicApi.userFolloweds(cfgRef.current, ownerUid, 60, 0);
      const raw = res?.follow || res?.followeds || res?.data?.follow || res?.data?.followeds || res?.data?.users || res?.users || [];
      const users = (Array.isArray(raw) ? raw : [])
        .map(mapSocialUser)
        .filter((u): u is SocialUser => !!u);
      setSocialPanel({ kind, owner, users, loading: false });
    } catch (e: any) {
      toastRef.current(`关注列表加载失败：${e?.message || '未知错误'}`, 'error');
      setSocialPanel(prev => prev && prev.owner.userId === owner.userId && prev.kind === kind
        ? { ...prev, loading: false }
        : prev);
    }
  }, [activeSource]);

  // 展开歌单 — 同样用 ref 去稳定化 cfg / addToast
  const expandPlaylist = useCallback(async (pl: Playlist) => {
    const key = playlistKey(pl);
    if (expandedPl === key) { setExpandedPl(null); return; }
    setExpandedPl(key);
    if (plTracks[key]) return;
    try {
      if ((pl.source || activeSource) === 'qq') {
        const r = await musicApi.qqPlaylistDetail(cfgRef.current, pl.id);
        const songs: Song[] = (r?.songs || []).map(mapQQSong).filter((s: Song) => !!s.qqSongMid);
        setPlTracks(prev => ({ ...prev, [key]: songs }));
      } else {
        const r = await musicApi.playlistTrackAll(cfgRef.current, pl.id as number, 100, 0);
        const songs: Song[] = (r?.songs || []).map((s: any) => ({
          id: s.id,
          name: s.name,
          artists: (s.ar || []).map((a: any) => a.name).join(' / '),
          artistIds: (s.ar || [])
            .map((a: any) => ({ id: a.id, name: a.name, source: 'netease' as const }))
            .filter((a: any) => a.id && a.name),
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

  const sharePlaylistExternal = useCallback(async (pl: Playlist) => {
    const item: MusicExternalShareItem = {
      kind: 'playlist',
      title: pl.name,
      subtitle: `${pl.trackCount || 0} 首 · ${pl.creatorNickname || sourceLabel}`,
      image: pl.coverImgUrl,
      id: pl.id,
      source: pl.source || activeSource,
    };
    try {
      if (onShareExternal) {
        await Promise.resolve(onShareExternal(item));
      } else {
        await shareToExternalMusicApp(item);
        toastRef.current('已打开外部音乐分享', 'success');
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') toastRef.current(`外部分享失败：${err?.message || err}`, 'error');
    }
  }, [activeSource, onShareExternal, sourceLabel]);

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
              onShare={onShareSong}
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

          {profileIsRemote && (
            <button
              type="button"
              onClick={() => {
                setRemoteProfile(null);
                setSocialPanel(null);
                setTab('playlist');
              }}
              className="w-full mt-3 py-1.5 rounded-full text-[10px] transition-all shizuku-glass"
              style={{ color: C.primary, border: `1px solid ${C.accent}28` }}
            >
              返回我的网易云主页
            </button>
          )}

          {!profileIsRemote && (hasNetease || hasQQ) && (
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
            <StatCell
              label="关注"
              value={viewProfile.follows ?? 0}
              onClick={activeSource === 'netease' ? () => openSocialList('follows', viewProfile) : undefined}
            />
            <StatCell
              label="粉丝"
              value={viewProfile.followeds ?? 0}
              onClick={activeSource === 'netease' ? () => openSocialList('followeds', viewProfile) : undefined}
            />
          </div>

          {!profileIsRemote && (
            <>
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
                    artistIds: (s.ar || s.artists || [])
                      .map((a: any) => ({ id: a.id, name: a.name, source: 'netease' as const }))
                      .filter((a: any) => a.id && a.name),
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
                    artistIds: (s.artists || s.ar || [])
                      .map((a: any) => ({ id: a.id, name: a.name, source: 'netease' as const }))
                      .filter((a: any) => a.id && a.name),
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
            </>
          )}
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
            {!profileIsRemote && localAlbumSongs.length > 0 && (
              <LocalAlbumCard
                songs={localAlbumSongs}
                expanded={localAlbumExpanded}
                setExpanded={setLocalAlbumExpanded}
                currentId={current?.id ?? null}
                playing={playing}
                onPlay={(s, idx) => playSong(s, { alsoSetQueue: true, replaceQueue: localAlbumSongs, startIdx: idx })}
                onRemove={removeLocalSong}
                onShare={onShareSong}
              />
            )}
            {playlists.length === 0 && !loading && (profileIsRemote || localAlbumSongs.length === 0) && (
              <div className="text-center text-[11px] py-10" style={{ color: C.faint }}>还没有歌单</div>
            )}
            {playlists.map(pl => (
              <div key={playlistKey(pl)} className="rounded-2xl shizuku-glass overflow-hidden">
                {(() => {
                  const key = playlistKey(pl);
                  const tracks = plTracks[key] || [];
                  return (
                    <>
                      <div className="w-full flex items-center gap-2 p-2.5">
                        <button
                          onClick={() => expandPlaylist(pl)}
                          className="flex-1 min-w-0 flex items-center gap-3 text-left"
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
                        </button>
                        <div className="flex items-center gap-1 shrink-0">
                          {onSharePlaylist && (
                            <button
                              type="button"
                              onClick={() => onSharePlaylist(pl)}
                              className="w-8 h-8 rounded-full flex items-center justify-center transition-all active:scale-90"
                              style={{ color: C.accent, background: `${C.glow}22`, border: `1px solid ${C.faint}30` }}
                              title="分享给角色"
                              aria-label="分享给角色"
                            >
                              <PaperPlaneRight size={13} weight="fill" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => void sharePlaylistExternal(pl)}
                            className="w-8 h-8 rounded-full flex items-center justify-center transition-all active:scale-90"
                            style={{ color: C.muted, background: 'rgba(255,255,255,0.22)', border: `1px solid ${C.faint}25` }}
                            title="分享到外部音乐 App"
                            aria-label="分享到外部音乐 App"
                          >
                            <ShareNetwork size={13} weight="bold" />
                          </button>
                          <button
                            type="button"
                            onClick={() => expandPlaylist(pl)}
                            className="px-2 py-1 rounded-full text-[10px] transition-all"
                            style={{ color: C.accent, border: `1px solid ${C.accent}25` }}
                          >
                            {expandedPl === key ? '收起' : '展开'}
                          </button>
                        </div>
                      </div>
                      {expandedPl === key && (
                        <div className="border-t px-2 py-1" style={{ borderColor: `${C.faint}20` }}>
                          {tracks.slice(0, 30).map(s => {
                            const liked = s.source === 'qq' && isSongLiked(s);
                            return (
                              <div key={`${s.source || 'netease'}-${s.id}`}
                                className="w-full flex items-center gap-2 py-1.5 px-1 rounded-xl transition-all"
                                style={{ background: liked ? `${C.sakura}08` : 'transparent' }}>
                                <button
                                  onClick={() => {
                                    playSong(s, { replaceQueue: tracks, startIdx: tracks.findIndex(x => x.id === s.id) });
                                    onOpenPlayer();
                                  }}
                                  className="flex-1 min-w-0 text-left flex items-center gap-2">
                                  <img src={s.albumPic || 'https://p1.music.126.net/y19E5SadGUmSR8SZxkrNtw==/109951163965029180.jpg'} alt="" className="w-7 h-7 rounded-md object-cover shrink-0" />
                                  <div className="flex-1 min-w-0">
                                    <div className="text-[11px] truncate" style={{ color: C.text }}>{s.name}</div>
                                    <div
                                      className="text-[9px] truncate cursor-pointer"
                                      style={{ color: C.muted }}
                                      onClick={(e) => { e.stopPropagation(); openSongArtist(s); }}
                                    >
                                      {s.artists}
                                    </div>
                                  </div>
                                </button>
                                {s.source === 'qq' && (
                                  <SongLikeButton song={s} liked={liked} onToggle={toggleTrackLike} />
                                )}
                                {onShareSong && (
                                  <button
                                    type="button"
                                    onClick={() => onShareSong(s)}
                                    className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 transition-all active:scale-90"
                                    style={{ color: C.accent, background: `${C.glow}28`, border: `1px solid ${C.faint}35` }}
                                    title="分享给角色"
                                    aria-label="分享给角色"
                                  >
                                    <PaperPlaneRight size={12} weight="fill" />
                                  </button>
                                )}
                              </div>
                            );
                          })}
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
              <div className="text-center text-[11px] py-10" style={{ color: C.faint }}>QQ 音乐最近还没有可同步的播放记录</div>
            )}
            {activeSource !== 'qq' && records.length === 0 && !loading && (
              <div className="text-center text-[11px] py-10" style={{ color: C.faint }}>最近一周还没有播放记录</div>
            )}
            {records.map((r, i) => (
              <div key={r.song.id + '-' + i}
                className="w-full flex items-center gap-3 p-2 rounded-2xl text-left transition-all"
                style={{ background: 'rgba(255,255,255,0.06)' }}
              >
                <button
                  type="button"
                  onClick={() => {
                    const q = records.map(x => x.song);
                    playSong(r.song, { replaceQueue: q, startIdx: i });
                    onOpenPlayer();
                  }}
                  className="flex-1 min-w-0 flex items-center gap-3 text-left"
                >
                  <div className="text-[10px] w-5 text-center shrink-0" style={{ color: C.faint }}>{i + 1}</div>
                  <img src={r.song.albumPic} alt="" className="w-10 h-10 rounded-lg object-cover" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate" style={{ color: C.text }}>{r.song.name}</div>
                    <div
                      className="text-[10px] truncate cursor-pointer"
                      style={{ color: C.muted }}
                      onClick={(e) => { e.stopPropagation(); openSongArtist(r.song); }}
                    >
                      {r.song.artists}
                    </div>
                  </div>
                </button>
                <div className="text-[9px] shrink-0 text-right" style={{ color: C.accent }}>
                  <div>×{r.playCount}</div>
                  <div className="opacity-60">{Math.round(r.score)}°</div>
                </div>
                {onShareSong && (
                  <button
                    type="button"
                    onClick={() => onShareSong(r.song)}
                    className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-all active:scale-90"
                    style={{ color: C.accent, background: `${C.glow}28`, border: `1px solid ${C.faint}35` }}
                    title="分享给角色"
                    aria-label="分享给角色"
                  >
                    <PaperPlaneRight size={13} weight="fill" />
                  </button>
                )}
              </div>
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
              <div key={s.id + '-' + i}
                className="w-full flex items-center gap-3 p-2 rounded-2xl text-left transition-all"
                style={{ background: 'rgba(255,255,255,0.06)' }}
              >
                <button
                  type="button"
                  onClick={() => { playSong(s, { replaceQueue: cloud, startIdx: i }); onOpenPlayer(); }}
                  className="flex-1 min-w-0 flex items-center gap-3 text-left"
                >
                  <img src={s.albumPic || 'https://p1.music.126.net/y19E5SadGUmSR8SZxkrNtw==/109951163965029180.jpg'}
                    alt="" className="w-10 h-10 rounded-lg object-cover" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate" style={{ color: C.text }}>{s.name}</div>
                    <div
                      className="text-[10px] truncate cursor-pointer"
                      style={{ color: C.muted }}
                      onClick={(e) => { e.stopPropagation(); openSongArtist(s); }}
                    >
                      {s.artists} · {s.album}
                    </div>
                  </div>
                </button>
                {onShareSong && (
                  <button
                    type="button"
                    onClick={() => onShareSong(s)}
                    className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-all active:scale-90"
                    style={{ color: C.accent, background: `${C.glow}28`, border: `1px solid ${C.faint}35` }}
                    title="分享给角色"
                    aria-label="分享给角色"
                  >
                    <PaperPlaneRight size={13} weight="fill" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {socialPanel && (
        <div className="absolute inset-0 z-40 flex items-end" style={{ background: 'rgba(255,255,255,0.42)', backdropFilter: 'blur(3px)' }}>
          <button
            type="button"
            aria-label="关闭关注列表"
            className="absolute inset-0"
            onClick={() => setSocialPanel(null)}
          />
          <div className="relative z-10 mx-3 mb-3 w-[calc(100%-1.5rem)] max-h-[72%] rounded-3xl shizuku-glass-strong overflow-hidden"
            style={{ border: `1px solid ${C.faint}28`, boxShadow: `0 16px 48px ${C.glow}28` }}>
            <div className="px-4 py-3 flex items-center justify-between gap-3" style={{ borderBottom: `1px solid ${C.faint}18` }}>
              <div className="min-w-0">
                <div className="text-sm truncate" style={{ color: C.text }}>{socialPanel.owner.nickname}</div>
                <div className="text-[10px]" style={{ color: C.muted }}>
                  {socialPanel.kind === 'follows' ? '关注列表' : '粉丝列表'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSocialPanel(null)}
                className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                style={{ color: C.muted, background: 'rgba(255,255,255,0.22)' }}
                aria-label="关闭"
              >
                <X size={15} weight="bold" />
              </button>
            </div>
            <div className="max-h-[52vh] overflow-y-auto shizuku-scrollbar px-2 py-2">
              {socialPanel.loading && (
                <div className="text-center text-[11px] py-8" style={{ color: C.faint }}>加载中...</div>
              )}
              {!socialPanel.loading && socialPanel.users.length === 0 && (
                <div className="text-center text-[11px] py-8" style={{ color: C.faint }}>暂时没有可查看的用户</div>
              )}
              {!socialPanel.loading && socialPanel.users.map(user => (
                <button
                  key={`${socialPanel.kind}-${user.userId}`}
                  type="button"
                  onClick={() => void openNeteaseUser(user)}
                  className="w-full flex items-center gap-3 px-2 py-2 rounded-2xl text-left transition-all active:scale-[0.99]"
                  style={{ background: 'rgba(255,255,255,0.08)' }}
                >
                  <img
                    src={user.avatarUrl || 'https://p1.music.126.net/y19E5SadGUmSR8SZxkrNtw==/109951163965029180.jpg'}
                    alt=""
                    className="w-10 h-10 rounded-full object-cover shrink-0"
                    style={{ border: `1px solid ${C.faint}35` }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] truncate" style={{ color: C.text }}>{user.nickname}</div>
                    <div className="text-[10px] truncate mt-0.5" style={{ color: C.muted }}>{user.signature || `UID ${user.userId}`}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

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

const StatCell: React.FC<{ label: string; value: number; onClick?: () => void }> = ({ label, value, onClick }) => {
  const body = (
    <>
      <div className="text-base font-light" style={{ color: C.primary, fontFamily: `'Noto Serif', serif` }}>{value}</div>
      <div className="text-[9px] tracking-wider" style={{ color: C.muted }}>{label}</div>
    </>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className="rounded-xl py-1.5 shizuku-glass transition-all active:scale-95">
        {body}
      </button>
    );
  }
  return <div className="rounded-xl py-1.5 shizuku-glass">{body}</div>;
};

export default NeteaseProfilePage;
