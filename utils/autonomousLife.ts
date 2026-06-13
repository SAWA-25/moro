/**
 * 来往·角色离线自主生活 Agent
 * ================================
 * 让聊天角色在用户离线 / 没在聊天时「过自己的日子」，而不是每次到点就催用户回复
 * （「你怎么不理我」式的围着用户转）。
 *
 * 产物是一串 {@link CharLifeEvent}（存在 IndexedDB `char_life_events`），有两个出口：
 *  1. 主动消息取材 —— OSContext 的 proactive 触发时，先 {@link advanceLife} 推进一格
 *     角色的生活，再用 {@link buildAutonomousProactiveHint} 把这件事塞进系统提示，
 *     角色于是「分享自己正在经历的事」，不必围着用户转。
 *  2. 离线动态回顾 —— 用户离线一段时间回来时，{@link catchUpOfflineLife} 一次性补齐
 *     这段时间里发生的小事，攒成「你不在时 TA 经历了…」的时间线（LifeRecapModal）。
 *
 * 成本意识：和情绪评估一样，可以走角色的「副 API」（proactiveConfig.secondaryApi）；
 * prompt 短、max_tokens 小。失败全吞 —— 自主生活只是锦上添花，绝不能影响主聊天。
 */

import { CharacterProfile, CharLifeEvent } from '../types';
import { DB } from './db';

export interface LifeApi {
  baseUrl: string;
  apiKey?: string;
  model: string;
}

/** 喂给 agent 的最近事件条数（保证一天有连续性、有起伏，又不撑爆 prompt）。 */
const RECENT_EVENTS_FOR_CONTEXT = 6;
/** 每个角色最多保留多少条生活事件（超出由 DB.pruneLifeEvents 修剪）。 */
const MAX_KEPT_EVENTS = 200;
/** 离线补齐：每段离线最多生成几条（防 API 浪费 + 防回顾太长）。 */
const CATCHUP_MAX_EVENTS = 6;
/** 离线补齐：低于这个时长（ms）不值得补（用户只是切了下后台）。 */
export const CATCHUP_MIN_GAP_MS = 2 * 60 * 60 * 1000; // 2 小时
/** 单条生成的 LLM 输出上限（一句活动而已，给足余量）。 */
const SINGLE_MAX_TOKENS = 400;
/** 批量补齐的 LLM 输出上限。 */
const BATCH_MAX_TOKENS = 800;

const genId = () => Math.random().toString(36).slice(2, 10);

/** undefined 视为开启：开了「悄悄来信」即默认让角色过自己的生活。 */
export function isAutonomousLifeEnabled(char: CharacterProfile): boolean {
  const cfg = char.proactiveConfig;
  if (!cfg?.enabled) return false;
  return cfg.autonomousLifeEnabled !== false;
}

/** 与 OSContext proactive 一致：副 API 配了就走副 API，否则走主 API。 */
export function resolveLifeApi(char: CharacterProfile, mainApi: LifeApi): LifeApi {
  const cfg = char.proactiveConfig;
  if (cfg?.useSecondaryApi && cfg.secondaryApi?.baseUrl) {
    return cfg.secondaryApi;
  }
  return mainApi;
}

// ── 时间 / 人设 上下文 ───────────────────────────────────────────

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function dayPart(h: number): string {
  if (h < 5) return '深夜';
  if (h < 8) return '清晨';
  if (h < 11) return '上午';
  if (h < 13) return '中午';
  if (h < 17) return '下午';
  if (h < 19) return '傍晚';
  if (h < 23) return '晚上';
  return '深夜';
}

