import React, { useState, useEffect, useMemo } from 'react';
import { useOS } from '../context/OSContext';
import { resolveAuxApi } from '../utils/auxApi';
import { llmComplete } from '../utils/llmComplete';
import {
    HaremState, HaremMember, HaremEnding, initHaremGame, playCard, endDay, resolveHaremEvent,
    getCard, rankOf, topFavored, memberTitles, addMembers, pushSpeech,
    buildConcubineLinePrompt, parseConcubineLine, fallbackConcubineLine,
    buildAINightEventPrompt, parseAINightEvent, buildEndingPrompt, parseEnding, fallbackEnding,
} from '../utils/haremGame';
import {
    CaretLeft, Crown, MoonStars, ArrowClockwise, Heart, Cardholder, Lightning,
    UserPlus, Scroll, Sparkle, Baby, X,
} from '@phosphor-icons/react';

const STORAGE_KEY = 'moro_harem_game';
const MAX_MEMBERS = 9;

const moodFace = (m: number): string => m >= 75 ? '😊' : m >= 55 ? '😌' : m >= 38 ? '🙂' : m >= 22 ? '😕' : '😞';
const eid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const GOLD = '#e9c46a';

const HaremApp: React.FC = () => {
    const { closeApp, characters, userProfile, apiConfig, auxApiConfig, addToast } = useOS();
    const [game, setGame] = useState<HaremState | null>(null);
    const [loaded, setLoaded] = useState(false);
    const [picked, setPicked] = useState<Set<string>>(new Set());
    const [selCard, setSelCard] = useState<string | null>(null);
    const [aiBusy, setAiBusy] = useState(false);          // 拟夜间事件中
    const [speaking, setSpeaking] = useState(false);      // 妃嫔台词生成中
    const [recruit, setRecruit] = useState<Set<string> | null>(null); // 选秀勾选
    const [ending, setEnding] = useState<HaremEnding | null>(null);
    const [endingBusy, setEndingBusy] = useState(false);

    const api = () => resolveAuxApi(auxApiConfig, apiConfig);

    useEffect(() => {
        try { const raw = localStorage.getItem(STORAGE_KEY); if (raw) setGame(JSON.parse(raw)); }
        catch { /* ignore */ }
        setLoaded(true);
    }, []);
    useEffect(() => {
        if (!loaded) return;
        try { if (game) localStorage.setItem(STORAGE_KEY, JSON.stringify(game)); else localStorage.removeItem(STORAGE_KEY); }
        catch { /* ignore */ }
    }, [game, loaded]);

    const seedOf = (c: any) => ({
        charId: c.id, name: c.convoSettings?.remarkName?.trim() || c.name,
        avatar: c.convoSettings?.charAvatarOverride || c.avatar, affection: c.affection,
        persona: (c.description as string | undefined),
    });

    const startGame = () => {
        const chosen = characters.filter(c => picked.has(c.id)).slice(0, MAX_MEMBERS);
        if (chosen.length === 0) { addToast('至少选一位入宫', 'error'); return; }
        setGame(initHaremGame(chosen.map(seedOf)));
        setSelCard(null);
    };

    // 妃嫔台词（AI）：打牌后被宠者按人设说一句
    const fetchLine = async (member: HaremMember, action: string, cool: boolean) => {
        setSpeaking(true);
        let line = '';
        try {
            const { system, user } = buildConcubineLinePrompt(member, action);
            const out = await llmComplete(api(), [{ role: 'system', content: system }, { role: 'user', content: user }], { temperature: 0.95, maxTokens: 80 });
            line = parseConcubineLine(out);
        } catch { /* fall through */ }
        if (!line) line = fallbackConcubineLine(cool ? 'cool' : 'good');
        setGame(g => g ? pushSpeech(g, member, line) : g);
        setSpeaking(false);
    };

    const onPlay = (cardId: string, targetId?: string) => {
        if (!game) return;
        const card = getCard(cardId);
        if (!card) return;
        if (game.energy < card.energy) { addToast('行动点不够了，先就寝吧', 'error'); return; }
        if (card.targeted && !targetId) { setSelCard(cardId); return; }
        const next = playCard(game, cardId, targetId);
        setGame(next);
        setSelCard(null);
        if (card.targeted && targetId) {
            const m = next.members.find(x => x.charId === targetId);
            if (m) fetchLine(m, card.flavor.replace(/\{name\}/g, m.name), card.favor < 0);
        }
    };

    // 就寝：先求 AI 夜间事件，失败回退模板事件（含平安夜）
    const onSleep = async () => {
        if (!game || game.pendingEvent || aiBusy) return;
        setAiBusy(true);
        let ev = null;
        try {
            const { system, user } = buildAINightEventPrompt(game);
            const out = await llmComplete(api(), [{ role: 'system', content: system }, { role: 'user', content: user }], { temperature: 1.0, maxTokens: 700 });
            ev = parseAINightEvent(out, game.members);
        } catch { /* fall through */ }
        setAiBusy(false);
        if (ev) {
            setGame(g => g ? { ...g, pendingEvent: ev, log: [{ id: eid(), day: g.day, text: `入夜，${ev!.emoji} ${ev!.title}。`, tone: 'event' as const }, ...g.log].slice(0, 80) } : g);
        } else {
            setGame(g => g ? endDay(g) : g);
        }
    };

    const onResolve = (i: number) => { if (game) setGame(resolveHaremEvent(game, i)); };
    const newGame = () => { setGame(null); setPicked(new Set()); setSelCard(null); setEnding(null); };

    const doRecruit = () => {
        if (!game || !recruit) return;
        const have = new Set(game.members.map(m => m.charId));
        const chosen = characters.filter(c => recruit.has(c.id) && !have.has(c.id));
        if (chosen.length === 0) { setRecruit(null); return; }
        setGame(addMembers(game, chosen.map(seedOf)));
        setRecruit(null);
        addToast(`${chosen.length} 位新人入宫`, 'success');
    };

    const fetchEnding = async () => {
        if (!game) return;
        setEndingBusy(true);
        let e: HaremEnding | null = null;
        try {
            const { system, user } = buildEndingPrompt(game);
            const out = await llmComplete(api(), [{ role: 'system', content: system }, { role: 'user', content: user }], { temperature: 0.9, maxTokens: 500 });
            e = parseEnding(out);
        } catch { /* fall through */ }
        if (!e || !e.verdict) e = fallbackEnding(game);
        setEnding(e);
        setEndingBusy(false);
    };

    const champion = useMemo(() => game ? topFavored(game) : null, [game]);
    const heirsTotal = useMemo(() => game ? game.members.reduce((s, m) => s + (m.heirs || 0), 0) : 0, [game]);

    if (!loaded) return <div className="h-full w-full" style={{ background: '#2a1820' }} />;

    // ───────── 开局选妃 ─────────
    if (!game) {
        return (
            <div className="h-full w-full flex flex-col" style={{ background: 'linear-gradient(180deg,#2a1820 0%,#3a2230 100%)', color: '#f3e3d3' }}>
                <Header onBack={closeApp} title="椒房记" />
                <div className="flex-1 overflow-y-auto px-5 py-3" style={{ scrollbarWidth: 'none' }}>
                    <div className="text-center mb-4">
                        <Crown size={40} weight="fill" className="mx-auto mb-2" style={{ color: GOLD }} />
                        <p className="text-[13px] leading-relaxed opacity-80">择良人入宫，组你的后宫。<br />日日翻牌承欢、晋位分、开枝散叶，夜夜应对宫闱风波。</p>
                        <p className="text-[11px] mt-1.5 opacity-50">妃嫔台词与夜间事件由 AI 按人设实时生成</p>
                    </div>
                    {characters.length === 0 ? (
                        <div className="text-center opacity-60 text-sm pt-10">通讯录里还没有角色</div>
                    ) : (
                        <>
                            <div className="text-[11px] font-bold tracking-widest opacity-60 mb-2">选 1–{MAX_MEMBERS} 位（已选 {picked.size}）</div>
                            <PickGrid characters={characters} picked={picked} setPicked={setPicked} max={MAX_MEMBERS} />
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
                <div className="flex items-center gap-0.5">
                    <button onClick={() => setRecruit(new Set())} className="p-2 rounded-full active:scale-90 transition-transform opacity-80" title="选秀"><UserPlus size={18} weight="bold" /></button>
                    <button onClick={fetchEnding} disabled={endingBusy} className="p-2 rounded-full active:scale-90 transition-transform opacity-80 disabled:opacity-40" title="封笔修史"><Scroll size={18} weight={endingBusy ? 'duotone' : 'bold'} className={endingBusy ? 'animate-pulse' : ''} /></button>
                    <button onClick={newGame} className="p-2 rounded-full active:scale-90 transition-transform opacity-80" title="重开"><ArrowClockwise size={18} weight="bold" /></button>
                </div>
            } />

            {/* 日 / 行动点 / 宠冠 / 皇嗣 */}
            <div className="shrink-0 px-4 pb-2 flex items-center gap-2.5 text-[12px] flex-wrap">
                <span className="px-2.5 py-1 rounded-full bg-white/10 font-bold">第 {game.day} 日</span>
                <span className="flex items-center gap-1" title="行动点">
                    {Array.from({ length: game.maxEnergy }).map((_, i) => (
                        <Lightning key={i} size={15} weight="fill" style={{ color: i < game.energy ? GOLD : 'rgba(255,255,255,0.18)' }} />
                    ))}
                </span>
                {heirsTotal > 0 && <span className="flex items-center gap-1 opacity-80"><Baby size={14} weight="fill" style={{ color: '#f0b8c8' }} />皇嗣 {heirsTotal}</span>}
                {champion && <span className="ml-auto flex items-center gap-1 opacity-80"><Crown size={14} weight="fill" style={{ color: GOLD }} />宠冠 · {champion.name}</span>}
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
                        <MemberRow key={m.charId} m={m} titles={memberTitles(game.members, m)}
                            selectable={!!selCardObj?.targeted}
                            onPick={() => selCard && onPlay(selCard, m.charId)} />
                    ))}
                </div>

                {/* 起居注（日志） */}
                <div className="mt-4 mb-2 flex items-center gap-2">
                    <span className="text-[11px] font-bold tracking-widest opacity-50">起居注</span>
                    {speaking && <span className="text-[10px] opacity-50 flex items-center gap-1"><Sparkle size={10} weight="fill" className="animate-pulse" style={{ color: GOLD }} />妃嫔正斟酌言辞…</span>}
                </div>
                <div className="space-y-1.5 pb-3">
                    {game.log.map(e => e.tone === 'speech' ? (
                        <div key={e.id} className="flex items-start gap-2 px-1 py-0.5">
                            {e.avatar ? <img src={e.avatar} className="w-6 h-6 rounded-full object-cover shrink-0 mt-0.5" /> : <span className="w-6 h-6 rounded-full bg-white/10 shrink-0" />}
                            <div className="min-w-0">
                                <span className="text-[10px] opacity-50">{e.speaker}</span>
                                <div className="text-[12px] leading-relaxed px-2.5 py-1 rounded-xl rounded-tl-sm inline-block" style={{ background: 'rgba(233,196,106,0.12)', color: '#f3e3d3' }}>{e.text}</div>
                            </div>
                        </div>
                    ) : (
                        <div key={e.id} className="text-[12px] leading-relaxed px-3 py-1.5 rounded-lg bg-white/[0.04]">
                            <span style={{ color: e.tone === 'good' ? GOLD : e.tone === 'bad' ? '#e09a9a' : e.tone === 'event' ? '#c4b0e0' : '#d8c8b8' }}>{e.text}</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* 手牌 + 就寝 */}
            <div className="shrink-0 border-t border-white/10 bg-black/20 backdrop-blur-sm px-3 pt-2.5 pb-safe">
                <div className="flex items-center justify-between mb-1.5 px-1">
                    <span className="text-[11px] font-bold opacity-50 flex items-center gap-1"><Cardholder size={13} weight="bold" />手牌</span>
                    <button onClick={onSleep} disabled={aiBusy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 text-[12px] font-bold active:scale-95 transition-transform disabled:opacity-60">
                        {aiBusy ? <><Sparkle size={14} weight="fill" className="animate-pulse" style={{ color: '#c4b0e0' }} />朱笔御批·拟旨中…</> : <><MoonStars size={14} weight="fill" style={{ color: '#c4b0e0' }} />就寝 · 翻篇</>}
                    </button>
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
                    {game.hand.length === 0 && <div className="text-[12px] opacity-50 py-4 px-1">今日牌已出尽，就寝进入次日。</div>}
                    {game.hand.map((cid, i) => {
                        const card = getCard(cid)!;
                        const active = selCard === cid;
                        const afford = game.energy >= card.energy;
                        const bad = card.favor < 0;
                        return (
                            <button key={`${cid}-${i}`} onClick={() => onPlay(cid)} disabled={!afford}
                                className={`shrink-0 w-[88px] rounded-2xl p-2 border text-center transition-all active:scale-95 ${active ? 'border-[#e9c46a] bg-[#e9c46a]/15' : bad ? 'border-rose-300/25 bg-rose-300/[0.06]' : 'border-white/15 bg-white/[0.06]'} ${!afford ? 'opacity-35' : ''}`}>
                                <div className="text-[24px] leading-none mb-1">{card.emoji}</div>
                                <div className="text-[11px] font-bold leading-tight truncate">{card.name}</div>
                                <div className="mt-1 flex items-center justify-center gap-0.5 text-[10px] opacity-70">
                                    {Array.from({ length: card.energy }).map((_, k) => <Lightning key={k} size={9} weight="fill" style={{ color: GOLD }} />)}
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
                            <div className="text-[17px] font-black" style={{ color: GOLD }}>{game.pendingEvent.title}</div>
                            {game.pendingEvent.type === 'ai' && <div className="text-[9px] mt-1 opacity-40 tracking-widest">AI 现拟</div>}
                        </div>
                        <p className="text-[13px] leading-relaxed text-center opacity-90 mb-4">{game.pendingEvent.text}</p>
                        <div className="space-y-2">
                            {game.pendingEvent.options.map((o, i) => (
                                <button key={i} onClick={() => onResolve(i)}
                                    className="w-full py-3 rounded-2xl font-bold text-[14px] active:scale-[0.98] transition-transform"
                                    style={{ background: o.tone === 'bad' ? 'rgba(224,154,154,0.14)' : 'rgba(233,196,106,0.16)', color: o.tone === 'bad' ? '#e09a9a' : GOLD, border: '1px solid rgba(255,255,255,0.08)' }}>
                                    {o.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* 选秀弹窗 */}
            {recruit && (
                <div className="absolute inset-0 z-40 flex flex-col bg-black/60 backdrop-blur-sm animate-fade-in">
                    <div className="mt-auto rounded-t-3xl p-4 pb-safe animate-slide-up" style={{ background: 'linear-gradient(160deg,#3a2230,#2a1820)', border: '1px solid rgba(233,196,106,0.2)' }}>
                        <div className="flex items-center gap-2 mb-3">
                            <UserPlus size={18} weight="fill" style={{ color: GOLD }} />
                            <span className="font-black text-[15px]">选秀 · 采选新人入宫</span>
                            <button onClick={() => setRecruit(null)} className="ml-auto p-1 opacity-60"><X size={20} weight="bold" /></button>
                        </div>
                        {(() => {
                            const have = new Set(game.members.map(m => m.charId));
                            const avail = characters.filter(c => !have.has(c.id));
                            const room = MAX_MEMBERS - game.members.length;
                            if (avail.length === 0) return <div className="text-center opacity-60 text-sm py-8">通讯录里没有新的人选了</div>;
                            if (room <= 0) return <div className="text-center opacity-60 text-sm py-8">后宫已满（{MAX_MEMBERS} 位）</div>;
                            return (
                                <>
                                    <div className="text-[11px] opacity-60 mb-2">还可纳 {room} 位（已选 {recruit.size}）</div>
                                    <div className="max-h-[40vh] overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
                                        <PickGrid characters={avail} picked={recruit} setPicked={(fn: any) => setRecruit(fn)} max={room} />
                                    </div>
                                    <button onClick={doRecruit} disabled={recruit.size === 0}
                                        className="w-full mt-3 py-3 rounded-2xl font-black text-[14px] active:scale-[0.98] transition-transform disabled:opacity-40"
                                        style={{ background: 'linear-gradient(90deg,#e9c46a,#d4943a)', color: '#2a1820' }}>
                                        册封入宫
                                    </button>
                                </>
                            );
                        })()}
                    </div>
                </div>
            )}

            {/* 史官评（结局） */}
            {ending && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in p-4">
                    <div className="w-full max-h-[80vh] overflow-y-auto rounded-3xl p-5 animate-slide-up" style={{ background: 'linear-gradient(165deg,#f3e7d3,#e7d3b8)', color: '#4a3826', boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }} >
                        <div className="text-center mb-3">
                            <Scroll size={30} weight="fill" className="mx-auto mb-1" style={{ color: '#9a6a3a' }} />
                            <div className="text-[16px] font-black tracking-wide" style={{ fontFamily: 'var(--font-display)' }}>史 官 评</div>
                        </div>
                        <p className="text-[13.5px] leading-loose text-justify mb-4" style={{ textIndent: '2em' }}>{ending.verdict}</p>
                        {ending.fates.length > 0 && (
                            <div className="space-y-1.5 border-t border-[#9a6a3a]/20 pt-3">
                                {ending.fates.map((f, i) => (
                                    <div key={i} className="text-[12.5px] leading-relaxed"><span className="font-black">{f.name}</span>　{f.line}</div>
                                ))}
                            </div>
                        )}
                        <div className="flex gap-2 mt-5">
                            <button onClick={() => setEnding(null)} className="flex-1 py-2.5 rounded-xl font-bold text-[13px]" style={{ background: 'rgba(74,56,38,0.1)', color: '#4a3826' }}>继续临朝</button>
                            <button onClick={newGame} className="flex-1 py-2.5 rounded-xl font-black text-[13px]" style={{ background: 'linear-gradient(90deg,#b9863a,#9a6a3a)', color: '#f3e7d3' }}>改元 · 重开</button>
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
            <Crown size={20} weight="fill" style={{ color: GOLD }} />
            <span className="font-black text-lg tracking-wide" style={{ fontFamily: 'var(--font-display)' }}>{title}</span>
            <div className="flex-1" />
            {right}
        </div>
    </div>
);

const PickGrid: React.FC<{ characters: any[]; picked: Set<string>; setPicked: (fn: (p: Set<string>) => Set<string>) => void; max: number }> = ({ characters, picked, setPicked, max }) => (
    <div className="grid grid-cols-3 gap-2.5">
        {characters.map(c => {
            const on = picked.has(c.id);
            const full = !on && picked.size >= max;
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
);

const MemberRow: React.FC<{ m: HaremMember; titles: string[]; selectable: boolean; onPick: () => void }> = ({ m, titles, selectable, onPick }) => {
    const rank = rankOf(m.favor);
    const badgeColor = (t: string): string => t === '有孕' ? '#f0b8c8' : t === '宠冠' ? GOLD : t.startsWith('皇嗣') ? '#f0c8a0' : '#c4b0e0';
    return (
        <button disabled={!selectable} onClick={onPick}
            className={`w-full flex items-center gap-3 p-2.5 rounded-2xl border text-left transition-all ${selectable ? 'border-[#e9c46a]/60 bg-[#e9c46a]/10 active:scale-[0.98] cursor-pointer' : 'border-white/10 bg-white/[0.05]'}`}>
            <div className="relative shrink-0">
                <img src={m.avatar} className="w-12 h-12 rounded-full object-cover" />
                {(m.pregnant || 0) > 0 && <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-[#3a2230] border border-[#f0b8c8]/50 flex items-center justify-center text-[10px]">🤰</span>}
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-bold text-[14px] truncate">{m.name}</span>
                    <span className="px-1.5 py-0.5 rounded-md text-[10px] font-bold shrink-0" style={{ background: 'rgba(233,196,106,0.18)', color: GOLD }}>{rank.label}</span>
                    {titles.map(t => (
                        <span key={t} className="px-1 py-0.5 rounded text-[9px] font-bold shrink-0" style={{ background: 'rgba(255,255,255,0.08)', color: badgeColor(t) }}>{t}</span>
                    ))}
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
