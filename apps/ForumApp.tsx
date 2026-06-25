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
    PaperBackdrop, ScrapButton, WashiTape, Stamp, StickyNote, SectionTag, DashedRule,
    PaperDialog, PaperSheet,
    INK, INK_SOFT, PAPER, PAGE_BG, HALFTONE, TAPE_STRIPES, WASHI,
} from './theater/scrapbook';
import {
    CaretLeft, PencilSimple, ArrowFatUp, ArrowFatDown, ChatCircleText, X, Sparkle,
    ArrowsClockwise, MagnifyingGlass, Fire, CrownSimple, Spinner, House, BellSimple, User,
    Star, BookmarkSimple, ShareNetwork, ArrowsDownUp, Coffee,
    Plus, Check, CaretRight, Confetti, ChatCircleDots, Smiley, ChartBar, Heart, Medal,
} from '@phosphor-icons/react';

const KEY = 'moro_forum_v1';
const META_KEY = 'moro_forum_meta_v1';
const NOTIF_KEY = 'moro_forum_notif_v1';
const FLOOR_BATCH = 12;   // 每次盖楼条数
const THREAD_BATCH = 12;  // 每个板块一次生成帖子数（≥10）

// 茶客们随手插的颜文字（回帖快捷插入）
const KAOMOJI = ['[doge]', '(｡･ω･｡)', '( ´_ゝ`)', '(¦3[▓▓]', '(*•̀ᴗ•́*)', 'σ`∀´)σ', '(╯‵□′)╯', '꒰๑˃̶᷄ ⌑ ˂̶᷅๑꒱', '( ˘•ω•˘ )', '╮(╯▽╰)╭', '(๑•̀ㅂ•́)و✧', '哈哈哈哈哈'];

// ── 黑白拼贴手账·通用样式片（呼应折子戏 / 心意铺）──────────────────────────
/** 米白纸卡（缝线描边 + 纸面渐变） */
const PANEL: React.CSSProperties = {
    background: 'linear-gradient(180deg,#fbf9f2,#f1eee4)',
    border: '1px solid rgba(176,170,158,0.7)',
    outline: '1px dashed rgba(150,144,132,0.5)',
    outlineOffset: '-5px',
    borderRadius: 16,
    boxShadow: '0 12px 24px -16px rgba(31,29,26,0.5)',
};
const paperInput: React.CSSProperties = { background: 'rgba(255,253,247,0.92)', color: INK, border: '1px solid rgba(176,170,158,0.7)' };
/** 胶囊小标签 / 分段开关（选中＝墨块，未选＝纸面虚线） */
const chip = (active: boolean): React.CSSProperties =>
    active
        ? { background: INK, color: PAPER, boxShadow: '0 6px 14px -8px rgba(31,29,26,0.6)' }
        : { background: 'rgba(255,253,247,0.72)', color: '#6b655a', border: '1px dashed rgba(150,144,132,0.6)' };

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

// ── 头像（彩色保留）/ 等级章 / 身份小旗 / 帖子标签 ──────────────────────────
const Avatar: React.FC<{ a?: string; name: string; type: string; size?: number }> = ({ a, name, type, size = 36 }) =>
    a ? <img src={a} className="rounded-full object-cover shrink-0" style={{ width: size, height: size, border: '1px solid rgba(176,170,158,0.7)' }} />
        : <span className="rounded-full shrink-0 flex items-center justify-center text-[16px]" style={{ width: size, height: size, background: 'linear-gradient(180deg,#fffdf8,#ece8dd)', border: '1px solid rgba(176,170,158,0.7)' }}>{type === 'npc' ? npcEmoji(name) : '🙂'}</span>;

/** 等级章：高阶＝墨块，往下灰阶递减（黑白拼贴，纯灰阶） */
const LevelBadge: React.FC<{ lv: number; md?: boolean }> = ({ lv, md }) => {
    const tier: React.CSSProperties =
        lv >= 16 ? { background: INK, color: PAPER }
            : lv >= 11 ? { background: 'rgba(46,44,40,0.82)', color: PAPER }
                : lv >= 6 ? { background: 'rgba(120,116,108,0.5)', color: '#2a2824' }
                    : { background: 'rgba(176,170,158,0.42)', color: '#5b554b' };
    return <span className={`rounded font-black leading-none inline-flex items-center ${md ? 'text-[11px] px-1.5 py-0.5' : 'text-[9px] px-1 py-px'}`} style={tier}>Lv.{lv}</span>;
};

/** 身份小旗（楼主 / 吧主 / 角色 / 我）——灰阶纸片，靠填充区分 */
const RoleTag: React.FC<{ type: string; isOp?: boolean; owner?: string; name?: string }> = ({ type, isOp, owner, name }) => (
    <>
        {isOp && <span className="px-1 py-px rounded text-[9px] font-bold flex items-center gap-0.5" style={{ background: 'rgba(255,253,247,0.9)', color: INK, border: '1px solid rgba(120,116,108,0.55)' }}><CrownSimple size={9} weight="fill" />楼主</span>}
        {owner && name === owner && <span className="px-1 py-px rounded text-[9px] font-bold" style={{ background: INK, color: PAPER }}>亭主</span>}
        {type === 'char' && <span className="px-1 py-px rounded text-[9px] font-bold" style={{ background: 'rgba(120,116,108,0.5)', color: '#2a2824' }}>角色</span>}
        {type === 'user' && <span className="px-1 py-px rounded text-[9px] font-bold" style={{ background: 'rgba(255,253,247,0.9)', color: INK, border: '1px dashed rgba(150,144,132,0.7)' }}>我</span>}
    </>
);

