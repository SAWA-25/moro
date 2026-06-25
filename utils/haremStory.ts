/**
 * 椒房记 —— AI 后宫恋爱文字互动引擎（纯逻辑，无 DB / React）。
 * ============================================================================
 * 这是一套「AI 实时生成剧情」的后宫恋爱互动小说：
 * 每一回合由 AI 依据**当前完整 state** 现写一段剧情（旁白 + 对白）并给出
 * **3 个选项**；玩家的选择改变好感/信任/嫉妒/心情等变量、写入记忆与事件 flag，再驱动
 * 下一回合。本文件是整套游戏的「真相之源」，把用户需求里的 12 个模块落成可序列化、
 * 可单测的纯函数：
 *
 *   ① UI 显示模块            → app 层（apps/harem/StoryMode.tsx）消费本文件的 state
 *   ② 剧情推进模块            → determineTurnType + scheduleCast + advanceTime + applyChoice
 *   ③ 角色状态模块            → StoryChar（affection/trust/jealousy/mood/attitude/stage）
 *   ④ 好感度系统 / ⑤ 信任值 / ⑥ 嫉妒值 → applyChoice 的 effects 落地 + clamp + 连带
 *   ⑦ 记忆系统（长期 + 角色独立）→ StoryMemory + consolidateMemories
 *   ⑧ 事件 flag 系统          → state.flags + flagUpdates
 *   ⑨ AI 请求模块            → buildScenePrompt（把 14 条规则 + 输出 schema 烧进 prompt）
 *   ⑩ AI 输出解析模块         → parseScene（稳定 JSON → StoryScene，永远 3 个选项 + 兜底）
 *   ⑪ 存档读档模块            → 全 state 可 JSON 序列化；多档由 app 层 localStorage 管理
 *   ⑫ 结局判定模块            → ENDING_DEFS + checkEndings + computeEndingProgress
 *
 * 所有随机都接受可注入 rng（默认 Math.random），便于单测确定化。
 */

import { extractJson } from './safeApi';

// ════════════════════════════════════════════════════════════════════════════
//  通用工具
// ════════════════════════════════════════════════════════════════════════════

export const STORY_VERSION = 1;

const clampN = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Math.round(n)));
/** 变量统一钳在 0~100。 */
const clamp100 = (n: number): number => clampN(n, 0, 100);
const num = (v: any, def = 0): number => (typeof v === 'number' && isFinite(v) ? v : (typeof v === 'string' && v.trim() !== '' && isFinite(+v) ? +v : def));

let _seq = 0;
const sid = (): string => `${Date.now().toString(36)}${(_seq++).toString(36)}`;
const pick = <T,>(arr: T[], rng: () => number = Math.random): T => arr[Math.floor(rng() * arr.length)];

// ════════════════════════════════════════════════════════════════════════════
//  ③ 角色状态模块
// ════════════════════════════════════════════════════════════════════════════

/** 关系阶段（由好感推导，AI 不可越级，见规则 ④/⑥）。 */
export interface StoryStage { key: string; label: string; min: number; }
export const STORY_STAGES: StoryStage[] = [
    { key: 'stranger', label: '陌路', min: 0 },
    { key: 'acquaint', label: '相识', min: 18 },
    { key: 'friendly', label: '亲厚', min: 34 },
    { key: 'tender', label: '暧昧', min: 50 },
    { key: 'heart', label: '心动', min: 68 },
    { key: 'beloved', label: '挚爱', min: 85 },
];
export const stageOf = (affection: number): StoryStage => {
    let s = STORY_STAGES[0];
    for (const st of STORY_STAGES) if (affection >= st.min) s = st;
    return s;
};

/** 当前态度标签：由四维变量推导，给玩家一眼读懂角色此刻的状态。 */
export function deriveAttitude(c: Pick<StoryChar, 'affection' | 'trust' | 'jealousy' | 'mood'>): string {
    if (c.jealousy >= 75) return '醋意翻涌';
    if (c.jealousy >= 55 && c.affection >= 50) return '患得患失';
    if (c.trust < 25 && c.affection >= 40) return '戒备试探';
    if (c.mood < 28) return '郁郁寡欢';
    if (c.affection >= 85 && c.trust >= 70) return '情根深种';
    if (c.affection >= 68) return '芳心暗许';
    if (c.affection >= 50) return '若即若离';
    if (c.affection >= 34) return '渐生亲近';
    if (c.affection >= 18) return '客气疏离';
    return '形同陌路';
}

export interface StoryChar {
    charId: string;
    name: string;
    avatar: string;
    persona?: string;       // 人设摘要（喂 AI，规则 ②「不能忽略角色设定」）
    affection: number;      // 好感度 0-100
    trust: number;          // 信任值 0-100
    jealousy: number;       // 嫉妒值 0-100
    mood: number;           // 心情 0-100
    attitude: string;       // 态度标签（deriveAttitude 推导，AI 可在叙述里呼应）
    stage: string;          // 关系阶段 key（stageOf 推导）
    memories: StoryMemory[]; // 角色独立记忆（规则：加入角色独立记忆版）
    presentStreak: number;  // 连续未登场回合数（调度公平，规则 ⑤「不能都围着玩家转」）
    flags: Record<string, boolean>; // 角色级 flag（如 confessed / promised）
}

// ════════════════════════════════════════════════════════════════════════════
//  ⑦ 记忆系统（长期 + 角色独立）
// ════════════════════════════════════════════════════════════════════════════

export type MemoryKind = 'event' | 'promise' | 'conflict' | 'intimacy' | 'gift' | 'fact';
export interface StoryMemory {
    id: string;
    day: number;
    text: string;
    weight: number;         // 重要度 1-5（裁剪时高权重优先保留）
    kind: MemoryKind;
    charId?: string;        // 关联角色（角色独立记忆带上）
}

export const GLOBAL_MEMORY_CAP = 40;   // 长期记忆上限
export const CHAR_MEMORY_CAP = 14;     // 单角色记忆上限

/**
 * 长期记忆固化：超出上限时，保留「高权重 + 近期」的，丢弃「低权重 + 久远」的。
 * 返回裁剪后的数组（保持「新在前」的展示顺序）。
 */
export function consolidateMemories(mems: StoryMemory[], cap: number): StoryMemory[] {
    if (mems.length <= cap) return mems;
    const recentDay = mems.reduce((mx, m) => Math.max(mx, m.day), 0);
    // 评分：权重为主，近期加成；高分留下
    const scored = mems.map((m, i) => ({
        m, i,
        score: m.weight * 10 + Math.max(0, 8 - (recentDay - m.day)) + (i < 6 ? 4 : 0),
    }));
    const keepIds = new Set(scored.sort((a, b) => b.score - a.score).slice(0, cap).map(s => s.m.id));
    return mems.filter(m => keepIds.has(m.id));
}

// ════════════════════════════════════════════════════════════════════════════
//  ② 剧情推进模块：回合节奏（10 种回合）
// ════════════════════════════════════════════════════════════════════════════

