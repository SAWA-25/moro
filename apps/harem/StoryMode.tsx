import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useOS } from '../../context/OSContext';
import { resolveAuxApi } from '../../utils/auxApi';
import { llmComplete } from '../../utils/llmComplete';
import {
    StoryState, StoryScene, StoryChar, StorySeed, StoryEnding, EndingDef,
    initStory, buildScenePrompt, parseScene, fallbackScene, applyChoice, applyCustomAction, visitCharacter,
    stageOf, TURN_LABEL, TURN_META, checkEndings, ENDING_DEFS, relationshipSummary,
    buildStoryEndingPrompt, parseStoryEnding, fallbackStoryEnding,
    startNewGamePlus, reviveStory, saveMetaOf, RULER_PRESETS, GENDER_WORD,
    STORY_STYLES, HEAT_LABELS, PACE_OPTIONS, type StorySaveMeta,
    type TimeSlot, type TurnType, type Gender,
} from '../../utils/haremStory';
import {
    PaperBackdrop, ScrapHeader, PaperCard, WashiTape, Polaroid, ScrapButton, StickyNote,
    SectionTag, DashedRule, PaperDialog, PaperSheet, Stamp,
    INK, INK_SOFT, PAPER, PAGE_BG, HALFTONE,
} from '../ui/insScrapKit';
import {
    Crown, Scroll, BookOpen, FloppyDisk, UsersThree, Sparkle, CaretRight, X,
    ArrowClockwise, Heart, ShieldCheck, Drop, Smiley, Brain, MapPin, Trash,
    List, PlusCircle, PaperPlaneRight, PersonSimpleWalk, HeartBreak, ArrowsClockwise, Eye, TextAa,
} from '@phosphor-icons/react';

const LIVE_KEY = 'moro_harem_story';
const SAVES_KEY = 'moro_harem_story_saves';
const MAX_CAST = 6;
const MAX_SLOTS = 12;

type CarryPack = { fromPlaythrough: number; notes: string[] } | null;
interface SaveSlot { id: string; name: string; meta: StorySaveMeta; state: StoryState; }

// 时辰底色（黑白拼贴皮肤：纸墨灰阶，只随时辰微微转深）
const TIME_WASH: Record<TimeSlot, string> = {
    晨: 'radial-gradient(120% 80% at 50% 0%, #f8f5ee 0%, #efeadf 100%)',
    午: 'radial-gradient(120% 80% at 50% 0%, #f6f3ea 0%, #ebe6d9 100%)',
    晚: 'radial-gradient(120% 80% at 50% 0%, #efeadf 0%, #e0dacc 100%)',
    夜: 'radial-gradient(120% 90% at 50% 0%, #e6e1d5 0%, #d4cebf 100%)',
};
const TIME_GLYPH: Record<TimeSlot, string> = { 晨: '🌅', 午: '☀️', 晚: '🌇', 夜: '🌙' };

