import React, { useMemo } from 'react';
import { ShopReview } from '../../types';
import { paperTexture, WashiTape, HAND_FONT } from '../../apps/almanac/handbookKit';

/**
 * 存钱罐 · 营业结算 & 口碑评价
 * ------------------------------------------------------------
 * BusinessResultModal —— 每轮「营业」后的逐单结算（卖了什么、小费、总收入、新评价）
 * ReviewsOverlay      —— 口碑墙：平均星级 + 全部顾客评价
 * 纯展示组件；模拟逻辑在 BankApp.handleOperate 里。
 */

export interface BusinessSaleItem { name: string; icon: string; qty: number; subtotal: number; }
export interface BusinessResult {
    total: number;
    base: number;
    tips: number;
    customerCount: number;
    items: BusinessSaleItem[];
    reviews: ShopReview[];   // 本轮新增评价
    repBonusPct: number;     // 口碑加成（百分比，仅展示）
    lostSales?: number;      // 因缺货空手而归的客人数（提示去进货）
}

const isUrl = (v?: string) => !!v && (v.startsWith('http') || v.startsWith('data:'));

const Stars: React.FC<{ n: number; size?: number }> = ({ n, size = 12 }) => (
    <span className="inline-flex" style={{ fontSize: size, lineHeight: 1 }}>
        {[1, 2, 3, 4, 5].map(i => (
            <span key={i} style={{ color: i <= Math.round(n) ? '#F5A623' : '#E0D6C2' }}>★</span>
        ))}
    </span>
);

