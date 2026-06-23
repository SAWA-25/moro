import React, { useState, useMemo, useEffect } from 'react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import Modal from '../components/os/Modal';
import { CharacterProfile, ShopItem, ShopOwnedItem } from '../types';
import {
    SHOP_ITEMS, SHOP_CATEGORIES, formatPrice, makeOwnedItem, makeReceipt,
    buildGiftCardMeta, getShopItem, receiptLine, buildCharShopPrompt, parseCharShopDecision,
    emitShopUpdated, SHOP_UPDATED_EVENT,
    addToCart, setCartQty, cartCount, cartTotal, resolveCart, expandCart,
} from '../utils/shop';
import { resolveAuxApi } from '../utils/auxApi';
import { llmComplete } from '../utils/llmComplete';
import { CaretLeft, Storefront, Handbag, Receipt as ReceiptIcon, Coins, Gift, Sparkle, ShoppingBagOpen, ShoppingCart, Plus, Minus, Trash } from '@phosphor-icons/react';

type Tab = 'shop' | 'cart' | 'bag' | 'receipts';

const ShopApp: React.FC = () => {
    const { closeApp, characters, userProfile, updateUserProfile, apiConfig, auxApiConfig, addToast, adjustUserBalance, updateCharacter } = useOS();

    const [tab, setTab] = useState<Tab>('shop');
    const [cat, setCat] = useState<string>('all');
    const [, forceTick] = useState(0);

    // 别处（聊天回赠等）改了商城数据时刷新
    useEffect(() => {
        const bump = () => forceTick(t => t + 1);
        window.addEventListener(SHOP_UPDATED_EVENT, bump);
        return () => window.removeEventListener(SHOP_UPDATED_EVENT, bump);
    }, []);

    const balance = Math.round((userProfile.balance || 0) * 100) / 100;
    const inventory = userProfile.shopInventory || [];
    const myReceipts = userProfile.shopReceipts || [];
    const cart = userProfile.shopCart || [];
    const cartNum = cartCount(cart);

    // ── 购买（直接进背包） ──
    const buyItem = (item: ShopItem) => {
        if (balance < item.price) { addToast('余额不够啦，去存钱罐挣点零花钱', 'error'); return; }
        adjustUserBalance(-item.price);
        const owned = makeOwnedItem(item);
        const receipt = makeReceipt(item, 'user', 'buy', 'self', userProfile.name || '我');
        updateUserProfile({
            shopInventory: [owned, ...(userProfile.shopInventory || [])],
            shopReceipts: [receipt, ...(userProfile.shopReceipts || [])],
        });
        addToast(`买下了 ${item.emoji}${item.name}`, 'success');
        emitShopUpdated();
    };

    // ── 购物车（淘宝式：加购 → 结算） ──
    const addItemToCart = (item: ShopItem) => {
        updateUserProfile({ shopCart: addToCart(userProfile.shopCart, item.id) });
        addToast(`加入购物车 ${item.emoji}`, 'success');
        emitShopUpdated();
    };
    const changeQty = (itemId: string, qty: number) => {
        updateUserProfile({ shopCart: setCartQty(userProfile.shopCart, itemId, qty) });
        emitShopUpdated();
    };
    const clearMyCart = () => { updateUserProfile({ shopCart: [] }); emitShopUpdated(); };

    // 自己支付：扣钱包 → 整车逐件进背包
    const checkoutSelf = () => {
        const total = cartTotal(cart);
        if (cartNum === 0) return;
        if (balance < total) { addToast('余额不够，先去存钱罐挣点零花钱', 'error'); return; }
        adjustUserBalance(-total);
        const items = expandCart(cart);
        const owned = items.map(makeOwnedItem);
        const receipts = items.map(it => makeReceipt(it, 'user', 'buy', 'self', userProfile.name || '我'));
        updateUserProfile({
            shopInventory: [...owned, ...(userProfile.shopInventory || [])],
            shopReceipts: [...receipts, ...(userProfile.shopReceipts || [])],
            shopCart: [],
        });
        addToast(`已下单 ${items.length} 件，进背包啦`, 'success');
        emitShopUpdated();
    };

    // 求 TA 代付：由副 API 让角色按人设/好感/金额决定是否代付。代付成功 → 整车进用户背包 + 双方小票 + 聊天告知。
    const [payReqBusy, setPayReqBusy] = useState(false);
    const requestCharPay = async (char: CharacterProfile) => {
        const items = expandCart(cart);
        if (items.length === 0) return;
        const total = cartTotal(cart);
        setPayReqBusy(true);
        // 先在聊天里落一条「求代付」请求（让角色语境里看得到）
        const cartBrief = resolveCart(cart).map(({ item, qty }) => `${item.emoji}${item.name}×${qty}`).join('、');
        try {
            await DB.saveMessage({
                charId: char.id, role: 'user', type: 'text',
                content: `[购物车求代付] 我购物车里有：${cartBrief}，一共 ¥${formatPrice(total)}，可以帮我付一下吗～`,
            } as any);
        } catch { /* ignore */ }
        // 副 API 决策
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
            const owned = items.map(makeOwnedItem);
            const userReceipts = items.map(it => makeReceipt(it, 'user', 'receive', char.id, char.name, '代付'));
            const charReceipts = items.map(it => makeReceipt(it, 'char', 'gift', 'user', userProfile.name || '我', '代付'));
            updateCharacter(char.id, { shopReceipts: [...charReceipts, ...(char.shopReceipts || [])] });
            updateUserProfile({
                shopInventory: [...owned, ...(userProfile.shopInventory || [])],
                shopReceipts: [...userReceipts, ...(userProfile.shopReceipts || [])],
                shopCart: [],
            });
            try {
                await DB.saveMessage({
                    charId: char.id, role: 'assistant', type: 'text',
                    content: reply || `付好啦，一共 ¥${formatPrice(total)}，下次别乱花哦~`,
                    metadata: { shopPaidForUser: true },
                } as any);
            } catch { /* ignore */ }
            addToast(`${char.name} 帮你付了 ¥${formatPrice(total)}`, 'success');
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
    const [payPicker, setPayPicker] = useState(false);

    // 帮 TA 清空购物车：用户为角色的心愿购物车买单（扣用户钱包，记角色「买到（你代付）」+ 用户「代付」小票）
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
        // 聊天里落一张礼物卡（user 发出）
        try {
            await DB.saveMessage({
                charId: char.id, role: 'user', type: 'gift_card',
                content: `🎁 我送了你 ${owned.emoji}${owned.name}${note ? ` —— ${note}` : ''}`,
                metadata: { gift: buildGiftCardMeta(base, userProfile.name || '我', note) },
            } as any);
        } catch { /* 落卡失败不阻塞送礼 */ }
        // 双方小票
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

    return (
        <div className="h-full w-full flex flex-col" style={{ background: 'linear-gradient(180deg,#fdf6f1 0%,#f7eee8 100%)' }}>
            {/* 顶栏 */}
            <div className="shrink-0">
                <div style={{ height: 'var(--safe-top)' }} />
                <div className="flex items-center px-4 h-14 gap-2">
                    <button onClick={closeApp} className="p-2 -ml-2 rounded-full active:scale-90 transition-transform text-[#9a6b56]"><CaretLeft size={22} weight="bold" /></button>
                    <ShoppingBagOpen size={22} weight="fill" className="text-[#c2755a]" />
                    <span className="font-black text-[#7a4a38] text-lg tracking-tight">心意铺</span>
                    <div className="flex-1" />
                    <div className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-white/70 shadow-sm">
                        <Coins size={16} weight="fill" className="text-amber-500" />
                        <span className="text-[13px] font-black text-[#7a4a38] tabular-nums">¥{formatPrice(balance)}</span>
                    </div>
                </div>
                {/* tabs */}
                <div className="flex px-4 gap-2 pb-2">
                    {([
                        { id: 'shop', label: '商城', Icon: Storefront },
                        { id: 'cart', label: `购物车${cartNum ? ` ${cartNum}` : ''}`, Icon: ShoppingCart },
                        { id: 'bag', label: `背包${inventory.length ? ` ${inventory.length}` : ''}`, Icon: Handbag },
                        { id: 'receipts', label: '小票', Icon: ReceiptIcon },
                    ] as const).map(t => {
                        const active = tab === t.id;
                        return (
                            <button key={t.id} onClick={() => setTab(t.id)}
                                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[13px] font-bold transition-all active:scale-95 ${active ? 'bg-[#c2755a] text-white shadow-md shadow-rose-200' : 'bg-white/70 text-[#9a6b56]'}`}>
                                <t.Icon size={15} weight={active ? 'fill' : 'bold'} />{t.label}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* 内容区 */}
            <div className="flex-1 overflow-y-auto px-4 pb-6" style={{ scrollbarWidth: 'none' }}>
                {tab === 'shop' && <ShopCatalog cat={cat} setCat={setCat} balance={balance} onBuy={buyItem} onAddCart={addItemToCart} />}
                {tab === 'cart' && (
                    <CartView cart={cart} onQty={changeQty} onClear={clearMyCart} />
                )}
                {tab === 'bag' && <BagView inventory={inventory} onGift={(o) => { setGiftTarget(o); setGiftNote(''); }} />}
                {tab === 'receipts' && (
                    <ReceiptsView
                        myReceipts={myReceipts}
                        characters={characters}
                        balance={balance}
                        onClearCharCart={clearCharCart}
                        onCharShop={async (char) => {
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
                        }}
                    />
                )}
            </div>

            {/* 购物车结算条：固定在 App 底部（自己支付 / 求 TA 代付） */}
            {tab === 'cart' && cartNum > 0 && (
                <div className="shrink-0 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+10px)] pt-2.5 border-t border-rose-100/70 bg-[#faf2ec]">
                    <div className="flex items-center gap-2">
                        <div className="flex-1 min-w-0">
                            <div className="text-[10px] text-[#9a6b56]">合计</div>
                            <div className="text-[18px] font-black text-[#c2755a] leading-none">¥{formatPrice(cartTotal(cart))}</div>
                        </div>
                        <button onClick={() => setPayPicker(true)} className="px-4 py-2.5 rounded-full bg-white border border-[#c2755a]/40 text-[#c2755a] text-[13px] font-bold active:scale-95 transition-transform shrink-0">求 TA 代付</button>
                        <button onClick={checkoutSelf} disabled={balance < cartTotal(cart)} className={`px-5 py-2.5 rounded-full text-[13px] font-bold active:scale-95 transition-transform shrink-0 ${balance >= cartTotal(cart) ? 'bg-[#c2755a] text-white shadow-md shadow-rose-200' : 'bg-slate-200 text-slate-400'}`}>{balance >= cartTotal(cart) ? '自己支付' : '余额不足'}</button>
                    </div>
                </div>
            )}

            {/* 送礼：选角色 */}
            <Modal
                isOpen={!!giftTarget}
                title={giftTarget ? `把 ${giftTarget.emoji}${giftTarget.name} 送给…` : ''}
                onClose={() => { setGiftTarget(null); setGiftNote(''); }}
            >
                <div className="space-y-3">
                    <textarea
                        value={giftNote} onChange={e => setGiftNote(e.target.value)}
                        placeholder="写句赠言（可选）"
                        rows={2}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:border-rose-300 resize-none"
                    />
                    {characters.length === 0 ? (
                        <div className="text-center text-slate-400 text-xs py-6">还没有角色，先去添加好友吧</div>
                    ) : (
                        <div className="grid grid-cols-4 gap-2 max-h-56 overflow-y-auto pr-1">
                            {characters.map(c => (
                                <button key={c.id} onClick={() => confirmGift(c)}
                                    className="flex flex-col items-center gap-1 p-2 rounded-xl border border-slate-100 bg-white hover:border-rose-300 active:scale-95 transition-all">
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
                                <button key={c.id} disabled={payReqBusy} onClick={() => requestCharPay(c)}
                                    className="flex flex-col items-center gap-1 p-2 rounded-xl border border-slate-100 bg-white hover:border-rose-300 active:scale-95 transition-all disabled:opacity-50">
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

// ── 商城目录 ──
const ShopCatalog: React.FC<{ cat: string; setCat: (c: string) => void; balance: number; onBuy: (i: ShopItem) => void; onAddCart: (i: ShopItem) => void; }> = ({ cat, setCat, balance, onBuy, onAddCart }) => {
    const items = useMemo(() => cat === 'all' ? SHOP_ITEMS : SHOP_ITEMS.filter(i => i.category === cat), [cat]);
    return (
        <>
            <div className="flex gap-2 overflow-x-auto pb-2.5 -mx-1 px-1" style={{ scrollbarWidth: 'none' }}>
                {[{ key: 'all', label: '全部', emoji: '🛍️' }, ...SHOP_CATEGORIES].map(c => (
                    <button key={c.key} onClick={() => setCat(c.key)}
                        className={`shrink-0 px-3 py-1.5 rounded-full text-[12px] font-bold transition-all active:scale-95 ${cat === c.key ? 'bg-[#7a4a38] text-white' : 'bg-white/70 text-[#9a6b56]'}`}>
                        {c.emoji} {c.label}
                    </button>
                ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
                {items.map(item => {
                    const afford = balance >= item.price;
                    return (
                        <div key={item.id} className="rounded-2xl bg-white p-3 flex flex-col shadow-sm border border-rose-50">
                            <div className="text-[40px] text-center leading-none mb-1.5 select-none">{item.emoji}</div>
                            <div className="text-[13px] font-black text-[#5a3a2e] truncate">{item.name}</div>
                            <div className="text-[10.5px] text-[#a98c7e] leading-snug line-clamp-2 mb-2 min-h-[27px]">{item.blurb}</div>
                            <div className="flex items-center justify-between mt-auto gap-1.5">
                                <span className="text-[14px] font-black text-[#c2755a]">¥{formatPrice(item.price)}</span>
                                <div className="flex items-center gap-1.5">
                                    <button onClick={() => onAddCart(item)} title="加入购物车"
                                        className="w-7 h-7 rounded-full bg-amber-50 text-[#c2755a] flex items-center justify-center active:scale-90 transition-transform border border-amber-100">
                                        <ShoppingCart size={14} weight="bold" />
                                    </button>
                                    <button onClick={() => onBuy(item)} disabled={!afford}
                                        className={`px-3 py-1 rounded-full text-[12px] font-bold transition-all active:scale-90 ${afford ? 'bg-[#c2755a] text-white shadow-sm' : 'bg-slate-100 text-slate-300'}`}>
                                        {afford ? '购买' : '差点钱'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </>
    );
};

// ── 购物车（淘宝式：数量增减 + 结算条） ──
const CartView: React.FC<{
    cart: { itemId: string; qty: number }[];
    onQty: (itemId: string, qty: number) => void;
    onClear: () => void;
}> = ({ cart, onQty, onClear }) => {
    const lines = resolveCart(cart);
    if (lines.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center text-center text-[#b89a8c] gap-2 pt-20">
                <ShoppingCart size={42} weight="thin" />
                <p className="text-sm">购物车是空的</p>
                <p className="text-[11px]">去商城逛逛，喜欢的先加进来</p>
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
                    <div key={item.id} className="rounded-2xl bg-white p-3 flex items-center gap-3 shadow-sm border border-rose-50">
                        <span className="w-12 h-12 rounded-2xl bg-rose-50 flex items-center justify-center text-[26px] shrink-0">{item.emoji}</span>
                        <div className="flex-1 min-w-0">
                            <div className="text-[14px] font-black text-[#5a3a2e] truncate">{item.name}</div>
                            <div className="text-[12px] text-[#c2755a] font-bold">¥{formatPrice(item.price)}</div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            <button onClick={() => onQty(item.id, qty - 1)} className="w-7 h-7 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center active:scale-90"><Minus size={13} weight="bold" /></button>
                            <span className="text-[13px] font-black text-[#5a3a2e] w-5 text-center tabular-nums">{qty}</span>
                            <button onClick={() => onQty(item.id, qty + 1)} className="w-7 h-7 rounded-full bg-[#c2755a] text-white flex items-center justify-center active:scale-90"><Plus size={13} weight="bold" /></button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

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
                                <button
                                    disabled={busy}
                                    onClick={async () => { setBusy(true); try { await onCharShop(char); } finally { setBusy(false); } }}
                                    className="w-full mb-3 py-2.5 rounded-2xl bg-gradient-to-r from-[#c2755a] to-[#d99a7c] text-white text-[13px] font-bold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform shadow-md shadow-rose-200 disabled:opacity-60">
                                    <Sparkle size={16} weight="fill" />{busy ? `${char.name} 正在逛…` : `邀请 ${char.name} 逛逛商城`}
                                </button>
                            )}
                            {/* 角色心愿购物车：用户可帮 TA 清空（代付） */}
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
