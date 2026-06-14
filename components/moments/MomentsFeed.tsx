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
import { resolveAuxApi } from '../../utils/auxApi';

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

/** 「此刻」动态簿（原创手帐拼贴风）：纸面页眉（拍立得封面 + 用户名片 + 贴纸按钮）+ 纸卡动态流 + 发布 + 角色互动 */
const MomentsFeed: React.FC<MomentsFeedProps> = ({ embedded, onBack, backHandlerRef }) => {
    const { characters, apiConfig, auxApiConfig, addToast, userProfile } = useOS();
    // 朋友圈生成/评论/互动是「聊天以外的辅助任务」→ 走副 API（未配置则回退主 API）。
    // 用 {...apiConfig, ...aux} 保留 APIConfig 形状，只替换 baseUrl/apiKey/model 三件套。
    const genApi = { ...apiConfig, ...resolveAuxApi(auxApiConfig, apiConfig) };

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
        if (!genApi.apiKey) { addToast('请先配置 API Key', 'error'); return; }
        if (characters.length === 0) { addToast('还没有角色，先去创建一个吧', 'info'); return; }
        setIsRefreshing(true);
        try {
            const fresh = await generateCharacterMoments({
                apiConfig: genApi, characters, userProfile, feed: postsRef.current,
            });
            if (fresh.length === 0) {
                addToast('这一轮大家都没贴新瞬间', 'info');
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
        addToast('贴出去了', 'success');

        // 公开动态 → 异步角色反应轮
        if (data.visibility === 'public' && genApi.apiKey && characters.length > 0) {
            triggerReactions(post);
        }
    };

    const triggerReactions = async (post: SocialPost) => {
        markReacting(post.id, true);
        try {
            const ops = await generateReactions({
                apiConfig: genApi, characters, userProfile, post, feed: postsRef.current,
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
        if (updated.visibility !== 'private' && genApi.apiKey && characters.length > 0) {
            (async () => {
                markReacting(updated.id, true);
                try {
                    const replies = await generateCommentReplies({
                        apiConfig: genApi, characters, userProfile, post: updated, userComment: comment,
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
        // 转贴已是转贴的帖子时，链条收敛到最初的原帖，避免套娃嵌套
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
                content: '[转发的此刻]',
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
        <div
            className="h-full w-full flex flex-col relative overflow-hidden font-sans text-slate-900 scrap-panel"
            style={{
                background: 'linear-gradient(165deg, #f4f2ed 0%, #eee9e1 100%)',
                paddingTop: embedded ? '0px' : 'max(8px, var(--safe-top))',
            }}
        >
            {/* 独立模式顶栏：返回 + 页签字标 */}
            {!embedded && (
                <div className="relative flex items-center justify-center px-2 py-2 shrink-0">
                    {onBack && (
                        <button onClick={onBack} className="absolute left-2 p-2 active:opacity-50" aria-label="返回">
                            <CaretLeft size={22} weight="bold" className="text-slate-700" />
                        </button>
                    )}
                    <span className="text-[12px] font-mono font-bold tracking-[0.35em] uppercase text-slate-500">此刻</span>
                </div>
            )}

            {/* 主滚动区 */}
            <div className="flex-1 overflow-y-auto no-scrollbar">
                {/* 页眉：纸面名片 + 拍立得封面 + 贴纸按钮行 */}
                <div className="px-3 pt-3">
                    <div className="relative bg-white rounded-[1.8rem] border border-slate-100 shadow-[0_18px_36px_-24px_rgba(50,48,60,0.45)] px-5 pt-6 pb-5">
                        {/* 和纸胶带：压住页眉卡上缘 */}
                        <span
                            className="absolute -top-2 left-9 w-[72px] h-5 -rotate-[2.5deg] pointer-events-none"
                            style={{
                                background: 'linear-gradient(100deg, rgba(255,255,255,0.6), rgba(243,240,233,0.45))',
                                boxShadow: '0 2px 6px rgba(50,48,60,0.14)',
                                borderLeft: '1px dashed rgba(160,156,146,0.45)',
                                borderRight: '1px dashed rgba(160,156,146,0.45)',
                            }}
                        />

                        <div className="flex items-start gap-3">
                            {/* 左：字标 + 用户名片 */}
                            <div className="flex-1 min-w-0">
                                <div className="text-[10px] font-mono font-bold tracking-[0.35em] uppercase text-slate-300 select-none">Moments Log</div>
                                <div className="mt-3 flex items-center gap-2.5">
                                    <img src={userProfile.avatar} className="w-12 h-12 rounded-2xl object-cover bg-slate-100 border-2 border-white shadow-md ring-1 ring-slate-100 shrink-0" />
                                    <div className="min-w-0">
                                        <div className="text-[16px] font-bold text-slate-800 leading-tight truncate">{userProfile.name}</div>
                                        <div className="mt-1 text-[10px] font-mono text-slate-300 tracking-wider">已贴 {posts.length} 条瞬间</div>
                                    </div>
                                </div>
                            </div>

                            {/* 右：拍立得封面贴纸（点按更换，作原「封面头图」用途） */}
                            <button
                                onClick={() => coverInputRef.current?.click()}
                                title="更换封面"
                                className="relative shrink-0 tilt-r active:scale-95 transition-transform"
                            >
                                <div className="bg-white p-1.5 pb-5 rounded-md border border-slate-100 shadow-[0_12px_22px_-12px_rgba(50,48,60,0.5)]">
                                    {cover ? (
                                        <img src={cover} className="w-[76px] h-[76px] rounded-[3px] object-cover" />
                                    ) : (
                                        <div className="w-[76px] h-[76px] rounded-[3px] bg-slate-50 border border-dashed border-slate-200 flex flex-col items-center justify-center gap-1 text-slate-300">
                                            <Camera size={18} />
                                            <span className="text-[9px]">贴张封面</span>
                                        </div>
                                    )}
                                    <span className="absolute bottom-1 left-0 right-0 text-center text-[8px] font-mono tracking-[0.25em] uppercase text-slate-300 select-none">Cover</span>
                                </div>
                                <span
                                    className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-9 h-3.5 -rotate-[4deg] pointer-events-none"
                                    style={{
                                        background: 'linear-gradient(100deg, rgba(255,255,255,0.65), rgba(243,240,233,0.5))',
                                        boxShadow: '0 1px 3px rgba(50,48,60,0.12)',
                                        borderLeft: '1px dashed rgba(160,156,146,0.4)',
                                        borderRight: '1px dashed rgba(160,156,146,0.4)',
                                    }}
                                />
                            </button>
                        </div>
                        <input ref={coverInputRef} type="file" accept="image/*" className="hidden" onChange={handleCoverPick} />

                        {/* 贴纸按钮行：翻新动态（纸面）/ 贴一条（墨色） */}
                        <div className="flex gap-2.5 mt-5">
                            <button
                                onClick={handleRefresh}
                                disabled={isRefreshing}
                                className="scrap-btn-paper flex-1 py-2.5 text-[12px] font-bold flex items-center justify-center gap-1.5 disabled:opacity-60"
                                title="看看大家有没有贴新瞬间"
                            >
                                <ArrowsClockwise size={15} weight="bold" className={isRefreshing ? 'animate-spin' : ''} />
                                {isRefreshing ? '收集中…' : '翻翻新动态'}
                            </button>
                            <button
                                onClick={() => { setRepostPrefill(null); setView('publish'); }}
                                className="scrap-btn flex-1 py-2.5 text-[12px] font-bold flex items-center justify-center gap-1.5"
                                title="贴一条瞬间"
                            >
                                <Camera size={15} weight="bold" />
                                贴一条
                            </button>
                        </div>
                    </div>
                </div>

                {/* 刷新中提示条 */}
                {isRefreshing && (
                    <div className="flex items-center justify-center gap-2 py-2 text-xs text-slate-400">
                        <span className="w-3.5 h-3.5 border-2 border-slate-200 border-t-slate-700 rounded-full animate-spin" />
                        正在收集新的瞬间…
                    </div>
                )}

                {/* 动态流（纸卡拼贴流） */}
                <div className="pt-1 pb-28">
                    {posts.length === 0 && !isRefreshing && (
                        <div className="flex flex-col items-center justify-center py-20 text-slate-300 gap-3 px-8 text-center">
                            <Camera size={44} className="opacity-40" />
                            <span className="text-xs leading-relaxed">这一页还空着——点「贴一条」留下你的瞬间，或「翻翻新动态」看看大家在干嘛</span>
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
