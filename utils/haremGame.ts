/**
 * 椒房记 —— 后宫养成·文字卡游戏（纯逻辑，无 DB / React）。
 *
 * 玩法：你是君主，从通讯录里选几位组成「后宫」。每一「日」有若干行动点，
 * 手牌是一叠「文字卡」（同游 / 夜话 / 赐礼 / 设宴 / 独宠 / 冷落…），打出去作用到某位身上，
 * 涨/降「宠爱」与「心情」，宠爱越高位分越高（答应→…→皇贵妃）。
 * 「就寝」进入下一日：可能触发夜间事件（争宠 / 吃醋 / 谗言 / 侍寝 / 喜讯），由你抉择，影响后宫。
 *
 * 游戏数据完全独立于真实好感（仅开局时拿真实 affection 当起点），不回写角色档案。
 * pendingEvent / 全部状态均可序列化，方便整盘存 localStorage。
 */

export interface HaremRank { key: string; label: string; min: number; }
export const HAREM_RANKS: HaremRank[] = [
    { key: 'da', label: '答应', min: 0 },
    { key: 'chang', label: '常在', min: 25 },
    { key: 'gui', label: '贵人', min: 40 },
    { key: 'pin', label: '嫔', min: 55 },
    { key: 'fei', label: '妃', min: 70 },
    { key: 'guifei', label: '贵妃', min: 85 },
    { key: 'huang', label: '皇贵妃', min: 96 },
];

export const rankOf = (favor: number): HaremRank => {
    let r = HAREM_RANKS[0];
    for (const rk of HAREM_RANKS) if (favor >= rk.min) r = rk;
    return r;
};

export type CardKind = 'love' | 'night' | 'gift' | 'exclusive' | 'group' | 'cool' | 'mend';

export interface HaremCard {
    id: string;
    name: string;
    emoji: string;
    kind: CardKind;
    energy: number;       // 行动点消耗
    favor: number;        // 对目标的宠爱变化
    mood: number;         // 对目标的心情变化
    targeted: boolean;    // 是否需要选一位（false = 作用全体）
    flavor: string;       // 叙述模板，{name} 替换为目标名
    ripple?: { favor: number; mood: number };  // 对其余诸位的连带影响（独宠类用）
}

export const ACTION_DECK: HaremCard[] = [
    { id: 'garden', name: '同游御花园', emoji: '🌸', kind: 'love', energy: 1, favor: 6, mood: 4, targeted: true, flavor: '携{name}同游御花园，落花满肩，相视而笑。' },
    { id: 'meal', name: '共膳叙话', emoji: '🍵', kind: 'love', energy: 1, favor: 5, mood: 3, targeted: true, flavor: '与{name}对坐共膳，絮絮说了许多家常。' },
    { id: 'zither', name: '听{name}抚琴', emoji: '🎶', kind: 'love', energy: 1, favor: 5, mood: 5, targeted: true, flavor: '听{name}抚一曲，余音绕梁，心都静了。' },
    { id: 'poem', name: '题诗相赠', emoji: '📜', kind: 'love', energy: 1, favor: 7, mood: 2, targeted: true, flavor: '亲笔题诗一首赠予{name}，{name}珍而重之地收下了。' },
    { id: 'stroll', name: '微服同行', emoji: '👘', kind: 'love', energy: 1, favor: 8, mood: 4, targeted: true, flavor: '微服带{name}出宫逛了半日市井，难得的自在。' },
    { id: 'visit', name: '病中探望', emoji: '🩹', kind: 'love', energy: 1, favor: 8, mood: 9, targeted: true, flavor: '{name}抱恙，你亲自守了一夜，{name}红了眼眶。' },
    { id: 'nighttalk', name: '夜话至深', emoji: '🌙', kind: 'night', energy: 1, favor: 9, mood: 5, targeted: true, flavor: '与{name}秉烛夜谈，直到更漏将尽，意犹未尽。' },
    { id: 'carriage', name: '同辇而行', emoji: '🛕', kind: 'night', energy: 2, favor: 11, mood: 6, targeted: true, flavor: '特许{name}同辇而行，满宫艳羡，{name}面颊绯红。' },
    { id: 'hairpin', name: '赐金步摇', emoji: '💎', kind: 'gift', energy: 2, favor: 12, mood: 5, targeted: true, flavor: '赐{name}一支赤金嵌宝步摇，金光衬得人更娇。' },
    { id: 'silk', name: '赏赐绫罗', emoji: '🧧', kind: 'gift', energy: 1, favor: 9, mood: 4, targeted: true, flavor: '赏了{name}十匹云锦绫罗，体面又风光。' },
    { id: 'exclusive', name: '独宠一夜', emoji: '🕯️', kind: 'exclusive', energy: 2, favor: 14, mood: 6, targeted: true, flavor: '今夜只翻{name}的牌子，专房之宠，羡煞旁人。', ripple: { favor: -3, mood: -6 } },
    { id: 'banquet', name: '设家宴', emoji: '🏮', kind: 'group', energy: 1, favor: 3, mood: 2, targeted: false, flavor: '设一席家宴，阖宫同乐，其乐融融。' },
    { id: 'festival', name: '普天同庆', emoji: '🎆', kind: 'group', energy: 2, favor: 4, mood: 4, targeted: false, flavor: '逢年节大赦后宫、人人有赏，普天同庆。' },
    { id: 'cold', name: '冷落', emoji: '❄️', kind: 'cool', energy: 1, favor: -6, mood: -9, targeted: true, flavor: '一连多日不见{name}，{name}独守空房，心下惴惴。' },
    { id: 'comfort', name: '温言抚慰', emoji: '🕊️', kind: 'mend', energy: 1, favor: 2, mood: 16, targeted: true, flavor: '好言宽慰了{name}一番，{name}郁结渐解、破涕为笑。' },
];

