import React from 'react';

/**
 * 小剧场 · 拼贴手账设计套件（Scrapbook Collage Kit）
 * ──────────────────────────────────────────────────────────
 * 小剧场（封面 + 攻略本 / TRPG / 番外 / 谈心 / 轨迹 / 对影）统一换肤用的可复用积木。
 * 风格＝牛皮纸 + 和纸胶带 + 缝线描边 + 拍立得 + 邮票 + 手写体，呼应 index.html 里
 * 已有的全局手账系统（--font-hand / --font-display / --font-label / .scrap-btn …）。
 *
 * 约束：这一层只管「长什么样」。所有业务逻辑、数据、handler 仍留在各 App 里，
 * 换肤不改变、不减少任何功能。
 *
 * 注：Caveat（--font-hand）/ Playfair（--font-display）只覆盖拉丁字母与数字，
 * 中文会回落到 Quicksand/Noto；所以手写/衬线体只用在英文小标与数字上，
 * 中文标题用干净的粗体——与 Moro 既有手账桌面一致。
 */

// ── 调色：纸面与和纸胶带 ──────────────────────────────────────
export const INK = '#3a3630';
export const INK_SOFT = '#8b8576';
export const PAPER = '#fcf8ef';

/** 暖纸页底（封面/各子页通用） */
export const PAGE_BG =
    'radial-gradient(120% 78% at 50% -12%, rgba(236,206,160,0.42), transparent 60%),' +
    'radial-gradient(86% 60% at 112% 8%, rgba(212,180,206,0.30), transparent 58%),' +
    'radial-gradient(88% 62% at -12% 26%, rgba(184,206,182,0.28), transparent 58%),' +
    'linear-gradient(176deg, #f4ecdb 0%, #efe5d0 52%, #ece1c9 100%)';

/** 极淡纸纹噪点（叠在页底上，叫人想起牛皮纸的颗粒） */
const GRAIN =
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.55'/%3E%3C/svg%3E\")";

export type WashiColor = 'rose' | 'amber' | 'sage' | 'sky' | 'lilac' | 'butter' | 'ink';
export const WASHI: Record<WashiColor, { base: string; edge: string; ink: string }> = {
    rose:   { base: 'rgba(226,152,142,0.66)', edge: 'rgba(186,116,108,0.55)', ink: '#9c4f47' },
    amber:  { base: 'rgba(232,194,134,0.70)', edge: 'rgba(196,156,98,0.55)',  ink: '#9a6f2e' },
    sage:   { base: 'rgba(174,196,152,0.64)', edge: 'rgba(136,160,114,0.55)', ink: '#5e7444' },
    sky:    { base: 'rgba(158,194,216,0.64)', edge: 'rgba(116,156,184,0.55)', ink: '#3f6781' },
    lilac:  { base: 'rgba(194,172,214,0.64)', edge: 'rgba(154,134,178,0.55)', ink: '#6b5285' },
    butter: { base: 'rgba(236,214,146,0.70)', edge: 'rgba(200,176,112,0.55)', ink: '#8a6f24' },
    ink:    { base: 'rgba(58,54,48,0.92)',    edge: 'rgba(255,255,255,0.35)', ink: '#fcf8ef' },
};

const TAPE_STRIPES =
    'repeating-linear-gradient(90deg, rgba(255,255,255,0.16) 0 5px, transparent 5px 11px)';

// ── 满屏纸页外壳 ─────────────────────────────────────────────
export const PaperShell: React.FC<{
    children: React.ReactNode;
    className?: string;
    style?: React.CSSProperties;
}> = ({ children, className = '', style }) => (
    <div
        className={`absolute inset-0 flex flex-col overflow-hidden animate-fade-in ${className}`}
        style={{ paddingTop: 'var(--safe-top)', color: INK, background: PAGE_BG, ...style }}
    >
        <div aria-hidden className="pointer-events-none absolute inset-0 mix-blend-multiply" style={{ backgroundImage: GRAIN, backgroundSize: '140px 140px', opacity: 0.05 }} />
        {/* 角落随手贴：左上/右下两道淡淡的胶带，撑出拼贴边界 */}
        <div aria-hidden className="pointer-events-none absolute -top-3 -left-6 w-24 h-7 rotate-[-18deg] opacity-70" style={{ backgroundColor: WASHI.amber.base, backgroundImage: TAPE_STRIPES }} />
        <div aria-hidden className="pointer-events-none absolute -bottom-3 -right-7 w-24 h-7 rotate-[-15deg] opacity-60" style={{ backgroundColor: WASHI.sage.base, backgroundImage: TAPE_STRIPES }} />
        {children}
    </div>
);

