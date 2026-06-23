import { describe, it, expect } from 'vitest';
import { addToCart, setCartQty, removeFromCart, cartCount, cartTotal, resolveCart, expandCart, getShopItem } from './shop';

const rosePrice = getShopItem('rose')!.price;   // 9.9
const cakePrice = getShopItem('cake')!.price;   // 45

describe('shop cart helpers', () => {
    it('addToCart 新增 / 累加，不改原数组', () => {
        const c0: any[] = [];
        const c1 = addToCart(c0, 'rose');
        expect(c0).toEqual([]);
        expect(c1).toEqual([{ itemId: 'rose', qty: 1 }]);
        const c2 = addToCart(c1, 'rose', 2);
        expect(c2).toEqual([{ itemId: 'rose', qty: 3 }]);
    });

    it('setCartQty 设置数量，<=0 移除', () => {
        const c = setCartQty([{ itemId: 'rose', qty: 3 }], 'rose', 5);
        expect(c).toEqual([{ itemId: 'rose', qty: 5 }]);
        expect(setCartQty(c, 'rose', 0)).toEqual([]);
    });

    it('removeFromCart 移除指定商品', () => {
        expect(removeFromCart([{ itemId: 'rose', qty: 1 }, { itemId: 'cake', qty: 2 }], 'rose'))
            .toEqual([{ itemId: 'cake', qty: 2 }]);
    });

    it('cartCount / cartTotal 计件与计价', () => {
        const cart = [{ itemId: 'rose', qty: 2 }, { itemId: 'cake', qty: 1 }];
        expect(cartCount(cart)).toBe(3);
        expect(cartTotal(cart)).toBeCloseTo(rosePrice * 2 + cakePrice, 2);
    });

    it('resolveCart 跳过未知商品', () => {
        const r = resolveCart([{ itemId: 'rose', qty: 1 }, { itemId: 'nope', qty: 9 }]);
        expect(r.length).toBe(1);
        expect(r[0].item.id).toBe('rose');
    });

    it('expandCart 按件展开', () => {
        const items = expandCart([{ itemId: 'rose', qty: 2 }, { itemId: 'cake', qty: 1 }]);
        expect(items.map(i => i.id)).toEqual(['rose', 'rose', 'cake']);
    });

    it('cartCount/cartTotal 对空购物车安全', () => {
        expect(cartCount(undefined)).toBe(0);
        expect(cartTotal(undefined)).toBe(0);
    });
});
