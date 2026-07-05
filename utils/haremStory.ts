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
 *   ⑨ AI 请求模块            → buildScenePrompt（把 15 条规则 + 输出 schema 烧进 prompt）
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

export const STORY_VERSION = 3;

const clampN = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Math.round(n)));
/** 变量统一钳在 0~100。 */
const clamp100 = (n: number): number => clampN(n, 0, 100);
const num = (v: any, def = 0): number => (typeof v === 'number' && isFinite(v) ? v : (typeof v === 'string' && v.trim() !== '' && isFinite(+v) ? +v : def));

let _seq = 0;
const sid = (): string => `${Date.now().toString(36)}${(_seq++).toString(36)}`;
const pick = <T,>(arr: T[], rng: () => number = Math.random): T => arr[Math.floor(rng() * arr.length)];

// ════════════════════════════════════════════════════════════════════════════
//  长线主线 / 宫苑探索 / 轻养成资源
// ════════════════════════════════════════════════════════════════════════════

export type StoryResourceKey = 'power' | 'reputation' | 'silver' | 'energy' | 'rumor';
export interface StoryResources {
    power: number;       // 宫权
    reputation: number;  // 声望
    silver: number;      // 库银
    energy: number;      // 心力
    rumor: number;       // 风闻
}
export const STORY_RESOURCE_LABELS: Record<StoryResourceKey, string> = {
    power: '宫权',
    reputation: '声望',
    silver: '库银',
    energy: '心力',
    rumor: '风闻',
};
const RESOURCE_KEYS: StoryResourceKey[] = ['power', 'reputation', 'silver', 'energy', 'rumor'];
export const DEFAULT_RESOURCES: StoryResources = { power: 34, reputation: 32, silver: 46, energy: 76, rumor: 8 };

export type PalaceLocationId =
    | 'jiaofang' | 'garden' | 'shanggong' | 'library'
    | 'yeting' | 'taiyi' | 'treasury' | 'ancestral' | 'court';
export type PalaceActionType = 'explore' | 'visit' | 'govern' | 'gossip' | 'gift' | 'rest' | 'chapter';

export interface PalaceLocation {
    id: PalaceLocationId;
    name: string;
    blurb: string;
    unlockDay: number;
    unlockChapter: number;
    actions: PalaceActionType[];
}
export interface StoryMapIntent {
    locationId: PalaceLocationId;
    action: PalaceActionType;
    label: string;
    targetCharId?: string;
    note?: string;
}
export interface StoryPalaceMapState {
    unlocked: PalaceLocationId[];
    visited: Record<string, number>;
    lastLocationId?: PalaceLocationId;
}

export interface StoryChapterState {
    id: string;
    index: number;
    title: string;
    subtitle: string;
    minDay: number;
    goal: number;
    progress: number;
    completed: boolean;
    finaleReady: boolean;
}
export interface StoryObjective {
    id: string;
    kind: 'main' | 'side';
    title: string;
    description: string;
    target: number;
    progress: number;
    done: boolean;
    chapterId?: string;
    reward?: Partial<StoryResources>;
}
export interface StoryInventoryItem {
    id: string;
    name: string;
    kind: 'clue' | 'gift' | 'edict' | 'token';
    text: string;
    day: number;
    charId?: string;
    source?: string;
}
export interface StoryAchievement {
    id: string;
    title: string;
    description: string;
    unlockedAt: number;
}
export type StoryActionEntryPoint = 'scene' | 'map' | 'character' | 'inventory' | 'objective' | 'favor';
export interface StoryGeneratedHook {
    id: string;
    kind: 'side' | 'intrigue' | 'location_event' | 'character_event';
    title: string;
    summary: string;
    source: StoryActionEntryPoint | string;
    day: number;
    expiresDay: number;
    locationId?: PalaceLocationId;
    charId?: string;
    objectiveId?: string;
}
export interface StoryRumor {
    id: string;
    text: string;
    source: StoryActionEntryPoint | string;
    day: number;
    expiresDay: number;
    heat: number;
    truth?: string;
    charId?: string;
}
export interface StoryNpcStub {
    id: string;
    name: string;
    role: string;
    summary: string;
    disposition: string;
    source: StoryActionEntryPoint | string;
    day: number;
    expiresDay: number;
    locationId?: PalaceLocationId;
}
export interface StoryActionJudgement {
    id: string;
    entryPoint: StoryActionEntryPoint;
    actionText: string;
    title: string;
    verdict: string;
    risk: StoryChoice['risk'];
    cost: Partial<StoryResources>;
    reward: Partial<StoryResources>;
    effects: StoryChoice['effects'];
    involvedCharIds: string[];
    mapIntent?: StoryMapIntent;
    objectiveUpdates: StoryScene['objectiveUpdates'];
    inventoryUpdates: StoryScene['inventoryUpdates'];
    achievementUpdates: StoryScene['achievementUpdates'];
    generatedHooks: StoryGeneratedHook[];
    rumors: StoryRumor[];
    npcStubs: StoryNpcStub[];
    nextIntent: string;
    confidence: number;
}
export type StoryFavorActionType = 'summon' | 'reward' | 'protect' | 'cool' | 'mediate' | 'balance';
export type StoryFavorLedgerType = StoryFavorActionType | 'draft';
export interface StoryFavorActionInput {
    type: StoryFavorActionType;
    targetCharId?: string;
    secondaryCharId?: string;
    note?: string;
}
export interface StoryFavorRelationshipDelta {
    a: string;
    b: string;
    bond: number;
    label: string;
}
export interface StoryFavorPreview {
    ok: boolean;
    type: StoryFavorActionType;
    title: string;
    actionText: string;
    risk: StoryChoice['risk'];
    resourceDelta: Partial<StoryResources>;
    effects: StoryChoice['effects'];
    relationshipDelta: StoryFavorRelationshipDelta[];
    targetCharIds: string[];
    message: string;
    nextIntent: string;
    blockers: string[];
}
export interface StoryFavorLedgerEntry {
    id: string;
    type: StoryFavorLedgerType;
    title: string;
    actionText: string;
    day: number;
    time: TimeSlot;
    targetCharIds: string[];
    resourceDelta: Partial<StoryResources>;
    effects: StoryChoice['effects'];
    relationshipDelta: StoryFavorRelationshipDelta[];
    risk: StoryChoice['risk'];
    note?: string;
}
export interface StoryFavorCourtSummary {
    topCharId: string | null;
    topName: string;
    favorGap: number;
    estrangedCount: number;
    highJealousCount: number;
    neglectedCharIds: string[];
    warning: string;
}

export const PALACE_ACTION_LABELS: Record<PalaceActionType, string> = {
    explore: '探访',
    visit: '会面',
    govern: '理宫务',
    gossip: '听风闻',
    gift: '赐物',
    rest: '休整',
    chapter: '推进主线',
};
export const STORY_FAVOR_ACTION_LABELS: Record<StoryFavorActionType, string> = {
    summon: '召见',
    reward: '赐赏',
    protect: '护持',
    cool: '冷处理',
    mediate: '调停',
    balance: '普赏安宫',
};
export const STORY_FAVOR_ACTION_HINTS: Record<StoryFavorActionType, string> = {
    summon: '点名一人入殿，拉近情分，也容易留下偏宠风声。',
    reward: '以库银赏赐一人，抬心情与好感，旁人可能生出比较。',
    protect: '用宫权为一人挡风雨，稳信任，但会损声望。',
    cool: '暂时冷下热局，压低嫉妒与风闻，也会伤及情分。',
    mediate: '让两人坐下说开，缓和敌意，耗费心力。',
    balance: '普赏诸位，安抚整体格局，代价更重。',
};

export const PALACE_LOCATIONS: PalaceLocation[] = [
    { id: 'jiaofang', name: '椒房殿', blurb: '主殿灯火长明，最适合召见、休整与收束心绪。', unlockDay: 1, unlockChapter: 1, actions: ['visit', 'rest', 'chapter'] },
    { id: 'garden', name: '御花园', blurb: '花木掩映，偶遇、试探与私语都容易在此发生。', unlockDay: 1, unlockChapter: 1, actions: ['explore', 'visit', 'gossip'] },
    { id: 'shanggong', name: '尚宫局', blurb: '宫务、人手、账册都归这里，能稳住后宫秩序。', unlockDay: 3, unlockChapter: 2, actions: ['govern', 'gossip', 'chapter'] },
    { id: 'library', name: '藏书阁', blurb: '旧档、密札与人物来历藏在书页夹层里。', unlockDay: 6, unlockChapter: 2, actions: ['explore', 'gossip', 'visit'] },
    { id: 'yeting', name: '掖庭回廊', blurb: '宫人来往之处，风声最快，也最容易惹祸。', unlockDay: 10, unlockChapter: 3, actions: ['gossip', 'explore'] },
    { id: 'taiyi', name: '太医署', blurb: '病榻、药方与暗伤牵动人心，危机常从这里浮出。', unlockDay: 18, unlockChapter: 4, actions: ['explore', 'govern', 'chapter'] },
    { id: 'treasury', name: '内府宝库', blurb: '赏赐与用度的源头，能赐物，也会暴露偏宠。', unlockDay: 24, unlockChapter: 5, actions: ['gift', 'govern'] },
    { id: 'ancestral', name: '宗祠', blurb: '誓言、名分与终局抉择都在这里变得沉重。', unlockDay: 42, unlockChapter: 7, actions: ['chapter', 'visit'] },
    { id: 'court', name: '前朝丹陛', blurb: '后宫风波终会牵到前朝，权柄在此定局。', unlockDay: 55, unlockChapter: 8, actions: ['govern', 'chapter'] },
];

export const CHAPTER_DEFS: Omit<StoryChapterState, 'progress' | 'completed' | 'finaleReady'>[] = [
    { id: 'arrival', index: 1, title: '初入椒房', subtitle: '择人入宫，立下第一卷人心账。', minDay: 1, goal: 24 },
    { id: 'settle', index: 2, title: '宫苑初定', subtitle: '理清宫务，打开深宫各处门径。', minDay: 8, goal: 32 },
    { id: 'undercurrent', index: 3, title: '暗香浮动', subtitle: '亲疏渐分，暗流也随花影浮起。', minDay: 16, goal: 38 },
    { id: 'rumor', index: 4, title: '风闻四起', subtitle: '流言、病榻与旧事开始互相牵扯。', minDay: 24, goal: 42 },
    { id: 'balance', index: 5, title: '权衡恩宠', subtitle: '赏赐、偏宠与宫权都要付出代价。', minDay: 32, goal: 46 },
    { id: 'storm', index: 6, title: '宫阙风雨', subtitle: '一场危机检验谁与你同舟。', minDay: 42, goal: 52 },
    { id: 'vow', index: 7, title: '定情与鼎', subtitle: '情意、名分与众人去留渐近终局。', minDay: 52, goal: 56 },
    { id: 'finale', index: 8, title: '终局定鼎', subtitle: '六十日后，椒房旧梦可以收束，也可以继续。', minDay: 60, goal: 60 },
];

const chapterDefAt = (index: number) => CHAPTER_DEFS[Math.max(0, Math.min(CHAPTER_DEFS.length - 1, index - 1))] || CHAPTER_DEFS[0];
const makeChapter = (index = 1, progress = 0): StoryChapterState => {
    const def = chapterDefAt(index);
    return { ...def, progress: clamp100(progress), completed: false, finaleReady: def.index >= CHAPTER_DEFS.length && progress >= def.goal };
};
const mainObjectiveId = (chapterId: string) => `main_${chapterId}`;
const makeMainObjective = (chapter: StoryChapterState): StoryObjective => ({
    id: mainObjectiveId(chapter.id),
    kind: 'main',
    title: chapter.title,
    description: chapter.subtitle,
    target: chapter.goal,
    progress: chapter.progress,
    done: chapter.progress >= chapter.goal,
    chapterId: chapter.id,
    reward: { power: 4, reputation: 4, energy: 8 },
});

function defaultObjectives(chapter: StoryChapterState): StoryObjective[] {
    return [
        makeMainObjective(chapter),
        { id: 'side_balance_hearts', kind: 'side', title: '雨露均沾', description: '让至少三位角色维持亲厚以上关系，避免人心偏枯。', target: 3, progress: 0, done: false, reward: { reputation: 5, rumor: -4 } },
        { id: 'side_collect_clues', kind: 'side', title: '暗线成册', description: '收集 5 条线索或信物，拼出椒房暗流。', target: 5, progress: 0, done: false, reward: { power: 4, rumor: -3 } },
    ];
}

function defaultMapState(day = 1, chapterIndex = 1): StoryPalaceMapState {
    const unlocked = PALACE_LOCATIONS
        .filter(l => l.unlockDay <= day && l.unlockChapter <= chapterIndex)
        .map(l => l.id);
    return { unlocked: unlocked.length ? unlocked : ['jiaofang', 'garden'], visited: {}, lastLocationId: 'jiaofang' };
}

/**
 * 性别完全开放：玩家与每位可攻略对象都可独立设定性别，支持女帝男妃 / 同性 / 混合后宫等任意组合。
 * 'unknown' = 未指定，由 AI 依人设自行判断（绝不默认为女性）。
 */
export type Gender = 'male' | 'female' | 'unknown';
export const GENDER_WORD: Record<Gender, string> = { male: '男', female: '女', unknown: '未定' };
/** 一组「君主身份」预设，方便开局一键选（女帝男妃也在内）。称谓可再自定义。 */
export const RULER_PRESETS: { key: string; label: string; gender: Gender; title: string; hint: string }[] = [
    { key: 'emperor', label: '帝王', gender: 'male', title: '陛下', hint: '男帝 · 后宫佳丽' },
    { key: 'empress', label: '女帝', gender: 'female', title: '陛下', hint: '女帝 · 三千面首' },
    { key: 'lord', label: '主君', gender: 'male', title: '主君', hint: '男主 · 不拘性别' },
    { key: 'lady', label: '女君', gender: 'female', title: '殿下', hint: '女主 · 不拘性别' },
    { key: 'neutral', label: '不限', gender: 'unknown', title: '君上', hint: '中性 · 全交给剧情' },
];

