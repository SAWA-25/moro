// 聊天气泡富代码渲染 — 纯函数部分
//
// 配合 components/chat/RichCodeBlock.tsx 使用：
// 1) AI 消息里的 ```html / ```css / ```markdown 围栏代码块直接渲染成效果（而不是代码文本）；
// 2) 没写语言标识但内容明显是 HTML 的围栏，也按 HTML 预览处理；
// 3) 正文里裸写的块级 HTML（<div>...</div> 等）同样抽出来渲染。
// HTML 一律走独立 iframe 文档渲染（对齐 ST/JS-Slash-Runner：脚本在 iframe 内执行，
// 不直接注入聊天 DOM），Markdown 渲染成 React 节点，全程不碰 dangerouslySetInnerHTML。

export type FenceSegment =
    | { kind: 'fence'; lang: string; code: string; raw: string }
    | { kind: 'text'; text: string };

const FENCE_SPLIT_RE = /(```[\s\S]*?```)/g;
const FENCE_PARSE_RE = /^```[ \t]*([^\n`]*)\n?([\s\S]*?)```$/;

/** 把文本切成「围栏代码块」与「普通文本」交替的段落序列。未闭合的 ``` 当普通文本处理。 */
export function splitByFences(text: string): FenceSegment[] {
    const segments: FenceSegment[] = [];
    for (const part of text.split(FENCE_SPLIT_RE)) {
        if (!part) continue;
        const m = part.match(FENCE_PARSE_RE);
        if (m) {
            const lang = (m[1] || '').trim().split(/\s+/)[0].toLowerCase();
            segments.push({ kind: 'fence', lang, code: m[2] || '', raw: part });
        } else {
            segments.push({ kind: 'text', text: part });
        }
    }
    return segments;
}

export function isHtmlLang(lang: string): boolean {
    return lang === 'html' || lang === 'htm' || lang === 'xhtml' || lang === 'svg';
}

export function isCssLang(lang: string): boolean {
    return lang === 'css';
}

export function isMarkdownLang(lang: string): boolean {
    return lang === 'markdown' || lang === 'md' || lang === 'mdown' || lang === 'gfm';
}

/** 没写语言标识的围栏：内容以标签开头且带闭合（或自闭合 svg / doctype）就按 HTML 预览。 */
export function looksLikeHtmlFragment(code: string): boolean {
    const t = code.trim();
    if (!t.startsWith('<')) return false;
    if (/^<!doctype\s+html/i.test(t)) return true;
    if (!/^<([a-zA-Z][\w-]*)[\s>]/.test(t)) return false;
    return /<\/[a-zA-Z][\w-]*\s*>/.test(t) || /\/>\s*$/.test(t);
}

// 触发裸 HTML 抽取的标签集合：只认块级结构标签，避免把聊天正文里偶发的
// <b>、<a>、伪 XML（<心情> 等）误判成要渲染的页面。
const RAW_HTML_TAGS =
    'div|section|article|table|style|script|svg|details|figure|main|aside|header|footer|form|ul|ol|center|blockquote|canvas|video|audio|iframe';
const RAW_HTML_OPEN_RE = new RegExp(`<(?:!doctype\\s+html|html|${RAW_HTML_TAGS})(?:\\s[^>]*)?>`, 'i');
const RAW_HTML_CLOSE_RE = new RegExp(`</(?:html|body|${RAW_HTML_TAGS}|h[1-6]|p)\\s*>`, 'gi');

export interface RawHtmlChunk {
    before: string;
    html: string;
    after: string;
}

/**
 * 从一段普通文本里抽出第一个裸 HTML 片段（首个块级开标签 → 最后一个块级闭标签）。
 * 没有可信片段时返回 null。after 里可能还有下一个片段，调用方可递归处理。
 */
export function extractRawHtmlChunk(text: string): RawHtmlChunk | null {
    const open = text.match(RAW_HTML_OPEN_RE);
    if (!open || open.index === undefined) return null;
    const start = open.index;
    let end = -1;
    RAW_HTML_CLOSE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = RAW_HTML_CLOSE_RE.exec(text)) !== null) {
        end = m.index + m[0].length;
    }
    if (end <= start) return null;
    return {
        before: text.slice(0, start),
        html: text.slice(start, end),
        after: text.slice(end),
    };
}

export interface RichSplitSegment {
    kind: 'rich' | 'text';
    content: string;
}

/**
 * 把文本切成「整块保留的富内容」与「普通文本」段，给消息入库前的分泡逻辑用：
 * - 富内容 = ``` 围栏代码块、裸块级 HTML（<div>…</div> 等）
 * - 富内容必须整块单独成一条气泡，否则 chunkText 会按换行把 HTML 切碎成
 *   "</div>"、"<div style=…>" 这样的纯文本碎泡，渲染端再也拼不回来。
 */
export function splitOutRichBlocks(text: string): RichSplitSegment[] {
    const out: RichSplitSegment[] = [];
    for (const seg of splitByFences(text)) {
        if (seg.kind === 'fence') {
            out.push({ kind: 'rich', content: seg.raw });
            continue;
        }
        let rest = seg.text;
        while (rest) {
            const chunk = extractRawHtmlChunk(rest);
            if (!chunk) {
                if (rest.trim()) out.push({ kind: 'text', content: rest });
                break;
            }
            if (chunk.before.trim()) out.push({ kind: 'text', content: chunk.before });
            out.push({ kind: 'rich', content: chunk.html });
            rest = chunk.after;
        }
    }
    return out;
}

/** 是否是完整 HTML 文档（含 <html> 或 doctype），完整文档不再套 wrapper。 */
function isFullDocument(html: string): boolean {
    return /<!doctype\s+html|<html[\s>]/i.test(html);
}

/**
 * 组装沙盒 iframe 的 srcDoc。
 * - 片段：套标准 head + 基础排版样式；
 * - 完整文档：原样使用，额外 CSS 注到 </head> 前（没有 head 就前置）。
 * 同一条消息里的 ```css 围栏会作为 extraCss 注入所有 HTML 预览，HTML+CSS 配套代码开箱即渲染。
 */
export function buildHtmlPreviewSrcDoc(html: string, extraCss?: string): string {
    const cssTag = extraCss && extraCss.trim() ? `<style>\n${extraCss}\n</style>` : '';
    if (isFullDocument(html)) {
        if (!cssTag) return html;
        if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${cssTag}</head>`);
        return cssTag + html;
    }
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;padding:0;background:#fff;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Segoe UI',sans-serif;color:#334155;font-size:14px;line-height:1.6;}body{padding:10px;}*{box-sizing:border-box;}img,video{max-width:100%;}</style>${cssTag}</head><body>${html}</body></html>`;
}
