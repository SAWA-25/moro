import { AppID, UserScreenWatchComment, UserScreenWatchFrame, UserScreenWatchSession, UserScreenWatchSettings, UserScreenWatchUsageSlice } from '../types';
import { sanitizeAssistantVisibleText } from './promptPrivacy';

export const USER_SCREEN_WATCH_MAX_FRAMES = 20;
export const USER_SCREEN_WATCH_MAX_COMMENTS = 80;
export const USER_SCREEN_WATCH_MAX_SESSIONS = 30;
export const USER_SCREEN_WATCH_CONTEXT_TTL_MS = 30 * 60 * 1000;

export const DEFAULT_USER_SCREEN_WATCH_SETTINGS: UserScreenWatchSettings = {
  captureFrames: true,
  trackMoroUsage: true,
  floatingEnabled: true,
  sampleIntervalMs: 20_000,
  commentCooldownMs: 45_000,
};

const clampMs = (value: unknown, fallback: number, min: number, max: number): number => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
};

const uid = (prefix: string, now = Date.now()): string =>
  `${prefix}-${now}-${Math.random().toString(36).slice(2, 8)}`;

const USER_SCREEN_WATCH_COMMENT_KEYS = ['text', 'comment', 'content', 'message', 'reply', '短评', '评论', '正文'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const stripUserScreenWatchCommentFence = (raw: string): string => {
  let text = raw.trim();
  const wholeFence = text.match(/^```(?:[a-zA-Z0-9_-]+)?\s*([\s\S]*?)\s*```$/);
  if (wholeFence) return wholeFence[1].trim();
  text = text
    .replace(/^```(?:[a-zA-Z0-9_-]+)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  return text.replace(/^json\s*(?=[{\[])/i, '').trim();
};

const pickUserScreenWatchCommentField = (value: unknown, depth = 0): unknown | undefined => {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const picked = pickUserScreenWatchCommentField(item, depth + 1);
      if (picked !== undefined) return picked;
    }
    return undefined;
  }
  if (!isRecord(value) || depth > 2) return undefined;

  const entries = Object.entries(value);
  for (const key of USER_SCREEN_WATCH_COMMENT_KEYS) {
    const found = entries.find(([name]) => name.toLowerCase() === key.toLowerCase());
    if (found && found[1] !== undefined && found[1] !== null) return found[1];
  }

  for (const key of ['data', 'result', 'payload', 'output']) {
    const nested = value[key];
    if (nested !== undefined && nested !== null) {
      const picked = pickUserScreenWatchCommentField(nested, depth + 1);
      if (picked !== undefined) return picked;
    }
  }
  return undefined;
};

const parseJsonishUserScreenWatchComment = (text: string): unknown | undefined => {
  const clean = stripUserScreenWatchCommentFence(text);
  const candidates = [clean];
  const firstObj = clean.indexOf('{');
  const lastObj = clean.lastIndexOf('}');
  if (firstObj >= 0 && lastObj > firstObj) candidates.push(clean.slice(firstObj, lastObj + 1));
  const firstArr = clean.indexOf('[');
  const lastArr = clean.lastIndexOf(']');
  if (firstArr >= 0 && lastArr > firstArr) candidates.push(clean.slice(firstArr, lastArr + 1));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      const picked = pickUserScreenWatchCommentField(parsed);
      if (picked !== undefined) return picked;
      if (/^\s*[{[]/.test(candidate)) return '';
    } catch { /* try the next shape */ }
  }

  for (const key of USER_SCREEN_WATCH_COMMENT_KEYS) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = clean.match(new RegExp(`["']${escaped}["']\\s*[:：]\\s*("(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|[^,}\\]\\n\\r]+)`, 'i'));
    if (!match) continue;
    const rawValue = match[1].trim();
    if (!rawValue || /^[}\]]?$/.test(rawValue)) return '';
    if (rawValue.startsWith('"')) {
      try { return JSON.parse(rawValue); } catch { return rawValue.slice(1, -1); }
    }
    if (rawValue.startsWith("'")) return rawValue.slice(1, -1);
    return rawValue;
  }

  return undefined;
};

