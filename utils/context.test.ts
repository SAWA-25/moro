import { describe, expect, it } from 'vitest';
import type { CharacterProfile, UserProfile } from '../types';
import { ContextBuilder } from './context';
import { HIDDEN_PROMPT_TAG, PROMPT_PRIVACY_RULE } from './promptPrivacy';

const char = {
  id: 'char-a',
  modelId: 'model-a',
  name: 'Same Name',
  avatar: '',
  description: '',
  systemPrompt: 'Stay distinct.',
  memories: [],
  contextLimit: 500,
} as CharacterProfile;

const user = {
  name: 'User',
  avatar: '',
  bio: 'tester',
} as UserProfile;

describe('ContextBuilder character identity anchor', () => {
  it('includes the hidden character id in core context', () => {
    const context = ContextBuilder.buildCoreContext(char, user, false);

    expect(context).toContain('角色ID: model-a');
    expect(context).toContain('Same Name (ID: model-a)');
    expect(context).toContain('不要与其他角色合并');
    expect(context).toContain('日常对话里不要主动念给用户听');
    expect(context).toContain(`<${HIDDEN_PROMPT_TAG} kind="character-core">`);
    expect(context).toContain(PROMPT_PRIVACY_RULE);
  });

  it('includes the hidden character id in role settings context', () => {
    const context = ContextBuilder.buildRoleSettingsContext(char, { skipMemories: true });

    expect(context).toContain('Hidden Character ID');
    expect(context).toContain('角色ID: model-a');
    expect(context).toContain('Same Name (ID: model-a)');
    expect(context).toContain('不要与其他角色合并');
    expect(context).toContain(PROMPT_PRIVACY_RULE);
  });

  it('wraps dialogue examples as hidden prompt material', () => {
    const context = ContextBuilder.buildCoreContext(
      { ...char, mesExample: '<START>\nSame Name: 你来啦。' },
      user,
      false,
    );

    expect(context).toContain(`<${HIDDEN_PROMPT_TAG} kind="dialogue-examples">`);
    expect(context).toContain('Same Name: 你来啦。');
  });

  it('injects the automatic offline directive only when auto meet is enabled', () => {
    const context = ContextBuilder.buildCoreContext(
      { ...char, convoSettings: { autoOffline: true } },
      user,
      false,
    );

    expect(context).toContain('自动线下：开启');
    expect(context).toContain('[[OFFLINE_START]]');
  });

  it('keeps long-distance mode online and suppresses automatic offline prompts', () => {
    const context = ContextBuilder.buildCoreContext(
      { ...char, convoSettings: { longDistanceMode: true } },
      user,
      false,
    );

    expect(context).toContain('异地模式：开启');
    expect(context).toContain('远距离');
    expect(context).toContain('纯线上');
    expect(context).not.toContain('[[OFFLINE_START]]');
  });

  it('lets long-distance mode win over legacy data with both toggles enabled', () => {
    const context = ContextBuilder.buildCoreContext(
      { ...char, convoSettings: { longDistanceMode: true, autoOffline: true } },
      user,
      false,
    );

    expect(context).toContain('异地模式：开启');
    expect(context).not.toContain('自动线下：开启');
    expect(context).not.toContain('[[OFFLINE_START]]');
  });

  it('treats the current schedule location as a chat baseline that recent chat may override', () => {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const schedule = {
      id: 'char-a_today',
      charId: 'char-a',
      date: now.toISOString().slice(0, 10),
      generatedAt: now.getTime(),
      slots: [
        {
          startTime: `${hh}:00`,
          activity: '闭目养神',
          description: '躺在皮质沙发上放空',
          location: '客厅',
        },
      ],
    };

    const context = ContextBuilder.buildScheduleInjection(schedule);

    expect(context).toContain('当前地点基线');
    expect(context).toContain('按日程你此刻在「客厅」');
    expect(context).toContain('除非最近聊天或对方最新消息明确让你移动到新地点');
    expect(context).toContain('以最新聊天地点为准');
  });
});
