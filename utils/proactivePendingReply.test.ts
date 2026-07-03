import { describe, expect, it } from 'vitest';
import type { Message } from '../types';
import { findPendingProactiveReplyMessages, makeQueuedReplyTarget } from './proactivePendingReply';

const msg = (patch: Partial<Message>): Message => ({
  id: patch.id ?? 1,
  charId: patch.charId ?? 'char-1',
  role: patch.role ?? 'user',
  type: patch.type ?? 'text',
  content: patch.content ?? '',
  timestamp: patch.timestamp ?? 1_788_000_000_000,
  metadata: patch.metadata,
  groupId: patch.groupId,
  replyTo: patch.replyTo,
});

describe('proactive pending reply detection', () => {
  it('finds sent user text after the last visible assistant message', () => {
    const pending = findPendingProactiveReplyMessages([
      msg({ id: 1, role: 'user', content: 'old', metadata: { msgStatus: 'sent' } }),
      msg({ id: 2, role: 'assistant', content: 'replied' }),
      msg({ id: 3, role: 'user', content: '你刚才看到这条了吗', metadata: { msgStatus: 'sent' } }),
    ]);

    expect(pending).toEqual([
      expect.objectContaining({ id: 3, content: '你刚才看到这条了吗', type: 'text' }),
    ]);
    expect(makeQueuedReplyTarget(pending[0], '小夏')).toEqual({
      id: 3,
      content: '你刚才看到这条了吗',
      name: '小夏',
    });
  });

  it('ignores old, hidden, proactive, group, control, read, failed, and non-text messages', () => {
    const pending = findPendingProactiveReplyMessages([
      msg({ id: 1, role: 'user', content: 'old', metadata: { msgStatus: 'sent' } }),
      msg({ id: 2, role: 'assistant', content: 'last visible reply' }),
      msg({ id: 3, role: 'user', content: 'hidden', metadata: { msgStatus: 'sent', hidden: true } }),
      msg({ id: 4, role: 'user', content: 'proactive hint', metadata: { msgStatus: 'sent', proactiveHint: true } }),
      msg({ id: 5, role: 'user', content: 'group', groupId: 'g1', metadata: { msgStatus: 'sent' } }),
      msg({ id: 6, role: 'user', content: 'system command', metadata: { msgStatus: 'sent', systemCommand: true } }),
      msg({ id: 7, role: 'user', content: 'read', metadata: { msgStatus: 'read' } }),
      msg({ id: 8, role: 'user', content: 'failed', metadata: { msgStatus: 'failed' } }),
      msg({ id: 9, role: 'user', type: 'image', content: 'data:image/png;base64,x', metadata: { msgStatus: 'sent' } }),
      msg({ id: 10, role: 'user', content: 'keep me', metadata: { msgStatus: 'sent' } }),
    ]);

    expect(pending.map(m => m.id)).toEqual([10]);
  });

  it('uses voice transcripts and skips voice messages without transcripts', () => {
    const pending = findPendingProactiveReplyMessages([
      msg({ id: 1, role: 'assistant', content: '嗯' }),
      msg({ id: 2, role: 'user', type: 'voice', content: '[语音消息]', metadata: { msgStatus: 'sent' } }),
      msg({ id: 3, role: 'user', type: 'voice', content: '[语音消息]', metadata: { msgStatus: 'sent', transcript: '我用语音说的这句' } }),
    ]);

    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ id: 3, content: '我用语音说的这句', type: 'voice' });
  });
});
