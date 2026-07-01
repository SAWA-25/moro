import React from 'react';

/**
 * 岁时记 · 视觉零件库 —— Ins 风
 * ------------------------------------------------------------
 * 封面（AlmanacApp）、时光契约（ScheduleApp）、特别时光、实时日历、存钱罐（BankApp）
 * 共用同一套视觉语言。换肤后：干净暖白页 + 白卡 + 极柔投影 + 大圆角，
 * 只保留少量邮戳、回形针这类轻装饰。导出名 / 签名保持不变，调用点无需改动。
 */

/** 手写感字体栈 */
export const HAND_FONT =
    '"Caveat","Patrick Hand","Brush Script MT","STKaiti","Kaiti SC","楷体","KaiTi",cursive';

/** 由任意字符串/数字推出 -3.5°~3.5° 固定小角度。 */
export const tinyRotate = (seed: string | number): number => {
    const s = String(seed);
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0xffff;
    return ((h % 70) - 35) / 10;
};

/** 页底纹理（Ins 化：极淡，干净暖白为主）。 */
export const paperTexture = (
    kind: 'kraft' | 'grid' | 'sticky' = 'kraft',
): React.CSSProperties => {
    if (kind === 'grid') {
        return {
            backgroundColor: '#f7f5f2',
            backgroundImage:
                'linear-gradient(rgba(38,36,42,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(38,36,42,0.035) 1px, transparent 1px)',
            backgroundSize: '22px 22px',
        };
    }
    if (kind === 'sticky') {
        return { backgroundColor: '#fdfaf4' };
    }
    return {
        backgroundColor: '#f7f5f2',
        backgroundImage: 'radial-gradient(120% 80% at 50% -10%, rgba(245,158,11,0.05), transparent 60%)',
    };
};

/** 整页容器：暖白页 + 安全区。 */
export const PaperPage: React.FC<{
    kind?: 'kraft' | 'grid' | 'sticky';
    className?: string;
    style?: React.CSSProperties;
    children: React.ReactNode;
}> = ({ kind = 'kraft', className = '', style, children }) => (
    <div className={`h-full w-full relative overflow-hidden ${className}`} style={{ ...paperTexture(kind), ...style }}>
        {children}
    </div>
);

/** 票签：干净胶囊小标题。 */
export const TapeLabel: React.FC<{
    children: React.ReactNode;
    color?: string;
    textColor?: string;
    className?: string;
    rotate?: number;
}> = ({ children, color = '#fde4b0', textColor = '#92400e', className = '', rotate = 0 }) => (
    <span className={`inline-block px-3 py-1 rounded-full text-[11px] font-bold tracking-wide select-none ${className}`}
        style={{ background: color, color: textColor, transform: rotate ? `rotate(${rotate}deg)` : undefined }}>
        {children}
    </span>
);

/** 纸片 -> Ins 白卡（大圆角 + 极柔投影），可选微旋。 */
export const PaperNote: React.FC<{
    children: React.ReactNode;
    className?: string;
    rotate?: number;
    bg?: string;
    onClick?: () => void;
    style?: React.CSSProperties;
}> = ({ children, className = '', rotate = 0, bg = '#ffffff', onClick, style }) => (
    <div onClick={onClick}
        className={`relative ${onClick ? 'press-soft cursor-pointer' : ''} ${className}`}
        style={{
            background: bg, borderRadius: 18, border: '1px solid rgba(0,0,0,0.05)',
            boxShadow: '0 1px 2px rgba(38,36,42,0.04), 0 16px 32px -24px rgba(38,36,42,0.3)',
            transform: rotate ? `rotate(${rotate}deg)` : undefined,
            ...style,
        }}>
        {children}
    </div>
);

/** 圆形邮戳 / 印章（装饰，软化版）。 */
export const Postmark: React.FC<{
    children: React.ReactNode;
    color?: string;
    size?: number;
    className?: string;
    rotate?: number;
}> = ({ children, color = '#f43f5e', size = 56, className = '', rotate = -14 }) => (
    <span className={`inline-flex items-center justify-center text-center font-black leading-none select-none ${className}`}
        style={{
            width: size, height: size, color, border: `2px dashed ${color}`, borderRadius: '9999px',
            transform: `rotate(${rotate}deg)`, fontSize: size * 0.2, opacity: 0.85,
        }}>
        {children}
    </span>
);

/** 回形针（装饰）。 */
export const PaperClip: React.FC<{ className?: string; color?: string }> = ({ className = '', color = '#9aa6b2' }) => (
    <svg aria-hidden viewBox="0 0 24 48" className={`absolute pointer-events-none ${className}`} style={{ width: 16, height: 32 }}>
        <path d="M8 6 v28 a4 4 0 0 0 8 0 V10 a6 6 0 0 0 -12 0 v26" fill="none" stroke={color} strokeWidth={2.4} strokeLinecap="round" />
    </svg>
);