const Avatar: React.FC<{ value: string; size?: number }> = ({ value, size = 30 }) => (
    isUrl(value)
        ? <img src={value} className="rounded-full object-cover shrink-0" style={{ width: size, height: size }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        : <span className="rounded-full flex items-center justify-center shrink-0" style={{ width: size, height: size, background: '#F0E2CC', fontSize: size * 0.5 }}>{value || '🙂'}</span>
);

/** 营业结算弹窗 */
export const BusinessResultModal: React.FC<{
    result: BusinessResult;
    currency: string;
    onClose: () => void;
    onViewReviews: () => void;
}> = ({ result, currency, onClose, onViewReviews }) => (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-5 animate-fade-in">
        <div className="absolute inset-0 bg-black/50" onClick={onClose} />
        <div className="relative w-full max-w-sm rounded-3xl overflow-hidden animate-slide-up" style={{ background: '#FFFDF7', boxShadow: '0 20px 50px rgba(96,66,40,0.4)', transform: 'rotate(-0.6deg)' }}>
            <WashiTape className="top-1 left-12 z-10" color="rgba(255,255,255,0.55)" rotate={-10} width={70} height={16} />
            {/* 头 */}
            <div className="px-5 pt-5 pb-4 text-white" style={{ background: 'linear-gradient(135deg,#66BB6A,#43A047)' }}>
                <div className="text-[11px] font-bold tracking-[0.2em] opacity-80 uppercase">Business Closed</div>
                <div className="flex items-end justify-between mt-1">
                    <span className="text-[20px] font-black" style={{ fontFamily: HAND_FONT }}>今日营业结算</span>
                    <div className="text-right">
                        <div className="text-[30px] font-black leading-none">{currency}{result.total}</div>
                        <div className="text-[10px] opacity-80 mt-0.5">已进钱包</div>
                    </div>
                </div>
                <div className="text-[11px] opacity-85 mt-2">接待了 {result.customerCount} 位客人 · 含小费 {currency}{result.tips}{result.repBonusPct > 0 ? ` · 口碑加成 +${result.repBonusPct}%` : ''}</div>
            </div>
            {/* 缺货流失提示 */}
            {!!result.lostSales && result.lostSales > 0 && (
                <div className="px-5 py-2.5 flex items-center gap-2 text-[12px] font-bold" style={{ background: '#FFF3E0', color: '#E67E22' }}>
                    <span>⚠️</span>
                    <span>{result.lostSales} 位客人没买到就走了 —— 货不够卖，记得去「经营」进货</span>
                </div>
            )}
            {/* 逐单 */}
            <div className="px-5 py-4 max-h-[44vh] overflow-y-auto no-scrollbar" style={{ color: '#5D4037' }}>
                <div className="text-[11px] font-bold text-[#A1887F] uppercase tracking-wider mb-2">卖出的商品</div>
                <div className="space-y-2">
                    {result.items.length === 0 && <div className="text-[12px] text-[#A1887F]">今天没人点单……要不先去「经营」解锁点新品？</div>}
                    {result.items.map((it, i) => (
                        <div key={i} className="flex items-center gap-2.5">
                            {isUrl(it.icon) ? <img src={it.icon} className="w-6 h-6" onError={(e) => { e.currentTarget.style.display = 'none'; }} /> : <span className="text-lg">{it.icon}</span>}
                            <span className="flex-1 text-[13px] font-bold">{it.name}</span>
                            <span className="text-[12px] text-[#A1887F]">×{it.qty}</span>
                            <span className="text-[13px] font-black" style={{ color: '#43A047' }}>{currency}{it.subtotal}</span>
                        </div>
                    ))}
                </div>

                {result.reviews.length > 0 && (
                    <div className="mt-4">
                        <div className="text-[11px] font-bold text-[#A1887F] uppercase tracking-wider mb-2">客人说</div>
                        <div className="space-y-2">
                            {result.reviews.slice(0, 3).map(r => (
                                <div key={r.id} className="flex items-start gap-2 p-2 rounded-xl" style={{ background: '#F7F0E1' }}>
                                    <Avatar value={r.avatar} size={26} />
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="text-[12px] font-bold">{r.authorName}</span>
                                            <Stars n={r.rating} />
                                        </div>
                                        <div className="text-[12px] text-[#6D5142] leading-snug">{r.text}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
            {/* 底 */}
            <div className="px-5 pb-5 pt-1 flex gap-2.5">
                <button onClick={onViewReviews} className="flex-1 py-3 rounded-2xl text-[13px] font-bold active:scale-95 transition-all" style={{ background: '#F3E9D6', color: '#8D6E63' }}>看看口碑墙</button>
                <button onClick={onClose} className="flex-1 py-3 rounded-2xl text-[13px] font-bold text-white active:scale-95 transition-all" style={{ background: 'linear-gradient(135deg,#FF8A65,#FF7043)' }}>收钱打烊</button>
            </div>
        </div>
    </div>
);

/** 口碑墙：平均星级 + 全部评价 */
export const ReviewsOverlay: React.FC<{
    reviews: ShopReview[];
    onClose: () => void;
}> = ({ reviews, onClose }) => {
    const { avg, dist } = useMemo(() => {
        if (reviews.length === 0) return { avg: 0, dist: [0, 0, 0, 0, 0] };
        const d = [0, 0, 0, 0, 0];
        let sum = 0;
        for (const r of reviews) { sum += r.rating; d[Math.max(1, Math.min(5, r.rating)) - 1]++; }
        return { avg: Math.round((sum / reviews.length) * 10) / 10, dist: d };
    }, [reviews]);

    return (
        <div className="absolute inset-0 z-[110] flex flex-col animate-slide-up" style={paperTexture('kraft')}>
            <div aria-hidden className="pointer-events-none absolute inset-0" style={{ boxShadow: 'inset 0 0 90px rgba(96,66,40,0.13)' }} />
            {/* 头 */}
            <div className="relative pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-3 px-4 shrink-0 z-10">
                <WashiTape className="top-0 left-16" color="rgba(231,196,120,0.7)" rotate={-10} width={70} height={16} />
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 flex items-center justify-center text-xl" style={{ background: '#fffdf7', borderRadius: 12, boxShadow: '0 2px 6px rgba(96,66,40,0.18)', transform: 'rotate(-3deg)' }}>⭐</div>
                        <div style={{ fontFamily: HAND_FONT }}>
                            <div className="font-black text-[18px]" style={{ color: '#5b4636' }}>口碑墙</div>
                            <div className="text-[10px]" style={{ color: '#a98e6f' }}>顾客们的真实心声</div>
                        </div>
                    </div>
                    <button onClick={onClose} className="w-9 h-9 flex items-center justify-center active:scale-95" style={{ background: '#fffdf7', borderRadius: 10, boxShadow: '0 2px 6px rgba(96,66,40,0.18)', color: '#7a5c44' }}>
                        <span className="text-lg leading-none">×</span>
                    </button>
                </div>
            </div>

            <div className="relative z-10 flex-1 overflow-y-auto no-scrollbar p-4" style={{ color: '#5D4037' }}>
                {/* 评分概览 */}
                <div className="relative rounded-2xl p-4 mb-4 flex items-center gap-5" style={{ background: '#FFFDF7', boxShadow: '0 4px 14px rgba(96,66,40,0.16)', transform: 'rotate(-0.5deg)' }}>
                    <WashiTape className="-top-2 right-10" color="rgba(245,166,35,0.5)" rotate={10} width={64} />
                    <div className="text-center shrink-0">
                        <div className="text-[36px] font-black leading-none" style={{ color: '#F5A623', fontFamily: HAND_FONT }}>{avg || '—'}</div>
                        <Stars n={avg} size={14} />
                        <div className="text-[10px] text-[#A1887F] mt-1">{reviews.length} 条评价</div>
                    </div>
                    <div className="flex-1 space-y-1">
                        {[5, 4, 3, 2, 1].map(star => {
                            const c = dist[star - 1];
                            const pct = reviews.length ? (c / reviews.length) * 100 : 0;
                            return (
                                <div key={star} className="flex items-center gap-2">
                                    <span className="text-[10px] text-[#A1887F] w-5">{star}★</span>
                                    <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: '#EFE6D4' }}>
                                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: '#F5A623' }} />
                                    </div>
                                    <span className="text-[10px] text-[#A1887F] w-5 text-right">{c}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {reviews.length === 0 ? (
                    <div className="text-center py-12 text-[13px] text-[#A1887F]">还没有评价。点顶栏「💰营业」开门做生意，客人就会留下评价啦</div>
                ) : (
                    <div className="space-y-2.5">
                        {reviews.map(r => (
                            <div key={r.id} className="rounded-2xl p-3.5 border border-[#EADFC8]" style={{ background: '#FFFDF7' }}>
                                <div className="flex items-center gap-2.5">
                                    <Avatar value={r.avatar} size={32} />
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="text-[13px] font-bold truncate">{r.authorName}</span>
                                            {r.isNpc && <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: '#F0E2CC', color: '#A1887F' }}>客人</span>}
                                        </div>
                                        <Stars n={r.rating} />
                                    </div>
                                    {r.productName && <span className="text-[10px] px-2 py-0.5 rounded-full shrink-0" style={{ background: '#F3ECDD', color: '#8D6E63' }}>{r.productName}</span>}
                                </div>
                                <div className="text-[13px] text-[#6D5142] mt-2 leading-snug">{r.text}</div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};
