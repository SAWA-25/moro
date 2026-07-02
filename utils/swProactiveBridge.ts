/**
 * 离线主动消息桥（Service Worker ↔ 主线程共享）
 * ================================================
 * 目标：用户即使关掉 / 后台冻结了 moro 网站，Service Worker 被 Web Push 唤醒后，
 * 也能自己调「副 API」生成一条主动消息（取材角色的日常），落 inbox + 弹系统通知。
 *
 * 关键约束：本文件会被 **打进 SW bundle**（worker/sw-keep-alive.ts import 它，
 * 见 scripts/build-workers.mjs），所以这里**只能用 indexedDB / fetch 这类
 * Worker 与主线程都有的 API**，绝不能碰 window / document / localStorage，
 * 也不要 import utils/db.ts、laiwangPrompts 等带 DOM 依赖或体量大的模块——
 * 主线程侧的快照构建放在 utils/mirrorProactive.ts（不会被 SW 引用）。
 *
 * 数据：独立的小库 MoroProactiveSW（不挂主库 utils/db.ts 的 schema/version，
 * 两边各自 open，互不耦合）。主线程定期把「每个开了主动消息的角色」的紧凑快照
 * （人设系统提示 + 最近几条对话 + 解析好的 API）写进来；SW 读它来生成。
 */

import { buildOpenAiEndpoint, buildOpenAiHeaders, extractApiErrorMessage } from './openAiCompat';

const DB_NAME = 'MoroProactiveSW';
const DB_VERSION = 1;
const STORE_CHARS = 'chars'; // keyPath: 'charId'

export interface SwApiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface SwLifeEventSnapshot {
  timestamp: number;
  activity: string;
  mood?: string;
  location?: string;
  summary?: string;
  surfacedAsMsg?: boolean;
  eventKind?: string;
  energy?: string;
  intensity?: number;
  shareWillingness?: number;
  thread?: string;
  proactiveAngle?: string;
}

export interface SwProactiveV2Config {
  intensity?: 'quiet' | 'balanced' | 'chatty' | 'unfiltered';
  messageFlavor?: 'natural' | 'self' | 'warm' | 'playful' | 'moody';
  materialSources?: string[];
  quietHours?: {
    enabled: boolean;
    start: string;
    end: string;
    behavior: 'send' | 'life_only' | 'skip';
  };
}

