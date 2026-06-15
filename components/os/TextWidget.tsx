import React, { useEffect, useRef, useState } from 'react';
import { useOS } from '../../context/OSContext';

/**
 * 桌面「文字小组件」（手帐便签风）。
 * 内容存在 theme.textWidget（{title, body}），点一下即可就地编辑、保存到主题。
 * 编辑模式（桌面整理态）下不触发编辑，交给拖拽/抖动逻辑。
 */
const TextWidget: React.FC<{ contentColor: string }> = React.memo(({ contentColor }) => {
    const { theme, updateTheme } = useOS();
    const title = theme.textWidget?.title || '';
    const body = theme.textWidget?.body || '';

    const [editing, setEditing] = useState(false);
    const [draftTitle, setDraftTitle] = useState(title);
    const [draftBody, setDraftBody] = useState(body);
    const bodyRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (editing) { setDraftTitle(title); setDraftBody(body); setTimeout(() => bodyRef.current?.focus(), 30); }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editing]);

    const save = () => {
        updateTheme({ textWidget: { title: draftTitle.trim(), body: draftBody } });
        setEditing(false);
    };

    const isEmpty = !title.trim() && !body.trim();

    return (
        <div
            className="moro-widget-text glass-card relative h-full w-full rounded-[1.75rem] px-4 py-3.5 cursor-pointer press-soft animate-rise-in overflow-hidden flex flex-col"
            style={{ color: contentColor, animationDelay: '60ms' }}
            onClick={() => { if (!editing) setEditing(true); }}
        >
            {editing ? (
                <div className="flex flex-col h-full gap-1.5" onClick={e => e.stopPropagation()}>
                    <input
                        value={draftTitle}
                        onChange={e => setDraftTitle(e.target.value)}
                        placeholder="标题（可留空）"
                        className="bg-transparent text-[13px] font-bold outline-none border-b border-current/20 pb-1 placeholder:opacity-30"
                        style={{ color: contentColor }}
                    />
                    <textarea
                        ref={bodyRef}
                        value={draftBody}
                        onChange={e => setDraftBody(e.target.value)}
                        placeholder="写点什么贴在桌面上…"
                        className="flex-1 min-h-0 bg-transparent text-[12.5px] leading-relaxed outline-none resize-none placeholder:opacity-30"
                        style={{ color: contentColor, fontFamily: 'var(--font-hand)' }}
                    />
                    <div className="flex items-center justify-end gap-2 shrink-0">
                        <button onClick={() => setEditing(false)} className="text-[11px] opacity-50 px-2 py-1">取消</button>
                        <button onClick={save} className="text-[11px] font-bold px-3 py-1 rounded-full" style={{ background: 'rgba(0,0,0,0.08)' }}>存下</button>
                    </div>
                </div>
            ) : isEmpty ? (
                <div className="flex flex-col items-center justify-center h-full text-center gap-1 opacity-45">
                    <span className="text-[20px] leading-none">✎</span>
                    <span className="text-[10.5px]">点一下，写句话贴在这儿</span>
                </div>
            ) : (
                <div className="flex flex-col h-full min-h-0">
                    {title.trim() && <div className="text-[13px] font-bold leading-tight mb-1 shrink-0 truncate">{title}</div>}
                    <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar text-[12.5px] leading-relaxed whitespace-pre-wrap opacity-85" style={{ fontFamily: 'var(--font-hand)' }}>{body}</div>
                </div>
            )}
        </div>
    );
});

export default TextWidget;
