/**
 * 购物商城 —— 纯数据 + 纯函数模块。
 *
 * 一个「虚拟礼物商城」：内置一批带图标和价格的礼物。
 *  - 用户用钱包余额买下 → 进背包（shopInventory）→ 在商城里挑一个角色送出去
 *    （聊天里落一张「礼物卡」，并在双方小票里各记一笔，角色会在聊天里回应/写感谢信）。
 *  - 角色也会「自己逛商城」：用副 API 决定给自己买点什么、或回赠用户一件礼物（落角色小票，
 *    回赠时给用户背包加一件 + 在聊天里落礼物卡）。
 *  - 查角色的购物小票即可看到 TA 都买了/收了什么。
 *
 * 不碰 DB / React，方便在 App、聊天上下文、副 API 流程里复用。
 */

import type { ShopItem, ShopReceipt, ShopOwnedItem, ShopCartLine, ShopOrder, ShopOrderItem, ShopCoupon, ShopFootprint, ShopUserReview } from '../types';

/** 商城内容变动（买/送/角色逛完）后广播，相关页面据此刷新。 */
export const SHOP_UPDATED_EVENT = 'moro-shop-updated';
export const emitShopUpdated = (): void => {
    try { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(SHOP_UPDATED_EVENT)); } catch { /* ignore */ }
};

export interface ShopCategory { key: string; label: string; emoji: string; }

export const SHOP_CATEGORIES: ShopCategory[] = [
    { key: 'flower', label: '鲜花', emoji: '💐' },
    { key: 'food', label: '甜食', emoji: '🍰' },
    { key: 'jewel', label: '饰品', emoji: '💍' },
    { key: 'plush', label: '玩偶', emoji: '🧸' },
    { key: 'tech', label: '数码', emoji: '🎧' },
    { key: 'life', label: '生活', emoji: '🕯️' },
    { key: 'romance', label: '浪漫', emoji: '💞' },
];

/** 内置礼物目录（价格单位：元）。 */
export const SHOP_ITEMS: ShopItem[] = [
    // 鲜花
    { id: 'rose', name: '一支红玫瑰', emoji: '🌹', price: 9.9, category: 'flower', blurb: '最直白的心意，一支就够。' },
    { id: 'bouquet', name: '满天星花束', emoji: '💐', price: 59, category: 'flower', blurb: '抱在怀里像抱了一小片星空。' },
    { id: 'tulip', name: '郁金香盆栽', emoji: '🌷', price: 39, category: 'flower', blurb: '会慢慢开，养在窗台正好。' },
    { id: 'sunflower', name: '向日葵', emoji: '🌻', price: 25, category: 'flower', blurb: '朝着你的方向开。' },
    // 甜食
    { id: 'cake', name: '草莓蛋糕', emoji: '🍰', price: 45, category: 'food', blurb: '切一块，分着吃才甜。' },
    { id: 'choco', name: '手工巧克力', emoji: '🍫', price: 35, category: 'food', blurb: '一颗一颗慢慢含。' },
    { id: 'bubbletea', name: '一杯奶茶', emoji: '🧋', price: 16, category: 'food', blurb: '三分糖，去冰，懂你。' },
    { id: 'macaron', name: '马卡龙礼盒', emoji: '🌈', price: 68, category: 'food', blurb: '六种颜色，六种心情。' },
    // 饰品
    { id: 'ring', name: '细银戒指', emoji: '💍', price: 188, category: 'jewel', blurb: '不张扬，戴着刚好。' },
    { id: 'necklace', name: '锁骨项链', emoji: '📿', price: 159, category: 'jewel', blurb: '一点点光，落在锁骨上。' },
    { id: 'bracelet', name: '编绳手链', emoji: '🪢', price: 49, category: 'jewel', blurb: '亲手系上才算数。' },
    { id: 'hairpin', name: '珍珠发夹', emoji: '🩰', price: 29, category: 'jewel', blurb: '把碎发别到耳后那一下。' },
    // 玩偶
    { id: 'bear', name: '抱抱熊', emoji: '🧸', price: 79, category: 'plush', blurb: '替我抱你一下。' },
    { id: 'bunny', name: '长耳兔玩偶', emoji: '🐰', price: 65, category: 'plush', blurb: '夜里搂着睡，不怕黑。' },
    { id: 'cat', name: '橘猫抱枕', emoji: '🐱', price: 55, category: 'plush', blurb: '软乎乎，会陪你看剧。' },
    // 数码
    { id: 'headphone', name: '降噪耳机', emoji: '🎧', price: 299, category: 'tech', blurb: '戴上，世界只剩想听的声音。' },
    { id: 'camera', name: '拍立得', emoji: '📷', price: 458, category: 'tech', blurb: '把今天立刻洗成一张。' },
    { id: 'lamp', name: '氛围小夜灯', emoji: '💡', price: 89, category: 'tech', blurb: '调到最暖那一档。' },
    // 生活
    { id: 'candle', name: '香薰蜡烛', emoji: '🕯️', price: 69, category: 'life', blurb: '点上，房间就慢下来了。' },
    { id: 'mug', name: '对杯马克杯', emoji: '☕', price: 49, category: 'life', blurb: '一只给你，一只给我。' },
    { id: 'scarf', name: '羊绒围巾', emoji: '🧣', price: 129, category: 'life', blurb: '把脖子裹严实再出门。' },
    { id: 'umbrella', name: '长柄雨伞', emoji: '☂️', price: 59, category: 'life', blurb: '下雨记得撑，别淋着。' },
    // 浪漫
    { id: 'letter', name: '手写情书', emoji: '💌', price: 20, category: 'romance', blurb: '一笔一划写给你的话。' },
    { id: 'starmap', name: '定制星空图', emoji: '🌌', price: 158, category: 'romance', blurb: '我们相遇那晚的星空。' },
    { id: 'musicbox', name: '八音盒', emoji: '🎶', price: 99, category: 'romance', blurb: '拧紧发条，是我们的调子。' },
    { id: 'fireworks', name: '一场烟花', emoji: '🎆', price: 520, category: 'romance', blurb: '为你专门放一次。' },
];

