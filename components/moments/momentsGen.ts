import { APIConfig, CharacterProfile, SocialComment, SocialPost, UserProfile } from '../../types';
import { ContextBuilder } from '../../utils/context';
import { DB } from '../../utils/db';
import { safeResponseJson } from '../../utils/safeApi';
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
    maxTokens: number = 4000
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
    });
    if (!response.ok) throw new Error(`API Error (${response.status})`);
    const data = await safeResponseJson(response);
    return safeParseJSON(data?.choices?.[0]?.message?.content || '');
};

/** 角色对帖子的互动结果（作为"增量操作"返回，由 MomentsFeed 套用到最新 state，避免竞态覆盖） */
export type ReactionOp =
    | { type: 'like'; postId: string; liker: { id: string; name: string } }
    | { type: 'comment'; postId: string; comment: SocialComment }
    | { type: 'repost'; post: SocialPost };

const charById = (characters: CharacterProfile[], id: any): CharacterProfile | undefined =>
    characters.find(c => c.id === id);

/** 喂给 LLM 的帖子摘要（仅公开帖） */
const feedDigest = (feed: SocialPost[], characters: CharacterProfile[], userName: string, limit = 8): string => {
    const visible = feed.filter(p => p.visibility !== 'private').slice(0, limit);
    if (visible.length === 0) return '(朋友圈暂时是空的)';
    return visible.map(p => {
        const who = p.authorType === 'user' ? `${p.authorName}(用户本人)` : p.authorName;
        const imgs = displayableImages(p).length;
        const repost = p.repostOf ? ` [转发了 ${p.repostOf.authorName} 的动态: ${p.repostOf.content.slice(0, 30)}]` : '';
        return `- postId="${p.id}" 作者:${who} 内容:"${postDisplayText(p).slice(0, 60)}"${imgs ? ` (附${imgs}张图)` : ''}${repost}`;
    }).join('\n');
};

const buildCharBlock = async (char: CharacterProfile, userProfile: UserProfile): Promise<string> => {
    const core = ContextBuilder.buildCoreContext(char, userProfile, false);
    let status = '(最近无私聊，生活平淡)';
    try {
        const msgs = await DB.getMessagesByCharId(char.id);
        if (msgs.length > 0) {
            status = `(最近私聊状态: 刚和用户聊过 "${String(msgs[msgs.length - 1].content || '').substring(0, 20)}...")`;
        }
    } catch (e) {}
    return `<<< 角色档案: ${char.name} (charId="${char.id}") >>>\n${core}\n${status}\n<<< 档案结束 >>>`;
};

const pickRandom = <T,>(arr: T[], n: number): T[] =>
    [...arr].sort(() => 0.5 - Math.random()).slice(0, n);

