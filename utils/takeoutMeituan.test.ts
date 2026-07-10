import { describe, it, expect } from 'vitest';
import {
    sortStores, filterStores, parseStorePromo, storePromoDiscount, bestRedpacket, getRedpacket, recommendStores, groupDishes,
    takeoutOrderBucket, filterTakeoutOrdersByBucket, takeoutOrderBucketCounts,
} from './takeout';
import type { TakeoutOrder, TakeoutStore } from '../types';

const mk = (over: Partial<TakeoutStore>): TakeoutStore => ({
    id: over.id || 's', name: over.name || '店', emoji: '🍔', category: '快餐',
    rating: 4.5, monthlySales: 500, deliveryMinutes: 30, deliveryFee: 3, minOrder: 20, distanceKm: 1.5,
    integrity: 0.9, dishes: [], ...over,
});

const mkOrder = (over: Partial<TakeoutOrder>): TakeoutOrder => ({
    id: over.id || 'o',
    storeId: over.storeId || 's',
    storeName: over.storeName || '店',
    storeEmoji: over.storeEmoji || '🍔',
    items: over.items || [{ dishId: 'd', name: '饭', price: 18, qty: 1 }],
    subtotal: over.subtotal ?? 18,
    deliveryFee: over.deliveryFee ?? 3,
    packFee: over.packFee ?? 1,
    total: over.total ?? 22,
    recipient: over.recipient || 'me',
    payer: over.payer || 'me',
    payStatus: over.payStatus || 'paid',
    status: over.status || 'preparing',
    riderName: over.riderName || '小袋',
    riderEmoji: over.riderEmoji || '🛵',
    address: over.address || '家',
    placedAt: over.placedAt ?? 1000,
    etaAt: over.etaAt ?? 2000,
    chat: over.chat || [],
    ...over,
});

describe('sortStores / filterStores', () => {
    const stores = [
        mk({ id: 'a', monthlySales: 100, rating: 4.2, distanceKm: 3, deliveryFee: 0, minOrder: 0, promo: '满30减5' }),
        mk({ id: 'b', monthlySales: 900, rating: 4.9, distanceKm: 1, deliveryFee: 5, minOrder: 20 }),
        mk({ id: 'c', monthlySales: 400, rating: 4.6, distanceKm: 2, deliveryFee: 3, minOrder: 0 }),
    ];
    it('销量/评分/距离排序', () => {
        expect(sortStores(stores, 'sales')[0].id).toBe('b');
        expect(sortStores(stores, 'rating')[0].id).toBe('b');
        expect(sortStores(stores, 'distance')[0].id).toBe('b');
    });
    it('筛选：免配送费 / 0起送 / 有优惠 / 好评', () => {
        expect(filterStores(stores, { freeDelivery: true }).map(s => s.id)).toEqual(['a']);
        expect(filterStores(stores, { zeroMinOrder: true }).map(s => s.id).sort()).toEqual(['a', 'c']);
        expect(filterStores(stores, { promoOnly: true }).map(s => s.id)).toEqual(['a']);
        expect(filterStores(stores, { goodOnly: true }).map(s => s.id).sort()).toEqual(['b', 'c']);
    });
});

describe('满减 + 平台红包', () => {
    it('parseStorePromo 解析满X减Y / 立减N', () => {
        expect(parseStorePromo('满30减5')).toEqual({ threshold: 30, discount: 5 });
        expect(parseStorePromo('新客立减8元')).toEqual({ threshold: 0, discount: 8 });
        expect(parseStorePromo('0元起送')).toBeNull();
    });
    it('storePromoDiscount 满足门槛才减、不超过小计', () => {
        expect(storePromoDiscount('满30减5', 20)).toBe(0);
        expect(storePromoDiscount('满30减5', 50)).toBe(5);
        expect(storePromoDiscount('立减8', 3)).toBe(3);
    });
    it('bestRedpacket 挑满足门槛里立减最多的', () => {
        expect(bestRedpacket(['t3', 't6', 't12'], 30)?.id).toBe('t3');
        expect(bestRedpacket(['t3', 't6', 't12'], 70)?.id).toBe('t12');
        expect(bestRedpacket(['t12'], 10)).toBeNull();
        expect(getRedpacket('tnew')?.discount).toBe(8);
    });
});

describe('recommendStores / groupDishes', () => {
    it('recommendStores 取前 count', () => {
        const stores = [mk({ id: 'a' }), mk({ id: 'b' }), mk({ id: 'c' })];
        expect(recommendStores(stores, 2).length).toBe(2);
    });
    it('groupDishes 招牌优先 + 主食/饮品分桶', () => {
        const dishes = [
            { id: '1', name: '招牌牛肉面', price: 18, popular: true },
            { id: '2', name: '可乐', price: 6 },
            { id: '3', name: '牛肉拉面', price: 20 },
        ];
        const groups = groupDishes(dishes as any);
        expect(groups[0].group).toBe('招牌');
        const names = groups.flatMap(g => g.dishes.map(d => d.name));
        expect(names).toContain('可乐');
        expect(groups.some(g => g.group === '饮品')).toBe(true);
    });
});

describe('订单中心分桶 / 首页推荐', () => {
    it('订单按实时状态进入对应 bucket，并能统计筛选', () => {
        const now = 10_000;
        const orders = [
            mkOrder({ id: 'active', status: 'delivering', placedAt: now - 1000, etaAt: now + 1000 }),
            mkOrder({ id: 'arrived', status: 'delivering', placedAt: now - 20 * 60_000, etaAt: now - 1 }),
            mkOrder({ id: 'review', status: 'delivered', deliveredAt: now - 100, review: undefined }),
            mkOrder({ id: 'done', status: 'delivered', deliveredAt: now - 100, review: { rating: 5, at: now - 50 } }),
            mkOrder({ id: 'issue', status: 'delivered', deliveredAt: now - 100, complaint: { filed: true, resolved: false, refunded: 0 } }),
            mkOrder({ id: 'cancelled', status: 'cancelled', cancelledByStore: true }),
        ];

        expect(takeoutOrderBucket(orders[0], now)).toBe('active');
        expect(takeoutOrderBucket(orders[1], now)).toBe('arrived');
        expect(takeoutOrderBucket(orders[2], now)).toBe('toReview');
        expect(takeoutOrderBucket(orders[3], now)).toBe('done');
        expect(takeoutOrderBucket(orders[4], now)).toBe('issue');
        expect(takeoutOrderBucket(orders[5], now)).toBe('issue');
        expect(filterTakeoutOrdersByBucket(orders, 'issue', now).map(o => o.id)).toEqual(['issue', 'cancelled']);
        expect(takeoutOrderBucketCounts(orders, now)).toMatchObject({ all: 6, active: 1, arrived: 1, toReview: 1, issue: 2, done: 1 });
    });

    it('推荐店铺数量稳定，平台红包选择不改变原满减逻辑', () => {
        const stores = [mk({ id: 'a', monthlySales: 10 }), mk({ id: 'b', monthlySales: 20 }), mk({ id: 'c', monthlySales: 30 })];
        expect(recommendStores(stores, 2).map(s => s.id)).toHaveLength(2);
        expect(bestRedpacket(['t3', 't6'], 35)?.discount).toBe(3);
        expect(storePromoDiscount('满30减5', 35)).toBe(5);
    });
});
