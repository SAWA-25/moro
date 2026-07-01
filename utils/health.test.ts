import { describe, expect, it } from 'vitest';
import type { PeriodReminderSettings } from '../types';
import {
  computeHealthGoalProgress,
  computeNextHealthReminderAt,
  buildHealthSummaryCompanionHint,
  healthPrivacyAllowsReminder,
  healthPrivacyAllowsSummary,
  healthReminderFireKey,
  makeHealthPlan,
  makeHealthRecord,
  markHealthReminderFired,
  mergeHealthModuleSettings,
  normalizeHealthReminder,
  periodEventsToHealthRecords,
  shouldSkipStaleHealthReminder,
} from './health';
import { HEALTH_REMINDER_GRACE_MS } from './health';
import { preparePeriodReminderSettings } from './periodReminders';

const at = (year: number, month: number, day: number, hour = 0, minute = 0) =>
  new Date(year, month - 1, day, hour, minute, 0, 0).getTime();

describe('health center utilities', () => {
  it('fills default module settings with private privacy', () => {
    const settings = mergeHealthModuleSettings([]);
    expect(settings).toHaveLength(7);
    expect(settings.every(item => item.privacy === 'private')).toBe(true);
    expect(settings.find(item => item.id === 'hydration')?.goals?.target).toBeGreaterThan(0);
  });

  it('normalizes records and computes daily goal progress', () => {
    const a = makeHealthRecord({ moduleId: 'hydration', date: '2026-07-01', value: 300, unit: 'ml', tags: [' water ', 'water'] }, at(2026, 7, 1, 8));
    const b = makeHealthRecord({ moduleId: 'hydration', date: '2026-07-01', value: 500, unit: 'ml' }, at(2026, 7, 1, 9));
    const plan = makeHealthPlan({ moduleId: 'hydration', target: 1600, unit: 'ml' });

    expect(a.tags).toEqual(['water']);
    expect(computeHealthGoalProgress(plan, [a, b], '2026-07-01')).toEqual({
      current: 800,
      target: 1600,
      ratio: 0.5,
      unit: 'ml',
    });
  });

  it('computes daily reminder nextAt and marks a fire key', () => {
    const reminder = normalizeHealthReminder({
      moduleId: 'medication',
      title: '晚药',
      timeHHmm: '21:30',
      frequency: 'daily',
    }, at(2026, 7, 1, 10));

    expect(computeNextHealthReminderAt(reminder, at(2026, 7, 1, 22))).toBe(at(2026, 7, 2, 21, 30));
    const fired = markHealthReminderFired({ ...reminder, nextAt: at(2026, 7, 1, 21, 30) }, at(2026, 7, 1, 21, 31));
    expect(fired.lastFiredKey).toBe(healthReminderFireKey(reminder, at(2026, 7, 1, 21, 30)));
  });

  it('skips stale reminders and resolves privacy capabilities', () => {
    const now = at(2026, 7, 1, 12);
    const reminder = normalizeHealthReminder({ nextAt: now - HEALTH_REMINDER_GRACE_MS - 1 }, now);
    expect(shouldSkipStaleHealthReminder({ ...reminder, nextAt: now - HEALTH_REMINDER_GRACE_MS - 1 }, now)).toBe(true);
    expect(healthPrivacyAllowsReminder('summary_reminder')).toBe(true);
    expect(healthPrivacyAllowsSummary('summary')).toBe(true);
    expect(healthPrivacyAllowsReminder('summary')).toBe(false);
  });

  it('maps old period events into health records', () => {
    const records = periodEventsToHealthRecords([
      { id: 'start-1', kind: 'start', date: '2026-06-01', createdAt: 1, updatedAt: 2 },
      { id: 'end-1', kind: 'end', date: '2026-06-05', createdAt: 3, updatedAt: 4 },
    ]);
    expect(records.map(record => record.label)).toEqual(['开始', '结束']);
    expect(records.every(record => record.moduleId === 'period')).toBe(true);
  });

  it('keeps period reminder prediction stable when legacy settings exist', () => {
    const legacy: PeriodReminderSettings = preparePeriodReminderSettings({
      enabled: true,
      lastStartDate: '2026-06-01',
      cycleLength: 28,
      remindOffsets: [-2, 0],
      timeHHmm: '09:00',
    }, at(2026, 6, 20));
    expect(legacy.nextAt).toBe(at(2026, 6, 27, 9));
  });

  it('builds non-diagnostic health summary companion hints', () => {
    const hint = buildHealthSummaryCompanionHint({
      summaryText: '饮水：500ml；睡眠：7.5小时',
      char: { name: '阿澄' },
      userName: '我',
      nowMs: at(2026, 7, 1, 10),
    });
    expect(hint).toContain('不要诊断');
    expect(hint).toContain('饮水：500ml');
  });
});
