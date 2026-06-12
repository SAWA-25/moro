import React, { useEffect, useRef, useState } from 'react';
import { ArrowsClockwise, Camera, CaretLeft } from '@phosphor-icons/react';
import { useOS } from '../../context/OSContext';
import { DB } from '../../utils/db';
import { SocialComment, SocialPost } from '../../types';
import { processImage } from '../../utils/file';
import Modal from '../os/Modal';
import MomentCard from './MomentCard';
import MomentPublish, { MomentPublishData } from './MomentPublish';
import { generateCharacterMoments, generateCommentReplies, generateReactions, ReactionOp } from './momentsGen';
import { MOMENTS_COVER_KEY, newId } from './momentsUtils';

export interface MomentsFeedProps {
    /** 嵌入聊天 App 的「朋友圈」标签页时为 true：不渲染自己的返回按钮/safe-top，让外层容器管理 */
    embedded?: boolean;
    /** 独立 App 模式下返回桌面 */
    onBack?: () => void;
    /**
     * 宿主（ChatHub）的返回键拦截：发布页/评论框等内层页面打开时，
     * 宿主返回键应先关掉它们回到动态流，而不是直接退出整个 App 回桌面。
     * 处理器返回 true 表示这次返回已被消费。
     */
    backHandlerRef?: React.MutableRefObject<(() => boolean) | null>;
}

const COVER_FALLBACK = 'linear-gradient(135deg, #5b7c99 0%, #2c3e50 60%, #1a252f 100%)';

