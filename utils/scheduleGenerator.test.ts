import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterProfile, DailySchedule, Message, UserProfile } from '../types';
import { DB } from './db';
import { callChatCompletion } from './llmClient';
import { chatHasScheduleSignal, generateDailyScheduleForChar, reconcileScheduleWithChat } from './scheduleGenerator';
import { getLocalDateKey } from './dateKey';

vi.mock('./llmClient', () => ({
  callChatCompletion: vi.fn(),
}));

vi.mock('./memoryPalace/pipeline', () => ({
  injectMemoryPalace: vi.fn(),
}));

const API = { baseUrl: 'https://api.example.test/v1', apiKey: 'sk-test', model: 'test-model' };

const user = {
  name: 'User',
  avatar: '',
  bio: '',
} as UserProfile;

const char = {
  id: 'char-isaac',
  modelId: 'model-isaac',
  name: 'Isaac',
  avatar: '',
  description: 'Quiet planner.',
  systemPrompt: 'A precise but gentle person.',
  memories: [],
  contextLimit: 20,
  scheduleFeatureEnabled: true,
  scheduleStyle: 'lifestyle',
} as CharacterProfile;

const slot = {
  startTime: '08:00',
  endTime: '09:00',
  activity: 'Morning',
  description: 'Starts the day as Isaac.',
};