// ── 动态商品注册表（AI 实时生成的商品）──────────────────────────────────────
// 商品改成 AI 实时生成后，购物车/收藏/小票里存的是 itemId；为了让这些 id 在「换一批」或
// 重新打开后仍能解析出商品，把见过的所有生成商品登记在这里，并持久化到 localStorage。
const DYNAMIC_ITEMS_KEY = 'moro_shop_dynamic_items_v1';
let _dynamicItems: Map<string, ShopItem> | null = null;

const loadDynamicItems = (): Map<string, ShopItem> => {
    if (_dynamicItems) return _dynamicItems;
    _dynamicItems = new Map();
    try {
        const raw = localStorage.getItem(DYNAMIC_ITEMS_KEY);
        if (raw) {
            const arr = JSON.parse(raw);
            if (Array.isArray(arr)) for (const it of arr) { if (it && it.id) _dynamicItems.set(it.id, it); }
        }
    } catch { /* ignore */ }
    return _dynamicItems;
};

const persistDynamicItems = (): void => {
    if (!_dynamicItems) return;
    try {
        // 控制体量：最多留最近 200 件
        const arr = Array.from(_dynamicItems.values()).slice(-200);
        localStorage.setItem(DYNAMIC_ITEMS_KEY, JSON.stringify(arr));
    } catch { /* ignore */ }
};

/** 登记一批生成商品（供后续 getShopItem 解析 id）。 */
export const registerShopItems = (items: ShopItem[]): void => {
    const reg = loadDynamicItems();
    for (const it of items) if (it && it.id) reg.set(it.id, it);
    persistDynamicItems();
};

/** 先查内置兜底目录，再查动态注册表（AI 生成商品）。 */
export const getShopItem = (id: string): ShopItem | undefined =>
    SHOP_ITEMS.find(i => i.id === id) || loadDynamicItems().get(id);

export const formatPrice = (n: number): string =>
    Number.isInteger(n) ? String(n) : n.toFixed(1);

