/**
 * 好感度加减框架 + 关系系统（来往·偷看心声）。
 * ============================================================================
 * 设计目标（见需求）：
 *  - 给好感度一个「完整的加减框架」，限制角色无故大幅度提升/下降好感。
 *  - 好感只在日常、决定性事件体现：日常大部分时候平稳地上下徘徊（小幅），
 *    只有决定性事件（表白 / 分手 / 求婚 / 重大冲突…）才允许大幅波动。
 *  - 关系由 AI 自动更新，取决于角色好感、设定关系与剧情：
 *      高好感未交往 → 暧昧；提出交往 → 恋人；分手 → 前任；求婚成功 → 未婚夫妻 …
 *  - 约束跳变：日常评估不能凭空把关系从「陌生」拉到「恋人/已婚」，
 *    那些只能由决定性事件（聊天里的表白/求婚指令、求婚界面）落定。
 *
 * 本模块是纯函数 + 常量，不依赖 DB / React，方便在聊天评估、后处理、求婚流程里复用。
 */

import type { CharacterProfile, RelationshipStage, RelationshipState, MarriageState } from '../types';

// ── 好感度框架 ────────────────────────────────────────────────────────────
export const AFFECTION_MIN = 0;
export const AFFECTION_MAX = 100;
export const AFFECTION_NEUTRAL = 50;

/** 日常一次评估允许的最大变化（平稳徘徊） */
export const AFFECTION_DAILY_CAP = 5;
/** 决定性事件一次允许的最大变化（大幅波动） */
export const AFFECTION_DECISIVE_CAP = 35;

export const clampAffection = (n: number): number =>
    Math.max(AFFECTION_MIN, Math.min(AFFECTION_MAX, Math.round(n)));

export type AffectionBandKey =
    | 'rejected'
    | 'guarded'
    | 'distant'
    | 'neutral'
    | 'friendly'
    | 'close'
    | 'attached'
    | 'overflowing';

export interface AffectionBand {
    key: AffectionBandKey;
    min: number;
    max: number;
    label: string;
    summary: string;
    tone: string;
}

/**
 * 好感不是“服从度”，而是角色对用户的长期情感余额：
 * 安全感、信任、牵挂、吸引、受伤、防备和人设底色共同组成当前档位。
 */
export const AFFECTION_BANDS: readonly AffectionBand[] = [
    {
        key: 'rejected',
        min: 0,
        max: 14,
        label: '排斥',
        summary: '强烈防备或受伤，优先保护自己，亲近感很低。',
        tone: '冷、短、设边界，可以拒绝、刺回去或不想接话。',
    },
    {
        key: 'guarded',
        min: 15,
        max: 29,
        label: '戒备',
        summary: '仍愿意保持最低限度交流，但信任薄，容易警觉。',
        tone: '客气或疏离，回应有保留，不轻易暴露私心。',
    },
    {
        key: 'distant',
        min: 30,
        max: 44,
        label: '疏离',
        summary: '不讨厌，但距离感明显，关系还没有真正热起来。',
        tone: '可以正常聊天，但少越界，关心多半点到为止。',
    },
    {
        key: 'neutral',
        min: 45,
        max: 54,
        label: '观望',
        summary: '中性偏稳定，态度主要由当下话题和人设决定。',
        tone: '可冷可热，不必主动亲密，也不必刻意疏远。',
    },
    {
        key: 'friendly',
        min: 55,
        max: 69,
        label: '友好',
        summary: '愿意靠近，开始记得对方的小习惯与情绪。',
        tone: '更愿意接话、开玩笑、顺手照顾，但仍有分寸。',
    },
    {
        key: 'close',
        min: 70,
        max: 84,
        label: '亲近',
        summary: '有明显偏爱和信任，会把对方放进自己的生活判断里。',
        tone: '可以护短、吃醋、撒娇、认真谈心，也可以因在意而别扭。',
    },
    {
        key: 'attached',
        min: 85,
        max: 94,
        label: '牵挂',
        summary: '强烈在意与依恋，暧昧、占有欲或长期承诺的冲动开始变重。',
        tone: '情绪更容易被牵动，温柔和拉扯都更有重量。',
    },
    {
        key: 'overflowing',
        min: 95,
        max: 100,
        label: '满溢',
        summary: '感情几乎压不住，但仍受人设、关系和现实阻碍约束。',
        tone: '可以很深情，也可以更害怕失去；不等于无底线顺从。',
    },
] as const;

