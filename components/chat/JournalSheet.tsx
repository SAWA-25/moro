import React from 'react';
import { PaperKind, MONO_STACK } from '../handbook/paper';

/**
 * 絮语 · 聊天功能弹层套件
 * ──────────────────────────────────────────────
 * 保留 JournalSheet / SealBtn / CandyToggle 等旧导出名，视觉统一为 Ins 风：
 * 白色底部抽屉、淡玫瑰发丝线、柔和阴影和干净输入控件。
 */

const INK = '#5a3140';
const INK_SOFT = '#a892a3';
const ACCENT = '#d8a5b7';
const ACCENT_SOFT = '#fff4f7';
const PANEL_FILL = 'linear-gradient(180deg,#ffffff 0%,#fbfaf8 100%)';
const FIELD_FILL = 'rgba(255,255,255,0.94)';
const EDGE = '#eed6df';
const HAZARD = 'linear-gradient(120deg,#fff7f9,#ffe8ee)';
const toneFor = (_seed?: string) => ({ solid: ACCENT, soft: ACCENT_SOFT, ink: INK });

export const JournalSheet: React.FC<{
    open: boolean;
    title: string;
    en?: string;
    sub?: string;
    tape?: string;
    pattern?: string;
    paper?: PaperKind;
    onClose: () => void;
    children: React.ReactNode;
    footer?: React.ReactNode;
    tall?: boolean;
    zClass?: string;
}> = ({ open, title, en, sub, tape = 'rose', pattern, paper, onClose, children, footer, tall, zClass = 'z-[100]' }) => {
    if (!open) return null;
    const a = toneFor(tape);
    const legacyDecorKey = `${pattern || ''}${paper || ''}`;
    return (
        <div className={`fixed inset-0 ${zClass} flex items-end sm:items-center justify-center animate-fade-in`}>
            <div
                className="absolute inset-0"
                style={{ background: 'rgba(28,26,24,0.42)', backdropFilter: 'blur(4px)' }}
                onClick={onClose}
            />
            <div
                className="relative w-full sm:max-w-[26rem] flex flex-col animate-slide-up rounded-t-[28px] sm:rounded-[28px] overflow-hidden"
                data-decor={legacyDecorKey}
                style={{
                    background: PANEL_FILL,
                    maxHeight: tall ? 'min(88vh, calc(100dvh - 18px))' : 'min(80vh, calc(100dvh - 18px))',
                    paddingBottom: 'var(--safe-bottom)',
                    border: `1px solid ${EDGE}`,
                    boxShadow: '0 -22px 60px -24px rgba(20,18,16,0.42), 0 24px 60px -24px rgba(20,18,16,0.35)',
                    color: INK,
                }}
                onClick={e => e.stopPropagation()}
            >
                <div className="flex justify-center pt-3 sm:hidden"><span className="w-10 h-1.5 rounded-full" style={{ background: '#e3e0da' }} /></div>
                <div aria-hidden className="absolute inset-x-0 top-0 h-px" style={{ background: 'linear-gradient(90deg, transparent, #efd2dc, transparent)' }} />
                <div className="shrink-0 flex items-start justify-between gap-3 px-4 pt-4 pb-3 relative z-[1]" style={{ borderBottom: `1px solid ${EDGE}` }}>
                    <div className="min-w-0 pt-0.5">
                        {en && <div className="text-[8.5px] tracking-[0.24em] uppercase select-none" style={{ ...MONO_STACK, color: a.solid }}>{en}</div>}
                        <div className="text-[16px] font-extrabold leading-tight mt-0.5" style={{ color: INK }}>{title}</div>
                        {sub && <div className="text-[10.5px] mt-0.5" style={{ color: INK_SOFT }}>{sub}</div>}
                    </div>
                    <button
                        onClick={onClose}
                        aria-label="关闭"
                        className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center active:scale-90 transition-transform"
                        style={{ background: '#fff', border: `1px solid ${EDGE}`, color: INK, boxShadow: '0 4px 14px -10px rgba(38,38,38,0.35)' }}
                    >
                        <span className="text-[13px] leading-none" aria-hidden>✕</span>
                    </button>
                </div>
                <div className="flex-1 min-h-[120px] overflow-y-auto overscroll-contain no-scrollbar px-4 pt-4 pb-5 relative z-[1]">
                    {children}
                </div>
                {footer && (
                    <div className="shrink-0 flex gap-2.5 px-4 py-3.5 relative z-[1]" style={{ borderTop: `1px solid ${EDGE}` }}>
                        {footer}
                    </div>
                )}
            </div>
        </div>
    );
};

export const SealBtn: React.FC<{
    kind?: 'rose' | 'ghost' | 'ink' | 'berry' | 'mint';
    onClick?: () => void;
    disabled?: boolean;
    full?: boolean;
    children: React.ReactNode;
}> = ({ kind = 'rose', onClick, disabled, full, children }) => {
    const a = toneFor(kind);
    const solid = kind === 'rose' || kind === 'berry' || kind === 'ink';
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={`${full ? 'w-full' : 'flex-1'} py-3 px-3 rounded-full text-[13px] font-bold flex items-center justify-center gap-1.5 transition-transform active:scale-[0.97] disabled:opacity-40 disabled:active:scale-100`}
            style={solid
                ? { background: kind === 'ink' ? INK : a.solid, color: '#fff', boxShadow: '0 10px 22px -14px rgba(122,90,114,0.45)' }
                : { background: a.soft, border: `1px solid ${a.solid}26`, color: a.ink }}
        >
            {children}
        </button>
    );
};