/** 滚动内容区 */
export const ScrapScroll: React.FC<{ children: React.ReactNode; className?: string; innerRef?: React.Ref<HTMLDivElement> }> = ({ children, className = '', innerRef }) => (
    <div ref={innerRef} className={`relative z-10 flex-1 overflow-y-auto no-scrollbar ${className}`}>
        {children}
    </div>
);

// ── 和纸胶带 ────────────────────────────────────────────────
export const WashiTape: React.FC<{
    color?: WashiColor;
    rotate?: number;
    className?: string;
    style?: React.CSSProperties;
    children?: React.ReactNode;
}> = ({ color = 'amber', rotate = -3, className = '', style, children }) => {
    const c = WASHI[color];
    return (
        <span
            className={`inline-flex items-center justify-center select-none ${className}`}
            style={{
                backgroundColor: c.base,
                backgroundImage: TAPE_STRIPES,
                borderLeft: `1px dashed ${c.edge}`,
                borderRight: `1px dashed ${c.edge}`,
                boxShadow: '0 2px 6px rgba(58,54,48,0.16)',
                transform: `rotate(${rotate}deg)`,
                color: color === 'ink' ? '#fcf8ef' : '#5b5346',
                ...style,
            }}
        >
            {children}
        </span>
    );
};

// ── 纸卡（缝线 + 可选胶带 / 图钉 / 微旋转）──────────────────────
export const PaperCard: React.FC<{
    children: React.ReactNode;
    tilt?: number;
    tape?: WashiColor | null;
    pin?: boolean;
    className?: string;
    style?: React.CSSProperties;
    onClick?: () => void;
    onPointerDown?: (e: React.PointerEvent) => void;
    onPointerUp?: (e: React.PointerEvent) => void;
    onPointerLeave?: (e: React.PointerEvent) => void;
}> = ({ children, tilt = 0, tape = null, pin = false, className = '', style, onClick, onPointerDown, onPointerUp, onPointerLeave }) => (
    <div
        onClick={onClick}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerLeave}
        className={`relative ${onClick ? 'active:scale-[0.985] transition-transform' : ''} ${className}`}
        style={{
            background: 'linear-gradient(180deg, #fdfaf3, #f7f0e2)',
            border: '1px solid rgba(196,184,160,0.7)',
            outline: '1px dashed rgba(176,162,138,0.5)',
            outlineOffset: '-5px',
            borderRadius: 16,
            boxShadow: '0 14px 26px -16px rgba(70,62,48,0.45), 0 2px 0 rgba(255,255,255,0.6) inset',
            transform: tilt ? `rotate(${tilt}deg)` : undefined,
            ...style,
        }}
    >
        {tape && (
            <WashiTape color={tape} rotate={-4} className="absolute -top-2.5 left-1/2 -translate-x-1/2 w-16 h-5 rounded-[2px] z-10" />
        )}
        {pin && (
            <span aria-hidden className="absolute -top-1.5 right-4 w-3.5 h-3.5 rounded-full z-10" style={{ background: 'radial-gradient(circle at 34% 30%, #e88, #b54b44)', boxShadow: '0 0 0 2px rgba(255,255,255,0.85), 0 3px 6px rgba(150,60,54,0.5)' }} />
        )}
        {children}
    </div>
);

