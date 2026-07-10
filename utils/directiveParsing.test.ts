import { describe, expect, it } from 'vitest';
import { extractCallUserDirective } from './callDirective';
import { extractCharAvatarDirective } from './charAvatarSystem';
import { detectOfflineAutoStart, detectOfflineScheduledStart, extractOfflineStartDirective } from './offlineMode';
import { sanitizeForBubble } from './sanitize';
import { extractGomokuInviteDirective } from './theaterGomokuInvite';
import { extractGoInviteDirective } from './theaterGoInvite';
import { extractDoudizhuInviteDirective } from './theaterDoudizhuInvite';
import { extractTurtleSoupInviteDirective } from './theaterTurtleSoupInvite';
import { extractMahjongInviteDirective } from './theaterMahjongInvite';

describe('mahjong invite directive parsing', () => {
  it('recognizes mahjong invite directives and strips them from visible text', () => {
    expect(extractMahjongInviteDirective('来吧。\n[[MAHJONG_INVITE: 摸一圈？]]')).toEqual({
      invited: true,
      content: '来吧。',
      message: '摸一圈？',
    });

    expect(extractMahjongInviteDirective('[[MAHJONG_INVITE：模式=每步评估，四个人刚好，来打麻将？]]走？')).toEqual({
      invited: true,
      content: '走？',
      message: '四个人刚好，来打麻将？',
      difficultyMode: 'per_move',
    });

    expect(extractMahjongInviteDirective('[[mahjong_invite: 开局定档，打一圈？]]')).toEqual({
      invited: true,
      content: '',
      message: '打一圈？',
      difficultyMode: 'opening',
    });

    expect(extractMahjongInviteDirective('没有指令')).toEqual({ content: '没有指令' });
    expect(sanitizeForBubble('别露出来 [[MAHJONG_INVITE: 来一桌]]')).toBe('别露出来');
  });
});

