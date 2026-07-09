import type { APIConfig, CharacterProfile, ChatParcelDirection, ChatParcelMeta, ChatParcelMode, UserProfile } from '../types';
import { ContextBuilder } from './context';
import { callChatCompletion } from './llmClient';
import { extractContent } from './safeApi';
import { makeApiUsageMeta } from './apiUsageCatalog';

export interface DailyParcelPreset {
    name: string;
    emoji: string;
}

export interface CharacterParcelDraft {
    itemName: string;
    emoji: string;
    note?: string;
    method?: string;
    originLabel?: string;
    travelSnippet?: string;
    requestHint?: string;
    generatedBy: 'char_ai' | 'fallback';
}

export const DAILY_PARCEL_ITEM_PRESETS: DailyParcelPreset[] = [
    { name: '热饮', emoji: '☕' },
    { name: '手写便签', emoji: '📝' },
    { name: '小点心', emoji: '🍪' },
    { name: '护手霜', emoji: '🧴' },
    { name: '雨伞', emoji: '🌂' },
    { name: '钥匙扣', emoji: '🔑' },
    { name: '一本小书', emoji: '📖' },
    { name: '拍立得', emoji: '📷' },
];

export const DAILY_PARCEL_METHODS = ['快递', '同城跑腿', '顺手捎来', '放在门口', '托人带到'];

export const TRAVEL_FROG_PARCEL_ITEM_PRESETS: DailyParcelPreset[] = [
    { name: '风景明信片', emoji: '🏞️' },
    { name: '车票夹页', emoji: '🎫' },
    { name: '海边贝壳', emoji: '🐚' },
    { name: '当地点心', emoji: '🍡' },
    { name: '路边小花', emoji: '🌼' },
    { name: '旅店便签', emoji: '📝' },
    { name: '纪念徽章', emoji: '🎖️' },
    { name: '拍下的照片', emoji: '📷' },
];

export const TRAVEL_FROG_PARCEL_METHODS = ['旅行邮筒', '驿站寄回', '托人带回', '归途捎来', '门口收件'];

const PARCEL_KEYWORD_EMOJIS: Array<[RegExp, string]> = [
    [/咖啡|奶茶|热饮|茶|饮料|可可/, '☕'],
    [/便签|信件|信纸|书信|纸条|字条|手写/, '📝'],
    [/饼干|点心|蛋糕|糖|巧克力|甜/, '🍪'],
    [/伞|雨衣|雨/, '🌂'],
    [/书|本子|漫画|小说/, '📖'],
    [/花|玫瑰|雏菊/, '💐'],
    [/照片|拍立得|相片/, '📷'],
    [/明信片|风景|山|海|湖|溪|车票|票根|旅行|旅店|驿站/, '🏞️'],
    [/贝壳|海边|沙滩/, '🐚'],
    [/徽章|纪念章|纪念/, '🎖️'],
    [/钥匙|挂件|钥匙扣/, '🔑'],
    [/药|创可贴|维生素/, '💊'],
    [/围巾|手套|袜|衣/, '🧣'],
];

