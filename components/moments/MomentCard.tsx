import React, { useState } from 'react';
import { ChatCircle, Heart, Lock, PaperPlaneTilt, Repeat } from '@phosphor-icons/react';
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
    onPreviewImage: (src: string) => void;
}

const NAME_COLOR = 'text-[#576b95]'; // 微信朋友圈昵称蓝

/** 图片网格：1 张大图，2-9 张三列宫格 */
const ImageGrid: React.FC<{ images: string[]; onPreview: (src: string) => void }> = ({ images, onPreview }) => {
    if (images.length === 0) return null;
    if (images.length === 1) {
        return (
            <img
                src={images[0]}
                onClick={(e) => { e.stopPropagation(); onPreview(images[0]); }}
                className="mt-2 max-w-[70%] max-h-56 rounded-lg object-cover cursor-pointer"
            />
        );
    }
    return (
        <div className={`mt-2 grid grid-cols-3 gap-1 ${images.length === 4 ? 'max-w-[70%]' : 'max-w-[85%]'}`}>
            {images.slice(0, 9).map((img, i) => (
                <img
                    key={i}
                    src={img}
                    onClick={(e) => { e.stopPropagation(); onPreview(img); }}
                    className="aspect-square w-full rounded-md object-cover cursor-pointer bg-slate-100"
                />
            ))}
        </div>
    );
};