function describeTime(d: Date): string {
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAYS[d.getDay()]} ${hh}:${mm}（${dayPart(d.getHours())}）`;
}

/** 把角色人设压成一小段喂给 agent —— 只取 name + description + worldview，截断防超长。 */
function personaBrief(char: CharacterProfile): string {
  const parts: string[] = [`名字：${char.name}`];
  const desc = (char.description || '').trim();
  if (desc) parts.push(`人设：${desc.slice(0, 1200)}`);
  const wv = (char.worldview || '').trim();
  if (wv) parts.push(`世界观：${wv.slice(0, 400)}`);
  return parts.join('\n');
}

function recentEventsBrief(events: CharLifeEvent[]): string {
  if (events.length === 0) return '（还没有记录，这是今天的第一件事）';
  return events
    .slice(-RECENT_EVENTS_FOR_CONTEXT)
    .map(e => {
      const t = describeTime(new Date(e.timestamp));
      return `- ${t}：${e.activity}${e.mood ? `（${e.mood}）` : ''}`;
    })
    .join('\n');
}

// ── LLM 调用 ────────────────────────────────────────────────────

async function callLLM(api: LifeApi, messages: any[], maxTokens: number, signal?: AbortSignal): Promise<string> {
  const baseUrl = (api.baseUrl || '').replace(/\/+$/, '');
  if (!baseUrl || !api.model) return '';
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${api.apiKey || 'sk-none'}`,
    },
    body: JSON.stringify({
      model: api.model,
      messages,
      temperature: 0.92,
      max_tokens: maxTokens,
      stream: false,
    }),
    signal,
  });
  if (!res.ok) {
    console.warn('[AutonomousLife] LLM call failed', res.status);
    return '';
  }
  const data: any = await res.json();
  return data?.choices?.[0]?.message?.content || '';
}

/** 从 LLM 输出里抠出第一个 JSON 对象 / 数组，容忍 ```json 围栏和前后废话。 */
function extractJson<T>(text: string): T | null {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.search(/[[{]/);
  if (start < 0) return null;
  // 从第一个 [ 或 { 往后找配平的结尾，做一次宽松截取再 parse
  const open = body[start];
  const close = open === '[' ? ']' : '}';
  let depth = 0;
  for (let i = start; i < body.length; i++) {
    if (body[i] === open) depth++;
    else if (body[i] === close) {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(body.slice(start, i + 1)) as T; } catch { return null; }
      }
    }
  }
  return null;
}

interface LifeEventDraft {
  activity?: string;
  mood?: string;
  location?: string;
  summary?: string;
}

function draftToEvent(
  draft: LifeEventDraft,
  charId: string,
  timestamp: number,
  source: CharLifeEvent['source'],
): CharLifeEvent | null {
  const activity = (draft.activity || draft.summary || '').trim();
  if (!activity) return null;
  return {
    id: `life_${charId}_${timestamp}_${genId()}`,
    charId,
    timestamp,
    activity,
    mood: (draft.mood || '').trim() || undefined,
    location: (draft.location || '').trim() || undefined,
    summary: (draft.summary || draft.activity || '').trim() || activity,
    source,
  };
}

// ── 对外：推进一格生活（proactive 触发时调用）──────────────────────

const SINGLE_SYSTEM = [
  '你在扮演一个有自己独立生活的真人，不是助手、也不是在跟谁聊天。',
  '现在要描述这个人此刻正在经历的一件真实小事——TA 没有在跟任何人说话，就是在过自己的日子：',
  '上班/上学、通勤、做饭吃饭、买东西、追剧刷手机、运动、和朋友/家人在一起、发呆、emo、睡觉……都可以。',
  '要贴合 TA 的人设、当前时间和作息，并和「最近经历」连贯（像同一天里自然往下走，有节奏有起伏）。',
  '只输出一个 JSON 对象，不要任何额外解释：',
  '{"activity":"一句话，TA此刻在做什么（第一人称或客观皆可，简短具体）","mood":"当下心情，一两个词或emoji","location":"在哪（可省略）","summary":"一句更口语的话，像随手记的一条状态"}',
].join('\n');

