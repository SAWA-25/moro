/**
 * 外卖 App 数据与逻辑层。
 * ================================
 * - 本地生成店铺（每次刷新一批，可进店点菜），不入库；
 * - 订单入库（utils/db: takeout_orders），含配送进度与「和骑手/商家的对话」；
 * - 与来往 App 联动：给某角色点单 / 让角色代付，会在该角色聊天里留一条消息（进上下文，角色会回应）。
 */

import { TakeoutStore, TakeoutDish, TakeoutOrder, TakeoutStatus } from '../types';
import type { ResolvedApi } from './auxApi';
import { DB } from './db';
import { safeResponseJson, extractContent } from './safeApi';

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const round1 = (n: number) => Math.round(n * 10) / 10;
const genId = (p: string) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

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

/** 生成一批店铺（每次刷新都不一样，至少 count 家）。 */
export function generateStores(count = 12): TakeoutStore[] {
    const seeds = [...SEEDS].sort(() => Math.random() - 0.5);
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
        // 同一种子重复出现时，名字加个分店后缀，避免重复
        const dup = i >= seeds.length ? `（${pick(['西区店', '二号店', '旗舰店', '夜市店', '社区店'])}）` : '';
        stores.push({
            id: genId('store'),
            name: seed.name + dup,
            emoji: seed.emoji,
            category: seed.category,
            rating: round1(rand(4.2, 4.9)),
            monthlySales: Math.floor(rand(120, 4800)),
            deliveryMinutes: Math.floor(rand(20, 55)),
            deliveryFee: pick([0, 2, 3, 4, 5]),
            minOrder: pick([0, 15, 20, 20, 25]),
            distanceKm: round1(rand(0.4, 4.5)),
            promo: pick(PROMOS) || undefined,
            dishes,
        });
    }
    return stores;
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
    if (s === 'cancelled') return '已取消';
    const mins = Math.max(1, Math.ceil((order.etaAt - now) / 60000));
    return `预计 ${mins} 分钟后送达`;
}

export const newRider = () => ({ name: pick(RIDER_NAMES), emoji: pick(RIDER_EMOJIS) });

// ── 和骑手 / 商家聊天 ─────────────────────────────────────────────
const CANNED_RIDER = ['您好，正在赶往商家取餐～', '马上到您附近啦，请保持电话畅通🛵', '路上有点堵，会尽快送到的！', '到楼下了，请下来取一下哈～'];
const CANNED_STORE = ['亲，正在为您准备，请稍等～', '已经在出餐啦，马上交给骑手！', '收到，会备注好您的口味的👌', '感谢下单，吃好喝好呀～'];

export async function buildDeliveryReply(
    api: ResolvedApi, order: TakeoutOrder, target: 'rider' | 'store', history: { role: string; text: string }[], userText: string,
): Promise<string> {
    const baseUrl = (api.baseUrl || '').replace(/\/+$/, '');
    if (!baseUrl || !api.model) return target === 'rider' ? pick(CANNED_RIDER) : pick(CANNED_STORE);
    const persona = target === 'rider'
        ? `你是外卖骑手「${order.riderName}」，正在配送一单「${order.storeName}」的外卖。语气朴实、热心、接地气，会提到取餐/路况/到楼下之类。`
        : `你是「${order.storeName}」的商家客服，热情、麻利。会提到备餐/出餐/口味备注之类。`;
    const items = order.items.map(i => `${i.name}×${i.qty}`).join('、');
    const hist = history.slice(-6).map(h => `${h.role === 'user' ? '顾客' : (target === 'rider' ? '骑手' : '商家')}：${h.text}`).join('\n');
    const prompt = `${persona}\n本单：${items}，预计 ${Math.max(1, Math.ceil((order.etaAt - Date.now()) / 60000))} 分钟送达。\n${hist ? `对话：\n${hist}\n` : ''}顾客刚说：${userText}\n用一句话自然回复（不超过30字，不要前缀）：`;
    try {
        const res = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${api.apiKey || 'sk-none'}` },
            body: JSON.stringify({ model: api.model, messages: [{ role: 'user', content: prompt }], temperature: 0.9, max_tokens: 120, stream: false }),
        });
        if (!res.ok) throw new Error();
        const data = await safeResponseJson(res);
        return (extractContent(data) || '').trim() || (target === 'rider' ? pick(CANNED_RIDER) : pick(CANNED_STORE));
    } catch {
        return target === 'rider' ? pick(CANNED_RIDER) : pick(CANNED_STORE);
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
        // 给角色点的（user 请客 / 帮点）
        const treat = order.payer === 'me' ? '我请你吃，' : '';
        text = `［外卖🛵］我在「${order.storeName}」给你点了 ${items}，${treat}骑手说大概 ${mins} 分钟送到你那边，记得收哦～`;
    } else if (order.recipient === 'me' && order.payer === order.charId) {
        // 角色代付 / 角色请我吃
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
