import { describe, it, expect } from 'vitest';
import {
    initStory, stageOf, deriveAttitude, advanceTime, scheduleCast, determineTurnType,
    parseScene, applyChoice, applyCustomAction, visitCharacter, fallbackScene,
    consolidateMemories, checkEndings, computeEndingProgress, buildScenePrompt,
    startNewGamePlus, reviveStory, saveMetaOf, updateRelationships, relationshipSummary,
    bondLabel, GENDER_WORD, RULER_PRESETS, DEFAULT_SETTINGS, HEAT_LABELS,
    applyResourceDelta, applyMapAction, availableLocations, advanceChapter, unlockAchievement,
    buildActionJudgementPrompt, parseActionJudgement, applyActionJudgement, expireGeneratedHooks,
    previewFavorAction, applyFavorAction, favorCourtSummary,
    GLOBAL_MEMORY_CAP, type StoryState, type StoryScene, type StorySeed, type StoryMemory,
} from './haremStory';

const seeds: StorySeed[] = [
    { charId: 'a', name: '阿杏', avatar: '', affection: 40, persona: '温婉' },
    { charId: 'b', name: '青禾', avatar: '', affection: 20, persona: '清冷' },
    { charId: 'c', name: '沈鸢', avatar: '', affection: 60, persona: '泼辣' },
];
const newGame = (): StoryState => initStory(seeds, { name: '萧珩', title: '陛下' });

/** 造一个最小可用的场景（applyChoice 用 choices；自由行动/择幸不读 choices）。 */
const miniScene = (choices: StoryScene['choices'] = []): StoryScene => ({
    sceneTitle: '小景', narration: 'n', dialogues: [], choices,
    effectsPreview: '', memoryUpdates: [], flagUpdates: {}, nextSceneHint: '', turnType: 'daily',
});

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

