import type { APIConfig, CharacterProfile, ChatParcelDirection, ChatParcelMeta, ChatParcelMode, UserProfile } from '../types';
import { ContextBuilder } from './context';
import { callChatCompletion } from './llmClient';
import { extractContent } from './safeApi';
import { makeApiUsageMeta } from './apiUsageCatalog';
import { dailyParcelDraftPrompt, dailyParcelRoleSystemPrompt } from './laiwangPrompts';

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
        const prompt = dailyParcelDraftPrompt({
            coreContext,
            charName: char.name,
            userName,
            mode,
            requestHint: sanitizeParcelNote(input.requestHint),
            recentSummary: input.recentSummary,
        });

        const data = await callChatCompletion(api, {
            model: api.model,
            messages: [
                { role: 'system', content: dailyParcelRoleSystemPrompt(char.name) },
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
