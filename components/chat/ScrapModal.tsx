import React from 'react';

/**
 * 絮语 · Ins / Polaroid 弹窗套件（ScrapModal compatibility layer）
 * ──────────────────────────────────────────────
 * 保留旧的 Scrap* 导出名，内部视觉改为私聊设置同款淡色系：
 * 暖白卡片、浅玫瑰发丝线、柔和阴影和圆润图标。业务调用无需改 import。
 */

export const INK = '#5a3140';
export const INK_SOFT = '#a892a3';
const ACCENT = '#d8a5b7';
const ACCENT_SOFT = '#fff4f7';
const PANEL_FILL = 'linear-gradient(180deg,#ffffff 0%,#fbfaf8 100%)';
const FIELD_FILL = 'rgba(255,255,255,0.9)';
const EDGE = '#eed6df';
const SOFT_SHADOW = '0 30px 70px -34px rgba(38,38,38,0.58), 0 1px 2px rgba(38,38,38,0.05)';
export const HAZARD = 'linear-gradient(120deg,#fff7f9,#ffe8ee)';
export const TAPE_STRIPES = 'linear-gradient(90deg,#f7e6ed,#fffdfa,#efd2dc)';
const toneFor = (_tape?: string) => ({ solid: ACCENT, soft: ACCENT_SOFT, ink: INK });

interface ScrapModalProps {
    isOpen: boolean;
    title: string;
    onClose: () => void;
    children: React.ReactNode;
    footer?: React.ReactNode;
    en?: string;
    icon?: React.ReactNode;
    tape?: string;
    maxWidth?: number;
    closeLabel?: string;
}

