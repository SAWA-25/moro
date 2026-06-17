import React, { useMemo, useState, useRef } from 'react';
import { ArrowClockwise, Sparkle, ArrowUUpLeft, Hand, X } from '@phosphor-icons/react';

/**
 * 占卜·洗牌 + 抽牌交互（塔罗 / 雷诺曼共用）。
 * ────────────────────────────────────────────────────────────────────────────
 * 两段式，呼应实体占卜的仪式感（参照占卜 App 的「洗牌花 + 抽牌牌轮」）：
 *   ① 洗牌（shuffle）：一朵向心散开的「牌花」（向日葵式螺旋铺开），点牌堆 / 点「洗牌」即重洗，
 *                     整朵花旋转重排（可反复），洗到有感觉再下一步；
 *   ② 抽牌（draw）  ：一个巨大的「牌轮」——背面牌沿大圆弧排成扇环，左右拖动可转动牌轮，
 *                     凭直觉点一张抽出；按牌阵位置逐张抽（第 1 张代表「现状」…），抽中的牌落进上方位置格子。
 * 皮肤＝折子戏黑白拼贴：深「相版」底 + 米白牌背 + 去色，牌背图取不到时回退 CSS 黑白牌背。
 * 两个舞台的牌堆都裹在 overflow:hidden 的固定尺寸容器里——牌再多 / 再大也只在框内，绝不溢出界面。
 *
 * 纯交互壳：洗牌的真随机由父级负责（onReshuffle 重洗那副牌），本组件只回传「按位置选中的索引序列」，
 * 父级再用 tarotFromPicks / lenormandFromPicks 落到牌阵。
 */

interface CardPickerProps {
    /** 模式名（塔罗 / 雷诺曼），仅用于文案。 */
    modeLabel: string;
    /** 牌阵每个位置的含义（长度 = 需要抽的张数）。 */
    positions: string[];
    /** 这副牌的张数（塔罗 78 / 雷诺曼 36）。 */
    deckCount: number;
    /** 牌背图（dataURL / 路径）；取不到回退 CSS 黑白牌背。 */
    cardBack?: string;
    /** 重洗：父级换一副新洗好的牌（索引→牌 的映射随之改变）。 */
    onReshuffle: () => void;
    /** 抽满后翻开：回传「按牌阵位置顺序」选中的牌索引。 */
    onReveal: (picks: number[]) => void;
    /** 退出挑选。 */
    onCancel: () => void;
}

const DEG = Math.PI / 180;

/** 稳定伪随机（按 i + seed）：洗牌堆每次重洗换 seed 即重新散开（自带过渡动画）。 */
function hash(i: number, seed: number): number {
    const x = Math.sin((i + 1) * 12.9898 + seed * 78.233) * 43758.5453;
    return x - Math.floor(x);
}

/** 牌背视觉（纯展示，无 button）：优先牌背图去色，失败回退黑白拼贴牌背。glow=牌轮正中聚焦那张。 */
const CardBack: React.FC<{
    src?: string;
    className?: string;
    style?: React.CSSProperties;
    dim?: boolean;
    glow?: boolean;
    badge?: number;
}> = ({ src, className = '', style, dim, glow, badge }) => {
    const [broken, setBroken] = useState(false);
    const showImg = !!src && !broken;
    return (
        <div
            className={`relative aspect-[2/3] rounded-md overflow-hidden ${className}`}
            style={{
                outline: glow ? '1.5px solid rgba(246,243,236,0.92)' : '1px solid rgba(246,243,236,0.22)',
                outlineOffset: -1,
                boxShadow: glow
                    ? '0 0 20px rgba(243,236,223,0.55), 0 7px 16px -7px rgba(0,0,0,0.7)'
                    : '0 4px 9px -6px rgba(0,0,0,0.6)',
                opacity: dim ? 0.3 : 1,
                ...style,
            }}
        >
            {showImg ? (
                <img src={src} onError={() => setBroken(true)} className="w-full h-full object-cover" style={{ filter: 'grayscale(1) contrast(1.05)' }} alt="" draggable={false} />
            ) : (
                <div className="w-full h-full flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#2a2620,#141210)' }}>
                    <div className="flex items-center justify-center" style={{ width: '58%', height: '74%', borderRadius: 3, border: '1px solid rgba(246,243,236,0.4)', outline: '1px solid rgba(246,243,236,0.16)', outlineOffset: 2 }}>
                        <span style={{ color: 'rgba(246,243,236,0.85)', fontSize: 13 }}>✦</span>
                    </div>
                </div>
            )}
            {badge != null && (
                <span className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-black" style={{ background: '#f3ecdf', color: '#1f1d1a' }}>{badge}</span>
            )}
        </div>
    );
};

