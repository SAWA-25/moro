import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Heart, MusicNotes, PencilSimple, Play, Plus, PushPin, Trash, UserCircle } from '@phosphor-icons/react';
import { useOS } from '../../context/OSContext';
import { Song, useMusic } from '../../context/MusicContext';
import type { MusicLibraryPlaylist } from '../../types';
import { DB } from '../../utils/db';
import {
  addSongToMusicPlaylist,
  createMusicPlaylist,
  deleteMusicPlaylist,
  getMusicPlaylistSongs,
  getSongLibraryTrackId,
  listAllMusicSongs,
  listLikedMusicSongs,
  listRecentMusicSongs,
  removeSongFromMusicPlaylist,
  updateMusicPlaylist,
} from '../../utils/musicLibrary';
import { BokehBg, C, MiniPlayer, MizuHeader, SongRow, isMusicAvatarImage } from './MusicUI';

const fmtTime = (s: number) => {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${m}:${ss.toString().padStart(2, '0')}`;
};

interface Props {
  onClose: () => void;
  onOpenDiscover: () => void;
  onOpenProfile: () => void;
  onOpenPlayer: () => void;
  onVisitChar: (charId: string) => void;
  onShareSong: (song: Song) => void;
  onOpenArtist?: (artist: { id?: number | string; name: string; source?: 'netease' | 'qq' }) => void;
  tabBar?: React.ReactNode;
}

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

const MusicLibraryPage: React.FC<Props> = ({
  onClose,
  onOpenDiscover,
  onOpenProfile,
  onOpenPlayer,
  onVisitChar,
  onShareSong,
  onOpenArtist,
  tabBar,
}) => {
  const { characters, addToast, userProfile } = useOS();
  const {
    current, playing, togglePlay, nextSong, prevSong, playSong,
    localAlbumSongs, libraryVersion, refreshLibrary, listeningTogetherWith, removeListeningPartner,
  } = useMusic();
  const [allSongs, setAllSongs] = useState<Song[]>([]);
  const [recent, setRecent] = useState<Song[]>([]);
  const [liked, setLiked] = useState<Song[]>([]);
  const [playlists, setPlaylists] = useState<MusicLibraryPlaylist[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [playlistSongs, setPlaylistSongs] = useState<Record<string, Song[]>>({});
  const [creating, setCreating] = useState(false);

  const reload = useCallback(async () => {
    const [allLibrarySongs, recentSongs, likedSongs, allPlaylists] = await Promise.all([
      listAllMusicSongs(200),
      listRecentMusicSongs(40),
      listLikedMusicSongs(80),
      DB.getAllMusicPlaylists(),
    ]);
    setAllSongs(allLibrarySongs);
    setRecent(recentSongs);
    setLiked(likedSongs);
    setPlaylists(allPlaylists.sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt));
  }, []);

  useEffect(() => {
    reload().catch(() => {});
  }, [libraryVersion, reload]);

  const companions = useMemo(() => listeningTogetherWith
    .map(id => characters.find(c => c.id === id))
    .filter((c): c is typeof characters[number] => !!c)
    .map(c => ({ id: c.id, name: c.name, avatar: c.avatar })), [characters, listeningTogetherWith]);

  const expandPlaylist = useCallback(async (playlist: MusicLibraryPlaylist) => {
    if (expanded === playlist.id) {
      setExpanded(null);
      return;
    }
    setExpanded(playlist.id);
    if (!playlistSongs[playlist.id]) {
      const songs = await getMusicPlaylistSongs(playlist.id);
      setPlaylistSongs(prev => ({ ...prev, [playlist.id]: songs }));
    }
  }, [expanded, playlistSongs]);

  const makePlaylist = useCallback(async () => {
    const title = typeof window !== 'undefined' ? window.prompt('歌单名', '我的歌单') : '我的歌单';
    if (!title?.trim()) return;
    setCreating(true);
    try {
      const playlist = await createMusicPlaylist({ title });
      setPlaylists(prev => [playlist, ...prev]);
      refreshLibrary();
      addToast('歌单已创建', 'success');
    } catch (e: any) {
      addToast(`创建失败：${e?.message || '未知错误'}`, 'error');
    } finally {
      setCreating(false);
    }
  }, [addToast, refreshLibrary]);

  const deletePlaylist = useCallback(async (playlist: MusicLibraryPlaylist) => {
    const ok = typeof window === 'undefined' || window.confirm(`删除歌单「${playlist.title}」？歌曲本身会留在资料库。`);
    if (!ok) return;
    await deleteMusicPlaylist(playlist.id);
    refreshLibrary();
    addToast('歌单已删除', 'info');
  }, [addToast, refreshLibrary]);

  const addCurrentToPlaylist = useCallback(async (playlist: MusicLibraryPlaylist) => {
    if (!current) {
      addToast('还没有正在播放的歌曲', 'info');
      return;
    }
    await addSongToMusicPlaylist(playlist.id, current);
    const songs = await getMusicPlaylistSongs(playlist.id);
    setPlaylistSongs(prev => ({ ...prev, [playlist.id]: songs }));
    refreshLibrary();
    addToast(`已加入「${playlist.title}」`, 'success');
  }, [addToast, current, refreshLibrary]);

  const removeFromPlaylist = useCallback(async (playlistId: string, song: Song) => {
    await removeSongFromMusicPlaylist(playlistId, getSongLibraryTrackId(song));
    const songs = await getMusicPlaylistSongs(playlistId);
    setPlaylistSongs(prev => ({ ...prev, [playlistId]: songs }));
    refreshLibrary();
  }, [refreshLibrary]);

  const characterSongCount = characters.reduce((sum, char) => sum + (char.musicProfile?.playlists || []).reduce((n, pl) => n + pl.songs.length, 0), 0);
  const totalMinutes = Math.round(allSongs.reduce((sum, song) => sum + (song.duration || 0), 0) / 60);
  const sourceCount = new Set(allSongs.map(song => song.source || (song.local ? 'local' : 'netease'))).size;

  const playCollection = useCallback(async (songs: Song[], playSource: 'library' | 'local' | 'character' = 'library') => {
    if (!songs.length) {
      addToast('这里还没有歌曲', 'info');
      return;
    }
    await playSong(songs[0], { replaceQueue: songs, startIdx: 0, playSource });
    onOpenPlayer();
  }, [addToast, onOpenPlayer, playSong]);

  const playPlaylist = useCallback(async (playlist: MusicLibraryPlaylist) => {
    const songs = playlistSongs[playlist.id] || await getMusicPlaylistSongs(playlist.id);
    setPlaylistSongs(prev => ({ ...prev, [playlist.id]: songs }));
    await playCollection(songs, 'library');
  }, [playCollection, playlistSongs]);

  const renamePlaylist = useCallback(async (playlist: MusicLibraryPlaylist) => {
    const title = typeof window !== 'undefined' ? window.prompt('歌单名', playlist.title) : playlist.title;
    if (!title?.trim() || title.trim() === playlist.title) return;
    const next = await updateMusicPlaylist(playlist.id, { title });
    if (!next) return;
    setPlaylists(prev => prev.map(item => item.id === next.id ? next : item));
    refreshLibrary();
    addToast('歌单已重命名', 'success');
  }, [addToast, refreshLibrary]);

  const togglePlaylistPinned = useCallback(async (playlist: MusicLibraryPlaylist) => {
    const next = await updateMusicPlaylist(playlist.id, { pinned: !playlist.pinned });
    if (!next) return;
    setPlaylists(prev => prev.map(item => item.id === next.id ? next : item)
      .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt));
    refreshLibrary();
  }, [refreshLibrary]);

  const renderSongList = (songs: Song[], playSource: 'library' | 'local' | 'character', limit = 20) => (
    <div className="space-y-1">
      {songs.slice(0, limit).map((song, i) => (
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
          onClick={() => { playSong(song, { replaceQueue: songs, startIdx: i, playSource }); onOpenPlayer(); }}
          onShare={() => onShareSong(song)}
          onArtistClick={onOpenArtist}
        />
      ))}
    </div>
  );

  return (
    <div className="flex flex-col h-full relative" style={{ background: `linear-gradient(180deg, #ffffff 0%, ${C.bg} 52%, ${C.bgDeep} 100%)` }}>
      <BokehBg />
      <MizuHeader
        title="资料库"
        onClose={onClose}
        right={<button onClick={onOpenProfile} className="p-1.5 rounded-full" style={{ color: C.primary }} title="我的"><UserCircle size={18} weight="bold" /></button>}
      />
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-36 relative z-10 shizuku-scrollbar">
        <div className="rounded-3xl p-4 mb-3 shizuku-glass-strong">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] tracking-[0.18em] uppercase" style={{ color: C.muted }}>Local Library</div>
              <div className="text-lg mt-0.5" style={{ color: C.text, fontFamily: `'Noto Serif', serif` }}>{allSongs.length} 首歌</div>
              <div className="text-[10px] truncate" style={{ color: C.muted }}>
                {sourceCount} 个来源 · 约 {totalMinutes || 0} 分钟 · {playlists.length} 张自建歌单
              </div>
            </div>
            <button
              onClick={() => void playCollection(allSongs, 'library')}
              className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 active:scale-95 transition-transform"
              style={{ background: `linear-gradient(135deg, ${C.primary}, ${C.accent})`, color: 'white', boxShadow: `0 4px 18px ${C.primary}25` }}
              title="播放资料库"
              aria-label="播放资料库"
            >
              <Play size={18} weight="fill" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-2">
          <button className="rounded-2xl p-3 text-left shizuku-glass-strong" onClick={() => setExpanded(expanded === 'all' ? null : 'all')}>
            <MusicNotes size={18} weight="fill" color={C.primary} />
            <div className="text-sm mt-1" style={{ color: C.text }}>{allSongs.length}</div>
            <div className="text-[9px]" style={{ color: C.muted }}>全部</div>
          </button>
          <button className="rounded-2xl p-3 text-left shizuku-glass" onClick={() => setExpanded(expanded === 'recent' ? null : 'recent')}>
            <MusicNotes size={18} weight="fill" color={C.primary} />
            <div className="text-sm mt-1" style={{ color: C.text }}>{recent.length}</div>
            <div className="text-[9px]" style={{ color: C.muted }}>最近播放</div>
          </button>
          <button className="rounded-2xl p-3 text-left shizuku-glass" onClick={() => setExpanded(expanded === 'liked' ? null : 'liked')}>
            <Heart size={18} weight="fill" color={C.accent} />
            <div className="text-sm mt-1" style={{ color: C.text }}>{liked.length}</div>
            <div className="text-[9px]" style={{ color: C.muted }}>我的喜欢</div>
          </button>
          <button className="rounded-2xl p-3 text-left shizuku-glass" onClick={onOpenDiscover}>
            <UserCircle size={18} weight="fill" color={C.sakura} />
            <div className="text-sm mt-1" style={{ color: C.text }}>{characterSongCount}</div>
            <div className="text-[9px]" style={{ color: C.muted }}>角色收藏</div>
          </button>
        </div>

        {expanded === 'all' && (
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2 px-1">
              <span className="text-[10px]" style={{ color: C.muted }}>本机保存的播放快照</span>
              <button onClick={() => void playCollection(allSongs, 'library')} className="text-[10px]" style={{ color: C.accent }}>播放全部</button>
            </div>
            {renderSongList(allSongs, 'library', 60)}
          </div>
        )}
        {expanded === 'recent' && <div className="mt-4">{renderSongList(recent, 'library')}</div>}
        {expanded === 'liked' && <div className="mt-4">{renderSongList(liked, 'library')}</div>}

        {localAlbumSongs.length > 0 && (
          <div className="mt-5">
            <SectionTitle action={<button onClick={() => void playCollection(localAlbumSongs, 'local')} className="text-[10px]" style={{ color: C.accent }}>播放全部</button>}>一起写的歌</SectionTitle>
            {renderSongList(localAlbumSongs, 'local')}
          </div>
        )}

        <div className="mt-5">
          <SectionTitle action={
            <button onClick={makePlaylist} disabled={creating} className="inline-flex items-center gap-1 text-[10px]" style={{ color: C.accent }}>
              <Plus size={11} />新建
            </button>
          }>我的歌单</SectionTitle>
          {playlists.length === 0 ? (
            <div className="rounded-2xl p-4 text-center shizuku-glass text-[11px]" style={{ color: C.muted }}>
              还没有自建歌单。先新建一个，再把正在播放的歌收进去。
            </div>
          ) : (
            <div className="space-y-2">
              {playlists.map(playlist => {
                const songs = playlistSongs[playlist.id] || [];
                const isOpen = expanded === playlist.id;
                return (
                  <div key={playlist.id} className="rounded-2xl overflow-hidden shizuku-glass">
                    <div className="w-full flex items-center gap-3 p-3">
                      <button onClick={() => expandPlaylist(playlist)} className="flex-1 min-w-0 flex items-center gap-3 text-left">
                        <div className="w-12 h-12 rounded-xl flex items-center justify-center overflow-hidden shrink-0" style={{ background: playlist.coverUrl ? undefined : `linear-gradient(135deg, ${C.primary}, ${C.accent})` }}>
                          {playlist.coverUrl ? <img src={playlist.coverUrl} alt="" className="w-full h-full object-cover" /> : <MusicNotes size={20} weight="fill" color="white" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 min-w-0">
                            {playlist.pinned && <PushPin size={11} weight="fill" color={C.accent} className="shrink-0" />}
                            <div className="text-sm truncate" style={{ color: C.text }}>{playlist.title}</div>
                          </div>
                          <div className="text-[10px] truncate" style={{ color: C.muted }}>{playlist.trackCount || 0} 首 · {playlist.description || '本地歌单'}</div>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => void playPlaylist(playlist)}
                        className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 shizuku-glass"
                        style={{ color: C.primary }}
                        title="播放歌单"
                        aria-label="播放歌单"
                      >
                        <Play size={13} weight="fill" />
                      </button>
                    </div>
                    {isOpen && (
                      <div className="border-t px-2 pb-2" style={{ borderColor: `${C.faint}25` }}>
                        <div className="grid grid-cols-5 gap-1.5 py-2">
                          <button onClick={() => void playPlaylist(playlist)} className="py-1.5 rounded-full text-[10px] shizuku-glass" style={{ color: C.primary }}>播放</button>
                          <button onClick={() => addCurrentToPlaylist(playlist)} className="py-1.5 rounded-full text-[10px] shizuku-glass" style={{ color: C.primary }}>加入</button>
                          <button onClick={() => void renamePlaylist(playlist)} className="py-1.5 rounded-full flex items-center justify-center shizuku-glass" style={{ color: C.muted }} title="重命名"><PencilSimple size={12} /></button>
                          <button onClick={() => void togglePlaylistPinned(playlist)} className="py-1.5 rounded-full flex items-center justify-center shizuku-glass" style={{ color: playlist.pinned ? C.accent : C.faint }} title={playlist.pinned ? '取消置顶' : '置顶'}><PushPin size={12} weight={playlist.pinned ? 'fill' : 'regular'} /></button>
                          <button onClick={() => deletePlaylist(playlist)} className="py-1.5 rounded-full flex items-center justify-center shizuku-glass" style={{ color: C.danger }} title="删除"><Trash size={12} /></button>
                        </div>
                        {songs.length === 0 ? (
                          <div className="text-center text-[10px] py-4" style={{ color: C.faint }}>这张歌单还空着</div>
                        ) : songs.map((song, i) => (
                          <div key={`${playlist.id}-${song.id}-${i}`} className="flex items-center gap-1">
                            <div className="flex-1 min-w-0">{renderSongList([song], 'library')}</div>
                            <button onClick={() => removeFromPlaylist(playlist.id, song)} className="w-7 h-7 rounded-full flex items-center justify-center" style={{ color: C.faint }}><Trash size={11} /></button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-5">
          <SectionTitle>角色音乐角落</SectionTitle>
          <div className="flex gap-2 overflow-x-auto pb-2 shizuku-scrollbar">
            {characters.map(char => (
              <button key={char.id} onClick={() => onVisitChar(char.id)} className="shrink-0 w-20 text-center">
                {isMusicAvatarImage(char.avatar)
                  ? <img src={char.avatar} alt="" className="w-14 h-14 rounded-full object-cover mx-auto" />
                  : <span className="w-14 h-14 rounded-full flex items-center justify-center text-white mx-auto" style={{ background: `linear-gradient(135deg, ${C.sakura}, ${C.lavender})` }}>{char.avatar || char.name.slice(0, 1)}</span>}
                <div className="text-[10px] truncate mt-1" style={{ color: C.muted }}>{char.name}</div>
              </button>
            ))}
          </div>
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

export default MusicLibraryPage;
