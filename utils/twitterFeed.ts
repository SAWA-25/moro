import {
    APIConfig,
    CharacterProfile,
    TwitterAccount,
    TwitterDMMessage,
    TwitterDMThread,
    TwitterMedia,
    TwitterNotification,
    TwitterPoll,
    TwitterProfile,
    TwitterReply,
    TwitterSearchRecord,
    TwitterTrend,
    TwitterTweet,
    UserProfile,
} from '../types';
import { extractContent } from './safeApi';
import { formatCharacterWithId, getCharacterModelId } from './characterIdentity';
import { callChatCompletion } from './llmClient';
import { makeApiUsageMeta } from './apiUsageCatalog';

export const TWITTER_BATCH_SIZE = 12;
export const TWITTER_MIN_BATCH_SIZE = 10;
export const TWITTER_MAX_BATCH_SIZE = 24;
export const TWITTER_PUBLIC_NPC_RATIO = 0.9;
export const TWITTER_TRANSLATION_TARGET = 'zh-CN';
export const TWITTER_TRANSLATION_TARGET_KEY = 'moro_twitter_translation_target_v1';

type TwitterTimelineMode = 'public' | 'focused';

interface TwitterTimelineOptions {
    mode?: TwitterTimelineMode;
}

export const twitterPublicCharacterQuota = (count: number): number =>
    Math.max(0, Math.floor(Math.max(0, count) * (1 - TWITTER_PUBLIC_NPC_RATIO) + 0.000001));

export const normalizeTwitterLang = (lang?: string | null): string => {
    const raw = String(lang || '').trim();
    if (!raw) return '';
    const lower = raw.toLowerCase().replace('_', '-');
    if (lower === 'zh' || lower.startsWith('zh-cn') || lower.startsWith('zh-hans')) return 'zh-CN';
    if (lower.startsWith('zh-tw') || lower.startsWith('zh-hk') || lower.startsWith('zh-hant')) return 'zh-TW';
    if (lower.startsWith('en')) return 'en';
    if (lower.startsWith('ja') || lower === 'jp') return 'ja';
    if (lower.startsWith('ko') || lower === 'kr') return 'ko';
    if (lower.startsWith('es')) return 'es';
    if (lower.startsWith('fr')) return 'fr';
    return raw;
};

export const getTwitterLocalTargetLang = (profileLang?: string): string => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(TWITTER_TRANSLATION_TARGET_KEY) : '';
    const browserLang = typeof navigator !== 'undefined' ? navigator.language : '';
    return normalizeTwitterLang(saved || profileLang || browserLang || TWITTER_TRANSLATION_TARGET) || TWITTER_TRANSLATION_TARGET;
};

export const twitterTranslationLabel = (lang: string): string => ({
    'zh-CN': '简体中文',
    'zh-TW': '繁體中文',
    en: 'English',
    ja: '日本語',
    ko: '한국어',
    es: 'Español',
    fr: 'Français',
}[normalizeTwitterLang(lang)] || lang || '本地语言');

export const isSameTwitterLanguage = (a?: string, b?: string): boolean => {
    const left = normalizeTwitterLang(a);
    const right = normalizeTwitterLang(b);
    if (!left || !right) return false;
    if (left.startsWith('zh') && right.startsWith('zh')) return true;
    return left === right;
};

export const getTwitterTranslationText = (
    translations?: Record<string, { text: string } | undefined>,
    targetLang = TWITTER_TRANSLATION_TARGET,
): string | undefined => {
    if (!translations) return undefined;
    const target = normalizeTwitterLang(targetLang);
    return translations[target]?.text
        || (target.startsWith('zh') ? translations['zh-CN']?.text || translations['zh-TW']?.text : undefined)
        || Object.values(translations).find(Boolean)?.text;
};

const uid = (): string =>
    (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`;

const clampInt = (n: any, min: number, max: number, fallback = min): number => {
    const v = Math.floor(Number(n));
    if (!Number.isFinite(v)) return fallback;
    return Math.max(min, Math.min(max, v));
};

const cleanText = (v: any, max = 800): string => String(v || '').replace(/\r\n/g, '\n').trim().slice(0, max);

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const protectTwitterTokens = (text: string): { text: string; restore: (value: string) => string } => {
    const tokens: string[] = [];
    const protectedText = text.replace(/https?:\/\/\S+|@\w+|#[^\s#@]+/g, token => {
        const key = `__MORO_TW_TOKEN_${tokens.length}__`;
        tokens.push(token);
        return key;
    });
    return {
        text: protectedText,
        restore: value => value.replace(/__MORO_TW_TOKEN_(\d+)__/g, (_, idx) => tokens[Number(idx)] || ''),
    };
};

const localPhraseToZh: Record<string, string> = {
    'tiny product thought': '一点产品想法',
    'a timeline feels alive': '时间线之所以像活着',
    'every post has a door behind it': '是因为每条帖子背后都有一扇门',
    'not just a card': '它不只是一张卡片',
    'but a whole room': '而是一整个房间',
    'replies, context, someone changing their mind': '里面有回复、语境，也有人正在改变想法',
    'social media': '社交网络',
    'social network': '社交网络',
    'language exchange': '语言交换',
    'city life': '城市生活',
    'late night thoughts': '深夜想法',
    'coffee break': '咖啡休息',
    'global chatter': '全球闲聊',
    'indie web': '独立网络',
    'tech culture': '技术文化',
    'working notes': '工作笔记',
    'music talk': '音乐闲谈',
    'bookmarked': '已收藏',
    'Me gusta cuando': '我喜欢这种时刻：当',
    'una red social': '一个社交网络',
    'no intenta sonar perfecta': '不再试图显得完美',
    'Un comentario torpe': '一个笨拙的评论',
    'una foto sin importancia': '一张并不重要的照片',
    'alguien respondiendo demasiado tarde': '某个人很晚才回复',
    'ahi vive la historia': '故事就活在那里',
    'Une bonne timeline': '一条好的时间线',
    'ressemble a un cafe': '像一家咖啡馆',
    'des voix differentes': '有不同的声音',
    'des silences': '也有沉默',
    'une phrase qui traverse la table': '一句话穿过桌面',
    'reste avec vous toute la journee': '然后陪你走完一整天',
    '深夜のタイムライン': '深夜的时间线',
    '知らない人の独り言': '陌生人的自言自语',
    '妙に近い': '却莫名显得很近',
    '短い文の奥': '短句背后',
    'その人の部屋の明かり': '那个人房间里的灯',
    '見える気がする': '仿佛也能看见',
    '今日のインターネット': '今天的互联网',
    '今日のインターネットは': '今天的互联网',
    '오늘의 인터넷': '今天的互联网',
    '조금 시끄러웠는데': '有点吵',
    '조용히 남겨진 문장 하나': '一句安静留下的话',
    '오래 기억났다': '在记忆里留了很久',
    '사람은 가끔': '人有时候',
    '아주 짧게 진심을 흘린다': '会用很短的话漏出真心',
};

const localWordToZh: Record<string, string> = {
    account: '账号',
    alive: '鲜活',
    author: '作者',
    behind: '背后',
    book: '书',
    card: '卡片',
    city: '城市',
    coffee: '咖啡',
    comment: '评论',
    context: '语境',
    culture: '文化',
    design: '设计',
    detail: '细节',
    door: '门',
    different: '不同',
    exchange: '交换',
    feels: '感觉',
    followers: '粉丝',
    good: '好的',
    history: '故事',
    internet: '互联网',
    language: '语言',
    late: '很晚',
    life: '生活',
    mind: '想法',
    music: '音乐',
    network: '网络',
    night: '夜晚',
    people: '人们',
    perfect: '完美',
    photo: '照片',
    post: '帖子',
    product: '产品',
    quote: '引用',
    replies: '回复',
    reply: '回复',
    room: '房间',
    silence: '沉默',
    social: '社交',
    someone: '某个人',
    story: '故事',
    thought: '想法',
    timeline: '时间线',
    today: '今天',
    tweet: '推文',
    voices: '声音',
    web: '网络',
    work: '工作',
};

const localZhToEn: Record<string, string> = {
    推文: 'tweet',
    时间线: 'timeline',
    社交: 'social',
    网络: 'network',
    城市: 'city',
    生活: 'life',
    音乐: 'music',
    电影: 'movie',
    回复: 'reply',
    喜欢: 'like',
    收藏: 'bookmark',
    今天: 'today',
    深夜: 'late night',
    想法: 'thought',
    关系: 'relationship',
    工作: 'work',
};

const applyLocalPhraseMap = (text: string, phrases: Record<string, string>): string =>
    Object.entries(phrases)
        .sort((a, b) => b[0].length - a[0].length)
        .reduce((out, [from, to]) => {
            const flags = /[a-z]/i.test(from) ? 'gi' : 'g';
            return out.replace(new RegExp(escapeRegExp(from), flags), to);
        }, text);

const applyLocalWordMap = (text: string, words: Record<string, string>): string =>
    Object.entries(words)
        .sort((a, b) => b[0].length - a[0].length)
        .reduce((out, [from, to]) => out.replace(new RegExp(`\\b${escapeRegExp(from)}\\b`, 'gi'), to), text);

const tidyLocalTranslation = (text: string): string => text
    .replace(/\s+([,.;:!?，。！？；：])/g, '$1')
    .replace(/([（(])\s+/g, '$1')
    .replace(/\s+([）)])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

const translateLocalToChinese = (text: string): string => {
    const protectedTokens = protectTwitterTokens(text);
    let out = applyLocalPhraseMap(protectedTokens.text, localPhraseToZh);
    out = applyLocalWordMap(out, localWordToZh);
    out = out
        .replace(/\band\b/gi, '和')
        .replace(/\bbut\b/gi, '但')
        .replace(/\bwhen\b/gi, '当')
        .replace(/\bwith\b/gi, '和')
        .replace(/\bnot\b/gi, '不')
        .replace(/\bis\b/gi, '是')
        .replace(/\bare\b/gi, '是');
    out = protectedTokens.restore(tidyLocalTranslation(out));
    const note = /[A-Za-z]{3,}|[\u3040-\u30ff\uac00-\ud7af]/.test(out)
        ? '\n（本地词库翻译，未识别的专名或短语已按原文保留。）'
        : '';
    return `【本地速译】${out}${note}`;
};

const translateLocalFromChinese = (text: string, targetLang: string): string => {
    const protectedTokens = protectTwitterTokens(text);
    let out = applyLocalPhraseMap(protectedTokens.text, localZhToEn);
    out = protectedTokens.restore(tidyLocalTranslation(out));
    const label = twitterTranslationLabel(targetLang);
    return `[Local quick translation to ${label}] ${out}`;
};

export const translateTwitterTextLocal = (
    text: string,
    targetLang = TWITTER_TRANSLATION_TARGET,
    sourceLang?: string,
): string => {
    const clean = cleanText(text, 2400);
    if (!clean) return '';
    const target = normalizeTwitterLang(targetLang) || TWITTER_TRANSLATION_TARGET;
    if (sourceLang && isSameTwitterLanguage(sourceLang, target)) return clean;
    if (target.startsWith('zh')) return translateLocalToChinese(clean);
    return translateLocalFromChinese(clean, target);
};

const hashString = (s: string): number => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return Math.abs(h >>> 0);
};

const pick = <T,>(arr: T[], seed: string | number): T => arr[hashString(String(seed)) % arr.length];

const stripAt = (handle: string): string => handle.replace(/^@/, '');

export const normalizeHandle = (name: string, handle?: string): string => {
    const raw = (handle || name || 'user')
        .replace(/^@/, '')
        .normalize('NFKD')
        .replace(/[^\w\u4e00-\u9fa5]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 18);
    return `@${raw || 'user'}`;
};

export const twitterAccountIdFor = (type: 'user' | 'character' | 'npc', key: string): string => `${type}:${stripAt(key || 'user').toLowerCase()}`;

const charRegion = (char: CharacterProfile): string =>
    char.socialProfile?.region
    || (char.cityConfig?.mode === 'real' ? char.cityConfig.realCity : char.cityConfig?.virtualName || char.cityConfig?.prototypeCity)
    || '';

const extractMentions = (text: string): string[] =>
    Array.from(new Set((text.match(/@\w+/g) || []).map(x => x.slice(0, 32)))).slice(0, 8);

const extractFirstUrl = (text: string): string | undefined =>
    (text.match(/https?:\/\/[^\s]+/i) || [])[0];

const domainFromUrl = (url?: string): string | undefined => {
    if (!url) return undefined;
    try {
        return new URL(url).hostname.replace(/^www\./, '').slice(0, 48);
    } catch {
        return undefined;
    }
};

const softenCardText = (value: any, max = 220): string => cleanText(value, max)
    .replace(/本地虚拟(?:社交网络| X)?(?:里)?的?/g, '')
    .replace(/不会访问真实外网数据。?/g, '')
    .replace(/占位[:：]?/g, '')
    .replace(/链接预览卡/g, '链接')
    .replace(/\s{2,}/g, ' ')
    .replace(/^一张\s*/, '')
    .trim();

const normalizeLinkUrl = (url?: string, domain?: string): string | undefined => {
    const cleanUrl = cleanText(url, 500);
    if (/^https?:\/\//i.test(cleanUrl)) return cleanUrl;
    const cleanDomain = cleanText(domain, 120).replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
    if (cleanDomain && cleanDomain.includes('.') && cleanDomain !== 'moro.local') return `https://${cleanDomain}`;
    return undefined;
};

