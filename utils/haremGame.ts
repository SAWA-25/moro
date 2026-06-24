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
    persona?: string;  // 人设摘要（喂给 AI 生成台词/事件）
    favor: number;     // 宠爱 0-100
    mood: number;      // 心情 0-100
    pregnant?: number; // 有孕：距临盆的天数（>0 待产，0/undefined 未孕）
    heirs?: number;    // 已诞下皇嗣数
}

export type LogTone = 'good' | 'bad' | 'neutral' | 'event' | 'speech';
export interface HaremLogEntry { id: string; day: number; text: string; tone: LogTone; speaker?: string; avatar?: string; }

export interface HaremEventOption { label: string; tone: LogTone; }
/** AI 事件每个选项落地的效果（按成员 charId 加减 + 一句结果叙述）。 */
export interface HaremAIResult { text: string; effects: { charId: string; favor: number; mood: number }[]; }
export interface HaremPendingEvent {
    type: 'rivalry' | 'jealous' | 'slander' | 'favorNight' | 'blessing' | 'ai';
    emoji: string;
    title: string;
    text: string;
    subjectIds: string[];      // 涉及的成员（按需在 resolver 里取）
    options: HaremEventOption[];
    ai?: HaremAIResult[];      // type==='ai' 时每个选项对应的落地效果
}

