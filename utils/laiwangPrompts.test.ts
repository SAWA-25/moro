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
  coupleEyesCardUserPrompt,
  coupleEyesFuturePrompt,
  coupleEyesPastPrompt,
  coupleEyesPresentPrompt,
  coupleInnerVoiceUserPrompt,
  coupleInteractionUserPrompt,
  coupleMomentUserPrompt,
  coupleRecapUserPrompt,
  coupleSpaceBlock,
  coupleWhisperUserPrompt,
  charPhoneCheckFollowupPrompt,
  charPhoneCheckScriptGuard,
  convoLines,
  liveGroupModePromptBlock,
  livePrivateDraftPromptBody,
  proactiveFallbackHint,
  proactivePendingReplyHint,
  shopGiftReplyHint,
  swOfflineProactiveSystemPrompt,
  userScreenWatchCommentSystemPrompt,
  userScreenWatchCommentUserPrompt,
  userScreenWatchContextBlock,
} from './laiwangPrompts';

describe('laiwang prompt copy', () => {
  it('keeps long-distance mode online and away from offline directives', () => {
    const text = convoLines.longDistanceMode;

    expect(text).toContain('异地模式');
    expect(text).toContain('远距离');
    expect(text).toContain('纯线上');
    expect(text).toContain('聊天');
    expect(text).toContain('语音电话');
    expect(text).toContain('视频通话');
    expect(text).toContain('未来见面约定');
    expect(text).not.toContain('[[OFFLINE_START]]');
  });

  it('explains how character settings become natural dialogue', () => {
    const text = characterDialogueGuidance('小夏');

    expect(text).toContain('角色设定的自然对话方式');
    expect(text).toContain('而不是逐条复述给小夏听');
    expect(text).toContain('先回应当前话题');
    expect(text).toContain('生活半径要更广');
    expect(text).toContain('吃饭、睡觉、起床只是生活素材之一，不是默认寒暄模板');
    expect(text).toContain('不要每轮硬转成"我现在在做什么"的近况汇报');
    expect(text).toContain('对话示例只用来学习说话节奏');
    expect(text).toContain('它们不是实际发生过的历史');
  });

  it('keeps proactive takeout tied to multiple dietary constraints and safe fallback', () => {
    const text = convoLines.proactiveTakeoutOrder('小夏');

    expect(text).toContain('口味/忌口/过敏');
    expect(text).toContain('多条饮食约束');
    expect(text).toContain('饭票菜库');
    expect(text).toContain('安全兜底');
    expect(text).toContain('[[TAKEOUT_ORDER:');
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

  it('keeps autonomous life balanced instead of injury-driven', () => {
    expect(AUTONOMOUS_SINGLE_SYSTEM).toContain('持续糟糕');
    expect(AUTONOMOUS_SINGLE_SYSTEM).toContain('持续受伤');
    expect(AUTONOMOUS_SINGLE_SYSTEM).toContain('疼痛、病症、受伤不是默认细节');
    expect(AUTONOMOUS_SINGLE_SYSTEM).toContain('摔倒、流血、骨折、扭伤、车祸');
    expect(AUTONOMOUS_BATCH_SYSTEM).toContain('负面事件最多占三分之一');
    expect(AUTONOMOUS_BATCH_SYSTEM).toContain('意外不等于事故，更不等于受伤');
    expect(AUTONOMOUS_BATCH_SYSTEM).toContain('eventKind=accident/health 至多 1 条');
  });

  it('anchors autonomous life in the specific character setting', () => {
    expect(AUTONOMOUS_SINGLE_SYSTEM).toContain('先看角色完整设定');
    expect(AUTONOMOUS_SINGLE_SYSTEM).toContain('TA 可能会发生的小事');
    expect(AUTONOMOUS_SINGLE_SYSTEM).toContain('不要套用现代上班族');
    expect(AUTONOMOUS_BATCH_SYSTEM).toContain('这个角色完整设定里可能自然发生的事');
    expect(AUTONOMOUS_BATCH_SYSTEM).toContain('不要把所有角色都写成同一种现代都市日常');
  });

  it('keeps live chat behavior restrained', () => {
    const draft = livePrivateDraftPromptBody({
      userName: '小夏',
      charName: '阿迟',
      draftText: '我想说点事',
    });
    const group = liveGroupModePromptBlock();

    expect(draft).toContain('默认要克制');
    expect(draft).toContain('不要催用户赶紧发');
    expect(draft).toContain('没有必要就短一点');
    expect(group).toContain('当前群聊');
    expect(group).toContain('不要分流到其它群、其它私聊');
    expect(group).toContain('[[PRIVATE]]');
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

  it('keeps force reply instructions conditional', () => {
    const withForce = proactiveFallbackHint({
      userName: '小夏',
      timeStr: '7月4日 20:00',
      timeSinceUser: '3小时',
      longGap: true,
      forceReplyAllowed: true,
    });
    const withoutForce = proactiveFallbackHint({
      userName: '小夏',
      timeStr: '7月4日 20:00',
      timeSinceUser: '3小时',
      longGap: true,
      forceReplyAllowed: false,
    });
    const activeMsgRules = activeMsg2ImportantRules('小夏', { forceReplyAllowed: true }).join('\n');

    expect(withForce).toContain('[[FORCE_REPLY:');
    expect(withForce).toContain('强制回话');
    expect(withForce).toContain('控制欲');
    expect(withoutForce).not.toContain('[[FORCE_REPLY:');
    expect(activeMsgRules).toContain('[[FORCE_REPLY:');
  });

  it('prioritizes unreplied user messages during proactive replies', () => {
    const text = proactivePendingReplyHint({
      userName: '小夏',
      timeStr: '7月4日 09:30',
      messages: [
        { content: '你刚刚是不是没看到我这句', timestamp: 1_788_000_000_000, type: 'text' },
      ],
      lifeContext: '刚从便利店出来，手里还攥着冰咖啡',
    });

    expect(text).toContain('第一优先级是自然接住这些消息');
    expect(text).toContain('你刚刚是不是没看到我这句');
    expect(text).toContain('生活底色');
    expect(text).not.toContain('不是回复');
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

  it('lets SW proactive prompts switch into pending-reply mode', () => {
    const text = swOfflineProactiveSystemPrompt({
      charName: '阿迟',
      nowText: '7月4日 周六 09:30',
      userName: '小夏',
      pendingReply: true,
    });

    expect(text).toContain('没被你接住的消息');
    expect(text).not.toContain('不是回复，是你自己想起');
  });

  it('keeps full user setting inside SW offline proactive prompts', () => {
    const text = swOfflineProactiveSystemPrompt({
      charName: '阿迟',
      nowText: '7月4日 周六 09:30',
      userName: '小夏',
      fullUserSetting: 'FULL_USER_SETTING_SENTINEL\nUSER_WORLDBOOK_SENTINEL',
    });

    expect(text).toContain('互动对象完整用户设定');
    expect(text).toContain('FULL_USER_SETTING_SENTINEL');
    expect(text).toContain('USER_WORLDBOOK_SENTINEL');
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
      eyesCardLines: ['过去的我：TA 记得你曾经怎样靠近'],
    });

    expect(text).toContain('关系线索');
    expect(text).toContain('TA 眼中的我');
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

  it('keeps TA eyes prompts split by era and prevents future prophecy', () => {
    const params = {
      userName: '小夏',
      charName: '阿迟',
      recentChatLines: ['[10:00] 小夏: 今天有点累', '[10:01] 阿迟: 那就靠一会儿。'],
      spaceLines: ['悄悄话/小夏：今天想你', '记忆卡「雨天」：一起躲雨'],
    };
    const text = [
      coupleEyesPastPrompt(params),
      coupleEyesPresentPrompt(params),
      coupleEyesFuturePrompt(params),
      coupleEyesCardUserPrompt('future', params),
    ].join('\n');

    expect(text).toContain('过去的我');
    expect(text).toContain('现在的我');
    expect(text).toContain('将来的我');
    expect(text).toContain('不是预言');
    expect(text).toContain('不要写“注定”“一定会”“未来必然”');
    for (const field of ['"summary"', '"tags"', '"body"', '"innerVoice"']) {
      expect(text).toContain(field);
    }
    expect(text).toContain('严格只输出 JSON');
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
    expect(text).toContain('不要 JSON、Markdown、代码块');
    expect(userScreenWatchCommentUserPrompt(true)).toContain('不要 JSON、Markdown 或代码块');
    expect(text).toContain('不代表你能在共享结束后继续看见');
    expect(text).not.toContain('后台监控');
    expect(text).not.toContain('无限权限');
  });

  it('keeps reverse phone check follow-up as real chat text', () => {
    const text = [
      charPhoneCheckScriptGuard('阿迟', '小夏'),
      charPhoneCheckFollowupPrompt({ charName: '阿迟', userName: '小夏', exitMode: 'finished' }),
    ].join('\n');

    expect(text).toContain('聊天内容');
    expect(text).toContain('可以点名');
    expect(text).toContain('具体人名');
    expect(text).toContain('以我的性格');
    expect(text).toContain('更自然的是');
    expect(text).toContain('只输出要发出去的正文');
  });

  it('keeps reverse phone checks rooted in the real desktop instead of default moments', () => {
    const text = convoLines.allowPhoneBrowse;

    expect(text).toContain('真实桌面');
    expect(text).toContain('Dock');
    expect(text).toContain('安装/摆放的 App');
    expect(text).toContain('不要默认去朋友圈');
    expect(text).toContain('不要把查岗目标写成发动态');
    expect(text).toContain('极少数情况下');
  });

  it('includes shop gift ritual and wishlist context for shop replies', () => {
    const prompt = shopGiftReplyHint({
      userName: '小雨',
      kind: 'gift',
      itemEmoji: '🌹',
      itemName: '玫瑰花束',
      note: '给你',
      occasionLabel: '约会见面',
      wrapLabel: '黑缎带礼盒',
      fromWishlist: true,
    });

    expect(prompt).toContain('小雨刚刚从「心意铺」送给你 🌹玫瑰花束');
    expect(prompt).toContain('备注/清单是「给你」');
    expect(prompt).toContain('场景「约会见面」');
    expect(prompt).toContain('包装「黑缎带礼盒」');
    expect(prompt).toContain('来自你的愿望板');
    expect(prompt).toContain('不要说没收到');
  });

  it('distinguishes shop companion pay and clear wishlist replies', () => {
    expect(shopGiftReplyHint({
      userName: '小雨',
      kind: 'companion_pay',
      itemName: '草莓蛋糕',
      itemEmoji: '🍰',
      total: 45,
    })).toContain('替你代付了 🍰草莓蛋糕');

    expect(shopGiftReplyHint({
      userName: '小雨',
      kind: 'clear_cart',
      itemName: '愿望板',
      itemEmoji: '🛒',
      itemCount: 3,
      total: 88,
    })).toContain('帮你清空了愿望板，共 3 件，金额约 ¥88');
  });
});
