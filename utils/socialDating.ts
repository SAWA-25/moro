import { AmbientSocialContact, CharacterProfile, UserProfile } from '../types';
import { extractContent } from './safeApi';
import { makeApiUsageMeta } from './apiUsageCatalog';
import { callChatCompletion } from './llmClient';

/**
 * 见闻簿·交友（发现身边的人）—— 本地 AI 实时生成一批「附近的人」交友卡片，
 * 像探探 / Soul / 陌陌 那样左滑右滑。交友目的五花八门、不限题材：找对象、约会、
 * SM/圈内、单纯无聊、游戏搭子、饭搭子、运动/学习搭子、灵魂共鸣、线下面基…
 *
 * 纯数据 + 纯函数（prompt 组装 / 解析 / 兜底 / 落地），不碰 DB / React。
 * 一部分卡片可以是你认识的角色「也出现在附近」（实名出镜），其余是虚构路人。
 */

export interface DatingApi { baseUrl: string; apiKey?: string; model: string; apiRole?: string; apiBinding?: string; }

export type DatingIntent =
    | 'serious' | 'date' | 'casual' | 'sm' | 'bored'
    | 'gamemate' | 'sportmate' | 'mealmate' | 'studymate' | 'soul' | 'offline';

export interface DatingIntentMeta { key: DatingIntent; label: string; emoji: string; }

/** 交友目的池（不限题材，含成人向「圈内/SM」）——展示成彩色标签，也喂给模型当方向。 */
export const DATING_INTENTS: DatingIntentMeta[] = [
    { key: 'serious', label: '奔现找对象', emoji: '💍' },
    { key: 'date', label: '恋爱脱单', emoji: '💘' },
    { key: 'casual', label: '随缘约会', emoji: '🍷' },
    { key: 'sm', label: '圈内 · SM', emoji: '⛓️' },
    { key: 'bored', label: '单纯无聊', emoji: '🥱' },
    { key: 'gamemate', label: '游戏搭子', emoji: '🎮' },
    { key: 'sportmate', label: '运动搭子', emoji: '🏸' },
    { key: 'mealmate', label: '饭搭子', emoji: '🍜' },
    { key: 'studymate', label: '学习搭子', emoji: '📚' },
    { key: 'soul', label: '灵魂共鸣', emoji: '🪐' },
    { key: 'offline', label: '线下面基', emoji: '📍' },
];

const INTENT_KEYS = new Set<string>(DATING_INTENTS.map(i => i.key));
export const intentMeta = (k: string): DatingIntentMeta =>
    DATING_INTENTS.find(i => i.key === k) || DATING_INTENTS[4];

export interface DatingProfile {
    id: string;
    name: string;
    age?: number;
    gender?: string;     // 男 / 女 / 保密 / 其他
    intent: DatingIntent;
    distanceKm: number;  // 「距你 X km」
    online?: boolean;
    emoji?: string;      // 无头像时的兜底表情
    avatar?: string;     // 命中实名角色时用其头像
    isChar?: boolean;
    charId?: string;
    tags: string[];
    bio: string;         // 个人简介：几句话，有性格、有想找什么、有钩子
    greeted?: boolean;
    liked?: boolean;
}

let _seq = 0;
const uid = (): string => `dt_${Date.now().toString(36)}${(_seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
const round1 = (n: number): number => Math.round(n * 10) / 10;

const EMOJI_POOL = ['🌙', '🍃', '🐱', '🦊', '🍷', '🎧', '📷', '🌵', '🐰', '🍸', '🎮', '🏍️', '🧋', '🪐', '🐺', '🦋', '🌧️', '🔥', '🎲', '🥂'];
const emojiFor = (name: string): string => {
    let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
    return EMOJI_POOL[Math.abs(h) % EMOJI_POOL.length];
};

export interface CharBrief { id: string; name: string; persona?: string; avatar?: string; }

// ── 生成 prompt ────────────────────────────────────────────────────────────
export function buildDatingPrompt(chars: CharBrief[], userProfile: UserProfile, count: number): string {
    const roster = chars.slice(0, 5).map(c => `- ${c.name}：${(c.persona || '').replace(/\s+/g, ' ').slice(0, 120) || '（无设定）'}`).join('\n');
    const intents = DATING_INTENTS.map(i => `${i.key}(${i.label})`).join('、');
    return `你是一个交友/约会 App（参考探探、Soul、陌陌）的「发现·附近的人」推荐引擎，为用户「${userProfile.name}」生成一批**逼真、各式各样、像真人**的附近用户交友卡片。