// ── 玩家可自定义的「叙事设定」（增加自由度：风格 / 尺度 / 节奏 / 开场设定）──────
export interface StorySettings { style: string; heat: number; pace: string; premise?: string; }
export const STORY_STYLES: { key: string; label: string; hint: string }[] = [
    { key: 'classic', label: '含蓄古风', hint: '含蓄克制、以景写情、留白悠长' },
    { key: 'passion', label: '直白热烈', hint: '情感外放、张力十足、爱恨分明' },
    { key: 'sweet', label: '轻松甜宠', hint: '轻快暖甜、日常调情、冲突点到为止' },
    { key: 'dark', label: '暗黑虐心', hint: '权谋猜忌、爱恨交缠、虐感与危险并存' },
    { key: 'wuxia', label: '江湖侠气', hint: '快意恩仇、儿女情长、剑胆琴心' },
];
export const HEAT_LABELS = ['清淡', '微醺', '旖旎', '浓烈']; // 尺度 0..3
export const PACE_OPTIONS: { key: string; label: string; hint: string }[] = [
    { key: 'slow', label: '慢热', hint: '细水长流，情感缓缓升温' },
    { key: 'mid', label: '适中', hint: '张弛有度' },
    { key: 'fast', label: '迅疾', hint: '剧情推进快、爱恨来得猛' },
];
export const DEFAULT_SETTINGS: StorySettings = { style: 'classic', heat: 1, pace: 'mid' };
const styleHint = (k: string): string => STORY_STYLES.find(s => s.key === k)?.hint || STORY_STYLES[0].hint;
const styleLabel = (k: string): string => STORY_STYLES.find(s => s.key === k)?.label || STORY_STYLES[0].label;
const paceHint = (k: string): string => PACE_OPTIONS.find(p => p.key === k)?.hint || PACE_OPTIONS[1].hint;

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
    gender: Gender;         // 性别（开放设定，男妃/女妃/未定皆可）
    persona?: string;       // 人设摘要（喂 AI，规则 ②「不能忽略角色设定」）
    affection: number;      // 好感度 0-100
    trust: number;          // 信任值 0-100
    jealousy: number;       // 嫉妒值 0-100
    mood: number;           // 心情 0-100
    attitude: string;       // 态度标签（deriveAttitude 推导，AI 可在叙述里呼应）
    stage: string;          // 关系阶段 key（stageOf 推导）
    memories: StoryMemory[]; // 角色独立记忆（规则：加入角色独立记忆版）
    presentStreak: number;  // 连续未登场回合数（调度公平，规则 ⑤「不能都围着玩家转」）
    estranged?: boolean;    // 离心：嫉妒爆表 + 久遭冷落 → 心灰意冷，淡出后宫（玩法张力）
    secret?: string;        // 隐藏心事（信任够高时由 AI 揭开，揭开后置空）
    flags: Record<string, boolean>; // 角色级 flag（如 confessed / promised / secretRevealed）
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

export interface StoryDialogue { speaker: string; charId?: string; text: string; emotion?: string; inner?: string; }

/** ⑩ AI 单回合输出（稳定 JSON）。 */
export interface StoryScene {
    sceneTitle: string;
    narration: string;
    dialogues: StoryDialogue[];
    choices: StoryChoice[];          // 恒为 3 个
    effectsPreview: string;          // 给玩家的可读提示（不含精确数值）
    memoryUpdates: { charId?: string; text: string; kind?: MemoryKind; weight?: number }[];
    flagUpdates: Record<string, string | number | boolean>;
    resourceDelta?: Partial<StoryResources>;
    objectiveUpdates?: { id?: string; progress?: number; done?: boolean }[];
    inventoryUpdates?: { id?: string; name: string; kind?: StoryInventoryItem['kind']; text: string; charId?: string; source?: string }[];
    achievementUpdates?: ({ id: string; title?: string; description?: string } | string)[];
    nextSceneHint: string;
    mood?: string;                   // 本场氛围词（驱动 UI 氛围条 / 背景微染）
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
    player: { name: string; title: string; gender: Gender; persona?: string };
    settings: StorySettings;        // 玩家自定义叙事设定（风格/尺度/节奏/开场设定）
    day: number;
    time: TimeSlot;
    location: string;
    turnType: TurnType;             // 「当前/即将呈现」这一回合的节奏
    turnCount: number;
    currentScene: StoryScene | null;
    activeCharacters: string[];     // 当前在场角色 charId
    characters: Record<string, StoryChar>;
    relationships: { a: string; b: string; bond: number }[]; // 角色之间（负=不睦，正=交好）
    chapter: StoryChapterState;      // 长线主线章节
    objectives: StoryObjective[];    // 主线 / 支线目标
    resources: StoryResources;       // 宫权 / 声望 / 库银 / 心力 / 风闻
    map: StoryPalaceMapState;        // 宫苑地图解锁与访问记录
    inventory: StoryInventoryItem[]; // 线索 / 信物 / 诏令 / 赏赐
    achievements: StoryAchievement[]; // 成就册 / 结局收藏
    mapIntent: StoryMapIntent | null; // 当前探索意图（喂 AI，一次性）
    generatedHooks: StoryGeneratedHook[]; // AI 半自动生成的支线/事件钩子
    rumors: StoryRumor[];          // 风闻池
    npcStubs: StoryNpcStub[];      // 局内临时 NPC 名片
    pendingJudgement: StoryActionJudgement | null; // UI 判词预览，确认后落地
    favorLedger: StoryFavorLedgerEntry[]; // 恩宠账：召见/赏罚/调停等宫廷经营记录
    memories: StoryMemory[];        // 长期/全局记忆（新在前）
    flags: Record<string, string | number | boolean>;
    history: StoryHistoryEntry[];   // 近期回合（滚动）
    route: { locked: boolean; charId: string | null; progress: number };
    endingProgress: Record<string, number>;
    lastTurn: { choiceText: string; tone: string; nextIntent: string; custom?: boolean } | null;
    focusHint: string | null;       // 玩家主动「择幸」指定的下一场焦点角色（一次性，用后即清）
    carry: { fromPlaythrough: number; notes: string[] } | null; // 多周目继承
    createdAt: number;
}

export interface StorySeed { charId: string; name: string; avatar: string; affection?: number; persona?: string; gender?: Gender; }

const HISTORY_CAP = 18;

function makeChar(s: StorySeed, base: { affection: number; trust: number; jealousy: number; mood: number }): StoryChar {
    const c: StoryChar = {
        charId: s.charId, name: s.name, avatar: s.avatar, gender: s.gender || 'unknown', persona: s.persona,
        affection: clamp100(typeof s.affection === 'number' ? s.affection : base.affection),
        trust: base.trust, jealousy: base.jealousy, mood: base.mood,
        attitude: '', stage: '', memories: [], presentStreak: 0, estranged: false, flags: {},
    };
    c.stage = stageOf(c.affection).key;
    c.attitude = deriveAttitude(c);
    return c;
}

/** 开一盘新文游：好感从真实 affection 起步（缺省 30），信任 35 / 嫉妒 10 / 心情 60。 */
export function initStory(
    seeds: StorySeed[],
    player: { name: string; title?: string; gender?: Gender; persona?: string },
    carry: { fromPlaythrough: number; notes: string[] } | null = null,
    settings?: Partial<StorySettings>,
): StoryState {
    const characters: Record<string, StoryChar> = {};
    seeds.forEach(s => { characters[s.charId] = makeChar(s, { affection: 30, trust: 35, jealousy: 10, mood: 60 }); });
    const ids = Object.keys(characters);
    // 角色之间初始化为「点头之交」(bond 0)，随同场/嫉妒演化成盟友或宿敌
    const relationships: StoryState['relationships'] = [];
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) relationships.push({ a: ids[i], b: ids[j], bond: 0 });
    const chapter = makeChapter(1);
    const state: StoryState = {
        version: STORY_VERSION,
        playthrough: carry ? carry.fromPlaythrough + 1 : 1,
        player: { name: player.name || '君', title: player.title || '君上', gender: player.gender || 'unknown', persona: player.persona },
        settings: { ...DEFAULT_SETTINGS, ...(settings || {}) },
        day: 1, time: '晨', location: '椒房殿',
        turnType: 'daily', turnCount: 0,
        currentScene: null,
        activeCharacters: ids.slice(0, 1),
        characters,
        relationships,
        chapter,
        objectives: defaultObjectives(chapter),
        resources: { ...DEFAULT_RESOURCES },
        map: defaultMapState(1, chapter.index),
        inventory: [],
        achievements: [],
        mapIntent: null,
        generatedHooks: [],
        rumors: [],
        npcStubs: [],
        pendingJudgement: null,
        favorLedger: [],
        memories: [],
        flags: {},
        history: [],
        route: { locked: false, charId: null, progress: 0 },
        endingProgress: {},
        lastTurn: null,
        focusHint: null,
        carry,
        createdAt: Date.now(),
    };
    state.endingProgress = computeEndingProgress(state);
    return state;
}

// ── 角色羁绊：盟友 / 宿敌（让后宫有自己的暗流，呼应规则 ⑤）──────────────────
export const bondKey = (a: string, b: string): string => [a, b].sort().join('|');
const bondMap = (rels: StoryState['relationships']): Map<string, number> => new Map(rels.map(r => [bondKey(r.a, r.b), r.bond]));

/** 依本回合同场与嫉妒格局，微调在场角色之间的羁绊（同场且都平和→更亲；都善妒→结怨）。 */
export function updateRelationships(rels: StoryState['relationships'], chars: Record<string, StoryChar>, present: string[]): StoryState['relationships'] {
    if (present.length < 2) return rels;
    const m = bondMap(rels);
    for (let i = 0; i < present.length; i++) for (let j = i + 1; j < present.length; j++) {
        const ca = chars[present[i]], cb = chars[present[j]]; if (!ca || !cb) continue;
        const k = bondKey(present[i], present[j]);
        let d = 0;
        if (ca.jealousy >= 55 && cb.jealousy >= 55) d -= 3;          // 同处一室、各自善妒 → 结怨
        else if (ca.mood >= 60 && cb.mood >= 60) d += 2;             // 心情都好 → 渐生情谊
        if (ca.estranged || cb.estranged) d -= 1;
        m.set(k, clampN((m.get(k) || 0) + d, -100, 100));
    }
    return rels.map(r => ({ ...r, bond: m.get(bondKey(r.a, r.b)) ?? r.bond }));
}

/** 取一对角色的羁绊标签（给 UI / prompt）。 */
export const bondLabel = (bond: number): string => bond >= 45 ? '情同姐妹/知己' : bond >= 18 ? '交好' : bond <= -45 ? '势同水火' : bond <= -18 ? '暗中较劲' : '点头之交';

/** 后宫角色之间的显著关系摘要（喂 prompt / UI；只列非中立的）。 */
export function relationshipSummary(s: StoryState): string[] {
    return s.relationships
        .filter(r => Math.abs(r.bond) >= 18 && s.characters[r.a] && s.characters[r.b])
        .map(r => `${s.characters[r.a].name} 与 ${s.characters[r.b].name}：${bondLabel(r.bond)}`);
}

const FAVOR_LEDGER_CAP = 60;
const FAVOR_ACTIONS = new Set<StoryFavorActionType>(['summon', 'reward', 'protect', 'cool', 'mediate', 'balance']);
const FAVOR_LEDGER_TYPES = new Set<StoryFavorLedgerType>(['summon', 'reward', 'protect', 'cool', 'mediate', 'balance', 'draft']);

function addEffect(effects: StoryChoice['effects'], charId: string | undefined, delta: Omit<StoryChoice['effects'][number], 'charId'>): void {
    if (!charId) return;
    const existing = effects.find(e => e.charId === charId);
    const target = existing || { charId };
    for (const key of ['affection', 'trust', 'jealousy', 'mood'] as const) {
        const value = delta[key];
        if (value) target[key] = (target[key] || 0) + value;
    }
    if (!existing) effects.push(target);
}

const favorTargets = (s: StoryState, ids: string[]): string => {
    const names = ids.map(id => s.characters[id]?.name).filter(Boolean);
    return names.length ? names.join('、') : '诸位';
};

function recentSummonCount(s: StoryState, charId: string): number {
    return (s.favorLedger || []).filter(e => e.type === 'summon' && e.targetCharIds.includes(charId) && s.day - e.day <= 2).length;
}

function resourceBlockers(s: StoryState, delta: Partial<StoryResources>): string[] {
    const current = normalizeResources(s.resources);
    const blockers: string[] = [];
    for (const key of RESOURCE_KEYS) {
        const value = delta[key] || 0;
        if (value < 0 && current[key] + value < 0) blockers.push(`${STORY_RESOURCE_LABELS[key]}不足`);
    }
    return blockers;
}

function applyFavorRelationshipDeltas(rels: StoryState['relationships'], deltas: StoryFavorRelationshipDelta[]): StoryState['relationships'] {
    if (!deltas.length) return rels;
    const byKey = new Map<string, StoryState['relationships'][number]>();
    for (const rel of rels) byKey.set(bondKey(rel.a, rel.b), { ...rel });
    for (const delta of deltas) {
        const k = bondKey(delta.a, delta.b);
        const old = byKey.get(k) || { a: delta.a, b: delta.b, bond: 0 };
        byKey.set(k, { ...old, bond: clampN(old.bond + delta.bond, -100, 100) });
    }
    return [...byKey.values()];
}

