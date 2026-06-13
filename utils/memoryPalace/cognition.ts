/**
 * Memory Palace — 认知网络（联想增强 + 长期认知）
 * ================================================
 * 在已有的「扩散激活 / 共激活强化」之上，补两层让角色「越聊越合得来」：
 *
 * 1. 【短期 · 工作记忆快照】WorkingMemorySnapshot
 *    每轮检索后，把当前话题命中的记忆聚成一个语义快照（主导 tags / 情绪 / 主题 +
 *    成员 id），存 localStorage。下一轮检索：
 *      - 给「与上轮快照同语义」的记忆一点连续性加权（联想不断线、聚集关联语意）；
 *      - 在记忆注入顶部放一行「此刻的思绪」，让回应顺着同一条联想线走。
 *    它是短期、易变的——每轮覆盖，只留最近一条。
 *
 * 2. 【长期 · 认知节点】origin==='cognition'
 *    反复「一起被想起」(强 link + 高 accessCount) 的记忆簇，说明它们在角色脑子里
 *    已经长在一起、构成了对用户/关系的稳定理解。把这样的簇用 LLM 提炼成一句「认知」，
 *    落 self_room（永不衰减）、origin='cognition'，检索时**置顶注入**、不占常规名额。
 *    认知在认知消化(digestion)收尾时形成，受频次/数量上限约束，避免刷屏与 API 浪费。
 */

import type { MemoryNode, ScoredMemory } from './types';
import { MemoryNodeDB, MemoryLinkDB } from './db';
import { safeFetchJson } from '../safeApi';

// ─── 工作记忆快照（短期） ─────────────────────────────────

export interface WorkingMemorySnapshot {
    charId: string;
    at: number;
    /** 一行主题（取自命中记忆的最高分内容，截断） */
    theme: string;
    /** 主导关键词（命中记忆 tags 词频 Top-N） */
    tags: string[];
    /** 主导情绪 */
    mood?: string;
    /** 簇成员记忆 id（Top-N，用于下一轮连续性） */
    memoryIds: string[];
}

const WM_KEY = (charId: string) => `mp_working_memory_${charId}`;
const WM_TOP_SEED = 8;        // 取命中里前 N 条参与快照统计
const WM_MAX_TAGS = 4;
const WM_MAX_IDS = 6;
/** 连续性加权：与上轮快照同 tag / 同簇成员的记忆，分数小幅上浮（联想连贯，但不喧宾夺主） */
const WM_TAG_BOOST = 1.08;
const WM_ID_BOOST = 1.05;

export function loadWorkingMemory(charId: string): WorkingMemorySnapshot | null {
    try {
        const raw = localStorage.getItem(WM_KEY(charId));
        const parsed = raw ? JSON.parse(raw) : null;
        if (parsed && Array.isArray(parsed.tags) && Array.isArray(parsed.memoryIds)) return parsed;
    } catch { /* ignore */ }
    return null;
}

export function saveWorkingMemory(snap: WorkingMemorySnapshot): void {
    try { localStorage.setItem(WM_KEY(snap.charId), JSON.stringify(snap)); } catch { /* ignore */ }
}