export const CandyToggle: React.FC<{ on: boolean; onToggle: () => void; candy?: string }> = ({ on, onToggle }) => {
    const onColor = ACCENT;
    return (
        <button
            onClick={onToggle} role="switch" aria-checked={on}
            className="relative w-[52px] h-[28px] shrink-0 rounded-full transition-all duration-300 active:scale-95"
            style={{
                background: on ? onColor : '#ebe7e2',
                boxShadow: on ? `0 8px 16px -12px ${onColor}` : 'inset 0 1px 2px rgba(38,38,38,0.08)',
            }}
        >
            <span className="absolute top-1/2 -translate-y-1/2 text-[8px] font-bold transition-opacity duration-300 pointer-events-none" style={{ ...MONO_STACK, left: 8, color: 'rgba(255,255,255,0.95)', opacity: on ? 1 : 0 }}>ON</span>
            <span className="absolute top-1/2 -translate-y-1/2 text-[8px] font-bold transition-opacity duration-300 pointer-events-none" style={{ ...MONO_STACK, right: 7, color: INK_SOFT, opacity: on ? 0 : 1 }}>off</span>
            <span
                className="absolute top-1/2 -translate-y-1/2 w-[22px] h-[22px] rounded-full bg-white transition-all duration-300"
                style={{ left: on ? 27 : 3, boxShadow: '0 2px 6px rgba(38,38,38,0.22)' }}
            />
        </button>
    );
};

export const StickerChip: React.FC<{
    active: boolean; onClick: () => void; seed: string;
    candy?: string; disabled?: boolean; title?: string; children: React.ReactNode;
}> = ({ active, onClick, seed, candy, disabled, title, children }) => {
    const activeColor = candy ? ACCENT_SOFT : ACCENT_SOFT;
    return (
        <button
            onClick={onClick} title={title} disabled={disabled} data-seed={seed}
            className="px-3 py-1.5 text-[11px] font-bold transition-transform active:scale-95 max-w-full truncate disabled:opacity-40 rounded-full"
            style={active
                ? { background: activeColor, color: INK, border: `1px solid ${EDGE}`, boxShadow: '0 6px 14px -12px rgba(122,90,114,0.35)' }
                : { background: '#fff', color: INK_SOFT, border: `1px solid ${EDGE}` }}
        >{children}</button>
    );
};

const inputShellStyle: React.CSSProperties = {
    background: FIELD_FILL,
    border: `1px solid ${EDGE}`,
    borderRadius: 16,
    boxShadow: 'inset 0 1px 2px rgba(38,38,38,0.03)',
};

export const LinedInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { tag?: string }>(
    ({ tag, className = '', style, ...rest }, ref) => (
        <div className="w-full">
            {tag && <div className="text-[9px] mb-1 tracking-wider" style={{ ...MONO_STACK, color: INK_SOFT }}>{tag}</div>}
            <input
                ref={ref}
                {...rest}
                className={`w-full px-3 py-2 text-[13px] outline-none placeholder:text-slate-400 ${className}`}
                style={{ ...inputShellStyle, color: INK, caretColor: ACCENT, ...style }}
            />
        </div>
    )
);
LinedInput.displayName = 'LinedInput';

export const LinedArea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
    ({ className = '', style, ...rest }, ref) => (
        <textarea
            ref={ref}
            {...rest}
            className={`w-full rounded-[16px] px-3 py-2 text-[12.5px] resize-none outline-none placeholder:text-slate-400 ${className}`}
            style={{
                ...inputShellStyle,
                lineHeight: '22px',
                color: INK,
                caretColor: ACCENT,
                ...style,
            }}
        />
    )
);
LinedArea.displayName = 'LinedArea';

export const NoteStrip: React.FC<{ tone?: 'info' | 'warn' | 'good' | 'danger'; children: React.ReactNode }> = ({ tone = 'info', children }) => {
    const palette = {
        info:   { bg: '#f8fafc', border: EDGE, mark: 'i', fg: INK_SOFT, markBg: '#e2e8f0', markFg: '#475569' },
        warn:   { bg: '#fff7ed', border: 'rgba(245,158,11,0.25)', mark: '!', fg: '#92400e', markBg: '#fed7aa', markFg: '#9a3412' },
        good:   { bg: '#ecfdf5', border: 'rgba(16,185,129,0.22)', mark: '✓', fg: '#047857', markBg: '#bbf7d0', markFg: '#047857' },
        danger: { bg: '#fff1f2', border: 'rgba(239,68,68,0.22)', mark: '!', fg: '#b91c1c', markBg: HAZARD, markFg: '#fff' },
    }[tone];
    return (
        <div className="flex items-start gap-2 rounded-[16px] px-3 py-2.5" style={{ background: palette.bg, border: `1px solid ${palette.border}` }}>
            <span className="w-4 h-4 rounded-full text-[10px] font-bold shrink-0 leading-4 text-center mt-0.5" style={{ background: palette.markBg, color: palette.markFg }} aria-hidden>{palette.mark}</span>
            <div className="text-[10.5px] leading-relaxed" style={{ color: palette.fg }}>{children}</div>
        </div>
    );
};

export default JournalSheet;