/** 微信式朋友圈：封面头图 + 动态流 + 发布 + 角色互动 */
const MomentsFeed: React.FC<MomentsFeedProps> = ({ embedded, onBack, backHandlerRef }) => {
    const { characters, apiConfig, addToast, userProfile } = useOS();

    const [posts, setPosts] = useState<SocialPost[]>([]);
    const [view, setView] = useState<'feed' | 'publish'>('feed');
    const [repostPrefill, setRepostPrefill] = useState<SocialPost['repostOf']>(null);
    const [cover, setCover] = useState<string>(() => localStorage.getItem(MOMENTS_COVER_KEY) || '');
    const [isRefreshing, setIsRefreshing] = useState(false);
    /** 正在跑互动生成的帖子 id 集合 */
    const [reactingIds, setReactingIds] = useState<Set<string>>(new Set());
    /** 评论输入：目标帖 + 可选的被回复评论 */
    const [commentDraft, setCommentDraft] = useState<{ postId: string; replyTo?: { commentId: string; name: string } } | null>(null);
    const [commentText, setCommentText] = useState('');
    const [sharePost, setSharePost] = useState<SocialPost | null>(null);
    /** 转发选项面板：转发到朋友圈 / 转发给某个角色 */
    const [repostChooser, setRepostChooser] = useState<SocialPost | null>(null);
    const [previewImage, setPreviewImage] = useState<string | null>(null);

    const coverInputRef = useRef<HTMLInputElement>(null);
    const postsRef = useRef<SocialPost[]>(posts);
    postsRef.current = posts;

    // 宿主返回键拦截：内层页面（图片预览/发布页/评论框/转发面板）打开时先关它们，
    // 修复「发布朋友圈页点返回直接退回桌面」的问题
    const overlayStateRef = useRef({ view, previewImage, commentDraft, sharePost, repostChooser });
    overlayStateRef.current = { view, previewImage, commentDraft, sharePost, repostChooser };
    useEffect(() => {
        if (!backHandlerRef) return;
        backHandlerRef.current = () => {
            const s = overlayStateRef.current;
            if (s.previewImage) { setPreviewImage(null); return true; }
            if (s.view === 'publish') { setView('feed'); setRepostPrefill(null); return true; }
            if (s.commentDraft) { setCommentDraft(null); return true; }
            if (s.sharePost) { setSharePost(null); return true; }
            if (s.repostChooser) { setRepostChooser(null); return true; }
            return false;
        };
        return () => { backHandlerRef.current = null; };
    }, [backHandlerRef]);

    useEffect(() => {
        DB.getSocialPosts()
            .then(loaded => setPosts(loaded.sort((a, b) => b.timestamp - a.timestamp)))
            .catch(() => {});
    }, []);

    // --- 持久化辅助 ---

    const sortDesc = (list: SocialPost[]) => [...list].sort((a, b) => b.timestamp - a.timestamp);

    const upsertPosts = (changed: SocialPost[]) => {
        if (changed.length === 0) return;
        const byId = new Map(changed.map(p => [p.id, p]));
        setPosts(prev => {
            const merged = prev.map(p => byId.get(p.id) || p);
            const existing = new Set(prev.map(p => p.id));
            changed.forEach(p => { if (!existing.has(p.id)) merged.push(p); });
            return sortDesc(merged);
        });
        changed.forEach(p => { DB.saveSocialPost(p).catch(console.error); });
    };

    const markReacting = (postId: string, on: boolean) => {
        setReactingIds(prev => {
            const next = new Set(prev);
            if (on) next.add(postId); else next.delete(postId);
            return next;
        });
    };

    /** 把 LLM 互动操作套用到最新 state（增量合并，避免覆盖用户期间的修改） */
    const applyReactionOps = (ops: ReactionOp[]) => {
        if (ops.length === 0) return;
        const current = postsRef.current;
        const touched = new Map<string, SocialPost>();
        const getTarget = (id: string): SocialPost | undefined =>
            touched.get(id) || current.find(p => p.id === id);

        const newPosts: SocialPost[] = [];
        ops.forEach(op => {
            if (op.type === 'repost') { newPosts.push(op.post); return; }
            const target = getTarget(op.postId);
            if (!target) return;
            if (op.type === 'like') {
                const likedBy = target.likedBy || [];
                if (likedBy.some(l => l.id === op.liker.id)) return;
                const nextLiked = [...likedBy, op.liker];
                // 爆款帖的 likes 含热度补值（> 具名列表长度），增量保留
                touched.set(target.id, { ...target, likedBy: nextLiked, likes: Math.max(target.likes + 1, nextLiked.length) });
            } else if (op.type === 'comment') {
                touched.set(target.id, { ...target, comments: [...(target.comments || []), op.comment] });
            }
        });
        upsertPosts([...touched.values(), ...newPosts]);
    };

    // --- 封面 ---

    const handleCoverPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        try {
            const dataUrl = await processImage(file, { maxWidth: 1280 });
            setCover(dataUrl);
            try {
                localStorage.setItem(MOMENTS_COVER_KEY, dataUrl);
            } catch {
                addToast('封面图过大，无法持久保存（本次会话内有效）', 'error');
            }
        } catch (err: any) {
            addToast(err?.message || '图片处理失败', 'error');
        }
    };

    // --- 刷新：角色发新动态 ---

    const handleRefresh = async () => {
        if (isRefreshing) return;
        if (!apiConfig.apiKey) { addToast('请先配置 API Key', 'error'); return; }
        if (characters.length === 0) { addToast('还没有角色，先去创建一个吧', 'info'); return; }
        setIsRefreshing(true);
        try {
            const fresh = await generateCharacterMoments({
                apiConfig, characters, userProfile, feed: postsRef.current,
            });
            if (fresh.length === 0) {
                addToast('这一轮大家都没发朋友圈', 'info');
            } else {
                upsertPosts(fresh);
                addToast(`刷到 ${fresh.length} 条新动态`, 'success');
            }
        } catch (e: any) {
            addToast('刷新失败: ' + (e?.message || '未知错误'), 'error');
        } finally {
            setIsRefreshing(false);
        }
    };

    // --- 发布 ---

    const handlePublish = (data: MomentPublishData) => {
        const post: SocialPost = {
            id: newId('moment'),
            authorName: userProfile.name,
            authorAvatar: userProfile.avatar,
            title: '',
            content: data.content,
            images: data.images,
            likes: 0,
            isCollected: false,
            isLiked: false,
            comments: [],
            timestamp: Date.now(),
            tags: [],
            authorType: 'user',
            likedBy: [],
            repostOf: data.repostOf || null,
            location: data.location,
            visibility: data.visibility,
            mentionedCharIds: data.mentionedCharIds,
        };
        upsertPosts([post]);
        setView('feed');
        setRepostPrefill(null);
        addToast('发表成功', 'success');

        // 公开动态 → 异步角色反应轮
        if (data.visibility === 'public' && apiConfig.apiKey && characters.length > 0) {
            triggerReactions(post);
        }
    };

    const triggerReactions = async (post: SocialPost) => {
        markReacting(post.id, true);
        try {
            const ops = await generateReactions({
                apiConfig, characters, userProfile, post, feed: postsRef.current,
            });
            applyReactionOps(ops);
        } catch (e: any) {
            addToast('角色互动生成失败: ' + (e?.message || '未知错误'), 'error');
        } finally {
            markReacting(post.id, false);
        }
    };

    // --- 点赞 / 评论 / 删除 ---

    const handleToggleLike = (post: SocialPost) => {
        const likedBy = post.likedBy || [];
        const removing = likedBy.some(l => l.id === 'user');
        const next = removing
            ? likedBy.filter(l => l.id !== 'user')
            : [...likedBy, { id: 'user', name: userProfile.name }];
        // 爆款帖的 likes 含热度补值（> 具名列表长度），按增量调整而不是直接重置
        const likes = Math.max(post.likes + (removing ? -1 : 1), next.length);
        upsertPosts([{ ...post, likedBy: next, likes }]);
    };

    const handleSendComment = () => {
        if (!commentDraft || !commentText.trim()) return;
        const post = postsRef.current.find(p => p.id === commentDraft.postId);
        if (!post) { setCommentDraft(null); return; }

        const comment: SocialComment = {
            id: newId('cmt'),
            authorName: userProfile.name,
            authorAvatar: userProfile.avatar,
            content: commentText.trim(),
            likes: 0,
            isCharacter: false,
            authorType: 'user',
            replyTo: commentDraft.replyTo,
        };
        const updated = { ...post, comments: [...(post.comments || []), comment] };
        upsertPosts([updated]);
        setCommentText('');
        setCommentDraft(null);

        // 异步：角色回应用户的评论
        if (updated.visibility !== 'private' && apiConfig.apiKey && characters.length > 0) {
            (async () => {
                markReacting(updated.id, true);
                try {
                    const replies = await generateCommentReplies({
                        apiConfig, characters, userProfile, post: updated, userComment: comment,
                    });
                    if (replies.length > 0) {
                        applyReactionOps(replies.map(r => ({ type: 'comment' as const, postId: updated.id, comment: r })));
                        addToast(`收到 ${replies.length} 条新回复`, 'info');
                    }
                } catch (e) {
                    // 静默失败，不打断用户
                } finally {
                    markReacting(updated.id, false);
                }
            })();
        }
    };

    const handleDeleteComment = (post: SocialPost, comment: SocialComment) => {
        upsertPosts([{ ...post, comments: (post.comments || []).filter(c => c.id !== comment.id) }]);
    };

    const handleDeletePost = (post: SocialPost) => {
        setPosts(prev => prev.filter(p => p.id !== post.id));
        DB.deleteSocialPost(post.id).catch(console.error);
        addToast('动态已删除', 'success');
    };

    // --- 转发 / 分享到聊天 ---

    // 点「转发」弹出选项：转发到朋友圈，或直接转发给某个角色（出现角色选项）
    const handleRepost = (post: SocialPost) => {
        setRepostChooser(post);
    };

    const handleRepostToMoments = (post: SocialPost) => {
        // 转发已是转发帖时，指向最初的原帖（与微信一致）
        const origin = post.repostOf || {
            postId: post.id,
            authorName: post.authorName,
            content: (post.content || post.title || '').trim(),
            images: (post.images || []).filter(s => s.startsWith('data:image') || /^https?:\/\//.test(s)),
        };
        setRepostChooser(null);
        setRepostPrefill(origin);
        setView('publish');
    };

    const sendPostToChat = async (charId: string, post: SocialPost): Promise<boolean> => {
        try {
            await DB.saveMessage({
                charId,
                role: 'user',
                type: 'social_card',
                content: '[分享帖子]',
                metadata: { post },
            });
            return true;
        } catch (e) {
            return false;
        }
    };

    const handleRepostToChar = async (charId: string) => {
        if (!repostChooser) return;
        const ok = await sendPostToChat(charId, repostChooser);
        setRepostChooser(null);
        addToast(ok ? `已转发给 ${characters.find(c => c.id === charId)?.name || '角色'}` : '转发失败', ok ? 'success' : 'error');
    };

    const handleShareToChat = async (charId: string) => {
        if (!sharePost) return;
        const ok = await sendPostToChat(charId, sharePost);
        setSharePost(null);
        addToast(ok ? '已分享到聊天' : '分享失败', ok ? 'success' : 'error');
    };

    // --- 渲染 ---

    const draftPost = commentDraft ? posts.find(p => p.id === commentDraft.postId) : null;

    return (
        <div className="h-full w-full flex flex-col relative overflow-hidden font-sans text-slate-900" style={{ background: 'linear-gradient(165deg, #f4f2ed 0%, #eee9e1 100%)' }}>
            {/* 主滚动区 */}
            <div className="flex-1 overflow-y-auto no-scrollbar">
                {/* 封面头图 */}
                <div className="relative h-64 w-full" style={cover ? undefined : { background: COVER_FALLBACK }}>
                    {cover && <img src={cover} className="absolute inset-0 w-full h-full object-cover" />}
                    <div
                        className="absolute inset-0 cursor-pointer"
                        onClick={() => coverInputRef.current?.click()}
                        title="更换封面"
                    />
                    <input ref={coverInputRef} type="file" accept="image/*" className="hidden" onChange={handleCoverPick} />

                    {/* 顶部按钮 */}
                    <div
                        className="absolute top-0 left-0 right-0 flex items-center justify-between px-3"
                        style={{ paddingTop: embedded ? '10px' : 'max(12px, env(safe-area-inset-top))' }}
                    >
                        {!embedded && onBack ? (
                            <button
                                onClick={(e) => { e.stopPropagation(); onBack(); }}
                                className="w-9 h-9 rounded-full bg-black/20 backdrop-blur-md flex items-center justify-center text-white active:scale-90 transition-transform"
                            >
                                <CaretLeft size={18} weight="bold" />
                            </button>
                        ) : <span />}
                        <div className="flex items-center gap-2">
                            <button
                                onClick={(e) => { e.stopPropagation(); handleRefresh(); }}
                                className="w-9 h-9 rounded-full bg-black/20 backdrop-blur-md flex items-center justify-center text-white active:scale-90 transition-transform"
                                title="刷新动态"
                            >
                                <ArrowsClockwise size={18} weight="bold" className={isRefreshing ? 'animate-spin' : ''} />
                            </button>
                            <button
                                onClick={(e) => { e.stopPropagation(); setRepostPrefill(null); setView('publish'); }}
                                className="w-9 h-9 rounded-full bg-black/20 backdrop-blur-md flex items-center justify-center text-white active:scale-90 transition-transform"
                                title="发表动态"
                            >
                                <Camera size={18} weight="bold" />
                            </button>
                        </div>
                    </div>

                    {/* 右下角：昵称 + 头像（压在封面下沿） */}
                    <div className="absolute -bottom-7 right-4 flex items-start gap-3 pointer-events-none">
                        <span className="text-white font-bold text-base drop-shadow-md mt-2 max-w-[40vw] truncate">{userProfile.name}</span>
                        <img src={userProfile.avatar} className="w-16 h-16 rounded-xl object-cover border-2 border-white shadow-md bg-slate-200" />
                    </div>
                </div>

                {/* 封面下留白（给头像让位） */}
                <div className="h-12" />

                {/* 刷新中提示条 */}
                {isRefreshing && (
                    <div className="flex items-center justify-center gap-2 py-2 text-xs text-slate-400">
                        <span className="w-3.5 h-3.5 border-2 border-slate-200 border-t-slate-700 rounded-full animate-spin" />
                        正在收集新的瞬间…
                    </div>
                )}

                {/* 动态流（纸卡拼贴流） */}
                <div className="pb-28">
                    {posts.length === 0 && !isRefreshing && (
                        <div className="flex flex-col items-center justify-center py-24 text-slate-300 gap-3">
                            <Camera size={44} className="opacity-40" />
                            <span className="text-xs">这里还空着——点右上角贴一条瞬间，或刷新看看大家在干嘛</span>
                        </div>
                    )}
                    {posts.map(post => (
                        <MomentCard
                            key={post.id}
                            post={post}
                            userName={userProfile.name}
                            isReacting={reactingIds.has(post.id)}
                            onToggleLike={handleToggleLike}
                            onComment={(p, replyTo) => { setCommentDraft({ postId: p.id, replyTo }); setCommentText(''); }}
                            onRepost={handleRepost}
                            onShareToChat={(p) => setSharePost(p)}
                            onDeletePost={handleDeletePost}
                            onDeleteComment={handleDeleteComment}
                            onPreviewImage={setPreviewImage}
                        />
                    ))}
                </div>
            </div>

            {/* 评论输入条 */}
            {commentDraft && (
                <>
                    <div className="absolute inset-0 z-30" onClick={() => setCommentDraft(null)} />
                    <div className="absolute bottom-0 left-0 right-0 z-40 bg-white border-t border-slate-100 px-3 py-2.5 flex items-center gap-2 shadow-[0_-4px_20px_rgba(0,0,0,0.06)]" style={{ paddingBottom: 'max(10px, env(safe-area-inset-bottom))' }}>
                        <input
                            autoFocus
                            value={commentText}
                            onChange={e => setCommentText(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleSendComment()}
                            placeholder={commentDraft.replyTo ? `回 ${commentDraft.replyTo.name}：` : `给 ${draftPost?.authorName || ''} 留言：`}
                            className="flex-1 bg-slate-100 rounded-full px-4 py-2.5 text-sm outline-none text-slate-800 placeholder:text-slate-400"
                        />
                        <button
                            onClick={handleSendComment}
                            disabled={!commentText.trim()}
                            className={`px-4 py-2 rounded-full text-sm font-bold transition-all ${commentText.trim() ? 'bg-slate-900 text-white shadow-lg shadow-slate-200 active:scale-95' : 'bg-slate-100 text-slate-300'}`}
                        >
                            贴上
                        </button>
                    </div>
                </>
            )}

            {/* 发布页 */}
            {view === 'publish' && (
                <MomentPublish
                    characters={characters}
                    initialRepost={repostPrefill || undefined}
                    onCancel={() => { setView('feed'); setRepostPrefill(null); }}
                    onPublish={handlePublish}
                    addToast={addToast}
                />
            )}

            {/* 转贴选项：转贴到此刻 / 递给角色 */}
            <Modal isOpen={!!repostChooser} title="转贴" onClose={() => setRepostChooser(null)}>
                <button
                    onClick={() => repostChooser && handleRepostToMoments(repostChooser)}
                    className="w-full py-3 mb-3 rounded-2xl bg-slate-900 text-white text-sm font-bold shadow-lg shadow-slate-200 active:scale-95 transition-transform"
                >
                    转贴到「此刻」
                </button>
                <p className="text-[11px] text-slate-400 mb-2">或直接递给角色（对方会在聊天里收到这条动态）：</p>
                {characters.length === 0 ? (
                    <div className="text-center text-xs text-slate-300 py-6">还没有可转发的角色</div>
                ) : (
                    <div className="grid grid-cols-4 gap-4 p-2">
                        {characters.map(c => (
                            <button key={c.id} onClick={() => handleRepostToChar(c.id)} className="flex flex-col items-center gap-2 group">
                                <img src={c.avatar} className="w-12 h-12 rounded-full object-cover border border-slate-100 group-active:scale-90 transition-transform" />
                                <span className="text-[10px] text-slate-600 truncate w-full text-center">{c.name}</span>
                            </button>
                        ))}
                    </div>
                )}
            </Modal>

            {/* 分享到聊天 */}
            <Modal isOpen={!!sharePost} title="分享到聊天" onClose={() => setSharePost(null)}>
                {characters.length === 0 ? (
                    <div className="text-center text-xs text-slate-300 py-6">还没有可分享的角色</div>
                ) : (
                    <div className="grid grid-cols-4 gap-4 p-2">
                        {characters.map(c => (
                            <button key={c.id} onClick={() => handleShareToChat(c.id)} className="flex flex-col items-center gap-2 group">
                                <img src={c.avatar} className="w-12 h-12 rounded-full object-cover border border-slate-100 group-active:scale-90 transition-transform" />
                                <span className="text-[10px] text-slate-600 truncate w-full text-center">{c.name}</span>
                            </button>
                        ))}
                    </div>
                )}
            </Modal>

            {/* 图片预览 */}
            {previewImage && (
                <div
                    className="absolute inset-0 z-[80] bg-black flex items-center justify-center animate-fade-in"
                    onClick={() => setPreviewImage(null)}
                >
                    <img src={previewImage} className="max-w-full max-h-full object-contain" />
                </div>
            )}
        </div>
    );
};

export default MomentsFeed;
