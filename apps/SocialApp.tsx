import React, { useEffect, useMemo, useState } from 'react';
import { MagnifyingGlass, Shuffle, Binoculars, Stack, Heart, BookmarkSimple, Scissors, Broom, X, HandWaving, MapPin, Spinner, PaperPlaneTilt, ChatCircle } from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import { AppID, XhsFeedPost } from '../types';
import { DB } from '../utils/db';
import { generateFeedBatch, generateAuthorReply, FEED_BATCH_SIZE } from '../utils/xhsFeed';
import { generateDatingBatch, fallbackDatingProfiles, intentMeta, DatingProfile, DATING_INTENTS, DatingIntent, generateDatingReply, isMatch } from '../utils/socialDating';
import { resolveAuxApi } from '../utils/auxApi';
import {
    InsShell, IconCircle, InsButton, Chip, InsDialog, InsSheet, accent, INK, INK_SOFT, SUNSET,
} from '../components/ui/insKit';
import { CaretLeft } from '@phosphor-icons/react';

/**
 * 见闻簿 App —— 本地生成信息流版（Ins 风 · 小红书瀑布流皮肤）。
 *
 * 把熟人和路人「见到的、听到的」剪成一张张卡片，贴进一本见闻簿：每次「翻新页」由 LLM
 * 生成一沓（≥10 张），混合熟人卡片（按角色人设发）与路人卡片，持久化在 IndexedDB。
 * 用户可看详情、点赞、收藏、评论（作者会回）、剪下来（转成自己的卡片）。
 * 「出门转转」（角色自主刷真实小红书）与「素材堆」（囤图）保留快捷入口。
 * 换肤：照片保留彩色、白色大圆角卡片 + 极柔投影；强调色 rose（小红书气质）。
 */

// 见闻簿强调色（小红书 = 玫红，比 constants 的 red 更贴气质）
const AC = 'rose' as const;
const A = accent(AC);

