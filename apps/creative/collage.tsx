import React from 'react';

/* =========================================================================
   创作社 · 设计系统（collage kit）—— 已换肤为 Ins 风
   ------------------------------------------------------------------------
   服务于「创作社」三件套：CreativeStudioApp / NovelApp(+NovelWriter) / SongwritingApp。
   新主张：纸墨气质用「干净白卡 + 暖墨字 + 极柔投影 + 大圆角」表达；保留极少量
          和纸胶带 / 邮票作创作社的专属性格点缀（不再黑描边 + 硬阴影 + 网点满铺）。
   导出名 / 签名保持不变，调用点无需改动。
   ========================================================================= */

// ---------- 颜色 token ----------
export const INK = '#26242a';
export const INK_70 = 'rgba(38,36,42,0.70)';
export const INK_55 = 'rgba(38,36,42,0.55)';
export const INK_45 = 'rgba(38,36,42,0.42)';
export const INK_30 = 'rgba(38,36,42,0.28)';
export const PAPER = '#f7f5f2';      // 整页暖白底
export const PAPER_CARD = '#ffffff'; // 白卡

// ---------- 字体 ----------
export const HAND: React.CSSProperties = { fontFamily: "'Long Cang','Caveat',cursive" };
export const BRUSH: React.CSSProperties = { fontFamily: "'Ma Shan Zheng','Long Cang',serif" };

// ---------- 背景纹理（极淡，ins 化后基本不可见） ----------
export const DOT_BG: React.CSSProperties = {};
export const GRID_BG: React.CSSProperties = {
    backgroundImage:
        'linear-gradient(rgba(38,36,42,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(38,36,42,0.035) 1px, transparent 1px)',
    backgroundSize: '22px 22px',
};
/** 信纸横线（写作页用，保留——是写作 App 的好质感） */
export const LINES_BG: React.CSSProperties = {
    backgroundImage: 'repeating-linear-gradient(transparent 0 27px, rgba(38,36,42,0.07) 27px 28px)',
};
export const BARCODE_BG: React.CSSProperties = {
    backgroundImage:
        'repeating-linear-gradient(90deg, rgba(38,36,42,0.55) 0 2px, transparent 2px 4px, rgba(38,36,42,0.55) 4px 5px, transparent 5px 9px, rgba(38,36,42,0.55) 9px 12px, transparent 12px 14px)',
};

// ---------- 复用 className ----------
export const inkBorder = 'border border-black/[0.06]';
/** 贴纸式按压面：白底 + 极柔投影 + 按压回弹 */
export const sticker =
    'bg-white rounded-2xl border border-black/[0.05] shadow-[0_8px_18px_-12px_rgba(38,36,42,0.4)] press-soft';
/** 纸面输入框 */
export const paperField =
    'w-full bg-white rounded-xl border border-black/[0.06] px-3.5 py-2.5 text-sm text-[#26242a] placeholder:text-[#26242a]/35 outline-none focus:border-[#26242a]/25 transition-colors';

// ---------- 小图标 ----------
export const ArrowLeft: React.FC<{ className?: string }> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className={className || 'w-4 h-4'}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
    </svg>
);

// ---------- 和纸胶带（保留一点性格，彩白半透明） ----------
export const Tape: React.FC<{ className?: string; tone?: string }> = ({ className, tone }) => (
    <div aria-hidden className={`pointer-events-none absolute h-5 w-16 shadow-sm ${className || ''}`}
        style={{ background: tone ? `${tone}55` : 'rgba(255,255,255,0.75)', backgroundImage: 'repeating-linear-gradient(90deg, rgba(255,255,255,0.4) 0 5px, transparent 5px 11px)', borderRadius: 2 }} />
);

// ---------- 条形码贴片 ----------
export const Barcode: React.FC<{ className?: string; label?: string }> = ({ className, label }) => (
    <div aria-hidden className={`pointer-events-none select-none ${className || ''}`}>
        <div className="h-5 w-20 opacity-50" style={BARCODE_BG} />
        {label && <div className="label-mono text-[7px] text-[#26242a]/45 mt-0.5 text-center">{label}</div>}
    </div>
);

// ---------- 圆形印章贴纸 ----------
export const Stamp: React.FC<{ children: React.ReactNode; className?: string; rotate?: number }> = ({ children, className, rotate = -8 }) => (
    <span aria-hidden className={`inline-flex items-center justify-center w-9 h-9 rounded-full label-mono text-[7px] leading-none text-center ${className || ''}`}
        style={{ transform: `rotate(${rotate}deg)`, background: '#fff', color: '#26242a99', border: '1.5px dashed rgba(38,36,42,0.3)', boxShadow: '0 4px 10px -6px rgba(38,36,42,0.3)' }}>
        {children}
    </span>
);

