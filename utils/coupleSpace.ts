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
  CoupleMemoryCard,
  CoupleRecap,
  CoupleTask,
  CoupleWish,
  CoupleQuestion,
  CoupleWhisper,
  CoupleEyesCard,
  CoupleEyesEra,
  Message,
} from '../types';
import {
  coupleSpaceBlock, coupleChatPersonaSystem, coupleCommentUserPrompt,
  coupleWhisperUserPrompt, coupleInteractionUserPrompt, coupleMomentUserPrompt,
  coupleInnerVoiceUserPrompt, coupleQuestionUserPrompt, coupleCompatPrompt,
  coupleAutoCareUserPrompt, coupleRecapUserPrompt, coupleEyesCardUserPrompt,
} from './laiwangPrompts';
import { llmComplete, type ChatMsg } from './llmComplete';
import { makeApiUsageMeta } from './apiUsageCatalog';
import { DB } from './db';
import { formatMessageWithTime } from './messageFormat';
import { buildFullCharacterSetting } from './characterPromptProfile';

export interface CoupleApi {
  baseUrl: string;
  apiKey?: string;
  model: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export const genCoupleId = (p = 'cs'): string =>
  `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

export const COUPLE_EYES_BODY_MAX = 1200;

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
    wishes: [],
    questions: [],
    settings: { theme: 'clean' },
    profile: { rituals: [] },
    memoryCards: [],
    recaps: [],
    dailyCheckins: [],
    autoCare: {},
    eyesCards: [],
    interactions: [],
    createdAt: now,
    updatedAt: now,
  };
}

const normalizeQuestion = (q: CoupleQuestion): CoupleQuestion => {
  const answer = typeof q.answer === 'string' ? q.answer : '';
  const status = q.status || (answer ? 'answered' : 'pending');
  return {
    ...q,
    answer,
    status,
    visibility: q.visibility === 'named' ? 'named' : 'anonymous',
    source: q.source === 'whisperInbox' ? 'whisperInbox' : 'questionBox',
    answeredAt: q.answeredAt || (status === 'answered' && q.at ? q.at : undefined),
    pinned: !!q.pinned,
  };
};

const normalizeWhisper = (w: CoupleWhisper): CoupleWhisper => ({
  ...w,
  pinned: !!w.pinned,
  readAt: typeof w.readAt === 'number' ? w.readAt : undefined,
});

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
      whispers: (cs.whispers || []).map(normalizeWhisper),
      wishes: cs.wishes || [],
      questions: (cs.questions || []).map(normalizeQuestion),
      settings: { ...(cs.settings || {}), theme: 'clean' },
      profile: { ...(cs.profile || {}), rituals: cs.profile?.rituals || [] },
      memoryCards: cs.memoryCards || [],
      recaps: cs.recaps || [],
      dailyCheckins: cs.dailyCheckins || [],
      autoCare: cs.autoCare || {},
      eyesCards: cs.eyesCards || [],
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

// ── 养盆栽 ──────────────────────────────────────────────────────────────────

export interface PlantStage { emoji: string; name: string; min: number; }

/** 盆栽成长阶段（按累计成长值递增）。 */
export const PLANT_STAGES: PlantStage[] = [
  { emoji: '🌰', name: '种子', min: 0 },
  { emoji: '🌱', name: '发芽', min: 10 },
  { emoji: '🌿', name: '幼苗', min: 30 },
  { emoji: '🪴', name: '成株', min: 60 },
  { emoji: '🌷', name: '花苞', min: 100 },
  { emoji: '🌸', name: '绽放', min: 160 },
];

/** 每日照料动作的成长加成。 */
export const PLANT_CARE: Record<'water' | 'fertilize' | 'sun', { emoji: string; label: string; gain: number }> = {
  water: { emoji: '💧', label: '浇水', gain: 3 },
  fertilize: { emoji: '🌾', label: '施肥', gain: 5 },
  sun: { emoji: '☀️', label: '晒太阳', gain: 2 },
};

/** 由成长值算出当前阶段 + 到下一阶段的进度。 */
export function plantStage(growth: number): { stage: PlantStage; index: number; next?: PlantStage; toNext: number; progress: number } {
  const g = Math.max(0, growth || 0);
  let i = 0;
  for (let k = 0; k < PLANT_STAGES.length; k++) if (g >= PLANT_STAGES[k].min) i = k;
  const stage = PLANT_STAGES[i];
  const next = PLANT_STAGES[i + 1];
  const toNext = next ? Math.max(0, next.min - g) : 0;
  const progress = next ? (g - stage.min) / (next.min - stage.min) : 1;
  return { stage, index: i, next, toNext, progress: Math.max(0, Math.min(1, progress)) };
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
    (cs.wishes?.length || 0) > 0 || (cs.questions?.length || 0) > 0 ||
    (cs.memoryCards?.length || 0) > 0 || (cs.recaps?.length || 0) > 0 ||
    (cs.dailyCheckins?.length || 0) > 0 || !!cs.profile?.homeName ||
    !!cs.profile?.loveLanguage || (cs.profile?.rituals?.length || 0) > 0 ||
    (cs.eyesCards?.length || 0) > 0 ||
    (cs.plant?.growth || 0) > 0 ||
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
  const pendingWishes = (cs.wishes || []).filter(w => !w.fulfilled).slice(0, 3).map(w => w.text);

  const profileLines: string[] = [];
  if (cs.profile?.homeName) profileLines.push(`空间名「${cs.profile.homeName.slice(0, 24)}」`);
  if (cs.profile?.userNickname) profileLines.push(`${char.name}常叫${userName}「${cs.profile.userNickname.slice(0, 18)}」`);
  if (cs.profile?.charNickname) profileLines.push(`${userName}常叫你「${cs.profile.charNickname.slice(0, 18)}」`);
  if (cs.profile?.loveLanguage) profileLines.push(`偏爱的相处方式：${cs.profile.loveLanguage.slice(0, 40)}`);
  (cs.profile?.rituals || []).slice(0, 3).forEach(r => profileLines.push(`固定小仪式：${r.slice(0, 40)}`));

  const memoryCardLines = [...(cs.memoryCards || [])]
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.createdAt - a.createdAt)
    .slice(0, 3)
    .map(c => `${c.pinned ? '置顶' : '记忆'}「${c.title.slice(0, 24)}」：${c.text.slice(0, 60)}`);

  const recapLines = [...(cs.recaps || [])]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 2)
    .map(r => `${r.title.slice(0, 24)}：${r.summary.slice(0, 70)}`);

  const eyesCardLines = [...(cs.eyesCards || [])]
    .sort((a, b) => b.generatedAt - a.generatedAt)
    .slice(0, 2)
    .map(c => `${eyesEraLabel[c.era]}：${c.summary.slice(0, 70)}${c.tags?.length ? `（${c.tags.slice(0, 3).join('、')}）` : ''}`);

  // 提问箱里近来答过的重要问答（让角色言行与自己答过的话保持一致）
  const recentQaLines = [...(cs.questions || [])]
    .map(normalizeQuestion)
    .filter(q => (q.status || 'answered') === 'answered' && !!q.answer)
    .sort((a, b) => b.at - a.at)
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned))
    .slice(0, 2)
    .map(q => `${q.visibility === 'anonymous' ? '匿名' : userName}问「${q.question.slice(0, 40)}」，你答「${q.answer.slice(0, 50)}」`);

  // 你们一起养的盆栽（有成长才提）
  let plantLine: string | undefined;
  if ((cs.plant?.growth || 0) > 0) {
    const ps = plantStage(cs.plant!.growth);
    plantLine = `你们一起养的小盆栽现在长到了「${ps.stage.name}」${ps.stage.emoji} 阶段（成长值 ${Math.round(cs.plant!.growth)}）`;
  }

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
    pendingWishes,
    recentQaLines,
    plantLine,
    lastUserWhisper: lastUserWhisper && !charRepliedAfter ? lastUserWhisper.text.slice(0, 60) : undefined,
    profileLines,
    memoryCardLines,
    recapLines,
    eyesCardLines,
  });
}

// ── 角色侧「主动互动」的一次性 LLM 调用（失败全吞，组件用模板兜底） ──────────

/** 剪影集完整角色设定：不使用摘要版，避免情侣空间主动互动丢世界观/世界书。 */
function compactPersona(char: CharacterProfile, userName: string): string {
  const parts: string[] = [buildFullCharacterSetting(char, { includeMemos: true })];
  const relLabel = char.relationship?.label;
  if (relLabel) parts.push(`你和${userName}现在的关系：${relLabel}。`);
  return parts.join('\n');
}

/**
 * 思维链 headroom：推理模型先吃 token 做思维链、再吐可见正文，留给正文的预算要叠在
 * 思维链之上。下面各 `generate*` 传进来的 `maxTokens` 是「答案本身」该有的长度（一两句话 /
 * 一个小 JSON，很短）；真正发给模型的 `max_tokens` 还要加这块 headroom，否则思维链会把
 * 预算吃光、正文为空。详见 {@link callCoupleLLM}。
 */
const REASONING_HEADROOM_TOKENS = 2000;

/**
 * 情侣空间一次性 LLM 调用 —— 统一走 `llmComplete`（与主聊天 / 折子戏 / 茶话亭同一条路）。
 *
 * 之前这里自己内联 `fetch + res.json() + choices[0].message.content`，会在几类**很常见**的情况下
 * 静默拿到空串 → 组件退回模板兜底，表现为「情侣空间所有 AI 功能都没反应、只剩本地套话」：
 *   1) 代理无视 `stream:false` 强行返回 SSE（`data: {...}` 流）→ 裸 `res.json()` 直接抛错；
 *   2) 思考型模型（DeepSeek-R1 / GLM-4.5 / Qwen3 / Gemini 兼容代理…）正文在 `reasoning_content`
 *      或分片数组里、或被 `<think>` 包裹 → `message.content` 为空/为数组；
 *   3) **推理模型把 max_tokens 全吃在思维链上**：gemini-3.1-pro / DeepSeek-R1 这类会先想一大段，
 *      情侣空间过去把 `max_tokens` 只按答案长度给（100~240），思维链没想完就撞顶被截断
 *      （`finish_reason='length'`），可见正文一个字都没产出、`reasoning_content` 也没暴露 →
 *      extractContent 拿到空串 → 整个情侣空间退回模板（用户现象：后台扣了 token、调用记录
 *      显示成功，界面却没有任何 AI 回复）。
 * 前两类由 `llmComplete` 内部的 `safeResponseJson`（SSE 拼接 / HTML 错误页识别）+ `extractContent`
 * （回退 reasoning_content / 拍平数组 / 去 think）兜住；第三类在这里给答案预算叠加
 * {@link REASONING_HEADROOM_TOKENS} 思维链 headroom 解决（与解牌 interpret.ts / 折子戏 theaterExtra.ts
 * 把推理模型 max_tokens 调高是同一套办法）。
 *
 * 仍保持「失败全吞返回空串」契约：调用方拿到空串后用模板兜底，绝不阻塞 UI。
 */
async function callCoupleLLM(api: CoupleApi, messages: ChatMsg[], maxTokens: number, featureId: string): Promise<string> {
  if (!(api.baseUrl || '').trim() || !api.model) return '';
  try {
    return await llmComplete(
      { baseUrl: api.baseUrl, apiKey: api.apiKey || '', model: api.model },
      messages,
      // 答案很短，但要给推理模型的思维链留足 headroom，否则正文被思维链挤没（见上）。
      { maxTokens: maxTokens + REASONING_HEADROOM_TOKENS, temperature: 0.95, meta: makeApiUsageMeta(featureId, { apiRole: 'aux' }) },
    );
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
  ], 120, 'chat.coupleSpace.comment');
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
  ], 160, 'chat.coupleSpace.whisper');
  return cleanLine(out, 100, [char.name, userName]);
}

/** 提问箱：角色（以恋人身份）回答用户提出的一个问题。 */
export async function generateCharQuestionAnswer(opts: {
  char: CharacterProfile;
  userName: string;
  api: CoupleApi;
  question: string;
}): Promise<string> {
  const { char, userName, api, question } = opts;
  const out = await callCoupleLLM(api, [
    { role: 'system', content: personaSystem(char, userName) },
    { role: 'user', content: coupleQuestionUserPrompt(userName, question) },
  ], 200, 'chat.coupleSpace.question');
  return cleanParagraph(out, 120, [char.name, userName]);
}

// ── 情侣小游戏：默契大考验（二选一，看你多懂 TA） ──────────────────────────
export interface CompatQuestion { q: string; a: string; b: string; }

export const COMPAT_QUESTIONS: CompatQuestion[] = [
  { q: '周末更想怎么过？', a: '宅家窝着', b: '出门浪' },
  { q: '吃的更偏爱？', a: '甜口', b: '咸辣口' },
  { q: '吵架后更想要？', a: '先各自冷静', b: '马上和好' },
  { q: '更想一起养？', a: '猫', b: '狗' },
  { q: '约会更想？', a: '看场电影', b: '吃顿大餐' },
  { q: '作息更偏？', a: '早睡早起', b: '熬夜星人' },
  { q: '收礼物更看重？', a: '心意满满', b: '实用为王' },
  { q: '旅行更想去？', a: '山林', b: '海边' },
  { q: '表达爱更习惯？', a: '挂在嘴上', b: '藏在行动里' },
  { q: '更喜欢的天气？', a: '晴天暖阳', b: '雨天慵懒' },
  { q: '看电影更爱？', a: '甜甜爱情片', b: '刺激动作片' },
  { q: '深夜更想？', a: '聊到天亮', b: '抱着早睡' },
  { q: '纪念日更想收到？', a: '认真准备的惊喜', b: '一起过的普通一天' },
  { q: '吵完架更容易被什么哄好？', a: '直接抱住', b: '认真解释' },
  { q: '约会迟到十分钟会？', a: '先撒娇混过去', b: '老实认错补偿' },
  { q: '更想把情侣空间装成？', a: '乱糟糟但真实', b: '整整齐齐很漂亮' },
  { q: '想念对方时更可能？', a: '发一条动态暗示', b: '憋着等对方来问' },
  { q: '更想一起完成的事？', a: '养成一个小习惯', b: '去很远的地方' },
  { q: '更容易记住？', a: '对方说过的小话', b: '一起经历的大事' },
  { q: '收到投喂时第一反应？', a: '嘴硬说麻烦', b: '马上开心炫耀' },
];

/** 随机抽 n 道默契题。 */
export function pickCompatQuestions(n = 5): CompatQuestion[] {
  return [...COMPAT_QUESTIONS].sort(() => Math.random() - 0.5).slice(0, Math.min(n, COMPAT_QUESTIONS.length));
}

/** 让角色以人设对一组二选一作答，返回 'a'/'b' 数组；失败返回 null（组件用随机兜底）。 */
export async function generateCharCompatAnswers(opts: {
  char: CharacterProfile;
  userName: string;
  api: CoupleApi;
  questions: CompatQuestion[];
}): Promise<('a' | 'b')[] | null> {
  const { char, userName, api, questions } = opts;
  const out = await callCoupleLLM(api, [
    { role: 'system', content: personaSystem(char, userName) },
    { role: 'user', content: coupleCompatPrompt(questions) },
  ], 120, 'chat.coupleSpace.compat');
  if (!out) return null;
  try {
    const m = out.match(/\[[\s\S]*\]/);
    if (m) {
      const arr = JSON.parse(m[0]);
      if (Array.isArray(arr) && arr.length === questions.length) {
        const norm = arr.map((x: any) => String(x).toLowerCase().trim());
        if (norm.every((x: string) => x === 'a' || x === 'b')) return norm as ('a' | 'b')[];
      }
    }
  } catch { /* fallthrough */ }
  return null;
}

/** 提问箱兜底回答（LLM 失败 / 未配 API 时用）。 */
export function fallbackQuestionAnswer(): string {
  const pool = [
    '这个问题…让我好好想想哦，其实我心里早有答案，只是想多回味一会儿和你有关的每一点。',
    '唔，被你这么一问还有点害羞。不过只要是关于你、关于我们的，我都愿意认真回答。',
    '嘿嘿，这种小问题最喜欢了。答案嘛——和你在一起的每个版本，我都喜欢。',
  ];
  return pool[Math.floor(Math.random() * pool.length)];
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
  ], 100, 'chat.coupleSpace.interaction');
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
  ], 240, 'chat.coupleSpace.innerVoice');
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
  ], 240, 'chat.coupleSpace.moment');
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

// ── 情侣空间 2.0：后台自经营 / 回顾 / 记忆卡 ───────────────────────────────

const AUTO_MOMENT_COOLDOWN_MS = DAY_MS;
const AUTO_RECAP_COOLDOWN_MS = 3 * DAY_MS;

export type CoupleAutoCareKind = 'moment' | 'wish' | 'task' | 'recap' | 'none';

export interface CoupleAutoCareSource {
  source: 'proactive' | 'leave' | 'catchup' | 'takeout' | 'date' | 'manual';
  id?: string;
  at?: number;
  text: string;
}

export interface CoupleAutoCareDraft {
  kind: CoupleAutoCareKind;
  text?: string;
  summary?: string;
  mood?: string;
  title?: string;
  highlights?: string[];
  suggestedTasks?: string[];
  suggestedWishes?: string[];
}

export interface CoupleAutoCareDecision {
  shouldRun: boolean;
  allowRecap: boolean;
  reason: string;
}

const sameLocalDay = (a?: number, b = Date.now()): boolean => {
  if (!a) return false;
  return todayYmd(a) === todayYmd(b);
};

export function isCoupleAutoCareEnabled(space: CoupleSpace | undefined | null): boolean {
  return space?.settings?.autoCareEnabled !== false;
}

export function shouldRunCoupleAutoCare(space: CoupleSpace | undefined | null, now = Date.now()): CoupleAutoCareDecision {
  if (!space) return { shouldRun: false, allowRecap: false, reason: 'no-space' };
  if (!isCoupleAutoCareEnabled(space)) return { shouldRun: false, allowRecap: false, reason: 'disabled' };
  const lastMomentToday = sameLocalDay(space.autoCare?.lastMomentAt, now);
  const allowRecap = now - (space.autoCare?.lastRecapAt || 0) >= AUTO_RECAP_COOLDOWN_MS;
  if (lastMomentToday && !allowRecap) return { shouldRun: false, allowRecap, reason: 'cooldown' };
  return { shouldRun: true, allowRecap, reason: lastMomentToday ? 'recap-only' : 'ready' };
}

const cleanShort = (raw: unknown, maxLen: number): string => String(raw || '').replace(/\s+/g, ' ').trim().slice(0, maxLen);

const cleanList = (raw: unknown, maxItems: number, maxLen: number): string[] =>
  Array.isArray(raw)
    ? raw.map(x => cleanShort(x, maxLen)).filter(Boolean).slice(0, maxItems)
    : [];

const stripThinkBlocks = (raw: string): string =>
  String(raw || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

function extractJsonObject(raw: string): any | null {
  const text = stripThinkBlocks(raw);
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = stripThinkBlocks(fenced ? fenced[1].trim() : text);
  const m = body.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

function normalizeAutoCareDraft(raw: any, allowRecap = true): CoupleAutoCareDraft | null {
  if (!raw || typeof raw !== 'object') return null;
  const kindRaw = String(raw.kind || '').trim().toLowerCase();
  const kind: CoupleAutoCareKind =
    kindRaw === 'moment' || kindRaw === 'wish' || kindRaw === 'task' || (allowRecap && kindRaw === 'recap') || kindRaw === 'none'
      ? kindRaw as CoupleAutoCareKind
      : 'none';
  const text = cleanShort(raw.text, kind === 'recap' ? 140 : 90);
  return {
    kind,
    text,
    mood: cleanShort(raw.mood, 8) || undefined,
    title: cleanShort(raw.title, 28) || undefined,
    highlights: cleanList(raw.highlights, 4, 48),
    suggestedTasks: cleanList(raw.suggestedTasks, 2, 40),
    suggestedWishes: cleanList(raw.suggestedWishes, 2, 40),
  };
}

function autoCareRecentSummary(space: CoupleSpace): string {
  const parts: string[] = [];
  [...(space.moments || [])].sort((a, b) => b.createdAt - a.createdAt).slice(0, 2)
    .forEach(m => parts.push(`动态：${describeMoment(m)}`));
  (space.tasks || []).filter(t => !t.done).slice(0, 2)
    .forEach(t => parts.push(`未完成约定：${t.title}`));
  (space.wishes || []).filter(w => !w.fulfilled).slice(0, 2)
    .forEach(w => parts.push(`未实现心愿：${w.text}`));
  return parts.join('；').slice(0, 240);
}

export async function generateCharCoupleAutoCare(opts: {
  char: CharacterProfile;
  userName: string;
  api: CoupleApi;
  space: CoupleSpace;
  source: CoupleAutoCareSource;
  allowRecap?: boolean;
}): Promise<CoupleAutoCareDraft | null> {
  const { char, userName, api, space, source } = opts;
  const allowRecap = opts.allowRecap !== false;
  const out = await callCoupleLLM(api, [
    { role: 'system', content: personaSystem(char, userName) },
    { role: 'user', content: coupleAutoCareUserPrompt({ userName, source: source.text.slice(0, 180), recent: autoCareRecentSummary(space), allowRecap }) },
  ], 500, 'chat.coupleSpace.autoCare');
  if (!out) return null;
  return normalizeAutoCareDraft(extractJsonObject(out), allowRecap);
}

const periodKey = (period: 'week' | 'month', now = Date.now()): string => {
  const d = new Date(now);
  const y = d.getFullYear();
  if (period === 'month') return `${y}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const start = new Date(y, 0, 1).getTime();
  const week = Math.floor((startOfDay(now) - start) / (7 * DAY_MS)) + 1;
  return `${y}-W${String(week).padStart(2, '0')}`;
};

