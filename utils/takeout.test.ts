import { describe, it, expect, beforeEach } from 'vitest';
import {
    effectiveTakeoutEtaAt,
    extractTakeoutOrderDirective,
    generateStores,
    generateStoreReviewsAI,
    getCustomDishes,
    inferTakeoutPreferenceHints,
    isTakeoutArrived,
    liveTakeoutStatus,
    MIN_TAKEOUT_DELIVERY_MS,
    PACK_FEE,
    resolveComplaint,
    rollOrderIssues,
    saveCustomDish,
    saveCustomStore,
    shouldAutoReactToCharTakeout,
    synthesizeCharOrder,
    synthesizeCharOrderSafely,
    takeoutChatForTarget,
    TAKEOUT_STORES_CACHE_KEY,
} from './takeout';
import type { TakeoutOrder, TakeoutOrderItem } from '../types';

describe('generateStoreReviewsAI fallback', () => {
    it('未配 API 时回退到算法版食评（非空、含好评有差评的可能）', async () => {
        const store = { name: '老地方家常菜', category: '中餐', rating: 3.4, warning: '多人反馈缺斤少两', dishes: [{ id: 'd', name: '盖饭', price: 18 }] } as any;
        const rv = await generateStoreReviewsAI({ baseUrl: '', apiKey: '', model: '' }, store, 8);
        expect(rv.length).toBeGreaterThan(0);
        rv.forEach(r => { expect(r.rating).toBeGreaterThanOrEqual(1); expect(r.rating).toBeLessThanOrEqual(5); expect(r.text.length).toBeGreaterThan(0); });
    });
});

const items: TakeoutOrderItem[] = [
    { dishId: 'd1', name: '招牌牛肉堡', price: 24, qty: 1 },
    { dishId: 'd2', name: '薯条', price: 12, qty: 2 },
];
const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);

const mkOrder = (over: Partial<TakeoutOrder>): TakeoutOrder => ({
    id: 'o1', storeId: 's1', storeName: '某店', storeEmoji: '🍔', items,
    subtotal, deliveryFee: 3, packFee: PACK_FEE, total: subtotal + 3 + PACK_FEE,
    recipient: 'me', payer: 'me', payStatus: 'paid', status: 'delivered',
    riderName: '小袋', riderEmoji: '🛵', address: '某地', placedAt: 0, etaAt: 1, chat: [],
    ...over,
});

describe('角色主动点外卖指令解析', () => {
    it('解析半角冒号指令并剥离正文里的标记', () => {
        const result = extractTakeoutOrderDirective('我给你点了点热的。\n[[TAKEOUT_ORDER: 鲜虾干贝软糯海鲜粥]]');
        expect(result.desc).toBe('鲜虾干贝软糯海鲜粥');
        expect(result.content).toBe('我给你点了点热的。');
    });

    it('解析全角冒号指令', () => {
        const result = extractTakeoutOrderDirective('先垫一口。\n[[TAKEOUT_ORDER：加蛋牛肉汤面]]');
        expect(result.desc).toBe('加蛋牛肉汤面');
        expect(result.content).toBe('先垫一口。');
    });

    it('只有指令时返回空正文但保留下单描述', () => {
        const result = extractTakeoutOrderDirective('[[TAKEOUT_ORDER: 皮蛋瘦肉粥]]');
        expect(result.desc).toBe('皮蛋瘦肉粥');
        expect(result.content).toBe('');
    });

    it('多条指令取第一条描述并剥掉全部标记', () => {
        const result = extractTakeoutOrderDirective('先吃这个。\n[[TAKEOUT_ORDER: 海鲜粥]]\n等会儿再喝点热的。\n[[TAKEOUT_ORDER: 热奶茶]]');
        expect(result.desc).toBe('海鲜粥');
        expect(result.content).toBe('先吃这个。\n\n等会儿再喝点热的。');
        expect(result.content).not.toContain('TAKEOUT_ORDER');
    });
});

