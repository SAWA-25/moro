import { describe, expect, it } from 'vitest';
import type { PeriodReminderSettings } from '../types';
import {
  PERIOD_REMINDER_GRACE_MS,
  addDaysToDateKey,
  computeNextPeriodReminderAt,
  makeDefaultPeriodReminderSettings,
  markPeriodReminderFired,
  normalizePeriodOffsets,
  periodFireKey,
  periodReminderBody,
  periodReminderCycleStartFor,
  periodReminderOffsetFor,
  predictNextPeriodStart,
  preparePeriodReminderSettings,
  shouldSkipStalePeriodReminder,
} from './periodReminders';

const at = (year: number, month: number, day: number, hour = 0, minute = 0) =>
  new Date(year, month - 1, day, hour, minute, 0, 0).getTime();

const settings = (input: Partial<PeriodReminderSettings> = {}, now = at(2026, 6, 1, 8, 0)): PeriodReminderSettings =>
  preparePeriodReminderSettings({
    ...makeDefaultPeriodReminderSettings(now),
    enabled: true,
    lastStartDate: '2026-06-01',
    cycleLength: 28,
    periodLength: 5,
    remindOffsets: [-2, 0],
    timeHHmm: '09:00',
    ...input,
  }, now);

describe('period reminder scheduling', () => {
  it('predicts the next start with the default 28 day cycle', () => {
    expect(predictNextPeriodStart('2026-06-01', 28, at(2026, 6, 15))).toBe('2026-06-29');
  });

  it('handles cross-month and cross-year prediction', () => {
    expect(addDaysToDateKey('2026-12-20', 28)).toBe('2027-01-17');
    expect(predictNextPeriodStart('2026-12-20', 28, at(2027, 1, 1))).toBe('2027-01-17');
  });

  it('schedules the default two-day advance reminder', () => {
    expect(computeNextPeriodReminderAt(settings(), at(2026, 6, 26, 12, 0))).toBe(at(2026, 6, 27, 9, 0));
  });

  it('schedules the same-day reminder after the advance reminder has passed', () => {
    expect(computeNextPeriodReminderAt(settings(), at(2026, 6, 27, 10, 0))).toBe(at(2026, 6, 29, 9, 0));
  });

  it('uses custom reminder offsets', () => {
    const custom = settings({ remindOffsets: [-7, -1, 0], timeHHmm: '08:30' });
    expect(computeNextPeriodReminderAt(custom, at(2026, 6, 21, 12, 0))).toBe(at(2026, 6, 22, 8, 30));
    expect(normalizePeriodOffsets([0, -7, -7, 2])).toEqual([-7, 0, 2]);
  });

  it('moves to the next reminder when today already passed', () => {
    const today = settings({ remindOffsets: [0], timeHHmm: '09:00' });
    expect(computeNextPeriodReminderAt(today, at(2026, 6, 29, 9, 1))).toBe(at(2026, 7, 27, 9, 0));
  });

  it('does not schedule disabled settings or settings without a start date', () => {
    expect(computeNextPeriodReminderAt(settings({ enabled: false }), at(2026, 6, 26))).toBe(0);
    expect(computeNextPeriodReminderAt(settings({ lastStartDate: '' }), at(2026, 6, 26))).toBe(0);
  });

  it('skips reminders older than the grace window', () => {
    const now = at(2026, 6, 30, 12, 0);
    expect(shouldSkipStalePeriodReminder(settings({ nextAt: now - PERIOD_REMINDER_GRACE_MS - 1 }), now)).toBe(true);
  });

  it('deduplicates with a fire key and computes the next occurrence after firing', () => {
    const base = settings({}, at(2026, 6, 26, 12, 0));
    expect(base.nextAt).toBe(at(2026, 6, 27, 9, 0));

    const fired = markPeriodReminderFired(base, at(2026, 6, 27, 9, 5));
    expect(fired.lastFiredKey).toBe(periodFireKey(base, base.nextAt));
    expect(fired.nextAt).toBe(at(2026, 6, 29, 9, 0));
  });

  it('resolves cycle start, offset, and notification text from the fire time', () => {
    const base = settings({}, at(2026, 6, 26, 12, 0));
    expect(periodReminderCycleStartFor(base, base.nextAt)).toBe('2026-06-29');
    expect(periodReminderOffsetFor(base, base.nextAt)).toBe(-2);
    expect(periodReminderBody(base, base.nextAt)).toContain('提前 2 天');
  });
});