/** 从本轮命中结果聚出一个工作记忆快照（聚集关联语意）。 */
export function buildWorkingMemory(
    charId: string,
    results: ScoredMemory[],
    currentMood?: string,
): WorkingMemorySnapshot | null {
    if (results.length === 0) return null;
    const sorted = [...results].sort((a, b) => b.finalScore - a.finalScore);
    const seed = sorted.slice(0, WM_TOP_SEED).map(r => r.node);

    // 主导 tags：词频统计
    const tagCount = new Map<string, number>();
    for (const n of seed) for (const t of (n.tags || [])) tagCount.set(t, (tagCount.get(t) || 0) + 1);
    const tags = [...tagCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, WM_MAX_TAGS).map(e => e[0]);

    // 主导情绪：优先当前 mood，否则取簇内众数
    let mood = currentMood;
    if (!mood) {
        const moodCount = new Map<string, number>();
        for (const n of seed) if (n.mood) moodCount.set(n.mood, (moodCount.get(n.mood) || 0) + 1);
        mood = [...moodCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    }

    const theme = (seed[0]?.content || '').replace(/\s+/g, ' ').trim().slice(0, 48);
    const memoryIds = seed.slice(0, WM_MAX_IDS).map(n => n.id);
    return { charId, at: Date.now(), theme, tags, mood, memoryIds };
}

/**
 * 用上一轮快照给本轮结果做连续性加权：与上轮同 tag / 同簇成员的记忆分数小幅上浮，
 * 让联想顺着同一条线延续（in-place 修改 finalScore）。
 */
export function applyContinuityBoost(results: ScoredMemory[], prev: WorkingMemorySnapshot | null): void {
    if (!prev) return;
    const prevTags = new Set(prev.tags);
    const prevIds = new Set(prev.memoryIds);
    for (const r of results) {
        let factor = 1;
        if (prevIds.has(r.node.id)) factor *= WM_ID_BOOST;
        if ((r.node.tags || []).some(t => prevTags.has(t))) factor *= WM_TAG_BOOST;
        if (factor !== 1) r.finalScore *= factor;
    }
}

/** 工作记忆注入块：一行「此刻的思绪」，让回应顺着联想线走。 */
export function formatWorkingMemory(snap: WorkingMemorySnapshot | null): string {
    if (!snap || (!snap.theme && snap.tags.length === 0)) return '';
    const tagStr = snap.tags.length > 0 ? `（关键词：${snap.tags.join(' · ')}）` : '';
    const moodStr = snap.mood ? ` · 心绪偏「${snap.mood}」` : '';
    return `🧠 **此刻的思绪**：你的注意力正绕着「${snap.theme || snap.tags.join('、')}」打转${tagStr}${moodStr}。顺着这条思绪自然地接话，不要硬转话题。`;
}

// ─── 长期认知（cognition 节点） ───────────────────────────

export const COGNITION_TAG = '认知';
/** 检索时置顶注入的认知条数上限 */
const COGNITION_MAX_INJECT = 5;
/** 形成认知的门槛 */
const STRONG_LINK = 0.65;        // link strength ≥ 此值视为「长在一起」
const MIN_CLUSTER_SIZE = 3;      // 簇至少 N 个成员
const MIN_CLUSTER_ACCESS = 8;    // 簇成员 accessCount 之和（反复被一起想起）
const SEED_MIN_ACCESS = 3;       // 只从高访问节点出发找簇，控制 IDB 开销
const MAX_NEW_PER_RUN = 2;       // 每次消化最多新形成几条认知（控成本 + 防刷屏）

export interface CognitionLLMConfig { baseUrl: string; apiKey: string; model: string }

function genId(): string { return `mn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; }

/** 已认知过的簇签名（成员 id 排序拼接），避免重复提炼同一簇。 */
const COGNIZED_KEY = (charId: string) => `mp_cognized_clusters_${charId}`;
function loadCognizedSigs(charId: string): Set<string> {
    try {
        const raw = localStorage.getItem(COGNIZED_KEY(charId));
        const arr = raw ? JSON.parse(raw) : [];
        return new Set(Array.isArray(arr) ? arr : []);
    } catch { return new Set(); }
}
function addCognizedSig(charId: string, sig: string): void {
    try {
        const set = loadCognizedSigs(charId);
        set.add(sig);
        // 只留最近 200 条签名，防无限增长
        const arr = [...set].slice(-200);
        localStorage.setItem(COGNIZED_KEY(charId), JSON.stringify(arr));
    } catch { /* ignore */ }
}
const clusterSig = (ids: string[]) => [...ids].sort().join('|');

/** 字符二元组 Jaccard（与 digestion 同款，用于认知内容去重） */
function bigramJaccard(a: string, b: string): number {
    if (a === b) return 1;
    if (a.length < 2 || b.length < 2) return 0;
    const grams = (s: string) => { const set = new Set<string>(); for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2)); return set; };
    const sa = grams(a), sb = grams(b);
    let inter = 0; for (const t of sa) if (sb.has(t)) inter++;
    const union = sa.size + sb.size - inter;
    return union === 0 ? 0 : inter / union;
}

/** 取角色现有的认知节点（origin==='cognition'，未归档）。 */
export async function getCognitionNodes(charId: string): Promise<MemoryNode[]> {
    const all = await MemoryNodeDB.getByCharId(charId);
    return all.filter(n => n.origin === 'cognition' && !n.archived);
}

/** 置顶认知注入块（不占常规 15 名额，越聊越懂 TA）。 */
export async function formatCognitions(charId: string, userName?: string): Promise<string> {
    const nodes = (await getCognitionNodes(charId))
        .sort((a, b) => (b.importance - a.importance) || (b.lastAccessedAt - a.lastAccessedAt))
        .slice(0, COGNITION_MAX_INJECT);
    if (nodes.length === 0) return '';
    const who = userName || 'TA';
    let out = `### 你对${who}的认知（相处中逐渐长成的理解）\n`;
    out += `这些是你在长期相处里慢慢形成、已经稳定下来的判断，会自然体现在你的态度、语气和反应里：\n`;
    for (const n of nodes) out += `- ${n.content}\n`;
    // 认知被读取也算一次访问（强化其稳定性 / 影响排序）
    void Promise.all(nodes.map(n => MemoryNodeDB.touchAccess(n.id))).catch(() => {});
    return out.trim();
}

/**
 * 检测「反复强共激活」的记忆簇：从高访问节点出发，沿 strength ≥ STRONG_LINK 的 link
 * 用并查集聚团，返回满足规模/访问门槛、且未被认知过的簇（成员节点数组）。
 */
async function detectCognitionClusters(charId: string): Promise<MemoryNode[][]> {
    const all = await MemoryNodeDB.getByCharId(charId);
    const nodeMap = new Map(all.map(n => [n.id, n]));
    // 种子：高访问、非认知产物自身
    const seeds = all.filter(n => n.accessCount >= SEED_MIN_ACCESS && n.origin !== 'cognition' && !n.archived);
    if (seeds.length === 0) return [];

    // 并查集
    const parent = new Map<string, string>();
    const find = (x: string): string => {
        let r = x;
        while (parent.get(r) && parent.get(r) !== r) r = parent.get(r)!;
        // 路径压缩
        let c = x;
        while (parent.get(c) && parent.get(c) !== r) { const next = parent.get(c)!; parent.set(c, r); c = next; }
        return r;
    };
    const union = (a: string, b: string) => { parent.set(find(a), find(b)); };
    const ensure = (id: string) => { if (!parent.has(id)) parent.set(id, id); };

    for (const seed of seeds) {
        ensure(seed.id);
        const links = await MemoryLinkDB.getByNodeId(seed.id);
        for (const link of links) {
            if (link.strength < STRONG_LINK) continue;
            const other = link.sourceId === seed.id ? link.targetId : link.sourceId;
            const otherNode = nodeMap.get(other);
            if (!otherNode || otherNode.archived) continue;
            ensure(other);
            union(seed.id, other);
        }
    }

    // 聚团
    const groups = new Map<string, MemoryNode[]>();
    for (const id of parent.keys()) {
        const root = find(id);
        const node = nodeMap.get(id);
        if (!node) continue;
        const arr = groups.get(root) || [];
        arr.push(node);
        groups.set(root, arr);
    }

    const cognized = loadCognizedSigs(charId);
    const clusters: MemoryNode[][] = [];
    for (const members of groups.values()) {
        if (members.length < MIN_CLUSTER_SIZE) continue;
        const totalAccess = members.reduce((s, n) => s + (n.accessCount || 0), 0);
        if (totalAccess < MIN_CLUSTER_ACCESS) continue;
        if (cognized.has(clusterSig(members.map(m => m.id)))) continue;
        clusters.push(members);
    }
    // 访问量高的簇优先
    clusters.sort((a, b) =>
        b.reduce((s, n) => s + n.accessCount, 0) - a.reduce((s, n) => s + n.accessCount, 0));
    return clusters;
}

async function synthesizeCognition(
    charName: string,
    charPersona: string,
    cluster: MemoryNode[],
    llmConfig: CognitionLLMConfig,
    userName?: string,
): Promise<string | null> {
    const who = userName || '对方';
    const lines = cluster
        .sort((a, b) => b.importance - a.importance)
        .slice(0, 8)
        .map((n, i) => `${i + 1}. ${n.content}`)
        .join('\n');
    const systemPrompt = `你是 ${charName}。${charPersona.slice(0, 600)}

下面这几段记忆，在你脑海里总是一起被想起、已经长在了一起：
${lines}

请你以第一人称「我」，把它们背后那个**关于${who}、关于你们关系、或关于你自己的稳定理解**用一句话提炼出来——是你在相处中逐渐确信、会一直影响你态度的那种认知。
要求：① 一句话，40 字以内；② 是「理解/判断」而非复述事件（例：「我渐渐明白，${who}嘴上逞强，其实最怕一个人」）；③ 贴合人设语气。
只输出这一句话，不要引号、不要解释。`;
    try {
        const data = await safeFetchJson(
            `${llmConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${llmConfig.apiKey}` },
                body: JSON.stringify({
                    model: llmConfig.model,
                    messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: '请提炼。' }],
                    temperature: 0.6,
                    max_tokens: 2000,
                    stream: false,
                }),
            },
            2, 0, { appName: '回忆标本馆', charName, purpose: '认知提炼' },
        );
        const reply = (data.choices?.[0]?.message?.content || '').trim();
        // 取第一行非空、剥引号
        const oneLine = reply.split(/\n+/).map((s: string) => s.trim()).find((s: string) => s.length > 0) || '';
        const cleaned = oneLine.replace(/^["“「『]|["”」』]$/g, '').trim();
        return cleaned.length >= 4 ? cleaned.slice(0, 80) : null;
    } catch (e: any) {
        console.warn('🧩 [Cognition] synthesize failed:', e?.message || e);
        return null;
    }
}

