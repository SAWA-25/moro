import { AmbientSocialEntry, APIConfig, CharacterProfile, SocialComment, SocialPost, UserProfile } from '../../types';
import { ContextBuilder } from '../../utils/context';
import { DB } from '../../utils/db';
import { safeResponseJson } from '../../utils/safeApi';
import { makeApiUsageMeta } from '../../utils/apiUsageCatalog';
import { formatCharacterWithId, getCharacterModelId } from '../../utils/characterIdentity';
import {
    momentsCommentReplyPrompt,
    momentsReactionPrompt,
    momentsRefreshPrompt,
} from '../../utils/laiwangPrompts';
import { isAmbientSocialCharacter } from '../../utils/ambientSocial';
import { displayableImages, newId, npcAvatar, postDisplayText } from './momentsUtils';

// --- Robust JSON Parser（沿用旧 SocialApp 的容错解析） ---
const safeParseJSON = (input: string): any[] => {
    const clean = (input || '').replace(/```json/g, '').replace(/```/g, '').trim();
    try {
        const parsed = JSON.parse(clean);
        if (!Array.isArray(parsed) && typeof parsed === 'object' && parsed !== null) {
            const keys = Object.keys(parsed);
            if (keys.length === 1 && Array.isArray(parsed[keys[0]])) {
                return parsed[keys[0]];
            }
        }
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        try {
            const start = clean.indexOf('[');
            if (start === -1) return [];
            let end = clean.lastIndexOf('}');
            while (end > start) {
                const attempt = clean.substring(start, end + 1) + ']';
                try {
                    const result = JSON.parse(attempt);
                    if (Array.isArray(result)) return result;
                } catch (err) {}
                end = clean.lastIndexOf('}', end - 1);
            }
            return [];
        } catch (e2) {
            return [];
        }
    }
};

/** 统一的 LLM 调用（沿用旧 SocialApp 的 fetch + safeResponseJson 模式） */
const callLLM = async (
    apiConfig: APIConfig,
    prompt: string,
    temperature: number = 0.9,
    maxTokens: number = 4000,
    featureId: string = 'chat.moments.refresh',
    metaContext: Parameters<typeof makeApiUsageMeta>[1] = {},
): Promise<any[]> => {
    const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
        body: JSON.stringify({
            model: apiConfig.model,
            messages: [{ role: 'user', content: prompt }],
            temperature,
            max_tokens: maxTokens,
        }),
        __moroMeta: makeApiUsageMeta(featureId, { apiRole: 'aux', ...metaContext }),
    } as RequestInit & { __moroMeta?: unknown });
    if (!response.ok) throw new Error(`API Error (${response.status})`);
    const data = await safeResponseJson(response);
    return safeParseJSON(data?.choices?.[0]?.message?.content || '');
};

/** 角色对帖子的互动结果（作为"增量操作"返回，由 MomentsFeed 套用到最新 state，避免竞态覆盖） */
export type ReactionOp =
    | { type: 'like'; postId: string; liker: { id: string; name: string } }
    | { type: 'comment'; postId: string; comment: SocialComment }
    | { type: 'repost'; post: SocialPost };

const charByLocalId = (characters: CharacterProfile[], id: any): CharacterProfile | undefined =>
    characters.find(c => c.id === id);

export const resolveMomentCharacter = (characters: CharacterProfile[], charId: any): CharacterProfile | undefined => {
    const id = String(charId || '').trim();
    if (!id) return undefined;
    return characters.find(c => getCharacterModelId(c) === id) || charByLocalId(characters, id);
};

const isLinkedAmbientEntry = (entry: AmbientSocialEntry): boolean => (
    (entry.kind === 'contact' && !!entry.linkedCharId)
    || (entry.kind === 'group' && !!entry.linkedGroupId)
);

const ambientEntryNames = (entry: AmbientSocialEntry): string[] => {
    if (entry.kind === 'group') return [entry.name, ...entry.memberNames].map(n => n.trim()).filter(Boolean);
    return [entry.name.trim()].filter(Boolean);
};

const hiddenAmbientNpcNames = (userProfile: UserProfile): Set<string> => {
    const names = new Set<string>();
    const hideConverted = userProfile.ambientSocialHideConverted !== false;
    (userProfile.ambientSocial?.entries || [])
        .filter(entry => userProfile.ambientSocialEnabled === false || entry.hidden || (hideConverted && isLinkedAmbientEntry(entry)))
        .forEach(entry => ambientEntryNames(entry).forEach(name => names.add(name)));
    return names;
};

