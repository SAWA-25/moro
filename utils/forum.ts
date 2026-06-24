/**
 * 茶话亭 —— 一个持久、可浏览的论坛（区别于折子戏里「番外·匿名论坛」的一次性仿真截图）。
 *
 * 板块 → 帖子 → 跟帖。用户能发帖/回帖；点「召唤网友盖楼」用副 API 生成一批跟帖：
 * 一部分来自你的角色（按人设、实名出镜），一部分来自匿名网友（现编网名）。整盘存 localStorage。
 *
 * 纯数据 + 纯函数（prompt 组装 / 解析 / 模板兜底 / 种子），不碰 DB / React。
 */

export interface ForumBoard { id: string; name: string; emoji: string; desc: string; }

export const FORUM_BOARDS: ForumBoard[] = [
    { id: 'chat', name: '水区', emoji: '🫧', desc: '随便聊，灌水划水' },
    { id: 'emo', name: '树洞', emoji: '🌧️', desc: '情绪/情感，悄悄说' },
    { id: 'gossip', name: '吃瓜', emoji: '🍉', desc: '八卦广场，蹲后续' },
    { id: 'hobby', name: '同好', emoji: '🎏', desc: '兴趣/安利/搭子' },
    { id: 'help', name: '求助', emoji: '❓', desc: '在线等，挺急的' },
];

export const boardOf = (id: string): ForumBoard | undefined => FORUM_BOARDS.find(b => b.id === id);

export type AuthorType = 'user' | 'char' | 'npc';

/** 楼中楼：对某层楼的嵌套回复（百度贴吧式）。 */
export interface ForumSubReply {
    id: string;
    authorType: AuthorType;
    authorId?: string;
    authorName: string;
    avatar?: string;
    body: string;
    createdAt: number;
}

export interface ForumReply {
    id: string;
    floor: number;
    authorType: AuthorType;
    authorId?: string;        // char id（authorType==='char'）
    authorName: string;
    avatar?: string;          // char 头像；npc 走 emoji 兜底
    body: string;
    createdAt: number;
    likes: number;
    isOp?: boolean;           // 是否楼主（与帖子作者同名）
    subReplies?: ForumSubReply[]; // 楼中楼
}

export interface ForumPost {
    id: string;
    boardId: string;
    authorType: AuthorType;
    authorId?: string;
    authorName: string;
    avatar?: string;
    title: string;
    body: string;
    createdAt: number;
    lastActiveAt: number;
    likes: number;
    replies: ForumReply[];
    replyCount?: number;   // 帖子「声称」的总楼层（30~几百），楼层懒加载到此数
    hot?: boolean;         // 热帖标记（贴吧式）
    generated?: boolean;   // 是否 AI 实时生成（区别于种子/用户帖）
}

export interface ForumState { posts: ForumPost[]; }

