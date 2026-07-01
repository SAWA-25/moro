import { describe, expect, it } from 'vitest';
import {
    applyTrpgStateUpdates,
    createDefaultPartySheets,
    normalizeTrpgSession,
    rollNarrativeCheck,
    summarizeCampaignState,
} from './theaterTrpg';
import { CharacterProfile, GameSession, UserProfile } from '../types';

const user: UserProfile = { name: '我', bio: '', avatar: '' } as UserProfile;
const mkChar = (id: string, name: string): CharacterProfile => ({
    id, name, avatar: '', description: `${name} 的人设`, systemPrompt: '', memories: [],
} as CharacterProfile);

const baseGame = (extra: Partial<GameSession> = {}): GameSession => ({
    id: 'g1',
    title: '雾城列车',
    theme: 'modern',
    worldSetting: '一座总在下雨的城市。',
    playerCharIds: ['c1'],
    logs: [],
    status: { location: '月台', health: 100, sanity: 100, gold: 0, inventory: [] },
    createdAt: 1,
    lastPlayedAt: 1,
    ...extra,
});

describe('createDefaultPartySheets', () => {
    it('creates user and character sheets with stable basics', () => {
        const sheets = createDefaultPartySheets(user, [mkChar('c1', '林')]);
        expect(sheets).toHaveLength(2);
        expect(sheets[0].ownerId).toBe('user');
        expect(sheets[0].attributes.mind).toBe(1);
        expect(sheets[1].ownerId).toBe('c1');
        expect(sheets[1].hp).toBe(100);
    });
});

describe('rollNarrativeCheck', () => {
    const sheet = createDefaultPartySheets(user, [])[0];

    it('adds attribute and matching skill bonus against DC', () => {
        const result = rollNarrativeCheck({
            sheet,
            check: { attribute: 'mind', skill: '观察', dc: 15 },
            rolls: [12],
        });
        expect(result.total).toBe(15);
        expect(result.success).toBe(true);
        expect(result.skillBonus).toBe(2);
    });

    it('handles advantage and disadvantage', () => {
        const adv = rollNarrativeCheck({ sheet, check: { attribute: 'luck', dc: 18, mode: 'advantage' }, rolls: [3, 18] });
        const dis = rollNarrativeCheck({ sheet, check: { attribute: 'luck', dc: 10, mode: 'disadvantage' }, rolls: [17, 2] });
        expect(adv.chosenRoll).toBe(18);
        expect(adv.success).toBe(true);
        expect(dis.chosenRoll).toBe(2);
        expect(dis.success).toBe(false);
    });

    it('treats natural 20 and 1 as critical outcomes', () => {
        const crit = rollNarrativeCheck({ sheet, check: { attribute: 'body', dc: 30 }, rolls: [20] });
        const fail = rollNarrativeCheck({ sheet, check: { attribute: 'body', dc: 2 }, rolls: [1] });
        expect(crit.success).toBe(true);
        expect(crit.critical).toBe('success');
        expect(fail.success).toBe(false);
        expect(fail.critical).toBe('failure');
    });
});

describe('normalizeTrpgSession', () => {
    it('keeps old saves classic by default', () => {
        const normalized = normalizeTrpgSession(baseGame(), user, [mkChar('c1', '林')]);
        expect(normalized.campaignMode).toBe('classic');
        expect(normalized.partySheets).toBeUndefined();
    });

    it('fills expanded defaults without a migration script', () => {
        const normalized = normalizeTrpgSession(baseGame({ campaignMode: 'expanded' }), user, [mkChar('c1', '林')]);
        expect(normalized.chapter?.no).toBe(1);
        expect(normalized.partySheets?.map(s => s.ownerId)).toEqual(['user', 'c1']);
        expect(normalized.worldClock?.ticks).toBe(0);
    });
});

describe('applyTrpgStateUpdates', () => {
    it('merges quests, clues, npcs, threats, sheets, and clock', () => {
        const start = normalizeTrpgSession(baseGame({ campaignMode: 'expanded' }), user, [mkChar('c1', '林')]);
        const updated = applyTrpgStateUpdates(start, {
            newLocation: '旧车厢',
            hpChange: -8,
            questUpdates: [{ id: 'q1', title: '找到失踪乘客', status: 'active', steps: ['询问列车员'] }],
            clueUpdates: [{ id: 'cl1', title: '潮湿票根', detail: '票根上没有日期。', tags: ['列车'] }],
            npcUpdates: [{ id: 'n1', name: '列车员', role: '守口如瓶的人', attitude: '警惕' }],
            threatUpdates: [{ id: 't1', title: '雾中追兵', progress: 2, max: 6, danger: 'high', status: 'active' }],
            sheetUpdates: [{ ownerId: 'c1', xpChange: 2, bondChange: 1, addSkills: ['追踪'], addItems: ['铜钥匙'] }],
            worldClock: { phase: '深夜', tick: 2 },
            milestone: { title: '第一次找到真实线索', reward: '全员 XP +1' },
        });

        expect(updated.status.location).toBe('旧车厢');
        expect(updated.status.health).toBe(92);
        expect(updated.quests?.[0].steps).toContain('询问列车员');
        expect(updated.clues?.[0].detail).toContain('没有日期');
        expect(updated.npcs?.[0].attitude).toBe('警惕');
        expect(updated.threats?.[0].progress).toBe(2);
        expect(updated.partySheets?.find(s => s.ownerId === 'c1')?.skills).toContain('追踪');
        expect(updated.partySheets?.find(s => s.ownerId === 'c1')?.inventory).toContain('铜钥匙');
        expect(updated.worldClock?.phase).toBe('深夜');
        expect(updated.worldClock?.ticks).toBe(2);
        expect(updated.milestones?.[0].title).toBe('第一次找到真实线索');
    });

    it('summarizes expanded state for prompts and cards', () => {
        const start = normalizeTrpgSession(baseGame({ campaignMode: 'expanded' }), user, [mkChar('c1', '林')]);
        const updated = applyTrpgStateUpdates(start, {
            questUpdates: [{ title: '追上末班车', status: 'active', summary: '车门正在关闭。' }],
            clueUpdates: [{ title: '黑色车票', detail: '票面会变字。' }],
        });
        const text = summarizeCampaignState(updated);
        expect(text).toContain('战役扩展状态');
        expect(text).toContain('追上末班车');
        expect(text).toContain('黑色车票');
    });
});

