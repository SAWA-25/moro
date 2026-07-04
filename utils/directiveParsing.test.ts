import { describe, expect, it } from 'vitest';
import { extractCallUserDirective } from './callDirective';
import { extractCharAvatarDirective } from './charAvatarSystem';
import { extractOfflineStartDirective } from './offlineMode';
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

  it('recognizes flexible char avatar directives and keeps the reason', () => {
    expect(extractCharAvatarDirective('这张像我\n[[ SET_CHAR_AVATAR_FROM_LAST_IMAGE ： 就用这张 ]]')).toEqual({
      useAvatar: true,
      reason: '就用这张',
      content: '这张像我',
    });
  });
});
