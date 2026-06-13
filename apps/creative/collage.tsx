import React from 'react';

/* =========================================================================
   创作社 · 黑白拼贴手账 设计系统（collage kit）
   ------------------------------------------------------------------------
   只服务于「创作社」三件套：
     - apps/CreativeStudioApp.tsx  （封面壳）
     - apps/NovelApp.tsx + components/novel/NovelWriter.tsx （笔友会）
     - apps/SongwritingApp.tsx     （写歌）
   主张：黑墨描边 + 米色纸 + 硬阴影（不带模糊的偏移投影）为骨架；
        主题色只作「纸张底色 / 和纸胶带」点缀，绝不喧宾夺主。
   注意：本文件不动任何全局 OS 组件（components/os/Modal、ConfirmDialog 等），
        而是提供创作社自己的拼贴版弹窗 CollageModal / CollageConfirm。
   ========================================================================= */

// ---------- 颜色 token ----------
export const INK = '#1c1b1a';
export const INK_70 = 'rgba(28,27,26,0.70)';
export const INK_55 = 'rgba(28,27,26,0.55)';
export const INK_45 = 'rgba(28,27,26,0.45)';
export const INK_30 = 'rgba(28,27,26,0.30)';
export const PAPER = '#f2f0e9';      // 整页米色纸底
export const PAPER_CARD = '#fbfaf6'; // 偏白的卡片纸

// ---------- 字体 ----------
/** 潦草手写（批注 / 引文 / 随手记） */
export const HAND: React.CSSProperties = { fontFamily: "'Long Cang','Caveat',cursive" };
/** 毛笔体（大标题 / 章节名） */
export const BRUSH: React.CSSProperties = { fontFamily: "'Ma Shan Zheng','Long Cang',serif" };

// ---------- 背景纹理 ----------
export const DOT_BG: React.CSSProperties = {
    backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(28,27,26,0.10) 1px, transparent 0)',
    backgroundSize: '16px 16px',
};
export const GRID_BG: React.CSSProperties = {
    backgroundImage:
        'linear-gradient(rgba(28,27,26,0.055) 1px, transparent 1px), linear-gradient(90deg, rgba(28,27,26,0.055) 1px, transparent 1px)',
    backgroundSize: '22px 22px',
};
export const LINES_BG: React.CSSProperties = {
    backgroundImage: 'repeating-linear-gradient(transparent 0 27px, rgba(28,27,26,0.10) 27px 28px)',
};
export const BARCODE_BG: React.CSSProperties = {
    backgroundImage:
        'repeating-linear-gradient(90deg, #1c1b1a 0 2px, transparent 2px 4px, #1c1b1a 4px 5px, transparent 5px 9px, #1c1b1a 9px 12px, transparent 12px 14px)',
};

// ---------- 复用 className ----------
export const inkBorder = 'border-2 border-[#1c1b1a]';
/** 贴纸式按压面：白底 + 黑描边 + 硬阴影，按下时下沉吃掉阴影 */
export const sticker =
    'border-2 border-[#1c1b1a] bg-white shadow-[2px_2px_0_#1c1b1a] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all';
/** 纸面输入框 */
export const paperField =
    'w-full bg-white border-2 border-[#1c1b1a] px-3 py-2 text-sm text-[#1c1b1a] placeholder:text-[#1c1b1a]/35 outline-none focus:shadow-[2px_2px_0_#1c1b1a] transition-shadow';

// ---------- 小图标 ----------
export const ArrowLeft: React.FC<{ className?: string }> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className={className || 'w-3.5 h-3.5'}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
    </svg>
);

// ---------- 和纸胶带 ----------
export const Tape: React.FC<{ className?: string; tone?: string }> = ({ className, tone }) => (
    <div
        aria-hidden
        className={`pointer-events-none absolute h-5 w-16 border-x border-dashed border-[#1c1b1a]/30 shadow-sm backdrop-blur-[1px] ${className || ''}`}
        style={{ background: tone ? `${tone}59` : 'rgba(255,255,255,0.6)' }}
    />
);

