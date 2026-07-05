import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ArrowsClockwise,
    CalendarDots,
    CaretLeft,
    CaretRight,
    MagicWand,
    NotePencil,
    PencilSimple,
    Sparkle,
    Trash,
    X,
} from '@phosphor-icons/react';
import { useOS } from '../../context/OSContext';
import { DB } from '../../utils/db';
import { CalendarMark, CharacterProfile } from '../../types';
import { ContextBuilder } from '../../utils/context';
import { extractContent } from '../../utils/safeApi';
import { resolveAuxApi } from '../../utils/auxApi';
import { injectMemoryPalace } from '../../utils/memoryPalace/pipeline';
import { callChatCompletion } from '../../utils/llmClient';
import { makeApiUsageMeta } from '../../utils/apiUsageCatalog';
import {
    Chip,
    IconCircle,
    InsButton,
    InsCard,
    InsHeader,
    InsScroll,
    InsShell,
    SectionLabel,
    accent,
    INK,
    INK_SOFT,
} from '../../components/ui/insKit';
import { tinyRotate } from './handbookKit';

/**
 * 岁时记 · 共享月历
 * ------------------------------------------------------------
 * - 真实月历，今天高亮，可前后翻月
 * - 用户点日期贴便签，可修改和删除
 * - 角色可按人设往未来日期贴小标记，并写入聊天记忆
 */

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const MARK_COLORS = ['#e7a39c', '#e6c178', '#9ec9a3', '#9bbfe0', '#c4a6dd', '#d9846a'];
const STICKERS = ['📌', '🌷', '💌', '⭐', '☕', '🍰', '🎬', '📷', '🌙', '🍀'];
const EDGE = 'rgba(236,72,153,0.15)';
const FIELD_STYLE: React.CSSProperties = {
    background: 'rgba(255,255,255,0.94)',
    border: '1px solid rgba(236,72,153,0.16)',
    borderRadius: 18,
    color: INK,
    boxShadow: 'inset 0 1px 2px rgba(38,38,38,0.03)',
};

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
    const { characters, activeCharacterId, apiConfig, auxApiConfig, addToast, userProfile } = useOS();
    // 岁时记·共享月历属「聊天以外」的功能：走副 API（未配置副 API 时回退主 API）
    const auxApi = useMemo(() => ({ ...apiConfig, ...resolveAuxApi(auxApiConfig, apiConfig) }), [apiConfig, auxApiConfig]);
    const a = accent('pink');

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
    const monthPrefix = `${viewY}-${pad2(viewM + 1)}-`;
    const monthMarks = useMemo(() => marks.filter((m) => m.date.startsWith(monthPrefix)), [marks, monthPrefix]);
    const selectedMarks = selected ? marksByDate[selected] || [] : [];
    const selDateObj = selected ? new Date(selected + 'T00:00:00') : null;
    const monthLabel = `${viewY}.${pad2(viewM + 1)}`;

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
        if (!char || !auxApi.baseUrl || !auxApi.model) {
            if (!quiet) addToast('还没配置 API，角色先记不了', 'info');
            return;
        }
        setGenerating(true);
        if (!quiet) addToast(`${char.name} 正在翻日历……`, 'info');
        try {
            await injectMemoryPalace(char, undefined, '日历');
            const baseContext = await ContextBuilder.buildFullCoreContext(char, userProfile);
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

            const data = await callChatCompletion(auxApi, {
                model: auxApi.model,
                messages: [
                    { role: 'system', content: baseContext },
                    { role: 'user', content: userPrompt },
                ],
                temperature: 0.9,
                max_tokens: 8000,
                stream: false,
            }, {
                meta: makeApiUsageMeta('almanac.calendarMarks', {
                    charId: char.id,
                    charName: char.name,
                    apiRole: auxApi.apiRole || 'aux',
                    apiBinding: auxApi.apiBinding || '共享月历',
                }),
            });
            const text = (extractContent(data) || '').trim();
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
    }, [addToast, auxApi.apiKey, auxApi.baseUrl, auxApi.model, userProfile]);

    // 进页面后，给当前角色限频自标一次，让日历"活"起来
    useEffect(() => {
        if (autoRan.current) return;
        const char = characters.find((c) => c.id === activeCharacterId) || characters[0];
        if (!char || !auxApi.apiKey) return;
        autoRan.current = true;
        const k = `almanac_cal_gen_${char.id}`;
        const last = Number(localStorage.getItem(k) || 0);
        if (Date.now() - last < GEN_THROTTLE_MS) return;
        localStorage.setItem(k, String(Date.now()));
        genCharMarks(char, true);
    }, [characters, activeCharacterId, auxApi.apiKey, genCharMarks]);

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

    const triggerManualGen = () => {
        if (characters.length === 0) { addToast('还没有角色', 'info'); return; }
        if (characters.length === 1) { genCharMarks(characters[0], false); return; }
        setShowCharPick(true);
    };

    return (
        <InsShell accent="pink" className="almanac-calendar">
            <InsHeader
                title="这个月"
                en="MONTHLY SPREAD"
                onBack={onExit}
                accent="pink"
                right={
                    <IconCircle onClick={triggerManualGen} title="请角色记一笔" size={38}>
                        {generating
                            ? <ArrowsClockwise size={18} weight="bold" className="animate-spin" />
                            : <MagicWand size={18} weight="bold" />}
                    </IconCircle>
                }
            />

            <InsScroll className="px-4 pb-8">
                <section data-manual-anchor="manual-almanac-calendar-root" className="space-y-4">
                    <InsCard className="p-4 overflow-visible" accent="pink">
                        <div className="flex items-center justify-between gap-3 mb-4">
                            <IconCircle size={34} onClick={() => stepMonth(-1)} title="上个月">
                                <CaretLeft size={16} weight="bold" />
                            </IconCircle>
                            <div className="text-center min-w-0">
                                <div className="text-[9px] tracking-[0.34em] uppercase" style={{ fontFamily: 'var(--font-label)', color: a.solid }}>
                                    SHARED CALENDAR
                                </div>
                                <div className="text-[28px] leading-none font-black tabular-nums mt-1" style={{ color: INK }}>{monthLabel}</div>
                            </div>
                            <IconCircle size={34} onClick={() => stepMonth(1)} title="下个月">
                                <CaretRight size={16} weight="bold" />
                            </IconCircle>
                        </div>

                        <div className="grid grid-cols-7 gap-1 mb-2">
                            {WEEK.map((w, i) => (
                                <div key={w} className="h-6 rounded-full flex items-center justify-center text-[10px] font-black" style={{ color: i === 0 || i === 6 ? a.solid : INK_SOFT }}>
                                    {w}
                                </div>
                            ))}
                        </div>

                        <div className="grid grid-cols-7 gap-1.5">
                            {grid.map((key, idx) => {
                                if (!key) return <div key={`e-${idx}`} className="aspect-square rounded-[14px]" style={{ background: '#f1eee8' }} />;
                                const dnum = Number(key.slice(-2));
                                const dayMarks = marksByDate[key] || [];
                                const isToday = key === tKey;
                                const userMark = dayMarks.find((m) => m.author === 'user');
                                const firstMark = dayMarks[0];
                                return (
                                    <button
                                        key={key}
                                        onClick={() => openDay(key)}
                                        className="aspect-square relative rounded-[14px] px-1.5 pt-1.5 flex flex-col items-start justify-between active:scale-95 transition-transform overflow-hidden"
                                        style={{
                                            background: isToday ? a.solid : dayMarks.length ? '#fff7fb' : '#fff',
                                            color: isToday ? '#fff' : INK,
                                            border: `1px solid ${isToday ? a.solid : dayMarks.length ? EDGE : 'rgba(0,0,0,0.055)'}`,
                                            boxShadow: isToday ? `0 12px 22px -14px ${a.solid}` : '0 1px 2px rgba(38,38,38,0.04)',
                                        }}
                                    >
                                        <span className="text-[11px] font-black leading-none tabular-nums">{dnum}</span>
                                        <span className="absolute right-1.5 top-1.5 text-[10px] leading-none">{userMark?.emoji}</span>
                                        <span className="w-full flex items-center gap-0.5 min-h-[8px]">
                                            {dayMarks.slice(0, 3).map((m) => (
                                                <span
                                                    key={m.id}
                                                    className="w-1.5 h-1.5 rounded-full shrink-0"
                                                    style={{ background: isToday ? '#fff' : m.color || firstMark?.color || a.solid }}
                                                />
                                            ))}
                                            {dayMarks.length > 3 && <span className="text-[7px] font-bold leading-none" style={{ color: isToday ? '#fff' : INK_SOFT }}>+{dayMarks.length - 3}</span>}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </InsCard>

                    <div className="grid grid-cols-3 gap-2">
                        <InsCard className="px-3 py-3" accent="pink">
                            <div className="text-[8px] tracking-[0.25em] uppercase" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>notes</div>
                            <div className="mt-1 text-[20px] font-black tabular-nums" style={{ color: INK }}>{monthMarks.length}</div>
                        </InsCard>
                        <InsCard className="px-3 py-3" accent="pink">
                            <div className="text-[8px] tracking-[0.25em] uppercase" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>mine</div>
                            <div className="mt-1 text-[20px] font-black tabular-nums" style={{ color: INK }}>{monthMarks.filter((m) => m.author === 'user').length}</div>
                        </InsCard>
                        <InsCard className="px-3 py-3" accent="pink">
                            <div className="text-[8px] tracking-[0.25em] uppercase" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>from ta</div>
                            <div className="mt-1 text-[20px] font-black tabular-nums" style={{ color: INK }}>{monthMarks.filter((m) => m.author === 'character').length}</div>
                        </InsCard>
                    </div>

                    <InsCard className="p-4" accent="pink">
                        <SectionLabel en="STICKERS" accent="pink" className="mb-3">月历怎么用</SectionLabel>
                        <div className="flex flex-wrap gap-2">
                            <Chip accent="pink">点日期贴便签</Chip>
                            <Chip accent="pink">彩点代表有标记</Chip>
                            <Chip accent="pink">右上魔杖请角色记一笔</Chip>
                        </div>
                    </InsCard>
                </section>
            </InsScroll>

            {showCharPick && (
                <div className="fixed inset-0 z-[9998] flex items-end justify-center animate-fade-in" onClick={() => setShowCharPick(false)}>
                    <div className="absolute inset-0" style={{ background: 'rgba(28,26,24,0.42)', backdropFilter: 'blur(4px)' }} />
                    <div
                        className="relative w-full max-w-md animate-slide-up rounded-t-[28px] overflow-hidden"
                        style={{ background: 'linear-gradient(180deg,#ffffff 0%,#fbfaf8 100%)', border: `1px solid ${EDGE}`, boxShadow: '0 -22px 60px -24px rgba(20,18,16,0.45)', paddingBottom: 'var(--safe-bottom)' }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex justify-center pt-3"><span className="w-10 h-1.5 rounded-full" style={{ background: '#e3e0da' }} /></div>
                        <div className="px-5 pt-4 pb-3 flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: a.soft, color: a.solid }}>
                                <Sparkle size={20} weight="fill" />
                            </div>
                            <div className="min-w-0">
                                <div className="text-[15px] font-extrabold" style={{ color: INK }}>让谁来记一笔？</div>
                                <div className="text-[10px]" style={{ color: INK_SOFT }}>TA 会把自己的期待贴到未来日期上</div>
                            </div>
                            <IconCircle size={30} onClick={() => setShowCharPick(false)} title="关闭"><X size={15} weight="bold" /></IconCircle>
                        </div>
                        <div className="px-5 pb-5 grid grid-cols-4 gap-3 max-h-72 overflow-y-auto no-scrollbar">
                            {characters.map((c) => (
                                <button key={c.id} onClick={() => { setShowCharPick(false); genCharMarks(c, false); }} className="flex flex-col items-center gap-1.5 active:scale-95 transition-transform min-w-0">
                                    {c.avatar?.startsWith('http') || c.avatar?.startsWith('data:')
                                        ? <img src={c.avatar} alt="" className="w-13 h-13 rounded-full object-cover" style={{ width: 52, height: 52, border: `2px solid ${colorForChar(c.id)}` }} />
                                        : <span className="w-13 h-13 rounded-full flex items-center justify-center text-xl" style={{ width: 52, height: 52, background: '#fff7fb', border: `2px solid ${colorForChar(c.id)}` }}>{c.avatar || '🌸'}</span>}
                                    <span className="text-[10px] font-bold truncate w-full text-center" style={{ color: INK }}>{c.name}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {selected && selDateObj && (
                <div className="fixed inset-0 z-[9999] flex items-end justify-center animate-fade-in" onClick={() => setSelected(null)}>
                    <div className="absolute inset-0" style={{ background: 'rgba(28,26,24,0.42)', backdropFilter: 'blur(4px)' }} />
                    <div
                        className="relative w-full max-w-md animate-slide-up rounded-t-[28px] overflow-hidden"
                        style={{ background: 'linear-gradient(180deg,#ffffff 0%,#fbfaf8 100%)', border: `1px solid ${EDGE}`, boxShadow: '0 -22px 60px -24px rgba(20,18,16,0.45)', maxHeight: '84vh', paddingBottom: 'var(--safe-bottom)' }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex justify-center pt-3"><span className="w-10 h-1.5 rounded-full" style={{ background: '#e3e0da' }} /></div>
                        <div className="px-5 pt-4 pb-3 flex items-center gap-3" style={{ borderBottom: `1px solid ${EDGE}` }}>
                            <div className="w-12 h-12 rounded-[18px] flex flex-col items-center justify-center shrink-0" style={{ background: a.soft, color: a.ink }}>
                                <span className="text-[9px] font-bold">周{WEEK[selDateObj.getDay()]}</span>
                                <span className="text-[18px] font-black leading-none">{selDateObj.getDate()}</span>
                            </div>
                            <div className="min-w-0">
                                <div className="text-[17px] font-extrabold" style={{ color: INK }}>
                                    {selDateObj.getMonth() + 1} 月 {selDateObj.getDate()} 日
                                </div>
                                <div className="text-[10px]" style={{ color: INK_SOFT }}>{selected === tKey ? '就是今天' : selected}</div>
                            </div>
                            <IconCircle size={30} onClick={() => setSelected(null)} title="关闭"><X size={15} weight="bold" /></IconCircle>
                        </div>

                        <div className="px-5 pt-4 pb-5 overflow-y-auto no-scrollbar" style={{ maxHeight: 'calc(84vh - 88px)' }}>
                            <div className="space-y-2.5 mb-5">
                                {selectedMarks.length === 0 && (
                                    <div className="rounded-[18px] px-4 py-6 text-center" style={{ background: '#fff', border: `1px solid ${EDGE}`, color: INK_SOFT }}>
                                        <NotePencil size={24} weight="bold" className="mx-auto mb-2 opacity-60" />
                                        <div className="text-[12px] font-bold">这天还空着，贴点什么吧</div>
                                    </div>
                                )}
                                {selectedMarks.map((m) => {
                                    const ch = charById(m.charId);
                                    return (
                                        <div
                                            key={m.id}
                                            className="relative rounded-[18px] px-3 py-3 flex items-start gap-3"
                                            style={{
                                                background: '#fff',
                                                border: `1px solid ${EDGE}`,
                                                boxShadow: '0 12px 26px -22px rgba(38,38,38,0.36)',
                                                transform: `rotate(${tinyRotate(m.id) / 2}deg)`,
                                            }}
                                        >
                                            <span className="absolute left-0 top-4 bottom-4 w-1 rounded-r-full" style={{ background: m.color || a.solid }} />
                                            {m.author === 'character' && ch ? (
                                                ch.avatar?.startsWith('http') || ch.avatar?.startsWith('data:')
                                                    ? <img src={ch.avatar} alt="" className="w-9 h-9 rounded-full object-cover shrink-0 mt-0.5" />
                                                    : <span className="w-9 h-9 rounded-full flex items-center justify-center text-sm shrink-0 mt-0.5" style={{ background: '#fff7fb' }}>{ch.avatar || '🌸'}</span>
                                            ) : (
                                                <span className="w-9 h-9 rounded-full flex items-center justify-center text-base shrink-0 mt-0.5" style={{ background: '#fff7fb' }}>{m.emoji || '📌'}</span>
                                            )}
                                            <div className="flex-1 min-w-0">
                                                <div className="text-[15px] leading-snug font-bold break-words" style={{ color: INK, fontFamily: 'var(--font-hand)' }}>{m.text}</div>
                                                <div className="text-[10px] mt-1" style={{ color: INK_SOFT }}>
                                                    {m.author === 'character' ? `${ch?.name || '角色'} 贴的` : '我贴的'}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-1 shrink-0">
                                                {m.author === 'user' && (
                                                    <button onClick={() => startEdit(m)} className="w-7 h-7 rounded-full flex items-center justify-center active:scale-90" style={{ background: '#fff7fb', color: a.solid }} title="修改">
                                                        <PencilSimple size={13} weight="bold" />
                                                    </button>
                                                )}
                                                <button onClick={() => removeMark(m.id)} className="w-7 h-7 rounded-full flex items-center justify-center active:scale-90" style={{ background: '#fff1f2', color: '#e0526f' }} title="删除">
                                                    <Trash size={13} weight="bold" />
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            <div className="rounded-[22px] p-4" style={{ background: '#fff', border: `1px solid ${EDGE}`, boxShadow: '0 12px 26px -24px rgba(38,38,38,0.32)' }}>
                                <SectionLabel en="NEW NOTE" accent="pink" className="mb-3">{editingId ? '改这张便签' : '贴一张便签'}</SectionLabel>
                                <textarea
                                    value={draftText}
                                    onChange={(e) => setDraftText(e.target.value.slice(0, 40))}
                                    rows={2}
                                    placeholder="想在这天记下点什么……"
                                    className="w-full px-4 py-3 text-[14px] resize-none focus:outline-none placeholder:text-slate-400"
                                    style={{ ...FIELD_STYLE, fontFamily: 'var(--font-hand)', fontSize: 16 }}
                                />

                                <div className="mt-4">
                                    <div className="text-[9px] tracking-[0.24em] uppercase mb-2" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>color</div>
                                    <div className="flex items-center gap-2 flex-wrap">
                                        {MARK_COLORS.map((c) => (
                                            <button
                                                key={c}
                                                onClick={() => setDraftColor(c)}
                                                className="w-7 h-7 rounded-full active:scale-90 transition-transform"
                                                style={{ background: c, boxShadow: draftColor === c ? '0 0 0 2px #fff, 0 0 0 4px #ec4899' : '0 1px 2px rgba(0,0,0,0.15)' }}
                                                title={c}
                                            />
                                        ))}
                                    </div>
                                </div>

                                <div className="mt-4">
                                    <div className="text-[9px] tracking-[0.24em] uppercase mb-2" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>sticker</div>
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                        {STICKERS.map((s) => (
                                            <button
                                                key={s}
                                                onClick={() => setDraftEmoji(s)}
                                                className="w-8 h-8 rounded-full text-base active:scale-90 transition-transform"
                                                style={{ background: draftEmoji === s ? a.soft : '#fff', border: `1px solid ${draftEmoji === s ? a.solid : 'rgba(0,0,0,0.06)'}` }}
                                            >
                                                {s}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div className="flex gap-2 mt-5">
                                    {editingId && (
                                        <InsButton
                                            variant="ghost"
                                            accent="pink"
                                            className="px-4 py-3 text-[13px]"
                                            onClick={() => { setEditingId(null); setDraftText(''); }}
                                        >
                                            取消
                                        </InsButton>
                                    )}
                                    <InsButton
                                        variant="solid"
                                        accent="pink"
                                        disabled={!draftText.trim()}
                                        className="flex-1 py-3 text-[13px]"
                                        onClick={saveDraft}
                                        icon={<NotePencil size={15} weight="bold" />}
                                    >
                                        {editingId ? '改好了' : '贴上去'}
                                    </InsButton>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </InsShell>
    );
};

export default AlmanacCalendar;
