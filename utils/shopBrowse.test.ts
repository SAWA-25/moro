import { describe, it, expect } from 'vitest';
import { monthlySales, itemRating, getItemReviews, searchShopItems, formatSales, SHOP_ITEMS } from './shop';

describe('shop browse helpers (deterministic)', () => {
    it('monthlySales 稳定且在合理范围', () => {
        const a = monthlySales('rose');
        expect(a).toBe(monthlySales('rose'));      // 确定性
        expect(a).toBeGreaterThanOrEqual(20);
        expect(a).toBeLessThanOrEqual(9999);
        expect(monthlySales('nope')).toBe(0);       // 未知商品
    });

    it('便宜的卖得比贵的多（玫瑰 vs 拍立得）', () => {
        expect(monthlySales('rose')).toBeGreaterThan(monthlySales('camera'));
    });

    it('itemRating 在 4.6~5.0 且稳定', () => {
        const r = itemRating('cake');
        expect(r).toBe(itemRating('cake'));
        expect(r).toBeGreaterThanOrEqual(4.6);
        expect(r).toBeLessThanOrEqual(5.0);
    });

    it('getItemReviews 稳定，2~4 条，4/5 星', () => {
        const rv = getItemReviews('ring');
        expect(rv).toEqual(getItemReviews('ring'));
        expect(rv.length).toBeGreaterThanOrEqual(2);
        expect(rv.length).toBeLessThanOrEqual(4);
        rv.forEach(r => { expect([4, 5]).toContain(r.stars); expect(r.text.length).toBeGreaterThan(0); });
    });

    it('formatSales 万级格式化', () => {
        expect(formatSales(800)).toBe('800');
        expect(formatSales(12000)).toBe('1.2万');
    });

    it('searchShopItems 按名称/分类/空串匹配', () => {
        expect(searchShopItems('').length).toBe(SHOP_ITEMS.length);
        expect(searchShopItems('玫瑰').some(i => i.id === 'rose')).toBe(true);
        expect(searchShopItems('鲜花').some(i => i.category === 'flower')).toBe(true);
        expect(searchShopItems('zzz-not-found').length).toBe(0);
    });
});
