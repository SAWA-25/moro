import React from 'react';
import { CaretLeft } from '@phosphor-icons/react';

/**
 * insScrapKit —— 旧「黑白拼贴手账」套件（apps/theater/scrapbook.tsx）的 **Ins 风替身**。
 * ──────────────────────────────────────────────────────────
 * 导出名 / 签名与 scrapbook 完全一致，但渲染成清爽 ins 外观（白卡 + 大圆角 + 极柔投影 + 彩色）。
 * 用途：Shop / Study / Takeout / Theater / Harem 等原本 import scrapbook 的 App，
 *      只需把 import 路径改到这里，**调用点一行不改**即整体换成 ins。
 *
 * 注意：絮语(Chat) 的 ScrapModal / JournalSheet 仍 import 原 scrapbook（保持不动），互不影响。
 */

export const INK = '#2b2933';
export const INK_SOFT = '#8b8996';
export const PAPER = '#ffffff';

/** 暖白画布底（满屏 App 通用） */
export const PAGE_BG =
    'radial-gradient(120% 80% at 50% -10%, rgba(250,126,30,0.05), transparent 60%),' +
    'linear-gradient(176deg, #faf8f5 0%, #f7f5f2 60%, #f4f1ec 100%)';

/** 极淡圆点纹（替原网点半调，叠在标题块后；保持 backgroundImage 用法兼容） */
export const HALFTONE = 'radial-gradient(circle at 1px 1px, rgba(43,41,51,0.06) 1px, transparent 1.6px)';

export type WashiColor = 'rose' | 'amber' | 'sage' | 'sky' | 'lilac' | 'butter' | 'ink';
/** 七色映射到真实柔和色（不再灰阶）：胶带 / 便签 / 邮票 / 卡片用 */
export const WASHI: Record<WashiColor, { base: string; edge: string; ink: string }> = {
    rose:   { base: '#fecdd3', edge: 'rgba(255,255,255,0.7)', ink: '#9f1239' },
    amber:  { base: '#fde4b0', edge: 'rgba(255,255,255,0.7)', ink: '#92400e' },
    sage:   { base: '#cfe6cf', edge: 'rgba(255,255,255,0.7)', ink: '#3f6212' },
    sky:    { base: '#c2e6f7', edge: 'rgba(255,255,255,0.7)', ink: '#075985' },
    lilac:  { base: '#e6d6fb', edge: 'rgba(255,255,255,0.7)', ink: '#6b21a8' },
    butter: { base: '#fdebc4', edge: 'rgba(255,255,255,0.7)', ink: '#92400e' },
    ink:    { base: '#2b2933', edge: 'rgba(255,255,255,0.4)', ink: '#ffffff' },
};

export const TAPE_STRIPES =
    'repeating-linear-gradient(90deg, rgba(255,255,255,0.35) 0 5px, transparent 5px 11px)';

const SOFT_SHADOW = '0 1px 2px rgba(38,38,38,0.04), 0 18px 40px -28px rgba(38,38,38,0.30)';
const CARD_SHADOW = '0 1px 2px rgba(38,38,38,0.05), 0 16px 32px -22px rgba(38,38,38,0.32)';

/** 顶部柔光（替原噪点 + 胶带角） */
export const PaperBackdrop: React.FC<{ corners?: boolean }> = () => (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-56" style={{ background: 'radial-gradient(120% 90% at 50% -28%, rgba(250,126,30,0.07), transparent 70%)', zIndex: 0 }} />
);

export const PaperShell: React.FC<{ children: React.ReactNode; className?: string; style?: React.CSSProperties }> = ({ children, className = '', style }) => (
    <div className={`absolute inset-0 flex min-h-0 flex-col overflow-hidden animate-fade-in ${className}`} style={{ color: INK, background: PAGE_BG, ...style }}>
        <PaperBackdrop />
        {children}
    </div>
);

