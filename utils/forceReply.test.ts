import { describe, expect, it } from 'vitest';
import { extractForceReplyDirective } from './forceReply';

describe('extractForceReplyDirective', () => {
  it('extracts and strips the basic directive', () => {
    const result = extractForceReplyDirective('别装没看见。\n[[FORCE_REPLY: 我现在要你回我]]');

    expect(result).toEqual({
      content: '别装没看见。',
      forceReply: true,
      reason: '我现在要你回我',
    });
  });

  it('supports Chinese colon', () => {
    const result = extractForceReplyDirective('过来。[[FORCE_REPLY：不准继续晾着我]]');

    expect(result.content).toBe('过来。');
    expect(result.forceReply).toBe(true);
    expect(result.reason).toBe('不准继续晾着我');
  });

  it('allows an empty reason', () => {
    const result = extractForceReplyDirective('回我 [[FORCE_REPLY: ]]');

    expect(result.content).toBe('回我');
    expect(result.forceReply).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('strips multiple directives and keeps the first non-empty reason', () => {
    const result = extractForceReplyDirective('A[[FORCE_REPLY: ]]B[[FORCE_REPLY: 第二个理由]]C[[FORCE_REPLY: 第三个]]');

    expect(result.content).toBe('ABC');
    expect(result.forceReply).toBe(true);
    expect(result.reason).toBe('第二个理由');
  });

  it('is case-insensitive', () => {
    const result = extractForceReplyDirective('hey [[force_reply: answer me]]');

    expect(result.content).toBe('hey');
    expect(result.forceReply).toBe(true);
    expect(result.reason).toBe('answer me');
  });
});