describe('饭票通讯频道', () => {
    it('按跑腿 / 铺子频道过滤，旧顾客消息仍兼容显示', () => {
        const chat = [
            { role: 'user' as const, text: '旧消息', at: 1 },
            { role: 'user' as const, target: 'store' as const, text: '给铺子', at: 2 },
            { role: 'store' as const, target: 'store' as const, text: '铺子回', at: 3 },
            { role: 'user' as const, target: 'rider' as const, text: '给跑腿', at: 4 },
            { role: 'rider' as const, target: 'rider' as const, text: '跑腿回', at: 5 },
        ];

        expect(takeoutChatForTarget(chat, 'store').map(m => m.text)).toEqual(['旧消息', '给铺子', '铺子回']);
        expect(takeoutChatForTarget(chat, 'rider').map(m => m.text)).toEqual(['旧消息', '给跑腿', '跑腿回']);
    });
});

describe('角色主动点外卖偏好兜底', () => {
    const sweetFood = /奶茶|奶绿|奶昔|奶盖|波波|阿华田|焦糖|甘露|甜品|烘焙|蛋糕|提拉米苏|布朗尼|甜筒|冰淇淋|双皮奶|芋圆|烧仙草|绵绵冰|芝士挞|苹果派|糖水|可乐|雪碧|汽水|果蔬汁|酸奶|酸梅汤|冰镇西瓜|草莓|葡萄|芒果|红豆|脏脏包/;
    const spicyFood = /辣|麻辣|麻婆|椒|川|湘|泡椒|剁椒|水煮|口水鸡|小龙虾|螺蛳粉|串串|麻辣烫|火锅|酸辣|麦辣|热辣|宫保|黑椒/;
    const seafoodFood = /海鲜|虾|蟹|鱼|贝|蛤|蚝|鱿鱼|章鱼|三文鱼|鳗鱼|干贝|花甲|生蚝/;
    const dairyFood = /奶|芝士|奶油|酸奶|乳酪|奶茶|奶盖|奶昔|双皮奶|冰淇淋|提拉米苏|芝士挞/;

    beforeEach(() => {
        localStorage.removeItem('moro_takeout_custom_dishes_v1');
        localStorage.removeItem('moro_takeout_custom_stores_v1');
        localStorage.removeItem(TAKEOUT_STORES_CACHE_KEY);
        localStorage.removeItem('moro_takeout_taste_profiles_v1');
    });

    it('完整用户设定写了不喜欢甜时，本地合成会避开甜品奶茶', () => {
        for (let i = 0; i < 20; i++) {
            const order = synthesizeCharOrder('char-a', '热奶茶和草莓蛋糕', '测试地址', {
                fullUserSetting: '【完整用户设定】\n用户名：小夏\n【扮相手账自述】\n我不喜欢甜的，也不喝奶茶。',
            });
            const orderText = `${order.storeName} ${order.items.map(item => item.name).join(' ')}`;
            expect(order.note).toContain('不爱甜食');
            expect(orderText).not.toMatch(sweetFood);
        }
    });

    it('饭票口味小纸条写少糖时，会写入主动订单备注并避开过甜餐品', () => {
        const order = synthesizeCharOrder('char-a', '下午茶甜品', '测试地址', {
            tasteTags: ['少糖'],
            characterName: '阿迟',
            userName: '小夏',
        });
        const orderText = `${order.storeName} ${order.items.map(item => item.name).join(' ')}`;
        expect(order.note).toContain('少糖');
        expect(orderText).not.toMatch(sweetFood);
        expect(order.characterReceipt?.recipientNickname).toBe('小夏');
        expect(order.characterReceipt?.fromName).toBe('阿迟');
        expect(order.chat.some(m => m.role === 'user' && m.actorName === '阿迟' && m.target === 'store')).toBe(true);
        expect(takeoutChatForTarget(order.chat, 'store').every(m => m.role === 'user' ? !m.target || m.target === 'store' : m.role === 'store')).toBe(true);
        expect(takeoutChatForTarget(order.chat, 'rider').some(m => m.role === 'rider')).toBe(true);
    });

    it('用户同时写多种忌口时，会一起识别而不是只看糖', () => {
        const pref = inferTakeoutPreferenceHints({
            fullUserSetting: '我忌辣，不能吃辣，也不要香菜，平时口味清淡，海鲜过敏，乳糖不耐。',
            tasteProfile: { tags: ['少糖', '少油'], note: '花生过敏，不吃猪肉，不吃生冷。' },
        });
        expect(pref.avoidSweet).toBe(true);
        expect(pref.hardAvoidSpicy).toBe(true);
        expect(pref.avoidSpicy).toBe(true);
        expect(pref.avoidCilantro).toBe(true);
        expect(pref.avoidSeafood).toBe(true);
        expect(pref.avoidDairy).toBe(true);
        expect(pref.avoidNuts).toBe(true);
        expect(pref.avoidPork).toBe(true);
        expect(pref.avoidRawCold).toBe(true);
        expect(pref.lowOil).toBe(true);
    });

    it('喜欢辣和喜欢甜不会被误判成忌口', () => {
        const pref = inferTakeoutPreferenceHints({
            fullUserSetting: '我无辣不欢，喜欢甜口，不忌口。',
        });
        expect(pref.avoidSpicy).toBe(false);
        expect(pref.avoidSweet).toBe(false);
    });

    it('完整用户设定写了忌辣时，本地合成会避开辛辣餐品', () => {
        for (let i = 0; i < 20; i++) {
            const order = synthesizeCharOrder('char-a', '麻辣烫和香辣鸡腿堡', '测试地址', {
                fullUserSetting: '【完整用户设定】\n用户名：小夏\n【扮相手账自述】\n我忌辣，不能吃辣，也不要香菜。',
            });
            const orderText = `${order.storeName} ${order.items.map(item => item.name).join(' ')}`;
            expect(order.note).toContain('忌辣');
            expect(order.note).toContain('不要香菜');
            expect(orderText).not.toMatch(spicyFood);
        }
    });

    it('饭票口味小纸条写无辣和少糖时，两种偏好会同时参与主动订单兜底', () => {
        for (let i = 0; i < 20; i++) {
            const order = synthesizeCharOrder('char-a', '麻辣烫配奶茶甜品', '测试地址', {
                tasteTags: ['无辣', '少糖'],
            });
            const orderText = `${order.storeName} ${order.items.map(item => item.name).join(' ')}`;
            expect(order.note).toContain('无辣');
            expect(order.note).toContain('少糖');
            expect(orderText).not.toMatch(spicyFood);
            expect(orderText).not.toMatch(sweetFood);
        }
    });

    it('自定义菜库里的安全菜会优先参与主动饭票', async () => {
        saveCustomDish({ id: 'safe-rice', name: '温柔南瓜小米饭', price: 19, emoji: '🍚', desc: '自家常备' });
        const result = await synthesizeCharOrderSafely('char-a', '想吃点热乎主食', '测试地址', {
            tasteProfile: { tags: ['忌辣', '控糖'], note: '不要香菜' },
            includeDefaultStores: false,
        });
        expect(result.ok).toBe(true);
        expect(result.order?.storeName).toContain('我的菜库');
        expect(result.order?.items[0].name).toBe('温柔南瓜小米饭');
    });

    it('当前街区缓存和自定义铺子都会参与主动饭票候选', async () => {
        localStorage.setItem(TAKEOUT_STORES_CACHE_KEY, JSON.stringify([{
            id: 'cache-store',
            name: '街角清汤铺',
            emoji: '🍜',
            category: '中餐',
            rating: 4.7,
            monthlySales: 120,
            deliveryMinutes: 25,
            deliveryFee: 2,
            minOrder: 0,
            distanceKm: 1,
            dishes: [{ id: 'cache-noodle', name: '清汤热面', price: 18, emoji: '🍜', popular: true }],
        }]));
        const cached = await synthesizeCharOrderSafely('char-a', '清汤热面', '测试地址', {
            tasteProfile: { tags: ['口味清淡'] },
            includeDefaultStores: false,
        });
        expect(cached.order?.storeName).toBe('街角清汤铺');

        saveCustomStore({
            id: 'mine-store',
            name: '我的素食小铺',
            emoji: '🥬',
            category: '轻食沙拉',
            rating: 4.8,
            monthlySales: 88,
            deliveryMinutes: 20,
            deliveryFee: 0,
            minOrder: 0,
            distanceKm: 0.8,
            dishes: [{ id: 'mine-dish', name: '热乎时蔬豆腐饭', price: 22, emoji: '🥬', popular: true }],
        });
        const custom = await synthesizeCharOrderSafely('char-a', '热乎时蔬豆腐饭', '测试地址', {
            tasteProfile: { tags: ['素食', '不吃生冷'] },
            includeDefaultStores: false,
        });
        expect(custom.order?.storeName).toBe('我的素食小铺');
    });

    it('冲突描述会自动改点安全餐食并写入原因', async () => {
        const result = await synthesizeCharOrderSafely('char-a', '麻辣烫配奶茶甜品和虾仁', '测试地址', {
            tasteProfile: { tags: ['忌辣', '控糖', '海鲜过敏', '乳糖不耐'] },
        });
        const orderText = `${result.order?.storeName || ''} ${result.order?.items.map(item => item.name).join(' ') || ''}`;
        expect(result.ok).toBe(true);
        expect(result.changedReason).toBeTruthy();
        expect(result.order?.note).toContain('按忌口改成更稳妥餐食');
        expect(orderText).not.toMatch(spicyFood);
        expect(orderText).not.toMatch(sweetFood);
        expect(orderText).not.toMatch(seafoodFood);
        expect(orderText).not.toMatch(dairyFood);
    });

    it('没有现成候选时会生成安全菜并保存进我的菜库', async () => {
        const result = await synthesizeCharOrderSafely('char-a', '随便来点能吃的', '测试地址', {
            tasteProfile: { tags: ['忌辣', '控糖', '不吃生冷'], note: '海鲜过敏，花生过敏，不吃猪肉。' },
            includeStoredSources: false,
            includeDefaultStores: false,
        });
        expect(result.ok).toBe(true);
        expect(result.generatedDish).toBeTruthy();
        expect(result.order?.storeName).toBe('饭票安全灶');
        expect(getCustomDishes().some(d => d.id === result.generatedDish?.id)).toBe(true);
    });
});