let _seq = 0;
const uid = (): string => `${Date.now().toString(36)}${(_seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const makeOwnedItem = (item: ShopItem): ShopOwnedItem => ({
    uid: uid(),
    itemId: item.id,
    name: item.name,
    emoji: item.emoji,
    price: item.price,
    boughtAt: Date.now(),
});

export const makeReceipt = (
    item: Pick<ShopItem, 'id' | 'name' | 'emoji' | 'price'>,
    by: ShopReceipt['by'],
    action: ShopReceipt['action'],
    counterpartId: string,
    counterpartName: string,
    note?: string,
): ShopReceipt => ({
    id: uid(),
    itemId: item.id,
    name: item.name,
    emoji: item.emoji,
    price: item.price,
    by,
    action,
    counterpartId,
    counterpartName,
    note: note?.trim() || undefined,
    at: Date.now(),
});

/** 聊天里「礼物卡」的快照数据（存 message.metadata.gift）。 */
export interface GiftCardMeta {
    itemId: string;
    name: string;
    emoji: string;
    price: number;
    note?: string;
    fromName: string;     // 送礼方展示名
}

export const buildGiftCardMeta = (
    item: Pick<ShopItem, 'id' | 'name' | 'emoji' | 'price'>,
    fromName: string,
    note?: string,
): GiftCardMeta => ({
    itemId: item.id,
    name: item.name,
    emoji: item.emoji,
    price: item.price,
    note: note?.trim() || undefined,
    fromName,
});

const ACTION_LABEL: Record<ShopReceipt['action'], string> = {
    buy: '给自己买了',
    gift: '送出',
    receive: '收到',
};

/** 把一条小票转成可读行（注入聊天上下文 / 列表展示）。 */
export const receiptLine = (r: ShopReceipt): string => {
    const who = r.by === 'user' ? '你' : 'TA';
    const verb = ACTION_LABEL[r.action];
    const target = r.action === 'buy' ? '' : `（${r.action === 'gift' ? '给' : '来自'} ${r.counterpartName}）`;
    return `${who} ${verb} ${r.emoji}${r.name}${target}${r.note ? `：「${r.note}」` : ''}`;
};

// ── 购物车（淘宝式）：纯函数，user 与 char 共用 ───────────────────────────────

/** 加入购物车（已存在则数量 +qty）。返回新数组，不改原数组。 */
export const addToCart = (cart: ShopCartLine[] | undefined, itemId: string, qty = 1): ShopCartLine[] => {
    const list = (cart || []).map(l => ({ ...l }));
    const hit = list.find(l => l.itemId === itemId);
    if (hit) hit.qty = Math.min(99, hit.qty + qty);
    else list.push({ itemId, qty: Math.max(1, qty) });
    return list;
};

/** 设置某商品数量（<=0 则移除）。 */
export const setCartQty = (cart: ShopCartLine[] | undefined, itemId: string, qty: number): ShopCartLine[] => {
    const list = (cart || []).map(l => ({ ...l }));
    if (qty <= 0) return list.filter(l => l.itemId !== itemId);
    const hit = list.find(l => l.itemId === itemId);
    if (hit) hit.qty = Math.min(99, qty);
    else list.push({ itemId, qty: Math.min(99, qty) });
    return list;
};

/** 从购物车移除某商品。 */
export const removeFromCart = (cart: ShopCartLine[] | undefined, itemId: string): ShopCartLine[] =>
    (cart || []).filter(l => l.itemId !== itemId);

/** 购物车商品总件数。 */
export const cartCount = (cart: ShopCartLine[] | undefined): number =>
    (cart || []).reduce((s, l) => s + (l.qty || 0), 0);

/** 购物车总价（元）。未知商品按 0 计。 */
export const cartTotal = (cart: ShopCartLine[] | undefined): number => {
    const cents = (cart || []).reduce((s, l) => {
        const it = getShopItem(l.itemId);
        return s + (it ? Math.round(it.price * 100) * (l.qty || 0) : 0);
    }, 0);
    return Math.round(cents) / 100;
};

/** 把购物车解析成 { item, qty } 列表（跳过下架/未知商品）。 */
export const resolveCart = (cart: ShopCartLine[] | undefined): { item: ShopItem; qty: number }[] =>
    (cart || []).map(l => ({ item: getShopItem(l.itemId), qty: l.qty }))
        .filter((x): x is { item: ShopItem; qty: number } => !!x.item && x.qty > 0);

/** 把购物车展开成逐件商品（送货 / 清空时按件生成背包物 / 小票）。 */
export const expandCart = (cart: ShopCartLine[] | undefined): ShopItem[] => {
    const out: ShopItem[] = [];
    for (const { item, qty } of resolveCart(cart)) {
        for (let i = 0; i < qty; i++) out.push(item);
    }
    return out;
};

// ── 淘宝式商品资料：月销量 / 评分 / 评价（纯函数·确定性，按 itemId 稳定生成） ──────

/** 简单字符串哈希（确定性，用于由 itemId 生成稳定的"假"销量/评价）。 */
const hashStr = (s: string): number => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0);
};

/** 月销量（确定性）：便宜的卖得多，贵的卖得少，叠加按 id 的稳定抖动。范围约 30 ~ 9999。 */
export const monthlySales = (itemId: string): number => {
    const it = getShopItem(itemId);
    if (!it) return 0;
    const base = Math.max(20, Math.round(4000 / Math.sqrt(it.price + 1)));
    const jitter = hashStr(itemId) % 1200;
    return Math.min(9999, base + jitter);
};

/** 把销量格式化成淘宝式「月销 1.2万」「月销 800」。 */
export const formatSales = (n: number): string =>
    n >= 10000 ? `${(n / 10000).toFixed(1)}万` : String(n);

/** 评分 1.0~5.0：优先用商品自带 rating（AI 生成，有好有坏），否则按 id 确定性派生（3.0~5.0）。 */
export const itemRating = (itemId: string): number => {
    const it = getShopItem(itemId);
    if (it && typeof it.rating === 'number' && it.rating >= 1 && it.rating <= 5) return Math.round(it.rating * 10) / 10;
    return Math.round((3.0 + (hashStr('r' + itemId) % 201) / 100) * 10) / 10; // 3.0~5.0
};

export interface ShopReview { user: string; stars: number; text: string; }

const REVIEW_USERS = ['t**o', '甜**圈', '阿**', '小**鱼', 'L**y', 'momo', '一**风', '北**川', '橘**酱', '游**客'];
const REVIEW_TEXTS_GOOD = [
    '比图片还好看，包装也用心，给对象很合适～',
    '质感超出预期，回购了第二件。',
    '物流很快，拆开心情都变好了。',
    '送人很有面子，对方很喜欢！',
    '颜值在线，细节做得好，好评。',
    '性价比挺高的，会推荐给朋友。',
];
const REVIEW_TEXTS_BAD = [
    '和图片差挺多，有点踩雷。',
    '质量一般，价格偏贵了，不太值。',
    '物流太慢，等了一个多礼拜。',
    '做工粗糙，细节拉胯，差评。',
    '收到有点失望，和描述不符。',
    '客服爱答不理，体验很差。',
];

/** 某商品的评价（确定性·仿真有好有坏）：评分越低，差评比例越高，取 2~4 条。 */
export const getItemReviews = (itemId: string): ShopReview[] => {
    const rating = itemRating(itemId);
    const h = hashStr('rev' + itemId);
    const count = 2 + (h % 3); // 2~4 条
    const badProb = Math.max(0, Math.min(0.85, (4.6 - rating) / 2.6)); // rating 越低差评概率越高
    const out: ShopReview[] = [];
    for (let i = 0; i < count; i++) {
        const isBad = (((h + i * 17) % 100) / 100) < badProb;
        const u = REVIEW_USERS[(h + i * 7) % REVIEW_USERS.length];
        if (isBad) {
            out.push({ user: u, stars: 1 + ((h + i * 5) % 3), text: REVIEW_TEXTS_BAD[(h + i * 13) % REVIEW_TEXTS_BAD.length] });
        } else {
            out.push({ user: u, stars: 4 + ((h + i * 5) % 2), text: REVIEW_TEXTS_GOOD[(h + i * 13) % REVIEW_TEXTS_GOOD.length] });
        }
    }
    return out;
};

/** 搜索商品：按名称 / 描述 / 分类名（含 emoji）模糊匹配。 */
export const searchShopItems = (query: string): ShopItem[] => {
    const q = (query || '').trim().toLowerCase();
    if (!q) return SHOP_ITEMS;
    const catLabel = (key: string) => SHOP_CATEGORIES.find(c => c.key === key)?.label || '';
    return SHOP_ITEMS.filter(i =>
        i.name.toLowerCase().includes(q) ||
        i.blurb.toLowerCase().includes(q) ||
        catLabel(i.category).toLowerCase().includes(q) ||
        i.emoji.includes(q));
};

// ── 商品 / 评价 AI 实时生成（副 API 驱动） ─────────────────────────────────────

/** 由名称+分类生成稳定 id（同名商品映射到同一 id，利于去重 + 收藏/购物车稳定）。 */
const stableItemId = (name: string, category: string): string => `gen_${hashStr(`${name}|${category}`).toString(36)}`;

const CAT_KEYS = SHOP_CATEGORIES.map(c => c.key).join(' / ');

/** 组装「实时生成一批商品」的 prompt（默认 ≥20 件，礼物商城主题）。 */
export function buildGenerateItemsPrompt(count = 22, hint?: string): { system: string; user: string } {
    const system = '你是一个礼物电商「心意铺」的选品编辑，按要求产出商品清单。只输出 JSON，不要任何多余文字或代码块标记。';
    const user = `请为「心意铺」礼物商城实时生成 ${count} 件**各不相同**的商品（要有新鲜感、别老是玫瑰蛋糕，可涵盖小众/有趣/应季/数码/手作/体验券等）。${hint ? `本次主题倾向：${hint}。` : ''}
