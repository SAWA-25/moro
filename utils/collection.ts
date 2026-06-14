/**
 * 岁时记·典藏馆 数据层。
 * ================================
 * 把「谈心 / 创作社（笔友会·写歌）/ 自习室（课程·测验）/ 小剧场（攻略本·TRPG）」里
 * 已完成的内容统一成可浏览、可收录、可转发的条目。收录只存一条引用（CollectionItem），
 * 不复制原文；转发则把一段可读的预览作为 user 消息塞进目标角色的聊天（让 char B 能看见
 * 并回应 user 和 char A 的同人 / 谈心记录）。
 */

import { DB } from './db';
import {
    CollectionItem, CollectionSourceType,
} from '../types';

export const collectionId = (t: CollectionSourceType, id: string) => `${t}:${id}`;

/** 典藏馆里展示的候选条目（来自各来源，附排序时间戳）。 */
export interface CollectibleCandidate {
    sourceType: CollectionSourceType;
    sourceId: string;
    title: string;
    subtitle?: string;
    excerpt?: string;
    charIds: string[];
    cover?: string;
    at: number;
}

export const SOURCE_LABEL: Record<CollectionSourceType, string> = {
    talk: '谈心',
    novel: '笔友会 · 同人',
    song: '写歌',
    course: '自习室 · 课程',
    quiz: '自习室 · 测验',
    guidebook: '攻略本',
    game: 'TRPG',
};

const COVER: Record<CollectionSourceType, string> = {
    talk: '🫂', novel: '📖', song: '🎵', course: '📚', quiz: '📝', guidebook: '💗', game: '🎲',
};

const clip = (s: string | undefined, n = 60): string => {
    const t = (s || '').replace(/\s+/g, ' ').trim();
    return t.length > n ? t.slice(0, n) + '…' : t;
};

/** 汇总所有来源里「值得收录」的内容，按时间倒序。nameOf 把 charId 转成显示名。 */
export async function listCollectibles(nameOf: (id: string) => string): Promise<CollectibleCandidate[]> {
    const [talks, novels, songs, courses, quizzes, guides, games] = await Promise.all([
        DB.getAllTalkSessions().catch(() => []),
        DB.getAllNovels().catch(() => []),
        DB.getAllSongs().catch(() => []),
        DB.getAllCourses().catch(() => []),
        DB.getAllQuizzes().catch(() => []),
        DB.getAllGuidebookSessions().catch(() => []),
        DB.getAllGames().catch(() => []),
    ]);
    const out: CollectibleCandidate[] = [];

    for (const t of talks) {
        if (!t.turns?.length) continue;
        const firstUser = t.turns.find(x => x.role === 'user')?.text;
        out.push({
            sourceType: 'talk', sourceId: t.id, title: t.title || '一次谈心',
            subtitle: `和 ${nameOf(t.charId)} 的谈心${t.mood ? ` · ${t.mood}` : ''}`,
            excerpt: clip(firstUser || t.turns[t.turns.length - 1]?.text),
            charIds: [t.charId], cover: COVER.talk, at: t.lastActiveAt || t.createdAt,
        });
    }
    for (const n of novels) {
        if (!n.segments?.length) continue;
        const lastStory = [...n.segments].reverse().find(s => s.type === 'story')?.content;
        out.push({
            sourceType: 'novel', sourceId: n.id, title: n.title || '无题',
            subtitle: `笔友会 · 和 ${(n.collaboratorIds || []).map(nameOf).filter(Boolean).join('、') || '自己'}`,
            excerpt: clip(lastStory || n.summary),
            charIds: n.collaboratorIds || [], cover: COVER.novel, at: n.lastActiveAt || n.createdAt,
        });
    }
    for (const s of songs) {
        if (s.status !== 'completed') continue;
        const lyric = (s.lines || []).filter(l => !l.isDraft).map(l => l.content).join(' / ');
        out.push({
            sourceType: 'song', sourceId: s.id, title: s.title || '无题',
            subtitle: `写歌 · 和 ${nameOf(s.collaboratorId) || '自己'}`,
            excerpt: clip(lyric),
            charIds: s.collaboratorId ? [s.collaboratorId] : [], cover: COVER.song, at: s.completedAt || s.lastActiveAt || s.createdAt,
        });
    }
    for (const c of courses) {
        out.push({
            sourceType: 'course', sourceId: c.id, title: c.title || '一门课',
            subtitle: `自习室 · 进度 ${Math.round(c.totalProgress || 0)}%`,
            excerpt: clip((c.chapters || []).map(ch => ch.title).filter(Boolean).join(' · ') || c.rawText),
            charIds: [], cover: COVER.course, at: c.createdAt,
        });
    }
    for (const q of quizzes) {
        if (q.status !== 'graded') continue;
        out.push({
            sourceType: 'quiz', sourceId: q.id, title: `${q.courseTitle || '测验'} · ${q.chapterTitle || ''}`.trim(),
            subtitle: `自习室 · 测验 ${q.score}/${q.totalQuestions}`,
            excerpt: clip(q.aiReview),
            charIds: [], cover: COVER.quiz, at: q.gradedAt || q.createdAt,
        });
    }
    for (const g of guides) {
        if (!g.rounds?.length && !g.endCard) continue;
        out.push({
            sourceType: 'guidebook', sourceId: g.id, title: `攻略本 · 和 ${nameOf(g.charId)}`,
            subtitle: `好感度 ${g.currentAffinity}${g.endCard ? ' · 已结局' : ''}`,
            excerpt: clip((g.endCard as any)?.summary || (g.endCard as any)?.title || g.scenarioHint || g.rounds[g.rounds.length - 1]?.scenario),
            charIds: [g.charId], cover: COVER.guidebook, at: g.lastPlayedAt || g.createdAt,
        });
    }
    for (const g of games) {
        if (!g.logs?.length && !g.summaries?.length) continue;
        const lastLog = [...(g.logs || [])].reverse().find(l => l.content)?.content;
        out.push({
            sourceType: 'game', sourceId: g.id, title: g.title || 'TRPG 冒险',
            subtitle: `TRPG · ${(g.playerCharIds || []).map(nameOf).filter(Boolean).join('、') || '单人'}`,
            excerpt: clip((g.summaries && g.summaries[g.summaries.length - 1] as any)?.content || lastLog),
            charIds: g.playerCharIds || [], cover: COVER.game, at: g.lastPlayedAt || g.createdAt,
        });
    }

    return out.sort((a, b) => b.at - a.at);
}