const uid = (): string => `parcel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const clean = (value: unknown, max: number): string => (
    String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
);

export function sanitizeParcelItemName(value: unknown, fallback = '一份小包裹'): string {
    return clean(value, 40) || fallback;
}

export function sanitizeParcelNote(value: unknown): string | undefined {
    return clean(value, 160) || undefined;
}

export function sanitizeParcelMethod(value: unknown): string | undefined {
    return clean(value, 24) || undefined;
}

export function sanitizeParcelShortText(value: unknown, max = 48): string | undefined {
    return clean(value, max) || undefined;
}

export function inferParcelEmoji(itemName: string, fallback = '📦'): string {
    const name = itemName || '';
    const hit = PARCEL_KEYWORD_EMOJIS.find(([pattern]) => pattern.test(name));
    return hit?.[1] || fallback;
}

export function sanitizeParcelEmoji(value: unknown, itemName = ''): string {
    const raw = String(value ?? '').trim();
    const first = raw ? Array.from(raw)[0] : '';
    return first || inferParcelEmoji(itemName);
}

export function makeDailyParcelMeta(input: {
    direction: ChatParcelDirection;
    mode?: ChatParcelMode;
    senderRole: 'user' | 'char';
    fromName: string;
    toName: string;
    itemName: string;
    emoji?: string;
    note?: string;
    method?: string;
    originLabel?: string;
    travelSnippet?: string;
    requestHint?: string;
    generatedBy?: ChatParcelMeta['generatedBy'];
    at?: number;
}): ChatParcelMeta {
    const itemName = sanitizeParcelItemName(input.itemName);
    return {
        id: uid(),
        direction: input.direction,
        mode: input.mode || 'everyday',
        senderRole: input.senderRole,
        fromName: clean(input.fromName, 24) || (input.senderRole === 'user' ? '我' : 'TA'),
        toName: clean(input.toName, 24) || (input.senderRole === 'user' ? 'TA' : '我'),
        itemName,
        emoji: sanitizeParcelEmoji(input.emoji, itemName),
        note: sanitizeParcelNote(input.note),
        method: sanitizeParcelMethod(input.method),
        originLabel: sanitizeParcelShortText(input.originLabel, 36),
        travelSnippet: sanitizeParcelShortText(input.travelSnippet, 80),
        requestHint: sanitizeParcelNote(input.requestHint),
        generatedBy: input.generatedBy || (input.senderRole === 'char' ? 'char_ai' : 'user'),
        at: input.at || Date.now(),
    };
}

export function formatDailyParcelForPrompt(meta: ChatParcelMeta, userName: string, charName: string): string {
    const from = meta.senderRole === 'user' ? userName : charName;
    const to = meta.senderRole === 'user' ? charName : userName;
    const method = meta.method ? `，寄法/交付方式：${meta.method}` : '';
    const note = meta.note ? `，附言：「${meta.note}」` : '';
    const origin = meta.originLabel ? `，来源地：${meta.originLabel}` : '';
    const travel = meta.travelSnippet ? `，路上见闻：「${meta.travelSnippet}」` : '';
    const hint = meta.requestHint ? `，用户给过的提示：「${meta.requestHint}」` : '';
    const mode = meta.mode === 'travel_frog' ? '旅行青蛙式收件' : meta.mode === 'proactive' ? '主动寄来' : '日常寄物';
    return `${from} 给 ${to} 寄了 ${meta.emoji || '📦'}${meta.itemName}（${mode}）${method}${origin}${travel}${note}${hint}`;
}

export function fallbackCharacterParcelDraft(
    char: CharacterProfile,
    userName: string,
    requestHint?: string,
    mode: ChatParcelMode = 'everyday',
): CharacterParcelDraft {
    const hint = sanitizeParcelItemName(requestHint, '');
    const seedText = `${char.id}:${char.name}:${userName}:${hint}:${mode}`;
    let seed = 0;
    for (let i = 0; i < seedText.length; i += 1) seed = (seed * 31 + seedText.charCodeAt(i)) >>> 0;
    const travelOrigins = ['路过的海边小站', '旧街尽头的邮筒', '山脚下的小店', '午后车站', '临时落脚的旅店'];
    const preset = hint
        ? { name: hint, emoji: inferParcelEmoji(hint) }
        : mode === 'travel_frog'
            ? TRAVEL_FROG_PARCEL_ITEM_PRESETS[seed % TRAVEL_FROG_PARCEL_ITEM_PRESETS.length]
            : DAILY_PARCEL_ITEM_PRESETS[seed % DAILY_PARCEL_ITEM_PRESETS.length];
    const methods = mode === 'travel_frog' ? TRAVEL_FROG_PARCEL_METHODS : DAILY_PARCEL_METHODS;
    const method = methods[(seed >> 3) % methods.length];
    return {
        itemName: sanitizeParcelItemName(preset.name),
        emoji: sanitizeParcelEmoji(preset.emoji, preset.name),
        method,
        originLabel: mode === 'travel_frog' ? travelOrigins[(seed >> 5) % travelOrigins.length] : undefined,
        travelSnippet: mode === 'travel_frog' ? '路上看到它时，第一反应是想寄给你。' : undefined,
        note: mode === 'travel_frog'
            ? `${userName || '你'}，我从路上寄回来的。`
            : mode === 'proactive'
                ? `${userName || '你'}，突然想到你，就寄来了。`
                : `${userName || '你'}，这个给你留着。`,
        requestHint: sanitizeParcelNote(requestHint),
        generatedBy: 'fallback',
    };
}

export async function generateCharacterParcelDraft(input: {
    char: CharacterProfile;
    userProfile: UserProfile;
    api: APIConfig;
    recentSummary?: string;
    requestHint?: string;
    mode?: ChatParcelMode;
}): Promise<CharacterParcelDraft> {
    const { char, userProfile, api } = input;
    const mode = input.mode || 'everyday';
    const userName = userProfile.name || '用户';
    const fallback = fallbackCharacterParcelDraft(char, userName, input.requestHint, mode);
    if (!api?.baseUrl || !api?.model) return fallback;

    try {
        const coreContext = await ContextBuilder.buildFullCoreContext(char, userProfile, true);
        const requestHint = sanitizeParcelNote(input.requestHint);
        const task = mode === 'travel_frog'
            ? `你是「${char.name}」。现在采用「蛙游收件」模式：像《旅行青蛙》那样，你在自己的日常外出、短途游走、工作/修行/散步/旅途中，顺手给 ${userName} 寄回一件小东西。