let _seq = 0;
export const fid = (): string => `${Date.now().toString(36)}${(_seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];

// 匿名网友：网名池 + 头像 emoji 池（按名字 hash 取，稳定）
const NICKS = ['夜航船', '一只柠檬精', '路过的咸鱼', '奶茶续命中', '不想上班', '月半月半', '蹲一个后续', '隔壁老王', '今天也emo', '吃瓜群众A', '风很温柔', '半糖去冰', '深夜买买买', '社恐本恐', '猫猫虫', '楼上说得对', '清醒的醉鬼', '一杯白开水'];
const NPC_EMOJI = ['🐱', '🐰', '🦊', '🐼', '🐧', '🐸', '🦉', '🌝', '🍋', '🫧', '🌵', '🐳'];
export const npcEmoji = (name: string): string => {
    let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
    return NPC_EMOJI[Math.abs(h) % NPC_EMOJI.length];
};

const NETIZEN_LINES = [
    '前排，蹲后续。', '我嘞个豆，这也太真实了。', '握手，原来不止我一个。', '楼主清醒一点（拍肩）。',
    'laugh死，这评论区比帖子好看。', '默默点了个赞。', '说出了我的心声呜呜。', '理性建议：早点睡。',
    '又是被共鸣到的一天。', '蹲一个，顺便许愿。', '这届网友很会啊。', '路过，给楼主递茶。🍵',
];

/**
 * 帖子「声称」的总楼层数：贴吧帖子有的几十楼、有的几百楼。
 * 加权偏向 30~150，偶尔窜到几百（最高 ~588）。最低 30。
 */
export function targetFloorCount(seed?: number): number {
    const r = typeof seed === 'number' ? Math.abs(Math.sin(seed) ) : Math.random();
    // 70% 落在 30~150；24% 落在 150~320；6% 爆楼 320~588
    if (r < 0.70) return 30 + Math.floor((r / 0.70) * 120);          // 30~150
    if (r < 0.94) return 150 + Math.floor(((r - 0.70) / 0.24) * 170); // 150~320
    return 320 + Math.floor(((r - 0.94) / 0.06) * 268);               // 320~588
}

/** 模板兜底：没配 API / 生成失败时也能盖几层楼。 */
export function fallbackReplies(count: number): { name: string; body: string }[] {
    const used = new Set<string>();
    const out: { name: string; body: string }[] = [];
    for (let i = 0; i < count; i++) {
        let nick = pick(NICKS); let guard = 0;
        while (used.has(nick) && guard++ < 8) nick = pick(NICKS);
        used.add(nick);
        out.push({ name: nick, body: pick(NETIZEN_LINES) });
    }
    return out;
}

/** 开局种子：两条无角色依赖的氛围帖，避免空荡荡。 */
export function seedForum(): ForumState {
    const now = Date.now();
    const mk = (boardId: string, title: string, body: string, ago: number, replies: { n: string; b: string }[]): ForumPost => {
        const created = now - ago;
        return {
            id: fid(), boardId, authorType: 'npc', authorName: pick(NICKS), title, body,
            createdAt: created, lastActiveAt: created + 60000, likes: Math.floor(Math.random() * 30),
            replies: replies.map((r, i) => ({ id: fid(), floor: i + 2, authorType: 'npc', authorName: r.n, body: r.b, createdAt: created + (i + 1) * 60000, likes: Math.floor(Math.random() * 10) })),
            replyCount: 30 + Math.floor(Math.random() * 60),
        };
    };
    return {
        posts: [
            mk('emo', '深夜睡不着，有人在吗', '白天好好的，一到夜里思绪就停不下来。来报个到，让我知道不止我一个。', 3600_000 * 2,
                [{ n: '夜航船', b: '在的在的，陪你熬。' }, { n: '今天也emo', b: '握手，刚关灯又坐起来了。' }]),
            mk('gossip', '你们是怎么发现自己心动的？', '突然就很在意对方有没有回消息，是不是有点不对劲了……蹲一波经验。', 3600_000 * 5,
                [{ n: '半糖去冰', b: '会反复看聊天记录就是了。' }, { n: '风很温柔', b: '心动藏不住的，自己最后一个知道。' }]),
        ],
    };
}

// ── 副 API 生成跟帖 ──────────────────────────────────────────────────────

export interface CharBrief { id: string; name: string; persona?: string; }

export interface RawReply { name: string; body: string; reply_to?: string; }

export function buildForumPrompt(
    post: Pick<ForumPost, 'title' | 'body' | 'boardId'>,
    chars: CharBrief[],
    count: number,
    startFloor = 2,
): { system: string; user: string } {
    const board = boardOf(post.boardId);
    const roster = chars.slice(0, 6).map(c => `- ${c.name}：${(c.persona || '').slice(0, 120) || '（无设定）'}`).join('\n');
    const system = '你在为一个网络论坛（百度贴吧风格）生成「跟帖区」楼层。跟帖要口语、简短、风格各异（有人共鸣、有人吐槽、有人抬杠玩梗、有人认真建议、有人单纯顶帖/接楼），像真实网友盖楼。';
    const endFloor = startFloor + count - 1;
    const user = `板块：${board?.emoji || ''}${board?.name || ''}
帖子标题：「${post.title}」
正文：${post.body || '（无）'}

下面这些是「实名出镜」的网友（你认识的角色），他们也可能来盖楼，请严格用其本名、并贴合各自人设说话：
${roster || '（暂无实名角色）'}

