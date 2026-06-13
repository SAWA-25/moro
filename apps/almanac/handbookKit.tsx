import React from 'react';

/**
 * 岁时记 ·「拼贴手账」视觉零件库
 * ------------------------------------------------------------
 * 封面（AlmanacApp）、时光契约（ScheduleApp）、特别时光（SpecialMomentsApp）、
 * 实时日历（AlmanacCalendar）四处共用同一套拼贴语言，保证手账质感一致：
 *   牛皮纸底 / 方格纸 → PaperPage、paperTexture
 *   半透明胶带         → WashiTape
 *   美纹纸票签         → TapeLabel
 *   微微翘起的纸片     → PaperNote
 *   邮戳印章           → Postmark
 *   手写字体           → HAND_FONT
 * 这些零件只管"长得像手账"，不含任何业务逻辑。
 */

/** 手写感字体栈：优先西文手写体，回退到系统楷体（中文手账味），最后 cursive。 */
export const HAND_FONT =
    '"Caveat","Patrick Hand","Brush Script MT","STKaiti","Kaiti SC","楷体","KaiTi",cursive';

/** 由任意字符串/数字推出一个 -3°~3° 的固定小角度，让每张纸片"贴得不太正"。 */
export const tinyRotate = (seed: string | number): number => {
    const s = String(seed);
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0xffff;
    return ((h % 70) - 35) / 10; // -3.5 ~ 3.5 deg
};

/** 一页手账纸的底纹。kind 决定是牛皮纸、方格纸还是淡色便利纸。 */
export const paperTexture = (
    kind: 'kraft' | 'grid' | 'sticky' = 'kraft',
): React.CSSProperties => {
    if (kind === 'grid') {
        return {
            backgroundColor: '#f4f7f3',
            backgroundImage:
                'linear-gradient(#cfe3d6 1px, transparent 1px), linear-gradient(90deg, #cfe3d6 1px, transparent 1px)',
            backgroundSize: '22px 22px',
        };
    }
    if (kind === 'sticky') {
        return {
            backgroundColor: '#fdf6e3',
            backgroundImage:
                'radial-gradient(rgba(214,170,110,0.16) 1.1px, transparent 1.1px)',
            backgroundSize: '14px 14px',
        };
    }
    // kraft 牛皮纸：暖棕 + 极淡斜纹纤维
    return {
        backgroundColor: '#efe2cd',
        backgroundImage:
            'repeating-linear-gradient(45deg, rgba(150,110,70,0.05) 0 2px, transparent 2px 9px), radial-gradient(rgba(120,84,52,0.10) 1px, transparent 1px)',
        backgroundSize: 'auto, 16px 16px',
    };
};

/** 整页容器：铺手账纸底纹 + 安全区内边距。 */
export const PaperPage: React.FC<{
    kind?: 'kraft' | 'grid' | 'sticky';
    className?: string;
    style?: React.CSSProperties;
    children: React.ReactNode;
}> = ({ kind = 'kraft', className = '', style, children }) => (
    <div
        className={`h-full w-full relative overflow-hidden ${className}`}
        style={{ ...paperTexture(kind), ...style }}
    >
        {/* 四角压暗，像翻开的旧本子 */}
        <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
                boxShadow: 'inset 0 0 90px rgba(96,66,40,0.13)',
            }}
        />
        {children}
    </div>
);

/** 半透明美纹胶带：贴在纸片边角做装饰。绝对定位，自己用 className 摆位。 */
export const WashiTape: React.FC<{
    className?: string;
    color?: string;
    rotate?: number;
    width?: number;
    height?: number;
}> = ({ className = '', color = 'rgba(236,170,160,0.62)', rotate = -18, width = 60, height = 22 }) => (
    <span
        aria-hidden
        className={`absolute pointer-events-none ${className}`}
        style={{
            width,
            height,
            transform: `rotate(${rotate}deg)`,
            background: `repeating-linear-gradient(135deg, ${color} 0 7px, rgba(255,255,255,0.22) 7px 14px)`,
            boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
            mixBlendMode: 'multiply',
        }}
    />
);

/** 美纹纸票签：手账里写小标题用的那种贴纸条。 */
export const TapeLabel: React.FC<{
    children: React.ReactNode;
    color?: string;
    textColor?: string;
    className?: string;
    rotate?: number;
}> = ({ children, color = '#e8c8a0', textColor = '#5b4636', className = '', rotate = -2 }) => (
    <span
        className={`inline-block px-3 py-0.5 text-[11px] font-bold tracking-wide select-none ${className}`}
        style={{
            background: color,
            color: textColor,
            transform: `rotate(${rotate}deg)`,
            boxShadow: '0 1px 2px rgba(0,0,0,0.12)',
            // 票签两端做成被撕过的不规则边
            clipPath:
                'polygon(2% 12%, 8% 0, 94% 6%, 99% 70%, 95% 100%, 40% 92%, 5% 99%, 1% 40%)',
        }}
    >
        {children}
    </span>
);

/** 一张贴在本子上的纸片：白纸 + 软阴影 + 轻微旋转，可选四角胶带。 */
export const PaperNote: React.FC<{
    children: React.ReactNode;
    className?: string;
    rotate?: number;
    bg?: string;
    tape?: boolean;
    tapeColor?: string;
    onClick?: () => void;
    style?: React.CSSProperties;
}> = ({ children, className = '', rotate = 0, bg = '#fffdf7', tape = false, tapeColor, onClick, style }) => (
    <div
        onClick={onClick}
        className={`relative ${onClick ? 'active:scale-[0.985] transition-transform cursor-pointer' : ''} ${className}`}
        style={{
            background: bg,
            transform: `rotate(${rotate}deg)`,
            boxShadow: '0 6px 16px rgba(96,66,40,0.16), 0 1px 0 rgba(0,0,0,0.04)',
            ...style,
        }}
    >
        {tape && (
            <>
                <WashiTape className="-top-2 -left-2" color={tapeColor} rotate={-24} />
                <WashiTape className="-top-2 -right-2" color={tapeColor} rotate={20} />
            </>
        )}
        {children}
    </div>
);

/** 圆形邮戳/印章：dashed 圈 + 居中小字，盖在角落表示"已成"之类。 */
export const Postmark: React.FC<{
    children: React.ReactNode;
    color?: string;
    size?: number;
    className?: string;
    rotate?: number;
}> = ({ children, color = '#b1543f', size = 56, className = '', rotate = -14 }) => (
    <span
        className={`inline-flex items-center justify-center text-center font-black leading-none select-none ${className}`}
        style={{
            width: size,
            height: size,
            color,
            border: `2px dashed ${color}`,
            borderRadius: '9999px',
            transform: `rotate(${rotate}deg)`,
            fontSize: size * 0.2,
            opacity: 0.82,
            boxShadow: `inset 0 0 0 3px ${color}22`,
        }}
    >
        {children}
    </span>
);

/** 一枚回形针（纯装饰，挂在纸片上沿）。 */
export const PaperClip: React.FC<{ className?: string; color?: string }> = ({
    className = '',
    color = '#9aa6b2',
}) => (
    <svg
        aria-hidden
        viewBox="0 0 24 48"
        className={`absolute pointer-events-none ${className}`}
        style={{ width: 16, height: 32 }}
    >
        <path
            d="M8 6 v28 a4 4 0 0 0 8 0 V10 a6 6 0 0 0 -12 0 v26"
            fill="none"
            stroke={color}
            strokeWidth={2.4}
            strokeLinecap="round"
        />
    </svg>
);
