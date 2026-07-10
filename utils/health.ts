import type {
  CharacterProfile,
  HealthModuleId,
  HealthModuleSettings,
  HealthPlan,
  HealthPrivacyMode,
  HealthRecord,
  HealthRecordSource,
  HealthReminder,
  HealthReminderChannel,
  HealthReminderFrequency,
  HealthReminderKind,
  HealthSummary,
  PeriodCycleEvent,
  PeriodReminderSettings,
} from '../types';
import {
  addDaysToDateKey,
  computeNextPeriodReminderAt,
  nativeNotificationIdForPeriodReminder,
  normalizePeriodDate,
  normalizePeriodOffsets,
  normalizePeriodTime,
  periodFireKey,
  periodReminderBody,
  periodReminderTitle,
  preparePeriodReminderSettings,
} from './periodReminders';
import { healthCompanionHint } from './laiwangPrompts';
import { healthSummaryCompanionHint } from './laiwangPrompts';

export const HEALTH_UPDATED_EVENT = 'health-data-updated';
export const HEALTH_REMINDERS_UPDATED_EVENT = 'health-reminders-updated';
export const HEALTH_SUMMARY_REQUEST_EVENT = 'health-summary-request';
export const HEALTH_REMINDER_GRACE_MS = 2 * 60 * 60 * 1000;
export const HEALTH_REMINDER_LOCK_MS = 90_000;
export const HEALTH_NATIVE_WINDOW_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const pad = (n: number) => String(n).padStart(2, '0');

export const HEALTH_MODULES: Array<{
  id: HealthModuleId;
  label: string;
  shortLabel: string;
  unit?: string;
  accent: string;
  defaultGoal?: { target: number; unit: string };
}> = [
  { id: 'period', label: '经期', shortLabel: '经期', accent: '#e85d75' },
  { id: 'sleep', label: '睡眠', shortLabel: '睡眠', unit: '小时', accent: '#6d6fd8', defaultGoal: { target: 7.5, unit: '小时' } },
  { id: 'hydration', label: '饮水', shortLabel: '饮水', unit: 'ml', accent: '#1f9ed8', defaultGoal: { target: 1800, unit: 'ml' } },
  { id: 'medication', label: '用药', shortLabel: '用药', accent: '#9b6bd3' },
  { id: 'symptom', label: '症状 / 疼痛', shortLabel: '症状', accent: '#e36b4f' },
  { id: 'mood', label: '心情 / 精力', shortLabel: '心情', accent: '#d99b2b', defaultGoal: { target: 1, unit: '次' } },
  { id: 'movement', label: '运动 / 步数', shortLabel: '运动', unit: '步', accent: '#3c9a62', defaultGoal: { target: 6000, unit: '步' } },
  { id: 'vitals', label: '体征', shortLabel: '体征', unit: '条', accent: '#d9487c' },
];

export const HEALTH_MODULE_LABEL: Record<HealthModuleId, string> = HEALTH_MODULES.reduce((acc, item) => {
  acc[item.id] = item.label;
  return acc;
}, {} as Record<HealthModuleId, string>);

