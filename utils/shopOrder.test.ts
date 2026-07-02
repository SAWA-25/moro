import { describe, it, expect } from 'vitest';
import { makeOrder, orderProgress, orderReceivePayload, getShopItem, recommendGiftsForCharacter, itemGiftSignals } from './shop';

const rose = getShopItem('rose')!;
const cake = getShopItem('cake')!;

describe('makeOrder', () => {
    it('汇总数量与总价、给出 etaAt > placedAt', () => {
        const o = makeOrder([{ item: rose, qty: 2 }, { item: cake, qty: 1 }], 'self');
        expect(o.items.length).toBe(2);
        expect(o.total).toBeCloseTo(rose.price * 2 + cake.price, 2);
        expect(o.etaAt).toBeGreaterThan(o.placedAt);
        expect(o.paidBy).toBe('self');
    });
});

describe('orderProgress', () => {
    const base = makeOrder([{ item: rose, qty: 1 }], 'self');
    const at = (frac: number) => base.placedAt + (base.etaAt - base.placedAt) * frac;

    it('按时间分段推进', () => {
        expect(orderProgress(base, at(0.05)).stage).toBe('placed');
        expect(orderProgress(base, at(0.3)).stage).toBe('shipped');
        expect(orderProgress(base, at(0.6)).stage).toBe('transit');
        expect(orderProgress(base, at(0.9)).stage).toBe('delivering');
    });

    it('到点后 arrived 且可确认收货', () => {
        const p = orderProgress(base, base.etaAt + 1000);
        expect(p.stage).toBe('arrived');
        expect(p.canReceive).toBe(true);
        expect(p.pct).toBe(100);
    });

    it('已收货 → received', () => {
        const p = orderProgress({ ...base, receivedAt: Date.now() }, Date.now());
        expect(p.stage).toBe('received');
        expect(p.canReceive).toBe(false);
    });
});

describe('orderReceivePayload', () => {
    it('self 付：逐件背包物 + buy 小票，无角色小票', () => {
        const o = makeOrder([{ item: rose, qty: 2 }], 'self');
        const r = orderReceivePayload(o, '我');
        expect(r.owned.length).toBe(2);
        expect(r.userReceipts.every(x => x.action === 'buy')).toBe(true);
        expect(r.charReceipts.length).toBe(0);
    });

    it('代付：用户 receive + 角色 gift 小票', () => {
        const o = makeOrder([{ item: cake, qty: 1 }], 'char', '阿白');
        const r = orderReceivePayload(o, '我');
        expect(r.userReceipts[0].action).toBe('receive');
        expect(r.charReceipts[0].action).toBe('gift');
        expect(r.charReceipts[0].counterpartName).toBe('我');
    });
});

describe('gift advisor', () => {
    it('按预算过滤并返回可解释推荐', () => {
        const picks = recommendGiftsForCharacter([rose, cake], {
            charName: '阿白',
            affection: 40,
            occasion: 'daily',
            budget: 20,
        }, 4);
        expect(picks.length).toBeGreaterThan(0);
        expect(picks[0].item.price).toBeLessThanOrEqual(20);
        expect(picks[0].reason).toContain('阿白');
        expect(picks[0].tags).toContain('预算内');
    });

    it('商品送礼信号包含关系尺度和场景', () => {
        const signals = itemGiftSignals(rose);
        expect(signals.relationLabel.length).toBeGreaterThan(0);
        expect(signals.scenes.length).toBeGreaterThan(0);
    });
});