export const getMomentVisibleCharacters = (
    characters: CharacterProfile[],
    userProfile: UserProfile,
): CharacterProfile[] => {
    if (userProfile.ambientSocialHideConverted === false) return characters;
    const linkedCharIds = new Set<string>();
    (userProfile.ambientSocial?.entries || []).forEach(entry => {
        if (entry.kind === 'contact' && entry.linkedCharId) linkedCharIds.add(entry.linkedCharId);
    });
    return characters.filter(char => !isAmbientSocialCharacter(char) && !linkedCharIds.has(char.id));
};

/** 喂给 LLM 的帖子摘要（仅公开帖） */
const feedDigest = (
    feed: SocialPost[],
    characters: CharacterProfile[],
    userName: string,
    allowNpc: boolean,
    blockedNpcNames: Set<string>,
    limit = 8,
): string => {
    const visibleCharIds = new Set(characters.map(c => c.id));
    const visibleCharNames = new Set(characters.map(c => c.name));
    const visible = feed
        .filter(p => {
            if (p.visibility === 'private') return false;
            if (blockedNpcNames.has(p.authorName)) return false;
            if (allowNpc) return true;
            if (p.authorType === 'stranger') return false;
            if (p.authorType === 'user' || p.authorName === userName) return true;
            if (p.authorType === 'character') {
                return !p.authorCharId || visibleCharIds.has(p.authorCharId) || visibleCharNames.has(p.authorName);
            }
            return visibleCharNames.has(p.authorName);
        })
        .slice(0, limit);
    if (visible.length === 0) return '(朋友圈暂时是空的)';
    return visible.map(p => {
        const who = p.authorType === 'user' ? `${p.authorName}(用户本人)` : p.authorName;
        const imgs = displayableImages(p).length;
        const repost = p.repostOf ? ` [转发了 ${p.repostOf.authorName} 的动态: ${p.repostOf.content.slice(0, 30)}]` : '';
        return `- postId="${p.id}" 作者:${who} 内容:"${postDisplayText(p).slice(0, 60)}"${imgs ? ` (附${imgs}张图)` : ''}${repost}`;
    }).join('\n');
};

const userSocialCircleDigest = (userProfile: UserProfile, feed: SocialPost[]): string => {
    const lines: string[] = [
        `名字: ${userProfile.name || '用户'}`,
        `简介: ${userProfile.bio || '（没写简介）'}`,
    ];
    if (userProfile.patSuffix) lines.push(`拍一拍后缀: ${userProfile.patSuffix}`);
    if (userProfile.vrState?.enabled) {
        const state = [
            userProfile.vrState.currentRoom ? `所在房间: ${userProfile.vrState.currentRoom}` : '',
            userProfile.vrState.activity ? `此刻活动: ${userProfile.vrState.activity}` : '',
        ].filter(Boolean).join('；');
        if (state) lines.push(`页外状态: ${state}`);
    }

    if (userProfile.ambientSocialEnabled === false) {
        lines.push('用户社交圈已关闭：本轮禁止生成 NPC 动态、NPC 点赞或 NPC 评论；只允许正式角色按候选角色名单发动态和互动。');
        return lines.join('\n');
    }

    const hideConverted = userProfile.ambientSocialHideConverted !== false;
    const ambient = (userProfile.ambientSocial?.entries || [])
        .filter(e => !e.hidden && !(hideConverted && isLinkedAmbientEntry(e)))
        .slice(0, 12);
    if (ambient.length > 0) {
        lines.push('已建立的用户社交圈（朋友圈 NPC 优先从这里取，不要重复正式角色名）：');
        ambient.forEach(e => {
            if (e.kind === 'group') {
                lines.push(`- 群聊「${e.name}」(${e.relationLabel})：${e.note}；成员：${e.memberNames.join('、')}；最近消息：${e.lastMessage}${e.linkedGroupId ? '；已转正式群聊，NPC 作者不要重复它' : ''}`);
            } else {
                lines.push(`- ${e.relationLabel}「${e.name}」：${e.note}；最近消息：${e.lastMessage}${e.linkedCharId ? '；已转正式角色，NPC 作者不要重复它' : ''}`);
            }
        });
    } else {
        lines.push('已建立的用户社交圈：暂无。只能从用户简介中能明确推出的关系生成 NPC；简介没有支撑时，少生成或不生成 NPC 动态。');
    }

    const knownNpcNames = Array.from(new Set(
        feed
            .filter(p => p.authorType === 'stranger' && !hiddenAmbientNpcNames(userProfile).has(p.authorName))
            .map(p => p.authorName)
    )).slice(0, 12);
    if (knownNpcNames.length > 0) lines.push(`已出现过的朋友圈 NPC（可沿用，保持连续性；不要无故换身份）：${knownNpcNames.join('、')}`);
    return lines.join('\n');
};

