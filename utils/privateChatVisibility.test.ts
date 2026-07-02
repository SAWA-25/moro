import { describe, expect, it } from 'vitest';
import type { Message, PrivateChatArchiveMessage } from '../types';
import {
  filterPrivateChatVisibleArchiveMessages,
  filterPrivateChatVisibleMessages,
  isPrivateChatVisibleMessage,
} from './privateChatVisibility';

const msg = (id: number, content: string, metadata?: any, extra?: Partial<Message>): Message => ({
  id,
  charId: 'char-1',
  role: 'user',
  type: 'text',
  content,
  timestamp: id,
  metadata,
  ...extra,
});

const archiveMsg = (content: string, metadata?: any): PrivateChatArchiveMessage => ({
  charId: 'char-1',
  role: 'user',
  type: 'text',
  content,
  timestamp: Date.now(),
  metadata,
});

describe('private chat visible message filter', () => {
  it('excludes hidden and blockPeek messages from history and archive snapshots', () => {
    const history = [
      msg(1, 'visible'),
      msg(2, 'hidden system note', { hidden: true }),
      msg(3, 'screen peek private note', { blockPeek: true }),
      msg(4, 'date separator', { source: 'date' }),
      msg(5, 'call transcript', { source: 'call' }),
      msg(6, 'proactive hint', { proactiveHint: true }),
      msg(7, 'group message', undefined, { groupId: 'group-1' }),
    ];

    expect(filterPrivateChatVisibleMessages(history).map(m => m.content)).toEqual(['visible']);
    expect(isPrivateChatVisibleMessage(history[1])).toBe(false);
    expect(isPrivateChatVisibleMessage(history[2])).toBe(false);

    const snapshot = [
      archiveMsg('visible snapshot'),
      archiveMsg('hidden snapshot', { hidden: true }),
      archiveMsg('block peek snapshot', { blockPeek: true }),
    ];

    expect(filterPrivateChatVisibleArchiveMessages(snapshot).map(m => m.content)).toEqual(['visible snapshot']);
  });
});