请生成 ${count} 条跟帖（这是第 ${startFloor}~${endFloor} 楼）：其中若干条来自上面的实名角色（用其本名、合乎人设地回应），其余来自匿名网友（你为每位现编一个有网感的网名，可重复出现像在对话）。
- 口语、自然、有梗、不复读、有来有回，长短随意、不限字数；
- 让其中 2~4 条带 "reply_to" 字段（楼中楼，回复前面某位网友的名字），形成对话感；
只输出一个 JSON 数组，不要任何多余文字或代码块标记：
[{"name":"网友名","body":"跟帖内容","reply_to":"（可选）被回复者网名"}]`;
    return { system, user };
}

/**
 * 健壮解析「一批扁平对象」：先整体 JSON.parse，失败/截断时逐个抠出完整的 {…} 再解析。
 * 跟帖/帖子对象都是扁平的（无嵌套），被 max_tokens 截断也能把写完的那部分救回来，不整批丢。
 */
function salvageFlat(raw: string): any[] {
    const txt = (raw || '').trim().replace(/```(?:json)?/gi, '').trim();
    const s = txt.indexOf('[');
    if (s === -1) {
        const o = txt.match(/\{[^{}]*\}/);
        if (o) { try { return [JSON.parse(o[0])]; } catch { return []; } }
        return [];
    }
    const e = txt.lastIndexOf(']');
    if (e > s) {
        try { const arr = JSON.parse(txt.slice(s, e + 1)); if (Array.isArray(arr) && arr.length) return arr; } catch { /* salvage */ }
    }
    const objs = txt.slice(s).match(/\{[^{}]*\}/g) || [];
    const out: any[] = [];
    for (const o of objs) { try { out.push(JSON.parse(o)); } catch { /* skip broken tail */ } }
    return out;
}

export function parseForumReplies(raw: string): RawReply[] {
    if (!raw) return [];
    const arr = salvageFlat(raw);
    return arr
        .map((x: any) => {
            const o: RawReply = { name: String(x?.name || '').trim().slice(0, 24), body: String(x?.body || '').trim() };
            const rt = String(x?.reply_to || x?.replyTo || '').trim().slice(0, 16);
            if (rt) o.reply_to = rt;
            return o;
        })
        .filter(x => x.name && x.body)
        .slice(0, 20);
}

/** 让某个角色「开一个帖」：选板块 + 写标题正文（按人设）。 */
export function buildCharThreadPrompt(char: CharBrief): { system: string; user: string } {
    const boards = FORUM_BOARDS.map(b => `${b.id}（${b.emoji}${b.name}：${b.desc}）`).join('、');
    const system = `你是「${char.name}」，正打算上论坛发个帖子。请完全代入人设。${char.persona ? `\n【人设】${char.persona.slice(0, 400)}` : ''}`;
    const user = `从这些板块里挑一个最贴合你此刻心情的：${boards}。
然后以你的口吻发一个帖子（标题简短有钩子、正文自然展开、长短随意不限字数，像真人随手发的，不要太正式）。
只输出一个 JSON，不要多余文字或代码块标记：
{"boardId":"板块 id","title":"标题","body":"正文"}`;
    return { system, user };
}