const userSocialNpcNames = (userProfile: UserProfile, feed: SocialPost[]): Set<string> | undefined => {
    if (userProfile.ambientSocialEnabled === false) return new Set();
    const blockedNames = hiddenAmbientNpcNames(userProfile);
    const hideConverted = userProfile.ambientSocialHideConverted !== false;
    const ambient = (userProfile.ambientSocial?.entries || [])
        .filter(e => !e.hidden && !(hideConverted && isLinkedAmbientEntry(e)));
    if (ambient.length === 0) return undefined;
    const names = new Set<string>();
    ambient.forEach(e => {
        if (e.kind === 'group') {
            if (!e.linkedGroupId) names.add(e.name);
            e.memberNames.forEach(n => { if (n.trim()) names.add(n.trim()); });
        } else {
            names.add(e.name);
        }
    });
    feed
        .filter(p => p.authorType === 'stranger' && !blockedNames.has(p.authorName))
        .forEach(p => names.add(p.authorName));
    return names;
};

const buildCharBlock = async (char: CharacterProfile, userProfile: UserProfile): Promise<string> => {
    const core = ContextBuilder.buildCoreContext(char, userProfile, false);
    const modelId = getCharacterModelId(char);
    let status = '(最近无私聊，生活平淡)';
    try {
        const msgs = await DB.getMessagesByCharId(char.id);
        if (msgs.length > 0) {
            status = `(最近私聊状态: 刚和用户聊过 "${String(msgs[msgs.length - 1].content || '').substring(0, 20)}...")`;
        }
    } catch (e) {}
    return `<<< 角色档案: ${formatCharacterWithId(char)} charId="${modelId}" >>>\n${core}\n${status}\n<<< 档案结束 >>>`;
};

const pickRandom = <T,>(arr: T[], n: number): T[] =>
    [...arr].sort(() => 0.5 - Math.random()).slice(0, n);

/** 把 LLM 返回的混合评论数组（角色 charId / NPC npcName）解析成 SocialComment 列表 */
const parseMixedComments = (
    raw: any,
    characters: CharacterProfile[],
    userName: string,
    allowedNpcNames?: Set<string>,
    blockedNpcNames: Set<string> = new Set(),
): SocialComment[] => {
    const out: SocialComment[] = [];
    // replyToName 按"楼上同名评论"回链，模拟评论区的有来有回
    const lastIdByName: Record<string, string> = {};
    (Array.isArray(raw) ? raw : []).forEach((cm: any) => {
        const text = String(cm?.content || '').trim();
        if (!text) return;
        const commenter = resolveMomentCharacter(characters, cm?.charId);
        const npcName = String(cm?.npcName || '').trim();
        let comment: SocialComment | null = null;
        if (commenter) {
            comment = {
                id: newId('cmt'),
                authorName: commenter.name,
                authorAvatar: commenter.avatar,
                content: text,
                likes: 0,
                isCharacter: true,
                authorType: 'character',
                authorCharId: commenter.id,
            };
        } else if (npcName && npcName !== userName && !blockedNpcNames.has(npcName) && (!allowedNpcNames || allowedNpcNames.has(npcName))) {
            comment = {
                id: newId('cmt'),
                authorName: npcName,
                authorAvatar: npcAvatar(npcName),
                content: text,
                likes: 0,
                isCharacter: false,
                authorType: 'stranger',
            };
        }
        if (!comment) return;
        const replyName = String(cm?.replyToName || '').trim();
        if (replyName && lastIdByName[replyName]) {
            comment.replyTo = { commentId: lastIdByName[replyName], name: replyName };
        }
        lastIdByName[comment.authorName] = comment.id;
        out.push(comment);
    });
    return out;
};

/** 按热度补点赞数：爆火/小热门的帖子点赞数远超具名点赞列表 */
const heatLikes = (heat: string, namedLikes: number): number => {
    if (heat === 'viral') return Math.max(namedLikes, 300 + Math.floor(Math.random() * 1700));
    if (heat === 'hot') return Math.max(namedLikes, 50 + Math.floor(Math.random() * 200));
    return namedLikes;
};

