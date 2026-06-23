import { describe, it, expect } from 'vitest';
import {
    createTruthDareSession, spinBottle, pickPoser, recentText, playerById,
    TD_KIND_CN, TD_KIND_EMOJI, TD_SPICE_LABEL, USER_ID,
} from './theaterTruthDare';
import { CharacterProfile, TruthDareSession } from '../types';

const mkChar = (id: string, name: string): CharacterProfile => ({
    id, name, avatar: '', description: `${name} 的人设`, systemPrompt: '', memories: [],
} as CharacterProfile);

const chars = (n: number) => Array.from({ length: n }, (_, i) => mkChar(`c${i}`, `角色${i}`));

describe('createTruthDareSession', () => {
    it('user 排第一、其余是角色、人数 = 角色数+1', () => {
        const s = createTruthDareSession('我', undefined, chars(3), 'flirty');
        expect(s.players.length).toBe(4);
        expect(s.players[0].id).toBe(USER_ID);
        expect(s.players[0].isUser).toBe(true);
        expect(s.players.filter(p => p.isUser).length).toBe(1);
        expect(s.players.slice(1).every(p => !!p.charId && !p.isUser)).toBe(true);
        expect(s.spice).toBe('flirty');
        expect(s.rounds).toEqual([]);
    });
});

describe('spinBottle', () => {
    it('总是返回圈里的一个玩家（多次抽样都合法）', () => {
        const s = createTruthDareSession('我', undefined, chars(4), 'light');
        const ids = new Set(s.players.map(p => p.id));
        for (let i = 0; i < 200; i++) expect(ids.has(spinBottle(s).id)).toBe(true);
    });
});

describe('pickPoser', () => {
    const s = createTruthDareSession('我', undefined, chars(3), 'bold');
    it('出题者永远不是受题者本人', () => {
        for (const target of s.players) {
            for (let i = 0; i < 50; i++) expect(pickPoser(s, target.id).id).not.toBe(target.id);
        }
    });
    it('preferChar 时，受题者是 user 则出题者必是角色', () => {
        for (let i = 0; i < 50; i++) {
            const poser = pickPoser(s, USER_ID, true);
            expect(poser.isUser).toBe(false);
        }
    });
});

describe('recentText', () => {
    it('拼出最近回合的可读摘要', () => {
        const s: TruthDareSession = {
            ...createTruthDareSession('我', undefined, chars(2), 'light'),
            rounds: [
                { no: 1, targetId: 'c0', targetName: '角色0', kind: 'truth', poserId: USER_ID, poserName: '我', challenge: '你喜欢谁？', answer: '秘密~', at: 1 },
                { no: 2, targetId: USER_ID, targetName: '我', kind: 'dare', poserId: 'c1', poserName: '角色1', challenge: '唱一句', answer: '啦啦啦', at: 2 },
            ],
        };
        const txt = recentText(s, 4);
        expect(txt).toContain('角色0 选了真心话');
        expect(txt).toContain('唱一句');
        expect(txt.split('\n').length).toBe(2);
    });
    it('空局返回空串', () => {
        expect(recentText(createTruthDareSession('我', undefined, chars(1), 'light'))).toBe('');
    });
});

describe('文案表 + playerById', () => {
    it('kind / spice 文案齐全', () => {
        for (const k of ['truth', 'dare'] as const) { expect(TD_KIND_CN[k]).toBeTruthy(); expect(TD_KIND_EMOJI[k]).toBeTruthy(); }
        for (const sp of ['light', 'flirty', 'bold'] as const) expect(TD_SPICE_LABEL[sp]).toBeTruthy();
    });
    it('playerById 能取到 user 与角色', () => {
        const s = createTruthDareSession('我', undefined, chars(2), 'light');
        expect(playerById(s, USER_ID)?.isUser).toBe(true);
        expect(playerById(s, 'c1')?.name).toBe('角色1');
        expect(playerById(s, 'nope')).toBeUndefined();
    });
});
