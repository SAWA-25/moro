import { describe, it, expect, beforeEach } from 'vitest';
import {
    deriveDishOptions, decorateDishes, dishHasOptions, dishUnitPrice, formatSpecAddon, cartLineKey,
    getSearchHistory, pushSearchHistory, clearSearchHistory,
    getAddresses, addAddress, removeAddress,
    deliveryTimeSlots, effectiveTakeoutEtaAt, MIN_TAKEOUT_DELIVERY_MS, TAKEOUT_HOT_SEARCHES,
    getAddressCards, saveAddressCard, deleteAddressCard, setDefaultAddressCard, getDefaultAddressCard,
    formatAddressCard, getDefaultTakeoutAddressLine, ensureCharacterAddressSeeds,
    TAKEOUT_TASTE_TAGS, getTasteProfile, getTasteTags, saveTasteProfile, toggleTasteTag, buildTasteNote, mergeNoteWithTaste,
    recommendAddOnDishes, takeoutHistoryStats,
    sanitizeTakeoutDish, saveCustomDish, getCustomDishes, deleteCustomDish,
    saveCustomStore, getCustomStores, deleteCustomStore, mergeCustomStores, cloneDishForStore,
    getTakeoutMemberState, addTakeoutMemberPoints, takeoutMemberLevel, takeoutDailyCheckin, canTakeoutDailyCheckin,
    getTakeoutFootprints, pushTakeoutFootprint, clearTakeoutFootprints,
    getTakeoutSavedCarts, saveTakeoutSavedCart, deleteTakeoutSavedCart, clearTakeoutSavedCarts,
} from './takeout';
import type { CharacterProfile, TakeoutDish, TakeoutOrder, TakeoutReview, TakeoutStore } from '../types';

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
        expect(dishUnitPrice(0, undefined, {}, undefined, [])).toBe(0);
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

