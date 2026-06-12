import React, { useEffect, useMemo, useState } from 'react';
import { MagnifyingGlass, ArrowClockwise, Compass, Camera, Heart, CaretLeft, Star, ChatCircle, ShareFat, PaperPlaneRight, Trash } from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import { AppID, XhsFeedPost } from '../types';
import { DB } from '../utils/db';
import { generateFeedBatch, generateAuthorReply, FEED_BATCH_SIZE } from '../utils/xhsFeed';

/**
 * 小红书 App —— 本地生成信息流版。
 *
 * 不再是「查看角色」/ 依赖 MCP 的真实小红书：每次刷新由 LLM 生成一批（≥10 条）帖子，
 * 混合角色帖（按角色人设发）与 NPC 帖（虚构普通小红薯），持久化在 IndexedDB。
 * 用户可点开帖子查看详情、点赞、收藏、评论（作者会回评）、转发（转成自己的帖子进入信息流）。
 * 「自由活动」（角色自主刷真实小红书，MCP）与「图库」保留快捷入口。
 */

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

/** 头像：有图用图；没图用昵称首字 + 按昵称稳定取色 */
const Avatar: React.FC<{ name: string; src?: string; size?: string }> = ({ name, src, size = 'w-8 h-8' }) => {
    if (src) return <img src={src} className={`${size} rounded-full object-cover shrink-0`} alt="" />;
    const palette = ['bg-rose-400', 'bg-orange-400', 'bg-amber-400', 'bg-emerald-400', 'bg-sky-400', 'bg-violet-400', 'bg-pink-400'];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
    return (
        <div className={`${size} rounded-full ${palette[Math.abs(hash) % palette.length]} text-white flex items-center justify-center text-[12px] font-bold shrink-0 select-none`}>
            {name.slice(0, 1)}
        </div>
    );
};

/** 瀑布流卡片 */
const PostCard: React.FC<{ post: XhsFeedPost; onClick: () => void }> = ({ post, onClick }) => (
    <button onClick={onClick} className="w-full text-left rounded-xl overflow-hidden bg-white shadow-sm border border-slate-100 active:scale-[0.98] transition-transform mb-3 break-inside-avoid">
        {post.coverUrl ? (
            <img src={post.coverUrl} className="w-full object-cover" referrerPolicy="no-referrer" loading="lazy"
                onError={(e: any) => { e.target.style.display = 'none'; }} />
        ) : (
            <div className="w-full aspect-[3/4] bg-gradient-to-br from-red-50 to-rose-100 flex items-center justify-center p-3">
                <span className="text-[13px] font-bold text-rose-300 leading-relaxed line-clamp-6 text-center">{post.repostOf ? `🔁 ${post.title}` : post.body.slice(0, 60)}</span>
            </div>
        )}
        <div className="px-2.5 pt-2 pb-2.5">
            <div className="text-[12px] font-bold text-slate-800 leading-snug line-clamp-2">{post.title}</div>
            <div className="flex items-center justify-between mt-1.5 gap-1">
                <span className="inline-flex items-center gap-1 min-w-0 flex-1">
                    <Avatar name={post.author} src={post.authorAvatar} size="w-4 h-4" />
                    <span className={`text-[10px] truncate ${post.authorType === 'character' ? 'text-red-400 font-bold' : 'text-slate-400'}`}>{post.author}</span>
                </span>
                <span className={`inline-flex items-center gap-0.5 text-[10px] shrink-0 ${post.liked ? 'text-red-500' : 'text-slate-400'}`}>
                    <Heart className="w-3 h-3" weight={post.liked ? 'fill' : 'regular'} />{fmtCount(post.likes)}
                </span>
            </div>
        </div>
    </button>
);