// ---------- 条形码贴片 ----------
export const Barcode: React.FC<{ className?: string; label?: string }> = ({ className, label }) => (
    <div aria-hidden className={`pointer-events-none select-none ${className || ''}`}>
        <div className="h-5 w-20 opacity-60" style={BARCODE_BG} />
        {label && <div className="label-mono text-[7px] text-[#1c1b1a]/50 mt-0.5 text-center">{label}</div>}
    </div>
);

// ---------- 圆形虚线印章贴纸 ----------
export const Stamp: React.FC<{ children: React.ReactNode; className?: string; rotate?: number }> = ({ children, className, rotate = -8 }) => (
    <span
        aria-hidden
        className={`inline-flex items-center justify-center w-9 h-9 rounded-full border-2 border-dashed border-[#1c1b1a]/45 label-mono text-[7px] leading-none text-[#1c1b1a]/55 text-center ${className || ''}`}
        style={{ transform: `rotate(${rotate}deg)` }}
    >
        {children}
    </span>
);

// ---------- 活页装订孔（左缘装饰） ----------
export const Punches: React.FC<{ className?: string; count?: number }> = ({ className, count = 6 }) => (
    <div aria-hidden className={`flex flex-col justify-around items-center ${className || ''}`}>
        {Array.from({ length: count }).map((_, i) => (
            <span key={i} className="w-2.5 h-2.5 rounded-full bg-[#f2f0e9] border border-[#1c1b1a]/35 shadow-inner" />
        ))}
    </div>
);

// ---------- 剪裁虚线分隔 ----------
export const Cut: React.FC<{ className?: string; label?: string }> = ({ className, label }) => (
    <div className={`relative flex items-center gap-2 ${className || ''}`} aria-hidden>
        <span className="text-[#1c1b1a]/40 text-xs leading-none">✂</span>
        <div className="flex-1 border-t-2 border-dashed border-[#1c1b1a]/25" />
        {label && <span className="label-mono text-[8px] text-[#1c1b1a]/40">{label}</span>}
    </div>
);

// ---------- 缝线分隔 ----------
export const Stitch: React.FC<{ className?: string }> = ({ className }) => (
    <div aria-hidden className={`border-t-2 border-dashed border-[#1c1b1a]/25 ${className || ''}`} />
);

// ---------- 等宽小标签 ----------
export const Kicker: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
    <div className={`label-mono text-[9px] text-[#1c1b1a]/45 ${className || ''}`}>{children}</div>
);

// ---------- 章节标题（mono 副标 + 毛笔大字） ----------
export const SectionTitle: React.FC<{ no?: string; en?: string; cn: React.ReactNode; className?: string }> = ({ no, en, cn, className }) => (
    <div className={className}>
        {(no || en) && (
            <div className="label-mono text-[9px] text-[#1c1b1a]/45 mb-1">
                {no ? `${no}` : ''}{no && en ? ' · ' : ''}{en}
            </div>
        )}
        <div className="text-[22px] leading-none text-[#1c1b1a]" style={BRUSH}>{cn}</div>
    </div>
);

// ---------- 返回贴纸 ----------
export const BackSticker: React.FC<{ onClick: () => void; label?: string; className?: string }> = ({ onClick, label = '回桌面', className }) => (
    <button
        onClick={onClick}
        className={`inline-flex items-center gap-1.5 px-3 py-2 rotate-[-2deg] text-[10px] font-black border-2 border-[#1c1b1a] bg-white shadow-[2px_2px_0_#1c1b1a] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all ${className || ''}`}
    >
        <ArrowLeft />
        {label}
    </button>
);

// ---------- 方形图标按钮 ----------
export const IconStamp: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'paper' | 'ink' }> = ({ tone = 'paper', className, children, ...rest }) => (
    <button
        {...rest}
        className={`relative inline-flex items-center justify-center w-10 h-10 border-2 border-[#1c1b1a] shadow-[2px_2px_0_#1c1b1a] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all disabled:opacity-40 ${tone === 'ink' ? 'bg-[#1c1b1a] text-[#f2f0e9]' : 'bg-white text-[#1c1b1a]'} ${className || ''}`}
    >
        {children}
    </button>
);