## 可「实名出镜」的人（用户认识的角色，可能也在附近刷交友，**每人最多 1 张卡**，用其本名、贴合人设写简介）
${roster || '（暂无，全部生成虚构路人）'}

## 硬性要求
1. 一次生成 ${count} 张交友卡片，**人物多种多样、不重样**：不同性别、年龄（18~45）、性格、职业、生活状态；其中 ${chars.length ? '1~2 张可由上面的实名角色出镜（isChar=true、name 用其本名），其余' : '全部'}为虚构路人（isChar=false，昵称像真实交友软件用户、各不相同）。
2. **交友目的五花八门、不限题材**，intent 从这些里选一个最贴切的 key：${intents}。要覆盖多种目的——既有认真找对象/恋爱，也有随缘约会、单纯无聊找人聊、游戏/饭/运动/学习搭子、灵魂共鸣、线下面基，**也包括成人向的「圈内·SM(sm)」**（含蓄、点到为止，写明角色倾向/边界感即可，不写露骨细节）。各种目的都要有，别都是找对象。
3. **bio 个人简介必须有实质内容、像真人自我介绍**：2~4 句，交代「我是谁/什么性格/平时干嘛」+「想找什么样的人、一起做什么」，有具体细节和一句钩子（自嘲、暗号、择偶观、底线、梗都行）。**绝不能只有一句空话**（如「找对象」三个字）。
4. age（整数）、gender（男/女/保密）、distanceKm（0.1~50 的数字，多数 0.x~5）、online（true/false）、tags（3~6 个，兴趣/标签/MBTI/圈子，不带 #）。
5. 卡片之间简介风格、措辞要各异，别套同一个模板。

**只输出一个紧凑、完整、合法的 JSON 数组**（无多余空白、无 markdown 围栏、无解释），把 ${count} 张全部写完、最后用 ] 收尾：
[{"name":"昵称或角色本名","isChar":false,"age":24,"gender":"女","intent":"gamemate","distanceKm":1.2,"online":true,"tags":["…"],"bio":"…"}]`;
}

// ── 解析（含截断打捞：交友卡是扁平对象，逐个抠完整 {…}） ──────────────────────
function salvageFlat(raw: string): any[] {
    const txt = (raw || '').replace(/```(?:json)?/gi, '').trim();
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