describe('外卖店铺生成', () => {
    it('每家都带 0~1 的隐藏良心值，且数量足够', () => {
        const stores = generateStores(12);
        expect(stores.length).toBeGreaterThanOrEqual(10);
        for (const s of stores) {
            expect(s.integrity).toBeGreaterThanOrEqual(0);
            expect(s.integrity).toBeLessThanOrEqual(1);
            expect(s.dishes.length).toBeGreaterThan(0);
        }
    });

    it('批量生成里既有良心店也有黑心店（现实分布）', () => {
        const many = Array.from({ length: 40 }, () => generateStores(12)).flat();
        const good = many.filter(s => (s.integrity ?? 1) >= 0.8).length;
        const bad = many.filter(s => (s.integrity ?? 1) < 0.5).length;
        expect(good).toBeGreaterThan(0);
        expect(bad).toBeGreaterThan(0);
        // 黑心店应是少数派，而非遍地
        expect(bad).toBeLessThan(many.length / 2);
    });

    it('黑心店会露出红旗或用夸张促销，良心高分店不挂警告', () => {
        const many = Array.from({ length: 60 }, () => generateStores(12)).flat();
        const withWarning = many.filter(s => s.warning).length;
        expect(withWarning).toBeGreaterThan(0);
        // 顶级良心店（>=0.9）不该挂「差评」类警告
        const topGoodWarned = many.filter(s => (s.integrity ?? 0) >= 0.9 && s.warning).length;
        expect(topGoodWarned).toBe(0);
    });
});

