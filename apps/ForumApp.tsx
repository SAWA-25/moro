import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useOS } from '../context/OSContext';
import { resolveAuxApi } from '../utils/auxApi';
import { llmComplete } from '../utils/llmComplete';
import {
    ForumState, ForumPost, ForumReply, FORUM_BOARDS, boardOf, seedForum, fid,
    npcEmoji, fallbackReplies, buildForumPrompt, parseForumReplies, materializeReplies,
    buildCharThreadPrompt, parseCharThread,
    buildThreadsPrompt, parseThreads, materializeThreads, fallbackThreads, targetFloorCount,
} from '../utils/forum';
import {
    CaretLeft, ChatsCircle, PencilSimple, ArrowFatUp, ChatCircleText, X, Sparkle,
    ArrowsClockwise, MagnifyingGlass, Fire, CrownSimple, Spinner,
} from '@phosphor-icons/react';

const KEY = 'moro_forum_v1';
const FLOOR_BATCH = 12;   // 每次盖楼条数
const THREAD_BATCH = 12;  // 每个板块一次生成帖子数（≥10）

const timeAgo = (t: number): string => {
    const d = Date.now() - t;
    if (d < 60_000) return '刚刚';
    if (d < 3600_000) return `${Math.floor(d / 60_000)} 分钟前`;
    if (d < 86_400_000) return `${Math.floor(d / 3600_000)} 小时前`;
    return `${Math.floor(d / 86_400_000)} 天前`;
};
const kFmt = (n: number): string => n >= 10000 ? `${(n / 10000).toFixed(1)}w` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;