export const ScrapScroll: React.FC<{ children: React.ReactNode; className?: string; innerRef?: React.Ref<HTMLDivElement> }> = ({ children, className = '', innerRef }) => (
    <div
        ref={innerRef}
        className={`relative z-10 flex-1 min-h-0 overflow-y-auto overscroll-contain no-scrollbar ${className}`}
        style={{ WebkitOverflowScrolling: 'touch' }}
    >
        {children}
    </div>
);

export const WashiTape: React.FC<{ color?: WashiColor; rotate?: number; className?: string; style?: React.CSSProperties; children?: React.ReactNode }> = ({ color = 'ink', rotate = -3, className = '', style, children }) => {
    const c = WASHI[color];
    return (
        <span className={`inline-flex items-center justify-center select-none ${className}`}
            style={{ backgroundColor: c.base, backgroundImage: TAPE_STRIPES, boxShadow: '0 3px 7px -3px rgba(0,0,0,0.22)', transform: `rotate(${rotate}deg)`, color: c.ink, ...style }}>
            {children}
        </span>
    );
};

export const PaperCard: React.FC<{
    children: React.ReactNode; tilt?: number; tape?: WashiColor | null; pin?: boolean; className?: string; style?: React.CSSProperties;
    onClick?: () => void; onPointerDown?: (e: React.PointerEvent) => void; onPointerUp?: (e: React.PointerEvent) => void; onPointerLeave?: (e: React.PointerEvent) => void;
}> = ({ children, tilt = 0, tape = null, pin = false, className = '', style, onClick, onPointerDown, onPointerUp, onPointerLeave }) => (
    <div onClick={onClick} onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerLeave={onPointerLeave}
        className={`relative ${onClick ? 'press-soft cursor-pointer' : ''} ${className}`}
        style={{ background: '#ffffff', border: '1px solid rgba(0,0,0,0.05)', borderRadius: 20, boxShadow: CARD_SHADOW, transform: tilt ? `rotate(${tilt}deg)` : undefined, ...style }}>
        {tape && <WashiTape color={tape} rotate={-4} className="absolute -top-2.5 left-1/2 -translate-x-1/2 w-16 h-5 rounded-[3px] z-10" />}
        {pin && <span aria-hidden className="absolute -top-1.5 right-4 w-3.5 h-3.5 rounded-full z-10" style={{ background: 'radial-gradient(circle at 34% 30%, #fb7185, #e11d48)', boxShadow: '0 0 0 2px rgba(255,255,255,0.9), 0 3px 6px rgba(0,0,0,0.3)' }} />}
        {children}
    </div>
);

export const Stamp: React.FC<{ children: React.ReactNode; color?: WashiColor; size?: number; className?: string }> = ({ children, color = 'ink', size = 40, className = '' }) => {
    const c = WASHI[color];
    return (
        <span className={`relative inline-flex items-center justify-center shrink-0 ${className}`}
            style={{ width: size, height: size, borderRadius: 12, background: color === 'ink' ? INK : c.base, color: color === 'ink' ? '#fff' : c.ink, boxShadow: '0 4px 10px -6px rgba(0,0,0,0.3)' }}>
            {children}
        </span>
    );
};

