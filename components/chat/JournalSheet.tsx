import React from 'react';
import {
    PAPER_TONES, PaperKind,
    MONO_STACK, CUTE_STACK, tiltFor,
} from '../handbook/paper';

/**
 * 聊天功能弹层的视觉套件。已偏 ins 风（与拼贴账本融合）：干净白卡 + 发丝线 + 柔影 + 大圆角，
 * 标题直接做成卡片头部的加粗标题（不再用胶带），留住糖果按钮等一点暖度。
 */

export const JournalSheet: React.FC<{
    open: boolean;
    title: string;
    /** 角落英文小标（打字机体） */
    en?: string;
    /** 标题下的一行小注 */
    sub?: string;
    /** 兼容旧调用保留（已不再渲染胶带/纸纹，ins 风干净白卡） */
    tape?: string;
    pattern?: string;
    paper?: PaperKind;
    onClose: () => void;
    children: React.ReactNode;
    /** 底部操作区（不传则不渲染底栏） */
    footer?: React.ReactNode;
    /** 内容区更高（如日程 / 长列表） */
    tall?: boolean;
    /** 覆盖层 z-index 类（默认 z-[100]，与旧 Modal 持平） */
    zClass?: string;
}> = ({ open, title, en, sub, onClose, children, footer, tall, zClass = 'z-[100]' }) => {
    if (!open) return null;
    return (
        <div className={`fixed inset-0 ${zClass} flex items-end sm:items-center justify-center animate-fade-in`}>
            <div
                className="absolute inset-0"
                style={{ background: 'rgba(61,47,61,0.42)', backdropFilter: 'blur(4px)' }}
                onClick={onClose}
            />
            <div
                className="relative w-full sm:max-w-[26rem] flex flex-col animate-slide-up rounded-t-[22px] sm:rounded-[22px] overflow-hidden"
                style={{
                    background: '#ffffff',
                    maxHeight: tall ? '88vh' : '80vh',
                    paddingBottom: 'var(--safe-bottom)',
                    boxShadow: '0 24px 60px -24px rgba(61,47,61,0.4), 0 0 0 1px #ededed inset',
                }}
                onClick={e => e.stopPropagation()}
            >
                <div className="shrink-0 flex items-start justify-between gap-3 px-4 pt-4 pb-2.5 border-b" style={{ borderColor: '#ededed' }}>
                    <div className="min-w-0 pt-0.5">
                        {en && <div className="text-[8.5px] tracking-[0.22em] uppercase select-none" style={{ ...MONO_STACK, color: PAPER_TONES.inkFaint }}>{en}</div>}
                        <div className="text-[16px] font-bold leading-tight mt-0.5" style={{ color: PAPER_TONES.ink }}>{title}</div>
                        {sub && <div className="text-[10.5px] mt-0.5" style={{ color: PAPER_TONES.inkSoft }}>{sub}</div>}
                    </div>
                    <button
                        onClick={onClose}
                        aria-label="合上这页"
                        className="w-8 h-8 shrink-0 rounded-full bg-white flex items-center justify-center active:scale-90 transition-transform"
                        style={{ border: '1px solid #eab6c6', boxShadow: '0 1px 3px rgba(122,90,114,0.3)', color: '#9c5e74' }}
                    >
                        <span className="text-[13px] leading-none" aria-hidden>✕</span>
                    </button>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-4 py-4">
                    {children}
                </div>
                {footer && (
                    <div className="shrink-0 flex gap-2.5 px-4 py-3.5 border-t border-solid" style={{ borderColor: 'rgba(122,90,114,0.22)' }}>
                        {footer}
                    </div>
                )}
            </div>
        </div>
    );
};

/** 印章按钮：糖果实底 + 右下硬影，按下去像盖了一枚章 */
export const SealBtn: React.FC<{
    kind?: 'rose' | 'ghost' | 'ink' | 'berry' | 'mint';
    onClick?: () => void;
    disabled?: boolean;
    full?: boolean;
    children: React.ReactNode;
}> = ({ kind = 'rose', onClick, disabled, full, children }) => {
    const palette = {
        rose:  { bg: '#f6a7bb', border: '1.5px solid #d97a93', fg: '#5d2434', shadow: '#f3cdd8' },
        mint:  { bg: '#bfe1cf', border: '1.5px solid #8fbfa5', fg: '#264a36', shadow: '#d9efe3' },
        ink:   { bg: '#3d2f3d', border: '1.5px solid #2a1f2a', fg: '#fff5fa', shadow: '#cbb3c4' },
        berry: { bg: '#e26b84', border: '1.5px solid #c14a64', fg: '#ffffff', shadow: '#f3c1cd' },
        ghost: { bg: '#fffdfa', border: '1.5px solid #ddc9d3', fg: '#8a6478', shadow: '#eadfe6' },
    }[kind];
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={`${full ? 'w-full' : 'flex-1'} py-3 px-3 rounded-[12px] text-[13px] font-bold flex items-center justify-center gap-1.5 transition-all active:translate-y-[2px] active:shadow-none disabled:opacity-40 disabled:active:translate-y-0`}
            style={{ background: palette.bg, border: palette.border, color: palette.fg, boxShadow: `2px 2px 0 ${palette.shadow}`, ...CUTE_STACK }}
        >
            {children}
        </button>
    );
};

