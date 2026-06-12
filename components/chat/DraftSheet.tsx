import React from 'react';
import { X } from '@phosphor-icons/react';

/**
 * 「制图房 draft-room」UI 套件 —— 聊天 App 内功能弹层 / 设置面板的统一视觉基建。
 *
 * 设计语言（与旧版黑白手帐 / 信纸风完全区分）：
 *  - 冷灰蓝图底（#f2f5fa）+ 白卡 + #d9e2ee 细描边，钴蓝 #2f54d6 作唯一强调色
 *  - 矩形圆角（10–14px），主按钮带 3px 压边（按下下沉 1px）
 *  - 方形滑钮开关、白块分段器、等宽编号标头（FN-XX）
 */

export const DR = {
    paper: '#f2f5fa',
    card: '#ffffff',
    line: '#d9e2ee',
    ink: '#222f47',
    sub: '#75839c',
    blue: '#2f54d6',
    blueDeep: '#2342b0',
    blueWash: '#e8edfb',
    red: '#d6452f',
    redWash: '#fdeeea',
    green: '#0f9d76',
};

/** 弹层外壳：底部贴边抽屉（桌面居中），左缘钴蓝竖条 + 等宽编号 + 标题 + 方形关闭键 */
export const DraftSheet: React.FC<{
    open: boolean;
    /** 等宽小编号，如 "FN-01" */
    code: string;
    title: string;
    /** 标题下的一行小注 */
    sub?: string;
    onClose: () => void;
    children: React.ReactNode;
    /** 底部操作区（不传则不渲染底栏） */
    footer?: React.ReactNode;
    /** 内容区更高（如日程 / 历史列表） */
    tall?: boolean;
    /** 覆盖层 z-index 类（默认 z-[100]，与旧 Modal 持平） */
    zClass?: string;
}> = ({ open, code, title, sub, onClose, children, footer, tall, zClass = 'z-[100]' }) => {
    if (!open) return null;
    return (
        <div className={`fixed inset-0 ${zClass} flex items-end sm:items-center justify-center animate-fade-in`}>
            <div
                className="absolute inset-0"
                style={{ background: 'rgba(15,22,38,0.5)', backdropFilter: 'blur(5px)' }}
                onClick={onClose}
            />
            <div
                className="relative w-full sm:max-w-[26rem] flex flex-col overflow-hidden animate-slide-up rounded-t-[18px] sm:rounded-[18px] border-t sm:border"
                style={{ background: DR.paper, borderColor: DR.line, maxHeight: tall ? '88vh' : '80vh', paddingBottom: 'var(--safe-bottom)' }}
                onClick={e => e.stopPropagation()}
            >
                {/* 标头 */}
                <div className="shrink-0 flex items-stretch gap-3 pl-4 pr-3 pt-4 pb-3 border-b border-dotted" style={{ borderColor: DR.line, background: DR.card }}>
                    <span aria-hidden className="w-[3px] rounded-sm self-stretch" style={{ background: DR.blue }} />
                    <div className="flex-1 min-w-0">
                        <div className="font-mono text-[9px] font-bold tracking-[0.3em] uppercase" style={{ color: DR.blue }}>{code}</div>
                        <div className="text-[15px] font-bold leading-snug" style={{ color: DR.ink }}>{title}</div>
                        {sub && <div className="text-[10.5px] mt-0.5 truncate" style={{ color: DR.sub }}>{sub}</div>}
                    </div>
                    <button
                        onClick={onClose}
                        aria-label="收起"
                        className="self-center w-9 h-9 shrink-0 rounded-[10px] border flex items-center justify-center active:translate-y-[1px] transition-transform"
                        style={{ borderColor: DR.line, background: DR.paper, color: DR.sub }}
                    >
                        <X className="w-4 h-4" weight="bold" />
                    </button>
                </div>
                {/* 内容 */}
                <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-4 py-4">
                    {children}
                </div>
                {/* 底栏 */}
                {footer && (
                    <div className="shrink-0 flex gap-2.5 px-4 py-3.5 border-t border-dotted" style={{ borderColor: DR.line, background: DR.card }}>
                        {footer}
                    </div>
                )}
            </div>
        </div>
    );
};

/** 压边按钮：primary 钴蓝实底 / ghost 白底描边 / danger 红 / dark 墨蓝 */
export const PressBtn: React.FC<{
    kind?: 'primary' | 'ghost' | 'danger' | 'dark';
    onClick?: () => void;
    disabled?: boolean;
    full?: boolean;
    children: React.ReactNode;
}> = ({ kind = 'primary', onClick, disabled, full, children }) => {
    const palette = {
        primary: { bg: DR.blue, edge: DR.blueDeep, fg: '#ffffff', border: DR.blue },
        dark: { bg: DR.ink, edge: '#101a2e', fg: '#ffffff', border: DR.ink },
        danger: { bg: DR.red, edge: '#a93423', fg: '#ffffff', border: DR.red },
        ghost: { bg: '#ffffff', edge: DR.line, fg: '#4d5d78', border: DR.line },
    }[kind];
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={`${full ? 'w-full' : 'flex-1'} py-3 px-3 rounded-[12px] text-[13px] font-bold flex items-center justify-center gap-1.5 transition-all active:translate-y-[1px] disabled:opacity-40 disabled:active:translate-y-0`}
            style={{ background: palette.bg, color: palette.fg, border: `1px solid ${palette.border}`, borderBottomWidth: 3, borderBottomColor: palette.edge }}
        >
            {children}
        </button>
    );
};

