/**
 * 外卖 App 数据与逻辑层。
 * ================================
 * - 店铺生成：本地种子库兜底 + 可选「AI 现搓」（generateStoresAI），含菜品；
 * - 店家有好有坏：每家带隐藏「良心值」integrity，黑心店下单后更容易出事（缺斤少两 / 图文不符 /
 *   卫生 / 强制砍单），现实里能看见的红旗放在 store.warning；
 * - 骑手有好有坏：每单掷一个隐藏 riderReliability，坏骑手更容易超时 / 撒漏 / 偷吃 / 不送上门；
 * - 订单入库（utils/db: takeout_orders），含配送进度、事故（incidents）、投诉售后（complaint）、
 *   和骑手/商家/平台客服的对话；扣款 / 退款由 App 侧用钱包余额（adjustUserBalance）落实；
 * - 与来往 App 联动：给某角色点单 / 让角色代付，会在该角色聊天里留一条消息。
 */

import {
    TakeoutStore, TakeoutDish, TakeoutOrder, TakeoutStatus, TakeoutOrderItem,
    TakeoutIncident, TakeoutIncidentKind, TakeoutChatMsg,
} from '../types';
import type { ResolvedApi } from './auxApi';
import { DB } from './db';
import { safeResponseJson, extractContent, safeFetchJson, extractJson } from './safeApi';

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const shuffle = <T,>(arr: T[]): T[] => [...arr].sort(() => Math.random() - 0.5);
const genId = (p: string) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

export const CATS = ['中餐', '快餐', '奶茶饮品', '甜品烘焙', '日韩料理', '火锅烧烤', '夜宵', '轻食沙拉'];

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
];

const RIDER_NAMES = ['小袋', '阿强', '风一样的张师傅', '老李', '小跑', '闪电侠', '阿杰', '骑行的小王', '飞毛腿', '可靠的赵哥'];
const RIDER_EMOJIS = ['🛵', '🚴', '🏍️', '🛴'];
const PROMOS = ['满30减5', '新客立减8元', '满50减12', '0元起送', '满20减3', '下午茶专享9折', ''];
// 黑心店现实里能看到的「红旗」：差评型亮明，刷单型用夸张促销引流
const BAD_WARNINGS = ['近期卫生差评偏多·谨慎下单', '多人反馈缺斤少两', '到手实物与图片差距大', '商家差评回复阴阳怪气', '配送频繁超时'];
const SCAM_PROMOS = ['满20减18', '新客0.1元秒杀', '全场1折起', '下单再返现'];

