/**
 * 外卖 App 数据与逻辑层。
 * ================================
 * - 店铺生成：本地种子库兜底 + 可选「AI 现搓」（generateStoresAI），含菜品；
 * - 店家有好有坏：每家带隐藏「良心值」integrity，不靠谱店下单后更容易出事（缺斤少两 / 图文不符 /
 *   卫生 / 强制砍单），现实里能看见的红旗放在 store.warning；
 * - 骑手有好有坏：每单掷一个隐藏 riderReliability，坏骑手更容易超时 / 撒漏 / 偷吃 / 不送上门；
 * - 订单入库（utils/db: takeout_orders），含配送进度、事故（incidents）、投诉售后（complaint）、
 *   和骑手/商家/平台客服的对话；扣款 / 退款由 App 侧用钱包余额（adjustUserBalance）落实；
 * - 与来往 App 联动：给某角色点单 / 让角色代付，会在该角色聊天里留一条消息。
 */

import {
    TakeoutStore, TakeoutDish, TakeoutOrder, TakeoutStatus, TakeoutOrderItem,
    TakeoutIncident, TakeoutIncidentKind, TakeoutChatMsg,
    TakeoutDishSpec, TakeoutDishAddon, TakeoutAddressCard, TakeoutAddressOwnerType,
    CharacterProfile,
} from '../types';
import type { ResolvedApi } from './auxApi';
import { DB } from './db';
import { extractContent, extractJson } from './safeApi';
import { takeoutReceivedHint } from './laiwangPrompts';
import { makeApiUsageMeta } from './apiUsageCatalog';
import { callChatCompletion } from './llmClient';
import { resolveCity } from './charCity';

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const shuffle = <T,>(arr: T[]): T[] => [...arr].sort(() => Math.random() - 0.5);
const genId = (p: string) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

export const CATS = ['中餐', '快餐', '早餐', '西餐', '麻辣烫', '奶茶饮品', '甜品烘焙', '日韩料理', '火锅烧烤', '夜宵', '轻食沙拉', '药品'];

// ── 店铺 / 菜品 种子库 ────────────────────────────────────────────
interface StoreSeed { name: string; emoji: string; category: string; dishes: [string, number, string?][]; }

const SEEDS: StoreSeed[] = [
    { name: '老地方家常菜', emoji: '🥘', category: '中餐', dishes: [['番茄炒蛋盖饭', 18, '🍅'], ['宫保鸡丁', 26, '🍗'], ['麻婆豆腐', 16, '🌶️'], ['红烧排骨', 32, '🍖'], ['清炒时蔬', 12, '🥬'], ['紫菜蛋花汤', 6, '🥣'], ['米饭', 2, '🍚'], ['糖醋里脊', 28, '🍤']] },
    { name: '一人食小碗菜', emoji: '🍱', category: '中餐', dishes: [['梅菜扣肉饭', 22, '🍱'], ['黄焖鸡米饭', 20, '🍗'], ['土豆牛腩饭', 25, '🥔'], ['青椒肉丝饭', 18, '🌶️'], ['卤蛋', 3, '🥚'], ['例汤', 4, '🥣']] },
    { name: '麦当当欢乐送', emoji: '🍔', category: '快餐', dishes: [['招牌牛肉堡', 24, '🍔'], ['香辣鸡腿堡', 21, '🍗'], ['薯条(大)', 12, '🍟'], ['麦辣鸡翅', 15, '🍗'], ['可乐', 8, '🥤'], ['苹果派', 7, '🥧'], ['甜筒', 5, '🍦']] },
    { name: '炸鸡啤酒研究所', emoji: '🍗', category: '快餐', dishes: [['半只炸鸡', 38, '🍗'], ['无骨鸡块', 26, '🍗'], ['薯角', 14, '🍟'], ['洋葱圈', 13, '🧅'], ['精酿啤酒', 18, '🍺'], ['莫吉托', 16, '🍹']] },
    { name: '喜悦の茶', emoji: '🧋', category: '奶茶饮品', dishes: [['芝士葡萄', 22, '🍇'], ['多肉草莓', 24, '🍓'], ['烤奶波波', 16, '🧋'], ['茉莉奶绿', 14, '🍵'], ['杨枝甘露', 20, '🥭'], ['柠檬茶', 12, '🍋']] },
    { name: '一点点·街角', emoji: '🥤', category: '奶茶饮品', dishes: [['波霸奶茶', 13, '🧋'], ['四季春茶', 9, '🍵'], ['阿华田', 15, '🍫'], ['冰淇淋红茶', 14, '🍦'], ['焦糖奶茶', 14, '🧋']] },
    { name: '甜在心烘焙坊', emoji: '🧁', category: '甜品烘焙', dishes: [['草莓蛋糕', 28, '🍰'], ['脏脏包', 12, '🥐'], ['提拉米苏', 26, '🍰'], ['可颂', 10, '🥐'], ['芝士挞', 9, '🧀'], ['布朗尼', 14, '🍫']] },
    { name: '雪顶甜品铺', emoji: '🍨', category: '甜品烘焙', dishes: [['芒果绵绵冰', 22, '🥭'], ['红豆双皮奶', 16, '🥛'], ['杨枝甘露', 20, '🥭'], ['芋圆烧仙草', 18, '🍮'], ['抹茶冰淇淋', 15, '🍦']] },
    { name: '寿司郎本铺', emoji: '🍣', category: '日韩料理', dishes: [['三文鱼刺身', 38, '🐟'], ['鳗鱼饭', 32, '🍱'], ['加州卷', 22, '🍣'], ['味增汤', 6, '🥣'], ['天妇罗虾', 18, '🍤'], ['章鱼小丸子', 16, '🐙']] },
    { name: '欧巴韩式炸鸡', emoji: '🍢', category: '日韩料理', dishes: [['韩式炸鸡', 42, '🍗'], ['部队锅', 36, '🍲'], ['石锅拌饭', 24, '🍚'], ['辣炒年糕', 20, '🌶️'], ['泡菜饼', 18, '🥞']] },
    { name: '小郡肝串串香', emoji: '🍡', category: '火锅烧烤', dishes: [['牛肉串(10串)', 30, '🥩'], ['五花肉(10串)', 26, '🥓'], ['烤金针菇', 12, '🍄'], ['烤馒头', 8, '🍞'], ['酸梅汤', 9, '🥤'], ['烤茄子', 14, '🍆']] },
    { name: '深夜食堂·宵夜', emoji: '🍜', category: '夜宵', dishes: [['小龙虾(1斤)', 68, '🦞'], ['炒花甲', 32, '🐚'], ['烤生蚝(6只)', 36, '🦪'], ['啤酒鸭', 42, '🦆'], ['泡面加蛋', 12, '🍜'], ['冰镇西瓜', 10, '🍉']] },
    { name: '轻食主义沙拉', emoji: '🥗', category: '轻食沙拉', dishes: [['鸡胸藜麦碗', 28, '🥗'], ['牛油果沙拉', 26, '🥑'], ['低脂鸡卷', 22, '🌯'], ['希腊酸奶杯', 16, '🥛'], ['果蔬汁', 14, '🥤']] },
    { name: '兰州牛肉面馆', emoji: '🍜', category: '中餐', dishes: [['牛肉拉面', 18, '🍜'], ['加牛肉', 10, '🥩'], ['凉拌牛肚', 16, '🥗'], ['茶叶蛋', 3, '🥚'], ['八宝茶', 8, '🍵']] },
    { name: '元气早餐铺', emoji: '🥟', category: '早餐', dishes: [['小笼包(6只)', 14, '🥟'], ['豆浆', 4, '🥛'], ['茶叶蛋', 3, '🥚'], ['手抓饼加蛋', 9, '🫓'], ['皮蛋瘦肉粥', 10, '🥣'], ['煎饺(8只)', 13, '🥟'], ['豆腐脑', 6, '🍮']] },
    { name: '城南粥铺', emoji: '🥣', category: '早餐', dishes: [['皮蛋瘦肉粥', 12, '🥣'], ['南瓜小米粥', 10, '🎃'], ['油条(2根)', 6, '🥖'], ['咸鸭蛋', 4, '🥚'], ['烧麦(4只)', 12, '🥟'], ['豆浆', 4, '🥛']] },
    { name: 'Bella 意式餐厅', emoji: '🍝', category: '西餐', dishes: [['番茄肉酱意面', 38, '🍝'], ['玛格丽特披萨', 52, '🍕'], ['黑椒牛排', 78, '🥩'], ['凯撒沙拉', 28, '🥗'], ['蘑菇浓汤', 18, '🥣'], ['提拉米苏', 26, '🍰'], ['气泡水', 12, '🥤']] },
    { name: '老城牛排杯', emoji: '🥩', category: '西餐', dishes: [['黑椒牛排杯', 26, '🥩'], ['奥尔良鸡排饭', 24, '🍗'], ['薯条', 10, '🍟'], ['玉米浓汤', 8, '🌽'], ['可乐', 6, '🥤']] },
    { name: '热辣麻辣烫', emoji: '🥘', category: '麻辣烫', dishes: [['招牌麻辣烫(自选)', 32, '🥘'], ['加宽粉', 5, '🍜'], ['加午餐肉', 6, '🥓'], ['加鹌鹑蛋', 5, '🥚'], ['麻酱小料', 3, '🥜'], ['酸梅汤', 8, '🥤']] },
    { name: '夜市铁板烧', emoji: '🍢', category: '夜宵', dishes: [['铁板鱿鱼', 22, '🦑'], ['铁板土豆', 12, '🥔'], ['烤面筋(5串)', 15, '🍢'], ['炒粉', 16, '🍜'], ['冰可乐', 6, '🥤']] },
];

const RIDER_NAMES = ['小袋', '阿强', '风一样的张师傅', '老李', '小跑', '闪电侠', '阿杰', '骑行的小王', '飞毛腿', '可靠的赵哥'];
const RIDER_EMOJIS = ['🛵', '🚴', '🏍️', '🛴'];
const PROMOS = ['满30减5', '新客立减8元', '满50减12', '0元起送', '满20减3', '下午茶专享9折', ''];
// 不太稳的铺子会在评价、份量、图片和回复态度里露出端倪。
const BAD_WARNINGS = ['近期卫生评价偏低，先看看评论', '不少人说份量偏轻', '到手实物和图片不太像', '差评回复火气有点大', '最近超时有点多'];
const SCAM_PROMOS = ['满20减18', '新客0.1元秒杀', '全场1折起', '下单再返现'];

/** 由隐藏良心值反推「现实里看得见」的评分 / 月售 / 红旗 / 促销，使红旗与黑心程度自洽。 */
function deriveSignals(integrity: number): Pick<TakeoutStore, 'rating' | 'monthlySales' | 'warning' | 'promo'> {
    if (integrity >= 0.8) {
        return { rating: round1(rand(4.5, 4.9)), monthlySales: Math.floor(rand(300, 4800)), promo: pick(PROMOS) || undefined };
    }
    if (integrity >= 0.55) {
        return { rating: round1(rand(4.0, 4.6)), monthlySales: Math.floor(rand(120, 1500)), promo: pick(PROMOS) || undefined };
    }
    // 不靠谱店两种现实画像随机其一
    if (Math.random() < 0.5) {
        // 差评型：分低、单少、亮红旗，容易看出来
        return { rating: round1(rand(3.1, 4.0)), monthlySales: Math.floor(rand(30, 500)), warning: pick(BAD_WARNINGS), promo: pick(PROMOS) || undefined };
    }
    // 刷单型：分虚高、单极少、夸张促销引流，不容易看出来（专坑新客）
    return { rating: round1(rand(4.7, 4.9)), monthlySales: Math.floor(rand(15, 120)), promo: pick(SCAM_PROMOS) };
}

/** 掷一个店铺的隐藏良心值：约 55% 良心、27% 一般、18% 黑心。 */
function rollIntegrity(): number {
    const r = Math.random();
    if (r < 0.55) return round2(rand(0.8, 1.0));
    if (r < 0.82) return round2(rand(0.55, 0.8));
    return round2(rand(0.15, 0.5));
}

/** 生成一批店铺（本地种子，每次刷新都不一样，至少 count 家）。带隐藏良心值与现实红旗。 */
export function generateStores(count = 12): TakeoutStore[] {
    const seeds = shuffle(SEEDS);
    const stores: TakeoutStore[] = [];
    const n = Math.max(count, 10);
    for (let i = 0; i < n; i++) {
        const seed = seeds[i % seeds.length];
        const dishes: TakeoutDish[] = seed.dishes.map(([name, price, emoji], idx) => ({
            id: genId('dish'),
            name,
            price,
            emoji,
            popular: idx < 2,
            desc: idx < 2 ? '招牌热销' : undefined,
        }));
        const dup = i >= seeds.length ? `（${pick(['西区店', '二号店', '旗舰店', '夜市店', '社区店'])}）` : '';
        const integrity = rollIntegrity();
        const sig = deriveSignals(integrity);
        stores.push({
            id: genId('store'),
            name: seed.name + dup,
            emoji: seed.emoji,
            category: seed.category,
            rating: sig.rating,
            monthlySales: sig.monthlySales,
            deliveryMinutes: Math.floor(rand(20, 55)),
            deliveryFee: pick([0, 2, 3, 4, 5]),
            minOrder: pick([0, 15, 20, 20, 25]),
            distanceKm: round1(rand(0.4, 4.5)),
            promo: sig.promo,
            warning: sig.warning,
            integrity,
            dishes: decorateDishes(dishes, sig.monthlySales),
        });
    }
    return stores;
}

// ── 美团式：排序 / 筛选 / 满减红包 / 推荐 / 菜单分组（纯函数） ──────────────────

export type StoreSort = 'recommend' | 'sales' | 'rating' | 'distance' | 'delivery';
const recommendScore = (s: TakeoutStore) =>
    (s.rating || 4) * 2 + Math.log10((s.monthlySales || 1) + 1) * 1.5 - (s.distanceKm || 1) * 0.3 - (s.deliveryMinutes || 30) * 0.01;

export function sortStores(stores: TakeoutStore[], sort: StoreSort): TakeoutStore[] {
    const a = [...stores];
    switch (sort) {
        case 'sales': return a.sort((x, y) => (y.monthlySales || 0) - (x.monthlySales || 0));
        case 'rating': return a.sort((x, y) => (y.rating || 0) - (x.rating || 0));
        case 'distance': return a.sort((x, y) => (x.distanceKm || 0) - (y.distanceKm || 0));
        case 'delivery': return a.sort((x, y) => (x.deliveryMinutes || 0) - (y.deliveryMinutes || 0));
        default: return a.sort((x, y) => recommendScore(y) - recommendScore(x));
    }
}

export interface StoreFilter { freeDelivery?: boolean; zeroMinOrder?: boolean; promoOnly?: boolean; goodOnly?: boolean; }
export function filterStores(stores: TakeoutStore[], f: StoreFilter): TakeoutStore[] {
    return stores.filter(s =>
        (!f.freeDelivery || (s.deliveryFee || 0) === 0) &&
        (!f.zeroMinOrder || (s.minOrder || 0) === 0) &&
        (!f.promoOnly || !!s.promo) &&
        (!f.goodOnly || (s.rating || 0) >= 4.5));
}

/** 解析店铺满减文案 → {threshold, discount}。支持「满X减Y」「(新客)立减N(元)」。 */
export function parseStorePromo(promo?: string): { threshold: number; discount: number } | null {
    if (!promo) return null;
    let m = promo.match(/满\s*(\d+(?:\.\d+)?)\s*减\s*(\d+(?:\.\d+)?)/);
    if (m) return { threshold: Number(m[1]), discount: Number(m[2]) };
    m = promo.match(/立减\s*(\d+(?:\.\d+)?)/);
    if (m) return { threshold: 0, discount: Number(m[1]) };
    return null;
}
/** 店铺满减实际可减金额（满足门槛时，不超过小计）。 */
export function storePromoDiscount(promo: string | undefined, subtotal: number): number {
    const p = parseStorePromo(promo);
    if (!p || subtotal < p.threshold) return 0;
    return Math.min(p.discount, subtotal);
}

/** 平台红包（满减券，可领，结算自动用最优一张）。 */
export interface TakeoutRedpacket { id: string; title: string; threshold: number; discount: number; }
export const TAKEOUT_REDPACKETS: TakeoutRedpacket[] = [
    { id: 't3', title: '满20减3', threshold: 20, discount: 3 },
    { id: 't6', title: '满40减6', threshold: 40, discount: 6 },
    { id: 't12', title: '满60减12', threshold: 60, discount: 12 },
    { id: 'tnew', title: '新客立减8', threshold: 0, discount: 8 },
];
export const getRedpacket = (id: string): TakeoutRedpacket | undefined => TAKEOUT_REDPACKETS.find(r => r.id === id);
export function bestRedpacket(claimedIds: string[] | undefined, total: number): TakeoutRedpacket | null {
    let best: TakeoutRedpacket | null = null;
    for (const id of (claimedIds || [])) {
        const r = getRedpacket(id);
        if (r && total >= r.threshold && (!best || r.discount > best.discount)) best = r;
    }
    return best;
}