const eid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const fmtTime = (ts: number) => { const d = new Date(ts); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`; };

const loadSaves = (): SaveSlot[] => { try { const r = localStorage.getItem(SAVES_KEY); const a = r ? JSON.parse(r) : []; return Array.isArray(a) ? a : []; } catch { return []; } };
const writeSaves = (s: SaveSlot[]) => { try { localStorage.setItem(SAVES_KEY, JSON.stringify(s.slice(0, MAX_SLOTS))); } catch { /* ignore */ } };

const RISK_LABEL: Record<string, string> = { low: '稳妥', mid: '微澜', high: '行险' };
const RISK_PIPS: Record<string, number> = { low: 1, mid: 2, high: 3 };

// ════════════════════════════════════════════════════════════════════════════

const StoryMode: React.FC<{ onBack: () => void }> = ({ onBack }) => {
    const { characters, userProfile, apiConfig, auxApiConfig, addToast } = useOS();
    const [loaded, setLoaded] = useState(false);
    const [game, setGame] = useState<StoryState | null>(null);
    const [busy, setBusy] = useState(false);          // 正在请求 AI 剧情
    const [beatIdx, setBeatIdx] = useState(0);        // 当前读到第几「拍」
    const [ending, setEnding] = useState<StoryEnding | null>(null);

    // 开局
    const [picked, setPicked] = useState<Set<string>>(new Set());
    const [pName, setPName] = useState('');
    const [pTitle, setPTitle] = useState('陛下');
    const [pGender, setPGender] = useState<Gender>('male');
    const [charGenders, setCharGenders] = useState<Record<string, Gender>>({});
    // 叙事设定（自由度）
    const [pStyle, setPStyle] = useState('classic');
    const [pHeat, setPHeat] = useState(1);
    const [pPace, setPPace] = useState('mid');
    const [premise, setPremise] = useState('');
    const carryRef = useRef<CarryPack>(null);

    // 进行中：自由行动 / 主动择幸 / 立绘菜单 / 打字机
    const [customText, setCustomText] = useState('');
    const [visitOpen, setVisitOpen] = useState(false);
    const [spriteMenu, setSpriteMenu] = useState<string | null>(null);
    const [typewriter, setTypewriter] = useState(true);
    const [typed, setTyped] = useState(0);

    // 浮层
    const [menu, setMenu] = useState(false);
    const [saveOpen, setSaveOpen] = useState(false);
    const [statusOpen, setStatusOpen] = useState(false);
    const [memoryOpen, setMemoryOpen] = useState(false);
    const [saves, setSaves] = useState<SaveSlot[]>([]);

    const api = useCallback(() => resolveAuxApi(auxApiConfig, apiConfig), [auxApiConfig, apiConfig]);

    // ── 装载 / 持久化 ──────────────────────────────────────────────
    useEffect(() => {
        try { const raw = localStorage.getItem(LIVE_KEY); if (raw) { const s = reviveStory(JSON.parse(raw)); if (s) setGame(s); } } catch { /* ignore */ }
        try { setTypewriter(localStorage.getItem('moro_harem_tw') !== '0'); } catch { /* ignore */ }
        setPName((userProfile?.name || '君').slice(0, 12));
        setLoaded(true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    useEffect(() => { try { localStorage.setItem('moro_harem_tw', typewriter ? '1' : '0'); } catch { /* ignore */ } }, [typewriter]);
    useEffect(() => {
        if (!loaded) return;
        try { if (game) localStorage.setItem(LIVE_KEY, JSON.stringify(game)); else localStorage.removeItem(LIVE_KEY); } catch { /* ignore */ }
    }, [game, loaded]);

    const scene = game?.currentScene || null;

    // 把一场戏拆成「拍」：旁白 + 各句对白（带情绪 / 心声）
    type Beat = { kind: 'narration' | 'dialogue'; speaker?: string; charId?: string; text: string; emotion?: string; inner?: string };
    const beats = useMemo<Beat[]>(() => {
        if (!scene) return [];
        const arr: Beat[] = [];
        if (scene.narration) arr.push({ kind: 'narration', text: scene.narration });
        for (const d of scene.dialogues) arr.push({ kind: 'dialogue', speaker: d.speaker, charId: d.charId, text: d.text, emotion: d.emotion, inner: d.inner });
        if (arr.length === 0) arr.push({ kind: 'narration', text: '……' });
        return arr;
    }, [scene]);
    useEffect(() => { setBeatIdx(0); }, [scene]);
    const allRead = beatIdx >= beats.length - 1;
    const latestText = beats[beatIdx]?.text || '';
    // 打字机：逐字显示当前一拍（可关）
    useEffect(() => {
        if (!typewriter) { setTyped(latestText.length); return; }
        setTyped(0);
        if (!latestText) return;
        let i = 0;
        const id = setInterval(() => { i += 2; setTyped(i); if (i >= latestText.length) clearInterval(id); }, 18);
        return () => clearInterval(id);
    }, [beatIdx, scene, typewriter, latestText]);
    const typingDone = !typewriter || typed >= latestText.length;
    const ready = allRead && typingDone && !busy; // 读完且当前一拍打完、未在请求 → 可做选择

    const lastTap = useRef(0);
    const onBoxTap = () => {
        if (!beats.length) return;
        const now = Date.now();
        if (now - lastTap.current < 300) { setBeatIdx(beats.length - 1); setTyped(99999); lastTap.current = 0; return; } // 双击：全文
        lastTap.current = now;
        if (typewriter && typed < latestText.length) { setTyped(latestText.length); return; } // 首次轻点：先把这拍打完
        setBeatIdx(i => Math.min(beats.length - 1, i + 1)); // 再轻点：推进
    };

    // ── AI 请求 ───────────────────────────────────────────────────
    const requestScene = useCallback(async (st: StoryState, opening = false) => {
        setBusy(true);
        let sc: StoryScene | null = null;
        try {
            const { system, user } = buildScenePrompt(st, { opening });
            const out = await llmComplete(api(), [{ role: 'system', content: system }, { role: 'user', content: user }], { temperature: 0.95, maxTokens: 1700, continueRounds: 1 });
            sc = parseScene(out, st);
        } catch { /* fall through to fallback */ }
        if (!sc) sc = fallbackScene(st);
        setGame(prev => prev ? { ...prev, currentScene: sc } : { ...st, currentScene: sc });
        setBusy(false);
    }, [api]);

    const seedOf = (c: any): StorySeed => ({
        charId: c.id, name: c.convoSettings?.remarkName?.trim() || c.name,
        avatar: c.convoSettings?.charAvatarOverride || c.avatar, affection: c.affection,
        persona: c.systemPrompt as string | undefined,
        gender: charGenders[c.id] || 'unknown',
    });

    const start = () => {
        const chosen = characters.filter(c => picked.has(c.id)).slice(0, MAX_CAST);
        if (chosen.length === 0) { addToast('总得先择一位入宫，故事才好开篇', 'error'); return; }
        const st = initStory(
            chosen.map(seedOf),
            { name: pName.trim() || '君', title: pTitle.trim() || '君上', gender: pGender, persona: userProfile?.bio },
            carryRef.current,
            { style: pStyle, heat: pHeat, pace: pPace, premise: premise.trim() || undefined },
        );
        carryRef.current = null;
        setEnding(null);
        setGame(st);
        requestScene(st, true);
    };

    // 换一种写法：用相同状态重抽这一场（自由度 + 互动）
    const regenerate = () => {
        if (!game || busy) return;
        setSpriteMenu(null);
        requestScene(game, game.history.length === 0);
    };

    // ── 推进：选择 / 自由行动 / 主动择幸 共用 ────────────────────────
    const advance = async (next: StoryState, wasEnding: boolean) => {
        setGame(next);
        if (wasEnding) await resolveEnding(next);
        else requestScene(next, false);
    };
    const choose = (i: number) => {
        if (!game || !scene || busy) return;
        advance(applyChoice(game, scene, i), scene.turnType === 'ending');
    };
    const submitCustom = () => {
        const t = customText.trim();
        if (!game || !scene || busy || !t) return;
        setCustomText('');
        advance(applyCustomAction(game, scene, t), scene.turnType === 'ending');
    };
    const visit = (cid: string) => {
        if (!game || !scene || busy) return;
        setVisitOpen(false);
        advance(visitCharacter(game, scene, cid), scene.turnType === 'ending');
    };

    const resolveEnding = useCallback(async (st: StoryState) => {
        const def: EndingDef = checkEndings(st, false) || ENDING_DEFS[ENDING_DEFS.length - 1];
        setBusy(true);
        let end: StoryEnding | null = null;
        try {
            const { system, user } = buildStoryEndingPrompt(st, def);
            const out = await llmComplete(api(), [{ role: 'system', content: system }, { role: 'user', content: user }], { temperature: 0.92, maxTokens: 800, continueRounds: 1 });
            end = parseStoryEnding(out, def);
        } catch { /* fall through */ }
        if (!end || !end.epilogue) end = fallbackStoryEnding(st, def);
        setEnding(end);
        setBusy(false);
    }, [api]);

    // ── 存档 / 读档 ─────────────────────────────────────────────────
    const openSaves = () => { setSaves(loadSaves()); setMenu(false); setSaveOpen(true); };
    const doSaveNew = () => {
        if (!game) return;
        const slot: SaveSlot = { id: eid(), name: `周目${game.playthrough}·第${game.day}日`, meta: saveMetaOf(game), state: game };
        const next = [slot, ...loadSaves()].slice(0, MAX_SLOTS);
        writeSaves(next); setSaves(next); addToast('已誊抄入册', 'success');
    };
    const doOverwrite = (id: string) => {
        if (!game) return;
        const next = loadSaves().map(s => s.id === id ? { id, name: s.name, meta: saveMetaOf(game), state: game } : s);
        writeSaves(next); setSaves(next); addToast('此页已重写', 'success');
    };
    const doLoad = (slot: SaveSlot) => {
        const s = reviveStory(slot.state); if (!s) { addToast('此页已残破，读取不得', 'error'); return; }
        setGame(s); setEnding(null); setSaveOpen(false); setMenu(false);
        // 读档若停在某场戏，直接展开全文
        setTimeout(() => setBeatIdx(999), 0);
        addToast('翻回了那一页', 'success');
    };
    const doDelete = (id: string) => { const next = loadSaves().filter(s => s.id !== id); writeSaves(next); setSaves(next); };

    // ── 重开 / 多周目 ───────────────────────────────────────────────
    const abandon = () => { setGame(null); setEnding(null); setPicked(new Set()); setMenu(false); carryRef.current = null; };
    const newGamePlus = () => {
        if (!game) return;
        carryRef.current = startNewGamePlus(game, [], game.player).carry; // 仅取 carry，角色稍后重选
        setGame(null); setEnding(null); setPicked(new Set()); setMenu(false);
        addToast('一梦醒来，又是新的一世。请重择良人', 'success');
    };

    const champion = useMemo(() => game ? Object.values(game.characters).sort((a, b) => b.affection - a.affection)[0] : null, [game]);

    if (!loaded) return <div className="h-full w-full" style={{ background: PAGE_BG }} />;

    // ───────────────────────────────── 开局 ─────────────────────────────────
    if (!game) {
        return (
            <div className="relative h-full w-full flex flex-col overflow-hidden animate-fade-in" style={{ color: INK, background: PAGE_BG }}>
                <PaperBackdrop />
                <ScrapHeader title="椒房记 · 文游" en="A HAREM TALE" onBack={onBack} />
                <div className="relative z-10 flex-1 overflow-y-auto no-scrollbar px-4 pb-3">
                    <div className="relative px-5 py-4 mb-4 text-center overflow-hidden" style={openPanel}>
                        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.07]" style={{ backgroundImage: HALFTONE, backgroundSize: '7px 7px' }} />
                        <WashiTape color="ink" rotate={-4} className="absolute -top-2.5 left-1/2 -translate-x-1/2 w-24 h-5 rounded-[2px]" />
                        <BookOpen size={32} weight="fill" className="relative mx-auto mb-2" style={{ color: INK }} />
                        <p className="relative text-[13px] leading-relaxed" style={{ color: '#48443c' }}>
                            一卷由 AI 现写的后宫恋爱文字游戏。<br />你的每一次抉择都改写好感、信任、嫉妒与人心；剧情顺着你而长，绝不重来同一段。
                        </p>
                        {carryRef.current && (
                            <StickyNote color="butter" rotate={-1} className="relative mt-3 px-3 py-2 text-[11px] text-left">
                                <span className="font-bold">前尘旧梦（第 {carryRef.current.fromPlaythrough} 周目）：</span>{carryRef.current.notes.slice(0, 3).join('；')}
                            </StickyNote>
                        )}
                    </div>

                    {/* 玩家身份 + 性别（支持女帝男妃等任意组合） */}
                    <SectionTag en="WHO ARE YOU" className="mb-2">君之身份</SectionTag>
                    <div className="flex gap-1.5 mb-2 flex-wrap">
                        {RULER_PRESETS.map(p => {
                            const on = pGender === p.gender && pTitle === p.title;
                            return (
                                <button key={p.key} onClick={() => { setPGender(p.gender); setPTitle(p.title); }} title={p.hint}
                                    className="px-2.5 py-1.5 rounded-full text-[12px] font-bold active:scale-95 transition-transform"
                                    style={on ? { background: INK, color: PAPER } : { background: 'rgba(255,253,247,0.8)', color: INK, border: '1px solid rgba(176,170,158,0.7)' }}>
                                    {p.label}
                                </button>
                            );
                        })}
                    </div>
                    <div className="flex gap-2 mb-1.5">
                        <input value={pName} onChange={e => setPName(e.target.value.slice(0, 12))} placeholder="名讳" className="flex-1 min-w-0 px-3 py-2 text-[14px] rounded-lg outline-none" style={inputStyle} />
                        <input value={pTitle} onChange={e => setPTitle(e.target.value.slice(0, 6))} placeholder="称谓" className="w-20 px-3 py-2 text-[14px] rounded-lg outline-none" style={inputStyle} />
                        <GenderCycle value={pGender} onChange={setPGender} />
                    </div>
                    <p className="text-[10.5px] mb-4" style={{ color: INK_SOFT }}>你与每位的性别都可自由设定——男帝女妃、女帝男妃、同性、混合，皆可。</p>

                    {/* 叙事设定（自由度：风格 / 尺度 / 节奏 / 开场设定） */}
                    <SectionTag en="HOW IT'S TOLD" className="mb-2">叙事设定</SectionTag>
                    <div className="mb-2">
                        <div className="text-[11px] mb-1" style={{ color: INK_SOFT }}>风格</div>
                        <div className="flex gap-1.5 flex-wrap">
                            {STORY_STYLES.map(st => (
                                <button key={st.key} onClick={() => setPStyle(st.key)} title={st.hint}
                                    className="px-2.5 py-1.5 rounded-full text-[12px] font-bold active:scale-95 transition-transform"
                                    style={pStyle === st.key ? { background: INK, color: PAPER } : { background: 'rgba(255,253,247,0.8)', color: INK, border: '1px solid rgba(176,170,158,0.7)' }}>
                                    {st.label}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="mb-2 flex items-center gap-3">
                        <div className="flex-1">
                            <div className="text-[11px] mb-1 flex items-center justify-between" style={{ color: INK_SOFT }}><span>尺度</span><span className="font-bold" style={{ color: INK }}>{HEAT_LABELS[pHeat]}</span></div>
                            <input type="range" min={0} max={3} step={1} value={pHeat} onChange={e => setPHeat(+e.target.value)} className="w-full accent-black" style={{ accentColor: INK }} />
                        </div>
                        <div>
                            <div className="text-[11px] mb-1" style={{ color: INK_SOFT }}>节奏</div>
                            <div className="flex gap-1">
                                {PACE_OPTIONS.map(p => (
                                    <button key={p.key} onClick={() => setPPace(p.key)} title={p.hint}
                                        className="px-2 py-1.5 rounded-lg text-[11px] font-bold active:scale-95 transition-transform"
                                        style={pPace === p.key ? { background: INK, color: PAPER } : { background: 'rgba(255,253,247,0.8)', color: INK, border: '1px solid rgba(176,170,158,0.7)' }}>
                                        {p.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                    <textarea value={premise} onChange={e => setPremise(e.target.value.slice(0, 300))} placeholder="开场设定 / 世界观（选填）：例「架空王朝，你是新登基的女帝，后宫尚需收服人心…」"
                        rows={2} className="w-full px-3 py-2 text-[12.5px] rounded-lg outline-none resize-none mb-4" style={inputStyle} />

                    {characters.length === 0 ? (
                        <StickyNote color="butter" rotate={-1.5} className="px-5 py-8 text-center">
                            <span className="text-[13px] font-bold" style={{ color: '#5b554b' }}>通讯录空空，尚无良人可供采选</span>
                        </StickyNote>
                    ) : (
                        <>
                            <SectionTag en={`PICK 1–${MAX_CAST}`} className="mb-3">择 1–{MAX_CAST} 位入宫 · 已选 {picked.size}</SectionTag>
                            <div className="grid grid-cols-3 gap-3">
                                {characters.map((c, i) => {
                                    const on = picked.has(c.id);
                                    const full = !on && picked.size >= MAX_CAST;
                                    return (
                                        <div key={c.id} className={`flex flex-col items-center ${full ? 'opacity-30' : ''}`}>
                                            <Polaroid src={c.convoSettings?.charAvatarOverride || c.avatar} caption={c.convoSettings?.remarkName?.trim() || c.name} selected={on} rotate={i % 2 === 0 ? -2 : 2} size={56}
                                                onClick={full ? undefined : () => setPicked(p => { const n = new Set(p); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; })} />
                                        </div>
                                    );
                                })}
                            </div>
                            {/* 入选名单 · 逐位设定性别 */}
                            {picked.size > 0 && (
                                <div className="mt-4">
                                    <SectionTag en="THEIR GENDER" className="mb-2">入选诸位 · 各自性别</SectionTag>
                                    <div className="space-y-1.5">
                                        {characters.filter(c => picked.has(c.id)).map(c => (
                                            <div key={c.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl" style={{ background: 'rgba(255,253,247,0.75)', border: '1px solid rgba(176,170,158,0.6)' }}>
                                                <img src={c.convoSettings?.charAvatarOverride || c.avatar} className="w-7 h-7 rounded-full object-cover shrink-0" />
                                                <span className="text-[13px] font-bold flex-1 min-w-0 truncate" style={{ color: INK }}>{c.convoSettings?.remarkName?.trim() || c.name}</span>
                                                <GenderCycle value={charGenders[c.id] || 'unknown'} onChange={g => setCharGenders(m => ({ ...m, [c.id]: g }))} />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                    <div className="h-3" />
                </div>
                <div className="relative z-10 shrink-0 p-4 pb-safe">
                    <ScrapButton variant="ink" onClick={start} disabled={picked.size === 0} className="w-full py-3.5 text-[15px]" icon={<Sparkle size={16} weight="fill" />}>
                        开篇 · 入宫
                    </ScrapButton>
                </div>
            </div>
        );
    }

    // ───────────────────────────────── 游戏进行 ─────────────────────────────────
    const tm = TURN_META[scene?.turnType || game.turnType];
    const activeChars = game.activeCharacters.map(id => game.characters[id]).filter(Boolean) as StoryChar[];
    const curBeat = beats[beatIdx];
    const speakingId = curBeat?.kind === 'dialogue' ? curBeat.charId : undefined;

    return (
        <div className="relative h-full w-full flex flex-col overflow-hidden animate-fade-in" style={{ color: INK, background: TIME_WASH[game.time] }}>
            <PaperBackdrop corners={false} />

            {/* ① 顶部状态栏 */}
            <div className="relative z-20 shrink-0 flex items-center px-3 pt-3 pb-1.5">
                <button onClick={onBack} className="p-2 -ml-1 active:scale-90 transition-transform" style={{ color: INK_SOFT }} title="返回"><CaretRight size={18} weight="bold" className="rotate-180" /></button>
                <div className="flex-1 flex items-center justify-center gap-2 text-[12px] font-bold" style={{ color: INK }}>
                    <span className="px-2 py-0.5 rounded-full" style={{ background: INK, color: PAPER }}>第 {game.day} 日</span>
                    <span className="flex items-center gap-1">{TIME_GLYPH[game.time]} {game.time}</span>
                    <span className="flex items-center gap-0.5" style={{ color: INK_SOFT }}><MapPin size={12} weight="fill" />{game.location}</span>
                </div>
                <button onClick={() => setMenu(true)} className="p-2 -mr-1 active:scale-90 transition-transform" style={{ color: INK }} title="菜单"><List size={20} weight="bold" /></button>
            </div>
            {/* 在场角色关系小条 + 氛围 + 换写 */}
            <div className="relative z-20 shrink-0 px-3 pb-1 flex items-center gap-1.5 flex-wrap">
                <span className="px-2 py-0.5 rounded-md text-[10px] font-black" style={{ background: 'rgba(31,29,26,0.08)', border: '1px dashed rgba(150,144,132,0.6)', color: INK }}>{tm.label}回合</span>
                {scene?.mood && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: INK, color: PAPER }}>{scene.mood}</span>}
                {activeChars.map(c => (
                    <span key={c.charId} className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px]" style={{ background: 'rgba(255,253,247,0.7)', border: '1px solid rgba(176,170,158,0.6)' }}>
                        {game.route.charId === c.charId && <Crown size={10} weight="fill" style={{ color: INK }} />}
                        <span className="font-bold" style={{ color: INK }}>{c.name}</span>
                        <span style={{ color: INK_SOFT }}>{stageOf(c.affection).label}</span>
                    </span>
                ))}
                {scene && !busy && (
                    <button onClick={regenerate} className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold active:scale-95 transition-transform" style={{ background: 'rgba(255,253,247,0.7)', border: '1px solid rgba(176,170,158,0.6)', color: INK }} title="对这一场不满意？换一种写法">
                        <ArrowsClockwise size={11} weight="bold" />换种写法
                    </button>
                )}
            </div>

            {/* ②③ 背景 + 立绘区 */}
            <div className="relative z-10 flex-1 min-h-0 flex items-end justify-center px-4 pb-1 overflow-hidden">
                <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.05]" style={{ backgroundImage: HALFTONE, backgroundSize: '8px 8px' }} />
                <span aria-hidden className="absolute top-2 right-4 text-[64px] leading-none opacity-[0.08] select-none">{TIME_GLYPH[game.time]}</span>
                <div className="relative flex items-end justify-center gap-3">
                    {activeChars.length === 0 && <span className="text-[13px] mb-6" style={{ color: INK_SOFT }}>{game.location}，此刻无人相伴。</span>}
                    {activeChars.map((c, i) => {
                        const speaking = speakingId === c.charId;
                        const emo = speaking ? curBeat?.emotion : undefined;
                        return (
                            <button key={c.charId} onClick={() => setSpriteMenu(c.charId)} className="flex flex-col items-center transition-all active:scale-95" style={{ opacity: speakingId && !speaking ? 0.5 : 1, transform: speaking ? 'translateY(-4px)' : 'none' }} title="点查看状态 / 主动去见">
                                <div className="relative">
                                    {c.avatar
                                        ? <img src={c.avatar} className="object-cover rounded-2xl" style={{ width: activeChars.length >= 3 ? 76 : 96, height: activeChars.length >= 3 ? 100 : 128, border: `2px solid ${speaking ? INK : 'rgba(176,170,158,0.7)'}`, boxShadow: speaking ? '0 10px 22px -10px rgba(31,29,26,0.55)' : '0 8px 18px -12px rgba(31,29,26,0.4)' }} />
                                        : <div className="rounded-2xl flex items-center justify-center text-[28px]" style={{ width: 86, height: 116, background: 'rgba(176,170,158,0.25)', border: '2px solid rgba(176,170,158,0.7)' }}>🎐</div>}
                                    {speaking && <WashiTape color="butter" rotate={-6} className="absolute -top-2 -left-2 w-9 h-3.5 rounded-[2px]" />}
                                    {emo && <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded-full text-[9px] font-bold whitespace-nowrap" style={{ background: INK, color: PAPER }}>{emo}</span>}
                                    {c.estranged && <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center" style={{ background: '#6b655a', color: PAPER }}><HeartBreak size={11} weight="fill" /></span>}
                                </div>
                                <span className="mt-1 text-[11px] font-bold" style={{ color: speaking ? INK : INK_SOFT }}>{c.name}</span>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* ④⑤ 对话框 + 名框 + ⑥ 选项 */}
            <div className="relative z-10 shrink-0 px-3 pt-1 pb-safe">
                {/* 名框 */}
                {curBeat?.kind === 'dialogue' && curBeat.speaker && (
                    <div className="inline-flex items-center gap-1.5 px-3 py-1 ml-1 rounded-t-lg text-[13px] font-black" style={{ background: INK, color: PAPER }}>
                        {curBeat.speaker}
                        {curBeat.emotion && <span className="text-[10px] font-normal" style={{ color: 'rgba(246,243,236,0.8)' }}>· {curBeat.emotion}</span>}
                    </div>
                )}
                {/* 对话框（点击推进 / 双击全文） */}
                <div onClick={onBoxTap} className="relative rounded-2xl overflow-hidden cursor-pointer select-none" style={dialogueBox}>
                    <WashiTape color="ink" rotate={-2} className="absolute -top-1.5 right-6 w-12 h-3.5 rounded-[2px] opacity-80" />
                    <div className="px-4 py-3 overflow-y-auto no-scrollbar" style={{ maxHeight: '34vh', minHeight: 96 }}>
                        {busy && !scene ? (
                            <div className="flex items-center gap-2 text-[13px] py-6 justify-center" style={{ color: INK_SOFT }}>
                                <Sparkle size={16} weight="fill" className="animate-pulse" />执笔铺陈剧情中…
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {beats.slice(0, beatIdx + 1).map((b, i) => {
                                    const latest = i === beatIdx;
                                    const shown = latest && typewriter ? b.text.slice(0, typed) : b.text;
                                    const revealed = !latest || typingDone; // 心声在该拍读完后才浮现
                                    return b.kind === 'narration' ? (
                                        <p key={i} className={`text-[13.5px] leading-relaxed ${latest ? 'animate-fade-in' : ''}`} style={{ color: latest ? '#3a362f' : 'rgba(58,54,47,0.5)', fontStyle: 'italic' }}>{shown}</p>
                                    ) : (
                                        <div key={i}>
                                            <p className={`text-[14.5px] leading-relaxed ${latest ? 'animate-fade-in' : ''}`} style={{ color: latest ? INK : 'rgba(31,29,26,0.45)' }}>
                                                {!latest && <span className="text-[11px] font-bold mr-1" style={{ color: INK_SOFT }}>{b.speaker}：</span>}{shown}
                                            </p>
                                            {b.inner && revealed && (
                                                <p className="text-[11.5px] leading-snug mt-0.5 pl-2 flex items-start gap-1" style={{ color: 'rgba(108,101,90,0.85)', borderLeft: '2px dashed rgba(150,144,132,0.5)', fontStyle: 'italic' }}>
                                                    <Eye size={11} weight="fill" className="mt-0.5 shrink-0" /><span>心声：{b.inner}</span>
                                                </p>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                    {!busy && (!allRead || !typingDone) && (
                        <div className="absolute bottom-1.5 right-3 flex items-center gap-1 text-[10px] animate-pulse" style={{ color: INK_SOFT }}>
                            轻点{typingDone ? '继续' : '加速'} · 双击全文 <CaretRight size={11} weight="bold" />
                        </div>
                    )}
                </div>

                {/* ⑥ 选项按钮（读完才出现） */}
                <div className="mt-2 space-y-2" style={{ minHeight: 4 }}>
                    {scene && ready && scene.choices.map((ch, i) => {
                        const summary = ch.effects.map(e => {
                            const nm = game.characters[e.charId]?.name || '?';
                            const tags: string[] = [];
                            if (e.affection) tags.push(`好感${e.affection > 0 ? '↑' : '↓'}`);
                            if (e.trust) tags.push(`信任${e.trust > 0 ? '↑' : '↓'}`);
                            if (e.jealousy) tags.push(`嫉妒${e.jealousy > 0 ? '↑' : '↓'}`);
                            if (e.mood) tags.push(`心情${e.mood > 0 ? '↑' : '↓'}`);
                            return tags.length ? `${nm}·${tags.join(' ')}` : '';
                        }).filter(Boolean).join('　');
                        return (
                            <button key={i} onClick={() => choose(i)} className="w-full text-left active:scale-[0.98] transition-transform">
                                <PaperCard tilt={i % 2 === 0 ? -0.4 : 0.4} className="px-3.5 py-2.5">
                                    <div className="flex items-start gap-2">
                                        <span className="shrink-0 mt-0.5 w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-black" style={{ background: INK, color: PAPER }}>{i + 1}</span>
                                        <div className="min-w-0 flex-1">
                                            <div className="text-[14px] font-bold leading-snug" style={{ color: INK }}>{ch.text}</div>
                                            <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                                                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold" style={{ background: 'rgba(31,29,26,0.08)', color: INK }}>{ch.tone}</span>
                                                <span className="flex items-center gap-0.5 text-[9px]" style={{ color: INK_SOFT }} title={`风险：${RISK_LABEL[ch.risk]}`}>
                                                    {Array.from({ length: 3 }).map((_, k) => <span key={k} className="w-1.5 h-1.5 rounded-full" style={{ background: k < RISK_PIPS[ch.risk] ? INK : 'rgba(150,144,132,0.35)' }} />)}
                                                    <span className="ml-0.5">{RISK_LABEL[ch.risk]}</span>
                                                </span>
                                                {summary && <span className="text-[9.5px]" style={{ color: INK_SOFT }}>{summary}</span>}
                                            </div>
                                        </div>
                                    </div>
                                </PaperCard>
                            </button>
                        );
                    })}
                    {/* 自由行动 + 主动择幸（丰富玩法：不止 3 选项，可自陈心意 / 指定去见谁） */}
                    {scene && ready && (
                        <div className="pt-0.5">
                            <div className="flex items-center gap-1.5">
                                <input value={customText} onChange={e => setCustomText(e.target.value.slice(0, 120))} onKeyDown={e => { if (e.key === 'Enter') submitCustom(); }}
                                    placeholder="或…自陈心意（自由行动）" className="flex-1 min-w-0 px-3 py-2 text-[12.5px] rounded-full outline-none" style={inputStyle} />
                                <button onClick={submitCustom} disabled={!customText.trim()} className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center active:scale-95 transition-transform disabled:opacity-40" style={{ background: INK, color: PAPER }} title="付诸行动">
                                    <PaperPlaneRight size={16} weight="fill" />
                                </button>
                            </div>
                            <div className="flex items-center gap-2 mt-1.5 px-1">
                                <button onClick={() => setVisitOpen(true)} className="flex items-center gap-1 text-[11px] font-bold active:scale-95 transition-transform" style={{ color: INK }}>
                                    <PersonSimpleWalk size={13} weight="bold" />主动去见…
                                </button>
                                {scene.effectsPreview && <span className="ml-auto text-[10px] truncate" style={{ color: INK_SOFT }}>{scene.effectsPreview}</span>}
                            </div>
                        </div>
                    )}
                    {busy && scene && (
                        <div className="flex items-center gap-2 text-[12px] py-2 justify-center" style={{ color: INK_SOFT }}><Sparkle size={14} weight="fill" className="animate-pulse" />剧情顺着你的心意往下走…</div>
                    )}
                </div>
            </div>

            {/* 主动择幸 · 选要见谁 */}
            <PaperSheet open={visitOpen} onClose={() => setVisitOpen(false)} tape="butter" title="主动去见 · 择幸">
                <p className="text-[11px] mb-2" style={{ color: INK_SOFT }}>挑一位，下一场便去与 ta 独处。</p>
                <div className="max-h-[46vh] overflow-y-auto no-scrollbar space-y-1.5">
                    {Object.values(game.characters).sort((a, b) => b.affection - a.affection).map(c => (
                        <button key={c.charId} onClick={() => visit(c.charId)} className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl active:scale-[0.98] transition-transform" style={{ background: 'rgba(255,253,247,0.85)', border: '1px solid rgba(176,170,158,0.6)' }}>
                            <img src={c.avatar} className="w-9 h-9 rounded-full object-cover shrink-0" />
                            <div className="flex-1 min-w-0 text-left">
                                <div className="text-[13px] font-bold truncate" style={{ color: INK }}>{c.name}{c.estranged && <span className="ml-1 text-[10px]" style={{ color: INK_SOFT }}>· 离心</span>}</div>
                                <div className="text-[10px]" style={{ color: INK_SOFT }}>{stageOf(c.affection).label} · 好感 {c.affection} · {c.attitude}</div>
                            </div>
                            <PersonSimpleWalk size={16} weight="bold" style={{ color: INK_SOFT }} />
                        </button>
                    ))}
                </div>
            </PaperSheet>

            {/* ⑦ 菜单 */}
            <PaperSheet open={menu} onClose={() => setMenu(false)} tape="ink" title="掌事菜单">
                <div className="grid grid-cols-2 gap-2">
                    <MenuBtn icon={<FloppyDisk size={18} weight="fill" />} label="存档 · 读档" onClick={openSaves} />
                    <MenuBtn icon={<UsersThree size={18} weight="fill" />} label="后宫诸位" onClick={() => { setMenu(false); setStatusOpen(true); }} />
                    <MenuBtn icon={<Brain size={18} weight="fill" />} label="记忆回顾" onClick={() => { setMenu(false); setMemoryOpen(true); }} />
                    <MenuBtn icon={<Scroll size={18} weight="fill" />} label="收束 · 判结局" onClick={() => { setMenu(false); if (game) resolveEnding(game); }} />
                    <MenuBtn icon={<ArrowClockwise size={18} weight="fill" />} label="另起新局" onClick={abandon} />
                    <MenuBtn icon={<CaretRight size={18} weight="bold" className="rotate-180" />} label="退出椒房记" onClick={onBack} />
                </div>
                <button onClick={() => setTypewriter(t => !t)} className="w-full mt-2 flex items-center gap-2 px-3 py-2.5 rounded-xl active:scale-[0.98] transition-transform" style={{ background: 'rgba(255,253,247,0.85)', border: '1px solid rgba(176,170,158,0.7)', color: INK }}>
                    <TextAa size={18} weight="fill" />
                    <span className="text-[13px] font-bold">逐字显示（打字机）</span>
                    <span className="ml-auto px-2 py-0.5 rounded-full text-[11px] font-bold" style={typewriter ? { background: INK, color: PAPER } : { background: 'rgba(31,29,26,0.08)', color: INK_SOFT }}>{typewriter ? '开' : '关'}</span>
                </button>
                {champion && <p className="text-center text-[11px] mt-3" style={{ color: INK_SOFT }}>当前最得君心：<span className="font-bold" style={{ color: INK }}>{champion.name}</span>（好感 {champion.affection}）{game.route.locked ? ' · 已定情' : ''}</p>}
            </PaperSheet>

            {/* ⑧ 存档读档 */}
            <PaperSheet open={saveOpen} onClose={() => setSaveOpen(false)} tape="amber" title="册页 · 存档读档">
                <ScrapButton variant="ink" onClick={doSaveNew} className="w-full py-2.5 text-[13px] mb-3" icon={<PlusCircle size={15} weight="fill" />}>誊抄当前 · 新存一页</ScrapButton>
                <div className="max-h-[44vh] overflow-y-auto no-scrollbar space-y-2">
                    {saves.length === 0 && <div className="text-center py-6 text-[12px]" style={{ color: INK_SOFT }}>尚无册页。点上方誊抄一页。</div>}
                    {saves.map(s => (
                        <PaperCard key={s.id} className="px-3 py-2.5">
                            <div className="flex items-center gap-2">
                                <div className="flex-1 min-w-0">
                                    <div className="text-[13px] font-bold truncate" style={{ color: INK }}>{s.name}</div>
                                    <div className="text-[10px] mt-0.5" style={{ color: INK_SOFT }}>
                                        周目{s.meta.playthrough} · 第{s.meta.day}日{s.meta.time} · 第{s.meta.turn}幕 · 君心属{s.meta.topName}{s.meta.routeName ? ` · 定情${s.meta.routeName}` : ''}
                                    </div>
                                    <div className="text-[9px] mt-0.5" style={{ color: INK_SOFT }}>{fmtTime(s.meta.ts)}</div>
                                </div>
                                <div className="flex flex-col gap-1 shrink-0">
                                    <button onClick={() => doLoad(s)} className="px-2.5 py-1 rounded-full text-[11px] font-bold" style={{ background: INK, color: PAPER }}>读取</button>
                                    <div className="flex gap-1">
                                        <button onClick={() => doOverwrite(s.id)} className="px-2 py-1 rounded-full text-[10px]" style={{ background: 'rgba(31,29,26,0.08)', color: INK }} title="覆盖">写覆</button>
                                        <button onClick={() => doDelete(s.id)} className="px-2 py-1 rounded-full text-[10px]" style={{ background: 'rgba(31,29,26,0.05)', color: INK_SOFT }} title="删除"><Trash size={12} weight="bold" /></button>
                                    </div>
                                </div>
                            </div>
                        </PaperCard>
                    ))}
                </div>
            </PaperSheet>

            {/* ⑨ 后宫状态 */}
            <PaperSheet open={statusOpen} onClose={() => setStatusOpen(false)} tape="ink" title="后宫诸位 · 心迹">
                <div className="max-h-[60vh] overflow-y-auto no-scrollbar space-y-2.5">
                    {Object.values(game.characters).sort((a, b) => b.affection - a.affection).map(c => (
                        <CharStatusCard key={c.charId} c={c} routed={game.route.charId === c.charId} />
                    ))}
                    {(() => { const rels = relationshipSummary(game); return rels.length ? (
                        <div className="pt-1">
                            <SectionTag en="AMONG THEM" className="mb-1.5">她/他们之间</SectionTag>
                            <div className="space-y-1">
                                {rels.map((r, i) => <div key={i} className="text-[11.5px] px-2.5 py-1 rounded-lg" style={{ background: 'rgba(232,228,217,0.5)', color: '#4a463f' }}>{r}</div>)}
                            </div>
                        </div>
                    ) : null; })()}
                </div>
            </PaperSheet>

            {/* 点立绘 · 角色速览 + 快捷行动 */}
            <PaperDialog open={!!spriteMenu} onClose={() => setSpriteMenu(null)} en="AT A GLANCE" maxWidth={300}>
                {spriteMenu && game.characters[spriteMenu] && (() => { const c = game.characters[spriteMenu]; return (
                    <div>
                        <div className="flex items-center gap-2.5 mb-3">
                            <img src={c.avatar} className="w-12 h-12 rounded-full object-cover shrink-0" style={{ border: '1px solid rgba(176,170,158,0.7)' }} />
                            <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                    <span className="text-[15px] font-black truncate" style={{ color: INK }}>{c.name}</span>
                                    {c.gender !== 'unknown' && <span className="text-[11px]" style={{ color: INK_SOFT }}>{GENDER_GLYPH[c.gender].g}</span>}
                                    {game.route.charId === c.charId && <Crown size={12} weight="fill" style={{ color: INK }} />}
                                </div>
                                <div className="text-[11px]" style={{ color: INK_SOFT }}>{stageOf(c.affection).label} · 态度「{c.attitude}」{c.estranged ? ' · 离心' : ''}</div>
                            </div>
                        </div>
                        <div className="space-y-1 mb-3">
                            <VarBar icon={<Heart size={10} weight="fill" />} label="好感" value={c.affection} />
                            <VarBar icon={<ShieldCheck size={10} weight="fill" />} label="信任" value={c.trust} />
                            <VarBar icon={<Drop size={10} weight="fill" />} label="嫉妒" value={c.jealousy} danger />
                            <VarBar icon={<Smiley size={10} weight="fill" />} label="心情" value={c.mood} />
                        </div>
                        <div className="flex gap-2">
                            <ScrapButton variant="paper" onClick={() => { setSpriteMenu(null); setStatusOpen(true); }} className="flex-1 py-2 text-[12px]" icon={<UsersThree size={13} weight="fill" />}>详看全部</ScrapButton>
                            <ScrapButton variant="ink" onClick={() => { const id = c.charId; setSpriteMenu(null); visit(id); }} className="flex-1 py-2 text-[12px]" icon={<PersonSimpleWalk size={13} weight="bold" />}>去见 ta</ScrapButton>
                        </div>
                    </div>
                ); })()}
            </PaperDialog>

            {/* ⑩ 记忆回顾 */}
            <MemoryReview open={memoryOpen} onClose={() => setMemoryOpen(false)} game={game} />

            {/* 结局 */}
            <PaperDialog open={!!ending} onClose={() => setEnding(null)} en="THE FINALE" maxWidth={350}>
                {ending && (
                    <div className="max-h-[64vh] overflow-y-auto no-scrollbar">
                        <div className="text-center mb-3">
                            <Stamp color={ending.tone === 'bad' ? 'ink' : 'butter'} size={44} className="mx-auto mb-2"><Crown size={22} weight="fill" /></Stamp>
                            <div className="text-[10px] tracking-[0.3em] uppercase" style={{ color: INK_SOFT }}>{ending.tone === 'true' ? 'TRUE END' : ending.tone === 'harem' ? 'HAREM END' : ending.tone === 'bad' ? 'BAD END' : 'OPEN END'}</div>
                            <div className="text-[18px] font-black tracking-wide mt-0.5" style={{ fontFamily: 'var(--font-display)', color: INK }}>{ending.title}</div>
                        </div>
                        <p className="text-[13.5px] leading-loose text-justify mb-4" style={{ textIndent: '2em', color: '#3a362f' }}>{ending.epilogue}</p>
                        {ending.fates.length > 0 && (
                            <>
                                <DashedRule className="mb-3" />
                                <div className="space-y-1.5 mb-2">
                                    {ending.fates.map((f, i) => (
                                        <div key={i} className="text-[12.5px] leading-relaxed" style={{ color: '#48443c' }}><span className="font-black" style={{ color: INK }}>{f.name}</span>　{f.line}</div>
                                    ))}
                                </div>
                            </>
                        )}
                        <div className="flex gap-2 mt-5">
                            <ScrapButton variant="paper" onClick={() => setEnding(null)} className="flex-1 py-2.5 text-[12px]">回到此刻</ScrapButton>
                            <ScrapButton variant="paper" onClick={abandon} className="flex-1 py-2.5 text-[12px]">另起新局</ScrapButton>
                            <ScrapButton variant="ink" onClick={newGamePlus} className="flex-1 py-2.5 text-[12px]" icon={<Sparkle size={13} weight="fill" />}>下一周目</ScrapButton>
                        </div>
                    </div>
                )}
            </PaperDialog>
        </div>
    );
};

// ── 小组件 ───────────────────────────────────────────────────────────────────

const GENDER_GLYPH: Record<Gender, { g: string; label: string }> = { male: { g: '♂', label: '男' }, female: { g: '♀', label: '女' }, unknown: { g: '?', label: '未定' } };
const GENDER_ORDER: Gender[] = ['unknown', 'male', 'female'];
const GenderCycle: React.FC<{ value: Gender; onChange: (g: Gender) => void }> = ({ value, onChange }) => {
    const m = GENDER_GLYPH[value];
    return (
        <button onClick={() => onChange(GENDER_ORDER[(GENDER_ORDER.indexOf(value) + 1) % GENDER_ORDER.length])}
            className="shrink-0 px-2.5 py-2 rounded-lg text-[12.5px] font-black active:scale-95 transition-transform"
            style={value === 'unknown' ? { background: 'rgba(31,29,26,0.06)', color: INK_SOFT, border: '1px solid rgba(176,170,158,0.6)' } : { background: INK, color: PAPER }}
            title="点按切换性别">
            {m.g} {m.label}
        </button>
    );
};

const MenuBtn: React.FC<{ icon: React.ReactNode; label: string; onClick: () => void }> = ({ icon, label, onClick }) => (
    <button onClick={onClick} className="flex items-center gap-2 px-3 py-3 rounded-xl active:scale-[0.97] transition-transform" style={{ background: 'rgba(255,253,247,0.85)', border: '1px solid rgba(176,170,158,0.7)', color: INK }}>
        <span style={{ color: INK }}>{icon}</span>
        <span className="text-[13px] font-bold">{label}</span>
    </button>
);

const VarBar: React.FC<{ icon: React.ReactNode; label: string; value: number; danger?: boolean }> = ({ icon, label, value, danger }) => (
    <div className="flex items-center gap-1.5">
        <span className="flex items-center gap-0.5 text-[10px] w-12 shrink-0" style={{ color: INK_SOFT }}>{icon}{label}</span>
        <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(176,170,158,0.3)' }}>
            <div className="h-full rounded-full" style={{ width: `${value}%`, background: danger && value >= 60 ? '#6b655a' : INK, opacity: danger ? 0.75 : 1 }} />
        </div>
        <span className="text-[10px] tabular-nums w-6 text-right shrink-0" style={{ color: INK_SOFT }}>{value}</span>
    </div>
);

const CharStatusCard: React.FC<{ c: StoryChar; routed: boolean }> = ({ c, routed }) => {
    const [open, setOpen] = useState(false);
    return (
        <PaperCard className="px-3 py-2.5">
            <div className="flex items-center gap-2.5">
                {c.avatar ? <img src={c.avatar} className="w-11 h-11 rounded-full object-cover shrink-0" style={{ border: '1px solid rgba(176,170,158,0.7)' }} /> : <span className="w-11 h-11 rounded-full shrink-0 flex items-center justify-center text-[18px]" style={{ background: 'rgba(176,170,158,0.25)' }}>🎐</span>}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[14px] font-bold truncate" style={{ color: INK }}>{c.name}</span>
                        {c.gender !== 'unknown' && <span className="text-[11px]" style={{ color: INK_SOFT }} title={GENDER_GLYPH[c.gender].label}>{GENDER_GLYPH[c.gender].g}</span>}
                        {routed && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold flex items-center gap-0.5" style={{ background: INK, color: PAPER }}><Crown size={9} weight="fill" />定情</span>}
                        {c.estranged && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold flex items-center gap-0.5" style={{ background: '#6b655a', color: PAPER }}><HeartBreak size={9} weight="fill" />离心</span>}
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold" style={{ background: 'rgba(31,29,26,0.08)', color: INK }}>{stageOf(c.affection).label}</span>
                    </div>
                    <div className="text-[10px] mt-0.5" style={{ color: INK_SOFT }}>态度「{c.attitude}」{c.presentStreak >= 3 ? ` · 已${c.presentStreak}幕未见` : ''}</div>
                </div>
            </div>
            <div className="mt-2 space-y-1">
                <VarBar icon={<Heart size={10} weight="fill" />} label="好感" value={c.affection} />
                <VarBar icon={<ShieldCheck size={10} weight="fill" />} label="信任" value={c.trust} />
                <VarBar icon={<Drop size={10} weight="fill" />} label="嫉妒" value={c.jealousy} danger />
                <VarBar icon={<Smiley size={10} weight="fill" />} label="心情" value={c.mood} />
            </div>
            {c.memories.length > 0 && (
                <button onClick={() => setOpen(o => !o)} className="mt-2 text-[10px] flex items-center gap-1" style={{ color: INK_SOFT }}>
                    <Brain size={11} weight="fill" />ta 的记忆 {c.memories.length} 条 <CaretRight size={9} weight="bold" className={open ? 'rotate-90 transition-transform' : 'transition-transform'} />
                </button>
            )}
            {open && (
                <div className="mt-1.5 pl-2 space-y-1" style={{ borderLeft: '2px dashed rgba(150,144,132,0.5)' }}>
                    {c.memories.slice(0, 8).map(m => <div key={m.id} className="text-[11px] leading-snug" style={{ color: '#4a463f' }}>· {m.text}</div>)}
                </div>
            )}
        </PaperCard>
    );
};

const MEM_KIND_LABEL: Record<string, string> = { event: '事', promise: '诺', conflict: '隙', intimacy: '亲', gift: '赠', fact: '识' };

const MemoryReview: React.FC<{ open: boolean; onClose: () => void; game: StoryState }> = ({ open, onClose, game }) => {
    const [tab, setTab] = useState<'global' | string>('global');
    const chars = Object.values(game.characters);
    const list = tab === 'global' ? game.memories : (game.characters[tab]?.memories || []);
    return (
        <PaperSheet open={open} onClose={onClose} tape="butter" title="记忆回顾 · 长卷">
            <div className="flex gap-1.5 mb-2 overflow-x-auto no-scrollbar pb-1">
                <Chip active={tab === 'global'} onClick={() => setTab('global')}>长期记忆</Chip>
                {chars.map(c => <Chip key={c.charId} active={tab === c.charId} onClick={() => setTab(c.charId)}>{c.name}</Chip>)}
            </div>
            <div className="max-h-[52vh] overflow-y-auto no-scrollbar space-y-1.5">
                {list.length === 0 && <div className="text-center py-8 text-[12px]" style={{ color: INK_SOFT }}>这段尚无可追忆之事。</div>}
                {list.map(m => (
                    <div key={m.id} className="flex items-start gap-2 px-2.5 py-1.5 rounded-lg" style={{ background: 'rgba(232,228,217,0.5)' }}>
                        <span className="shrink-0 mt-0.5 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold" style={{ background: INK, color: PAPER }}>{MEM_KIND_LABEL[m.kind] || '事'}</span>
                        <div className="min-w-0">
                            <div className="text-[12px] leading-snug" style={{ color: '#3a362f' }}>{m.text}</div>
                            <div className="text-[9px] mt-0.5" style={{ color: INK_SOFT }}>第 {m.day} 日 · 重 {m.weight}{m.charId && game.characters[m.charId] ? ` · ${game.characters[m.charId].name}` : ''}</div>
                        </div>
                    </div>
                ))}
            </div>
        </PaperSheet>
    );
};

const Chip: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({ active, onClick, children }) => (
    <button onClick={onClick} className="px-2.5 py-1 rounded-full text-[11px] font-bold shrink-0 active:scale-95 transition-transform" style={active ? { background: INK, color: PAPER } : { background: 'rgba(255,253,247,0.8)', color: INK, border: '1px solid rgba(176,170,158,0.6)' }}>{children}</button>
);

const openPanel: React.CSSProperties = {
    background: 'linear-gradient(180deg,#fbf9f2,#f1eee4)',
    border: '1px solid rgba(176,170,158,0.7)', outline: '1px dashed rgba(150,144,132,0.5)', outlineOffset: '-5px',
    borderRadius: 16, boxShadow: '0 12px 24px -16px rgba(31,29,26,0.5)',
};
const inputStyle: React.CSSProperties = {
    background: 'rgba(255,253,247,0.9)', border: '1px solid rgba(176,170,158,0.8)', color: INK,
};
const dialogueBox: React.CSSProperties = {
    background: 'linear-gradient(180deg, rgba(251,249,242,0.97), rgba(243,240,232,0.97))',
    border: '1px solid rgba(176,170,158,0.85)', outline: '1px dashed rgba(150,144,132,0.45)', outlineOffset: -4,
    boxShadow: '0 14px 28px -18px rgba(31,29,26,0.5)',
};

export default StoryMode;