/** 拍立得（默认彩色；grayscale 传 true 才去色——保留个别「黑白默片」模式的选择） */
export const Polaroid: React.FC<{
    src?: string; caption?: string; selected?: boolean; onClick?: () => void; rotate?: number; size?: number; fallback?: React.ReactNode; grayscale?: boolean;
}> = ({ src, caption, selected = false, onClick, rotate = 0, size = 56, fallback, grayscale = false }) => (
    <button onClick={onClick} className="relative shrink-0 press-soft" style={{ transform: `rotate(${rotate}deg)` }}>
        <div className="p-1.5 pb-5" style={{ background: '#ffffff', borderRadius: 8, boxShadow: selected ? '0 14px 28px -12px rgba(244,63,94,0.5), 0 0 0 2px #f43f5e' : '0 12px 24px -14px rgba(38,38,38,0.4)' }}>
            <div className="overflow-hidden" style={{ width: size, height: size, borderRadius: 4, background: '#efece7' }}>
                {src ? <img src={src} alt={caption || ''} className="w-full h-full object-cover" style={grayscale ? { filter: 'grayscale(1) contrast(1.04)' } : undefined} /> : <div className="w-full h-full flex items-center justify-center text-xl">{fallback}</div>}
            </div>
            {caption !== undefined && (
                <div className="absolute left-0 right-0 bottom-1 text-center px-1">
                    <span className="text-[11px] font-bold truncate block" style={{ color: selected ? '#e11d48' : '#5a5660', fontFamily: 'var(--font-hand)' }}>{caption}</span>
                </div>
            )}
        </div>
        {selected && <span aria-hidden className="absolute -top-2 -right-2 w-5 h-5 rounded-full flex items-center justify-center text-[11px] z-10 text-white" style={{ background: '#f43f5e', boxShadow: '0 2px 5px rgba(0,0,0,0.3)' }}>✓</span>}
    </button>
);

export const ScrapButton: React.FC<{
    children: React.ReactNode; variant?: 'ink' | 'paper' | 'ghost'; onClick?: () => void; disabled?: boolean; className?: string; icon?: React.ReactNode; type?: 'button' | 'submit'; title?: string;
}> = ({ children, variant = 'ink', onClick, disabled, className = '', icon, type = 'button', title }) => {
    const base = 'inline-flex items-center justify-center gap-1.5 font-bold rounded-full press-soft disabled:opacity-45 disabled:active:scale-100';
    const styles: Record<string, React.CSSProperties> = {
        ink: { background: INK, color: '#fff', boxShadow: '0 12px 24px -12px rgba(38,38,38,0.55)' },
        paper: { background: '#ffffff', color: INK, border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 8px 18px -12px rgba(38,38,38,0.4)' },
        ghost: { background: 'transparent', color: INK_SOFT, border: '1.5px solid rgba(0,0,0,0.1)' },
    };
    return <button type={type} onClick={onClick} disabled={disabled} title={title} className={`${base} ${className}`} style={styles[variant]}>{icon}{children}</button>;
};

export const StickyNote: React.FC<{ children: React.ReactNode; color?: WashiColor; rotate?: number; className?: string; style?: React.CSSProperties }> = ({ children, color = 'butter', rotate = 0, className = '', style }) => {
    const c = WASHI[color];
    return (
        <div className={`relative ${className}`} style={{ background: c.base, color: c.ink, borderRadius: 16, boxShadow: '0 12px 24px -16px rgba(38,38,38,0.4)', transform: rotate ? `rotate(${rotate}deg)` : undefined, ...style }}>
            {children}
        </div>
    );
};

export const SectionTag: React.FC<{ children: React.ReactNode; en?: string; color?: WashiColor; className?: string }> = ({ children, en, className = '' }) => (
    <div className={`flex items-center gap-2 ${className}`}>
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: '#f97316' }} />
        <span className="text-[13px] font-extrabold" style={{ color: INK }}>{children}</span>
        {en && <span className="text-[8px] tracking-[0.3em] uppercase" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>{en}</span>}
        <span className="flex-1 h-px" style={{ background: 'rgba(0,0,0,0.06)' }} />
    </div>
);

export const HandTitle: React.FC<{ en: string; cn?: string; className?: string }> = ({ en, cn, className = '' }) => (
    <div className={className}>
        <div className="leading-none" style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 32, color: INK }}>{en}</div>
        {cn && <div className="text-[13px] font-bold mt-1" style={{ color: INK_SOFT }}>{cn}</div>}
    </div>
);

export const DashedRule: React.FC<{ className?: string }> = ({ className = '' }) => (
    <div className={`h-px ${className}`} style={{ background: 'rgba(0,0,0,0.07)' }} />
);