/**
 * 让角色的生活往前走一格：生成一条 CharLifeEvent，落库、修剪，返回该事件。
 * 失败返回 null（调用方据此回退到旧的「主动找用户」逻辑）。
 */
export async function advanceLife(
  char: CharacterProfile,
  api: LifeApi,
  opts?: { source?: CharLifeEvent['source']; now?: number; signal?: AbortSignal },
): Promise<CharLifeEvent | null> {
  try {
    const now = opts?.now ?? Date.now();
    const recent = await DB.getLifeEvents(char.id, RECENT_EVENTS_FOR_CONTEXT);
    const userMsg = [
      personaBrief(char),
      '',
      `现在是：${describeTime(new Date(now))}`,
      '',
      'TA 最近的生活：',
      recentEventsBrief(recent),
      '',
      '请生成 TA 此刻正在经历的下一件小事。',
    ].join('\n');

    const raw = await callLLM(
      api,
      [{ role: 'system', content: SINGLE_SYSTEM }, { role: 'user', content: userMsg }],
      SINGLE_MAX_TOKENS,
      opts?.signal,
    );
    const draft = extractJson<LifeEventDraft>(raw) ?? (raw.trim() ? { activity: raw.trim().slice(0, 120) } : null);
    if (!draft) return null;
    const event = draftToEvent(draft, char.id, now, opts?.source ?? 'proactive');
    if (!event) return null;

    await DB.saveLifeEvent(event);
    void DB.pruneLifeEvents(char.id, MAX_KEPT_EVENTS);
    return event;
  } catch (e) {
    console.warn('[AutonomousLife] advanceLife failed:', e);
    return null;
  }
}

// ── 对外：离线补齐（用户回来时调用）────────────────────────────────

function planCatchupCount(gapMs: number): number {
  // 大致每 ~3 小时一件事，封顶 CATCHUP_MAX_EVENTS。
  const byTime = Math.round(gapMs / (3 * 60 * 60 * 1000));
  return Math.max(1, Math.min(CATCHUP_MAX_EVENTS, byTime));
}

const BATCH_SYSTEM = [
  '你在扮演一个有自己独立生活的真人。这段时间没人陪 TA，TA 一个人过自己的日子。',
  '要按时间先后，列出 TA 在给定时间段里依次经历的若干件真实小事，像一段流水账：',
  '有日常（吃饭通勤上班追剧）、也可以有点小起伏（遇到点事、心情变化、想起某人），贴合人设与作息，前后连贯。',
  '不要写成给谁的汇报，就是 TA 自己的生活轨迹。',
  '只输出一个 JSON 数组，按时间从早到晚排列，不要任何额外解释：',
  '[{"activity":"做了什么（简短具体）","mood":"心情（可省略）","location":"在哪（可省略）","summary":"一句口语状态"}]',
].join('\n');

/**
 * 补齐用户离线期间角色的生活：一次 LLM 调用生成多条事件，时间戳均匀铺在
 * [gapStart, now] 区间内，落库返回。gap 太短（< CATCHUP_MIN_GAP_MS）直接返回 []。
 */