describe('黑心商家 / 坏骑手 事故掷点', () => {
    it('良心满分店 + 多次下单，事故明显比黑心店少', () => {
        const N = 200;
        const goodIssues = Array.from({ length: N }, () => rollOrderIssues({ integrity: 1 }, items, subtotal, 3).incidents.length).reduce((a, b) => a + b, 0);
        const badIssues = Array.from({ length: N }, () => rollOrderIssues({ integrity: 0.18 }, items, subtotal, 3).incidents.length).reduce((a, b) => a + b, 0);
        expect(badIssues).toBeGreaterThan(goodIssues * 2);
    });

    it('强制砍单只发生在黑心店', () => {
        const N = 300;
        const goodCancel = Array.from({ length: N }, () => rollOrderIssues({ integrity: 0.95 }, items, subtotal, 3).forceCancel).filter(Boolean).length;
        const badCancel = Array.from({ length: N }, () => rollOrderIssues({ integrity: 0.18 }, items, subtotal, 3).forceCancel).filter(Boolean).length;
        expect(goodCancel).toBe(0);
        expect(badCancel).toBeGreaterThan(0);
    });

    it('骑手靠谱度落在 0~1，且事故有责任方与建议赔付', () => {
        for (let i = 0; i < 50; i++) {
            const roll = rollOrderIssues({ integrity: 0.3 }, items, subtotal, 3);
            expect(roll.riderReliability).toBeGreaterThanOrEqual(0);
            expect(roll.riderReliability).toBeLessThanOrEqual(1);
            for (const inc of roll.incidents) {
                expect(['store', 'rider']).toContain(inc.by);
                expect(inc.suggestedRefund).toBeGreaterThanOrEqual(0);
            }
        }
    });
});

