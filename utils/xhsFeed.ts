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
            // 帖子多 + 每帖评论多，给足额度，避免被 max_tokens 截断导致 JSON 不合法
            // （实测 gemini 等会一路写到上限：8000 常被截在半个对象里，整批 JSON 报废）。
            max_tokens: 16000,
            stream: false,
        }),
    });
    if (!resp.ok) throw new Error(`LLM API ${resp.status}`);
    const data = await safeResponseJson(resp);
    return (extractContent(data) || '').trim();
};

/** 从一段文本里逐个抠出「完整的」顶层 {…} 对象（正确处理字符串/转义），丢弃被截断的最后一个。 */
const salvageObjects = (s: string): any[] => {
    const out: any[] = [];
    let depth = 0, startIdx = -1, inStr = false, esc = false;
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (inStr) {
            if (esc) esc = false;
            else if (ch === '\\') esc = true;
            else if (ch === '"') inStr = false;
            continue;
        }
        if (ch === '"') { inStr = true; continue; }
        if (ch === '{') { if (depth === 0) startIdx = i; depth++; }
        else if (ch === '}') {
            if (depth > 0) depth--;
            if (depth === 0 && startIdx >= 0) {
                try { out.push(JSON.parse(s.slice(startIdx, i + 1))); } catch { /* 跳过坏对象 */ }
                startIdx = -1;
            }
        }
    }
    return out;
};

/** 剥离 ```json 围栏后解析 JSON；失败时截取首个 [ … ] 区间再解析；仍失败则按完整对象兜底打捞
 *  （帖子多/评论多时一旦被 max_tokens 截断，整批 JSON 不再合法——兜底能保住已完成的那部分帖子）。 */
/** 若模型把数组包进了对象（如 {"posts":[…]} / {"feed":[…]}），取出其中第一个数组属性。 */
const unwrapArray = (v: any): any => {
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object') {
        const arr = Object.values(v).find(x => Array.isArray(x));
        if (Array.isArray(arr)) return arr;
    }
    return v;
};

