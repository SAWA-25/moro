import React, { useEffect, useMemo, useState } from 'react';
import { useOS } from '../context/OSContext';
import { ArrowLeft, MagnifyingGlass, Storefront, Star, Minus, Plus, Receipt, MapPin, ChatCircleDots, ArrowClockwise, CheckCircle, Bicycle, Warning, Wallet, Sparkle, ShieldWarning, SealCheck, HandCoins } from '@phosphor-icons/react';
import { TakeoutStore, TakeoutOrder, TakeoutOrderItem, TakeoutChatMsg } from '../types';
import { DB } from '../utils/db';
import { resolveAuxApi } from '../utils/auxApi';
import {
    generateStores, generateStoresAI, liveTakeoutStatus, STATUS_LABEL, etaText, newRider, PACK_FEE,
    buildDeliveryReply, postTakeoutPlacedToChat, postTakeoutDeliveredToChat, postTakeoutIssueToChat,
    rollOrderIssues, resolveComplaint, incidentsSummary, hasOpenIssues,
    isTakeoutArrived, consumeTakeoutIntent, notifyTakeoutUpdated,
    generateStoreReviews, reviewQuickTags, generateReviewReplies, type StoreNpcReview,
} from '../utils/takeout';
import { TakeoutReview } from '../types';

/**
 * 外卖 App（参考美团）。店铺 AI 现搓 / 本地兜底，可进店点菜下单；订单可看配送进度、和骑手/商家/平台客服聊天；
 * 付款按钱包余额实扣（adjustUserBalance），支持自己付 / 找角色代付；店家有好有坏（黑心商家会缺斤少两/图文不符/
 * 强制砍单），骑手也有好有坏（超时/撒漏/偷吃/不送上门）—— 翻车后可一键投诉，平台核定后把赔付退回钱包。
 */

const Y = '#FFD161';      // 顶栏黄
const O = '#FF5339';      // 主橙红
const genId = (p: string) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
const ADDR_KEY = 'moro_takeout_address';
const CATS = ['全部', '中餐', '快餐', '早餐', '西餐', '麻辣烫', '奶茶饮品', '甜品烘焙', '日韩料理', '火锅烧烤', '夜宵', '轻食沙拉'];

type View = 'home' | 'store' | 'checkout' | 'orders' | 'detail';
type ChatTarget = 'rider' | 'store' | 'support';