export function toHealthDateKey(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function normalizeHealthDate(value?: string, fallback = toHealthDateKey()): string {
  const raw = String(value || '').trim();
  if (!DATE_RE.test(raw)) return fallback;
  const [y, m, d] = raw.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return fallback;
  return raw;
}

export function dateKeyAtHealthTime(dateKey: string, timeHHmm: string): number {
  const date = normalizeHealthDate(dateKey, '');
  if (!date) return 0;
  const [y, m, d] = date.split('-').map(Number);
  const [h, min] = normalizePeriodTime(timeHHmm).split(':').map(Number);
  return new Date(y, m - 1, d, h, min, 0, 0).getTime();
}

export function normalizeHealthPrivacy(value?: string): HealthPrivacyMode {
  if (value === 'summary' || value === 'reminder' || value === 'summary_reminder') return value;
  return 'private';
}

export function healthPrivacyAllowsReminder(privacy: HealthPrivacyMode): boolean {
  return privacy === 'reminder' || privacy === 'summary_reminder';
}

export function healthPrivacyAllowsSummary(privacy: HealthPrivacyMode): boolean {
  return privacy === 'summary' || privacy === 'summary_reminder';
}

export function normalizeHealthChannel(value?: string): HealthReminderChannel {
  return value === 'character' || value === 'both' ? value : 'system';
}

export function normalizeHealthFrequency(value?: string): HealthReminderFrequency {
  return value === 'once' || value === 'weekdays' || value === 'custom' ? value : 'daily';
}

export function makeDefaultHealthModuleSettings(now = Date.now()): HealthModuleSettings[] {
  return HEALTH_MODULES.map(module => ({
    id: module.id,
    enabled: true,
    privacy: 'private',
    charIds: [],
    reminderChannel: 'system',
    goals: module.defaultGoal ? { ...module.defaultGoal, cadence: 'daily' } : undefined,
    createdAt: now,
    updatedAt: now,
  }));
}

export function prepareHealthModuleSettings(input: Partial<HealthModuleSettings>, now = Date.now()): HealthModuleSettings {
  const id = HEALTH_MODULES.some(module => module.id === input.id) ? input.id as HealthModuleId : 'mood';
  const defaults = makeDefaultHealthModuleSettings(now).find(module => module.id === id)!;
  const merged = { ...defaults, ...input };
  return {
    ...merged,
    id,
    enabled: merged.enabled !== false,
    privacy: normalizeHealthPrivacy(merged.privacy),
    charIds: Array.from(new Set((merged.charIds || []).filter(Boolean))),
    reminderChannel: normalizeHealthChannel(merged.reminderChannel),
    goals: merged.goals ? {
      target: Number.isFinite(Number(merged.goals.target)) ? Number(merged.goals.target) : defaults.goals?.target,
      unit: String(merged.goals.unit || defaults.goals?.unit || '').trim(),
      cadence: merged.goals.cadence === 'weekly' ? 'weekly' : 'daily',
    } : undefined,
    createdAt: merged.createdAt || now,
    updatedAt: now,
  };
}

export function mergeHealthModuleSettings(rows: HealthModuleSettings[] = [], now = Date.now()): HealthModuleSettings[] {
  const byId = new Map(rows.map(row => [row.id, row]));
  return makeDefaultHealthModuleSettings(now).map(defaults =>
    prepareHealthModuleSettings({ ...defaults, ...(byId.get(defaults.id) || {}) }, now),
  );
}

export function makeHealthRecord(input: Partial<HealthRecord>, now = Date.now()): HealthRecord {
  const moduleId = HEALTH_MODULES.some(module => module.id === input.moduleId) ? input.moduleId as HealthModuleId : 'mood';
  const date = normalizeHealthDate(input.date);
  const timeHHmm = input.timeHHmm ? normalizePeriodTime(input.timeHHmm) : normalizePeriodTime(`${new Date(now).getHours()}:${new Date(now).getMinutes()}`);
  const value = Number(input.value);
  const id = input.id || `health_${moduleId}_${date}_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  return {
    id,
    moduleId,
    date,
    timeHHmm,
    value: Number.isFinite(value) ? value : undefined,
    unit: input.unit ? String(input.unit).slice(0, 24) : undefined,
    label: input.label ? String(input.label).trim().slice(0, 80) : undefined,
    tags: Array.from(new Set((input.tags || []).map(tag => String(tag).trim()).filter(Boolean))).slice(0, 12),
    note: input.note ? String(input.note).trim().slice(0, 600) : undefined,
    source: (input.source || 'manual') as HealthRecordSource,
    metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : undefined,
    createdAt: input.createdAt || now,
    updatedAt: now,
  };
}

export function normalizeHealthReminder(input: Partial<HealthReminder>, now = Date.now()): HealthReminder {
  const moduleId = HEALTH_MODULES.some(module => module.id === input.moduleId) ? input.moduleId as HealthModuleId : 'hydration';
  const kind = (input.kind || moduleId) as HealthReminderKind;
  const frequency = normalizeHealthFrequency(input.frequency);
  const timeHHmm = normalizePeriodTime(input.timeHHmm || '09:00');
  const date = input.date ? normalizeHealthDate(input.date, '') : undefined;
  const reminder: HealthReminder = {
    id: input.id || `health_reminder_${moduleId}_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    moduleId,
    kind,
    title: String(input.title || `${HEALTH_MODULE_LABEL[moduleId]}提醒`).trim().slice(0, 80),
    body: input.body ? String(input.body).trim().slice(0, 240) : undefined,
    enabled: input.enabled !== false,
    timeHHmm,
    frequency,
    weekdays: normalizeWeekdays(input.weekdays, frequency === 'weekdays' ? [1, 2, 3, 4, 5] : [1, 2, 3, 4, 5, 6, 0]),
    date,
    privacy: normalizeHealthPrivacy(input.privacy),
    channel: normalizeHealthChannel(input.channel),
    charIds: Array.from(new Set((input.charIds || []).filter(Boolean))),
    nextAt: 0,
    lastFiredKey: input.lastFiredKey,
    createdAt: input.createdAt || now,
    updatedAt: now,
  };
  return { ...reminder, nextAt: computeNextHealthReminderAt(reminder, now) };
}