function recapSourceLines(space: CoupleSpace, limit = 10): string[] {
  const lines: { at: number; text: string }[] = [];
  (space.moments || []).forEach(m => lines.push({ at: m.createdAt, text: `动态：${describeMoment(m)}` }));
  (space.tasks || []).forEach(t => lines.push({ at: t.doneAt || t.createdAt, text: `${t.done ? '完成约定' : '约定'}：${t.title}` }));
  (space.wishes || []).forEach(w => lines.push({ at: w.fulfilledAt || w.createdAt, text: `${w.fulfilled ? '实现心愿' : '心愿'}：${w.text}` }));
  (space.dailyCheckins || []).forEach(c => lines.push({ at: c.createdAt, text: `打卡：${c.ymd}${c.userMood ? ` ${c.userMood}` : ''}${c.note ? `，${c.note}` : ''}` }));
  return lines.sort((a, b) => b.at - a.at).slice(0, limit).map(x => x.text.slice(0, 90));
}

export async function generateCoupleRecap(opts: {
  char: CharacterProfile;
  userName: string;
  api: CoupleApi;
  space: CoupleSpace;
  period?: 'week' | 'month';
}): Promise<CoupleAutoCareDraft | null> {
  const period = opts.period || 'week';
  const out = await callCoupleLLM(opts.api, [
    { role: 'system', content: personaSystem(opts.char, opts.userName) },
    { role: 'user', content: coupleRecapUserPrompt({ userName: opts.userName, periodLabel: period === 'month' ? '本月' : '本周', sourceLines: recapSourceLines(opts.space) }) },
  ], 650, 'chat.coupleSpace.recap');
  if (!out) return null;
  const obj = extractJsonObject(out);
  if (obj && !obj.text && obj.summary) obj.text = obj.summary;
  const draft = normalizeAutoCareDraft({ ...(obj || {}), kind: 'recap' }, true);
  return draft?.text || draft?.highlights?.length ? draft : null;
}

