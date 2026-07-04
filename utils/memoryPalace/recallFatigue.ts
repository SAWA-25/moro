/**
 * 回忆标本馆 — 召回疲劳 / 习惯化 (Recall Fatigue / Habituation)
 *
 * 解决「角色揪着一件小事不放、把一件事当锚点反复提及」的问题。
 *
 * 仿脑动机：神经系统对**反复出现的同一刺激**会习惯化（habituation）——
 * 第一次很显著，连着出现几次后注意力就让位给新东西了。可现有的检索链路恰恰相反：
 *   - 连续性加权（applyContinuityBoost）：上一轮命中的 tag / 簇成员本轮 ×1.08 / ×1.05
 *   - 情绪启动（applyPriming）：匹配当前 mood 的记忆 ×1.3
 *   - 共激活强化（strengthenCoActivated）：一起被想起的 link 越来越强
 *   - accessCount 越查越高 → 有效重要性越高 → 越容易被晋升/召回
 * 这些机制叠起来会形成正反馈：一条记忆一旦冒头，就倾向于**每一轮都冒头**，
 * 于是角色就像复读机一样反复把同一件小事拎出来当锚点。
 *
 * 这里加一层反向的「疲劳」：用召回回执（recallReceipts）看一条记忆在最近几轮里
 * 被注入了多少次，越频繁罚得越狠（指数衰减），但留一个地板分——
 * 真正高度相关的记忆即便被罚也能压回来，只是不再无脑霸榜。一旦它隔几轮不再出现，
 * 近窗频次掉下去，惩罚自动解除（自愈）。
 *
 * 作用点：检索打分末尾（扩散/启动/连续性/认知引导之后，最终排序之前），见 pipeline.ts。
 */

import type { ScoredMemory } from './types';
import { getRecentInjectionCounts } from './recallReceipts';

/** 回看最近多少轮召回（≈过去 6 轮） */
const FATIGUE_WINDOW = 6;
/** 近窗内出现 ≤ FREE_HITS 次不罚：偶尔重提是正常的，只罚「连着刷屏」 */
const FREE_HITS = 1;
/** 每多被注入一次，分数 × 此系数（指数衰减） */
const HABITUATION_BASE = 0.8;
/** 罚到底也保留这么多：保证真正相关的记忆仍能压回来，只是不再霸榜 */
const FATIGUE_FLOOR = 0.45;

/**
 * 对候选记忆施加召回疲劳惩罚（in-place 改 finalScore）。
 *
 * - 认知节点（origin==='cognition'）：稳定的长期理解，本就该一直在，不习惯化。
 * - 便利贴（pinnedUntil 未过期）：用户主动钉的近期事项，不该被疲劳压掉。
 *
 * @returns 实际被降权的记忆条数（用于调试日志）
 */
export function applyRecallFatigue(results: ScoredMemory[], charId: string): number {
    if (results.length === 0) return 0;
    const counts = getRecentInjectionCounts(charId, FATIGUE_WINDOW);
    if (counts.size === 0) return 0;

    const now = Date.now();
    let penalized = 0;
    for (const r of results) {
        if (r.node.origin === 'cognition') continue;
        if (r.node.pinnedUntil && r.node.pinnedUntil > now) continue;

        const hits = counts.get(r.node.id) || 0;
        const over = hits - FREE_HITS;
        if (over <= 0) continue;

        const factor = Math.max(FATIGUE_FLOOR, Math.pow(HABITUATION_BASE, over));
        r.finalScore *= factor;
        penalized++;
    }
    return penalized;
}