describe('haremStory · 长线主线 / 地图 / 资源', () => {
    it('initStory：新局带章节、目标、资源、地图、背包和成就默认值', () => {
        const s = newGame();
        expect(s.version).toBeGreaterThanOrEqual(2);
        expect(s.chapter.title).toBe('初入椒房');
        expect(s.objectives.some(o => o.kind === 'main')).toBe(true);
        expect(s.resources.energy).toBeGreaterThan(0);
        expect(s.map.unlocked).toContain('jiaofang');
        expect(s.inventory).toEqual([]);
        expect(s.achievements).toEqual([]);
        expect(s.favorLedger).toEqual([]);
    });
    it('availableLocations：按日期和章节解锁地点', () => {
        const s = newGame();
        expect(availableLocations(s).map(l => l.id)).toContain('garden');
        expect(availableLocations(s).map(l => l.id)).not.toContain('treasury');
        s.day = 32;
        s.chapter = { id: 'balance', index: 5, title: '权衡恩宠', subtitle: '', minDay: 32, goal: 46, progress: 0, completed: false, finaleReady: false };
        expect(availableLocations(s).map(l => l.id)).toContain('treasury');
    });
    it('applyResourceDelta：资源钳制在合法范围', () => {
        const s = newGame();
        const next = applyResourceDelta(s.resources, { energy: -999, silver: 9999, rumor: 200 });
        expect(next.energy).toBe(0);
        expect(next.silver).toBe(999);
        expect(next.rumor).toBe(100);
    });
    it('advanceChapter：主线进度达标且到达日期后推进下一章', () => {
        const s = newGame();
        s.day = 8;
        s.chapter.progress = s.chapter.goal;
        const next = advanceChapter(s);
        expect(next.chapter.index).toBe(2);
        expect(next.objectives.some(o => o.chapterId === next.chapter.id && o.kind === 'main')).toBe(true);
    });
    it('applyMapAction：地图行动消耗资源、记录地点，并让下一幕围绕该地点', () => {
        const s = newGame();
        const sc = miniScene([{ text: '收束此幕', tone: '平和', effects: [{ charId: 'a', affection: 1 }], risk: 'low', nextIntent: '改道' }]);
        const next = applyMapAction(s, sc, { locationId: 'garden', action: 'explore', label: '御花园 · 探访' }, () => 0);
        expect(next.location).toBe('御花园');
        expect(next.mapIntent?.locationId).toBe('garden');
        expect(next.map.visited.garden).toBe(1);
        expect(next.resources.energy).toBeLessThan(s.resources.energy);
        expect(next.currentScene).toBeNull();
    });
    it('unlockAchievement：同一成就只落印一次', () => {
        const s = newGame();
        const one = unlockAchievement(s, { id: 'seal', title: '小印', description: '记一笔' });
        const two = unlockAchievement(one, { id: 'seal', title: '小印', description: '记一笔' });
        expect(one.achievements.length).toBe(1);
        expect(two.achievements.length).toBe(1);
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
        s.day = 46;
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
    it('parseScene：长剧情旁白、心声和选项意图不会被短上限截断', () => {
        const s = newGame();
        const longNarration = `${'宫灯照着帘幕，旧事在风里慢慢翻涌。'.repeat(10)}\n\n${'阿杏垂着眼，像把没有说出口的话都压在袖中。'.repeat(8)}`;
        const longInner = '她知道这句话一旦说出口，便不只是撒娇，而是在众人面前向陛下讨一个明白。'.repeat(3);
        const longIntent = '顺着这场试探继续展开，让阿杏看见陛下的态度，也让旁人意识到这份恩宠并非随口一句。'.repeat(4);
        const raw = JSON.stringify({
            narration: longNarration,
            dialogues: [{ speaker: '阿杏', text: '陛下若只当臣妾是在闹，臣妾便不说了。可这些日子宫里风声太密，臣妾也会怕。', inner: longInner }],
            choices: [
                { text: '放缓语气，先问她究竟听见了什么', effects: [{ charId: 'a', trust: 2 }], nextIntent: longIntent },
                { text: '当众护她一句，让旁人知道轻重', effects: [{ charId: 'a', affection: 3 }], nextIntent: '护持' },
                { text: '暂且不表态，只让她近前奉茶', effects: [{ charId: 'a', mood: -1 }], nextIntent: '观望' },
            ],
        });
        const sc = parseScene(raw, s)!;
        expect(sc.narration).toBe(longNarration);
        expect(sc.dialogues[0].inner?.length).toBeGreaterThan(90);
        expect(sc.choices[0].nextIntent.length).toBeGreaterThan(100);
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
        s.day = 20;
        s.characters.c.jealousy = 98; s.characters.c.trust = 20;
        const e = checkEndings(s, true)!;
        expect(e.key).toBe('jealousy_ruin');
    });
    it('一生一世：锁线主角好感/信任高、嫉妒低 → true_love', () => {
        const s = newGame();
        s.day = 60;
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
    it('buildScenePrompt：含 15 条铁律、长剧情要求、角色名、JSON schema 约束', () => {
        const { system, user } = buildScenePrompt(newGame(), { opening: true });
        expect(system).toContain('恰好 3 个');
        expect(system).toContain('长剧情单幕');
        expect(system).toContain('2~4 段');
        expect(system).toContain('4~8 条');
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

describe('haremStory · 性别开放（女帝男妃等任意组合）', () => {
    it('玩家与角色性别可独立设定，缺省 unknown', () => {
        const s = initStory(
            [{ charId: 'm', name: '裴砚', avatar: '', gender: 'male', affection: 40 }, { charId: 'f', name: '苏窈', avatar: '', gender: 'female' }],
            { name: '昭', title: '陛下', gender: 'female' },
        );
        expect(s.player.gender).toBe('female');
        expect(s.characters.m.gender).toBe('male');
        expect(s.characters.f.gender).toBe('female');
        expect(newGame().characters.a.gender).toBe('unknown'); // 未指定 → unknown
    });
    it('RULER_PRESETS 含女帝男妃预设；GENDER_WORD 映射', () => {
        expect(RULER_PRESETS.some(p => p.label === '女帝' && p.gender === 'female')).toBe(true);
        expect(GENDER_WORD.male).toBe('男');
    });
    it('prompt 注明性别 + 反默认女性指令；玩家身份带性别', () => {
        const s = initStory(seeds.map(x => ({ ...x, gender: 'male' as const })), { name: '昭', title: '陛下', gender: 'female' });
        const { system, user } = buildScenePrompt(s);
        expect(system).toContain('性别');
        expect(system).toContain('绝不要默认所有角色都是女性');
        expect(user).toContain('女'); // playerIdentity 的「女性」
    });
});

describe('haremStory · 自由行动 / 主动择幸', () => {
    it('applyCustomAction：标记 custom、点名角色成为下一场焦点', () => {
        const s0 = newGame(); s0.activeCharacters = ['a'];
        const s1 = applyCustomAction(s0, miniScene(), '我夜里去藏书阁找青禾说话', () => 0.5);
        expect(s1.lastTurn?.custom).toBe(true);
        expect(s1.lastTurn?.choiceText).toContain('青禾');
        expect(s1.activeCharacters).toEqual(['b']); // 点名青禾 → 下一场只排青禾
        expect(s1.focusHint).toBeNull();             // 焦点用后即清
        expect(s1.turnCount).toBe(1);
    });
    it('visitCharacter：指定下一场要见的人', () => {
        const s0 = newGame(); s0.activeCharacters = ['a'];
        const s1 = visitCharacter(s0, miniScene(), 'c', () => 0.5);
        expect(s1.activeCharacters).toEqual(['c']);
        expect(s1.lastTurn?.custom).toBe(true);
    });
    it('空文本不动', () => {
        const s0 = newGame();
        expect(applyCustomAction(s0, miniScene(), '   ')).toBe(s0);
    });
});

describe('haremStory · 离心 / 回心 / 羁绊', () => {
    it('嫉妒爆表 + 心死 → 离心淡出，并落一条记忆', () => {
        const s0 = newGame(); s0.activeCharacters = ['a'];
        s0.characters.a.jealousy = 95; s0.characters.a.mood = 10; s0.characters.a.trust = 20;
        const s1 = applyChoice(s0, miniScene([{ text: '不理会', tone: '冷', effects: [{ charId: 'a' }], risk: 'mid', nextIntent: '' }]), 0, () => 0.5);
        expect(s1.characters.a.estranged).toBe(true);
        expect(s1.memories.some(m => m.text.includes('心灰意冷'))).toBe(true);
    });
    it('离心者重获信任与好心情 → 回心转意', () => {
        const s0 = newGame(); s0.activeCharacters = ['a'];
        s0.characters.a.estranged = true; s0.characters.a.trust = 50; s0.characters.a.mood = 50;
        const s1 = applyChoice(s0, miniScene([{ text: '温言', tone: '柔', effects: [{ charId: 'a' }], risk: 'low', nextIntent: '' }]), 0, () => 0.5);
        expect(s1.characters.a.estranged).toBe(false);
    });
    it('updateRelationships：同场且都善妒 → 结怨；relationshipSummary 列出显著关系', () => {
        const s = newGame();
        s.characters.a.jealousy = 60; s.characters.b.jealousy = 60;
        const rels = updateRelationships(s.relationships, s.characters, ['a', 'b']);
        const ab = rels.find(r => (r.a === 'a' && r.b === 'b') || (r.a === 'b' && r.b === 'a'))!;
        expect(ab.bond).toBeLessThan(0);
        s.relationships = [{ a: 'a', b: 'b', bond: -50 }];
        expect(relationshipSummary(s)[0]).toContain('势同水火');
        expect(bondLabel(50)).toContain('知己');
    });
});

describe('haremStory · 叙事设定 + 富输出', () => {
    it('initStory 接受 settings；缺省补默认', () => {
        const s = initStory(seeds, { name: 'x', title: '陛下' }, null, { style: 'dark', heat: 3, premise: '架空王朝，女帝篡位' });
        expect(s.settings.style).toBe('dark');
        expect(s.settings.heat).toBe(3);
        expect(s.settings.premise).toContain('架空王朝');
        expect(newGame().settings).toEqual(DEFAULT_SETTINGS);
    });
    it('settings 注入 prompt：风格 / 尺度 / 开场设定', () => {
        const s = initStory(seeds, { name: 'x', title: '陛下' }, null, { style: 'dark', heat: 3, premise: '架空王朝，女帝篡位' });
        const { system } = buildScenePrompt(s);
        expect(system).toContain('暗黑虐心');
        expect(system).toContain(HEAT_LABELS[3]); // 浓烈
        expect(system).toContain('架空王朝');
        expect(system).toContain('不得超出当前好感'); // 尺度仍受好感阶段铁律约束
    });
    it('parseScene 读取 mood 与角色心声 inner', () => {
        const s = newGame();
        const raw = JSON.stringify({
            mood: '缠绵', narration: '夜雨缠绵。',
            dialogues: [{ speaker: '阿杏', text: '嗯…', inner: '其实我欢喜得很' }],
            choices: [{ text: 'A', effects: [{ charId: 'a', affection: 3 }] }, { text: 'B', effects: [{ charId: 'a', trust: 2 }] }, { text: 'C', effects: [{ charId: 'a', mood: 2 }] }],
        });
        const sc = parseScene(raw, s)!;
        expect(sc.mood).toBe('缠绵');
        expect(sc.dialogues[0].inner).toBe('其实我欢喜得很');
    });
    it('parseScene 读取并钳制资源、目标、线索与成就更新', () => {
        const s = newGame();
        const raw = JSON.stringify({
            narration: '尚宫局灯火未歇。',
            choices: [
                { text: 'A', effects: [{ charId: 'a', affection: 3 }] },
                { text: 'B', effects: [{ charId: 'a', trust: 2 }] },
                { text: 'C', effects: [{ charId: 'a', mood: 2 }] },
            ],
            resourceDelta: { power: 99, silver: -999, bogus: 12 },
            objectiveUpdates: [{ progress: 99 }],
            inventoryUpdates: [{ id: 'clue_a', name: '旧账册', kind: 'clue', text: '尚宫局旧账有缺页。', charId: 'a' }],
            achievementUpdates: [{ id: 'ledger', title: '账册初现', description: '发现第一份旧账。' }],
        });
        const sc = parseScene(raw, s)!;
        expect(sc.resourceDelta?.power).toBe(25);
        expect(sc.resourceDelta?.silver).toBe(-80);
        expect(sc.objectiveUpdates?.[0].progress).toBe(16);
        expect(sc.inventoryUpdates?.[0].id).toBe('clue_a');
        expect(sc.achievementUpdates?.[0]).toMatchObject({ id: 'ledger' });
    });
    it('applyChoice 落地 AI 给出的资源、线索、目标与成就', () => {
        const s0 = newGame();
        const sc = miniScene([{ text: '查账', tone: '谨慎', effects: [{ charId: 'a', trust: 1 }], risk: 'mid', nextIntent: '追账' }]);
        sc.resourceDelta = { power: 6, energy: -5 };
        sc.objectiveUpdates = [{ progress: 10 }];
        sc.inventoryUpdates = [{ id: 'book', name: '缺页账册', kind: 'clue', text: '有人抽走了一页账。' }];
        sc.achievementUpdates = [{ id: 'first_clue', title: '一页暗账', description: '收下第一份线索。' }];
        const s1 = applyChoice(s0, sc, 0, () => 0.5);
        expect(s1.resources.power).toBeGreaterThan(s0.resources.power);
        expect(s1.inventory.some(i => i.id === 'book')).toBe(true);
        expect(s1.objectives.find(o => o.kind === 'main')!.progress).toBeGreaterThan(0);
        expect(s1.achievements.some(a => a.id === 'first_clue')).toBe(true);
    });
    it('reviveStory 迁移 settings；旧档缺省补默认', () => {
        const s = initStory(seeds, { name: 'x' }, null, { style: 'sweet', heat: 2 });
        expect(reviveStory(JSON.parse(JSON.stringify(s)))!.settings.style).toBe('sweet');
        const old = reviveStory({ characters: { a: { name: '甲' } } })!;
        expect(old.settings).toEqual(DEFAULT_SETTINGS);
        expect(old.chapter.title).toBe('初入椒房');
        expect(old.resources.energy).toBeGreaterThan(0);
        expect(old.map.unlocked).toContain('jiaofang');
    });
    it('fallbackScene 带 mood', () => {
        expect(fallbackScene(newGame()).mood).toBeTruthy();
    });
});

describe('haremStory · 新增结局', () => {
    it('过半角色离心 → 人心尽失 bad end', () => {
        const s = newGame(); s.day = 30;
        s.characters.a.estranged = true; s.characters.b.estranged = true;
        const e = checkEndings(s, true)!;
        expect(e.key).toBe('estranged_collapse');
    });
    it('60 日后宫权与声望足够 → 凤阙定鼎主线终局', () => {
        const s = newGame(); s.day = 60;
        s.chapter = { id: 'finale', index: 8, title: '终局定鼎', subtitle: '', minDay: 60, goal: 60, progress: 60, completed: true, finaleReady: true };
        s.resources.power = 82; s.resources.reputation = 76; s.resources.energy = 40;
        const e = checkEndings(s, true)!;
        expect(e.key).toBe('imperial_pact');
    });
});

describe('haremStory · 宠爱经营台', () => {
    it('previewFavorAction：非法角色、调停同一人和资源不足会阻止落子', () => {
        const s = newGame();
        expect(previewFavorAction(s, { type: 'summon', targetCharId: 'ghost' }).ok).toBe(false);
        expect(previewFavorAction(s, { type: 'mediate', targetCharId: 'a', secondaryCharId: 'a' }).ok).toBe(false);
        s.resources.silver = 3;
        const poor = previewFavorAction(s, { type: 'balance' });
        expect(poor.ok).toBe(false);
        expect(poor.blockers.join('；')).toContain('库银不足');
    });

    it('六种预设谕旨给出固定资源与角色后果', () => {
        const s = newGame();
        expect(previewFavorAction(s, { type: 'summon', targetCharId: 'a' }).resourceDelta).toMatchObject({ energy: -8, rumor: 2 });
        expect(previewFavorAction(s, { type: 'reward', targetCharId: 'a' }).resourceDelta).toMatchObject({ silver: -12, rumor: 1 });
        expect(previewFavorAction(s, { type: 'protect', targetCharId: 'a' }).effects[0]).toMatchObject({ charId: 'a', trust: 6, jealousy: -4, mood: 3 });
        expect(previewFavorAction(s, { type: 'cool', targetCharId: 'a' }).effects[0]).toMatchObject({ charId: 'a', affection: -3, trust: -2, jealousy: -10, mood: -4 });
        const mediate = previewFavorAction(s, { type: 'mediate', targetCharId: 'a', secondaryCharId: 'b' });
        expect(mediate.resourceDelta).toMatchObject({ energy: -10, reputation: 3, rumor: -4 });
        expect(mediate.relationshipDelta[0]).toMatchObject({ a: 'a', b: 'b', bond: 10 });
        const balance = previewFavorAction(s, { type: 'balance' });
        expect(balance.resourceDelta).toMatchObject({ silver: -18, energy: -8, reputation: 4, rumor: -6 });
        expect(balance.effects.length).toBe(3);
    });

    it('近两日反复召见同一人会额外抬风闻，并牵动高好感旁人嫉妒', () => {
        const s = newGame();
        s.characters.a.affection = 65;
        s.favorLedger = [{
            id: 'favor_old', type: 'summon', title: '召见', actionText: '召见沈鸢',
            day: s.day - 1, time: '晨', targetCharIds: ['c'], resourceDelta: {}, effects: [], relationshipDelta: [], risk: 'low',
        }];
        const preview = previewFavorAction(s, { type: 'summon', targetCharId: 'c' });
        expect(preview.resourceDelta.rumor).toBe(5);
        expect(preview.effects.find(e => e.charId === 'a')?.jealousy).toBe(2);
    });

    it('applyFavorAction：确认后推进回合、写入恩宠账和关系变化', () => {
        const s = newGame();
        const sc = miniScene([{ text: '收束', tone: '平和', effects: [{ charId: 'a' }], risk: 'low', nextIntent: '' }]);
        const next = applyFavorAction(s, sc, { type: 'mediate', targetCharId: 'a', secondaryCharId: 'b' }, () => 0);
        expect(next.currentScene).toBeNull();
        expect(next.time).toBe('午');
        expect(next.lastTurn?.choiceText).toContain('调停');
        expect(next.favorLedger[0].type).toBe('mediate');
        expect(next.relationships.find(r => (r.a === 'a' && r.b === 'b') || (r.a === 'b' && r.b === 'a'))?.bond).toBe(10);
    });

    it('favor 判官入口确认后写入自拟谕旨恩宠账', () => {
        const s = newGame();
        const judgement = parseActionJudgement(JSON.stringify({
            entryPoint: 'favor',
            actionText: '密令尚宫给阿杏添一盏安神灯',
            title: '灯下护持',
            verdict: '这道谕旨温和，却会被近侍记下。',
            risk: 'low',
            cost: { silver: 4 },
            reward: { reputation: 1 },
            effects: [{ charId: 'a', trust: 3, mood: 2 }],
            involvedCharIds: ['a'],
            nextIntent: '让下一幕写阿杏对这盏灯的反应',
            confidence: 80,
        }), s, { entryPoint: 'favor', actionText: 'fallback' })!;
        const next = applyActionJudgement(s, miniScene([{ text: '收束', tone: '平和', effects: [{ charId: 'a' }], risk: 'low', nextIntent: '' }]), judgement, () => 0);
        expect(next.favorLedger[0].type).toBe('draft');
        expect(next.favorLedger[0].actionText).toContain('安神灯');
        expect(next.characters.a.trust).toBe(s.characters.a.trust + 3);
    });

    it('favorCourtSummary 与场景 prompt 能看见恩宠账', () => {
        const s = newGame();
        s.favorLedger = [{
            id: 'favor_prompt', type: 'reward', title: '赐赏', actionText: '赐赏阿杏',
            day: 1, time: '晨', targetCharIds: ['a'], resourceDelta: { silver: -12 }, effects: [{ charId: 'a', affection: 5 }], relationshipDelta: [], risk: 'mid',
        }];
        expect(favorCourtSummary(s).topName).toBe('沈鸢');
        expect(buildScenePrompt(s).user).toContain('最近恩宠账');
        expect(buildScenePrompt(s).user).toContain('赐赏阿杏');
    });
});

describe('haremStory · AI 判官 / 自由行动判定', () => {
    it('buildActionJudgementPrompt：注入入口、资源、目标、地图与玩家行动', () => {
        const s = newGame();
        const prompt = buildActionJudgementPrompt(s, { entryPoint: 'scene', actionText: '夜探藏书阁旧档', context: '自由行动' });
        expect(prompt.system).toContain('判官');
        expect(prompt.user).toContain('scene');
        expect(prompt.user).toContain('夜探藏书阁旧档');
        expect(prompt.user).toContain('资源');
        expect(prompt.user).toContain('目标');
    });

    it('parseActionJudgement：坏 JSON 返回 null；非法角色/地点被忽略，数值被钳制', () => {
        const s = newGame();
        expect(parseActionJudgement('不是 JSON', s, { entryPoint: 'scene', actionText: '试探' })).toBeNull();
        const raw = JSON.stringify({
            actionText: '借风闻试探阿杖',
            risk: 'high',
            cost: { power: 999, energy: 999 },
            reward: { silver: -999, rumor: 999 },
            effects: [{ charId: 'a', affection: 999, trust: -999 }, { charId: 'ghost', affection: 10 }],
            involvedCharIds: ['a', 'ghost'],
            mapIntent: { locationId: 'locked_place', action: 'explore', label: '越权地点' },
            objectiveUpdates: [{ id: 'missing', progress: 999 }],
            inventoryUpdates: [{ id: 'bad_char_item', name: '密札', kind: 'clue', text: '有人伪造手书', charId: 'ghost' }],
            generatedHooks: [{ id: 'hook_one', kind: 'side', title: '旧札疑云', summary: '一封旧札牵出暗线', expiresDay: 999, locationId: 'bad', charId: 'ghost' }],
            rumors: [{ id: 'rumor_one', text: '尚宫局有人夜半焚纸', heat: 999, expiresDay: 999, charId: 'ghost' }],
            npcStubs: [{ id: 'npc_one', name: '小砚', role: '宫人', summary: '常在回廊递信', disposition: '观望', expiresDay: 999, locationId: 'bad' }],
            confidence: 999,
        });
        const j = parseActionJudgement(raw, s, { entryPoint: 'scene', actionText: '兜底' })!;
        expect(j.cost.power).toBe(-25);
        expect(j.reward.silver).toBe(80);
        expect(j.effects).toEqual([{ charId: 'a', affection: 12, trust: -12 }]);
        expect(j.involvedCharIds).toEqual(['a']);
        expect(j.mapIntent).toBeUndefined();
        expect(j.objectiveUpdates![0].id).toBeUndefined();
        expect(j.inventoryUpdates![0].charId).toBeUndefined();
        expect(j.generatedHooks[0].locationId).toBeUndefined();
        expect(j.generatedHooks[0].charId).toBeUndefined();
        expect(j.generatedHooks[0].expiresDay).toBe(s.day + 60);
        expect(j.rumors[0].heat).toBe(100);
        expect(j.npcStubs[0].locationId).toBeUndefined();
        expect(j.confidence).toBe(100);
    });

    it('applyActionJudgement：确认后落地资源、好感、目标、线索、暗线、风闻、NPC 与地图意图', () => {
        const s = newGame();
        s.activeCharacters = ['a'];
        const main = s.objectives.find(o => o.kind === 'main')!;
        const judgement = parseActionJudgement(JSON.stringify({
            id: 'judge_plan',
            entryPoint: 'map',
            actionText: '在御花园放出半真半假的风声',
            title: '借花传声',
            verdict: '此举可行，但会抬高风闻。',
            risk: 'mid',
            cost: { energy: 6 },
            reward: { power: 4, rumor: 5 },
            effects: [{ charId: 'a', trust: 4 }],
            involvedCharIds: ['a'],
            mapIntent: { locationId: 'garden', action: 'gossip', label: '御花园谋划', targetCharId: 'a', note: '让风声先行' },
            objectiveUpdates: [{ id: main.id, progress: 6 }],
            inventoryUpdates: [{ id: 'clue_wind', name: '半真风声', kind: 'clue', text: '御花园里散出的试探。', charId: 'a' }],
            achievementUpdates: [{ id: 'first_judgement', title: '判词初落', description: '确认一次 AI 判词。' }],
            generatedHooks: [{ id: 'side_wind', kind: 'side', title: '花下风声', summary: '追查风声流向。', expiresDay: 12, locationId: 'garden', charId: 'a' }],
            rumors: [{ id: 'rumor_wind', text: '御花园有人刻意试探旧案。', heat: 55, expiresDay: 9, charId: 'a' }],
            npcStubs: [{ id: 'npc_lan', name: '兰儿', role: '洒扫宫人', summary: '听见了风声的去向。', disposition: '谨慎', expiresDay: 14, locationId: 'garden' }],
            nextIntent: '让下一幕围绕风声回流展开',
            confidence: 70,
        }), s, { entryPoint: 'map', actionText: 'fallback' })!;
        const next = applyActionJudgement(s, miniScene([{ text: '收束', tone: '平和', effects: [{ charId: 'a' }], risk: 'low', nextIntent: '' }]), judgement, () => 0);
        expect(next.pendingJudgement).toBeNull();
        expect(next.characters.a.trust).toBe(s.characters.a.trust + 4);
        expect(next.inventory.some(i => i.id === 'clue_wind')).toBe(true);
        expect(next.achievements.some(a => a.id === 'first_judgement')).toBe(true);
        expect(next.generatedHooks.some(h => h.id === 'side_wind')).toBe(true);
        expect(next.objectives.some(o => o.id === 'hook_side_wind')).toBe(true);
        expect(next.rumors.some(r => r.id === 'rumor_wind')).toBe(true);
        expect(next.npcStubs.some(n => n.id === 'npc_lan')).toBe(true);
        expect(next.mapIntent?.locationId).toBe('garden');
        expect(next.map.visited.garden).toBe(1);
        expect(next.objectives.find(o => o.id === main.id)!.progress).toBeGreaterThan(s.objectives.find(o => o.id === main.id)!.progress);
    });

    it('expireGeneratedHooks 与 reviveStory：过期半自动内容清理，旧档补默认字段', () => {
        const s = newGame();
        s.day = 10;
        s.generatedHooks = [{ id: 'old_hook', kind: 'side', title: '旧事', summary: '已过期', source: 'scene', day: 1, expiresDay: 9 }];
        s.rumors = [{ id: 'old_rumor', text: '旧风闻', source: 'scene', day: 1, expiresDay: 9, heat: 20 }];
        s.npcStubs = [{ id: 'old_npc', name: '旧人', role: '宫人', summary: '已离开', disposition: '沉默', source: 'scene', day: 1, expiresDay: 9 }];
        const cleaned = expireGeneratedHooks(s);
        expect(cleaned.generatedHooks).toEqual([]);
        expect(cleaned.rumors).toEqual([]);
        expect(cleaned.npcStubs).toEqual([]);

        const old = reviveStory({ characters: { a: { name: '旧档角色' } }, day: 3 })!;
        expect(old.generatedHooks).toEqual([]);
        expect(old.rumors).toEqual([]);
        expect(old.npcStubs).toEqual([]);
        expect(old.pendingJudgement).toBeNull();
        expect(old.favorLedger).toEqual([]);
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
