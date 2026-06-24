import React from 'react';
import { INK, INK_SOFT, HALFTONE, WashiTape, WashiColor, TAPE_STRIPES } from '../../apps/theater/scrapbook';

/**
 * 絮语 · 黑白拼贴手账弹窗套件（Scrap Modal Kit）
 * ──────────────────────────────────────────────
 * 把「絮语」（来往/群聊）里所有功能弹窗统一成折子戏同款「黑白拼贴手账」皮肤：
 * 米白纸面 + 墨黑字 + 牛皮胶带 + 缝线虚线描边 + 邮票 + 网点半调。
 *
 * 一切用 **行内样式**（而非 Tailwind 类），所以不受 index.html 里 `.moro-laiwang`
 * 作用域那套「ins 浅白皮肤覆盖」影响——弹窗稳稳落在黑白拼贴这一身份上。
 *
 * 约束（与折子戏一致）：只管「长什么样」，不动任何业务逻辑；
 * **头像 / 照片一律保留原彩色**（用户明确要求头像不黑白）。
 *
 * `ScrapModal` 与旧的 `components/os/Modal` 保持同一套 props（isOpen/title/onClose/children/footer），
 * 调用处只要换 import 即可整窗换肤；另多收 en / icon / tape / maxWidth 几个可选项点缀。
 */

const PAPER_FILL = 'linear-gradient(180deg,#fbf9f2,#f2efe4)';
const PAPER_FIELD = 'rgba(255,253,247,0.82)';
const DASH = 'rgba(150,144,132,0.5)';
const EDGE = 'rgba(176,170,158,0.82)';
const HAZARD = 'repeating-linear-gradient(45deg, rgba(255,255,255,0.16) 0 6px, transparent 6px 13px)';

// ── 主弹窗：居中纸卡 + 顶部胶带 + 网点角 + 墨色标题 ───────────────
interface ScrapModalProps {
    isOpen: boolean;
    title: string;
    onClose: () => void;
    children: React.ReactNode;
    footer?: React.ReactNode;
    /** 标题上方的拉丁小字（手账邮戳感），如 "GROUP · 群聊" */
    en?: string;
    /** 标题左侧的邮票图标 */
    icon?: React.ReactNode;
    tape?: WashiColor;
    maxWidth?: number;
    /** 无 footer 时默认关闭键的文案 */
    closeLabel?: string;
}

const ScrapModal: React.FC<ScrapModalProps> = ({
    isOpen, title, onClose, children, footer, en, icon, tape = 'ink', maxWidth = 358, closeLabel = '收起',
}) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-5 animate-fade-in">
            <div className="absolute inset-0" style={{ background: 'rgba(20,18,16,0.5)', backdropFilter: 'blur(3px)' }} onClick={onClose} />
            <div
                className="relative w-full animate-pop-in flex flex-col"
                style={{
                    maxWidth, maxHeight: '84vh',
                    background: PAPER_FILL,
                    border: `1px solid ${EDGE}`,
                    outline: `1px dashed ${DASH}`,
                    outlineOffset: -6,
                    borderRadius: 18,
                    boxShadow: '0 32px 60px -22px rgba(20,18,14,0.62)',
                    transform: 'rotate(-0.5deg)',
                    color: INK,
                }}
            >
                {/* 网点半调点缀：右上角淡淡铺一小片，黑白拼贴的标志纹理 */}
                <div aria-hidden className="pointer-events-none absolute top-0 right-0 w-28 h-24" style={{ backgroundImage: HALFTONE, backgroundSize: '7px 7px', opacity: 0.1, borderTopRightRadius: 18, WebkitMaskImage: 'radial-gradient(circle at top right, #000, transparent 72%)', maskImage: 'radial-gradient(circle at top right, #000, transparent 72%)' }} />
                <WashiTape color={tape} rotate={-5} className="absolute -top-3 left-1/2 -translate-x-1/2 w-24 h-6 rounded-[2px] z-10" />

                <div className="px-6 pt-7 pb-3 text-center shrink-0 relative z-[1]">
                    {en && <div className="text-[9px] tracking-[0.34em] uppercase mb-1.5" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>{en}</div>}
                    <div className="flex items-center justify-center gap-2">
                        {icon}
                        <h3 className="text-[18px] font-black leading-tight" style={{ color: INK }}>{title}</h3>
                    </div>
                    <div className="mx-auto mt-2.5 h-px w-16" style={{ backgroundImage: 'repeating-linear-gradient(90deg, rgba(140,132,118,0.6) 0 5px, transparent 5px 10px)' }} />
                </div>

                <div className="px-6 pb-2 overflow-y-auto no-scrollbar relative z-[1]" style={{ color: '#54504a' }}>
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

