import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowSquareOut,
  BookOpenText,
  CaretDown,
  CaretLeft,
  CaretRight,
  ChatCircleText,
  Compass,
  Eye,
  FilmSlate,
  Pause,
  Play,
  Sparkle,
  StopCircle,
  Trash,
  UploadSimple,
  X,
} from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { resolveAuxApi } from '../utils/auxApi';
import { captureVideoFrame } from '../utils/userScreenWatch';
import {
  buildCoViewBuiltinVideoSiteUrl,
  parseCoViewBookFile,
  paginateText,
  discussCoView,
} from '../utils/coview';
import { manualAnchorProps, scrollToManualAnchor, useManualDeepLink } from '../utils/manualDeepLink';
import { XhsFreeRoamPanel } from './XhsFreeRoamApp';
import {
  AppID,
  CharacterProfile,
  CoViewBook,
  CoViewMedia,
  CoViewMessage,
  CoViewMode,
  CoViewSession,
} from '../types';
import {
  accent,
  IconCircle,
  INK,
  INK_SOFT,
  InsButton,
  InsCard,
  InsEmpty,
  InsHeader,
  InsScroll,
  InsSheet,
  InsShell,
  StoryRing,
} from '../components/ui/insKit';

type ActiveCoViewMode = Exclude<CoViewMode, 'free_roam'>;
type CinemaVisionSource = 'none' | 'local_video' | 'screen_share';

interface CinemaVisionFrame {
  imageDataUrl: string;
  capturedAt: number;
  sourceLabel: string;
}

interface CoViewAppProps {
  initialMode?: CoViewMode;
}