**要仿真、有好有坏**：像真实淘宝那样混着卖——大部分是不错的好物，但也要掺几件「智商税 / 货不对板 / 翻车踩雷 / 廉价感」的商品（用 rating 体现，别都打高分）。
每件包含：
- name：商品名（6~14字，具体、有卖点；踩雷款也可以名字很唬人）
- emoji：一个最贴切的 emoji（用作文字图）
- price：价格（元，5~999 的数字，可带小数；踩雷款常虚高）
- category：从这些分类里选一个 key：${CAT_KEYS}
- blurb：一句话文案（15~30字，好物种草、踩雷款可中性或暗示一般）
- rating：真实评分（1.0~5.0 的数字，好物 4.3~5.0，普通 3.5~4.2，踩雷/智商税 1.5~3.4，请拉开差距）

**务必输出完整且合法的 JSON**：只输出一个紧凑的 JSON 数组（无多余空白、无 markdown 围栏、无解释），把 ${count} 个对象全部写完、最后用 ] 收尾，绝不中途截断。形如：
[{"name":"…","emoji":"🎁","price":59,"category":"life","blurb":"…","rating":4.7}]`;
    return { system, user };
}

/** 解析「实时生成商品」的模型输出为 ShopItem[]（健壮解析；自动补全 id / 校验字段 / 去重）。 */
/**
 * 健壮解析「一批扁平对象」：先整体 JSON.parse，失败则逐个抠出完整的 {...} 再解析。
 * 关键：AI 因 max_tokens 被截断、数组没收尾时，也能把已写完的对象救回来，
 * 不至于整批丢弃后被「内置商品」垫场（表现为「调了 API 却只有离线商品」）。
 */
function salvageObjects(txt: string): any[] {
    const start = txt.indexOf('[');
    if (start === -1) {
        // 没有数组括号：尝试单个对象
        const o = txt.match(/\{[^{}]*\}/);
        if (o) { try { return [JSON.parse(o[0])]; } catch { return []; } }
        return [];
    }
    const end = txt.lastIndexOf(']');
    if (end > start) {
        try { const arr = JSON.parse(txt.slice(start, end + 1)); if (Array.isArray(arr) && arr.length) return arr; } catch { /* fall to salvage */ }
    }
    const objs = txt.slice(start).match(/\{[^{}]*\}/g) || [];
    const out: any[] = [];
    for (const o of objs) { try { out.push(JSON.parse(o)); } catch { /* skip broken tail */ } }
    return out;
}

export function parseGeneratedItems(raw: string): ShopItem[] {
    if (!raw) return [];
    let txt = raw.trim().replace(/```(?:json)?/gi, '').trim();
    const arr = salvageObjects(txt);
    if (arr.length === 0) return [];
    const validCats = new Set(SHOP_CATEGORIES.map(c => c.key));
    const seen = new Set<string>();
    const out: ShopItem[] = [];
    for (const o of arr) {
        if (!o || typeof o.name !== 'string') continue;
        const name = o.name.trim().slice(0, 20);
        if (!name) continue;
        const category = validCats.has(o.category) ? o.category : 'life';
        const id = stableItemId(name, category);
        if (seen.has(id)) continue;
        seen.add(id);
        let price = Number(o.price);
        if (!isFinite(price) || price <= 0) price = 9.9;
        price = Math.min(9999, Math.round(price * 10) / 10);
        const emoji = (typeof o.emoji === 'string' && o.emoji.trim()) ? o.emoji.trim().slice(0, 4) : '🎁';
        const blurb = (typeof o.blurb === 'string' ? o.blurb.trim() : '').slice(0, 40) || '一份用心挑的小礼物。';
        const image = (typeof o.image === 'string' && /^https?:\/\//.test(o.image)) ? o.image : undefined;
        let rating = Number(o.rating);
        rating = isFinite(rating) ? Math.max(1, Math.min(5, Math.round(rating * 10) / 10)) : undefined as any;
        out.push({ id, name, emoji, price, category, blurb, image, generated: true, ...(rating ? { rating } : {}) });
    }
    return out;
}