// ---------- 活页装订孔（左缘装饰） ----------
export const Punches: React.FC<{ className?: string; count?: number }> = ({ className, count = 6 }) => (
    <div aria-hidden className={`flex flex-col justify-around items-center ${className || ''}`}>
        {Array.from({ length: count }).map((_, i) => (
            <span key={i} className="w-2.5 h-2.5 rounded-full bg-[#efece7] shadow-inner" />
        ))}
    </div>
);

// ---------- 剪裁分隔 ----------
export const Cut: React.FC<{ className?: string; label?: string }> = ({ className, label }) => (
    <div className={`relative flex items-center gap-2 ${className || ''}`} aria-hidden>
        <span className="text-[#26242a]/35 text-xs leading-none">✂</span>
        <div className="flex-1 h-px" style={{ background: 'rgba(38,36,42,0.1)' }} />
        {label && <span className="label-mono text-[8px] text-[#26242a]/40">{label}</span>}
    </div>
);

// ---------- 分隔线 ----------
export const Stitch: React.FC<{ className?: string }> = ({ className }) => (
    <div aria-hidden className={`h-px ${className || ''}`} style={{ background: 'rgba(38,36,42,0.08)' }} />
);

// ---------- 等宽小标签 ----------
export const Kicker: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
    <div className={`label-mono text-[9px] text-[#26242a]/45 ${className || ''}`}>{children}</div>
);

// ---------- 章节标题 ----------
export const SectionTitle: React.FC<{ no?: string; en?: string; cn: React.ReactNode; className?: string }> = ({ no, en, cn, className }) => (
    <div className={className}>
        {(no || en) && (
            <div className="label-mono text-[9px] text-[#26242a]/45 mb-1">
                {no ? `${no}` : ''}{no && en ? ' · ' : ''}{en}
            </div>
        )}
        <div className="text-[22px] leading-none text-[#26242a]" style={BRUSH}>{cn}</div>
    </div>
);

// ---------- 返回贴纸（软圆钮 + 标签） ----------
export const BackSticker: React.FC<{ onClick: () => void; label?: string; className?: string }> = ({ onClick, label = '回桌面', className }) => (
    <button onClick={onClick}
        className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[11px] font-bold bg-white text-[#26242a] border border-black/[0.05] shadow-[0_6px_16px_-8px_rgba(38,36,42,0.35)] press-soft ${className || ''}`}>
        <ArrowLeft className="w-3.5 h-3.5" />
        {label}
    </button>
);

// ---------- 方形图标按钮（软圆角） ----------
export const IconStamp: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'paper' | 'ink' }> = ({ tone = 'paper', className, children, ...rest }) => (
    <button {...rest}
        className={`relative inline-flex items-center justify-center w-10 h-10 rounded-2xl press-soft disabled:opacity-40 ${tone === 'ink' ? 'bg-[#26242a] text-white shadow-[0_10px_20px_-10px_rgba(38,36,42,0.55)]' : 'bg-white text-[#26242a] border border-black/[0.05] shadow-[0_6px_16px_-8px_rgba(38,36,42,0.3)]'} ${className || ''}`}>
        {children}
    </button>
);

// ---------- 主操作按钮 ----------
export const InkButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'paper' | 'ink' }> = ({ tone = 'paper', className, children, ...rest }) => (
    <button {...rest}
        className={`relative inline-flex items-center justify-center gap-2 px-5 py-3 font-bold rounded-full press-soft disabled:opacity-40 ${tone === 'ink' ? 'bg-[#26242a] text-white shadow-[0_12px_24px_-12px_rgba(38,36,42,0.55)]' : 'bg-white text-[#26242a] border border-black/[0.06] shadow-[0_8px_18px_-12px_rgba(38,36,42,0.4)]'} ${className || ''}`}>
        {children}
    </button>
);

// ---------- 可选中标签筹码 ----------
export const Chip: React.FC<{ active?: boolean; onClick?: () => void; children: React.ReactNode; className?: string; title?: string }> = ({ active, onClick, children, className, title }) => (
    <button type="button" title={title} onClick={onClick}
        className={`px-3.5 py-1.5 text-xs font-bold rounded-full press-soft ${active ? 'bg-[#26242a] text-white shadow-[0_8px_16px_-10px_rgba(38,36,42,0.6)]' : 'bg-white text-[#26242a]/70 border border-black/[0.06]'} ${className || ''}`}>
        {children}
    </button>
);

