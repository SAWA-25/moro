import type { CharacterProfile } from '../../types';
import type { MemoryNode, ScoredMemory } from './types';
import { MemoryNodeDB } from './db';

export type CognitiveMemoryMode = NonNullable<CharacterProfile['memoryMode']>;
export type CognitiveMemoryLayer = NonNullable<MemoryNode['cognitiveLayer']>;

export const DEFAULT_MEMORY_MODE: CognitiveMemoryMode = 'cognitive_flow';

export function resolveCharacterMemoryMode(
    char: Pick<CharacterProfile, 'memoryMode' | 'memoryPalaceEnabled'> | null | undefined,
): CognitiveMemoryMode {
    if (!char) return DEFAULT_MEMORY_MODE;
    // Historical false means the user explicitly disabled long-term memory.
    if (char.memoryPalaceEnabled === false || char.memoryMode === 'off') return 'off';
    if (char.memoryMode) return char.memoryMode;
    return DEFAULT_MEMORY_MODE;
}

export function isMemoryFeatureEnabled(
    char: Pick<CharacterProfile, 'memoryMode' | 'memoryPalaceEnabled'> | null | undefined,
): boolean {
    if (!char) return false;
    return resolveCharacterMemoryMode(char) !== 'off';
}

export function isCognitiveFlowMode(
    char: Pick<CharacterProfile, 'memoryMode' | 'memoryPalaceEnabled'> | null | undefined,
): boolean {
    return isMemoryFeatureEnabled(char) && resolveCharacterMemoryMode(char) !== 'classic';
}

export function normalizeMemoryModeDefaults<T extends Pick<CharacterProfile, 'memoryMode' | 'memoryPalaceEnabled'>>(char: T): T {
    if (char.memoryPalaceEnabled === false || char.memoryMode === 'off') {
        return { ...char, memoryMode: 'off', memoryPalaceEnabled: false };
    }
    if (char.memoryMode) {
        return { ...char, memoryPalaceEnabled: char.memoryPalaceEnabled ?? true };
    }
    return { ...char, memoryMode: DEFAULT_MEMORY_MODE, memoryPalaceEnabled: char.memoryPalaceEnabled ?? true };
}

export function getCognitiveMemoryLayer(node: MemoryNode): CognitiveMemoryLayer {
    if (node.cognitiveLayer) return node.cognitiveLayer;
    if (node.origin === 'cognition') return 'saga';
    if (node.isBoxSummary) return 'episode_summary';
    if (node.eventBoxId) return 'episode';
    return 'event';
}

export function isCognitiveFlowPinned(node: MemoryNode, now = Date.now()): boolean {
    if (node.archived || node.internalized) return false;
    if (node.pinnedUntil && node.pinnedUntil > now) return true;
    return !!(node.protected || node.highlight);
}

export function shouldHideFromCognitiveRecall(node: MemoryNode, includeFeel = false): boolean {
    if (node.archived || node.internalized) return true;
    const layer = getCognitiveMemoryLayer(node);
    if (!includeFeel && layer === 'feel') return true;
    // Resolved low-importance events sink out of ordinary recall.
    if (node.resolved && node.importance <= 2) return true;
    return false;
}

export type CognitiveQueryIntent = 'fact' | 'summary' | 'long_term' | 'semantic' | 'emotional';

export function classifyCognitiveQueryIntent(query: string): CognitiveQueryIntent {
    const q = (query || '').toLowerCase();
    if (/(证据|原文|哪句|说过什么|什么时候|几月几号|第\d+天)/.test(q) || /\b(when|where|who|evidence|exact)\b/.test(q)) return 'fact';
    if (/(总结|概括|回顾|发生了什么|那段)/.test(q) || /\b(summary|recap|episode)\b/.test(q)) return 'summary';
    if (/(一直|长期|关系|主线|未来|目标|承诺|约定)/.test(q) || /\b(long.term|saga|goal|promise)\b/.test(q)) return 'long_term';
    if (/(感觉|心情|难过|开心|在意|想念|害怕|委屈)/.test(q) || /\b(feel|mood|emotion)\b/.test(q)) return 'emotional';
    return 'semantic';
}

