import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { CharacterProfile, ShopItem, ShopOwnedItem, ShopOrderItem, ShopUserReview } from '../types';
import {
    SHOP_ITEMS, SHOP_CATEGORIES, formatPrice, makeOwnedItem, makeReceipt,
    buildGiftCardMeta, getShopItem, receiptLine, buildCharShopPrompt, parseCharShopDecision,
    emitShopUpdated, SHOP_UPDATED_EVENT,
    addToCart, setCartQty, removeFromCart, cartCount, cartTotal, resolveCart, expandCart,
    monthlySales, formatSales, itemRating, getItemReviews,
    registerShopItems, buildGenerateItemsPrompt, parseGeneratedItems,
    getCustomShopItems, saveCustomShopItem,
    buildItemReviewsPrompt, parseGeneratedReviews, type ShopReview,
    makeOrder, orderProgress, orderReceivePayload, ORDER_STAGES,
    SHOP_COUPONS, bestCoupon, applyCoupon,
    flashDeals, flashEndsAt, recommendItems,
    orderTrace, orderStatusKey, orderStatusCounts, type OrderStatusKey,
    isItemReviewed, makeUserReview, userReviewsForItem, goodRate,
    coinsToYuan, yuanToCoins, checkinAvailable, dailyCheckinReward,
    pushFootprint, resolveFootprints, itemSpecs,
    SHOP_GIFT_OCCASIONS, recommendGiftsForCharacter, itemGiftSignals, relationStageFromAffection,
    buildShopCompanionPrompt, buildShopCompanionSpeechPrompt, parseShopCompanionReaction, parseShopCompanionScript, parseShopCompanionSpeech, pickShopCompanionFallbackItem, resolveShopCompanionVisibleItems,
    buildShopCoPresenceLogEntry, buildShopCoPresencePaymentNotice, getShopCoPresenceCue,
    normalizeShopImageUrl,
    queueShopReply,
    type ShopItemDraft,
    type GiftOccasionKey, type GiftAdvice,
    type ShopCompanionReaction, type ShopCompanionSurface, type ShopCompanionScript, type ShopCompanionScriptStep, type ShopCompanionStepAction, type ShopCompanionSpeechIntent,
    type ShopCoPresenceCue, type ShopCoPresenceLogEntry, type ShopCoPresencePaymentNotice,
} from '../utils/shop';
import type { ShopOrder } from '../types';
import { resolveAuxApi } from '../utils/auxApi';
import { llmComplete } from '../utils/llmComplete';
import { makeApiUsageMeta } from '../utils/apiUsageCatalog';
import { buildFullCharacterSetting, buildFullActiveUserSetting } from '../utils/characterPromptProfile';
import {
    PaperBackdrop, ScrapButton, WashiTape, Stamp, Polaroid,
    PaperDialog, PaperSheet, SectionTag, DashedRule,
    INK, INK_SOFT, PAPER, PAGE_BG, HALFTONE, TAPE_STRIPES, WASHI,
} from './ui/insScrapKit';
import {
    CaretLeft, CaretRight, Handbag, Receipt as ReceiptIcon, Gift, Sparkle,
    ShoppingCart, Plus, Minus, Trash, MagnifyingGlass, Heart, Star, Truck, CheckCircle,
    House, SquaresFour, User, ClockCounterClockwise, Ticket, PencilSimpleLine,
    ArrowCounterClockwise, CalendarCheck, Path, CheckSquare, Square, Storefront, Wallet,
    LockKey, X, ChatCircleDots,
} from '@phosphor-icons/react';

type MainTab = 'home' | 'category' | 'cart' | 'my';
type SubView = null | 'orders' | 'bag' | 'receipts' | 'fav' | 'footprints' | 'coupons' | 'advisor';
type CompanionLog = { id: string; text: string; action?: ShopCompanionStepAction | ShopCompanionReaction['action']; itemId?: string; at: number; coPresence?: ShopCoPresenceLogEntry };
type CompanionCue = { itemId?: string; text: string; action?: ShopCompanionStepAction | ShopCompanionReaction['action']; at: number; cue: ShopCoPresenceCue };
type CompanionRequest = { charId: string; item: ShopItem; speech: string };
type CompanionHijack = { charId: string; item: ShopItem; speech: string; action: Extract<ShopCompanionStepAction, 'ask_user_pay' | 'auto_user_pay' | 'char_pay'>; at: number };

// ── 黑白拼贴手账·通用样式片 ───────────────────────────────────────────────
/** 米白纸卡（缝线描边 + 纸面渐变） */
const PANEL: React.CSSProperties = {
    background: 'linear-gradient(180deg,#fbf9f2,#f1eee4)',
    border: '1px solid rgba(176,170,158,0.7)',
    outline: '1px dashed rgba(150,144,132,0.5)',
    outlineOffset: '-5px',
    borderRadius: 16,
    boxShadow: '0 12px 24px -16px rgba(31,29,26,0.5)',
};
/** 商品/头像缩略图垫底（保留彩色内容，背景走米白） */
const THUMB_BG = 'linear-gradient(180deg,#fffdf8,#efece3)';
const paperInput: React.CSSProperties = { background: 'rgba(255,253,247,0.92)', color: INK, border: '1px solid rgba(176,170,158,0.7)' };
const SHOP_VIEWPORT: React.CSSProperties = { maxWidth: 576, width: '100%', margin: '0 auto' };
const VIDEO_BLACK = '#111111';
const VIDEO_LINE = 'rgba(17,17,17,0.12)';

/** 胶囊小标签 / 分段开关样式（选中＝墨块，未选＝纸面虚线） */
const chipStyle = (active: boolean): React.CSSProperties =>
    active
        ? { background: INK, color: PAPER, boxShadow: '0 6px 14px -8px rgba(31,29,26,0.6)' }
        : { background: 'rgba(255,253,247,0.72)', color: '#6b655a', border: '1px dashed rgba(150,144,132,0.6)' };

/** 墨色角标（购物车件数 / 待办数） */
const InkBadge: React.FC<{ n: number; className?: string }> = ({ n, className = '' }) => (
    <span className={`min-w-[16px] h-[16px] px-1 rounded-full text-[9px] font-black flex items-center justify-center ${className}`}
        style={{ background: INK, color: PAPER, boxShadow: '0 0 0 1.5px #f6f3ec' }}>
        {n > 99 ? '99+' : n}
    </span>
);

/** 墨色星级（黑白主题，填充＝墨，空＝浅灰） */
const InkStars: React.FC<{ stars: number; size?: number }> = ({ stars, size = 9 }) => (
    <span className="inline-flex">
        {Array.from({ length: 5 }).map((_, k) => (
            <Star key={k} size={size} weight="fill" style={{ color: k < stars ? INK : 'rgba(150,144,132,0.4)' }} />
        ))}
    </span>
);

const ShopItemImage: React.FC<{
    item: Pick<ShopItem, 'image' | 'emoji'>;
    className: string;
    loading?: 'eager' | 'lazy';
    imgStyle?: React.CSSProperties;
    fallbackClassName?: string;
    fallbackStyle?: React.CSSProperties;
}> = ({ item, className, loading, imgStyle, fallbackClassName, fallbackStyle }) => {
    const src = useMemo(() => normalizeShopImageUrl(item.image), [item.image]);
    const [failedSrc, setFailedSrc] = useState<string | undefined>();

    useEffect(() => {
        setFailedSrc(undefined);
    }, [src]);

    if (src && failedSrc !== src) {
        return (
            <img
                src={src}
                className={className}
                alt=""
                loading={loading}
                referrerPolicy="no-referrer"
                style={imgStyle}
                onError={() => setFailedSrc(src)}
            />
        );
    }

    return (
        <div className={fallbackClassName || 'w-full h-full flex items-center justify-center leading-none select-none'} style={fallbackStyle}>
            {item.emoji}
        </div>
    );
};

const mergeCustomCatalog = (base: ShopItem[]): ShopItem[] => {
    const custom = getCustomShopItems();
    const byId = new Map(base.map(item => [item.id, item]));
    custom.forEach(item => byId.set(item.id, item));
    const customOnly = custom.filter(item => !base.some(baseItem => baseItem.id === item.id));
    const mergedBase = base.map(item => byId.get(item.id) || item);
    return [...customOnly.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)), ...mergedBase];
};

