import React, { useEffect, useMemo, useState } from 'react';
import { useOS } from '../context/OSContext';
import {
    MagnifyingGlass, Star, Minus, Plus, Receipt, MapPin, ArrowClockwise, CheckCircle, Bicycle,
    Warning, Sparkle, ShieldWarning, SealCheck, HandCoins, Coins, PushPin, Shuffle, CookingPot,
    PaperPlaneRight, Storefront, Repeat, NotePencil, Package, ChatCircleDots,
} from '@phosphor-icons/react';
import { TakeoutStore, TakeoutOrder, TakeoutOrderItem, TakeoutChatMsg, TakeoutReview } from '../types';
import { DB } from '../utils/db';
import { resolveAuxApi } from '../utils/auxApi';
import {
    generateStores, generateStoresAI, liveTakeoutStatus, STATUS_LABEL, etaText, newRider, PACK_FEE,
    buildDeliveryReply, postTakeoutPlacedToChat, postTakeoutDeliveredToChat, postTakeoutIssueToChat,
    rollOrderIssues, resolveComplaint, incidentsSummary, hasOpenIssues,
    consumeTakeoutIntent, notifyTakeoutUpdated,
    generateStoreReviews, generateStoreReviewsAI, reviewQuickTags, generateReviewReplies,
    getPinnedStores, togglePinnedStore, type StoreNpcReview,
    sortStores, filterStores, storePromoDiscount, bestRedpacket, TAKEOUT_REDPACKETS,
    recommendStores, groupDishes, type StoreSort, type StoreFilter,
} from '../utils/takeout';
import {
    PaperShell, ScrapScroll, ScrapHeader, PaperCard, WashiTape, Stamp, ScrapButton, StickyNote,
    SectionTag, DashedRule, PaperSheet, Polaroid, HALFTONE, TAPE_STRIPES, WASHI, INK, INK_SOFT, PAPER,
} from './theater/scrapbook';

/**
 * 「饭票」（原「外卖」）—— 黑白拼贴手账皮肤的吃食铺子。
 * ──────────────────────────────────────────────────────────────
 * 一整本米白报纸做的「饭票簿」：撕一张饭票点吃的，跑腿把热乎送到门口，盖个签收章收下。
 * 完全重写界面与文案（店名/按键/位置/口吻全部原创为手账口吻），但不改、不减任何原功能：
 *   现搓店铺(AI/本地) · 进铺点菜 · 撕票下单 · 配送进度 · 跟跑腿/铺子/平台对话 ·
 *   自付/代付(钱包实扣) · 黑心铺子&坏跑腿事故 · 一键申诉退款 · 食评 + NPC 留言。
 * 新增：抽张饭票(随机) · 钉常去的铺子 · 照着再撕一张(再来一单) · 备注快捷条 · 给跑腿塞小费。
 * 视觉积木复用 theater/scrapbook（黑白拼贴手账统一套件）；食物 emoji 一律去色成灰阶。
 */

const genId = (p: string) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
const ADDR_KEY = 'moro_takeout_address';
const CATS = ['全部', '中餐', '快餐', '早餐', '西餐', '麻辣烫', '奶茶饮品', '甜品烘焙', '日韩料理', '火锅烧烤', '夜宵', '轻食沙拉'];
const NOTE_CHIPS = ['少辣', '多放饭', '多给餐具', '不要香菜', '放门口别敲门', '微辣多醋', '打包结实点', '调料另放'];
const TIP_CHOICES = [0, 2, 5, 8];
const STAR_WORDS = ['', '难吃', '一般', '还行', '满意', '绝了'];

type View = 'home' | 'store' | 'checkout' | 'orders' | 'detail';
type ChatTarget = 'rider' | 'store' | 'support';

const paperInput: React.CSSProperties = {
    background: 'rgba(255,253,247,0.9)', color: '#36322b',
    border: '1px solid rgba(176,170,158,0.7)', outline: '1px dashed rgba(150,144,132,0.4)', outlineOffset: -4,
};

// 是否是可作 <img> 的头像（URL/data），否则当 emoji 文字
const isImg = (s?: string) => !!s && /^(https?:|data:|blob:)/.test(s);

// ── 食物 emoji（彩色，像贴在黑白手账上的彩色小贴纸 / 拍立得）──
const Emo: React.FC<{ e?: string; size?: number; className?: string }> = ({ e = '🍽️', size = 22, className = '' }) => (
    <span className={className} aria-hidden style={{ fontSize: size, lineHeight: 1, display: 'inline-block' }}>{e}</span>
);

// ── 墨色星星（评分）──
const Stars: React.FC<{ n: number; size?: number }> = ({ n, size = 12 }) => (
    <span className="inline-flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map(i => <Star key={i} size={size} weight="fill" color={i <= Math.round(n) ? INK : 'rgba(31,29,26,0.16)'} />)}
    </span>
);