describe('chat side-effect directive parsing', () => {
  it('recognizes flexible proactive call directives and strips them from text', () => {
    expect(extractCallUserDirective('烦死了 [[ call_user ]]')).toEqual({
      wantsCall: true,
      content: '烦死了',
    });
    expect(extractCallUserDirective('我直接说不清[[CALL_USER：想听声音]]')).toEqual({
      wantsCall: true,
      content: '我直接说不清',
    });
    expect(sanitizeForBubble('别显示这个 [[ CALL_USER: reason ]]')).toBe('别显示这个');
  });

  it('recognizes flexible offline start directives', () => {
    expect(extractOfflineStartDirective('我到楼下了\n[[ offline_start ]]')).toEqual({
      offline: true,
      content: '我到楼下了',
    });
    expect(extractOfflineStartDirective('开门。\n[[OFFLINE_START：已经碰面]]')).toEqual({
      offline: true,
      content: '开门。',
    });
  });

  it('detects current offline scene signals without explicit directives', () => {
    for (const latestText of [
      '我到你楼下了，抬头能看见你窗户。',
      '开门，我就在门口。',
      '我们已经碰头了，一起往店里走。',
      '他推门进来，在桌边坐下。',
      '两个人终于同处一地，面对面安静了一秒。',
    ]) {
      expect(detectOfflineAutoStart({ latestText, userName: '我', charName: '阿迟' }).offline).toBe(true);
    }

    const groupHit = detectOfflineAutoStart({
      mode: 'group',
      groupName: '周末小群',
      recentTexts: ['小夏: 我先去占位。'],
      latestText: '大家已经在包厢坐下了，菜单摊在桌边。',
    });
    expect(groupHit.offline).toBe(true);
    expect(groupHit.scenario).toContain('周末小群');
  });

  it('does not treat future, hypothetical, proposal, or memory talk as offline', () => {
    for (const latestText of [
      '好想见你啊。',
      '如果见面就好了。',
      '明天我到你楼下找你。',
      '下次一起出门吧？',
      '要不要周末碰面吃饭？',
      '上次见面的时候你还笑我迟到。',
      '我还没到门口，你先别下来。',
    ]) {
      expect(detectOfflineAutoStart({ latestText, userName: '我', charName: '阿迟' }).offline).toBe(false);
    }
  });

  it('schedules future offline appointments instead of starting immediately', () => {
    const now = new Date(2026, 6, 5, 10, 0, 0).getTime();
    const hit = detectOfflineScheduledStart({
      latestText: '那就明天下午三点楼下见，我去接你。',
      userName: '我',
      charName: '阿迟',
    }, now);

    expect(detectOfflineAutoStart({ latestText: '那就明天下午三点楼下见，我去接你。' }).offline).toBe(false);
    expect(hit.scheduled).toBe(true);
    expect(new Date(hit.dueAt!).getDate()).toBe(new Date(now + 24 * 60 * 60 * 1000).getDate());
    expect(new Date(hit.dueAt!).getHours()).toBe(15);
    expect(hit.scenario).toContain('现在已经到了约定时间');

    expect(detectOfflineScheduledStart({
      latestText: '要不要明天见面吃饭？',
      userName: '我',
      charName: '阿迟',
    }, now).scheduled).toBe(false);
    expect(detectOfflineScheduledStart({
      latestText: '明天见吗',
      userName: '我',
      charName: '阿迟',
    }, now).scheduled).toBe(false);
  });

  it('recognizes flexible char avatar directives and keeps the reason', () => {
    expect(extractCharAvatarDirective('这张像我\n[[ SET_CHAR_AVATAR_FROM_LAST_IMAGE ： 就用这张 ]]')).toEqual({
      useAvatar: true,
      reason: '就用这张',
      content: '这张像我',
    });
  });

  it('recognizes gomoku invite directives and strips them from visible text', () => {
    expect(extractGomokuInviteDirective('来吧。\n[[GOMOKU_INVITE: 下一局？]]')).toEqual({
      invited: true,
      content: '来吧。',
      message: '下一局？',
    });

    expect(extractGomokuInviteDirective('[[GOMOKU_INVITE：模式=每步评估，敢不敢下一盘？]]走？')).toEqual({
      invited: true,
      content: '走？',
      message: '敢不敢下一盘？',
      difficultyMode: 'per_move',
    });

    expect(extractGomokuInviteDirective('[[gomoku_invite: 开局定档，手谈一局？]]')).toEqual({
      invited: true,
      content: '',
      message: '手谈一局？',
      difficultyMode: 'opening',
    });

    expect(extractGomokuInviteDirective('没有指令')).toEqual({ content: '没有指令' });
    expect(sanitizeForBubble('别露出来 [[GOMOKU_INVITE: 来一盘]]')).toBe('别露出来');
  });

  it('recognizes go invite directives and strips them from visible text', () => {
    expect(extractGoInviteDirective('来吧。\n[[GO_INVITE: 下一盘？]]')).toEqual({
      invited: true,
      content: '来吧。',
      message: '下一盘？',
    });

    expect(extractGoInviteDirective('[[GO_INVITE：模式=每步评估，手谈一局？]]走？')).toEqual({
      invited: true,
      content: '走？',
      message: '手谈一局？',
      difficultyMode: 'per_move',
    });

    expect(extractGoInviteDirective('[[go_invite: 开局定档，围棋？]]')).toEqual({
      invited: true,
      content: '',
      message: '围棋？',
      difficultyMode: 'opening',
    });

    expect(extractGoInviteDirective('没有指令')).toEqual({ content: '没有指令' });
    expect(sanitizeForBubble('别露出来 [[GO_INVITE: 来一盘]]')).toBe('别露出来');
  });

  it('recognizes doudizhu invite directives and strips them from visible text', () => {
    expect(extractDoudizhuInviteDirective('来吧。\n[[DOUDIZHU_INVITE: 来一局？]]')).toEqual({
      invited: true,
      content: '来吧。',
      message: '来一局？',
    });

    expect(extractDoudizhuInviteDirective('[[DOUDIZHU_INVITE：模式=每步评估，来一局斗地主？]]走？')).toEqual({
      invited: true,
      content: '走？',
      message: '来一局斗地主？',
      difficultyMode: 'per_move',
    });

    expect(extractDoudizhuInviteDirective('[[doudizhu_invite: 开局定档，开桌？]]')).toEqual({
      invited: true,
      content: '',
      message: '开桌？',
      difficultyMode: 'opening',
    });

    expect(extractDoudizhuInviteDirective('没有指令')).toEqual({ content: '没有指令' });
    expect(sanitizeForBubble('别露出来 [[DOUDIZHU_INVITE: 来一局]]')).toBe('别露出来');
  });

  it('recognizes turtle soup invite directives and strips them from visible text', () => {
    expect(extractTurtleSoupInviteDirective('来吧。\n[[TURTLE_SOUP_INVITE: 来一碗？]]')).toEqual({
      invited: true,
      content: '来吧。',
      message: '来一碗？',
    });

    expect(extractTurtleSoupInviteDirective('[[TURTLE_SOUP_INVITE：模式=每步评估，敢不敢喝一碗暗黑汤？]]走？')).toEqual({
      invited: true,
      content: '走？',
      message: '敢不敢喝一碗暗黑汤？',
      difficultyMode: 'per_move',
    });

    expect(extractTurtleSoupInviteDirective('[[turtle_soup_invite: 开局定档，来碗汤？]]')).toEqual({
      invited: true,
      content: '',
      message: '来碗汤？',
      difficultyMode: 'opening',
    });

    expect(extractTurtleSoupInviteDirective('没有指令')).toEqual({ content: '没有指令' });
    expect(sanitizeForBubble('别露出来 [[TURTLE_SOUP_INVITE: 来一碗]]')).toBe('别露出来');
  });
});