/** 单条朋友圈动态卡片 */
const MomentCard: React.FC<MomentCardProps> = ({
    post, userName, isReacting,
    onToggleLike, onComment, onRepost, onShareToChat, onDeletePost, onDeleteComment, onPreviewImage,
}) => {
    const [showActions, setShowActions] = useState(false);

    const isOwn = post.authorType === 'user';
    const images = displayableImages(post);
    const text = postDisplayText(post);
    const likedBy = post.likedBy || [];
    const userLiked = likedBy.some(l => l.id === 'user');
    const comments = post.comments || [];

    const handleCommentTap = (c: SocialComment) => {
        const isOwnComment = c.authorType === 'user' || (!c.authorType && c.authorName === userName);
        if (isOwnComment) {
            if (window.confirm('删除这条评论？')) onDeleteComment(post, c);
        } else {
            onComment(post, { commentId: c.id, name: c.authorName });
        }
    };

    return (
        <div className="flex gap-3 px-4 py-4 border-b border-slate-100/80 bg-white">
            {/* 头像 */}
            <img src={post.authorAvatar} className="w-11 h-11 rounded-lg object-cover shrink-0 bg-slate-100" />

            <div className="flex-1 min-w-0">
                {/* 昵称 */}
                <div className={`text-[15px] font-bold ${NAME_COLOR} leading-tight flex items-center gap-1.5`}>
                    <span className="truncate">{post.authorName}</span>
                    {post.visibility === 'private' && <Lock size={13} className="text-slate-300 shrink-0" />}
                </div>

                {/* 正文 */}
                {text && <p className="text-[15px] text-slate-800 leading-relaxed whitespace-pre-wrap mt-1 break-words">{text}</p>}

                {/* 图片 */}
                <ImageGrid images={images} onPreview={onPreviewImage} />

                {/* 转发原帖 */}
                {post.repostOf && (
                    <div className="mt-2 bg-slate-100 rounded-lg p-2.5 flex gap-2 items-start">
                        {post.repostOf.images && post.repostOf.images[0] && (
                            <img
                                src={post.repostOf.images[0]}
                                onClick={(e) => { e.stopPropagation(); onPreviewImage(post.repostOf!.images![0]); }}
                                className="w-12 h-12 rounded-md object-cover shrink-0 cursor-pointer"
                            />
                        )}
                        <p className="text-[13px] text-slate-500 leading-snug line-clamp-4 break-words">
                            <span className={`font-medium ${NAME_COLOR}`}>{post.repostOf.authorName}</span>
                            ：{post.repostOf.content || '(图片动态)'}
                        </p>
                    </div>
                )}

                {/* 位置 + 时间 + 操作 */}
                {post.location && <div className={`text-xs ${NAME_COLOR} mt-2`}>{post.location}</div>}
                <div className="flex items-center mt-1.5 relative">
                    <span className="text-xs text-slate-400">{formatRelativeTime(post.timestamp)}</span>
                    {post.likes >= 200 && (
                        <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-md bg-red-50 text-red-500 font-bold shrink-0">🔥 爆款</span>
                    )}
                    {isReacting && (
                        <span className="ml-2 text-[10px] text-slate-300 flex items-center gap-1">
                            <span className="w-2.5 h-2.5 border border-slate-300 border-t-transparent rounded-full animate-spin inline-block" />
                            生成中…
                        </span>
                    )}
                    {isOwn && (
                        <button
                            onClick={() => { if (window.confirm('删除这条动态？')) onDeletePost(post); }}
                            className="ml-3 text-xs text-slate-400 active:text-red-400"
                        >
                            删除
                        </button>
                    )}

                    {/* ·· 操作按钮 */}
                    <div className="ml-auto relative">
                        {showActions && (
                            <div className="absolute right-9 top-1/2 -translate-y-1/2 flex items-center bg-[#4c4c4c] rounded-md text-white text-xs shadow-lg animate-fade-in z-10 whitespace-nowrap">
                                <button
                                    onClick={() => { setShowActions(false); onToggleLike(post); }}
                                    className="flex items-center gap-1 px-3 py-2 active:opacity-70"
                                >
                                    <Heart size={14} weight={userLiked ? 'fill' : 'regular'} className={userLiked ? 'text-red-400' : ''} />
                                    {userLiked ? '取消' : '赞'}
                                </button>
                                <span className="w-px h-4 bg-white/20" />
                                <button
                                    onClick={() => { setShowActions(false); onComment(post); }}
                                    className="flex items-center gap-1 px-3 py-2 active:opacity-70"
                                >
                                    <ChatCircle size={14} /> 评论
                                </button>
                                <span className="w-px h-4 bg-white/20" />
                                <button
                                    onClick={() => { setShowActions(false); onRepost(post); }}
                                    className="flex items-center gap-1 px-3 py-2 active:opacity-70"
                                >
                                    <Repeat size={14} /> 转发
                                </button>
                                <span className="w-px h-4 bg-white/20" />
                                <button
                                    onClick={() => { setShowActions(false); onShareToChat(post); }}
                                    className="flex items-center gap-1 px-3 py-2 active:opacity-70"
                                >
                                    <PaperPlaneTilt size={14} /> 分享
                                </button>
                            </div>
                        )}
                        <button
                            onClick={() => setShowActions(v => !v)}
                            className="w-7 h-5 bg-slate-100 rounded flex items-center justify-center text-[#576b95] font-black tracking-tighter active:bg-slate-200 transition-colors"
                        >
                            ··
                        </button>
                    </div>
                </div>

                {/* 点赞 + 评论区块 */}
                {(likedBy.length > 0 || comments.length > 0) && (
                    <div className="mt-2 bg-slate-50 rounded-lg overflow-hidden">
                        {likedBy.length > 0 && (
                            <div className={`flex items-start gap-1.5 px-3 py-2 ${comments.length > 0 ? 'border-b border-slate-200/60' : ''}`}>
                                <Heart size={14} weight="fill" className={`${NAME_COLOR} shrink-0 mt-0.5 opacity-80`} />
                                <span className={`text-[13px] font-medium ${NAME_COLOR} leading-snug break-words`}>
                                    {likedBy.map(l => l.name).join('，')}
                                    {post.likes > likedBy.length && ` 等 ${post.likes} 人觉得很赞`}
                                </span>
                            </div>
                        )}
                        {comments.length > 0 && (
                            <div className="px-3 py-1.5">
                                {comments.map(c => (
                                    <button
                                        key={c.id}
                                        onClick={() => handleCommentTap(c)}
                                        className="block w-full text-left text-[13px] leading-relaxed py-0.5 active:bg-slate-100 rounded break-words"
                                    >
                                        <span className={`font-medium ${NAME_COLOR}`}>{c.authorName}</span>
                                        {c.replyTo && (
                                            <>
                                                <span className="text-slate-700"> 回复 </span>
                                                <span className={`font-medium ${NAME_COLOR}`}>{c.replyTo.name}</span>
                                            </>
                                        )}
                                        <span className="text-slate-700">：{c.content}</span>
                                    </button>
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