/** 猜你喜欢：按推荐分排序取前 count。 */
export function recommendStores(stores: TakeoutStore[], count = 6): TakeoutStore[] {
    return [...stores].sort((a, b) => recommendScore(b) - recommendScore(a)).slice(0, count);
}

/** 菜单分组（美团式左侧分类）：招牌 + 按菜名粗分主食/饮品/小食。 */
export function groupDishes(dishes: TakeoutDish[]): { group: string; dishes: TakeoutDish[] }[] {
    const popular = dishes.filter(d => d.popular);
    const rest = dishes.filter(d => !d.popular);
    const bucket = (d: TakeoutDish): string => {
        const n = d.name;
        if (/(奶茶|奶绿|茶|咖啡|可乐|饮|汁|啤酒|气泡|豆浆|酸梅|水|波波|甘露)/.test(n)) return '饮品';
        if (/(饭|面|粉|盖|包|粥|披萨|意面|饺|馒头|烧麦|拉面|卷|堡)/.test(n)) return '主食';
        if (/(汤|沙拉|小料|加|蛋|串|薯|圈|挞|布朗尼|甜筒|冰|派|翅)/.test(n)) return '小食/汤';
        return '其他';
    };
    const groups: { group: string; dishes: TakeoutDish[] }[] = [];
    if (popular.length) groups.push({ group: '招牌', dishes: popular });
    const order = ['主食', '饮品', '小食/汤', '其他'];
    const map = new Map<string, TakeoutDish[]>();
    for (const d of rest) { const b = bucket(d); (map.get(b) || map.set(b, []).get(b)!).push(d); }
    for (const g of order) { const ds = map.get(g); if (ds && ds.length) groups.push({ group: g, dishes: ds }); }
    return groups.length ? groups : [{ group: '全部', dishes }];
}

// ── 菜品「选规格 / 加料」（对标美团点菜弹层 SKU）────────────────────
const SUGAR_SPEC: TakeoutDishSpec = { name: '甜度', options: [{ label: '正常糖', priceDelta: 0 }, { label: '少糖', priceDelta: 0 }, { label: '半糖', priceDelta: 0 }, { label: '无糖', priceDelta: 0 }] };
const ICE_SPEC: TakeoutDishSpec = { name: '冰量', options: [{ label: '正常冰', priceDelta: 0 }, { label: '少冰', priceDelta: 0 }, { label: '去冰', priceDelta: 0 }, { label: '常温/热', priceDelta: 0 }] };
const SPICE_SPEC: TakeoutDishSpec = { name: '辣度', options: [{ label: '不辣', priceDelta: 0 }, { label: '微辣', priceDelta: 0 }, { label: '中辣', priceDelta: 0 }, { label: '特辣', priceDelta: 0 }] };
const PORTION_SPEC: TakeoutDishSpec = { name: '份量', options: [{ label: '标准份', priceDelta: 0 }, { label: '大份', priceDelta: 5 }] };
const RICE_ADDONS: TakeoutDishAddon[] = [{ label: '加饭', price: 2 }, { label: '加煎蛋', price: 2 }, { label: '加香肠', price: 3 }];
const NOODLE_ADDONS: TakeoutDishAddon[] = [{ label: '加面', price: 3 }, { label: '加宽粉', price: 3 }, { label: '加蛋', price: 2 }];
const HOTPOT_ADDONS: TakeoutDishAddon[] = [{ label: '加午餐肉', price: 6 }, { label: '加宽粉', price: 5 }, { label: '加鹌鹑蛋', price: 5 }];
const MILKTEA_ADDONS: TakeoutDishAddon[] = [{ label: '加珍珠', price: 2 }, { label: '加椰果', price: 2 }, { label: '加奶盖', price: 4 }];

const isDrink = (n: string) => /(奶茶|奶绿|奶昔|茶|咖啡|拿铁|美式|可乐|雪碧|汽水|气泡|饮|汁|波波|甘露|柠檬|椰|豆浆|酸梅)/.test(n);
const isMilkTea = (n: string) => /(奶茶|奶绿|奶盖|波波|烤奶|阿华田|奶昔)/.test(n);
const isNoodle = (n: string) => /(面|粉|米线|河粉|拉面|馄饨|刀削)/.test(n);
const isRice = (n: string) => /(饭|盖|煲|便当|套餐|盖浇)/.test(n);
const isHotpotItem = (n: string) => /(麻辣烫|串|烫|火锅|关东煮)/.test(n);
const isSpicy = (n: string) => /(辣|麻|川|椒|魔鬼|火爆|香辣|泡椒)/.test(n);

/**
 * 按菜名推断「选规格 / 加料」（纯函数，确定性）。对标美团：饮品给甜度/冰量+小料，
 * 饭/面给份量(+辣度/加料)，麻辣烫/串给辣度+加料，普通辣菜给辣度；汤/小食一般无规格。
 */
export function deriveDishOptions(name: string): { specs?: TakeoutDishSpec[]; addons?: TakeoutDishAddon[] } {
    const n = name || '';
    if (isDrink(n)) {
        const specs = [SUGAR_SPEC, ICE_SPEC];
        return isMilkTea(n) ? { specs, addons: MILKTEA_ADDONS } : { specs };
    }
    if (isHotpotItem(n)) return { specs: [SPICE_SPEC], addons: HOTPOT_ADDONS };
    if (isNoodle(n)) {
        const specs = isSpicy(n) ? [PORTION_SPEC, SPICE_SPEC] : [PORTION_SPEC];
        return { specs, addons: NOODLE_ADDONS };
    }
    if (isRice(n)) {
        const specs = isSpicy(n) ? [PORTION_SPEC, SPICE_SPEC] : [PORTION_SPEC];
        return { specs, addons: RICE_ADDONS };
    }
    if (isSpicy(n)) return { specs: [SPICE_SPEC] };
    return {};
}

/** 给一批菜挂上规格/加料 + 菜品月售（用于本地种子与 AI 现搓的统一加工）。 */
export function decorateDishes(dishes: TakeoutDish[], storeMonthlySales = 600): TakeoutDish[] {
    return dishes.map((d, i) => {
        const opt = deriveDishOptions(d.name);
        const base = d.popular ? rand(0.18, 0.42) : rand(0.04, 0.2);
        return {
            ...d,
            monthlySales: d.monthlySales ?? Math.max(1, Math.floor(storeMonthlySales * base) + Math.floor(rand(0, 40)) - i),
            specs: d.specs ?? opt.specs,
            addons: d.addons ?? opt.addons,
        };
    });
}

/** 这道菜是否需要弹「选规格 / 加料」。 */
export function dishHasOptions(d: Pick<TakeoutDish, 'specs' | 'addons'>): boolean {
    return !!((d.specs && d.specs.length) || (d.addons && d.addons.length));
}

/** 一份菜（含所选规格 + 加料）的单价。 */
export function dishUnitPrice(
    basePrice: number,
    specs: TakeoutDishSpec[] | undefined,
    specChoice: Record<string, string>,
    addons: TakeoutDishAddon[] | undefined,
    addonLabels: string[],
): number {
    let p = basePrice;
    for (const g of specs || []) {
        const opt = g.options.find(o => o.label === specChoice[g.name]);
        if (opt) p += opt.priceDelta;
    }
    for (const a of addons || []) if (addonLabels.includes(a.label)) p += a.price;
    return Math.max(0, Math.round(p));
}

/** 规格 + 加料合并成一句人话（「大份·微辣 / 加蛋·加肠」），存进订单项的 spec 字段。 */
export function formatSpecAddon(
    specs: TakeoutDishSpec[] | undefined,
    specChoice: Record<string, string>,
    addonLabels: string[],
): { spec?: string; addons?: string[] } {
    const specParts = (specs || [])
        .map(g => specChoice[g.name])
        .filter((x): x is string => !!x && x !== '标准份' && x !== '正常糖' && x !== '正常冰' && x !== '不辣');
    const addons = addonLabels.slice();
    return {
        spec: specParts.length ? specParts.join('·') : undefined,
        addons: addons.length ? addons : undefined,
    };
}

/** 购物车行 key：同一道菜不同规格/加料各占一行。 */
export function cartLineKey(dishId: string, spec?: string, addons?: string[]): string {
    return [dishId, spec || '', (addons || []).slice().sort().join(',')].join('|');
}

// ── 完整 App 外壳：主导航 / 订单中心 / 会员 / 足迹 / 饭篮草稿 ─────────────
export type TakeoutMainTab = 'home' | 'orders' | 'pantry' | 'profile';
export type TakeoutSubView = 'store' | 'checkout' | 'detail' | 'addressBook' | 'memberCenter' | 'dishEditor' | 'storeEditor' | null;
export type TakeoutOrderBucket = 'all' | 'active' | 'arrived' | 'toReview' | 'issue' | 'done';

export interface TakeoutMemberState {
    points: number;
    checkinAt?: number;
    updatedAt?: number;
}

export interface TakeoutMemberLevel {
    level: number;
    title: string;
    currentFloor: number;
    nextFloor?: number;
    progress: number;
}

export interface TakeoutFootprint {
    storeId: string;
    storeName: string;
    storeEmoji?: string;
    category?: string;
    at: number;
}

export interface TakeoutSavedCart {
    id: string;
    storeId: string;
    storeName: string;
    storeEmoji?: string;
    items: TakeoutOrderItem[];
    subtotal: number;
    recipient?: string;
    payer?: string;
    note?: string;
    createdAt: number;
    updatedAt: number;
}

export const TAKEOUT_MEMBER_KEY = 'moro_takeout_member_v1';
export const TAKEOUT_FOOTPRINTS_KEY = 'moro_takeout_footprints_v1';
export const TAKEOUT_SAVED_CARTS_KEY = 'moro_takeout_saved_carts_v1';

const clampPoints = (n: unknown) => Math.max(0, Math.min(999999, Math.floor(Number(n) || 0)));

function readJsonObject<T>(key: string, fallback: T): T {
    try {
        const raw = JSON.parse(localStorage.getItem(key) || 'null');
        return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as T : fallback;
    } catch {
        return fallback;
    }
}

function normalizeMemberState(raw: unknown): TakeoutMemberState {
    const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    const checkinAt = Number(obj.checkinAt);
    const updatedAt = Number(obj.updatedAt);
    return {
        points: clampPoints(obj.points),
        checkinAt: Number.isFinite(checkinAt) && checkinAt > 0 ? checkinAt : undefined,
        updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : undefined,
    };
}

export function getTakeoutMemberState(): TakeoutMemberState {
    return normalizeMemberState(readJsonObject<TakeoutMemberState>(TAKEOUT_MEMBER_KEY, { points: 0 }));
}