// ── 贴纸按钮（墨 / 纸 / 透明 / 危险斜纹）──────────────────────────
export const ScrapBtn: React.FC<{
    children: React.ReactNode;
    onClick?: () => void;
    variant?: 'ink' | 'paper' | 'ghost' | 'danger';
    disabled?: boolean;
    icon?: React.ReactNode;
    className?: string;
    /** 默认占满整行（适合 footer）；传 false 走自适应宽度 */
    full?: boolean;
    type?: 'button' | 'submit';
    title?: string;
}> = ({ children, onClick, variant = 'ink', disabled, icon, className = '', full = true, type = 'button', title }) => {
    const base = `relative inline-flex items-center justify-center gap-1.5 font-black rounded-full transition-transform active:scale-[0.96] disabled:opacity-45 disabled:active:scale-100 ${full ? 'w-full' : ''}`;
    const styles: Record<string, React.CSSProperties> = {
        ink: { background: INK, color: '#f6f3ec', outline: '1px dashed rgba(255,255,255,0.32)', outlineOffset: -4, boxShadow: '0 12px 22px -12px rgba(31,29,26,0.6)' },
        paper: { background: 'rgba(255,253,247,0.96)', color: INK, border: `1px solid ${EDGE}`, outline: `1px dashed ${DASH}`, outlineOffset: -4, boxShadow: '0 10px 20px -14px rgba(31,29,26,0.5)' },
        ghost: { background: 'transparent', color: '#605a4e', border: '1px dashed rgba(140,132,118,0.6)' },
        danger: { background: INK, backgroundImage: HAZARD, color: '#f6f3ec', outline: '1px dashed rgba(255,255,255,0.4)', outlineOffset: -4, boxShadow: '0 12px 22px -12px rgba(31,29,26,0.6)' },
    };
    return (
        <button type={type} onClick={onClick} disabled={disabled} title={title} className={`${base} py-3 px-4 ${className}`} style={styles[variant]}>
            {icon}{children}
        </button>
    );
};

// ── 行内输入 / 文本域（米白纸条 + 缝线）──────────────────────────
const fieldStyle: React.CSSProperties = {
    background: PAPER_FIELD,
    border: `1px solid ${EDGE}`,
    outline: `1px dashed ${DASH}`,
    outlineOffset: -4,
    borderRadius: 12,
    color: INK,
};
export const ScrapInput: React.FC<React.InputHTMLAttributes<HTMLInputElement> & { center?: boolean; big?: boolean }> = ({ className = '', center, big, style, ...props }) => (
    <input
        {...props}
        className={`w-full px-4 outline-none transition-all placeholder:text-[#a9a195] ${big ? 'py-4 text-2xl font-black text-center' : center ? 'py-3 text-sm text-center' : 'py-3 text-sm'} ${className}`}
        style={{ ...fieldStyle, ...style }}
    />
);
export const ScrapTextarea: React.FC<React.TextareaHTMLAttributes<HTMLTextAreaElement>> = ({ className = '', style, ...props }) => (
    <textarea
        {...props}
        className={`w-full px-4 py-3 text-sm leading-relaxed outline-none resize-none transition-all placeholder:text-[#a9a195] ${className}`}
        style={{ ...fieldStyle, ...style }}
    />
);

// ── 小旗分区标签（墨色块 + 延伸缝线）────────────────────────────
export const ScrapLabel: React.FC<{ children: React.ReactNode; en?: string; className?: string }> = ({ children, en, className = '' }) => (
    <div className={`flex items-center gap-2 mb-2.5 ${className}`}>
        <span className="px-2 py-0.5 rounded-[4px] text-[10px] font-black tracking-wide shrink-0" style={{ background: INK, color: '#f6f3ec' }}>{children}</span>
        {en && <span className="text-[8px] tracking-[0.28em] uppercase shrink-0" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>{en}</span>}
        <span className="flex-1 h-px" style={{ backgroundImage: 'repeating-linear-gradient(90deg, rgba(140,132,118,0.55) 0 5px, transparent 5px 10px)' }} />
    </div>
);

// ── 脚注小字 ─────────────────────────────────────────────────
export const ScrapNote: React.FC<{ children: React.ReactNode; className?: string; center?: boolean }> = ({ children, className = '', center }) => (
    <p className={`text-[10.5px] leading-snug ${center ? 'text-center' : ''} ${className}`} style={{ color: INK_SOFT }}>{children}</p>
);

// ── 票根虚线分隔 ─────────────────────────────────────────────
export const ScrapDivider: React.FC<{ className?: string }> = ({ className = '' }) => (
    <div className={`h-px ${className}`} style={{ backgroundImage: 'repeating-linear-gradient(90deg, rgba(140,132,118,0.5) 0 6px, transparent 6px 12px)' }} />
);

