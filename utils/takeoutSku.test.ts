import { describe, it, expect, beforeEach } from 'vitest';
import {
    deriveDishOptions, decorateDishes, dishHasOptions, dishUnitPrice, formatSpecAddon, cartLineKey,
    getSearchHistory, pushSearchHistory, clearSearchHistory,
    getAddresses, addAddress, removeAddress,
    deliveryTimeSlots, TAKEOUT_HOT_SEARCHES,
} from './takeout';
import type { TakeoutDish } from '../types';

describe('菜品规格 / 加料（选规格）', () => {
    it('饮品给甜度/冰量；奶茶额外有加料', () => {
        const tea = deriveDishOptions('茉莉奶绿');
        expect(tea.specs?.map(s => s.name)).toEqual(['甜度', '冰量']);
        expect((tea.addons || []).length).toBeGreaterThan(0);
        const cola = deriveDishOptions('冰可乐');
        expect(cola.specs?.map(s => s.name)).toEqual(['甜度', '冰量']);
        expect(cola.addons).toBeUndefined(); // 可乐不是奶茶，无小料
    });
    it('饭/面给份量；带辣字再加辣度，并有加料', () => {
        const rice = deriveDishOptions('青椒肉丝饭');
        expect(rice.specs?.some(s => s.name === '份量')).toBe(true);
        expect((rice.addons || []).length).toBeGreaterThan(0);
        const spicy = deriveDishOptions('麻辣牛肉面');
        expect(spicy.specs?.map(s => s.name)).toContain('辣度');
        expect(spicy.specs?.map(s => s.name)).toContain('份量');
    });
    it('麻辣烫/串给辣度+加料；普通汤无规格', () => {
        const ht = deriveDishOptions('招牌麻辣烫');
        expect(ht.specs?.map(s => s.name)).toEqual(['辣度']);
        expect((ht.addons || []).length).toBeGreaterThan(0);
        expect(deriveDishOptions('紫菜蛋花汤')).toEqual({});
    });
    it('decorateDishes 挂上规格/加料 + 菜品月售', () => {
        const dishes: TakeoutDish[] = [
            { id: '1', name: '黄焖鸡米饭', price: 20, popular: true },
            { id: '2', name: '例汤', price: 4 },
        ];
        const out = decorateDishes(dishes, 1000);
        expect(dishHasOptions(out[0])).toBe(true);
        expect(dishHasOptions(out[1])).toBe(false);
        expect(out[0].monthlySales).toBeGreaterThan(0);
    });
});

describe('SKU 定价 / 描述 / 行 key', () => {
    const specs = [
        { name: '份量', options: [{ label: '标准份', priceDelta: 0 }, { label: '大份', priceDelta: 5 }] },
        { name: '辣度', options: [{ label: '不辣', priceDelta: 0 }, { label: '微辣', priceDelta: 0 }] },
    ];
    const addons = [{ label: '加蛋', price: 2 }, { label: '加肠', price: 3 }];
    it('dishUnitPrice 叠加规格差价与加料', () => {
        expect(dishUnitPrice(20, specs, { 份量: '标准份', 辣度: '不辣' }, addons, [])).toBe(20);
        expect(dishUnitPrice(20, specs, { 份量: '大份', 辣度: '微辣' }, addons, ['加蛋', '加肠'])).toBe(30);
    });
    it('formatSpecAddon 过滤默认项（标准份/不辣等）', () => {
        expect(formatSpecAddon(specs, { 份量: '标准份', 辣度: '不辣' }, [])).toEqual({ spec: undefined, addons: undefined });
        expect(formatSpecAddon(specs, { 份量: '大份', 辣度: '微辣' }, ['加蛋'])).toEqual({ spec: '大份·微辣', addons: ['加蛋'] });
    });
    it('cartLineKey 同菜不同规格分行；加料顺序无关', () => {
        expect(cartLineKey('d1', '大份', ['加蛋'])).not.toBe(cartLineKey('d1', '标准份', ['加蛋']));
        expect(cartLineKey('d1', '大份', ['加蛋', '加肠'])).toBe(cartLineKey('d1', '大份', ['加肠', '加蛋']));
    });
});

describe('搜索历史 + 热门搜索', () => {
    beforeEach(() => clearSearchHistory());
    it('热门搜索非空', () => expect(TAKEOUT_HOT_SEARCHES.length).toBeGreaterThan(4));
    it('pushSearchHistory 去重置顶、上限 10、空串忽略', () => {
        pushSearchHistory('炸鸡');
        pushSearchHistory('奶茶');
        pushSearchHistory('炸鸡'); // 置顶
        expect(getSearchHistory()).toEqual(['炸鸡', '奶茶']);
        expect(pushSearchHistory('  ')).toEqual(['炸鸡', '奶茶']);
        for (let i = 0; i < 15; i++) pushSearchHistory('词' + i);
        expect(getSearchHistory().length).toBe(10);
    });
});

describe('收货地址簿', () => {
    beforeEach(() => { localStorage.removeItem('moro_takeout_addresses_v1'); localStorage.removeItem('moro_takeout_address'); });
    it('默认有一条；新增置顶去重；删除不会清空到 0', () => {
        expect(getAddresses().length).toBe(1);
        addAddress('公司 A 座 1801');
        addAddress('城南花园 3 栋 502');
        addAddress('公司 A 座 1801'); // 置顶去重
        expect(getAddresses()[0]).toBe('公司 A 座 1801');
        const all = getAddresses();
        let cur = all;
        for (const a of all) cur = removeAddress(a);
        expect(cur.length).toBeGreaterThanOrEqual(1); // 永远兜底一条
    });
});

describe('预约送达时段', () => {
    it('第一项是尽快(null)，其余是 HH:MM 时间点', () => {
        const slots = deliveryTimeSlots(30, new Date('2026-06-24T12:05:00').getTime());
        expect(slots[0]).toEqual({ label: '尽快送达', at: null });
        expect(slots.length).toBe(7);
        expect(slots[1].label).toMatch(/^\d{2}:\d{2}$/);
        expect(slots[1].at).toBeGreaterThan(0);
    });
});