export function getAffectionBand(affection: number | undefined | null): AffectionBand {
    const value = clampAffection(typeof affection === 'number' && Number.isFinite(affection) ? affection : AFFECTION_NEUTRAL);
    return AFFECTION_BANDS.find(b => value >= b.min && value <= b.max) ?? AFFECTION_BANDS[3];
}

export function affectionBandSummary(affection: number | undefined | null): string {
    const band = getAffectionBand(affection);
    return `${band.label}（${band.min}-${band.max}）：${band.summary}${band.tone ? ` ${band.tone}` : ''}`;
}

export type AffectionEventKind =
    | 'maintain'
    | 'small_warmth'
    | 'remembered_detail'
    | 'thoughtful_care'
    | 'boundary_respected'
    | 'gift_or_takeout'
    | 'heartfelt_apology'
    | 'minor_friction'
    | 'neglect'
    | 'boundary_pressure'
    | 'hurtful_conflict'
    | 'deep_repair'
    | 'confession_accepted'
    | 'confession_rejected'
    | 'betrayal_or_abandonment'
    | 'breakup_or_rupture'
    | 'proposal_commitment';

export interface AffectionEventProfile {
    kind: AffectionEventKind;
    label: string;
    delta: number;
    decisive?: boolean;
    description: string;
    examples: readonly string[];
}

/**
 * 命名事件尺度：把“加几分/扣几分”的魔法数收束成统一语义。
 * 日常事件默认落在 ±1~5；真正改变关系结构的事件才标 decisive，走更宽的收敛上限。
 */
