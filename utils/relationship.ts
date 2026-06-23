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
