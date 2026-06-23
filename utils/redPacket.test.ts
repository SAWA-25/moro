import { describe, it, expect } from 'vitest';
import { splitRedPacket, bestLuckIndex, shuffle, yuanToCents, centsToYuan } from './redPacket';

/** 确定性随机源（mulberry32），让拆分结果可复现、可断言。 */
function mulberry32(seed: number) {
    return function () {
        seed |= 0;
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

describe('splitRedPacket', () => {
    it('各份之和恰好等于总额（多种 seed / 份数）', () => {
        for (let seed = 1; seed <= 80; seed++) {
            for (const [total, count] of [[10000, 7], [12345, 10], [888, 3], [100, 2], [99999, 50]] as const) {
                const shares = splitRedPacket(total, count, mulberry32(seed));
                expect(shares.length).toBe(count);
                expect(shares.reduce((a, b) => a + b, 0)).toBe(total);
                expect(Math.min(...shares)).toBeGreaterThanOrEqual(1); // 每份 >= 1 分
            }
        }
    });

    it('份数为 1 时整包返回', () => {
        expect(splitRedPacket(523, 1)).toEqual([523]);
    });

    it('对同一 rng 是确定性的（可复现）', () => {
        const a = splitRedPacket(8888, 5, mulberry32(42));
        const b = splitRedPacket(8888, 5, mulberry32(42));
        expect(a).toEqual(b);
    });

    it('不同 rng 一般给出不同的拆分', () => {
        const a = splitRedPacket(8888, 5, mulberry32(1));
        const b = splitRedPacket(8888, 5, mulberry32(2));
        expect(a).not.toEqual(b);
    });

    it('总额不足以让每份拿到最小额时抛错', () => {
        expect(() => splitRedPacket(3, 5)).toThrow();
    });

    it('恰好够分（total == count 分）时每份各 1 分', () => {
        expect(splitRedPacket(5, 5)).toEqual([1, 1, 1, 1, 1]);
    });

    it('尊重自定义最小额', () => {
        for (let seed = 1; seed <= 30; seed++) {
            const shares = splitRedPacket(10000, 6, mulberry32(seed), 100); // 每份至少 1 元
            expect(Math.min(...shares)).toBeGreaterThanOrEqual(100);
            expect(shares.reduce((a, b) => a + b, 0)).toBe(10000);
        }
    });
});

describe('bestLuckIndex', () => {
    it('返回最大份的下标（并列取第一个）', () => {
        expect(bestLuckIndex([1, 5, 5, 2])).toBe(1);
        expect(bestLuckIndex([3])).toBe(0);
        expect(bestLuckIndex([])).toBe(-1);
    });
});

describe('shuffle', () => {
    it('保留全部元素、不改原数组', () => {
        const src = [1, 2, 3, 4, 5];
        const out = shuffle(src, mulberry32(7));
        expect(out.slice().sort()).toEqual(src.slice().sort());
        expect(src).toEqual([1, 2, 3, 4, 5]);
    });
});

describe('元/分换算', () => {
    it('round-trips 常见金额', () => {
        expect(yuanToCents(52.0)).toBe(5200);
        expect(yuanToCents(0.01)).toBe(1);
        expect(centsToYuan(5200)).toBe(52);
        expect(centsToYuan(1)).toBe(0.01);
    });
});
