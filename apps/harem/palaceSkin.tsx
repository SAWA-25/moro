import React from 'react';
import { CaretLeft } from '@phosphor-icons/react';

export const INK = '#2a1214';
export const INK_SOFT = '#8b5e4d';
export const PAPER = '#fff7e8';
export const GOLD = '#c99a3a';
export const JADE = '#2f766d';
export const PAGE_BG =
    'radial-gradient(120% 70% at 50% -12%, rgba(230,188,92,0.28), transparent 62%),' +
    'linear-gradient(180deg, #4b0f16 0%, #731824 42%, #2b0d12 100%)';
export const HALFTONE = 'radial-gradient(circle at 1px 1px, rgba(201,154,58,0.16) 1px, transparent 1.8px)';

export type WashiColor = 'rose' | 'amber' | 'sage' | 'sky' | 'lilac' | 'butter' | 'ink';
const WASHI: Record<WashiColor, { base: string; ink: string; edge: string }> = {
    rose: { base: '#b9343f', ink: '#fff7e8', edge: 'rgba(255,231,168,0.45)' },
    amber: { base: '#d7a84a', ink: '#2a1214', edge: 'rgba(255,255,255,0.38)' },
    sage: { base: '#2f766d', ink: '#fff7e8', edge: 'rgba(255,255,255,0.35)' },
    sky: { base: '#315d8a', ink: '#fff7e8', edge: 'rgba(255,255,255,0.35)' },
    lilac: { base: '#6d4a7d', ink: '#fff7e8', edge: 'rgba(255,255,255,0.35)' },
    butter: { base: '#f4d48a', ink: '#4b1b16', edge: 'rgba(255,255,255,0.5)' },
    ink: { base: '#2a1214', ink: '#f8dc9f', edge: 'rgba(248,220,159,0.28)' },
};

const CARD_SHADOW = '0 18px 36px -24px rgba(42,8,12,0.75), inset 0 1px 0 rgba(255,255,255,0.65)';
const GOLD_BORDER = '1px solid rgba(201,154,58,0.45)';

export const PaperBackdrop: React.FC<{ corners?: boolean }> = () => (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden" style={{ zIndex: 0 }}>
        <div className="absolute inset-x-0 top-0 h-44" style={{ background: 'radial-gradient(80% 90% at 50% 0%, rgba(255,226,150,0.22), transparent 70%)' }} />
        <div className="absolute inset-0 opacity-[0.15]" style={{ backgroundImage: HALFTONE, backgroundSize: '9px 9px' }} />
        <div className="absolute inset-x-5 top-4 h-px" style={{ background: 'linear-gradient(90deg, transparent, rgba(248,220,159,0.6), transparent)' }} />
    </div>
);

export const PaperShell: React.FC<{ children: React.ReactNode; className?: string; style?: React.CSSProperties }> = ({ children, className = '', style }) => (
    <div className={`absolute inset-0 flex flex-col overflow-hidden animate-fade-in ${className}`} style={{ paddingTop: 'var(--safe-top)', color: INK, background: PAGE_BG, ...style }}>
        <PaperBackdrop />
        {children}
    </div>
);

export const ScrapScroll: React.FC<{ children: React.ReactNode; className?: string; innerRef?: React.Ref<HTMLDivElement> }> = ({ children, className = '', innerRef }) => (
    <div ref={innerRef} className={`relative z-10 flex-1 overflow-y-auto no-scrollbar ${className}`}>{children}</div>
);