export interface SwProactiveSnapshot {
  charId: string;
  name: string;
  avatar?: string;
  enabled: boolean;
  api: SwApiConfig;
  /** 紧凑系统提示：人设 + 当下日常 + 「主动发一条消息」的指令 */
  systemPrompt: string;
  /** 最后一句用户侧 nudge（很多 OpenAI 兼容端要求最后一轮是 user） */
  instruction: string;
  /** 最近若干条对话（role + content，已截断） */
  recentMessages: { role: string; content: string }[];
  /** v2：主线程镜像的近期生活事件。SW 不写主库，只消费这些快照。 */
  lifeEvents?: SwLifeEventSnapshot[];
  /** v2：主动消息设置的轻量镜像。 */
  proactiveV2?: SwProactiveV2Config;
  updatedAt: number;
  /** SW 最近一次为该角色生成主动消息的时间（主线程据此对账，避免回前台重复触发） */
  lastGenAt?: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) {
      reject(e);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_CHARS)) {
        db.createObjectStore(STORE_CHARS, { keyPath: 'charId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('MoroProactiveSW open blocked'));
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | void> {
  return openDb().then(db => new Promise<T | void>((resolve, reject) => {
    let request: IDBRequest<T> | void;
    const t = db.transaction(STORE_CHARS, mode);
    t.oncomplete = () => { try { db.close(); } catch { /* ignore */ } resolve(request ? (request as IDBRequest<T>).result : undefined); };
    t.onerror = () => { try { db.close(); } catch { /* ignore */ } reject(t.error); };
    t.onabort = () => { try { db.close(); } catch { /* ignore */ } reject(t.error); };
    request = run(t.objectStore(STORE_CHARS));
  }));
}

export async function swPutSnapshot(snap: SwProactiveSnapshot): Promise<void> {
  await tx('readwrite', store => store.put(snap));
}

export async function swDeleteSnapshot(charId: string): Promise<void> {
  await tx('readwrite', store => store.delete(charId));
}

export async function swReadSnapshot(charId: string): Promise<SwProactiveSnapshot | null> {
  const res = await tx<SwProactiveSnapshot>('readonly', store => store.get(charId));
  return (res as SwProactiveSnapshot) || null;
}

export async function swReadAll(): Promise<SwProactiveSnapshot[]> {
  const res = await tx<SwProactiveSnapshot[]>('readonly', store => store.getAll());
  return (res as SwProactiveSnapshot[]) || [];
}

/** 只保留给定 charId 的快照，其余删除（角色关掉主动消息后清理）。 */
export async function swKeepOnly(charIds: string[]): Promise<void> {
  const keep = new Set(charIds);
  const all = await swReadAll();
  for (const s of all) {
    if (!keep.has(s.charId)) await swDeleteSnapshot(s.charId);
  }
}

/** SW 生成完一条主动消息后，记下时间，供主线程对账防重复触发。 */
export async function swMarkGenerated(charId: string, ts: number): Promise<void> {
  const snap = await swReadSnapshot(charId);
  if (!snap) return;
  snap.lastGenAt = ts;
  await swPutSnapshot(snap);
}

// ── 纯函数：组 prompt / 调 LLM / 清洗（SW 与主线程都用）──────────────

function parseHHmm(value: string | undefined, fallback: number): number {
  const m = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return fallback;
  const h = Math.max(0, Math.min(23, parseInt(m[1], 10)));
  const min = Math.max(0, Math.min(59, parseInt(m[2], 10)));
  return h * 60 + min;
}

export function swResolveQuietHours(snap: SwProactiveSnapshot, now = Date.now()): { active: boolean; behavior: 'send' | 'life_only' | 'skip' } {
  const q = snap.proactiveV2?.quietHours;
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

export function swShouldGenerateProactive(snap: SwProactiveSnapshot, now = Date.now()): { ok: boolean; reason: string } {
  if (!snap?.enabled) return { ok: false, reason: 'disabled' };
  if (!snap.api?.baseUrl || !snap.api?.model) return { ok: false, reason: 'missing_api' };
  if (snap.updatedAt && now - snap.updatedAt > 48 * 60 * 60 * 1000) return { ok: false, reason: 'stale_snapshot' };
  const quiet = swResolveQuietHours(snap, now);
  if (quiet.active && quiet.behavior !== 'send') return { ok: false, reason: `quiet_hours_${quiet.behavior}` };
  return { ok: true, reason: 'ok' };
}

function formatLifeEventsForPrompt(events: SwLifeEventSnapshot[] | undefined): string {
  const picked = (events || [])
    .filter(e => e && e.activity)
    .slice(-5);
  if (picked.length === 0) return '';
  const lines = picked.map(e => {
    const d = new Date(e.timestamp);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const tags = [e.eventKind, e.energy, e.proactiveAngle, e.thread ? `线索:${e.thread}` : ''].filter(Boolean).join(' / ');
    return `- ${hh}:${mm}${e.location ? `（${e.location}）` : ''}：${e.activity}${e.mood ? `，${e.mood}` : ''}${tags ? `（${tags}）` : ''}`;
  });
  return `\n你最近自己的生活切片（不是汇报素材，要压成一句真实消息）：\n${lines.join('\n')}\n`;
}

export function swBuildMessages(snap: SwProactiveSnapshot): { role: string; content: string }[] {
  const v2 = snap.proactiveV2;
  const v2Prompt = [
    formatLifeEventsForPrompt(snap.lifeEvents),
    v2?.messageFlavor ? `来信口味：${v2.messageFlavor}。` : '',
    v2?.materialSources?.length ? `允许取材：${v2.materialSources.join('、')}。` : '',
    '不要写成“我今天做了A/B/C”的流水账；只输出一条会真的发进聊天框的消息正文。',
  ].filter(Boolean).join('\n');
  const msgs: { role: string; content: string }[] = [{ role: 'system', content: `${snap.systemPrompt}${v2Prompt ? `\n${v2Prompt}` : ''}` }];
  for (const m of snap.recentMessages || []) {
    if (!m || !m.content) continue;
    msgs.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content).slice(0, 500) });
  }
  msgs.push({ role: 'user', content: snap.instruction || '（轮到你主动发消息了，直接写消息正文）' });
  return msgs;
}

/** 调用 OpenAI 兼容聊天补全端点（镜像 autonomousLife.callLLM，可在 SW 内跑）。 */
export async function swCallLLM(api: SwApiConfig, messages: { role: string; content: string }[], maxTokens = 400, signal?: AbortSignal): Promise<string> {
  const baseUrl = (api.baseUrl || '').trim();
  if (!baseUrl || !api.model) return '';
  try {
    const res = await fetch(buildOpenAiEndpoint(baseUrl, 'chat.completions'), {
      method: 'POST',
      headers: buildOpenAiHeaders(api.apiKey),
      body: JSON.stringify({ model: api.model, messages, temperature: 0.92, max_tokens: maxTokens, stream: false }),
      signal,
    });
    const data: any = await res.json().catch(async () => ({ message: await res.text().catch(() => '') }));
    if (!res.ok) {
      console.warn('[swProactiveBridge] LLM failed:', extractApiErrorMessage(data, `HTTP ${res.status}`));
      return '';
    }
    return data?.choices?.[0]?.message?.content || '';
  } catch {
    return '';
  }
}

/** 清洗模型输出：剥代码围栏、首尾引号、动作标记，留下纯消息正文。 */
export function swCleanProactiveText(raw: string): string {
  let t = (raw || '').trim();
  if (!t) return '';
  // 代码围栏
  t = t.replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/, '').trim();
  // 整段被引号包裹时去掉外层引号
  t = t.replace(/^[「『"'""]/, '').replace(/[」』"'""]$/, '').trim();
  // 去掉成对的动作/指令标记 [[ACTION:...]] 与独立的 [xxx] 旁白行
  t = t.replace(/\[\[[^\]]*\]\]/g, '').trim();
  return t.slice(0, 600);
}
