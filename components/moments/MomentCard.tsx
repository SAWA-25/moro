import React from 'react';
import { ChatCircle, Heart, Lock, PaperPlaneTilt, Repeat, Trash } from '@phosphor-icons/react';
import { SocialComment, SocialPost } from '../../types';
import { displayableImages, formatRelativeTime, postDisplayText } from './momentsUtils';

interface MomentCardProps {
    post: SocialPost;
    userName: string;
    /** 该帖正在跑角色互动生成 */
    isReacting?: boolean;
    onToggleLike: (post: SocialPost) => void;
    /** 评论（replyTo 为空 = 直接评论帖子） */
    onComment: (post: SocialPost, replyTo?: { commentId: string; name: string }) => void;
    onRepost: (post: SocialPost) => void;
    onShareToChat: (post: SocialPost) => void;
    onDeletePost: (post: SocialPost) => void;
    onDeleteComment: (post: SocialPost, comment: SocialComment) => void;
    onOpenCommentInChat: (post: SocialPost, comment: SocialComment) => void;
    onPreviewImage: (src: string) => void;
}

/** 图片网格：1 张大图，2-9 张三列宫格 */
const ImageGrid: React.FC<{ images: string[]; onPreview: (src: string) => void }> = ({ images, onPreview }) => {
    if (images.length === 0) return null;
    if (images.length === 1) {
        return (
            <img
                src={images[0]}
                onClick={(e) => { e.stopPropagation(); onPreview(images[0]); }}
                className="mt-2.5 max-w-[70%] max-h-56 rounded-2xl object-cover cursor-pointer border border-slate-100"
            />
        );
    }
    return (
        <div className={`mt-2.5 grid grid-cols-3 gap-1.5 ${images.length === 4 ? 'max-w-[70%]' : 'max-w-[85%]'}`}>
            {images.slice(0, 9).map((img, i) => (
                <img
                    key={i}
                    src={img}
                    onClick={(e) => { e.stopPropagation(); onPreview(img); }}
                    className="aspect-square w-full rounded-xl object-cover cursor-pointer bg-slate-100 border border-slate-100"
                />
            ))}
        </div>
    );
};

