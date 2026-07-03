import type { APIConfig, AuxApiConfig, CharacterProfile, SocialPost, UserProfile } from '../types';
import { DB } from './db';
import { resolveAuxApi } from './auxApi';
import { generateAutoCharacterMoment } from '../components/moments/momentsGen';
import { sanitizeLifeText } from './autonomousLife';
import { isAmbientSocialCharacterForUser, shouldHideAmbientSocialRecordForUser } from './ambientSocial';

const LAST_KEY_PREFIX = 'moro_moments_auto_last_v1_';
const ROLL_KEY_PREFIX = 'moro_moments_auto_roll_v1_';
const RUN_LOCK_KEY = 'moro_moments_auto_lock_v1';
const RUN_LOCK_MS = 30 * 1000;
const RANDOM_MIN_GAP_MS = 12 * 60 * 60 * 1000;
const RANDOM_NORMAL_CHANCE = 0.15;
const RANDOM_BOOSTED_CHANCE = 0.35;

export const MOMENTS_AUTO_POSTED_EVENT = 'character-moment-posted';

const readNum = (key: string): number => {
    try { return Number(localStorage.getItem(key) || '0') || 0; } catch { return 0; }
};

const writeNum = (key: string, value: number) => {
    try { localStorage.setItem(key, String(value)); } catch { /* ignore */ }
};

const acquireRunLock = (now: number): boolean => {
    const last = readNum(RUN_LOCK_KEY);
    if (last && now - last < RUN_LOCK_MS) return false;
    writeNum(RUN_LOCK_KEY, now);
    return true;
};

const isBoostedTrigger = (trigger: string): boolean =>
    /life|offline|proactive|catchup|focus/i.test(trigger);

const shouldTryFixedChar = (char: CharacterProfile, now: number): boolean => {
    const setting = char.convoSettings?.momentsAutoPost;
    if (typeof setting !== 'number') return false;
    const last = readNum(`${LAST_KEY_PREFIX}${char.id}`);
    return now - last >= Math.max(1, setting) * 60 * 60 * 1000;
};

const shouldTryRandomChar = (char: CharacterProfile, trigger: string, now: number): boolean => {
    if (char.convoSettings?.momentsAutoPost !== 'random') return false;
    const lastPost = readNum(`${LAST_KEY_PREFIX}${char.id}`);
    if (now - lastPost < RANDOM_MIN_GAP_MS) return false;
    const lastRoll = readNum(`${ROLL_KEY_PREFIX}${char.id}`);
    if (now - lastRoll < RANDOM_MIN_GAP_MS) return false;

    writeNum(`${ROLL_KEY_PREFIX}${char.id}`, now);
    return Math.random() < (isBoostedTrigger(trigger) ? RANDOM_BOOSTED_CHANCE : RANDOM_NORMAL_CHANCE);
};

const selectCandidates = (
    characters: CharacterProfile[],
    userProfile: UserProfile,
    trigger: string,
    now: number,
    allowedIds: Set<string> | null,
): CharacterProfile[] => {
    const hideAmbientSocialRecords = shouldHideAmbientSocialRecordForUser(userProfile);
    const allowed = characters.filter(char => {
        const setting = char.convoSettings?.momentsAutoPost;
        return (!allowedIds || allowedIds.has(char.id))
            && (!hideAmbientSocialRecords || !isAmbientSocialCharacterForUser(char, userProfile))
            && !!setting
            && setting !== 'off';
    });
    const fixed = allowed.filter(char => shouldTryFixedChar(char, now)).slice(0, 2);
    if (fixed.length >= 2) return fixed;

    for (const char of allowed) {
        if (shouldTryRandomChar(char, trigger, now)) return [...fixed, char];
    }
    return fixed;
};

const recentLifeLine = async (charId: string): Promise<string> => {
    try {
        const ev = (await DB.getLifeEvents(charId, 1))[0];
        if (!ev) return '';
        return [sanitizeLifeText(ev.activity), ev.mood ? sanitizeLifeText(ev.mood) : '', ev.location ? sanitizeLifeText(ev.location) : '']
            .filter(Boolean)
            .join(' · ');
    } catch {
        return '';
    }
};

const notifyMomentPosted = (post: SocialPost) => {
    if (typeof window === 'undefined' || post.authorType !== 'character' || !post.authorCharId) return;
    window.dispatchEvent(new CustomEvent(MOMENTS_AUTO_POSTED_EVENT, {
        detail: {
            charId: post.authorCharId,
            charName: post.authorName,
            body: (post.content || post.title || '发了一条此刻').replace(/\s+/g, ' ').trim().slice(0, 80) || '发了一条此刻',
            avatarUrl: post.authorAvatar,
            postId: post.id,
        },
    }));
};

export async function maybeRunMomentsAutoPost(params: {
    characters: CharacterProfile[];
    userProfile: UserProfile;
    apiConfig: APIConfig;
    auxApiConfig?: AuxApiConfig;
    trigger: string;
    charIds?: string[];
    now?: number;
}): Promise<SocialPost[]> {
    const now = params.now || Date.now();
    if (!acquireRunLock(now)) return [];
    const api = { ...params.apiConfig, ...resolveAuxApi(params.auxApiConfig, params.apiConfig) };
    if (!api.apiKey) return [];
    const allowedIds = params.charIds ? new Set(params.charIds) : null;
    const candidates = selectCandidates(params.characters, params.userProfile, params.trigger, now, allowedIds);
    if (candidates.length === 0) return [];

    const posts: SocialPost[] = [];
    for (const char of candidates) {
        try {
            const feed = await DB.getSocialPosts();
            const post = await generateAutoCharacterMoment({
                apiConfig: api,
                char,
                userProfile: params.userProfile,
                feed,
                trigger: params.trigger,
                recentLife: await recentLifeLine(char.id),
            });
            if (!post) continue;
            await DB.saveSocialPost(post);
            writeNum(`${LAST_KEY_PREFIX}${char.id}`, now);
            notifyMomentPosted(post);
            posts.push(post);
        } catch {
            // 主动此刻是锦上添花，失败不影响主动消息/离线补齐/启动。
        }
    }
    return posts;
}