const relationshipHintForChar = (char: CharacterProfile): string => {
    const label = char.relationship?.label;
    const affection = Number(char.affection);
    if (label && Number.isFinite(affection)) return `${label} · 好感 ${Math.max(0, Math.min(100, Math.round(affection)))}%`;
    if (label) return label;
    if (Number.isFinite(affection)) return `好感 ${Math.max(0, Math.min(100, Math.round(affection)))}%`;
    return char.addedToChat ? '已在来往里保持联系' : '尚未建立明确关系';
};

const profileSummaryForChar = (char: CharacterProfile): string => {
    const parts = [
        char.socialProfile?.bio,
        char.description,
        char.lifeProfile?.content,
        char.systemPrompt,
    ].map(x => cleanText(x, 180)).filter(Boolean);
    return parts[0] || `${char.name} 的公开账号。`;
};

const recentStatusForChar = (char: CharacterProfile): string => {
    if (char.currentMood?.label) return `现在看起来${char.currentMood.label}`;
    if (char.lifeProfile?.content) return '最近常把日常碎片带到时间线上';
    if (char.proactiveConfig?.enabled) return '会主动出现，也会按自己的节奏潜水';
    return '最近在线节奏比较随缘';
};

const materializeMedia = (item: any, seed: string, content: string): TwitterMedia[] | undefined => {
    const raw: any[] = Array.isArray(item?.media) ? item.media : [];
    const media: TwitterMedia[] = raw.slice(0, 4).map((m: any, idx: number) => {
        const type = String(m?.type || m?.kind || 'image').toLowerCase();
        const normalizedType: TwitterMedia['type'] = ['image', 'video', 'gif', 'link-card', 'quote-card'].includes(type)
            ? type as TwitterMedia['type']
            : 'image';
        const url = normalizeLinkUrl(m?.url, m?.domain);
        const domain = cleanText(m?.domain, 80) || domainFromUrl(url);
        return {
            type: normalizedType,
            url,
            alt: softenCardText(m?.alt || m?.caption || m?.description, 200) || undefined,
            color: cleanText(m?.color || m?.thumbnailColor, 32) || pick(['#e8f5fd', '#f7f7f7', '#fef3c7', '#fce7f3', '#dcfce7'], `${seed}:media:${idx}`),
            title: softenCardText(m?.title, 120) || (normalizedType === 'link-card' ? domain : undefined),
            description: softenCardText(m?.description || m?.summary, 220) || undefined,
            domain,
            durationMs: Number.isFinite(Number(m?.durationMs)) ? Number(m.durationMs) : undefined,
            thumbnailColor: cleanText(m?.thumbnailColor, 32) || undefined,
        };
    }).filter((m: TwitterMedia) => m.alt || m.url || m.title || m.description);

    const mediaAlt = softenCardText(item?.mediaAlt, 200);
    if (mediaAlt) {
        const type = String(item?.mediaType || '').toLowerCase();
        media.push({
            type: type === 'video' || type === 'gif' ? type : 'quote-card',
            alt: mediaAlt,
            color: pick(['#e8f5fd', '#f7f7f7', '#fef3c7', '#fce7f3', '#dcfce7'], seed),
            durationMs: type === 'video' ? 12000 + (hashString(seed) % 110000) : undefined,
        });
    }

    const rawUrl = cleanText(item?.linkUrl || item?.url || extractFirstUrl(content), 500);
    if (rawUrl && !media.some(m => m.type === 'link-card')) {
        const url = normalizeLinkUrl(rawUrl);
        const domain = cleanText(item?.linkDomain, 80) || domainFromUrl(url);
        media.push({
            type: 'link-card',
            url,
            title: softenCardText(item?.linkTitle || item?.title, 120) || domain || '网页链接',
            description: softenCardText(item?.linkDescription || item?.description, 220) || undefined,
            domain,
            color: pick(['#f7f9f9', '#eff6ff', '#f0fdf4', '#fff7ed'], `${seed}:link`),
        });
    }

    return media.length ? media.slice(0, 4) : undefined;
};

