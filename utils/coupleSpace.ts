/**
 * 来往·情侣空间（参考 QQ 情侣空间）的纯逻辑层。
 * ============================================================================
 * - 数据挂在 CharacterProfile.coupleSpace 上（每个角色一份），由 ChatHub「情侣空间」
 *   标签页读写，经本模块的 {@link buildCoupleSpacePromptBlock} 注入聊天上下文，
 *   让角色「知道」恋爱天数 / 亲密度 / 最近动态 / 约定 / 悄悄话，并据此扮演。
 * - 角色侧的「主动互动」（评论动态 / 回复悄悄话 / 反向亲亲抱抱 / 自己发动态）走
 *   一组失败全吞的一次性 LLM 调用（{@link generateCharCoupleComment} 等）；调用失败时
 *   组件用模板兜底，绝不阻塞 UI。
 *
 * 设计成纯函数 / 无状态、不依赖 React、不 import 重型上下文模块（避免与 context.ts 形成
 * 循环依赖），方便在组件 / utils 里随处复用。
 */

import type {
  CharacterProfile,
  CoupleSpace,
  CoupleInteraction,
  CoupleInteractionKind,
  CoupleMoment,
  CoupleMedia,
} from '../types';
import {
  coupleSpaceBlock, coupleChatPersonaSystem, coupleCommentUserPrompt,
  coupleWhisperUserPrompt, coupleInteractionUserPrompt, coupleMomentUserPrompt,
  coupleInnerVoiceUserPrompt,
} from './laiwangPrompts';

