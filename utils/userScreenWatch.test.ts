import { describe, expect, it } from 'vitest';
import { AppID } from '../types';
import {
  appendUserScreenWatchComment,
  appendUserScreenWatchFrame,
  buildUserScreenWatchContextLines,
  buildUserScreenWatchSummary,
  canGenerateUserScreenWatchComment,
  createUserScreenWatchSession,
  endUserScreenWatchSession,
  recordUserScreenWatchUsage,
  sanitizeUserScreenWatchComment,
  trimUserScreenWatchSessions,
  USER_SCREEN_WATCH_MAX_FRAMES,
  USER_SCREEN_WATCH_MAX_SESSIONS,
} from './userScreenWatch';

describe('user screen watch utilities', () => {
  it('accumulates Moro app usage slices for the same app', () => {
    let session = createUserScreenWatchSession({ charId: 'c1', charName: '阿迟', now: 1000 });
    session = recordUserScreenWatchUsage(session, {
      appId: AppID.GroupChat,
      appName: '絮语',
      startedAt: 1000,
      endedAt: 5000,
    });
    session = recordUserScreenWatchUsage(session, {
      appId: AppID.GroupChat,
      appName: '絮语',
      startedAt: 5000,
      endedAt: 9000,
    });

    expect(session.usage).toHaveLength(1);
    expect(session.usage[0].durationMs).toBe(8000);
  });

  it('keeps only the latest frames', () => {
    let session = createUserScreenWatchSession({ charId: 'c1', charName: '阿迟', now: 1000 });
    for (let i = 0; i < USER_SCREEN_WATCH_MAX_FRAMES + 5; i += 1) {
      session = appendUserScreenWatchFrame(session, {
        id: `f-${i}`,
        capturedAt: 1000 + i,
        imageDataUrl: `data:image/jpeg;base64,${i}`,
      });
    }

    expect(session.frames).toHaveLength(USER_SCREEN_WATCH_MAX_FRAMES);
    expect(session.frames[0].id).toBe('f-5');
  });

  it('throttles automatic comments but allows forced comments', () => {
    let session = createUserScreenWatchSession({
      charId: 'c1',
      charName: '阿迟',
      now: 1000,
      settings: { commentCooldownMs: 45_000 },
    });
    session = appendUserScreenWatchComment(session, {
      id: 'comment-1',
      text: '这一眼我看见了。',
      createdAt: 10_000,
      source: 'text',
    });

    expect(canGenerateUserScreenWatchComment(session, 20_000)).toBe(false);
    expect(canGenerateUserScreenWatchComment(session, 20_000, true)).toBe(true);
    expect(canGenerateUserScreenWatchComment(session, 56_000)).toBe(true);
  });

  it('trims recent sessions per character backup policy shape', () => {
    const sessions = Array.from({ length: USER_SCREEN_WATCH_MAX_SESSIONS + 3 }, (_, i) =>
      createUserScreenWatchSession({ charId: 'c1', charName: '阿迟', now: 1000 + i }),
    );
    const trimmed = trimUserScreenWatchSessions(sessions);

    expect(trimmed).toHaveLength(USER_SCREEN_WATCH_MAX_SESSIONS);
    expect(trimmed[0].startedAt).toBe(1000 + USER_SCREEN_WATCH_MAX_SESSIONS + 2);
  });

  it('marks stopped sessions as ended and stores a summary', () => {
    const session = createUserScreenWatchSession({ charId: 'c1', charName: '阿迟', now: 1000 });
    const ended = endUserScreenWatchSession(session, 9000, 'ended', '观屏评论已结束');

    expect(ended.status).toBe('ended');
    expect(ended.endedAt).toBe(9000);
    expect(ended.summary).toContain('结束');
  });

  it('sanitizes JSON and markdown wrappers from generated comments', () => {
    expect(sanitizeUserScreenWatchComment('```json\n{"text":"这页你盯得很认真。"}\n```')).toBe('这页你盯得很认真。');
    expect(sanitizeUserScreenWatchComment('{"comment":"先别急着切走。"}')).toBe('先别急着切走。');
    expect(sanitizeUserScreenWatchComment('text: 这一眼我看见了')).toBe('这一眼我看见了');
    expect(sanitizeUserScreenWatchComment('这一眼我看见了')).toBe('这一眼我看见了');
  });

  it('drops malformed JSON-shaped comments instead of displaying raw payloads', () => {
    expect(sanitizeUserScreenWatchComment('```json\n{"text":\n```')).toBe('');
    expect(sanitizeUserScreenWatchComment('{"notAComment":"debug"}')).toBe('');
  });

  it('drops roleplay meta-analysis from screen watch comments but keeps concrete names', () => {
    expect(sanitizeUserScreenWatchComment('以我的性格，我不会直接质问，而是更隐晦地表达。')).toBe('');
    expect(sanitizeUserScreenWatchComment('这条消息可以是：你怎么还有空跟伊萨克闲聊。')).toBe('你怎么还有空跟伊萨克闲聊。');
    expect(sanitizeUserScreenWatchComment('伊萨克这名字出现得挺勤啊。')).toBe('伊萨克这名字出现得挺勤啊。');
  });

  it('keeps dirty legacy comments out of context and summaries', () => {
    let session = createUserScreenWatchSession({ charId: 'c1', charName: '阿迟', now: 1000 });
    session = {
      ...session,
      updatedAt: 3000,
      comments: [
        { id: 'bad', text: '```json\n{"text":\n```', createdAt: 2000, source: 'text' },
        { id: 'good', text: '{"text":"你怎么还在这一页磨蹭。"}', createdAt: 3000, source: 'text' },
      ],
    };

    const context = buildUserScreenWatchContextLines(session, 4000).join('\n');
    const summary = buildUserScreenWatchSummary(endUserScreenWatchSession(session, 5000));

    expect(context).toContain('你怎么还在这一页磨蹭。');
    expect(context).not.toContain('```json');
    expect(context).not.toContain('"text"');
    expect(summary).toContain('你怎么还在这一页磨蹭。');
    expect(summary).not.toContain('```json');
  });
});
