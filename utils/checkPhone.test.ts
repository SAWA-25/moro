import { describe, expect, it } from 'vitest';
import type { CharacterProfile, PhoneEvidence } from '../types';
import {
  buildCheckPhoneRecordPrompt,
  buildCheckPhoneStatusSummary,
  buildPhoneCheckSessionSummary,
  calculatePhoneCheckRisk,
  createPhoneCheckSession,
  makePhoneCheckAction,
  mapXunjiToPhoneEvidence,
  normalizePhoneEvidence,
  normalizePhoneCheckSession,
  parsePhoneEvidenceJson,
  summarizeEvidenceTrail,
} from './checkPhone';
import { safeParsePhoneCheckScript } from '../components/chat/CharPhoneCheckOverlay';
import {
  DEFAULT_XUNJI_REPORT_RULES,
  generateXunjiMonitorSnapshot,
  generateXunjiReports,
  generateXunjiScreenlifeRun,
} from './xunji';

const char: CharacterProfile = {
  id: 'char-check-phone',
  name: '查岗测试角色',
  avatar: '📱',
  description: '一个生活在上海、手机里有许多日常痕迹的人。',
  systemPrompt: 'TA 细腻、会社交，最近经常在咖啡店和公司之间往返。',
  memories: [],
  cityConfig: { mode: 'real', realCity: '上海' },
};