export function parseCharThread(raw: string): { boardId: string; title: string; body: string } | null {
    if (!raw) return null;
    const txt = raw.trim().replace(/```(?:json)?/gi, '').trim();
    const s = txt.indexOf('{'); const e = txt.lastIndexOf('}');
    if (s === -1 || e === -1 || e <= s) return null;
    try {
        const o = JSON.parse(txt.slice(s, e + 1));
        const title = String(o?.title || '').trim().slice(0, 200);
        if (!title) return null;
        const boardId = boardOf(String(o?.boardId || '').trim()) ? String(o.boardId).trim() : 'chat';
        return { boardId, title, body: String(o?.body || '').trim() };
    } catch { return null; }
}

/**
 * 把「名字+正文(+reply_to)」批量落成楼层；名字命中实名角色则带上其头像/身份。
 * 带 reply_to 且能在已有楼层里找到被回复者 → 落成「楼中楼」嵌进那层，不单独占楼号。
 * opName：帖子楼主名，命中则标 isOp。
 */
export function materializeReplies(
    raw: RawReply[],
    chars: { id: string; name: string; avatar?: string }[],
    startFloor: number,
    opName?: string,
    existing: ForumReply[] = [],
): ForumReply[] {
    const now = Date.now();
    const out: ForumReply[] = [];
    const findChar = (n: string) => chars.find(c => c.name === n);
    let floor = startFloor;
    for (let i = 0; i < raw.length; i++) {
        const r = raw[i];
        const ch = findChar(r.name);
        // 楼中楼：挂到本批 / 已有楼层里同名作者的最近一层
        if (r.reply_to) {
            const host = [...existing, ...out].reverse().find(f => f.authorName === r.reply_to);
            if (host) {
                (host.subReplies ||= []).push({
                    id: fid(),
                    authorType: ch ? 'char' : 'npc',
                    authorId: ch?.id,
                    authorName: r.name,
                    avatar: ch?.avatar,
                    body: r.body,
                    createdAt: now + i * 1000,
                });
                continue;
            }
        }
        out.push({
            id: fid(),
            floor: floor++,
            authorType: ch ? 'char' : 'npc',
            authorId: ch?.id,
            authorName: r.name,
            avatar: ch?.avatar,
            body: r.body,
            createdAt: now + i * 1000,
            likes: Math.floor(Math.random() * 6),
            isOp: !!opName && r.name === opName,
        });
    }
    return out;
}

// ── 一次性生成「一批帖子」（≥10 帖，贴吧式帖子列表）─────────────────────────

/** 每个板块的「该长什么样」指引：题材方向 + 正文必须有的实质内容（避免一句话水贴）。 */
const BOARD_BRIEF: Record<string, string> = {
    chat: '日常碎片、突发奇想、玩梗、晒图、求陪伴、接龙话题。题材要具体到一件真事（不是空泛的「今天好累」）：比如「楼下早餐店老板今天多送我一个蛋」「凌晨三点的便利店遇到的怪事」。允许有水贴，但也要混入几条有头有尾、能聊起来的话题。',
    emo: '情绪树洞，但要有具体情境与细节的真实心事——交代起因、经过、此刻的感受与纠结，像深夜真的写给陌生人看的一段独白（如「和最好的朋友三年没联系了，今天刷到她结婚」）。不要只写「我好难过求安慰」一句。多数应是有内容的中长文。',
    gossip: '吃瓜八卦：每个帖子要讲清楚「一桩完整的瓜」——人物关系、起因、经过、关键细节、爆点或悬念，最后留个钩子（求鉴定/蹲后续/你们怎么看）。题材如：同事/室友/前任的离谱操作、相亲奇遇、邻里纠纷、群里塌房、撞见的狗血现场。**严禁只有标题没有内容、或正文只有一句话**——八卦贴正文必须是有细节的几段叙事。',
    hobby: '兴趣同好：安利/避雷/攻略/晒收藏/求搭子。要有具体对象与干货（具体作品、型号、玩法、踩过的坑、私藏经验），像真的在跟同好交流，不是泛泛而谈。',
    help: '在线求助：交代清楚背景、目前状况、已经试过什么、具体卡在哪、希望得到什么帮助，像真实的「在线等挺急的」帖。',
};

export function buildThreadsPrompt(
    board: ForumBoard,
    chars: CharBrief[],
    count: number,
): { system: string; user: string } {
    const roster = chars.slice(0, 6).map(c => `- ${c.name}：${(c.persona || '').slice(0, 100) || '（无设定）'}`).join('\n');
    const longMin = Math.max(3, Math.round(count * 0.4)); // 至少四成是有内容的长贴
    const system = `你是百度贴吧某个吧的资深泡吧网友，最懂真实帖子长什么样。现在为「${board.emoji}${board.name}」吧生成一屏**像真人真事、能让人想点进去看**的帖子列表。真实贴吧不是全是水贴：有灌水接龙的短帖，也有讲一件事讲得绘声绘色的长帖、有头有尾的八卦/求助/树洞。坚决避免「只有标题、正文一句话就没了」的空壳帖。`;
    const user = `板块：${board.emoji}${board.name}（${board.desc}）
本吧帖子应该是这样的：${BOARD_BRIEF[board.id] || '题材具体、有真实感，长短结合。'}

可「实名出镜」的网友（**每人最多发 1 个帖**，少数帖子由他们发，用其本名、贴合人设；其余都用你现编的、各不相同的网名）：
${roster || '（暂无实名角色）'}

一次性生成 ${count} 个帖子，硬性要求：
1. **长短结合**：其中至少 ${longMin} 个是**有实质内容的长贴**（正文 150~400 字、可分 2~4 段，把一件事讲清楚、有细节有情绪有钩子）；其余可以是短帖/水贴（几十字），但也要是具体的一件事，不能是空泛模板。
2. **八卦/吃瓜/求助/树洞类正文必须把事讲完整**，绝不允许正文只有一句话或只是复述标题。
3. **话题各不相同、有新意**：覆盖不同人物关系、场景、情绪，避免雷同套路（别一堆「今天好累」「求安慰」「有人在吗」）。具体到细节（人物、地点、数字、对话）才像真事。
4. **不重复**：标题不重样、内容不撞车；同一个实名角色不要发多个帖；网名各不相同。
5. 每帖给 "floors"（这帖大概盖了多少楼，30~588 的整数；越有料/越有争议的帖楼越多，多数 30~150、少数爆楼几百），和 "likes"（点赞数，0~9999，自然分布）。

只输出一个 JSON 数组，不要任何多余文字或代码块标记；务必把 ${count} 条全部写完、最后用 ] 收尾：
[{"author":"网名或角色本名","title":"标题","body":"正文（按上面要求，该长则长）","floors":整数,"likes":整数}]`;
    return { system, user };
}

export interface RawThread { author: string; title: string; body: string; floors: number; likes: number; }

export function parseThreads(raw: string): RawThread[] {
    if (!raw) return [];
    const arr = salvageFlat(raw);
    const seenTitle = new Set<string>();
    const out: RawThread[] = [];
    for (const x of arr) {
        const title = String(x?.title || '').trim().slice(0, 200);
        if (!title) continue;
        const key = title.toLowerCase().replace(/\s+/g, '');
        if (seenTitle.has(key)) continue;       // 去重复话题（标题撞车的丢掉）
        seenTitle.add(key);
        const floors = Math.max(30, Math.min(588, Math.floor(Number(x?.floors) || 0) || (30 + Math.floor(Math.random() * 120))));
        const likes = Math.max(0, Math.min(99999, Math.floor(Number(x?.likes) || 0) || Math.floor(Math.random() * 200)));
        out.push({ author: String(x?.author || '').trim().slice(0, 24), title, body: String(x?.body || '').trim(), floors, likes });
        if (out.length >= 24) break;
    }
    return out;
}

const FALLBACK_THREADS: Record<string, { t: string; b: string }[]> = {
    chat: [
        { t: '有没有人陪我熬夜', b: '睡不着，来个搭子一起灌水。' },
        { t: '今天份的快乐已签收', b: '一杯奶茶就能哄好，廉价又满足。' },
        { t: '工位摸鱼报到', b: '划水第八小时，假装很忙。' },
        { t: '突然好想吃火锅', b: '一个人也要吃，谁懂。' },
        { t: '楼里接龙说句晚安', b: '从你开始，一层一层传下去。' },
        { t: '存钱永远是明天的事', b: '今天先花了再说，哈哈。' },
        { t: '猫又把我吵醒了', b: '凌晨四点踩脸，气死。' },
        { t: '随手发个今日份天空', b: '云像棉花糖，拍下来存着。' },
        { t: '打工人续命指南', b: '咖啡因+不想上班=正常的我。' },
        { t: '来盖一栋摸鱼楼', b: '在的扣1，看看有多少同道中人。' },
    ],
    emo: [
        { t: '深夜的情绪又上来了', b: '白天好好的，一到夜里就崩。' },
        { t: '好像谁都不需要我', b: '说不上来的空，蹲个抱抱。' },
        { t: '又把自己熬到失眠', b: '脑子停不下来，好累。' },
        { t: '想被人好好抱一下', b: '不用说话，就抱一会儿。' },
        { t: '今天还是没能开心起来', b: '试着笑了，没成功。' },
        { t: '在树洞偷偷说句心里话', b: '其实我没有看起来那么好。' },
        { t: '害怕让别人失望', b: '所以总是先把自己累垮。' },
        { t: '一个人住的第N天', b: '安静得能听见心跳。' },
        { t: '想哭但哭不出来', b: '是不是太久没好好难过了。' },
        { t: '给今天的自己留句话', b: '辛苦了，明天再试一次。' },
    ],
    gossip: [
        { t: '你们是怎么发现自己心动的', b: '突然很在意对方有没有回消息……' },
        { t: '前任突然来加我', b: '该不该通过？在线等。' },
        { t: '蹲一个公司八卦后续', b: '昨天那事今天有进展了吗。' },
        { t: '暧昧到底算不算喜欢', b: '分不清了，求过来人解读。' },
        { t: '闺蜜的对象好像有问题', b: '要不要提醒她，纠结。' },
        { t: '相亲遇到奇葩', b: '第一句话就把我问懵了。' },
        { t: '楼下情侣又吵架了', b: '吃瓜中，剧情比电视还精彩。' },
        { t: '到底要不要先表白', b: '怕破坏现在的关系。' },
        { t: '收到匿名礼物', b: '猜不出是谁，心跳加速。' },
        { t: '同事的瓜保熟', b: '我啥都没说，你们自己悟。' },
    ],
    hobby: [
        { t: '安利一个最近的快乐源泉', b: '入坑警告，谁来一起。' },
        { t: '找个一起追剧的搭子', b: '进度同步那种，蹲。' },
        { t: '今天又手作了一个小东西', b: '丑萌丑萌的，但开心。' },
        { t: '求歌单，要那种深夜的', b: '听着能放空的最好。' },
        { t: '周末想去citywalk', b: '有没有同城的一起。' },
        { t: '入了新爱好钱包空了', b: '快乐是真的，破产也是。' },
        { t: '晒一下我的小收藏', b: '攒了好久，终于成系列了。' },
        { t: '求推荐入门相机', b: '预算有限，想拍点日常。' },
        { t: '一起来拼图吗', b: '一千片，拼到怀疑人生。' },
        { t: '健身第一天打卡', b: '明天大概率会放弃，先立帖。' },
    ],
    help: [
        { t: '在线等，挺急的', b: '这个问题困住我一晚上了。' },
        { t: '求助：到底怎么选', b: '两个都还行，纠结到头秃。' },
        { t: '有没有懂行的指点一下', b: '萌新一枚，求别嫌弃。' },
        { t: '手机突然变好卡', b: '没装什么东西啊，求排查。' },
        { t: '租房被中介坑了怎么办', b: '合同没细看，在线等支招。' },
        { t: '求一个万能的借口', b: '不想去聚会，又不想伤人。' },
        { t: '电脑蓝屏了急救', b: '资料还没存，瑟瑟发抖。' },
        { t: '怎么委婉拒绝同事', b: '老让我帮忙，烦但不好说。' },
        { t: '求推荐靠谱的师傅', b: '同城，急修，谢谢大家。' },
        { t: '这种情况要去医院吗', b: '不严重但有点慌，求安心。' },
    ],
};

/** 兜底：没配 API 时也能填满一个板块（≥count 个帖子）。 */
export function fallbackThreads(boardId: string, count: number): RawThread[] {
    const pool = FALLBACK_THREADS[boardId] || FALLBACK_THREADS.chat;
    const out: RawThread[] = [];
    for (let i = 0; i < count; i++) {
        const t = pool[i % pool.length];
        out.push({ author: pick(NICKS), title: t.t, body: t.b, floors: targetFloorCount(), likes: Math.floor(Math.random() * 260) });
    }
    return out;
}

/** 把生成的一批帖子落成 ForumPost[]（楼层先空着，进帖懒加载）。 */
export function materializeThreads(
    raw: RawThread[],
    boardId: string,
    chars: { id: string; name: string; avatar?: string }[],
): ForumPost[] {
    const now = Date.now();
    const usedChar = new Set<string>(); // 同一实名角色一批里只当一次楼主，避免「重复角色的帖子」
    return raw.map((t, i) => {
        let ch = chars.find(c => c.name === t.author);
        if (ch && usedChar.has(ch.id)) ch = undefined; // 角色已发过帖→这条当匿名网友处理
        if (ch) usedChar.add(ch.id);
        const ago = Math.floor(Math.random() * 3600_000 * 24 * 3); // 近 3 天内
        const created = now - ago;
        return {
            id: fid(),
            boardId,
            authorType: ch ? 'char' : 'npc',
            authorId: ch?.id,
            authorName: ch ? ch.name : (t.author || pick(NICKS)),
            avatar: ch?.avatar,
            title: t.title,
            body: t.body,
            createdAt: created,
            lastActiveAt: created + Math.floor(Math.random() * 3600_000 * 6) + i * 1000,
            likes: t.likes,
            replies: [],
            replyCount: t.floors,
            hot: t.floors >= 200 || t.likes >= 300,
            generated: true,
        } as ForumPost;
    }).sort((a, b) => b.lastActiveAt - a.lastActiveAt);
}
