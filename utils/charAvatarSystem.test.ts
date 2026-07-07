import { describe, expect, it } from 'vitest';
import type { CharacterProfile, Message } from '../types';
import {
  assistantAcceptsAvatarRequest,
  buildCharAvatarApplyPatch,
  buildCharAvatarNoticeFromCharacter,
  findPendingUserAvatarRequest,
  isCharAvatarNoticeDismissed,
  makeCharAvatarNoticeKey,
  markCharAvatarNoticeDismissed,
  parseDismissedCharAvatarNoticeKeys,
  selectCharAvatarCandidateMessage,
} from './charAvatarSystem';

const msg = (partial: Partial<Message>): Message => ({
  id: partial.id ?? 1,
  charId: 'char-a',
  role: partial.role ?? 'user',
  type: partial.type ?? 'text',
  content: partial.content ?? '',
  timestamp: partial.timestamp ?? 1,
  metadata: partial.metadata,
  groupId: partial.groupId,
  replyTo: partial.replyTo,
});

const char = (patch: Partial<CharacterProfile> = {}): CharacterProfile => ({
  id: 'char-a',
  modelId: 'model-a',
  name: '林夏',
  avatar: 'profile.png',
  description: '',
  systemPrompt: '',
  memories: [],
  contextLimit: 500,
  convoSettings: {
    allowCharAvatarFromUserImage: true,
    ...(patch.convoSettings || {}),
  },
  ...patch,
});