export const ScrapHeader: React.FC<{ title: string; en?: string; onBack?: () => void; backLabel?: string; right?: React.ReactNode }> = ({ title, en, onBack, right }) => (
    <div className="relative z-20 shrink-0 px-3.5 pt-2.5 pb-2.5">
        <div className="flex items-center gap-2.5">
            {onBack ? (
                <button onClick={onBack} className="shrink-0 inline-flex items-center justify-center rounded-full press-soft" style={{ width: 38, height: 38, background: '#fff', color: INK, boxShadow: '0 4px 14px -6px rgba(38,38,38,0.28)', border: '1px solid rgba(0,0,0,0.05)' }} aria-label="返回">
                    <CaretLeft size={18} weight="bold" />
                </button>
            ) : <span />}
            <div className="leading-tight min-w-0">
                <div className="text-[17px] font-extrabold tracking-tight truncate" style={{ color: INK }}>{title}</div>
                {en && <div className="text-[8px] tracking-[0.34em] uppercase mt-0.5" style={{ fontFamily: 'var(--font-label)', color: '#f97316' }}>{en}</div>}
            </div>
            <div className="ml-auto">{right}</div>
        </div>
    </div>
);

export const PaperDialog: React.FC<{
    open: boolean; onClose?: () => void; title?: string; en?: string; children: React.ReactNode; actions?: React.ReactNode; tape?: WashiColor; maxWidth?: number;
}> = ({ open, onClose, title, en, children, actions, maxWidth = 340 }) => {
    if (!open) return null;
    return (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-6 animate-fade-in">
            <div className="absolute inset-0" style={{ background: 'rgba(28,26,24,0.42)', backdropFilter: 'blur(4px)' }} onClick={onClose} />
            <div className="relative w-full animate-pop-in" style={{ maxWidth, background: '#fff', borderRadius: 26, boxShadow: '0 40px 80px -28px rgba(20,18,16,0.5)' }}>
                <div className="px-6 pt-7 pb-5">
                    {(title || en) && (
                        <div className="text-center mb-3">
                            {en && <div className="text-[9px] tracking-[0.32em] uppercase mb-1.5" style={{ fontFamily: 'var(--font-label)', color: '#f97316' }}>{en}</div>}
                            {title && <h3 className="text-[19px] font-extrabold" style={{ color: INK }}>{title}</h3>}
                        </div>
                    )}
                    <div className="text-[13.5px] leading-relaxed text-center" style={{ color: '#5a5660' }}>{children}</div>
                </div>
                {actions && <div className="px-6 pb-6 flex gap-2.5">{actions}</div>}
            </div>
        </div>
    );
};

export const PaperSheet: React.FC<{ open: boolean; onClose?: () => void; title?: string; children: React.ReactNode; tape?: WashiColor }> = ({ open, onClose, title, children }) => {
    if (!open) return null;
    return (
        <div className="fixed inset-0 z-[120] flex items-end justify-center animate-fade-in">
            <div className="absolute inset-0" style={{ background: 'rgba(28,26,24,0.42)', backdropFilter: 'blur(4px)' }} onClick={onClose} />
            <div
                className="relative w-full animate-slide-up flex flex-col min-h-0"
                style={{
                    maxWidth: 460,
                    maxHeight: 'min(88vh, calc(var(--visual-viewport-height, 100vh) - var(--safe-top, 0px) - 12px))',
                    background: '#fff',
                    borderTopLeftRadius: 28,
                    borderTopRightRadius: 28,
                    boxShadow: '0 -22px 60px -24px rgba(20,18,16,0.45)',
                    paddingBottom: 'max(var(--safe-bottom, 0px), 16px)',
                }}
            >
                <div className="flex justify-center pt-3"><span className="w-10 h-1.5 rounded-full" style={{ background: '#e3e0da' }} /></div>
                {title && <div className="px-6 pt-3 text-center text-[15px] font-extrabold" style={{ color: INK }}>{title}</div>}
                <div className="min-h-0 overflow-y-auto no-scrollbar px-5 pt-3 pb-4" style={{ WebkitOverflowScrolling: 'touch' }}>{children}</div>
            </div>
        </div>
    );
};