export function saveTakeoutMemberState(input: Partial<TakeoutMemberState>): TakeoutMemberState {
    const current = getTakeoutMemberState();
    const next = normalizeMemberState({ ...current, ...input, updatedAt: Date.now() });
    try { localStorage.setItem(TAKEOUT_MEMBER_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    return next;
}

export function addTakeoutMemberPoints(delta: number): TakeoutMemberState {
    const current = getTakeoutMemberState();
    return saveTakeoutMemberState({ ...current, points: clampPoints(current.points + delta) });
}

export function takeoutMemberLevel(points: number): TakeoutMemberLevel {
    const floors = [0, 60, 180, 360, 720, 1200];
    const titles = ['新手食客', '街角常客', '饭票熟客', '挑嘴行家', '票根收藏家', '外卖街传说'];
    const safe = clampPoints(points);
    let level = 1;
    for (let i = 0; i < floors.length; i++) if (safe >= floors[i]) level = i + 1;
    const currentFloor = floors[level - 1] || 0;
    const nextFloor = floors[level];
    const progress = nextFloor ? Math.max(0, Math.min(1, (safe - currentFloor) / (nextFloor - currentFloor))) : 1;
    return { level, title: titles[level - 1] || titles[titles.length - 1], currentFloor, nextFloor, progress: round2(progress) };
}

export function canTakeoutDailyCheckin(state: TakeoutMemberState = getTakeoutMemberState(), now = Date.now()): boolean {
    if (!state.checkinAt) return true;
    const a = new Date(state.checkinAt);
    const b = new Date(now);
    return a.getFullYear() !== b.getFullYear() || a.getMonth() !== b.getMonth() || a.getDate() !== b.getDate();
}

export function takeoutDailyCheckin(now = Date.now(), reward = 8): TakeoutMemberState {
    const current = getTakeoutMemberState();
    if (!canTakeoutDailyCheckin(current, now)) return current;
    return saveTakeoutMemberState({ points: clampPoints(current.points + reward), checkinAt: now });
}

function normalizeFootprint(raw: any): TakeoutFootprint | null {
    const storeId = String(raw?.storeId || '').trim();
    const storeName = String(raw?.storeName || '').trim();
    const at = Number(raw?.at);
    if (!storeId || !storeName || !Number.isFinite(at)) return null;
    return {
        storeId,
        storeName: storeName.slice(0, 40),
        storeEmoji: String(raw?.storeEmoji || '').trim().slice(0, 4) || undefined,
        category: String(raw?.category || '').trim().slice(0, 16) || undefined,
        at,
    };
}

export function getTakeoutFootprints(): TakeoutFootprint[] {
    return readArray<any>(TAKEOUT_FOOTPRINTS_KEY)
        .map(normalizeFootprint)
        .filter((x): x is TakeoutFootprint => !!x)
        .sort((a, b) => b.at - a.at)
        .slice(0, 40);
}

export function pushTakeoutFootprint(store: Pick<TakeoutStore, 'id' | 'name' | 'emoji' | 'category'>, now = Date.now()): TakeoutFootprint[] {
    const next: TakeoutFootprint = { storeId: store.id, storeName: store.name, storeEmoji: store.emoji, category: store.category, at: now };
    const out = [next, ...getTakeoutFootprints().filter(f => f.storeId !== store.id)].slice(0, 40);
    writeArray(TAKEOUT_FOOTPRINTS_KEY, out);
    return out;
}

export function clearTakeoutFootprints(): void {
    try { localStorage.removeItem(TAKEOUT_FOOTPRINTS_KEY); } catch { /* ignore */ }
}

function normalizeSavedCart(raw: any): TakeoutSavedCart | null {
    const storeId = String(raw?.storeId || '').trim();
    const storeName = String(raw?.storeName || '').trim();
    const items = Array.isArray(raw?.items)
        ? raw.items.map((i: any) => ({
            dishId: String(i?.dishId || '').trim(),
            name: String(i?.name || '').trim().slice(0, 40),
            price: asMoney(i?.price, 0, 9999),
            qty: asIntRange(i?.qty, 1, 1, 99),
            emoji: String(i?.emoji || '').trim().slice(0, 4) || undefined,
            spec: String(i?.spec || '').trim().slice(0, 40) || undefined,
            addons: Array.isArray(i?.addons) ? i.addons.map((x: unknown) => String(x || '').trim().slice(0, 24)).filter(Boolean).slice(0, 12) : undefined,
        })).filter((i: TakeoutOrderItem) => i.dishId && i.name && i.qty > 0)
        : [];
    if (!storeId || !storeName || items.length === 0) return null;
    const now = Date.now();
    const createdAt = Number(raw?.createdAt) || now;
    const updatedAt = Number(raw?.updatedAt) || createdAt;
    return {
        id: String(raw?.id || genId('cart')),
        storeId,
        storeName: storeName.slice(0, 40),
        storeEmoji: String(raw?.storeEmoji || '').trim().slice(0, 4) || undefined,
        items,
        subtotal: asMoney(items.reduce((sum: number, i: TakeoutOrderItem) => sum + i.price * i.qty, 0), 0, 999999),
        recipient: String(raw?.recipient || '').trim().slice(0, 80) || undefined,
        payer: String(raw?.payer || '').trim().slice(0, 80) || undefined,
        note: String(raw?.note || '').trim().slice(0, 160) || undefined,
        createdAt,
        updatedAt,
    };
}

export function getTakeoutSavedCarts(): TakeoutSavedCart[] {
    return readArray<any>(TAKEOUT_SAVED_CARTS_KEY)
        .map(normalizeSavedCart)
        .filter((x): x is TakeoutSavedCart => !!x)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 30);
}

export function saveTakeoutSavedCart(input: Partial<TakeoutSavedCart> & Pick<TakeoutSavedCart, 'storeId' | 'storeName' | 'items'>): TakeoutSavedCart | null {
    const now = Date.now();
    const saved = normalizeSavedCart({
        ...input,
        id: input.id || genId('cart'),
        createdAt: input.createdAt || now,
        updatedAt: now,
    });
    if (!saved) return null;
    const next = [saved, ...getTakeoutSavedCarts().filter(c => c.id !== saved.id)].slice(0, 30);
    writeArray(TAKEOUT_SAVED_CARTS_KEY, next);
    return saved;
}

export function deleteTakeoutSavedCart(id: string): TakeoutSavedCart[] {
    const next = getTakeoutSavedCarts().filter(c => c.id !== id);
    writeArray(TAKEOUT_SAVED_CARTS_KEY, next);
    return next;
}

export function clearTakeoutSavedCarts(): void {
    try { localStorage.removeItem(TAKEOUT_SAVED_CARTS_KEY); } catch { /* ignore */ }
}

export function takeoutOrderBucket(order: TakeoutOrder, now = Date.now()): Exclude<TakeoutOrderBucket, 'all'> {
    const st = liveTakeoutStatus(order, now);
    if (st === 'cancelled') return 'issue';
    if (st === 'arrived') return 'arrived';
    if (st === 'preparing' || st === 'delivering') return 'active';
    if (hasOpenIssues(order) || (order.complaint?.filed && !order.complaint.resolved)) return 'issue';
    if (st === 'delivered' && order.recipient === 'me' && !order.review) return 'toReview';
    return 'done';
}

export function filterTakeoutOrdersByBucket(orders: TakeoutOrder[], bucket: TakeoutOrderBucket, now = Date.now()): TakeoutOrder[] {
    if (bucket === 'all') return orders;
    return orders.filter(o => takeoutOrderBucket(o, now) === bucket);
}

export function takeoutOrderBucketCounts(orders: TakeoutOrder[], now = Date.now()): Record<TakeoutOrderBucket, number> {
    const counts: Record<TakeoutOrderBucket, number> = { all: orders.length, active: 0, arrived: 0, toReview: 0, issue: 0, done: 0 };
    for (const order of orders) counts[takeoutOrderBucket(order, now)] += 1;
    return counts;
}

// ── 自定义菜库 / 铺子（local-first，保存在当前浏览器）──────────────────
const CUSTOM_DISHES_KEY = 'moro_takeout_custom_dishes_v1';
const CUSTOM_STORES_KEY = 'moro_takeout_custom_stores_v1';
export const TAKEOUT_STORES_CACHE_KEY = 'moro_takeout_stores_v1';

const asText = (v: unknown, fallback = '', max = 80): string => {
    const s = String(v ?? '').trim();
    return (s || fallback).slice(0, max);
};
const asMoney = (v: unknown, fallback = 0, max = 9999): number => {
    const n = Number(v);
    return round2(clamp(Number.isFinite(n) ? n : fallback, 0, max));
};
const asIntRange = (v: unknown, fallback: number, min: number, max: number): number => {
    const n = Number(v);
    return Math.round(clamp(Number.isFinite(n) ? n : fallback, min, max));
};
const asNumRange = (v: unknown, fallback: number, min: number, max: number): number => {
    const n = Number(v);
    return round1(clamp(Number.isFinite(n) ? n : fallback, min, max));
};

function readArray<T>(key: string): T[] {
    try {
        const raw = JSON.parse(localStorage.getItem(key) || '[]');
        return Array.isArray(raw) ? raw : [];
    } catch {
        return [];
    }
}

function writeArray<T>(key: string, value: T[]): void {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

export function sanitizeTakeoutDish(raw: Partial<TakeoutDish> | any, fallback?: Partial<TakeoutDish>): TakeoutDish | null {
    const name = asText(raw?.name, fallback?.name || '', 24);
    if (!name) return null;
    const now = Date.now();
    const specs: TakeoutDishSpec[] = Array.isArray(raw?.specs)
        ? raw.specs.map((g: any) => {
            const groupName = asText(g?.name, '', 12);
            const options = Array.isArray(g?.options)
                ? g.options.map((o: any) => ({
                    label: asText(o?.label, '', 16),
                    priceDelta: asMoney(o?.priceDelta, 0, 999),
                })).filter((o: TakeoutDishSpec['options'][number]) => !!o.label)
                : [];
            return groupName && options.length ? { name: groupName, options } : null;
        }).filter((g: TakeoutDishSpec | null): g is TakeoutDishSpec => !!g)
        : [];
    const addons: TakeoutDishAddon[] = Array.isArray(raw?.addons)
        ? raw.addons.map((a: any) => ({
            label: asText(a?.label, '', 16),
            price: asMoney(a?.price, 0, 999),
        })).filter((a: TakeoutDishAddon) => !!a.label)
        : [];
    return {
        id: asText(raw?.id, fallback?.id || genId('dish'), 80),
        name,
        desc: asText(raw?.desc, '', 40) || undefined,
        price: asMoney(raw?.price, fallback?.price ?? 0, 9999),
        emoji: asText(raw?.emoji, fallback?.emoji || '🍽️', 4) || '🍽️',
        popular: !!raw?.popular,
        monthlySales: raw?.monthlySales === undefined || raw?.monthlySales === '' ? undefined : asIntRange(raw.monthlySales, fallback?.monthlySales || 0, 0, 99999),
        specs: specs.length ? specs : undefined,
        addons: addons.length ? addons : undefined,
        userCustom: !!raw?.userCustom || !!fallback?.userCustom,
        userEdited: !!raw?.userEdited || !!fallback?.userEdited,
        libraryDishId: asText(raw?.libraryDishId, fallback?.libraryDishId || '', 80) || undefined,
        updatedAt: asIntRange(raw?.updatedAt, fallback?.updatedAt || now, 0, now),
    };
}

export function sanitizeTakeoutStore(raw: Partial<TakeoutStore> | any, fallback?: Partial<TakeoutStore>): TakeoutStore | null {
    const name = asText(raw?.name, fallback?.name || '', 24);
    if (!name) return null;
    const categoryRaw = asText(raw?.category, fallback?.category || '中餐', 16);
    const integrityRaw = Number(raw?.integrity);
    const dishesRaw = Array.isArray(raw?.dishes) ? raw.dishes : (Array.isArray(fallback?.dishes) ? fallback?.dishes : []);
    const dishes = (dishesRaw || []).map((d: any) => sanitizeTakeoutDish(d)).filter((d: TakeoutDish | null): d is TakeoutDish => !!d);
    const now = Date.now();
    return {
        id: asText(raw?.id, fallback?.id || genId('store'), 80),
        name,
        emoji: asText(raw?.emoji, fallback?.emoji || '🍴', 4) || '🍴',
        category: categoryRaw || '中餐',
        rating: asNumRange(raw?.rating, fallback?.rating ?? 4.6, 1, 5),
        monthlySales: asIntRange(raw?.monthlySales, fallback?.monthlySales ?? 0, 0, 999999),
        deliveryMinutes: asIntRange(raw?.deliveryMinutes, fallback?.deliveryMinutes ?? 30, 1, 240),
        deliveryFee: asMoney(raw?.deliveryFee, fallback?.deliveryFee ?? 0, 999),
        minOrder: asMoney(raw?.minOrder, fallback?.minOrder ?? 0, 9999),
        distanceKm: asNumRange(raw?.distanceKm, fallback?.distanceKm ?? 1, 0, 999),
        promo: asText(raw?.promo, '', 24) || undefined,
        dishes,
        blurb: asText(raw?.blurb, '', 40) || undefined,
        integrity: raw?.integrity === undefined || raw?.integrity === '' || !Number.isFinite(integrityRaw) ? fallback?.integrity : clamp01(integrityRaw),
        warning: asText(raw?.warning, '', 40) || undefined,
        aiGenerated: !!raw?.aiGenerated,
        userCustom: !!raw?.userCustom || !!fallback?.userCustom,
        userEdited: !!raw?.userEdited || !!fallback?.userEdited,
        updatedAt: asIntRange(raw?.updatedAt, fallback?.updatedAt || now, 0, now),
    };
}

export function getCustomDishes(): TakeoutDish[] {
    return readArray<any>(CUSTOM_DISHES_KEY).map(d => sanitizeTakeoutDish(d)).filter((d): d is TakeoutDish => !!d);
}

export function saveCustomDish(input: Partial<TakeoutDish>): TakeoutDish | null {
    const saved = sanitizeTakeoutDish({ ...input, userCustom: true, userEdited: true, updatedAt: Date.now() });
    if (!saved) return null;
    const next = [saved, ...getCustomDishes().filter(d => d.id !== saved.id && d.name !== saved.name)].slice(0, 200);
    writeArray(CUSTOM_DISHES_KEY, next);
    return saved;
}

export function deleteCustomDish(id: string): TakeoutDish[] {
    const next = getCustomDishes().filter(d => d.id !== id);
    writeArray(CUSTOM_DISHES_KEY, next);
    return next;
}

export function getCustomStores(): TakeoutStore[] {
    return readArray<any>(CUSTOM_STORES_KEY).map(s => sanitizeTakeoutStore(s)).filter((s): s is TakeoutStore => !!s);
}

export function saveCustomStore(input: Partial<TakeoutStore>): TakeoutStore | null {
    const saved = sanitizeTakeoutStore({ ...input, userEdited: true, updatedAt: Date.now() });
    if (!saved) return null;
    const next = [saved, ...getCustomStores().filter(s => s.id !== saved.id)].slice(0, 100);
    writeArray(CUSTOM_STORES_KEY, next);
    return saved;
}

export function deleteCustomStore(id: string): TakeoutStore[] {
    const next = getCustomStores().filter(s => s.id !== id);
    writeArray(CUSTOM_STORES_KEY, next);
    return next;
}

export function mergeCustomStores(stores: TakeoutStore[]): TakeoutStore[] {
    const custom = getCustomStores();
    if (!custom.length) return stores;
    const customById = new Map(custom.map(s => [s.id, s]));
    const merged = stores.map(s => customById.get(s.id) || s);
    const ids = new Set(merged.map(s => s.id));
    return [...custom.filter(s => !ids.has(s.id)), ...merged];
}

export function cloneDishForStore(dish: TakeoutDish): TakeoutDish {
    const cloned = sanitizeTakeoutDish({
        ...dish,
        id: genId('dish'),
        libraryDishId: dish.libraryDishId || dish.id,
        userCustom: true,
        userEdited: true,
        updatedAt: Date.now(),
    });
    return cloned || { id: genId('dish'), name: '自定义菜', price: 0, emoji: '🍽️', userCustom: true, userEdited: true, updatedAt: Date.now() };
}

// ── 搜索：热门搜索 + 搜索历史（对标美团搜索页）──────────────────────
export const TAKEOUT_HOT_SEARCHES = ['炸鸡', '麻辣烫', '奶茶', '螺蛳粉', '汉堡', '寿司', '黄焖鸡', '小龙虾', '轻食沙拉', '感冒药'];
const SEARCH_HISTORY_KEY = 'moro_takeout_search_history_v1';
export function getSearchHistory(): string[] {
    try { const a = JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY) || '[]'); return Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string') : []; }
    catch { return []; }
}
export function pushSearchHistory(q: string): string[] {
    const v = q.trim();
    if (!v) return getSearchHistory();
    const next = [v, ...getSearchHistory().filter(x => x !== v)].slice(0, 10);
    try { localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    return next;
}
export function clearSearchHistory(): void { try { localStorage.removeItem(SEARCH_HISTORY_KEY); } catch { /* ignore */ } }

// ── 收货地址卡（多地址管理 + 角色地址联动）─────────────────────
const LEGACY_ADDRESS_BOOK_KEY = 'moro_takeout_addresses_v1';
const LEGACY_ADDRESS_KEY = 'moro_takeout_address';
const ADDRESS_CARDS_KEY = 'moro_takeout_address_cards_v1';
const DEFAULT_ADDRESS = '城南花园 3 栋 502';
export const TAKEOUT_ADDRESS_TAGS = ['家', '公司', '学校', '常去处', '自定义'];

const ownerKey = (ownerType: TakeoutAddressOwnerType, ownerId?: string) => ownerType === 'char' ? `char:${ownerId || ''}` : 'me';
const cardHash = (s: string): number => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
};

function uniqueStrings(items: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of items) {
        const v = String(raw || '').trim();
        if (!v || seen.has(v)) continue;
        seen.add(v); out.push(v);
    }
    return out;
}

function legacyAddressStrings(): string[] {
    const arr: string[] = [];
    try {
        const oldList = JSON.parse(localStorage.getItem(LEGACY_ADDRESS_BOOK_KEY) || '[]');
        if (Array.isArray(oldList)) arr.push(...oldList.filter((x): x is string => typeof x === 'string'));
    } catch { /* ignore */ }
    try {
        const oldOne = localStorage.getItem(LEGACY_ADDRESS_KEY);
        if (oldOne) arr.unshift(oldOne);
    } catch { /* ignore */ }
    return uniqueStrings(arr);
}

function normalizeAddressCard(raw: any, now = Date.now()): TakeoutAddressCard | null {
    const ownerType: TakeoutAddressOwnerType = raw?.ownerType === 'char' ? 'char' : 'me';
    const ownerId = ownerType === 'char' ? String(raw?.ownerId || '').trim() : undefined;
    if (ownerType === 'char' && !ownerId) return null;
    const addressLine = String(raw?.addressLine || '').trim();
    if (!addressLine) return null;
    const tag = TAKEOUT_ADDRESS_TAGS.includes(String(raw?.tag || '')) ? String(raw.tag) : '自定义';
    const label = String(raw?.label || tag || '地址').trim() || '地址';
    const createdAt = Number(raw?.createdAt) || now;
    return {
        id: String(raw?.id || genId('addr')),
        ownerType,
        ownerId,
        label,
        tag,
        receiverName: String(raw?.receiverName || (ownerType === 'me' ? '我' : 'TA')).trim() || (ownerType === 'me' ? '我' : 'TA'),
        contactHint: String(raw?.contactHint || '').trim() || undefined,
        city: String(raw?.city || '').trim() || undefined,
        addressLine,
        doorplate: String(raw?.doorplate || '').trim() || undefined,
        deliveryNote: String(raw?.deliveryNote || '').trim() || undefined,
        isDefault: !!raw?.isDefault,
        createdAt,
        updatedAt: Number(raw?.updatedAt) || createdAt,
    };
}

function normalizeAddressCards(cards: TakeoutAddressCard[]): TakeoutAddressCard[] {
    const grouped = new Map<string, TakeoutAddressCard[]>();
    for (const card of cards) {
        const k = ownerKey(card.ownerType, card.ownerId);
        const list = grouped.get(k) || [];
        list.push(card);
        grouped.set(k, list);
    }
    const out: TakeoutAddressCard[] = [];
    for (const list of grouped.values()) {
        list.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || b.updatedAt - a.updatedAt);
        const defaultIndex = Math.max(0, list.findIndex(c => c.isDefault));
        list.forEach((c, i) => out.push({ ...c, isDefault: i === defaultIndex }));
    }
    return out;
}

function writeAddressCards(cards: TakeoutAddressCard[]): void {
    try { localStorage.setItem(ADDRESS_CARDS_KEY, JSON.stringify(normalizeAddressCards(cards))); } catch { /* ignore */ }
}

function readAddressCards(): TakeoutAddressCard[] {
    try {
        const raw = JSON.parse(localStorage.getItem(ADDRESS_CARDS_KEY) || '[]');
        if (Array.isArray(raw) && raw.length) {
            return normalizeAddressCards(raw.map(x => normalizeAddressCard(x)).filter((x): x is TakeoutAddressCard => !!x));
        }
    } catch { /* ignore */ }
    const now = Date.now();
    const migrated = legacyAddressStrings().map((line, i) => normalizeAddressCard({
        id: `addr_legacy_me_${i}_${cardHash(line).toString(36)}`,
        ownerType: 'me',
        label: i === 0 ? '家' : `地址${i + 1}`,
        tag: i === 0 ? '家' : '自定义',
        receiverName: '我',
        addressLine: line,
        isDefault: i === 0,
        createdAt: now - i,
        updatedAt: now - i,
    }, now)).filter((x): x is TakeoutAddressCard => !!x);
    if (migrated.length) writeAddressCards(migrated);
    return migrated;
}

export function getAddressCards(ownerType: TakeoutAddressOwnerType = 'me', ownerId?: string): TakeoutAddressCard[] {
    const k = ownerKey(ownerType, ownerId);
    return readAddressCards()
        .filter(c => ownerKey(c.ownerType, c.ownerId) === k)
        .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || b.updatedAt - a.updatedAt);
}

