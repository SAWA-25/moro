/**
 * 占卜引擎 —— 抽牌 / 起卦的算法（纯逻辑）。
 * ==========================================
 * 随机源用 crypto.getRandomValues（app 运行时，非 Workflow 脚本，可放心用）。
 * 六爻、梅花的卦象推演与传统口诀对齐（金钱卦六爻、时间/报数起卦、互卦/变卦/体用）。
 */

import {
    TAROT_78, LENORMAND_36, TarotCardDef, LenormandCardDef,
    HEXAGRAM_BY_KEY, HexagramDef, TRIGRAM_BY_BITS, BITS_BY_XIANTIAN,
} from './cards';

// ── 随机工具 ───────────────────────────────────────────────────────────────

/** [0, max) 的均匀整数（拒绝采样去偏）。 */
function randInt(max: number): number {
    if (max <= 0) return 0;
    const limit = Math.floor(0xffffffff / max) * max;
    const buf = new Uint32Array(1);
    let x = 0;
    do {
        crypto.getRandomValues(buf);
        x = buf[0];
    } while (x >= limit);
    return x % max;
}

/** Fisher–Yates 洗牌（返回新数组）。 */
function shuffle<T>(arr: T[]): T[] {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = randInt(i + 1);
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// ── 牌阵预设 ───────────────────────────────────────────────────────────────

export interface SpreadDef {
    key: string;
    name: string;
    /** 抽几张 */
    count: number;
    /** 每个位置的含义（与 count 等长） */
    positions: string[];
}

export const TAROT_SPREADS: SpreadDef[] = [
    { key: 'one', name: '单张指引', count: 1, positions: ['核心指引'] },
    { key: 'three', name: '三张牌', count: 3, positions: ['过去', '现在', '未来'] },
    { key: 'situation', name: '圣三角', count: 3, positions: ['现状', '阻碍', '建议'] },
    { key: 'mirror', name: '关系镜像', count: 5, positions: ['我眼中的自己', '我眼中的 TA', 'TA 眼中的我', '关系核心', '下一步'] },
    { key: 'choice', name: '双路抉择', count: 5, positions: ['核心处境', '选择 A', 'A 的代价', '选择 B', 'B 的代价'] },
    { key: 'week', name: '七日流向', count: 7, positions: ['第 1 日', '第 2 日', '第 3 日', '第 4 日', '第 5 日', '第 6 日', '第 7 日'] },
    { key: 'celtic', name: '凯尔特十字', count: 10, positions: ['现状', '阻碍/助力', '潜意识根基', '过去', '可能的未来', '近期', '自我态度', '外在环境', '希望与恐惧', '最终结果'] },
];

export const LENORMAND_SPREADS: SpreadDef[] = [
    { key: 'one', name: '单张', count: 1, positions: ['核心'] },
    { key: 'three', name: '三张串读', count: 3, positions: ['主题', '发展', '结果'] },
    { key: 'five', name: '五张线列', count: 5, positions: ['起因', '现状', '核心', '发展', '落点'] },
    { key: 'cross', name: '小十字', count: 5, positions: ['中心', '上方影响', '下方根基', '过去', '未来'] },
    { key: 'seven', name: '七张线列', count: 7, positions: ['线索 1', '线索 2', '线索 3', '核心', '线索 5', '线索 6', '线索 7'] },
    { key: 'nine', name: '九宫格', count: 9, positions: ['1', '2', '3', '4', '中心', '6', '7', '8', '9'] },
];

// ── 塔罗 / 雷诺曼抽牌 ───────────────────────────────────────────────────────

export interface DrawnTarot {
    position: string;
    card: TarotCardDef;
    reversed: boolean;
}

export function drawTarot(spread: SpreadDef): DrawnTarot[] {
    const deck = shuffle(TAROT_78);
    return spread.positions.map((position, i) => ({
        position,
        card: deck[i],
        reversed: randInt(2) === 1,
    }));
}

export interface DrawnLenormand {
    position: string;
    card: LenormandCardDef;
}

export function drawLenormand(spread: SpreadDef): DrawnLenormand[] {
    const deck = shuffle(LENORMAND_36);
    return spread.positions.map((position, i) => ({ position, card: deck[i] }));
}

// ── 翻牌挑选流程（用户从一副背面朝上的牌里自己挑）────────────────────────────
/** 一张待挑选的塔罗牌：洗好牌时就把正逆位定下来（挑中即定，所见即所得）。 */
export interface TarotPick { card: TarotCardDef; reversed: boolean; }

/** 洗一副完整塔罗（78 张），每张预先定好正逆位，背面朝上供用户挑选。 */
export function shuffledTarotDeck(): TarotPick[] {
    return shuffle(TAROT_78).map(card => ({ card, reversed: randInt(2) === 1 }));
}

/** 把用户「按挑选顺序」选中的牌落到牌阵各位置。 */
export function tarotFromPicks(spread: SpreadDef, picks: TarotPick[]): DrawnTarot[] {
    return spread.positions.map((position, i) => ({
        position,
        card: picks[i].card,
        reversed: picks[i].reversed,
    }));
}

/** 洗一副完整雷诺曼（36 张），背面朝上供用户挑选。 */
export function shuffledLenormandDeck(): LenormandCardDef[] {
    return shuffle(LENORMAND_36);
}

/** 把用户选中的雷诺曼牌落到牌阵各位置。 */
export function lenormandFromPicks(spread: SpreadDef, picks: LenormandCardDef[]): DrawnLenormand[] {
    return spread.positions.map((position, i) => ({ position, card: picks[i] }));
}

// ── 卦：六爻金钱卦 ──────────────────────────────────────────────────────────

/** 一爻的状态：值 6/7/8/9 = 老阴/少阳/少阴/老阳。 */
export interface YaoLine {
    /** 三枚铜钱结果：2=背/阴，3=字/阳 */
    coins: [2 | 3, 2 | 3, 2 | 3];
    /** 6 老阴, 7 少阳, 8 少阴, 9 老阳 */
    value: 6 | 7 | 8 | 9;
    /** 本爻是否为阳 */
    yang: boolean;
    /** 是否动爻（老阴/老阳） */
    moving: boolean;
    /** 文字描述 */
    label: string;
}

const YAO_LABEL: Record<number, string> = { 6: '老阴 ⚏（动）', 7: '少阳 ⚊', 8: '少阴 ⚋', 9: '老阳 ⚊（动）' };

function lineFromCoins(coins: [number, number, number]): YaoLine {
    const sum = coins[0] + coins[1] + coins[2]; // 每枚 2(背/阴) 或 3(字/阳)
    const value = sum as 6 | 7 | 8 | 9;
    const yang = value === 7 || value === 9;
    const moving = value === 6 || value === 9;
    return { coins: coins as [2 | 3, 2 | 3, 2 | 3], value, yang, moving, label: YAO_LABEL[value] };
}

/** 由六爻（自下而上）求卦。lines[0]=初爻。 */
export function hexagramFromLines(yangBits: boolean[]): HexagramDef | null {
    if (yangBits.length !== 6) return null;
    const lowerBits = (yangBits[0] ? 1 : 0) | (yangBits[1] ? 2 : 0) | (yangBits[2] ? 4 : 0);
    const upperBits = (yangBits[3] ? 1 : 0) | (yangBits[4] ? 2 : 0) | (yangBits[5] ? 4 : 0);
    return HEXAGRAM_BY_KEY[`${upperBits}_${lowerBits}`] || null;
}

export interface LiuyaoResult {
    /** 自下而上六爻 */
    lines: YaoLine[];
    /** 本卦 */
    primary: HexagramDef | null;
    /** 变卦（无动爻时为 null） */
    changed: HexagramDef | null;
    /** 动爻爻位（1~6，自下而上） */
    movingPositions: number[];
}

export function castLiuyao(): LiuyaoResult {
    const lines: YaoLine[] = [];
    for (let i = 0; i < 6; i++) {
        const coin = (): 2 | 3 => (2 + randInt(2)) as 2 | 3;
        const coins: [2 | 3, 2 | 3, 2 | 3] = [coin(), coin(), coin()];
        lines.push(lineFromCoins(coins));
    }
    const primaryBits = lines.map(l => l.yang);
    const primary = hexagramFromLines(primaryBits);
    const movingPositions = lines.map((l, i) => (l.moving ? i + 1 : 0)).filter(Boolean);
    let changed: HexagramDef | null = null;
    if (movingPositions.length > 0) {
        const changedBits = lines.map(l => (l.moving ? !l.yang : l.yang));
        changed = hexagramFromLines(changedBits);
    }
    return { lines, primary, changed, movingPositions };
}

// ── 卦：梅花易数 ────────────────────────────────────────────────────────────

export interface MeihuaInput {
    method: 'time' | 'number';
    /** time 法：年地支数(1~12)、月(1~12)、日(1~31)、时辰数(1~12) */
    time?: { year: number; month: number; day: number; hour: number };
    /** number 法：两个报数 */
    numbers?: { n1: number; n2: number };
}

export interface MeihuaResult {
    upperNum: number;     // 上卦先天数 1~8
    lowerNum: number;     // 下卦先天数 1~8
    movingYao: number;    // 动爻 1~6
    primary: HexagramDef | null;
    changed: HexagramDef | null;
    mutual: HexagramDef | null;  // 互卦
    /** 体用：'upper' 体在上卦 / 'lower' 体在下卦（动爻所在卦为用，另一为体） */
    bodyTrigram: 'upper' | 'lower';
    upperName: string;
    lowerName: string;
}

const mod1to8 = (n: number) => { const r = n % 8; return r === 0 ? 8 : r; };
const mod1to6 = (n: number) => { const r = n % 6; return r === 0 ? 6 : r; };

/** 由上下卦先天数 + 动爻推演本卦/变卦/互卦/体用。 */
export function deriveMeihua(upperNum: number, lowerNum: number, movingYao: number): MeihuaResult {
    const upperBits0 = BITS_BY_XIANTIAN[upperNum];
    const lowerBits0 = BITS_BY_XIANTIAN[lowerNum];
    // 六爻自下而上：下卦三爻 + 上卦三爻
    const yang: boolean[] = [
        !!(lowerBits0 & 1), !!(lowerBits0 & 2), !!(lowerBits0 & 4),
        !!(upperBits0 & 1), !!(upperBits0 & 2), !!(upperBits0 & 4),
    ];
    const primary = hexagramFromLines(yang);
    // 变卦：翻动爻
    const changedYang = yang.map((y, i) => (i === movingYao - 1 ? !y : y));
    const changed = hexagramFromLines(changedYang);
    // 互卦：取 2,3,4 爻为下卦，3,4,5 爻为上卦
    const mutualLower = (yang[1] ? 1 : 0) | (yang[2] ? 2 : 0) | (yang[3] ? 4 : 0);
    const mutualUpper = (yang[2] ? 1 : 0) | (yang[3] ? 2 : 0) | (yang[4] ? 4 : 0);
    const mutual = HEXAGRAM_BY_KEY[`${mutualUpper}_${mutualLower}`] || null;
    // 体用：动爻在 1~3 → 下卦为用、上卦为体；在 4~6 → 上卦为用、下卦为体
    const bodyTrigram: 'upper' | 'lower' = movingYao <= 3 ? 'upper' : 'lower';
    return {
        upperNum, lowerNum, movingYao, primary, changed, mutual, bodyTrigram,
        upperName: TRIGRAM_BY_BITS[upperBits0].name,
        lowerName: TRIGRAM_BY_BITS[lowerBits0].name,
    };
}

export function castMeihua(input: MeihuaInput): MeihuaResult {
    if (input.method === 'time' && input.time) {
        const { year, month, day, hour } = input.time;
        const upperNum = mod1to8(year + month + day);
        const lowerNum = mod1to8(year + month + day + hour);
        const movingYao = mod1to6(year + month + day + hour);
        return deriveMeihua(upperNum, lowerNum, movingYao);
    }
    // number 法
    const n1 = input.numbers?.n1 ?? (1 + randInt(99));
    const n2 = input.numbers?.n2 ?? (1 + randInt(99));
    const upperNum = mod1to8(n1);
    const lowerNum = mod1to8(n2);
    const movingYao = mod1to6(n1 + n2);
    return deriveMeihua(upperNum, lowerNum, movingYao);
}

/** 当前时间换算成梅花 time 法输入（年用地支数 1~12，时用时辰数 1~12）。 */
export function nowToMeihuaTime(d: Date = new Date()): { year: number; month: number; day: number; hour: number } {
    // 年地支数：(公历年 - 3) % 12，0→12（子=1…亥=12 近似，够用即可）
    const branch = ((d.getFullYear() - 3) % 12 + 12) % 12;
    const year = branch === 0 ? 12 : branch;
    // 时辰数：23-1点=子(1)…，每两小时一辰
    const h = d.getHours();
    const hour = Math.floor(((h + 1) % 24) / 2) + 1; // 子时1…亥时12
    return { year, month: d.getMonth() + 1, day: d.getDate(), hour };
}
