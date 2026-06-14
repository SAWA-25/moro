import { APIConfig, CharacterProfile, UserProfile, XhsFeedComment, XhsFeedPost, XhsStockImage } from '../types';
import { safeResponseJson, extractContent } from './safeApi';

/**
 * 小红书 App 本地生成信息流。
 *
 * 不依赖小红书 MCP：刷新时调用 LLM 一次性生成一批（≥16 条）帖子，混合「角色帖」
 * （从用户的角色里抽几位，按其人设发帖）与「NPC 帖」（LLM 虚构的普通小红薯）。
 * 帖子持久化在 IndexedDB（xhs_feed_posts），用户可点赞 / 收藏 / 评论 / 转发；
 * 评论后帖子作者（角色或 NPC）会回一条评论。
 */

export const FEED_BATCH_SIZE = 20;

/** 每条帖子展示/保留的评论上限（生成时截断） */
export const FEED_COMMENTS_PER_POST = 40;

/**
 * 热门话题池：小红书常见的话题/圈子。每次刷新随机抽一小撮喂给模型，
 * 让 tags 与正文围绕这些「话题」展开，刷出来更有「话题感」、彼此能聚成圈。
 */
export const FEED_TOPIC_POOL: string[] = [
    // 生活方式
    '今日穿搭', 'OOTD', '极简生活', '断舍离', '租房改造', '小户型', '一人食', '深夜放毒', '减脂餐', '探店',
    'citywalk', '周末去哪儿', '露营', '徒步', '骑行', '公园20分钟', '搭子文化', '独居日常', '搬家日记',
    // 情绪 / 成长
    'emo文学', '人间清醒', '自我和解', '内耗自救', 'i人日常', 'e人出没', '搞钱', '副业', '考公考编', '在职读研',
    '日签', '碎碎念', '今天也要好好生活', '情绪价值', '反焦虑',
    // 兴趣 / 收藏
    '手账', '谷子', '盲盒', '黑胶', '胶片摄影', '宝丽来', '手作', '编织', '陶艺', '油画棒',
    'cosplay', '汉服', 'jk', '二次元', '游戏日常', '原神', '乙游', '追剧', '书单', '播客推荐',
    // 萌宠 / 家居
    '我家狗子', '橘猫预警', '云吸猫', '多肉', '养花', '阳台花园', '家居好物', '氛围感',
    // 美食 / 旅行
    '咖啡日记', '美式上瘾', '面包控', '甜品', '火锅自由', '家常菜', '小众旅行地', '机票捡漏', '酒店测评', '特种兵旅游',
    // 颜值 / 学习
    '伪素颜', '早C晚A', '香水分享', '健身打卡', '普拉提', '学习搭子', '通勤穿搭', '职场穿搭', '考研倒计时',
    // 数码 / 职场 / 母婴 / 更多圈子
    '数码好物', '电子榨菜', '机械键盘', 'ipad生产力', '打工人午餐', '工位改造', '裸辞', 'gap year', '搞副业',
    '理财日记', '基金定投', '记账', '考证打卡', '雅思备考', '留学日记', '相亲奇遇', '恋爱脑自救', '分手疗愈',
    '母婴日常', '辅食记录', '幼儿园那些事', '老破小爆改', '宿舍改造', '化妆教程', '美甲分享', '医美避雷',
    '骨折现场', '钓鱼佬', '飞盘', '滑雪', '陆冲', '飞盘搭子', 'livehouse', '音乐节', '脱口秀开放麦', '剧本杀',
    '盘串', '多肉爆崽', '阳台种菜', '咖啡拉花', '手冲', '威士忌', '精酿', '夜跑', '早八人', '熬夜冠军',
];

/** 从话题池里随机抽 n 个不重复话题 */
const pickTopics = (n: number): string[] => {
    const pool = [...FEED_TOPIC_POOL];
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, Math.min(n, pool.length));
};

