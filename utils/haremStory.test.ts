import { describe, it, expect } from 'vitest';
import {
    initStory, stageOf, deriveAttitude, advanceTime, scheduleCast, determineTurnType,
    parseScene, applyChoice, fallbackScene, consolidateMemories, checkEndings,
    computeEndingProgress, buildScenePrompt, startNewGamePlus, reviveStory, saveMetaOf,
    GLOBAL_MEMORY_CAP, type StoryState, type StoryScene, type StorySeed, type StoryMemory,
} from './haremStory';

const seeds: StorySeed[] = [
    { charId: 'a', name: '阿杏', avatar: '', affection: 40, persona: '温婉' },
    { charId: 'b', name: '青禾', avatar: '', affection: 20, persona: '清冷' },
    { charId: 'c', name: '沈鸢', avatar: '', affection: 60, persona: '泼辣' },
];
const newGame = (): StoryState => initStory(seeds, { name: '萧珩', title: '陛下' });

describe('haremStory · 角色状态', () => {
    it('initStory：好感取真实值、信任/嫉妒/心情有默认、阶段/态度被推导', () => {
        const s = newGame();
        expect(s.characters.a.affection).toBe(40);
        expect(s.characters.b.affection).toBe(20);
        expect(s.characters.a.trust).toBe(35);
        expect(s.characters.a.jealousy).toBe(10);
        expect(s.characters.a.stage).toBe(stageOf(40).key);
        expect(s.characters.a.attitude.length).toBeGreaterThan(0);
        expect(s.day).toBe(1);
        expect(s.time).toBe('晨');
        expect(s.playthrough).toBe(1);
    });
    it('stageOf 按好感阈值单调映射', () => {
        expect(stageOf(0).label).toBe('陌路');
        expect(stageOf(50).label).toBe('暧昧');
        expect(stageOf(100).label).toBe('挚爱');
    });
    it('deriveAttitude 反映嫉妒/信任/心情', () => {
        expect(deriveAttitude({ affection: 50, trust: 50, jealousy: 80, mood: 60 })).toBe('醋意翻涌');
        expect(deriveAttitude({ affection: 50, trust: 10, jealousy: 10, mood: 60 })).toBe('戒备试探');
        expect(deriveAttitude({ affection: 90, trust: 80, jealousy: 10, mood: 70 })).toBe('情根深种');
    });
});

describe('haremStory · 时辰推进', () => {
    it('晨→午→晚→夜→次日晨', () => {
        expect(advanceTime('晨', 1)).toEqual({ time: '午', day: 1 });
        expect(advanceTime('晚', 1)).toEqual({ time: '夜', day: 1 });
        expect(advanceTime('夜', 1)).toEqual({ time: '晨', day: 2 });
    });
});

describe('haremStory · 回合判定与调度', () => {
    it('嫉妒≥70 触发嫉妒爆发回合', () => {
        const s = newGame();
        s.characters.c.jealousy = 85;
        expect(determineTurnType(s, () => 0)).toBe('jealousy');
    });
    it('硬结局条件满足 → ending 回合', () => {
        const s = newGame();
        s.day = 9;
        Object.values(s.characters).forEach(c => { c.affection = 20; });
        expect(determineTurnType(s, () => 0)).toBe('ending');
    });
    it('scheduleCast：约会只排一人；多人同场排 2~3 人', () => {
        const s = newGame();
        expect(scheduleCast(s, 'date', () => 0.9).length).toBe(1);
        expect(scheduleCast(s, 'group', () => 0).length).toBeGreaterThanOrEqual(2);
    });
    it('scheduleCast：嫉妒回合排「最妒者 + 对手」', () => {
        const s = newGame();
        s.characters.b.jealousy = 90;
        const cast = scheduleCast(s, 'jealousy', () => 0);
        expect(cast[0]).toBe('b');
        expect(cast.length).toBe(2);
    });
});

