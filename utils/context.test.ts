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

  it('uses the supplied full user setting in core context', () => {
    const context = ContextBuilder.buildCoreContext(char, user, false, undefined, {
      fullUserSetting: 'FULL_USER_SETTING_SENTINEL\nUSER_WORLDBOOK_SENTINEL',
    });

    expect(context).toContain('FULL_USER_SETTING_SENTINEL');
    expect(context).toContain('USER_WORLDBOOK_SENTINEL');
  });

  it('keeps full character and user settings in the default core prompt path', () => {
    const context = ContextBuilder.buildCoreContext(
      {
        ...char,
        description: 'DESCRIPTION_SENTINEL',
        worldview: 'WORLDVIEW_SENTINEL',
        lifeProfile: { content: 'LIFE_PROFILE_SENTINEL', generatedAt: 1 },
        appearanceTags: 'APPEARANCE_SENTINEL',
        writerPersona: 'WRITER_PERSONA_SENTINEL',
        selfInsights: ['SELF_INSIGHT_SENTINEL'],
      },
      { ...user, bio: 'SHORT_BIO_SHOULD_NOT_WIN' },
      false,
      undefined,
      {
        fullUserSetting: 'FULL_USER_SETTING_SENTINEL\nUSER_WORLDBOOK_SENTINEL',
      },
    );

    expect(context).toContain('完整角色设定');
    expect(context).toContain('DESCRIPTION_SENTINEL');
    expect(context).toContain('WORLDVIEW_SENTINEL');
    expect(context).toContain('LIFE_PROFILE_SENTINEL');
    expect(context).toContain('APPEARANCE_SENTINEL');
    expect(context).toContain('WRITER_PERSONA_SENTINEL');
    expect(context).toContain('SELF_INSIGHT_SENTINEL');
    expect(context).toContain('FULL_USER_SETTING_SENTINEL');
    expect(context).toContain('USER_WORLDBOOK_SENTINEL');
  });

  it('uses the supplied full user setting in group shared scene', () => {
    const scene = ContextBuilder.buildGroupSharedScene([char], user, {
      fullUserSetting: 'GROUP_FULL_USER_SENTINEL\nGROUP_USER_WB_SENTINEL',
    });

    expect(scene.text).toContain('GROUP_FULL_USER_SENTINEL');
    expect(scene.text).toContain('GROUP_USER_WB_SENTINEL');
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

  it('injects healthy romance guidance only when enabled', () => {
    const disabled = ContextBuilder.buildCoreContext(char, user, false);
    const enabled = ContextBuilder.buildCoreContext(
      { ...char, convoSettings: { healthyRomanceMode: true } },
      user,
      false,
    );

    expect(disabled).not.toContain('正常恋爱模式：开启');
    expect(enabled).toContain('正常恋爱模式：开启');
    expect(enabled).toContain('按你的完整人设、当前关系和最近相处来长出来');
    expect(enabled).toContain('温柔的人会照顾细节');
    expect(enabled).toContain('嘴硬的人会绕一下再心软');
    expect(enabled).toContain('不要把所有角色都改成同一种甜宠、卑微、全天候安抚的恋人');
    expect(enabled).toContain('灰度、误会、试探、退让、确认和反复拉扯');
    expect(enabled).toContain('尊重、理解、共情');
    expect(enabled).toContain('亲密不等于所有权、许可权或支配权');
    expect(enabled).toContain('自己的选择、人际关系、沉默、拒绝和离开的空间');
    expect(enabled).not.toContain('你' + '属于' + '我');
    expect(enabled).not.toContain('你' + '只能' + '是我的');
    expect(enabled).not.toContain('没有' + '我允许');
    expect(enabled).toContain('病态极端控制');
    expect(enabled).toContain('先停下、听懂、道歉或协商');
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
