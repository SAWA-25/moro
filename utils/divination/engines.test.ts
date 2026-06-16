import { describe, it, expect } from 'vitest';
import { TAROT_78, LENORMAND_36, HEXAGRAM_BY_KEY } from './cards';
import {
    drawTarot, drawLenormand, castLiuyao, castMeihua, deriveMeihua,
    hexagramFromLines, TAROT_SPREADS, LENORMAND_SPREADS, nowToMeihuaTime,
} from './engines';

describe('占卜静态数据', () => {
    it('塔罗 78 张，index 0~77 连续无缺', () => {
        expect(TAROT_78).toHaveLength(78);
        expect(TAROT_78.map(c => c.index)).toEqual(Array.from({ length: 78 }, (_, i) => i));
        // 22 大阿卡纳 + 56 小阿卡纳
        expect(TAROT_78.filter(c => c.suit === 'major')).toHaveLength(22);
        expect(TAROT_78.filter(c => c.suit !== 'major')).toHaveLength(56);
    });

    it('雷诺曼 36 张，number 1~36 连续', () => {
        expect(LENORMAND_36).toHaveLength(36);
        expect(LENORMAND_36.map(c => c.number)).toEqual(Array.from({ length: 36 }, (_, i) => i + 1));
    });

    it('64 卦齐全且卦序 1~64 唯一', () => {
        const orders = Object.values(HEXAGRAM_BY_KEY).map(h => h.order).sort((a, b) => a - b);
        expect(orders).toHaveLength(64);
        expect(orders).toEqual(Array.from({ length: 64 }, (_, i) => i + 1));
    });
});

describe('塔罗 / 雷诺曼抽牌', () => {
    it('按牌阵抽 N 张且不重复', () => {
        const spread = TAROT_SPREADS.find(s => s.key === 'celtic')!;
        const draws = drawTarot(spread);
        expect(draws).toHaveLength(10);
        const ids = new Set(draws.map(d => d.card.index));
        expect(ids.size).toBe(10); // 无重复
        draws.forEach(d => expect(typeof d.reversed).toBe('boolean'));
    });

    it('雷诺曼九宫格抽 9 张不重复', () => {
        const spread = LENORMAND_SPREADS.find(s => s.key === 'nine')!;
        const draws = drawLenormand(spread);
        expect(draws).toHaveLength(9);
        expect(new Set(draws.map(d => d.card.number)).size).toBe(9);
    });
});

describe('六爻金钱卦', () => {
    it('恒为六爻、本卦有效，有动爻则变卦有效', () => {
        for (let i = 0; i < 30; i++) {
            const r = castLiuyao();
            expect(r.lines).toHaveLength(6);
            r.lines.forEach(l => expect([6, 7, 8, 9]).toContain(l.value));
            expect(r.primary).not.toBeNull();
            if (r.movingPositions.length > 0) expect(r.changed).not.toBeNull();
            else expect(r.changed).toBeNull();
        }
    });

    it('动爻翻转后变卦与本卦不同', () => {
        // 构造：初爻老阳(9, 动)，其余少阴(8)
        const yang = [true, false, false, false, false, false];
        const primary = hexagramFromLines(yang);
        const changed = hexagramFromLines(yang.map((y, i) => (i === 0 ? !y : y)));
        expect(primary).not.toBeNull();
        expect(changed).not.toBeNull();
        expect(primary!.order).not.toBe(changed!.order);
    });
});

describe('梅花易数', () => {
    it('报数起卦：体用、互卦、变卦齐全', () => {
        const r = castMeihua({ method: 'number', numbers: { n1: 12, n2: 5 } });
        // 上卦 12%8=4 震，下卦 5 巽，动爻 17%6=5
        expect(r.upperNum).toBe(4);
        expect(r.lowerNum).toBe(5);
        expect(r.movingYao).toBe(5);
        expect(r.primary).not.toBeNull();
        expect(r.mutual).not.toBeNull();
        expect(r.changed).not.toBeNull();
        // 动爻在 4~6 → 体在下卦
        expect(r.bodyTrigram).toBe('lower');
    });

    it('deriveMeihua：乾上乾下 = 乾为天(卦序1)', () => {
        const r = deriveMeihua(1, 1, 1); // 乾(1) 上下
        expect(r.primary?.name).toBe('乾为天');
        expect(r.primary?.order).toBe(1);
    });

    it('deriveMeihua：坤上坤下 = 坤为地(卦序2)', () => {
        const r = deriveMeihua(8, 8, 3); // 坤(8) 上下
        expect(r.primary?.name).toBe('坤为地');
    });

    it('时间起卦：八卦数都落在 1~8、动爻 1~6', () => {
        const t = nowToMeihuaTime(new Date(2026, 5, 16, 14, 30));
        const r = castMeihua({ method: 'time', time: t });
        expect(r.upperNum).toBeGreaterThanOrEqual(1);
        expect(r.upperNum).toBeLessThanOrEqual(8);
        expect(r.lowerNum).toBeGreaterThanOrEqual(1);
        expect(r.lowerNum).toBeLessThanOrEqual(8);
        expect(r.movingYao).toBeGreaterThanOrEqual(1);
        expect(r.movingYao).toBeLessThanOrEqual(6);
    });
});