describe('haremStory · AI 输出解析', () => {
    const okJson = JSON.stringify({
        sceneTitle: '初见',
        narration: '春寒料峭，阿杏立于廊下。',
        dialogues: [{ speaker: '阿杏', text: '陛下来了。', emotion: '羞怯' }],
        choices: [
            { text: '上前执手', tone: '温柔', effects: [{ charId: 'a', affection: 6, trust: 3 }], risk: 'low', nextIntent: '拉近' },
            { text: '只远远看着', tone: '克制', effects: [{ charId: 'a', affection: 1 }], risk: 'low', nextIntent: '观望' },
            { text: '出言试探', tone: '试探', effects: [{ charId: 'a', trust: -2, mood: -3 }], risk: 'mid', nextIntent: '试探' },
        ],
        effectsPreview: '一念之间',
        memoryUpdates: [{ charId: 'a', text: '陛下廊下相见', kind: 'event', weight: 2 }],
        flagUpdates: { met_a: true },
        nextSceneHint: '约会',
    });

    it('parseScene：解析齐整、speaker 映射 charId、保留 3 选项', () => {
        const s = newGame();
        const sc = parseScene(okJson, s)!;
        expect(sc.sceneTitle).toBe('初见');
        expect(sc.dialogues[0].charId).toBe('a');
        expect(sc.choices.length).toBe(3);
        expect(sc.memoryUpdates[0].charId).toBe('a');
        expect(sc.flagUpdates.met_a).toBe(true);
    });
    it('parseScene：少于 3 个选项时补齐到 3', () => {
        const s = newGame();
        const raw = JSON.stringify({ narration: '一段独景。', choices: [{ text: '只一个选项', effects: [{ charId: 'a', affection: 2 }] }] });
        const sc = parseScene(raw, s)!;
        expect(sc.choices.length).toBe(3);
        expect(sc.choices[1].effects.length).toBeGreaterThan(0); // 兜底选项也带 effects
    });
    it('parseScene：effects 数值被钳制', () => {
        const s = newGame();
        const raw = JSON.stringify({ narration: 'x', choices: [
            { text: 'A', effects: [{ charId: 'a', affection: 999 }] },
            { text: 'B', effects: [{ charId: 'a', jealousy: -999 }] },
            { text: 'C', effects: [{ charId: 'a', mood: 5 }] },
        ] });
        const sc = parseScene(raw, s)!;
        expect(sc.choices[0].effects[0].affection).toBe(12);
        expect(sc.choices[1].effects[0].jealousy).toBe(-15);
    });
    it('parseScene：空内容 / 非 JSON → null（交给兜底）', () => {
        const s = newGame();
        expect(parseScene('抱歉我不能', s)).toBeNull();
        expect(parseScene(JSON.stringify({ narration: '', dialogues: [] }), s)).toBeNull();
    });
    it('fallbackScene 永远给 3 个选项且可玩', () => {
        const s = newGame();
        const sc = fallbackScene(s);
        expect(sc.choices.length).toBe(3);
        expect(sc.narration.length).toBeGreaterThan(0);
    });
});

describe('haremStory · 落地一次选择', () => {
    const baseScene = (): StoryScene => ({
        sceneTitle: '御花园同游', narration: '...', dialogues: [],
        choices: [
            { text: '独宠阿杏', tone: '专一', effects: [{ charId: 'a', affection: 10, trust: 5 }], risk: 'mid', nextIntent: '偏宠' },
            { text: '雨露均沾', tone: '周全', effects: [{ charId: 'a', affection: 2 }, { charId: 'b', affection: 2 }], risk: 'low', nextIntent: '平衡' },
            { text: '冷淡', tone: '冷淡', effects: [{ charId: 'a', affection: -4 }], risk: 'high', nextIntent: '疏远' },
        ],
        effectsPreview: '', memoryUpdates: [{ charId: 'a', text: '同游御花园', kind: 'intimacy', weight: 3 }], flagUpdates: { garden: true }, nextSceneHint: '',
    });

    it('applyChoice：套用 effects、写记忆/flag、推进时辰、清空 currentScene', () => {
        const s0 = newGame();
        s0.activeCharacters = ['a', 'b'];
        const s1 = applyChoice(s0, baseScene(), 0, () => 0.5);
        expect(s1.characters.a.affection).toBe(50); // 40 + 10
        expect(s1.characters.a.trust).toBe(40);     // 35 + 5
        expect(s1.flags.garden).toBe(true);
        expect(s1.memories[0].text).toBe('同游御花园');
        expect(s1.characters.a.memories[0].text).toBe('同游御花园'); // 角色独立记忆
        expect(s1.time).toBe('午');                  // 晨→午
        expect(s1.currentScene).toBeNull();
        expect(s1.turnCount).toBe(1);
        expect(s1.lastTurn?.choiceText).toBe('独宠阿杏');
    });

    it('applyChoice：偏宠一人时，在场被冷落者嫉妒上升（规则 ⑤/⑥）', () => {
        const s0 = newGame();
        s0.activeCharacters = ['a', 'b'];
        const j0 = s0.characters.b.jealousy;
        const s1 = applyChoice(s0, baseScene(), 0, () => 0.5); // 只宠 a
        expect(s1.characters.b.jealousy).toBeGreaterThan(j0);
    });

    it('applyChoice：登场公平——在场者 streak 清零、未登场者 +1', () => {
        const s0 = newGame();
        s0.activeCharacters = ['a'];
        const s1 = applyChoice(s0, baseScene(), 1, () => 0.5);
        expect(s1.characters.a.presentStreak).toBe(0);
        expect(s1.characters.c.presentStreak).toBe(1); // c 未登场
    });

    it('路线锁定回合选了偏宠 → 锁线并标记', () => {
        const s0 = newGame();
        s0.turnType = 'route_lock';
        s0.activeCharacters = ['a'];
        const s1 = applyChoice(s0, baseScene(), 0, () => 0.5);
        expect(s1.route.locked).toBe(true);
        expect(s1.route.charId).toBe('a');
        expect(s1.characters.a.flags.route).toBe(true);
    });
});