export const getCard = (id: string): HaremCard | undefined => ACTION_DECK.find(c => c.id === id);

export interface HaremMember {
    charId: string;
    name: string;
    avatar: string;
    favor: number;   // 宠爱 0-100
    mood: number;    // 心情 0-100
}

export type LogTone = 'good' | 'bad' | 'neutral' | 'event';
export interface HaremLogEntry { id: string; day: number; text: string; tone: LogTone; }

export interface HaremEventOption { label: string; tone: LogTone; }
export interface HaremPendingEvent {
    type: 'rivalry' | 'jealous' | 'slander' | 'favorNight' | 'blessing';
    emoji: string;
    title: string;
    text: string;
    subjectIds: string[];      // 涉及的成员（按需在 resolver 里取）
    options: HaremEventOption[];
}

export interface HaremState {
    day: number;
    energy: number;
    maxEnergy: number;
    members: HaremMember[];
    hand: string[];            // card id
    log: HaremLogEntry[];
    pendingEvent?: HaremPendingEvent | null;
    createdAt: number;
}

const clamp = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));
let _seq = 0;
const lid = (): string => `${Date.now().toString(36)}${(_seq++).toString(36)}`;

const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

export const HAND_SIZE = 4;
export const DEFAULT_MAX_ENERGY = 3;

/** 抽一手牌（允许重复，更随机）。 */
export const drawHand = (n: number = HAND_SIZE): string[] =>
    Array.from({ length: n }, () => pick(ACTION_DECK).id);

const log = (state: HaremState, text: string, tone: LogTone): HaremLogEntry =>
    ({ id: lid(), day: state.day, text, tone });

/** 开一盘新游戏：成员宠爱从真实好感起步（缺省 40），心情统一 60。 */
export function initHaremGame(seeds: { charId: string; name: string; avatar: string; affection?: number }[]): HaremState {
    const members: HaremMember[] = seeds.map(s => ({
        charId: s.charId, name: s.name, avatar: s.avatar,
        favor: clamp(typeof s.affection === 'number' ? s.affection : 40),
        mood: 60,
    }));
    const state: HaremState = {
        day: 1, energy: DEFAULT_MAX_ENERGY, maxEnergy: DEFAULT_MAX_ENERGY,
        members, hand: drawHand(), log: [], pendingEvent: null, createdAt: Date.now(),
    };
    state.log = [{ id: lid(), day: 1, text: `后宫初成，共纳 ${members.length} 位。第一日，万象更新。`, tone: 'event' as LogTone }];
    return state;
}

const fmt = (tpl: string, name: string): string => tpl.replace(/\{name\}/g, name);

