import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useOS } from '../../context/OSContext';
import {
    Heart, BookmarkSimple, Trash, Quotes, PaperPlaneRight, Sparkle,
    ClipboardText, DownloadSimple, NotePencil, ChatTeardropText,
} from '@phosphor-icons/react';
import { TalkInsight, TalkMode, TalkSession, TalkTurn } from '../../types';
import { DB } from '../../utils/db';
import { resolveAuxApi } from '../../utils/auxApi';
import { generateTalkInsight, generateTalkOpening, generateTalkReply } from '../../utils/talkTherapy';
import { candidateToItem, collectionId } from '../../utils/collection';
import { PaperShell, ScrapScroll, ScrapHeader, Polaroid, ScrapButton, SectionTag, PaperCard, INK, INK_SOFT } from '../ui/insScrapKit';

/**
 * 折子戏·谈心（肆）：给 user 一个被认真倾听、被安慰的地方。
 * 选一个角色，把心里话说出来，TA 以格外温柔、专注、共情的姿态陪着你。
 * 每段谈心可存档，能收录进岁时记·典藏馆。黑白拼贴手账皮肤（暖白纸 + 墨）。
 */

interface Props { onExit: () => void; }

type TalkModeMeta = {
    id: TalkMode;
    title: string;
    en: string;
    hint: string;
    prompts: string[];
};

