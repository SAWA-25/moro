import { formatCharacterWithId, getCharacterModelId, resolveCharacterByModelId } from './characterIdentity';

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

export interface ForumParticipant {
    type: AuthorType;
    id?: string;
    name: string;
    avatar?: string;
    lastAt: number;
    count: number;
}

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
    dislikes?: number;        // 点踩（贴吧式）
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
    dislikes?: number;     // 点踩（贴吧式）
    replies: ForumReply[];
    replyCount?: number;   // 帖子「声称」的总楼层（30~几百），楼层懒加载到此数
    hot?: boolean;         // 热帖标记（贴吧式）
    essence?: boolean;     // 精华帖（绿色「精」标）
    pinned?: boolean;      // 置顶帖（红色「顶」标）
    generated?: boolean;   // 是否 AI 实时生成（区别于种子/用户帖）
    poll?: ForumPoll;      // 投票帖
    tags?: string[];       // 话题标签 / 今日风向标签
    mood?: string;         // 氛围短标，如「热闹」「树洞」「求助」
    lastReaderAt?: number; // 用户最近读到这帖的时间
    participants?: ForumParticipant[]; // 参与过这帖的人（楼主 / 跟帖 / 楼中楼）
    sourceEventId?: string; // 来自哪次「亭中风向」话题
}

/** 投票帖（贴吧式）：一个问题 + 若干选项，记票数，记用户选了哪项。 */
export interface ForumPoll {
    question: string;
    options: { text: string; votes: number }[];
    voted?: number;   // 用户已投的选项 index（undefined＝未投）
}

export interface ForumState { posts: ForumPost[]; }

export interface ForumTopicEvent {
    id: string;
    boardId: string;
    date: string;
    title: string;
    intro: string;
    heat: number;
    tags: string[];
    createdAt: number;
}

export interface ForumDraft {
    id: string;
    board: string;
    title: string;
    body: string;
    pollOn: boolean;
    pollQ: string;
    pollOpts: string[];
    updatedAt: number;
}

export interface ForumTrendItem {
    title: string;
    source: string;
    url?: string;
    heat?: number;
    tags?: string[];
}

export interface ForumTrendPack {
    items: ForumTrendItem[];
    fetchedAt: number;
    expiresAt: number;
}