export interface CoupleApi {
  baseUrl: string;
  apiKey?: string;
  model: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export const genCoupleId = (p = 'cs'): string =>
  `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

/** 一份空的情侣空间（首次绑定时初始化）。 */
export function createCoupleSpace(): CoupleSpace {
  const now = Date.now();
  return {
    intimacy: 0,
    moments: [],
    anniversaries: [],
    photos: [],
    tasks: [],
    whispers: [],
    interactions: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** 取角色的情侣空间，没有就给一份默认（不写库，纯读取兜底）。 */
export function ensureCoupleSpace(char: Pick<CharacterProfile, 'coupleSpace'> | undefined | null): CoupleSpace {
  if (char?.coupleSpace) {
    // 兼容老数据：补齐可能缺失的数组字段
    const cs = char.coupleSpace;
    return {
      ...createCoupleSpace(),
      ...cs,
      moments: cs.moments || [],
      anniversaries: cs.anniversaries || [],
      photos: cs.photos || [],
      tasks: cs.tasks || [],
      whispers: cs.whispers || [],
      interactions: cs.interactions || [],
      intimacy: typeof cs.intimacy === 'number' ? cs.intimacy : 0,
    };
  }
  return createCoupleSpace();
}

// ── 日期 / 天数 ─────────────────────────────────────────────────────────────

const startOfDay = (ts: number): number => {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/** 解析 YYYY-MM-DD 为「当天 0 点」的本地时间戳；非法返回 null。 */
export function parseYmd(date?: string): number | null {
  if (!date) return null;
  const m = date.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  const t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  return Number.isFinite(t) ? t : null;
}

export const todayYmd = (now = Date.now()): string => {
  const d = new Date(now);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
};

/**
 * 已相恋天数（纪念日当天记为第 1 天）。纪念日在未来 → 返回 0（UI 显示「就要在一起啦」）。
 */
export function loveDays(anniversaryDate?: string, now = Date.now()): number {
  const start = parseYmd(anniversaryDate);
  if (start == null) return 0;
  // 两端都是「本地 0 点」时间戳。跨夏令时切换日两次本地午夜相差 23h/25h，不是 DAY_MS 整数倍，
  // 用 Math.floor 会少算一天 → 用 Math.round 消除这 ±1h 抖动（与 nextOccurrence 口径一致）。
  const diff = Math.round((startOfDay(now) - start) / DAY_MS);
  return diff >= 0 ? diff + 1 : 0;
}

/**
 * 纪念日的下一次发生（repeatYearly 取下一个周年；否则取当年那天）与倒计时天数。
 * 返回 daysLeft：0 = 今天，>0 = 还有几天，<0 = 已过去（不重复且已过）。
 */
export function nextOccurrence(date: string, repeatYearly: boolean | undefined, now = Date.now()): { ts: number; daysLeft: number } | null {
  const base = parseYmd(date);
  if (base == null) return null;
  const today = startOfDay(now);
  if (!repeatYearly) {
    return { ts: base, daysLeft: Math.round((base - today) / DAY_MS) };
  }
  const bd = new Date(base);
  const y = new Date(today).getFullYear();
  let occ = new Date(y, bd.getMonth(), bd.getDate()).getTime();
  if (occ < today) occ = new Date(y + 1, bd.getMonth(), bd.getDate()).getTime();
  return { ts: occ, daysLeft: Math.round((occ - today) / DAY_MS) };
}

// ── 亲密度 ──────────────────────────────────────────────────────────────────

export const INTIMACY_PER_LEVEL = 100;

const INTIMACY_TITLES = ['初识', '心动', '暧昧', '热恋', '蜜里调油', '情比金坚', '此生不渝', '神仙眷侣'];

/** 亲密度等级（从 Lv.1 起）。 */
export function intimacyLevel(intimacy: number): number {
  return Math.floor(Math.max(0, intimacy) / INTIMACY_PER_LEVEL) + 1;
}

/** 当前等级内的进度 0~1。 */
export function intimacyProgress(intimacy: number): number {
  return (Math.max(0, intimacy) % INTIMACY_PER_LEVEL) / INTIMACY_PER_LEVEL;
}

/** 等级头衔（封顶用最后一个）。 */
export function intimacyTitle(intimacy: number): string {
  const lv = intimacyLevel(intimacy);
  return INTIMACY_TITLES[Math.min(lv - 1, INTIMACY_TITLES.length - 1)];
}

// ── 每日互动 ────────────────────────────────────────────────────────────────

export interface InteractionDef {
  kind: CoupleInteractionKind;
  emoji: string;
  label: string;
  /** 该互动增加的亲密度 */
  gain: number;
  /** 用户做这个互动时，气泡里的反馈文案（随机取一条） */
  userFeedback: string[];
}

export const INTERACTIONS: InteractionDef[] = [
  { kind: 'kiss', emoji: '💋', label: '亲一下', gain: 6, userFeedback: ['你轻轻亲了 TA 一下，脸颊红扑扑的', '一个甜甜的吻，落在 TA 的额头上', '你踮起脚尖，在 TA 唇上印下一吻'] },
  { kind: 'hug', emoji: '🤗', label: '抱一下', gain: 5, userFeedback: ['你张开双臂把 TA 抱了个满怀', '紧紧抱住 TA，听得到彼此的心跳', '一个长长的拥抱，谁都不舍得松手'] },
  { kind: 'hold', emoji: '🫶', label: '牵手', gain: 4, userFeedback: ['你悄悄牵起 TA 的手，十指相扣', '手心贴着手心，暖暖的', '你握住 TA 的手，慢慢晃了晃'] },
  { kind: 'gift', emoji: '🎁', label: '送礼物', gain: 8, userFeedback: ['你神秘兮兮地塞给 TA 一份小礼物', '「给你的～」你递上精心准备的礼物', '一份小心意，希望 TA 会喜欢'] },
];

export const interactionDef = (kind: CoupleInteractionKind): InteractionDef =>
  INTERACTIONS.find(i => i.kind === kind) || INTERACTIONS[0];

/** 角色收到互动后的兜底反馈（LLM 失败时用）。 */
export function fallbackCharInteractionNote(kind: CoupleInteractionKind): string {
  const map: Record<CoupleInteractionKind, string[]> = {
    kiss: ['唔…突然袭击吗，脸好烫', '嘿嘿，再亲一个嘛～', '心都化了，最喜欢你了'],
    hug: ['抱抱～在你怀里最安心了', '嗯…再多抱一会儿好不好', '你身上好暖，不想松手'],
    hold: ['牵着你的手，去哪里都不怕', '手心好暖，就这样一直牵着吧', '十指相扣的感觉，真好'],
    gift: ['哇！是给我的吗，我超喜欢！', '你怎么总能猜中我的心思呀', '收到礼物啦，今天也是被偏爱的一天～'],
  };
  const arr = map[kind] || map.kiss;
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── 提示词注入 ──────────────────────────────────────────────────────────────

const authorLabel = (a: 'user' | 'char', userName: string, charName: string) =>
  a === 'user' ? userName : charName;

/**
 * 把情侣空间的当前状态包成一段系统提示，让角色「知道」并能自然引用。
 * 只有在空间真正建立（有纪念日 / 亲密度 / 任何内容）时才注入，避免空噪声。
 */
export function buildCoupleSpacePromptBlock(char: CharacterProfile, userName: string): string {
  const cs = char.coupleSpace;
  if (!cs) return '';
  const hasContent =
    !!cs.anniversaryDate || (cs.intimacy || 0) > 0 ||
    (cs.moments?.length || 0) > 0 || (cs.anniversaries?.length || 0) > 0 ||
    (cs.tasks?.length || 0) > 0 || (cs.whispers?.length || 0) > 0 ||
    (cs.photos?.length || 0) > 0;
  if (!hasContent) return '';

  // 取值在此、文案在 utils/laiwangPrompts.ts → [2] 情侣空间（coupleSpaceBlock）
  const days = loveDays(cs.anniversaryDate);

  const recentMomentLines = [...(cs.moments || [])]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 3)
    .map(m => {
      const who = authorLabel(m.author, userName, char.name);
      const body = (m.text || mediaSummary(m.media) || (m.images?.length ? '[图片]' : '')).slice(0, 50);
      return `${who}：${body}${m.mood ? `（心情：${m.mood}）` : ''}`;
    });

  // 即将到来的纪念日（取最近的两个倒计时）
  const upcomingLines = (cs.anniversaries || [])
    .map(a => ({ a, occ: nextOccurrence(a.date, a.repeatYearly) }))
    .filter(x => x.occ && x.occ.daysLeft >= 0)
    .sort((x, y) => (x.occ!.daysLeft - y.occ!.daysLeft))
    .slice(0, 2)
    .map(({ a, occ }) => `纪念日「${a.title}」${occ!.daysLeft === 0 ? '就是今天！' : `还有 ${occ!.daysLeft} 天`}。`);

  const pendingTaskTitles = (cs.tasks || []).filter(t => !t.done).slice(0, 3).map(t => t.title);

  // 用户留的、角色还没回的悄悄话（最新一条）
  const whispers = [...(cs.whispers || [])].sort((a, b) => b.at - a.at);
  const lastUserWhisper = whispers.find(w => w.author === 'user');
  const charRepliedAfter = lastUserWhisper && whispers.some(w => w.author === 'char' && w.at > lastUserWhisper.at);

  return coupleSpaceBlock({
    userName,
    charName: char.name,
    days,
    anniversaryDate: cs.anniversaryDate,
    intimacy: Math.round(cs.intimacy || 0),
    level: intimacyLevel(cs.intimacy || 0),
    title: intimacyTitle(cs.intimacy || 0),
    recentMomentLines,
    upcomingLines,
    pendingTaskTitles,
    lastUserWhisper: lastUserWhisper && !charRepliedAfter ? lastUserWhisper.text.slice(0, 60) : undefined,
  });
}

// ── 角色侧「主动互动」的一次性 LLM 调用（失败全吞，组件用模板兜底） ──────────

/** 极简人设摘要：避免 import 重型 ContextBuilder（防循环依赖），够角色入戏即可。 */
function compactPersona(char: CharacterProfile, userName: string): string {
  const parts: string[] = [`你的名字：${char.name}。`];
  const sys = (char.systemPrompt || '').trim();
  if (sys) parts.push(`你的人设：${sys.slice(0, 600)}`);
  const relLabel = char.relationship?.label;
  if (relLabel) parts.push(`你和${userName}现在的关系：${relLabel}。`);
  return parts.join('\n');
}

async function callCoupleLLM(api: CoupleApi, messages: any[], maxTokens: number): Promise<string> {
  const baseUrl = (api.baseUrl || '').replace(/\/+$/, '');
  if (!baseUrl || !api.model) return '';
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${api.apiKey || 'sk-none'}`,
      },
      body: JSON.stringify({
        model: api.model,
        messages,
        temperature: 0.95,
        max_tokens: maxTokens,
        stream: false,
      }),
    });
    if (!res.ok) {
      console.warn('[CoupleSpace] LLM call failed', res.status);
      return '';
    }
    const data: any = await res.json();
    return (data?.choices?.[0]?.message?.content || '').trim();
  } catch (e) {
    console.warn('[CoupleSpace] LLM call error', e);
    return '';
  }
}