export function saveAddressCard(input: Partial<TakeoutAddressCard> & Pick<TakeoutAddressCard, 'ownerType' | 'addressLine'>): TakeoutAddressCard {
    const all = readAddressCards();
    const now = Date.now();
    const current = input.id ? all.find(c => c.id === input.id) : undefined;
    const ownerType: TakeoutAddressOwnerType = input.ownerType === 'char' ? 'char' : 'me';
    const ownerId = ownerType === 'char' ? String(input.ownerId || current?.ownerId || '').trim() : undefined;
    const sameOwner = all.filter(c => ownerKey(c.ownerType, c.ownerId) === ownerKey(ownerType, ownerId));
    const next = normalizeAddressCard({
        ...current,
        ...input,
        ownerType,
        ownerId,
        id: current?.id || input.id || genId('addr'),
        isDefault: input.isDefault ?? current?.isDefault ?? sameOwner.length === 0,
        createdAt: current?.createdAt || now,
        updatedAt: now,
    }, now)!;
    const without = all.filter(c => c.id !== next.id);
    const shouldDefault = next.isDefault || sameOwner.length === 0;
    const merged = without.map(c => ownerKey(c.ownerType, c.ownerId) === ownerKey(next.ownerType, next.ownerId) && shouldDefault ? { ...c, isDefault: false } : c);
    writeAddressCards([...merged, { ...next, isDefault: shouldDefault }]);
    return { ...next, isDefault: shouldDefault };
}

export function deleteAddressCard(id: string): TakeoutAddressCard[] {
    const all = readAddressCards();
    const next = normalizeAddressCards(all.filter(c => c.id !== id));
    writeAddressCards(next);
    return next;
}

export function setDefaultAddressCard(id: string): TakeoutAddressCard | null {
    const all = readAddressCards();
    const target = all.find(c => c.id === id);
    if (!target) return null;
    const k = ownerKey(target.ownerType, target.ownerId);
    const next = all.map(c => ownerKey(c.ownerType, c.ownerId) === k ? { ...c, isDefault: c.id === id, updatedAt: c.id === id ? Date.now() : c.updatedAt } : c);
    writeAddressCards(next);
    return getDefaultAddressCard(target.ownerType, target.ownerId);
}

export function getDefaultAddressCard(ownerType: TakeoutAddressOwnerType = 'me', ownerId?: string): TakeoutAddressCard | null {
    const cards = getAddressCards(ownerType, ownerId);
    return cards.find(c => c.isDefault) || cards[0] || null;
}

export function formatAddressCard(card: TakeoutAddressCard): string {
    const place = [card.city, card.addressLine, card.doorplate].filter(Boolean).join(' ');
    const label = card.label ? `${card.label} · ` : '';
    const contact = card.contactHint ? ` · ${card.contactHint}` : '';
    const note = card.deliveryNote ? `（${card.deliveryNote}）` : '';
    return `${label}${place}${contact}${note}`.trim();
}

export function getDefaultTakeoutAddressLine(): string {
    const card = getDefaultAddressCard('me');
    return card ? formatAddressCard(card) : DEFAULT_ADDRESS;
}

export function ensureCharacterAddressSeeds(characters: CharacterProfile[]): TakeoutAddressCard[] {
    let all = readAddressCards();
    let changed = false;
    const now = Date.now();
    for (const char of characters) {
        if (!char?.id || all.some(c => c.ownerType === 'char' && c.ownerId === char.id)) continue;
        const city = resolveCity(char)?.displayCity;
        const line = city ? `${city} · ${char.name}常去的街角` : `${char.name}常住的小区门口`;
        const seed = normalizeAddressCard({
            id: `addr_char_${char.id}_${cardHash(line).toString(36)}`,
            ownerType: 'char',
            ownerId: char.id,
            label: '家',
            tag: '家',
            receiverName: char.name,
            contactHint: '来往私信',
            city,
            addressLine: line,
            doorplate: '门口自取',
            deliveryNote: '到门口发消息',
            isDefault: true,
            createdAt: now,
            updatedAt: now,
        }, now);
        if (seed) { all = [...all, seed]; changed = true; }
    }
    if (changed) writeAddressCards(all);
    return readAddressCards();
}

// 旧字符串地址 API：保留给旧代码 / 旧测试使用，内部映射到地址卡。
export function getAddresses(): string[] {
    const lines = getAddressCards('me').map(c => c.addressLine);
    return lines.length ? lines : [DEFAULT_ADDRESS];
}
export function addAddress(addr: string): string[] {
    const v = addr.trim();
    if (!v) return getAddresses();
    saveAddressCard({ ownerType: 'me', label: '家', tag: '家', receiverName: '我', addressLine: v, isDefault: true });
    return getAddresses();
}
export function removeAddress(addr: string): string[] {
    const card = getAddressCards('me').find(c => formatAddressCard(c) === addr || c.addressLine === addr);
    if (card) deleteAddressCard(card.id);
    if (getAddressCards('me').length === 0) saveAddressCard({ ownerType: 'me', label: '家', tag: '家', receiverName: '我', addressLine: DEFAULT_ADDRESS, isDefault: true });
    return getAddresses();
}

// ── 预约送达：时段（对标美团「立即送出 / 预约」）──────────────────
export interface DeliverySlot { label: string; at: number | null; } // at===null 即「尽快送达」
export function deliveryTimeSlots(deliveryMinutes: number, now = Date.now()): DeliverySlot[] {
    const slots: DeliverySlot[] = [{ label: '尽快送达', at: null }];
    const soonest = now + Math.max(15, deliveryMinutes) * 60000;
    const d = new Date(soonest);
    d.setSeconds(0, 0);
    d.setMinutes(d.getMinutes() <= 30 ? 30 : 60); // 向上取到下一个半点
    for (let i = 0; i < 6; i++) {
        const t = d.getTime() + i * 30 * 60000;
        const dt = new Date(t);
        slots.push({ label: `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`, at: t });
    }
    return slots;
}

// ── 饭票长期使用：凑单推荐 / 口味小纸条 / 本月统计 ───────────────
export const TAKEOUT_TASTE_TAGS = [
    '不要香菜', '忌辣', '少辣', '无辣', '多辣', '口味清淡',
    '少油', '少盐', '少油少盐', '多放饭', '汤汁分开', '热饮',
    '少糖', '控糖', '海鲜过敏', '坚果过敏', '乳糖不耐',
    '不吃猪肉', '素食', '不吃生冷',
];
const TASTE_PROFILE_KEY = 'moro_takeout_taste_profiles_v1';
const tasteKey = (targetId?: string | null) => (targetId && targetId.trim()) || 'me';

export interface TakeoutTasteProfile {
    tags: string[];
    /** 其它自由文本忌口/过敏，按收货对象保存。 */
    note?: string;
    updatedAt?: number;
}

type TakeoutTasteInput = string[] | TakeoutTasteProfile | undefined | null;

const normalizeTasteTags = (tags: unknown): string[] => Array.isArray(tags)
    ? tags.filter((x, i, a): x is string => typeof x === 'string' && TAKEOUT_TASTE_TAGS.includes(x) && a.indexOf(x) === i)
    : [];

function normalizeTasteProfile(raw: unknown): TakeoutTasteProfile {
    if (Array.isArray(raw)) return { tags: normalizeTasteTags(raw) };
    if (!raw || typeof raw !== 'object') return { tags: [] };
    const obj = raw as Record<string, unknown>;
    const note = String(obj.note ?? '').trim().slice(0, 160);
    const updatedAt = Number(obj.updatedAt);
    return {
        tags: normalizeTasteTags(obj.tags),
        note: note || undefined,
        updatedAt: Number.isFinite(updatedAt) ? updatedAt : undefined,
    };
}

function readTasteProfiles(): Record<string, TakeoutTasteProfile> {
    try {
        const raw = JSON.parse(localStorage.getItem(TASTE_PROFILE_KEY) || '{}');
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
        const out: Record<string, TakeoutTasteProfile> = {};
        for (const [k, v] of Object.entries(raw)) {
            const profile = normalizeTasteProfile(v);
            if (profile.tags.length || profile.note) out[k] = profile;
        }
        return out;
    } catch { return {}; }
}

function writeTasteProfiles(profiles: Record<string, TakeoutTasteProfile>): void {
    try { localStorage.setItem(TASTE_PROFILE_KEY, JSON.stringify(profiles)); } catch { /* ignore */ }
}

export function getTasteProfile(targetId: string = 'me'): TakeoutTasteProfile {
    return normalizeTasteProfile(readTasteProfiles()[tasteKey(targetId)]);
}

export function saveTasteProfile(targetId: string, profile: TakeoutTasteProfile): TakeoutTasteProfile {
    const key = tasteKey(targetId);
    const profiles = readTasteProfiles();
    const next: TakeoutTasteProfile = {
        tags: normalizeTasteTags(profile.tags),
        note: String(profile.note || '').trim().slice(0, 160) || undefined,
        updatedAt: Date.now(),
    };
    profiles[key] = next;
    writeTasteProfiles(profiles);
    return next;
}

/** 按收货对象保存的口味偏好（me 或 charId），用于下单备注。 */
export function getTasteTags(targetId: string = 'me'): string[] {
    return getTasteProfile(targetId).tags;
}

export function toggleTasteTag(targetId: string, tag: string): string[] {
    if (!TAKEOUT_TASTE_TAGS.includes(tag)) return getTasteTags(targetId);
    const key = tasteKey(targetId);
    const profiles = readTasteProfiles();
    const curProfile = normalizeTasteProfile(profiles[key]);
    const cur = curProfile.tags;
    const next = cur.includes(tag) ? cur.filter(x => x !== tag) : [...cur, tag].slice(0, 12);
    profiles[key] = { ...curProfile, tags: next, updatedAt: Date.now() };
    writeTasteProfiles(profiles);
    return next;
}

function tasteInputToProfile(input: TakeoutTasteInput): TakeoutTasteProfile {
    return Array.isArray(input) ? { tags: normalizeTasteTags(input) } : normalizeTasteProfile(input);
}

export function buildTasteNote(input: TakeoutTasteInput): string {
    const profile = tasteInputToProfile(input);
    const parts: string[] = [];
    if (profile.tags.length) parts.push(`口味偏好：${profile.tags.join('、')}`);
    if (profile.note) parts.push(`其它忌口/过敏：${profile.note}`);
    return parts.join('；');
}

/** 把口味小纸条并进备注；已写过的偏好不重复塞。 */
export function mergeNoteWithTaste(note: string | undefined, input: TakeoutTasteInput): string {
    const base = (note || '').trim();
    const profile = tasteInputToProfile(input);
    const missingTags = profile.tags.filter(t => !base.includes(t));
    const missingNote = profile.note && !base.includes(profile.note) ? profile.note : undefined;
    const taste = buildTasteNote({ tags: missingTags, note: missingNote });
    if (!taste) return base;
    return base ? `${base}；${taste}` : taste;
}

/** 根据当前差额推荐一口能凑起送/满减的小菜。 */
export function recommendAddOnDishes(
    dishes: TakeoutDish[],
    pickedDishIds: string[] = [],
    gap = 0,
    limit = 4,
): TakeoutDish[] {
    const picked = new Set(pickedDishIds);
    const pool = dishes.filter(d => !picked.has(d.id) && Number.isFinite(d.price) && d.price > 0);
    const scored = pool.map(d => {
        const sales = Math.log10((d.monthlySales || 1) + 1);
        const popular = d.popular ? 5 : 0;
        const cheapSnack = d.price <= 12 ? 3 : 0;
        const reach = gap > 0
            ? (d.price >= gap ? 100 - Math.abs(d.price - gap) : 72 - Math.abs(gap - d.price) * 0.8)
            : 70 - d.price * 0.6;
        return { d, score: reach + sales + popular + cheapSnack };
    });
    return scored.sort((a, b) => b.score - a.score).slice(0, Math.max(0, limit)).map(x => x.d);
}

export interface TakeoutHistoryStats {
    monthCount: number;
    monthTotal: number;
    topStore?: { name: string; count: number };
    topDish?: { name: string; count: number };
}

export function takeoutHistoryStats(orders: TakeoutOrder[], now = Date.now()): TakeoutHistoryStats {
    const start = new Date(now);
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    const monthOrders = orders.filter(o => o.placedAt >= start.getTime() && !o.cancelledByStore);
    const storeMap = new Map<string, number>();
    const dishMap = new Map<string, number>();
    let total = 0;
    for (const o of monthOrders) {
        total += Number(o.total || 0);
        storeMap.set(o.storeName, (storeMap.get(o.storeName) || 0) + 1);
        for (const item of o.items || []) dishMap.set(item.name, (dishMap.get(item.name) || 0) + (item.qty || 1));
    }
    const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])[0];
    const topStore = top(storeMap);
    const topDish = top(dishMap);
    return {
        monthCount: monthOrders.length,
        monthTotal: round2(total),
        topStore: topStore ? { name: topStore[0], count: topStore[1] } : undefined,
        topDish: topDish ? { name: topDish[0], count: topDish[1] } : undefined,
    };
}

// ── AI 现搓店铺（含菜品） ──────────────────────────────────────────
interface AiStoreRaw {
    name?: string; emoji?: string; category?: string; blurb?: string;
    integrity?: number; warning?: string;
    dishes?: { name?: string; price?: number; emoji?: string; desc?: string; popular?: boolean }[];
}

/**
 * 让 AI 现场生成一批外卖店（含菜品、价格、店铺公告、隐藏良心值）。
 * 失败 / 未配 API 时回退到本地种子 generateStores()。
 */
export async function generateStoresAI(api: ResolvedApi, count = 12, query?: string): Promise<TakeoutStore[]> {
    const baseUrl = (api.baseUrl || '').trim();
    if (!baseUrl || !api.model) throw new Error('未配置副 API');
    const q = (query || '').trim();
    const prompt = `你在为一座小城手写「这条街上的吃食铺子」名册，请现编 ${count} 家像真开在街角、各有性格的小馆子，覆盖这些品类：${CATS.join('、')}。
${q ? `**本次是用户在搜「${q}」**：请让这一批店铺尽量都紧扣「${q}」——主营该菜品/品类/口味/场景（店名、招牌菜都要相关），让用户一搜就搜到对的店。\n` : ''}要求（越像真的越好，别像广告）：
- 店名要有烟火气、有记忆点：可带店主姓氏 / 街巷地名 / 老字号味（如「城西巷·阿婆糖水」「老周烧腊」「深夜两点面」），别千篇一律。
- 大多数是踏实经营的良心店；但务必混进 2~3 家「不太稳的铺子」：份量忽大忽小、图片和到手差得远、后厨评价一般、专靠超低价活动吸引新客，甚至接单很慢。它们的 integrity 压低（0.15~0.45），普通店 0.55~0.8，良心店 0.8~1.0。
- 不太稳的铺子有的会露出端倪（warning 用街坊口吻，如「近期卫生评价偏低，先看看评论」「不少人说份量偏轻」「差评回复火气有点大」），有的表面热闹（高分但月售少、满减夸张、评价很薄）就把 warning 留空。不要在 name/blurb/warning 里写「黑心」「风险」「虚拟」「模拟」等幕后词。
- 每家 4~6 道菜/商品，名称与定价贴合该品类与现实，口味/做法写具体（「现炒」「招牌秘制」），给每道配一个最贴切的 emoji；挑 1~2 道镇店招牌设 popular:true，并在 desc 里写一句卖点（≤12 字）。
- **药品 品类＝药店（24h/连锁/社区药房）**：卖非处方药与医疗用品（感冒灵颗粒、布洛芬、连花清瘟、创可贴、医用口罩、维C、健胃消食片、退热贴、酒精棉片…），价格按现实（¥3~¥68），desc 写适应症/规格（「感冒发热」「24粒装」），emoji 用 💊🩹😷🧴 之类；${q && /药|病|感冒|发烧|咳|止|创可贴|口罩|维|消炎|退/.test(q) ? '本次搜索与买药相关，请多生成几家药店。' : '正常批次里也放 1~2 家药店。'}
- blurb 是店主写在招牌上的一句话（≤20 字，有人味）。emoji 是门脸 logo（一个 emoji）。category 必须取自给定品类。
**务必输出完整且合法的 JSON**：紧凑无多余空白、不要 markdown 围栏、不要任何解释；宁可每家菜少写一两道，也要把 ${count} 家全部写完、最后的 }]} 收尾，绝不中途截断。格式：
{"stores":[{"name":"","emoji":"🍔","category":"快餐","blurb":"","integrity":0.9,"warning":"","dishes":[{"name":"","price":24,"emoji":"🍔","desc":"","popular":true}]}]}`;
    // 给足 token：20 家带菜品的店铺 JSON 很长，实测 gemini 等会一路写到上限——8000 仍常被截在
    // 半个店铺里导致整批 JSON 不合法。提到 16000 + 上面「写完再收尾」的硬约束 + extractJson 截断修复。
    const data = await callChatCompletion(api, {
        model: api.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 1.0,
        max_tokens: 16000,
        stream: false,
    }, {
        meta: makeApiUsageMeta('takeout.generate', { apiRole: api.apiRole || 'aux', apiBinding: api.apiBinding || '生成店铺' }),
    });
    const raw = extractContent(data) || data?.choices?.[0]?.message?.content || '';
    const parsed = extractJson(raw);
    let list: AiStoreRaw[] = Array.isArray(parsed?.stores) ? parsed.stores : (Array.isArray(parsed) ? parsed : []);
    // 截断兜底：整体解析拿不到店铺时，从 stores 数组里逐个抠出「已写完」的店铺对象（被 max_tokens
    // 截在半个店铺也能把前面完整的救回来），避免整批报废。
    if (list.length === 0) list = salvageStoreObjects(raw) as AiStoreRaw[];
    const stores = list.map(mapAiStore).filter((s): s is TakeoutStore => !!s);
    // 解析不到任何店铺 = 真·失败：抛出让调用方明确提示并保留现有列表，而不是悄悄换成本地种子冒充成功。
    if (stores.length === 0) throw new Error('店铺生成解析失败');
    return stores;
}