const TakeoutApp: React.FC = () => {
    const { closeApp, characters, userProfile, apiConfig, auxApiConfig, addToast, adjustUserBalance } = useOS();
    const api = resolveAuxApi(auxApiConfig, apiConfig);
    const aiReady = !!(api.baseUrl && api.model);
    const nameOf = (id: string) => characters.find(c => c.id === id)?.name || '';
    const wallet = Math.round((userProfile.balance || 0) * 100) / 100;

    const [view, setView] = useState<View>('home');
    const [stores, setStores] = useState<TakeoutStore[]>(() => generateStores(12));
    const [aiLoading, setAiLoading] = useState(false);
    const [cat, setCat] = useState('全部');
    const [query, setQuery] = useState('');
    const [activeStore, setActiveStore] = useState<TakeoutStore | null>(null);
    const [cart, setCart] = useState<Record<string, number>>({});
    const [orders, setOrders] = useState<TakeoutOrder[]>([]);
    const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
    const [now, setNow] = useState(Date.now());

    // 结算配置
    const [recipient, setRecipient] = useState('me');
    const [payer, setPayer] = useState('me');
    // 从聊天回形针「点外卖」进来时预设的收货角色（一次性）
    const [intentCharId, setIntentCharId] = useState<string | null>(null);
    const [address, setAddress] = useState(() => { try { return localStorage.getItem(ADDR_KEY) || '城南花园 3 栋 502'; } catch { return '城南花园 3 栋 502'; } });
    const [note, setNote] = useState('');

    // 骑手 / 商家 / 平台客服聊天
    const [chatTarget, setChatTarget] = useState<ChatTarget>('rider');
    const [chatInput, setChatInput] = useState('');
    const [chatBusy, setChatBusy] = useState(false);

    // 评价
    const [reviewing, setReviewing] = useState(false);      // 评价弹窗开
    const [reviewRating, setReviewRating] = useState(5);
    const [reviewTags, setReviewTags] = useState<string[]>([]);
    const [reviewText, setReviewText] = useState('');
    // 店铺 NPC 评价（按店名稳定生成）
    const storeReviews = useMemo<StoreNpcReview[]>(() => activeStore ? generateStoreReviews(activeStore.name, activeStore.rating) : [], [activeStore]);

    const reloadOrders = async () => setOrders(await DB.getTakeoutOrders().catch(() => []));
    useEffect(() => { void reloadOrders(); }, []);
    useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(t); }, []);
    // 聊天回形针「点外卖」带来的下单意图：预设收货角色，提示用户在选店点菜后直接结算。
    useEffect(() => {
        const intent = consumeTakeoutIntent();
        if (intent?.recipientCharId && characters.some(c => c.id === intent.recipientCharId)) {
            setIntentCharId(intent.recipientCharId);
            setRecipient(intent.recipientCharId);
        }
    }, [characters]);

    // 进店前先让 AI 现搓一批店铺（配了副 API / 主 API 才走，否则保留本地兜底）。
    const loadStoresAI = async () => {
        if (!aiReady || aiLoading) return;
        setAiLoading(true);
        try {
            const next = await generateStoresAI(api, 12);
            setStores(next);
        } catch { /* 失败保留现有 */ } finally { setAiLoading(false); }
    };
    useEffect(() => { if (aiReady) void loadStoresAI(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

    const activeOrder = orders.find(o => o.id === activeOrderId) || null;

    // ── 派生 ──
    const filteredStores = useMemo(() => stores.filter(s =>
        (cat === '全部' || s.category === cat) &&
        (!query.trim() || s.name.includes(query.trim()) || s.dishes.some(d => d.name.includes(query.trim())))
    ), [stores, cat, query]);

    const cartItems = useMemo((): TakeoutOrderItem[] => {
        if (!activeStore) return [];
        return Object.entries(cart).filter(([, q]) => q > 0).map(([dishId, qty]) => {
            const d = activeStore.dishes.find(x => x.id === dishId)!;
            return { dishId, name: d.name, price: d.price, qty, emoji: d.emoji };
        });
    }, [cart, activeStore]);
    const cartSubtotal = cartItems.reduce((s, i) => s + i.price * i.qty, 0);
    const cartCount = cartItems.reduce((s, i) => s + i.qty, 0);

    // ── 操作 ──
    const refresh = () => {
        if (aiReady) { void loadStoresAI(); addToast('AI 正在现搓一批新店…', 'info'); }
        else { setStores(generateStores(12)); addToast('换了一批店～', 'info'); }
    };
    const openStore = (s: TakeoutStore) => { setActiveStore(s); setCart({}); setView('store'); };
    const setQty = (dishId: string, delta: number) => setCart(prev => ({ ...prev, [dishId]: Math.max(0, (prev[dishId] || 0) + delta) }));

    const goCheckout = () => {
        if (!activeStore) return;
        if (cartSubtotal < activeStore.minOrder) { addToast(`还差 ¥${activeStore.minOrder - cartSubtotal} 起送`, 'info'); return; }
        // 从聊天「点外卖」进来时，默认收货人就是那个角色；否则默认送给自己。
        setRecipient(intentCharId || 'me'); setPayer('me'); setNote('');
        setView('checkout');
    };

    const placeOrder = async () => {
        if (!activeStore || cartItems.length === 0) return;
        const total = cartSubtotal + activeStore.deliveryFee + PACK_FEE;
        const payByMe = payer === 'me';
        // 扣款按钱包余额：自己付且余额不足直接拦下
        if (payByMe && wallet < total) { addToast(`钱包余额不足（¥${wallet} / 应付 ¥${total}）`, 'error'); return; }
        try { localStorage.setItem(ADDR_KEY, address); } catch { /* ignore */ }

        const rider = newRider();
        const placedAt = Date.now();
        const charId = recipient !== 'me' ? recipient : (payer !== 'me' ? payer : undefined);
        const roll = rollOrderIssues(activeStore, cartItems, cartSubtotal, activeStore.deliveryFee);

        // 实扣钱包
        if (payByMe) adjustUserBalance(-total);

        const base: TakeoutOrder = {
            id: genId('order'),
            storeId: activeStore.id, storeName: activeStore.name, storeEmoji: activeStore.emoji,
            items: cartItems,
            subtotal: cartSubtotal, deliveryFee: activeStore.deliveryFee, packFee: PACK_FEE,
            total,
            recipient, payer, charId,
            payStatus: 'paid',
            status: 'preparing',
            riderName: rider.name, riderEmoji: rider.emoji,
            riderReliability: roll.riderReliability,
            address: recipient !== 'me' ? `送给 ${nameOf(recipient)}` : address,
            note: note.trim() || undefined,
            placedAt, etaAt: placedAt + activeStore.deliveryMinutes * 60000,
            chat: [], chatTarget: 'rider',
            initiatedBy: 'user',
            cardPosted: !!charId,
        };

        let order: TakeoutOrder;
        if (roll.forceCancel) {
            // 黑心店收了钱迟迟不接单 → 强制砍单 + 原路退款
            if (payByMe) adjustUserBalance(total);
            order = {
                ...base,
                status: 'cancelled',
                cancelledByStore: true,
                chat: [{ role: 'support', text: `「${activeStore.name}」长时间未接单，系统已自动取消并原路退款 ¥${total}。`, at: Date.now() } as TakeoutChatMsg],
                chatTarget: 'support',
                complaint: { filed: true, resolved: true, outcome: `商家长时间未接单，订单自动取消并原路退款 ¥${payByMe ? total : 0}。`, refunded: payByMe ? total : 0 },
            };
        } else {
            order = { ...base, incidents: roll.incidents };
        }

        await DB.saveTakeoutOrder(order);
        if (order.charId) {
            try { order.cancelledByStore ? await postTakeoutIssueToChat(order) : await postTakeoutPlacedToChat(order, nameOf); } catch { /* ignore */ }
        }
        notifyTakeoutUpdated();
        await reloadOrders();
        setActiveOrderId(order.id);
        setChatTarget(order.cancelledByStore ? 'support' : 'rider');
        setIntentCharId(null);
        setCart({});
        setView('detail');
        if (order.cancelledByStore) addToast('商家迟迟未接单，已自动退款 🙄', 'info');
        else addToast(payByMe ? '下单成功，骑手马上接单🛵' : `已下单，已通知 ${nameOf(payer)} 代付`, 'success');
    };

    const sendChat = async () => {
        const text = chatInput.trim();
        if (!text || !activeOrder || chatBusy) return;
        setChatInput('');
        const withUser: TakeoutChatMsg[] = [...activeOrder.chat, { role: 'user', text, at: Date.now() }];
        const updated = { ...activeOrder, chat: withUser, chatTarget };
        await DB.saveTakeoutOrder(updated);
        await reloadOrders();
        setChatBusy(true);
        try {
            const reply = await buildDeliveryReply(api, updated, chatTarget, withUser, text);
            const next = { ...updated, chat: [...withUser, { role: chatTarget, text: reply, at: Date.now() } as TakeoutChatMsg] };
            await DB.saveTakeoutOrder(next);
            await reloadOrders();
        } finally { setChatBusy(false); }
    };

    const notifyDelivered = async (order: TakeoutOrder) => {
        const done = { ...order, status: 'delivered' as const, deliveredAt: Date.now() };
        await DB.saveTakeoutOrder(done);
        if (order.charId) { try { await postTakeoutDeliveredToChat(done); } catch { /* ignore */ } }
        notifyTakeoutUpdated();
        await reloadOrders();
        addToast('已确认收货～', 'success');
    };

    // 一键投诉：平台核定赔付 → 退回钱包（自己付才退到自己钱包），并补两条客服消息
    const fileComplaint = async (order: TakeoutOrder) => {
        if (!hasOpenIssues(order)) return;
        const { refund, outcome, supportMessages } = resolveComplaint(order);
        const credited = order.payer === 'me' ? refund : 0;
        if (credited > 0) adjustUserBalance(credited);
        const next: TakeoutOrder = {
            ...order,
            chat: [...order.chat, ...supportMessages],
            chatTarget: 'support',
            complaint: { filed: true, resolved: true, outcome, refunded: refund },
        };
        await DB.saveTakeoutOrder(next);
        if (order.charId) { try { await postTakeoutIssueToChat(order); } catch { /* ignore */ } }
        await reloadOrders();
        setChatTarget('support');
        addToast(credited > 0 ? `平台已赔付 ¥${credited} 到钱包` : (refund > 0 ? `已为 ${nameOf(order.payer)} 退回 ¥${refund}` : '已提交投诉，平台会跟进'), credited > 0 ? 'success' : 'info');
    };

    const openReview = (order: TakeoutOrder) => {
        setReviewRating(order.review?.rating || 5);
        setReviewTags(order.review?.tags || []);
        setReviewText(order.review?.text || '');
        setReviewing(true);
    };

    const submitReview = async () => {
        if (!activeOrder) return;
        const review: TakeoutReview = {
            rating: reviewRating,
            tags: reviewTags,
            text: reviewText.trim() || undefined,
            at: Date.now(),
            likes: Math.floor(Math.random() * 6),
            replies: generateReviewReplies(reviewRating, reviewText.trim(), activeOrder.storeName),
        };
        await DB.saveTakeoutOrder({ ...activeOrder, review });
        notifyTakeoutUpdated();
        await reloadOrders();
        setReviewing(false);
        addToast('评价成功，感谢反馈～', 'success');
    };

    const toggleReviewTag = (t: string) => setReviewTags(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);

    const recipientOptions = [{ id: 'me', label: '我自己' }, ...characters.map(c => ({ id: c.id, label: c.name }))];

    // ════════════════ 渲染 ════════════════
    const Stars = ({ n, size = 12 }: { n: number; size?: number }) => (
        <span className="inline-flex items-center gap-0.5">
            {[1, 2, 3, 4, 5].map(i => <Star key={i} size={size} weight="fill" color={i <= Math.round(n) ? '#ff9500' : '#e2e2e2'} />)}
        </span>
    );
    const topBar = (title: string, onBack: () => void, right?: React.ReactNode) => (
        <div className="shrink-0 flex items-center justify-between px-3 py-2.5" style={{ background: Y, paddingTop: 'calc(var(--safe-top) + 8px)' }}>
            <button onClick={onBack} className="w-8 h-8 flex items-center justify-center rounded-full bg-black/5 active:scale-90 transition"><ArrowLeft size={18} weight="bold" color="#4a3000" /></button>
            <span className="text-[15px] font-black" style={{ color: '#4a3000' }}>{title}</span>
            <div className="w-8 h-8 flex items-center justify-center">{right}</div>
        </div>
    );

    const walletChip = (
        <div className="flex items-center gap-1 text-[12px] font-black px-2 py-1 rounded-full bg-black/5" style={{ color: '#4a3000' }} title="钱包余额">
            <Wallet size={13} weight="fill" />¥{wallet}
        </div>
    );

    // —— 首页 ——
    if (view === 'home') {
        return (
            <div className="absolute inset-0 flex flex-col bg-[#f5f5f5] animate-fade-in overflow-hidden">
                <div className="shrink-0 px-3 pb-3" style={{ background: `linear-gradient(180deg, ${Y}, #FFE39A)`, paddingTop: 'calc(var(--safe-top) + 10px)' }}>
                    <div className="flex items-center justify-between gap-2">
                        <button onClick={closeApp} className="w-8 h-8 shrink-0 flex items-center justify-center rounded-full bg-black/5 active:scale-90 transition"><ArrowLeft size={18} weight="bold" color="#4a3000" /></button>
                        <div className="flex items-center gap-1 text-[13px] font-bold min-w-0" style={{ color: '#4a3000' }}>
                            <MapPin size={15} weight="fill" /><span className="truncate max-w-[120px]">{address}</span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                            {walletChip}
                            <button onClick={() => setView('orders')} className="w-8 h-8 flex items-center justify-center rounded-full bg-black/5 active:scale-90 transition" title="我的订单"><Receipt size={18} weight="bold" color="#4a3000" /></button>
                        </div>
                    </div>
                    <div className="mt-2.5 flex items-center gap-2 bg-white rounded-full px-3 py-2 shadow-sm">
                        <MagnifyingGlass size={16} color="#999" />
                        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜店铺 / 搜菜品" className="flex-1 min-w-0 bg-transparent text-[13px] outline-none placeholder:text-slate-300" />
                        <button onClick={refresh} disabled={aiLoading} className="text-[12px] font-bold flex items-center gap-1 disabled:opacity-50" style={{ color: O }}>
                            {aiLoading ? <><Sparkle size={14} weight="fill" className="animate-pulse" />现搓中…</> : <><ArrowClockwise size={14} weight="bold" />{aiReady ? 'AI现搓' : '换一批'}</>}
                        </button>
                    </div>
                </div>
                {/* 分类 */}
                <div className="shrink-0 flex gap-2 overflow-x-auto no-scrollbar px-3 py-2.5 bg-white border-b border-slate-100">
                    {CATS.map(c => (
                        <button key={c} onClick={() => setCat(c)} className="shrink-0 px-3 py-1.5 rounded-full text-[12px] font-bold transition active:scale-95" style={cat === c ? { background: O, color: '#fff' } : { background: '#f3f3f3', color: '#666' }}>{c}</button>
                    ))}
                </div>
                {/* 店铺列表 */}
                <div className="flex-1 overflow-y-auto no-scrollbar px-3 py-2 space-y-2.5">
                    {aiLoading && stores.length === 0 && <div className="text-center text-[12px] text-slate-400 py-10 flex items-center justify-center gap-1.5"><Sparkle size={16} weight="fill" className="animate-pulse" />AI 正在现搓店铺…</div>}
                    {filteredStores.length === 0 && !aiLoading && <div className="text-center text-[12px] text-slate-400 py-10">没有匹配的店铺，换个词或点「{aiReady ? 'AI现搓' : '换一批'}」。</div>}
                    {filteredStores.map(s => (
                        <button key={s.id} onClick={() => openStore(s)} className="w-full text-left bg-white rounded-2xl p-3 flex gap-3 shadow-sm active:scale-[0.99] transition">
                            <div className="w-16 h-16 rounded-xl flex items-center justify-center text-[34px] shrink-0" style={{ background: '#fff6e6' }}>{s.emoji}</div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                    <span className="text-[14px] font-black text-slate-800 truncate">{s.name}</span>
                                    {s.aiGenerated && <Sparkle size={12} weight="fill" className="shrink-0" color="#c084fc" />}
                                </div>
                                <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-500">
                                    <span className="flex items-center gap-0.5" style={{ color: '#ff9500' }}><Star size={11} weight="fill" />{s.rating}</span>
                                    <span>月售{s.monthlySales}</span>
                                    <span>·</span><span>{s.distanceKm}km</span>
                                </div>
                                <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-500">
                                    <span className="flex items-center gap-0.5"><Bicycle size={12} weight="fill" color={O} />{s.deliveryMinutes}分钟</span>
                                    <span>{s.deliveryFee === 0 ? '免配送费' : `配送¥${s.deliveryFee}`}</span>
                                    <span>起送¥{s.minOrder}</span>
                                </div>
                                <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                                    {s.promo && <span className="inline-block text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: '#fff0ec', color: O }}>🎫 {s.promo}</span>}
                                    {s.warning && <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: '#fff4e5', color: '#c2410c' }}><Warning size={11} weight="fill" />{s.warning}</span>}
                                </div>
                            </div>
                        </button>
                    ))}
                    <div className="h-2" />
                </div>
            </div>
        );
    }

    // —— 店铺详情 / 点菜 ——
    if (view === 'store' && activeStore) {
        return (
            <div className="absolute inset-0 flex flex-col bg-[#f5f5f5] animate-fade-in overflow-hidden">
                {topBar(activeStore.name, () => setView('home'), walletChip)}
                <div className="shrink-0 bg-white px-4 py-3 flex items-center gap-3 border-b border-slate-100">
                    <div className="w-14 h-14 rounded-xl flex items-center justify-center text-[30px]" style={{ background: '#fff6e6' }}>{activeStore.emoji}</div>
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                            <span className="text-[15px] font-black text-slate-800 truncate">{activeStore.name}</span>
                            {activeStore.aiGenerated && <Sparkle size={12} weight="fill" className="shrink-0" color="#c084fc" />}
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-2">
                            <span className="flex items-center gap-0.5" style={{ color: '#ff9500' }}><Star size={11} weight="fill" />{activeStore.rating}</span>
                            <span>月售{activeStore.monthlySales} · {activeStore.deliveryMinutes}分钟 · {activeStore.distanceKm}km</span>
                        </div>
                        {activeStore.blurb && <div className="text-[11px] text-slate-400 mt-0.5 truncate">{activeStore.blurb}</div>}
                        <div className="flex flex-wrap items-center gap-1.5 mt-1">
                            {activeStore.promo && <span className="inline-block text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: '#fff0ec', color: O }}>🎫 {activeStore.promo}</span>}
                            {activeStore.warning && <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: '#fff4e5', color: '#c2410c' }}><Warning size={11} weight="fill" />{activeStore.warning}</span>}
                        </div>
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto no-scrollbar px-3 py-2 space-y-2">
                    {activeStore.dishes.map(d => (
                        <div key={d.id} className="bg-white rounded-xl p-3 flex gap-3 items-center">
                            <div className="w-14 h-14 rounded-lg flex items-center justify-center text-[26px] shrink-0" style={{ background: '#faf7f2' }}>{d.emoji || '🍽️'}</div>
                            <div className="flex-1 min-w-0">
                                <div className="text-[13.5px] font-bold text-slate-800 truncate">{d.name}{d.popular && <span className="ml-1 text-[9px] px-1 py-0.5 rounded" style={{ background: '#fff0ec', color: O }}>招牌</span>}</div>
                                {d.desc && <div className="text-[11px] text-slate-400 mt-0.5 truncate">{d.desc}</div>}
                                <div className="text-[14px] font-black mt-1" style={{ color: O }}>¥{d.price}</div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                                {(cart[d.id] || 0) > 0 && <>
                                    <button onClick={() => setQty(d.id, -1)} className="w-6 h-6 rounded-full border flex items-center justify-center active:scale-90" style={{ borderColor: O, color: O }}><Minus size={13} weight="bold" /></button>
                                    <span className="text-[13px] font-bold w-4 text-center">{cart[d.id]}</span>
                                </>}
                                <button onClick={() => setQty(d.id, 1)} className="w-6 h-6 rounded-full flex items-center justify-center text-white active:scale-90" style={{ background: O }}><Plus size={13} weight="bold" /></button>
                            </div>
                        </div>
                    ))}

                    {/* 大家的评价（NPC 评论） */}
                    <div className="bg-white rounded-xl p-3.5 mt-1">
                        <div className="flex items-center justify-between mb-2.5">
                            <span className="text-[13px] font-black text-slate-800">大家的评价</span>
                            <span className="flex items-center gap-1 text-[12px] font-bold" style={{ color: '#ff9500' }}><Stars n={activeStore.rating} />{activeStore.rating}</span>
                        </div>
                        <div className="space-y-3">
                            {storeReviews.slice(0, 6).map(r => (
                                <div key={r.id} className="flex gap-2.5">
                                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-[18px] shrink-0" style={{ background: '#faf7f2' }}>{r.emoji}</div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between">
                                            <span className="text-[12px] font-bold text-slate-700 truncate">{r.name}</span>
                                            <span className="text-[10px] text-slate-300">{r.date}</span>
                                        </div>
                                        <Stars n={r.rating} size={10} />
                                        <div className="text-[12px] text-slate-600 mt-0.5 leading-snug">{r.text}</div>
                                        {r.reply && <div className="mt-1 text-[11px] text-slate-500 bg-[#faf7f2] rounded-lg px-2 py-1.5">🏪 商家回复：{r.reply}</div>}
                                        <div className="text-[10px] text-slate-300 mt-1">👍 {r.likes}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                    <div className="h-20" />
                </div>
                {/* 购物车条 */}
                <div className="shrink-0 px-3 py-2.5 bg-white border-t border-slate-100 flex items-center gap-3" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 10px)' }}>
                    <div className="relative w-12 h-12 rounded-full flex items-center justify-center text-[24px]" style={{ background: cartCount ? O : '#ddd' }}>
                        🛒
                        {cartCount > 0 && <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-white text-[10px] font-black flex items-center justify-center" style={{ color: O, border: `1px solid ${O}` }}>{cartCount}</span>}
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="text-[16px] font-black text-slate-800">¥{cartSubtotal}</div>
                        <div className="text-[10px] text-slate-400">另需配送¥{activeStore.deliveryFee} · 打包¥{PACK_FEE}</div>
                    </div>
                    <button onClick={goCheckout} disabled={cartCount === 0} className="px-6 py-2.5 rounded-full text-[14px] font-black text-white active:scale-95 transition disabled:opacity-50" style={{ background: O }}>
                        {cartSubtotal < activeStore.minOrder ? `差¥${Math.max(0, activeStore.minOrder - cartSubtotal)}起送` : '去结算'}
                    </button>
                </div>
            </div>
        );
    }

    // —— 结算 ——
    if (view === 'checkout' && activeStore) {
        const total = cartSubtotal + activeStore.deliveryFee + PACK_FEE;
        const payByMe = payer === 'me';
        const notEnough = payByMe && wallet < total;
        return (
            <div className="absolute inset-0 flex flex-col bg-[#f5f5f5] animate-fade-in overflow-hidden">
                {topBar('确认订单', () => setView('store'))}
                <div className="flex-1 overflow-y-auto no-scrollbar p-3 space-y-3">
                    {/* 送给谁 */}
                    <div className="bg-white rounded-2xl p-3.5">
                        <div className="text-[12px] font-bold text-slate-700 mb-2">送给谁</div>
                        <div className="flex flex-wrap gap-2">
                            {recipientOptions.map(o => (
                                <button key={o.id} onClick={() => setRecipient(o.id)} className="px-3 py-1.5 rounded-full text-[12px] font-bold transition active:scale-95" style={recipient === o.id ? { background: O, color: '#fff' } : { background: '#f3f3f3', color: '#666' }}>{o.id === 'me' ? '🙋 我自己' : `🎁 ${o.label}`}</button>
                            ))}
                        </div>
                        <div className="mt-3 flex items-center gap-2">
                            <MapPin size={15} color={O} weight="fill" />
                            {recipient === 'me'
                                ? <input value={address} onChange={e => setAddress(e.target.value)} className="flex-1 bg-[#faf7f2] rounded-lg px-2.5 py-2 text-[12.5px] outline-none" placeholder="收货地址" />
                                : <span className="text-[12.5px] text-slate-500">送到 {nameOf(recipient)} 那里</span>}
                        </div>
                    </div>
                    {/* 付款方式 */}
                    <div className="bg-white rounded-2xl p-3.5">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-[12px] font-bold text-slate-700">谁来付</span>
                            <span className="text-[11px] font-bold flex items-center gap-1" style={{ color: notEnough ? '#dc2626' : '#16a34a' }}><Wallet size={12} weight="fill" />钱包 ¥{wallet}</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <button onClick={() => setPayer('me')} className="px-3 py-1.5 rounded-full text-[12px] font-bold transition active:scale-95" style={payer === 'me' ? { background: O, color: '#fff' } : { background: '#f3f3f3', color: '#666' }}>💳 我自己付</button>
                            {characters.map(c => (
                                <button key={c.id} onClick={() => setPayer(c.id)} className="px-3 py-1.5 rounded-full text-[12px] font-bold transition active:scale-95" style={payer === c.id ? { background: O, color: '#fff' } : { background: '#f3f3f3', color: '#666' }}>🤝 {c.name}代付</button>
                            ))}
                        </div>
                        {payByMe && notEnough && <div className="text-[11px] font-bold text-red-500 mt-2 flex items-center gap-1"><Warning size={12} weight="fill" />余额不足，还差 ¥{Math.round((total - wallet) * 100) / 100}，可让角色代付或先去赚点钱。</div>}
                        {!payByMe && <div className="text-[11px] text-slate-400 mt-2">将给 {nameOf(payer)} 发一条代付提醒（在来往里），不扣你的钱包。</div>}
                    </div>
                    {/* 菜品清单 */}
                    <div className="bg-white rounded-2xl p-3.5">
                        <div className="flex items-center gap-2 mb-2"><span className="text-[20px]">{activeStore.emoji}</span><span className="text-[13px] font-black text-slate-800">{activeStore.name}</span></div>
                        {cartItems.map(i => (
                            <div key={i.dishId} className="flex items-center justify-between py-1 text-[12.5px]">
                                <span className="text-slate-600">{i.emoji} {i.name} ×{i.qty}</span>
                                <span className="text-slate-700 font-bold">¥{i.price * i.qty}</span>
                            </div>
                        ))}
                        <div className="border-t border-dashed border-slate-200 mt-2 pt-2 space-y-1 text-[12px] text-slate-500">
                            <div className="flex justify-between"><span>配送费</span><span>¥{activeStore.deliveryFee}</span></div>
                            <div className="flex justify-between"><span>打包费</span><span>¥{PACK_FEE}</span></div>
                        </div>
                        <input value={note} onChange={e => setNote(e.target.value)} placeholder="备注：口味、餐具、放门口…" className="mt-2 w-full bg-[#faf7f2] rounded-lg px-2.5 py-2 text-[12px] outline-none" />
                    </div>
                    <div className="h-16" />
                </div>
                <div className="shrink-0 px-3 py-2.5 bg-white border-t border-slate-100 flex items-center gap-3" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 10px)' }}>
                    <div className="flex-1"><span className="text-[12px] text-slate-500">合计 </span><span className="text-[18px] font-black" style={{ color: O }}>¥{total}</span></div>
                    <button onClick={() => void placeOrder()} disabled={notEnough} className="px-7 py-3 rounded-full text-[14px] font-black text-white active:scale-95 transition disabled:opacity-50" style={{ background: O }}>
                        {payByMe ? `支付 ¥${total}` : '发起代付'}
                    </button>
                </div>
            </div>
        );
    }

    // —— 订单列表 ——
    if (view === 'orders') {
        return (
            <div className="absolute inset-0 flex flex-col bg-[#f5f5f5] animate-fade-in overflow-hidden">
                {topBar('我的订单', () => setView('home'), walletChip)}
                <div className="flex-1 overflow-y-auto no-scrollbar p-3 space-y-2.5">
                    {orders.length === 0 && <div className="text-center text-[12px] text-slate-400 py-12">还没有订单，去点一单吧～</div>}
                    {orders.map(o => {
                        const st = liveTakeoutStatus(o, now);
                        const issues = st === 'delivered' || st === 'arrived' || st === 'cancelled' ? incidentsSummary(o) : '';
                        const open = hasOpenIssues(o);
                        return (
                            <button key={o.id} onClick={() => { setActiveOrderId(o.id); setChatTarget(o.chatTarget || 'rider'); setView('detail'); }} className="w-full text-left bg-white rounded-2xl p-3 active:scale-[0.99] transition">
                                <div className="flex items-center justify-between">
                                    <span className="text-[13px] font-black text-slate-800 truncate">{o.storeEmoji} {o.storeName}</span>
                                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={st === 'delivered' ? { background: '#eef7ee', color: '#3a9d52' } : st === 'cancelled' ? { background: '#fdecec', color: '#dc2626' } : st === 'arrived' ? { background: '#fff7e6', color: '#c47d12' } : { background: '#fff0ec', color: O }}>{o.cancelledByStore ? '商家砍单' : STATUS_LABEL[st]}</span>
                                </div>
                                <div className="text-[11.5px] text-slate-500 mt-1 truncate">{o.items.map(i => `${i.name}×${i.qty}`).join('、')}</div>
                                {(issues || o.complaint?.refunded) ? (
                                    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                                        {issues && open && <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: '#fff4e5', color: '#c2410c' }}><ShieldWarning size={11} weight="fill" />{issues} · 可投诉</span>}
                                        {issues && !open && o.complaint?.resolved && <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: '#eef7ee', color: '#3a9d52' }}><SealCheck size={11} weight="fill" />已处理</span>}
                                        {!!o.complaint?.refunded && <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: '#eef2ff', color: '#4f46e5' }}><HandCoins size={11} weight="fill" />退¥{o.complaint.refunded}</span>}
                                    </div>
                                ) : null}
                                <div className="flex items-center justify-between mt-1.5">
                                    <span className="text-[10.5px] text-slate-400">{o.recipient !== 'me' ? `送给 ${nameOf(o.recipient)}` : '送给我'}{o.payer !== 'me' ? ` · ${nameOf(o.payer)}代付` : ''}</span>
                                    <span className="text-[13px] font-black" style={{ color: O }}>¥{o.total}</span>
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>
        );
    }

    // —— 订单详情 ——
    if (view === 'detail' && activeOrder) {
        const o = activeOrder;
        const st = liveTakeoutStatus(o, now);
        const steps: { key: string; label: string }[] = [
            { key: 'preparing', label: '商家备餐' }, { key: 'delivering', label: '骑手配送' }, { key: 'delivered', label: '已送达' },
        ];
        const stepIdx = (st === 'delivered' || st === 'arrived') ? 2 : st === 'delivering' ? 1 : 0;
        const arrived = st === 'arrived';
        const showIssues = (st === 'delivered' || st === 'arrived' || st === 'cancelled') && (o.incidents || []).length > 0;
        const targets: { id: ChatTarget; label: string }[] = [
            { id: 'rider', label: `${o.riderEmoji} 联系骑手` }, { id: 'store', label: '🏪 联系商家' }, { id: 'support', label: '🛡️ 平台客服' },
        ];
        return (
            <div className="absolute inset-0 flex flex-col bg-[#f5f5f5] animate-fade-in overflow-hidden">
                {topBar('订单详情', () => setView('orders'), walletChip)}
                <div className="flex-1 overflow-y-auto no-scrollbar p-3 space-y-3">
                    {/* 进度 / 砍单 */}
                    {o.cancelledByStore ? (
                        <div className="rounded-2xl p-4 text-white" style={{ background: 'linear-gradient(135deg, #ef4444, #b91c1c)' }}>
                            <div className="text-[16px] font-black flex items-center gap-1.5"><ShieldWarning size={18} weight="fill" />商家强制砍单</div>
                            <div className="text-[11.5px] opacity-90 mt-1">「{o.storeName}」收了钱迟迟不接单，系统已自动取消并原路退款 ¥{o.complaint?.refunded ?? 0}。下次避开这种黑店吧。</div>
                        </div>
                    ) : (
                        <div className="rounded-2xl p-4 text-white" style={{ background: `linear-gradient(135deg, ${O}, #ff8a5c)` }}>
                            <div className="text-[17px] font-black">{etaText(o, now)}</div>
                            <div className="text-[11.5px] opacity-90 mt-0.5">{st === 'delivered' ? '希望你/TA吃得开心～' : arrived ? '外卖已经到了，记得确认收货' : `${o.riderEmoji} ${o.riderName} 正在为你奔波`}</div>
                            <div className="flex items-center gap-1 mt-3">
                                {steps.map((s, i) => (
                                    <React.Fragment key={s.key}>
                                        <div className="flex flex-col items-center gap-1">
                                            <div className="w-6 h-6 rounded-full flex items-center justify-center text-[12px]" style={{ background: i <= stepIdx ? '#fff' : 'rgba(255,255,255,0.35)', color: O }}>{i < stepIdx || st === 'delivered' ? '✓' : i === stepIdx ? '•' : ''}</div>
                                            <span className="text-[9px] opacity-90">{s.label}</span>
                                        </div>
                                        {i < steps.length - 1 && <div className="flex-1 h-0.5 rounded" style={{ background: i < stepIdx ? '#fff' : 'rgba(255,255,255,0.35)' }} />}
                                    </React.Fragment>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* 事故 / 投诉 */}
                    {showIssues && (
                        <div className="bg-white rounded-2xl p-3.5 border border-orange-100">
                            <div className="flex items-center gap-1.5 text-[13px] font-black text-orange-700 mb-2"><ShieldWarning size={16} weight="fill" />这单出了点状况</div>
                            <div className="space-y-2">
                                {(o.incidents || []).map((inc, i) => (
                                    <div key={i} className="flex gap-2">
                                        <span className="text-[11px] font-bold px-1.5 py-0.5 rounded shrink-0 h-fit" style={{ background: inc.by === 'store' ? '#fff0ec' : '#eef2ff', color: inc.by === 'store' ? O : '#4f46e5' }}>{inc.by === 'store' ? '商家' : '骑手'}·{inc.title}</span>
                                        <span className="text-[11.5px] text-slate-500 leading-snug">{inc.detail}</span>
                                    </div>
                                ))}
                            </div>
                            {o.complaint?.resolved ? (
                                <div className="mt-3 text-[11.5px] font-bold flex items-start gap-1.5 p-2.5 rounded-xl" style={{ background: '#eef7ee', color: '#3a9d52' }}><SealCheck size={14} weight="fill" className="mt-0.5 shrink-0" />{o.complaint.outcome}</div>
                            ) : (
                                <button onClick={() => void fileComplaint(o)} className="mt-3 w-full py-2.5 rounded-xl text-[13px] font-black text-white active:scale-[0.98] transition flex items-center justify-center gap-1.5" style={{ background: '#ea580c' }}>
                                    <HandCoins size={16} weight="fill" />一键投诉 · 申请退款
                                </button>
                            )}
                        </div>
                    )}

                    {/* 骑手 / 商家 / 平台客服 + 聊天 */}
                    <div className="bg-white rounded-2xl p-3.5">
                        <div className="flex gap-2 mb-2">
                            {targets.map(t => (
                                <button key={t.id} onClick={() => setChatTarget(t.id)} className="px-3 py-1.5 rounded-full text-[12px] font-bold transition active:scale-95" style={chatTarget === t.id ? { background: O, color: '#fff' } : { background: '#f3f3f3', color: '#666' }}>
                                    {t.label}
                                </button>
                            ))}
                        </div>
                        <div className="bg-[#faf7f2] rounded-xl p-2.5 max-h-44 overflow-y-auto no-scrollbar space-y-2">
                            {o.chat.filter(m => m.role === 'user' || m.role === chatTarget).length === 0 && (
                                <div className="text-[11px] text-slate-400 text-center py-3 flex items-center justify-center gap-1"><ChatCircleDots size={14} />给{chatTarget === 'rider' ? '骑手' : chatTarget === 'store' ? '商家' : '平台客服'}发条消息试试</div>
                            )}
                            {o.chat.filter(m => m.role === 'user' || m.role === chatTarget).map((m, i) => (
                                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                    <span className="max-w-[78%] px-3 py-1.5 rounded-2xl text-[12.5px] leading-snug" style={m.role === 'user' ? { background: O, color: '#fff' } : { background: '#fff', color: '#333', border: '1px solid #eee' }}>{m.text}</span>
                                </div>
                            ))}
                            {chatBusy && <div className="text-[11px] text-slate-400 pl-1">对方正在输入…</div>}
                        </div>
                        <div className="flex items-center gap-2 mt-2">
                            <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void sendChat(); }} placeholder={`和${chatTarget === 'rider' ? '骑手' : chatTarget === 'store' ? '商家' : '平台客服'}说点什么…`} className="flex-1 bg-[#faf7f2] rounded-full px-3 py-2 text-[12.5px] outline-none" disabled={chatBusy} />
                            <button onClick={() => void sendChat()} disabled={chatBusy || !chatInput.trim()} className="px-4 py-2 rounded-full text-[12px] font-bold text-white active:scale-95 transition disabled:opacity-50" style={{ background: O }}>发送</button>
                        </div>
                    </div>

                    {/* 订单信息 */}
                    <div className="bg-white rounded-2xl p-3.5">
                        <div className="flex items-center gap-2 mb-2"><span className="text-[20px]">{o.storeEmoji}</span><span className="text-[13px] font-black text-slate-800">{o.storeName}</span></div>
                        {o.items.map(i => (
                            <div key={i.dishId} className="flex items-center justify-between py-0.5 text-[12.5px]">
                                <span className="text-slate-600">{i.emoji} {i.name} ×{i.qty}</span>
                                <span className="text-slate-700 font-bold">¥{i.price * i.qty}</span>
                            </div>
                        ))}
                        <div className="border-t border-dashed border-slate-200 mt-2 pt-2 text-[12px] text-slate-500 space-y-1">
                            <div className="flex justify-between"><span>配送 / 打包</span><span>¥{o.deliveryFee + o.packFee}</span></div>
                            <div className="flex justify-between text-slate-800 font-black text-[13px]"><span>实付</span><span style={{ color: O }}>¥{o.total}</span></div>
                            {!!o.complaint?.refunded && <div className="flex justify-between font-bold" style={{ color: '#4f46e5' }}><span>已退款</span><span>-¥{o.complaint.refunded}</span></div>}
                            <div className="flex justify-between"><span>收货</span><span>{o.recipient !== 'me' ? nameOf(o.recipient) : o.address}</span></div>
                            <div className="flex justify-between"><span>付款</span><span>{o.payer !== 'me' ? `${nameOf(o.payer)}代付` : '我自己付'} · {o.cancelledByStore ? '已退款' : '已支付'}</span></div>
                            {o.note && <div className="flex justify-between"><span>备注</span><span className="text-right max-w-[60%] truncate">{o.note}</span></div>}
                        </div>
                    </div>

                    {/* 评价（送达后，仅自己那份可评） */}
                    {st === 'delivered' && o.recipient === 'me' && (
                        <div className="bg-white rounded-2xl p-3.5">
                            <div className="text-[13px] font-black text-slate-800 mb-2">我的评价</div>
                            {o.review ? (
                                <div>
                                    <div className="flex items-center gap-2">
                                        <Stars n={o.review.rating} />
                                        <button onClick={() => openReview(o)} className="ml-auto text-[11px] font-bold" style={{ color: O }}>修改</button>
                                    </div>
                                    {o.review.tags && o.review.tags.length > 0 && (
                                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                                            {o.review.tags.map(t => <span key={t} className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: '#fff0ec', color: O }}>{t}</span>)}
                                        </div>
                                    )}
                                    {o.review.text && <div className="text-[12.5px] text-slate-600 mt-1.5 leading-snug">{o.review.text}</div>}
                                    {o.review.replies && o.review.replies.length > 0 && (
                                        <div className="mt-2.5 space-y-1.5 border-t border-dashed border-slate-100 pt-2">
                                            {o.review.replies.map((rp, i) => (
                                                <div key={i} className="text-[11.5px] leading-snug">
                                                    <span className="font-bold text-slate-700">{rp.emoji} {rp.name}{rp.isMerchant ? '（商家）' : ''}：</span>
                                                    <span className="text-slate-500">{rp.text}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <button onClick={() => openReview(o)} className="w-full py-2.5 rounded-xl text-[13px] font-black active:scale-[0.98] transition" style={{ background: '#fff0ec', color: O }}>
                                    ⭐ 评价此单
                                </button>
                            )}
                        </div>
                    )}

                    {/* 收货按钮：收到货（到点）才能确认；给角色点的单由 TA 自己签收并回应。砍单/取消则不显示。 */}
                    {st !== 'delivered' && st !== 'cancelled' && o.recipient !== 'me' && (
                        <div className="w-full py-3 rounded-2xl text-[12.5px] font-bold text-center" style={{ background: '#f3f3f3', color: '#888' }}>
                            {arrived ? `已送到 ${nameOf(o.recipient)} 那儿，TA 收到后会在聊天里回应你～` : `送到后 ${nameOf(o.recipient)} 会签收，并在聊天里回应你`}
                        </div>
                    )}
                    {st !== 'delivered' && st !== 'cancelled' && o.recipient === 'me' && (
                        arrived ? (
                            <button onClick={() => void notifyDelivered(o)} className="w-full py-3 rounded-2xl text-[13px] font-black active:scale-[0.98] transition flex items-center justify-center gap-1.5" style={{ background: '#eef7ee', color: '#3a9d52' }}>
                                <CheckCircle size={16} weight="fill" /> 确认收货
                            </button>
                        ) : (
                            <div className="w-full py-3 rounded-2xl text-[12.5px] font-bold text-center flex items-center justify-center gap-1.5" style={{ background: '#f3f3f3', color: '#aaa' }}>
                                <CheckCircle size={15} /> 送达后才能确认收货 · {etaText(o, now)}
                            </div>
                        )
                    )}
                    <div className="h-3" />
                </div>

                {/* 评价弹窗 */}
                {reviewing && (
                    <div className="absolute inset-0 z-[60] flex items-end justify-center bg-black/40 animate-fade-in" onClick={() => setReviewing(false)}>
                        <div className="w-full bg-white rounded-t-3xl p-5" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 16px)' }} onClick={e => e.stopPropagation()}>
                            <div className="text-center text-[15px] font-black text-slate-800 mb-1">评价「{o.storeName}」</div>
                            <div className="text-center text-[11px] text-slate-400 mb-3">{o.items.map(i => i.name).join('、')}</div>
                            {/* 星级 */}
                            <div className="flex items-center justify-center gap-2 mb-3">
                                {[1, 2, 3, 4, 5].map(i => (
                                    <button key={i} onClick={() => { setReviewRating(i); setReviewTags([]); }} className="active:scale-90 transition">
                                        <Star size={32} weight="fill" color={i <= reviewRating ? '#ff9500' : '#e2e2e2'} />
                                    </button>
                                ))}
                            </div>
                            <div className="text-center text-[12px] font-bold text-slate-500 mb-3">{['', '很差', '一般', '还行', '满意', '超赞'][reviewRating]}</div>
                            {/* 快捷标签 */}
                            <div className="flex flex-wrap gap-2 justify-center mb-3">
                                {reviewQuickTags(reviewRating).map(t => (
                                    <button key={t} onClick={() => toggleReviewTag(t)} className="px-3 py-1.5 rounded-full text-[12px] font-bold transition active:scale-95" style={reviewTags.includes(t) ? { background: O, color: '#fff' } : { background: '#f3f3f3', color: '#666' }}>{t}</button>
                                ))}
                            </div>
                            <textarea value={reviewText} onChange={e => setReviewText(e.target.value)} rows={3} placeholder="说说这次的体验吧～（选填）" className="w-full bg-[#faf7f2] rounded-2xl px-3 py-2.5 text-[13px] outline-none resize-none mb-3" />
                            <div className="flex gap-2.5">
                                <button onClick={() => setReviewing(false)} className="flex-1 py-3 rounded-2xl text-[14px] font-bold bg-slate-100 text-slate-600 active:scale-[0.98] transition">取消</button>
                                <button onClick={() => void submitReview()} className="flex-1 py-3 rounded-2xl text-[14px] font-black text-white active:scale-[0.98] transition" style={{ background: O }}>发布评价</button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    // 兜底
    return (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#f5f5f5]">
            <Storefront size={40} color={O} />
            <button onClick={() => setView('home')} className="mt-3 px-4 py-2 rounded-full text-white text-[13px] font-bold" style={{ background: O }}>回外卖首页</button>
        </div>
    );
};

export default TakeoutApp;