/** 糖果开关：与聊天手帐同款——撕角矩形 + 缝线虚框 + 爱心滑钮 */
export const CandyToggle: React.FC<{ on: boolean; onToggle: () => void; candy?: string }> = ({ on, onToggle, candy = '#f29db0' }) => (
    <button
        onClick={onToggle} role="switch" aria-checked={on}
        className="relative w-[52px] h-[26px] shrink-0 transition-all duration-300 active:scale-95"
        style={{
            background: on ? candy : '#fdf7f2',
            border: on ? '1.5px solid rgba(61,47,61,0.18)' : '1.5px solid #dcc3cf',
            borderRadius: '8px 12px 9px 12px',
            boxShadow: on ? 'inset 0 1px 3px rgba(61,47,61,0.15)' : 'none',
        }}
    >
        <span className="absolute top-1/2 -translate-y-1/2 text-[8px] font-bold transition-opacity duration-300 pointer-events-none" style={{ ...MONO_STACK, left: 7, color: 'rgba(255,255,255,0.92)', opacity: on ? 1 : 0 }}>ON</span>
        <span className="absolute top-1/2 -translate-y-1/2 text-[8px] font-bold transition-opacity duration-300 pointer-events-none" style={{ ...MONO_STACK, right: 6, color: '#d8c2cd', opacity: on ? 0 : 1 }}>off</span>
        <span
            className="absolute top-1/2 -translate-y-1/2 w-[18px] h-[18px] bg-white flex items-center justify-center text-[9px] leading-none transition-all duration-300"
            style={{ left: on ? 29 : 3, borderRadius: '6px 8px 6px 8px', boxShadow: '0 1px 3px rgba(122,90,114,0.4)', color: on ? candy : '#e0ccd6' }}
        >♥</span>
    </button>
);

/** 标签贴纸：按文字种子微微歪斜，选中 = 糖果底，未选 = 白纸虚线框 */
export const StickerChip: React.FC<{
    active: boolean; onClick: () => void; seed: string;
    candy?: string; disabled?: boolean; title?: string; children: React.ReactNode;
}> = ({ active, onClick, seed, candy = '#fbb8c8', disabled, title, children }) => (
    <button
        onClick={onClick} title={title} disabled={disabled}
        className="px-2.5 py-1 text-[11px] font-bold transition-all active:scale-90 max-w-full truncate disabled:opacity-40"
        style={{
            transform: `rotate(${tiltFor(seed) * 0.55}deg)`,
            background: active ? candy : '#fffdfa',
            color: active ? '#5a3140' : '#a892a3',
            border: active ? '1px solid rgba(90,49,64,0.18)' : '1px solid #ddc9d3',
            borderRadius: '5px 11px 6px 11px',
            boxShadow: active ? '0 1px 2px rgba(122,90,114,0.28)' : 'none',
            ...CUTE_STACK,
        }}
    >{children}</button>
);

/** 横线手写输入：像写在本子的格线上 */
export const LinedInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { tag?: string }>(
    ({ tag, className = '', style, ...rest }, ref) => (
        <div className="w-full">
            {tag && <div className="text-[9px] mb-0.5 tracking-wider" style={{ ...MONO_STACK, color: '#a892a3' }}>{tag}</div>}
            <input
                ref={ref}
                {...rest}
                className={`w-full bg-transparent px-1 py-1.5 text-[13px] outline-none border-0 border-b border-solid border-[#dcc3cf] focus:border-[#f29db0] placeholder:text-[#cfb8c4] ${className}`}
                style={{ color: PAPER_TONES.ink, caretColor: '#f29db0', ...style }}
            />
        </div>
    )
);
LinedInput.displayName = 'LinedInput';

/** 格线便笺输入：带横线纹理的多行纸片 */
export const LinedArea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
    ({ className = '', style, ...rest }, ref) => (
        <textarea
            ref={ref}
            {...rest}
            className={`w-full rounded-[8px] px-3 py-2 text-[12.5px] resize-none outline-none placeholder:text-[#cfb8c4] ${className}`}
            style={{
                background: '#ffffff',
                border: '1px solid #ececec',
                lineHeight: '24px',
                color: PAPER_TONES.ink,
                caretColor: '#f29db0',
                ...style,
            }}
        />
    )
);
LinedArea.displayName = 'LinedArea';

/** 便签条：一句说明贴在纸上（info 玫瑰 / warn 蜜黄 / good 薄荷 / danger 莓红） */
export const NoteStrip: React.FC<{ tone?: 'info' | 'warn' | 'good' | 'danger'; children: React.ReactNode }> = ({ tone = 'info', children }) => {
    const palette = {
        info:   { bg: 'rgba(255,248,251,0.85)', border: '#eed6df', mark: '✎', markColor: '#d18ba0' },
        warn:   { bg: 'rgba(255,250,232,0.9)',  border: '#ecd9a0', mark: '!',  markColor: '#b08f3a' },
        good:   { bg: 'rgba(240,250,245,0.9)',  border: '#bfe1cf', mark: '✓', markColor: '#3f7d5c' },
        danger: { bg: 'rgba(255,235,240,0.85)', border: '#e8a0b0', mark: '✕', markColor: '#c75570' },
    }[tone];
    return (
        <div className="flex items-start gap-2 rounded-[8px] px-3 py-2.5" style={{ background: palette.bg, border: `1px solid ${palette.border}` }}>
            <span className="text-[10px] font-bold shrink-0 leading-[1.7]" style={{ color: palette.markColor }} aria-hidden>{palette.mark}</span>
            <div className="text-[10.5px] leading-relaxed" style={{ color: PAPER_TONES.inkSoft }}>{children}</div>
        </div>
    );
};

export default JournalSheet;
