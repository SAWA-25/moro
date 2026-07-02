import type { CharacterProfile, SocialComment, SocialPost } from '../types';
import { DB } from './db';
import { canCharacterViewMoment, shouldNotifyCharacterForMoment } from './momentsAccess';
import { momentsChatContextIntro } from './laiwangPrompts';

const MOMENTS_CONTEXT_WINDOW_MS = 72 * 60 * 60 * 1000;

const clip = (value: unknown, limit = 96): string => {
    const clean = String(value ?? '').replace(/\s+/g, ' ').trim();
    return clean.length > limit ? `${clean.slice(0, limit)}...` : clean;
};

const postText = (post: SocialPost): string => clip(post.content || post.title || '发了一条此刻', 120);

const relevantComments = (post: SocialPost, charId: string): SocialComment[] =>
    (post.comments || []).filter(comment => (
        comment.authorCharId === charId
        || comment.replyTo?.name === post.authorName
        || (comment.replyTo && (post.comments || []).some(c => c.id === comment.replyTo?.commentId && c.authorCharId === charId))
    ));

function describeMomentForChar(post: SocialPost, char: CharacterProfile): string | null {
    if (!canCharacterViewMoment(post, char.id)) return null;
    const parts: string[] = [];
    const own = post.authorCharId === char.id;
    const mentioned = shouldNotifyCharacterForMoment(post, char.id);
    const comments = relevantComments(post, char.id);
    const signal = (post.relationSignals || []).find(s => s.charId === char.id);
    if (!own && !mentioned && comments.length === 0 && !signal) return null;

    parts.push(own ? `自己发了：「${postText(post)}」` : `${post.authorName} 的动态：「${postText(post)}」`);
    if (mentioned) parts.push('这条动态特意提醒过 TA');
    comments.slice(-2).forEach(c => parts.push(`${c.authorName}${c.replyTo ? ` 回复 ${c.replyTo.name}` : ''}：${clip(c.content, 60)}`));
    if (signal?.text) parts.push(clip(signal.text, 80));
    return `- ${parts.join('；')}`;
}

export async function buildMomentsChatContextBlock(char: CharacterProfile, now = Date.now()): Promise<string> {
    try {
        const posts = await DB.getSocialPosts();
        const lines = posts
            .filter(post => now - (post.lastActivityAt || post.timestamp || 0) <= MOMENTS_CONTEXT_WINDOW_MS)
            .sort((a, b) => (b.lastActivityAt || b.timestamp || 0) - (a.lastActivityAt || a.timestamp || 0))
            .map(post => describeMomentForChar(post, char))
            .filter((line): line is string => !!line)
            .slice(0, 5);
        if (lines.length === 0) return '';
        return `\n${momentsChatContextIntro(char.name)}${lines.join('\n')}\n`;
    } catch {
        return '';
    }
}
