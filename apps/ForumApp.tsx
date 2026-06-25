import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useOS } from '../context/OSContext';
import { resolveAuxApi } from '../utils/auxApi';
import { llmComplete } from '../utils/llmComplete';
import {
    ForumState, ForumPost, ForumReply, ForumPoll, FORUM_BOARDS, boardOf, seedForum, fid,
    npcEmoji, fallbackReplies, buildForumPrompt, parseForumReplies, materializeReplies,
    buildCharThreadPrompt, parseCharThread,
    buildThreadsPrompt, parseThreads, materializeThreads, fallbackThreads, targetFloorCount,
    ForumUserMeta, defaultForumMeta, ForumNotif, ForumNotifKind, makeNotif, unreadCount,
    levelInfo, isCheckedIn, checkIn, maxStreak, toggleFollowBoard, toggleCollect, addExp,
    boardStat, hotRank, userLikesReceived, votePoll, pollTotal,
} from '../utils/forum';
import {
    CaretLeft, ChatsCircle, PencilSimple, ArrowFatUp, ArrowFatDown, ChatCircleText, X, Sparkle,
    ArrowsClockwise, MagnifyingGlass, Fire, CrownSimple, Spinner, House, BellSimple, User,
    Star, BookmarkSimple, ShareNetwork, ArrowsDownUp, CalendarCheck,
    Trophy, Plus, Check, CaretRight, Confetti, ChatCircleDots, Smiley, ChartBar, Heart, Medal,
} from '@phosphor-icons/react';

const KEY = 'moro_forum_v1';
const META_KEY = 'moro_forum_meta_v1';
const NOTIF_KEY = 'moro_forum_notif_v1';
const FLOOR_BATCH = 12;   // 每次盖楼条数
const THREAD_BATCH = 12;  // 每个板块一次生成帖子数（≥10）
const BLUE = '#2b6fe0';

// 贴吧式颜文字（回帖快捷插入）
const KAOMOJI = ['[doge]', '(｡･ω･｡)', '( ´_ゝ`)', '(¦3[▓▓]', '(*•̀ᴗ•́*)', 'σ`∀´)σ', '(╯‵□′)╯', '꒰๑˃̶᷄ ⌑ ˂̶᷅๑꒱', '( ˘•ω•˘ )', '╮(╯▽╰)╭', '(๑•̀ㅂ•́)و✧', '哈哈哈哈哈'];

const timeAgo = (t: number): string => {
    const d = Date.now() - t;
    if (d < 60_000) return '刚刚';
    if (d < 3600_000) return `${Math.floor(d / 60_000)} 分钟前`;
    if (d < 86_400_000) return `${Math.floor(d / 3600_000)} 小时前`;
    return `${Math.floor(d / 86_400_000)} 天前`;
};
const kFmt = (n: number): string => n >= 10000 ? `${(n / 10000).toFixed(1)}w` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;

// 非用户作者（角色/网友）的「伪等级」：按名字 hash 稳定派生，让每个人都显示 Lv 标
const pseudoLevel = (name: string): number => {
    let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
    return 1 + (Math.abs(h) % 16);
};