/**
 * 形成长期认知：检测强共激活簇 → LLM 提炼 → 落 self_room（origin='cognition'）。
 * 在认知消化(digestion)收尾时调用。返回新形成的认知条数。
 * 新节点 embedded:false，由 digestion 的 vectorizeOrphanedNodes 顺手向量化。
 */
export async function formCognitions(
    charId: string,
    charName: string,
    charPersona: string,
    llmConfig: CognitionLLMConfig,
    userName?: string,
): Promise<number> {
    try {
        const clusters = await detectCognitionClusters(charId);
        if (clusters.length === 0) return 0;

        const existingCognitions = await getCognitionNodes(charId);
        let formed = 0;
        for (const cluster of clusters) {
            if (formed >= MAX_NEW_PER_RUN) break;
            const sig = clusterSig(cluster.map(m => m.id));
            const text = await synthesizeCognition(charName, charPersona, cluster, llmConfig, userName);
            // 不论成功与否都记下簇签名，避免下次反复对同一簇调用 LLM
            addCognizedSig(charId, sig);
            if (!text) continue;
            // 内容去重：与已有认知近似则跳过
            if (existingCognitions.some(c => bigramJaccard(c.content, text) >= 0.7)) continue;

            const node: MemoryNode = {
                id: genId(),
                charId,
                content: text,
                room: 'self_room',
                tags: [COGNITION_TAG, '长期'],
                importance: 8,
                mood: 'peaceful',
                embedded: false,
                createdAt: Date.now(),
                lastAccessedAt: Date.now(),
                accessCount: 0,
                sourceId: cluster[0]?.id ?? null,
                origin: 'cognition',
            };
            await MemoryNodeDB.save(node);
            existingCognitions.push(node);
            formed++;
            console.log(`🧩 [Cognition] formed: "${text}"`);
        }
        return formed;
    } catch (e: any) {
        console.warn('🧩 [Cognition] formCognitions failed:', e?.message || e);
        return 0;
    }
}
