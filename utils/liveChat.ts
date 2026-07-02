import type { CharacterProfile, LiveChatOverride, LiveChatSettings, UserProfile } from '../types';
import { canCharContactUser } from './blockSystem';

export type NormalizedLiveChatSettings = Required<LiveChatSettings>;

export const DEFAULT_LIVE_CHAT_SETTINGS: NormalizedLiveChatSettings = {
    enabled: false,
    draftAwareness: true,
    draftPauseMs: 1500,
    draftMinChars: 3,
    draftCooldownMs: 12000,
    interjectMaxTargets: 2,
};

const clampInt = (value: unknown, fallback: number, min: number, max: number): number => {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, Math.round(parsed)));
};

export function normalizeLiveChatSettings(profile?: Pick<UserProfile, 'liveChatSettings'> | null): NormalizedLiveChatSettings {
    const raw = profile?.liveChatSettings || {};
    return {
        enabled: raw.enabled === true,
        draftAwareness: raw.draftAwareness !== false,
        draftPauseMs: clampInt(raw.draftPauseMs, DEFAULT_LIVE_CHAT_SETTINGS.draftPauseMs, 500, 10000),
        draftMinChars: clampInt(raw.draftMinChars, DEFAULT_LIVE_CHAT_SETTINGS.draftMinChars, 1, 200),
        draftCooldownMs: clampInt(raw.draftCooldownMs, DEFAULT_LIVE_CHAT_SETTINGS.draftCooldownMs, 0, 10 * 60 * 1000),
        interjectMaxTargets: clampInt(raw.interjectMaxTargets, DEFAULT_LIVE_CHAT_SETTINGS.interjectMaxTargets, 0, 8),
    };
}

export function normalizeLiveChatOverride(value?: LiveChatOverride | null): LiveChatOverride {
    return value === 'on' || value === 'off' ? value : 'inherit';
}

export function resolveLiveChatEnabled(
    profile?: Pick<UserProfile, 'liveChatSettings'> | null,
    override?: LiveChatOverride | null,
): boolean {
    const normalizedOverride = normalizeLiveChatOverride(override);
    if (normalizedOverride === 'on') return true;
    if (normalizedOverride === 'off') return false;
    return normalizeLiveChatSettings(profile).enabled;
}

export interface LiveDraftTriggerInput {
    settings: NormalizedLiveChatSettings;
    text: string;
    now: number;
    lastChangedAt?: number;
    lastTriggeredAt?: number;
    lastTriggeredText?: string;
}

export function shouldTriggerLiveDraft(input: LiveDraftTriggerInput): boolean {
    const text = input.text.trim();
    if (!input.settings.enabled || !input.settings.draftAwareness) return false;
    if (text.length < input.settings.draftMinChars) return false;
    if (input.lastChangedAt !== undefined && input.now - input.lastChangedAt < input.settings.draftPauseMs) return false;
    if (input.lastTriggeredAt !== undefined && input.now - input.lastTriggeredAt < input.settings.draftCooldownMs) return false;
    if (input.lastTriggeredText && input.lastTriggeredText.trim() === text) return false;
    return true;
}

export function getLiveChatInterjectCandidates(
    characters: CharacterProfile[],
    activeCharacterId?: string | null,
): CharacterProfile[] {
    return characters.filter(char => (
        char.id !== activeCharacterId
        && canCharContactUser(char)
    ));
}

export function pickLiveChatInterjectTargets<T extends { id: string }>(
    candidates: T[],
    maxTargets: number,
    seed = Date.now(),
): T[] {
    const max = clampInt(maxTargets, DEFAULT_LIVE_CHAT_SETTINGS.interjectMaxTargets, 0, 8);
    if (max <= 0 || candidates.length === 0) return [];
    const scored = candidates.map((item, index) => {
        let hash = seed + index * 2654435761;
        for (let i = 0; i < item.id.length; i += 1) {
            hash = ((hash << 5) - hash + item.id.charCodeAt(i)) | 0;
        }
        return { item, score: hash >>> 0 };
    });
    return scored
        .sort((a, b) => a.score - b.score)
        .slice(0, max)
        .map(entry => entry.item);
}