const parseJsonLoose = (raw: string): any => {
    let text = raw.replace(/```(?:json)?/gi, '').trim();
    try { return unwrapArray(JSON.parse(text)); } catch { /* fallthrough */ }
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start >= 0 && end > start) {
        try { return JSON.parse(text.slice(start, end + 1)); } catch { /* fallthrough */ }
    }
    if (start >= 0) {
        const objs = salvageObjects(text.slice(start + 1));
        if (objs.length) return objs;
    }
    // 整体没有 [ … ]，但可能是 {"posts":[…]} 被截断：从首个 { 后打捞完整对象
    const objStart = text.indexOf('{');
    if (objStart >= 0) {
        const objs = salvageObjects(text.slice(objStart));
        if (objs.length) return objs;
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
    const charPostCount = chars.length ? Math.min(chars.length, 5) : 0;
    const longMin = Math.max(4, Math.round(FEED_BATCH_SIZE * 0.4)); // 至少四成是有内容的长帖
    return `你是最懂小红书的资深博主兼运营，为一个虚拟手机系统生成一屏**像真人真事、能让人想点进去看**的小红书帖子。真实小红书不是全是一句话水帖：有随手碎片，也有把一件事讲得有起承转合、有干货、有情绪的长帖（探店测评、旅行记录、情感长文、避雷开箱、经验贴）。坚决避免「只有标题、正文一句话就没了」的空壳帖。

## 可发帖的角色（用户认识的人，帖子要完全符合各自人设、生活背景与口吻）
${charLines || '（本批没有角色，全部生成 NPC 帖）'}

## 用户
浏览这些帖子的用户叫「${userProfile.name}」。角色的帖子可以隐约透出 TA 们最近的生活状态，但不要直接 @ 用户。

## 本批可围绕的热门话题（自然融入 tags 与正文，让帖子有话题感、能聚成圈；也可自行发挥别的话题）
${topics.join('、')}

## 硬性要求
1. 一次生成 ${FEED_BATCH_SIZE} 条帖子：角色帖 ${chars.length ? `${charPostCount} 条左右（作者从上面角色里选，author 与角色名完全一致，isCharacter=true，**同一个角色最多发 1 条**）` : '0 条'}，其余为 NPC 帖（虚构形形色色的普通小红薯：学生、上班族、宝妈、店主、博主、自由职业者、退休阿姨、健身教练、程序员…，isCharacter=false，昵称像真实小红书用户、各不相同）。
2. **长短结合**：其中至少 ${longMin} 条是**有实质内容的长帖**（body 150~400 字、可分 2~4 段，把一件事讲清楚——有背景、有过程、有细节/干货、有情绪或观点、结尾带钩子或总结）；其余可以是短帖（几十字），但也要是具体的一件事，不能是空泛模板。
3. **题材拉开差距、要有新意**：覆盖美食探店、旅行、穿搭、情绪树洞、搞钱副业、学习考证、宠物、家居改造、二手交易、兴趣手作、追剧追番、健身、数码测评、母婴、职场、恋爱情感、运动户外等不同圈子；情感/八卦/树洞类要把事讲完整（起因经过+细节+心情），**绝不能只有标题或一句话**。具体到人物、地点、数字、对话才像真事，避免「今天好累」「求安慰」这种空壳。
4. **不重复**：标题不重样、题材不撞车、昵称不重复。
5. title 有钩子；tags 4~8 个（不带 #，贴合话题便于聚合）；likes 0~9999、分布自然（多数几十到几百、偶有爆款上千）。
6. 每条帖子带 3~6 条评论（让热门帖有「评论区」氛围）：author 为各异的虚构昵称，content 口语化有互动感（附和/提问/玩梗/抬杠/求链接），可有 1 条「热评」likes 偏高，其余 0~500。

**务必输出完整且合法的 JSON**：只输出一个紧凑的 JSON 数组（无多余空白、无 markdown 围栏、无解释），把 ${FEED_BATCH_SIZE} 条全部写完、最后用 ] 收尾，绝不中途截断。长帖该长就长，但要保证整批写完。格式：
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

    // 去重：标题撞车的丢掉；同一实名角色只当一次作者（其余转 NPC），治「重复话题/重复角色」
    const seenTitle = new Set<string>();
    const usedChar = new Set<string>();
    return arr.filter((p: any) => {
        const t = String(p?.title || '').trim().toLowerCase().replace(/\s+/g, '');
        if (t && seenTitle.has(t)) return false;
        if (t) seenTitle.add(t);
        return true;
    }).map((p: any, i: number): XhsFeedPost => {
        const authorName = String(p?.author || '小红薯').slice(0, 24);
        let matched = p?.isCharacter ? posters.find(c => c.name === authorName) : undefined;
        if (matched && usedChar.has(matched.id)) matched = undefined; // 角色已发过→当 NPC
        if (matched) usedChar.add(matched.id);
        const comments: XhsFeedComment[] = Array.isArray(p?.comments)
            ? p.comments.slice(0, FEED_COMMENTS_PER_POST).map((cm: any): XhsFeedComment => ({
                id: uid(),
                author: String(cm?.author || '小红薯').slice(0, 24),
                content: String(cm?.content || '').trim(),
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
            title: String(p?.title || '').trim() || '（无标题）',
            body: String(p?.body || '').trim(),
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
只输出回复文本本身（口语化、可长可短、可带 emoji），不要任何前缀、引号或解释。`,
        `你的帖子《${post.title}》正文：${post.body.slice(0, 400)}

「${userProfile.name}」刚刚评论了：「${userComment}」

写你的回复：`,
    );
    return {
        id: uid(),
        author: post.author,
        charId: post.charId,
        content: raw.replace(/^["「『]|["」』]$/g, '').trim() || '谢谢你的评论～',
        likes: 0,
        timestamp: Date.now(),
    };
};