const materializePoll = (item: any, seed: string): TwitterPoll | undefined => {
    const poll = item?.poll;
    const rawOptions: any[] = Array.isArray(poll?.options) ? poll.options : Array.isArray(item?.pollOptions) ? item.pollOptions : [];
    const options = rawOptions
        .slice(0, 4)
        .map((option: any, idx: number) => ({
            id: cleanText(option?.id, 40) || `opt-${idx}`,
            label: cleanText(option?.label || option?.text || option, 80),
            votes: clampInt(option?.votes, 0, 9999999, 4 + ((hashString(`${seed}:poll:${idx}`) % 80))),
        }))
        .filter((o: { label: string }) => o.label);
    if (options.length < 2) return undefined;
    return {
        id: cleanText(poll?.id || item?.pollId, 80) || `poll-${hashString(seed).toString(36)}`,
        question: cleanText(poll?.question || item?.pollQuestion, 140) || undefined,
        options,
        votedOptionId: cleanText(poll?.votedOptionId || item?.votedOptionId, 40) || undefined,
        closesAt: Number.isFinite(Number(poll?.closesAt || item?.pollClosesAt)) ? Number(poll?.closesAt || item?.pollClosesAt) : Date.now() + (6 + (hashString(seed) % 42)) * 3600000,
        closed: !!(poll?.closed || item?.pollClosed),
    };
};

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
                try { out.push(JSON.parse(s.slice(startIdx, i + 1))); } catch { /* skip malformed */ }
                startIdx = -1;
            }
        }
    }
    return out;
};

const unwrapArray = (v: any): any => {
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object') {
        for (const key of ['tweets', 'posts', 'timeline', 'items', 'feed', 'notifications', 'accounts', 'messages']) {
            if (Array.isArray(v[key])) return v[key];
        }
        const arr = Object.values(v).find(x => Array.isArray(x));
        if (Array.isArray(arr)) return arr;
    }
    return v;
};

export const parseTwitterJsonLoose = (raw: string): any[] => {
    const text = raw.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
    try {
        const parsed = unwrapArray(JSON.parse(text));
        return Array.isArray(parsed) ? parsed : [];
    } catch { /* fallthrough */ }

    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start >= 0 && end > start) {
        try {
            const parsed = unwrapArray(JSON.parse(text.slice(start, end + 1)));
            return Array.isArray(parsed) ? parsed : [];
        } catch { /* fallthrough */ }
    }
    if (start >= 0) {
        const objs = salvageObjects(text.slice(start + 1));
        if (objs.length) return objs;
    }
    const objStart = text.indexOf('{');
    if (objStart >= 0) {
        const objs = salvageObjects(text.slice(objStart));
        if (objs.length) return objs;
    }
    return [];
};

const callLlm = async (apiConfig: APIConfig, systemPrompt: string, userMessage: string, maxTokens = 12000): Promise<string> => {
    const data = await callChatCompletion(apiConfig, {
        model: apiConfig.model,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
        ],
        temperature: 0.92,
        max_tokens: maxTokens,
        stream: false,
    }, {
        meta: makeApiUsageMeta('twitter.generate', { apiRole: 'aux' }),
    });
    return (extractContent(data) || '').trim();
};

export const inferCharPostingWeight = (char: CharacterProfile): number => {
    const text = `${char.name}\n${char.description || ''}\n${char.systemPrompt || ''}\n${char.lifeProfile?.content || ''}`.toLowerCase();
    let score = 1;
    const chatty = ['话多', '健谈', '吐槽', '社交', '外向', '八卦', '活泼', '热闹', '分享', 'writer', 'blog', '主播', '记者', '偶像'];
    const quiet = ['寡言', '沉默', '内向', '冷淡', '社恐', '安静', '少言', '不爱说话', '谨慎', '避世'];
    chatty.forEach(k => { if (text.includes(k)) score += 0.45; });
    quiet.forEach(k => { if (text.includes(k)) score -= 0.28; });
    if (char.socialProfile?.handle) score += 0.25;
    if (char.proactiveConfig?.enabled) score += 0.25;
    if (char.scheduleFeatureEnabled || char.lifeProfile?.content) score += 0.15;
    const jitter = (hashString(char.id || char.name) % 50) / 100;
    return Math.round(Math.max(0.25, Math.min(3.5, score + jitter)) * 100) / 100;
};

const charBrief = (chars: CharacterProfile[]): string => chars.map(c => {
    const persona = `${c.systemPrompt || ''} ${c.lifeProfile?.content || ''}`.replace(/\s+/g, ' ').slice(0, 420);
    const handle = c.socialProfile?.handle || normalizeHandle(c.name);
    const weight = inferCharPostingWeight(c);
    const region = charRegion(c);
    const id = getCharacterModelId(c);
    return `- ${formatCharacterWithId(c)} charId="${id}" name="${c.name}" handle="${handle}" postingWeight=${weight} region="${region}" persona="${persona || 'no detailed persona'}"`;
}).join('\n');

const pickPublicPromptChars = (chars: CharacterProfile[], seed: string, count: number): CharacterProfile[] => {
    if (!chars.length || count <= 0) return [];
    return [...chars]
        .sort((a, b) => hashString(`${seed}:${a.id || a.name}`) - hashString(`${seed}:${b.id || b.name}`))
        .slice(0, count);
};

const languageMeta = [
    { language: 'zh-CN', country: '中国', sample: '中文' },
    { language: 'en', country: 'United States', sample: 'English' },
    { language: 'ja', country: '日本', sample: '日本語' },
    { language: 'ko', country: '대한민국', sample: '한국어' },
    { language: 'es', country: 'España', sample: 'Español' },
    { language: 'fr', country: 'France', sample: 'Français' },
];

const trendPool = [
    'AI timeline', '城市观察', 'late night thoughts', '今日碎片', 'music talk', 'indie web',
    '映画メモ', 'coffee break', '관계의 온도', 'bookmarked', '生活切片', 'tech culture',
    '恋爱脑发作', 'working notes', 'global chatter', 'tiny drama', 'language exchange', '虚拟社交',
];

const npcPool = [
    { name: 'Mina Torres', handle: '@mina_torres', language: 'es', country: 'Mexico', location: 'Mexico City', bio: 'Cultural reporter, night-owl timeline watcher.', interests: ['music talk', 'city life', 'language exchange'] },
    { name: 'Noah Park', handle: '@noahpark', language: 'en', country: 'Canada', location: 'Toronto', bio: 'Product designer who overthinks small UI details.', interests: ['tech culture', 'coffee break', 'indie web'] },
    { name: '佐藤未央', handle: '@mio_satou', language: 'ja', country: '日本', location: '東京', bio: '映画と深夜ラジオが好き。', interests: ['映画メモ', 'bookmarked', 'late night thoughts'] },
    { name: '서윤', handle: '@seoyun_notes', language: 'ko', country: '대한민국', location: 'Seoul', bio: 'Writes about relationships, weather, and tiny routines.', interests: ['관계의 온도', '生活切片', 'music talk'] },
    { name: 'Camille D.', handle: '@camille_d', language: 'fr', country: 'France', location: 'Paris', bio: 'Translator, gallery wanderer, chronic bookmarker.', interests: ['language exchange', 'bookmarked', 'city life'] },
    { name: '普通网友小满', handle: '@xiaoman_live', language: 'zh-CN', country: '中国', location: '上海', bio: '热衷围观和认真生活。', interests: ['今日碎片', '虚拟社交', '生活切片'] },
];

const realLinkPool = [
    { url: 'https://developer.mozilla.org/', title: 'MDN Web Docs', description: 'Web 平台文档、API 说明和可运行示例。' },
    { url: 'https://archive.org/', title: 'Internet Archive', description: '可检索网页、书籍、音频和影像的公共档案馆。' },
    { url: 'https://commons.wikimedia.org/', title: 'Wikimedia Commons', description: '可浏览开放授权图片、声音和媒体文件的资料库。' },
    { url: 'https://www.metmuseum.org/art/collection', title: 'The Met Collection', description: '大都会艺术博物馆的线上馆藏目录。' },
    { url: 'https://bandcamp.com/', title: 'Bandcamp', description: '独立音乐人与厂牌发布作品的音乐平台。' },
    { url: 'https://www.gutenberg.org/', title: 'Project Gutenberg', description: '提供公共领域电子书的数字图书馆。' },
];

