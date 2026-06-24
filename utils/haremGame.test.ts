import { describe, it, expect } from 'vitest';
import {
    rankOf, HAREM_RANKS, initHaremGame, playCard, endDay, resolveHaremEvent,
    getCard, topFavored, DEFAULT_MAX_ENERGY, type HaremState,
    maybeConceive, progressPregnancies, addMembers, memberTitles,
    parseAINightEvent, parseConcubineLine, parseEnding, fallbackEnding,
    buildAINightEventPrompt, type HaremMember,
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

describe('haremGame · 子嗣系统', () => {
    it('maybeConceive：低宠不孕、高宠按概率、已孕不再孕', () => {
        expect(maybeConceive({ favor: 40, mood: 80 }, () => 0)).toBe(false);           // 宠 <50 不孕
        expect(maybeConceive({ favor: 90, mood: 80 }, () => 0)).toBe(true);            // rng=0 必中
        expect(maybeConceive({ favor: 90, mood: 80 }, () => 0.99)).toBe(false);        // rng 高不中
        expect(maybeConceive({ favor: 90, mood: 80, pregnant: 2 }, () => 0)).toBe(false); // 已孕不再孕
    });
    it('progressPregnancies：待产 -1，临盆诞皇嗣并涨宠涨心情', () => {
        const ms: HaremMember[] = [
            { charId: 'a', name: '阿杏', avatar: '', favor: 80, mood: 50, pregnant: 1, heirs: 0 },
            { charId: 'b', name: '青禾', avatar: '', favor: 60, mood: 60, pregnant: 3, heirs: 0 },
        ];
        const { members, births } = progressPregnancies(ms, 4);
        expect(births.length).toBe(1);
        expect(births[0].charId).toBe('a');
        const a = members.find(m => m.charId === 'a')!;
        expect(a.pregnant).toBe(0);
        expect(a.heirs).toBe(1);
        expect(a.favor).toBe(88);     // 80 + 8
        expect(a.mood).toBe(68);      // 50 + 18
        expect(members.find(m => m.charId === 'b')!.pregnant).toBe(2); // 3 - 1
    });
    it('承欢后次日结算受孕：endDay→advanceDay 给 lastNightWith 标孕', () => {
        // 直接走 advanceDay 路径：用 resolveHaremEvent favorNight 传召 → 次日可能受孕
        // 这里用确定性：手搓一个 lastNightWith + 高宠成员，反复跑直到出现孕（概率必然命中）
        let conceivedSomewhere = false;
        for (let i = 0; i < 200 && !conceivedSomewhere; i++) {
            const s = initHaremGame([{ charId: 'a', name: '阿杏', avatar: '', affection: 90 }]);
            const withNight: HaremState = { ...s, lastNightWith: 'a', pendingEvent: { type: 'favorNight', emoji: '🌛', title: '侍寝', text: '', subjectIds: ['a'], options: [{ label: 'ok', tone: 'good' }] } };
            const out = resolveHaremEvent(withNight, 0);
            if ((out.members[0].pregnant || 0) > 0) conceivedSomewhere = true;
        }
        expect(conceivedSomewhere).toBe(true);
    });
});

describe('haremGame · 选秀 / 头衔', () => {
    it('addMembers 去重并入，记一条起居注', () => {
        const s = initHaremGame(seeds);
        const out = addMembers(s, [
            { charId: 'a', name: '阿杏', avatar: '' },              // 已在，去重
            { charId: 'c', name: '新人', avatar: '', affection: 35 },
        ]);
        expect(out.members.length).toBe(3);
        expect(out.members.find(m => m.charId === 'c')!.favor).toBe(35);
        expect(out.log[0].text).toContain('选秀');
    });
    it('memberTitles：宠冠 / 协理六宫 / 有孕 / 皇嗣', () => {
        const ms: HaremMember[] = [
            { charId: 'a', name: 'A', avatar: '', favor: 90, mood: 60, pregnant: 2, heirs: 1 },
            { charId: 'b', name: 'B', avatar: '', favor: 40, mood: 60 },
        ];
        const t = memberTitles(ms, ms[0]);
        expect(t).toContain('宠冠');
        expect(t).toContain('协理六宫');
        expect(t).toContain('有孕');
        expect(t).toContain('皇嗣×1');
        expect(memberTitles(ms, ms[1])).not.toContain('宠冠');
    });
});

describe('haremGame · AI 解析', () => {
    const members: HaremMember[] = [
        { charId: 'a', name: '阿杏', avatar: '', favor: 60, mood: 60 },
        { charId: 'b', name: '青禾', avatar: '', favor: 55, mood: 50 },
    ];
    it('parseAINightEvent：映射名字→charId、夹紧数值、按净值定 tone', () => {
        const raw = '```json\n{"emoji":"⚔️","title":"争锋","text":"二人起了龃龉","options":[' +
            '{"label":"偏向阿杏","result":"青禾悻悻","effects":[{"name":"阿杏","favor":99,"mood":5},{"name":"青禾","favor":-8,"mood":-10}]},' +
            '{"label":"各打五十","result":"都消停了","effects":[{"name":"路人甲","favor":5}]}' +
            ']}\n```';
        const ev = parseAINightEvent(raw, members)!;
        expect(ev.type).toBe('ai');
        expect(ev.options.length).toBe(2);
        expect(ev.ai![0].effects[0]).toEqual({ charId: 'a', favor: 20, mood: 5 }); // 99 夹到 20
        expect(ev.options[0].tone).toBe('good');   // 净值 >0
        expect(ev.ai![1].effects.length).toBe(0);  // 路人甲不在册→丢弃
        // 套用第一个选项应改动成员
        const s = { ...initHaremGame([{ charId: 'a', name: '阿杏', avatar: '', affection: 60 }, { charId: 'b', name: '青禾', avatar: '', affection: 55 }]), pendingEvent: ev };
        const out = resolveHaremEvent(s, 0);
        expect(out.members.find(m => m.charId === 'a')!.favor).toBe(80); // 60 +20
        expect(out.pendingEvent).toBeNull();
    });
    it('parseAINightEvent：选项不足 2 个或非 JSON 返回 null', () => {
        expect(parseAINightEvent('{"options":[]}', members)).toBeNull();
        expect(parseAINightEvent('抱歉', members)).toBeNull();
    });
    it('parseConcubineLine：去代码块/引号/名字前缀，取首行', () => {
        expect(parseConcubineLine('```\n阿杏：「臣妾谢陛下隆恩。」\n（含羞）```')).toBe('臣妾谢陛下隆恩。');
        expect(parseConcubineLine('"陛下言重了"')).toBe('陛下言重了');
    });
    it('parseEnding：JSON 取 verdict+fates，非 JSON 当总评', () => {
        const e = parseEnding('{"verdict":"盛宠易逝","fates":[{"name":"阿杏","line":"位至贵妃"}]}');
        expect(e.verdict).toBe('盛宠易逝');
        expect(e.fates[0]).toEqual({ name: '阿杏', line: '位至贵妃' });
        expect(parseEnding('后宫诸事俱付笑谈').verdict).toContain('后宫诸事');
    });
    it('fallbackEnding：无 API 也能按数据成传', () => {
        const s = initHaremGame(seeds);
        const e = fallbackEnding(s);
        expect(e.verdict.length).toBeGreaterThan(0);
        expect(e.fates.length).toBe(2);
    });
    it('buildAINightEventPrompt 含人物名与 JSON 约束', () => {
        const { user } = buildAINightEventPrompt(initHaremGame(seeds));
        expect(user).toContain('阿杏');
        expect(user).toContain('effects');
    });
});
