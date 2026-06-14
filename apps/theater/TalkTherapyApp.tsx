import React, { useEffect, useRef, useState } from 'react';
import { useOS } from '../../context/OSContext';
import { Heart, BookmarkSimple, Trash } from '@phosphor-icons/react';
import { TalkSession, TalkTurn } from '../../types';
import { DB } from '../../utils/db';
import { resolveAuxApi } from '../../utils/auxApi';
import { generateTalkOpening, generateTalkReply } from '../../utils/talkTherapy';
import { candidateToItem, collectionId } from '../../utils/collection';
import {
    PaperShell, ScrapScroll, ScrapHeader, PaperCard, Polaroid, WashiTape, SectionTag,
    WASHI, INK, INK_SOFT,
} from './scrapbook';

/**
 * 小剧场·谈心：给 user 一个被认真倾听、被安慰的地方。
 * 选一个角色，把心里话说出来，TA 以格外温柔、专注、共情的姿态陪着你。
 * 每段谈心可存档，能收录进岁时记·典藏馆，也能在那里转发给别的角色。
 *
 * 界面＝拼贴手账「悄悄话信笺」：纸页上一来一回，像在交换手写的便条。
 */

interface Props { onExit: () => void; }

const MOODS = ['有点难过', '心里很烦', '觉得孤单', '有点迷茫', '压力好大', '想分享开心事'];
const genId = () => `talk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const inkBtn: React.CSSProperties = { background: '#3a3630', color: '#fcf8ef', outline: '1px dashed rgba(255,255,255,0.3)', outlineOffset: -4, boxShadow: '0 12px 22px -12px rgba(58,54,48,0.6)' };

const TalkTherapyApp: React.FC<Props> = ({ onExit }) => {
    const { characters, apiConfig, auxApiConfig, userProfile, addToast } = useOS();
    const api = resolveAuxApi(auxApiConfig, apiConfig);
    const apiReady = !!(api.baseUrl && api.model);

    const [view, setView] = useState<'pick' | 'talk'>('pick');
    const [history, setHistory] = useState<TalkSession[]>([]);
    const [collectedIds, setCollectedIds] = useState<Set<string>>(new Set());
    const [pickCharId, setPickCharId] = useState('');
    const [mood, setMood] = useState('');

    const [session, setSession] = useState<TalkSession | null>(null);
    const [busy, setBusy] = useState(false);
    const [input, setInput] = useState('');
    const scrollRef = useRef<HTMLDivElement>(null);

    const reload = async () => {
        const [list, items] = await Promise.all([DB.getAllTalkSessions().catch(() => []), DB.getCollectionItems().catch(() => [])]);
        setHistory(list);
        setCollectedIds(new Set(items.map(i => i.id)));
    };
    useEffect(() => { void reload(); }, []);
    useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [session?.turns, busy]);

    const charOf = (id: string) => characters.find(c => c.id === id);
    const userName = (userProfile?.name || '').trim() || '你';

    const persist = async (s: TalkSession) => { setSession(s); await DB.saveTalkSession(s).catch(() => {}); };

    const startSession = async () => {
        const char = charOf(pickCharId);
        if (!char) { addToast('先选一个想倾诉的人吧', 'info'); return; }
        if (!apiReady) { addToast('还没配置 API，去「文具盒」填好再来', 'error'); return; }
        const s: TalkSession = {
            id: genId(), charId: char.id, title: mood || '一次谈心', mood: mood || undefined,
            turns: [], createdAt: Date.now(), lastActiveAt: Date.now(),
        };
        setSession(s);
        setView('talk');
        setBusy(true);
        try {
            const opening = await generateTalkOpening(char, userProfile, api, mood);
            const turns: TalkTurn[] = opening ? [{ role: 'char', text: opening, at: Date.now() }] : [];
            await persist({ ...s, turns, lastActiveAt: Date.now() });
        } catch (e: any) {
            addToast(`开场失败：${e?.message || e}`, 'error');
        } finally { setBusy(false); }
    };

    const resume = (s: TalkSession) => { setSession(s); setView('talk'); };

    const send = async () => {
        const text = input.trim();
        if (!text || busy || !session) return;
        const char = charOf(session.charId);
        if (!char) return;
        setInput('');
        const withUser: TalkSession = { ...session, turns: [...session.turns, { role: 'user', text, at: Date.now() }], lastActiveAt: Date.now() };
        if (withUser.title === '一次谈心' && !session.turns.some(t => t.role === 'user')) {
            withUser.title = text.slice(0, 16);
        }
        await persist(withUser);
        setBusy(true);
        try {
            const reply = await generateTalkReply(char, userProfile, api, withUser.turns, text, session.mood);
            if (reply) await persist({ ...withUser, turns: [...withUser.turns, { role: 'char', text: reply, at: Date.now() }], lastActiveAt: Date.now() });
        } catch (e: any) {
            addToast(`回应失败：${e?.message || e}`, 'error');
        } finally { setBusy(false); }
    };

    const collect = async (s: TalkSession) => {
        const char = charOf(s.charId);
        const firstUser = s.turns.find(t => t.role === 'user')?.text;
        const item = candidateToItem({
            sourceType: 'talk', sourceId: s.id, title: s.title || '一次谈心',
            subtitle: `和 ${char?.name || '某人'} 的谈心${s.mood ? ` · ${s.mood}` : ''}`,
            excerpt: (firstUser || s.turns[s.turns.length - 1]?.text || '').slice(0, 60),
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

    // ── 谈心进行中 ──
    if (view === 'talk' && session) {
        const char = charOf(session.charId);
        const collected = collectedIds.has(collectionId('talk', session.id));
        return (
            <PaperShell>
                <div aria-hidden className="pointer-events-none absolute top-1/4 right-6 text-8xl opacity-[0.05] select-none">🫧</div>
                {/* 顶栏 */}
                <ScrapHeader
                    title={`和 ${char?.name || ''} 谈心`}
                    onBack={() => { setView('pick'); void reload(); }}
                    backLabel="收起"
                    right={
                        <button onClick={() => collect(session)} disabled={collected} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[11px] font-black active:scale-95 transition disabled:opacity-60" style={collected ? { background: WASHI.lilac.base, color: WASHI.lilac.ink } : { background: '#3a3630', color: '#fcf8ef' }}>
                            <BookmarkSimple size={13} weight={collected ? 'fill' : 'bold'} /> {collected ? '已收藏' : '收藏'}
                        </button>
                    }
                />

                {/* 对话流 */}
                <ScrapScroll innerRef={scrollRef} className="px-4 py-3 space-y-3.5">
                    {session.turns.map((t, i) => (
                        t.role === 'char' ? (
                            <div key={i} className="flex items-start gap-2.5">
                                {char && <img src={char.avatar} className="w-7 h-7 rounded-full object-cover mt-0.5 shrink-0" style={{ border: '1.5px solid #fffdf8', boxShadow: '0 2px 5px rgba(70,62,48,0.3)' }} alt="" />}
                                <div className="max-w-[80%] px-4 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap" style={{ background: 'linear-gradient(180deg,#fdfaf3,#f6efdf)', color: '#4a4334', borderRadius: '4px 14px 14px 14px', border: '1px solid rgba(196,184,160,0.7)', boxShadow: '0 6px 12px -9px rgba(70,62,48,0.4)' }}>
                                    {t.text}
                                </div>
                            </div>
                        ) : (
                            <div key={i} className="flex justify-end">
                                <div className="max-w-[80%] px-4 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap" style={{ background: WASHI.rose.base, color: '#5a3a36', borderRadius: '14px 4px 14px 14px', boxShadow: '0 6px 12px -9px rgba(120,70,64,0.4)' }}>
                                    {t.text}
                                </div>
                            </div>
                        )
                    ))}
                    {busy && (
                        <div className="flex items-center gap-2 text-[11px] px-1" style={{ color: WASHI.rose.ink }}>
                            <span className="animate-pulse" aria-hidden>♥</span> {char?.name} 正在认真听…
                        </div>
                    )}
                </ScrapScroll>

                {/* 输入区 */}
                <div className="relative z-10 shrink-0 px-3 py-3 flex items-end gap-2" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 12px)' }}>
                    <textarea
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
                        rows={1}
                        placeholder="把心里的话慢慢说出来…"
                        disabled={busy}
                        className="flex-1 px-4 py-2.5 rounded-2xl text-[13.5px] outline-none resize-none max-h-28"
                        style={{ background: '#fffdf8', color: INK, border: '1px solid rgba(196,184,160,0.8)' }}
                    />
                    <button onClick={() => void send()} disabled={busy || !input.trim()} className="shrink-0 w-11 h-11 rounded-full flex items-center justify-center active:scale-90 transition disabled:opacity-40" style={inkBtn} aria-label="发送">
                        <Heart size={18} weight="fill" />
                    </button>
                </div>
            </PaperShell>
        );
    }

    // ── 选择 / 历史 ──
    return (
        <PaperShell>
            <ScrapHeader title="谈心" en="HEART TO HEART" onBack={onExit} backLabel="回小剧场" />
            <ScrapScroll className="px-5 pb-12 pt-1">
                <PaperCard tilt={-0.6} className="px-6 py-6 relative overflow-hidden mb-5">
                    <WashiTape color="lilac" rotate={-16} className="absolute -top-3 -left-4 w-20 h-6 rounded-[2px]" />
                    <WashiTape color="rose" rotate={14} className="absolute -top-3 -right-4 w-16 h-6 rounded-[2px]" />
                    <div className="flex items-end gap-2.5">
                        <span className="text-[40px] font-black leading-none" style={{ color: INK }}>谈心</span>
                        <span aria-hidden className="text-2xl -mb-0.5 -rotate-6 select-none">🫂</span>
                    </div>
                    <div className="leading-none mt-1.5" style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 18, color: '#8a7c5e' }}>Heart to Heart</div>
                    <p className="text-[12px] leading-relaxed mt-3" style={{ color: '#6b6456' }}>找个人，把心里的话放下来。<br />这里只负责好好听你说、轻轻抱住你。</p>
                </PaperCard>

                {/* 选倾诉对象 */}
                <SectionTag en="TO WHOM" color="rose" className="mb-2.5">想和谁说说</SectionTag>
                <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2 px-0.5">
                    {characters.length === 0 && <div className="text-[12px] py-3" style={{ color: INK_SOFT }}>还没有角色，先去创建一个吧。</div>}
                    {characters.map((c, i) => (
                        <Polaroid key={c.id} src={c.avatar} caption={c.name} size={56} rotate={i % 2 ? 1.8 : -2} selected={pickCharId === c.id} onClick={() => setPickCharId(c.id)} />
                    ))}
                </div>

                {/* 选心情 */}
                <SectionTag en="MOOD" color="lilac" className="mt-5 mb-2.5">此刻的心情（可不选）</SectionTag>
                <div className="flex flex-wrap gap-2">
                    {MOODS.map(m => (
                        <button key={m} onClick={() => setMood(mood === m ? '' : m)} className="px-3 py-1.5 rounded-full text-[12px] font-bold transition active:scale-95"
                            style={mood === m ? { background: '#3a3630', color: '#fcf8ef' } : { background: WASHI.butter.base, color: WASHI.butter.ink }}>
                            {m}
                        </button>
                    ))}
                </div>

                <button onClick={() => void startSession()} disabled={!pickCharId || busy} className="w-full mt-6 h-12 rounded-full text-[14px] font-black active:scale-[0.98] transition disabled:opacity-50" style={inkBtn}>
                    {busy ? '正在布置这个空间…' : '🫶 开始谈心'}
                </button>

                {/* 历史 */}
                {history.length > 0 && (
                    <div className="mt-8">
                        <SectionTag en="PAST" color="sage" className="mb-2.5">从前的谈心</SectionTag>
                        <div className="space-y-2.5">
                            {history.map((s, i) => {
                                const c = charOf(s.charId);
                                const collected = collectedIds.has(collectionId('talk', s.id));
                                return (
                                    <PaperCard key={s.id} tilt={i % 2 ? 0.5 : -0.5} className="px-3.5 py-3 flex items-center gap-3">
                                        {c ? <img src={c.avatar} className="w-9 h-9 rounded-full object-cover shrink-0" style={{ border: '1.5px solid #fffdf8' }} alt="" /> : <span className="text-[22px]">🫂</span>}
                                        <button onClick={() => resume(s)} className="flex-1 min-w-0 text-left">
                                            <div className="text-[13px] font-black truncate" style={{ color: INK }}>{s.title || '一次谈心'}</div>
                                            <div className="text-[10.5px] truncate" style={{ color: INK_SOFT }}>和 {c?.name || '某人'} · {new Date(s.lastActiveAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })} · {s.turns.length} 句</div>
                                        </button>
                                        <button onClick={() => void collect(s)} disabled={collected} className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center active:scale-90 transition disabled:opacity-50" style={{ color: collected ? WASHI.lilac.ink : WASHI.rose.ink }} title="收进典藏馆">
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