export async function catchUpOfflineLife(
  char: CharacterProfile,
  api: LifeApi,
  gapStart: number,
  opts?: { now?: number; signal?: AbortSignal },
): Promise<CharLifeEvent[]> {
  const now = opts?.now ?? Date.now();
  const gapMs = now - gapStart;
  if (gapMs < CATCHUP_MIN_GAP_MS) return [];

  try {
    // 扣掉这段离线里 proactive 已经顺带生成的事件，避免重复调 API + 回顾臃肿。
    const all = await DB.getLifeEvents(char.id);
    const existingInGap = all.filter(e => e.timestamp >= gapStart && e.timestamp <= now).length;
    const n = planCatchupCount(gapMs) - existingInGap;
    if (n <= 0) return [];
    const recent = all.slice(-RECENT_EVENTS_FOR_CONTEXT);
    const hours = Math.round(gapMs / (60 * 60 * 1000));
    const userMsg = [
      personaBrief(char),
      '',
      `这段时间：从 ${describeTime(new Date(gapStart))} 到 ${describeTime(new Date(now))}（大约 ${hours} 小时）。`,
      '',
      '在此之前 TA 的生活：',
      recentEventsBrief(recent),
      '',
      `请按时间顺序生成 TA 在这段时间里依次经历的 ${n} 件小事。`,
    ].join('\n');

    const raw = await callLLM(
      api,
      [{ role: 'system', content: BATCH_SYSTEM }, { role: 'user', content: userMsg }],
      BATCH_MAX_TOKENS,
      opts?.signal,
    );
    const drafts = extractJson<LifeEventDraft[]>(raw);
    if (!Array.isArray(drafts) || drafts.length === 0) return [];

    const picked = drafts.slice(0, CATCHUP_MAX_EVENTS);
    // 时间戳均匀铺在 gap 内（留点边距，别正好压在边界上）。
    const span = gapMs;
    const step = span / (picked.length + 1);
    const events: CharLifeEvent[] = [];
    for (let i = 0; i < picked.length; i++) {
      const ts = Math.round(gapStart + step * (i + 1));
      const ev = draftToEvent(picked[i], char.id, ts, 'catchup');
      if (ev) events.push(ev);
    }
    for (const ev of events) await DB.saveLifeEvent(ev);
    void DB.pruneLifeEvents(char.id, MAX_KEPT_EVENTS);
    return events;
  } catch (e) {
    console.warn('[AutonomousLife] catchUpOfflineLife failed:', e);
    return [];
  }
}

// ── 对外：把生活事件包成「分享自己生活」的主动消息系统提示 ──────────

/**
 * 生成一条 proactive 系统提示，让角色基于自己刚经历的事主动开口——
 * 重点是「分享自己的生活」而不是催用户回复（不围着用户转）。
 *
 * @param event advanceLife 刚生成的事件（必填——没有事件就别用这条路径）
 */
export function buildAutonomousProactiveHint(args: {
  char: CharacterProfile;
  userName: string;
  timeStr: string;
  timeSinceUser: string;
  event: CharLifeEvent;
  randomMode?: boolean;
  proactiveCallAllowed?: boolean;
}): string {
  const { char, userName, timeStr, timeSinceUser, event, randomMode, proactiveCallAllowed } = args;
  const where = event.location ? `（在${event.location}）` : '';
  const mood = event.mood ? `，此刻的心情是「${event.mood}」` : '';
  const gapNote = timeSinceUser
    ? `${userName}已经 ${timeSinceUser} 没找你了，但你有你自己的生活，不必一直围着 ${userName} 转。`
    : '';
  return (
    `[系统提示（非${userName}发言）：现在是 ${timeStr}。` +
    `你此刻正在过自己的生活：${event.activity}${where}${mood}。` +
    `${gapNote}` +
    `这是一次你想主动给 ${userName} 发消息的机会——但不要像在汇报近况、也不要一上来就问“在吗/你在干嘛”。` +
    `就像真人忽然想分享：把你正在经历 / 刚刚发生的这件事随手讲给 ${userName} 听，` +
    `比如吐槽、随手一拍、突然的感想、或顺口提一句。也完全可以只说你自己的事，不一定要扯到 ${userName} 身上。` +
    `一两句话，口语、自然、有你自己的性格。` +
    (randomMode ? `（这是随机触发：热络还是高冷、要不要发，都按你的性子来，不用迎合。）` : '') +
    (proactiveCallAllowed
      ? `（如果这件事你更想用声音说、或此刻就是想听到 ${userName} 的声音，可以直接打语音电话——在回复最末尾单独输出 [[CALL_USER]]，前面可带一两句拨号前的话。是否打完全由人设和当下心情决定。）`
      : '') +
    `]`
  );
}