const ForumApp: React.FC = () => {
    const { closeApp, characters, userProfile, apiConfig, auxApiConfig, addToast } = useOS();
    const [state, setState] = useState<ForumState>({ posts: [] });
    const [loaded, setLoaded] = useState(false);
    const [board, setBoard] = useState<string>('chat');
    const [openId, setOpenId] = useState<string | null>(null);
    const [compose, setCompose] = useState<{ board: string; title: string; body: string } | null>(null);
    const [reply, setReply] = useState('');
    const [genBoard, setGenBoard] = useState<string | null>(null); // 正在生成帖子列表的板块
    const [floorBusy, setFloorBusy] = useState(false);             // 正在盖楼
    const [charBusy, setCharBusy] = useState(false);
    const [onlyOp, setOnlyOp] = useState(false);
    const [query, setQuery] = useState('');
    const triedBoards = useRef<Set<string>>(new Set());
    const triedFloors = useRef<Set<string>>(new Set());
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        try { const raw = localStorage.getItem(KEY); setState(raw ? JSON.parse(raw) : seedForum()); }
        catch { setState(seedForum()); }
        setLoaded(true);
    }, []);
    useEffect(() => { if (loaded) { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ } } }, [state, loaded]);

    const charBriefs = useMemo(() => characters.map(c => ({ id: c.id, name: c.name, persona: (c as any).description as string | undefined })), [characters]);
    const charLite = useMemo(() => characters.map(c => ({ id: c.id, name: c.name, avatar: c.convoSettings?.charAvatarOverride || c.avatar })), [characters]);

    const api = () => resolveAuxApi(auxApiConfig, apiConfig);

    const open = openId ? state.posts.find(p => p.id === openId) || null : null;
    const list = useMemo(() => {
        let ps = board === 'all' ? state.posts : state.posts.filter(p => p.boardId === board);
        const q = query.trim();
        if (q) ps = ps.filter(p => p.title.includes(q) || p.body.includes(q) || p.authorName.includes(q));
        return [...ps].sort((a, b) => (b.hot ? 1 : 0) - (a.hot ? 1 : 0) || b.lastActiveAt - a.lastActiveAt);
    }, [state.posts, board, query]);

    const patchPost = (id: string, fn: (p: ForumPost) => ForumPost) =>
        setState(s => ({ posts: s.posts.map(p => p.id === id ? fn(p) : p) }));

    // ── 生成一个板块的「帖子列表」（≥10 帖，cache-first）──────────────────
    const generateThreads = async (boardId: string, replace: boolean) => {
        const bd = boardOf(boardId); if (!bd) return;
        setGenBoard(boardId);
        let raw = [] as ReturnType<typeof parseThreads>;
        try {
            const { system, user } = buildThreadsPrompt(bd, charBriefs, THREAD_BATCH);
            const out = await llmComplete(api(), [
                { role: 'system', content: system }, { role: 'user', content: user },
            ], { temperature: 1.0, maxTokens: 1400 });
            raw = parseThreads(out);
        } catch { /* fall through */ }
        if (raw.length < THREAD_BATCH) raw = [...raw, ...fallbackThreads(boardId, THREAD_BATCH - raw.length)];
        const fresh = materializeThreads(raw, boardId, charLite);
        setState(s => ({
            posts: replace
                ? [...fresh, ...s.posts.filter(p => p.boardId !== boardId || !p.generated)]
                : [...fresh, ...s.posts],
        }));
        setGenBoard(null);
        if (replace) addToast(`换了一批新帖`, 'success');
    };

    // 进入板块时，若没有已生成的帖子则自动盖一批
    useEffect(() => {
        if (!loaded || board === 'all') return;
        const has = state.posts.some(p => p.boardId === board && p.generated);
        if (!has && !triedBoards.current.has(board) && genBoard === null) {
            triedBoards.current.add(board);
            generateThreads(board, false);
        }
    }, [loaded, board, state.posts, genBoard]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── 盖楼：生成下一批楼层（懒加载到 replyCount）────────────────────────
    const loadFloors = async (post: ForumPost, opts?: { auto?: boolean }) => {
        if (floorBusy) return;
        setFloorBusy(true);
        const startFloor = post.replies.length + 2; // 1 楼＝楼主主楼
        const target = post.replyCount || 30;
        const remaining = Math.max(0, target - 1 - post.replies.length);
        const count = Math.min(FLOOR_BATCH, remaining || FLOOR_BATCH);
        let raw = [] as ReturnType<typeof parseForumReplies>;
        try {
            const { system, user } = buildForumPrompt(post, charBriefs, count, startFloor);
            const out = await llmComplete(api(), [
                { role: 'system', content: system }, { role: 'user', content: user },
            ], { temperature: 0.98, maxTokens: 900 });
            raw = parseForumReplies(out);
        } catch { /* fall through */ }
        if (raw.length === 0) raw = fallbackReplies(count);
        patchPost(post.id, p => {
            const more = materializeReplies(raw, charLite, p.replies.length + 2, p.authorName, p.replies);
            return { ...p, replies: [...p.replies, ...more], lastActiveAt: Date.now() };
        });
        setFloorBusy(false);
        if (!opts?.auto) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    };

    // 进帖自动盖第一批楼
    useEffect(() => {
        if (!open) return;
        if (open.replies.length === 0 && (open.replyCount ?? 0) > 0 && !triedFloors.current.has(open.id)) {
            triedFloors.current.add(open.id);
            loadFloors(open, { auto: true });
        }
    }, [openId]); // eslint-disable-line react-hooks/exhaustive-deps

    const submitPost = () => {
        if (!compose || !compose.title.trim()) { addToast('写个标题吧', 'error'); return; }
        const now = Date.now();
        const post: ForumPost = {
            id: fid(), boardId: compose.board, authorType: 'user', authorName: userProfile.name || '我',
            avatar: userProfile.avatar, title: compose.title.trim(), body: compose.body.trim(),
            createdAt: now, lastActiveAt: now, likes: 0, replies: [], replyCount: targetFloorCount(),
        };
        setState(s => ({ posts: [post, ...s.posts] }));
        setCompose(null); setOpenId(post.id);
        addToast('发布成功', 'success');
    };

    const addUserReply = () => {
        if (!open || !reply.trim()) return;
        const isOp = open.authorName === (userProfile.name || '我');
        const r: ForumReply = {
            id: fid(), floor: open.replies.length + 2, authorType: 'user', authorName: userProfile.name || '我',
            avatar: userProfile.avatar, body: reply.trim(), createdAt: Date.now(), likes: 0, isOp,
        };
        patchPost(open.id, p => ({ ...p, replies: [...p.replies, r], lastActiveAt: Date.now(), replyCount: Math.max(p.replyCount || 0, p.replies.length + 2) }));
        setReply('');
        setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }), 50);
    };

    const charPost = async () => {
        if (characters.length === 0) { addToast('还没有角色', 'error'); return; }
        setCharBusy(true);
        const c = characters[Math.floor(Math.random() * characters.length)];
        let decided: { boardId: string; title: string; body: string } | null = null;
        try {
            const { system, user } = buildCharThreadPrompt({ id: c.id, name: c.name, persona: (c as any).description });
            const out = await llmComplete(api(), [
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
            replyCount: targetFloorCount(),
        };
        setState(s => ({ posts: [post, ...s.posts] }));
        setBoard(decided.boardId);
        setCharBusy(false);
        addToast(`${c.name} 发了个帖子`, 'success');
    };

    const likePost = (id: string) => patchPost(id, p => ({ ...p, likes: p.likes + 1 }));
    const likeReply = (postId: string, rid: string) => patchPost(postId, p => ({ ...p, replies: p.replies.map(r => r.id === rid ? { ...r, likes: r.likes + 1 } : r) }));

    if (!loaded) return <div className="h-full w-full bg-[#f6f7f9]" />;

    const Avatar: React.FC<{ a?: string; name: string; type: string; size?: number }> = ({ a, name, type, size = 36 }) =>
        a ? <img src={a} className="rounded-full object-cover shrink-0" style={{ width: size, height: size }} />
            : <span className="rounded-full shrink-0 flex items-center justify-center bg-gradient-to-br from-sky-100 to-blue-100 text-[16px]" style={{ width: size, height: size }}>{type === 'npc' ? npcEmoji(name) : type === 'user' ? '🙂' : '🙂'}</span>;

    const NameTag: React.FC<{ r: { authorType: string; isOp?: boolean } }> = ({ r }) => (
        <>
            {r.isOp && <span className="px-1 py-px rounded bg-amber-50 text-amber-500 text-[9px] font-bold flex items-center gap-0.5"><CrownSimple size={9} weight="fill" />楼主</span>}
            {r.authorType === 'char' && <span className="px-1 py-px rounded bg-rose-50 text-rose-400 text-[9px] font-bold">角色</span>}
            {r.authorType === 'user' && <span className="px-1 py-px rounded bg-sky-50 text-sky-500 text-[9px] font-bold">我</span>}
        </>
    );

    // ───── 帖子详情 ─────
    if (open) {
        const b = boardOf(open.boardId);
        const target = open.replyCount || 30;
        const loadedFloors = open.replies.length + 1; // 含 1 楼楼主
        const canLoadMore = loadedFloors < target;
        const shown = onlyOp ? open.replies.filter(r => r.isOp || r.authorName === open.authorName) : open.replies;
        return (
            <div className="h-full w-full flex flex-col bg-[#f6f7f9]">
                <Header title={`${b?.emoji || ''} ${b?.name || '帖子'}吧`} onBack={() => { setOpenId(null); setOnlyOp(false); }} right={
                    <button onClick={() => setOnlyOp(v => !v)} className={`px-2.5 py-1 rounded-full text-[11px] font-bold active:scale-95 transition-transform ${onlyOp ? 'bg-[#2b6fe0] text-white' : 'bg-slate-100 text-slate-500'}`}>只看楼主</button>
                } />
                <div ref={scrollRef} className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
                    {/* OP = 1 楼 */}
                    <div className="bg-white px-4 py-3.5 border-b-4 border-slate-100">
                        <div className="flex items-center gap-2.5 mb-2">
                            <Avatar a={open.avatar} name={open.authorName} type={open.authorType} />
                            <div className="min-w-0">
                                <div className="text-[13px] font-bold text-slate-700 flex items-center gap-1.5">
                                    {open.authorName}
                                    <span className="px-1 py-px rounded bg-amber-50 text-amber-500 text-[9px] font-bold flex items-center gap-0.5"><CrownSimple size={9} weight="fill" />楼主</span>
                                    {open.authorType === 'char' && <span className="px-1 py-px rounded bg-rose-50 text-rose-400 text-[9px] font-bold">角色</span>}
                                    {open.authorType === 'user' && <span className="px-1 py-px rounded bg-sky-50 text-sky-500 text-[9px] font-bold">我</span>}
                                </div>
                                <div className="text-[10px] text-slate-400">{timeAgo(open.createdAt)} · 共 {kFmt(target)} 楼</div>
                            </div>
                        </div>
                        <h1 className="text-[16px] font-black text-slate-800 leading-snug mb-1.5">{open.title}</h1>
                        {open.body && <p className="text-[13px] text-slate-600 leading-relaxed whitespace-pre-wrap">{open.body}</p>}
                        <div className="flex items-center gap-3 mt-3">
                            <button onClick={() => likePost(open.id)} className="flex items-center gap-1 text-[11px] text-slate-400 active:scale-90 transition-transform"><ArrowFatUp size={15} weight="bold" />{kFmt(open.likes)}</button>
                            <span className="flex items-center gap-1 text-[11px] text-slate-400"><ChatCircleText size={15} weight="bold" />{kFmt(target)}</span>
                            <span className="ml-auto text-[10px] text-slate-300">1 楼 · 楼主</span>
                        </div>
                    </div>
                    {/* 楼层 */}
                    <div className="px-4 pt-3 pb-4 space-y-3.5">
                        {open.replies.length === 0 && floorBusy && (
                            <div className="text-center text-slate-300 text-xs py-8 flex items-center justify-center gap-1.5"><Spinner size={14} className="animate-spin" />网友正在赶来盖楼…</div>
                        )}
                        {shown.length === 0 && open.replies.length > 0 && (
                            <div className="text-center text-slate-300 text-xs py-6">楼主还没有在本帖回复</div>
                        )}
                        {shown.map(r => (
                            <div key={r.id} className="flex gap-2.5">
                                <Avatar a={r.avatar} name={r.authorName} type={r.authorType} size={30} />
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-[12px] font-bold text-slate-600">{r.authorName}</span>
                                        <NameTag r={r} />
                                        <span className="text-[10px] text-slate-300 ml-auto">{r.floor}楼</span>
                                    </div>
                                    <p className="text-[13px] text-slate-700 leading-relaxed mt-0.5 whitespace-pre-wrap">{r.body}</p>
                                    {/* 楼中楼 */}
                                    {r.subReplies && r.subReplies.length > 0 && (
                                        <div className="mt-1.5 bg-slate-50 rounded-lg px-2.5 py-1.5 space-y-1">
                                            {r.subReplies.map(s => (
                                                <p key={s.id} className="text-[12px] leading-relaxed">
                                                    <span className="font-bold text-[#2b6fe0]">{s.authorName}</span>
                                                    <span className="text-slate-400"> 回复 {r.authorName}：</span>
                                                    <span className="text-slate-700">{s.body}</span>
                                                </p>
                                            ))}
                                        </div>
                                    )}
                                    <button onClick={() => likeReply(open.id, r.id)} className="flex items-center gap-1 text-[10px] text-slate-400 mt-1 active:scale-90 transition-transform"><ArrowFatUp size={12} weight="bold" />{r.likes}</button>
                                </div>
                            </div>
                        ))}
                        {/* 加载更多楼层 */}
                        {!onlyOp && (canLoadMore ? (
                            <button onClick={() => loadFloors(open)} disabled={floorBusy}
                                className="w-full py-2.5 rounded-xl bg-white border border-slate-200 text-[12px] font-bold text-[#2b6fe0] flex items-center justify-center gap-1.5 active:scale-[0.98] transition-transform disabled:opacity-60">
                                {floorBusy ? <><Spinner size={14} className="animate-spin" />盖楼中…</> : <><Sparkle size={14} weight="fill" className="text-amber-400" />加载更多楼层（还有约 {kFmt(Math.max(0, target - loadedFloors))} 楼）</>}
                            </button>
                        ) : open.replies.length > 0 && (
                            <div className="text-center text-slate-300 text-[11px] py-3">—— 已经到底了，共 {kFmt(loadedFloors)} 楼 ——</div>
                        ))}
                    </div>
                </div>
                {/* 回帖框 */}
                <div className="shrink-0 border-t border-slate-100 bg-white p-2.5 pb-safe flex items-center gap-2">
                    <input value={reply} onChange={e => setReply(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addUserReply(); }}
                        placeholder="回复楼主，写下你的盖楼…" className="flex-1 px-3.5 py-2.5 bg-slate-100 rounded-full text-[13px] outline-none focus:bg-slate-50" />
                    <button onClick={addUserReply} disabled={!reply.trim()} className="px-4 py-2.5 rounded-full bg-[#2b6fe0] text-white text-[13px] font-bold active:scale-95 transition-transform disabled:opacity-40">回帖</button>
                </div>
            </div>
        );
    }

    // ───── 列表 ─────
    const genning = genBoard !== null;
    return (
        <div className="h-full w-full flex flex-col bg-[#f6f7f9]">
            <Header title="茶话亭" onBack={closeApp}
                icon={<ChatsCircle size={20} weight="fill" className="text-[#2b6fe0]" />}
                right={
                    <div className="flex items-center gap-1">
                        <button onClick={charPost} disabled={charBusy} className="p-2 rounded-full active:scale-90 transition-transform text-slate-500 disabled:opacity-50" title="让角色发帖">
                            <ArrowsClockwise size={18} weight="bold" className={charBusy ? 'animate-spin' : ''} />
                        </button>
                    </div>
                } />
            {/* 搜索栏 */}
            <div className="shrink-0 px-3 py-2 bg-white">
                <div className="flex items-center gap-2 bg-slate-100 rounded-full px-3 py-1.5">
                    <MagnifyingGlass size={15} weight="bold" className="text-slate-400" />
                    <input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜帖子 / 网友"
                        className="flex-1 bg-transparent text-[13px] outline-none" />
                    {query && <button onClick={() => setQuery('')}><X size={14} weight="bold" className="text-slate-400" /></button>}
                </div>
            </div>
            {/* 板块吧 */}
            <div className="shrink-0 flex gap-2 overflow-x-auto px-4 py-2 bg-white border-b border-slate-100" style={{ scrollbarWidth: 'none' }}>
                {[{ id: 'all', name: '全部', emoji: '🏷️' }, ...FORUM_BOARDS].map(bd => (
                    <button key={bd.id} onClick={() => setBoard(bd.id)}
                        className={`shrink-0 px-3 py-1.5 rounded-full text-[12px] font-bold transition-all active:scale-95 ${board === bd.id ? 'bg-[#2b6fe0] text-white shadow shadow-blue-200' : 'bg-slate-100 text-slate-500'}`}>
                        {bd.emoji} {bd.name}{bd.id !== 'all' && bd.id === board ? '吧' : ''}
                    </button>
                ))}
            </div>
            {/* 板块条：换一批 */}
            {board !== 'all' && (
                <div className="shrink-0 flex items-center justify-between px-4 py-2 bg-white border-b border-slate-100">
                    <span className="text-[11px] text-slate-400">{boardOf(board)?.emoji} {boardOf(board)?.name}吧 · {boardOf(board)?.desc}</span>
                    <button onClick={() => generateThreads(board, true)} disabled={genning}
                        className="flex items-center gap-1 text-[11px] font-bold text-[#2b6fe0] active:scale-95 transition-transform disabled:opacity-50">
                        <ArrowsClockwise size={13} weight="bold" className={genBoard === board ? 'animate-spin' : ''} />换一批
                    </button>
                </div>
            )}
            <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
                {genning && list.length === 0 ? (
                    <div className="pt-20 flex flex-col items-center gap-2 text-slate-400">
                        <Spinner size={26} className="animate-spin text-[#2b6fe0]" />
                        <span className="text-[13px] font-bold">正在生成一吧的帖子…</span>
                    </div>
                ) : list.length === 0 ? (
                    <div className="text-center text-slate-300 text-sm pt-20">{query ? '没搜到相关帖子' : '这个吧还没人发帖，来抢沙发～'}</div>
                ) : list.map(p => {
                    const b = boardOf(p.boardId);
                    return (
                        <button key={p.id} onClick={() => setOpenId(p.id)} className="w-full text-left bg-white px-4 py-3 border-b border-slate-100 active:bg-slate-50 transition-colors">
                            <div className="flex items-center gap-2 mb-1">
                                <Avatar a={p.avatar} name={p.authorName} type={p.authorType} size={22} />
                                <span className="text-[11px] text-slate-500 truncate max-w-[90px]">{p.authorName}</span>
                                {p.authorType === 'char' && <span className="text-rose-400 text-[9px]">角色</span>}
                                <span className="text-[10px] text-slate-300">· {timeAgo(p.lastActiveAt)}</span>
                                {board === 'all' && <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-400 shrink-0">{b?.emoji}{b?.name}</span>}
                            </div>
                            <div className="text-[14px] font-bold text-slate-800 leading-snug line-clamp-1 flex items-center gap-1.5">
                                {p.hot && <Fire size={14} weight="fill" className="text-orange-500 shrink-0" />}
                                <span className="line-clamp-1">{p.title}</span>
                            </div>
                            {p.body && <div className="text-[12px] text-slate-400 leading-snug line-clamp-2 mt-0.5">{p.body}</div>}
                            <div className="flex items-center gap-3 mt-1.5 text-[10px] text-slate-400">
                                <span className="flex items-center gap-1"><ArrowFatUp size={12} weight="bold" />{kFmt(p.likes)}</span>
                                <span className="flex items-center gap-1"><ChatCircleText size={12} weight="bold" />{kFmt(p.replyCount || p.replies.length)}</span>
                                {(p.replyCount || 0) >= 200 && <span className="text-orange-400 font-bold">爆楼</span>}
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
                        <input value={compose.title} onChange={e => setCompose(c => c && { ...c, title: e.target.value })} placeholder="标题"
                            className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[15px] font-bold outline-none focus:border-[#2b6fe0]" />
                        <textarea value={compose.body} onChange={e => setCompose(c => c && { ...c, body: e.target.value })} placeholder="正文（可选）" rows={6}
                            className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[14px] outline-none focus:border-[#2b6fe0] resize-none leading-relaxed" />
                        <p className="text-[11px] text-slate-400">发完进帖会自动「召唤网友盖楼」，角色和网友会按人设来回复。</p>
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