这不是用户下单、不是心意铺、不是电商购物、不是虚拟余额消费，也不要写价格、订单号或平台术语。重点是“TA 不一定一直在线陪用户，但会从自己的生活路上寄回一点痕迹”：可以是明信片、票根、当地点心、贝壳、照片、小徽章、便签、路边小花等，也可以按角色时代/世界观换成合理物件。
${requestHint ? `用户给了一个出门/收件提示：「${requestHint}」。你可以顺着它，也可以按你的人设和旅途见闻稍微偏一点。` : '请按你的完整角色设定、生活半径、世界观、你和用户的关系、最近聊天氛围自己决定去了哪里、寄回什么。'}`
            : mode === 'proactive'
                ? `你是「${char.name}」。现在采用「主动寄来」模式：不是 ${userName} 开口索要，也不是用户下单，而是你在自己的日常里突然想到 ${userName}，主动给对方寄一件很像你会送出的小东西。
这不是心意铺、不是电商购物、不是虚拟余额消费，也不要写价格、订单号或平台术语。重点是“你主动想起对方”：可以是你顺手留的、刚好多出来的、觉得对方会用上的、想安慰/逗一下/照顾一下对方的小物件。要按完整角色设定、关系和最近聊天氛围决定，不要写成用户要求你寄。
${requestHint ? `这里有一个氛围或偏好提示：「${requestHint}」。它只是参考，不代表用户点名索要。` : '请自己决定寄什么和为什么寄。'}`
            : `你是「${char.name}」。现在你想通过絮语回形针里的「寄东西」给 ${userName} 寄一件很日常、很像你会想到的小东西。
这不是心意铺、不是电商购物、不是虚拟余额消费，也不要写价格、订单号或平台术语。它可以是顺手带的、家里多出来的、你特地留的、托人带来的、快递寄来的小物件。
${requestHint ? `用户给了一个提示或愿望：「${requestHint}」。你可以顺着它，也可以按你的人设稍微偏一点。` : '请按你的完整角色设定、你和用户的关系、最近聊天氛围自己挑。'}`;

        const outputSchema = mode === 'travel_frog'
            ? '{"itemName":"物件名，2-16字","emoji":"一个合适 emoji","method":"寄法或交付方式，8字内","originLabel":"从哪里寄来，4-18字","travelSnippet":"路上见闻或为什么寄它，12-36字","note":"你写给对方的一句附言，第一人称，8-40字"}'
            : '{"itemName":"物件名，2-16字","emoji":"一个合适 emoji","method":"寄法或交付方式，8字内","note":"你写给对方的一句附言，第一人称，8-40字"}';

        const prompt = `${coreContext}

### 最近聊天片段
${input.recentSummary?.trim() || '（最近没有更多聊天片段。）'}

### 任务：${mode === 'travel_frog' ? '蛙游收件' : mode === 'proactive' ? '主动寄来' : '日常寄物'}
${task}

只输出 JSON，不要 markdown，不要解释：
${outputSchema}`;

        const data = await callChatCompletion(api, {
            model: api.model,
            messages: [
                { role: 'system', content: `你正在扮演「${char.name}」，必须保持角色口吻与关系自洽。` },
                { role: 'user', content: prompt },
            ],
            temperature: 0.85,
            max_tokens: 360,
        }, {
            meta: makeApiUsageMeta('chat.privateReply', {
                charId: char.id,
                charName: char.name,
                apiRole: 'main',
                apiBinding: mode === 'travel_frog' ? '蛙游收件挑选' : mode === 'proactive' ? '主动寄物挑选' : '日常寄物挑选',
            }),
            presetScope: 'chat.private',
            presetMacros: { charName: char.name, userName },
        });
        const content = (extractContent(data) || '').trim();
        const match = content.match(/\{[\s\S]*\}/);
        if (!match) return fallback;
        const parsed = JSON.parse(match[0]);
        const itemName = sanitizeParcelItemName(parsed.itemName, fallback.itemName);
        return {
            itemName,
            emoji: sanitizeParcelEmoji(parsed.emoji, itemName),
            method: sanitizeParcelMethod(parsed.method) || fallback.method,
            originLabel: sanitizeParcelShortText(parsed.originLabel, 36) || fallback.originLabel,
            travelSnippet: sanitizeParcelShortText(parsed.travelSnippet, 80) || fallback.travelSnippet,
            note: sanitizeParcelNote(parsed.note) || fallback.note,
            requestHint: sanitizeParcelNote(input.requestHint),
            generatedBy: 'char_ai',
        };
    } catch {
        return fallback;
    }
}
