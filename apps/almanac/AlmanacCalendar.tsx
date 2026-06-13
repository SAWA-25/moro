import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useOS } from '../../context/OSContext';
import { DB } from '../../utils/db';
import { CalendarMark, CharacterProfile } from '../../types';
import { ContextBuilder } from '../../utils/context';
import { safeResponseJson } from '../../utils/safeApi';
import { injectMemoryPalace } from '../../utils/memoryPalace/pipeline';
import { PaperPage, PaperNote, WashiTape, TapeLabel, Postmark, HAND_FONT, tinyRotate } from './handbookKit';

/**
 * 岁时记 · 实时日历（拼贴手账风）
 * ------------------------------------------------------------
 * - 真实月历，今天用手绘圈标出，可前后翻月
 * - 用户：点某天 → 贴一张便签（文字 + 胶带色 + 小贴纸），可改可撕
 * - 角色：按各自人设，AI 自己往未来某些天贴"想和你做的事 / 在意的日子"，
 *   带头像与专属色；同时写进聊天记忆（和纪念日感想一致）。每角色限频生成。
 */

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const MARK_COLORS = ['#e7a39c', '#e6c178', '#9ec9a3', '#9bbfe0', '#c4a6dd', '#d9846a'];
const STICKERS = ['📌', '🌷', '💌', '⭐', '☕', '🍰', '🎬', '📷', '🌙', '🍀'];

const pad2 = (n: number) => String(n).padStart(2, '0');
const toKey = (y: number, m: number, d: number) => `${y}-${pad2(m + 1)}-${pad2(d)}`;
const todayKey = () => {
    const n = new Date();
    return toKey(n.getFullYear(), n.getMonth(), n.getDate());
};
/** 角色专属色：用 id 散列到暖色盘，保证同一角色每次都同色。 */
const colorForChar = (id: string) => {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffff;
    return MARK_COLORS[h % MARK_COLORS.length];
};
const GEN_THROTTLE_MS = 3 * 24 * 60 * 60 * 1000; // 同一角色 3 天最多自标一次

/** 从模型返回里抠出 JSON 数组（容忍 ```json 包裹 / 前后废话）。 */
const parseMarkJson = (raw: string): { date: string; text: string }[] => {
    if (!raw) return [];
    let s = raw.trim().replace(/```json/gi, '').replace(/```/g, '').trim();
    const start = s.indexOf('[');
    const end = s.lastIndexOf(']');
    if (start === -1 || end === -1 || end < start) return [];
    try {
        const arr = JSON.parse(s.slice(start, end + 1));
        if (!Array.isArray(arr)) return [];
        return arr
            .map((x: any) => ({ date: String(x?.date || '').trim(), text: String(x?.text || '').trim() }))
            .filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.date) && x.text);
    } catch {
        return [];
    }
};

