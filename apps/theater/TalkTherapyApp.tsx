import React, { useEffect, useRef, useState } from 'react';
import { useOS } from '../../context/OSContext';
import { Heart, BookmarkSimple, Trash, Quotes, PaperPlaneRight } from '@phosphor-icons/react';
import { TalkSession, TalkTurn } from '../../types';
import { DB } from '../../utils/db';
import { resolveAuxApi } from '../../utils/auxApi';
import { generateTalkOpening, generateTalkReply } from '../../utils/talkTherapy';
import { candidateToItem, collectionId } from '../../utils/collection';
import { PaperShell, ScrapScroll, ScrapHeader, Polaroid, ScrapButton, SectionTag, PaperCard, WashiTape, INK, INK_SOFT } from './scrapbook';

/**
 * 折子戏·谈心（肆）：给 user 一个被认真倾听、被安慰的地方。
 * 选一个角色，把心里话说出来，TA 以格外温柔、专注、共情的姿态陪着你。
 * 每段谈心可存档，能收录进岁时记·典藏馆。黑白拼贴手账皮肤（暖白纸 + 墨）。
 */

interface Props { onExit: () => void; }

const MOODS = ['有点难过', '心里很烦', '觉得孤单', '有点迷茫', '压力好大', '想分享开心事'];
const genId = () => `talk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

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
                {/* 顶栏：收起 + 头像名 + 收藏 */}
                <div className="relative z-20 flex items-center justify-between px-4 pt-3 pb-2 shrink-0">
                    <ScrapButton variant="paper" className="px-3 py-1.5 text-[11px]" onClick={() => { setView('pick'); void reload(); }} icon={
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
                    }>收起</ScrapButton>
                    <div className="flex items-center gap-2 min-w-0">
                        {char && <img src={char.avatar} className="w-7 h-7 rounded-full object-cover" style={{ filter: 'contrast(1.05)', boxShadow: '0 0 0 1.5px #f6f3ec, 0 0 0 2.5px rgba(176,170,158,0.7)' }} alt="" />}
                        <span className="text-[13px] font-black truncate" style={{ color: INK }}>和 {char?.name} 谈心</span>
                    </div>
                    <ScrapButton variant={collected ? 'ghost' : 'ink'} className="px-3 py-1.5 text-[11px]" disabled={collected} onClick={() => collect(session)} icon={<BookmarkSimple size={13} weight={collected ? 'fill' : 'bold'} />}>
                        {collected ? '已收' : '收藏'}
                    </ScrapButton>
                </div>

                {/* 对话流 */}
                <div ref={scrollRef} className="relative z-10 flex-1 overflow-y-auto no-scrollbar px-4 py-3 space-y-3">
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
                    {busy && (
                        <div className="flex items-center gap-2 text-[11px] px-1" style={{ color: INK_SOFT }}>
                            <Heart size={11} weight="fill" className="animate-pulse" /> {char?.name} 正在认真听…
                        </div>
                    )}
                </div>

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

                {/* 选倾诉对象 */}
                <SectionTag en="WHO" className="mb-3">想和谁说说？</SectionTag>
                <div className="flex gap-3.5 overflow-x-auto no-scrollbar pb-2 -mx-1 px-1">
                    {characters.length === 0 && <div className="text-[12px] py-4" style={{ color: INK_SOFT }}>还没有角色，先去创建一个吧。</div>}
                    {characters.map((c, i) => (
                        <Polaroid key={c.id} src={c.avatar} caption={c.name} size={58} rotate={i % 2 ? 1.5 : -1.5} selected={pickCharId === c.id} onClick={() => setPickCharId(c.id)} />
                    ))}
                </div>

                {/* 选心情 */}
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

                <ScrapButton variant="ink" className="w-full mt-6 h-12 text-[14px]" disabled={!pickCharId || busy} onClick={() => void startSession()}>
                    {busy ? '正在布置这个空间…' : '开始谈心'}
                </ScrapButton>

                {/* 历史 */}
                {history.length > 0 && (
                    <div className="mt-8">
                        <SectionTag en="ARCHIVE" className="mb-3">从前的谈心</SectionTag>
                        <div className="space-y-3">
                            {history.map((s, i) => {
                                const c = charOf(s.charId);
                                const collected = collectedIds.has(collectionId('talk', s.id));
                                return (
                                    <PaperCard key={s.id} tilt={i % 2 ? 0.5 : -0.5} className="px-3.5 py-3 flex items-center gap-3">
                                        {c ? <img src={c.avatar} className="w-9 h-9 rounded-full object-cover shrink-0" style={{ filter: 'contrast(1.05)', boxShadow: '0 0 0 1.5px #f6f3ec, 0 0 0 2.5px rgba(176,170,158,0.6)' }} alt="" /> : <span className="text-[22px]">🫂</span>}
                                        <button onClick={() => resume(s)} className="flex-1 min-w-0 text-left">
                                            <div className="text-[13px] font-black truncate" style={{ color: INK }}>{s.title || '一次谈心'}</div>
                                            <div className="text-[10.5px] truncate mt-0.5" style={{ color: INK_SOFT }}>和 {c?.name || '某人'} · {new Date(s.lastActiveAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })} · {s.turns.length} 句</div>
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
