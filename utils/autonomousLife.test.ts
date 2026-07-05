import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CharacterProfile, CharLifeEvent, DailySchedule } from '../types';
import { canCharContactUser } from './blockSystem';
import { DB } from './db';
import {
  alignLifeEventToScheduleSlot,
  advanceLife,
  buildAutonomousProactiveHint,
  catchUpOfflineLife,
  isAutonomousLifeEnabled,
  planAutonomousProactiveTurn,
  sanitizeLifeText,
  scoreLifeEventForProactive,
  type LifeApi,
} from './autonomousLife';

const API: LifeApi = { baseUrl: 'https://api.example.test/v1', apiKey: 'sk-test', model: 'test-model' };

const mkChar = (patch: Partial<CharacterProfile> = {}): CharacterProfile => ({
  id: 'char-life-v2',
  name: 'Life V2',
  avatar: '',
  description: '',
  systemPrompt: '普通上班族，嘴硬但心软。',
  memories: [],
  contextLimit: 500,
  ...patch,
  proactiveConfig: {
    enabled: true,
    intervalMinutes: 60,
    autonomousLifeEnabled: true,
    ...patch.proactiveConfig,
  },
} as CharacterProfile);

const mkEvent = (patch: Partial<CharLifeEvent> = {}): CharLifeEvent => ({
  id: `life-test-${patch.timestamp || 1}`,
  charId: 'char-life-v2',
  timestamp: 1_788_000_000_000,
  activity: '盯着没喝完的咖啡发呆，杯沿已经凉了',
  mood: '疲惫',
  summary: '咖啡都凉了',
  source: 'proactive',
  ...patch,
});

const mkSchedule = (charId: string, date: string): DailySchedule => ({
  id: `${charId}_${date}`,
  charId,
  date,
  generatedAt: Date.now(),
  slots: [
    { startTime: '09:00', endTime: '10:00', activity: '通勤', location: '地铁' },
    { startTime: '14:00', endTime: '15:00', activity: '项目会', location: '公司会议室', description: '讨论改版排期' },
    { startTime: '20:00', endTime: '22:00', activity: '看电影', location: '线上', source: 'chat', anchored: true },
  ],
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await DB.deleteDB();
});