export type TurnType =
    | 'daily' | 'date' | 'group' | 'jealousy' | 'cold_war'
    | 'night_talk' | 'breakthrough' | 'crisis' | 'route_lock' | 'ending';

export interface TurnMeta {
    key: TurnType;
    label: string;
    /** 该回合 AI 应当怎么写（写进 prompt）。 */
    guide: string;
    /** 该回合不该怎么写（写进 prompt）。 */
    avoid: string;
    /** 适合上升 / 下降的变量提示（给 AI 的 effects 取向）。 */
    raise: string;
    lower: string;
}

export const TURN_META: Record<TurnType, TurnMeta> = {
    daily: {
        key: 'daily', label: '日常',
        guide: '写一段松弛的日常照面：请安、闲谈、宫务、偶遇。用细节刻画人物，留一个小钩子。',
        avoid: '别强行制造冲突或亲密，别让多人同时围上来。',
        raise: '好感 / 信任（小幅）', lower: '—',
    },
    date: {
        key: 'date', label: '单人约会',
        guide: '只与一位独处的私密场景，氛围随好感而定（生疏则克制、亲近则缱绻）。给情感推进的机会。',
        avoid: '别让别的妃嫔乱入；别超出当前好感的亲密度（规则 ⑥）。',
        raise: '好感（中）/ 信任 / 心情', lower: '其余在场者嫉妒（若被撞见）',
    },
    group: {
        key: 'group', label: '多人同场',
        guide: '两三人同场（家宴 / 赏花 / 议事），写出微妙的暗流与各自心思，台词要分得清是谁。',
        avoid: '别让所有人都只顾讨好玩家；要有人之间的互动与试探。',
        raise: '气氛 / 个别好感', lower: '被冷落者好感·心情，竞争者嫉妒',
    },
    jealousy: {
        key: 'jealousy', label: '嫉妒爆发',
        guide: '某位嫉妒值过高者借故发作（使性子 / 含沙射影 / 暗中较劲）。让玩家在安抚与立威间抉择。',
        avoid: '别让其无理取闹到崩坏人设；别替玩家决定如何处置。',
        raise: '处理得当则信任回升', lower: '处理失当则好感·信任骤降',
    },
    cold_war: {
        key: 'cold_war', label: '冷战',
        guide: '与一位陷入冷淡僵局：刻意疏远、话不投机、欲言又止。写出克制的张力与台阶。',
        avoid: '别轻易和好；别让对方主动倒贴。回暖要靠玩家的诚意选项。',
        raise: '破冰则信任大涨', lower: '继续僵持则好感·心情下滑',
    },
    night_talk: {
        key: 'night_talk', label: '夜谈',
        guide: '夜深独处的交心：袒露身世、心事、脆弱。是积累信任与亲密的关键时刻。',
        avoid: '别强行表白或越界；让倾诉自然发生。',
        raise: '信任（大）/ 好感 / 心情', lower: '—',
    },
    breakthrough: {
        key: 'breakthrough', label: '关系突破',
        guide: '情到浓时的越级时刻（互诉衷肠 / 初次心意相通 / 定情信物）。仅当好感足够才触发。',
        avoid: '不可凭空让角色爱上玩家（规则 ④）；越界须有前情铺垫。',
        raise: '好感·信任（大）/ 阶段跃迁', lower: '其余在意者嫉妒上扬',
    },
    crisis: {
        key: 'crisis', label: '事件危机',
        guide: '一桩牵动全局的危机（构陷 / 急病 / 外戚之祸 / 流言）。玩家的处置见人心、定走向。',
        avoid: '别凭空降神化解；后果要落到具体变量与记忆上。',
        raise: '同舟者信任', lower: '处置不公者好感，相关者心情',
    },
    route_lock: {
        key: 'route_lock', label: '路线锁定',
        guide: '一个需要表态的抉择点：是否独许一人。写出郑重的分量与其他人的去留。',
        avoid: '别替玩家选；选了独宠才锁线，留有余地则维持后宫。',
        raise: '所选之人好感·信任封顶', lower: '落选者好感大跌、嫉妒可能爆',
    },
    ending: {
        key: 'ending', label: '结局判定',
        guide: '尾声定格：依当前格局收束这段后宫岁月，呼应一路的记忆与抉择，作结。',
        avoid: '别再抛新冲突；这是收尾不是开新篇。',
        raise: '—', lower: '—',
    },
};

export const TURN_LABEL = (t: TurnType): string => TURN_META[t]?.label || t;

/** 时辰：晨→午→晚→夜→（次日）晨。 */
export const TIME_SLOTS = ['晨', '午', '晚', '夜'] as const;
export type TimeSlot = typeof TIME_SLOTS[number];
export function advanceTime(time: TimeSlot, day: number): { time: TimeSlot; day: number } {
    const i = TIME_SLOTS.indexOf(time);
    if (i < 0 || time === '夜') return { time: '晨', day: day + 1 };
    return { time: TIME_SLOTS[i + 1], day };
}

const LOCATION_POOL: Record<TurnType, string[]> = {
    daily: ['椒房殿', '御花园', '长廊', '偏殿', '茶寮', '庭院'],
    date: ['湖心亭', '梅林深处', '画舫', '西苑', '藏书阁', '月洞门下'],
    group: ['宫宴', '花厅', '戏台前', '暖阁', '赏菊台'],
    jealousy: ['偏殿', '回廊转角', '寝殿外', '井亭', '妆台前'],
    cold_war: ['空殿', '冷宫道', '窗下', '回廊尽头', '雪地里'],
    night_talk: ['寝殿', '灯下', '廊下听雨', '榻边', '更漏旁'],
    breakthrough: ['月下', '花荫', '亭中', '红烛帐', '高台'],
    crisis: ['朝堂', '宫门', '病榻前', '密室', '审讯所'],
    route_lock: ['宗祠', '长阶', '星河下', '殿前', '誓约处'],
    ending: ['殿前', '史馆', '旧苑', '城头', '岁月尽头'],
};
export const pickLocation = (t: TurnType, rng: () => number = Math.random): string => pick(LOCATION_POOL[t] || LOCATION_POOL.daily, rng);

// ════════════════════════════════════════════════════════════════════════════
//  顶层 state（用户需求里的完整 state JSON）
// ════════════════════════════════════════════════════════════════════════════

export interface StoryChoice {
    text: string;
    tone: string;           // 语气：温柔 / 强势 / 试探 / 冷淡 / 玩笑 / 真诚…
    effects: { charId: string; affection?: number; trust?: number; jealousy?: number; mood?: number }[];
    risk: 'low' | 'mid' | 'high';
    nextIntent: string;     // 选此项后剧情走向（喂下一轮 AI）
}

export interface StoryDialogue { speaker: string; charId?: string; text: string; emotion?: string; }

/** ⑩ AI 单回合输出（稳定 JSON）。 */
export interface StoryScene {
    sceneTitle: string;
    narration: string;
    dialogues: StoryDialogue[];
    choices: StoryChoice[];          // 恒为 3 个
    effectsPreview: string;          // 给玩家的可读提示（不含精确数值）
    memoryUpdates: { charId?: string; text: string; kind?: MemoryKind; weight?: number }[];
    flagUpdates: Record<string, string | number | boolean>;
    nextSceneHint: string;
    turnType?: TurnType;             // 本回合的节奏类型（由引擎注入，便于存档回看）
}