export const AFFECTION_EVENT_PROFILES: readonly AffectionEventProfile[] = [
    {
        kind: 'maintain',
        label: '维持',
        delta: 0,
        description: '素材不足、普通寒暄或情绪没有明显新变化时保持原值。',
        examples: ['简单问候', '没有延续的话题', '角色还在观察'],
    },
    {
        kind: 'small_warmth',
        label: '小温暖',
        delta: 1,
        description: '一次顺手的体贴或合拍回应，让心里略微松动。',
        examples: ['温和问候', '接住玩笑', '轻轻安慰'],
    },
    {
        kind: 'remembered_detail',
        label: '被记住',
        delta: 2,
        description: '用户记得角色的偏好、习惯或旧话题，带来具体的被看见感。',
        examples: ['记得忌口', '提到上次没说完的事', '照顾角色的小癖好'],
    },
    {
        kind: 'thoughtful_care',
        label: '认真照顾',
        delta: 3,
        description: '持续、具体、不过界的关心，能留下明显余温。',
        examples: ['耐心陪伴低落', '主动分担压力', '在需要时出现'],
    },
    {
        kind: 'boundary_respected',
        label: '边界被尊重',
        delta: 3,
        description: '用户看见角色的拒绝或防线，并愿意停下，安全感明显上升。',
        examples: ['没有逼问隐私', '愿意给空间', '认真道歉后不再追击'],
    },
    {
        kind: 'gift_or_takeout',
        label: '投喂/礼物',
        delta: 2,
        description: '日常礼物、外卖或小惊喜。温暖但不自动等于关系质变。',
        examples: ['给角色点外卖', '送普通礼物', '顺手带一杯喜欢的饮料'],
    },
    {
        kind: 'heartfelt_apology',
        label: '真诚道歉',
        delta: 3,
        description: '承认伤害、说明改法且不索要立刻原谅，关系可小幅修复。',
        examples: ['明确承认越界', '给出补救方式', '接受角色还会不舒服'],
    },
    {
        kind: 'minor_friction',
        label: '小摩擦',
        delta: -1,
        description: '语气不合、误会或轻微扫兴，会不舒服但不应立刻崩盘。',
        examples: ['开错玩笑', '短暂冷场', '普通拌嘴'],
    },
    {
        kind: 'neglect',
        label: '被忽视',
        delta: -2,
        description: '角色明确需要回应时被敷衍、遗忘或轻慢，产生失落。',
        examples: ['忘记重要约定', '只顾自己说', '没有回应角色的脆弱'],
    },
    {
        kind: 'boundary_pressure',
        label: '边界受压',
        delta: -3,
        description: '用户继续逼迫、审问或越过角色刚设下的边界。',
        examples: ['追问不想说的隐私', '强迫亲密', '不接受拒绝'],
    },
    {
        kind: 'hurtful_conflict',
        label: '明显刺痛',
        delta: -4,
        description: '这轮互动确实留下伤口，但还未到关系结构断裂。',
        examples: ['羞辱', '恶意试探', '把角色软肋当武器'],
    },
    {
        kind: 'deep_repair',
        label: '深度和解',
        delta: 10,
        decisive: true,
        description: '长期误会或伤害被认真面对，关系结构开始修复。',
        examples: ['说开旧账', '共同处理创伤', '终于互相承认真实在意'],
    },
    {
        kind: 'confession_accepted',
        label: '心意相通',
        delta: 12,
        decisive: true,
        description: '明确表白被接住，亲密关系进入新阶段。',
        examples: ['表白成功', '确认交往', '长久暧昧落地'],
    },
    {
        kind: 'confession_rejected',
        label: '心意落空',
        delta: -8,
        decisive: true,
        description: '重要心意没有被接住，关系需要重新找位置。',
        examples: ['表白被拒', '期待落空', '双方想要的关系不同'],
    },
    {
        kind: 'betrayal_or_abandonment',
        label: '背叛/抛下',
        delta: -18,
        decisive: true,
        description: '信任结构被击穿，可能触发长期防备或关系降级。',
        examples: ['严重欺骗', '关键时刻抛下角色', '公开羞辱或背刺'],
    },
    {
        kind: 'breakup_or_rupture',
        label: '分手/决裂',
        delta: -25,
        decisive: true,
        description: '关系结构明确断开，好感和关系阶段都应进入重估。',
        examples: ['分手', '决裂', '长期积怨爆发后断联'],
    },
    {
        kind: 'proposal_commitment',
        label: '终身承诺',
        delta: 20,
        decisive: true,
        description: '求婚、订婚或足以改变未来生活的共同承诺。',
        examples: ['求婚成功', '决定共同生活', '认真谈下长期未来'],
    },
];

export function getAffectionEventProfile(kind: AffectionEventKind): AffectionEventProfile {
    return AFFECTION_EVENT_PROFILES.find(p => p.kind === kind) ?? AFFECTION_EVENT_PROFILES[0]!;
}

export type AffectionShiftKey =
    | 'steady'
    | 'slight_warmup'
    | 'daily_warmup'
    | 'decisive_warmup'
    | 'slight_cooldown'
    | 'daily_cooldown'
    | 'decisive_cooldown';

export interface AffectionShift {
    key: AffectionShiftKey;
    label: string;
    delta: number;
    fromBand: AffectionBand;
    toBand: AffectionBand;
    summary: string;
}

