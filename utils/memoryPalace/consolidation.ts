/**
 * 回忆标本馆 — 巩固 (Consolidation)
 *
 * 模拟短期记忆 → 长期记忆的过程：
 * - 客厅 → 卧室晋升
 * - 艾宾浩斯遗忘曲线
 * - 客厅容量管理
 */

import type { MemoryNode, MemoryRoom } from './types';
import { ROOM_CONFIGS } from './types';
import { MemoryNodeDB } from './db';

// ─── 艾宾浩斯衰减 ────────────────────────────────────

/**
 * effective importance 衰减下限（相对于原始 importance 的比例），按房间分级。
 *
 * 人的记忆里"重大人生事件"（imp=8+）即使过了很久也不会退化成琐事。
 * 但 0.9995/小时 的连续衰减在 140 天后会把 imp=10 压到 ~2，让高重要性
 * 的旧记忆在排序时输给低重要性的近期记忆——这违反了 imp 字段本身的
 * 语义（imp=10 就该永远比 imp=3 更重要）。
 *
 * 加一个 floor：无论衰减多久，effective importance 不会低于
 * importance × FLOOR_RATIO。
 *
 * 按房间分级的原因：
 *   - living_room 是"热缓存"，为日常琐事保留；0.8 floor 允许更多衰减，
 *     让旧琐事真正沉下去。
 *   - bedroom / study / user_room 是 consolidation 晋升后的"长期库"，
 *     进得来本来就是因为重要（imp≥8 立即晋升 / imp≥6 且 >24h 晋升 /
 *     accessCount≥3 晋升），没理由让它们衰减 20%。用 0.9 floor，
 *     对 attic 的"永不衰减"（decayRate=null）保留 10% 差异做区分。
 *   - self_room / attic / windowsill decayRate=null 不经过这里，等效 1.0。
 */
const EFFECTIVE_IMPORTANCE_FLOOR_RATIOS: Record<MemoryRoom, number> = {
    living_room: 0.80,
    bedroom:     0.90,
    study:       0.90,
    user_room:   0.90,
    self_room:   1.00, // 实际因 decayRate=null 不走 floor，仅作完整性
    attic:       1.00,
    windowsill:  1.00,
};

/**
 * 计算有效重要性（考虑时间衰减 + floor）
 *
 * effective = max(importance × decayRate ^ hours, importance × floor_ratio[room])
 * 默认客厅 decayRate = 0.9972 → 1天后 ~93.5%, 7天后 ~62%, 30天后 ~12.7%
 * 不会低于 importance × floor_ratio[room]（0.8 或 0.9）
 */
export function calculateEffectiveImportance(node: MemoryNode, now: number = Date.now()): number {
    const room = node.room;
    const config = ROOM_CONFIGS[room];

    // 永不遗忘的房间（self_room / attic / windowsill）
    if (config.decayRate === null) return node.importance;

    const hours = (now - node.createdAt) / (1000 * 60 * 60);
    if (hours <= 0) return node.importance;

    const decayed = node.importance * Math.pow(config.decayRate, hours);
    const floor = node.importance * EFFECTIVE_IMPORTANCE_FLOOR_RATIOS[room];
    return Math.max(decayed, floor);
}

// ─── 晋升条件 ─────────────────────────────────────────

/**
 * 判断客厅中的记忆是否应晋升到卧室
 *
 * 条件（满足任一即可）：
 * 1. importance ≥ 8 → 立即晋升
 * 2. importance ≥ 6 且 age > 24h → 时间沉淀
 * 3. accessCount ≥ 3 → 频繁访问
 */
export function shouldPromote(node: MemoryNode, now: number = Date.now()): boolean {
    if (node.room !== 'living_room') return false;

    // 条件 1: 高重要性立即晋升
    if (node.importance >= 8) return true;

    // 条件 2: 中等重要性 + 时间沉淀
    const ageHours = (now - node.createdAt) / (1000 * 60 * 60);
    if (node.importance >= 6 && ageHours >= 24) return true;

    // 条件 3: 频繁访问
    if (node.accessCount >= 3) return true;

    return false;
}

// ─── 运行巩固 ─────────────────────────────────────────

export interface ConsolidationResult {
    promoted: string[];   // 晋升的 node IDs
    evicted: string[];    // 因容量淘汰的 node IDs（仅标记，不删除数据）
}

/**
 * 运行巩固过程
 *
 * 1. 检查客厅记忆的晋升条件
 * 2. 满足条件的 → room 改为 bedroom
 * 3. 客厅超容量 → 按 effective importance 最低的标记为已遗忘（移到 attic 而非删除）
 *
 */
export async function runConsolidation(charId: string): Promise<ConsolidationResult> {
    const now = Date.now();
    const result: ConsolidationResult = { promoted: [], evicted: [] };

    // 获取客厅所有记忆
    const livingRoomNodes = await MemoryNodeDB.getByRoom(charId, 'living_room');

    // 1. 晋升检查
    for (const node of livingRoomNodes) {
        if (shouldPromote(node, now)) {
            node.room = 'bedroom';
            await MemoryNodeDB.save(node);
            result.promoted.push(node.id);
            console.log(`⬆️ [Consolidation] Promoted to bedroom: "${node.content.slice(0, 30)}..."`);
        }
    }

    // 2. 容量管理（晋升后重新获取客厅数据）
    const capacity = ROOM_CONFIGS.living_room.capacity;
    if (capacity !== null) {
        const remainingNodes = await MemoryNodeDB.getByRoom(charId, 'living_room');

        if (remainingNodes.length > capacity) {
            // 按 effective importance 排序
            const scored = remainingNodes.map(n => ({
                node: n,
                effective: calculateEffectiveImportance(n, now),
            }));
            scored.sort((a, b) => a.effective - b.effective);

            // 淘汰最低的，直到回到容量内
            const toEvict = scored.slice(0, remainingNodes.length - capacity);
            for (const { node } of toEvict) {
                // 不删除，移到 attic（作为"被遗忘但仍在潜意识中"的记忆）
                node.room = 'attic';
                await MemoryNodeDB.save(node);
                result.evicted.push(node.id);
                console.log(`📦 [Consolidation] Evicted to attic: "${node.content.slice(0, 30)}..."`);
            }
        }
    }

    if (result.promoted.length > 0 || result.evicted.length > 0) {
        console.log(`✅ [Consolidation] ${result.promoted.length} promoted, ${result.evicted.length} evicted`);
    }

    return result;
}