describe('haremStory · 记忆固化', () => {
    it('consolidateMemories：超上限时保留高权重，丢低权重久远', () => {
        const mems: StoryMemory[] = [];
        for (let i = 0; i < GLOBAL_MEMORY_CAP + 10; i++) {
            mems.push({ id: `m${i}`, day: 1, text: `t${i}`, weight: 1, kind: 'event' });
        }
        const keep: StoryMemory = { id: 'gold', day: 1, text: '金色记忆', weight: 5, kind: 'promise' };
        mems.push(keep);
        const out = consolidateMemories(mems, GLOBAL_MEMORY_CAP);
        expect(out.length).toBe(GLOBAL_MEMORY_CAP);
        expect(out.some(m => m.id === 'gold')).toBe(true);
    });
});

describe('haremStory · 结局判定', () => {
    it('善妒倾覆：有人嫉妒爆表且信任低 → 红颜祸水 bad end', () => {
        const s = newGame();
        s.day = 6;
        s.characters.c.jealousy = 98; s.characters.c.trust = 20;
        const e = checkEndings(s, true)!;
        expect(e.key).toBe('jealousy_ruin');
    });
    it('一生一世：锁线主角好感/信任高、嫉妒低 → true_love', () => {
        const s = newGame();
        s.day = 10;
        s.route = { locked: true, charId: 'c', progress: 100 };
        s.characters.c.affection = 92; s.characters.c.trust = 85; s.characters.c.jealousy = 20;
        const e = checkEndings(s, true)!;
        expect(e.key).toBe('true_love');
    });
    it('computeEndingProgress 给出 0~100 的进度表', () => {
        const s = newGame();
        const prog = computeEndingProgress(s);
        expect(typeof prog.true_love).toBe('number');
        expect(prog.true_love).toBeGreaterThanOrEqual(0);
        expect(prog.true_love).toBeLessThanOrEqual(100);
    });
    it('未到任何硬条件时 checkEndings(hardOnly) 为 null', () => {
        expect(checkEndings(newGame(), true)).toBeNull();
    });
});

describe('haremStory · prompt 与多周目', () => {
    it('buildScenePrompt：含 14 条铁律、角色名、JSON schema 约束', () => {
        const { system, user } = buildScenePrompt(newGame(), { opening: true });
        expect(system).toContain('恰好 3 个');
        expect(system).toContain('choices');
        expect(user).toContain('阿杏');
        expect(user).toContain('第 1 日');
    });
    it('startNewGamePlus：周目+1，带前尘旧梦 carry', () => {
        const s = newGame();
        s.memories.unshift({ id: 'k', day: 3, text: '你与沈鸢定情', weight: 5, kind: 'promise', charId: 'c' });
        s.route = { locked: true, charId: 'c', progress: 100 };
        const ng = startNewGamePlus(s, seeds);
        expect(ng.playthrough).toBe(2);
        expect(ng.carry?.notes.length).toBeGreaterThan(0);
        expect(ng.characters.c.affection).toBe(60); // 角色重新从真实好感起步
    });
});

describe('haremStory · 存档读档', () => {
    it('reviveStory：往返序列化字段齐全，坏档返回 null', () => {
        const s = newGame();
        const round = reviveStory(JSON.parse(JSON.stringify(s)))!;
        expect(round.characters.a.affection).toBe(40);
        expect(round.day).toBe(1);
        expect(reviveStory({})).toBeNull();
        expect(reviveStory(null)).toBeNull();
    });
    it('saveMetaOf：给出存档摘要', () => {
        const s = newGame();
        const meta = saveMetaOf(s);
        expect(meta.day).toBe(1);
        expect(meta.topName).toBe('沈鸢'); // 好感最高
        expect(meta.playthrough).toBe(1);
    });
});