/**
 * 从模型原文里逐个抠出「完整的」店铺对象（正确处理字符串/转义/嵌套），丢弃被截断的最后一个。
 * 用于 {"stores":[…]} 被 max_tokens 截断、整体 JSON.parse 失败时打捞已写完的店铺。
 */
function salvageStoreObjects(raw: string): any[] {
    const text = (raw || '').replace(/```(?:json)?/gi, '');
    const lb = text.indexOf('[');               // stores 数组起点
    if (lb < 0) return [];
    const s = text.slice(lb + 1);
    const out: any[] = [];
    let depth = 0, startIdx = -1, inStr = false, esc = false;
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (inStr) {
            if (esc) esc = false;
            else if (ch === '\\') esc = true;
            else if (ch === '"') inStr = false;
            continue;
        }
        if (ch === '"') { inStr = true; continue; }
        if (ch === '{') { if (depth === 0) startIdx = i; depth++; }
        else if (ch === '}') {
            if (depth > 0) depth--;
            if (depth === 0 && startIdx >= 0) {
                try { out.push(JSON.parse(s.slice(startIdx, i + 1))); } catch { /* 跳过坏对象 */ }
                startIdx = -1;
            }
        } else if (ch === ']' && depth === 0) break; // 数组正常收尾
    }
    return out;
}

function mapAiStore(raw: AiStoreRaw): TakeoutStore | null {
    const name = (raw.name || '').trim();
    if (!name) return null;
    const dishesRaw = Array.isArray(raw.dishes) ? raw.dishes : [];
    const dishes: TakeoutDish[] = dishesRaw
        .filter(d => (d?.name || '').trim() && Number.isFinite(Number(d?.price)))
        .slice(0, 12)
        .map((d, idx) => ({
            id: genId('dish'),
            name: String(d.name).trim().slice(0, 24),
            price: Math.max(1, Math.round(Number(d.price))),
            emoji: (d.emoji || '🍽️').trim().slice(0, 4) || '🍽️',
            desc: d.desc ? String(d.desc).trim().slice(0, 30) : (d.popular ? '招牌热销' : undefined),
            popular: !!d.popular || idx < 1,
        }));
    if (dishes.length < 2) return null;
    const category = CATS.includes(String(raw.category)) ? String(raw.category) : pick(CATS);
    const integrity = Number.isFinite(Number(raw.integrity)) ? clamp01(Number(raw.integrity)) : rollIntegrity();
    const sig = deriveSignals(integrity);
    const warning = (raw.warning || '').trim() || sig.warning;
    return {
        id: genId('store'),
        name: name.slice(0, 20),
        emoji: (raw.emoji || '🍴').trim().slice(0, 4) || '🍴',
        category,
        rating: sig.rating,
        monthlySales: sig.monthlySales,
        deliveryMinutes: Math.floor(rand(20, 55)),
        deliveryFee: pick([0, 2, 3, 4, 5]),
        minOrder: pick([0, 15, 20, 20, 25]),
        distanceKm: round1(rand(0.4, 4.5)),
        promo: sig.promo,
        blurb: raw.blurb ? String(raw.blurb).trim().slice(0, 24) : undefined,
        warning,
        integrity,
        aiGenerated: true,
        dishes: decorateDishes(dishes, sig.monthlySales),
    };
}

// ── 配送进度 ──────────────────────────────────────────────────────
export const PACK_FEE = 2;
export const MIN_TAKEOUT_DELIVERY_MINUTES = 15;
export const MIN_TAKEOUT_DELIVERY_MS = MIN_TAKEOUT_DELIVERY_MINUTES * 60 * 1000;

export function effectiveTakeoutEtaAt(order: Pick<TakeoutOrder, 'placedAt' | 'etaAt' | 'scheduledAt'>): number {
    const placedAt = Number.isFinite(Number(order.placedAt)) ? Number(order.placedAt) : Date.now();
    const etaAt = Number.isFinite(Number(order.etaAt)) ? Number(order.etaAt) : placedAt;
    const scheduledAt = Number.isFinite(Number(order.scheduledAt)) ? Number(order.scheduledAt) : undefined;
    const requestedEtaAt = scheduledAt || etaAt;
    return Math.max(requestedEtaAt, placedAt + MIN_TAKEOUT_DELIVERY_MS);
}

export function shouldAutoReactToCharTakeout(order: TakeoutOrder, now = Date.now()): boolean {
    return !!order.charId
        && order.recipient === order.charId
        && !order.deliveredAt
        && !order.reactionPosted
        && order.status !== 'cancelled'
        && now >= effectiveTakeoutEtaAt(order);
}

/**
 * 按时间实时推算订单状态（与现实时间同步）。
 * 关键：到达预计时间（now >= etaAt）只进入 `arrived`（已到达·待收货），
 * 不再自动跳 `delivered` —— 「收到货才能点击送达」：必须等真正到点后，
 * 用户手动确认收货（或给角色点的单到点后角色自动签收）才置 deliveredAt → delivered。
 */
export function liveTakeoutStatus(order: TakeoutOrder, now = Date.now()): TakeoutStatus {
    if (order.status === 'cancelled') return 'cancelled';
    if (order.deliveredAt) return 'delivered';
    const etaAt = effectiveTakeoutEtaAt(order);
    if (now >= etaAt) return 'arrived';
    const span = etaAt - order.placedAt;
    if (span > 0 && now >= order.placedAt + span * 0.35) return 'delivering';
    return 'preparing';
}

/** 是否已到点（到了就可以确认收货了）。 */
export function isTakeoutArrived(order: TakeoutOrder, now = Date.now()): boolean {
    return !order.deliveredAt && order.status !== 'cancelled' && now >= effectiveTakeoutEtaAt(order);
}

// 「饭票」状态词：把美团式术语换成手账口吻（灶上/跑腿/门口/签收/作废）。
// 注：本表被外卖 App、聊天小票（MessageItem）、灵动岛（DynamicIsland）共用，改这里即全局生效。
export const STATUS_LABEL: Record<TakeoutStatus, string> = {
    preparing: '灶上忙着',
    delivering: '跑腿在路上',
    arrived: '到门口了·待签收',
    delivered: '已签收',
    cancelled: '已作废',
};

/** 剩余配送时间文案（手账口吻）。 */
export function etaText(order: TakeoutOrder, now = Date.now()): string {
    const s = liveTakeoutStatus(order, now);
    if (s === 'delivered') return '已签收';
    if (s === 'cancelled') return order.cancelledByStore ? '铺子撂了挑子' : '已作废';
    if (s === 'arrived') return '到门口啦，盖章签收';
    const mins = Math.max(1, Math.ceil((effectiveTakeoutEtaAt(order) - now) / 60000));
    return `约 ${mins} 分钟到手`;
}

export const newRider = () => ({ name: pick(RIDER_NAMES), emoji: pick(RIDER_EMOJIS) });

// ── 黑心商家 / 坏骑手：事故掷点 ───────────────────────────────────
export interface OrderIssueRoll {
    riderReliability: number;
    incidents: TakeoutIncident[];
    forceCancel: boolean;
}

const STORE_KINDS: TakeoutIncidentKind[] = ['short_weight', 'missing_item', 'wrong_item', 'foreign_object', 'fake_photo', 'cold_food'];
const RIDER_KINDS: TakeoutIncidentKind[] = ['severe_late', 'spilled', 'rider_ate', 'left_at_door'];
const STORE_WEIGHT: Record<string, number> = { short_weight: 0.85, missing_item: 0.7, wrong_item: 0.4, foreign_object: 0.3, fake_photo: 0.7, cold_food: 0.6 };
const RIDER_WEIGHT: Record<string, number> = { severe_late: 0.85, spilled: 0.45, rider_ate: 0.3, left_at_door: 0.6 };

const itemName = (items: TakeoutOrderItem[]) => (items.length ? pick(items).name : '餐品');

function buildStoreIncident(kind: TakeoutIncidentKind, items: TakeoutOrderItem[], subtotal: number): TakeoutIncident {
    const it = itemName(items);
    switch (kind) {
        case 'short_weight':
            return { kind, by: 'store', title: '缺斤少两', detail: `「${it}」分量肉眼可见地少，比图片小一圈，像是被克扣过。`, suggestedRefund: Math.max(3, Math.round(subtotal * 0.3)) };
        case 'missing_item': {
            const m = items.length ? pick(items) : null;
            const ref = m ? m.price : Math.round(subtotal * 0.3);
            return { kind, by: 'store', title: '漏发餐品', detail: `打开发现少了「${m ? m.name : it}」，商家根本没放进去。`, suggestedRefund: Math.max(2, Math.round(ref)) };
        }
        case 'wrong_item':
            return { kind, by: 'store', title: '送错餐', detail: `餐盒里是别人家的菜，跟点的「${it}」完全对不上。`, suggestedRefund: Math.max(5, Math.round(subtotal * 0.5)) };
        case 'foreign_object':
            return { kind, by: 'store', title: '吃出异物', detail: `「${it}」里吃出了头发/塑料碎，实在没法下口。`, suggestedRefund: subtotal };
        case 'fake_photo':
            return { kind, by: 'store', title: '图文严重不符', detail: `卖家秀和买家秀两个世界，「${it}」跟首页大图差太远。`, suggestedRefund: Math.max(3, Math.round(subtotal * 0.3)) };
        case 'cold_food':
        default:
            return { kind, by: 'store', title: '餐品冰凉', detail: `送到时「${it}」已经凉透坨成一团，像早做好晾着的。`, suggestedRefund: Math.max(2, Math.round(subtotal * 0.15)) };
    }
}

function buildRiderIncident(kind: TakeoutIncidentKind, items: TakeoutOrderItem[], subtotal: number, deliveryFee: number): TakeoutIncident {
    const it = itemName(items);
    switch (kind) {
        case 'severe_late':
            return { kind, by: 'rider', title: '严重超时', detail: `骑手比预计晚了很久，催了好几次才送到。`, suggestedRefund: Math.max(2, deliveryFee) };
        case 'spilled':
            return { kind, by: 'rider', title: '撒漏洒光', detail: `包装被压翻，汤汁洒了一袋子，「${it}」没法吃了。`, suggestedRefund: Math.max(4, Math.round(subtotal * 0.5)) };
        case 'rider_ate':
            return { kind, by: 'rider', title: '疑似偷吃', detail: `封口被拆开过，「${it}」明显少了一截，怀疑骑手动过餐。`, suggestedRefund: Math.max(4, Math.round(subtotal * 0.4)) };
        case 'left_at_door':
        default:
            return { kind, by: 'rider', title: '未送上门', detail: `骑手没打电话直接丢门口就走，差点被别人拿走。`, suggestedRefund: 0 };
    }
}

/** 下单时掷出本单会遇到的事（送达后才暴露）：坏骑手概率、商家/骑手事故、是否被强制砍单。 */
export function rollOrderIssues(store: Pick<TakeoutStore, 'integrity'>, items: TakeoutOrderItem[], subtotal: number, deliveryFee: number): OrderIssueRoll {
    const integrity = clamp01(store.integrity ?? 0.85);
    const riderReliability = Math.random() < 0.3 ? round2(rand(0.2, 0.65)) : round2(rand(0.7, 1.0));
    // 强制砍单：极不靠谱店小概率（收了钱迟迟不接单）
    const forceCancel = integrity < 0.3 && Math.random() < 0.28;

    const incidents: TakeoutIncident[] = [];
    if (!forceCancel) {
        const storeChance = clamp01(1 - integrity);
        for (const kind of shuffle(STORE_KINDS)) {
            if (incidents.filter(i => i.by === 'store').length >= 2) break;
            if (Math.random() < storeChance * (STORE_WEIGHT[kind] ?? 0.5)) incidents.push(buildStoreIncident(kind, items, subtotal));
        }
        const riderChance = clamp01(1 - riderReliability);
        for (const kind of shuffle(RIDER_KINDS)) {
            if (incidents.filter(i => i.by === 'rider').length >= 2) break;
            if (Math.random() < riderChance * (RIDER_WEIGHT[kind] ?? 0.5)) incidents.push(buildRiderIncident(kind, items, subtotal, deliveryFee));
        }
    }
    return { riderReliability, incidents: incidents.slice(0, 3), forceCancel };
}

/** 紧凑的事故标题串，用于列表/卡片角标。 */
export function incidentsSummary(order: TakeoutOrder): string {
    return (order.incidents || []).map(i => i.title).join('、');
}

/** 是否还有没处理掉的事故（用于显示「投诉/退款」入口）。 */
export function hasOpenIssues(order: TakeoutOrder): boolean {
    return (order.incidents || []).length > 0 && !order.complaint?.resolved;
}

/** 平台客服核定投诉：算出赔付金额与结案文案 + 两条客服消息（赔付由 App 侧落到钱包）。 */
export function resolveComplaint(order: TakeoutOrder): { refund: number; outcome: string; supportMessages: TakeoutChatMsg[] } {
    const incs = order.incidents || [];
    let refund = Math.min(order.total, incs.reduce((s, i) => s + Math.max(0, i.suggestedRefund), 0));
    if (incs.length && refund <= 0) refund = Math.min(order.total, 3);   // 纯添堵类也给点善意补偿
    refund = Math.round(refund);
    const titles = incs.map(i => i.title).join('、') || '本单问题';
    const blameStore = incs.some(i => i.by === 'store');
    const outcome = refund > 0
        ? `平台已核实：${titles}，判定${blameStore ? '商家' : '骑手'}责任，赔付 ¥${refund} 已原路退回钱包。`
        : `平台已记录「${titles}」并对责任方提出警告，给您带来不便十分抱歉。`;
    const now = Date.now();
    const supportMessages: TakeoutChatMsg[] = [
        { role: 'support', text: `您好，已收到您对「${order.storeName}」订单的反馈，正在为您核实…`, at: now },
        { role: 'support', text: outcome + (refund > 0 ? ' 感谢理解🙇' : ''), at: now + 1 },
    ];
    return { refund, outcome, supportMessages };
}

// ── 和骑手 / 商家 / 平台客服聊天 ─────────────────────────────────
const CANNED_RIDER_GOOD = ['您好，正赶去铺子取餐啦～', '马上到您楼下啦，电话保持畅通🛵', '路上有点堵，我尽量快，别急哈！', '到单元门口了，您下来取一下～', '保温袋裹好了，凉不了，稍等我两分钟'];
const CANNED_RIDER_BAD = ['我手上好几单呢，等着吧。', '搁门口了，自己下来拿。', '超时你找平台，别催我。', '这点跑腿费跑这么远，将就下得了。'];
const CANNED_STORE_GOOD = ['好嘞，正给您现做，稍等片刻～', '已经出餐啦，这就交给跑腿的！', '收到，您的口味我备注上了👌', '谢谢惠顾，趁热吃呀～', '招牌给您多搁了一勺，照顾好胃口'];
const CANNED_STORE_BAD = ['我家分量都是标准的，不存在少给。', '餐品没毛病，要退款你找平台。', '都做好了，概不退换。', '图片仅供参考，以实物为准哈。'];
const CANNED_SUPPORT = ['您好，反馈收到了，正帮您核实这张单～', '稍等，我们联系铺子核实并跟进赔付。', '给您添麻烦了十分抱歉，已记录在案。'];
// 顾客给了小费时，靠谱跑腿会更暖一点的兜底话术
const CANNED_RIDER_TIPPED = ['谢谢您的小费！我一定稳稳给您送到～', '收到您的心意啦，这单我格外上心🛵', '有您这份体谅，跑得再远也值！'];

function riderIsBad(order: TakeoutOrder): boolean {
    return (order.riderReliability ?? 1) < 0.6 || (order.incidents || []).some(i => i.by === 'rider');
}
function storeIsBad(order: TakeoutOrder): boolean {
    return !!order.cancelledByStore || (order.incidents || []).some(i => i.by === 'store');
}

export async function buildDeliveryReply(
    api: ResolvedApi, order: TakeoutOrder, target: 'rider' | 'store' | 'support', history: { role: string; text: string }[], userText: string,
): Promise<string> {
    const tipped = (order.tip ?? 0) > 0;
    const fallback = () => target === 'support' ? pick(CANNED_SUPPORT)
        : target === 'rider' ? (riderIsBad(order) ? pick(CANNED_RIDER_BAD) : (tipped ? pick(CANNED_RIDER_TIPPED) : pick(CANNED_RIDER_GOOD)))
            : (storeIsBad(order) ? pick(CANNED_STORE_BAD) : pick(CANNED_STORE_GOOD));
    const baseUrl = (api.baseUrl || '').trim();
    if (!baseUrl || !api.model) return fallback();

    const issues = (order.incidents || []).map(i => i.title).join('、');
    let persona: string;
    if (target === 'support') {
        persona = `你是这座小城吃食平台的「平台客服」，公事公办但向着食客。会核实这张饭票、安抚情绪、必要时承诺联系铺子与赔付。${issues ? `本单已知问题：${issues}。` : ''}`;
    } else if (target === 'rider') {
        persona = riderIsBad(order)
            ? `你是个不太靠谱的跑腿（外卖骑手），态度敷衍、不耐烦，爱把锅甩给路况/平台/铺子，常说「我手上好几单」「搁门口自己拿」。别太离谱，但能让人感到不上心。`
            : `你是跑腿小哥「${order.riderName}」，语气朴实、热心、接地气，会聊取餐/路况/到楼下、保温之类的实在话。${tipped ? '这位食客额外给了你小费，你心里记着这份体谅，回话更暖、更上心一点。' : ''}`;
    } else {
        persona = storeIsBad(order)
            ? `你是「${order.storeName}」的推诿型铺子客服，嘴硬、抵赖、踢皮球，否认份量偏轻/图文不符，爱说「分量标准」「概不退换」「以实物为准」「找平台去」。别爆粗，但明显不想负责，也不要自称黑心或提幕后规则。`
            : `你是「${order.storeName}」的铺子客服，热情、麻利，会聊现做/出餐/口味备注、招牌推荐之类。`;
    }
    const items = order.items.map(i => `${i.name}×${i.qty}`).join('、');
    const roleZh = target === 'rider' ? '跑腿' : target === 'store' ? '铺子' : '客服';
    const hist = history.slice(-6).map(h => `${h.role === 'user' ? '食客' : roleZh}：${h.text}`).join('\n');
    const prompt = `${persona}\n这张饭票点的是：${items}。\n${hist ? `之前的对话：\n${hist}\n` : ''}食客刚说：${userText}\n用一句话自然回复（不超过30字，口语，不要任何前缀）：`;
    try {
        const data = await callChatCompletion(api, {
            model: api.model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.9,
            max_tokens: 120,
            stream: false,
        }, {
            meta: makeApiUsageMeta('takeout.generate', { apiRole: api.apiRole || 'aux', apiBinding: api.apiBinding || '外卖对话' }),
        });
        return (extractContent(data) || '').trim() || fallback();
    } catch {
        return fallback();
    }
}

// ── 与来往 App 联动（外卖订单小票卡片） ───────────────────────────
const itemsText = (order: TakeoutOrder) => order.items.map(i => `${i.emoji || ''}${i.name}×${i.qty}`).join('、');

/** 聊天里「外卖订单小票」卡片的快照数据（存 message.metadata.takeout）。 */
export interface TakeoutCardMeta {
    takeoutOrderId: string;
    storeName: string;
    storeEmoji: string;
    items: { name: string; qty: number; emoji?: string }[];
    total: number;
    placedAt: number;
    etaAt: number;
    deliveredAt?: number;
    /** 谁给谁点：用于小票文案与图标 */
    initiatedBy: 'user' | 'char';
    recipientLabel: string;   // 收货人显示名（「你」/ 角色名 / 用户名）
    payLabel: string;         // 「我请客」/「TA 代付」/「我自己付」…
    note?: string;
}

export function buildTakeoutCardMeta(order: TakeoutOrder, nameOf: (id: string) => string): TakeoutCardMeta {
    const recipientLabel = order.recipient === 'me' ? '我' : (nameOf(order.recipient) || 'TA');
    let payLabel: string;
    if (order.payer === 'me') payLabel = order.recipient === 'me' ? '我自己付' : '我请客';
    else payLabel = `${nameOf(order.payer) || 'TA'}代付`;
    const etaAt = effectiveTakeoutEtaAt(order);
    return {
        takeoutOrderId: order.id,
        storeName: order.storeName,
        storeEmoji: order.storeEmoji,
        items: order.items.map(i => ({ name: i.name, qty: i.qty, emoji: i.emoji })),
        total: order.total,
        placedAt: order.placedAt,
        etaAt,
        deliveredAt: order.deliveredAt,
        initiatedBy: order.initiatedBy || 'user',
        recipientLabel,
        payLabel,
        note: order.note,
    };
}

/**
 * 下单时在关联角色聊天里生成一张「外卖订单小票」卡片。
 * - 用户为角色点 / 找角色代付 → role:'user'（小票出现在用户侧）。
 * - 角色为用户点（initiatedBy='char'）→ role:'assistant'（小票出现在角色侧，用户可点开看内容）。
 */
export async function postTakeoutPlacedToChat(order: TakeoutOrder, nameOf: (id: string) => string): Promise<void> {
    if (!order.charId) return;
    const role: 'user' | 'assistant' = order.initiatedBy === 'char' ? 'assistant' : 'user';
    await DB.saveMessage({
        charId: order.charId,
        role,
        type: 'takeout_card',
        content: '[外卖订单]',
        metadata: { takeoutOrderId: order.id, takeout: buildTakeoutCardMeta(order, nameOf) },
    } as any);
}

/** 用户确认收到「自己那份」外卖后，轻量地给角色留一句（角色可自然接话）。 */
export async function postTakeoutDeliveredToChat(order: TakeoutOrder): Promise<void> {
    if (!order.charId || order.recipient !== 'me') return;
    const text = `［外卖✅］「${order.storeName}」的外卖送到啦，已经收下了～（${itemsText(order)}）`;
    await DB.saveMessage({ charId: order.charId, role: 'user', type: 'text', content: text, metadata: { takeoutOrderId: order.id } } as any);
}

/**
 * 给角色点的单到点送达后的「角色收到外卖」系统提示——交给主动消息链路，
 * 让角色像真人收到对方送来的外卖那样在聊天里自然反应。
 */
export function buildTakeoutReceivedHint(order: TakeoutOrder, userName: string): string {
    // 文案见 utils/laiwangPrompts.ts → [8] takeoutReceivedHint
    return takeoutReceivedHint(userName, order.storeName, itemsText(order));
}

// ── 角色主动为用户点外卖（由聊天指令触发，需会话设置开关打开） ──────
const KEYWORDIZE = (s: string) => s.replace(/[，。、,.!！?？\s]+/g, ' ').trim();
const TAKEOUT_ORDER_DIRECTIVE_RE = /\[\[TAKEOUT_ORDER[：:]\s*([\s\S]*?)\]\]/g;

export interface TakeoutOrderDirectiveResult {
    /** 剥离 TAKEOUT_ORDER 指令后的正文 */
    content: string;
    /** 首个指令里的菜品/店铺描述；undefined 表示未命中指令 */
    desc?: string;
}

export interface TakeoutOrderSynthesisOptions {
    /** 完整用户设定：用于从用户资料/当前扮相里读取忌口与口味偏好。 */
    fullUserSetting?: string;
    /** 饭票里按收货对象保存的口味小纸条。 */
    tasteTags?: string[];
    tasteProfile?: TakeoutTasteProfile;
    /** 测试或调用方显式传入的候选店铺，会优先参与主动饭票合成。 */
    sourceStores?: TakeoutStore[];
    /** 是否读取当前饭票街区缓存、自定义铺子和菜库。默认 true。 */
    includeStoredSources?: boolean;
    /** 是否补入本地种子街。默认 true。 */
    includeDefaultStores?: boolean;
    /** 是否把兜底生成的新菜保存进“我的菜库”。默认 true。 */
    saveGeneratedDish?: boolean;
    /** 副 API 可用时，用来现写一批更贴近忌口的店铺。 */
    api?: ResolvedApi;
}

export interface TakeoutPreferenceHints {
    avoidSweet: boolean;
    hardAvoidSweet: boolean;
    lowSugar: boolean;
    avoidSpicy: boolean;
    hardAvoidSpicy: boolean;
    lowSpicy: boolean;
    plainTaste: boolean;
    avoidCilantro: boolean;
    avoidSeafood: boolean;
    avoidNuts: boolean;
    avoidDairy: boolean;
    avoidPork: boolean;
    vegetarian: boolean;
    avoidRawCold: boolean;
    lowOil: boolean;
    lowSalt: boolean;
}

const compactTasteText = (text: unknown): string => String(text || '').replace(/\s+/g, '');
const HARD_AVOID_SWEET_RE = /(不(?:太|怎么|大)?(?:喜欢|爱|吃|喝|要|碰|能接受)[^。；，,\n]{0,8}甜|不(?:吃|喝)[^。；，,\n]{0,8}(?:甜食|甜品|甜饮|奶茶)|讨厌[^。；，,\n]{0,8}甜|怕甜|甜腻|忌口[^。；，,\n]{0,12}甜|甜(?:食|品|饮)?[^。；，,\n]{0,12}(?:忌口|不吃|不喝|不喜欢|不要))/;
const LOW_SUGAR_RE = /(少糖|无糖|低糖|控糖|戒糖|抗糖|减糖|不要糖|糖尿病|高血糖|血糖高)/;
const HARD_AVOID_SPICY_RE = /(不(?:太|怎么|大)?(?:喜欢|爱|吃|喝|要|碰|能接受)[^。；，,\n]{0,8}(?:辣|辛辣|麻辣)|不(?:吃|喝|要|放)[^。；，,\n]{0,8}(?:辣|辣椒|辛辣|麻辣)|(?:吃不了|不能吃|受不了)[^。；，,\n]{0,6}(?:辣|辛辣|麻辣)|忌口?[^。；，,\n]{0,12}(?:辣|辛辣|麻辣)|(?:辣|辛辣|麻辣)[^。；，,\n]{0,12}(?:忌口|不吃|不喝|不要|不放|不能吃|吃不了|受不了)|怕辣|无辣(?!不欢)|不辣(?!不欢))/;
const LOW_SPICY_RE = /(少辣|微辣|轻辣|低辣|辣少点|少放辣|不要太辣|别太辣)/;
const PLAIN_TASTE_RE = /(口味清淡|吃清淡|清淡一点|清淡些|清淡为主)/;
const AVOID_CILANTRO_RE = /(不要香菜|不吃香菜|不放香菜|别放香菜|香菜[^。；，,\n]{0,8}(?:不要|不吃|别放|不放)|不要芫荽|不吃芫荽|不放芫荽|别放芫荽|芫荽[^。；，,\n]{0,8}(?:不要|不吃|别放|不放))/;
const AVOID_SEAFOOD_RE = /(海鲜过敏|鱼虾过敏|虾蟹过敏|不(?:吃|碰|能吃)[^。；，,\n]{0,8}(?:海鲜|鱼|虾|蟹|贝|蚝)|(?:海鲜|鱼|虾|蟹|贝|蚝)[^。；，,\n]{0,12}(?:过敏|忌口|不吃|不能吃))/;
const AVOID_NUTS_RE = /(坚果过敏|花生过敏|不(?:吃|碰|能吃)[^。；，,\n]{0,8}(?:坚果|花生|腰果|杏仁|核桃)|(?:坚果|花生|腰果|杏仁|核桃)[^。；，,\n]{0,12}(?:过敏|忌口|不吃|不能吃))/;
const AVOID_DAIRY_RE = /(乳糖不耐|牛奶过敏|乳制品过敏|不(?:喝|吃|碰|能吃)[^。；，,\n]{0,8}(?:牛奶|奶制品|乳制品|奶茶|奶油|芝士)|(?:牛奶|奶制品|乳制品|奶茶|奶油|芝士)[^。；，,\n]{0,12}(?:过敏|忌口|不吃|不能吃))/;
const AVOID_PORK_RE = /(不(?:吃|碰|能吃)[^。；，,\n]{0,8}(?:猪肉|猪|五花肉|排骨)|(?:猪肉|猪|五花肉|排骨)[^。；，,\n]{0,12}(?:忌口|不吃|不能吃)|清真)/;
const VEGETARIAN_RE = /(素食|吃素|纯素|不(?:吃|碰|能吃)[^。；，,\n]{0,8}(?:肉|荤)|(?:肉|荤)[^。；，,\n]{0,12}(?:忌口|不吃|不能吃))/;
const AVOID_RAW_COLD_RE = /(不(?:吃|喝|碰|能吃)[^。；，,\n]{0,8}(?:生冷|冷饮|冰的|凉的|刺身|生食)|(?:生冷|冷饮|冰的|凉的|刺身|生食)[^。；，,\n]{0,12}(?:忌口|不吃|不能吃)|胃寒|热饮)/;
const LOW_OIL_RE = /(少油|低油|不要太油|别太油|少放油)/;
const LOW_SALT_RE = /(少盐|低盐|不要太咸|别太咸|少放盐)/;
const SWEET_STORE_RE = /(奶茶|甜品|烘焙|糖水|甜点)/;
const SWEET_DISH_RE = /(甜|糖|奶茶|奶绿|奶昔|奶盖|波波|阿华田|焦糖|甘露|蛋糕|提拉米苏|布朗尼|甜筒|冰淇淋|双皮奶|芋圆|烧仙草|绵绵冰|芝士挞|苹果派|糖水|可乐|雪碧|汽水|果蔬汁|酸奶|酸梅汤|冰镇西瓜|草莓|葡萄|芒果|红豆|脏脏包)/;
const SPICY_STORE_RE = /(麻辣|热辣|川菜|湘菜|火锅|串串|烧烤|小龙虾|螺蛳粉)/;
const SPICY_DISH_RE = /(辣|麻辣|麻婆|椒|川|湘|泡椒|剁椒|水煮|口水鸡|小龙虾|螺蛳粉|串串|麻辣烫|火锅|酸辣|麦辣|热辣|宫保|黑椒)/;
const CILANTRO_DISH_RE = /(香菜|芫荽)/;
const SEAFOOD_DISH_RE = /(海鲜|虾|蟹|鱼|贝|蛤|蚝|鱿鱼|章鱼|三文鱼|鳗鱼|干贝|花甲|生蚝)/;
const NUTS_DISH_RE = /(花生|坚果|腰果|杏仁|核桃|榛子|开心果|麻酱)/;
const DAIRY_DISH_RE = /(奶|芝士|奶油|酸奶|乳酪|奶茶|奶盖|奶昔|双皮奶|冰淇淋|提拉米苏|芝士挞)/;
const PORK_DISH_RE = /(猪|排骨|五花肉|扣肉|午餐肉|培根|香肠|火腿)/;
const MEAT_DISH_RE = /(肉|鸡|鸭|牛|羊|鱼|虾|蟹|排骨|牛排|炸鸡|鸡翅|午餐肉|培根|火腿|蛋)/;
const RAW_COLD_DISH_RE = /(冰|冷|凉|刺身|沙拉|冰镇|冰淇淋|绵绵冰|甜筒|寿司|生腌)/;

export function inferTakeoutPreferenceHints(options: TakeoutOrderSynthesisOptions = {}): TakeoutPreferenceHints {
    const full = compactTasteText(options.fullUserSetting);
    const profile = options.tasteProfile || (options.tasteTags ? { tags: options.tasteTags } : undefined);
    const taste = compactTasteText(buildTasteNote(profile));
    const text = `${full}\n${taste}`;
    const hardAvoidSweet = HARD_AVOID_SWEET_RE.test(text) || /(控糖|戒糖|忌糖|糖尿病|高血糖|血糖高|不吃糖|不能吃糖)/.test(text);
    const lowSugar = LOW_SUGAR_RE.test(text);
    const hardAvoidSpicy = HARD_AVOID_SPICY_RE.test(text);
    const plainTaste = PLAIN_TASTE_RE.test(text);
    const lowSpicy = LOW_SPICY_RE.test(text) || plainTaste;
    return {
        hardAvoidSweet,
        lowSugar,
        avoidSweet: hardAvoidSweet || lowSugar,
        hardAvoidSpicy,
        lowSpicy,
        avoidSpicy: hardAvoidSpicy || lowSpicy,
        plainTaste,
        avoidCilantro: AVOID_CILANTRO_RE.test(text),
        avoidSeafood: AVOID_SEAFOOD_RE.test(text),
        avoidNuts: AVOID_NUTS_RE.test(text),
        avoidDairy: AVOID_DAIRY_RE.test(text),
        avoidPork: AVOID_PORK_RE.test(text),
        vegetarian: VEGETARIAN_RE.test(text),
        avoidRawCold: AVOID_RAW_COLD_RE.test(text),
        lowOil: LOW_OIL_RE.test(text) || plainTaste,
        lowSalt: LOW_SALT_RE.test(text) || plainTaste,
    };
}

const hasDishAvoidancePreference = (pref: TakeoutPreferenceHints): boolean => (
    pref.avoidSweet || pref.avoidSpicy || pref.avoidCilantro || pref.avoidSeafood || pref.avoidNuts
    || pref.avoidDairy || pref.avoidPork || pref.vegetarian || pref.avoidRawCold
);

const dishConflictsWithPreference = (dish: TakeoutDish, pref: TakeoutPreferenceHints): boolean => {
    const name = dish.name;
    return (
        (pref.avoidSweet && SWEET_DISH_RE.test(name))
        || (pref.avoidSpicy && SPICY_DISH_RE.test(name))
        || (pref.avoidCilantro && CILANTRO_DISH_RE.test(name))
        || (pref.avoidSeafood && SEAFOOD_DISH_RE.test(name))
        || (pref.avoidNuts && NUTS_DISH_RE.test(name))
        || (pref.avoidDairy && DAIRY_DISH_RE.test(name))
        || (pref.avoidPork && PORK_DISH_RE.test(name))
        || (pref.vegetarian && MEAT_DISH_RE.test(name))
        || (pref.avoidRawCold && RAW_COLD_DISH_RE.test(name))
    );
};

const storeConflictsWithPreference = (store: TakeoutStore, pref: TakeoutPreferenceHints): boolean => {
    const text = `${store.name}${store.category}`;
    return (
        (pref.avoidSweet && SWEET_STORE_RE.test(text))
        || (pref.avoidSpicy && SPICY_STORE_RE.test(text))
    );
};

function synthesizedOrderNote(options: TakeoutOrderSynthesisOptions, pref: TakeoutPreferenceHints): string {
    const notes: string[] = [];
    if (pref.hardAvoidSweet) notes.push('用户资料：不爱甜食，避开甜品、奶茶和含糖饮品');
    else if (pref.lowSugar) notes.push('用户资料：偏好少糖，尽量避开过甜餐品');
    if (pref.hardAvoidSpicy) notes.push('用户资料：忌辣，避开辛辣餐品');
    else if (pref.lowSpicy) notes.push(pref.plainTaste ? '用户资料：偏好清淡' : '用户资料：偏好少辣，尽量避开重辣餐品');
    if (pref.avoidCilantro) notes.push('用户资料：不要香菜');
    if (pref.avoidSeafood) notes.push('用户资料：不吃海鲜/鱼虾蟹');
    if (pref.avoidNuts) notes.push('用户资料：坚果或花生忌口');
    if (pref.avoidDairy) notes.push('用户资料：乳制品忌口');
    if (pref.avoidPork) notes.push('用户资料：不吃猪肉');
    if (pref.vegetarian) notes.push('用户资料：素食');
    if (pref.avoidRawCold) notes.push('用户资料：避开生冷');
    if (pref.lowOil && !pref.plainTaste) notes.push('用户资料：少油');
    if (pref.lowSalt && !pref.plainTaste) notes.push('用户资料：少盐');
    const base = notes.join('；');
    return mergeNoteWithTaste(base, options.tasteProfile || options.tasteTags || []);
}

type TakeoutCandidateSource = 'customDish' | 'customStore' | 'cache' | 'ai' | 'default' | 'explicit' | 'generated';

interface TakeoutCandidateStore {
    store: TakeoutStore;
    source: TakeoutCandidateSource;
    index: number;
}

interface TakeoutDishCandidate extends TakeoutCandidateStore {
    dish: TakeoutDish;
    score: number;
}

export interface TakeoutSafeSynthesisResult {
    ok: boolean;
    order?: TakeoutOrder;
    changedReason?: string;
    generatedDish?: TakeoutDish;
    blockedReason?: string;
}

function readCachedTakeoutStores(): TakeoutStore[] {
    if (typeof localStorage === 'undefined') return [];
    try {
        const raw = JSON.parse(localStorage.getItem(TAKEOUT_STORES_CACHE_KEY) || '[]');
        if (!Array.isArray(raw)) return [];
        return raw.map(s => sanitizeTakeoutStore(s)).filter((s): s is TakeoutStore => !!s);
    } catch {
        return [];
    }
}

function virtualStoreFromDishes(name: string, dishes: TakeoutDish[], source: TakeoutCandidateSource): TakeoutCandidateStore | null {
    const safeDishes = dishes.map(d => sanitizeTakeoutDish(d)).filter((d): d is TakeoutDish => !!d);
    if (!safeDishes.length) return null;
    return {
        source,
        index: 0,
        store: {
            id: genId(source === 'generated' ? 'safe_store' : 'library_store'),
            name,
            emoji: '🍱',
            category: '中餐',
            rating: 4.8,
            monthlySales: Math.max(20, safeDishes.length * 12),
            deliveryMinutes: Math.floor(rand(22, 38)),
            deliveryFee: pick([0, 2, 3]),
            minOrder: 0,
            distanceKm: round1(rand(0.6, 2.4)),
            promo: undefined,
            blurb: source === 'generated' ? '按忌口临时现做' : '从我的菜库里挑',
            integrity: 0.92,
            dishes: decorateDishes(safeDishes, 500),
        },
    };
}

function dedupeCandidateStores(stores: TakeoutCandidateStore[]): TakeoutCandidateStore[] {
    const seen = new Set<string>();
    const out: TakeoutCandidateStore[] = [];
    stores.forEach((entry, index) => {
        const key = entry.store.id || `${entry.store.name}|${entry.store.category}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push({ ...entry, index });
    });
    return out;
}