describe('autonomous life v2', () => {
  it('hides prompt-leak life text instead of showing task instructions', () => {
    const leaked = '我们被要求生成流浪者此刻正在经历的一件【切片小事】。时间是7月3日周五11:13（中午）。生活密度normal，主动强度balanced，来信口味natural。需要围绕流浪者最近生活的线索：左手中指指甲缝里的竹刺。';

    expect(sanitizeLifeText(leaked)).toBe('');
    expect(sanitizeLifeText(`{"activity":"${leaked}","mood":"困倦"}`)).toBe('');
  });

  it('does not save autonomous life events when the model echoes the prompt', async () => {
    await DB.deleteDB();
    const now = 1_788_000_000_000;
    const leaked = {
      activity: '我们被要求生成Life V2此刻正在经历的一件【切片小事】。生活密度normal，主动强度balanced，来信口味natural。需要围绕最近生活线索写。',
      summary: '请生成 TA 此刻正在经历的小事，只返回 JSON。',
      mood: '普通',
    };
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(leaked) } }] }),
      json: async () => ({ choices: [{ message: { content: JSON.stringify(leaked) } }] }),
    })));

    const event = await advanceLife(mkChar(), API, { now });

    expect(event).toBeNull();
    expect(await DB.getLifeEvents('char-life-v2')).toHaveLength(0);
  });

  it('scores low-share silence events below lively share events', () => {
    const quiet = mkEvent({ intensity: 30, shareWillingness: 10, proactiveAngle: 'silence', energy: 'low' });
    const lively = mkEvent({ intensity: 70, shareWillingness: 80, proactiveAngle: 'ask', energy: 'high' });

    expect(scoreLifeEventForProactive(quiet)).toBeLessThan(25);
    expect(scoreLifeEventForProactive(lively)).toBeGreaterThan(70);
  });

  it('random smart mode can keep a low-score life event without sending', async () => {
    await DB.deleteDB();
    const now = 1_788_000_000_000;
    const char = mkChar({ proactiveConfig: { enabled: true, intervalMinutes: 60, randomMode: true, intensity: 'balanced' } as any });
    await DB.saveLifeEvent(mkEvent({ timestamp: now - 5 * 60_000, intensity: 20, shareWillingness: 12, proactiveAngle: 'silence' }));

    const plan = await planAutonomousProactiveTurn(char, API, { now, randomMode: true });

    expect(plan.decision).toBe('life_only');
    expect(plan.reason).toBe('low_share_willingness');
    expect(plan.event?.surfacedAsMsg).toBeFalsy();
  });

  it('fixed mode still sends even when the life event score is low', async () => {
    await DB.deleteDB();
    const now = 1_788_000_000_000;
    const char = mkChar({ proactiveConfig: { enabled: true, intervalMinutes: 60, intensity: 'quiet' } as any });
    await DB.saveLifeEvent(mkEvent({ timestamp: now - 5 * 60_000, intensity: 20, shareWillingness: 12, proactiveAngle: 'silence' }));

    const plan = await planAutonomousProactiveTurn(char, API, { now, randomMode: false });

    expect(plan.decision).toBe('send');
    expect(plan.event).toBeTruthy();
  });

  it('parses legacy batch events and v2 fields while life density changes catch-up count', async () => {
    await DB.deleteDB();
    const raw = Array.from({ length: 8 }, (_, i) => ({
      activity: `第 ${i + 1} 件小事`,
      mood: '平静',
      summary: `碎碎念 ${i + 1}`,
      eventKind: i === 0 ? 'work' : 'routine',
      energy: 'medium',
      intensity: 40 + i,
      shareWillingness: 30 + i,
      proactiveAngle: 'share',
    }));
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(raw) } }] }),
      json: async () => ({ choices: [{ message: { content: JSON.stringify(raw) } }] }),
    })));

    const now = 1_788_000_000_000;
    const gapStart = now - 12 * 60 * 60 * 1000;
    const sparse = await catchUpOfflineLife(mkChar({ id: 'sparse', proactiveConfig: { enabled: true, intervalMinutes: 60, lifeDensity: 'sparse' } as any }), API, gapStart, { now });
    const busy = await catchUpOfflineLife(mkChar({ id: 'busy', proactiveConfig: { enabled: true, intervalMinutes: 60, lifeDensity: 'busy' } as any }), API, gapStart, { now });

    expect(sparse).toHaveLength(2);
    expect(busy).toHaveLength(6);
    expect(busy[0]).toMatchObject({ eventKind: 'work', energy: 'medium', proactiveAngle: 'share' });
  });

  it('syncs life material with the current daily schedule slot', async () => {
    await DB.deleteDB();
    const now = new Date(2026, 6, 3, 14, 30).getTime();
    const date = new Date(now).toISOString().slice(0, 10);
    const char = mkChar({ scheduleFeatureEnabled: true, scheduleStyle: 'lifestyle' });
    await DB.saveDailySchedule(mkSchedule(char.id, date));
    const raw = {
      activity: '在项目会中场去茶水间接了杯水',
      mood: '有点绷着',
      summary: '会议间隙接水',
      eventKind: 'work',
      energy: 'medium',
      intensity: 55,
      shareWillingness: 42,
      proactiveAngle: 'share',
    };
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(raw) } }] }),
      json: async () => ({ choices: [{ message: { content: JSON.stringify(raw) } }] }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const event = await advanceLife(char, API, { now });

    expect(event).toMatchObject({
      activity: raw.activity,
      scheduleDate: date,
      scheduleSlotStartTime: '14:00',
      scheduleSlotActivity: '项目会',
    });
    const requestInit = (fetchMock as any).mock.calls[0]?.[1] as RequestInit | undefined;
    const req = JSON.parse(String(requestInit?.body || '{}'));
    const userPrompt = req.messages?.find((m: any) => m.role === 'user')?.content || '';
    expect(userPrompt).toContain('今日作息对齐');
    expect(userPrompt).toContain('14:00-15:00 项目会');
    expect(userPrompt).toContain('20:00-22:00 看电影');
    expect(userPrompt).toContain('不要让 TA 在同一时间出现在两个地点');
  });

  it('uses the current schedule location when life generation invents another room', async () => {
    await DB.deleteDB();
    const now = new Date(2026, 6, 3, 14, 30).getTime();
    const date = new Date(now).toISOString().slice(0, 10);
    const char = mkChar({ scheduleFeatureEnabled: true, scheduleStyle: 'lifestyle' });
    await DB.saveDailySchedule({
      id: `${char.id}_${date}`,
      charId: char.id,
      date,
      generatedAt: Date.now(),
      slots: [
        {
          startTime: '14:00',
          endTime: '15:00',
          activity: '闭目养神',
          description: '躺在皮质沙发上放空',
          location: '客厅',
        },
      ],
    });
    const raw = {
      activity: '把东西拿进书房来找人',
      location: '书房',
      summary: '去书房找人',
      mood: '松弛',
      eventKind: 'rest',
      energy: 'low',
      intensity: 45,
      shareWillingness: 55,
      proactiveAngle: 'share',
    };
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(raw) } }] }),
      json: async () => ({ choices: [{ message: { content: JSON.stringify(raw) } }] }),
    })));

    const event = await advanceLife(char, API, { now });

    expect(event?.location).toBe('客厅');
    expect(event?.activity).toContain('客厅');
    expect(event?.activity).toContain('皮质沙发');
    expect(event?.activity).not.toContain('书房');

    const hint = buildAutonomousProactiveHint({
      char,
      userName: 'User',
      timeStr: '2026-07-03 14:30',
      timeSinceUser: '',
      event: event!,
    });
    expect(hint).toContain('地点硬约束');
    expect(hint).toContain('不要把消息改写成其它房间');
  });

  it('can align an already-built life event to a schedule slot', () => {
    const aligned = alignLifeEventToScheduleSlot(
      mkEvent({ activity: '钻进书房翻书', summary: '在书房耗着', location: '书房' }),
      { startTime: '17:30', activity: '闭目养神', description: '躺在皮质沙发上', location: '客厅' },
    );

    expect(aligned.location).toBe('客厅');
    expect(aligned.activity).toBe('在客厅，躺在皮质沙发上');
    expect(aligned.summary).toBe('在客厅，躺在皮质沙发上');
  });

  it('syncs catch-up life events with planned daily schedule slots', async () => {
    await DB.deleteDB();
    const now = new Date(2026, 6, 3, 18, 0).getTime();
    const gapStart = new Date(2026, 6, 3, 12, 0).getTime();
    const date = '2026-07-03';
    const char = mkChar({ id: 'catchup-schedule', scheduleFeatureEnabled: true, scheduleStyle: 'lifestyle' });
    await DB.saveDailySchedule({
      id: `${char.id}_${date}`,
      charId: char.id,
      date,
      generatedAt: Date.now(),
      slots: [
        { startTime: '12:00', endTime: '15:00', activity: '午后整理', location: '家里' },
        { startTime: '15:00', endTime: '18:00', activity: '出门采购', location: '超市' },
      ],
    });
    const raw = [
      { activity: '把桌上的文件按颜色重新分了一遍', summary: '整理桌面', eventKind: 'routine' },
      { activity: '在超市货架前犹豫要不要买同款杯子', summary: '挑杯子', eventKind: 'errand' },
    ];
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(raw) } }] }),
      json: async () => ({ choices: [{ message: { content: JSON.stringify(raw) } }] }),
    })));

    const events = await catchUpOfflineLife(char, API, gapStart, { now });

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      scheduleDate: date,
      scheduleSlotStartTime: '12:00',
      scheduleSlotActivity: '午后整理',
    });
    expect(events[1]).toMatchObject({
      scheduleDate: date,
      scheduleSlotStartTime: '15:00',
      scheduleSlotActivity: '出门采购',
    });
  });

  it('marks surfaced events with the actual sent time', async () => {
    await DB.deleteDB();
    const ev = mkEvent({ id: 'life-surfaced', surfacedAsMsg: false });
    await DB.saveLifeEvent(ev);

    await DB.markLifeEventSurfaced(ev.id, 1_788_000_123_000);

    const [saved] = await DB.getLifeEvents(ev.charId);
    expect(saved.surfacedAsMsg).toBe(true);
    expect(saved.surfacedAt).toBe(1_788_000_123_000);
  });

  it('keeps autonomous life enabled while user-blacklisted characters cannot contact the user', () => {
    const blocked = mkChar({ blacklisted: true });

    expect(isAutonomousLifeEnabled(blocked)).toBe(true);
    expect(canCharContactUser(blocked)).toBe(false);
  });
});