export interface HaremState {
    day: number;
    energy: number;
    maxEnergy: number;
    members: HaremMember[];
    hand: string[];            // card id
    log: HaremLogEntry[];
    pendingEvent?: HaremPendingEvent | null;
    lastNightWith?: string;    // 昨夜承欢的成员 charId（用于次日结算受孕）
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

export interface HaremSeed { charId: string; name: string; avatar: string; affection?: number; persona?: string; }

/** 开一盘新游戏：成员宠爱从真实好感起步（缺省 40），心情统一 60。 */
export function initHaremGame(seeds: HaremSeed[]): HaremState {
    const members: HaremMember[] = seeds.map(s => ({
        charId: s.charId, name: s.name, avatar: s.avatar, persona: s.persona,
        favor: clamp(typeof s.affection === 'number' ? s.affection : 40),
        mood: 60, pregnant: 0, heirs: 0,
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
    // 亲密类（独宠/夜话/同辇）记下「昨夜承欢」，次日结算可能受孕
    const intimate = card.targeted && (card.kind === 'exclusive' || card.kind === 'night');
    return {
        ...state,
        members,
        energy: state.energy - card.energy,
        hand,
        lastNightWith: intimate && targetId ? targetId : state.lastNightWith,
        log: [...newLogs.reverse(), ...state.log].slice(0, 80),
    };
}

// ── 子嗣系统：受孕 / 待产 / 临盆 ──────────────────────────────────────────

/** 是否受孕：宠爱越高、心情越好概率越高；已有孕则否。可注入 rng 便于测试。 */
export function maybeConceive(m: Pick<HaremMember, 'favor' | 'mood' | 'pregnant'>, rng: () => number = Math.random): boolean {
    if (!m || (m.pregnant && m.pregnant > 0)) return false;
    if (m.favor < 50) return false;
    let p = m.favor >= 85 ? 0.55 : m.favor >= 70 ? 0.38 : 0.2;
    if (m.mood < 40) p *= 0.4; else if (m.mood >= 70) p *= 1.2;
    return rng() < p;
}

/** 推进所有人的孕期：待产 -1 天，临盆者诞下皇嗣（性别按 day+序确定，便于测试）。 */
export function progressPregnancies(members: HaremMember[], day: number): { members: HaremMember[]; births: { charId: string; name: string; boy: boolean }[] } {
    const births: { charId: string; name: string; boy: boolean }[] = [];
    const out = members.map((m, i) => {
        if (m.pregnant && m.pregnant > 0) {
            const left = m.pregnant - 1;
            if (left <= 0) {
                const boy = (day + i) % 2 === 0;
                births.push({ charId: m.charId, name: m.name, boy });
                return { ...m, pregnant: 0, heirs: (m.heirs || 0) + 1, favor: clamp(m.favor + 8), mood: clamp(m.mood + 18) };
            }
            return { ...m, pregnant: left };
        }
        return m;
    });
    return { members: out, births };
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
    const day = state.day + 1;
    let members = state.members.map(m => ({ ...m }));
    const extra: HaremLogEntry[] = [];

    // 1) 昨夜承欢者结算受孕
    if (state.lastNightWith) {
        const m = members.find(x => x.charId === state.lastNightWith);
        if (m && maybeConceive(m)) {
            m.pregnant = 3;
            extra.push({ id: lid(), day, text: `🌸 太医请脉，${m.name} 已有喜脉，宫中称庆。`, tone: 'event' });
        }
    }
    // 2) 孕期推进 / 临盆
    const prog = progressPregnancies(members, day);
    members = prog.members;
    prog.births.forEach(b => {
        extra.push({ id: lid(), day, text: `👶 ${b.name} 诞下${b.boy ? '皇子' : '公主'}，母凭子贵，恩宠更隆。`, tone: 'good' });
    });
    // 3) 自然衰减：心情每日小幅回落，提醒雨露均沾
    members = members.map(m => ({ ...m, mood: clamp(m.mood - 2) }));

    return {
        ...state,
        members,
        day,
        energy: state.maxEnergy,
        hand: drawHand(),
        pendingEvent: null,
        lastNightWith: undefined,
        log: [...extra.reverse(), { id: lid(), day, text: `${nightText} —— 第 ${day} 日。`, tone: 'event' as LogTone }, ...state.log].slice(0, 80),
    };
}

/** 抉择一个夜间事件的选项，应用效果并进入下一日。 */
export function resolveHaremEvent(state: HaremState, optionIndex: number): HaremState {
    const ev = state.pendingEvent;
    if (!ev) return state;
    let members = state.members.map(m => ({ ...m }));
    const find = (id: string) => members.find(m => m.charId === id);
    let nightText = '';
    let nightWith: string | undefined;

    const adj = (id: string, f: number, mo: number) => { const m = find(id); if (m) { m.favor = clamp(m.favor + f); m.mood = clamp(m.mood + mo); } };

    // AI 生成事件：直接套用该选项的落地效果
    if (ev.type === 'ai' && ev.ai) {
        const res = ev.ai[optionIndex] || ev.ai[0];
        if (res) {
            res.effects.forEach(e => adj(e.charId, e.favor, e.mood));
            nightText = res.text || '此事就此揭过。';
        }
        return advanceDay({ ...state, members, pendingEvent: null }, nightText || '此事就此揭过。');
    }

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
            if (optionIndex === 0) { adj(id, 7, 6); nightWith = id; nightText = `传召了 ${find(id)?.name}，承欢一夜，恩宠正浓。`; }
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

    const advanced = advanceDay({ ...state, members, pendingEvent: null, lastNightWith: nightWith }, nightText);
    return advanced;
}

// ── 选秀：中途新增妃嫔 ────────────────────────────────────────────────────

/** 选秀入宫：把新角色并入现有后宫（按 charId 去重），返回新 state。 */
export function addMembers(state: HaremState, seeds: HaremSeed[]): HaremState {
    const have = new Set(state.members.map(m => m.charId));
    const fresh = seeds.filter(s => !have.has(s.charId)).map(s => ({
        charId: s.charId, name: s.name, avatar: s.avatar, persona: s.persona,
        favor: clamp(typeof s.affection === 'number' ? s.affection : 30), mood: 58, pregnant: 0, heirs: 0,
    } as HaremMember));
    if (fresh.length === 0) return state;
    const names = fresh.map(m => m.name).join('、');
    return {
        ...state,
        members: [...state.members, ...fresh],
        log: [{ id: lid(), day: state.day, text: `🎀 选秀采选，${names} 入宫，后宫又添新颜。`, tone: 'event' as LogTone }, ...state.log].slice(0, 80),
    };
}

/** 妃嫔头衔（展示用，纯计算）：宠冠 / 协理六宫 / 有孕 / 皇嗣×n。 */
export function memberTitles(members: HaremMember[], m: HaremMember): string[] {
    const ranked = [...members].sort((a, b) => b.favor - a.favor);
    const out: string[] = [];
    if (ranked[0]?.charId === m.charId && members.length > 1) out.push('宠冠');
    if (ranked[0]?.charId === m.charId && m.favor >= 85) out.push('协理六宫');
    if (m.pregnant && m.pregnant > 0) out.push('有孕');
    if ((m.heirs || 0) > 0) out.push(`皇嗣×${m.heirs}`);
    return out;
}

/** 把一条妃嫔台词并进起居注（speech 体）。 */
export function pushSpeech(state: HaremState, member: Pick<HaremMember, 'name' | 'avatar'>, line: string): HaremState {
    return {
        ...state,
        log: [{ id: lid(), day: state.day, text: line, tone: 'speech' as LogTone, speaker: member.name, avatar: member.avatar }, ...state.log].slice(0, 80),
    };
}

/** 当前「宠冠后宫」（最高宠爱者），用于展示。 */
export const topFavored = (state: HaremState): HaremMember | null =>
    state.members.length ? byFavorDesc(state.members)[0] : null;

// ══════════════════════════════════════════════════════════════════════════
//  AI 生成层：妃嫔台词 · 夜间事件 · 史官评（结局）。纯 prompt 组装 + 解析 + 兜底。
//  app 侧用副 API（resolveAuxApi + llmComplete）调用，失败一律回退模板，绝不卡死。
// ══════════════════════════════════════════════════════════════════════════

const stripFences = (raw: string): string => (raw || '').trim().replace(/```(?:json)?/gi, '').trim();
const sliceJson = (raw: string, open: string, close: string): string | null => {
    const s = raw.indexOf(open), e = raw.lastIndexOf(close);
    return s === -1 || e === -1 || e <= s ? null : raw.slice(s, e + 1);
};

// ── 1) 妃嫔台词：打牌/事件后，被宠者按人设说一句 ──────────────────────────
const LINE_BANK = {
    good: ['臣妾谢陛下隆恩。', '能得陛下垂青，臣妾此生足矣。', '陛下…臣妾欢喜得很。', '今日这般，臣妾记一辈子。', '有陛下在，旁的都不打紧了。'],
    cool: ['臣妾…明白了。', '是臣妾不会伺候陛下。', '陛下既这样说，臣妾不敢辩。', '臣妾在这儿候着便是。'],
    neutral: ['臣妾听陛下的。', '陛下言重了。', '臣妾省得。'],
};
export function fallbackConcubineLine(tone: 'good' | 'cool' | 'neutral' = 'good'): string {
    return pick(LINE_BANK[tone] || LINE_BANK.good);
}

export function buildConcubineLinePrompt(
    member: Pick<HaremMember, 'name' | 'favor' | 'mood' | 'persona'>,
    action: string,
): { system: string; user: string } {
    const rank = rankOf(member.favor).label;
    const system = `你在一款古风后宫养成游戏里扮演妃嫔「${member.name}」（位分：${rank}）。用第一人称、贴合人设与当下心情，对君主刚才的举动回一句话。古风口吻、含蓄克制、≤30字，只输出台词本身，不要引号、不要旁白、不要解释。${member.persona ? `\n【人设】${member.persona.slice(0, 200)}` : ''}`;
    const moodWord = member.mood >= 70 ? '心情正好' : member.mood >= 45 ? '心绪平平' : '正自郁结';
    const user = `君主刚才：${action}\n你此刻宠爱 ${member.favor}/100、${moodWord}（心情 ${member.mood}/100）。\n请说一句话回应。`;
    return { system, user };
}

export function parseConcubineLine(raw: string): string {
    let t = stripFences(raw).split('\n').map(s => s.trim()).filter(Boolean)[0] || '';
    t = t.replace(/^[^：:\n]{1,8}[：:]\s*/, '');                               // 去「名字：」前缀
    t = t.replace(/^["“「『（(【\s]+/, '').replace(/["”」』）)】\s]+$/, '').trim(); // 去成对引号/括号
    return t.slice(0, 40);
}

// ── 2) AI 夜间事件：依当前后宫格局现编一桩宫闱事，附带数值后果 ──────────────
export function buildAINightEventPrompt(state: HaremState): { system: string; user: string } {
    const roster = byFavorDesc(state.members).map(m =>
        `- ${m.name}（${rankOf(m.favor).label}，宠爱${m.favor}/心情${m.mood}${m.pregnant ? '，有孕' : ''}${(m.heirs || 0) > 0 ? `，育有皇嗣${m.heirs}` : ''}）${m.persona ? `：${m.persona.slice(0, 60)}` : ''}`
    ).join('\n');
    const system = '你在为一款古风后宫养成游戏生成「今夜的一桩后宫事件」。要有宫斗或情感张力，牵涉下列一两位妃嫔，给君主 2~3 个抉择；每个抉择要给出对相关妃嫔「宠爱/心情」的数值增减与一句结果叙述。古风、简练、贴合各自人设与当前格局。';
    const user = `当前是第 ${state.day} 日。后宫诸位：
${roster}

请生成一桩事件。只输出一个 JSON（不要多余文字或代码块标记）：
{"emoji":"一个表情","title":"事件名(≤6字)","text":"事件描述(≤60字)","options":[{"label":"抉择(≤12字)","result":"结果叙述(≤40字)","effects":[{"name":"妃嫔名","favor":整数,"mood":整数}]}]}
要求：title/text 别太直白；favor 取 -15~15、mood 取 -20~20 的整数；effects 里的 name 必须用上面出现过的妃嫔名；options 给 2~3 个、后果各不相同（有偏袒就有冷落）。`;
    return { system, user };
}

export function parseAINightEvent(raw: string, members: HaremMember[]): HaremPendingEvent | null {
    const txt = stripFences(raw);
    const json = sliceJson(txt, '{', '}');
    if (!json) return null;
    try {
        const o = JSON.parse(json);
        const byName = new Map(members.map(m => [m.name, m.charId]));
        const rawOpts = Array.isArray(o?.options) ? o.options : [];
        const options: HaremEventOption[] = [];
        const ai: HaremAIResult[] = [];
        const subjects = new Set<string>();
        for (const op of rawOpts.slice(0, 3)) {
            const label = String(op?.label || '').trim().slice(0, 16);
            if (!label) continue;
            const effects: { charId: string; favor: number; mood: number }[] = [];
            let net = 0;
            for (const e of (Array.isArray(op?.effects) ? op.effects : [])) {
                const cid = byName.get(String(e?.name || '').trim());
                if (!cid) continue;
                const f = Math.max(-20, Math.min(20, Math.round(Number(e?.favor) || 0)));
                const mo = Math.max(-25, Math.min(25, Math.round(Number(e?.mood) || 0)));
                effects.push({ charId: cid, favor: f, mood: mo });
                subjects.add(cid);
                net += f + mo;
            }
            const tone: LogTone = net > 0 ? 'good' : net < 0 ? 'bad' : 'neutral';
            options.push({ label, tone });
            ai.push({ text: String(op?.result || '').trim().slice(0, 60), effects });
        }
        if (options.length < 2) return null;
        return {
            type: 'ai',
            emoji: String(o?.emoji || '🪶').trim().slice(0, 4) || '🪶',
            title: String(o?.title || '后宫风波').trim().slice(0, 12) || '后宫风波',
            text: String(o?.text || '').trim().slice(0, 80),
            subjectIds: [...subjects],
            options,
            ai,
        };
    } catch { return null; }
}

// ── 3) 史官评（结局）：为这段后宫岁月作传 ────────────────────────────────
export interface HaremEnding { verdict: string; fates: { name: string; line: string }[]; }

export function buildEndingPrompt(state: HaremState): { system: string; user: string } {
    const roster = byFavorDesc(state.members).map(m =>
        `- ${m.name}（${rankOf(m.favor).label}，宠爱${m.favor}${(m.heirs || 0) > 0 ? `，育皇嗣${m.heirs}` : ''}${m.pregnant ? '，怀有身孕' : ''}）`
    ).join('\n');
    const system = '你是史官，为一段后宫岁月修史作评。文笔古雅、含蓄，褒贬有度，像《史记》列传的赞语。';
    const user = `这段后宫共历 ${state.day} 日，诸位结局如下：
${roster}

请为这段岁月作传。只输出一个 JSON（不要多余文字或代码块标记）：
{"verdict":"总评(≤120字，史官口吻)","fates":[{"name":"妃嫔名","line":"一句定评(≤24字)"}]}`;
    return { system, user };
}

export function parseEnding(raw: string): HaremEnding {
    const txt = stripFences(raw);
    const json = sliceJson(txt, '{', '}');
    if (json) {
        try {
            const o = JSON.parse(json);
            const verdict = String(o?.verdict || '').trim().slice(0, 200);
            const fates = (Array.isArray(o?.fates) ? o.fates : [])
                .map((f: any) => ({ name: String(f?.name || '').trim().slice(0, 16), line: String(f?.line || '').trim().slice(0, 40) }))
                .filter((f: any) => f.name && f.line)
                .slice(0, 12);
            if (verdict || fates.length) return { verdict: verdict || '后宫诸事，俱付笑谈中。', fates };
        } catch { /* fall through */ }
    }
    const plain = txt.replace(/[{}\[\]]/g, '').trim();
    return { verdict: plain.slice(0, 200) || '后宫诸事，俱付笑谈中。', fates: [] };
}

/** 兜底结局：无 API / 失败时按数据现写一段。 */
export function fallbackEnding(state: HaremState): HaremEnding {
    const ranked = byFavorDesc(state.members);
    const top = ranked[0];
    const heirsTotal = state.members.reduce((s, m) => s + (m.heirs || 0), 0);
    const verdict = top
        ? `历 ${state.day} 日，${top.name} 宠冠六宫，位至${rankOf(top.favor).label}${heirsTotal ? `；宫中育皇嗣 ${heirsTotal} 人，国本渐固` : '；然子嗣尚虚，社稷可虑'}。盛宠易逝，唯人心难测，后人观之，当引以为戒。`
        : '后宫初成，岁月未久，传记暂阙。';
    const fates = ranked.map(m => ({
        name: m.name,
        line: `${rankOf(m.favor).label}，宠 ${m.favor}${(m.heirs || 0) > 0 ? `，育皇嗣 ${m.heirs}` : ''}${m.mood < 40 ? '，郁郁寡欢' : m.mood >= 70 ? '，得意盈怀' : ''}`,
    }));
    return { verdict, fates };
}
