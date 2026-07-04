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
    applyMapAction, availableLocations, PALACE_ACTION_LABELS, STORY_RESOURCE_LABELS,
    buildActionJudgementPrompt, parseActionJudgement, applyActionJudgement,
    previewFavorAction, applyFavorAction, favorCourtSummary, STORY_FAVOR_ACTION_LABELS, STORY_FAVOR_ACTION_HINTS,
    type TimeSlot, type TurnType, type Gender, type PalaceActionType, type PalaceLocation,
    type StoryObjective, type StoryInventoryItem, type StoryAchievement, type StoryResourceKey,
    type StoryActionEntryPoint, type StoryActionJudgement, type StoryFavorActionInput, type StoryFavorPreview, type StoryFavorActionType,
} from '../../utils/haremStory';
import {
    PaperBackdrop, ScrapHeader, PaperCard, WashiTape, Polaroid, ScrapButton, StickyNote,
    SectionTag, DashedRule, PaperDialog, PaperSheet, Stamp,
    INK, INK_SOFT, PAPER, PAGE_BG, HALFTONE,
} from './palaceSkin';
import {
    Crown, Scroll, BookOpen, FloppyDisk, UsersThree, Sparkle, CaretRight,
    ArrowClockwise, Heart, ShieldCheck, Drop, Smiley, Brain, MapPin, Trash,
    List, PlusCircle, PaperPlaneRight, PersonSimpleWalk, HeartBreak, ArrowsClockwise, Eye, TextAa,
    CastleTurret, TreasureChest, Medal, FlagBanner, Compass, Coins, Lightning, Megaphone,
} from '@phosphor-icons/react';

const LIVE_KEY = 'moro_harem_story';
const SAVES_KEY = 'moro_harem_story_saves';
const MAX_CAST = 6;
const MAX_SLOTS = 12;

type CarryPack = { fromPlaythrough: number; notes: string[] } | null;
interface SaveSlot { id: string; name: string; meta: StorySaveMeta; state: StoryState; }

// 宫廷纸本底色：保留宫廷气质，但降低红金对比，避免小屏第一眼过重。
const TIME_WASH: Record<TimeSlot, string> = {
    晨: 'radial-gradient(120% 80% at 50% 0%, rgba(224,197,137,0.16) 0%, transparent 58%), linear-gradient(180deg, #4a3030 0%, #342324 100%)',
    午: 'radial-gradient(120% 80% at 50% 0%, rgba(238,215,161,0.18) 0%, transparent 58%), linear-gradient(180deg, #513032 0%, #3a2426 100%)',
    晚: 'radial-gradient(120% 80% at 50% 0%, rgba(185,126,92,0.14) 0%, transparent 58%), linear-gradient(180deg, #40282a 0%, #261b1c 100%)',
    夜: 'radial-gradient(120% 90% at 50% 0%, rgba(76,96,122,0.16) 0%, transparent 62%), linear-gradient(180deg, #28212a 0%, #181415 100%)',
};
const TIME_GLYPH: Record<TimeSlot, string> = { 晨: '🌅', 午: '☀️', 晚: '🌇', 夜: '🌙' };