/** 单条「此刻」动态：纸卡拼贴风（原创排版——圆头像 + 墨色名字 + 常驻图标操作行） */
const MomentCard: React.FC<MomentCardProps> = ({
    post, userName, isReacting,
    onToggleLike, onComment, onRepost, onShareToChat, onDeletePost, onDeleteComment, onOpenCommentInChat, onPreviewImage,
}) => {
    const images = displayableImages(post);
    const text = postDisplayText(post);
    const likedBy = post.likedBy || [];
    const userLiked = likedBy.some(l => l.id === 'user');
    const comments = post.comments || [];

    const handleCommentTap = (c: SocialComment) => {
        const isOwnComment = c.authorType === 'user' || (!c.authorType && c.authorName === userName);
        if (isOwnComment) {
            if (window.confirm('删除这条留言？')) onDeleteComment(post, c);
        } else {
            onComment(post, { commentId: c.id, name: c.authorName });
        }
    };

    const handleDeletePost = () => {
        const tip = post.authorType === 'user'
            ? '删除这条此刻？'
            : `删除「${post.authorName}」的这条此刻？`;
        if (window.confirm(tip)) onDeletePost(post);
    };

    // 常驻操作行的小圆钮（替代隐藏式弹出条，按键直接可见）
    const ActionBtn: React.FC<{ onClick: () => void; label: string; children: React.ReactNode; active?: boolean }> = ({ onClick, label, children, active }) => (
        <button
            onClick={onClick}
            title={label}
            className={`w-8 h-8 rounded-full flex items-center justify-center border transition-all active:scale-90 ${active ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-400 border-slate-150 border-slate-200 hover:text-slate-600'}`}
        >
            {children}
        </button>
    );

    return (
        <div className="mx-3 my-3 rounded-[1.4rem] bg-white border border-slate-100 shadow-[0_14px_28px_-22px_rgba(50,48,60,0.4)] px-4 py-4 flex gap-3">
            {/* 头像（圆形 + 白描边） */}
            <img src={post.authorAvatar} className="w-10 h-10 rounded-full object-cover shrink-0 bg-slate-100 ring-2 ring-slate-50" />

            <div className="flex-1 min-w-0">
                {/* 名字 + 时间（墨色名字，时间右对齐小字） */}
                <div className="flex items-baseline justify-between gap-2">
                    <div className="text-[14px] font-bold text-slate-800 leading-tight flex items-center gap-1.5 min-w-0">
                        {post.unreadForUser && <span className="w-2 h-2 rounded-full bg-rose-400 shrink-0" title="新动态" />}
                        <span className="truncate">{post.authorName}</span>
                        {post.visibility === 'private' && <Lock size={12} className="text-slate-300 shrink-0" />}
                    </div>
                    <span className="text-[10px] font-mono text-slate-300 shrink-0">{formatRelativeTime(post.timestamp)}</span>
                </div>

                {/* 正文 */}
                {text && <p className="text-[14px] text-slate-700 leading-relaxed whitespace-pre-wrap mt-1.5 break-words">{text}</p>}

                {/* 图片 */}
                <ImageGrid images={images} onPreview={onPreviewImage} />

                {/* 转发原帖：虚线纸片 */}
                {post.repostOf && (
                    <div className="mt-2.5 bg-slate-50 rounded-2xl border border-dashed border-slate-200 p-2.5 flex gap-2 items-start">
                        {post.repostOf.images && post.repostOf.images[0] && (
                            <img
                                src={post.repostOf.images[0]}
                                onClick={(e) => { e.stopPropagation(); onPreviewImage(post.repostOf!.images![0]); }}
                                className="w-12 h-12 rounded-xl object-cover shrink-0 cursor-pointer"
                            />
                        )}
                        <p className="text-[12px] text-slate-500 leading-snug line-clamp-4 break-words">
                            <span className="font-bold text-slate-700">{post.repostOf.authorName}</span>
                            ：{post.repostOf.content || '(图片动态)'}
                        </p>
                    </div>
                )}

                {/* 位置 + 状态徽标 */}
                {(post.location || post.likes >= 200 || isReacting) && (
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                        {post.location && <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-50 border border-slate-100 text-slate-400">📍 {post.location}</span>}
                        {post.likes >= 200 && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-50 text-rose-500 font-bold">🔥 大热门</span>
                        )}
                        {isReacting && (
                            <span className="text-[10px] text-slate-300 flex items-center gap-1">
                                <span className="w-2.5 h-2.5 border border-slate-300 border-t-transparent rounded-full animate-spin inline-block" />
                                大家正在路过…
                            </span>
                        )}
                    </div>
                )}

                {/* 常驻操作行：赞 / 留言 / 转发 / 递给 TA（+ 任意帖可删除） */}
                <div className="flex items-center gap-2 mt-3">
                    <ActionBtn onClick={() => onToggleLike(post)} label={userLiked ? '取消赞' : '赞'} active={userLiked}>
                        <Heart size={15} weight={userLiked ? 'fill' : 'regular'} />
                    </ActionBtn>
                    <ActionBtn onClick={() => onComment(post)} label="留言">
                        <ChatCircle size={15} />
                    </ActionBtn>
                    <ActionBtn onClick={() => onRepost(post)} label="转贴">
                        <Repeat size={15} />
                    </ActionBtn>
                    <ActionBtn onClick={() => onShareToChat(post)} label="递给 TA">
                        <PaperPlaneTilt size={15} />
                    </ActionBtn>
                    <button
                        onClick={handleDeletePost}
                        title="删除"
                        className="ml-auto w-8 h-8 rounded-full flex items-center justify-center border bg-white text-slate-300 border-slate-200 hover:text-rose-400 active:scale-90 transition-all"
                    >
                        <Trash size={15} />
                    </button>
                </div>

                {/* 赞 + 留言区块：虚线纸条 */}
                {(likedBy.length > 0 || comments.length > 0) && (
                    <div className="mt-2.5 bg-slate-50/80 rounded-2xl border border-dashed border-slate-200 overflow-hidden">
                        {likedBy.length > 0 && (
                            <div className={`flex items-start gap-1.5 px-3 py-2 ${comments.length > 0 ? 'border-b border-dashed border-slate-200' : ''}`}>
                                <Heart size={13} weight="fill" className="text-rose-300 shrink-0 mt-0.5" />
                                <span className="text-[12px] font-medium text-slate-600 leading-snug break-words">
                                    {likedBy.map(l => l.name).join('，')}
                                    {post.likes > likedBy.length && ` 等 ${post.likes} 人路过点了赞`}
                                </span>
                            </div>
                        )}
                        {comments.length > 0 && (
                            <div className="px-3 py-1.5">
                                {comments.map(c => (
                                    <div key={c.id} className="group flex items-start gap-1 py-0.5">
                                        <button
                                            onClick={() => handleCommentTap(c)}
                                            className="flex-1 text-left text-[12px] leading-relaxed active:bg-slate-100 rounded break-words"
                                        >
                                            <span className="font-bold text-slate-700">{c.authorName}</span>
                                            {c.replyTo && (
                                                <>
                                                    <span className="text-slate-500"> 回 </span>
                                                    <span className="font-bold text-slate-700">{c.replyTo.name}</span>
                                                </>
                                            )}
                                            <span className="text-slate-600">：{c.content}</span>
                                        </button>
                                        {c.authorCharId && (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); onOpenCommentInChat(post, c); }}
                                                className="shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-bold text-slate-300 bg-white/70 border border-slate-100 active:scale-95"
                                                title="带着这句去聊"
                                            >
                                                去聊
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default MomentCard;
