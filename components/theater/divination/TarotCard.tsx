import React, { useEffect, useState } from 'react';
import type { DrawnTarot, DrawnLenormand } from '../../../utils/divination/engines';
import type { OSTheme } from '../../../types';

/**
 * 占卜牌面渲染 —— 塔罗 / 雷诺曼共用。读 theme.tarotSkin 做牌面美化（边框 / 渲染风格）。
 * ─────────────────────────────────────────────────────────────────────────────
 * 抽牌结果以「大牌面 + 3D 翻牌」呈现（仿 Quin 等实体占卜 App）：先背面朝上，逐张
 * 错峰翻面揭示，配柔光光晕 + 一次性高光扫过 + 轻微浮动，质感更足、看得更清。
 * 牌图优先用用户在占卜 app 导入的自定义图（按 index）；没导入则回退到内置的公版
 * 韦特塔罗牌面（public/tarot/{index}.jpg）；再取不到才退回文字占位。
 */

type Skin = NonNullable<OSTheme['tarotSkin']>;

/** 内置默认塔罗牌面（公版 Rider–Waite–Smith，随仓库放在 public/tarot/{index}.jpg）。 */
export const defaultTarotFace = (index: number): string => `/tarot/${index}.jpg`;

const FRAME_CLASS: Record<NonNullable<Skin['frame']>, string> = {
    none: 'ring-1 ring-white/15',
    gold: 'ring-2 ring-amber-300/70 shadow-[0_0_14px_rgba(251,191,36,0.3)]',
    ink: 'ring-2 ring-[#2b2933] shadow-[3px_3px_0_rgba(43,41,51,0.5)]',
    film: 'ring-2 ring-white/80 shadow-lg',
};

const STYLE_WRAP: Record<NonNullable<Skin['renderStyle']>, string> = {
    classic: 'rounded-lg',
    minimal: 'rounded-md',
    mystic: 'rounded-xl ring-1 ring-violet-300/30',
};

/** 翻牌背面视觉：优先牌背图（去色贴合折子戏黑白拼贴），取不到回退 CSS 牌背。 */
const FlipBack: React.FC<{ src?: string; wrap: string }> = ({ src, wrap }) => {
    const [broken, setBroken] = useState(false);
    const showImg = !!src && !broken;
    return (
        <div className={`w-full h-full overflow-hidden ${wrap}`}>
            {showImg ? (
                <img src={src} onError={() => setBroken(true)} className="w-full h-full object-cover" style={{ filter: 'grayscale(1) contrast(1.05)' }} alt="" draggable={false} />
            ) : (
                <div className="w-full h-full flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#2a2620,#141210)' }}>
                    <div className="flex items-center justify-center" style={{ width: '58%', height: '74%', borderRadius: 4, border: '1px solid rgba(246,243,236,0.4)', outline: '1px solid rgba(246,243,236,0.16)', outlineOffset: 3 }}>
                        <span style={{ color: 'rgba(246,243,236,0.85)', fontSize: 18 }}>✦</span>
                    </div>
                </div>
            )}
        </div>
    );
};

