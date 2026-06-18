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

/**
 * 内置默认雷诺曼牌面：雷诺曼本身没有牌面图，用每张牌「传统对应的那张扑克牌」当牌面代替
 * （36 张 Petit Lenormand 牌角自古就印着一张小扑克：1骑士=9♥、2三叶草=6♦…）。
 * 仓库自带整副公版扑克牌图（Byron Knoll 的扑克牌，公有领域），放在 public/lenormand/{number}.png，
 * 按 LENORMAND_36 的 number(1~36) 命名，**开箱即用、不必导入**。
 */
export const defaultLenormandFace = (number: number): string => `/lenormand/${number}.png`;

/**
 * 雷诺曼牌面的 CSS 兜底：当 public/lenormand 的扑克牌 PNG 加载失败（没部署/离线）时，
 * 用纯 CSS 画出同一张扑克牌（牌角索引 + 居中大点数/花色），保证总有牌面可看、不依赖外部图。
 * 牌号·牌名由 CardFace 显示在牌面下方。
 */
const LENORMAND_PIP: Record<number, string> = {
    1: '9♥', 2: '6♦', 3: '10♠', 4: 'K♥', 5: '7♥', 6: 'K♣', 7: 'Q♣', 8: '9♦', 9: 'Q♠',
    10: 'J♦', 11: 'J♣', 12: '7♦', 13: 'J♠', 14: '9♣', 15: '10♣', 16: '6♥', 17: 'Q♥', 18: '10♥',
    19: '6♠', 20: '8♠', 21: '8♣', 22: 'Q♦', 23: '7♣', 24: 'J♥', 25: 'A♣', 26: '10♦', 27: '7♠',
    28: 'A♥', 29: 'A♠', 30: 'K♠', 31: 'A♦', 32: '8♥', 33: '8♦', 34: 'K♦', 35: '9♠', 36: '6♣',
};

/** 雷诺曼内置默认牌面：渲染该牌对应的那张扑克牌（牌角索引 + 居中大点数/花色），尺寸随宽度自适应。 */
export const LenormandDefaultFace: React.FC<{ number: number; name: string; widthPx: number }> = ({ number, widthPx }) => {
    const pip = LENORMAND_PIP[number] || '';
    const suit = pip.slice(-1);
    const rank = pip.slice(0, -1);
    const red = suit === '♥' || suit === '♦';
    const color = red ? '#c2362c' : '#1d1b18';
    const pad = Math.round(widthPx * 0.06);
    const idxRank = Math.round(widthPx * (rank.length > 1 ? 0.135 : 0.155));
    const idxSuit = Math.round(widthPx * 0.12);
    const bigRank = Math.round(widthPx * (rank.length > 1 ? 0.36 : 0.46));
    const bigSuit = Math.round(widthPx * 0.34);
    // 牌角索引（点数在上、花色在下），右下角整体旋转 180° —— 标准扑克牌排版
    const corner = (
        <div className="flex flex-col items-center" style={{ color, lineHeight: 0.92 }}>
            <span style={{ fontWeight: 800, fontSize: idxRank }}>{rank}</span>
            <span style={{ fontSize: idxSuit }}>{suit}</span>
        </div>
    );
    return (
        <div className="w-full h-full relative overflow-hidden" style={{
            background: 'linear-gradient(160deg,#fbf8f1,#efe9da)',
            boxShadow: 'inset 0 0 0 1px rgba(29,27,24,0.18)',
        }}>
            <div className="absolute" style={{ top: pad, left: pad }}>{corner}</div>
            <div className="absolute" style={{ bottom: pad, right: pad, transform: 'rotate(180deg)' }}>{corner}</div>
            {/* 居中大点数 + 花色，一眼读出是哪张牌 */}
            <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ color }}>
                <span style={{ fontWeight: 800, fontSize: bigRank, lineHeight: 0.9, letterSpacing: '-0.02em' }}>{rank}</span>
                <span style={{ fontSize: bigSuit, lineHeight: 0.9, marginTop: Math.round(widthPx * 0.01) }}>{suit}</span>
            </div>
        </div>
    );
};

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

/** 翻牌背面视觉：优先牌背图（彩色显示），取不到回退 CSS 牌背。 */
const FlipBack: React.FC<{ src?: string; wrap: string }> = ({ src, wrap }) => {
    const [broken, setBroken] = useState(false);
    const showImg = !!src && !broken;
    return (
        <div className={`w-full h-full overflow-hidden ${wrap}`}>
            {showImg ? (
                <img src={src} onError={() => setBroken(true)} className="w-full h-full object-cover" style={{ filter: 'contrast(1.03)' }} alt="" draggable={false} />
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
    /** 无 img / img 加载失败时的兜底牌面（如雷诺曼内置扑克牌牌面）；不传则回退到 🔮 + 牌名占位。 */
    fallback?: React.ReactNode;
    /** 牌面长宽比（CSS aspect-ratio），默认 '7 / 12'（塔罗较瘦长）。雷诺曼=扑克牌图，传扑克牌比例避免裁切。 */
    aspect?: string;
    /** 正面底色：牌图带透明圆角（如扑克牌 PNG）时给个底色让圆角处自然过渡；不传则用默认深色渐变。 */
    faceBg?: string;
}> = ({ img, back, label, sub, reversed, position, skin, widthPx = 132, revealDelay, seq = 0, fallback, aspect = '7 / 12', faceBg }) => {
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
                        aspectRatio: aspect,
                        transformStyle: 'preserve-3d',
                        transition: 'transform 0.78s cubic-bezier(0.22,1,0.36,1)',
                        transform: revealed ? 'rotateY(0deg)' : 'rotateY(180deg)',
                    }}>
                        {/* 正面（牌面） */}
                        <div className={`absolute inset-0 overflow-hidden ${faceBg ? '' : 'bg-gradient-to-br from-indigo-950/70 to-violet-950/50'} ${frame} ${wrap}`}
                            style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden', background: faceBg || undefined }}>
                            {showFace ? (
                                <img
                                    src={img}
                                    alt={label}
                                    onError={() => setBrokenFace(true)}
                                    className="w-full h-full object-cover"
                                    style={reversed ? { transform: 'rotate(180deg)' } : undefined}
                                    draggable={false}
                                />
                            ) : fallback ? (
                                fallback
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
                        img={images[d.card.number] || defaultLenormandFace(d.card.number)}
                        back={cardBack}
                        label={`${d.card.number}·${d.card.name}`}
                        sub={d.card.meaning}
                        position={d.position}
                        skin={skin}
                        widthPx={w}
                        revealDelay={240 + i * 360}
                        seq={i}
                        aspect="222 / 323"
                        faceBg="#f4eee1"
                        fallback={<LenormandDefaultFace number={d.card.number} name={d.card.name} widthPx={w} />}
                    />
                </div>
            ))}
        </div>
    );
};