export function scoreCognitiveWeight(node: MemoryNode, now = Date.now(), intent: CognitiveQueryIntent = 'semantic'): number {
    if (shouldHideFromCognitiveRecall(node, intent === 'emotional')) return 0;
    const layer = getCognitiveMemoryLayer(node);
    const ageHours = Math.max(0, (now - (node.eventTime || node.createdAt || now)) / 3_600_000);
    const recency = 1 / (1 + ageHours / 72);
    const importance = Math.max(1, Math.min(10, node.importance || 5)) / 10;
    const access = Math.min(1, Math.log1p(node.accessCount || 0) / 4);
    const emotion = Math.min(0.2, Math.abs(node.valence ?? 0) * 0.08 + Math.abs(node.arousal ?? 0) * 0.12);
    const statusBoost = (node.highlight ? 0.35 : 0) + (node.protected ? 0.25 : 0);
    const layerBoost =
        intent === 'long_term' && layer === 'saga' ? 0.35 :
        intent === 'summary' && (layer === 'episode' || layer === 'episode_summary') ? 0.28 :
        intent === 'fact' && layer === 'event' ? 0.24 :
        intent === 'emotional' && layer === 'feel' ? 0.3 :
        0;
    const resolvedPenalty = node.resolved ? 0.18 : 1;
    return Math.max(0, (importance * 0.48 + recency * 0.22 + access * 0.1 + emotion + statusBoost + layerBoost) * resolvedPenalty);
}

export function filterCognitiveFlowResults(results: ScoredMemory[]): ScoredMemory[] {
    return results.filter(r => !shouldHideFromCognitiveRecall(r.node, false));
}

export async function mergeCognitiveFlowSurfaceResults(
    results: ScoredMemory[],
    charId: string,
    queryText: string,
    maxSurface = 4,
): Promise<ScoredMemory[]> {
    const now = Date.now();
    const intent = classifyCognitiveQueryIntent(queryText);
    const includeFeel = intent === 'emotional';
    const existingIds = new Set(results.map(r => r.node.id));
    const allNodes = await MemoryNodeDB.getByCharId(charId);
    const surfaceCandidates = allNodes
        .filter(node => !existingIds.has(node.id) && !shouldHideFromCognitiveRecall(node, includeFeel))
        .map(node => ({ node, weight: scoreCognitiveWeight(node, now, intent) }))
        .filter(item => item.weight > 0)
        .sort((a, b) => b.weight - a.weight)
        .slice(0, maxSurface)
        .map(({ node, weight }) => ({
            node: { ...node, surfaceCount: (node.surfaceCount || 0) + 1 },
            weight,
        }));
    await Promise.all(surfaceCandidates.map(({ node }) => MemoryNodeDB.save(node))).catch(() => {});
    const surfaced = surfaceCandidates
        .map(({ node, weight }): ScoredMemory => ({
            node,
            finalScore: Math.max(0.35, Math.min(1.2, weight)),
            similarity: 0,
            bm25Score: 0,
            roomScore: Math.max(0.35, Math.min(1.2, weight)),
        }));
    return [...results, ...surfaced];
}

export function selectCognitiveFlowItems<T extends { score: number; layer?: CognitiveMemoryLayer }>(items: T[], limit: number): T[] {
    if (items.length <= limit) return items;
    const budgets: Record<CognitiveMemoryLayer, number> = {
        event: 7,
        episode: 4,
        episode_summary: 4,
        saga: 3,
        feel: 2,
    };
    const byLayer = new Map<CognitiveMemoryLayer, T[]>();
    for (const item of items) {
        const layer = item.layer || 'event';
        const arr = byLayer.get(layer) || [];
        arr.push(item);
        byLayer.set(layer, arr);
    }
    for (const arr of byLayer.values()) arr.sort((a, b) => b.score - a.score);

    const picked: T[] = [];
    const used = new Set<T>();
    const order: CognitiveMemoryLayer[] = ['saga', 'episode_summary', 'episode', 'event', 'feel'];
    for (const layer of order) {
        const arr = byLayer.get(layer) || [];
        const take = Math.min(arr.length, budgets[layer] || 0, limit - picked.length);
        for (const item of arr.slice(0, take)) {
            picked.push(item);
            used.add(item);
        }
        if (picked.length >= limit) break;
    }

    if (picked.length < limit) {
        const rest = items.filter(item => !used.has(item)).sort((a, b) => b.score - a.score);
        picked.push(...rest.slice(0, limit - picked.length));
    }
    return picked.sort((a, b) => b.score - a.score);
}