function collectStoredCandidateStores(options: TakeoutOrderSynthesisOptions): TakeoutCandidateStore[] {
    const entries: TakeoutCandidateStore[] = [];
    let idx = 0;
    for (const store of options.sourceStores || []) {
        const clean = sanitizeTakeoutStore(store);
        if (clean) entries.push({ store: clean, source: 'explicit', index: idx++ });
    }
    if (options.includeStoredSources !== false) {
        const library = virtualStoreFromDishes('我的菜库·常备饭票', getCustomDishes(), 'customDish');
        if (library) entries.push({ ...library, index: idx++ });
        for (const store of getCustomStores()) entries.push({ store, source: 'customStore', index: idx++ });
        for (const store of mergeCustomStores(readCachedTakeoutStores())) entries.push({ store, source: 'cache', index: idx++ });
    }
    if (options.includeDefaultStores !== false) {
        for (const store of generateStores(20)) entries.push({ store, source: 'default', index: idx++ });
    }
    return dedupeCandidateStores(entries);
}

async function collectCandidateStores(desc: string, pref: TakeoutPreferenceHints, options: TakeoutOrderSynthesisOptions): Promise<TakeoutCandidateStore[]> {
    const entries = collectStoredCandidateStores(options);
    const api = options.api;
    if (api?.baseUrl && api.model) {
        const query = [desc.trim(), preferenceSearchText(pref), '清淡主食'].filter(Boolean).join(' ');
        try {
            const generated = await generateStoresAI(api, 12, query);
            let idx = entries.length;
            for (const store of generated) entries.push({ store, source: 'ai', index: idx++ });
        } catch {
            // 主动饭票不能因为副 API 失败就放弃，本地候选和兜底生成继续工作。
        }
    }
    return dedupeCandidateStores(entries);
}