// ---------- 主操作贴纸按钮 ----------
export const InkButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'paper' | 'ink' }> = ({ tone = 'paper', className, children, ...rest }) => (
    <button
        {...rest}
        className={`relative inline-flex items-center justify-center gap-2 px-5 py-3 font-black border-2 border-[#1c1b1a] shadow-[3px_3px_0_#1c1b1a] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none transition-all disabled:opacity-40 ${tone === 'ink' ? 'bg-[#1c1b1a] text-[#f2f0e9]' : 'bg-white text-[#1c1b1a]'} ${className || ''}`}
    >
        {children}
    </button>
);

// ---------- 可选中标签筹码 ----------
export const Chip: React.FC<{ active?: boolean; onClick?: () => void; children: React.ReactNode; className?: string; title?: string }> = ({ active, onClick, children, className, title }) => (
    <button
        type="button"
        title={title}
        onClick={onClick}
        className={`px-3 py-1.5 text-xs font-bold border-2 border-[#1c1b1a] transition-all ${active ? 'bg-[#1c1b1a] text-[#f2f0e9] translate-x-[1px] translate-y-[1px] shadow-none' : 'bg-white text-[#1c1b1a] shadow-[2px_2px_0_#1c1b1a] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none'} ${className || ''}`}
    >
        {children}
    </button>
);

// ---------- 纸卡（黑描边 + 硬阴影 + 可微旋 + 可贴胶带） ----------
export const PaperCard: React.FC<{
    children: React.ReactNode;
    className?: string;
    tone?: string;       // 纸张底色（主题点缀）
    rotate?: number;     // 微旋角度
    shadow?: string;     // 阴影偏移，如 '4px_4px'
    style?: React.CSSProperties;
}> = ({ children, className, tone, rotate = 0, shadow = '4px_4px', style }) => (
    <div
        className={`relative border-2 border-[#1c1b1a] shadow-[${shadow}_0_#1c1b1a] ${className || ''}`}
        style={{ background: tone || PAPER_CARD, transform: rotate ? `rotate(${rotate}deg)` : undefined, ...style }}
    >
        {children}
    </div>
);

// ---------- 顶栏（安全区内边距 + 左/中/右三槽） ----------
export const TopBar: React.FC<{ left?: React.ReactNode; center?: React.ReactNode; right?: React.ReactNode; className?: string }> = ({ left, center, right, className }) => (
    <div
        className={`relative flex items-center gap-2 px-4 pb-2 shrink-0 z-20 ${className || ''}`}
        style={{ paddingTop: 'calc(var(--safe-top) + 0.6rem)' }}
    >
        <div className="flex items-center gap-2">{left}</div>
        {center && <div className="absolute left-1/2 -translate-x-1/2 text-center select-none pointer-events-none">{center}</div>}
        <div className="ml-auto flex items-center gap-2">{right}</div>
    </div>
);

// ---------- AI 思考省略号 ----------
export const TypingDots: React.FC<{ className?: string }> = ({ className }) => (
    <div className={`flex items-center gap-1 ${className || ''}`} aria-label="思考中">
        {[0, 1, 2].map(i => (
            <span key={i} className="w-1.5 h-1.5 rounded-full bg-[#1c1b1a] animate-dot-pulse" style={{ animationDelay: `${i * 0.16}s` }} />
        ))}
    </div>
);

/* =========================================================================
   拼贴版弹窗（仅创作社内使用，签名对齐 OS 版 Modal / ConfirmDialog 便于替换）
   ========================================================================= */