const AlmanacCalendar: React.FC<{ onExit: () => void }> = ({ onExit }) => {
    const { characters, activeCharacterId, apiConfig, addToast, userProfile } = useOS();

    const [marks, setMarks] = useState<CalendarMark[]>([]);
    const now = new Date();
    const [viewY, setViewY] = useState(now.getFullYear());
    const [viewM, setViewM] = useState(now.getMonth());
    const [selected, setSelected] = useState<string | null>(null);
    const [generating, setGenerating] = useState(false);
    const [showCharPick, setShowCharPick] = useState(false);

    // 便签草稿
    const [draftText, setDraftText] = useState('');
    const [draftColor, setDraftColor] = useState(MARK_COLORS[0]);
    const [draftEmoji, setDraftEmoji] = useState('📌');
    const [editingId, setEditingId] = useState<string | null>(null);

    const autoRan = useRef(false);

    useEffect(() => {
        DB.getAllCalendarMarks().then((m) => setMarks(m)).catch(() => {});
    }, []);

    const marksByDate = useMemo(() => {
        const map: Record<string, CalendarMark[]> = {};
        for (const mk of marks) (map[mk.date] ||= []).push(mk);
        return map;
    }, [marks]);

    // 月历网格
    const grid = useMemo(() => {
        const first = new Date(viewY, viewM, 1).getDay(); // 0=周日
        const days = new Date(viewY, viewM + 1, 0).getDate();
        const cells: (string | null)[] = [];
        for (let i = 0; i < first; i++) cells.push(null);
        for (let d = 1; d <= days; d++) cells.push(toKey(viewY, viewM, d));
        while (cells.length % 7 !== 0) cells.push(null);
        return cells;
    }, [viewY, viewM]);

    const tKey = todayKey();

    const stepMonth = (delta: number) => {
        let m = viewM + delta;
        let y = viewY;
        if (m < 0) { m = 11; y--; }
        if (m > 11) { m = 0; y++; }
        setViewM(m);
        setViewY(y);
    };

    // ---- 角色自标（AI） ----
    const genCharMarks = useCallback(async (char: CharacterProfile, quiet: boolean) => {
        if (!char || !apiConfig.apiKey) {
            if (!quiet) addToast('还没配置 API，角色先记不了', 'info');
            return;
        }
        setGenerating(true);
        if (!quiet) addToast(`${char.name} 正在翻日历……`, 'info');
        try {
            await injectMemoryPalace(char, undefined, '日历');
            const baseContext = ContextBuilder.buildCoreContext(char, userProfile);
            const today = todayKey();
            const userPrompt = `
### 场景：在共享日历上做标记
今天是 ${today}。你正翻看你和 ${userProfile.name} 的共享日历，想亲手往未来的某几天贴上你自己在意的事。

### 任务
请挑 2 到 4 个 **今天之后、且在 45 天以内** 的日期，每个写一句很短的、第一人称的小标记——可以是想和 ${userProfile.name} 一起做的事、你自己惦记的日子、或某种期待。要完全贴合你的人设语气。

**输出要求**（严格遵守）：
- 只输出一个 JSON 数组，不要任何额外文字、解释或代码块标记。
- 每个元素形如 {"date":"YYYY-MM-DD","text":"……"}。
- text 不超过 14 个字，第一人称，不加引号。
- date 必须在 ${today} 之后、45 天以内。
- **必须使用用户常用语言**。`;

            const res = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiConfig.apiKey}` },
                body: JSON.stringify({ model: apiConfig.model, messages: [
                    { role: 'system', content: baseContext },
                    { role: 'user', content: userPrompt },
                ], temperature: 0.9, max_tokens: 8000 }),
            });
            if (!res.ok) throw new Error(`API ${res.status}`);
            const data = await safeResponseJson(res);
            const text = data.choices?.[0]?.message?.content?.trim() || '';
            const items = parseMarkJson(text).filter((it) => it.date > today).slice(0, 4);
            if (items.length === 0) {
                if (!quiet) addToast(`${char.name} 这次没记下什么`, 'info');
                return;
            }

            const color = colorForChar(char.id);
            const existing = await DB.getAllCalendarMarks();
            const created: CalendarMark[] = [];
            for (const it of items) {
                const dup = existing.some(
                    (e) => e.author === 'character' && e.charId === char.id && e.date === it.date && e.text === it.text,
                );
                if (dup) continue;
                const mk: CalendarMark = {
                    id: `cm-${char.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    date: it.date,
                    text: it.text,
                    author: 'character',
                    charId: char.id,
                    color,
                    createdAt: Date.now(),
                };
                await DB.saveCalendarMark(mk);
                created.push(mk);
            }
            if (created.length === 0) {
                if (!quiet) addToast(`${char.name} 想记的，日历上都有了`, 'info');
                return;
            }
            setMarks((prev) => [...prev, ...created]);

            // 写进聊天记忆，让这件事进得了上下文（与纪念日感想一致）
            const summary = created.map((c) => `${c.date}「${c.text}」`).join('、');
            await DB.saveMessage({
                charId: char.id,
                role: 'system',
                type: 'text',
                content: `[系统: ${char.name} 在和 ${userProfile.name} 的共享日历上贴了几张便签：${summary}]`,
            });
            if (!quiet) addToast(`${char.name} 往日历上贴了 ${created.length} 张便签`, 'success');
        } catch (e: any) {
            if (!quiet) addToast(`没记成：${e?.message || '未知错误'}`, 'error');
        } finally {
            setGenerating(false);
        }
    }, [apiConfig, userProfile, addToast]);

    // 进页面后，给当前角色限频自标一次，让日历"活"起来
    useEffect(() => {
        if (autoRan.current) return;
        const char = characters.find((c) => c.id === activeCharacterId) || characters[0];
        if (!char || !apiConfig.apiKey) return;
        autoRan.current = true;
        const k = `almanac_cal_gen_${char.id}`;
        const last = Number(localStorage.getItem(k) || 0);
        if (Date.now() - last < GEN_THROTTLE_MS) return;
        localStorage.setItem(k, String(Date.now()));
        genCharMarks(char, true);
    }, [characters, activeCharacterId, apiConfig.apiKey, genCharMarks]);

    // ---- 用户便签增删改 ----
    const openDay = (key: string) => {
        setSelected(key);
        setEditingId(null);
        setDraftText('');
        setDraftColor(MARK_COLORS[0]);
        setDraftEmoji('📌');
    };

    const saveDraft = async () => {
        if (!selected || !draftText.trim()) return;
        if (editingId) {
            const old = marks.find((m) => m.id === editingId);
            if (!old) return;
            const upd: CalendarMark = { ...old, text: draftText.trim(), color: draftColor, emoji: draftEmoji };
            await DB.saveCalendarMark(upd);
            setMarks((prev) => prev.map((m) => (m.id === editingId ? upd : m)));
        } else {
            const mk: CalendarMark = {
                id: `cm-user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                date: selected,
                text: draftText.trim(),
                author: 'user',
                color: draftColor,
                emoji: draftEmoji,
                createdAt: Date.now(),
            };
            await DB.saveCalendarMark(mk);
            setMarks((prev) => [...prev, mk]);
        }
        setEditingId(null);
        setDraftText('');
    };

    const startEdit = (m: CalendarMark) => {
        setEditingId(m.id);
        setDraftText(m.text);
        setDraftColor(m.color || MARK_COLORS[0]);
        setDraftEmoji(m.emoji || '📌');
    };

    const removeMark = async (id: string) => {
        await DB.deleteCalendarMark(id);
        setMarks((prev) => prev.filter((m) => m.id !== id));
        if (editingId === id) { setEditingId(null); setDraftText(''); }
    };

    const charById = (id?: string) => characters.find((c) => c.id === id);
    const monthLabel = `${viewY} 年 ${viewM + 1} 月`;
    const selectedMarks = selected ? marksByDate[selected] || [] : [];
    const selDateObj = selected ? new Date(selected + 'T00:00:00') : null;

    const triggerManualGen = () => {
        if (characters.length === 0) { addToast('还没有角色', 'info'); return; }
        if (characters.length === 1) { genCharMarks(characters[0], false); return; }
        setShowCharPick(true);
    };

    return (
        <PaperPage kind="grid" style={{ paddingTop: 'var(--safe-top)' }}>
            <div className="h-full flex flex-col" style={{ color: '#4a3b2e' }}>
                {/* 顶栏 */}
                <div className="relative flex items-center justify-between px-4 pt-3 pb-2 shrink-0 z-10">
                    <button
                        onClick={onExit}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-[12px] font-bold active:scale-95 transition-transform"
                        style={{ background: '#fffdf7', boxShadow: '0 2px 6px rgba(96,66,40,0.18)', transform: 'rotate(-1.5deg)', color: '#7a5c44' }}
                    >
                        ← 合上
                    </button>
                    <div className="text-center select-none" style={{ fontFamily: HAND_FONT }}>
                        <div className="text-[20px] font-black leading-none" style={{ color: '#5b4636' }}>这个月</div>
                        <div className="text-[10px] tracking-[0.3em] mt-0.5" style={{ color: '#a98e6f' }}>MONTHLY SPREAD</div>
                    </div>
                    <button
                        onClick={triggerManualGen}
                        disabled={generating}
                        className="active:scale-95 transition-transform disabled:opacity-50"
                        title="请角色记一笔"
                    >
                        <Postmark size={42} color="#b1543f" rotate={-12}>
                            {generating ? '…' : '请记'}
                        </Postmark>
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto no-scrollbar px-4 pb-8 z-10">
                    {/* 月历纸 */}
                    <PaperNote className="mt-2 px-3 pt-7 pb-4" rotate={-0.6}>
                        <WashiTape className="-top-3 left-1/2 -translate-x-1/2" color="rgba(158,201,163,0.7)" rotate={3} width={92} height={24} />
                        {/* 月份切换 */}
                        <div className="flex items-center justify-between mb-3 px-1">
                            <button onClick={() => stepMonth(-1)} className="px-2 py-1 text-[18px] active:scale-90 transition-transform" style={{ color: '#a98e6f' }}>‹</button>
                            <div className="text-[18px] font-black" style={{ fontFamily: HAND_FONT, color: '#5b4636' }}>{monthLabel}</div>
                            <button onClick={() => stepMonth(1)} className="px-2 py-1 text-[18px] active:scale-90 transition-transform" style={{ color: '#a98e6f' }}>›</button>
                        </div>
                        {/* 星期 */}
                        <div className="grid grid-cols-7 mb-1">
                            {WEEK.map((w, i) => (
                                <div key={w} className="text-center text-[10px] font-bold py-1" style={{ color: i === 0 || i === 6 ? '#c08a6a' : '#9a8262' }}>{w}</div>
                            ))}
                        </div>
                        {/* 日格 */}
                        <div className="grid grid-cols-7 gap-y-0.5" style={{ borderTop: '1px dashed #d8c7a8' }}>
                            {grid.map((key, idx) => {
                                if (!key) return <div key={`e-${idx}`} className="aspect-square" style={{ borderBottom: '1px dashed #e6dcc6', borderRight: idx % 7 !== 6 ? '1px dashed #e6dcc6' : 'none' }} />;
                                const dnum = Number(key.slice(-2));
                                const dayMarks = marksByDate[key] || [];
                                const isToday = key === tKey;
                                return (
                                    <button
                                        key={key}
                                        onClick={() => openDay(key)}
                                        className="aspect-square relative flex flex-col items-center pt-1 active:scale-95 transition-transform"
                                        style={{ borderBottom: '1px dashed #e6dcc6', borderRight: idx % 7 !== 6 ? '1px dashed #e6dcc6' : 'none' }}
                                    >
                                        <span
                                            className="text-[12px] font-bold flex items-center justify-center"
                                            style={isToday ? {
                                                width: 20, height: 20, color: '#b1543f',
                                                border: '2px solid #d98a6a', borderRadius: '60% 40% 55% 45%',
                                                fontFamily: HAND_FONT,
                                            } : { color: '#5b4636', fontFamily: HAND_FONT }}
                                        >
                                            {dnum}
                                        </span>
                                        {/* 标记点 */}
                                        <div className="flex flex-wrap gap-0.5 justify-center mt-0.5 px-0.5">
                                            {dayMarks.slice(0, 3).map((m) => (
                                                <span key={m.id} className="w-1.5 h-1.5 rounded-full" style={{ background: m.color || '#e7a39c' }} />
                                            ))}
                                            {dayMarks.length > 3 && <span className="text-[7px] leading-none" style={{ color: '#a98e6f' }}>+{dayMarks.length - 3}</span>}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </PaperNote>

                    {/* 图例 / 提示 */}
                    <div className="flex items-center justify-center gap-4 mt-4 text-[10px]" style={{ color: '#8a7155' }}>
                        <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: '#9bbfe0' }} />点一天就能贴便签</span>
                        <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: '#b1543f' }} />印章请角色记一笔</span>
                    </div>
                </div>
            </div>

            {/* 角色选择（多角色时手动生成）*/}
            {showCharPick && (
                <div className="fixed inset-0 z-[9998] flex items-end justify-center" onClick={() => setShowCharPick(false)}>
                    <div className="absolute inset-0 bg-black/40" />
                    <div className="relative w-full max-w-md m-3 p-5 animate-slide-up" style={{ background: '#fffdf7', boxShadow: '0 -6px 24px rgba(96,66,40,0.25)', borderRadius: 18 }} onClick={(e) => e.stopPropagation()}>
                        <div className="text-[14px] font-black mb-3" style={{ fontFamily: HAND_FONT, color: '#5b4636' }}>让谁来记一笔？</div>
                        <div className="grid grid-cols-4 gap-3 max-h-60 overflow-y-auto no-scrollbar">
                            {characters.map((c) => (
                                <button key={c.id} onClick={() => { setShowCharPick(false); genCharMarks(c, false); }} className="flex flex-col items-center gap-1 active:scale-95 transition-transform">
                                    {c.avatar?.startsWith('http') || c.avatar?.startsWith('data:')
                                        ? <img src={c.avatar} className="w-12 h-12 rounded-full object-cover" style={{ border: `2px solid ${colorForChar(c.id)}` }} />
                                        : <span className="w-12 h-12 rounded-full flex items-center justify-center text-xl" style={{ background: '#f3ead7', border: `2px solid ${colorForChar(c.id)}` }}>{c.avatar || '🌸'}</span>}
                                    <span className="text-[10px] font-bold truncate w-full text-center" style={{ color: '#5b4636' }}>{c.name}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* 某一天的便签抽屉 */}
            {selected && selDateObj && (
                <div className="fixed inset-0 z-[9999] flex items-end justify-center" onClick={() => setSelected(null)}>
                    <div className="absolute inset-0 bg-black/40 animate-fade-in" />
                    <div
                        className="relative w-full max-w-md m-2 animate-slide-up"
                        style={{ background: '#fffdf7', boxShadow: '0 -8px 28px rgba(96,66,40,0.28)', borderRadius: '20px 20px 14px 14px', maxHeight: '80vh' }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <WashiTape className="-top-2 left-8" color="rgba(231,163,156,0.7)" rotate={-14} width={70} />
                        <WashiTape className="-top-2 right-8" color="rgba(230,193,120,0.7)" rotate={12} width={70} />
                        <div className="px-5 pt-6 pb-4 overflow-y-auto no-scrollbar" style={{ maxHeight: '80vh' }}>
                            {/* 日期抬头 */}
                            <div className="flex items-end justify-between mb-3">
                                <div style={{ fontFamily: HAND_FONT }}>
                                    <div className="text-[26px] font-black leading-none" style={{ color: '#5b4636' }}>
                                        {selDateObj.getMonth() + 1} 月 {selDateObj.getDate()} 日
                                    </div>
                                    <div className="text-[11px] mt-1" style={{ color: '#a98e6f' }}>周{WEEK[selDateObj.getDay()]}{selected === tKey ? ' · 就是今天' : ''}</div>
                                </div>
                                <button onClick={() => setSelected(null)} className="text-[20px] px-2 active:scale-90 transition-transform" style={{ color: '#b8a385' }}>✕</button>
                            </div>

                            {/* 已有便签 */}
                            <div className="space-y-2 mb-4">
                                {selectedMarks.length === 0 && (
                                    <div className="text-center text-[12px] py-4" style={{ color: '#b8a385' }}>这天还空着，贴点什么吧</div>
                                )}
                                {selectedMarks.map((m) => {
                                    const ch = charById(m.charId);
                                    return (
                                        <div key={m.id} className="relative px-3 py-2 flex items-start gap-2" style={{ background: '#fff', borderLeft: `5px solid ${m.color || '#e7a39c'}`, boxShadow: '0 2px 6px rgba(96,66,40,0.12)', transform: `rotate(${tinyRotate(m.id)}deg)` }}>
                                            {m.author === 'character' && ch ? (
                                                ch.avatar?.startsWith('http') || ch.avatar?.startsWith('data:')
                                                    ? <img src={ch.avatar} className="w-7 h-7 rounded-full object-cover shrink-0 mt-0.5" />
                                                    : <span className="w-7 h-7 rounded-full flex items-center justify-center text-sm shrink-0 mt-0.5" style={{ background: '#f3ead7' }}>{ch.avatar || '🌸'}</span>
                                            ) : (
                                                <span className="text-base shrink-0 mt-0.5">{m.emoji || '📌'}</span>
                                            )}
                                            <div className="flex-1 min-w-0">
                                                <div className="text-[13px] leading-snug" style={{ color: '#4a3b2e', fontFamily: HAND_FONT, fontSize: 15 }}>{m.text}</div>
                                                <div className="text-[9px] mt-0.5" style={{ color: '#b09877' }}>
                                                    {m.author === 'character' ? `${ch?.name || '角色'} 贴的` : '我贴的'}
                                                </div>
                                            </div>
                                            <div className="flex flex-col gap-1 shrink-0">
                                                {m.author === 'user' && (
                                                    <button onClick={() => startEdit(m)} className="text-[12px] active:scale-90" style={{ color: '#9a8262' }}>✎</button>
                                                )}
                                                <button onClick={() => removeMark(m.id)} className="text-[12px] active:scale-90" style={{ color: '#c98b7a' }}>✕</button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            {/* 贴一张新便签 */}
                            <div className="pt-3" style={{ borderTop: '1px dashed #d8c7a8' }}>
                                <TapeLabel color="#e8c8a0" className="mb-2">{editingId ? '改这张便签' : '贴一张便签'}</TapeLabel>
                                <textarea
                                    value={draftText}
                                    onChange={(e) => setDraftText(e.target.value.slice(0, 40))}
                                    rows={2}
                                    placeholder="想在这天记下点什么……"
                                    className="w-full px-3 py-2 text-[14px] resize-none focus:outline-none mt-2"
                                    style={{ background: '#f7f1e4', borderRadius: 10, color: '#4a3b2e', fontFamily: HAND_FONT }}
                                />
                                {/* 胶带色 */}
                                <div className="flex items-center gap-2 mt-3">
                                    <span className="text-[10px]" style={{ color: '#9a8262' }}>色</span>
                                    {MARK_COLORS.map((c) => (
                                        <button key={c} onClick={() => setDraftColor(c)} className="w-6 h-6 rounded-full active:scale-90 transition-transform" style={{ background: c, boxShadow: draftColor === c ? '0 0 0 2px #fff, 0 0 0 4px #b1543f' : '0 1px 2px rgba(0,0,0,0.15)' }} />
                                    ))}
                                </div>
                                {/* 贴纸 */}
                                <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                                    <span className="text-[10px] mr-1" style={{ color: '#9a8262' }}>贴纸</span>
                                    {STICKERS.map((s) => (
                                        <button key={s} onClick={() => setDraftEmoji(s)} className="w-7 h-7 rounded-md text-base active:scale-90 transition-transform" style={{ background: draftEmoji === s ? '#f1e3c8' : 'transparent', boxShadow: draftEmoji === s ? 'inset 0 0 0 1.5px #d8b988' : 'none' }}>{s}</button>
                                    ))}
                                </div>
                                <div className="flex gap-2 mt-4">
                                    {editingId && (
                                        <button onClick={() => { setEditingId(null); setDraftText(''); }} className="px-4 py-2.5 text-[13px] font-bold active:scale-95 transition-transform" style={{ background: '#f0e9da', color: '#9a8262', borderRadius: 12 }}>取消</button>
                                    )}
                                    <button
                                        onClick={saveDraft}
                                        disabled={!draftText.trim()}
                                        className="flex-1 py-2.5 text-[14px] font-black active:scale-95 transition-transform disabled:opacity-40"
                                        style={{ background: '#b1543f', color: '#fff7ef', borderRadius: 12, fontFamily: HAND_FONT, letterSpacing: 1 }}
                                    >
                                        {editingId ? '改好了' : '贴上去'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </PaperPage>
    );
};

export default AlmanacCalendar;
