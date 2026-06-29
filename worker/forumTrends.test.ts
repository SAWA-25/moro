import { describe, expect, it } from 'vitest';
import { __forumTrendsTest } from './index.js';

const rss = (items: string) => `<?xml version="1.0" encoding="UTF-8"?>
<rss><channel>${items}</channel></rss>`;

describe('forum trends worker helpers', () => {
    it('parses RSSHub item XML into trend items', () => {
        const xml = rss(`
            <item>
                <title><![CDATA[这届网友太会整活]]></title>
                <link>https://example.com/a</link>
                <category>整活</category>
            </item>
            <item>
                <title> 后续比正片还离谱 </title>
                <link>https://example.com/b</link>
            </item>
        `);
        const items = __forumTrendsTest.parseForumTrendXml(xml, '测试源');
        expect(items).toHaveLength(2);
        expect(items[0]).toMatchObject({ title: '这届网友太会整活', source: '测试源', url: 'https://example.com/a' });
        expect(items[0].tags).toEqual(['整活']);
    });

    it('merges sources, dedupes titles, and keeps response shape', async () => {
        const merged = __forumTrendsTest.mergeForumTrendItems([
            [{ title: '热梗 A', source: '微博热搜', url: 'https://example.com/a' }],
            [{ title: ' 热梗A ', source: '知乎热榜' }, { title: '热梗 B', source: 'B站热搜' }],
        ]);
        expect(merged.map(x => x.title)).toEqual(['热梗 A', '热梗 B']);

        const pack = await __forumTrendsTest.buildForumTrendPack(1000, async () => new Response(rss(`
            <item><title>热榜第一</title><link>https://example.com/1</link></item>
        `)));
        expect(pack.fetchedAt).toBe(1000);
        expect(pack.expiresAt).toBeGreaterThan(1000);
        expect(pack.items.length).toBeGreaterThan(0);
        expect(pack.items[0]).toMatchObject({ title: '热榜第一' });
    });
});
