import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CharLifeEvent, DailySchedule } from '../types';
import { DB } from './db';
import { CHAR_LIFE_EVENT_UPDATED_EVENT, DAILY_SCHEDULE_UPDATED_EVENT } from './scheduleEvents';
import { loadScheduleLifeNotes, mapScheduleLifeNotes } from './scheduleLifeSync';

const mkSchedule = (patch: Partial<DailySchedule> = {}): DailySchedule => ({
  id: 'char-sync_2026-07-03',
  charId: 'char-sync',
  date: '2026-07-03',
  generatedAt: Date.now(),
  slots: [
    { startTime: '09:00', endTime: '10:00', activity: '通勤' },
    { startTime: '14:00', endTime: '15:00', activity: '项目会' },
    { startTime: '20:00', endTime: '22:00', activity: '看电影' },
  ],
  ...patch,
});

const ts = (hour: number, minute = 0, day = 3) => new Date(2026, 6, day, hour, minute).getTime();

const mkEvent = (patch: Partial<CharLifeEvent> = {}): CharLifeEvent => ({
  id: `life-${patch.timestamp || Date.now()}`,
  charId: 'char-sync',
  timestamp: ts(14, 20),
  activity: '在项目会间隙接了杯水',
  summary: '会议间隙接水',
  source: 'catchup',
  ...patch,
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await DB.deleteDB();
});

describe('schedule life sync', () => {
  it('maps explicit schedule fields to the matching slot', () => {
    const schedule = mkSchedule();
    const notes = mapScheduleLifeNotes(schedule, [
      mkEvent({
        id: 'explicit',
        scheduleDate: schedule.date,
        scheduleSlotStartTime: '20:00',
        scheduleSlotActivity: '看电影',
        timestamp: ts(20, 15),
        summary: '电影开场前调暗了灯',
        surfacedAsMsg: true,
      }),
    ]);

    expect(notes['20:00']).toHaveLength(1);
    expect(notes['20:00'][0]).toMatchObject({
      id: 'explicit',
      summary: '电影开场前调暗了灯',
      surfacedAsMsg: true,
      scheduleSlotActivity: '看电影',
    });
  });

  it('falls back to the event timestamp for older events without schedule fields', () => {
    const schedule = mkSchedule();
    const notes = mapScheduleLifeNotes(schedule, [
      mkEvent({ id: 'legacy', timestamp: ts(14, 45), scheduleDate: undefined, scheduleSlotStartTime: undefined }),
    ]);

    expect(notes['14:00']?.[0]?.id).toBe('legacy');
  });

  it('ignores events from other dates or characters', () => {
    const schedule = mkSchedule();
    const notes = mapScheduleLifeNotes(schedule, [
      mkEvent({ id: 'other-day', timestamp: ts(14, 20, 4), scheduleDate: '2026-07-04' }),
      mkEvent({ id: 'other-char', charId: 'char-other', timestamp: ts(14, 20), scheduleDate: schedule.date, scheduleSlotStartTime: '14:00' }),
    ]);

    expect(notes).toEqual({});
  });

  it('sorts newest first and limits notes per slot', () => {
    const schedule = mkSchedule();
    const notes = mapScheduleLifeNotes(schedule, [
      mkEvent({ id: 'old', timestamp: ts(14, 5), scheduleDate: schedule.date, scheduleSlotStartTime: '14:00' }),
      mkEvent({ id: 'new', timestamp: ts(14, 55), scheduleDate: schedule.date, scheduleSlotStartTime: '14:00' }),
      mkEvent({ id: 'mid', timestamp: ts(14, 30), scheduleDate: schedule.date, scheduleSlotStartTime: '14:00' }),
    ], { maxPerSlot: 2 });

    expect(notes['14:00'].map(n => n.id)).toEqual(['new', 'mid']);
  });

  it('loads notes from IndexedDB for a schedule', async () => {
    const schedule = mkSchedule();
    await DB.saveLifeEvent(mkEvent({ id: 'stored', scheduleDate: schedule.date, scheduleSlotStartTime: '09:00', timestamp: ts(9, 30) }));

    const notes = await loadScheduleLifeNotes(schedule);

    expect(notes['09:00']?.[0]?.id).toBe('stored');
  });

  it('dispatches refresh events when schedules and life events are saved', async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal('window', { dispatchEvent });
    const schedule = mkSchedule();
    const event = mkEvent({ id: 'event-dispatch', scheduleDate: schedule.date, scheduleSlotStartTime: '14:00' });

    await DB.saveDailySchedule(schedule);
    await DB.saveLifeEvent(event);
    await DB.markLifeEventSurfaced(event.id, ts(15, 0));

    const eventNames = dispatchEvent.mock.calls.map(([ev]) => (ev as CustomEvent).type);
    expect(eventNames).toContain(DAILY_SCHEDULE_UPDATED_EVENT);
    expect(eventNames.filter(name => name === CHAR_LIFE_EVENT_UPDATED_EVENT)).toHaveLength(2);
    const scheduleDetail = (dispatchEvent.mock.calls.find(([ev]) => (ev as CustomEvent).type === DAILY_SCHEDULE_UPDATED_EVENT)?.[0] as CustomEvent).detail;
    expect(scheduleDetail).toMatchObject({ charId: schedule.charId, date: schedule.date, scheduleId: schedule.id });
    const lifeDetail = (dispatchEvent.mock.calls.find(([ev]) => (ev as CustomEvent).type === CHAR_LIFE_EVENT_UPDATED_EVENT)?.[0] as CustomEvent).detail;
    expect(lifeDetail).toMatchObject({
      charId: event.charId,
      eventId: event.id,
      scheduleDate: schedule.date,
      scheduleSlotStartTime: '14:00',
    });
  });
});