export const CardFace: React.FC<{
    /** 牌图 dataURL / 路径（自定义导入 or 内置默认）；未给或加载失败则占位 */
    img?: string;
    /** 翻牌背面用的牌背图 */
    back?: string;
    label: string;
    sub?: string;
    reversed?: boolean;
    position?: string;
    skin?: Skin;
    /** 牌面宽度（px）。由牌阵张数决定，单张大、多张稍小。 */
    widthPx?: number;
    /** 翻牌揭示延迟（ms）；传了才做「先背面→翻面」的动画，不传直接显示正面。 */
    revealDelay?: number;
    /** 第几张（用于浮动错峰，避免整排同相位机械感）。 */
    seq?: number;
}> = ({ img, back, label, sub, reversed, position, skin, widthPx = 132, revealDelay, seq = 0 }) => {
    const frame = FRAME_CLASS[skin?.frame || 'none'];
    const wrap = STYLE_WRAP[skin?.renderStyle || 'classic'];
    const doFlip = revealDelay != null;
    const [revealed, setRevealed] = useState(!doFlip);
    const [brokenFace, setBrokenFace] = useState(false);

    useEffect(() => {
        if (!doFlip) return;
        setRevealed(false);
        const t = window.setTimeout(() => setRevealed(true), revealDelay);
        return () => window.clearTimeout(t);
    }, [doFlip, revealDelay, img]);

    const showFace = !!img && !brokenFace;

    return (
        <div className="flex flex-col items-center gap-2 shrink-0" style={{ width: widthPx }}>
            {position && <div className="text-[10px] tracking-wide text-amber-200/75 font-mono">{position}</div>}

            {/* 透视容器：光晕（浮动同步）+ 翻牌 */}
            <div className="relative" style={{ width: widthPx, perspective: 1000 }}>
                <div className="animate-tarot-bob" style={{ animationDelay: `${(seq % 5) * 0.55}s` }}>
                    {/* 柔光光晕（翻开后渐显、轻微呼吸） */}
                    <div aria-hidden className="absolute -inset-2 pointer-events-none animate-tarot-glow"
                        style={{
                            background: 'radial-gradient(closest-side, rgba(243,225,180,0.42), rgba(243,225,180,0) 76%)',
                            filter: 'blur(5px)', opacity: revealed ? undefined : 0,
                            transition: 'opacity 0.6s ease', borderRadius: 20,
                        }} />
                    {/* 翻牌本体 */}
                    <div className="relative" style={{
                        aspectRatio: '7 / 12',
                        transformStyle: 'preserve-3d',
                        transition: 'transform 0.78s cubic-bezier(0.22,1,0.36,1)',
                        transform: revealed ? 'rotateY(0deg)' : 'rotateY(180deg)',
                    }}>
                        {/* 正面（牌面） */}
                        <div className={`absolute inset-0 overflow-hidden bg-gradient-to-br from-indigo-950/70 to-violet-950/50 ${frame} ${wrap}`}
                            style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}>
                            {showFace ? (
                                <img
                                    src={img}
                                    alt={label}
                                    onError={() => setBrokenFace(true)}
                                    className="w-full h-full object-cover"
                                    style={reversed ? { transform: 'rotate(180deg)' } : undefined}
                                    draggable={false}
                                />
                            ) : (
                                <div className="w-full h-full flex flex-col items-center justify-center text-center px-2">
                                    <span className="text-3xl">🔮</span>
                                    <span className="text-[11px] text-white/60 mt-1.5 leading-tight">{label}</span>
                                </div>
                            )}
                            {/* 揭示瞬间的高光扫过 */}
                            {revealed && (
                                <div aria-hidden className="absolute inset-0 pointer-events-none animate-tarot-shine"
                                    style={{ background: 'linear-gradient(105deg, transparent 38%, rgba(255,255,255,0.5) 50%, transparent 62%)' }} />
                            )}
                            {reversed && (
                                <div className="absolute top-1.5 right-1.5 bg-rose-500/85 text-white text-[8px] px-1.5 py-0.5 rounded-full font-bold tracking-wide">逆位</div>
                            )}
                        </div>
                        {/* 背面（牌背） */}
                        <div className={`absolute inset-0 overflow-hidden ${frame} ${wrap}`}
                            style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}>
                            <FlipBack src={back} wrap={wrap} />
                        </div>
                    </div>
                </div>
            </div>

            <div className="text-center" style={{ width: widthPx }}>
                <div className="text-[12.5px] font-bold text-white/90 leading-tight">{label}</div>
                {sub && <div className="text-[10px] text-white/50 leading-snug mt-1 line-clamp-3">{sub}</div>}
            </div>
        </div>
    );
};

/** 按牌阵张数定牌面尺寸：单张最大、越多越小（横向可滚动）。 */
const widthFor = (n: number): number => (n <= 1 ? 200 : n <= 3 ? 150 : n <= 6 ? 124 : 104);

/** 一整排塔罗抽牌结果（大牌面 + 逐张翻面揭示）。 */
export const TarotSpreadView: React.FC<{
    draws: DrawnTarot[];
    images: Record<number, string>;  // index → dataUrl（用户导入的自定义牌图）
    skin?: Skin;
    /** 翻牌背面用的牌背图。 */
    cardBack?: string;
}> = ({ draws, images, skin, cardBack }) => {
    const w = widthFor(draws.length);
    return (
        <div className={`flex gap-3.5 overflow-x-auto no-scrollbar pb-2 pt-1 px-0.5 snap-x ${draws.length === 1 ? 'justify-center' : 'justify-start'}`}>
            {draws.map((d, i) => (
                <div key={`${d.card.index}-${i}`} className="snap-center">
                    <CardFace
                        img={images[d.card.index] || defaultTarotFace(d.card.index)}
                        back={cardBack}
                        label={`${d.card.name}${d.reversed ? '·逆' : ''}`}
                        sub={d.reversed ? d.card.reversed : d.card.upright}
                        reversed={d.reversed}
                        position={d.position}
                        skin={skin}
                        widthPx={w}
                        revealDelay={240 + i * 360}
                        seq={i}
                    />
                </div>
            ))}
        </div>
    );
};

/** 一整排雷诺曼抽牌结果。 */
export const LenormandSpreadView: React.FC<{
    draws: DrawnLenormand[];
    images: Record<number, string>;  // number → dataUrl
    skin?: Skin;
    cardBack?: string;
}> = ({ draws, images, skin, cardBack }) => {
    const w = widthFor(draws.length);
    return (
        <div className={`flex gap-3.5 overflow-x-auto no-scrollbar pb-2 pt-1 px-0.5 snap-x ${draws.length === 1 ? 'justify-center' : 'justify-start'}`}>
            {draws.map((d, i) => (
                <div key={`${d.card.number}-${i}`} className="snap-center">
                    <CardFace
                        img={images[d.card.number]}
                        back={cardBack}
                        label={`${d.card.number}·${d.card.name}`}
                        sub={d.card.meaning}
                        position={d.position}
                        skin={skin}
                        widthPx={w}
                        revealDelay={240 + i * 360}
                        seq={i}
                    />
                </div>
            ))}
        </div>
    );
};
