/**
 * 音乐评论区 —— 网易云最有「陪伴感」的地方，搬进 Moro。
 *
 * 三股声音汇在一首歌底下，让你听歌时不再是一个人：
 *   1. 网易云热评 / 最新评论（真实社区，凌晨三点的那种共鸣）—— fetchSongComments
 *   2. 你的角色留下的「乐评」（角色第一人称、贴人设、和你们的关系有关）—— generateCharComment
 *   3. 你自己写的一句话，角色会回你 —— generateCharReply
 *
 * 角色乐评落到 char.musicProfile.reviews（持久、可在拜访页回看）；
 * 你的留言 + 角色的回复落到 localStorage（按 songId 分桶，随时重看）。
 */

import { APIConfig, CharacterProfile, UserProfile } from '../types';
import { MusicCfg, musicApi, toHttps } from '../context/MusicContext';
import { ContextBuilder } from './context';
import { extractContent } from './safeApi';
import { makeApiUsageMeta } from './apiUsageCatalog';
import { callChatCompletion } from './llmClient';

/* ───────────── 类型 ───────────── */

/** 网易云一条评论（盖楼 beReplied 折叠成简短引用）。 */
export interface NeteaseComment {
  id: number;
  nickname: string;
  avatar: string;
  content: string;
  likedCount: number;
  /** 网易云返回的毫秒时间戳 */
  time: number;
  /** 楼中楼：被回复的人和话（只取第一条做引用） */
  repliedTo?: { nickname: string; content: string } | null;
}

export interface SongComments {
  total: number;
  hot: NeteaseComment[];
  latest: NeteaseComment[];
}

/** 你自己写的一句话 + 角色们对它的回复（本地持久）。 */
export interface UserComment {
  id: string;
  text: string;
  at: number;
  replies: {
    charId: string;
    charName: string;
    charAvatar?: string;
    text: string;
    at: number;
  }[];
}

/* ───────────── 网易云评论 ───────────── */

const mapComment = (c: any): NeteaseComment => {
  const replied = Array.isArray(c?.beReplied)
    ? c.beReplied.find((r: any) => r && (r.content || '').trim())
    : null;
  return {
    id: c?.commentId ?? c?.id ?? Math.floor(Math.random() * 1e9),
    nickname: c?.user?.nickname || c?.user?.userName || '云村村民',
    avatar: toHttps(c?.user?.avatarUrl || ''),
    content: (c?.content || '').trim(),
    likedCount: c?.likedCount || 0,
    time: c?.time || 0,
    repliedTo: replied
      ? { nickname: replied.user?.nickname || '某人', content: (replied.content || '').trim() }
      : null,
  };
};

/**
 * 拉某首网易云歌的评论（热评 + 最新）。
 * 本地生成的歌（一起写的歌）没有网易云评论，调用方应跳过（song.local）。
 * 走 worker /netease/comment/music，worker 端缓存 5 分钟。
 */
export async function fetchSongComments(
  cfg: MusicCfg,
  songId: number,
  limit = 30,
): Promise<SongComments> {
  const r = await musicApi.call(cfg, '/comment/music', { id: songId, limit, offset: 0, type: 0 });
  // 经典 /comment/music 是顶层字段；个别 enhanced 版本会套一层 data，两边都兜住。
  const src = r?.hotComments || r?.comments ? r : (r?.data || r || {});
  const hot: NeteaseComment[] = (src?.hotComments || []).map(mapComment).filter((c: NeteaseComment) => c.content);
  const latest: NeteaseComment[] = (src?.comments || []).map(mapComment).filter((c: NeteaseComment) => c.content);
  const total = typeof src?.total === 'number' ? src.total : latest.length;
  return { total, hot, latest };
}

/* ───────────── 角色乐评（LLM） ───────────── */

interface CharCommentInput {
  char: CharacterProfile;
  user: UserProfile;
  api: APIConfig;
  song: { name: string; artists: string };
  /** 当前正在唱的一句词（有就更有画面感） */
  lyricSnippet?: string;
  /** 角色之前在这首歌下说过的话，避免重复 */
  previous?: string[];
}

const callChat = async (
  api: APIConfig,
  prompt: string,
  temperature = 0.92,
  meta: ReturnType<typeof makeApiUsageMeta>,
): Promise<string> => {
  const data = await callChatCompletion(api, {
    model: api.model,
    messages: [{ role: 'user', content: prompt }],
    temperature,
  }, { meta });
  return (extractContent(data) || '').trim();
};

