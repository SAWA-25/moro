import { describe, expect, it } from 'vitest';
import { AppID, type CharacterProfile, type PhoneEvidence } from '../types';
import {
  buildCheckPhoneRecordPrompt,
  buildCheckPhoneStatusSummary,
  CHECK_PHONE_APP_DEFS,
  formatCharPhoneCheckRecordForContext,
  formatCharPhoneCheckVisibleRecord,
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

  it('includes secret space as a default check-phone app', () => {
    const def = CHECK_PHONE_APP_DEFS.find(app => app.type === 'secret_space');

    expect(def?.key).toBe('secret_space');
    expect(def?.name).toBe('秘密空间');
    expect(def?.logPrefix).toBe('秘密空间');
    expect(def?.instruction).toContain('未发送草稿');
    expect(def?.instruction).toContain('私密笔记');
    expect(def?.instruction).toContain('小心愿');
  });

  it('builds secret space prompts around drafts, private notes, and wishes', () => {
    const prompt = buildCheckPhoneRecordPrompt({
      char,
      userName: '用户',
      type: 'secret_space',
      context: '角色核心上下文',
      recentMessages: '用户: 刚才你好像有话没说',
      timeGap: '你们刚刚还在聊天。',
    });

    expect(prompt?.appName).toBe('秘密空间');
    expect(prompt?.prompt).toContain('秘密空间');
    expect(prompt?.prompt).toContain('未发送草稿');
    expect(prompt?.prompt).toContain('私密笔记');
    expect(prompt?.prompt).toContain('小心愿');
    expect(prompt?.prompt).toContain('Screenlife');
  });

  it('asks chat checks for richer multi-thread phone logs', () => {
    const prompt = buildCheckPhoneRecordPrompt({
      char,
      userName: '用户',
      type: 'chat',
      mode: 'relationship',
      context: '角色核心上下文',
      recentMessages: '用户: 今天你手机好安静',
      timeGap: '你们刚刚还在聊天。',
    });

    expect(prompt?.prompt).toContain('5-6 个');
    expect(prompt?.prompt).toContain('6-10 行');
    expect(prompt?.prompt).toContain('联系人或群聊片段');
    expect(prompt?.prompt).toContain('普通寒暄');
    expect(prompt?.prompt).toContain('半句草稿');
    expect(prompt?.prompt).toContain('不要声称读取真实手机');
  });

  it('normalizes longer multi-speaker chat details and participants', () => {
    const longTail = '晚点把那份表再发我一次。'.repeat(120);
    const record = normalizePhoneEvidence({
      type: 'chat',
      title: '项目小群',
      messages: [
        '我: 刚从咖啡店出来。',
        '小林: 你那边雨停了吗？',
        '阿真: 我把会议改到八点半了。',
        `老板: ${longTail}`,
        '我: 看到了，我先把手头这段收尾。',
        '小林: 那我先占位置。',
      ],
    }, { type: 'chat', appName: '信息', now: 100 });

    expect(record.detail.length).toBeGreaterThan(1200);
    expect(record.detail).toContain('阿真: 我把会议改到八点半了。');
    expect(record.meta?.participants).toEqual(expect.arrayContaining(['项目小群', '小林', '阿真', '老板']));
    expect(record.meta?.participants).not.toContain('我');
  });

  it('defaults ordinary secret-space records to private instead of suspicious', () => {
    const privateRecord = normalizePhoneEvidence({
      type: 'secret_space',
      title: '藏起来的小心愿',
      detail: '秘密：希望下次见面时能先被叫名字。',
    }, { type: 'secret_space', appName: '秘密空间', now: 100 });
    const suspiciousRecord = normalizePhoneEvidence({
      type: 'secret_space',
      title: '删除记录前的草稿',
      detail: '刚才撒谎了，先别让对方知道。',
    }, { type: 'secret_space', appName: '秘密空间', now: 100 });

    expect(privateRecord.meta?.risk).toBe('private');
    expect(suspiciousRecord.meta?.risk).toBe('suspicious');
  });

  it('maps secret-space screenlife app names into private evidence', () => {
    const records = mapXunjiToPhoneEvidence({
      run: {
        id: 'run-secret-space',
        chats: [],
        browsed: [
          { id: 'browse-secret', time: 100, appName: '秘密空间', title: '草稿箱', summary: '只是留给自己的一句话。' },
        ],
        notes: [],
        moments: [],
      } as any,
      now: 100,
    });

    expect(records).toHaveLength(1);
    expect(records[0].type).toBe('secret_space');
    expect(records[0].meta?.appName).toBe('秘密空间');
    expect(records[0].meta?.risk).toBe('private');
  });

  it('expands sparse xunji chat traces into readable check-phone snippets', () => {
    const records = mapXunjiToPhoneEvidence({
      run: {
        id: 'run-chat-sparse',
        chats: [
          { id: 'chat-1', time: 100, target: '小林', summary: '问她晚上还来不来，像还有后半句没说。', messages: ['晚上还来吗？'] },
        ],
        browsed: [],
        notes: [],
        moments: [],
      } as any,
      now: 100,
    });
    const chatRecord = records.find(record => record.type === 'chat');
    const lines = chatRecord?.detail.split('\n').filter(Boolean) || [];

    expect(chatRecord).toBeTruthy();
    expect(lines.length).toBeGreaterThanOrEqual(6);
    expect(chatRecord?.detail).toContain('小林:');
    expect(chatRecord?.detail).toContain('我:');
    expect(chatRecord?.meta?.participants).toContain('小林');
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

  it('formats reverse phone check records without roleplay meta-analysis', () => {
    const context = formatCharPhoneCheckRecordForContext(
      `[查岗记录] 刚才 阿迟 拿走了 用户 的手机翻看。
阿迟 的浏览过程与内心想法：
1. 点开了与「伊萨克」的对话，心想：以我的性格，我不会直接质问，而是用更隐晦的方式表达。
2. 看了朋友圈，心想：这张合照挺刺眼。
用户 强行抢回了手机。
阿迟 此刻的心情基调：这条消息可以是：伊萨克这名字出现得挺勤啊。`,
      '阿迟',
      '用户',
    );

    expect(context).toContain('伊萨克');
    expect(context).toContain('看了朋友圈');
    expect(context).not.toContain('以我的性格');
    expect(context).not.toContain('更隐晦');
    expect(context).not.toContain('这条消息可以是');
    expect(context).not.toContain('心情基调');
    expect(context).not.toContain('余波');
    expect(context).not.toContain('浏览过程与内心想法');
    expect(context).not.toContain('接下来请');
    expect(context).not.toContain('不要复述');
  });

  it('formats visible reverse phone check records as factual notes only', () => {
    const record = formatCharPhoneCheckVisibleRecord({
      charName: '阿迟',
      userName: '用户',
      browsed: ['点开了与「伊萨克」的对话', '看了朋友圈'],
      actions: ['给「伊萨克」回了一句：先别找我。'],
      exitDesc: '用户 强行抢回了手机。',
      extra: '问答内容：用户说只是朋友。',
    });

    expect(record).toContain('[查岗记录]');
    expect(record).toContain('点开了与「伊萨克」的对话');
    expect(record).toContain('给「伊萨克」回了一句');
    expect(record).not.toContain('心想');
    expect(record).not.toContain('内心想法');
    expect(record).not.toContain('心情基调');
    expect(record).not.toContain('有点吃醋');
    expect(record).not.toContain('接下来请');
    expect(record).not.toContain('以我的性格');
    expect(record).not.toContain('这条消息可以是');
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

  it('accepts real desktop app ids for reverse phone check scripts', () => {
    const parsed = safeParsePhoneCheckScript(JSON.stringify({
      steps: [
        { app: 'home', thought: '先看桌面。', intent: '确认桌面', emotion: '警觉', risk: 'normal', visibleClue: '真实桌面' },
        { app: AppID.Almanac, thought: '岁时记里这些日程不像随便记的。', intent: '确认日程', emotion: '在意', risk: 'private', visibleClue: '岁时记待办', action: { type: 'post_moment', content: '乱发一条' } },
        { app: AppID.Health, thought: '健康入口在这里，不能乱猜数值。', intent: '确认状态', emotion: '担心', risk: 'private', visibleClue: '健康 App 入口' },
        { app: 'moments', thought: '这条动态确实有点刺眼。', intent: '确认动态', emotion: '吃醋', risk: 'suspicious', visibleClue: '此刻动态', action: { type: 'post_moment', content: '今天不想被打扰。' } },
      ],
      exitQuestions: ['你为什么藏着这些？', '这条日程是谁？', '你还打算瞒我多久？'],
    }));

    expect(parsed?.steps[1].app).toBe(AppID.Almanac);
    expect(parsed?.steps[1].action?.type).toBe('none');
    expect(parsed?.steps[2].app).toBe(AppID.Health);
    expect(parsed?.steps[3].action?.type).toBe('post_moment');
  });
});