describe('投诉售后核定', () => {
    it('赔付不超过订单实付，且有结案文案与客服消息', () => {
        const order = mkOrder({
            incidents: [
                { kind: 'foreign_object', by: 'store', title: '吃出异物', detail: 'x', suggestedRefund: 9999 },
            ],
        });
        const { refund, outcome, supportMessages } = resolveComplaint(order);
        expect(refund).toBeLessThanOrEqual(order.total);
        expect(refund).toBeGreaterThan(0);
        expect(outcome).toBeTruthy();
        expect(supportMessages.length).toBeGreaterThanOrEqual(2);
        expect(supportMessages.every(m => m.role === 'support')).toBe(true);
    });

    it('纯添堵类（建议赔付 0）也给善意补偿', () => {
        const order = mkOrder({
            incidents: [{ kind: 'left_at_door', by: 'rider', title: '未送上门', detail: 'x', suggestedRefund: 0 }],
        });
        const { refund } = resolveComplaint(order);
        expect(refund).toBeGreaterThan(0);
    });
});

describe('外卖有效 ETA 与自动反应边界', () => {
    it('新单有效 ETA 不早于下单后 15 分钟', () => {
        const order = mkOrder({
            status: 'preparing',
            placedAt: 1_000,
            etaAt: 61_000,
            deliveredAt: undefined,
        });

        expect(effectiveTakeoutEtaAt(order)).toBe(order.placedAt + MIN_TAKEOUT_DELIVERY_MS);
        expect(liveTakeoutStatus(order, order.placedAt + 60_000)).toBe('preparing');
        expect(isTakeoutArrived(order, order.placedAt + 60_000)).toBe(false);
        expect(liveTakeoutStatus(order, order.placedAt + MIN_TAKEOUT_DELIVERY_MS)).toBe('arrived');
    });

    it('旧异常短 ETA 不会立刻触发角色收货反应', () => {
        const order = mkOrder({
            status: 'preparing',
            charId: 'char-1',
            recipient: 'char-1',
            payer: 'me',
            placedAt: 10_000,
            etaAt: 11_000,
            deliveredAt: undefined,
            reactionPosted: false,
        });

        expect(shouldAutoReactToCharTakeout(order, order.placedAt + 60_000)).toBe(false);
        expect(shouldAutoReactToCharTakeout(order, order.placedAt + MIN_TAKEOUT_DELIVERY_MS)).toBe(true);
    });

    it('已送达、已反应、取消或非角色收货的订单不会自动触发角色反应', () => {
        const base = mkOrder({
            status: 'preparing',
            charId: 'char-1',
            recipient: 'char-1',
            payer: 'me',
            placedAt: 10_000,
            etaAt: 11_000,
            deliveredAt: undefined,
            reactionPosted: false,
        });
        const now = base.placedAt + MIN_TAKEOUT_DELIVERY_MS;

        expect(shouldAutoReactToCharTakeout({ ...base, deliveredAt: now }, now)).toBe(false);
        expect(shouldAutoReactToCharTakeout({ ...base, reactionPosted: true }, now)).toBe(false);
        expect(shouldAutoReactToCharTakeout({ ...base, status: 'cancelled' }, now)).toBe(false);
        expect(shouldAutoReactToCharTakeout({ ...base, recipient: 'me' }, now)).toBe(false);
    });
});
