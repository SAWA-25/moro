import { SocialPost } from '../../types';

/** localStorage key：朋友圈封面图（dataURL） */
export const MOMENTS_COVER_KEY = 'moro_moments_cover';

/** 生成不重复 id */
export const newId = (prefix: string) =>
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * 旧版 Spark 帖子的 images 存的是 emoji 字符/codepoint，不是真图片。
 * 朋友圈只把 dataURL / http(s) 链接当作可渲染图片，其余静默忽略。
 */
export const isDisplayableImage = (src: string): boolean =>
    typeof src === 'string' && (src.startsWith('data:image') || /^https?:\/\//.test(src));

export const displayableImages = (post: Pick<SocialPost, 'images'>): string[] =>
    (post.images || []).filter(isDisplayableImage);

/** NPC（用户的亲友/路人）字母头像兜底：与 OSContext.generateAvatar 同款 SVG */
export const npcAvatar = (seed: string): string => {
    const colors = ['FF9AA2', 'FFB7B2', 'FFDAC1', 'E2F0CB', 'B5EAD7', 'C7CEEA', 'e2e8f0', 'fcd34d', 'fca5a5'];
    const s = seed || '友';
    const color = colors[s.charCodeAt(0) % colors.length];
    const letter = s.charAt(0).toUpperCase();
    return `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="%23${color}"/><text x="50" y="55" font-family="sans-serif" font-weight="bold" font-size="50" text-anchor="middle" dy=".3em" fill="white" opacity="0.9">${letter}</text></svg>`;
};

/** 微信式相对时间：刚刚 / N分钟前 / N小时前 / 昨天 / N天前 / 月-日 */
export const formatRelativeTime = (ts: number): string => {
    const diff = Date.now() - ts;
    if (diff < 60 * 1000) return '刚刚';
    if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)}分钟前`;
    if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)}小时前`;
    if (diff < 2 * 24 * 60 * 60 * 1000) return '昨天';
    if (diff < 30 * 24 * 60 * 60 * 1000) return `${Math.floor(diff / 86400000)}天前`;
    const d = new Date(ts);
    return `${d.getMonth() + 1}月${d.getDate()}日`;
};

/** 帖子展示文本：朋友圈帖直接用 content；兼容旧 Spark 帖（content 可能为空时退回 title） */
export const postDisplayText = (post: Pick<SocialPost, 'title' | 'content'>): string => {
    const content = (post.content || '').trim();
    if (content) return content;
    const title = (post.title || '').trim();
    return title && title !== '无标题' ? title : '';
};
