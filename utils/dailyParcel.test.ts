import { describe, expect, it } from 'vitest';
import { fallbackCharacterParcelDraft, inferParcelEmoji, makeDailyParcelMeta } from './dailyParcel';
import type { CharacterProfile } from '../types';

describe('daily parcel helpers', () => {
    it('keeps parcel metadata lightweight and independent from shop receipts', () => {
        const meta = makeDailyParcelMeta({
            direction: 'user_to_char',
            senderRole: 'user',
            fromName: '用户',
            toName: '小莫',
            itemName: '  热饮  ',
            note: '  趁热喝  ',
            method: '同城跑腿',
        });

        expect(meta.itemName).toBe('热饮');
        expect(meta.emoji).toBe('☕');
        expect(meta.note).toBe('趁热喝');
        expect(meta.generatedBy).toBe('user');
        expect(meta).not.toHaveProperty('price');
        expect(meta).not.toHaveProperty('orderId');
    });

    it('uses user hints for fallback character parcels', () => {
        const char = { id: 'char-a', name: '小莫' } as CharacterProfile;
        const draft = fallbackCharacterParcelDraft(char, '用户', '一本小书');

        expect(draft.itemName).toBe('一本小书');
        expect(draft.emoji).toBe('📖');
        expect(draft.generatedBy).toBe('fallback');
    });

    it('builds travel-frog style received parcels with an origin trace', () => {
        const char = { id: 'char-a', name: '小莫' } as CharacterProfile;
        const draft = fallbackCharacterParcelDraft(char, '用户', undefined, 'travel_frog');
        const meta = makeDailyParcelMeta({
            direction: 'char_to_user',
            mode: 'travel_frog',
            senderRole: 'char',
            fromName: '小莫',
            toName: '用户',
            itemName: draft.itemName,
            emoji: draft.emoji,
            method: draft.method,
            originLabel: draft.originLabel,
            travelSnippet: draft.travelSnippet,
            note: draft.note,
        });

        expect(meta.mode).toBe('travel_frog');
        expect(meta.originLabel).toBeTruthy();
        expect(meta.travelSnippet).toContain('寄给你');
        expect(meta).not.toHaveProperty('price');
        expect(meta).not.toHaveProperty('orderId');
    });

    it('builds proactive character parcels as character-initiated gifts', () => {
        const char = { id: 'char-a', name: '小莫' } as CharacterProfile;
        const draft = fallbackCharacterParcelDraft(char, '用户', undefined, 'proactive');
        const meta = makeDailyParcelMeta({
            direction: 'char_to_user',
            mode: 'proactive',
            senderRole: 'char',
            fromName: '小莫',
            toName: '用户',
            itemName: draft.itemName,
            emoji: draft.emoji,
            method: draft.method,
            note: draft.note,
        });

        expect(meta.mode).toBe('proactive');
        expect(meta.senderRole).toBe('char');
        expect(meta.note).toContain('突然想到你');
    });

    it('infers everyday item emojis', () => {
        expect(inferParcelEmoji('手写便签')).toBe('📝');
        expect(inferParcelEmoji('雨伞')).toBe('🌂');
        expect(inferParcelEmoji('风景明信片')).toBe('🏞️');
    });
});