// ── 邮票格（齿孔边 + 内容）──────────────────────────────────
export const Stamp: React.FC<{ children: React.ReactNode; color?: WashiColor; size?: number; className?: string }> = ({ children, color = 'rose', size = 40, className = '' }) => {
    const c = WASHI[color];
    return (
        <span
            className={`relative inline-flex items-center justify-center shrink-0 ${className}`}
            style={{
                width: size, height: size, borderRadius: 9,
                background: '#fbf6ec',
                color: c.ink,
                // 齿孔：四周小白点
                boxShadow: '0 0 0 3px #fbf6ec, 0 0 0 4px rgba(176,162,138,0.55), 0 6px 12px -6px rgba(70,62,48,0.4)',
                outline: '1.5px dashed rgba(176,162,138,0.6)',
                outlineOffset: -4,
                backgroundImage:
                    'radial-gradient(circle at 50% 0,transparent 2px,#fbf6ec 2.4px),' +
                    'radial-gradient(circle at 50% 100%,transparent 2px,#fbf6ec 2.4px)',
            }}
        >
            <span className="relative z-10 flex items-center justify-center" style={{ color: c.ink }}>{children}</span>
        </span>
    );
};

// ── 拍立得头像（选人用）──────────────────────────────────────
export const Polaroid: React.FC<{
    src?: string;
    caption?: string;
    selected?: boolean;
    onClick?: () => void;
    rotate?: number;
    size?: number;
    fallback?: React.ReactNode;
}> = ({ src, caption, selected = false, onClick, rotate = 0, size = 56, fallback }) => (
    <button
        onClick={onClick}
        className="relative shrink-0 active:scale-95 transition-transform"
        style={{ transform: `rotate(${rotate}deg)` }}
    >
        <div
            className="p-1.5 pb-5"
            style={{
                background: selected ? '#3a3630' : '#fffdf8',
                border: `1px solid ${selected ? '#3a3630' : 'rgba(196,184,160,0.8)'}`,
                borderRadius: 6,
                boxShadow: selected ? '0 12px 22px -10px rgba(58,54,48,0.6)' : '0 9px 18px -12px rgba(70,62,48,0.45)',
            }}
        >
            <div className="overflow-hidden" style={{ width: size, height: size, borderRadius: 3, background: '#e8e0d0' }}>
                {src ? <img src={src} alt={caption || ''} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-xl">{fallback}</div>}
            </div>
            {caption !== undefined && (
                <div className="absolute left-0 right-0 bottom-1 text-center px-1">
                    <span className="text-[10.5px] font-bold truncate block" style={{ color: selected ? '#f6efe0' : '#5b5346' }}>{caption}</span>
                </div>
            )}
        </div>
        {selected && (
            <span aria-hidden className="absolute -top-2 -right-2 w-5 h-5 rounded-full flex items-center justify-center text-[11px] z-10" style={{ background: WASHI.rose.base, color: '#7a3a34', boxShadow: '0 2px 5px rgba(120,60,54,0.4)' }}>✓</span>
        )}
    </button>
);

// ── 贴纸按钮（墨色 / 纸色 / 透明描边）──────────────────────────
export const ScrapButton: React.FC<{
    children: React.ReactNode;
    variant?: 'ink' | 'paper' | 'ghost';
    onClick?: () => void;
    disabled?: boolean;
    className?: string;
    icon?: React.ReactNode;
    type?: 'button' | 'submit';
    title?: string;
}> = ({ children, variant = 'ink', onClick, disabled, className = '', icon, type = 'button', title }) => {
    const base = 'inline-flex items-center justify-center gap-1.5 font-bold rounded-full transition-transform active:scale-[0.96] disabled:opacity-45 disabled:active:scale-100';
    const styles: Record<string, React.CSSProperties> = {
        ink: { background: '#3a3630', color: '#fcf8ef', outline: '1px dashed rgba(255,255,255,0.32)', outlineOffset: -4, boxShadow: '0 12px 22px -12px rgba(58,54,48,0.6)' },
        paper: { background: 'rgba(255,253,247,0.96)', color: '#3a3630', border: '1px solid rgba(196,184,160,0.85)', outline: '1px dashed rgba(176,162,138,0.5)', outlineOffset: -4, boxShadow: '0 10px 20px -14px rgba(70,62,48,0.5)' },
        ghost: { background: 'transparent', color: '#6b6456', border: '1px dashed rgba(150,140,120,0.6)' },
    };
    return (
        <button type={type} onClick={onClick} disabled={disabled} title={title} className={`${base} ${className}`} style={styles[variant]}>
            {icon}{children}
        </button>
    );
};

// ── 便签（折角小色纸）────────────────────────────────────────
export const StickyNote: React.FC<{ children: React.ReactNode; color?: WashiColor; rotate?: number; className?: string; style?: React.CSSProperties }> = ({ children, color = 'butter', rotate = 0, className = '', style }) => {
    const c = WASHI[color];
    return (
        <div
            className={`relative ${className}`}
            style={{
                background: c.base,
                backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.25), rgba(255,255,255,0))',
                color: '#5a5142',
                borderRadius: '3px 3px 3px 12px',
                boxShadow: '0 10px 18px -12px rgba(70,62,48,0.5)',
                transform: rotate ? `rotate(${rotate}deg)` : undefined,
                ...style,
            }}
        >
            {children}
            <span aria-hidden className="absolute bottom-0 left-0 w-3.5 h-3.5" style={{ background: 'linear-gradient(135deg, rgba(0,0,0,0.10), transparent)', borderRadius: '0 0 0 12px' }} />
        </div>
    );
};