function normalizeWeekdays(value?: number[], fallback: number[] = [1, 2, 3, 4, 5, 6, 0]): number[] {
  const source = value && value.length ? value : fallback;
  const set = new Set<number>();
  source.forEach(day => {
    const n = Number(day);
    if (Number.isInteger(n) && n >= 0 && n <= 6) set.add(n);
  });
  return Array.from(set).sort((a, b) => a - b);
}

export function computeNextHealthReminderAt(reminder: Pick<HealthReminder, 'enabled' | 'frequency' | 'date' | 'timeHHmm' | 'weekdays'>, fromMs = Date.now(), includeNow = false): number {
  if (!reminder.enabled) return 0;
  const timeHHmm = normalizePeriodTime(reminder.timeHHmm);
  if (reminder.frequency === 'once') {
    const date = normalizeHealthDate(reminder.date, '');
    if (!date) return 0;
    const at = dateKeyAtHealthTime(date, timeHHmm);
    return at > fromMs || (includeNow && at === fromMs) ? at : 0;
  }

  const cursor = new Date(fromMs);
  cursor.setSeconds(0, 0);
  const weekdays = normalizeWeekdays(reminder.weekdays, reminder.frequency === 'weekdays' ? [1, 2, 3, 4, 5] : [1, 2, 3, 4, 5, 6, 0]);
  for (let i = 0; i < 370; i += 1) {
    const day = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + i);
    if ((reminder.frequency === 'weekdays' || reminder.frequency === 'custom') && !weekdays.includes(day.getDay())) continue;
    const at = dateKeyAtHealthTime(toHealthDateKey(day), timeHHmm);
    if (at > fromMs || (includeNow && at === fromMs)) return at;
  }
  return 0;
}

export function healthReminderFireKey(reminder: Pick<HealthReminder, 'id' | 'timeHHmm'>, atMs: number): string {
  return `${reminder.id}:${toHealthDateKey(new Date(atMs))}:${normalizePeriodTime(reminder.timeHHmm)}`;
}

export function shouldSkipStaleHealthReminder(reminder: HealthReminder, nowMs = Date.now(), graceMs = HEALTH_REMINDER_GRACE_MS): boolean {
  return reminder.nextAt > 0 && nowMs - reminder.nextAt > graceMs;
}

export function markHealthReminderFired(reminder: HealthReminder, now = Date.now()): HealthReminder {
  const firedAt = reminder.nextAt || now;
  const base = {
    ...reminder,
    lastFiredKey: healthReminderFireKey(reminder, firedAt),
    updatedAt: now,
  };
  return {
    ...base,
    nextAt: computeNextHealthReminderAt(base, Math.max(now, firedAt) + 1000),
  };
}

