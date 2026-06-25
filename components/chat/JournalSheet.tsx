import React from 'react';
import {
    PaperKind,
    MONO_STACK, tiltFor,
} from '../handbook/paper';
import { INK, INK_SOFT, HALFTONE, TAPE_STRIPES } from '../../apps/theater/scrapbook';

/**
 * 聊天功能弹层的视觉套件 —— 已统一为折子戏同款「黑白拼贴手账」：
 * 米白纸面 + 墨黑字 + 牛皮胶带 + 缝线虚线 + 网点半调；照片/头像保留原彩色。
 *
 * 本组件只在「絮语·单聊」一侧使用（Chat / ChatModals / 各设置弹层），
 * 所以在这里整体换肤即可一次性把单聊全部抽屉/便笺并入黑白拼贴，不影响别处。
 * 旧的 tape/pattern/paper 入参仍兼容保留（不再据此渲染糖果纸纹）。
 */

const PAPER_FILL = 'linear-gradient(180deg,#fbf9f2,#f2efe4)';
const PAPER_FIELD = 'rgba(255,253,247,0.82)';
const EDGE = 'rgba(176,170,158,0.82)';
const DASH = 'rgba(150,144,132,0.5)';
const HAZARD = 'repeating-linear-gradient(45deg, rgba(255,255,255,0.16) 0 6px, transparent 6px 13px)';

export const JournalSheet: React.FC<{
    open: boolean;
    title: string;
    /** 角落英文小标（打字机体） */
    en?: string;
    /** 标题下的一行小注 */
    sub?: string;
    /** 兼容旧调用保留（已不再渲染胶带/纸纹，黑白拼贴纸面） */
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
                style={{ background: 'rgba(20,18,16,0.5)', backdropFilter: 'blur(4px)' }}
                onClick={onClose}
            />
            <div
                className="relative w-full sm:max-w-[26rem] flex flex-col animate-slide-up rounded-t-[22px] sm:rounded-[22px] overflow-hidden"
                style={{
                    background: PAPER_FILL,
                    maxHeight: tall ? 'min(88vh, calc(100dvh - 18px))' : 'min(80vh, calc(100dvh - 18px))',
                    paddingBottom: 'var(--safe-bottom)',
                    border: `1px solid ${EDGE}`,
                    boxShadow: '0 -22px 60px -24px rgba(20,18,14,0.55), 0 24px 60px -24px rgba(20,18,14,0.5)',
                    color: INK,
                }}
                onClick={e => e.stopPropagation()}
            >
                {/* 网点半调点缀（黑白拼贴标志纹理） */}
                <div aria-hidden className="pointer-events-none absolute top-0 right-0 w-28 h-24" style={{ backgroundImage: HALFTONE, backgroundSize: '7px 7px', opacity: 0.1, WebkitMaskImage: 'radial-gradient(circle at top right, #000, transparent 72%)', maskImage: 'radial-gradient(circle at top right, #000, transparent 72%)' }} />
                {/* 顶部牛皮胶带（仅居中桌面态显形，手机底部抽屉态略） */}
                <div aria-hidden className="hidden sm:block absolute -top-3 left-1/2 -translate-x-1/2 w-24 h-6 rounded-[2px] z-10" style={{ backgroundColor: 'rgba(31,29,26,0.92)', backgroundImage: TAPE_STRIPES, borderLeft: '1px dashed rgba(255,255,255,0.35)', borderRight: '1px dashed rgba(255,255,255,0.35)', boxShadow: '0 2px 6px rgba(31,29,26,0.18)', transform: 'translateX(-50%) rotate(-4deg)' }} />
                <div className="shrink-0 flex items-start justify-between gap-3 px-4 pt-4 pb-2.5 relative z-[1]" style={{ borderBottom: `1px dashed ${DASH}` }}>
                    <div className="min-w-0 pt-0.5">
                        {en && <div className="text-[8.5px] tracking-[0.22em] uppercase select-none" style={{ ...MONO_STACK, color: INK_SOFT }}>{en}</div>}
                        <div className="text-[16px] font-black leading-tight mt-0.5" style={{ color: INK }}>{title}</div>
                        {sub && <div className="text-[10.5px] mt-0.5" style={{ color: INK_SOFT }}>{sub}</div>}
                    </div>
                    <button
                        onClick={onClose}
                        aria-label="合上这页"
                        className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center active:scale-90 transition-transform"
                        style={{ background: PAPER_FIELD, border: `1px solid ${EDGE}`, outline: `1px dashed ${DASH}`, outlineOffset: -3, color: INK }}
                    >
                        <span className="text-[13px] leading-none" aria-hidden>✕</span>
                    </button>
                </div>
                <div className="flex-1 min-h-[120px] overflow-y-auto overscroll-contain no-scrollbar px-4 pt-4 pb-5 relative z-[1]">
                    {children}
                </div>
                {footer && (
                    <div className="shrink-0 flex gap-2.5 px-4 py-3.5 relative z-[1]" style={{ borderTop: `1px dashed ${DASH}` }}>
                        {footer}
                    </div>
                )}
            </div>
        </div>
    );
};

