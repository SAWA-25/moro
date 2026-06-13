import { describe, it, expect, beforeEach } from 'vitest';
import { applyRecallFatigue } from './recallFatigue';
import { recordRecallReceipt, getRecentInjectionCounts, clearReceipts } from './recallReceipts';
import type { MemoryNode, ScoredMemory } from './types';

const CHAR = 'test_char_fatigue';

function node(id: string, over: Partial<MemoryNode> = {}): MemoryNode {
    return {
        id, charId: CHAR, content: `mem ${id}`, room: 'living_room',
        tags: [], importance: 5, mood: 'neutral', embedded: true,
        createdAt: Date.now(), lastAccessedAt: Date.now(), accessCount: 0,
        ...over,
    };
}
function scored(n: MemoryNode, score = 1): ScoredMemory {
    return { node: n, finalScore: score, similarity: score, bm25Score: 0, roomScore: score };
}

describe('recallFatigue', () => {
    beforeEach(() => clearReceipts(CHAR));

    it('getRecentInjectionCounts 统计近窗内每条记忆的注入次数', () => {
        recordRecallReceipt(CHAR, ['a', 'b']);
        recordRecallReceipt(CHAR, ['a']);
        recordRecallReceipt(CHAR, ['a', 'c']);
        const counts = getRecentInjectionCounts(CHAR, 6);
        expect(counts.get('a')).toBe(3);
        expect(counts.get('b')).toBe(1);
        expect(counts.get('c')).toBe(1);
    });

    it('近窗只回看最近 windowSize 条 receipt', () => {
        for (let i = 0; i < 8; i++) recordRecallReceipt(CHAR, ['x']);
        expect(getRecentInjectionCounts(CHAR, 3).get('x')).toBe(3);
    });

    it('反复注入的记忆被降权；单次/零次不罚', () => {
        recordRecallReceipt(CHAR, ['a', 'b']);
        recordRecallReceipt(CHAR, ['a']);
        recordRecallReceipt(CHAR, ['a']);
        recordRecallReceipt(CHAR, ['a']);            // a 近窗 4 次，b 1 次，c 0 次
        const a = scored(node('a'));
        const b = scored(node('b'));
        const c = scored(node('c'));
        const penalized = applyRecallFatigue([a, b, c], CHAR);
        expect(penalized).toBe(1);                    // 只有 a 被罚
        expect(a.finalScore).toBeCloseTo(0.512, 5);   // 0.8^(4-1)
        expect(b.finalScore).toBe(1);                 // 1 次 = FREE_HITS，不罚
        expect(c.finalScore).toBe(1);                 // 没出现过，不罚
    });

    it('惩罚有地板（0.45），不会把分数压到归零', () => {
        for (let i = 0; i < 6; i++) recordRecallReceipt(CHAR, ['a']);
        const a = scored(node('a'), 1);
        applyRecallFatigue([a], CHAR);
        expect(a.finalScore).toBeCloseTo(0.45, 5);
    });

    it('认知节点与便利贴豁免（不习惯化）', () => {
        for (let i = 0; i < 5; i++) recordRecallReceipt(CHAR, ['cog', 'pin']);
        const cog = scored(node('cog', { origin: 'cognition' }), 1);
        const pin = scored(node('pin', { pinnedUntil: Date.now() + 60_000 }), 1);
        const penalized = applyRecallFatigue([cog, pin], CHAR);
        expect(penalized).toBe(0);
        expect(cog.finalScore).toBe(1);
        expect(pin.finalScore).toBe(1);
    });
});