// 深「相版」面板，沿用 DivinationApp 里抽牌区的黑底拼贴样式。
const PANEL: React.CSSProperties = {
    background: 'linear-gradient(180deg,#26231f,#1c1a17)',
    border: '1px solid rgba(31,29,26,0.8)', outline: '1px dashed rgba(246,243,236,0.22)', outlineOffset: -6,
    boxShadow: '0 18px 34px -20px rgba(31,29,26,0.7)',
};

// ── 洗牌花（向日葵螺旋铺开，裹在固定方框里，绝不溢出）─────────────────────────
const BLOOM_N = 24;          // 牌花铺多少张（纯视觉）
const BLOOM_SIZE = 244;      // 方框边长（overflow hidden）
const BLOOM_MAX_R = 72;      // 离心最大半径
const BLOOM_CARD_W = 54;     // 牌花里每张牌宽
const GOLDEN = 137.508;      // 黄金角，铺出自然的螺旋花

// ── 牌轮（大圆弧扇环，只露顶部一段，左右拖动转动）──────────────────────────────
// 调参：R/STEP 让顶弧横跨约 12 张相互叠压的牌（贴近参照图密环）；塔罗 78 张 ≈ 358.8°≈ 整圈闭环。
const WHEEL_H = 210;         // 牌轮视窗高（overflow hidden）
const WHEEL_R = 360;         // 大圆半径（越大弧越平缓、越像巨轮）
const WHEEL_STEP = 4.6;      // 相邻两张牌的夹角（度）—— 叠压成密环
const WHEEL_VIS = 62;        // 可见半弧（±度），其余转出视窗外被裁掉
const WHEEL_TOP_PAD = 14;    // 圆弧顶到视窗顶的留白
const WHEEL_CARD_W = 40;     // 牌轮上每张牌宽（聚焦那张会放大）
const PX_PER_CARD = WHEEL_R * WHEEL_STEP * DEG;   // 拖动多少 px 转过一张牌

interface DragState { active: boolean; startX: number; startOffset: number; moved: boolean; idx: number | null; }

