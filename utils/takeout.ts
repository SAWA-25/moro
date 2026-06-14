/**
 * 外卖 App 数据与逻辑层。
 * ================================
 * - 本地生成店铺（每次刷新一批，可进店点菜），不入库；
 * - 订单入库（utils/db: takeout_orders），含配送进度与「和骑手/商家的对话」；
 * - 与来往 App 联动：给某角色点单 / 让角色代付，会在该角色聊天里留一条消息（进上下文，角色会回应）。
 */

import { TakeoutStore, TakeoutDish, TakeoutOrder, TakeoutOrderItem, TakeoutStatus } from '../types';
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

/**
 * 按时间实时推算订单状态（与现实时间同步）。
 * 关键：到达预计时间（now >= etaAt）只进入 `arrived`（已到达·待收货），
 * 不再自动跳 `delivered` —— 「收到货才能点击送达」：必须等真正到点后，
 * 用户手动确认收货（或给角色点的单到点后角色自动签收）才置 deliveredAt → delivered。
 */
export function liveTakeoutStatus(order: TakeoutOrder, now = Date.now()): TakeoutStatus {
    if (order.status === 'cancelled') return 'cancelled';
    if (order.deliveredAt) return 'delivered';
    if (now >= order.etaAt) return 'arrived';
    const span = order.etaAt - order.placedAt;
    if (span > 0 && now >= order.placedAt + span * 0.35) return 'delivering';
    return 'preparing';
}

/** 是否已到点（到了就可以确认收货了）。 */
export function isTakeoutArrived(order: TakeoutOrder, now = Date.now()): boolean {
    return !order.deliveredAt && order.status !== 'cancelled' && now >= order.etaAt;
}

export const STATUS_LABEL: Record<TakeoutStatus, string> = {
    preparing: '商家备餐中',
    delivering: '骑手配送中',
    arrived: '已到达·待收货',
    delivered: '已送达',
    cancelled: '已取消',
};