// ── 头像挑选格（彩色头像 + 选中墨框 + 角标）──────────────────────
export const ScrapPickTile: React.FC<{
    src?: string;
    label: string;
    selected?: boolean;
    onClick?: () => void;
    badge?: React.ReactNode;
    /** 头像去色（如禁言态）；默认彩色 */
    dim?: boolean;
}> = ({ src, label, selected, onClick, badge, dim }) => (
    <button
        onClick={onClick}
        className="relative flex flex-col items-center gap-1 p-2 transition-transform active:scale-95"
        style={{
            background: selected ? INK : PAPER_FIELD,
            border: `1px solid ${selected ? INK : EDGE}`,
            outline: `1px dashed ${selected ? 'rgba(255,255,255,0.3)' : DASH}`,
            outlineOffset: -4,
            borderRadius: 12,
        }}
    >
        <div className="relative">
            <img src={src} className="w-10 h-10 rounded-full object-cover" style={dim ? { filter: 'grayscale(1)', opacity: 0.55 } : undefined} alt="" />
            {badge && <span className="absolute -top-1 -right-1">{badge}</span>}
            {selected && (
                <span aria-hidden className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center text-[9px]" style={{ background: '#f6f3ec', color: INK, boxShadow: '0 1px 3px rgba(31,29,26,0.5)' }}>✓</span>
            )}
        </div>
        <span className="text-[9px] truncate w-full text-center font-bold" style={{ color: selected ? '#f3ecdf' : '#54504a' }}>{label}</span>
    </button>
);

// ── 药丸开关（群主/管理员/红包类型 等单/多选）────────────────────
export const ScrapChip: React.FC<{
    children: React.ReactNode;
    selected?: boolean;
    onClick?: () => void;
    icon?: React.ReactNode;
    className?: string;
}> = ({ children, selected, onClick, icon, className = '' }) => (
    <button
        onClick={onClick}
        className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-bold transition-transform active:scale-95 ${className}`}
        style={selected
            ? { background: INK, color: '#f6f3ec', outline: '1px dashed rgba(255,255,255,0.3)', outlineOffset: -3 }
            : { background: PAPER_FIELD, color: '#605a4e', border: `1px solid ${EDGE}`, outline: `1px dashed ${DASH}`, outlineOffset: -3 }}
    >
        {icon}{children}
    </button>
);

// ── 整行选项钮（消息操作 / 转发 / @谁 / 选成员 列表用）─────────────
export const ScrapRowBtn: React.FC<{
    children: React.ReactNode;
    onClick?: () => void;
    icon?: React.ReactNode;
    /** 左侧彩色头像 */
    avatar?: string;
    avatarDim?: boolean;
    trailing?: React.ReactNode;
    danger?: boolean;
    disabled?: boolean;
    className?: string;
}> = ({ children, onClick, icon, avatar, avatarDim, trailing, danger, disabled, className = '' }) => (
    <button
        onClick={onClick}
        disabled={disabled}
        className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-transform active:scale-[0.98] disabled:opacity-40 ${className}`}
        style={{
            background: PAPER_FIELD,
            border: `1px solid ${EDGE}`,
            outline: `1px dashed ${DASH}`,
            outlineOffset: -4,
            borderRadius: 13,
            color: danger ? INK : '#3b3730',
            backgroundImage: danger ? HAZARD : undefined,
        }}
    >
        {avatar && <img src={avatar} className="w-9 h-9 rounded-full object-cover shrink-0" style={avatarDim ? { filter: 'grayscale(1)', opacity: 0.6 } : undefined} alt="" />}
        {icon && <span className="shrink-0 flex items-center" style={{ color: INK }}>{icon}</span>}
        <span className="flex-1 min-w-0 text-sm font-bold truncate">{children}</span>
        {trailing}
    </button>
);

// ── 邮票图标盒（标题左侧 / 装饰用）──────────────────────────────
export const ScrapStamp: React.FC<{ children: React.ReactNode; size?: number }> = ({ children, size = 30 }) => (
    <span
        className="relative inline-flex items-center justify-center shrink-0"
        style={{
            width: size, height: size, borderRadius: 7,
            background: '#f7f4ec', color: INK,
            boxShadow: '0 0 0 2px #f7f4ec, 0 0 0 3px rgba(150,144,132,0.6)',
            outline: '1.5px dashed rgba(150,144,132,0.65)', outlineOffset: -3,
        }}
    >
        {children}
    </span>
);

export { INK, INK_SOFT, HAZARD, TAPE_STRIPES };