function makeFavorLedgerEntry(
    s: StoryState,
    preview: Pick<StoryFavorPreview, 'title' | 'actionText' | 'risk' | 'resourceDelta' | 'effects' | 'relationshipDelta' | 'targetCharIds'>,
    type: StoryFavorLedgerType,
    note?: string,
): StoryFavorLedgerEntry {
    return {
        id: `favor_${Date.now().toString(36)}_${sid()}`,
        type,
        title: preview.title,
        actionText: preview.actionText,
        day: s.day,
        time: s.time,
        targetCharIds: preview.targetCharIds.filter(id => !!s.characters[id]).slice(0, 6),
        resourceDelta: sanitizeResourceDelta(preview.resourceDelta),
        effects: preview.effects.slice(0, 10),
        relationshipDelta: preview.relationshipDelta.slice(0, 4),
        risk: preview.risk,
        note: note ? note.slice(0, 120) : undefined,
    };
}

function addFavorLedger(s: StoryState, entry: StoryFavorLedgerEntry): StoryFavorLedgerEntry[] {
    return [entry, ...(s.favorLedger || [])].slice(0, FAVOR_LEDGER_CAP);
}

function sanitizeFavorRelationshipDelta(raw: any, s: StoryState): StoryFavorRelationshipDelta | null {
    if (!raw || typeof raw !== 'object') return null;
    const a = String(raw.a || '');
    const b = String(raw.b || '');
    if (!a || !b || a === b || !s.characters[a] || !s.characters[b]) return null;
    return {
        a,
        b,
        bond: clampN(num(raw.bond, 0), -25, 25),
        label: String(raw.label || '羁绊微调').slice(0, 24),
    };
}

function sanitizeFavorLedger(raw: any, s: StoryState): StoryFavorLedgerEntry[] {
    if (!Array.isArray(raw)) return [];
    return raw.slice(0, FAVOR_LEDGER_CAP).map((e: any) => {
        const type: StoryFavorLedgerType = FAVOR_LEDGER_TYPES.has(e?.type) ? e.type : 'draft';
        const title = String(e?.title || (type === 'draft' ? '自拟谕旨' : STORY_FAVOR_ACTION_LABELS[type])).slice(0, 24);
        const actionText = String(e?.actionText || title).slice(0, 120);
        return {
            id: String(e?.id || `favor_${sid()}`),
            type,
            title,
            actionText,
            day: clampN(num(e?.day, s.day), 1, 9999),
            time: TIME_SLOTS.includes(e?.time) ? e.time : s.time,
            targetCharIds: Array.isArray(e?.targetCharIds) ? e.targetCharIds.filter((id: any) => s.characters[id]).map(String).slice(0, 6) : [],
            resourceDelta: sanitizeResourceDelta(e?.resourceDelta),
            effects: sanitizeEffects(e?.effects, s).slice(0, 10),
            relationshipDelta: Array.isArray(e?.relationshipDelta) ? e.relationshipDelta.map((r: any) => sanitizeFavorRelationshipDelta(r, s)).filter(Boolean).slice(0, 4) : [],
            risk: asRisk(e?.risk),
            note: e?.note ? String(e.note).slice(0, 120) : undefined,
        } as StoryFavorLedgerEntry;
    });
}

export function favorCourtSummary(s: StoryState): StoryFavorCourtSummary {
    const chars = sortByAff(allChars(s));
    const top = chars[0] || null;
    const second = chars[1] || null;
    const estranged = chars.filter(c => c.estranged);
    const highJealous = chars.filter(c => c.jealousy >= 70);
    const neglected = chars.filter(c => c.presentStreak >= 3 && !c.estranged).map(c => c.charId);
    const favorGap = top && second ? Math.max(0, top.affection - second.affection) : 0;
    let warning = '此刻宫中尚能维持体面。';
    if (estranged.length) warning = `${estranged.length} 位已离心，需先稳住人心。`;
    else if (highJealous.length) warning = `${highJealous.length} 位醋意渐重，偏宠会继续抬高风闻。`;
    else if (neglected.length) warning = `${neglected.length} 位已有数幕未见，适合召见或普赏安宫。`;
    else if (favorGap >= 24) warning = `君心明显偏向${top?.name || '一人'}，旁人会更容易生隙。`;
    return {
        topCharId: top?.charId || null,
        topName: top?.name || '—',
        favorGap,
        estrangedCount: estranged.length,
        highJealousCount: highJealous.length,
        neglectedCharIds: neglected,
        warning,
    };
}

export function previewFavorAction(s: StoryState, input: StoryFavorActionInput): StoryFavorPreview {
    const type = FAVOR_ACTIONS.has(input.type) ? input.type : 'summon';
    const label = STORY_FAVOR_ACTION_LABELS[type];
    const target = input.targetCharId ? s.characters[input.targetCharId] : undefined;
    const secondary = input.secondaryCharId ? s.characters[input.secondaryCharId] : undefined;
    const blockers: string[] = [];
    const effects: StoryChoice['effects'] = [];
    const relationshipDelta: StoryFavorRelationshipDelta[] = [];
    let resourceDelta: Partial<StoryResources> = {};
    let risk: StoryChoice['risk'] = 'low';
    let targetCharIds: string[] = [];
    let message = '';

    if (type !== 'balance' && !target) blockers.push('请选择一位角色');
    if (type === 'mediate') {
        if (!secondary) blockers.push('请选择要调停的另一位');
        if (target && secondary && target.charId === secondary.charId) blockers.push('调停双方不能是同一人');
    }

    if (type === 'summon' && target) {
        const repeated = recentSummonCount(s, target.charId) > 0;
        resourceDelta = { energy: -8, rumor: repeated ? 5 : 2 };
        addEffect(effects, target.charId, { affection: 4, trust: 1, mood: 2 });
        if (repeated) for (const c of allChars(s)) if (c.charId !== target.charId && c.affection >= 60) addEffect(effects, c.charId, { jealousy: 2 });
        risk = repeated ? 'mid' : 'low';
        targetCharIds = [target.charId];
        message = repeated ? `近两日再召${target.name}，情分会进，偏宠风声也会更响。` : `召${target.name}入殿独叙，让下一幕更贴近 ta。`;
    } else if (type === 'reward' && target) {
        resourceDelta = { silver: -12, rumor: 1 };
        addEffect(effects, target.charId, { affection: 5, mood: 4 });
        for (const c of allChars(s)) if (c.charId !== target.charId && c.affection >= 60) addEffect(effects, c.charId, { jealousy: 2 });
        risk = 'mid';
        targetCharIds = [target.charId];
        message = `赐赏${target.name}，欢心易得，也会让旁人看见你的偏向。`;
    } else if (type === 'protect' && target) {
        resourceDelta = { power: -8, reputation: -2 };
        addEffect(effects, target.charId, { trust: 6, jealousy: -4, mood: 3 });
        risk = 'mid';
        targetCharIds = [target.charId];
        message = `为${target.name}挡下风雨，ta 会更信你，但朝野目光会记下一笔。`;
    } else if (type === 'cool' && target) {
        resourceDelta = { reputation: 1, rumor: -4, energy: 4 };
        addEffect(effects, target.charId, { affection: -3, trust: -2, jealousy: -10, mood: -4 });
        risk = 'high';
        targetCharIds = [target.charId];
        message = `暂冷${target.name}，能压住醋意与风闻，也会伤到 ta 的心。`;
    } else if (type === 'mediate' && target && secondary && target.charId !== secondary.charId) {
        resourceDelta = { energy: -10, reputation: 3, rumor: -4 };
        addEffect(effects, target.charId, { trust: 2, jealousy: -6, mood: 2 });
        addEffect(effects, secondary.charId, { trust: 2, jealousy: -6, mood: 2 });
        relationshipDelta.push({ a: target.charId, b: secondary.charId, bond: 10, label: '调停释隙' });
        risk = 'mid';
        targetCharIds = [target.charId, secondary.charId];
        message = `请${target.name}与${secondary.name}坐下说开，后宫暗流会稍缓。`;
    } else if (type === 'balance') {
        const targets = allChars(s).slice(0, 6);
        resourceDelta = { silver: -18, energy: -8, reputation: 4, rumor: -6 };
        for (const c of targets) addEffect(effects, c.charId, { affection: 1, jealousy: -4, mood: 3 });
        risk = 'low';
        targetCharIds = targets.map(c => c.charId);
        message = '普赏安宫，照顾诸位体面，能缓偏宠之议。';
    }

    blockers.push(...resourceBlockers(s, resourceDelta));
    const actionText = type === 'balance'
        ? label
        : type === 'mediate'
            ? `${label}${favorTargets(s, targetCharIds)}`
            : `${label}${target ? target.name : ''}`;
    return {
        ok: blockers.length === 0,
        type,
        title: label,
        actionText,
        risk,
        resourceDelta,
        effects,
        relationshipDelta,
        targetCharIds,
        message,
        nextIntent: `宠爱经营台：${actionText}。${message}`,
        blockers,
    };
}

function normalizeResources(raw?: Partial<StoryResources>): StoryResources {
    const base = { ...DEFAULT_RESOURCES, ...(raw || {}) };
    return {
        power: clamp100(num(base.power, DEFAULT_RESOURCES.power)),
        reputation: clamp100(num(base.reputation, DEFAULT_RESOURCES.reputation)),
        silver: clampN(num(base.silver, DEFAULT_RESOURCES.silver), 0, 999),
        energy: clamp100(num(base.energy, DEFAULT_RESOURCES.energy)),
        rumor: clamp100(num(base.rumor, DEFAULT_RESOURCES.rumor)),
    };
}

export function applyResourceDelta(resources: StoryResources, delta: Partial<StoryResources> = {}): StoryResources {
    const next: StoryResources = { ...normalizeResources(resources) };
    for (const key of RESOURCE_KEYS) {
        if (delta[key] == null) continue;
        const max = key === 'silver' ? 999 : 100;
        next[key] = clampN(num(next[key]) + num(delta[key]), 0, max);
    }
    return next;
}

function unlockedLocationIds(day: number, chapterIndex: number, keep: PalaceLocationId[] = []): PalaceLocationId[] {
    const ids = new Set<PalaceLocationId>(keep);
    for (const loc of PALACE_LOCATIONS) if (loc.unlockDay <= day && loc.unlockChapter <= chapterIndex) ids.add(loc.id);
    return [...ids];
}

export function availableLocations(s: StoryState): PalaceLocation[] {
    const ids = new Set(unlockedLocationIds(s.day, s.chapter?.index || 1, s.map?.unlocked || []));
    return PALACE_LOCATIONS.filter(loc => ids.has(loc.id));
}

function normalizeMap(raw: any, day: number, chapterIndex: number): StoryPalaceMapState {
    const keep = Array.isArray(raw?.unlocked) ? raw.unlocked.filter((id: any) => PALACE_LOCATIONS.some(l => l.id === id)) as PalaceLocationId[] : [];
    const unlocked = unlockedLocationIds(day, chapterIndex, keep);
    return {
        unlocked,
        visited: raw?.visited && typeof raw.visited === 'object' ? raw.visited : {},
        lastLocationId: PALACE_LOCATIONS.some(l => l.id === raw?.lastLocationId) ? raw.lastLocationId : 'jiaofang',
    };
}

function sanitizeResourceDelta(raw: any): Partial<StoryResources> {
    const out: Partial<StoryResources> = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    for (const key of RESOURCE_KEYS) {
        if (raw[key] == null) continue;
        const limit = key === 'silver' ? 80 : 25;
        out[key] = clampN(num(raw[key]), -limit, limit);
    }
    return out;
}

const INVENTORY_KINDS = new Set<StoryInventoryItem['kind']>(['clue', 'gift', 'edict', 'token']);
function sanitizeInventoryUpdates(raw: any, s: StoryState): StoryScene['inventoryUpdates'] {
    if (!Array.isArray(raw)) return [];
    return raw.slice(0, 4).map((it: any) => {
        const name = String(it?.name || '').trim().slice(0, 24);
        const text = String(it?.text || it?.description || '').trim().slice(0, 120);
        if (!name || !text) return null;
        const kind = INVENTORY_KINDS.has(it?.kind) ? it.kind as StoryInventoryItem['kind'] : 'clue';
        const cid = it?.charId && s.characters[it.charId] ? String(it.charId) : undefined;
        return { id: it?.id ? String(it.id).slice(0, 40) : undefined, name, text, kind, charId: cid, source: it?.source ? String(it.source).slice(0, 40) : undefined };
    }).filter(Boolean) as StoryScene['inventoryUpdates'];
}

function mergeInventory(existing: StoryInventoryItem[], updates: StoryScene['inventoryUpdates'] = [], day: number): StoryInventoryItem[] {
    const byId = new Map(existing.map(it => [it.id, it]));
    for (const u of updates) {
        const id = u.id || `item_${sid()}`;
        byId.set(id, {
            id,
            name: u.name,
            kind: u.kind || 'clue',
            text: u.text,
            day,
            charId: u.charId,
            source: u.source,
        });
    }
    return [...byId.values()].sort((a, b) => b.day - a.day).slice(0, 60);
}

export function unlockAchievement(s: StoryState, achievement: StoryAchievement | { id: string; title: string; description: string }): StoryState {
    if (!achievement.id || s.achievements.some(a => a.id === achievement.id)) return s;
    return { ...s, achievements: [{ ...achievement, unlockedAt: Date.now() }, ...s.achievements].slice(0, 80) };
}

