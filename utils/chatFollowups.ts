import type { ChatFollowup, Message } from '../types';
import { DB } from './db';

const clip = (value: unknown, limit = 80): string => {
  const clean = String(value ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > limit ? `${clean.slice(0, limit)}...` : clean;
};

const makeId = (prefix = 'cf') => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export function buildMessageFollowup(input: {
  message: Message;
  targetKind: 'char' | 'group';
  targetId: string;
  targetName: string;
  note?: string;
}): ChatFollowup {
  const now = Date.now();
  const { message, targetKind, targetId, targetName } = input;
  const mine = message.role === 'user';
  const source = targetKind === 'group' ? 'group_message' : 'private_message';
  const preview = clip(message.content || `[${message.type}]`, 120);
  return {
    id: makeId(),
    source,
    targetKind,
    targetId,
    groupId: targetKind === 'group' ? (message.groupId || targetId) : undefined,
    messageId: message.id,
    title: targetKind === 'group'
      ? `${targetName} 里的${mine ? '你的消息' : '一条消息'}`
      : `${targetName} 的${mine ? '待回应消息' : '来信'}`,
    note: input.note?.trim() || preview,
    status: 'open',
    createdAt: now,
    updatedAt: now,
  };
}

export function normalizeFollowup(raw: Partial<ChatFollowup>): ChatFollowup {
  const now = Date.now();
  const title = clip(raw.title || '', 80) || '稍后回到这里';
  return {
    id: raw.id || makeId(),
    source: raw.source || 'manual',
    targetKind: raw.targetKind || 'hub',
    targetId: raw.targetId,
    messageId: raw.messageId,
    groupId: raw.groupId,
    title,
    note: raw.note ? clip(raw.note, 240) : undefined,
    status: raw.status || 'open',
    dueAt: raw.dueAt,
    createdAt: raw.createdAt || now,
    updatedAt: now,
  };
}

export async function saveChatFollowup(followup: ChatFollowup): Promise<ChatFollowup> {
  const next = normalizeFollowup(followup);
  await DB.saveChatFollowup(next);
  return next;
}

export async function createMessageFollowup(input: Parameters<typeof buildMessageFollowup>[0]): Promise<ChatFollowup> {
  const followup = buildMessageFollowup(input);
  await DB.saveChatFollowup(followup);
  return followup;
}

export async function completeChatFollowup(id: string): Promise<ChatFollowup | null> {
  return DB.updateChatFollowupStatus(id, 'done');
}

export async function dismissChatFollowup(id: string): Promise<ChatFollowup | null> {
  return DB.updateChatFollowupStatus(id, 'dismissed');
}