export interface StoryHistoryEntry {
    day: number; time: TimeSlot; location: string;
    turnType: TurnType; sceneTitle: string;
    choiceText: string; tone: string; nextIntent: string;
}

export interface StoryState {
    version: number;
    playthrough: number;            // 周目（多周目版，1 起）
    player: { name: string; title: string; persona?: string };
    day: number;
    time: TimeSlot;
    location: string;
    turnType: TurnType;             // 「当前/即将呈现」这一回合的节奏
    turnCount: number;
    currentScene: StoryScene | null;
    activeCharacters: string[];     // 当前在场角色 charId
    characters: Record<string, StoryChar>;
    relationships: { a: string; b: string; bond: number }[]; // 角色之间（负=不睦，正=交好）
    memories: StoryMemory[];        // 长期/全局记忆（新在前）
    flags: Record<string, string | number | boolean>;
    history: StoryHistoryEntry[];   // 近期回合（滚动）
    route: { locked: boolean; charId: string | null; progress: number };
    endingProgress: Record<string, number>;
    lastTurn: { choiceText: string; tone: string; nextIntent: string } | null;
    carry: { fromPlaythrough: number; notes: string[] } | null; // 多周目继承
    createdAt: number;
}

export interface StorySeed { charId: string; name: string; avatar: string; affection?: number; persona?: string; }

const HISTORY_CAP = 18;

function makeChar(s: StorySeed, base: { affection: number; trust: number; jealousy: number; mood: number }): StoryChar {
    const c: StoryChar = {
        charId: s.charId, name: s.name, avatar: s.avatar, persona: s.persona,
        affection: clamp100(typeof s.affection === 'number' ? s.affection : base.affection),
        trust: base.trust, jealousy: base.jealousy, mood: base.mood,
        attitude: '', stage: '', memories: [], presentStreak: 0, flags: {},
    };
    c.stage = stageOf(c.affection).key;
    c.attitude = deriveAttitude(c);
    return c;
}

/** 开一盘新文游：好感从真实 affection 起步（缺省 30），信任 35 / 嫉妒 10 / 心情 60。 */
export function initStory(
    seeds: StorySeed[],
    player: { name: string; title?: string; persona?: string },
    carry: { fromPlaythrough: number; notes: string[] } | null = null,
): StoryState {
    const characters: Record<string, StoryChar> = {};
    seeds.forEach(s => { characters[s.charId] = makeChar(s, { affection: 30, trust: 35, jealousy: 10, mood: 60 }); });
    const ids = Object.keys(characters);
    const state: StoryState = {
        version: STORY_VERSION,
        playthrough: carry ? carry.fromPlaythrough + 1 : 1,
        player: { name: player.name || '君', title: player.title || '君上', persona: player.persona },
        day: 1, time: '晨', location: '椒房殿',
        turnType: 'daily', turnCount: 0,
        currentScene: null,
        activeCharacters: ids.slice(0, 1),
        characters,
        relationships: [],
        memories: [],
        flags: {},
        history: [],
        route: { locked: false, charId: null, progress: 0 },
        endingProgress: {},
        lastTurn: null,
        carry,
        createdAt: Date.now(),
    };
    state.endingProgress = computeEndingProgress(state);
    return state;
}

// ════════════════════════════════════════════════════════════════════════════
//  ② 剧情推进：角色调度（谁登场）
// ════════════════════════════════════════════════════════════════════════════

const sortByAff = (chars: StoryChar[]): StoryChar[] => [...chars].sort((a, b) => b.affection - a.affection);
const allChars = (s: StoryState): StoryChar[] => Object.values(s.characters);

/**
 * 排本回合的登场角色。兼顾「剧情需要」与「公平」（presentStreak 高=久未登场者优先），
 * 落实规则 ⑤「不能让所有角色都围着玩家转」。
 */
export function scheduleCast(s: StoryState, turnType: TurnType, rng: () => number = Math.random): string[] {
    const chars = allChars(s);
    if (chars.length === 0) return [];
    const byAff = sortByAff(chars);
    const byNeglect = [...chars].sort((a, b) => b.presentStreak - a.presentStreak);
    const routeChar = s.route.charId && s.characters[s.route.charId] ? s.characters[s.route.charId] : null;
    const mostJealous = [...chars].sort((a, b) => b.jealousy - a.jealousy)[0];
    const lowestMood = [...chars].sort((a, b) => a.mood - b.mood)[0];

    const one = (c?: StoryChar | null): string[] => (c ? [c.charId] : [byAff[0].charId]);

    switch (turnType) {
        case 'date':
        case 'night_talk':
        case 'breakthrough':
        case 'route_lock': {
            if ((turnType === 'route_lock' || turnType === 'breakthrough') && routeChar) return one(routeChar);
            // 约会/夜谈：好感高者优先，但给久未登场者机会（公平）
            const neglected = byNeglect[0];
            if (neglected && neglected.presentStreak >= 3 && neglected.affection >= 28 && rng() < 0.5) return one(neglected);
            return one(byAff[0]);
        }
        case 'jealousy': {
            const rival = byAff.find(c => c.charId !== mostJealous.charId) || null;
            return rival ? [mostJealous.charId, rival.charId] : [mostJealous.charId];
        }
        case 'cold_war':
            return one(lowestMood);
        case 'group':
        case 'crisis': {
            const want = Math.min(chars.length, turnType === 'crisis' ? 2 : (chars.length >= 3 ? 3 : 2));
            const cast: string[] = [];
            if (byAff[0]) cast.push(byAff[0].charId);                 // 一位主角
            for (const c of byNeglect) {                              // 补久未登场者
                if (cast.length >= want) break;
                if (!cast.includes(c.charId)) cast.push(c.charId);
            }
            return cast.slice(0, want);
        }
        case 'ending':
            return routeChar ? one(routeChar) : byAff.slice(0, Math.min(3, byAff.length)).map(c => c.charId);
        case 'daily':
        default: {
            // 1~2 人，偏向久未登场者，偶尔配一个高好感者
            const lead = (byNeglect[0] && byNeglect[0].presentStreak >= 2) ? byNeglect[0] : pick(byAff.slice(0, Math.min(3, byAff.length)), rng);
            const cast = [lead.charId];
            if (chars.length > 1 && rng() < 0.35) {
                const second = byNeglect.find(c => c.charId !== lead.charId);
                if (second) cast.push(second.charId);
            }
            return cast;
        }
    }
}

// ════════════════════════════════════════════════════════════════════════════
//  ② 剧情推进：回合类型判定（触发条件）
// ════════════════════════════════════════════════════════════════════════════

/** 是否已满足某个「硬结局」条件（决定是否强制进入 ending 回合）。 */
export function endingReady(s: StoryState): boolean {
    return !!checkEndings(s, true);
}