// ---------- 纸卡（白卡 + 极柔投影 + 可微旋 + 可贴胶带） ----------
export const PaperCard: React.FC<{
    children: React.ReactNode;
    className?: string;
    tone?: string;
    rotate?: number;
    shadow?: string;
    style?: React.CSSProperties;
}> = ({ children, className, tone, rotate = 0, style }) => (
    <div className={`relative ${className || ''}`}
        style={{ background: tone || PAPER_CARD, borderRadius: 20, border: '1px solid rgba(0,0,0,0.05)', boxShadow: '0 1px 2px rgba(38,36,42,0.04), 0 16px 32px -22px rgba(38,36,42,0.3)', transform: rotate ? `rotate(${rotate}deg)` : undefined, ...style }}>
        {children}
    </div>
);

// ---------- 顶栏 ----------
export const TopBar: React.FC<{ left?: React.ReactNode; center?: React.ReactNode; right?: React.ReactNode; className?: string }> = ({ left, center, right, className }) => (
    <div className={`relative flex items-center gap-2 px-4 pt-2.5 pb-2 shrink-0 z-20 ${className || ''}`}>
        <div className="flex items-center gap-2">{left}</div>
        {center && <div className="absolute left-1/2 -translate-x-1/2 text-center select-none pointer-events-none">{center}</div>}
        <div className="ml-auto flex items-center gap-2">{right}</div>
    </div>
);

// ---------- AI 思考省略号 ----------
export const TypingDots: React.FC<{ className?: string }> = ({ className }) => (
    <div className={`flex items-center gap-1 ${className || ''}`} aria-label="思考中">
        {[0, 1, 2].map(i => (
            <span key={i} className="w-1.5 h-1.5 rounded-full bg-[#26242a] animate-dot-pulse" style={{ animationDelay: `${i * 0.16}s` }} />
        ))}
    </div>
);

/* =========================================================================
   弹窗（仅创作社内使用，签名对齐 OS 版 Modal / ConfirmDialog）
   ========================================================================= */

export const CollageModal: React.FC<{
    isOpen: boolean;
    title: string;
    onClose: () => void;
    children: React.ReactNode;
    footer?: React.ReactNode;
    kicker?: string;
    tone?: string;
}> = ({ isOpen, title, onClose, children, footer, kicker = 'CREATIVE GUILD' }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 animate-fade-in">
            <div className="absolute inset-0" style={{ background: 'rgba(28,26,24,0.42)', backdropFilter: 'blur(4px)' }} onClick={onClose} />
            <div className="relative w-full max-w-sm overflow-hidden animate-pop-in" style={{ background: '#fff', borderRadius: 26, boxShadow: '0 40px 80px -28px rgba(20,18,16,0.5)' }}>
                <div className="px-6 pt-7 pb-3 text-center">
                    <div className="label-mono text-[8px] text-[#26242a]/45">{kicker}</div>
                    <h3 className="text-2xl text-[#26242a] mt-1" style={BRUSH}>{title}</h3>
                </div>
                <div className="px-5 py-3 max-h-[58vh] overflow-y-auto no-scrollbar">{children}</div>
                {footer ? (
                    <div className="px-5 pb-5 pt-2 flex gap-3">{footer}</div>
                ) : (
                    <div className="px-5 pb-5 pt-2">
                        <InkButton tone="ink" onClick={onClose} className="w-full text-sm tracking-[0.3em]">盖 上</InkButton>
                    </div>
                )}
            </div>
        </div>
    );
};

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
    return (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-6 animate-fade-in" style={{ zIndex: 9999 }}>
            <div className="absolute inset-0" style={{ background: 'rgba(28,26,24,0.42)', backdropFilter: 'blur(4px)' }} onClick={onCancel} />
            <div className="relative w-full max-w-[20rem] overflow-hidden animate-pop-in" style={{ background: '#fff', borderRadius: 24, boxShadow: '0 40px 80px -28px rgba(20,18,16,0.5)' }}>
                <div className="px-6 pt-7 pb-4 text-center">
                    <h3 className="text-xl text-[#26242a]" style={BRUSH}>{title}</h3>
                    <p className="text-sm text-[#26242a]/70 leading-relaxed mt-2">{message}</p>
                </div>
                <div className="px-5 pb-5 flex gap-3">
                    <button onClick={onCancel} className="flex-1 px-4 py-2.5 text-[13px] font-bold rounded-full bg-[#f1efeb] text-[#26242a]/70 press-soft">{cancelText}</button>
                    <button onClick={onConfirm} className={`flex-1 px-4 py-2.5 text-[13px] font-bold rounded-full press-soft ${variant === 'danger' ? 'bg-[#ef4444] text-white shadow-[0_12px_24px_-12px_#ef4444]' : 'bg-[#26242a] text-white'}`}>{confirmText}</button>
                </div>
            </div>
        </div>
    );
};
