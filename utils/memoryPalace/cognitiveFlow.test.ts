import { describe, expect, it } from 'vitest';
import {
    classifyCognitiveQueryIntent,
    filterCognitiveFlowResults,
    getCognitiveMemoryLayer,
    isCognitiveFlowMode,
    isMemoryFeatureEnabled,
    normalizeMemoryModeDefaults,
    resolveCharacterMemoryMode,
    scoreCognitiveWeight,
    selectCognitiveFlowItems,
    shouldHideFromCognitiveRecall,
} from './cognitiveFlow';
import type { MemoryNode, ScoredMemory } from './types';

const CHAR = 'cognitive-flow-char';

function node(id: string, patch: Partial<MemoryNode> = {}): MemoryNode {
    const now = Date.now();
    return {
        id,
        charId: CHAR,
        content: `memory ${id}`,
        room: 'living_room',
        tags: [],
        importance: 5,
        mood: 'neutral',
        embedded: true,
        createdAt: now,
        lastAccessedAt: now,
        accessCount: 0,
        ...patch,
    };
}

function scored(n: MemoryNode, score = 1): ScoredMemory {
    return { node: n, finalScore: score, similarity: score, bm25Score: 0, roomScore: score };
}

describe('cognitiveFlow memory mode defaults', () => {
    it('defaults existing characters into local Cognitive Flow', () => {
        const normalized = normalizeMemoryModeDefaults({ id: 'char-a' } as any);
        expect(normalized.memoryMode).toBe('cognitive_flow');
        expect(normalized.memoryPalaceEnabled).toBe(true);
        expect(resolveCharacterMemoryMode({} as any)).toBe('cognitive_flow');
        expect(isMemoryFeatureEnabled(normalized)).toBe(true);
        expect(isCognitiveFlowMode(normalized)).toBe(true);
    });

    it('keeps explicit off and classic decisions intact', () => {
        expect(normalizeMemoryModeDefaults({ memoryPalaceEnabled: false } as any)).toMatchObject({
            memoryMode: 'off',
            memoryPalaceEnabled: false,
        });
        expect(resolveCharacterMemoryMode({ memoryMode: 'off', memoryPalaceEnabled: true } as any)).toBe('off');
        expect(isMemoryFeatureEnabled({ memoryMode: 'off', memoryPalaceEnabled: true } as any)).toBe(false);
        expect(isCognitiveFlowMode({ memoryMode: 'classic', memoryPalaceEnabled: true } as any)).toBe(false);
        expect(isMemoryFeatureEnabled({ memoryMode: 'classic', memoryPalaceEnabled: true } as any)).toBe(true);
    });
});

describe('cognitiveFlow recall policy', () => {
    it('derives layers from existing 回忆标本馆 fields', () => {
        expect(getCognitiveMemoryLayer(node('plain'))).toBe('event');
        expect(getCognitiveMemoryLayer(node('box', { eventBoxId: 'box-1' }))).toBe('episode');
        expect(getCognitiveMemoryLayer(node('summary', { isBoxSummary: true }))).toBe('episode_summary');
        expect(getCognitiveMemoryLayer(node('cognition', { origin: 'cognition' }))).toBe('saga');
    });

    it('hides settled/internal feel noise from ordinary recall', () => {
        const visible = node('visible');
        const feel = node('feel', { cognitiveLayer: 'feel' });
        const internalized = node('internalized', { internalized: true });
        const settledLow = node('settled-low', { resolved: true, importance: 2 });
        const settledHigh = node('settled-high', { resolved: true, importance: 8 });

        expect(shouldHideFromCognitiveRecall(visible)).toBe(false);
        expect(shouldHideFromCognitiveRecall(feel)).toBe(true);
        expect(shouldHideFromCognitiveRecall(feel, true)).toBe(false);
        expect(shouldHideFromCognitiveRecall(internalized)).toBe(true);
        expect(shouldHideFromCognitiveRecall(settledLow)).toBe(true);
        expect(shouldHideFromCognitiveRecall(settledHigh)).toBe(false);

        expect(filterCognitiveFlowResults([
            scored(visible),
            scored(feel),
            scored(internalized),
            scored(settledLow),
            scored(settledHigh),
        ]).map(r => r.node.id)).toEqual(['visible', 'settled-high']);
    });

    it('can intentionally weight feel memories for emotional queries', () => {
        const feel = node('feel', { cognitiveLayer: 'feel', importance: 7, valence: -0.7, arousal: 0.6 });
        expect(classifyCognitiveQueryIntent('你现在心情怎么样')).toBe('emotional');
        expect(scoreCognitiveWeight(feel, Date.now(), 'semantic')).toBe(0);
        expect(scoreCognitiveWeight(feel, Date.now(), 'emotional')).toBeGreaterThan(0);
    });
});

describe('cognitiveFlow layered selection', () => {
    it('keeps a mixed Event/Episode/Saga/feel surface instead of one flat pile', () => {
        const items = [
            { score: 9, layer: 'event' as const, id: 'event-a' },
            { score: 8, layer: 'event' as const, id: 'event-b' },
            { score: 7, layer: 'episode' as const, id: 'episode-a' },
            { score: 6, layer: 'episode_summary' as const, id: 'summary-a' },
            { score: 5, layer: 'saga' as const, id: 'saga-a' },
            { score: 4, layer: 'feel' as const, id: 'feel-a' },
        ];
        const picked = selectCognitiveFlowItems(items, 4);
        expect(picked.map(i => i.id)).toEqual(['event-a', 'episode-a', 'summary-a', 'saga-a']);
    });
});
