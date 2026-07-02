import type { CharacterProfile, SocialAudienceRoleRule, SocialAudienceRules, SocialPost } from '../types';

const DEFAULT_RULE: Required<SocialAudienceRoleRule> = {
    canView: false,
    canLike: false,
    canComment: false,
    canRepost: false,
    notify: false,
};

const PUBLIC_RULE: Required<SocialAudienceRoleRule> = {
    canView: true,
    canLike: true,
    canComment: true,
    canRepost: true,
    notify: false,
};

const ownPostRule = (base: Required<SocialAudienceRoleRule>): Required<SocialAudienceRoleRule> => ({
    ...base,
    canView: true,
    canLike: true,
    canComment: true,
    canRepost: true,
});

const cleanRule = (rule?: SocialAudienceRoleRule): Required<SocialAudienceRoleRule> => ({
    ...DEFAULT_RULE,
    ...(rule || {}),
});

export function normalizeMomentAudience(post: Pick<SocialPost, 'audienceRules' | 'visibility' | 'mentionedCharIds'>): SocialAudienceRules {
    if (post.audienceRules?.mode) {
        return {
            mode: post.audienceRules.mode,
            characters: { ...(post.audienceRules.characters || {}) },
        };
    }
    if (post.visibility === 'private') return { mode: 'private', characters: {} };
    const characters: Record<string, SocialAudienceRoleRule> = {};
    (post.mentionedCharIds || []).forEach(id => {
        if (!id) return;
        characters[id] = { ...(characters[id] || {}), notify: true };
    });
    return { mode: 'public', characters };
}

export function normalizeSocialPostForMoments<T extends SocialPost>(post: T): T {
    const audienceRules = normalizeMomentAudience(post);
    return {
        ...post,
        audienceRules,
        lastActivityAt: post.lastActivityAt || post.timestamp || Date.now(),
        unreadForUser: !!post.unreadForUser,
        source: post.source || 'legacy',
    };
}

export function getMomentCharacterRule(post: Pick<SocialPost, 'authorCharId' | 'audienceRules' | 'visibility' | 'mentionedCharIds'>, charId?: string): Required<SocialAudienceRoleRule> {
    if (!charId) return DEFAULT_RULE;
    const audience = normalizeMomentAudience(post);
    if (post.authorCharId && post.authorCharId === charId) return ownPostRule(audience.mode === 'private' ? DEFAULT_RULE : PUBLIC_RULE);
    if (audience.mode === 'private') return DEFAULT_RULE;
    if (audience.mode === 'public') {
        const explicit = cleanRule(audience.characters?.[charId]);
        return { ...PUBLIC_RULE, notify: explicit.notify };
    }
    return cleanRule(audience.characters?.[charId]);
}

export function canCharacterViewMoment(post: Pick<SocialPost, 'authorCharId' | 'audienceRules' | 'visibility' | 'mentionedCharIds'>, charId?: string): boolean {
    return getMomentCharacterRule(post, charId).canView;
}

export function canCharacterLikeMoment(post: Pick<SocialPost, 'authorCharId' | 'audienceRules' | 'visibility' | 'mentionedCharIds'>, charId?: string): boolean {
    return getMomentCharacterRule(post, charId).canLike;
}

export function canCharacterCommentMoment(post: Pick<SocialPost, 'authorCharId' | 'audienceRules' | 'visibility' | 'mentionedCharIds'>, charId?: string): boolean {
    return getMomentCharacterRule(post, charId).canComment;
}

export function canCharacterRepostMoment(post: Pick<SocialPost, 'authorCharId' | 'audienceRules' | 'visibility' | 'mentionedCharIds'>, charId?: string): boolean {
    return getMomentCharacterRule(post, charId).canRepost;
}

export function shouldNotifyCharacterForMoment(post: Pick<SocialPost, 'authorCharId' | 'audienceRules' | 'visibility' | 'mentionedCharIds'>, charId?: string): boolean {
    return getMomentCharacterRule(post, charId).notify;
}

export function canNpcAccessMoment(post: Pick<SocialPost, 'audienceRules' | 'visibility'>): boolean {
    const audience = normalizeMomentAudience(post as SocialPost);
    return audience.mode === 'public' && post.visibility !== 'private';
}

export function visibleMomentCharactersForPost(
    characters: CharacterProfile[],
    post: Pick<SocialPost, 'authorCharId' | 'audienceRules' | 'visibility' | 'mentionedCharIds'>,
    action: 'view' | 'like' | 'comment' | 'repost' = 'view',
): CharacterProfile[] {
    return characters.filter(char => {
        if (action === 'view') return canCharacterViewMoment(post, char.id);
        if (action === 'like') return canCharacterLikeMoment(post, char.id);
        if (action === 'comment') return canCharacterCommentMoment(post, char.id);
        return canCharacterRepostMoment(post, char.id);
    });
}

export function isCharacterMentionedByMoment(post: Pick<SocialPost, 'authorCharId' | 'audienceRules' | 'visibility' | 'mentionedCharIds'>, charId?: string): boolean {
    return shouldNotifyCharacterForMoment(post, charId);
}