/** 印章按钮：墨/纸两系，按下去像盖了一枚章（右下硬影 + 下沉） */
export const SealBtn: React.FC<{
    kind?: 'rose' | 'ghost' | 'ink' | 'berry' | 'mint';
    onClick?: () => void;
    disabled?: boolean;
    full?: boolean;
    children: React.ReactNode;
}> = ({ kind = 'rose', onClick, disabled, full, children }) => {
    // 主操作（rose/berry/ink）= 墨色实底；次操作（ghost/mint）= 纸色
    const inkLike = kind === 'rose' || kind === 'berry' || kind === 'ink';
    const palette = inkLike
        ? { bg: INK, border: '1.5px solid #000', fg: '#f6f3ec', shadow: 'rgba(31,29,26,0.4)' }
        : { bg: PAPER_FIELD, border: `1.5px solid ${EDGE}`, fg: INK, shadow: 'rgba(150,144,132,0.5)' };
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={`${full ? 'w-full' : 'flex-1'} py-3 px-3 rounded-[12px] text-[13px] font-black flex items-center justify-center gap-1.5 transition-all active:translate-y-[2px] active:shadow-none disabled:opacity-40 disabled:active:translate-y-0`}
            style={{ background: palette.bg, border: palette.border, color: palette.fg, boxShadow: `2px 2px 0 ${palette.shadow}`, outline: inkLike ? '1px dashed rgba(255,255,255,0.28)' : `1px dashed ${DASH}`, outlineOffset: -4 }}
        >
            {children}
        </button>
    );
};

/** 拨片开关：撕角矩形 + 缝线虚框 + 爱心滑钮（开=墨底，关=纸底） */
export const CandyToggle: React.FC<{ on: boolean; onToggle: () => void; candy?: string }> = ({ on, onToggle }) => (
    <button
        onClick={onToggle} role="switch" aria-checked={on}
        className="relative w-[52px] h-[26px] shrink-0 transition-all duration-300 active:scale-95"
        style={{
            background: on ? INK : '#fdf9f2',
            backgroundImage: on ? HAZARD : undefined,
            border: on ? '1.5px solid #000' : `1.5px solid ${EDGE}`,
            borderRadius: '8px 12px 9px 12px',
            boxShadow: on ? 'inset 0 1px 3px rgba(0,0,0,0.3)' : 'none',
        }}
    >
        <span className="absolute top-1/2 -translate-y-1/2 text-[8px] font-bold transition-opacity duration-300 pointer-events-none" style={{ ...MONO_STACK, left: 7, color: 'rgba(246,243,236,0.95)', opacity: on ? 1 : 0 }}>ON</span>
        <span className="absolute top-1/2 -translate-y-1/2 text-[8px] font-bold transition-opacity duration-300 pointer-events-none" style={{ ...MONO_STACK, right: 6, color: INK_SOFT, opacity: on ? 0 : 1 }}>off</span>
        <span
            className="absolute top-1/2 -translate-y-1/2 w-[18px] h-[18px] flex items-center justify-center text-[9px] leading-none transition-all duration-300"
            style={{ left: on ? 29 : 3, background: '#fbf9f2', borderRadius: '6px 8px 6px 8px', boxShadow: '0 1px 3px rgba(31,29,26,0.45)', color: on ? INK : INK_SOFT }}
        >♥</span>
    </button>
);

