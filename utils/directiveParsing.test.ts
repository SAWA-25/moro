import { describe, expect, it } from 'vitest';
import { extractCallUserDirective } from './callDirective';
import { extractCharAvatarDirective } from './charAvatarSystem';
import { detectOfflineAutoStart, detectOfflineScheduledStart, extractOfflineStartDirective } from './offlineMode';
import { sanitizeForBubble } from './sanitize';

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
});
