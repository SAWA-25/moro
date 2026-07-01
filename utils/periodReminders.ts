import type { CharacterProfile, PeriodReminderNotifyChannel, PeriodReminderSettings, PeriodReminderVisibility } from '../types';
import { periodReminderHint } from './laiwangPrompts';

export const PERIOD_REMINDER_ID = 'period_reminder_main';
export const PERIOD_REMINDER_GRACE_MS = 2 * 60 * 60 * 1000;
export const PERIOD_REMINDER_LOCK_MS = 90_000;
export const PERIOD_REMINDER_NATIVE_WINDOW_DAYS = 14;
export const DEFAULT_PERIOD_REMIND_OFFSETS = [-2, 0];
export const PERIOD_CYCLE_LENGTH_MIN = 15;
export const PERIOD_CYCLE_LENGTH_MAX = 60;
export const PERIOD_CYCLE_LENGTH_DEFAULT = 28;
export const PERIOD_LENGTH_MIN = 1;
export const PERIOD_LENGTH_MAX = 14;
export const PERIOD_LENGTH_DEFAULT = 5;

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

const clampInt = (value: unknown, min: number, max: number, fallback: number): number => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string' && value.trim() === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
};

const pad = (n: number) => String(n).padStart(2, '0');

export function normalizePeriodCycleLength(value: unknown): number {
  return clampInt(value, PERIOD_CYCLE_LENGTH_MIN, PERIOD_CYCLE_LENGTH_MAX, PERIOD_CYCLE_LENGTH_DEFAULT);
}

export function normalizePeriodLength(value: unknown): number {
  return clampInt(value, PERIOD_LENGTH_MIN, PERIOD_LENGTH_MAX, PERIOD_LENGTH_DEFAULT);
}

export function toLocalDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function normalizePeriodDate(value?: string): string {
  const raw = String(value || '').trim();
  if (!DATE_RE.test(raw)) return '';
  const [y, m, d] = raw.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return '';
  return raw;
}

export function normalizePeriodTime(value?: string, fallback = '09:00'): string {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{1,2}):(\d{1,2})$/);
  if (!match) return fallback;
  const h = Math.max(0, Math.min(23, Number(match[1]) || 0));
  const m = Math.max(0, Math.min(59, Number(match[2]) || 0));
  return `${pad(h)}:${pad(m)}`;
}

export function isValidPeriodTime(value: string): boolean {
  return HHMM_RE.test(value);
}

export function normalizePeriodOffsets(offsets?: number[]): number[] {
  const source = offsets && offsets.length ? offsets : DEFAULT_PERIOD_REMIND_OFFSETS;
  const set = new Set<number>();
  source.forEach(value => {
    const n = Number(value);
    if (Number.isInteger(n) && n >= -14 && n <= 14) set.add(n);
  });
  const arr = Array.from(set).sort((a, b) => a - b);
  return arr.length ? arr : [...DEFAULT_PERIOD_REMIND_OFFSETS];
}

export function addDaysToDateKey(dateKey: string, days: number): string {
  const normalized = normalizePeriodDate(dateKey);
  if (!normalized) return '';
  const [y, m, d] = normalized.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return toLocalDateKey(date);
}

export function dateKeyAtTime(dateKey: string, timeHHmm: string): number {
  const normalized = normalizePeriodDate(dateKey);
  if (!normalized) return 0;
  const [y, m, d] = normalized.split('-').map(Number);
  const [h, min] = normalizePeriodTime(timeHHmm).split(':').map(Number);
  return new Date(y, m - 1, d, h, min, 0, 0).getTime();
}

export function predictNextPeriodStart(lastStartDate?: string, cycleLength = 28, fromMs = Date.now()): string {
  const last = normalizePeriodDate(lastStartDate);
  if (!last) return '';
  const cycle = normalizePeriodCycleLength(cycleLength);
  let cursor = last;
  const fromDay = new Date(fromMs);
  fromDay.setHours(0, 0, 0, 0);
  for (let i = 0; i < 80; i += 1) {
    const candidateMs = dateKeyAtTime(cursor, '00:00');
    if (candidateMs >= fromDay.getTime()) return cursor;
    cursor = addDaysToDateKey(cursor, cycle);
  }
  return addDaysToDateKey(last, cycle);
}

export function computeNextPeriodReminderAt(
  settings: Pick<PeriodReminderSettings, 'enabled' | 'lastStartDate' | 'cycleLength' | 'remindOffsets' | 'timeHHmm'>,
  fromMs = Date.now(),
  includeNow = false,
): number {
  if (!settings.enabled) return 0;
  const last = normalizePeriodDate(settings.lastStartDate);
  if (!last) return 0;
  const cycle = normalizePeriodCycleLength(settings.cycleLength);
  const offsets = normalizePeriodOffsets(settings.remindOffsets);
  const timeHHmm = normalizePeriodTime(settings.timeHHmm);
  const cycleStarts: string[] = [];
  let start = last;
  for (let i = 0; i < 80; i += 1) {
    cycleStarts.push(start);
    start = addDaysToDateKey(start, cycle);
  }
  const candidates = cycleStarts
    .flatMap(cycleStart => offsets.map(offset => ({
      at: dateKeyAtTime(addDaysToDateKey(cycleStart, offset), timeHHmm),
      cycleStart,
      offset,
    })))
    .filter(item => item.at > 0)
    .sort((a, b) => a.at - b.at);
  const hit = candidates.find(item => item.at > fromMs || (includeNow && item.at === fromMs));
  return hit?.at || 0;
}

