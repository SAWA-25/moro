import { describe, it, expect } from 'vitest';
import {
    splitByFences,
    isHtmlLang,
    isCssLang,
    isMarkdownLang,
    looksLikeHtmlFragment,
    extractRawHtmlChunk,
    buildHtmlPreviewSrcDoc,
} from './chatRichContent';

describe('splitByFences', () => {
    it('切分文本与围栏代码块', () => {
        const segs = splitByFences('前文\n```html\n<div>hi</div>\n```\n后文');
        expect(segs).toHaveLength(3);
        expect(segs[0]).toEqual({ kind: 'text', text: '前文\n' });
        expect(segs[1]).toMatchObject({ kind: 'fence', lang: 'html', code: '<div>hi</div>\n' });
        expect(segs[2]).toEqual({ kind: 'text', text: '\n后文' });
    });

    it('语言标识大小写不敏感且只取第一个词', () => {
        const segs = splitByFences('```HTML title=x\n<p>a</p>\n```');
        expect(segs[0]).toMatchObject({ kind: 'fence', lang: 'html' });
    });

    it('无语言标识的围栏 lang 为空串', () => {
        const segs = splitByFences('```\nplain\n```');
        expect(segs[0]).toMatchObject({ kind: 'fence', lang: '', code: 'plain\n' });
    });

    it('未闭合的 ``` 当普通文本', () => {
        const segs = splitByFences('开头 ```html\n<div>');
        expect(segs).toHaveLength(1);
        expect(segs[0].kind).toBe('text');
    });

    it('多个围栏依序切分', () => {
        const segs = splitByFences('```css\nbody{}\n```\n说明\n```md\n# t\n```');
        expect(segs.map(s => s.kind)).toEqual(['fence', 'text', 'fence']);
    });
});

describe('语言判定', () => {
    it('html 族', () => {
        expect(isHtmlLang('html')).toBe(true);
        expect(isHtmlLang('svg')).toBe(true);
        expect(isHtmlLang('css')).toBe(false);
    });
    it('css', () => {
        expect(isCssLang('css')).toBe(true);
        expect(isCssLang('scss')).toBe(false);
    });
    it('markdown 族', () => {
        expect(isMarkdownLang('markdown')).toBe(true);
        expect(isMarkdownLang('md')).toBe(true);
        expect(isMarkdownLang('js')).toBe(false);
    });
});

describe('looksLikeHtmlFragment', () => {
    it('识别带闭合标签的片段', () => {
        expect(looksLikeHtmlFragment('<div class="a">hi</div>')).toBe(true);
        expect(looksLikeHtmlFragment('<!DOCTYPE html><html></html>')).toBe(true);
    });
    it('拒绝普通文本与未闭合内容', () => {
        expect(looksLikeHtmlFragment('console.log(1)')).toBe(false);
        expect(looksLikeHtmlFragment('< 3 你')).toBe(false);
        expect(looksLikeHtmlFragment('<div>没闭合')).toBe(false);
    });
});

describe('extractRawHtmlChunk', () => {
    it('抽出正文里的裸 HTML 片段', () => {
        const r = extractRawHtmlChunk('看这个：\n<div style="color:red">卡片</div>\n好看吗');
        expect(r).not.toBeNull();
        expect(r!.before).toBe('看这个：\n');
        expect(r!.html).toBe('<div style="color:red">卡片</div>');
        expect(r!.after).toBe('\n好看吗');
    });

    it('跨多个块级标签取到最后一个闭合', () => {
        const r = extractRawHtmlChunk('<div>a</div>中间<table><tr><td>b</td></tr></table>尾巴');
        expect(r!.html).toBe('<div>a</div>中间<table><tr><td>b</td></tr></table>');
        expect(r!.after).toBe('尾巴');
    });

    it('不误判聊天里的行内标签和伪 XML', () => {
        expect(extractRawHtmlChunk('我 <b>超</b> 喜欢你')).toBeNull();
        expect(extractRawHtmlChunk('<心情>开心</心情>')).toBeNull();
        expect(extractRawHtmlChunk('纯文本')).toBeNull();
    });

    it('只有开标签没有闭合时不抽取', () => {
        expect(extractRawHtmlChunk('<div>没闭合')).toBeNull();
    });
});

describe('buildHtmlPreviewSrcDoc', () => {
    it('片段套上标准 wrapper', () => {
        const doc = buildHtmlPreviewSrcDoc('<div>hi</div>');
        expect(doc).toContain('<!DOCTYPE html>');
        expect(doc).toContain('<div>hi</div>');
    });

    it('附加 CSS 注入 <style>', () => {
        const doc = buildHtmlPreviewSrcDoc('<div class="a">hi</div>', '.a{color:red}');
        expect(doc).toContain('.a{color:red}');
        expect(doc.indexOf('.a{color:red}')).toBeLessThan(doc.indexOf('<div class="a">'));
    });

    it('完整文档不再套 wrapper，CSS 注到 </head> 前', () => {
        const full = '<!DOCTYPE html><html><head><title>t</title></head><body>x</body></html>';
        expect(buildHtmlPreviewSrcDoc(full)).toBe(full);
        const withCss = buildHtmlPreviewSrcDoc(full, 'body{margin:0}');
        expect(withCss).toMatch(/body\{margin:0\}\s*<\/style><\/head>/);
        expect((withCss.match(/<!DOCTYPE html>/gi) || []).length).toBe(1);
    });

    it('CSS-only：空 HTML 也能生成可渲染文档', () => {
        const doc = buildHtmlPreviewSrcDoc('', 'body{background:#fdd}');
        expect(doc).toContain('body{background:#fdd}');
        expect(doc).toContain('<body>');
    });
});