const fmtCount = (n: number): string => (n >= 10000 ? `${(n / 10000).toFixed(1)}w` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

const fmtTime = (ts: number): string => {
    const diff = Date.now() - ts;
    if (diff < 60 * 1000) return '刚刚';
    if (diff < 3600 * 1000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 24 * 3600 * 1000) return `${Math.floor(diff / 3600000)} 小时前`;
    if (diff < 7 * 24 * 3600 * 1000) return `${Math.floor(diff / 86400000)} 天前`;
    const d = new Date(ts);
    return `${d.getMonth() + 1}-${d.getDate()}`;
};

/** 头像：有图用彩色圆头像；没图用昵称首字 + IG 日落渐变底 */
const Avatar: React.FC<{ name: string; src?: string; size?: number }> = ({ name, src, size = 32 }) => {
    if (src) return <img src={src} style={{ width: size, height: size }} className="rounded-full object-cover shrink-0" alt="" />;
    return (
        <div style={{ width: size, height: size, background: SUNSET, fontSize: size * 0.42 }}
            className="rounded-full text-white flex items-center justify-center font-bold shrink-0 select-none">
            {name.slice(0, 1)}
        </div>
    );
};

/** 瀑布流卡片：白色大圆角 + 彩色封面 + 软投影（小红书式） */
const PostCard: React.FC<{ post: XhsFeedPost; onClick: () => void }> = ({ post, onClick }) => (
    <button onClick={onClick}
        className="relative w-full text-left overflow-hidden bg-white press-soft mb-3 break-inside-avoid"
        style={{ borderRadius: 18, boxShadow: '0 1px 2px rgba(38,38,38,0.04), 0 14px 30px -22px rgba(38,38,38,0.28)' }}>
        {post.coverUrl ? (
            <img src={post.coverUrl} className="w-full object-cover animate-photo-develop" referrerPolicy="no-referrer" loading="lazy"
                onError={(e: any) => { e.target.style.display = 'none'; }} />
        ) : (
            <div className="w-full aspect-[3/4] flex items-center justify-center p-3.5" style={{ background: `linear-gradient(150deg, ${A.soft}, #f1eee9)` }}>
                <span className="text-[14px] font-bold leading-relaxed line-clamp-6 text-center" style={{ color: '#5a5660', fontFamily: 'var(--font-hand)' }}>{post.repostOf ? `✄ ${post.title}` : post.body.slice(0, 60)}</span>
            </div>
        )}
        <div className="px-2.5 pt-2 pb-2.5">
            <div className="text-[12.5px] font-bold leading-snug line-clamp-2" style={{ color: INK }}>{post.title}</div>
            <div className="flex items-center justify-between mt-2 gap-1">
                <span className="inline-flex items-center gap-1.5 min-w-0 flex-1">
                    <Avatar name={post.author} src={post.authorAvatar} size={18} />
                    <span className="text-[10.5px] truncate" style={{ color: post.authorType === 'character' ? A.solid : INK_SOFT, fontWeight: post.authorType === 'character' ? 700 : 400 }}>{post.author}</span>
                </span>
                <span className="inline-flex items-center gap-0.5 text-[10.5px] shrink-0" style={{ color: post.liked ? A.solid : INK_SOFT, fontWeight: post.liked ? 700 : 400 }}>
                    <Heart className="w-3.5 h-3.5" weight={post.liked ? 'fill' : 'regular'} />{fmtCount(post.likes)}
                </span>
            </div>
        </div>
    </button>
);

/** 见闻 / 交友 段控（清爽胶囊滑块） */
const TabBar: React.FC<{ mode: 'feed' | 'meet'; setMode: (m: 'feed' | 'meet') => void }> = ({ mode, setMode }) => (
    <div className="px-3 py-2 shrink-0">
        <div className="relative flex p-1 rounded-full" style={{ background: '#efece7' }}>
            <span className="absolute top-1 bottom-1 rounded-full transition-all duration-300" style={{ left: mode === 'feed' ? '4px' : '50%', right: mode === 'feed' ? '50%' : '4px', background: '#fff', boxShadow: '0 4px 12px -6px rgba(38,38,38,0.3)' }} />
            {([['feed', '见闻'], ['meet', '交友']] as const).map(([k, label]) => (
                <button key={k} onClick={() => setMode(k)} className="relative flex-1 py-1.5 text-[13px] font-bold transition-colors z-10" style={{ color: mode === k ? INK : INK_SOFT }}>
                    {label}
                </button>
            ))}
        </div>
    </div>
);

/** 顶栏（本 App 通用）：返回 + 标题 + 副标 + 右槽 */
const AppHeader: React.FC<{ title: string; sub?: string; onBack: () => void; right?: React.ReactNode }> = ({ title, sub, onBack, right }) => (
    <div className="shrink-0 relative z-10" style={{ paddingTop: 'var(--safe-top)' }}>
        <div className="flex items-center gap-2.5 px-3.5 pt-2.5 pb-2.5">
            <IconCircle onClick={onBack} title="返回"><CaretLeft size={18} weight="bold" /></IconCircle>
            <div className="min-w-0 flex-1 leading-tight">
                <span className="text-[19px] font-extrabold tracking-tight" style={{ color: INK }}>{title}</span>
                {sub && <div className="text-[10.5px] mt-0.5 truncate" style={{ color: INK_SOFT }}>{sub}</div>}
            </div>
            {right}
        </div>
    </div>
);

/** 交友卡片（彩色照片 + 资料 + 跳过/打招呼/喜欢） */
const DatingCard: React.FC<{ p: DatingProfile; remaining: number; onAct: (a: 'skip' | 'like' | 'greet') => void }> = ({ p, remaining, onAct }) => {
    const im = intentMeta(p.intent);
    return (
        <div className="w-full max-w-[360px] flex flex-col animate-ins-card">
            <div className="relative bg-white overflow-hidden" style={{ borderRadius: 26, boxShadow: '0 1px 2px rgba(38,38,38,0.05), 0 28px 50px -26px rgba(38,38,38,0.4)' }}>
                <div className="relative w-full aspect-[4/5] overflow-hidden flex items-center justify-center" style={{ background: `linear-gradient(150deg, ${A.soft}, #f0eee8)` }}>
                    {p.avatar ? <img src={p.avatar} className="w-full h-full object-cover" referrerPolicy="no-referrer" /> : <span className="text-[88px] select-none">{p.emoji}</span>}
                    <div className="absolute top-3 left-3 flex items-center gap-1 text-white text-[10px] font-bold px-2.5 py-1 rounded-full" style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(6px)' }}><MapPin className="w-3 h-3" weight="fill" />{p.distanceKm}km</div>
                    {p.online && <div className="absolute top-3 right-3 flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full" style={{ background: 'rgba(255,255,255,0.9)', color: INK, backdropFilter: 'blur(6px)' }}><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />在线</div>}
                    <div className="absolute bottom-3 left-3 text-[11px] font-bold px-2.5 py-1 rounded-full" style={{ background: 'rgba(255,255,255,0.92)', color: A.ink }}>{im.emoji} {im.label}</div>
                    {p.isChar && <div className="absolute bottom-3 right-3 text-white text-[10px] font-bold px-2.5 py-1 rounded-full" style={{ background: A.solid }}>熟人</div>}
                </div>
                <div className="px-4 pt-3 pb-3.5">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[17px] font-black" style={{ color: INK }}>{p.name}</span>
                        {p.age != null && <span className="text-[12px]" style={{ color: INK_SOFT }}>{p.age}</span>}
                        {p.gender && <span className="text-[10px] text-white px-1.5 py-0.5 rounded-full" style={{ background: A.solid }}>{p.gender}</span>}
                    </div>
                    {p.tags.length > 0 && <div className="flex flex-wrap gap-1.5 mt-2">{p.tags.map(t => <span key={t} className="text-[10.5px] px-2 py-0.5 rounded-full" style={{ color: A.ink, background: A.soft }}>{t}</span>)}</div>}
                    <div className="text-[13px] leading-relaxed whitespace-pre-wrap mt-2.5" style={{ color: '#4a4750' }}>{p.bio}</div>
                </div>
            </div>
            <div className="flex items-center justify-center gap-6 mt-5">
                <button onClick={() => onAct('skip')} className="rounded-full bg-white flex items-center justify-center press-soft" style={{ width: 52, height: 52, boxShadow: '0 8px 20px -10px rgba(38,38,38,0.35)' }} title="跳过"><X className="w-5 h-5" weight="bold" style={{ color: INK_SOFT }} /></button>
                <button onClick={() => onAct('greet')} className="rounded-full flex items-center justify-center press-soft text-white" style={{ width: 62, height: 62, background: INK, boxShadow: '0 12px 26px -10px rgba(38,38,38,0.6)' }} title="打招呼"><HandWaving className="w-7 h-7" weight="fill" /></button>
                <button onClick={() => onAct('like')} className="rounded-full flex items-center justify-center press-soft text-white" style={{ width: 52, height: 52, background: A.solid, boxShadow: `0 12px 26px -10px ${A.solid}` }} title="喜欢"><Heart className="w-5 h-5" weight="fill" /></button>
            </div>
            <div className="text-center text-[10.5px] mt-2.5" style={{ color: INK_SOFT }}>还有 {Math.max(0, remaining - 1)} 个待发现</div>
        </div>
    );
};

const SocialApp: React.FC = () => {
    const { closeApp, openApp, addToast, apiConfig, auxApiConfig, characters, userProfile, setActiveCharacterId } = useOS();
    // 见闻簿是「聊天以外」的辅助功能：走副 API（未配置时回落主 API）
    const feedApi = resolveAuxApi(auxApiConfig, apiConfig);
    const apiReady = !!feedApi?.baseUrl && !!feedApi?.model;

    const [posts, setPosts] = useState<XhsFeedPost[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [generating, setGenerating] = useState(false);
    const [searchInput, setSearchInput] = useState('');
    const [keyword, setKeyword] = useState('');
    const [detailId, setDetailId] = useState<string | null>(null);
    const [commentInput, setCommentInput] = useState('');
    const [replying, setReplying] = useState(false);
    const [forwardingPost, setForwardingPost] = useState<XhsFeedPost | null>(null);
    const [forwardNote, setForwardNote] = useState('');
    const [confirmClear, setConfirmClear] = useState(false);

    // ── 交友·发现身边的人 ──
    const [mode, setMode] = useState<'feed' | 'meet'>('feed');
    const [dating, setDating] = useState<DatingProfile[]>([]);
    const [datingIdx, setDatingIdx] = useState(0);
    const [datingBusy, setDatingBusy] = useState(false);
    const [meetFilter, setMeetFilter] = useState<DatingIntent | 'all'>('all');
    const [liked, setLiked] = useState<(DatingProfile & { matched?: boolean })[]>(() => {
        try { return JSON.parse(localStorage.getItem('moro_social_liked_v1') || '[]') || []; } catch { return []; }
    });
    const [showLiked, setShowLiked] = useState(false);
    const [greetCard, setGreetCard] = useState<{ p: DatingProfile; reply: string; busy: boolean; matched: boolean } | null>(null);
    const DATING_KEY = 'moro_social_dating_v1';
    const LIKED_KEY = 'moro_social_liked_v1';

    const detail = useMemo(() => posts.find(p => p.id === detailId) || null, [posts, detailId]);

    // 进交友页：先用缓存，没有就实时生成一批
    useEffect(() => {
        if (mode !== 'meet' || dating.length) return;
        try { const c = JSON.parse(localStorage.getItem(DATING_KEY) || 'null'); if (Array.isArray(c) && c.length) { setDating(c); return; } } catch { /* ignore */ }
        if (apiReady) void refreshDating(); else setDating(fallbackDatingProfiles(12));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mode]);

    const refreshDating = async () => {
        if (datingBusy) return;
        if (!apiReady) { addToast('先去「文具盒」把 API（模型 / 地址）补上', 'error'); setDating(fallbackDatingProfiles(12)); setDatingIdx(0); return; }
        setDatingBusy(true);
        try {
            const batch = await generateDatingBatch(feedApi, characters, userProfile, 14);
            setDating(batch); setDatingIdx(0);
            try { localStorage.setItem(DATING_KEY, JSON.stringify(batch)); } catch { /* ignore */ }
            addToast(`发现 ${batch.length} 个附近的人`, 'success');
        } catch {
            setDating(fallbackDatingProfiles(12)); setDatingIdx(0);
            addToast('没刷到新的人，先看看这些', 'error');
        } finally { setDatingBusy(false); }
    };

    const patchDating = (id: string, patch: Partial<DatingProfile>) =>
        setDating(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p));

    const saveLiked = (next: (DatingProfile & { matched?: boolean })[]) => {
        setLiked(next);
        try { localStorage.setItem(LIKED_KEY, JSON.stringify(next.slice(0, 60))); } catch { /* ignore */ }
    };

    // 喜欢：记入「我喜欢的」，按目的/熟人判定是否匹配成功
    const likeProfile = (p: DatingProfile) => {
        patchDating(p.id, { liked: true });
        const matched = isMatch(p);
        if (!liked.some(l => l.id === p.id)) saveLiked([{ ...p, liked: true, matched }, ...liked]);
        addToast(matched ? `🎉 和 ${p.name} 匹配成功！` : `❤️ 已喜欢 ${p.name}`, 'success');
        setDatingIdx(i => i + 1);
    };

    // 打招呼：让对方 AI 实时回应（熟人可一键进「来往」聊天）
    const greetProfile = async (p: DatingProfile) => {
        patchDating(p.id, { greeted: true });
        const matched = isMatch(p);
        if (!liked.some(l => l.id === p.id)) saveLiked([{ ...p, matched }, ...liked]);
        setGreetCard({ p, reply: '', busy: true, matched });
        setDatingIdx(i => i + 1);
        let reply = '';
        if (apiReady) { try { reply = await generateDatingReply(feedApi, p, userProfile); } catch { /* fall to canned */ } }
        setGreetCard(cur => cur && cur.p.id === p.id ? { ...cur, reply: reply || '（对方暂时没回应，等等再试试～）', busy: false } : cur);
    };

    // 熟人 → 进「来往」私聊
    const openChatWith = (charId?: string) => {
        if (!charId) return;
        setActiveCharacterId(charId);
        openApp(AppID.Chat);
    };

    const datingAct = (p: DatingProfile, act: 'skip' | 'like' | 'greet') => {
        if (act === 'like') likeProfile(p);
        else if (act === 'greet') void greetProfile(p);
        else setDatingIdx(i => i + 1);
    };

    // 启动：读本地信息流；空库且 API 可用时自动生成第一批
    useEffect(() => {
        (async () => {
            try {
                const stored = await DB.getXhsFeedPosts();
                setPosts(stored);
                setLoaded(true);
                if (stored.length === 0) void refreshFeed();
            } catch {
                setLoaded(true);
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const refreshFeed = async () => {
        if (generating) return;
        if (!apiReady) { addToast('先去「文具盒」把 API（模型 / 地址）补上', 'error'); return; }
        setGenerating(true);
        try {
            const stock = await DB.getXhsStockImages().catch(() => []);
            const batch = await generateFeedBatch(feedApi, characters, userProfile, stock);
            await DB.saveXhsFeedPosts(batch);
            setPosts(prev => [...batch, ...prev]);
            addToast(`又剪了 ${batch.length} 张贴上`, 'success');
        } catch (e: any) {
            addToast(`没剪出来：${e?.message || '未知错误'}`, 'error');
        } finally {
            setGenerating(false);
        }
    };

    /** 局部更新一条卡片（state + 落库） */
    const patchPost = (id: string, patch: Partial<XhsFeedPost> | ((p: XhsFeedPost) => Partial<XhsFeedPost>)) => {
        setPosts(prev => prev.map(p => {
            if (p.id !== id) return p;
            const next = { ...p, ...(typeof patch === 'function' ? patch(p) : patch) };
            void DB.saveXhsFeedPost(next);
            return next;
        }));
    };

    const toggleLike = (p: XhsFeedPost) =>
        patchPost(p.id, cur => ({ liked: !cur.liked, likes: Math.max(0, cur.likes + (cur.liked ? -1 : 1)) }));
    const toggleFav = (p: XhsFeedPost) =>
        patchPost(p.id, cur => ({ faved: !cur.faved, favs: Math.max(0, cur.favs + (cur.faved ? -1 : 1)) }));

    const submitComment = async () => {
        const text = commentInput.trim();
        if (!text || !detail || replying) return;
        setCommentInput('');
        const userComment = {
            id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
            author: userProfile.name,
            isUser: true,
            content: text,
            likes: 0,
            timestamp: Date.now(),
        };
        patchPost(detail.id, cur => ({ comments: [...cur.comments, userComment] }));
        // 作者回复（角色按人设 / NPC 按帖子口吻），失败时静默
        if (apiReady && detail.authorType !== 'user') {
            setReplying(true);
            try {
                const authorChar = detail.charId ? characters.find(c => c.id === detail.charId) : undefined;
                const reply = await generateAuthorReply(feedApi, detail, text, userProfile, authorChar);
                patchPost(detail.id, cur => ({ comments: [...cur.comments, reply] }));
            } catch { /* 回复失败不打扰 */ } finally {
                setReplying(false);
            }
        }
    };

    const submitForward = () => {
        if (!forwardingPost) return;
        const src = forwardingPost;
        const repost: XhsFeedPost = {
            id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
            authorType: 'user',
            author: userProfile.name,
            authorAvatar: userProfile.avatar,
            title: `剪贴：${src.title}`,
            body: `${forwardNote.trim() ? `${forwardNote.trim()}\n\n` : ''}— 剪自 @${src.author}：${src.body}`,
            tags: src.tags,
            coverUrl: src.coverUrl,
            likes: 0,
            favs: 0,
            comments: [],
            createdAt: Date.now(),
            repostOf: src.id,
            repostNote: forwardNote.trim() || undefined,
        };
        void DB.saveXhsFeedPost(repost);
        setPosts(prev => [repost, ...prev]);
        setForwardingPost(null);
        setForwardNote('');
        setDetailId(null);
        addToast('剪下来，贴进我的簿子了', 'success');
    };

    const clearFeed = async () => {
        await DB.clearXhsFeedPosts().catch(() => undefined);
        setPosts([]);
        setConfirmClear(false);
        addToast('这一沓全撕掉了', 'info');
    };

    // 搜索：本地过滤（标题 / 正文 / 标签 / 作者）
    const visible = useMemo(() => {
        const kw = keyword.trim().toLowerCase();
        if (!kw) return posts;
        return posts.filter(p =>
            p.title.toLowerCase().includes(kw) ||
            p.body.toLowerCase().includes(kw) ||
            p.author.toLowerCase().includes(kw) ||
            p.tags.some(t => t.toLowerCase().includes(kw)));
    }, [posts, keyword]);

    // 热门话题：从当前簿子里的 tags 统计高频话题，做成可点的筛选条
    const topicChips = useMemo(() => {
        const freq = new Map<string, number>();
        posts.forEach(p => p.tags.forEach(t => {
            const key = (t || '').trim();
            if (!key) return;
            freq.set(key, (freq.get(key) || 0) + 1);
        }));
        return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24).map(([t]) => t);
    }, [posts]);

    const [colA, colB] = useMemo(() => {
        const a: XhsFeedPost[] = []; const b: XhsFeedPost[] = [];
        visible.forEach((p, i) => (i % 2 === 0 ? a : b).push(p));
        return [a, b];
    }, [visible]);

    // ── 卡片详情页 ──
    if (detail) {
        return (
            <InsShell accent={AC}>
                <AppHeader
                    title={detail.author}
                    sub={`${fmtTime(detail.createdAt)}${detail.authorType === 'character' ? ' · 熟人' : detail.authorType === 'user' ? ' · 我剪的' : ' · 路人'}`}
                    onBack={() => setDetailId(null)}
                    right={<Avatar name={detail.author} src={detail.authorAvatar} size={36} />}
                />

                <div className="flex-1 overflow-y-auto no-scrollbar pb-4 relative z-10">
                    {detail.coverUrl && (
                        <img src={detail.coverUrl} className="w-full object-cover animate-photo-develop" referrerPolicy="no-referrer"
                            onError={(e: any) => { e.target.style.display = 'none'; }} />
                    )}
                    <div className="px-4 pt-3.5">
                        <div className="text-[18px] font-extrabold leading-snug" style={{ color: INK }}>{detail.title}</div>
                        <div className="text-[14px] leading-relaxed whitespace-pre-wrap mt-2.5" style={{ color: '#3f3c45' }}>{detail.body}</div>
                        {detail.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mt-3.5">
                                {detail.tags.map(t => (
                                    <button key={t} onClick={() => { setDetailId(null); setSearchInput(t); setKeyword(t); }} className="text-[12px] px-2.5 py-1 rounded-full font-medium press-soft" style={{ color: A.ink, background: A.soft }}>#{t}</button>
                                ))}
                            </div>
                        )}

                        {/* 评论区 */}
                        <div className="text-[12.5px] font-bold mt-6 mb-3 flex items-center gap-1.5 pt-4" style={{ color: INK, borderTop: '1px solid rgba(0,0,0,0.06)' }}><ChatCircle className="w-4 h-4" weight="bold" style={{ color: A.solid }} />评论 {detail.comments.length}</div>
                        <div className="space-y-3.5">
                            {detail.comments.map(cm => (
                                <div key={cm.id} className="flex gap-2.5">
                                    <Avatar name={cm.author} src={(cm as any).avatar} size={30} />
                                    <div className="min-w-0 flex-1">
                                        <div className="text-[11px] flex items-center gap-1.5" style={{ color: INK_SOFT }}>
                                            <span>{cm.author}</span>
                                            {cm.isUser && <span className="text-[9px] text-white px-1.5 py-0.5 rounded-full" style={{ background: A.solid }}>我</span>}
                                            {!cm.isUser && cm.author === detail.author && <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ color: A.ink, background: A.soft }}>作者</span>}
                                        </div>
                                        <div className="text-[13.5px] leading-relaxed whitespace-pre-wrap mt-0.5" style={{ color: INK }}>{cm.content}</div>
                                        <div className="text-[10px] mt-1" style={{ color: '#bcb9b2' }}>{fmtTime(cm.timestamp)}{cm.likes > 0 ? ` · ${fmtCount(cm.likes)} 赞` : ''}</div>
                                    </div>
                                </div>
                            ))}
                            {replying && <div className="text-[11.5px] pl-10" style={{ color: INK_SOFT, fontFamily: 'var(--font-hand)' }}>{detail.author} 正在回复…</div>}
                            {detail.comments.length === 0 && !replying && <div className="text-[11.5px]" style={{ color: '#bcb9b2', fontFamily: 'var(--font-hand)' }}>还没人评论，来写第一条～</div>}
                        </div>
                    </div>
                </div>

                {/* 底部互动栏：赞 / 收藏 / 剪 + 评论输入 */}
                <div className="shrink-0 bg-white px-3 py-2.5 flex items-center gap-2 relative z-10" style={{ borderTop: '1px solid rgba(0,0,0,0.06)', paddingBottom: 'calc(var(--safe-bottom, 0px) + 10px)' }}>
                    <input
                        value={commentInput}
                        onChange={e => setCommentInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') void submitComment(); }}
                        placeholder="写条评论…"
                        className="flex-1 px-4 py-2.5 text-[13px] outline-none min-w-0 rounded-full"
                        style={{ background: '#f2efeb' }}
                    />
                    {commentInput.trim() ? (
                        <button onClick={() => void submitComment()} disabled={replying} className="w-10 h-10 flex items-center justify-center rounded-full text-white press-soft shrink-0 disabled:opacity-50" style={{ background: A.solid }}>
                            <PaperPlaneTilt className="w-5 h-5" weight="fill" />
                        </button>
                    ) : (
                        <>
                            <button onClick={() => toggleLike(detail)} className="inline-flex flex-col items-center gap-0.5 shrink-0 px-1 press-soft" style={{ color: detail.liked ? A.solid : INK_SOFT }}>
                                <Heart className="w-6 h-6" weight={detail.liked ? 'fill' : 'regular'} /><span className="text-[9px] font-bold">{fmtCount(detail.likes)}</span>
                            </button>
                            <button onClick={() => toggleFav(detail)} className="inline-flex flex-col items-center gap-0.5 shrink-0 px-1 press-soft" style={{ color: detail.faved ? '#f59e0b' : INK_SOFT }}>
                                <BookmarkSimple className="w-6 h-6" weight={detail.faved ? 'fill' : 'regular'} /><span className="text-[9px] font-bold">{fmtCount(detail.favs)}</span>
                            </button>
                            <button onClick={() => { setForwardingPost(detail); setForwardNote(''); }} className="inline-flex flex-col items-center gap-0.5 shrink-0 px-1 press-soft" style={{ color: INK_SOFT }}>
                                <Scissors className="w-6 h-6" weight="regular" /><span className="text-[9px] font-bold">剪</span>
                            </button>
                        </>
                    )}
                </div>

                {/* 剪下来弹窗 */}
                <InsDialog open={!!forwardingPost} title="剪下来" en="CLIP IT" accent={AC} onClose={() => setForwardingPost(null)}
                    actions={<>
                        <InsButton variant="soft" accent="slate" onClick={() => setForwardingPost(null)} className="flex-1 py-2.5 text-[13px]">放回去</InsButton>
                        <InsButton variant="solid" accent={AC} onClick={submitForward} className="flex-1 py-2.5 text-[13px]">贴进簿子</InsButton>
                    </>}>
                    {forwardingPost && (
                        <div className="text-left">
                            <div className="px-3 py-2.5 rounded-2xl text-[12px] line-clamp-2 mb-3" style={{ background: A.soft, color: A.ink }}>@{forwardingPost.author}：{forwardingPost.title}</div>
                            <textarea
                                value={forwardNote}
                                onChange={e => setForwardNote(e.target.value)}
                                placeholder="想加一句评论？（可留空）"
                                className="w-full h-20 p-3 text-[13px] resize-none outline-none rounded-2xl"
                                style={{ background: '#f2efeb', color: INK }}
                            />
                        </div>
                    )}
                </InsDialog>
            </InsShell>
        );
    }

    // ── 交友·发现身边的人 ──
    if (mode === 'meet') {
        const deck = meetFilter === 'all' ? dating : dating.filter(p => p.intent === meetFilter);
        const cur = deck[datingIdx];
        const remaining = deck.length - datingIdx;
        return (
            <InsShell accent={AC}>
                <AppHeader
                    title="发现"
                    sub="附近正在交友的人，各有各的目的"
                    onBack={closeApp}
                    right={
                        <div className="flex items-center gap-2">
                            <button onClick={() => setShowLiked(true)} title="我喜欢的" className="relative w-9 h-9 flex items-center justify-center rounded-full bg-white press-soft" style={{ color: A.solid, boxShadow: '0 4px 14px -6px rgba(38,38,38,0.28)' }}>
                                <Heart className="w-5 h-5" weight="fill" />
                                {liked.length > 0 && <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 text-white text-[9px] font-bold flex items-center justify-center rounded-full" style={{ background: A.solid }}>{liked.length}</span>}
                            </button>
                            <InsButton variant="solid" accent={AC} onClick={() => void refreshDating()} disabled={datingBusy} className="px-3 py-2 text-[12px]" icon={datingBusy ? <Spinner className="w-4 h-4 animate-spin" weight="bold" /> : <Shuffle className="w-4 h-4" weight="bold" />}>
                                {datingBusy ? '搜寻中' : '换一批'}
                            </InsButton>
                        </div>
                    }
                />
                <TabBar mode={mode} setMode={setMode} />
                {/* 按目的筛选 */}
                <div className="flex items-center gap-2 px-3 pb-2 shrink-0 overflow-x-auto no-scrollbar relative z-10">
                    <Chip active={meetFilter === 'all'} accent={AC} onClick={() => { setMeetFilter('all'); setDatingIdx(0); }}>全部</Chip>
                    {DATING_INTENTS.map(it => (
                        <Chip key={it.key} active={meetFilter === it.key} accent={AC} onClick={() => { setMeetFilter(it.key); setDatingIdx(0); }}>{it.emoji} {it.label}</Chip>
                    ))}
                </div>
                <div className="flex-1 overflow-y-auto no-scrollbar flex flex-col items-center justify-center px-4 py-5 relative z-10">
                    {datingBusy && dating.length === 0 ? (
                        <div className="text-[12.5px] flex items-center gap-2" style={{ color: INK_SOFT }}><Spinner className="w-4 h-4 animate-spin" />正在发现身边的人…</div>
                    ) : !cur ? (
                        <div className="text-center">
                            <div className="text-4xl mb-3">👀</div>
                            <div className="text-[15px] font-bold mb-4" style={{ color: INK }}>{meetFilter === 'all' ? '附近的人都看完啦' : '这类目的的人看完了'}</div>
                            <InsButton variant="solid" accent={AC} onClick={() => meetFilter === 'all' ? void refreshDating() : (setMeetFilter('all'), setDatingIdx(0))} className="px-5 py-2.5 text-[13px]">{meetFilter === 'all' ? '再发现一批' : '看看全部'}</InsButton>
                        </div>
                    ) : (
                        <DatingCard key={cur.id} p={cur} remaining={remaining} onAct={(a) => datingAct(cur, a)} />
                    )}
                </div>

                {/* 我喜欢的 / 匹配 列表 */}
                <InsSheet open={showLiked} title={`我喜欢的 · ${liked.length}`} onClose={() => setShowLiked(false)}>
                    <div className="max-h-[62vh] overflow-y-auto no-scrollbar space-y-2.5">
                        {liked.length === 0 ? <div className="text-center text-[12.5px] py-10" style={{ color: INK_SOFT, fontFamily: 'var(--font-hand)' }}>还没喜欢过谁，去发现几个吧～</div> : liked.map(l => (
                            <div key={l.id} className="flex items-center gap-3 p-2.5 rounded-2xl" style={{ background: '#f7f5f2' }}>
                                {l.avatar ? <img src={l.avatar} className="w-11 h-11 rounded-full object-cover shrink-0" /> : <span className="w-11 h-11 rounded-full flex items-center justify-center text-[22px] shrink-0" style={{ background: A.soft }}>{l.emoji}</span>}
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5"><span className="text-[13.5px] font-bold truncate" style={{ color: INK }}>{l.name}</span>{l.matched && <span className="text-[9px] text-white px-1.5 py-0.5 rounded-full shrink-0" style={{ background: A.solid }}>已匹配</span>}<span className="text-[9px] px-1.5 py-0.5 rounded-full shrink-0" style={{ color: A.ink, background: A.soft }}>{intentMeta(l.intent).label}</span></div>
                                    <div className="text-[11px] truncate mt-0.5" style={{ color: INK_SOFT }}>{l.bio}</div>
                                </div>
                                {l.matched && l.isChar && <InsButton variant="solid" accent={AC} onClick={() => openChatWith(l.charId)} className="shrink-0 px-3 py-1.5 text-[11px]">去聊</InsButton>}
                            </div>
                        ))}
                    </div>
                </InsSheet>

                {/* 打招呼·对方回应 */}
                <InsDialog open={!!greetCard} accent={AC} onClose={() => setGreetCard(null)}
                    actions={greetCard ? <>
                        <InsButton variant="soft" accent="slate" onClick={() => setGreetCard(null)} className="flex-1 py-2.5 text-[12px]">先这样</InsButton>
                        {greetCard.p.isChar
                            ? <InsButton variant="solid" accent={AC} onClick={() => openChatWith(greetCard.p.charId)} className="flex-1 py-2.5 text-[12px]">进「来往」聊</InsButton>
                            : <div className="flex-1 text-center text-[10.5px] self-center" style={{ color: INK_SOFT }}>路人甲，缘分到了再说～</div>}
                    </> : null}>
                    {greetCard && (
                        <div className="text-left">
                            <div className="flex items-center gap-2.5 mb-3">
                                {greetCard.p.avatar ? <img src={greetCard.p.avatar} className="w-11 h-11 rounded-full object-cover" /> : <span className="w-11 h-11 rounded-full flex items-center justify-center text-[24px]" style={{ background: A.soft }}>{greetCard.p.emoji}</span>}
                                <div className="min-w-0">
                                    <div className="text-[14px] font-bold flex items-center gap-1.5" style={{ color: INK }}>{greetCard.p.name}{greetCard.matched && <span className="text-[9px] text-white px-1.5 py-0.5 rounded-full" style={{ background: A.solid }}>🎉 匹配成功</span>}</div>
                                    <div className="text-[10px]" style={{ color: INK_SOFT }}>{intentMeta(greetCard.p.intent).emoji} {intentMeta(greetCard.p.intent).label} · {greetCard.p.distanceKm}km</div>
                                </div>
                            </div>
                            <div className="px-3.5 py-3 text-[13px] leading-relaxed min-h-[52px] flex items-center rounded-2xl" style={{ background: '#f7f5f2', color: INK }}>
                                {greetCard.busy ? <span className="flex items-center gap-1.5" style={{ color: INK_SOFT, fontFamily: 'var(--font-hand)' }}><Spinner className="w-3.5 h-3.5 animate-spin" />{greetCard.p.name} 正在回复…</span> : greetCard.reply}
                            </div>
                        </div>
                    )}
                </InsDialog>
            </InsShell>
        );
    }

    // ── 信息流首页 ──
    return (
        <InsShell accent={AC}>
            <AppHeader
                title="见闻簿"
                sub={posts.length > 0 ? `已贴 ${posts.length} 张卡片` : '一本贴满见闻的簿子'}
                onBack={closeApp}
                right={
                    <div className="flex items-center gap-2">
                        <IconCircle onClick={() => openApp(AppID.XhsStock)} title="素材堆（发帖备图）"><Stack className="w-4 h-4" weight="bold" /></IconCircle>
                        <IconCircle onClick={() => openApp(AppID.XhsFreeRoam)} title="出门转转（让熟人自己去翻）"><Binoculars className="w-4 h-4" weight="bold" /></IconCircle>
                    </div>
                }
            />
            <TabBar mode={mode} setMode={setMode} />

            {/* 工具条：搜索 + 翻新页 + 清空 */}
            <div className="flex items-center gap-2 px-3 pb-2 shrink-0 relative z-10">
                <div className="flex-1 flex items-center gap-2 px-3.5 py-2.5 min-w-0 rounded-full" style={{ background: '#fff', boxShadow: '0 1px 2px rgba(38,38,38,0.04)', border: '1px solid rgba(0,0,0,0.05)' }}>
                    <MagnifyingGlass className="w-4 h-4 shrink-0" weight="bold" style={{ color: INK_SOFT }} />
                    <input
                        value={searchInput}
                        onChange={e => { setSearchInput(e.target.value); setKeyword(e.target.value); }}
                        placeholder="搜见闻 / 找人 / 找标签…"
                        className="flex-1 bg-transparent text-[13px] outline-none min-w-0"
                        style={{ color: INK }}
                    />
                </div>
                <InsButton variant="solid" accent={AC} onClick={() => void refreshFeed()} disabled={generating} className="px-3 py-2.5 text-[12px]" title={`再剪 ${FEED_BATCH_SIZE} 张贴上`}
                    icon={<Shuffle className={`w-4 h-4 ${generating ? 'animate-spin' : ''}`} weight="bold" />}>
                    {generating ? '生成中' : '翻新页'}
                </InsButton>
                <IconCircle onClick={() => setConfirmClear(true)} title="清空整簿"><Broom className="w-4 h-4" weight="bold" /></IconCircle>
            </div>

            {/* 热门话题条 */}
            {topicChips.length > 0 && (
                <div className="flex items-center gap-2 px-3 pb-2 shrink-0 overflow-x-auto no-scrollbar relative z-10">
                    <span className="text-[10px] font-bold shrink-0" style={{ color: INK_SOFT }}>话题</span>
                    {keyword && <Chip active accent={AC} onClick={() => { setKeyword(''); setSearchInput(''); }}>✕ 全部</Chip>}
                    {topicChips.map(t => {
                        const active = keyword.trim().toLowerCase() === t.toLowerCase();
                        return (
                            <Chip key={t} active={active} accent={AC} onClick={() => { const next = active ? '' : t; setKeyword(next); setSearchInput(next); }}>#{t}</Chip>
                        );
                    })}
                </div>
            )}

            <div className="flex-1 overflow-y-auto no-scrollbar px-3 pt-2 pb-10 relative z-10">
                {!loaded ? (
                    <div className="mt-16 text-center text-[12.5px]" style={{ color: INK_SOFT, fontFamily: 'var(--font-hand)' }}>翻箱倒柜中…</div>
                ) : visible.length === 0 && generating ? (
                    <div className="mt-16 text-center text-[12.5px]" style={{ color: INK_SOFT, fontFamily: 'var(--font-hand)' }}>正在剪第一沓（熟人 + 路人）…</div>
                ) : visible.length === 0 ? (
                    <div className="mt-10 mx-2 bg-white p-7 text-center" style={{ borderRadius: 24, boxShadow: '0 18px 40px -28px rgba(38,38,38,0.3)' }}>
                        <div className="text-4xl mb-3">✄</div>
                        <div className="text-[15px] font-extrabold mb-2" style={{ color: INK }}>{keyword ? `没找到「${keyword}」` : '簿子还是空白页'}</div>
                        {!keyword && (
                            <>
                                <div className="text-[12.5px] leading-relaxed mb-4" style={{ color: INK_SOFT }}>
                                    点「翻新页」剪一沓贴上：你认识的人会按性子发，还混着各路路人甲乙。{!apiReady && '记得先去「文具盒」把 API 补上。'}
                                </div>
                                <InsButton variant="gradient" onClick={() => apiReady ? void refreshFeed() : openApp(AppID.Settings)} className="px-6 py-2.5 text-[13px]">
                                    {apiReady ? '剪一沓贴上' : '去文具盒'}
                                </InsButton>
                            </>
                        )}
                    </div>
                ) : (
                    <div className="flex gap-3 items-start">
                        <div className="flex-1 min-w-0">{colA.map(p => <PostCard key={p.id} post={p} onClick={() => setDetailId(p.id)} />)}</div>
                        <div className="flex-1 min-w-0">{colB.map(p => <PostCard key={p.id} post={p} onClick={() => setDetailId(p.id)} />)}</div>
                    </div>
                )}
            </div>

            {/* 清空整簿确认 */}
            <InsDialog open={confirmClear} title="清空整簿？" en="CLEAR ALL" accent={AC} onClose={() => setConfirmClear(false)}
                actions={<>
                    <InsButton variant="soft" accent="slate" onClick={() => setConfirmClear(false)} className="flex-1 py-2.5 text-[13px]">留着</InsButton>
                    <InsButton variant="solid" accent={AC} onClick={() => void clearFeed()} className="flex-1 py-2.5 text-[13px]">全部撕掉</InsButton>
                </>}>
                簿子里这一沓卡片会全部撕掉，没法再找回来。
            </InsDialog>
        </InsShell>
    );
};

export default SocialApp;
