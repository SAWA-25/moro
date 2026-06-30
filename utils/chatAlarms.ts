import { ChatAlarm, ChatAlarmChannel, ChatAlarmKind, CharacterProfile } from '../types';
import { chatAlarmHint } from './laiwangPrompts';

export const CHAT_ALARM_GRACE_MS = 2 * 60 * 60 * 1000;
export const CHAT_ALARM_NATIVE_WINDOW_DAYS = 14;
export const CHAT_ALARM_LOCK_MS = 90_000;

export const CHAT_ALARM_WEEKDAYS = [
  { value: 1, label: '一' },
  { value: 2, label: '二' },
  { value: 3, label: '三' },
  { value: 4, label: '四' },
  { value: 5, label: '五' },
  { value: 6, label: '六' },
  { value: 0, label: '日' },
] as const;

export const EVERYDAY_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];
export const WORKDAY_WEEKDAYS = [1, 2, 3, 4, 5];

const KIND_LABEL: Record<ChatAlarmKind, string> = {
  sleep: '睡觉督促',
  wake: '起床叫醒',
  custom: '提醒',
};

const CHANNEL_LABEL: Record<ChatAlarmChannel, string> = {
  auto: '自动',
  reminder: '闹钟提醒',
  call: '语音来电',
};

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function normalizeAlarmTime(value: string, fallback = '07:30'): string {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{1,2}):(\d{1,2})$/);
  if (!match) return fallback;
  const h = Math.max(0, Math.min(23, Number(match[1]) || 0));
  const m = Math.max(0, Math.min(59, Number(match[2]) || 0));
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function isValidAlarmTime(value: string): boolean {
  return HHMM_RE.test(value);
}

export function normalizeWeekdays(days?: number[]): number[] {
  const set = new Set<number>();
  (days && days.length ? days : EVERYDAY_WEEKDAYS).forEach(day => {
    const n = Number(day);
    if (Number.isInteger(n) && n >= 0 && n <= 6) set.add(n);
  });
  const arr = Array.from(set);
  return arr.length ? arr.sort((a, b) => a - b) : [...EVERYDAY_WEEKDAYS];
}

export function weekdayLabel(days?: number[]): string {
  const normalized = normalizeWeekdays(days);
  if (normalized.length === 7) return '每天';
  if (normalized.length === 5 && WORKDAY_WEEKDAYS.every(d => normalized.includes(d))) return '工作日';
  return CHAT_ALARM_WEEKDAYS
    .filter(d => normalized.includes(d.value))
    .map(d => `周${d.label}`)
    .join('、');
}

function candidateAt(base: Date, hhmm: string): Date {
  const time = normalizeAlarmTime(hhmm);
  const [h, m] = time.split(':').map(Number);
  const d = new Date(base);
  d.setHours(h, m, 0, 0);
  return d;
}

export function computeNextAlarmAt(
  timeHHmm: string,
  weekdays?: number[],
  fromMs: number = Date.now(),
  includeNow = false,
): number {
  const normalizedDays = normalizeWeekdays(weekdays);
  const from = new Date(fromMs);
  for (let offset = 0; offset <= 8; offset += 1) {
    const d = new Date(from);
    d.setDate(from.getDate() + offset);
    if (!normalizedDays.includes(d.getDay())) continue;
    const candidate = candidateAt(d, timeHHmm);
    if (candidate.getTime() > fromMs || (includeNow && candidate.getTime() === fromMs)) return candidate.getTime();
  }
  const fallback = candidateAt(from, timeHHmm);
  fallback.setDate(from.getDate() + 1);
  return fallback.getTime();
}