/** 解析模型输出为 DatingProfile[]：校验/夹紧/去重（昵称、角色各一次），命中实名角色带头像。 */
export function parseDatingProfiles(raw: string, chars: CharBrief[]): DatingProfile[] {
    const arr = salvageFlat(raw);
    const out: DatingProfile[] = [];
    const seenName = new Set<string>();
    const usedChar = new Set<string>();
    for (const x of arr) {
        const name = String(x?.name || '').trim().slice(0, 20);
        if (!name) continue;
        const key = name.toLowerCase();
        if (seenName.has(key)) continue;
        seenName.add(key);
        let ch = (x?.isChar || x?.isCharacter) ? chars.find(c => c.name === name) : undefined;
        if (ch && usedChar.has(ch.id)) ch = undefined;
        if (ch) usedChar.add(ch.id);
        const intent = (INTENT_KEYS.has(String(x?.intent)) ? String(x?.intent) : pick(DATING_INTENTS).key) as DatingIntent;
        const age = Number.isFinite(Number(x?.age)) ? Math.max(18, Math.min(60, Math.round(Number(x.age)))) : undefined;
        const distanceKm = Number.isFinite(Number(x?.distanceKm)) ? round1(Math.max(0.1, Math.min(80, Number(x.distanceKm)))) : round1(0.3 + Math.random() * 8);
        const gender = ['男', '女', '保密', '其他'].includes(String(x?.gender)) ? String(x.gender) : undefined;
        const tags = Array.isArray(x?.tags) ? x.tags.map((t: any) => String(t).replace(/^#/, '').trim().slice(0, 12)).filter(Boolean).slice(0, 6) : [];
        const bio = String(x?.bio || '').trim();
        if (!bio) continue;
        out.push({
            id: uid(), name: ch ? ch.name : name, age, gender, intent, distanceKm,
            online: x?.online !== false,
            emoji: emojiFor(name), avatar: ch?.avatar,
            isChar: !!ch, charId: ch?.id, tags, bio,
        });
        if (out.length >= 30) break;
    }
    return out.sort((a, b) => a.distanceKm - b.distanceKm);
}

// ── 兜底（无 API / 失败时也能逛） ────────────────────────────────────────────
const FALLBACK: { name: string; age: number; gender: string; intent: DatingIntent; tags: string[]; bio: string }[] = [
    { name: '深夜不睡的猫', age: 26, gender: '女', intent: 'bored', tags: ['熬夜冠军', '电子榨菜', 'i人'], bio: '凌晨两点还醒着的纯路人，没什么目的，就是想找个人有一搭没一搭地聊。我话不多但很会听，雷点是已读不回。' },
    { name: 'Carry不动了', age: 23, gender: '男', intent: 'gamemate', tags: ['无畏契约', '上分', '夜猫子'], bio: '排位卡在钻石上不去，急需一个不送的辅助搭子。能开麦能整活优先，菜没关系，脾气好就行。常驻晚上九点后。' },
    { name: '盐系小狗', age: 28, gender: '男', intent: 'serious', tags: ['程序员', '做饭', '想定下来'], bio: '正经想找对象那种。会写代码也会做饭，周末喜欢逛菜市场。受够了暧昧和已读不回，想找个能一起买菜、吵架也不过夜的人。' },
    { name: '皮绳上的羽毛', age: 25, gender: '女', intent: 'sm', tags: ['圈内', 'sub', '边界感'], bio: '圈内轻度，sub 倾向，先做朋友再说。很看重安全词和边界感，不接受上来就开车的。聊得来、互相尊重最重要。' },
    { name: '一周三次普拉提', age: 30, gender: '女', intent: 'sportmate', tags: ['健身', '普拉提', '早睡'], bio: '找个固定的运动搭子互相监督，最好住附近能约同一家馆子。一个人练总偷懒，需要有人盯。顺便交个朋友也行。' },
    { name: '考公上岸预备役', age: 24, gender: '女', intent: 'studymate', tags: ['考公', '图书馆', '自律'], bio: '今年第二次考，想找个学习搭子线下自习互相打卡。我擅长行测，申论一塌糊涂，求互补。摸鱼的就别来了。' },
    { name: '探店不重样', age: 27, gender: '男', intent: 'mealmate', tags: ['探店', '苍蝇馆子', '能吃辣'], bio: '城里苍蝇馆子基本踩遍了，缺个一起吃饭的人——一个人点不了几个菜。无辣不欢，忌口可以提前说。纯饭搭子，AA。' },
    { name: '土星环上的人', age: 29, gender: '保密', intent: 'soul', tags: ['哲学', '播客', '深夜emo'], bio: '想找能聊点没用的东西的人：宇宙、死亡、为什么活着。白天上班晚上发疯，不擅长寒暄，但能陪你把一个问题聊到天亮。' },
    { name: '随缘就好', age: 31, gender: '男', intent: 'casual', tags: ['红酒', '爵士', '不将就'], bio: '不急着定义关系，先约出来喝一杯看眼缘。喜欢爵士和老电影，讨厌查岗。合适就处，不合适做朋友也挺好。' },
    { name: '本地土著面基', age: 22, gender: '女', intent: 'offline', tags: ['同城', '社牛', '骑行'], bio: '土生土长本地人，想认识同城的朋友一起骑行、压马路、探展。线上聊一百句不如线下见一面，社牛勿扰（开玩笑）。' },
    { name: '橘猫铲屎官', age: 33, gender: '女', intent: 'date', tags: ['养猫', '居家', '温柔'], bio: '一个人带俩橘猫，想脱单很久了。性格慢热，喜欢窝在家看剧做饭，不爱热闹。能接受猫毛、对小动物温柔的优先。' },
    { name: '机车与自由', age: 26, gender: '男', intent: 'casual', tags: ['机车', '旅行', '纹身'], bio: '骑车走过大半个省，周末基本在路上。想找个不介意风吹日晒、敢坐后座的人。不油不腻，就是有点野。' },
];

export function fallbackDatingProfiles(count: number): DatingProfile[] {
    const out: DatingProfile[] = [];
    for (let i = 0; i < count; i++) {
        const f = FALLBACK[i % FALLBACK.length];
        out.push({
            id: uid(), name: f.name, age: f.age, gender: f.gender, intent: f.intent,
            distanceKm: round1(0.2 + Math.random() * 9), online: Math.random() > 0.3,
            emoji: emojiFor(f.name), tags: f.tags, bio: f.bio,
        });
    }
    return out.sort((a, b) => a.distanceKm - b.distanceKm);
}

// ── 打招呼：对方 AI 回应 + 匹配判定 ──────────────────────────────────────────
const GREET_FALLBACK: Record<string, string[]> = {
    sm: ['嗯？先聊聊，看你懂不懂规矩。', '别急，先报一下你的取向和底线。'],
    serious: ['哈喽～你也是认真找的吗？', '你好呀，看你资料挺正经的，想多了解下。'],
    gamemate: ['来了来了，什么段位？开黑不？', '正缺人，你玩什么位置？'],
    bored: ['哈哈正好无聊，聊点啥？', '在的在的，你也睡不着？'],
};
export function fallbackDatingReply(p: Pick<DatingProfile, 'intent' | 'name'>): string {
    return pick(GREET_FALLBACK[p.intent] || ['哈喽～你好呀，怎么突然跟我打招呼啦？', '嗨，看到你了，想聊点什么？']);
}

/** 打招呼后对方是否「匹配成功」：实名熟人必中，其余按目的给个概率。 */
export function isMatch(p: Pick<DatingProfile, 'isChar' | 'intent'>, rng: () => number = Math.random): boolean {
    if (p.isChar) return true;
    const base = p.intent === 'bored' || p.intent === 'soul' ? 0.55 : p.intent === 'sm' ? 0.3 : 0.4;
    return rng() < base;
}

const DATING_RELATION_LABEL: Record<DatingIntent, string> = {
    serious: '认真认识的人',
    date: '约会对象',
    casual: '随缘约会对象',
    sm: '圈内认识的人',
    bored: '聊天搭子',
    gamemate: '游戏搭子',
    sportmate: '运动搭子',
    mealmate: '饭搭子',
    studymate: '学习搭子',
    soul: '灵魂共鸣对象',
    offline: '同城新朋友',
};

export function datingProfileToAmbientContact(
    p: DatingProfile,
    userProfile: Pick<UserProfile, 'name'>,
    now = Date.now(),
): AmbientSocialContact {
    const im = intentMeta(p.intent);
    const userName = userProfile.name || '你';
    return {
        id: `dating-${p.id}`,
        kind: 'contact',
        name: p.name,
        relation: p.intent === 'date' || p.intent === 'serious' || p.intent === 'casual' ? 'crush' : 'friend',
        relationLabel: DATING_RELATION_LABEL[p.intent] || im.label,
        avatar: p.avatar || '',
        note: [
            `在见闻簿·交友里和${userName}匹配/打过招呼。`,
            `交友目的：${im.label}；距离约 ${p.distanceKm}km。`,
            p.tags.length ? `标签：${p.tags.join('、')}。` : '',
            `简介：${p.bio}`,
        ].filter(Boolean).join('\n'),
        lastMessage: `我刚刚在见闻簿看到你了。${p.bio ? p.bio.slice(0, 36) : '要不要继续聊聊？'}`,
        lastAt: now,
        createdAt: now,
    };
}

/** 让某个交友对象用 AI 回应用户的打招呼（短、贴人设/目的、第一人称）。 */
export async function generateDatingReply(api: DatingApi, p: DatingProfile, userProfile: UserProfile, greeting?: string): Promise<string> {
    const baseUrl = (api.baseUrl || '').trim();
    if (!baseUrl || !api.model) return fallbackDatingReply(p);
    const im = intentMeta(p.intent);
    const sys = `你是交友软件上的用户「${p.name}」。你的简介：「${p.bio}」。你的交友目的：${im.label}。${p.tags.length ? `标签：${p.tags.join('、')}。` : ''}用户「${userProfile.name || '对方'}」刚在交友软件上跟你打招呼。请用第一人称、完全贴合你的人设与交友目的、口语化地回应 1~2 句，自然、有点钩子或个性，只输出你说的话本身，不要旁白/引号/解释。`;
    const usr = `${userProfile.name || '对方'} 对你说：「${greeting || '你好呀，看到你了～'}」\n你的回应：`;
    try {
        const data = await callChatCompletion(api, {
            model: api.model,
            messages: [{ role: 'system', content: sys }, { role: 'user', content: usr }],
            temperature: 1.0,
            max_tokens: 2000,
            stream: false,
        }, {
            meta: makeApiUsageMeta('social.dating', { apiRole: api.apiRole || 'aux', apiBinding: api.apiBinding || '交友回复' }),
        });
        let t = (extractContent(data) || '').trim();
        t = t.split('\n').map(s => s.trim()).filter(Boolean)[0] || '';
        t = t.replace(/^["“「『（(]+/, '').replace(/["”」』）)]+$/, '').replace(/^[^：:]{1,8}[：:]\s*/, '').trim();
        return t.slice(0, 120) || fallbackDatingReply(p);
    } catch { return fallbackDatingReply(p); }
}

// ── 调 LLM 生成一批 ──────────────────────────────────────────────────────────
export async function generateDatingBatch(
    api: DatingApi, characters: CharacterProfile[], userProfile: UserProfile, count = 14,
): Promise<DatingProfile[]> {
    const baseUrl = (api.baseUrl || '').trim();
    if (!baseUrl || !api.model) throw new Error('未配置 API');
    // 随机抽几位角色「出镜」
    const pool = [...characters];
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[pool[i], pool[j]] = [pool[j], pool[i]]; }
    const briefs: CharBrief[] = pool.slice(0, 5).map(c => ({ id: c.id, name: c.name, persona: c.systemPrompt || '', avatar: c.convoSettings?.charAvatarOverride || c.avatar }));
    const prompt = buildDatingPrompt(briefs, userProfile, count);
    const data = await callChatCompletion(api, {
        model: api.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 1.05,
        max_tokens: 12000,
        stream: false,
    }, {
        meta: makeApiUsageMeta('social.dating', { apiRole: api.apiRole || 'aux', apiBinding: api.apiBinding || '交友卡片' }),
    });
    const raw = (extractContent(data) || '').trim();
    const list = parseDatingProfiles(raw, briefs);
    if (list.length === 0) throw new Error('交友卡解析失败');
    return list;
}