function preferenceSearchText(pref: TakeoutPreferenceHints): string {
    const parts: string[] = [];
    if (pref.plainTaste || pref.lowOil || pref.lowSalt) parts.push('清淡');
    if (pref.avoidSpicy) parts.push('不辣');
    if (pref.avoidSweet) parts.push('低糖');
    if (pref.avoidSeafood) parts.push('无海鲜');
    if (pref.avoidNuts) parts.push('无坚果');
    if (pref.avoidDairy) parts.push('无乳制品');
    if (pref.avoidPork) parts.push('不含猪肉');
    if (pref.vegetarian) parts.push('素食');
    if (pref.avoidRawCold) parts.push('热食');
    return parts.join(' ');
}

function descConflictsWithPreference(desc: string, pref: TakeoutPreferenceHints): boolean {
    const text = desc.trim();
    if (!text) return false;
    const fakeDish = { id: 'desc', name: text, price: 0 } as TakeoutDish;
    const fakeStore = { name: text, category: text } as TakeoutStore;
    return dishConflictsWithPreference(fakeDish, pref) || storeConflictsWithPreference(fakeStore, pref);
}

function safeDishBias(dish: TakeoutDish, pref: TakeoutPreferenceHints): number {
    const name = dish.name;
    let score = 0;
    if (/(粥|汤|面|粉|米线|饭|盖饭|套餐|小米|白粥|蔬菜|时蔬|豆腐)/.test(name)) score += 12;
    if (/(清|淡|热|暖|养胃|家常|素|蔬)/.test(name)) score += 8;
    if (pref.vegetarian && /(蔬|素|豆腐|菌菇|时蔬|青菜|南瓜|小米)/.test(name)) score += 16;
    if (pref.avoidRawCold && /(热|汤|粥|面|饭|煲)/.test(name)) score += 10;
    if (pref.lowOil || pref.lowSalt || pref.plainTaste) {
        if (/(清|白|蒸|煮|汤|粥|小米|时蔬)/.test(name)) score += 10;
        if (/(炸|煎|烤|烧烤|油|酥|香锅)/.test(name)) score -= 10;
    }
    return score;
}

function scoreDishCandidate(entry: TakeoutCandidateStore, dish: TakeoutDish, kw: string[], pref: TakeoutPreferenceHints): number {
    const sourceScore: Record<TakeoutCandidateSource, number> = {
        customDish: 100,
        customStore: 82,
        explicit: 75,
        cache: 58,
        ai: 54,
        default: 32,
        generated: 120,
    };
    let score = sourceScore[entry.source] || 0;
    for (const k of kw) {
        if (dish.name.includes(k) || k.includes(dish.name)) score += 22;
        if (entry.store.name.includes(k) || entry.store.category.includes(k)) score += 8;
    }
    if (dish.popular) score += 6;
    if (dish.userCustom || dish.userEdited) score += 14;
    if (entry.store.userCustom || entry.store.userEdited) score += 8;
    if (storeConflictsWithPreference(entry.store, pref)) score -= 16;
    score += safeDishBias(dish, pref);
    score -= entry.index * 0.01;
    return score;
}

function pickSafeDishCandidate(stores: TakeoutCandidateStore[], desc: string, pref: TakeoutPreferenceHints): TakeoutDishCandidate | null {
    const kw = KEYWORDIZE(desc).split(' ').filter(Boolean);
    let best: TakeoutDishCandidate | null = null;
    for (const entry of stores) {
        for (const dish of entry.store.dishes || []) {
            if (dishConflictsWithPreference(dish, pref)) continue;
            const score = scoreDishCandidate(entry, dish, kw, pref);
            if (!best || score > best.score) best = { ...entry, dish, score };
        }
    }
    return best;
}

function generatedSafeDish(pref: TakeoutPreferenceHints, desc: string): TakeoutDish {
    let name = '暖胃小米粥';
    let emoji = '🥣';
    let descText = '按忌口现做';
    let price = 16;
    if (pref.vegetarian) {
        name = pref.avoidRawCold ? '热乎时蔬豆腐饭' : '时蔬豆腐饭';
        emoji = '🥬';
        descText = '素食清淡';
        price = 22;
    } else if (pref.avoidRawCold || pref.plainTaste || pref.lowOil || pref.lowSalt) {
        name = '清汤鸡丝面';
        emoji = '🍜';
        descText = '清淡热食';
        price = 24;
        if (pref.avoidPork) descText = '不含猪肉';
    } else if (/饭|盖饭|米饭/.test(desc)) {
        name = '家常时蔬鸡肉饭';
        emoji = '🍚';
        descText = '稳妥主食';
        price = 24;
    }
    if (pref.avoidDairy || pref.avoidSeafood || pref.avoidNuts || pref.avoidSweet || pref.avoidSpicy || pref.avoidCilantro || pref.avoidPork) {
        descText = `${descText}·避开忌口`.slice(0, 30);
    }
    const dish = sanitizeTakeoutDish({
        id: genId('safe_dish'),
        name,
        emoji,
        desc: descText,
        price,
        popular: true,
        userCustom: true,
        userEdited: true,
    });
    return dish || { id: genId('safe_dish'), name: '热白粥', emoji: '🥣', desc: '按忌口现做', price: 12, popular: true, userCustom: true, userEdited: true };
}

function buildSynthesizedOrder(
    charId: string,
    address: string,
    store: TakeoutStore,
    dishes: TakeoutDish[],
    options: TakeoutOrderSynthesisOptions,
    pref: TakeoutPreferenceHints,
    changedReason?: string,
): TakeoutOrder {
    const chosen = dishes.slice(0, 3);
    const items: TakeoutOrderItem[] = chosen.map(d => ({ dishId: d.id, name: d.name, price: d.price, qty: 1, emoji: d.emoji }));
    const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
    const placedAt = Date.now();
    const etaAt = effectiveTakeoutEtaAt({ placedAt, etaAt: placedAt + store.deliveryMinutes * 60000 });
    const rider = newRider();
    const noteParts = [changedReason ? `按忌口改成更稳妥餐食：${changedReason}` : '', synthesizedOrderNote(options, pref)].filter(Boolean);
    const note = noteParts.join('；');
    return {
        id: genId('order'),
        storeId: store.id, storeName: store.name, storeEmoji: store.emoji,
        items,
        subtotal, deliveryFee: store.deliveryFee, packFee: PACK_FEE,
        total: subtotal + store.deliveryFee + PACK_FEE,
        recipient: 'me', payer: charId, charId,
        payStatus: 'paid',
        status: 'preparing',
        riderName: rider.name, riderEmoji: rider.emoji,
        address: address || '城南花园 3 栋 502',
        note: note || undefined,
        placedAt, etaAt,
        chat: [], chatTarget: 'rider',
        initiatedBy: 'char',
    };
}

/** 解析并剥离 [[TAKEOUT_ORDER: 菜品/店铺]]，供聊天与线下模式共用。 */
export function extractTakeoutOrderDirective(content: string): TakeoutOrderDirectiveResult {
    if (!content || !content.includes('TAKEOUT_ORDER')) return { content };
    TAKEOUT_ORDER_DIRECTIVE_RE.lastIndex = 0;
    const first = TAKEOUT_ORDER_DIRECTIVE_RE.exec(content);
    if (!first) return { content };
    const desc = (first[1] || '').trim();
    const stripped = content.replace(TAKEOUT_ORDER_DIRECTIVE_RE, '').trim();
    return { content: stripped, desc };
}

/**
 * 依据一句菜品/店铺描述，合成一张「角色为用户点」的外卖订单（recipient=me, payer=char）。
 * 尽量从描述里匹配店铺与菜名，匹配不到则随机选店 + 招牌菜兜底。
 */
