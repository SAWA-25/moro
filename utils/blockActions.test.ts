import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CharacterProfile } from '../types';
import { DB } from './db';
import { unblockCharacterByUser, unblockCharactersByUser } from './blockActions';

const char = (id = 'c1', patch: Partial<CharacterProfile> = {}): CharacterProfile => ({
    id,
    name: id,
    avatar: '',
    description: '',
    systemPrompt: '',
    memories: [],
    blacklisted: true,
    blacklistedAt: 100,
    unblockAppeal: { active: true, awaiting: true, nextAt: 200, rejectedCount: 2 },
    ...patch,
} as CharacterProfile);

afterEach(async () => {
    vi.restoreAllMocks();
    await DB.deleteDB();
});

describe('block actions', () => {
    it('manual unblock clears state and marks pending appeal handled', async () => {
        const c = char();
        const msgId = await DB.saveMessage({
            charId: c.id,
            role: 'assistant',
            type: 'text',
            content: '放我回来',
            metadata: { unblockAppeal: { status: 'pending', rejectedCount: 2 } },
        });
        const updates: Partial<CharacterProfile>[] = [];

        const result = await unblockCharacterByUser({
            char: c,
            updateCharacter: async (_id, patch) => { updates.push(patch); },
            handledFrom: 'manual',
        });

        expect(result.handledAppeals).toBe(1);
        expect(updates[0]).toMatchObject({
            blacklisted: false,
            blacklistedAt: undefined,
            addedToChat: true,
            unblockAppeal: { active: false, awaiting: false, nextAt: 0, rejectedCount: 2 },
        });
        const [saved] = (await DB.getMessagesByCharId(c.id, true)).filter(m => m.id === msgId);
        expect(saved.metadata?.unblockAppeal).toMatchObject({ status: 'accepted', handledFrom: 'manual' });
    });

    it('bulk unblock marks each pending appeal as bulk handled', async () => {
        const chars = [char('a'), char('b')];
        for (const c of chars) {
            await DB.saveMessage({
                charId: c.id,
                role: 'assistant',
                type: 'text',
                content: '申请',
                metadata: { unblockAppeal: { status: 'pending', rejectedCount: 0 } },
            });
        }
        const updated: string[] = [];
        const result = await unblockCharactersByUser({
            chars,
            updateCharacter: async (id) => { updated.push(id); },
        });

        expect(result.count).toBe(2);
        expect(result.handledAppeals).toBe(2);
        expect(updated).toEqual(['a', 'b']);
        for (const c of chars) {
            const pending = await DB.getMessagesByCharId(c.id, true);
            expect(pending[0].metadata?.unblockAppeal).toMatchObject({ status: 'accepted', handledFrom: 'bulk' });
        }
    });
});