/** 组装「为某商品实时生成买家评价」的 prompt（仿真：评价分布要贴合评分，有好有坏）。 */
export function buildItemReviewsPrompt(item: Pick<ShopItem, 'name' | 'blurb' | 'price' | 'rating'>, count = 5): { system: string; user: string } {
    const rating = item.rating;
    const tone = rating == null ? '好评为主、夹带一两条中肯小缺点'
        : rating >= 4.3 ? '大多 4~5 星好评，可有 1 条挑刺的中评，真实不浮夸'
        : rating >= 3.5 ? '好坏参半，有 3~4 星也有 5 星，吐槽和认可都要有'
        : '差评/中评为主（1~3 星居多），具体吐槽货不对板/质量差/物流慢/智商税，可留 1 条还行的';
    const system = '你在扮演一批买过某商品的真实买家，写淘宝式短评。买家有夸有骂、口吻各异，真实自然。只输出 JSON 数组，不要多余文字或代码块标记。';
    const user = `商品：「${item.name}」（¥${formatPrice(item.price)}，${item.blurb}）${rating != null ? `，综合评分约 ${rating} 星` : ''}。
请生成 ${count} 条评价，分布要求：${tone}。
- user：脱敏昵称（如 "t**o"、"甜**圈"）
- stars：1~5 的整数（按上面的分布来，别都打 5 星）
- text：评价正文（15~40字，提到使用/物流/送人/质感/做工等具体感受，差评要骂到点子上）

只输出 JSON 数组：[{"user":"…","stars":5,"text":"…"}]，共 ${count} 条。`;
    return { system, user };
}