export function describeAffectionShift(prev: number | undefined | null, next: number | undefined | null): AffectionShift {
    const before = clampAffection(typeof prev === 'number' && Number.isFinite(prev) ? prev : AFFECTION_NEUTRAL);
    const after = clampAffection(typeof next === 'number' && Number.isFinite(next) ? next : before);
    const delta = after - before;
    const abs = Math.abs(delta);
    const fromBand = getAffectionBand(before);
    const toBand = getAffectionBand(after);

    let key: AffectionShiftKey = 'steady';
    let label = '维持';
    let summary = '好感维持原状，当前互动不足以改变长期情感余额。';
    if (delta > 0) {
        key = abs <= 2 ? 'slight_warmup' : abs <= AFFECTION_DAILY_CAP ? 'daily_warmup' : 'decisive_warmup';
        label = abs <= 2 ? '微微升温' : abs <= AFFECTION_DAILY_CAP ? '明显升温' : '关系升温';
        summary = abs <= AFFECTION_DAILY_CAP
            ? '这次互动让关系更松动，但仍属于日常可承受的温度变化。'
            : '这次变化已经超过日常微调，应当来自真正改变关系结构的事件。';
    } else if (delta < 0) {
        key = abs <= 2 ? 'slight_cooldown' : abs <= AFFECTION_DAILY_CAP ? 'daily_cooldown' : 'decisive_cooldown';
        label = abs <= 2 ? '微微降温' : abs <= AFFECTION_DAILY_CAP ? '明显降温' : '关系降温';
        summary = abs <= AFFECTION_DAILY_CAP
            ? '这次互动留下不适或刺痛，但仍属于日常范围内的关系波动。'
            : '这次变化已经超过日常微调，应当来自背叛、决裂或深层伤害。';
    }

    return { key, label, delta, fromBand, toBand, summary };
}

export function affectionShiftSummary(prev: number | undefined | null, next: number | undefined | null): string {
    const shift = describeAffectionShift(prev, next);
    const sign = shift.delta > 0 ? '+' : '';
    return `${shift.label}（${sign}${shift.delta}）：${shift.fromBand.label} → ${shift.toBand.label}。${shift.summary}`;
}

/**
 * 把「模型给出的好感绝对值」经框架收敛成实际落地值。
 * - 首次评估（prev 为空）：直接采用模型基准值。
 * - 之后：只允许在上一值基础上小幅变化；超出的部分被截断。
 *   decisive=true（决定性事件）时放宽到 DECISIVE_CAP。
 */
export function applyAffectionEval(
    prev: number | undefined,
    proposed: number,
    opts: { decisive?: boolean } = {},
): number {
    const target = clampAffection(proposed);
    if (typeof prev !== 'number' || !Number.isFinite(prev)) return target;
    const cap = opts.decisive ? AFFECTION_DECISIVE_CAP : AFFECTION_DAILY_CAP;
    const delta = target - prev;
    const capped = Math.max(-cap, Math.min(cap, delta));
    return clampAffection(prev + capped);
}

/**
 * 事件驱动的好感增减（如：用户为角色点了外卖 +、角色被冷落 -、求婚成功 ++）。
 * delta 会按 decisive 与否截断，避免一次跳太多。
 */
export function applyAffectionDelta(
    prev: number | undefined,
    delta: number,
    opts: { decisive?: boolean } = {},
): number {
    const base = typeof prev === 'number' && Number.isFinite(prev) ? prev : AFFECTION_NEUTRAL;
    const cap = opts.decisive ? AFFECTION_DECISIVE_CAP : AFFECTION_DAILY_CAP;
    const capped = Math.max(-cap, Math.min(cap, delta));
    return clampAffection(base + capped);
}

export function applyAffectionEvent(
    prev: number | undefined,
    kind: AffectionEventKind,
    opts: { delta?: number; decisive?: boolean } = {},
): number {
    const profile = getAffectionEventProfile(kind);
    const delta = typeof opts.delta === 'number' && Number.isFinite(opts.delta) ? opts.delta : profile.delta;
    const decisive = opts.decisive ?? !!profile.decisive;
    return applyAffectionDelta(prev, delta, { decisive });
}

// ── 关系系统 ──────────────────────────────────────────────────────────────
/** 亲密度递进顺序（越大越亲密；ex / estranged 是“断裂”分支，单列） */
const STAGE_RANK: Record<RelationshipStage, number> = {
    stranger: 0,
    acquaintance: 1,
    friend: 2,
    close: 3,
    crush: 4,
    lover: 5,
    engaged: 6,
    married: 7,
    ex: -1,
    estranged: -2,
};

/** 关系阶段默认展示名（AI 没给 label 时兜底） */
export const STAGE_DEFAULT_LABEL: Record<RelationshipStage, string> = {
    stranger: '陌生人',
    acquaintance: '认识的人',
    friend: '朋友',
    close: '好友',
    crush: '暧昧',
    lover: '恋人',
    engaged: '未婚夫妻',
    married: '已婚',
    ex: '前任',
    estranged: '形同陌路',
};