const eid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const fmtTime = (ts: number) => { const d = new Date(ts); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`; };

const loadSaves = (): SaveSlot[] => { try { const r = localStorage.getItem(SAVES_KEY); const a = r ? JSON.parse(r) : []; return Array.isArray(a) ? a : []; } catch { return []; } };
const writeSaves = (s: SaveSlot[]) => { try { localStorage.setItem(SAVES_KEY, JSON.stringify(s.slice(0, MAX_SLOTS))); } catch { /* ignore */ } };

const RISK_LABEL: Record<string, string> = { low: '稳妥', mid: '微澜', high: '行险' };
const RISK_PIPS: Record<string, number> = { low: 1, mid: 2, high: 3 };
const RESOURCE_KEYS_UI: StoryResourceKey[] = ['power', 'reputation', 'silver', 'energy', 'rumor'];
const activePillStyle: React.CSSProperties = {
    background: 'rgba(58,35,35,0.88)',
    color: PAPER,
    border: '1px solid rgba(234,213,157,0.22)',
};
const quietPillStyle: React.CSSProperties = {
    background: 'rgba(251,244,234,0.74)',
    color: INK,
    border: '1px solid rgba(180,168,146,0.46)',
};

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
    const [judgementBusy, setJudgementBusy] = useState(false);
    const [visitOpen, setVisitOpen] = useState(false);
    const [spriteMenu, setSpriteMenu] = useState<string | null>(null);
    const [typewriter, setTypewriter] = useState(true);
    const [typed, setTyped] = useState(0);

    // 浮层
    const [menu, setMenu] = useState(false);
    const [saveOpen, setSaveOpen] = useState(false);
    const [statusOpen, setStatusOpen] = useState(false);
    const [memoryOpen, setMemoryOpen] = useState(false);
    const [mapOpen, setMapOpen] = useState(false);
    const [progressOpen, setProgressOpen] = useState(false);
    const [inventoryOpen, setInventoryOpen] = useState(false);
    const [achievementOpen, setAchievementOpen] = useState(false);
    const [favorOpen, setFavorOpen] = useState(false);
    const [favorDraft, setFavorDraft] = useState<{ preview: StoryFavorPreview; input: StoryFavorActionInput } | null>(null);
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
    const ready = allRead && typingDone && !busy && !judgementBusy; // 读完且当前一拍打完、未在请求 → 可做选择

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
            const out = await llmComplete(api(), [{ role: 'system', content: system }, { role: 'user', content: user }], { temperature: 0.92, maxTokens: 3200, continueRounds: 2 });
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
    const requestJudgement = async (
        entryPoint: StoryActionEntryPoint,
        actionText: string,
        context?: string,
        refs: { targetCharId?: string; itemId?: string; objectiveId?: string; locationId?: PalaceLocation['id'] } = {},
    ) => {
        const text = actionText.trim();
        if (!game || !scene || busy || judgementBusy || !text) return;
        const st = game;
        const sc = scene;
        setJudgementBusy(true);
        try {
            const { system, user } = buildActionJudgementPrompt(st, { entryPoint, actionText: text, context, ...refs });
            const out = await llmComplete(api(), [{ role: 'system', content: system }, { role: 'user', content: user }], { temperature: 0.78, maxTokens: 1300, continueRounds: 1 });
            const judgement = parseActionJudgement(out, st, { entryPoint, actionText: text });
            if (!judgement) throw new Error('bad judgement');
            setGame(prev => prev ? { ...prev, pendingJudgement: judgement } : prev);
        } catch {
            if (entryPoint === 'scene') {
                addToast('判官暂未成词，已按旧法落子。', 'error');
                advance(applyCustomAction(st, sc, text), sc.turnType === 'ending');
            } else {
                addToast('判官暂未成词，这步尚未落档。', 'error');
            }
        } finally {
            setJudgementBusy(false);
        }
    };
    const submitCustom = () => {
        const t = customText.trim();
        if (!game || !scene || busy || !t) return;
        setCustomText('');
        requestJudgement('scene', t, '剧情自由行动：玩家没有选择三项按钮，而是自行陈述想做的事。');
    };
    const visit = (cid: string) => {
        if (!game || !scene || busy) return;
        setVisitOpen(false);
        advance(visitCharacter(game, scene, cid), scene.turnType === 'ending');
    };
    const judgeCharacter = (cid: string) => {
        if (!game || !scene || busy) return;
        const c = game.characters[cid];
        if (!c) return;
        setVisitOpen(false);
        setSpriteMenu(null);
        requestJudgement(
            'character',
            `向${c.name}下达密令，或邀约${c.name}私下商议下一步。`,
            `角色：${c.name}；好感${c.affection}，信任${c.trust}，嫉妒${c.jealousy}，心情${c.mood}；态度：${c.attitude}`,
            { targetCharId: cid },
        );
    };
    const doMapAction = (loc: PalaceLocation, action: PalaceActionType) => {
        if (!game || !scene || busy) return;
        setMapOpen(false);
        advance(applyMapAction(game, scene, {
            locationId: loc.id,
            action,
            label: `${loc.name} · ${PALACE_ACTION_LABELS[action]}`,
            note: loc.blurb,
        }), scene.turnType === 'ending');
    };
    const doMapPlan = (loc: PalaceLocation) => {
        if (!game || !scene || busy) return;
        setMapOpen(false);
        requestJudgement(
            'map',
            `在${loc.name}谋划一手，借此牵动宫中局势。`,
            `地点：${loc.name}；可行动：${loc.actions.map(a => PALACE_ACTION_LABELS[a]).join('、')}；地点摘要：${loc.blurb}`,
            { locationId: loc.id },
        );
    };
    const judgeInventoryItem = (item: StoryInventoryItem) => {
        if (!game || !scene || busy) return;
        setInventoryOpen(false);
        requestJudgement(
            'inventory',
            `追查并使用「${item.name}」。`,
            `物件：${item.name}；类型：${item.kind}；说明：${item.text}${item.charId && game.characters[item.charId] ? `；关联角色：${game.characters[item.charId].name}` : ''}`,
            { itemId: item.id, targetCharId: item.charId },
        );
    };
    const judgeObjective = (objective: StoryObjective) => {
        if (!game || !scene || busy) return;
        setProgressOpen(false);
        requestJudgement(
            'objective',
            `请判官为「${objective.title}」出谋划策。`,
            `目标：${objective.title}；${objective.description}；进度：${objective.progress}/${objective.target}；类型：${objective.kind}`,
            { objectiveId: objective.id },
        );
    };
    const draftFavorAction = (input: StoryFavorActionInput) => {
        if (!game || !scene || busy || judgementBusy) return;
        setFavorDraft({ preview: previewFavorAction(game, input), input });
    };
    const confirmFavorAction = () => {
        if (!game || !scene || busy || judgementBusy || !favorDraft?.preview.ok) return;
        const input = favorDraft.input;
        setFavorDraft(null);
        setFavorOpen(false);
        advance(applyFavorAction(game, scene, input), scene.turnType === 'ending');
    };
    const judgeFavorDraft = (text: string) => {
        if (!game || !scene || busy || judgementBusy || !text.trim()) return;
        setFavorOpen(false);
        requestJudgement(
            'favor',
            text.trim(),
            '宠爱经营台自拟谕旨：玩家希望用召见、赏罚、护持、调停或安宫之类的宫廷手段处理眼前格局。',
        );
    };
    const confirmJudgement = () => {
        if (!game || !scene || busy || judgementBusy || !game.pendingJudgement) return;
        advance(applyActionJudgement(game, scene, game.pendingJudgement), scene.turnType === 'ending');
    };
    const cancelJudgement = () => setGame(prev => prev ? { ...prev, pendingJudgement: null } : prev);

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
                        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.04]" style={{ backgroundImage: HALFTONE, backgroundSize: '7px 7px' }} />
                        <WashiTape color="amber" rotate={-4} className="absolute -top-2 left-1/2 -translate-x-1/2 w-20 h-4 rounded-[2px]" />
                        <BookOpen size={28} weight="fill" className="relative mx-auto mb-2" style={{ color: INK_SOFT }} />
                        <p className="relative text-[13px] leading-relaxed" style={{ color: '#5d554c' }}>
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
                                    style={on ? activePillStyle : quietPillStyle}>
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
                                    style={pStyle === st.key ? activePillStyle : quietPillStyle}>
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
                                        style={pPace === p.key ? activePillStyle : quietPillStyle}>
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
                                            <div key={c.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl" style={{ background: 'rgba(251,244,234,0.68)', border: '1px solid rgba(180,168,146,0.44)' }}>
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
                    <ScrapButton variant="ink" onClick={start} disabled={picked.size === 0} className="w-full py-3 text-[14px]" icon={<Sparkle size={15} weight="fill" />}>
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
            <div className="relative z-20 shrink-0 mx-3 mb-1 px-2 py-1.5 rounded-xl flex items-center gap-1.5 flex-wrap" style={{ background: 'rgba(251,244,234,0.78)', border: '1px solid rgba(185,149,82,0.24)', boxShadow: '0 8px 18px -17px rgba(31,29,26,0.48)' }}>
                <span className="px-2 py-0.5 rounded-md text-[10px] font-black" style={{ background: 'rgba(251,244,234,0.7)', border: '1px dashed rgba(150,144,132,0.5)', color: INK }}>{tm.label}回合</span>
                {scene?.mood && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: INK, color: PAPER }}>{scene.mood}</span>}
                {activeChars.map(c => (
                    <span key={c.charId} className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px]" style={{ background: 'rgba(251,244,234,0.72)', border: '1px solid rgba(180,168,146,0.46)' }}>
                        {game.route.charId === c.charId && <Crown size={10} weight="fill" style={{ color: INK }} />}
                        <span className="font-bold" style={{ color: INK }}>{c.name}</span>
                        <span style={{ color: INK_SOFT }}>{stageOf(c.affection).label}</span>
                    </span>
                ))}
                <span className="min-w-[120px] flex-1 px-2 py-0.5 rounded-full text-[10px] font-bold truncate" style={{ background: 'rgba(255,253,247,0.68)', color: INK_SOFT, border: '1px solid rgba(176,170,158,0.38)' }}>
                    {scene?.sceneTitle || game.location} · {game.location}
                </span>
                {scene && !busy && (
                    <button onClick={regenerate} className="shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold active:scale-95 transition-transform" style={{ background: 'rgba(251,244,234,0.74)', border: '1px solid rgba(180,168,146,0.5)', color: INK }} title="对这一场不满意？换一种写法">
                        <ArrowsClockwise size={11} weight="bold" />换种写法
                    </button>
                )}
            </div>
            <div className="relative z-20 shrink-0 px-3 pb-1.5 flex flex-wrap items-center gap-1.5">
                <button onClick={() => setProgressOpen(true)} className="min-w-0 flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-black active:scale-95 transition-transform" style={{ maxWidth: 'calc(100% - 104px)', background: 'rgba(251,244,234,0.78)', border: '1px solid rgba(185,149,82,0.26)', color: INK }}>
                    <FlagBanner size={12} weight="fill" className="shrink-0" />
                    <span className="min-w-0 truncate">第 {game.chapter.index} 章 · {game.chapter.title}</span>
                    <span className="shrink-0" style={{ color: INK_SOFT }}>{game.chapter.progress}/{game.chapter.goal}</span>
                </button>
                <button onClick={() => setFavorOpen(true)} className="shrink-0 flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-black active:scale-95 transition-transform" style={{ background: INK, border: '1px solid rgba(201,154,58,0.45)', color: PAPER }}>
                    <Crown size={12} weight="fill" />宠爱经营台
                </button>
                {champion && (
                    <span className="min-w-[120px] flex-1 px-2 py-1 rounded-full text-[10px] font-bold truncate" style={{ background: 'rgba(251,244,234,0.68)', border: '1px solid rgba(185,149,82,0.22)', color: INK_SOFT }}>
                        君心 {champion.name} · 好感 {champion.affection}
                    </span>
                )}
                <ResourceStrip resources={game.resources} wrap />
            </div>

            <SceneStage
                game={game}
                scene={scene}
                tmLabel={tm.label}
                activeChars={activeChars}
                speakingId={speakingId}
                currentEmotion={curBeat?.kind === 'dialogue' ? curBeat.emotion : undefined}
                ready={ready}
                onSprite={setSpriteMenu}
                onVisit={visit}
                onJudgeCharacter={judgeCharacter}
                onOpenVisit={() => setVisitOpen(true)}
                onOpenMap={() => setMapOpen(true)}
                onOpenFavor={() => setFavorOpen(true)}
                onOpenProgress={() => setProgressOpen(true)}
            />

            {/* ④⑤ 对话框 + 名框 + ⑥ 选项 */}
            <div className="relative z-10 shrink-0 max-h-[48vh] overflow-y-auto no-scrollbar px-3 pt-1 pb-safe">
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
                    <div className="px-4 py-3 overflow-y-auto no-scrollbar" style={{ maxHeight: 'min(34vh, 260px)', minHeight: 104 }}>
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
                                <button onClick={submitCustom} disabled={!customText.trim() || judgementBusy} className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center active:scale-95 transition-transform disabled:opacity-40" style={{ background: INK, color: PAPER }} title="先请判官预判，再确认落子">
                                    <PaperPlaneRight size={16} weight="fill" />
                                </button>
                            </div>
                            <div className="flex items-center gap-1.5 mt-1.5 px-2 py-1.5 rounded-xl overflow-x-auto no-scrollbar" style={{ background: 'rgba(255,247,232,0.88)', border: '1px solid rgba(201,154,58,0.34)', boxShadow: '0 8px 18px -16px rgba(31,29,26,0.6)' }}>
                                <button onClick={() => setVisitOpen(true)} className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-bold active:scale-95 transition-transform" style={{ color: INK, background: 'rgba(255,253,247,0.72)', border: '1px solid rgba(176,170,158,0.42)' }}>
                                    <PersonSimpleWalk size={13} weight="bold" />主动去见…
                                </button>
                                <button onClick={() => setMapOpen(true)} className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-bold active:scale-95 transition-transform" style={{ color: INK, background: 'rgba(255,253,247,0.72)', border: '1px solid rgba(176,170,158,0.42)' }}>
                                    <MapPin size={13} weight="fill" />宫苑地图
                                </button>
                                <button onClick={() => setFavorOpen(true)} className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-bold active:scale-95 transition-transform" style={{ color: INK, background: 'rgba(255,253,247,0.72)', border: '1px solid rgba(176,170,158,0.42)' }}>
                                    <Crown size={13} weight="fill" />宠爱经营台
                                </button>
                                {scene.effectsPreview && <span className="shrink-0 ml-auto max-w-[44%] px-2 py-1 rounded-full text-[10px] truncate" style={{ color: INK_SOFT, background: 'rgba(255,253,247,0.64)' }}>{scene.effectsPreview}</span>}
                            </div>
                        </div>
                    )}
                    {(busy || judgementBusy) && scene && (
                        <div className="flex items-center gap-2 text-[12px] py-2 justify-center" style={{ color: INK_SOFT }}><Sparkle size={14} weight="fill" className="animate-pulse" />{judgementBusy ? '判官正在拆解此局…' : '剧情顺着你的心意往下走…'}</div>
                    )}
                </div>
            </div>

            {/* 主动择幸 · 选要见谁 */}
            <PaperSheet open={visitOpen} onClose={() => setVisitOpen(false)} tape="butter" title="主动去见 · 择幸">
                <p className="text-[11px] mb-2" style={{ color: INK_SOFT }}>挑一位，下一场便去与 ta 独处。</p>
                <div className="max-h-[46vh] overflow-y-auto no-scrollbar space-y-1.5">
                    {Object.values(game.characters).sort((a, b) => b.affection - a.affection).map(c => (
                        <div key={c.charId} className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl" style={{ background: 'rgba(255,253,247,0.85)', border: '1px solid rgba(176,170,158,0.6)' }}>
                            <img src={c.avatar} className="w-9 h-9 rounded-full object-cover shrink-0" />
                            <div className="flex-1 min-w-0 text-left">
                                <div className="text-[13px] font-bold truncate" style={{ color: INK }}>{c.name}{c.estranged && <span className="ml-1 text-[10px]" style={{ color: INK_SOFT }}>· 离心</span>}</div>
                                <div className="text-[10px]" style={{ color: INK_SOFT }}>{stageOf(c.affection).label} · 好感 {c.affection} · {c.attitude}</div>
                            </div>
                            <button onClick={() => judgeCharacter(c.charId)} disabled={judgementBusy} className="px-2 py-1 rounded-full text-[10px] font-bold active:scale-95 transition-transform disabled:opacity-40" style={{ background: 'rgba(255,247,232,0.9)', border: '1px solid rgba(201,154,58,0.45)', color: INK }}>密令/邀约</button>
                            <button onClick={() => visit(c.charId)} className="w-8 h-8 rounded-full flex items-center justify-center active:scale-95 transition-transform" style={{ background: INK, color: PAPER }} title="去见 ta">
                                <PersonSimpleWalk size={15} weight="bold" />
                            </button>
                        </div>
                    ))}
                </div>
            </PaperSheet>

            <FavorCourtSheet
                open={favorOpen}
                onClose={() => setFavorOpen(false)}
                game={game}
                ready={!!scene && ready && !busy && !judgementBusy}
                onDraft={draftFavorAction}
                onJudgeDraft={judgeFavorDraft}
            />
            <PalaceMapSheet open={mapOpen} onClose={() => setMapOpen(false)} game={game} ready={!!scene && ready && !busy && !judgementBusy} onAction={doMapAction} onPlan={doMapPlan} />
            <ProgressSheet open={progressOpen} onClose={() => setProgressOpen(false)} game={game} ready={!!scene && ready && !busy && !judgementBusy} onJudgeObjective={judgeObjective} />
            <InventorySheet open={inventoryOpen} onClose={() => setInventoryOpen(false)} items={game.inventory} chars={game.characters} ready={!!scene && ready && !busy && !judgementBusy} onJudgeItem={judgeInventoryItem} />
            <AchievementSheet open={achievementOpen} onClose={() => setAchievementOpen(false)} achievements={game.achievements} />
            <FavorDraftDialog draft={favorDraft} game={game} busy={busy || judgementBusy} onCancel={() => setFavorDraft(null)} onConfirm={confirmFavorAction} />

            {/* ⑦ 菜单 */}
            <PaperSheet open={menu} onClose={() => setMenu(false)} tape="ink" title="掌事菜单">
                <div className="grid grid-cols-2 gap-2">
                    <MenuBtn icon={<Crown size={18} weight="fill" />} label="宠爱经营台" onClick={() => { setMenu(false); setFavorOpen(true); }} />
                    <MenuBtn icon={<MapPin size={18} weight="fill" />} label="宫苑地图" onClick={() => { setMenu(false); setMapOpen(true); }} />
                    <MenuBtn icon={<Scroll size={18} weight="fill" />} label="章节卷轴" onClick={() => { setMenu(false); setProgressOpen(true); }} />
                    <MenuBtn icon={<TreasureChest size={18} weight="fill" />} label="背包线索" onClick={() => { setMenu(false); setInventoryOpen(true); }} />
                    <MenuBtn icon={<Medal size={18} weight="fill" />} label="成就册" onClick={() => { setMenu(false); setAchievementOpen(true); }} />
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
                                        周目{s.meta.playthrough} · 第{s.meta.day}日{s.meta.time} · 第{s.meta.turn}幕 · {s.meta.chapterTitle || '初入椒房'} {s.meta.mainProgress || 0}% · 君心属{s.meta.topName}{s.meta.routeName ? ` · 定情${s.meta.routeName}` : ''}
                                    </div>
                                    {s.meta.resourceSummary && <div className="text-[9px] mt-0.5 truncate" style={{ color: INK_SOFT }}>{s.meta.resourceSummary}</div>}
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
                            <ScrapButton variant="paper" onClick={() => judgeCharacter(c.charId)} disabled={judgementBusy} className="flex-1 py-2 text-[12px]" icon={<Scroll size={13} weight="fill" />}>密令</ScrapButton>
                            <ScrapButton variant="ink" onClick={() => { const id = c.charId; setSpriteMenu(null); visit(id); }} className="flex-1 py-2 text-[12px]" icon={<PersonSimpleWalk size={13} weight="bold" />}>去见 ta</ScrapButton>
                        </div>
                    </div>
                ); })()}
            </PaperDialog>

            {/* ⑩ 记忆回顾 */}
            <MemoryReview open={memoryOpen} onClose={() => setMemoryOpen(false)} game={game} />

            <JudgementPreview judgement={game.pendingJudgement} game={game} busy={busy || judgementBusy} onCancel={cancelJudgement} onConfirm={confirmJudgement} />

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

const ResourceStrip: React.FC<{ resources: StoryState['resources']; wrap?: boolean }> = ({ resources, wrap = false }) => {
    const iconOf: Partial<Record<StoryResourceKey, React.ReactNode>> = {
        power: <Crown size={10} weight="fill" />,
        reputation: <Megaphone size={10} weight="fill" />,
        silver: <Coins size={10} weight="fill" />,
        energy: <Lightning size={10} weight="fill" />,
        rumor: <Eye size={10} weight="fill" />,
    };
    return (
        <div className={`${wrap ? 'basis-full min-w-0 flex flex-wrap' : 'shrink-0 flex items-center'} gap-1.5`}>
            {RESOURCE_KEYS_UI.map(k => (
                <span key={k} className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-1 rounded-full text-[10px] font-bold" style={{ background: 'rgba(251,244,234,0.72)', border: '1px solid rgba(185,149,82,0.26)', color: INK }}>
                    {iconOf[k]}{STORY_RESOURCE_LABELS[k]} {resources[k]}
                </span>
            ))}
        </div>
    );
};

const pct = (value: number) => Math.max(0, Math.min(100, Math.round(value || 0)));

const StageMiniBar: React.FC<{ icon: React.ReactNode; label: string; value: number; danger?: boolean }> = ({ icon, label, value, danger }) => (
    <div className="min-w-0 flex items-center gap-1">
        <span className="shrink-0 flex items-center gap-0.5 text-[9px] font-bold" style={{ color: INK_SOFT }}>{icon}{label}</span>
        <div className="min-w-0 flex-1 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(176,170,158,0.32)' }}>
            <div className="h-full rounded-full" style={{ width: `${pct(value)}%`, background: danger && value >= 60 ? '#7b1724' : INK, opacity: danger ? 0.78 : 1 }} />
        </div>
        <span className="shrink-0 w-5 text-right text-[9px] tabular-nums" style={{ color: INK_SOFT }}>{pct(value)}</span>
    </div>
);

const StageQuickButton: React.FC<{ icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; dark?: boolean; title?: string }> = ({ icon, label, onClick, disabled, dark, title }) => (
    <button
        onClick={onClick}
        disabled={disabled}
        title={title || label}
        className="min-w-0 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-black active:scale-95 transition-transform disabled:opacity-40"
        style={dark
            ? { background: 'rgba(58,35,35,0.88)', color: PAPER, border: '1px solid rgba(185,149,82,0.28)' }
            : { background: 'rgba(251,244,234,0.76)', color: INK, border: '1px solid rgba(185,149,82,0.26)' }}
    >
        <span className="shrink-0">{icon}</span>
        <span className="truncate">{label}</span>
    </button>
);

const SceneStage: React.FC<{
    game: StoryState;
    scene: StoryScene | null;
    tmLabel: string;
    activeChars: StoryChar[];
    speakingId?: string;
    currentEmotion?: string;
    ready: boolean;
    onSprite: (charId: string) => void;
    onVisit: (charId: string) => void;
    onJudgeCharacter: (charId: string) => void;
    onOpenVisit: () => void;
    onOpenMap: () => void;
    onOpenFavor: () => void;
    onOpenProgress: () => void;
}> = ({ game, scene, tmLabel, activeChars, speakingId, currentEmotion, ready, onSprite, onVisit, onJudgeCharacter, onOpenVisit, onOpenMap, onOpenFavor, onOpenProgress }) => {
    const summary = favorCourtSummary(game);
    const latestFavor = game.favorLedger[0];
    const primaryObjective = game.objectives.find(o => o.kind === 'main' && !o.done) || game.objectives.find(o => !o.done) || game.objectives[0];
    const hotRumor = (game.rumors || []).slice().sort((a, b) => b.heat - a.heat)[0];
    const liveHook = (game.generatedHooks || []).find(h => h.expiresDay >= game.day) || game.generatedHooks[0];
    const rel = relationshipSummary(game)[0];
    const hint = scene?.effectsPreview || scene?.nextSceneHint || game.lastTurn?.nextIntent;
    const chapterGoal = Math.max(1, game.chapter.goal || 1);
    const chapterPct = Math.max(0, Math.min(100, Math.round((game.chapter.progress / chapterGoal) * 100)));
    const favorLabel = latestFavor
        ? latestFavor.type === 'draft' ? '自拟谕旨' : STORY_FAVOR_ACTION_LABELS[latestFavor.type]
        : '恩宠格局';
    const favorText = latestFavor
        ? `第${latestFavor.day}日${latestFavor.time} · ${latestFavor.title || latestFavor.actionText}`
        : `${summary.topName}居首，差距${summary.favorGap}，高嫉妒${summary.highJealousCount}`;
    const intelItems = [
        primaryObjective ? {
            key: 'objective',
            icon: <FlagBanner size={12} weight="fill" />,
            tag: primaryObjective.kind === 'main' ? '主线' : '支线',
            title: primaryObjective.title,
            body: `${primaryObjective.progress}/${primaryObjective.target} · ${primaryObjective.description}`,
            onClick: onOpenProgress,
        } : null,
        {
            key: 'favor',
            icon: <Crown size={12} weight="fill" />,
            tag: favorLabel,
            title: latestFavor ? '最近落旨' : '君心账',
            body: favorText,
            onClick: onOpenFavor,
        },
        hotRumor ? {
            key: 'rumor',
            icon: <Eye size={12} weight="fill" />,
            tag: `风闻 ${hotRumor.heat}`,
            title: '宫中传言',
            body: hotRumor.text,
            onClick: onOpenMap,
        } : liveHook ? {
            key: 'hook',
            icon: <Compass size={12} weight="fill" />,
            tag: '暗线',
            title: liveHook.title,
            body: liveHook.summary,
            onClick: onOpenMap,
        } : null,
        rel ? {
            key: 'rel',
            icon: <UsersThree size={12} weight="fill" />,
            tag: '关系',
            title: '宫中暗流',
            body: rel,
            onClick: onOpenFavor,
        } : null,
    ].filter(Boolean) as Array<{ key: string; icon: React.ReactNode; tag: string; title: string; body: string; onClick: () => void }>;

    return (
        <div className="relative z-10 flex-1 min-h-[198px] overflow-hidden px-3 pb-1.5">
            <div
                className="relative overflow-hidden rounded-xl"
                style={{
                    height: '100%',
                    background: 'linear-gradient(135deg, rgba(251,244,234,0.86), rgba(226,207,169,0.58) 52%, rgba(74,43,44,0.42))',
                    border: '1px solid rgba(185,149,82,0.3)',
                    boxShadow: '0 16px 34px -26px rgba(22,18,17,0.68)',
                }}
            >
                <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.05]" style={{ backgroundImage: HALFTONE, backgroundSize: '8px 8px' }} />
                <span aria-hidden className="absolute -right-1 -top-5 text-[92px] leading-none opacity-[0.05] select-none">{TIME_GLYPH[game.time]}</span>
                <div className="relative h-full grid grid-cols-[minmax(0,1fr)_minmax(132px,40%)] gap-2 p-2">
                    <div className="min-w-0 min-h-0 flex flex-col gap-2">
                        <section className="shrink-0 rounded-lg px-3 py-2" style={{ background: 'rgba(251,244,234,0.78)', border: '1px solid rgba(180,168,146,0.4)' }}>
                            <div className="flex items-start gap-2">
                                <div className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: INK, color: PAPER }}>
                                    <CastleTurret size={18} weight="fill" />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.16em]" style={{ color: INK_SOFT }}>
                                        <span>{tmLabel}</span>
                                        <span>第{game.day}日{game.time}</span>
                                    </div>
                                    <div className="text-[15px] leading-snug font-black truncate" style={{ color: INK }}>{scene?.sceneTitle || `${game.location}未开场`}</div>
                                    <div className="mt-0.5 flex items-center gap-1.5 text-[10px] min-w-0" style={{ color: INK_SOFT }}>
                                        <MapPin size={11} weight="fill" className="shrink-0" />
                                        <span className="truncate">{game.location}</span>
                                        {scene?.mood && <span className="shrink-0 px-1.5 py-0.5 rounded-full font-bold" style={{ background: 'rgba(31,29,26,0.08)', color: INK }}>{scene.mood}</span>}
                                    </div>
                                </div>
                            </div>
                            <button onClick={onOpenProgress} className="mt-2 w-full text-left active:scale-[0.99] transition-transform" title="查看章节卷轴">
                                <div className="flex items-center gap-2 text-[10px] font-bold" style={{ color: INK_SOFT }}>
                                    <span className="truncate">第 {game.chapter.index} 章 · {game.chapter.title}</span>
                                    <span className="ml-auto shrink-0 tabular-nums">{game.chapter.progress}/{game.chapter.goal}</span>
                                </div>
                                <div className="mt-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(176,170,158,0.28)' }}>
                                    <div className="h-full rounded-full" style={{ width: `${chapterPct}%`, background: INK }} />
                                </div>
                            </button>
                            {hint && <div className="mt-1.5 text-[10px] leading-snug line-clamp-2" style={{ color: '#694036' }}>{hint}</div>}
                        </section>

                        <section className="min-h-0 flex-1 rounded-lg p-2 flex flex-col" style={{ background: 'rgba(251,244,234,0.64)', border: '1px solid rgba(180,168,146,0.34)' }}>
                            <div className="shrink-0 flex items-center gap-1.5 text-[10px] font-black" style={{ color: INK }}>
                                <Scroll size={12} weight="fill" />宫廷情报
                            </div>
                            <div className="mt-1.5 min-h-0 flex-1 overflow-y-auto no-scrollbar space-y-1.5">
                                {intelItems.map(item => (
                                    <button key={item.key} onClick={item.onClick} className="w-full min-w-0 text-left rounded-lg px-2 py-1.5 active:scale-[0.99] transition-transform" style={{ background: 'rgba(251,244,234,0.56)', border: '1px solid rgba(185,149,82,0.2)' }}>
                                        <div className="flex items-center gap-1.5 min-w-0">
                                            <span className="shrink-0" style={{ color: INK }}>{item.icon}</span>
                                            <span className="shrink-0 px-1.5 py-0.5 rounded text-[8.5px] font-black" style={{ background: 'rgba(31,29,26,0.08)', color: INK }}>{item.tag}</span>
                                            <span className="min-w-0 truncate text-[10.5px] font-black" style={{ color: INK }}>{item.title}</span>
                                        </div>
                                        <div className="mt-0.5 text-[9.5px] leading-snug line-clamp-2" style={{ color: INK_SOFT }}>{item.body}</div>
                                    </button>
                                ))}
                                {intelItems.length === 0 && <div className="text-center py-4 text-[11px]" style={{ color: INK_SOFT }}>暂无暗线，先读完这一幕。</div>}
                            </div>
                        </section>

                        <div className="shrink-0 grid grid-cols-4 gap-1.5">
                            <StageQuickButton icon={<PersonSimpleWalk size={12} weight="bold" />} label="择见" onClick={onOpenVisit} disabled={!ready} title="主动去见" />
                            <StageQuickButton icon={<Crown size={12} weight="fill" />} label="宠爱" onClick={onOpenFavor} disabled={!ready} dark title="宠爱经营台" />
                            <StageQuickButton icon={<MapPin size={12} weight="fill" />} label="地图" onClick={onOpenMap} disabled={!ready} title="宫苑地图" />
                            <StageQuickButton icon={<FlagBanner size={12} weight="fill" />} label="章卷" onClick={onOpenProgress} title="章节卷轴" />
                        </div>
                    </div>

                    <section className="min-w-0 min-h-0 rounded-lg p-2 flex flex-col" style={{ background: 'rgba(251,244,234,0.68)', border: '1px solid rgba(180,168,146,0.38)' }}>
                        <div className="shrink-0 flex items-center gap-1.5">
                            <UsersThree size={13} weight="fill" style={{ color: INK }} />
                            <span className="text-[11px] font-black" style={{ color: INK }}>在场诸位</span>
                            <span className="ml-auto text-[9px]" style={{ color: INK_SOFT }}>{activeChars.length || 0} 人</span>
                        </div>
                        <div className="mt-1.5 min-h-0 flex-1 overflow-y-auto no-scrollbar space-y-1.5">
                            {activeChars.length === 0 && (
                                <div className="h-full min-h-[96px] rounded-lg flex flex-col items-center justify-center px-2 text-center" style={{ background: 'rgba(176,170,158,0.16)', color: INK_SOFT }}>
                                    <CastleTurret size={24} weight="fill" />
                                    <div className="mt-1 text-[11px] leading-snug">{game.location}，此刻无人相伴。</div>
                                </div>
                            )}
                            {activeChars.map(c => {
                                const speaking = speakingId === c.charId;
                                return (
                                    <div key={c.charId} className="rounded-lg px-2 py-1.5" style={{ background: speaking ? 'rgba(251,244,234,0.84)' : 'rgba(251,244,234,0.52)', border: `1px solid ${speaking ? 'rgba(58,35,35,0.34)' : 'rgba(180,168,146,0.3)'}`, opacity: speakingId && !speaking ? 0.68 : 1 }}>
                                        <div className="flex items-start gap-2">
                                            <button onClick={() => onSprite(c.charId)} className="shrink-0 relative active:scale-95 transition-transform" title="查看状态 / 快捷行动">
                                                {c.avatar
                                                    ? <img src={c.avatar} alt={c.name} className="w-12 h-[58px] object-cover rounded-lg" style={{ border: `2px solid ${speaking ? INK : 'rgba(176,170,158,0.62)'}`, boxShadow: speaking ? '0 8px 18px -10px rgba(31,29,26,0.7)' : 'none' }} />
                                                    : <div className="w-12 h-[58px] rounded-lg flex items-center justify-center text-[22px]" style={{ background: 'rgba(176,170,158,0.25)', border: '2px solid rgba(176,170,158,0.62)' }}>🎐</div>}
                                                {speaking && <WashiTape color="butter" rotate={-6} className="absolute -top-1.5 -left-1.5 w-8 h-3 rounded-[2px]" />}
                                                {speaking && currentEmotion && <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded-full text-[8.5px] font-bold whitespace-nowrap" style={{ background: INK, color: PAPER }}>{currentEmotion}</span>}
                                                {c.estranged && <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center" style={{ background: '#6b655a', color: PAPER }}><HeartBreak size={11} weight="fill" /></span>}
                                            </button>
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-1 min-w-0">
                                                    {game.route.charId === c.charId && <Crown size={10} weight="fill" className="shrink-0" style={{ color: INK }} />}
                                                    <span className="min-w-0 truncate text-[12px] font-black" style={{ color: speaking ? INK : '#3a362f' }}>{c.name}</span>
                                                </div>
                                                <div className="mt-0.5 text-[9.5px] leading-snug line-clamp-2" style={{ color: INK_SOFT }}>{stageOf(c.affection).label} · {c.attitude}</div>
                                                <div className="mt-1 grid grid-cols-1 gap-0.5">
                                                    <StageMiniBar icon={<Heart size={9} weight="fill" />} label="好" value={c.affection} />
                                                    <StageMiniBar icon={<ShieldCheck size={9} weight="fill" />} label="信" value={c.trust} />
                                                    <StageMiniBar icon={<Drop size={9} weight="fill" />} label="妒" value={c.jealousy} danger />
                                                    <StageMiniBar icon={<Smiley size={9} weight="fill" />} label="晴" value={c.mood} />
                                                </div>
                                            </div>
                                        </div>
                                        <div className="mt-1.5 grid grid-cols-2 gap-1">
                                            <button onClick={() => onJudgeCharacter(c.charId)} disabled={!ready} className="flex items-center justify-center gap-1 px-2 py-1 rounded-md text-[9.5px] font-bold active:scale-95 transition-transform disabled:opacity-40" style={{ background: 'rgba(31,29,26,0.08)', color: INK }} title="密令 / 邀约">
                                                <Scroll size={10} weight="fill" />密令
                                            </button>
                                            <button onClick={() => onVisit(c.charId)} disabled={!ready} className="flex items-center justify-center gap-1 px-2 py-1 rounded-md text-[9.5px] font-bold active:scale-95 transition-transform disabled:opacity-40" style={{ background: INK, color: PAPER }} title="下一幕去见 ta">
                                                <PersonSimpleWalk size={10} weight="bold" />去见
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                </div>
            </div>
        </div>
    );
};

const FAVOR_ACTION_ORDER: StoryFavorActionType[] = ['summon', 'reward', 'protect', 'cool'];

const formatResourceDelta = (delta: Partial<Record<StoryResourceKey, number>>) => {
    const out = RESOURCE_KEYS_UI
        .filter(k => delta[k])
        .map(k => `${STORY_RESOURCE_LABELS[k]} ${(delta[k] || 0) > 0 ? '+' : ''}${delta[k]}`);
    return out.length ? out : ['无显著变动'];
};

const formatFavorEffect = (game: StoryState, effect: StoryFavorPreview['effects'][number]) => {
    const tags: string[] = [];
    if (effect.affection) tags.push(`好感${effect.affection > 0 ? '+' : ''}${effect.affection}`);
    if (effect.trust) tags.push(`信任${effect.trust > 0 ? '+' : ''}${effect.trust}`);
    if (effect.jealousy) tags.push(`嫉妒${effect.jealousy > 0 ? '+' : ''}${effect.jealousy}`);
    if (effect.mood) tags.push(`心情${effect.mood > 0 ? '+' : ''}${effect.mood}`);
    return `${game.characters[effect.charId]?.name || effect.charId} · ${tags.join(' / ') || '无显著变动'}`;
};

const FavorCourtSheet: React.FC<{
    open: boolean;
    onClose: () => void;
    game: StoryState;
    ready: boolean;
    onDraft: (input: StoryFavorActionInput) => void;
    onJudgeDraft: (text: string) => void;
}> = ({ open, onClose, game, ready, onDraft, onJudgeDraft }) => {
    const chars = Object.values(game.characters).sort((a, b) => b.affection - a.affection);
    const summary = favorCourtSummary(game);
    const [primary, setPrimary] = useState(chars[0]?.charId || '');
    const [secondary, setSecondary] = useState(chars.find(c => c.charId !== primary)?.charId || '');
    const [draftText, setDraftText] = useState('');

    useEffect(() => {
        if (!open) return;
        if (!game.characters[primary] && chars[0]) setPrimary(chars[0].charId);
        if ((!secondary || secondary === primary || !game.characters[secondary]) && chars.length > 1) {
            setSecondary(chars.find(c => c.charId !== (primary || chars[0].charId))?.charId || '');
        }
    }, [open, game, chars, primary, secondary]);

    const sendDraft = () => {
        const text = draftText.trim();
        if (!text || !ready) return;
        setDraftText('');
        onJudgeDraft(text);
    };

    return (
        <PaperSheet open={open} onClose={onClose} tape="rose" title="宠爱经营台 · 恩宠与宫权">
            <div className="max-h-[64vh] overflow-y-auto no-scrollbar space-y-3">
                <PaperCard className="px-3 py-2.5">
                    <div className="flex items-center gap-2.5">
                        <Stamp size={36} color={summary.highJealousCount || summary.estrangedCount ? 'ink' : 'amber'}><Crown size={18} weight="fill" /></Stamp>
                        <div className="min-w-0 flex-1">
                            <div className="text-[13px] font-black" style={{ color: INK }}>君心属 {summary.topName}</div>
                            <div className="text-[10.5px] leading-snug" style={{ color: INK_SOFT }}>
                                差距 {summary.favorGap} · 高嫉妒 {summary.highJealousCount} · 离心 {summary.estrangedCount}
                            </div>
                            <div className="text-[11px] leading-snug mt-1" style={{ color: '#694036' }}>{summary.warning}</div>
                        </div>
                    </div>
                </PaperCard>

                <ResourceStrip resources={game.resources} />
                {!ready && <StickyNote color="butter" className="px-3 py-2 text-[11px]">当前一幕尚未读完，谕旨会暂缓落下。</StickyNote>}

                <div className="grid grid-cols-2 gap-2">
                    {FAVOR_ACTION_ORDER.map(type => (
                        <button key={type} disabled={!ready || !primary} onClick={() => onDraft({ type, targetCharId: primary })}
                            title={STORY_FAVOR_ACTION_HINTS[type]}
                            className="px-3 py-2.5 rounded-xl text-left active:scale-[0.98] transition-transform disabled:opacity-40"
                            style={{ background: type === 'cool' ? 'rgba(31,29,26,0.08)' : 'rgba(255,247,232,0.9)', border: '1px solid rgba(201,154,58,0.45)', color: INK }}>
                            <div className="flex items-center gap-1.5 text-[12px] font-black">
                                {type === 'protect' ? <ShieldCheck size={14} weight="fill" /> : type === 'cool' ? <Drop size={14} weight="fill" /> : type === 'reward' ? <TreasureChest size={14} weight="fill" /> : <Crown size={14} weight="fill" />}
                                {STORY_FAVOR_ACTION_LABELS[type]}
                            </div>
                            <div className="text-[9.5px] mt-0.5 truncate" style={{ color: INK_SOFT }}>{primary && game.characters[primary] ? game.characters[primary].name : '未择人'}</div>
                        </button>
                    ))}
                    <button disabled={!ready || !primary || !secondary || primary === secondary} onClick={() => onDraft({ type: 'mediate', targetCharId: primary, secondaryCharId: secondary })}
                        className="px-3 py-2.5 rounded-xl text-left active:scale-[0.98] transition-transform disabled:opacity-40"
                        style={{ background: 'rgba(255,247,232,0.9)', border: '1px solid rgba(201,154,58,0.45)', color: INK }}>
                        <div className="flex items-center gap-1.5 text-[12px] font-black"><UsersThree size={14} weight="fill" />调停</div>
                        <div className="text-[9.5px] mt-0.5 truncate" style={{ color: INK_SOFT }}>
                            {primary && secondary ? `${game.characters[primary]?.name || ''} / ${game.characters[secondary]?.name || ''}` : '择两人'}
                        </div>
                    </button>
                    <button disabled={!ready} onClick={() => onDraft({ type: 'balance' })}
                        className="px-3 py-2.5 rounded-xl text-left active:scale-[0.98] transition-transform disabled:opacity-40"
                        style={{ background: INK, border: '1px solid rgba(201,154,58,0.45)', color: PAPER }}>
                        <div className="flex items-center gap-1.5 text-[12px] font-black"><Sparkle size={14} weight="fill" />普赏安宫</div>
                        <div className="text-[9.5px] mt-0.5 truncate" style={{ color: 'rgba(255,247,232,0.74)' }}>照拂诸位</div>
                    </button>
                </div>

                <div className="space-y-1.5">
                    {chars.map(c => {
                        const isPrimary = primary === c.charId;
                        const isSecondary = secondary === c.charId;
                        return (
                            <PaperCard key={c.charId} className="px-2.5 py-2">
                                <div className="flex items-center gap-2">
                                    {c.avatar ? <img src={c.avatar} className="w-9 h-9 rounded-full object-cover shrink-0" style={{ border: '1px solid rgba(176,170,158,0.7)' }} /> : <span className="w-9 h-9 rounded-full shrink-0 flex items-center justify-center" style={{ background: 'rgba(176,170,158,0.25)' }}>?</span>}
                                    <button onClick={() => setPrimary(c.charId)} className="min-w-0 flex-1 text-left active:scale-[0.99] transition-transform">
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-[13px] font-black truncate" style={{ color: INK }}>{c.name}</span>
                                            {isPrimary && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold" style={{ background: INK, color: PAPER }}>主</span>}
                                            {isSecondary && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold" style={{ background: 'rgba(31,29,26,0.08)', color: INK }}>乙</span>}
                                        </div>
                                        <div className="text-[10px]" style={{ color: INK_SOFT }}>好感 {c.affection} · 信任 {c.trust} · 嫉妒 {c.jealousy} · 心情 {c.mood}</div>
                                    </button>
                                    <button onClick={() => setSecondary(c.charId)} disabled={primary === c.charId}
                                        className="px-2 py-1 rounded-full text-[10px] font-bold active:scale-95 transition-transform disabled:opacity-35"
                                        style={{ background: isSecondary ? INK : 'rgba(255,247,232,0.85)', color: isSecondary ? PAPER : INK, border: '1px solid rgba(201,154,58,0.45)' }}>
                                        调停乙
                                    </button>
                                </div>
                            </PaperCard>
                        );
                    })}
                </div>

                <PaperCard className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5 mb-2">
                        <Scroll size={14} weight="fill" />
                        <span className="text-[12px] font-black" style={{ color: INK }}>自拟谕旨</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <input value={draftText} onChange={e => setDraftText(e.target.value.slice(0, 140))} onKeyDown={e => { if (e.key === 'Enter') sendDraft(); }}
                            placeholder="写一句想落下的恩宠、赏罚或调停" className="flex-1 min-w-0 px-3 py-2 text-[12px] rounded-full outline-none" style={inputStyle} />
                        <button onClick={sendDraft} disabled={!ready || !draftText.trim()} className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center active:scale-95 transition-transform disabled:opacity-40" style={{ background: INK, color: PAPER }}>
                            <PaperPlaneRight size={15} weight="fill" />
                        </button>
                    </div>
                </PaperCard>

                <div className="space-y-1.5">
                    {(game.favorLedger || []).slice(0, 6).map(entry => (
                        <div key={entry.id} className="px-2.5 py-1.5 rounded-lg text-[11px] leading-snug" style={{ background: 'rgba(255,247,232,0.72)', border: '1px solid rgba(201,154,58,0.32)', color: '#694036' }}>
                            <span className="font-black" style={{ color: INK }}>第{entry.day}日{entry.time} · {entry.title}</span>
                            <span> · {entry.actionText}</span>
                        </div>
                    ))}
                </div>
            </div>
        </PaperSheet>
    );
};

const FavorDraftDialog: React.FC<{ draft: { preview: StoryFavorPreview; input: StoryFavorActionInput } | null; game: StoryState; busy: boolean; onCancel: () => void; onConfirm: () => void }> = ({ draft, game, busy, onCancel, onConfirm }) => {
    const preview = draft?.preview || null;
    const relLines = preview?.relationshipDelta.map(r => `${game.characters[r.a]?.name || r.a} / ${game.characters[r.b]?.name || r.b} 羁绊 ${r.bond > 0 ? '+' : ''}${r.bond}`) || [];
    return (
        <PaperDialog open={!!preview} onClose={onCancel} en="FAVOR DECREE" maxWidth={350}>
            {preview && (
                <div className="max-h-[66vh] overflow-y-auto no-scrollbar text-left">
                    <div className="flex items-start gap-2.5 mb-3">
                        <Stamp size={40} color={preview.risk === 'high' ? 'ink' : preview.risk === 'mid' ? 'amber' : 'rose'}><Crown size={20} weight="fill" /></Stamp>
                        <div className="min-w-0 flex-1">
                            <div className="text-[16px] font-black leading-tight" style={{ color: INK }}>{preview.title}</div>
                            <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: INK, color: PAPER }}>{RISK_LABEL[preview.risk]}</span>
                                <span className="text-[10px]" style={{ color: INK_SOFT }}>{preview.actionText}</span>
                            </div>
                        </div>
                    </div>
                    <p className="text-[13px] leading-relaxed mb-3" style={{ color: '#3a362f' }}>{preview.message || '这道谕旨会牵动宫中人心。'}</p>
                    {preview.blockers.length > 0 && (
                        <StickyNote color="butter" className="px-3 py-2 mb-2 text-[11px]">
                            {preview.blockers.join('；')}
                        </StickyNote>
                    )}
                    <div className="grid grid-cols-2 gap-2 mb-2">
                        <PaperCard className="px-2.5 py-2">
                            <div className="text-[10px] font-black mb-1" style={{ color: INK }}>资源</div>
                            <div className="space-y-0.5">
                                {formatResourceDelta(preview.resourceDelta).map(line => <div key={line} className="text-[11px]" style={{ color: INK_SOFT }}>{line}</div>)}
                            </div>
                        </PaperCard>
                        <PaperCard className="px-2.5 py-2">
                            <div className="text-[10px] font-black mb-1" style={{ color: INK }}>人物</div>
                            <div className="space-y-0.5">
                                {preview.effects.length ? preview.effects.map(e => <div key={e.charId} className="text-[11px]" style={{ color: INK_SOFT }}>{formatFavorEffect(game, e)}</div>) : <div className="text-[11px]" style={{ color: INK_SOFT }}>无显著变动</div>}
                            </div>
                        </PaperCard>
                    </div>
                    {relLines.length > 0 && (
                        <PaperCard className="px-3 py-2.5 mb-2">
                            <div className="text-[10px] font-black mb-1" style={{ color: INK }}>关系</div>
                            {relLines.map(line => <div key={line} className="text-[11px]" style={{ color: INK_SOFT }}>{line}</div>)}
                        </PaperCard>
                    )}
                    <div className="flex gap-2 mt-3">
                        <ScrapButton variant="paper" onClick={onCancel} disabled={busy} className="flex-1 py-2.5 text-[12px]">撤回</ScrapButton>
                        <ScrapButton variant="ink" onClick={onConfirm} disabled={busy || !preview.ok} className="flex-1 py-2.5 text-[12px]" icon={<PaperPlaneRight size={13} weight="fill" />}>照旨落下</ScrapButton>
                    </div>
                </div>
            )}
        </PaperDialog>
    );
};

const PalaceMapSheet: React.FC<{ open: boolean; onClose: () => void; game: StoryState; ready: boolean; onAction: (loc: PalaceLocation, action: PalaceActionType) => void; onPlan: (loc: PalaceLocation) => void }> = ({ open, onClose, game, ready, onAction, onPlan }) => {
    const locs = availableLocations(game);
    return (
        <PaperSheet open={open} onClose={onClose} tape="amber" title="宫苑地图 · 何处起笔">
            <div className="mb-2">
                <ResourceStrip resources={game.resources} />
            </div>
            {!ready && <StickyNote color="butter" className="px-3 py-2 mb-2 text-[11px]">读完当前一幕，方可改道前往宫苑。</StickyNote>}
            <div className="max-h-[54vh] overflow-y-auto no-scrollbar space-y-2">
                {locs.map(loc => (
                    <PaperCard key={loc.id} className="px-3 py-2.5">
                        <div className="flex items-start gap-2">
                            <Stamp size={32} color={loc.id === game.map.lastLocationId ? 'rose' : 'amber'}><MapPin size={16} weight="fill" /></Stamp>
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                    <span className="text-[13px] font-black" style={{ color: INK }}>{loc.name}</span>
                                    <span className="text-[9px]" style={{ color: INK_SOFT }}>访 {game.map.visited[loc.id] || 0}</span>
                                </div>
                                <div className="text-[11px] leading-snug mt-0.5" style={{ color: '#694036' }}>{loc.blurb}</div>
                                <div className="flex gap-1.5 flex-wrap mt-2">
                                    <button disabled={!ready} onClick={() => onPlan(loc)} className="px-2 py-1 rounded-full text-[10px] font-bold active:scale-95 transition-transform disabled:opacity-40" style={{ background: INK, color: PAPER, border: '1px solid rgba(201,154,58,0.45)' }}>
                                        谋划
                                    </button>
                                    {loc.actions.map(action => (
                                        <button key={action} disabled={!ready} onClick={() => onAction(loc, action)} className="px-2 py-1 rounded-full text-[10px] font-bold active:scale-95 transition-transform disabled:opacity-40" style={{ background: action === 'chapter' ? INK : 'rgba(255,247,232,0.86)', color: action === 'chapter' ? PAPER : INK, border: '1px solid rgba(201,154,58,0.45)' }}>
                                            {PALACE_ACTION_LABELS[action]}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </PaperCard>
                ))}
            </div>
        </PaperSheet>
    );
};

const ProgressSheet: React.FC<{ open: boolean; onClose: () => void; game: StoryState; ready: boolean; onJudgeObjective: (objective: StoryObjective) => void }> = ({ open, onClose, game, ready, onJudgeObjective }) => (
    <PaperSheet open={open} onClose={onClose} tape="ink" title="章节卷轴 · 主线与支线">
        <PaperCard className="px-3 py-3 mb-3">
            <div className="flex items-center gap-2">
                <Stamp size={38} color="rose"><Scroll size={20} weight="fill" /></Stamp>
                <div className="flex-1 min-w-0">
                    <div className="text-[14px] font-black" style={{ color: INK }}>第 {game.chapter.index} 章 · {game.chapter.title}</div>
                    <div className="text-[11px] leading-snug" style={{ color: INK_SOFT }}>{game.chapter.subtitle}</div>
                    <div className="mt-2 h-2 rounded-full overflow-hidden" style={{ background: 'rgba(90,35,28,0.12)' }}>
                        <div className="h-full rounded-full" style={{ width: `${Math.min(100, (game.chapter.progress / Math.max(1, game.chapter.goal)) * 100)}%`, background: 'linear-gradient(90deg, #8a1f2b, #d7a84a)' }} />
                    </div>
                </div>
            </div>
        </PaperCard>
        <div className="max-h-[50vh] overflow-y-auto no-scrollbar space-y-2">
            {game.objectives.map(o => <ObjectiveCard key={o.id} objective={o} ready={ready} onJudge={onJudgeObjective} />)}
            {(game.generatedHooks?.length || game.rumors?.length || game.npcStubs?.length) ? <GeneratedIntel game={game} /> : null}
        </div>
    </PaperSheet>
);

const ObjectiveCard: React.FC<{ objective: StoryObjective; ready?: boolean; onJudge?: (objective: StoryObjective) => void }> = ({ objective, ready = false, onJudge }) => (
    <PaperCard className="px-3 py-2.5">
        <div className="flex items-start gap-2">
            <Stamp size={28} color={objective.done ? 'sage' : objective.kind === 'main' ? 'rose' : 'amber'}>{objective.kind === 'main' ? <Crown size={15} weight="fill" /> : <Scroll size={15} weight="fill" />}</Stamp>
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                    <span className="text-[13px] font-black" style={{ color: INK }}>{objective.title}</span>
                    <span className="text-[9px] font-bold" style={{ color: objective.done ? '#2f766d' : INK_SOFT }}>{objective.done ? '已成' : `${objective.progress}/${objective.target}`}</span>
                </div>
                <div className="text-[11px] leading-snug" style={{ color: '#694036' }}>{objective.description}</div>
                <div className="mt-1.5 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(90,35,28,0.12)' }}>
                    <div className="h-full rounded-full" style={{ width: `${Math.min(100, (objective.progress / Math.max(1, objective.target)) * 100)}%`, background: objective.done ? '#2f766d' : '#d7a84a' }} />
                </div>
                {onJudge && !objective.done && (
                    <button disabled={!ready} onClick={() => onJudge(objective)} className="mt-2 px-2 py-1 rounded-full text-[10px] font-bold active:scale-95 transition-transform disabled:opacity-40" style={{ background: 'rgba(255,247,232,0.9)', border: '1px solid rgba(201,154,58,0.45)', color: INK }}>
                        请 AI 出谋划策
                    </button>
                )}
            </div>
        </div>
    </PaperCard>
);

const GeneratedIntel: React.FC<{ game: StoryState }> = ({ game }) => (
    <PaperCard className="px-3 py-2.5">
        <div className="flex items-center gap-1.5 mb-2">
            <Stamp size={26} color="ink"><Eye size={14} weight="fill" /></Stamp>
            <div className="text-[13px] font-black" style={{ color: INK }}>判官暗线</div>
        </div>
        <div className="space-y-1.5">
            {game.generatedHooks.slice(0, 6).map(h => (
                <div key={h.id} className="text-[11px] leading-snug px-2 py-1 rounded-lg" style={{ background: 'rgba(232,228,217,0.5)', color: '#4a463f' }}>
                    <span className="font-black" style={{ color: INK }}>{h.title}</span> · {h.summary}
                    <span className="ml-1" style={{ color: INK_SOFT }}>至第{h.expiresDay}日</span>
                </div>
            ))}
            {game.rumors.slice(0, 6).map(r => (
                <div key={r.id} className="text-[11px] leading-snug px-2 py-1 rounded-lg" style={{ background: 'rgba(255,247,232,0.75)', color: '#694036' }}>
                    风闻{r.heat} · {r.text}
                    <span className="ml-1" style={{ color: INK_SOFT }}>至第{r.expiresDay}日</span>
                </div>
            ))}
            {game.npcStubs.slice(0, 5).map(n => (
                <div key={n.id} className="text-[11px] leading-snug px-2 py-1 rounded-lg" style={{ background: 'rgba(31,29,26,0.06)', color: '#4a463f' }}>
                    <span className="font-black" style={{ color: INK }}>{n.name}</span>/{n.role} · {n.summary}
                </div>
            ))}
        </div>
    </PaperCard>
);

const InventorySheet: React.FC<{ open: boolean; onClose: () => void; items: StoryInventoryItem[]; chars: Record<string, StoryChar>; ready: boolean; onJudgeItem: (item: StoryInventoryItem) => void }> = ({ open, onClose, items, chars, ready, onJudgeItem }) => (
    <PaperSheet open={open} onClose={onClose} tape="amber" title="背包线索 · 暗线成册">
        <div className="max-h-[56vh] overflow-y-auto no-scrollbar space-y-2">
            {items.length === 0 && <div className="text-center py-8 text-[12px]" style={{ color: INK_SOFT }}>尚无收入册中的线索或信物。</div>}
            {items.map(it => (
                <PaperCard key={it.id} className="px-3 py-2.5">
                    <div className="flex items-start gap-2">
                        <Stamp size={30} color={it.kind === 'gift' ? 'rose' : it.kind === 'edict' ? 'ink' : 'amber'}>{it.kind === 'gift' ? <TreasureChest size={15} weight="fill" /> : <BookOpen size={15} weight="fill" />}</Stamp>
                        <div className="min-w-0 flex-1">
                            <div className="text-[13px] font-black" style={{ color: INK }}>{it.name}</div>
                            <div className="text-[11.5px] leading-snug" style={{ color: '#694036' }}>{it.text}</div>
                            <button disabled={!ready} onClick={() => onJudgeItem(it)} className="mt-2 px-2 py-1 rounded-full text-[10px] font-bold active:scale-95 transition-transform disabled:opacity-40" style={{ background: 'rgba(255,247,232,0.9)', border: '1px solid rgba(201,154,58,0.45)', color: INK }}>
                                追查/使用
                            </button>
                            <div className="text-[9px] mt-1" style={{ color: INK_SOFT }}>第 {it.day} 日{it.charId && chars[it.charId] ? ` · ${chars[it.charId].name}` : ''}{it.source ? ` · ${it.source}` : ''}</div>
                        </div>
                    </div>
                </PaperCard>
            ))}
        </div>
    </PaperSheet>
);

const judgementResourceLines = (judgement: StoryActionJudgement): string[] => {
    const out: string[] = [];
    for (const k of RESOURCE_KEYS_UI) {
        const cost = judgement.cost?.[k] || 0;
        const reward = judgement.reward?.[k] || 0;
        const total = cost + reward;
        if (total) out.push(`${STORY_RESOURCE_LABELS[k]} ${total > 0 ? '+' : ''}${total}`);
    }
    return out;
};

const JudgementPreview: React.FC<{ judgement: StoryActionJudgement | null; game: StoryState; busy: boolean; onCancel: () => void; onConfirm: () => void }> = ({ judgement, game, busy, onCancel, onConfirm }) => {
    const loc = judgement?.mapIntent ? availableLocations(game).find(l => l.id === judgement.mapIntent?.locationId) : null;
    const resourceLines = judgement ? judgementResourceLines(judgement) : [];
    const objectiveUpdates = judgement?.objectiveUpdates || [];
    const inventoryUpdates = judgement?.inventoryUpdates || [];
    const achievementUpdates = judgement?.achievementUpdates || [];
    const generatedHooks = judgement?.generatedHooks || [];
    const rumors = judgement?.rumors || [];
    const npcStubs = judgement?.npcStubs || [];
    return (
        <PaperDialog open={!!judgement} onClose={onCancel} en="COURT VERDICT" maxWidth={360}>
            {judgement && (
                <div className="max-h-[68vh] overflow-y-auto no-scrollbar">
                    <div className="flex items-start gap-2.5 mb-3">
                        <Stamp size={40} color={judgement.risk === 'high' ? 'ink' : judgement.risk === 'low' ? 'sage' : 'amber'}><Scroll size={20} weight="fill" /></Stamp>
                        <div className="min-w-0 flex-1">
                            <div className="text-[16px] font-black leading-tight" style={{ color: INK }}>{judgement.title}</div>
                            <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: INK, color: PAPER }}>{RISK_LABEL[judgement.risk]}</span>
                                <span className="text-[10px]" style={{ color: INK_SOFT }}>把握 {judgement.confidence}%</span>
                                <span className="text-[10px]" style={{ color: INK_SOFT }}>{judgement.entryPoint}</span>
                            </div>
                        </div>
                    </div>
                    <p className="text-[13px] leading-relaxed mb-3" style={{ color: '#3a362f' }}>{judgement.verdict}</p>
                    <PaperCard className="px-3 py-2.5 mb-2">
                        <div className="text-[11px] font-black mb-1" style={{ color: INK }}>将行之事</div>
                        <div className="text-[12.5px] leading-snug" style={{ color: '#694036' }}>{judgement.actionText}</div>
                        {judgement.nextIntent && <div className="text-[10px] mt-1" style={{ color: INK_SOFT }}>{judgement.nextIntent}</div>}
                    </PaperCard>
                    <div className="grid grid-cols-2 gap-2 mb-2">
                        <PaperCard className="px-2.5 py-2">
                            <div className="text-[10px] font-black mb-1" style={{ color: INK }}>资源</div>
                            <div className="text-[11px] leading-snug" style={{ color: INK_SOFT }}>{resourceLines.length ? resourceLines.join(' / ') : '无显著变动'}</div>
                        </PaperCard>
                        <PaperCard className="px-2.5 py-2">
                            <div className="text-[10px] font-black mb-1" style={{ color: INK }}>牵动</div>
                            <div className="text-[11px] leading-snug" style={{ color: INK_SOFT }}>
                                {judgement.involvedCharIds.length ? judgement.involvedCharIds.map(id => game.characters[id]?.name).filter(Boolean).join('、') : '无指定人物'}
                                {loc ? ` · ${loc.name}` : ''}
                            </div>
                        </PaperCard>
                    </div>
                    {(inventoryUpdates.length || generatedHooks.length || rumors.length || npcStubs.length || objectiveUpdates.length || achievementUpdates.length) ? (
                        <PaperCard className="px-3 py-2.5 mb-3">
                            <div className="text-[11px] font-black mb-1" style={{ color: INK }}>入局内容</div>
                            <div className="space-y-1">
                                {objectiveUpdates.map((o, i) => <div key={`o${i}`} className="text-[11px]" style={{ color: '#4a463f' }}>目标 {o.id || '当前主线'} {o.done ? '完成' : `+${o.progress || 0}`}</div>)}
                                {inventoryUpdates.map(i => <div key={`i${i.id || i.name}`} className="text-[11px]" style={{ color: '#4a463f' }}>线索 {i.name}</div>)}
                                {generatedHooks.map(h => <div key={h.id} className="text-[11px]" style={{ color: '#4a463f' }}>暗线 {h.title}</div>)}
                                {rumors.map(r => <div key={r.id} className="text-[11px]" style={{ color: '#4a463f' }}>风闻 {r.text}</div>)}
                                {npcStubs.map(n => <div key={n.id} className="text-[11px]" style={{ color: '#4a463f' }}>临时人物 {n.name}</div>)}
                                {achievementUpdates.map(a => <div key={typeof a === 'string' ? a : a.id} className="text-[11px]" style={{ color: '#4a463f' }}>印记 {typeof a === 'string' ? a : a.title || a.id}</div>)}
                            </div>
                        </PaperCard>
                    ) : null}
                    <div className="flex gap-2 mt-3">
                        <ScrapButton variant="paper" onClick={onCancel} disabled={busy} className="flex-1 py-2.5 text-[12px]">撤回</ScrapButton>
                        <ScrapButton variant="ink" onClick={onConfirm} disabled={busy} className="flex-1 py-2.5 text-[12px]" icon={<PaperPlaneRight size={13} weight="fill" />}>照此落子</ScrapButton>
                    </div>
                </div>
            )}
        </PaperDialog>
    );
};

const AchievementSheet: React.FC<{ open: boolean; onClose: () => void; achievements: StoryAchievement[] }> = ({ open, onClose, achievements }) => (
    <PaperSheet open={open} onClose={onClose} tape="rose" title="成就册 · 金泥小印">
        <div className="max-h-[56vh] overflow-y-auto no-scrollbar space-y-2">
            {achievements.length === 0 && <div className="text-center py-8 text-[12px]" style={{ color: INK_SOFT }}>尚无成就落印。长线推进、收集线索或稳住人心后会逐步解锁。</div>}
            {achievements.map(a => (
                <PaperCard key={a.id} className="px-3 py-2.5">
                    <div className="flex items-center gap-2.5">
                        <Stamp size={34} color="amber"><Medal size={18} weight="fill" /></Stamp>
                        <div className="min-w-0">
                            <div className="text-[13px] font-black" style={{ color: INK }}>{a.title}</div>
                            <div className="text-[11px] leading-snug" style={{ color: '#694036' }}>{a.description}</div>
                        </div>
                    </div>
                </PaperCard>
            ))}
        </div>
    </PaperSheet>
);

const GenderCycle: React.FC<{ value: Gender; onChange: (g: Gender) => void }> = ({ value, onChange }) => {
    const m = GENDER_GLYPH[value];
    return (
        <button onClick={() => onChange(GENDER_ORDER[(GENDER_ORDER.indexOf(value) + 1) % GENDER_ORDER.length])}
            className="shrink-0 px-2.5 py-2 rounded-lg text-[12.5px] font-black active:scale-95 transition-transform"
            style={value === 'unknown' ? { background: 'rgba(58,35,35,0.06)', color: INK_SOFT, border: '1px solid rgba(180,168,146,0.5)' } : activePillStyle}
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
    <button onClick={onClick} className="px-2.5 py-1 rounded-full text-[11px] font-bold shrink-0 active:scale-95 transition-transform" style={active ? activePillStyle : quietPillStyle}>{children}</button>
);

const openPanel: React.CSSProperties = {
    background: 'linear-gradient(180deg, rgba(251,246,236,0.92), rgba(238,229,211,0.88))',
    border: '1px solid rgba(180,168,146,0.46)', outline: '1px dashed rgba(150,144,132,0.28)', outlineOffset: '-5px',
    borderRadius: 14, boxShadow: '0 10px 20px -17px rgba(31,29,26,0.42)',
};
const inputStyle: React.CSSProperties = {
    background: 'rgba(251,244,234,0.84)', border: '1px solid rgba(180,168,146,0.5)', color: INK,
};
const dialogueBox: React.CSSProperties = {
    background: 'linear-gradient(180deg, rgba(251,246,236,0.95), rgba(239,233,222,0.95))',
    border: '1px solid rgba(180,168,146,0.52)', outline: '1px dashed rgba(150,144,132,0.26)', outlineOffset: -4,
    boxShadow: '0 12px 24px -19px rgba(31,29,26,0.44)',
};

export default StoryMode;
