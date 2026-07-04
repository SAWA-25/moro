import { describe, expect, it } from 'vitest';
import type { Message } from '../types';
import {
  assistantAcceptsAvatarRequest,
  findPendingUserAvatarRequest,
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
});