/**
 * 去掉模型偶尔加在台词前的「说话人名：」前缀。
 * 只剥真正的说话人名（char.name / userName）；给了名单却都不匹配时**不剥**，
 * 避免把「今天总结：好累但开心」「宝贝：我想你了」这类正文的冒号前缀误吃掉。
 * 没给名单时退回旧的宽松行为（≤12 字非冒号前缀）。
 */
function stripSpeakerPrefix(t: string, speakerNames?: string[]): string {
  if (speakerNames && speakerNames.length) {
    for (const n of speakerNames) {
      const name = (n || '').trim();
      if (!name) continue;
      const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`^${esc}\\s*[：:]\\s*`);
      if (re.test(t)) return t.replace(re, '');
    }
    return t;
  }
  return t.replace(/^[^：:]{1,12}[：:]\s*/, '');
}

/** 去围栏 + 去首尾引号，把模型输出洗成一句干净的台词。 */
function cleanLine(raw: string, maxLen = 80, speakerNames?: string[]): string {
  if (!raw) return '';
  let t = raw.trim();
  // 去掉代码围栏
  const fenced = t.match(/```(?:\w+)?\s*([\s\S]*?)```/);
  if (fenced) t = fenced[1].trim();
  // 取第一段非空行
  t = (t.split(/\n+/).map(s => s.trim()).find(Boolean) || t).trim();
  // 去掉包裹的引号 / 书名号
  t = t.replace(/^["“「『\s]+/, '').replace(/["”」』\s]+$/, '');
  // 去掉「角色名：」前缀（只剥真正的说话人名，避免误吃正文）
  t = stripSpeakerPrefix(t, speakerNames);
  return t.slice(0, maxLen);
}