const realLinkForSeed = (seed: string | number) => {
    const picked = pick(realLinkPool, seed);
    return { ...picked, domain: domainFromUrl(picked.url) || picked.url.replace(/^https?:\/\//, '') };
};

const realImageForSeed = (seed: string | number): string =>
    `https://picsum.photos/seed/moro-twitter-${hashString(String(seed))}/960/640`;

export const defaultTwitterProfile = (user: UserProfile): TwitterProfile => {
    const handle = normalizeHandle(user.name || 'user');
    return {
        id: 'me',
        displayName: user.name || 'User',
        handle,
        avatar: user.avatar,
        bannerColor: '#cfd9de',
        bio: user.bio || '',
        location: '',
        website: '',
        joinedAt: Date.now(),
        language: 'zh-CN',
        country: '中国',
        followers: 24 + (hashString(user.name || 'user') % 300),
        following: 18 + (hashString(`${user.name || 'user'}f`) % 120),
        updatedAt: Date.now(),
    };
};

export const accountFromProfile = (profile: TwitterProfile): TwitterAccount => ({
    id: twitterAccountIdFor('user', profile.handle),
    authorType: 'user',
    displayName: profile.displayName,
    handle: normalizeHandle(profile.displayName, profile.handle),
    avatar: profile.avatar,
    bannerColor: profile.bannerColor,
    bio: profile.bio,
    location: profile.location,
    website: profile.website,
    birthday: profile.birthday,
    joinedAt: profile.joinedAt,
    language: profile.language,
    country: profile.country,
    followers: profile.followers,
    following: profile.following,
    verified: false,
    postingWeight: 1,
    styleTags: ['personal'],
    interests: ['timeline', 'friends'],
    profileSummary: profile.bio || `${profile.displayName} 的公开主页。`,
    recentStatus: '正在使用虚拟手机刷时间线',
    profileTabs: ['posts', 'replies', 'media', 'likes', 'quotes'],
    lastActiveAt: profile.updatedAt,
    followed: true,
    updatedAt: profile.updatedAt,
});

export const accountFromCharacter = (char: CharacterProfile): TwitterAccount => {
    const handle = normalizeHandle(char.name, char.socialProfile?.handle);
    const region = charRegion(char);
    const seed = hashString(char.id || char.name);
    const styleTags = [
        inferCharPostingWeight(char) > 1.5 ? 'active poster' : 'selective poster',
        char.systemPrompt?.includes('吐槽') ? 'sharp replies' : 'in character',
        char.lifeProfile?.content ? 'life-aware' : 'persona-led',
    ];
    return {
        id: twitterAccountIdFor('character', char.id || handle),
        authorType: 'character',
        charId: char.id,
        displayName: char.name,
        handle,
        avatar: char.avatar,
        bannerColor: pick(['#dbeafe', '#fce7f3', '#dcfce7', '#fef3c7', '#e0e7ff'], char.id),
        bio: char.socialProfile?.bio || char.description || cleanText(char.systemPrompt, 120),
        location: region,
        website: '',
        joinedAt: Date.now() - (30 + seed % 1000) * 86400000,
        language: 'zh-CN',
        country: region || '虚拟本地',
        followers: 80 + (seed % 9000),
        following: 20 + (seed % 700),
        verified: seed % 7 === 0,
        postingWeight: inferCharPostingWeight(char),
        styleTags,
        interests: deriveTopicsFromText(`${char.systemPrompt || ''} ${char.lifeProfile?.content || ''}`, 5),
        commonContacts: [char.relationship?.label, char.currentMood?.label].filter(Boolean) as string[],
        profileSummary: profileSummaryForChar(char),
        relationshipHint: relationshipHintForChar(char),
        recentStatus: recentStatusForChar(char),
        profileTabs: ['posts', 'replies', 'media', 'likes', 'quotes', 'about'],
        lastActiveAt: char.currentMood?.updatedAt || Date.now() - (seed % 36) * 3600000,
        followed: false,
        updatedAt: Date.now(),
    };
};

const accountFromNpc = (item: any, fallbackSeed: string): TwitterAccount => {
    const fallback = pick(npcPool, fallbackSeed);
    const name = cleanText(item?.authorName || item?.name || fallback.name, 40);
    const handle = normalizeHandle(name, item?.authorHandle || item?.handle || fallback.handle);
    const lang = cleanText(item?.language || fallback.language, 12);
    const country = cleanText(item?.country || fallback.country, 40);
    return {
        id: twitterAccountIdFor('npc', handle),
        authorType: 'npc',
        displayName: name,
        handle,
        avatar: cleanText(item?.authorAvatar || item?.avatar, 300) || undefined,
        bannerColor: pick(['#bfdbfe', '#fecdd3', '#bbf7d0', '#fde68a', '#ddd6fe'], handle),
        bio: cleanText(item?.authorBio || item?.bio || fallback.bio, 180),
        location: cleanText(item?.authorLocation || item?.location || fallback.location, 80),
        website: cleanText(item?.website, 120),
        joinedAt: Date.now() - (hashString(handle) % 1400) * 86400000,
        language: lang,
        country,
        followers: clampInt(item?.authorFollowers || item?.followers, 0, 9999999, 60 + (hashString(handle) % 20000)),
        following: clampInt(item?.following, 0, 999999, 40 + (hashString(`${handle}f`) % 900)),
        verified: !!item?.authorVerified || !!item?.verified || hashString(handle) % 13 === 0,
        postingWeight: clampInt(item?.postingWeight, 1, 5, 1),
        styleTags: Array.isArray(item?.styleTags) ? item.styleTags.slice(0, 5).map((x: any) => cleanText(x, 32)).filter(Boolean) : ['npc'],
        interests: Array.isArray(item?.interests) ? item.interests.slice(0, 6).map((x: any) => cleanText(x, 32)).filter(Boolean) : fallback.interests,
        profileSummary: cleanText(item?.profileSummary || item?.authorBio || item?.bio || fallback.bio, 180),
        recentStatus: cleanText(item?.recentStatus, 120) || '最近在公开时间线活跃',
        profileTabs: ['posts', 'replies', 'media', 'likes', 'quotes'],
        lastActiveAt: Date.now() - (hashString(`${handle}:active`) % 72) * 3600000,
        followed: false,
        generated: true,
        updatedAt: Date.now(),
    };
};

export const buildTwitterAccounts = (
    chars: CharacterProfile[],
    user: UserProfile,
    profile?: TwitterProfile | null,
    existing: TwitterAccount[] = [],
    tweets: TwitterTweet[] = [],
): TwitterAccount[] => {
    const map = new Map<string, TwitterAccount>();
    existing.forEach(a => map.set(a.id, a));
    const me = profile || defaultTwitterProfile(user);
    map.set(twitterAccountIdFor('user', me.handle), { ...accountFromProfile(me), ...(map.get(twitterAccountIdFor('user', me.handle)) || {}) });
    chars.forEach(char => {
        const account = accountFromCharacter(char);
        map.set(account.id, { ...account, ...(map.get(account.id) || {}), displayName: char.name, avatar: char.avatar, charId: char.id, authorType: 'character' });
    });
    tweets.forEach(t => {
        const id = t.accountId || twitterAccountIdFor(t.authorType, t.charId || t.authorHandle || t.authorName);
        if (map.has(id)) return;
        if (t.authorType === 'npc') {
            map.set(id, accountFromNpc({
                authorName: t.authorName,
                authorHandle: t.authorHandle,
                authorAvatar: t.authorAvatar,
                authorBio: t.authorBio,
                authorLocation: t.authorLocation,
                authorVerified: t.authorVerified,
                authorFollowers: t.authorFollowers,
                language: t.language,
                country: t.country,
                interests: t.topics,
            }, id));
        }
    });
    return [...map.values()];
};

const deriveTopicsFromText = (text: string, limit = 4): string[] => {
    const bag: Array<[string, string[]]> = [
        ['音乐', ['music', 'song', '歌', '音乐']],
        ['城市观察', ['city', '城市', '街', '地铁']],
        ['关系观察', ['恋', '爱', '关系', '喜欢', '占有']],
        ['工作笔记', ['工作', '项目', '任务', 'deadline']],
        ['深夜碎片', ['夜', '失眠', '梦', '孤独']],
        ['电影书影音', ['电影', '书', '小说', '映画', 'book']],
        ['技术文化', ['代码', 'ai', 'tech', '产品', '设计']],
        ['日常生活', ['生活', '饭', '天气', '咖啡', '家']],
    ];
    const lower = text.toLowerCase();
    const out = bag.filter(([, keys]) => keys.some(k => lower.includes(k))).map(([topic]) => topic as string);
    if (!out.length) out.push('今日碎片', '虚拟社交');
    return out.slice(0, limit);
};

const buildTimelinePrompt = (
    chars: CharacterProfile[],
    user: UserProfile,
    existing: TwitterTweet[],
    accounts: TwitterAccount[] = [],
    options: TwitterTimelineOptions = {},
): string => {
    const mode = options.mode || 'public';
    const publicMode = mode === 'public';
    const promptChars = publicMode
        ? pickPublicPromptChars(chars, `${existing.length}:${existing[0]?.id || existing[0]?.createdAt || 'empty'}`, twitterPublicCharacterQuota(TWITTER_BATCH_SIZE))
        : chars;
    const recent = existing.slice(0, 12).map(t => `- ${t.authorName} ${t.authorHandle} [${t.language || 'unknown'}]: ${t.content.slice(0, 120)}`).join('\n');
    const acct = accounts.slice(0, 20).map(a => `- ${a.displayName} ${a.handle} type=${a.authorType} lang=${a.language || ''} country=${a.country || ''} weight=${a.postingWeight || 1} bio="${(a.bio || '').slice(0, 120)}"`).join('\n');
    return `You generate a local, fictional X/Twitter timeline for a virtual phone app. Do not claim to fetch real X data.

${publicMode
    ? 'The app owner is only a passive reader of this public timeline. Do not infer, mention, or react to their current mood, wake time, health, body, phone status, location, relationship state, or private activity. Do not address them as "you", "master", "owner", or by handle/name.'
    : 'The app owner is only a reader of these top-level tweets. Do not infer, mention, or react to their current mood, wake time, health, body, phone status, location, relationship state, or private activity. Character tweets must show the character account\'s own public life and state, not messages to/about the app owner.'}

${publicMode
    ? `Characters are rare familiar-account cameos. At least 90% of top-level posts must be from fictional NPC strangers. Use at most ${twitterPublicCharacterQuota(TWITTER_BATCH_SIZE)} character top-level post in this batch. Character posts must be about the character's own public life, opinion, work, hobbies, city, media, or small observations, never a message to or about the app owner.`
    : 'Characters may post freely about themselves. Respect postingWeight as a soft activity probability, not a quota; do not write DM-style teases or posts aimed at the app owner.'}
${charBrief(promptChars) || '(no characters, use fictional NPCs)'}

Known accounts:
${acct || '(none yet)'}

Recent timeline, avoid repetition but you may quote or continue a thread:
${recent || '(empty)'}

Quality rules:
1. Produce at least ${TWITTER_BATCH_SIZE} tweets and at most ${TWITTER_MAX_BATCH_SIZE}.
2. ${publicMode ? 'Keep top-level character posts within the stated cameo quota; fill the rest with varied NPC strangers. Replies may include characters only when natural, but do not make the public feed feel like a friends list.' : 'Do not limit any single character. The same character may post, reply, quote, or retweet several times, but every top-level character tweet should read like their own public account post.'}
3. Mix ${publicMode ? 'international NPC strangers, a tiny number of character cameos,' : 'character posts, international NPCs,'} replies, quote tweets, long posts, short takes, threads, real image/link/video/GIF cards, polls, mentions, and cross-language discussion.
4. Make each tweet concrete: a scene, opinion, conflict, joke, observation, useful detail, or emotional turn. Avoid empty generic "today is nice" filler.
5. Include non-Chinese content. Use original language for English/Japanese/Korean/Spanish/French posts. Chinese is still allowed.
6. Every item must include language, country, authorBio, authorLocation, authorVerified when plausible.
7. sourceIndex may quote a previous item in this same batch. It must point to an earlier array item.
8. replies may contain 0-6 replies. Reply authors can be repeated characters or NPCs.
9. Polls should feel like real low-stakes timeline prompts, with 2-4 options. Link cards must include a real public https URL, title, description, and domain.
10. Image/video/GIF media must include a real public https URL. If you only know the scene description and do not have a URL, put the description in mediaAlt instead of pretending there is an image.
11. Never put implementation notes in user-facing fields: do not write "placeholder", "local virtual", "mock", "moro.local", or "generated card" in content, media text, link text, or poll text.
12. The current time is only for plausible timestamps and global chatter. Do not turn it into "the user just woke up", "the user is tired", or similar user-state commentary.

Return JSON array only:
[{"authorType":"character|npc","charId":"optional character id","authorName":"display","authorHandle":"@handle","authorBio":"bio","authorLocation":"city","authorVerified":false,"language":"zh-CN|en|ja|ko|es|fr","country":"country","content":"full tweet","topics":["topic"],"mentions":["@handle"],"likes":12,"retweets":1,"quotes":0,"views":300,"media":[{"type":"image|video|gif|link-card|quote-card","alt":"visual description","title":"link title","description":"link/card summary","domain":"example.com","durationMs":42000}],"mediaAlt":"legacy optional image/card description","poll":{"question":"optional","options":[{"label":"A","votes":12},{"label":"B","votes":9}]},"sourceIndex":0,"quoteNote":"optional","threadId":"optional","threadIndex":0,"threadSize":3,"qualityTags":["scene","opinion"],"replies":[{"authorType":"character|npc","charId":"optional","authorName":"display","authorHandle":"@handle","language":"en","country":"country","content":"reply","likes":3}]}]`;
};

const findChar = (chars: CharacterProfile[], item: any): CharacterProfile | undefined => {
    const id = String(item?.charId || item?.authorCharId || '').trim();
    const name = String(item?.authorName || item?.name || item?.author || '').trim();
    return chars.find(c => getCharacterModelId(c) === id) || chars.find(c => c.name === name);
};

const materializeAccountForItem = (item: any, chars: CharacterProfile[], user: UserProfile, fallbackSeed: string): TwitterAccount => {
    const matched = findChar(chars, item);
    if (matched) return accountFromCharacter(matched);
    if (item?.authorType === 'user') return accountFromProfile(defaultTwitterProfile(user));
    return accountFromNpc(item, fallbackSeed);
};

export const materializeTwitterTweets = (
    rawItems: any[],
    chars: CharacterProfile[],
    user: UserProfile,
    existing: TwitterTweet[] = [],
): TwitterTweet[] => {
    const now = Date.now();
    const out: TwitterTweet[] = [];
    rawItems.slice(0, TWITTER_MAX_BATCH_SIZE).forEach((item, i) => {
        const content = cleanText(item?.content || item?.body || item?.text, 1600);
        if (!content) return;
        const matched = findChar(chars, item);
        const account = materializeAccountForItem(item, chars, user, `${i}:${content}`);
        const authorType = matched ? 'character' : (item?.authorType === 'user' ? 'user' : 'npc');
        const authorName = authorType === 'user' ? user.name : matched?.name || account.displayName || cleanText(item?.authorName || item?.author || item?.name, 40) || '路过网友';
        const authorHandle = normalizeHandle(authorName, matched?.socialProfile?.handle || item?.authorHandle || item?.handle || account.handle);
        const accountId = matched ? twitterAccountIdFor('character', matched.id) : authorType === 'user' ? twitterAccountIdFor('user', authorHandle) : twitterAccountIdFor('npc', authorHandle);
        const language = cleanText(item?.language || account.language || pick(languageMeta, content).language, 12);
        const country = cleanText(item?.country || account.country || pick(languageMeta, language).country, 40);
        const sourceIndex = Number.isInteger(item?.sourceIndex) ? Number(item.sourceIndex) : undefined;
        const source = typeof sourceIndex === 'number' && sourceIndex >= 0 && sourceIndex < out.length
            ? out[sourceIndex]
            : (item?.sourceTweetId ? existing.find(t => t.id === item.sourceTweetId) : undefined);
        const replies: TwitterReply[] = Array.isArray(item?.replies) ? item.replies.slice(0, 8).map((r: any): TwitterReply => {
            const rChar = findChar(chars, { charId: r?.charId, authorName: r?.authorName || r?.author || r?.name });
            const rAccount = materializeAccountForItem(r, chars, user, `${i}:reply:${r?.content || r?.text || ''}`);
            const rName = rChar?.name || rAccount.displayName || cleanText(r?.authorName || r?.author || r?.name, 40) || '网友';
            const rHandle = normalizeHandle(rName, rChar?.socialProfile?.handle || r?.authorHandle || r?.handle || rAccount.handle);
            return {
                id: uid(),
                accountId: rChar ? twitterAccountIdFor('character', rChar.id) : twitterAccountIdFor('npc', rHandle),
                authorType: rChar ? 'character' : 'npc',
                authorName: rName,
                authorHandle: rHandle,
                authorAvatar: rChar?.avatar || rAccount.avatar,
                charId: rChar?.id,
                content: cleanText(r?.content || r?.body || r?.text, 600),
                language: cleanText(r?.language || rAccount.language || language, 12),
                country: cleanText(r?.country || rAccount.country || country, 40),
                location: cleanText(r?.location || rAccount.location, 80) || undefined,
                likes: clampInt(r?.likes, 0, 999999, Math.floor(Math.random() * 20)),
                createdAt: now - i * 1000 + Math.floor(Math.random() * 900000),
            };
        }).filter((r: TwitterReply) => r.content) : [];
        const topics = Array.isArray(item?.topics)
            ? item.topics.slice(0, 8).map((t: any) => String(t).replace(/^#/, '').trim().slice(0, 32)).filter(Boolean)
            : deriveTopicsFromText(content, 4);
        const media = materializeMedia(item, `${i}:${content}`, content);
        const poll = materializePoll(item, `${i}:${content}`);
        const mentions = Array.isArray(item?.mentions)
            ? item.mentions.slice(0, 8).map((m: any) => normalizeHandle(String(m || '').replace(/^@/, ''))).filter(Boolean)
            : extractMentions(content);
        out.push({
            id: uid(),
            accountId,
            authorType,
            charId: matched?.id,
            authorName,
            authorHandle,
            authorAvatar: authorType === 'user' ? user.avatar : matched?.avatar || account.avatar,
            authorBio: cleanText(item?.authorBio || account.bio, 180) || undefined,
            authorLocation: cleanText(item?.authorLocation || account.location, 80) || undefined,
            authorVerified: !!item?.authorVerified || !!account.verified,
            authorFollowers: clampInt(item?.authorFollowers || account.followers, 0, 99999999, account.followers),
            content,
            language,
            country,
            location: cleanText(item?.location || account.location, 80) || undefined,
            topics,
            media,
            poll,
            mentions,
            replies,
            replyCount: replies.length,
            retweets: clampInt(item?.retweets, 0, 999999, Math.floor(Math.random() * 50)),
            quotes: clampInt(item?.quotes, 0, 999999, Math.floor(Math.random() * 12)),
            likes: clampInt(item?.likes, 0, 9999999, Math.floor(Math.random() * 300)),
            views: clampInt(item?.views, 0, 99999999, 300 + Math.floor(Math.random() * 8000)),
            createdAt: now - i * 60000 - Math.floor(Math.random() * 6 * 3600000),
            sourceTweetId: source?.id,
            sourceTweet: source ? {
                id: source.id,
                accountId: source.accountId,
                authorName: source.authorName,
                authorHandle: source.authorHandle,
                content: source.content,
                language: source.language,
            } : undefined,
            quoteNote: cleanText(item?.quoteNote, 260) || undefined,
            threadId: cleanText(item?.threadId, 80) || undefined,
            threadIndex: Number.isFinite(Number(item?.threadIndex)) ? Number(item.threadIndex) : undefined,
            threadSize: Number.isFinite(Number(item?.threadSize)) ? Math.max(1, Number(item.threadSize)) : undefined,
            visibility: ['public', 'followers', 'circle'].includes(String(item?.visibility)) ? item.visibility : 'public',
            qualityTags: Array.isArray(item?.qualityTags) ? item.qualityTags.slice(0, 6).map((x: any) => cleanText(x, 24)).filter(Boolean) : undefined,
            generated: true,
        });
    });
    return out;
};

const fallbackLines = [
    { language: 'zh-CN', country: '中国', text: '有时候时间线最像一条夜路：大家都在赶自己的方向，但偶尔有一盏灯刚好照到你。今天看到几条互不相干的发言，反而拼出一种奇怪的真实感。', topics: ['今日碎片', '虚拟社交'] },
    { language: 'en', country: 'United States', text: 'Tiny product thought: a timeline feels alive when every post has a door behind it. Not just a card, but a whole room: replies, context, someone changing their mind.', topics: ['tech culture', 'indie web'] },
    { language: 'ja', country: '日本', text: '深夜のタイムラインって、知らない人の独り言なのに妙に近い。短い文の奥に、その人の部屋の明かりまで見える気がする。', topics: ['映画メモ', 'late night thoughts'] },
    { language: 'ko', country: '대한민국', text: '오늘의 인터넷은 조금 시끄러웠는데, 그 사이에 조용히 남겨진 문장 하나가 오래 기억났다. 사람은 가끔 아주 짧게 진심을 흘린다.', topics: ['관계의 온도', '生活切片'] },
    { language: 'es', country: 'España', text: 'Me gusta cuando una red social no intenta sonar perfecta. Un comentario torpe, una foto sin importancia, alguien respondiendo demasiado tarde: ahi vive la historia.', topics: ['language exchange', 'city life'] },
    { language: 'fr', country: 'France', text: 'Une bonne timeline ressemble a un cafe: des voix differentes, des silences, une phrase qui traverse la table et reste avec vous toute la journee.', topics: ['coffee break', 'global chatter'] },
];

export const fallbackTwitterTweets = (
    chars: CharacterProfile[] = [],
    _user?: UserProfile,
    count = TWITTER_BATCH_SIZE,
    options: TwitterTimelineOptions = {},
): TwitterTweet[] => {
    const now = Date.now();
    const target = Math.max(count, TWITTER_MIN_BATCH_SIZE);
    const mode = options.mode || 'public';
    const maxPublicChars = mode === 'public' ? twitterPublicCharacterQuota(target) : Number.POSITIVE_INFINITY;
    let publicCharCount = 0;
    return Array.from({ length: target }).map((_, i) => {
        const shouldUseChar = chars.length > 0 && (mode === 'focused'
            ? i % 3 !== 1
            : publicCharCount < maxPublicChars && (i + 1) % 10 === 0);
        const char = shouldUseChar ? chars[(hashString(`${i}:${chars.length}`) + i) % chars.length] : undefined;
        if (char) publicCharCount++;
        const npc = pick(npcPool, i);
        const line = char
            ? {
                language: 'zh-CN',
                country: charRegion(char) || '虚拟本地',
                text: `${char.name}刷到一半停下来，忽然想把这句话发出去：${deriveTopicsFromText(char.systemPrompt || char.description || char.name, 1)[0]}这件事，最有意思的不是结论，而是每个人暴露出的在意点。`,
                topics: deriveTopicsFromText(`${char.systemPrompt || ''} ${char.lifeProfile?.content || ''}`, 3),
            }
            : fallbackLines[i % fallbackLines.length];
        const account = char ? accountFromCharacter(char) : accountFromNpc(npc, String(i));
        const authorName = char?.name || account.displayName;
        const authorHandle = char ? normalizeHandle(char.name, char.socialProfile?.handle) : account.handle;
        const link = realLinkForSeed(`${i}:${authorName}:${line.text}`);
        const media: TwitterMedia[] | undefined = i % 7 === 0
            ? [{
                type: 'link-card',
                url: link.url,
                title: link.title,
                description: link.description,
                domain: link.domain,
                color: pick(['#f7f9f9', '#eff6ff', '#f0fdf4'], i),
            }]
            : i % 5 === 0
                ? [{ type: 'image', url: realImageForSeed(`${i}:${authorName}:${line.text}`), alt: '深夜时间线上几句不同语言的短句叠在一起。', color: '#f7f9f9' }]
                : undefined;
        const poll: TwitterPoll | undefined = i % 6 === 2 ? {
            id: `fallback-poll-${i}-${now}`,
            question: '今天时间线更像什么？',
            options: [
                { id: 'light', label: '路灯', votes: 18 + i },
                { id: 'window', label: '亮着的窗', votes: 11 + i },
                { id: 'rain', label: '下雨前的街', votes: 7 + i },
            ],
            closesAt: now + (12 + i) * 3600000,
        } : undefined;
        return {
            id: uid(),
            accountId: char ? twitterAccountIdFor('character', char.id) : twitterAccountIdFor('npc', authorHandle),
            authorType: char ? 'character' : 'npc',
            charId: char?.id,
            authorName,
            authorHandle,
            authorAvatar: char?.avatar || account.avatar,
            authorBio: account.bio,
            authorLocation: account.location,
            authorVerified: account.verified,
            authorFollowers: account.followers,
            content: line.text,
            language: line.language,
            country: line.country,
            location: account.location,
            topics: line.topics,
            media,
            poll,
            mentions: [],
            replies: [],
            replyCount: 0,
            retweets: i * 2,
            quotes: i % 3,
            likes: 12 + i * 17,
            views: 500 + i * 311,
            createdAt: now - i * 300000,
            visibility: 'public',
            threadSize: i % 4 === 0 ? 2 : undefined,
            qualityTags: ['fallback', 'complete'],
            generated: false,
        } as TwitterTweet;
    });
};

export const enforceTwitterPublicMix = (
    tweets: TwitterTweet[],
    chars: CharacterProfile[] = [],
    user?: UserProfile,
    count = TWITTER_BATCH_SIZE,
): TwitterTweet[] => {
    const target = Math.max(count, TWITTER_MIN_BATCH_SIZE);
    const maxChars = twitterPublicCharacterQuota(target);
    let charCount = 0;
    const accepted: TwitterTweet[] = [];
    tweets.forEach(tweet => {
        if (!tweet || tweet.authorType === 'user') return;
        if (tweet.authorType === 'character') {
            if (charCount >= maxChars) return;
            charCount++;
        }
        accepted.push(tweet);
    });
    if (accepted.length < target) {
        const fillers = fallbackTwitterTweets([], user, target - accepted.length, { mode: 'public' })
            .slice(0, target - accepted.length);
        accepted.push(...fillers);
    }
    return accepted.slice(0, Math.max(target, Math.min(TWITTER_MAX_BATCH_SIZE, accepted.length)));
};

export const buildTwitterForYouFeed = (tweets: TwitterTweet[], user?: UserProfile): TwitterTweet[] => {
    const publicTweets = tweets.filter(t => t.authorType !== 'user');
    const npcCount = publicTweets.filter(t => t.authorType !== 'character').length;
    const maxChars = Math.floor(npcCount / 9);
    let charCount = 0;
    return tweets.filter(tweet => {
        if (tweet.authorType === 'user') return true;
        if (tweet.authorType !== 'character') return true;
        if (charCount >= maxChars) return false;
        charCount++;
        return true;
    });
};

export const generateTwitterTimeline = async (
    apiConfig: APIConfig,
    chars: CharacterProfile[],
    user: UserProfile,
    existing: TwitterTweet[] = [],
    accounts: TwitterAccount[] = [],
    options: TwitterTimelineOptions = {},
): Promise<TwitterTweet[]> => {
    const mode = options.mode || 'public';
    const raw = await callLlm(
        apiConfig,
        buildTimelinePrompt(chars, user, existing, accounts, { mode }),
        `Current time: ${new Date().toLocaleString('zh-CN')}. Generate a fresh high-quality fictional X/Twitter batch with at least ${TWITTER_BATCH_SIZE} posts.`,
    );
    const arr = parseTwitterJsonLoose(raw);
    const tweets = materializeTwitterTweets(arr, chars, user, existing);
    if (mode === 'public') return enforceTwitterPublicMix(tweets, chars, user, TWITTER_BATCH_SIZE);
    const accountPosts = tweets.filter(tweet => tweet.authorType !== 'user');
    if (accountPosts.length >= TWITTER_MIN_BATCH_SIZE) return accountPosts;
    return [...accountPosts, ...fallbackTwitterTweets(chars, user, TWITTER_BATCH_SIZE - accountPosts.length, { mode: 'focused' })];
};

export const generateTwitterSearchTweets = async (
    apiConfig: APIConfig,
    query: string,
    chars: CharacterProfile[],
    user: UserProfile,
    existing: TwitterTweet[] = [],
    accounts: TwitterAccount[] = [],
): Promise<TwitterTweet[]> => {
    const raw = await callLlm(
        apiConfig,
        `${buildTimelinePrompt(chars, user, existing, accounts, { mode: 'public' })}\nSearch expansion mode: all generated posts must be relevant to the search query while still feeling like a natural public timeline dominated by NPC strangers.`,
        `Search query: "${query}". Generate 10-12 relevant fictional X/Twitter posts, include some accounts/users results and at least two languages.`,
        9000,
    );
    const tweets = enforceTwitterPublicMix(materializeTwitterTweets(parseTwitterJsonLoose(raw), chars, user, existing), chars, user, TWITTER_BATCH_SIZE);
    return tweets.map(t => ({ ...t, topics: Array.from(new Set([query.replace(/^#/, ''), ...t.topics])).slice(0, 5) }));
};

export const buildTwitterTrends = (tweets: TwitterTweet[], limit = 8): TwitterTrend[] => {
    const freq = new Map<string, number>();
    tweets.forEach(t => t.topics.forEach(topic => {
        const key = topic.trim();
        if (key) freq.set(key, (freq.get(key) || 0) + 1);
    }));
    const base = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
    if (base.length) return base.map(([label, n], i) => ({ id: `trend-${label}`, label, posts: n * 120 + i * 37, blurb: '正在讨论' }));
    return trendPool.slice(0, limit).map((label, i) => ({ id: `trend-${i}`, label, posts: 1000 - i * 77, blurb: '虚拟趋势' }));
};

export const searchTwitter = (
    query: string,
    tweets: TwitterTweet[],
    accounts: TwitterAccount[],
    filters: { language?: string; country?: string; mediaOnly?: boolean } = {},
) => {
    const q = query.trim().replace(/^#/, '').toLowerCase();
    const matchTweet = (t: TwitterTweet) => {
        if (filters.language && t.language !== filters.language) return false;
        if (filters.country && t.country !== filters.country) return false;
        if (filters.mediaOnly && !t.media?.length) return false;
        if (!q) return true;
        return t.content.toLowerCase().includes(q)
            || t.authorName.toLowerCase().includes(q)
            || t.authorHandle.toLowerCase().includes(q)
            || (t.language || '').toLowerCase().includes(q)
            || (t.country || '').toLowerCase().includes(q)
            || t.topics.some(topic => topic.toLowerCase().includes(q))
            || (t.mentions || []).some(m => m.toLowerCase().includes(q))
            || (t.media || []).some(m => [m.alt, m.title, m.description, m.domain].some(x => (x || '').toLowerCase().includes(q)))
            || (t.poll?.options || []).some(o => o.label.toLowerCase().includes(q));
    };
    const matchedTweets = tweets.filter(matchTweet);
    const top = [...matchedTweets].sort((a, b) => (b.likes + b.retweets * 2 + b.replyCount * 3) - (a.likes + a.retweets * 2 + a.replyCount * 3));
    const latest = [...matchedTweets].sort((a, b) => b.createdAt - a.createdAt);
    const media = matchedTweets.filter(t => t.media?.length);
    const people = accounts.filter(a => {
        if (!q) return false;
        return a.displayName.toLowerCase().includes(q)
            || a.handle.toLowerCase().includes(q)
            || (a.bio || '').toLowerCase().includes(q)
            || (a.location || '').toLowerCase().includes(q)
            || (a.country || '').toLowerCase().includes(q)
            || (a.profileSummary || '').toLowerCase().includes(q)
            || (a.relationshipHint || '').toLowerCase().includes(q)
            || (a.interests || []).some(x => x.toLowerCase().includes(q));
    });
    return { top, latest, media, people };
};

export const createTwitterSearchRecord = (query: string, resultCount = 0): TwitterSearchRecord => ({
    id: `${Date.now()}_${hashString(query)}`,
    query: query.trim(),
    resultCount,
    createdAt: Date.now(),
});

export const TWITTER_CONTEXT_CACHE_KEY = 'moro_twitter_recent_context_v2';
export const TWITTER_DM_CONTEXT_CACHE_KEY = 'moro_twitter_recent_dm_context_v1';

export const cacheTwitterContextSummary = (tweets: TwitterTweet[], limit = 12, dmThreads: TwitterDMThread[] = []): void => {
    if (typeof localStorage === 'undefined') return;
    try {
        const summary = tweets
            .slice(0, limit)
            .map(t => ({
                id: t.id,
                charId: t.charId,
                authorType: t.authorType,
                authorName: t.authorName,
                language: t.language,
                country: t.country,
                text: t.content.slice(0, 180),
                topics: t.topics.slice(0, 3),
                at: t.createdAt,
            }));
        localStorage.setItem(TWITTER_CONTEXT_CACHE_KEY, JSON.stringify(summary));
        localStorage.setItem(TWITTER_DM_CONTEXT_CACHE_KEY, JSON.stringify(dmThreads.slice(0, 6).map(t => ({
            id: t.id,
            charId: t.participantCharId,
            accountName: t.accountName,
            lastMessage: t.lastMessage.slice(0, 160),
            at: t.updatedAt,
        }))));
    } catch { /* ignore */ }
};

export const readTwitterContextSummary = (charId?: string, limit = 5): string => {
    if (typeof localStorage === 'undefined') return '';
    try {
        const raw = JSON.parse(localStorage.getItem(TWITTER_CONTEXT_CACHE_KEY) || '[]');
        const dms = JSON.parse(localStorage.getItem(TWITTER_DM_CONTEXT_CACHE_KEY) || '[]');
        const parts: string[] = [];
        if (Array.isArray(raw)) {
            const picked = raw
                .filter((t: any) => !charId || t.charId === charId || t.authorType === 'user')
                .slice(0, limit);
            parts.push(...picked.map((t: any) => `- ${t.authorName}${t.language && t.language !== 'zh-CN' ? ` [${t.language}]` : ''}: ${String(t.text || '').slice(0, 180)}${Array.isArray(t.topics) && t.topics.length ? ` (#${t.topics.join(' #')})` : ''}`));
        }
        if (Array.isArray(dms)) {
            const pickedDm = dms.filter((t: any) => !charId || t.charId === charId).slice(0, 2);
            parts.push(...pickedDm.map((t: any) => `- 私信 ${t.accountName}: ${String(t.lastMessage || '').slice(0, 140)}`));
        }
        return parts.join('\n');
    } catch { return ''; }
};

export const createUserTweet = (
    content: string,
    user: UserProfile,
    source?: TwitterTweet,
    quoteNote?: string,
    profile?: TwitterProfile | null,
    extras: Partial<Pick<TwitterTweet, 'media' | 'poll' | 'visibility'>> = {},
): TwitterTweet => {
    const p = profile || defaultTwitterProfile(user);
    const clean = cleanText(content, 1600);
    return {
        id: uid(),
        accountId: twitterAccountIdFor('user', p.handle),
        authorType: 'user',
        authorName: p.displayName || user.name || 'User',
        authorHandle: normalizeHandle(p.displayName || user.name || 'user', p.handle),
        authorAvatar: p.avatar || user.avatar,
        authorBio: p.bio,
        authorLocation: p.location,
        authorFollowers: p.followers,
        content: clean,
        language: p.language || 'zh-CN',
        country: p.country || '中国',
        location: p.location,
        topics: Array.from(new Set((content.match(/#[\p{L}\p{N}_-]+/gu) || []).map(t => t.replace(/^#/, '').slice(0, 32)))),
        media: extras.media,
        poll: extras.poll,
        mentions: extractMentions(clean),
        replies: [],
        replyCount: 0,
        retweets: 0,
        quotes: source ? 1 : 0,
        likes: 0,
        views: 1,
        createdAt: Date.now(),
        sourceTweetId: source?.id,
        sourceTweet: source ? { id: source.id, accountId: source.accountId, authorName: source.authorName, authorHandle: source.authorHandle, content: source.content, language: source.language } : undefined,
        quoteNote,
        visibility: extras.visibility || 'public',
    };
};

export const createTwitterReply = (_tweet: TwitterTweet, content: string, user: UserProfile, profile?: TwitterProfile | null): TwitterReply => {
    const p = profile || defaultTwitterProfile(user);
    return {
        id: uid(),
        accountId: twitterAccountIdFor('user', p.handle),
        authorType: 'user',
        authorName: p.displayName || user.name || 'User',
        authorHandle: normalizeHandle(p.displayName || user.name || 'user', p.handle),
        authorAvatar: p.avatar || user.avatar,
        content: cleanText(content, 600),
        language: p.language || 'zh-CN',
        country: p.country || '中国',
        likes: 0,
        createdAt: Date.now(),
    };
};

export const generateTwitterAuthorReply = async (
    apiConfig: APIConfig,
    tweet: TwitterTweet,
    userReply: string,
    user: UserProfile,
    authorChar?: CharacterProfile,
    account?: TwitterAccount,
): Promise<TwitterReply> => {
    const sys = authorChar
        ? `You are ${authorChar.name}. Reply on X/Twitter in character. Persona: ${(authorChar.systemPrompt || '').slice(0, 700)} Life profile: ${(authorChar.lifeProfile?.content || '').slice(0, 500)}`
        : `You are X/Twitter user ${account?.displayName || tweet.authorName} (${account?.handle || tweet.authorHandle}). Reply in the original author's style.`;
    const text = await callLlm(
        apiConfig,
        `${sys}\nOutput only the reply text. Natural, specific, 10-120 characters unless the language needs more.`,
        `Original tweet:\n${tweet.content}\n\n${user.name} replied: ${userReply}\n\nWrite one natural reply.`,
        1000,
    );
    return {
        id: uid(),
        accountId: tweet.accountId || account?.id,
        authorType: authorChar ? 'character' : 'npc',
        authorName: tweet.authorName,
        authorHandle: tweet.authorHandle,
        authorAvatar: tweet.authorAvatar,
        charId: tweet.charId,
        content: cleanText(text.replace(/^["“”「」『』]|["“”「」『』]$/g, ''), 600) || '看到了。',
        language: tweet.language,
        country: tweet.country,
        likes: 0,
        createdAt: Date.now(),
    };
};

export const generateTwitterReactions = async (
    apiConfig: APIConfig,
    tweet: TwitterTweet,
    chars: CharacterProfile[],
    user: UserProfile,
): Promise<{ replies: TwitterReply[]; notifications: TwitterNotification[]; patch: Partial<TwitterTweet> }> => {
    const sys = `You generate fictional X/Twitter reactions. User ${user.name} just posted. Let characters and NPCs interact freely; same character may appear multiple times. Output JSON array only.`;
    const raw = await callLlm(
        apiConfig,
        sys,
        `Characters:\n${charBrief(chars)}\n\nUser tweet:\n${tweet.content}\n\nGenerate 5-12 interactions. action is reply|like|retweet|quote|mention|follow. reply/quote/mention need content. Use persona-specific reactions and some international NPCs. Format: [{"action":"reply","authorType":"character|npc","charId":"optional","authorName":"name","authorHandle":"@x","language":"zh-CN","country":"country","content":"..."}]`,
        4000,
    );
    return materializeTwitterReactions(parseTwitterJsonLoose(raw), tweet, chars);
};

export const materializeTwitterReactions = (
    rawItems: any[],
    tweet: TwitterTweet,
    chars: CharacterProfile[],
): { replies: TwitterReply[]; notifications: TwitterNotification[]; patch: Partial<TwitterTweet> } => {
    let likeDelta = 0, rtDelta = 0, quoteDelta = 0;
    const replies: TwitterReply[] = [];
    const notifications: TwitterNotification[] = [];
    rawItems.slice(0, 16).forEach(item => {
        const action = String(item?.action || '').toLowerCase();
        const matched = findChar(chars, item);
        const npc = accountFromNpc(item, `${tweet.id}:${item?.authorName || item?.content || action}`);
        const actorName = matched?.name || cleanText(item?.authorName || item?.author || item?.name, 40) || npc.displayName;
        const actorHandle = normalizeHandle(actorName, matched?.socialProfile?.handle || item?.authorHandle || item?.handle || npc.handle);
        const accountId = matched ? twitterAccountIdFor('character', matched.id) : twitterAccountIdFor('npc', actorHandle);
        const baseNotif = {
            id: uid(),
            tweetId: tweet.id,
            actorType: matched ? 'character' as const : 'npc' as const,
            actorName,
            actorHandle,
            actorAvatar: matched?.avatar || npc.avatar,
            actorCharId: matched?.id,
            createdAt: Date.now(),
            read: false,
        };
        if (action === 'reply') {
            const content = cleanText(item?.content || item?.body || item?.text, 600);
            if (!content) return;
            replies.push({
                id: uid(),
                accountId,
                authorType: matched ? 'character' : 'npc',
                authorName: actorName,
                authorHandle: actorHandle,
                authorAvatar: matched?.avatar || npc.avatar,
                charId: matched?.id,
                content,
                language: cleanText(item?.language || npc.language || tweet.language, 12),
                country: cleanText(item?.country || npc.country || tweet.country, 40),
                likes: clampInt(item?.likes, 0, 99999, 0),
                createdAt: Date.now(),
            });
            notifications.push({ ...baseNotif, kind: 'reply', snippet: content });
        } else if (action === 'retweet') {
            rtDelta++;
            notifications.push({ ...baseNotif, kind: 'retweet', snippet: '转推了你的推文' });
        } else if (action === 'quote') {
            quoteDelta++;
            notifications.push({ ...baseNotif, kind: 'quote', snippet: cleanText(item?.content, 160) || '引用了你的推文' });
        } else if (action === 'mention') {
            notifications.push({ ...baseNotif, kind: 'mention', snippet: cleanText(item?.content, 160) || '在时间线上提到了你' });
        } else if (action === 'follow') {
            notifications.push({ ...baseNotif, tweetId: '', kind: 'follow', snippet: '关注了你' });
        } else {
            likeDelta++;
            notifications.push({ ...baseNotif, kind: 'like', snippet: '喜欢了你的推文' });
        }
    });
    return {
        replies,
        notifications,
        patch: {
            replies: [...tweet.replies, ...replies],
            replyCount: tweet.replyCount + replies.length,
            likes: tweet.likes + likeDelta,
            retweets: tweet.retweets + rtDelta,
            quotes: tweet.quotes + quoteDelta,
        },
    };
};

export const translateTwitterText = async (
    apiConfig: APIConfig,
    text: string,
    targetLang = TWITTER_TRANSLATION_TARGET,
): Promise<string> => {
    const clean = cleanText(text, 2400);
    if (!clean) return '';
    const translated = await callLlm(
        apiConfig,
        `Translate the following social-media text to ${targetLang}. Preserve names, @handles, hashtags, and line breaks. Output only the translation.`,
        clean,
        2000,
    );
    return cleanText(translated, 2400);
};

export const createDMThread = (account: TwitterAccount): TwitterDMThread => ({
    id: `dm:${account.id}`,
    accountId: account.id,
    accountName: account.displayName,
    accountHandle: account.handle,
    accountAvatar: account.avatar,
    participantType: account.authorType === 'user' ? 'npc' : account.authorType,
    participantCharId: account.charId,
    lastMessage: '',
    updatedAt: Date.now(),
    unreadCount: 0,
    messages: [],
});

export const appendTwitterDMMessage = (
    thread: TwitterDMThread,
    message: Omit<TwitterDMMessage, 'id' | 'threadId' | 'createdAt'> & { createdAt?: number },
): TwitterDMThread => {
    const msg: TwitterDMMessage = {
        id: uid(),
        threadId: thread.id,
        createdAt: message.createdAt || Date.now(),
        ...message,
    };
    return {
        ...thread,
        accountName: thread.accountName,
        accountHandle: thread.accountHandle,
        messages: [...(thread.messages || []), msg],
        lastMessage: msg.tweetSnapshot ? `转发推文：${msg.tweetSnapshot.content.slice(0, 80)}` : msg.content,
        unreadCount: msg.senderType === 'account' ? (thread.unreadCount || 0) + 1 : thread.unreadCount || 0,
        updatedAt: msg.createdAt,
    };
};

export const generateTwitterDMReply = async (
    apiConfig: APIConfig,
    account: TwitterAccount,
    thread: TwitterDMThread,
    userText: string,
    chars: CharacterProfile[],
    user: UserProfile,
): Promise<TwitterDMMessage> => {
    const char = account.charId ? chars.find(c => c.id === account.charId) : undefined;
    const history = (thread.messages || []).slice(-10).map(m => `${m.senderType === 'user' ? user.name : account.displayName}: ${m.tweetSnapshot ? `[tweet] ${m.tweetSnapshot.content}` : m.content}`).join('\n');
    const sys = char
        ? `You are ${char.name} using X/Twitter DMs. Reply strictly in character. Persona: ${(char.systemPrompt || '').slice(0, 900)} Life profile: ${(char.lifeProfile?.content || '').slice(0, 500)} Account bio: ${account.bio || ''}`
        : `You are fictional X/Twitter account ${account.displayName} (${account.handle}). Bio: ${account.bio || ''}. Reply naturally in DMs.`;
    const text = await callLlm(
        apiConfig,
        `${sys}\nOutput only one DM message. Be specific, conversational, and aware of forwarded tweet cards if present.`,
        `Recent DM history:\n${history || '(empty)'}\n\nUser just sent: ${userText}\n\nWrite the reply.`,
        1200,
    );
    return {
        id: uid(),
        threadId: thread.id,
        senderType: 'account',
        accountId: account.id,
        content: cleanText(text, 800) || '我看到了。',
        createdAt: Date.now(),
        read: false,
        status: 'sent',
    };
};
