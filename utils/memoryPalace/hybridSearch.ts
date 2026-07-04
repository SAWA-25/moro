/**
 * 回忆标本馆 — 本地文本搜索 + 房间评分
 *
 * 只使用本地 MemoryNode + BM25/关键词评分，不再调用额外检索服务。
 */

import type { MemoryNode, MemoryRoom, ScoredMemory } from './types';
import { MemoryNodeDB } from './db';
import { bm25Search, bm25SearchIndexed, bm25SearchDualRun } from './bm25';
import { bm25Index } from './bm25Index';
import { calculateEffectiveImportance } from './consolidation';

// ─── BM25 灰度开关 ────────────────────────────────────
//
// localStorage 'bm25_mode'：
//   未设置 / 'naive'  → 朴素全量扫描（默认，行为与改造前一致）
//   'indexed'         → 倒排索引版（O(Q×postings)，需 ensureBuilt）
//   'dual'            → 双跑校验：跑两版对比 top K，返回朴素版结果
//
// 灰度路径：默认 naive → 开发/灰度 dual → 验证无 mismatch 切 indexed →
// 一两个版本周期后删除朴素版。
type BM25Mode = 'naive' | 'indexed' | 'dual';
function getBM25Mode(): BM25Mode {
    try {
        const v = localStorage.getItem('bm25_mode');
        if (v === 'indexed' || v === 'dual') return v;
    } catch { /* SSR / 隐私模式 */ }
    return 'naive';
}

// ─── 房间评分权重 ─────────────────────────────────────

interface RoomWeights {
    text: number;
    recency: number;
    importance: number;
}

const ROOM_WEIGHTS: Record<MemoryRoom, RoomWeights> = {
    living_room: { text: 0.50, recency: 0.30, importance: 0.20 },
    bedroom:     { text: 0.60, recency: 0.10, importance: 0.30 },
    study:       { text: 0.55, recency: 0.15, importance: 0.30 },
    user_room:   { text: 0.55, recency: 0.15, importance: 0.30 },
    self_room:   { text: 0.55, recency: 0.15, importance: 0.30 },
    attic:       { text: 0.70, recency: 0.00, importance: 0.30 },
    windowsill:  { text: 0.55, recency: 0.15, importance: 0.30 },
};

const RECENCY_DECAY = 0.999; // per hour

// ─── 熟悉度加成（accessCount）──────────────────────
//
// 设计原则：AI 不该像人一样自然遗忘（遗忘在产品里是 bug），
// 所以 accessCount 不用来"保护记忆不衰减"，而是用来给常被想起的
// 话题一个轻度浮现加成——越熟的话题越容易被想起来。
//
// 公式：familiarity = min(1, (max(0, accessCount - 1))^0.3 / 4)
//   - count=0/1 (从未被检索到) → 0
//   - count=3  →  0.31
//   - count=10 →  0.48
//   - count=100 → 1.0（封顶）
//
// 最终加成：finalScore += FAMILIARITY_WEIGHT * familiarity
// 权重 0.05 —— 足够让熟悉话题冒头，不会压过文本匹配 / importance。
const FAMILIARITY_WEIGHT = 0.05;

function familiarityBonus(accessCount: number): number {
    const n = Math.max(0, (accessCount || 0) - 1);
    if (n === 0) return 0;
    return Math.min(1, Math.pow(n, 0.3) / 4);
}

// ─── 混合搜索 ─────────────────────────────────────────

/**
 * 同次 retrieve 内 K 路搜索共享的预取数据。
 * 由 pipeline 在发起并行搜索前一次性取好，避免 K 倍全量 IDB 扫表。
 */
export interface HybridSearchPrefetch {
    /** 角色全量 MemoryNode（含 archived，由 hybridSearch 内部过滤） */
    allNodes?: MemoryNode[];
}

/**
 * 本地文本搜索：BM25 + 房间评分
 *
 * @param query 查询文本（通常为最近 3 条消息拼接）
 * @param charId 角色 ID
 * @param topK 最终返回数量
 */