function sanitizeAchievementUpdates(raw: any): { id: string; title: string; description: string }[] {
    const arr = Array.isArray(raw) ? raw : [];
    return arr.slice(0, 4).map((a: any) => {
        if (typeof a === 'string') {
            const id = a.trim().slice(0, 40);
            return id ? { id, title: id, description: '剧情中解锁的印记。' } : null;
        }
        const id = String(a?.id || '').trim().slice(0, 40);
        if (!id) return null;
        return {
            id,
            title: String(a?.title || id).trim().slice(0, 24),
            description: String(a?.description || '剧情中解锁的印记。').trim().slice(0, 80),
        };
    }).filter(Boolean) as { id: string; title: string; description: string }[];
}

const HOOK_KINDS = new Set<StoryGeneratedHook['kind']>(['side', 'intrigue', 'location_event', 'character_event']);
const ACTION_ENTRY_POINTS = new Set<StoryActionEntryPoint>(['scene', 'map', 'character', 'inventory', 'objective', 'favor']);
const safeSlug = (v: string): string => v.toLowerCase().replace(/[^a-z0-9_\-\u4e00-\u9fa5]+/g, '_').slice(0, 40) || `id_${sid()}`;

export function sanitizeGeneratedHook(raw: any, s: StoryState, source: StoryActionEntryPoint | string = 'scene'): StoryGeneratedHook | null {
    if (!raw || typeof raw !== 'object') return null;
    const title = String(raw.title || raw.name || '').trim().slice(0, 28);
    const summary = String(raw.summary || raw.text || raw.description || '').trim().slice(0, 140);
    if (!title || !summary) return null;
    const locId = PALACE_LOCATIONS.some(l => l.id === raw.locationId) ? raw.locationId as PalaceLocationId : undefined;
    const charId = raw.charId && s.characters[raw.charId] ? String(raw.charId) : undefined;
    const objectiveId = raw.objectiveId && s.objectives.some(o => o.id === raw.objectiveId) ? String(raw.objectiveId).slice(0, 50) : undefined;
    const id = raw.id ? safeSlug(String(raw.id)) : `hook_${safeSlug(title)}_${s.day}`;
    return {
        id,
        kind: HOOK_KINDS.has(raw.kind) ? raw.kind : 'intrigue',
        title,
        summary,
        source,
        day: s.day,
        expiresDay: clampN(num(raw.expiresDay, s.day + 14), s.day + 1, s.day + 60),
        locationId: locId,
        charId,
        objectiveId,
    };
}

function sanitizeRumor(raw: any, s: StoryState, source: StoryActionEntryPoint | string): StoryRumor | null {
    if (!raw || typeof raw !== 'object') return null;
    const text = String(raw.text || raw.summary || '').trim().slice(0, 120);
    if (!text) return null;
    return {
        id: raw.id ? safeSlug(String(raw.id)) : `rumor_${safeSlug(text)}_${s.day}`,
        text,
        source,
        day: s.day,
        expiresDay: clampN(num(raw.expiresDay, s.day + 10), s.day + 1, s.day + 45),
        heat: clampN(num(raw.heat, 30), 0, 100),
        truth: raw.truth ? String(raw.truth).slice(0, 100) : undefined,
        charId: raw.charId && s.characters[raw.charId] ? String(raw.charId) : undefined,
    };
}

function sanitizeNpcStub(raw: any, s: StoryState, source: StoryActionEntryPoint | string): StoryNpcStub | null {
    if (!raw || typeof raw !== 'object') return null;
    const name = String(raw.name || '').trim().slice(0, 16);
    const role = String(raw.role || '宫人').trim().slice(0, 20);
    const summary = String(raw.summary || raw.text || '').trim().slice(0, 120);
    if (!name || !summary) return null;
    return {
        id: raw.id ? safeSlug(String(raw.id)) : `npc_${safeSlug(name)}_${s.day}`,
        name,
        role,
        summary,
        disposition: String(raw.disposition || '观望').trim().slice(0, 20),
        source,
        day: s.day,
        expiresDay: clampN(num(raw.expiresDay, s.day + 18), s.day + 1, s.day + 60),
        locationId: PALACE_LOCATIONS.some(l => l.id === raw.locationId) ? raw.locationId as PalaceLocationId : undefined,
    };
}

function uniqueById<T extends { id: string }>(items: T[], cap: number): T[] {
    const m = new Map<string, T>();
    for (const item of items) m.set(item.id, item);
    return [...m.values()].slice(0, cap);
}

export function expireGeneratedHooks(s: StoryState): StoryState {
    return {
        ...s,
        generatedHooks: (s.generatedHooks || []).filter(h => h.expiresDay >= s.day).slice(0, 40),
        rumors: (s.rumors || []).filter(r => r.expiresDay >= s.day).slice(0, 60),
        npcStubs: (s.npcStubs || []).filter(n => n.expiresDay >= s.day).slice(0, 40),
    };
}

function mergeActionContent(s: StoryState, judgement: StoryActionJudgement): StoryState {
    const generatedHooks = uniqueById([...(judgement.generatedHooks || []), ...(s.generatedHooks || [])], 40);
    const rumors = uniqueById([...(judgement.rumors || []), ...(s.rumors || [])], 60);
    const npcStubs = uniqueById([...(judgement.npcStubs || []), ...(s.npcStubs || [])], 40);
    const objectives = [...s.objectives];
    for (const hook of judgement.generatedHooks || []) {
        if (hook.kind !== 'side') continue;
        const id = `hook_${hook.id}`;
        if (objectives.some(o => o.id === id)) continue;
        objectives.push({
            id,
            kind: 'side',
            title: hook.title,
            description: hook.summary,
            target: 12,
            progress: 0,
            done: false,
            reward: { reputation: 3, rumor: -2 },
        });
    }
    return expireGeneratedHooks({ ...s, generatedHooks, rumors, npcStubs, objectives: objectives.slice(0, 16), pendingJudgement: null });
}

function achievementSweep(s: StoryState): StoryState {
    let next = s;
    if (s.day >= 60) next = unlockAchievement(next, { id: 'survive_60_days', title: '六十日长卷', description: '这场椒房旧梦走过了六十日。' });
    if (s.inventory.length >= 5) next = unlockAchievement(next, { id: 'five_clues', title: '暗线成册', description: '收集五条线索或信物。' });
    if (Object.values(s.characters).some(c => c.affection >= 90 && c.trust >= 80)) next = unlockAchievement(next, { id: 'deep_vow', title: '深盟已成', description: '有人与你情深而信重。' });
    if (s.resources.power >= 80 && s.resources.reputation >= 70) next = unlockAchievement(next, { id: 'palace_mastery', title: '凤阙在握', description: '宫权与声望足以压住风波。' });
    return next;
}

export function advanceObjectives(s: StoryState, updates: StoryScene['objectiveUpdates'] = [], passiveProgress = 0): StoryState {
    let resources = s.resources;
    const objectives = s.objectives.map(o => ({ ...o, reward: o.reward ? { ...o.reward } : undefined }));
    const main = objectives.find(o => o.kind === 'main' && o.chapterId === s.chapter.id);
    if (main && passiveProgress > 0 && !main.done) main.progress = clampN(main.progress + passiveProgress, 0, main.target);

    for (const upd of updates || []) {
        const target = upd.id ? objectives.find(o => o.id === upd.id) : main;
        if (!target || target.done) continue;
        if (upd.progress != null) target.progress = clampN(target.progress + num(upd.progress), 0, target.target);
        if (upd.done) target.progress = target.target;
    }

    const clueObjective = objectives.find(o => o.id === 'side_collect_clues');
    if (clueObjective && !clueObjective.done) clueObjective.progress = Math.min(clueObjective.target, Math.max(clueObjective.progress, s.inventory.length));
    const balanceObjective = objectives.find(o => o.id === 'side_balance_hearts');
    if (balanceObjective && !balanceObjective.done) {
        const close = Object.values(s.characters).filter(c => c.affection >= 50 && !c.estranged).length;
        balanceObjective.progress = Math.min(balanceObjective.target, Math.max(balanceObjective.progress, close));
    }

    for (const o of objectives) {
        if (!o.done && o.progress >= o.target) {
            o.done = true;
            if (o.reward) resources = applyResourceDelta(resources, o.reward);
        }
    }

    const mainAfter = objectives.find(o => o.kind === 'main' && o.chapterId === s.chapter.id);
    const chapter = { ...s.chapter, progress: mainAfter ? mainAfter.progress : s.chapter.progress };
    return { ...s, objectives, resources, chapter };
}

export function advanceChapter(s: StoryState): StoryState {
    const chapter = { ...s.chapter };
    if (chapter.index >= CHAPTER_DEFS.length) {
        chapter.completed = chapter.progress >= chapter.goal;
        chapter.finaleReady = s.day >= 60 && chapter.progress >= Math.min(chapter.goal, 50);
        return { ...s, chapter, map: normalizeMap(s.map, s.day, chapter.index) };
    }
    if (chapter.progress < chapter.goal) return { ...s, chapter, map: normalizeMap(s.map, s.day, chapter.index) };
    const nextDef = chapterDefAt(chapter.index + 1);
    if (s.day < nextDef.minDay) {
        chapter.completed = true;
        return { ...s, chapter, map: normalizeMap(s.map, s.day, chapter.index) };
    }
    const nextChapter = makeChapter(nextDef.index);
    const exists = s.objectives.some(o => o.id === mainObjectiveId(nextChapter.id));
    const objectives = exists ? s.objectives : [makeMainObjective(nextChapter), ...s.objectives].slice(0, 12);
    return { ...s, chapter: nextChapter, objectives, map: normalizeMap(s.map, s.day, nextChapter.index) };
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
    const all = allChars(s);
    if (all.length === 0) return [];
    // 玩家主动择幸：剧情未被硬事件接管时，优先安排指定角色独处
    if (s.focusHint && s.characters[s.focusHint] && ['date', 'night_talk', 'daily', 'breakthrough'].includes(turnType)) {
        return [s.focusHint];
    }
    // 日常类场景回避「离心」者（他们淡出后宫）；危机/嫉妒仍可能把他们卷回来
    const chars = (turnType === 'crisis' || turnType === 'jealousy') ? all : (all.filter(c => !c.estranged).length ? all.filter(c => !c.estranged) : all);
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

    // 0.5) 玩家主动择幸：优先安排与指定角色独处（夜则夜谈）
    if (s.focusHint && s.characters[s.focusHint] && !s.characters[s.focusHint].estranged) {
        return s.time === '夜' ? 'night_talk' : 'date';
    }

    // 1) 嫉妒爆发：有人嫉妒≥70 且非刚发作（离心者已心死，不再争宠）
    const jealous = chars.find(c => !c.estranged && c.jealousy >= 70);
    if (jealous && !usedRecently('jealousy')) return 'jealousy';

    // 2) 冷战：有人好感尚可但信任很低 / 心情谷底
    const frosty = chars.find(c => !c.estranged && c.affection >= 32 && (c.trust < 22 || c.mood < 22));
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
        .find(c => c && !c.estranged && c.affection >= 66 && c.trust >= 50 && !c.flags.broke);
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
//  ⑨ AI 请求模块：把 15 条规则 + 输出 schema 烧进 prompt
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
    '必须写成长剧情单幕：有铺垫、动作、情绪推进和回合末尾的选择压力，不得只写剧情梗概。',
];

const SCHEMA = `{
  "sceneTitle": "本场标题(简短)",
  "mood": "本场氛围词(如 缠绵/静谧/剑拔弩张/暗潮汹涌)",
  "narration": "旁白叙事(2到4段，用\\n\\n分段；写环境、动作、局势、暗涌与玩家可观察到的反应，不替玩家说话)",
  "dialogues": [{"speaker":"角色名","text":"台词(每句可2到4个短句，承接前文推进冲突或亲近)","emotion":"情绪(可选)","inner":"该角色此刻没说出口的心声(可选，玩家能偷看到)"}],
  "choices": [
    {"text":"选项文案","tone":"语气","effects":[{"charId":"角色id","affection":整数,"trust":整数,"jealousy":整数,"mood":整数}],"risk":"low|mid|high","nextIntent":"选此项后剧情走向"}
  ],
  "effectsPreview": "给玩家的朦胧提示(不写精确数字)",
  "memoryUpdates": [{"charId":"角色id(可空=全局)","text":"要记住的事","kind":"event|promise|conflict|intimacy|gift|fact","weight":1到5}],
  "flagUpdates": {"flag名":"值"},
  "resourceDelta": {"power":整数,"reputation":整数,"silver":整数,"energy":整数,"rumor":整数},
  "objectiveUpdates": [{"id":"目标id(可空=当前主线)","progress":整数,"done":布尔}],
  "inventoryUpdates": [{"id":"稳定id(可选)","name":"线索/信物名","kind":"clue|gift|edict|token","text":"说明","charId":"关联角色id(可选)"}],
  "achievementUpdates": [{"id":"成就id","title":"成就名","description":"说明"}],
  "nextSceneHint": "下一场的走向暗示"
}`;

function resourcesBlock(s: StoryState): string {
    return RESOURCE_KEYS.map(k => `${STORY_RESOURCE_LABELS[k]}${s.resources?.[k] ?? DEFAULT_RESOURCES[k]}`).join(' / ');
}

function objectiveBlock(s: StoryState): string {
    return s.objectives.slice(0, 6).map(o => `- ${o.kind === 'main' ? '主线' : '支线'} ${o.id}：${o.title} ${o.progress}/${o.target}${o.done ? '（已成）' : ''}｜${o.description}`).join('\n') || '（暂无）';
}

function mapIntentBlock(s: StoryState): string {
    if (!s.mapIntent) return '（无，本回合按节奏自然推进）';
    const loc = PALACE_LOCATIONS.find(l => l.id === s.mapIntent?.locationId);
    return `${loc?.name || s.location} · ${s.mapIntent.label}${s.mapIntent.note ? `｜${s.mapIntent.note}` : ''}`;
}