describe('check phone utilities', () => {
  it('normalizes legacy PhoneEvidence without meta', () => {
    const legacy: PhoneEvidence = {
      id: 'old-rec',
      type: 'delivery',
      title: '旧外卖记录',
      detail: '一份旧格式记录',
      timestamp: 123,
      value: '已送达',
    };

    const normalized = normalizePhoneEvidence(legacy, { type: legacy.type, appName: '外卖', source: 'generated', now: 999 });

    expect(normalized.id).toBe('old-rec');
    expect(normalized.title).toBe('旧外卖记录');
    expect(normalized.meta?.appName).toBe('外卖');
    expect(normalized.meta?.source).toBe('generated');
    expect(normalized.meta?.risk).toBe('normal');
  });

  it('parses array and wrapped object payloads from LLM output', () => {
    const arrayRecords = parsePhoneEvidenceJson('```json\n[{"title":"A","detail":"B","meta":{"risk":"private"}}]\n```', {
      type: 'notes',
      appName: '备忘录',
      now: 1000,
    });
    const wrappedRecords = parsePhoneEvidenceJson('{"records":[{"title":"C","summary":"D","tags":["搜索"]}]}', {
      type: 'browser',
      appName: '浏览',
      now: 1000,
    });

    expect(arrayRecords).toHaveLength(1);
    expect(arrayRecords[0].meta?.risk).toBe('private');
    expect(wrappedRecords).toHaveLength(1);
    expect(wrappedRecords[0].detail).toBe('D');
    expect(wrappedRecords[0].meta?.tags).toEqual(['搜索']);
  });

  it('maps xunji snapshot/run/report data into phone evidence records', async () => {
    const snapshot = generateXunjiMonitorSnapshot({ char, now: Date.UTC(2026, 6, 3, 12), seed: 'check-phone-map' });
    const run = await generateXunjiScreenlifeRun({
      char,
      rangeStart: Date.UTC(2026, 6, 3, 8),
      rangeEnd: Date.UTC(2026, 6, 3, 12),
      density: 'standard',
      writeBack: false,
      seed: 'check-phone-run',
    });
    const reports = generateXunjiReports({ char, snapshot, rules: DEFAULT_XUNJI_REPORT_RULES }).slice(0, 2);
    const records = mapXunjiToPhoneEvidence({ run, snapshot, reports, now: Date.UTC(2026, 6, 3, 12) });
    const status = buildCheckPhoneStatusSummary(snapshot);

    expect(status?.phoneModel).toBe(snapshot.phoneModel);
    expect(records.length).toBeGreaterThan(0);
    expect(records.some(r => r.meta?.source === 'xunji')).toBe(true);
    expect(records.some(r => r.type === 'chat')).toBe(true);
    expect(records.some(r => r.meta?.relatedXunjiSnapshotId === snapshot.id)).toBe(true);
  });

  it('includes city grounding for city-sensitive apps', () => {
    const prompt = buildCheckPhoneRecordPrompt({
      char,
      userName: '用户',
      type: 'delivery',
      context: '角色核心上下文',
      recentMessages: '用户: 想吃点东西',
      timeGap: '你们刚刚还在聊天。',
    });

    expect(prompt?.prompt).toContain('上海');
    expect(prompt?.prompt).toContain('真实存在的餐厅');
    expect(prompt?.prompt).toContain('Phone Screenlife Snapshot');
  });

  it('normalizes and summarizes phone check sessions', () => {
    const record = normalizePhoneEvidence({
      id: 'rec-suspicious',
      type: 'chat',
      title: '同事',
      detail: '对方: 今晚还来吗\n我: 先别说',
      meta: { appName: '信息', risk: 'suspicious', participants: ['同事'] },
    }, { type: 'chat', appName: '信息', now: 100 });
    const session = createPhoneCheckSession({
      direction: 'user_to_char',
      charId: char.id,
      charName: char.name,
      userName: '用户',
      mode: 'relationship',
      statusSnapshot: { phoneModel: 'Moro Phone', batteryLevel: 61, screenTimeMinutes: 88 },
      startedAt: 100,
    });
    const normalized = normalizePhoneCheckSession({
      ...session,
      evidence: [record],
      actions: [...session.actions, makePhoneCheckAction({ type: 'collect_evidence', label: '收线索', recordId: record.id, risk: 'suspicious', at: 120 })],
      status: 'finished',
      endedAt: 160,
    });
    const summary = buildPhoneCheckSessionSummary(normalized, char.name, '用户');
    const trail = summarizeEvidenceTrail(normalized.evidence);

    expect(normalized.mode).toBe('relationship');
    expect(summary).toContain('关系线索');
    expect(summary).toContain('信息「同事」');
    expect(trail).toContain('相关人：同事');
  });

  it('accumulates check-phone risk from actions and evidence', () => {
    const privateRecord = normalizePhoneEvidence({
      type: 'map',
      title: '酒店附近',
      detail: '停留 42 分钟',
      meta: { risk: 'suspicious', appName: '地图' },
    }, { type: 'map', appName: '地图', now: 200 });
    const quiet = calculatePhoneCheckRisk([], []);
    const risky = calculatePhoneCheckRisk([
      makePhoneCheckAction({ type: 'delete_record', label: '删记录', risk: 'suspicious', at: 210 }),
      makePhoneCheckAction({ type: 'post_moment_as_character', label: '代发动态', risk: 'suspicious', at: 220 }),
    ], [privateRecord]);

    expect(risky).toBeGreaterThan(quiet);
    expect(risky).toBeGreaterThan(0.4);
  });

  it('parses reverse phone check script extension fields', () => {
    const parsed = safeParsePhoneCheckScript(JSON.stringify({
      steps: [
        { app: 'home', thought: '先看桌面。', intent: '确认入口', emotion: '警觉', risk: 'normal', visibleClue: '桌面小组件' },
        { app: 'twitter', thought: '这条外文动态挺刺眼。', intent: '看社交', emotion: '吃醋', risk: 'private', visibleClue: '推特时间线有外文推文' },
        { app: 'chat-thread', targetName: '朋友', thought: '这话我不爱看。', intent: '确认关系', emotion: '酸', risk: 'suspicious', visibleClue: '最近聊天', actionReason: '占有欲上来', action: { type: 'reply', content: '先别找我。' } },
      ],
      exitQuestions: ['你刚才瞒我什么？'],
      endHint: '有点吃醋',
    }));

    expect(parsed?.steps).toHaveLength(3);
    expect(parsed?.steps[1].app).toBe('twitter');
    expect(parsed?.steps[2].actionReason).toBe('占有欲上来');
    expect(parsed?.exitQuestions).toHaveLength(3);
  });
});