// ── 纸面切换芯片（墨底=选中 / 纸底=未选）──
const ChoiceChip: React.FC<{ on?: boolean; onClick?: () => void; children: React.ReactNode; icon?: React.ReactNode; className?: string; title?: string }> = ({ on, onClick, children, icon, className = '', title }) => (
    <button onClick={onClick} title={title} className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-[7px] text-[12px] font-bold shrink-0 active:scale-95 transition-transform ${className}`}
        style={on
            ? { background: INK, color: PAPER, boxShadow: '0 7px 14px -9px rgba(31,29,26,0.65)' }
            : { background: 'rgba(255,253,247,0.92)', color: '#5a554c', border: '1px solid rgba(176,170,158,0.7)' }}>
        {icon}{children}
    </button>
);

// ── 门脸：去色 emoji 装进小纸框（店铺/菜品 logo）──
const Shopfront: React.FC<{ e?: string; size?: number; box?: number }> = ({ e, size = 30, box = 56 }) => (
    <div className="shrink-0 flex items-center justify-center" style={{ width: box, height: box, borderRadius: 10, background: '#efeae0', border: '1px solid rgba(176,170,158,0.7)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.6)' }}>
        <Emo e={e} size={size} />
    </div>
);

const TAKEOUT_BANNERS = [
    { t: '准时达 · 慢必赔', s: '超时有补偿，安心点', g: 'linear-gradient(120deg,#ffd24d,#ffb300)' },
    { t: '神券天天领', s: '满20减3起，结算自动用最优', g: 'linear-gradient(120deg,#ff7a45,#fa541c)' },
    { t: 'AI 现写一条街', s: '点「现写一条街」，每次都是新铺子', g: 'linear-gradient(120deg,#36322b,#6b5b4a)' },
    { t: '免配送费专区', s: '筛选「免配送费」，省到就是赚到', g: 'linear-gradient(120deg,#52c41a,#389e0d)' },
];
const TakeoutBanner: React.FC = () => {
    const [i, setI] = useState(0);
    useEffect(() => { const t = setInterval(() => setI(x => (x + 1) % TAKEOUT_BANNERS.length), 3500); return () => clearInterval(t); }, []);
    const b = TAKEOUT_BANNERS[i];
    return (
        <div className="rounded-[10px] overflow-hidden relative h-[64px]" style={{ background: b.g }}>
            <div className="absolute inset-0 px-3.5 flex flex-col justify-center text-white">
                <div className="text-[14px] font-black drop-shadow-sm">{b.t}</div>
                <div className="text-[10px] opacity-90 mt-0.5">{b.s}</div>
            </div>
            <div className="absolute bottom-1.5 right-2.5 flex gap-1">
                {TAKEOUT_BANNERS.map((_, k) => <span key={k} className={`w-1.5 h-1.5 rounded-full ${k === i ? 'bg-white' : 'bg-white/40'}`} />)}
            </div>
        </div>
    );
};

const TakeoutApp: React.FC = () => {
    const { closeApp, characters, userProfile, updateUserProfile, apiConfig, auxApiConfig, addToast, adjustUserBalance } = useOS();
    const api = resolveAuxApi(auxApiConfig, apiConfig);
    const aiReady = !!(api.baseUrl && api.model);
    const nameOf = (id: string) => characters.find(c => c.id === id)?.name || '';
    const wallet = Math.round((userProfile.balance || 0) * 100) / 100;

    const [view, setView] = useState<View>('home');
    // 店铺缓存：进 App 先用上次实时生成的那条街（避免空白/本地占位闪一下），没有才本地占位
    const STORES_CACHE_KEY = 'moro_takeout_stores_v1';
    const [stores, setStores] = useState<TakeoutStore[]>(() => {
        try {
            const cached = JSON.parse(localStorage.getItem(STORES_CACHE_KEY) || 'null');
            if (Array.isArray(cached) && cached.length) return cached;
        } catch { /* ignore */ }
        return generateStores(20);
    });
    const [aiLoading, setAiLoading] = useState(false);
    const [cat, setCat] = useState('全部');
    const [query, setQuery] = useState('');
    const [activeStore, setActiveStore] = useState<TakeoutStore | null>(null);
    const [cart, setCart] = useState<Record<string, number>>({});
    const [orders, setOrders] = useState<TakeoutOrder[]>([]);
    const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
    const [now, setNow] = useState(Date.now());
    const [pinned, setPinned] = useState<string[]>(() => getPinnedStores());

    // 结算配置
    const [recipient, setRecipient] = useState('me');
    const [payer, setPayer] = useState('me');
    const [intentCharId, setIntentCharId] = useState<string | null>(null);
    const [address, setAddress] = useState(() => { try { return localStorage.getItem(ADDR_KEY) || '城南花园 3 栋 502'; } catch { return '城南花园 3 栋 502'; } });
    const [note, setNote] = useState('');
    const [tip, setTip] = useState(0);

    // 跟跑腿 / 铺子 / 平台对话
    const [chatTarget, setChatTarget] = useState<ChatTarget>('rider');
    const [chatInput, setChatInput] = useState('');
    const [chatBusy, setChatBusy] = useState(false);

    // 食评
    const [reviewing, setReviewing] = useState(false);
    const [reviewRating, setReviewRating] = useState(5);
    const [reviewTags, setReviewTags] = useState<string[]>([]);
    const [reviewText, setReviewText] = useState('');
    // 食评：进店实时 AI 生成（仿真有好有坏，按店铺评分调好坏比例）；加载时先用算法版垫场，失败回退算法版
    const [storeReviews, setStoreReviews] = useState<StoreNpcReview[]>([]);
    const [reviewsLoading, setReviewsLoading] = useState(false);
    useEffect(() => {
        if (!activeStore) { setStoreReviews([]); return; }
        let alive = true;
        setStoreReviews(generateStoreReviews(activeStore.name, activeStore.rating)); // 垫场
        if (aiReady) {
            setReviewsLoading(true);
            generateStoreReviewsAI(api, activeStore, 8)
                .then(rv => { if (alive) setStoreReviews(rv); })
                .catch(() => { /* 已垫场 */ })
                .finally(() => { if (alive) setReviewsLoading(false); });
        }
        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeStore?.id]);

    const reloadOrders = async () => setOrders(await DB.getTakeoutOrders().catch(() => []));
    useEffect(() => { void reloadOrders(); }, []);
    useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(t); }, []);
    useEffect(() => {
        const intent = consumeTakeoutIntent();
        if (intent?.recipientCharId && characters.some(c => c.id === intent.recipientCharId)) {
            setIntentCharId(intent.recipientCharId);
            setRecipient(intent.recipientCharId);
        }
    }, [characters]);

    const loadStoresAI = async (q?: string) => {
        if (!aiReady || aiLoading) return;
        setAiLoading(true);
        try {
            const next = await generateStoresAI(api, 20, q); // 每批至少 20 家，实时生成（q 时紧扣搜索词）
            setStores(next);
            try { localStorage.setItem(STORES_CACHE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
        } catch { /* 失败保留现有 */ } finally { setAiLoading(false); }
    };

    // 搜索栏实时生成：按搜索词现搜一批相关店铺（生成后清掉文字过滤，直接展示这批结果）
    const searchGen = async () => {
        const q = query.trim();
        if (!q) return;
        if (!aiReady) { addToast('配好副 API 才能现搜哦', 'info'); return; }
        addToast(`正在为「${q}」现搜全城…`, 'info');
        await loadStoresAI(q);
        setQuery(''); setCat('全部'); setFilter({});
    };
    // 进 App：没有缓存才实时生成一批（有缓存就先看缓存，点「换一条街」再现写）
    useEffect(() => {
        const hasCache = (() => { try { return !!JSON.parse(localStorage.getItem(STORES_CACHE_KEY) || 'null')?.length; } catch { return false; } })();
        if (aiReady && !hasCache) void loadStoresAI();
        /* eslint-disable-next-line react-hooks/exhaustive-deps */
    }, []);

    const activeOrder = orders.find(o => o.id === activeOrderId) || null;

    // 美团式：排序 / 筛选 / 平台红包
    const [sort, setSort] = useState<StoreSort>('recommend');
    const [filter, setFilter] = useState<StoreFilter>({});
    const claimedRedpackets = userProfile.takeoutRedpackets || [];
    const claimRedpacket = (id: string) => {
        if (claimedRedpackets.includes(id)) { addToast('已领过这张红包', 'info'); return; }
        updateUserProfile({ takeoutRedpackets: [id, ...claimedRedpackets] });
        addToast('平台红包已领取 🧧', 'success');
    };

    // ── 派生 ──
    const filteredStores = useMemo(() => {
        const base = stores.filter(s =>
            (cat === '全部' || s.category === cat) &&
            (!query.trim() || s.name.includes(query.trim()) || s.dishes.some(d => d.name.includes(query.trim()))));
        return sortStores(filterStores(base, filter), sort);
    }, [stores, cat, query, filter, sort]);
    const recommended = useMemo(() => recommendStores(stores, 6), [stores]);

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
        if (aiReady) { void loadStoresAI(); addToast('正在现写一条街…', 'info'); }
        else { const s = generateStores(20); setStores(s); try { localStorage.setItem(STORES_CACHE_KEY, JSON.stringify(s)); } catch { /* ignore */ } addToast('翻到另一条街啦～', 'info'); }
    };
    const openStore = (s: TakeoutStore) => { setActiveStore(s); setCart({}); setView('store'); };
    const setQty = (dishId: string, delta: number) => setCart(prev => ({ ...prev, [dishId]: Math.max(0, (prev[dishId] || 0) + delta) }));

    // 抽张饭票：命运替你翻一家进去
    const randomPick = () => {
        const pool = filteredStores.length ? filteredStores : stores;
        if (!pool.length) return;
        const s = pool[Math.floor(Math.random() * pool.length)];
        addToast(`命运替你翻到了「${s.name}」`, 'info');
        openStore(s);
    };

    // 钉 / 取常去的铺子
    const togglePin = (name: string) => {
        const next = togglePinnedStore(name);
        setPinned(next);
        addToast(next.includes(name) ? '钉住啦，下回好找～' : '从墙上取下了', 'info');
    };
    const openPinned = (name: string) => {
        const s = stores.find(x => x.name === name);
        if (s) openStore(s);
        else { setQuery(name); setCat('全部'); addToast('这条街上暂没这家，帮你搜搜看', 'info'); }
    };

    const addNoteChip = (t: string) => setNote(prev => prev.includes(t) ? prev : (prev ? `${prev}；${t}` : t));

    const goCheckout = () => {
        if (!activeStore) return;
        if (cartSubtotal < activeStore.minOrder) { addToast(`再凑 ¥${activeStore.minOrder - cartSubtotal} 就能起送`, 'info'); return; }
        setRecipient(intentCharId || 'me'); setPayer('me'); setNote(''); setTip(0);
        setView('checkout');
    };

    // 照着再撕一张：用旧票重建一个临时铺子 + 菜篮，直接进结算
    const reorder = (o: TakeoutOrder) => {
        const mins = Math.max(15, Math.round((o.etaAt - o.placedAt) / 60000)) || 30;
        const pseudo: TakeoutStore = {
            id: o.storeId, name: o.storeName, emoji: o.storeEmoji, category: '中餐',
            rating: 4.6, monthlySales: 0, deliveryMinutes: mins, deliveryFee: o.deliveryFee,
            minOrder: 0, distanceKm: 1, integrity: 0.85,
            dishes: o.items.map(i => ({ id: i.dishId, name: i.name, price: i.price, emoji: i.emoji, popular: false })),
        };
        setActiveStore(pseudo);
        setCart(Object.fromEntries(o.items.map(i => [i.dishId, i.qty])));
        const keepRecipient = o.recipient === 'me' || characters.some(c => c.id === o.recipient) ? o.recipient : 'me';
        setRecipient(keepRecipient); setPayer('me'); setNote(o.note || ''); setTip(0);
        addToast('照着又撕了一张，核对下就能下单～', 'info');
        setView('checkout');
    };

    // 满减 + 平台红包 抵扣（按当前购物车小计）
    const promoDisc = activeStore ? storePromoDiscount(activeStore.promo, cartSubtotal) : 0;
    const bestRp = bestRedpacket(claimedRedpackets, cartSubtotal);
    const orderDiscount = Math.min(cartSubtotal, promoDisc + (bestRp?.discount || 0));

    const placeOrder = async () => {
        if (!activeStore || cartItems.length === 0) return;
        const total = Math.max(0, cartSubtotal + activeStore.deliveryFee + PACK_FEE + tip - orderDiscount);
        const payByMe = payer === 'me';
        if (payByMe && wallet < total) { addToast(`饭钱不够：钱包 ¥${wallet} / 这张票要 ¥${total}`, 'error'); return; }
        try { localStorage.setItem(ADDR_KEY, address); } catch { /* ignore */ }

        const rider = newRider();
        const placedAt = Date.now();
        const charId = recipient !== 'me' ? recipient : (payer !== 'me' ? payer : undefined);
        const roll = rollOrderIssues(activeStore, cartItems, cartSubtotal, activeStore.deliveryFee);

        if (payByMe) adjustUserBalance(-total);

        const base: TakeoutOrder = {
            id: genId('order'),
            storeId: activeStore.id, storeName: activeStore.name, storeEmoji: activeStore.emoji,
            items: cartItems,
            subtotal: cartSubtotal, deliveryFee: activeStore.deliveryFee, packFee: PACK_FEE,
            tip: tip || undefined,
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
            if (payByMe) adjustUserBalance(total);
            order = {
                ...base,
                status: 'cancelled',
                cancelledByStore: true,
                chat: [{ role: 'support', text: `「${activeStore.name}」长时间未接单，平台已替你作废这张饭票并原路退款 ¥${total}。`, at: Date.now() } as TakeoutChatMsg],
                chatTarget: 'support',
                complaint: { filed: true, resolved: true, outcome: `铺子长时间不接单，饭票作废、原路退回 ¥${payByMe ? total : 0}。`, refunded: payByMe ? total : 0 },
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
        if (order.cancelledByStore) addToast('铺子迟迟不接单，已替你作废退款 🙄', 'info');
        else addToast(payByMe ? '票撕好了，跑腿这就去取餐 🛵' : `票开好了，已捎话请 ${nameOf(payer)} 付`, 'success');
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
        addToast('签收章盖好啦，趁热吃～', 'success');
    };

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
        addToast(credited > 0 ? `平台判赔 ¥${credited}，已退回饭钱袋` : (refund > 0 ? `已为 ${nameOf(order.payer)} 退回 ¥${refund}` : '申诉条递上去了，平台会跟进'), credited > 0 ? 'success' : 'info');
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
        addToast('食评贴上墙啦，谢谢你的滋味～', 'success');
    };

    const toggleReviewTag = (t: string) => setReviewTags(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);

    const recipientOptions = [{ id: 'me', label: '我自己', avatar: userProfile.avatar }, ...characters.map(c => ({ id: c.id, label: c.name, avatar: c.avatar }))];

    // ── 钱袋纸签 ──
    const walletChip = (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[6px] text-[12px] font-black" style={{ background: '#efeae0', color: INK, border: '1px solid rgba(176,170,158,0.7)' }} title="饭钱">
            <Coins size={13} weight="fill" />¥{wallet}
        </span>
    );
    // 选人拍立得（送给谁 / 谁来付 共用）
    const personPolaroid = (o: { id: string; label: string; avatar?: string }, on: boolean, onClick: () => void) => (
        <Polaroid
            key={o.id}
            src={isImg(o.avatar) ? o.avatar : undefined}
            fallback={<Emo e={isImg(o.avatar) ? '🙂' : (o.avatar || '🙂')} size={24} />}
            caption={o.label}
            selected={on}
            onClick={onClick}
            size={48}
            grayscale={false}
        />
    );

    // ════════════════════════ 首页·饭票簿 ════════════════════════
    if (view === 'home') {
        return (
            <PaperShell key="home">
                <ScrapHeader
                    title="饭票" en="MEAL TICKET" onBack={closeApp} backLabel="回桌面"
                    right={<button onClick={() => setView('orders')} className="relative inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-black active:scale-95 transition-transform" style={{ color: '#36322b' }} title="票根夹">
                        <span aria-hidden className="absolute inset-0 rounded-[6px]" style={{ backgroundColor: WASHI.amber.base, backgroundImage: TAPE_STRIPES, transform: 'rotate(2deg)' }} />
                        <span className="relative z-10 flex items-center gap-1"><Receipt size={13} weight="bold" />票根夹</span>
                    </button>}
                />

                {/* 地址 + 钱袋 */}
                <div className="relative z-10 px-5 flex items-center justify-between gap-2">
                    <StickyNote color="butter" rotate={-1.5} className="px-2.5 py-1 flex items-center gap-1 min-w-0">
                        <MapPin size={13} weight="fill" />
                        <span className="text-[8px] tracking-[0.2em]" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>送到</span>
                        <span className="text-[11.5px] font-bold truncate max-w-[150px]" style={{ color: '#3a362f' }}>{address}</span>
                    </StickyNote>
                    {walletChip}
                </div>

                {/* 搜索 + 现写 + 抽饭票 */}
                <div className="relative z-10 px-5 pt-2.5">
                    <div className="flex items-center gap-2 px-3 py-2 rounded-[10px]" style={paperInput}>
                        <MagnifyingGlass size={15} color={INK_SOFT} />
                        <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && query.trim()) void searchGen(); }} placeholder="搜店名/菜品/药品…回车现搜全城" className="flex-1 min-w-0 bg-transparent text-[12.5px] outline-none" style={{ color: '#36322b' }} />
                        <button onClick={refresh} disabled={aiLoading} className="text-[11px] font-black flex items-center gap-1 disabled:opacity-50" style={{ color: INK }}>
                            {aiLoading ? <><Sparkle size={13} weight="fill" className="animate-pulse" />现写中…</> : <><ArrowClockwise size={13} weight="bold" />{aiReady ? '现写一条街' : '另逛一条街'}</>}
                        </button>
                    </div>
                    {/* 搜索栏实时生成：按搜索词现搜一批相关店铺 */}
                    {query.trim() && aiReady && (
                        <button onClick={() => void searchGen()} disabled={aiLoading} className="mt-2 w-full inline-flex items-center justify-center gap-1.5 py-2 rounded-[10px] text-[12px] font-black active:scale-[0.98] transition-transform disabled:opacity-50" style={{ background: '#d2452f', color: '#fff', boxShadow: '0 10px 18px -12px rgba(210,69,47,0.7)' }}>
                            <MagnifyingGlass size={14} weight="bold" />为「{query.trim()}」现搜全城相关的店
                        </button>
                    )}
                    <button onClick={randomPick} className="mt-2.5 w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-[10px] text-[13px] font-black active:scale-[0.98] transition-transform" style={{ background: INK, color: PAPER, outline: '1px dashed rgba(255,255,255,0.32)', outlineOffset: -4, boxShadow: '0 12px 22px -14px rgba(31,29,26,0.6)' }}>
                        <Shuffle size={16} weight="bold" />抽张饭票 · 替我拿主意
                    </button>
                </div>

                {/* banner 轮播 + 平台红包·领券 */}
                <div className="relative z-10 px-5 pt-3 space-y-2">
                    <TakeoutBanner />
                    <div className="rounded-[10px] px-3 py-2" style={{ background: 'linear-gradient(120deg,#ffe9e3,#fff6f2)', border: '1px dashed rgba(210,69,47,0.4)' }}>
                        <div className="flex items-center gap-1 text-[10px] font-black mb-1.5" style={{ color: '#d2452f' }}>🧧 平台红包 · 结算自动用最优</div>
                        <div className="flex gap-2 overflow-x-auto no-scrollbar">
                            {TAKEOUT_REDPACKETS.map(r => {
                                const got = claimedRedpackets.includes(r.id);
                                return (
                                    <div key={r.id} className="shrink-0 flex items-center gap-1.5 rounded-[8px] bg-white px-2 py-1" style={{ border: '1px solid rgba(210,69,47,0.25)' }}>
                                        <div className="leading-tight"><div className="text-[13px] font-black" style={{ color: '#d2452f' }}>¥{r.discount}</div><div className="text-[8px]" style={{ color: INK_SOFT }}>满{r.threshold}</div></div>
                                        <button onClick={() => claimRedpacket(r.id)} disabled={got} className="px-2 py-0.5 rounded-full text-[9px] font-bold active:scale-95 transition-transform" style={got ? { background: '#f3ece6', color: '#b0a99e' } : { background: '#d2452f', color: '#fff' }}>{got ? '已领' : '领'}</button>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {/* 钉在墙上的常去铺子 */}
                {pinned.length > 0 && (
                    <div className="relative z-10 px-5 pt-3">
                        <div className="text-[8.5px] tracking-[0.3em] mb-1.5 flex items-center gap-1" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}><PushPin size={10} weight="fill" />钉在墙上 · USUAL HAUNTS</div>
                        <div className="flex gap-2 overflow-x-auto no-scrollbar">
                            {pinned.map(n => (
                                <button key={n} onClick={() => openPinned(n)} className="shrink-0 px-2.5 py-1 rounded-[6px] text-[11px] font-bold active:scale-95 transition-transform" style={{ background: 'rgba(255,253,247,0.92)', color: '#5a554c', border: '1px solid rgba(176,170,158,0.7)' }}>📌 {n}</button>
                            ))}
                        </div>
                    </div>
                )}

                {/* 品类纸标签 */}
                <div className="relative z-10 shrink-0 flex gap-2 overflow-x-auto no-scrollbar px-5 pt-3 pb-1">
                    {CATS.map(c => (
                        <ChoiceChip key={c} on={cat === c} onClick={() => setCat(c)}>{c === '全部' ? '不挑食' : c}</ChoiceChip>
                    ))}
                </div>

                {/* 美团式：排序 + 筛选 */}
                <div className="relative z-10 shrink-0 flex items-center gap-1.5 overflow-x-auto no-scrollbar px-5 pt-1.5 pb-0.5">
                    {(([['recommend', '综合'], ['sales', '销量'], ['rating', '评分'], ['distance', '距离'], ['delivery', '最快']]) as [StoreSort, string][]).map(([k, label]) => (
                        <button key={k} onClick={() => setSort(k)} className="shrink-0 px-2.5 py-1 rounded-[6px] text-[11px] font-bold active:scale-95 transition-transform"
                            style={sort === k ? { background: INK, color: PAPER } : { background: 'rgba(255,253,247,0.92)', color: '#5a554c', border: '1px solid rgba(176,170,158,0.6)' }}>{label}</button>
                    ))}
                    <span className="shrink-0 w-px h-4" style={{ background: 'rgba(176,170,158,0.5)' }} />
                    {(([['freeDelivery', '免配送费'], ['zeroMinOrder', '0起送'], ['promoOnly', '有优惠'], ['goodOnly', '4.5+']]) as [keyof StoreFilter, string][]).map(([k, label]) => {
                        const on = !!filter[k];
                        return (
                            <button key={k} onClick={() => setFilter(f => ({ ...f, [k]: !f[k] }))} className="shrink-0 px-2.5 py-1 rounded-[6px] text-[11px] font-bold active:scale-95 transition-transform"
                                style={on ? { background: '#d2452f', color: '#fff' } : { background: 'rgba(255,253,247,0.92)', color: '#5a554c', border: '1px solid rgba(176,170,158,0.6)' }}>{label}</button>
                        );
                    })}
                </div>

                {/* 铺子列表 */}
                <ScrapScroll className="px-5 pt-2 pb-10">
                    <SectionTag en="THE STREET" className="mb-3">这条街上的铺子</SectionTag>
                    {aiLoading && stores.length === 0 && <div className="text-center text-[12px] py-12 flex items-center justify-center gap-1.5" style={{ color: INK_SOFT }}><Sparkle size={16} weight="fill" className="animate-pulse" />正在一笔笔现写这条街…</div>}
                    {filteredStores.length === 0 && !aiLoading && (
                        <div className="text-center text-[12px] py-12" style={{ color: INK_SOFT }}>
                            {query.trim()
                                ? <>没找着「{query.trim()}」，{aiReady ? <button onClick={() => void searchGen()} className="font-black underline" style={{ color: '#d2452f' }}>现搜全城</button> : '换个词试试'}。</>
                                : <>这条街上没找着，换个词或点「{aiReady ? '现写一条街' : '另逛一条街'}」。</>}
                        </div>
                    )}
                    <div className="space-y-3.5">
                        {filteredStores.map((s, i) => {
                            const tape = (['amber', 'sage', 'lilac', 'butter'] as const)[i % 4];
                            return (
                                <PaperCard key={s.id} tilt={i % 2 === 0 ? -0.6 : 0.5} tape={i % 3 === 0 ? tape : null} onClick={() => openStore(s)} className="px-3.5 py-3.5">
                                    <div className="flex gap-3.5">
                                        <Shopfront e={s.emoji} size={32} box={58} />
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-1.5">
                                                <span className="text-[15px] font-black truncate" style={{ color: INK }}>{s.name}</span>
                                                {s.aiGenerated && <WashiTape color="ink" rotate={-4} className="px-1 py-px text-[7px] tracking-[0.2em] rounded-[2px]" style={{ fontFamily: 'var(--font-label)' }}>现写</WashiTape>}
                                            </div>
                                            <div className="flex items-center gap-2 mt-1 text-[11px]" style={{ color: '#6b665c' }}>
                                                <span className="flex items-center gap-0.5"><Stars n={s.rating} size={10} /><b style={{ color: INK }}>{s.rating}</b></span>
                                                <span>卖出 {s.monthlySales}</span>
                                                <span>·</span><span>{s.distanceKm}km</span>
                                            </div>
                                            <div className="flex items-center gap-2 mt-1 text-[11px]" style={{ color: '#6b665c' }}>
                                                <span className="flex items-center gap-0.5"><Bicycle size={12} weight="fill" />{s.deliveryMinutes}分到手</span>
                                                <span>{s.deliveryFee === 0 ? '免跑腿费' : `跑腿¥${s.deliveryFee}`}</span>
                                                <span>{s.minOrder ? `够¥${s.minOrder}起送` : '无门槛'}</span>
                                            </div>
                                            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                                                {s.promo && <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-[4px]" style={{ background: '#e9e4d9', color: '#3a362f', border: '1px dashed rgba(150,144,132,0.7)' }}>票面优惠 · {s.promo}</span>}
                                                {s.warning && <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-[4px]" style={{ background: INK, color: PAPER }}><Warning size={11} weight="fill" />街坊提醒 · {s.warning}</span>}
                                            </div>
                                        </div>
                                    </div>
                                </PaperCard>
                            );
                        })}
                    </div>

                    {/* 猜你喜欢 */}
                    {cat === '全部' && !query.trim() && recommended.length > 0 && (
                        <div className="mt-6">
                            <SectionTag en="FOR YOU" className="mb-3">猜你喜欢</SectionTag>
                            <div className="flex gap-2.5 overflow-x-auto no-scrollbar pb-1">
                                {recommended.map(s => (
                                    <button key={s.id} onClick={() => openStore(s)} className="shrink-0 w-[120px] text-left rounded-[10px] p-2.5 active:scale-[0.97] transition-transform" style={{ background: 'rgba(255,253,247,0.95)', border: '1px solid rgba(176,170,158,0.55)' }}>
                                        <div className="mb-1"><Emo e={s.emoji} size={26} /></div>
                                        <div className="text-[12px] font-black truncate" style={{ color: INK }}>{s.name}</div>
                                        <div className="text-[9px] mt-0.5" style={{ color: INK_SOFT }}>★{s.rating} · 月售{s.monthlySales}</div>
                                        {s.promo && <div className="text-[8.5px] font-bold mt-0.5" style={{ color: '#d2452f' }}>{s.promo}</div>}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </ScrapScroll>
            </PaperShell>
        );
    }

    // ════════════════════════ 铺子·点菜 ════════════════════════
    if (view === 'store' && activeStore) {
        const isPinned = pinned.includes(activeStore.name);
        return (
            <PaperShell key="store">
                <ScrapHeader
                    title={activeStore.name} en="THE SHOP" onBack={() => setView('home')} backLabel="回街上"
                    right={<button onClick={() => togglePin(activeStore.name)} className="inline-flex items-center gap-1 px-2 py-1.5 text-[11px] font-black active:scale-95 transition-transform" style={{ color: isPinned ? PAPER : '#36322b', background: isPinned ? INK : 'transparent', borderRadius: 6, border: isPinned ? 'none' : '1px dashed rgba(150,144,132,0.7)' }} title="钉住常去">
                        <PushPin size={13} weight={isPinned ? 'fill' : 'bold'} />{isPinned ? '已钉' : '钉住'}
                    </button>}
                />
                <div className="relative z-10 px-5">
                    <PaperCard tilt={-0.5} className="px-4 py-3.5 flex items-center gap-3 overflow-hidden">
                        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.07]" style={{ backgroundImage: HALFTONE, backgroundSize: '7px 7px' }} />
                        <Shopfront e={activeStore.emoji} size={30} box={54} />
                        <div className="min-w-0 flex-1 relative">
                            <div className="flex items-center gap-1.5">
                                <span className="text-[16px] font-black truncate" style={{ color: INK }}>{activeStore.name}</span>
                                {activeStore.aiGenerated && <Sparkle size={12} weight="fill" style={{ color: INK_SOFT }} />}
                            </div>
                            <div className="text-[11px] mt-0.5 flex items-center gap-2" style={{ color: '#6b665c' }}>
                                <span className="flex items-center gap-0.5"><Star size={11} weight="fill" color={INK} /><b style={{ color: INK }}>{activeStore.rating}</b></span>
                                <span>卖出{activeStore.monthlySales} · {activeStore.deliveryMinutes}分 · {activeStore.distanceKm}km</span>
                            </div>
                            {activeStore.blurb && <div className="text-[11px] mt-1 italic truncate" style={{ color: INK_SOFT }}>「{activeStore.blurb}」</div>}
                            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                                {activeStore.promo && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-[4px]" style={{ background: '#e9e4d9', color: '#3a362f', border: '1px dashed rgba(150,144,132,0.7)' }}>票面优惠 · {activeStore.promo}</span>}
                                {activeStore.warning && <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-[4px]" style={{ background: INK, color: PAPER }}><Warning size={11} weight="fill" />{activeStore.warning}</span>}
                            </div>
                        </div>
                    </PaperCard>
                </div>

                <ScrapScroll className="px-5 pt-3 pb-28">
                    <SectionTag en="THE MENU" className="mb-3">菜牌</SectionTag>
                    {/* 美团式菜单分组（招牌/主食/饮品/小食…） */}
                    <div className="space-y-3.5">
                        {groupDishes(activeStore.dishes).map(({ group, dishes }) => (
                            <div key={group}>
                                <div className="text-[10px] font-black mb-1.5 flex items-center gap-1.5" style={{ color: INK_SOFT, letterSpacing: '0.08em' }}>
                                    <span className="w-3 h-px" style={{ background: 'rgba(176,170,158,0.7)' }} />{group}<span className="opacity-50">· {dishes.length}</span>
                                </div>
                                <div className="space-y-2.5">
                                    {dishes.map(d => (
                                        <div key={d.id} className="flex gap-3 items-center px-3 py-2.5 rounded-[12px]" style={{ background: 'linear-gradient(180deg,#fbf9f2,#f2efe4)', border: '1px solid rgba(176,170,158,0.55)' }}>
                                            <Shopfront e={d.emoji} size={24} box={46} />
                                            <div className="flex-1 min-w-0">
                                                <div className="text-[13.5px] font-bold truncate flex items-center gap-1" style={{ color: INK }}>
                                                    {d.name}{d.popular && <span className="text-[9px] px-1 py-px rounded-[3px]" style={{ background: INK, color: PAPER }}>镇店</span>}
                                                </div>
                                                {d.desc && <div className="text-[10.5px] mt-0.5 truncate" style={{ color: INK_SOFT }}>{d.desc}</div>}
                                                <div className="text-[14px] font-black mt-1" style={{ color: INK }}>¥{d.price}</div>
                                            </div>
                                            <div className="flex items-center gap-2 shrink-0">
                                                {(cart[d.id] || 0) > 0 && <>
                                                    <button onClick={() => setQty(d.id, -1)} className="w-6 h-6 rounded-full flex items-center justify-center active:scale-90" style={{ border: `1.5px solid ${INK}`, color: INK }}><Minus size={12} weight="bold" /></button>
                                                    <span className="text-[13px] font-black w-4 text-center" style={{ color: INK }}>{cart[d.id]}</span>
                                                </>}
                                                <button onClick={() => setQty(d.id, 1)} className="w-6 h-6 rounded-full flex items-center justify-center active:scale-90" style={{ background: INK, color: PAPER }}><Plus size={12} weight="bold" /></button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* 食客留言墙 */}
                    <SectionTag en="DINERS' WALL" className="mt-6 mb-3">食客留言墙</SectionTag>
                    <PaperCard tilt={0.4} className="px-4 py-3.5">
                        <div className="flex items-center justify-between mb-2.5">
                            <span className="text-[12px] font-black flex items-center gap-1.5" style={{ color: INK }}>
                                大伙儿吃过都说
                                {reviewsLoading && <span className="text-[9px] font-bold opacity-50">· 现写食评中…</span>}
                            </span>
                            <span className="flex items-center gap-1 text-[12px] font-black" style={{ color: INK }}><Stars n={activeStore.rating} />{activeStore.rating}</span>
                        </div>
                        <DashedRule className="mb-3" />
                        <div className="space-y-3">
                            {storeReviews.slice(0, 6).map(r => (
                                <div key={r.id} className="flex gap-2.5">
                                    <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: '#efeae0', border: '1px solid rgba(176,170,158,0.6)' }}><Emo e={r.emoji} size={16} /></div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between">
                                            <span className="text-[12px] font-bold truncate" style={{ color: '#46423a' }}>{r.name}</span>
                                            <span className="text-[10px]" style={{ color: INK_SOFT }}>{r.date}</span>
                                        </div>
                                        <Stars n={r.rating} size={10} />
                                        <div className="text-[12px] mt-0.5 leading-snug" style={{ color: '#54504a' }}>{r.text}</div>
                                        {r.reply && <div className="mt-1 text-[11px] px-2 py-1.5 rounded-[8px]" style={{ background: '#efeae0', color: '#5a554c' }}>铺子回话：{r.reply}</div>}
                                        <div className="text-[10px] mt-1" style={{ color: INK_SOFT }}>👍 {r.likes} 人点头</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </PaperCard>
                </ScrapScroll>

                {/* 菜篮搁板 */}
                <div className="relative z-20 shrink-0 px-5 pt-3" style={{ background: 'linear-gradient(180deg, rgba(246,243,236,0), #efece3 40%)', paddingBottom: 'max(env(safe-area-inset-bottom), 12px)' }}>
                    <div className="flex items-center gap-3 px-3.5 py-2.5 rounded-[14px]" style={{ background: PAPER, border: '1px solid rgba(176,170,158,0.7)', boxShadow: '0 -10px 22px -16px rgba(31,29,26,0.5)' }}>
                        <div className="relative">
                            <Stamp size={44} color="ink"><Package size={22} weight="duotone" /></Stamp>
                            {cartCount > 0 && <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-black flex items-center justify-center" style={{ background: INK, color: PAPER, border: `2px solid ${PAPER}` }}>{cartCount}</span>}
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="text-[17px] font-black" style={{ color: INK }}>¥{cartSubtotal}</div>
                            <div className="text-[10px]" style={{ color: INK_SOFT }}>另付 跑腿¥{activeStore.deliveryFee} · 打包¥{PACK_FEE}</div>
                        </div>
                        <ScrapButton variant="ink" onClick={goCheckout} disabled={cartCount === 0} className="px-5 py-2.5 text-[13.5px]" icon={<Receipt size={15} weight="bold" />}>
                            {cartSubtotal < activeStore.minOrder ? `再凑¥${Math.max(0, activeStore.minOrder - cartSubtotal)}` : '撕票下单'}
                        </ScrapButton>
                    </div>
                </div>
            </PaperShell>
        );
    }

    // ════════════════════════ 写一张饭票·结算 ════════════════════════
    if (view === 'checkout' && activeStore) {
        const total = Math.max(0, cartSubtotal + activeStore.deliveryFee + PACK_FEE + tip - orderDiscount);
        const payByMe = payer === 'me';
        const notEnough = payByMe && wallet < total;
        return (
            <PaperShell key="checkout">
                <ScrapHeader title="写一张饭票" en="FILL THE TICKET" onBack={() => setView('store')} backLabel="回铺子" right={walletChip} />
                <ScrapScroll className="px-5 pt-2 pb-28 space-y-4">
                    {/* 这一份送给 */}
                    <PaperCard tilt={-0.5} className="px-4 py-3.5">
                        <SectionTag en="DELIVER TO" className="mb-2.5">这一份送给</SectionTag>
                        <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1">
                            {recipientOptions.map(o => personPolaroid(o, recipient === o.id, () => setRecipient(o.id)))}
                        </div>
                        <div className="mt-2.5 flex items-center gap-2">
                            <MapPin size={15} color={INK} weight="fill" />
                            {recipient === 'me'
                                ? <input value={address} onChange={e => setAddress(e.target.value)} className="flex-1 rounded-[8px] px-2.5 py-2 text-[12.5px] outline-none" style={paperInput} placeholder="送到哪儿…" />
                                : <span className="text-[12.5px]" style={{ color: '#5a554c' }}>径直送到 {nameOf(recipient)} 那儿</span>}
                        </div>
                    </PaperCard>

                    {/* 谁来掏这顿饭钱 */}
                    <PaperCard tilt={0.4} className="px-4 py-3.5">
                        <div className="flex items-center justify-between mb-2.5">
                            <div className="flex items-center gap-2">
                                <span className="px-2.5 py-1 rounded-[4px] text-[11px] font-black tracking-wide" style={{ background: INK, color: PAPER }}>谁来掏这顿</span>
                                <span className="text-[9px] tracking-[0.3em] uppercase" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>WHO PAYS</span>
                            </div>
                            <span className="text-[11px] font-bold flex items-center gap-1" style={{ color: notEnough ? INK : '#5a554c' }}><Coins size={12} weight="fill" />饭钱 ¥{wallet}</span>
                        </div>
                        <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1">
                            {personPolaroid({ id: 'me', label: '我自己掏', avatar: userProfile.avatar }, payByMe, () => setPayer('me'))}
                            {characters.map(c => personPolaroid({ id: c.id, label: `${c.name}请客`, avatar: c.avatar }, payer === c.id, () => setPayer(c.id)))}
                        </div>
                        {payByMe && notEnough && <div className="text-[11px] font-bold mt-2 flex items-center gap-1" style={{ color: INK }}><Warning size={12} weight="fill" />饭钱不够，还差 ¥{Math.round((total - wallet) * 100) / 100}，让 TA 请客或先去赚点。</div>}
                        {!payByMe && <div className="text-[11px] mt-2" style={{ color: INK_SOFT }}>会在来往里给 {nameOf(payer)} 捎一条代付的话，不动你的饭钱袋。</div>}
                    </PaperCard>

                    {/* 给跑腿塞瓶水（小费） */}
                    <PaperCard tilt={-0.3} className="px-4 py-3.5">
                        <SectionTag en="TIP THE RUNNER" className="mb-2.5">给跑腿塞瓶水？</SectionTag>
                        <div className="flex gap-2 flex-wrap">
                            {TIP_CHOICES.map(t => (
                                <ChoiceChip key={t} on={tip === t} onClick={() => setTip(t)} icon={t > 0 ? <HandCoins size={12} weight="fill" /> : undefined}>{t === 0 ? '先不塞' : `¥${t}`}</ChoiceChip>
                            ))}
                        </div>
                        <div className="text-[10.5px] mt-2" style={{ color: INK_SOFT }}>风里来雨里去，塞点小费，跑腿心里暖、回话也更上心。</div>
                    </PaperCard>

                    {/* 饭票清单 + 留言 */}
                    <PaperCard tilt={0.3} tape="butter" className="px-4 py-4">
                        <div className="flex items-center gap-2 mb-1"><Emo e={activeStore.emoji} size={18} /><span className="text-[13px] font-black" style={{ color: INK }}>{activeStore.name}</span></div>
                        <DashedRule className="my-2" />
                        {cartItems.map(i => (
                            <div key={i.dishId} className="flex items-center justify-between py-1 text-[12.5px]">
                                <span style={{ color: '#54504a' }}><Emo e={i.emoji} size={13} /> {i.name} ×{i.qty}</span>
                                <span className="font-bold" style={{ color: INK }}>¥{i.price * i.qty}</span>
                            </div>
                        ))}
                        <DashedRule className="my-2" />
                        <div className="space-y-1 text-[12px]" style={{ color: '#6b665c' }}>
                            <div className="flex justify-between"><span>跑腿费</span><span>¥{activeStore.deliveryFee}</span></div>
                            <div className="flex justify-between"><span>打包费</span><span>¥{PACK_FEE}</span></div>
                            {tip > 0 && <div className="flex justify-between"><span>跑腿小费</span><span>¥{tip}</span></div>}
                            {promoDisc > 0 && <div className="flex justify-between" style={{ color: '#d2452f' }}><span>店铺满减（{activeStore.promo}）</span><span>-¥{promoDisc}</span></div>}
                            {bestRp && <div className="flex justify-between" style={{ color: '#d2452f' }}><span>平台红包（{bestRp.title}）</span><span>-¥{bestRp.discount}</span></div>}
                        </div>
                        <div className="mt-3">
                            <input value={note} onChange={e => setNote(e.target.value)} placeholder="给铺子和跑腿留句话…" className="w-full rounded-[8px] px-2.5 py-2 text-[12px] outline-none" style={paperInput} />
                            <div className="flex flex-wrap gap-1.5 mt-2">
                                {NOTE_CHIPS.map(t => (
                                    <button key={t} onClick={() => addNoteChip(t)} className="text-[10.5px] px-2 py-1 rounded-[6px] font-bold active:scale-95 transition-transform" style={{ background: 'rgba(255,253,247,0.92)', color: '#5a554c', border: '1px dashed rgba(150,144,132,0.7)' }}>＋{t}</button>
                                ))}
                            </div>
                        </div>
                    </PaperCard>
                </ScrapScroll>

                <div className="relative z-20 shrink-0 px-5 pt-3" style={{ background: 'linear-gradient(180deg, rgba(246,243,236,0), #efece3 40%)', paddingBottom: 'max(env(safe-area-inset-bottom), 12px)' }}>
                    <div className="flex items-center gap-3 px-3.5 py-2.5 rounded-[14px]" style={{ background: PAPER, border: '1px solid rgba(176,170,158,0.7)', boxShadow: '0 -10px 22px -16px rgba(31,29,26,0.5)' }}>
                        <div className="flex-1"><span className="text-[11px]" style={{ color: INK_SOFT }}>一共 </span><span className="text-[19px] font-black" style={{ color: INK }}>¥{total}</span></div>
                        <ScrapButton variant="ink" onClick={() => void placeOrder()} disabled={notEnough} className="px-6 py-3 text-[14px]" icon={<SealCheck size={16} weight="fill" />}>
                            {payByMe ? `盖章付 ¥${total}` : `请 ${nameOf(payer)} 付`}
                        </ScrapButton>
                    </div>
                </div>
            </PaperShell>
        );
    }

    // ════════════════════════ 票根夹·订单列表 ════════════════════════
    if (view === 'orders') {
        return (
            <PaperShell key="orders">
                <ScrapHeader title="票根夹" en="TICKET STUBS" onBack={() => setView('home')} backLabel="回街上" right={walletChip} />
                <ScrapScroll className="px-5 pt-2 pb-10">
                    {orders.length === 0 && <div className="text-center text-[12px] py-16" style={{ color: INK_SOFT }}>票根夹还空着，去街上撕一张吧～</div>}
                    <div className="space-y-3.5">
                        {orders.map((o, idx) => {
                            const st = liveTakeoutStatus(o, now);
                            const issues = st === 'delivered' || st === 'arrived' || st === 'cancelled' ? incidentsSummary(o) : '';
                            const open = hasOpenIssues(o);
                            const isDone = st === 'delivered';
                            return (
                                <PaperCard key={o.id} tilt={idx % 2 === 0 ? -0.5 : 0.5} pin onClick={() => { setActiveOrderId(o.id); setChatTarget(o.chatTarget || 'rider'); setView('detail'); }} className="px-4 py-3.5">
                                    {/* 票根齿边 */}
                                    <div className="flex items-center justify-between">
                                        <span className="text-[13.5px] font-black truncate flex items-center gap-1" style={{ color: INK }}><Emo e={o.storeEmoji} size={15} /> {o.storeName}</span>
                                        <span className="text-[10.5px] font-black px-2 py-0.5 rounded-[5px]" style={isDone ? { background: '#e9e4d9', color: '#3a362f', border: '1px dashed rgba(150,144,132,0.7)' } : st === 'cancelled' ? { background: INK, color: PAPER } : { background: INK, color: PAPER }}>{o.cancelledByStore ? '铺子撂挑子' : STATUS_LABEL[st]}</span>
                                    </div>
                                    <div className="text-[11.5px] mt-1 truncate" style={{ color: '#6b665c' }}>{o.items.map(i => `${i.name}×${i.qty}`).join('、')}</div>
                                    {(issues || o.complaint?.refunded) ? (
                                        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                                            {issues && open && <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-[4px]" style={{ background: INK, color: PAPER }}><ShieldWarning size={11} weight="fill" />{issues} · 可申诉</span>}
                                            {issues && !open && o.complaint?.resolved && <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-[4px]" style={{ background: '#e9e4d9', color: '#3a362f', border: '1px dashed rgba(150,144,132,0.7)' }}><SealCheck size={11} weight="fill" />已了结</span>}
                                            {!!o.complaint?.refunded && <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-[4px]" style={{ background: '#e9e4d9', color: '#3a362f', border: '1px dashed rgba(150,144,132,0.7)' }}><HandCoins size={11} weight="fill" />退¥{o.complaint.refunded}</span>}
                                        </div>
                                    ) : null}
                                    <DashedRule className="my-2" />
                                    <div className="flex items-center justify-between">
                                        <span className="text-[10.5px]" style={{ color: INK_SOFT }}>{o.recipient !== 'me' ? `送给 ${nameOf(o.recipient)}` : '送给我'}{o.payer !== 'me' ? ` · ${nameOf(o.payer)}请客` : ''}</span>
                                        <span className="text-[14px] font-black" style={{ color: INK }}>¥{o.total}</span>
                                    </div>
                                </PaperCard>
                            );
                        })}
                    </div>
                </ScrapScroll>
            </PaperShell>
        );
    }

    // ════════════════════════ 这张饭票·详情 ════════════════════════
    if (view === 'detail' && activeOrder) {
        const o = activeOrder;
        const st = liveTakeoutStatus(o, now);
        const steps = [
            { key: 'preparing', label: '灶上忙着', Icon: CookingPot },
            { key: 'delivering', label: '跑腿在路上', Icon: Bicycle },
            { key: 'delivered', label: '到你手上', Icon: Package },
        ];
        const stepIdx = (st === 'delivered' || st === 'arrived') ? 2 : st === 'delivering' ? 1 : 0;
        const arrived = st === 'arrived';
        const showIssues = (st === 'delivered' || st === 'arrived' || st === 'cancelled') && (o.incidents || []).length > 0;
        const targets: { id: ChatTarget; label: string; icon: React.ReactNode }[] = [
            { id: 'rider', label: '捎话·跑腿', icon: <Bicycle size={13} weight="bold" /> },
            { id: 'store', label: '问问·铺子', icon: <Storefront size={13} weight="bold" /> },
            { id: 'support', label: '平台·说理', icon: <ShieldWarning size={13} weight="bold" /> },
        ];
        const targetZh = chatTarget === 'rider' ? '跑腿' : chatTarget === 'store' ? '铺子' : '平台';
        return (
            <PaperShell key="detail">
                <ScrapHeader title="这张饭票" en="THE TICKET" onBack={() => setView('orders')} backLabel="票根夹" right={walletChip} />
                <ScrapScroll className="px-5 pt-2 pb-10 space-y-4">
                    {/* 进度 / 撂挑子 */}
                    {o.cancelledByStore ? (
                        <PaperCard tilt={-0.6} className="px-4 py-4 overflow-hidden">
                            <WashiTape color="ink" rotate={-6} className="absolute -top-2 right-5 w-24 h-6 rounded-[2px] text-[8px] tracking-[0.3em]" style={{ fontFamily: 'var(--font-label)' }}>VOID</WashiTape>
                            <div className="text-[16px] font-black flex items-center gap-1.5" style={{ color: INK }}><ShieldWarning size={18} weight="fill" />铺子撂了挑子</div>
                            <div className="text-[11.5px] mt-1.5 leading-relaxed" style={{ color: '#54504a' }}>「{o.storeName}」收了钱迟迟不接单，平台替你把这张票作废、把 ¥{o.complaint?.refunded ?? 0} 退回饭钱袋。下次绕开这种铺子吧。</div>
                        </PaperCard>
                    ) : (
                        <PaperCard tilt={0.4} className="px-4 py-4 overflow-hidden">
                            <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.08]" style={{ backgroundImage: HALFTONE, backgroundSize: '7px 7px' }} />
                            <div className="relative">
                                <div className="text-[17px] font-black" style={{ color: INK }}>{etaText(o, now)}</div>
                                <div className="text-[11.5px] mt-0.5" style={{ color: INK_SOFT }}>{st === 'delivered' ? '希望你/TA 吃得开心～' : arrived ? '到门口啦，盖个章签收吧' : `${o.riderEmoji} ${o.riderName} 正替你跑这一趟`}</div>
                                <div className="flex items-center gap-1 mt-3.5">
                                    {steps.map((s, i) => {
                                        const done = i < stepIdx || st === 'delivered';
                                        const cur = i === stepIdx && st !== 'delivered';
                                        return (
                                            <React.Fragment key={s.key}>
                                                <div className="flex flex-col items-center gap-1">
                                                    <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: done ? INK : cur ? '#efeae0' : '#f1eee4', color: done ? PAPER : INK, border: cur ? `1.5px dashed ${INK}` : '1px solid rgba(176,170,158,0.6)' }}>
                                                        {done ? <SealCheck size={17} weight="fill" /> : <s.Icon size={17} weight={cur ? 'fill' : 'regular'} />}
                                                    </div>
                                                    <span className="text-[9px] font-bold" style={{ color: done || cur ? INK : INK_SOFT }}>{s.label}</span>
                                                </div>
                                                {i < steps.length - 1 && <div className="flex-1 h-px mb-4" style={{ backgroundImage: 'repeating-linear-gradient(90deg, rgba(31,29,26,0.5) 0 4px, transparent 4px 8px)', opacity: i < stepIdx ? 1 : 0.3 }} />}
                                            </React.Fragment>
                                        );
                                    })}
                                </div>
                            </div>
                        </PaperCard>
                    )}

                    {/* 路上的岔子 / 申诉 */}
                    {showIssues && (
                        <PaperCard tilt={-0.4} className="px-4 py-3.5">
                            <div className="flex items-center gap-1.5 text-[13px] font-black mb-2" style={{ color: INK }}><ShieldWarning size={16} weight="fill" />这趟路上出了点岔子</div>
                            <DashedRule className="mb-2.5" />
                            <div className="space-y-2">
                                {(o.incidents || []).map((inc, i) => (
                                    <div key={i} className="flex gap-2">
                                        <span className="text-[10.5px] font-bold px-1.5 py-0.5 rounded-[4px] shrink-0 h-fit" style={{ background: INK, color: PAPER }}>{inc.by === 'store' ? '铺子' : '跑腿'}·{inc.title}</span>
                                        <span className="text-[11.5px] leading-snug" style={{ color: '#54504a' }}>{inc.detail}</span>
                                    </div>
                                ))}
                            </div>
                            {o.complaint?.resolved ? (
                                <div className="mt-3 text-[11.5px] font-bold flex items-start gap-1.5 p-2.5 rounded-[10px]" style={{ background: '#efeae0', color: '#3a362f' }}><SealCheck size={14} weight="fill" className="mt-0.5 shrink-0" />{o.complaint.outcome}</div>
                            ) : (
                                <ScrapButton variant="ink" onClick={() => void fileComplaint(o)} className="mt-3 w-full py-2.5 text-[13px]" icon={<HandCoins size={16} weight="fill" />}>递一张申诉条 · 讨个说法</ScrapButton>
                            )}
                        </PaperCard>
                    )}

                    {/* 捎话：跑腿 / 铺子 / 平台 */}
                    <PaperCard tilt={0.3} className="px-4 py-3.5">
                        <div className="flex gap-2 mb-2.5">
                            {targets.map(t => <ChoiceChip key={t.id} on={chatTarget === t.id} onClick={() => setChatTarget(t.id)} icon={t.icon}>{t.label}</ChoiceChip>)}
                        </div>
                        <div className="rounded-[10px] p-2.5 max-h-44 overflow-y-auto no-scrollbar space-y-2" style={{ background: '#efeae0', border: '1px solid rgba(176,170,158,0.5)' }}>
                            {o.chat.filter(m => m.role === 'user' || m.role === chatTarget).length === 0 && (
                                <div className="text-[11px] text-center py-3 flex items-center justify-center gap-1" style={{ color: INK_SOFT }}><ChatCircleDots size={14} />给{targetZh}捎句话试试</div>
                            )}
                            {o.chat.filter(m => m.role === 'user' || m.role === chatTarget).map((m, i) => (
                                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                    <span className="max-w-[78%] px-3 py-1.5 rounded-[12px] text-[12.5px] leading-snug" style={m.role === 'user' ? { background: INK, color: PAPER } : { background: PAPER, color: '#36322b', border: '1px solid rgba(176,170,158,0.7)' }}>{m.text}</span>
                                </div>
                            ))}
                            {chatBusy && <div className="text-[11px] pl-1" style={{ color: INK_SOFT }}>对方正在写…</div>}
                        </div>
                        <div className="flex items-center gap-2 mt-2">
                            <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void sendChat(); }} placeholder={`想对${targetZh}说点啥…`} className="flex-1 rounded-full px-3 py-2 text-[12.5px] outline-none" style={paperInput} disabled={chatBusy} />
                            <button onClick={() => void sendChat()} disabled={chatBusy || !chatInput.trim()} className="w-9 h-9 rounded-full flex items-center justify-center active:scale-95 transition disabled:opacity-50" style={{ background: INK, color: PAPER }}><PaperPlaneRight size={15} weight="fill" /></button>
                        </div>
                    </PaperCard>

                    {/* 票面明细 */}
                    <PaperCard tilt={-0.3} tape="amber" className="px-4 py-4">
                        <div className="flex items-center gap-2 mb-1"><Emo e={o.storeEmoji} size={17} /><span className="text-[13px] font-black" style={{ color: INK }}>{o.storeName}</span></div>
                        <DashedRule className="my-2" />
                        {o.items.map(i => (
                            <div key={i.dishId} className="flex items-center justify-between py-0.5 text-[12.5px]">
                                <span style={{ color: '#54504a' }}><Emo e={i.emoji} size={13} /> {i.name} ×{i.qty}</span>
                                <span className="font-bold" style={{ color: INK }}>¥{i.price * i.qty}</span>
                            </div>
                        ))}
                        <DashedRule className="my-2" />
                        <div className="text-[12px] space-y-1" style={{ color: '#6b665c' }}>
                            <div className="flex justify-between"><span>跑腿 / 打包</span><span>¥{o.deliveryFee + o.packFee}</span></div>
                            {!!o.tip && <div className="flex justify-between"><span>跑腿小费</span><span>¥{o.tip}</span></div>}
                            <div className="flex justify-between text-[13px] font-black" style={{ color: INK }}><span>实付</span><span>¥{o.total}</span></div>
                            {!!o.complaint?.refunded && <div className="flex justify-between font-bold" style={{ color: INK }}><span>已退回</span><span>-¥{o.complaint.refunded}</span></div>}
                            <div className="flex justify-between"><span>收货</span><span>{o.recipient !== 'me' ? nameOf(o.recipient) : o.address}</span></div>
                            <div className="flex justify-between"><span>付款</span><span>{o.payer !== 'me' ? `${nameOf(o.payer)}请客` : '我自己掏'} · {o.cancelledByStore ? '已退款' : '已付'}</span></div>
                            {o.note && <div className="flex justify-between"><span>留言</span><span className="text-right max-w-[60%] truncate">{o.note}</span></div>}
                        </div>
                        <button onClick={() => reorder(o)} className="mt-3 w-full inline-flex items-center justify-center gap-1.5 py-2 rounded-[8px] text-[12px] font-black active:scale-[0.98] transition-transform" style={{ background: 'transparent', color: INK, border: '1px dashed rgba(150,144,132,0.8)' }}>
                            <Repeat size={14} weight="bold" />照着再撕一张
                        </button>
                    </PaperCard>

                    {/* 食评（送达后，仅自己那份可写） */}
                    {st === 'delivered' && o.recipient === 'me' && (
                        <PaperCard tilt={0.4} className="px-4 py-3.5">
                            <SectionTag en="MY REVIEW" className="mb-2.5">我的食评</SectionTag>
                            {o.review ? (
                                <div>
                                    <div className="flex items-center gap-2">
                                        <Stars n={o.review.rating} size={14} />
                                        <button onClick={() => openReview(o)} className="ml-auto text-[11px] font-black inline-flex items-center gap-1" style={{ color: INK }}><NotePencil size={12} weight="bold" />改改</button>
                                    </div>
                                    {o.review.tags && o.review.tags.length > 0 && (
                                        <div className="flex flex-wrap gap-1.5 mt-2">
                                            {o.review.tags.map(t => <span key={t} className="text-[10px] px-1.5 py-0.5 rounded-[4px]" style={{ background: '#e9e4d9', color: '#3a362f', border: '1px dashed rgba(150,144,132,0.7)' }}>{t}</span>)}
                                        </div>
                                    )}
                                    {o.review.text && <div className="text-[12.5px] mt-2 leading-snug" style={{ color: '#54504a' }}>{o.review.text}</div>}
                                    {o.review.replies && o.review.replies.length > 0 && (
                                        <div className="mt-2.5 space-y-1.5 pt-2" style={{ borderTop: '1px dashed rgba(150,144,132,0.5)' }}>
                                            {o.review.replies.map((rp, i) => (
                                                <div key={i} className="text-[11.5px] leading-snug">
                                                    <span className="font-bold" style={{ color: '#46423a' }}><Emo e={rp.emoji} size={12} /> {rp.name}{rp.isMerchant ? '（铺子）' : ''}：</span>
                                                    <span style={{ color: INK_SOFT }}>{rp.text}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <ScrapButton variant="paper" onClick={() => openReview(o)} className="w-full py-2.5 text-[13px]" icon={<NotePencil size={15} weight="bold" />}>写一张食评 · 贴上墙</ScrapButton>
                            )}
                        </PaperCard>
                    )}

                    {/* 签收 / 等门口 */}
                    {st !== 'delivered' && st !== 'cancelled' && o.recipient !== 'me' && (
                        <StickyNote color="butter" rotate={-0.6} className="px-4 py-3 text-[12px] font-bold text-center" style={{ color: '#46423a' }}>
                            {arrived ? `已送到 ${nameOf(o.recipient)} 门口，TA 收下后会在聊天里回应你～` : `送到后 ${nameOf(o.recipient)} 会自己签收，并在聊天里回应你`}
                        </StickyNote>
                    )}
                    {st !== 'delivered' && st !== 'cancelled' && o.recipient === 'me' && (
                        arrived ? (
                            <ScrapButton variant="ink" onClick={() => void notifyDelivered(o)} className="w-full py-3 text-[14px]" icon={<SealCheck size={17} weight="fill" />}>盖章签收 · 收下这份</ScrapButton>
                        ) : (
                            <div className="w-full py-3 rounded-[12px] text-[12px] font-bold text-center flex items-center justify-center gap-1.5" style={{ background: '#efeae0', color: INK_SOFT, border: '1px dashed rgba(150,144,132,0.7)' }}>
                                <CheckCircle size={15} /> 到门口才能盖签收章 · {etaText(o, now)}
                            </div>
                        )
                    )}
                </ScrapScroll>

                {/* 食评抽屉 */}
                <PaperSheet open={reviewing} onClose={() => setReviewing(false)} title={`给「${o.storeName}」写张食评`} tape="ink">
                    <div className="text-center text-[11px] mb-3" style={{ color: INK_SOFT }}>{o.items.map(i => i.name).join('、')}</div>
                    <div className="flex items-center justify-center gap-2 mb-2">
                        {[1, 2, 3, 4, 5].map(i => (
                            <button key={i} onClick={() => { setReviewRating(i); setReviewTags([]); }} className="active:scale-90 transition">
                                <Star size={32} weight="fill" color={i <= reviewRating ? INK : 'rgba(31,29,26,0.16)'} />
                            </button>
                        ))}
                    </div>
                    <div className="text-center text-[12px] font-black mb-3" style={{ color: INK }}>{STAR_WORDS[reviewRating]}</div>
                    <div className="flex flex-wrap gap-2 justify-center mb-3">
                        {reviewQuickTags(reviewRating).map(t => (
                            <ChoiceChip key={t} on={reviewTags.includes(t)} onClick={() => toggleReviewTag(t)}>{t}</ChoiceChip>
                        ))}
                    </div>
                    <textarea value={reviewText} onChange={e => setReviewText(e.target.value)} rows={3} placeholder="说说这一口的滋味…（随手写写）" className="w-full rounded-[12px] px-3 py-2.5 text-[13px] outline-none resize-none mb-3" style={paperInput} />
                    <div className="flex gap-2.5">
                        <ScrapButton variant="ghost" onClick={() => setReviewing(false)} className="flex-1 py-3 text-[14px]">先不写</ScrapButton>
                        <ScrapButton variant="ink" onClick={() => void submitReview()} className="flex-1 py-3 text-[14px]">贴上墙</ScrapButton>
                    </div>
                </PaperSheet>
            </PaperShell>
        );
    }

    // 兜底
    return (
        <PaperShell key="fallback">
            <div className="relative z-10 flex-1 flex flex-col items-center justify-center gap-3">
                <Stamp size={56} color="ink"><Storefront size={28} weight="duotone" /></Stamp>
                <ScrapButton variant="ink" onClick={() => setView('home')} icon={<Receipt size={15} weight="bold" />} className="px-4 py-2 text-[13px]">回饭票簿</ScrapButton>
            </div>
        </PaperShell>
    );
};

export default TakeoutApp;