/** 候选 → 收录条目（落库用）。 */
export function candidateToItem(c: CollectibleCandidate): CollectionItem {
    return {
        id: collectionId(c.sourceType, c.sourceId),
        sourceType: c.sourceType,
        sourceId: c.sourceId,
        title: c.title,
        subtitle: c.subtitle,
        excerpt: c.excerpt,
        charIds: c.charIds,
        cover: c.cover,
        collectedAt: Date.now(),
    };
}

/** 转发到目标角色聊天的可读消息文案。involvedNames 为这份内容里涉及的角色名。 */
export function buildForwardText(item: CollectionItem, userName: string, involvedNames: string[]): string {
    const label = SOURCE_LABEL[item.sourceType] || '收藏';
    const who = involvedNames.filter(Boolean).join('、');
    const lines = [
        `［我翻出一份收藏，想给你看看］`,
        `${item.cover || '📎'}《${item.title}》（${label}）`,
    ];
    if (who) lines.push(item.sourceType === 'talk' ? `这是我和 ${who} 的谈心记录。` : `这是我和 ${who} 一起留下的。`);
    if (item.excerpt) lines.push(`节选：${item.excerpt}`);
    lines.push(`（看完跟我聊聊你的感觉呀。）`);
    return lines.join('\n');
}

/** 把已收录条目转发进目标角色的聊天（作为一条 user 消息，进入上下文，角色会看到并回应）。 */
export async function forwardCollectionItem(
    item: CollectionItem, targetCharId: string, userName: string, nameOf: (id: string) => string,
): Promise<void> {
    const involved = (item.charIds || []).filter(id => id !== targetCharId).map(nameOf);
    const text = buildForwardText(item, userName, involved);
    await DB.saveMessage({
        charId: targetCharId,
        role: 'user',
        type: 'text',
        content: text,
        metadata: { collectionForward: { sourceType: item.sourceType, sourceId: item.sourceId } },
    } as any);
}