export const WashiTape: React.FC<{ color?: WashiColor; rotate?: number; className?: string; style?: React.CSSProperties; children?: React.ReactNode }> = ({ color = 'amber', rotate = -3, className = '', style, children }) => {
    const c = WASHI[color];
    return (
        <span className={`inline-flex items-center justify-center select-none ${className}`}
            style={{ backgroundColor: c.base, color: c.ink, border: `1px solid ${c.edge}`, boxShadow: '0 6px 12px -8px rgba(42,8,12,0.7)', transform: `rotate(${rotate}deg)`, ...style }}>
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
        style={{ background: 'linear-gradient(180deg, #fffaf0, #f4dfb7)', border: GOLD_BORDER, borderRadius: 14, boxShadow: CARD_SHADOW, transform: tilt ? `rotate(${tilt}deg)` : undefined, ...style }}>
        {tape && <WashiTape color={tape} rotate={-3} className="absolute -top-2 left-1/2 -translate-x-1/2 w-16 h-4 rounded-[2px] z-10" />}
        {pin && <span aria-hidden className="absolute -top-1.5 right-4 w-3.5 h-3.5 rounded-full z-10" style={{ background: 'radial-gradient(circle at 35% 30%, #ffe6a0, #b77918)', boxShadow: '0 0 0 2px rgba(77,15,22,0.55)' }} />}
        {children}
    </div>
);

export const Stamp: React.FC<{ children: React.ReactNode; color?: WashiColor; size?: number; className?: string }> = ({ children, color = 'amber', size = 40, className = '' }) => {
    const c = WASHI[color];
    return <span className={`inline-flex items-center justify-center shrink-0 ${className}`} style={{ width: size, height: size, borderRadius: 999, background: c.base, color: c.ink, border: GOLD_BORDER, boxShadow: '0 8px 18px -12px rgba(42,8,12,0.8)' }}>{children}</span>;
};

export const Polaroid: React.FC<{
    src?: string; caption?: string; selected?: boolean; onClick?: () => void; rotate?: number; size?: number; fallback?: React.ReactNode; grayscale?: boolean;
}> = ({ src, caption, selected = false, onClick, rotate = 0, size = 56, fallback, grayscale = false }) => (
    <button onClick={onClick} className="relative shrink-0 press-soft" style={{ transform: `rotate(${rotate}deg)` }}>
        <div className="p-1.5 pb-5" style={{ background: '#fff7e8', borderRadius: 10, border: selected ? '2px solid #d7a84a' : GOLD_BORDER, boxShadow: selected ? '0 14px 28px -14px rgba(255,214,122,0.7)' : CARD_SHADOW }}>
            <div className="overflow-hidden" style={{ width: size, height: size, borderRadius: 6, background: '#e6c98e' }}>
                {src ? <img src={src} alt={caption || ''} className="w-full h-full object-cover" style={grayscale ? { filter: 'grayscale(1) contrast(1.04)' } : undefined} /> : <div className="w-full h-full flex items-center justify-center text-xl">{fallback}</div>}
            </div>
            {caption !== undefined && <div className="absolute left-0 right-0 bottom-1 text-center px-1"><span className="text-[11px] font-bold truncate block" style={{ color: selected ? '#8a1f2b' : INK }}>{caption}</span></div>}
        </div>
        {selected && <span aria-hidden className="absolute -top-2 -right-2 w-5 h-5 rounded-full flex items-center justify-center text-[11px] z-10" style={{ background: '#d7a84a', color: INK }}>✓</span>}
    </button>
);

export const ScrapButton: React.FC<{
    children: React.ReactNode; variant?: 'ink' | 'paper' | 'ghost'; onClick?: () => void; disabled?: boolean; className?: string; icon?: React.ReactNode; type?: 'button' | 'submit'; title?: string;
}> = ({ children, variant = 'ink', onClick, disabled, className = '', icon, type = 'button', title }) => {
    const styles: Record<string, React.CSSProperties> = {
        ink: { background: 'linear-gradient(180deg, #a32330, #68151f)', color: '#fff7e8', border: '1px solid rgba(248,220,159,0.45)', boxShadow: '0 14px 28px -18px rgba(42,8,12,0.85)' },
        paper: { background: '#fff7e8', color: INK, border: GOLD_BORDER, boxShadow: CARD_SHADOW },
        ghost: { background: 'rgba(255,247,232,0.08)', color: '#f8dc9f', border: '1px solid rgba(248,220,159,0.32)' },
    };
    return <button type={type} onClick={onClick} disabled={disabled} title={title} className={`inline-flex items-center justify-center gap-1.5 font-bold rounded-full press-soft disabled:opacity-45 disabled:active:scale-100 ${className}`} style={styles[variant]}>{icon}{children}</button>;
};

export const StickyNote: React.FC<{ children: React.ReactNode; color?: WashiColor; rotate?: number; className?: string; style?: React.CSSProperties }> = ({ children, color = 'butter', rotate = 0, className = '', style }) => {
    const c = WASHI[color];
    return <div className={`relative ${className}`} style={{ background: c.base, color: c.ink, borderRadius: 14, border: GOLD_BORDER, boxShadow: CARD_SHADOW, transform: rotate ? `rotate(${rotate}deg)` : undefined, ...style }}>{children}</div>;
};

export const SectionTag: React.FC<{ children: React.ReactNode; en?: string; color?: WashiColor; className?: string }> = ({ children, en, className = '' }) => (
    <div className={`flex items-center gap-2 ${className}`}>
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: GOLD }} />
        <span className="text-[13px] font-extrabold" style={{ color: INK }}>{children}</span>
        {en && <span className="text-[8px] tracking-[0.3em] uppercase" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>{en}</span>}
        <span className="flex-1 h-px" style={{ background: 'rgba(201,154,58,0.32)' }} />
    </div>
);

