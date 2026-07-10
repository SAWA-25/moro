/**
 * 歌曲评论区 —— 网易云最有陪伴感的地方，搬进 Moro。
 *
 * 三层声音让你听歌时不再一个人：
 *   1. TA 的乐评：邀请你的角色给这首歌留一条第一人称乐评（落到 char.musicProfile.reviews，
 *      拜访页也能回看）。这是这个评论区和真网易云最不一样、也最戳人的一层。
 *   2. 网易云热评 / 最新评论：真实社区的共鸣（本地「一起写的歌」没有，自动跳过）。
 *   3. 我也说一句：你写下一句话，在场的角色会盖楼回你。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOS } from '../../context/OSContext';
import { musicApi, useMusic, type Song } from '../../context/MusicContext';
import { CharacterProfile, CharMusicProfile, CharMusicReview } from '../../types';
import { resolveAuxApi } from '../../utils/auxApi';
import { buildMusicExternalUrl, shareToExternalMusicApp, type MusicExternalShareItem } from '../../utils/musicExternalShare';
import {
  NeteaseComment, UserComment,
  fetchSongComments, generateCharComment, generateCharReply,
  loadUserComments, addUserComment, addReplyToUserComment, removeUserComment,
  isCommentLiked, toggleCommentLike, fmtCommentTime, fmtLikeCount,
} from '../../utils/musicComments';
import { cleanLyricText } from '../../utils/musicLyricContext';
import { C, Sparkle, MizuHeader, BokehBg, isMusicAvatarImage } from './MusicUI';
import { Heart, PaperPlaneRight, ChatCircleText, MusicNote, Trash, PenNib, ShareNetwork } from '@phosphor-icons/react';

type MusicCommentShareDraft = Omit<MusicExternalShareItem, 'kind'> & { kind: 'comment' };
type MusicCommentUserRef = { userId: string | number; nickname?: string; avatarUrl?: string; source?: 'netease' | 'qq' };

interface Props {
  onBack: () => void;
  onShareComment?: (draft: MusicCommentShareDraft) => void;
  onShareExternal?: (item: MusicExternalShareItem) => void;
  onOpenUserProfile?: (user: MusicCommentUserRef) => void;
}

/* ── 小头像：emoji / url / data: 三种都兼容 ── */
const Avatar: React.FC<{ avatar?: string; name: string; size?: number; ring?: string }> = ({
  avatar, name, size = 34, ring = C.faint,
}) => {
  const isImg = isMusicAvatarImage(avatar);
  if (isImg) {
    return <img src={avatar} alt="" className="rounded-full object-cover shrink-0"
      style={{ width: size, height: size, border: `1.5px solid ${ring}66` }} />;
  }
  return (
    <div className="rounded-full flex items-center justify-center shrink-0 text-white font-medium"
      style={{
        width: size, height: size, fontSize: Math.round(size * 0.42),
        background: `linear-gradient(135deg, ${C.sakura}, ${C.lavender})`,
        border: `1.5px solid ${ring}66`,
      }}>
      {avatar && avatar.length <= 4 ? avatar : (name || '·').slice(0, 1)}
    </div>
  );
};

/* ── 一颗可点的心 + 数字（本地点赞，纯陪伴向小互动） ── */
const LikeHeart: React.FC<{ likeKey: string; baseCount: number }> = ({ likeKey, baseCount }) => {
  const [liked, setLiked] = useState(() => isCommentLiked(likeKey));
  const count = baseCount + (liked ? 1 : 0);
  return (
    <button
      onClick={() => setLiked(toggleCommentLike(likeKey))}
      className="flex items-center gap-1 shrink-0 transition-transform active:scale-90"
      style={{ color: liked ? C.sakura : C.faint }}
      title={liked ? '取消赞' : '赞'}
    >
      <Heart size={13} weight={liked ? 'fill' : 'regular'} />
      {count > 0 && <span className="text-[10px] tabular-nums">{fmtLikeCount(count)}</span>}
    </button>
  );
};

