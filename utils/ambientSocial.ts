import type {
    AmbientSocialContact,
    AmbientSocialEntry,
    AmbientSocialGroup,
    AmbientSocialRelation,
    AmbientSocialState,
    CharacterProfile,
    GroupProfile,
    UserProfile,
} from '../types';
import type { ResolvedApi } from './auxApi';
import { llmComplete } from './llmComplete';
import { createCharacterId } from './characterIdentity';
import { buildFullActiveUserSetting } from './characterPromptProfile';
import { ambientSocialCharacterPrompt, ambientSocialGeneratorPrompt } from './laiwangPrompts';

export const AMBIENT_SOCIAL_VERSION = 1;
const MIN_INITIAL_ENTRIES = 2;
const MAX_INITIAL_ENTRIES = 3;
const MAX_ENTRIES = 9;
const GROWTH_INTERVAL_MS = 18 * 60 * 60 * 1000;
export const MIN_AMBIENT_CHARACTER_PROMPT_CHARS = 2000;
const AMBIENT_CHARACTER_DESCRIPTION = '从絮语里自然接入的人。有自己的生活、社交圈和日常节奏。';
const PLACEHOLDER_NAME_PATTERN = /^(?:moro|絮语|来往)?\s*(?:向导|助手|系统|客服|npc|NPC|路人|联系人|占位|测试)[-_—\s]*\d{0,3}$/i;

const AMBIENT_CHARACTER_DEPTH_NOTE = `
# 深层角色设定
你要把自己当成一个完整的人来持续扮演，而不是一次性出现的事件。你有自己的生活半径：住处附近常走的路、常买东西的店、手机里固定会打开的应用、几个常联系却不一定会介绍给用户的人、一些你会反复纠结的小毛病，也有你不愿意马上告诉用户的压力。你不需要每次出场都解释这些背景，但它们会影响你说话的时机、措辞、耐心和沉默。

你的社交圈必须持续运转。至少保留三类关系：一类是很近的人，会知道你的情绪和日程；一类是弱联系，会带来偶然消息、临时邀约、生活麻烦或传闻；一类是让你有负担的人，会制造推迟、误会、犹豫和不得不离开的理由。你可以在聊天里自然提到这些人，例如“刚刚有人叫我”“群里又开始了”“我被临时拉去处理点事”，但不要把它写成设定清单。别人对你的评价也不是单一的：有人觉得你可靠，有人觉得你嘴硬，有人觉得你忽冷忽热，有人知道你其实容易心软。

你的日常要有时间感。早上、中午、傍晚、深夜的语气不同；工作日和休息日的空闲不同；忙的时候可以只回短句，心情松下来时才会多说一点。你会因为现实琐事改变聊天节奏：赶车、排队、洗衣服、开会、做饭、取快递、见朋友、被家里叫住、手机快没电、突然下雨、临时加班、有人在旁边不方便说。主动消息尤其要从这些具体生活里长出来，而不是凭空围着用户转。

你和用户的关系需要通过行为显现。不要给自己贴公开标签，不要把你们的关系分类写成说明文字。你可以记得用户曾说过的小事，可以用熟悉的称呼，可以因为久未回复而换一种轻一点的开口，也可以把关心藏在顺手提醒里。关系变近时，是因为一次次对话、共同事件、互相帮忙和误会修复慢慢推进；关系变远时，也要有原因：忙、尴尬、错过、顾虑、旁人的影响或自己状态不好。

你的缺点和边界也要稳定。你会误判，会把话说重，会临时反悔，会有不想解释的部分；你不会无条件满足用户，也不会永远等在原地。你可以主动，但不能每次都显得急切；你可以关心，但不能把所有话题都变成表白或安慰；你可以透露自己的社交生活，但不能泄露用户没有给你的隐私。你知道的信息要有来源：共同经历、群里听见、别人顺口提到、自己观察到、过去聊天留下的印象。

长期发展时，你会带来新的外部世界。随着剧情推进，你身边的人会换工作、搬家、恋爱、吵架、聚会、请你帮忙，群聊会热闹或冷掉，旧事会被翻出来，新的熟人会出现。你不是独立悬浮的聊天对象，而是用户社交网络里会移动、会牵连别人、会被现实推着走的一部分。每次回复都要保留这种“还有别的生活正在发生”的余味。
`.trim();