/** 解析「实时生成评价」的模型输出为 ShopReview[]（健壮解析 + 校验）。 */
export function parseGeneratedReviews(raw: string): ShopReview[] {
    if (!raw) return [];
    let txt = raw.trim().replace(/```(?:json)?/gi, '').trim();
    const arr = salvageObjects(txt);
    if (arr.length === 0) return [];
    const out: ShopReview[] = [];
    for (const o of arr) {
        if (!o || typeof o.text !== 'string' || !o.text.trim()) continue;
        const user = (typeof o.user === 'string' && o.user.trim()) ? o.user.trim().slice(0, 12) : '匿名';
        let stars = Math.round(Number(o.stars));
        if (!isFinite(stars)) stars = 5;
        stars = Math.max(1, Math.min(5, stars));
        out.push({ user, stars, text: o.text.trim().slice(0, 60) });
    }
    return out;
}

// ── 订单 + 物流配送进度（淘宝式；下单 → 物流推进 → 确认收货进背包） ──────────────

/** 由购物车行生成一笔订单（预计 12~30 分钟送达，时间内逐步推进物流）。 */
export function makeOrder(lines: { item: ShopItem; qty: number }[], paidBy: 'self' | 'char', payerName?: string): ShopOrder {
    const items: ShopOrderItem[] = lines.map(({ item, qty }) => ({ itemId: item.id, name: item.name, emoji: item.emoji, price: item.price, qty }));
    const total = Math.round(items.reduce((s, it) => s + it.price * it.qty, 0) * 100) / 100;
    const placedAt = Date.now();
    const span = (12 + Math.floor(Math.random() * 18)) * 60000; // 12~30 分钟
    return { id: uid(), items, total, paidBy, payerName, placedAt, etaAt: placedAt + span };
}

export type OrderStage = 'placed' | 'shipped' | 'transit' | 'delivering' | 'arrived' | 'received';
export interface OrderProgress { stage: OrderStage; label: string; pct: number; canReceive: boolean; etaText: string; }

/** 物流进度（纯函数）：按 (now-placedAt)/(etaAt-placedAt) 分段；到点后等用户确认收货。 */
export function orderProgress(order: ShopOrder, now: number = Date.now()): OrderProgress {
    if (order.receivedAt) return { stage: 'received', label: '已签收', pct: 100, canReceive: false, etaText: '交易完成' };
    const span = Math.max(1, order.etaAt - order.placedAt);
    const f = (now - order.placedAt) / span;
    if (f >= 1) return { stage: 'arrived', label: '待收货', pct: 100, canReceive: true, etaText: '已送达，待确认收货' };
    const pct = Math.max(2, Math.min(99, Math.round(f * 100)));
    const remainMin = Math.max(1, Math.ceil((order.etaAt - now) / 60000));
    const etaText = `预计 ${remainMin} 分钟后送达`;
    if (f < 0.1) return { stage: 'placed', label: '商家备货中', pct, canReceive: false, etaText };
    if (f < 0.4) return { stage: 'shipped', label: '已发货', pct, canReceive: false, etaText };
    if (f < 0.7) return { stage: 'transit', label: '运输中', pct, canReceive: false, etaText };
    return { stage: 'delivering', label: '派送中', pct, canReceive: false, etaText };
}

export const ORDER_STAGES: { key: OrderStage; label: string }[] = [
    { key: 'placed', label: '已下单' },
    { key: 'shipped', label: '已发货' },
    { key: 'transit', label: '运输中' },
    { key: 'delivering', label: '派送中' },
    { key: 'arrived', label: '已送达' },
];

/** 确认收货：把订单商品展开成背包物 + 双方小票（self 记 buy；char 代付记 receive/gift）。 */
export function orderReceivePayload(order: ShopOrder, userName: string): { owned: ShopOwnedItem[]; userReceipts: ShopReceipt[]; charReceipts: ShopReceipt[] } {
    const owned: ShopOwnedItem[] = [];
    const userReceipts: ShopReceipt[] = [];
    const charReceipts: ShopReceipt[] = [];
    for (const it of order.items) {
        const base = { id: it.itemId, name: it.name, emoji: it.emoji, price: it.price };
        for (let i = 0; i < it.qty; i++) {
            owned.push(makeOwnedItem(base as ShopItem));
            if (order.paidBy === 'char') {
                userReceipts.push(makeReceipt(base, 'user', 'receive', 'char', order.payerName || 'TA', '代付'));
                charReceipts.push(makeReceipt(base, 'char', 'gift', 'user', userName, '代付'));
            } else {
                userReceipts.push(makeReceipt(base, 'user', 'buy', 'self', userName));
            }
        }
    }
    return { owned, userReceipts, charReceipts };
}

// ── 优惠券（满减券） ──────────────────────────────────────────────────────
export const SHOP_COUPONS: ShopCoupon[] = [
    { id: 'c5', title: '满49减5', threshold: 49, discount: 5 },
    { id: 'c10', title: '满99减10', threshold: 99, discount: 10 },
    { id: 'c25', title: '满199减25', threshold: 199, discount: 25 },
    { id: 'c60', title: '满399减60', threshold: 399, discount: 60 },
    { id: 'c100', title: '满599减100', threshold: 599, discount: 100 },
];
export const getCoupon = (id: string): ShopCoupon | undefined => SHOP_COUPONS.find(c => c.id === id);

/** 在已领券里挑「满足门槛且立减最多」的一张；都不满足返回 null。 */
export function bestCoupon(claimedIds: string[] | undefined, total: number): ShopCoupon | null {
    let best: ShopCoupon | null = null;
    for (const id of (claimedIds || [])) {
        const c = getCoupon(id);
        if (c && total >= c.threshold && (!best || c.discount > best.discount)) best = c;
    }
    return best;
}

/** 应用优惠券后的实付（不低于 0）。 */
export const applyCoupon = (total: number, coupon: ShopCoupon | null): number =>
    coupon ? Math.max(0, Math.round((total - coupon.discount) * 100) / 100) : Math.round(total * 100) / 100;

// ── 限时秒杀（每小时一轮，确定性挑品 + 折扣） ──────────────────────────────────
const FLASH_WINDOW_MS = 60 * 60 * 1000;
/** 本轮秒杀结束时间戳（下一个整点）。 */
export const flashEndsAt = (now: number = Date.now()): number => (Math.floor(now / FLASH_WINDOW_MS) + 1) * FLASH_WINDOW_MS;

/** 给定目录，确定性挑出 count 件秒杀品 + 折扣（一小时内稳定，整点换一批）。 */
export function flashDeals(catalog: ShopItem[], now: number = Date.now(), count = 4): { item: ShopItem; dealPrice: number; offPct: number }[] {
    if (!catalog.length) return [];
    const w = Math.floor(now / FLASH_WINDOW_MS);
    const ranked = [...catalog].sort((a, b) => hashStr(w + a.id) - hashStr(w + b.id)).slice(0, count);
    return ranked.map(item => {
        const offPct = 20 + (hashStr(w + 'off' + item.id) % 41); // 20%~60%
        const dealPrice = Math.max(0.1, Math.round(item.price * (100 - offPct)) / 100);
        return { item, dealPrice, offPct };
    });
}

/** 某商品本轮是否在秒杀 + 秒杀价。 */
export function flashDealFor(catalog: ShopItem[], itemId: string, now: number = Date.now()): { dealPrice: number; offPct: number } | null {
    const d = flashDeals(catalog, now).find(x => x.item.id === itemId);
    return d ? { dealPrice: d.dealPrice, offPct: d.offPct } : null;
}

// ── 猜你喜欢（按收藏分类加权 + 确定性打散，半小时换一批） ──────────────────────
export function recommendItems(catalog: ShopItem[], favorites: string[], count = 8): ShopItem[] {
    if (!catalog.length) return [];
    const favCats = new Set((favorites || []).map(id => getShopItem(id)?.category).filter(Boolean) as string[]);
    const seed = Math.floor(Date.now() / (30 * 60 * 1000));
    return catalog
        .map(it => ({ it, score: (favCats.has(it.category) ? 100000 : 0) + (hashStr(seed + it.id) % 1000) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, count)
        .map(x => x.it);
}

// ── 角色逛商城（副 API 驱动） ──────────────────────────────────────────────

export interface CharShopDecision {
    action: 'buy' | 'gift' | 'want';   // buy=给自己买；gift=回赠用户；want=加进自己的心愿购物车（等用户代付）
    itemId: string;
    note: string;             // 角色的理由 / 赠言（第一人称，短）
}

/** 组装「让角色逛一次商城」的 prompt。预算内挑一件，决定自购或送给用户。 */
export function buildCharShopPrompt(
    char: { name: string; personaText?: string },
    userName: string,
    budget: number,
): { system: string; user: string } {
    const affordable = SHOP_ITEMS.filter(i => i.price <= budget);
    const menu = (affordable.length ? affordable : SHOP_ITEMS)
        .map(i => `- ${i.id} | ${i.emoji}${i.name} | ¥${formatPrice(i.price)} | ${i.blurb}`)
        .join('\n');
    const persona = (char.personaText || '').toString().slice(0, 800);
    const system = `你是「${char.name}」。下面是你的人设，请完全代入，用你自己的喜好和性格做决定。\n${persona ? `【人设】\n${persona}\n` : ''}`;
    const user = `你正在逛一个礼物商城，预算大约 ¥${formatPrice(budget)}。请凭你的性格和喜好，从下面挑【一件】，决定怎么办：
- "buy"：自己买下来
- "gift"：买下送给${userName}
- "want"：加进自己的「心愿购物车」先攒着（你想要但还没舍得买，${userName} 看到了可能会帮你代付）

${menu}

只输出一个 JSON，不要任何多余文字、解释或代码块标记：
{"action":"buy / gift / want","itemId":"上面列表里的 id","note":"一句话理由或赠言，第一人称，20字内，像你会说的话"}`;
    return { system, user };
}

/** 从模型输出里稳健解析出角色的购物决定；解析失败返回 null（调用方兜底）。 */
export function parseCharShopDecision(raw: string): CharShopDecision | null {
    if (!raw) return null;
    let txt = raw.trim().replace(/```(?:json)?/gi, '').trim();
    const start = txt.indexOf('{');
    const end = txt.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    try {
        const obj = JSON.parse(txt.slice(start, end + 1));
        const item = getShopItem(String(obj.itemId || '').trim());
        if (!item) return null;
        const action: CharShopDecision['action'] = obj.action === 'gift' ? 'gift' : obj.action === 'want' ? 'want' : 'buy';
        const note = String(obj.note || '').trim().slice(0, 40);
        return { action, itemId: item.id, note };
    } catch {
        return null;
    }
}