function generatedContextBlock(s: StoryState): string {
    const hooks = (s.generatedHooks || []).slice(0, 6).map(h => {
        const loc = h.locationId ? PALACE_LOCATIONS.find(l => l.id === h.locationId)?.name : '';
        const who = h.charId && s.characters[h.charId] ? s.characters[h.charId].name : '';
        return `- ${h.id}|${h.title}|${h.summary}${loc ? `|location:${loc}` : ''}${who ? `|char:${who}` : ''}|expiresDay:${h.expiresDay}`;
    });
    const rumors = (s.rumors || []).slice(0, 6).map(r => {
        const who = r.charId && s.characters[r.charId] ? `|char:${s.characters[r.charId].name}` : '';
        return `- ${r.id}|heat:${r.heat}${who}|${r.text}|expiresDay:${r.expiresDay}`;
    });
    const npcs = (s.npcStubs || []).slice(0, 5).map(n => {
        const loc = n.locationId ? PALACE_LOCATIONS.find(l => l.id === n.locationId)?.name : '';
        return `- ${n.id}|${n.name}/${n.role}|${n.disposition}|${n.summary}${loc ? `|location:${loc}` : ''}|expiresDay:${n.expiresDay}`;
    });
    const lines = [
        hooks.length ? `AI hooks:\n${hooks.join('\n')}` : '',
        rumors.length ? `Rumors:\n${rumors.join('\n')}` : '',
        npcs.length ? `NPC stubs:\n${npcs.join('\n')}` : '',
    ].filter(Boolean);
    return lines.join('\n') || 'None';
}

function rosterBlock(s: StoryState): string {
    return allChars(s).map(c => {
        const here = s.activeCharacters.includes(c.charId) ? '【在场】' : '【未登场】';
        const recall = c.memories.slice(0, 3).map(m => m.text).join('；');
        const g = c.gender === 'unknown' ? '性别依人设' : `${GENDER_WORD[c.gender]}`;
        return `- ${here}${c.name}(id=${c.charId}，${g})：好感${c.affection}/信任${c.trust}/嫉妒${c.jealousy}/心情${c.mood}｜阶段「${stageOf(c.affection).label}」｜态度「${c.attitude}」${c.estranged ? '｜已离心(淡出后宫)' : ''}`
            + (c.persona ? `\n    完整人设：\n${c.persona}` : '')
            + (recall ? `\n    ta记得：${recall}` : '');
    }).join('\n');
}

function playerIdentity(s: StoryState): string {
    const g = s.player.gender === 'unknown' ? '性别不限' : `${GENDER_WORD[s.player.gender]}性`;
    return `${s.player.name}（${s.player.title}，${g}）`;
}

function historyBlock(s: StoryState): string {
    if (!s.history.length) return '（这是开场，尚无历史）';
    return s.history.slice(0, 4).map(h => `· 第${h.day}日${h.time}·${TURN_LABEL(h.turnType)}「${h.sceneTitle}」→ 你选择「${h.choiceText}」（${h.tone}）`).join('\n');
}

function resourceDeltaBlock(delta: Partial<StoryResources> = {}): string {
    const lines = RESOURCE_KEYS
        .filter(k => delta[k])
        .map(k => `${STORY_RESOURCE_LABELS[k]}${(delta[k] || 0) > 0 ? '+' : ''}${delta[k]}`);
    return lines.join('/') || '无资源变动';
}

function favorEffectsBlock(s: StoryState, effects: StoryChoice['effects'] = []): string {
    const lines = effects.map(e => {
        const tags: string[] = [];
        if (e.affection) tags.push(`好感${e.affection > 0 ? '+' : ''}${e.affection}`);
        if (e.trust) tags.push(`信任${e.trust > 0 ? '+' : ''}${e.trust}`);
        if (e.jealousy) tags.push(`嫉妒${e.jealousy > 0 ? '+' : ''}${e.jealousy}`);
        if (e.mood) tags.push(`心情${e.mood > 0 ? '+' : ''}${e.mood}`);
        return tags.length ? `${s.characters[e.charId]?.name || e.charId}:${tags.join('/')}` : '';
    }).filter(Boolean);
    return lines.join('；') || '无显著人物变化';
}

function favorLedgerBlock(s: StoryState): string {
    const entries = (s.favorLedger || []).slice(0, 8);
    if (!entries.length) return '（暂无恩宠账）';
    return entries.map(e => {
        const targets = favorTargets(s, e.targetCharIds);
        const rel = e.relationshipDelta.length ? `；关系:${e.relationshipDelta.map(r => `${s.characters[r.a]?.name || r.a}-${s.characters[r.b]?.name || r.b}${r.bond > 0 ? '+' : ''}${r.bond}`).join('/')}` : '';
        return `· 第${e.day}日${e.time} ${e.title}「${e.actionText}」｜${targets}｜${resourceDeltaBlock(e.resourceDelta)}｜${favorEffectsBlock(s, e.effects)}${rel}${e.note ? `｜${e.note}` : ''}`;
    }).join('\n');
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

    const rels = relationshipSummary(s);
    const lastWasCustom = s.lastTurn?.custom;
    const cfg = s.settings || DEFAULT_SETTINGS;
    const heat = HEAT_LABELS[Math.max(0, Math.min(3, cfg.heat))] || HEAT_LABELS[1];
    const styleBlock = `【叙事风格】${styleLabel(cfg.style)}——${styleHint(cfg.style)}\n`
        + `【节奏】${paceHint(cfg.pace)}\n`
        + `【尺度】${heat}：在**不违反「不得超出当前好感/信任阶段」**（铁律 ⑥）的前提下，亲密与情欲描写最多到「${heat}」的程度为止；越亲密越要以好感为前提。\n`
        + (cfg.premise ? `【玩家设定的开场/世界观】${cfg.premise.slice(0, 300)}（请贯穿全程、尊重此设定）\n` : '');

    const system = `你是一款古风宫廷恋爱文字互动游戏（galgame 式）的「实时编剧」。玩家扮演一位宫廷之主「${s.player.title}」，身边有多位可攻略的恋慕对象（即「后宫」）。`
        + `你的职责：依据下方**当前游戏状态**，写好「这一回合」的一整幕长剧情，并给玩家 3 个选择。重人物与情感、有张力。\n\n`
        + styleBlock + '\n'
        + `【身份与性别 · 极重要】玩家与每位角色的性别都已在下方标明，可为男可为女（支持女帝男妃、同性、混合后宫等任意组合）。`
        + `务必按各自性别选用相称的称谓与自称（如男性侍君者可自称「臣」「微臣」、女性可自称「臣妾」「妾身」，按其人设而定），`
        + `**绝不要默认所有角色都是女性，也不要默认玩家是男性**；性别标为「依人设」的，按其人设/名字气质自行判断并保持前后一致。\n\n`
        + `【铁律 · 必须全部遵守】\n${RULES.map((r, i) => `${i + 1}. ${r}`).join('\n')}\n\n`
        + `【主线边界】章节、地图、资源、目标与结局节奏均由游戏引擎控制；你只写当前场景，不要擅自越章、跳时间或宣布结局。`
        + `可以在 resourceDelta/objectiveUpdates/inventoryUpdates/achievementUpdates 里给出温和后果，由引擎二次钳制。\n\n`
        + `【本回合节奏：${tm.label}】\n应当：${tm.guide}\n避免：${tm.avoid}\n变量取向：宜升「${tm.raise}」、宜降「${tm.lower}」。\n\n`
        + `【篇幅与质感 · 极重要】这一幕必须像可阅读的仿真文游正文，不是摘要。`
        + `narration 写 2~4 段，每段 80~160 个汉字，使用 \\n\\n 分段；dialogues 写 4~8 条，至少让主要在场角色说 2 条以上。`
        + `每幕要包含：场景细节、角色动作、话外情绪、关系/权力暗流、上回合后果的一处回响、结尾的选择压力。`
        + `不要用“片刻后/众人寒暄/气氛微妙”这类空泛跳写糊弄过去；要让玩家感觉这一幕真的发生过。\n\n`
        + `【输出格式】只输出一个 JSON（不要任何解释、不要 Markdown、不要代码块标记），结构如下：\n${SCHEMA}\n`
        + `约束：choices 必须恰好 3 个；每个选项 effects 至少含一位在场角色、数值为整数（好感/信任建议 -12~12、嫉妒/心情 -15~15）；`
        + `资源变化要小幅且与场景有关；speaker 用上面出现过的角色名；id 用上面的 id。`;

    const user = `【玩家】${playerIdentity(s)}\n`
        + (s.player.persona ? `【完整用户设定】\n${s.player.persona}\n` : '')
        + `【时空】第 ${s.day} 日 · ${s.time} · ${s.location}\n`
        + `【主线章节】第 ${s.chapter.index} 章「${s.chapter.title}」：${s.chapter.subtitle}｜进度 ${s.chapter.progress}/${s.chapter.goal}${s.chapter.finaleReady ? '｜终局已可收束' : ''}\n`
        + `【当前探索意图】${mapIntentBlock(s)}\n`
        + `【资源】${resourcesBlock(s)}\n`
        + `【目标】\n${objectiveBlock(s)}\n`
        + `【线索/信物】${s.inventory.length ? s.inventory.slice(0, 5).map(i => `${i.name}：${i.text}`).join('；') : '（暂无）'}\n`
        + `【AI判官生成的暗线/风闻/NPC】\n${generatedContextBlock(s)}\n`
        + `【最近恩宠账】\n${favorLedgerBlock(s)}\n`
        + `【在场】${present}\n`
        + `【后宫诸位】\n${rosterBlock(s)}\n`
        + (rels.length ? `【她/他们之间】${rels.join('；')}\n` : '')
        + `【事件标记 flags】${Object.keys(s.flags).length ? JSON.stringify(s.flags) : '（无）'}\n`
        + `【近期历史】\n${historyBlock(s)}`
        + (s.lastTurn ? `\n【上一回合你${lastWasCustom ? '（自由行动）' : '的选择'}】「${s.lastTurn.choiceText}」（${s.lastTurn.tone}）→ 意图：${s.lastTurn.nextIntent || '—'}${lastWasCustom ? '（请顺着玩家这个自主行动自然展开后果，但仍不得替玩家做新的决定）' : ''}` : '')
        + carryNote
        + `\n\n请据此写「${opts.opening ? '开场' : '这一回合'}」的剧情 JSON。`;

    return { system, user };
}

const ACTION_JUDGEMENT_SCHEMA = `{
  "title": "判词标题(≤12字)",
  "verdict": "对玩家行动的判定，说明为何可行/有风险(40~90字)",
  "risk": "low|mid|high",
  "cost": {"power":整数,"reputation":整数,"silver":整数,"energy":整数,"rumor":整数},
  "reward": {"power":整数,"reputation":整数,"silver":整数,"energy":整数,"rumor":整数},
  "effects": [{"charId":"角色id","affection":整数,"trust":整数,"jealousy":整数,"mood":整数}],
  "involvedCharIds": ["角色id"],
  "mapIntent": {"locationId":"地点id","action":"explore|visit|govern|gossip|gift|rest|chapter","label":"行动名","targetCharId":"角色id(可选)","note":"给下一幕的意图"},
  "objectiveUpdates": [{"id":"目标id(可空=当前主线)","progress":整数,"done":布尔}],
  "inventoryUpdates": [{"id":"稳定id","name":"线索/信物名","kind":"clue|gift|edict|token","text":"说明","charId":"关联角色id(可选)"}],
  "achievementUpdates": [{"id":"成就id","title":"成就名","description":"说明"}],
  "generatedHooks": [{"id":"稳定id","kind":"side|intrigue|location_event|character_event","title":"标题","summary":"摘要","expiresDay":数字,"locationId":"地点id(可选)","charId":"角色id(可选)"}],
  "rumors": [{"id":"稳定id","text":"传闻正文","heat":0到100,"expiresDay":数字,"truth":"真相(可选)","charId":"角色id(可选)"}],
  "npcStubs": [{"id":"稳定id","name":"临时NPC名","role":"身份","summary":"作用摘要","disposition":"态度","expiresDay":数字,"locationId":"地点id(可选)"}],
  "nextIntent": "确认后下一幕要展开的方向",
  "confidence": 0到100
}`;

export function buildActionJudgementPrompt(
    s: StoryState,
    input: { entryPoint: StoryActionEntryPoint; actionText: string; context?: string; targetCharId?: string; itemId?: string; objectiveId?: string; locationId?: PalaceLocationId },
): { system: string; user: string } {
    const locs = availableLocations(s).map(l => `${l.id}:${l.name}(${l.actions.join('/')})`).join('；');
    const rels = relationshipSummary(s);
    const hooks = (s.generatedHooks || []).slice(0, 6).map(h => `${h.id}:${h.title}(${h.summary})`).join('；') || '（无）';
    const rumors = (s.rumors || []).slice(0, 6).map(r => `${r.id}:${r.text}`).join('；') || '（无）';
    const npcs = (s.npcStubs || []).slice(0, 6).map(n => `${n.id}:${n.name}/${n.role}(${n.summary})`).join('；') || '（无）';
    const system = `你是古风宫廷文游「椒房记」的宫廷判官/导演。你的任务不是写下一幕正文，而是把玩家的自由行动判定成结构化后果。`
        + `你可以创造局内支线、传闻、临时NPC或地点事件钩子，但不能改真实角色档案，不能直接宣告结局，不能越过引擎给出的地点/角色/目标 id。`
        + `数值变化必须克制：单项资源建议 -20~20；好感/信任 -10~10；嫉妒/心情 -12~12。只输出 JSON。\n\n`
        + `【输出格式】\n${ACTION_JUDGEMENT_SCHEMA}`;
    const user = `【玩家行动入口】${input.entryPoint}\n`
        + `【玩家行动】${input.actionText.slice(0, 240)}\n`
        + (input.context ? `【入口上下文】${input.context.slice(0, 240)}\n` : '')
        + `【玩家】${playerIdentity(s)}\n`
        + `【时空】第 ${s.day} 日 · ${s.time} · ${s.location}\n`
        + `【章节】第 ${s.chapter.index} 章「${s.chapter.title}」${s.chapter.progress}/${s.chapter.goal}\n`
        + `【资源】${resourcesBlock(s)}\n`
        + `【地点白名单】${locs}\n`
        + `【目标】\n${objectiveBlock(s)}\n`
        + `【角色白名单】\n${rosterBlock(s)}\n`
        + (rels.length ? `【她/他们之间】${rels.join('；')}\n` : '')
        + `【线索/信物】${s.inventory.length ? s.inventory.slice(0, 8).map(i => `${i.id}:${i.name}(${i.text})`).join('；') : '（暂无）'}\n`
        + `【最近恩宠账】\n${favorLedgerBlock(s)}\n`
        + `【既有支线钩子】${hooks}\n`
        + `【既有风闻】${rumors}\n`
        + `【临时NPC】${npcs}\n`
        + `【近期历史】\n${historyBlock(s)}\n\n`
        + `请判定这个行动：给出风险、代价、收益、牵动角色、可新增的支线/传闻/NPC/线索，并保证所有 id 使用上方白名单或为新内容生成稳定 id。`;
    return { system, user };
}

