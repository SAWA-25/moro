import { describe, expect, it, vi } from 'vitest';
import type { CharacterProfile } from '../types';
import {
    buildUserBlockUpdates,
    buildUserUnblockUpdates,
    canCharContactUser,
    canUserSendPrivateToChar,
    getPrivateBlockState,
} from './blockSystem';

const char = (patch: Partial<CharacterProfile> = {}): CharacterProfile => ({
    id: 'c1',
    name: '角色',
    avatar: '',
    description: '',
    systemPrompt: '',
    memories: [],
    ...patch,
} as CharacterProfile);

describe('block system state', () => {
    it('derives none/user/char/mutual block states', () => {
        expect(getPrivateBlockState(char()).kind).toBe('none');
        expect(getPrivateBlockState(char({ blacklisted: true })).kind).toBe('user_blocked_char');
        expect(getPrivateBlockState(char({ charBlock: { active: true, blockedAt: 1, unblockAt: 2 } })).kind).toBe('char_blocked_user');
        expect(getPrivateBlockState(char({ blacklisted: true, charBlock: { active: true, blockedAt: 1, unblockAt: 2 } })).kind).toBe('mutual');
    });

    it('blocks private sends and character contact consistently', () => {
        expect(canUserSendPrivateToChar(char())).toBe(true);
        expect(canCharContactUser(char())).toBe(true);

        expect(canUserSendPrivateToChar(char({ blacklisted: true }))).toBe(false);
        expect(canCharContactUser(char({ blacklisted: true }))).toBe(false);
        expect(canUserSendPrivateToChar(char({ charBlock: { active: true, blockedAt: 1, unblockAt: 2 } }))).toBe(false);
        expect(canCharContactUser(char({ charBlock: { active: true, blockedAt: 1, unblockAt: 2 } }))).toBe(false);
    });

    it('builds user block and unblock update shapes', () => {
        vi.spyOn(Date, 'now').mockReturnValue(10_000);
        const blocked = buildUserBlockUpdates(char({ addedToChat: false }), 12_000);
        expect(blocked.blacklisted).toBe(true);
        expect(blocked.blacklistedAt).toBe(12_000);
        expect(blocked.addedToChat).toBe(false);
        expect(blocked.unblockAppeal).toMatchObject({ active: true, awaiting: false, rejectedCount: 0 });

        const unblocked = buildUserUnblockUpdates(char({ unblockAppeal: { active: true, awaiting: true, nextAt: 99, rejectedCount: 3 } }));
        expect(unblocked).toEqual({
            blacklisted: false,
            blacklistedAt: undefined,
            addedToChat: true,
            unblockAppeal: { active: false, awaiting: false, nextAt: 0, rejectedCount: 3 },
        });
    });
});