const eyesEraLabel: Record<CoupleEyesEra, string> = {
  past: '过去的我',
  present: '现在的我',
  future: '将来的我',
};

const formatEyesTime = (ts: number): string => {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

function buildCoupleEyesSpaceLines(space: CoupleSpace, userName: string, charName: string): string[] {
  const lines: { at: number; text: string }[] = [];
  (space.moments || []).forEach(m => {
    const who = authorLabel(m.author, userName, charName);
    lines.push({ at: m.createdAt, text: `动态/${who}：${describeMoment(m)}` });
  });
  (space.whispers || []).forEach(w => {
    const who = authorLabel(w.author, userName, charName);
    lines.push({ at: w.at, text: `悄悄话/${who}：${w.text}` });
  });
  (space.questions || []).map(normalizeQuestion).forEach(q => {
    const status = q.status || 'answered';
    const answer = q.answer ? `；${charName}答：${q.answer}` : status === 'pending' ? '；等待回答' : '';
    lines.push({ at: q.answeredAt || q.at, text: `提问箱/${q.visibility === 'anonymous' ? '匿名' : userName}问：${q.question}${answer}` });
  });
  (space.memoryCards || []).forEach(c => lines.push({ at: c.createdAt, text: `记忆卡「${c.title}」：${c.text}` }));
  (space.recaps || []).forEach(r => lines.push({ at: r.createdAt, text: `关系回顾「${r.title}」：${r.summary}` }));
  return lines
    .sort((a, b) => b.at - a.at)
    .slice(0, 40)
    .map(x => x.text.replace(/\s+/g, ' ').slice(0, 160));
}

function normalizeEyesCard(raw: any, era: CoupleEyesEra, sourceMessageIds: number[], now = Date.now()): CoupleEyesCard | null {
  if (!raw || typeof raw !== 'object') return null;
  const summary = cleanShort(raw.summary, 80);
  const body = cleanShort(raw.body || raw.text || raw.content, COUPLE_EYES_BODY_MAX);
  if (!summary || !body) return null;
  return {
    era,
    summary,
    tags: cleanList(raw.tags, 4, 12),
    body,
    innerVoice: cleanShort(raw.innerVoice, 120) || undefined,
    generatedAt: now,
    sourceMessageIds,
  };
}

export function upsertCoupleEyesCard(space: CoupleSpace, card: CoupleEyesCard): CoupleSpace {
  const base = ensureCoupleSpace({ coupleSpace: space });
  const rest = (base.eyesCards || []).filter(c => c.era !== card.era);
  return { ...base, eyesCards: [card, ...rest], updatedAt: Date.now() };
}

export function applyCoupleQuestionAnswer(space: CoupleSpace, questionId: string, answer: string, now = Date.now()): CoupleSpace {
  const base = ensureCoupleSpace({ coupleSpace: space });
  return {
    ...base,
    questions: (base.questions || []).map(q => q.id === questionId
      ? { ...normalizeQuestion(q), answer: cleanShort(answer, 160), status: 'answered', answeredAt: now }
      : q),
    updatedAt: now,
  };
}

export async function generateCoupleEyesCard(opts: {
  char: CharacterProfile;
  userName: string;
  api: CoupleApi;
  space: CoupleSpace;
  era: CoupleEyesEra;
}): Promise<CoupleEyesCard | null> {
  const { char, userName, api, space, era } = opts;
  if (!(api.baseUrl || '').trim() || !api.model) return null;
  let recentMessages: Message[] = [];
  try {
    recentMessages = await DB.getRecentMessagesByCharId(char.id, 80, true);
  } catch {
    recentMessages = [];
  }
  const recentChatLines = recentMessages
    .filter(m => m.type !== 'image' && m.type !== 'emoji')
    .map(m => formatMessageWithTime(m, char.name, userName, formatEyesTime).slice(0, 220));
  const spaceLines = buildCoupleEyesSpaceLines(ensureCoupleSpace({ coupleSpace: space }), userName, char.name);
  const out = await callCoupleLLM(api, [
    { role: 'system', content: personaSystem(char, userName) },
    { role: 'user', content: coupleEyesCardUserPrompt(era, { userName, charName: char.name, recentChatLines, spaceLines }) },
  ], 1400, 'chat.coupleSpace.eyes');
  if (!out) return null;
  return normalizeEyesCard(extractJsonObject(out), era, recentMessages.map(m => m.id), Date.now());
}

export function buildCoupleDateMemoryCard(input: {
  title?: string;
  sceneName?: string;
  summary: string;
  sourceId?: string;
  sourceAt?: number;
  imageUrl?: string;
  createdAt?: number;
}): CoupleMemoryCard {
  const createdAt = input.createdAt || Date.now();
  return {
    id: genCoupleId('mc'),
    kind: 'date',
    title: cleanShort(input.title || input.sceneName || '一次约会', 32),
    text: cleanShort(input.summary, 180),
    sourceId: input.sourceId,
    sourceAt: input.sourceAt,
    imageUrl: input.imageUrl,
    createdAt,
  };
}

export function buildCoupleTakeoutMemoryCard(input: {
  title?: string;
  text: string;
  sourceId?: string;
  sourceAt?: number;
  createdAt?: number;
}): CoupleMemoryCard {
  const createdAt = input.createdAt || Date.now();
  return {
    id: genCoupleId('mc'),
    kind: 'takeout',
    title: cleanShort(input.title || '一张饭票', 32),
    text: cleanShort(input.text, 180),
    sourceId: input.sourceId,
    sourceAt: input.sourceAt,
    createdAt,
  };
}

export function applyCoupleAutoCareDraft(
  space: CoupleSpace,
  draft: CoupleAutoCareDraft | null | undefined,
  source: CoupleAutoCareSource,
  now = Date.now(),
): { space: CoupleSpace; applied: CoupleAutoCareKind; message?: string } {
  const base = ensureCoupleSpace({ coupleSpace: space });
  const manual = source.source === 'manual';
  const decision = manual ? { shouldRun: true, allowRecap: true, reason: 'manual' } : shouldRunCoupleAutoCare(base, now);
  const kind = draft?.kind || 'none';
  const autoCare = { ...(base.autoCare || {}), lastRunAt: now, lastSource: source.source, lastSummary: cleanShort(source.text, 80) };
  if (!decision.shouldRun || kind === 'none') {
    return { space: { ...base, autoCare, updatedAt: now }, applied: 'none' };
  }

  const text = cleanShort(draft?.text, kind === 'recap' ? 140 : 90);
  if (!text && kind !== 'recap') return { space: { ...base, autoCare, updatedAt: now }, applied: 'none' };

  if (kind === 'moment') {
    if (!manual && sameLocalDay(base.autoCare?.lastMomentAt, now)) return { space: { ...base, autoCare, updatedAt: now }, applied: 'none' };
    const moment: CoupleMoment = {
      id: genCoupleId('mo'),
      author: 'char',
      text,
      mood: draft?.mood,
      createdAt: now,
      likedByChar: true,
      likedByUser: false,
      comments: [],
    };
    return {
      space: { ...base, moments: [moment, ...base.moments], autoCare: { ...autoCare, lastMomentAt: now }, updatedAt: now },
      applied: 'moment',
      message: text,
    };
  }

  if (kind === 'wish') {
    const wish: CoupleWish = { id: genCoupleId('ws'), text, by: 'char', fulfilled: false, createdAt: now };
    return {
      space: { ...base, wishes: [wish, ...(base.wishes || [])], autoCare, updatedAt: now },
      applied: 'wish',
      message: text,
    };
  }

  if (kind === 'task') {
    const task: CoupleTask = { id: genCoupleId('tk'), title: text, done: false, by: 'char', createdAt: now };
    return {
      space: { ...base, tasks: [task, ...base.tasks], autoCare, updatedAt: now },
      applied: 'task',
      message: text,
    };
  }

  if (kind === 'recap') {
    if (!manual && now - (base.autoCare?.lastRecapAt || 0) < AUTO_RECAP_COOLDOWN_MS) return { space: { ...base, autoCare, updatedAt: now }, applied: 'none' };
    const highlights = draft?.highlights?.length ? draft.highlights : (text ? [text] : []);
    const recap: CoupleRecap = {
      id: genCoupleId('rc'),
      period: 'week',
      periodKey: periodKey('week', now),
      title: cleanShort(draft?.title || '这几天的回顾', 32),
      summary: text || highlights.join('；').slice(0, 120) || '这几天也在慢慢靠近。',
      highlights,
      suggestedTasks: draft?.suggestedTasks || [],
      suggestedWishes: draft?.suggestedWishes || [],
      sourceIds: source.id ? [source.id] : [],
      createdAt: now,
    };
    const card: CoupleMemoryCard = {
      id: genCoupleId('mc'),
      kind: 'recap',
      title: recap.title,
      text: recap.summary,
      sourceId: recap.id,
      sourceAt: now,
      createdAt: now,
    };
    return {
      space: {
        ...base,
        recaps: [recap, ...(base.recaps || [])],
        memoryCards: [card, ...(base.memoryCards || [])],
        autoCare: { ...autoCare, lastRecapAt: now },
        updatedAt: now,
      },
      applied: 'recap',
      message: recap.summary,
    };
  }

  return { space: { ...base, autoCare, updatedAt: now }, applied: 'none' };
}

/** 给互动记录数组追加一条并裁剪长度（保留最近 N 条）。 */
export function pushInteraction(list: CoupleInteraction[], item: CoupleInteraction, keep = 30): CoupleInteraction[] {
  return [...list, item].slice(-keep);
}