/** 由隐藏良心值反推「现实里看得见」的评分 / 月售 / 红旗 / 促销，使红旗与黑心程度自洽。 */
function deriveSignals(integrity: number): Pick<TakeoutStore, 'rating' | 'monthlySales' | 'warning' | 'promo'> {
    if (integrity >= 0.8) {
        return { rating: round1(rand(4.5, 4.9)), monthlySales: Math.floor(rand(300, 4800)), promo: pick(PROMOS) || undefined };
    }
    if (integrity >= 0.55) {
        return { rating: round1(rand(4.0, 4.6)), monthlySales: Math.floor(rand(120, 1500)), promo: pick(PROMOS) || undefined };
    }
    // 黑心店两种现实画像随机其一
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
            dishes,
        });
    }
    return stores;
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
export async function generateStoresAI(api: ResolvedApi, count = 12): Promise<TakeoutStore[]> {
    const baseUrl = (api.baseUrl || '').replace(/\/+$/, '');
    if (!baseUrl || !api.model) return generateStores(count);
    const prompt = `你是一个外卖平台的店铺数据生成器。请生成 ${count} 家风格各异、像真实存在的外卖店，覆盖这些品类：${CATS.join('、')}。
要求（务必贴近现实）：
- 大多数是正常/良心店；但要包含 2~3 家「黑心商家」：缺斤少两、图文严重不符、卫生堪忧、专用超低价促销坑新客、甚至收钱不接单。黑心店把 integrity 设低（0.15~0.45），正常店 0.8~1.0，一般店 0.55~0.8。
- 黑心店里有的会露出红旗（warning，如「近期卫生差评偏多」「多人反馈缺斤少两」），有的伪装得好（高分刷单、夸张促销）就把 warning 留空。
- 每家 5~9 个菜品，名字与价格符合该品类与现实（¥3~¥88），给每个菜配一个 emoji；把 1~2 个招牌设 popular:true。
- blurb 是一句店铺公告/招牌话术（≤20字）。emoji 是店铺 logo（一个食物 emoji）。category 必须取自给定品类。
只输出 JSON，不要解释，格式：
{"stores":[{"name":"","emoji":"🍔","category":"快餐","blurb":"","integrity":0.9,"warning":"","dishes":[{"name":"","price":24,"emoji":"🍔","desc":"","popular":true}]}]}`;
    try {
        const data = await safeFetchJson(
            `${baseUrl}/chat/completions`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${api.apiKey || 'sk-none'}` },
                body: JSON.stringify({ model: api.model, messages: [{ role: 'user', content: prompt }], temperature: 1.0, max_tokens: 3200, stream: false }),
            },
            2, 0, { appName: '外卖', purpose: 'AI 生成店铺' },
        );
        const raw = data?.choices?.[0]?.message?.content || '';
        const parsed = extractJson(raw);
        const list: AiStoreRaw[] = Array.isArray(parsed?.stores) ? parsed.stores : (Array.isArray(parsed) ? parsed : []);
        const stores = list.map(mapAiStore).filter((s): s is TakeoutStore => !!s);
        if (stores.length < 4) return generateStores(count);   // 解析太少，兜底
        return stores;
    } catch {
        return generateStores(count);
    }
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
        dishes,
    };
}

// ── 配送进度 ──────────────────────────────────────────────────────
export const PACK_FEE = 2;

/** 按时间实时推算订单状态（已取消/已送达保持不变）。 */
export function liveTakeoutStatus(order: TakeoutOrder, now = Date.now()): TakeoutStatus {
    if (order.status === 'cancelled') return 'cancelled';
    if (order.deliveredAt) return 'delivered';
    if (now >= order.etaAt) return 'delivered';
    const span = order.etaAt - order.placedAt;
    if (span > 0 && now >= order.placedAt + span * 0.35) return 'delivering';
    return 'preparing';
}

export const STATUS_LABEL: Record<TakeoutStatus, string> = {
    preparing: '商家备餐中',
    delivering: '骑手配送中',
    delivered: '已送达',
    cancelled: '已取消',
};

/** 剩余配送时间文案。 */
export function etaText(order: TakeoutOrder, now = Date.now()): string {
    const s = liveTakeoutStatus(order, now);
    if (s === 'delivered') return '已送达';
    if (s === 'cancelled') return order.cancelledByStore ? '商家已砍单' : '已取消';
    const mins = Math.max(1, Math.ceil((order.etaAt - now) / 60000));
    return `预计 ${mins} 分钟后送达`;
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
    // 强制砍单：极黑心店小概率（收了钱迟迟不接单）
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
const CANNED_RIDER_GOOD = ['您好，正在赶往商家取餐～', '马上到您附近啦，请保持电话畅通🛵', '路上有点堵，会尽快送到的！', '到楼下了，请下来取一下哈～'];
const CANNED_RIDER_BAD = ['我同时送好几单，等着。', '放门口了，自己下来拿。', '超时找平台去，别催我。', '这么远的路费才几块钱，将就下。'];
const CANNED_STORE_GOOD = ['亲，正在为您准备，请稍等～', '已经在出餐啦，马上交给骑手！', '收到，会备注好您的口味的👌', '感谢下单，吃好喝好呀～'];
const CANNED_STORE_BAD = ['我们分量都是标准的，不存在缺斤少两。', '餐品没问题，要退款找平台。', '概不退换，已经做好了。', '图片仅供参考，以实物为准。'];
const CANNED_SUPPORT = ['您好，已收到反馈，正在为您核实订单～', '稍等，我们会联系商家核实并跟进赔付。', '给您带来不便很抱歉，已为您记录。'];

function riderIsBad(order: TakeoutOrder): boolean {
    return (order.riderReliability ?? 1) < 0.6 || (order.incidents || []).some(i => i.by === 'rider');
}
function storeIsBad(order: TakeoutOrder): boolean {
    return !!order.cancelledByStore || (order.incidents || []).some(i => i.by === 'store');
}

export async function buildDeliveryReply(
    api: ResolvedApi, order: TakeoutOrder, target: 'rider' | 'store' | 'support', history: { role: string; text: string }[], userText: string,
): Promise<string> {
    const fallback = () => target === 'support' ? pick(CANNED_SUPPORT)
        : target === 'rider' ? (riderIsBad(order) ? pick(CANNED_RIDER_BAD) : pick(CANNED_RIDER_GOOD))
            : (storeIsBad(order) ? pick(CANNED_STORE_BAD) : pick(CANNED_STORE_GOOD));
    const baseUrl = (api.baseUrl || '').replace(/\/+$/, '');
    if (!baseUrl || !api.model) return fallback();

    const issues = (order.incidents || []).map(i => i.title).join('、');
    let persona: string;
    if (target === 'support') {
        persona = `你是外卖平台的「平台客服」，公事公办但向着消费者。会核实订单、安抚、必要时承诺联系商家与赔付。${issues ? `本单已知问题：${issues}。` : ''}`;
    } else if (target === 'rider') {
        persona = riderIsBad(order)
            ? `你是个不太靠谱的外卖骑手，态度敷衍、不耐烦，爱甩锅给路况/平台/商家，常说「我同时送好几单」「放门口自己拿」。别太离谱，但能感到不上心。`
            : `你是外卖骑手「${order.riderName}」，语气朴实、热心、接地气，会提到取餐/路况/到楼下之类。`;
    } else {
        persona = storeIsBad(order)
            ? `你是「${order.storeName}」的黑心商家客服，嘴硬、抵赖、踢皮球，否认缺斤少两/图文不符，爱说「分量标准」「概不退换」「以实物为准」「找平台去」。别爆粗，但明显不想负责。`
            : `你是「${order.storeName}」的商家客服，热情、麻利，会提到备餐/出餐/口味备注之类。`;
    }
    const items = order.items.map(i => `${i.name}×${i.qty}`).join('、');
    const roleZh = target === 'rider' ? '骑手' : target === 'store' ? '商家' : '客服';
    const hist = history.slice(-6).map(h => `${h.role === 'user' ? '顾客' : roleZh}：${h.text}`).join('\n');
    const prompt = `${persona}\n本单：${items}。\n${hist ? `对话：\n${hist}\n` : ''}顾客刚说：${userText}\n用一句话自然回复（不超过30字，不要前缀）：`;
    try {
        const res = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${api.apiKey || 'sk-none'}` },
            body: JSON.stringify({ model: api.model, messages: [{ role: 'user', content: prompt }], temperature: 0.9, max_tokens: 120, stream: false }),
        });
        if (!res.ok) throw new Error();
        const data = await safeResponseJson(res);
        return (extractContent(data) || '').trim() || fallback();
    } catch {
        return fallback();
    }
}

