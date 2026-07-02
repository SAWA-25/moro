import { describe, expect, it } from 'vitest';
import { buildMessageFollowup, normalizeFollowup, saveChatFollowup, completeChatFollowup } from './chatFollowups';
import { DB } from './db';
import type { Message } from '../types';

describe('chatFollowups', () => {
  it('builds a private message followup with jump metadata', () => {
    const message = { id: 12, charId: 'c1', role: 'assistant', type: 'text', content: '记得带伞', timestamp: 100 } as Message;
    const followup = buildMessageFollowup({ message, targetKind: 'char', targetId: 'c1', targetName: '阿迟' });

    expect(followup.source).toBe('private_message');
    expect(followup.targetKind).toBe('char');
    expect(followup.messageId).toBe(12);
    expect(followup.title).toContain('阿迟');
    expect(followup.note).toContain('记得带伞');
  });

  it('normalizes manual followups defensively', () => {
    const followup = normalizeFollowup({ title: '   ' });

    expect(followup.id).toBeTruthy();
    expect(followup.source).toBe('manual');
    expect(followup.targetKind).toBe('hub');
    expect(followup.status).toBe('open');
    expect(followup.title).toBeTruthy();
  });

  it('saves and completes through DB helpers', async () => {
    await DB.deleteDB();
    const saved = await saveChatFollowup(normalizeFollowup({ title: '回这句', targetKind: 'char', targetId: 'c1' }));
    const done = await completeChatFollowup(saved.id);

    expect(done?.status).toBe('done');
    expect((await DB.getAllChatFollowups())[0].status).toBe('done');
  });
});
