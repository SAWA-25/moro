import { describe, expect, it } from 'vitest';
import type { CharacterProfile } from '../types';
import {
  DEFAULT_XUNJI_REPORT_RULES,
  XUNJI_REPORT_TYPES,
  createDefaultXunjiSettings,
  generateXunjiMonitorSnapshot,
  generateXunjiReports,
  generateXunjiScreenlifeRun,
  buildXunjiChatContextBlock,
  shouldAutoAdvanceXunji,
  summarizeXunjiForCharacter,
} from './xunji';
import { buildCheckPhoneStatusSummary, mapXunjiToPhoneEvidence } from './checkPhone';

const char: CharacterProfile = {
  id: 'char-xunji',
  name: '循迹测试角色',
  avatar: '🛰️',
  description: '一个经常在城市里走动、会记录生活细节的人。',
  systemPrompt: 'TA 是一个细腻、会社交、也会独处刷手机的角色，在公司和咖啡店之间往返。',
  memories: [],
  socialProfile: { handle: 'trace_me', region: '上海' },
  cityConfig: { mode: 'real', realCity: '上海' },
};

describe('xunji generators', () => {
  it('creates default settings with all report rules enabled', () => {
    const settings = createDefaultXunjiSettings(char.id);

    expect(settings.activeCharId).toBe(char.id);
    expect(settings.defaultDensity).toBe('standard');
    expect(settings.autoTraceEnabled).toBe(true);
    expect(Object.keys(settings.reportRules).sort()).toEqual([...XUNJI_REPORT_TYPES].sort());
    expect(Object.values(settings.reportRules).every(Boolean)).toBe(true);
  });

  it('advances traces only after an initial screenlife seed and enough time', async () => {
    const settings = createDefaultXunjiSettings(char.id);
    const now = Date.UTC(2026, 5, 29, 12);

    expect(shouldAutoAdvanceXunji({ settings, charId: char.id, now }).reason).toBe('no-seed');

    const run = await generateXunjiScreenlifeRun({
      char,
      rangeStart: now - 2 * 60 * 60 * 1000,
      rangeEnd: now - 50 * 60 * 1000,
      density: 'standard',
      writeBack: false,
      seed: 'auto-seed',
    });
    const ready = shouldAutoAdvanceXunji({ settings, charId: char.id, latestRun: run, now });

    expect(ready.shouldRun).toBe(true);
    expect(ready.rangeStart).toBe(run.rangeEnd);
    expect(ready.rangeEnd).toBe(now);

    const tooSoon = shouldAutoAdvanceXunji({
      settings: { ...settings, autoTraceLastAtByChar: { [char.id]: now - 10 * 60 * 1000 } },
      charId: char.id,
      latestRun: run,
      now,
    });

    expect(tooSoon.shouldRun).toBe(false);
    expect(tooSoon.reason).toBe('too-soon');
  });

  it('generates a complete monitoring snapshot for every screenshot section', () => {
    const snapshot = generateXunjiMonitorSnapshot({ char, now: Date.UTC(2026, 5, 29, 12), seed: 'stable' });

    expect(snapshot.appUsage.length).toBeGreaterThan(0);
    expect(snapshot.unlockCount).toBeGreaterThan(0);
    expect(snapshot.screenTimeMinutes).toBeGreaterThan(0);
    expect(snapshot.lockPeriods.length).toBeGreaterThan(0);
    expect(snapshot.networks.length).toBeGreaterThan(0);
    expect(snapshot.phoneModel).toBeTruthy();
    expect(snapshot.locations.some(p => p.stayMinutes && p.moveMinutes !== undefined)).toBe(true);
    expect(snapshot.distanceKm).toBeGreaterThan(0);
    expect(snapshot.health.hrvAvg).toBeGreaterThan(0);
    expect(snapshot.health.hrvCurrent).toBeGreaterThan(0);
    expect(snapshot.health.hrvTrend.length).toBeGreaterThan(0);
    expect(snapshot.health.heartRateLatest).toBeGreaterThan(0);
    expect(snapshot.health.heartRateTrend.length).toBeGreaterThan(0);
    expect(snapshot.health.sleepMinutes).toBeGreaterThan(0);
    expect(snapshot.health.sleep.deepMinutes).toBeGreaterThan(0);
    expect(snapshot.health.steps).toBeGreaterThan(0);
    expect(snapshot.health.dayStepTrend.length).toBeGreaterThan(0);
    expect(snapshot.health.weekStepTrend.length).toBeGreaterThan(0);
    expect(snapshot.calls.length).toBeGreaterThan(0);
    expect(snapshot.batteryEvents.length).toBeGreaterThan(0);
    expect(snapshot.batteryLevel).toBeGreaterThanOrEqual(0);
  });

  it('emits every report type when all rules are enabled', () => {
    const snapshot = generateXunjiMonitorSnapshot({ char, now: Date.UTC(2026, 5, 29, 12), seed: 'reports' });
    const reports = generateXunjiReports({ char, snapshot, rules: DEFAULT_XUNJI_REPORT_RULES });
    const emitted = new Set(reports.map(r => r.type));

    for (const type of XUNJI_REPORT_TYPES) {
      expect(emitted.has(type), type).toBe(true);
    }
  });

  it('suppresses disabled report rules', () => {
    const snapshot = generateXunjiMonitorSnapshot({ char, now: Date.UTC(2026, 5, 29, 12), seed: 'disabled' });
    const rules = { ...DEFAULT_XUNJI_REPORT_RULES, app_hourly: false, sleep_late_reminder: false };
    const reports = generateXunjiReports({ char, snapshot, rules });

    expect(reports.some(r => r.type === 'app_hourly')).toBe(false);
    expect(reports.some(r => r.type === 'sleep_late_reminder')).toBe(false);
  });

  it('keeps stable seed values stable', () => {
    const a = generateXunjiMonitorSnapshot({ char, now: Date.UTC(2026, 5, 29, 12), seed: 'same-seed' });
    const b = generateXunjiMonitorSnapshot({ char, now: Date.UTC(2026, 5, 29, 12), seed: 'same-seed' });

    expect(a.phoneModel).toBe(b.phoneModel);
    expect(a.unlockCount).toBe(b.unlockCount);
    expect(a.appUsage.map(s => `${s.appName}:${s.startedAt}:${s.endedAt}`)).toEqual(b.appUsage.map(s => `${s.appName}:${s.startedAt}:${s.endedAt}`));
  });

  it('generates Screenlife locally and scales with density', async () => {
    const light = await generateXunjiScreenlifeRun({
      char,
      rangeStart: Date.UTC(2026, 5, 29, 8),
      rangeEnd: Date.UTC(2026, 5, 29, 22),
      density: 'light',
      writeBack: false,
      seed: 'screen',
    });
    const detailed = await generateXunjiScreenlifeRun({
      char,
      rangeStart: Date.UTC(2026, 5, 29, 8),
      rangeEnd: Date.UTC(2026, 5, 29, 22),
      density: 'detailed',
      writeBack: true,
      seed: 'screen',
    });

    expect(light.narrative).toBeTruthy();
    expect(light.chats.length).toBeGreaterThan(0);
    expect(light.browsed.length).toBeGreaterThan(0);
    expect(light.notes.length).toBeGreaterThan(0);
    expect(light.appUsage.length).toBeGreaterThan(0);
    expect(light.socialInference?.screenlifeScore).toBeGreaterThanOrEqual(0);
    expect(light.socialInference?.nextConversationSeeds.length).toBeGreaterThan(0);
    expect(light.moments?.length).toBeGreaterThan(0);
    expect(detailed.chats.length).toBeGreaterThan(light.chats.length);
    expect(detailed.browsed.length).toBeGreaterThan(light.browsed.length);
    expect(detailed.writeBack).toBe(true);
  });

  it('falls back when Screenlife API fails', async () => {
    const run = await generateXunjiScreenlifeRun({
      char,
      api: { baseUrl: 'https://invalid.example.test', apiKey: '', model: 'x' },
      rangeStart: Date.UTC(2026, 5, 29, 8),
      rangeEnd: Date.UTC(2026, 5, 29, 22),
      density: 'standard',
      writeBack: false,
      seed: 'fallback',
    });

    expect(run.title).toContain(char.name);
    expect(run.chats.length).toBeGreaterThan(0);
  });

  it('summarizes xunji data for character write-back', () => {
    const snapshot = generateXunjiMonitorSnapshot({ char, now: Date.UTC(2026, 5, 29, 12), seed: 'summary' });
    const reports = generateXunjiReports({ char, snapshot, rules: DEFAULT_XUNJI_REPORT_RULES }).slice(0, 2);
    const text = summarizeXunjiForCharacter({ snapshot, reports });

    expect(text).toContain('今日手机');
    expect(text).toContain('报备');
  });

  it('builds a xunji chat context block for Xuyu integration', async () => {
    const snapshot = generateXunjiMonitorSnapshot({ char, now: Date.UTC(2026, 5, 29, 12), seed: 'chat-context' });
    const run = await generateXunjiScreenlifeRun({
      char,
      rangeStart: Date.UTC(2026, 5, 29, 8),
      rangeEnd: Date.UTC(2026, 5, 29, 22),
      density: 'standard',
      writeBack: true,
      seed: 'chat-context-run',
    });
    const reports = generateXunjiReports({ char, snapshot, rules: DEFAULT_XUNJI_REPORT_RULES }).slice(0, 3);
    const block = buildXunjiChatContextBlock({ char, userName: '用户', run, snapshot, reports });

    expect(block).toContain('循迹·近期生活痕迹');
    expect(block).toContain('Screenlife');
    expect(block).toContain('适合在絮语里自然接的话题');
  });

  it('exposes latest xunji data as check-phone status and evidence', async () => {
    const snapshot = generateXunjiMonitorSnapshot({ char, now: Date.UTC(2026, 5, 29, 12), seed: 'check-phone-compat' });
    const run = await generateXunjiScreenlifeRun({
      char,
      rangeStart: Date.UTC(2026, 5, 29, 8),
      rangeEnd: Date.UTC(2026, 5, 29, 12),
      density: 'standard',
      writeBack: false,
      seed: 'check-phone-compat-run',
    });
    const records = mapXunjiToPhoneEvidence({ run, snapshot });
    const status = buildCheckPhoneStatusSummary(snapshot);

    expect(status?.unlockCount).toBe(snapshot.unlockCount);
    expect(status?.topAppName).toBeTruthy();
    expect(records.some(r => r.meta?.source === 'xunji')).toBe(true);
    expect(records.some(r => r.meta?.relatedXunjiRunId === run.id)).toBe(true);
  });
});
