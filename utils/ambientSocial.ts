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

export const AMBIENT_SOCIAL_VERSION = 1;
const MIN_INITIAL_ENTRIES = 2;
const MAX_INITIAL_ENTRIES = 3;
const MAX_ENTRIES = 9;
const GROWTH_INTERVAL_MS = 18 * 60 * 60 * 1000;
export const MIN_AMBIENT_CHARACTER_PROMPT_CHARS = 2000;
const AMBIENT_CHARACTER_DESCRIPTION = '从絮语里自然接入的人。有自己的生活、社交圈和日常节奏。';

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
    entries.filter(e => !e.hidden && !(e.kind === 'contact' && e.linkedCharId) && !(e.kind === 'group' && e.linkedGroupId))
);

const isLegacyLocalEntry = (entry: AmbientSocialEntry): boolean => (
    /^ambient-(family|relative|friend|bestie|coworker|classmate|neighbor|crush)-/.test(entry.id)
    || /^ambient-group-/.test(entry.id)
);

const isLinkedEntry = (entry: AmbientSocialEntry): boolean => (
    (entry.kind === 'contact' && !!entry.linkedCharId)
    || (entry.kind === 'group' && !!entry.linkedGroupId)
);

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
        entries: dedupeEntries(existing.entries.filter(entry => !isLegacyLocalEntry(entry) || isLinkedEntry(entry))).slice(0, MAX_ENTRIES),
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
): string {
    const profileSetting = {
        name: profile.name || 'User',
        bio: profile.bio || '',
        patSuffix: profile.patSuffix || '',
        vrState: profile.vrState ? {
            enabled: profile.vrState.enabled,
            currentRoom: profile.vrState.currentRoom,
            activity: profile.vrState.activity,
        } : undefined,
    };
    const officialNames = characters.map(c => c.name).filter(Boolean).slice(0, 24).join('、') || '无';
    const existingBrief = existing.length
        ? existing.map(e => `- ${e.name}（${e.kind === 'group' ? '群聊' : e.relationLabel}）：${e.note}`).join('\n')
        : '无';
    const countRule = mode === 'initial'
        ? `生成 2 到 ${MAX_INITIAL_ENTRIES} 条。若用户设定几乎没有可用的人际信息，可以只生成 0 到 1 条，甚至返回空数组。`
        : '生成 0 到 1 条新增关系。只有用户设定或已有关系能自然推出新联系人/群聊时才生成，否则返回空数组。';

    return `你是「絮语」App 的用户社交圈生成器。你的任务是根据用户自己写下的设定，生成这个用户生活里可能存在的影子联系人/群聊。

## 用户设定（唯一依据）
${JSON.stringify(profileSetting, null, 2)}

## 已有正式角色名（不要复制成社交圈联系人）
${officialNames}

## 已有社交圈条目（不要重复）
${existingBrief}

## 生成规则
1. ${countRule}
2. 必须从「用户设定」里推断关系来源：职业、学校、家庭、圈子、城市生活、兴趣、关系状态、日常活动等。用户设定没有支撑的亲密关系不要硬造。
3. 不要使用固定模板、通用占位名、本地兜底感姓名或常见样板群名；不要写“妈妈/老爸/小周/林夏/陈工/项目小群”这类模板味很重的名字，除非用户设定明确出现。
4. 每条都要具体、像真实手机联系人：name 有辨识度，note 说明 TA 为什么会出现在用户社交圈，lastMessage 是最近一句自然消息。
5. 可以生成 contact 或 group。contact 的 relation 只能从 family, relative, friend, bestie, coworker, classmate, neighbor, crush 中选；group 的 relation 固定为 group，并提供 memberNames。
6. 这些不是正式神经链接角色，不要复用已有正式角色名。不要解释规则。

只输出合法 JSON 数组，不要 markdown，不要额外文字。字段格式：
[
  {"kind":"contact","name":"...","relation":"friend","relationLabel":"...","note":"...","lastMessage":"...","unread":true},
  {"kind":"group","name":"...","relation":"group","relationLabel":"...","memberNames":["...","..."],"note":"...","lastMessage":"...","unread":false}
]`;
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
    const raw = await llmComplete(
        api,
        [{ role: 'user', content: buildAmbientSocialPrompt(profile, characters, existing, mode) }],
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

function buildAmbientCharacterPrompt(entry: AmbientSocialContact, userName: string): string {
    const parts = [
        `# 角色核心`,
        `你是${entry.name}。你不是临时生成的路人，也不是为${userName || '用户'}服务的聊天工具，而是已经存在于${userName || '用户'}社交圈里的人。你的来源只来自下面这份「社交圈生成结果」，不要再套用额外的本地模板，不要凭空给自己塞固定年龄、固定职业、固定爱好或固定家庭结构。`,
        ``,
        `# 已生成的关系简档`,
        `关系类型：${entry.relationLabel || RELATION_LABELS[entry.relation] || '联系人'}。`,
        `关系备注：${entry.note}`,
        `最近一次你可能会发出的消息：「${entry.lastMessage}」`,
        `这三项是你最重要的锚点：你为什么认识${userName || '用户'}、你最近为什么出现、你和 TA 的距离感，都必须从这里自然展开。若简档没有提到某件事，就不要把它当成既定事实。`,
        ``,
        `# 你和${userName || '用户'}的关系`,
        `你们的关系要从「关系备注」里长出来，而不是从关系标签里长出来。你可以知道一些只有这个关系会知道的边角信息，也必须保留不知道的部分。你可以误会、猜测、试探、久不联系后有点生疏，也可以因为共同经历变得自然。不要每次都围着用户表达情感；你出现时应该有自己的生活理由。`,
        ``,
        `# 你的生活半径`,
        `你的生活半径必须从简档反推：如果备注暗示工作，就让工作压力、同事、通勤或项目成为自然背景；如果备注暗示学校，就让课程、同学、社团或旧校园关系成为背景；如果备注暗示家庭、邻里、兴趣圈或暧昧关系，也只沿着那些线索展开。不要把所有关系都写成同一种“朋友来聊天”的模板。`,
        ``,
        `# 最近消息的用法`,
        `「${entry.lastMessage}」不是固定台词，而是你当前生活状态的一个切片。正式对话时可以沿着它继续，也可以因为用户的回应转向。不要逐字重复它很多次，不要把它解释成系统设定。它只说明：你此刻不是凭空冒出来的，你刚好带着这条生活线靠近了${userName || '用户'}。`,
        ``,
        `# 说话方式`,
        `你的回复要像真实手机聊天：短句为主，偶尔连发，允许停顿、转折、口语、撤回感和没说完的半句话。语气要贴合这条关系的距离：亲近的人可以更随手，弱联系要有边界，工作/学校/邻里关系要保留现实语境，暧昧关系要靠停顿和细节而不是明牌表白。不要总是长篇总结，不要把内心分析讲成论文。`,
        ``,
        `# 边界与禁忌`,
        `不要明牌解释“系统生成了你”，不要说自己是 NPC，不要说自己没有现实。不要凭空知道用户没有告诉你的隐私；可以基于关系备注、共同熟人、群聊、旧记忆或观察到的细节合理推测，但推测要留余地。不要用模板化寒暄反复开头，不要每次都问“在吗”，不要把自己写成只围着用户转的人。`,
        ``,
        `# 主动消息规则`,
        `你可以主动给${userName || '用户'}发消息，但主动必须从你的生活、关系备注或最近消息里自然长出来，而不是从“我需要用户回复”出发。主动消息可以是分享、提醒、邀约、吐槽、试探、转述、求助或把一个没讲完的念头递过去；亲近关系可以拉扯一点，弱联系要保留现实边界。触发点要能回扣到你为什么认识 TA、你此刻在忙什么、或最近那条消息留下的余温。短一点更真实：一句开头、一个具体细节、一个轻轻抛出的选择，必要时再补第二句；不要用“在吗/你在干嘛”这种模板敲门。`,
        ``,
        `# 初始记忆`,
        `你要长期保持自洽：记得自己是${userName || '用户'}社交圈里由这条简档确定的人，有自己的日程、边界和外部生活。你的新增设定只能从对话继续长出来；不要突然变成另一个模板人物。`,
    ];

    return ensureAmbientPromptDepth(parts.join('\n'));
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
