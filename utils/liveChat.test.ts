import { describe, expect, it } from 'vitest';
import type { CharacterProfile, UserProfile } from '../types';
import {
    DEFAULT_LIVE_CHAT_SETTINGS,
    getLiveChatInterjectCandidates,
    normalizeLiveChatSettings,
    pickLiveChatInterjectTargets,
    resolveLiveChatEnabled,
    shouldTriggerLiveDraft,
} from './liveChat';

const profile = (liveChatSettings?: UserProfile['liveChatSettings']) => ({ liveChatSettings }) as UserProfile;
const char = (id: string, patch: Partial<CharacterProfile> = {}) => ({ id, name: id, ...patch }) as CharacterProfile;

describe('live chat settings', () => {
    it('defaults to explicit off while keeping draft awareness ready', () => {
        expect(normalizeLiveChatSettings(profile())).toEqual(DEFAULT_LIVE_CHAT_SETTINGS);
        expect(resolveLiveChatEnabled(profile())).toBe(false);
    });

    it('resolves global setting with per-conversation override', () => {
        const globallyOn = profile({ enabled: true });
        const globallyOff = profile({ enabled: false });

        expect(resolveLiveChatEnabled(globallyOn, 'inherit')).toBe(true);
        expect(resolveLiveChatEnabled(globallyOn, 'off')).toBe(false);
        expect(resolveLiveChatEnabled(globallyOff, 'on')).toBe(true);
        expect(resolveLiveChatEnabled(globallyOff, undefined)).toBe(false);
    });
});

describe('live draft trigger', () => {
    const settings = normalizeLiveChatSettings(profile({ enabled: true, draftPauseMs: 1500, draftMinChars: 3, draftCooldownMs: 12000 }));

    it('requires live mode, enough text, and a full pause', () => {
        expect(shouldTriggerLiveDraft({ settings, text: ' hi ', now: 2000, lastChangedAt: 0 })).toBe(false);
        expect(shouldTriggerLiveDraft({ settings, text: '你好呀', now: 1200, lastChangedAt: 0 })).toBe(false);
        expect(shouldTriggerLiveDraft({ settings, text: '你好呀', now: 1600, lastChangedAt: 0 })).toBe(true);
    });

    it('honors cooldown and avoids repeating the same draft', () => {
        expect(shouldTriggerLiveDraft({ settings, text: '你看这个', now: 6000, lastChangedAt: 0, lastTriggeredAt: 1000 })).toBe(false);
        expect(shouldTriggerLiveDraft({ settings, text: '你看这个', now: 14000, lastChangedAt: 0, lastTriggeredAt: 1000 })).toBe(true);
        expect(shouldTriggerLiveDraft({ settings, text: '你看这个', now: 20000, lastChangedAt: 0, lastTriggeredText: '你看这个' })).toBe(false);
    });
});

describe('live interject candidates', () => {
    it('filters current character and blocked private chats', () => {
        const candidates = getLiveChatInterjectCandidates([
            char('active'),
            char('ok'),
            char('blacklisted', { blacklisted: true }),
            char('blocked-by-char', { charBlock: { active: true, by: 'char', reason: 'test', at: 1 } as any }),
            char('mutual', { blacklisted: true, charBlock: { active: true, blockedAt: 1, unblockAt: 2 } }),
        ], 'active');

        expect(candidates.map(c => c.id)).toEqual(['ok']);
    });

    it('picks only the configured small number of targets', () => {
        const picked = pickLiveChatInterjectTargets([char('a'), char('b'), char('c')], 2, 42);

        expect(picked).toHaveLength(2);
        expect(new Set(picked.map(c => c.id)).size).toBe(2);
    });
});
