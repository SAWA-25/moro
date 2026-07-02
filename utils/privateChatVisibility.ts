import type { Message, PrivateChatArchiveMessage } from '../types';

type PrivateChatMessageLike = Pick<Message, 'groupId' | 'metadata'>;
type PrivateChatArchiveMessageLike = Pick<PrivateChatArchiveMessage, 'metadata'>;

export const isPrivateChatVisibleMetadata = (metadata?: any): boolean => {
  return metadata?.source !== 'date'
    && metadata?.source !== 'call'
    && !metadata?.proactiveHint
    && !metadata?.hidden
    && !metadata?.blockPeek;
};

export const isPrivateChatVisibleMessage = (message: PrivateChatMessageLike | null | undefined): boolean => {
  return !!message
    && !message.groupId
    && isPrivateChatVisibleMetadata(message.metadata);
};

export const isPrivateChatVisibleArchiveMessage = (
  message: PrivateChatArchiveMessageLike | null | undefined,
): boolean => {
  return !!message && isPrivateChatVisibleMetadata(message.metadata);
};

export const filterPrivateChatVisibleMessages = <T extends PrivateChatMessageLike>(messages: T[] = []): T[] => {
  return messages.filter(isPrivateChatVisibleMessage);
};

export const filterPrivateChatVisibleArchiveMessages = <T extends PrivateChatArchiveMessageLike>(messages: T[] = []): T[] => {
  return messages.filter(isPrivateChatVisibleArchiveMessage);
};
