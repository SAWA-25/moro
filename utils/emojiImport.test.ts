import { describe, expect, it } from 'vitest';
import {
    buildEmojiRecordsFromImageDrafts,
    emojiNameFromFileName,
    parseEmojiImportText,
} from './emojiImport';

describe('emoji import helpers', () => {
    it('creates a default emoji name from the file name', () => {
        expect(emojiNameFromFileName('meme-cat.webp')).toBe('meme-cat');
        expect(emojiNameFromFileName('C:\\pics\\偷笑.gif')).toBe('偷笑');
        expect(emojiNameFromFileName('.png')).toBe('新表情');
    });

    it('generates unique names for batch image imports', () => {
        const records = buildEmojiRecordsFromImageDrafts(
            [
                { fileName: '贴贴.png', url: 'data:image/png;base64,a' },
                { fileName: '贴贴.webp', url: 'data:image/webp;base64,b' },
                { fileName: '表情.gif', url: 'data:image/gif;base64,c', name: '贴贴' },
            ],
            [{ name: '贴贴', url: '/old.png' }],
            'cat-fun',
        );

        expect(records.map(record => record.name)).toEqual(['贴贴2', '贴贴3', '贴贴4']);
        expect(records.every(record => record.categoryId === 'cat-fun')).toBe(true);
    });

    it('parses legacy text imports with optional remarks', () => {
        const records = parseEmojiImportText(
            [
                '偷笑--https://example.com/a--b/001.jpg--阴阳怪气地笑',
                '点头--data:image/png;base64,xxx',
                '坏行',
            ].join('\n'),
            'default',
        );

        expect(records).toEqual([
            {
                name: '偷笑',
                url: 'https://example.com/a--b/001.jpg',
                categoryId: 'default',
                description: '阴阳怪气地笑',
            },
            {
                name: '点头',
                url: 'data:image/png;base64,xxx',
                categoryId: 'default',
            },
        ]);
    });

    it('omits empty remarks from generated image records', () => {
        const [record] = buildEmojiRecordsFromImageDrafts(
            [{ fileName: 'ok.png', url: 'data:image/png;base64,a', description: '   ' }],
            [],
            undefined,
        );

        expect(record).toEqual({
            name: 'ok',
            url: 'data:image/png;base64,a',
            categoryId: 'default',
        });
    });

    it('omits empty remarks from legacy text imports', () => {
        expect(parseEmojiImportText('摆手--https://example.com/wave.png--', 'default')).toEqual([
            {
                name: '摆手',
                url: 'https://example.com/wave.png',
                categoryId: 'default',
            },
        ]);
    });
});
