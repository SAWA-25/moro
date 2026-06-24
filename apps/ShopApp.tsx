import React, { useState, useMemo, useEffect } from 'react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import Modal from '../components/os/Modal';
import { CharacterProfile, ShopItem, ShopOwnedItem, ShopOrderItem, ShopUserReview } from '../types';
import {
    SHOP_ITEMS, SHOP_CATEGORIES, formatPrice, makeOwnedItem, makeReceipt,
    buildGiftCardMeta, getShopItem, receiptLine, buildCharShopPrompt, parseCharShopDecision,
    emitShopUpdated, SHOP_UPDATED_EVENT,
    addToCart, setCartQty, removeFromCart, cartCount, cartTotal, resolveCart, expandCart,
    monthlySales, formatSales, itemRating, getItemReviews,
    registerShopItems, buildGenerateItemsPrompt, parseGeneratedItems,
    buildItemReviewsPrompt, parseGeneratedReviews, type ShopReview,
    makeOrder, orderProgress, orderReceivePayload, ORDER_STAGES,
    SHOP_COUPONS, bestCoupon, applyCoupon,
    flashDeals, flashEndsAt, recommendItems,
    orderTrace, type TraceNode, orderStatusKey, orderStatusCounts, type OrderStatusKey,
    isItemReviewed, pendingReviewItems, makeUserReview, userReviewsForItem, goodRate,
    coinsToYuan, yuanToCoins, COIN_PER_YUAN, checkinAvailable, dailyCheckinReward,
    pushFootprint, resolveFootprints, itemSpecs,
} from '../utils/shop';
import type { ShopOrder } from '../types';
import { resolveAuxApi } from '../utils/auxApi';
import { llmComplete } from '../utils/llmComplete';
import {
    CaretLeft, CaretRight, Handbag, Receipt as ReceiptIcon, Coins, Gift, Sparkle, ShoppingBagOpen,
    ShoppingCart, Plus, Minus, Trash, MagnifyingGlass, Heart, Star, Truck, CheckCircle,
    House, SquaresFour, User, ClockCounterClockwise, Ticket, PencilSimpleLine,
    ArrowCounterClockwise, CalendarCheck, Path, CheckSquare, Square, Storefront,
} from '@phosphor-icons/react';

type MainTab = 'home' | 'category' | 'cart' | 'my';
type SubView = null | 'orders' | 'bag' | 'receipts' | 'fav' | 'footprints' | 'coupons';