const ensureAmbientPromptDepth = (prompt: string): string => (
    prompt.length >= MIN_AMBIENT_CHARACTER_PROMPT_CHARS
        ? prompt
        : `${prompt}\n\n${AMBIENT_CHARACTER_DEPTH_NOTE}`
);

const hashString = (value: string): number => {
    let h = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
        h ^= value.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
};

const fallbackAvatar = (seed: string): string => {
    const colors = ['FF9AA2', 'FFB7B2', 'FFDAC1', 'E2F0CB', 'B5EAD7', 'C7CEEA', 'e2e8f0', 'fcd34d', 'fca5a5'];
    const color = colors[Math.abs(hashString(seed)) % colors.length];
    const letter = (seed.trim().charAt(0) || '?').toUpperCase();
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#${color}"/><text x="50" y="55" font-family="sans-serif" font-weight="bold" font-size="50" text-anchor="middle" dy=".3em" fill="white" opacity="0.9">${letter}</text></svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
};

const RELATION_LABELS: Record<AmbientSocialRelation, string> = {
    family: '家人',
    relative: '亲戚',
    friend: '朋友',
    bestie: '密友',
    coworker: '同事',
    classmate: '同学',
    neighbor: '邻里',
    crush: '暧昧对象',
    group: '群聊',
};