function sanitizeJudgementMapIntent(raw: any, s: StoryState): StoryMapIntent | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const locId = raw.locationId as PalaceLocationId;
    const action = raw.action as PalaceActionType;
    if (!PALACE_LOCATIONS.some(l => l.id === locId)) return undefined;
    const probe: StoryMapIntent = {
        locationId: locId,
        action,
        label: String(raw.label || PALACE_ACTION_LABELS[action] || '谋划').slice(0, 32),
        targetCharId: raw.targetCharId && s.characters[raw.targetCharId] ? String(raw.targetCharId) : undefined,
        note: raw.note ? String(raw.note).slice(0, 80) : undefined,
    };
    return sanitizeMapIntent(s, probe) || undefined;
}

function sanitizeJudgementResource(raw: any, sign: -1 | 1): Partial<StoryResources> {
    const delta = sanitizeResourceDelta(raw);
    const out: Partial<StoryResources> = {};
    for (const key of RESOURCE_KEYS) {
        const v = delta[key];
        if (v == null) continue;
        out[key] = sign < 0 ? -Math.abs(v) : Math.abs(v);
    }
    return out;
}

export function parseActionJudgement(
    raw: string,
    s: StoryState,
    fallback: { entryPoint: StoryActionEntryPoint; actionText: string },
): StoryActionJudgement | null {
    const o = extractJson(raw);
    if (!o || typeof o !== 'object') return null;
    const entryPoint: StoryActionEntryPoint = ACTION_ENTRY_POINTS.has(o.entryPoint) ? o.entryPoint : fallback.entryPoint;
    const actionText = String(o.actionText || fallback.actionText || '').trim().slice(0, 180);
    if (!actionText) return null;
    const source = entryPoint;
    const effects = sanitizeEffects(o.effects, s).slice(0, 4);
    const involved: string[] = Array.isArray(o.involvedCharIds)
        ? o.involvedCharIds.filter((id: any) => s.characters[id]).map(String).slice(0, 6)
        : effects.map(e => e.charId);
    const generatedHooks = (Array.isArray(o.generatedHooks) ? o.generatedHooks : [])
        .map((h: any) => sanitizeGeneratedHook(h, s, source))
        .filter(Boolean) as StoryGeneratedHook[];
    const rumors = (Array.isArray(o.rumors) ? o.rumors : [])
        .map((r: any) => sanitizeRumor(r, s, source))
        .filter(Boolean) as StoryRumor[];
    const npcStubs = (Array.isArray(o.npcStubs) ? o.npcStubs : [])
        .map((n: any) => sanitizeNpcStub(n, s, source))
        .filter(Boolean) as StoryNpcStub[];
    const objectiveUpdates: StoryScene['objectiveUpdates'] = (Array.isArray(o.objectiveUpdates) ? o.objectiveUpdates : [])
        .slice(0, 4)
        .map((u: any) => ({
            id: u?.id && s.objectives.some(x => x.id === u.id) ? String(u.id).slice(0, 50) : undefined,
            progress: u?.progress != null ? clampN(num(u.progress), -8, 16) : undefined,
            done: !!u?.done,
        }))
        .filter((u: any) => u.progress != null || u.done);
    return {
        id: o.id ? safeSlug(String(o.id)) : `judge_${Date.now().toString(36)}`,
        entryPoint,
        actionText,
        title: String(o.title || '宫廷判词').trim().slice(0, 24),
        verdict: String(o.verdict || o.summary || '此事可行，但后果需入局承担。').trim().slice(0, 140),
        risk: asRisk(o.risk),
        cost: sanitizeJudgementResource(o.cost, -1),
        reward: sanitizeJudgementResource(o.reward, 1),
        effects,
        involvedCharIds: Array.from(new Set<string>(involved.filter((id): id is string => typeof id === 'string'))),
        mapIntent: sanitizeJudgementMapIntent(o.mapIntent, s),
        objectiveUpdates,
        inventoryUpdates: sanitizeInventoryUpdates(o.inventoryUpdates, s),
        achievementUpdates: sanitizeAchievementUpdates(o.achievementUpdates),
        generatedHooks: generatedHooks.slice(0, 4),
        rumors: rumors.slice(0, 4),
        npcStubs: npcStubs.slice(0, 3),
        nextIntent: String(o.nextIntent || o.verdict || actionText).trim().slice(0, 120),
        confidence: clamp100(num(o.confidence, 60)),
    };
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
            return { speaker, charId: byName.get(speaker), text, emotion: d?.emotion ? String(d.emotion).slice(0, 8) : undefined, inner: d?.inner ? String(d.inner).trim().slice(0, 140) : undefined };
        })
        .filter(Boolean) as StoryDialogue[];

    let choices: StoryChoice[] = (Array.isArray(o.choices) ? o.choices : [])
        .slice(0, 3)
        .map((c: any) => ({
            text: String(c?.text || c?.label || '').trim().slice(0, 90),
            tone: String(c?.tone || '平和').trim().slice(0, 8) || '平和',
            effects: sanitizeEffects(c?.effects, s),
            risk: asRisk(c?.risk),
            nextIntent: String(c?.nextIntent || c?.intent || '').trim().slice(0, 140),
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
            return { charId: cid && s.characters[cid] ? cid : undefined, text: text.slice(0, 180), kind: asKind(m?.kind), weight: clampN(num(m?.weight, 1), 1, 5) };
        })
        .filter(Boolean) as StoryScene['memoryUpdates'];

    const flagUpdates: Record<string, string | number | boolean> = {};
    if (o.flagUpdates && typeof o.flagUpdates === 'object' && !Array.isArray(o.flagUpdates)) {
        for (const [k, v] of Object.entries(o.flagUpdates)) {
            if (!k) continue;
            if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') flagUpdates[String(k).slice(0, 40)] = v;
        }
    }

    const objectiveUpdates: StoryScene['objectiveUpdates'] = (Array.isArray(o.objectiveUpdates) ? o.objectiveUpdates : [])
        .slice(0, 4)
        .map((u: any) => ({
            id: u?.id ? String(u.id).trim().slice(0, 50) : undefined,
            progress: u?.progress != null ? clampN(num(u.progress), -8, 16) : undefined,
            done: !!u?.done,
        }))
        .filter((u: any) => u.progress != null || u.done);

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
        resourceDelta: sanitizeResourceDelta(o.resourceDelta),
        objectiveUpdates,
        inventoryUpdates: sanitizeInventoryUpdates(o.inventoryUpdates, s),
        achievementUpdates: sanitizeAchievementUpdates(o.achievementUpdates),
        nextSceneHint: String(o.nextSceneHint || '').trim().slice(0, 100),
        mood: o.mood ? String(o.mood).trim().slice(0, 12) || undefined : undefined,
        turnType: s.turnType,
    };
}

/** 按性别给一个自称（兜底文案用；AI 在线时由 prompt 指引，不走这里）。 */
const selfRef = (g: Gender): string => g === 'female' ? '臣妾' : g === 'male' ? '微臣' : '我';