export const HandTitle: React.FC<{ en: string; cn?: string; className?: string }> = ({ en, cn, className = '' }) => (
    <div className={className}>
        <div className="leading-none" style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 32, color: INK }}>{en}</div>
        {cn && <div className="text-[13px] font-bold mt-1" style={{ color: INK_SOFT }}>{cn}</div>}
    </div>
);

export const DashedRule: React.FC<{ className?: string }> = ({ className = '' }) => (
    <div className={`h-px ${className}`} style={{ background: 'linear-gradient(90deg, transparent, rgba(201,154,58,0.55), transparent)' }} />
);

export const ScrapHeader: React.FC<{ title: string; en?: string; onBack?: () => void; backLabel?: string; right?: React.ReactNode }> = ({ title, en, onBack, right }) => (
    <div className="relative z-20 shrink-0 px-3.5 pt-2.5 pb-2.5">
        <div className="flex items-center gap-2.5">
            {onBack ? <button onClick={onBack} className="shrink-0 inline-flex items-center justify-center rounded-full press-soft" style={{ width: 38, height: 38, background: 'rgba(255,247,232,0.94)', color: INK, boxShadow: CARD_SHADOW, border: GOLD_BORDER }} aria-label="返回"><CaretLeft size={18} weight="bold" /></button> : <span />}
            <div className="leading-tight min-w-0">
                <div className="text-[17px] font-extrabold tracking-tight truncate" style={{ color: '#fff7e8' }}>{title}</div>
                {en && <div className="text-[8px] tracking-[0.34em] uppercase mt-0.5" style={{ fontFamily: 'var(--font-label)', color: '#f8dc9f' }}>{en}</div>}
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
            <div className="absolute inset-0" style={{ background: 'rgba(25,5,9,0.62)', backdropFilter: 'blur(4px)' }} onClick={onClose} />
            <div className="relative w-full animate-pop-in" style={{ maxWidth, background: 'linear-gradient(180deg, #fffaf0, #efd5a2)', borderRadius: 20, border: GOLD_BORDER, boxShadow: '0 40px 80px -28px rgba(20,4,8,0.75)' }}>
                <div className="px-6 pt-7 pb-5">
                    {(title || en) && <div className="text-center mb-3">{en && <div className="text-[9px] tracking-[0.32em] uppercase mb-1.5" style={{ fontFamily: 'var(--font-label)', color: '#9a6d23' }}>{en}</div>}{title && <h3 className="text-[19px] font-extrabold" style={{ color: INK }}>{title}</h3>}</div>}
                    <div className="text-[13.5px] leading-relaxed text-center" style={{ color: '#5d3329' }}>{children}</div>
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
            <div className="absolute inset-0" style={{ background: 'rgba(25,5,9,0.62)', backdropFilter: 'blur(4px)' }} onClick={onClose} />
            <div className="relative w-full animate-slide-up" style={{ maxWidth: 460, background: 'linear-gradient(180deg, #fffaf0, #efd5a2)', borderTopLeftRadius: 24, borderTopRightRadius: 24, border: GOLD_BORDER, boxShadow: '0 -22px 60px -24px rgba(20,4,8,0.7)', paddingBottom: 'max(env(safe-area-inset-bottom), 16px)' }}>
                <div className="flex justify-center pt-3"><span className="w-10 h-1.5 rounded-full" style={{ background: 'rgba(138,31,43,0.3)' }} /></div>
                {title && <div className="px-6 pt-3 text-center text-[15px] font-extrabold" style={{ color: INK }}>{title}</div>}
                <div className="px-5 pt-3 pb-4">{children}</div>
            </div>
        </div>
    );
};