export function alarmFireKey(alarm: Pick<ChatAlarm, 'id' | 'timeHHmm'>, atMs: number): string {
  const d = new Date(atMs);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${alarm.id}:${y}-${m}-${day}:${normalizeAlarmTime(alarm.timeHHmm)}`;
}

export function shouldSkipStaleAlarm(alarm: ChatAlarm, nowMs = Date.now(), graceMs = CHAT_ALARM_GRACE_MS): boolean {
  return alarm.nextAt > 0 && nowMs - alarm.nextAt > graceMs;
}

export function resolveAlarmChannel(alarm: Pick<ChatAlarm, 'kind' | 'channel'>): Exclude<ChatAlarmChannel, 'auto'> {
  if (alarm.channel === 'call') return 'call';
  if (alarm.channel === 'reminder') return 'reminder';
  return alarm.kind === 'wake' ? 'call' : 'reminder';
}

export function makeChatAlarm(input: {
  charId: string;
  kind?: ChatAlarmKind;
  label?: string;
  timeHHmm?: string;
  weekdays?: number[];
  channel?: ChatAlarmChannel;
  now?: number;
}): ChatAlarm {
  const now = input.now ?? Date.now();
  const kind = input.kind || 'wake';
  const timeHHmm = normalizeAlarmTime(input.timeHHmm || (kind === 'sleep' ? '23:30' : '07:30'));
  const weekdays = normalizeWeekdays(input.weekdays);
  return {
    id: `chat_alarm_${now}_${Math.random().toString(36).slice(2, 8)}`,
    charId: input.charId,
    label: (input.label || KIND_LABEL[kind]).trim().slice(0, 40),
    kind,
    timeHHmm,
    weekdays,
    channel: input.channel || 'auto',
    enabled: true,
    nextAt: computeNextAlarmAt(timeHHmm, weekdays, now),
    createdAt: now,
    updatedAt: now,
  };
}

export function prepareAlarmForSave(alarm: ChatAlarm, now = Date.now()): ChatAlarm {
  const timeHHmm = normalizeAlarmTime(alarm.timeHHmm, alarm.kind === 'sleep' ? '23:30' : '07:30');
  const weekdays = normalizeWeekdays(alarm.weekdays);
  return {
    ...alarm,
    label: (alarm.label || KIND_LABEL[alarm.kind] || '闹钟').trim().slice(0, 40),
    timeHHmm,
    weekdays,
    nextAt: alarm.enabled ? computeNextAlarmAt(timeHHmm, weekdays, now) : 0,
    updatedAt: now,
  };
}

export function markAlarmFired(alarm: ChatAlarm, now = Date.now()): ChatAlarm {
  return {
    ...alarm,
    lastFiredKey: alarmFireKey(alarm, alarm.nextAt || now),
    nextAt: alarm.enabled ? computeNextAlarmAt(alarm.timeHHmm, alarm.weekdays, Math.max(now, alarm.nextAt || now) + 1000) : 0,
    updatedAt: now,
  };
}

export function nativeNotificationIdForAlarm(alarmId: string, atMs: number): number {
  let hash = 2166136261;
  const source = `${alarmId}:${Math.floor(atMs / 60000)}`;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 2147483647;
}

export function alarmNotificationTitle(charName: string, alarm: Pick<ChatAlarm, 'kind' | 'label'>): string {
  if (alarm.kind === 'wake') return `${charName} 叫你起床`;
  if (alarm.kind === 'sleep') return `${charName} 催你睡觉`;
  return `${charName} 的提醒`;
}

export function alarmNotificationBody(alarm: Pick<ChatAlarm, 'kind' | 'label' | 'timeHHmm'>): string {
  if (alarm.kind === 'wake') return `${alarm.timeHHmm} 到了，${alarm.label || '该起床了'}。`;
  if (alarm.kind === 'sleep') return `${alarm.timeHHmm} 到了，${alarm.label || '该准备睡觉了'}。`;
  return alarm.label || `${alarm.timeHHmm} 的提醒到了。`;
}

export function alarmChannelLabel(channel: ChatAlarmChannel): string {
  return CHANNEL_LABEL[channel] || channel;
}

export function alarmKindLabel(kind: ChatAlarmKind): string {
  return KIND_LABEL[kind] || '提醒';
}

export function buildChatAlarmHint(params: {
  alarm: ChatAlarm;
  char: Pick<CharacterProfile, 'name'>;
  userName: string;
  channel: Exclude<ChatAlarmChannel, 'auto'>;
  nowMs?: number;
}): string {
  return chatAlarmHint({
    userName: params.userName,
    charName: params.char.name,
    kind: params.alarm.kind,
    label: params.alarm.label,
    timeHHmm: params.alarm.timeHHmm,
    channel: params.channel,
    nowText: new Date(params.nowMs ?? Date.now()).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }),
  });
}