/**
 * 「刷新」轮：生成角色 + NPC（用户社交设定里的联系人/群聊）的新朋友圈动态。
 * - 角色严格按人设决定发不发：高冷/社恐的可以一条不发；
 * - NPC 帖围绕用户社交圈/简介推断，不套本地亲友模板；
 * - 评论、点赞按内容热度自然浮动，不强行把每条动态写成热评区。
 * 帖子一律纯文本（绝不让 LLM 编造图片 URL），可带位置、可转发已有公开帖。
 */
export const generateCharacterMoments = async (params: {
    apiConfig: APIConfig;
    characters: CharacterProfile[];
    userProfile: UserProfile;
    feed: SocialPost[];
}): Promise<SocialPost[]> => {
    const { apiConfig, characters, userProfile, feed } = params;
    const momentCharacters = getMomentVisibleCharacters(characters, userProfile);
    if (momentCharacters.length === 0) return [];
    const allowNpc = userProfile.ambientSocialEnabled !== false;

    const selected = pickRandom(momentCharacters, Math.min(4, momentCharacters.length));
    const blocks = await Promise.all(selected.map(c => buildCharBlock(c, userProfile)));
    const roster = momentCharacters.map(c => `- ${formatCharacterWithId(c)} charId="${getCharacterModelId(c)}" 名字:"${c.name}"`).join('\n');
    const socialCircle = userSocialCircleDigest(userProfile, feed);
    const allowedNpcNames = userSocialNpcNames(userProfile, feed);
    const blockedNpcNames = hiddenAmbientNpcNames(userProfile);

    const prompt = momentsRefreshPrompt({
        userName: userProfile.name,
        allowNpc,
        socialCircle,
        candidateBlocks: blocks.join('\n\n'),
        roster,
        feedDigest: feedDigest(feed, momentCharacters, userProfile.name, allowNpc, blockedNpcNames),
    });

    const json = await callLLM(apiConfig, prompt, 0.95, 16000, 'chat.moments.refresh');
    const now = Date.now();
    const posts: SocialPost[] = [];

    json.forEach((item: any, idx: number) => {
        const content = String(item?.content || '').trim();
        if (!content) return;

        // 作者归属：角色帖按 charId；NPC 帖按 npcName（禁止冒充用户）
        const author = resolveMomentCharacter(momentCharacters, item?.charId);
        const npcName = String(item?.npcName || '').trim();
        let authorName: string;
        let authorAvatar: string;
        let authorType: SocialPost['authorType'];
        let authorCharId: string | undefined;
        if (author) {
            authorName = author.name;
            authorAvatar = author.avatar;
            authorType = 'character';
            authorCharId = author.id;
        } else if (npcName && npcName !== userProfile.name && (!allowedNpcNames || allowedNpcNames.has(npcName))) {
            if (blockedNpcNames.has(npcName)) return;
            authorName = npcName;
            authorAvatar = npcAvatar(npcName);
            authorType = 'stranger';
        } else {
            return; // 丢弃无法归属的内容（含模仿用户的）
        }

        let repostOf: SocialPost['repostOf'] = null;
        if (item?.repostOfPostId) {
            const origin = feed.find(p => p.id === item.repostOfPostId && p.visibility !== 'private');
            if (origin) {
                repostOf = {
                    postId: origin.id,
                    authorName: origin.authorName,
                    content: postDisplayText(origin),
                    images: displayableImages(origin),
                };
            }
        }

        const charLikes = (Array.isArray(item?.likedByCharIds) ? item.likedByCharIds : [])
            .map((id: any) => resolveMomentCharacter(momentCharacters, id))
            .filter((c?: CharacterProfile): c is CharacterProfile => !!c && c.id !== authorCharId)
            .map((c: CharacterProfile) => ({ id: c.id, name: c.name }));
        const npcLikes = (Array.isArray(item?.likedByNpcNames) ? item.likedByNpcNames : [])
            .map((n: any) => String(n || '').trim())
            .filter((n: string) => !!n && n !== userProfile.name && n !== authorName && !blockedNpcNames.has(n) && (!allowedNpcNames || allowedNpcNames.has(n)))
            .slice(0, 20)
            .map((n: string) => ({ id: `npc-${n}`, name: n }));
        const likedBy = [...charLikes, ...npcLikes];

        const comments = parseMixedComments(item?.comments, momentCharacters, userProfile.name, allowedNpcNames, blockedNpcNames);
        const heat = String(item?.heat || 'normal').toLowerCase();

        posts.push({
            id: newId('moment'),
            authorName,
            authorAvatar,
            title: '',
            content,
            images: [],
            likes: heatLikes(heat, likedBy.length),
            isCollected: false,
            isLiked: false,
            comments,
            // 错开几秒，保证排序稳定且“先生成的在下面”
            timestamp: now - idx * 1000,
            tags: [],
            authorType,
            authorCharId,
            likedBy,
            repostOf,
            location: item?.location ? String(item.location).slice(0, 30) : undefined,
            visibility: 'public',
        });
    });

    return posts;
};

