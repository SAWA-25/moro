import { describe, it, expect } from 'vitest';
import { parseGeneratedItems, parseGeneratedReviews, registerShopItems, getShopItem, sanitizeShopItemDraft, saveCustomShopItem, searchShopItems } from './shop';

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

    it('被 max_tokens 截断（数组没收尾）也能救回已写完的商品', () => {
        // 模拟模型写到一半被截断：前 2 件完整，第 3 件残缺、数组无 ]
        const raw = '```json\n[' +
            '{"name":"绒月抱枕","emoji":"🌙","price":69,"category":"life","blurb":"软乎乎","rating":4.6},' +
            '{"name":"星空夜灯","emoji":"🌌","price":88,"category":"life","blurb":"小宇宙","rating":4.8},' +
            '{"name":"半截商品","emoji":"';
        const items = parseGeneratedItems(raw);
        expect(items.length).toBe(2);            // 救回 2 件完整的，丢掉残缺的
        expect(items[0].name).toBe('绒月抱枕');
        expect(items[1].name).toBe('星空夜灯');
    });

    it('registerShopItems 后 getShopItem 能解析生成的 id', () => {
        const items = parseGeneratedItems('[{"name":"绒绒月亮抱枕","emoji":"🌙","price":69,"category":"plush","blurb":"抱着像抱住月亮"}]');
        registerShopItems(items);
        const got = getShopItem(items[0].id);
        expect(got?.name).toBe('绒绒月亮抱枕');
    });
});

describe('parseGeneratedReviews', () => {
    it('解析、stars 保留 1~5（仿真有好有坏）、脱敏兜底', () => {
        const raw = '[{"user":"t**o","stars":5,"text":"很好看，送人有面子"},{"stars":2,"text":"踩雷了不推荐"},{"user":"x","text":""}]';
        const rv = parseGeneratedReviews(raw);
        expect(rv.length).toBe(2);            // 空 text 被丢
        expect(rv[0].stars).toBe(5);
        expect(rv[1].stars).toBe(2);          // 低星差评保留
    });
    it('非 JSON 返回空', () => {
        expect(parseGeneratedReviews('nope')).toEqual([]);
    });
});

describe('custom shop items', () => {
    it('保存自定义商品后 getShopItem/searchShopItems 能解析', () => {
        const item = saveCustomShopItem({
            name: '自定义月光杯',
            emoji: '🌙',
            price: '19.9',
            category: 'life',
            blurb: '自己写上货架的小礼物',
            image: 'https://example.com/cup.png',
            rating: '4.6',
        });
        expect(item?.id.startsWith('custom_')).toBe(true);
        expect(item?.custom).toBe(true);
        expect(getShopItem(item!.id)?.name).toBe('自定义月光杯');
        expect(searchShopItems('月光杯').some(x => x.id === item!.id)).toBe(true);
    });

    it('清洗非法字段，空名称拒绝保存', () => {
        expect(sanitizeShopItemDraft({ name: ' ', price: 12 })).toBeNull();
        const item = sanitizeShopItemDraft({
            name: '  乱价商品  ',
            emoji: '',
            price: -8,
            category: 'bad-cat',
            blurb: '',
            image: 'ftp://bad.example/a.png',
            rating: 9,
        });
        expect(item?.name).toBe('乱价商品');
        expect(item?.emoji).toBe('🎁');
        expect(item?.price).toBe(0.1);
        expect(item?.category).toBe('life');
        expect(item?.image).toBeUndefined();
        expect(item?.rating).toBe(5);
    });

    it('编辑已有商品保留 id 并覆盖价格、图片和评分', () => {
        const base = saveCustomShopItem({ name: '旧款手账', emoji: '📓', price: 12, category: 'life', blurb: '旧描述' })!;
        const edited = saveCustomShopItem({
            id: base.id,
            name: '新款手账',
            emoji: '📔',
            price: 18,
            category: 'romance',
            blurb: '新描述',
            image: 'https://example.com/notebook.png',
            rating: 4.8,
        }, base)!;
        expect(edited.id).toBe(base.id);
        expect(getShopItem(base.id)?.name).toBe('新款手账');
        expect(getShopItem(base.id)?.price).toBe(18);
        expect(getShopItem(base.id)?.image).toBe('https://example.com/notebook.png');
        expect(getShopItem(base.id)?.rating).toBe(4.8);
    });
});
