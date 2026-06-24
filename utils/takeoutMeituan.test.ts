import { describe, it, expect } from 'vitest';
import { sortStores, filterStores, parseStorePromo, storePromoDiscount, bestRedpacket, getRedpacket, recommendStores, groupDishes } from './takeout';
import type { TakeoutStore } from '../types';

const mk = (over: Partial<TakeoutStore>): TakeoutStore => ({
    id: over.id || 's', name: over.name || '店', emoji: '🍔', category: '快餐',
    rating: 4.5, monthlySales: 500, deliveryMinutes: 30, deliveryFee: 3, minOrder: 20, distanceKm: 1.5,
    integrity: 0.9, dishes: [], ...over,
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
