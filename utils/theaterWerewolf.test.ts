import { describe, it, expect } from 'vitest';
import {
    rolesFor, createWerewolfGame, checkWinner, tallyVotes, livingWolves, livingGood,
    WEREWOLF_ROLE_CN, WEREWOLF_ROLE_EMOJI, guardablePlayers, resolveNightDeathReasons,
    applyVoteExile, voteTargetPlayers, votingPlayers, normalizeWerewolfGame,
} from './theaterWerewolf';
import { CharacterProfile, WerewolfGame } from '../types';

const mkChar = (id: string, name: string): CharacterProfile => ({
    id, name, avatar: '', description: `${name} 的人设`, systemPrompt: '', memories: [],
} as CharacterProfile);

const chars = (n: number) => Array.from({ length: n }, (_, i) => mkChar(`c${i}`, `角色${i}`));

describe('rolesFor', () => {
    it('6-9 人扩展板子符合守卫 / 白痴默认启用规则', () => {
        expect(rolesFor(6).sort()).toEqual(['guard', 'idiot', 'seer', 'witch', 'wolf', 'wolf'].sort());
        expect(rolesFor(7).sort()).toEqual(['guard', 'idiot', 'seer', 'villager', 'witch', 'wolf', 'wolf'].sort());
        expect(rolesFor(8).sort()).toEqual(['guard', 'hunter', 'idiot', 'seer', 'villager', 'witch', 'wolf', 'wolf'].sort());
        expect(rolesFor(9).sort()).toEqual(['guard', 'hunter', 'idiot', 'seer', 'villager', 'witch', 'wolf', 'wolf', 'wolf'].sort());
    });
    it('各人数板子总数 = 人数，且狼≥1、核心神职齐全', () => {
        for (let total = 6; total <= 14; total++) {
            const roles = rolesFor(total);
            expect(roles.length).toBe(total);
            expect(roles.filter(r => r === 'wolf').length).toBeGreaterThanOrEqual(1);
            expect(roles).toContain('seer');
            expect(roles).toContain('witch');
            expect(roles).toContain('guard');
            expect(roles).toContain('idiot');
        }
    });
    it('狼人数永远少于好人数（开局好人不立即落败）', () => {
        for (let total = 6; total <= 14; total++) {
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
        const g = createWerewolfGame('我', undefined, chars(5));
        const ai = g.players.filter(p => !p.isUser);
        expect(ai.every(p => !!p.charId)).toBe(true);
        expect(g.players.find(p => p.isUser)!.charId).toBeUndefined();
    });
});

describe('checkWinner', () => {
    const base = createWerewolfGame('我', undefined, chars(5));
    const withAlive = (roleAlive: Record<string, boolean>): WerewolfGame => ({
        ...base,
        players: base.players.map((p, i) => ({ ...p, role: (['wolf', 'wolf', 'seer', 'witch', 'guard', 'idiot'] as const)[i], alive: roleAlive[String(i)] ?? true })),
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

describe('guard rules', () => {
    it('守卫不能连续两晚守同一人', () => {
        const g = createWerewolfGame('我', undefined, chars(5));
        g.lastGuardedSeat = 3;
        const seats = guardablePlayers(g).map(p => p.seat);
        expect(seats).not.toContain(3);
        expect(seats.length).toBe(g.players.length - 1);
    });
    it('守卫挡狼刀、不挡毒、同守同救仍死亡', () => {
        expect(resolveNightDeathReasons({ wolfKill: 2, witchHeal: false, witchPoison: null, guardProtect: 2 })).toEqual({});
        expect(resolveNightDeathReasons({ wolfKill: 2, witchHeal: false, witchPoison: 2, guardProtect: 2 })).toEqual({ 2: 'poison' });
        expect(resolveNightDeathReasons({ wolfKill: 2, witchHeal: true, witchPoison: null, guardProtect: 2 })).toEqual({ 2: 'guard_heal_conflict' });
        expect(resolveNightDeathReasons({ wolfKill: 2, witchHeal: true, witchPoison: null, guardProtect: null })).toEqual({});
    });
});

describe('idiot rules', () => {
    const gameWithIdiot = (): WerewolfGame => {
        const g = createWerewolfGame('我', undefined, chars(5));
        g.players = g.players.map((p, i) => ({ ...p, role: (['wolf', 'wolf', 'seer', 'witch', 'guard', 'idiot'] as const)[i] }));
        return g;
    };
    it('白痴首次被票出翻牌免死，之后不能投票 / 被投票', () => {
        const g = gameWithIdiot();
        const idiot = g.players.find(p => p.role === 'idiot')!;
        expect(applyVoteExile(g, idiot.seat)).toBe('idiot-revealed');
        expect(idiot.alive).toBe(true);
        expect(idiot.idiotRevealed).toBe(true);
        expect(votingPlayers(g).map(p => p.seat)).not.toContain(idiot.seat);
        expect(voteTargetPlayers(g).map(p => p.seat)).not.toContain(idiot.seat);
    });
    it('翻牌白痴仍可被夜间死亡', () => {
        const g = gameWithIdiot();
        const idiot = g.players.find(p => p.role === 'idiot')!;
        idiot.idiotRevealed = true;
        const reasons = resolveNightDeathReasons({ wolfKill: idiot.seat, witchHeal: false, witchPoison: null, guardProtect: null });
        expect(reasons[idiot.seat]).toBe('wolf');
    });
});

describe('normalizeWerewolfGame', () => {
    it('旧存档缺少新增字段时补默认值', () => {
        const legacy = createWerewolfGame('我', undefined, chars(5)) as any;
        delete legacy.lastGuardedSeat;
        delete legacy.pendingKill;
        delete legacy.winner;
        delete legacy.players[0].idiotRevealed;
        const g = normalizeWerewolfGame(legacy);
        expect(g.lastGuardedSeat).toBeNull();
        expect(g.pendingKill).toBeNull();
        expect(g.winner).toBeNull();
        expect(g.players[0].idiotRevealed).toBe(false);
    });
});

describe('role 文案表', () => {
    it('七种身份都有中文名与 emoji', () => {
        for (const r of ['wolf', 'seer', 'witch', 'hunter', 'guard', 'idiot', 'villager'] as const) {
            expect(WEREWOLF_ROLE_CN[r]).toBeTruthy();
            expect(WEREWOLF_ROLE_EMOJI[r]).toBeTruthy();
        }
    });
});