/* ── 区块小标题 ── */
const SectionLabel: React.FC<{ icon?: React.ReactNode; children: React.ReactNode; count?: number }> = ({ icon, children, count }) => (
  <div className="flex items-center gap-2 px-1 mb-2 mt-4">
    {icon}
    <span className="text-[11px] tracking-[0.18em] font-medium" style={{ color: C.text, fontFamily: `'Noto Serif', serif` }}>
      {children}
    </span>
    {typeof count === 'number' && count > 0 && (
      <span className="text-[10px]" style={{ color: C.faint }}>{count}</span>
    )}
    <div className="flex-1 h-px ml-1" style={{ background: `linear-gradient(90deg, ${C.faint}40, transparent)` }} />
  </div>
);

const CommentActions: React.FC<{
  onShareToChat?: () => void;
  onShareExternal: () => void;
}> = ({ onShareToChat, onShareExternal }) => (
  <div className="flex items-center gap-1.5 shrink-0">
    {onShareToChat && (
      <button
        type="button"
        onClick={onShareToChat}
        className="w-6 h-6 rounded-full flex items-center justify-center transition-all active:scale-90"
        style={{ color: C.accent, background: `${C.glow}20`, border: `1px solid ${C.faint}25` }}
        title="分享给角色"
        aria-label="分享给角色"
      >
        <PaperPlaneRight size={11} weight="fill" />
      </button>
    )}
    <button
      type="button"
      onClick={onShareExternal}
      className="w-6 h-6 rounded-full flex items-center justify-center transition-all active:scale-90"
      style={{ color: C.muted, background: 'rgba(255,255,255,0.22)', border: `1px solid ${C.faint}22` }}
      title="分享到外部音乐 App"
      aria-label="分享到外部音乐 App"
    >
      <ShareNetwork size={11} weight="bold" />
    </button>
  </div>
);