let _seq = 0;
export const fid = (): string => `${Date.now().toString(36)}${(_seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];

export const FORUM_TRENDS_KEY = 'moro_forum_trends_v1';
export const FORUM_TRENDS_ENDPOINT = 'https://noir2.cc.cd/forum/trends';
export const FORUM_TRENDS_COOLDOWN_MS = 12 * 3600_000;

export const LOCAL_FORUM_TRENDS: ForumTrendItem[] = [
    { title: '这届网友的精神状态也太超前了', source: '本地梗库', tags: ['精神状态', '整活'] },
    { title: '谁懂啊，成年人崩溃只需要一个瞬间', source: '本地梗库', tags: ['谁懂', '打工人'] },
    { title: '把生活过成连续剧但没有编剧费', source: '本地梗库', tags: ['生活流', '后续'] },
    { title: '显眼包朋友又贡献了今日名场面', source: '本地梗库', tags: ['显眼包', '名场面'] },
    { title: '互联网嘴替出现了', source: '本地梗库', tags: ['嘴替', '共鸣'] },
    { title: '主打一个已读乱回', source: '本地梗库', tags: ['聊天', '抽象'] },
    { title: '当代年轻人的省钱方式开始玄学化', source: '本地梗库', tags: ['省钱', '生活'] },
    { title: '不是我说，这个后续比正片还离谱', source: '本地梗库', tags: ['后续', '吃瓜'] },
    { title: '求一个不体面但有用的解决办法', source: '本地梗库', tags: ['求助', '实用'] },
    { title: '今天的离谱 KPI 又完成了', source: '本地梗库', tags: ['上班', '吐槽'] },
    { title: '情绪稳定但只稳定了三分钟', source: '本地梗库', tags: ['情绪', '树洞'] },
    { title: '这波属于看懂的人已经开始沉默', source: '本地梗库', tags: ['懂的都懂', '讨论'] },
];

type ForumTrendStorage = Pick<Storage, 'getItem' | 'setItem'>;
type ForumTrendFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const trendTitleKey = (title: string): string => title.toLowerCase().replace(/\s+/g, '').replace(/[，。！？、,.!?【】[\]#"'“”‘’：:（）()]/g, '');

export function normalizeForumTrendItems(input: unknown, limit = 36): ForumTrendItem[] {
    const raw = Array.isArray(input) ? input : [];
    const seen = new Set<string>();
    const out: ForumTrendItem[] = [];
    for (const x of raw) {
        const item = x as any;
        const title = String(item?.title || item?.name || '').replace(/\s+/g, ' ').trim().slice(0, 80);
        if (title.length < 2) continue;
        const key = trendTitleKey(title);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const url = typeof item?.url === 'string' && /^https?:\/\//.test(item.url) ? item.url : undefined;
        const tags = safeArr<string>(item?.tags).map(t => String(t).trim().replace(/^#/, '')).filter(Boolean).slice(0, 4);
        out.push({
            title,
            source: String(item?.source || '热榜').trim().slice(0, 20) || '热榜',
            url,
            heat: Number.isFinite(Number(item?.heat)) ? Math.max(0, Math.floor(Number(item.heat))) : undefined,
            tags,
        });
        if (out.length >= limit) break;
    }
    return out;
}

export function defaultForumTrendPack(now = Date.now()): ForumTrendPack {
    return { items: normalizeForumTrendItems(LOCAL_FORUM_TRENDS), fetchedAt: 0, expiresAt: now + FORUM_TRENDS_COOLDOWN_MS };
}

export function normalizeForumTrendPack(input: unknown, now = Date.now(), ttl = FORUM_TRENDS_COOLDOWN_MS): ForumTrendPack {
    const raw = (input && typeof input === 'object') ? input as any : {};
    const items = normalizeForumTrendItems(raw.items || input);
    return {
        items,
        fetchedAt: Number(raw.fetchedAt) || now,
        expiresAt: Number(raw.expiresAt) > now ? Number(raw.expiresAt) : now + ttl,
    };
}

export function readStoredForumTrendPack(storage?: ForumTrendStorage, now = Date.now()): ForumTrendPack | null {
    if (!storage) return null;
    try {
        const raw = storage.getItem(FORUM_TRENDS_KEY);
        if (!raw) return null;
        const pack = normalizeForumTrendPack(JSON.parse(raw), now);
        return pack.items.length ? pack : null;
    } catch { return null; }
}

export async function loadForumTrendPack(opts: {
    now?: number;
    force?: boolean;
    endpoint?: string;
    fetcher?: ForumTrendFetcher;
    storage?: ForumTrendStorage;
} = {}): Promise<ForumTrendPack> {
    const now = opts.now ?? Date.now();
    const storage = opts.storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
    const cached = readStoredForumTrendPack(storage, now);
    if (cached && !opts.force && cached.expiresAt > now) return cached;

    const fetcher = opts.fetcher ?? (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : undefined);
    if (fetcher) {
        try {
            const res = await fetcher(opts.endpoint || FORUM_TRENDS_ENDPOINT, { headers: { Accept: 'application/json' } });
            if (res.ok) {
                const data = await res.json();
                const pack = normalizeForumTrendPack(data, now, FORUM_TRENDS_COOLDOWN_MS);
                if (pack.items.length) {
                    const clientPack = { ...pack, expiresAt: now + FORUM_TRENDS_COOLDOWN_MS };
                    try { storage?.setItem(FORUM_TRENDS_KEY, JSON.stringify(clientPack)); } catch { /* ignore quota */ }
                    return clientPack;
                }
            }
        } catch { /* silent fallback */ }
    }
    return cached || defaultForumTrendPack(now);
}

const trendItemsOf = (trends?: ForumTrendPack | ForumTrendItem[] | null): ForumTrendItem[] =>
    normalizeForumTrendItems(Array.isArray(trends) ? trends : trends?.items);

const trendBrief = (trends?: ForumTrendPack | ForumTrendItem[] | null): string => {
    const items = trendItemsOf(trends).slice(0, 12);
    if (!items.length) return '';
    return items.map((t, i) => `${i + 1}. ${t.title}${t.tags?.length ? `（#${t.tags.join(' #')}）` : ''}｜${t.source}`).join('\n');
};

// 匿名网友：网名池 + 头像 emoji 池（按名字 hash 取，稳定）
const NICKS = ['夜航船', '一只柠檬精', '路过的咸鱼', '奶茶续命中', '不想上班', '月半月半', '蹲一个后续', '隔壁老王', '今天也emo', '吃瓜群众A', '风很温柔', '半糖去冰', '深夜买买买', '社恐本恐', '猫猫虫', '楼上说得对', '清醒的醉鬼', '一杯白开水'];
const NPC_EMOJI = ['🐱', '🐰', '🦊', '🐼', '🐧', '🐸', '🦉', '🌝', '🍋', '🫧', '🌵', '🐳'];
export const npcEmoji = (name: string): string => {
    let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
    return NPC_EMOJI[Math.abs(h) % NPC_EMOJI.length];
};

const NETIZEN_LINES = [
    '前排先占个座，但这事要看楼主后续补充。',
    '我嘞个豆，标题已经有画面了，正文再多说两句更好判断。',
    '如果我是楼主，我会先把时间线捋清楚，别急着下结论。',
    '这个点挺微妙的，不像单纯误会，建议先观察对方下一步。',
    '楼主这句太真实了，我身边也见过类似情况，但结果完全反过来。',
    '别只听一边说法，关键要看当事人有没有持续回避。',
    '我先蹲个后续，尤其想知道中间那段是谁先开口的。',
    '这事最怕拖着不问，最后全靠脑补把自己绕进去。',
    '感觉不是大问题，但已经足够让人心里硌一下。',
    '楼主先别上头，把聊天记录和时间点对一下再行动。',
    '有一说一，这种局面直接问反而比猜来猜去舒服。',
    '如果只是想吐槽，那我懂；如果要解决，得先分清谁在逃避。',
];

type ForumReplyContext = Pick<ForumPost, 'title' | 'body' | 'boardId'> & { replies?: ForumReply[] };

const LOW_VALUE_REPLY_KEYS = new Set([
    '前排',
    '蹲后续',
    '插眼',
    '马克',
    '默默点了个赞',
    '理性建议早点睡',
    '楼主清醒一点拍肩',
    '又是被共鸣到的一天',
    '这届网友很会啊',
    '路过给楼主递茶',
]);

const REPLY_STOP_WORDS = new Set([
    '一个', '这个', '那个', '什么', '怎么', '为什么', '有没有', '是不是', '就是', '感觉', '真的', '好像', '突然', '今天', '现在', '大家', '你们',
    '楼主', '帖子', '正文', '标题', '后续', '有人', '一下', '一点', '这种', '情况', '事情', '问题', '建议', '回复',
]);

const replyKey = (text: string): string =>
    String(text || '').toLowerCase().replace(/[^\u4e00-\u9fa5a-z0-9]/g, '');

const postBrief = (ctx?: ForumReplyContext): string =>
    `${ctx?.title || ''} ${ctx?.body || ''}`.replace(/\s+/g, ' ').trim();

const extractReplyKeywords = (ctx?: ForumReplyContext, limit = 8): string[] => {
    const text = postBrief(ctx);
    const words = text.match(/[\u4e00-\u9fa5a-zA-Z0-9]{2,}/g) || [];
    const out: string[] = [];
    for (const raw of words) {
        const word = raw.trim();
        if (word.length < 2 || REPLY_STOP_WORDS.has(word)) continue;
        if (!out.includes(word)) out.push(word);
        if (out.length >= limit) break;
    }
    return out;
};

const isLowValueReply = (body: string, ctx?: ForumReplyContext): boolean => {
    const key = replyKey(body);
    if (!key) return true;
    if (LOW_VALUE_REPLY_KEYS.has(key)) return true;
    if (key.length <= 6 && !extractReplyKeywords(ctx).some(k => key.includes(replyKey(k)))) return true;
    const genericHit = [...LOW_VALUE_REPLY_KEYS].some(k => key.includes(k) && key.length <= k.length + 6);
    return genericHit && !extractReplyKeywords(ctx).some(k => key.includes(replyKey(k)));
};

function curateForumReplies(raw: RawReply[], ctx?: ForumReplyContext): RawReply[] {
    const seen = new Set<string>();
    safeArr<ForumReply>(ctx?.replies).forEach(r => {
        seen.add(replyKey(r.body));
        safeArr<ForumSubReply>(r.subReplies).forEach(s => seen.add(replyKey(s.body)));
    });
    const out: RawReply[] = [];
    for (const r of raw) {
        const body = String(r.body || '').replace(/\s+/g, ' ').trim();
        const key = replyKey(body);
        if (!body || !key || seen.has(key)) continue;
        if (ctx && isLowValueReply(body, ctx)) continue;
        seen.add(key);
        out.push({ ...r, body });
    }
    return out;
}

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
export function fallbackReplies(count: number, ctx?: ForumReplyContext): { name: string; body: string }[] {
    const used = new Set<string>();
    const keywords = extractReplyKeywords(ctx);
    const topic = keywords[0] || (ctx?.title || '这事').slice(0, 12) || '这事';
    const board = boardOf(ctx?.boardId || '')?.name || '水区';
    const templates = [
        `我觉得重点不是「${topic}」本身，而是楼主现在已经开始反复琢磨了，这就说明这事确实卡人。`,
        `看完主楼，最想问的是：对方后面有没有解释过「${topic}」这段？没有的话就很难不多想。`,
        `${board}老茶客路过，建议楼主先别急着定性，把时间线和对方原话补全，大家才好判断。`,
        `如果主楼说的细节都是真的，那这不像单纯巧合，更像有人在回避一个必须说清的问题。`,
        `我站一个谨慎派：先问清楚，再决定要不要继续投入情绪，不然很容易自己内耗。`,
        `这帖不是那种一句“早点睡”能解决的，楼主真正在意的是对方态度有没有变。`,
        `有点共鸣。我以前也遇到过类似「${topic}」的局面，拖越久越容易把小事憋成大事。`,
        `楼上如果只看热闹可能会觉得好笑，但主楼这个语气明显已经有点受影响了。`,
        `蹲后续，但不是无脑蹲，主要想看楼主补一下中间那段对话，那里才是关键信息。`,
        `换我会先发一个很轻的试探，不逼问，只看对方愿不愿意认真接住这个话题。`,
    ];
    const source = ctx ? templates : NETIZEN_LINES;
    const out: RawReply[] = [];
    for (let i = 0; i < count * 2 && out.length < count; i++) {
        let nick = pick(NICKS); let guard = 0;
        while (used.has(nick) && guard++ < 8) nick = pick(NICKS);
        used.add(nick);
        out.push({ name: nick, body: source[i % source.length] });
    }
    return curateForumReplies(out, ctx).slice(0, count);
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

const safeArr = <T,>(v: unknown): T[] => Array.isArray(v) ? v as T[] : [];

const normalizeParticipant = (x: any): ForumParticipant | null => {
    const name = String(x?.name || x?.authorName || '').trim();
    if (!name) return null;
    const type: AuthorType = x?.type === 'user' || x?.type === 'char' || x?.type === 'npc'
        ? x.type
        : (x?.authorType === 'user' || x?.authorType === 'char' || x?.authorType === 'npc' ? x.authorType : 'npc');
    return {
        type,
        id: typeof x?.authorId === 'string' ? x.authorId : (typeof x?.id === 'string' ? x.id : undefined),
        name,
        avatar: typeof x?.avatar === 'string' ? x.avatar : undefined,
        lastAt: Number.isFinite(Number(x?.lastAt || x?.createdAt)) ? Number(x?.lastAt || x?.createdAt) : Date.now(),
        count: Math.max(1, Math.floor(Number(x?.count) || 1)),
    };
};

const participantKey = (p: Pick<ForumParticipant, 'type' | 'id' | 'name'>): string =>
    `${p.type}:${p.id || p.name}`;

export function upsertForumParticipants(
    participants: ForumParticipant[] | undefined,
    entries: Array<Partial<ForumParticipant> & { authorType?: AuthorType; authorId?: string; authorName?: string; createdAt?: number }>,
): ForumParticipant[] {
    const map = new Map<string, ForumParticipant>();
    safeArr<ForumParticipant>(participants).forEach(p => {
        const n = normalizeParticipant(p);
        if (n) map.set(participantKey(n), n);
    });
    entries.forEach(e => {
        const n = normalizeParticipant({
            type: e.type || e.authorType,
            id: e.authorId || e.id,
            name: e.name || e.authorName,
            avatar: e.avatar,
            lastAt: e.lastAt || e.createdAt,
            count: e.count,
        });
        if (!n) return;
        const key = participantKey(n);
        const prev = map.get(key);
        map.set(key, prev
            ? { ...prev, avatar: n.avatar || prev.avatar, lastAt: Math.max(prev.lastAt, n.lastAt), count: prev.count + Math.max(1, n.count || 1) }
            : n);
    });
    return [...map.values()].sort((a, b) => b.lastAt - a.lastAt).slice(0, 24);
}

const replyParticipants = (replies: ForumReply[]): Array<Partial<ForumParticipant> & { authorType?: AuthorType; authorId?: string; authorName?: string; createdAt?: number }> => {
    const out: Array<Partial<ForumParticipant> & { authorType?: AuthorType; authorId?: string; authorName?: string; createdAt?: number }> = [];
    replies.forEach(r => {
        out.push(r);
        safeArr<ForumSubReply>(r.subReplies).forEach(s => out.push(s));
    });
    return out;
};

export function withPostParticipants(
    post: ForumPost,
    entries: Array<Partial<ForumParticipant> & { authorType?: AuthorType; authorId?: string; authorName?: string; createdAt?: number }>,
): ForumPost {
    return { ...post, participants: upsertForumParticipants(post.participants, entries) };
}

export function rebuildForumPostParticipants(post: ForumPost): ForumPost {
    return {
        ...post,
        participants: upsertForumParticipants(undefined, [
            { authorType: post.authorType, authorId: post.authorId, authorName: post.authorName, avatar: post.avatar, createdAt: post.createdAt },
            ...replyParticipants(post.replies),
        ]),
    };
}

export function removeForumPost(state: ForumState, postId: string): ForumState {
    return { posts: safeArr<ForumPost>(state.posts).filter(p => p.id !== postId) };
}

export function removeForumReply(post: ForumPost, replyId: string): ForumPost {
    const replies = safeArr<ForumReply>(post.replies);
    const nextReplies = replies.filter(r => r.id !== replyId);
    if (nextReplies.length === replies.length) return post;
    const totalFloors = Math.max(1, Math.floor(Number(post.replyCount) || replies.length + 1));
    return rebuildForumPostParticipants({
        ...post,
        replies: nextReplies.map((r, i) => ({ ...r, floor: i + 2, isOp: r.isOp || r.authorName === post.authorName })),
        replyCount: Math.max(nextReplies.length + 1, totalFloors - 1),
    });
}

export function removeForumSubReply(post: ForumPost, replyId: string, subReplyId: string): ForumPost {
    let changed = false;
    const replies = safeArr<ForumReply>(post.replies).map(r => {
        if (r.id !== replyId) return r;
        const subReplies = safeArr<ForumSubReply>(r.subReplies);
        const nextSubReplies = subReplies.filter(s => s.id !== subReplyId);
        if (nextSubReplies.length === subReplies.length) return r;
        changed = true;
        return { ...r, subReplies: nextSubReplies };
    });
    return changed ? rebuildForumPostParticipants({ ...post, replies }) : post;
}

export function normalizeForumState(input: unknown): ForumState {
    const rawPosts = safeArr<any>((input as any)?.posts);
    const posts: ForumPost[] = rawPosts
        .filter(p => p && typeof p === 'object' && p.id && p.boardId && p.title)
        .map((p: any) => {
            const replies = safeArr<ForumReply>(p.replies).map((r: any, i) => ({
                ...r,
                id: String(r?.id || fid()),
                floor: Math.max(2, Math.floor(Number(r?.floor) || i + 2)),
                authorType: (r?.authorType === 'user' || r?.authorType === 'char' || r?.authorType === 'npc') ? r.authorType : 'npc',
                authorName: String(r?.authorName || r?.name || '匿名茶客'),
                body: String(r?.body || ''),
                createdAt: Number(r?.createdAt) || Date.now(),
                likes: Math.max(0, Math.floor(Number(r?.likes) || 0)),
                subReplies: safeArr<ForumSubReply>(r?.subReplies).map((s: any) => ({
                    ...s,
                    id: String(s?.id || fid()),
                    authorType: (s?.authorType === 'user' || s?.authorType === 'char' || s?.authorType === 'npc') ? s.authorType : 'npc',
                    authorName: String(s?.authorName || s?.name || '匿名茶客'),
                    body: String(s?.body || ''),
                    createdAt: Number(s?.createdAt) || Date.now(),
                })),
            }));
            const base: ForumPost = {
                ...p,
                id: String(p.id),
                boardId: boardOf(String(p.boardId)) ? String(p.boardId) : 'chat',
                authorType: (p.authorType === 'user' || p.authorType === 'char' || p.authorType === 'npc') ? p.authorType : 'npc',
                authorName: String(p.authorName || '匿名茶客'),
                title: String(p.title || ''),
                body: String(p.body || ''),
                createdAt: Number(p.createdAt) || Date.now(),
                lastActiveAt: Number(p.lastActiveAt) || Number(p.createdAt) || Date.now(),
                likes: Math.max(0, Math.floor(Number(p.likes) || 0)),
                replies,
                replyCount: Math.max(replies.length + 1, Math.floor(Number(p.replyCount) || replies.length + 1)),
                tags: safeArr<string>(p.tags).map(t => String(t).trim()).filter(Boolean).slice(0, 8),
                mood: typeof p.mood === 'string' ? p.mood : undefined,
                lastReaderAt: Number.isFinite(Number(p.lastReaderAt)) ? Number(p.lastReaderAt) : undefined,
                participants: safeArr<ForumParticipant>(p.participants).map(normalizeParticipant).filter(Boolean) as ForumParticipant[],
                sourceEventId: typeof p.sourceEventId === 'string' ? p.sourceEventId : undefined,
            };
            return withPostParticipants(base, [
                { authorType: base.authorType, authorId: base.authorId, authorName: base.authorName, avatar: base.avatar, createdAt: base.createdAt },
                ...replyParticipants(replies),
            ]);
        });
    return { posts };
}

// ── 副 API 生成跟帖 ──────────────────────────────────────────────────────

// Forum post snapshots shared into private chats and group chats.
export type ForumShareMode = 'user_to_char' | 'char_to_user' | 'user_to_group' | 'char_to_group';
export type ForumShareTargetKind = 'character' | 'group';

export interface ForumPostShareSnapshot {
    postId: string;
    boardId: string;
    boardName?: string;
    title: string;
    body: string;
    author: {
        type: AuthorType;
        id?: string;
        name: string;
        avatar?: string;
    };
    stats: {
        likes: number;
        dislikes?: number;
        replies: number;
        floors: number;
    };
    tags: string[];
    repliesPreview: Array<{
        floor: number;
        authorName: string;
        authorType: AuthorType;
        body: string;
        likes?: number;
    }>;
    sharedBy?: {
        type: 'user' | 'char';
        id?: string;
        name: string;
        avatar?: string;
    };
    shareMode?: ForumShareMode;
    sharedAt: number;
}

export interface ForumSharePendingPayload {
    id: string;
    targetKind: ForumShareTargetKind;
    targetId: string;
    charId?: string;
    groupId?: string;
    shareMode: ForumShareMode;
    snapshot: ForumPostShareSnapshot;
    createdAt: number;
}

export const FORUM_PENDING_CHAT_SHARE_KEY = 'moro_forum_pending_chat_share_v1';

const trimForumShareText = (value: unknown, max: number): string => {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, Math.max(0, max - 1)).trim()}…` : text;
};