export function healthReminderTitle(reminder: HealthReminder): string {
  return reminder.title || `${HEALTH_MODULE_LABEL[reminder.moduleId]}提醒`;
}

export function healthReminderBody(reminder: HealthReminder): string {
  return reminder.body || `到时间记录一下${HEALTH_MODULE_LABEL[reminder.moduleId]}。`;
}

export function nativeNotificationIdForHealthReminder(reminderId: string, atMs: number): number {
  let hash = 2166136261;
  const source = `health-reminder:${reminderId}:${Math.floor(atMs / 60000)}`;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 2147483647;
}

export function buildHealthCompanionHint(params: {
  reminder: HealthReminder;
  char: Pick<CharacterProfile, 'name'>;
  userName: string;
  nowMs?: number;
}): string {
  const nowMs = params.nowMs ?? Date.now();
  return healthCompanionHint({
    userName: params.userName,
    charName: params.char.name,
    moduleLabel: HEALTH_MODULE_LABEL[params.reminder.moduleId],
    title: healthReminderTitle(params.reminder),
    body: healthReminderBody(params.reminder),
    kind: params.reminder.kind,
    nowText: new Date(nowMs).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }),
  });
}

export function buildHealthSummaryCompanionHint(params: {
  summaryText: string;
  char: Pick<CharacterProfile, 'name'>;
  userName: string;
  nowMs?: number;
}): string {
  const nowMs = params.nowMs ?? Date.now();
  return healthSummaryCompanionHint({
    userName: params.userName,
    charName: params.char.name,
    summaryText: params.summaryText,
    nowText: new Date(nowMs).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }),
  });
}

export function makeHealthPlan(input: Partial<HealthPlan>, now = Date.now()): HealthPlan {
  const moduleId = HEALTH_MODULES.some(module => module.id === input.moduleId) ? input.moduleId as HealthModuleId : 'hydration';
  const module = HEALTH_MODULES.find(item => item.id === moduleId);
  const target = Number(input.target ?? module?.defaultGoal?.target ?? 1);
  return {
    id: input.id || `health_plan_${moduleId}`,
    moduleId,
    title: String(input.title || `${HEALTH_MODULE_LABEL[moduleId]}目标`).trim(),
    target: Number.isFinite(target) && target > 0 ? target : 1,
    unit: String(input.unit || module?.defaultGoal?.unit || '次'),
    cadence: input.cadence === 'weekly' ? 'weekly' : 'daily',
    enabled: input.enabled !== false,
    charIds: Array.from(new Set((input.charIds || []).filter(Boolean))),
    privacy: normalizeHealthPrivacy(input.privacy),
    createdAt: input.createdAt || now,
    updatedAt: now,
  };
}

export function computeHealthGoalProgress(plan: HealthPlan, records: HealthRecord[], date = toHealthDateKey()): { current: number; target: number; ratio: number; unit: string } {
  const relevant = records.filter(record => record.moduleId === plan.moduleId && record.date === date);
  const current = relevant.reduce((sum, record) => sum + (Number.isFinite(Number(record.value)) ? Number(record.value) : 1), 0);
  const target = Math.max(1, Number(plan.target) || 1);
  return {
    current,
    target,
    ratio: Math.max(0, Math.min(1, current / target)),
    unit: plan.unit,
  };
}