describe('schedule generator character identity', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.clear();
    await DB.deleteDB();
  });

  it('pins generated schedules to the target character modelId', async () => {
    vi.mocked(callChatCompletion).mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            targetCharId: 'model-isaac',
            slots: [slot],
            flowNarrative: { morning: 'I am Isaac this morning.' },
          }),
        },
      }],
    } as any);

    const result = await generateDailyScheduleForChar(char, user, API, true);

    expect(result?.charId).toBe('char-isaac');
    expect(result?.modelId).toBe('model-isaac');
    const request = vi.mocked(callChatCompletion).mock.calls[0][1] as any;
    expect(request.messages[0].content).toContain('targetCharId: "model-isaac"');
    expect(request.messages[0].content).toContain('"targetCharId": "model-isaac"');
    expect(request.messages[0].content).toContain('Isaac (ID: model-isaac)');

    const saved = await DB.getDailySchedule('char-isaac', result!.date);
    expect(saved?.modelId).toBe('model-isaac');
  });

  it('saves generated schedules when the model omits targetCharId', async () => {
    vi.mocked(callChatCompletion).mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            slots: [slot],
            flowNarrative: { morning: 'I am still Isaac this morning.' },
          }),
        },
      }],
    } as any);

    const result = await generateDailyScheduleForChar(char, user, API, true);

    expect(result?.charId).toBe('char-isaac');
    expect(result?.modelId).toBe('model-isaac');
    const saved = await DB.getDailySchedule('char-isaac', getLocalDateKey());
    expect(saved?.slots[0]?.activity).toBe('Morning');
  });

  it('saves generated schedules from mixed prose and fenced JSON', async () => {
    vi.mocked(callChatCompletion).mockResolvedValueOnce({
      choices: [{
        message: {
          content: [
            '好的，结果如下：',
            '```json',
            JSON.stringify({
              targetCharId: 'model-isaac',
              slots: [slot],
              flowNarrative: { morning: 'I am still Isaac this morning.' },
            }),
            '```',
            '如果还要我再排一版也可以。',
          ].join('\n'),
        },
      }],
    } as any);

    const result = await generateDailyScheduleForChar(char, user, API, true);

    expect(result?.slots[0]?.activity).toBe('Morning');
    const saved = await DB.getDailySchedule('char-isaac', getLocalDateKey());
    expect(saved?.slots[0]?.activity).toBe('Morning');
  });

  it('unwraps nested schedule payloads when saving generated schedules', async () => {
    vi.mocked(callChatCompletion).mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            data: {
              schedule: {
                targetCharId: 'model-isaac',
                slots: [slot],
                flowNarrative: { morning: 'Nested but valid.' },
              },
            },
          }),
        },
      }],
    } as any);

    const result = await generateDailyScheduleForChar(char, user, API, true);

    expect(result?.modelId).toBe('model-isaac');
    const saved = await DB.getDailySchedule('char-isaac', getLocalDateKey());
    expect(saved?.slots[0]?.activity).toBe('Morning');
  });

  it('does not save a generated schedule returned for another character id', async () => {
    vi.mocked(callChatCompletion).mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            targetCharId: 'model-other',
            slots: [slot],
          }),
        },
      }],
    } as any);

    const result = await generateDailyScheduleForChar(char, user, API, true);

    expect(result).toBeNull();
    const today = getLocalDateKey();
    await expect(DB.getDailySchedule('char-isaac', today)).resolves.toBeNull();
  });

  it('marks previous-night chat as elapsed when generating after midnight', async () => {
    await DB.saveMessage({
      charId: 'char-isaac',
      role: 'user',
      type: 'text',
      content: '今晚八点我们已经看完电影了，刚才那场很好看。',
      timestamp: new Date(2026, 6, 9, 21, 0).getTime(),
    });
    vi.mocked(callChatCompletion).mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            targetCharId: 'model-isaac',
            slots: [slot],
            flowNarrative: { morning: 'I am Isaac this morning.' },
          }),
        },
      }],
    } as any);

    const result = await generateDailyScheduleForChar(char, user, API, true, new Date(2026, 6, 10, 0, 30));

    expect(result?.date).toBe('2026-07-10');
    const request = vi.mocked(callChatCompletion).mock.calls[0][1] as any;
    const prompt = request.messages[0].content as string;
    expect(prompt).toContain('目标日程日期：2026-07-10；当前本地时间：2026-07-10 00:30');
    expect(prompt).toContain('[2026-07-09 21:00 | 昨天·已过去] User: 今晚八点我们已经看完电影了，刚才那场很好看。');
    expect(prompt).toContain('不得再次安排到 2026-07-10 的同一晚间或同一相对时段');
    expect(prompt).toContain('标为「已过去」的昨晚事项不要搬到今天晚上重演');
  });

  it('does not reconcile a schedule with another character id', async () => {
    const today = getLocalDateKey();
    const existing = {
      id: `char-isaac_${today}`,
      charId: 'char-isaac',
      modelId: 'model-isaac',
      date: today,
      generatedAt: Date.now(),
      slots: [slot],
    } as DailySchedule;
    const messages = [{
      id: 1,
      charId: 'char-isaac',
      role: 'user',
      type: 'text',
      content: 'Tonight at 8, change the plan.',
      timestamp: Date.now(),
    }] as Message[];
    vi.mocked(callChatCompletion).mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            targetCharId: 'model-other',
            changed: true,
            slots: [{ ...slot, activity: 'Wrong person', anchored: true }],
          }),
        },
      }],
    } as any);

    const result = await reconcileScheduleWithChat(char, user, existing, messages, API);

    expect(result).toBeNull();
    await expect(DB.getDailySchedule('char-isaac', today)).resolves.toBeNull();
  });

  it('reconciles nested or string-flagged schedule payloads', async () => {
    const today = getLocalDateKey();
    const existing = {
      id: `char-isaac_${today}`,
      charId: 'char-isaac',
      modelId: 'model-isaac',
      date: today,
      generatedAt: Date.now(),
      slots: [slot],
    } as DailySchedule;
    const messages = [{
      id: 1,
      charId: 'char-isaac',
      role: 'user',
      type: 'text',
      content: 'Tonight at 8, change the plan.',
      timestamp: Date.now(),
    }] as Message[];
    vi.mocked(callChatCompletion).mockResolvedValueOnce({
      choices: [{
        message: {
          content: [
            '我按聊天把日程改好了：',
            '```json',
            JSON.stringify({
              result: {
                targetCharId: 'model-isaac',
                changed: 'true',
                slots: [{ ...slot, activity: 'Movie Night', anchored: true }],
              },
            }),
            '```',
          ].join('\n'),
        },
      }],
    } as any);

    const result = await reconcileScheduleWithChat(char, user, existing, messages, API);

    expect(result?.slots[0]?.activity).toBe('Movie Night');
    const saved = await DB.getDailySchedule('char-isaac', today);
    expect(saved?.slots[0]?.activity).toBe('Movie Night');
    expect(saved?.slots[0]?.anchored).toBe(true);
  });

  it('treats explicit room movement as a schedule signal', () => {
    const messages = [{
      id: 1,
      charId: 'char-isaac',
      role: 'user',
      type: 'text',
      content: '回卧室找我，把东西拿过来。',
      timestamp: Date.now(),
    }] as Message[];

    expect(chatHasScheduleSignal(messages)).toBe(true);
  });

  it('treats short room movement as a schedule signal', () => {
    const messages = [{
      id: 1,
      charId: 'char-isaac',
      role: 'assistant',
      type: 'text',
      content: '我先回客厅。',
      timestamp: Date.now(),
    }] as Message[];

    expect(chatHasScheduleSignal(messages)).toBe(true);
  });

  it('treats explicit appointments and same-day plan changes as schedule signals', () => {
    const messages = [
      {
        id: 1,
        charId: 'char-isaac',
        role: 'user',
        type: 'text',
        content: '今晚八点一起看电影。',
        timestamp: Date.now(),
      },
      {
        id: 2,
        charId: 'char-isaac',
        role: 'assistant',
        type: 'text',
        content: '我今天不去公司了，下午临时请假。',
        timestamp: Date.now(),
      },
    ] as Message[];

    expect(chatHasScheduleSignal(messages)).toBe(true);
  });

  it('does not treat ordinary来去到 chatter as a schedule signal', () => {
    const messages = [
      {
        id: 1,
        charId: 'char-isaac',
        role: 'user',
        type: 'text',
        content: '你来了呀，今天过得怎么样？',
        timestamp: Date.now(),
      },
      {
        id: 2,
        charId: 'char-isaac',
        role: 'assistant',
        type: 'text',
        content: '刚看到，来笑一下。',
        timestamp: Date.now(),
      },
    ] as Message[];

    expect(chatHasScheduleSignal(messages)).toBe(false);
  });
});