/** AI 关闭/失败时的兜底剧情（保证游戏可玩，永远 3 个选项）。 */
export function fallbackScene(s: StoryState): StoryScene {
    const tm = TURN_META[s.turnType];
    const present = s.activeCharacters.map(id => s.characters[id]).filter(Boolean) as StoryChar[];
    const who = present[0];
    const name = who?.name || '那个人';
    const title = s.player.title || '君上';
    const names = present.map(c => c.name).join('、');
    const narration = present.length
        ? `${s.location}，${s.time}色微茫。帘外的风贴着廊柱过去，宫灯把${names}的影子拉得很长，连案上那盏茶都像在等一个迟迟未落的字。\n\n${name}立于近前，${who.attitude}，似有话要说，又咽了回去。这是一场${tm.label}的照面，气氛说不清的微妙：若开口太早，像邀宠；若退得太远，又怕这一退便被旁人占了先。`
        : `${s.location}独坐，${s.time}风穿廊。无人相伴，思绪却没停下，旧事、风闻与未完的宫务一并压在案头。\n\n殿外偶有宫铃轻响，传到里面已经很轻，却更显得此刻空旷。下一步往哪里去，见谁，赏谁，冷谁，都会被人记在心里。`;
    const me = who ? selfRef(who.gender) : '我';
    const dialogues: StoryDialogue[] = who ? [{ speaker: who.name, charId: who.charId, text: pick([`…${title}今日，可还安好？方才外头有人提起旧事，${me}听着不该入耳，却还是记住了。`, `${me}候着${title}呢。宫里这些日子风声多，人人都说自己不在意，可谁又真能不听？`, `${title}若得空，能否多留片刻？有些话放久了会冷，有些心意却越放越沉。`], Math.random), emotion: '试探', inner: '这一句若说得太轻，怕被当作无心；说得太重，又怕惊扰了眼前人。' }] : [];
    const MOOD_BY_TURN: Record<TurnType, string> = {
        daily: '闲适', date: '缱绻', group: '暗流涌动', jealousy: '剑拔弩张', cold_war: '冷寂',
        night_talk: '静谧', breakthrough: '心动', crisis: '风雨欲来', route_lock: '郑重', ending: '余韵',
    };
    return {
        sceneTitle: `${tm.label}·${s.location}`,
        narration,
        dialogues,
        choices: fallbackChoices(s, 0),
        effectsPreview: '（离线兜底·剧情小幕）',
        memoryUpdates: [],
        flagUpdates: {},
        nextSceneHint: '',
        mood: MOOD_BY_TURN[s.turnType],
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

function mapActionResourceDelta(action: PalaceActionType): Partial<StoryResources> {
    switch (action) {
        case 'govern': return { energy: -10, power: 5, reputation: 2, silver: -2 };
        case 'gossip': return { energy: -7, rumor: 8, reputation: -1 };
        case 'gift': return { silver: -8, reputation: 1 };
        case 'rest': return { energy: 18, rumor: -2 };
        case 'chapter': return { energy: -12, power: 3, reputation: 3, rumor: 2 };
        case 'visit': return { energy: -5 };
        case 'explore':
        default: return { energy: -8, rumor: 5, reputation: 1 };
    }
}

function mapActionProgress(action: PalaceActionType): number {
    switch (action) {
        case 'chapter': return 9;
        case 'govern': return 5;
        case 'explore': return 4;
        case 'gossip': return 3;
        case 'gift': return 2;
        case 'visit': return 2;
        case 'rest': return 1;
        default: return 2;
    }
}

function turnTypeForMapAction(action: PalaceActionType, time: TimeSlot): TurnType {
    if (action === 'visit') return time === '夜' ? 'night_talk' : 'date';
    if (action === 'gossip' || action === 'govern') return 'group';
    if (action === 'gift') return 'date';
    if (action === 'chapter') return 'crisis';
    if (action === 'rest') return time === '夜' ? 'night_talk' : 'daily';
    return 'daily';
}

function sanitizeMapIntent(s: StoryState, intent: StoryMapIntent): StoryMapIntent | null {
    const loc = availableLocations(s).find(l => l.id === intent.locationId);
    if (!loc || !loc.actions.includes(intent.action)) return null;
    return {
        locationId: loc.id,
        action: intent.action,
        label: intent.label || `${loc.name}·${PALACE_ACTION_LABELS[intent.action]}`,
        targetCharId: intent.targetCharId && s.characters[intent.targetCharId] ? intent.targetCharId : undefined,
        note: intent.note ? String(intent.note).slice(0, 80) : undefined,
    };
}

/**
 * 玩家选择 choiceIndex 后落地：套用 effects、连带嫉妒、写记忆/flag、推进时辰、
 * 更新路线与结局进度、定下一回合节奏与登场角色。返回**新** state（currentScene 清空，等待下一轮请求）。
 */
export function applyChoice(s: StoryState, scene: StoryScene, choiceIndex: number, rng: () => number = Math.random): StoryState {
    const choice = scene.choices[choiceIndex] || scene.choices[0];
    if (!choice) return s;
    return resolveTurn(s, scene, choice, rng, {});
}

/**
 * 自由行动（自陈心意）：玩家不选既定选项，直接输入一段想做的事。
 * 侦测其中点名的角色 → 作为下一场焦点（主动择幸）；动作本身以温和效果落地，
 * 真正的后果由下一回合 AI 顺着你的意图铺陈。
 */
export function applyCustomAction(s: StoryState, scene: StoryScene, actionText: string, rng: () => number = Math.random): StoryState {
    const text = (actionText || '').trim().slice(0, 120);
    if (!text) return s;
    let focus: string | null = null;
    for (const c of allChars(s)) if (c.name && text.includes(c.name)) { focus = c.charId; break; }
    const target = (focus && s.characters[focus]) ? focus : (s.activeCharacters[0] || Object.keys(s.characters)[0]);
    const choice: StoryChoice = {
        text, tone: '自陈',
        effects: target ? [{ charId: target, affection: 2, trust: 1 }] : [],
        risk: 'mid', nextIntent: text,
    };
    return resolveTurn(s, scene, choice, rng, { custom: true, focus });
}

/** 玩家主动择幸：指定下一场要独处的角色（synthetic 自由行动）。 */
export function visitCharacter(s: StoryState, scene: StoryScene, charId: string, rng: () => number = Math.random): StoryState {
    const c = s.characters[charId];
    if (!c) return s;
    const choice: StoryChoice = { text: `主动去见${c.name}`, tone: '主动', effects: [{ charId, affection: 1 }], risk: 'low', nextIntent: `主动前去与${c.name}独处` };
    return resolveTurn(s, scene, choice, rng, { custom: true, focus: charId });
}

export function applyFavorAction(s: StoryState, scene: StoryScene, input: StoryFavorActionInput, rng: () => number = Math.random): StoryState {
    const preview = previewFavorAction(s, input);
    if (!preview.ok) return s;
    const entry = makeFavorLedgerEntry(s, preview, preview.type, input.note);
    const base: StoryState = {
        ...s,
        relationships: applyFavorRelationshipDeltas(s.relationships, preview.relationshipDelta),
        favorLedger: addFavorLedger(s, entry),
    };
    const choice: StoryChoice = {
        text: preview.actionText,
        tone: '谕旨',
        effects: preview.effects,
        risk: preview.risk,
        nextIntent: preview.nextIntent,
    };
    const syntheticScene: StoryScene = {
        sceneTitle: preview.title,
        narration: preview.message,
        dialogues: [],
        choices: [choice, ...fallbackChoices(base, 1)].slice(0, 3),
        effectsPreview: preview.message,
        memoryUpdates: [{
            text: `你在宠爱经营台落下谕旨：${preview.actionText}。`,
            kind: preview.risk === 'high' ? 'conflict' : 'event',
            weight: preview.risk === 'high' ? 3 : 2,
        }],
        flagUpdates: { last_favor_action: preview.type },
        resourceDelta: preview.resourceDelta,
        objectiveUpdates: [],
        inventoryUpdates: [],
        achievementUpdates: [],
        nextSceneHint: preview.nextIntent,
        mood: preview.risk === 'high' ? '险诏' : preview.risk === 'mid' ? '暗涌' : '安宫',
        turnType: s.turnType,
    };
    return resolveTurn(base, syntheticScene, choice, rng, { custom: true, focus: preview.targetCharIds[0] || null });
}

/** 宫苑地图动作：把当前场景收束为「前往某处做某事」，下一回合由 AI 写该行动的后果。 */
export function applyMapAction(s: StoryState, scene: StoryScene, intent: StoryMapIntent, rng: () => number = Math.random): StoryState {
    const clean = sanitizeMapIntent(s, intent);
    if (!clean) return s;
    const loc = PALACE_LOCATIONS.find(l => l.id === clean.locationId)!;
    const choice: StoryChoice = {
        text: `前往${loc.name}·${PALACE_ACTION_LABELS[clean.action]}`,
        tone: '调度',
        effects: clean.targetCharId ? [{ charId: clean.targetCharId, affection: clean.action === 'gift' ? 3 : 1, trust: clean.action === 'visit' ? 1 : undefined }] : [],
        risk: clean.action === 'gossip' || clean.action === 'chapter' ? 'mid' : 'low',
        nextIntent: clean.note || `${loc.name}${PALACE_ACTION_LABELS[clean.action]}，让剧情围绕此行动展开`,
    };
    return resolveTurn(s, scene, choice, rng, { custom: true, focus: clean.targetCharId || null, mapIntent: clean });
}

function combineJudgementResources(judgement: StoryActionJudgement): Partial<StoryResources> {
    const delta: Partial<StoryResources> = {};
    for (const key of RESOURCE_KEYS) {
        const value = num(judgement.cost?.[key], 0) + num(judgement.reward?.[key], 0);
        if (value) delta[key] = value;
    }
    return sanitizeResourceDelta(delta);
}

export function applyActionJudgement(
    s: StoryState,
    scene: StoryScene,
    judgement: StoryActionJudgement,
    rng: () => number = Math.random,
): StoryState {
    if (!judgement || !judgement.actionText) return s;
    let base = mergeActionContent({ ...s, pendingJudgement: null }, judgement);
    if (judgement.entryPoint === 'favor') {
        const resourceDelta = combineJudgementResources(judgement);
        const entry = makeFavorLedgerEntry(base, {
            title: judgement.title || '自拟谕旨',
            actionText: judgement.actionText,
            risk: judgement.risk,
            resourceDelta,
            effects: judgement.effects,
            relationshipDelta: [],
            targetCharIds: judgement.involvedCharIds,
        }, 'draft', judgement.verdict);
        base = { ...base, favorLedger: addFavorLedger(base, entry) };
    }
    const focus = judgement.mapIntent?.targetCharId || judgement.involvedCharIds.find(id => !!base.characters[id]) || null;
    const choice: StoryChoice = {
        text: judgement.actionText,
        tone: '判词',
        effects: judgement.effects.length ? judgement.effects : (focus ? [{ charId: focus, trust: 1 }] : []),
        risk: judgement.risk,
        nextIntent: judgement.nextIntent || judgement.verdict || judgement.actionText,
    };
    const syntheticScene: StoryScene = {
        sceneTitle: judgement.title || scene.sceneTitle || '宫廷判词',
        narration: judgement.verdict || scene.narration || judgement.actionText,
        dialogues: [],
        choices: [choice, ...fallbackChoices(base, 1)].slice(0, 3),
        effectsPreview: judgement.verdict,
        memoryUpdates: [{
            text: `你依判官所断行事：${judgement.actionText}`,
            kind: judgement.risk === 'high' ? 'conflict' : 'event',
            weight: judgement.risk === 'high' ? 3 : 2,
        }],
        flagUpdates: { last_action_judgement: judgement.id },
        resourceDelta: combineJudgementResources(judgement),
        objectiveUpdates: judgement.objectiveUpdates || [],
        inventoryUpdates: judgement.inventoryUpdates || [],
        achievementUpdates: judgement.achievementUpdates || [],
        nextSceneHint: judgement.nextIntent || judgement.verdict || scene.nextSceneHint || '',
        mood: judgement.risk === 'high' ? '险棋' : judgement.risk === 'low' ? '稳妥' : '暗涌',
        turnType: s.turnType,
    };
    return resolveTurn(base, syntheticScene, choice, rng, { custom: true, focus, mapIntent: judgement.mapIntent || null });
}

function resolveTurn(s: StoryState, scene: StoryScene, choice: StoryChoice, rng: () => number = Math.random, meta: { custom?: boolean; focus?: string | null; mapIntent?: StoryMapIntent | null } = {}): StoryState {
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

    // 4.5) 长线玩法：资源 / 线索 / 成就（AI 建议 + 地图动作，均经白名单钳制）
    let resources = applyResourceDelta(s.resources || DEFAULT_RESOURCES, scene.resourceDelta || {});
    if (meta.mapIntent) resources = applyResourceDelta(resources, mapActionResourceDelta(meta.mapIntent.action));
    let inventory = mergeInventory(s.inventory || [], scene.inventoryUpdates || [], s.day);
    let achievements = [...(s.achievements || [])];
    for (const a of sanitizeAchievementUpdates(scene.achievementUpdates || [])) {
        if (!achievements.some(x => x.id === a.id)) achievements.unshift({ ...a, unlockedAt: Date.now() });
    }

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

    // 7) 离心 / 回心：嫉妒爆表又久遭冷落 → 心灰意冷淡出；若重获信任与好心情 → 回心转意
    for (const c of Object.values(characters)) {
        if (!c.estranged && c.jealousy >= 95 && c.mood <= 18 && c.trust < 25) {
            c.estranged = true;
            memories.unshift({ id: sid(), day: s.day, text: `${c.name} 心灰意冷，渐渐疏远了你。`, weight: 4, kind: 'conflict', charId: c.charId });
        } else if (c.estranged && c.trust >= 42 && c.mood >= 46) {
            c.estranged = false;
            memories.unshift({ id: sid(), day: s.day, text: `${c.name} 心结渐解，又愿意亲近你了。`, weight: 4, kind: 'event', charId: c.charId });
        }
    }

    // 8) 态度/阶段重算
    for (const c of Object.values(characters)) recomputeChar(c);

    // 9) 登场公平：在场者 streak 清零，未登场者 +1
    for (const c of Object.values(characters)) c.presentStreak = s.activeCharacters.includes(c.charId) ? 0 : c.presentStreak + 1;

    // 10) 角色之间的羁绊随同场/嫉妒演化
    const relationships = updateRelationships(s.relationships, characters, s.activeCharacters);

    // 9) 历史（⑧延续）
    const history: StoryHistoryEntry[] = [
        { day: s.day, time: s.time, location: s.location, turnType: s.turnType, sceneTitle: scene.sceneTitle, choiceText: choice.text, tone: choice.tone, nextIntent: choice.nextIntent },
        ...s.history,
    ].slice(0, HISTORY_CAP);

    // 10) 推进时辰
    const { time, day } = advanceTime(s.time, s.day);

    // 10.5) 宫苑地图：记录访问，给下一幕保留一次探索意图
    const map = normalizeMap(s.map, day, s.chapter?.index || 1);
    if (meta.mapIntent) {
        map.lastLocationId = meta.mapIntent.locationId;
        map.visited = { ...map.visited, [meta.mapIntent.locationId]: num(map.visited[meta.mapIntent.locationId], 0) + 1 };
    }

    // 组装中间态
    let mid: StoryState = {
        ...s, characters, memories, flags, route, relationships, history, time, day,
        resources,
        inventory,
        achievements,
        map,
        currentScene: null,
        lastTurn: { choiceText: choice.text, tone: choice.tone, nextIntent: choice.nextIntent, custom: meta.custom },
        // 主动择幸：把焦点临时放进 state，供下一回合判定/调度读取（用后即清）
        focusHint: meta.focus ?? s.focusHint ?? null,
        mapIntent: meta.mapIntent ?? null,
        turnCount: s.turnCount + 1,
    };

    // 11) 目标 / 章节 / 成就进度
    const passiveProgress = 2 + (s.turnType === 'crisis' ? 2 : 0) + (s.turnType === 'breakthrough' ? 2 : 0) + (meta.mapIntent ? mapActionProgress(meta.mapIntent.action) : 0);
    mid = advanceObjectives(mid, scene.objectiveUpdates || [], passiveProgress);
    mid = advanceChapter(mid);
    mid = achievementSweep(mid);

    // 12) 结局进度
    mid.endingProgress = computeEndingProgress(mid);

    // 13) 下一回合：类型 → 登场 → 地点（地图动作优先；focusHint 用后清空，mapIntent 保留给下一次 AI prompt）
    const nextType = meta.mapIntent ? turnTypeForMapAction(meta.mapIntent.action, mid.time) : determineTurnType(mid, rng);
    mid.turnType = nextType;
    mid.activeCharacters = meta.mapIntent?.targetCharId
        ? [meta.mapIntent.targetCharId]
        : scheduleCast(mid, nextType, rng);
    mid.location = meta.mapIntent
        ? (PALACE_LOCATIONS.find(l => l.id === meta.mapIntent?.locationId)?.name || pickLocation(nextType, rng))
        : pickLocation(nextType, rng);
    mid.focusHint = null;

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

const estrangedCount = (s: StoryState): number => allChars(s).filter(c => c.estranged).length;
const finaleWindow = (s: StoryState): boolean => s.day >= 60 || !!s.chapter?.finaleReady;

export const ENDING_DEFS: EndingDef[] = [
    {
        key: 'jealousy_ruin', label: '醋海覆舟', tone: 'bad', priority: 90,
        blurb: '善妒成灾，后宫倾覆。爱到极处反成刀，一段孽缘以玉石俱焚收场。',
        test: s => allChars(s).some(c => c.jealousy >= 96 && c.trust < 40) && s.day >= 20,
        score: s => { const m = Math.max(0, ...allChars(s).map(c => c.jealousy >= 96 ? 100 : c.jealousy)); return clamp100(m); },
    },
    {
        key: 'estranged_collapse', label: '人心尽失', tone: 'bad', priority: 85,
        blurb: '众叛亲离，宫阙空余冷月。你冷落了太多人，到头来身边一个不剩。',
        test: s => { const n = allChars(s).length; return n >= 2 && estrangedCount(s) >= Math.max(2, Math.ceil(n / 2)) && s.day >= 30; },
        score: s => { const n = allChars(s).length; return n ? clamp100((estrangedCount(s) / n) * 130) : 0; },
    },
    {
        key: 'cold_lonely', label: '孤家寡人', tone: 'bad', priority: 80,
        blurb: '人心渐离，宫阙生寒。坐拥满宫却无一人交心，终是孤家寡人。',
        test: s => s.day >= 45 && allChars(s).length > 0 && allChars(s).every(c => c.affection <= 32),
        score: s => { const chars = allChars(s); if (!chars.length) return 0; const avg = chars.reduce((a, c) => a + c.affection, 0) / chars.length; return clamp100((40 - avg) * 2.5); },
    },
    {
        key: 'true_love', label: '一生一世一双人', tone: 'true', priority: 70,
        blurb: '弱水三千只取一瓢。独许一人、患难与共，终成神仙眷侣。',
        test: s => { const t = s.route.locked && s.route.charId ? s.characters[s.route.charId] : null; return !!t && t.affection >= 88 && t.trust >= 80 && t.jealousy <= 35 && finaleWindow(s); },
        score: s => { const t = s.route.locked && s.route.charId ? s.characters[s.route.charId] : topChar(s); if (!t) return 0; return clamp100((t.affection * 0.6 + t.trust * 0.4) * (s.route.locked ? 1 : 0.7)); },
    },
    {
        key: 'imperial_pact', label: '凤阙定鼎', tone: 'true', priority: 65,
        blurb: '你稳住宫权与人心，让椒房不再只是情爱之所，也成了一座可托付的宫阙。',
        test: s => finaleWindow(s) && s.chapter?.index >= 8 && s.resources.power >= 70 && s.resources.reputation >= 65 && s.resources.energy >= 25,
        score: s => clamp100((s.resources.power * 0.45) + (s.resources.reputation * 0.4) + Math.max(0, 100 - s.resources.rumor) * 0.15),
    },
    {
        key: 'harem', label: '众芳同辉', tone: 'harem', priority: 60,
        blurb: '雨露均沾，满宫佳人皆得其所。一段众星拱月、各得圆满的后宫佳话。',
        test: s => { const hi = allChars(s).filter(c => c.affection >= 70); return hi.length >= 3 && allChars(s).every(c => c.jealousy <= 50) && finaleWindow(s) && !s.route.locked; },
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
    if (!finaleWindow(s)) return ENDING_DEFS.find(d => d.key === 'open') || null;
    // 非硬条件：到了 ending 回合也得给个结局——按分数挑最高的，否则 open
    const ranked = ENDING_DEFS.filter(d => d.key !== 'open').map(d => ({ d, sc: d.score(s) })).sort((a, b) => b.sc - a.sc);
    if (ranked[0] && ranked[0].sc >= 50) return ranked[0].d;
    return ENDING_DEFS.find(d => d.key === 'open') || null;
}

// ── 结局叙述（AI 收尾 + 兜底） ───────────────────────────────────────────────
export interface StoryEnding { key: string; label: string; tone: EndingDef['tone']; title: string; epilogue: string; fates: { name: string; line: string }[]; }

export function buildStoryEndingPrompt(s: StoryState, def: EndingDef): { system: string; user: string } {
    const roster = sortByAff(allChars(s)).map(c => `- ${c.name}（${c.gender === 'unknown' ? '性别依人设' : GENDER_WORD[c.gender]}，${stageOf(c.affection).label}，好感${c.affection}/信任${c.trust}/嫉妒${c.jealousy}${c.estranged ? '，已离心' : ''}）`).join('\n');
    const keyMems = s.memories.slice(0, 6).map(m => m.text).join('；');
    const system = '你为一段古风宫廷恋爱故事写「结局尾声」。文笔古雅含蓄、有余韵，扣住给定的结局基调与人物数据，不要新增冲突。注意各角色与主君的性别已标明，称谓须相称，不要默认性别。';
    const user = `主君是「${playerIdentity(s)}」。这段宫闱情缘历经 ${s.day} 日。结局基调：「${def.label}」——${def.blurb}\n`
        + `诸位现状：\n${roster}\n`
        + (keyMems ? `一路记得的事：${keyMems}\n` : '')
        + `\n请只输出一个 JSON（不要解释、不要代码块）：\n{"title":"结局标题(≤12字)","epilogue":"尾声正文(120~200字，第二人称称呼主君)","fates":[{"name":"角色名","line":"ta的结局定语(≤24字)"}]}`;
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
            ? `历 ${s.day} 日，六宫安和，满宫佳人各得其所。你坐拥盈盈春色，亦守得一宫人心，传为佳话。`
            : def.key === 'jealousy_ruin'
                ? `历 ${s.day} 日，醋海翻波，终成大祸。爱到极处反成刀，繁华一夜倾覆，徒留满地狼藉。`
                : def.key === 'imperial_pact'
                    ? `历 ${s.day} 日，你以宫权镇风雨，以声望定人心。椒房从此不只记情爱，也记一场被你亲手扶稳的宫阙长卷。`
                : def.key === 'estranged_collapse'
                    ? `历 ${s.day} 日，你冷落了太多人，一个个心灰意冷地离你而去。到头来众叛亲离，空荡宫阙只剩冷月相照。`
                    : def.key === 'cold_lonely'
                        ? `历 ${s.day} 日，人心渐离。坐拥满宫佳丽，却无一人愿与你交心，到头来不过孤家寡人。`
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

/** 用继承包开下一周目（角色种子由 app 层重新提供，可与上盘相同或不同）。沿用上盘的叙事设定。 */
export function startNewGamePlus(prev: StoryState, seeds: StorySeed[], player?: { name: string; title?: string; gender?: Gender; persona?: string }): StoryState {
    return initStory(seeds, player || prev.player, buildCarry(prev), prev.settings);
}

// ════════════════════════════════════════════════════════════════════════════
//  存档读档辅助（多档由 app 层管理；这里给「打包/校验」）
// ════════════════════════════════════════════════════════════════════════════

export interface StorySaveMeta {
    day: number;
    time: TimeSlot;
    turn: number;
    playthrough: number;
    topName: string;
    routeName: string | null;
    chapterTitle: string;
    mainProgress: number;
    resourceSummary: string;
    ts: number;
}

export function saveMetaOf(s: StoryState): StorySaveMeta {
    const top = topChar(s);
    return {
        day: s.day, time: s.time, turn: s.turnCount, playthrough: s.playthrough,
        topName: top?.name || '—',
        routeName: s.route.charId && s.characters[s.route.charId] ? s.characters[s.route.charId].name : null,
        chapterTitle: s.chapter?.title || '初入椒房',
        mainProgress: s.chapter ? clamp100((s.chapter.progress / Math.max(1, s.chapter.goal)) * 100) : 0,
        resourceSummary: resourcesBlock(s),
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
                charId: id, name: String(c0.name || id), avatar: String(c0.avatar || ''),
                gender: (c0.gender === 'male' || c0.gender === 'female') ? c0.gender : 'unknown',
                persona: c0.persona,
                affection: clamp100(num(c0.affection, 30)), trust: clamp100(num(c0.trust, 35)),
                jealousy: clamp100(num(c0.jealousy, 10)), mood: clamp100(num(c0.mood, 60)),
                attitude: String(c0.attitude || ''), stage: String(c0.stage || ''),
                memories: Array.isArray(c0.memories) ? c0.memories : [],
                presentStreak: num(c0.presentStreak, 0),
                estranged: !!c0.estranged, secret: c0.secret,
                flags: c0.flags && typeof c0.flags === 'object' ? c0.flags : {},
            };
            recomputeChar(characters[id]);
        }
        const revivedDay = num(raw.day, 1);
        const revivedTime: TimeSlot = TIME_SLOTS.includes(raw.time) ? raw.time : '晨';
        const inferredChapterIndex = [...CHAPTER_DEFS].reverse().find(c => revivedDay >= c.minDay)?.index || 1;
        const rawChapterIndex = clampN(num(raw.chapter?.index, inferredChapterIndex), 1, CHAPTER_DEFS.length);
        const chapter = makeChapter(rawChapterIndex, num(raw.chapter?.progress, 0));
        chapter.completed = !!raw.chapter?.completed || chapter.progress >= chapter.goal;
        chapter.finaleReady = !!raw.chapter?.finaleReady || (chapter.index >= CHAPTER_DEFS.length && revivedDay >= 60 && chapter.progress >= Math.min(chapter.goal, 50));
        const resources = normalizeResources(raw.resources);
        const rawObjectives = Array.isArray(raw.objectives) ? raw.objectives : [];
        const objectives: StoryObjective[] = rawObjectives.length
            ? rawObjectives.map((o: any) => ({
                id: String(o.id || sid()),
                kind: o.kind === 'side' ? 'side' : 'main',
                title: String(o.title || '未名目标').slice(0, 40),
                description: String(o.description || '').slice(0, 120),
                target: clampN(num(o.target, 10), 1, 999),
                progress: clampN(num(o.progress, 0), 0, clampN(num(o.target, 10), 1, 999)),
                done: !!o.done,
                chapterId: o.chapterId ? String(o.chapterId) : undefined,
                reward: o.reward && typeof o.reward === 'object' ? sanitizeResourceDelta(o.reward) : undefined,
            }))
            : defaultObjectives(chapter);
        if (!objectives.some(o => o.id === mainObjectiveId(chapter.id))) objectives.unshift(makeMainObjective(chapter));
        const inventory: StoryInventoryItem[] = Array.isArray(raw.inventory)
            ? raw.inventory.slice(0, 60).map((it: any) => ({
                id: String(it.id || sid()),
                name: String(it.name || '无名线索').slice(0, 24),
                kind: INVENTORY_KINDS.has(it.kind) ? it.kind : 'clue',
                text: String(it.text || '').slice(0, 120),
                day: num(it.day, revivedDay),
                charId: it.charId && characters[it.charId] ? String(it.charId) : undefined,
                source: it.source ? String(it.source).slice(0, 40) : undefined,
            }))
            : [];
        const achievements: StoryAchievement[] = Array.isArray(raw.achievements)
            ? raw.achievements.slice(0, 80).map((a: any) => ({
                id: String(a.id || sid()),
                title: String(a.title || a.id || '无名印记').slice(0, 24),
                description: String(a.description || '').slice(0, 80),
                unlockedAt: num(a.unlockedAt, Date.now()),
            }))
            : [];
        const s: StoryState = {
            version: STORY_VERSION,
            playthrough: num(raw.playthrough, 1),
            player: { name: String(raw.player?.name || '君'), title: String(raw.player?.title || '君上'), gender: (raw.player?.gender === 'male' || raw.player?.gender === 'female') ? raw.player.gender : 'unknown', persona: raw.player?.persona },
            settings: raw.settings && typeof raw.settings === 'object'
                ? { style: String(raw.settings.style || DEFAULT_SETTINGS.style), heat: clampN(num(raw.settings.heat, 1), 0, 3), pace: String(raw.settings.pace || DEFAULT_SETTINGS.pace), premise: raw.settings.premise ? String(raw.settings.premise).slice(0, 400) : undefined }
                : { ...DEFAULT_SETTINGS },
            day: revivedDay, time: revivedTime,
            location: String(raw.location || '椒房殿'),
            turnType: (TURN_META[raw.turnType as TurnType] ? raw.turnType : 'daily'),
            turnCount: num(raw.turnCount, 0),
            currentScene: raw.currentScene && typeof raw.currentScene === 'object' ? raw.currentScene : null,
            activeCharacters: Array.isArray(raw.activeCharacters) ? raw.activeCharacters.filter((id: any) => characters[id]) : Object.keys(characters).slice(0, 1),
            characters,
            relationships: Array.isArray(raw.relationships) ? raw.relationships : [],
            chapter,
            objectives,
            resources,
            map: normalizeMap(raw.map, revivedDay, chapter.index),
            inventory,
            achievements,
            mapIntent: raw.mapIntent && typeof raw.mapIntent === 'object' ? sanitizeMapIntent({ day: revivedDay, chapter, map: normalizeMap(raw.map, revivedDay, chapter.index), characters, favorLedger: [] } as unknown as StoryState, raw.mapIntent) : null,
            generatedHooks: [],
            rumors: [],
            npcStubs: [],
            pendingJudgement: null,
            favorLedger: [],
            memories: Array.isArray(raw.memories) ? raw.memories : [],
            flags: raw.flags && typeof raw.flags === 'object' ? raw.flags : {},
            history: Array.isArray(raw.history) ? raw.history : [],
            route: raw.route && typeof raw.route === 'object' ? { locked: !!raw.route.locked, charId: raw.route.charId || null, progress: num(raw.route.progress, 0) } : { locked: false, charId: null, progress: 0 },
            endingProgress: raw.endingProgress && typeof raw.endingProgress === 'object' ? raw.endingProgress : {},
            lastTurn: raw.lastTurn && typeof raw.lastTurn === 'object' ? raw.lastTurn : null,
            focusHint: raw.focusHint && characters[raw.focusHint] ? raw.focusHint : null,
            carry: raw.carry && typeof raw.carry === 'object' ? raw.carry : null,
            createdAt: num(raw.createdAt, Date.now()),
        };
        // 旧档无角色间羁绊 → 补全 pairwise（bond 0）
        if (!s.relationships.length && Object.keys(characters).length >= 2) {
            const ids = Object.keys(characters);
            for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) s.relationships.push({ a: ids[i], b: ids[j], bond: 0 });
        }
        if (!s.activeCharacters.length) s.activeCharacters = Object.keys(characters).slice(0, 1);
        s.generatedHooks = (Array.isArray(raw.generatedHooks) ? raw.generatedHooks : [])
            .map((h: any) => sanitizeGeneratedHook(h, s, h?.source || 'scene'))
            .filter(Boolean) as StoryGeneratedHook[];
        s.rumors = (Array.isArray(raw.rumors) ? raw.rumors : [])
            .map((r: any) => sanitizeRumor(r, s, r?.source || 'scene'))
            .filter(Boolean) as StoryRumor[];
        s.npcStubs = (Array.isArray(raw.npcStubs) ? raw.npcStubs : [])
            .map((n: any) => sanitizeNpcStub(n, s, n?.source || 'scene'))
            .filter(Boolean) as StoryNpcStub[];
        s.favorLedger = sanitizeFavorLedger(raw.favorLedger, s);
        const cleaned = expireGeneratedHooks(s);
        s.generatedHooks = cleaned.generatedHooks;
        s.rumors = cleaned.rumors;
        s.npcStubs = cleaned.npcStubs;
        s.endingProgress = computeEndingProgress(s);
        return s;
    } catch { return null; }
}