const normalizeForumShareMode = (raw: unknown, targetKind: ForumShareTargetKind): ForumShareMode => {
    if (raw === 'user_to_char' || raw === 'char_to_user' || raw === 'user_to_group' || raw === 'char_to_group') return raw;
    return targetKind === 'group' ? 'user_to_group' : 'user_to_char';
};

export function buildForumPostShareSnapshot(
    post: ForumPost,
    options: {
        boardName?: string;
        shareMode?: ForumShareMode;
        sharedBy?: ForumPostShareSnapshot['sharedBy'];
        now?: number;
        bodyLimit?: number;
        replyLimit?: number;
        replyBodyLimit?: number;
    } = {},
): ForumPostShareSnapshot {
    const floors = Math.max(post.replyCount || 0, (post.replies?.length || 0) + 1);
    const repliesPreview = safeArr<ForumReply>(post.replies)
        .slice(-Math.max(0, options.replyLimit ?? 4))
        .map(r => ({
            floor: Math.max(2, Math.floor(Number(r.floor) || 2)),
            authorName: trimForumShareText(r.authorName || '匿名茶客', 24),
            authorType: (r.authorType === 'user' || r.authorType === 'char' || r.authorType === 'npc') ? r.authorType : 'npc',
            body: trimForumShareText(r.body, options.replyBodyLimit ?? 120),
            likes: Math.max(0, Math.floor(Number(r.likes) || 0)),
        }))
        .filter(r => r.body);
    return {
        postId: String(post.id || ''),
        boardId: boardOf(post.boardId) ? post.boardId : 'chat',
        boardName: options.boardName || boardOf(post.boardId)?.name,
        title: trimForumShareText(post.title, 80) || '未命名茶话',
        body: trimForumShareText(post.body, options.bodyLimit ?? 520),
        author: {
            type: (post.authorType === 'user' || post.authorType === 'char' || post.authorType === 'npc') ? post.authorType : 'npc',
            id: post.authorId,
            name: trimForumShareText(post.authorName || '匿名茶客', 32),
            avatar: post.avatar,
        },
        stats: {
            likes: Math.max(0, Math.floor(Number(post.likes) || 0)),
            dislikes: Math.max(0, Math.floor(Number(post.dislikes) || 0)) || undefined,
            replies: Math.max(0, post.replies?.length || 0),
            floors,
        },
        tags: safeArr<string>(post.tags).map(t => trimForumShareText(t, 16)).filter(Boolean).slice(0, 6),
        repliesPreview,
        sharedBy: options.sharedBy,
        shareMode: options.shareMode,
        sharedAt: options.now ?? Date.now(),
    };
}

