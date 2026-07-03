import React, { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { useOS } from '../../context/OSContext';
import {
  CharacterProfile, CoupleSpace as CoupleSpaceData, CoupleMoment, CoupleAnniversary,
  CouplePhoto, CoupleTask, CoupleWish, CoupleQuestion, CoupleWhisper, CoupleInteractionKind, CoupleMedia, CoupleMediaKind,
  CouplePlant, CoupleEyesEra, CoupleEyesCard,
} from '../../types';
import { AppID } from '../../types';
import { processImage } from '../../utils/file';
import { resolveAuxApi } from '../../utils/auxApi';
import Modal from '../os/Modal';
import {
  ensureCoupleSpace, createCoupleSpace, genCoupleId, loveDays, nextOccurrence,
  intimacyLevel, intimacyProgress, intimacyTitle, INTERACTIONS, interactionDef,
  fallbackCharInteractionNote, todayYmd, pushInteraction,
  generateCharCoupleComment, generateCharWhisperReply, generateCharInteractionNote, generateCharMoment,
  generateCharInnerVoice, fallbackInnerVoice,
  generateCharQuestionAnswer, fallbackQuestionAnswer,
  plantStage, PLANT_CARE,
  pickCompatQuestions, generateCharCompatAnswers, type CompatQuestion,
  generateCoupleRecap, applyCoupleAutoCareDraft,
  generateCoupleEyesCard, upsertCoupleEyesCard, applyCoupleQuestionAnswer,
} from '../../utils/coupleSpace';
import {
  Heart, Sparkle, Trash, Plus, ArrowsClockwise, Camera, PaperPlaneTilt,
  CheckCircle, Circle, List, EnvelopeOpen, CalendarBlank, X, ChatCircleDots,
  Microphone, MusicNotes, Gift, ImageSquare, Quotes, ArrowLeft,
} from '@phosphor-icons/react';

const PARTNER_KEY = 'moro_couple_partner_id';
const MAX_IMAGES = 9;
const MOOD_EMOJIS = ['😊', '🥰', '😍', '🤗', '😋', '🥳', '🤔', '😢', '😴', '💕', '🌙', '☀️'];
const TASK_SUGGESTIONS = ['今天说晚安', '一起看一部电影', '给对方做顿饭', '一起散步半小时', '互道一句早安', '拍一张合照'];
const WISH_SUGGESTIONS = ['一起去看海', '一起养一只猫', '去看一场演唱会', '一起跨年', '环游一座城市', '拍一组情侣写真'];
const QUESTION_SUGGESTIONS = ['你最喜欢我哪一点？', '第一次见我时你什么感觉？', '理想中的约会是什么样？', '最想和我一起去哪里？', '今天有没有偷偷想我？', '最近有什么心事吗？'];
const EYES_ERAS: { era: CoupleEyesEra; title: string; stamp: string; note: string }[] = [
  { era: 'past', title: '过去的我', stamp: '昔', note: 'TA 记忆里的轮廓' },
  { era: 'present', title: '现在的我', stamp: '今', note: 'TA 此刻看见的你' },
  { era: 'future', title: '将来的我', stamp: '望', note: 'TA 的期待与想象' },
];

// ── 全局设计 token：贴近「来往」里的清爽社交界面，收掉手账/胶带质感 ──
const ACCENT_SOLID = '#E97891';
const ACCENT = `linear-gradient(135deg, ${ACCENT_SOLID} 0%, #F2A0B0 100%)`;
const ACCENT_SOFT = 'linear-gradient(135deg, #FFFAFB 0%, #FFF2F5 100%)';
const FONT_STACK = '"Quicksand", "PingFang SC", "Noto Sans SC", "Nunito", sans-serif';
const AVATAR_GLOW = '0 8px 24px rgba(233, 120, 145, 0.18)';
const BG = '#FFFAFB';
const INK = '#293241';
const INK_SOFT = '#7B8794';
const LINE = '#F1E6EA';
const ACCENT_BORDER = '#F4C4CE';
const ACCENT_TEXT = '#B85469';
const ACCENT_MUTED = '#DD8195';
const ACCENT_PANEL = '#FFF2F5';

// 心电图（ECG）路径：一条基本水平、含一处心跳尖峰的折线（用 pathLength=100 归一化便于动画）
const ECG_D = 'M2,20 H44 l5,-3 l4,6 l5,-21 l5,33 l5,-18 l4,3 H118';

const romanticBtn = 'rounded-full font-bold active:scale-95 transition-transform disabled:opacity-50';

type ComposeMedia = { kind: CoupleMediaKind; name: string; duration?: string };

// 友好的相对时间（悄悄话 / 照片用）
const timeAgo = (ts: number): string => {
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  const d = new Date(ts);
  const now = new Date();
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
};

// 时间线绝对时间戳：2024.10.22 21:00
const fmtStamp = (ts: number): string => {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const KIND_LABEL: Record<CoupleAnniversary['kind'], string> = {
  love: '恋爱纪念', birthday: '生日', promise: '约定日', custom: '纪念日',
};
const KIND_EMOJI: Record<CoupleAnniversary['kind'], string> = {
  love: '💞', birthday: '🎂', promise: '🤙', custom: '📌',
};

type Tab = 'today' | 'moments' | 'album' | 'tasks' | 'anniversary' | 'profile' | 'recap' | 'game';
type CoupleSpaceProps = {
  visibleCharacters?: CharacterProfile[];
};

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

const SoftCard: React.FC<{
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  onClick?: React.MouseEventHandler<HTMLElement>;
  emphasis?: 'ink' | null;
}> = ({ children, className = '', style, onClick, emphasis }) => {
  const classes = cx(
    'rounded-2xl bg-white border shadow-[0_8px_24px_rgba(20,31,48,0.05)]',
    emphasis === 'ink' && 'shadow-[0_10px_26px_rgba(233,120,145,0.12)]',
    onClick && 'w-full text-left active:scale-[0.99] transition-transform',
    className,
  );
  const mergedStyle = { borderColor: emphasis === 'ink' ? ACCENT_BORDER : LINE, ...style };
  if (onClick) {
    return (
      <button type="button" onClick={onClick as React.MouseEventHandler<HTMLButtonElement>} className={classes} style={mergedStyle}>
        {children}
      </button>
    );
  }
  return <div className={classes} style={mergedStyle}>{children}</div>;
};

const SoftButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'ink' | 'paper';
  icon?: React.ReactNode;
}> = ({ variant = 'ink', icon, className = '', children, type = 'button', ...props }) => {
  const isPrimary = variant === 'ink';
  return (
    <button
      {...props}
      type={type}
      className={cx(
        'rounded-2xl font-bold active:scale-95 transition disabled:opacity-50 disabled:active:scale-100 inline-flex items-center justify-center gap-1.5',
        className,
      )}
      style={isPrimary
        ? { background: ACCENT, color: '#fff', border: '1px solid transparent', ...(props.style || {}) }
        : { background: '#fff', color: INK, border: `1px solid ${LINE}`, ...(props.style || {}) }}
    >
      {icon}
      {children}
    </button>
  );
};

const SoftBadge: React.FC<{ size?: number; children: React.ReactNode }> = ({ size = 40, children }) => (
  <span
    className="inline-flex shrink-0 items-center justify-center rounded-2xl font-black text-white shadow-[0_8px_20px_rgba(233,120,145,0.18)]"
    style={{ width: size, height: size, minWidth: size, background: ACCENT }}
  >
    {children}
  </span>
);

const AvatarThumb: React.FC<{ src?: string; caption?: string; size?: number }> = ({ src, caption, size = 48 }) => (
  <div className="relative shrink-0 rounded-2xl overflow-hidden border bg-white" style={{ width: size, height: size, borderColor: LINE }}>
    {src ? <img src={src} className="w-full h-full object-cover" /> : <div className="w-full h-full" style={{ background: ACCENT_SOFT }} />}
    {caption && (
      <span className="absolute right-1 bottom-1 rounded-full bg-white/90 px-1.5 py-0.5 text-[8px] font-black" style={{ color: ACCENT_TEXT }}>
        {caption}
      </span>
    )}
  </div>
);

// ── 心跳连线（SVG ECG，stroke-dashoffset 持续流动） ──
const HeartbeatLine: React.FC = () => (
  <svg viewBox="0 0 120 40" preserveAspectRatio="none" className="w-full h-10" aria-hidden>
    {/* 底层淡线 */}
    <path pathLength={100} d={ECG_D} fill="none" stroke={LINE} strokeWidth={2.5}
      strokeLinecap="round" strokeLinejoin="round" opacity={0.7} />
    {/* 流动的亮色脉冲（一段亮线沿路径从左向右循环） */}
    <path pathLength={100} d={ECG_D} fill="none" stroke={ACCENT_MUTED} strokeWidth={3}
      strokeLinecap="round" strokeLinejoin="round"
      style={{ strokeDasharray: '20 80', animation: 'csEcg 1.6s linear infinite' }} />
  </svg>
);

const CoupleSpace: React.FC<CoupleSpaceProps> = ({ visibleCharacters }) => {
  const { characters, userProfile, updateCharacter, addToast, apiConfig, auxApiConfig, openApp, setActiveCharacterId } = useOS();
  const directoryCharacters = visibleCharacters || characters;

  const [partnerId, setPartnerId] = useState<string | null>(() => {
    try { return localStorage.getItem(PARTNER_KEY); } catch { return null; }
  });
  const [showDirectory, setShowDirectory] = useState(true);
  const partner = useMemo(() => directoryCharacters.find(c => c.id === partnerId) || null, [directoryCharacters, partnerId]);
  const space = useMemo(() => ensureCoupleSpace(partner || undefined), [partner]);

  const charactersRef = useRef(characters); charactersRef.current = characters;
  const partnerIdRef = useRef(partnerId); partnerIdRef.current = partnerId;

  const userName = userProfile.name?.trim() || '我';
  const userAvatar = userProfile.avatar;
  const partnerName = partner?.convoSettings?.remarkName?.trim() || partner?.name || 'TA';
  const partnerAvatar = partner?.convoSettings?.charAvatarOverride || partner?.avatar;

  const coupleApi = useMemo(() => resolveAuxApi(auxApiConfig, apiConfig), [auxApiConfig, apiConfig]);

  // 写库：基于最新角色数据合成新的 coupleSpace（async 流程下也不会用脏闭包覆盖）
  const mutate = useCallback((fn: (cs: CoupleSpaceData) => CoupleSpaceData, addIntimacy = 0) => {
    const pid = partnerIdRef.current;
    if (!pid) return;
    const fresh = charactersRef.current.find(c => c.id === pid);
    if (!fresh) return;
    let next = fn(ensureCoupleSpace(fresh));
    if (addIntimacy) next = { ...next, intimacy: Math.max(0, Math.round((next.intimacy || 0) + addIntimacy)) };
    next = { ...next, updatedAt: Date.now() };
    void updateCharacter(pid, { coupleSpace: next });
  }, [updateCharacter]);

  // ── 绑定 / 解绑 ──
  const bindPartner = (id: string) => {
    if (!directoryCharacters.some(c => c.id === id)) return;
    try { localStorage.setItem(PARTNER_KEY, id); } catch { /* ignore */ }
    setPartnerId(id);
    setShowDirectory(false);
    const c = charactersRef.current.find(x => x.id === id);
    if (c && !c.coupleSpace) void updateCharacter(id, { coupleSpace: createCoupleSpace() });
  };
  const unbind = () => {
    try { localStorage.removeItem(PARTNER_KEY); } catch { /* ignore */ }
    setPartnerId(null);
    setShowDirectory(true);
    setShowSettings(false);
  };

  // ── UI 状态 ──
  const [tab, setTab] = useState<Tab>('today');
  const [showSettings, setShowSettings] = useState(false);
  const [showWhispers, setShowWhispers] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [showAnnivForm, setShowAnnivForm] = useState(false);
  const [showAnnivDateSet, setShowAnnivDateSet] = useState(false);
  const [photoView, setPhotoView] = useState<CouplePhoto | null>(null);
  const [profileDraft, setProfileDraft] = useState({ homeName: '', userNickname: '', charNickname: '', loveLanguage: '', rituals: '' });
  const [checkinMood, setCheckinMood] = useState('');
  const [checkinNote, setCheckinNote] = useState('');
  const [recapBusy, setRecapBusy] = useState(false);
  const [showEyes, setShowEyes] = useState(false);
  const [eyesEra, setEyesEra] = useState<CoupleEyesEra | null>(null);
  const [eyesBusy, setEyesBusy] = useState<CoupleEyesEra | null>(null);
  const [expandedQuestions, setExpandedQuestions] = useState<Record<string, boolean>>({});

  // 互动反馈 + 漂浮动画
  const [charReaction, setCharReaction] = useState<{ text: string; emoji: string; loading?: boolean } | null>(null);
  const [burst, setBurst] = useState<{ id: number; emoji: string } | null>(null);
  const lastReactionAt = useRef(0);
  const reactionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (reactionTimer.current) clearTimeout(reactionTimer.current); }, []);

  const showReactionFor = (text: string, emoji: string, loading = false) => {
    setCharReaction({ text, emoji, loading });
    if (reactionTimer.current) clearTimeout(reactionTimer.current);
    reactionTimer.current = setTimeout(() => setCharReaction(null), 6000);
  };

  // ── 每日互动 ──
  const doInteraction = async (kind: CoupleInteractionKind) => {
    if (!partner) return;
    const def = interactionDef(kind);
    const bid = Date.now();
    setBurst({ id: bid, emoji: def.emoji });
    setTimeout(() => setBurst(b => (b?.id === bid ? null : b)), 1400);

    const throttled = Date.now() - lastReactionAt.current < 6000;
    const fallback = fallbackCharInteractionNote(kind);

    // 节流时不调 LLM：一次写入「用户互动 + 角色兜底反应」，避免两次同步写互相覆盖
    if (throttled) {
      mutate(cs => ({
        ...cs,
        interactions: pushInteraction(
          pushInteraction(cs.interactions, { id: genCoupleId('it'), kind, by: 'user', at: Date.now() }),
          { id: genCoupleId('it'), kind, by: 'char', note: fallback, at: Date.now() },
        ),
      }), def.gain);
      showReactionFor(fallback, def.emoji, false);
      return;
    }

    // 先记录用户侧互动 + 加亲密度，再异步取角色反应（await 之间已重渲染，第二次写基于最新数据）
    mutate(cs => ({ ...cs, interactions: pushInteraction(cs.interactions, { id: genCoupleId('it'), kind, by: 'user', at: Date.now() }) }), def.gain);
    lastReactionAt.current = Date.now();
    showReactionFor(fallback, def.emoji, true);
    let note = '';
    try { note = await generateCharInteractionNote({ char: partner, userName, api: coupleApi, kind }); } catch { /* ignore */ }
    const finalNote = note || fallback;
    showReactionFor(finalNote, def.emoji, false);
    mutate(cs => ({ ...cs, interactions: pushInteraction(cs.interactions, { id: genCoupleId('it'), kind, by: 'char', note: finalNote, at: Date.now() }) }), 1);
  };

  // ── 动态 / 留言板 ──
  const [composeText, setComposeText] = useState('');
  const [composeMood, setComposeMood] = useState('');
  const [composeImages, setComposeImages] = useState<string[]>([]);
  const [composeMedia, setComposeMedia] = useState<ComposeMedia | null>(null);
  const [engagingId, setEngagingId] = useState<string | null>(null);
  const [charMomentBusy, setCharMomentBusy] = useState(false);
  const composeFileRef = useRef<HTMLInputElement>(null);

  const resetCompose = () => { setComposeText(''); setComposeMood(''); setComposeImages([]); setComposeMedia(null); };

  const pickComposeImages = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    const room = MAX_IMAGES - composeImages.length;
    if (room <= 0) { addToast(`最多 ${MAX_IMAGES} 张图片`, 'error'); return; }
    try {
      const picked = await Promise.all(files.slice(0, room).map(f => processImage(f, { maxWidth: 1080, quality: 0.8, forceJpeg: true })));
      setComposeImages(prev => [...prev, ...picked]);
    } catch (err: any) { addToast(err?.message || '图片处理失败', 'error'); }
  };

  const postUserMoment = async () => {
    if (!partner) return;
    const text = composeText.trim();
    const mediaName = composeMedia?.name.trim();
    if (!text && composeImages.length === 0 && !composeMood && !mediaName) { addToast('写点什么、加张图或附段语音吧', 'info'); return; }
    const id = genCoupleId('mo');
    const media: CoupleMedia | undefined = composeMedia && mediaName
      ? { kind: composeMedia.kind, name: mediaName, duration: composeMedia.kind === 'voice' ? (composeMedia.duration?.trim() || '00:15') : undefined }
      : undefined;
    const moment: CoupleMoment = {
      id, author: 'user', text: text || undefined, mood: composeMood || undefined,
      images: composeImages.length ? composeImages : undefined, media,
      createdAt: Date.now(), comments: [], likedByUser: false, likedByChar: false,
    };
    mutate(cs => ({ ...cs, moments: [moment, ...cs.moments] }), 3);
    resetCompose();
    setShowCompose(false);

    // 角色主动看动态 → 点赞 + 评论
    setEngagingId(id);
    let comment = '';
    try { comment = await generateCharCoupleComment({ char: partner, userName, api: coupleApi, moment }); } catch { /* ignore */ }
    mutate(cs => ({
      ...cs,
      moments: cs.moments.map(m => m.id === id
        ? { ...m, likedByChar: true, comments: comment ? [...m.comments, { id: genCoupleId('cm'), author: 'char' as const, text: comment, at: Date.now() }] : m.comments }
        : m),
    }), comment ? 2 : 0);
    setEngagingId(null);
  };

  const requestCharMoment = async () => {
    if (!partner || charMomentBusy) return;
    setCharMomentBusy(true);
    let res: { text: string; mood?: string; media?: CoupleMedia } | null = null;
    try { res = await generateCharMoment({ char: partner, userName, api: coupleApi, space }); } catch { /* ignore */ }
    if (res) {
      const moment: CoupleMoment = {
        id: genCoupleId('mo'), author: 'char', text: res.text, mood: res.mood, media: res.media,
        createdAt: Date.now(), comments: [], likedByUser: false, likedByChar: true,
      };
      mutate(cs => ({ ...cs, moments: [moment, ...cs.moments] }), 2);
    } else {
      addToast('TA 这会儿没冒泡，过会儿再试试', 'info');
    }
    setCharMomentBusy(false);
  };

  const toggleLike = (mid: string) => mutate(cs => ({
    ...cs, moments: cs.moments.map(m => m.id === mid ? { ...m, likedByUser: !m.likedByUser } : m),
  }), 0);

  const addUserComment = (mid: string, text: string) => {
    const t = text.trim(); if (!t) return;
    mutate(cs => ({
      ...cs, moments: cs.moments.map(m => m.id === mid
        ? { ...m, comments: [...m.comments, { id: genCoupleId('cm'), author: 'user' as const, text: t, at: Date.now() }] } : m),
    }), 0);
  };

  const deleteMoment = (mid: string) => mutate(cs => ({ ...cs, moments: cs.moments.filter(m => m.id !== mid) }), 0);

  // ── 心声弹窗（两阶段：声波加载 1.5s → 黑色心声卡片浮现） ──
  const [innerMoment, setInnerMoment] = useState<CoupleMoment | null>(null);
  const [innerPhase, setInnerPhase] = useState<'loading' | 'card'>('loading');
  const [innerText, setInnerText] = useState('');
  const innerToken = useRef(0);

  const openInnerVoice = (m: CoupleMoment) => {
    const token = ++innerToken.current;
    setInnerMoment(m);
    setInnerPhase('loading');
    setInnerText('');
    const minDelay = new Promise<void>(r => setTimeout(r, 1500));   // 声波加载至少演 1.5s
    const cached = m.innerVoice;
    const textP: Promise<string> = cached
      ? Promise.resolve(cached)
      : (partner
        ? generateCharInnerVoice({ char: partner, userName, api: coupleApi, moment: m })
          .then(t => t || fallbackInnerVoice(m)).catch(() => fallbackInnerVoice(m))
        : Promise.resolve(fallbackInnerVoice(m)));
    void Promise.all([minDelay, textP]).then(([, text]) => {
      if (innerToken.current !== token) return;   // 期间已关闭 / 换了一条
      setInnerText(text);
      setInnerPhase('card');
      if (!cached && text) {
        mutate(cs => ({ ...cs, moments: cs.moments.map(x => x.id === m.id ? { ...x, innerVoice: text } : x) }), 0);
      }
    });
  };
  const closeInnerVoice = () => { innerToken.current++; setInnerMoment(null); };

  // ── 纪念日 ──
  const [annivTitle, setAnnivTitle] = useState('');
  const [annivDate, setAnnivDate] = useState(todayYmd());
  const [annivKind, setAnnivKind] = useState<CoupleAnniversary['kind']>('custom');
  const [annivRepeat, setAnnivRepeat] = useState(true);
  const [annivDateDraft, setAnnivDateDraft] = useState(todayYmd());

  const addAnniversary = () => {
    const title = annivTitle.trim();
    if (!title) { addToast('给纪念日起个名字', 'info'); return; }
    const item: CoupleAnniversary = {
      id: genCoupleId('an'), title, date: annivDate, kind: annivKind, repeatYearly: annivRepeat, createdAt: Date.now(),
    };
    mutate(cs => ({ ...cs, anniversaries: [...cs.anniversaries, item] }), 0);
    setAnnivTitle(''); setAnnivDate(todayYmd()); setAnnivKind('custom'); setAnnivRepeat(true);
    setShowAnnivForm(false);
  };
  const deleteAnniversary = (id: string) => mutate(cs => ({ ...cs, anniversaries: cs.anniversaries.filter(a => a.id !== id) }), 0);
  const setAnniversaryDate = () => { mutate(cs => ({ ...cs, anniversaryDate: annivDateDraft }), 0); setShowAnnivDateSet(false); };
  const openDateSet = () => { setAnnivDateDraft(space.anniversaryDate || todayYmd()); setShowAnnivDateSet(true); };

  // ── 相册 ──
  const albumFileRef = useRef<HTMLInputElement>(null);
  const pickAlbumPhotos = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    try {
      const picked = await Promise.all(files.map(f => processImage(f, { maxWidth: 1080, quality: 0.82, forceJpeg: true })));
      const photos: CouplePhoto[] = picked.map(url => ({ id: genCoupleId('ph'), url, addedBy: 'user' as const, at: Date.now() }));
      mutate(cs => ({ ...cs, photos: [...photos, ...cs.photos] }), 1);
    } catch (err: any) { addToast(err?.message || '图片处理失败', 'error'); }
  };
  const deletePhoto = (id: string) => { mutate(cs => ({ ...cs, photos: cs.photos.filter(p => p.id !== id) }), 0); setPhotoView(null); };
  const setPhotoCaption = (id: string, caption: string) => mutate(cs => ({ ...cs, photos: cs.photos.map(p => p.id === id ? { ...p, caption } : p) }), 0);

  // ── 约定 / 任务 ──
  const [taskInput, setTaskInput] = useState('');
  const addTask = (title: string) => {
    const t = title.trim(); if (!t) return;
    const item: CoupleTask = { id: genCoupleId('tk'), title: t, done: false, by: 'user', createdAt: Date.now() };
    mutate(cs => ({ ...cs, tasks: [...cs.tasks, item] }), 0);
    setTaskInput('');
  };
  const toggleTask = (id: string) => {
    let becameDone = false;
    // 切换完成态 + 完成时加亲密度，合并成一次写入（避免两次同步写互相覆盖）
    mutate(cs => {
      const tasks = cs.tasks.map(t => {
        if (t.id !== id) return t;
        const done = !t.done; if (done) becameDone = true;
        return { ...t, done, doneAt: done ? Date.now() : undefined };
      });
      return { ...cs, tasks, intimacy: Math.max(0, Math.round((cs.intimacy || 0) + (becameDone ? 5 : 0))) };
    });
    if (becameDone) addToast('约定达成 +5 亲密度 💗', 'success');
  };
  const deleteTask = (id: string) => mutate(cs => ({ ...cs, tasks: cs.tasks.filter(t => t.id !== id) }), 0);

  // ── 愿望清单 ──
  const [wishInput, setWishInput] = useState('');
  const addWish = (text: string) => {
    const t = text.trim(); if (!t) return;
    const item: CoupleWish = { id: genCoupleId('ws'), text: t, fulfilled: false, by: 'user', createdAt: Date.now() };
    mutate(cs => ({ ...cs, wishes: [...(cs.wishes || []), item] }), 0);
    setWishInput('');
  };
  const toggleWish = (id: string) => {
    let becameDone = false;
    mutate(cs => {
      const wishes = (cs.wishes || []).map(w => {
        if (w.id !== id) return w;
        const fulfilled = !w.fulfilled; if (fulfilled) becameDone = true;
        return { ...w, fulfilled, fulfilledAt: fulfilled ? Date.now() : undefined };
      });
      return { ...cs, wishes, intimacy: Math.max(0, Math.round((cs.intimacy || 0) + (becameDone ? 8 : 0))) };
    });
    if (becameDone) addToast('心愿达成 +8 亲密度 🌟', 'success');
  };
  const deleteWish = (id: string) => mutate(cs => ({ ...cs, wishes: (cs.wishes || []).filter(w => w.id !== id) }), 0);

  // ── 养盆栽 ──
  const carePlant = (kind: 'water' | 'fertilize' | 'sun') => {
    const today = todayYmd();
    if (space.plant?.[kind] === today) { addToast('今天已经照料过啦，明天再来 🌱', 'info'); return; }
    const { label, gain } = PLANT_CARE[kind];
    mutate(cs => {
      const plant: CouplePlant = cs.plant || { growth: 0, createdAt: Date.now() };
      return { ...cs, plant: { ...plant, [kind]: today, growth: (plant.growth || 0) + gain } };
    }, 1);
    addToast(`${label} +${gain} 成长 🌱`, 'success');
  };

  // ── 情侣小游戏：默契大考验 ──
  const [showGame, setShowGame] = useState(false);
  const [gamePhase, setGamePhase] = useState<'intro' | 'playing' | 'reveal'>('intro');
  const [gameQs, setGameQs] = useState<CompatQuestion[]>([]);
  const [gameUserAns, setGameUserAns] = useState<('a' | 'b')[]>([]);
  const [gameCharAns, setGameCharAns] = useState<('a' | 'b')[]>([]);
  const [gameIdx, setGameIdx] = useState(0);
  const [gameBusy, setGameBusy] = useState(false);
  const openGame = () => { setGamePhase('intro'); setShowGame(true); };
  const startGame = () => {
    setGameQs(pickCompatQuestions(5));
    setGameUserAns([]); setGameCharAns([]); setGameIdx(0);
    setGamePhase('playing');
  };
  const pickGameAnswer = async (choice: 'a' | 'b') => {
    if (!partner || gameBusy) return;
    const next = [...gameUserAns, choice];
    setGameUserAns(next);
    if (next.length < gameQs.length) { setGameIdx(i => i + 1); return; }
    // 答完 → 角色以人设作答，比对算默契
    setGameBusy(true);
    let charAns: ('a' | 'b')[] | null = null;
    try { charAns = await generateCharCompatAnswers({ char: partner, userName, api: coupleApi, questions: gameQs }); } catch { /* ignore */ }
    if (!charAns) charAns = gameQs.map(() => (Math.random() < 0.5 ? 'a' : 'b'));
    setGameCharAns(charAns);
    const matches = next.reduce((acc, a, i) => acc + (a === charAns![i] ? 1 : 0), 0);
    const pct = Math.round((matches / gameQs.length) * 100);
    mutate(cs => ({ ...cs, compatBest: Math.max(cs.compatBest || 0, pct) }), matches * 2);
    setGameBusy(false);
    setGamePhase('reveal');
  };

  // ── 悄悄话 ──
  const [whisperInput, setWhisperInput] = useState('');
  const [whisperBusy, setWhisperBusy] = useState(false);
  const unreadWhisperCount = useMemo(() => space.whispers.filter(w => w.author === 'char' && !w.readAt).length, [space.whispers]);
  const sendWhisper = async () => {
    if (!partner) return;
    const text = whisperInput.trim();
    if (!text) return;
    mutate(cs => ({ ...cs, whispers: [...cs.whispers, { id: genCoupleId('wh'), author: 'user', text, at: Date.now() }] }), 2);
    setWhisperInput('');
    setWhisperBusy(true);
    let reply = '';
    try { reply = await generateCharWhisperReply({ char: partner, userName, api: coupleApi, whisper: text }); } catch { /* ignore */ }
    if (reply) {
      mutate(cs => ({ ...cs, whispers: [...cs.whispers, { id: genCoupleId('wh'), author: 'char', text: reply, at: Date.now() }] }), 1);
    }
    setWhisperBusy(false);
  };
  const toggleWhisperPinned = (id: string) => mutate(cs => ({
    ...cs,
    whispers: cs.whispers.map(w => w.id === id ? { ...w, pinned: !w.pinned } : w),
  }), 0);
  const deleteWhisper = (id: string) => mutate(cs => ({ ...cs, whispers: cs.whispers.filter(w => w.id !== id) }), 0);

  useEffect(() => {
    if (!showWhispers || unreadWhisperCount <= 0) return;
    const timer = setTimeout(() => {
      mutate(cs => ({
        ...cs,
        whispers: cs.whispers.map(w => w.author === 'char' && !w.readAt ? { ...w, readAt: Date.now() } : w),
      }), 0);
    }, 700);
    return () => clearTimeout(timer);
  }, [showWhispers, unreadWhisperCount, mutate]);

  // ── 提问箱 ──
  const [showQuestions, setShowQuestions] = useState(false);
  const [questionInput, setQuestionInput] = useState('');
  const [questionBusyCount, setQuestionBusyCount] = useState(0);
  const questionBusy = questionBusyCount > 0;
  const askQuestion = async (q?: string) => {
    if (!partner) return;
    const question = (q ?? questionInput).trim();
    if (!question) return;
    const id = genCoupleId('qa');
    const now = Date.now();
    const item: CoupleQuestion = {
      id,
      question,
      answer: '',
      at: now,
      status: 'pending',
      visibility: 'anonymous',
      source: 'questionBox',
    };
    mutate(cs => ({ ...cs, questions: [...(cs.questions || []), item] }), 0);
    setQuestionInput('');
    setExpandedQuestions(prev => ({ ...prev, [id]: false }));
    setQuestionBusyCount(n => n + 1);
    let answer = '';
    try { answer = await generateCharQuestionAnswer({ char: partner, userName, api: coupleApi, question }); } catch { /* ignore */ }
    if (!answer) answer = fallbackQuestionAnswer();
    mutate(cs => applyCoupleQuestionAnswer(cs, id, answer), 3);
    setExpandedQuestions(prev => ({ ...prev, [id]: true }));
    setQuestionBusyCount(n => Math.max(0, n - 1));
  };
  const toggleQuestionPinned = (id: string) => mutate(cs => ({
    ...cs,
    questions: (cs.questions || []).map(q => q.id === id ? { ...q, pinned: !q.pinned } : q),
  }), 0);
  const deleteQuestion = (id: string) => mutate(cs => ({ ...cs, questions: (cs.questions || []).filter(q => q.id !== id) }), 0);

  useEffect(() => {
    if (!partner) return;
    const p = ensureCoupleSpace(partner).profile;
    setProfileDraft({
      homeName: p?.homeName || '',
      userNickname: p?.userNickname || '',
      charNickname: p?.charNickname || '',
      loveLanguage: p?.loveLanguage || '',
      rituals: (p?.rituals || []).join('\n'),
    });
  }, [partnerId]);

  const saveProfile = () => {
    const rituals = profileDraft.rituals.split('\n').map(x => x.trim()).filter(Boolean).slice(0, 8);
    mutate(cs => ({
      ...cs,
      profile: {
        homeName: profileDraft.homeName.trim() || undefined,
        userNickname: profileDraft.userNickname.trim() || undefined,
        charNickname: profileDraft.charNickname.trim() || undefined,
        loveLanguage: profileDraft.loveLanguage.trim() || undefined,
        rituals,
        updatedAt: Date.now(),
      },
    }), 0);
    addToast('情侣档案已保存', 'success');
  };

  const doDailyCheckin = () => {
    const today = todayYmd();
    const note = checkinNote.trim();
    if (!checkinMood && !note) { addToast('选个心情，或写一句今天的状态', 'info'); return; }
    mutate(cs => {
      const rest = (cs.dailyCheckins || []).filter(c => c.ymd !== today);
      return {
        ...cs,
        dailyCheckins: [
          { id: genCoupleId('ck'), ymd: today, userMood: checkinMood || undefined, note: note || undefined, createdAt: Date.now() },
          ...rest,
        ],
      };
    }, 1);
    setCheckinMood(''); setCheckinNote('');
    addToast('今日情侣打卡 +1 亲密度', 'success');
  };

  const runManualRecap = async () => {
    if (!partner || recapBusy) return;
    setRecapBusy(true);
    try {
      const draft = await generateCoupleRecap({ char: partner, userName, api: coupleApi, space, period: 'week' });
      const applied = applyCoupleAutoCareDraft(space, draft, { source: 'manual', text: '用户手动生成情侣空间回顾', at: Date.now() }, Date.now());
      if (applied.applied === 'recap') {
        mutate(() => applied.space, 0);
        addToast('已生成一份关系回顾', 'success');
      } else {
        addToast('素材还太少，先多记录一点再回顾吧', 'info');
      }
    } catch {
      addToast('回顾生成失败，稍后再试', 'error');
    } finally {
      setRecapBusy(false);
    }
  };

  const openEyes = (era?: CoupleEyesEra) => {
    setEyesEra(era || null);
    setShowEyes(true);
  };

  const runEyesGenerate = async (era: CoupleEyesEra) => {
    if (!partner || eyesBusy) return;
    setEyesBusy(era);
    try {
      const fresh = charactersRef.current.find(c => c.id === partner.id) || partner;
      const freshSpace = ensureCoupleSpace(fresh);
      const card = await generateCoupleEyesCard({ char: fresh, userName, api: coupleApi, space: freshSpace, era });
      if (card) {
        mutate(cs => upsertCoupleEyesCard(cs, card), 1);
        setEyesEra(era);
        addToast('已写好一张「TA 眼中的我」', 'success');
      } else {
        addToast('这会儿没写出来，稍后再试试', 'info');
      }
    } catch {
      addToast('生成失败，稍后再试', 'error');
    } finally {
      setEyesBusy(null);
    }
  };

  const toggleAutoCare = () => {
    mutate(cs => ({
      ...cs,
      settings: { ...(cs.settings || {}), theme: 'clean', autoCareEnabled: cs.settings?.autoCareEnabled === false ? true : false },
    }), 0);
  };

  const openDateFromCouple = () => {
    if (!partner) return;
    try { localStorage.setItem('moro_date_intent_v1', JSON.stringify({ charId: partner.id, from: 'couple', at: Date.now() })); } catch { /* ignore */ }
    setActiveCharacterId(partner.id);
    openApp(AppID.LifeSim);
  };

  // ── 渲染：空间目录 / 多空间入口 ──
  if (showDirectory || !partner) {
    const romantic = (c: CharacterProfile) => ['crush', 'lover', 'engaged', 'married'].includes(c.relationship?.stage || '');
    const sorted = [...directoryCharacters].sort((a, b) => Number(!!b.coupleSpace) - Number(!!a.coupleSpace) || (romantic(b) ? 1 : 0) - (romantic(a) ? 1 : 0));
    const opened = sorted.filter(c => !!c.coupleSpace).length;
    return (
      <div className="h-full w-full overflow-y-auto" style={{ background: BG, fontFamily: FONT_STACK, color: INK }}>
        <div className="max-w-[480px] mx-auto px-4 py-5 space-y-4">
          <SoftCard emphasis="ink" className="p-5">
            <div className="flex items-center gap-3">
              <SoftBadge size={48}><Heart size={24} weight="fill" /></SoftBadge>
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-black leading-tight">情侣空间</h2>
                <p className="text-[12px] leading-relaxed mt-1" style={{ color: INK_SOFT }}>
                  已开 {opened} 个空间。每位角色保留自己的回忆，可随时切换。
                </p>
              </div>
            </div>
          </SoftCard>
          <div className="space-y-3 pb-10">
            {sorted.length === 0 && (
              <SoftCard className="p-5 text-center text-xs" style={{ color: INK_SOFT }}>还没有角色，先去「名册」认识一个人吧</SoftCard>
            )}
            {sorted.map(c => {
              const isRomantic = romantic(c);
              const cs = c.coupleSpace ? ensureCoupleSpace(c) : null;
              const cDays = loveDays(cs?.anniversaryDate);
              const avatar = c.convoSettings?.charAvatarOverride || c.avatar;
              return (
                <SoftCard key={c.id} onClick={() => bindPartner(c.id)} className="p-3" emphasis={cs ? 'ink' : null}>
                  <div className="flex items-center gap-3">
                  <AvatarThumb src={avatar} caption={cs ? 'OPEN' : 'NEW'} size={48} />
                  <div className="flex-1 min-w-0 text-left">
                    <div className="font-black truncate text-sm" style={{ color: INK }}>{cs?.profile?.homeName || c.convoSettings?.remarkName?.trim() || c.name}</div>
                    {c.relationship?.label && (
                      <div className="text-[11px] mt-0.5 font-semibold" style={{ color: isRomantic ? INK : INK_SOFT }}>
                        {isRomantic ? '♥ ' : ''}{c.relationship.label}
                      </div>
                    )}
                    <div className="text-[10.5px] mt-1" style={{ color: INK_SOFT }}>
                      {cs ? `${cDays > 0 ? `在一起 ${cDays} 天 · ` : ''}${cs.moments.length} 动态 · ${cs.memoryCards?.length || 0} 记忆卡` : '还没开空间，点一下创建'}
                    </div>
                  </div>
                  <span className="text-[11px] px-3 py-1.5 rounded-full font-black shrink-0" style={{ background: cs ? ACCENT : '#fff', color: cs ? '#fff' : INK, border: cs ? 'none' : `1px solid ${LINE}` }}>{cs ? '进入' : '开空间'}</span>
                  </div>
                </SoftCard>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ── 渲染：已绑定主页面 ──
  const days = loveDays(space.anniversaryDate);
  const lv = intimacyLevel(space.intimacy);
  const prog = intimacyProgress(space.intimacy);
  const sortedMoments = [...space.moments].sort((a, b) => b.createdAt - a.createdAt);
  const sortedAnnivs = [...space.anniversaries]
    .map(a => ({ a, occ: nextOccurrence(a.date, a.repeatYearly) }))
    .sort((x, y) => (x.occ?.daysLeft ?? 9e9) - (y.occ?.daysLeft ?? 9e9));
  const pendingTasks = space.tasks.filter(t => !t.done);
  const doneTasks = space.tasks.filter(t => t.done);
  const wishes = space.wishes || [];
  const pendingWishes = wishes.filter(w => !w.fulfilled);
  const doneWishes = wishes.filter(w => w.fulfilled);
  const today = todayYmd();
  const todayCheckin = (space.dailyCheckins || []).find(c => c.ymd === today);
  const memoryCards = space.memoryCards || [];
  const recaps = space.recaps || [];
  const eyesCards = space.eyesCards || [];
  const autoCareOn = space.settings?.autoCareEnabled !== false;

  // 纪念日提醒：7 天内最近的一个（恋爱纪念日周年 + 各纪念日条目），点击跳到纪念日 tab
  const annivReminder = (() => {
    const cands: { label: string; daysLeft: number }[] = [];
    if (space.anniversaryDate) {
      const occ = nextOccurrence(space.anniversaryDate, true);
      if (occ) cands.push({ label: '恋爱纪念日', daysLeft: occ.daysLeft });
    }
    (space.anniversaries || []).forEach(a => {
      const occ = nextOccurrence(a.date, a.repeatYearly);
      if (occ) cands.push({ label: a.title, daysLeft: occ.daysLeft });
    });
    return cands.filter(c => c.daysLeft >= 0 && c.daysLeft <= 7).sort((x, y) => x.daysLeft - y.daysLeft)[0] || null;
  })();

  return (
    <div className="h-full w-full max-w-[480px] mx-auto flex flex-col relative overflow-hidden" style={{ background: BG, fontFamily: FONT_STACK }}>
      <style>{`
        @keyframes csFloat { 0% { transform: translateY(0) scale(.6); opacity: 0; } 20% { opacity: 1; } 100% { transform: translateY(-160px) scale(1.3) rotate(12deg); opacity: 0; } }
        @keyframes csPop { 0% { transform: scale(.8); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
        @keyframes csEcg { from { stroke-dashoffset: 100; } to { stroke-dashoffset: 0; } }
        @keyframes csEq { 0%,100% { transform: scaleY(.28); } 50% { transform: scaleY(1); } }
        @keyframes csVoiceCard { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
      `}</style>

      {/* 漂浮互动动画 */}
      {burst && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-end justify-center" style={{ paddingBottom: '38%' }}>
          {Array.from({ length: 9 }).map((_, i) => (
            <span key={i} className="absolute select-none" style={{
              left: `${30 + (i * 5)}%`, fontSize: `${20 + (i % 3) * 10}px`,
              animation: `csFloat ${1 + (i % 4) * 0.18}s ease-out ${(i % 5) * 0.05}s forwards`,
            }}>{burst.emoji}</span>
          ))}
        </div>
      )}

      {/* ── 顶部羁绊区：菜单 + 双头像心跳连线 + 在一起天数 + 亲密度 ── */}
      <div className="shrink-0 px-5 pt-4 pb-3 bg-white border-b border-[#f2f2f2] relative">
        <button onClick={() => setShowDirectory(true)} className="absolute top-2.5 left-3 p-1 text-[#777] active:scale-90 transition z-10" title="返回空间目录">
          <ArrowLeft size={20} weight="bold" />
        </button>
        <button onClick={() => setShowSettings(true)} className="absolute top-2.5 right-3 p-1 text-[#999] active:scale-90 transition z-10" title="菜单">
          <List size={20} weight="bold" />
        </button>

        <div className="flex items-center justify-center gap-2">
          <div className="flex flex-col items-center gap-1 w-[64px]">
            <img src={userAvatar} className="w-[50px] h-[50px] rounded-full object-cover" style={{ boxShadow: AVATAR_GLOW, border: '2px solid #fff' }} />
            <span className="text-[10px] text-[#999] truncate max-w-full">{userName}</span>
          </div>
          <div className="flex-1 max-w-[150px] h-[50px] flex items-center px-1">
            <HeartbeatLine />
          </div>
          <div className="flex flex-col items-center gap-1 w-[64px]">
            <img src={partnerAvatar} className="w-[50px] h-[50px] rounded-full object-cover" style={{ boxShadow: AVATAR_GLOW, border: '2px solid #fff' }} />
            <span className="text-[10px] text-[#999] truncate max-w-full">{partnerName}</span>
          </div>
        </div>

        {/* 在一起 X 天 */}
        <div className="text-center mt-2">
          {space.anniversaryDate ? (
            days > 0 ? (
              <button onClick={openDateSet} className="active:scale-95 transition text-[12px] tracking-wide" style={{ color: ACCENT_TEXT }}>
                在一起 <span className="font-bold" style={{ color: INK }}>{days}</span> 天
              </button>
            ) : (
              <span className="text-[12px]" style={{ color: INK_SOFT }}>纪念日 {space.anniversaryDate}，就要在一起啦</span>
            )
          ) : (
            <button onClick={() => { setAnnivDateDraft(todayYmd()); setShowAnnivDateSet(true); }}
              className="text-[12px] font-bold px-3 py-1 rounded-full active:scale-95 transition" style={{ background: ACCENT_SOFT, color: INK }}>
              ＋ 设定在一起纪念日
            </button>
          )}
        </div>

        {/* 亲密度（纤细一行） */}
        <div className="mt-3 flex items-center gap-2">
          <span className="text-[11px] font-bold flex items-center gap-1 shrink-0" style={{ color: INK }}>
            <Sparkle size={12} weight="fill" /> Lv.{lv} {intimacyTitle(space.intimacy)}
          </span>
          <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: '#ECEEF4' }}>
            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(4, prog * 100)}%`, background: ACCENT }} />
          </div>
          <span className="text-[10px] shrink-0" style={{ color: '#bbb' }}>{Math.round(space.intimacy)}</span>
        </div>
      </div>

      {/* 纪念日提醒（7 天内） */}
      {annivReminder && (
        <button onClick={() => setTab('anniversary')}
          className="shrink-0 mx-4 mt-2 px-3.5 py-2 rounded-2xl flex items-center gap-2 text-left active:scale-[0.98] transition border"
          style={{ background: ACCENT_SOFT, borderColor: ACCENT_BORDER }}>
          <span className="text-base shrink-0">💝</span>
          <span className="flex-1 min-w-0 text-[12px] font-bold leading-snug" style={{ color: ACCENT_TEXT }}>
            {annivReminder.daysLeft === 0
              ? `今天是「${annivReminder.label}」，别忘了好好庆祝呀！`
              : `距离「${annivReminder.label}」还有 ${annivReminder.daysLeft} 天，记得准备惊喜哦～`}
          </span>
          <span className="text-[10px] shrink-0" style={{ color: ACCENT_MUTED }}>查看 ›</span>
        </button>
      )}

      {/* 子标签 */}
      <div className="shrink-0 px-4 pt-2">
        <div className="flex rounded-full p-1 text-[12px] font-bold overflow-x-auto no-scrollbar" style={{ background: '#EEF1F6' }}>
          {([['today', '今日'], ['moments', '动态'], ['album', '相册'], ['tasks', '约定'], ['anniversary', '纪念'], ['profile', '档案'], ['recap', '回顾'], ['game', '游戏']] as [Tab, string][]).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className="shrink-0 px-3 py-1.5 rounded-full transition"
              style={tab === k ? { background: ACCENT, color: '#fff', boxShadow: '0 2px 8px rgba(233,120,145,0.24)' } : { color: INK_SOFT }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* 内容区 */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3">
        {tab === 'today' && (
          <>
            <div className="grid grid-cols-3 gap-2.5">
              <SoftCard className="p-3 text-center"><div className="text-lg font-black">{days || '—'}</div><div className="text-[10px]" style={{ color: INK_SOFT }}>相恋天数</div></SoftCard>
              <SoftCard className="p-3 text-center"><div className="text-lg font-black">Lv.{lv}</div><div className="text-[10px]" style={{ color: INK_SOFT }}>{intimacyTitle(space.intimacy)}</div></SoftCard>
              <SoftCard className="p-3 text-center"><div className="text-lg font-black">{memoryCards.length}</div><div className="text-[10px]" style={{ color: INK_SOFT }}>记忆卡</div></SoftCard>
            </div>
            <SoftCard onClick={() => openEyes()} emphasis="ink" className="p-4 active:scale-[0.99] transition">
              <div className="flex items-center gap-3">
                <SoftBadge size={40}>眼</SoftBadge>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-black">TA 眼中的我</div>
                  <div className="text-[11px] leading-relaxed" style={{ color: INK_SOFT }}>
                    已生成 {eyesCards.length} / 3 张 · 过去、现在、将来
                  </div>
                </div>
                <span className="text-[11px] font-black" style={{ color: INK_SOFT }}>进入 ›</span>
              </div>
            </SoftCard>
            <SoftCard emphasis="ink" className="p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-black">今日情侣打卡</div>
                  <div className="text-[11px]" style={{ color: INK_SOFT }}>{todayCheckin ? `今天已打卡：${todayCheckin.userMood || ''} ${todayCheckin.note || ''}` : '留下一点今天的心情'}</div>
                </div>
                <SoftBadge size={38}>{todayCheckin ? '✓' : '今'}</SoftBadge>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {MOOD_EMOJIS.slice(0, 8).map(em => (
                  <button key={em} onClick={() => setCheckinMood(checkinMood === em ? '' : em)} className="w-8 h-8 rounded-full text-lg" style={{ background: checkinMood === em ? ACCENT : '#fff', color: checkinMood === em ? '#fff' : INK, border: `1px solid ${checkinMood === em ? 'transparent' : LINE}` }}>{em}</button>
                ))}
              </div>
              <div className="flex gap-2">
                <input value={checkinNote} onChange={e => setCheckinNote(e.target.value)} placeholder="今天想记一句…" className="flex-1 px-3 py-2 rounded-xl text-[13px] outline-none border" style={{ background: '#fff', borderColor: LINE }} />
                <SoftButton onClick={doDailyCheckin} className="px-4 py-2">打卡</SoftButton>
              </div>
            </SoftCard>
            <div className="grid grid-cols-4 gap-2">
              {INTERACTIONS.map(it => (
                <button key={it.kind} onClick={() => doInteraction(it.kind)}
                  className="bg-white rounded-2xl py-2 flex flex-col items-center gap-0.5 active:scale-95 transition border border-[#e8ecf3]">
                  <span className="text-xl leading-none">{it.emoji}</span>
                  <span className="text-[10px] font-bold" style={{ color: INK }}>{it.label}</span>
                </button>
              ))}
            </div>
            {charReaction && (
              <SoftCard className="p-3">
                <div className="flex items-center gap-2">
                  <img src={partnerAvatar} className="w-7 h-7 rounded-full object-cover shrink-0" />
                  <div className="flex-1 min-w-0 text-[12px] leading-snug" style={{ color: '#555' }}>
                    {charReaction.loading ? <span>{partnerName} 正在回应… {charReaction.text}</span> : <span>{charReaction.text}</span>}
                  </div>
                  <span className="text-base shrink-0">{charReaction.emoji}</span>
                </div>
              </SoftCard>
            )}
            <SoftCard className="p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-black">后台自经营</div>
                  <div className="text-[11px] leading-relaxed" style={{ color: INK_SOFT }}>
                    {autoCareOn ? `开启中${space.autoCare?.lastSummary ? ` · 上次：${space.autoCare.lastSummary}` : ''}` : '已关闭，TA 不会自动打理这个空间'}
                  </div>
                </div>
                <SoftButton variant={autoCareOn ? 'ink' : 'paper'} onClick={toggleAutoCare} className="px-3 py-2">{autoCareOn ? '开' : '关'}</SoftButton>
              </div>
            </SoftCard>
            <div className="grid grid-cols-2 gap-2">
              <SoftButton onClick={openDateFromCouple} className="py-2.5" icon={<Heart size={15} weight="fill" />}>去约会</SoftButton>
              <SoftButton variant="paper" onClick={() => setTab('recap')} className="py-2.5" icon={<Quotes size={15} weight="fill" />}>翻回顾</SoftButton>
            </div>
            {(pendingTasks.length > 0 || pendingWishes.length > 0) && (
              <SoftCard className="p-4 space-y-2">
                <div className="text-sm font-black">待完成的事</div>
                {[...pendingTasks.slice(0, 2).map(t => `约定：${t.title}`), ...pendingWishes.slice(0, 2).map(w => `心愿：${w.text}`)].map(x => (
                  <div key={x} className="text-[12px]" style={{ color: INK_SOFT }}>- {x}</div>
                ))}
              </SoftCard>
            )}
          </>
        )}

        {tab === 'moments' && (
          <>
            <div className="flex gap-2">
              <button onClick={() => setShowCompose(true)} className={`flex-1 py-2.5 text-white text-[13px] ${romanticBtn}`} style={{ background: ACCENT }}>
                <span className="inline-flex items-center gap-1.5"><Plus size={15} weight="bold" /> 发布动态</span>
              </button>
              <button onClick={requestCharMoment} disabled={charMomentBusy} className={`px-4 py-2.5 bg-white text-[13px] border ${romanticBtn}`} style={{ borderColor: ACCENT_BORDER, color: ACCENT_TEXT }}>
                <span className="inline-flex items-center gap-1.5">
                  {charMomentBusy ? <ArrowsClockwise size={15} className="animate-spin" /> : <ChatCircleDots size={15} weight="fill" />}
                  请 TA 冒个泡
                </span>
              </button>
            </div>
            {sortedMoments.length === 0 && (
              <div className="text-center text-[#bbb] text-xs py-10">还没有动态，发布第一条留言吧 💌</div>
            )}
            {sortedMoments.map(m => (
              <MomentCard key={m.id} m={m} userName={userName} userAvatar={userAvatar} partnerName={partnerName} partnerAvatar={partnerAvatar}
                engaging={engagingId === m.id} onToggleLike={() => toggleLike(m.id)} onComment={(t) => addUserComment(m.id, t)}
                onDelete={() => deleteMoment(m.id)} onInnerVoice={() => openInnerVoice(m)} />
            ))}
          </>
        )}

        {tab === 'anniversary' && (
          <>
            <button onClick={() => setShowAnnivForm(true)} className={`w-full py-2.5 text-white text-[13px] ${romanticBtn}`} style={{ background: ACCENT }}>
              <span className="inline-flex items-center gap-1.5"><Plus size={15} weight="bold" /> 添加纪念日</span>
            </button>
            {space.anniversaryDate && days > 0 && (
              <div className="rounded-2xl p-3.5 text-white shadow-[0_6px_18px_rgba(233,120,145,0.22)]" style={{ background: ACCENT }}>
                <div className="text-[11px] opacity-95 font-medium">💞 在一起</div>
                <div className="text-lg font-black mt-0.5">已相恋 {days} 天</div>
                <div className="text-[11px] opacity-95 mt-0.5">自 {space.anniversaryDate} 起</div>
              </div>
            )}
            {sortedAnnivs.length === 0 && !space.anniversaryDate && (
              <div className="text-center text-[#bbb] text-xs py-8">添加生日、约定日，自动倒计时提醒 ⏳</div>
            )}
            {sortedAnnivs.map(({ a, occ }) => {
              const d = occ?.daysLeft ?? null;
              return (
                <div key={a.id} className="bg-white rounded-2xl p-3.5 flex items-center gap-3 shadow-[0_2px_14px_rgba(0,0,0,0.04)] border border-[#f2f2f2]">
                  <span className="text-2xl shrink-0">{KIND_EMOJI[a.kind]}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-[#333] text-sm truncate">{a.title}</div>
                    <div className="text-[11px] text-[#999] mt-0.5">{KIND_LABEL[a.kind]} · {a.date}{a.repeatYearly ? ' · 每年' : ''}</div>
                  </div>
                  <div className="text-right shrink-0">
                    {d === null ? null : d === 0 ? (
                      <span className="font-black text-sm" style={{ color: ACCENT_TEXT }}>就是今天 🎉</span>
                    ) : d > 0 ? (
                      <div><span className="font-black text-lg leading-none" style={{ color: ACCENT_TEXT }}>{d}</span><div className="text-[10px] text-[#999]">天后</div></div>
                    ) : (
                      <span className="text-[#ccc] text-[11px]">已过 {-d} 天</span>
                    )}
                  </div>
                  <button onClick={() => deleteAnniversary(a.id)} className="text-[#ccc] hover:text-slate-500 active:scale-90 transition shrink-0"><Trash size={16} /></button>
                </div>
              );
            })}
          </>
        )}

        {tab === 'album' && (
          <>
            <input ref={albumFileRef} type="file" accept="image/*" multiple className="hidden" onChange={pickAlbumPhotos} />
            <button onClick={() => albumFileRef.current?.click()} className={`w-full py-2.5 text-white text-[13px] ${romanticBtn}`} style={{ background: ACCENT }}>
              <span className="inline-flex items-center gap-1.5"><Camera size={15} weight="fill" /> 添加照片</span>
            </button>
            {space.photos.length === 0 ? (
              <div className="text-center text-[#bbb] text-xs py-10">还没有合照，添加你们的第一张照片 📷</div>
            ) : (
              <div className="grid grid-cols-3 gap-1.5">
                {space.photos.map(p => (
                  <button key={p.id} onClick={() => setPhotoView(p)} className="aspect-square rounded-xl overflow-hidden bg-[#f4f4f4] active:scale-95 transition border border-[#f0f0f0]">
                    <img src={p.url} className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {tab === 'tasks' && (
          <>
            <div className="flex gap-2">
              <input value={taskInput} onChange={e => setTaskInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addTask(taskInput); }}
                placeholder="添加一个小约定…" className="flex-1 px-4 py-2.5 bg-white rounded-full text-[13px] outline-none border border-[#eee]" style={{ borderColor: LINE }} />
              <button onClick={() => addTask(taskInput)} className={`px-5 text-white text-[13px] ${romanticBtn}`} style={{ background: ACCENT }}>添加</button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {TASK_SUGGESTIONS.map(s => (
                <button key={s} onClick={() => addTask(s)} className="text-[11px] px-3 py-1.5 rounded-full bg-white border border-[#f0f0f0] active:scale-95 transition" style={{ color: ACCENT_TEXT }}>+ {s}</button>
              ))}
            </div>
            {pendingTasks.map(t => (
              <div key={t.id} className="bg-white rounded-2xl p-3 flex items-center gap-3 shadow-[0_2px_12px_rgba(0,0,0,0.04)] border border-[#f2f2f2]">
                <button onClick={() => toggleTask(t.id)} className="active:scale-90 transition shrink-0" style={{ color: ACCENT_MUTED }}><Circle size={22} /></button>
                <span className="flex-1 text-sm text-[#333]">{t.title}</span>
                <button onClick={() => deleteTask(t.id)} className="text-[#ccc] hover:text-slate-500 active:scale-90 transition shrink-0"><Trash size={15} /></button>
              </div>
            ))}
            {doneTasks.length > 0 && (
              <div className="text-[11px] font-bold pt-1 pl-1" style={{ color: ACCENT_TEXT }}>已完成 {doneTasks.length}</div>
            )}
            {doneTasks.map(t => (
              <div key={t.id} className="bg-white/70 rounded-2xl p-3 flex items-center gap-3 border border-[#f4f4f4]">
                <button onClick={() => toggleTask(t.id)} className="active:scale-90 transition shrink-0" style={{ color: ACCENT_TEXT }}><CheckCircle size={22} weight="fill" /></button>
                <span className="flex-1 text-sm text-[#bbb] line-through">{t.title}</span>
                <button onClick={() => deleteTask(t.id)} className="text-[#ccc] hover:text-slate-500 active:scale-90 transition shrink-0"><Trash size={15} /></button>
              </div>
            ))}
            {space.tasks.length === 0 && (
              <div className="text-center text-[#bbb] text-xs py-8">立个小约定，一起去完成吧 ✅</div>
            )}
          </>
        )}

        {tab === 'tasks' && (
          <>
            <div className="text-[11px] font-black pt-2 pl-1" style={{ color: INK_SOFT }}>心愿清单</div>
            <div className="flex gap-2">
              <input value={wishInput} onChange={e => setWishInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addWish(wishInput); }}
                placeholder="许个一起实现的心愿…" className="flex-1 px-4 py-2.5 bg-white rounded-full text-[13px] outline-none border border-[#eee]" style={{ borderColor: LINE }} />
              <button onClick={() => addWish(wishInput)} className={`px-5 text-white text-[13px] ${romanticBtn}`} style={{ background: ACCENT }}>许愿</button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {WISH_SUGGESTIONS.map(s => (
                <button key={s} onClick={() => addWish(s)} className="text-[11px] px-3 py-1.5 rounded-full bg-white border border-[#f0f0f0] active:scale-95 transition" style={{ color: ACCENT_TEXT }}>+ {s}</button>
              ))}
            </div>
            {pendingWishes.map(w => (
              <div key={w.id} className="bg-white rounded-2xl p-3 flex items-center gap-3 shadow-[0_2px_12px_rgba(0,0,0,0.04)] border border-[#f2f2f2]">
                <button onClick={() => toggleWish(w.id)} className="active:scale-90 transition shrink-0" style={{ color: ACCENT_MUTED }}><Circle size={22} /></button>
                <span className="flex-1 text-sm text-[#333]">{w.text}</span>
                <button onClick={() => deleteWish(w.id)} className="text-[#ccc] hover:text-slate-500 active:scale-90 transition shrink-0"><Trash size={15} /></button>
              </div>
            ))}
            {doneWishes.length > 0 && (
              <div className="text-[11px] font-bold pt-1 pl-1" style={{ color: ACCENT_TEXT }}>已实现 {doneWishes.length} 💫</div>
            )}
            {doneWishes.map(w => (
              <div key={w.id} className="bg-white/70 rounded-2xl p-3 flex items-center gap-3 border border-[#f4f4f4]">
                <button onClick={() => toggleWish(w.id)} className="active:scale-90 transition shrink-0" style={{ color: ACCENT_TEXT }}><CheckCircle size={22} weight="fill" /></button>
                <span className="flex-1 text-sm text-[#bbb] line-through">{w.text}</span>
                <button onClick={() => deleteWish(w.id)} className="text-[#ccc] hover:text-slate-500 active:scale-90 transition shrink-0"><Trash size={15} /></button>
              </div>
            ))}
            {wishes.length === 0 && (
              <div className="text-center text-[#bbb] text-xs py-8">许下你们的第一个共同心愿吧 🌟</div>
            )}
          </>
        )}

        {tab === 'profile' && (
          <>
            <SoftCard emphasis="ink" className="p-4 space-y-3">
              <div>
                <div className="text-sm font-black">情侣档案</div>
                <div className="text-[11px]" style={{ color: INK_SOFT }}>这些会进聊天上下文，让 TA 记得你们的小习惯。</div>
              </div>
              <input value={profileDraft.homeName} onChange={e => setProfileDraft(p => ({ ...p, homeName: e.target.value }))} placeholder="空间名（如 雨天备用拥抱处）" className="w-full px-3 py-2 rounded-xl text-[13px] outline-none border" style={{ background: '#fff', borderColor: LINE }} />
              <div className="grid grid-cols-2 gap-2">
                <input value={profileDraft.userNickname} onChange={e => setProfileDraft(p => ({ ...p, userNickname: e.target.value }))} placeholder="TA 叫你的称呼" className="px-3 py-2 rounded-xl text-[13px] outline-none border" style={{ background: '#fff', borderColor: LINE }} />
                <input value={profileDraft.charNickname} onChange={e => setProfileDraft(p => ({ ...p, charNickname: e.target.value }))} placeholder="你叫 TA 的称呼" className="px-3 py-2 rounded-xl text-[13px] outline-none border" style={{ background: '#fff', borderColor: LINE }} />
              </div>
              <input value={profileDraft.loveLanguage} onChange={e => setProfileDraft(p => ({ ...p, loveLanguage: e.target.value }))} placeholder="偏爱的相处方式（如 先抱抱再讲道理）" className="w-full px-3 py-2 rounded-xl text-[13px] outline-none border" style={{ background: '#fff', borderColor: LINE }} />
              <textarea value={profileDraft.rituals} onChange={e => setProfileDraft(p => ({ ...p, rituals: e.target.value }))} placeholder={"固定小仪式，一行一个\n例如：睡前互道晚安\n例如：吵架后先牵手"} rows={4} className="w-full px-3 py-2 rounded-xl text-[13px] outline-none border resize-none" style={{ background: '#fff', borderColor: LINE }} />
              <SoftButton onClick={saveProfile} className="w-full py-2.5">保存档案</SoftButton>
            </SoftCard>
            <SoftCard onClick={() => openEyes()} className="p-4 active:scale-[0.99] transition">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-black">TA 眼中的我</div>
                  <div className="text-[11px] mt-1" style={{ color: INK_SOFT }}>
                    过去 / 现在 / 将来 · {eyesCards.length} 张已生成
                  </div>
                </div>
                <SoftBadge size={38}>眼</SoftBadge>
              </div>
              {eyesCards[0] && <div className="mt-3 text-[12px] leading-relaxed" style={{ color: INK_SOFT }}>{eyesCards[0].summary}</div>}
            </SoftCard>
            <SoftCard className="p-4">
              <div className="text-sm font-black mb-2">最近记忆卡</div>
              {memoryCards.length === 0 ? (
                <div className="text-[12px]" style={{ color: INK_SOFT }}>约会、饭票、回顾都会慢慢收进这里。</div>
              ) : memoryCards.slice(0, 6).map(c => (
                <div key={c.id} className="py-2 border-t first:border-t-0" style={{ borderColor: LINE }}>
                  <div className="text-[12px] font-black">{c.title}</div>
                  <div className="text-[11px] leading-relaxed" style={{ color: INK_SOFT }}>{c.text}</div>
                </div>
              ))}
            </SoftCard>
          </>
        )}

        {tab === 'recap' && (
          <>
            <div className="flex gap-2">
              <SoftButton onClick={runManualRecap} disabled={recapBusy} className="flex-1 py-2.5" icon={recapBusy ? <ArrowsClockwise size={15} className="animate-spin" /> : <Quotes size={15} weight="fill" />}>
                {recapBusy ? '生成中' : '生成周回顾'}
              </SoftButton>
              <SoftButton variant="paper" onClick={() => setTab('profile')} className="px-4 py-2.5">记忆卡</SoftButton>
            </div>
            {recaps.length === 0 ? (
              <SoftCard className="p-5 text-center text-[12px]" style={{ color: INK_SOFT }}>还没有关系回顾。多发几条动态、完成几个约定后再来看看。</SoftCard>
            ) : recaps.map(r => (
              <SoftCard key={r.id} emphasis="ink" className="p-4 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-black">{r.title}</div>
                    <div className="text-[10px]" style={{ color: INK_SOFT }}>{r.periodKey} · {timeAgo(r.createdAt)}</div>
                  </div>
                  <SoftBadge size={36}>报</SoftBadge>
                </div>
                <div className="text-[13px] leading-relaxed">{r.summary}</div>
                {r.highlights.length > 0 && <div className="space-y-1">{r.highlights.map(h => <div key={h} className="text-[11px]" style={{ color: INK_SOFT }}>- {h}</div>)}</div>}
              </SoftCard>
            ))}
          </>
        )}

        {tab === 'game' && (
          <div className="grid grid-cols-2 gap-2">
            <SoftButton onClick={openGame} className="py-2.5" icon={<Sparkle size={15} weight="fill" />}>默契大考验</SoftButton>
            <SoftButton variant="paper" onClick={openDateFromCouple} className="py-2.5" icon={<Heart size={15} weight="fill" />}>去约会</SoftButton>
          </div>
        )}

        {tab === 'game' && (() => {
          const today = todayYmd();
          const growth = space.plant?.growth || 0;
          const ps = plantStage(growth);
          const cares: ('water' | 'fertilize' | 'sun')[] = ['water', 'fertilize', 'sun'];
          return (
            <div className="flex flex-col items-center gap-4 pt-1">
              <div className="w-full rounded-3xl p-6 flex flex-col items-center gap-2 border border-[#f2f2f2]" style={{ background: 'linear-gradient(180deg,#fbf7f0 0%,#f1f1ec 100%)' }}>
                <div className="text-6xl leading-none">{ps.stage.emoji}</div>
                <div className="text-sm font-black text-[#444]">{ps.stage.name}</div>
                {ps.next ? (
                  <div className="w-full max-w-[14rem] mt-1">
                    <div className="h-2 rounded-full bg-[#ececec] overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${Math.round(ps.progress * 100)}%`, background: ACCENT }} />
                    </div>
                    <div className="text-[10px] text-[#aaa] text-center mt-1">再 {ps.toNext} 成长值 → {ps.next.name} {ps.next.emoji}</div>
                  </div>
                ) : (
                  <div className="text-[11px] font-bold mt-1" style={{ color: ACCENT_TEXT }}>已完全绽放 · 你们的爱开花啦 🌸</div>
                )}
                <div className="text-[10px] text-[#bbb] mt-0.5">成长值 {Math.round(growth)}</div>
              </div>
              <div className="grid grid-cols-3 gap-2.5 w-full">
                {cares.map(k => {
                  const c = PLANT_CARE[k];
                  const done = space.plant?.[k] === today;
                  return (
                    <button key={k} onClick={() => carePlant(k)} disabled={done}
                      className="rounded-2xl py-3 flex flex-col items-center gap-1 border transition active:scale-95 disabled:opacity-60"
                      style={done ? { background: '#f4f4f4', borderColor: '#eee' } : { background: '#fff', borderColor: ACCENT_BORDER }}>
                      <span className="text-xl">{c.emoji}</span>
                      <span className="text-[12px] font-bold text-[#555]">{c.label}</span>
                      <span className="text-[9px]" style={{ color: done ? '#bbb' : ACCENT_TEXT }}>{done ? '今天已照料' : `+${c.gain} 成长`}</span>
                    </button>
                  );
                })}
              </div>
              <div className="text-center text-[11px] text-[#aaa] leading-relaxed px-4">
                每天给小盆栽浇水、施肥、晒晒太阳，<br />看它陪着你们的感情一起长大 🌿
              </div>
            </div>
          );
        })()}

        {tab === 'game' && (() => {
          const lvl = intimacyLevel(space.intimacy || 0);
          const days = loveDays(space.anniversaryDate);
          const ACH = [
            { e: '💓', t: '初次心动', d: '建立你们的情侣空间', ok: (space.intimacy || 0) > 0 || !!space.anniversaryDate, cur: 0, tar: 0 },
            { e: '🔥', t: '热恋升级', d: '亲密度达到 Lv.3', ok: lvl >= 3, cur: lvl, tar: 3 },
            { e: '💎', t: '情比金坚', d: '亲密度达到 Lv.6', ok: lvl >= 6, cur: lvl, tar: 6 },
            { e: '📅', t: '百日纪念', d: '相恋满 100 天', ok: days >= 100, cur: days, tar: 100 },
            { e: '🎂', t: '周年之约', d: '相恋满 365 天', ok: days >= 365, cur: days, tar: 365 },
            { e: '📸', t: '生活记录者', d: '一起发 10 条动态', ok: space.moments.length >= 10, cur: space.moments.length, tar: 10 },
            { e: '✅', t: '言出必行', d: '完成 5 个约定', ok: doneTasks.length >= 5, cur: doneTasks.length, tar: 5 },
            { e: '🌟', t: '梦想成真', d: '实现 3 个心愿', ok: doneWishes.length >= 3, cur: doneWishes.length, tar: 3 },
            { e: '💌', t: '悄悄话', d: '互留 5 条悄悄话', ok: space.whispers.length >= 5, cur: space.whispers.length, tar: 5 },
            { e: '🖼️', t: '回忆收藏家', d: '相册攒满 9 张', ok: space.photos.length >= 9, cur: space.photos.length, tar: 9 },
            { e: '🗓️', t: '纪念时刻', d: '记下 3 个纪念日', ok: space.anniversaries.length >= 3, cur: space.anniversaries.length, tar: 3 },
            { e: '🌸', t: '园丁之心', d: '盆栽养到绽放', ok: (space.plant?.growth || 0) >= 160, cur: Math.round(space.plant?.growth || 0), tar: 160 },
          ];
          const unlocked = ACH.filter(a => a.ok).length;
          return (
            <>
              <div className="text-center text-[13px] font-bold pb-1" style={{ color: ACCENT_TEXT }}>已解锁 {unlocked} / {ACH.length} 个里程碑</div>
              <div className="grid grid-cols-2 gap-2.5">
                {ACH.map(a => (
                  <div key={a.t} className={`rounded-2xl p-3 border flex flex-col items-center text-center gap-1 ${a.ok ? 'bg-white shadow-[0_2px_12px_rgba(233,120,145,0.16)]' : 'bg-white/60 border-[#eee]'}`} style={a.ok ? { borderColor: ACCENT_BORDER } : undefined}>
                    <div className={`text-2xl ${a.ok ? '' : 'grayscale opacity-40'}`}>{a.e}</div>
                    <div className={`text-[12px] font-bold ${a.ok ? 'text-[#333]' : 'text-[#bbb]'}`}>{a.t}</div>
                    <div className="text-[10px] leading-tight" style={{ color: a.ok ? ACCENT_TEXT : '#ccc' }}>{a.d}</div>
                    {a.ok ? (
                      <div className="text-[9px] font-bold" style={{ color: ACCENT_TEXT }}>✓ 已达成</div>
                    ) : a.tar > 0 ? (
                      <div className="text-[9px] text-[#ccc] mt-0.5">{Math.min(a.cur, a.tar)} / {a.tar}</div>
                    ) : null}
                  </div>
                ))}
              </div>
            </>
          );
        })()}
      </div>

      {/* 提问箱浮动入口（叠在悄悄话上方） */}
      <button onClick={() => setShowQuestions(true)}
        className="absolute right-4 bottom-[4.5rem] z-20 w-12 h-12 rounded-full text-white shadow-lg flex items-center justify-center active:scale-90 transition"
        style={{ background: ACCENT, boxShadow: '0 10px 26px rgba(233,120,145,0.26)' }} title="悄悄问 TA">
        <ChatCircleDots size={22} weight="fill" />
      </button>

      {/* 悄悄话浮动入口 */}
      <button onClick={() => setShowWhispers(true)}
        className="absolute right-4 bottom-4 z-20 w-12 h-12 rounded-full text-white shadow-lg flex items-center justify-center active:scale-90 transition"
        style={{ background: ACCENT, boxShadow: '0 10px 26px rgba(233,120,145,0.26)' }} title="悄悄话信箱">
        <EnvelopeOpen size={22} weight="fill" />
      </button>

      {/* ── 各种弹窗 ── */}
      <ComposeModal open={showCompose} text={composeText} setText={setComposeText} mood={composeMood} setMood={setComposeMood}
        images={composeImages} onPick={() => composeFileRef.current?.click()} onRemoveImage={(i) => setComposeImages(prev => prev.filter((_, idx) => idx !== i))}
        fileRef={composeFileRef} onPickFiles={pickComposeImages} media={composeMedia} setMedia={setComposeMedia}
        onClose={() => { setShowCompose(false); }} onPost={postUserMoment} />

      <Modal isOpen={showAnnivForm} title="添加纪念日" onClose={() => setShowAnnivForm(false)}
        footer={<><button onClick={() => setShowAnnivForm(false)} className="flex-1 py-3 bg-slate-100 text-slate-500 font-bold rounded-2xl active:scale-95 transition">取消</button>
          <button onClick={addAnniversary} className="flex-1 py-3 text-white font-bold rounded-2xl active:scale-95 transition" style={{ background: ACCENT }}>保存</button></>}>
        <div className="space-y-3">
          <input value={annivTitle} onChange={e => setAnnivTitle(e.target.value)} placeholder="纪念日名称（如 TA 的生日）" className="w-full px-4 py-3 rounded-xl text-sm outline-none border" style={{ background: ACCENT_SOFT, borderColor: ACCENT_BORDER }} />
          <div className="flex items-center gap-2 text-sm">
            <CalendarBlank size={18} style={{ color: ACCENT_TEXT }} />
            <input type="date" value={annivDate} onChange={e => setAnnivDate(e.target.value)} className="flex-1 px-3 py-2.5 rounded-xl text-sm outline-none border" style={{ background: ACCENT_SOFT, borderColor: ACCENT_BORDER }} />
          </div>
          <div className="grid grid-cols-4 gap-2">
            {(['love', 'birthday', 'promise', 'custom'] as CoupleAnniversary['kind'][]).map(k => (
              <button key={k} onClick={() => setAnnivKind(k)} className="py-2 rounded-xl text-[11px] font-bold border transition"
                style={annivKind === k ? { background: ACCENT, color: '#fff', borderColor: 'transparent' } : { background: '#fff', color: '#888', borderColor: ACCENT_BORDER }}>
                {KIND_EMOJI[k]} {KIND_LABEL[k]}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-[13px] text-slate-600 px-1">
            <input type="checkbox" checked={annivRepeat} onChange={e => setAnnivRepeat(e.target.checked)} className="w-4 h-4" style={{ accentColor: ACCENT_SOLID }} />
            每年重复（生日 / 周年）
          </label>
        </div>
      </Modal>

      <Modal isOpen={showAnnivDateSet} title="设定在一起纪念日" onClose={() => setShowAnnivDateSet(false)}
        footer={<><button onClick={() => setShowAnnivDateSet(false)} className="flex-1 py-3 bg-slate-100 text-slate-500 font-bold rounded-2xl active:scale-95 transition">取消</button>
          <button onClick={setAnniversaryDate} className="flex-1 py-3 text-white font-bold rounded-2xl active:scale-95 transition" style={{ background: ACCENT }}>保存</button></>}>
        <div className="space-y-2">
          <p className="text-[12px] text-slate-500">从这一天起，自动计算「已相恋多少天」。</p>
          <input type="date" value={annivDateDraft} onChange={e => setAnnivDateDraft(e.target.value)} className="w-full px-4 py-3 rounded-xl text-sm outline-none border" style={{ background: ACCENT_SOFT, borderColor: ACCENT_BORDER }} />
        </div>
      </Modal>

      {/* 照片查看 */}
      {photoView && (
        <div className="fixed inset-0 z-[120] bg-black/80 flex flex-col items-center justify-center p-5 animate-fade-in" onClick={() => setPhotoView(null)}>
          <img src={photoView.url} className="max-w-full max-h-[60vh] rounded-2xl object-contain" onClick={e => e.stopPropagation()} />
          <div className="mt-3 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <input value={photoView.caption || ''} onChange={e => { const v = e.target.value; setPhotoView(p => p ? { ...p, caption: v } : p); setPhotoCaption(photoView.id, v); }}
              placeholder="给这张合照写句话…" className="w-full px-4 py-2.5 bg-white/15 text-white placeholder-white/50 rounded-xl text-sm outline-none border border-white/20" />
            <div className="flex justify-between items-center mt-3">
              <span className="text-white/50 text-[11px]">{photoView.addedBy === 'char' ? partnerName : userName} 添加 · {timeAgo(photoView.at)}</span>
              <button onClick={() => deletePhoto(photoView.id)} className="text-[13px] font-bold flex items-center gap-1" style={{ color: ACCENT_MUTED }}><Trash size={15} /> 删除</button>
            </div>
          </div>
          <button onClick={() => setPhotoView(null)} className="absolute top-5 right-5 w-9 h-9 rounded-full bg-white/20 text-white flex items-center justify-center"><X size={18} weight="bold" /></button>
        </div>
      )}

      {/* 悄悄话信箱 */}
      <Modal isOpen={showWhispers} title="悄悄话信箱" onClose={() => setShowWhispers(false)} footer={<div className="w-full">
        <div className="flex gap-2">
          <input value={whisperInput} onChange={e => setWhisperInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !whisperBusy) sendWhisper(); }}
            placeholder={`给 ${partnerName} 留一句悄悄话…`} className="flex-1 px-4 py-3 rounded-2xl text-sm outline-none border" style={{ background: ACCENT_SOFT, borderColor: ACCENT_BORDER }} />
          <button onClick={sendWhisper} disabled={whisperBusy || !whisperInput.trim()} className="px-4 text-white rounded-2xl active:scale-95 transition disabled:opacity-50" style={{ background: ACCENT }}>
            {whisperBusy ? <ArrowsClockwise size={18} className="animate-spin" /> : <PaperPlaneTilt size={18} weight="fill" />}
          </button>
        </div>
      </div>}>
        <div className="space-y-3">
          {space.whispers.length === 0 && <div className="text-center text-[#bbb] text-xs py-6">还没有悄悄话，留下第一句心里话吧</div>}
          {[...space.whispers]
            .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.at - a.at)
            .map(w => {
              const isUser = w.author === 'user';
              const replied = isUser && space.whispers.some(x => x.author === 'char' && x.at > w.at);
              const status = isUser ? (replied ? '已回' : '等 TA 回信') : (w.readAt ? '已读' : '未读');
              return (
                <SoftCard key={w.id} emphasis={w.pinned ? 'ink' : null} className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-[10px] font-black" style={{ color: INK_SOFT }}>
                        <span>{isUser ? userName : partnerName}</span>
                        <span>·</span>
                        <span>{timeAgo(w.at)}</span>
                        <span className="px-1.5 py-0.5 rounded-full border" style={{ borderColor: LINE, color: w.readAt || isUser ? INK_SOFT : INK }}>{status}</span>
                      </div>
                      <div className="mt-2 text-[13px] leading-relaxed whitespace-pre-wrap" style={{ color: INK }}>{w.text}</div>
                    </div>
                    <div className="flex flex-col gap-1 shrink-0">
                      <button onClick={() => toggleWhisperPinned(w.id)} className="w-7 h-7 rounded-full flex items-center justify-center active:scale-90 transition" style={{ background: w.pinned ? ACCENT : '#fff', color: w.pinned ? '#fff' : INK_SOFT, border: `1px solid ${w.pinned ? 'transparent' : LINE}` }} title={w.pinned ? '取消收藏' : '收藏'}>
                        <Heart size={14} weight={w.pinned ? 'fill' : 'regular'} />
                      </button>
                      <button onClick={() => deleteWhisper(w.id)} className="w-7 h-7 rounded-full flex items-center justify-center active:scale-90 transition" style={{ background: '#fff', color: INK_SOFT, border: `1px solid ${LINE}` }} title="删除">
                        <Trash size={14} />
                      </button>
                    </div>
                  </div>
                </SoftCard>
              );
            })}
          {whisperBusy && <div className="text-center text-[11px]" style={{ color: INK_SOFT }}>{partnerName} 正在回信…</div>}
        </div>
      </Modal>

      {/* 提问箱 */}
      <Modal isOpen={showQuestions} title="悄悄问 TA" onClose={() => setShowQuestions(false)} footer={<div className="w-full space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {QUESTION_SUGGESTIONS.slice(0, 3).map(s => (
            <button key={s} onClick={() => askQuestion(s)} disabled={questionBusy} className="text-[10px] px-2.5 py-1 rounded-full bg-white border active:scale-95 transition disabled:opacity-40" style={{ color: ACCENT_TEXT, borderColor: ACCENT_BORDER }}>{s}</button>
          ))}
        </div>
        <div className="flex gap-2">
          <input value={questionInput} onChange={e => setQuestionInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !questionBusy) askQuestion(); }}
            placeholder={`问 ${partnerName} 一个问题…`} className="flex-1 px-4 py-3 rounded-2xl text-sm outline-none border" style={{ background: ACCENT_SOFT, borderColor: ACCENT_BORDER }} />
          <button onClick={() => askQuestion()} disabled={questionBusy || !questionInput.trim()} className="px-4 text-white rounded-2xl active:scale-95 transition disabled:opacity-50" style={{ background: ACCENT }}>
            {questionBusy ? <ArrowsClockwise size={18} className="animate-spin" /> : <PaperPlaneTilt size={18} weight="fill" />}
          </button>
        </div>
      </div>}>
        <div className="space-y-3">
          <SoftCard emphasis="ink" className="p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[12px] font-black">匿名状态</div>
                <div className="text-[11px]" style={{ color: INK_SOFT }}>不会把名字贴在问题卡上</div>
              </div>
              <span className="px-3 py-1 rounded-full text-[11px] font-black text-white" style={{ background: ACCENT }}>匿名</span>
            </div>
          </SoftCard>
          {(space.questions || []).length === 0 && <div className="text-center text-[#bbb] text-xs py-6">问 {partnerName} 一个问题，更懂 TA 一点</div>}
          {[...(space.questions || [])]
            .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.at - a.at)
            .map(q => {
              const status = q.status || (q.answer ? 'answered' : 'pending');
              const expanded = !!expandedQuestions[q.id];
              return (
                <SoftCard key={q.id} emphasis={q.pinned ? 'ink' : null} className="p-3 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-[10px] font-black" style={{ color: INK_SOFT }}>
                        <span>{q.visibility === 'named' ? userName : '匿名'}</span>
                        <span>·</span>
                        <span>{timeAgo(q.at)}</span>
                        <span className="px-1.5 py-0.5 rounded-full border" style={{ borderColor: LINE }}>{status === 'pending' ? '等待回答' : status === 'failed' ? '待重试' : '已回答'}</span>
                      </div>
                      <div className="mt-2 text-[13px] font-bold leading-relaxed whitespace-pre-wrap" style={{ color: INK }}>{q.question}</div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => toggleQuestionPinned(q.id)} className="w-7 h-7 rounded-full flex items-center justify-center active:scale-90 transition" style={{ background: q.pinned ? ACCENT : '#fff', color: q.pinned ? '#fff' : INK_SOFT, border: `1px solid ${q.pinned ? 'transparent' : LINE}` }} title={q.pinned ? '取消收藏' : '收藏'}>
                        <Heart size={14} weight={q.pinned ? 'fill' : 'regular'} />
                      </button>
                      <button onClick={() => deleteQuestion(q.id)} className="w-7 h-7 rounded-full flex items-center justify-center active:scale-90 transition" style={{ background: '#fff', color: INK_SOFT, border: `1px solid ${LINE}` }} title="删除">
                        <Trash size={14} />
                      </button>
                    </div>
                  </div>
                  {status === 'pending' ? (
                    <div className="text-[11px] flex items-center gap-1.5" style={{ color: INK_SOFT }}><ArrowsClockwise size={12} className="animate-spin" /> {partnerName} 正在想怎么回答</div>
                  ) : (
                    <div>
                      <button onClick={() => setExpandedQuestions(prev => ({ ...prev, [q.id]: !expanded }))}
                        className="text-[11px] font-black px-3 py-1.5 rounded-full border active:scale-95 transition"
                        style={{ borderColor: LINE, color: INK }}>
                        {expanded ? '收起答案' : '查看答案'}
                      </button>
                      {expanded && (
                        <div className="mt-2 rounded-xl px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap border" style={{ background: '#fff', borderColor: LINE, color: '#444' }}>
                          {q.answer || fallbackQuestionAnswer()}
                          <div className="text-[9px] mt-1" style={{ color: INK_SOFT }}>{partnerName} · {timeAgo(q.answeredAt || q.at)}</div>
                        </div>
                      )}
                    </div>
                  )}
                </SoftCard>
              );
            })}
          {questionBusy && <div className="text-center text-[11px]" style={{ color: INK_SOFT }}>{partnerName} 正在思考…</div>}
        </div>
      </Modal>

      {/* TA 眼中的我 */}
      <Modal isOpen={showEyes} title="TA 眼中的我" onClose={() => { setShowEyes(false); setEyesEra(null); }}
        panelClassName="rounded-[1.75rem]" contentClassName="!max-h-[64vh]">
        {!eyesEra ? (
          <div className="space-y-3">
            {EYES_ERAS.map(meta => {
              const card = eyesCards.find(c => c.era === meta.era);
              const busy = eyesBusy === meta.era;
              return (
                <SoftCard key={meta.era} emphasis={card ? 'ink' : null} onClick={() => setEyesEra(meta.era)} className="p-4 active:scale-[0.99] transition">
                  <div className="flex items-start gap-3">
                    <SoftBadge size={40}>{meta.stamp}</SoftBadge>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="text-sm font-black">{meta.title}</div>
                          <div className="text-[11px]" style={{ color: INK_SOFT }}>{meta.note}</div>
                        </div>
                        <button onClick={(e) => { e.stopPropagation(); void runEyesGenerate(meta.era); }} disabled={!!eyesBusy}
                          className="px-2.5 py-1 rounded-full text-[10px] font-black border active:scale-95 transition disabled:opacity-50"
                          style={{ borderColor: LINE, color: INK }}>
                          {busy ? '写着' : card ? '重写' : '生成'}
                        </button>
                      </div>
                      <div className="mt-2 text-[12px] leading-relaxed" style={{ color: card ? INK : INK_SOFT }}>
                        {card ? card.summary : '还没有写下这张卡。'}
                      </div>
                      {card?.tags?.length ? (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {card.tags.slice(0, 4).map(tag => <span key={tag} className="px-2 py-0.5 rounded-full text-[10px] border" style={{ borderColor: LINE, color: INK_SOFT }}>{tag}</span>)}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </SoftCard>
              );
            })}
          </div>
        ) : (() => {
          const meta = EYES_ERAS.find(x => x.era === eyesEra)!;
          const card = eyesCards.find(c => c.era === eyesEra) as CoupleEyesCard | undefined;
          const busy = eyesBusy === eyesEra;
          return (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <button onClick={() => setEyesEra(null)} className="w-8 h-8 rounded-full flex items-center justify-center active:scale-90 transition" style={{ background: ACCENT_SOFT, color: INK }} title="返回">
                  <ArrowLeft size={16} weight="bold" />
                </button>
                <div className="text-center">
                  <div className="text-sm font-black">{meta.title}</div>
                  <div className="text-[10px]" style={{ color: INK_SOFT }}>{card ? timeAgo(card.generatedAt) : meta.note}</div>
                </div>
                <button onClick={() => void runEyesGenerate(eyesEra)} disabled={!!eyesBusy}
                  className="px-3 py-1.5 rounded-full text-[11px] font-black border active:scale-95 transition disabled:opacity-50"
                  style={{ borderColor: LINE, color: INK }}>
                  {busy ? '生成中' : card ? '重新生成' : '生成'}
                </button>
              </div>
              {card ? (
                <SoftCard emphasis="ink" className="p-4 space-y-3">
                  <div>
                    <div className="text-[13px] font-black leading-relaxed">{card.summary}</div>
                    {card.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {card.tags.map(tag => <span key={tag} className="px-2 py-0.5 rounded-full text-[10px] border" style={{ borderColor: LINE, color: INK_SOFT }}>{tag}</span>)}
                      </div>
                    )}
                  </div>
                  <div className="text-[13px] leading-7 whitespace-pre-wrap" style={{ color: '#333' }}>{card.body}</div>
                  {card.innerVoice && (
                    <div className="rounded-xl px-3 py-2 text-[12px] leading-relaxed border" style={{ background: '#fff', borderColor: LINE, color: INK_SOFT }}>
                      {card.innerVoice}
                    </div>
                  )}
                </SoftCard>
              ) : (
                <SoftCard className="p-5 text-center">
                  <SoftBadge size={44}>{meta.stamp}</SoftBadge>
                  <div className="mt-3 text-[13px] font-black">{meta.title}</div>
                  <div className="mt-1 text-[12px]" style={{ color: INK_SOFT }}>这张卡还空着。</div>
                </SoftCard>
              )}
            </div>
          );
        })()}
      </Modal>

      {/* 默契大考验 */}
      <Modal isOpen={showGame} title="默契大考验 💞" onClose={() => setShowGame(false)}>
        {gamePhase === 'intro' && (
          <div className="text-center space-y-4 py-2">
            <div className="text-5xl">💞</div>
            <p className="text-[13px] text-[#666] leading-relaxed px-2">
              选出你觉得 <b>{partnerName}</b> 会选的答案，<br />答完看看你有多懂 TA～
            </p>
            {space.compatBest ? <div className="text-[12px]" style={{ color: ACCENT_TEXT }}>历史最高默契 {space.compatBest}%</div> : null}
            <button onClick={startGame} className="w-full py-3 rounded-2xl font-bold text-white active:scale-95 transition" style={{ background: ACCENT }}>开始挑战</button>
          </div>
        )}
        {gamePhase === 'playing' && gameQs[gameIdx] && (
          <div className="space-y-4 py-1">
            <div className="text-center text-[11px] text-[#bbb]">第 {gameIdx + 1} / {gameQs.length} 题</div>
            <div className="text-center text-[15px] font-bold text-[#333] px-2">{gameQs[gameIdx].q}</div>
            <div className="text-center text-[11px] text-[#aaa]">你猜 {partnerName} 会选——</div>
            <div className="grid grid-cols-1 gap-2.5">
              {(['a', 'b'] as const).map(opt => (
                <button key={opt} disabled={gameBusy} onClick={() => pickGameAnswer(opt)}
                  className="w-full py-3.5 rounded-2xl font-bold text-[14px] border-2 active:scale-95 transition disabled:opacity-50"
                  style={{ background: '#fff', borderColor: ACCENT_BORDER, color: '#555' }}>
                  {gameQs[gameIdx][opt]}
                </button>
              ))}
            </div>
            {gameBusy && <div className="text-center text-[11px]" style={{ color: ACCENT_MUTED }}>{partnerName} 正在作答…</div>}
          </div>
        )}
        {gamePhase === 'reveal' && (() => {
          const matches = gameUserAns.reduce((acc, a, i) => acc + (a === gameCharAns[i] ? 1 : 0), 0);
          const pct = Math.round((matches / Math.max(1, gameQs.length)) * 100);
          const verdict = pct >= 100 ? '心有灵犀·灵魂伴侣' : pct >= 80 ? '默契满分·超懂彼此' : pct >= 60 ? '相当合拍' : pct >= 40 ? '还在磨合期' : '相反相吸·要多了解';
          return (
            <div className="space-y-3 py-1">
              <div className="text-center">
                <div className="text-3xl font-black" style={{ color: ACCENT_TEXT }}>{pct}%</div>
                <div className="text-[13px] font-bold text-[#444] mt-0.5">{verdict}</div>
                <div className="text-[10px] text-[#bbb] mt-0.5">默契 +{matches * 2} 亲密度</div>
              </div>
              <div className="space-y-1.5">
                {gameQs.map((q, i) => {
                  const ok = gameUserAns[i] === gameCharAns[i];
                  return (
                    <div key={i} className="rounded-xl px-3 py-2 border" style={{ background: ok ? ACCENT_SOFT : '#fafafa', borderColor: ok ? ACCENT_BORDER : '#eee' }}>
                      <div className="text-[12px] font-bold text-[#444]">{q.q}</div>
                      <div className="text-[11px] mt-0.5 flex items-center gap-2 flex-wrap" style={{ color: '#888' }}>
                        <span>你猜：{q[gameUserAns[i]]}</span>
                        <span>·</span>
                        <span>{partnerName}：{q[gameCharAns[i]]}</span>
                        <span className="ml-auto">{ok ? '✅' : '❌'}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={() => setShowGame(false)} className="flex-1 py-3 bg-slate-100 text-slate-500 font-bold rounded-2xl active:scale-95 transition">收工</button>
                <button onClick={startGame} className="flex-1 py-3 text-white font-bold rounded-2xl active:scale-95 transition" style={{ background: ACCENT }}>再来一局</button>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* 设置 / 菜单 */}
      <Modal isOpen={showSettings} title="情侣空间" onClose={() => setShowSettings(false)}>
        <div className="space-y-3">
          <div className="flex items-center gap-3 rounded-2xl p-3" style={{ background: ACCENT_SOFT }}>
            <img src={partnerAvatar} className="w-12 h-12 rounded-full object-cover" style={{ boxShadow: AVATAR_GLOW }} />
            <div className="flex-1 min-w-0">
              <div className="font-bold text-[#333] text-sm">{partnerName}</div>
              <div className="text-[11px] text-[#999]">{partner.relationship?.label || '你的另一半'} · 亲密度 {Math.round(space.intimacy)}</div>
            </div>
          </div>
          <button onClick={() => { setShowSettings(false); openGame(); }} className="w-full py-3 rounded-2xl font-bold text-white active:scale-95 transition flex items-center justify-center gap-2" style={{ background: ACCENT }}>
            <span>💞 默契大考验</span>
            {space.compatBest ? <span className="text-[11px] font-normal text-white/80">· 最高 {space.compatBest}%</span> : null}
          </button>
          <button onClick={() => { setShowSettings(false); openDateFromCouple(); }} className="w-full py-3 bg-white text-[#333] font-bold rounded-2xl active:scale-95 transition border border-[#e8ecf3]">
            从这里去约会
          </button>
          <button onClick={toggleAutoCare} className="w-full py-3 bg-white text-[#333] font-bold rounded-2xl active:scale-95 transition border border-[#e8ecf3]">
            后台自经营：{autoCareOn ? '开启中' : '已关闭'}
          </button>
          <p className="text-[12px] text-[#999] leading-relaxed px-1">
            回到目录不会删除回忆；每个角色的空间都会保留在自己的角色资料里。
          </p>
          <button onClick={unbind} className="w-full py-3 bg-stone-100 text-stone-600 font-bold rounded-2xl active:scale-95 transition border border-stone-200">
            回到空间目录
          </button>
        </div>
      </Modal>

      {/* ── 心声弹窗（毛玻璃遮罩 + 两阶段动画） ── */}
      {innerMoment && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center p-6"
          style={{ background: 'rgba(255,255,255,0.8)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
          onClick={closeInnerVoice}>
          <button onClick={closeInnerVoice} className="absolute top-5 right-5 w-10 h-10 rounded-full bg-black/5 flex items-center justify-center active:scale-90 transition" style={{ color: '#666' }}>
            <X size={20} weight="bold" />
          </button>

          {innerPhase === 'loading' ? (
            <div className="flex flex-col items-center gap-5" onClick={e => e.stopPropagation()}>
              <div className="flex items-end gap-1.5 h-12">
                {Array.from({ length: 5 }).map((_, i) => (
                  <span key={i} className="w-1.5 rounded-full" style={{ height: '100%', background: ACCENT, transformOrigin: 'bottom', animation: `csEq ${0.7 + (i % 3) * 0.18}s ease-in-out ${i * 0.12}s infinite` }} />
                ))}
              </div>
              <div className="text-[12px] tracking-wide" style={{ color: ACCENT_TEXT }}>正在读取 {partnerName} 的心声…</div>
            </div>
          ) : (
            <div onClick={e => e.stopPropagation()} className="relative w-full max-w-[300px] rounded-2xl px-6 py-7 text-center"
              style={{ background: '#222222', color: '#fff', borderRadius: 16, boxShadow: '0 24px 60px rgba(0,0,0,0.45)', animation: 'csVoiceCard .4s ease-out both' }}>
              <Quotes size={22} weight="fill" className="mx-auto mb-2.5 text-white/35" />
              <div className="text-[13px] font-bold tracking-[0.18em] mb-4 text-white/95">{partnerName} の 心声</div>
              <p className="text-[14px] leading-relaxed text-white/95 whitespace-pre-wrap">{innerText}</p>
              <div className="mt-6 text-[10px] text-white/40">轻触别处收起 · 只有你听得见</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── 多媒体卡片（语音 / 音乐 / 物件），点击触发心声 ──
const MediaCard: React.FC<{ media: CoupleMedia; onClick: () => void }> = ({ media, onClick }) => {
  if (media.kind === 'voice') {
    return (
      <button onClick={onClick} className="w-full flex items-center gap-3 px-4 py-3 mb-2.5 active:scale-[0.98] transition-transform" style={{ background: ACCENT_SOFT, borderRadius: 12 }}>
        <span className="w-9 h-9 rounded-full flex items-center justify-center text-white shrink-0" style={{ background: ACCENT }}><Microphone size={18} weight="fill" /></span>
        <div className="flex-1 min-w-0 text-left">
          <div className="text-[13px] font-semibold truncate" style={{ color: ACCENT_TEXT }}>{media.name}</div>
          <div className="flex items-end gap-0.5 h-3 mt-1">
            {[6, 11, 16, 9, 14, 7, 12, 5, 10, 8].map((h, i) => (<span key={i} className="w-[3px] rounded-full" style={{ height: h, background: ACCENT_MUTED }} />))}
          </div>
        </div>
        <span className="text-[12px] shrink-0" style={{ color: ACCENT_TEXT }}>{media.duration || '00:12'}</span>
      </button>
    );
  }
  if (media.kind === 'music') {
    return (
      <button onClick={onClick} className="w-full flex items-center gap-3 px-4 py-3 mb-2.5 active:scale-[0.98] transition-transform" style={{ background: ACCENT_SOFT, borderRadius: 12 }}>
        <span className="w-9 h-9 rounded-full flex items-center justify-center text-white shrink-0" style={{ background: ACCENT }}><MusicNotes size={18} weight="fill" /></span>
        <div className="flex-1 min-w-0 text-left">
          <div className="text-[13px] font-semibold truncate" style={{ color: ACCENT_TEXT }}>{media.name}</div>
          <div className="text-[11px]" style={{ color: ACCENT_MUTED }}>🎵 TA 分享的歌</div>
        </div>
      </button>
    );
  }
  // item（物件 / 照片附件卡）
  return (
    <button onClick={onClick} className="w-full flex items-center gap-3 px-4 py-3 mb-2.5 active:scale-[0.98] transition-transform" style={{ background: ACCENT_SOFT, borderRadius: 12 }}>
      <span className="w-10 h-10 rounded-lg flex items-center justify-center text-white shrink-0" style={{ background: ACCENT }}><ImageSquare size={20} weight="fill" /></span>
      <div className="flex-1 min-w-0 text-left">
        <div className="text-[13px] font-semibold truncate" style={{ color: ACCENT_TEXT }}>{media.name}</div>
        <div className="text-[11px]" style={{ color: ACCENT_MUTED }}>点击查看图片描述</div>
      </div>
    </button>
  );
};

// ── 动态卡片（时间线帖子） ──
const MomentCard: React.FC<{
  m: CoupleMoment; userName: string; userAvatar: string; partnerName: string; partnerAvatar?: string;
  engaging: boolean; onToggleLike: () => void; onComment: (t: string) => void; onDelete: () => void; onInnerVoice: () => void;
}> = ({ m, userName, userAvatar, partnerName, partnerAvatar, engaging, onToggleLike, onComment, onDelete, onInnerVoice }) => {
  const [showComment, setShowComment] = useState(false);
  const [draft, setDraft] = useState('');
  const isUser = m.author === 'user';
  const name = isUser ? userName : partnerName;
  const avatar = isUser ? userAvatar : partnerAvatar;
  const likeCount = (m.likedByUser ? 1 : 0) + (m.likedByChar ? 1 : 0);

  const submit = () => { const t = draft.trim(); if (!t) return; onComment(t); setDraft(''); };

  return (
    <article className="bg-white rounded-2xl p-4 shadow-[0_2px_14px_rgba(0,0,0,0.04)] border border-[#f2f2f2]">
      {/* 时间戳（顶部居右） */}
      <div className="text-[12px] text-right mb-2 font-medium" style={{ color: '#A0A0A0' }}>{fmtStamp(m.createdAt)}</div>
      {/* 作者行（左侧 30px 头像） */}
      <div className="flex items-center gap-2.5 mb-2">
        <img src={avatar} className="w-[30px] h-[30px] rounded-full object-cover shrink-0" />
        <div className="flex-1 min-w-0 flex items-center gap-1.5">
          <span className="font-bold text-[13px] truncate" style={{ color: '#333' }}>{name}</span>
          {!isUser && <span className="text-[9px] text-white px-1.5 py-0.5 rounded-full shrink-0" style={{ background: ACCENT }}>TA</span>}
          {m.mood && <span className="text-[13px] shrink-0">{m.mood}</span>}
        </div>
        {isUser && <button onClick={onDelete} className="text-[#ccc] hover:text-slate-500 active:scale-90 transition shrink-0"><Trash size={14} /></button>}
      </div>
      {/* 正文 */}
      {m.text && <p className="text-[14px] leading-relaxed whitespace-pre-wrap mb-2.5" style={{ color: '#333' }}>{m.text}</p>}
      {/* 多媒体块：语音 / 音乐 / 物件 */}
      {m.media && <MediaCard media={m.media} onClick={onInnerVoice} />}
      {/* 图片（点击查看「图片描述」= 心声） */}
      {m.images && m.images.length > 0 && (
        <button onClick={onInnerVoice} className="block w-full text-left mb-2.5 active:scale-[0.98] transition-transform">
          <div className={`grid gap-1 ${m.images.length === 1 ? 'grid-cols-1' : m.images.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
            {m.images.map((src, i) => (
              <div key={i} className={`overflow-hidden rounded-lg bg-[#f4f4f4] ${m.images!.length === 1 ? 'max-h-60' : 'aspect-square'}`}>
                <img src={src} className="w-full h-full object-cover" />
              </div>
            ))}
          </div>
          <div className="text-[11px] mt-1.5 flex items-center gap-1" style={{ color: '#bbb' }}><Quotes size={11} weight="fill" /> 点击查看图片描述</div>
        </button>
      )}
      {/* 评论区 */}
      {(m.comments.length > 0 || showComment) && (
        <div className="mt-1 space-y-1.5 rounded-xl p-3" style={{ background: ACCENT_SOFT }}>
          {m.comments.map(c => (
            <div key={c.id} className="text-[12.5px] leading-snug">
              <span className="font-bold" style={{ color: '#333' }}>{c.author === 'user' ? userName : partnerName}</span>
              <span style={{ color: '#555' }}>：{c.text}</span>
            </div>
          ))}
          {showComment && (
            <div className="flex gap-2 pt-1">
              <input value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submit(); }}
                placeholder="说点什么…" className="flex-1 px-3 py-1.5 bg-white rounded-full text-[12px] outline-none border border-[#eee]" autoFocus />
              <button onClick={submit} className="active:scale-90 transition" style={{ color: ACCENT_TEXT }}><PaperPlaneTilt size={18} weight="fill" /></button>
            </div>
          )}
        </div>
      )}
      {/* 操作栏 */}
      <div className="flex items-center gap-4 pt-2.5 mt-2.5 border-t border-[#f4f4f4]">
        <button onClick={onToggleLike} className="flex items-center gap-1 text-[12px] active:scale-90 transition">
          <Heart size={16} weight={m.likedByUser ? 'fill' : 'regular'} style={{ color: m.likedByUser ? ACCENT_TEXT : '#bbb' }} />
          <span style={{ color: m.likedByUser ? ACCENT_TEXT : '#999' }}>{likeCount > 0 ? likeCount : '赞'}</span>
        </button>
        <button onClick={() => setShowComment(v => !v)} className="flex items-center gap-1 text-[12px] active:scale-90 transition" style={{ color: '#999' }}>
          <ChatCircleDots size={16} /> <span>{m.comments.length > 0 ? m.comments.length : '评论'}</span>
        </button>
        <button onClick={onInnerVoice} className="flex items-center gap-1 text-[12px] active:scale-90 transition" style={{ color: ACCENT_TEXT }}>
          <Quotes size={15} weight="fill" /> <span>心声</span>
        </button>
        {m.likedByChar && <span className="text-[10px] ml-auto" style={{ color: ACCENT_MUTED }}>💗 {partnerName} 赞过</span>}
        {engaging && <span className="text-[10px] ml-auto animate-pulse" style={{ color: ACCENT_MUTED }}>{partnerName} 正在看…</span>}
      </div>
    </article>
  );
};

// ── 发布动态弹窗 ──
const ComposeModal: React.FC<{
  open: boolean; text: string; setText: (v: string) => void; mood: string; setMood: (v: string) => void;
  images: string[]; onPick: () => void; onRemoveImage: (i: number) => void;
  fileRef: React.RefObject<HTMLInputElement>; onPickFiles: (e: React.ChangeEvent<HTMLInputElement>) => void;
  media: ComposeMedia | null; setMedia: React.Dispatch<React.SetStateAction<ComposeMedia | null>>;
  onClose: () => void; onPost: () => void;
}> = ({ open, text, setText, mood, setMood, images, onPick, onRemoveImage, fileRef, onPickFiles, media, setMedia, onClose, onPost }) => {
  const mediaKinds: { kind: CoupleMediaKind; label: string; Icon: React.ElementType; placeholder: string }[] = [
    { kind: 'voice', label: '语音', Icon: Microphone, placeholder: '语音名（如 晚安语音.m4a）' },
    { kind: 'music', label: '音乐', Icon: MusicNotes, placeholder: '歌名（如 夜空中最亮的星）' },
    { kind: 'item', label: '物件', Icon: Gift, placeholder: '物件名（如 照片_糯米糍.jpg）' },
  ];
  const active = mediaKinds.find(k => k.kind === media?.kind);
  return (
    <Modal isOpen={open} title="发布情侣动态" onClose={onClose}
      footer={<><button onClick={onClose} className="flex-1 py-3 bg-slate-100 text-slate-500 font-bold rounded-2xl active:scale-95 transition">取消</button>
        <button onClick={onPost} className="flex-1 py-3 text-white font-bold rounded-2xl active:scale-95 transition" style={{ background: ACCENT }}>发布</button></>}>
      <div className="space-y-3">
        <textarea value={text} onChange={e => setText(e.target.value)} placeholder="此刻想对 TA 说点什么…" rows={3}
          className="w-full px-4 py-3 rounded-xl text-sm outline-none border resize-none" style={{ background: ACCENT_SOFT, borderColor: ACCENT_BORDER }} />

        {/* 添加内容：图片 / 语音 / 音乐 / 物件 */}
        <div>
          <div className="text-[11px] font-bold mb-1.5" style={{ color: ACCENT_TEXT }}>添加内容</div>
          <div className="flex gap-2">
            <button onClick={onPick} className="flex-1 py-2 rounded-xl text-[12px] font-bold border flex items-center justify-center gap-1 active:scale-95 transition"
              style={{ background: '#fff', color: ACCENT_TEXT, borderColor: ACCENT_BORDER }}>
              <Camera size={15} weight="fill" /> 图片
            </button>
            {mediaKinds.map(({ kind, label, Icon }) => {
              const on = media?.kind === kind;
              return (
                <button key={kind} onClick={() => setMedia(on ? null : { kind, name: '', duration: kind === 'voice' ? '00:15' : undefined })}
                  className="flex-1 py-2 rounded-xl text-[12px] font-bold border flex items-center justify-center gap-1 active:scale-95 transition"
                  style={on ? { background: ACCENT, color: '#fff', borderColor: 'transparent' } : { background: '#fff', color: ACCENT_TEXT, borderColor: ACCENT_BORDER }}>
                  <Icon size={15} weight="fill" /> {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* 多媒体编辑器 */}
        {media && active && (
          <div className="rounded-xl p-3 space-y-2" style={{ background: ACCENT_SOFT }}>
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-bold flex items-center gap-1.5" style={{ color: ACCENT_TEXT }}>
                <active.Icon size={15} weight="fill" /> {active.label}卡片
              </span>
              <button onClick={() => setMedia(null)} className="w-6 h-6 rounded-full bg-white/70 flex items-center justify-center active:scale-90 transition" style={{ color: ACCENT_TEXT }}><X size={13} weight="bold" /></button>
            </div>
            <input value={media.name} onChange={e => setMedia(prev => prev ? { ...prev, name: e.target.value } : prev)}
              placeholder={active.placeholder} className="w-full px-3 py-2 bg-white rounded-lg text-[13px] outline-none border" style={{ borderColor: ACCENT_BORDER }} />
            {media.kind === 'voice' && (
              <div className="flex items-center gap-2">
                <span className="text-[11px]" style={{ color: ACCENT_TEXT }}>时长</span>
                <input value={media.duration || ''} onChange={e => setMedia(prev => prev ? { ...prev, duration: e.target.value } : prev)}
                  placeholder="00:15" className="w-24 px-3 py-1.5 bg-white rounded-lg text-[13px] outline-none border" style={{ borderColor: ACCENT_BORDER }} />
              </div>
            )}
          </div>
        )}

        <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={onPickFiles} />
        {images.length > 0 && (
          <div className="grid grid-cols-4 gap-2">
            {images.map((src, i) => (
              <div key={i} className="relative aspect-square rounded-lg overflow-hidden">
                <img src={src} className="w-full h-full object-cover" />
                <button onClick={() => onRemoveImage(i)} className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/50 text-white flex items-center justify-center"><X size={11} weight="bold" /></button>
              </div>
            ))}
            {images.length < MAX_IMAGES && (
              <button onClick={onPick} className="aspect-square rounded-lg border-2 border-dashed flex items-center justify-center active:scale-95 transition" style={{ borderColor: ACCENT_BORDER, color: ACCENT_MUTED }}><Camera size={20} /></button>
            )}
          </div>
        )}
        <div>
          <div className="text-[11px] font-bold mb-1.5" style={{ color: ACCENT_TEXT }}>心情</div>
          <div className="flex flex-wrap gap-1.5">
            {MOOD_EMOJIS.map(em => (
              <button key={em} onClick={() => setMood(mood === em ? '' : em)} className="w-8 h-8 rounded-full text-lg flex items-center justify-center transition"
                style={mood === em ? { background: ACCENT_PANEL, boxShadow: `0 0 0 2px ${ACCENT_MUTED} inset` } : { background: '#fff7f8' }}>{em}</button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default CoupleSpace;