/**
 * 关系网可视化元数据：每个阶段的连线/光环配色 + 亲密度（决定节点离用户的远近）。
 * 亲密度大致沿用 STAGE_RANK，但 ex/estranged 这类「断裂」分支按「当下疏远」处理，排到外圈。
 */
export const STAGE_NETWORK_META: Record<RelationshipStage, { color: string; intimacy: number }> = {
    stranger:     { color: '#cbd5e1', intimacy: 0 },
    acquaintance: { color: '#94a3b8', intimacy: 1 },
    friend:       { color: '#60a5fa', intimacy: 2 },
    close:        { color: '#34d399', intimacy: 3 },
    crush:        { color: '#f9a8d4', intimacy: 4 },
    lover:        { color: '#ec4899', intimacy: 5 },
    engaged:      { color: '#fb7185', intimacy: 6 },
    married:      { color: '#f59e0b', intimacy: 7 },
    ex:           { color: '#d4b8c4', intimacy: 1 },
    estranged:    { color: '#a8a29e', intimacy: 0 },
};

/** 连线是否用虚线（暧昧 / 断裂分支用虚线，表示「不稳定」或「已断」）。 */
export const STAGE_DASHED: ReadonlySet<RelationshipStage> = new Set(['crush', 'ex', 'estranged']);

/** “决定性事件才能进入”的关系（日常评估不可凭空设定） */
const DECISIVE_ONLY: ReadonlySet<RelationshipStage> = new Set([
    'lover', 'engaged', 'married', 'ex', 'estranged',
]);

/** 求婚成功才能进入；普通评估 / 表白都不可直接设 */
const PROPOSAL_ONLY: ReadonlySet<RelationshipStage> = new Set(['engaged', 'married']);

export const isRelationshipStage = (s: any): s is RelationshipStage =>
    typeof s === 'string' && s in STAGE_RANK;

export const defaultRelationship = (): RelationshipState => ({
    stage: 'stranger',
    label: STAGE_DEFAULT_LABEL.stranger,
    since: Date.now(),
    updatedAt: Date.now(),
});

/**
 * 仅凭好感推断「未确立明确关系」时的默认阶段——用于日常评估的兜底，
 * 不会覆盖已由剧情/求婚锁定的恋人/订婚/已婚/前任/决裂状态。
 */
export function inferStageFromAffection(affection: number | undefined): RelationshipStage {
    const a = typeof affection === 'number' ? affection : AFFECTION_NEUTRAL;
    if (a >= 90) return 'crush';   // 高好感未交往 → 暧昧
    if (a >= 70) return 'close';
    if (a >= 45) return 'friend';
    if (a >= 20) return 'acquaintance';
    return 'stranger';
}

/** 当前关系是否处于“剧情锁定”态（恋人及以上 / 断裂分支），日常评估不应擅自改动 */
export function isLockedRelationship(stage: RelationshipStage | undefined): boolean {
    if (!stage) return false;
    return DECISIVE_ONLY.has(stage);
}

/**
 * 收敛 AI 在「日常评估」里提出的关系更新，避免无理跳变：
 * - engaged / married 只能靠求婚成功 / 领证落定，评估一律拒绝。
 * - lover / ex / estranged 只能靠决定性事件（表白/分手/重大冲突）落定；
 *   非 decisive 的评估若提出这些，则退回到由好感推断的「暧昧/朋友」等安全态。
 * - 已处于恋人及以上时，日常评估保持原状（除非 decisive 明确降级）。
 * 返回 null 表示“维持原状”。
 */
