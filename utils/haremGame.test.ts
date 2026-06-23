import { describe, it, expect } from 'vitest';
import {
    rankOf, HAREM_RANKS, initHaremGame, playCard, endDay, resolveHaremEvent,
    getCard, topFavored, DEFAULT_MAX_ENERGY, type HaremState,
} from './haremGame';

const seeds = [
    { charId: 'a', name: '阿杏', avatar: '', affection: 50 },
    { charId: 'b', name: '青禾', avatar: '', affection: 30 },
];

describe('haremGame · rankOf', () => {
    it('按宠爱阈值映射位分', () => {
        expect(rankOf(0).key).toBe('da');
        expect(rankOf(24).label).toBe('答应');
        expect(rankOf(25).label).toBe('常在');
        expect(rankOf(100).label).toBe('皇贵妃');
    });
    it('阈值单调不降', () => {
        for (let i = 1; i < HAREM_RANKS.length; i++) expect(HAREM_RANKS[i].min).toBeGreaterThan(HAREM_RANKS[i - 1].min);
    });
});

describe('haremGame · initHaremGame', () => {
    it('用真实好感作起点，心情统一', () => {
        const s = initHaremGame(seeds);
        expect(s.members.map(m => m.favor)).toEqual([50, 30]);
        expect(s.members.every(m => m.mood === 60)).toBe(true);
        expect(s.energy).toBe(DEFAULT_MAX_ENERGY);
        expect(s.hand.length).toBeGreaterThan(0);
    });
});

describe('haremGame · playCard', () => {
    const base = (): HaremState => ({
        ...initHaremGame(seeds), hand: ['garden', 'exclusive', 'banquet'], energy: 3,
    });

    it('定向卡涨宠爱/心情并扣行动点、消手牌', () => {
        const s = playCard(base(), 'garden', 'a');
        const a = s.members.find(m => m.charId === 'a')!;
        expect(a.favor).toBe(56);     // 50 + 6
        expect(s.energy).toBe(2);
        expect(s.hand).not.toContain('garden');
    });

    it('行动点不足时原样返回', () => {
        const s = { ...base(), energy: 1 };
        const out = playCard(s, 'exclusive', 'a'); // exclusive 需要 2 点
        expect(out).toBe(s);
    });

    it('独宠卡连带其余诸位降宠降心情', () => {
        const s = playCard(base(), 'exclusive', 'a');
        const a = s.members.find(m => m.charId === 'a')!;
        const b = s.members.find(m => m.charId === 'b')!;
        expect(a.favor).toBe(64);     // 50 + 14
        expect(b.favor).toBe(27);     // 30 - 3
    });

    it('全体卡作用所有人，无需目标', () => {
        const s = playCard(base(), 'banquet');
        expect(s.members.every((m, i) => m.favor === [50, 30][i] + 3)).toBe(true);
    });

    it('宠爱钳制在 0~100', () => {
        let s = base();
        s.members[0].favor = 99;
        s = playCard(s, 'garden', 'a');
        expect(s.members[0].favor).toBe(100);
    });
});

describe('haremGame · 夜间事件', () => {
    it('resolveHaremEvent 抉择后进入下一日并清空事件', () => {
        const s = initHaremGame(seeds);
        const withEvent: HaremState = {
            ...s,
            pendingEvent: { type: 'blessing', emoji: '🎁', title: '喜讯', text: '', subjectIds: [], options: [{ label: '同沾喜气', tone: 'good' }] },
        };
        const out = resolveHaremEvent(withEvent, 0);
        expect(out.pendingEvent).toBeNull();
        expect(out.day).toBe(s.day + 1);
        expect(out.energy).toBe(out.maxEnergy);
    });

    it('endDay 在已有 pending 事件时不重复推进', () => {
        const s = initHaremGame(seeds);
        const withEvent: HaremState = { ...s, pendingEvent: { type: 'blessing', emoji: '🎁', title: '喜讯', text: '', subjectIds: [], options: [{ label: 'ok', tone: 'good' }] } };
        expect(endDay(withEvent)).toBe(withEvent);
    });
});

describe('haremGame · 杂项', () => {
    it('getCard 能取到卡，topFavored 取最高宠爱', () => {
        expect(getCard('garden')?.name).toBe('同游御花园');
        const s = initHaremGame(seeds);
        expect(topFavored(s)?.charId).toBe('a');
    });
});