const ForumApp: React.FC = () => {
    const { closeApp, characters, userProfile, apiConfig, auxApiConfig, addToast } = useOS();
    const [state, setState] = useState<ForumState>({ posts: [] });
    const [meta, setMeta] = useState<ForumUserMeta>(defaultForumMeta());
    const [notifs, setNotifs] = useState<ForumNotif[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [tab, setTab] = useState<'home' | 'msg' | 'me'>('home');
    const [board, setBoard] = useState<string>('chat');
    const [openId, setOpenId] = useState<string | null>(null);
    const [compose, setCompose] = useState<{ board: string; title: string; body: string; pollOn: boolean; pollQ: string; pollOpts: string[] } | null>(null);
    const [reply, setReply] = useState('');
    const [kaoOpen, setKaoOpen] = useState(false);
    const [genBoard, setGenBoard] = useState<string | null>(null); // 正在生成帖子列表的板块
    const [floorBusy, setFloorBusy] = useState(false);             // 正在盖楼
    const [charBusy, setCharBusy] = useState(false);
    const [onlyOp, setOnlyOp] = useState(false);
    const [order, setOrder] = useState<'asc' | 'desc'>('asc');     // 楼层正序/倒序
    const [query, setQuery] = useState('');
    const [msgFilter, setMsgFilter] = useState<'all' | ForumNotifKind>('all');
    const [meSub, setMeSub] = useState<'posts' | 'collect' | 'follow'>('posts');
    const [signCard, setSignCard] = useState<{ gained: number; streak: number; rank: number } | null>(null);
    const triedBoards = useRef<Set<string>>(new Set());
    const triedFloors = useRef<Set<string>>(new Set());
    const scrollRef = useRef<HTMLDivElement>(null);
    const metaRef = useRef(meta);
    useEffect(() => { metaRef.current = meta; }, [meta]);

    const userName = userProfile.name || '我';
    const myLevel = useMemo(() => levelInfo(meta.exp), [meta.exp]);

    useEffect(() => {
        try { const raw = localStorage.getItem(KEY); setState(raw ? JSON.parse(raw) : seedForum()); }
        catch { setState(seedForum()); }
        try { const raw = localStorage.getItem(META_KEY); if (raw) setMeta({ ...defaultForumMeta(), ...JSON.parse(raw) }); } catch { /* ignore */ }
        try {
            const raw = localStorage.getItem(NOTIF_KEY);
            if (raw) setNotifs(JSON.parse(raw));
            else setNotifs([{ id: fid(), kind: 'system', postId: '', postTitle: '欢迎来到茶话亭', actorName: '茶话亭小助手', actorType: 'npc', snippet: '关注你喜欢的吧、每天签到攒经验升等级，发帖回帖会有网友来盖楼～', createdAt: Date.now(), read: false }]);
        } catch { /* ignore */ }
        setLoaded(true);
    }, []);
    useEffect(() => { if (loaded) { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ } } }, [state, loaded]);
    useEffect(() => { if (loaded) { try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch { /* ignore */ } } }, [meta, loaded]);
    useEffect(() => { if (loaded) { try { localStorage.setItem(NOTIF_KEY, JSON.stringify(notifs)); } catch { /* ignore */ } } }, [notifs, loaded]);

    const charBriefs = useMemo(() => characters.map(c => ({ id: c.id, name: c.name, persona: (c as any).description as string | undefined })), [characters]);
    const charLite = useMemo(() => characters.map(c => ({ id: c.id, name: c.name, avatar: c.convoSettings?.charAvatarOverride || c.avatar })), [characters]);

    const api = () => resolveAuxApi(auxApiConfig, apiConfig);
    const unread = unreadCount(notifs);

    const open = openId ? state.posts.find(p => p.id === openId) || null : null;
    const list = useMemo(() => {
        let ps = board === 'all' ? state.posts : state.posts.filter(p => p.boardId === board);
        const q = query.trim();
        if (q) ps = ps.filter(p => p.title.includes(q) || p.body.includes(q) || p.authorName.includes(q));
        return [...ps].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.hot ? 1 : 0) - (a.hot ? 1 : 0) || b.lastActiveAt - a.lastActiveAt);
    }, [state.posts, board, query]);
    const hotList = useMemo(() => hotRank(state.posts, 6), [state.posts]);
    const myPosts = useMemo(() => state.posts.filter(p => p.authorType === 'user' || p.authorName === userName), [state.posts, userName]);
    const myCollected = useMemo(() => meta.collectedPostIds.map(id => state.posts.find(p => p.id === id)).filter(Boolean) as ForumPost[], [meta.collectedPostIds, state.posts]);
    const likesGot = useMemo(() => userLikesReceived(state.posts, userName), [state.posts, userName]);

    const patchPost = (id: string, fn: (p: ForumPost) => ForumPost) =>
        setState(s => ({ posts: s.posts.map(p => p.id === id ? fn(p) : p) }));
    const pushNotif = (n: ForumNotif | ForumNotif[]) => setNotifs(s => [...(Array.isArray(n) ? n : [n]), ...s].slice(0, 200));
    const gainExp = (n: number) => setMeta(m => addExp(m, n));

    // ── 生成一个板块的「帖子列表」（≥10 帖，cache-first）──────────────────
    const generateThreads = async (boardId: string, replace: boolean) => {
        const bd = boardOf(boardId); if (!bd) return;
        setGenBoard(boardId);
        let raw = [] as ReturnType<typeof parseThreads>;
        try {
            const { system, user } = buildThreadsPrompt(bd, charBriefs, THREAD_BATCH);
            const out = await llmComplete(api(), [
                { role: 'system', content: system }, { role: 'user', content: user },
            ], { temperature: 1.05, maxTokens: 8000 });
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
        if (replace) {
            addToast(`换了一批新帖`, 'success');
            if (metaRef.current.followedBoards.includes(boardId)) {
                pushNotif(makeNotif('newpost', { id: '', title: `${bd.name}吧 来了 ${fresh.length} 条新帖` }, { name: `${bd.emoji}${bd.name}吧`, type: 'npc' }, '你关注的吧有更新，去看看～'));
            }
        }
    };

    // 进入板块时，若没有已生成的帖子则自动盖一批
    useEffect(() => {
        if (!loaded || tab !== 'home' || board === 'all') return;
        const has = state.posts.some(p => p.boardId === board && p.generated);
        if (!has && !triedBoards.current.has(board) && genBoard === null) {
            triedBoards.current.add(board);
            generateThreads(board, false);
        }
    }, [loaded, tab, board, state.posts, genBoard]); // eslint-disable-line react-hooks/exhaustive-deps

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
            ], { temperature: 0.98, maxTokens: 4000 });
            raw = parseForumReplies(out);
        } catch { /* fall through */ }
        if (raw.length === 0) raw = fallbackReplies(count);
        // 先一次性落成楼层（materializeReplies 会把楼中楼挂进 post.replies 的宿主对象），再用它更新 state + 派生通知
        const added = materializeReplies(raw, charLite, post.replies.length + 2, post.authorName, post.replies);
        const bonus = post.authorType === 'user' ? Math.ceil(added.length / 3) : 0; // 用户帖被盖楼→涨点赞
        patchPost(post.id, p => ({ ...p, replies: [...p.replies, ...added], likes: p.likes + bonus, lastActiveAt: Date.now() }));
        // 用户自己的帖子被盖楼/点赞 → 进消息中心
        if (post.authorType === 'user' && added.length) {
            const notifList: ForumNotif[] = [];
            for (const r of added) for (const s of r.subReplies || []) {
                if (s.authorName !== userName) notifList.push(makeNotif('reply', post, { name: s.authorName, type: s.authorType, avatar: s.avatar }, s.body));
            }
            const first = added.find(r => r.authorName !== userName);
            if (first) {
                notifList.push(makeNotif('reply', post, { name: first.authorName, type: first.authorType, avatar: first.avatar }, added.length > 1 ? `等 ${added.length} 位网友来盖楼：${first.body}` : first.body));
                const liker = added[Math.floor(Math.random() * added.length)];
                notifList.push(makeNotif('like', post, { name: liker.authorName, type: liker.authorType, avatar: liker.avatar }));
            }
            if (notifList.length) pushNotif(notifList);
            gainExp(2);
        }
        setFloorBusy(false);
        if (!opts?.auto && order === 'asc') scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    };

    // 进帖自动盖第一批楼
    useEffect(() => {
        if (!open) return;
        setOrder('asc');
        if (open.replies.length === 0 && (open.replyCount ?? 0) > 0 && !triedFloors.current.has(open.id)) {
            triedFloors.current.add(open.id);
            loadFloors(open, { auto: true });
        }
    }, [openId]); // eslint-disable-line react-hooks/exhaustive-deps

    const submitPost = () => {
        if (!compose || !compose.title.trim()) { addToast('写个标题吧', 'error'); return; }
        const now = Date.now();
        let poll: ForumPoll | undefined;
        if (compose.pollOn) {
            const opts = compose.pollOpts.map(o => o.trim()).filter(Boolean);
            if (compose.pollQ.trim() && opts.length >= 2) poll = { question: compose.pollQ.trim(), options: opts.map(t => ({ text: t, votes: 0 })) };
        }
        const post: ForumPost = {
            id: fid(), boardId: compose.board, authorType: 'user', authorName: userName,
            avatar: userProfile.avatar, title: compose.title.trim(), body: compose.body.trim(),
            createdAt: now, lastActiveAt: now, likes: 0, replies: [], replyCount: targetFloorCount(), poll,
        };
        setState(s => ({ posts: [post, ...s.posts] }));
        setCompose(null); setTab('home'); setOpenId(post.id);
        gainExp(5);
        addToast('发布成功 +5 经验', 'success');
    };

    const addUserReply = () => {
        if (!open || !reply.trim()) return;
        const isOp = open.authorName === userName;
        const r: ForumReply = {
            id: fid(), floor: open.replies.length + 2, authorType: 'user', authorName: userName,
            avatar: userProfile.avatar, body: reply.trim(), createdAt: Date.now(), likes: 0, isOp,
        };
        patchPost(open.id, p => ({ ...p, replies: [...p.replies, r], lastActiveAt: Date.now(), replyCount: Math.max(p.replyCount || 0, p.replies.length + 2) }));
        setReply(''); setKaoOpen(false);
        gainExp(2);
        if (order === 'asc') setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }), 50);
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
        setTab('home'); setBoard(decided.boardId);
        setCharBusy(false);
        addToast(`${c.name} 发了个帖子`, 'success');
        if (metaRef.current.followedBoards.includes(decided.boardId)) {
            pushNotif(makeNotif('newpost', post, { name: c.name, type: 'char', avatar: post.avatar }, decided.title));
        }
    };

    const likePost = (id: string) => patchPost(id, p => ({ ...p, likes: p.likes + 1 }));
    const dislikePost = (id: string) => patchPost(id, p => ({ ...p, dislikes: (p.dislikes || 0) + 1 }));
    const likeReply = (postId: string, rid: string) => patchPost(postId, p => ({ ...p, replies: p.replies.map(r => r.id === rid ? { ...r, likes: r.likes + 1 } : r) }));
    const dislikeReply = (postId: string, rid: string) => patchPost(postId, p => ({ ...p, replies: p.replies.map(r => r.id === rid ? { ...r, dislikes: (r.dislikes || 0) + 1 } : r) }));
    const onVote = (postId: string, idx: number) => patchPost(postId, p => p.poll ? { ...p, poll: votePoll(p.poll, idx) } : p);

    const doCheckIn = (boardId: string) => {
        const res = checkIn(metaRef.current, boardId);
        if (res.already) { addToast('今天已经签过到啦', 'info'); return; }
        setMeta(res.meta);
        setSignCard({ gained: res.gained, streak: res.streak, rank: res.rank });
        setTimeout(() => setSignCard(null), 2400);
    };
    const followBoard = (boardId: string) => setMeta(m => toggleFollowBoard(m, boardId));
    const collectPost = (postId: string) => { setMeta(m => toggleCollect(m, postId)); };
    const sharePost = (p: ForumPost) => addToast(`已复制帖子链接：「${p.title.slice(0, 12)}…」`, 'success');

    const openNotif = (n: ForumNotif) => {
        setNotifs(s => s.map(x => x.id === n.id ? { ...x, read: true } : x));
        if (n.postId && state.posts.some(p => p.id === n.postId)) setOpenId(n.postId);
    };
    const readAll = () => setNotifs(s => s.map(x => ({ ...x, read: true })));

    if (!loaded) return <div className="h-full w-full bg-[#f6f7f9]" />;

    const Avatar: React.FC<{ a?: string; name: string; type: string; size?: number }> = ({ a, name, type, size = 36 }) =>
        a ? <img src={a} className="rounded-full object-cover shrink-0" style={{ width: size, height: size }} />
            : <span className="rounded-full shrink-0 flex items-center justify-center bg-gradient-to-br from-sky-100 to-blue-100 text-[16px]" style={{ width: size, height: size }}>{type === 'npc' ? npcEmoji(name) : '🙂'}</span>;

    const LevelBadge: React.FC<{ lv: number; md?: boolean }> = ({ lv, md }) => {
        const tier = lv >= 16 ? 'bg-gradient-to-r from-amber-400 to-orange-400 text-white' : lv >= 11 ? 'bg-violet-100 text-violet-600' : lv >= 6 ? 'bg-sky-100 text-sky-600' : 'bg-slate-100 text-slate-500';
        return <span className={`rounded font-black leading-none inline-flex items-center ${tier} ${md ? 'text-[11px] px-1.5 py-0.5' : 'text-[9px] px-1 py-px'}`}>Lv.{lv}</span>;
    };
    const lvOf = (type: string, name: string) => type === 'user' ? myLevel.level : pseudoLevel(name);

    const RoleTag: React.FC<{ type: string; isOp?: boolean; owner?: string; name?: string }> = ({ type, isOp, owner, name }) => (
        <>
            {isOp && <span className="px-1 py-px rounded bg-amber-50 text-amber-500 text-[9px] font-bold flex items-center gap-0.5"><CrownSimple size={9} weight="fill" />楼主</span>}
            {owner && name === owner && <span className="px-1 py-px rounded bg-emerald-50 text-emerald-500 text-[9px] font-bold">吧主</span>}
            {type === 'char' && <span className="px-1 py-px rounded bg-rose-50 text-rose-400 text-[9px] font-bold">角色</span>}
            {type === 'user' && <span className="px-1 py-px rounded bg-sky-50 text-sky-500 text-[9px] font-bold">我</span>}
        </>
    );

    const PostTags: React.FC<{ p: ForumPost }> = ({ p }) => (
        <>
            {p.pinned && <span className="shrink-0 px-1 rounded bg-red-500 text-white text-[10px] font-black leading-tight">顶</span>}
            {p.essence && <span className="shrink-0 px-1 rounded bg-emerald-500 text-white text-[10px] font-black leading-tight">精</span>}
            {p.poll && <span className="shrink-0 px-1 rounded bg-indigo-500 text-white text-[10px] font-black leading-tight">投票</span>}
            {p.hot && <Fire size={14} weight="fill" className="text-orange-500 shrink-0" />}
        </>
    );

    // ── 帖子列表项（首页 / 我的 / 收藏 复用）──
    const PostRow: React.FC<{ p: ForumPost; showBoard?: boolean }> = ({ p, showBoard }) => {
        const b = boardOf(p.boardId);
        return (
            <button onClick={() => setOpenId(p.id)} className="w-full text-left bg-white px-4 py-3 border-b border-slate-100 active:bg-slate-50 transition-colors">
                <div className="flex items-center gap-2 mb-1">
                    <Avatar a={p.avatar} name={p.authorName} type={p.authorType} size={22} />
                    <span className="text-[11px] text-slate-500 truncate max-w-[80px]">{p.authorName}</span>
                    <LevelBadge lv={lvOf(p.authorType, p.authorName)} />
                    {p.authorType === 'char' && <span className="text-rose-400 text-[9px]">角色</span>}
                    <span className="text-[10px] text-slate-300">· {timeAgo(p.lastActiveAt)}</span>
                    {showBoard && <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-400 shrink-0">{b?.emoji}{b?.name}</span>}
                </div>
                <div className="text-[14px] font-bold text-slate-800 leading-snug flex items-center gap-1.5">
                    <PostTags p={p} />
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
    };

    // ═══════════════ 帖子详情 ═══════════════
    if (open) {
        const b = boardOf(open.boardId);
        const owner = boardStat(open.boardId).owner;
        const target = open.replyCount || 30;
        const loadedFloors = open.replies.length + 1; // 含 1 楼楼主
        const canLoadMore = loadedFloors < target;
        let shown = onlyOp ? open.replies.filter(r => r.isOp || r.authorName === open.authorName) : open.replies;
        if (order === 'desc') shown = [...shown].reverse();
        const collected = meta.collectedPostIds.includes(open.id);
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
                                <div className="text-[13px] font-bold text-slate-700 flex items-center gap-1.5 flex-wrap">
                                    {open.authorName}
                                    <LevelBadge lv={lvOf(open.authorType, open.authorName)} />
                                    <span className="px-1 py-px rounded bg-amber-50 text-amber-500 text-[9px] font-bold flex items-center gap-0.5"><CrownSimple size={9} weight="fill" />楼主</span>
                                    {open.authorType === 'char' && <span className="px-1 py-px rounded bg-rose-50 text-rose-400 text-[9px] font-bold">角色</span>}
                                    {open.authorType === 'user' && <span className="px-1 py-px rounded bg-sky-50 text-sky-500 text-[9px] font-bold">我</span>}
                                </div>
                                <div className="text-[10px] text-slate-400">{timeAgo(open.createdAt)} · 共 {kFmt(target)} 楼</div>
                            </div>
                        </div>
                        <h1 className="text-[16px] font-black text-slate-800 leading-snug mb-1.5 flex items-start gap-1.5 flex-wrap"><PostTags p={open} /><span>{open.title}</span></h1>
                        {open.body && <p className="text-[13px] text-slate-600 leading-relaxed whitespace-pre-wrap">{open.body}</p>}
                        {open.poll && <PollView poll={open.poll} onVote={i => onVote(open.id, i)} />}
                        <div className="flex items-center gap-3 mt-3">
                            <button onClick={() => likePost(open.id)} className="flex items-center gap-1 text-[11px] text-slate-400 active:scale-90 transition-transform"><ArrowFatUp size={15} weight="bold" />{kFmt(open.likes)}</button>
                            <button onClick={() => dislikePost(open.id)} className="flex items-center gap-1 text-[11px] text-slate-400 active:scale-90 transition-transform"><ArrowFatDown size={15} weight="bold" />{open.dislikes || ''}</button>
                            <span className="flex items-center gap-1 text-[11px] text-slate-400"><ChatCircleText size={15} weight="bold" />{kFmt(target)}</span>
                            <span className="ml-auto text-[10px] text-slate-300">1 楼 · 楼主</span>
                        </div>
                    </div>
                    {/* 楼层区：标题 + 倒序 */}
                    <div className="flex items-center justify-between px-4 pt-3 pb-1">
                        <span className="text-[12px] font-bold text-slate-500">全部回复 <span className="text-[#2b6fe0]">{kFmt(Math.max(0, loadedFloors - 1))}</span></span>
                        <button onClick={() => setOrder(o => o === 'asc' ? 'desc' : 'asc')} className="flex items-center gap-1 text-[11px] font-bold text-slate-400 active:scale-95 transition-transform">
                            <ArrowsDownUp size={13} weight="bold" />{order === 'asc' ? '正序' : '倒序'}
                        </button>
                    </div>
                    {/* 楼层 */}
                    <div className="px-4 pt-1 pb-4 space-y-3.5">
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
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                        <span className="text-[12px] font-bold text-slate-600">{r.authorName}</span>
                                        <LevelBadge lv={lvOf(r.authorType, r.authorName)} />
                                        <RoleTag type={r.authorType} isOp={r.isOp} owner={owner} name={r.authorName} />
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
                                    <div className="flex items-center gap-4 mt-1">
                                        <button onClick={() => likeReply(open.id, r.id)} className="flex items-center gap-1 text-[10px] text-slate-400 active:scale-90 transition-transform"><ArrowFatUp size={12} weight="bold" />{r.likes || ''}</button>
                                        <button onClick={() => dislikeReply(open.id, r.id)} className="flex items-center gap-1 text-[10px] text-slate-400 active:scale-90 transition-transform"><ArrowFatDown size={12} weight="bold" />{r.dislikes || ''}</button>
                                        <button onClick={() => { setReply(`回复 ${r.authorName}：`); }} className="flex items-center gap-1 text-[10px] text-slate-400 active:scale-90 transition-transform"><ChatCircleDots size={12} weight="bold" />回复</button>
                                    </div>
                                </div>
                            </div>
                        ))}
                        {/* 加载更多楼层（倒序时不显示在底部） */}
                        {!onlyOp && order === 'asc' && (canLoadMore ? (
                            <button onClick={() => loadFloors(open)} disabled={floorBusy}
                                className="w-full py-2.5 rounded-xl bg-white border border-slate-200 text-[12px] font-bold text-[#2b6fe0] flex items-center justify-center gap-1.5 active:scale-[0.98] transition-transform disabled:opacity-60">
                                {floorBusy ? <><Spinner size={14} className="animate-spin" />盖楼中…</> : <><Sparkle size={14} weight="fill" className="text-amber-400" />加载更多楼层（还有约 {kFmt(Math.max(0, target - loadedFloors))} 楼）</>}
                            </button>
                        ) : open.replies.length > 0 && (
                            <div className="text-center text-slate-300 text-[11px] py-3">—— 已经到底了，共 {kFmt(loadedFloors)} 楼 ——</div>
                        ))}
                    </div>
                </div>
                {/* 颜文字面板 */}
                {kaoOpen && (
                    <div className="shrink-0 bg-white border-t border-slate-100 px-3 py-2 grid grid-cols-4 gap-1.5">
                        {KAOMOJI.map(k => (
                            <button key={k} onClick={() => setReply(r => r + k)} className="py-1.5 rounded-lg bg-slate-50 text-[12px] text-slate-600 active:bg-slate-100 truncate">{k}</button>
                        ))}
                    </div>
                )}
                {/* 回帖框 + 收藏/分享 */}
                <div className="shrink-0 border-t border-slate-100 bg-white p-2.5 pb-safe flex items-center gap-2">
                    <button onClick={() => setKaoOpen(v => !v)} className={`p-2 rounded-full active:scale-90 transition-transform ${kaoOpen ? 'text-[#2b6fe0]' : 'text-slate-400'}`}><Smiley size={22} weight={kaoOpen ? 'fill' : 'regular'} /></button>
                    <input value={reply} onChange={e => setReply(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addUserReply(); }} onFocus={() => setKaoOpen(false)}
                        placeholder="回复楼主，写下你的盖楼…" className="flex-1 px-3.5 py-2.5 bg-slate-100 rounded-full text-[13px] outline-none focus:bg-slate-50" />
                    {reply.trim()
                        ? <button onClick={addUserReply} className="px-4 py-2.5 rounded-full bg-[#2b6fe0] text-white text-[13px] font-bold active:scale-95 transition-transform">回帖</button>
                        : <>
                            <button onClick={() => collectPost(open.id)} className={`p-2 rounded-full active:scale-90 transition-transform ${collected ? 'text-amber-500' : 'text-slate-400'}`} title="收藏"><BookmarkSimple size={22} weight={collected ? 'fill' : 'regular'} /></button>
                            <button onClick={() => sharePost(open)} className="p-2 rounded-full active:scale-90 transition-transform text-slate-400" title="分享"><ShareNetwork size={22} weight="regular" /></button>
                        </>}
                </div>
            </div>
        );
    }

    // ═══════════════ 首页 ═══════════════
    const genning = genBoard !== null;
    const renderHome = () => (
        <>
            <Header title="茶话亭" onBack={closeApp}
                icon={<ChatsCircle size={20} weight="fill" className="text-[#2b6fe0]" />}
                right={
                    <button onClick={charPost} disabled={charBusy} className="p-2 rounded-full active:scale-90 transition-transform text-slate-500 disabled:opacity-50" title="让角色发帖">
                        <ArrowsClockwise size={18} weight="bold" className={charBusy ? 'animate-spin' : ''} />
                    </button>
                } />
            {/* 搜索栏 */}
            <div className="shrink-0 px-3 py-2 bg-white">
                <div className="flex items-center gap-2 bg-slate-100 rounded-full px-3 py-1.5">
                    <MagnifyingGlass size={15} weight="bold" className="text-slate-400" />
                    <input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜帖子 / 网友" className="flex-1 bg-transparent text-[13px] outline-none" />
                    {query && <button onClick={() => setQuery('')}><X size={14} weight="bold" className="text-slate-400" /></button>}
                </div>
            </div>
            {/* 板块吧 */}
            <div className="shrink-0 flex gap-2 overflow-x-auto px-4 py-2 bg-white border-b border-slate-100" style={{ scrollbarWidth: 'none' }}>
                {[{ id: 'all', name: '全部', emoji: '🏷️' }, ...FORUM_BOARDS].map(bd => {
                    const followed = bd.id !== 'all' && meta.followedBoards.includes(bd.id);
                    return (
                        <button key={bd.id} onClick={() => setBoard(bd.id)}
                            className={`shrink-0 px-3 py-1.5 rounded-full text-[12px] font-bold transition-all active:scale-95 flex items-center gap-1 ${board === bd.id ? 'bg-[#2b6fe0] text-white shadow shadow-blue-200' : 'bg-slate-100 text-slate-500'}`}>
                            {followed && <Star size={10} weight="fill" className={board === bd.id ? 'text-amber-200' : 'text-amber-400'} />}
                            {bd.emoji} {bd.name}{bd.id !== 'all' && bd.id === board ? '吧' : ''}
                        </button>
                    );
                })}
            </div>
            {/* 吧头 banner */}
            {board !== 'all' && (() => {
                const bd = boardOf(board)!; const st = boardStat(board);
                const followed = meta.followedBoards.includes(board);
                const signed = isCheckedIn(meta, board);
                return (
                    <div className="shrink-0 px-4 pt-3 pb-2.5 text-white" style={{ background: 'linear-gradient(135deg,#2b6fe0,#5b8def)' }}>
                        <div className="flex items-center gap-3">
                            <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center text-[26px] shrink-0">{bd.emoji}</div>
                            <div className="flex-1 min-w-0">
                                <div className="text-[16px] font-black flex items-center gap-1.5">{bd.name}吧</div>
                                <div className="text-[10px] text-white/80 truncate">{bd.desc} · 吧主 {st.owner}</div>
                                <div className="text-[10px] text-white/80 mt-0.5">{kFmt(st.members)} 关注 · {kFmt(st.posts)} 帖</div>
                            </div>
                            <div className="flex flex-col gap-1.5 shrink-0">
                                <button onClick={() => followBoard(board)} className={`px-3 py-1 rounded-full text-[11px] font-black active:scale-95 transition-transform flex items-center gap-1 ${followed ? 'bg-white/25 text-white' : 'bg-white text-[#2b6fe0]'}`}>
                                    {followed ? <><Check size={12} weight="bold" />已关注</> : <><Plus size={12} weight="bold" />关注</>}
                                </button>
                                <button onClick={() => doCheckIn(board)} className={`px-3 py-1 rounded-full text-[11px] font-black active:scale-95 transition-transform flex items-center gap-1 ${signed ? 'bg-white/25 text-white' : 'bg-amber-400 text-white'}`}>
                                    <CalendarCheck size={12} weight="bold" />{signed ? '已签' : '签到'}
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })()}
            {/* 换一批条 */}
            {board !== 'all' && (
                <div className="shrink-0 flex items-center justify-between px-4 py-2 bg-white border-b border-slate-100">
                    <span className="text-[11px] text-slate-400 flex items-center gap-1"><Fire size={12} weight="fill" className="text-orange-400" />热门 · 最新</span>
                    <button onClick={() => generateThreads(board, true)} disabled={genning}
                        className="flex items-center gap-1 text-[11px] font-bold text-[#2b6fe0] active:scale-95 transition-transform disabled:opacity-50">
                        <ArrowsClockwise size={13} weight="bold" className={genBoard === board ? 'animate-spin' : ''} />换一批
                    </button>
                </div>
            )}
            <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
                {/* 热议榜（全部视图） */}
                {board === 'all' && !query && hotList.length > 0 && (
                    <div className="bg-white border-b-4 border-slate-100 px-4 py-3">
                        <div className="flex items-center gap-1.5 mb-2">
                            <Trophy size={16} weight="fill" className="text-amber-500" />
                            <span className="text-[14px] font-black text-slate-800">热议榜</span>
                            <span className="text-[10px] text-slate-400">茶话亭今日最热</span>
                        </div>
                        <div className="space-y-2">
                            {hotList.map((p, i) => (
                                <button key={p.id} onClick={() => setOpenId(p.id)} className="w-full flex items-center gap-2.5 text-left active:opacity-70">
                                    <span className={`w-5 text-center text-[14px] font-black shrink-0 ${i === 0 ? 'text-red-500' : i === 1 ? 'text-orange-500' : i === 2 ? 'text-amber-500' : 'text-slate-300'}`}>{i + 1}</span>
                                    <span className="flex-1 text-[13px] text-slate-700 line-clamp-1">{p.title}</span>
                                    {p.hot && <Fire size={12} weight="fill" className="text-orange-500 shrink-0" />}
                                    <span className="text-[10px] text-slate-400 shrink-0 tabular-nums">{kFmt(p.replyCount || p.replies.length)}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}
                {genning && list.length === 0 ? (
                    <div className="pt-20 flex flex-col items-center gap-2 text-slate-400">
                        <Spinner size={26} className="animate-spin text-[#2b6fe0]" />
                        <span className="text-[13px] font-bold">正在生成一吧的帖子…</span>
                    </div>
                ) : list.length === 0 ? (
                    <div className="text-center text-slate-300 text-sm pt-20">{query ? '没搜到相关帖子' : '这个吧还没人发帖，来抢沙发～'}</div>
                ) : list.map(p => <PostRow key={p.id} p={p} showBoard={board === 'all'} />)}
                <div className="h-4" />
            </div>
        </>
    );

    // ═══════════════ 消息 ═══════════════
    const notifText = (n: ForumNotif): string => n.kind === 'reply' ? '回复了你的帖子' : n.kind === 'like' ? '赞了你的帖子' : n.kind === 'newpost' ? '发布了新帖' : '';
    const shownNotifs = msgFilter === 'all' ? notifs : notifs.filter(n => n.kind === msgFilter);
    const renderMsg = () => (
        <>
            <Header title="消息" onBack={closeApp} icon={<BellSimple size={20} weight="fill" className="text-[#2b6fe0]" />}
                right={unread > 0 ? <button onClick={readAll} className="text-[12px] font-bold text-[#2b6fe0] active:scale-95 transition-transform px-2">全部已读</button> : undefined} />
            <div className="shrink-0 flex gap-2 px-4 py-2 bg-white border-b border-slate-100">
                {([['all', '全部'], ['reply', '回复我的'], ['like', '赞我的'], ['newpost', '关注更新']] as const).map(([k, label]) => (
                    <button key={k} onClick={() => setMsgFilter(k)} className={`px-3 py-1 rounded-full text-[12px] font-bold transition-all active:scale-95 ${msgFilter === k ? 'bg-[#2b6fe0] text-white' : 'bg-slate-100 text-slate-500'}`}>{label}</button>
                ))}
            </div>
            <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
                {shownNotifs.length === 0 ? (
                    <div className="text-center text-slate-300 text-sm pt-24 flex flex-col items-center gap-2"><BellSimple size={32} className="text-slate-200" />还没有新消息</div>
                ) : shownNotifs.map(n => (
                    <button key={n.id} onClick={() => openNotif(n)} className="w-full text-left bg-white px-4 py-3 border-b border-slate-100 active:bg-slate-50 flex gap-3">
                        <div className="relative shrink-0">
                            <Avatar a={n.avatar} name={n.actorName} type={n.actorType} size={38} />
                            {!n.read && <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-red-500 border-2 border-white" />}
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                                <span className="text-[13px] font-bold text-slate-700 truncate">{n.actorName}</span>
                                {n.kind === 'like' && <Heart size={12} weight="fill" className="text-rose-400" />}
                                {n.kind === 'system' && <span className="px-1 rounded bg-sky-50 text-sky-500 text-[9px] font-bold">系统</span>}
                                <span className="text-[10px] text-slate-300 ml-auto shrink-0">{timeAgo(n.createdAt)}</span>
                            </div>
                            <div className="text-[12px] text-slate-500 mt-0.5">{notifText(n)}{n.kind !== 'system' && n.postTitle && <span className="text-slate-400"> · {n.postTitle}</span>}</div>
                            {n.snippet && <div className="text-[12px] text-slate-600 mt-1 bg-slate-50 rounded-lg px-2.5 py-1.5 line-clamp-2">{n.snippet}</div>}
                        </div>
                    </button>
                ))}
                <div className="h-4" />
            </div>
        </>
    );

    // ═══════════════ 我的 ═══════════════
    const followedBoards = meta.followedBoards.map(boardOf).filter(Boolean) as typeof FORUM_BOARDS;
    const renderMe = () => (
        <>
            <Header title="我的" onBack={closeApp} icon={<User size={20} weight="fill" className="text-[#2b6fe0]" />} />
            <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
                {/* 个人资料卡 */}
                <div className="px-5 pt-4 pb-4 text-white" style={{ background: 'linear-gradient(135deg,#2b6fe0,#5b8def)' }}>
                    <div className="flex items-center gap-3.5">
                        {userProfile.avatar ? <img src={userProfile.avatar} className="w-16 h-16 rounded-full object-cover border-2 border-white/40" /> : <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center text-[30px]">🙂</div>}
                        <div className="flex-1 min-w-0">
                            <div className="text-[18px] font-black flex items-center gap-2">{userName}<LevelBadge lv={myLevel.level} md /></div>
                            <div className="text-[11px] text-white/85 flex items-center gap-1 mt-0.5"><Medal size={12} weight="fill" />{myLevel.title}</div>
                        </div>
                    </div>
                    {/* 经验进度条 */}
                    <div className="mt-3">
                        <div className="flex items-center justify-between text-[10px] text-white/85 mb-1">
                            <span>Lv.{myLevel.level}</span>
                            <span>{myLevel.max ? '已满级' : `${myLevel.cur} / ${myLevel.need} 经验升级`}</span>
                            <span>Lv.{Math.min(18, myLevel.level + 1)}</span>
                        </div>
                        <div className="h-2 rounded-full bg-white/25 overflow-hidden">
                            <div className="h-full rounded-full bg-gradient-to-r from-amber-300 to-amber-400" style={{ width: `${myLevel.pct}%` }} />
                        </div>
                    </div>
                </div>
                {/* 数据条 */}
                <div className="grid grid-cols-4 bg-white border-b-4 border-slate-100 py-3">
                    {[['发帖', myPosts.length], ['获赞', likesGot], ['关注吧', meta.followedBoards.length], ['连续签到', maxStreak(meta)]].map(([label, val]) => (
                        <div key={label} className="flex flex-col items-center">
                            <span className="text-[17px] font-black text-slate-800 tabular-nums">{kFmt(Number(val))}</span>
                            <span className="text-[10px] text-slate-400 mt-0.5">{label}</span>
                        </div>
                    ))}
                </div>
                {/* 子页切换 */}
                <div className="flex bg-white border-b border-slate-100 sticky top-0 z-10">
                    {([['posts', '我的帖子'], ['collect', '我的收藏'], ['follow', '关注的吧']] as const).map(([k, label]) => (
                        <button key={k} onClick={() => setMeSub(k)} className={`flex-1 py-2.5 text-[13px] font-bold relative ${meSub === k ? 'text-[#2b6fe0]' : 'text-slate-400'}`}>
                            {label}
                            {meSub === k && <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-7 h-0.5 rounded-full bg-[#2b6fe0]" />}
                        </button>
                    ))}
                </div>
                {meSub === 'posts' && (myPosts.length ? myPosts.map(p => <PostRow key={p.id} p={p} showBoard />) : <Empty text="还没发过帖子，去首页发一个吧～" />)}
                {meSub === 'collect' && (myCollected.length ? myCollected.map(p => <PostRow key={p.id} p={p} showBoard />) : <Empty text="还没有收藏的帖子" />)}
                {meSub === 'follow' && (followedBoards.length ? (
                    <div className="p-3 grid grid-cols-2 gap-2.5">
                        {followedBoards.map(bd => {
                            const st = boardStat(bd.id);
                            return (
                                <button key={bd.id} onClick={() => { setTab('home'); setBoard(bd.id); }} className="bg-white rounded-2xl border border-slate-100 p-3 text-left active:scale-95 transition-transform">
                                    <div className="flex items-center gap-2">
                                        <span className="text-[22px]">{bd.emoji}</span>
                                        <div className="min-w-0">
                                            <div className="text-[13px] font-black text-slate-800 truncate">{bd.name}吧</div>
                                            <div className="text-[10px] text-slate-400">{kFmt(st.members)} 关注</div>
                                        </div>
                                    </div>
                                    <div className="text-[11px] text-slate-400 mt-1.5 line-clamp-1">{bd.desc}</div>
                                    <div className="mt-2 flex items-center justify-between">
                                        <span className={`text-[10px] font-bold flex items-center gap-0.5 ${isCheckedIn(meta, bd.id) ? 'text-slate-300' : 'text-amber-500'}`}><CalendarCheck size={11} weight="bold" />{isCheckedIn(meta, bd.id) ? '今日已签' : '待签到'}</span>
                                        <CaretRight size={13} weight="bold" className="text-slate-300" />
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                ) : <Empty text="还没有关注的吧，去首页点「关注」吧～" />)}
                <div className="h-4" />
            </div>
        </>
    );

    return (
        <div className="h-full w-full flex flex-col bg-[#f6f7f9] relative overflow-hidden">
            <div className="flex-1 min-h-0 flex flex-col">
                {tab === 'home' ? renderHome() : tab === 'msg' ? renderMsg() : renderMe()}
            </div>
            {/* 底部导航 */}
            <div className="shrink-0 flex items-stretch border-t border-slate-100 bg-white/95 backdrop-blur" style={{ paddingBottom: 'env(safe-area-inset-bottom,0px)' }}>
                {([['home', '首页', House], ['msg', '消息', BellSimple], ['me', '我的', User]] as const).map(([id, label, Icon]) => {
                    const active = tab === id;
                    return (
                        <button key={id} onClick={() => setTab(id)} className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-1.5 active:scale-95 transition-transform relative ${active ? 'text-[#2b6fe0]' : 'text-slate-400'}`}>
                            <Icon size={23} weight={active ? 'fill' : 'regular'} />
                            <span className={`text-[10px] ${active ? 'font-black' : 'font-medium'}`}>{label}</span>
                            {id === 'msg' && unread > 0 && <span className="absolute top-0.5 right-1/2 -mr-3.5 min-w-[15px] h-[15px] px-1 rounded-full bg-red-500 text-white text-[9px] font-black flex items-center justify-center">{unread > 99 ? '99+' : unread}</span>}
                        </button>
                    );
                })}
            </div>

            {/* 发帖 FAB（仅首页） */}
            {tab === 'home' && (
                <button onClick={() => setCompose({ board: board === 'all' ? 'chat' : board, title: '', body: '', pollOn: false, pollQ: '', pollOpts: ['', ''] })}
                    className="absolute right-5 bottom-20 w-14 h-14 rounded-full bg-[#2b6fe0] text-white flex items-center justify-center shadow-xl shadow-blue-300/50 active:scale-90 transition-transform z-20">
                    <PencilSimple size={24} weight="bold" />
                </button>
            )}

            {/* 签到成功卡 */}
            {signCard && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/30 animate-fade-in" onClick={() => setSignCard(null)}>
                    <div className="bg-white rounded-3xl px-8 py-7 flex flex-col items-center gap-1.5 shadow-2xl animate-pop-in">
                        <Confetti size={44} weight="fill" className="text-amber-400" />
                        <div className="text-[18px] font-black text-slate-800 mt-1">签到成功！</div>
                        <div className="text-[13px] text-[#2b6fe0] font-bold">经验 +{signCard.gained}</div>
                        <div className="text-[12px] text-slate-500">已连续签到 <span className="font-black text-amber-500">{signCard.streak}</span> 天</div>
                        <div className="text-[11px] text-slate-400 mt-1">你是本吧今天第 {signCard.rank} 位签到的茶客</div>
                    </div>
                </div>
            )}

            {/* 发帖弹窗 */}
            {compose && (
                <div className="absolute inset-0 z-40 flex flex-col bg-white animate-slide-up">
                    <Header title="发帖" onBack={() => setCompose(null)} backIcon={<X size={22} weight="bold" />} right={
                        <button onClick={submitPost} className="px-4 py-1.5 rounded-full bg-[#2b6fe0] text-white text-[13px] font-bold active:scale-95 transition-transform">发布</button>
                    } />
                    <div className="flex-1 overflow-y-auto p-4 space-y-3" style={{ scrollbarWidth: 'none' }}>
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
                        {/* 投票 */}
                        <button onClick={() => setCompose(c => c && { ...c, pollOn: !c.pollOn })} className={`flex items-center gap-1.5 text-[12px] font-bold ${compose.pollOn ? 'text-[#2b6fe0]' : 'text-slate-400'}`}>
                            <ChartBar size={15} weight="bold" />{compose.pollOn ? '取消投票' : '＋ 发起投票'}
                        </button>
                        {compose.pollOn && (
                            <div className="space-y-2 bg-slate-50 rounded-xl p-3 border border-slate-100">
                                <input value={compose.pollQ} onChange={e => setCompose(c => c && { ...c, pollQ: e.target.value })} placeholder="投票问题，如「你站哪边？」"
                                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-[13px] font-bold outline-none focus:border-[#2b6fe0]" />
                                {compose.pollOpts.map((o, i) => (
                                    <div key={i} className="flex items-center gap-2">
                                        <input value={o} onChange={e => setCompose(c => { if (!c) return c; const opts = [...c.pollOpts]; opts[i] = e.target.value; return { ...c, pollOpts: opts }; })} placeholder={`选项 ${i + 1}`}
                                            className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded-lg text-[13px] outline-none focus:border-[#2b6fe0]" />
                                        {compose.pollOpts.length > 2 && <button onClick={() => setCompose(c => c && { ...c, pollOpts: c.pollOpts.filter((_, j) => j !== i) })}><X size={16} weight="bold" className="text-slate-300" /></button>}
                                    </div>
                                ))}
                                {compose.pollOpts.length < 5 && <button onClick={() => setCompose(c => c && { ...c, pollOpts: [...c.pollOpts, ''] })} className="text-[12px] font-bold text-[#2b6fe0] flex items-center gap-1"><Plus size={13} weight="bold" />加一个选项</button>}
                            </div>
                        )}
                        <p className="text-[11px] text-slate-400">发完进帖会自动「召唤网友盖楼」，角色和网友会按人设来回复。</p>
                    </div>
                </div>
            )}
        </div>
    );
};

// 投票帖渲染（OP 卡内）
const PollView: React.FC<{ poll: ForumPoll; onVote: (i: number) => void }> = ({ poll, onVote }) => {
    const total = pollTotal(poll);
    const voted = poll.voted !== undefined;
    return (
        <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50/60 p-3">
            <div className="text-[13px] font-black text-slate-700 mb-2 flex items-center gap-1.5"><ChartBar size={15} weight="fill" className="text-indigo-500" />{poll.question}</div>
            <div className="space-y-2">
                {poll.options.map((o, i) => {
                    const pct = total ? Math.round((o.votes / total) * 100) : 0;
                    const mine = poll.voted === i;
                    return (
                        <button key={i} onClick={() => onVote(i)} className="w-full relative overflow-hidden rounded-lg border border-slate-200 bg-white active:scale-[0.99] transition-transform">
                            {voted && <div className={`absolute inset-y-0 left-0 ${mine ? 'bg-indigo-100' : 'bg-slate-100'}`} style={{ width: `${pct}%` }} />}
                            <div className="relative flex items-center justify-between px-3 py-2">
                                <span className={`text-[13px] ${mine ? 'font-black text-indigo-600' : 'text-slate-700'} flex items-center gap-1`}>{mine && <Check size={13} weight="bold" />}{o.text}</span>
                                {voted && <span className={`text-[11px] tabular-nums ${mine ? 'text-indigo-500 font-bold' : 'text-slate-400'}`}>{pct}% · {o.votes}</span>}
                            </div>
                        </button>
                    );
                })}
            </div>
            <div className="text-[10px] text-slate-400 mt-2">{total} 人参与 · {voted ? '可改投' : '点选项投票'}</div>
        </div>
    );
};

const Empty: React.FC<{ text: string }> = ({ text }) => <div className="text-center text-slate-300 text-[13px] py-16">{text}</div>;

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
