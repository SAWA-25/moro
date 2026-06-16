import React, { useEffect, useRef, useState } from 'react';
import { useOS } from '../../context/OSContext';
import { ArrowLeft, Heart, BookmarkSimple, Trash, ChatCircleDots } from '@phosphor-icons/react';
import { TalkSession, TalkTurn } from '../../types';
import { DB } from '../../utils/db';
import { resolveAuxApi } from '../../utils/auxApi';
import { generateTalkOpening, generateTalkReply } from '../../utils/talkTherapy';
import { candidateToItem, collectionId } from '../../utils/collection';

/**
 * 小剧场·谈心：给 user 一个被认真倾听、被安慰的地方。
 * 选一个角色，把心里话说出来，TA 以格外温柔、专注、共情的姿态陪着你。
 * 每段谈心可存档，能收录进岁时记·典藏馆，也能在那里转发给别的角色。
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
            <div className="absolute inset-0 flex flex-col animate-fade-in overflow-hidden" style={{ paddingTop: 'var(--safe-top)', background: 'linear-gradient(180deg,#fbeef2 0%,#eef0fb 55%,#f3ecfb 100%)' }}>
                <div aria-hidden className="pointer-events-none absolute -top-20 left-1/2 -translate-x-1/2 w-[150%] h-64 rounded-full blur-3xl opacity-60 bg-gradient-to-b from-rose-200/70 via-purple-200/30 to-transparent" />
                {/* 顶栏 */}
                <div className="relative z-10 flex items-center justify-between px-4 pt-3 pb-2 shrink-0">
                    <button onClick={() => { setView('pick'); void reload(); }} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[12px] font-bold bg-white/70 text-purple-500 active:scale-95 transition shadow-sm">
                        <ArrowLeft size={14} weight="bold" /> 收起
                    </button>
                    <div className="flex items-center gap-2 min-w-0">
                        {char && <img src={char.avatar} className="w-7 h-7 rounded-full object-cover ring-2 ring-white/70" alt="" />}
                        <span className="text-[13px] font-bold text-purple-700/90 truncate">和 {char?.name} 谈心</span>
                    </div>
                    <button onClick={() => collect(session)} disabled={collected} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[11px] font-bold active:scale-95 transition shadow-sm disabled:opacity-60" style={{ background: collected ? 'rgba(255,255,255,0.6)' : '#fff', color: collected ? '#a98ec9' : '#c46a8a' }}>
                        <BookmarkSimple size={13} weight={collected ? 'fill' : 'bold'} /> {collected ? '已收藏' : '收藏'}
                    </button>
                </div>

                {/* 对话流 */}
                <div ref={scrollRef} className="relative z-10 flex-1 overflow-y-auto no-scrollbar px-4 py-3 space-y-3">
                    {session.turns.map((t, i) => (
                        t.role === 'char' ? (
                            <div key={i} className="flex items-start gap-2.5">
                                {char && <img src={char.avatar} className="w-7 h-7 rounded-full object-cover mt-0.5 shrink-0 ring-2 ring-white/70" alt="" />}
                                <div className="max-w-[80%] px-4 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap text-purple-900/85" style={{ background: 'rgba(255,255,255,0.92)', borderRadius: '4px 16px 16px 16px', boxShadow: '0 2px 10px rgba(150,120,180,0.12)' }}>
                                    {t.text}
                                </div>
                            </div>
                        ) : (
                            <div key={i} className="flex justify-end">
                                <div className="max-w-[80%] px-4 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap text-white" style={{ background: 'linear-gradient(135deg,#f0a6c0,#c89be0)', borderRadius: '16px 4px 16px 16px', boxShadow: '0 2px 10px rgba(180,120,170,0.2)' }}>
                                    {t.text}
                                </div>
                            </div>
                        )
                    ))}
                    {busy && (
                        <div className="flex items-center gap-2 text-[11px] px-1 text-purple-400/80">
                            <span className="animate-pulse" aria-hidden>♥</span> {char?.name} 正在认真听…
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
                        className="flex-1 px-4 py-2.5 rounded-2xl text-[13.5px] outline-none resize-none bg-white/85 text-purple-900 placeholder:text-purple-300 shadow-sm max-h-28"
                    />
                    <button onClick={() => void send()} disabled={busy || !input.trim()} className="shrink-0 w-11 h-11 rounded-full text-white flex items-center justify-center active:scale-90 transition disabled:opacity-40 shadow-md" style={{ background: 'linear-gradient(135deg,#f0a6c0,#c89be0)' }} aria-label="发送">
                        <Heart size={18} weight="fill" />
                    </button>
                </div>
            </div>
        );
    }

    // ── 选择 / 历史 ──
    return (
        <div className="absolute inset-0 flex flex-col animate-fade-in overflow-hidden" style={{ paddingTop: 'var(--safe-top)', background: 'linear-gradient(180deg,#fbeef2 0%,#eef0fb 60%,#f3ecfb 100%)' }}>
            <div aria-hidden className="pointer-events-none absolute -top-20 left-1/2 -translate-x-1/2 w-[150%] h-72 rounded-full blur-3xl opacity-60 bg-gradient-to-b from-rose-200/70 via-purple-200/30 to-transparent" />
            <div className="relative z-10 flex items-center px-4 pt-3 pb-2 shrink-0">
                <button onClick={onExit} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[12px] font-bold bg-white/70 text-purple-500 active:scale-95 transition shadow-sm">
                    <ArrowLeft size={14} weight="bold" /> 回小剧场
                </button>
            </div>

            <div className="relative z-10 flex-1 overflow-y-auto no-scrollbar px-5 pb-10">
                <div className="text-center mt-2 mb-6 select-none">
                    <ChatCircleDots size={34} weight="fill" className="mx-auto text-purple-300" />
                    <div className="text-[28px] font-black mt-2 bg-clip-text text-transparent bg-gradient-to-r from-rose-400 to-purple-400">谈心</div>
                    <div className="text-[12px] text-purple-500/70 mt-1.5 leading-relaxed">找个人，把心里的话放下来。<br />这里只负责好好听你说、轻轻抱住你。</div>
                </div>

                {/* 选倾诉对象 */}
                <div className="text-[12px] font-bold text-purple-600/80 mb-2 pl-1">想和谁说说？</div>
                <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2 -mx-1 px-1">
                    {characters.length === 0 && <div className="text-[12px] text-purple-400/70 py-4">还没有角色，先去创建一个吧。</div>}
                    {characters.map(c => (
                        <button key={c.id} onClick={() => setPickCharId(c.id)} className="shrink-0 flex flex-col items-center gap-1 active:scale-95 transition">
                            <div className={`w-14 h-14 rounded-full overflow-hidden ring-2 transition ${pickCharId === c.id ? 'ring-pink-400 scale-105' : 'ring-white/70'}`}>
                                <img src={c.avatar} className="w-full h-full object-cover" alt="" />
                            </div>
                            <span className={`text-[10.5px] max-w-[56px] truncate ${pickCharId === c.id ? 'text-pink-500 font-bold' : 'text-purple-500/70'}`}>{c.name}</span>
                        </button>
                    ))}
                </div>

                {/* 选心情 */}
                <div className="text-[12px] font-bold text-purple-600/80 mt-5 mb-2 pl-1">此刻的心情（可不选）</div>
                <div className="flex flex-wrap gap-2">
                    {MOODS.map(m => (
                        <button key={m} onClick={() => setMood(mood === m ? '' : m)} className={`px-3 py-1.5 rounded-full text-[12px] font-medium transition active:scale-95 ${mood === m ? 'text-white shadow' : 'bg-white/70 text-purple-500'}`} style={mood === m ? { background: 'linear-gradient(135deg,#f0a6c0,#c89be0)' } : undefined}>
                            {m}
                        </button>
                    ))}
                </div>

                <button onClick={() => void startSession()} disabled={!pickCharId || busy} className="w-full mt-6 h-12 rounded-2xl text-white text-[14px] font-bold active:scale-[0.98] transition disabled:opacity-50 shadow-lg" style={{ background: 'linear-gradient(135deg,#f0a6c0,#c89be0)' }}>
                    {busy ? '正在布置这个空间…' : '开始谈心'}
                </button>

                {/* 历史 */}
                {history.length > 0 && (
                    <div className="mt-8">
                        <div className="text-[12px] font-bold text-purple-600/80 mb-2 pl-1">从前的谈心</div>
                        <div className="space-y-2.5">
                            {history.map(s => {
                                const c = charOf(s.charId);
                                const collected = collectedIds.has(collectionId('talk', s.id));
                                return (
                                    <div key={s.id} className="rounded-2xl px-3.5 py-3 flex items-center gap-3 bg-white/75 shadow-sm">
                                        {c ? <img src={c.avatar} className="w-9 h-9 rounded-full object-cover shrink-0 ring-1 ring-white" alt="" /> : <span className="text-[22px]">🫂</span>}
                                        <button onClick={() => resume(s)} className="flex-1 min-w-0 text-left">
                                            <div className="text-[13px] font-bold text-purple-800/90 truncate">{s.title || '一次谈心'}</div>
                                            <div className="text-[10.5px] text-purple-400/80 truncate">和 {c?.name || '某人'} · {new Date(s.lastActiveAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })} · {s.turns.length} 句</div>
                                        </button>
                                        <button onClick={() => void collect(s)} disabled={collected} className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center active:scale-90 transition disabled:opacity-50" style={{ color: collected ? '#a98ec9' : '#c46a8a' }} title="收进典藏馆">
                                            <BookmarkSimple size={16} weight={collected ? 'fill' : 'bold'} />
                                        </button>
                                        <button onClick={() => void removeSession(s.id)} className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-purple-300 hover:text-rose-400 active:scale-90 transition" title="删除">
                                            <Trash size={15} weight="bold" />
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default TalkTherapyApp;
