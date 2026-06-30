import { describe, expect, it } from 'vitest';
import type { ChatAlarm } from '../types';
import {
  CHAT_ALARM_GRACE_MS,
  EVERYDAY_WEEKDAYS,
  WORKDAY_WEEKDAYS,
  alarmFireKey,
  computeNextAlarmAt,
  makeChatAlarm,
  markAlarmFired,
  prepareAlarmForSave,
  resolveAlarmChannel,
  shouldSkipStaleAlarm,
} from './chatAlarms';

const at = (year: number, month: number, day: number, hour: number, minute: number) =>
  new Date(year, month - 1, day, hour, minute, 0, 0).getTime();

describe('chat alarm scheduling', () => {
  it('schedules a daily alarm later today when the time has not passed', () => {
    expect(computeNextAlarmAt('07:30', EVERYDAY_WEEKDAYS, at(2026, 6, 30, 7, 0))).toBe(at(2026, 6, 30, 7, 30));
  });

  it('moves a daily alarm to tomorrow after today already passed', () => {
    expect(computeNextAlarmAt('07:30', EVERYDAY_WEEKDAYS, at(2026, 6, 30, 8, 0))).toBe(at(2026, 7, 1, 7, 30));
  });

  it('respects selected weekdays using Date.getDay where 0 is Sunday', () => {
    expect(computeNextAlarmAt('08:00', [1], at(2026, 6, 30, 22, 0))).toBe(at(2026, 7, 6, 8, 0));
  });

  it('handles cross-midnight sleep alarms without firing old time again', () => {
    expect(computeNextAlarmAt('23:30', EVERYDAY_WEEKDAYS, at(2026, 6, 30, 23, 45))).toBe(at(2026, 7, 1, 23, 30));
  });

  it('stores disabled alarms with no next fire time', () => {
    const alarm = makeChatAlarm({ charId: 'char-a', kind: 'wake', timeHHmm: '07:30', now: at(2026, 6, 30, 6, 0) });
    expect(prepareAlarmForSave({ ...alarm, enabled: false }, at(2026, 6, 30, 6, 5)).nextAt).toBe(0);
  });

  it('skips alarms older than the grace window', () => {
    const now = at(2026, 6, 30, 12, 0);
    const alarm = {
      ...makeChatAlarm({ charId: 'char-a', now }),
      nextAt: now - CHAT_ALARM_GRACE_MS - 1,
    } as ChatAlarm;
    expect(shouldSkipStaleAlarm(alarm, now)).toBe(true);
  });

  it('records a fire key and computes the next occurrence after firing', () => {
    const alarm = prepareAlarmForSave(makeChatAlarm({
      charId: 'char-a',
      kind: 'wake',
      timeHHmm: '07:30',
      weekdays: WORKDAY_WEEKDAYS,
      now: at(2026, 6, 30, 7, 0),
    }), at(2026, 6, 30, 7, 0));
    const fired = markAlarmFired(alarm, at(2026, 6, 30, 7, 31));
    expect(fired.lastFiredKey).toBe(alarmFireKey(alarm, alarm.nextAt));
    expect(fired.nextAt).toBe(at(2026, 7, 1, 7, 30));
  });

  it('resolves auto channel to wake calls and reminder bubbles for other kinds', () => {
    expect(resolveAlarmChannel({ kind: 'wake', channel: 'auto' })).toBe('call');
    expect(resolveAlarmChannel({ kind: 'sleep', channel: 'auto' })).toBe('reminder');
    expect(resolveAlarmChannel({ kind: 'custom', channel: 'reminder' })).toBe('reminder');
  });
});
