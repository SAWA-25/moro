import { describe, expect, it } from 'vitest';
import { Worldbook } from '../types';
import { parseWorldbookJson } from './worldbookImport';
import { buildWorldbookExport, stringifyWorldbookExport, worldbookExportFileName } from './worldbookExport';

const sampleBook = (overrides: Partial<Worldbook> = {}): Worldbook => ({
    id: 'wb-a',
    title: '龙门',
    content: '龙门只在雨夜打开。',
    category: '高级世界书',
    createdAt: 1000,
    updatedAt: 2000,
    enabled: true,
    activation: 'keyword',
    keys: ['Dragon'],
    secondaryKeys: ['Gate'],
    selective: true,
    selectiveLogic: 'and_all',
    position: 'depth_user',
    depth: 2,
    order: 12,
    scanDepth: 5,
    probability: 80,
    useProbability: true,
    matchWholeWords: true,
    ignoreBudget: true,
    ...overrides,
});

describe('buildWorldbookExport', () => {
    it('导出为 ST 风格世界书并保留 Moro 扩展元数据', () => {
        const exported = buildWorldbookExport({
            category: '高级世界书',
            books: [sampleBook()],
            groupEnabled: false,
            groupScope: 'global',
            groupSettings: { recursiveScanning: true, tokenBudget: 256, maxRecursionSteps: 3 },
            exportedAt: 123456,
        });

        expect(exported).toMatchObject({
            name: '高级世界书',
            token_budget: 256,
            recursive_scanning: true,
            extensions: {
                max_recursion_steps: 3,
                moro: {
                    format: 'moro-worldbook',
                    groupEnabled: false,
                    groupScope: 'global',
                    entryCount: 1,
                },
            },
        });
        expect(exported.entries['0']).toMatchObject({
            comment: '龙门',
            content: '龙门只在雨夜打开。',
            key: ['Dragon'],
            keysecondary: ['Gate'],
            constant: false,
            position: 4,
            role: 1,
            depth: 2,
            insertion_order: 12,
            selectiveLogic: 3,
            probability: 80,
            useProbability: true,
            match_whole_words: true,
            ignore_budget: true,
        });
    });

    it('导出的 JSON 可被现有导入解析器读回关键字段', () => {
        const exported = buildWorldbookExport({
            category: '高级世界书',
            books: [sampleBook()],
            groupSettings: { recursiveScanning: true, tokenBudget: 256, maxRecursionSteps: 3 },
            exportedAt: 123456,
        });

        const imported = parseWorldbookJson(exported, 'fallback.json');
        expect(imported).toHaveLength(1);
        expect(imported[0]).toMatchObject({
            title: '龙门',
            content: '龙门只在雨夜打开。',
            category: '高级世界书',
            activation: 'keyword',
            keys: ['Dragon'],
            secondaryKeys: ['Gate'],
            selective: true,
            selectiveLogic: 'and_all',
            position: 'depth_user',
            depth: 2,
            order: 12,
            scanDepth: 5,
            probability: 80,
            useProbability: true,
            matchWholeWords: true,
            ignoreBudget: true,
        });
        expect(imported[0].stData).toMatchObject({
            tokenBudget: 256,
            recursiveScanning: true,
            bookExtensions: { max_recursion_steps: 3 },
        });
    });

    it('生成可下载的 JSON 文本和安全文件名', () => {
        const text = stringifyWorldbookExport({ category: '王城/禁区', books: [sampleBook()] });
        expect(JSON.parse(text).name).toBe('王城/禁区');
        expect(worldbookExportFileName('王城/禁区')).toBe('moro-worldbook-王城_禁区.json');
    });
});
