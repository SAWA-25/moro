import { describe, expect, it } from 'vitest';
import type { SocialPost } from '../types';
import {
    canCharacterCommentMoment,
    canCharacterRepostMoment,
    canCharacterViewMoment,
    canNpcAccessMoment,
    normalizeMomentAudience,
    shouldNotifyCharacterForMoment,
} from './momentsAccess';

const basePost = (patch: Partial<SocialPost> = {}): SocialPost => ({
    id: 'p1',
    authorName: 'User',
    authorAvatar: '',
    title: '',
    content: 'hello',
    images: [],
    likes: 0,
    isCollected: false,
    isLiked: false,
    comments: [],
    timestamp: 1,
    tags: [],
    authorType: 'user',
    visibility: 'public',
    ...patch,
});

describe('moments access rules', () => {
    it('keeps legacy public/private visibility compatible', () => {
        expect(canCharacterViewMoment(basePost(), 'c1')).toBe(true);
        expect(canCharacterCommentMoment(basePost(), 'c1')).toBe(true);
        expect(canNpcAccessMoment(basePost())).toBe(true);

        const privatePost = basePost({ visibility: 'private' });
        expect(canCharacterViewMoment(privatePost, 'c1')).toBe(false);
        expect(canNpcAccessMoment(privatePost)).toBe(false);
    });

    it('honors per-character permissions in custom mode', () => {
        const post = basePost({
            audienceRules: {
                mode: 'custom',
                characters: {
                    c1: { canView: true, canComment: true, canRepost: false, notify: true },
                    c2: { canView: true, canComment: false, canRepost: true },
                },
            },
        });

        expect(canCharacterViewMoment(post, 'c1')).toBe(true);
        expect(canCharacterCommentMoment(post, 'c1')).toBe(true);
        expect(canCharacterRepostMoment(post, 'c1')).toBe(false);
        expect(shouldNotifyCharacterForMoment(post, 'c1')).toBe(true);
        expect(canCharacterCommentMoment(post, 'c2')).toBe(false);
        expect(canCharacterRepostMoment(post, 'c2')).toBe(true);
        expect(canCharacterViewMoment(post, 'c3')).toBe(false);
        expect(canNpcAccessMoment(post)).toBe(false);
    });

    it('maps legacy mentionedCharIds to notify without restricting public visibility', () => {
        const post = basePost({ mentionedCharIds: ['c1'] });
        const audience = normalizeMomentAudience(post);

        expect(audience.mode).toBe('public');
        expect(shouldNotifyCharacterForMoment(post, 'c1')).toBe(true);
        expect(canCharacterViewMoment(post, 'c2')).toBe(true);
        expect(shouldNotifyCharacterForMoment(post, 'c2')).toBe(false);
    });
});
