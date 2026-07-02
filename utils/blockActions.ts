import type { CharacterProfile, Message } from '../types';
import { DB } from './db';
import { buildUserBlockUpdates, buildUserUnblockUpdates } from './blockSystem';
import type { UnblockAppealHandledFrom } from './unblockAppealActions';

type CharacterUpdater = (id: string, updates: Partial<CharacterProfile>) => Promise<void> | void;

const pendingAppealMessages = async (charId: string): Promise<Message[]> => {
    const messages = await DB.getMessagesByCharId(charId, true);
    return messages
        .filter(m => m.metadata?.unblockAppeal?.status === 'pending')
        .sort((a, b) => (b.timestamp - a.timestamp) || ((b.id || 0) - (a.id || 0)));
};

export async function markPendingUnblockAppealsHandled(args: {
    charId: string;
    handledFrom: Extract<UnblockAppealHandledFrom, 'manual' | 'bulk'>;
    now?: number;
}): Promise<number> {
    const now = args.now ?? Date.now();
    const pending = await pendingAppealMessages(args.charId);
    for (const message of pending) {
        await DB.updateMessageMetadata(message.id, (prev: any) => ({
            ...(prev || {}),
            unblockAppeal: {
                ...(prev?.unblockAppeal || {}),
                status: 'accepted',
                handledAt: now,
                handledFrom: args.handledFrom,
            },
        }));
    }
    return pending.length;
}

export async function blockCharacterByUser(args: {
    char: CharacterProfile;
    updateCharacter: CharacterUpdater;
    now?: number;
    systemMessage?: boolean;
}): Promise<void> {
    const now = args.now ?? Date.now();
    await args.updateCharacter(args.char.id, buildUserBlockUpdates(args.char, now));
    if (args.systemMessage !== false) {
        await DB.saveMessage({
            charId: args.char.id,
            role: 'system',
            type: 'text',
            content: `你已将「${args.char.name}」加入黑名单，暂时无法发送消息`,
            timestamp: now,
        });
    }
}

export async function unblockCharacterByUser(args: {
    char: CharacterProfile;
    updateCharacter: CharacterUpdater;
    handledFrom?: Extract<UnblockAppealHandledFrom, 'manual' | 'bulk'>;
    clearUnread?: (charId: string) => void;
    now?: number;
    systemMessage?: boolean;
}): Promise<{ handledAppeals: number }> {
    const now = args.now ?? Date.now();
    const handledFrom = args.handledFrom || 'manual';
    const handledAppeals = await markPendingUnblockAppealsHandled({
        charId: args.char.id,
        handledFrom,
        now,
    });
    await args.updateCharacter(args.char.id, buildUserUnblockUpdates(args.char));
    if (args.systemMessage !== false) {
        await DB.saveMessage({
            charId: args.char.id,
            role: 'system',
            type: 'text',
            content: `你已将「${args.char.name}」移出黑名单，可以继续聊天了`,
            timestamp: now + 1,
        });
    }
    args.clearUnread?.(args.char.id);
    return { handledAppeals };
}

export async function unblockCharactersByUser(args: {
    chars: CharacterProfile[];
    updateCharacter: CharacterUpdater;
    clearUnread?: (charId: string) => void;
    now?: number;
}): Promise<{ count: number; handledAppeals: number }> {
    const now = args.now ?? Date.now();
    let handledAppeals = 0;
    for (let i = 0; i < args.chars.length; i += 1) {
        const result = await unblockCharacterByUser({
            char: args.chars[i],
            updateCharacter: args.updateCharacter,
            handledFrom: 'bulk',
            clearUnread: args.clearUnread,
            now: now + i,
            systemMessage: true,
        });
        handledAppeals += result.handledAppeals;
    }
    return { count: args.chars.length, handledAppeals };
}

