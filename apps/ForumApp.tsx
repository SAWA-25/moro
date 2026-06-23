import React, { useState, useEffect, useMemo } from 'react';
import { useOS } from '../context/OSContext';
import { resolveAuxApi } from '../utils/auxApi';
import { llmComplete } from '../utils/llmComplete';
import {
    ForumState, ForumPost, ForumReply, FORUM_BOARDS, boardOf, seedForum, fid,
    npcEmoji, fallbackReplies, buildForumPrompt, parseForumReplies, materializeReplies,
    buildCharThreadPrompt, parseCharThread,
} from '../utils/forum';
import { CaretLeft, ChatsCircle, PencilSimple, ArrowFatUp, ChatCircleText, X, Sparkle, ArrowsClockwise } from '@phosphor-icons/react';

const KEY = 'moro_forum_v1';

const timeAgo = (t: number): string => {
    const d = Date.now() - t;
    if (d < 60_000) return '刚刚';
    if (d < 3600_000) return `${Math.floor(d / 60_000)} 分钟前`;
    if (d < 86_400_000) return `${Math.floor(d / 3600_000)} 小时前`;
    return `${Math.floor(d / 86_400_000)} 天前`;
};

const ForumApp: React.FC = () => {
    const { closeApp, characters, userProfile, apiConfig, auxApiConfig, addToast } = useOS();
    const [state, setState] = useState<ForumState>({ posts: [] });
    const [loaded, setLoaded] = useState(false);
    const [board, setBoard] = useState<string>('all');
    const [openId, setOpenId] = useState<string | null>(null);
    const [compose, setCompose] = useState<{ board: string; title: string; body: string } | null>(null);
    const [reply, setReply] = useState('');
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        try { const raw = localStorage.getItem(KEY); setState(raw ? JSON.parse(raw) : seedForum()); }
        catch { setState(seedForum()); }
        setLoaded(true);
    }, []);
    useEffect(() => { if (loaded) { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ } } }, [state, loaded]);

    const charBriefs = useMemo(() => characters.map(c => ({ id: c.id, name: c.name, persona: (c as any).description as string | undefined })), [characters]);
    const charLite = useMemo(() => characters.map(c => ({ id: c.id, name: c.name, avatar: c.convoSettings?.charAvatarOverride || c.avatar })), [characters]);

    const open = openId ? state.posts.find(p => p.id === openId) || null : null;
    const list = useMemo(() => {
        const ps = board === 'all' ? state.posts : state.posts.filter(p => p.boardId === board);
        return [...ps].sort((a, b) => b.lastActiveAt - a.lastActiveAt);
    }, [state.posts, board]);

    const patchPost = (id: string, fn: (p: ForumPost) => ForumPost) =>
        setState(s => ({ posts: s.posts.map(p => p.id === id ? fn(p) : p) }));

    const submitPost = () => {
        if (!compose || !compose.title.trim()) { addToast('写个标题吧', 'error'); return; }
        const now = Date.now();
        const post: ForumPost = {
            id: fid(), boardId: compose.board, authorType: 'user', authorName: userProfile.name || '我',
            avatar: userProfile.avatar, title: compose.title.trim(), body: compose.body.trim(),
            createdAt: now, lastActiveAt: now, likes: 0, replies: [],
        };
        setState(s => ({ posts: [post, ...s.posts] }));
        setCompose(null); setOpenId(post.id);
        addToast('发布成功', 'success');
    };

    const addUserReply = () => {
        if (!open || !reply.trim()) return;
        const r: ForumReply = {
            id: fid(), floor: open.replies.length + 1, authorType: 'user', authorName: userProfile.name || '我',
            avatar: userProfile.avatar, body: reply.trim(), createdAt: Date.now(), likes: 0,
        };
        patchPost(open.id, p => ({ ...p, replies: [...p.replies, r], lastActiveAt: Date.now() }));
        setReply('');
    };

    const summon = async (post: ForumPost) => {
        setBusy(true);
        const count = 4;
        let raw: { name: string; body: string }[] = [];
        try {
            const { system, user } = buildForumPrompt(post, charBriefs, count);
            const out = await llmComplete(resolveAuxApi(auxApiConfig, apiConfig), [
                { role: 'system', content: system }, { role: 'user', content: user },
            ], { temperature: 0.95, maxTokens: 500 });
            raw = parseForumReplies(out);
        } catch { /* fall through */ }
        if (raw.length === 0) raw = fallbackReplies(count);
        const replies = materializeReplies(raw, charLite, post.replies.length + 1);
        patchPost(post.id, p => ({ ...p, replies: [...p.replies, ...replies], lastActiveAt: Date.now() }));
        setBusy(false);
    };

    const charPost = async () => {
        if (characters.length === 0) { addToast('还没有角色', 'error'); return; }
        setBusy(true);
        const c = characters[Math.floor(Math.random() * characters.length)];
        let decided: { boardId: string; title: string; body: string } | null = null;
        try {
            const { system, user } = buildCharThreadPrompt({ id: c.id, name: c.name, persona: (c as any).description });
            const out = await llmComplete(resolveAuxApi(auxApiConfig, apiConfig), [
                { role: 'system', content: system }, { role: 'user', content: user },
            ], { temperature: 0.95, maxTokens: 300 });
            decided = parseCharThread(out);
        } catch { /* fall through */ }
        if (!decided) decided = { boardId: 'chat', title: '今天也想找人说说话', body: '没什么大事，就是突然想冒个泡。有人在吗？' };
        const now = Date.now();
        const post: ForumPost = {
            id: fid(), boardId: decided.boardId, authorType: 'char', authorId: c.id,
            authorName: c.name, avatar: c.convoSettings?.charAvatarOverride || c.avatar,
            title: decided.title, body: decided.body, createdAt: now, lastActiveAt: now, likes: 0, replies: [],
        };
        setState(s => ({ posts: [post, ...s.posts] }));
        setBusy(false);
        addToast(`${c.name} 发了个帖子`, 'success');
    };

    const likePost = (id: string) => patchPost(id, p => ({ ...p, likes: p.likes + 1 }));
    const likeReply = (postId: string, rid: string) => patchPost(postId, p => ({ ...p, replies: p.replies.map(r => r.id === rid ? { ...r, likes: r.likes + 1 } : r) }));

    if (!loaded) return <div className="h-full w-full bg-[#f6f7f9]" />;

    const Avatar: React.FC<{ a?: string; name: string; type: string; size?: number }> = ({ a, name, type, size = 36 }) =>
        a ? <img src={a} className="rounded-full object-cover shrink-0" style={{ width: size, height: size }} />
            : <span className="rounded-full shrink-0 flex items-center justify-center bg-[#e9edf2] text-[16px]" style={{ width: size, height: size }}>{type === 'npc' ? npcEmoji(name) : '🙂'}</span>;

    // ───── 帖子详情 ─────
    if (open) {
        const b = boardOf(open.boardId);
        return (
            <div className="h-full w-full flex flex-col bg-[#f6f7f9]">
                <Header title={`${b?.emoji || ''} ${b?.name || '帖子'}`} onBack={() => setOpenId(null)} />
                <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
                    {/* OP */}
                    <div className="bg-white px-4 py-3.5 border-b border-slate-100">
                        <div className="flex items-center gap-2.5 mb-2">
                            <Avatar a={open.avatar} name={open.authorName} type={open.authorType} />
                            <div className="min-w-0">
                                <div className="text-[13px] font-bold text-slate-700 flex items-center gap-1.5">
                                    {open.authorName}
                                    {open.authorType === 'char' && <span className="px-1 py-px rounded bg-rose-50 text-rose-400 text-[9px] font-bold">角色</span>}
                                    {open.authorType === 'user' && <span className="px-1 py-px rounded bg-sky-50 text-sky-500 text-[9px] font-bold">我</span>}
                                </div>
                                <div className="text-[10px] text-slate-400">{timeAgo(open.createdAt)}</div>
                            </div>
                        </div>
                        <h1 className="text-[16px] font-black text-slate-800 leading-snug mb-1.5">{open.title}</h1>
                        {open.body && <p className="text-[13px] text-slate-600 leading-relaxed whitespace-pre-wrap">{open.body}</p>}
                        <div className="flex items-center gap-3 mt-3">
                            <button onClick={() => likePost(open.id)} className="flex items-center gap-1 text-[11px] text-slate-400 active:scale-90 transition-transform"><ArrowFatUp size={15} weight="bold" />{open.likes}</button>
                            <span className="flex items-center gap-1 text-[11px] text-slate-400"><ChatCircleText size={15} weight="bold" />{open.replies.length}</span>
                        </div>
                    </div>
                    {/* 召唤网友 */}
                    <div className="px-4 py-2.5">
                        <button onClick={() => summon(open)} disabled={busy}
                            className="w-full py-2.5 rounded-xl bg-white border border-slate-200 text-[12px] font-bold text-slate-600 flex items-center justify-center gap-1.5 active:scale-[0.98] transition-transform disabled:opacity-60">
                            <Sparkle size={15} weight="fill" className="text-amber-400" />{busy ? '网友赶来中…' : '召唤网友盖楼'}
                        </button>
                    </div>
                    {/* 楼层 */}
                    <div className="px-4 pb-4 space-y-3">
                        {open.replies.length === 0 && <div className="text-center text-slate-300 text-xs py-6">还没有人回复，召唤网友或自己先占个楼～</div>}
                        {open.replies.map(r => (
                            <div key={r.id} className="flex gap-2.5">
                                <Avatar a={r.avatar} name={r.authorName} type={r.authorType} size={30} />
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-[12px] font-bold text-slate-600">{r.authorName}</span>
                                        {r.authorType === 'char' && <span className="text-rose-400 text-[9px]">角色</span>}
                                        {r.authorType === 'user' && <span className="text-sky-500 text-[9px]">我</span>}
                                        <span className="text-[10px] text-slate-300 ml-auto">{r.floor}楼</span>
                                    </div>
                                    <p className="text-[13px] text-slate-700 leading-relaxed mt-0.5">{r.body}</p>
                                    <button onClick={() => likeReply(open.id, r.id)} className="flex items-center gap-1 text-[10px] text-slate-400 mt-1 active:scale-90 transition-transform"><ArrowFatUp size={12} weight="bold" />{r.likes}</button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
                {/* 回帖框 */}
                <div className="shrink-0 border-t border-slate-100 bg-white p-2.5 pb-safe flex items-center gap-2">
                    <input value={reply} onChange={e => setReply(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addUserReply(); }}
                        placeholder="说点什么…" className="flex-1 px-3.5 py-2.5 bg-slate-100 rounded-full text-[13px] outline-none focus:bg-slate-50" />
                    <button onClick={addUserReply} disabled={!reply.trim()} className="px-4 py-2.5 rounded-full bg-[#2b6fe0] text-white text-[13px] font-bold active:scale-95 transition-transform disabled:opacity-40">回帖</button>
                </div>
            </div>
        );
    }

    // ───── 列表 ─────
    return (
        <div className="h-full w-full flex flex-col bg-[#f6f7f9]">
            <Header title="茶话亭" onBack={closeApp} right={
                <button onClick={charPost} disabled={busy} className="p-2 rounded-full active:scale-90 transition-transform text-slate-500 disabled:opacity-50" title="让角色发帖">
                    <ArrowsClockwise size={18} weight="bold" className={busy ? 'animate-spin' : ''} />
                </button>
            } icon={<ChatsCircle size={20} weight="fill" className="text-[#2b6fe0]" />} />
            {/* 板块 */}
            <div className="shrink-0 flex gap-2 overflow-x-auto px-4 py-2 bg-white border-b border-slate-100" style={{ scrollbarWidth: 'none' }}>
                {[{ id: 'all', name: '全部', emoji: '🏷️' }, ...FORUM_BOARDS].map(bd => (
                    <button key={bd.id} onClick={() => setBoard(bd.id)}
                        className={`shrink-0 px-3 py-1.5 rounded-full text-[12px] font-bold transition-all active:scale-95 ${board === bd.id ? 'bg-[#2b6fe0] text-white' : 'bg-slate-100 text-slate-500'}`}>
                        {bd.emoji} {bd.name}
                    </button>
                ))}
            </div>
            <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
                {list.length === 0 ? (
                    <div className="text-center text-slate-300 text-sm pt-20">这个板块还没人发帖，来抢沙发～</div>
                ) : list.map(p => {
                    const b = boardOf(p.boardId);
                    return (
                        <button key={p.id} onClick={() => setOpenId(p.id)} className="w-full text-left bg-white px-4 py-3 border-b border-slate-100 active:bg-slate-50 transition-colors">
                            <div className="flex items-center gap-2 mb-1">
                                <Avatar a={p.avatar} name={p.authorName} type={p.authorType} size={22} />
                                <span className="text-[11px] text-slate-500 truncate">{p.authorName}</span>
                                <span className="text-[10px] text-slate-300">· {timeAgo(p.lastActiveAt)}</span>
                                <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-400 shrink-0">{b?.emoji}{b?.name}</span>
                            </div>
                            <div className="text-[14px] font-bold text-slate-800 leading-snug line-clamp-1">{p.title}</div>
                            {p.body && <div className="text-[12px] text-slate-400 leading-snug line-clamp-1 mt-0.5">{p.body}</div>}
                            <div className="flex items-center gap-3 mt-1.5 text-[10px] text-slate-400">
                                <span className="flex items-center gap-1"><ArrowFatUp size={12} weight="bold" />{p.likes}</span>
                                <span className="flex items-center gap-1"><ChatCircleText size={12} weight="bold" />{p.replies.length}</span>
                            </div>
                        </button>
                    );
                })}
                <div className="h-20" />
            </div>
            {/* 发帖 FAB */}
            <button onClick={() => setCompose({ board: board === 'all' ? 'chat' : board, title: '', body: '' })}
                className="absolute right-5 bottom-6 w-14 h-14 rounded-full bg-[#2b6fe0] text-white flex items-center justify-center shadow-xl shadow-blue-300/50 active:scale-90 transition-transform z-20">
                <PencilSimple size={24} weight="bold" />
            </button>

            {/* 发帖弹窗 */}
            {compose && (
                <div className="absolute inset-0 z-40 flex flex-col bg-white animate-slide-up">
                    <Header title="发帖" onBack={() => setCompose(null)} backIcon={<X size={22} weight="bold" />} right={
                        <button onClick={submitPost} className="px-4 py-1.5 rounded-full bg-[#2b6fe0] text-white text-[13px] font-bold active:scale-95 transition-transform">发布</button>
                    } />
                    <div className="flex-1 overflow-y-auto p-4 space-y-3">
                        <div className="flex gap-2 flex-wrap">
                            {FORUM_BOARDS.map(bd => (
                                <button key={bd.id} onClick={() => setCompose(c => c && { ...c, board: bd.id })}
                                    className={`px-3 py-1.5 rounded-full text-[12px] font-bold transition-all ${compose.board === bd.id ? 'bg-[#2b6fe0] text-white' : 'bg-slate-100 text-slate-500'}`}>
                                    {bd.emoji} {bd.name}
                                </button>
                            ))}
                        </div>
                        <input value={compose.title} onChange={e => setCompose(c => c && { ...c, title: e.target.value })} placeholder="标题" maxLength={40}
                            className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[15px] font-bold outline-none focus:border-[#2b6fe0]" />
                        <textarea value={compose.body} onChange={e => setCompose(c => c && { ...c, body: e.target.value })} placeholder="正文（可选）" rows={6} maxLength={500}
                            className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[14px] outline-none focus:border-[#2b6fe0] resize-none leading-relaxed" />
                        <p className="text-[11px] text-slate-400">发完后在帖子里点「召唤网友盖楼」，让角色和网友来回复。</p>
                    </div>
                </div>
            )}
        </div>
    );
};

const Header: React.FC<{ title: string; onBack: () => void; right?: React.ReactNode; icon?: React.ReactNode; backIcon?: React.ReactNode }> = ({ title, onBack, right, icon, backIcon }) => (
    <div className="shrink-0 bg-white border-b border-slate-100">
        <div style={{ height: 'var(--safe-top)' }} />
        <div className="flex items-center px-3 py-2.5 gap-2">
            <button onClick={onBack} className="p-2 -ml-1 rounded-full active:scale-90 transition-transform text-slate-500">{backIcon || <CaretLeft size={22} weight="bold" />}</button>
            {icon}
            <span className="font-black text-slate-800 text-[17px] tracking-tight">{title}</span>
            <div className="flex-1" />
            {right}
        </div>
    </div>
);

export default ForumApp;