export function sanitizeRelationshipUpdate(
    prev: RelationshipState | undefined,
    proposedStage: RelationshipStage,
    proposedLabel: string | undefined,
    affection: number | undefined,
    opts: { decisive?: boolean } = {},
): { stage: RelationshipStage; label: string } | null {
    const prevStage = prev?.stage;
    const decisive = !!opts.decisive;

    // 求婚/领证专属阶段：日常链路永不设定
    if (PROPOSAL_ONLY.has(proposedStage)) return null;

    let stage = proposedStage;

    // 已锁定恋人及以上：日常评估不许擅自改；只有 decisive 才能降级到 ex/estranged
    if (isLockedRelationship(prevStage) && !decisive) {
        return null;
    }

    // 非决定性评估却想进入 lover/ex/estranged：退回安全态（按好感推断）
    if (!decisive && DECISIVE_ONLY.has(stage)) {
        stage = inferStageFromAffection(affection);
    }

    if (prevStage === stage) {
        // 阶段没变，但 label 可能更贴切——允许仅更新 label
        if (proposedLabel && proposedLabel.trim() && proposedLabel.trim() !== prev?.label) {
            return { stage, label: proposedLabel.trim().slice(0, 12) };
        }
        return null;
    }

    const label = (proposedLabel && proposedLabel.trim()) ? proposedLabel.trim().slice(0, 12) : STAGE_DEFAULT_LABEL[stage];
    return { stage, label };
}

/** 生成一个新的 RelationshipState（带变更简史），用于落库 patch。 */
export function buildRelationshipState(
    prev: RelationshipState | undefined,
    stage: RelationshipStage,
    label: string,
    reason?: string,
): RelationshipState {
    const now = Date.now();
    const history = prev?.history ? [...prev.history] : [];
    if (prev && prev.stage !== stage) {
        history.unshift({ stage: prev.stage, label: prev.label, at: prev.updatedAt || now, reason });
    }
    return {
        stage,
        label: label.slice(0, 12),
        since: prev && prev.stage === stage ? prev.since : now,
        updatedAt: now,
        history: history.slice(0, 20),
    };
}

/**
 * 求婚成功是否允许：角色满好感 100 且当前处于暧昧/恋人（“想更进一步”的前提），
 * 且尚未订婚/已婚。用于回形针「求婚」按钮的可用性与指令校验。
 */
export function canPropose(char: Pick<CharacterProfile, 'affection' | 'relationship' | 'marriage'>): boolean {
    if (char.marriage?.active) return false;
    const stage = char.relationship?.stage;
    if (stage === 'engaged' || stage === 'married') return false;
    if ((char.affection ?? 0) < AFFECTION_MAX) return false;
    // 满好感时若关系还停留在朋友及以下，先让它走到「暧昧」更自然——这里放宽到任意非断裂态
    if (stage === 'ex' || stage === 'estranged') return false;
    return true;
}

// ── 婚姻 ───────────────────────────────────────────────────────────────────
export const MARRIAGE_STAGE_LABEL: Record<MarriageState['stage'], string> = {
    engaged: '已订婚 · 筹备中',
    planning: '已定婚期',
    registered: '已领证',
    wed: '已完婚',
};

const genId = (p: string) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

/** 求婚成功 → 初始化婚姻筹备状态（含一条「求婚」里程碑）。 */
export function createMarriageState(proposalBy: 'user' | 'char', proposerName: string): MarriageState {
    const now = Date.now();
    return {
        active: true,
        stage: 'engaged',
        proposalBy,
        engagedAt: now,
        milestones: [{
            id: genId('mm'),
            kind: 'proposal',
            title: `${proposerName}求婚成功 · 我们订婚啦`,
            date: new Date(now).toISOString().slice(0, 10),
            by: proposalBy,
            done: true,
            at: now,
        }],
    };
}

// ── 跨模块事件名（指令 → OSContext 落库） ──────────────────────────────────
/** AI 在聊天里输出 [[REL:...]]：关系决定性变更（表白/分手等） */
export const RELATIONSHIP_EVENT = 'moro-relationship-update';
/** AI 在聊天里输出 [[PROPOSE:...]]：角色主动求婚（生成求婚小卡） */
export const PROPOSAL_EVENT = 'moro-char-propose';
/** AI 在聊天里输出 [[WEDDING_PLAN:...]]：商定婚期 / 领证等婚事推进 */
export const MARRIAGE_PLAN_EVENT = 'moro-marriage-plan';
