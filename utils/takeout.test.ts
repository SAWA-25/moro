import { describe, it, expect } from 'vitest';
import {
    effectiveTakeoutEtaAt,
    extractTakeoutOrderDirective,
    generateStores,
    generateStoreReviewsAI,
    isTakeoutArrived,
    liveTakeoutStatus,
    MIN_TAKEOUT_DELIVERY_MS,
    PACK_FEE,
    resolveComplaint,
    rollOrderIssues,
    shouldAutoReactToCharTakeout,
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