export function periodFireKey(settings: Pick<PeriodReminderSettings, 'id' | 'timeHHmm'>, atMs: number): string {
  return `${settings.id}:${toLocalDateKey(new Date(atMs))}:${normalizePeriodTime(settings.timeHHmm)}`;
}

export function shouldSkipStalePeriodReminder(settings: PeriodReminderSettings, nowMs = Date.now(), graceMs = PERIOD_REMINDER_GRACE_MS): boolean {
  return settings.nextAt > 0 && nowMs - settings.nextAt > graceMs;
}

export function makeDefaultPeriodReminderSettings(now = Date.now()): PeriodReminderSettings {
  return {
    id: PERIOD_REMINDER_ID,
    enabled: false,
    lastStartDate: '',
    cycleLength: PERIOD_CYCLE_LENGTH_DEFAULT,
    periodLength: PERIOD_LENGTH_DEFAULT,
    remindOffsets: [...DEFAULT_PERIOD_REMIND_OFFSETS],
    timeHHmm: '09:00',
    visibility: 'private',
    notifyChannel: 'system',
    charIds: [],
    nextAt: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export function preparePeriodReminderSettings(settings: Partial<PeriodReminderSettings> | null | undefined, now = Date.now()): PeriodReminderSettings {
  const base = makeDefaultPeriodReminderSettings(now);
  const merged = { ...base, ...(settings || {}) };
  const next: PeriodReminderSettings = {
    ...merged,
    id: merged.id || PERIOD_REMINDER_ID,
    enabled: Boolean(merged.enabled),
    lastStartDate: normalizePeriodDate(merged.lastStartDate) || '',
    cycleLength: normalizePeriodCycleLength(merged.cycleLength),
    periodLength: normalizePeriodLength(merged.periodLength),
    remindOffsets: normalizePeriodOffsets(merged.remindOffsets),
    timeHHmm: normalizePeriodTime(merged.timeHHmm),
    visibility: (merged.visibility === 'public' ? 'public' : 'private') as PeriodReminderVisibility,
    notifyChannel: (['system', 'character', 'both'].includes(String(merged.notifyChannel)) ? merged.notifyChannel : 'system') as PeriodReminderNotifyChannel,
    charIds: Array.from(new Set((merged.charIds || []).filter(Boolean))),
    createdAt: merged.createdAt || now,
    updatedAt: now,
  };
  return {
    ...next,
    nextAt: computeNextPeriodReminderAt(next, now),
  };
}

export function markPeriodReminderFired(settings: PeriodReminderSettings, now = Date.now()): PeriodReminderSettings {
  const firedAt = settings.nextAt || now;
  const base = {
    ...settings,
    lastFiredKey: periodFireKey(settings, firedAt),
    updatedAt: now,
  };
  return {
    ...base,
    nextAt: computeNextPeriodReminderAt(base, Math.max(now, firedAt) + 1000),
  };
}

export function periodReminderCycleStartFor(settings: PeriodReminderSettings, atMs: number): string {
  const last = normalizePeriodDate(settings.lastStartDate);
  if (!last) return '';
  const cycle = normalizePeriodCycleLength(settings.cycleLength);
  const offsets = normalizePeriodOffsets(settings.remindOffsets);
  const fireDay = toLocalDateKey(new Date(atMs));
  for (let i = -2; i < 80; i += 1) {
    const cycleStart = addDaysToDateKey(last, cycle * i);
    if (!cycleStart) continue;
    if (offsets.some(offset => addDaysToDateKey(cycleStart, offset) === fireDay)) return cycleStart;
  }
  return predictNextPeriodStart(last, cycle, atMs);
}

export function periodReminderOffsetFor(settings: PeriodReminderSettings, atMs: number): number {
  const cycleStart = periodReminderCycleStartFor(settings, atMs);
  const fireDay = toLocalDateKey(new Date(atMs));
  const offset = normalizePeriodOffsets(settings.remindOffsets).find(value => addDaysToDateKey(cycleStart, value) === fireDay);
  return offset ?? 0;
}

export function nativeNotificationIdForPeriodReminder(settingsId: string, atMs: number): number {
  let hash = 2166136261;
  const source = `period-reminder:${settingsId}:${Math.floor(atMs / 60000)}`;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 2147483647;
}

export function periodReminderTitle(settings: PeriodReminderSettings, atMs = settings.nextAt || Date.now()): string {
  const offset = periodReminderOffsetFor(settings, atMs);
  if (offset < 0) return '经期提醒';
  if (offset === 0) return '经期可能开始';
  return '经期记录提醒';
}

export function periodReminderBody(settings: PeriodReminderSettings, atMs = settings.nextAt || Date.now()): string {
  const cycleStart = periodReminderCycleStartFor(settings, atMs);
  const offset = periodReminderOffsetFor(settings, atMs);
  if (offset < 0) return `预测 ${cycleStart} 左右开始，提前 ${Math.abs(offset)} 天提醒。`;
  if (offset === 0) return `预测今天（${cycleStart}）可能开始，记得照顾好自己。`;
  return `预测 ${cycleStart} 左右开始，这是第 ${offset + 1} 天附近的记录提醒。`;
}

export function buildPeriodReminderHint(params: {
  settings: PeriodReminderSettings;
  char: Pick<CharacterProfile, 'name'>;
  userName: string;
  nowMs?: number;
}): string {
  const nowMs = params.nowMs ?? Date.now();
  const reminderMs = params.settings.nextAt || nowMs;
  return periodReminderHint({
    userName: params.userName,
    charName: params.char.name,
    predictedStartDate: periodReminderCycleStartFor(params.settings, reminderMs),
    offset: periodReminderOffsetFor(params.settings, reminderMs),
    periodLength: params.settings.periodLength,
    nowText: new Date(nowMs).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }),
  });
}