// ---------- CollageModal（对齐 components/os/Modal 的 props） ----------
export const CollageModal: React.FC<{
    isOpen: boolean;
    title: string;
    onClose: () => void;
    children: React.ReactNode;
    footer?: React.ReactNode;
    kicker?: string;       // 标题上方的 mono 小字，默认 'CREATIVE GUILD'
    tone?: string;         // 顶部胶带 / 标题区点缀色
}> = ({ isOpen, title, onClose, children, footer, kicker = 'CREATIVE GUILD', tone }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 animate-fade-in">
            <div className="absolute inset-0" style={{ background: 'rgba(28,27,26,0.42)' }} onClick={onClose} />
            <div
                className="relative w-full max-w-sm border-2 border-[#1c1b1a] shadow-[6px_6px_0_#1c1b1a] overflow-hidden animate-pop-in"
                style={{ background: PAPER_CARD, ...DOT_BG }}
            >
                <Tape className="-top-2.5 left-1/2 -translate-x-1/2 rotate-[-3deg] w-24" tone={tone} />
                {/* 标题区 */}
                <div className="px-6 pt-7 pb-3 text-center border-b-2 border-dashed border-[#1c1b1a]/25">
                    <div className="label-mono text-[8px] text-[#1c1b1a]/45">{kicker}</div>
                    <h3 className="text-2xl text-[#1c1b1a] mt-1" style={BRUSH}>{title}</h3>
                </div>
                {/* 内容区 */}
                <div className="px-5 py-4 max-h-[58vh] overflow-y-auto no-scrollbar">{children}</div>
                {/* 底栏 */}
                {footer ? (
                    <div className="px-5 pb-5 pt-1 flex gap-3">{footer}</div>
                ) : (
                    <div className="px-5 pb-5 pt-1">
                        <InkButton tone="ink" onClick={onClose} className="w-full text-sm tracking-[0.3em]">盖 上</InkButton>
                    </div>
                )}
                <div aria-hidden className="absolute bottom-3 right-4 w-16 h-4 opacity-40" style={BARCODE_BG} />
            </div>
        </div>
    );
};

// ---------- CollageConfirm（对齐 components/os/ConfirmDialog 的 props） ----------
export const CollageConfirm: React.FC<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    variant?: 'danger' | 'warning' | 'info';
    onConfirm: () => void;
    onCancel: () => void;
}> = ({ isOpen, title, message, confirmText = '好', cancelText = '再想想', variant = 'info', onConfirm, onCancel }) => {
    if (!isOpen) return null;
    const stampLabel = variant === 'danger' ? '撕 毁' : variant === 'warning' ? '当 心' : '便 签';
    return (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-6 animate-fade-in" style={{ zIndex: 9999 }}>
            <div className="absolute inset-0" style={{ background: 'rgba(28,27,26,0.42)' }} onClick={onCancel} />
            <div
                className="relative w-full max-w-[20rem] border-2 border-[#1c1b1a] shadow-[6px_6px_0_#1c1b1a] overflow-hidden animate-pop-in rotate-[-0.6deg]"
                style={{ background: PAPER_CARD }}
            >
                <Tape className="-top-2.5 left-6 rotate-[4deg] w-16" />
                <Stamp className="absolute -top-3 right-4 bg-[#fbfaf6] rotate-[9deg]">{stampLabel}</Stamp>
                <div className="px-6 pt-7 pb-5">
                    <h3 className="text-xl text-[#1c1b1a]" style={BRUSH}>{title}</h3>
                    <p className="text-sm text-[#1c1b1a]/70 leading-relaxed mt-2" style={HAND}>{message}</p>
                </div>
                <Stitch className="mx-5" />
                <div className="px-5 py-4 flex gap-3 justify-end">
                    <button
                        onClick={onCancel}
                        className="px-4 py-2 text-xs font-bold border-2 border-[#1c1b1a] bg-white text-[#1c1b1a] shadow-[2px_2px_0_#1c1b1a] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all"
                    >
                        {cancelText}
                    </button>
                    <button
                        onClick={onConfirm}
                        className={`px-4 py-2 text-xs font-black border-2 border-[#1c1b1a] shadow-[2px_2px_0_#1c1b1a] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all ${variant === 'danger' ? 'bg-[#1c1b1a] text-[#f2f0e9]' : 'bg-white text-[#1c1b1a]'}`}
                    >
                        {confirmText}
                    </button>
                </div>
            </div>
        </div>
    );
};
