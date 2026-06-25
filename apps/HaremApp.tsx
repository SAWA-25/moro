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
    PaperBackdrop, ScrapHeader, PaperCard, WashiTape, Polaroid, ScrapButton, StickyNote,
    SectionTag, DashedRule, PaperDialog, PaperSheet,
    INK, INK_SOFT, PAPER, PAGE_BG, HALFTONE,
} from './theater/scrapbook';
import {
    Crown, MoonStars, ArrowClockwise, Cardholder, Lightning,
    UserPlus, Scroll, Sparkle, Baby, X,
} from '@phosphor-icons/react';

const STORAGE_KEY = 'moro_harem_game';
const MAX_MEMBERS = 9;

const moodFace = (m: number): string => m >= 75 ? '😊' : m >= 55 ? '😌' : m >= 38 ? '🙂' : m >= 22 ? '😕' : '😞';
const eid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

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
        if (chosen.length === 0) { addToast('总得先点选一位入宫，椒房才不算空置', 'error'); return; }
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
        if (game.energy < card.energy) { addToast('今日精力已用尽，先就寝歇着吧', 'error'); return; }
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
        addToast(`${chosen.length} 位新人采选入宫`, 'success');
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

    if (!loaded) return <div className="h-full w-full" style={{ background: PAGE_BG }} />;

    // ───────── 开局选秀 ─────────
    if (!game) {
        return (
            <div className="relative h-full w-full flex flex-col overflow-hidden animate-fade-in" style={{ color: INK, background: PAGE_BG }}>
                <PaperBackdrop />
                <ScrapHeader title="椒房记" en="THE PEPPER HALL" onBack={closeApp} />
                <div className="relative z-10 flex-1 overflow-y-auto no-scrollbar px-4 pb-3">
                    <div className="relative px-5 py-4 mb-4 text-center overflow-hidden" style={cardPanel}>
                        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.07]" style={{ backgroundImage: HALFTONE, backgroundSize: '7px 7px' }} />
                        <WashiTape color="ink" rotate={-4} className="absolute -top-2.5 left-1/2 -translate-x-1/2 w-20 h-5 rounded-[2px]" />
                        <Crown size={34} weight="fill" className="relative mx-auto mb-2" style={{ color: INK }} />
                        <p className="relative text-[13px] leading-relaxed" style={{ color: '#48443c' }}>
                            择良人入椒房，立你的后宫。<br />日日翻牌承欢、晋位分、开枝散叶，夜夜应对宫闱风波。
                        </p>
                        <p className="relative text-[11px] mt-1.5" style={{ color: INK_SOFT }}>妃嫔台词与夜间事件，由 AI 按各自人设现场写就</p>
                    </div>
                    {characters.length === 0 ? (
                        <StickyNote color="butter" rotate={-1.5} className="px-5 py-8 text-center">
                            <span className="text-[13px] font-bold" style={{ color: '#5b554b' }}>通讯录空空，尚无良人可供采选</span>
                        </StickyNote>
                    ) : (
                        <>
                            <SectionTag en={`PICK 1–${MAX_MEMBERS}`} className="mb-3">选 1–{MAX_MEMBERS} 位 · 已选 {picked.size}</SectionTag>
                            <PickGrid characters={characters} picked={picked} setPicked={setPicked} max={MAX_MEMBERS} />
                        </>
                    )}
                    <div className="h-3" />
                </div>
                <div className="relative z-10 shrink-0 p-4 pb-safe">
                    <ScrapButton variant="ink" onClick={startGame} disabled={picked.size === 0} className="w-full py-3.5 text-[15px]">
                        开局 · 册封后宫
                    </ScrapButton>
                </div>
            </div>
        );
    }

    // ───────── 游戏进行 ─────────
    const selCardObj = selCard ? getCard(selCard) : null;
    return (
        <div className="relative h-full w-full flex flex-col overflow-hidden animate-fade-in" style={{ color: INK, background: PAGE_BG }}>
            <PaperBackdrop corners={false} />
            <ScrapHeader title="椒房记" en="THE PEPPER HALL" onBack={closeApp} right={
                <div className="flex items-center gap-0.5">
                    <button onClick={() => setRecruit(new Set())} className="p-2 rounded-full active:scale-90 transition-transform" style={{ color: INK_SOFT }} title="选秀"><UserPlus size={18} weight="bold" /></button>
                    <button onClick={fetchEnding} disabled={endingBusy} className="p-2 rounded-full active:scale-90 transition-transform disabled:opacity-40" style={{ color: INK_SOFT }} title="封笔修史"><Scroll size={18} weight={endingBusy ? 'duotone' : 'bold'} className={endingBusy ? 'animate-pulse' : ''} /></button>
                    <button onClick={newGame} className="p-2 rounded-full active:scale-90 transition-transform" style={{ color: INK_SOFT }} title="改元重开"><ArrowClockwise size={18} weight="bold" /></button>
                </div>
            } />

            {/* 日 / 行动点 / 宠冠 / 皇嗣 */}
            <div className="relative z-10 shrink-0 px-4 pb-2 flex items-center gap-2 text-[12px] flex-wrap">
                <span className="px-2.5 py-1 rounded-full font-bold" style={{ background: INK, color: PAPER }}>第 {game.day} 日</span>
                <span className="flex items-center gap-1 px-2 py-1 rounded-full" style={{ background: 'rgba(255,253,247,0.7)', border: '1px dashed rgba(150,144,132,0.6)' }} title="行动点">
                    {Array.from({ length: game.maxEnergy }).map((_, i) => (
                        <Lightning key={i} size={13} weight="fill" style={{ color: i < game.energy ? INK : 'rgba(150,144,132,0.4)' }} />
                    ))}
                </span>
                {heirsTotal > 0 && <span className="flex items-center gap-1" style={{ color: INK_SOFT }}><Baby size={14} weight="fill" />皇嗣 {heirsTotal}</span>}
                {champion && <span className="ml-auto flex items-center gap-1 font-bold" style={{ color: INK }}><Crown size={14} weight="fill" />宠冠 · {champion.name}</span>}
            </div>

            <div className="relative z-10 flex-1 overflow-y-auto no-scrollbar px-4">
                {selCardObj?.targeted && (
                    <div className="flex items-center gap-2 text-[12px] mb-2 px-3 py-2 rounded-xl" style={{ background: 'rgba(31,29,26,0.06)', border: '1px dashed rgba(150,144,132,0.6)', color: INK }}>
                        <span className="font-bold">翻谁的牌子？点一位 ·「{selCardObj.name}」</span>
                        <button onClick={() => setSelCard(null)} className="ml-auto underline" style={{ color: INK_SOFT }}>取消</button>
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
                    <SectionTag en="THE DAILY RECORD" className="flex-1">起居注</SectionTag>
                    {speaking && <span className="text-[10px] flex items-center gap-1 shrink-0" style={{ color: INK_SOFT }}><Sparkle size={10} weight="fill" className="animate-pulse" />妃嫔正斟酌言辞…</span>}
                </div>
                <div className="space-y-1.5 pb-3">
                    {game.log.map(e => e.tone === 'speech' ? (
                        <div key={e.id} className="flex items-start gap-2 px-1 py-0.5">
                            {e.avatar ? <img src={e.avatar} className="w-6 h-6 rounded-full object-cover shrink-0 mt-0.5" style={{ border: '1px solid rgba(176,170,158,0.7)' }} /> : <span className="w-6 h-6 rounded-full shrink-0" style={{ background: 'rgba(176,170,158,0.3)' }} />}
                            <div className="min-w-0">
                                <span className="text-[10px]" style={{ color: INK_SOFT }}>{e.speaker}</span>
                                <div className="text-[12px] leading-relaxed px-2.5 py-1 rounded-xl rounded-tl-sm inline-block" style={{ background: 'rgba(31,29,26,0.06)', color: INK, border: '1px dashed rgba(150,144,132,0.5)' }}>{e.text}</div>
                            </div>
                        </div>
                    ) : (
                        <div key={e.id} className="text-[12px] leading-relaxed px-3 py-1.5 rounded-lg" style={{ background: e.tone === 'event' ? 'rgba(31,29,26,0.07)' : 'rgba(232,228,217,0.45)' }}>
                            <span style={{ color: e.tone === 'good' ? INK : e.tone === 'bad' ? '#6b655a' : INK }} className={e.tone === 'good' ? 'font-bold' : e.tone === 'bad' ? 'italic' : ''}>{e.text}</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* 手牌 + 就寝 */}
            <div className="relative z-10 shrink-0 px-3 pt-2.5 pb-safe" style={{ borderTop: '1px dashed rgba(150,144,132,0.6)', background: 'rgba(251,249,242,0.95)' }}>
                <div className="flex items-center justify-between mb-1.5 px-1">
                    <span className="text-[11px] font-bold flex items-center gap-1" style={{ color: INK_SOFT }}><Cardholder size={13} weight="bold" />手牌</span>
                    <ScrapButton variant="paper" onClick={onSleep} disabled={aiBusy} className="px-3 py-1.5 text-[12px]"
                        icon={aiBusy ? <Sparkle size={14} weight="fill" className="animate-pulse" /> : <MoonStars size={14} weight="fill" />}>
                        {aiBusy ? '朱笔御批·拟旨中…' : '就寝 · 翻篇'}
                    </ScrapButton>
                </div>
                <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                    {game.hand.length === 0 && <div className="text-[12px] py-4 px-1" style={{ color: INK_SOFT }}>今日牌已出尽，就寝进入次日。</div>}
                    {game.hand.map((cid, i) => {
                        const card = getCard(cid)!;
                        const active = selCard === cid;
                        const afford = game.energy >= card.energy;
                        const bad = card.favor < 0;
                        return (
                            <button key={`${cid}-${i}`} onClick={() => onPlay(cid)} disabled={!afford} className="shrink-0">
                                <PaperCard tilt={i % 2 === 0 ? -1.2 : 1.2} className={!afford ? 'opacity-35' : ''}
                                    style={{ width: 86, padding: '8px 6px', textAlign: 'center', ...(active ? { background: INK, border: `1px solid ${INK}`, outline: '1px dashed rgba(255,255,255,0.3)' } : bad ? { outlineStyle: 'dashed', outlineColor: 'rgba(120,116,108,0.7)' } : {}) }}>
                                    <div className="text-[22px] leading-none mb-1">{card.emoji}</div>
                                    <div className="text-[11px] font-black leading-tight truncate" style={{ color: active ? PAPER : INK }}>{card.name}</div>
                                    <div className="mt-1 flex items-center justify-center gap-0.5">
                                        {Array.from({ length: card.energy }).map((_, k) => <Lightning key={k} size={9} weight="fill" style={{ color: active ? PAPER : INK_SOFT }} />)}
                                    </div>
                                </PaperCard>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* 夜间事件 */}
            <PaperSheet open={!!game.pendingEvent} tape="ink">
                {game.pendingEvent && (
                    <div className="text-center">
                        <div className="text-[40px] leading-none mb-1">{game.pendingEvent.emoji}</div>
                        <div className="text-[17px] font-black" style={{ color: INK }}>{game.pendingEvent.title}</div>
                        {game.pendingEvent.type === 'ai' && <div className="text-[9px] mt-1 tracking-widest" style={{ color: INK_SOFT }}>AI 现拟</div>}
                        <p className="text-[13px] leading-relaxed mt-2 mb-4" style={{ color: '#48443c' }}>{game.pendingEvent.text}</p>
                        <div className="space-y-2">
                            {game.pendingEvent.options.map((o, i) => (
                                <ScrapButton key={i} variant={o.tone === 'bad' ? 'paper' : 'ink'} onClick={() => onResolve(i)} className="w-full py-3 text-[14px]">
                                    {o.label}
                                </ScrapButton>
                            ))}
                        </div>
                    </div>
                )}
            </PaperSheet>

            {/* 选秀弹窗 */}
            <PaperSheet open={!!recruit} onClose={() => setRecruit(null)} tape="amber">
                <div className="flex items-center gap-2 mb-3">
                    <UserPlus size={18} weight="fill" style={{ color: INK }} />
                    <span className="font-black text-[15px]" style={{ color: INK }}>选秀 · 采选新人入宫</span>
                    <button onClick={() => setRecruit(null)} className="ml-auto p-1" style={{ color: INK_SOFT }}><X size={20} weight="bold" /></button>
                </div>
                {(() => {
                    if (!recruit) return null;
                    const have = new Set(game.members.map(m => m.charId));
                    const avail = characters.filter(c => !have.has(c.id));
                    const room = MAX_MEMBERS - game.members.length;
                    if (avail.length === 0) return <div className="text-center py-8 text-sm" style={{ color: INK_SOFT }}>宫外已无待选之人，通讯录已被采选殆尽</div>;
                    if (room <= 0) return <div className="text-center py-8 text-sm" style={{ color: INK_SOFT }}>椒房已满（{MAX_MEMBERS} 位），暂不再采选</div>;
                    return (
                        <>
                            <div className="text-[11px] mb-2" style={{ color: INK_SOFT }}>还可纳 {room} 位（已选 {recruit.size}）</div>
                            <div className="max-h-[40vh] overflow-y-auto no-scrollbar">
                                <PickGrid characters={avail} picked={recruit} setPicked={(fn: any) => setRecruit(fn)} max={room} />
                            </div>
                            <ScrapButton variant="ink" onClick={doRecruit} disabled={recruit.size === 0} className="w-full mt-3 py-3 text-[14px]">
                                册封入宫
                            </ScrapButton>
                        </>
                    );
                })()}
            </PaperSheet>

            {/* 史官评（结局） */}
            <PaperDialog open={!!ending} onClose={() => setEnding(null)} en="THE COURT HISTORIAN'S VERDICT" maxWidth={340}>
                {ending && (
                    <div className="max-h-[58vh] overflow-y-auto no-scrollbar">
                        <div className="text-center mb-3">
                            <Scroll size={28} weight="fill" className="mx-auto mb-1" style={{ color: INK }} />
                            <div className="text-[16px] font-black tracking-wide" style={{ fontFamily: 'var(--font-display)', color: INK }}>史 官 评</div>
                        </div>
                        <p className="text-[13.5px] leading-loose text-justify mb-4" style={{ textIndent: '2em', color: '#48443c' }}>{ending.verdict}</p>
                        {ending.fates.length > 0 && (
                            <>
                                <DashedRule className="mb-3" />
                                <div className="space-y-1.5">
                                    {ending.fates.map((f, i) => (
                                        <div key={i} className="text-[12.5px] leading-relaxed" style={{ color: '#48443c' }}><span className="font-black" style={{ color: INK }}>{f.name}</span>　{f.line}</div>
                                    ))}
                                </div>
                            </>
                        )}
                        <div className="flex gap-2 mt-5">
                            <ScrapButton variant="paper" onClick={() => setEnding(null)} className="flex-1 py-2.5 text-[13px]">继续临朝</ScrapButton>
                            <ScrapButton variant="ink" onClick={newGame} className="flex-1 py-2.5 text-[13px]">改元 · 重开</ScrapButton>
                        </div>
                    </div>
                )}
            </PaperDialog>
        </div>
    );
};

const cardPanel: React.CSSProperties = {
    background: 'linear-gradient(180deg,#fbf9f2,#f1eee4)',
    border: '1px solid rgba(176,170,158,0.7)',
    outline: '1px dashed rgba(150,144,132,0.5)',
    outlineOffset: '-5px',
    borderRadius: 16,
    boxShadow: '0 12px 24px -16px rgba(31,29,26,0.5)',
};

const PickGrid: React.FC<{ characters: any[]; picked: Set<string>; setPicked: (fn: (p: Set<string>) => Set<string>) => void; max: number }> = ({ characters, picked, setPicked, max }) => (
    <div className="grid grid-cols-3 gap-3">
        {characters.map((c, i) => {
            const on = picked.has(c.id);
            const full = !on && picked.size >= max;
            return (
                <div key={c.id} className={`flex flex-col items-center ${full ? 'opacity-30' : ''}`}>
                    <Polaroid
                        src={c.convoSettings?.charAvatarOverride || c.avatar}
                        caption={c.convoSettings?.remarkName?.trim() || c.name}
                        selected={on}
                        rotate={i % 2 === 0 ? -2 : 2}
                        size={56}
                        onClick={full ? undefined : () => setPicked(p => { const n = new Set(p); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; })}
                    />
                </div>
            );
        })}
    </div>
);

const MemberRow: React.FC<{ m: HaremMember; titles: string[]; selectable: boolean; onPick: () => void }> = ({ m, titles, selectable, onPick }) => {
    const rank = rankOf(m.favor);
    return (
        <button disabled={!selectable} onClick={onPick} className="w-full text-left">
            <PaperCard className={`flex items-center gap-3 p-2.5 ${selectable ? 'active:scale-[0.98] cursor-pointer' : ''}`}
                style={selectable ? { outline: `1px solid ${INK}`, outlineOffset: -3, background: 'rgba(31,29,26,0.05)' } : undefined}>
                <div className="relative shrink-0">
                    <img src={m.avatar} className="w-12 h-12 rounded-full object-cover" style={{ border: '1px solid rgba(176,170,158,0.7)' }} />
                    {(m.pregnant || 0) > 0 && <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center text-[10px]" style={{ background: PAPER, border: '1px solid rgba(150,144,132,0.7)' }}>🤰</span>}
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-bold text-[14px] truncate" style={{ color: INK }}>{m.name}</span>
                        <span className="px-1.5 py-0.5 rounded-md text-[10px] font-bold shrink-0" style={{ background: INK, color: PAPER }}>{rank.label}</span>
                        {titles.map(t => (
                            <span key={t} className="px-1 py-0.5 rounded text-[9px] font-bold shrink-0" style={{ background: 'rgba(120,116,108,0.45)', color: '#2a2824' }}>{t}</span>
                        ))}
                        <span className="ml-auto text-[15px] shrink-0">{moodFace(m.mood)}</span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                        <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(176,170,158,0.35)' }}>
                            <div className="h-full rounded-full" style={{ width: `${m.favor}%`, background: INK }} />
                        </div>
                        <span className="text-[10px] tabular-nums shrink-0" style={{ color: INK_SOFT }}>宠 {m.favor}</span>
                    </div>
                </div>
            </PaperCard>
        </button>
    );
};

export default HaremApp;