const ShopApp: React.FC = () => {
    const { closeApp, characters, userProfile, updateUserProfile, apiConfig, auxApiConfig, addToast, adjustUserBalance, updateCharacter } = useOS();

    const [tab, setTab] = useState<MainTab>('home');
    const [sub, setSub] = useState<SubView>(null);
    const [cat, setCat] = useState<string>('all');
    const [categoryTabCat, setCategoryTabCat] = useState<string>(SHOP_CATEGORIES[0]?.key || 'flower');
    const [search, setSearch] = useState('');
    const [detailItem, setDetailItem] = useState<ShopItem | null>(null);
    const [editorTarget, setEditorTarget] = useState<{ item?: ShopItem } | null>(null);
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
    const wishCount = characters.reduce((sum, c) => sum + cartCount(c.shopCart), 0);
    const [companionId, setCompanionId] = useState('');
    const [companionPicker, setCompanionPicker] = useState(false);
    const [companionSearch, setCompanionSearch] = useState('');
    const [companionBusy, setCompanionBusy] = useState(false);
    const [companionPreparing, setCompanionPreparing] = useState(false);
    const [companionLog, setCompanionLog] = useState<CompanionLog[]>([]);
    const [companionLogSheet, setCompanionLogSheet] = useState(false);
    const [companionRequest, setCompanionRequest] = useState<CompanionRequest | null>(null);
    const [companionHijack, setCompanionHijack] = useState<CompanionHijack | null>(null);
    const [companionNotice, setCompanionNotice] = useState<ShopCoPresencePaymentNotice | null>(null);
    const [companionCue, setCompanionCue] = useState<CompanionCue | null>(null);
    const companion = useMemo(() => characters.find(c => c.id === companionId) || null, [characters, companionId]);
    const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});
    const companionRunRef = useRef(0);
    const companionSessionRef = useRef(0);
    const lastCompanionAtRef = useRef(0);
    const companionScrollTimerRef = useRef<number | null>(null);
    const companionHijackResolverRef = useRef<((accepted: boolean) => void) | null>(null);

    const cancelCompanionAsyncWork = () => {
        companionSessionRef.current += 1;
        companionRunRef.current += 1;
        if (companionScrollTimerRef.current != null) {
            window.clearTimeout(companionScrollTimerRef.current);
            companionScrollTimerRef.current = null;
        }
        companionHijackResolverRef.current?.(false);
        companionHijackResolverRef.current = null;
    };

    useEffect(() => {
        if (companionId && !characters.some(c => c.id === companionId)) {
            cancelCompanionAsyncWork();
            setCompanionId('');
            setCompanionLog([]);
            setCompanionLogSheet(false);
            setCompanionRequest(null);
            setCompanionHijack(null);
            setCompanionNotice(null);
            setCompanionCue(null);
            setCompanionBusy(false);
            setCompanionPreparing(false);
        }
    }, [characters, companionId]);

    useEffect(() => () => {
        cancelCompanionAsyncWork();
    }, []);

    useEffect(() => {
        if (!companionNotice) return;
        const t = window.setTimeout(() => setCompanionNotice(null), 4200);
        return () => window.clearTimeout(t);
    }, [companionNotice]);

    const toggleFav = (itemId: string) => {
        const fav = userProfile.shopFavorites || [];
        const next = fav.includes(itemId) ? fav.filter(x => x !== itemId) : [itemId, ...fav];
        updateUserProfile({ shopFavorites: next });
        addToast(fav.includes(itemId) ? '从心头好里取下了' : '收进心头好 ❤', 'success');
    };

    // 浏览足迹：打开详情即记一条（去重置顶）
    const recordFootprint = (item: ShopItem) => {
        updateUserProfile({ shopFootprints: pushFootprint(userProfile.shopFootprints, item.id) });
    };
    const openDetail = (item: ShopItem) => {
        setDetailItem(item);
        recordFootprint(item);
        void runCompanionReaction('item', { item, userAction: `打开了 ${item.name} 的详情` });
    };

    // ── 商品 AI 实时生成（每批 ≥20 件；缓存到本地，「翻新货架」可刷新） ──
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
                setCatalog(prev => (prev.length ? mergeCustomCatalog(prev) : mergeCustomCatalog(SHOP_ITEMS)));
                addToast('这架没翻起来，再点一次试试？', 'error');
                return;
            }
            registerShopItems(items);
            const next = mergeCustomCatalog(items);
            setCatalog(next);
            try { localStorage.setItem(CATALOG_KEY, JSON.stringify(next)); } catch { /* ignore */ }
            addToast(`新摆上 ${items.length} 件好物`, 'success');
        } catch {
            setCatalog(prev => (prev.length ? mergeCustomCatalog(prev) : mergeCustomCatalog(SHOP_ITEMS)));
            addToast('翻新失败，先逛逛常备好物', 'error');
        } finally { setGenBusy(false); }
    };

    // 搜索栏实时生成：按搜索词现搜一批相关礼物
    const searchGen = (q: string) => {
        const term = q.trim();
        if (!term) return;
        if (!resolveAuxApi(auxApiConfig, apiConfig).apiKey) { addToast('配好副 API 才能现挑哦', 'info'); return; }
        addToast(`正按「${term}」翻找相关好物…`, 'info');
        void generateCatalog(`请紧扣关键词「${term}」生成尽量相关的礼物（围绕该主题/场景/送礼对象/节日）`);
        void runCompanionReaction('home', {
            visibleItems: visibleItemsForCompanion(undefined, { tab: 'home', cat: 'all', search: term }),
            userAction: `搜索了「${term}」`,
        });
        setSearch(''); setCat('all');
    };

    // 进入商城：先用上次缓存，没有缓存才实时生成；副 API 没配则回退内置目录
    useEffect(() => {
        try {
            const cached = JSON.parse(localStorage.getItem(CATALOG_KEY) || 'null');
            if (Array.isArray(cached) && cached.length) {
                registerShopItems(cached);
                setCatalog(mergeCustomCatalog(cached));
                return;
            }
        } catch { /* ignore */ }
        if (resolveAuxApi(auxApiConfig, apiConfig).apiKey) void generateCatalog();
        else setCatalog(mergeCustomCatalog(SHOP_ITEMS));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const saveEditorItem = (draft: ShopItemDraft) => {
        const saved = saveCustomShopItem(draft, editorTarget?.item);
        if (!saved) { addToast('商品名还没写好', 'error'); return; }
        setCatalog(prev => {
            const next = mergeCustomCatalog([saved, ...prev.filter(item => item.id !== saved.id)]);
            try { localStorage.setItem(CATALOG_KEY, JSON.stringify(next)); } catch { /* ignore */ }
            return next;
        });
        setDetailItem(current => current?.id === saved.id ? saved : current);
        setEditorTarget(null);
        emitShopUpdated();
        addToast(saved.custom ? `已收好 ${saved.emoji}${saved.name}` : '商品已更新', 'success');
    };

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

    const visibleItemsForCompanion = (
        focus?: ShopItem,
        overrides: { tab?: MainTab; cat?: string; search?: string; categoryTabCat?: string } = {},
    ): ShopItem[] => resolveShopCompanionVisibleItems({
        catalog,
        cart,
        favorites,
        surface: overrides.tab ?? tab,
        homeCategory: overrides.cat ?? cat,
        categoryCategory: overrides.categoryTabCat ?? categoryTabCat,
        search: overrides.search ?? search,
        focus,
    });

    const companionDisplayName = (char?: CharacterProfile | null) =>
        char ? (char.convoSettings?.remarkName?.trim() || char.name) : 'TA';

    const pushCompanionLine = (text: string, action?: CompanionLog['action'], itemId?: string) => {
        const item = itemId ? getShopItem(itemId) : undefined;
        const coPresence = item && action ? buildShopCoPresenceLogEntry(action, item, text) : undefined;
        setCompanionLog(prev => [{ id: `shop-comp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, text, action, itemId, at: Date.now(), coPresence }, ...prev].slice(0, 10));
    };

    const setCompanionFocus = (itemId: string | undefined, text: string, action?: CompanionCue['action'], cueChar?: CharacterProfile | null) => {
        const cue = getShopCoPresenceCue(action || 'say', companionDisplayName(cueChar || companion));
        setCompanionCue({ itemId, text, action, at: Date.now(), cue });
        if (text) pushCompanionLine(text, action, itemId);
    };

    const waitCompanion = (ms: number) => new Promise<void>(resolve => window.setTimeout(resolve, ms));

    const waitForCompanionHijack = (char: CharacterProfile, item: ShopItem, speech: string, action: CompanionHijack['action']) => new Promise<boolean>(resolve => {
        companionHijackResolverRef.current?.(false);
        companionHijackResolverRef.current = resolve;
        setCompanionHijack({ charId: char.id, item, speech, action, at: Date.now() });
    });

    const resolveCompanionHijack = (accepted: boolean) => {
        const resolver = companionHijackResolverRef.current;
        companionHijackResolverRef.current = null;
        setCompanionHijack(null);
        resolver?.(accepted);
    };

    const finishCompanion = () => {
        cancelCompanionAsyncWork();
        setCompanionId('');
        setCompanionLog([]);
        setCompanionLogSheet(false);
        setCompanionRequest(null);
        setCompanionHijack(null);
        setCompanionNotice(null);
        setCompanionCue(null);
        setCompanionBusy(false);
        setCompanionPreparing(false);
    };

    const showPaymentNotice = (item: ShopItem, payer: 'char' | 'user', speech: string) => {
        setCompanionNotice(buildShopCoPresencePaymentNotice(item, payer, speech || '支付状态已更新。'));
    };

    const companionSpeech = async (
        char: CharacterProfile,
        intent: ShopCompanionSpeechIntent,
        ctx: { surface: ShopCompanionSurface; item?: ShopItem; visibleItems?: ShopItem[]; cart?: typeof cart; userAction?: string },
        fallback = '',
    ): Promise<string> => {
        const api = resolveAuxApi(auxApiConfig, apiConfig);
        if (!api.apiKey) return fallback;
        try {
            const userName = userProfile.name || '你';
            const { system, user } = buildShopCompanionSpeechPrompt(
                { name: char.name, personaText: buildFullCharacterSetting(char, { includeMemos: true }), affection: char.affection },
                userName,
                intent,
                {
                    surface: ctx.surface,
                    item: ctx.item,
                    visibleItems: ctx.visibleItems || visibleItemsForCompanion(ctx.item),
                    cart: ctx.cart || cart,
                    userAction: ctx.userAction,
                    budget: Math.round(80 + (char.affection ?? 50) * 4),
                    userBalance: balance,
                },
                await buildFullActiveUserSetting(userProfile),
            );
            const raw = await llmComplete(api, [{ role: 'system', content: system }, { role: 'user', content: user }], {
                temperature: 0.86,
                maxTokens: 160,
                presetScope: 'role.scene',
                presetMacros: { charName: char.name, userName },
                meta: makeApiUsageMeta('shop.generate', {
                    apiRole: api.apiRole || 'aux',
                    apiBinding: api.apiBinding || '陪逛台词',
                    charId: char.id,
                    charName: char.name,
                }),
            });
            return parseShopCompanionSpeech(raw, fallback);
        } catch {
            return fallback;
        }
    };

    const registerItemRef = (itemId: string, el: HTMLDivElement | null) => {
        if (el) itemRefs.current[itemId] = el;
        else delete itemRefs.current[itemId];
    };

    const scrollToCompanionItem = async (itemId: string) => {
        const el = itemRefs.current[itemId];
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await waitCompanion(520);
        }
    };

    const companionFallbackLine = (action: ShopCompanionStepAction | ShopCompanionReaction['action'], item?: ShopItem) => {
        if (!item) return '我在，先陪你看这一屏。';
        if (action === 'want') return `${item.emoji}${item.name}，我想先记下来。`;
        if (action === 'ask_user_pay') return `${item.emoji}${item.name}，这件我有点想要。`;
        if (action === 'auto_user_pay' || action === 'add_user_cart') return `${item.emoji}${item.name}，我想就选这件。`;
        if (action === 'char_pay') return `${item.emoji}${item.name}，这件我买给你。`;
        return `${item.emoji}${item.name}，这件我想多看一眼。`;
    };

    const fallbackCompanionScript = async (char: CharacterProfile, surface: ShopCompanionSurface, item?: ShopItem, visibleItems?: ShopItem[]): Promise<ShopCompanionScript> => {
        if (item) {
            const speech = await companionSpeech(char, 'focus_item', {
                surface,
                item,
                visibleItems,
                cart,
                userAction: '陪逛脚本解析失败，改为临场指出当前商品',
            }, companionFallbackLine('point', item));
            return {
                steps: [
                    { action: 'point', itemId: item.id, ...(speech ? { speech } : {}) },
                    { action: 'scroll_to_item', itemId: item.id },
                ],
            };
        }
        const speech = await companionSpeech(char, surface === 'cart' ? 'cart_idle' : 'idle', {
            surface,
            visibleItems,
            cart,
            userAction: '陪逛脚本解析失败，改为临场说一句',
        }, companionFallbackLine('say'));
        return { steps: [{ action: 'say', ...(speech ? { speech } : {}) }] };
    };

    const companionCharPay = async (char: CharacterProfile, item: ShopItem, speech: string) => {
        const order = placeOrder([{ item, qty: 1 }], 'char', char.name);
        const content = speech.trim();
        if (content) {
            try {
                await DB.saveMessage({
                    charId: char.id, role: 'assistant', type: 'text',
                    content,
                    metadata: { shopCompanion: true, shopOrderId: order.id, shopAction: 'char_pay' },
                } as any);
            } catch { /* ignore */ }
        }
        addToast(`${char.name} 替你付了 ${item.emoji}${item.name}`, 'success');
        showPaymentNotice(item, 'char', speech);
        emitShopUpdated();
    };

    const companionAutoUserPay = async (char: CharacterProfile, item: ShopItem, speech: string) => {
        const alreadyPending = (userProfile.shopOrders || []).some(o =>
            !o.refundedAt && !o.receivedAt && o.items.some(it => it.itemId === item.id),
        );
        if (alreadyPending) {
            updateCharacter(char.id, { shopCart: addToCart(char.shopCart, item.id) });
            const line = await companionSpeech(char, 'already_pending', {
                surface: 'order',
                item,
                cart,
                userAction: `${item.name} 已经有未签收订单，改记心愿`,
            });
            if (line) pushCompanionLine(line, 'want', item.id);
            emitShopUpdated();
            return;
        }
        if (balance < item.price) {
            const requestSpeech = speech || await companionSpeech(char, 'insufficient_balance', {
                surface: 'item',
                item,
                cart,
                userAction: `余额不足，不能直接结清 ${item.name}，需要向用户确认代付`,
            });
            setCompanionRequest({ charId: char.id, item, speech: requestSpeech });
            if (requestSpeech) pushCompanionLine(requestSpeech, 'ask_user_pay', item.id);
            return;
        }
        adjustUserBalance(-item.price, {
            note: `陪 ${char.name} 逛心意铺自动买下 ${item.name}`,
            category: 'shopping',
            kind: 'shop-companion-auto-pay',
            sourceApp: '心意铺',
            sourceId: item.id,
            relatedEntityId: char.id,
        });
        const order = makeOrder([{ item, qty: 1 }], 'self');
        const userReceipt = makeReceipt(item, 'user', 'gift', char.id, char.name, '陪逛自动买下');
        updateUserProfile({
            shopOrders: [order, ...(userProfile.shopOrders || [])],
            shopReceipts: [userReceipt, ...(userProfile.shopReceipts || [])],
            shopCart: removeFromCart(userProfile.shopCart, item.id),
        });
        try {
            const messageId = await DB.saveMessage({
                charId: char.id, role: 'system', type: 'text',
                content: `${char.name} 带着 ${userProfile.name || '你'} 买下了 ${item.emoji}${item.name}（¥${formatPrice(item.price)}，已从心意铺账户结清）`,
                metadata: { shopCompanion: true, shopOrderId: order.id, shopAction: 'auto_user_pay' },
            } as any);
            queueShopReply({
                charId: char.id,
                messageId,
                kind: 'companion_pay',
                itemName: item.name,
                itemEmoji: item.emoji,
                note: '陪逛时你替 TA 买下',
                itemCount: 1,
                total: item.price,
            });
        } catch { /* ignore */ }
        addToast(`${char.name} 带你买下了 ${item.emoji}${item.name}`, 'success');
        showPaymentNotice(item, 'user', speech);
        emitShopUpdated();
        setTab('my'); setSub('orders'); setOrderFilter('toReceive');
    };

    const applyCompanionReaction = async (char: CharacterProfile, reaction: ShopCompanionReaction) => {
        const item = reaction.itemId ? getShopItem(reaction.itemId) : undefined;
        pushCompanionLine(reaction.speech, reaction.action, reaction.itemId);
        if (reaction.action === 'comment') return;
        if (!item) return;
        if (reaction.action === 'want') {
            updateCharacter(char.id, { shopCart: addToCart(char.shopCart, item.id) });
            addToast(`${char.name} 看中了 ${item.emoji}${item.name}`, 'success');
            emitShopUpdated();
            return;
        }
        if (reaction.action === 'ask_user_pay') {
            setCompanionRequest({ charId: char.id, item, speech: reaction.speech });
            return;
        }
        if (reaction.action === 'char_pay') {
            await companionCharPay(char, item, reaction.speech);
        }
    };

    const runCompanionStep = async (char: CharacterProfile, step: ShopCompanionScriptStep, runId: number) => {
        const stepStillActive = () => companionRunRef.current === runId;
        if (!stepStillActive()) return;
        const item = step.itemId ? getShopItem(step.itemId) : undefined;
        let speech = (step.speech || '').trim();
        if (step.delayMs) await waitCompanion(step.delayMs);
        if (!stepStillActive()) return;

        if (step.action === 'say') {
            if (!speech) {
                speech = await companionSpeech(char, 'idle', {
                    surface: companionSurfaceNow(),
                    visibleItems: visibleItemsForCompanion(),
                    cart,
                    userAction: '陪逛脚本有说话动作但没有台词，需要补一句不沉默',
                }, companionFallbackLine('say'));
                if (!stepStillActive()) return;
            }
            setCompanionFocus(undefined, speech, step.action, char);
            await waitCompanion(520);
            return;
        }
        if (!item) return;

        if (!speech) {
            speech = await companionSpeech(char, 'focus_item', {
                surface: companionSurfaceNow(),
                item,
                visibleItems: visibleItemsForCompanion(item),
                cart,
                userAction: `陪逛动作 ${step.action} 没有台词，需要按角色补一句`,
            }, companionFallbackLine(step.action, item));
            if (!stepStillActive()) return;
        }

        const pushDeclineHijackLine = async () => {
            const reply = await companionSpeech(char, 'decline_hijack', {
                surface: 'item',
                item,
                cart,
                userAction: `用户拒绝了围绕 ${item.name} 的陪逛拦停 / 付款推进`,
            });
            if (!stepStillActive()) return;
            if (reply) pushCompanionLine(reply, 'say', item.id);
        };

        if (step.action === 'scroll_to_item' || step.action === 'point') {
            setCompanionFocus(item.id, speech, step.action, char);
            await scrollToCompanionItem(item.id);
            await waitCompanion(520);
            return;
        }
        if (step.action === 'open_item') {
            setCompanionFocus(item.id, speech, step.action, char);
            await scrollToCompanionItem(item.id);
            if (!stepStillActive()) return;
            setDetailItem(item);
            recordFootprint(item);
            await waitCompanion(720);
            return;
        }
        if (step.action === 'add_user_cart') {
            setCompanionFocus(item.id, speech, step.action, char);
            const qty = step.qty || 1;
            const nextCart = addToCart(userProfile.shopCart, item.id, qty);
            updateUserProfile({ shopCart: nextCart });
            addToast(`${char.name} 把 ${item.emoji}${item.name} 放进篮子`, 'success');
            emitShopUpdated();
            await waitCompanion(620);
            return;
        }
        if (step.action === 'want') {
            setCompanionFocus(item.id, speech, step.action, char);
            updateCharacter(char.id, { shopCart: addToCart(char.shopCart, item.id) });
            addToast(`${char.name} 看中了 ${item.emoji}${item.name}`, 'success');
            emitShopUpdated();
            await waitCompanion(620);
            return;
        }
        if (step.action === 'ask_user_pay') {
            setCompanionFocus(item.id, speech, step.action, char);
            await scrollToCompanionItem(item.id);
            if (!stepStillActive()) return;
            const accepted = await waitForCompanionHijack(char, item, speech, step.action);
            if (!stepStillActive()) return;
            if (!accepted) { await pushDeclineHijackLine(); return; }
            setCompanionRequest({ charId: char.id, item, speech });
            await waitCompanion(620);
            return;
        }
        if (step.action === 'auto_user_pay') {
            setCompanionFocus(item.id, speech, step.action, char);
            await scrollToCompanionItem(item.id);
            if (!stepStillActive()) return;
            const accepted = await waitForCompanionHijack(char, item, speech, step.action);
            if (!stepStillActive()) return;
            if (!accepted) { await pushDeclineHijackLine(); return; }
            await companionAutoUserPay(char, item, speech);
            await waitCompanion(620);
            return;
        }
        if (step.action === 'char_pay') {
            setCompanionFocus(item.id, speech, step.action, char);
            await scrollToCompanionItem(item.id);
            if (!stepStillActive()) return;
            const accepted = await waitForCompanionHijack(char, item, speech, step.action);
            if (!stepStillActive()) return;
            if (!accepted) { await pushDeclineHijackLine(); return; }
            await companionCharPay(char, item, speech);
            await waitCompanion(620);
        }
    };

    const runCompanionScript = async (char: CharacterProfile, script: ShopCompanionScript) => {
        const runId = companionRunRef.current + 1;
        companionRunRef.current = runId;
        let usedAutoPay = false;
        for (const step of script.steps) {
            if (companionRunRef.current !== runId) break;
            const safeStep = step.action === 'auto_user_pay' && usedAutoPay
                ? { ...step, action: 'want' as const, speech: step.speech || '这件也想要，我先记下来。' }
                : step;
            if (safeStep.action === 'auto_user_pay') usedAutoPay = true;
            await runCompanionStep(char, safeStep, runId);
        }
    };

    const runCompanionReaction = async (
        surface: ShopCompanionSurface,
        opts: { item?: ShopItem; visibleItems?: ShopItem[]; cart?: typeof cart; userAction?: string; force?: boolean } = {},
        charOverride?: CharacterProfile,
    ) => {
        const char = charOverride || companion;
        if (!char || (companionBusy && !opts.force)) return;
        if (companionBusy && opts.force) {
            cancelCompanionAsyncWork();
            setCompanionBusy(false);
            setCompanionPreparing(false);
            setCompanionHijack(null);
        }
        const requestSession = companionSessionRef.current;
        const isCurrentSession = () => companionSessionRef.current === requestSession;
        const now = Date.now();
        if (!opts.force && now - lastCompanionAtRef.current < 1800) return;
        lastCompanionAtRef.current = now;
        setCompanionBusy(true);
        try {
            const visibleItems = opts.visibleItems || visibleItemsForCompanion(opts.item);
            const visibleItemIds = visibleItems.map(item => item.id);
            const fullCharacterSetting = buildFullCharacterSetting(char, { includeMemos: true });
            let script: ShopCompanionScript | null = null;
            const api = resolveAuxApi(auxApiConfig, apiConfig);
            if (api.apiKey) {
                try {
                    const activeUserSetting = await buildFullActiveUserSetting(userProfile);
                    if (!isCurrentSession()) return;
                    const { system, user } = buildShopCompanionPrompt(
                        { name: char.name, personaText: fullCharacterSetting, affection: char.affection },
                        userProfile.name || '你',
                        {
                            surface,
                            item: opts.item,
                            visibleItems,
                            cart: opts.cart || cart,
                            userAction: opts.userAction,
                            budget: Math.round(80 + (char.affection ?? 50) * 4),
                            userBalance: balance,
                        },
                        activeUserSetting,
                    );
                    const raw = await llmComplete(api, [{ role: 'system', content: system }, { role: 'user', content: user }], {
                        temperature: 0.88,
                        maxTokens: 620,
                        presetScope: 'role.scene',
                        presetMacros: { charName: char.name, userName: userProfile.name || '你' },
                        meta: makeApiUsageMeta('shop.generate', {
                            apiRole: api.apiRole || 'aux',
                            apiBinding: api.apiBinding || '陪逛反应',
                            charId: char.id,
                            charName: char.name,
                        }),
                    });
                    if (!isCurrentSession()) return;
                    script = parseShopCompanionScript(raw, opts.item?.id, visibleItemIds);
                    if (!script) {
                        const legacy = parseShopCompanionReaction(raw, opts.item?.id, visibleItemIds);
                        if (legacy) {
                            const action: ShopCompanionScriptStep['action'] = legacy.action === 'comment' ? 'say' : legacy.action as ShopCompanionScriptStep['action'];
                            script = { steps: [{ action, itemId: legacy.itemId, speech: legacy.speech }] };
                        }
                    }
                } catch { /* fallback below */ }
            }
            if (!script) {
                const fallbackItem = opts.item || pickShopCompanionFallbackItem(visibleItems, {
                    name: char.name,
                    personaText: fullCharacterSetting,
                    affection: char.affection,
                }, Math.round(80 + (char.affection ?? 50) * 4));
                script = await fallbackCompanionScript(char, surface, fallbackItem, visibleItems);
                if (!isCurrentSession()) return;
            }
            await runCompanionScript(char, script);
        } finally {
            if (isCurrentSession()) setCompanionBusy(false);
        }
    };

    const chooseCompanion = (char: CharacterProfile) => {
        cancelCompanionAsyncWork();
        setCompanionId(char.id);
        setCompanionPicker(false);
        setCompanionLog([]);
        setCompanionLogSheet(false);
        setCompanionRequest(null);
        setCompanionHijack(null);
        setCompanionNotice(null);
        setCompanionCue(null);
        setCompanionBusy(false);
        setCompanionPreparing(true);
        const prepareSession = companionSessionRef.current;
        void (async () => {
            await Promise.all([
                runCompanionReaction(tab === 'cart' ? 'cart' : tab === 'my' ? 'my' : tab === 'category' ? 'category' : 'home', {
                    visibleItems: visibleItemsForCompanion(),
                    cart,
                    userAction: '刚开始一起逛心意铺',
                    force: true,
                }, char),
                waitCompanion(780),
            ]);
            if (companionSessionRef.current === prepareSession) setCompanionPreparing(false);
        })();
    };

    const cancelCompanionRun = async () => {
        const char = companion;
        cancelCompanionAsyncWork();
        const stopSession = companionSessionRef.current;
        setCompanionBusy(false);
        setCompanionPreparing(false);
        setCompanionHijack(null);
        setCompanionCue(null);
        if (char) {
            const fallbackLine = '拉回来了，我先陪你看眼前这屏。';
            setCompanionFocus(undefined, fallbackLine, 'say', char);
            const line = await companionSpeech(char, 'stop', {
                surface: tab === 'cart' ? 'cart' : tab === 'my' ? 'my' : tab === 'category' ? 'category' : 'home',
                visibleItems: visibleItemsForCompanion(),
                cart,
                userAction: '用户把你拉回当前货架，请立刻回到这一屏继续一起逛',
            }, fallbackLine);
            if (companionSessionRef.current === stopSession && line && line !== fallbackLine) setCompanionFocus(undefined, line, 'say', char);
        }
    };

    const addCompanionRequestToWishlist = async () => {
        const req = companionRequest;
        const char = req ? characters.find(c => c.id === req.charId) : null;
        if (!req || !char) return;
        updateCharacter(char.id, { shopCart: addToCart(char.shopCart, req.item.id) });
        const line = await companionSpeech(char, 'wishlist_saved', {
            surface: 'item',
            item: req.item,
            cart,
            userAction: `用户没有立刻付款，把 ${req.item.name} 先记进心愿单`,
        });
        if (line) pushCompanionLine(line, 'want', req.item.id);
        addToast(`${char.name} 的心愿单夹进 ${req.item.emoji}${req.item.name}`, 'success');
        emitShopUpdated();
        setCompanionRequest(null);
    };

    const payCompanionRequest = async () => {
        const req = companionRequest;
        const char = req ? characters.find(c => c.id === req.charId) : null;
        if (!req || !char) return;
        if (balance < req.item.price) { addToast('钱包不够替 TA 付呢', 'error'); return; }
        adjustUserBalance(-req.item.price, {
            note: `陪 ${char.name} 逛心意铺代付 ${req.item.name}`,
            category: 'shopping',
            kind: 'shop-companion-pay',
            sourceApp: '心意铺',
            sourceId: req.item.id,
            relatedEntityId: char.id,
        });
        const charReceipt = makeReceipt(req.item, 'char', 'buy', 'self', char.name, `${userProfile.name || '我'}陪逛代付`);
        const userReceipt = makeReceipt(req.item, 'user', 'gift', char.id, char.name, '陪逛代付');
        updateCharacter(char.id, {
            shopCart: removeFromCart(char.shopCart, req.item.id),
            shopReceipts: [charReceipt, ...(char.shopReceipts || [])],
        });
        updateUserProfile({ shopReceipts: [userReceipt, ...(userProfile.shopReceipts || [])] });
        try {
            const messageId = await DB.saveMessage({
                charId: char.id, role: 'system', type: 'text',
                content: `${userProfile.name || '你'} 替 ${char.name} 付了 ${req.item.emoji}${req.item.name}（¥${formatPrice(req.item.price)}）`,
            } as any);
            queueShopReply({
                charId: char.id,
                messageId,
                kind: 'companion_pay',
                itemName: req.item.name,
                itemEmoji: req.item.emoji,
                note: '你答应了 TA 的陪逛代付请求',
                itemCount: 1,
                total: req.item.price,
            });
        } catch { /* ignore */ }
        const line = await companionSpeech(char, 'payment_received', {
            surface: 'item',
            item: req.item,
            cart,
            userAction: `用户答应陪逛代付并买下 ${req.item.name}`,
        }, req.speech);
        if (line) pushCompanionLine(line, 'want', req.item.id);
        addToast(`替 ${char.name} 付了 ${req.item.emoji}${req.item.name}`, 'success');
        showPaymentNotice(req.item, 'user', line || req.speech);
        emitShopUpdated();
        setCompanionRequest(null);
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
        addToast(`已签收 · ${owned.length} 件进了柜子`, 'success');
        emitShopUpdated();
    };

    // 申请退款（仅自己支付且未收货的订单）：退回钱包（+返还所用金币）+ 标记 refundedAt
    const requestRefund = (order: ShopOrder) => {
        if (order.paidBy !== 'self' || order.receivedAt || order.refundedAt) return;
        adjustUserBalance(order.total, {
            note: `心意铺退款 ${order.id}`,
            category: 'refund',
            kind: 'shop-refund',
            sourceApp: '心意铺',
            sourceId: order.id,
        });
        const refundCoins = order.coinDiscount ? yuanToCoins(order.coinDiscount) : 0;
        updateUserProfile({
            shopOrders: (userProfile.shopOrders || []).map(o => o.id === order.id ? { ...o, refundedAt: Date.now() } : o),
            ...(refundCoins ? { shopCoins: (userProfile.shopCoins || 0) + refundCoins } : {}),
        });
        addToast(`已退 ¥${formatPrice(order.total)} 回钱包`, 'success');
        emitShopUpdated();
    };

    // 写评价：存一条用户评价（按 orderId+itemId 唯一）+ 奖励 5 心意币
    const submitReview = (order: ShopOrder, item: ShopOrderItem, stars: number, text: string) => {
        const review = makeUserReview(item.itemId, order.id, stars, text);
        updateUserProfile({
            shopReviews: [review, ...(userProfile.shopReviews || [])],
            shopCoins: (userProfile.shopCoins || 0) + 5,
        });
        addToast('谢谢留言，+5 心意币 ◑', 'success');
        emitShopUpdated();
    };

    // 每日签到领心意币
    const doCheckin = () => {
        if (!checkinAvailable(userProfile.shopCheckinAt)) { addToast('今天的章已经盖过啦，明儿再来', 'info'); return; }
        const reward = dailyCheckinReward();
        updateUserProfile({ shopCoins: (userProfile.shopCoins || 0) + reward, shopCheckinAt: Date.now() });
        addToast(`盖章成功，+${reward} 心意币 ◑`, 'success');
    };

    // ── 购买（下单 → 物流 → 确认收货才进背包；支持数量 / 秒杀价） ──
    const buyItem = (item: ShopItem, qty = 1, priceOverride?: number) => {
        const unit = priceOverride != null ? priceOverride : item.price;
        const cost = Math.round(unit * qty * 100) / 100;
        if (balance < cost) { addToast('钱包不够啦，去存钱罐攒点', 'error'); return; }
        adjustUserBalance(-cost, {
            note: `心意铺下单 ${item.name}`,
            category: 'shopping',
            kind: 'shop-purchase',
            sourceApp: '心意铺',
            sourceId: item.id,
        });
        placeOrder([{ item: priceOverride != null ? { ...item, price: unit } : item, qty }], 'self');
        addToast(`已下单 ${item.emoji}${item.name}${qty > 1 ? `×${qty}` : ''}，正在寄出`, 'success');
        setTab('my'); setSub('orders'); setOrderFilter('toReceive');
    };

    // 优惠券：领取（存 id）
    const claimCoupon = (id: string) => {
        if (claimedCoupons.includes(id)) { addToast('这张券已经夹进账本了', 'info'); return; }
        updateUserProfile({ shopCoupons: [id, ...claimedCoupons] });
        addToast('减价券已收下 ✂', 'success');
    };

    // ── 购物车 ──
    const addItemToCart = (item: ShopItem, qty = 1) => {
        const nextCart = addToCart(userProfile.shopCart, item.id, qty);
        updateUserProfile({ shopCart: nextCart });
        addToast(`放进篮子 ${item.emoji}${qty > 1 ? `×${qty}` : ''}`, 'success');
        emitShopUpdated();
        void runCompanionReaction('cart', { item, cart: nextCart, userAction: `把 ${item.name} 放进篮子` });
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

    // 自己支付：选中商品 + 满减券 + 心意币抵现
    const [useCoins, setUseCoins] = useState(false);
    const checkoutSelf = () => {
        const lines = selectedLines;
        if (lines.length === 0) { addToast('先勾上要结的几件', 'info'); return; }
        const total = lines.reduce((s, { item, qty }) => s + Math.round(item.price * 100) * qty, 0) / 100;
        const coupon = bestCoupon(claimedCoupons, total);
        const afterCoupon = applyCoupon(total, coupon);
        const coinDiscount = useCoins ? coinsToYuan(coins, afterCoupon) : 0;
        const payable = Math.round((afterCoupon - coinDiscount) * 100) / 100;
        if (balance < payable) { addToast('钱包不够，先去存钱罐攒点', 'error'); return; }
        adjustUserBalance(-payable, {
            note: `心意铺购物车结算 ${lines.length}件`,
            category: 'shopping',
            kind: 'shop-checkout',
            sourceApp: '心意铺',
        });
        if (coinDiscount > 0) updateUserProfile({ shopCoins: Math.max(0, coins - yuanToCoins(coinDiscount)) });
        const order = makeOrder(lines, 'self');
        order.total = payable;
        if (coinDiscount > 0) order.coinDiscount = coinDiscount;
        const selectedIds = new Set(lines.map(l => l.item.id));
        updateUserProfile({
            shopOrders: [order, ...(userProfile.shopOrders || [])],
            shopCart: (userProfile.shopCart || []).filter(l => !selectedIds.has(l.itemId)),
        });
        const savedBits = [coupon ? `券省¥${formatPrice(coupon.discount)}` : '', coinDiscount > 0 ? `币抵¥${formatPrice(coinDiscount)}` : ''].filter(Boolean).join('、');
        addToast(savedBits ? `${savedBits}，实付 ¥${formatPrice(payable)}` : '已下单，正在寄出', 'success');
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
                content: `我篮子里有：${cartBrief}，一共 ¥${formatPrice(total)}，可以帮我付一下吗～`,
            } as any);
        } catch { /* ignore */ }
        let agree = false; let reply = '';
        try {
            const api = resolveAuxApi(auxApiConfig, apiConfig);
            const sys = `你是「${char.name}」。请按完整角色设定和完整用户设定做决定。\n${buildFullCharacterSetting(char, { includeMemos: true })}\n\n${await buildFullActiveUserSetting(userProfile)}`;
            const usr = `${userProfile.name || '对方'} 让你帮 TA 代付购物车（共 ¥${formatPrice(total)}：${cartBrief}）。请完全按你的完整设定、对方的完整设定、你们的关系亲密度和这个金额决定愿不愿意付。\n只输出 JSON：{"pay": true 或 false, "reply": "你对 TA 说的一句话，第一人称，30字内，贴人设"}`;
            const raw = await llmComplete(api, [{ role: 'system', content: sys }, { role: 'user', content: usr }], {
                temperature: 0.8,
                maxTokens: 200,
                meta: makeApiUsageMeta('shop.generate', {
                    apiRole: api.apiRole || 'aux',
                    apiBinding: api.apiBinding || '代付回应',
                    charId: char.id,
                    charName: char.name,
                }),
            });
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
            addToast(`${char.name} 替你付了 ¥${formatPrice(total)}，正在寄出`, 'success');
            setTab('my'); setSub('orders'); setOrderFilter('toReceive');
        } else {
            try {
                await DB.saveMessage({ charId: char.id, role: 'assistant', type: 'text', content: reply || '这个有点超预算啦，下次的好不好～' } as any);
            } catch { /* ignore */ }
            addToast(`${char.name} 这次没点头`, 'info');
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
        if (balance < total) { addToast('钱包不够替 TA 付呢', 'error'); return; }
        adjustUserBalance(-total, {
            note: `代付 ${char.name} 心意铺购物车`,
            category: 'shopping',
            kind: 'shop-char-cart',
            sourceApp: '心意铺',
            sourceId: char.id,
            relatedEntityId: char.id,
        });
        const charReceipts = items.map(it => makeReceipt(it, 'char', 'buy', 'self', char.name, `${userProfile.name || '我'}代付`));
        const userReceipts = items.map(it => makeReceipt(it, 'user', 'gift', char.id, char.name, '代付'));
        updateCharacter(char.id, { shopCart: [], shopReceipts: [...charReceipts, ...(char.shopReceipts || [])] });
        updateUserProfile({ shopReceipts: [...userReceipts, ...(userProfile.shopReceipts || [])] });
        const cartBrief = resolveCart(char.shopCart).map(({ item, qty }) => `${item.emoji}${item.name}×${qty}`).join('、');
        try {
            const messageId = await DB.saveMessage({
                charId: char.id, role: 'system', type: 'text',
                content: `${userProfile.name || '你'} 帮 ${char.name} 清空了心愿购物车（${items.length}件，¥${formatPrice(total)}）`,
            } as any);
            queueShopReply({
                charId: char.id,
                messageId,
                kind: 'clear_cart',
                itemName: '心愿购物车',
                itemEmoji: '🛒',
                note: cartBrief,
                itemCount: items.length,
                total,
            });
        } catch { /* ignore */ }
        addToast(`替 ${char.name} 付了 ¥${formatPrice(total)}`, 'success');
        emitShopUpdated();
    };

    const addItemToCharWishlist = (item: ShopItem, char: CharacterProfile) => {
        updateCharacter(char.id, { shopCart: addToCart(char.shopCart, item.id) });
        addToast(`${char.name} 的心愿单夹进 ${item.emoji}${item.name}`, 'success');
        emitShopUpdated();
    };

    // ── 送礼给角色 ──
    const [giftTarget, setGiftTarget] = useState<ShopOwnedItem | null>(null);
    const [giftNote, setGiftNote] = useState('');
    const [wishItem, setWishItem] = useState<ShopItem | null>(null);
    const confirmGift = async (char: CharacterProfile) => {
        const owned = giftTarget;
        if (!owned) return;
        const base = getShopItem(owned.itemId) || { id: owned.itemId, name: owned.name, emoji: owned.emoji, price: owned.price };
        const note = giftNote.trim();
        let giftMessageId: number | null = null;
        try {
            giftMessageId = await DB.saveMessage({
                charId: char.id, role: 'user', type: 'gift_card',
                content: `🎁 我送了你 ${owned.emoji}${owned.name}${note ? ` —— ${note}` : ''}`,
                metadata: { gift: buildGiftCardMeta(base, userProfile.name || '我', note), msgStatus: 'sent' },
            } as any);
        } catch { /* 落卡失败不阻塞送礼 */ }
        const userReceipt = makeReceipt(base, 'user', 'gift', char.id, char.name, note);
        const charReceipt = makeReceipt(base, 'char', 'receive', 'user', userProfile.name || '我', note);
        updateCharacter(char.id, { shopReceipts: [charReceipt, ...(char.shopReceipts || [])] });
        updateUserProfile({
            shopInventory: (userProfile.shopInventory || []).filter(o => o.uid !== owned.uid),
            shopReceipts: [userReceipt, ...(userProfile.shopReceipts || [])],
        });
        if (giftMessageId != null) {
            queueShopReply({
                charId: char.id,
                messageId: giftMessageId,
                kind: 'gift',
                itemName: owned.name,
                itemEmoji: owned.emoji,
                note,
            });
        }
        addToast(`把 ${owned.emoji}${owned.name} 寄给了 ${char.name}`, 'success');
        emitShopUpdated();
        setGiftTarget(null); setGiftNote('');
    };

    const onCharShop = async (char: CharacterProfile) => {
        const budget = Math.round(100 + (char.affection ?? 50) * 4);
        const shelf = catalog.length ? catalog : SHOP_ITEMS;
        const { system, user } = buildCharShopPrompt(
            { name: char.name, personaText: buildFullCharacterSetting(char, { includeMemos: true }) },
            userProfile.name || '你',
            budget,
            shelf,
            await buildFullActiveUserSetting(userProfile),
        );
        let decision = null as ReturnType<typeof parseCharShopDecision>;
        try {
            const api = resolveAuxApi(auxApiConfig, apiConfig);
            const raw = await llmComplete(api, [
                { role: 'system', content: system }, { role: 'user', content: user },
            ], {
                temperature: 0.9,
                maxTokens: 300,
                meta: makeApiUsageMeta('shop.generate', {
                    apiRole: api.apiRole || 'aux',
                    apiBinding: api.apiBinding || '角色逛心意铺',
                    charId: char.id,
                    charName: char.name,
                }),
            });
            decision = parseCharShopDecision(raw);
        } catch { /* 用兜底 */ }
        if (!decision) {
            const affordable = shelf.filter(i => i.price <= budget);
            const pool = affordable.length ? affordable : shelf;
            const pick = pool[Math.floor(Math.random() * pool.length)];
            decision = { action: Math.random() < 0.5 ? 'gift' : 'buy', itemId: pick.id, note: '' };
        }
        const item = getShopItem(decision.itemId)!;
        if (decision.action === 'want') {
            updateCharacter(char.id, { shopCart: addToCart(char.shopCart, item.id) });
            addToast(`${char.name} 把 ${item.emoji}${item.name} 记进了心愿单`, 'success');
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
            addToast(`${char.name} 给自己挑了 ${item.emoji}${item.name}`, 'success');
        }
        emitShopUpdated();
    };

    // ── 选规格/数量 sheet ──
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
    const switchTab = (t: MainTab) => {
        setTab(t);
        setSub(null);
        const surface: ShopCompanionSurface = t === 'cart' ? 'cart' : t === 'my' ? 'my' : t === 'category' ? 'category' : 'home';
        void runCompanionReaction(surface, {
            visibleItems: visibleItemsForCompanion(undefined, { tab: t }),
            cart,
            userAction: `切到${t === 'cart' ? '篮子' : t === 'my' ? '我的' : t === 'category' ? '分类' : '货架'}`,
        });
    };

    const shopCategoryLabel = (key: string) =>
        key === 'fav' ? '心头好' : key === 'all' ? '全部' : (SHOP_CATEGORIES.find(c => c.key === key)?.label || key);

    const setHomeCategory = (next: string) => {
        setCat(next);
        void runCompanionReaction('category', {
            visibleItems: visibleItemsForCompanion(undefined, { tab: 'home', cat: next }),
            cart,
            userAction: `切到${shopCategoryLabel(next)}`,
        });
    };

    const setCategoryPageCategory = (next: string) => {
        setCategoryTabCat(next);
        void runCompanionReaction('category', {
            visibleItems: visibleItemsForCompanion(undefined, { tab: 'category', categoryTabCat: next }),
            cart,
            userAction: `切到${shopCategoryLabel(next)}`,
        });
    };

    const companionSurfaceNow = (): ShopCompanionSurface =>
        tab === 'cart' ? 'cart' : tab === 'my' ? 'my' : tab === 'category' ? 'category' : detailItem ? 'item' : 'home';

    const handleContentScroll = () => {
        if (!companion || companionBusy || sub) return;
        if (companionScrollTimerRef.current != null) window.clearTimeout(companionScrollTimerRef.current);
        companionScrollTimerRef.current = window.setTimeout(() => {
            companionScrollTimerRef.current = null;
            void runCompanionReaction(companionSurfaceNow(), {
                visibleItems: visibleItemsForCompanion(detailItem || undefined),
                item: detailItem || undefined,
                cart,
                userAction: '滑到这一屏继续一起看',
            });
        }, 520);
    };

    const navItems: { id: MainTab; label: string; Icon: React.ElementType }[] = [
        { id: 'home', label: '货架', Icon: House },
        { id: 'category', label: '分类', Icon: SquaresFour },
        { id: 'cart', label: '篮子', Icon: ShoppingCart },
        { id: 'my', label: '我的', Icon: User },
    ];

    const subTitle: Record<Exclude<SubView, null>, string> = {
        orders: '寄件记录', bag: '我的柜子', receipts: '心意账本',
        fav: '心头好', footprints: '翻看过的', coupons: '撕券处', advisor: '心意参谋',
    };
    const subEn: Record<Exclude<SubView, null>, string> = {
        orders: 'PARCELS', bag: 'CABINET', receipts: 'LEDGER',
        fav: 'FAVOURITES', footprints: 'FOOTPRINTS', coupons: 'COUPONS', advisor: 'GIFT ADVISOR',
    };
    const activeCompanionCue = companion ? companionCue : null;
    const activeCompanionAvatar = companion ? (companion.convoSettings?.charAvatarOverride || companion.avatar) : undefined;

    return (
        <div className="relative h-full w-full flex flex-col overflow-hidden animate-fade-in" style={{ color: INK, background: PAGE_BG }}>
            <PaperBackdrop corners={false} />

            {/* 顶栏：胶带返回钮 + 招牌 + 心意币/钱包小票 */}
            <div className="relative z-20 shrink-0 px-4 pt-2 pb-2">
                <div className="flex items-center gap-2" style={SHOP_VIEWPORT}>
                    <button onClick={sub ? () => setSub(null) : closeApp}
                        className="relative inline-flex items-center gap-1 px-3 py-2 text-[12px] font-black active:scale-95 transition-transform" style={{ color: '#36322b' }}>
                        <span aria-hidden className="absolute inset-0 rounded-[6px]" style={{ backgroundColor: WASHI.butter.base, backgroundImage: TAPE_STRIPES, transform: 'rotate(-2deg)', boxShadow: '0 3px 7px -3px rgba(31,29,26,0.5)' }} />
                        <span className="relative z-10 flex items-center gap-1"><CaretLeft size={13} weight="bold" />{sub ? '返回' : '收起'}</span>
                    </button>
                    <div className="leading-none">
                        <div className="text-[16px] font-black tracking-[0.04em]" style={{ color: INK }}>{sub ? subTitle[sub] : '心意铺'}</div>
                        <div className="text-[7px] tracking-[0.36em] uppercase mt-0.5" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>{sub ? subEn[sub] : 'A LITTLE GIFT STALL'}</div>
                    </div>
                    <div className="flex-1" />
                    <button onClick={() => setCompanionPicker(true)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-black active:scale-95 transition-transform max-w-[92px]"
                        style={{ background: companion ? 'rgba(255,253,247,0.9)' : INK, color: companion ? INK : PAPER, border: companion ? '1px dashed rgba(150,144,132,0.6)' : 'none' }}>
                        {companion ? (
                            <img src={companion.convoSettings?.charAvatarOverride || companion.avatar} className="w-4 h-4 rounded-full object-cover shrink-0" />
                        ) : <User size={13} weight="fill" />}
                        <span className="truncate">{companion ? (companion.convoSettings?.remarkName?.trim() || companion.name) : '陪逛'}</span>
                    </button>
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-black tabular-nums" style={{ background: 'rgba(255,253,247,0.85)', color: INK, border: '1px dashed rgba(150,144,132,0.6)' }}>
                        <span style={{ color: INK }}>◑</span>{coins}
                    </span>
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-black tabular-nums" style={{ background: INK, color: PAPER }}>
                        <Wallet size={13} weight="fill" />¥{formatPrice(balance)}
                    </span>
                </div>
            </div>

            {/* 内容区 */}
            <div onScroll={handleContentScroll} className="relative z-10 flex-1 overflow-y-auto no-scrollbar px-4 pb-6" style={SHOP_VIEWPORT}>
                {!sub && (
                    <ShopCompanionStrip
                        companion={companion}
                        busy={companionBusy}
                        preparing={companionPreparing}
                        latest={companionLog[0]}
                        logCount={companionLog.length}
                        onPick={() => setCompanionPicker(true)}
                        onEnd={finishCompanion}
                        onSkip={cancelCompanionRun}
                        onLog={() => setCompanionLogSheet(true)}
                        onReact={() => void runCompanionReaction(tab === 'cart' ? 'cart' : tab === 'my' ? 'my' : tab === 'category' ? 'category' : 'home', {
                            visibleItems: visibleItemsForCompanion(detailItem || undefined),
                            cart,
                            item: detailItem || undefined,
                            userAction: '主动问 TA 看法',
                            force: true,
                        })}
                    />
                )}
                {sub === 'advisor' ? (
                    <GiftAdvisorView
                        catalog={catalog.length ? catalog : SHOP_ITEMS}
                        characters={characters}
                        balance={balance}
                        favorites={favorites}
                        onOpen={openDetail}
                        onAddCart={addItemToCart}
                        onBuy={(i) => openSku(i, 'buy')}
                        onAddWish={addItemToCharWishlist}
                        onCharShop={onCharShop}
                        onClearCharCart={clearCharCart}
                    />
                ) : sub === 'orders' ? (
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
                        cat={cat} setCat={setHomeCategory} search={search} setSearch={setSearch}
                        balance={balance} favorites={favorites}
                        charactersCount={characters.length} wishCount={wishCount} onOpenAdvisor={() => setSub('advisor')}
                        claimedCoupons={claimedCoupons} onClaimCoupon={claimCoupon} onBuyFlash={(it, p) => buyItem(it, 1, p)}
                        onCreateItem={() => setEditorTarget({})}
                        onBuy={(i) => openSku(i, 'buy')} onAddCart={addItemToCart}
                        onOpenDetail={openDetail} onToggleFav={toggleFav}
                        companionCue={activeCompanionCue} companionAvatar={activeCompanionAvatar}
                        registerItemRef={registerItemRef}
                    />
                ) : tab === 'category' ? (
                    <CategoryPage catalog={catalog} balance={balance} favorites={favorites}
                        activeCategory={categoryTabCat} onCategoryChange={setCategoryPageCategory}
                        onOpen={openDetail} onToggleFav={toggleFav} onBuy={(i) => openSku(i, 'buy')} onAddCart={addItemToCart}
                        companionCue={activeCompanionCue} companionAvatar={activeCompanionAvatar}
                        registerItemRef={registerItemRef} />
                ) : tab === 'cart' ? (
                    <CartView cart={cart} isSel={isSel} onToggleSel={toggleSel} onQty={changeQty} onRemove={removeCartLine} onClear={clearMyCart} onGoShop={() => switchTab('home')}
                        companionCue={activeCompanionCue} companionAvatar={activeCompanionAvatar}
                        registerItemRef={registerItemRef} />
                ) : (
                    <MyCenter
                        name={userProfile.name || '我'} avatar={userProfile.avatar} balance={balance} coins={coins}
                        counts={counts} checkinDone={checkinDone} onCheckin={doCheckin}
                        bagCount={inventory.length} favCount={favorites.length} footprintCount={footprints.length}
                        couponCount={claimedCoupons.length} wishCount={wishCount}
                        onGoOrders={goOrders} onOpenSub={openSubFromMy}
                    />
                )}
            </div>

            {/* 购物车结算条：自己支付 / 求 TA 代付（多选 + 满减券 + 币抵现） */}
            {tab === 'cart' && !sub && selectedLines.length > 0 && (() => {
                const total = selectedLines.reduce((s, { item, qty }) => s + Math.round(item.price * 100) * qty, 0) / 100;
                const coupon = bestCoupon(claimedCoupons, total);
                const afterCoupon = applyCoupon(total, coupon);
                const coinDiscount = useCoins ? coinsToYuan(coins, afterCoupon) : 0;
                const payable = Math.round((afterCoupon - coinDiscount) * 100) / 100;
                const selCount = selectedLines.reduce((s, l) => s + l.qty, 0);
                return (
                    <div className="relative z-10 shrink-0 px-4 pb-2 pt-2.5" style={{ ...SHOP_VIEWPORT, borderTop: '1px dashed rgba(150,144,132,0.6)', background: 'rgba(246,243,236,0.92)' }}>
                        <div className="flex items-center justify-between mb-1.5">
                            <button onClick={toggleSelAll} className="flex items-center gap-1.5 text-[12px] font-black active:opacity-60" style={{ color: INK_SOFT }}>
                                {allSelected ? <CheckSquare size={18} weight="fill" style={{ color: INK }} /> : <Square size={18} weight="bold" />}全选
                            </button>
                            {coins > 0 && (
                                <button onClick={() => setUseCoins(v => !v)} className="flex items-center gap-1 text-[11px] font-black active:opacity-60" style={{ color: INK }}>
                                    {useCoins ? <CheckSquare size={15} weight="fill" style={{ color: INK }} /> : <Square size={15} weight="bold" />}
                                    <span>◑ 心意币抵现（{coins}）</span>
                                </button>
                            )}
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="flex-1 min-w-0">
                                {(coupon || coinDiscount > 0) && (
                                    <div className="text-[9px] font-black truncate" style={{ color: INK_SOFT }}>
                                        {coupon && `✂ ${coupon.title}`}{coupon && coinDiscount > 0 && ' · '}{coinDiscount > 0 && `◑ 抵 ¥${formatPrice(coinDiscount)}`}
                                    </div>
                                )}
                                <div className="flex items-baseline gap-1.5">
                                    <span className="text-[10px]" style={{ color: INK_SOFT }}>实付</span>
                                    <span className="text-[19px] font-black leading-none" style={{ color: INK }}>¥{formatPrice(payable)}</span>
                                    {(coupon || coinDiscount > 0) && <span className="text-[10px] line-through" style={{ color: 'rgba(150,144,132,0.8)' }}>¥{formatPrice(total)}</span>}
                                </div>
                            </div>
                            <ScrapButton variant="paper" onClick={() => setPayPicker(true)} className="px-3.5 py-2.5 text-[12px]">求 TA 代付</ScrapButton>
                            <ScrapButton variant="ink" onClick={checkoutSelf} disabled={balance < payable} className="px-4 py-2.5 text-[13px]">{balance >= payable ? `结算(${selCount})` : '钱包不足'}</ScrapButton>
                        </div>
                    </div>
                );
            })()}

            {/* 底部导航栏（纸面贴纸条） */}
            <div className="relative z-10 shrink-0 flex items-stretch" style={{ ...SHOP_VIEWPORT, borderTop: '1px dashed rgba(150,144,132,0.6)', background: 'rgba(251,249,242,0.95)', paddingBottom: 'env(safe-area-inset-bottom,0px)' }}>
                {navItems.map(n => {
                    const active = tab === n.id && !sub;
                    const badge = n.id === 'cart' && cartNum > 0 ? cartNum : 0;
                    return (
                        <button key={n.id} onClick={() => switchTab(n.id)}
                            className="flex-1 flex flex-col items-center justify-center gap-0.5 py-1.5 active:scale-95 transition-transform relative"
                            style={{ color: active ? INK : INK_SOFT }}>
                            <n.Icon size={22} weight={active ? 'fill' : 'regular'} />
                            <span className={`text-[10px] ${active ? 'font-black' : 'font-medium'}`}>{n.label}</span>
                            {active && <span aria-hidden className="absolute bottom-0.5 w-5 h-[3px] rounded-full" style={{ background: INK }} />}
                            {badge > 0 && <span className="absolute top-0.5 right-1/2 -mr-4"><InkBadge n={badge} /></span>}
                        </button>
                    );
                })}
            </div>

            {/* 商品详情页 */}
            {detailItem && (
                <ProductDetail
                    item={detailItem} faved={favorites.includes(detailItem.id)} balance={balance}
                    genReviews={genReviews} myReviews={userReviewsForItem(myReviews, detailItem.id)}
                    onClose={() => setDetailItem(null)} onToggleFav={toggleFav}
                    onEdit={(i) => setEditorTarget({ item: i })}
                    onAddCart={(i) => openSku(i, 'cart')} onBuy={(i) => openSku(i, 'buy')}
                    onAddWish={(i) => setWishItem(i)}
                    companionCue={activeCompanionCue?.itemId === detailItem.id ? activeCompanionCue : null}
                    companionAvatar={activeCompanionAvatar}
                />
            )}

            {/* 选规格/数量 sheet */}
            {skuSheet && (
                <SkuSheet item={skuSheet.item} mode={skuSheet.mode} balance={balance}
                    onClose={() => setSkuSheet(null)} onConfirm={confirmSku} />
            )}

            {editorTarget && (
                <ProductEditorSheet item={editorTarget.item}
                    onClose={() => setEditorTarget(null)}
                    onSave={saveEditorItem} />
            )}

            {/* 物流详情 */}
            {logisticsOrder && (
                <LogisticsSheet order={logisticsOrder} onClose={() => setLogisticsOrder(null)} />
            )}

            {/* 写评价 */}
            <ReviewModal target={reviewTarget} onClose={() => setReviewTarget(null)}
                onSubmit={(stars, text) => { if (reviewTarget) { submitReview(reviewTarget.order, reviewTarget.item, stars, text); setReviewTarget(null); } }} />

            {/* 送礼：选角色 */}
            <PaperDialog open={!!giftTarget} title={giftTarget ? `把 ${giftTarget.emoji}${giftTarget.name} 寄给…` : ''} en="SEND A GIFT" tape="rose"
                onClose={() => { setGiftTarget(null); setGiftNote(''); }}>
                <div className="space-y-3">
                    <textarea value={giftNote} onChange={e => setGiftNote(e.target.value)} placeholder="夹一句赠言（可选）" rows={2}
                        className="w-full px-3 py-2 rounded-xl text-sm outline-none resize-none" style={paperInput} />
                    {characters.length === 0 ? (
                        <div className="text-center text-xs py-6" style={{ color: INK_SOFT }}>还没有角色，先去添加好友吧</div>
                    ) : (
                        <div className="flex flex-wrap gap-3 justify-center max-h-56 overflow-y-auto no-scrollbar pt-1">
                            {characters.map((c, i) => (
                                <Polaroid key={c.id} src={c.convoSettings?.charAvatarOverride || c.avatar}
                                    caption={c.convoSettings?.remarkName?.trim() || c.name} size={52} rotate={i % 2 ? 2 : -2}
                                    onClick={() => confirmGift(c)} />
                            ))}
                        </div>
                    )}
                </div>
            </PaperDialog>

            {/* 记心愿：选角色 */}
            <PaperDialog open={!!wishItem} title={wishItem ? `把 ${wishItem.emoji}${wishItem.name} 夹进谁的心愿？` : ''} en="WISHLIST" tape="sage"
                onClose={() => setWishItem(null)}>
                <div className="space-y-3">
                    <div className="text-[12px] leading-relaxed" style={{ color: INK_SOFT }}>
                        心愿单不会立刻扣款，只是帮 TA 把想要的东西记下来；以后可在心意参谋里代付或清空。
                    </div>
                    {characters.length === 0 ? (
                        <div className="text-center text-xs py-6" style={{ color: INK_SOFT }}>还没有角色</div>
                    ) : (
                        <div className="flex flex-wrap gap-3 justify-center max-h-56 overflow-y-auto no-scrollbar pt-1">
                            {characters.map((c, i) => (
                                <Polaroid key={c.id} src={c.convoSettings?.charAvatarOverride || c.avatar}
                                    caption={c.convoSettings?.remarkName?.trim() || c.name} size={52} rotate={i % 2 ? -2 : 2}
                                    onClick={() => { if (wishItem) addItemToCharWishlist(wishItem, c); setWishItem(null); }} />
                            ))}
                        </div>
                    )}
                </div>
            </PaperDialog>

            {/* 陪逛：选择一个角色一起看货架 */}
            <ShopCompanionPickerOverlay
                open={companionPicker}
                characters={characters}
                activeId={companionId}
                search={companionSearch}
                onSearch={setCompanionSearch}
                onChoose={chooseCompanion}
                onClose={() => setCompanionPicker(false)}
                onEnd={() => { finishCompanion(); setCompanionPicker(false); }}
            />

            {/* 陪逛：角色看中商品，请用户决定是否付款 */}
            <ShopCompanionPayRequestOverlay
                request={companionRequest}
                companion={companionRequest ? characters.find(c => c.id === companionRequest.charId) || companion : companion}
                balance={balance}
                onClose={() => setCompanionRequest(null)}
                onWishlist={() => void addCompanionRequestToWishlist()}
                onPay={() => void payCompanionRequest()}
            />

            {/* 求代付：选一个角色帮忙付购物车 */}
            <PaperDialog open={payPicker} title="求 TA 替你付篮子" en="ASK TO PAY" tape="amber"
                onClose={() => { if (!payReqBusy) setPayPicker(false); }}>
                <div className="space-y-3">
                    <div className="text-[12px]" style={{ color: INK_SOFT }}>合计 ¥{formatPrice(cartTotal(cart))} · 选一个角色，TA 会按心情和你们的关系决定要不要替你付</div>
                    {characters.length === 0 ? (
                        <div className="text-center text-xs py-6" style={{ color: INK_SOFT }}>还没有角色</div>
                    ) : (
                        <div className="flex flex-wrap gap-3 justify-center max-h-56 overflow-y-auto no-scrollbar pt-1">
                            {characters.map((c, i) => (
                                <Polaroid key={c.id} src={c.convoSettings?.charAvatarOverride || c.avatar}
                                    caption={c.convoSettings?.remarkName?.trim() || c.name} size={52} rotate={i % 2 ? -2 : 2}
                                    onClick={() => { if (!payReqBusy) requestCharPay(c); }} />
                            ))}
                        </div>
                    )}
                    {payReqBusy && <div className="text-center text-[12px] font-black" style={{ color: INK }}>正在问 TA…</div>}
                </div>
            </PaperDialog>

            <ShopPreparingOverlay open={companionPreparing} companion={companion} />
            <ShopHijackOverlay
                hijack={companionHijack}
                companion={companionHijack ? characters.find(c => c.id === companionHijack.charId) || companion : companion}
                onReject={() => resolveCompanionHijack(false)}
                onAccept={() => resolveCompanionHijack(true)}
            />
            <ShopPaymentNoticeOverlay notice={companionNotice} onClose={() => setCompanionNotice(null)} />
            <ShopCompanionLogSheet open={companionLogSheet} logs={companionLog} onClose={() => setCompanionLogSheet(false)} />
        </div>
    );
};

const ShopCompanionStrip: React.FC<{
    companion: CharacterProfile | null;
    busy: boolean;
    preparing?: boolean;
    latest?: CompanionLog;
    logCount: number;
    onPick: () => void;
    onEnd: () => void;
    onSkip: () => void;
    onLog: () => void;
    onReact: () => void;
}> = ({ companion, busy, preparing, latest, logCount, onPick, onEnd, onSkip, onLog, onReact }) => {
    if (!companion) {
        return (
            <button onClick={onPick}
                className="w-full mb-3 rounded-[22px] px-3 py-3 flex items-center gap-3 text-left active:scale-[0.99] transition-transform overflow-hidden relative"
                style={{ background: VIDEO_BLACK, color: '#fff', boxShadow: '0 18px 36px -22px rgba(17,17,17,0.72)' }}>
                <div aria-hidden className="absolute inset-0 opacity-[0.08]" style={{ backgroundImage: HALFTONE, backgroundSize: '7px 7px' }} />
                <div className="relative w-11 h-11 rounded-2xl flex items-center justify-center shrink-0" style={{ background: '#fff', color: VIDEO_BLACK }}>
                    <User size={21} weight="fill" />
                </div>
                <div className="relative flex-1 min-w-0">
                    <div className="text-[8px] tracking-[0.34em] uppercase" style={{ fontFamily: 'var(--font-label)', opacity: 0.72 }}>CO-PRESENCE</div>
                    <div className="text-[15px] font-black mt-0.5">邀请 TA 一起逛</div>
                    <div className="text-[11px] truncate mt-0.5" style={{ opacity: 0.78 }}>角色会进入陪逛状态，在商品上直接给你反应</div>
                </div>
                <CaretRight size={18} weight="bold" className="relative shrink-0" />
            </button>
        );
    }
    const name = companion.convoSettings?.remarkName?.trim() || companion.name;
    return (
        <div className="mb-3 rounded-[22px] p-2.5 flex items-center gap-2.5 relative overflow-hidden" style={{ background: '#fff', border: `1px solid ${VIDEO_LINE}`, boxShadow: '0 18px 36px -26px rgba(17,17,17,0.42)' }}>
            <div aria-hidden className="absolute inset-x-0 top-0 h-0.5" style={{ background: VIDEO_BLACK }} />
            <img src={companion.convoSettings?.charAvatarOverride || companion.avatar}
                className="w-10 h-10 rounded-2xl object-cover shrink-0" style={{ border: '1px solid rgba(17,17,17,0.16)' }} />
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                    <span className="text-[12px] font-black truncate" style={{ color: VIDEO_BLACK }}>{name}</span>
                    <span className="text-[8px] tracking-[0.2em]" style={{ color: INK_SOFT, fontFamily: 'var(--font-label)' }}>{preparing ? 'PREPARING' : 'WITH YOU'}</span>
                </div>
                <div className="text-[12px] leading-snug line-clamp-2" style={{ color: '#4f4b45' }}>
                    {preparing ? '正在把 TA 的一起逛脚本拉下来。' : busy ? '正看着这一屏…' : latest?.text || '我在，看中哪件就停一下。'}
                </div>
            </div>
            <div className="flex flex-col gap-1 shrink-0">
                {busy || preparing ? (
                    <button onClick={onSkip} className="px-2.5 py-1 rounded-full text-[10px] font-black active:scale-95"
                        style={{ background: VIDEO_BLACK, color: '#fff' }}>拉回</button>
                ) : (
                    <button onClick={onReact} className="px-2.5 py-1 rounded-full text-[10px] font-black active:scale-95"
                        style={{ background: VIDEO_BLACK, color: '#fff' }}>问一句</button>
                )}
                <button onClick={onLog} disabled={logCount === 0} className="px-2.5 py-1 rounded-full text-[10px] font-black active:scale-95 disabled:opacity-40"
                    style={{ background: '#f4f1ec', color: VIDEO_BLACK, border: `1px solid ${VIDEO_LINE}` }}>LOG</button>
                <button onClick={onEnd} className="px-2.5 py-1 rounded-full text-[10px] font-black active:scale-95"
                    style={{ background: 'rgba(17,17,17,0.08)', color: INK_SOFT }}>结束</button>
            </div>
        </div>
    );
};

const ShopCoPresencePill: React.FC<{ cue: CompanionCue; avatar?: string; compact?: boolean }> = ({ cue, avatar, compact = false }) => (
    <div className="flex items-start gap-2 rounded-[16px] px-2.5 py-2" style={{ background: VIDEO_BLACK, color: '#fff', boxShadow: '0 12px 24px -16px rgba(17,17,17,0.84)' }}>
        {avatar && <img src={avatar} className="w-6 h-6 rounded-full object-cover shrink-0" alt="" />}
        <div className="min-w-0 flex-1">
            <div className="text-[7px] tracking-[0.28em] uppercase leading-none mb-1" style={{ fontFamily: 'var(--font-label)', opacity: 0.66 }}>{cue.cue.eyebrow}</div>
            <div className="text-[10.5px] font-black leading-tight truncate">{cue.cue.title}</div>
            {!compact && cue.text && <div className="text-[10.5px] leading-snug mt-0.5 line-clamp-2" style={{ opacity: 0.86 }}>{cue.text}</div>}
        </div>
    </div>
);

const ShopCompanionPickerOverlay: React.FC<{
    open: boolean;
    characters: CharacterProfile[];
    activeId?: string;
    search: string;
    onSearch: (value: string) => void;
    onChoose: (char: CharacterProfile) => void;
    onClose: () => void;
    onEnd: () => void;
}> = ({ open, characters, activeId, search, onSearch, onChoose, onClose, onEnd }) => {
    if (!open) return null;
    const q = search.trim().toLowerCase();
    const shown = q
        ? characters.filter(c => [c.name, c.convoSettings?.remarkName, c.description, c.systemPrompt, c.worldview, c.writerPersona]
            .filter(Boolean).join(' ').toLowerCase().includes(q))
        : characters;
    return (
        <div className="fixed inset-0 z-[138] flex items-center justify-center px-4 animate-fade-in">
            <div className="absolute inset-0" style={{ background: 'rgba(255,255,255,0.66)', backdropFilter: 'blur(10px)' }} onClick={onClose} />
            <div className="relative w-full overflow-hidden rounded-[32px]" style={{ ...SHOP_VIEWPORT, maxWidth: 440, background: '#fff', color: VIDEO_BLACK, border: `1px solid ${VIDEO_LINE}`, boxShadow: '0 34px 90px -36px rgba(17,17,17,0.62)' }}>
                <div className="px-5 pt-5 pb-4" style={{ borderBottom: `1px solid ${VIDEO_LINE}` }}>
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <div className="text-[9px] tracking-[0.34em] uppercase" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>CO-PRESENCE</div>
                            <div className="text-[22px] font-black mt-1 leading-none">邀请 TA 一起逛</div>
                        </div>
                        <button onClick={onClose} className="w-9 h-9 rounded-full flex items-center justify-center active:scale-95" style={{ background: '#f3f3f3', color: VIDEO_BLACK }}>
                            <X size={16} weight="bold" />
                        </button>
                    </div>
                    <div className="text-[12px] leading-relaxed mt-3" style={{ color: INK_SOFT }}>
                        模型会读取 TA 的完整角色设定和你的完整用户设定，让 TA 自己挑想看的、想要的商品，并在货架上直接拦你。
                    </div>
                    <div className="mt-4 rounded-full px-3.5 py-2 flex items-center gap-2" style={{ background: '#f7f7f7', border: `1px solid ${VIDEO_LINE}` }}>
                        <MagnifyingGlass size={15} weight="bold" style={{ color: INK_SOFT }} />
                        <input value={search} onChange={e => onSearch(e.target.value)} placeholder="搜索角色"
                            className="flex-1 bg-transparent outline-none text-[13px] min-w-0" style={{ color: VIDEO_BLACK }} />
                        {search && <button onClick={() => onSearch('')} className="text-[13px] active:opacity-60" style={{ color: INK_SOFT }}>×</button>}
                    </div>
                </div>
                <div className="max-h-[52vh] overflow-y-auto no-scrollbar px-4 py-3 space-y-2.5">
                    {shown.length === 0 ? (
                        <div className="py-10 text-center text-[12px]" style={{ color: INK_SOFT }}>没搜到这个角色</div>
                    ) : shown.map(c => {
                        const name = c.convoSettings?.remarkName?.trim() || c.name;
                        const avatar = c.convoSettings?.charAvatarOverride || c.avatar;
                        const active = activeId === c.id;
                        return (
                            <button key={c.id} onClick={() => onChoose(c)} className="w-full rounded-[24px] p-3 flex items-center gap-3 text-left active:scale-[0.99] transition-transform" style={{ background: active ? VIDEO_BLACK : '#f7f7f7', color: active ? '#fff' : VIDEO_BLACK, border: `1px solid ${active ? VIDEO_BLACK : VIDEO_LINE}` }}>
                                {avatar ? (
                                    <img src={avatar} alt="" className="w-12 h-12 rounded-[18px] object-cover shrink-0" style={{ border: `1px solid ${active ? 'rgba(255,255,255,0.36)' : VIDEO_LINE}` }} />
                                ) : (
                                    <span className="w-12 h-12 rounded-[18px] flex items-center justify-center shrink-0 text-[18px] font-black" style={{ background: active ? 'rgba(255,255,255,0.16)' : '#fff' }}>{name[0] || 'T'}</span>
                                )}
                                <span className="flex-1 min-w-0">
                                    <span className="block text-[15px] font-black truncate">{name}</span>
                                    <span className="block text-[11px] truncate mt-0.5" style={{ opacity: active ? 0.72 : 0.58 }}>让 TA 按自己偏好挑一件</span>
                                </span>
                                <span className="text-[10px] font-black tracking-[0.18em] uppercase" style={{ fontFamily: 'var(--font-label)', opacity: active ? 0.9 : 0.55 }}>{active ? 'WITH YOU' : 'ENTER'}</span>
                            </button>
                        );
                    })}
                </div>
                {activeId && (
                    <div className="px-4 pb-4">
                        <button onClick={onEnd} className="w-full rounded-full py-3 text-[13px] font-black active:scale-95 transition-transform" style={{ background: '#f1f1f1', color: INK_SOFT }}>先自己逛</button>
                    </div>
                )}
            </div>
        </div>
    );
};

const ShopCompanionPayRequestOverlay: React.FC<{
    request: CompanionRequest | null;
    companion: CharacterProfile | null;
    balance: number;
    onClose: () => void;
    onWishlist: () => void;
    onPay: () => void;
}> = ({ request, companion, balance, onClose, onWishlist, onPay }) => {
    if (!request) return null;
    const name = companion?.convoSettings?.remarkName?.trim() || companion?.name || 'TA';
    const afford = balance >= request.item.price;
    return (
        <div className="fixed inset-0 z-[142] flex items-center justify-center px-4 animate-fade-in">
            <div className="absolute inset-0" style={{ background: 'rgba(255,255,255,0.64)', backdropFilter: 'blur(10px)' }} onClick={onClose} />
            <div className="relative w-full overflow-hidden rounded-[30px]" style={{ ...SHOP_VIEWPORT, maxWidth: 420, background: '#fff', color: VIDEO_BLACK, border: `1px solid ${VIDEO_LINE}`, boxShadow: '0 38px 88px -30px rgba(0,0,0,0.58)' }}>
                <div className="px-5 pt-5 pb-4" style={{ borderBottom: `1px solid ${VIDEO_LINE}` }}>
                    <div className="flex items-center gap-2 mb-2">
                        <LockKey size={16} weight="fill" />
                        <span className="text-[9px] tracking-[0.32em] uppercase" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>REQUEST</span>
                        <button onClick={onClose} className="ml-auto w-8 h-8 rounded-full flex items-center justify-center active:scale-95" style={{ background: '#f3f3f3' }}><X size={15} weight="bold" /></button>
                    </div>
                    <div className="text-[19px] font-black leading-tight">{name} 想要这件</div>
                    <div className="text-[12px] mt-1" style={{ color: INK_SOFT }}>TA 已经按自己的口味挑出来了，需要你决定。</div>
                </div>
                <div className="p-4">
                    <div className="rounded-[24px] p-3 flex gap-3" style={{ background: '#f7f7f7', border: `1px solid ${VIDEO_LINE}` }}>
                        <span className="w-16 h-16 rounded-[20px] flex items-center justify-center text-[34px] shrink-0 overflow-hidden" style={{ background: '#fff' }}>
                            <ShopItemImage item={request.item} className="w-full h-full object-cover" />
                        </span>
                        <div className="flex-1 min-w-0">
                            <div className="text-[8px] tracking-[0.28em] uppercase mb-1" style={{ color: INK_SOFT, fontFamily: 'var(--font-label)' }}>LOCKED ITEM</div>
                            <div className="text-[14px] font-black truncate">{request.item.name}</div>
                            <div className="text-[12px] mt-0.5" style={{ color: INK_SOFT }}>¥{formatPrice(request.item.price)} · {request.item.blurb}</div>
                            {request.speech && <div className="text-[12px] leading-snug mt-2 line-clamp-2">{request.speech}</div>}
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 mt-3">
                        <button onClick={onWishlist} className="rounded-full py-3 text-[13px] font-black active:scale-95 transition-transform" style={{ background: '#f1f1f1', color: VIDEO_BLACK }}>先记心愿</button>
                        <button onClick={onPay} disabled={!afford} className="rounded-full py-3 text-[13px] font-black active:scale-95 transition-transform disabled:opacity-45" style={{ background: VIDEO_BLACK, color: '#fff' }}>
                            {afford ? `替 TA 付 ¥${formatPrice(request.item.price)}` : '钱包不足'}
                        </button>
                    </div>
                    <button onClick={onClose} className="w-full rounded-full py-2.5 mt-2 text-[12px] font-black active:scale-95 transition-transform" style={{ background: 'transparent', color: INK_SOFT }}>这次先等等</button>
                </div>
            </div>
        </div>
    );
};

const ShopPreparingOverlay: React.FC<{ open: boolean; companion: CharacterProfile | null }> = ({ open, companion }) => {
    if (!open || !companion) return null;
    const name = companion.convoSettings?.remarkName?.trim() || companion.name;
    const avatar = companion.convoSettings?.charAvatarOverride || companion.avatar;
    return (
        <div className="fixed inset-0 z-[130] flex items-center justify-center px-5 pointer-events-none animate-fade-in">
            <div className="absolute inset-0" style={{ background: 'rgba(255,255,255,0.62)', backdropFilter: 'blur(10px)' }} />
            <div className="relative w-full rounded-[30px] px-5 py-5 text-center" style={{ ...SHOP_VIEWPORT, maxWidth: 380, background: '#fff', color: VIDEO_BLACK, border: `1px solid ${VIDEO_LINE}`, boxShadow: '0 34px 80px -34px rgba(17,17,17,0.62)' }}>
                <div className="mx-auto mb-3 w-14 h-14 rounded-[22px] overflow-hidden flex items-center justify-center font-black text-xl" style={{ background: '#f4f4f4', border: `1px solid ${VIDEO_LINE}` }}>
                    {avatar ? <img src={avatar} className="w-full h-full object-cover" alt="" /> : name[0] || 'T'}
                </div>
                <div className="text-[9px] tracking-[0.38em] uppercase" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>PREPARING</div>
                <div className="text-[17px] font-black mt-2">正在把 {name} 的一起逛脚本拉下来。</div>
                <div className="text-[12px] leading-relaxed mt-2" style={{ color: INK_SOFT }}>模型正在按 TA 的完整设定，从当前货架里挑 TA 自己想看的商品。</div>
                <div className="mt-4 h-1.5 rounded-full overflow-hidden" style={{ background: '#ededed' }}>
                    <div className="h-full rounded-full animate-pulse" style={{ width: '62%', background: VIDEO_BLACK }} />
                </div>
            </div>
        </div>
    );
};

const ShopHijackOverlay: React.FC<{
    hijack: CompanionHijack | null;
    companion: CharacterProfile | null;
    onReject: () => void;
    onAccept: () => void;
}> = ({ hijack, companion, onReject, onAccept }) => {
    if (!hijack) return null;
    const name = companion?.convoSettings?.remarkName?.trim() || companion?.name || 'TA';
    const cue = getShopCoPresenceCue(hijack.action, name);
    return (
        <div className="fixed inset-0 z-[140] flex items-center justify-center px-4 animate-fade-in">
            <div className="absolute inset-0" style={{ background: 'rgba(255,255,255,0.64)', backdropFilter: 'blur(10px)' }} />
            <div className="relative w-full overflow-hidden rounded-[30px]" style={{ ...SHOP_VIEWPORT, maxWidth: 420, background: '#fff', color: VIDEO_BLACK, border: `1px solid ${VIDEO_LINE}`, boxShadow: '0 38px 88px -30px rgba(0,0,0,0.62)' }}>
                <div className="px-5 pt-5 pb-4" style={{ borderBottom: `1px solid ${VIDEO_LINE}` }}>
                    <div className="flex items-center gap-2 mb-3">
                        <LockKey size={16} weight="fill" />
                        <span className="text-[9px] tracking-[0.32em] uppercase" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>{cue.eyebrow}</span>
                    </div>
                    <div className="text-[20px] font-black leading-tight">{cue.title}</div>
                </div>
                <div className="p-4">
                    <div className="rounded-[24px] p-3 flex gap-3" style={{ background: '#f7f7f7', border: `1px solid ${VIDEO_LINE}` }}>
                        <span className="w-16 h-16 rounded-[20px] flex items-center justify-center text-[34px] shrink-0 overflow-hidden" style={{ background: '#fff' }}>
                            <ShopItemImage item={hijack.item} className="w-full h-full object-cover" />
                        </span>
                        <div className="flex-1 min-w-0">
                            <div className="text-[8px] tracking-[0.28em] uppercase mb-1" style={{ color: INK_SOFT, fontFamily: 'var(--font-label)' }}>LOCKED ITEM</div>
                            <div className="text-[14px] font-black truncate">{hijack.item.name}</div>
                            <div className="text-[12px] mt-0.5" style={{ color: INK_SOFT }}>¥{formatPrice(hijack.item.price)}</div>
                            <div className="text-[12px] leading-snug mt-2 line-clamp-2">{hijack.speech}</div>
                        </div>
                    </div>
                    <div className="flex items-center justify-between mt-3 mb-2">
                        <span className="text-[10px] tracking-[0.24em] uppercase" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>STEP 2/4</span>
                        <span className="text-[10px]" style={{ color: INK_SOFT }}>TA 正在请求你停一下</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <button onClick={onReject} className="rounded-full py-3 text-[13px] font-black active:scale-95 transition-transform" style={{ background: '#f1f1f1', color: VIDEO_BLACK }}>拒绝</button>
                        <button onClick={onAccept} className="rounded-full py-3 text-[13px] font-black active:scale-95 transition-transform" style={{ background: VIDEO_BLACK, color: '#fff' }}>好，听你的</button>
                    </div>
                </div>
            </div>
        </div>
    );
};

const ShopPaymentNoticeOverlay: React.FC<{ notice: ShopCoPresencePaymentNotice | null; onClose: () => void }> = ({ notice, onClose }) => {
    if (!notice) return null;
    return (
        <div className="fixed inset-x-0 top-4 z-[150] flex justify-center px-4 pointer-events-none animate-fade-in">
            <div className="w-full rounded-[24px] p-4 pointer-events-auto" style={{ ...SHOP_VIEWPORT, background: '#fff', color: VIDEO_BLACK, border: `1px solid ${VIDEO_LINE}`, boxShadow: '0 22px 56px -28px rgba(17,17,17,0.68)' }}>
                <div className="flex items-start gap-3">
                    <div className="w-12 h-12 rounded-[18px] flex items-center justify-center text-[26px] shrink-0" style={{ background: VIDEO_BLACK, color: '#fff' }}>{notice.itemEmoji}</div>
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                            <span className="text-[8px] tracking-[0.28em] uppercase" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>{notice.eyebrow}</span>
                            <span className="ml-auto text-[18px] font-black tabular-nums">¥{formatPrice(notice.amount)}</span>
                        </div>
                        <div className="text-[14px] font-black mt-1">{notice.title}</div>
                        <div className="text-[11px] mt-0.5" style={{ color: INK_SOFT }}>付款账户：{notice.account}</div>
                        <div className="text-[11px] mt-0.5 truncate" style={{ color: INK_SOFT }}>商品：{notice.itemName}</div>
                        <div className="text-[12px] leading-snug mt-2 line-clamp-2">{notice.message}</div>
                    </div>
                    <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 active:scale-95" style={{ background: '#f1eee7', color: VIDEO_BLACK }}>
                        <X size={14} weight="bold" />
                    </button>
                </div>
            </div>
        </div>
    );
};

const ShopCompanionLogSheet: React.FC<{ open: boolean; logs: CompanionLog[]; onClose: () => void }> = ({ open, logs, onClose }) => {
    if (!open) return null;
    return (
        <div className="fixed inset-0 z-[135] flex items-end justify-center animate-fade-in">
            <div className="absolute inset-0" style={{ background: 'rgba(17,17,17,0.32)', backdropFilter: 'blur(3px)' }} onClick={onClose} />
            <div className="relative w-full rounded-t-[30px] flex flex-col min-h-0" style={{ ...SHOP_VIEWPORT, maxHeight: '72vh', background: '#fff', color: VIDEO_BLACK, boxShadow: '0 -28px 70px -34px rgba(17,17,17,0.72)', paddingBottom: 'max(env(safe-area-inset-bottom,0px), 14px)' }}>
                <div className="px-5 pt-4 pb-3 shrink-0">
                    <div className="flex items-center gap-2">
                        <ChatCircleDots size={18} weight="fill" />
                        <div>
                            <div className="text-[8px] tracking-[0.32em] uppercase" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>SHOPPING LOG</div>
                            <div className="text-[15px] font-black mt-0.5">本次同游留下的临时行为痕迹</div>
                        </div>
                        <button onClick={onClose} className="ml-auto w-8 h-8 rounded-full flex items-center justify-center" style={{ background: '#f1eee7' }}><X size={15} weight="bold" /></button>
                    </div>
                </div>
                <div className="overflow-y-auto no-scrollbar px-5 pb-4 space-y-2.5">
                    {logs.length === 0 ? (
                        <div className="text-center text-[12px] py-8" style={{ color: INK_SOFT }}>这趟还没留下痕迹。</div>
                    ) : logs.map(log => {
                        const item = log.itemId ? getShopItem(log.itemId) : undefined;
                        return (
                            <div key={log.id} className="rounded-[20px] p-3 flex gap-3" style={{ background: '#f7f7f7', border: `1px solid ${VIDEO_LINE}` }}>
                                {item && (
                                    <span className="w-14 h-14 rounded-[18px] flex items-center justify-center text-[28px] shrink-0 overflow-hidden" style={{ background: '#fff' }}>
                                        <ShopItemImage item={item} className="w-full h-full object-cover" />
                                    </span>
                                )}
                                <div className="min-w-0 flex-1">
                                    <div className="text-[8px] tracking-[0.28em] uppercase" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>{log.coPresence?.eyebrow || 'CO-PRESENCE'}</div>
                                    <div className="text-[13px] font-black mt-1 truncate">{log.coPresence?.title || item?.name || '一起逛'}</div>
                                    <div className="text-[12px] leading-snug mt-1 line-clamp-2" style={{ color: '#4f4b45' }}>{log.coPresence?.detail || log.text}</div>
                                    {item && <div className="text-[11px] font-black mt-1" style={{ color: INK_SOFT }}>¥{formatPrice(item.price)}</div>}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

// ── 可复用商品卡（米白纸卡 + 彩色商品图） ─────────────────────────────────────
const ItemCard: React.FC<{
    item: ShopItem; balance: number; faved?: boolean; tilt?: number;
    onOpen: (i: ShopItem) => void; onToggleFav?: (id: string) => void;
    onBuy?: (i: ShopItem) => void; onAddCart?: (i: ShopItem) => void;
    companionCue?: CompanionCue | null; companionAvatar?: string;
    registerItemRef?: (itemId: string, el: HTMLDivElement | null) => void;
}> = ({ item, balance, faved, tilt = 0, onOpen, onToggleFav, onBuy, onAddCart, companionCue, companionAvatar, registerItemRef }) => {
    const afford = balance >= item.price;
    const signals = itemGiftSignals(item);
    const activeCue = companionCue?.itemId === item.id ? companionCue : null;
    return (
        <div ref={el => registerItemRef?.(item.id, el)} className="relative flex flex-col overflow-hidden transition-all"
            style={{
                ...PANEL,
                transform: tilt ? `rotate(${tilt}deg)` : undefined,
                boxShadow: activeCue ? '0 0 0 2px #1f1d1a, 0 16px 28px -14px rgba(31,29,26,0.75)' : PANEL.boxShadow,
            }}>
            {activeCue && (
                <div className="absolute inset-0 z-20 pointer-events-none rounded-2xl" style={{ border: `2px solid ${VIDEO_BLACK}`, boxShadow: 'inset 0 0 0 2px rgba(255,255,255,0.86)' }}>
                    <div className="absolute top-1.5 left-2 right-2">
                        <ShopCoPresencePill cue={activeCue} avatar={companionAvatar} compact />
                    </div>
                </div>
            )}
            <div className="relative cursor-pointer" onClick={() => onOpen(item)}>
                <ShopItemImage
                    item={item}
                    className="w-full h-[94px] object-cover"
                    loading="lazy"
                    imgStyle={{ filter: 'contrast(1.02)' }}
                    fallbackClassName="text-[44px] text-center leading-none pt-3.5 pb-2 select-none"
                    fallbackStyle={{ background: THUMB_BG }}
                />
                {onToggleFav && (
                    <button onClick={(e) => { e.stopPropagation(); onToggleFav(item.id); }}
                        className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full flex items-center justify-center active:scale-90 transition-transform"
                        style={{ background: 'rgba(251,249,242,0.92)', boxShadow: '0 2px 6px -2px rgba(31,29,26,0.5)' }}>
                        <Heart size={15} weight={faved ? 'fill' : 'bold'} style={{ color: faved ? INK : INK_SOFT }} />
                    </button>
                )}
            </div>
            <div className="px-3 pb-3 pt-2 flex flex-col flex-1">
                <div className="text-[13px] font-black truncate cursor-pointer" style={{ color: INK }} onClick={() => onOpen(item)}>{item.name}</div>
                <div className="flex items-center gap-1.5 mt-0.5 mb-2 text-[9.5px]" style={{ color: INK_SOFT }}>
                    <span className="flex items-center gap-0.5"><Star size={10} weight="fill" style={{ color: INK }} />{itemRating(item.id)}</span>
                    <span>·</span><span>寄出 {formatSales(monthlySales(item.id))}</span>
                </div>
                <div className="mb-2 flex items-center gap-1 overflow-hidden">
                    <span className="shrink-0 rounded-full px-2 py-0.5 text-[9px] font-black" style={{ background: 'rgba(31,29,26,0.08)', color: INK }}>
                        {signals.relationLabel}
                    </span>
                    <span className="min-w-0 truncate text-[9px]" style={{ color: INK_SOFT }}>{signals.scenes.join(' / ')}</span>
                </div>
                <div className="flex items-center justify-between mt-auto gap-1.5">
                    <span className="text-[15px] font-black" style={{ color: INK }}>¥{formatPrice(item.price)}</span>
                    <div className="flex items-center gap-1.5">
                        {onAddCart && (
                            <button onClick={() => onAddCart(item)} title="放进篮子"
                                className="w-7 h-7 rounded-full flex items-center justify-center active:scale-90 transition-transform"
                                style={{ background: 'rgba(255,253,247,0.96)', color: INK, border: '1px dashed rgba(150,144,132,0.7)' }}>
                                <ShoppingCart size={14} weight="bold" />
                            </button>
                        )}
                        {onBuy && (
                            <ScrapButton variant={afford ? 'ink' : 'ghost'} onClick={() => afford && onBuy(item)} disabled={!afford} className="px-3 py-1 text-[12px]">
                                {afford ? '买下' : '差点'}
                            </ScrapButton>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

// ── 商城首页（搜索 + 招牌 + 撕券 + 限抢 + 分类 + 商品卡） ──
const ShopCatalog: React.FC<{
    catalog: ShopItem[]; genBusy: boolean; onRefresh: () => void; onSearchGen: (q: string) => void;
    cat: string; setCat: (c: string) => void;
    search: string; setSearch: (s: string) => void;
    balance: number; favorites: string[];
    charactersCount: number; wishCount: number; onOpenAdvisor: () => void;
    claimedCoupons: string[]; onClaimCoupon: (id: string) => void; onBuyFlash: (item: ShopItem, price: number) => void;
    onCreateItem: () => void;
    onBuy: (i: ShopItem) => void; onAddCart: (i: ShopItem) => void;
    onOpenDetail: (i: ShopItem) => void; onToggleFav: (id: string) => void;
    companionCue?: CompanionCue | null; companionAvatar?: string;
    registerItemRef?: (itemId: string, el: HTMLDivElement | null) => void;
}> = ({ catalog, genBusy, onRefresh, onSearchGen, cat, setCat, search, setSearch, balance, favorites, charactersCount, wishCount, onOpenAdvisor, claimedCoupons, onClaimCoupon, onBuyFlash, onCreateItem, onBuy, onAddCart, onOpenDetail, onToggleFav, companionCue, companionAvatar, registerItemRef }) => {
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
            <div className="flex items-center gap-2 mb-3 mt-0.5">
                <div className="flex-1 flex items-center gap-2 rounded-full px-3.5 py-2" style={{ background: 'rgba(255,253,247,0.92)', border: '1px solid rgba(176,170,158,0.7)' }}>
                    <MagnifyingGlass size={16} weight="bold" className="shrink-0" style={{ color: INK }} />
                    <input value={search} onChange={e => setSearch(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && search.trim()) onSearchGen(search); }}
                        placeholder="想送点什么 · 回车现挑相关好物…"
                        className="flex-1 bg-transparent text-[13px] outline-none min-w-0" style={{ color: INK }} />
                    {search && <button onClick={() => setSearch('')} className="text-sm shrink-0 active:opacity-60" style={{ color: INK_SOFT }}>✕</button>}
                </div>
                <ScrapButton variant="ink" onClick={onRefresh} disabled={genBusy} icon={<Sparkle size={13} weight="fill" />} className="px-3 py-2 text-[12px]">
                    {genBusy ? '翻新中' : '翻新货架'}
                </ScrapButton>
                <ScrapButton variant="paper" onClick={onCreateItem} icon={<Plus size={13} weight="bold" />} className="px-3 py-2 text-[12px]">
                    新增
                </ScrapButton>
            </div>
            {search.trim() && (
                <ScrapButton variant="paper" onClick={() => onSearchGen(search)} disabled={genBusy}
                    icon={<MagnifyingGlass size={14} weight="bold" />} className="w-full mb-3 py-2 text-[12px]">
                    按「{search.trim()}」现挑相关好物
                </ScrapButton>
            )}
            {home && (
                <>
                    <ShopBanner />
                    <GiftAdvisorCallout charactersCount={charactersCount} wishCount={wishCount} onOpen={onOpenAdvisor} />
                    <CouponStrip claimed={claimedCoupons} onClaim={onClaimCoupon} />
                    <FlashSaleStrip catalog={catalog} balance={balance} onBuy={onBuyFlash} onOpen={onOpenDetail} />
                </>
            )}
            <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2.5 -mx-1 px-1">
                {[{ key: 'all', label: '全部', emoji: '🛍️' }, { key: 'fav', label: '心头好', emoji: '❤️' }, ...SHOP_CATEGORIES].map(c => (
                    <button key={c.key} onClick={() => setCat(c.key)}
                        className="shrink-0 px-3 py-1.5 rounded-full text-[12px] font-bold transition-all active:scale-95" style={chipStyle(cat === c.key)}>
                        {c.emoji} {c.label}
                    </button>
                ))}
            </div>
            {genBusy && items.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 pt-20" style={{ color: INK_SOFT }}>
                    <div className="w-8 h-8 border-[3px] rounded-full animate-spin" style={{ borderColor: 'rgba(150,144,132,0.4)', borderTopColor: INK }} />
                    <div className="text-xs">正在为你翻新一架好物…</div>
                </div>
            ) : items.length === 0 ? (
                <div className="text-center text-xs pt-16" style={{ color: INK_SOFT }}>{cat === 'fav' ? '还没收心头好，点商品上的 ❤ 收起来' : '没翻到相关的，点「翻新货架」试试'}</div>
            ) : (
                <div className="grid grid-cols-2 gap-3">
                    {items.map((item, i) => (
                        <ItemCard key={item.id} item={item} balance={balance} faved={favorites.includes(item.id)} tilt={i % 5 === 0 ? -0.5 : i % 7 === 0 ? 0.5 : 0}
                            onOpen={onOpenDetail} onToggleFav={onToggleFav} onBuy={onBuy} onAddCart={onAddCart}
                            companionCue={companionCue} companionAvatar={companionAvatar} registerItemRef={registerItemRef} />
                    ))}
                </div>
            )}
            {home && <RecommendSection catalog={catalog} favorites={favorites} onOpen={onOpenDetail} onAddCart={onAddCart}
                companionCue={companionCue} companionAvatar={companionAvatar} registerItemRef={registerItemRef} />}
        </>
    );
};

// ── 分类页（左侧分类栏 + 右侧商品网格） ──
const CategoryPage: React.FC<{
    catalog: ShopItem[]; balance: number; favorites: string[];
    activeCategory: string; onCategoryChange: (key: string) => void;
    onOpen: (i: ShopItem) => void; onToggleFav: (id: string) => void; onBuy: (i: ShopItem) => void; onAddCart: (i: ShopItem) => void;
    companionCue?: CompanionCue | null; companionAvatar?: string;
    registerItemRef?: (itemId: string, el: HTMLDivElement | null) => void;
}> = ({ catalog, balance, favorites, activeCategory, onCategoryChange, onOpen, onToggleFav, onBuy, onAddCart, companionCue, companionAvatar, registerItemRef }) => {
    const active = activeCategory || SHOP_CATEGORIES[0]?.key || 'flower';
    const items = useMemo(() => catalog.filter(i => i.category === active), [catalog, active]);
    const cur = SHOP_CATEGORIES.find(c => c.key === active);
    return (
        <div className="flex gap-2.5 -mx-1 px-1 pt-1" style={{ minHeight: '60vh' }}>
            <div className="w-[72px] shrink-0 space-y-1.5">
                {SHOP_CATEGORIES.map(c => {
                    const on = active === c.key;
                    return (
                        <button key={c.key} onClick={() => onCategoryChange(c.key)}
                            className="w-full py-2.5 rounded-xl flex flex-col items-center gap-0.5 transition-all active:scale-95"
                            style={on ? { background: INK, color: PAPER } : { background: 'rgba(255,253,247,0.55)', color: INK_SOFT, border: '1px dashed rgba(150,144,132,0.5)' }}>
                            <span className="text-[18px] leading-none">{c.emoji}</span>
                            <span className="text-[11px] font-bold">{c.label}</span>
                        </button>
                    );
                })}
            </div>
            <div className="flex-1 min-w-0">
                <div className="mb-2.5"><SectionTag en={(cur?.key || '').toUpperCase()}>{cur?.emoji} {cur?.label}好物</SectionTag></div>
                {items.length === 0 ? (
                    <div className="text-center text-xs pt-12" style={{ color: INK_SOFT }}>这一类暂时空着，去货架点「翻新货架」</div>
                ) : (
                    <div className="grid grid-cols-2 gap-2.5">
                        {items.map(item => (
                            <ItemCard key={item.id} item={item} balance={balance} faved={favorites.includes(item.id)}
                                onOpen={onOpen} onToggleFav={onToggleFav} onBuy={onBuy} onAddCart={onAddCart}
                                companionCue={companionCue} companionAvatar={companionAvatar} registerItemRef={registerItemRef} />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

// ── 营销位：招牌轮播（墨色 + 网点半调，原创文案） ──
const BANNERS = [
    { t: '心意铺 · 把心意夹进信封', s: '挑一件好物，胜过一句「在吗」' },
    { t: '现挑现上 · 一架子新面孔', s: '点「翻新货架」，每翻都是新货' },
    { t: '减价券夹在账本里', s: '满额自动撕一张，结算替你省' },
    { t: '整点开抢 · 一刻钟收摊', s: '手一慢，好物就被别人抱走' },
];
const ShopBanner: React.FC = () => {
    const [i, setI] = useState(0);
    useEffect(() => { const t = setInterval(() => setI(x => (x + 1) % BANNERS.length), 3800); return () => clearInterval(t); }, []);
    const b = BANNERS[i];
    return (
        <div className="relative rounded-2xl overflow-hidden mb-3 h-24" style={{ background: INK, boxShadow: '0 14px 26px -16px rgba(31,29,26,0.6)' }}>
            <div aria-hidden className="absolute inset-0" style={{ backgroundImage: HALFTONE, backgroundSize: '7px 7px', opacity: 0.18 }} />
            <WashiTape color="butter" rotate={-4} className="absolute -top-2 left-5 w-16 h-5 rounded-[2px]" />
            <div className="absolute inset-0 px-4 flex flex-col justify-center" style={{ color: PAPER }}>
                <div className="text-[8px] tracking-[0.34em] uppercase mb-1" style={{ fontFamily: 'var(--font-label)', opacity: 0.7 }}>TODAY AT THE STALL</div>
                <div className="text-[15px] font-black">{b.t}</div>
                <div className="text-[11px] mt-0.5" style={{ opacity: 0.85 }}>{b.s}</div>
            </div>
            <div className="absolute bottom-2 right-3 flex gap-1">
                {BANNERS.map((_, k) => <span key={k} className="w-1.5 h-1.5 rounded-full transition-all" style={{ background: PAPER, opacity: k === i ? 1 : 0.35 }} />)}
            </div>
        </div>
    );
};

const GiftAdvisorCallout: React.FC<{ charactersCount: number; wishCount: number; onOpen: () => void; }> = ({ charactersCount, wishCount, onOpen }) => (
    <button onClick={onOpen}
        className="w-full mb-3 rounded-2xl p-3 text-left active:scale-[0.99] transition-transform relative overflow-hidden"
        style={{ ...PANEL, outlineOffset: '-6px' }}>
        <div className="absolute -right-5 -top-5 w-24 h-24 rotate-12" style={{ backgroundImage: HALFTONE, backgroundSize: '7px 7px', opacity: 0.18 }} />
        <div className="relative flex items-center gap-3">
            <Stamp size={42} color="ink"><Gift size={22} weight="fill" /></Stamp>
            <div className="flex-1 min-w-0">
                <div className="text-[13px] font-black" style={{ color: INK }}>心意参谋</div>
                <div className="text-[11px] leading-snug mt-0.5" style={{ color: INK_SOFT }}>
                    {charactersCount ? `按角色、场景和预算挑礼物${wishCount ? ` · ${wishCount} 件心愿待看` : ''}` : '先有角色，再帮你挑得更准'}
                </div>
            </div>
            <CaretRight size={18} weight="bold" style={{ color: INK }} />
        </div>
    </button>
);

// ── 营销位：撕券处 ──
const CouponStrip: React.FC<{ claimed: string[]; onClaim: (id: string) => void; }> = ({ claimed, onClaim }) => (
    <div className="mb-3">
        <SectionTag en="COUPONS" className="mb-2">✂ 撕张减价券</SectionTag>
        <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
            {SHOP_COUPONS.map(c => {
                const got = claimed.includes(c.id);
                return (
                    <div key={c.id} className="shrink-0 rounded-xl px-3 py-1.5 flex items-center gap-2" style={{ background: 'rgba(255,253,247,0.9)', border: '1px dashed rgba(31,29,26,0.45)' }}>
                        <div className="leading-tight">
                            <div className="text-[14px] font-black" style={{ color: INK }}>¥{formatPrice(c.discount)}</div>
                            <div className="text-[8.5px]" style={{ color: INK_SOFT }}>满{c.threshold}可用</div>
                        </div>
                        <button onClick={() => onClaim(c.id)} disabled={got}
                            className="px-2.5 py-1 rounded-full text-[10px] font-bold active:scale-95 transition-transform"
                            style={got ? { background: 'rgba(150,144,132,0.18)', color: INK_SOFT } : { background: INK, color: PAPER }}>
                            {got ? '已撕' : '撕下'}
                        </button>
                    </div>
                );
            })}
        </div>
    </div>
);

// ── 营销位：一刻钟限抢 ──
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
        <div className="mb-3 rounded-2xl p-2.5" style={PANEL}>
            <div className="flex items-center justify-between mb-2">
                <span className="text-[13px] font-black flex items-center gap-1" style={{ color: INK }}>⚡ 一刻钟限抢</span>
                <span className="flex items-center gap-1 text-[10px]" style={{ color: INK_SOFT }}>
                    距收摊
                    {[hh, mm, ss].map((v, k) => <span key={k} className="rounded px-1 py-0.5 font-mono text-[10px] tabular-nums" style={{ background: INK, color: PAPER }}>{v}</span>)}
                </span>
            </div>
            <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
                {deals.map(({ item, dealPrice, offPct }) => (
                    <div key={item.id} className="shrink-0 w-[88px]">
                        <div className="rounded-xl overflow-hidden cursor-pointer" style={{ border: '1px solid rgba(176,170,158,0.6)' }} onClick={() => onOpen(item)}>
                            <ShopItemImage
                                item={item}
                                className="w-full h-14 object-cover"
                                loading="lazy"
                                fallbackClassName="text-[30px] text-center leading-none py-2"
                                fallbackStyle={{ background: THUMB_BG }}
                            />
                        </div>
                        <div className="text-[10px] truncate mt-1" style={{ color: INK }}>{item.name}</div>
                        <div className="flex items-baseline gap-1">
                            <span className="text-[12px] font-black" style={{ color: INK }}>¥{formatPrice(dealPrice)}</span>
                            <span className="text-[8px] line-through" style={{ color: INK_SOFT }}>¥{formatPrice(item.price)}</span>
                        </div>
                        <button onClick={() => onBuy(item, dealPrice)} disabled={balance < dealPrice}
                            className="w-full mt-0.5 py-1 rounded-full text-[10px] font-bold active:scale-95 transition-transform"
                            style={balance >= dealPrice ? { background: INK, color: PAPER } : { background: 'rgba(150,144,132,0.2)', color: INK_SOFT }}>
                            {balance >= dealPrice ? `抢·${offPct}%off` : '差点'}
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
};

// ── 照你眼缘挑的（猜你喜欢） ──
const RecommendSection: React.FC<{
    catalog: ShopItem[];
    favorites: string[];
    onOpen: (i: ShopItem) => void;
    onAddCart: (i: ShopItem) => void;
    companionCue?: CompanionCue | null;
    companionAvatar?: string;
    registerItemRef?: (itemId: string, el: HTMLDivElement | null) => void;
}> = ({ catalog, favorites, onOpen, onAddCart, companionCue, companionAvatar, registerItemRef }) => {
    const recs = useMemo(() => recommendItems(catalog, favorites, 8), [catalog, favorites]);
    if (recs.length === 0) return null;
    return (
        <div className="mt-4">
            <SectionTag en="FOR YOU" className="mb-2">♡ 照你眼缘挑的</SectionTag>
            <div className="grid grid-cols-2 gap-3">
                {recs.map(item => (
                    <ItemCard key={item.id} item={item} balance={0} onOpen={onOpen} onAddCart={onAddCart}
                        companionCue={companionCue} companionAvatar={companionAvatar} registerItemRef={registerItemRef} />
                ))}
            </div>
        </div>
    );
};

// ── 商品详情页 ──
const ProductDetail: React.FC<{
    item: ShopItem; faved: boolean; balance: number;
    genReviews: (item: ShopItem) => Promise<ShopReview[]>;
    myReviews: ShopUserReview[];
    onClose: () => void; onToggleFav: (id: string) => void;
    onEdit: (i: ShopItem) => void;
    onAddCart: (i: ShopItem) => void; onBuy: (i: ShopItem) => void;
    onAddWish: (i: ShopItem) => void;
    companionCue?: CompanionCue | null;
    companionAvatar?: string;
}> = ({ item, faved, balance, genReviews, myReviews, onClose, onToggleFav, onEdit, onAddCart, onBuy, onAddWish, companionCue, companionAvatar }) => {
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
    const signals = itemGiftSignals(item);
    return (
        <div className="absolute inset-0 z-[60] flex flex-col animate-fade-in" style={{ background: PAGE_BG, color: INK }}>
            <PaperBackdrop corners={false} />
            <div className="relative z-10 flex items-center px-4 h-12 gap-2 shrink-0">
                <button onClick={onClose} className="relative inline-flex items-center gap-1 px-3 py-1.5 text-[12px] font-black active:scale-95 transition-transform" style={{ color: '#36322b' }}>
                    <span aria-hidden className="absolute inset-0 rounded-[6px]" style={{ backgroundColor: WASHI.butter.base, backgroundImage: TAPE_STRIPES, transform: 'rotate(-2deg)' }} />
                    <span className="relative z-10 flex items-center gap-1"><CaretLeft size={13} weight="bold" />返回</span>
                </button>
                <span className="font-black text-[15px]" style={{ color: INK }}>这一件</span>
                <div className="flex-1" />
                <ScrapButton variant="paper" onClick={() => onEdit(item)} icon={<PencilSimpleLine size={13} weight="bold" />} className="px-3 py-1.5 text-[12px]">
                    编辑
                </ScrapButton>
            </div>
            <div className="relative z-10 flex-1 overflow-y-auto no-scrollbar px-4 pb-4">
                <div className="relative rounded-3xl overflow-hidden" style={PANEL}>
                    <ShopItemImage
                        item={item}
                        className="w-full h-60 object-cover"
                        fallbackClassName="flex items-center justify-center text-[110px] leading-none py-8 select-none"
                        fallbackStyle={{ background: THUMB_BG }}
                    />
                    <WashiTape color="ink" rotate={-5} className="absolute top-3 -left-2 w-20 h-6 rounded-[2px]" />
                    {companionCue && (
                        <div className="absolute left-4 right-4 bottom-4">
                            <ShopCoPresencePill cue={companionCue} avatar={companionAvatar} />
                        </div>
                    )}
                </div>
                <div className="mt-3 rounded-2xl p-4" style={PANEL}>
                    <div className="flex items-end gap-2">
                        <span className="text-[26px] font-black leading-none" style={{ color: INK }}>¥{formatPrice(item.price)}</span>
                        <span className="text-[11px] mb-0.5 flex items-center gap-1" style={{ color: INK_SOFT }}><Star size={11} weight="fill" style={{ color: INK }} />{itemRating(item.id)} · 寄出 {formatSales(monthlySales(item.id))}</span>
                    </div>
                    <div className="text-[15px] font-black mt-1.5" style={{ color: INK }}>{item.name}</div>
                    <div className="text-[12px] leading-relaxed mt-1" style={{ color: INK_SOFT }}>{item.blurb}</div>
                </div>
                <div className="mt-2.5 rounded-2xl p-4" style={PANEL}>
                    <div className="flex items-center justify-between gap-2 mb-2">
                        <span className="text-[13px] font-black" style={{ color: INK }}>送礼尺度</span>
                        <span className="rounded-full px-2.5 py-1 text-[10px] font-black" style={{ background: INK, color: PAPER }}>{signals.relationLabel}</span>
                    </div>
                    <div className="flex gap-1.5 flex-wrap">
                        {signals.scenes.map(s => (
                            <span key={s} className="rounded-full px-2.5 py-1 text-[10px] font-bold" style={{ background: 'rgba(31,29,26,0.08)', color: INK }}>{s}</span>
                        ))}
                    </div>
                    {signals.caution && <div className="text-[11px] leading-relaxed mt-2" style={{ color: INK_SOFT }}>{signals.caution}</div>}
                </div>
                {/* 保障 */}
                <div className="mt-2.5 rounded-2xl px-4 py-2.5 flex items-center gap-3 flex-wrap text-[10px]" style={{ ...PANEL, color: INK_SOFT }}>
                    {['七日无理由', '极速退款', '心意速递', '原物保真'].map(t => (
                        <span key={t} className="flex items-center gap-0.5"><CheckCircle size={12} weight="fill" style={{ color: INK }} />{t}</span>
                    ))}
                </div>
                <div className="mt-3 rounded-2xl p-4" style={PANEL}>
                    <div className="flex items-center justify-between mb-2.5">
                        <span className="text-[13px] font-black" style={{ color: INK }}>买过的人说{reviews ? `（${myReviews.length + reviews.length}）` : ''}</span>
                        <span className="text-[10px] font-black" style={{ color: INK }}>好评率 {rate}%</span>
                    </div>
                    {reviews === null ? (
                        <div className="flex items-center justify-center gap-2 py-4 text-[11px]" style={{ color: INK_SOFT }}>
                            <span className="w-3.5 h-3.5 border-2 rounded-full animate-spin" style={{ borderColor: 'rgba(150,144,132,0.4)', borderTopColor: INK }} />正在翻出买家留言…
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {myReviews.map((r, i) => (
                                <div key={`my${i}`} className="flex gap-2.5">
                                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-black shrink-0" style={{ background: INK, color: PAPER }}>我</div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-[11px] font-bold" style={{ color: INK }}>我的留言</span>
                                            <InkStars stars={r.stars} />
                                        </div>
                                        <div className="text-[12px] leading-snug mt-0.5" style={{ color: '#3a362f' }}>{r.text}</div>
                                    </div>
                                </div>
                            ))}
                            {reviews.map((r, i) => (
                                <div key={i} className="flex gap-2.5">
                                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-black shrink-0" style={{ background: 'rgba(150,144,132,0.25)', color: INK }}>{r.user[0]}</div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-[11px] font-bold" style={{ color: INK }}>{r.user}</span>
                                            <InkStars stars={r.stars} />
                                        </div>
                                        <div className="text-[12px] leading-snug mt-0.5" style={{ color: '#3a362f' }}>{r.text}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
            <div className="relative z-10 shrink-0 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+10px)] pt-2.5 flex items-center gap-2" style={{ borderTop: '1px dashed rgba(150,144,132,0.6)', background: 'rgba(246,243,236,0.92)' }}>
                <button onClick={() => onToggleFav(item.id)} className="flex flex-col items-center justify-center px-1 shrink-0 w-11" style={{ color: INK }}>
                    <Heart size={20} weight={faved ? 'fill' : 'bold'} />
                    <span className="text-[8px] mt-0.5">{faved ? '已收' : '收藏'}</span>
                </button>
                <button onClick={() => onAddWish(item)} className="flex flex-col items-center justify-center px-1 shrink-0 w-11" style={{ color: INK }}>
                    <Storefront size={20} weight="bold" />
                    <span className="text-[8px] mt-0.5">心愿</span>
                </button>
                <ScrapButton variant="paper" onClick={() => onAddCart(item)} className="flex-1 py-2.5 text-[13px]">放进篮子</ScrapButton>
                <ScrapButton variant={afford ? 'ink' : 'ghost'} onClick={() => afford && onBuy(item)} disabled={!afford} className="flex-1 py-2.5 text-[13px]">
                    {afford ? '立刻买下' : '钱包不足'}
                </ScrapButton>
            </div>
        </div>
    );
};

// ── 新增/编辑商品 sheet ──
const ProductEditorSheet: React.FC<{
    item?: ShopItem;
    onClose: () => void;
    onSave: (draft: ShopItemDraft) => void;
}> = ({ item, onClose, onSave }) => {
    const [name, setName] = useState(item?.name || '');
    const [emoji, setEmoji] = useState(item?.emoji || '🎁');
    const [price, setPrice] = useState(item ? String(item.price) : '9.9');
    const [category, setCategory] = useState(item?.category || 'life');
    const [blurb, setBlurb] = useState(item?.blurb || '');
    const [image, setImage] = useState(item?.image || '');
    const [rating, setRating] = useState(item?.rating != null ? String(item.rating) : '');
    const nameReady = name.trim().length > 0;

    return (
        <PaperSheet open onClose={onClose} title={item ? '编辑商品' : '新增商品'} tape="rose">
            <div className="space-y-3">
                <div className="flex gap-3 items-start">
                    <div className="w-20 h-20 rounded-2xl flex items-center justify-center text-[38px] shrink-0 overflow-hidden" style={{ background: THUMB_BG, border: '1px solid rgba(176,170,158,0.6)' }}>
                        <ShopItemImage item={{ image, emoji: emoji.trim() || '🎁' }} className="w-full h-full object-cover" />
                    </div>
                    <div className="flex-1 min-w-0 space-y-2">
                        <input value={name} onChange={e => setName(e.target.value)} placeholder="商品名称"
                            className="w-full px-3 py-2 rounded-xl text-sm outline-none" style={paperInput} maxLength={28} />
                        <div className="grid grid-cols-[76px_1fr] gap-2">
                            <input value={emoji} onChange={e => setEmoji(e.target.value)} placeholder="emoji"
                                className="w-full px-3 py-2 rounded-xl text-sm outline-none text-center" style={paperInput} maxLength={4} />
                            <input value={price} onChange={e => setPrice(e.target.value)} placeholder="价格"
                                inputMode="decimal" className="w-full px-3 py-2 rounded-xl text-sm outline-none" style={paperInput} />
                        </div>
                    </div>
                </div>

                <div>
                    <div className="text-[11px] font-black mb-1.5" style={{ color: INK }}>分类</div>
                    <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                        {SHOP_CATEGORIES.map(c => (
                            <button key={c.key} onClick={() => setCategory(c.key)}
                                className="shrink-0 px-3 py-1.5 rounded-full text-[12px] font-bold transition-all active:scale-95"
                                style={chipStyle(category === c.key)}>
                                {c.emoji} {c.label}
                            </button>
                        ))}
                    </div>
                </div>

                <textarea value={blurb} onChange={e => setBlurb(e.target.value)} placeholder="一句商品描述"
                    rows={2} className="w-full px-3 py-2 rounded-xl text-sm outline-none resize-none" style={paperInput} maxLength={60} />

                <input value={image} onChange={e => setImage(e.target.value)} placeholder="图片 URL（可选，http/https）"
                    className="w-full px-3 py-2 rounded-xl text-sm outline-none" style={paperInput} />

                <input value={rating} onChange={e => setRating(e.target.value)} placeholder="评分 1.0-5.0（可选）"
                    inputMode="decimal" className="w-full px-3 py-2 rounded-xl text-sm outline-none" style={paperInput} />

                <div className="rounded-xl px-3 py-2 text-[11px] leading-relaxed" style={{ background: 'rgba(31,29,26,0.06)', color: INK_SOFT }}>
                    保存后会出现在这台手机的货架里，之后的购物车、小票和送礼记录都会按这份资料走。
                </div>

                <ScrapButton variant={nameReady ? 'ink' : 'ghost'} disabled={!nameReady}
                    onClick={() => onSave({ id: item?.id, name, emoji, price, category, blurb, image, rating })}
                    className="w-full py-3 text-[14px]">
                    {item ? '保存修改' : '放上货架'}
                </ScrapButton>
            </div>
        </PaperSheet>
    );
};

// ── 选规格/数量 sheet（纸面底部抽屉） ──
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
        <PaperSheet open onClose={onClose} tape="amber">
            <div className="flex gap-3 items-start">
                <div className="w-20 h-20 rounded-2xl flex items-center justify-center text-[40px] shrink-0 overflow-hidden" style={{ background: THUMB_BG, border: '1px solid rgba(176,170,158,0.6)' }}>
                    <ShopItemImage item={item} className="w-full h-full object-cover" />
                </div>
                <div className="flex-1 min-w-0 pt-1">
                    <div className="text-[20px] font-black leading-none" style={{ color: INK }}>¥{formatPrice(item.price)}</div>
                    <div className="text-[12px] mt-1.5 line-clamp-2" style={{ color: INK_SOFT }}>{item.name}</div>
                </div>
                <button onClick={onClose} className="text-lg active:opacity-60 -mt-1" style={{ color: INK_SOFT }}>✕</button>
            </div>
            <DashedRule className="my-3" />
            <div className="text-[12px] font-bold mb-2" style={{ color: INK }}>{spec.label}</div>
            <div className="flex gap-2 flex-wrap mb-4">
                {spec.opts.map((o, i) => (
                    <button key={o} onClick={() => setPick(i)}
                        className="px-3 py-1.5 rounded-lg text-[12px] font-bold transition-all active:scale-95" style={chipStyle(pick === i)}>
                        {o}
                    </button>
                ))}
            </div>
            <div className="flex items-center justify-between mb-4">
                <span className="text-[12px] font-bold" style={{ color: INK }}>数量</span>
                <div className="flex items-center gap-3">
                    <button onClick={() => setQty(q => Math.max(1, q - 1))} className="w-8 h-8 rounded-full flex items-center justify-center active:scale-90" style={{ background: 'rgba(255,253,247,0.96)', color: INK, border: '1px dashed rgba(150,144,132,0.7)' }}><Minus size={14} weight="bold" /></button>
                    <span className="text-[15px] font-black w-6 text-center tabular-nums" style={{ color: INK }}>{qty}</span>
                    <button onClick={() => setQty(q => Math.min(99, q + 1))} className="w-8 h-8 rounded-full flex items-center justify-center active:scale-90" style={{ background: INK, color: PAPER }}><Plus size={14} weight="bold" /></button>
                </div>
            </div>
            <ScrapButton variant={afford ? 'ink' : 'ghost'} onClick={() => afford && onConfirm(qty)} disabled={!afford} className="w-full py-3 text-[14px]">
                {mode === 'cart' ? '放进篮子' : afford ? `立刻买下 · ¥${formatPrice(cost)}` : '钱包不足'}
            </ScrapButton>
        </PaperSheet>
    );
};

// ── 寄件记录 + 物流配送进度 ──
const ORDER_FILTERS: { key: 'all' | OrderStatusKey; label: string }[] = [
    { key: 'all', label: '全部' },
    { key: 'toReceive', label: '在途' },
    { key: 'toReview', label: '待留言' },
    { key: 'done', label: '已了结' },
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
            <div className="flex gap-2 mb-3 overflow-x-auto no-scrollbar">
                {ORDER_FILTERS.map(f => (
                    <button key={f.key} onClick={() => setFilter(f.key)}
                        className="shrink-0 px-3.5 py-1.5 rounded-full text-[12px] font-bold transition-all active:scale-95" style={chipStyle(filter === f.key)}>{f.label}</button>
                ))}
            </div>
            {shown.length === 0 ? (
                <EmptyState Icon={Truck} title={filter === 'all' ? '还没寄出过心意' : '这里还没有寄件'} onGoShop={onGoShop} />
            ) : (
                <div className="space-y-3">
                    {shown.map(o => {
                        const refunded = !!o.refundedAt;
                        const p = orderProgress(o, now);
                        const stageIdx = ORDER_STAGES.findIndex(s => s.key === p.stage);
                        const received = !!o.receivedAt;
                        const pendingItems = received && !refunded ? o.items.filter(it => !isItemReviewed(reviews, o.id, it.itemId)) : [];
                        return (
                            <div key={o.id} className="rounded-2xl p-3.5" style={PANEL}>
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-[12px] font-black" style={{ color: refunded ? INK_SOFT : INK }}>
                                        {refunded ? '已退款' : received ? (pendingItems.length ? '待留言' : '心意已达') : p.label}
                                    </span>
                                    <span className="text-[11px]" style={{ color: INK_SOFT }}>{o.paidBy === 'char' ? `${o.payerName || 'TA'}代付` : '自己付'} · ¥{formatPrice(o.total)}</span>
                                </div>
                                <div className="flex items-center gap-1.5 flex-wrap mb-2.5">
                                    {o.items.map((it, i) => (
                                        <span key={i} className="inline-flex items-center gap-1 text-[12px] rounded-full px-2 py-0.5" style={{ color: INK, background: 'rgba(150,144,132,0.16)' }}>
                                            <span className="text-[14px]">{it.emoji}</span>{it.name}{it.qty > 1 ? `×${it.qty}` : ''}
                                        </span>
                                    ))}
                                </div>
                                {!received && !refunded && (
                                    <>
                                        <div className="h-1.5 rounded-full overflow-hidden mb-1.5" style={{ background: 'rgba(150,144,132,0.22)' }}>
                                            <div className="h-full rounded-full transition-all" style={{ width: `${p.pct}%`, background: INK }} />
                                        </div>
                                        <div className="flex justify-between mb-2">
                                            {ORDER_STAGES.map((s, i) => (
                                                <div key={s.key} className="flex flex-col items-center gap-0.5">
                                                    <span className="w-2 h-2 rounded-full" style={{ background: i <= stageIdx ? INK : 'rgba(150,144,132,0.35)' }} />
                                                    <span className="text-[8px]" style={{ color: i <= stageIdx ? INK : INK_SOFT, fontWeight: i <= stageIdx ? 700 : 400 }}>{s.label}</span>
                                                </div>
                                            ))}
                                        </div>
                                        <div className="text-[10px] mb-2" style={{ color: INK_SOFT }}>{p.etaText}</div>
                                    </>
                                )}
                                <div className="flex items-center justify-end gap-2 flex-wrap">
                                    {!refunded && (
                                        <ScrapButton variant="paper" onClick={() => onLogistics(o)} icon={<Path size={13} weight="bold" />} className="px-3 py-1.5 text-[11px]">查看物流</ScrapButton>
                                    )}
                                    {!received && !refunded && o.paidBy === 'self' && (
                                        <ScrapButton variant="ghost" onClick={() => onRefund(o)} icon={<ArrowCounterClockwise size={13} weight="bold" />} className="px-3 py-1.5 text-[11px]">申请退款</ScrapButton>
                                    )}
                                    {p.canReceive && !refunded && (
                                        <ScrapButton variant="ink" onClick={() => onReceive(o)} icon={<CheckCircle size={13} weight="fill" />} className="px-4 py-1.5 text-[11px]">确认收货</ScrapButton>
                                    )}
                                    {pendingItems.map((it, i) => (
                                        <ScrapButton key={i} variant="ink" onClick={() => onReview(o, it)} icon={<PencilSimpleLine size={13} weight="bold" />} className="px-3 py-1.5 text-[11px]">留言{it.emoji}</ScrapButton>
                                    ))}
                                    {refunded && <span className="text-[10px]" style={{ color: INK_SOFT }}>{new Date(o.refundedAt!).toLocaleString()} 已退款</span>}
                                    {received && !refunded && !pendingItems.length && <span className="text-[10px]" style={{ color: INK_SOFT }}>{new Date(o.receivedAt!).toLocaleString()} 已了结</span>}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

// ── 物流详情（轨迹时间轴，纸面抽屉） ──
const LogisticsSheet: React.FC<{ order: ShopOrder; onClose: () => void; }> = ({ order, onClose }) => {
    const trace = orderTrace(order);
    return (
        <PaperSheet open onClose={onClose} title="心意速递 · 物流详情" tape="ink">
            <div className="text-[11px] mb-3 text-center" style={{ color: INK_SOFT, fontFamily: 'var(--font-label)' }}>NO. SF{order.id.slice(-10).toUpperCase()}</div>
            <div className="flex items-center justify-center gap-1.5 flex-wrap mb-3">
                {order.items.map((it, i) => <span key={i} className="text-[18px]">{it.emoji}</span>)}
            </div>
            <DashedRule className="mb-3" />
            <div className="overflow-y-auto no-scrollbar max-h-[48vh]">
                {trace.map((n, i) => (
                    <div key={n.key} className="flex gap-3">
                        <div className="flex flex-col items-center">
                            <span className="w-3 h-3 rounded-full mt-1" style={{ background: n.current ? INK : 'rgba(150,144,132,0.5)', boxShadow: n.current ? '0 0 0 4px rgba(31,29,26,0.12)' : 'none' }} />
                            {i < trace.length - 1 && <span className="w-0.5 flex-1 my-0.5" style={{ background: 'rgba(150,144,132,0.35)' }} />}
                        </div>
                        <div className={`pb-4 ${i === 0 ? '' : 'opacity-70'}`}>
                            <div className="text-[13px] font-black" style={{ color: INK }}>{n.label}</div>
                            <div className="text-[11px] leading-snug mt-0.5" style={{ color: INK_SOFT }}>{n.desc}</div>
                            <div className="text-[10px] mt-0.5" style={{ color: 'rgba(150,144,132,0.85)' }}>{new Date(n.at).toLocaleString()}</div>
                        </div>
                    </div>
                ))}
            </div>
        </PaperSheet>
    );
};

// ── 写留言（评价） ──
const ReviewModal: React.FC<{
    target: { order: ShopOrder; item: ShopOrderItem } | null;
    onClose: () => void; onSubmit: (stars: number, text: string) => void;
}> = ({ target, onClose, onSubmit }) => {
    const [stars, setStars] = useState(5);
    const [text, setText] = useState('');
    useEffect(() => { if (target) { setStars(5); setText(''); } }, [target?.item.itemId, target?.order.id]);
    return (
        <PaperDialog open={!!target} title={target ? `给 ${target.item.emoji}${target.item.name} 留句话` : ''} en="LEAVE A NOTE" tape="sage"
            onClose={onClose}
            actions={target ? (
                <>
                    <ScrapButton variant="ghost" onClick={onClose} className="flex-1 py-3">先放放</ScrapButton>
                    <ScrapButton variant="ink" onClick={() => onSubmit(stars, text.trim() || '挺合心意的，下回还来翻翻～')} className="flex-1 py-3">贴上墙</ScrapButton>
                </>
            ) : undefined}>
            <div className="space-y-3">
                <div className="flex items-center justify-center gap-2">
                    {Array.from({ length: 5 }).map((_, k) => (
                        <button key={k} onClick={() => setStars(k + 1)} className="active:scale-90 transition-transform">
                            <Star size={28} weight="fill" style={{ color: k < stars ? INK : 'rgba(150,144,132,0.4)' }} />
                        </button>
                    ))}
                </div>
                <div className="text-center text-[12px] font-bold" style={{ color: INK_SOFT }}>{['很差', '失望', '一般', '满意', '超喜欢'][stars - 1]}</div>
                <textarea value={text} onChange={e => setText(e.target.value)} rows={3} placeholder="说说这件礼物怎么样吧（质感 / 物流 / 送人…）"
                    className="w-full px-3 py-2 rounded-xl text-sm outline-none resize-none" style={paperInput} />
            </div>
        </PaperDialog>
    );
};

// ── 空状态（统一手账皮） ──
const EmptyState: React.FC<{ Icon: React.ElementType; title: string; hint?: string; onGoShop?: () => void }> = ({ Icon, title, hint, onGoShop }) => (
    <div className="flex flex-col items-center justify-center text-center gap-2 pt-20" style={{ color: INK_SOFT }}>
        <Stamp size={52} color="ink"><Icon size={26} weight="regular" /></Stamp>
        <p className="text-sm font-bold mt-1" style={{ color: INK }}>{title}</p>
        {hint && <p className="text-[11px]">{hint}</p>}
        {onGoShop && <ScrapButton variant="ink" onClick={onGoShop} className="mt-1 px-4 py-1.5 text-[12px]">去翻翻</ScrapButton>}
    </div>
);

// ── 心意参谋：按角色 / 场景 / 预算挑礼物 ──
const GiftAdvisorView: React.FC<{
    catalog: ShopItem[];
    characters: CharacterProfile[];
    balance: number;
    favorites: string[];
    onOpen: (i: ShopItem) => void;
    onAddCart: (i: ShopItem) => void;
    onBuy: (i: ShopItem) => void;
    onAddWish: (item: ShopItem, char: CharacterProfile) => void;
    onCharShop: (char: CharacterProfile) => Promise<void>;
    onClearCharCart: (char: CharacterProfile) => Promise<void>;
}> = ({ catalog, characters, balance, favorites, onOpen, onAddCart, onBuy, onAddWish, onCharShop, onClearCharCart }) => {
    const [charId, setCharId] = useState<string>(characters[0]?.id || '');
    const [occasion, setOccasion] = useState<GiftOccasionKey>('daily');
    const [budget, setBudget] = useState(199);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (!characters.length) return;
        if (!characters.some(c => c.id === charId)) setCharId(characters[0].id);
    }, [characters, charId]);

    const char = characters.find(c => c.id === charId) || characters[0] || null;
    const stage = relationStageFromAffection(char?.affection);

    useEffect(() => {
        if (char) setBudget(stage.sweetPrice);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [char?.id]);

    const advice = useMemo(() => {
        if (!char) return [] as GiftAdvice[];
        return recommendGiftsForCharacter(catalog, {
            charName: char.convoSettings?.remarkName?.trim() || char.name,
            affection: char.affection,
            personaText: buildFullCharacterSetting(char, { includeMemos: true }),
            occasion,
            budget,
            favorites,
        }, 8);
    }, [catalog, char, occasion, budget, favorites]);

    if (!characters.length) return <EmptyState Icon={Gift} title="还没有可参谋的对象" hint="有角色后，心意铺会按 TA 的人设和关系阶段挑礼物" />;
    if (!char) return null;

    const charName = char.convoSettings?.remarkName?.trim() || char.name;
    const wishLines = resolveCart(char.shopCart);
    const wishTotal = cartTotal(char.shopCart);

    return (
        <div className="pt-1 space-y-3">
            <div className="rounded-2xl p-3.5" style={PANEL}>
                <SectionTag en="FOR WHOM" className="mb-2">给谁挑</SectionTag>
                <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2">
                    {characters.map((c, i) => {
                        const on = c.id === char.id;
                        return (
                            <button key={c.id} onClick={() => setCharId(c.id)}
                                className="shrink-0 flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-full transition-all active:scale-95"
                                style={on ? { background: INK, color: PAPER } : { background: 'rgba(255,253,247,0.76)', color: INK_SOFT, border: '1px dashed rgba(150,144,132,0.6)' }}>
                                <img src={c.convoSettings?.charAvatarOverride || c.avatar} className="w-7 h-7 rounded-full object-cover" alt="" />
                                <span className="text-[12px] font-black">{c.convoSettings?.remarkName?.trim() || c.name}</span>
                                {cartCount(c.shopCart) > 0 && <InkBadge n={cartCount(c.shopCart)} className={on ? '' : 'opacity-80'} />}
                            </button>
                        );
                    })}
                </div>
                <div className="grid grid-cols-2 gap-2 mt-1">
                    <div className="rounded-xl px-3 py-2" style={{ background: 'rgba(31,29,26,0.08)' }}>
                        <div className="text-[12px] font-black" style={{ color: INK }}>{stage.label}</div>
                        <div className="text-[10px] mt-0.5" style={{ color: INK_SOFT }}>{stage.hint}</div>
                    </div>
                    <button disabled={busy} onClick={async () => { setBusy(true); try { await onCharShop(char); } finally { setBusy(false); } }}
                        className="rounded-xl px-3 py-2 text-left active:scale-[0.98] transition-transform"
                        style={{ background: INK, color: PAPER }}>
                        <div className="text-[12px] font-black">{busy ? 'TA 正在翻' : '请 TA 逛铺'}</div>
                        <div className="text-[10px] mt-0.5" style={{ opacity: 0.78 }}>让 {charName} 自己挑一次</div>
                    </button>
                </div>
            </div>

            <div className="rounded-2xl p-3.5" style={PANEL}>
                <div className="flex items-center justify-between mb-2">
                    <SectionTag en="SCENE">场景和预算</SectionTag>
                    <span className="text-[12px] font-black tabular-nums" style={{ color: INK }}>¥{budget}</span>
                </div>
                <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2">
                    {SHOP_GIFT_OCCASIONS.map(o => (
                        <button key={o.key} onClick={() => setOccasion(o.key)}
                            className="shrink-0 px-3 py-1.5 rounded-full text-[12px] font-bold transition-all active:scale-95" style={chipStyle(occasion === o.key)}>
                            {o.label}
                        </button>
                    ))}
                </div>
                <input type="range" min={20} max={999} step={10} value={budget}
                    onChange={e => setBudget(Number(e.target.value))}
                    className="w-full accent-[#1f1d1a]" />
                <div className="flex justify-between text-[10px]" style={{ color: INK_SOFT }}>
                    <span>小心意</span>
                    <span>郑重点</span>
                </div>
            </div>

            {wishLines.length > 0 && (
                <div className="rounded-2xl p-3.5" style={PANEL}>
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-[13px] font-black" style={{ color: INK }}>{charName} 的心愿单</span>
                        <span className="text-[12px] font-black" style={{ color: INK }}>¥{formatPrice(wishTotal)}</span>
                    </div>
                    <div className="space-y-1.5 mb-2.5">
                        {wishLines.slice(0, 4).map(({ item, qty }) => (
                            <button key={item.id} onClick={() => onOpen(item)}
                                className="w-full flex items-center gap-2 text-left rounded-xl px-2 py-1.5 active:opacity-70"
                                style={{ background: 'rgba(255,253,247,0.64)' }}>
                                <span className="text-[18px]">{item.emoji}</span>
                                <span className="flex-1 min-w-0 truncate text-[12px] font-bold" style={{ color: INK }}>{item.name} ×{qty}</span>
                                <span className="text-[11px]" style={{ color: INK_SOFT }}>¥{formatPrice(item.price * qty)}</span>
                            </button>
                        ))}
                    </div>
                    <ScrapButton variant={balance >= wishTotal ? 'ink' : 'ghost'} disabled={busy || balance < wishTotal}
                        onClick={async () => { setBusy(true); try { await onClearCharCart(char); } finally { setBusy(false); } }}
                        className="w-full py-2 text-[12px]">
                        {balance >= wishTotal ? `替 TA 清空心愿单` : '钱包不足以代付'}
                    </ScrapButton>
                </div>
            )}

            <div>
                <SectionTag en="PICKS" className="mb-2">参谋挑的</SectionTag>
                <div className="space-y-2.5">
                    {advice.map(a => (
                        <GiftAdviceCard key={a.item.id} advice={a} balance={balance} char={char}
                            onOpen={onOpen} onAddCart={onAddCart} onBuy={onBuy} onAddWish={onAddWish} />
                    ))}
                </div>
            </div>
        </div>
    );
};

const GiftAdviceCard: React.FC<{
    advice: GiftAdvice;
    balance: number;
    char: CharacterProfile;
    onOpen: (i: ShopItem) => void;
    onAddCart: (i: ShopItem) => void;
    onBuy: (i: ShopItem) => void;
    onAddWish: (item: ShopItem, char: CharacterProfile) => void;
}> = ({ advice, balance, char, onOpen, onAddCart, onBuy, onAddWish }) => {
    const item = advice.item;
    const afford = balance >= item.price;
    return (
        <div className="rounded-2xl p-3 flex gap-3" style={PANEL}>
            <button onClick={() => onOpen(item)}
                className="w-20 h-20 rounded-2xl flex items-center justify-center text-[38px] shrink-0 overflow-hidden active:scale-95 transition-transform"
                style={{ background: THUMB_BG, border: '1px solid rgba(176,170,158,0.55)' }}>
                <ShopItemImage item={item} className="w-full h-full object-cover" />
            </button>
            <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                    <button onClick={() => onOpen(item)} className="text-left min-w-0">
                        <div className="text-[14px] font-black truncate" style={{ color: INK }}>{item.name}</div>
                        <div className="text-[11px] mt-0.5" style={{ color: INK_SOFT }}>¥{formatPrice(item.price)} · {advice.relationLabel}</div>
                    </button>
                    <span className="shrink-0 text-[13px] font-black" style={{ color: INK }}>{Math.max(0, Math.round(advice.score))}</span>
                </div>
                <div className="text-[11px] leading-snug mt-1.5 line-clamp-2" style={{ color: '#3a362f' }}>{advice.reason}</div>
                {advice.caution && <div className="text-[10px] mt-1" style={{ color: INK_SOFT }}>{advice.caution}</div>}
                <div className="flex gap-1.5 flex-wrap mt-2">
                    {advice.tags.map(t => (
                        <span key={t} className="rounded-full px-2 py-0.5 text-[9.5px] font-bold" style={{ background: 'rgba(31,29,26,0.08)', color: INK }}>{t}</span>
                    ))}
                </div>
                <div className="flex items-center gap-2 mt-2.5">
                    <button onClick={() => onAddCart(item)} className="w-8 h-8 rounded-full flex items-center justify-center active:scale-90 transition-transform" style={{ background: 'rgba(255,253,247,0.95)', color: INK, border: '1px dashed rgba(150,144,132,0.7)' }}>
                        <ShoppingCart size={15} weight="bold" />
                    </button>
                    <ScrapButton variant="paper" onClick={() => onAddWish(item, char)} className="px-3 py-1.5 text-[11px]">夹心愿</ScrapButton>
                    <ScrapButton variant={afford ? 'ink' : 'ghost'} onClick={() => afford && onBuy(item)} disabled={!afford} className="px-3 py-1.5 text-[11px]">
                        {afford ? '买下' : '差点'}
                    </ScrapButton>
                </div>
            </div>
        </div>
    );
};

// ── 篮子（购物车） ──
const CartView: React.FC<{
    cart: { itemId: string; qty: number }[];
    isSel: (itemId: string) => boolean;
    onToggleSel: (itemId: string) => void;
    onQty: (itemId: string, qty: number) => void;
    onRemove: (itemId: string) => void;
    onClear: () => void;
    onGoShop: () => void;
    companionCue?: CompanionCue | null;
    companionAvatar?: string;
    registerItemRef?: (itemId: string, el: HTMLDivElement | null) => void;
}> = ({ cart, isSel, onToggleSel, onQty, onRemove, onClear, onGoShop, companionCue, companionAvatar, registerItemRef }) => {
    const lines = resolveCart(cart);
    if (lines.length === 0) return <EmptyState Icon={ShoppingCart} title="篮子空着呢" onGoShop={onGoShop} />;
    return (
        <div className="pt-1">
            <div className="flex items-center justify-between mb-2 px-1">
                <span className="text-[12px] font-bold" style={{ color: INK_SOFT }}>篮里 {cartCount(cart)} 件</span>
                <button onClick={onClear} className="text-[11px] flex items-center gap-1 active:opacity-60" style={{ color: INK_SOFT }}><Trash size={12} weight="bold" />清空</button>
            </div>
            <div className="space-y-2.5">
                {lines.map(({ item, qty }) => {
                    const activeCue = companionCue?.itemId === item.id ? companionCue : null;
                    return (
                    <div key={item.id} ref={el => registerItemRef?.(item.id, el)} className="relative rounded-2xl p-3 flex items-center gap-2.5 transition-all"
                        style={{
                            ...PANEL,
                            boxShadow: activeCue ? '0 0 0 2px #1f1d1a, 0 14px 24px -14px rgba(31,29,26,0.75)' : PANEL.boxShadow,
                        }}>
                        {activeCue && (
                            <div className="absolute left-3 right-3 -top-4 z-20 pointer-events-none">
                                <ShopCoPresencePill cue={activeCue} avatar={companionAvatar} compact />
                            </div>
                        )}
                        <button onClick={() => onToggleSel(item.id)} className="shrink-0 active:scale-90 transition-transform">
                            {isSel(item.id) ? <CheckSquare size={22} weight="fill" style={{ color: INK }} /> : <Square size={22} weight="bold" style={{ color: INK_SOFT }} />}
                        </button>
                        <span className="w-12 h-12 rounded-2xl flex items-center justify-center text-[26px] shrink-0 overflow-hidden" style={{ background: THUMB_BG, border: '1px solid rgba(176,170,158,0.5)' }}>
                            <ShopItemImage item={item} className="w-full h-full object-cover" />
                        </span>
                        <div className="flex-1 min-w-0">
                            <div className="text-[14px] font-black truncate" style={{ color: INK }}>{item.name}</div>
                            <div className="text-[12px] font-bold" style={{ color: INK_SOFT }}>¥{formatPrice(item.price)}</div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            <button onClick={() => qty <= 1 ? onRemove(item.id) : onQty(item.id, qty - 1)} className="w-7 h-7 rounded-full flex items-center justify-center active:scale-90" style={{ background: 'rgba(255,253,247,0.96)', color: INK, border: '1px dashed rgba(150,144,132,0.7)' }}>{qty <= 1 ? <Trash size={12} weight="bold" /> : <Minus size={13} weight="bold" />}</button>
                            <span className="text-[13px] font-black w-5 text-center tabular-nums" style={{ color: INK }}>{qty}</span>
                            <button onClick={() => onQty(item.id, qty + 1)} className="w-7 h-7 rounded-full flex items-center justify-center active:scale-90" style={{ background: INK, color: PAPER }}><Plus size={13} weight="bold" /></button>
                        </div>
                    </div>
                    );
                })}
            </div>
        </div>
    );
};

// ── 我的（个人中心） ──
const MyCenter: React.FC<{
    name: string; avatar?: string; balance: number; coins: number;
    counts: Record<OrderStatusKey, number>; checkinDone: boolean; onCheckin: () => void;
    bagCount: number; favCount: number; footprintCount: number; couponCount: number; wishCount: number;
    onGoOrders: (f: 'all' | OrderStatusKey) => void; onOpenSub: (s: SubView) => void;
}> = ({ name, avatar, balance, coins, counts, checkinDone, onCheckin, bagCount, favCount, footprintCount, couponCount, wishCount, onGoOrders, onOpenSub }) => {
    const orderEntries: { key: OrderStatusKey; label: string; Icon: React.ElementType; n: number }[] = [
        { key: 'toReceive', label: '在途', Icon: Truck, n: counts.toReceive },
        { key: 'toReview', label: '待留言', Icon: PencilSimpleLine, n: counts.toReview },
        { key: 'refunded', label: '退款/售后', Icon: ArrowCounterClockwise, n: counts.refunded },
        { key: 'done', label: '已了结', Icon: CheckCircle, n: counts.done },
    ];
    const tools: { label: string; Icon: React.ElementType; n?: number; go: () => void }[] = [
        { label: '我的柜子', Icon: Handbag, n: bagCount, go: () => onOpenSub('bag') },
        { label: '心头好', Icon: Heart, n: favCount, go: () => onOpenSub('fav') },
        { label: '翻看过的', Icon: ClockCounterClockwise, n: footprintCount, go: () => onOpenSub('footprints') },
        { label: '撕券处', Icon: Ticket, n: couponCount, go: () => onOpenSub('coupons') },
        { label: '心意账本', Icon: ReceiptIcon, go: () => onOpenSub('receipts') },
        { label: '心意参谋', Icon: Storefront, n: wishCount, go: () => onOpenSub('advisor') },
    ];
    return (
        <div className="pt-1 space-y-3">
            {/* 头部：墨色名牌 + 拍立得头像 */}
            <div className="relative rounded-2xl p-4 overflow-hidden" style={{ background: INK, color: PAPER, boxShadow: '0 16px 30px -18px rgba(31,29,26,0.7)' }}>
                <div aria-hidden className="absolute inset-0" style={{ backgroundImage: HALFTONE, backgroundSize: '7px 7px', opacity: 0.14 }} />
                <div className="relative flex items-center gap-3">
                    <Polaroid src={avatar} caption={undefined} size={48} rotate={-3} fallback={<span className="text-[24px]">🙂</span>} />
                    <div className="flex-1 min-w-0">
                        <div className="text-[16px] font-black truncate">{name}</div>
                        <div className="text-[11px] mt-0.5" style={{ opacity: 0.82 }}>心意铺常客 · 一件件把心意寄出去</div>
                    </div>
                </div>
                <div className="relative flex gap-2 mt-3">
                    <div className="flex-1 rounded-xl px-3 py-2" style={{ background: 'rgba(255,255,255,0.12)' }}>
                        <div className="text-[15px] font-black tabular-nums">¥{formatPrice(balance)}</div>
                        <div className="text-[10px]" style={{ opacity: 0.82 }}>钱包余额</div>
                    </div>
                    <div className="flex-1 rounded-xl px-3 py-2" style={{ background: 'rgba(255,255,255,0.12)' }}>
                        <div className="text-[15px] font-black tabular-nums">◑ {coins}</div>
                        <div className="text-[10px]" style={{ opacity: 0.82 }}>心意币</div>
                    </div>
                    <button onClick={onCheckin} disabled={checkinDone}
                        className="shrink-0 px-3 rounded-xl text-[12px] font-black flex flex-col items-center justify-center active:scale-95 transition-transform"
                        style={checkinDone ? { background: 'rgba(255,255,255,0.12)', color: 'rgba(246,243,236,0.6)' } : { background: PAPER, color: INK }}>
                        <CalendarCheck size={18} weight="fill" />
                        {checkinDone ? '已盖章' : '盖章'}
                    </button>
                </div>
            </div>

            {/* 寄件记录 */}
            <div className="rounded-2xl p-3.5" style={PANEL}>
                <button onClick={() => onGoOrders('all')} className="w-full flex items-center justify-between mb-3 active:opacity-70">
                    <span className="text-[13px] font-black" style={{ color: INK }}>寄件记录</span>
                    <span className="text-[11px] flex items-center gap-0.5" style={{ color: INK_SOFT }}>看全部 <CaretRight size={12} weight="bold" /></span>
                </button>
                <div className="grid grid-cols-4 gap-1">
                    {orderEntries.map(e => (
                        <button key={e.key} onClick={() => onGoOrders(e.key)} className="flex flex-col items-center gap-1 py-1 active:scale-95 transition-transform relative">
                            <e.Icon size={24} weight="regular" style={{ color: INK }} />
                            <span className="text-[10px]" style={{ color: INK_SOFT }}>{e.label}</span>
                            {e.n > 0 && <span className="absolute top-0 right-2"><InkBadge n={e.n} /></span>}
                        </button>
                    ))}
                </div>
            </div>

            {/* 工具 */}
            <div className="rounded-2xl p-3.5" style={PANEL}>
                <div className="text-[13px] font-black mb-3" style={{ color: INK }}>抽屉里的小工具</div>
                <div className="grid grid-cols-4 gap-y-4 gap-x-1">
                    {tools.map(t => (
                        <button key={t.label} onClick={t.go} className="flex flex-col items-center gap-1 active:scale-95 transition-transform relative">
                            <t.Icon size={24} weight="regular" style={{ color: INK }} />
                            <span className="text-[10px]" style={{ color: INK_SOFT }}>{t.label}</span>
                            {t.n != null && t.n > 0 && <span className="absolute -top-1 right-2"><InkBadge n={t.n} /></span>}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
};

// ── 心头好（收藏） ──
const FavoritesView: React.FC<{
    favorites: string[]; balance: number;
    onOpen: (i: ShopItem) => void; onToggleFav: (id: string) => void; onBuy: (i: ShopItem) => void; onAddCart: (i: ShopItem) => void;
    onGoShop: () => void;
}> = ({ favorites, balance, onOpen, onToggleFav, onBuy, onAddCart, onGoShop }) => {
    const items = favorites.map(id => getShopItem(id)).filter((x): x is ShopItem => !!x);
    if (items.length === 0) return <EmptyState Icon={Heart} title="还没收心头好" hint="逛货架时点 ❤ 把心头好收起来" onGoShop={onGoShop} />;
    return (
        <div className="grid grid-cols-2 gap-3 pt-1">
            {items.map(item => (
                <ItemCard key={item.id} item={item} balance={balance} faved onOpen={onOpen} onToggleFav={onToggleFav} onBuy={onBuy} onAddCart={onAddCart} />
            ))}
        </div>
    );
};

// ── 翻看过的（浏览足迹） ──
const FootprintsView: React.FC<{
    footprints: { itemId: string; at: number }[];
    onOpen: (i: ShopItem) => void; onClear: () => void; onGoShop: () => void;
}> = ({ footprints, onOpen, onClear, onGoShop }) => {
    const list = resolveFootprints(footprints);
    if (list.length === 0) return <EmptyState Icon={ClockCounterClockwise} title="还没翻过什么" onGoShop={onGoShop} />;
    return (
        <div className="pt-1">
            <div className="flex items-center justify-between mb-2 px-1">
                <span className="text-[12px] font-bold" style={{ color: INK_SOFT }}>翻看过 {list.length} 件</span>
                <button onClick={onClear} className="text-[11px] flex items-center gap-1 active:opacity-60" style={{ color: INK_SOFT }}><Trash size={12} weight="bold" />清空</button>
            </div>
            <div className="space-y-2.5">
                {list.map(({ item, at }) => (
                    <button key={item.id} onClick={() => onOpen(item)} className="w-full rounded-2xl p-3 flex items-center gap-3 active:scale-[0.99] transition-transform text-left" style={PANEL}>
                        <span className="w-12 h-12 rounded-2xl flex items-center justify-center text-[26px] shrink-0 overflow-hidden" style={{ background: THUMB_BG, border: '1px solid rgba(176,170,158,0.5)' }}>
                            <ShopItemImage item={item} className="w-full h-full object-cover" />
                        </span>
                        <div className="flex-1 min-w-0">
                            <div className="text-[14px] font-black truncate" style={{ color: INK }}>{item.name}</div>
                            <div className="text-[11px]" style={{ color: INK_SOFT }}>¥{formatPrice(item.price)} · {new Date(at).toLocaleDateString()} 翻看</div>
                        </div>
                        <CaretRight size={16} weight="bold" className="shrink-0" style={{ color: INK_SOFT }} />
                    </button>
                ))}
            </div>
        </div>
    );
};

// ── 撕券处（领券中心） ──
const CouponsView: React.FC<{ claimed: string[]; onClaim: (id: string) => void; }> = ({ claimed, onClaim }) => (
    <div className="pt-1 space-y-2.5">
        {SHOP_COUPONS.map(c => {
            const got = claimed.includes(c.id);
            return (
                <div key={c.id} className="rounded-2xl overflow-hidden flex items-stretch" style={PANEL}>
                    <div className="w-28 shrink-0 flex flex-col items-center justify-center py-3 relative" style={{ background: INK, color: PAPER }}>
                        <div aria-hidden className="absolute inset-0" style={{ backgroundImage: HALFTONE, backgroundSize: '6px 6px', opacity: 0.14 }} />
                        <div className="relative text-[24px] font-black leading-none">¥{formatPrice(c.discount)}</div>
                        <div className="relative text-[10px] mt-1" style={{ opacity: 0.85 }}>满 {c.threshold} 可用</div>
                    </div>
                    <div className="flex-1 flex items-center justify-between px-3">
                        <div>
                            <div className="text-[13px] font-black" style={{ color: INK }}>{c.title}</div>
                            <div className="text-[10px] mt-0.5" style={{ color: INK_SOFT }}>全场通用 · 结算自动撕最优那张</div>
                        </div>
                        <button onClick={() => onClaim(c.id)} disabled={got}
                            className="px-4 py-1.5 rounded-full text-[12px] font-bold active:scale-95 transition-transform"
                            style={got ? { background: 'rgba(150,144,132,0.18)', color: INK_SOFT } : { background: INK, color: PAPER }}>
                            {got ? '已撕下' : '撕下'}
                        </button>
                    </div>
                </div>
            );
        })}
        <div className="text-center text-[10px] pt-2" style={{ color: INK_SOFT }}>撕下的券会在篮子结算时自动选用最优的一张</div>
    </div>
);

// ── 我的柜子（背包） ──
const BagView: React.FC<{ inventory: ShopOwnedItem[]; onGift: (o: ShopOwnedItem) => void; }> = ({ inventory, onGift }) => {
    if (inventory.length === 0) return <EmptyState Icon={Handbag} title="柜子空空的" hint="去货架买点礼物，再回来寄给角色吧" />;
    return (
        <div className="space-y-2.5 pt-1">
            {inventory.map(o => (
                <div key={o.uid} className="rounded-2xl p-3 flex items-center gap-3" style={PANEL}>
                    <span className="w-12 h-12 rounded-2xl flex items-center justify-center text-[26px] shrink-0" style={{ background: THUMB_BG, border: '1px solid rgba(176,170,158,0.5)' }}>{o.emoji}</span>
                    <div className="flex-1 min-w-0">
                        <div className="text-[14px] font-black truncate" style={{ color: INK }}>{o.name}</div>
                        <div className="text-[11px]" style={{ color: INK_SOFT }}>¥{formatPrice(o.price)} · {new Date(o.boughtAt).toLocaleDateString()}</div>
                    </div>
                    <ScrapButton variant="ink" onClick={() => onGift(o)} icon={<Gift size={15} weight="fill" />} className="px-3.5 py-2 text-[12px]">寄给 TA</ScrapButton>
                </div>
            ))}
        </div>
    );
};

// ── 心意账本（小票） ──
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
                {([['mine', '我寄的'], ['char', '角色的']] as const).map(([k, label]) => (
                    <button key={k} onClick={() => setSide(k)}
                        className="px-3.5 py-1.5 rounded-full text-[12px] font-bold transition-all active:scale-95" style={chipStyle(side === k)}>{label}</button>
                ))}
            </div>

            {side === 'mine' ? (
                <ReceiptList list={myReceipts} empty="账本还是空的" />
            ) : (
                <>
                    {characters.length === 0 ? (
                        <div className="text-center text-xs pt-16" style={{ color: INK_SOFT }}>还没有角色</div>
                    ) : (
                        <>
                            <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2.5">
                                {characters.map(c => {
                                    const on = charId === c.id;
                                    return (
                                        <button key={c.id} onClick={() => setCharId(c.id)}
                                            className="shrink-0 flex items-center gap-1.5 pl-1 pr-3 py-1 rounded-full transition-all active:scale-95"
                                            style={on ? { background: INK, color: PAPER } : { background: 'rgba(255,253,247,0.7)', color: INK_SOFT, border: '1px dashed rgba(150,144,132,0.6)' }}>
                                            <img src={c.convoSettings?.charAvatarOverride || c.avatar} className="w-6 h-6 rounded-full object-cover" />
                                            <span className="text-[12px] font-bold">{c.convoSettings?.remarkName?.trim() || c.name}</span>
                                        </button>
                                    );
                                })}
                            </div>
                            {char && (
                                <ScrapButton variant="ink" disabled={busy}
                                    onClick={async () => { setBusy(true); try { await onCharShop(char); } finally { setBusy(false); } }}
                                    icon={<Sparkle size={16} weight="fill" />} className="w-full mb-3 py-2.5 text-[13px]">
                                    {busy ? `${char.name} 正在逛…` : `请 ${char.name} 逛逛铺子`}
                                </ScrapButton>
                            )}
                            {char && resolveCart(char.shopCart).length > 0 && (
                                <div className="mb-3 rounded-2xl p-3" style={PANEL}>
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-[12px] font-bold" style={{ color: INK }}>🛒 {char.name} 的心愿单</span>
                                        <span className="text-[12px] font-black" style={{ color: INK }}>¥{formatPrice(cartTotal(char.shopCart))}</span>
                                    </div>
                                    <div className="space-y-1 mb-2.5">
                                        {resolveCart(char.shopCart).map(({ item, qty }) => (
                                            <div key={item.id} className="flex items-center gap-2 text-[12px]" style={{ color: INK }}>
                                                <span className="text-[16px]">{item.emoji}</span>
                                                <span className="flex-1 truncate">{item.name} ×{qty}</span>
                                                <span style={{ color: INK_SOFT }}>¥{formatPrice(item.price * qty)}</span>
                                            </div>
                                        ))}
                                    </div>
                                    <ScrapButton variant={balance >= cartTotal(char.shopCart) ? 'ink' : 'ghost'} disabled={busy || balance < cartTotal(char.shopCart)}
                                        onClick={async () => { setBusy(true); try { await onClearCharCart(char); } finally { setBusy(false); } }}
                                        className="w-full py-2 text-[12px]">
                                        {balance >= cartTotal(char.shopCart) ? `替 TA 清空心愿单（付 ¥${formatPrice(cartTotal(char.shopCart))}）` : '钱包不足以代付'}
                                    </ScrapButton>
                                </div>
                            )}
                            <ReceiptList list={charReceipts} empty={`${char?.name || 'TA'} 还没逛过，请 TA 逛逛吧`} />
                        </>
                    )}
                </>
            )}
        </div>
    );
};

const ReceiptList: React.FC<{ list: ReturnType<typeof makeReceipt>[]; empty: string; }> = ({ list, empty }) => {
    if (list.length === 0) return <div className="text-center text-xs pt-16" style={{ color: INK_SOFT }}>{empty}</div>;
    return (
        <div className="space-y-2">
            {list.map(r => (
                <div key={r.id} className="rounded-xl px-3 py-2.5 flex items-center gap-2.5" style={{ background: 'rgba(255,253,247,0.85)', border: '1px solid rgba(176,170,158,0.55)' }}>
                    <span className="text-[22px] shrink-0">{r.emoji}</span>
                    <div className="flex-1 min-w-0">
                        <div className="text-[12.5px] leading-snug" style={{ color: INK }}>{receiptLine(r)}</div>
                        <div className="text-[10px] mt-0.5" style={{ color: INK_SOFT }}>¥{formatPrice(r.price)} · {new Date(r.at).toLocaleString()}</div>
                    </div>
                </div>
            ))}
        </div>
    );
};

export default ShopApp;