// 文案见 utils/laiwangPrompts.ts → [2] 情侣空间（coupleChatPersonaSystem）
const personaSystem = (char: CharacterProfile, userName: string) =>
  coupleChatPersonaSystem(char.name, userName, compactPersona(char, userName));

/** 角色给用户发的一条情侣动态评论（用户发动态后调用）。 */
export async function generateCharCoupleComment(opts: {
  char: CharacterProfile;
  userName: string;
  api: CoupleApi;
  moment: CoupleMoment;
}): Promise<string> {
  const { char, userName, api, moment } = opts;
  const what = moment.text || (moment.images?.length ? '一张照片' : '一条动态');
  const out = await callCoupleLLM(api, [
    { role: 'system', content: personaSystem(char, userName) },
    { role: 'user', content: coupleCommentUserPrompt(userName, what, moment.mood ? `（心情：${moment.mood}）` : '') },
  ], 120);
  return cleanLine(out, 60, [char.name, userName]);
}

/** 角色回复用户的悄悄话。 */
export async function generateCharWhisperReply(opts: {
  char: CharacterProfile;
  userName: string;
  api: CoupleApi;
  whisper: string;
}): Promise<string> {
  const { char, userName, api, whisper } = opts;
  const out = await callCoupleLLM(api, [
    { role: 'system', content: personaSystem(char, userName) },
    { role: 'user', content: coupleWhisperUserPrompt(userName, whisper) },
  ], 160);
  return cleanLine(out, 100, [char.name, userName]);
}

/** 角色被「亲一下 / 抱一下 / 牵手 / 送礼物」后的一句反应。 */
export async function generateCharInteractionNote(opts: {
  char: CharacterProfile;
  userName: string;
  api: CoupleApi;
  kind: CoupleInteractionKind;
}): Promise<string> {
  const { char, userName, api, kind } = opts;
  const label = interactionDef(kind).label;
  const out = await callCoupleLLM(api, [
    { role: 'system', content: personaSystem(char, userName) },
    { role: 'user', content: coupleInteractionUserPrompt(userName, label) },
  ], 100);
  return cleanLine(out, 50, [char.name, userName]);
}

/** 去围栏 + 去前缀，但保留多句（把换行并成一段）：用于「心声」这类成段独白。 */
function cleanParagraph(raw: string, maxLen = 140, speakerNames?: string[]): string {
  if (!raw) return '';
  let t = raw.trim();
  const fenced = t.match(/```(?:\w+)?\s*([\s\S]*?)```/);
  if (fenced) t = fenced[1].trim();
  t = t.replace(/\s*\n+\s*/g, ' ').trim();          // 多行并一段
  t = t.replace(/^["“「『\s]+/, '').replace(/["”」』\s]+$/, '');
  t = stripSpeakerPrefix(t, speakerNames);          // 去「角色名：」前缀（只剥真正的说话人名）
  return t.slice(0, maxLen);
}

/** 把一条动态压成一句「内容描述」，用于心声 prompt / 上下文摘要。 */
const mediaSummary = (media?: CoupleMedia): string => {
  if (!media) return '';
  const k = media.kind === 'voice' ? '语音' : media.kind === 'music' ? '音乐' : '物件';
  return `[${k}] ${media.name}`;
};