/**
 * 判定下一回合的节奏类型。优先级：结局 > 嫉妒爆发 > 冷战 > 危机 > 路线锁定 > 关系突破 > 夜谈 > 约会/多人/日常。
 * 多数判定基于变量阈值（落实规则 ⑦「必须根据好感/信任/嫉妒改变态度」），其余加权随机避免重复（规则 ⑨）。
 */
export function determineTurnType(s: StoryState, rng: () => number = Math.random): TurnType {
    const chars = allChars(s);
    if (chars.length === 0) return 'daily';
    const recent = s.history.slice(0, 3).map(h => h.turnType);
    const usedRecently = (t: TurnType) => recent.includes(t);

    // 0) 硬结局条件满足 → 结局判定回合
    if (endingReady(s)) return 'ending';

    // 1) 嫉妒爆发：有人嫉妒≥70 且非刚发作
    const jealous = chars.find(c => c.jealousy >= 70);
    if (jealous && !usedRecently('jealousy')) return 'jealousy';

    // 2) 冷战：有人好感尚可但信任很低 / 心情谷底
    const frosty = chars.find(c => c.affection >= 32 && (c.trust < 22 || c.mood < 22));
    if (frosty && !usedRecently('cold_war') && rng() < 0.8) return 'cold_war';

    // 3) 危机：到中期、隔一阵来一次大事件
    if (s.day >= 4 && s.turnCount >= 6 && !usedRecently('crisis') && rng() < 0.22) return 'crisis';

    // 4) 路线锁定：有人遥遥领先且已暧昧以上、尚未锁线
    if (!s.route.locked) {
        const ranked = sortByAff(chars);
        const top = ranked[0], second = ranked[1];
        const lead = top.affection - (second?.affection ?? 0);
        if (top.affection >= 82 && top.trust >= 68 && lead >= 16 && s.day >= 6 && !usedRecently('route_lock')) return 'route_lock';
    }

    // 5) 关系突破：在场某人好感跨到「心动」且尚未突破过
    const breakable = s.activeCharacters
        .map(id => s.characters[id])
        .find(c => c && c.affection >= 66 && c.trust >= 50 && !c.flags.broke);
    if (breakable && !usedRecently('breakthrough') && rng() < 0.7) return 'breakthrough';

    // 6) 夜谈：夜晚 + 在场有好感中等以上者
    if (s.time === '夜') {
        const intimate = s.activeCharacters.map(id => s.characters[id]).find(c => c && c.affection >= 40);
        if (intimate && !usedRecently('night_talk')) return 'night_talk';
    }

    // 7) 其余：约会 / 多人 / 日常 加权随机（避免与最近一回合重复）
    const bag: TurnType[] = [];
    bag.push('daily', 'daily');
    if (chars.length >= 2) bag.push('group');
    bag.push('date');
    const filtered = bag.filter(t => t !== recent[0]);
    return pick(filtered.length ? filtered : bag, rng);
}

// ════════════════════════════════════════════════════════════════════════════
//  ⑨ AI 请求模块：把 14 条规则 + 输出 schema 烧进 prompt
// ════════════════════════════════════════════════════════════════════════════

const RULES = [
    '只能根据当前 state 生成剧情，不得脑补未给出的设定。',
    '不能忽略角色设定（人设、当前态度与变量）。',
    '不能替玩家做决定——玩家的选择只在 choices 里，narration/dialogues 不得代替玩家行动或表态。',
    '不能突然让角色爱上玩家；情感变化必须循序、与变量相称。',
    '不能让所有角色都围着玩家转；只写「在场角色」，且允许角色之间有自己的心思与互动。',
    '不能输出超出当前好感/信任阶段的亲密行为（陌路/相识阶段不得有越界举动）。',
    '必须依据好感、信任、嫉妒改变角色的态度与言行。',
    '必须延续最近的历史（呼应上一回合玩家的选择与意图）。',
    '必须避免与最近剧情重复（场景、台词、冲突要有新意）。',
    '每轮必须输出稳定、可被 JSON.parse 的 JSON，且只输出该 JSON。',
    '每轮必须给恰好 3 个玩家选项。',
    '每个选项必须有明确的变量影响（effects 至少作用一位在场角色）。',
    '可在 memoryUpdates / flagUpdates 里更新记忆与事件标记（按需，不强求）。',
    '不允许直接跳结局——除非本回合 turnType 已是 ending。',
];

const SCHEMA = `{
  "sceneTitle": "本场标题(简短)",
  "narration": "旁白叙事(可多句，描述场景/动作/心理，不替玩家说话)",
  "dialogues": [{"speaker":"角色名","text":"台词","emotion":"情绪(可选)"}],
  "choices": [
    {"text":"选项文案","tone":"语气","effects":[{"charId":"角色id","affection":整数,"trust":整数,"jealousy":整数,"mood":整数}],"risk":"low|mid|high","nextIntent":"选此项后剧情走向"}
  ],
  "effectsPreview": "给玩家的朦胧提示(不写精确数字)",
  "memoryUpdates": [{"charId":"角色id(可空=全局)","text":"要记住的事","kind":"event|promise|conflict|intimacy|gift|fact","weight":1到5}],
  "flagUpdates": {"flag名":"值"},
  "nextSceneHint": "下一场的走向暗示"
}`;

function rosterBlock(s: StoryState): string {
    return allChars(s).map(c => {
        const here = s.activeCharacters.includes(c.charId) ? '【在场】' : '【未登场】';
        const recall = c.memories.slice(0, 3).map(m => m.text).join('；');
        return `- ${here}${c.name}(id=${c.charId})：好感${c.affection}/信任${c.trust}/嫉妒${c.jealousy}/心情${c.mood}｜阶段「${stageOf(c.affection).label}」｜态度「${c.attitude}」`
            + (c.persona ? `\n    人设：${c.persona.slice(0, 160)}` : '')
            + (recall ? `\n    ta记得：${recall}` : '');
    }).join('\n');
}

function historyBlock(s: StoryState): string {
    if (!s.history.length) return '（这是开场，尚无历史）';
    return s.history.slice(0, 4).map(h => `· 第${h.day}日${h.time}·${TURN_LABEL(h.turnType)}「${h.sceneTitle}」→ 你选择「${h.choiceText}」（${h.tone}）`).join('\n');
}

/**
 * 组装单回合 prompt。opening=true 时为开场（无历史）。
 * 引擎已在外部定好 turnType / activeCharacters / time / location，AI 只负责「在给定节奏里把这场戏写好」，
 * 从而牢牢控住节奏（玩家/引擎掌控结构，AI 掌控文笔），并杜绝 AI 擅自跳结局（规则 ⑭）。
 */
