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

import type { ShopItem, ShopReceipt, ShopOwnedItem, ShopCartLine } from '../types';

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

export const getShopItem = (id: string): ShopItem | undefined => SHOP_ITEMS.find(i => i.id === id);

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