const PostTags: React.FC<{ p: ForumPost }> = ({ p }) => (
    <>
        {p.pinned && <span className="shrink-0 px-1 rounded text-[10px] font-black leading-tight" style={{ background: INK, color: PAPER }}>顶</span>}
        {p.essence && <span className="shrink-0 px-1 rounded text-[10px] font-black leading-tight" style={{ background: 'rgba(255,253,247,0.9)', color: INK, border: '1px solid rgba(120,116,108,0.6)' }}>精</span>}
        {p.poll && <span className="shrink-0 px-1 rounded text-[10px] font-black leading-tight" style={{ background: 'rgba(120,116,108,0.5)', color: '#2a2824' }}>投票</span>}
        {p.hot && <Fire size={14} weight="fill" className="shrink-0" style={{ color: INK }} />}
    </>
);

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
            else setNotifs([{ id: fid(), kind: 'system', postId: '', postTitle: '欢迎来茶话亭歇脚', actorName: '看亭的猫', actorType: 'npc', snippet: '围炉夜话，茶水管够。常去的吧点个「常来」、每天来添柴攒火候，支个话头总有茶客循声来接——慢慢坐。', createdAt: Date.now(), read: false }]);
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
            addToast(`新沏了一壶帖子`, 'success');
            if (metaRef.current.followedBoards.includes(boardId)) {
                pushNotif(makeNotif('newpost', { id: '', title: `${bd.name}吧 新添 ${fresh.length} 张话桌` }, { name: `${bd.emoji}${bd.name}吧`, type: 'npc' }, '你常去的吧又热闹起来了，去坐坐～'));
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
                notifList.push(makeNotif('reply', post, { name: first.authorName, type: first.authorType, avatar: first.avatar }, added.length > 1 ? `等 ${added.length} 位茶客来接话：${first.body}` : first.body));
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
        if (!compose || !compose.title.trim()) { addToast('先起个话头吧', 'error'); return; }
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
        addToast('话头已贴出 · 火候 +5', 'success');
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
        if (characters.length === 0) { addToast('亭子里还没请来熟客', 'error'); return; }
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
        addToast(`${c.name} 在亭子里支了个话头`, 'success');
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
        if (res.already) { addToast('今天的茶已经续过啦', 'info'); return; }
        setMeta(res.meta);
        setSignCard({ gained: res.gained, streak: res.streak, rank: res.rank });
        setTimeout(() => setSignCard(null), 2400);
    };
    const followBoard = (boardId: string) => setMeta(m => toggleFollowBoard(m, boardId));
    const collectPost = (postId: string) => { setMeta(m => toggleCollect(m, postId)); };
    const sharePost = (p: ForumPost) => addToast(`已抄下帖子门牌：「${p.title.slice(0, 12)}…」`, 'success');

    const openNotif = (n: ForumNotif) => {
        setNotifs(s => s.map(x => x.id === n.id ? { ...x, read: true } : x));
        if (n.postId && state.posts.some(p => p.id === n.postId)) setOpenId(n.postId);
    };
    const readAll = () => setNotifs(s => s.map(x => ({ ...x, read: true })));

    if (!loaded) return <div className="h-full w-full" style={{ background: PAGE_BG }} />;

    const lvOf = (type: string, name: string) => type === 'user' ? myLevel.level : pseudoLevel(name);

    // ── 帖子列表项（首页 / 我的 / 收藏 复用，纸卡）──
    const PostRow: React.FC<{ p: ForumPost; showBoard?: boolean }> = ({ p, showBoard }) => {
        const b = boardOf(p.boardId);
        return (
            <button onClick={() => setOpenId(p.id)} className="w-full text-left px-4 py-3 active:scale-[0.995] transition-transform"
                style={{ borderBottom: '1px dashed rgba(150,144,132,0.45)' }}>
                <div className="flex items-center gap-2 mb-1">
                    <Avatar a={p.avatar} name={p.authorName} type={p.authorType} size={22} />
                    <span className="text-[11px] truncate max-w-[80px]" style={{ color: INK_SOFT }}>{p.authorName}</span>
                    <LevelBadge lv={lvOf(p.authorType, p.authorName)} />
                    {p.authorType === 'char' && <span className="text-[9px]" style={{ color: INK_SOFT }}>角色</span>}
                    <span className="text-[10px]" style={{ color: 'rgba(150,144,132,0.85)' }}>· {timeAgo(p.lastActiveAt)}</span>
                    {showBoard && <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded shrink-0" style={{ background: 'rgba(255,253,247,0.8)', color: INK_SOFT, border: '1px dashed rgba(150,144,132,0.6)' }}>{b?.emoji}{b?.name}</span>}
                </div>
                <div className="text-[14px] font-bold leading-snug flex items-center gap-1.5" style={{ color: INK }}>
                    <PostTags p={p} />
                    <span className="line-clamp-1">{p.title}</span>
                </div>
                {p.body && <div className="text-[12px] leading-snug line-clamp-2 mt-0.5" style={{ color: INK_SOFT }}>{p.body}</div>}
                <div className="flex items-center gap-3 mt-1.5 text-[10px]" style={{ color: INK_SOFT }}>
                    <span className="flex items-center gap-1"><ArrowFatUp size={12} weight="bold" />{kFmt(p.likes)}</span>
                    <span className="flex items-center gap-1"><ChatCircleText size={12} weight="bold" />{kFmt(p.replyCount || p.replies.length)}</span>
                    {(p.replyCount || 0) >= 200 && <span className="font-bold" style={{ color: INK }}>爆楼</span>}
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
            <div className="relative h-full w-full flex flex-col overflow-hidden animate-fade-in" style={{ color: INK, background: PAGE_BG }}>
                <PaperBackdrop corners={false} />
                <Header title={`${b?.emoji || ''} ${b?.name || '帖子'}吧`} en="A TABLE BY THE WINDOW" onBack={() => { setOpenId(null); setOnlyOp(false); }} right={
                    <button onClick={() => setOnlyOp(v => !v)} className="px-2.5 py-1 rounded-full text-[11px] font-bold active:scale-95 transition-transform" style={chip(onlyOp)}>只看楼主</button>
                } />
                <div ref={scrollRef} className="relative z-10 flex-1 overflow-y-auto no-scrollbar px-4 pt-1 pb-4">
                    {/* OP = 1 楼（纸卡 + 图钉） */}
                    <div className="relative px-4 py-3.5 mb-3" style={PANEL}>
                        <span aria-hidden className="absolute -top-1.5 right-5 w-3 h-3 rounded-full z-10" style={{ background: 'radial-gradient(circle at 34% 30%, #54504a, #1f1d1a)', boxShadow: '0 0 0 2px rgba(255,255,255,0.85), 0 3px 6px rgba(31,29,26,0.5)' }} />
                        <div className="flex items-center gap-2.5 mb-2">
                            <Avatar a={open.avatar} name={open.authorName} type={open.authorType} />
                            <div className="min-w-0">
                                <div className="text-[13px] font-bold flex items-center gap-1.5 flex-wrap" style={{ color: INK }}>
                                    {open.authorName}
                                    <LevelBadge lv={lvOf(open.authorType, open.authorName)} />
                                    <span className="px-1 py-px rounded text-[9px] font-bold flex items-center gap-0.5" style={{ background: 'rgba(255,253,247,0.9)', color: INK, border: '1px solid rgba(120,116,108,0.55)' }}><CrownSimple size={9} weight="fill" />楼主</span>
                                    {open.authorType === 'char' && <span className="px-1 py-px rounded text-[9px] font-bold" style={{ background: 'rgba(120,116,108,0.5)', color: '#2a2824' }}>角色</span>}
                                    {open.authorType === 'user' && <span className="px-1 py-px rounded text-[9px] font-bold" style={{ background: 'rgba(255,253,247,0.9)', color: INK, border: '1px dashed rgba(150,144,132,0.7)' }}>我</span>}
                                </div>
                                <div className="text-[10px]" style={{ color: INK_SOFT }}>{timeAgo(open.createdAt)} · 共 {kFmt(target)} 楼</div>
                            </div>
                        </div>
                        <h1 className="text-[16px] font-black leading-snug mb-1.5 flex items-start gap-1.5 flex-wrap" style={{ color: INK }}><PostTags p={open} /><span>{open.title}</span></h1>
                        {open.body && <p className="text-[13px] leading-relaxed whitespace-pre-wrap" style={{ color: '#48443c' }}>{open.body}</p>}
                        {open.poll && <PollView poll={open.poll} onVote={i => onVote(open.id, i)} />}
                        <div className="flex items-center gap-3 mt-3">
                            <button onClick={() => likePost(open.id)} className="flex items-center gap-1 text-[11px] active:scale-90 transition-transform" style={{ color: INK_SOFT }}><ArrowFatUp size={15} weight="bold" />{kFmt(open.likes)}</button>
                            <button onClick={() => dislikePost(open.id)} className="flex items-center gap-1 text-[11px] active:scale-90 transition-transform" style={{ color: INK_SOFT }}><ArrowFatDown size={15} weight="bold" />{open.dislikes || ''}</button>
                            <span className="flex items-center gap-1 text-[11px]" style={{ color: INK_SOFT }}><ChatCircleText size={15} weight="bold" />{kFmt(target)}</span>
                            <span className="ml-auto text-[10px]" style={{ color: 'rgba(150,144,132,0.85)' }}>1 楼 · 楼主</span>
                        </div>
                    </div>
                    {/* 楼层区：标题 + 倒序 */}
                    <div className="flex items-center justify-between px-1 pb-2">
                        <span className="text-[12px] font-bold" style={{ color: INK_SOFT }}>接话 · 盖楼 <span style={{ color: INK }}>{kFmt(Math.max(0, loadedFloors - 1))}</span></span>
                        <button onClick={() => setOrder(o => o === 'asc' ? 'desc' : 'asc')} className="flex items-center gap-1 text-[11px] font-bold active:scale-95 transition-transform" style={{ color: INK_SOFT }}>
                            <ArrowsDownUp size={13} weight="bold" />{order === 'asc' ? '正序' : '倒序'}
                        </button>
                    </div>
                    {/* 楼层 */}
                    <div className="space-y-3.5">
                        {open.replies.length === 0 && floorBusy && (
                            <div className="text-center text-xs py-8 flex items-center justify-center gap-1.5" style={{ color: INK_SOFT }}><Spinner size={14} className="animate-spin" />茶客们正循着话头赶来…</div>
                        )}
                        {shown.length === 0 && open.replies.length > 0 && (
                            <div className="text-center text-xs py-6" style={{ color: INK_SOFT }}>楼主还没在本帖里接话</div>
                        )}
                        {shown.map(r => (
                            <div key={r.id} className="flex gap-2.5">
                                <Avatar a={r.avatar} name={r.authorName} type={r.authorType} size={30} />
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                        <span className="text-[12px] font-bold" style={{ color: '#48443c' }}>{r.authorName}</span>
                                        <LevelBadge lv={lvOf(r.authorType, r.authorName)} />
                                        <RoleTag type={r.authorType} isOp={r.isOp} owner={owner} name={r.authorName} />
                                        <span className="text-[10px] ml-auto" style={{ color: 'rgba(150,144,132,0.85)' }}>{r.floor}楼</span>
                                    </div>
                                    <p className="text-[13px] leading-relaxed mt-0.5 whitespace-pre-wrap" style={{ color: INK }}>{r.body}</p>
                                    {/* 楼中楼 */}
                                    {r.subReplies && r.subReplies.length > 0 && (
                                        <div className="mt-1.5 rounded-lg px-2.5 py-1.5 space-y-1" style={{ background: 'rgba(232,228,217,0.55)', border: '1px dashed rgba(150,144,132,0.5)' }}>
                                            {r.subReplies.map(s => (
                                                <p key={s.id} className="text-[12px] leading-relaxed">
                                                    <span className="font-bold" style={{ color: INK }}>{s.authorName}</span>
                                                    <span style={{ color: INK_SOFT }}> 回复 {r.authorName}：</span>
                                                    <span style={{ color: '#48443c' }}>{s.body}</span>
                                                </p>
                                            ))}
                                        </div>
                                    )}
                                    <div className="flex items-center gap-4 mt-1">
                                        <button onClick={() => likeReply(open.id, r.id)} className="flex items-center gap-1 text-[10px] active:scale-90 transition-transform" style={{ color: INK_SOFT }}><ArrowFatUp size={12} weight="bold" />{r.likes || ''}</button>
                                        <button onClick={() => dislikeReply(open.id, r.id)} className="flex items-center gap-1 text-[10px] active:scale-90 transition-transform" style={{ color: INK_SOFT }}><ArrowFatDown size={12} weight="bold" />{r.dislikes || ''}</button>
                                        <button onClick={() => { setReply(`回复 ${r.authorName}：`); }} className="flex items-center gap-1 text-[10px] active:scale-90 transition-transform" style={{ color: INK_SOFT }}><ChatCircleDots size={12} weight="bold" />接话</button>
                                    </div>
                                </div>
                            </div>
                        ))}
                        {/* 加载更多楼层（倒序时不显示在底部） */}
                        {!onlyOp && order === 'asc' && (canLoadMore ? (
                            <ScrapButton variant="paper" onClick={() => loadFloors(open)} disabled={floorBusy} className="w-full py-2.5 text-[12px]"
                                icon={floorBusy ? <Spinner size={14} className="animate-spin" /> : <Sparkle size={14} weight="fill" />}>
                                {floorBusy ? '茶客接话中…' : `再续几层楼（约还有 ${kFmt(Math.max(0, target - loadedFloors))} 层）`}
                            </ScrapButton>
                        ) : open.replies.length > 0 && (
                            <div className="text-center text-[11px] py-3" style={{ color: 'rgba(150,144,132,0.9)' }}>—— 到底了，这桌共 {kFmt(loadedFloors)} 层 ——</div>
                        ))}
                    </div>
                </div>
                {/* 颜文字面板 */}
                {kaoOpen && (
                    <div className="relative z-10 shrink-0 px-3 py-2 grid grid-cols-4 gap-1.5" style={{ borderTop: '1px dashed rgba(150,144,132,0.6)', background: 'rgba(251,249,242,0.95)' }}>
                        {KAOMOJI.map(k => (
                            <button key={k} onClick={() => setReply(r => r + k)} className="py-1.5 rounded-lg text-[12px] truncate active:scale-95 transition-transform" style={{ background: 'rgba(255,253,247,0.8)', color: '#48443c', border: '1px dashed rgba(150,144,132,0.5)' }}>{k}</button>
                        ))}
                    </div>
                )}
                {/* 回帖框 + 收藏/分享 */}
                <div className="relative z-10 shrink-0 p-2.5 flex items-center gap-2" style={{ borderTop: '1px dashed rgba(150,144,132,0.6)', background: 'rgba(251,249,242,0.95)', paddingBottom: 'max(env(safe-area-inset-bottom), 10px)' }}>
                    <button onClick={() => setKaoOpen(v => !v)} className="p-2 rounded-full active:scale-90 transition-transform" style={{ color: kaoOpen ? INK : INK_SOFT }}><Smiley size={22} weight={kaoOpen ? 'fill' : 'regular'} /></button>
                    <input value={reply} onChange={e => setReply(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addUserReply(); }} onFocus={() => setKaoOpen(false)}
                        placeholder="接句话，盖一层楼…" className="flex-1 px-3.5 py-2.5 rounded-full text-[13px] outline-none" style={paperInput} />
                    {reply.trim()
                        ? <ScrapButton variant="ink" onClick={addUserReply} className="px-4 py-2.5 text-[13px]">接话</ScrapButton>
                        : <>
                            <button onClick={() => collectPost(open.id)} className="p-2 rounded-full active:scale-90 transition-transform" style={{ color: collected ? INK : INK_SOFT }} title="夹起来"><BookmarkSimple size={22} weight={collected ? 'fill' : 'regular'} /></button>
                            <button onClick={() => sharePost(open)} className="p-2 rounded-full active:scale-90 transition-transform" style={{ color: INK_SOFT }} title="抄门牌"><ShareNetwork size={22} weight="regular" /></button>
                        </>}
                </div>
            </div>
        );
    }

    // ═══════════════ 首页 ═══════════════
    const genning = genBoard !== null;
    const renderHome = () => (
        <>
            <Header title="茶话亭" en="THE TEA PAVILION" onBack={closeApp}
                right={
                    <button onClick={charPost} disabled={charBusy} className="p-2 rounded-full active:scale-90 transition-transform disabled:opacity-50" style={{ color: INK_SOFT }} title="请角色支个话头">
                        <ArrowsClockwise size={18} weight="bold" className={charBusy ? 'animate-spin' : ''} />
                    </button>
                } />
            {/* 搜索栏 */}
            <div className="relative z-10 shrink-0 px-3 pb-2">
                <div className="flex items-center gap-2 rounded-full px-3 py-1.5" style={paperInput}>
                    <MagnifyingGlass size={15} weight="bold" style={{ color: INK_SOFT }} />
                    <input value={query} onChange={e => setQuery(e.target.value)} placeholder="翻翻帖子 / 找找茶客" className="flex-1 bg-transparent text-[13px] outline-none" style={{ color: INK }} />
                    {query && <button onClick={() => setQuery('')}><X size={14} weight="bold" style={{ color: INK_SOFT }} /></button>}
                </div>
            </div>
            {/* 板块吧 */}
            <div className="relative z-10 shrink-0 flex gap-2 overflow-x-auto no-scrollbar px-4 pb-2">
                {[{ id: 'all', name: '全部', emoji: '🏷️' }, ...FORUM_BOARDS].map(bd => {
                    const followed = bd.id !== 'all' && meta.followedBoards.includes(bd.id);
                    return (
                        <button key={bd.id} onClick={() => setBoard(bd.id)}
                            className="shrink-0 px-3 py-1.5 rounded-full text-[12px] font-bold transition-all active:scale-95 flex items-center gap-1" style={chip(board === bd.id)}>
                            {followed && <Star size={10} weight="fill" />}
                            {bd.emoji} {bd.name}{bd.id !== 'all' && bd.id === board ? '吧' : ''}
                        </button>
                    );
                })}
            </div>
            {/* 吧头招牌（纸卡 + 网点半调 + 胶带） */}
            {board !== 'all' && (() => {
                const bd = boardOf(board)!; const st = boardStat(board);
                const followed = meta.followedBoards.includes(board);
                const signed = isCheckedIn(meta, board);
                return (
                    <div className="relative z-10 shrink-0 mx-4 mb-2 px-4 py-3 overflow-hidden" style={PANEL}>
                        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.08]" style={{ backgroundImage: HALFTONE, backgroundSize: '7px 7px' }} />
                        <WashiTape color="ink" rotate={-4} className="absolute -top-2 left-6 w-16 h-5 rounded-[2px]" />
                        <div className="relative flex items-center gap-3">
                            <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-[26px] shrink-0" style={{ background: 'linear-gradient(180deg,#fffdf8,#ece8dd)', border: '1px solid rgba(176,170,158,0.7)' }}>{bd.emoji}</div>
                            <div className="flex-1 min-w-0">
                                <div className="text-[16px] font-black flex items-center gap-1.5" style={{ color: INK }}>{bd.name}吧</div>
                                <div className="text-[10px] truncate" style={{ color: INK_SOFT }}>{bd.desc} · 亭主 {st.owner}</div>
                                <div className="text-[10px] mt-0.5" style={{ color: INK_SOFT }}>{kFmt(st.members)} 常客 · {kFmt(st.posts)} 帖</div>
                            </div>
                            <div className="flex flex-col gap-1.5 shrink-0">
                                <ScrapButton variant={followed ? 'ghost' : 'ink'} onClick={() => followBoard(board)} className="px-3 py-1 text-[11px]"
                                    icon={followed ? <Check size={12} weight="bold" /> : <Plus size={12} weight="bold" />}>{followed ? '常来' : '常来'}</ScrapButton>
                                <ScrapButton variant={signed ? 'ghost' : 'paper'} onClick={() => doCheckIn(board)} className="px-3 py-1 text-[11px]"
                                    icon={<Coffee size={12} weight={signed ? 'regular' : 'fill'} />}>{signed ? '已续' : '续茶'}</ScrapButton>
                            </div>
                        </div>
                    </div>
                );
            })()}
            {/* 换一批条 */}
            {board !== 'all' && (
                <div className="relative z-10 shrink-0 flex items-center justify-between px-4 pb-2">
                    <span className="text-[11px] flex items-center gap-1" style={{ color: INK_SOFT }}><Fire size={12} weight="fill" style={{ color: INK }} />热乎 · 最新</span>
                    <button onClick={() => generateThreads(board, true)} disabled={genning}
                        className="flex items-center gap-1 text-[11px] font-bold active:scale-95 transition-transform disabled:opacity-50" style={{ color: INK }}>
                        <ArrowsClockwise size={13} weight="bold" className={genBoard === board ? 'animate-spin' : ''} />换一壶
                    </button>
                </div>
            )}
            <div className="relative z-10 flex-1 overflow-y-auto no-scrollbar">
                {/* 热议榜（全部视图） */}
                {board === 'all' && !query && hotList.length > 0 && (
                    <div className="relative mx-4 mb-3 px-4 py-3" style={PANEL}>
                        <SectionTag en="TODAY'S BUZZ" className="mb-2.5">🍵 今日热议</SectionTag>
                        <div className="space-y-2">
                            {hotList.map((p, i) => (
                                <button key={p.id} onClick={() => setOpenId(p.id)} className="w-full flex items-center gap-2.5 text-left active:opacity-70">
                                    <Stamp size={22} color={i < 3 ? 'ink' : 'sage'} className="text-[12px] font-black"><span className="text-[12px] font-black">{i + 1}</span></Stamp>
                                    <span className="flex-1 text-[13px] line-clamp-1" style={{ color: '#48443c' }}>{p.title}</span>
                                    {p.hot && <Fire size={12} weight="fill" className="shrink-0" style={{ color: INK }} />}
                                    <span className="text-[10px] shrink-0 tabular-nums" style={{ color: INK_SOFT }}>{kFmt(p.replyCount || p.replies.length)}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}
                {genning && list.length === 0 ? (
                    <div className="pt-20 flex flex-col items-center gap-2" style={{ color: INK_SOFT }}>
                        <Spinner size={26} className="animate-spin" style={{ color: INK }} />
                        <span className="text-[13px] font-bold">正在沏一壶帖子…</span>
                    </div>
                ) : list.length === 0 ? (
                    <div className="text-center text-sm pt-20" style={{ color: INK_SOFT }}>{query ? '没翻到相关的帖子' : '这个吧还空着，来支头一张话桌～'}</div>
                ) : list.map(p => <PostRow key={p.id} p={p} showBoard={board === 'all'} />)}
                <div className="h-4" />
            </div>
        </>
    );

    // ═══════════════ 消息 ═══════════════
    const notifText = (n: ForumNotif): string => n.kind === 'reply' ? '接了你的话' : n.kind === 'like' ? '给你点了个赞' : n.kind === 'newpost' ? '支了个新话头' : '';
    const shownNotifs = msgFilter === 'all' ? notifs : notifs.filter(n => n.kind === msgFilter);
    const renderMsg = () => (
        <>
            <Header title="叩门" en="KNOCKS" onBack={closeApp}
                right={unread > 0 ? <button onClick={readAll} className="text-[12px] font-bold active:scale-95 transition-transform px-2" style={{ color: INK }}>全部已读</button> : undefined} />
            <div className="relative z-10 shrink-0 flex gap-2 px-4 pb-2">
                {([['all', '全部'], ['reply', '接话的'], ['like', '点赞的'], ['newpost', '常去更新']] as const).map(([k, label]) => (
                    <button key={k} onClick={() => setMsgFilter(k)} className="px-3 py-1 rounded-full text-[12px] font-bold transition-all active:scale-95" style={chip(msgFilter === k)}>{label}</button>
                ))}
            </div>
            <div className="relative z-10 flex-1 overflow-y-auto no-scrollbar">
                {shownNotifs.length === 0 ? (
                    <div className="text-center text-sm pt-24 flex flex-col items-center gap-2" style={{ color: INK_SOFT }}><BellSimple size={32} style={{ color: 'rgba(150,144,132,0.6)' }} />暂时没有人来叩门</div>
                ) : shownNotifs.map(n => (
                    <button key={n.id} onClick={() => openNotif(n)} className="w-full text-left px-4 py-3 active:scale-[0.995] transition-transform flex gap-3" style={{ borderBottom: '1px dashed rgba(150,144,132,0.45)' }}>
                        <div className="relative shrink-0">
                            <Avatar a={n.avatar} name={n.actorName} type={n.actorType} size={38} />
                            {!n.read && <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full" style={{ background: INK, border: '2px solid #f6f3ec' }} />}
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                                <span className="text-[13px] font-bold truncate" style={{ color: INK }}>{n.actorName}</span>
                                {n.kind === 'like' && <Heart size={12} weight="fill" style={{ color: INK }} />}
                                {n.kind === 'system' && <span className="px-1 rounded text-[9px] font-bold" style={{ background: INK, color: PAPER }}>亭里</span>}
                                <span className="text-[10px] ml-auto shrink-0" style={{ color: 'rgba(150,144,132,0.85)' }}>{timeAgo(n.createdAt)}</span>
                            </div>
                            <div className="text-[12px] mt-0.5" style={{ color: INK_SOFT }}>{notifText(n)}{n.kind !== 'system' && n.postTitle && <span style={{ color: 'rgba(150,144,132,0.95)' }}> · {n.postTitle}</span>}</div>
                            {n.snippet && <div className="text-[12px] mt-1 rounded-lg px-2.5 py-1.5 line-clamp-2" style={{ background: 'rgba(232,228,217,0.55)', color: '#48443c', border: '1px dashed rgba(150,144,132,0.5)' }}>{n.snippet}</div>}
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
            <Header title="我的座位" en="MY SEAT" onBack={closeApp} />
            <div className="relative z-10 flex-1 overflow-y-auto no-scrollbar px-4">
                {/* 个人资料卡（墨色名牌） */}
                <div className="relative px-5 pt-4 pb-4 mb-3 overflow-hidden" style={{ ...PANEL, background: 'linear-gradient(165deg,#26241f,#15140f)', border: '1px solid rgba(31,29,26,0.9)' }}>
                    <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.10]" style={{ backgroundImage: HALFTONE, backgroundSize: '7px 7px' }} />
                    <WashiTape color="butter" rotate={-3} className="absolute -top-2 right-7 w-16 h-5 rounded-[2px]" />
                    <div className="relative flex items-center gap-3.5">
                        {userProfile.avatar ? <img src={userProfile.avatar} className="w-16 h-16 rounded-full object-cover" style={{ border: '2px solid rgba(246,243,236,0.5)' }} /> : <div className="w-16 h-16 rounded-full flex items-center justify-center text-[30px]" style={{ background: 'rgba(246,243,236,0.12)' }}>🙂</div>}
                        <div className="flex-1 min-w-0">
                            <div className="text-[18px] font-black flex items-center gap-2" style={{ color: PAPER }}>{userName}<LevelBadge lv={myLevel.level} md /></div>
                            <div className="text-[11px] flex items-center gap-1 mt-0.5" style={{ color: 'rgba(246,243,236,0.8)' }}><Medal size={12} weight="fill" />{myLevel.title}</div>
                        </div>
                    </div>
                    {/* 火候进度条 */}
                    <div className="relative mt-3">
                        <div className="flex items-center justify-between text-[10px] mb-1" style={{ color: 'rgba(246,243,236,0.8)' }}>
                            <span>Lv.{myLevel.level}</span>
                            <span>{myLevel.max ? '火候已满' : `${myLevel.cur} / ${myLevel.need} 攒满升级`}</span>
                            <span>Lv.{Math.min(18, myLevel.level + 1)}</span>
                        </div>
                        <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(246,243,236,0.18)' }}>
                            <div className="h-full rounded-full" style={{ width: `${myLevel.pct}%`, background: 'linear-gradient(90deg,#cfc8b8,#f6f3ec)' }} />
                        </div>
                    </div>
                </div>
                {/* 数据条 */}
                <div className="grid grid-cols-4 mb-3 py-3" style={PANEL}>
                    {[['支话头', myPosts.length], ['得赞', likesGot], ['常去吧', meta.followedBoards.length], ['连续续茶', maxStreak(meta)]].map(([label, val]) => (
                        <div key={label} className="flex flex-col items-center">
                            <span className="text-[17px] font-black tabular-nums" style={{ color: INK }}>{kFmt(Number(val))}</span>
                            <span className="text-[10px] mt-0.5" style={{ color: INK_SOFT }}>{label}</span>
                        </div>
                    ))}
                </div>
                {/* 子页切换 */}
                <div className="flex rounded-xl overflow-hidden mb-2" style={{ background: 'rgba(255,253,247,0.6)', border: '1px dashed rgba(150,144,132,0.6)' }}>
                    {([['posts', '我支的话头'], ['collect', '夹起的帖'], ['follow', '常去的吧']] as const).map(([k, label]) => (
                        <button key={k} onClick={() => setMeSub(k)} className="flex-1 py-2.5 text-[13px] font-bold transition-colors" style={meSub === k ? { background: INK, color: PAPER } : { color: INK_SOFT }}>
                            {label}
                        </button>
                    ))}
                </div>
                {meSub === 'posts' && (myPosts.length ? <div style={{ ...PANEL, overflow: 'hidden' }}>{myPosts.map(p => <PostRow key={p.id} p={p} showBoard />)}</div> : <Empty text="还没在亭子里支过话头，去首页支一个吧～" />)}
                {meSub === 'collect' && (myCollected.length ? <div style={{ ...PANEL, overflow: 'hidden' }}>{myCollected.map(p => <PostRow key={p.id} p={p} showBoard />)}</div> : <Empty text="还没夹起想再看的帖子" />)}
                {meSub === 'follow' && (followedBoards.length ? (
                    <div className="grid grid-cols-2 gap-2.5">
                        {followedBoards.map(bd => {
                            const st = boardStat(bd.id);
                            return (
                                <button key={bd.id} onClick={() => { setTab('home'); setBoard(bd.id); }} className="p-3 text-left active:scale-95 transition-transform" style={PANEL}>
                                    <div className="flex items-center gap-2">
                                        <span className="text-[22px]">{bd.emoji}</span>
                                        <div className="min-w-0">
                                            <div className="text-[13px] font-black truncate" style={{ color: INK }}>{bd.name}吧</div>
                                            <div className="text-[10px]" style={{ color: INK_SOFT }}>{kFmt(st.members)} 常客</div>
                                        </div>
                                    </div>
                                    <div className="text-[11px] mt-1.5 line-clamp-1" style={{ color: INK_SOFT }}>{bd.desc}</div>
                                    <div className="mt-2 flex items-center justify-between">
                                        <span className="text-[10px] font-bold flex items-center gap-0.5" style={{ color: isCheckedIn(meta, bd.id) ? 'rgba(150,144,132,0.85)' : INK }}><Coffee size={11} weight="bold" />{isCheckedIn(meta, bd.id) ? '今日已续' : '待续茶'}</span>
                                        <CaretRight size={13} weight="bold" style={{ color: INK_SOFT }} />
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                ) : <Empty text="还没常去的吧，去首页点「常来」吧～" />)}
                <div className="h-4" />
            </div>
        </>
    );

    return (
        <div className="relative h-full w-full flex flex-col overflow-hidden animate-fade-in" style={{ color: INK, background: PAGE_BG }}>
            <PaperBackdrop corners={false} />
            <div className="flex-1 min-h-0 flex flex-col">
                {tab === 'home' ? renderHome() : tab === 'msg' ? renderMsg() : renderMe()}
            </div>
            {/* 底部导航（纸面贴纸条） */}
            <div className="relative z-10 shrink-0 flex items-stretch" style={{ borderTop: '1px dashed rgba(150,144,132,0.6)', background: 'rgba(251,249,242,0.95)', paddingBottom: 'env(safe-area-inset-bottom,0px)' }}>
                {([['home', '亭子', House], ['msg', '叩门', BellSimple], ['me', '座位', User]] as const).map(([id, label, Icon]) => {
                    const active = tab === id;
                    return (
                        <button key={id} onClick={() => setTab(id)} className="flex-1 flex flex-col items-center justify-center gap-0.5 py-1.5 active:scale-95 transition-transform relative" style={{ color: active ? INK : INK_SOFT }}>
                            <Icon size={23} weight={active ? 'fill' : 'regular'} />
                            <span className={`text-[10px] ${active ? 'font-black' : 'font-medium'}`}>{label}</span>
                            {active && <span aria-hidden className="absolute bottom-0.5 w-5 h-[3px] rounded-full" style={{ background: INK }} />}
                            {id === 'msg' && unread > 0 && <span className="absolute top-0.5 right-1/2 -mr-3.5 min-w-[15px] h-[15px] px-1 rounded-full text-[9px] font-black flex items-center justify-center" style={{ background: INK, color: PAPER, boxShadow: '0 0 0 1.5px #f6f3ec' }}>{unread > 99 ? '99+' : unread}</span>}
                        </button>
                    );
                })}
            </div>

            {/* 支话头 FAB（仅首页） */}
            {tab === 'home' && (
                <button onClick={() => setCompose({ board: board === 'all' ? 'chat' : board, title: '', body: '', pollOn: false, pollQ: '', pollOpts: ['', ''] })}
                    className="absolute right-5 bottom-20 w-14 h-14 rounded-full flex items-center justify-center active:scale-90 transition-transform z-20"
                    style={{ background: INK, color: PAPER, outline: '1px dashed rgba(255,255,255,0.32)', outlineOffset: -5, boxShadow: '0 16px 26px -12px rgba(31,29,26,0.7)' }}>
                    <PencilSimple size={24} weight="bold" />
                </button>
            )}

            {/* 续茶成功卡 */}
            <PaperDialog open={!!signCard} en="A FRESH POT" tape="ink" onClose={() => setSignCard(null)} maxWidth={300}>
                {signCard && (
                    <div className="flex flex-col items-center gap-1.5 text-center">
                        <Confetti size={42} weight="fill" style={{ color: INK }} />
                        <div className="text-[18px] font-black" style={{ color: INK }}>茶续上了！</div>
                        <div className="text-[13px] font-bold" style={{ color: INK }}>火候 +{signCard.gained}</div>
                        <div className="text-[12px]" style={{ color: INK_SOFT }}>已连续续茶 <span className="font-black" style={{ color: INK }}>{signCard.streak}</span> 天</div>
                        <div className="text-[11px] mt-1" style={{ color: INK_SOFT }}>你是本吧今天第 {signCard.rank} 位来续茶的茶客</div>
                    </div>
                )}
            </PaperDialog>

            {/* 支话头弹窗（纸面全屏） */}
            {compose && (
                <div className="absolute inset-0 z-40 flex flex-col animate-slide-up" style={{ color: INK, background: PAGE_BG }}>
                    <PaperBackdrop corners={false} />
                    <Header title="支个话头" en="NEW THREAD" onBack={() => setCompose(null)} backIcon={<X size={20} weight="bold" />} right={
                        <ScrapButton variant="ink" onClick={submitPost} className="px-4 py-1.5 text-[13px]">贴出去</ScrapButton>
                    } />
                    <div className="relative z-10 flex-1 overflow-y-auto no-scrollbar p-4 space-y-3">
                        <div className="flex gap-2 flex-wrap">
                            {FORUM_BOARDS.map(bd => (
                                <button key={bd.id} onClick={() => setCompose(c => c && { ...c, board: bd.id })}
                                    className="px-3 py-1.5 rounded-full text-[12px] font-bold transition-all active:scale-95" style={chip(compose.board === bd.id)}>
                                    {bd.emoji} {bd.name}
                                </button>
                            ))}
                        </div>
                        <input value={compose.title} onChange={e => setCompose(c => c && { ...c, title: e.target.value })} placeholder="话头（标题）"
                            className="w-full px-3 py-2.5 rounded-xl text-[15px] font-bold outline-none" style={paperInput} />
                        <textarea value={compose.body} onChange={e => setCompose(c => c && { ...c, body: e.target.value })} placeholder="正文（想说的，随意展开）" rows={6}
                            className="w-full px-3 py-2.5 rounded-xl text-[14px] outline-none resize-none leading-relaxed" style={paperInput} />
                        {/* 投票 */}
                        <button onClick={() => setCompose(c => c && { ...c, pollOn: !c.pollOn })} className="flex items-center gap-1.5 text-[12px] font-bold" style={{ color: compose.pollOn ? INK : INK_SOFT }}>
                            <ChartBar size={15} weight="bold" />{compose.pollOn ? '撤掉投票' : '＋ 摆个投票'}
                        </button>
                        {compose.pollOn && (
                            <div className="space-y-2 rounded-xl p-3" style={{ background: 'rgba(232,228,217,0.45)', border: '1px dashed rgba(150,144,132,0.55)' }}>
                                <input value={compose.pollQ} onChange={e => setCompose(c => c && { ...c, pollQ: e.target.value })} placeholder="投票问题，如「你站哪边？」"
                                    className="w-full px-3 py-2 rounded-lg text-[13px] font-bold outline-none" style={paperInput} />
                                {compose.pollOpts.map((o, i) => (
                                    <div key={i} className="flex items-center gap-2">
                                        <input value={o} onChange={e => setCompose(c => { if (!c) return c; const opts = [...c.pollOpts]; opts[i] = e.target.value; return { ...c, pollOpts: opts }; })} placeholder={`选项 ${i + 1}`}
                                            className="flex-1 px-3 py-2 rounded-lg text-[13px] outline-none" style={paperInput} />
                                        {compose.pollOpts.length > 2 && <button onClick={() => setCompose(c => c && { ...c, pollOpts: c.pollOpts.filter((_, j) => j !== i) })}><X size={16} weight="bold" style={{ color: INK_SOFT }} /></button>}
                                    </div>
                                ))}
                                {compose.pollOpts.length < 5 && <button onClick={() => setCompose(c => c && { ...c, pollOpts: [...c.pollOpts, ''] })} className="text-[12px] font-bold flex items-center gap-1" style={{ color: INK }}><Plus size={13} weight="bold" />加个选项</button>}
                            </div>
                        )}
                        <DashedRule className="my-1" />
                        <p className="text-[11px]" style={{ color: INK_SOFT }}>贴出去后进帖，亭里的角色和茶客会循着话头、按各自人设来接话盖楼。</p>
                    </div>
                </div>
            )}
        </div>
    );
};

// 投票帖渲染（OP 卡内，黑白拼贴）
const PollView: React.FC<{ poll: ForumPoll; onVote: (i: number) => void }> = ({ poll, onVote }) => {
    const total = pollTotal(poll);
    const voted = poll.voted !== undefined;
    return (
        <div className="mt-3 rounded-xl p-3" style={{ background: 'rgba(232,228,217,0.4)', border: '1px dashed rgba(150,144,132,0.55)' }}>
            <div className="text-[13px] font-black mb-2 flex items-center gap-1.5" style={{ color: INK }}><ChartBar size={15} weight="fill" />{poll.question}</div>
            <div className="space-y-2">
                {poll.options.map((o, i) => {
                    const pct = total ? Math.round((o.votes / total) * 100) : 0;
                    const mine = poll.voted === i;
                    return (
                        <button key={i} onClick={() => onVote(i)} className="w-full relative overflow-hidden rounded-lg active:scale-[0.99] transition-transform" style={{ background: 'rgba(255,253,247,0.92)', border: `1px ${mine ? 'solid' : 'dashed'} ${mine ? INK : 'rgba(150,144,132,0.6)'}` }}>
                            {voted && <div className="absolute inset-y-0 left-0" style={{ width: `${pct}%`, background: mine ? 'rgba(31,29,26,0.16)' : 'rgba(120,116,108,0.16)' }} />}
                            <div className="relative flex items-center justify-between px-3 py-2">
                                <span className="text-[13px] flex items-center gap-1" style={{ color: INK, fontWeight: mine ? 900 : 400 }}>{mine && <Check size={13} weight="bold" />}{o.text}</span>
                                {voted && <span className="text-[11px] tabular-nums" style={{ color: mine ? INK : INK_SOFT, fontWeight: mine ? 700 : 400 }}>{pct}% · {o.votes}</span>}
                            </div>
                        </button>
                    );
                })}
            </div>
            <div className="text-[10px] mt-2" style={{ color: INK_SOFT }}>{total} 人参与 · {voted ? '可改投' : '点选项投票'}</div>
        </div>
    );
};

const Empty: React.FC<{ text: string }> = ({ text }) => (
    <StickyNote color="butter" rotate={-1.5} className="px-5 py-8 text-center mt-4">
        <span className="text-[13px] font-bold" style={{ color: '#5b554b' }}>{text}</span>
    </StickyNote>
);

// ── 顶栏：胶带返回钮 + 招牌（中文 + 英文小标）+ 右槽 ──
const Header: React.FC<{ title: string; en?: string; onBack: () => void; right?: React.ReactNode; backIcon?: React.ReactNode }> = ({ title, en, onBack, right, backIcon }) => (
    <div className="relative z-20 shrink-0">
        <div style={{ height: 'var(--safe-top)' }} />
        <div className="flex items-center px-3 pt-2 pb-2.5 gap-2">
            <button onClick={onBack} className="relative inline-flex items-center gap-1 px-3 py-2 text-[12px] font-black active:scale-95 transition-transform" style={{ color: '#36322b' }}>
                <span aria-hidden className="absolute inset-0 rounded-[6px]" style={{ backgroundColor: WASHI.butter.base, backgroundImage: TAPE_STRIPES, transform: 'rotate(-2deg)', boxShadow: '0 3px 7px -3px rgba(31,29,26,0.5)' }} />
                <span className="relative z-10 flex items-center gap-1">{backIcon || <CaretLeft size={13} weight="bold" />}</span>
            </button>
            <div className="leading-none">
                <div className="text-[16px] font-black tracking-[0.04em]" style={{ color: INK }}>{title}</div>
                {en && <div className="text-[7px] tracking-[0.36em] uppercase mt-0.5" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>{en}</div>}
            </div>
            <div className="flex-1" />
            {right}
        </div>
    </div>
);

export default ForumApp;
