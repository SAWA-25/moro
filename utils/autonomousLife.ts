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

import { CharacterProfile, CharLifeEvent, AuxApiConfig, DailySchedule, ScheduleSlot } from '../types';
import { DB } from './db';
import { isAuxApiOn } from './auxApi';
import { AUTONOMOUS_SINGLE_SYSTEM, AUTONOMOUS_BATCH_SYSTEM, autonomousProactiveHint, recentLifeContextIntro } from './laiwangPrompts';
import { callChatCompletion } from './llmClient';
import { makeApiUsageMeta } from './apiUsageCatalog';
import { extractContent } from './safeApi';

export interface LifeApi {
  baseUrl: string;
  apiKey?: string;
  model: string;
  apiRole?: 'main' | 'aux' | 'custom';
  apiBinding?: string;
  fallbackFromAux?: boolean;
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

type ProactiveConfig = NonNullable<CharacterProfile['proactiveConfig']>;
type ProactiveIntensity = NonNullable<ProactiveConfig['intensity']>;
type LifeDensity = NonNullable<ProactiveConfig['lifeDensity']>;
type MessageFlavor = NonNullable<ProactiveConfig['messageFlavor']>;
type MaterialSource = NonNullable<ProactiveConfig['materialSources']>[number];
type QuietBehavior = NonNullable<ProactiveConfig['quietHours']>['behavior'];

export type AutonomousProactiveDecision = 'send' | 'life_only' | 'skip';

export interface AutonomousProactivePlan {
  decision: AutonomousProactiveDecision;
  event: CharLifeEvent | null;
  reason: string;
  generated: boolean;
  reused: boolean;
  quietHoursActive: boolean;
  score: number;
}

export interface AutonomousProactivePlanOptions {
  now?: number;
  signal?: AbortSignal;
  recentChat?: string;
  randomMode?: boolean;
}

const DEFAULT_MATERIAL_SOURCES: MaterialSource[] = ['life', 'recentChat', 'schedule', 'realtime'];
const MATERIAL_SOURCE_LABELS: Record<MaterialSource, string> = {
  life: '自己的生活事件',
  recentChat: '最近聊天余温',
  schedule: '今日作息',
  realtime: '实时世界',
};

export function getProactiveIntensity(char: CharacterProfile): ProactiveIntensity {
  return char.proactiveConfig?.intensity || 'balanced';
}

export function getLifeDensity(char: CharacterProfile): LifeDensity {
  return char.proactiveConfig?.lifeDensity || 'normal';
}

export function getMessageFlavor(char: CharacterProfile): MessageFlavor {
  return char.proactiveConfig?.messageFlavor || 'natural';
}

export function getMaterialSources(char: CharacterProfile): MaterialSource[] {
  const raw = char.proactiveConfig?.materialSources;
  if (!raw || raw.length === 0) return DEFAULT_MATERIAL_SOURCES;
  const allowed = new Set(DEFAULT_MATERIAL_SOURCES);
  const picked = raw.filter((s): s is MaterialSource => allowed.has(s as MaterialSource));
  return picked.length ? Array.from(new Set(picked)) : DEFAULT_MATERIAL_SOURCES;
}

export function formatMaterialSources(char: CharacterProfile): string {
  return getMaterialSources(char).map(s => MATERIAL_SOURCE_LABELS[s]).join('、');
}

function lifeGenerationCooldownMs(density: LifeDensity): number {
  if (density === 'sparse') return 2 * 60 * 60 * 1000;
  if (density === 'busy') return 15 * 60 * 1000;
  return 45 * 60 * 1000;
}

function catchupPlanForDensity(density: LifeDensity): { everyMs: number; max: number } {
  if (density === 'sparse') return { everyMs: 5 * 60 * 60 * 1000, max: 4 };
  if (density === 'busy') return { everyMs: 2 * 60 * 60 * 1000, max: 8 };
  return { everyMs: 3 * 60 * 60 * 1000, max: CATCHUP_MAX_EVENTS };
}

function proactiveThreshold(intensity: ProactiveIntensity): number {
  if (intensity === 'quiet') return 70;
  if (intensity === 'chatty') return 38;
  if (intensity === 'unfiltered') return 24;
  return 52;
}

function clampScore(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function scoreLifeEventForProactive(event: CharLifeEvent | null | undefined): number {
  if (!event) return 0;
  const intensity = clampScore(event.intensity, 50);
  const share = clampScore(event.shareWillingness, event.proactiveAngle === 'silence' ? 15 : 55);
  let score = Math.round(intensity * 0.45 + share * 0.55);
  if (event.energy === 'high') score += 8;
  if (event.energy === 'low') score -= 6;
  if (event.proactiveAngle === 'silence') score -= 22;
  if (event.proactiveAngle === 'ask' || event.proactiveAngle === 'invite') score += 6;
  return Math.max(0, Math.min(100, score));
}

function parseHHmm(value: string | undefined, fallback: number): number {
  const m = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return fallback;
  const h = Math.max(0, Math.min(23, parseInt(m[1], 10)));
  const min = Math.max(0, Math.min(59, parseInt(m[2], 10)));
  return h * 60 + min;
}

export function resolveQuietHours(char: CharacterProfile, now = Date.now()): { active: boolean; behavior: QuietBehavior } {
  const q = char.proactiveConfig?.quietHours;
  if (!q?.enabled) return { active: false, behavior: 'send' };
  const start = parseHHmm(q.start, 23 * 60);
  const end = parseHHmm(q.end, 7 * 60);
  const d = new Date(now);
  const cur = d.getHours() * 60 + d.getMinutes();
  const active = start === end
    ? false
    : start < end
    ? cur >= start && cur < end
    : cur >= start || cur < end;
  return { active, behavior: q.behavior || 'life_only' };
}

/** undefined 视为开启：开了「悄悄来信」即默认让角色过自己的生活。 */
export function isAutonomousLifeEnabled(char: CharacterProfile): boolean {
  const cfg = char.proactiveConfig;
  if (!cfg?.enabled) return false;
  return cfg.autonomousLifeEnabled !== false;
}

/**
 * 「线下自主生活」该用哪根线，优先级：
 *  1) 角色自带的副 API（proactiveConfig.secondaryApi）—— 显式 per-char 覆盖，最优先；
 *  2) 全局副 API（文具盒 auxApiConfig）—— **线下功能默认就走副 API**，和占卜/生活侧写
 *     等「主聊天以外的辅助任务」一致：省主 API 额度、不与线上聊天抢同一根线；
 *  3) 主 API —— 都没配时兜底（行为同旧版）。
 *
 * 这样「线下（生活生成）」与「线上（聊天）」默认走不同接口，但产出的生活事件会被
 * 注入回线上聊天上下文（见 buildRecentLifeContextBlock），二者数据是关联的。
 */
export function resolveLifeApi(char: CharacterProfile, aux: AuxApiConfig | null | undefined, mainApi: LifeApi): LifeApi {
  const cfg = char.proactiveConfig;
  if (cfg?.useSecondaryApi && cfg.secondaryApi?.baseUrl) {
    return { ...cfg.secondaryApi, apiRole: 'custom', apiBinding: '角色主动消息副 API' };
  }
  if (isAuxApiOn(aux)) return { baseUrl: aux!.baseUrl, apiKey: aux!.apiKey || '', model: aux!.model, apiRole: 'aux', apiBinding: '文具盒副 API' };
  return { ...mainApi, apiRole: 'main', apiBinding: '副 API 未配置，回退主 API', fallbackFromAux: true };
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

function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isoDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function isScheduleFeatureLikelyOn(char: CharacterProfile): boolean {
  if (char.scheduleFeatureEnabled === true) return true;
  if (char.scheduleFeatureEnabled === false) return false;
  return !!char.scheduleStyle;
}

async function loadScheduleForLife(char: CharacterProfile, timestamp: number): Promise<DailySchedule | null> {
  if (!getMaterialSources(char).includes('schedule')) return null;
  if (!isScheduleFeatureLikelyOn(char)) return null;
  const d = new Date(timestamp);
  const keys = Array.from(new Set([isoDateKey(d), localDateKey(d)]));
  for (const key of keys) {
    const schedule = await DB.getDailySchedule(char.id, key).catch(() => null);
    if (schedule?.slots?.length) return schedule;
  }
  return null;
}

async function loadSchedulesForLife(char: CharacterProfile, timestamps: number[]): Promise<Array<DailySchedule | null>> {
  const cache = new Map<string, DailySchedule | null>();
  const out: Array<DailySchedule | null> = [];
  for (const ts of timestamps) {
    const d = new Date(ts);
    const cacheKey = Array.from(new Set([isoDateKey(d), localDateKey(d)])).join('|');
    if (!cache.has(cacheKey)) {
      cache.set(cacheKey, await loadScheduleForLife(char, ts));
    }
    out.push(cache.get(cacheKey) || null);
  }
  return out;
}

function slotStartMinutes(slot: ScheduleSlot): number {
  return parseHHmm(slot.startTime, 0);
}

function findScheduleSlotAt(schedule: DailySchedule | null | undefined, timestamp: number): {
  current: ScheduleSlot | null;
  previous: ScheduleSlot | null;
  next: ScheduleSlot | null;
} {
  if (!schedule?.slots?.length) return { current: null, previous: null, next: null };
  const sorted = [...schedule.slots].sort((a, b) => slotStartMinutes(a) - slotStartMinutes(b));
  const d = new Date(timestamp);
  const minutes = d.getHours() * 60 + d.getMinutes();
  let idx = -1;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (minutes >= slotStartMinutes(sorted[i])) {
      idx = i;
      break;
    }
  }
  if (idx < 0) return { current: null, previous: null, next: sorted[0] || null };
  return {
    current: sorted[idx] || null,
    previous: idx > 0 ? sorted[idx - 1] : null,
    next: idx < sorted.length - 1 ? sorted[idx + 1] : null,
  };
}

function formatScheduleSlot(slot: ScheduleSlot | null | undefined): string {
  if (!slot) return '（无）';
  const time = slot.endTime ? `${slot.startTime}-${slot.endTime}` : slot.startTime;
  const where = slot.location ? `（${slot.location}）` : '';
  const desc = slot.description ? `：${slot.description}` : '';
  const anchor = slot.anchored || slot.source === 'chat' ? ' [聊天约定/锚点]' : '';
  return `${time} ${slot.activity}${where}${desc}${anchor}`;
}

function buildScheduleLifeContext(schedule: DailySchedule | null, timestamp: number): {
  block: string;
  slot: ScheduleSlot | null;
} {
  if (!schedule?.slots?.length) return { block: '', slot: null };
  const { current, previous, next } = findScheduleSlotAt(schedule, timestamp);
  const anchors = schedule.slots
    .filter(s => s.anchored || s.source === 'chat')
    .map(formatScheduleSlot)
    .join('\n');
  const lines = [
    '今日作息对齐（必须遵守）：',
    `- 预估发生时间：${describeTime(new Date(timestamp))}`,
    `- 当前/最接近时段：${formatScheduleSlot(current)}`,
    previous ? `- 上一时段：${formatScheduleSlot(previous)}` : '',
    next ? `- 下一时段：${formatScheduleSlot(next)}` : '',
    anchors ? `- 今天已定下的聊天锚点：\n${anchors}` : '',
    '生成生活小事时要和当前/最接近时段相容；不要让 TA 在同一时间出现在两个地点，或一边做日程里互斥的事一边做另一件事。若写临时小插曲，请写成发生在该时段的路上、间隙或被日程影响后的自然变化。',
  ].filter(Boolean);
  return { block: lines.join('\n'), slot: current };
}

function buildCatchupScheduleContext(schedules: Array<DailySchedule | null>, timestamps: number[]): string {
  if (timestamps.length === 0 || !schedules.some(s => s?.slots?.length)) return '';
  const lines = timestamps.map((ts, idx) => {
    const schedule = schedules[idx] || null;
    const { current, next } = findScheduleSlotAt(schedule, ts);
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${idx + 1}. ${hh}:${mm} → 当前/最接近：${formatScheduleSlot(current)}${next ? `；之后：${formatScheduleSlot(next)}` : ''}`;
  });
  return [
    '这段离线补齐要和今日作息同步。下面每一行对应你将按顺序生成的一件小事，后续会按这些时间落库：',
    ...lines,
    '每件小事都必须贴合对应时段；不要和聊天锚点、地点、正在做的事撞车。若发生偏离，请写出是“临时变化/间隙/路上”的合理过渡。',
  ].join('\n');
}

function scheduleEventPatch(schedule: DailySchedule | null, timestamp: number): Pick<CharLifeEvent, 'scheduleDate' | 'scheduleSlotStartTime' | 'scheduleSlotActivity'> {
  const { current } = findScheduleSlotAt(schedule, timestamp);
  if (!schedule || !current) return {};
  return {
    scheduleDate: schedule.date,
    scheduleSlotStartTime: current.startTime,
    scheduleSlotActivity: current.activity,
  };
}

/** 把角色核心设定压成一小段喂给 agent —— 只取 name + systemPrompt + worldview，截断防超长。 */
function personaBrief(char: CharacterProfile): string {
  const parts: string[] = [`名字：${char.name}`];
  const desc = (char.systemPrompt || '').trim();
  if (desc) parts.push(`人设：${desc.slice(0, 1200)}`);
  const wv = (char.worldview || '').trim();
  if (wv) parts.push(`世界观：${wv.slice(0, 400)}`);
  return parts.join('\n');
}

function recentEventsBrief(events: CharLifeEvent[]): string {
  if (events.length === 0) return '（还没有记录，这是今天的第一件事）';
  const lines = events
    .slice(-RECENT_EVENTS_FOR_CONTEXT)
    .map(e => {
      const activity = sanitizeLifeText(e.activity) || sanitizeLifeText(e.summary || '');
      if (!activity) return '';
      const mood = e.mood ? sanitizeLifeText(e.mood) : '';
      const t = describeTime(new Date(e.timestamp));
      return `- ${t}：${activity}${mood ? `（${mood}）` : ''}`;
    })
    .filter(Boolean);
  return lines.length ? lines.join('\n') : '（最近的生活记录格式异常，已跳过）';
}

// ── LLM 调用 ────────────────────────────────────────────────────

async function callLLM(api: LifeApi, messages: any[], maxTokens: number, signal?: AbortSignal): Promise<string> {
  if (!api.baseUrl || !api.model) return '';
  const data = await callChatCompletion(api, {
    model: api.model,
    messages,
    temperature: 0.92,
    max_tokens: maxTokens,
    stream: false,
  }, {
    signal,
    meta: makeApiUsageMeta('chat.autonomousLife', {
      apiRole: api.apiRole || 'aux',
      apiBinding: api.apiBinding,
      isBackgroundTask: true,
    }),
  });
  return extractContent(data) || '';
}

/** 去掉代码围栏：成对的 ```json…``` 优先，否则剥掉未闭合的开头/结尾围栏。 */
function stripFences(text: string): string {
  if (!text) return '';
  const t = text.trim();
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  // 围栏没闭合（常见于被 max_tokens 截断）：去掉开头 ```json / ``` 和结尾残留的 ```
  return t.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
}

/**
 * 从 LLM 输出里抠出第一个 JSON 对象 / 数组，容忍 ```json 围栏和前后废话。
 * 括号配平时跳过字符串内部的括号，避免活动文本里出现 {} [] 把深度算乱。
 */
function extractJson<T>(text: string): T | null {
  if (!text) return null;
  const body = stripFences(text);
  const start = body.search(/[[{]/);
  if (start < 0) return null;
  const open = body[start];
  const close = open === '[' ? ']' : '}';
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < body.length; i++) {
    const ch = body[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(body.slice(start, i + 1)) as T; } catch { return null; }
      }
    }
  }
  return null;
}

/** 从（可能被截断的）JSON 残骸里宽松抠出某个字符串字段的值。 */
function looseField(text: string, key: string): string | undefined {
  // 1) 完整带引号的值（容忍转义）
  const full = text.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, 'i'));
  if (full) {
    try { return JSON.parse(`"${full[1]}"`); } catch { return full[1]; }
  }
  // 2) 截断在该字段中途（缺收尾引号）：取到文本结尾
  const open = text.match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)$`, 'i'));
  if (open) return open[1].trim().replace(/[\s,}\]]+$/, '') || undefined;
  return undefined;
}

/** 扫出文本里所有「配平的 {…} 对象」并逐个 parse（数组被截断时兜底用）。 */
function extractObjects<T>(text: string): T[] {
  const body = stripFences(text);
  const out: T[] = [];
  let depth = 0;
  let startIdx = -1;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') { if (depth === 0) startIdx = i; depth++; }
    else if (ch === '}') {
      depth--;
      if (depth === 0 && startIdx >= 0) {
        try { out.push(JSON.parse(body.slice(startIdx, i + 1)) as T); } catch { /* 跳过坏对象 */ }
        startIdx = -1;
      }
    }
  }
  return out;
}

/** JSON 整体没法 parse（截断等）时，宽松凑一个草稿出来。 */
function looseDraft(text: string): LifeEventDraft | null {
  const body = stripFences(text);
  const activity = looseField(body, 'activity') || looseField(body, 'summary');
  if (!activity) return null;
  return {
    activity,
    mood: looseField(body, 'mood'),
    location: looseField(body, 'location'),
    summary: looseField(body, 'summary'),
  };
}

/**
 * 兜底清洗：把一段疑似 JSON / 带围栏的废话洗成一句干净的活动文本。
 * 既用于生成失败时的兜底，也用于展示时清理历史脏数据
 * （修复「TA 的日常」里直接显示 ```json {"activity":… 的格式 bug）。
 */
export function sanitizeLifeText(raw: string): string {
  if (!raw) return '';
  let t = stripFences(raw);
  // 仍是 JSON 残骸：优先抠 activity / summary 字段
  const field = looseField(t, 'activity') || looseField(t, 'summary');
  if (field) return looksLikeLifePromptLeak(field) ? '' : field.trim();
  if (looksLikeLifePromptLeak(t)) return '';
  // 否则去掉 JSON 标点与已知键名，留下可读文字
  t = t
    .replace(/^[\s{[]+/, '')
    .replace(/[\s}\]]+$/, '')
    .replace(/"?(activity|mood|location|summary)"?\s*:\s*/gi, '')
    .replace(/^["']+|["']+$/g, '')
    .replace(/[{}\[\]]/g, '')
    .trim();
  return looksLikeLifePromptLeak(t) ? '' : t;
}

/** 一个值若仍带围栏 / 像 JSON 残骸，再洗一遍；正常文本原样返回。 */
function cleanField(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const s = v.trim();
  if (!s) return undefined;
  if (looksLikeLifePromptLeak(s)) return undefined;
  if (s.includes('```') || /^[{\[]/.test(s) || /^"?(activity|summary)"?\s*:/i.test(s)) {
    return sanitizeLifeText(s) || undefined;
  }
  return s;
}

function looksLikeLifePromptLeak(raw: string): boolean {
  const t = raw.replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (/^(我们被要求|被要求|任务是|要求是|现在请|请生成|请按时间顺序生成)/.test(t)) return true;
  if (/【切片小事】/.test(t) && /(生成|生活密度|主动强度|来信口味|需要围绕)/.test(t)) return true;
  const hits = [
    /(?:我们)?被要求生成/,
    /生活密度\s*[:：]?\s*(?:sparse|normal|busy)/i,
    /主动强度\s*[:：]?\s*(?:quiet|balanced|chatty|unfiltered)/i,
    /来信口味\s*[:：]?\s*(?:natural|moody|teasing|caring)/i,
    /需要围绕.*(?:最近生活|生活线索|线索)/,
    /返回\s*JSON|只(?:返回|输出)\s*JSON/i,
  ].filter(re => re.test(t)).length;
  return hits >= 2;
}

interface LifeEventDraft {
  activity?: string;
  mood?: string;
  location?: string;
  summary?: string;
  eventKind?: CharLifeEvent['eventKind'];
  kind?: CharLifeEvent['eventKind'];
  energy?: CharLifeEvent['energy'];
  intensity?: number;
  shareWillingness?: number;
  thread?: string;
  proactiveAngle?: CharLifeEvent['proactiveAngle'];
  angle?: CharLifeEvent['proactiveAngle'];
}

const LIFE_EVENT_KINDS: NonNullable<CharLifeEvent['eventKind']>[] = [
  'routine', 'work', 'study', 'social', 'errand', 'rest', 'media', 'food', 'travel', 'health', 'emotion', 'relationship', 'accident', 'other',
];
const LIFE_EVENT_ENERGIES: NonNullable<CharLifeEvent['energy']>[] = ['low', 'medium', 'high'];
const LIFE_EVENT_ANGLES: NonNullable<CharLifeEvent['proactiveAngle']>[] = ['share', 'vent', 'ask', 'tease', 'care', 'invite', 'followup', 'silence', 'other'];

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback?: T): T | undefined {
  const s = String(value || '').trim() as T;
  return allowed.includes(s) ? s : fallback;
}

function draftToEvent(
  draft: LifeEventDraft,
  charId: string,
  timestamp: number,
  source: CharLifeEvent['source'],
  triggerSource?: CharLifeEvent['triggerSource'],
  extra?: Partial<CharLifeEvent>,
): CharLifeEvent | null {
  const activity = cleanField(draft.activity) || cleanField(draft.summary) || '';
  if (!activity) return null;
  const summary = cleanField(draft.summary) || activity;
  const eventKind = pickEnum(draft.eventKind || draft.kind, LIFE_EVENT_KINDS);
  const energy = pickEnum(draft.energy, LIFE_EVENT_ENERGIES);
  const proactiveAngle = pickEnum(draft.proactiveAngle || draft.angle, LIFE_EVENT_ANGLES);
  return {
    id: `life_${charId}_${timestamp}_${genId()}`,
    charId,
    timestamp,
    activity,
    mood: cleanField(draft.mood),
    location: cleanField(draft.location),
    summary,
    source,
    eventKind,
    energy,
    intensity: draft.intensity === undefined ? undefined : clampScore(draft.intensity, 50),
    shareWillingness: draft.shareWillingness === undefined ? undefined : clampScore(draft.shareWillingness, 55),
    thread: cleanField(draft.thread),
    proactiveAngle,
    triggerSource,
    ...extra,
  };
}

// ── 对外：推进一格生活（proactive 触发时调用）──────────────────────

// 文案见 utils/laiwangPrompts.ts → [3] 自主生活
const SINGLE_SYSTEM = AUTONOMOUS_SINGLE_SYSTEM;

/**
 * 让角色的生活往前走一格：生成一条 CharLifeEvent，落库、修剪，返回该事件。
 * 失败返回 null（调用方据此回退到旧的「主动找用户」逻辑）。
 */
export async function advanceLife(
  char: CharacterProfile,
  api: LifeApi,
  opts?: {
    source?: CharLifeEvent['source'];
    triggerSource?: CharLifeEvent['triggerSource'];
    now?: number;
    signal?: AbortSignal;
    recentChat?: string;
  },
): Promise<CharLifeEvent | null> {
  try {
    const now = opts?.now ?? Date.now();
    const recent = await DB.getLifeEvents(char.id, RECENT_EVENTS_FOR_CONTEXT);
    const schedule = await loadScheduleForLife(char, now);
    const scheduleContext = buildScheduleLifeContext(schedule, now);
    // 线上→线下：把最近聊了什么也给一眼，让 TA「此刻的生活」能自然呼应这段关系/对话
    // （只是参考，不是在回复对方，也不强行扯上）。
    const chatNote = (opts?.recentChat || '').trim();
    const userMsg = [
      personaBrief(char),
      '',
      `现在是：${describeTime(new Date(now))}`,
      `生活密度：${getLifeDensity(char)}；主动强度：${getProactiveIntensity(char)}；来信口味：${getMessageFlavor(char)}。`,
      `允许取材：${formatMaterialSources(char)}。`,
      '',
      ...(chatNote ? ['你和对方最近的对话（仅作参考，让你此刻的生活或心情能自然呼应，但你不是在回复对方、也不必强行扯上）：', chatNote, ''] : []),
      ...(scheduleContext.block ? [scheduleContext.block, ''] : []),
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
    // 先严格解析 → 截断时宽松抠字段 → 最后兜底清洗，绝不把 ```json {…} 原样落库。
    let draft = extractJson<LifeEventDraft>(raw) ?? looseDraft(raw);
    if (!draft) {
      const cleaned = sanitizeLifeText(raw);
      draft = cleaned ? { activity: cleaned.slice(0, 120) } : null;
    }
    if (!draft) return null;
    const event = draftToEvent(
      draft,
      char.id,
      now,
      opts?.source ?? 'proactive',
      opts?.triggerSource ?? opts?.source ?? 'proactive',
      scheduleEventPatch(schedule, now),
    );
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

function planCatchupCount(gapMs: number, density: LifeDensity): number {
  const plan = catchupPlanForDensity(density);
  const byTime = Math.round(gapMs / plan.everyMs);
  return Math.max(1, Math.min(plan.max, byTime));
}

// 文案见 utils/laiwangPrompts.ts → [3] 自主生活
const BATCH_SYSTEM = AUTONOMOUS_BATCH_SYSTEM;

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
    const density = getLifeDensity(char);
    const n = planCatchupCount(gapMs, density) - existingInGap;
    if (n <= 0) return [];
    const recent = all.slice(-RECENT_EVENTS_FOR_CONTEXT);
    const hours = Math.round(gapMs / (60 * 60 * 1000));
    const step = gapMs / (n + 1);
    const plannedTimestamps = Array.from({ length: n }, (_, i) => Math.round(gapStart + step * (i + 1)));
    const schedules = await loadSchedulesForLife(char, plannedTimestamps);
    const scheduleContext = buildCatchupScheduleContext(schedules, plannedTimestamps);
    const userMsg = [
      personaBrief(char),
      '',
      `这段时间：从 ${describeTime(new Date(gapStart))} 到 ${describeTime(new Date(now))}（大约 ${hours} 小时）。`,
      '',
      `生活密度：${density}；主动强度：${getProactiveIntensity(char)}；允许取材：${formatMaterialSources(char)}。`,
      '',
      ...(scheduleContext ? [scheduleContext, ''] : []),
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
    // 数组完整就直接解析；被截断时退而求其次，逐个抠出已写完的对象。
    let drafts = extractJson<LifeEventDraft[]>(raw);
    if (!Array.isArray(drafts) || drafts.length === 0) {
      drafts = extractObjects<LifeEventDraft>(raw);
    }
    if (!Array.isArray(drafts) || drafts.length === 0) return [];

    const picked = drafts.slice(0, n);
    const events: CharLifeEvent[] = [];
    for (let i = 0; i < picked.length; i++) {
      const ts = plannedTimestamps[i] ?? Math.round(gapStart + (gapMs / (picked.length + 1)) * (i + 1));
      const ev = draftToEvent(picked[i], char.id, ts, 'catchup', 'catchup', scheduleEventPatch(schedules[i] || null, ts));
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

// ── 对外：主动消息 v2 回合规划 ────────────────────────────────────

function pickReusableLifeEvent(events: CharLifeEvent[], now: number): CharLifeEvent | null {
  const candidates = events
    .filter(e => e.timestamp <= now && !e.surfacedAsMsg)
    .filter(e => !!sanitizeLifeText(e.activity))
    .filter(e => now - e.timestamp <= 8 * 60 * 60 * 1000)
    .sort((a, b) => {
      const scoreDiff = scoreLifeEventForProactive(b) - scoreLifeEventForProactive(a);
      return scoreDiff || b.timestamp - a.timestamp;
    });
  return candidates[0] || null;
}

/**
 * 主动消息 v2：先让角色继续生活，再决定这轮是否值得打扰用户。
 * - 固定间隔默认发；
 * - 随机/智能触发可因为事件分数低而只记录生活；
 * - 勿扰时段可配置为继续发、只记生活或跳过。
 */
export async function planAutonomousProactiveTurn(
  char: CharacterProfile,
  api: LifeApi,
  opts?: AutonomousProactivePlanOptions,
): Promise<AutonomousProactivePlan> {
  const now = opts?.now ?? Date.now();
  const quiet = resolveQuietHours(char, now);
  const materialSources = getMaterialSources(char);

  if (quiet.active && quiet.behavior === 'skip') {
    return { decision: 'skip', event: null, reason: 'quiet_hours_skip', generated: false, reused: false, quietHoursActive: true, score: 0 };
  }
  if (!materialSources.includes('life')) {
    return {
      decision: quiet.active && quiet.behavior === 'life_only' ? 'life_only' : 'send',
      event: null,
      reason: 'life_material_disabled',
      generated: false,
      reused: false,
      quietHoursActive: quiet.active,
      score: 0,
    };
  }

  let event: CharLifeEvent | null = null;
  let generated = false;
  let reused = false;
  try {
    const recent = await DB.getLifeEventsSince(char.id, now - 8 * 60 * 60 * 1000);
    const last = recent.filter(e => e.timestamp <= now).slice(-1)[0];
    const reusable = pickReusableLifeEvent(recent, now);
    const cooldown = lifeGenerationCooldownMs(getLifeDensity(char));
    const shouldGenerate = !reusable || !last || now - last.timestamp >= cooldown;

    if (shouldGenerate) {
      event = await advanceLife(char, api, {
        source: 'proactive',
        triggerSource: 'proactive',
        now,
        signal: opts?.signal,
        recentChat: materialSources.includes('recentChat') ? opts?.recentChat : '',
      });
      generated = !!event;
    }
    if (!event && reusable) {
      event = reusable;
      reused = true;
    }
  } catch (e) {
    console.warn('[AutonomousLife] planAutonomousProactiveTurn failed to prepare event:', e);
  }

  if (quiet.active && quiet.behavior === 'life_only') {
    return {
      decision: 'life_only',
      event,
      reason: event ? 'quiet_hours_life_only' : 'quiet_hours_no_event',
      generated,
      reused,
      quietHoursActive: true,
      score: scoreLifeEventForProactive(event),
    };
  }

  if (!event) {
    return { decision: 'send', event: null, reason: 'no_life_event_fallback', generated, reused, quietHoursActive: quiet.active, score: 0 };
  }

  const score = scoreLifeEventForProactive(event);
  const smartSkip = !!opts?.randomMode && char.proactiveConfig?.smartSkipEnabled !== false;
  if (smartSkip && score < proactiveThreshold(getProactiveIntensity(char))) {
    return { decision: 'life_only', event, reason: 'low_share_willingness', generated, reused, quietHoursActive: quiet.active, score };
  }

  return { decision: 'send', event, reason: generated ? 'generated_life_event' : 'reused_life_event', generated, reused, quietHoursActive: quiet.active, score };
}

// ── 对外：把「近来的线下生活」拼成线上聊天上下文（让线上/线下关联）──────

/**
 * 关键「关联」点：把角色最近的线下自主生活事件拼成一段，注入到线上聊天的 system prompt，
 * 让在线聊天时角色「知道自己这段时间在过什么日子」、能自然提起或被影响——而不是线上、
 * 线下两套互不相通。
 *
 * 仅在「开启了自主生活」且「近 windowMs 内确有事件」时返回文本，否则空串（不污染 prompt）。
 */
export async function buildRecentLifeContextBlock(
  char: CharacterProfile,
  userName: string,
  opts?: { windowMs?: number; max?: number; now?: number },
): Promise<string> {
  try {
    if (!isAutonomousLifeEnabled(char)) return '';
    const now = opts?.now ?? Date.now();
    const windowMs = opts?.windowMs ?? 36 * 60 * 60 * 1000; // 默认看近 36 小时的生活
    const max = opts?.max ?? 8;
    const recent = (await DB.getLifeEventsSince(char.id, now - windowMs))
      .filter(e => e.timestamp <= now)
      .slice(-max);
    if (recent.length === 0) return '';
    const lines = recent.map(e => {
      const t = describeTime(new Date(e.timestamp));
      const activity = sanitizeLifeText(e.activity) || sanitizeLifeText(e.summary || '');
      if (!activity) return '';
      const location = e.location ? sanitizeLifeText(e.location) : '';
      const moodText = e.mood ? sanitizeLifeText(e.mood) : '';
      const where = location ? `（在${location}）` : '';
      const mood = moodText ? `，${moodText}` : '';
      const tags = [e.eventKind, e.energy, e.thread ? `线索:${sanitizeLifeText(e.thread)}` : ''].filter(Boolean).join(' / ');
      return `- ${t}${where}：${activity}${mood}${tags ? `（${tags}）` : ''}`;
    }).filter(Boolean).join('\n');
    if (!lines) return '';
    return `\n${recentLifeContextIntro(userName)}\n${lines}\n`;
  } catch (e) {
    console.warn('[AutonomousLife] buildRecentLifeContextBlock failed:', e);
    return '';
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
  forceReplyAllowed?: boolean;
}): string {
  const { char, userName, timeStr, timeSinceUser, event, randomMode, proactiveCallAllowed, forceReplyAllowed } = args;
  const location = event.location ? sanitizeLifeText(event.location) : '';
  const moodText = event.mood ? sanitizeLifeText(event.mood) : '';
  const where = location ? `（在${location}）` : '';
  const mood = moodText ? `，此刻的心情是「${moodText}」` : '';
  const thread = event.thread ? sanitizeLifeText(event.thread) : '';
  const activity = sanitizeLifeText(event.activity) || sanitizeLifeText(event.summary) || '刚刚经历了一件很小的日常插曲';
  const gapNote = timeSinceUser
    ? `${userName}已经 ${timeSinceUser} 没找你了，但你有你自己的生活，不必一直围着 ${userName} 转。`
    : '';
  // 文案见 utils/laiwangPrompts.ts → [3] 自主生活
  return autonomousProactiveHint({
    userName,
    timeStr,
    activity,
    where,
    mood,
    gapNote,
    randomMode,
    proactiveCallAllowed,
    forceReplyAllowed,
    eventKind: event.eventKind,
    energy: event.energy,
    proactiveAngle: event.proactiveAngle,
    thread,
    messageFlavor: getMessageFlavor(char),
    materialSources: formatMaterialSources(char),
    score: scoreLifeEventForProactive(event),
  });
}
