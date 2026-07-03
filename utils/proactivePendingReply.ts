import type { Message } from '../types';
import { ChatParser } from './chatParser';

export interface PendingProactiveReplyMessage {
  id: number;
  content: string;
  timestamp: number;
  type: 'text' | 'voice';
}

export interface QueuedReplyTarget {
  id: number;
  content: string;
  name: string;
}

const MAX_PENDING_MESSAGES = 5;
const MAX_PENDING_CONTENT_CHARS = 500;
const MAX_REPLY_PREVIEW_CHARS = 20;

function cleanVisibleText(raw: unknown): string {
  return String(raw || '').replace(/\s+/g, ' ').trim();
}

function isHiddenControlMessage(message: Message): boolean {
  const meta = message.metadata || {};
  return !!(
    meta.hidden ||
    meta.proactiveHint ||
    meta.excludeFromContext ||
    meta.systemCommand ||
    meta.mcdDeactivate ||
    meta.parallelReplyFanout
  );
}

function getPendingUserContent(message: Message): string {
  if (message.type === 'voice') {
    const transcript = cleanVisibleText(message.metadata?.transcript);
    return ChatParser.hasDisplayContent(transcript) ? transcript : '';
  }
  if (message.type !== 'text') return '';
  const content = cleanVisibleText(message.content);
  return ChatParser.hasDisplayContent(content) ? content : '';
}

function isVisibleAssistantMessage(message: Message): boolean {
  if (message.role !== 'assistant' || message.groupId || isHiddenControlMessage(message)) return false;
  return ChatParser.hasDisplayContent(cleanVisibleText(message.content));
}

export function findPendingProactiveReplyMessages(
  messages: Message[],
  maxCount = MAX_PENDING_MESSAGES,
): PendingProactiveReplyMessage[] {
  let lastAssistantIndex = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (isVisibleAssistantMessage(messages[i])) {
      lastAssistantIndex = i;
      break;
    }
  }

  return messages
    .slice(lastAssistantIndex + 1)
    .filter((message) => (
      message.role === 'user' &&
      !message.groupId &&
      message.metadata?.msgStatus === 'sent' &&
      !isHiddenControlMessage(message)
    ))
    .map((message) => {
      const content = getPendingUserContent(message);
      if (!content) return null;
      return {
        id: message.id,
        content: content.slice(0, MAX_PENDING_CONTENT_CHARS),
        timestamp: message.timestamp,
        type: message.type === 'voice' ? 'voice' as const : 'text' as const,
      };
    })
    .filter((message): message is PendingProactiveReplyMessage => !!message)
    .slice(0, Math.max(1, maxCount));
}

export function makeQueuedReplyTarget(
  message: PendingProactiveReplyMessage | undefined,
  userName = '我',
): QueuedReplyTarget | undefined {
  if (!message) return undefined;
  const content = message.content.length > MAX_REPLY_PREVIEW_CHARS
    ? `${message.content.slice(0, MAX_REPLY_PREVIEW_CHARS)}...`
    : message.content;
  return { id: message.id, content, name: userName || '我' };
}
