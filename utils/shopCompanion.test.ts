import { describe, it, expect } from 'vitest';
import { buildShopCompanionPrompt, parseShopCompanionReaction, getShopItem } from './shop';

describe('shop companion helpers', () => {
    it('buildShopCompanionPrompt includes surface, watched item, cart, and visible shelf', () => {
        const rose = getShopItem('rose')!;
        const cake = getShopItem('cake')!;
        const p = buildShopCompanionPrompt(
            { name: '阿白', personaText: '喜欢甜食', affection: 70 },
            '我',
            { surface: 'item', item: rose, visibleItems: [rose, cake], cart: [{ itemId: 'cake', qty: 2 }], userAction: '打开商品详情' },
        );
        expect(p.system).toContain('阿白');
        expect(p.user).toContain('当前界面：item');
        expect(p.user).toContain('rose');
        expect(p.user).toContain('草莓蛋糕×2');
        expect(p.user).toContain('char_pay');
    });

    it('parseShopCompanionReaction parses fenced JSON and validates item actions', () => {
        const got = parseShopCompanionReaction('```json\n{"action":"ask_user_pay","itemId":"rose","speech":"我想要这个。"}\n```');
        expect(got).toEqual({ action: 'ask_user_pay', itemId: 'rose', speech: '我想要这个。' });
        expect(parseShopCompanionReaction('{"action":"want","itemId":"missing","speech":"想要"}')).toBeNull();
    });

    it('parseShopCompanionReaction downgrades unknown actions to comment', () => {
        const got = parseShopCompanionReaction('{"action":"dance","itemId":"rose","speech":"这个好看。"}');
        expect(got).toEqual({ action: 'comment', itemId: 'rose', speech: '这个好看。' });
    });
});
