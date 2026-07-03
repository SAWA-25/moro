import type { CharLifeEvent, DailySchedule } from '../types';

export const DAILY_SCHEDULE_UPDATED_EVENT = 'daily-schedule-updated';
export const CHAR_LIFE_EVENT_UPDATED_EVENT = 'char-life-event-updated';

export interface DailyScheduleUpdatedDetail {
  charId: string;
  date?: string;
  scheduleId?: string;
  deleted?: boolean;
}

export interface CharLifeEventUpdatedDetail {
  charId: string;
  eventId: string;
  timestamp: number;
  scheduleDate?: string;
  scheduleSlotStartTime?: string;
  surfacedAsMsg?: boolean;
}

export function dispatchDailyScheduleUpdated(detail: DailyScheduleUpdatedDetail) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(DAILY_SCHEDULE_UPDATED_EVENT, { detail }));
}

export function dispatchDailyScheduleSaved(schedule: DailySchedule) {
  dispatchDailyScheduleUpdated({
    charId: schedule.charId,
    date: schedule.date,
    scheduleId: schedule.id,
  });
}

export function dispatchCharLifeEventUpdated(event: CharLifeEvent) {
  if (typeof window === 'undefined') return;
  const detail: CharLifeEventUpdatedDetail = {
    charId: event.charId,
    eventId: event.id,
    timestamp: event.timestamp,
    scheduleDate: event.scheduleDate,
    scheduleSlotStartTime: event.scheduleSlotStartTime,
    surfacedAsMsg: !!event.surfacedAsMsg,
  };
  window.dispatchEvent(new CustomEvent(CHAR_LIFE_EVENT_UPDATED_EVENT, { detail }));
}