export function buildScenePrompt(s: StoryState, opts: { opening?: boolean } = {}): { system: string; user: string } {
    const tm = TURN_META[s.turnType];
    const present = s.activeCharacters.map(id => s.characters[id]?.name).filter(Boolean).join('、') || '（无人在场，写一段独景）';
    const carryNote = s.carry?.notes?.length ? `\n【前尘旧梦·第${s.carry.fromPlaythrough}周目残留】${s.carry.notes.slice(0, 3).join('；')}` : '';

    const system = `你是一款古风后宫恋爱文字互动游戏（galgame 式）的「实时编剧」。玩家扮演君主「${s.player.title}」，在后宫与多位可攻略角色周旋。`
        + `你的职责：依据下方**当前游戏状态**，写好「这一回合」的一小段剧情，并给玩家 3 个选择。文风古雅、含蓄、有张力，重人物与情感。\n\n`
        + `【铁律 · 必须全部遵守】\n${RULES.map((r, i) => `${i + 1}. ${r}`).join('\n')}\n\n`
        + `【本回合节奏：${tm.label}】\n应当：${tm.guide}\n避免：${tm.avoid}\n变量取向：宜升「${tm.raise}」、宜降「${tm.lower}」。\n\n`
        + `【输出格式】只输出一个 JSON（不要任何解释、不要 Markdown、不要代码块标记），结构如下：\n${SCHEMA}\n`
        + `约束：choices 必须恰好 3 个；每个选项 effects 至少含一位在场角色、数值为整数（好感/信任建议 -12~12、嫉妒/心情 -15~15）；speaker 用上面出现过的角色名；id 用上面的 id。`;

    const user = `【玩家】${s.player.name}（${s.player.title}）${s.player.persona ? `｜${s.player.persona.slice(0, 120)}` : ''}\n`
        + `【时空】第 ${s.day} 日 · ${s.time} · ${s.location}\n`
        + `【在场】${present}\n`
        + `【后宫诸位】\n${rosterBlock(s)}\n`
        + `【事件标记 flags】${Object.keys(s.flags).length ? JSON.stringify(s.flags) : '（无）'}\n`
        + `【近期历史】\n${historyBlock(s)}`
        + (s.lastTurn ? `\n【上一回合你的选择】「${s.lastTurn.choiceText}」（${s.lastTurn.tone}）→ 意图：${s.lastTurn.nextIntent || '—'}` : '')
        + carryNote
        + `\n\n请据此写「${opts.opening ? '开场' : '这一回合'}」的剧情 JSON。`;

    return { system, user };
}

// ════════════════════════════════════════════════════════════════════════════
//  ⑩ AI 输出解析模块：稳定 JSON → StoryScene（永远 3 个选项 + 兜底）
// ════════════════════════════════════════════════════════════════════════════

const VALID_KINDS = new Set<MemoryKind>(['event', 'promise', 'conflict', 'intimacy', 'gift', 'fact']);
const asKind = (v: any): MemoryKind => (VALID_KINDS.has(v) ? v : 'event');
const asRisk = (v: any): StoryChoice['risk'] => (v === 'low' || v === 'high' ? v : 'mid');

const EFF_AFF = 12, EFF_MOOD = 15;
function sanitizeEffects(raw: any, s: StoryState, fallbackCharId?: string): StoryChoice['effects'] {
    const byId = new Set(Object.keys(s.characters));
    const byName = new Map(allChars(s).map(c => [c.name, c.charId]));
    const out: StoryChoice['effects'] = [];
    for (const e of (Array.isArray(raw) ? raw : [])) {
        let cid = String(e?.charId || '').trim();
        if (!byId.has(cid)) cid = byName.get(String(e?.name || e?.charId || '').trim()) || '';
        if (!byId.has(cid)) continue;
        const eff: StoryChoice['effects'][number] = { charId: cid };
        if (e?.affection != null) eff.affection = clampN(num(e.affection), -EFF_AFF, EFF_AFF);
        if (e?.trust != null) eff.trust = clampN(num(e.trust), -EFF_AFF, EFF_AFF);
        if (e?.jealousy != null) eff.jealousy = clampN(num(e.jealousy), -EFF_MOOD, EFF_MOOD);
        if (e?.mood != null) eff.mood = clampN(num(e.mood), -EFF_MOOD, EFF_MOOD);
        out.push(eff);
    }
    // 规则 ⑫：每个选项至少作用一位在场角色
    if (out.length === 0) {
        const cid = fallbackCharId && byId.has(fallbackCharId) ? fallbackCharId : s.activeCharacters[0] || Object.keys(s.characters)[0];
        if (cid) out.push({ charId: cid, affection: 1 });
    }
    return out;
}

/** 兜底选项（解析不足 3 个时补齐）：温和正向、低风险。 */
function fallbackChoices(s: StoryState, have: number): StoryChoice[] {
    const cid = s.activeCharacters[0] || Object.keys(s.characters)[0] || '';
    const presets: { text: string; tone: string; aff: number; risk: StoryChoice['risk']; intent: string }[] = [
        { text: '温言以待，徐徐图之', tone: '温柔', aff: 4, risk: 'low', intent: '以温和拉近距离' },
        { text: '坦诚相告，以心换心', tone: '真诚', aff: 5, risk: 'mid', intent: '以坦诚换取信任' },
        { text: '不动声色，按下不表', tone: '克制', aff: 0, risk: 'low', intent: '维持现状、暗中观察' },
    ];
    return presets.slice(0, Math.max(0, 3 - have)).map(p => ({
        text: p.text, tone: p.tone, risk: p.risk, nextIntent: p.intent,
        effects: cid ? [{ charId: cid, affection: p.aff }] : [],
    }));
}

export function parseScene(raw: string, s: StoryState): StoryScene | null {
    const o = extractJson(raw);
    if (!o || typeof o !== 'object') return null;
    const byName = new Map(allChars(s).map(c => [c.name, c.charId]));

    const dialogues: StoryDialogue[] = (Array.isArray(o.dialogues) ? o.dialogues : [])
        .map((d: any) => {
            const speaker = String(d?.speaker || d?.name || '').trim();
            const text = String(d?.text || d?.line || '').trim();
            if (!text) return null;
            return { speaker, charId: byName.get(speaker), text, emotion: d?.emotion ? String(d.emotion).slice(0, 8) : undefined };
        })
        .filter(Boolean) as StoryDialogue[];

    let choices: StoryChoice[] = (Array.isArray(o.choices) ? o.choices : [])
        .slice(0, 3)
        .map((c: any) => ({
            text: String(c?.text || c?.label || '').trim().slice(0, 60),
            tone: String(c?.tone || '平和').trim().slice(0, 8) || '平和',
            effects: sanitizeEffects(c?.effects, s),
            risk: asRisk(c?.risk),
            nextIntent: String(c?.nextIntent || c?.intent || '').trim().slice(0, 80),
        }))
        .filter((c: StoryChoice) => c.text);
    if (choices.length < 3) choices = [...choices, ...fallbackChoices(s, choices.length)];
    choices = choices.slice(0, 3);

    const memoryUpdates = (Array.isArray(o.memoryUpdates) ? o.memoryUpdates : [])
        .map((m: any) => {
            const text = String(m?.text || '').trim();
            if (!text) return null;
            let cid = String(m?.charId || '').trim();
            if (cid && !s.characters[cid]) cid = byName.get(cid) || '';
            return { charId: cid && s.characters[cid] ? cid : undefined, text: text.slice(0, 120), kind: asKind(m?.kind), weight: clampN(num(m?.weight, 1), 1, 5) };
        })
        .filter(Boolean) as StoryScene['memoryUpdates'];

    const flagUpdates: Record<string, string | number | boolean> = {};
    if (o.flagUpdates && typeof o.flagUpdates === 'object' && !Array.isArray(o.flagUpdates)) {
        for (const [k, v] of Object.entries(o.flagUpdates)) {
            if (!k) continue;
            if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') flagUpdates[String(k).slice(0, 40)] = v;
        }
    }

    const narration = String(o.narration || o.scene || '').trim();
    if (!narration && dialogues.length === 0) return null; // 一片空白视作失败，让 app 兜底

    return {
        sceneTitle: String(o.sceneTitle || o.title || '此情此景').trim().slice(0, 30) || '此情此景',
        narration,
        dialogues,
        choices,
        effectsPreview: String(o.effectsPreview || '').trim().slice(0, 80),
        memoryUpdates,
        flagUpdates,
        nextSceneHint: String(o.nextSceneHint || '').trim().slice(0, 100),
        turnType: s.turnType,
    };
}