/** 打出一张手牌（targetId 仅 targeted 卡需要）。能量不足 / 找不到目标时原样返回。 */
export function playCard(state: HaremState, cardId: string, targetId?: string): HaremState {
    const card = getCard(cardId);
    if (!card) return state;
    const handIdx = state.hand.indexOf(cardId);
    if (handIdx === -1 || state.energy < card.energy) return state;

    let members = state.members.map(m => ({ ...m }));
    const newLogs: HaremLogEntry[] = [];
    const next: HaremState = { ...state, members, log: state.log };

    if (card.targeted) {
        const t = members.find(m => m.charId === targetId);
        if (!t) return state;
        const beforeRank = rankOf(t.favor).key;
        t.favor = clamp(t.favor + card.favor);
        t.mood = clamp(t.mood + card.mood);
        newLogs.push(log(next, fmt(card.flavor, t.name), card.favor < 0 ? 'bad' : 'good'));
        // 连带（独宠类）：其余诸位失落
        if (card.ripple) {
            members.forEach(m => {
                if (m.charId === t.charId) return;
                m.favor = clamp(m.favor + card.ripple!.favor);
                m.mood = clamp(m.mood + card.ripple!.mood);
            });
            newLogs.push(log(next, '专房之宠惹得其余诸位黯然失色。', 'bad'));
        }
        const afterRank = rankOf(t.favor).key;
        if (afterRank !== beforeRank && card.favor > 0) {
            newLogs.push(log(next, `🎉 ${t.name} 晋为「${rankOf(t.favor).label}」，阖宫道贺。`, 'good'));
        }
    } else {
        // 全体卡
        members.forEach(m => {
            const beforeRank = rankOf(m.favor).key;
            m.favor = clamp(m.favor + card.favor);
            m.mood = clamp(m.mood + card.mood);
            const afterRank = rankOf(m.favor).key;
            if (afterRank !== beforeRank && card.favor > 0) {
                newLogs.push(log(next, `🎉 ${m.name} 晋为「${rankOf(m.favor).label}」。`, 'good'));
            }
        });
        newLogs.push(log(next, card.flavor, 'good'));
    }

    const hand = state.hand.slice();
    hand.splice(handIdx, 1);
    return {
        ...state,
        members,
        energy: state.energy - card.energy,
        hand,
        log: [...newLogs.reverse(), ...state.log].slice(0, 60),
    };
}

const byFavorDesc = (members: HaremMember[]) => [...members].sort((a, b) => b.favor - a.favor);

/** 生成一个夜间事件（可能为 null = 平安夜）。 */
function rollNightEvent(state: HaremState): HaremPendingEvent | null {
    const ranked = byFavorDesc(state.members);
    if (ranked.length === 0) return null;
    // 50% 概率有事
    if (Math.random() < 0.5) return null;

    const top = ranked[0];
    const second = ranked[1];
    const sulky = ranked.find(m => m.favor >= 40 && m.mood < 40);

    const candidates: (() => HaremPendingEvent)[] = [];

    if (second && top.favor >= 45 && second.favor >= 45) {
        candidates.push(() => ({
            type: 'rivalry', emoji: '⚔️', title: '争宠',
            text: `${top.name} 与 ${second.name} 在席间起了口角，都盼你为自己说句话。`,
            subjectIds: [top.charId, second.charId],
            options: [
                { label: `偏向 ${top.name}`, tone: 'good' },
                { label: `偏向 ${second.name}`, tone: 'good' },
                { label: '各打五十大板', tone: 'neutral' },
            ],
        }));
    }
    if (sulky) {
        candidates.push(() => ({
            type: 'jealous', emoji: '💢', title: '吃醋',
            text: `${sulky.name} 近来屡遭冷落，今夜借故告病，分明是在使小性子。`,
            subjectIds: [sulky.charId],
            options: [
                { label: '亲去哄一哄', tone: 'good' },
                { label: '由 ta 去', tone: 'bad' },
            ],
        }));
    }
    candidates.push(() => {
        const victim = pick(state.members);
        return {
            type: 'slander', emoji: '🗣️', title: '谗言',
            text: `有人进谗，说 ${victim.name} 行止失仪。空穴来风，你信是不信？`,
            subjectIds: [victim.charId],
            options: [
                { label: '彻查还其清白', tone: 'good' },
                { label: '宁可信其有', tone: 'bad' },
                { label: '一笑置之', tone: 'neutral' },
            ],
        };
    });
    candidates.push(() => ({
        type: 'favorNight', emoji: '🌛', title: '侍寝',
        text: `夜深，${top.name} 候在殿外，是否传召？`,
        subjectIds: [top.charId],
        options: [
            { label: '欣然传召', tone: 'good' },
            { label: '今夜不必', tone: 'neutral' },
        ],
    }));
    candidates.push(() => ({
        type: 'blessing', emoji: '🎁', title: '喜讯',
        text: '边关传来捷报，普天同庆，后宫上下喜气洋洋。',
        subjectIds: [],
        options: [{ label: '同沾喜气', tone: 'good' }],
    }));

    return pick(candidates)();
}

