import { describe, it, expect } from 'vitest';
import {
    rolesFor, createWerewolfGame, checkWinner, tallyVotes, livingWolves, livingGood,
    WEREWOLF_ROLE_CN, WEREWOLF_ROLE_EMOJI,
} from './theaterWerewolf';
import { CharacterProfile, WerewolfGame } from '../types';

const mkChar = (id: string, name: string): CharacterProfile => ({
    id, name, avatar: '', description: `${name} 的人设`, systemPrompt: '', memories: [],
} as CharacterProfile);

const chars = (n: number) => Array.from({ length: n }, (_, i) => mkChar(`c${i}`, `角色${i}`));

describe('rolesFor', () => {
    it('各人数板子总数 = 人数，且狼≥1、神职齐全', () => {
        for (let total = 4; total <= 14; total++) {
            const roles = rolesFor(total);
            expect(roles.length).toBe(total);
            expect(roles.filter(r => r === 'wolf').length).toBeGreaterThanOrEqual(1);
            // 4 人以上必有预言家 + 女巫
            expect(roles).toContain('seer');
            expect(roles).toContain('witch');
        }
    });
    it('狼人数永远少于好人数（开局好人不立即落败）', () => {
        for (let total = 4; total <= 14; total++) {
            const roles = rolesFor(total);
            const w = roles.filter(r => r === 'wolf').length;
            expect(w).toBeLessThan(total - w);
        }
    });
});

describe('createWerewolfGame', () => {
    it('座位连续、恰有一个 user、发牌与人数一致', () => {
        const g = createWerewolfGame('我', undefined, chars(5)); // 共 6 人
        expect(g.players.length).toBe(6);
        expect(g.players.filter(p => p.isUser).length).toBe(1);
        expect(g.players.map(p => p.seat).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
        expect(g.players.every(p => p.alive)).toBe(true);
        expect(g.phase).toBe('night');
        expect(g.round).toBe(1);
        // 发牌分布与 rolesFor 一致
        const dist = (arr: string[]) => arr.slice().sort().join(',');
        expect(dist(g.players.map(p => p.role))).toBe(dist(rolesFor(6)));
    });
    it('AI 玩家都绑定了 charId，user 没有', () => {
        const g = createWerewolfGame('我', undefined, chars(4));
        const ai = g.players.filter(p => !p.isUser);
        expect(ai.every(p => !!p.charId)).toBe(true);
        expect(g.players.find(p => p.isUser)!.charId).toBeUndefined();
    });
});

describe('checkWinner', () => {
    const base = createWerewolfGame('我', undefined, chars(5));
    const withAlive = (roleAlive: Record<string, boolean>): WerewolfGame => ({
        ...base,
        players: base.players.map((p, i) => ({ ...p, role: (['wolf', 'wolf', 'seer', 'witch', 'hunter', 'villager'] as const)[i], alive: roleAlive[String(i)] ?? true })),
    });
    it('狼全灭 = 好人胜', () => {
        const g = withAlive({ 0: false, 1: false }); // 两狼出局
        expect(livingWolves(g).length).toBe(0);
        expect(checkWinner(g)).toBe('good');
    });
    it('存活狼 ≥ 存活好人 = 狼胜', () => {
        const g = withAlive({ 2: false, 3: false, 4: false, 5: false }); // 神民全灭，剩两狼
        expect(livingGood(g).length).toBe(0);
        expect(checkWinner(g)).toBe('wolf');
    });
    it('双方都有存活且狼<好人 = 继续', () => {
        const g = withAlive({ 1: false }); // 1 狼 vs 4 好人
        expect(checkWinner(g)).toBeNull();
    });
});

describe('tallyVotes', () => {
    it('多数票者出局', () => {
        const { target, counts } = tallyVotes([
            { seat: 1, target: 3 }, { seat: 2, target: 3 }, { seat: 4, target: 5 },
        ]);
        expect(target).toBe(3);
        expect(counts[3]).toBe(2);
    });
    it('平票时在并列最高者中取其一', () => {
        const { target } = tallyVotes([{ seat: 1, target: 2 }, { seat: 3, target: 4 }]);
        expect([2, 4]).toContain(target);
    });
    it('无人投票返回 null', () => {
        expect(tallyVotes([]).target).toBeNull();
    });
});

describe('role 文案表', () => {
    it('五种身份都有中文名与 emoji', () => {
        for (const r of ['wolf', 'seer', 'witch', 'hunter', 'villager'] as const) {
            expect(WEREWOLF_ROLE_CN[r]).toBeTruthy();
            expect(WEREWOLF_ROLE_EMOJI[r]).toBeTruthy();
        }
    });
});