/** 方形滑钮开关（矩形轨道，ON = 钴蓝；tone 可覆盖 ON 色） */
export const SlideKey: React.FC<{ on: boolean; onFlip: () => void; tone?: string }> = ({ on, onFlip, tone }) => (
    <button
        onClick={onFlip}
        role="switch"
        aria-checked={on}
        className="w-[46px] h-[26px] shrink-0 rounded-[8px] p-[3px] transition-colors duration-200 flex items-center"
        style={{ background: on ? (tone || DR.blue) : '#cbd5e3' }}
    >
        <span
            className="w-5 h-5 rounded-[5px] bg-white transition-transform duration-200 shadow-[0_1px_3px_rgba(20,30,55,0.35)]"
            style={{ transform: on ? 'translateX(20px)' : 'translateX(0)' }}
        />
    </button>
);

/** 分段器容器（浅灰槽）——子元素用 SegCell */
export const SegRail: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
    <div className={`flex rounded-[10px] p-1 gap-1 ${className || ''}`} style={{ background: '#e7edf5' }}>
        {children}
    </div>
);

/** 分段器单元：选中 = 白块 + 钴蓝字 */
export const SegCell: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({ active, onClick, children }) => (
    <button
        onClick={onClick}
        className="flex-1 py-2 px-2 rounded-[8px] text-[12px] font-bold transition-all"
        style={active
            ? { background: '#ffffff', color: DR.blue, boxShadow: '0 1px 3px rgba(34,47,71,0.12)' }
            : { background: 'transparent', color: DR.sub }}
    >
        {children}
    </button>
);

/** 小方标签（多选 / 枚举项）：选中 = 墨蓝实底 */
export const TagKey: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode; className?: string }> = ({ active, onClick, children, className }) => (
    <button
        onClick={onClick}
        className={`px-2.5 py-1.5 rounded-[8px] text-[11px] font-bold border transition-all active:translate-y-[1px] max-w-full truncate ${className || ''}`}
        style={active
            ? { background: DR.ink, color: '#fff', borderColor: DR.ink }
            : { background: '#fff', color: '#5b6b85', borderColor: DR.line }}
    >
        {children}
    </button>
);

/** 统一输入框 */
export const FieldInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
    ({ className, style, ...rest }, ref) => (
        <input
            ref={ref}
            {...rest}
            className={`w-full px-3.5 py-3 rounded-[10px] text-[13px] outline-none transition-colors ${className || ''}`}
            style={{ background: '#eaeff7', border: '1px solid transparent', color: DR.ink, ...style }}
            onFocus={e => { e.currentTarget.style.borderColor = `${DR.blue}66`; e.currentTarget.style.background = '#fff'; rest.onFocus?.(e); }}
            onBlur={e => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = '#eaeff7'; rest.onBlur?.(e); }}
        />
    )
);
FieldInput.displayName = 'FieldInput';

/** 统一多行输入 */
export const FieldArea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
    ({ className, style, ...rest }, ref) => (
        <textarea
            ref={ref}
            {...rest}
            className={`w-full px-3.5 py-3 rounded-[10px] text-[13px] outline-none resize-none transition-colors ${className || ''}`}
            style={{ background: '#eaeff7', border: '1px solid transparent', color: DR.ink, ...style }}
            onFocus={e => { e.currentTarget.style.borderColor = `${DR.blue}66`; e.currentTarget.style.background = '#fff'; rest.onFocus?.(e); }}
            onBlur={e => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = '#eaeff7'; rest.onBlur?.(e); }}
        />
    )
);
FieldArea.displayName = 'FieldArea';

/** 白卡分组：可选小角标 */
export const DraftCard: React.FC<{ children: React.ReactNode; className?: string; corner?: string }> = ({ children, className, corner }) => (
    <div className={`relative rounded-[14px] border p-3.5 ${className || ''}`} style={{ background: DR.card, borderColor: DR.line }}>
        {corner && (
            <span className="absolute top-2.5 right-3 font-mono text-[8px] font-bold tracking-[0.25em] uppercase" style={{ color: `${DR.sub}88` }}>{corner}</span>
        )}
        {children}
    </div>
);

/** 说明行：左侧短点线 + 小字 */
export const NoteLine: React.FC<{ children: React.ReactNode; tone?: 'info' | 'warn' | 'danger' }> = ({ children, tone = 'info' }) => {
    const color = tone === 'danger' ? DR.red : tone === 'warn' ? '#b07a1f' : DR.sub;
    return (
        <p className="flex gap-2 text-[10.5px] leading-relaxed" style={{ color }}>
            <span aria-hidden className="shrink-0 mt-[7px] w-3 border-t border-dotted" style={{ borderColor: color }} />
            <span className="flex-1 min-w-0">{children}</span>
        </p>
    );
};

export default DraftSheet;