/** 剩余配送时间文案。 */
export function etaText(order: TakeoutOrder, now = Date.now()): string {
    const s = liveTakeoutStatus(order, now);
    if (s === 'delivered') return '已送达';
    if (s === 'cancelled') return '已取消';
    if (s === 'arrived') return '外卖已到，请确认收货';
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
    return {
        takeoutOrderId: order.id,
        storeName: order.storeName,
        storeEmoji: order.storeEmoji,
        items: order.items.map(i => ({ name: i.name, qty: i.qty, emoji: i.emoji })),
        total: order.total,
        placedAt: order.placedAt,
        etaAt: order.etaAt,
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
    const items = itemsText(order);
    return `[系统提示（非${userName}发言）：${userName}之前在「${order.storeName}」给你点的外卖（${items}）刚刚送到你这边，你签收了。请像真人收到对方专门送来的外卖那样，在聊天里自然地对${userName}做出反应——可以道谢、惊喜、边吃边说味道、或调侃${userName}怎么知道你想吃这个。一两句话就好，别像在汇报。]`;
}

// ── 角色主动为用户点外卖（由聊天指令触发，需会话设置开关打开） ──────
const KEYWORDIZE = (s: string) => s.replace(/[，。、,.!！?？\s]+/g, ' ').trim();

/**
 * 依据一句菜品/店铺描述，合成一张「角色为用户点」的外卖订单（recipient=me, payer=char）。
 * 尽量从描述里匹配店铺与菜名，匹配不到则随机选店 + 招牌菜兜底。
 */
export function synthesizeCharOrder(charId: string, desc: string, address: string): TakeoutOrder {
    const stores = generateStores(16);
    const kw = KEYWORDIZE(desc).split(' ').filter(Boolean);
    const matchScore = (s: TakeoutStore) => {
        let score = 0;
        for (const k of kw) {
            if (s.name.includes(k) || s.category.includes(k)) score += 2;
            score += s.dishes.filter(d => d.name.includes(k) || k.includes(d.name)).length;
        }
        return score;
    };
    let store = stores[0];
    let best = -1;
    for (const s of stores) { const sc = matchScore(s); if (sc > best) { best = sc; store = s; } }

    // 选菜：优先描述里点到的菜，否则用招牌（popular）兜底，最多 3 样
    let chosen = store.dishes.filter(d => kw.some(k => d.name.includes(k) || k.includes(d.name)));
    if (chosen.length === 0) chosen = store.dishes.filter(d => d.popular);
    if (chosen.length === 0) chosen = store.dishes.slice(0, 2);
    chosen = chosen.slice(0, 3);
    const items: TakeoutOrderItem[] = chosen.map(d => ({ dishId: d.id, name: d.name, price: d.price, qty: 1, emoji: d.emoji }));
    const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
    const placedAt = Date.now();
    const rider = newRider();
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
        placedAt, etaAt: placedAt + store.deliveryMinutes * 60000,
        chat: [], chatTarget: 'rider',
        initiatedBy: 'char',
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

// ── 实时联动：订单变化广播（小票 / 灵动岛即时刷新） ─────────────────
/** 订单发生变化（下单 / 送达 / 评价…）时广播，供聊天小票与灵动岛即时刷新。 */
export const TAKEOUT_UPDATED_EVENT = 'moro-takeout-updated';
export function notifyTakeoutUpdated(): void {
    try { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(TAKEOUT_UPDATED_EVENT)); } catch { /* ignore */ }
}

/** 进行中的订单（备餐 / 配送 / 待收货），按最快送达排序——灵动岛 Live Activity 用。 */
export function pickActiveOrders(orders: TakeoutOrder[], now = Date.now()): TakeoutOrder[] {
    return orders
        .filter(o => o.status !== 'cancelled' && !o.deliveredAt)
        .sort((a, b) => a.etaAt - b.etaAt);
}

// ── 外卖评价 + 其它 NPC 评论 ───────────────────────────────────────
export interface StoreNpcReview { id: string; name: string; emoji: string; rating: number; text: string; date: string; likes: number; reply?: string; }

const REVIEWER_NAMES = ['吃货小分队', '匿名食客', '楼下的老王', '减脂中的喵', '深夜放毒', '加班狗本狗', '带饭星人', '嘴刁的猫', '干饭人', '隔壁老张', '美食侦探', '一只柯基', '打工不易', '学生党一枚', '宝妈日常', '路过的猫', '挑食小公主', '夜跑选手'];
const REVIEWER_EMOJIS = ['🦊', '🐱', '🐻', '🐼', '🐯', '🐰', '🐧', '🐸', '🐵', '🦝', '🐶', '🦦', '🐹', '🦉'];
const REVIEW_POS = ['分量很足，味道在线，会回购！', '送得比预计还快，包装也干净👍', '点了好多次了，稳定发挥～', '性价比真的高，学生党友好', '热乎乎的，骑手小哥人很好', '招牌名不虚传，绝了', '第一次点就爱上了，下次还来', '汤底很鲜，一滴不剩', '老板很实在，给的料超多'];
const REVIEW_MID = ['味道还行，就是配送有点慢', '分量一般般，凑合吃', '中规中矩，不难吃也不惊艳', '包装有点简陋，味道还可以', '正常发挥吧，没踩雷'];
const REVIEW_NEG = ['等了好久才送到，凉了…', '和图片差距有点大', '有点咸了，下次得备注少盐', '分量缩水，性价比一般'];
const REPLY_DINER_POS = ['同感！我也常点这家', '马住，下次试试', '哈哈哈被你种草了', '+1，他家招牌真的可以', '看饿了…'];
const REPLY_DINER_NEG = ['我也遇到过送得慢…', '可能高峰期人手不够吧', '备注少盐会好很多'];
const REPLY_MERCHANT_POS = ['感谢支持，欢迎下次再来呀～', '谢谢喜欢！我们会继续努力🧡', '老顾客了，给您加了份小料～'];
const REPLY_MERCHANT_NEG = ['抱歉让您久等了，已反馈给配送，下次一定更快🙏', '非常抱歉口味没达预期，欢迎备注，我们改进！'];

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