const CardPicker: React.FC<CardPickerProps> = ({ modeLabel, positions, deckCount, cardBack, onReshuffle, onReveal, onCancel }) => {
    const need = positions.length;
    const [stage, setStage] = useState<'shuffle' | 'draw'>('shuffle');
    const [picks, setPicks] = useState<number[]>([]);
    const [shuffleCount, setShuffleCount] = useState(0);

    // 洗牌花
    const [pileSeed, setPileSeed] = useState(1);
    const [spin, setSpin] = useState(0);
    const [pulse, setPulse] = useState(false);

    // 牌轮：offset 为「转到正中的牌索引」（浮点，拖动连续变化）
    const [offset, setOffset] = useState(0);
    const [dragging, setDragging] = useState(false);
    const dragRef = useRef<DragState>({ active: false, startX: 0, startOffset: 0, moved: false, idx: null });

    // 牌花每张牌的散落位姿（随 pileSeed 变 → 重洗时整朵重新铺开）
    const bloom = useMemo(() => Array.from({ length: BLOOM_N }).map((_, i) => {
        const j1 = hash(i, pileSeed), j2 = hash(i, pileSeed + 13);
        const a = i * GOLDEN + (j1 - 0.5) * 24;
        const r = BLOOM_MAX_R * Math.sqrt((i + 0.55) / BLOOM_N) * (0.82 + j2 * 0.3);
        return {
            x: Math.cos(a * DEG) * r,
            y: Math.sin(a * DEG) * r,
            rot: a + 90 + (j1 - 0.5) * 22,    // 让牌朝外（径向）
            z: i,
        };
    }), [pileSeed]);

    const doShuffle = () => {
        onReshuffle();
        setPicks([]);
        setPileSeed(s => s + 1);
        setShuffleCount(c => c + 1);
        setSpin(s => s + 132 + Math.round(hash(shuffleCount + 1, pileSeed) * 90));
        setPulse(true);
        window.setTimeout(() => setPulse(false), 440);
    };

    const reshuffleFromDraw = () => { setStage('shuffle'); setOffset(0); doShuffle(); };

    const pickIndex = (i: number) => {
        if (picks.includes(i) || picks.length >= need) return;
        setPicks(prev => [...prev, i]);
    };
    const undo = () => setPicks(prev => prev.slice(0, -1));

    const full = picks.length === need;
    const currentPos = full ? null : positions[picks.length];

    // 牌轮可见窗内的牌（环形 wrap，只渲染顶部 ±WHEEL_VIS 一段）
    const wheelCards = useMemo(() => {
        const out: { i: number; theta: number }[] = [];
        for (let i = 0; i < deckCount; i++) {
            let rel = ((i - offset) % deckCount + deckCount) % deckCount;
            if (rel > deckCount / 2) rel -= deckCount;
            const theta = rel * WHEEL_STEP;
            if (Math.abs(theta) <= WHEEL_VIS) out.push({ i, theta });
        }
        return out;
    }, [offset, deckCount]);
    const activeI = ((Math.round(offset) % deckCount) + deckCount) % deckCount;

    // 牌轮拖动：左右滑 = 转动牌轮；几乎没移动 = 当作点选按下时那张牌（点选索引在 pointerdown 时就抓好，
    // 不依赖 click 合成，pointer capture 也不影响）。
    const onWheelDown = (e: React.PointerEvent) => {
        const el = (e.target as HTMLElement).closest('[data-cidx]') as HTMLElement | null;
        dragRef.current = { active: true, startX: e.clientX, startOffset: offset, moved: false, idx: el ? Number(el.dataset.cidx) : null };
        try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* noop */ }
        setDragging(true);
    };
    const onWheelMove = (e: React.PointerEvent) => {
        const d = dragRef.current;
        if (!d.active) return;
        const dx = e.clientX - d.startX;
        if (Math.abs(dx) > 5) d.moved = true;
        setOffset(d.startOffset - dx / PX_PER_CARD);
    };
    const onWheelUp = () => {
        const d = dragRef.current;
        if (!d.active) return;
        d.active = false;
        setDragging(false);
        if (!d.moved && d.idx != null) pickIndex(d.idx);   // 没拖动 → 当作抽这张
        setOffset(o => Math.round(o));                      // 松手吸附到最近一张（带过渡，像牌轮缓缓停稳）
    };

    // 顶部关闭钮（两个舞台共用）
    const CloseBtn = (
        <button onClick={onCancel} title="退出抽牌" className="absolute left-2.5 top-2.5 z-20 w-7 h-7 rounded-full flex items-center justify-center active:scale-90 transition-transform" style={{ background: 'rgba(246,243,236,0.1)', color: 'rgba(246,243,236,0.78)' }}>
            <X size={15} weight="bold" />
        </button>
    );

    // ── 洗牌阶段 ──────────────────────────────────────────────────────────────
    if (stage === 'shuffle') {
        return (
            <div className="relative rounded-[16px] p-4 pt-3 overflow-hidden" style={PANEL}>
                {CloseBtn}
                <div className="text-center mb-1 px-7">
                    <div className="text-[8px] tracking-[0.3em]" style={{ fontFamily: 'var(--font-label)', color: 'rgba(246,243,236,0.45)' }}>SHUFFLE · {modeLabel}</div>
                    <div className="text-[17px] font-black mt-0.5" style={{ color: '#f3ecdf' }}>洗牌</div>
                    <div className="text-[11px] mt-1" style={{ color: 'rgba(246,243,236,0.6)' }}>凝神想着你要问的事，点牌堆洗牌一次，可反复，洗到有感觉为止</div>
                </div>

                {/* 牌花：固定方框 + overflow hidden（牌再多也只在框内）；点击即重洗，整朵旋转重排 */}
                <div
                    onClick={doShuffle}
                    className="relative mx-auto my-3 cursor-pointer select-none overflow-hidden"
                    style={{ width: BLOOM_SIZE, height: BLOOM_SIZE, maxWidth: '100%' }}
                    title="点击洗牌"
                >
                    {/* 牌花底下的柔光晕，呼应占卜仪式感 */}
                    <div aria-hidden className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ width: BLOOM_SIZE * 0.92, height: BLOOM_SIZE * 0.92, background: 'radial-gradient(circle, rgba(246,243,236,0.1), transparent 68%)' }} />
                    <div
                        className="absolute inset-0"
                        style={{ transform: `rotate(${spin}deg) scale(${pulse ? 0.93 : 1})`, transition: 'transform 0.62s cubic-bezier(0.22,1,0.36,1)' }}
                    >
                        {bloom.map((p, i) => (
                            <div
                                key={i}
                                className="absolute left-1/2 top-1/2"
                                style={{
                                    transform: `translate(calc(-50% + ${p.x}px), calc(-50% + ${p.y}px)) rotate(${p.rot}deg)`,
                                    transition: 'transform 0.58s cubic-bezier(0.22,1,0.36,1)',
                                    zIndex: p.z,
                                }}
                            >
                                <CardBack src={cardBack} style={{ width: BLOOM_CARD_W, pointerEvents: 'none' }} />
                            </div>
                        ))}
                    </div>
                </div>

                <div className="text-center text-[10px] mb-3" style={{ fontFamily: 'var(--font-label)', color: 'rgba(246,243,236,0.5)' }}>
                    {shuffleCount > 0 ? `已洗 ${shuffleCount} 次` : '点一下牌花开始洗牌'}
                </div>

                <div className="flex gap-2">
                    <button onClick={doShuffle} className="px-4 py-2.5 rounded-xl text-[12.5px] font-bold active:scale-95 inline-flex items-center justify-center gap-1.5" style={{ background: 'rgba(246,243,236,0.12)', color: '#f3ecdf' }}>
                        <ArrowClockwise size={15} weight="bold" /> 洗牌
                    </button>
                    <button onClick={() => { if (shuffleCount === 0) doShuffle(); setStage('draw'); }} className="flex-1 py-2.5 rounded-xl text-[12.5px] font-bold active:scale-95 inline-flex items-center justify-center gap-1.5" style={{ background: '#f3ecdf', color: '#1f1d1a' }}>
                        <Hand size={15} weight="fill" /> 下一步 · 抽牌
                    </button>
                </div>
            </div>
        );
    }

    // ── 抽牌阶段 ──────────────────────────────────────────────────────────────
    return (
        <div className="relative rounded-[16px] p-4 pt-3 overflow-hidden" style={PANEL}>
            {CloseBtn}

            {/* 进度分段条（已抽 / 总数），呼应参照图顶部进度 */}
            <div className="flex justify-center gap-1.5 mb-2 px-7 pt-0.5">
                {positions.map((_, j) => (
                    <span key={j} className="h-[3px] rounded-full transition-colors" style={{ width: need > 6 ? 14 : 22, background: j < picks.length ? '#f3ecdf' : 'rgba(246,243,236,0.2)' }} />
                ))}
            </div>

            <div className="text-center mb-2 px-7">
                {full ? (
                    <>
                        <div className="text-[8px] tracking-[0.3em]" style={{ fontFamily: 'var(--font-label)', color: 'rgba(246,243,236,0.45)' }}>READY · {need} / {need}</div>
                        <div className="text-[18px] font-black mt-0.5" style={{ color: '#f3ecdf' }}>抽满 {need} 张啦</div>
                        <div className="text-[11px] mt-1" style={{ color: 'rgba(246,243,236,0.6)' }}>翻开看看牌面在说什么</div>
                    </>
                ) : (
                    <>
                        <div className="text-[8px] tracking-[0.3em]" style={{ fontFamily: 'var(--font-label)', color: 'rgba(246,243,236,0.45)' }}>第 {picks.length + 1} 张牌 · DRAW</div>
                        <div className="text-[18px] font-black mt-0.5 leading-tight" style={{ color: '#f3ecdf' }}>这张牌代表「{currentPos}」</div>
                        <div className="text-[10.5px] mt-1" style={{ color: 'rgba(246,243,236,0.5)' }}>滑动牌轮转动，凭直觉点一张抽出</div>
                    </>
                )}
            </div>

            {/* 牌阵位置格子：抽中的牌落进对应格（dealIn 落桌动画） */}
            <div className="flex flex-wrap justify-center gap-1.5 mb-2 px-1">
                {positions.map((pos, j) => {
                    const taken = j < picks.length;
                    const active = j === picks.length && !full;
                    const slotW = need > 6 ? 50 : need > 3 ? 56 : 64;
                    return (
                        <div key={j} className="flex flex-col items-center" style={{ width: slotW }}>
                            <div className="w-full aspect-[2/3] rounded-md flex items-center justify-center" style={{
                                background: taken ? 'transparent' : 'rgba(246,243,236,0.045)',
                                border: active ? '1.5px solid #f3ecdf' : '1px dashed rgba(246,243,236,0.26)',
                                boxShadow: active ? '0 0 0 3px rgba(243,236,223,0.14), 0 0 16px rgba(243,236,223,0.18)' : undefined,
                            }}>
                                {taken
                                    ? <CardBack key={picks[j]} src={cardBack} className="w-full animate-deal-in" badge={j + 1} />
                                    : <span className="text-[12px] font-black" style={{ color: active ? '#f3ecdf' : 'rgba(246,243,236,0.3)' }}>{j + 1}</span>}
                            </div>
                            <span className="text-[8.5px] mt-1 leading-tight text-center truncate w-full" style={{ color: active ? '#f3ecdf' : 'rgba(246,243,236,0.5)' }}>{pos}</span>
                        </div>
                    );
                })}
            </div>

            {/* 牌轮：大圆弧扇环，只露顶部一段；左右拖动转动，点一张抽出。整片裹在 overflow hidden 里不外溢 */}
            {!full && (
                <div
                    className="relative -mx-4 mb-1 select-none overflow-hidden"
                    style={{ height: WHEEL_H, touchAction: 'pan-y', cursor: dragging ? 'grabbing' : 'grab' }}
                    onPointerDown={onWheelDown}
                    onPointerMove={onWheelMove}
                    onPointerUp={onWheelUp}
                    onPointerCancel={onWheelUp}
                >
                    {/* 牌轮的圆环描边（只露顶弧），强化「巨轮」观感 */}
                    <div aria-hidden className="absolute rounded-full pointer-events-none" style={{
                        width: WHEEL_R * 2, height: WHEEL_R * 2, left: '50%', top: WHEEL_TOP_PAD,
                        transform: 'translateX(-50%)',
                        border: '1px dashed rgba(246,243,236,0.14)',
                    }} />
                    {wheelCards.map(({ i, theta }) => {
                        const used = picks.includes(i);
                        const isActive = i === activeI && !used;
                        const x = Math.sin(theta * DEG) * WHEEL_R;
                        const y = (WHEEL_R - Math.cos(theta * DEG) * WHEEL_R) + WHEEL_TOP_PAD;
                        return (
                            <div
                                key={i}
                                data-cidx={i}
                                className={used ? 'absolute' : 'absolute active:scale-95 transition-transform'}
                                style={{
                                    left: '50%', top: 0,
                                    transform: `translate(calc(-50% + ${x}px), ${y}px) rotate(${theta}deg)`,
                                    transformOrigin: 'center center',
                                    transition: dragging ? 'none' : 'transform 0.34s cubic-bezier(0.22,1,0.36,1)',
                                    zIndex: 1000 - Math.round(Math.abs(theta) * 4) + (isActive ? 3000 : 0),
                                }}
                            >
                                <CardBack
                                    src={cardBack}
                                    style={{ width: isActive ? WHEEL_CARD_W + 9 : WHEEL_CARD_W, transition: 'width 0.2s ease' }}
                                    dim={used}
                                    glow={isActive}
                                />
                            </div>
                        );
                    })}
                    {/* 顶部正中的「抽这张」指针 */}
                    <div aria-hidden className="absolute left-1/2 -translate-x-1/2 pointer-events-none" style={{ top: 0, color: 'rgba(246,243,236,0.7)' }}>
                        <svg width="16" height="10" viewBox="0 0 16 10" fill="currentColor"><path d="M8 10L0.5 0.5h15z" /></svg>
                    </div>
                </div>
            )}

            {/* 控制区 */}
            <div className="flex gap-2 mt-1">
                <button onClick={reshuffleFromDraw} className="px-3 py-2.5 rounded-xl text-[12px] font-bold active:scale-95 inline-flex items-center justify-center gap-1.5" style={{ background: 'rgba(246,243,236,0.12)', color: '#f3ecdf' }} title="重新洗牌">
                    <ArrowClockwise size={15} weight="bold" /> 重洗
                </button>
                {picks.length > 0 && !full && (
                    <button onClick={undo} className="px-3 py-2.5 rounded-xl text-[12px] font-bold active:scale-95 inline-flex items-center justify-center gap-1.5" style={{ background: 'rgba(246,243,236,0.1)', color: 'rgba(246,243,236,0.8)' }} title="撤销上一张">
                        <ArrowUUpLeft size={15} weight="bold" /> 撤销
                    </button>
                )}
                <button onClick={() => full && onReveal(picks)} disabled={!full} className="flex-1 py-2.5 rounded-xl text-[12.5px] font-bold active:scale-95 disabled:opacity-40 inline-flex items-center justify-center gap-1.5" style={{ background: '#f3ecdf', color: '#1f1d1a' }}>
                    <Sparkle size={15} weight="fill" /> {full ? `翻开这 ${need} 张` : `再抽 ${need - picks.length} 张`}
                </button>
            </div>
        </div>
    );
};

export default CardPicker;