/** 推进到下一日：先结算（无 pending 时滚事件），有事件则挂起等待抉择。 */
export function endDay(state: HaremState): HaremState {
    if (state.pendingEvent) return state; // 还有事件未处理
    const ev = rollNightEvent(state);
    if (ev) {
        return {
            ...state,
            pendingEvent: ev,
            log: [log(state, `入夜，${ev.emoji} ${ev.title}。`, 'event'), ...state.log].slice(0, 60),
        };
    }
    return advanceDay(state, '夜深人静，平安无事。一夜好眠。');
}

function advanceDay(state: HaremState, nightText: string): HaremState {
    // 自然衰减：心情每日小幅回落，提醒雨露均沾
    const members = state.members.map(m => ({ ...m, mood: clamp(m.mood - 2) }));
    const day = state.day + 1;
    return {
        ...state,
        members,
        day,
        energy: state.maxEnergy,
        hand: drawHand(),
        pendingEvent: null,
        log: [{ id: lid(), day, text: `${nightText} —— 第 ${day} 日。`, tone: 'event' as LogTone }, ...state.log].slice(0, 60),
    };
}

/** 抉择一个夜间事件的选项，应用效果并进入下一日。 */
export function resolveHaremEvent(state: HaremState, optionIndex: number): HaremState {
    const ev = state.pendingEvent;
    if (!ev) return state;
    let members = state.members.map(m => ({ ...m }));
    const find = (id: string) => members.find(m => m.charId === id);
    let nightText = '';

    const adj = (id: string, f: number, mo: number) => { const m = find(id); if (m) { m.favor = clamp(m.favor + f); m.mood = clamp(m.mood + mo); } };

    switch (ev.type) {
        case 'rivalry': {
            const [aId, bId] = ev.subjectIds;
            if (optionIndex === 0) { adj(aId, 6, 4); adj(bId, 0, -6); nightText = `你偏向了 ${find(aId)?.name}，另一位悻悻而退。`; }
            else if (optionIndex === 1) { adj(bId, 6, 4); adj(aId, 0, -6); nightText = `你偏向了 ${find(bId)?.name}，另一位悻悻而退。`; }
            else { adj(aId, 0, -3); adj(bId, 0, -3); nightText = '各打五十大板，两人皆不痛快，却也消停了。'; }
            break;
        }
        case 'jealous': {
            const id = ev.subjectIds[0];
            if (optionIndex === 0) { adj(id, 3, 18); nightText = `你亲去哄了一番，${find(id)?.name} 转嗔为喜。`; }
            else { adj(id, -2, -10); nightText = `你由 ${find(id)?.name} 去了，{ta}更添委屈。`.replace('{ta}', 'ta'); }
            break;
        }
        case 'slander': {
            const id = ev.subjectIds[0];
            if (optionIndex === 0) { adj(id, 5, 8); nightText = `你彻查后还了 ${find(id)?.name} 清白，{ta}感念于心。`.replace('{ta}', 'ta'); }
            else if (optionIndex === 1) { adj(id, -10, -14); nightText = `你听信了谗言降罪，${find(id)?.name} 含冤受罚。`; }
            else { adj(id, 0, 2); nightText = '你一笑置之，未再追究。'; }
            break;
        }
        case 'favorNight': {
            const id = ev.subjectIds[0];
            if (optionIndex === 0) { adj(id, 7, 6); nightText = `传召了 ${find(id)?.name}，承欢一夜，恩宠正浓。`; }
            else { adj(id, -3, 0); members.forEach(m => { if (m.charId !== id) m.mood = clamp(m.mood + 2); }); nightText = `你今夜独眠，雨露均沾之心，旁人倒安了。`; }
            break;
        }
        case 'blessing': {
            members.forEach(m => { m.mood = clamp(m.mood + 6); });
            if (members.length) { const lucky = pick(members); lucky.favor = clamp(lucky.favor + 5); nightText = `喜气盈宫，${lucky.name} 尤得恩赏。`; }
            else nightText = '喜气盈宫。';
            break;
        }
    }

    const advanced = advanceDay({ ...state, members, pendingEvent: null }, nightText);
    return advanced;
}

/** 当前「宠冠后宫」（最高宠爱者），用于展示。 */
export const topFavored = (state: HaremState): HaremMember | null =>
    state.members.length ? byFavorDesc(state.members)[0] : null;
