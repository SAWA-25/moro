import React from 'react';
import type { DrawnTarot, DrawnLenormand } from '../../../utils/divination/engines';
import type { OSTheme } from '../../../types';

/**
 * 占卜牌面渲染 —— 塔罗 / 雷诺曼共用。读 theme.tarotSkin 做牌面美化（边框 / 渲染风格）。
 * 牌图由用户在占卜 app 里导入（DivinationCard.dataUrl），按 index 传进来。
 */

type Skin = NonNullable<OSTheme['tarotSkin']>;

const FRAME_CLASS: Record<NonNullable<Skin['frame']>, string> = {
    none: 'border border-white/15',
    gold: 'border-2 border-amber-300/70 shadow-[0_0_12px_rgba(251,191,36,0.25)]',
    ink: 'border-2 border-[#2b2933] shadow-[3px_3px_0_rgba(43,41,51,0.5)]',
    film: 'border-2 border-white/80 shadow-lg',
};

const STYLE_WRAP: Record<NonNullable<Skin['renderStyle']>, string> = {
    classic: 'rounded-lg',
    minimal: 'rounded-md',
    mystic: 'rounded-xl ring-1 ring-violet-300/30',
};

export const CardFace: React.FC<{
    /** 牌图 dataURL（未导入则为空 → 占位） */
    img?: string;
    label: string;
    sub?: string;
    reversed?: boolean;
    position?: string;
    skin?: Skin;
    size?: 'sm' | 'md';
}> = ({ img, label, sub, reversed, position, skin, size = 'md' }) => {
    const frame = FRAME_CLASS[skin?.frame || 'none'];
    const wrap = STYLE_WRAP[skin?.renderStyle || 'classic'];
    const w = size === 'sm' ? 'w-20' : 'w-28';
    return (
        <div className="flex flex-col items-center gap-1.5 shrink-0">
            {position && <div className="text-[9px] tracking-wide text-amber-200/70 font-mono">{position}</div>}
            <div className={`${w} aspect-[2/3] overflow-hidden bg-gradient-to-br from-indigo-900/60 to-violet-900/40 relative ${frame} ${wrap}`}>
                {img ? (
                    <img
                        src={img}
                        alt={label}
                        className="w-full h-full object-cover transition-transform"
                        style={reversed ? { transform: 'rotate(180deg)' } : undefined}
                        draggable={false}
                    />
                ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-center px-1">
                        <span className="text-2xl">🔮</span>
                        <span className="text-[9px] text-white/55 mt-1 leading-tight">{label}</span>
                    </div>
                )}
                {reversed && (
                    <div className="absolute top-1 right-1 bg-rose-500/80 text-white text-[7px] px-1 py-0.5 rounded-full font-bold">逆</div>
                )}
            </div>
            <div className="text-center max-w-[7rem]">
                <div className="text-[11px] font-bold text-white/90 leading-tight">{label}</div>
                {sub && <div className="text-[9px] text-white/45 leading-tight mt-0.5 line-clamp-2">{sub}</div>}
            </div>
        </div>
    );
};

/** 一整排塔罗抽牌结果。 */
export const TarotSpreadView: React.FC<{
    draws: DrawnTarot[];
    images: Record<number, string>;  // index → dataUrl
    skin?: Skin;
}> = ({ draws, images, skin }) => (
    <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2">
        {draws.map((d, i) => (
            <CardFace
                key={i}
                img={images[d.card.index]}
                label={`${d.card.name}${d.reversed ? '·逆' : ''}`}
                sub={d.reversed ? d.card.reversed : d.card.upright}
                reversed={d.reversed}
                position={d.position}
                skin={skin}
            />
        ))}
    </div>
);

/** 一整排雷诺曼抽牌结果。 */
export const LenormandSpreadView: React.FC<{
    draws: DrawnLenormand[];
    images: Record<number, string>;  // number → dataUrl
    skin?: Skin;
}> = ({ draws, images, skin }) => (
    <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2">
        {draws.map((d, i) => (
            <CardFace
                key={i}
                img={images[d.card.number]}
                label={`${d.card.number}·${d.card.name}`}
                sub={d.card.meaning}
                position={d.position}
                skin={skin}
            />
        ))}
    </div>
);