export function synthesizeCharOrder(charId: string, desc: string, address: string, options: TakeoutOrderSynthesisOptions = {}): TakeoutOrder {
    const stores = generateStores(16);
    const pref = inferTakeoutPreferenceHints(options);
    const candidateStores = hasDishAvoidancePreference(pref)
        ? stores.filter(s => !storeConflictsWithPreference(s, pref) && s.dishes.some(d => !dishConflictsWithPreference(d, pref)))
        : stores;
    const searchStores = candidateStores.length ? candidateStores : stores;
    const kw = KEYWORDIZE(desc).split(' ').filter(Boolean);
    const matchScore = (s: TakeoutStore) => {
        let score = 0;
        for (const k of kw) {
            if (s.name.includes(k) || s.category.includes(k)) score += 2;
            score += s.dishes.filter(d => !dishConflictsWithPreference(d, pref) && (d.name.includes(k) || k.includes(d.name))).length;
        }
        return score;
    };
    let store = searchStores[0] || stores[0];
    let best = -1;
    for (const s of searchStores) { const sc = matchScore(s); if (sc > best) { best = sc; store = s; } }

    // 选菜：优先描述里点到的菜，否则用招牌（popular）兜底，最多 3 样
    const eligibleDishes = hasDishAvoidancePreference(pref)
        ? store.dishes.filter(d => !dishConflictsWithPreference(d, pref))
        : store.dishes;
    let chosen = eligibleDishes.filter(d => kw.some(k => d.name.includes(k) || k.includes(d.name)));
    if (chosen.length === 0) chosen = eligibleDishes.filter(d => d.popular);
    if (chosen.length === 0) chosen = eligibleDishes.slice(0, 2);
    if (chosen.length === 0) chosen = store.dishes.slice(0, 2);
    chosen = chosen.slice(0, 3);
    const items: TakeoutOrderItem[] = chosen.map(d => ({ dishId: d.id, name: d.name, price: d.price, qty: 1, emoji: d.emoji }));
    const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
    const placedAt = Date.now();
    const etaAt = effectiveTakeoutEtaAt({ placedAt, etaAt: placedAt + store.deliveryMinutes * 60000 });
    const rider = newRider();
    const note = synthesizedOrderNote(options, pref);
    return {
        id: genId('order'),
        storeId: store.id, storeName: store.name, storeEmoji: store.emoji,
        items,
        subtotal, deliveryFee: store.deliveryFee, packFee: PACK_FEE,
        total: subtotal + store.deliveryFee + PACK_FEE,
        recipient: 'me', payer: charId, charId,
        payStatus: 'paid',
        status: 'preparing',
        riderName: rider.name, riderEmoji: rider.emoji,
        address: address || '城南花园 3 栋 502',
        note: note || undefined,
        placedAt, etaAt,
        chat: [], chatTarget: 'rider',
        initiatedBy: 'char',
    };
}

export async function synthesizeCharOrderSafely(
    charId: string,
    desc: string,
    address: string,
    options: TakeoutOrderSynthesisOptions = {},
): Promise<TakeoutSafeSynthesisResult> {
    const pref = inferTakeoutPreferenceHints(options);
    const stores = await collectCandidateStores(desc, pref, options);
    const candidate = pickSafeDishCandidate(stores, desc, pref);
    const conflicts = descConflictsWithPreference(desc, pref);
    if (candidate) {
        const changedReason = conflicts ? '原本想点的内容和口味小纸条冲突，已换成安全餐食' : undefined;
        return {
            ok: true,
            order: buildSynthesizedOrder(charId, address, candidate.store, [candidate.dish], options, pref, changedReason),
            changedReason,
        };
    }

    const generated = generatedSafeDish(pref, desc);
    if (dishConflictsWithPreference(generated, pref)) {
        return {
            ok: false,
            blockedReason: '没有找到能避开忌口/过敏的安全餐品',
        };
    }
    const saved = options.saveGeneratedDish === false ? generated : (saveCustomDish(generated) || generated);
    const virtual = virtualStoreFromDishes('饭票安全灶', [saved], 'generated');
    if (!virtual) {
        return {
            ok: false,
            blockedReason: '安全餐品生成失败',
        };
    }
    const changedReason = conflicts
        ? '原本想点的内容和口味小纸条冲突，已现做安全餐食'
        : '没有合适现成菜，已按口味小纸条现做安全餐食';
    return {
        ok: true,
        order: buildSynthesizedOrder(charId, address, virtual.store, [saved], options, pref, changedReason),
        changedReason,
        generatedDish: saved,
    };
}

/** 聊天里供角色主动点外卖用的指令名（应答文本里出现，会被后处理剥离并执行）。 */
export const TAKEOUT_ORDER_EVENT = 'moro-char-takeout-order';

// ── 从聊天回形针打开外卖 App 的「下单意图」（预设收货角色） ──────────
const INTENT_KEY = 'moro_takeout_intent_v1';
export interface TakeoutIntent { recipientCharId: string; recipientName?: string; }

export function setTakeoutIntent(intent: TakeoutIntent | null): void {
    try {
        if (intent) localStorage.setItem(INTENT_KEY, JSON.stringify(intent));
        else localStorage.removeItem(INTENT_KEY);
    } catch { /* ignore */ }
}

/** 读取并清除一次性下单意图。 */
export function consumeTakeoutIntent(): TakeoutIntent | null {
    try {
        const raw = localStorage.getItem(INTENT_KEY);
        if (raw) { localStorage.removeItem(INTENT_KEY); return JSON.parse(raw) as TakeoutIntent; }
    } catch { /* ignore */ }
    return null;
}

// ── 「钉在墙上的常去铺子」（按店名收藏，店铺每次刷新会变，故以名字为锚） ──────
const PINNED_KEY = 'moro_takeout_pinned_v1';

export function getPinnedStores(): string[] {
    try {
        const raw = localStorage.getItem(PINNED_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
    } catch { return []; }
}

/** 钉上 / 取下一家常去的铺子，返回更新后的名单。 */
export function togglePinnedStore(name: string): string[] {
    const cur = getPinnedStores();
    const next = cur.includes(name) ? cur.filter(n => n !== name) : [name, ...cur].slice(0, 24);
    try { localStorage.setItem(PINNED_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    return next;
}

// ── 实时联动：订单变化广播（小票 / 灵动岛即时刷新） ─────────────────
/** 订单发生变化（下单 / 送达 / 评价…）时广播，供聊天小票与灵动岛即时刷新。 */
export const TAKEOUT_UPDATED_EVENT = 'moro-takeout-updated';
export function notifyTakeoutUpdated(): void {
    try { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(TAKEOUT_UPDATED_EVENT)); } catch { /* ignore */ }
}

/** 进行中的订单（备餐 / 配送 / 待收货），按最快送达排序——灵动岛 Live Activity 用。 */
export function pickActiveOrders(orders: TakeoutOrder[], _now = Date.now()): TakeoutOrder[] {
    return orders
        .filter(o => o.status !== 'cancelled' && !o.deliveredAt)
        .sort((a, b) => effectiveTakeoutEtaAt(a) - effectiveTakeoutEtaAt(b));
}

// ── 外卖评价 + 其它 NPC 评论 ───────────────────────────────────────
export interface StoreNpcReview { id: string; name: string; emoji: string; rating: number; text: string; date: string; likes: number; reply?: string; }

const REVIEWER_NAMES = ['吃货小分队', '匿名食客', '楼下的老王', '减脂中的喵', '深夜放毒', '加班狗本狗', '带饭星人', '嘴刁的猫', '干饭人', '隔壁老张', '美食侦探', '一只柯基', '打工不易', '学生党一枚', '宝妈日常', '路过的猫', '挑食小公主', '夜跑选手', '本市干饭冠军', '蹲点测评员', '不爱做饭星人', '退休美食家', '楼上的设计师', '凌晨emo选手'];
const REVIEWER_EMOJIS = ['🦊', '🐱', '🐻', '🐼', '🐯', '🐰', '🐧', '🐸', '🐵', '🦝', '🐶', '🦦', '🐹', '🦉', '🐨', '🦥', '🐧', '🐤'];
const REVIEW_POS = ['分量很足，味道在线，会回购！', '送得比预计还快，包装也干净👍', '点了好多次了，稳定发挥～', '性价比真的高，学生党友好', '热乎乎的，跑腿小哥人很好', '招牌名不虚传，绝了', '第一次点就爱上了，下次还来', '汤底很鲜，一滴不剩', '老板很实在，给的料超多', '隔着保温袋都香，开盖那一下值了', '加班到深夜，这口热乎救了我', '老板娘还塞了颗糖，细节满分'];
const REVIEW_MID = ['味道还行，就是送得有点慢', '分量一般般，凑合吃', '中规中矩，不难吃也不惊艳', '包装有点简陋，味道还可以', '正常发挥吧，没踩雷', '招牌可以，配菜略敷衍'];
const REVIEW_NEG = ['等了好久才送到，凉透了…', '和图片差距有点大', '有点咸了，下次得备注少盐', '分量缩水，性价比一般', '催了三回才出餐，心累'];
const REPLY_DINER_POS = ['同感！我也常点这家', '马住，下次试试', '哈哈哈被你种草了', '+1，他家招牌真的可以', '看饿了…', '楼主嘴和我一样刁，信了'];
const REPLY_DINER_NEG = ['我也遇到过送得慢…', '可能高峰期人手不够吧', '备注少盐会好很多', '抱抱，换家吧别气'];
const REPLY_MERCHANT_POS = ['感谢支持，欢迎下次再来呀～', '谢谢喜欢！我们会继续努力🧡', '老顾客了，给您加了份小料～', '被夸到啦，明天继续守着灶台！'];
const REPLY_MERCHANT_NEG = ['抱歉让您久等了，已叮嘱跑腿，下次一定更快🙏', '非常抱歉口味没达预期，欢迎备注，我们改进！', '少给了是我们的错，已记下，请私信补偿'];

const hashStr = (s: string): number => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const mulberry32 = (a: number) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

/** 为店铺生成稳定的 NPC 评价（按店名做种子，同店每次进来一致）。 */
export function generateStoreReviews(storeName: string, baseRating = 4.5, count = 8): StoreNpcReview[] {
    const rnd = mulberry32(hashStr(storeName));
    const pickR = <T,>(arr: T[]) => arr[Math.floor(rnd() * arr.length)];
    const out: StoreNpcReview[] = [];
    const n = 5 + Math.floor(rnd() * (count - 4));
    for (let i = 0; i < n; i++) {
        const roll = rnd();
        // 评分向店铺整体评分靠拢：大多 4~5 星，偶有 3 星，极少 2 星
        const rating = roll > 0.82 ? 3 : roll > 0.96 ? 2 : (baseRating >= 4.6 ? 5 : (rnd() > 0.4 ? 5 : 4));
        const text = rating >= 4 ? pickR(REVIEW_POS) : rating === 3 ? pickR(REVIEW_MID) : pickR(REVIEW_NEG);
        const daysAgo = 1 + Math.floor(rnd() * 60);
        const d = new Date(Date.now() - daysAgo * 86400000);
        const review: StoreNpcReview = {
            id: `npcr_${hashStr(storeName)}_${i}`,
            name: pickR(REVIEWER_NAMES),
            emoji: pickR(REVIEWER_EMOJIS),
            rating,
            text,
            date: `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')}`,
            likes: Math.floor(rnd() * 48),
        };
        if (rnd() > 0.55) review.reply = rating >= 4 ? pickR(REPLY_MERCHANT_POS) : pickR(REPLY_MERCHANT_NEG);
        out.push(review);
    }
    return out.sort((a, b) => b.likes - a.likes);
}

interface AiReviewRaw { name?: string; emoji?: string; rating?: number; text?: string; reply?: string; }

/**
 * AI 现场为某店生成买家食评（仿真有好有坏，按店铺评分/红旗调好坏比例）。
 * 失败 / 未配 API 回退到算法版 generateStoreReviews。
 */
export async function generateStoreReviewsAI(
    api: ResolvedApi,
    store: Pick<TakeoutStore, 'name' | 'category' | 'rating' | 'warning' | 'dishes'>,
    count = 8,
): Promise<StoreNpcReview[]> {
    const baseUrl = (api.baseUrl || '').trim();
    if (!baseUrl || !api.model) return generateStoreReviews(store.name, store.rating, count);
    const rating = store.rating ?? 4.3;
    const dishHint = (store.dishes || []).slice(0, 4).map(d => d.name).join('、');
    const tone = rating >= 4.5 ? '大多是好评（细节具体、夸分量/出餐快/味道好），可夹 1 条挑刺中评'
        : rating >= 4.0 ? '好坏参半，3~5 星都有，吐槽与认可都要有'
        : '差评/中评为主（1~3 星居多），骂到点子上：缺斤少两、图文不符、送得慢凉了、卫生差、态度差，可留 1 条还行的';
    const prompt = `你在为外卖店「${store.name}」（${store.category}，综合 ${rating} 分${store.warning ? `，有用户提醒「${store.warning}」` : ''}）现写 ${count} 条真实买家食评。招牌菜：${dishHint || '家常菜'}。
分布要求：${tone}。要像真人——口吻各异、有具体细节（哪道菜、份量、温度、配送、包装、老板态度），别像广告、别千篇一律。
每条：name（食客昵称，有梗）、emoji（一个动物头像 emoji）、rating（1~5 整数，按上面分布）、text（15~45字）、可选 reply（商家或其他食客的一句回复）。
只输出 JSON，不要解释：{"reviews":[{"name":"","emoji":"🐱","rating":5,"text":"","reply":""}]}`;
    try {
        const data = await callChatCompletion(api, {
            model: api.model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 1.0,
            max_tokens: 1600,
            stream: false,
        }, {
            meta: makeApiUsageMeta('takeout.generate', { apiRole: api.apiRole || 'aux', apiBinding: api.apiBinding || '生成食评' }),
        });
        const raw = data?.choices?.[0]?.message?.content || '';
        const parsed = extractJson(raw);
        const list: AiReviewRaw[] = Array.isArray(parsed?.reviews) ? parsed.reviews : (Array.isArray(parsed) ? parsed : []);
        const out: StoreNpcReview[] = [];
        list.forEach((r, i) => {
            const text = (r?.text || '').toString().trim();
            if (!text) return;
            let rt = Math.round(Number(r?.rating));
            if (!Number.isFinite(rt)) rt = 5;
            rt = Math.max(1, Math.min(5, rt));
            const daysAgo = 1 + (hashStr(store.name + i) % 60);
            const d = new Date(Date.now() - daysAgo * 86400000);
            const rev: StoreNpcReview = {
                id: `air_${hashStr(store.name)}_${i}`,
                name: (r?.name || '匿名食客').toString().trim().slice(0, 16),
                emoji: (r?.emoji || '🐱').toString().trim().slice(0, 4) || '🐱',
                rating: rt,
                text: text.slice(0, 80),
                date: `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')}`,
                likes: hashStr('l' + store.name + i) % 60,
            };
            const reply = (r?.reply || '').toString().trim();
            if (reply) rev.reply = reply.slice(0, 60);
            out.push(rev);
        });
        if (out.length < 3) return generateStoreReviews(store.name, store.rating, count);
        return out.sort((a, b) => b.likes - a.likes);
    } catch {
        return generateStoreReviews(store.name, store.rating, count);
    }
}

const QUICK_TAGS_POS = ['分量足', '送得快', '味道赞', '包装好', '性价比高', '会回购'];
const QUICK_TAGS_NEG = ['送得慢', '偏咸', '分量少', '包装一般', '与图不符'];
/** 评价时可选的快捷标签（按打分给正/负面）。 */
export function reviewQuickTags(rating: number): string[] { return rating >= 4 ? QUICK_TAGS_POS : rating === 3 ? [...QUICK_TAGS_POS.slice(0, 3), ...QUICK_TAGS_NEG.slice(0, 2)] : QUICK_TAGS_NEG; }

/** 用户发表评价后，生成商家 + 其它食客的「评论」（其它 npc 评论）。 */
export function generateReviewReplies(rating: number, text: string, storeName: string): import('../types').TakeoutReviewReply[] {
    const rnd = mulberry32(hashStr(storeName + text + rating));
    const pickR = <T,>(arr: T[]) => arr[Math.floor(rnd() * arr.length)];
    const replies: import('../types').TakeoutReviewReply[] = [];
    // 商家几乎必回
    replies.push({ name: storeName, emoji: '🏪', text: rating >= 4 ? pickR(REPLY_MERCHANT_POS) : pickR(REPLY_MERCHANT_NEG), at: Date.now(), isMerchant: true });
    // 1~2 条其它食客
    const extra = 1 + Math.floor(rnd() * 2);
    for (let i = 0; i < extra; i++) {
        replies.push({ name: pickR(REVIEWER_NAMES), emoji: pickR(REVIEWER_EMOJIS), text: rating >= 4 ? pickR(REPLY_DINER_POS) : pickR(REPLY_DINER_NEG), at: Date.now() + i + 1 });
    }
    return replies;
}

/** 遇到黑心商家 / 坏骑手时，给关联角色吐槽一句（让角色安慰/接梗）。 */
export async function postTakeoutIssueToChat(order: TakeoutOrder): Promise<void> {
    if (!order.charId) return;
    const titles = incidentsSummary(order);
    const text = order.cancelledByStore
        ? `［外卖😤］「${order.storeName}」收了钱迟迟不接单，最后被强制砍单了，钱倒是退回来了……这种黑店真的服。`
        : `［外卖😤］「${order.storeName}」这单翻车了：${titles}。气死我了，正在找平台投诉。`;
    await DB.saveMessage({ charId: order.charId, role: 'user', type: 'text', content: text, metadata: { takeoutOrderId: order.id } } as any);
}