export function summarizeHealthDay(records: HealthRecord[], date = toHealthDateKey(), now = Date.now()): HealthSummary {
  const dayRecords = records.filter(record => record.date === date);
  const lines = HEALTH_MODULES.map(module => {
    const rows = dayRecords.filter(record => record.moduleId === module.id);
    if (!rows.length) return '';
    if (module.id === 'hydration' || module.id === 'movement' || module.id === 'sleep') {
      const total = rows.reduce((sum, row) => sum + (Number(row.value) || 0), 0);
      return `${module.shortLabel} ${Math.round(total * 10) / 10}${rows[0]?.unit || module.unit || ''}`;
    }
    if (module.id === 'vitals') {
      return `${module.shortLabel} ${rows.map(row => {
        const valueText = row.value !== undefined ? `${Math.round(Number(row.value) * 10) / 10}${row.unit || ''}` : '';
        return [row.label || row.tags[0] || '已记录', valueText].filter(Boolean).join(' ');
      }).slice(0, 3).join('、')}`;
    }
    return `${module.shortLabel} ${rows.map(row => row.label || row.tags[0] || row.note || '已记录').slice(0, 2).join('、')}`;
  }).filter(Boolean);
  return {
    id: `health_summary_day_${date}`,
    range: 'day',
    startDate: date,
    endDate: date,
    moduleIds: Array.from(new Set(dayRecords.map(record => record.moduleId))),
    text: lines.length ? lines.join('；') : '今天还没有健康记录。',
    metrics: { count: dayRecords.length },
    privacy: 'private',
    charIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function buildPeriodModuleSettingsFromLegacy(settings?: PeriodReminderSettings | null, now = Date.now()): HealthModuleSettings {
  const prepared = preparePeriodReminderSettings(settings || null, now);
  return prepareHealthModuleSettings({
    id: 'period',
    enabled: prepared.enabled,
    privacy: prepared.visibility === 'public'
      ? prepared.notifyChannel === 'character' ? 'reminder' : 'summary_reminder'
      : 'private',
    charIds: prepared.charIds,
    reminderChannel: prepared.notifyChannel,
  }, now);
}

export function periodEventsToHealthRecords(events: PeriodCycleEvent[], now = Date.now()): HealthRecord[] {
  return events.map(event => makeHealthRecord({
    id: `health_period_${event.id}`,
    moduleId: 'period',
    date: normalizePeriodDate(event.date) || toHealthDateKey(),
    label: event.kind === 'start' ? '开始' : '结束',
    tags: [event.kind === 'start' ? '经期开始' : '经期结束'],
    note: event.note,
    source: 'period_migration',
    metadata: { periodEventId: event.id, kind: event.kind },
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  }, now));
}

export function collectNativeHealthOccurrences(reminder: HealthReminder, now: number): number[] {
  if (!reminder.enabled) return [];
  const end = now + HEALTH_NATIVE_WINDOW_DAYS * DAY_MS;
  const hits: number[] = [];
  let cursor = now;
  for (let i = 0; i < 32; i += 1) {
    const next = computeNextHealthReminderAt(reminder, cursor, true);
    if (next > end || next <= 0) break;
    hits.push(next);
    cursor = next + 60_000;
  }
  return hits;
}

export function legacyPeriodAsHealthReminder(settings: PeriodReminderSettings): HealthReminder | null {
  const prepared = preparePeriodReminderSettings(settings);
  if (!prepared.enabled || !prepared.lastStartDate) return null;
  return normalizeHealthReminder({
    id: `health_legacy_${prepared.id}`,
    moduleId: 'period',
    kind: 'period',
    title: periodReminderTitle(prepared, prepared.nextAt || Date.now()),
    body: periodReminderBody(prepared, prepared.nextAt || Date.now()),
    enabled: prepared.enabled,
    timeHHmm: prepared.timeHHmm,
    frequency: 'custom',
    privacy: prepared.visibility === 'public' ? 'summary_reminder' : 'private',
    channel: prepared.notifyChannel,
    charIds: prepared.charIds,
    nextAt: computeNextPeriodReminderAt(prepared),
    lastFiredKey: prepared.lastFiredKey ? periodFireKey(prepared, prepared.nextAt || Date.now()) : undefined,
    createdAt: prepared.createdAt,
    updatedAt: prepared.updatedAt,
  });
}

export function nativeNotificationIdForLegacyPeriod(settingsId: string, atMs: number): number {
  return nativeNotificationIdForPeriodReminder(settingsId, atMs);
}