// ── 与来往 App 联动 ───────────────────────────────────────────────
const itemsText = (order: TakeoutOrder) => order.items.map(i => `${i.emoji || ''}${i.name}×${i.qty}`).join('、');

/** 下单时给关联角色的聊天里留一条消息（让角色看到并回应）。 */
export async function postTakeoutPlacedToChat(order: TakeoutOrder, nameOf: (id: string) => string): Promise<void> {
    if (!order.charId) return;
    const items = itemsText(order);
    const mins = Math.max(1, Math.ceil((order.etaAt - order.placedAt) / 60000));
    let text: string;
    if (order.recipient !== 'me' && order.recipient === order.charId) {
        const treat = order.payer === 'me' ? '我请你吃，' : '';
        text = `［外卖🛵］我在「${order.storeName}」给你点了 ${items}，${treat}骑手说大概 ${mins} 分钟送到你那边，记得收哦～`;
    } else if (order.recipient === 'me' && order.payer === order.charId) {
        text = `［外卖🛵］我刚在「${order.storeName}」点了 ${items}，一共 ¥${order.total}，让你帮我付啦——谢谢你呀，下次我请回来！`;
    } else {
        text = `［外卖🛵］我在「${order.storeName}」下了一单 ${items}，跟你说一声～`;
    }
    await DB.saveMessage({ charId: order.charId, role: 'user', type: 'text', content: text, metadata: { takeoutOrderId: order.id } } as any);
}

/** 送达时给关联角色补一条消息（可选，用户点「告诉 TA 已送达」时）。 */
export async function postTakeoutDeliveredToChat(order: TakeoutOrder): Promise<void> {
    if (!order.charId) return;
    const who = order.recipient !== 'me' ? '你的' : '我的';
    const text = `［外卖✅］「${order.storeName}」的外卖送到${order.recipient !== 'me' ? '你那儿' : '啦'}，趁热吃呀～（${who}那份 ${itemsText(order)}）`;
    await DB.saveMessage({ charId: order.charId, role: 'user', type: 'text', content: text, metadata: { takeoutOrderId: order.id } } as any);
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
