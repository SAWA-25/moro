import type { APIConfig, AuxApiConfig, CharacterProfile, SocialPost, UserProfile } from '../types';
import { DB } from './db';
import { resolveAuxApi } from './auxApi';
import { generateAutoCharacterMoment } from '../components/moments/momentsGen';
import { sanitizeLifeText } from './autonomousLife';

const LAST_KEY_PREFIX = 'moro_moments_auto_last_v1_';
const RUN_LOCK_KEY = 'moro_moments_auto_lock_v1';
const RUN_LOCK_MS = 30 * 1000;
const RANDOM_MIN_GAP_MS = 6 * 60 * 60 * 1000;

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

const shouldTryChar = (char: CharacterProfile, trigger: string, now: number): boolean => {
    const setting = char.convoSettings?.momentsAutoPost;
    if (!setting || setting === 'off') return false;
    const last = readNum(`${LAST_KEY_PREFIX}${char.id}`);
    if (typeof setting === 'number') {
        return now - last >= Math.max(1, setting) * 60 * 60 * 1000;
    }
    if (now - last < RANDOM_MIN_GAP_MS) return false;
    const boosted = /life|offline|proactive|catchup|focus/i.test(trigger);
    return Math.random() < (boosted ? 0.45 : 0.22);
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
    const candidates = params.characters
        .filter(char => (!allowedIds || allowedIds.has(char.id)) && shouldTryChar(char, params.trigger, now))
        .slice(0, 2);
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
