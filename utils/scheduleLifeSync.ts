import type { CharLifeEvent, DailySchedule, ScheduleSlot } from '../types';
import { DB } from './db';
import { sanitizeLifeText } from './autonomousLife';

export interface ScheduleLifeNote {
  id: string;
  charId: string;
  timestamp: number;
  activity: string;
  summary: string;
  mood?: string;
  location?: string;
  eventKind?: CharLifeEvent['eventKind'];
  source: CharLifeEvent['source'];
  surfacedAsMsg?: boolean;
  surfacedAt?: number;
  scheduleDate?: string;
  scheduleSlotStartTime?: string;
  scheduleSlotActivity?: string;
}

export type ScheduleLifeNotesBySlot = Record<string, ScheduleLifeNote[]>;

interface ScheduleLifeNoteOptions {
  maxPerSlot?: number;
  now?: number;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

function localDateKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function isoDateKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function timestampMatchesDate(ts: number, date: string): boolean {
  return localDateKey(ts) === date || isoDateKey(ts) === date;
}

function slotStartMinutes(slot: ScheduleSlot): number {
  const [h, m] = String(slot.startTime || '00:00').split(':').map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

function slotStartAtTimestamp(schedule: DailySchedule, ts: number): string | null {
  const sorted = [...(schedule.slots || [])].sort((a, b) => slotStartMinutes(a) - slotStartMinutes(b));
  if (sorted.length === 0) return null;
  const d = new Date(ts);
  const minutes = d.getHours() * 60 + d.getMinutes();
  let match: ScheduleSlot | null = null;
  for (const slot of sorted) {
    if (minutes >= slotStartMinutes(slot)) match = slot;
    else break;
  }
  return match?.startTime || null;
}

function toNote(event: CharLifeEvent): ScheduleLifeNote | null {
  const activity = sanitizeLifeText(event.activity) || sanitizeLifeText(event.summary || '');
  if (!activity) return null;
  const summary = sanitizeLifeText(event.summary || '') || activity;
  return {
    id: event.id,
    charId: event.charId,
    timestamp: event.timestamp,
    activity,
    summary,
    mood: event.mood ? sanitizeLifeText(event.mood) : undefined,
    location: event.location ? sanitizeLifeText(event.location) : undefined,
    eventKind: event.eventKind,
    source: event.source,
    surfacedAsMsg: !!event.surfacedAsMsg,
    surfacedAt: event.surfacedAt,
    scheduleDate: event.scheduleDate,
    scheduleSlotStartTime: event.scheduleSlotStartTime,
    scheduleSlotActivity: event.scheduleSlotActivity,
  };
}

export function mapScheduleLifeNotes(
  schedule: DailySchedule | null | undefined,
  events: CharLifeEvent[],
  opts: ScheduleLifeNoteOptions = {},
): ScheduleLifeNotesBySlot {
  if (!schedule?.slots?.length || !schedule.charId || !schedule.date) return {};
  const maxPerSlot = Math.max(1, Math.round(opts.maxPerSlot ?? 2));
  const now = opts.now ?? Date.now();
  const slotStarts = new Set(schedule.slots.map(s => s.startTime));
  const grouped: ScheduleLifeNotesBySlot = {};

  for (const event of events || []) {
    if (!event || event.charId !== schedule.charId || event.timestamp > now) continue;
    const dateMatches = event.scheduleDate
      ? event.scheduleDate === schedule.date
      : timestampMatchesDate(event.timestamp, schedule.date);
    if (!dateMatches) continue;

    let slotStart = event.scheduleSlotStartTime && slotStarts.has(event.scheduleSlotStartTime)
      ? event.scheduleSlotStartTime
      : null;
    if (!slotStart) slotStart = slotStartAtTimestamp(schedule, event.timestamp);
    if (!slotStart || !slotStarts.has(slotStart)) continue;

    const note = toNote(event);
    if (!note) continue;
    grouped[slotStart] = [...(grouped[slotStart] || []), note];
  }

  for (const key of Object.keys(grouped)) {
    grouped[key] = grouped[key]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, maxPerSlot);
  }
  return grouped;
}

export async function loadScheduleLifeNotes(
  schedule: DailySchedule | null | undefined,
  opts: ScheduleLifeNoteOptions = {},
): Promise<ScheduleLifeNotesBySlot> {
  if (!schedule?.charId) return {};
  const events = await DB.getLifeEvents(schedule.charId).catch(() => [] as CharLifeEvent[]);
  return mapScheduleLifeNotes(schedule, events, opts);
}