// ── 物流详情时间轴（淘宝式：带时间戳的轨迹节点） ─────────────────────────────────
export interface TraceNode { key: OrderStage; label: string; desc: string; at: number; done: boolean; current: boolean; }

const TRACE_FRACS: { key: OrderStage; label: string; desc: string; f: number }[] = [
    { key: 'placed',     label: '已下单',  desc: '心意铺已收到你的订单，正在通知商家备货', f: 0 },
    { key: 'shipped',    label: '已发货',  desc: '商家已打包发出，包裹交由心意速递揽收', f: 0.18 },
    { key: 'transit',    label: '运输中',  desc: '包裹已离开发货地，正在飞速赶往你的城市', f: 0.45 },
    { key: 'delivering', label: '派送中',  desc: '快递小哥已揽件，正在为你火速派送', f: 0.78 },
    { key: 'arrived',    label: '已送达',  desc: '包裹已抵达，记得点确认收货签收哦', f: 1 },
];

/**
 * 订单物流轨迹（纯函数·确定性）：按 placedAt→etaAt 把各节点摊到时间线上。
 * 返回**倒序**（最新节点在前，贴合淘宝物流详情）。已签收追加签收节点。
 */
export function orderTrace(order: ShopOrder, now: number = Date.now()): TraceNode[] {
    const span = Math.max(1, order.etaAt - order.placedAt);
    const reached = order.receivedAt != null ? Infinity : (now - order.placedAt) / span;
    const nodes: TraceNode[] = TRACE_FRACS.map((s, i) => {
        const at = order.placedAt + Math.round(s.f * span);
        const done = reached >= s.f;
        const nextF = TRACE_FRACS[i + 1]?.f ?? Infinity;
        return { key: s.key, label: s.label, desc: s.desc, at, done, current: done && reached < nextF };
    });
    const out = nodes.filter(n => n.done);
    if (order.receivedAt != null) {
        out.push({ key: 'received', label: '已签收', desc: '宝贝已签收，期待你的好评～', at: order.receivedAt, done: true, current: true });
    }
    return out.reverse();
}

// ── 订单状态归类 + 各状态数量（「我的」订单快捷入口的角标） ────────────────────────
export type OrderStatusKey = 'toReceive' | 'toReview' | 'done' | 'refunded';

/** 单个订单当前归到哪个状态桶（结合是否已评价）。 */
export function orderStatusKey(order: ShopOrder, reviews: ShopUserReview[] | undefined, _now: number = Date.now()): OrderStatusKey {
    if (order.refundedAt) return 'refunded';
    if (!order.receivedAt) return 'toReceive';
    // 已签收：只要还有未评价的商品行就算「待评价」，否则「已完成」
    const hasPending = order.items.some(it => !isItemReviewed(reviews, order.id, it.itemId));
    return hasPending ? 'toReview' : 'done';
}

/** 统计四个状态桶各有多少订单（给「我的」页角标）。 */
export function orderStatusCounts(orders: ShopOrder[] | undefined, reviews: ShopUserReview[] | undefined, now: number = Date.now()): Record<OrderStatusKey, number> {
    const out: Record<OrderStatusKey, number> = { toReceive: 0, toReview: 0, done: 0, refunded: 0 };
    for (const o of (orders || [])) out[orderStatusKey(o, reviews, now)]++;
    return out;
}