const SocialApp: React.FC = () => {
    const { closeApp, openApp, addToast, apiConfig, characters, userProfile } = useOS();
    const apiReady = !!apiConfig?.baseUrl && !!apiConfig?.model;

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

    const detail = useMemo(() => posts.find(p => p.id === detailId) || null, [posts, detailId]);

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
        if (!apiReady) { addToast('请先在设置里配置 API（模型 / 地址）', 'error'); return; }
        setGenerating(true);
        try {
            const stock = await DB.getXhsStockImages().catch(() => []);
            const batch = await generateFeedBatch(apiConfig, characters, userProfile, stock);
            await DB.saveXhsFeedPosts(batch);
            setPosts(prev => [...batch, ...prev]);
            addToast(`刷出 ${batch.length} 条新帖子`, 'success');
        } catch (e: any) {
            addToast(`刷新失败：${e?.message || '未知错误'}`, 'error');
        } finally {
            setGenerating(false);
        }
    };

    /** 局部更新一条帖子（state + 落库） */
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
        // 作者回评（角色按人设 / NPC 按帖子口吻），失败时静默
        if (apiReady && detail.authorType !== 'user') {
            setReplying(true);
            try {
                const authorChar = detail.charId ? characters.find(c => c.id === detail.charId) : undefined;
                const reply = await generateAuthorReply(apiConfig, detail, text, userProfile, authorChar);
                patchPost(detail.id, cur => ({ comments: [...cur.comments, reply] }));
            } catch { /* 回评失败不打扰 */ } finally {
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
            title: `转发：${src.title}`.slice(0, 40),
            body: `${forwardNote.trim() ? `${forwardNote.trim()}\n\n` : ''}// @${src.author}：${src.body}`.slice(0, 2000),
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
        addToast('已转发到信息流', 'success');
    };

    const clearFeed = async () => {
        await DB.clearXhsFeedPosts().catch(() => undefined);
        setPosts([]);
        addToast('信息流已清空', 'info');
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

    const [colA, colB] = useMemo(() => {
        const a: XhsFeedPost[] = []; const b: XhsFeedPost[] = [];
        visible.forEach((p, i) => (i % 2 === 0 ? a : b).push(p));
        return [a, b];
    }, [visible]);

    // ── 帖子详情页 ──
    if (detail) {
        return (
            <div className="absolute inset-0 flex flex-col bg-white animate-fade-in" style={{ paddingTop: 'var(--safe-top)' }}>
                <div className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-100 shrink-0">
                    <button onClick={() => setDetailId(null)} className="p-1.5 -ml-1 rounded-full active:bg-slate-100">
                        <CaretLeft className="w-5 h-5 text-slate-600" weight="bold" />
                    </button>
                    <Avatar name={detail.author} src={detail.authorAvatar} />
                    <div className="min-w-0 flex-1">
                        <div className={`text-[13px] font-bold truncate ${detail.authorType === 'character' ? 'text-red-500' : 'text-slate-700'}`}>{detail.author}</div>
                        <div className="text-[10px] text-slate-400">{fmtTime(detail.createdAt)}{detail.authorType === 'character' ? ' · 你认识的人' : detail.authorType === 'user' ? ' · 我的转发' : ''}</div>
                    </div>
                    <span className="text-[10px] font-bold text-red-400 border border-red-200 rounded-full px-2.5 py-1 shrink-0">拾光集</span>
                </div>

                <div className="flex-1 overflow-y-auto no-scrollbar pb-4">
                    {detail.coverUrl && (
                        <img src={detail.coverUrl} className="w-full object-cover" referrerPolicy="no-referrer"
                            onError={(e: any) => { e.target.style.display = 'none'; }} />
                    )}
                    <div className="px-4 pt-3">
                        <div className="text-[16px] font-bold text-slate-800 leading-snug">{detail.title}</div>
                        <div className="text-[13px] text-slate-600 leading-relaxed whitespace-pre-wrap mt-2">{detail.body}</div>
                        {detail.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mt-3">
                                {detail.tags.map(t => (
                                    <button key={t} onClick={() => { setDetailId(null); setSearchInput(t); setKeyword(t); }} className="text-[11px] text-sky-600 bg-sky-50 rounded-full px-2 py-0.5">#{t}</button>
                                ))}
                            </div>
                        )}

                        {/* 评论区 */}
                        <div className="text-[12px] font-bold text-slate-500 mt-5 mb-2">共 {detail.comments.length} 条评论</div>
                        <div className="space-y-3">
                            {detail.comments.map(cm => (
                                <div key={cm.id} className="flex gap-2">
                                    <Avatar name={cm.author} size="w-7 h-7" />
                                    <div className="min-w-0 flex-1">
                                        <div className="text-[11px] text-slate-400">
                                            {cm.author}
                                            {cm.isUser && <span className="ml-1 text-[9px] text-white bg-red-400 rounded px-1">我</span>}
                                            {!cm.isUser && cm.author === detail.author && <span className="ml-1 text-[9px] text-red-400 border border-red-200 rounded px-1">作者</span>}
                                        </div>
                                        <div className="text-[13px] text-slate-700 leading-relaxed whitespace-pre-wrap">{cm.content}</div>
                                        <div className="text-[10px] text-slate-300 mt-0.5">{fmtTime(cm.timestamp)}{cm.likes > 0 ? ` · ${fmtCount(cm.likes)} 赞` : ''}</div>
                                    </div>
                                </div>
                            ))}
                            {replying && <div className="text-[11px] text-slate-400 pl-9">{detail.author} 正在回复…</div>}
                            {detail.comments.length === 0 && !replying && <div className="text-[11px] text-slate-300">还没有评论，抢首评～</div>}
                        </div>
                    </div>
                </div>

                {/* 底部互动栏 */}
                <div className="shrink-0 border-t border-slate-100 px-3 py-2 flex items-center gap-2" style={{ paddingBottom: 'calc(var(--safe-bottom, 0px) + 8px)' }}>
                    <input
                        value={commentInput}
                        onChange={e => setCommentInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') void submitComment(); }}
                        placeholder="说点什么…"
                        className="flex-1 bg-slate-100 rounded-full px-3.5 py-2 text-[13px] outline-none min-w-0"
                    />
                    {commentInput.trim() ? (
                        <button onClick={() => void submitComment()} disabled={replying} className="p-2 rounded-full bg-red-500 text-white active:scale-95 transition-transform shrink-0 disabled:opacity-50">
                            <PaperPlaneRight className="w-4 h-4" weight="fill" />
                        </button>
                    ) : (
                        <>
                            <button onClick={() => toggleLike(detail)} className={`inline-flex items-center gap-1 text-[12px] shrink-0 px-1.5 ${detail.liked ? 'text-red-500' : 'text-slate-500'}`}>
                                <Heart className="w-5 h-5" weight={detail.liked ? 'fill' : 'regular'} />{fmtCount(detail.likes)}
                            </button>
                            <button onClick={() => toggleFav(detail)} className={`inline-flex items-center gap-1 text-[12px] shrink-0 px-1.5 ${detail.faved ? 'text-amber-500' : 'text-slate-500'}`}>
                                <Star className="w-5 h-5" weight={detail.faved ? 'fill' : 'regular'} />{fmtCount(detail.favs)}
                            </button>
                            <button onClick={() => { setForwardingPost(detail); setForwardNote(''); }} className="inline-flex items-center gap-1 text-[12px] text-slate-500 shrink-0 px-1.5">
                                <ShareFat className="w-5 h-5" weight="regular" />转发
                            </button>
                        </>
                    )}
                </div>

                {/* 转发弹窗 */}
                {forwardingPost && (
                    <div className="absolute inset-0 z-20 bg-black/40 flex items-end" onClick={() => setForwardingPost(null)}>
                        <div className="w-full bg-white rounded-t-2xl p-4" style={{ paddingBottom: 'calc(var(--safe-bottom, 0px) + 16px)' }} onClick={e => e.stopPropagation()}>
                            <div className="text-[14px] font-bold text-slate-700 mb-2">转发到我的信息流</div>
                            <div className="bg-slate-50 rounded-xl p-2.5 text-[11px] text-slate-500 line-clamp-2 mb-2">@{forwardingPost.author}：{forwardingPost.title}</div>
                            <textarea
                                value={forwardNote}
                                onChange={e => setForwardNote(e.target.value)}
                                placeholder="说说你的看法…（可留空）"
                                className="w-full h-20 bg-slate-50 rounded-xl p-3 text-[13px] resize-none border border-slate-200 outline-none focus:border-red-300 mb-3"
                            />
                            <button onClick={submitForward} className="w-full py-2.5 rounded-full bg-red-500 text-white text-[13px] font-bold active:scale-95 transition-transform">转发</button>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    // ── 信息流首页 ──
    return (
        <div className="absolute inset-0 flex flex-col bg-[#f7f7f7]" style={{ paddingTop: 'var(--safe-top)' }}>
            {/* 顶栏：返回 + 标题 + 自由活动/图库快捷入口 + 清空 */}
            <div className="flex items-center gap-2 px-3 py-2.5 bg-white border-b border-slate-100 shrink-0">
                <button onClick={closeApp} className="p-1.5 -ml-1 rounded-full active:bg-slate-100">
                    <CaretLeft className="w-5 h-5 text-slate-600" weight="bold" />
                </button>
                <span className="text-[16px] font-black text-red-500 select-none">拾光集</span>
                <div className="flex-1" />
                <button onClick={() => openApp(AppID.XhsFreeRoam)} title="自由活动（角色自主刷小红书）"
                    className="p-2 rounded-full active:bg-slate-100 text-slate-500">
                    <Compass className="w-5 h-5" weight="bold" />
                </button>
                <button onClick={() => openApp(AppID.XhsStock)} title="图库（发贴囤图）"
                    className="p-2 rounded-full active:bg-slate-100 text-slate-500">
                    <Camera className="w-5 h-5" weight="bold" />
                </button>
                <button onClick={() => void clearFeed()} title="清空信息流"
                    className="p-2 rounded-full active:bg-slate-100 text-slate-400">
                    <Trash className="w-5 h-5" weight="bold" />
                </button>
            </div>

            {/* 搜索栏 + 刷新 */}
            <div className="flex items-center gap-2 px-3 py-2 bg-white shrink-0">
                <div className="flex-1 flex items-center gap-2 bg-slate-100 rounded-full px-3.5 py-2">
                    <MagnifyingGlass className="w-4 h-4 text-slate-400 shrink-0" weight="bold" />
                    <input
                        value={searchInput}
                        onChange={e => { setSearchInput(e.target.value); setKeyword(e.target.value); }}
                        placeholder="搜索帖子 / 作者 / 标签…"
                        className="flex-1 bg-transparent text-[13px] outline-none min-w-0"
                    />
                </div>
                <button
                    onClick={() => void refreshFeed()}
                    disabled={generating}
                    className="inline-flex items-center gap-1 text-[12px] font-bold text-red-500 px-2.5 py-1.5 rounded-full border border-red-200 active:scale-95 transition-transform shrink-0 disabled:opacity-50"
                    title={`生成 ${FEED_BATCH_SIZE} 条新帖`}
                >
                    <ArrowClockwise className={`w-4 h-4 ${generating ? 'animate-spin' : ''}`} weight="bold" />
                    {generating ? '生成中' : '刷新'}
                </button>
            </div>

            <div className="flex-1 overflow-y-auto no-scrollbar px-3 pt-3 pb-10">
                {!loaded ? (
                    <div className="mt-16 text-center text-[12px] text-slate-400">加载中…</div>
                ) : visible.length === 0 && generating ? (
                    <div className="mt-16 text-center text-[12px] text-slate-400">正在生成第一批帖子（角色 + 路人小红薯）…</div>
                ) : visible.length === 0 ? (
                    <div className="mt-10 mx-2 rounded-2xl bg-white border border-slate-100 shadow-sm p-6 text-center">
                        <div className="text-3xl mb-3">📕</div>
                        <div className="text-[14px] font-bold text-slate-700 mb-2">{keyword ? `没有匹配「${keyword}」的帖子` : '信息流还是空的'}</div>
                        {!keyword && (
                            <>
                                <div className="text-[12px] text-slate-400 leading-relaxed mb-4">
                                    点「刷新」生成一批帖子：你的角色们会按人设发帖，还有各路虚构小红薯。{!apiReady && '需要先在设置里配置 API。'}
                                </div>
                                <button onClick={() => apiReady ? void refreshFeed() : openApp(AppID.Settings)} className="px-5 py-2.5 rounded-full bg-red-500 text-white text-[12px] font-bold active:scale-95 transition-transform">
                                    {apiReady ? '生成帖子' : '去设置'}
                                </button>
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
        </div>
    );
};

export default SocialApp;