export function buildForumSharePendingPayload(args: {
    post: ForumPost;
    targetKind: ForumShareTargetKind;
    targetId: string;
    shareMode?: ForumShareMode;
    charId?: string;
    boardName?: string;
    sharedBy?: ForumPostShareSnapshot['sharedBy'];
    now?: number;
}): ForumSharePendingPayload {
    const targetKind: ForumShareTargetKind = args.targetKind === 'group' ? 'group' : 'character';
    const targetId = String(args.targetId || '').trim();
    const shareMode = normalizeForumShareMode(args.shareMode, targetKind);
    const charId = targetKind === 'character' ? targetId : String(args.charId || '').trim() || undefined;
    const groupId = targetKind === 'group' ? targetId : undefined;
    return {
        id: `forum-share-${args.now ?? Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        targetKind,
        targetId,
        charId,
        groupId,
        shareMode,
        snapshot: buildForumPostShareSnapshot(args.post, {
            boardName: args.boardName,
            shareMode,
            sharedBy: args.sharedBy,
            now: args.now,
        }),
        createdAt: args.now ?? Date.now(),
    };
}

type ForumShareNormalizeOptions = string[] | {
    validCharIds?: string[];
    validGroupIds?: string[];
};

export function normalizeForumSharePendingPayload(input: unknown, opts?: ForumShareNormalizeOptions): ForumSharePendingPayload | null {
    const raw = input && typeof input === 'object' ? input as any : null;
    if (!raw) return null;
    const snapshotRaw = raw.snapshot && typeof raw.snapshot === 'object' ? raw.snapshot : null;
    const postId = trimForumShareText(snapshotRaw?.postId || snapshotRaw?.id || raw.postId, 80);
    if (!postId) return null;

    const targetKind: ForumShareTargetKind = raw.targetKind === 'group' || raw.groupId ? 'group' : 'character';
    const validCharIds = Array.isArray(opts) ? opts : opts?.validCharIds;
    const validGroupIds = Array.isArray(opts) ? undefined : opts?.validGroupIds;
    const targetId = trimForumShareText(raw.targetId || (targetKind === 'group' ? raw.groupId : raw.charId), 80);
    if (!targetId) return null;
    if (targetKind === 'character' && validCharIds && !validCharIds.includes(targetId)) return null;
    if (targetKind === 'group' && validGroupIds && !validGroupIds.includes(targetId)) return null;

    const shareMode = normalizeForumShareMode(raw.shareMode || snapshotRaw?.shareMode, targetKind);
    const sourceCharId = trimForumShareText(raw.charId || snapshotRaw?.sharedBy?.id, 80);
    if ((shareMode === 'char_to_user' || shareMode === 'char_to_group') && (!sourceCharId || (validCharIds && !validCharIds.includes(sourceCharId)))) return null;

    const boardId = boardOf(String(snapshotRaw?.boardId || '')) ? String(snapshotRaw.boardId) : 'chat';
    const snapshot: ForumPostShareSnapshot = {
        postId,
        boardId,
        boardName: trimForumShareText(snapshotRaw?.boardName || boardOf(boardId)?.name, 24) || boardOf(boardId)?.name,
        title: trimForumShareText(snapshotRaw?.title, 80) || '未命名茶话',
        body: trimForumShareText(snapshotRaw?.body, 520),
        author: {
            type: (snapshotRaw?.author?.type === 'user' || snapshotRaw?.author?.type === 'char' || snapshotRaw?.author?.type === 'npc') ? snapshotRaw.author.type : 'npc',
            id: typeof snapshotRaw?.author?.id === 'string' ? snapshotRaw.author.id : undefined,
            name: trimForumShareText(snapshotRaw?.author?.name, 32) || '匿名茶客',
            avatar: typeof snapshotRaw?.author?.avatar === 'string' ? snapshotRaw.author.avatar : undefined,
        },
        stats: {
            likes: Math.max(0, Math.floor(Number(snapshotRaw?.stats?.likes) || 0)),
            dislikes: Math.max(0, Math.floor(Number(snapshotRaw?.stats?.dislikes) || 0)) || undefined,
            replies: Math.max(0, Math.floor(Number(snapshotRaw?.stats?.replies) || 0)),
            floors: Math.max(1, Math.floor(Number(snapshotRaw?.stats?.floors) || 1)),
        },
        tags: safeArr<string>(snapshotRaw?.tags).map(t => trimForumShareText(t, 16)).filter(Boolean).slice(0, 6),
        repliesPreview: safeArr<any>(snapshotRaw?.repliesPreview).map((r, i) => ({
            floor: Math.max(2, Math.floor(Number(r?.floor) || i + 2)),
            authorName: trimForumShareText(r?.authorName, 24) || '匿名茶客',
            authorType: (r?.authorType === 'user' || r?.authorType === 'char' || r?.authorType === 'npc') ? r.authorType : 'npc',
            body: trimForumShareText(r?.body, 120),
            likes: Math.max(0, Math.floor(Number(r?.likes) || 0)),
        })).filter(r => r.body).slice(0, 4),
        sharedBy: snapshotRaw?.sharedBy && typeof snapshotRaw.sharedBy === 'object' ? {
            type: snapshotRaw.sharedBy.type === 'char' ? 'char' : 'user',
            id: typeof snapshotRaw.sharedBy.id === 'string' ? snapshotRaw.sharedBy.id : undefined,
            name: trimForumShareText(snapshotRaw.sharedBy.name, 32) || (snapshotRaw.sharedBy.type === 'char' ? '某位熟客' : '用户'),
            avatar: typeof snapshotRaw.sharedBy.avatar === 'string' ? snapshotRaw.sharedBy.avatar : undefined,
        } : undefined,
        shareMode,
        sharedAt: Number(snapshotRaw?.sharedAt) || Number(raw.createdAt) || Date.now(),
    };

    return {
        id: trimForumShareText(raw.id, 96) || `forum-share-${Date.now()}`,
        targetKind,
        targetId,
        charId: targetKind === 'character' ? targetId : sourceCharId || undefined,
        groupId: targetKind === 'group' ? targetId : undefined,
        shareMode,
        snapshot,
        createdAt: Number(raw.createdAt) || Date.now(),
    };
}

export function forumShareAutoReplyHint(payload: Pick<ForumSharePendingPayload, 'shareMode' | 'snapshot'>, targetName?: string): string {
    const p = payload.snapshot;
    const replies = p.repliesPreview.length
        ? p.repliesPreview.map(r => `${r.floor}楼 ${r.authorName}: ${r.body}`).join('\n')
        : '（暂时没有楼层预览）';
    const roleLine = payload.shareMode === 'char_to_user'
        ? '你刚把这条茶话亭帖子主动转给了用户。请解释你为什么想让用户看它，并按你的人设自然评论一条，不要复述整张卡。'
        : '用户刚把这条茶话亭帖子转给了你。请按你的人设自然评论一条，可以吐槽、接梗、认真分析或追问，但不要像客服总结。';
    return `${roleLine}
${targetName ? `当前对话对象：${targetName}` : ''}
【茶话亭帖子】
板块：${p.boardName || p.boardId}
楼主：${p.author.name}
标题：${p.title}
正文：${p.body || '（无正文）'}
热度：${p.stats.likes}赞 / ${p.stats.floors}楼
标签：${p.tags.length ? p.tags.map(t => `#${t}`).join(' ') : '无'}
楼层预览：
${replies}`;
}

export interface CharBrief { id: string; modelId?: string; name: string; persona?: string; }

export interface RawReply { name: string; body: string; reply_to?: string; charId?: string; }

export function buildForumPrompt(
    post: Pick<ForumPost, 'title' | 'body' | 'boardId'> & { replies?: ForumReply[] },
    chars: CharBrief[],
    count: number,
    startFloor = 2,
): { system: string; user: string } {
    const board = boardOf(post.boardId);
    const keywords = extractReplyKeywords(post, 6);
    const recent = safeArr<ForumReply>(post.replies).slice(-8).map(r => `${r.floor}楼 ${r.authorName}：${r.body}`).join('\n');
    const roster = chars.slice(0, 6).map(c => {
        const id = getCharacterModelId(c);
        const idPart = id ? ` charId="${id}"` : '';
        return `- ${formatCharacterWithId(c)}${idPart}：${(c.persona || '').slice(0, 120) || '（无设定）'}`;
    }).join('\n');
    const system = '你在为一个网络论坛（百度贴吧风格）生成「跟帖区」楼层。每条跟帖都必须读过主楼，回应标题/正文里的具体细节；要像真实网友，有共鸣、追问、分歧、补经验、玩梗，但不能水楼、复读或写万能套话。';
    const endFloor = startFloor + count - 1;
    const user = `板块：${board?.emoji || ''}${board?.name || ''}
帖子标题：「${post.title}」
正文：${post.body || '（无）'}
关键词：${keywords.length ? keywords.join('、') : '无'}

已有楼层（避免复读，后续跟帖要接住上下文）：
${recent || '（暂无）'}

下面这些是「实名出镜」的网友（你认识的角色），他们也可能来盖楼，请严格用其本名、并贴合各自人设说话：
${roster || '（暂无实名角色）'}

Identity rule: when a reply is from a real character above, output charId exactly as listed. Names are display text only; do not merge or substitute same-name/similar characters.

请生成 ${count} 条跟帖（这是第 ${startFloor}~${endFloor} 楼）：其中若干条来自上面的实名角色（用其本名、合乎人设地回应），其余来自匿名网友（你为每位现编一个有网感的网名，可重复出现像在对话）。
- 每条都要和主楼具体相关：至少点到标题/正文/关键词/已有楼层中的一个具体信息，再发表看法；
- 禁止输出无意义水话或万能句：如“前排”“蹲后续”“默默点了个赞”“理性建议：早点睡”“楼主清醒一点”“这评论区比帖子好看”；
- 禁止同一批里复用同一句式、同一结论或同一身体内容；不要连续多条都是“共鸣/早点睡/蹲”；
- 风格要分散：有人认真分析、有人补相似经历、有人追问关键信息、有人轻微反驳、有人接梗，但都要贴题；
- 让其中 2~4 条带 "reply_to" 字段（楼中楼，回复前面某位网友的名字），形成对话感；
只输出一个 JSON 数组，不要任何多余文字或代码块标记：
[{"name":"网友名","charId":"实名角色必须填上方 charId；匿名网友省略","body":"跟帖内容","reply_to":"（可选）被回复者网名"}]`;
    return { system, user };
}

export function buildCharReplyPrompt(
    post: Pick<ForumPost, 'title' | 'body' | 'boardId' | 'authorName' | 'replies'>,
    char: CharBrief,
): { system: string; user: string } {
    const board = boardOf(post.boardId);
    const recent = (post.replies || []).slice(-8).map(r => `${r.floor}楼 ${r.authorName}：${r.body}`).join('\n');
    const keywords = extractReplyKeywords(post, 6);
    const system = `你是「${char.name}」，正在茶话亭（百度贴吧风格论坛）里刷帖。请完全代入你的人设，用你自己的语气回一层楼。${char.persona ? `\n【人设】${char.persona.slice(0, 500)}` : ''}`;
    const user = `板块：${board?.emoji || ''}${board?.name || ''}
楼主：${post.authorName}
帖子标题：「${post.title}」
主楼：${post.body || '（无正文）'}
关键词：${keywords.length ? keywords.join('、') : '无'}

最近几层：
${recent || '（还没人接话）'}

请你只写一条自然的跟帖。必须回应主楼或最近楼层里的具体信息，不要写“前排/蹲后续/早点睡/楼主清醒一点”这种万能水话；可以共鸣、吐槽、认真建议、追问、开玩笑，但必须贴合你的人设和帖子上下文。不要自称 AI，不要替别人总结。
只输出 JSON，不要代码块：
{"body":"你的跟帖内容"}`;
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
    const seen = new Set<string>();
    const out: RawReply[] = [];
    for (const x of arr) {
        const body = String(x?.body || '').replace(/\s+/g, ' ').trim();
        const key = replyKey(body);
        if (!body || !key || seen.has(key)) continue;
        const o: RawReply = {
            name: String(x?.name || '').trim().slice(0, 24),
            body,
            charId: String(x?.charId || x?.authorCharId || x?.characterId || '').trim().slice(0, 80) || undefined,
        };
        if (!o.name) continue;
        const rt = String(x?.reply_to || x?.replyTo || '').trim().slice(0, 16);
        if (rt) o.reply_to = rt;
        seen.add(key);
        out.push(o);
        if (out.length >= 20) break;
    }
    return out;
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

export function parseCharReply(raw: string): string | null {
    if (!raw) return null;
    const txt = raw.trim().replace(/```(?:json)?/gi, '').trim();
    const s = txt.indexOf('{'); const e = txt.lastIndexOf('}');
    if (s !== -1 && e > s) {
        try {
            const o = JSON.parse(txt.slice(s, e + 1));
            const body = String(o?.body || '').trim();
            if (body) return body;
        } catch { /* fallback below */ }
    }
    const stripped = txt.replace(/^["'“”]+|["'“”]+$/g, '').trim();
    return stripped ? stripped : null;
}

/**
 * 把「名字+正文(+reply_to)」批量落成楼层；名字命中实名角色则带上其头像/身份。
 * 带 reply_to 且能在已有楼层里找到被回复者 → 落成「楼中楼」嵌进那层，不单独占楼号。
 * opName：帖子楼主名，命中则标 isOp。
 */
export function materializeReplies(
    raw: RawReply[],
    chars: { id: string; modelId?: string; name: string; avatar?: string }[],
    startFloor: number,
    opName?: string,
    existing: ForumReply[] = [],
    ctx?: ForumReplyContext,
): ForumReply[] {
    const now = Date.now();
    const out: ForumReply[] = [];
    const source = ctx ? curateForumReplies(raw, { ...ctx, replies: [...safeArr<ForumReply>(ctx.replies), ...existing] }) : raw;
    const findChar = (r: RawReply) => {
        const byId = resolveCharacterByModelId(chars, r.charId);
        if (byId) return byId;
        const sameName = chars.filter(c => c.name === r.name);
        return sameName.length === 1 ? sameName[0] : undefined;
    };
    let floor = startFloor;
    for (let i = 0; i < source.length; i++) {
        const r = source[i];
        const ch = findChar(r);
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

export function materializeCharReply(
    post: ForumPost,
    raw: RawReply,
    char: { id: string; name: string; avatar?: string },
): { post: ForumPost; reply: ForumReply } {
    const now = Date.now();
    const reply: ForumReply = {
        id: fid(),
        floor: post.replies.length + 2,
        authorType: 'char',
        authorId: char.id,
        authorName: char.name,
        avatar: char.avatar,
        body: raw.body,
        createdAt: now,
        likes: Math.floor(Math.random() * 4),
        isOp: post.authorName === char.name,
    };
    const next = withPostParticipants({
        ...post,
        replies: [...post.replies, reply],
        lastActiveAt: now,
        replyCount: Math.max(post.replyCount || 0, post.replies.length + 2),
    }, [reply]);
    return { post: next, reply };
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
    topic?: Pick<ForumTopicEvent, 'title' | 'intro' | 'tags'>,
    trends?: ForumTrendPack | ForumTrendItem[] | null,
): { system: string; user: string } {
    const roster = chars.slice(0, 6).map(c => {
        const id = getCharacterModelId(c);
        const idPart = id ? ` charId="${id}"` : '';
        return `- ${formatCharacterWithId(c)}${idPart}：${(c.persona || '').slice(0, 100) || '（无设定）'}`;
    }).join('\n');
    const longMin = Math.max(3, Math.round(count * 0.4)); // 至少四成是有内容的长贴
    const trendsText = trendBrief(trends);
    const system = `你是百度贴吧某个吧的资深泡吧网友，最懂真实帖子长什么样。现在为「${board.emoji}${board.name}」吧生成一屏**像真人真事、能让人想点进去看**的帖子列表。真实贴吧不是全是水贴：有灌水接龙的短帖、热梗短帖、标题党，也有讲一件事讲得绘声绘色的好贴长文、有头有尾的八卦/求助/树洞。坚决避免「只有标题、正文一句话就没了」的空壳帖。`;
    const user = `板块：${board.emoji}${board.name}（${board.desc}）
本吧帖子应该是这样的：${BOARD_BRIEF[board.id] || '题材具体、有真实感，长短结合。'}
${topic ? `\n本轮「亭中风向」：${topic.title}\n引子：${topic.intro}\n关联标签：${topic.tags.join('、')}\n请围绕这个风向生成帖子，但每个帖子必须从不同人物、场景或立场切入，不能像同一篇命题作文。` : ''}
${trendsText ? `\n当前联网热梗/热点素材（只借语感、话题张力和流行表达，必须改写成茶话亭里的虚构经历；不要复刻真实事件细节，不要写真实素人挂人或隐私爆料）：\n${trendsText}` : ''}

可「实名出镜」的网友（**每人最多发 1 个帖**，少数帖子由他们发，用其本名、贴合人设；其余都用你现编的、各不相同的网名）：
${roster || '（暂无实名角色）'}

Identity rule: when a thread is authored by a real character above, output charId exactly as listed. Names are display text only; do not merge or substitute same-name/similar characters.

Identity rule: when a reply is from a real character above, output charId exactly as listed. Names are display text only; do not merge or substitute same-name/similar characters.

一次性生成 ${count} 个帖子，硬性要求：
1. **混合帖型**：其中至少 ${longMin} 个是**有实质内容的好贴长文**（正文 150~400 字、可分 2~4 段，把一件事讲清楚、有细节有情绪有钩子）；另有 2~3 个热梗短帖/玩梗帖、1~2 个「蹲后续/后续来了/求鉴定」帖、若干普通水帖。热梗要像真人顺手套梗，不要像营销号盘点。
2. **八卦/吃瓜/求助/树洞类正文必须把事讲完整**，绝不允许正文只有一句话或只是复述标题。
3. **话题各不相同、有新意**：覆盖不同人物关系、场景、情绪，避免雷同套路（别一堆「今天好累」「求安慰」「有人在吗」）。具体到细节（人物、地点、数字、对话）才像真事。
4. **不重复**：标题不重样、内容不撞车；同一个实名角色不要发多个帖；网名各不相同。
5. 每帖给 "floors"（这帖大概盖了多少楼，30~588 的整数；越有料/越有争议的帖楼越多，多数 30~150、少数爆楼几百），和 "likes"（点赞数，0~9999，自然分布）。

只输出一个 JSON 数组，不要任何多余文字或代码块标记；务必把 ${count} 条全部写完、最后用 ] 收尾：
[{"author":"网名或角色本名","charId":"实名角色必须填上方 charId；匿名网友省略","title":"标题","body":"正文（按上面要求，该长则长）","floors":整数,"likes":整数}]`;
    return { system, user };
}

export interface RawThread { author: string; charId?: string; title: string; body: string; floors: number; likes: number; }

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
        out.push({
            author: String(x?.author || '').trim().slice(0, 24),
            charId: String(x?.charId || x?.authorCharId || x?.characterId || '').trim().slice(0, 80) || undefined,
            title,
            body: String(x?.body || '').trim(),
            floors,
            likes,
        });
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

const shortTrendTitle = (item: ForumTrendItem | undefined, fallback = '今天这事'): string =>
    (item?.title || fallback).replace(/[#【】]/g, '').slice(0, 24);

const fallbackBodyFor = (boardId: string, base: { t: string; b: string }, trend: string, i: number): string => {
    const scene = [
        `刚才在茶水间刷到「${trend}」，突然想起昨天发生的一件小事。`,
        `先说结论：这事不大，但越想越像一集低成本连续剧。`,
        `背景是这样的，我和当事人不算很熟，最多就是点头之交，所以我一开始也没往心里去。`,
        `结果后面连续三个细节都对上了：时间、语气、还有那个很微妙的停顿。`,
        `现在我有点拿不准到底是我想多了，还是这事真的有点东西。`
    ];
    const boardTail: Record<string, string> = {
        chat: '你们今天有没有这种「不发出来难受，发出来又觉得好笑」的小事？',
        emo: '写到这里其实已经没那么堵了，但还是想听听有没有人也经历过这种忽然破防的瞬间。',
        gossip: '先不放真名，蹲一个后续。如果晚上还有新情况我再回来补，大家先帮我鉴定一下这瓜熟没熟。',
        hobby: '有没有同好懂这种又上头又心虚的快乐？顺便求几个避雷建议。',
        help: '我现在最需要的是一个能落地的办法，别太体面也行，但最好别把场面弄得更尴尬。',
    };
    if (i % 4 === 0) return `${scene.slice(0, 4).join('\n')}\n\n${boardTail[boardId] || boardTail.chat}`;
    if (i % 4 === 1) return `${base.b} 但今天突然被「${trend}」这个说法戳中，感觉一句话概括了我这周的状态。\n\n楼里有没有嘴替，帮我把这事翻译成人话。`;
    if (i % 4 === 2) return `后续来了。上次没说完，是因为我自己也没搞清楚。\n\n今天又多了一个细节：对方把原本说好的时间改了两次，最后还装作什么都没发生。结合「${trend}」这个热梗看，真的越品越不对劲。`;
    return `${base.b}\n\n不是标题党，是真的有点想不通：如果你们遇到类似「${trend}」这种局面，会直接问，还是先装不知道观察两天？`;
};

/** 兜底：没配 API 时也能填满一个板块（≥count 个帖子）。 */
export function fallbackThreads(boardId: string, count: number, topic?: ForumTopicEvent, trends?: ForumTrendPack | ForumTrendItem[] | null): RawThread[] {
    const trendItems = trendItemsOf(trends);
    const trendPool = trendItems.length ? trendItems : LOCAL_FORUM_TRENDS;
    if (topic) {
        return Array.from({ length: count }, (_, i) => {
            const trend = shortTrendTitle(trendPool[i % trendPool.length], topic.title);
            const tag = topic.tags[i % Math.max(1, topic.tags.length)] || '风向';
            return {
                author: pick(NICKS),
                title: i === 0 ? `围炉夜话：${topic.title}` : i % 3 === 0 ? `顺着「${trend}」讲个${tag}后续` : `${tag}相关，刚刷到一个很像的热梗`,
                body: i === 0
                    ? `${topic.intro}\n\n我先抛一块砖：这事放到不同人身上答案可能完全不一样。尤其最近刷到「${trend}」之后，感觉亭里肯定有人有类似经历，蹲蹲茶客们怎么接。`
                    : `顺着「${topic.title}」这个话头想到一件小事。起因是我今天看到「${trend}」，本来只当个梗笑过去，结果越想越像身边某件事。\n\n细节不算大，但很有讨论空间：如果是你们，会当场点破，还是先看后续？`,
                floors: targetFloorCount(i + topic.heat),
                likes: Math.floor(topic.heat + Math.random() * 360),
            };
        });
    }
    const pool = FALLBACK_THREADS[boardId] || FALLBACK_THREADS.chat;
    const out: RawThread[] = [];
    const used = new Set<string>();
    for (let i = 0; i < count; i++) {
        const t = pool[i % pool.length];
        const trend = shortTrendTitle(trendPool[i % trendPool.length], t.t);
        const title = i % 3 === 0
            ? `看到「${trend}」突然想起一件事`
            : i % 3 === 1
                ? t.t
                : `蹲个后续：${trend}`;
        const uniqueTitle = used.has(title) ? `${title} ${i + 1}` : title;
        used.add(uniqueTitle);
        const floors = targetFloorCount(i + (trend.length || 1));
        out.push({
            author: pick(NICKS),
            title: uniqueTitle,
            body: fallbackBodyFor(boardId, t, trend, i),
            floors,
            likes: Math.floor((i % 4 === 0 ? 180 : 20) + Math.random() * 360),
        });
    }
    return out;
}

/** 把生成的一批帖子落成 ForumPost[]（楼层先空着，进帖懒加载）。 */
export function materializeThreads(
    raw: RawThread[],
    boardId: string,
    chars: { id: string; modelId?: string; name: string; avatar?: string }[],
    sourceEventId?: string,
    tags: string[] = [],
): ForumPost[] {
    const now = Date.now();
    const usedChar = new Set<string>(); // 同一实名角色一批里只当一次楼主，避免「重复角色的帖子」
    return raw.map((t, i) => {
        let ch = resolveCharacterByModelId(chars, t.charId);
        if (!ch) {
            const sameName = chars.filter(c => c.name === t.author);
            if (sameName.length === 1) ch = sameName[0];
        }
        if (ch && usedChar.has(ch.id)) ch = undefined; // 角色已发过帖→这条当匿名网友处理
        if (ch) usedChar.add(ch.id);
        const ago = Math.floor(Math.random() * 3600_000 * 24 * 3); // 近 3 天内
        const created = now - ago;
        const hot = t.floors >= 200 || t.likes >= 300;
        const post: ForumPost = {
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
            hot,
            essence: t.likes >= 400 || t.floors >= 240,        // 精华帖
            pinned: i === 0 && (t.floors >= 150 || t.likes >= 200), // 每批至多一条置顶
            generated: true,
            tags: tags.slice(0, 8),
            mood: boardOf(boardId)?.name,
            sourceEventId,
        };
        return withPostParticipants(post, [{ authorType: post.authorType, authorId: post.authorId, authorName: post.authorName, avatar: post.avatar, createdAt: post.createdAt }]);
    }).sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.lastActiveAt - a.lastActiveAt);
}

// ── 用户个人体系：等级 / 经验 / 签到 / 关注吧 / 收藏（对标百度贴吧「我的」）──────

/** 经验阈值表：index i = 升到 Lv(i+1) 的累计经验。Lv1~Lv18（贴吧式）。 */
const LEVEL_EXP = [0, 8, 20, 40, 70, 120, 200, 320, 500, 800, 1200, 1800, 2600, 3800, 5400, 7600, 10600, 15000];

/** 头衔（按等级递增，茶话亭风味）。 */
const LEVEL_TITLES = [
    '初来乍到', '萍水相逢', '常来常往', '茶亭散客', '亭中熟脸', '把盏言欢',
    '清谈茶客', '亭台常驻', '坐看风云', '谈笑鸿儒', '亭中砥柱', '一亭之望',
    '风骚领袖', '亭长候补', '镇亭元老', '亭中泰斗', '一代亭主', '茶话亭之光',
];

export const MAX_LEVEL = LEVEL_EXP.length;

/** 经验值 → 等级。 */
export function levelOf(exp: number): number {
    let lv = 1;
    for (let i = 0; i < LEVEL_EXP.length; i++) if (exp >= LEVEL_EXP[i]) lv = i + 1;
    return Math.min(MAX_LEVEL, lv);
}
export function levelTitle(level: number): string {
    return LEVEL_TITLES[Math.min(LEVEL_TITLES.length - 1, Math.max(0, level - 1))];
}
export interface LevelInfo { level: number; title: string; cur: number; need: number; pct: number; max: boolean; }
/** 经验 → 等级 + 当前段进度（给「我的」页画进度条）。 */
export function levelInfo(exp: number): LevelInfo {
    const e = Math.max(0, Math.floor(exp || 0));
    const level = levelOf(e);
    const max = level >= MAX_LEVEL;
    const base = LEVEL_EXP[level - 1] ?? 0;
    const next = max ? base : LEVEL_EXP[level];
    const span = Math.max(1, next - base);
    const cur = Math.max(0, e - base);
    const pct = max ? 100 : Math.max(0, Math.min(100, Math.round((cur / span) * 100)));
    return { level, title: levelTitle(level), cur, need: span, pct, max };
}

/** 论坛侧的用户状态（与角色/聊天无关，单独持久化）。 */
export interface ForumUserMeta {
    exp: number;
    followedBoards: string[];                                 // 关注的吧 id
    collectedPostIds: string[];                               // 收藏的帖子 id
    checkIn: Record<string, { date: string; streak: number }>; // boardId → 最近签到
    recentPostIds?: string[];                                  // 最近看过的帖子 id（最新在前）
    mutedPostIds?: string[];                                   // 被用户淡出的帖子 id
    drafts?: ForumDraft[];                                     // 发帖草稿
    topicEvents?: Record<string, ForumTopicEvent>;             // `${date}:${boardId}` → 今日风向
}
export const defaultForumMeta = (): ForumUserMeta => ({
    exp: 0,
    followedBoards: [],
    collectedPostIds: [],
    checkIn: {},
    recentPostIds: [],
    mutedPostIds: [],
    drafts: [],
    topicEvents: {},
});

export function normalizeForumMeta(input: unknown): ForumUserMeta {
    const raw = (input && typeof input === 'object') ? input as any : {};
    const d = defaultForumMeta();
    const topicEvents: Record<string, ForumTopicEvent> = {};
    Object.entries(raw.topicEvents || {}).forEach(([k, v]) => {
        const e = v as any;
        if (!e || !e.id || !e.boardId || !e.title) return;
        topicEvents[k] = {
            id: String(e.id),
            boardId: boardOf(String(e.boardId)) ? String(e.boardId) : 'chat',
            date: String(e.date || dayStr()),
            title: String(e.title),
            intro: String(e.intro || ''),
            heat: Math.max(1, Math.min(100, Math.floor(Number(e.heat) || 50))),
            tags: safeArr<string>(e.tags).map(t => String(t).trim()).filter(Boolean).slice(0, 6),
            createdAt: Number(e.createdAt) || Date.now(),
        };
    });
    return {
        ...d,
        ...raw,
        exp: Math.max(0, Math.floor(Number(raw.exp) || 0)),
        followedBoards: safeArr<string>(raw.followedBoards).filter(id => !!boardOf(id)),
        collectedPostIds: safeArr<string>(raw.collectedPostIds).map(String).filter(Boolean).slice(0, 500),
        checkIn: raw.checkIn && typeof raw.checkIn === 'object' ? raw.checkIn : {},
        recentPostIds: safeArr<string>(raw.recentPostIds).map(String).filter(Boolean).slice(0, 40),
        mutedPostIds: safeArr<string>(raw.mutedPostIds).map(String).filter(Boolean).slice(0, 500),
        drafts: safeArr<ForumDraft>(raw.drafts).map((x: any) => ({
            id: String(x?.id || fid()),
            board: boardOf(String(x?.board || '')) ? String(x.board) : 'chat',
            title: String(x?.title || ''),
            body: String(x?.body || ''),
            pollOn: !!x?.pollOn,
            pollQ: String(x?.pollQ || ''),
            pollOpts: safeArr<string>(x?.pollOpts).map(String).slice(0, 5).length >= 2 ? safeArr<string>(x?.pollOpts).map(String).slice(0, 5) : ['', ''],
            updatedAt: Number(x?.updatedAt) || Date.now(),
        })).filter(draft => draft.title.trim() || draft.body.trim() || draft.pollQ.trim() || draft.pollOpts.some(o => o.trim())).slice(0, 30),
        topicEvents,
    };
}

/** 本地日期 YYYY-MM-DD（用于「今天是否签过」）。 */
export function dayStr(d: Date = new Date()): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const TOPIC_BANK: Record<string, Array<{ title: string; intro: string; tags: string[] }>> = {
    chat: [
        { title: '今天的小确幸值不值得单独开帖', intro: '亭里今天在聊那些不大但能把人捞起来的小事。', tags: ['日常', '快乐', '接龙'] },
        { title: '打工人的摸鱼边界在哪里', intro: '一边假装忙一边续命，大家都有自己的安全线。', tags: ['上班', '摸鱼', '吐槽'] },
        { title: '一句话证明你今天真的累了', intro: '不用宏大叙事，只要一句很具体的疲惫。', tags: ['灌水', '今日份', '共鸣'] },
    ],
    emo: [
        { title: '那些不好意思发给熟人的话', intro: '树洞今天收留一点说不出口的心事。', tags: ['树洞', '心事', '深夜'] },
        { title: '关系里最让人内耗的瞬间', intro: '不一定是大吵，很多时候是一句没回、一个眼神。', tags: ['关系', '内耗', '情绪'] },
        { title: '给过去的自己递一杯茶', intro: '如果能回到某一天，你最想跟当时的自己说什么。', tags: ['回忆', '安慰', '成长'] },
    ],
    gossip: [
        { title: '离谱但保真的身边瓜', intro: '今天只收有起因、有过程、有钩子的瓜。', tags: ['吃瓜', '保真', '后续'] },
        { title: '暧昧期到底谁先露馅', intro: '围观一些藏不住的细节，也欢迎当事人自曝。', tags: ['暧昧', '心动', '鉴定'] },
        { title: '群聊里突然安静的那一秒', intro: '很多大戏都从一条发错的消息开始。', tags: ['群聊', '尴尬', '名场面'] },
    ],
    hobby: [
        { title: '最近入坑后悔了吗', intro: '钱包和快乐总得有一个先投降。', tags: ['入坑', '安利', '避雷'] },
        { title: '冷门爱好也想找同好', intro: '越小众越需要一张能坐下来的桌。', tags: ['同好', '搭子', '冷门'] },
        { title: '一件东西让你觉得钱花值了', intro: '不求贵，只求真的改善了某个瞬间。', tags: ['分享', '收藏', '体验'] },
    ],
    help: [
        { title: '在线等，大家先别骂我', intro: '求助帖也可以很真实：背景讲清楚，茶客才接得住。', tags: ['求助', '急', '建议'] },
        { title: '成年人如何体面拒绝', intro: '不想撕破脸，也不想继续委屈自己。', tags: ['拒绝', '人际', '边界'] },
        { title: '二选一快把我纠结疯了', intro: '把利弊摆出来，让路过的人帮你敲一敲。', tags: ['选择', '纠结', '参谋'] },
    ],
};

export function topicKey(boardId: string, date = dayStr()): string {
    return `${date}:${boardId}`;
}

export function fallbackTopicEvent(boardId: string, date = dayStr()): ForumTopicEvent {
    const pool = TOPIC_BANK[boardId] || TOPIC_BANK.chat;
    const h = hashStr(`${date}:${boardId}`);
    const picked = pool[h % pool.length];
    return {
        id: `topic-${boardId}-${date}`,
        boardId: boardOf(boardId) ? boardId : 'chat',
        date,
        title: picked.title,
        intro: picked.intro,
        heat: 45 + (h % 50),
        tags: picked.tags,
        createdAt: Date.now(),
    };
}

export function ensureForumTopic(meta: ForumUserMeta, boardId: string, date = dayStr()): { meta: ForumUserMeta; event: ForumTopicEvent } {
    const key = topicKey(boardId, date);
    const normalized = normalizeForumMeta(meta);
    const existing = normalized.topicEvents?.[key];
    if (existing) return { meta: normalized, event: existing };
    const event = fallbackTopicEvent(boardId, date);
    return { meta: { ...normalized, topicEvents: { ...(normalized.topicEvents || {}), [key]: event } }, event };
}

export function isForumDraftEmpty(draft: Pick<ForumDraft, 'title' | 'body' | 'pollQ' | 'pollOpts'>): boolean {
    return !draft.title.trim() && !draft.body.trim() && !draft.pollQ.trim() && !draft.pollOpts.some(o => o.trim());
}

export function upsertForumDraft(meta: ForumUserMeta, draft: ForumDraft): ForumUserMeta {
    const normalized = normalizeForumMeta(meta);
    const rest = (normalized.drafts || []).filter(d => d.id !== draft.id);
    if (isForumDraftEmpty(draft)) return { ...normalized, drafts: rest };
    return { ...normalized, drafts: [{ ...draft, updatedAt: draft.updatedAt || Date.now() }, ...rest].slice(0, 30) };
}

export function removeForumDraft(meta: ForumUserMeta, draftId: string): ForumUserMeta {
    const normalized = normalizeForumMeta(meta);
    return { ...normalized, drafts: (normalized.drafts || []).filter(d => d.id !== draftId) };
}

export function touchRecentPost(meta: ForumUserMeta, postId: string, limit = 30): ForumUserMeta {
    const normalized = normalizeForumMeta(meta);
    return { ...normalized, recentPostIds: [postId, ...(normalized.recentPostIds || []).filter(id => id !== postId)].slice(0, limit) };
}

function prevDay(s: string): string {
    const [y, m, d] = s.split('-').map(Number);
    const dt = new Date(y, (m || 1) - 1, d || 1);
    dt.setDate(dt.getDate() - 1);
    return dayStr(dt);
}
export function isCheckedIn(meta: ForumUserMeta, boardId: string, today = dayStr()): boolean {
    return meta.checkIn[boardId]?.date === today;
}
/** 当前「最长连续签到」（任意吧里的最大连签）。 */
export function maxStreak(meta: ForumUserMeta): number {
    return Object.values(meta.checkIn).reduce((m, c) => Math.max(m, c.streak || 0), 0);
}
export interface CheckInResult { meta: ForumUserMeta; gained: number; streak: number; already: boolean; rank: number; }
/** 某个吧签到：连续天数累进、给经验、彩蛋排名。已签到则 already=true 不变。 */
export function checkIn(meta: ForumUserMeta, boardId: string, today = dayStr()): CheckInResult {
    const prev = meta.checkIn[boardId];
    if (prev?.date === today) return { meta, gained: 0, streak: prev.streak, already: true, rank: 0 };
    const streak = prev && prev.date === prevDay(today) ? prev.streak + 1 : 1;
    const gained = 5 + Math.min(streak - 1, 10);   // 连签加成，封顶 +10
    const rank = 1 + Math.floor(Math.random() * 120); // 「本吧今日第 N 位签到」彩蛋
    return {
        meta: { ...meta, exp: meta.exp + gained, checkIn: { ...meta.checkIn, [boardId]: { date: today, streak } } },
        gained, streak, already: false, rank,
    };
}

export function toggleFollowBoard(meta: ForumUserMeta, boardId: string): ForumUserMeta {
    const has = meta.followedBoards.includes(boardId);
    return { ...meta, followedBoards: has ? meta.followedBoards.filter(b => b !== boardId) : [boardId, ...meta.followedBoards] };
}
export function toggleCollect(meta: ForumUserMeta, postId: string): ForumUserMeta {
    const has = meta.collectedPostIds.includes(postId);
    return { ...meta, collectedPostIds: has ? meta.collectedPostIds.filter(p => p !== postId) : [postId, ...meta.collectedPostIds] };
}
export function addExp(meta: ForumUserMeta, n: number): ForumUserMeta {
    return { ...meta, exp: Math.max(0, meta.exp + n) };
}

// ── 吧头（吧名/关注数/帖子数/吧主）：由 boardId 稳定派生，刷新不跳数 ──────────
function hashStr(s: string): number {
    let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h);
}
const OWNER_NAMES = ['亭长大人', '看亭的猫', '老茶客', '管事的', '阿茶', '亭子精', '泡面会长', '夜话亭主'];
export interface BoardStat { members: number; posts: number; owner: string; }
export function boardStat(boardId: string): BoardStat {
    const h = hashStr(boardId);
    return {
        members: 1200 + (h % 98000),
        posts: 8000 + ((h >> 3) % 900000),
        owner: OWNER_NAMES[h % OWNER_NAMES.length],
    };
}

// ── 消息中心（通知）：回复我的 / 赞我的 / 关注吧新帖 ─────────────────────────
export type ForumNotifKind = 'reply' | 'like' | 'newpost' | 'system';
export interface ForumNotif {
    id: string;
    kind: ForumNotifKind;
    postId: string;
    postTitle: string;
    actorName: string;
    actorType: AuthorType;
    avatar?: string;
    snippet?: string;     // 回复内容/上下文摘要
    createdAt: number;
    read: boolean;
}
export function makeNotif(
    kind: ForumNotifKind,
    post: { id: string; title: string },
    actor: { name: string; type: AuthorType; avatar?: string },
    snippet?: string,
): ForumNotif {
    return {
        id: fid(), kind, postId: post.id, postTitle: post.title,
        actorName: actor.name, actorType: actor.type, avatar: actor.avatar,
        snippet: snippet?.slice(0, 60), createdAt: Date.now(), read: false,
    };
}
export const unreadCount = (notifs: ForumNotif[]): number => notifs.reduce((n, x) => n + (x.read ? 0 : 1), 0);

// ── 热议榜：综合「赞 + 楼层热度 + 新鲜度 + 加权标记」排序 ─────────────────────
export function hotRank(posts: ForumPost[], n = 10): ForumPost[] {
    const now = Date.now();
    const score = (p: ForumPost) => {
        const floors = p.replyCount || p.replies.length;
        const fresh = Math.max(0, 1 - (now - p.lastActiveAt) / (86_400_000 * 3)); // 3 天内才算新鲜
        return p.likes + floors * 3 + fresh * 220 + (p.hot ? 150 : 0) + (p.essence ? 120 : 0);
    };
    return [...posts].sort((a, b) => score(b) - score(a)).slice(0, n);
}

export type ForumListFilter = 'latest' | 'hot' | 'mine' | 'char' | 'collect' | 'recent';

const postHasUser = (p: ForumPost, userName: string): boolean =>
    p.authorType === 'user' || p.authorName === userName ||
    p.replies.some(r => r.authorType === 'user' || r.authorName === userName || (r.subReplies || []).some(s => s.authorType === 'user' || s.authorName === userName));

const postHasChar = (p: ForumPost): boolean =>
    p.authorType === 'char' ||
    (p.participants || []).some(x => x.type === 'char') ||
    p.replies.some(r => r.authorType === 'char' || (r.subReplies || []).some(s => s.authorType === 'char'));

export function filterForumPosts(
    posts: ForumPost[],
    meta: ForumUserMeta,
    userName: string,
    filter: ForumListFilter = 'latest',
    boardId: string = 'all',
    query: string = '',
): ForumPost[] {
    const normalizedMeta = normalizeForumMeta(meta);
    const muted = new Set(normalizedMeta.mutedPostIds || []);
    const collected = new Set(normalizedMeta.collectedPostIds || []);
    const recent = normalizedMeta.recentPostIds || [];
    const q = query.trim().toLowerCase();
    let ps = posts.filter(p => !muted.has(p.id));
    if (boardId !== 'all') ps = ps.filter(p => p.boardId === boardId);
    if (q) {
        ps = ps.filter(p =>
            p.title.toLowerCase().includes(q) ||
            p.body.toLowerCase().includes(q) ||
            p.authorName.toLowerCase().includes(q) ||
            (p.tags || []).some(t => t.toLowerCase().includes(q))
        );
    }
    if (filter === 'mine') ps = ps.filter(p => postHasUser(p, userName));
    if (filter === 'char') ps = ps.filter(postHasChar);
    if (filter === 'collect') ps = ps.filter(p => collected.has(p.id));
    if (filter === 'recent') {
        const order = new Map(recent.map((id, i) => [id, i]));
        return ps.filter(p => order.has(p.id)).sort((a, b) => (order.get(a.id) ?? 9999) - (order.get(b.id) ?? 9999));
    }
    if (filter === 'hot') return hotRank(ps, ps.length);
    return [...ps].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.hot ? 1 : 0) - (a.hot ? 1 : 0) || b.lastActiveAt - a.lastActiveAt);
}

/** 统计用户「获赞」总数（帖子 + 楼层里 authorType==='user' 的赞）。 */
export function userLikesReceived(posts: ForumPost[], userName: string): number {
    let n = 0;
    for (const p of posts) {
        if (p.authorType === 'user' || p.authorName === userName) n += p.likes;
        for (const r of p.replies) if (r.authorType === 'user' || r.authorName === userName) n += r.likes;
    }
    return n;
}

/** 投票帖：投某一项（已投则改投），返回更新后的 poll。 */
export function votePoll(poll: ForumPoll, idx: number): ForumPoll {
    if (idx < 0 || idx >= poll.options.length) return poll;
    const options = poll.options.map((o, i) => {
        if (i === poll.voted && i !== idx) return { ...o, votes: Math.max(0, o.votes - 1) }; // 撤回旧票
        if (i === idx && i !== poll.voted) return { ...o, votes: o.votes + 1 };
        return o;
    });
    return { ...poll, options, voted: idx };
}
export const pollTotal = (poll: ForumPoll): number => poll.options.reduce((s, o) => s + o.votes, 0);