export async function hybridSearch(
    query: string,
    charId: string,
    topK: number = 15,
    prefetch?: HybridSearchPrefetch,
): Promise<ScoredMemory[]> {
    // 1. BM25 搜索（排除 archived 节点 —— 它们已被压入 EventBox summary）
    const allNodes = prefetch?.allNodes ?? await MemoryNodeDB.getByCharId(charId);
    const searchableNodes = allNodes.filter(n => !n.archived);

    // 倒排索引按"全量节点"构建（含 archived），unarchive 后立即可搜，
    // 实际过滤交给 bm25SearchIndexed 用 searchableNodes 的 id 集做白名单。
    // ensureBuilt 已存在则秒返。
    const bm25Mode = getBM25Mode();
    if (bm25Mode !== 'naive') {
        bm25Index.ensureBuilt(charId, allNodes);
    }
    const bm25Results =
        bm25Mode === 'indexed' ? bm25SearchIndexed(query, searchableNodes, 30) :
        bm25Mode === 'dual'    ? bm25SearchDualRun(query, searchableNodes, 30) :
                                 bm25Search(query, searchableNodes, 30);

    // 2. 构建 nodeId → scores 映射
    const scoreMap = new Map<string, {
        node: MemoryNode;
        bm25Score: number;
    }>();

    // 归一化 BM25 分数到 0-1
    const maxBm25 = bm25Results.length > 0 ? bm25Results[0].score : 1;

    for (const br of bm25Results) {
        const normalized = maxBm25 > 0 ? br.score / maxBm25 : 0;
        const existing = scoreMap.get(br.node.id);
        if (existing) {
            existing.bm25Score = normalized;
        } else {
            scoreMap.set(br.node.id, {
                node: br.node,
                bm25Score: normalized,
            });
        }
    }

    // 3. 计算文本分数 + 房间评分
    const now = Date.now();
    const results: ScoredMemory[] = [];

    for (const [, entry] of scoreMap) {
        const { node, bm25Score } = entry;

        // 新近度（指数衰减）
        const hoursAgo = (now - node.lastAccessedAt) / (1000 * 60 * 60);
        const recency = Math.pow(RECENCY_DECAY, hoursAgo);

        // 有效重要性（归一化到 0-1）
        const effectiveImp = calculateEffectiveImportance(node, now) / 10;

        // 房间权重
        const weights = ROOM_WEIGHTS[node.room];

        // 老记忆 recency 回收（所有有 recency 权重的房间）：
        //   recency = RECENCY_DECAY^hoursAgo，约 100 天后会降到 0.1 以下，再往后
        //   这个信号对排序几乎无贡献。但房间权重里 recency 份额没归零（living_room 0.30、
        //   study/user_room/self_room/windowsill 0.15、bedroom 0.10），这部分权重
        //   等于白送——同一条记忆 sim/imp 再高也被少算一截。
        //
        //   规则：任意房间 recency < 0.1 时，把 recency 的权重平均分配给文本匹配
        //   和 importance（各 +weights.recency/2），recency 权重归零。这条规则对 attic
        //   天然无影响（它 recency 权重本来就是 0），对其它房间等于"旧记忆时把白送的
        //   权重还给 sim/imp"，让旧而精准的记忆不被衰减吃掉。
        let textW = weights.text;
        let recW = weights.recency;
        let impW = weights.importance;
        if (weights.recency > 0 && recency < 0.1) {
            const redistribute = weights.recency / 2;
            textW += redistribute;
            impW += redistribute;
            recW = 0;
        }

        const baseScore = textW * bm25Score + recW * recency + impW * effectiveImp;

        // 熟悉度加成（轻权重，防止常聊话题沉底）
        const familiarity = familiarityBonus(node.accessCount);
        const roomScore = baseScore + FAMILIARITY_WEIGHT * familiarity;

        results.push({
            node,
            finalScore: roomScore,
            similarity: 0,
            bm25Score,
            roomScore,
        });
    }

    // 6. 按 finalScore 降序
    results.sort((a, b) => b.finalScore - a.finalScore);

    return results.slice(0, topK);
}
