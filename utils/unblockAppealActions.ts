import type { CharacterProfile, Message } from '../types';
import { DB } from './db';
import { nextAppealDelayMs } from './unblockAppeal';

export type UnblockAppealDecision = 'accept' | 'reject';
export type UnblockAppealHandledFrom = 'contacts' | 'chat' | 'manual' | 'bulk';

export async function getPendingUnblockAppealMessages(charId: string): Promise<Message[]> {
    const messages = await DB.getMessagesByCharId(charId, true);
    return messages
        .filter(m => m.metadata?.unblockAppeal?.status === 'pending')
        .sort((a, b) => (b.timestamp - a.timestamp) || ((b.id || 0) - (a.id || 0)));
}

export async function getLatestPendingUnblockAppealMessage(charId: string): Promise<Message | null> {
    return (await getPendingUnblockAppealMessages(charId))[0] || null;
}

export function buildMissingUnblockAppealRetryUpdate(
    char: CharacterProfile,
    now = Date.now(),
): Partial<CharacterProfile> | null {
    const appeal = char.unblockAppeal;
    if (!char.blacklisted || !appeal?.active || !appeal.awaiting) return null;
    return {
        unblockAppeal: {
            ...appeal,
            awaiting: false,
            nextAt: now,
        },
    };
}

export async function resolveUnblockAppealDecision(args: {
    char: CharacterProfile;
    message: Message;
    decision: UnblockAppealDecision;
    replyText?: string;
    handledFrom: UnblockAppealHandledFrom;
    updateCharacter: (id: string, updates: Partial<CharacterProfile>) => Promise<void>;
    clearUnread?: (charId: string) => void;
}): Promise<{ replyText: string; rejectedCount?: number }> {
    const { char, message, decision, handledFrom, updateCharacter, clearUnread } = args;
    const replyText = (args.replyText || '').trim().slice(0, 500);
    const now = Date.now();

    await DB.updateMessageMetadata(message.id, (prev: any) => ({
        ...(prev || {}),
        unblockAppeal: {
            ...(prev?.unblockAppeal || {}),
            status: decision === 'accept' ? 'accepted' : 'rejected',
            userReply: replyText || undefined,
            handledAt: now,
            handledFrom,
        },
    }));

    if (replyText) {
        await DB.saveMessage({
            charId: char.id,
            role: 'user',
            type: 'text',
            content: `[验证留言] ${replyText}`,
            timestamp: now + 1,
            metadata: {
                unblockAppealReply: {
                    appealMessageId: message.id,
                    decision,
                },
            },
        });
    }

    if (decision === 'accept') {
        await DB.saveMessage({
            charId: char.id,
            role: 'system',
            type: 'text',
            content: `你同意了「${char.name}」的解除拉黑申请${replyText ? '，并回复了验证留言' : ''}，你们可以继续聊天了`,
            timestamp: now + (replyText ? 2 : 1),
        });
        await updateCharacter(char.id, {
            blacklisted: false,
            blacklistedAt: undefined,
            addedToChat: true,
            unblockAppeal: {
                active: false,
                awaiting: false,
                nextAt: 0,
                rejectedCount: char.unblockAppeal?.rejectedCount || 0,
            },
        });
        clearUnread?.(char.id);
        return { replyText };
    }

    const rejectedCount = (char.unblockAppeal?.rejectedCount || message.metadata?.unblockAppeal?.rejectedCount || 0) + 1;
    await DB.saveMessage({
        charId: char.id,
        role: 'system',
        type: 'text',
        content: `你拒绝了「${char.name}」的解除拉黑申请${replyText ? '，并留下了一条验证回复' : ''}`,
        timestamp: now + (replyText ? 2 : 1),
    });
    await updateCharacter(char.id, {
        unblockAppeal: {
            active: true,
            awaiting: false,
            rejectedCount,
            nextAt: Date.now() + nextAppealDelayMs(rejectedCount),
        },
    });
    clearUnread?.(char.id);
    return { replyText, rejectedCount };
}
