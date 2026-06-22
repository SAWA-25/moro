
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOS } from '../context/OSContext';
import { useMusic, musicApi, normalizeCookie, toHttps, Song } from '../context/MusicContext';
import { DB } from '../utils/db';
import { discussMusic, ListenAction, ListenMsg } from '../utils/listenTogether';
import { resolveAuxApi } from '../utils/auxApi';
import { Gear, User as UserIcon, Crosshair, Play as PlayIcon, Pause as PauseIcon, UsersThree, PaperPlaneRight, DiceFive, SkipForward } from '@phosphor-icons/react';
import {
  C, Sparkle, CrossStar, MizuHeader, SearchBar, SongRow, MiniPlayer,
  VinylDisc, GlassProgress, PlayControls, BokehBg,
  MetaChip, SubActions,
} from './music/MusicUI';
import NeteaseProfilePage from './music/NeteaseProfilePage';
import CharVisitPage from './music/CharVisitPage';

// ------------------------- 工具 -------------------------
const fmtTime = (s: number) => {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${m}:${ss.toString().padStart(2, '0')}`;
};

type View = 'search' | 'settings' | 'player' | 'profile' | 'visit_char' | 'listen_together';

// ========================= 主组件 =========================
const MusicApp: React.FC = () => {
  const { closeApp, addToast, characters, userProfile, apiConfig, auxApiConfig } = useOS();
  // 一起听·角色乐评属「聊天以外」的功能：走副 API（未配置副 API 时回退主 API）
  const auxApi = { ...apiConfig, ...resolveAuxApi(auxApiConfig, apiConfig) };
  const {
    cfg, setCfg,
    current, playing, progress, duration, loadingSong,
    lyric, tlyric, activeLyricIdx,
    profile, playSong, togglePlay, nextSong, prevSong, seek,
    liked, toggleLike, setToastHandler,
    listeningTogetherWith, addListeningPartner, removeListeningPartner,
    addLocalSong, removeLocalSong, localAlbumSongs,
    playMode, setPlayMode,
    regeneratingId, regeneratingStatus,
  } = useMusic();
  const isCurrentRegenerating = !!current && current.id === regeneratingId;
  // 把对轴入口和单曲循环按钮移到 SubActions 里，避免散乱
  // 下载本地生成的歌曲到本地文件系统
  const downloadCurrentLocal = useCallback(async () => {
    if (!current?.local || !current.localAssetKey) return;
    try {
      const entry = await DB.getAssetRaw(current.localAssetKey).catch(() => null) as
        | { blob?: Blob; mimeType?: string }
        | Blob
        | null;
      const blob: Blob | null = entry instanceof Blob
        ? entry
        : (entry?.blob instanceof Blob ? entry.blob : null);
      if (!blob) { addToast('音频文件丢失', 'error'); return; }
      const mime = current.localMimeType || (entry && !(entry instanceof Blob) ? entry.mimeType : '') || blob.type || 'audio/mpeg';
      const ext = /wav/i.test(mime) ? 'wav' : /ogg/i.test(mime) ? 'ogg' : /flac/i.test(mime) ? 'flac' : /m4a|aac|mp4/i.test(mime) ? 'm4a' : 'mp3';
      const safe = (current.name || 'song').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${safe}.${ext}`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      addToast('已下载', 'success');
    } catch {
      addToast('下载失败', 'error');
    }
  }, [current, addToast]);

  const cyclePlayMode = useCallback(() => {
    const order: ('loop' | 'single' | 'shuffle')[] = ['loop', 'single', 'shuffle'];
    const next = order[(order.indexOf(playMode) + 1) % order.length];
    setPlayMode(next);
    addToast(next === 'loop' ? '列表循环' : next === 'single' ? '单曲循环' : '随机播放', 'info');
  }, [playMode, setPlayMode, addToast]);

  // 伴听 char 名单（用于 MiniPlayer / 播放页徽章）—— 带头像，给"小情侣"头像块用
  const companions = useMemo(() => {
    return listeningTogetherWith
      .map(id => characters.find(c => c.id === id))
      .filter((c): c is typeof characters[number] => !!c)
      .map(c => ({ id: c.id, name: c.name, avatar: c.avatar }));
  }, [listeningTogetherWith, characters]);

  // 当前歌在哪些 char 的歌单里（用于 MiniPlayer 的"也收藏"提示）
  const charsWithSong = useMemo(() => {
    if (!current) return [];
    return characters
      .map(c => {
        const pl = c.musicProfile?.playlists.find(p => p.songs.some(s => s.id === current.id));
        return pl ? { id: c.id, name: c.name, playlistTitle: pl.title } : null;
      })
      .filter((x): x is { id: string; name: string; playlistTitle: string } => !!x);
  }, [current, characters]);

  // 把 OS toast 注入到 Music Context（这样全局播放报错也能弹 toast）
  useEffect(() => { setToastHandler(addToast); }, [addToast, setToastHandler]);

  const [view, setView] = useState<View>('profile');
  // ── 手动对轴 modal state ──
  const [showLyricSync, setShowLyricSync] = useState(false);
  const [syncDraft, setSyncDraft] = useState<number[]>([]);
  const [visitCharId, setVisitCharId] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState<Song[]>([]);
  const [searching, setSearching] = useState(false);
  const lyricBoxRef = useRef<HTMLDivElement | null>(null);

  // ── 一起听（分享给角色后进入的对话界面）state ──
  // listenCharId：当前和谁一起听；listenMsgs：会话内临时讨论（不落库、不进主聊天）。
  const [listenCharId, setListenCharId] = useState<string | null>(null);
  const [listenMsgs, setListenMsgs] = useState<ListenMsg[]>([]);
  const [listenInput, setListenInput] = useState('');
  const [listenBusy, setListenBusy] = useState(false);
  const [showSharePicker, setShowSharePicker] = useState(false);
  const listenScrollRef = useRef<HTMLDivElement | null>(null);
  // 角色自己换/跳的歌 → 抑制紧接着的 song_changed，避免重复发言或连锁触发。
  const suppressSongChangedRef = useRef(false);
  // 已就当前歌发过言的 songId，避免同一首重复触发 song_changed。
  const lastListenSongRef = useRef<number | null>(null);
  const listenChar = useMemo(() => characters.find(c => c.id === listenCharId) || null, [characters, listenCharId]);

  const songSnapshot = useCallback((s: Song) => ({
    songId: s.id, name: s.name, artists: s.artists, album: s.album,
    albumPic: s.albumPic, duration: s.duration, fee: s.fee,
  }), []);

  // 执行角色的播放控制动作（换歌 / 暂停 / 继续 / 下一首）
  const executeListenAction = useCallback(async (action: ListenAction) => {
    if (action.kind === 'change_song') {
      // 先真实搜索网易云取最佳匹配；搜不到则回退角色歌单 / 一起写的歌。
      try {
        const r = await musicApi.search(cfg, action.query);
        const s: any = (r?.result?.songs || [])[0];
        if (s) {
          const song: Song = {
            id: s.id, name: s.name,
            artists: (s.ar || s.artists || []).map((a: any) => a.name).join(' / '),
            album: s.al?.name || s.album?.name || '',
            albumPic: toHttps(s.al?.picUrl || s.album?.picUrl || ''),
            duration: (s.dt || s.duration || 0) / 1000,
            fee: s.fee ?? 0,
          };
          suppressSongChangedRef.current = true;
          playSong(song);
          return;
        }
      } catch { /* 落到回退 */ }
      // 回退：角色歌单里挑一首，再不行用「一起写的歌」
      const fromPlaylists = listenChar?.musicProfile?.playlists?.flatMap(p => p.songs) || [];
      const fallback = fromPlaylists[0] || localAlbumSongs[0];
      if (fallback) {
        const song: Song = {
          id: fallback.id, name: fallback.name, artists: fallback.artists,
          album: (fallback as any).album || '', albumPic: fallback.albumPic,
          duration: fallback.duration, fee: fallback.fee,
          ...(('local' in fallback) ? fallback as any : {}),
        };
        suppressSongChangedRef.current = true;
        playSong(song);
      } else {
        addToast(`没搜到《${action.query}》`, 'info');
      }
    } else if (action.kind === 'pause') {
      if (playing) togglePlay();
    } else if (action.kind === 'resume') {
      if (!playing) togglePlay();
    } else if (action.kind === 'next') {
      suppressSongChangedRef.current = true;
      nextSong();
    }
  }, [cfg, playSong, listenChar, localAlbumSongs, addToast, playing, togglePlay, nextSong]);

  // 让角色就当前音乐说一句话（一次性调用，不走主聊天管线）
  const runDiscuss = useCallback(async (
    trigger: 'enter' | 'song_changed' | 'take_over' | 'user',
    userMsg?: string,
    historyOverride?: ListenMsg[],
    charIdOverride?: string,
  ) => {
    // setListenCharId 是异步的——shareAndListen 进入时要用 override 拿到刚选的角色，
    // 否则闭包里的 listenCharId 还是上一帧的旧值。
    const char = characters.find(c => c.id === (charIdOverride ?? listenCharId));
    if (!char) return;
    setListenBusy(true);
    try {
      const snap = current ? { name: current.name, artists: current.artists } : null;
      const lyricSnippet = activeLyricIdx >= 0 && lyric[activeLyricIdx] ? lyric[activeLyricIdx].text : undefined;
      const { reply, action } = await discussMusic({
        char, user: userProfile, api: auxApi,
        song: snap, playing, lyricSnippet,
        history: historyOverride ?? listenMsgs, userMsg, trigger,
      });
      setListenMsgs(prev => [...prev, { role: 'char', text: reply, action, at: Date.now() }]);
      if (action.kind !== 'none') await executeListenAction(action);
    } catch (e: any) {
      addToast('一起听暂时没接上', 'error');
    } finally {
      setListenBusy(false);
    }
  }, [characters, listenCharId, current, activeLyricIdx, lyric, userProfile, apiConfig, playing, listenMsgs, executeListenAction, addToast]);

  // 分享当前歌给某角色 → 落一张「一起听」卡片到该角色聊天 + 标记伴听 + 进入一起听界面
  const shareAndListen = useCallback(async (charId: string) => {
    const char = characters.find(c => c.id === charId);
    if (!char) return;
    setShowSharePicker(false);
    if (current) {
      try {
        await DB.saveMessage({
          charId,
          role: 'user',
          type: 'music_card',
          content: '[音乐卡片]',
          metadata: { intent: 'join', song: songSnapshot(current) },
        });
      } catch { /* 落库失败不阻塞进入界面 */ }
      addListeningPartner(charId);
    }
    lastListenSongRef.current = current?.id ?? null;
    suppressSongChangedRef.current = false;
    setListenCharId(charId);
    setListenMsgs([]);
    setListenInput('');
    setView('listen_together');
    // 角色先开口（可能直接挑首歌）；显式传 charId，避开 setListenCharId 的异步。
    runDiscuss('enter', undefined, [], charId);
  }, [characters, current, songSnapshot, addListeningPartner, runDiscuss]);

  const sendListenMsg = useCallback(() => {
    const text = listenInput.trim();
    if (!text || listenBusy) return;
    const next = [...listenMsgs, { role: 'user' as const, text, at: Date.now() }];
    setListenMsgs(next);
    setListenInput('');
    runDiscuss('user', text, next);
  }, [listenInput, listenBusy, listenMsgs, runDiscuss]);

  // 自然切歌（非角色发起）→ 角色随口评一句
  useEffect(() => {
    if (view !== 'listen_together' || !listenCharId || !current) return;
    const id = current.id;
    if (lastListenSongRef.current === id) return;
    lastListenSongRef.current = id;
    // 角色自己换/跳的歌：runDiscuss 已经替它说过话了，别再触发一次
    if (suppressSongChangedRef.current) { suppressSongChangedRef.current = false; return; }
    if (listenBusy) return;
    runDiscuss('song_changed');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, view, listenCharId]);

  // 讨论区自动滚到底
  useEffect(() => {
    if (view !== 'listen_together') return;
    const box = listenScrollRef.current;
    if (box) box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' });
  }, [listenMsgs, listenBusy, view]);

  // 退出一起听界面但保留伴听徽标；点头像可重新进入
  const openListenTogether = useCallback(() => {
    if (listenCharId && listeningTogetherWith.includes(listenCharId)) {
      setView('listen_together');
    } else {
      setShowSharePicker(true);
    }
  }, [listenCharId, listeningTogetherWith]);

  // 歌词自动滚动：把 current line 对齐到滚动容器视觉中心
  // 注意 offsetTop 依赖 offsetParent，容器没 position:relative 时会跨到祖先节点、值偏大，
  // 导致 current line 被推到中心上方。改用 getBoundingClientRect 对齐，和 DOM 嵌套解耦。
  useEffect(() => {
    if (view !== 'player') return;
    const box = lyricBoxRef.current; if (!box || activeLyricIdx < 0) return;
    const el = box.querySelector<HTMLDivElement>(`[data-lyric-idx="${activeLyricIdx}"]`);
    if (!el) return;
    const boxRect = box.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const elTopInBox = elRect.top - boxRect.top + box.scrollTop;
    box.scrollTo({ top: elTopInBox - box.clientHeight / 2 + el.clientHeight / 2, behavior: 'smooth' });
  }, [activeLyricIdx, view]);

  // ── 搜索 ──
  const doSearch = useCallback(async () => {
    const kw = keyword.trim(); if (!kw) return;
    setSearching(true);
    try {
      const r = await musicApi.search(cfg, kw);
      const songs: Song[] = (r?.result?.songs || []).map((s: any) => ({
        id: s.id, name: s.name,
        artists: (s.ar || s.artists || []).map((a: any) => a.name).join(' / '),
        album: s.al?.name || s.album?.name || '',
        albumPic: toHttps(s.al?.picUrl || s.album?.picUrl || ''),
        duration: (s.dt || s.duration || 0) / 1000,
        fee: s.fee ?? 0,
      }));
      setResults(songs);
      if (!songs.length) {
        const hint = r?.msg || r?.message || (r?.code != null ? `code=${r.code}` : '') || '无数据';
        addToast(`没找到: ${hint}`, 'info');
      }
    } catch (e: any) {
      addToast(`搜索失败：${e.message}`, 'error');
    } finally {
      setSearching(false);
    }
  }, [keyword, cfg, addToast]);

  // ════════════════ 搜索页 ════════════════
  const renderSearch = () => (
    <div className="flex flex-col h-full relative"
      style={{ background: `linear-gradient(180deg, #ffffff 0%, ${C.bg} 50%, ${C.bgDeep} 100%)` }}>
      <BokehBg />
      <MizuHeader
        title="未来音楽"
        onClose={closeApp}
        right={
          <div className="flex items-center gap-1">
            <button
              onClick={() => setView('profile')}
              className="p-1.5 rounded-full transition-all"
              style={{ color: C.primary }}
              title="我的"
            >
              <UserIcon size={16} weight="bold" />
            </button>
            <button
              onClick={() => setView('settings')}
              className="p-1.5 rounded-full transition-all"
              style={{ color: C.primary }}
            >
              <Gear size={16} weight="bold" />
            </button>
          </div>
        }
      />
      <SearchBar value={keyword} onChange={setKeyword} onSearch={doSearch} searching={searching} />

      {/* 用户状态 — 玻璃标签 */}
      {profile && (
        <div className="px-5 -mt-1 mb-1.5 flex items-center gap-1.5 relative z-10">
          <button
            onClick={() => setView('profile')}
            className="inline-flex items-center gap-2 pl-0.5 pr-3 py-0.5 rounded-full text-[10px] shizuku-glass cursor-pointer"
            style={{ color: C.muted }}
          >
            {profile.avatarUrl ? (
              <img src={profile.avatarUrl} alt="" className="w-5 h-5 rounded-full object-cover" />
            ) : <Sparkle size={6} color={C.sakura} delay={0.3} />}
            {profile.nickname} · {cfg.quality}
          </button>
        </div>
      )}
      {!cfg.cookie && (
        <div className="px-5 -mt-1 mb-1.5 relative z-10">
          <button
            onClick={() => setView('profile')}
            className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] cursor-pointer"
            style={{ background: `${C.vip}18`, color: C.vip, border: `1px solid ${C.vip}30` }}
          >
            未登录 — 点击登录网易云
          </button>
        </div>
      )}

      {/* 歌曲列表 */}
      <div className="flex-1 overflow-y-auto px-2 pb-24 relative z-10 shizuku-scrollbar">
        {results.length === 0 && !searching && (
          <div className="text-center mt-16 space-y-4">
            <div className="relative inline-block">
              <Sparkle size={24} className="mx-auto" color={C.glow} delay={0} />
              <Sparkle size={12} className="absolute -top-1 -right-3" color={C.sakura} delay={0.8} />
              <Sparkle size={8} className="absolute -bottom-2 -left-2" color={C.lavender} delay={1.5} />
            </div>
            <div className="text-xs italic" style={{ color: C.faint, fontFamily: `'Georgia', serif` }}>
              搜一首想听的歌吧
            </div>
          </div>
        )}
        {results.map(s => (
          <SongRow
            key={s.id}
            name={s.name}
            artists={s.artists}
            album={s.album}
            albumPic={s.albumPic}
            duration={fmtTime(s.duration)}
            isVip={s.fee === 1}
            isActive={current?.id === s.id}
            onClick={() => playSong(s)}
          />
        ))}
      </div>

      {current && (
        <MiniPlayer
          name={current.name}
          artists={current.artists}
          albumPic={current.albumPic}
          playing={playing}
          onTap={() => setView('player')}
          onPrev={prevSong}
          onToggle={togglePlay}
          onNext={nextSong}
          userAvatar={userProfile?.avatar}
          userName={userProfile?.name}
          companions={companions}
          onKickCompanion={removeListeningPartner}
          charsWithSong={charsWithSong}
          regenStatus={isCurrentRegenerating ? regeneratingStatus : undefined}
        />
      )}
    </div>
  );

  // ════════════════ 播放页 ════════════════
  const bitrateMap: Record<string, string> = {
    standard: '128 kbps',
    higher:   '192 kbps',
    exhigh:   '320 kbps',
    lossless: '1411 kbps',
    hires:    '24bit · Hi-Res',
  };

  const renderPlayer = () => {
    if (!current) return null;
    return (
      <div className="flex flex-col h-full relative"
        style={{ background: `linear-gradient(180deg, #ffffff 0%, ${C.bg} 60%, ${C.bgDeep} 100%)` }}>
        <BokehBg />
        <MizuHeader
          title="Now Playing"
          onBack={() => setView('search')}
          right={
            <button
              onClick={openListenTogether}
              className="relative p-1.5 rounded-full transition-all active:scale-90"
              style={{ color: companions.length ? C.sakura : C.primary }}
              title="分享给角色 · 一起听"
            >
              <UsersThree size={18} weight={companions.length ? 'fill' : 'bold'} />
              {companions.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full" style={{ background: C.sakura, boxShadow: `0 0 0 1.5px ${C.bg}` }} />
              )}
            </button>
          }
        />

        <div className="flex-1 flex flex-col items-center px-5 pt-4 pb-3 relative z-10 overflow-hidden">
          <div className="shrink-0 mt-1 relative">
            <VinylDisc albumPic={current.albumPic} playing={playing} size={150} bitrate={bitrateMap[cfg.quality]} />
            {/* 重录中覆盖层 — 只在本地歌且 regeneratingId 匹配时显示 */}
            {isCurrentRegenerating && (
              <div className="absolute inset-0 rounded-full flex items-center justify-center pointer-events-none"
                style={{
                  background: `radial-gradient(circle, rgba(0,0,0,0.55) 30%, rgba(0,0,0,0.35) 70%)`,
                  backdropFilter: 'blur(6px)',
                  WebkitBackdropFilter: 'blur(6px)',
                  boxShadow: `0 0 30px ${C.glow}80`,
                  animation: 'shizuku-glow 2s ease-in-out infinite',
                }}
              >
                <div className="text-center space-y-1.5 px-3">
                  <div className="w-7 h-7 mx-auto border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <div className="text-[10px] tracking-[0.2em] text-white font-semibold" style={{ fontFamily: 'Georgia, serif' }}>
                    正在重录
                  </div>
                  <div className="text-[9px] text-white/80 truncate max-w-[120px]" style={{ fontFamily: 'monospace' }}>
                    {regeneratingStatus || '处理中…'}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 横幅形式的重录提示 — 进入播放页第一时间看到状态 */}
          {isCurrentRegenerating && (
            <div className="mt-3 px-3 py-1.5 rounded-full flex items-center gap-2 text-[10px] tracking-wider"
              style={{
                background: `linear-gradient(135deg, ${C.primary}15, ${C.lavender}25)`,
                border: `1px solid ${C.glow}60`,
                color: C.primary,
              }}
            >
              <Sparkle size={9} color={C.sakura} delay={0} />
              <span>新版本即将到来 · {regeneratingStatus || '处理中'}</span>
              <Sparkle size={9} color={C.lavender} delay={0.5} />
            </div>
          )}

          <section className="mt-5 text-center space-y-1.5 shrink-0 px-2">
            <h2 className="font-light tracking-tight leading-tight"
              style={{ color: C.primary, fontFamily: `'Noto Serif','Georgia',serif`, fontSize: '22px' }}>
              {current.name}
            </h2>
            <p className="text-[10px] uppercase opacity-70"
              style={{ color: C.muted, fontFamily: `'Space Grotesk','SF Mono',monospace`, letterSpacing: '0.2em' }}>
              {current.artists}
            </p>
          </section>

          <div
            ref={lyricBoxRef}
            className="flex-1 w-full my-3 min-h-0 overflow-y-auto text-center scroll-smooth shizuku-scrollbar px-2"
            style={{
              maskImage: 'linear-gradient(to bottom, transparent, black 18%, black 82%, transparent)',
              WebkitMaskImage: 'linear-gradient(to bottom, transparent, black 18%, black 82%, transparent)',
            }}
          >
            {lyric.length === 0 ? (
              <div className="pt-6 flex flex-col items-center gap-2" style={{ color: C.faint }}>
                <Sparkle size={12} color={C.glow} />
                <span className="text-[11px] italic tracking-wider" style={{ fontFamily: `'Noto Serif','Georgia',serif` }}>
                  {loadingSong ? 'loading...' : 'no lyrics'}
                </span>
              </div>
            ) : (
              <div className="space-y-4 py-8">
                {lyric.map((l, i) => {
                  const tr = tlyric.find(t => Math.abs(t.t - l.t) < 0.2);
                  const active = i === activeLyricIdx;
                  // 关键：字号 / 字重不随 active 变 —— 变了会触发重排换行。
                  //     只让外层盒子用 transform:scale 视觉放大，不动内部文字度量。
                  return (
                    <div key={i} data-lyric-idx={i}
                      className="transition-transform duration-300 will-change-transform"
                      style={{
                        transform: active ? 'scale(1.05)' : 'scale(1)',
                        transformOrigin: 'center center',
                        opacity: active ? 1 : 0.45,
                      }}>
                      <div className="flex items-center justify-center gap-2 px-3">
                        <CrossStar
                          size={12}
                          color={C.sakura}
                          delay={0}
                          solid={active}
                          className={active ? '' : 'opacity-0'}
                        />
                        <div
                          className="text-[16px] leading-[1.4]"
                          style={{
                            fontFamily: `'Noto Serif','Georgia',serif`,
                            fontWeight: 400,
                            maxWidth: '100%',
                            wordBreak: 'break-word',
                            color: active ? undefined : C.faint,
                            ...(active
                              ? {
                                  background: `linear-gradient(135deg, ${C.primary} 0%, ${C.accent} 50%, #9a6bc5 100%)`,
                                  WebkitBackgroundClip: 'text',
                                  WebkitTextFillColor: 'transparent',
                                  backgroundClip: 'text',
                                  filter: `drop-shadow(0 0 14px ${C.glow}a0) drop-shadow(0 0 4px ${C.sakura}80)`,
                                }
                              : {}),
                          }}
                        >
                          {l.text}
                        </div>
                        <CrossStar
                          size={12}
                          color={C.lavender}
                          delay={0.9}
                          solid={active}
                          className={active ? '' : 'opacity-0'}
                        />
                      </div>
                      {tr && (
                        <div
                          className="text-[12px] leading-[1.4] mt-1 px-3"
                          style={{
                            fontWeight: 400,
                            maxWidth: '100%',
                            wordBreak: 'break-word',
                            opacity: active ? 0.78 : 0.4,
                            color: active ? C.accent : C.faint,
                          }}
                        >
                          {tr.text}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="w-full shrink-0 max-w-sm">
            <div className="flex justify-between items-center mb-2 px-0.5">
              <MetaChip>{fmtTime(progress)}</MetaChip>
              <MetaChip>{fmtTime(duration)}</MetaChip>
            </div>
            <GlassProgress progress={progress} duration={duration} fmtTime={fmtTime} onSeek={seek} />
          </div>

          <div className="shrink-0 relative">
            <Sparkle size={9} className="absolute top-1 left-[30%]" color={C.sakura} delay={0} />
            <Sparkle size={7} className="absolute top-3 right-[28%]" color={C.lavender} delay={1.2} />
            <PlayControls playing={playing} loading={loadingSong} onPrev={prevSong} onToggle={togglePlay} onNext={nextSong} />
          </div>

          <div className="shrink-0 mt-3 w-full">
            <SubActions
              liked={liked}
              onLike={toggleLike}
              showSync={!!(current.local && current.localLyrics && lyric.length > 0)}
              onSync={() => {
                setSyncDraft(lyric.map(l => l.t));
                setShowLyricSync(true);
              }}
              showDownload={!!(current.local && current.localAssetKey)}
              onDownload={downloadCurrentLocal}
              playMode={playMode}
              onCyclePlayMode={cyclePlayMode}
            />
          </div>

          {/* 分享给角色 · 一起听 入口 */}
          <div className="shrink-0 mt-3 mb-1 w-full flex justify-center">
            <button
              onClick={openListenTogether}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-[11px] tracking-wider transition-all active:scale-95 shizuku-glass-strong"
              style={{ color: C.primary, boxShadow: `0 3px 16px ${C.glow}25` }}
            >
              <UsersThree size={15} weight="fill" color={C.sakura} />
              {companions.length > 0
                ? <span>和 <b style={{ color: C.accent }}>{companions[0].name}</b> 一起听中</span>
                : <span>分享给 TA · 一起听</span>}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ════════════════ 设置页 ════════════════
  const renderSettings = () => {
    const setDraft = (updates: Partial<typeof cfg>) => setCfg({ ...cfg, ...updates });
    const commit = () => { addToast('已保存', 'success'); setView('search'); };
    return (
      <div className="flex flex-col h-full relative"
        style={{ background: `linear-gradient(180deg, #ffffff 0%, ${C.bg} 50%, ${C.bgDeep} 100%)` }}>
        <BokehBg />
        <MizuHeader title="设置" onBack={() => setView('search')} />
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5 text-sm relative z-10 shizuku-scrollbar">
          <div className="rounded-2xl p-3.5 shizuku-glass" style={{ boxShadow: `0 2px 16px ${C.glow}08` }}>
            <div className="text-[10px] mb-2 tracking-wider flex items-center gap-1.5" style={{ color: C.muted }}>
              <Sparkle size={6} color={C.glow} delay={0} /> 后端 Worker 地址
            </div>
            <input className="w-full rounded-xl px-3 py-2 outline-none text-xs shizuku-glass" value={cfg.workerUrl}
              onChange={e => setDraft({ workerUrl: e.target.value })} placeholder="https://..."
              style={{ color: C.text }} />
          </div>
          <div className="rounded-2xl p-3.5 shizuku-glass" style={{ boxShadow: `0 2px 16px ${C.glow}08` }}>
            <div className="text-[10px] mb-2 tracking-wider flex items-center gap-1.5" style={{ color: C.muted }}>
              <Sparkle size={6} color={C.sakura} delay={0.5} /> 会员 Cookie (MUSIC_U)
            </div>
            <textarea className="w-full rounded-xl px-3 py-2 outline-none text-[10px] shizuku-glass" rows={3} value={cfg.cookie}
              onChange={e => setDraft({ cookie: e.target.value })} placeholder="MUSIC_U=xxx 或直接粘贴值..."
              style={{ color: C.text, fontFamily: 'monospace', resize: 'none' }} />
            <div className="text-[9px] mt-1.5 italic" style={{ color: C.faint }}>
              也可以在「我的」页面里扫码 / 手机号登录，自动填入 cookie
            </div>
          </div>
          <div className="rounded-2xl p-3.5 shizuku-glass" style={{ boxShadow: `0 2px 16px ${C.glow}08` }}>
            <div className="text-[10px] mb-2 tracking-wider flex items-center gap-1.5" style={{ color: C.muted }}>
              <Sparkle size={6} color={C.lavender} delay={1} /> 音质
            </div>
            <div className="grid grid-cols-5 gap-1.5">
              {(['standard', 'higher', 'exhigh', 'lossless', 'hires'] as const).map(q => (
                <button key={q} onClick={() => setDraft({ quality: q })}
                  className="py-2 rounded-xl text-[10px] transition-all"
                  style={{
                    background: cfg.quality === q ? `linear-gradient(135deg, ${C.primary}, ${C.accent})` : C.glass,
                    color: cfg.quality === q ? 'white' : C.muted,
                    border: cfg.quality === q ? '1px solid transparent' : `1px solid rgba(255,255,255,0.3)`,
                    boxShadow: cfg.quality === q ? `0 2px 12px ${C.glow}30` : 'none',
                    backdropFilter: 'blur(8px)',
                  }}
                >{q}</button>
              ))}
            </div>
            <div className="text-[9px] mt-1.5 italic" style={{ color: C.faint }}>lossless / hires 需要黑胶 SVIP</div>
          </div>
          <div className="space-y-3 pt-1">
            <button
              onClick={async () => {
                const lines: string[] = [];
                const ck = normalizeCookie(cfg.cookie);
                lines.push(`Worker: ${cfg.workerUrl}`);
                lines.push(`Cookie: ${ck ? ck.slice(0, 18) + '...(' + ck.length + 'c)' : '(未填)'}`);
                try {
                  const res = await fetch(`${cfg.workerUrl.replace(/\/+$/, '')}/netease/search`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json', ...(ck ? { 'X-Netease-Cookie': ck } : {}) },
                    body: JSON.stringify({ keyword: '晴天', limit: 3 }),
                  });
                  lines.push(`HTTP ${res.status}`);
                  const txt = await res.text(); lines.push(txt.slice(0, 800));
                  try { const j = JSON.parse(txt); lines.push(`---\ncode=${j.code}  songs=${j?.result?.songs?.length ?? 'N/A'}`); } catch {}
                } catch (e: any) { lines.push(`异常: ${e.message}`); }
                alert(lines.join('\n'));
              }}
              className="w-full py-2.5 rounded-2xl text-[10px] tracking-wider shizuku-glass transition-all"
              style={{ color: C.vip, border: `1px solid ${C.vip}30` }}
            >诊断（搜索晴天）</button>
            <button onClick={commit}
              className="w-full py-3 rounded-2xl text-xs text-white tracking-wider transition-all relative overflow-hidden"
              style={{ background: `linear-gradient(135deg, ${C.primary}, ${C.accent})`, boxShadow: `0 3px 18px ${C.glow}30` }}>
              <span className="relative z-10">保存</span>
              <div className="absolute inset-0 pointer-events-none" style={{
                background: `linear-gradient(90deg, transparent 30%, rgba(255,255,255,0.25) 50%, transparent 70%)`,
                backgroundSize: '200% 100%', animation: 'shizuku-shimmer 3s ease-in-out infinite',
              }} />
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ════════════════ 一起听界面（分享给角色后进入）════════════════
  const renderListenTogether = () => {
    const char = listenChar;
    if (!char) return null;
    const charIsImg = !!char.avatar && (char.avatar.startsWith('http') || char.avatar.startsWith('data:'));
    const userAva = userProfile?.avatar;
    const userIsImg = !!userAva && (userAva.startsWith('http') || userAva.startsWith('data:'));
    const actionLabel = (a?: ListenAction): string | null => {
      if (!a || a.kind === 'none') return null;
      return a.kind === 'change_song' ? '🎵 换了首歌'
        : a.kind === 'pause' ? '⏸ 暂停了'
        : a.kind === 'resume' ? '▶️ 继续播放'
        : '⏭ 下一首';
    };
    const charAva = (size: number) => charIsImg
      ? <img src={char.avatar} alt="" className="rounded-full object-cover shrink-0" style={{ width: size, height: size, border: `1.5px solid ${C.sakura}` }} />
      : <span className="rounded-full flex items-center justify-center shrink-0 text-white font-medium" style={{ width: size, height: size, fontSize: Math.round(size * 0.42), background: `linear-gradient(135deg, ${C.sakura}, ${C.lavender})` }}>{char.avatar && char.avatar.length <= 4 ? char.avatar : char.name.slice(0, 1)}</span>;
    const userAvaEl = (size: number) => userIsImg
      ? <img src={userAva} alt="" className="rounded-full object-cover shrink-0" style={{ width: size, height: size, border: `1.5px solid ${C.glow}` }} />
      : <span className="rounded-full flex items-center justify-center shrink-0 text-white font-medium" style={{ width: size, height: size, fontSize: Math.round(size * 0.42), background: `linear-gradient(135deg, ${C.glow}, ${C.accent})` }}>{(userProfile?.name || '你').slice(0, 1)}</span>;

    return (
      <div className="flex flex-col h-full relative"
        style={{ background: `linear-gradient(180deg, #ffffff 0%, ${C.bg} 55%, ${C.bgDeep} 100%)` }}>
        <BokehBg />
        <MizuHeader
          title="一起听"
          onBack={() => setView('player')}
          right={
            <button
              onClick={() => { if (listenCharId) removeListeningPartner(listenCharId); setView('player'); }}
              className="px-2 py-1 rounded-full text-[10px] transition-all active:scale-95"
              style={{ color: C.muted }}
              title="结束一起听"
            >结束</button>
          }
        />

        {/* 正在播放条 */}
        <div className="relative z-10 mx-4 mt-2 px-3 py-2.5 rounded-2xl shizuku-glass-strong flex items-center gap-3"
          style={{ boxShadow: `0 3px 18px ${C.glow}20` }}>
          {current ? (
            <>
              <img src={current.albumPic} alt="" className="w-11 h-11 rounded-full object-cover shrink-0"
                style={{ border: `1.5px solid ${C.accent}40`, animation: playing ? 'shizuku-vinyl 20s linear infinite' : 'none' }} />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate" style={{ color: C.text }}>{current.name}</div>
                <div className="text-[10px] truncate" style={{ color: C.muted }}>{current.artists}</div>
              </div>
              <button onClick={togglePlay} className="p-2 rounded-full shrink-0"
                style={{ background: `linear-gradient(135deg, ${C.primary}, ${C.accent})`, boxShadow: `0 2px 10px ${C.primary}30` }}>
                {playing ? <PauseIcon size={13} weight="fill" color="#fff" /> : <PlayIcon size={13} weight="fill" color="#fff" />}
              </button>
              <button onClick={nextSong} className="p-1.5 rounded-full shrink-0" style={{ color: C.muted }}>
                <SkipForward size={14} weight="fill" />
              </button>
            </>
          ) : (
            <div className="text-[11px] py-1.5 flex-1 text-center" style={{ color: C.muted }}>
              还没在放歌——让 {char.name} 挑一首吧
            </div>
          )}
        </div>

        {/* 你 ♥ TA 一起听 */}
        <div className="relative z-10 flex items-center justify-center gap-2 pt-2 pb-1">
          {userAvaEl(22)}
          <svg width="14" height="13" viewBox="0 0 24 22" fill="none" className="animate-pulse"
            style={{ color: C.sakura, filter: `drop-shadow(0 0 4px ${C.sakura})` }}>
            <path d="M12 21s-8-5.3-8-11.5C4 6 6.5 3.5 9.5 3.5c1.6 0 3 .8 2.5 2.2C11.5 4.3 12.9 3.5 14.5 3.5 17.5 3.5 20 6 20 9.5 20 15.7 12 21 12 21z" fill="currentColor" />
          </svg>
          {charAva(22)}
          <span className="text-[10px] ml-1" style={{ color: C.muted }}>一起听 · {char.name}</span>
        </div>

        {/* 讨论区 */}
        <div ref={listenScrollRef} className="flex-1 overflow-y-auto px-4 py-2 relative z-10 shizuku-scrollbar space-y-3">
          {listenMsgs.length === 0 && !listenBusy && (
            <div className="text-center text-[11px] italic pt-10" style={{ color: C.faint, fontFamily: `'Georgia', serif` }}>
              和 {char.name} 一起听这首歌，随便聊聊吧～
            </div>
          )}
          {listenMsgs.map((m, i) => m.role === 'user' ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[75%] px-3 py-2 rounded-2xl rounded-tr-sm text-[12.5px] leading-relaxed"
                style={{ background: `linear-gradient(135deg, ${C.primary}, ${C.accent})`, color: '#fff', boxShadow: `0 2px 10px ${C.primary}25` }}>
                {m.text}
              </div>
            </div>
          ) : (
            <div key={i} className="flex items-start gap-2">
              {charAva(28)}
              <div className="max-w-[78%]">
                <div className="px-3 py-2 rounded-2xl rounded-tl-sm text-[12.5px] leading-relaxed shizuku-glass-strong" style={{ color: C.text }}>
                  {m.text}
                </div>
                {actionLabel(m.action) && (
                  <div className="mt-1 ml-1 inline-flex items-center text-[9px] px-2 py-0.5 rounded-full"
                    style={{ background: `${C.sakura}22`, color: C.primary, border: `1px solid ${C.sakura}44` }}>
                    {actionLabel(m.action)}
                  </div>
                )}
              </div>
            </div>
          ))}
          {listenBusy && (
            <div className="flex items-center gap-2">
              {charAva(28)}
              <div className="px-3 py-2.5 rounded-2xl rounded-tl-sm shizuku-glass-strong flex items-center gap-1">
                {[0, 1, 2].map(d => (
                  <span key={d} className="w-1.5 h-1.5 rounded-full animate-bounce"
                    style={{ background: C.accent, animationDelay: `${d * 120}ms` }} />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 输入条 + 🎲 TA 来挑 */}
        <div className="relative z-10 px-3 py-2.5 shizuku-glass-strong flex items-center gap-2"
          style={{ borderTop: `1px solid rgba(255,255,255,0.3)` }}>
          <button onClick={() => { if (!listenBusy) runDiscuss('take_over'); }} disabled={listenBusy}
            className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-all active:scale-90 disabled:opacity-40"
            style={{ background: `${C.lavender}33`, color: C.primary, border: `1px solid ${C.lavender}55` }}
            title="把选歌权交给 TA">
            <DiceFive size={17} weight="fill" />
          </button>
          <input
            value={listenInput}
            onChange={e => setListenInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') sendListenMsg(); }}
            placeholder={`和 ${char.name} 说点什么…`}
            className="flex-1 bg-transparent outline-none text-sm px-2"
            style={{ color: C.text }}
          />
          <button onClick={sendListenMsg} disabled={!listenInput.trim() || listenBusy}
            className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-all active:scale-90 disabled:opacity-40"
            style={{ background: `linear-gradient(135deg, ${C.primary}, ${C.accent})`, boxShadow: `0 2px 10px ${C.primary}30` }}>
            <PaperPlaneRight size={16} weight="fill" color="#fff" />
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="absolute inset-0 overflow-hidden">
      {view === 'search' && renderSearch()}
      {view === 'player' && renderPlayer()}
      {view === 'listen_together' && renderListenTogether()}
      {view === 'settings' && renderSettings()}
      {view === 'profile' && (
        <NeteaseProfilePage
          onBack={closeApp}
          onOpenPlayer={() => setView('player')}
          onOpenSearch={() => setView('search')}
          onOpenSettings={() => setView('settings')}
          onVisitChar={id => { setVisitCharId(id); setView('visit_char'); }}
        />
      )}
      {/* 手动对轴 modal — 全屏覆盖，不开新 view */}
      {showLyricSync && current && current.local && (() => {
        const fmt = (s: number) => {
          if (!isFinite(s)) return '0:00.0';
          const m = Math.floor(s / 60);
          const sec = (s % 60).toFixed(1).padStart(4, '0');
          return `${m}:${sec}`;
        };
        const setLineTime = (idx: number, t: number) => {
          setSyncDraft(prev => {
            const next = [...prev];
            next[idx] = Math.max(0, t);
            return next;
          });
        };
        const tapCurrent = (idx: number) => setLineTime(idx, progress);
        const resetAuto = () => {
          if (!duration || duration <= 0) return;
          const intro = Math.min(2, duration * 0.05);
          const outro = Math.min(3, duration * 0.05);
          const usable = Math.max(duration - intro - outro, duration * 0.6);
          const step = usable / lyric.length;
          setSyncDraft(lyric.map((_, i) => intro + i * step));
        };
        const saveSync = () => {
          if (!current) return;
          // 把 draft 写到 song.lyricLineTimings 里 → addLocalSong 上行覆盖
          const updated: Song = { ...current, lyricLineTimings: syncDraft };
          addLocalSong(updated);
          // 重新 playSong 让 LyricLine 立即用新时间
          playSong(updated, { alsoSetQueue: false });
          setShowLyricSync(false);
          addToast('对轴已保存 ✦', 'success');
        };

        return (
          <div className="absolute inset-0 z-50 flex flex-col"
            style={{ background: `linear-gradient(180deg, #ffffff 0%, ${C.bg} 60%, ${C.bgDeep} 100%)` }}>
            <BokehBg />
            {/* Header */}
            <div className="relative z-10 flex items-center justify-between h-12 px-4 shizuku-glass-strong"
              style={{ borderBottom: `1px solid rgba(255,255,255,0.3)` }}>
              <button onClick={() => setShowLyricSync(false)} className="text-[11px] px-2 py-1 rounded-full" style={{ color: C.muted }}>取消</button>
              <div className="flex items-center gap-1.5">
                <Crosshair size={13} weight="duotone" color={C.primary} />
                <span className="text-[12px] tracking-[0.25em]" style={{ color: C.primary, fontFamily: 'Georgia, serif' }}>歌词对轴</span>
              </div>
              <button onClick={saveSync} className="text-[11px] font-bold px-3 py-1 rounded-full"
                style={{
                  background: `linear-gradient(135deg, ${C.primary}, ${C.accent})`,
                  color: 'white',
                  boxShadow: `0 2px 10px ${C.glow}50`,
                }}>保存</button>
            </div>

            {/* Live progress + transport */}
            <div className="relative z-10 px-4 pt-3 pb-2 shrink-0">
              <div className="flex items-center gap-2 mb-2">
                <button onClick={togglePlay}
                  className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 active:scale-95 transition-transform"
                  style={{
                    background: `linear-gradient(135deg, ${C.primary}, ${C.accent})`,
                    color: 'white',
                    boxShadow: `0 3px 12px ${C.glow}50`,
                  }}
                >
                  {playing ? <PauseIcon size={14} weight="fill" /> : <PlayIcon size={14} weight="fill" />}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between text-[10px] mb-1" style={{ color: C.muted, fontFamily: 'monospace' }}>
                    <span style={{ color: C.primary, fontWeight: 600 }}>{fmt(progress)}</span>
                    <span>{fmt(duration)}</span>
                  </div>
                  <div className="h-1 rounded-full shizuku-glass cursor-pointer relative"
                    onClick={(e) => {
                      const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                      seek((e.clientX - rect.left) / rect.width);
                    }}
                  >
                    <div className="absolute top-0 left-0 h-full rounded-full"
                      style={{
                        width: `${duration > 0 ? (progress / duration) * 100 : 0}%`,
                        background: `linear-gradient(90deg, ${C.primary}, ${C.glow})`,
                      }} />
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <button onClick={resetAuto} className="text-[10px] underline" style={{ color: C.muted }}>
                  重置为均匀分布
                </button>
                <p className="text-[10px] flex-1 text-right" style={{ color: C.muted }}>
                  播放时点 ⊙ 把当前时间设给那一句
                </p>
              </div>
            </div>

            {/* Lyric list with tap-to-set */}
            <div className="flex-1 overflow-y-auto px-3 pb-6 shizuku-scrollbar relative z-10 pt-1">
              {lyric.length === 0 ? (
                <div className="text-center text-[11px] py-12" style={{ color: C.faint }}>没有歌词可对轴</div>
              ) : (
                <div className="space-y-1.5">
                  {lyric.map((l, i) => {
                    const t = syncDraft[i] ?? l.t;
                    const isActive = i === activeLyricIdx;
                    return (
                      <div key={i}
                        className="flex items-center gap-2 rounded-xl px-2.5 py-2 transition-all"
                        style={{
                          background: isActive
                            ? `linear-gradient(135deg, ${C.glow}25, ${C.lavender}18)`
                            : 'rgba(255,255,255,0.5)',
                          border: `1px solid ${isActive ? C.glow + '60' : C.faint + '30'}`,
                          boxShadow: isActive ? `0 2px 12px ${C.glow}30` : 'none',
                        }}
                      >
                        <span className="text-[9px] tabular-nums w-5 text-center shrink-0" style={{ color: C.faint }}>{i + 1}</span>
                        <button
                          onClick={() => tapCurrent(i)}
                          className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 active:scale-90 transition-all"
                          style={{
                            background: `${C.primary}15`,
                            border: `1px solid ${C.primary}30`,
                            color: C.primary,
                          }}
                          title="把这一句设到当前播放时间"
                        >
                          ⊙
                        </button>
                        <div className="flex-1 min-w-0">
                          <div className="text-[12px] truncate" style={{ color: isActive ? C.primary : C.text, fontWeight: isActive ? 600 : 400 }}>
                            {l.text}
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-[9px] tabular-nums" style={{ color: C.muted, fontFamily: 'monospace' }}>{fmt(t)}</span>
                            <button
                              onClick={() => setLineTime(i, t - 0.2)}
                              className="text-[9px] px-1 rounded"
                              style={{ color: C.faint }}
                            >−.2s</button>
                            <button
                              onClick={() => setLineTime(i, t + 0.2)}
                              className="text-[9px] px-1 rounded"
                              style={{ color: C.faint }}
                            >+.2s</button>
                            <button
                              onClick={() => seek(duration > 0 ? t / duration : 0)}
                              className="text-[9px] px-1 rounded ml-auto"
                              style={{ color: C.accent }}
                            >跳到此处</button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {view === 'visit_char' && visitCharId && (
        <CharVisitPage
          charId={visitCharId}
          onBack={() => { setView('profile'); setVisitCharId(null); }}
          onOpenPlayer={() => setView('player')}
        />
      )}

      {/* 分享给角色 · 一起听 选择器 — 底部弹出 */}
      {showSharePicker && (
        <div className="absolute inset-0 z-[60] flex items-end" onClick={() => setShowSharePicker(false)}>
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm animate-fade-in" />
          <div className="relative w-full rounded-t-3xl p-5 pb-8 animate-slide-up"
            style={{ maxHeight: '72%', background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(24px) saturate(1.5)', WebkitBackdropFilter: 'blur(24px) saturate(1.5)', boxShadow: `0 -8px 40px ${C.glow}30` }}
            onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 rounded-full mx-auto mb-4" style={{ background: `${C.faint}80` }} />
            <div className="flex items-center gap-2 mb-1">
              <UsersThree size={18} weight="fill" color={C.sakura} />
              <span className="text-sm font-medium" style={{ color: C.text }}>分享给谁 · 一起听</span>
            </div>
            <p className="text-[11px] mb-4" style={{ color: C.muted }}>
              把{current ? `《${current.name}》` : '这首歌'}分享给 TA，进入一起听
            </p>
            {characters.length === 0 ? (
              <div className="text-center text-[11px] py-8" style={{ color: C.faint }}>还没有角色</div>
            ) : (
              <div className="overflow-y-auto shizuku-scrollbar" style={{ maxHeight: '46vh' }}>
                <div className="grid grid-cols-4 gap-3 pb-1">
                  {characters.map(c => {
                    const isImg = !!c.avatar && (c.avatar.startsWith('http') || c.avatar.startsWith('data:'));
                    const joined = listeningTogetherWith.includes(c.id);
                    return (
                      <button key={c.id} onClick={() => shareAndListen(c.id)}
                        className="flex flex-col items-center gap-1.5 active:scale-95 transition-transform">
                        <div className="relative">
                          {isImg
                            ? <img src={c.avatar} alt="" className="w-14 h-14 rounded-full object-cover" style={{ border: `2px solid ${joined ? C.sakura : C.faint + '55'}` }} />
                            : <span className="w-14 h-14 rounded-full flex items-center justify-center text-xl text-white" style={{ background: `linear-gradient(135deg, ${C.sakura}, ${C.lavender})` }}>{c.avatar && c.avatar.length <= 4 ? c.avatar : c.name.slice(0, 1)}</span>}
                          {joined && (
                            <span className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full flex items-center justify-center" style={{ background: C.sakura }}>
                              <UsersThree size={11} weight="fill" color="#fff" />
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] truncate max-w-full" style={{ color: C.muted }}>{c.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default MusicApp;
