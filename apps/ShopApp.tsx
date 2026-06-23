import React, { useState, useMemo, useEffect } from 'react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import Modal from '../components/os/Modal';
import { CharacterProfile, ShopItem, ShopOwnedItem } from '../types';
import {
    SHOP_ITEMS, SHOP_CATEGORIES, formatPrice, makeOwnedItem, makeReceipt,
    buildGiftCardMeta, getShopItem, receiptLine, buildCharShopPrompt, parseCharShopDecision,
    emitShopUpdated, SHOP_UPDATED_EVENT,
} from '../utils/shop';
import { resolveAuxApi } from '../utils/auxApi';
import { llmComplete } from '../utils/llmComplete';
import { CaretLeft, Storefront, Handbag, Receipt as ReceiptIcon, Coins, Gift, Sparkle, ShoppingBagOpen } from '@phosphor-icons/react';

type Tab = 'shop' | 'bag' | 'receipts';

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

    // ── 购买（进背包） ──
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
                {tab === 'shop' && <ShopCatalog cat={cat} setCat={setCat} balance={balance} onBuy={buyItem} />}
                {tab === 'bag' && <BagView inventory={inventory} onGift={(o) => { setGiftTarget(o); setGiftNote(''); }} />}
                {tab === 'receipts' && (
                    <ReceiptsView
                        myReceipts={myReceipts}
                        characters={characters}
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
        </div>
    );
};

// ── 商城目录 ──
const ShopCatalog: React.FC<{ cat: string; setCat: (c: string) => void; balance: number; onBuy: (i: ShopItem) => void; }> = ({ cat, setCat, balance, onBuy }) => {
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
                            <div className="flex items-center justify-between mt-auto">
                                <span className="text-[14px] font-black text-[#c2755a]">¥{formatPrice(item.price)}</span>
                                <button onClick={() => onBuy(item)} disabled={!afford}
                                    className={`px-3 py-1 rounded-full text-[12px] font-bold transition-all active:scale-90 ${afford ? 'bg-[#c2755a] text-white shadow-sm' : 'bg-slate-100 text-slate-300'}`}>
                                    {afford ? '购买' : '差点钱'}
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </>
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
    onCharShop: (char: CharacterProfile) => Promise<void>;
}> = ({ myReceipts, characters, onCharShop }) => {
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
