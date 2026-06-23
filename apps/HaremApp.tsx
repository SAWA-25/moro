import React, { useState, useEffect, useMemo } from 'react';
import { useOS } from '../context/OSContext';
import {
    HaremState, HaremMember, initHaremGame, playCard, endDay, resolveHaremEvent,
    getCard, rankOf, topFavored,
} from '../utils/haremGame';
import { CaretLeft, Crown, MoonStars, ArrowClockwise, Heart, Cardholder, Lightning } from '@phosphor-icons/react';

const STORAGE_KEY = 'moro_harem_game';
const MAX_MEMBERS = 6;

const moodFace = (m: number): string => m >= 75 ? '😊' : m >= 55 ? '😌' : m >= 38 ? '🙂' : m >= 22 ? '😕' : '😞';
const toneColor = (t: string): string => t === 'good' ? '#b06a2e' : t === 'bad' ? '#9a4a4a' : t === 'event' ? '#6a5a8a' : '#7a6a55';

const HaremApp: React.FC = () => {
    const { closeApp, characters, userProfile, addToast } = useOS();
    const [game, setGame] = useState<HaremState | null>(null);
    const [loaded, setLoaded] = useState(false);
    const [picked, setPicked] = useState<Set<string>>(new Set());
    const [selCard, setSelCard] = useState<string | null>(null);

    // 读档
    useEffect(() => {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) setGame(JSON.parse(raw));
        } catch { /* ignore */ }
        setLoaded(true);
    }, []);

    // 存档
    useEffect(() => {
        if (!loaded) return;
        try {
            if (game) localStorage.setItem(STORAGE_KEY, JSON.stringify(game));
            else localStorage.removeItem(STORAGE_KEY);
        } catch { /* ignore */ }
    }, [game, loaded]);

    const startGame = () => {
        const chosen = characters.filter(c => picked.has(c.id)).slice(0, MAX_MEMBERS);
        if (chosen.length === 0) { addToast('至少选一位入宫', 'error'); return; }
        setGame(initHaremGame(chosen.map(c => ({
            charId: c.id, name: c.convoSettings?.remarkName?.trim() || c.name,
            avatar: c.convoSettings?.charAvatarOverride || c.avatar, affection: c.affection,
        }))));
        setSelCard(null);
    };

    const onPlay = (cardId: string, targetId?: string) => {
        if (!game) return;
        const card = getCard(cardId);
        if (!card) return;
        if (game.energy < card.energy) { addToast('行动点不够了，先就寝吧', 'error'); return; }
        if (card.targeted && !targetId) { setSelCard(cardId); return; }
        setGame(playCard(game, cardId, targetId));
        setSelCard(null);
    };

    const onSleep = () => { if (game) setGame(endDay(game)); };
    const onResolve = (i: number) => { if (game) setGame(resolveHaremEvent(game, i)); };
    const newGame = () => { setGame(null); setPicked(new Set()); setSelCard(null); };

    const champion = useMemo(() => game ? topFavored(game) : null, [game]);

    if (!loaded) return <div className="h-full w-full" style={{ background: '#2a1820' }} />;

    // ───────── 开局选妃 ─────────
    if (!game) {
        return (
            <div className="h-full w-full flex flex-col" style={{ background: 'linear-gradient(180deg,#2a1820 0%,#3a2230 100%)', color: '#f3e3d3' }}>
                <Header onBack={closeApp} title="椒房记" />
                <div className="flex-1 overflow-y-auto px-5 py-3" style={{ scrollbarWidth: 'none' }}>
                    <div className="text-center mb-4">
                        <Crown size={40} weight="fill" className="mx-auto mb-2" style={{ color: '#e9c46a' }} />
                        <p className="text-[13px] leading-relaxed opacity-80">择良人入宫，组你的后宫。<br />日日翻牌承欢、晋位分，夜夜应对争宠风波。</p>
                    </div>
                    {characters.length === 0 ? (
                        <div className="text-center opacity-60 text-sm pt-10">通讯录里还没有角色</div>
                    ) : (
                        <>
                            <div className="text-[11px] font-bold tracking-widest opacity-60 mb-2">选 1–{MAX_MEMBERS} 位（已选 {picked.size}）</div>
                            <div className="grid grid-cols-3 gap-2.5">
                                {characters.map(c => {
                                    const on = picked.has(c.id);
                                    const full = !on && picked.size >= MAX_MEMBERS;
                                    return (
                                        <button key={c.id} disabled={full}
                                            onClick={() => setPicked(p => { const n = new Set(p); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; })}
                                            className={`flex flex-col items-center gap-1 p-2 rounded-2xl border transition-all active:scale-95 ${on ? 'border-[#e9c46a] bg-white/10' : full ? 'border-white/10 opacity-30' : 'border-white/15 bg-white/5'}`}>
                                            <div className="relative">
                                                <img src={c.convoSettings?.charAvatarOverride || c.avatar} className="w-14 h-14 rounded-full object-cover" />
                                                {on && <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-[#e9c46a] text-[#2a1820] flex items-center justify-center"><Heart size={11} weight="fill" /></span>}
                                            </div>
                                            <span className="text-[11px] truncate w-full text-center">{c.convoSettings?.remarkName?.trim() || c.name}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </>
                    )}
                </div>
                <div className="shrink-0 p-4 pb-safe">
                    <button onClick={startGame} disabled={picked.size === 0}
                        className="w-full py-3.5 rounded-2xl font-black text-[15px] active:scale-[0.98] transition-transform disabled:opacity-40"
                        style={{ background: 'linear-gradient(90deg,#e9c46a,#d4943a)', color: '#2a1820', boxShadow: '0 10px 24px -10px rgba(233,196,106,0.6)' }}>
                        开局 · 册封后宫
                    </button>
                </div>
            </div>
        );
    }

    // ───────── 游戏进行 ─────────
    const selCardObj = selCard ? getCard(selCard) : null;
    return (
        <div className="h-full w-full flex flex-col" style={{ background: 'linear-gradient(180deg,#2a1820 0%,#3a2230 100%)', color: '#f3e3d3' }}>
            <Header onBack={closeApp} title="椒房记" right={
                <button onClick={newGame} className="p-2 rounded-full active:scale-90 transition-transform opacity-80" title="重开"><ArrowClockwise size={18} weight="bold" /></button>
            } />

            {/* 日 / 行动点 / 宠冠 */}
            <div className="shrink-0 px-4 pb-2 flex items-center gap-3 text-[12px]">
                <span className="px-2.5 py-1 rounded-full bg-white/10 font-bold">第 {game.day} 日</span>
                <span className="flex items-center gap-1" title="行动点">
                    {Array.from({ length: game.maxEnergy }).map((_, i) => (
                        <Lightning key={i} size={15} weight="fill" style={{ color: i < game.energy ? '#e9c46a' : 'rgba(255,255,255,0.18)' }} />
                    ))}
                </span>
                {champion && <span className="ml-auto flex items-center gap-1 opacity-80"><Crown size={14} weight="fill" style={{ color: '#e9c46a' }} />宠冠 · {champion.name}</span>}
            </div>

            <div className="flex-1 overflow-y-auto px-4" style={{ scrollbarWidth: 'none' }}>
                {selCardObj?.targeted && (
                    <div className="text-center text-[12px] mb-2 py-1.5 rounded-xl bg-[#e9c46a]/15 text-[#e9c46a] font-bold">
                        翻谁的牌子？点一位 ·「{selCardObj.name}」<button onClick={() => setSelCard(null)} className="ml-2 underline opacity-80">取消</button>
                    </div>
                )}
                {/* 后宫名册 */}
                <div className="space-y-2">
                    {game.members.map(m => (
                        <MemberRow key={m.charId} m={m}
                            selectable={!!selCardObj?.targeted}
                            onPick={() => selCard && onPlay(selCard, m.charId)} />
                    ))}
                </div>

                {/* 起居注（日志） */}
                <div className="mt-4 mb-2 text-[11px] font-bold tracking-widest opacity-50">起居注</div>
                <div className="space-y-1.5 pb-3">
                    {game.log.map(e => (
                        <div key={e.id} className="text-[12px] leading-relaxed px-3 py-1.5 rounded-lg bg-white/[0.04]" style={{ color: toneColor(e.tone) === '#7a6a55' ? '#d8c8b8' : undefined }}>
                            <span style={{ color: e.tone === 'good' ? '#e9c46a' : e.tone === 'bad' ? '#e09a9a' : e.tone === 'event' ? '#c4b0e0' : '#d8c8b8' }}>{e.text}</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* 手牌 + 就寝 */}
            <div className="shrink-0 border-t border-white/10 bg-black/20 backdrop-blur-sm px-3 pt-2.5 pb-safe">
                <div className="flex items-center justify-between mb-1.5 px-1">
                    <span className="text-[11px] font-bold opacity-50 flex items-center gap-1"><Cardholder size={13} weight="bold" />手牌</span>
                    <button onClick={onSleep} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 text-[12px] font-bold active:scale-95 transition-transform">
                        <MoonStars size={14} weight="fill" style={{ color: '#c4b0e0' }} />就寝 · 翻篇
                    </button>
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
                    {game.hand.length === 0 && <div className="text-[12px] opacity-50 py-4 px-1">今日牌已出尽，就寝进入次日。</div>}
                    {game.hand.map((cid, i) => {
                        const card = getCard(cid)!;
                        const active = selCard === cid;
                        const afford = game.energy >= card.energy;
                        return (
                            <button key={`${cid}-${i}`} onClick={() => onPlay(cid)} disabled={!afford}
                                className={`shrink-0 w-[88px] rounded-2xl p-2 border text-center transition-all active:scale-95 ${active ? 'border-[#e9c46a] bg-[#e9c46a]/15' : 'border-white/15 bg-white/[0.06]'} ${!afford ? 'opacity-35' : ''}`}>
                                <div className="text-[24px] leading-none mb-1">{card.emoji}</div>
                                <div className="text-[11px] font-bold leading-tight truncate">{card.name}</div>
                                <div className="mt-1 flex items-center justify-center gap-0.5 text-[10px] opacity-70">
                                    {Array.from({ length: card.energy }).map((_, k) => <Lightning key={k} size={9} weight="fill" style={{ color: '#e9c46a' }} />)}
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* 夜间事件 */}
            {game.pendingEvent && (
                <div className="absolute inset-0 z-40 flex items-end justify-center bg-black/55 backdrop-blur-sm animate-fade-in" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
                    <div className="w-full m-3 rounded-3xl p-5 animate-slide-up" style={{ background: 'linear-gradient(160deg,#3a2230,#2a1820)', border: '1px solid rgba(233,196,106,0.25)', boxShadow: '0 -10px 40px rgba(0,0,0,0.5)' }}>
                        <div className="text-center mb-3">
                            <div className="text-[40px] leading-none mb-1">{game.pendingEvent.emoji}</div>
                            <div className="text-[17px] font-black" style={{ color: '#e9c46a' }}>{game.pendingEvent.title}</div>
                        </div>
                        <p className="text-[13px] leading-relaxed text-center opacity-90 mb-4">{game.pendingEvent.text}</p>
                        <div className="space-y-2">
                            {game.pendingEvent.options.map((o, i) => (
                                <button key={i} onClick={() => onResolve(i)}
                                    className="w-full py-3 rounded-2xl font-bold text-[14px] active:scale-[0.98] transition-transform"
                                    style={{ background: o.tone === 'bad' ? 'rgba(224,154,154,0.14)' : 'rgba(233,196,106,0.16)', color: o.tone === 'bad' ? '#e09a9a' : '#e9c46a', border: '1px solid rgba(255,255,255,0.08)' }}>
                                    {o.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const Header: React.FC<{ onBack: () => void; title: string; right?: React.ReactNode }> = ({ onBack, title, right }) => (
    <div className="shrink-0">
        <div style={{ height: 'var(--safe-top)' }} />
        <div className="flex items-center px-4 h-14 gap-2">
            <button onClick={onBack} className="p-2 -ml-2 rounded-full active:scale-90 transition-transform opacity-90"><CaretLeft size={22} weight="bold" /></button>
            <Crown size={20} weight="fill" style={{ color: '#e9c46a' }} />
            <span className="font-black text-lg tracking-wide" style={{ fontFamily: 'var(--font-display)' }}>{title}</span>
            <div className="flex-1" />
            {right}
        </div>
    </div>
);

const MemberRow: React.FC<{ m: HaremMember; selectable: boolean; onPick: () => void }> = ({ m, selectable, onPick }) => {
    const rank = rankOf(m.favor);
    return (
        <button disabled={!selectable} onClick={onPick}
            className={`w-full flex items-center gap-3 p-2.5 rounded-2xl border text-left transition-all ${selectable ? 'border-[#e9c46a]/60 bg-[#e9c46a]/10 active:scale-[0.98] cursor-pointer' : 'border-white/10 bg-white/[0.05]'}`}>
            <img src={m.avatar} className="w-12 h-12 rounded-full object-cover shrink-0" />
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <span className="font-bold text-[14px] truncate">{m.name}</span>
                    <span className="px-1.5 py-0.5 rounded-md text-[10px] font-bold shrink-0" style={{ background: 'rgba(233,196,106,0.18)', color: '#e9c46a' }}>{rank.label}</span>
                    <span className="ml-auto text-[15px] shrink-0">{moodFace(m.mood)}</span>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                    <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${m.favor}%`, background: 'linear-gradient(90deg,#d4943a,#e9c46a)' }} />
                    </div>
                    <span className="text-[10px] tabular-nums opacity-70 shrink-0">宠 {m.favor}</span>
                </div>
            </div>
        </button>
    );
};

export default HaremApp;
