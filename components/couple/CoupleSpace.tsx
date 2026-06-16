import React, { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { useOS } from '../../context/OSContext';
import {
  CharacterProfile, CoupleSpace as CoupleSpaceData, CoupleMoment, CoupleAnniversary,
  CouplePhoto, CoupleTask, CoupleWhisper, CoupleInteractionKind,
} from '../../types';
import { processImage } from '../../utils/file';
import { resolveAuxApi } from '../../utils/auxApi';
import Modal from '../os/Modal';
import {
  ensureCoupleSpace, createCoupleSpace, genCoupleId, loveDays, nextOccurrence,
  intimacyLevel, intimacyProgress, intimacyTitle, INTERACTIONS, interactionDef,
  fallbackCharInteractionNote, todayYmd, pushInteraction,
  generateCharCoupleComment, generateCharWhisperReply, generateCharInteractionNote, generateCharMoment,
} from '../../utils/coupleSpace';
import {
  Heart, Sparkle, Trash, Plus, ArrowsClockwise, Camera, PaperPlaneTilt,
  CheckCircle, Circle, GearSix, EnvelopeOpen, CalendarBlank, X, ChatCircleDots,
} from '@phosphor-icons/react';

const PARTNER_KEY = 'moro_couple_partner_id';
const MAX_IMAGES = 9;
const MOOD_EMOJIS = ['😊', '🥰', '😍', '🤗', '😋', '🥳', '🤔', '😢', '😴', '💕', '🌙', '☀️'];
const TASK_SUGGESTIONS = ['今天说晚安', '一起看一部电影', '给对方做顿饭', '一起散步半小时', '互道一句早安', '拍一张合照'];

const romanticBtn = 'rounded-full font-bold active:scale-95 transition-transform disabled:opacity-50';

// 友好的相对时间
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

const KIND_LABEL: Record<CoupleAnniversary['kind'], string> = {
  love: '恋爱纪念', birthday: '生日', promise: '约定日', custom: '纪念日',
};
const KIND_EMOJI: Record<CoupleAnniversary['kind'], string> = {
  love: '💞', birthday: '🎂', promise: '🤙', custom: '📌',
};

type Tab = 'moments' | 'anniversary' | 'album' | 'tasks';

const CoupleSpace: React.FC = () => {
  const { characters, userProfile, updateCharacter, addToast, apiConfig, auxApiConfig } = useOS();

  const [partnerId, setPartnerId] = useState<string | null>(() => {
    try { return localStorage.getItem(PARTNER_KEY); } catch { return null; }
  });
  const partner = useMemo(() => characters.find(c => c.id === partnerId) || null, [characters, partnerId]);
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
    try { localStorage.setItem(PARTNER_KEY, id); } catch { /* ignore */ }
    setPartnerId(id);
    const c = charactersRef.current.find(x => x.id === id);
    if (c && !c.coupleSpace) void updateCharacter(id, { coupleSpace: createCoupleSpace() });
  };
  const unbind = () => {
    try { localStorage.removeItem(PARTNER_KEY); } catch { /* ignore */ }
    setPartnerId(null);
    setShowSettings(false);
  };

  // ── UI 状态 ──
  const [tab, setTab] = useState<Tab>('moments');
  const [showSettings, setShowSettings] = useState(false);
  const [showWhispers, setShowWhispers] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [showAnnivForm, setShowAnnivForm] = useState(false);
  const [showAnnivDateSet, setShowAnnivDateSet] = useState(false);
  const [photoView, setPhotoView] = useState<CouplePhoto | null>(null);

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
  const [engagingId, setEngagingId] = useState<string | null>(null);
  const [charMomentBusy, setCharMomentBusy] = useState(false);
  const composeFileRef = useRef<HTMLInputElement>(null);

  const resetCompose = () => { setComposeText(''); setComposeMood(''); setComposeImages([]); };

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
    if (!text && composeImages.length === 0 && !composeMood) { addToast('写点什么或加张图吧', 'info'); return; }
    const id = genCoupleId('mo');
    const moment: CoupleMoment = {
      id, author: 'user', text: text || undefined, mood: composeMood || undefined,
      images: composeImages.length ? composeImages : undefined,
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
    let res: { text: string; mood?: string } | null = null;
    try { res = await generateCharMoment({ char: partner, userName, api: coupleApi, space }); } catch { /* ignore */ }
    if (res) {
      const moment: CoupleMoment = {
        id: genCoupleId('mo'), author: 'char', text: res.text, mood: res.mood,
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

  // ── 悄悄话 ──
  const [whisperInput, setWhisperInput] = useState('');
  const [whisperBusy, setWhisperBusy] = useState(false);
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

  // ── 渲染：未绑定 ──
  if (!partner) {
    const romantic = (c: CharacterProfile) => ['crush', 'lover', 'engaged', 'married'].includes(c.relationship?.stage || '');
    const sorted = [...characters].sort((a, b) => (romantic(b) ? 1 : 0) - (romantic(a) ? 1 : 0));
    return (
      <div className="h-full overflow-y-auto" style={{ background: 'linear-gradient(180deg,#fff1f6 0%,#fce7f3 45%,#f5e6ff 100%)' }}>
        <div className="flex flex-col items-center px-6 pt-8 pb-6 text-center">
          <div className="relative mb-3">
            <Heart size={56} weight="fill" className="text-pink-400 drop-shadow" />
            <Sparkle size={20} weight="fill" className="text-rose-300 absolute -top-1 -right-2" />
          </div>
          <h2 className="text-lg font-black text-rose-500">情侣空间</h2>
          <p className="text-[12px] text-rose-400/80 mt-1.5 leading-relaxed max-w-[16rem]">
            选一位 TA，绑定为你的另一半，<br />一起经营只属于你们的小天地 💕
          </p>
        </div>
        <div className="px-4 pb-10 space-y-2">
          {sorted.length === 0 && (
            <div className="text-center text-rose-300 text-xs py-10">还没有角色，先去「名册」认识一个人吧</div>
          )}
          {sorted.map(c => {
            const isRomantic = romantic(c);
            return (
              <button key={c.id} onClick={() => bindPartner(c.id)}
                className="w-full bg-white/80 backdrop-blur rounded-2xl p-3 flex items-center gap-3 active:scale-[0.98] transition-transform shadow-sm border border-pink-100">
                <img src={c.convoSettings?.charAvatarOverride || c.avatar} className="w-12 h-12 rounded-full object-cover border-2 border-pink-100 shrink-0" />
                <div className="flex-1 min-w-0 text-left">
                  <div className="font-bold text-slate-700 truncate text-sm">{c.convoSettings?.remarkName?.trim() || c.name}</div>
                  {c.relationship?.label && (
                    <div className={`text-[11px] mt-0.5 ${isRomantic ? 'text-rose-400 font-semibold' : 'text-slate-400'}`}>
                      {isRomantic ? '💗 ' : ''}{c.relationship.label}
                    </div>
                  )}
                </div>
                <span className="text-[11px] text-white bg-pink-400 px-3 py-1.5 rounded-full font-bold shrink-0">绑定</span>
              </button>
            );
          })}
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

  return (
    <div className="h-full flex flex-col relative overflow-hidden" style={{ background: 'linear-gradient(180deg,#fff1f6 0%,#fce7f3 50%,#f6ecff 100%)' }}>
      <style>{`
        @keyframes csFloat { 0% { transform: translateY(0) scale(.6); opacity: 0; } 20% { opacity: 1; } 100% { transform: translateY(-160px) scale(1.3) rotate(12deg); opacity: 0; } }
        @keyframes csHeartbeat { 0%,100% { transform: scale(1); } 45% { transform: scale(1.18); } }
        @keyframes csPop { 0% { transform: scale(.8); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
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

      {/* 顶部情侣信息卡 */}
      <div className="shrink-0 px-4 pt-3 pb-2">
        <div className="rounded-3xl p-4 text-white shadow-lg shadow-pink-200/60 relative overflow-hidden" style={{ background: 'linear-gradient(120deg,#ff9ec4 0%,#f777b0 50%,#c98bff 100%)' }}>
          <button onClick={() => setShowSettings(true)} className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/25 flex items-center justify-center active:scale-90 transition" title="情侣空间设置">
            <GearSix size={16} weight="bold" />
          </button>
          {/* 双头像 + 红线 + 爱心 */}
          <div className="flex items-center justify-center gap-2 mb-2.5">
            <div className="flex flex-col items-center gap-1 w-20">
              <img src={userAvatar} className="w-14 h-14 rounded-full object-cover border-[3px] border-white/90 shadow" />
              <span className="text-[11px] font-bold truncate max-w-full">{userName}</span>
            </div>
            <div className="flex-1 max-w-[80px] flex items-center">
              <div className="h-[2px] flex-1 bg-white/60 rounded" />
              <Heart size={26} weight="fill" className="text-white drop-shadow mx-0.5" style={{ animation: 'csHeartbeat 1.6s ease-in-out infinite' }} />
              <div className="h-[2px] flex-1 bg-white/60 rounded" />
            </div>
            <div className="flex flex-col items-center gap-1 w-20">
              <img src={partnerAvatar} className="w-14 h-14 rounded-full object-cover border-[3px] border-white/90 shadow" />
              <span className="text-[11px] font-bold truncate max-w-full">{partnerName}</span>
            </div>
          </div>

          {/* 恋爱天数 */}
          <div className="text-center mb-2.5">
            {space.anniversaryDate ? (
              days > 0 ? (
                <button onClick={() => { setAnnivDateDraft(space.anniversaryDate || todayYmd()); setShowAnnivDateSet(true); }} className="active:scale-95 transition">
                  <span className="text-[13px] font-medium opacity-90">已相恋 </span>
                  <span className="text-2xl font-black tracking-tight">{days}</span>
                  <span className="text-[13px] font-medium opacity-90"> 天</span>
                </button>
              ) : (
                <span className="text-[13px] font-medium opacity-90">纪念日是 {space.anniversaryDate}，就要在一起啦 💓</span>
              )
            ) : (
              <button onClick={() => { setAnnivDateDraft(todayYmd()); setShowAnnivDateSet(true); }}
                className="text-[12px] font-bold bg-white/25 px-3 py-1.5 rounded-full active:scale-95 transition">
                ＋ 设定在一起纪念日
              </button>
            )}
          </div>

          {/* 亲密度 */}
          <div className="bg-white/20 rounded-2xl px-3 py-2">
            <div className="flex items-center justify-between text-[11px] font-bold mb-1">
              <span className="flex items-center gap-1"><Sparkle size={13} weight="fill" /> 亲密度 Lv.{lv}「{intimacyTitle(space.intimacy)}」</span>
              <span>{Math.round(space.intimacy)}</span>
            </div>
            <div className="h-2 rounded-full bg-white/30 overflow-hidden">
              <div className="h-full rounded-full bg-white transition-all duration-500" style={{ width: `${Math.max(4, prog * 100)}%` }} />
            </div>
          </div>
        </div>
      </div>

      {/* 每日互动 */}
      <div className="shrink-0 px-4 pb-1">
        <div className="flex items-stretch gap-2">
          {INTERACTIONS.map(it => (
            <button key={it.kind} onClick={() => doInteraction(it.kind)}
              className="flex-1 bg-white/85 rounded-2xl py-2 flex flex-col items-center gap-0.5 active:scale-95 transition shadow-sm border border-pink-100">
              <span className="text-xl leading-none">{it.emoji}</span>
              <span className="text-[10px] font-bold text-rose-400">{it.label}</span>
            </button>
          ))}
        </div>
        {/* 对方反应气泡 */}
        {charReaction && (
          <div className="mt-2 flex items-center gap-2 bg-white/90 rounded-2xl px-3 py-2 shadow-sm border border-pink-100" style={{ animation: 'csPop .25s ease-out' }}>
            <img src={partnerAvatar} className="w-7 h-7 rounded-full object-cover shrink-0" />
            <div className="flex-1 min-w-0 text-[12px] text-slate-600 leading-snug">
              {charReaction.loading ? <span className="text-rose-300">{partnerName} 正在回应… {charReaction.text}</span> : <span>{charReaction.text}</span>}
            </div>
            <span className="text-base shrink-0">{charReaction.emoji}</span>
          </div>
        )}
      </div>

      {/* 子标签 */}
      <div className="shrink-0 px-4 pt-2">
        <div className="flex bg-white/60 rounded-full p-1 text-[12px] font-bold">
          {([['moments', '动态'], ['anniversary', '纪念日'], ['album', '相册'], ['tasks', '约定']] as [Tab, string][]).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`flex-1 py-1.5 rounded-full transition ${tab === k ? 'bg-pink-400 text-white shadow' : 'text-rose-400/70'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* 内容区 */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3">
        {tab === 'moments' && (
          <>
            <div className="flex gap-2">
              <button onClick={() => setShowCompose(true)} className={`flex-1 py-2.5 bg-pink-400 text-white text-[13px] ${romanticBtn}`}>
                <span className="inline-flex items-center gap-1.5"><Plus size={15} weight="bold" /> 发布动态</span>
              </button>
              <button onClick={requestCharMoment} disabled={charMomentBusy} className={`px-4 py-2.5 bg-white/85 text-rose-400 text-[13px] border border-pink-200 ${romanticBtn}`}>
                <span className="inline-flex items-center gap-1.5">
                  {charMomentBusy ? <ArrowsClockwise size={15} className="animate-spin" /> : <ChatCircleDots size={15} weight="fill" />}
                  请 TA 冒个泡
                </span>
              </button>
            </div>
            {sortedMoments.length === 0 && (
              <div className="text-center text-rose-300 text-xs py-10">还没有动态，发布第一条留言吧 💌</div>
            )}
            {sortedMoments.map(m => (
              <MomentCard key={m.id} m={m} userName={userName} userAvatar={userAvatar} partnerName={partnerName} partnerAvatar={partnerAvatar}
                engaging={engagingId === m.id} onToggleLike={() => toggleLike(m.id)} onComment={(t) => addUserComment(m.id, t)} onDelete={() => deleteMoment(m.id)} />
            ))}
          </>
        )}

        {tab === 'anniversary' && (
          <>
            <button onClick={() => setShowAnnivForm(true)} className={`w-full py-2.5 bg-pink-400 text-white text-[13px] ${romanticBtn}`}>
              <span className="inline-flex items-center gap-1.5"><Plus size={15} weight="bold" /> 添加纪念日</span>
            </button>
            {space.anniversaryDate && days > 0 && (
              <div className="rounded-2xl p-3.5 text-white shadow" style={{ background: 'linear-gradient(120deg,#f777b0,#c98bff)' }}>
                <div className="text-[11px] opacity-90 font-medium">💞 在一起</div>
                <div className="text-lg font-black mt-0.5">已相恋 {days} 天</div>
                <div className="text-[11px] opacity-90 mt-0.5">自 {space.anniversaryDate} 起</div>
              </div>
            )}
            {sortedAnnivs.length === 0 && !space.anniversaryDate && (
              <div className="text-center text-rose-300 text-xs py-8">添加生日、约定日，自动倒计时提醒 ⏳</div>
            )}
            {sortedAnnivs.map(({ a, occ }) => {
              const d = occ?.daysLeft ?? null;
              return (
                <div key={a.id} className="bg-white/85 rounded-2xl p-3.5 flex items-center gap-3 shadow-sm border border-pink-100">
                  <span className="text-2xl shrink-0">{KIND_EMOJI[a.kind]}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-slate-700 text-sm truncate">{a.title}</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">{KIND_LABEL[a.kind]} · {a.date}{a.repeatYearly ? ' · 每年' : ''}</div>
                  </div>
                  <div className="text-right shrink-0">
                    {d === null ? null : d === 0 ? (
                      <span className="text-rose-500 font-black text-sm">就是今天 🎉</span>
                    ) : d > 0 ? (
                      <div><span className="text-rose-400 font-black text-lg leading-none">{d}</span><div className="text-[10px] text-slate-400">天后</div></div>
                    ) : (
                      <span className="text-slate-300 text-[11px]">已过 {-d} 天</span>
                    )}
                  </div>
                  <button onClick={() => deleteAnniversary(a.id)} className="text-slate-300 hover:text-rose-400 active:scale-90 transition shrink-0"><Trash size={16} /></button>
                </div>
              );
            })}
          </>
        )}

        {tab === 'album' && (
          <>
            <input ref={albumFileRef} type="file" accept="image/*" multiple className="hidden" onChange={pickAlbumPhotos} />
            <button onClick={() => albumFileRef.current?.click()} className={`w-full py-2.5 bg-pink-400 text-white text-[13px] ${romanticBtn}`}>
              <span className="inline-flex items-center gap-1.5"><Camera size={15} weight="fill" /> 添加照片</span>
            </button>
            {space.photos.length === 0 ? (
              <div className="text-center text-rose-300 text-xs py-10">还没有合照，添加你们的第一张照片 📷</div>
            ) : (
              <div className="grid grid-cols-3 gap-1.5">
                {space.photos.map(p => (
                  <button key={p.id} onClick={() => setPhotoView(p)} className="aspect-square rounded-xl overflow-hidden bg-pink-50 active:scale-95 transition border border-pink-100">
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
                placeholder="添加一个小约定…" className="flex-1 px-4 py-2.5 bg-white/85 rounded-full text-[13px] outline-none border border-pink-100 focus:border-pink-300" />
              <button onClick={() => addTask(taskInput)} className={`px-5 bg-pink-400 text-white text-[13px] ${romanticBtn}`}>添加</button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {TASK_SUGGESTIONS.map(s => (
                <button key={s} onClick={() => addTask(s)} className="text-[11px] px-3 py-1.5 rounded-full bg-white/70 text-rose-400 border border-pink-100 active:scale-95 transition">+ {s}</button>
              ))}
            </div>
            {pendingTasks.map(t => (
              <div key={t.id} className="bg-white/85 rounded-2xl p-3 flex items-center gap-3 shadow-sm border border-pink-100">
                <button onClick={() => toggleTask(t.id)} className="text-pink-300 active:scale-90 transition shrink-0"><Circle size={22} /></button>
                <span className="flex-1 text-sm text-slate-700">{t.title}</span>
                <button onClick={() => deleteTask(t.id)} className="text-slate-300 hover:text-rose-400 active:scale-90 transition shrink-0"><Trash size={15} /></button>
              </div>
            ))}
            {doneTasks.length > 0 && (
              <div className="text-[11px] font-bold text-rose-300 pt-1 pl-1">已完成 {doneTasks.length}</div>
            )}
            {doneTasks.map(t => (
              <div key={t.id} className="bg-white/55 rounded-2xl p-3 flex items-center gap-3 shadow-sm border border-pink-50">
                <button onClick={() => toggleTask(t.id)} className="text-pink-400 active:scale-90 transition shrink-0"><CheckCircle size={22} weight="fill" /></button>
                <span className="flex-1 text-sm text-slate-400 line-through">{t.title}</span>
                <button onClick={() => deleteTask(t.id)} className="text-slate-300 hover:text-rose-400 active:scale-90 transition shrink-0"><Trash size={15} /></button>
              </div>
            ))}
            {space.tasks.length === 0 && (
              <div className="text-center text-rose-300 text-xs py-8">立个小约定，一起去完成吧 ✅</div>
            )}
          </>
        )}
      </div>

      {/* 悄悄话浮动入口 */}
      <button onClick={() => setShowWhispers(true)}
        className="absolute right-4 bottom-4 z-20 w-12 h-12 rounded-full text-white shadow-lg shadow-pink-300/60 flex items-center justify-center active:scale-90 transition"
        style={{ background: 'linear-gradient(135deg,#f777b0,#c98bff)' }} title="悄悄话信箱">
        <EnvelopeOpen size={22} weight="fill" />
      </button>

      {/* ── 各种弹窗 ── */}
      <ComposeModal open={showCompose} text={composeText} setText={setComposeText} mood={composeMood} setMood={setComposeMood}
        images={composeImages} onPick={() => composeFileRef.current?.click()} onRemoveImage={(i) => setComposeImages(prev => prev.filter((_, idx) => idx !== i))}
        fileRef={composeFileRef} onPickFiles={pickComposeImages} onClose={() => { setShowCompose(false); }} onPost={postUserMoment} />

      <Modal isOpen={showAnnivForm} title="添加纪念日" onClose={() => setShowAnnivForm(false)}
        footer={<><button onClick={() => setShowAnnivForm(false)} className="flex-1 py-3 bg-slate-100 text-slate-500 font-bold rounded-2xl active:scale-95 transition">取消</button>
          <button onClick={addAnniversary} className="flex-1 py-3 bg-pink-400 text-white font-bold rounded-2xl active:scale-95 transition">保存</button></>}>
        <div className="space-y-3">
          <input value={annivTitle} onChange={e => setAnnivTitle(e.target.value)} placeholder="纪念日名称（如 TA 的生日）" className="w-full px-4 py-3 bg-pink-50/60 rounded-xl text-sm outline-none border border-pink-100" />
          <div className="flex items-center gap-2 text-sm">
            <CalendarBlank size={18} className="text-rose-400" />
            <input type="date" value={annivDate} onChange={e => setAnnivDate(e.target.value)} className="flex-1 px-3 py-2.5 bg-pink-50/60 rounded-xl text-sm outline-none border border-pink-100" />
          </div>
          <div className="grid grid-cols-4 gap-2">
            {(['love', 'birthday', 'promise', 'custom'] as CoupleAnniversary['kind'][]).map(k => (
              <button key={k} onClick={() => setAnnivKind(k)} className={`py-2 rounded-xl text-[11px] font-bold border transition ${annivKind === k ? 'bg-pink-400 text-white border-pink-400' : 'bg-white text-slate-500 border-pink-100'}`}>
                {KIND_EMOJI[k]} {KIND_LABEL[k]}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-[13px] text-slate-600 px-1">
            <input type="checkbox" checked={annivRepeat} onChange={e => setAnnivRepeat(e.target.checked)} className="accent-pink-400 w-4 h-4" />
            每年重复（生日 / 周年）
          </label>
        </div>
      </Modal>

      <Modal isOpen={showAnnivDateSet} title="设定在一起纪念日" onClose={() => setShowAnnivDateSet(false)}
        footer={<><button onClick={() => setShowAnnivDateSet(false)} className="flex-1 py-3 bg-slate-100 text-slate-500 font-bold rounded-2xl active:scale-95 transition">取消</button>
          <button onClick={setAnniversaryDate} className="flex-1 py-3 bg-pink-400 text-white font-bold rounded-2xl active:scale-95 transition">保存</button></>}>
        <div className="space-y-2">
          <p className="text-[12px] text-slate-500">从这一天起，自动计算「已相恋多少天」。</p>
          <input type="date" value={annivDateDraft} onChange={e => setAnnivDateDraft(e.target.value)} className="w-full px-4 py-3 bg-pink-50/60 rounded-xl text-sm outline-none border border-pink-100" />
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
              <button onClick={() => deletePhoto(photoView.id)} className="text-rose-300 text-[13px] font-bold flex items-center gap-1"><Trash size={15} /> 删除</button>
            </div>
          </div>
          <button onClick={() => setPhotoView(null)} className="absolute top-5 right-5 w-9 h-9 rounded-full bg-white/20 text-white flex items-center justify-center"><X size={18} weight="bold" /></button>
        </div>
      )}

      {/* 悄悄话信箱 */}
      <Modal isOpen={showWhispers} title="悄悄话信箱 💌" onClose={() => setShowWhispers(false)} footer={<div className="w-full">
        <div className="flex gap-2">
          <input value={whisperInput} onChange={e => setWhisperInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !whisperBusy) sendWhisper(); }}
            placeholder={`给 ${partnerName} 留一句悄悄话…`} className="flex-1 px-4 py-3 bg-pink-50/60 rounded-2xl text-sm outline-none border border-pink-100" />
          <button onClick={sendWhisper} disabled={whisperBusy || !whisperInput.trim()} className="px-4 bg-pink-400 text-white rounded-2xl active:scale-95 transition disabled:opacity-50">
            {whisperBusy ? <ArrowsClockwise size={18} className="animate-spin" /> : <PaperPlaneTilt size={18} weight="fill" />}
          </button>
        </div>
      </div>}>
        <div className="space-y-2.5">
          {space.whispers.length === 0 && <div className="text-center text-rose-300 text-xs py-6">还没有悄悄话，留下第一句心里话吧</div>}
          {[...space.whispers].sort((a, b) => a.at - b.at).map(w => (
            <div key={w.id} className={`flex ${w.author === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[78%] px-3.5 py-2.5 rounded-2xl text-[13px] leading-relaxed ${w.author === 'user' ? 'bg-pink-400 text-white rounded-br-md' : 'bg-pink-50 text-slate-700 rounded-bl-md border border-pink-100'}`}>
                {w.text}
                <div className={`text-[9px] mt-1 ${w.author === 'user' ? 'text-white/70' : 'text-slate-400'}`}>{timeAgo(w.at)}</div>
              </div>
            </div>
          ))}
          {whisperBusy && <div className="text-center text-rose-300 text-[11px]">{partnerName} 正在回信…</div>}
        </div>
      </Modal>

      {/* 设置 */}
      <Modal isOpen={showSettings} title="情侣空间" onClose={() => setShowSettings(false)}>
        <div className="space-y-3">
          <div className="flex items-center gap-3 bg-pink-50/60 rounded-2xl p-3">
            <img src={partnerAvatar} className="w-12 h-12 rounded-full object-cover border-2 border-pink-100" />
            <div className="flex-1 min-w-0">
              <div className="font-bold text-slate-700 text-sm">{partnerName}</div>
              <div className="text-[11px] text-slate-400">{partner.relationship?.label || '你的另一半'} · 亲密度 {Math.round(space.intimacy)}</div>
            </div>
          </div>
          <p className="text-[12px] text-slate-400 leading-relaxed px-1">
            解除绑定不会删除你们的回忆——重新绑定 {partnerName} 时，动态、纪念日、相册都还在。
          </p>
          <button onClick={unbind} className="w-full py-3 bg-rose-50 text-rose-500 font-bold rounded-2xl active:scale-95 transition border border-rose-100">
            解除绑定
          </button>
        </div>
      </Modal>
    </div>
  );
};

// ── 动态卡片 ──
const MomentCard: React.FC<{
  m: CoupleMoment; userName: string; userAvatar: string; partnerName: string; partnerAvatar?: string;
  engaging: boolean; onToggleLike: () => void; onComment: (t: string) => void; onDelete: () => void;
}> = ({ m, userName, userAvatar, partnerName, partnerAvatar, engaging, onToggleLike, onComment, onDelete }) => {
  const [showComment, setShowComment] = useState(false);
  const [draft, setDraft] = useState('');
  const isUser = m.author === 'user';
  const name = isUser ? userName : partnerName;
  const avatar = isUser ? userAvatar : partnerAvatar;
  const likeCount = (m.likedByUser ? 1 : 0) + (m.likedByChar ? 1 : 0);

  const submit = () => { const t = draft.trim(); if (!t) return; onComment(t); setDraft(''); };

  return (
    <div className="bg-white/85 rounded-2xl p-3.5 shadow-sm border border-pink-100">
      <div className="flex items-center gap-2.5 mb-2">
        <img src={avatar} className="w-9 h-9 rounded-full object-cover shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-bold text-slate-700 text-[13px] truncate">{name}{!isUser && <span className="ml-1 text-[10px] text-rose-300 font-normal">TA</span>}</div>
          <div className="text-[10px] text-slate-400">{timeAgo(m.createdAt)}{m.mood ? ` · ${m.mood}` : ''}</div>
        </div>
        {isUser && <button onClick={onDelete} className="text-slate-300 hover:text-rose-400 active:scale-90 transition shrink-0"><Trash size={14} /></button>}
      </div>
      {m.text && <p className="text-[13.5px] text-slate-700 leading-relaxed whitespace-pre-wrap mb-2">{m.text}</p>}
      {m.images && m.images.length > 0 && (
        <div className={`grid gap-1 mb-2 ${m.images.length === 1 ? 'grid-cols-1' : m.images.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
          {m.images.map((src, i) => (
            <div key={i} className={`overflow-hidden rounded-lg bg-pink-50 ${m.images!.length === 1 ? 'max-h-60' : 'aspect-square'}`}>
              <img src={src} className="w-full h-full object-cover" />
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-4 pt-1 border-t border-pink-50">
        <button onClick={onToggleLike} className="flex items-center gap-1 text-[12px] active:scale-90 transition">
          <Heart size={16} weight={m.likedByUser ? 'fill' : 'regular'} className={m.likedByUser ? 'text-rose-400' : 'text-slate-400'} />
          <span className={m.likedByUser ? 'text-rose-400' : 'text-slate-400'}>{likeCount > 0 ? likeCount : '赞'}</span>
        </button>
        <button onClick={() => setShowComment(v => !v)} className="flex items-center gap-1 text-[12px] text-slate-400 active:scale-90 transition">
          <ChatCircleDots size={16} /> <span>{m.comments.length > 0 ? m.comments.length : '评论'}</span>
        </button>
        {m.likedByChar && <span className="text-[10px] text-rose-300 ml-auto">💗 {partnerName} 赞过</span>}
        {engaging && <span className="text-[10px] text-rose-300 ml-auto animate-pulse">{partnerName} 正在看…</span>}
      </div>
      {(m.comments.length > 0 || showComment) && (
        <div className="mt-2 space-y-1.5 bg-pink-50/50 rounded-xl p-2.5">
          {m.comments.map(c => (
            <div key={c.id} className="text-[12px] leading-snug">
              <span className={`font-bold ${c.author === 'user' ? 'text-slate-600' : 'text-rose-400'}`}>{c.author === 'user' ? userName : partnerName}</span>
              <span className="text-slate-600">：{c.text}</span>
            </div>
          ))}
          {showComment && (
            <div className="flex gap-2 pt-1">
              <input value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submit(); }}
                placeholder="说点什么…" className="flex-1 px-3 py-1.5 bg-white rounded-full text-[12px] outline-none border border-pink-100" autoFocus />
              <button onClick={submit} className="text-pink-400 active:scale-90 transition"><PaperPlaneTilt size={18} weight="fill" /></button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── 发布动态弹窗 ──
const ComposeModal: React.FC<{
  open: boolean; text: string; setText: (v: string) => void; mood: string; setMood: (v: string) => void;
  images: string[]; onPick: () => void; onRemoveImage: (i: number) => void;
  fileRef: React.RefObject<HTMLInputElement>; onPickFiles: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClose: () => void; onPost: () => void;
}> = ({ open, text, setText, mood, setMood, images, onPick, onRemoveImage, fileRef, onPickFiles, onClose, onPost }) => (
  <Modal isOpen={open} title="发布情侣动态" onClose={onClose}
    footer={<><button onClick={onClose} className="flex-1 py-3 bg-slate-100 text-slate-500 font-bold rounded-2xl active:scale-95 transition">取消</button>
      <button onClick={onPost} className="flex-1 py-3 bg-pink-400 text-white font-bold rounded-2xl active:scale-95 transition">发布</button></>}>
    <div className="space-y-3">
      <textarea value={text} onChange={e => setText(e.target.value)} placeholder="此刻想对 TA 说点什么…" rows={3}
        className="w-full px-4 py-3 bg-pink-50/60 rounded-xl text-sm outline-none border border-pink-100 resize-none" />
      <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={onPickFiles} />
      <div className="grid grid-cols-4 gap-2">
        {images.map((src, i) => (
          <div key={i} className="relative aspect-square rounded-lg overflow-hidden">
            <img src={src} className="w-full h-full object-cover" />
            <button onClick={() => onRemoveImage(i)} className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/50 text-white flex items-center justify-center"><X size={11} weight="bold" /></button>
          </div>
        ))}
        {images.length < MAX_IMAGES && (
          <button onClick={onPick} className="aspect-square rounded-lg border-2 border-dashed border-pink-200 text-pink-300 flex items-center justify-center active:scale-95 transition"><Camera size={20} /></button>
        )}
      </div>
      <div>
        <div className="text-[11px] font-bold text-rose-300 mb-1.5">心情</div>
        <div className="flex flex-wrap gap-1.5">
          {MOOD_EMOJIS.map(em => (
            <button key={em} onClick={() => setMood(mood === em ? '' : em)} className={`w-8 h-8 rounded-full text-lg flex items-center justify-center transition ${mood === em ? 'bg-pink-100 ring-2 ring-pink-300' : 'bg-pink-50/50'}`}>{em}</button>
          ))}
        </div>
      </div>
    </div>
  </Modal>
);

export default CoupleSpace;
