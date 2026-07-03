import { describe, it, expect } from 'vitest';
import { buildShopCompanionPrompt, parseShopCompanionReaction, parseShopCompanionScript, getShopItem } from './shop';

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
        expect(p.user).toContain('auto_user_pay');
        expect(p.user).toContain('steps');
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

    it('parseShopCompanionScript accepts multi-step immersive scripts', () => {
        const got = parseShopCompanionScript(JSON.stringify({
            steps: [
                { action: 'say', speech: '陪你看。' },
                { action: 'scroll_to_item', itemId: 'rose', speech: '往上看这个。' },
                { action: 'open_item', itemId: 'cake', speech: '点开看看。' },
                { action: 'auto_user_pay', itemId: 'rose', speech: '我替你点了。' },
            ],
        }));
        expect(got?.steps.map(s => s.action)).toEqual(['say', 'scroll_to_item', 'open_item', 'auto_user_pay']);
        expect(got?.steps[1].itemId).toBe('rose');
    });

    it('parseShopCompanionScript keeps old one-action JSON compatible', () => {
        const got = parseShopCompanionScript('{"action":"want","itemId":"rose","speech":"先记下来。"}');
        expect(got).toEqual({ steps: [{ action: 'want', itemId: 'rose', speech: '先记下来。' }] });
    });

    it('parseShopCompanionScript filters illegal item actions and downgrades unknown actions to say', () => {
        const got = parseShopCompanionScript(JSON.stringify({
            steps: [
                { action: 'scroll_to_item', itemId: 'missing', speech: '不存在。' },
                { action: 'dance', itemId: 'rose', speech: '这个好看。' },
            ],
        }));
        expect(got).toEqual({ steps: [{ action: 'say', itemId: 'rose', speech: '这个好看。' }] });
    });

    it('parseShopCompanionScript limits scripts to five validated steps', () => {
        const got = parseShopCompanionScript(JSON.stringify({
            steps: Array.from({ length: 8 }).map(() => ({ action: 'point', itemId: 'rose', speech: '看这个。' })),
        }));
        expect(got?.steps).toHaveLength(5);
    });
});
