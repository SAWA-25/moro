import { afterEach, describe, expect, it } from 'vitest';
import type { CharacterProfile } from '../types';
import { DB } from './db';
import {
    buildMissingUnblockAppealRetryUpdate,
    getLatestPendingUnblockAppealMessage,
    getPendingUnblockAppealMessages,
} from './unblockAppealActions';

const blockedChar = (patch: Partial<CharacterProfile> = {}): CharacterProfile => ({
    id: 'char-appeal',
    name: 'Isaac',
    avatar: '',
    description: '',
    systemPrompt: '',
    memories: [],
    blacklisted: true,
    blacklistedAt: 100,
    unblockAppeal: { active: true, awaiting: true, nextAt: 200, rejectedCount: 1 },
    ...patch,
} as CharacterProfile);

afterEach(async () => {
    await DB.deleteDB();
});

describe('unblock appeal actions', () => {
    it('loads the latest pending unblock appeal message', async () => {
        await DB.saveMessage({
            charId: 'char-appeal',
            role: 'assistant',
            type: 'text',
            content: '旧申请',
            timestamp: 100,
            metadata: { unblockAppeal: { status: 'pending', rejectedCount: 0 } },
        });
        await DB.saveMessage({
            charId: 'char-appeal',
            role: 'assistant',
            type: 'text',
            content: '已处理申请',
            timestamp: 200,
            metadata: { unblockAppeal: { status: 'accepted', rejectedCount: 0 } },
        });
        const latestId = await DB.saveMessage({
            charId: 'char-appeal',
            role: 'assistant',
            type: 'text',
            content: '新申请',
            timestamp: 300,
            metadata: { unblockAppeal: { status: 'pending', rejectedCount: 1 } },
        });

        const pending = await getPendingUnblockAppealMessages('char-appeal');
        const latest = await getLatestPendingUnblockAppealMessage('char-appeal');

        expect(pending.map(m => m.content)).toEqual(['新申请', '旧申请']);
        expect(latest?.id).toBe(latestId);
    });

    it('builds a retry update for stale awaiting state without a pending message', () => {
        const update = buildMissingUnblockAppealRetryUpdate(blockedChar(), 1234);

        expect(update).toEqual({
            unblockAppeal: {
                active: true,
                awaiting: false,
                nextAt: 1234,
                rejectedCount: 1,
            },
        });
        expect(buildMissingUnblockAppealRetryUpdate(blockedChar({ blacklisted: false }), 1234)).toBeNull();
        expect(buildMissingUnblockAppealRetryUpdate(blockedChar({
            unblockAppeal: { active: true, awaiting: false, nextAt: 200, rejectedCount: 1 },
        }), 1234)).toBeNull();
    });
});