// ── 分区小旗标签（墨色小旗 + 延伸缝线）────────────────────────
export const SectionTag: React.FC<{ children: React.ReactNode; en?: string; color?: WashiColor; className?: string }> = ({ children, en, color = 'ink', className = '' }) => {
    const c = WASHI[color];
    return (
        <div className={`flex items-center gap-2 ${className}`}>
            <span className="px-2.5 py-1 rounded-[4px] text-[11px] font-black tracking-wide" style={{ background: color === 'ink' ? '#3a3630' : c.base, color: color === 'ink' ? '#fcf8ef' : c.ink }}>{children}</span>
            {en && <span className="text-[9px] tracking-[0.3em] uppercase" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>{en}</span>}
            <span className="flex-1 h-px" style={{ backgroundImage: 'repeating-linear-gradient(90deg, rgba(150,140,120,0.6) 0 5px, transparent 5px 10px)' }} />
        </div>
    );
};

/** 手写体大标题（拉丁/数字）+ 中文副标 */
export const HandTitle: React.FC<{ en: string; cn?: string; className?: string }> = ({ en, cn, className = '' }) => (
    <div className={className}>
        <div className="leading-none" style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 34, color: INK }}>{en}</div>
        {cn && <div className="text-[13px] font-bold mt-1" style={{ color: '#5b5346' }}>{cn}</div>}
    </div>
);

/** 票根式虚线分隔 */
export const DashedRule: React.FC<{ className?: string }> = ({ className = '' }) => (
    <div className={`h-px ${className}`} style={{ backgroundImage: 'repeating-linear-gradient(90deg, rgba(150,140,120,0.55) 0 6px, transparent 6px 12px)' }} />
);

// ── 顶栏：胶带返回钮 + 手写标题 + 右槽 ────────────────────────
export const ScrapHeader: React.FC<{
    title: string;
    en?: string;
    onBack?: () => void;
    backLabel?: string;
    right?: React.ReactNode;
}> = ({ title, en, onBack, backLabel = '返回', right }) => (
    <div className="relative z-20 shrink-0 px-4 pt-3 pb-2">
        <div className="flex items-center">
            {onBack ? (
                <button onClick={onBack} className="relative inline-flex items-center gap-1.5 px-3.5 py-2 text-[12px] font-black active:scale-95 transition-transform" style={{ color: '#5b4d3a' }}>
                    <span aria-hidden className="absolute inset-0 rounded-[6px]" style={{ backgroundColor: WASHI.butter.base, backgroundImage: TAPE_STRIPES, transform: 'rotate(-2deg)', boxShadow: '0 3px 7px -3px rgba(70,62,48,0.5)' }} />
                    <span className="relative z-10 flex items-center gap-1">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
                        {backLabel}
                    </span>
                </button>
            ) : <span />}
            <div className="absolute left-1/2 -translate-x-1/2 text-center select-none pointer-events-none">
                <div className="text-[14px] font-black tracking-[0.08em]" style={{ color: INK }}>{title}</div>
                {en && <div className="text-[8px] tracking-[0.4em] uppercase mt-0.5" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>{en}</div>}
            </div>
            <div className="ml-auto z-10">{right}</div>
        </div>
    </div>
);