/**
 * 用户发布公开动态后的「角色反应」轮：
 * 被提醒(提醒谁看)的角色保证互动，再随机抽几个角色，单次 LLM 调用返回
 * 点赞/评论/转发操作；同一轮里角色也可以回复已有评论、顺手互动其它帖子。
 */
export const generateReactions = async (params: {
    apiConfig: APIConfig;
    characters: CharacterProfile[];
    userProfile: UserProfile;
    post: SocialPost;
    feed: SocialPost[];
}): Promise<ReactionOp[]> => {
    const { apiConfig, characters, userProfile, post, feed } = params;
    if (characters.length === 0 || post.visibility === 'private') return [];

    const mentioned = (post.mentionedCharIds || [])
        .map(id => charByLocalId(characters, id))
        .filter((c): c is CharacterProfile => !!c);
    const others = pickRandom(characters.filter(c => !mentioned.some(m => m.id === c.id)), Math.max(0, 4 - mentioned.length));
    const reactors = [...mentioned, ...others];
    if (reactors.length === 0) return [];

    const blocks = await Promise.all(reactors.map(c => buildCharBlock(c, userProfile)));

    // 主目标 + 少量近期帖作为顺手互动对象
    const sideTargets = feed
        .filter(p => p.id !== post.id && p.visibility !== 'private')
        .slice(0, 3);
    const targets = [post, ...sideTargets];
    const targetDigest = targets.map(p => {
        const who = p.authorType === 'user' ? `${p.authorName}(用户本人)` : p.authorName;
        const imgs = displayableImages(p).length;
        const cmts = (p.comments || []).map(c =>
            `    · commentId="${c.id}" ${c.authorName}${c.replyTo ? ` 回复 ${c.replyTo.name}` : ''}: ${c.content.slice(0, 40)}`
        ).join('\n');
        return `* postId="${p.id}" 作者:${who}${p.location ? ` 位置:${p.location}` : ''}
  内容:"${postDisplayText(p).slice(0, 100)}"${imgs ? ` (附${imgs}张图)` : ''}${p.repostOf ? `\n  (转发自 ${p.repostOf.authorName}: ${p.repostOf.content.slice(0, 40)})` : ''}
  已有评论:\n${cmts || '    (暂无评论)'}`;
    }).join('\n');

    const mentionNote = mentioned.length > 0
        ? `用户发动态时特意"提醒了"这些角色看: ${mentioned.map(c => `${c.name}(charId="${getCharacterModelId(c)}")`).join('、')}。这些角色必须各产生至少一次自然互动，可以只是点赞；如果评论，要像本人真的有话想接。`
        : '本条动态没有特别提醒谁看。';

    const prompt = momentsReactionPrompt({
        userName: userProfile.name,
        postId: post.id,
        reactorBlocks: blocks.join('\n\n'),
        targetDigest,
        mentionNote,
    });

    const json = await callLLM(apiConfig, prompt, 0.9, 4000, 'chat.moments.reactions');
    const ops: ReactionOp[] = [];
    let repostUsed = false;

    json.forEach((item: any) => {
        const actor = resolveMomentCharacter(characters, item?.charId);
        if (!actor) return;
        const target = targets.find(p => p.id === item?.postId) || post;
        const action = String(item?.action || '').toLowerCase();

        if (action === 'like') {
            ops.push({ type: 'like', postId: target.id, liker: { id: actor.id, name: actor.name } });
        } else if (action === 'comment') {
            const text = String(item?.content || '').trim();
            if (!text) return;
            let replyTo: SocialComment['replyTo'];
            if (item?.replyToCommentId) {
                const origin = (target.comments || []).find(c => c.id === item.replyToCommentId);
                if (origin) replyTo = { commentId: origin.id, name: origin.authorName };
            }
            ops.push({
                type: 'comment',
                postId: target.id,
                comment: {
                    id: newId('cmt'),
                    authorName: actor.name,
                    authorAvatar: actor.avatar,
                    content: text,
                    likes: 0,
                    isCharacter: true,
                    authorType: 'character',
                    authorCharId: actor.id,
                    replyTo,
                },
            });
        } else if (action === 'repost' && !repostUsed) {
            const text = String(item?.content || '').trim();
            if (!text) return;
            repostUsed = true;
            ops.push({
                type: 'repost',
                post: {
                    id: newId('moment'),
                    authorName: actor.name,
                    authorAvatar: actor.avatar,
                    title: '',
                    content: text,
                    images: [],
                    likes: 0,
                    isCollected: false,
                    isLiked: false,
                    comments: [],
                    timestamp: Date.now(),
                    tags: [],
                    authorType: 'character',
                    authorCharId: actor.id,
                    likedBy: [],
                    repostOf: {
                        postId: target.id,
                        authorName: target.authorName,
                        content: postDisplayText(target),
                        images: displayableImages(target),
                    },
                    visibility: 'public',
                },
            });
        }
    });

    return ops;
};