const ScrapModal: React.FC<ScrapModalProps> = ({
    isOpen, title, onClose, children, footer, en, icon, tape = 'rose', maxWidth = 358, closeLabel = '关闭',
}) => {
    if (!isOpen) return null;
    const a = toneFor(tape);
    return (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-5 animate-fade-in">
            <div className="absolute inset-0" style={{ background: 'rgba(28,26,24,0.42)', backdropFilter: 'blur(4px)' }} onClick={onClose} />
            <div
                className="relative w-full animate-pop-in flex flex-col overflow-hidden"
                style={{
                    maxWidth,
                    maxHeight: '84vh',
                    background: PANEL_FILL,
                    border: `1px solid ${EDGE}`,
                    borderRadius: 26,
                    boxShadow: SOFT_SHADOW,
                    color: INK,
                }}
            >
                <div aria-hidden className="absolute inset-x-0 top-0 h-px" style={{ background: 'linear-gradient(90deg, transparent, #efd2dc, transparent)' }} />
                <div className="px-6 pt-7 pb-3 text-center shrink-0 relative z-[1]">
                    {en && <div className="text-[9px] tracking-[0.32em] uppercase mb-1.5" style={{ fontFamily: 'var(--font-label)', color: a.solid }}>{en}</div>}
                    <div className="flex items-center justify-center gap-2">
                        {icon}
                        <h3 className="text-[18px] font-extrabold leading-tight" style={{ color: INK }}>{title}</h3>
                    </div>
                    <div className="mx-auto mt-3 h-px w-16" style={{ background: `linear-gradient(90deg, transparent, ${a.solid}99, transparent)` }} />
                </div>

                <div className="px-6 pb-2 overflow-y-auto no-scrollbar relative z-[1]" style={{ color: '#5a5660' }}>
                    {children}
                </div>

                {footer ? (
                    <div className="px-6 pt-3 pb-6 flex gap-2.5 shrink-0 relative z-[1]">{footer}</div>
                ) : (
                    <div className="px-6 pt-3 pb-6 shrink-0 relative z-[1]">
                        <ScrapBtn variant="paper" onClick={onClose}>{closeLabel}</ScrapBtn>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ScrapModal;

export const ScrapBtn: React.FC<{
    children: React.ReactNode;
    onClick?: () => void;
    variant?: 'ink' | 'paper' | 'ghost' | 'danger';
    disabled?: boolean;
    icon?: React.ReactNode;
    className?: string;
    full?: boolean;
    type?: 'button' | 'submit';
    title?: string;
}> = ({ children, onClick, variant = 'ink', disabled, icon, className = '', full = true, type = 'button', title }) => {
    const a = toneFor();
    const base = `relative inline-flex items-center justify-center gap-1.5 font-bold rounded-full transition-transform active:scale-[0.96] disabled:opacity-45 disabled:active:scale-100 ${full ? 'w-full' : ''}`;
    const styles: Record<string, React.CSSProperties> = {
        ink: { background: ACCENT, color: '#fff', boxShadow: '0 10px 22px -14px rgba(122,90,114,0.45)' },
        paper: { background: '#fffdfa', color: INK, border: `1px solid ${EDGE}`, boxShadow: '0 8px 18px -16px rgba(122,90,114,0.28)' },
        ghost: { background: 'transparent', color: a.ink, border: `1px solid ${EDGE}` },
        danger: { background: '#fff5f7', color: '#d4536f', border: '1px solid #f1c6d1', boxShadow: '0 8px 18px -16px rgba(212,83,111,0.35)' },
    };
    return (
        <button type={type} onClick={onClick} disabled={disabled} title={title} className={`${base} py-3 px-4 ${className}`} style={styles[variant]}>
            {icon}{children}
        </button>
    );
};

const fieldStyle: React.CSSProperties = {
    background: FIELD_FILL,
    border: `1px solid ${EDGE}`,
    borderRadius: 16,
    color: INK,
    boxShadow: 'inset 0 1px 2px rgba(38,38,38,0.03)',
};

export const ScrapInput: React.FC<React.InputHTMLAttributes<HTMLInputElement> & { center?: boolean; big?: boolean }> = ({ className = '', center, big, style, ...props }) => (
    <input
        {...props}
        className={`w-full px-4 outline-none transition-all placeholder:text-slate-400 ${big ? 'py-4 text-2xl font-extrabold text-center' : center ? 'py-3 text-sm text-center' : 'py-3 text-sm'} ${className}`}
        style={{ ...fieldStyle, ...style }}
    />
);

export const ScrapTextarea: React.FC<React.TextareaHTMLAttributes<HTMLTextAreaElement>> = ({ className = '', style, ...props }) => (
    <textarea
        {...props}
        className={`w-full px-4 py-3 text-sm leading-relaxed outline-none resize-none transition-all placeholder:text-slate-400 ${className}`}
        style={{ ...fieldStyle, ...style }}
    />
);

export const ScrapLabel: React.FC<{ children: React.ReactNode; en?: string; className?: string }> = ({ children, en, className = '' }) => {
    const a = toneFor();
    return (
        <div className={`flex items-center gap-2 mb-2.5 ${className}`}>
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: a.solid }} />
            <span className="text-[12px] font-extrabold tracking-tight shrink-0" style={{ color: INK }}>{children}</span>
            {en && <span className="text-[8px] tracking-[0.28em] uppercase shrink-0" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>{en}</span>}
            <span className="flex-1 h-px" style={{ background: EDGE }} />
        </div>
    );
};

export const ScrapNote: React.FC<{ children: React.ReactNode; className?: string; center?: boolean }> = ({ children, className = '', center }) => (
    <p className={`text-[10.5px] leading-snug ${center ? 'text-center' : ''} ${className}`} style={{ color: INK_SOFT }}>{children}</p>
);

export const ScrapDivider: React.FC<{ className?: string }> = ({ className = '' }) => (
    <div className={`h-px ${className}`} style={{ background: EDGE }} />
);

export const ScrapPickTile: React.FC<{
    src?: string;
    label: string;
    selected?: boolean;
    onClick?: () => void;
    badge?: React.ReactNode;
    dim?: boolean;
}> = ({ src, label, selected, onClick, badge, dim }) => {
    const a = toneFor();
    return (
        <button
            onClick={onClick}
            className="relative flex flex-col items-center gap-1 p-2 transition-transform active:scale-95"
            style={{
                background: selected ? a.soft : '#fff',
                border: `1px solid ${selected ? a.solid : EDGE}`,
                borderRadius: 18,
                boxShadow: selected ? `0 12px 24px -18px ${a.solid}` : '0 1px 2px rgba(38,38,38,0.04)',
            }}
        >
            <div className="relative">
                <img src={src} className="w-10 h-10 rounded-full object-cover" style={dim ? { filter: 'saturate(.65)', opacity: 0.55 } : undefined} alt="" />
                {badge && <span className="absolute -top-1 -right-1">{badge}</span>}
                {selected && (
                    <span aria-hidden className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center text-[9px] text-white" style={{ background: a.solid, boxShadow: '0 1px 3px rgba(38,38,38,0.3)' }}>✓</span>
                )}
            </div>
            <span className="text-[9px] truncate w-full text-center font-bold" style={{ color: selected ? a.ink : '#5a5660' }}>{label}</span>
        </button>
    );
};

export const ScrapChip: React.FC<{
    children: React.ReactNode;
    selected?: boolean;
    onClick?: () => void;
    icon?: React.ReactNode;
    className?: string;
}> = ({ children, selected, onClick, icon, className = '' }) => {
    const a = toneFor();
    return (
        <button
            onClick={onClick}
            className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-bold transition-transform active:scale-95 ${className}`}
            style={selected
                ? { background: a.solid, color: '#fff', boxShadow: `0 8px 18px -12px ${a.solid}` }
                : { background: '#fff', color: INK_SOFT, border: `1px solid ${EDGE}` }}
        >
            {icon}{children}
        </button>
    );
};

export const ScrapRowBtn: React.FC<{
    children: React.ReactNode;
    onClick?: () => void;
    icon?: React.ReactNode;
    avatar?: string;
    avatarDim?: boolean;
    trailing?: React.ReactNode;
    danger?: boolean;
    disabled?: boolean;
    className?: string;
}> = ({ children, onClick, icon, avatar, avatarDim, trailing, danger, disabled, className = '' }) => {
    const a = toneFor();
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-transform active:scale-[0.98] disabled:opacity-40 ${className}`}
            style={{
                background: danger ? '#fff5f6' : '#fff',
                border: `1px solid ${danger ? 'rgba(239,68,68,0.18)' : EDGE}`,
                borderRadius: 18,
                color: danger ? '#dc2626' : INK,
                boxShadow: '0 1px 2px rgba(38,38,38,0.04)',
            }}
        >
            {avatar && <img src={avatar} className="w-9 h-9 rounded-full object-cover shrink-0" style={avatarDim ? { filter: 'saturate(.65)', opacity: 0.55 } : undefined} alt="" />}
            {icon && <span className="shrink-0 flex items-center" style={{ color: danger ? '#dc2626' : a.solid }}>{icon}</span>}
            <span className="flex-1 min-w-0 text-sm font-bold truncate">{children}</span>
            {trailing}
        </button>
    );
};

export const ScrapStamp: React.FC<{ children: React.ReactNode; size?: number }> = ({ children, size = 30 }) => {
    const a = toneFor();
    return (
        <span
            className="relative inline-flex items-center justify-center shrink-0 rounded-full"
            style={{
                width: size,
                height: size,
                background: a.soft,
                color: a.solid,
                border: `1px solid ${a.solid}22`,
                boxShadow: `0 8px 18px -14px ${a.solid}`,
            }}
        >
            {children}
        </span>
    );
};