const SongCommentsPage: React.FC<Props> = ({ onBack, onShareComment, onShareExternal, onOpenUserProfile }) => {
  const { characters, userProfile, apiConfig, auxApiConfig, updateCharacter, addToast } = useOS();
  // 评论区是「聊天以外」的辅助任务：走副 API（未配置时回退主 API）
  const auxApi = useMemo(() => ({ ...apiConfig, ...resolveAuxApi(auxApiConfig, apiConfig) }), [apiConfig, auxApiConfig]);
  const { current, cfg, lyric, activeLyricIdx, listeningTogetherWith } = useMusic();

  const songId = current?.id ?? null;
  const isLocal = !!current?.local;
  const canSyncNetEase = !!cfg.cookie && current?.source !== 'qq' && !isLocal;
  const lyricSnippet = activeLyricIdx >= 0 && lyric[activeLyricIdx]
    ? cleanLyricText(lyric[activeLyricIdx].text) || undefined
    : undefined;
  const songMeta = current ? { name: current.name, artists: current.artists } : null;
  const [syncToRemote, setSyncToRemote] = useState(false);
  const [syncingRemote, setSyncingRemote] = useState(false);
  const songExternalUrl = useMemo(() => {
    if (!current) return undefined;
    return buildMusicExternalUrl({
      kind: 'song',
      title: current.name,
      song: current,
      source: current.source === 'qq' ? 'qq' : 'netease',
    });
  }, [current]);

  // ── 网易云评论 ──
  const [netease, setNetease] = useState<{ total: number; hot: NeteaseComment[]; latest: NeteaseComment[] } | null>(null);
  const [loadingNetease, setLoadingNetease] = useState(false);
  const [neteaseErr, setNeteaseErr] = useState<string | null>(null);

  // ── 你的留言（本地） ──
  const [userComments, setUserComments] = useState<UserComment[]>([]);
  const [input, setInput] = useState('');
  const [posting, setPosting] = useState(false);

  // ── 角色相关忙碌态 ──
  const [invitingId, setInvitingId] = useState<string | null>(null);   // 正在让哪个角色写乐评
  const [replyingFor, setReplyingFor] = useState<string | null>(null); // 正在为哪条留言生成回复

  const scrollRef = useRef<HTMLDivElement | null>(null);

  // 角色给这首歌写过的乐评（从 musicProfile.reviews 实时聚合，写完即刷新）
  const charReviews = useMemo(() => {
    if (songId == null) return [] as { review: CharMusicReview; char: CharacterProfile }[];
    const sid = String(songId);
    const out: { review: CharMusicReview; char: CharacterProfile }[] = [];
    for (const c of characters) {
      for (const rv of (c.musicProfile?.reviews || [])) {
        if (rv.targetType === 'song' && rv.targetId === sid) out.push({ review: rv, char: c });
      }
    }
    return out.sort((a, b) => b.review.createdAt - a.review.createdAt);
  }, [characters, songId]);

  // 拉网易云评论 + 载入本地留言
  useEffect(() => {
    if (songId == null) return;
    setUserComments(loadUserComments(songId));
    if (isLocal) { setNetease(null); return; }
    let cancelled = false;
    setLoadingNetease(true);
    setNeteaseErr(null);
    fetchSongComments(cfg, songId)
      .then(res => { if (!cancelled) setNetease(res); })
      .catch(e => { if (!cancelled) setNeteaseErr(e?.message || '评论加载失败'); })
      .finally(() => { if (!cancelled) setLoadingNetease(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songId, isLocal]);

  /* ── 邀请角色给这首歌写乐评 ── */
  const inviteChar = useCallback(async (char: CharacterProfile) => {
    if (!current || !songMeta || invitingId) return;
    setInvitingId(char.id);
    try {
      const sid = String(current.id);
      const previous = (char.musicProfile?.reviews || [])
        .filter(r => r.targetType === 'song' && r.targetId === sid)
        .map(r => r.content);
      const content = await generateCharComment({
        char, user: userProfile, api: auxApi, song: songMeta, lyricSnippet, previous,
      });
      const review: CharMusicReview = {
        id: `rv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        targetType: 'song',
        targetId: sid,
        targetTitle: current.name,
        content,
        createdAt: Date.now(),
      };
      const base: CharMusicProfile = char.musicProfile ?? {
        bio: '', genreTags: [], signatureArtists: [], playlists: [],
        likedSongIds: [], recentPlays: [], reviews: [], canReadUserMusic: true,
        updatedAt: Date.now(),
      };
      await updateCharacter(char.id, {
        musicProfile: { ...base, reviews: [...(base.reviews || []), review], updatedAt: Date.now() },
      });
      addToast(`${char.name} 留下了一条乐评`, 'success');
    } catch (e: any) {
      addToast(`${char.name} 没接上：${e?.message || '失败'}`, 'error');
    } finally {
      setInvitingId(null);
    }
  }, [current, songMeta, invitingId, userProfile, auxApi, lyricSnippet, updateCharacter, addToast]);

  /* ── 让某个角色回复你的某条留言 ── */
  const requestReply = useCallback(async (comment: UserComment, char: CharacterProfile) => {
    if (!songId || !songMeta || replyingFor) return;
    setReplyingFor(comment.id);
    try {
      const text = await generateCharReply({
        char, user: userProfile, api: auxApi, song: songMeta, userComment: comment.text, lyricSnippet,
      });
      const reply = { charId: char.id, charName: char.name, charAvatar: char.avatar, text, at: Date.now() };
      addReplyToUserComment(songId, comment.id, reply);
      setUserComments(loadUserComments(songId));
    } catch (e: any) {
      addToast(`${char.name} 没接上：${e?.message || '失败'}`, 'error');
    } finally {
      setReplyingFor(null);
    }
  }, [songId, songMeta, replyingFor, userProfile, auxApi, lyricSnippet, addToast]);

  /* ── 发一条你的留言；若正一起听，在场的 TA 自动接话 ── */
  useEffect(() => {
    setSyncToRemote(false);
  }, [songId]);

  const buildCommentShareItem = useCallback((input: {
    subtitle?: string;
    text?: string;
    id?: string | number;
  }): MusicCommentShareDraft | null => {
    if (!current) return null;
    const source = current.source === 'qq' ? 'qq' : 'netease';
    return {
      kind: 'comment',
      title: current.name,
      subtitle: input.subtitle,
      text: input.text,
      image: current.albumPic,
      url: songExternalUrl,
      song: current,
      id: input.id,
      source,
    };
  }, [current, songExternalUrl]);

  const shareCommentToChat = useCallback((input: {
    subtitle?: string;
    text?: string;
    id?: string | number;
  }) => {
    const item = buildCommentShareItem(input);
    if (!item) return;
    onShareComment?.(item);
  }, [buildCommentShareItem, onShareComment]);

  const shareCommentExternal = useCallback(async (input: {
    subtitle?: string;
    text?: string;
    id?: string | number;
  }) => {
    const item = buildCommentShareItem(input);
    if (!item) return;
    try {
      if (onShareExternal) {
        await Promise.resolve(onShareExternal(item));
      } else {
        await shareToExternalMusicApp(item);
        addToast('已打开外部音乐分享', 'success');
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') addToast(`外部分享失败：${err?.message || err}`, 'error');
    }
  }, [addToast, buildCommentShareItem, onShareExternal]);

  const postComment = useCallback(async () => {
    const text = input.trim();
    if (!text || songId == null || posting) return;
    setPosting(true);
    let synced = false;
    if (syncToRemote) {
      setSyncingRemote(true);
      if (canSyncNetEase) {
        try {
          await musicApi.postComment(cfg, songId, text);
          synced = true;
        } catch (e: any) {
          addToast(`网易云同步失败，已保存在 Moro：${e?.message || '未知错误'}`, 'error');
        }
      } else if (current?.source === 'qq') {
        addToast('QQ 音乐暂不支持评论同步，已保存在 Moro', 'info');
      } else if (isLocal) {
        addToast('本地歌曲只能保存在 Moro 评论区', 'info');
      } else {
        addToast('先登录网易云，才能同步到外部评论区；这条已保存在 Moro', 'info');
      }
      setSyncingRemote(false);
    }
    const comment = addUserComment(songId, text);
    setInput('');
    setUserComments(loadUserComments(songId));
    setPosting(false);
    if (synced) addToast('已同步到网易云评论区', 'success');
    // 正在「一起听」的角色自动盖楼回你（自然、不用手动点）
    const companionId = listeningTogetherWith[0];
    const companion = companionId ? characters.find(c => c.id === companionId) : null;
    if (companion) requestReply(comment, companion);
  }, [addToast, canSyncNetEase, cfg, characters, current?.source, input, isLocal, listeningTogetherWith, posting, requestReply, songId, syncToRemote]);

  const deleteComment = useCallback((id: string) => {
    if (songId == null) return;
    if (typeof window !== 'undefined' && !window.confirm('删掉这条留言？')) return;
    removeUserComment(songId, id);
    setUserComments(loadUserComments(songId));
  }, [songId]);

  if (!current || songId == null) {
    return (
      <div className="flex flex-col h-full relative" style={{ background: C.bg }}>
        <MizuHeader title="评论" onBack={onBack} />
        <div className="flex-1 flex items-center justify-center text-sm" style={{ color: C.muted }}>
          先放一首歌，再来看评论吧。
        </div>
      </div>
    );
  }

  // 推荐谁来接话：优先正在一起听的角色，其次给这首写过乐评的角色，最后全部角色
  const replyCandidates: CharacterProfile[] = (() => {
    const ordered: CharacterProfile[] = [];
    const push = (c?: CharacterProfile) => { if (c && !ordered.find(x => x.id === c.id)) ordered.push(c); };
    listeningTogetherWith.forEach(id => push(characters.find(c => c.id === id)));
    charReviews.forEach(({ char }) => push(char));
    characters.forEach(push);
    return ordered.slice(0, 8);
  })();

  const totalLabel = netease?.total ? fmtLikeCount(netease.total) : '';

  return (
    <div className="flex flex-col h-full relative"
      style={{ background: `linear-gradient(180deg, #ffffff 0%, ${C.bg} 55%, ${C.bgDeep} 100%)` }}>
      <BokehBg />
      <MizuHeader title={`评论${totalLabel ? ` · ${totalLabel}` : ''}`} onBack={onBack} />

      {/* 正在听条 — 评论区始终知道你在听哪首 */}
      <div className="relative z-10 mx-3 mt-2 px-3 py-2 rounded-2xl shizuku-glass-strong flex items-center gap-3"
        style={{ boxShadow: `0 3px 16px ${C.glow}18` }}>
        {current.albumPic ? (
          <img src={current.albumPic} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0"
            style={{ border: `1px solid ${C.accent}40` }} />
        ) : (
          <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: `linear-gradient(135deg, ${C.primary}, ${C.accent})` }}>
            <MusicNote size={16} weight="fill" color="#fff" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium truncate" style={{ color: C.text }}>{current.name}</div>
          <div className="text-[10px] truncate" style={{ color: C.muted }}>{current.artists}</div>
        </div>
        {isLocal && (
          <span className="text-[8px] px-1.5 py-[1px] rounded-full font-bold shrink-0"
            style={{ background: `linear-gradient(135deg, ${C.sakura}, ${C.lavender})`, color: 'white', letterSpacing: '0.1em' }}>
            OURS
          </span>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 pb-28 relative z-10 shizuku-scrollbar">
        {/* ════ TA 的乐评（角色） ════ */}
        <SectionLabel icon={<Sparkle size={9} color={C.sakura} delay={0} />} count={charReviews.length}>
          TA 的乐评
        </SectionLabel>

        {/* 邀请角色写乐评 — 横向头像条 */}
        {characters.length > 0 && (
          <div className="flex items-center gap-3 overflow-x-auto pb-2 px-1 shizuku-scrollbar">
            {characters.map(ch => {
              const busy = invitingId === ch.id;
              return (
                <button key={ch.id} onClick={() => inviteChar(ch)} disabled={!!invitingId}
                  className="shrink-0 flex flex-col items-center gap-1 active:scale-95 transition-transform disabled:opacity-50"
                  title={`让 ${ch.name} 写一条乐评`}>
                  <div className="relative">
                    <Avatar avatar={ch.avatar} name={ch.name} size={42} ring={C.sakura} />
                    <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full flex items-center justify-center"
                      style={{ background: C.bg, border: `1px solid ${C.sakura}66` }}>
                      {busy
                        ? <span className="w-2 h-2 border-[1.5px] border-t-transparent rounded-full animate-spin" style={{ borderColor: C.sakura, borderTopColor: 'transparent' }} />
                        : <PenNib size={9} weight="fill" color={C.sakura} />}
                    </span>
                  </div>
                  <span className="text-[9px] max-w-[48px] truncate" style={{ color: C.muted }}>{ch.name}</span>
                </button>
              );
            })}
          </div>
        )}
        <div className="text-[9.5px] italic px-1 mb-1" style={{ color: C.faint }}>
          点头像，让 TA 在这首歌下留一句只对你说的话
        </div>

        {/* 角色乐评列表 */}
        {charReviews.length === 0 ? (
          <div className="text-center text-[11px] italic py-4" style={{ color: C.faint }}>
            还没有人在这首歌下留言——邀请上面的 TA 写一条？
          </div>
        ) : (
          <div className="space-y-3 mt-1">
            {charReviews.map(({ review, char }) => (
              <div key={review.id} className="flex items-start gap-2.5">
                <Avatar avatar={char.avatar} name={char.name} size={34} ring={C.sakura} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-medium" style={{ color: C.primary }}>{char.name}</span>
                    <span className="text-[8px] px-1 py-[0.5px] rounded-full"
                      style={{ background: `${C.sakura}22`, color: C.primary, border: `1px solid ${C.sakura}40` }}>
                      乐评
                    </span>
                  </div>
                  <div className="text-[12.5px] leading-relaxed mt-1" style={{ color: C.text, fontFamily: `'Noto Serif', serif` }}>
                    {review.content}
                  </div>
                  <div className="flex items-center justify-between mt-1.5">
                    <span className="text-[9px]" style={{ color: C.faint }}>{fmtCommentTime(review.createdAt)}</span>
                    <div className="flex items-center gap-1.5">
                      <CommentActions
                        onShareToChat={onShareComment ? () => shareCommentToChat({
                          subtitle: `${char.name} 的乐评`,
                          text: review.content,
                          id: review.id,
                        }) : undefined}
                        onShareExternal={() => void shareCommentExternal({
                          subtitle: `${char.name} 的乐评`,
                          text: review.content,
                          id: review.id,
                        })}
                      />
                      <LikeHeart likeKey={`char:${review.id}`} baseCount={0} />
                    </div>
                  </div>
                  <div className="mt-2 h-px" style={{ background: `${C.faint}22` }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ════ 你的留言 ════ */}
        {userComments.length > 0 && (
          <>
            <SectionLabel icon={<ChatCircleText size={11} weight="duotone" color={C.primary} />} count={userComments.length}>
              我说的话
            </SectionLabel>
            <div className="space-y-3">
              {userComments.map(uc => (
                <div key={uc.id} className="flex items-start gap-2.5">
                  <Avatar avatar={userProfile?.avatar} name={userProfile?.name || '你'} size={34} ring={C.glow} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-medium" style={{ color: C.primary }}>{userProfile?.name || '你'}</span>
                    </div>
                    <div className="text-[12.5px] leading-relaxed mt-1" style={{ color: C.text }}>{uc.text}</div>
                    <div className="flex items-center justify-between mt-1.5">
                      <span className="text-[9px]" style={{ color: C.faint }}>{fmtCommentTime(uc.at)}</span>
                      <div className="flex items-center gap-1.5">
                        <CommentActions
                          onShareToChat={onShareComment ? () => shareCommentToChat({
                            subtitle: `${userProfile?.name || '我'} 的评论`,
                            text: uc.text,
                            id: uc.id,
                          }) : undefined}
                          onShareExternal={() => void shareCommentExternal({
                            subtitle: `${userProfile?.name || '我'} 的评论`,
                            text: uc.text,
                            id: uc.id,
                          })}
                        />
                        <button onClick={() => deleteComment(uc.id)} className="shrink-0 opacity-50 active:scale-90 transition-transform" style={{ color: C.faint }} title="删除">
                          <Trash size={12} />
                        </button>
                      </div>
                    </div>

                    {/* 角色盖楼回复 */}
                    {uc.replies.length > 0 && (
                      <div className="mt-2 pl-2.5 space-y-2" style={{ borderLeft: `2px solid ${C.sakura}33` }}>
                        {uc.replies.map((rp, i) => (
                          <div key={i} className="flex items-start gap-2">
                            <Avatar avatar={rp.charAvatar} name={rp.charName} size={22} ring={C.sakura} />
                            <div className="flex-1 min-w-0">
                              <span className="text-[10px] font-medium" style={{ color: C.primary }}>{rp.charName}</span>
                              <span className="text-[11.5px] leading-relaxed ml-1.5" style={{ color: C.text }}>{rp.text}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* 邀请角色接话 */}
                    {replyingFor === uc.id ? (
                      <div className="mt-2 flex items-center gap-1.5 text-[10px]" style={{ color: C.muted }}>
                        <span className="w-2.5 h-2.5 border-[1.5px] rounded-full animate-spin" style={{ borderColor: `${C.sakura}66`, borderTopColor: 'transparent' }} />
                        TA 正在回你…
                      </div>
                    ) : (
                      replyCandidates.length > 0 && (
                        <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                          <span className="text-[9px]" style={{ color: C.faint }}>谁来接话</span>
                          {replyCandidates.map(ch => (
                            <button key={ch.id} onClick={() => requestReply(uc, ch)} disabled={!!replyingFor}
                              className="flex items-center gap-1 pl-0.5 pr-2 py-0.5 rounded-full transition-all active:scale-95 disabled:opacity-50"
                              style={{ background: `${C.sakura}14`, border: `1px solid ${C.sakura}33` }}>
                              <Avatar avatar={ch.avatar} name={ch.name} size={16} ring={C.sakura} />
                              <span className="text-[9px]" style={{ color: C.primary }}>{ch.name}</span>
                            </button>
                          ))}
                        </div>
                      )
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ════ 网易云评论 ════ */}
        {isLocal ? (
          <div className="text-center text-[11px] italic mt-8 mb-2 px-6 leading-relaxed" style={{ color: C.faint }}>
            这是你们一起写的歌，云村里搜不到它——
            <br />只有这里的人，听得到。
          </div>
        ) : (
          <>
            {loadingNetease && (
              <div className="text-center text-[10px] mt-6" style={{ color: C.faint }}>
                <span className="inline-block w-3 h-3 border-2 rounded-full animate-spin align-middle"
                  style={{ borderColor: `${C.faint}40`, borderTopColor: C.primary }} />
                <span className="ml-2">正在翻评论区…</span>
              </div>
            )}
            {neteaseErr && !loadingNetease && (
              <div className="text-center text-[10px] mt-6" style={{ color: C.muted }}>
                评论没加载出来（{neteaseErr}）。登录网易云后更稳。
              </div>
            )}

            {netease && netease.hot.length > 0 && (
              <>
                <SectionLabel icon={<Sparkle size={9} color={C.glow} delay={0.3} />}>精彩评论</SectionLabel>
                <div className="space-y-3.5">
                  {netease.hot.map(c => (
                    <NeteaseRow
                      key={`h-${c.id}`}
                      c={c}
                      onShareToChat={onShareComment ? () => shareCommentToChat({ subtitle: `${c.nickname} 的评论`, text: c.content, id: c.id }) : undefined}
                      onShareExternal={() => void shareCommentExternal({ subtitle: `${c.nickname} 的评论`, text: c.content, id: c.id })}
                      onOpenUserProfile={onOpenUserProfile}
                    />
                  ))}
                </div>
              </>
            )}

            {netease && netease.latest.length > 0 && (
              <>
                <SectionLabel>最新评论</SectionLabel>
                <div className="space-y-3.5">
                  {netease.latest.map(c => (
                    <NeteaseRow
                      key={`l-${c.id}`}
                      c={c}
                      onShareToChat={onShareComment ? () => shareCommentToChat({ subtitle: `${c.nickname} 的评论`, text: c.content, id: c.id }) : undefined}
                      onShareExternal={() => void shareCommentExternal({ subtitle: `${c.nickname} 的评论`, text: c.content, id: c.id })}
                      onOpenUserProfile={onOpenUserProfile}
                    />
                  ))}
                </div>
              </>
            )}

            {netease && netease.hot.length === 0 && netease.latest.length === 0 && !loadingNetease && (
              <div className="text-center text-[11px] italic mt-8" style={{ color: C.faint }}>
                这首歌还没有评论，做第一个留言的人吧。
              </div>
            )}
          </>
        )}

        <div className="h-2" />
      </div>

      {/* 输入条 — 我也说一句 */}
      <div className="relative z-10 px-3 py-2.5 shizuku-glass-strong flex flex-col gap-2"
        style={{ borderTop: `1px solid rgba(255,255,255,0.3)` }}>
        <div className="flex items-center gap-2">
          <Avatar avatar={userProfile?.avatar} name={userProfile?.name || '你'} size={28} ring={C.glow} />
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') postComment(); }}
            placeholder="听到这里，想说点什么…"
            className="flex-1 bg-transparent outline-none text-sm px-1"
            style={{ color: C.text }}
          />
          <button onClick={postComment} disabled={!input.trim() || posting || syncingRemote}
            className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-all active:scale-90 disabled:opacity-40"
            style={{ background: `linear-gradient(135deg, ${C.primary}, ${C.accent})`, boxShadow: `0 2px 10px ${C.primary}30` }}>
            <PaperPlaneRight size={16} weight="fill" color="#fff" />
          </button>
        </div>
        <div className="flex items-center justify-between gap-2 text-[10px] px-1">
          <button
            type="button"
            onClick={() => setSyncToRemote(v => !v)}
            className="inline-flex items-center gap-2"
            style={{ color: syncToRemote ? C.primary : C.faint }}
          >
            <span
              className="w-4 h-4 rounded-full border flex items-center justify-center"
              style={{ borderColor: syncToRemote ? C.primary : C.faint, background: syncToRemote ? `${C.primary}20` : 'transparent' }}
            >
              {syncToRemote && <span className="w-2 h-2 rounded-full" style={{ background: C.primary }} />}
            </span>
            {current?.source === 'qq'
              ? '同步到 QQ 音乐'
              : canSyncNetEase
                ? '同步到网易云'
                : '仅保存在 Moro'}
          </button>
          <span style={{ color: C.faint }}>
            {syncToRemote
              ? (current?.source === 'qq'
                ? 'QQ 暂不支持同步评论'
                : canSyncNetEase
                  ? '会先发到外部平台'
                  : '外部同步不可用')
              : '只在 Moro 内显示'}
          </span>
        </div>
      </div>
    </div>
  );
};

/* ── 一条网易云评论 ── */
const NeteaseRow: React.FC<{
  c: NeteaseComment;
  onShareToChat?: () => void;
  onShareExternal: () => void;
  onOpenUserProfile?: (user: MusicCommentUserRef) => void;
}> = ({ c, onShareToChat, onShareExternal, onOpenUserProfile }) => (
  <div className="flex items-start gap-2.5">
    <button
      type="button"
      onClick={() => c.userId && onOpenUserProfile?.({ userId: c.userId, nickname: c.nickname, avatarUrl: c.avatar, source: 'netease' })}
      className="shrink-0"
      title={c.userId ? '打开主页' : c.nickname}
    >
      <Avatar avatar={c.avatar} name={c.nickname} size={32} ring={C.faint} />
    </button>
    <div className="flex-1 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] truncate" style={{ color: C.muted }}>{c.nickname}</span>
        <LikeHeart likeKey={`netease:${c.id}`} baseCount={c.likedCount} />
      </div>
      <div className="text-[12.5px] leading-relaxed mt-0.5" style={{ color: C.text }}>{c.content}</div>
      {c.repliedTo && (
        <div className="mt-1 px-2 py-1 rounded-lg text-[10.5px] leading-snug"
          style={{ background: `${C.faint}18`, color: C.muted }}>
          <span style={{ color: C.muted }}>@{c.repliedTo.nickname}：</span>{c.repliedTo.content}
        </div>
      )}
      <div className="flex items-center justify-between mt-1">
        <span className="text-[9px]" style={{ color: C.faint }}>{fmtCommentTime(c.time)}</span>
        <CommentActions onShareToChat={onShareToChat} onShareExternal={onShareExternal} />
      </div>
      <div className="mt-1.5 h-px" style={{ background: `${C.faint}22` }} />
    </div>
  </div>
);

export default SongCommentsPage;