/**
 * 用户在某条帖子下评论/回复后：让帖子作者（角色帖）和相关角色回应用户这条评论。
 */
export const generateCommentReplies = async (params: {
    apiConfig: APIConfig;
    characters: CharacterProfile[];
    userProfile: UserProfile;
    post: SocialPost;
    userComment: SocialComment;
}): Promise<SocialComment[]> => {
    const { apiConfig, characters, userProfile, post, userComment } = params;
    if (post.visibility === 'private') return [];

    // 候选回应者：帖子作者(角色) + 该帖评论区出现过的角色 + 随机补位
    const involvedIds = new Set<string>();
    if (post.authorType === 'character' && post.authorCharId) involvedIds.add(post.authorCharId);
    (post.comments || []).forEach(c => { if (c.authorCharId) involvedIds.add(c.authorCharId); });
    if (userComment.replyTo) {
        const target = (post.comments || []).find(c => c.id === userComment.replyTo!.commentId);
        if (target?.authorCharId) involvedIds.add(target.authorCharId);
    }
    let candidates = characters.filter(c => involvedIds.has(c.id));
    if (candidates.length === 0) candidates = pickRandom(characters, Math.min(2, characters.length));
    candidates = candidates.slice(0, 3);
    if (candidates.length === 0) return [];

    const blocks = await Promise.all(candidates.map(c => buildCharBlock(c, userProfile)));
    const cmts = (post.comments || []).map(c =>
        `- commentId="${c.id}" ${c.authorName}${c.replyTo ? ` 回复 ${c.replyTo.name}` : ''}: ${c.content.slice(0, 50)}`
    ).join('\n');

    const replyContext = userComment.replyTo
        ? `用户这条评论是在回复 "${userComment.replyTo.name}" 的评论。`
        : '用户这条评论是直接评论这条动态。';

    const prompt = momentsCommentReplyPrompt({
        userName: userProfile.name,
        authorLine: post.authorType === 'user' ? `${post.authorName}(用户本人)` : post.authorName,
        postText: postDisplayText(post).slice(0, 120),
        repostLine: post.repostOf ? `\n(转发自 ${post.repostOf.authorName}: ${post.repostOf.content.slice(0, 40)})` : '',
        commentsText: cmts || '(暂无)',
        userComment: userComment.content,
        replyContext,
        candidateBlocks: blocks.join('\n\n'),
    });

    const json = await callLLM(apiConfig, prompt, 0.9, 2000, 'chat.moments.commentReplies');
    const replies: SocialComment[] = [];
    json.forEach((item: any) => {
        const actor = resolveMomentCharacter(candidates, item?.charId) || resolveMomentCharacter(characters, item?.charId);
        const text = String(item?.content || '').trim();
        if (!actor || !text) return;
        replies.push({
            id: newId('cmt'),
            authorName: actor.name,
            authorAvatar: actor.avatar,
            content: text,
            likes: 0,
            isCharacter: true,
            authorType: 'character',
            authorCharId: actor.id,
            replyTo: { commentId: userComment.id, name: userProfile.name },
        });
    });
    return replies;
};