/** AI 关闭/失败时的兜底剧情（保证游戏可玩，永远 3 个选项）。 */
export function fallbackScene(s: StoryState): StoryScene {
    const tm = TURN_META[s.turnType];
    const present = s.activeCharacters.map(id => s.characters[id]).filter(Boolean) as StoryChar[];
    const who = present[0];
    const name = who?.name || '一位佳人';
    const narration = present.length
        ? `${s.location}，${s.time}色微茫。${name}立于近前，${who.attitude}，似有话要说，又咽了回去。这是一场${tm.label}的照面，气氛说不清的微妙。`
        : `${s.location}独坐，${s.time}风穿廊。无人相伴，思绪却没停下。`;
    const dialogues: StoryDialogue[] = who ? [{ speaker: who.name, charId: who.charId, text: pick(['…陛下今日，可还安好？', '臣妾候着陛下呢。', '陛下若得空，能否多留片刻？'], Math.random) }] : [];
    return {
        sceneTitle: `${tm.label}·${s.location}`,
        narration,
        dialogues,
        choices: fallbackChoices(s, 0),
        effectsPreview: '（离线模式·剧情从简）',
        memoryUpdates: [],
        flagUpdates: {},
        nextSceneHint: '',
        turnType: s.turnType,
    };
}

// ════════════════════════════════════════════════════════════════════════════
//  ②④⑤⑥⑦⑧ 落地一次选择：变量 / 记忆 / flag / 时间 / 路线 / 下一回合
// ════════════════════════════════════════════════════════════════════════════

function recomputeChar(c: StoryChar): void {
    c.stage = stageOf(c.affection).key;
    c.attitude = deriveAttitude(c);
}

/**
 * 玩家选择 choiceIndex 后落地：套用 effects、连带嫉妒、写记忆/flag、推进时辰、
 * 更新路线与结局进度、定下一回合节奏与登场角色。返回**新** state（currentScene 清空，等待下一轮请求）。
 */
export function applyChoice(s: StoryState, scene: StoryScene, choiceIndex: number, rng: () => number = Math.random): StoryState {
    const choice = scene.choices[choiceIndex] || scene.choices[0];
    if (!choice) return s;

    // 深拷贝角色
    const characters: Record<string, StoryChar> = {};
    for (const [id, c] of Object.entries(s.characters)) characters[id] = { ...c, memories: [...c.memories], flags: { ...c.flags } };

    // 1) 套用显式 effects（④⑤⑥）
    const gainedAff = new Set<string>();
    for (const e of choice.effects) {
        const c = characters[e.charId]; if (!c) continue;
        if (e.affection) { c.affection = clamp100(c.affection + e.affection); if (e.affection > 0) gainedAff.add(c.charId); }
        if (e.trust) c.trust = clamp100(c.trust + e.trust);
        if (e.jealousy) c.jealousy = clamp100(c.jealousy + e.jealousy);
        if (e.mood) c.mood = clamp100(c.mood + e.mood);
    }

    // 2) 嫉妒连带（规则 ⑤/⑥）：在场而被冷落者，按其好感生出醋意
    if (gainedAff.size > 0) {
        for (const id of s.activeCharacters) {
            const c = characters[id]; if (!c || gainedAff.has(id)) continue;
            const bump = c.affection >= 60 ? 6 : c.affection >= 40 ? 4 : 2;
            c.jealousy = clamp100(c.jealousy + bump);
            c.mood = clamp100(c.mood - Math.round(bump / 2));
        }
    }

    // 3) 记忆（⑦：长期 + 角色独立）
    let memories = [...s.memories];
    for (const mu of scene.memoryUpdates) {
        const mem: StoryMemory = { id: sid(), day: s.day, text: mu.text, weight: mu.weight ?? 1, kind: mu.kind ?? 'event', charId: mu.charId };
        memories.unshift(mem);
        if (mu.charId && characters[mu.charId]) characters[mu.charId].memories = consolidateMemories([{ ...mem }, ...characters[mu.charId].memories], CHAR_MEMORY_CAP);
    }
    memories = consolidateMemories(memories, GLOBAL_MEMORY_CAP);

    // 4) flag（⑧）
    const flags = { ...s.flags, ...scene.flagUpdates };

    // 5) 路线锁定（仅在「路线锁定回合」且玩家选了对主角正向的选项时落锁）
    let route = { ...s.route };
    if (s.turnType === 'route_lock' && !route.locked) {
        const target = s.activeCharacters[0] && characters[s.activeCharacters[0]] ? characters[s.activeCharacters[0]] : null;
        const commits = choice.effects.some(e => e.charId === target?.charId && (e.affection ?? 0) > 0);
        if (target && commits) {
            route = { locked: true, charId: target.charId, progress: 100 };
            target.flags.route = true;
            memories.unshift({ id: sid(), day: s.day, text: `君心独许${target.name}，后宫格局自此而定。`, weight: 5, kind: 'promise', charId: target.charId });
            for (const id of Object.keys(characters)) if (id !== target.charId) { characters[id].jealousy = clamp100(characters[id].jealousy + 8); characters[id].mood = clamp100(characters[id].mood - 6); }
        }
    }

    // 6) 关系突破回合：在场主角标记已突破（避免重复触发）
    if (s.turnType === 'breakthrough') {
        const t = s.activeCharacters[0] && characters[s.activeCharacters[0]] ? characters[s.activeCharacters[0]] : null;
        if (t) t.flags.broke = true;
    }

    // 7) 态度/阶段重算
    for (const c of Object.values(characters)) recomputeChar(c);

    // 8) 登场公平：在场者 streak 清零，未登场者 +1
    for (const c of Object.values(characters)) c.presentStreak = s.activeCharacters.includes(c.charId) ? 0 : c.presentStreak + 1;

    // 9) 历史（⑧延续）
    const history: StoryHistoryEntry[] = [
        { day: s.day, time: s.time, location: s.location, turnType: s.turnType, sceneTitle: scene.sceneTitle, choiceText: choice.text, tone: choice.tone, nextIntent: choice.nextIntent },
        ...s.history,
    ].slice(0, HISTORY_CAP);

    // 10) 推进时辰
    const { time, day } = advanceTime(s.time, s.day);

    // 组装中间态
    const mid: StoryState = {
        ...s, characters, memories, flags, route, history, time, day,
        currentScene: null,
        lastTurn: { choiceText: choice.text, tone: choice.tone, nextIntent: choice.nextIntent },
        turnCount: s.turnCount + 1,
    };

    // 11) 结局进度
    mid.endingProgress = computeEndingProgress(mid);

    // 12) 下一回合：类型 → 登场 → 地点
    const nextType = determineTurnType(mid, rng);
    mid.turnType = nextType;
    mid.activeCharacters = scheduleCast(mid, nextType, rng);
    mid.location = pickLocation(nextType, rng);

    return mid;
}