const AC = 'blue' as const;
const A = accent(AC);
const DIRECT_VIDEO_RE = /\.(mp4|m4v|mov|webm|ogv|ogg|m3u8)(?:[?#].*)?$/i;
const HLS_RE = /\.m3u8(?:[?#].*)?$/i;
const BUILTIN_VIDEO_SITE_NAME = '樱花动漫';

const genId = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const trimExt = (name: string) => name.replace(/\.[^.]+$/, '').trim();

const isDirectVideoUrl = (url?: string) => !!url && DIRECT_VIDEO_RE.test(url.trim());
const isHlsUrl = (url?: string) => !!url && HLS_RE.test(url.trim());

const formatBytes = (size?: number) => {
  if (!size) return '';
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(size > 100 * 1024 * 1024 ? 0 : 1)} MB`;
};

const formatDuration = (seconds?: number) => {
  if (!Number.isFinite(seconds || NaN)) return '00:00';
  const value = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(value / 3600);
  const m = Math.floor((value % 3600) / 60);
  const s = value % 60;
  return h > 0
    ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
    : `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

const modeFromRoute = (route?: string, tab?: unknown): CoViewMode | null => {
  const raw = typeof tab === 'string' ? tab : route || '';
  const normalized = raw.replace(/^tab:/, '');
  return normalized === 'cinema' || normalized === 'reading' || normalized === 'free_roam'
    ? normalized
    : null;
};

const mediaSubtitle = (media: CoViewMedia) => {
  if (media.kind === 'local_file') return [media.fileName, formatBytes(media.size)].filter(Boolean).join(' · ') || '本地视频';
  if (media.kind === 'direct_url') return '直连视频 URL';
  if (media.kind === 'embed_site') return media.sourceLabel || '内嵌视频网站';
  if (media.kind === 'external_link') return media.sourceLabel || '外部页面';
  return media.sourceLabel || '旧收藏';
};

const actionText = (action?: CoViewMessage['action']) => {
  switch (action?.kind) {
    case 'pause': return '已建议暂停';
    case 'resume': return '已建议继续';
    case 'next_page': return '已翻到下一页';
    case 'prev_page': return '已翻回上一页';
    default: return '';
  }
};

const ModeTabs: React.FC<{ mode: CoViewMode; setMode: (mode: CoViewMode) => void }> = ({ mode, setMode }) => {
  const tabs: Array<{ id: CoViewMode; label: string; icon: React.ReactNode }> = [
    { id: 'cinema', label: '影院', icon: <FilmSlate size={15} weight="bold" /> },
    { id: 'reading', label: '阅读', icon: <BookOpenText size={15} weight="bold" /> },
    { id: 'free_roam', label: '自由活动', icon: <Compass size={15} weight="bold" /> },
  ];
  return (
    <div className="relative z-10 px-3 pb-2">
      <div className="grid grid-cols-3 gap-1 rounded-full p-1" style={{ background: '#fff', border: '1px solid rgba(0,0,0,0.06)' }}>
        {tabs.map(tab => {
          const active = mode === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setMode(tab.id)}
              className="h-9 rounded-full flex items-center justify-center gap-1.5 text-[12px] font-extrabold press-soft"
              style={active ? { background: A.solid, color: '#fff' } : { color: INK_SOFT }}
            >
              {tab.icon}
              <span className="truncate">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

const CharacterButton: React.FC<{
  char: CharacterProfile | null;
  disabled?: boolean;
  onClick: () => void;
}> = ({ char, disabled, onClick }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className="min-w-0 flex items-center gap-2 press-soft disabled:opacity-55"
  >
    <StoryRing src={char?.avatar} size={34} active={!!char} fallback={char?.name?.[0] || '?'} />
    <div className="hidden min-w-0 text-left sm:block">
      <div className="max-w-[96px] truncate text-[12px] font-extrabold" style={{ color: INK }}>{char?.name || '选角色'}</div>
      <div className="flex items-center gap-1 text-[9px]" style={{ color: INK_SOFT }}>
        <span>讨论搭子</span>
        <CaretDown size={9} weight="bold" />
      </div>
    </div>
  </button>
);

const CoViewApp: React.FC<CoViewAppProps> = ({ initialMode = 'cinema' }) => {
  const { goBack, addToast, characters, activeCharacterId, apiConfig, auxApiConfig, userProfile } = useOS();
  const auxApi = useMemo(() => ({ ...apiConfig, ...resolveAuxApi(auxApiConfig, apiConfig) }), [apiConfig, auxApiConfig]);

  const [mode, setMode] = useState<CoViewMode>(initialMode);
  const [selectedCharId, setSelectedCharId] = useState(activeCharacterId || characters[0]?.id || '');
  const selectedChar = characters.find(c => c.id === selectedCharId) || null;
  const [showCharPicker, setShowCharPicker] = useState(false);

  const [mediaLibrary, setMediaLibrary] = useState<CoViewMedia[]>([]);
  const [selectedMediaId, setSelectedMediaId] = useState('');
  const selectedMedia = mediaLibrary.find(item => item.id === selectedMediaId) || null;

  const [books, setBooks] = useState<CoViewBook[]>([]);
  const [selectedBookId, setSelectedBookId] = useState('');
  const selectedBook = books.find(book => book.id === selectedBookId) || null;
  const [isParsingBook, setIsParsingBook] = useState(false);

  const [videoTime, setVideoTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const bookInputRef = useRef<HTMLInputElement>(null);
  const cinemaVisionStreamRef = useRef<MediaStream | null>(null);
  const cinemaVisionVideoRef = useRef<HTMLVideoElement | null>(null);
  const [cinemaVisionSource, setCinemaVisionSource] = useState<CinemaVisionSource>('none');
  const [cinemaVisionBusy, setCinemaVisionBusy] = useState(false);
  const [cinemaVisionError, setCinemaVisionError] = useState('');
  const [cinemaVisionFrame, setCinemaVisionFrame] = useState<CinemaVisionFrame | null>(null);

  const [activeSession, setActiveSession] = useState<CoViewSession | null>(null);
  const [messages, setMessages] = useState<CoViewMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [isDiscussing, setIsDiscussing] = useState(false);

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  useEffect(() => {
    if (!selectedCharId && characters.length) setSelectedCharId(activeCharacterId || characters[0].id);
  }, [activeCharacterId, characters, selectedCharId]);

  useManualDeepLink(AppID.CoView, useCallback((target) => {
    const nextMode = modeFromRoute(target.route, target.payload?.tab);
    if (nextMode) setMode(nextMode);
    window.setTimeout(() => scrollToManualAnchor(target.anchorId), 80);
  }, []));

  const loadMedia = useCallback(async () => {
    const rows = await DB.getCoViewMedia();
    setMediaLibrary(rows);
    setSelectedMediaId(prev => (prev && rows.some(item => item.id === prev)) ? prev : rows[0]?.id || '');
  }, []);

  const loadBooks = useCallback(async () => {
    const rows = await DB.getCoViewBooks();
    setBooks(rows);
    setSelectedBookId(prev => (prev && rows.some(item => item.id === prev)) ? prev : rows[0]?.id || '');
  }, []);

  useEffect(() => { void loadMedia(); void loadBooks(); }, [loadBooks, loadMedia]);

  const currentChapter = selectedBook?.chapters[selectedBook.currentChapterIndex] || selectedBook?.chapters[0] || null;
  const bookPages = useMemo(
    () => currentChapter ? paginateText(currentChapter.text, selectedBook?.charsPerPage) : [''],
    [currentChapter, selectedBook?.charsPerPage],
  );
  const currentPage = selectedBook ? Math.min(selectedBook.currentPage, Math.max(0, bookPages.length - 1)) : 0;
  const currentPageText = bookPages[currentPage] || '';

  const discussionMode: ActiveCoViewMode | null = mode === 'cinema' || mode === 'reading' ? mode : null;
  const builtinVideoTitle = `内嵌视频站：${BUILTIN_VIDEO_SITE_NAME}`;
  const builtinVideoEmbedUrl = useMemo(() => buildCoViewBuiltinVideoSiteUrl(), []);
  const selectedMediaPlayable = selectedMedia && (selectedMedia.kind === 'local_file' || selectedMedia.kind === 'direct_url');
  const targetId = discussionMode === 'cinema' ? selectedMedia?.id || 'builtin_video_site_yinghuaanime' : discussionMode === 'reading' ? selectedBook?.id : undefined;
  const targetTitle = discussionMode === 'cinema' ? selectedMedia?.title || builtinVideoTitle : discussionMode === 'reading' ? selectedBook?.title : undefined;

  const getOrCreateSession = useCallback(async (): Promise<CoViewSession | null> => {
    if (!discussionMode || !selectedChar || !targetId) return null;
    const rows = await DB.getCoViewSessions();
    const existing = rows.find(row =>
      row.status === 'active' &&
      row.mode === discussionMode &&
      row.charId === selectedChar.id &&
      row.targetId === targetId
    );
    if (existing) return existing;
    const now = Date.now();
    const session: CoViewSession = {
      id: genId('cvs'),
      mode: discussionMode,
      charId: selectedChar.id,
      targetId,
      targetTitle,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    await DB.saveCoViewSession(session);
    return session;
  }, [discussionMode, selectedChar, targetId, targetTitle]);

  useEffect(() => {
    let alive = true;
    const run = async () => {
      if (!discussionMode || !selectedChar || !targetId) {
        setActiveSession(null);
        setMessages([]);
        return;
      }
      const session = await getOrCreateSession();
      const rows = session ? await DB.getCoViewMessages(session.id) : [];
      if (!alive) return;
      setActiveSession(session);
      setMessages(rows);
    };
    void run();
    return () => { alive = false; };
  }, [discussionMode, getOrCreateSession, selectedChar, targetId]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !selectedMedia || (selectedMedia.kind !== 'local_file' && selectedMedia.kind !== 'direct_url')) return;

    let objectUrl = '';
    let cancelled = false;
    let hls: any = null;
    const source = selectedMedia.kind === 'local_file'
      ? selectedMedia.blob ? URL.createObjectURL(selectedMedia.blob) : ''
      : selectedMedia.url || '';
    objectUrl = selectedMedia.kind === 'local_file' ? source : '';
    video.pause();
    video.removeAttribute('src');
    video.load();

    const attach = async () => {
      if (!source) return;
      if (isHlsUrl(source) && !video.canPlayType('application/vnd.apple.mpegurl')) {
        const mod = await import('hls.js');
        if (cancelled) return;
        const Hls = mod.default;
        if (Hls.isSupported()) {
          hls = new Hls();
          hls.loadSource(source);
          hls.attachMedia(video);
          return;
        }
      }
      video.src = source;
      video.load();
    };
    void attach();

    return () => {
      cancelled = true;
      if (hls) hls.destroy();
      video.pause();
      video.removeAttribute('src');
      video.load();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [selectedMedia]);

  const releaseCinemaVisionTracks = useCallback(() => {
    cinemaVisionStreamRef.current?.getTracks().forEach(track => {
      try { track.stop(); } catch { /* ignore */ }
    });
    cinemaVisionStreamRef.current = null;
    if (cinemaVisionVideoRef.current) {
      try { cinemaVisionVideoRef.current.pause(); } catch { /* ignore */ }
      cinemaVisionVideoRef.current.srcObject = null;
    }
    cinemaVisionVideoRef.current = null;
  }, []);

  const stopCinemaVision = useCallback(() => {
    releaseCinemaVisionTracks();
    setCinemaVisionSource('none');
    setCinemaVisionBusy(false);
    setCinemaVisionError('');
  }, [releaseCinemaVisionTracks]);

  const startCinemaVision = useCallback(async () => {
    if (cinemaVisionBusy) return;
    setCinemaVisionBusy(true);
    setCinemaVisionError('');
    setCinemaVisionFrame(null);
    releaseCinemaVisionTracks();
    try {
      if (selectedMedia?.kind === 'local_file' && videoRef.current) {
        setCinemaVisionSource('local_video');
        addToast('影院视觉已开启：读取本地视频当前帧', 'success');
        return;
      }

      if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('当前浏览器不支持屏幕共享抽帧');
      addToast('请选择正在播放共览影院的标签页或窗口', 'info');
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const [track] = stream.getVideoTracks();
      if (!track) throw new Error('没有可用的视频共享轨道');

      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await video.play().catch(() => undefined);
      cinemaVisionStreamRef.current = stream;
      cinemaVisionVideoRef.current = video;
      track.addEventListener('ended', () => stopCinemaVision(), { once: true });
      setCinemaVisionSource('screen_share');
      addToast('影院视觉已开启', 'success');
    } catch (err: any) {
      releaseCinemaVisionTracks();
      setCinemaVisionSource('none');
      const name = err?.name || '';
      const message = err?.message || '无法开启影院视觉';
      const cancelled = /AbortError|NotAllowedError|Permission/i.test(name) || /cancel|denied|permission|取消|拒绝/i.test(message);
      if (cancelled) {
        addToast('已取消影院视觉', 'info');
      } else {
        setCinemaVisionError(message);
        addToast(message, 'error');
      }
    } finally {
      setCinemaVisionBusy(false);
    }
  }, [addToast, cinemaVisionBusy, releaseCinemaVisionTracks, selectedMedia?.kind, stopCinemaVision]);

  const captureCinemaVisionFrame = useCallback(async (): Promise<CinemaVisionFrame | null> => {
    if (cinemaVisionSource === 'none') return null;
    setCinemaVisionError('');
    const sourceVideo = cinemaVisionSource === 'local_video' ? videoRef.current : cinemaVisionVideoRef.current;
    if (!sourceVideo) {
      const message = '还没有可读取的视频画面';
      setCinemaVisionError(message);
      return null;
    }
    try {
      const imageDataUrl = await captureVideoFrame(sourceVideo, 640, 0.72);
      if (!imageDataUrl) throw new Error('还没有抓到可用画面');
      const frame: CinemaVisionFrame = {
        imageDataUrl,
        capturedAt: Date.now(),
        sourceLabel: cinemaVisionSource === 'local_video' ? '本地视频当前帧' : '屏幕共享当前帧',
      };
      setCinemaVisionFrame(frame);
      return frame;
    } catch (err: any) {
      const message = err?.message || '当前画面抽帧失败';
      setCinemaVisionError(message);
      return null;
    }
  }, [cinemaVisionSource]);

  useEffect(() => () => releaseCinemaVisionTracks(), [releaseCinemaVisionTracks]);

  useEffect(() => {
    if (mode !== 'cinema' && cinemaVisionSource !== 'none') stopCinemaVision();
  }, [cinemaVisionSource, mode, stopCinemaVision]);

  useEffect(() => {
    if (cinemaVisionSource === 'local_video' && selectedMedia?.kind !== 'local_file') stopCinemaVision();
  }, [cinemaVisionSource, selectedMedia?.id, selectedMedia?.kind, stopCinemaVision]);

  const saveMedia = async (media: CoViewMedia) => {
    await DB.saveCoViewMedia(media);
    setMediaLibrary(prev => [media, ...prev.filter(item => item.id !== media.id)]);
    setSelectedMediaId(media.id);
  };

  const handleVideoFile = async (file?: File | null) => {
    if (!file) return;
    const now = Date.now();
    await saveMedia({
      id: genId('cvm'),
      kind: 'local_file',
      title: trimExt(file.name) || file.name,
      fileName: file.name,
      mimeType: file.type || 'video/*',
      size: file.size,
      blob: file,
      createdAt: now,
      updatedAt: now,
    });
    addToast('已加入共览影院', 'success');
  };

  const deleteMedia = async (id: string) => {
    await DB.deleteCoViewMedia(id);
    setMediaLibrary(prev => {
      const next = prev.filter(item => item.id !== id);
      if (selectedMediaId === id) setSelectedMediaId(next[0]?.id || '');
      return next;
    });
  };

  const handleBookFile = async (file?: File | null) => {
    if (!file) return;
    setIsParsingBook(true);
    try {
      const book = await parseCoViewBookFile(file);
      await DB.saveCoViewBook(book);
      setBooks(prev => [book, ...prev.filter(item => item.id !== book.id)]);
      setSelectedBookId(book.id);
      addToast('读本已加入共览阅读', 'success');
    } catch (error: any) {
      addToast(error?.message || '读本解析失败', 'error');
    } finally {
      setIsParsingBook(false);
    }
  };

  const saveBookProgress = useCallback(async (chapterIndex: number, page: number) => {
    if (!selectedBook) return;
    const chapter = selectedBook.chapters[Math.max(0, Math.min(chapterIndex, selectedBook.chapters.length - 1))];
    const pages = paginateText(chapter?.text || '', selectedBook.charsPerPage);
    const nextPage = Math.max(0, Math.min(page, Math.max(0, pages.length - 1)));
    const next: CoViewBook = {
      ...selectedBook,
      currentChapterIndex: chapter?.index ?? 0,
      currentPage: nextPage,
      updatedAt: Date.now(),
    };
    setBooks(prev => prev.map(item => item.id === next.id ? next : item));
    await DB.saveCoViewBook(next);
  }, [selectedBook]);

  const turnReadingPage = useCallback(async (delta: 1 | -1) => {
    if (!selectedBook) return;
    if (delta > 0) {
      if (currentPage < bookPages.length - 1) {
        await saveBookProgress(selectedBook.currentChapterIndex, currentPage + 1);
      } else if (selectedBook.currentChapterIndex < selectedBook.chapters.length - 1) {
        await saveBookProgress(selectedBook.currentChapterIndex + 1, 0);
      }
    } else if (currentPage > 0) {
      await saveBookProgress(selectedBook.currentChapterIndex, currentPage - 1);
    } else if (selectedBook.currentChapterIndex > 0) {
      const prevChapter = selectedBook.chapters[selectedBook.currentChapterIndex - 1];
      const prevPages = paginateText(prevChapter.text, selectedBook.charsPerPage);
      await saveBookProgress(selectedBook.currentChapterIndex - 1, Math.max(0, prevPages.length - 1));
    }
  }, [bookPages.length, currentPage, saveBookProgress, selectedBook]);

  const deleteBook = async (id: string) => {
    await DB.deleteCoViewBook(id);
    setBooks(prev => {
      const next = prev.filter(item => item.id !== id);
      if (selectedBookId === id) setSelectedBookId(next[0]?.id || '');
      return next;
    });
  };

  const applyAction = async (action: CoViewMessage['action']) => {
    if (!action || action.kind === 'none') return;
    if (action.kind === 'pause') videoRef.current?.pause();
    if (action.kind === 'resume') await videoRef.current?.play().catch(() => undefined);
    if (action.kind === 'next_page') await turnReadingPage(1);
    if (action.kind === 'prev_page') await turnReadingPage(-1);
  };

  const buildContextText = () => {
    if (discussionMode === 'cinema' && selectedMedia) {
      return [
        `片名：${selectedMedia.title}`,
        `来源：${mediaSubtitle(selectedMedia)}`,
        selectedMedia.description ? `简介：${selectedMedia.description}` : '',
        selectedMedia.url ? `链接：${selectedMedia.url}` : '',
        `播放状态：${videoPlaying ? '播放中' : '暂停/未播放'}`,
        `播放进度：${formatDuration(videoTime)} / ${formatDuration(videoDuration)}`,
      ].filter(Boolean).join('\n');
    }
    if (discussionMode === 'cinema') {
      return [
        `影院当前内嵌视频站：${BUILTIN_VIDEO_SITE_NAME}`,
        '用户可以直接在共览影院里浏览和播放，不需要自己准备链接。',
        cinemaVisionSource !== 'none' ? `影院视觉：${cinemaVisionSource === 'local_video' ? '本地视频抽帧已开启' : '屏幕共享抽帧已开启'}` : '影院视觉：未开启',
      ].join('\n');
    }
    if (discussionMode === 'reading' && selectedBook) {
      return [
        `书名：${selectedBook.title}`,
        selectedBook.author ? `作者：${selectedBook.author}` : '',
        `章节：${currentChapter?.title || '正文'}`,
        `页码：${currentPage + 1}/${bookPages.length}`,
        currentPageText,
      ].filter(Boolean).join('\n');
    }
    return '';
  };

  const progressLabel = () => discussionMode === 'cinema'
    ? selectedMedia ? `${formatDuration(videoTime)} / ${formatDuration(videoDuration)}${videoPlaying ? '，播放中' : '，暂停'}` : `内嵌视频站 · ${BUILTIN_VIDEO_SITE_NAME}${cinemaVisionSource !== 'none' ? ' · 视觉共览中' : ''}`
    : discussionMode === 'reading'
      ? `${currentChapter?.title || '正文'} · ${currentPage + 1}/${bookPages.length}`
      : '';

  const handleDiscuss = async (explicitText?: string) => {
    const text = (explicitText ?? draft).trim();
    if (!discussionMode) return;
    if (!selectedChar) { addToast('先选择一个角色', 'error'); return; }
    if (!targetId || !targetTitle) { addToast(discussionMode === 'cinema' ? '先加入一部片子' : '先导入一本书', 'error'); return; }
    const session = await getOrCreateSession();
    if (!session || isDiscussing) return;

    setIsDiscussing(true);
    setDraft('');
    const visionFrame = discussionMode === 'cinema' && cinemaVisionSource !== 'none'
      ? await captureCinemaVisionFrame()
      : null;
    let history = messages;
    if (text) {
      const userMsg: CoViewMessage = {
        id: genId('cvmg'),
        sessionId: session.id,
        mode: discussionMode,
        role: 'user',
        text,
        createdAt: Date.now(),
      };
      await DB.saveCoViewMessage(userMsg);
      history = [...history, userMsg];
      setMessages(history);
    }

    const now = Date.now();
    await DB.saveCoViewSession({
      ...session,
      targetTitle,
      progress: discussionMode === 'cinema'
        ? { seconds: videoTime, duration: videoDuration }
        : { chapterIndex: selectedBook?.currentChapterIndex, page: selectedBook?.currentPage },
      updatedAt: now,
    });

    try {
      const result = await discussCoView({
        mode: discussionMode,
        char: selectedChar,
        user: userProfile,
        api: auxApi as any,
        targetTitle,
        contextText: buildContextText(),
        history,
        userMessage: text || undefined,
        progressLabel: progressLabel(),
        playing: videoPlaying,
        visionFrameImageDataUrl: visionFrame?.imageDataUrl,
        visionFrameLabel: visionFrame ? `${visionFrame.sourceLabel} · ${new Date(visionFrame.capturedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : undefined,
      });
      const charMsg: CoViewMessage = {
        id: genId('cvmg'),
        sessionId: session.id,
        mode: discussionMode,
        role: 'character',
        charId: selectedChar.id,
        text: result.reply,
        action: result.action,
        createdAt: Date.now(),
      };
      await DB.saveCoViewMessage(charMsg);
      setMessages([...history, charMsg]);
      await applyAction(result.action);
    } finally {
      setIsDiscussing(false);
    }
  };

  const clearDiscussion = async () => {
    if (!activeSession) return;
    await DB.clearCoViewMessages(activeSession.id);
    setMessages([]);
  };

  const renderMediaList = () => (
    <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
      {mediaLibrary.map(media => {
        const active = selectedMediaId === media.id;
        return (
          <button
            key={media.id}
            onClick={() => setSelectedMediaId(media.id)}
            className="w-[150px] shrink-0 text-left rounded-2xl p-3 press-soft"
            style={active ? { background: A.solid, color: '#fff' } : { background: '#fff', color: INK, border: '1px solid rgba(0,0,0,0.06)' }}
          >
            <div className="flex items-center justify-between gap-2">
              <FilmSlate size={17} weight="fill" />
              <span className="text-[9px] font-bold truncate opacity-75">{media.kind === 'local_file' ? '本地' : media.kind === 'direct_url' ? '直连' : '旧记录'}</span>
            </div>
            <div className="mt-2 text-[12px] font-extrabold line-clamp-2">{media.title}</div>
            <div className="mt-1 text-[9px] line-clamp-1 opacity-70">{mediaSubtitle(media)}</div>
          </button>
        );
      })}
    </div>
  );

  const renderCinema = () => {
    const playable = selectedMediaPlayable;
    const visionOn = cinemaVisionSource !== 'none';
    const visionStatus = cinemaVisionSource === 'local_video'
      ? '本地视频抽帧'
      : cinemaVisionSource === 'screen_share'
        ? '屏幕共享抽帧'
        : '未开启';
    return (
      <div className="space-y-3" {...manualAnchorProps('manual-coview-cinema')}>
        <InsCard className="p-3 space-y-3" edge accent={AC}>
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[14px] font-extrabold" style={{ color: INK }}>影院</div>
              <div className="text-[10px]" style={{ color: INK_SOFT }}>影院已内嵌樱花动漫；本地视频可作为补充导入。</div>
            </div>
            <input
              ref={videoInputRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={e => {
                void handleVideoFile(e.target.files?.[0]);
                e.currentTarget.value = '';
              }}
            />
            <InsButton variant="soft" accent={AC} onClick={() => videoInputRef.current?.click()} className="px-3 py-2 text-[11px]" icon={<UploadSimple size={14} weight="bold" />}>
              本地
            </InsButton>
          </div>

        </InsCard>

        <InsCard className="p-3 space-y-3" edge accent={AC}>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[14px] font-extrabold" style={{ color: INK }}>樱花动漫</div>
              <div className="text-[10px]" style={{ color: INK_SOFT }}>已直接内嵌网站，打开影院即可在这里选片播放。</div>
            </div>
            <span className="rounded-full px-2 py-1 text-[9px] font-bold" style={{ background: A.soft, color: A.ink }}>WEB</span>
          </div>
          <div className="overflow-hidden rounded-[18px]" style={{ background: '#111217' }}>
            <iframe
              key={builtinVideoEmbedUrl}
              src={builtinVideoEmbedUrl}
              title="樱花动漫"
              className="h-[420px] w-full bg-white"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
            />
          </div>
          <div className="text-[10px] leading-relaxed" style={{ color: INK_SOFT }}>
            如果网站因浏览器安全策略拒绝被嵌入，页面会显示为空白或浏览器错误；本地视频导入仍可作为兜底。
          </div>
        </InsCard>

        <InsCard className="p-3 space-y-3" edge accent={AC}>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[14px] font-extrabold" style={{ color: INK }}>视觉共览</div>
              <div className="text-[10px]" style={{ color: INK_SOFT }}>{visionStatus}</div>
            </div>
            <span className="rounded-full px-2 py-1 text-[9px] font-bold" style={visionOn ? { background: A.solid, color: '#fff' } : { background: '#f2efeb', color: INK_SOFT }}>
              {visionOn ? 'VISION' : 'OFF'}
            </span>
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-2 items-center">
            <div className="min-w-0 rounded-2xl p-3" style={{ background: '#f7f5f2' }}>
              <div className="text-[11px] leading-relaxed" style={{ color: INK_SOFT }}>
                {cinemaVisionSource === 'none'
                  ? (selectedMedia?.kind === 'local_file' ? '开启后会读取本地视频当前帧。' : '开启后会读取共享标签页或窗口的当前帧。')
                  : cinemaVisionFrame
                    ? `${cinemaVisionFrame.sourceLabel} · ${new Date(cinemaVisionFrame.capturedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                    : '下一次发言会带上当前帧。'}
              </div>
              {cinemaVisionError && <div className="mt-1 text-[10px] font-bold text-rose-500">{cinemaVisionError}</div>}
            </div>
            {cinemaVisionFrame ? (
              <img src={cinemaVisionFrame.imageDataUrl} alt="" className="h-16 w-24 rounded-2xl object-cover" style={{ border: '1px solid rgba(0,0,0,0.08)' }} />
            ) : (
              <div className="h-16 w-24 rounded-2xl flex items-center justify-center" style={{ background: A.soft, color: A.ink }}>
                <Eye size={20} weight="fill" />
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {visionOn ? (
              <InsButton variant="soft" accent="slate" onClick={stopCinemaVision} className="py-2 text-[11px]" icon={<StopCircle size={14} weight="bold" />}>
                停止视觉
              </InsButton>
            ) : (
              <InsButton variant="soft" accent={AC} disabled={cinemaVisionBusy} onClick={() => void startCinemaVision()} className="py-2 text-[11px]" icon={<Eye size={14} weight="bold" />}>
                {cinemaVisionBusy ? '开启中' : '开启视觉'}
              </InsButton>
            )}
            <InsButton variant="soft" accent={AC} disabled={!visionOn || cinemaVisionBusy} onClick={() => void captureCinemaVisionFrame()} className="py-2 text-[11px]" icon={<Sparkle size={14} weight="fill" />}>
              看这一帧
            </InsButton>
          </div>
        </InsCard>

        {mediaLibrary.length > 0 && renderMediaList()}

        {selectedMedia && (
          <InsCard className="p-3 space-y-3">
            <>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[15px] font-extrabold truncate" style={{ color: INK }}>{selectedMedia.title}</div>
                  <div className="text-[10px]" style={{ color: INK_SOFT }}>{mediaSubtitle(selectedMedia)}</div>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  {selectedMedia.url && (
                    <IconCircle size={32} onClick={() => window.open(selectedMedia.url, '_blank', 'noopener,noreferrer')} title="外部打开">
                      <ArrowSquareOut size={15} weight="bold" />
                    </IconCircle>
                  )}
                  <IconCircle size={32} onClick={() => void deleteMedia(selectedMedia.id)} title="删除">
                    <Trash size={15} weight="bold" />
                  </IconCircle>
                </div>
              </div>
              {playable ? (
                <div className="space-y-2">
                  <div className="overflow-hidden rounded-[18px]" style={{ background: '#111217' }}>
                    <video
                      ref={videoRef}
                      controls
                      playsInline
                      className="aspect-video w-full bg-black"
                      onTimeUpdate={e => setVideoTime(e.currentTarget.currentTime || 0)}
                      onLoadedMetadata={e => setVideoDuration(e.currentTarget.duration || 0)}
                      onPlay={() => setVideoPlaying(true)}
                      onPause={() => setVideoPlaying(false)}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2 text-[10px]" style={{ color: INK_SOFT }}>
                    <span>{formatDuration(videoTime)} / {formatDuration(videoDuration)}</span>
                    <div className="flex gap-2">
                      <InsButton variant="soft" accent={AC} onClick={() => void videoRef.current?.play()} className="px-3 py-1.5 text-[10px]" icon={<Play size={12} weight="fill" />}>播放</InsButton>
                      <InsButton variant="soft" accent="slate" onClick={() => videoRef.current?.pause()} className="px-3 py-1.5 text-[10px]" icon={<Pause size={12} weight="fill" />}>暂停</InsButton>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl p-4 flex gap-3" style={{ background: '#f7f5f2' }}>
                  <FilmSlate size={20} weight="fill" style={{ color: A.solid }} />
                  <div className="min-w-0">
                    <div className="text-[12px] font-bold" style={{ color: INK }}>旧收藏记录</div>
                    <div className="text-[11px] leading-relaxed mt-1" style={{ color: INK_SOFT }}>
                      这是旧版影院留下的片名或网页记录。现在影院默认使用上方樱花动漫内嵌站点播放，旧记录仍可保留作备注。
                    </div>
                    {selectedMedia.url && (
                      <InsButton variant="soft" accent="slate" onClick={() => window.open(selectedMedia.url, '_blank', 'noopener,noreferrer')} className="mt-2 px-3 py-1.5 text-[10px]" icon={<ArrowSquareOut size={12} weight="bold" />}>
                        打开原记录
                      </InsButton>
                    )}
                  </div>
                </div>
              )}
              {selectedMedia.description && <p className="text-[11px] leading-relaxed" style={{ color: INK_SOFT }}>{selectedMedia.description}</p>}
            </>
          </InsCard>
        )}
      </div>
    );
  };

  const renderReading = () => (
    <div className="space-y-3" {...manualAnchorProps('manual-coview-reading')}>
      <InsCard className="p-3 space-y-3" edge accent={AC}>
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-[14px] font-extrabold" style={{ color: INK }}>阅读</div>
            <div className="text-[10px]" style={{ color: INK_SOFT }}>TXT / MD / EPUB 会切章节分页，角色可边读边翻页。</div>
          </div>
          <input
            ref={bookInputRef}
            type="file"
            accept=".txt,.md,.markdown,.epub,text/plain,text/markdown,application/epub+zip"
            className="hidden"
            onChange={e => {
              void handleBookFile(e.target.files?.[0]);
              e.currentTarget.value = '';
            }}
          />
          <InsButton
            variant="soft"
            accent={AC}
            disabled={isParsingBook}
            onClick={() => bookInputRef.current?.click()}
            className="px-3 py-2 text-[11px]"
            icon={<UploadSimple size={14} weight="bold" />}
          >
            {isParsingBook ? '解析中' : '导入'}
          </InsButton>
        </div>
        {books.length > 0 && (
          <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
            {books.map(book => {
              const active = book.id === selectedBookId;
              return (
                <button
                  key={book.id}
                  onClick={() => setSelectedBookId(book.id)}
                  className="w-[148px] shrink-0 rounded-2xl p-3 text-left press-soft"
                  style={active ? { background: A.solid, color: '#fff' } : { background: '#f7f5f2', color: INK }}
                >
                  <BookOpenText size={17} weight="fill" />
                  <div className="mt-2 text-[12px] font-extrabold line-clamp-2">{book.title}</div>
                  <div className="mt-1 text-[9px] opacity-70">{book.chapters.length} 章 · {book.sourceType.toUpperCase()}</div>
                </button>
              );
            })}
          </div>
        )}
      </InsCard>

      <InsCard className="p-3 space-y-3">
        {selectedBook && currentChapter ? (
          <>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[15px] font-extrabold truncate" style={{ color: INK }}>{selectedBook.title}</div>
                <div className="text-[10px]" style={{ color: INK_SOFT }}>
                  {currentChapter.title} · {currentPage + 1}/{bookPages.length}
                </div>
              </div>
              <IconCircle size={32} onClick={() => void deleteBook(selectedBook.id)} title="删除读本"><Trash size={15} weight="bold" /></IconCircle>
            </div>
            <div className="rounded-2xl px-4 py-4 min-h-[250px]" style={{ background: '#fffdf8', border: '1px solid rgba(0,0,0,0.06)' }}>
              <div className="text-[11px] font-bold mb-2" style={{ color: A.solid }}>{currentChapter.title}</div>
              <div className="whitespace-pre-wrap text-[14px] leading-7 select-text" style={{ color: '#34313a' }}>{currentPageText}</div>
            </div>
            <div className="flex items-center justify-between gap-2">
              <InsButton variant="soft" accent="slate" onClick={() => void turnReadingPage(-1)} className="px-3 py-2 text-[11px]" icon={<CaretLeft size={14} weight="bold" />}>上一页</InsButton>
              <span className="text-[10px]" style={{ color: INK_SOFT }}>第 {selectedBook.currentChapterIndex + 1}/{selectedBook.chapters.length} 章</span>
              <InsButton variant="soft" accent={AC} onClick={() => void turnReadingPage(1)} className="px-3 py-2 text-[11px]" icon={<CaretRight size={14} weight="bold" />}>下一页</InsButton>
            </div>
          </>
        ) : (
          <InsEmpty icon={<BookOpenText size={42} weight="fill" />} title="还没有读本" hint="导入 TXT、Markdown 或 EPUB，就能和角色逐页共读。" className="py-12" />
        )}
      </InsCard>
    </div>
  );

  const renderDiscussion = () => {
    if (!discussionMode) return null;
    return (
      <div {...manualAnchorProps('manual-coview-discuss')}>
        <InsCard className="p-3 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <ChatCircleText size={17} weight="fill" style={{ color: A.solid }} />
              <div className="min-w-0">
                <div className="text-[13px] font-extrabold truncate" style={{ color: INK }}>共览讨论</div>
                <div className="text-[9px] truncate" style={{ color: INK_SOFT }}>{selectedChar ? selectedChar.name : '未选择角色'} · {targetTitle || '未选择内容'}</div>
              </div>
            </div>
            {messages.length > 0 && <IconCircle size={30} onClick={() => void clearDiscussion()} title="清空会话"><X size={14} weight="bold" /></IconCircle>}
          </div>

          <div className="space-y-2 max-h-[260px] overflow-y-auto no-scrollbar pr-1">
            {messages.length === 0 ? (
              <div className="rounded-2xl p-4 text-[11px] leading-relaxed" style={{ background: '#f7f5f2', color: INK_SOFT }}>
                {selectedChar
                  ? discussionMode === 'cinema' && cinemaVisionSource !== 'none'
                    ? `${selectedChar.name} 会带着当前画面一起接话。`
                    : `${selectedChar.name} 会根据片名、简介、播放进度或当前正文来接话。`
                  : '选择角色后即可开始讨论。'}
              </div>
            ) : messages.map(msg => {
              const mine = msg.role === 'user';
              return (
                <div key={msg.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className="max-w-[84%] rounded-2xl px-3 py-2"
                    style={mine ? { background: A.solid, color: '#fff' } : { background: '#f7f5f2', color: INK }}
                  >
                    <div className="text-[12px] leading-relaxed whitespace-pre-wrap break-words">{msg.text}</div>
                    {actionText(msg.action) && <div className="mt-1 text-[9px] opacity-70">{actionText(msg.action)}</div>}
                  </div>
                </div>
              );
            })}
            {isDiscussing && (
              <div className="text-[11px] font-bold" style={{ color: INK_SOFT }}>{selectedChar?.name || '角色'} 正在看...</div>
            )}
          </div>

          <div className="flex gap-2">
            <input
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void handleDiscuss(); }}
              placeholder={discussionMode === 'cinema' ? '问 TA 对这一段的感觉' : '问 TA 读到哪里了'}
              className="min-w-0 flex-1 rounded-full px-3 py-2 text-[12px] outline-none"
              style={{ background: '#f7f5f2', color: INK }}
            />
            <InsButton variant="solid" accent={AC} disabled={isDiscussing} onClick={() => void handleDiscuss()} className="px-4 py-2 text-[12px]">
              发送
            </InsButton>
          </div>
          <InsButton variant="ghost" accent={AC} disabled={isDiscussing} onClick={() => void handleDiscuss('')} className="w-full py-2 text-[11px]" icon={<Sparkle size={14} weight="fill" />}>
            听 TA 说一句
          </InsButton>
        </InsCard>
      </div>
    );
  };

  return (
    <InsShell accent={AC}>
      <div {...manualAnchorProps('manual-coview-root')}>
        <InsHeader
          title="共览"
          en="CO-VIEW"
          onBack={goBack}
          accent={AC}
          right={
            <CharacterButton char={selectedChar} disabled={mode === 'free_roam'} onClick={() => setShowCharPicker(true)} />
          }
        />
      </div>
      <ModeTabs mode={mode} setMode={setMode} />

      {mode === 'free_roam' ? (
        <div className="relative z-10 flex-1 min-h-0 px-3 pb-3" {...manualAnchorProps('manual-coview-free-roam')}>
          <div className="relative h-full overflow-hidden rounded-[24px]" style={{ background: 'rgba(255,255,255,0.58)', border: '1px solid rgba(0,0,0,0.06)' }}>
            <XhsFreeRoamPanel embedded hideBackButton />
          </div>
        </div>
      ) : (
        <InsScroll className="px-3 pb-5 space-y-3">
          {mode === 'cinema' ? renderCinema() : renderReading()}
          {renderDiscussion()}
        </InsScroll>
      )}

      <InsSheet open={showCharPicker} title="选择共览角色" onClose={() => setShowCharPicker(false)}>
        <div className="max-h-[55vh] overflow-y-auto no-scrollbar space-y-1.5">
          {characters.length === 0 ? (
            <InsEmpty icon={<ChatCircleText size={34} weight="fill" />} title="还没有角色" hint="先去剪影集创建角色，再回来共看或共读。" className="py-8" />
          ) : characters.map(char => (
            <button
              key={char.id}
              onClick={() => { setSelectedCharId(char.id); setShowCharPicker(false); }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl text-left press-soft"
              style={{ background: char.id === selectedCharId ? A.soft : '#f7f5f2' }}
            >
              {char.avatar
                ? <img src={char.avatar} className="w-9 h-9 rounded-full object-cover shrink-0" alt="" />
                : <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={{ background: A.soft, color: A.ink }}>{char.name[0]}</div>}
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-extrabold truncate" style={{ color: INK }}>{char.name}</div>
                {char.description && <div className="text-[10px] truncate" style={{ color: INK_SOFT }}>{char.description}</div>}
              </div>
              {char.id === selectedCharId && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: A.solid }} />}
            </button>
          ))}
        </div>
      </InsSheet>
    </InsShell>
  );
};

export default CoViewApp;