/** 把 LLM 返回的混合评论数组（角色 charId / NPC npcName）解析成 SocialComment 列表 */
const parseMixedComments = (
    raw: any,
    characters: CharacterProfile[],
    userName: string,
): SocialComment[] => {
    const out: SocialComment[] = [];
    // replyToName 按"楼上同名评论"回链，模拟评论区的有来有回
    const lastIdByName: Record<string, string> = {};
    (Array.isArray(raw) ? raw : []).forEach((cm: any) => {
        const text = String(cm?.content || '').trim();
        if (!text) return;
        const commenter = charById(characters, cm?.charId);
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
        } else if (npcName && npcName !== userName) {
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
 * 「刷新」轮：生成角色 + NPC（用户的亲友圈）的新朋友圈动态。
 * - 角色严格按人设决定发不发：高冷/社恐的可以一条不发；
 * - NPC 帖围绕用户资料虚构亲友（闺蜜/父母/同事…），让朋友圈像真实社交圈；
 * - 每条动态都带至少 10 条评论（角色+NPC 混合，有来有回），并按内容判断热度（爆火帖更热闹）。
 * 帖子一律纯文本（绝不让 LLM 编造图片 URL），可带位置、可转发已有公开帖。
 */
export const generateCharacterMoments = async (params: {
    apiConfig: APIConfig;
    characters: CharacterProfile[];
    userProfile: UserProfile;
    feed: SocialPost[];
}): Promise<SocialPost[]> => {
    const { apiConfig, characters, userProfile, feed } = params;
    if (characters.length === 0) return [];

    const selected = pickRandom(characters, Math.min(4, characters.length));
    const blocks = await Promise.all(selected.map(c => buildCharBlock(c, userProfile)));
    const roster = characters.map(c => `- charId="${c.id}" 名字:"${c.name}"`).join('\n');
    // 已出现过的 NPC 名字：让亲友圈是"回头客"而不是每轮全新陌生人
    const knownNpcNames = Array.from(new Set(
        feed.filter(p => p.authorType === 'stranger').map(p => p.authorName)
    )).slice(0, 12);

    const prompt = `### 任务: 模拟微信朋友圈（刷新一轮）
请生成一批新的朋友圈动态，分两类：

A. **角色动态** —— 下面列出的候选角色，【严格按人设决定发不发】：高冷、社恐、不爱网上冲浪的角色这一轮可以一条都不发（直接不输出条目）；爱分享的可以发 1~2 条。内容要贴合人设、近况和说话风格：生活碎片、心情、吐槽、或暗戳戳的小心思，长短不一才真实。

B. **NPC 动态** —— ${userProfile.name} 朋友圈里的虚构亲友：闺蜜、死党、爸妈、亲戚、同学、同事等，生成 2~4 条。NPC 的身份和昵称要像真实微信好友（如"老妈"、"莉莉酱🍓"、"工位邻居老王"），内容贴合用户资料里的生活背景（家长里短、晒娃晒饭、加班吐槽、旅行打卡、转发养生文……）。

### 用户资料（NPC 关系网围绕 TA 展开）
名字: ${userProfile.name}
简介: ${userProfile.bio || '（没写简介）'}
${knownNpcNames.length > 0 ? `已出现过的亲友（优先沿用这些人，保持人物连续性）: ${knownNpcNames.join('、')}` : ''}

### 本轮候选发动态的角色
${blocks.join('\n\n')}

### 全部角色名单（评论/点赞可用）
${roster}

### 朋友圈现有动态（可选择转发其中某条，转发时填 repostOfPostId）
${feedDigest(feed, characters, userProfile.name)}

### 规则
1. 动态是纯文字，**禁止**编造任何图片 URL 或描述"[图片]"占位。
2. location 可选：偶尔带一个符合身份的地点（如"老城区·巷口咖啡"），大多数动态不带。
3. 转发(repostOfPostId)是低频行为：整轮最多 1 条，且必须用上面列出的真实 postId；转发时 content 写转发语。
4. **每条动态都必须带至少 10 条评论（10~16 条）**：评论者混合「角色名单里的角色」（用 charId）和「围观的 NPC 亲友」（用 npcName）。评论要有来有回——可以用 replyToName 回复楼上某人；每条都要口语化、短、贴评论者身份。
5. heat 按内容判断这条动态的热度："normal"（普通日常）/ "hot"（小热门，有点意思）/ "viral"（爆火：内容劲爆/爆笑/感人，全朋友圈都在讨论）。爆火的动态评论给到 15~16 条、likedByNpcNames 给 10 个以上。
6. **绝对禁止**以用户 "${userProfile.name}" 的身份发动态、点赞或评论。
7. 禁止上帝视角，角色不知道自己是 AI，NPC 是普通人。

### 输出格式 (JSON Array)
[
  {
    "authorKind": "character 或 npc",
    "charId": "角色帖必填：发布者 charId",
    "npcName": "NPC 帖必填：NPC 的微信昵称",
    "npcRelation": "NPC 帖可选：与用户的关系（闺蜜/妈妈/同事…）",
    "content": "动态文字内容",
    "location": "可选，所在位置",
    "repostOfPostId": "可选，转发的原帖 postId",
    "heat": "normal|hot|viral",
    "likedByCharIds": ["点赞角色的 charId"],
    "likedByNpcNames": ["点赞的 NPC 昵称"],
    "comments": [
      { "charId": "角色评论填 charId", "content": "评论内容", "replyToName": "可选，回复楼上谁" },
      { "npcName": "NPC 评论填昵称", "content": "评论内容" }
    ]
  }
]`;

    const json = await callLLM(apiConfig, prompt, 0.95, 16000);
    const now = Date.now();
    const posts: SocialPost[] = [];

    json.forEach((item: any, idx: number) => {
        const content = String(item?.content || '').trim();
        if (!content) return;

        // 作者归属：角色帖按 charId；NPC 帖按 npcName（禁止冒充用户）
        const author = charById(characters, item?.charId);
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
        } else if (npcName && npcName !== userProfile.name) {
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
            .map((id: any) => charById(characters, id))
            .filter((c?: CharacterProfile): c is CharacterProfile => !!c && c.id !== authorCharId)
            .map((c: CharacterProfile) => ({ id: c.id, name: c.name }));
        const npcLikes = (Array.isArray(item?.likedByNpcNames) ? item.likedByNpcNames : [])
            .map((n: any) => String(n || '').trim())
            .filter((n: string) => !!n && n !== userProfile.name && n !== authorName)
            .slice(0, 20)
            .map((n: string) => ({ id: `npc-${n}`, name: n }));
        const likedBy = [...charLikes, ...npcLikes];

        const comments = parseMixedComments(item?.comments, characters, userProfile.name);
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
        .map(id => charById(characters, id))
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
        ? `用户发动态时特意"提醒了"这些角色看: ${mentioned.map(c => `${c.name}(charId="${c.id}")`).join('、')}。**这些角色必须各产生至少一次互动**（点赞或评论）。`
        : '本条动态没有特别提醒谁看。';

    const prompt = `### 任务: 模拟微信朋友圈互动
用户 "${userProfile.name}" 刚发了一条新动态（下方第一条 postId="${post.id}"）。请根据各角色人设，生成他们的互动行为。

### 参与互动的角色
${blocks.join('\n\n')}

### 朋友圈动态（第一条是用户刚发的新动态，优先互动它；其余可顺手互动）
${targetDigest}

### 规则
1. ${mentionNote}
2. 每个角色对用户新动态的反应要符合人设：有人秒赞，有人认真评论，有人只是潜水路过（潜水的就不要输出条目）。总计 2~7 个操作。
3. action 取值: "like" | "comment" | "repost"。comment 必须填 content；repost 必须填 content（转发语），转发是低频行为（最多 1 条）。
4. 回复已有评论时，在 comment 操作里填 replyToCommentId（必须用上面列出的真实 commentId）。
5. 角色之间也可以互相点赞/评论（对其它 postId 操作），但用户的新动态是主角。
6. **绝对禁止**以用户 "${userProfile.name}" 的身份做任何操作。
7. 评论是口语化的朋友圈短评，不要长篇大论。禁止编造图片。

### 输出格式 (JSON Array)
[
  { "charId": "角色 charId", "postId": "目标 postId", "action": "like|comment|repost", "content": "评论或转发语", "replyToCommentId": "可选" }
]`;

    const json = await callLLM(apiConfig, prompt, 0.9, 4000);
    const ops: ReactionOp[] = [];
    let repostUsed = false;

    json.forEach((item: any) => {
        const actor = charById(characters, item?.charId);
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

    const prompt = `### 任务: 回应用户的朋友圈评论
**动态作者**: ${post.authorType === 'user' ? `${post.authorName}(用户本人)` : post.authorName}
**动态内容**: "${postDisplayText(post).slice(0, 120)}"${post.repostOf ? `\n(转发自 ${post.repostOf.authorName}: ${post.repostOf.content.slice(0, 40)})` : ''}
**已有评论**:
${cmts || '(暂无)'}
**用户 "${userProfile.name}" 刚发的评论**: "${userComment.content}"
${replyContext}

### 候选回应角色
${blocks.join('\n\n')}

### 规则
1. 生成 0~2 条对用户这条评论的回复，要扣题、口语化、符合各自人设；没必要回的角色就不输出。
2. **绝对禁止**以用户 "${userProfile.name}" 的身份回复。
3. 只能用候选角色的 charId。

### 输出格式 (JSON Array)
[
  { "charId": "角色 charId", "content": "回复内容" }
]`;

    const json = await callLLM(apiConfig, prompt, 0.9, 2000);
    const replies: SocialComment[] = [];
    json.forEach((item: any) => {
        const actor = candidates.find(c => c.id === item?.charId) || charById(characters, item?.charId);
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
