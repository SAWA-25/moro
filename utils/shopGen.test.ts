import { describe, it, expect } from 'vitest';
import { parseGeneratedItems, parseGeneratedReviews, registerShopItems, getShopItem } from './shop';

describe('parseGeneratedItems', () => {
    it('解析数组、补 id、校验分类/价格/emoji，去重', () => {
        const raw = '```json\n[' +
            '{"name":"星空滴胶夜灯","emoji":"🌌","price":88,"category":"tech","blurb":"夜里一片小宇宙"},' +
            '{"name":"星空滴胶夜灯","emoji":"🌌","price":88,"category":"tech","blurb":"重复应去重"},' +
            '{"name":"手冲咖啡体验券","price":"129","category":"weird","blurb":""}' +
            ']\n```';
        const items = parseGeneratedItems(raw);
        expect(items.length).toBe(2);                 // 去重后 2 件
        expect(items[0].id.startsWith('gen_')).toBe(true);
        expect(items[0].generated).toBe(true);
        expect(items[1].category).toBe('life');        // 非法分类回退 life
        expect(items[1].price).toBe(129);              // 字符串价格转数字
        expect(items[1].blurb.length).toBeGreaterThan(0); // 空 blurb 兜底
    });

    it('非 JSON 安全返回空数组', () => {
        expect(parseGeneratedItems('抱歉我做不到')).toEqual([]);
        expect(parseGeneratedItems('')).toEqual([]);
    });

    it('registerShopItems 后 getShopItem 能解析生成的 id', () => {
        const items = parseGeneratedItems('[{"name":"绒绒月亮抱枕","emoji":"🌙","price":69,"category":"plush","blurb":"抱着像抱住月亮"}]');
        registerShopItems(items);
        const got = getShopItem(items[0].id);
        expect(got?.name).toBe('绒绒月亮抱枕');
    });
});

describe('parseGeneratedReviews', () => {
    it('解析、stars 归一到 4/5、脱敏兜底', () => {
        const raw = '[{"user":"t**o","stars":5,"text":"很好看，送人有面子"},{"stars":3,"text":"还行吧凑合"},{"user":"x","text":""}]';
        const rv = parseGeneratedReviews(raw);
        expect(rv.length).toBe(2);            // 空 text 被丢
        expect(rv[0].stars).toBe(5);
        expect(rv[1].stars).toBe(5);          // 非 4 的都归 5
    });
    it('非 JSON 返回空', () => {
        expect(parseGeneratedReviews('nope')).toEqual([]);
    });
});