const callLlm = async (apiConfig: APIConfig, systemPrompt: string, userMessage: string): Promise<string> => {
    const baseUrl = apiConfig.baseUrl.replace(/\/+$/, '');
    const resp = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiConfig.apiKey || 'sk-none'}`,
        },
        body: JSON.stringify({
            model: apiConfig.model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userMessage },
            ],
            temperature: 0.9,
            // 帖子多 + 每帖评论多，给足额度，避免默认 max_tokens 截断导致 JSON 解析失败
            max_tokens: 8000,
            stream: false,
        }),
    });
    if (!resp.ok) throw new Error(`LLM API ${resp.status}`);
    const data = await safeResponseJson(resp);
    return (extractContent(data) || '').trim();
};

/** 剥离 ```json 围栏后解析 JSON；失败时尝试截取首个 [ … ] 区间再解析 */
const parseJsonLoose = (raw: string): any => {
    let text = raw.replace(/```(?:json)?/gi, '').trim();
    try { return JSON.parse(text); } catch { /* fallthrough */ }
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start >= 0 && end > start) {
        try { return JSON.parse(text.slice(start, end + 1)); } catch { /* fallthrough */ }
    }
    throw new Error('生成结果不是合法 JSON');
};

const uid = (): string =>
    (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`;

/** 抽取参与本批发帖的角色（最多 4 位，随机），给 LLM 的人设摘要 */
const pickPosterChars = (characters: CharacterProfile[], max = 4): CharacterProfile[] => {
    const pool = [...characters];
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, max);
};

const buildFeedSystemPrompt = (chars: CharacterProfile[], userProfile: UserProfile): string => {
    const charLines = chars.map((c, i) => {
        const persona = (c.description || c.systemPrompt || '').replace(/\s+/g, ' ').slice(0, 300);
        const handle = c.socialProfile?.handle ? `（账号名也可用 ${c.socialProfile.handle}）` : '';
        return `${i + 1}. 「${c.name}」${handle}：${persona || '（无人设描述）'}`;
    }).join('\n');
    const topics = pickTopics(22);
    const charPostCount = chars.length ? Math.min(chars.length, 7) : 0;
    return `你是小红书信息流生成器，为一个虚拟手机系统生成一批逼真的小红书帖子。

## 可发帖的角色（用户认识的人，帖子要完全符合各自人设、生活背景与口吻）
${charLines || '（本批没有角色，全部生成 NPC 帖）'}

## 用户
浏览这些帖子的用户叫「${userProfile.name}」。角色的帖子可以隐约透出 TA 们最近的生活状态，但不要直接 @ 用户。

## 本批可围绕的热门话题（可选，自然融入 tags 与正文，让帖子有话题感、能聚成圈；也可自行发挥别的话题）
${topics.join('、')}

## 要求
- 一次生成 ${FEED_BATCH_SIZE} 条帖子：其中角色帖 ${chars.length ? `${charPostCount} 条左右（作者从上面角色里选，author 必须与角色名完全一致，isCharacter=true，不要重复同一个角色超过 3 条）` : '0 条'}，其余为 NPC 帖（虚构形形色色的普通小红薯：学生、上班族、宝妈、店主、博主、自由职业者、退休阿姨等，isCharacter=false，昵称要像真实小红书用户）。
- 帖子题材要拉开差距、尽量覆盖更多不同话题/圈子：日常碎片、美食探店、穿搭、旅行、情绪树洞、搞钱副业、学习考证、宠物、家居改造、二手交易、兴趣手作、追剧追番、健身、数码测评、母婴、职场、恋爱情感、运动户外等，文风像真实小红书（口语化、带 emoji、适当换行）。
- title ≤ 20 字；body 80~300 字；tags 4~8 个（不带 # 号，尽量贴合上面的话题或题材，方便聚合成圈）；likes 为 0~9999 的整数，分布要自然（大多数几十到几百，偶有爆款上千）。
- 每条帖子带 8~16 条评论（让热门帖更有「评论区」氛围）：author 为虚构昵称，content 口语化、有互动感，可以有人附和、提问、玩梗、抬杠、盖楼；其中可有 1~2 条「热评」likes 偏高（几十到几百），其余 likes 0~500。
- 只输出 JSON 数组，不要任何解释或围栏外文字。格式：
[{"author":"昵称","isCharacter":false,"title":"…","body":"…","tags":["…"],"likes":123,"comments":[{"author":"…","content":"…","likes":3}]}]`;
};

/** 刷新信息流：LLM 生成一批帖子（角色帖 + NPC 帖），映射回 XhsFeedPost */
export const generateFeedBatch = async (
    apiConfig: APIConfig,
    characters: CharacterProfile[],
    userProfile: UserProfile,
    stockImages: XhsStockImage[] = [],
): Promise<XhsFeedPost[]> => {
    const posters = pickPosterChars(characters);
    const raw = await callLlm(
        apiConfig,
        buildFeedSystemPrompt(posters, userProfile),
        `现在是 ${new Date().toLocaleString('zh-CN')}，生成 ${FEED_BATCH_SIZE} 条新帖子。`,
    );
    const arr = parseJsonLoose(raw);
    if (!Array.isArray(arr) || arr.length === 0) throw new Error('生成结果为空');

    const now = Date.now();
    const usedCovers = new Set<string>();
    const pickCover = (): string | undefined => {
        // 三成概率配一张图库封面（不重复），图库为空则全部走渐变占位
        const candidates = stockImages.filter(img => img.url && !usedCovers.has(img.url));
        if (!candidates.length || Math.random() > 0.3) return undefined;
        const img = candidates[Math.floor(Math.random() * candidates.length)];
        usedCovers.add(img.url);
        return img.url;
    };

    return arr.map((p: any, i: number): XhsFeedPost => {
        const authorName = String(p?.author || '小红薯').slice(0, 24);
        const matched = p?.isCharacter ? posters.find(c => c.name === authorName) : undefined;
        const comments: XhsFeedComment[] = Array.isArray(p?.comments)
            ? p.comments.slice(0, FEED_COMMENTS_PER_POST).map((cm: any): XhsFeedComment => ({
                id: uid(),
                author: String(cm?.author || '小红薯').slice(0, 24),
                content: String(cm?.content || '').slice(0, 500),
                likes: Math.max(0, Math.floor(Number(cm?.likes) || 0)),
                timestamp: now - Math.floor(Math.random() * 86400000),
            })).filter((cm: XhsFeedComment) => cm.content)
            : [];
        return {
            id: uid(),
            authorType: matched ? 'character' : 'npc',
            charId: matched?.id,
            author: matched?.name || authorName,
            authorAvatar: matched?.avatar,
            title: String(p?.title || '').slice(0, 40) || '（无标题）',
            body: String(p?.body || '').slice(0, 2000),
            tags: Array.isArray(p?.tags) ? p.tags.slice(0, 8).map((t: any) => String(t).replace(/^#/, '').slice(0, 20)).filter(Boolean) : [],
            coverUrl: pickCover(),
            likes: Math.max(0, Math.floor(Number(p?.likes) || 0)),
            favs: Math.floor(Math.max(0, Math.floor(Number(p?.likes) || 0)) * (0.1 + Math.random() * 0.3)),
            comments,
            // 错开发布时间：最近 48 小时内随机分布，保持「刚刷出来」的新帖在前
            createdAt: now - i * 1000 - Math.floor(Math.random() * 48 * 3600 * 1000 * (i / Math.max(arr.length, 1))),
        };
    });
};

/** 用户评论后，帖子作者（角色按人设 / NPC 按帖子口吻）回一条评论 */
export const generateAuthorReply = async (
    apiConfig: APIConfig,
    post: XhsFeedPost,
    userComment: string,
    userProfile: UserProfile,
    authorChar?: CharacterProfile,
): Promise<XhsFeedComment> => {
    const personaLine = authorChar
        ? `你是「${authorChar.name}」，人设：${(authorChar.description || authorChar.systemPrompt || '').replace(/\s+/g, ' ').slice(0, 300)}。评论者「${userProfile.name}」是你认识的人，按你们的关系和你的口吻回复。`
        : `你是小红书博主「${post.author}」，按这篇帖子的口吻回复评论。评论者是陌生网友。`;
    const raw = await callLlm(
        apiConfig,
        `${personaLine}
只输出回复文本本身（≤80 字，口语化，可带 emoji），不要任何前缀、引号或解释。`,
        `你的帖子《${post.title}》正文：${post.body.slice(0, 400)}

「${userProfile.name}」刚刚评论了：「${userComment}」

写你的回复：`,
    );
    return {
        id: uid(),
        author: post.author,
        charId: post.charId,
        content: raw.replace(/^["「『]|["」』]$/g, '').slice(0, 200) || '谢谢你的评论～',
        likes: 0,
        timestamp: Date.now(),
    };
};