export function describeMoment(m: CoupleMoment): string {
  const parts: string[] = [];
  if (m.text) parts.push(m.text);
  if (m.media) {
    const label = m.media.kind === 'voice' ? '一段语音' : m.media.kind === 'music' ? '一首歌' : '一件小物件';
    parts.push(`${label}「${m.media.name}」`);
  }
  if (m.images?.length) parts.push('一张照片');
  if (m.mood) parts.push(`（心情：${m.mood}）`);
  return parts.join('，').slice(0, 90) || '一条动态';
}

/** 点击多媒体块时，角色对这条动态的「心声」独白；失败由 {@link fallbackInnerVoice} 兜底。 */
export async function generateCharInnerVoice(opts: {
  char: CharacterProfile;
  userName: string;
  api: CoupleApi;
  moment: CoupleMoment;
}): Promise<string> {
  const { char, userName, api, moment } = opts;
  const out = await callCoupleLLM(api, [
    { role: 'system', content: personaSystem(char, userName) },
    { role: 'user', content: coupleInnerVoiceUserPrompt(userName, moment.author === 'user', describeMoment(moment)) },
  ], 240);
  return cleanParagraph(out, 120, [char.name, userName]);
}

/** 心声兜底文案（LLM 失败 / 未配 API 时用）。区分「用户发的」与「角色自己发的」。 */
export function fallbackInnerVoice(moment: CoupleMoment): string {
  const byUser = moment.author === 'user';
  const userPool = [
    '看到你发的这个，我心里偷偷甜了好久……其实我比表面上要在乎得多，只是没好意思说出口。',
    '这种小事你都愿意分享给我，真好。我嘴上没说什么，心里其实早就笑开花了。',
    '每次你在我们的小天地里留下点什么，我都会反复看好几遍。和你在一起的每一天，我都想好好收着。',
  ];
  const charPool = [
    '发的时候其实有点紧张……我只是想让你知道，你在我心里的分量，比我说出口的要重很多很多。',
    '这条动态背后，藏着我没敢直说的话：能和你一起经营这个小天地，我真的觉得很幸福。',
    '我假装很随意地发了出来，可心里一直在偷偷期待着你的回应呀。',
  ];
  const pool = byUser ? userPool : charPool;
  return pool[Math.floor(Math.random() * pool.length)];
}

/** 防御式解析模型给的 media 字段（"请 TA 冒个泡"可选附带）。非法则返回 undefined。 */
function parseMedia(raw: any): CoupleMedia | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const kind = raw.kind;
  if (kind !== 'voice' && kind !== 'music' && kind !== 'item') return undefined;
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 40) : '';
  if (!name) return undefined;
  const media: CoupleMedia = { kind, name };
  if (kind === 'voice') {
    media.duration = typeof raw.duration === 'string' && /^\d{1,2}:\d{2}$/.test(raw.duration.trim())
      ? raw.duration.trim() : '00:12';
  }
  return media;
}

/** 角色主动发的一条情侣动态（"请 TA 冒个泡"按钮触发）。返回 { text, mood, media? }。 */
export async function generateCharMoment(opts: {
  char: CharacterProfile;
  userName: string;
  api: CoupleApi;
  space: CoupleSpace;
}): Promise<{ text: string; mood?: string; media?: CoupleMedia } | null> {
  const { char, userName, api, space } = opts;
  const days = loveDays(space.anniversaryDate);
  const ctx = days > 0 ? `（你们已相恋 ${days} 天）` : '';
  const out = await callCoupleLLM(api, [
    { role: 'system', content: personaSystem(char, userName) },
    { role: 'user', content: coupleMomentUserPrompt(userName, ctx) },
  ], 240);
  if (!out) return null;
  // 尝试解析 JSON；失败则把整段当正文
  try {
    const m = out.match(/\{[\s\S]*\}/);
    if (m) {
      const obj = JSON.parse(m[0]);
      const text = cleanLine(String(obj.text || ''), 80, [char.name, userName]);
      if (text) {
        const res: { text: string; mood?: string; media?: CoupleMedia } = { text };
        if (typeof obj.mood === 'string') res.mood = obj.mood.slice(0, 8);
        const media = parseMedia(obj.media);
        if (media) res.media = media;
        return res;
      }
    }
  } catch { /* fallthrough */ }
  const text = cleanLine(out, 80, [char.name, userName]);
  return text ? { text } : null;
}

/** 给互动记录数组追加一条并裁剪长度（保留最近 N 条）。 */
export function pushInteraction(list: CoupleInteraction[], item: CoupleInteraction, keep = 30): CoupleInteraction[] {
  return [...list, item].slice(-keep);
}