const looksLikeRawUserScreenWatchJson = (text: string): boolean =>
  /^(?:json\s*)?[{\[]/i.test(stripUserScreenWatchCommentFence(text));

export function sanitizeUserScreenWatchComment(raw: unknown, maxLen = 90): string {
  const limit = Math.max(0, Math.round(Number(maxLen) || 90));
  const picked = typeof raw === 'string'
    ? parseJsonishUserScreenWatchComment(raw)
    : pickUserScreenWatchCommentField(raw);
  if (picked !== undefined) raw = picked;

  let text = stripUserScreenWatchCommentFence(String(raw ?? ''));
  if (!text) return '';
  if (picked === undefined && looksLikeRawUserScreenWatchJson(text)) return '';

  text = text
    .replace(/^(?:短评|评论|回复|内容|text|comment|content|message)\s*[:：]\s*/i, '')
    .replace(/```/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  text = sanitizeAssistantVisibleText(text);

  while (/^["'「『“‘]/.test(text) && /["'」』”’]$/.test(text) && text.length >= 2) {
    text = text.slice(1, -1).trim();
  }

  if (!text || looksLikeRawUserScreenWatchJson(text)) return '';
  return limit ? text.slice(0, limit) : '';
}

export function normalizeUserScreenWatchSettings(input?: Partial<UserScreenWatchSettings> | null): UserScreenWatchSettings {
  return {
    captureFrames: input?.captureFrames ?? DEFAULT_USER_SCREEN_WATCH_SETTINGS.captureFrames,
    trackMoroUsage: input?.trackMoroUsage ?? DEFAULT_USER_SCREEN_WATCH_SETTINGS.trackMoroUsage,
    floatingEnabled: input?.floatingEnabled ?? DEFAULT_USER_SCREEN_WATCH_SETTINGS.floatingEnabled,
    sampleIntervalMs: clampMs(input?.sampleIntervalMs, DEFAULT_USER_SCREEN_WATCH_SETTINGS.sampleIntervalMs, 5_000, 120_000),
    commentCooldownMs: clampMs(input?.commentCooldownMs, DEFAULT_USER_SCREEN_WATCH_SETTINGS.commentCooldownMs, 10_000, 180_000),
  };
}

export function createUserScreenWatchSession(params: {
  charId: string;
  charName: string;
  now?: number;
  settings?: Partial<UserScreenWatchSettings>;
}): UserScreenWatchSession {
  const now = params.now ?? Date.now();
  return {
    id: uid('usw', now),
    charId: params.charId,
    charName: params.charName,
    startedAt: now,
    updatedAt: now,
    status: 'active',
    settings: normalizeUserScreenWatchSettings(params.settings),
    usage: [],
    frames: [],
    comments: [],
  };
}

export function appendUserScreenWatchFrame(
  session: UserScreenWatchSession,
  frame: Omit<UserScreenWatchFrame, 'id'> & { id?: string },
): UserScreenWatchSession {
  const item: UserScreenWatchFrame = {
    id: frame.id || uid('usw-frame', frame.capturedAt),
    capturedAt: frame.capturedAt,
    imageDataUrl: frame.imageDataUrl,
    sourceLabel: frame.sourceLabel,
    inferredApp: frame.inferredApp,
    summary: frame.summary,
  };
  return {
    ...session,
    updatedAt: Math.max(session.updatedAt || 0, item.capturedAt),
    frames: [...(session.frames || []), item].slice(-USER_SCREEN_WATCH_MAX_FRAMES),
  };
}

export function appendUserScreenWatchComment(
  session: UserScreenWatchSession,
  comment: Omit<UserScreenWatchComment, 'id'> & { id?: string },
): UserScreenWatchSession {
  const text = sanitizeUserScreenWatchComment(comment.text);
  const item: UserScreenWatchComment = {
    id: comment.id || uid('usw-comment', comment.createdAt),
    frameId: comment.frameId,
    text,
    createdAt: comment.createdAt,
    source: comment.source,
  };
  return {
    ...session,
    updatedAt: Math.max(session.updatedAt || 0, item.createdAt),
    comments: [...(session.comments || []), item].filter(c => c.text).slice(-USER_SCREEN_WATCH_MAX_COMMENTS),
  };
}

export function canGenerateUserScreenWatchComment(session: UserScreenWatchSession, now = Date.now(), force = false): boolean {
  if (session.status === 'ended' || session.status === 'error') return false;
  if (force) return true;
  const last = [...(session.comments || [])].reverse().find(c => c.source !== 'summary');
  if (!last) return true;
  return now - last.createdAt >= normalizeUserScreenWatchSettings(session.settings).commentCooldownMs;
}

export function recordUserScreenWatchUsage(
  session: UserScreenWatchSession,
  slice: Omit<UserScreenWatchUsageSlice, 'durationMs'> & { durationMs?: number },
): UserScreenWatchSession {
  const startedAt = Number(slice.startedAt) || Date.now();
  const endedAt = Math.max(startedAt, Number(slice.endedAt) || startedAt);
  const durationMs = Math.max(0, slice.durationMs ?? endedAt - startedAt);
  if (!slice.appId || durationMs <= 0) return session;

  const nextSlice: UserScreenWatchUsageSlice = {
    appId: slice.appId,
    appName: (slice.appName || slice.appId).trim(),
    startedAt,
    endedAt,
    durationMs,
  };
  const usage = [...(session.usage || [])];
  const last = usage[usage.length - 1];
  if (last && last.appId === nextSlice.appId && Math.abs(last.endedAt - nextSlice.startedAt) <= 1_500) {
    usage[usage.length - 1] = {
      ...last,
      endedAt: Math.max(last.endedAt, nextSlice.endedAt),
      durationMs: Math.max(0, Math.max(last.endedAt, nextSlice.endedAt) - last.startedAt),
    };
  } else {
    usage.push(nextSlice);
  }
  return {
    ...session,
    updatedAt: Math.max(session.updatedAt || 0, nextSlice.endedAt),
    usage,
  };
}

export function endUserScreenWatchSession(
  session: UserScreenWatchSession,
  now = Date.now(),
  status: 'ended' | 'error' = 'ended',
  summary?: string,
): UserScreenWatchSession {
  return {
    ...session,
    status,
    endedAt: now,
    updatedAt: now,
    summary: summary ?? session.summary,
  };
}

export function trimUserScreenWatchSessions(
  sessions: UserScreenWatchSession[] = [],
  keepN = USER_SCREEN_WATCH_MAX_SESSIONS,
): UserScreenWatchSession[] {
  return [...sessions]
    .filter(Boolean)
    .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))
    .slice(0, Math.max(0, keepN))
    .map(session => ({
      ...session,
      frames: (session.frames || []).slice(-USER_SCREEN_WATCH_MAX_FRAMES),
      comments: (session.comments || []).slice(-USER_SCREEN_WATCH_MAX_COMMENTS),
    }));
}

export function formatDurationZh(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours}小时${rest}分钟` : `${hours}小时`;
  }
  if (minutes > 0) return seconds ? `${minutes}分${seconds}秒` : `${minutes}分钟`;
  return `${seconds}秒`;
}

export function formatMoroUsage(usage: UserScreenWatchUsageSlice[] = [], limit = 5): string {
  const totals = new Map<string, { appName: string; durationMs: number }>();
  usage.forEach(slice => {
    if (!slice || slice.durationMs <= 0) return;
    const key = String(slice.appId || slice.appName || 'unknown');
    const prev = totals.get(key);
    totals.set(key, {
      appName: slice.appName || key,
      durationMs: (prev?.durationMs || 0) + slice.durationMs,
    });
  });
  const rows = [...totals.values()]
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, limit)
    .map(item => `${item.appName} ${formatDurationZh(item.durationMs)}`);
  return rows.length ? rows.join('、') : '暂无 Moro 内部 App 停留记录';
}

export function buildUserScreenWatchSummary(session: UserScreenWatchSession): string {
  const duration = formatDurationZh((session.endedAt || session.updatedAt || Date.now()) - session.startedAt);
  const comments = (session.comments || [])
    .filter(c => c.source !== 'summary')
    .map(c => ({ ...c, text: sanitizeUserScreenWatchComment(c.text) }))
    .filter(c => c.text);
  const latest = comments.slice(-3).map(c => c.text).filter(Boolean);
  const usageLine = formatMoroUsage(session.usage || [], 4);
  const frameCount = (session.frames || []).length;
  const lines = [
    `观屏评论已结束，共持续 ${duration}。`,
    `本次只记录了用户主动共享期间的网页端抽帧与 Moro 内部 App 停留：${usageLine}。`,
    `保留缩略帧 ${frameCount} 张，角色实时短评 ${comments.length} 条。`,
  ];
  if (latest.length) lines.push(`最近短评：${latest.join(' / ')}`);
  return lines.join('\n');
}

export function isUserScreenWatchContextFresh(session: UserScreenWatchSession | undefined | null, now = Date.now()): boolean {
  if (!session) return false;
  if (session.status === 'active' || session.status === 'paused') return true;
  const endedAt = session.endedAt || session.updatedAt || session.startedAt;
  return now - endedAt <= USER_SCREEN_WATCH_CONTEXT_TTL_MS;
}

export function buildUserScreenWatchContextLines(session: UserScreenWatchSession, now = Date.now()): string[] {
  if (!isUserScreenWatchContextFresh(session, now)) return [];
  const comments = (session.comments || [])
    .filter(c => c.source !== 'summary')
    .map(c => ({ ...c, text: sanitizeUserScreenWatchComment(c.text) }))
    .filter(c => c.text)
    .slice(-3)
    .map(c => `- ${new Date(c.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ${session.charName}短评：${c.text}`);
  const frames = (session.frames || [])
    .slice(-3)
    .map(frame => {
      const bits = [frame.inferredApp ? `推测画面：${frame.inferredApp}` : '', frame.summary || ''].filter(Boolean).join('，');
      return bits ? `- ${bits}` : '';
    })
    .filter(Boolean);
  return [
    `- 观屏状态：${session.status === 'active' ? '正在共享' : session.status === 'paused' ? '已暂停采样' : '刚刚结束'}。`,
    `- Moro 内部 App 停留：${formatMoroUsage(session.usage || [], 3)}。`,
    ...frames,
    ...comments,
  ].slice(0, 8);
}

export function makeUserScreenWatchTextFrameSummary(frame?: UserScreenWatchFrame, usage?: UserScreenWatchUsageSlice[]): string {
  const parts: string[] = [];
  if (frame?.inferredApp) parts.push(`截图视觉推测正在看：${frame.inferredApp}`);
  if (frame?.summary) parts.push(`截图摘要：${frame.summary}`);
  parts.push(`Moro 内部使用：${formatMoroUsage(usage || [], 3)}`);
  return parts.join('\n');
}

export async function captureVideoFrame(video: HTMLVideoElement, maxWidth = 480, quality = 0.62): Promise<string | null> {
  const width = video.videoWidth || video.clientWidth;
  const height = video.videoHeight || video.clientHeight;
  if (!width || !height) return null;
  const scale = Math.min(1, maxWidth / width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

export function fallbackAppName(appId: AppID | string): string {
  const raw = String(appId || '');
  if (!raw) return 'Moro';
  return raw.replace(/_/g, ' ').replace(/\b\w/g, s => s.toUpperCase());
}
