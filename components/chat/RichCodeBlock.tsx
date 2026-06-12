// 聊天气泡里的富代码渲染块
//
// - HtmlPreviewBlock：```html / ```css 围栏与正文裸 HTML 的沙盒预览卡。
//   iframe 沙盒策略与 html_card 一致（只给 allow-same-origin 用于量高，
//   不给 allow-scripts / allow-forms / allow-popups），AI 输出的 <script> 不会执行。
// - MarkdownPreviewBlock：```markdown 围栏的完整 Markdown 渲染
//   （标题 / 列表 / 表格 / 引用 / 代码 / 链接 / 图片），全部输出 React 节点，
//   不使用 dangerouslySetInnerHTML。
// 两者都带「预览 ↔ 源码」切换，渲染默认开启，源码随时可查。

import React, { useMemo, useState } from 'react';
import { buildHtmlPreviewSrcDoc } from '../../utils/chatRichContent';

const CodePre: React.FC<{ code: string }> = ({ code }) => (
    <pre className="bg-black/80 text-gray-100 p-3 text-xs font-mono overflow-x-auto whitespace-pre m-0">
        {code}
    </pre>
);

/** 块顶部小工具栏：左边语言标签，右边「预览 / 源码」切换。 */
const BlockHeader: React.FC<{
    label: string;
    showCode: boolean;
    onToggle: (showCode: boolean) => void;
    previewLabel?: string;
}> = ({ label, showCode, onToggle, previewLabel = '预览' }) => {
    const btnCls = (active: boolean) =>
        `px-2 py-[2px] rounded-md text-[10px] font-medium transition-colors select-none ${
            active ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-400'
        }`;
    return (
        <div className="flex items-center justify-between px-2.5 py-1 bg-slate-100/95 border-b border-black/5">
            <span className="text-[10px] font-mono font-bold tracking-wider uppercase text-slate-400">{label}</span>
            <div
                className="flex items-center gap-0.5 bg-slate-200/70 rounded-lg p-[2px]"
                onClick={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
            >
                <button className={btnCls(!showCode)} onClick={() => onToggle(false)}>{previewLabel}</button>
                <button className={btnCls(showCode)} onClick={() => onToggle(true)}>源码</button>
            </div>
        </div>
    );
};

// ============================================================
// HTML / CSS 沙盒预览
// ============================================================

export const HtmlPreviewBlock: React.FC<{
    /** HTML 片段或完整文档；CSS-only 围栏传空串 */
    html: string;
    /** 同一条消息里 ```css 围栏汇总，注入预览 */
    css?: string;
    /** 工具栏标签，默认 HTML */
    label?: string;
    /** 源码视图展示的原始代码（默认就是 html） */
    sourceCode?: string;
}> = ({ html, css, label = 'HTML', sourceCode }) => {
    const [showCode, setShowCode] = useState(false);
    const srcDoc = useMemo(() => buildHtmlPreviewSrcDoc(html, css), [html, css]);

    const handleLoad = (e: React.SyntheticEvent<HTMLIFrameElement>) => {
        try {
            const f = e.currentTarget as HTMLIFrameElement & { __richPreviewRO?: ResizeObserver };
            const doc = f.contentDocument;
            if (!doc || !doc.body) return;
            // 同 html_card：量内容真实高度并把 iframe 调成等高；超长内容兜底内部滚动
            const fit = () => {
                try {
                    const root = doc.documentElement;
                    const body = doc.body;
                    const natural = Math.max(body.scrollHeight, body.offsetHeight, root ? root.scrollHeight : 0);
                    f.style.height = Math.min(1600, Math.max(48, natural + 4)) + 'px';
                } catch { /* 读不到时静默 */ }
            };
            fit();
            f.__richPreviewRO?.disconnect();
            if (typeof ResizeObserver !== 'undefined') {
                const ro = new ResizeObserver(() => fit());
                ro.observe(doc.body);
                if (doc.documentElement) ro.observe(doc.documentElement);
                f.__richPreviewRO = ro;
            }
        } catch { /* 静默 */ }
    };

    return (
        <div
            className="my-1.5 max-w-full rounded-xl overflow-hidden border border-black/10 shadow-sm bg-white"
            style={{ width: 480 }}
            onClick={(e) => e.stopPropagation()}
        >
            <BlockHeader label={label} showCode={showCode} onToggle={setShowCode} />
            {showCode ? (
                <CodePre code={sourceCode ?? html} />
            ) : (
                <iframe
                    title="rich-html-preview"
                    srcDoc={srcDoc}
                    sandbox="allow-same-origin"
                    referrerPolicy="no-referrer"
                    loading="lazy"
                    className="block w-full border-0 bg-white"
                    style={{ height: 120 }}
                    onLoad={handleLoad}
                />
            )}
        </div>
    );
};

/** 同消息存在 HTML 预览时，```css 围栏折叠成「已应用」小条，点开可看源码。 */
export const CssAppliedChip: React.FC<{ code: string }> = ({ code }) => {
    const [open, setOpen] = useState(false);
    return (
        <div
            className="my-1.5 max-w-full rounded-xl overflow-hidden border border-black/10 bg-slate-50"
            onClick={(e) => e.stopPropagation()}
        >
            <button
                className="w-full flex items-center justify-between px-2.5 py-1.5 text-left select-none"
                onClick={() => setOpen(v => !v)}
            >
                <span className="text-[10px] font-mono font-bold tracking-wider uppercase text-slate-400">CSS</span>
                <span className="text-[10px] text-slate-400">样式已应用到预览 {open ? '▴' : '▾'}</span>
            </button>
            {open && <CodePre code={code} />}
        </div>
    );
};

// ============================================================
// Markdown 完整渲染（React 节点，无 innerHTML）
// ============================================================

/** 行内语法：`code`、图片、链接、**粗体**、~~删除线~~、*斜体* */
function mdInline(text: string, keyPrefix: string): React.ReactNode[] {
    const out: React.ReactNode[] = [];
    const re = /(`[^`\n]+`)|(!\[[^\]]*\]\(\s*[^)\s]+(?:\s+"[^"]*")?\s*\))|(\[[^\]]+\]\(\s*[^)\s]+(?:\s+"[^"]*")?\s*\))|(\*\*[^*\n]+\*\*)|(~~[^~\n]+~~)|(\*[^*\n]+\*)/g;
    let last = 0;
    let k = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        if (m.index > last) out.push(text.slice(last, m.index));
        const key = `${keyPrefix}-${k++}`;
        if (m[1]) {
            out.push(<code key={key} className="bg-black/10 px-1 py-0.5 rounded text-[12px] font-mono">{m[1].slice(1, -1)}</code>);
        } else if (m[2]) {
            const im = m[2].match(/^!\[([^\]]*)\]\(\s*([^)\s]+)/);
            if (im) out.push(<img key={key} src={im[2]} alt={im[1]} className="max-w-full rounded-lg my-1" loading="lazy" />);
        } else if (m[3]) {
            const lm = m[3].match(/^\[([^\]]+)\]\(\s*([^)\s]+)/);
            if (lm) {
                out.push(
                    <a key={key} href={lm[2]} target="_blank" rel="noopener noreferrer"
                        className="text-sky-600 underline underline-offset-2 break-all"
                        onClick={(e) => e.stopPropagation()}
                    >{mdInline(lm[1], key)}</a>
                );
            }
        } else if (m[4]) {
            out.push(<strong key={key} className="font-bold">{mdInline(m[4].slice(2, -2), key)}</strong>);
        } else if (m[5]) {
            out.push(<del key={key} className="opacity-70">{mdInline(m[5].slice(2, -2), key)}</del>);
        } else if (m[6]) {
            out.push(<em key={key} className="italic">{mdInline(m[6].slice(1, -1), key)}</em>);
        }
        last = m.index + m[0].length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
}

const HEADING_CLS: Record<number, string> = {
    1: 'text-[19px] font-bold mt-2 mb-1',
    2: 'text-[17px] font-bold mt-2 mb-1',
    3: 'text-[15px] font-bold mt-1.5 mb-0.5',
    4: 'text-[14px] font-bold mt-1.5 mb-0.5',
    5: 'text-[13px] font-bold mt-1 mb-0.5',
    6: 'text-[12.5px] font-bold mt-1 mb-0.5 opacity-80',
};

const TABLE_DIVIDER_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function splitTableRow(line: string): string[] {
    let t = line.trim();
    if (t.startsWith('|')) t = t.slice(1);
    if (t.endsWith('|')) t = t.slice(0, -1);
    return t.split('|').map(c => c.trim());
}

/** 块级语法：标题 / 引用 / 列表 / 表格 / 分隔线 / 代码围栏 / 段落 */
export function renderMarkdownBlocks(text: string): React.ReactNode[] {
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    const out: React.ReactNode[] = [];
    let i = 0;
    let key = 0;

    while (i < lines.length) {
        const line = lines[i];
        const trimmed = line.trim();

        if (!trimmed) { i++; continue; }

        // 嵌套代码围栏 → 普通代码块
        if (trimmed.startsWith('```')) {
            const buf: string[] = [];
            i++;
            while (i < lines.length && !lines[i].trim().startsWith('```')) { buf.push(lines[i]); i++; }
            i++; // 吃掉闭合 ```
            out.push(
                <pre key={key++} className="bg-black/80 text-gray-100 p-3 rounded-lg text-xs font-mono overflow-x-auto my-1.5 whitespace-pre">
                    {buf.join('\n')}
                </pre>
            );
            continue;
        }

        // 分隔线
        if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
            out.push(<div key={key++} className="my-2 border-t border-black/10" />);
            i++;
            continue;
        }

        // 标题
        const h = trimmed.match(/^(#{1,6})\s+(.*)$/);
        if (h) {
            const level = h[1].length;
            out.push(<div key={key} className={HEADING_CLS[level]}>{mdInline(h[2], `h${key}`)}</div>);
            key++;
            i++;
            continue;
        }

        // 引用（连续 > 行合并）
        if (trimmed.startsWith('>')) {
            const buf: string[] = [];
            while (i < lines.length && lines[i].trim().startsWith('>')) {
                buf.push(lines[i].trim().replace(/^>\s?/, ''));
                i++;
            }
            out.push(
                <div key={key} className="my-1.5 pl-2.5 border-l-[3px] border-slate-300 text-slate-500 italic">
                    {buf.map((q, qi) => <div key={qi}>{mdInline(q, `q${key}-${qi}`)}</div>)}
                </div>
            );
            key++;
            continue;
        }

        // 表格：本行含 |，下一行是 |---|--- 分隔
        if (trimmed.includes('|') && i + 1 < lines.length && TABLE_DIVIDER_RE.test(lines[i + 1]) && lines[i + 1].includes('-')) {
            const headers = splitTableRow(line);
            i += 2;
            const rows: string[][] = [];
            while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
                rows.push(splitTableRow(lines[i]));
                i++;
            }
            out.push(
                <div key={key} className="my-1.5 overflow-x-auto">
                    <table className="border-collapse text-[12px] min-w-full">
                        <thead>
                            <tr>
                                {headers.map((hc, hi) => (
                                    <th key={hi} className="border border-black/10 bg-black/5 px-2 py-1 text-left font-bold">{mdInline(hc, `th${key}-${hi}`)}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r, ri) => (
                                <tr key={ri}>
                                    {headers.map((_, ci) => (
                                        <td key={ci} className="border border-black/10 px-2 py-1 align-top">{mdInline(r[ci] ?? '', `td${key}-${ri}-${ci}`)}</td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            );
            key++;
            continue;
        }

        // 列表（连续的有序 / 无序行，按缩进分层）
        const listMatch = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
        if (listMatch) {
            const items: { depth: number; marker: string; text: string }[] = [];
            while (i < lines.length) {
                const lm = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
                if (!lm) break;
                items.push({ depth: Math.min(3, Math.floor(lm[1].length / 2)), marker: lm[2], text: lm[3] });
                i++;
            }
            out.push(
                <div key={key} className="my-1">
                    {items.map((it, ii) => {
                        const ordered = /\d/.test(it.marker);
                        return (
                            <div key={ii} className="flex gap-1.5 leading-relaxed" style={{ paddingLeft: it.depth * 14 }}>
                                <span className="shrink-0 select-none opacity-60">{ordered ? it.marker.replace(')', '.') : '•'}</span>
                                <span className="min-w-0">{mdInline(it.text, `li${key}-${ii}`)}</span>
                            </div>
                        );
                    })}
                </div>
            );
            key++;
            continue;
        }

        // 普通段落（逐行渲染，保留换行习惯）
        out.push(<div key={key} className="min-h-[1.2em]">{mdInline(line, `p${key}`)}</div>);
        key++;
        i++;
    }
    return out;
}

export const MarkdownPreviewBlock: React.FC<{ text: string }> = ({ text }) => {
    const [showCode, setShowCode] = useState(false);
    const blocks = useMemo(() => renderMarkdownBlocks(text), [text]);
    return (
        <div
            className="my-1.5 max-w-full rounded-xl overflow-hidden border border-black/10 shadow-sm bg-white"
            style={{ width: 480 }}
            onClick={(e) => e.stopPropagation()}
        >
            <BlockHeader label="Markdown" showCode={showCode} onToggle={setShowCode} previewLabel="渲染" />
            {showCode ? (
                <CodePre code={text} />
            ) : (
                <div className="px-3.5 py-2.5 text-[13px] leading-relaxed text-slate-800 break-words whitespace-normal select-text">
                    {blocks}
                </div>
            )}
        </div>
    );
};