// ── 纸面弹窗（居中，桌面压暗，纸条 + 胶带 + 弹入）────────────────
export const PaperDialog: React.FC<{
    open: boolean;
    onClose?: () => void;
    title?: string;
    en?: string;
    children: React.ReactNode;
    actions?: React.ReactNode;
    tape?: WashiColor;
    maxWidth?: number;
}> = ({ open, onClose, title, en, children, actions, tape = 'rose', maxWidth = 340 }) => {
    if (!open) return null;
    return (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-6 animate-fade-in">
            <div className="absolute inset-0" style={{ background: 'rgba(46,40,32,0.42)', backdropFilter: 'blur(3px)' }} onClick={onClose} />
            <div
                className="relative w-full animate-pop-in"
                style={{
                    maxWidth,
                    background: 'linear-gradient(180deg, #fdfaf3, #f6efdf)',
                    border: '1px solid rgba(196,184,160,0.8)',
                    outline: '1px dashed rgba(176,162,138,0.5)',
                    outlineOffset: -6,
                    borderRadius: 18,
                    boxShadow: '0 32px 60px -22px rgba(40,34,26,0.6)',
                    transform: 'rotate(-0.6deg)',
                }}
            >
                <WashiTape color={tape} rotate={-5} className="absolute -top-3 left-1/2 -translate-x-1/2 w-24 h-6 rounded-[2px]" />
                <div className="px-6 pt-7 pb-5">
                    {(title || en) && (
                        <div className="text-center mb-3">
                            {en && <div className="text-[9px] tracking-[0.34em] uppercase mb-1" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>{en}</div>}
                            {title && <h3 className="text-[18px] font-black" style={{ color: INK }}>{title}</h3>}
                        </div>
                    )}
                    <div className="text-[13px] leading-relaxed" style={{ color: '#5b5346' }}>{children}</div>
                </div>
                {actions && <div className="px-6 pb-6 flex gap-2.5">{actions}</div>}
            </div>
        </div>
    );
};

// ── 纸面底部抽屉（从下滑出的纸卡）─────────────────────────────
export const PaperSheet: React.FC<{
    open: boolean;
    onClose?: () => void;
    title?: string;
    children: React.ReactNode;
    tape?: WashiColor;
}> = ({ open, onClose, title, children, tape = 'sage' }) => {
    if (!open) return null;
    return (
        <div className="fixed inset-0 z-[120] flex items-end justify-center animate-fade-in">
            <div className="absolute inset-0" style={{ background: 'rgba(46,40,32,0.42)', backdropFilter: 'blur(3px)' }} onClick={onClose} />
            <div
                className="relative w-full animate-slide-up"
                style={{
                    maxWidth: 460,
                    background: 'linear-gradient(180deg, #fdfaf3, #f5eedd)',
                    borderTop: '1px solid rgba(196,184,160,0.8)',
                    borderTopLeftRadius: 22, borderTopRightRadius: 22,
                    boxShadow: '0 -22px 48px -20px rgba(40,34,26,0.5)',
                    paddingBottom: 'max(env(safe-area-inset-bottom), 16px)',
                }}
            >
                <div className="flex justify-center pt-2.5">
                    <WashiTape color={tape} rotate={-2} className="w-16 h-2.5 rounded-full" />
                </div>
                {title && <div className="px-6 pt-3 text-center text-[14px] font-black" style={{ color: INK }}>{title}</div>}
                <div className="px-5 pt-3 pb-4">{children}</div>
            </div>
        </div>
    );
};