describe('自定义菜库 / 我的铺子', () => {
    beforeEach(() => {
        localStorage.removeItem('moro_takeout_custom_dishes_v1');
        localStorage.removeItem('moro_takeout_custom_stores_v1');
    });

    it('自定义菜保存时清洗字段、去重并可删除', () => {
        const saved = saveCustomDish({
            id: 'dish-custom',
            name: '  手写牛肉饭  ',
            price: -8,
            emoji: '🍚',
            specs: [{ name: '  份量  ', options: [{ label: '大份', priceDelta: -3 }, { label: '', priceDelta: 9 }] }],
            addons: [{ label: '加蛋', price: -2 }],
        })!;
        expect(saved.name).toBe('手写牛肉饭');
        expect(saved.price).toBe(0);
        expect(saved.specs?.[0].name).toBe('份量');
        expect(saved.specs?.[0].options).toEqual([{ label: '大份', priceDelta: 0 }]);
        expect(saved.addons).toEqual([{ label: '加蛋', price: 0 }]);

        saveCustomDish({ ...saved, price: 18 });
        expect(getCustomDishes()).toHaveLength(1);
        expect(getCustomDishes()[0].price).toBe(18);
        expect(deleteCustomDish(saved.id)).toEqual([]);
    });

    it('空菜名和坏 JSON 安全回退', () => {
        expect(sanitizeTakeoutDish({ name: ' ', price: 12 })).toBeNull();
        localStorage.setItem('moro_takeout_custom_dishes_v1', '{bad json');
        localStorage.setItem('moro_takeout_custom_stores_v1', '{bad json');
        expect(getCustomDishes()).toEqual([]);
        expect(getCustomStores()).toEqual([]);
    });

    it('自定义铺子会覆盖同 id 店铺，并在换街后保留', () => {
        const base: TakeoutStore = {
            id: 'store-base', name: '旧铺子', emoji: '🍜', category: '中餐',
            rating: 4.5, monthlySales: 100, deliveryMinutes: 30, deliveryFee: 3,
            minOrder: 20, distanceKm: 1.2, dishes: [{ id: 'd1', name: '面', price: 12 }],
        };
        const edited = saveCustomStore({ ...base, name: '改过的铺子', deliveryFee: -1 })!;
        const mine = saveCustomStore({ ...base, id: 'store-mine', name: '我的铺子', userCustom: true })!;
        const merged = mergeCustomStores([base]);
        expect(merged[0].id).toBe(mine.id);
        expect(merged.find(s => s.id === base.id)?.name).toBe(edited.name);
        expect(merged.find(s => s.id === base.id)?.deliveryFee).toBe(0);
        expect(deleteCustomStore(mine.id).map(s => s.id)).toEqual([base.id]);
    });

    it('从菜库加入店铺会复制新菜品锚', () => {
        const dish = saveCustomDish({ id: 'lib-dish', name: '库里的粥', price: 0, specs: [{ name: '温度', options: [{ label: '热', priceDelta: 0 }] }] })!;
        const cloned = cloneDishForStore(dish);
        expect(cloned.id).not.toBe(dish.id);
        expect(cloned.libraryDishId).toBe(dish.id);
        expect(cloned.price).toBe(0);
        expect(dishUnitPrice(cloned.price, cloned.specs, { 温度: '热' }, cloned.addons, [])).toBe(0);
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
    beforeEach(() => { localStorage.removeItem('moro_takeout_address_cards_v1'); localStorage.removeItem('moro_takeout_addresses_v1'); localStorage.removeItem('moro_takeout_address'); });
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

describe('结构化地址卡', () => {
    beforeEach(() => { localStorage.removeItem('moro_takeout_address_cards_v1'); localStorage.removeItem('moro_takeout_addresses_v1'); localStorage.removeItem('moro_takeout_address'); });
    it('把旧字符串地址迁移为用户地址卡，并保留旧单地址兜底', () => {
        localStorage.setItem('moro_takeout_addresses_v1', JSON.stringify(['公司 A 座 1801', '城南花园 3 栋 502']));
        localStorage.setItem('moro_takeout_address', '家属院 2 栋 301');
        const cards = getAddressCards('me');
        expect(cards.map(c => c.addressLine)).toEqual(['家属院 2 栋 301', '公司 A 座 1801', '城南花园 3 栋 502']);
        expect(cards[0].isDefault).toBe(true);
    });
    it('同一归属下只有一个默认地址；删除默认后自动选下一张', () => {
        const a = saveAddressCard({ ownerType: 'me', label: '家', tag: '家', receiverName: '我', addressLine: '城南花园', isDefault: true });
        const b = saveAddressCard({ ownerType: 'me', label: '公司', tag: '公司', receiverName: '我', addressLine: '公司 A 座', isDefault: true });
        expect(getDefaultAddressCard('me')?.id).toBe(b.id);
        expect(getAddressCards('me').filter(c => c.isDefault)).toHaveLength(1);
        deleteAddressCard(b.id);
        expect(getDefaultAddressCard('me')?.id).toBe(a.id);
    });
    it('用户地址与角色地址隔离，并能生成角色默认地址', () => {
        saveAddressCard({ ownerType: 'me', label: '家', tag: '家', receiverName: '我', addressLine: '我的家', isDefault: true });
        saveAddressCard({ ownerType: 'char', ownerId: 'c1', label: '学校', tag: '学校', receiverName: '阿月', addressLine: '图书馆门口', isDefault: true });
        expect(getAddressCards('me')).toHaveLength(1);
        expect(getAddressCards('char', 'c1')[0].addressLine).toBe('图书馆门口');
        const char = { id: 'c2', name: '小林', cityConfig: { mode: 'real', realCity: '成都' } } as CharacterProfile;
        ensureCharacterAddressSeeds([char]);
        expect(getDefaultAddressCard('char', 'c2')?.addressLine).toContain('小林');
        expect(getDefaultAddressCard('char', 'c2')?.city).toBe('成都');
    });
    it('格式化地址稳定，可作为订单快照；无地址时回退默认地址', () => {
        const card = saveAddressCard({
            ownerType: 'me',
            label: '家',
            tag: '家',
            receiverName: '我',
            contactHint: '门禁 1234',
            city: '上海',
            addressLine: '梧桐路 88 号',
            doorplate: '3 栋 502',
            deliveryNote: '放门口',
            isDefault: true,
        });
        expect(formatAddressCard(card)).toBe('家 · 上海 梧桐路 88 号 3 栋 502 · 门禁 1234（放门口）');
        expect(getDefaultTakeoutAddressLine()).toBe(formatAddressCard(card));
        deleteAddressCard(card.id);
        expect(getDefaultTakeoutAddressLine()).toBe('城南花园 3 栋 502');
    });
    it('可以显式设置默认地址', () => {
        const a = saveAddressCard({ ownerType: 'me', label: '家', tag: '家', receiverName: '我', addressLine: '家', isDefault: true });
        const b = saveAddressCard({ ownerType: 'me', label: '公司', tag: '公司', receiverName: '我', addressLine: '公司' });
        expect(getDefaultAddressCard('me')?.id).toBe(a.id);
        setDefaultAddressCard(b.id);
        expect(getDefaultAddressCard('me')?.id).toBe(b.id);
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

    it('有效 ETA 会兜底尽快送达的最短时间，但尊重更晚的预约时间', () => {
        const now = new Date('2026-06-24T12:05:00').getTime();
        const slots = deliveryTimeSlots(1, now);
        const soon = effectiveTakeoutEtaAt({ placedAt: now, etaAt: now + 60_000 });
        expect(soon).toBe(now + MIN_TAKEOUT_DELIVERY_MS);

        const scheduled = effectiveTakeoutEtaAt({ placedAt: now, etaAt: slots[1].at!, scheduledAt: slots[1].at! });
        expect(scheduled).toBe(slots[1].at);
    });
});

describe('口味小纸条', () => {
    beforeEach(() => { localStorage.removeItem('moro_takeout_taste_profiles_v1'); });
    it('按收货对象保存、切换偏好，并过滤未知标签', () => {
        expect(TAKEOUT_TASTE_TAGS).toContain('不要香菜');
        expect(TAKEOUT_TASTE_TAGS).toContain('海鲜过敏');
        expect(getTasteTags('me')).toEqual([]);
        expect(toggleTasteTag('me', '不要香菜')).toEqual(['不要香菜']);
        expect(toggleTasteTag('char-a', '少辣')).toEqual(['少辣']);
        expect(getTasteTags('me')).toEqual(['不要香菜']);
        expect(toggleTasteTag('me', '不存在')).toEqual(['不要香菜']);
        expect(toggleTasteTag('me', '不要香菜')).toEqual([]);
    });
    it('兼容旧数组格式，并能保存自由文本忌口', () => {
        localStorage.setItem('moro_takeout_taste_profiles_v1', JSON.stringify({ me: ['少辣', '少糖', '不存在'] }));
        expect(getTasteProfile('me')).toEqual({ tags: ['少辣', '少糖'] });
        const saved = saveTasteProfile('me', { tags: ['海鲜过敏', '控糖'], note: '芒果过敏，不吃葱蒜。' });
        expect(saved.tags).toEqual(['海鲜过敏', '控糖']);
        expect(saved.note).toBe('芒果过敏，不吃葱蒜。');
        expect(getTasteTags('me')).toEqual(['海鲜过敏', '控糖']);
    });
    it('合并备注时不重复已有偏好', () => {
        expect(buildTasteNote(['少辣', '少辣', '少油'])).toBe('口味偏好：少辣、少油');
        expect(mergeNoteWithTaste('放门口；少辣', ['少辣', '少油'])).toBe('放门口；少辣；口味偏好：少油');
        expect(mergeNoteWithTaste('', ['热饮'])).toBe('口味偏好：热饮');
        expect(buildTasteNote({ tags: ['海鲜过敏'], note: '芒果过敏' })).toBe('口味偏好：海鲜过敏；其它忌口/过敏：芒果过敏');
        expect(mergeNoteWithTaste('芒果过敏', { tags: ['海鲜过敏'], note: '芒果过敏' })).toBe('芒果过敏；口味偏好：海鲜过敏');
    });
});

describe('凑单小帮手 / 饭票统计', () => {
    const dishes: TakeoutDish[] = [
        { id: 'tea', name: '柠檬茶', price: 9, monthlySales: 300 },
        { id: 'rice', name: '牛肉饭', price: 24, monthlySales: 500, popular: true },
        { id: 'egg', name: '卤蛋', price: 3, monthlySales: 120 },
        { id: 'soup', name: '例汤', price: 6, monthlySales: 80 },
    ];
    it('优先推荐能补齐差额且未选过的菜', () => {
        const out = recommendAddOnDishes(dishes, ['rice'], 7, 2);
        expect(out.map(d => d.id)).toContain('tea');
        expect(out.some(d => d.id === 'rice')).toBe(false);
    });
    it('统计本月张数、金额和常点', () => {
        const now = new Date('2026-07-03T12:00:00').getTime();
        const orders: TakeoutOrder[] = [
            { id: '1', storeId: 's', storeName: '面馆', storeEmoji: '🍜', items: [{ dishId: 'n', name: '牛肉面', price: 18, qty: 2 }], subtotal: 36, deliveryFee: 3, packFee: 2, total: 41, recipient: 'me', payer: 'me', payStatus: 'paid', status: 'delivered', riderName: '小袋', riderEmoji: '🛵', address: 'a', placedAt: now, etaAt: now, chat: [] },
            { id: '2', storeId: 's', storeName: '面馆', storeEmoji: '🍜', items: [{ dishId: 'n', name: '牛肉面', price: 18, qty: 1 }], subtotal: 18, deliveryFee: 3, packFee: 2, total: 23, recipient: 'me', payer: 'me', payStatus: 'paid', status: 'delivered', riderName: '小袋', riderEmoji: '🛵', address: 'a', placedAt: now - 1000, etaAt: now, chat: [] },
            { id: 'old', storeId: 's', storeName: '旧店', storeEmoji: '🍔', items: [], subtotal: 0, deliveryFee: 0, packFee: 0, total: 99, recipient: 'me', payer: 'me', payStatus: 'paid', status: 'delivered', riderName: '小袋', riderEmoji: '🛵', address: 'a', placedAt: new Date('2026-06-01T12:00:00').getTime(), etaAt: now, chat: [] },
        ];
        const stats = takeoutHistoryStats(orders, now);
        expect(stats.monthCount).toBe(2);
        expect(stats.monthTotal).toBe(64);
        expect(stats.topStore).toEqual({ name: '面馆', count: 2 });
        expect(stats.topDish).toEqual({ name: '牛肉面', count: 3 });
    });
});

describe('会员积分 / 足迹 / 饭篮草稿', () => {
    beforeEach(() => {
        localStorage.removeItem('moro_takeout_member_v1');
        clearTakeoutFootprints();
        clearTakeoutSavedCarts();
    });

    it('会员积分清洗、升级，并且每日签到一天只领一次', () => {
        expect(getTakeoutMemberState()).toEqual({ points: 0 });
        expect(takeoutMemberLevel(181).title).toBe('饭票熟客');
        expect(addTakeoutMemberPoints(75).points).toBe(75);

        const now = new Date('2026-07-10T09:00:00').getTime();
        expect(canTakeoutDailyCheckin(getTakeoutMemberState(), now)).toBe(true);
        expect(takeoutDailyCheckin(now, 8).points).toBe(83);
        expect(canTakeoutDailyCheckin(getTakeoutMemberState(), now + 60_000)).toBe(false);
        expect(takeoutDailyCheckin(now + 60_000, 8).points).toBe(83);
        expect(canTakeoutDailyCheckin(getTakeoutMemberState(), new Date('2026-07-11T09:00:00').getTime())).toBe(true);
    });

    it('足迹按店铺去重置顶，并限制坏数据', () => {
        pushTakeoutFootprint({ id: 's1', name: '面馆', emoji: '🍜', category: '中餐' }, 100);
        pushTakeoutFootprint({ id: 's2', name: '茶铺', emoji: '🧋', category: '饮品' }, 200);
        pushTakeoutFootprint({ id: 's1', name: '面馆新名', emoji: '🍜', category: '中餐' }, 300);

        expect(getTakeoutFootprints().map(f => [f.storeId, f.storeName, f.at])).toEqual([
            ['s1', '面馆新名', 300],
            ['s2', '茶铺', 200],
        ]);
        localStorage.setItem('moro_takeout_footprints_v1', JSON.stringify([{ storeId: '', storeName: '坏', at: 1 }, { storeId: 'ok', storeName: '好店', at: 2 }]));
        expect(getTakeoutFootprints()).toHaveLength(1);
    });

    it('饭篮草稿会清洗条目、可覆盖保存和删除', () => {
        const saved = saveTakeoutSavedCart({
            id: 'cart-1',
            storeId: 's1',
            storeName: '面馆',
            storeEmoji: '🍜',
            recipient: '我',
            payer: 'me',
            note: '少辣',
            items: [
                { dishId: 'n', name: '牛肉面', price: 18, qty: 2, emoji: '🍜', spec: '大份', addons: ['加蛋'] },
                { dishId: '', name: '坏条目', price: 1, qty: 1 },
            ],
        });
        expect(saved?.subtotal).toBe(36);
        expect(saved?.items).toHaveLength(1);
        saveTakeoutSavedCart({ ...saved!, items: [{ dishId: 'n', name: '牛肉面', price: 20, qty: 1 }] });
        expect(getTakeoutSavedCarts()).toHaveLength(1);
        expect(getTakeoutSavedCarts()[0].subtotal).toBe(20);
        expect(deleteTakeoutSavedCart('cart-1')).toEqual([]);
    });
});

describe('评价扩展兼容', () => {
    it('旧评价不需要配送/包装字段，新评价可带服务标签', () => {
        const oldReview: TakeoutReview = { rating: 5, text: '好吃', at: 100 };
        const newReview: TakeoutReview = {
            rating: 4,
            riderRating: 5,
            packingRating: 3,
            text: '送得快，汤稍微洒了',
            tags: ['送得快'],
            serviceTags: ['准时达', '包装严实'],
            at: 200,
        };
        expect(oldReview.riderRating).toBeUndefined();
        expect(newReview.serviceTags).toEqual(['准时达', '包装严实']);
    });
});