// ── 商品评价（用户晒单）：写评价 / 查评价 / 好评率 ─────────────────────────────────
/** 某订单里的某商品是否已被用户评价过。 */
export const isItemReviewed = (reviews: ShopUserReview[] | undefined, orderId: string, itemId: string): boolean =>
    (reviews || []).some(r => r.orderId === orderId && r.itemId === itemId);

/** 待评价清单：已签收（未退款）订单里、尚未评价的商品行。 */
export function pendingReviewItems(orders: ShopOrder[] | undefined, reviews: ShopUserReview[] | undefined): { order: ShopOrder; item: ShopOrderItem }[] {
    const out: { order: ShopOrder; item: ShopOrderItem }[] = [];
    for (const o of (orders || [])) {
        if (!o.receivedAt || o.refundedAt) continue;
        for (const it of o.items) if (!isItemReviewed(reviews, o.id, it.itemId)) out.push({ order: o, item: it });
    }
    return out;
}

/** 构造一条用户评价。 */
export const makeUserReview = (itemId: string, orderId: string, stars: number, text: string): ShopUserReview => ({
    id: uid(),
    itemId,
    orderId,
    stars: Math.max(1, Math.min(5, Math.round(stars))),
    text: text.trim().slice(0, 200),
    at: Date.now(),
});

/** 某商品我写过的评价（最新在前）。 */
export const userReviewsForItem = (reviews: ShopUserReview[] | undefined, itemId: string): ShopUserReview[] =>
    (reviews || []).filter(r => r.itemId === itemId).sort((a, b) => b.at - a.at);

/** 好评率（stars≥4 占比，0~100 的整数）。空列表按评分派生一个体面的默认值。 */
export function goodRate(stars: number[], fallbackRating?: number): number {
    if (!stars.length) return fallbackRating != null ? Math.round(Math.max(60, Math.min(99, fallbackRating / 5 * 100))) : 96;
    const good = stars.filter(s => s >= 4).length;
    return Math.round((good / stars.length) * 100);
}

// ── 淘金币 + 每日签到 ───────────────────────────────────────────────────────
/** 淘金币兑换比例：100 金币 = 1 元。 */
export const COIN_PER_YUAN = 100;
/** 金币可抵现金额（元，向下取整到分；最多抵实付的 50%）。 */
export const coinsToYuan = (coins: number, payable: number): number => {
    const byCoin = Math.floor((coins || 0) / COIN_PER_YUAN * 100) / 100;
    const cap = Math.floor(payable * 0.5 * 100) / 100;
    return Math.max(0, Math.min(byCoin, cap));
};
/** 抵扣某金额需要消耗多少金币。 */
export const yuanToCoins = (yuan: number): number => Math.round(yuan * COIN_PER_YUAN);

/** 把时间戳归一化到「自然日」序号（按本地时区）。 */
const dayIndex = (ts: number): number => { const d = new Date(ts); return Math.floor((ts - d.getTimezoneOffset() * 60000) / 86400000); };
/** 今天是否还能签到（上次签到不在今天）。 */
export const checkinAvailable = (lastAt: number | undefined, now: number = Date.now()): boolean =>
    lastAt == null || dayIndex(lastAt) < dayIndex(now);
/** 当日签到奖励金币（确定性·按日期，10~60）。 */
export const dailyCheckinReward = (now: number = Date.now()): number => 10 + (hashStr('checkin' + dayIndex(now)) % 51);

// ── 浏览足迹 ────────────────────────────────────────────────────────────────
/** 记一条足迹：移到最前、去重、最多留 60 条。返回新数组。 */
export function pushFootprint(list: ShopFootprint[] | undefined, itemId: string, now: number = Date.now()): ShopFootprint[] {
    const rest = (list || []).filter(f => f.itemId !== itemId);
    return [{ itemId, at: now }, ...rest].slice(0, 60);
}
/** 解析足迹为 { item, at }（跳过已下架/未知商品）。 */
export const resolveFootprints = (list: ShopFootprint[] | undefined): { item: ShopItem; at: number }[] =>
    (list || []).map(f => ({ item: getShopItem(f.itemId), at: f.at }))
        .filter((x): x is { item: ShopItem; at: number } => !!x.item);

// ── 商品规格（淘宝式「选规格」faux SKU；按分类确定性派生，仅用于下单仪式感） ──────────
const SPECS_BY_CAT: Record<string, { label: string; opts: string[] }> = {
    flower:  { label: '包装', opts: ['牛皮纸款', '丝带礼盒', '鲜花速递'] },
    food:    { label: '口味', opts: ['经典原味', '抹茶限定', '巧克力'] },
    jewel:   { label: '款式', opts: ['银色', '玫瑰金', '附赠礼盒'] },
    plush:   { label: '尺寸', opts: ['小号·25cm', '中号·45cm', '大号·65cm'] },
    tech:    { label: '颜色', opts: ['星河黑', '月光白', '樱花粉'] },
    life:    { label: '规格', opts: ['标准装', '加量装', '礼盒装'] },
    romance: { label: '版本', opts: ['基础版', '定制版', '豪华版'] },
};
/** 某商品的规格选项（label + 选项数组）；无对应分类时给通用款式。 */
export function itemSpecs(item: Pick<ShopItem, 'id' | 'category'>): { label: string; opts: string[] } {
    return SPECS_BY_CAT[item.category] || { label: '款式', opts: ['标准款', '升级款'] };
}