// ════════════════════════════════════════════════════════════════════════════
//  ⑫ 结局判定模块
// ════════════════════════════════════════════════════════════════════════════

export interface EndingDef {
    key: string;
    label: string;
    tone: 'true' | 'harem' | 'bad' | 'open';
    blurb: string;
    /** 满足即可触发（硬条件）。 */
    test: (s: StoryState) => boolean;
    /** 进度 0-100（给 UI 展示「离这个结局有多近」）。 */
    score: (s: StoryState) => number;
    priority: number; // 数字大者优先
}

const topChar = (s: StoryState): StoryChar | null => { const a = sortByAff(allChars(s)); return a[0] || null; };

export const ENDING_DEFS: EndingDef[] = [
    {
        key: 'jealousy_ruin', label: '红颜祸水', tone: 'bad', priority: 90,
        blurb: '善妒成灾，后宫倾覆。爱到极处反成刀，一段孽缘以玉石俱焚收场。',
        test: s => allChars(s).some(c => c.jealousy >= 96 && c.trust < 40) && s.day >= 5,
        score: s => { const m = Math.max(0, ...allChars(s).map(c => c.jealousy >= 96 ? 100 : c.jealousy)); return clamp100(m); },
    },
    {
        key: 'cold_lonely', label: '孤家寡人', tone: 'bad', priority: 80,
        blurb: '人心渐离，宫阙生寒。坐拥三千却无一人交心，终是孤家寡人。',
        test: s => s.day >= 8 && allChars(s).length > 0 && allChars(s).every(c => c.affection <= 32),
        score: s => { const chars = allChars(s); if (!chars.length) return 0; const avg = chars.reduce((a, c) => a + c.affection, 0) / chars.length; return clamp100((40 - avg) * 2.5); },
    },
    {
        key: 'true_love', label: '一生一世一双人', tone: 'true', priority: 70,
        blurb: '弱水三千只取一瓢。独许一人、患难与共，终成神仙眷侣。',
        test: s => { const t = s.route.locked && s.route.charId ? s.characters[s.route.charId] : null; return !!t && t.affection >= 88 && t.trust >= 80 && t.jealousy <= 35 && s.day >= 8; },
        score: s => { const t = s.route.locked && s.route.charId ? s.characters[s.route.charId] : topChar(s); if (!t) return 0; return clamp100((t.affection * 0.6 + t.trust * 0.4) * (s.route.locked ? 1 : 0.7)); },
    },
    {
        key: 'harem', label: '齐人之福', tone: 'harem', priority: 60,
        blurb: '雨露均沾，六宫粉黛皆得其所。一段众星拱月、各得圆满的后宫佳话。',
        test: s => { const hi = allChars(s).filter(c => c.affection >= 70); return hi.length >= 3 && allChars(s).every(c => c.jealousy <= 50) && s.day >= 8 && !s.route.locked; },
        score: s => { const chars = allChars(s); if (chars.length < 3) return 0; const hi = chars.filter(c => c.affection >= 70).length; const calm = chars.every(c => c.jealousy <= 50) ? 1 : 0.6; return clamp100((hi / chars.length) * 100 * calm); },
    },
    {
        key: 'open', label: '未完待续', tone: 'open', priority: 0,
        blurb: '故事未到尽头，宫墙之内，余韵悠长。',
        test: () => false, // 仅作兜底，不主动触发
        score: () => 0,
    },
];

/** 当前各结局进度（0-100），UI 展示用。 */
export function computeEndingProgress(s: StoryState): Record<string, number> {
    const out: Record<string, number> = {};
    for (const d of ENDING_DEFS) if (d.key !== 'open') out[d.key] = d.score(s);
    return out;
}

/**
 * 结局判定。hardOnly=true 时只看「硬触发条件」（用于 determineTurnType 决定是否强制 ending）；
 * 否则返回当前最该收束到的结局（玩家在「结局判定回合」或手动收尾时调用）。
 */
export function checkEndings(s: StoryState, hardOnly = false): EndingDef | null {
    const eligible = ENDING_DEFS.filter(d => d.key !== 'open' && d.test(s)).sort((a, b) => b.priority - a.priority);
    if (eligible.length) return eligible[0];
    if (hardOnly) return null;
    // 非硬条件：到了 ending 回合也得给个结局——按分数挑最高的，否则 open
    const ranked = ENDING_DEFS.filter(d => d.key !== 'open').map(d => ({ d, sc: d.score(s) })).sort((a, b) => b.sc - a.sc);
    if (ranked[0] && ranked[0].sc >= 50) return ranked[0].d;
    return ENDING_DEFS.find(d => d.key === 'open') || null;
}

// ── 结局叙述（AI 收尾 + 兜底） ───────────────────────────────────────────────
export interface StoryEnding { key: string; label: string; tone: EndingDef['tone']; title: string; epilogue: string; fates: { name: string; line: string }[]; }

export function buildStoryEndingPrompt(s: StoryState, def: EndingDef): { system: string; user: string } {
    const roster = sortByAff(allChars(s)).map(c => `- ${c.name}（${stageOf(c.affection).label}，好感${c.affection}/信任${c.trust}/嫉妒${c.jealousy}）`).join('\n');
    const keyMems = s.memories.slice(0, 6).map(m => m.text).join('；');
    const system = '你为一段古风后宫恋爱故事写「结局尾声」。文笔古雅含蓄、有余韵，扣住给定的结局基调与人物数据，不要新增冲突。';
    const user = `这段后宫历经 ${s.day} 日。结局基调：「${def.label}」——${def.blurb}\n`
        + `诸位现状：\n${roster}\n`
        + (keyMems ? `一路记得的事：${keyMems}\n` : '')
        + `\n请只输出一个 JSON（不要解释、不要代码块）：\n{"title":"结局标题(≤12字)","epilogue":"尾声正文(120~200字，第二人称称呼君主)","fates":[{"name":"角色名","line":"她的结局定语(≤24字)"}]}`;
    return { system, user };
}

