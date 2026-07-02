import { describe, it, expect } from 'vitest';
import { parseWorldbookJson, parseWorldbookText } from './worldbookImport';

describe('parseWorldbookJson', () => {
    it('解析 SillyTavern 世界书（entries 为对象）', () => {
        const st = {
            name: '艾尔登设定',
            entries: {
                '0': { comment: '王城', content: '黄金树矗立在王城中央。', keys: ['王城', '黄金树'], constant: false, insertion_order: 10 },
                '1': { content: '常驻世界观。', constant: true, enabled: true, insertion_order: 5 },
                '2': { content: '', keys: ['空条目'] }, // 无内容应被丢弃
            },
        };
        const books = parseWorldbookJson(st, 'fallback');
        expect(books.length).toBe(2);
        expect(books[0].category).toBe('艾尔登设定');
        const wangcheng = books.find(b => b.title === '王城')!;
        expect(wangcheng.activation).toBe('keyword'); // 有关键词且非常驻
        expect(wangcheng.keys).toEqual(['王城', '黄金树']);
        const constantEntry = books.find(b => b.activation === 'always')!;
        expect(constantEntry).toBeTruthy();
    });

    it('解析 SillyTavern 世界书（entries 为数组）', () => {
        const st = { entries: [{ content: '设定 A', keys: ['a'] }, { content: '设定 B' }] };
        const books = parseWorldbookJson(st, '我的卡.json');
        expect(books.length).toBe(2);
        expect(books[0].category).toBe('我的卡'); // 用文件名去后缀作分类
    });

    it('解析 Moro 自家导出（数组）并重置 id', () => {
        const moro = [
            { id: 'old-1', title: '甲', content: '内容甲', category: '原分类' },
            { id: 'old-2', title: '乙', content: '内容乙', category: '原分类' },
        ];
        const books = parseWorldbookJson(moro, 'x');
        expect(books.length).toBe(2);
        expect(books[0].id).not.toBe('old-1');
        expect(books[0].category).toBe('原分类');
        expect(books[1].id).not.toBe(books[0].id);
    });

    it('解析 Moro 自家导出（单对象）', () => {
        const one = { title: '独苗', content: '就这一条', category: '杂项' };
        const books = parseWorldbookJson(one, 'x');
        expect(books.length).toBe(1);
        expect(books[0].title).toBe('独苗');
    });

    it('禁用条目映射为 enabled:false', () => {
        const st = { entries: [{ content: 'c', disable: true }, { content: 'd', enabled: false }] };
        const books = parseWorldbookJson(st, 'x');
        expect(books.every(b => b.enabled === false)).toBe(true);
    });

    it('映射 ST 高级触发字段与书级预算/递归设置', () => {
        const st = {
            name: '高级世界书',
            scan_depth: 7,
            token_budget: 256,
            recursive_scanning: true,
            extensions: { max_recursion_steps: 3 },
            entries: {
                '9': {
                    uid: 9,
                    key: ['Dragon'],
                    keysecondary: ['Gate', 'Key'],
                    selective: true,
                    selectiveLogic: 3,
                    content: '龙门设定。',
                    order: 12,
                    position: 4,
                    role: 1,
                    depth: 2,
                    extensions: {
                        probability: 80,
                        useProbability: true,
                        match_whole_words: true,
                        ignore_budget: true,
                        scan_depth: 5,
                    },
                },
            },
        };
        const books = parseWorldbookJson(st, 'fallback');
        expect(books).toHaveLength(1);
        expect(books[0]).toMatchObject({
            category: '高级世界书',
            activation: 'keyword',
            keys: ['Dragon'],
            secondaryKeys: ['Gate', 'Key'],
            selective: true,
            selectiveLogic: 'and_all',
            position: 'depth_user',
            depth: 2,
            order: 12,
            probability: 80,
            useProbability: true,
            matchWholeWords: true,
            ignoreBudget: true,
            scanDepth: 5,
        });
        expect(books[0].stData).toMatchObject({
            scanDepth: 7,
            tokenBudget: 256,
            recursiveScanning: true,
            bookExtensions: { max_recursion_steps: 3 },
            entry: {
                id: 9,
                selectiveLogic: 'and_all',
                probability: 80,
                matchWholeWords: true,
                ignoreBudget: true,
                scanDepth: 5,
            },
        });
    });

    it('空/未知结构返回空数组', () => {
        expect(parseWorldbookJson({}, 'x')).toEqual([]);
        expect(parseWorldbookJson({ foo: 'bar' }, 'x')).toEqual([]);
    });
});

describe('parseWorldbookText', () => {
    it('非法 JSON 抛错', () => {
        expect(() => parseWorldbookText('{not json', 'bad.json')).toThrow(/不是合法/);
    });
    it('合法 JSON 正常解析', () => {
        const txt = JSON.stringify({ entries: [{ content: 'hello', keys: ['hi'] }] });
        const books = parseWorldbookText(txt, 'ok.json');
        expect(books[0].content).toBe('hello');
    });
});