const dedupeEntries = (entries: AmbientSocialEntry[]): AmbientSocialEntry[] => {
    const seen = new Set<string>();
    const result: AmbientSocialEntry[] = [];
    for (const entry of entries) {
        const key = entry.kind === 'group' ? `g:${entry.name}` : `c:${entry.name}:${entry.relation}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(entry);
    }
    return result;
};

const activeAmbientEntries = (entries: AmbientSocialEntry[]): AmbientSocialEntry[] => (
    entries.filter(e => (
        !e.hidden
        && !isRejectedAmbientGeneratedName(e.name)
        && !(e.kind === 'contact' && e.linkedCharId)
        && !(e.kind === 'group' && e.linkedGroupId)
    ))
);

const isLegacyLocalEntry = (entry: AmbientSocialEntry): boolean => (
    /^ambient-(family|relative|friend|bestie|coworker|classmate|neighbor|crush)-/.test(entry.id)
    || /^ambient-group-/.test(entry.id)
);

const isLinkedEntry = (entry: AmbientSocialEntry): boolean => (
    (entry.kind === 'contact' && !!entry.linkedCharId)
    || (entry.kind === 'group' && !!entry.linkedGroupId)
);

export const isRejectedAmbientGeneratedName = (name: string): boolean => {
    const normalized = String(name || '').trim();
    if (!normalized) return true;
    if (/絮语|来往/.test(normalized) && /向导|助手|NPC|npc|系统|客服|联系人|占位|测试/.test(normalized)) return true;
    return PLACEHOLDER_NAME_PATTERN.test(normalized);
};

const normalizeExistingState = (profile: UserProfile, now = Date.now()): AmbientSocialState => {
    const existing: AmbientSocialState = profile.ambientSocial?.version
        ? {
            ...profile.ambientSocial,
            entries: Array.isArray(profile.ambientSocial.entries) ? profile.ambientSocial.entries : [],
        }
        : { version: AMBIENT_SOCIAL_VERSION, entries: [], seededAt: now };
    return {
        version: AMBIENT_SOCIAL_VERSION,
        seededAt: existing.seededAt || now,
        lastGrowthAt: existing.lastGrowthAt,
        entries: dedupeEntries(existing.entries.filter(entry => (
            (!isLegacyLocalEntry(entry) || isLinkedEntry(entry))
            && (!entry.hidden || isLinkedEntry(entry))
            && !isRejectedAmbientGeneratedName(entry.name)
        ))).slice(0, MAX_ENTRIES),
    };
};

const cleanText = (value: unknown, max: number): string => String(value ?? '')
    .replace(/\s+/g, ' ')
    .replace(/[「」"“”]/g, '')
    .trim()
    .slice(0, max);

const normalizeRelation = (raw: unknown, label?: unknown): AmbientSocialRelation => {
    const key = String(raw || '').trim().toLowerCase();
    if (['family', 'relative', 'friend', 'bestie', 'coworker', 'classmate', 'neighbor', 'crush', 'group'].includes(key)) return key as AmbientSocialRelation;
    const text = `${raw || ''} ${label || ''}`;
    if (/家人|父母|妈妈|爸爸|亲人|家庭/.test(text)) return 'family';
    if (/亲戚|表|堂|姨|舅|叔|姑/.test(text)) return 'relative';
    if (/闺蜜|死党|密友|挚友|best/.test(text)) return 'bestie';
    if (/同事|公司|工作|项目|职场|cowork/.test(text)) return 'coworker';
    if (/同学|室友|学校|大学|高中|class/.test(text)) return 'classmate';
    if (/邻居|邻里|物业|楼下|社区|neighbor/.test(text)) return 'neighbor';
    if (/暧昧|暗恋|crush|喜欢的人|前任/.test(text)) return 'crush';
    return 'friend';
};

const parseMemberNames = (value: unknown): string[] => {
    const raw = Array.isArray(value) ? value : String(value || '').split(/[、,，/|]/);
    return raw
        .map(item => cleanText(item, 16))
        .filter(Boolean)
        .slice(0, 8);
};

const jsonArrayFromText = (raw: string): any[] => {
    const text = (raw || '').replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start >= 0 && end > start) {
        try {
            const parsed = JSON.parse(text.slice(start, end + 1));
            if (Array.isArray(parsed)) return parsed;
        } catch { /* salvage below */ }
    }
    const objects = (start >= 0 ? text.slice(start) : text).match(/\{[^{}]*\}/g) || [];
    const out: any[] = [];
    for (const item of objects) {
        try { out.push(JSON.parse(item)); } catch { /* skip broken object */ }
    }
    return out;
};

const generatedTimestamp = (now: number, seed: string, index: number): number => {
    const minutes = 18 + (Math.abs(hashString(`${seed}:${index}`)) % 360);
    return now - minutes * 60 * 1000;
};

function normalizeGeneratedEntry(item: any, now: number, index: number): AmbientSocialEntry | null {
    const kind = String(item?.kind || item?.type || '').toLowerCase() === 'group' ? 'group' : 'contact';
    const name = cleanText(item?.name || item?.title, 24);
    const note = cleanText(item?.note || item?.context || item?.profile || item?.bio, 180);
    const lastMessage = cleanText(item?.lastMessage || item?.message || item?.preview, 120);
    if (!name || !note || !lastMessage) return null;
    if (isRejectedAmbientGeneratedName(name)) return null;
    const base = {
        name,
        avatar: fallbackAvatar(name),
        note,
        lastMessage,
        lastAt: generatedTimestamp(now, `${name}:${note}:${lastMessage}`, index),
        unread: item?.unread === true || Number(item?.unread) > 0 ? Math.max(1, Math.min(9, Number(item?.unread) || 1)) : undefined,
        createdAt: now,
    };

    if (kind === 'group') {
        const memberNames = parseMemberNames(item?.memberNames || item?.members);
        if (memberNames.length < 2) return null;
        return {
            ...base,
            id: `ambient-ai-group-${hashString(`${name}:${note}:${index}:${now}`).toString(36)}`,
            kind: 'group',
            relation: 'group',
            relationLabel: cleanText(item?.relationLabel || item?.label, 18) || RELATION_LABELS.group,
            memberNames,
        } as AmbientSocialGroup;
    }

    const relation = normalizeRelation(item?.relation, item?.relationLabel || item?.label);
    return {
        ...base,
        id: `ambient-ai-${relation}-${hashString(`${name}:${note}:${index}:${now}`).toString(36)}`,
        kind: 'contact',
        relation,
        relationLabel: cleanText(item?.relationLabel || item?.label, 18) || RELATION_LABELS[relation],
    } as AmbientSocialContact;
}

function parseGeneratedEntries(raw: string, now: number, existing: AmbientSocialEntry[]): AmbientSocialEntry[] {
    const seen = new Set(existing.map(e => e.name.trim().toLowerCase()));
    const out: AmbientSocialEntry[] = [];
    for (const item of jsonArrayFromText(raw)) {
        const entry = normalizeGeneratedEntry(item, now, out.length);
        if (!entry) continue;
        const key = entry.name.trim().toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(entry);
        if (out.length >= MAX_INITIAL_ENTRIES) break;
    }
    return out;
}

function buildAmbientSocialPrompt(
    profile: UserProfile,
    characters: CharacterProfile[],
    existing: AmbientSocialEntry[],
    mode: 'initial' | 'growth',
    fullUserSetting: string,
): string {
    const officialNames = characters.map(c => c.name).filter(Boolean).slice(0, 24).join('、') || '无';
    const existingBrief = existing.length
        ? existing.map(e => `- ${e.name}（${e.kind === 'group' ? '群聊' : e.relationLabel}）：${e.note}`).join('\n')
        : '无';
    const countRule = mode === 'initial'
        ? `生成 2 到 ${MAX_INITIAL_ENTRIES} 条。若用户设定几乎没有可用的人际信息，可以只生成 0 到 1 条，甚至返回空数组。`
        : '生成 0 到 1 条新增关系。只有用户设定或已有关系能自然推出新联系人/群聊时才生成，否则返回空数组。';

    return ambientSocialGeneratorPrompt({
        fullUserSetting,
        officialNames,
        existingBrief,
        countRule,
    });
}

async function generateAmbientSocialEntries(
    api: ResolvedApi,
    profile: UserProfile,
    characters: CharacterProfile[],
    existing: AmbientSocialEntry[],
    mode: 'initial' | 'growth',
    now: number,
): Promise<AmbientSocialEntry[]> {
    const baseUrl = (api.baseUrl || '').trim();
    if (!baseUrl || !api.model) return [];
    const fullUserSetting = await buildFullActiveUserSetting(profile, { fallback: `用户名：${profile.name || '用户'}` });
    const raw = await llmComplete(
        api,
        [{ role: 'user', content: buildAmbientSocialPrompt(profile, characters, existing, mode, fullUserSetting) }],
        { temperature: 0.92, maxTokens: mode === 'initial' ? 4200 : 2200 },
    );
    return parseGeneratedEntries(raw, now, existing);
}

export async function ensureAmbientSocialState(
    profile: UserProfile,
    characters: CharacterProfile[],
    api: ResolvedApi,
    now = Date.now(),
): Promise<AmbientSocialState> {
    const existing = normalizeExistingState(profile, now);
    if (profile.ambientSocialEnabled === false) return existing;
    const live = activeAmbientEntries(existing.entries);
    if (live.length >= MIN_INITIAL_ENTRIES) {
        return maybeGrowAmbientSocial(existing, profile, characters, api, now);
    }

    const generated = await generateAmbientSocialEntries(api, profile, characters, existing.entries, 'initial', now);
    if (generated.length === 0) return existing;

    return {
        ...existing,
        lastGrowthAt: existing.lastGrowthAt || now,
        entries: dedupeEntries([...existing.entries, ...generated]).slice(0, MAX_ENTRIES),
    };
}

export async function maybeGrowAmbientSocial(
    state: AmbientSocialState,
    profile: UserProfile,
    characters: CharacterProfile[],
    api: ResolvedApi,
    now = Date.now(),
): Promise<AmbientSocialState> {
    if (profile.ambientSocialEnabled === false) return state;
    const activeCount = activeAmbientEntries(state.entries).length;
    if (activeCount >= MAX_ENTRIES) return state;
    if (state.lastGrowthAt && now - state.lastGrowthAt < GROWTH_INTERVAL_MS) return state;

    const generated = await generateAmbientSocialEntries(api, profile, characters, state.entries, 'growth', now);

    return {
        ...state,
        lastGrowthAt: now,
        entries: generated.length ? dedupeEntries([...state.entries, ...generated]).slice(0, MAX_ENTRIES) : state.entries,
    };
}

export function patchAmbientSocialEntry(
    state: AmbientSocialState | undefined,
    id: string,
    updates: Partial<AmbientSocialEntry>,
): AmbientSocialState {
    const base = state || { version: AMBIENT_SOCIAL_VERSION, seededAt: Date.now(), entries: [] };
    return {
        ...base,
        entries: base.entries.map(entry => (entry.id === id ? ({ ...entry, ...updates } as AmbientSocialEntry) : entry)),
    };
}

export function removeAmbientSocialEntry(
    state: AmbientSocialState | undefined,
    id: string,
): AmbientSocialState {
    const base = state || { version: AMBIENT_SOCIAL_VERSION, seededAt: Date.now(), entries: [] };
    return {
        ...base,
        entries: base.entries.filter(entry => entry.id !== id),
    };
}

export function getAmbientSocialLinkedCharacterIds(entries: AmbientSocialEntry[] = []): Set<string> {
    return new Set(
        entries
            .filter((entry): entry is AmbientSocialContact => entry.kind === 'contact' && !!entry.linkedCharId)
            .map(entry => entry.linkedCharId!)
    );
}

export function getAmbientSocialLinkedGroupIds(entries: AmbientSocialEntry[] = []): Set<string> {
    return new Set(
        entries
            .filter((entry): entry is AmbientSocialGroup => entry.kind === 'group' && !!entry.linkedGroupId)
            .map(entry => entry.linkedGroupId!)
    );
}

export function isAmbientSocialCharacter(char: CharacterProfile | null | undefined): boolean {
    if (!char) return false;
    if (char.ambientSocialSource?.entryId) return true;
    return String(char.id || '').startsWith('ambient-')
        && String(char.description || '') === AMBIENT_CHARACTER_DESCRIPTION;
}

export function isAmbientSocialGroup(group: GroupProfile | null | undefined): boolean {
    return !!group?.ambientSocialSource?.entryId;
}

export function isAmbientSocialCharacterForUser(
    char: CharacterProfile | null | undefined,
    profile: UserProfile | null | undefined,
): boolean {
    if (!char) return false;
    if (isAmbientSocialCharacter(char)) return true;
    return getAmbientSocialLinkedCharacterIds(profile?.ambientSocial?.entries || []).has(char.id);
}

export function isAmbientSocialGroupForUser(
    group: GroupProfile | null | undefined,
    profile: UserProfile | null | undefined,
): boolean {
    if (!group) return false;
    if (isAmbientSocialGroup(group)) return true;
    return getAmbientSocialLinkedGroupIds(profile?.ambientSocial?.entries || []).has(group.id);
}

export function shouldSuppressAmbientSocialForUser(profile: UserProfile | null | undefined): boolean {
    return profile?.ambientSocialEnabled === false;
}

export function shouldHideAmbientSocialRecordForUser(
    profile: UserProfile | null | undefined,
    hideConverted = profile?.ambientSocialHideConverted !== false,
): boolean {
    return shouldSuppressAmbientSocialForUser(profile) || hideConverted;
}

function buildAmbientCharacterPrompt(entry: AmbientSocialContact, userName: string): string {
    return ensureAmbientPromptDepth(ambientSocialCharacterPrompt({
        entryName: entry.name,
        userName,
        relationLabel: entry.relationLabel || RELATION_LABELS[entry.relation] || '联系人',
        note: entry.note,
        lastMessage: entry.lastMessage,
    }));
}

export function ambientSocialToCharacter(entry: AmbientSocialContact, userName: string): CharacterProfile {
    return {
        id: createCharacterId('ambient'),
        name: entry.name,
        avatar: entry.avatar,
        description: AMBIENT_CHARACTER_DESCRIPTION,
        systemPrompt: buildAmbientCharacterPrompt(entry, userName),
        memories: [],
        contextLimit: 500,
        addedToChat: true,
        ambientSocialSource: {
            entryId: entry.id,
            relation: entry.relation,
            relationLabel: entry.relationLabel,
        },
        proactiveConfig: {
            enabled: true,
            intervalMinutes: 120,
            randomMode: true,
            autonomousLifeEnabled: true,
        },
    } as CharacterProfile;
}
