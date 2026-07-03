import { describe, expect, it } from 'vitest';
import {
  AUTONOMOUS_BATCH_SYSTEM,
  AUTONOMOUS_SINGLE_SYSTEM,
  activeMsg2ImportantRules,
  activeMsg2ModeInstruction,
  characterDialogueGuidance,
  coupleAutoCareUserPrompt,
  coupleChatPersonaSystem,
  coupleCommentUserPrompt,
  coupleInnerVoiceUserPrompt,
  coupleInteractionUserPrompt,
  coupleMomentUserPrompt,
  coupleRecapUserPrompt,
  coupleSpaceBlock,
  coupleWhisperUserPrompt,
  livePrivateDraftPromptBody,
  livePrivateInterjectPromptBody,
  proactiveFallbackHint,
  swOfflineProactiveSystemPrompt,
  userScreenWatchCommentSystemPrompt,
  userScreenWatchContextBlock,
} from './laiwangPrompts';

describe('laiwang prompt copy', () => {
  it('explains how character settings become natural dialogue', () => {
    const text = characterDialogueGuidance('小夏');

    expect(text).toContain('角色设定的自然对话方式');
    expect(text).toContain('而不是逐条复述给小夏听');
    expect(text).toContain('对话示例只用来学习说话节奏');
    expect(text).toContain('它们不是实际发生过的历史');
  });

  it('marks live draft text as unsent and not persisted', () => {
    const text = livePrivateDraftPromptBody({
      userName: '小夏',
      charName: '阿迟',
      draftText: '我还在想怎么说',
    });

    expect(text).toContain('未正式发送');
    expect(text).toContain('不会写进聊天记录');
    expect(text).toContain('不落库');
    expect(text).toContain('不要把草稿当成已经说出口');
  });

  it('keeps live private interjects out of the current chat window fiction', () => {
    const text = livePrivateInterjectPromptBody({
      userName: '小夏',
      charName: '阿迟',
      sourceCharName: '林晚',
      userText: '今天好困',
      recent: '小夏: 早',
    });

    expect(text).toContain('不要假装自己在当前私聊里');
    expect(text).toContain('不要假装看见了');
    expect(text).toContain('不要说成小夏把同一条消息发给了你');
    expect(text).toContain('保存到你自己的私聊里');
  });

  it('keeps autonomous life v2 fields in the JSON examples', () => {
    for (const field of ['eventKind', 'energy', 'intensity', 'shareWillingness', 'thread', 'proactiveAngle']) {
      expect(AUTONOMOUS_SINGLE_SYSTEM).toContain(field);
      expect(AUTONOMOUS_BATCH_SYSTEM).toContain(field);
    }
    expect(AUTONOMOUS_SINGLE_SYSTEM).toContain('proactiveAngle 只能是');
    expect(AUTONOMOUS_BATCH_SYSTEM).toContain('shareWillingness 低的事件也可以存在');
    expect(AUTONOMOUS_SINGLE_SYSTEM).toContain('默认克制');
    expect(AUTONOMOUS_BATCH_SYSTEM).toContain('不要为了热闹而制造大事件');
  });

  it('keeps live chat behavior restrained', () => {
    const draft = livePrivateDraftPromptBody({
      userName: '小夏',
      charName: '阿迟',
      draftText: '我想说点事',
    });
    const interject = livePrivateInterjectPromptBody({
      userName: '小夏',
      charName: '阿迟',
      sourceCharName: '林晚',
      userText: '今天好累',
      recent: '阿迟: 嗯',
    });

    expect(draft).toContain('默认要克制');
    expect(draft).toContain('不要催用户赶紧发');
    expect(interject).toContain('这不是刷存在感');
    expect(interject).toContain('不要强行升温');
  });

  it('keeps proactive call instructions conditional in fallback prompts', () => {
    const withCall = proactiveFallbackHint({
      userName: '小夏',
      timeStr: '7月3日 20:00',
      timeSinceUser: '3小时',
      longGap: true,
      proactiveCallAllowed: true,
    });
    const withoutCall = proactiveFallbackHint({
      userName: '小夏',
      timeStr: '7月3日 20:00',
      timeSinceUser: '3小时',
      longGap: true,
      proactiveCallAllowed: false,
    });

    expect(withCall).toContain('[[CALL_USER]]');
    expect(withCall).toContain('禁止模板寒暄');
    expect(withCall).toContain('解释触发原因');
    expect(withoutCall).not.toContain('[[CALL_USER]]');
  });

  it('centralizes natural active message rules for active message 2.0 and SW prompts', () => {
    const rules = activeMsg2ImportantRules('小夏').join('\n');
    const prompted = activeMsg2ModeInstruction('prompted', '从下雨切入');
    const swPrompt = swOfflineProactiveSystemPrompt({
      charName: '阿迟',
      nowText: '7月3日 周五 20:00',
      activity: '在楼下等雨停',
      userName: '小夏',
    });

    expect(rules).toContain('禁止模板寒暄');
    expect(rules).toContain('元话语');
    expect(prompted).toContain('额外提示：从下雨切入');
    expect(prompted).toContain('不要把额外提示照抄成任务汇报');
    expect(swPrompt).toContain('生活切片');
    expect(swPrompt).toContain('不要输出 [[CALL_USER]]');
  });

  it('keeps couple space context grounded in natural relationship cues', () => {
    const text = coupleSpaceBlock({
      userName: '小夏',
      charName: '阿迟',
      days: 32,
      anniversaryDate: '2026-06-01',
      intimacy: 42,
      level: 2,
      title: '靠近',
      recentMomentLines: ['小夏：雨声很好听'],
      upcomingLines: ['纪念日「一起散步」还有 3 天。'],
      pendingTaskTitles: ['周末一起散步'],
      pendingWishes: ['去看海'],
      recentQaLines: ['小夏问「你会吃醋吗」，你答「会，但不一定承认」'],
      plantLine: '盆栽长出新芽了',
      lastUserWhisper: '今天有点想你',
      profileLines: ['睡前互道晚安'],
      memoryCardLines: ['雨天小路：你们一起躲雨'],
      recapLines: ['这周把普通雨天记住了'],
    });

    expect(text).toContain('关系线索');
    expect(text).toContain('不要照念清单');
    expect(text).toContain('不要硬套甜话');
    expect(text).toContain('1 个具体细节');
    expect(text).toContain('自然不是冷淡');
    expect(text).not.toContain('恋爱酸臭味');
  });

  it('keeps couple one-shot prompts natural and character-led', () => {
    const text = [
      coupleChatPersonaSystem('阿迟', '小夏', '人设：慢热，嘴硬。'),
      coupleCommentUserPrompt('小夏', '今天雨声很好听', '（心情：安静）'),
      coupleWhisperUserPrompt('小夏', '今天有点想你'),
      coupleInteractionUserPrompt('小夏', '抱一下'),
      coupleInnerVoiceUserPrompt('小夏', true, '今天雨声很好听'),
    ].join('\n');

    expect(text).toContain('自然');
    expect(text).toContain('具体细节');
    expect(text).toContain('嘴硬');
    expect(text).toContain('轻轻吃醋');
    expect(text).toContain('含蓄试探');
    expect(text).toContain('不要程式化撒糖');
    expect(text).toContain('不要写成对 小夏 表演的甜话');
  });

  it('keeps couple JSON prompt contracts while refining the copy', () => {
    const text = [
      coupleMomentUserPrompt('小夏', '（你们已相恋 32 天）'),
      coupleAutoCareUserPrompt({
        userName: '小夏',
        source: '下班路上看到花店打烊',
        recent: '动态：昨天说想散步',
        allowRecap: true,
      }),
      coupleRecapUserPrompt({
        userName: '小夏',
        periodLabel: '本周',
        sourceLines: ['动态：雨声很好听', '约定：周末一起散步'],
      }),
    ].join('\n');

    for (const field of ['"text"', '"mood"', '"media"', '"kind"', '"title"', '"highlights"', '"suggestedTasks"', '"suggestedWishes"']) {
      expect(text).toContain(field);
    }
    expect(text).toContain('moment|wish|task|recap|none');
    expect(text).toContain('voice|music|item');
    expect(text).toContain('严格只输出 JSON');
    expect(text).toContain('不要无来源地写重大承诺');
    expect(text).toContain('不要编造重大事件');
  });

  it('keeps user screen watch prompts bounded to active user sharing', () => {
    const text = [
      userScreenWatchCommentSystemPrompt({
        charName: '阿迟',
        userName: '小夏',
        frameText: 'Moro 内部使用：絮语 1分钟',
        hasImage: true,
      }),
      userScreenWatchContextBlock({
        charName: '阿迟',
        userName: '小夏',
        lines: ['- 观屏状态：正在共享。', '- Moro 内部 App 停留：絮语 1分钟。'],
      }),
    ].join('\n');

    expect(text).toContain('主动');
    expect(text).toContain('共享');
    expect(text).toContain('Moro 内部');
    expect(text).toContain('不代表你能在共享结束后继续看见');
    expect(text).not.toContain('后台监控');
    expect(text).not.toContain('无限权限');
  });
});
