import React, { useEffect, useMemo, useState } from 'react';
import { MagnifyingGlass, Shuffle, Binoculars, Stack, Heart, ArrowLeft, BookmarkSimple, PencilSimpleLine, Scissors, PushPin, Broom } from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import { AppID, XhsFeedPost } from '../types';
import { DB } from '../utils/db';
import { generateFeedBatch, generateAuthorReply, FEED_BATCH_SIZE } from '../utils/xhsFeed';

/**
 * 见闻簿 App —— 本地生成信息流版（黑白拼贴手账皮肤）。
 *
 * 把熟人和路人「见到的、听到的」剪成一张张纸片，贴进一本黑白手账：每次「翻新页」由 LLM
 * 生成一沓（≥10 张）剪贴，混合熟人剪贴（按角色人设发）与路人剪贴（虚构路人），持久化在 IndexedDB。
 * 用户可翻开一张看详情、戳一下（赞）、夹起来（收藏）、写批注（评论，作者会回批）、剪下来（转成自己的剪贴进入信息流）。
 * 「出门转转」（角色自主刷真实小红书，MCP）与「素材堆」（囤图）保留快捷入口。
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

/** 头像：有图用图；没图用昵称首字 + 按昵称稳定取一档墨灰（保持黑白拼贴质感） */
const Avatar: React.FC<{ name: string; src?: string; size?: string }> = ({ name, src, size = 'w-8 h-8' }) => {
    if (src) return <img src={src} className={`${size} object-cover shrink-0 border-2 border-[#2b2933]`} alt="" />;
    const palette = ['bg-[#2b2933]', 'bg-[#46434f]', 'bg-[#605d68]', 'bg-[#7a7782]', 'bg-[#3a3742]', 'bg-[#52505b]', 'bg-[#6b6874]'];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
    return (
        <div className={`${size} ${palette[Math.abs(hash) % palette.length]} text-[#fbfaf7] flex items-center justify-center text-[12px] font-bold shrink-0 select-none border-2 border-[#2b2933]`}>
            {name.slice(0, 1)}
        </div>
    );
};