const MOODS = ['有点难过', '心里很烦', '觉得孤单', '有点迷茫', '压力好大', '睡前低落', '想被肯定', '想分享开心事'];
const TALK_MODES: TalkModeMeta[] = [
    {
        id: 'hold',
        title: '只想被抱住',
        en: 'HOLD',
        hint: '先陪着，不急着分析',
        prompts: ['我现在有点撑不住，先陪我待一会儿。', '我不太想听建议，只想被你抱一下。', '你可以告诉我，我不是一个人吗？'],
    },
    {
        id: 'untangle',
        title: '一起理清楚',
        en: 'UNTANGLE',
        hint: '把乱成团的心事拆开',
        prompts: ['你可以帮我把这件事理一下吗？', '我不知道自己到底在难受什么。', '先问我一个问题，慢慢来。'],
    },
    {
        id: 'courage',
        title: '借我点勇气',
        en: 'COURAGE',
        hint: '温柔但有力地推我一下',
        prompts: ['我需要一点勇气，但不要太用力。', '你可以提醒我，我已经做得不差了吗？', '帮我想一个今天能做到的小动作。'],
    },
    {
        id: 'celebrate',
        title: '分享开心事',
        en: 'SHARE',
        hint: '把快乐好好放大',
        prompts: ['我有一件小小的好事想讲给你听。', '你能不能认真替我高兴一下？', '今天其实有一瞬间，我觉得很亮。'],
    },
    {
        id: 'letter',
        title: '写一封信',
        en: 'LETTER',
        hint: '把没说出口的话放进纸里',
        prompts: ['我想写给某个人，但不知道从哪里开始。', '帮我把这些没说出口的话整理成一封信。', '我想对过去的自己说几句话。'],
    },
];
const DEFAULT_MODE: TalkMode = 'hold';
const genId = () => `talk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const modeMeta = (mode?: TalkMode) => TALK_MODES.find(m => m.id === mode) || TALK_MODES[0];

const sanitizeFileName = (name: string) => name.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').slice(0, 36) || 'talk';

const formatTalkExport = (s: TalkSession, charName: string, userName: string) => {
    const mode = modeMeta(s.mode);
    const lines = [
        `折子戏·谈心｜${s.title || '一次谈心'}`,
        `对象：${charName}`,
        `方式：${mode.title}`,
        s.mood ? `心情：${s.mood}` : '',
        s.intention ? `开口纸条：${s.intention}` : '',
        `时间：${new Date(s.createdAt).toLocaleString('zh-CN')}`,
        '',
        '=== 对话 ===',
        ...s.turns.map(t => {
            const who = t.role === 'user' ? userName : charName;
            const at = new Date(t.at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
            return `[${at}] ${who}：\n${t.text}`;
        }),
    ].filter(Boolean);
    if (s.insights?.length) {
        lines.push('', '=== 安放卡 ===');
        s.insights.forEach(card => {
            lines.push(`【${card.title}】`, card.body);
        });
    }
    return lines.join('\n\n');
};

const TalkTherapyApp: React.FC<Props> = ({ onExit }) => {
    const { characters, apiConfig, auxApiConfig, userProfile, addToast } = useOS();
    const api = resolveAuxApi(auxApiConfig, apiConfig);
    const apiReady = !!(api.baseUrl && api.model);

    const [view, setView] = useState<'pick' | 'talk'>('pick');
    const [history, setHistory] = useState<TalkSession[]>([]);
    const [collectedIds, setCollectedIds] = useState<Set<string>>(new Set());
    const [pickCharId, setPickCharId] = useState('');
    const [mood, setMood] = useState('');
    const [mode, setMode] = useState<TalkMode>(DEFAULT_MODE);
    const [intention, setIntention] = useState('');

    const [session, setSession] = useState<TalkSession | null>(null);
    const [busy, setBusy] = useState(false);
    const [insightBusy, setInsightBusy] = useState(false);
    const [input, setInput] = useState('');
    const scrollRef = useRef<HTMLDivElement>(null);

    const reload = async () => {
        const [list, items] = await Promise.all([DB.getAllTalkSessions().catch(() => []), DB.getCollectionItems().catch(() => [])]);
        setHistory(list);
        setCollectedIds(new Set(items.map(i => i.id)));
    };
    useEffect(() => { void reload(); }, []);
    useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [session?.turns, session?.insights, busy, insightBusy]);

    const charOf = (id: string) => characters.find(c => c.id === id);
    const userName = (userProfile?.name || '').trim() || '你';
    const selectedMode = modeMeta(mode);
    const activeMode = modeMeta(session?.mode);
    const quickPrompts = useMemo(() => activeMode.prompts, [activeMode.id]);

    const persist = async (s: TalkSession) => { setSession(s); await DB.saveTalkSession(s).catch(() => {}); };

    const startSession = async () => {
        const char = charOf(pickCharId);
        if (!char) { addToast('先选一个想倾诉的人吧', 'info'); return; }
        if (!apiReady) { addToast('还没配置 API，去「文具盒」填好再来', 'error'); return; }
        const cleanIntention = intention.trim();
        const s: TalkSession = {
            id: genId(),
            charId: char.id,
            title: mood || selectedMode.title || '一次谈心',
            mood: mood || undefined,
            mode,
            intention: cleanIntention || undefined,
            turns: [],
            insights: [],
            createdAt: Date.now(),
            lastActiveAt: Date.now(),
        };
        setSession(s);
        setView('talk');
        setBusy(true);
        try {
            const opening = await generateTalkOpening(char, userProfile, api, mood, mode, cleanIntention);
            const turns: TalkTurn[] = opening ? [{ role: 'char', text: opening, at: Date.now() }] : [];
            await persist({ ...s, turns, lastActiveAt: Date.now() });
        } catch (e: any) {
            addToast(`开场失败：${e?.message || e}`, 'error');
        } finally { setBusy(false); }
    };

    const resume = (s: TalkSession) => { setSession({ ...s, mode: s.mode || DEFAULT_MODE, insights: s.insights || [] }); setView('talk'); };

    const send = async (override?: string) => {
        const text = (override ?? input).trim();
        if (!text || busy || !session) return;
        const char = charOf(session.charId);
        if (!char) return;
        setInput('');
        const withUser: TalkSession = { ...session, turns: [...session.turns, { role: 'user', text, at: Date.now() }], lastActiveAt: Date.now() };
        if ((withUser.title === '一次谈心' || TALK_MODES.some(m => m.title === withUser.title)) && !session.turns.some(t => t.role === 'user')) {
            withUser.title = text.slice(0, 16);
        }
        await persist(withUser);
        setBusy(true);
        try {
            const reply = await generateTalkReply(char, userProfile, api, withUser.turns, text, session.mood, session.mode, session.intention);
            if (reply) await persist({ ...withUser, turns: [...withUser.turns, { role: 'char', text: reply, at: Date.now() }], lastActiveAt: Date.now() });
        } catch (e: any) {
            addToast(`回应失败：${e?.message || e}`, 'error');
        } finally { setBusy(false); }
    };

    const makeInsight = async () => {
        if (!session || insightBusy || busy) return;
        const char = charOf(session.charId);
        if (!char) return;
        if (!apiReady) { addToast('还没配置 API，去「文具盒」填好再来', 'error'); return; }
        if (!session.turns.some(t => t.role === 'user')) { addToast('先说一点心里话，再收成安放卡吧', 'info'); return; }
        setInsightBusy(true);
        try {
            const result = await generateTalkInsight(char, userProfile, api, session.turns, session.mood, session.mode, session.intention);
            const card: TalkInsight = { id: genId(), title: result.title, body: result.body, createdAt: Date.now() };
            await persist({ ...session, insights: [...(session.insights || []), card], lastActiveAt: Date.now() });
            addToast('安放卡写好了', 'success');
        } catch (e: any) {
            addToast(`安放失败：${e?.message || e}`, 'error');
        } finally { setInsightBusy(false); }
    };

    const collect = async (s: TalkSession) => {
        const char = charOf(s.charId);
        const firstUser = s.turns.find(t => t.role === 'user')?.text;
        const firstInsight = s.insights?.[0]?.body;
        const item = candidateToItem({
            sourceType: 'talk', sourceId: s.id, title: s.title || '一次谈心',
            subtitle: `和 ${char?.name || '某人'} 的谈心${s.mood ? ` · ${s.mood}` : ''}`,
            excerpt: (firstUser || firstInsight || s.turns[s.turns.length - 1]?.text || '').slice(0, 60),
            charIds: [s.charId], cover: '🫂', at: s.lastActiveAt,
        });
        await DB.saveCollectionItem(item);
        setCollectedIds(prev => new Set(prev).add(item.id));
        addToast('已收进典藏馆 🫶', 'success');
    };

    const removeSession = async (id: string) => {
        await DB.deleteTalkSession(id);
        await reload();
        if (session?.id === id) { setSession(null); setView('pick'); }
    };

    const copySession = async (s: TalkSession) => {
        const char = charOf(s.charId);
        try {
            await navigator.clipboard.writeText(formatTalkExport(s, char?.name || '某人', userName));
            addToast('谈心记录已复制', 'success');
        } catch {
            addToast('复制失败，请稍后再试', 'error');
        }
    };

    const downloadSession = (s: TalkSession) => {
        const char = charOf(s.charId);
        const text = formatTalkExport(s, char?.name || '某人', userName);
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `谈心_${sanitizeFileName(char?.name || '某人')}_${new Date(s.lastActiveAt).toISOString().slice(0, 10)}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        addToast('浏览器开始下载了', 'success');
    };

    // ── 谈心进行中 ──
    if (view === 'talk' && session) {
        const char = charOf(session.charId);
        const collected = collectedIds.has(collectionId('talk', session.id));
        return (
            <PaperShell>
                <div className="relative z-20 shrink-0 px-3.5 pt-3 pb-2">
                    <div className="flex items-center justify-between gap-2">
                        <ScrapButton variant="paper" className="px-3 py-1.5 text-[11px]" onClick={() => { setView('pick'); void reload(); }} icon={
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
                        }>收起</ScrapButton>
                        <div className="flex items-center justify-center gap-2 min-w-0">
                            {char && <img src={char.avatar} className="w-7 h-7 rounded-full object-cover" style={{ filter: 'contrast(1.05)', boxShadow: '0 0 0 1.5px #f6f3ec, 0 0 0 2.5px rgba(176,170,158,0.7)' }} alt="" />}
                            <div className="min-w-0 text-center">
                                <div className="text-[13px] font-black truncate" style={{ color: INK }}>和 {char?.name} 谈心</div>
                                <div className="text-[9px] tracking-[0.22em] uppercase truncate" style={{ color: INK_SOFT }}>{activeMode.en}</div>
                            </div>
                        </div>
                        <ScrapButton variant={collected ? 'ghost' : 'ink'} className="px-3 py-1.5 text-[11px]" disabled={collected} onClick={() => collect(session)} icon={<BookmarkSimple size={13} weight={collected ? 'fill' : 'bold'} />}>
                            {collected ? '已收' : '收藏'}
                        </ScrapButton>
                    </div>
                    <div className="mt-2 flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
                        <span className="shrink-0 px-2.5 py-1 rounded-full text-[10.5px] font-black" style={{ background: 'rgba(255,255,255,0.82)', color: INK, border: '1px solid rgba(0,0,0,0.06)' }}>{activeMode.title}</span>
                        {session.mood && <span className="shrink-0 px-2.5 py-1 rounded-full text-[10.5px] font-bold" style={{ background: '#fef3c7', color: '#92400e' }}>{session.mood}</span>}
                        <button onClick={() => void makeInsight()} disabled={busy || insightBusy} className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10.5px] font-black disabled:opacity-45 active:scale-95 transition" style={{ background: '#fff', color: INK, border: '1px solid rgba(0,0,0,0.06)' }}>
                            <Sparkle size={12} weight="fill" />{insightBusy ? '书写中' : '安放卡'}
                        </button>
                        <button onClick={() => void copySession(session)} className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10.5px] font-black active:scale-95 transition" style={{ background: '#fff', color: INK, border: '1px solid rgba(0,0,0,0.06)' }}>
                            <ClipboardText size={12} weight="bold" />复制
                        </button>
                        <button onClick={() => downloadSession(session)} className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10.5px] font-black active:scale-95 transition" style={{ background: '#fff', color: INK, border: '1px solid rgba(0,0,0,0.06)' }}>
                            <DownloadSimple size={12} weight="bold" />下载
                        </button>
                    </div>
                </div>

                <div ref={scrollRef} className="relative z-10 flex-1 overflow-y-auto no-scrollbar px-4 py-3 space-y-3">
                    {session.intention && (
                        <PaperCard className="px-3.5 py-3" style={{ background: 'rgba(255,255,255,0.86)' }}>
                            <div className="flex items-center gap-1.5 text-[10px] font-black tracking-[0.2em] uppercase" style={{ color: '#f97316' }}>
                                <NotePencil size={12} weight="bold" /> NOTE
                            </div>
                            <div className="mt-1.5 text-[12.5px] leading-relaxed whitespace-pre-wrap" style={{ color: '#5a5147' }}>{session.intention}</div>
                        </PaperCard>
                    )}
                    {session.turns.map((t, i) => (
                        t.role === 'char' ? (
                            <div key={i} className="flex items-start gap-2.5">
                                {char && <img src={char.avatar} className="w-7 h-7 rounded-full object-cover mt-0.5 shrink-0" style={{ filter: 'contrast(1.05)', boxShadow: '0 0 0 1.5px #f6f3ec, 0 0 0 2.5px rgba(176,170,158,0.7)' }} alt="" />}
                                <div className="max-w-[80%] px-4 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap" style={{ background: 'rgba(255,253,247,0.96)', color: '#3a362f', border: '1px solid rgba(176,170,158,0.7)', borderRadius: '4px 16px 16px 16px', boxShadow: '0 6px 14px -10px rgba(31,29,26,0.4)' }}>
                                    {t.text}
                                </div>
                            </div>
                        ) : (
                            <div key={i} className="flex justify-end">
                                <div className="max-w-[80%] px-4 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap" style={{ background: '#1f1d1a', color: '#f3ecdf', borderRadius: '16px 4px 16px 16px', boxShadow: '0 6px 14px -10px rgba(31,29,26,0.5)' }}>
                                    {t.text}
                                </div>
                            </div>
                        )
                    ))}
                    {session.insights?.map(card => (
                        <PaperCard key={card.id} className="px-4 py-3.5" tape="amber">
                            <div className="flex items-center gap-2">
                                <Sparkle size={14} weight="fill" style={{ color: '#f97316' }} />
                                <div className="text-[13px] font-black" style={{ color: INK }}>{card.title}</div>
                                <div className="ml-auto text-[9.5px]" style={{ color: INK_SOFT }}>{new Date(card.createdAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}</div>
                            </div>
                            <div className="mt-2 text-[12.5px] leading-relaxed whitespace-pre-wrap" style={{ color: '#5a5147' }}>{card.body}</div>
                        </PaperCard>
                    ))}
                    {(busy || insightBusy) && (
                        <div className="flex items-center gap-2 text-[11px] px-1" style={{ color: INK_SOFT }}>
                            <Heart size={11} weight="fill" className="animate-pulse" /> {insightBusy ? `${char?.name} 正在把这段话收好…` : `${char?.name} 正在认真听…`}
                        </div>
                    )}
                </div>

                {session.turns.length <= 1 && (
                    <div className="relative z-10 shrink-0 px-3 pb-2 flex gap-2 overflow-x-auto no-scrollbar">
                        {quickPrompts.map(chip => (
                            <button key={chip} onClick={() => void send(chip)} disabled={busy} className="shrink-0 max-w-[78%] px-3 py-1.5 rounded-full text-[11.5px] font-bold truncate active:scale-95 transition disabled:opacity-45" style={{ background: '#fff', color: '#5a5147', border: '1px solid rgba(0,0,0,0.06)' }}>
                                {chip}
                            </button>
                        ))}
                    </div>
                )}

                <div className="relative z-10 shrink-0 px-3 py-3 flex items-end gap-2" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 12px)' }}>
                    <textarea
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
                        rows={1}
                        placeholder="把心里的话慢慢说出来…"
                        disabled={busy}
                        className="flex-1 px-4 py-2.5 rounded-2xl text-[13.5px] outline-none resize-none max-h-28"
                        style={{ background: 'rgba(255,253,247,0.92)', color: '#3a362f', border: '1px solid rgba(176,170,158,0.75)', outlineColor: 'transparent' }}
                    />
                    <button onClick={() => void send()} disabled={busy || !input.trim()} className="shrink-0 w-11 h-11 rounded-full flex items-center justify-center active:scale-90 transition disabled:opacity-40" style={{ background: '#1f1d1a', color: '#f6f3ec', boxShadow: '0 8px 16px -10px rgba(31,29,26,0.6)' }} aria-label="发送">
                        <PaperPlaneRight size={17} weight="fill" />
                    </button>
                </div>
            </PaperShell>
        );
    }

    // ── 选择 / 历史 ──
    return (
        <PaperShell>
            <ScrapHeader title="谈心" en="HEART TO HEART" onBack={onExit} backLabel="回戏单" />

            <ScrapScroll className="px-5 pb-10">
                <div className="text-center mt-2 mb-6 select-none">
                    <Quotes size={32} weight="fill" className="mx-auto" style={{ color: INK }} />
                    <div className="text-[28px] font-black mt-2" style={{ color: INK }}>谈心</div>
                    <div className="text-[12px] mt-1.5 leading-relaxed" style={{ color: '#6b6558' }}>找个人，把心里的话放下来。<br />这里只负责好好听你说、轻轻抱住你。</div>
                </div>

                <SectionTag en="WHO" className="mb-3">想和谁说说？</SectionTag>
                <div className="flex gap-3.5 overflow-x-auto no-scrollbar pb-2 -mx-1 px-1">
                    {characters.length === 0 && <div className="text-[12px] py-4" style={{ color: INK_SOFT }}>还没有角色，先去创建一个吧。</div>}
                    {characters.map((c, i) => (
                        <Polaroid key={c.id} src={c.avatar} caption={c.name} size={58} rotate={i % 2 ? 1.5 : -1.5} selected={pickCharId === c.id} onClick={() => setPickCharId(c.id)} />
                    ))}
                </div>

                <SectionTag en="MODE" className="mt-6 mb-3">这次怎么陪你？</SectionTag>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {TALK_MODES.map(item => {
                        const on = mode === item.id;
                        return (
                            <button key={item.id} onClick={() => setMode(item.id)} className="text-left px-3.5 py-3 rounded-[18px] active:scale-[0.98] transition" style={{
                                background: on ? '#1f1d1a' : 'rgba(255,255,255,0.86)',
                                color: on ? '#f6f3ec' : INK,
                                border: on ? '1px solid #1f1d1a' : '1px solid rgba(0,0,0,0.06)',
                                boxShadow: on ? '0 14px 26px -18px rgba(31,29,26,0.55)' : '0 12px 24px -20px rgba(38,38,38,0.3)',
                            }}>
                                <div className="flex items-center gap-2">
                                    <ChatTeardropText size={15} weight="bold" />
                                    <span className="text-[13px] font-black">{item.title}</span>
                                    <span className="ml-auto text-[8px] tracking-[0.24em]" style={{ opacity: 0.65 }}>{item.en}</span>
                                </div>
                                <div className="mt-1 text-[11px] leading-relaxed" style={{ color: on ? 'rgba(246,243,236,0.72)' : INK_SOFT }}>{item.hint}</div>
                            </button>
                        );
                    })}
                </div>

                <SectionTag en="MOOD" className="mt-6 mb-3">此刻的心情（可不选）</SectionTag>
                <div className="flex flex-wrap gap-2">
                    {MOODS.map(m => {
                        const on = mood === m;
                        return (
                            <button key={m} onClick={() => setMood(on ? '' : m)} className="px-3 py-1.5 rounded-full text-[12px] font-bold transition active:scale-95" style={{
                                background: on ? '#1f1d1a' : 'rgba(255,253,247,0.85)',
                                color: on ? '#f6f3ec' : '#5b554a',
                                border: on ? 'none' : '1px solid rgba(176,170,158,0.7)',
                            }}>{m}</button>
                        );
                    })}
                </div>

                <SectionTag en="NOTE" className="mt-6 mb-3">开口前的小纸条（可不写）</SectionTag>
                <textarea
                    value={intention}
                    onChange={e => setIntention(e.target.value)}
                    rows={3}
                    maxLength={160}
                    placeholder="比如：今天别急着劝我，先听我说完。"
                    className="w-full px-4 py-3 rounded-[20px] text-[13px] outline-none resize-none"
                    style={{ background: 'rgba(255,255,255,0.9)', color: '#3a362f', border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 14px 28px -24px rgba(38,38,38,0.35)' }}
                />
                <div className="mt-2 flex gap-2 overflow-x-auto no-scrollbar">
                    {selectedMode.prompts.map(chip => (
                        <button key={chip} onClick={() => setIntention(chip)} className="shrink-0 max-w-[82%] px-3 py-1.5 rounded-full text-[11px] font-bold truncate active:scale-95 transition" style={{ background: '#fff', color: '#5a5147', border: '1px solid rgba(0,0,0,0.06)' }}>
                            {chip}
                        </button>
                    ))}
                </div>

                <ScrapButton variant="ink" className="w-full mt-6 h-12 text-[14px]" disabled={!pickCharId || busy} onClick={() => void startSession()} icon={<Heart size={15} weight="fill" />}>
                    {busy ? '正在布置这个空间…' : '开始谈心'}
                </ScrapButton>

                {history.length > 0 && (
                    <div className="mt-8">
                        <SectionTag en="ARCHIVE" className="mb-3">从前的谈心</SectionTag>
                        <div className="space-y-3">
                            {history.map((s, i) => {
                                const c = charOf(s.charId);
                                const collected = collectedIds.has(collectionId('talk', s.id));
                                const meta = modeMeta(s.mode);
                                return (
                                    <PaperCard key={s.id} tilt={i % 2 ? 0.5 : -0.5} className="px-3.5 py-3 flex items-center gap-3">
                                        {c ? <img src={c.avatar} className="w-9 h-9 rounded-full object-cover shrink-0" style={{ filter: 'contrast(1.05)', boxShadow: '0 0 0 1.5px #f6f3ec, 0 0 0 2.5px rgba(176,170,158,0.6)' }} alt="" /> : <span className="text-[22px]">🫂</span>}
                                        <button onClick={() => resume(s)} className="flex-1 min-w-0 text-left">
                                            <div className="flex items-center gap-1.5 min-w-0">
                                                <span className="text-[13px] font-black truncate" style={{ color: INK }}>{s.title || '一次谈心'}</span>
                                                {s.insights?.length ? <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded-full font-black" style={{ background: '#fef3c7', color: '#92400e' }}>{s.insights.length} 卡</span> : null}
                                            </div>
                                            <div className="text-[10.5px] truncate mt-0.5" style={{ color: INK_SOFT }}>和 {c?.name || '某人'} · {meta.title} · {new Date(s.lastActiveAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })} · {s.turns.length} 句</div>
                                        </button>
                                        <button onClick={() => void collect(s)} disabled={collected} className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center active:scale-90 transition disabled:opacity-50" style={{ color: collected ? INK_SOFT : INK }} title="收进典藏馆">
                                            <BookmarkSimple size={16} weight={collected ? 'fill' : 'bold'} />
                                        </button>
                                        <button onClick={() => void removeSession(s.id)} className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center active:scale-90 transition" style={{ color: INK_SOFT }} title="删除">
                                            <Trash size={15} weight="bold" />
                                        </button>
                                    </PaperCard>
                                );
                            })}
                        </div>
                    </div>
                )}
            </ScrapScroll>
        </PaperShell>
    );
};

export default TalkTherapyApp;