/** 去掉模型常爱加的包裹引号 / markdown / 前缀，留干净的评论正文。 */
const cleanComment = (raw: string): string => {
  let s = (raw || '').trim();
  // 去 fenced code
  s = s.replace(/^```[a-zA-Z]*\s*|\s*```$/g, '').trim();
  // 去最外层成对引号
  s = s.replace(/^["“”'‘’「『]+|["“”'‘’」』]+$/g, '').trim();
  // 去掉「评论：」「乐评：」这类前缀
  s = s.replace(/^(乐评|评论|留言|我的评论|回复)\s*[:：]\s*/i, '').trim();
  // 单行化（评论区是一句话，不要换行成段）
  s = s.replace(/\s*\n+\s*/g, ' ').trim();
  return s.slice(0, 180);
};

const musicTasteLine = (char: CharacterProfile): string => {
  const p = char.musicProfile;
  if (!p) return '';
  const genres = (p.genreTags || []).slice(0, 4).join(' / ');
  const artists = (p.signatureArtists || []).map(a => a.name).slice(0, 4).join('、');
  const bits: string[] = [];
  if (genres) bits.push(`你常听 ${genres}`);
  if (artists) bits.push(`偏爱 ${artists}`);
  return bits.length ? `\n你的音乐口味：${bits.join('；')}。` : '';
};

/**
 * 让角色给当前这首歌留一条「网易云乐评」。返回纯文本评论正文。
 * 失败兜底返回一句通用感想（绝不抛错打断 UI）。
 */
export async function generateCharComment(input: CharCommentInput): Promise<string> {
  const { char, user, api, song, lyricSnippet, previous } = input;
  const fallback = `《${song.name}》——单曲循环到现在，还是舍不得切。`;
  if (!api.baseUrl || !api.apiKey || !api.model) return fallback;
  try {
    const context = await ContextBuilder.buildFullCoreContext(char, user, true);
    const prevLine = (previous && previous.length)
      ? `\n（你之前在这首歌下写过：${previous.slice(-2).map(s => `「${s}」`).join('、')}，这次换个角度，别重复。）`
      : '';
    const prompt = `${context}${musicTasteLine(char)}

### [网易云乐评]
你在网易云音乐《${song.name}》— ${song.artists} 的评论区，想留下一条乐评。${lyricSnippet ? `\n此刻正唱到：「${lyricSnippet}」` : ''}${prevLine}

### [怎么写]
以「${char.name}」第一人称，写得像真的网易云热评那样——
- 真诚、有具体画面或瞬间，可以带一点情绪、回忆、或对${user.name || '对方'}说的悄悄话
- 和这首歌的气质、你此刻的心境、你和${user.name || '对方'}的关系自然挂钩（别硬套）
- 口语，1~2 句，短而有余味；不要书面腔、不要列举、不要解释自己在干嘛
只输出评论正文本身，不要引号、不要 markdown、不要任何前后缀。`;
    const out = cleanComment(await callChat(api, prompt, 0.92, makeApiUsageMeta('music.comment', {
      apiRole: 'aux',
      charId: char.id,
      charName: char.name,
    })));
    return out || fallback;
  } catch {
    return fallback;
  }
}

/* ───────────── 角色回复你的留言（LLM） ───────────── */

interface CharReplyInput {
  char: CharacterProfile;
  user: UserProfile;
  api: APIConfig;
  song: { name: string; artists: string };
  userComment: string;
  lyricSnippet?: string;
}

/** 角色回复你刚在评论区写下的一句话。返回纯文本。 */
export async function generateCharReply(input: CharReplyInput): Promise<string> {
  const { char, user, api, song, userComment, lyricSnippet } = input;
  const fallback = '嗯，我也是这么觉得的。';
  if (!api.baseUrl || !api.apiKey || !api.model) return fallback;
  try {
    const context = await ContextBuilder.buildFullCoreContext(char, user, true);
    const prompt = `${context}${musicTasteLine(char)}

### [评论区回复]
你和 ${user.name || '对方'} 都在听《${song.name}》— ${song.artists}。${lyricSnippet ? `\n此刻正唱到：「${lyricSnippet}」` : ''}
${user.name || '对方'} 在这首歌的评论区写了：「${userComment}」

### [Task]
以「${char.name}」第一人称回 TA 一句——接住 TA 的情绪/想法，像在同一条评论串里盖楼那样自然。贴你的人设和你们的关系，口语，1~2 句，别太长。
只输出你要说的话，不要引号、不要前后缀。`;
    const out = cleanComment(await callChat(api, prompt, 0.92, makeApiUsageMeta('music.commentReply', {
      apiRole: 'aux',
      charId: char.id,
      charName: char.name,
    })));
    return out || fallback;
  } catch {
    return fallback;
  }
}

/* ───────────── 本地留言存储（你的评论 + 角色回复） ───────────── */

const LS_USER_COMMENTS = 'moro_music_user_comments_v1';

type UserCommentStore = Record<string, UserComment[]>;

const loadStore = (): UserCommentStore => {
  try {
    const raw = localStorage.getItem(LS_USER_COMMENTS);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
};

const saveStore = (store: UserCommentStore) => {
  try { localStorage.setItem(LS_USER_COMMENTS, JSON.stringify(store)); } catch {}
};

/** 读某首歌下你写过的留言（新→旧）。 */
export const loadUserComments = (songId: number): UserComment[] => {
  const list = loadStore()[String(songId)] || [];
  return [...list].sort((a, b) => b.at - a.at);
};

/** 写一条你的留言，返回它的新 id。 */
export const addUserComment = (songId: number, text: string): UserComment => {
  const store = loadStore();
  const key = String(songId);
  const comment: UserComment = { id: `uc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, text, at: Date.now(), replies: [] };
  store[key] = [...(store[key] || []), comment];
  saveStore(store);
  return comment;
};

/** 给某条留言挂一条角色回复。 */
export const addReplyToUserComment = (
  songId: number,
  commentId: string,
  reply: UserComment['replies'][number],
): void => {
  const store = loadStore();
  const key = String(songId);
  const list = store[key] || [];
  const idx = list.findIndex(c => c.id === commentId);
  if (idx < 0) return;
  list[idx] = { ...list[idx], replies: [...list[idx].replies, reply] };
  store[key] = list;
  saveStore(store);
};

/** 删一条你的留言。 */
export const removeUserComment = (songId: number, commentId: string): void => {
  const store = loadStore();
  const key = String(songId);
  store[key] = (store[key] || []).filter(c => c.id !== commentId);
  saveStore(store);
};

/* ───────────── 评论点赞（本地，纯陪伴向的小互动） ───────────── */

const LS_COMMENT_LIKES = 'moro_music_comment_likes_v1';

const loadLikes = (): Set<string> => {
  try {
    const raw = localStorage.getItem(LS_COMMENT_LIKES);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch { return new Set(); }
};

const saveLikes = (set: Set<string>) => {
  try { localStorage.setItem(LS_COMMENT_LIKES, JSON.stringify([...set])); } catch {}
};

/** 是否点过赞（key 形如 'netease:123' / 'char:reviewId'）。 */
export const isCommentLiked = (key: string): boolean => loadLikes().has(key);

/** 切换点赞，返回切换后的状态。 */
export const toggleCommentLike = (key: string): boolean => {
  const set = loadLikes();
  let liked: boolean;
  if (set.has(key)) { set.delete(key); liked = false; }
  else { set.add(key); liked = true; }
  saveLikes(set);
  return liked;
};

/* ───────────── 时间格式化 ───────────── */

/** 网易云式相对时间：刚刚 / x分钟前 / x小时前 / 昨天 / mm-dd / yyyy-mm-dd。 */
export const fmtCommentTime = (ms: number): string => {
  if (!ms) return '';
  const now = Date.now();
  const diff = now - ms;
  if (diff < 60 * 1000) return '刚刚';
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / (60 * 1000))}分钟前`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / (60 * 60 * 1000))}小时前`;
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  if (diff < 48 * 60 * 60 * 1000) return '昨天';
  return sameYear ? `${mm}-${dd}` : `${d.getFullYear()}-${mm}-${dd}`;
};

/** 把大数字点赞数缩成 1.2万 这种。 */
export const fmtLikeCount = (n: number): string => {
  if (n < 10000) return String(n);
  return `${(n / 10000).toFixed(n % 10000 === 0 ? 0 : 1)}万`;
};
