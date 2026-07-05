import { describe, it, expect } from 'vitest';
import {
    makeOrder, getShopItem,
    orderTrace, orderStatusKey, orderStatusCounts,
    isItemReviewed, pendingReviewItems, makeUserReview, userReviewsForItem, goodRate,
    coinsToYuan, yuanToCoins, checkinAvailable, dailyCheckinReward, COIN_PER_YUAN,
    pushFootprint, resolveFootprints, itemSpecs,
    normalizeShopImageUrl, sanitizeShopItemDraft,
} from './shop';
import type { ShopOrder, ShopUserReview } from '../types';

const rose = getShopItem('rose')!;
const cake = getShopItem('cake')!;

const mkOrder = (over: Partial<ShopOrder> = {}): ShopOrder => ({
    ...makeOrder([{ item: rose, qty: 1 }, { item: cake, qty: 2 }], 'self'),
    ...over,
});

describe('custom item image URLs', () => {
    it('normalizes common copied image link formats', () => {
        expect(normalizeShopImageUrl('![](//cdn.example.com/a.png?x=1&amp;y=2)')).toBe('https://cdn.example.com/a.png?x=1&y=2');
        expect(normalizeShopImageUrl('<img src="https://example.com/a b.png?x=1&amp;y=2">')).toBe('https://example.com/a%20b.png?x=1&y=2');
        expect(normalizeShopImageUrl('background-image: url("https://example.com/gift.webp")')).toBe('https://example.com/gift.webp');
    });

    it('stores normalized image URLs on custom shop items', () => {
        const item = sanitizeShopItemDraft({
            name: 'Copy Link Gift',
            image: '<img src="//cdn.example.com/gift.jpg?from=shop&amp;size=large">',
        });
        expect(item?.image).toBe('https://cdn.example.com/gift.jpg?from=shop&size=large');
    });
});

describe('orderTrace 物流轨迹', () => {
    it('刚下单只有「已下单」节点，倒序最新在前', () => {
        const o = mkOrder({ placedAt: 1000, etaAt: 1000 + 60000 });
        const trace = orderTrace(o, 1000);
        expect(trace.length).toBe(1);
        expect(trace[0].key).toBe('placed');
        expect(trace[0].current).toBe(true);
    });
    it('随时间推进解锁更多节点', () => {
        const o = mkOrder({ placedAt: 0, etaAt: 100000 });
        expect(orderTrace(o, 50000).some(n => n.key === 'transit')).toBe(true);
        expect(orderTrace(o, 50000).some(n => n.key === 'delivering')).toBe(false);
    });
    it('已签收追加「已签收」节点且置顶', () => {
        const o = mkOrder({ placedAt: 0, etaAt: 100000, receivedAt: 120000 });
        const trace = orderTrace(o, 130000);
        expect(trace[0].key).toBe('received');
        expect(trace.some(n => n.key === 'arrived')).toBe(true);
    });
});

describe('订单状态归类', () => {
    const reviews: ShopUserReview[] = [];
    it('未收货=待收货；退款=退款；已收货未评=待评价；评完=完成', () => {
        const now = 10;
        expect(orderStatusKey(mkOrder({ receivedAt: undefined }), reviews, now)).toBe('toReceive');
        expect(orderStatusKey(mkOrder({ receivedAt: 5, refundedAt: 6 }), reviews, now)).toBe('refunded');
        const got = mkOrder({ id: 'o1', receivedAt: 5 });
        expect(orderStatusKey(got, reviews, now)).toBe('toReview');
        const allReviewed = [
            makeUserReview(rose.id, 'o1', 5, 'a'),
            makeUserReview(cake.id, 'o1', 4, 'b'),
        ];
        expect(orderStatusKey(got, allReviewed, now)).toBe('done');
    });
    it('orderStatusCounts 分桶计数', () => {
        const orders = [mkOrder({ receivedAt: undefined }), mkOrder({ receivedAt: 1, refundedAt: 2 })];
        const c = orderStatusCounts(orders, reviews);
        expect(c.toReceive).toBe(1);
        expect(c.refunded).toBe(1);
    });
});

describe('商品评价', () => {
    it('isItemReviewed / pendingReviewItems', () => {
        const o = mkOrder({ id: 'o9', receivedAt: 1 });
        expect(pendingReviewItems([o], []).length).toBe(2);
        const reviews = [makeUserReview(rose.id, 'o9', 5, '好')];
        expect(isItemReviewed(reviews, 'o9', rose.id)).toBe(true);
        expect(pendingReviewItems([o], reviews).length).toBe(1);
    });
    it('未收货/退款的订单不计入待评价', () => {
        expect(pendingReviewItems([mkOrder({ receivedAt: undefined })], []).length).toBe(0);
        expect(pendingReviewItems([mkOrder({ receivedAt: 1, refundedAt: 2 })], []).length).toBe(0);
    });
    it('makeUserReview clamp + userReviewsForItem 过滤', () => {
        const r = makeUserReview(rose.id, 'o1', 9, '  超好  ');
        expect(r.stars).toBe(5);
        expect(r.text).toBe('超好');
        const list = [r, makeUserReview(cake.id, 'o1', 3, 'x')];
        expect(userReviewsForItem(list, rose.id).length).toBe(1);
    });
    it('goodRate 好评率', () => {
        expect(goodRate([5, 4, 4, 1])).toBe(75);
        expect(goodRate([])).toBeGreaterThan(0);
    });
});

describe('淘金币 + 签到', () => {
    it('coinsToYuan：按比例且不超过实付 50%', () => {
        expect(coinsToYuan(500, 100)).toBeCloseTo(5, 2);       // 500币=5元，<50
        expect(coinsToYuan(100000, 10)).toBeCloseTo(5, 2);     // 上限=实付50%
        expect(yuanToCoins(3)).toBe(3 * COIN_PER_YUAN);
    });
    it('checkinAvailable 同一天只签一次', () => {
        const now = Date.parse('2026-06-24T10:00:00');
        expect(checkinAvailable(undefined, now)).toBe(true);
        expect(checkinAvailable(now - 1000, now)).toBe(false);
        expect(checkinAvailable(Date.parse('2026-06-23T23:00:00'), now)).toBe(true);
    });
    it('dailyCheckinReward 在 10~60 之间且当日稳定', () => {
        const now = Date.now();
        const r = dailyCheckinReward(now);
        expect(r).toBeGreaterThanOrEqual(10);
        expect(r).toBeLessThanOrEqual(60);
        expect(dailyCheckinReward(now)).toBe(r);
    });
});

describe('足迹 + 规格', () => {
    it('pushFootprint 去重置顶 + 限量', () => {
        let fp = pushFootprint(undefined, rose.id, 1);
        fp = pushFootprint(fp, cake.id, 2);
        fp = pushFootprint(fp, rose.id, 3);
        expect(fp[0].itemId).toBe(rose.id);
        expect(fp.length).toBe(2);
    });
    it('resolveFootprints 跳过未知商品', () => {
        const fp = [{ itemId: rose.id, at: 1 }, { itemId: 'nope', at: 2 }];
        expect(resolveFootprints(fp).length).toBe(1);
    });
    it('itemSpecs 给出 label + 选项', () => {
        const s = itemSpecs(rose);
        expect(s.opts.length).toBeGreaterThan(0);
        expect(typeof s.label).toBe('string');
    });
});
