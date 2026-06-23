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
            replies: replies.map((r, i) => ({ id: fid(), floor: i + 1, authorType: 'npc', authorName: r.n, body: r.b, createdAt: created + (i + 1) * 60000, likes: Math.floor(Math.random() * 10) })),
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

export function buildForumPrompt(
    post: Pick<ForumPost, 'title' | 'body' | 'boardId'>,
    chars: CharBrief[],
    count: number,
): { system: string; user: string } {
    const board = boardOf(post.boardId);
    const roster = chars.slice(0, 6).map(c => `- ${c.name}：${(c.persona || '').slice(0, 120) || '（无设定）'}`).join('\n');
    const system = '你在为一个网络论坛生成「跟帖区」。跟帖要口语、简短、风格各异（有人共鸣、有人吐槽、有人抬杠玩梗、有人认真建议），像真实网友。';
    const user = `板块：${board?.emoji || ''}${board?.name || ''}
帖子标题：「${post.title}」
正文：${post.body || '（无）'}

下面这些是「实名出镜」的网友（你认识的角色），他们也会来跟帖，请严格用其本名、并贴合各自人设说话：
${roster || '（暂无实名角色）'}

请生成 ${count} 条跟帖：其中 1~3 条来自上面的实名角色（用其本名、合乎人设地回应这个帖子），其余来自匿名网友（你为每位现编一个有网感的网名）。每条不超过 40 字，自然、有梗、不复读。
只输出一个 JSON 数组，不要任何多余文字或代码块标记：
[{"name":"出镜网友名或匿名网名","body":"跟帖内容"}]`;
    return { system, user };
}

export function parseForumReplies(raw: string): { name: string; body: string }[] {
    if (!raw) return [];
    const txt = raw.trim().replace(/```(?:json)?/gi, '').trim();
    const s = txt.indexOf('['); const e = txt.lastIndexOf(']');
    if (s === -1 || e === -1 || e <= s) return [];
    try {
        const arr = JSON.parse(txt.slice(s, e + 1));
        if (!Array.isArray(arr)) return [];
        return arr
            .map((x: any) => ({ name: String(x?.name || '').trim().slice(0, 16), body: String(x?.body || '').trim().slice(0, 80) }))
            .filter(x => x.name && x.body)
            .slice(0, 8);
    } catch { return []; }
}

/** 让某个角色「开一个帖」：选板块 + 写标题正文（按人设）。 */
export function buildCharThreadPrompt(char: CharBrief): { system: string; user: string } {
    const boards = FORUM_BOARDS.map(b => `${b.id}（${b.emoji}${b.name}：${b.desc}）`).join('、');
    const system = `你是「${char.name}」，正打算上论坛发个帖子。请完全代入人设。${char.persona ? `\n【人设】${char.persona.slice(0, 400)}` : ''}`;
    const user = `从这些板块里挑一个最贴合你此刻心情的：${boards}。
然后以你的口吻发一个帖子（标题 18 字内、正文 60 字内，自然、像真人随手发的，不要太正式）。
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
        const title = String(o?.title || '').trim().slice(0, 40);
        if (!title) return null;
        const boardId = boardOf(String(o?.boardId || '').trim()) ? String(o.boardId).trim() : 'chat';
        return { boardId, title, body: String(o?.body || '').trim().slice(0, 200) };
    } catch { return null; }
}

/** 把「名字+正文」批量落成楼层；名字命中实名角色则带上其头像/身份。 */
export function materializeReplies(
    raw: { name: string; body: string }[],
    chars: { id: string; name: string; avatar?: string }[],
    startFloor: number,
): ForumReply[] {
    const now = Date.now();
    return raw.map((r, i) => {
        const ch = chars.find(c => c.name === r.name);
        return {
            id: fid(),
            floor: startFloor + i,
            authorType: ch ? 'char' : 'npc',
            authorId: ch?.id,
            authorName: r.name,
            avatar: ch?.avatar,
            body: r.body,
            createdAt: now + i * 1000,
            likes: Math.floor(Math.random() * 6),
        } as ForumReply;
    });
}