export function parseStoryEnding(raw: string, def: EndingDef): StoryEnding {
    const o = extractJson(raw);
    const base: StoryEnding = { key: def.key, label: def.label, tone: def.tone, title: def.label, epilogue: def.blurb, fates: [] };
    if (o && typeof o === 'object') {
        base.title = String(o.title || def.label).trim().slice(0, 20) || def.label;
        base.epilogue = String(o.epilogue || o.text || def.blurb).trim().slice(0, 400) || def.blurb;
        base.fates = (Array.isArray(o.fates) ? o.fates : [])
            .map((f: any) => ({ name: String(f?.name || '').trim().slice(0, 16), line: String(f?.line || '').trim().slice(0, 40) }))
            .filter((f: any) => f.name && f.line).slice(0, 12);
    }
    return base;
}

export function fallbackStoryEnding(s: StoryState, def: EndingDef): StoryEnding {
    const fates = sortByAff(allChars(s)).map(c => ({
        name: c.name,
        line: `${stageOf(c.affection).label}，好感 ${c.affection}` + (c.jealousy >= 80 ? '，心生怨怼' : c.affection >= 80 ? '，情深不悔' : c.affection <= 30 ? '，渐行渐远' : ''),
    }));
    const top = topChar(s);
    const epilogue = def.key === 'true_love' && s.route.charId && s.characters[s.route.charId]
        ? `历 ${s.day} 日宫阙春秋，你独许${s.characters[s.route.charId].name}一人。从此弱水三千只取一瓢，朝朝暮暮，再不负卿。`
        : def.key === 'harem'
            ? `历 ${s.day} 日，六宫安和，粉黛各得其所。你坐拥盈盈春色，亦守得一宫人心，传为佳话。`
            : def.key === 'jealousy_ruin'
                ? `历 ${s.day} 日，醋海翻波，终成大祸。爱到极处反成刀，繁华一夜倾覆，徒留满地狼藉。`
                : def.key === 'cold_lonely'
                    ? `历 ${s.day} 日，人心渐离。坐拥三千粉黛，却无一人愿与你交心，到头来不过孤家寡人。`
                    : `历 ${s.day} 日，宫墙内外，故事仍在续写。${top ? `${top.name}与你的缘分，尚未到尽头。` : ''}`;
    return { key: def.key, label: def.label, tone: def.tone, title: def.label, epilogue, fates };
}

// ════════════════════════════════════════════════════════════════════════════
//  多周目（New Game+）
// ════════════════════════════════════════════════════════════════════════════

/**
 * 从一盘已结束的游戏派生「下一周目」的继承包：保留少量高权重长期记忆作为「前尘旧梦」，
 * 记录上周目锁定的路线，供下一盘 init 时注入（角色仍从新好感起步，只是带一点「似曾相识」）。
 */
export function buildCarry(s: StoryState): { fromPlaythrough: number; notes: string[] } {
    const notes: string[] = [];
    const keyMems = consolidateMemories(s.memories, 5).filter(m => m.weight >= 3).slice(0, 3);
    for (const m of keyMems) notes.push(m.text);
    if (s.route.charId && s.characters[s.route.charId]) notes.push(`上一世，你曾独宠${s.characters[s.route.charId].name}。`);
    return { fromPlaythrough: s.playthrough, notes };
}

/** 用继承包开下一周目（角色种子由 app 层重新提供，可与上盘相同或不同）。 */
export function startNewGamePlus(prev: StoryState, seeds: StorySeed[], player?: { name: string; title?: string; persona?: string }): StoryState {
    return initStory(seeds, player || prev.player, buildCarry(prev));
}

// ════════════════════════════════════════════════════════════════════════════
//  存档读档辅助（多档由 app 层管理；这里给「打包/校验」）
// ════════════════════════════════════════════════════════════════════════════

export interface StorySaveMeta { day: number; time: TimeSlot; turn: number; playthrough: number; topName: string; routeName: string | null; ts: number; }

export function saveMetaOf(s: StoryState): StorySaveMeta {
    const top = topChar(s);
    return {
        day: s.day, time: s.time, turn: s.turnCount, playthrough: s.playthrough,
        topName: top?.name || '—',
        routeName: s.route.charId && s.characters[s.route.charId] ? s.characters[s.route.charId].name : null,
        ts: Date.now(),
    };
}

/** 宽松校验 + 迁移：确保旧档读回来字段齐全（缺省补默认），坏档返回 null。 */
export function reviveStory(raw: any): StoryState | null {
    if (!raw || typeof raw !== 'object' || !raw.characters || typeof raw.characters !== 'object') return null;
    try {
        const characters: Record<string, StoryChar> = {};
        for (const [id, c0] of Object.entries<any>(raw.characters)) {
            characters[id] = {
                charId: id, name: String(c0.name || id), avatar: String(c0.avatar || ''), persona: c0.persona,
                affection: clamp100(num(c0.affection, 30)), trust: clamp100(num(c0.trust, 35)),
                jealousy: clamp100(num(c0.jealousy, 10)), mood: clamp100(num(c0.mood, 60)),
                attitude: String(c0.attitude || ''), stage: String(c0.stage || ''),
                memories: Array.isArray(c0.memories) ? c0.memories : [],
                presentStreak: num(c0.presentStreak, 0),
                flags: c0.flags && typeof c0.flags === 'object' ? c0.flags : {},
            };
            recomputeChar(characters[id]);
        }
        const s: StoryState = {
            version: STORY_VERSION,
            playthrough: num(raw.playthrough, 1),
            player: { name: String(raw.player?.name || '君'), title: String(raw.player?.title || '君上'), persona: raw.player?.persona },
            day: num(raw.day, 1), time: (TIME_SLOTS.includes(raw.time) ? raw.time : '晨'),
            location: String(raw.location || '椒房殿'),
            turnType: (TURN_META[raw.turnType as TurnType] ? raw.turnType : 'daily'),
            turnCount: num(raw.turnCount, 0),
            currentScene: raw.currentScene && typeof raw.currentScene === 'object' ? raw.currentScene : null,
            activeCharacters: Array.isArray(raw.activeCharacters) ? raw.activeCharacters.filter((id: any) => characters[id]) : Object.keys(characters).slice(0, 1),
            characters,
            relationships: Array.isArray(raw.relationships) ? raw.relationships : [],
            memories: Array.isArray(raw.memories) ? raw.memories : [],
            flags: raw.flags && typeof raw.flags === 'object' ? raw.flags : {},
            history: Array.isArray(raw.history) ? raw.history : [],
            route: raw.route && typeof raw.route === 'object' ? { locked: !!raw.route.locked, charId: raw.route.charId || null, progress: num(raw.route.progress, 0) } : { locked: false, charId: null, progress: 0 },
            endingProgress: raw.endingProgress && typeof raw.endingProgress === 'object' ? raw.endingProgress : {},
            lastTurn: raw.lastTurn && typeof raw.lastTurn === 'object' ? raw.lastTurn : null,
            carry: raw.carry && typeof raw.carry === 'object' ? raw.carry : null,
            createdAt: num(raw.createdAt, Date.now()),
        };
        if (!s.activeCharacters.length) s.activeCharacters = Object.keys(characters).slice(0, 1);
        s.endingProgress = computeEndingProgress(s);
        return s;
    } catch { return null; }
}