const ShopApp: React.FC = () => {
    const { closeApp, characters, userProfile, updateUserProfile, apiConfig, auxApiConfig, addToast, adjustUserBalance, updateCharacter } = useOS();

    const [tab, setTab] = useState<MainTab>('home');
    const [sub, setSub] = useState<SubView>(null);
    const [cat, setCat] = useState<string>('all');
    const [search, setSearch] = useState('');
    const [detailItem, setDetailItem] = useState<ShopItem | null>(null);
    const [catalog, setCatalog] = useState<ShopItem[]>([]);
    const [genBusy, setGenBusy] = useState(false);
    const [, forceTick] = useState(0);

    // 别处（聊天回赠等）改了商城数据时刷新
    useEffect(() => {
        const bump = () => forceTick(t => t + 1);
        window.addEventListener(SHOP_UPDATED_EVENT, bump);
        return () => window.removeEventListener(SHOP_UPDATED_EVENT, bump);
    }, []);

    const balance = Math.round((userProfile.balance || 0) * 100) / 100;
    const coins = userProfile.shopCoins || 0;
    const inventory = userProfile.shopInventory || [];
    const myReceipts = userProfile.shopReceipts || [];
    const cart = userProfile.shopCart || [];
    const cartNum = cartCount(cart);
    const favorites = userProfile.shopFavorites || [];
    const orders = userProfile.shopOrders || [];
    const myReviews = userProfile.shopReviews || [];
    const footprints = userProfile.shopFootprints || [];
    const claimedCoupons = userProfile.shopCoupons || [];
    const counts = orderStatusCounts(orders, myReviews);
    const checkinDone = !checkinAvailable(userProfile.shopCheckinAt);

    const toggleFav = (itemId: string) => {
        const fav = userProfile.shopFavorites || [];
        const next = fav.includes(itemId) ? fav.filter(x => x !== itemId) : [itemId, ...fav];
        updateUserProfile({ shopFavorites: next });
        addToast(fav.includes(itemId) ? '已取消收藏' : '已收藏 ❤️', 'success');
    };

    // 浏览足迹：打开详情即记一条（去重置顶）
    const recordFootprint = (item: ShopItem) => {
        updateUserProfile({ shopFootprints: pushFootprint(userProfile.shopFootprints, item.id) });
    };
    const openDetail = (item: ShopItem) => { setDetailItem(item); recordFootprint(item); };

    // ── 商品 AI 实时生成（每批 ≥20 件；缓存到本地，「换一批」可刷新） ──
    const CATALOG_KEY = 'moro_shop_catalog_v1';
    const generateCatalog = async (hint?: string) => {
        if (genBusy) return;
        setGenBusy(true);
        try {
            const api = resolveAuxApi(auxApiConfig, apiConfig);
            const { system, user } = buildGenerateItemsPrompt(22, hint);
            const raw = await llmComplete(api, [{ role: 'system', content: system }, { role: 'user', content: user }], { temperature: 1.0, maxTokens: 12000 });
            const items = parseGeneratedItems(raw);
            if (items.length === 0) {
                setCatalog(prev => (prev.length ? prev : SHOP_ITEMS));
                addToast('上新没成功，要不再点一次？', 'error');
                return;
            }
            registerShopItems(items);
            setCatalog(items);
            try { localStorage.setItem(CATALOG_KEY, JSON.stringify(items)); } catch { /* ignore */ }
            addToast(`上新 ${items.length} 件好物`, 'success');
        } catch {
            setCatalog(prev => (prev.length ? prev : SHOP_ITEMS));
            addToast('上新失败，先逛逛内置好物', 'error');
        } finally { setGenBusy(false); }
    };

    // 搜索栏实时生成：按搜索词现搜一批相关礼物
    const searchGen = (q: string) => {
        const term = q.trim();
        if (!term) return;
        if (!resolveAuxApi(auxApiConfig, apiConfig).apiKey) { addToast('配好副 API 才能现搜哦', 'info'); return; }
        addToast(`正在为「${term}」现搜相关好物…`, 'info');
        void generateCatalog(`请紧扣关键词「${term}」生成尽量相关的礼物（围绕该主题/场景/送礼对象/节日）`);
        setSearch(''); setCat('all');
    };

    // 进入商城：先用上次缓存，没有缓存才实时生成；副 API 没配则回退内置目录
    useEffect(() => {
        try {
            const cached = JSON.parse(localStorage.getItem(CATALOG_KEY) || 'null');
            if (Array.isArray(cached) && cached.length) { setCatalog(cached); registerShopItems(cached); return; }
        } catch { /* ignore */ }
        if (resolveAuxApi(auxApiConfig, apiConfig).apiKey) void generateCatalog();
        else setCatalog(SHOP_ITEMS);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // 商品详情页·评价：实时生成（失败 / 无 API 回退到内置 seeded 评价）
    const genReviews = async (item: ShopItem): Promise<ShopReview[]> => {
        try {
            const api = resolveAuxApi(auxApiConfig, apiConfig);
            if (!api.apiKey) return getItemReviews(item.id);
            const { system, user } = buildItemReviewsPrompt(item, 4);
            const raw = await llmComplete(api, [{ role: 'system', content: system }, { role: 'user', content: user }], { temperature: 0.95, maxTokens: 600 });
            const rv = parseGeneratedReviews(raw);
            return rv.length ? rv : getItemReviews(item.id);
        } catch { return getItemReviews(item.id); }
    };

    const activeOrders = orders.filter(o => !o.receivedAt && !o.refundedAt).length;

    // 进度条随时间推进：有在途订单时每 30s 触发一次重渲染
    useEffect(() => {
        if (!(userProfile.shopOrders || []).some(o => !o.receivedAt && !o.refundedAt)) return;
        const t = setInterval(() => forceTick(x => x + 1), 30000);
        return () => clearInterval(t);
    }, [userProfile.shopOrders]);

    const placeOrder = (lines: { item: ShopItem; qty: number }[], paidBy: 'self' | 'char', payerName?: string) => {
        const order = makeOrder(lines, paidBy, payerName);
        updateUserProfile({ shopOrders: [order, ...(userProfile.shopOrders || [])] });
        emitShopUpdated();
        return order;
    };

    // 确认收货：订单商品进背包 + 双方小票，标记 receivedAt
    const confirmReceipt = (order: ShopOrder) => {
        const { owned, userReceipts, charReceipts } = orderReceivePayload(order, userProfile.name || '我');
        updateUserProfile({
            shopInventory: [...owned, ...(userProfile.shopInventory || [])],
            shopReceipts: [...userReceipts, ...(userProfile.shopReceipts || [])],
            shopOrders: (userProfile.shopOrders || []).map(o => o.id === order.id ? { ...o, receivedAt: Date.now() } : o),
        });
        if (order.paidBy === 'char' && charReceipts.length > 0) {
            const payer = characters.find(c => c.name === order.payerName);
            if (payer) updateCharacter(payer.id, { shopReceipts: [...charReceipts, ...(payer.shopReceipts || [])] });
        }
        addToast(`已确认收货 · ${owned.length} 件进背包`, 'success');
        emitShopUpdated();
    };

    // 申请退款（仅自己支付且未收货的订单）：退回钱包（+返还所用金币）+ 标记 refundedAt
    const requestRefund = (order: ShopOrder) => {
        if (order.paidBy !== 'self' || order.receivedAt || order.refundedAt) return;
        adjustUserBalance(order.total);
        const refundCoins = order.coinDiscount ? yuanToCoins(order.coinDiscount) : 0;
        updateUserProfile({
            shopOrders: (userProfile.shopOrders || []).map(o => o.id === order.id ? { ...o, refundedAt: Date.now() } : o),
            ...(refundCoins ? { shopCoins: (userProfile.shopCoins || 0) + refundCoins } : {}),
        });
        addToast(`已退款 ¥${formatPrice(order.total)} 到钱包`, 'success');
        emitShopUpdated();
    };

    // 写评价：存一条用户评价（按 orderId+itemId 唯一）+ 奖励 5 淘金币
    const submitReview = (order: ShopOrder, item: ShopOrderItem, stars: number, text: string) => {
        const review = makeUserReview(item.itemId, order.id, stars, text);
        updateUserProfile({
            shopReviews: [review, ...(userProfile.shopReviews || [])],
            shopCoins: (userProfile.shopCoins || 0) + 5,
        });
        addToast('评价成功，+5 淘金币 🪙', 'success');
        emitShopUpdated();
    };

    // 每日签到领淘金币
    const doCheckin = () => {
        if (!checkinAvailable(userProfile.shopCheckinAt)) { addToast('今天已经签到过啦，明天再来～', 'info'); return; }
        const reward = dailyCheckinReward();
        updateUserProfile({ shopCoins: (userProfile.shopCoins || 0) + reward, shopCheckinAt: Date.now() });
        addToast(`签到成功，+${reward} 淘金币 🪙`, 'success');
    };

    // ── 购买（下单 → 物流 → 确认收货才进背包；支持数量 / 秒杀价） ──
    const buyItem = (item: ShopItem, qty = 1, priceOverride?: number) => {
        const unit = priceOverride != null ? priceOverride : item.price;
        const cost = Math.round(unit * qty * 100) / 100;
        if (balance < cost) { addToast('余额不够啦，去存钱罐挣点零花钱', 'error'); return; }
        adjustUserBalance(-cost);
        placeOrder([{ item: priceOverride != null ? { ...item, price: unit } : item, qty }], 'self');
        addToast(`下单成功 ${item.emoji}${item.name}${qty > 1 ? `×${qty}` : ''}，物流配送中`, 'success');
        setTab('my'); setSub('orders'); setOrderFilter('toReceive');
    };

    // 优惠券：领取（存 id）
    const claimCoupon = (id: string) => {
        if (claimedCoupons.includes(id)) { addToast('已领过这张券', 'info'); return; }
        updateUserProfile({ shopCoupons: [id, ...claimedCoupons] });
        addToast('优惠券已领取 🎟️', 'success');
    };

    // ── 购物车 ──
    const addItemToCart = (item: ShopItem, qty = 1) => {
        updateUserProfile({ shopCart: addToCart(userProfile.shopCart, item.id, qty) });
        addToast(`加入购物车 ${item.emoji}${qty > 1 ? `×${qty}` : ''}`, 'success');
        emitShopUpdated();
    };
    const changeQty = (itemId: string, qty: number) => {
        updateUserProfile({ shopCart: setCartQty(userProfile.shopCart, itemId, qty) });
        emitShopUpdated();
    };
    const removeCartLine = (itemId: string) => {
        updateUserProfile({ shopCart: removeFromCart(userProfile.shopCart, itemId) });
        emitShopUpdated();
    };
    const clearMyCart = () => { updateUserProfile({ shopCart: [] }); emitShopUpdated(); };

    // 购物车多选：记录「被取消勾选」的 itemId，默认全选
    const [deselected, setDeselected] = useState<Set<string>>(new Set());
    const isSel = (itemId: string) => !deselected.has(itemId);
    const toggleSel = (itemId: string) => setDeselected(prev => { const n = new Set(prev); n.has(itemId) ? n.delete(itemId) : n.add(itemId); return n; });
    const selectedLines = resolveCart(cart).filter(l => isSel(l.item.id));
    const allSelected = resolveCart(cart).length > 0 && selectedLines.length === resolveCart(cart).length;
    const toggleSelAll = () => setDeselected(allSelected ? new Set(resolveCart(cart).map(l => l.item.id)) : new Set());

    // 自己支付：选中商品 + 满减券 + 淘金币抵现
    const [useCoins, setUseCoins] = useState(false);
    const checkoutSelf = () => {
        const lines = selectedLines;
        if (lines.length === 0) { addToast('先勾选要结算的商品', 'info'); return; }
        const total = lines.reduce((s, { item, qty }) => s + Math.round(item.price * 100) * qty, 0) / 100;
        const coupon = bestCoupon(claimedCoupons, total);
        const afterCoupon = applyCoupon(total, coupon);
        const coinDiscount = useCoins ? coinsToYuan(coins, afterCoupon) : 0;
        const payable = Math.round((afterCoupon - coinDiscount) * 100) / 100;
        if (balance < payable) { addToast('余额不够，先去存钱罐挣点零花钱', 'error'); return; }
        adjustUserBalance(-payable);
        if (coinDiscount > 0) updateUserProfile({ shopCoins: Math.max(0, coins - yuanToCoins(coinDiscount)) });
        const order = makeOrder(lines, 'self');
        order.total = payable;
        if (coinDiscount > 0) order.coinDiscount = coinDiscount;
        const selectedIds = new Set(lines.map(l => l.item.id));
        updateUserProfile({
            shopOrders: [order, ...(userProfile.shopOrders || [])],
            shopCart: (userProfile.shopCart || []).filter(l => !selectedIds.has(l.itemId)),
        });
        const savedBits = [coupon ? `券省¥${formatPrice(coupon.discount)}` : '', coinDiscount > 0 ? `金币抵¥${formatPrice(coinDiscount)}` : ''].filter(Boolean).join('、');
        addToast(savedBits ? `${savedBits}，实付 ¥${formatPrice(payable)}` : '下单成功，物流配送中', 'success');
        emitShopUpdated();
        setTab('my'); setSub('orders'); setOrderFilter('toReceive');
    };

    // 求 TA 代付
    const [payReqBusy, setPayReqBusy] = useState(false);
    const [payPicker, setPayPicker] = useState(false);
    const requestCharPay = async (char: CharacterProfile) => {
        const items = expandCart(cart);
        if (items.length === 0) return;
        const total = cartTotal(cart);
        setPayReqBusy(true);
        const cartBrief = resolveCart(cart).map(({ item, qty }) => `${item.emoji}${item.name}×${qty}`).join('、');
        try {
            await DB.saveMessage({
                charId: char.id, role: 'user', type: 'text',
                content: `[购物车求代付] 我购物车里有：${cartBrief}，一共 ¥${formatPrice(total)}，可以帮我付一下吗～`,
            } as any);
        } catch { /* ignore */ }
        let agree = false; let reply = '';
        try {
            const api = resolveAuxApi(auxApiConfig, apiConfig);
            const sys = `你是「${char.name}」。${char.description ? `【人设】\n${String(char.description).slice(0, 800)}` : ''}`;
            const usr = `${userProfile.name || '对方'} 让你帮 TA 代付购物车（共 ¥${formatPrice(total)}：${cartBrief}）。请完全按你的人设、你们的关系亲密度和这个金额决定愿不愿意付。\n只输出 JSON：{"pay": true 或 false, "reply": "你对 TA 说的一句话，第一人称，30字内，贴人设"}`;
            const raw = await llmComplete(api, [{ role: 'system', content: sys }, { role: 'user', content: usr }], { temperature: 0.8, maxTokens: 200 });
            const txt = raw.replace(/```(?:json)?/gi, '').trim();
            const s = txt.indexOf('{'); const e = txt.lastIndexOf('}');
            if (s >= 0 && e > s) { const o = JSON.parse(txt.slice(s, e + 1)); agree = !!o.pay; reply = String(o.reply || '').slice(0, 60); }
        } catch { agree = (char.affection ?? 50) >= 60; }
        if (agree) {
            const order = makeOrder(resolveCart(cart), 'char', char.name);
            updateUserProfile({ shopOrders: [order, ...(userProfile.shopOrders || [])], shopCart: [] });
            try {
                await DB.saveMessage({
                    charId: char.id, role: 'assistant', type: 'text',
                    content: reply || `付好啦，一共 ¥${formatPrice(total)}，下次别乱花哦~`,
                    metadata: { shopPaidForUser: true },
                } as any);
            } catch { /* ignore */ }
            addToast(`${char.name} 帮你付了 ¥${formatPrice(total)}，物流配送中`, 'success');
            setTab('my'); setSub('orders'); setOrderFilter('toReceive');
        } else {
            try {
                await DB.saveMessage({ charId: char.id, role: 'assistant', type: 'text', content: reply || '这个有点超预算啦，下次的好不好～' } as any);
            } catch { /* ignore */ }
            addToast(`${char.name} 这次没答应代付`, 'info');
        }
        emitShopUpdated();
        setPayReqBusy(false);
        setPayPicker(false);
    };

    // 帮 TA 清空购物车（用户为角色心愿清单买单）
    const clearCharCart = async (char: CharacterProfile) => {
        const items = expandCart(char.shopCart);
        if (items.length === 0) return;
        const total = cartTotal(char.shopCart);
        if (balance < total) { addToast('余额不够帮 TA 付呢', 'error'); return; }
        adjustUserBalance(-total);
        const charReceipts = items.map(it => makeReceipt(it, 'char', 'buy', 'self', char.name, `${userProfile.name || '我'}代付`));
        const userReceipts = items.map(it => makeReceipt(it, 'user', 'gift', char.id, char.name, '代付'));
        updateCharacter(char.id, { shopCart: [], shopReceipts: [...charReceipts, ...(char.shopReceipts || [])] });
        updateUserProfile({ shopReceipts: [...userReceipts, ...(userProfile.shopReceipts || [])] });
        try {
            await DB.saveMessage({
                charId: char.id, role: 'system', type: 'text',
                content: `[购物车] ${userProfile.name || '你'} 帮 ${char.name} 清空了心愿购物车（${items.length}件，¥${formatPrice(total)}）`,
            } as any);
        } catch { /* ignore */ }
        addToast(`帮 ${char.name} 付了 ¥${formatPrice(total)}`, 'success');
        emitShopUpdated();
    };

    // ── 送礼给角色 ──
    const [giftTarget, setGiftTarget] = useState<ShopOwnedItem | null>(null);
    const [giftNote, setGiftNote] = useState('');
    const confirmGift = async (char: CharacterProfile) => {
        const owned = giftTarget;
        if (!owned) return;
        const base = getShopItem(owned.itemId) || { id: owned.itemId, name: owned.name, emoji: owned.emoji, price: owned.price };
        const note = giftNote.trim();
        try {
            await DB.saveMessage({
                charId: char.id, role: 'user', type: 'gift_card',
                content: `🎁 我送了你 ${owned.emoji}${owned.name}${note ? ` —— ${note}` : ''}`,
                metadata: { gift: buildGiftCardMeta(base, userProfile.name || '我', note) },
            } as any);
        } catch { /* 落卡失败不阻塞送礼 */ }
        const userReceipt = makeReceipt(base, 'user', 'gift', char.id, char.name, note);
        const charReceipt = makeReceipt(base, 'char', 'receive', 'user', userProfile.name || '我', note);
        updateCharacter(char.id, { shopReceipts: [charReceipt, ...(char.shopReceipts || [])] });
        updateUserProfile({
            shopInventory: (userProfile.shopInventory || []).filter(o => o.uid !== owned.uid),
            shopReceipts: [userReceipt, ...(userProfile.shopReceipts || [])],
        });
        addToast(`把 ${owned.emoji}${owned.name} 送给了 ${char.name}`, 'success');
        emitShopUpdated();
        setGiftTarget(null); setGiftNote('');
    };

    const onCharShop = async (char: CharacterProfile) => {
        const budget = Math.round(100 + (char.affection ?? 50) * 4);
        const { system, user } = buildCharShopPrompt({ name: char.name, personaText: char.description }, userProfile.name || '你', budget);
        let decision = null as ReturnType<typeof parseCharShopDecision>;
        try {
            const raw = await llmComplete(resolveAuxApi(auxApiConfig, apiConfig), [
                { role: 'system', content: system }, { role: 'user', content: user },
            ], { temperature: 0.9, maxTokens: 300 });
            decision = parseCharShopDecision(raw);
        } catch { /* 用兜底 */ }
        if (!decision) {
            const affordable = SHOP_ITEMS.filter(i => i.price <= budget);
            const pick = (affordable.length ? affordable : SHOP_ITEMS)[Math.floor(Math.random() * (affordable.length || SHOP_ITEMS.length))];
            decision = { action: Math.random() < 0.5 ? 'gift' : 'buy', itemId: pick.id, note: '' };
        }
        const item = getShopItem(decision.itemId)!;
        if (decision.action === 'want') {
            updateCharacter(char.id, { shopCart: addToCart(char.shopCart, item.id) });
            addToast(`${char.name} 把 ${item.emoji}${item.name} 加进了心愿购物车`, 'success');
            emitShopUpdated();
            return;
        }
        if (decision.action === 'gift') {
            const charReceipt = makeReceipt(item, 'char', 'gift', 'user', userProfile.name || '我', decision.note);
            const userReceipt = makeReceipt(item, 'user', 'receive', char.id, char.name, decision.note);
            updateCharacter(char.id, { shopReceipts: [charReceipt, ...(char.shopReceipts || [])] });
            updateUserProfile({
                shopInventory: [makeOwnedItem(item), ...(userProfile.shopInventory || [])],
                shopReceipts: [userReceipt, ...(userProfile.shopReceipts || [])],
            });
            try {
                await DB.saveMessage({
                    charId: char.id, role: 'assistant', type: 'gift_card',
                    content: `🎁 ${char.name} 送了你 ${item.emoji}${item.name}${decision.note ? ` —— ${decision.note}` : ''}`,
                    metadata: { gift: buildGiftCardMeta(item, char.name, decision.note) },
                } as any);
            } catch { /* ignore */ }
            addToast(`${char.name} 回赠了你 ${item.emoji}${item.name}`, 'success');
        } else {
            const charReceipt = makeReceipt(item, 'char', 'buy', 'self', char.name, decision.note);
            updateCharacter(char.id, { shopReceipts: [charReceipt, ...(char.shopReceipts || [])] });
            addToast(`${char.name} 给自己买了 ${item.emoji}${item.name}`, 'success');
        }
        emitShopUpdated();
    };

    // ── 选规格/数量 sheet（淘宝式） ──
    const [skuSheet, setSkuSheet] = useState<{ item: ShopItem; mode: 'cart' | 'buy' } | null>(null);
    const openSku = (item: ShopItem, mode: 'cart' | 'buy') => setSkuSheet({ item, mode });
    const confirmSku = (qty: number) => {
        if (!skuSheet) return;
        if (skuSheet.mode === 'cart') addItemToCart(skuSheet.item, qty);
        else { buyItem(skuSheet.item, qty); setDetailItem(null); }
        setSkuSheet(null);
    };

    // ── 订单子页：物流详情 / 写评价 / 状态过滤 ──
    const [logisticsOrder, setLogisticsOrder] = useState<ShopOrder | null>(null);
    const [reviewTarget, setReviewTarget] = useState<{ order: ShopOrder; item: ShopOrderItem } | null>(null);
    const [orderFilter, setOrderFilter] = useState<'all' | OrderStatusKey>('all');

    const openSubFromMy = (s: SubView) => { setSub(s); };
    const goOrders = (f: 'all' | OrderStatusKey) => { setTab('my'); setSub('orders'); setOrderFilter(f); };

    // 切换底栏主 tab 时清掉子页
    const switchTab = (t: MainTab) => { setTab(t); setSub(null); };

    const navItems: { id: MainTab; label: string; Icon: React.ElementType }[] = [
        { id: 'home', label: '首页', Icon: House },
        { id: 'category', label: '分类', Icon: SquaresFour },
        { id: 'cart', label: '购物车', Icon: ShoppingCart },
        { id: 'my', label: '我的', Icon: User },
    ];

    const subTitle: Record<Exclude<SubView, null>, string> = {
        orders: '我的订单', bag: '我的背包', receipts: '购物小票',
        fav: '我的收藏', footprints: '浏览足迹', coupons: '领券中心',
    };

    return (
        <div className="relative h-full w-full flex flex-col" style={{ background: 'linear-gradient(180deg,#fdf6f1 0%,#f7eee8 100%)' }}>
            {/* 顶栏 */}
            <div className="shrink-0">
                <div style={{ height: 'var(--safe-top)' }} />
                <div className="flex items-center px-4 h-14 gap-2">
                    <button onClick={sub ? () => setSub(null) : closeApp} className="p-2 -ml-2 rounded-full active:scale-90 transition-transform text-[#9a6b56]"><CaretLeft size={22} weight="bold" /></button>
                    <ShoppingBagOpen size={22} weight="fill" className="text-[#c2755a]" />
                    <span className="font-black text-[#7a4a38] text-lg tracking-tight">{sub ? subTitle[sub] : '心意铺'}</span>
                    <div className="flex-1" />
                    <div className="flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-white/70 shadow-sm">
                        <span className="text-[12px]">🪙</span>
                        <span className="text-[12px] font-black text-[#caa53a] tabular-nums">{coins}</span>
                    </div>
                    <div className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-white/70 shadow-sm">
                        <Coins size={16} weight="fill" className="text-amber-500" />
                        <span className="text-[13px] font-black text-[#7a4a38] tabular-nums">¥{formatPrice(balance)}</span>
                    </div>
                </div>
            </div>

            {/* 内容区 */}
            <div className="flex-1 overflow-y-auto px-4 pb-6" style={{ scrollbarWidth: 'none' }}>
                {sub === 'orders' ? (
                    <OrdersView orders={orders} reviews={myReviews} filter={orderFilter} setFilter={setOrderFilter}
                        onReceive={confirmReceipt} onGoShop={() => switchTab('home')}
                        onLogistics={setLogisticsOrder} onRefund={requestRefund}
                        onReview={(o, it) => setReviewTarget({ order: o, item: it })} />
                ) : sub === 'bag' ? (
                    <BagView inventory={inventory} onGift={(o) => { setGiftTarget(o); setGiftNote(''); }} />
                ) : sub === 'receipts' ? (
                    <ReceiptsView myReceipts={myReceipts} characters={characters} balance={balance}
                        onClearCharCart={clearCharCart} onCharShop={onCharShop} />
                ) : sub === 'fav' ? (
                    <FavoritesView favorites={favorites} balance={balance} onOpen={openDetail}
                        onToggleFav={toggleFav} onBuy={(i) => openSku(i, 'buy')} onAddCart={addItemToCart}
                        onGoShop={() => switchTab('home')} />
                ) : sub === 'footprints' ? (
                    <FootprintsView footprints={footprints} onOpen={openDetail} onClear={() => updateUserProfile({ shopFootprints: [] })} onGoShop={() => switchTab('home')} />
                ) : sub === 'coupons' ? (
                    <CouponsView claimed={claimedCoupons} onClaim={claimCoupon} />
                ) : tab === 'home' ? (
                    <ShopCatalog
                        catalog={catalog} genBusy={genBusy} onRefresh={() => generateCatalog()} onSearchGen={searchGen}
                        cat={cat} setCat={setCat} search={search} setSearch={setSearch}
                        balance={balance} favorites={favorites}
                        claimedCoupons={claimedCoupons} onClaimCoupon={claimCoupon} onBuyFlash={(it, p) => buyItem(it, 1, p)}
                        onBuy={(i) => openSku(i, 'buy')} onAddCart={addItemToCart}
                        onOpenDetail={openDetail} onToggleFav={toggleFav}
                    />
                ) : tab === 'category' ? (
                    <CategoryPage catalog={catalog} balance={balance} favorites={favorites}
                        onOpen={openDetail} onToggleFav={toggleFav} onBuy={(i) => openSku(i, 'buy')} onAddCart={addItemToCart} />
                ) : tab === 'cart' ? (
                    <CartView cart={cart} isSel={isSel} onToggleSel={toggleSel} onQty={changeQty} onRemove={removeCartLine} onClear={clearMyCart} onGoShop={() => switchTab('home')} />
                ) : (
                    <MyCenter
                        name={userProfile.name || '我'} avatar={userProfile.avatar} balance={balance} coins={coins}
                        counts={counts} checkinDone={checkinDone} onCheckin={doCheckin}
                        bagCount={inventory.length} favCount={favorites.length} footprintCount={footprints.length}
                        couponCount={claimedCoupons.length}
                        onGoOrders={goOrders} onOpenSub={openSubFromMy}
                    />
                )}
            </div>

            {/* 购物车结算条：自己支付 / 求 TA 代付（多选 + 满减券 + 金币抵现） */}
            {tab === 'cart' && !sub && selectedLines.length > 0 && (() => {
                const total = selectedLines.reduce((s, { item, qty }) => s + Math.round(item.price * 100) * qty, 0) / 100;
                const coupon = bestCoupon(claimedCoupons, total);
                const afterCoupon = applyCoupon(total, coupon);
                const coinDiscount = useCoins ? coinsToYuan(coins, afterCoupon) : 0;
                const payable = Math.round((afterCoupon - coinDiscount) * 100) / 100;
                const selCount = selectedLines.reduce((s, l) => s + l.qty, 0);
                return (
                    <div className="shrink-0 px-4 pb-2 pt-2.5 border-t border-rose-100/70 bg-[#faf2ec]">
                        <div className="flex items-center justify-between mb-1.5">
                            <button onClick={toggleSelAll} className="flex items-center gap-1.5 text-[12px] text-[#9a6b56] font-bold active:opacity-60">
                                {allSelected ? <CheckSquare size={18} weight="fill" className="text-[#ee0a24]" /> : <Square size={18} weight="bold" />}全选
                            </button>
                            {coins > 0 && (
                                <button onClick={() => setUseCoins(v => !v)} className="flex items-center gap-1 text-[11px] font-bold active:opacity-60">
                                    {useCoins ? <CheckSquare size={15} weight="fill" className="text-[#caa53a]" /> : <Square size={15} weight="bold" className="text-[#caa53a]" />}
                                    <span className="text-[#caa53a]">🪙 金币抵现（{coins}）</span>
                                </button>
                            )}
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="flex-1 min-w-0">
                                {(coupon || coinDiscount > 0) && (
                                    <div className="text-[9px] text-[#e84e2f] font-bold truncate">
                                        {coupon && `🎟️ ${coupon.title}`}{coupon && coinDiscount > 0 && ' · '}{coinDiscount > 0 && `🪙 抵 ¥${formatPrice(coinDiscount)}`}
                                    </div>
                                )}
                                <div className="flex items-baseline gap-1.5">
                                    <span className="text-[10px] text-[#9a6b56]">实付</span>
                                    <span className="text-[18px] font-black text-[#e84e2f] leading-none">¥{formatPrice(payable)}</span>
                                    {(coupon || coinDiscount > 0) && <span className="text-[10px] text-[#b89a8c] line-through">¥{formatPrice(total)}</span>}
                                </div>
                            </div>
                            <button onClick={() => setPayPicker(true)} className="px-3.5 py-2.5 rounded-full bg-white border border-[#c2755a]/40 text-[#c2755a] text-[12px] font-bold active:scale-95 transition-transform shrink-0">求 TA 代付</button>
                            <button onClick={checkoutSelf} disabled={balance < payable} className={`px-4 py-2.5 rounded-full text-[13px] font-bold active:scale-95 transition-transform shrink-0 ${balance >= payable ? 'bg-gradient-to-r from-[#ff6034] to-[#ee0a24] text-white shadow-md shadow-rose-200' : 'bg-slate-200 text-slate-400'}`}>{balance >= payable ? `结算(${selCount})` : '余额不足'}</button>
                        </div>
                    </div>
                );
            })()}

            {/* 底部导航栏（淘宝式） */}
            <div className="shrink-0 flex items-stretch border-t border-rose-100/70 bg-white/90 backdrop-blur" style={{ paddingBottom: 'env(safe-area-inset-bottom,0px)' }}>
                {navItems.map(n => {
                    const active = tab === n.id && !sub;
                    const badge = n.id === 'cart' && cartNum > 0 ? cartNum : 0;
                    return (
                        <button key={n.id} onClick={() => switchTab(n.id)}
                            className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-1.5 active:scale-95 transition-transform relative ${active ? 'text-[#ee0a24]' : 'text-[#b89a8c]'}`}>
                            <n.Icon size={23} weight={active ? 'fill' : 'regular'} />
                            <span className={`text-[10px] ${active ? 'font-black' : 'font-medium'}`}>{n.label}</span>
                            {badge > 0 && <span className="absolute top-0.5 right-1/2 -mr-3 min-w-[15px] h-[15px] px-1 rounded-full bg-[#ee0a24] text-white text-[9px] font-black flex items-center justify-center">{badge > 99 ? '99+' : badge}</span>}
                        </button>
                    );
                })}
            </div>

            {/* 商品详情页（淘宝式 PDP） */}
            {detailItem && (
                <ProductDetail
                    item={detailItem} faved={favorites.includes(detailItem.id)} balance={balance}
                    genReviews={genReviews} myReviews={userReviewsForItem(myReviews, detailItem.id)}
                    onClose={() => setDetailItem(null)} onToggleFav={toggleFav}
                    onAddCart={(i) => openSku(i, 'cart')} onBuy={(i) => openSku(i, 'buy')}
                />
            )}

            {/* 选规格/数量 sheet */}
            {skuSheet && (
                <SkuSheet item={skuSheet.item} mode={skuSheet.mode} balance={balance}
                    onClose={() => setSkuSheet(null)} onConfirm={confirmSku} />
            )}

            {/* 物流详情 */}
            {logisticsOrder && (
                <LogisticsSheet order={logisticsOrder} onClose={() => setLogisticsOrder(null)} />
            )}

            {/* 写评价 */}
            <ReviewModal target={reviewTarget} onClose={() => setReviewTarget(null)}
                onSubmit={(stars, text) => { if (reviewTarget) { submitReview(reviewTarget.order, reviewTarget.item, stars, text); setReviewTarget(null); } }} />

            {/* 送礼：选角色 */}
            <Modal isOpen={!!giftTarget} title={giftTarget ? `把 ${giftTarget.emoji}${giftTarget.name} 送给…` : ''} onClose={() => { setGiftTarget(null); setGiftNote(''); }}>
                <div className="space-y-3">
                    <textarea value={giftNote} onChange={e => setGiftNote(e.target.value)} placeholder="写句赠言（可选）" rows={2}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:border-rose-300 resize-none" />
                    {characters.length === 0 ? (
                        <div className="text-center text-slate-400 text-xs py-6">还没有角色，先去添加好友吧</div>
                    ) : (
                        <div className="grid grid-cols-4 gap-2 max-h-56 overflow-y-auto pr-1">
                            {characters.map(c => (
                                <button key={c.id} onClick={() => confirmGift(c)} className="flex flex-col items-center gap-1 p-2 rounded-xl border border-slate-100 bg-white hover:border-rose-300 active:scale-95 transition-all">
                                    <img src={c.convoSettings?.charAvatarOverride || c.avatar} className="w-11 h-11 rounded-full object-cover" />
                                    <span className="text-[9px] text-slate-600 truncate w-full text-center font-medium">{c.convoSettings?.remarkName?.trim() || c.name}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </Modal>
            {/* 求代付：选一个角色帮忙付购物车 */}
            <Modal isOpen={payPicker} title="求 TA 帮你付购物车" onClose={() => { if (!payReqBusy) setPayPicker(false); }}>
                <div className="space-y-3">
                    <div className="text-[12px] text-[#9a6b56]">合计 ¥{formatPrice(cartTotal(cart))} · 选一个角色，TA 会按心情/关系决定要不要代付</div>
                    {characters.length === 0 ? (
                        <div className="text-center text-slate-400 text-xs py-6">还没有角色</div>
                    ) : (
                        <div className="grid grid-cols-4 gap-2 max-h-56 overflow-y-auto pr-1">
                            {characters.map(c => (
                                <button key={c.id} disabled={payReqBusy} onClick={() => requestCharPay(c)} className="flex flex-col items-center gap-1 p-2 rounded-xl border border-slate-100 bg-white hover:border-rose-300 active:scale-95 transition-all disabled:opacity-50">
                                    <img src={c.convoSettings?.charAvatarOverride || c.avatar} className="w-11 h-11 rounded-full object-cover" />
                                    <span className="text-[9px] text-slate-600 truncate w-full text-center font-medium">{c.convoSettings?.remarkName?.trim() || c.name}</span>
                                </button>
                            ))}
                        </div>
                    )}
                    {payReqBusy && <div className="text-center text-[12px] text-[#c2755a]">正在问 TA…</div>}
                </div>
            </Modal>
        </div>
    );
};

// ── 可复用商品卡 ─────────────────────────────────────────────────────────────
const ItemCard: React.FC<{
    item: ShopItem; balance: number; faved?: boolean;
    onOpen: (i: ShopItem) => void; onToggleFav?: (id: string) => void;
    onBuy?: (i: ShopItem) => void; onAddCart?: (i: ShopItem) => void;
}> = ({ item, balance, faved, onOpen, onToggleFav, onBuy, onAddCart }) => {
    const afford = balance >= item.price;
    return (
        <div className="rounded-2xl bg-white flex flex-col shadow-sm border border-rose-50 overflow-hidden">
            <div className="relative cursor-pointer" onClick={() => onOpen(item)}>
                {item.image
                    ? <img src={item.image} className="w-full h-[92px] object-cover" alt="" loading="lazy" />
                    : <div className="text-[44px] text-center leading-none pt-3 pb-1.5 select-none bg-gradient-to-b from-[#fff7f2] to-white">{item.emoji}</div>}
                {onToggleFav && (
                    <button onClick={(e) => { e.stopPropagation(); onToggleFav(item.id); }}
                        className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full bg-white/80 backdrop-blur flex items-center justify-center active:scale-90 transition-transform shadow-sm">
                        <Heart size={15} weight={faved ? 'fill' : 'bold'} className={faved ? 'text-rose-500' : 'text-[#c9b3a8]'} />
                    </button>
                )}
            </div>
            <div className="px-3 pb-3 flex flex-col flex-1">
                <div className="text-[13px] font-black text-[#5a3a2e] truncate cursor-pointer" onClick={() => onOpen(item)}>{item.name}</div>
                <div className="flex items-center gap-1.5 mt-0.5 mb-2 text-[9.5px] text-[#b89a8c]">
                    <span className="flex items-center gap-0.5 text-amber-500"><Star size={10} weight="fill" />{itemRating(item.id)}</span>
                    <span>·</span><span>月销 {formatSales(monthlySales(item.id))}</span>
                </div>
                <div className="flex items-center justify-between mt-auto gap-1.5">
                    <span className="text-[15px] font-black text-[#e84e2f]">¥{formatPrice(item.price)}</span>
                    <div className="flex items-center gap-1.5">
                        {onAddCart && (
                            <button onClick={() => onAddCart(item)} title="加入购物车"
                                className="w-7 h-7 rounded-full bg-amber-50 text-[#c2755a] flex items-center justify-center active:scale-90 transition-transform border border-amber-100">
                                <ShoppingCart size={14} weight="bold" />
                            </button>
                        )}
                        {onBuy && (
                            <button onClick={() => onBuy(item)} disabled={!afford}
                                className={`px-3 py-1 rounded-full text-[12px] font-bold transition-all active:scale-90 ${afford ? 'bg-gradient-to-r from-[#ff6034] to-[#ee0a24] text-white shadow-sm' : 'bg-slate-100 text-slate-300'}`}>
                                {afford ? '购买' : '差点钱'}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

// ── 商城首页（搜索 + 金刚区分类 + 月销/评分/收藏 商品卡） ──
const ShopCatalog: React.FC<{
    catalog: ShopItem[]; genBusy: boolean; onRefresh: () => void; onSearchGen: (q: string) => void;
    cat: string; setCat: (c: string) => void;
    search: string; setSearch: (s: string) => void;
    balance: number; favorites: string[];
    claimedCoupons: string[]; onClaimCoupon: (id: string) => void; onBuyFlash: (item: ShopItem, price: number) => void;
    onBuy: (i: ShopItem) => void; onAddCart: (i: ShopItem) => void;
    onOpenDetail: (i: ShopItem) => void; onToggleFav: (id: string) => void;
}> = ({ catalog, genBusy, onRefresh, onSearchGen, cat, setCat, search, setSearch, balance, favorites, claimedCoupons, onClaimCoupon, onBuyFlash, onBuy, onAddCart, onOpenDetail, onToggleFav }) => {
    const home = cat === 'all' && !search.trim();
    const items = useMemo(() => {
        if (cat === 'fav') return favorites.map(id => getShopItem(id)).filter((x): x is ShopItem => !!x);
        let list = catalog;
        const q = search.trim().toLowerCase();
        if (q) list = list.filter(i =>
            i.name.toLowerCase().includes(q) || i.blurb.toLowerCase().includes(q) ||
            (SHOP_CATEGORIES.find(c => c.key === i.category)?.label || '').includes(q) || i.emoji.includes(q));
        if (cat !== 'all') list = list.filter(i => i.category === cat);
        return list;
    }, [cat, search, favorites, catalog]);
    return (
        <>
            <div className="flex items-center gap-2 mb-2.5 -mt-1">
                <div className="flex-1 flex items-center gap-2 bg-white rounded-full px-3.5 py-2 shadow-sm border border-rose-100">
                    <MagnifyingGlass size={16} weight="bold" className="text-[#c2755a] shrink-0" />
                    <input value={search} onChange={e => setSearch(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && search.trim()) onSearchGen(search); }}
                        placeholder="搜礼物 · 回车现搜相关好物…"
                        className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-[#c9b3a8] min-w-0" />
                    {search && <button onClick={() => setSearch('')} className="text-[#c9b3a8] text-sm shrink-0 active:opacity-60">✕</button>}
                </div>
                <button onClick={onRefresh} disabled={genBusy}
                    className="shrink-0 px-3 py-2 rounded-full bg-gradient-to-r from-[#ff6034] to-[#ee0a24] text-white text-[12px] font-bold active:scale-95 transition-transform disabled:opacity-60 flex items-center gap-1">
                    <Sparkle size={13} weight="fill" />{genBusy ? '上新中' : '换一批'}
                </button>
            </div>
            {search.trim() && (
                <button onClick={() => onSearchGen(search)} disabled={genBusy}
                    className="w-full mb-2.5 inline-flex items-center justify-center gap-1.5 py-2 rounded-full bg-[#fff1ee] text-[#e84e2f] border border-[#ffd9cf] text-[12px] font-bold active:scale-[0.98] transition-transform disabled:opacity-60">
                    <MagnifyingGlass size={14} weight="bold" />为「{search.trim()}」现搜相关好物
                </button>
            )}
            {home && (
                <>
                    <ShopBanner />
                    <CouponStrip claimed={claimedCoupons} onClaim={onClaimCoupon} />
                    <FlashSaleStrip catalog={catalog} balance={balance} onBuy={onBuyFlash} onOpen={onOpenDetail} />
                </>
            )}
            <div className="flex gap-2 overflow-x-auto pb-2.5 -mx-1 px-1" style={{ scrollbarWidth: 'none' }}>
                {[{ key: 'all', label: '全部', emoji: '🛍️' }, { key: 'fav', label: '收藏', emoji: '❤️' }, ...SHOP_CATEGORIES].map(c => (
                    <button key={c.key} onClick={() => setCat(c.key)}
                        className={`shrink-0 px-3 py-1.5 rounded-full text-[12px] font-bold transition-all active:scale-95 ${cat === c.key ? 'bg-[#7a4a38] text-white' : 'bg-white/70 text-[#9a6b56]'}`}>
                        {c.emoji} {c.label}
                    </button>
                ))}
            </div>
            {genBusy && items.length === 0 ? (
                <div className="flex flex-col items-center justify-center text-[#c2755a] gap-3 pt-20">
                    <div className="w-8 h-8 border-[3px] border-rose-200 border-t-[#c2755a] rounded-full animate-spin" />
                    <div className="text-xs">正在为你实时上新好物…</div>
                </div>
            ) : items.length === 0 ? (
                <div className="text-center text-[#b89a8c] text-xs pt-16">{cat === 'fav' ? '还没有收藏，点商品上的 ❤️ 收起来' : '没找到相关商品，点「换一批」试试'}</div>
            ) : (
                <div className="grid grid-cols-2 gap-3">
                    {items.map(item => (
                        <ItemCard key={item.id} item={item} balance={balance} faved={favorites.includes(item.id)}
                            onOpen={onOpenDetail} onToggleFav={onToggleFav} onBuy={onBuy} onAddCart={onAddCart} />
                    ))}
                </div>
            )}
            {home && <RecommendSection catalog={catalog} favorites={favorites} onOpen={onOpenDetail} onAddCart={onAddCart} />}
        </>
    );
};

// ── 分类页（淘宝式：左侧分类栏 + 右侧商品网格） ──
const CategoryPage: React.FC<{
    catalog: ShopItem[]; balance: number; favorites: string[];
    onOpen: (i: ShopItem) => void; onToggleFav: (id: string) => void; onBuy: (i: ShopItem) => void; onAddCart: (i: ShopItem) => void;
}> = ({ catalog, balance, favorites, onOpen, onToggleFav, onBuy, onAddCart }) => {
    const [active, setActive] = useState<string>(SHOP_CATEGORIES[0]?.key || 'flower');
    const items = useMemo(() => catalog.filter(i => i.category === active), [catalog, active]);
    const cur = SHOP_CATEGORIES.find(c => c.key === active);
    return (
        <div className="flex gap-2.5 -mx-1 px-1 pt-1" style={{ minHeight: '60vh' }}>
            {/* 左侧分类栏 */}
            <div className="w-[72px] shrink-0 space-y-1.5">
                {SHOP_CATEGORIES.map(c => (
                    <button key={c.key} onClick={() => setActive(c.key)}
                        className={`w-full py-2.5 rounded-xl flex flex-col items-center gap-0.5 transition-all active:scale-95 ${active === c.key ? 'bg-white text-[#e84e2f] font-black shadow-sm' : 'bg-white/40 text-[#9a6b56]'}`}>
                        <span className="text-[18px] leading-none">{c.emoji}</span>
                        <span className="text-[11px]">{c.label}</span>
                    </button>
                ))}
            </div>
            {/* 右侧商品 */}
            <div className="flex-1 min-w-0">
                <div className="rounded-xl bg-gradient-to-r from-[#fff1ee] to-white px-3 py-2 mb-2.5 text-[12px] font-bold text-[#7a4a38]">{cur?.emoji} {cur?.label}好物</div>
                {items.length === 0 ? (
                    <div className="text-center text-[#b89a8c] text-xs pt-12">这个分类暂时没有商品，去首页点「换一批」</div>
                ) : (
                    <div className="grid grid-cols-2 gap-2.5">
                        {items.map(item => (
                            <ItemCard key={item.id} item={item} balance={balance} faved={favorites.includes(item.id)}
                                onOpen={onOpen} onToggleFav={onToggleFav} onBuy={onBuy} onAddCart={onAddCart} />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

// ── 营销位：banner 轮播 ──
const BANNERS = [
    { t: '心意铺 · 替你把心意送到', s: '挑一份好物，比一句"在吗"更动人', g: 'linear-gradient(120deg,#ff6034,#ee0a24)' },
    { t: '今日上新 · AI 实时选品', s: '点「换一批」，每次都是新货架', g: 'linear-gradient(120deg,#c2755a,#e0a06f)' },
    { t: '满减券已就位', s: '满 49 减 5 起，结算自动用最优券', g: 'linear-gradient(120deg,#7a4a38,#b07a52)' },
    { t: '限时秒杀进行中', s: '整点开抢，手慢无', g: 'linear-gradient(120deg,#ff4d6d,#c9184a)' },
];
const ShopBanner: React.FC = () => {
    const [i, setI] = useState(0);
    useEffect(() => { const t = setInterval(() => setI(x => (x + 1) % BANNERS.length), 3500); return () => clearInterval(t); }, []);
    const b = BANNERS[i];
    return (
        <div className="rounded-2xl overflow-hidden mb-2.5 relative h-24 shadow-sm" style={{ background: b.g }}>
            <div className="absolute inset-0 px-4 flex flex-col justify-center text-white">
                <div className="text-[15px] font-black drop-shadow-sm">{b.t}</div>
                <div className="text-[11px] opacity-90 mt-0.5">{b.s}</div>
            </div>
            <div className="absolute bottom-2 right-3 flex gap-1">
                {BANNERS.map((_, k) => <span key={k} className={`w-1.5 h-1.5 rounded-full transition-all ${k === i ? 'bg-white' : 'bg-white/40'}`} />)}
            </div>
        </div>
    );
};

// ── 营销位：领券中心 ──
const CouponStrip: React.FC<{ claimed: string[]; onClaim: (id: string) => void; }> = ({ claimed, onClaim }) => (
    <div className="mb-2.5">
        <div className="text-[11px] font-black text-[#7a4a38] mb-1.5 flex items-center gap-1">🎟️ 领券中心</div>
        <div className="flex gap-2 overflow-x-auto -mx-1 px-1" style={{ scrollbarWidth: 'none' }}>
            {SHOP_COUPONS.map(c => {
                const got = claimed.includes(c.id);
                return (
                    <div key={c.id} className="shrink-0 rounded-xl bg-white border border-dashed border-[#e84e2f]/40 px-3 py-1.5 flex items-center gap-2">
                        <div className="leading-tight">
                            <div className="text-[14px] font-black text-[#e84e2f]">¥{formatPrice(c.discount)}</div>
                            <div className="text-[8.5px] text-[#b89a8c]">满{c.threshold}可用</div>
                        </div>
                        <button onClick={() => onClaim(c.id)} disabled={got}
                            className={`px-2.5 py-1 rounded-full text-[10px] font-bold active:scale-95 transition-transform ${got ? 'bg-rose-50 text-[#c9b3a8]' : 'bg-[#e84e2f] text-white'}`}>
                            {got ? '已领' : '领取'}
                        </button>
                    </div>
                );
            })}
        </div>
    </div>
);

// ── 营销位：限时秒杀 ──
const FlashSaleStrip: React.FC<{ catalog: ShopItem[]; balance: number; onBuy: (item: ShopItem, price: number) => void; onOpen: (i: ShopItem) => void; }> = ({ catalog, balance, onBuy, onOpen }) => {
    const [now, setNow] = useState(Date.now());
    useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
    const deals = useMemo(() => flashDeals(catalog, now, 4), [catalog, Math.floor(now / 60000)]);
    if (deals.length === 0) return null;
    const remain = Math.max(0, flashEndsAt(now) - now);
    const hh = String(Math.floor(remain / 3600000)).padStart(2, '0');
    const mm = String(Math.floor((remain % 3600000) / 60000)).padStart(2, '0');
    const ss = String(Math.floor((remain % 60000) / 1000)).padStart(2, '0');
    return (
        <div className="mb-2.5 rounded-2xl bg-gradient-to-b from-[#fff1ee] to-white border border-[#ffd9cf] p-2.5">
            <div className="flex items-center justify-between mb-2">
                <span className="text-[13px] font-black text-[#e84e2f] flex items-center gap-1">⚡ 限时秒杀</span>
                <span className="flex items-center gap-1 text-[10px] text-[#7a4a38]">
                    距结束
                    {[hh, mm, ss].map((v, k) => <span key={k} className="bg-[#2b2933] text-white rounded px-1 py-0.5 font-mono text-[10px] tabular-nums">{v}</span>)}
                </span>
            </div>
            <div className="flex gap-2 overflow-x-auto -mx-1 px-1" style={{ scrollbarWidth: 'none' }}>
                {deals.map(({ item, dealPrice, offPct }) => (
                    <div key={item.id} className="shrink-0 w-[88px]">
                        <div className="rounded-xl bg-white border border-rose-50 overflow-hidden cursor-pointer" onClick={() => onOpen(item)}>
                            {item.image
                                ? <img src={item.image} className="w-full h-14 object-cover" alt="" loading="lazy" />
                                : <div className="text-[30px] text-center leading-none py-2 bg-gradient-to-b from-[#fff7f2] to-white">{item.emoji}</div>}
                        </div>
                        <div className="text-[10px] text-[#5a3a2e] truncate mt-1">{item.name}</div>
                        <div className="flex items-baseline gap-1">
                            <span className="text-[12px] font-black text-[#e84e2f]">¥{formatPrice(dealPrice)}</span>
                            <span className="text-[8px] text-[#b89a8c] line-through">¥{formatPrice(item.price)}</span>
                        </div>
                        <button onClick={() => onBuy(item, dealPrice)} disabled={balance < dealPrice}
                            className={`w-full mt-0.5 py-1 rounded-full text-[10px] font-bold active:scale-95 transition-transform ${balance >= dealPrice ? 'bg-gradient-to-r from-[#ff6034] to-[#ee0a24] text-white' : 'bg-slate-100 text-slate-300'}`}>
                            {balance >= dealPrice ? `抢·${offPct}%off` : '差点钱'}
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
};

// ── 猜你喜欢 ──
const RecommendSection: React.FC<{ catalog: ShopItem[]; favorites: string[]; onOpen: (i: ShopItem) => void; onAddCart: (i: ShopItem) => void; }> = ({ catalog, favorites, onOpen, onAddCart }) => {
    const recs = useMemo(() => recommendItems(catalog, favorites, 8), [catalog, favorites]);
    if (recs.length === 0) return null;
    return (
        <div className="mt-4">
            <div className="text-[12px] font-black text-[#7a4a38] mb-2 flex items-center gap-1">💗 猜你喜欢</div>
            <div className="grid grid-cols-2 gap-3">
                {recs.map(item => (
                    <ItemCard key={item.id} item={item} balance={0} onOpen={onOpen} onAddCart={onAddCart} />
                ))}
            </div>
        </div>
    );
};

// ── 商品详情页（淘宝式 PDP） ──
const ProductDetail: React.FC<{
    item: ShopItem; faved: boolean; balance: number;
    genReviews: (item: ShopItem) => Promise<ShopReview[]>;
    myReviews: ShopUserReview[];
    onClose: () => void; onToggleFav: (id: string) => void;
    onAddCart: (i: ShopItem) => void; onBuy: (i: ShopItem) => void;
}> = ({ item, faved, balance, genReviews, myReviews, onClose, onToggleFav, onAddCart, onBuy }) => {
    const [reviews, setReviews] = useState<ShopReview[] | null>(null);
    useEffect(() => {
        let alive = true;
        setReviews(null);
        genReviews(item).then(rv => { if (alive) setReviews(rv); }).catch(() => { if (alive) setReviews(getItemReviews(item.id)); });
        return () => { alive = false; };
    }, [item.id]);
    const afford = balance >= item.price;
    const allStars = [...myReviews.map(r => r.stars), ...(reviews || []).map(r => r.stars)];
    const rate = goodRate(allStars, itemRating(item.id));
    return (
        <div className="absolute inset-0 z-[60] flex flex-col bg-[#f7eee8] animate-fade-in">
            <div style={{ height: 'var(--safe-top)' }} />
            <div className="flex items-center px-4 h-12 gap-2 shrink-0">
                <button onClick={onClose} className="p-2 -ml-2 rounded-full active:scale-90 transition-transform text-[#9a6b56]"><CaretLeft size={22} weight="bold" /></button>
                <span className="font-black text-[#7a4a38] text-[15px]">商品详情</span>
            </div>
            <div className="flex-1 overflow-y-auto px-4 pb-4" style={{ scrollbarWidth: 'none' }}>
                {item.image
                    ? <img src={item.image} className="w-full h-60 object-cover rounded-3xl shadow-sm border border-rose-50" alt="" />
                    : <div className="rounded-3xl bg-gradient-to-b from-[#fff7f2] to-white flex items-center justify-center text-[110px] leading-none py-8 shadow-sm border border-rose-50 select-none">{item.emoji}</div>}
                <div className="mt-3 rounded-2xl bg-white p-4 shadow-sm border border-rose-50">
                    <div className="flex items-end gap-2">
                        <span className="text-[26px] font-black text-[#e84e2f] leading-none">¥{formatPrice(item.price)}</span>
                        <span className="text-[11px] text-[#b89a8c] mb-0.5 flex items-center gap-1"><Star size={11} weight="fill" className="text-amber-500" />{itemRating(item.id)} · 月销 {formatSales(monthlySales(item.id))}</span>
                    </div>
                    <div className="text-[15px] font-black text-[#5a3a2e] mt-1.5">{item.name}</div>
                    <div className="text-[12px] text-[#a98c7e] leading-relaxed mt-1">{item.blurb}</div>
                </div>
                {/* 保障 */}
                <div className="mt-2.5 rounded-2xl bg-white px-4 py-2.5 shadow-sm border border-rose-50 flex items-center gap-3 flex-wrap text-[10px] text-[#9a6b56]">
                    {['7天无理由退换', '极速退款', '心意速递', '正品保障'].map(t => (
                        <span key={t} className="flex items-center gap-0.5"><CheckCircle size={12} weight="fill" className="text-[#e84e2f]" />{t}</span>
                    ))}
                </div>
                <div className="mt-3 rounded-2xl bg-white p-4 shadow-sm border border-rose-50">
                    <div className="flex items-center justify-between mb-2.5">
                        <span className="text-[13px] font-black text-[#7a4a38]">宝贝评价{reviews ? `（${myReviews.length + reviews.length}）` : ''}</span>
                        <span className="text-[10px] text-[#e84e2f] font-bold">好评率 {rate}%</span>
                    </div>
                    {reviews === null ? (
                        <div className="flex items-center justify-center gap-2 py-4 text-[11px] text-[#b89a8c]">
                            <span className="w-3.5 h-3.5 border-2 border-rose-200 border-t-[#c2755a] rounded-full animate-spin" />正在生成真实买家评价…
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {myReviews.map((r, i) => (
                                <div key={`my${i}`} className="flex gap-2.5">
                                    <div className="w-7 h-7 rounded-full bg-rose-500 text-white flex items-center justify-center text-[11px] font-black shrink-0">我</div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-[11px] font-bold text-[#7a4a38]">我的评价</span>
                                            <span className="flex">{Array.from({ length: 5 }).map((_, k) => <Star key={k} size={9} weight="fill" className={k < r.stars ? 'text-amber-400' : 'text-slate-200'} />)}</span>
                                        </div>
                                        <div className="text-[12px] text-[#5a3a2e] leading-snug mt-0.5">{r.text}</div>
                                    </div>
                                </div>
                            ))}
                            {reviews.map((r, i) => (
                                <div key={i} className="flex gap-2.5">
                                    <div className="w-7 h-7 rounded-full bg-rose-100 text-[#c2755a] flex items-center justify-center text-[11px] font-black shrink-0">{r.user[0]}</div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-[11px] font-bold text-[#7a4a38]">{r.user}</span>
                                            <span className="flex">{Array.from({ length: 5 }).map((_, k) => <Star key={k} size={9} weight="fill" className={k < r.stars ? 'text-amber-400' : 'text-slate-200'} />)}</span>
                                        </div>
                                        <div className="text-[12px] text-[#5a3a2e] leading-snug mt-0.5">{r.text}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
            <div className="shrink-0 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+10px)] pt-2.5 border-t border-rose-100/70 bg-[#faf2ec] flex items-center gap-2">
                <button onClick={() => onToggleFav(item.id)} className="flex flex-col items-center justify-center px-1 text-[#c2755a] shrink-0 w-11">
                    <Heart size={20} weight={faved ? 'fill' : 'bold'} className={faved ? 'text-rose-500' : 'text-[#c2755a]'} />
                    <span className="text-[8px] mt-0.5">{faved ? '已收藏' : '收藏'}</span>
                </button>
                <button onClick={() => onAddCart(item)} className="flex-1 py-2.5 rounded-full bg-amber-100 text-[#c2755a] text-[13px] font-bold active:scale-95 transition-transform">加入购物车</button>
                <button onClick={() => onBuy(item)} disabled={!afford}
                    className={`flex-1 py-2.5 rounded-full text-[13px] font-bold active:scale-95 transition-transform ${afford ? 'bg-gradient-to-r from-[#ff6034] to-[#ee0a24] text-white shadow-md shadow-rose-200' : 'bg-slate-200 text-slate-400'}`}>
                    {afford ? '立即购买' : '余额不足'}
                </button>
            </div>
        </div>
    );
};

// ── 选规格/数量 sheet（淘宝式底部弹层） ──
const SkuSheet: React.FC<{
    item: ShopItem; mode: 'cart' | 'buy'; balance: number;
    onClose: () => void; onConfirm: (qty: number) => void;
}> = ({ item, mode, balance, onClose, onConfirm }) => {
    const spec = useMemo(() => itemSpecs(item), [item.id]);
    const [qty, setQty] = useState(1);
    const [pick, setPick] = useState(0);
    const cost = Math.round(item.price * qty * 100) / 100;
    const afford = mode === 'cart' || balance >= cost;
    return (
        <div className="absolute inset-0 z-[70] flex flex-col justify-end animate-fade-in">
            <div className="absolute inset-0 bg-black/35" onClick={onClose} />
            <div className="relative bg-white rounded-t-3xl px-4 pt-4 pb-[calc(env(safe-area-inset-bottom,0px)+12px)] animate-slide-up">
                <div className="flex gap-3 items-start">
                    <div className="w-20 h-20 rounded-2xl bg-rose-50 flex items-center justify-center text-[40px] shrink-0 overflow-hidden">
                        {item.image ? <img src={item.image} className="w-full h-full object-cover" alt="" /> : item.emoji}
                    </div>
                    <div className="flex-1 min-w-0 pt-1">
                        <div className="text-[20px] font-black text-[#e84e2f] leading-none">¥{formatPrice(item.price)}</div>
                        <div className="text-[12px] text-[#5a3a2e] mt-1.5 line-clamp-2">{item.name}</div>
                    </div>
                    <button onClick={onClose} className="text-[#c9b3a8] text-lg active:opacity-60 -mt-1">✕</button>
                </div>
                <div className="border-t border-rose-50 my-3" />
                <div className="text-[12px] font-bold text-[#7a4a38] mb-2">{spec.label}</div>
                <div className="flex gap-2 flex-wrap mb-4">
                    {spec.opts.map((o, i) => (
                        <button key={o} onClick={() => setPick(i)}
                            className={`px-3 py-1.5 rounded-lg text-[12px] font-bold transition-all active:scale-95 ${pick === i ? 'bg-[#fff1ee] text-[#e84e2f] border border-[#e84e2f]' : 'bg-slate-50 text-[#9a6b56] border border-transparent'}`}>
                            {o}
                        </button>
                    ))}
                </div>
                <div className="flex items-center justify-between mb-4">
                    <span className="text-[12px] font-bold text-[#7a4a38]">数量</span>
                    <div className="flex items-center gap-3">
                        <button onClick={() => setQty(q => Math.max(1, q - 1))} className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center active:scale-90"><Minus size={14} weight="bold" /></button>
                        <span className="text-[15px] font-black text-[#5a3a2e] w-6 text-center tabular-nums">{qty}</span>
                        <button onClick={() => setQty(q => Math.min(99, q + 1))} className="w-8 h-8 rounded-full bg-[#c2755a] text-white flex items-center justify-center active:scale-90"><Plus size={14} weight="bold" /></button>
                    </div>
                </div>
                <button onClick={() => onConfirm(qty)} disabled={!afford}
                    className={`w-full py-3 rounded-full text-[14px] font-bold active:scale-[0.98] transition-transform ${afford ? 'bg-gradient-to-r from-[#ff6034] to-[#ee0a24] text-white shadow-md shadow-rose-200' : 'bg-slate-200 text-slate-400'}`}>
                    {mode === 'cart' ? '加入购物车' : afford ? `立即购买 · ¥${formatPrice(cost)}` : '余额不足'}
                </button>
            </div>
        </div>
    );
};

// ── 购物车（多选 + 数量增减 + 单删） ──
const CartView: React.FC<{
    cart: { itemId: string; qty: number }[];
    isSel: (itemId: string) => boolean;
    onToggleSel: (itemId: string) => void;
    onQty: (itemId: string, qty: number) => void;
    onRemove: (itemId: string) => void;
    onClear: () => void;
    onGoShop: () => void;
}> = ({ cart, isSel, onToggleSel, onQty, onRemove, onClear, onGoShop }) => {
    const lines = resolveCart(cart);
    if (lines.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center text-center text-[#b89a8c] gap-2 pt-20">
                <ShoppingCart size={42} weight="thin" />
                <p className="text-sm">购物车是空的</p>
                <button onClick={onGoShop} className="mt-1 px-4 py-1.5 rounded-full bg-[#c2755a] text-white text-[12px] font-bold active:scale-95 transition-transform">去逛逛</button>
            </div>
        );
    }
    return (
        <div className="pt-1">
            <div className="flex items-center justify-between mb-2 px-1">
                <span className="text-[12px] text-[#9a6b56] font-bold">共 {cartCount(cart)} 件</span>
                <button onClick={onClear} className="text-[11px] text-[#b89a8c] flex items-center gap-1 active:opacity-60"><Trash size={12} weight="bold" />清空</button>
            </div>
            <div className="space-y-2.5">
                {lines.map(({ item, qty }) => (
                    <div key={item.id} className="rounded-2xl bg-white p-3 flex items-center gap-2.5 shadow-sm border border-rose-50">
                        <button onClick={() => onToggleSel(item.id)} className="shrink-0 active:scale-90 transition-transform">
                            {isSel(item.id) ? <CheckSquare size={22} weight="fill" className="text-[#ee0a24]" /> : <Square size={22} weight="bold" className="text-[#cbb6ac]" />}
                        </button>
                        <span className="w-12 h-12 rounded-2xl bg-rose-50 flex items-center justify-center text-[26px] shrink-0 overflow-hidden">
                            {item.image ? <img src={item.image} className="w-full h-full object-cover" alt="" /> : item.emoji}
                        </span>
                        <div className="flex-1 min-w-0">
                            <div className="text-[14px] font-black text-[#5a3a2e] truncate">{item.name}</div>
                            <div className="text-[12px] text-[#c2755a] font-bold">¥{formatPrice(item.price)}</div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            <button onClick={() => qty <= 1 ? onRemove(item.id) : onQty(item.id, qty - 1)} className="w-7 h-7 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center active:scale-90">{qty <= 1 ? <Trash size={12} weight="bold" /> : <Minus size={13} weight="bold" />}</button>
                            <span className="text-[13px] font-black text-[#5a3a2e] w-5 text-center tabular-nums">{qty}</span>
                            <button onClick={() => onQty(item.id, qty + 1)} className="w-7 h-7 rounded-full bg-[#c2755a] text-white flex items-center justify-center active:scale-90"><Plus size={13} weight="bold" /></button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

// ── 我的订单 + 物流配送进度（时间轴 + 确认收货 / 退款 / 评价 / 查看物流） ──
const ORDER_FILTERS: { key: 'all' | OrderStatusKey; label: string }[] = [
    { key: 'all', label: '全部' },
    { key: 'toReceive', label: '待收货' },
    { key: 'toReview', label: '待评价' },
    { key: 'done', label: '已完成' },
    { key: 'refunded', label: '退款/售后' },
];
const OrdersView: React.FC<{
    orders: ShopOrder[]; reviews: ShopUserReview[]; filter: 'all' | OrderStatusKey; setFilter: (f: 'all' | OrderStatusKey) => void;
    onReceive: (o: ShopOrder) => void; onGoShop: () => void;
    onLogistics: (o: ShopOrder) => void; onRefund: (o: ShopOrder) => void; onReview: (o: ShopOrder, it: ShopOrderItem) => void;
}> = ({ orders, reviews, filter, setFilter, onReceive, onGoShop, onLogistics, onRefund, onReview }) => {
    const now = Date.now();
    const shown = filter === 'all' ? orders : orders.filter(o => orderStatusKey(o, reviews, now) === filter);
    return (
        <div className="pt-1">
            <div className="flex gap-2 mb-3 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
                {ORDER_FILTERS.map(f => (
                    <button key={f.key} onClick={() => setFilter(f.key)}
                        className={`shrink-0 px-3.5 py-1.5 rounded-full text-[12px] font-bold transition-all active:scale-95 ${filter === f.key ? 'bg-[#7a4a38] text-white' : 'bg-white/70 text-[#9a6b56]'}`}>{f.label}</button>
                ))}
            </div>
            {shown.length === 0 ? (
                <div className="flex flex-col items-center justify-center text-center text-[#b89a8c] gap-2 pt-16">
                    <Truck size={42} weight="thin" />
                    <p className="text-sm">{filter === 'all' ? '还没有订单' : '这里还没有订单'}</p>
                    <button onClick={onGoShop} className="mt-1 px-4 py-1.5 rounded-full bg-[#c2755a] text-white text-[12px] font-bold active:scale-95 transition-transform">去逛逛</button>
                </div>
            ) : (
                <div className="space-y-3">
                    {shown.map(o => {
                        const refunded = !!o.refundedAt;
                        const p = orderProgress(o, now);
                        const stageIdx = ORDER_STAGES.findIndex(s => s.key === p.stage);
                        const received = !!o.receivedAt;
                        const pendingItems = received && !refunded ? o.items.filter(it => !isItemReviewed(reviews, o.id, it.itemId)) : [];
                        return (
                            <div key={o.id} className="rounded-2xl bg-white p-3.5 shadow-sm border border-rose-50">
                                <div className="flex items-center justify-between mb-2">
                                    <span className={`text-[12px] font-black ${refunded ? 'text-[#b89a8c]' : received ? (pendingItems.length ? 'text-[#e84e2f]' : 'text-[#9a6b56]') : 'text-[#e84e2f]'}`}>
                                        {refunded ? '退款成功' : received ? (pendingItems.length ? '待评价' : '交易完成') : p.label}
                                    </span>
                                    <span className="text-[11px] text-[#b89a8c]">{o.paidBy === 'char' ? `${o.payerName || 'TA'}代付` : '自己支付'} · ¥{formatPrice(o.total)}</span>
                                </div>
                                <div className="flex items-center gap-1.5 flex-wrap mb-2.5">
                                    {o.items.map((it, i) => (
                                        <span key={i} className="inline-flex items-center gap-1 text-[12px] text-[#5a3a2e] bg-rose-50 rounded-full px-2 py-0.5">
                                            <span className="text-[14px]">{it.emoji}</span>{it.name}{it.qty > 1 ? `×${it.qty}` : ''}
                                        </span>
                                    ))}
                                </div>
                                {!received && !refunded && (
                                    <>
                                        <div className="h-1.5 rounded-full bg-rose-50 overflow-hidden mb-1.5">
                                            <div className="h-full rounded-full bg-gradient-to-r from-[#ff6034] to-[#ee0a24] transition-all" style={{ width: `${p.pct}%` }} />
                                        </div>
                                        <div className="flex justify-between mb-2">
                                            {ORDER_STAGES.map((s, i) => (
                                                <div key={s.key} className="flex flex-col items-center gap-0.5">
                                                    <span className={`w-2 h-2 rounded-full ${i <= stageIdx ? 'bg-[#ee0a24]' : 'bg-rose-100'}`} />
                                                    <span className={`text-[8px] ${i <= stageIdx ? 'text-[#c2755a] font-bold' : 'text-[#cbb6ac]'}`}>{s.label}</span>
                                                </div>
                                            ))}
                                        </div>
                                        <div className="text-[10px] text-[#b89a8c] mb-2">{p.etaText}</div>
                                    </>
                                )}
                                {/* 操作行 */}
                                <div className="flex items-center justify-end gap-2 flex-wrap">
                                    {!refunded && (
                                        <button onClick={() => onLogistics(o)} className="px-3 py-1.5 rounded-full bg-rose-50 text-[#c2755a] text-[11px] font-bold active:scale-95 transition-transform flex items-center gap-1"><Path size={13} weight="bold" />查看物流</button>
                                    )}
                                    {!received && !refunded && o.paidBy === 'self' && (
                                        <button onClick={() => onRefund(o)} className="px-3 py-1.5 rounded-full bg-slate-50 text-[#9a6b56] text-[11px] font-bold active:scale-95 transition-transform flex items-center gap-1"><ArrowCounterClockwise size={13} weight="bold" />申请退款</button>
                                    )}
                                    {p.canReceive && !refunded && (
                                        <button onClick={() => onReceive(o)} className="px-4 py-1.5 rounded-full bg-gradient-to-r from-[#ff6034] to-[#ee0a24] text-white text-[11px] font-bold active:scale-95 transition-transform flex items-center gap-1"><CheckCircle size={13} weight="fill" />确认收货</button>
                                    )}
                                    {pendingItems.map((it, i) => (
                                        <button key={i} onClick={() => onReview(o, it)} className="px-3 py-1.5 rounded-full bg-amber-400 text-white text-[11px] font-bold active:scale-95 transition-transform flex items-center gap-1"><PencilSimpleLine size={13} weight="bold" />评价{it.emoji}</button>
                                    ))}
                                    {refunded && <span className="text-[10px] text-[#b89a8c]">{new Date(o.refundedAt!).toLocaleString()} 已退款</span>}
                                    {received && !refunded && !pendingItems.length && <span className="text-[10px] text-[#b89a8c]">{new Date(o.receivedAt!).toLocaleString()} 已完成</span>}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

// ── 物流详情（轨迹时间轴） ──
const LogisticsSheet: React.FC<{ order: ShopOrder; onClose: () => void; }> = ({ order, onClose }) => {
    const trace = orderTrace(order);
    return (
        <div className="absolute inset-0 z-[70] flex flex-col justify-end animate-fade-in">
            <div className="absolute inset-0 bg-black/35" onClick={onClose} />
            <div className="relative bg-white rounded-t-3xl px-4 pt-4 pb-[calc(env(safe-area-inset-bottom,0px)+12px)] max-h-[75%] flex flex-col animate-slide-up">
                <div className="flex items-center justify-between mb-1">
                    <span className="text-[15px] font-black text-[#7a4a38] flex items-center gap-1.5"><Truck size={18} weight="fill" className="text-[#e84e2f]" />物流详情</span>
                    <button onClick={onClose} className="text-[#c9b3a8] text-lg active:opacity-60">✕</button>
                </div>
                <div className="text-[11px] text-[#b89a8c] mb-3">心意速递 · 运单号 SF{order.id.slice(-10).toUpperCase()}</div>
                <div className="flex items-center gap-1.5 flex-wrap mb-3">
                    {order.items.map((it, i) => <span key={i} className="text-[18px]">{it.emoji}</span>)}
                </div>
                <div className="overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
                    {trace.map((n, i) => (
                        <div key={n.key} className="flex gap-3">
                            <div className="flex flex-col items-center">
                                <span className={`w-3 h-3 rounded-full mt-1 ${n.current ? 'bg-[#ee0a24] ring-4 ring-rose-100' : i === trace.length - 1 ? 'bg-rose-200' : 'bg-rose-300'}`} />
                                {i < trace.length - 1 && <span className="w-0.5 flex-1 bg-rose-100 my-0.5" />}
                            </div>
                            <div className={`pb-4 ${i === 0 ? '' : 'opacity-70'}`}>
                                <div className={`text-[13px] ${n.current ? 'font-black text-[#e84e2f]' : 'font-bold text-[#5a3a2e]'}`}>{n.label}</div>
                                <div className="text-[11px] text-[#9a6b56] leading-snug mt-0.5">{n.desc}</div>
                                <div className="text-[10px] text-[#cbb6ac] mt-0.5">{new Date(n.at).toLocaleString()}</div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

// ── 写评价 ──
const ReviewModal: React.FC<{
    target: { order: ShopOrder; item: ShopOrderItem } | null;
    onClose: () => void; onSubmit: (stars: number, text: string) => void;
}> = ({ target, onClose, onSubmit }) => {
    const [stars, setStars] = useState(5);
    const [text, setText] = useState('');
    useEffect(() => { if (target) { setStars(5); setText(''); } }, [target?.item.itemId, target?.order.id]);
    return (
        <Modal isOpen={!!target} title={target ? `评价 ${target.item.emoji}${target.item.name}` : ''} onClose={onClose}
            footer={(
                <>
                    <button onClick={onClose} className="flex-1 py-3 bg-slate-100 text-slate-500 font-bold rounded-2xl active:scale-95 transition-transform">取消</button>
                    <button onClick={() => onSubmit(stars, text.trim() || '这次的宝贝挺好的，下次还来～')} className="flex-1 py-3 bg-gradient-to-r from-[#ff6034] to-[#ee0a24] text-white font-bold rounded-2xl active:scale-95 transition-transform">发布评价</button>
                </>
            )}>
            <div className="space-y-3">
                <div className="flex items-center justify-center gap-2">
                    {Array.from({ length: 5 }).map((_, k) => (
                        <button key={k} onClick={() => setStars(k + 1)} className="active:scale-90 transition-transform">
                            <Star size={28} weight="fill" className={k < stars ? 'text-amber-400' : 'text-slate-200'} />
                        </button>
                    ))}
                </div>
                <div className="text-center text-[12px] text-[#9a6b56] font-bold">{['很差', '失望', '一般', '满意', '超赞'][stars - 1]}</div>
                <textarea value={text} onChange={e => setText(e.target.value)} rows={3} placeholder="说说这次的宝贝怎么样吧（质感/物流/送人…）"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:border-rose-300 resize-none" />
            </div>
        </Modal>
    );
};

// ── 我的（个人中心） ──
const MyCenter: React.FC<{
    name: string; avatar?: string; balance: number; coins: number;
    counts: Record<OrderStatusKey, number>; checkinDone: boolean; onCheckin: () => void;
    bagCount: number; favCount: number; footprintCount: number; couponCount: number;
    onGoOrders: (f: 'all' | OrderStatusKey) => void; onOpenSub: (s: SubView) => void;
}> = ({ name, avatar, balance, coins, counts, checkinDone, onCheckin, bagCount, favCount, footprintCount, couponCount, onGoOrders, onOpenSub }) => {
    const orderEntries: { key: OrderStatusKey; label: string; Icon: React.ElementType; n: number }[] = [
        { key: 'toReceive', label: '待收货', Icon: Truck, n: counts.toReceive },
        { key: 'toReview', label: '待评价', Icon: PencilSimpleLine, n: counts.toReview },
        { key: 'refunded', label: '退款/售后', Icon: ArrowCounterClockwise, n: counts.refunded },
        { key: 'done', label: '已完成', Icon: CheckCircle, n: counts.done },
    ];
    const tools: { label: string; Icon: React.ElementType; n?: number; go: () => void }[] = [
        { label: '我的背包', Icon: Handbag, n: bagCount, go: () => onOpenSub('bag') },
        { label: '我的收藏', Icon: Heart, n: favCount, go: () => onOpenSub('fav') },
        { label: '浏览足迹', Icon: ClockCounterClockwise, n: footprintCount, go: () => onOpenSub('footprints') },
        { label: '领券中心', Icon: Ticket, n: couponCount, go: () => onOpenSub('coupons') },
        { label: '购物小票', Icon: ReceiptIcon, go: () => onOpenSub('receipts') },
        { label: '角色逛铺', Icon: Storefront, go: () => onOpenSub('receipts') },
    ];
    return (
        <div className="pt-1 space-y-3">
            {/* 头部 */}
            <div className="rounded-2xl bg-gradient-to-br from-[#c2755a] to-[#d99a7c] p-4 text-white shadow-md shadow-rose-200">
                <div className="flex items-center gap-3">
                    {avatar ? <img src={avatar} className="w-14 h-14 rounded-full object-cover border-2 border-white/60" alt="" />
                        : <div className="w-14 h-14 rounded-full bg-white/25 flex items-center justify-center text-[26px]">🙂</div>}
                    <div className="flex-1 min-w-0">
                        <div className="text-[16px] font-black truncate">{name}</div>
                        <div className="text-[11px] opacity-90 mt-0.5">心意铺 VIP · 用心意联结彼此</div>
                    </div>
                </div>
                <div className="flex gap-2 mt-3">
                    <div className="flex-1 rounded-xl bg-white/15 px-3 py-2">
                        <div className="text-[15px] font-black tabular-nums">¥{formatPrice(balance)}</div>
                        <div className="text-[10px] opacity-90">钱包余额</div>
                    </div>
                    <div className="flex-1 rounded-xl bg-white/15 px-3 py-2">
                        <div className="text-[15px] font-black tabular-nums">🪙 {coins}</div>
                        <div className="text-[10px] opacity-90">淘金币</div>
                    </div>
                    <button onClick={onCheckin} disabled={checkinDone}
                        className={`shrink-0 px-3 rounded-xl text-[12px] font-black flex flex-col items-center justify-center active:scale-95 transition-transform ${checkinDone ? 'bg-white/15 text-white/70' : 'bg-white text-[#e84e2f]'}`}>
                        <CalendarCheck size={18} weight="fill" />
                        {checkinDone ? '已签到' : '签到'}
                    </button>
                </div>
            </div>

            {/* 我的订单 */}
            <div className="rounded-2xl bg-white p-3.5 shadow-sm border border-rose-50">
                <button onClick={() => onGoOrders('all')} className="w-full flex items-center justify-between mb-3 active:opacity-70">
                    <span className="text-[13px] font-black text-[#7a4a38]">我的订单</span>
                    <span className="text-[11px] text-[#b89a8c] flex items-center gap-0.5">查看全部 <CaretRight size={12} weight="bold" /></span>
                </button>
                <div className="grid grid-cols-4 gap-1">
                    {orderEntries.map(e => (
                        <button key={e.key} onClick={() => onGoOrders(e.key)} className="flex flex-col items-center gap-1 py-1 active:scale-95 transition-transform relative">
                            <e.Icon size={24} weight="regular" className="text-[#c2755a]" />
                            <span className="text-[10px] text-[#9a6b56]">{e.label}</span>
                            {e.n > 0 && <span className="absolute top-0 right-2 min-w-[15px] h-[15px] px-1 rounded-full bg-[#ee0a24] text-white text-[9px] font-black flex items-center justify-center">{e.n > 99 ? '99+' : e.n}</span>}
                        </button>
                    ))}
                </div>
            </div>

            {/* 工具 */}
            <div className="rounded-2xl bg-white p-3.5 shadow-sm border border-rose-50">
                <div className="text-[13px] font-black text-[#7a4a38] mb-3">我的工具</div>
                <div className="grid grid-cols-4 gap-y-4 gap-x-1">
                    {tools.map(t => (
                        <button key={t.label} onClick={t.go} className="flex flex-col items-center gap-1 active:scale-95 transition-transform relative">
                            <t.Icon size={24} weight="regular" className="text-[#c2755a]" />
                            <span className="text-[10px] text-[#9a6b56]">{t.label}</span>
                            {t.n != null && t.n > 0 && <span className="absolute -top-1 right-2 min-w-[15px] h-[15px] px-1 rounded-full bg-rose-400 text-white text-[9px] font-black flex items-center justify-center">{t.n > 99 ? '99+' : t.n}</span>}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
};

// ── 收藏 ──
const FavoritesView: React.FC<{
    favorites: string[]; balance: number;
    onOpen: (i: ShopItem) => void; onToggleFav: (id: string) => void; onBuy: (i: ShopItem) => void; onAddCart: (i: ShopItem) => void;
    onGoShop: () => void;
}> = ({ favorites, balance, onOpen, onToggleFav, onBuy, onAddCart, onGoShop }) => {
    const items = favorites.map(id => getShopItem(id)).filter((x): x is ShopItem => !!x);
    if (items.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center text-center text-[#b89a8c] gap-2 pt-20">
                <Heart size={42} weight="thin" />
                <p className="text-sm">还没有收藏</p>
                <p className="text-[11px]">逛商城时点 ❤️ 把心头好收起来</p>
                <button onClick={onGoShop} className="mt-1 px-4 py-1.5 rounded-full bg-[#c2755a] text-white text-[12px] font-bold active:scale-95 transition-transform">去逛逛</button>
            </div>
        );
    }
    return (
        <div className="grid grid-cols-2 gap-3 pt-1">
            {items.map(item => (
                <ItemCard key={item.id} item={item} balance={balance} faved onOpen={onOpen} onToggleFav={onToggleFav} onBuy={onBuy} onAddCart={onAddCart} />
            ))}
        </div>
    );
};

// ── 浏览足迹 ──
const FootprintsView: React.FC<{
    footprints: { itemId: string; at: number }[];
    onOpen: (i: ShopItem) => void; onClear: () => void; onGoShop: () => void;
}> = ({ footprints, onOpen, onClear, onGoShop }) => {
    const list = resolveFootprints(footprints);
    if (list.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center text-center text-[#b89a8c] gap-2 pt-20">
                <ClockCounterClockwise size={42} weight="thin" />
                <p className="text-sm">还没有浏览记录</p>
                <button onClick={onGoShop} className="mt-1 px-4 py-1.5 rounded-full bg-[#c2755a] text-white text-[12px] font-bold active:scale-95 transition-transform">去逛逛</button>
            </div>
        );
    }
    return (
        <div className="pt-1">
            <div className="flex items-center justify-between mb-2 px-1">
                <span className="text-[12px] text-[#9a6b56] font-bold">看过 {list.length} 件</span>
                <button onClick={onClear} className="text-[11px] text-[#b89a8c] flex items-center gap-1 active:opacity-60"><Trash size={12} weight="bold" />清空足迹</button>
            </div>
            <div className="space-y-2.5">
                {list.map(({ item, at }) => (
                    <button key={item.id} onClick={() => onOpen(item)} className="w-full rounded-2xl bg-white p-3 flex items-center gap-3 shadow-sm border border-rose-50 active:scale-[0.99] transition-transform text-left">
                        <span className="w-12 h-12 rounded-2xl bg-rose-50 flex items-center justify-center text-[26px] shrink-0 overflow-hidden">
                            {item.image ? <img src={item.image} className="w-full h-full object-cover" alt="" /> : item.emoji}
                        </span>
                        <div className="flex-1 min-w-0">
                            <div className="text-[14px] font-black text-[#5a3a2e] truncate">{item.name}</div>
                            <div className="text-[11px] text-[#a98c7e]">¥{formatPrice(item.price)} · {new Date(at).toLocaleDateString()} 看过</div>
                        </div>
                        <CaretRight size={16} weight="bold" className="text-[#cbb6ac] shrink-0" />
                    </button>
                ))}
            </div>
        </div>
    );
};

// ── 领券中心（完整页） ──
const CouponsView: React.FC<{ claimed: string[]; onClaim: (id: string) => void; }> = ({ claimed, onClaim }) => (
    <div className="pt-1 space-y-2.5">
        {SHOP_COUPONS.map(c => {
            const got = claimed.includes(c.id);
            return (
                <div key={c.id} className="rounded-2xl bg-white border border-rose-50 shadow-sm overflow-hidden flex items-stretch">
                    <div className="w-28 shrink-0 bg-gradient-to-br from-[#ff6034] to-[#ee0a24] text-white flex flex-col items-center justify-center py-3">
                        <div className="text-[24px] font-black leading-none">¥{formatPrice(c.discount)}</div>
                        <div className="text-[10px] opacity-90 mt-1">满 {c.threshold} 可用</div>
                    </div>
                    <div className="flex-1 flex items-center justify-between px-3">
                        <div>
                            <div className="text-[13px] font-black text-[#5a3a2e]">{c.title}</div>
                            <div className="text-[10px] text-[#b89a8c] mt-0.5">全场通用 · 结算自动抵扣最优券</div>
                        </div>
                        <button onClick={() => onClaim(c.id)} disabled={got}
                            className={`px-4 py-1.5 rounded-full text-[12px] font-bold active:scale-95 transition-transform ${got ? 'bg-rose-50 text-[#c9b3a8]' : 'bg-[#e84e2f] text-white'}`}>
                            {got ? '已领取' : '立即领取'}
                        </button>
                    </div>
                </div>
            );
        })}
        <div className="text-center text-[10px] text-[#cbb6ac] pt-2">已领的券会在购物车结算时自动选用最优的一张</div>
    </div>
);

// ── 背包 ──
const BagView: React.FC<{ inventory: ShopOwnedItem[]; onGift: (o: ShopOwnedItem) => void; }> = ({ inventory, onGift }) => {
    if (inventory.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center text-center text-[#b89a8c] gap-2 pt-20">
                <Handbag size={42} weight="thin" />
                <p className="text-sm">背包空空的</p>
                <p className="text-[11px]">去商城买点礼物，再回来送给角色吧</p>
            </div>
        );
    }
    return (
        <div className="space-y-2.5 pt-1">
            {inventory.map(o => (
                <div key={o.uid} className="rounded-2xl bg-white p-3 flex items-center gap-3 shadow-sm border border-rose-50">
                    <span className="w-12 h-12 rounded-2xl bg-rose-50 flex items-center justify-center text-[26px] shrink-0">{o.emoji}</span>
                    <div className="flex-1 min-w-0">
                        <div className="text-[14px] font-black text-[#5a3a2e] truncate">{o.name}</div>
                        <div className="text-[11px] text-[#a98c7e]">¥{formatPrice(o.price)} · {new Date(o.boughtAt).toLocaleDateString()}</div>
                    </div>
                    <button onClick={() => onGift(o)} className="px-3.5 py-2 rounded-full bg-[#c2755a] text-white text-[12px] font-bold flex items-center gap-1 active:scale-90 transition-transform shadow-sm">
                        <Gift size={15} weight="fill" />送给 TA
                    </button>
                </div>
            ))}
        </div>
    );
};

// ── 小票 ──
const ReceiptsView: React.FC<{
    myReceipts: ReturnType<typeof makeReceipt>[];
    characters: CharacterProfile[];
    balance: number;
    onClearCharCart: (char: CharacterProfile) => Promise<void>;
    onCharShop: (char: CharacterProfile) => Promise<void>;
}> = ({ myReceipts, characters, balance, onClearCharCart, onCharShop }) => {
    const [side, setSide] = useState<'mine' | 'char'>('mine');
    const [charId, setCharId] = useState<string>(characters[0]?.id || '');
    const [busy, setBusy] = useState(false);
    const char = characters.find(c => c.id === charId) || null;
    const charReceipts = char?.shopReceipts || [];

    return (
        <div className="pt-1">
            <div className="flex gap-2 mb-3">
                {([['mine', '我的'], ['char', '角色']] as const).map(([k, label]) => (
                    <button key={k} onClick={() => setSide(k)}
                        className={`px-3.5 py-1.5 rounded-full text-[12px] font-bold transition-all active:scale-95 ${side === k ? 'bg-[#7a4a38] text-white' : 'bg-white/70 text-[#9a6b56]'}`}>{label}</button>
                ))}
            </div>

            {side === 'mine' ? (
                <ReceiptList list={myReceipts} empty="还没有购物记录" />
            ) : (
                <>
                    {characters.length === 0 ? (
                        <div className="text-center text-[#b89a8c] text-xs pt-16">还没有角色</div>
                    ) : (
                        <>
                            <div className="flex gap-2 overflow-x-auto pb-2.5" style={{ scrollbarWidth: 'none' }}>
                                {characters.map(c => (
                                    <button key={c.id} onClick={() => setCharId(c.id)}
                                        className={`shrink-0 flex items-center gap-1.5 pl-1 pr-3 py-1 rounded-full transition-all active:scale-95 ${charId === c.id ? 'bg-[#7a4a38] text-white' : 'bg-white/70 text-[#9a6b56]'}`}>
                                        <img src={c.convoSettings?.charAvatarOverride || c.avatar} className="w-6 h-6 rounded-full object-cover" />
                                        <span className="text-[12px] font-bold">{c.convoSettings?.remarkName?.trim() || c.name}</span>
                                    </button>
                                ))}
                            </div>
                            {char && (
                                <button disabled={busy}
                                    onClick={async () => { setBusy(true); try { await onCharShop(char); } finally { setBusy(false); } }}
                                    className="w-full mb-3 py-2.5 rounded-2xl bg-gradient-to-r from-[#c2755a] to-[#d99a7c] text-white text-[13px] font-bold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform shadow-md shadow-rose-200 disabled:opacity-60">
                                    <Sparkle size={16} weight="fill" />{busy ? `${char.name} 正在逛…` : `邀请 ${char.name} 逛逛商城`}
                                </button>
                            )}
                            {char && resolveCart(char.shopCart).length > 0 && (
                                <div className="mb-3 rounded-2xl bg-white/85 border border-rose-100 p-3">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-[12px] font-bold text-[#7a4a38]">🛒 {char.name} 的心愿购物车</span>
                                        <span className="text-[12px] font-black text-[#c2755a]">¥{formatPrice(cartTotal(char.shopCart))}</span>
                                    </div>
                                    <div className="space-y-1 mb-2.5">
                                        {resolveCart(char.shopCart).map(({ item, qty }) => (
                                            <div key={item.id} className="flex items-center gap-2 text-[12px] text-[#5a3a2e]">
                                                <span className="text-[16px]">{item.emoji}</span>
                                                <span className="flex-1 truncate">{item.name} ×{qty}</span>
                                                <span className="text-[#a98c7e]">¥{formatPrice(item.price * qty)}</span>
                                            </div>
                                        ))}
                                    </div>
                                    <button disabled={busy || balance < cartTotal(char.shopCart)}
                                        onClick={async () => { setBusy(true); try { await onClearCharCart(char); } finally { setBusy(false); } }}
                                        className={`w-full py-2 rounded-xl text-[12px] font-bold active:scale-[0.98] transition-transform ${balance >= cartTotal(char.shopCart) ? 'bg-[#c2755a] text-white' : 'bg-slate-200 text-slate-400'}`}>
                                        {balance >= cartTotal(char.shopCart) ? `帮 TA 清空购物车（代付 ¥${formatPrice(cartTotal(char.shopCart))}）` : '余额不足以代付'}
                                    </button>
                                </div>
                            )}
                            <ReceiptList list={charReceipts} empty={`${char?.name || 'TA'} 还没有购物记录，邀请 TA 逛逛吧`} />
                        </>
                    )}
                </>
            )}
        </div>
    );
};

const ReceiptList: React.FC<{ list: ReturnType<typeof makeReceipt>[]; empty: string; }> = ({ list, empty }) => {
    if (list.length === 0) return <div className="text-center text-[#b89a8c] text-xs pt-16">{empty}</div>;
    return (
        <div className="space-y-2">
            {list.map(r => (
                <div key={r.id} className="rounded-xl bg-white/80 px-3 py-2.5 flex items-center gap-2.5 border border-rose-50">
                    <span className="text-[22px] shrink-0">{r.emoji}</span>
                    <div className="flex-1 min-w-0">
                        <div className="text-[12.5px] text-[#5a3a2e] leading-snug">{receiptLine(r)}</div>
                        <div className="text-[10px] text-[#b89a8c] mt-0.5">¥{formatPrice(r.price)} · {new Date(r.at).toLocaleString()}</div>
                    </div>
                </div>
            ))}
        </div>
    );
};

export default ShopApp;