/** 标签贴纸：按文字种子微微歪斜，选中 = 墨底，未选 = 纸面虚线框 */
export const StickerChip: React.FC<{
    active: boolean; onClick: () => void; seed: string;
    candy?: string; disabled?: boolean; title?: string; children: React.ReactNode;
}> = ({ active, onClick, seed, disabled, title, children }) => (
    <button
        onClick={onClick} title={title} disabled={disabled}
        className="px-2.5 py-1 text-[11px] font-bold transition-all active:scale-90 max-w-full truncate disabled:opacity-40"
        style={{
            transform: `rotate(${tiltFor(seed) * 0.55}deg)`,
            background: active ? INK : PAPER_FIELD,
            color: active ? '#f6f3ec' : INK_SOFT,
            border: active ? '1px solid #000' : `1px solid ${EDGE}`,
            borderRadius: '5px 11px 6px 11px',
            boxShadow: active ? '0 1px 2px rgba(31,29,26,0.3)' : 'none',
        }}
    >{children}</button>
);

/** 横线手写输入：像写在本子的格线上（墨色光标 + 缝线下划） */
export const LinedInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { tag?: string }>(
    ({ tag, className = '', style, ...rest }, ref) => (
        <div className="w-full">
            {tag && <div className="text-[9px] mb-0.5 tracking-wider" style={{ ...MONO_STACK, color: INK_SOFT }}>{tag}</div>}
            <input
                ref={ref}
                {...rest}
                className={`w-full bg-transparent px-1 py-1.5 text-[13px] outline-none border-0 border-b border-dashed placeholder:text-[#a9a195] ${className}`}
                style={{ color: INK, borderColor: INK_SOFT, caretColor: INK, ...style }}
            />
        </div>
    )
);
LinedInput.displayName = 'LinedInput';

/** 格线便笺输入：带缝线边的多行纸片 */
export const LinedArea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
    ({ className = '', style, ...rest }, ref) => (
        <textarea
            ref={ref}
            {...rest}
            className={`w-full rounded-[10px] px-3 py-2 text-[12.5px] resize-none outline-none placeholder:text-[#a9a195] ${className}`}
            style={{
                background: PAPER_FIELD,
                border: `1px solid ${EDGE}`,
                outline: `1px dashed ${DASH}`,
                outlineOffset: -4,
                lineHeight: '24px',
                color: INK,
                caretColor: INK,
                ...style,
            }}
        />
    )
);
LinedArea.displayName = 'LinedArea';

/** 便签条：一句说明贴在纸上（黑白灰四态，靠记号区分） */
export const NoteStrip: React.FC<{ tone?: 'info' | 'warn' | 'good' | 'danger'; children: React.ReactNode }> = ({ tone = 'info', children }) => {
    const palette = {
        info:   { bg: PAPER_FIELD, border: EDGE, mark: '✎', dark: false },
        warn:   { bg: 'rgba(243,239,229,0.92)', border: INK_SOFT, mark: '!', dark: false },
        good:   { bg: PAPER_FIELD, border: EDGE, mark: '✓', dark: false },
        danger: { bg: INK, border: '#000', mark: '✕', dark: true },
    }[tone];
    return (
        <div className="flex items-start gap-2 rounded-[8px] px-3 py-2.5" style={{ background: palette.bg, backgroundImage: palette.dark ? HAZARD : undefined, border: `1px solid ${palette.border}` }}>
            <span className="text-[10px] font-bold shrink-0 leading-[1.7]" style={{ color: palette.dark ? '#f6f3ec' : INK }} aria-hidden>{palette.mark}</span>
            <div className="text-[10.5px] leading-relaxed" style={{ color: palette.dark ? '#e6dfd2' : INK_SOFT }}>{children}</div>
        </div>
    );
};

export default JournalSheet;
