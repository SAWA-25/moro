import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterProfile, DailySchedule, Message, UserProfile } from '../types';
import { DB } from './db';
import { callChatCompletion } from './llmClient';
import { generateDailyScheduleForChar, reconcileScheduleWithChat } from './scheduleGenerator';

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
    expect(request.messages[0].content).toContain('Isaac (ID: model-isaac)');

    const saved = await DB.getDailySchedule('char-isaac', result!.date);
    expect(saved?.modelId).toBe('model-isaac');
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
    const today = new Date().toISOString().split('T')[0];
    await expect(DB.getDailySchedule('char-isaac', today)).resolves.toBeNull();
  });

  it('does not reconcile a schedule with another character id', async () => {
    const today = new Date().toISOString().split('T')[0];
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
});