/** 瀑布流剪贴：纸片 + 墨边 + 硬投影 + 右上角一枚图钉 */
const PostCard: React.FC<{ post: XhsFeedPost; onClick: () => void }> = ({ post, onClick }) => (
    <button onClick={onClick} className="relative w-full text-left overflow-visible bg-[#fbfaf7] border-2 border-[#2b2933] shadow-[3px_3px_0_rgba(43,41,51,0.2)] active:translate-x-[1px] active:translate-y-[1px] transition-transform mb-4 break-inside-avoid">
        <PushPin className="absolute -top-1.5 right-2 z-10 w-4 h-4 text-[#2b2933] rotate-12 drop-shadow-[1px_1px_0_rgba(43,41,51,0.25)] pointer-events-none" weight="fill" />
        {post.coverUrl ? (
            <img src={post.coverUrl} className="w-full object-cover grayscale border-b-2 border-[#2b2933]" referrerPolicy="no-referrer" loading="lazy"
                onError={(e: any) => { e.target.style.display = 'none'; }} />
        ) : (
            <div className="w-full aspect-[3/4] bg-[#f4f2ed] border-b-2 border-dashed border-[#2b2933]/30 flex items-center justify-center p-3">
                <span className="text-[13px] font-bold text-[#8b8996] leading-relaxed line-clamp-6 text-center font-hand">{post.repostOf ? `✄ ${post.title}` : post.body.slice(0, 60)}</span>
            </div>
        )}
        <div className="px-2.5 pt-2 pb-2.5">
            <div className="text-[12px] font-bold text-[#2b2933] leading-snug line-clamp-2">{post.title}</div>
            <div className="flex items-center justify-between mt-1.5 gap-1 pt-1.5 border-t border-dashed border-[#2b2933]/20">
                <span className="inline-flex items-center gap-1 min-w-0 flex-1">
                    <Avatar name={post.author} src={post.authorAvatar} size="w-4 h-4" />
                    <span className={`text-[10px] truncate ${post.authorType === 'character' ? 'text-[#2b2933] font-bold underline decoration-dotted underline-offset-2' : 'text-[#8b8996]'}`}>{post.author}</span>
                </span>
                <span className={`inline-flex items-center gap-0.5 text-[10px] shrink-0 ${post.liked ? 'text-[#2b2933] font-bold' : 'text-[#8b8996]'}`}>
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
        if (!apiReady) { addToast('先去「文具盒」把 API（模型 / 地址）补上', 'error'); return; }
        setGenerating(true);
        try {
            const stock = await DB.getXhsStockImages().catch(() => []);
            const batch = await generateFeedBatch(apiConfig, characters, userProfile, stock);
            await DB.saveXhsFeedPosts(batch);
            setPosts(prev => [...batch, ...prev]);
            addToast(`又剪了 ${batch.length} 张贴上`, 'success');
        } catch (e: any) {
            addToast(`没剪出来：${e?.message || '未知错误'}`, 'error');
        } finally {
            setGenerating(false);
        }
    };

    /** 局部更新一条剪贴（state + 落库） */
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
        // 作者回批（角色按人设 / NPC 按帖子口吻），失败时静默
        if (apiReady && detail.authorType !== 'user') {
            setReplying(true);
            try {
                const authorChar = detail.charId ? characters.find(c => c.id === detail.charId) : undefined;
                const reply = await generateAuthorReply(apiConfig, detail, text, userProfile, authorChar);
                patchPost(detail.id, cur => ({ comments: [...cur.comments, reply] }));
            } catch { /* 回批失败不打扰 */ } finally {
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
            title: `剪贴：${src.title}`.slice(0, 40),
            body: `${forwardNote.trim() ? `${forwardNote.trim()}\n\n` : ''}— 剪自 @${src.author}：${src.body}`.slice(0, 2000),
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

    // ── 剪贴详情页 ──
    if (detail) {
        return (
            <div className="absolute inset-0 flex flex-col bg-[#f4f2ed] animate-fade-in" style={{ paddingTop: 'var(--safe-top)' }}>
                <div className="flex items-center gap-2 px-3 py-2.5 bg-[#fbfaf7] border-b-2 border-[#2b2933] shrink-0">
                    <button onClick={() => setDetailId(null)} className="w-8 h-8 flex items-center justify-center border-2 border-[#2b2933] bg-[#fbfaf7] active:translate-x-[1px] active:translate-y-[1px] transition-transform shrink-0">
                        <ArrowLeft className="w-4 h-4 text-[#2b2933]" weight="bold" />
                    </button>
                    <span className="text-[10px] font-bold text-[#fbfaf7] bg-[#2b2933] px-2.5 py-1 shrink-0 label-mono rotate-2">见闻簿</span>
                    <div className="flex-1" />
                    <Avatar name={detail.author} src={detail.authorAvatar} />
                    <div className="min-w-0 max-w-[55%]">
                        <div className={`text-[13px] font-bold truncate text-right ${detail.authorType === 'character' ? 'text-[#2b2933] underline decoration-dotted underline-offset-2' : 'text-[#2b2933]'}`}>{detail.author}</div>
                        <div className="text-[10px] text-[#8b8996] label-mono text-right">{fmtTime(detail.createdAt)}{detail.authorType === 'character' ? ' · 熟人' : detail.authorType === 'user' ? ' · 我剪的' : ' · 路人'}</div>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto no-scrollbar pb-4">
                    {detail.coverUrl && (
                        <img src={detail.coverUrl} className="w-full object-cover grayscale border-b-2 border-[#2b2933]" referrerPolicy="no-referrer"
                            onError={(e: any) => { e.target.style.display = 'none'; }} />
                    )}
                    <div className="px-4 pt-3">
                        <div className="text-[16px] font-bold text-[#2b2933] leading-snug font-display-italic">{detail.title}</div>
                        <div className="text-[13px] text-[#3a3842] leading-relaxed whitespace-pre-wrap mt-2">{detail.body}</div>
                        {detail.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mt-3">
                                {detail.tags.map(t => (
                                    <button key={t} onClick={() => { setDetailId(null); setSearchInput(t); setKeyword(t); }} className="text-[11px] text-[#2b2933] bg-[#fbfaf7] border border-[#2b2933] px-2 py-0.5">#{t}</button>
                                ))}
                            </div>
                        )}

                        {/* 批注区 */}
                        <div className="text-[12px] font-bold text-[#6b6b6b] mt-5 mb-2 label-mono flex items-center gap-1.5 border-t-2 border-dashed border-[#2b2933]/25 pt-3"><PencilSimpleLine className="w-3.5 h-3.5" weight="bold" />批注 {detail.comments.length}</div>
                        <div className="space-y-3">
                            {detail.comments.map(cm => (
                                <div key={cm.id} className="flex gap-2">
                                    <Avatar name={cm.author} size="w-7 h-7" />
                                    <div className="min-w-0 flex-1">
                                        <div className="text-[11px] text-[#8b8996]">
                                            {cm.author}
                                            {cm.isUser && <span className="ml-1 text-[9px] text-[#fbfaf7] bg-[#2b2933] px-1">我</span>}
                                            {!cm.isUser && cm.author === detail.author && <span className="ml-1 text-[9px] text-[#2b2933] border border-[#2b2933] px-1">笔者</span>}
                                        </div>
                                        <div className="text-[13px] text-[#2b2933] leading-relaxed whitespace-pre-wrap">{cm.content}</div>
                                        <div className="text-[10px] text-[#c4c1b8] mt-0.5">{fmtTime(cm.timestamp)}{cm.likes > 0 ? ` · ${fmtCount(cm.likes)} 戳` : ''}</div>
                                    </div>
                                </div>
                            ))}
                            {replying && <div className="text-[11px] text-[#8b8996] pl-9 font-hand">{detail.author} 正在落笔…</div>}
                            {detail.comments.length === 0 && !replying && <div className="text-[11px] text-[#c4c1b8] font-hand">还没人批注，来写第一笔～</div>}
                        </div>
                    </div>
                </div>

                {/* 底部互动栏：戳 / 夹 / 剪 + 批注输入 */}
                <div className="shrink-0 border-t-2 border-[#2b2933] bg-[#fbfaf7] px-3 py-2 flex items-center gap-2" style={{ paddingBottom: 'calc(var(--safe-bottom, 0px) + 8px)' }}>
                    {commentInput.trim() ? (
                        <>
                            <input
                                value={commentInput}
                                onChange={e => setCommentInput(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') void submitComment(); }}
                                placeholder="写句批注…"
                                className="flex-1 bg-[#f4f2ed] border-2 border-[#2b2933] px-3.5 py-2 text-[13px] outline-none min-w-0 focus:shadow-[2px_2px_0_#2b2933] transition-shadow"
                            />
                            <button onClick={() => void submitComment()} disabled={replying} className="w-9 h-9 flex items-center justify-center bg-[#2b2933] text-[#fbfaf7] active:translate-x-[1px] active:translate-y-[1px] transition-transform shrink-0 disabled:opacity-50">
                                <PushPin className="w-4 h-4" weight="fill" />
                            </button>
                        </>
                    ) : (
                        <>
                            <button onClick={() => toggleLike(detail)} className={`inline-flex items-center gap-1 text-[12px] shrink-0 px-1.5 ${detail.liked ? 'text-[#2b2933] font-bold' : 'text-[#6b6b6b]'}`}>
                                <Heart className="w-5 h-5" weight={detail.liked ? 'fill' : 'regular'} />{fmtCount(detail.likes)}
                            </button>
                            <button onClick={() => toggleFav(detail)} className={`inline-flex items-center gap-1 text-[12px] shrink-0 px-1.5 ${detail.faved ? 'text-[#2b2933] font-bold' : 'text-[#6b6b6b]'}`}>
                                <BookmarkSimple className="w-5 h-5" weight={detail.faved ? 'fill' : 'regular'} />{fmtCount(detail.favs)}
                            </button>
                            <button onClick={() => { setForwardingPost(detail); setForwardNote(''); }} className="inline-flex items-center gap-1 text-[12px] text-[#6b6b6b] shrink-0 px-1.5">
                                <Scissors className="w-5 h-5" weight="regular" />剪下来
                            </button>
                            <input
                                value={commentInput}
                                onChange={e => setCommentInput(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') void submitComment(); }}
                                placeholder="写句批注…"
                                className="flex-1 bg-[#f4f2ed] border-2 border-[#2b2933] px-3.5 py-2 text-[13px] outline-none min-w-0 focus:shadow-[2px_2px_0_#2b2933] transition-shadow"
                            />
                        </>
                    )}
                </div>

                {/* 剪下来弹窗：居中胶带纸片 */}
                {forwardingPost && (
                    <div className="absolute inset-0 z-20 bg-[#2b2933]/40 flex items-center justify-center p-5" onClick={() => setForwardingPost(null)}>
                        <div className="relative w-full max-w-[320px] bg-[#fbfaf7] border-2 border-[#2b2933] shadow-[5px_5px_0_rgba(43,41,51,0.25)] p-4 -rotate-1" onClick={e => e.stopPropagation()}>
                            <span className="absolute -top-3 left-1/2 -translate-x-1/2 w-16 h-5 bg-[#2b2933]/12 border border-[#2b2933]/30 rotate-2 pointer-events-none" />
                            <div className="text-[14px] font-bold text-[#2b2933] mb-2 font-display-italic flex items-center gap-1.5"><Scissors className="w-4 h-4" weight="bold" />剪下来，贴进我的簿子</div>
                            <div className="bg-[#f4f2ed] border-2 border-dashed border-[#2b2933]/40 p-2.5 text-[11px] text-[#6b6b6b] line-clamp-2 mb-2">@{forwardingPost.author}：{forwardingPost.title}</div>
                            <textarea
                                value={forwardNote}
                                onChange={e => setForwardNote(e.target.value)}
                                placeholder="想加一句批注？（可留空）"
                                className="w-full h-20 bg-[#f4f2ed] p-3 text-[13px] resize-none border-2 border-[#2b2933] outline-none focus:shadow-[2px_2px_0_#2b2933] transition-shadow mb-3"
                            />
                            <div className="flex items-center gap-2">
                                <button onClick={() => setForwardingPost(null)} className="px-4 py-2.5 border-2 border-[#2b2933] bg-[#fbfaf7] text-[#2b2933] text-[13px] font-bold label-mono active:translate-x-[1px] active:translate-y-[1px] transition-transform">放回去</button>
                                <button onClick={submitForward} className="flex-1 py-2.5 bg-[#2b2933] text-[#fbfaf7] text-[13px] font-bold label-mono active:translate-x-[1px] active:translate-y-[1px] transition-transform">贴进簿子</button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    // ── 信息流首页 ──
    return (
        <div className="absolute inset-0 flex flex-col bg-[#f4f2ed]" style={{ paddingTop: 'var(--safe-top)' }}>
            {/* 顶栏：返回 + 标题封面 + 素材堆 / 出门转转 */}
            <div className="flex items-center gap-2 px-3 py-2.5 bg-[#fbfaf7] border-b-2 border-[#2b2933] shrink-0">
                <button onClick={closeApp} className="w-8 h-8 flex items-center justify-center border-2 border-[#2b2933] bg-[#fbfaf7] active:translate-x-[1px] active:translate-y-[1px] transition-transform shrink-0">
                    <ArrowLeft className="w-4 h-4 text-[#2b2933]" weight="bold" />
                </button>
                <div className="min-w-0 flex-1 leading-none">
                    <span className="text-[20px] font-black text-[#2b2933] select-none font-display-italic">见闻簿</span>
                    <div className="text-[10px] text-[#8b8996] font-hand mt-0.5">{posts.length > 0 ? `已贴 ${posts.length} 张剪贴` : '一本贴满见闻的手账'}</div>
                </div>
                <button onClick={() => openApp(AppID.XhsStock)} title="素材堆（发帖备图）"
                    className="w-8 h-8 flex items-center justify-center border-2 border-[#2b2933] bg-[#fbfaf7] text-[#2b2933] active:translate-x-[1px] active:translate-y-[1px] transition-transform">
                    <Stack className="w-4 h-4" weight="bold" />
                </button>
                <button onClick={() => openApp(AppID.XhsFreeRoam)} title="出门转转（让熟人自己去翻）"
                    className="w-8 h-8 flex items-center justify-center border-2 border-[#2b2933] bg-[#fbfaf7] text-[#2b2933] active:translate-x-[1px] active:translate-y-[1px] transition-transform">
                    <Binoculars className="w-4 h-4" weight="bold" />
                </button>
            </div>

            {/* 工具条：翻找 + 翻新页 + 撕掉整簿 */}
            <div className="flex items-center gap-2 px-3 py-2 bg-[#fbfaf7] border-b-2 border-[#2b2933] shrink-0">
                <div className="flex-1 flex items-center gap-2 bg-[#f4f2ed] border-2 border-[#2b2933] px-3.5 py-2 min-w-0">
                    <MagnifyingGlass className="w-4 h-4 text-[#2b2933] shrink-0" weight="bold" />
                    <input
                        value={searchInput}
                        onChange={e => { setSearchInput(e.target.value); setKeyword(e.target.value); }}
                        placeholder="翻翻看 / 找人 / 找标签…"
                        className="flex-1 bg-transparent text-[13px] outline-none min-w-0"
                    />
                </div>
                <button
                    onClick={() => void refreshFeed()}
                    disabled={generating}
                    className="inline-flex items-center gap-1 text-[12px] font-bold label-mono text-[#fbfaf7] bg-[#2b2933] px-2.5 py-2 active:translate-x-[1px] active:translate-y-[1px] transition-transform shrink-0 disabled:opacity-50"
                    title={`再剪 ${FEED_BATCH_SIZE} 张贴上`}
                >
                    <Shuffle className={`w-4 h-4 ${generating ? 'animate-spin' : ''}`} weight="bold" />
                    {generating ? '剪贴中' : '翻新页'}
                </button>
                <button onClick={() => void clearFeed()} title="撕掉整簿"
                    className="w-9 h-9 flex items-center justify-center border-2 border-dashed border-[#2b2933]/50 bg-[#fbfaf7] text-[#2b2933] active:translate-x-[1px] active:translate-y-[1px] transition-transform shrink-0">
                    <Broom className="w-4 h-4" weight="bold" />
                </button>
            </div>

            {/* 热门话题条：从簿子里的标签聚出话题，点一下按话题翻找 */}
            {topicChips.length > 0 && (
                <div className="flex items-center gap-1.5 px-3 py-2 bg-[#fbfaf7] border-b-2 border-[#2b2933] shrink-0 overflow-x-auto no-scrollbar">
                    <span className="text-[10px] font-bold text-[#8b8996] label-mono shrink-0 mr-0.5">话题</span>
                    {keyword && (
                        <button onClick={() => { setKeyword(''); setSearchInput(''); }}
                            className="shrink-0 text-[11px] font-bold px-2 py-1 border-2 border-[#2b2933] bg-[#2b2933] text-[#fbfaf7] active:translate-x-[1px] active:translate-y-[1px] transition-transform">
                            ✕ 全部
                        </button>
                    )}
                    {topicChips.map(t => {
                        const active = keyword.trim().toLowerCase() === t.toLowerCase();
                        return (
                            <button key={t}
                                onClick={() => { const next = active ? '' : t; setKeyword(next); setSearchInput(next); }}
                                className={`shrink-0 text-[11px] px-2 py-1 border-2 border-[#2b2933] active:translate-x-[1px] active:translate-y-[1px] transition-transform ${active ? 'bg-[#2b2933] text-[#fbfaf7] font-bold' : 'bg-[#fbfaf7] text-[#2b2933]'}`}>
                                #{t}
                            </button>
                        );
                    })}
                </div>
            )}

            <div className="flex-1 overflow-y-auto no-scrollbar px-3 pt-4 pb-10">
                {!loaded ? (
                    <div className="mt-16 text-center text-[12px] text-[#8b8996] font-hand">翻箱倒柜中…</div>
                ) : visible.length === 0 && generating ? (
                    <div className="mt-16 text-center text-[12px] text-[#8b8996] font-hand">正在剪第一沓（熟人 + 路人）…</div>
                ) : visible.length === 0 ? (
                    <div className="mt-10 mx-2 bg-[#fbfaf7] border-2 border-[#2b2933] shadow-[4px_4px_0_rgba(43,41,51,0.2)] p-6 text-center rotate-1">
                        <div className="text-3xl mb-3">✄</div>
                        <div className="text-[14px] font-bold text-[#2b2933] mb-2 font-display-italic">{keyword ? `翻遍也没找到「${keyword}」` : '簿子还是空白页'}</div>
                        {!keyword && (
                            <>
                                <div className="text-[12px] text-[#6b6b6b] leading-relaxed mb-4">
                                    点「翻新页」剪一沓贴上：你认识的人会按性子发，还混着各路路人甲乙。{!apiReady && '记得先去「文具盒」把 API 补上。'}
                                </div>
                                <button onClick={() => apiReady ? void refreshFeed() : openApp(AppID.Settings)} className="px-5 py-2.5 bg-[#2b2933] text-[#fbfaf7] text-[12px] font-bold label-mono active:translate-x-[1px] active:translate-y-[1px] transition-transform">
                                    {apiReady ? '剪一沓贴上' : '去文具盒'}
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