describe('char avatar system', () => {
  it('finds a user avatar request from user text plus user image', () => {
    const request = findPendingUserAvatarRequest([
      msg({ id: 1, role: 'assistant', content: '上一句' }),
      msg({ id: 2, role: 'user', type: 'text', content: '你换这个头像好不好' }),
      msg({ id: 3, role: 'user', type: 'image', content: 'data:image/png;base64,abc', metadata: { charAvatarCandidate: true } }),
    ]);

    expect(request).toMatchObject({
      imageMessageId: 3,
      imageUrl: 'data:image/png;base64,abc',
    });
  });

  it('only treats user image messages as avatar candidates', () => {
    const messages = [
      msg({ id: 1, role: 'assistant', type: 'image', content: 'data:image/png;base64,assistant' }),
      msg({ id: 2, role: 'user', type: 'emoji', content: 'data:image/png;base64,emoji' as any }),
      msg({ id: 3, role: 'system', type: 'text', content: 'system' }),
      msg({ id: 4, role: 'user', type: 'image', content: 'data:image/png;base64,user', metadata: { charAvatarCandidate: true } }),
    ];

    expect(selectCharAvatarCandidateMessage(messages, 1)?.id).toBe(4);
    expect(selectCharAvatarCandidateMessage(messages, 4)?.id).toBe(4);
  });

  it('chooses the newest user image in the pending user block', () => {
    const request = findPendingUserAvatarRequest([
      msg({ id: 1, role: 'assistant', content: '上一句' }),
      msg({ id: 2, role: 'user', type: 'image', content: 'data:image/png;base64,a', metadata: { charAvatarCandidate: true } }),
      msg({ id: 3, role: 'user', type: 'text', content: '用这张当头像' }),
      msg({ id: 4, role: 'user', type: 'image', content: 'data:image/png;base64,b', metadata: { charAvatarCandidate: true } }),
    ]);

    expect(request?.imageMessageId).toBe(4);
  });

  it('accepts clear agreement and rejects refusal or teasing questions', () => {
    expect(assistantAcceptsAvatarRequest('好，听你的。')).toBe(true);
    expect(assistantAcceptsAvatarRequest('那我就用这张。')).toBe(true);
    expect(assistantAcceptsAvatarRequest('不换，别闹。')).toBe(false);
    expect(assistantAcceptsAvatarRequest('还想让我换上？')).toBe(false);
  });

  it('builds a first avatar apply patch with history and a stable notice key', () => {
    const result = buildCharAvatarApplyPatch({
      char: char({ convoSettings: { charAvatarOverride: 'old.png', allowCharAvatarFromUserImage: true } }),
      target: msg({ id: 9, type: 'image', content: 'data:image/png;base64,new', metadata: { charAvatarCandidate: true } }),
      detail: { source: 'user_request', reason: '就用这张' },
      now: 1234,
    });

    expect(result?.duplicate).toBe(false);
    expect(result?.shouldWriteSystemMessage).toBe(true);
    expect(result?.updates?.convoSettings).toMatchObject({
      charAvatarOverride: 'data:image/png;base64,new',
      charAvatarPreviousOverride: 'old.png',
      charAvatarUpdatedAt: 1234,
      charAvatarSourceMessageId: 9,
    });
    expect(result?.updates?.convoSettings?.charAvatarHistory?.[0]).toMatchObject({
      sourceMessageId: 9,
      source: 'user_request',
      reason: '就用这张',
    });
    expect(result?.applied.noticeKey).toBe('char-a:1234:9:user_request');
  });

  it('keeps duplicate avatar events idempotent without overwriting the undo target', () => {
    const result = buildCharAvatarApplyPatch({
      char: char({
        convoSettings: {
          allowCharAvatarFromUserImage: true,
          charAvatarOverride: 'data:image/png;base64:new',
          charAvatarPreviousOverride: 'old.png',
          charAvatarUpdatedAt: 1234,
          charAvatarChangeSource: 'autonomous',
          charAvatarSourceMessageId: 9,
          charAvatarChangeReason: '适合我',
          charAvatarHistory: [{ sourceMessageId: 9, reason: '适合我', source: 'autonomous', at: 1234 }],
        },
      }),
      target: msg({ id: 9, type: 'image', content: 'data:image/png;base64:new', metadata: { charAvatarCandidate: true } }),
      detail: { source: 'autonomous', reason: '适合我' },
      now: 9999,
    });

    expect(result?.duplicate).toBe(true);
    expect(result?.shouldWriteSystemMessage).toBe(false);
    expect(result?.updates).toBeUndefined();
    expect(result?.applied.previousOverride).toBe('old.png');
    expect(result?.applied.at).toBe(1234);
    expect(result?.applied.noticeKey).toBe('char-a:1234:9:autonomous');
  });

  it('caps avatar history at 20 and gives a new image a new notice key', () => {
    const history = Array.from({ length: 25 }, (_, i) => ({
      sourceMessageId: i,
      reason: `old-${i}`,
      source: 'autonomous' as const,
      at: i,
    }));
    const result = buildCharAvatarApplyPatch({
      char: char({ convoSettings: { allowCharAvatarFromUserImage: true, charAvatarHistory: history } }),
      target: msg({ id: 99, type: 'image', content: 'data:image/png;base64:next', metadata: { charAvatarCandidate: true } }),
      detail: { source: 'autonomous', reason: '新的' },
      now: 555,
    });

    expect(result?.updates?.convoSettings?.charAvatarHistory).toHaveLength(20);
    expect(result?.updates?.convoSettings?.charAvatarHistory?.[0]?.sourceMessageId).toBe(99);
    expect(result?.applied.noticeKey).toBe('char-a:555:99:autonomous');
    expect(result?.applied.noticeKey).not.toBe(makeCharAvatarNoticeKey({
      charId: 'char-a',
      at: 555,
      sourceMessageId: 9,
      source: 'autonomous',
    }));
  });

  it('restores an undismissed chat notice from character convo settings', () => {
    const notice = buildCharAvatarNoticeFromCharacter(char({
      convoSettings: {
        allowCharAvatarFromUserImage: true,
        charAvatarOverride: 'data:image/png;base64:notice',
        charAvatarUpdatedAt: 4321,
        charAvatarSourceMessageId: 7,
        charAvatarChangeSource: 'user_request',
        charAvatarPreviousOverride: 'old.png',
        charAvatarChangeReason: '好',
      },
    }));

    expect(notice).toMatchObject({
      charId: 'char-a',
      image: 'data:image/png;base64:notice',
      sourceMessageId: 7,
      noticeKey: 'char-a:4321:7:user_request',
      previousOverride: 'old.png',
    });
  });

  it('tracks dismissed notice keys with dedupe and a 100 item cap', () => {
    const keys = Array.from({ length: 105 }, (_, i) => `k-${i}`);
    const dismissed = markCharAvatarNoticeDismissed(keys, 'k-20');
    const withNew = markCharAvatarNoticeDismissed(dismissed, 'k-new');

    expect(dismissed[0]).toBe('k-20');
    expect(withNew[0]).toBe('k-new');
    expect(withNew).toHaveLength(100);
    expect(isCharAvatarNoticeDismissed(withNew, 'k-new')).toBe(true);
    expect(parseDismissedCharAvatarNoticeKeys(JSON.stringify(['a', 'a', '', 'b']))).toEqual(['a', 'b']);
  });
});
