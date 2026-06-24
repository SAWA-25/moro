import { describe, it, expect } from 'vitest';
import { bestCoupon, applyCoupon, getCoupon, flashDeals, flashDealFor, flashEndsAt, recommendItems, SHOP_ITEMS } from './shop';

describe('coupons (满减)', () => {
    it('bestCoupon 挑满足门槛里立减最多的一张', () => {
        const claimed = ['c5', 'c10', 'c25'];
        expect(bestCoupon(claimed, 30)).toBeNull();          // 30 < 49 门槛
        expect(bestCoupon(claimed, 60)?.id).toBe('c5');       // 只够满49
        expect(bestCoupon(claimed, 250)?.id).toBe('c25');     // 满199减25 最优
    });
    it('applyCoupon 扣减且不为负', () => {
        expect(applyCoupon(60, getCoupon('c5')!)).toBe(55);
        expect(applyCoupon(60, null)).toBe(60);
        expect(applyCoupon(3, getCoupon('c5')!)).toBe(0);     // 不为负
    });
});

describe('flash sale (限时秒杀)', () => {
    it('flashDeals 确定性挑品 + 折扣价低于原价', () => {
        const now = 1_700_000_000_000;
        const a = flashDeals(SHOP_ITEMS, now, 4);
        const b = flashDeals(SHOP_ITEMS, now, 4);
        expect(a.map(x => x.item.id)).toEqual(b.map(x => x.item.id)); // 同一窗口稳定
        expect(a.length).toBe(4);
        a.forEach(d => { expect(d.dealPrice).toBeLessThan(d.item.price); expect(d.offPct).toBeGreaterThanOrEqual(20); });
    });
    it('flashDealFor 命中秒杀品返回秒杀价', () => {
        const now = 1_700_000_000_000;
        const first = flashDeals(SHOP_ITEMS, now, 4)[0];
        expect(flashDealFor(SHOP_ITEMS, first.item.id, now)?.dealPrice).toBe(first.dealPrice);
    });
    it('flashEndsAt 是下一个整点', () => {
        const now = 1_700_000_000_000;
        const end = flashEndsAt(now);
        expect(end).toBeGreaterThan(now);
        expect(end % (60 * 60 * 1000)).toBe(0);
    });
});

describe('recommendItems (猜你喜欢)', () => {
    it('收藏分类优先，去到 count 件', () => {
        const favRose = ['rose']; // flower 分类
        const rec = recommendItems(SHOP_ITEMS, favRose, 8);
        expect(rec.length).toBe(8);
        expect(rec[0].category).toBe('flower'); // 收藏分类被加权到前面
    });
    it('空目录安全', () => {
        expect(recommendItems([], [], 8)).toEqual([]);
    });
});
