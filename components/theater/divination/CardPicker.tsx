import React, { useMemo, useState } from 'react';
import { ArrowClockwise, Sparkle, ArrowUUpLeft, Hand } from '@phosphor-icons/react';

/**
 * 占卜·洗牌 + 抽牌交互（塔罗 / 雷诺曼共用）。
 * ────────────────────────────────────────────────────────────────────────────
 * 两段式，呼应实体占卜的仪式感（参考小红书占卜 App 的洗牌堆 + 抽牌牌轮）：
 *   ① 洗牌（shuffle）：一摞散开的背面牌，点牌堆 / 点「洗牌」即重洗（可反复），洗到有感觉再下一步；
 *   ② 抽牌（draw）  ：一排可横向滑动的背面牌，按牌阵位置逐张抽（第 1 张代表「现状」…），
 *                     抽中的牌落进上方的位置格子；抽满即可翻开。
 * 皮肤＝折子戏黑白拼贴：深「相版」底 + 米白牌背 + 去色，牌背图取不到时回退 CSS 黑白牌背。
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

/** 背面朝上的牌：优先牌背图（去色），失败回退黑白拼贴牌背。 */
const FaceDownCard: React.FC<{
    src?: string;
    className?: string;
    style?: React.CSSProperties;
    dim?: boolean;
    badge?: number;
    onClick?: () => void;
    title?: string;
}> = ({ src, className = '', style, dim, badge, onClick, title }) => {
    const [broken, setBroken] = useState(false);
    const showImg = !!src && !broken;
    return (
        <button
            type="button"
            onClick={onClick}
            title={title}
            disabled={!onClick}
            className={`relative aspect-[2/3] rounded-md overflow-hidden ${onClick ? 'active:scale-95 transition-transform' : ''} ${className}`}
            style={{
                outline: '1px solid rgba(246,243,236,0.22)', outlineOffset: -1,
                boxShadow: '0 4px 9px -6px rgba(0,0,0,0.6)',
                opacity: dim ? 0.32 : 1,
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
        </button>
    );
};

// 深「相版」面板，沿用 DivinationApp 里抽牌区的黑底拼贴样式。
const PANEL: React.CSSProperties = {
    background: 'linear-gradient(180deg,#26231f,#1c1a17)',
    border: '1px solid rgba(31,29,26,0.8)', outline: '1px dashed rgba(246,243,236,0.22)', outlineOffset: -6,
    boxShadow: '0 18px 34px -20px rgba(31,29,26,0.7)',
};

/** 稳定的伪随机（按 index + seed），用于洗牌堆的散落位姿——每次重洗换 seed 即重新散开。 */
function rand(i: number, seed: number): number {
    const x = Math.sin((i + 1) * 12.9898 + seed * 78.233) * 43758.5453;
    return x - Math.floor(x);
}

const PILE_N = 16; // 洗牌堆里铺多少张（纯视觉）

const CardPicker: React.FC<CardPickerProps> = ({ modeLabel, positions, deckCount, cardBack, onReshuffle, onReveal, onCancel }) => {
    const need = positions.length;
    const [stage, setStage] = useState<'shuffle' | 'draw'>('shuffle');
    const [picks, setPicks] = useState<number[]>([]);
    const [shuffleCount, setShuffleCount] = useState(0);
    const [pileSeed, setPileSeed] = useState(1);
    const [pulse, setPulse] = useState(false);

    // 洗牌堆每张牌的散落位姿（随 pileSeed 变 → 重洗时整堆重新散开，自带过渡动画）
    const pile = useMemo(() => Array.from({ length: PILE_N }).map((_, i) => ({
        x: (rand(i, pileSeed) - 0.5) * 132,
        y: (rand(i, pileSeed + 9) - 0.5) * 96,
        rot: (rand(i, pileSeed + 4) - 0.5) * 64,
        z: Math.floor(rand(i, pileSeed + 7) * PILE_N),
    })), [pileSeed]);

    const doShuffle = () => {
        onReshuffle();
        setPicks([]);
        setPileSeed(s => s + 1);
        setShuffleCount(c => c + 1);
        setPulse(true);
        window.setTimeout(() => setPulse(false), 360);
    };

    const reshuffleFromDraw = () => { setStage('shuffle'); doShuffle(); };

    const pick = (i: number) => {
        if (picks.includes(i) || picks.length >= need) return;
        setPicks(prev => [...prev, i]);
    };
    const undo = () => setPicks(prev => prev.slice(0, -1));

    const full = picks.length === need;
    const currentPos = full ? null : positions[picks.length];

    // ── 洗牌阶段 ──────────────────────────────────────────────────────────────
    if (stage === 'shuffle') {
        return (
            <div className="relative rounded-[16px] p-4" style={PANEL}>
                <div className="text-center mb-1">
                    <div className="text-[8px] tracking-[0.3em]" style={{ fontFamily: 'var(--font-label)', color: 'rgba(246,243,236,0.45)' }}>SHUFFLE · {modeLabel}</div>
                    <div className="text-[16px] font-black mt-0.5" style={{ color: '#f3ecdf' }}>洗牌</div>
                    <div className="text-[11px] mt-1" style={{ color: 'rgba(246,243,236,0.6)' }}>凝神想着你要问的事，点牌堆洗牌，洗到有感觉为止</div>
                </div>

                {/* 散开的牌堆：点击即重洗，整堆重新散落（带过渡） */}
                <div
                    onClick={doShuffle}
                    className="relative mx-auto my-3 cursor-pointer select-none"
                    style={{ height: 188, width: '100%', maxWidth: 280, transform: pulse ? 'scale(0.965)' : 'scale(1)', transition: 'transform 0.36s cubic-bezier(0.34,1.56,0.64,1)' }}
                    title="点击洗牌"
                >
                    {pile.map((p, i) => (
                        <FaceDownCard
                            key={i}
                            src={cardBack}
                            className="absolute left-1/2 top-1/2"
                            style={{
                                width: 76,
                                marginLeft: -38, marginTop: -57,
                                transform: `translate(${p.x}px, ${p.y}px) rotate(${p.rot}deg)`,
                                transition: 'transform 0.5s cubic-bezier(0.22,1,0.36,1)',
                                zIndex: p.z,
                                pointerEvents: 'none', // 纯装饰：让点击穿透到牌堆容器统一触发洗牌
                            }}
                        />
                    ))}
                </div>

                <div className="text-center text-[10px] mb-3" style={{ fontFamily: 'var(--font-label)', color: 'rgba(246,243,236,0.5)' }}>
                    {shuffleCount > 0 ? `已洗 ${shuffleCount} 次` : '还没洗过'}
                </div>

                <div className="flex gap-2">
                    <button onClick={onCancel} className="px-3 py-2.5 rounded-xl text-[12px] font-bold active:scale-95 inline-flex items-center justify-center" style={{ background: 'rgba(246,243,236,0.1)', color: 'rgba(246,243,236,0.8)' }}>
                        取消
                    </button>
                    <button onClick={doShuffle} className="px-3 py-2.5 rounded-xl text-[12px] font-bold active:scale-95 inline-flex items-center justify-center gap-1.5" style={{ background: 'rgba(246,243,236,0.12)', color: '#f3ecdf' }}>
                        <ArrowClockwise size={15} weight="bold" /> 洗牌
                    </button>
                    <button onClick={() => { if (shuffleCount === 0) doShuffle(); setStage('draw'); }} className="flex-1 py-2.5 rounded-xl text-[12.5px] font-bold active:scale-95 inline-flex items-center justify-center gap-1.5" style={{ background: '#f3ecdf', color: '#1f1d1a' }}>
                        <Hand size={15} weight="fill" /> 开始抽牌
                    </button>
                </div>
            </div>
        );
    }

    // ── 抽牌阶段 ──────────────────────────────────────────────────────────────
    return (
        <div className="relative rounded-[16px] p-4" style={PANEL}>
            <div className="text-center mb-2">
                <div className="text-[8px] tracking-[0.3em]" style={{ fontFamily: 'var(--font-label)', color: 'rgba(246,243,236,0.45)' }}>DRAW · {picks.length} / {need}</div>
                {full ? (
                    <>
                        <div className="text-[15px] font-black mt-0.5" style={{ color: '#f3ecdf' }}>抽满 {need} 张啦</div>
                        <div className="text-[11px] mt-1" style={{ color: 'rgba(246,243,236,0.6)' }}>翻开看看牌面在说什么</div>
                    </>
                ) : (
                    <>
                        <div className="text-[15px] font-black mt-0.5" style={{ color: '#f3ecdf' }}>第 {picks.length + 1} 张牌</div>
                        <div className="text-[12.5px] mt-1" style={{ color: 'rgba(246,243,236,0.82)' }}>这张牌代表「<span className="font-black" style={{ color: '#f3ecdf' }}>{currentPos}</span>」</div>
                        <div className="text-[10px] mt-0.5" style={{ color: 'rgba(246,243,236,0.45)' }}>滑动牌堆，凭直觉点一张抽出</div>
                    </>
                )}
            </div>

            {/* 牌阵位置格子：抽中的牌落进对应格 */}
            <div className="flex flex-wrap justify-center gap-1.5 mb-3">
                {positions.map((pos, j) => {
                    const taken = j < picks.length;
                    const active = j === picks.length;
                    return (
                        <div key={j} className="flex flex-col items-center" style={{ width: need > 6 ? 52 : 58 }}>
                            <div className="w-full aspect-[2/3] rounded-md flex items-center justify-center" style={{
                                background: taken ? 'transparent' : 'rgba(246,243,236,0.04)',
                                border: active ? '1.5px solid #f3ecdf' : '1px dashed rgba(246,243,236,0.28)',
                                boxShadow: active ? '0 0 0 3px rgba(243,236,223,0.14)' : undefined,
                            }}>
                                {taken
                                    ? <FaceDownCard key={picks[j]} src={cardBack} className="w-full animate-pop-in" badge={j + 1} />
                                    : <span className="text-[11px] font-black" style={{ color: active ? '#f3ecdf' : 'rgba(246,243,236,0.3)' }}>{j + 1}</span>}
                            </div>
                            <span className="text-[8.5px] mt-1 leading-tight text-center truncate w-full" style={{ color: active ? '#f3ecdf' : 'rgba(246,243,236,0.5)' }}>{pos}</span>
                        </div>
                    );
                })}
            </div>

            {/* 可横向滑动的牌堆（牌轮）：去色背面牌，叠放成扇，点选抽出 */}
            {!full && (
                <div className="-mx-1 px-1 pt-1 pb-2 overflow-x-auto no-scrollbar" style={{ WebkitOverflowScrolling: 'touch' }}>
                    <div className="flex items-end" style={{ width: 'max-content', paddingLeft: 10, paddingRight: 18 }}>
                        {Array.from({ length: deckCount }).map((_, i) => {
                            const used = picks.includes(i);
                            return (
                                <div key={i} style={{ marginLeft: i === 0 ? 0 : -18, transform: `translateY(${Math.sin(i * 0.55) * 5}px) rotate(${Math.sin(i * 0.55) * 4}deg)`, zIndex: i }}>
                                    <FaceDownCard
                                        src={cardBack}
                                        style={{ width: 50 }}
                                        dim={used}
                                        onClick={used ? undefined : () => pick(i)}
                                        title={used ? '已抽' : '抽这张'}
                                    />
                                </div>
                            );
                        })}
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
