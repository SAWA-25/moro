
import React, { useState, useEffect, useRef } from 'react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { BankFullState, BankTransaction, SavingsGoal, ShopStaff, BankGuestbookItem, DollhouseState, ShopReview } from '../types';
import { safeResponseJson } from '../utils/safeApi';
import { injectMemoryPalace } from '../utils/memoryPalace/pipeline';
import BankShopScene from '../components/bank/BankShopScene';
import BankDollhouse from '../components/bank/BankDollhouse';
import BankGameMenu from '../components/bank/BankGameMenu';
import BankAnalytics from '../components/bank/BankAnalytics';
import BankLedger from '../components/bank/BankLedger';
import { BusinessResultModal, ReviewsOverlay, BusinessResult } from '../components/bank/BankBusiness';
import { SHOP_RECIPES, INITIAL_DOLLHOUSE, NPC_CUSTOMERS, buildReviewText } from '../components/bank/BankGameConstants';
import { processImage } from '../utils/file';
import { ContextBuilder } from '../utils/context';
import { Coffee, ClipboardText, ChartBar, Coin, Target, UserCircle, BookOpen, Lightning, Storefront } from '@phosphor-icons/react';
import { paperTexture, WashiTape, TapeLabel, Postmark, PaperNote, PaperClip, HAND_FONT, tinyRotate } from './almanac/handbookKit';

const INITIAL_STATE: BankFullState = {
    config: {
        dailyBudget: 100,
        currencySymbol: '¥', 
    },
    shop: {
        actionPoints: 100,
        shopName: '咖啡馆',
        shopLevel: 1,
        appeal: 100,
        background: '',
        staff: [
            {
                id: 'staff-001',
                name: '系统',
                avatar: '🐱',
                role: 'manager',
                fatigue: 0,
                maxFatigue: 100,
                hireDate: Date.now(),
                x: 50,
                y: 50,
                personality: 'Moro的专属宠物，负责看店',
                isPet: true,
            }
        ],
        unlockedRecipes: ['recipe-coffee-001'],
        activeVisitor: undefined,
        guestbook: [] // New
    },
    goals: [],
    todaySpent: 0,
    lastLoginDate: new Date().toISOString().split('T')[0],
};

// 失效图床：sharkpan.xyz 已无法访问，历史默认资源（店铺背景 / 系统店员头像 / 咖啡馆房间贴图）
// 都指向它，会渲染成裂图。加载时统一清洗成可用的兜底（emoji / 留空走渐变），并配合 <img onError>。
const DEAD_IMG_HOSTS = ['sharkpan.xyz'];
const isDeadImg = (u?: string | null): boolean =>
    typeof u === 'string' && DEAD_IMG_HOSTS.some(h => u.includes(h));

// 营业冷却：每 3 小时可「营业」一轮赚一笔进钱包
const BUSINESS_COOLDOWN_MS = 3 * 60 * 60 * 1000;

// 手账风弹窗壳 + 输入样式（替代共享 Modal，统一拼贴手账观感）
const hbInputStyle: React.CSSProperties = { background: '#fff', borderRadius: 12, color: '#5b4636', boxShadow: 'inset 0 0 0 1px rgba(150,110,70,0.2)' };
const HbModal: React.FC<{
    open: boolean; onClose: () => void; title: string; sub?: string;
    tapeColor?: string; rotate?: number; footer?: React.ReactNode; children: React.ReactNode;
}> = ({ open, onClose, title, sub, tapeColor = 'rgba(231,196,120,0.72)', rotate = -0.6, footer, children }) => {
    if (!open) return null;
    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-6" onClick={onClose}>
            <div className="absolute inset-0 bg-black/45 animate-fade-in" />
            <div className="relative w-full max-w-sm animate-slide-up flex flex-col" style={{ background: '#fffdf7', borderRadius: 18, boxShadow: '0 16px 40px rgba(96,66,40,0.34)', transform: `rotate(${rotate}deg)`, maxHeight: '86vh' }} onClick={e => e.stopPropagation()}>
                <WashiTape className="-top-2 left-10" color={tapeColor} rotate={-12} width={80} />
                <WashiTape className="-top-2 right-10" color={tapeColor} rotate={10} width={80} />
                <div className="p-6 overflow-y-auto no-scrollbar">
                    <div className="text-[22px] font-black" style={{ fontFamily: HAND_FONT, color: '#5b4636' }}>{title}</div>
                    {sub && <div className="text-[11px] mt-0.5 mb-4" style={{ color: '#a98e6f' }}>{sub}</div>}
                    {!sub && <div className="mb-4" />}
                    {children}
                </div>
                {footer && <div className="px-6 pb-6">{footer}</div>}
            </div>
        </div>
    );
};

const BankApp: React.FC = () => {
    const { closeApp, characters, addToast, apiConfig, userProfile, adjustUserBalance } = useOS();
    const [state, setState] = useState<BankFullState>(INITIAL_STATE);
    const [transactions, setTransactions] = useState<BankTransaction[]>([]);
    const [dollhouseState, setDollhouseState] = useState<DollhouseState>(INITIAL_DOLLHOUSE);
    const [isBankDataLoaded, setIsBankDataLoaded] = useState(false);

    // Refs to track latest state synchronously (React 18 batches setState,
    // so we can't rely on setState's updater callback running before DB.save)
    const stateRef = useRef<BankFullState>(INITIAL_STATE);
    const dollhouseRef = useRef<DollhouseState>(INITIAL_DOLLHOUSE);
    
    // Tabs: 'game' (Shop) | 'manage' (Menu) | 'report' (Finance)
    const [activeTab, setActiveTab] = useState<'game' | 'manage' | 'report'>('game');
    
    // UI Modals
    const [showAddTxModal, setShowAddTxModal] = useState(false);
    const [showGoalModal, setShowGoalModal] = useState(false);
    const [showTutorial, setShowTutorial] = useState(false);
    const [showStaffEdit, setShowStaffEdit] = useState(false);
    
    // Guestbook Fullscreen State (Changed from Modal)
    const [showGuestbook, setShowGuestbook] = useState(false);
    // 营业结算 & 口碑评价
    const [businessResult, setBusinessResult] = useState<BusinessResult | null>(null);
    const [showReviews, setShowReviews] = useState(false);
    
    // Forms
    const [txAmount, setTxAmount] = useState('');
    const [txNote, setTxNote] = useState('');
    const [txType, setTxType] = useState<'income' | 'expense'>('expense');
    // 账本子视图：分析 / 互评账本
    const [reportView, setReportView] = useState<'analytics' | 'ledger'>('analytics');
    const [goalName, setGoalName] = useState('');
    const [goalTarget, setGoalTarget] = useState('');

    // Staff Edit Form
    const [editingStaff, setEditingStaff] = useState<ShopStaff | null>(null);
    const staffImageInputRef = useRef<HTMLInputElement>(null);

    // Guestbook Processing
    const [isRefreshingGuestbook, setIsRefreshingGuestbook] = useState(false);

    // Load Data
    useEffect(() => {
        loadData();
    }, []);

    // Calculate Appeal dynamically
    const calculateAppeal = (staffCount: number, unlockedIds: string[]) => {
        const staffAppeal = staffCount * 50;
        const recipeAppeal = unlockedIds.reduce((sum, id) => {
            const r = SHOP_RECIPES.find(r => r.id === id);
            return sum + (r ? r.appeal : 0);
        }, 0);
        return 100 + staffAppeal + recipeAppeal;
    };

    // Compute new state from ref (synchronous), update ref + React state + DB.
    // This avoids React 18's batched setState where the updater callback may not
    // run before DB.save, causing data to never be persisted (root cause of data loss).
    const persistStateUpdate = async (updater: (prev: BankFullState) => BankFullState): Promise<BankFullState> => {
        const nextState = updater(stateRef.current);
        stateRef.current = nextState;
        setState(nextState);
        await DB.saveBankState(nextState);
        return nextState;
    };

    const persistDollhouseUpdate = async (updater: DollhouseState | ((prev: DollhouseState) => DollhouseState)): Promise<DollhouseState> => {
        const nextDollhouse = typeof updater === 'function'
            ? (updater as (prev: DollhouseState) => DollhouseState)(dollhouseRef.current)
            : updater;
        dollhouseRef.current = nextDollhouse;
        setDollhouseState(nextDollhouse);
        await DB.saveBankDollhouse(nextDollhouse);
        return nextDollhouse;
    };

    const loadData = async () => {
        setIsBankDataLoaded(false);
        const savedState = await DB.getBankState();
        const txs = await DB.getAllTransactions();

        let currentState = savedState || INITIAL_STATE;

        // Migration: Ensure Shop structure exists
        if (!currentState.shop) {
            currentState = { ...currentState, shop: INITIAL_STATE.shop };
            if ((currentState as any).pet?.actionPoints) {
                currentState.shop.actionPoints = (currentState as any).pet.actionPoints;
            }
        }
        if (!currentState.shop.guestbook) {
            currentState.shop.guestbook = [];
        }

        // --- Dollhouse: Load separately (same pattern as RoomApp's roomConfig) ---
        let loadedDollhouse = await DB.getBankDollhouse();

        // Migration: If dollhouse was embedded in shop state, extract and save separately
        if (!loadedDollhouse && currentState.shop.dollhouse) {
            loadedDollhouse = currentState.shop.dollhouse;
            await DB.saveBankDollhouse(loadedDollhouse);
        }

        // Use loaded dollhouse or initialize fresh
        let dh = loadedDollhouse || INITIAL_DOLLHOUSE;
        dollhouseRef.current = dh;
        setDollhouseState(dh);

        // If this is a fresh install with no saved dollhouse, persist the initial state
        if (!loadedDollhouse) {
            await DB.saveBankDollhouse(dh);
        }

        // 清洗失效图床(sharkpan)留下的死链：救回历史存档里裂掉的店员头像 / 房间贴图 / 贴纸 / 背景。
        // 幂等——没有死链就什么都不做、不写库。
        {
            let shopChanged = false;
            const cleanStaff = currentState.shop.staff.map(s =>
                isDeadImg(s.avatar)
                    ? (shopChanged = true, { ...s, avatar: s.id === 'staff-001' ? '🐱' : '🙂' })
                    : s
            );
            let cleanBg = currentState.shop.background;
            if (isDeadImg(cleanBg)) { cleanBg = ''; shopChanged = true; }
            if (shopChanged) {
                currentState = { ...currentState, shop: { ...currentState.shop, staff: cleanStaff, background: cleanBg } };
            }

            let dhChanged = false;
            const cleanRooms = dh.rooms.map(r => {
                let room = r;
                if (isDeadImg(room.roomTextureUrl)) { room = { ...room, roomTextureUrl: undefined }; dhChanged = true; }
                if (room.stickers?.some(st => isDeadImg(st.url))) {
                    room = { ...room, stickers: room.stickers.map(st => isDeadImg(st.url) ? { ...st, url: '⭐' } : st) };
                    dhChanged = true;
                }
                return room;
            });
            if (dhChanged) {
                dh = { ...dh, rooms: cleanRooms };
                dollhouseRef.current = dh;
                setDollhouseState(dh);
                await DB.saveBankDollhouse(dh);
            }
        }

        // Strip dollhouse from shop state (it's now managed separately)
        if (currentState.shop.dollhouse) {
            currentState = {
                ...currentState,
                shop: { ...currentState.shop, dollhouse: undefined }
            };
        }

        // Migration: Link "系统" staff to its owner via pet-owner matching
        if (characters.length > 0) {
            const systemStaff = currentState.shop.staff.find(s => s.id === 'staff-001');
            if (systemStaff && systemStaff.isPet && (!systemStaff.ownerCharId || systemStaff.ownerCharId === '')) {
                // Find Moro by name match, fallback to first character
                const moro = characters.find(c => c.name.toLowerCase().includes('moro')) || characters[0];
                currentState = {
                    ...currentState,
                    shop: {
                        ...currentState.shop,
                        staff: currentState.shop.staff.map(s =>
                            s.id === 'staff-001' ? { ...s, ownerCharId: moro.id } : s
                        )
                    }
                };
            }
        }

        // Migration v2 (one-time): Force-update staff-001 defaults, shop bg, and room texture
        // to canonical URL-based assets. Only runs once — subsequent user edits are preserved.
        if (!currentState.dataVersion || currentState.dataVersion < 2) {
            const EXPECTED_STAFF_001 = INITIAL_STATE.shop.staff[0]; // "系统" with URL avatar
            const systemStaff = currentState.shop.staff.find(s => s.id === 'staff-001');
            if (systemStaff) {
                currentState = {
                    ...currentState,
                    shop: {
                        ...currentState.shop,
                        staff: currentState.shop.staff.map(s =>
                            s.id === 'staff-001' ? {
                                ...s,
                                name: EXPECTED_STAFF_001.name,
                                avatar: EXPECTED_STAFF_001.avatar,
                                personality: EXPECTED_STAFF_001.personality,
                            } : s
                        )
                    }
                };
            }

            // Force-update shop background to canonical URL
            currentState = {
                ...currentState,
                shop: { ...currentState.shop, background: INITIAL_STATE.shop.background }
            };

            // Force-update café room texture URL in dollhouse
            const cafeRoom = dh.rooms.find(r => r.id === 'room-1f-left');
            const expectedCafeTexture = INITIAL_DOLLHOUSE.rooms.find(r => r.id === 'room-1f-left')?.roomTextureUrl;
            if (cafeRoom && expectedCafeTexture) {
                const updatedDh: DollhouseState = {
                    ...dh,
                    rooms: dh.rooms.map(r =>
                        r.id === 'room-1f-left' ? { ...r, roomTextureUrl: expectedCafeTexture } : r
                    )
                };
                dollhouseRef.current = updatedDh;
                setDollhouseState(updatedDh);
                await DB.saveBankDollhouse(updatedDh);
            }

            // Mark migration as done so it never runs again
            currentState = { ...currentState, dataVersion: 2 };
        }

        // DAILY RESET LOGIC
        const today = new Date().toISOString().split('T')[0];

        if (currentState.lastLoginDate !== today) {
            // 解耦：AP 不再来自「记账预算结余」（记账已独立为现实流水）。
            // 改为店铺自身的每日补给：登录奖励 + 人气分红。
            const appealNow = calculateAppeal(currentState.shop.staff.length, currentState.shop.unlockedRecipes);
            const dailyAP = 10 + Math.floor(appealNow / 25);

            // 店铺「过夜营业额」→ 进钱包（真实可花的钱），与记账完全无关。
            const passiveRevenue = currentState.shop.staff.length > 0 ? Math.max(0, Math.floor(appealNow * 0.6)) : 0;

            // Recover Fatigue
            const updatedStaff = currentState.shop.staff.map(s => ({
                ...s,
                fatigue: Math.max(0, s.fatigue - 30)
            }));

            currentState = {
                ...currentState,
                todaySpent: 0,
                lastLoginDate: today,
                shop: {
                    ...currentState.shop,
                    actionPoints: (currentState.shop.actionPoints || 0) + dailyAP,
                    staff: updatedStaff,
                    activeVisitor: undefined,
                    totalRevenue: (currentState.shop.totalRevenue || 0) + passiveRevenue,
                }
            };

            await DB.saveBankState(currentState);
            if (passiveRevenue > 0) adjustUserBalance(passiveRevenue);
            addToast(
                passiveRevenue > 0
                    ? `新的一天！店铺补给 +${dailyAP} AP，过夜营业额 +¥${passiveRevenue} 已进钱包`
                    : `新的一天！店铺补给 +${dailyAP} AP（雇个店员就能赚营业额啦）`,
                'success'
            );
        }

        const todayTx = txs.filter(t => t.dateStr === today);
        const spent = todayTx.reduce((sum, t) => sum + t.amount, 0);
        const appeal = calculateAppeal(currentState.shop.staff.length, currentState.shop.unlockedRecipes);

        const finalState = { ...currentState, todaySpent: spent, shop: { ...currentState.shop, appeal } };
        stateRef.current = finalState;
        setState(finalState);
        setTransactions(txs.sort((a,b) => b.timestamp - a.timestamp));

        // Always persist after load to ensure migrations are saved
        await DB.saveBankState(finalState);

        // Show tutorial if first time (default budget is 100 and ap is 100 initial)
        if (!savedState) setShowTutorial(true);
        setIsBankDataLoaded(true);
    };

    // --- Transactions ---

    const handleAddTransaction = async () => {
        if (!txAmount || isNaN(parseFloat(txAmount)) || !txNote.trim()) {
            addToast('请填写金额和内容哦', 'error');
            return;
        }
        
        const amount = parseFloat(txAmount);
        const today = new Date().toISOString().split('T')[0];
        
        const newTx: BankTransaction = {
            id: `tx-${Date.now()}`,
            amount,
            category: 'general',
            note: txNote,
            timestamp: Date.now(),
            dateStr: today,
            type: txType
        };
        
        await DB.saveTransaction(newTx);
        
        const cur = stateRef.current;
        // 只有「支出」计入今日花费（进账不算）；记账纯记现实金钱，不再影响店铺 AP
        const newSpent = cur.todaySpent + (txType === 'expense' ? amount : 0);
        const newState = { ...cur, todaySpent: newSpent };
        stateRef.current = newState;
        setState(newState);
        await DB.saveBankState(newState);

        setTransactions(prev => [newTx, ...prev]);

        setShowAddTxModal(false);
        setTxAmount('');
        setTxNote('');
        setTxType('expense');

        if (txType === 'income') {
            addToast(`进账已记下 +${cur.config.currencySymbol}${amount}`, 'success');
        } else if (newSpent > cur.config.dailyBudget) {
            addToast('支出已记下 · 今天有点超出预算啦', 'info');
        } else {
            addToast('支出已记下', 'success');
        }
    };

    // BankLedger 写入了角色点评后，同步回 transactions 状态（持久化已在 BankLedger 内完成）
    const handleTxUpdated = (updated: BankTransaction) => {
        setTransactions(prev => prev.map(t => t.id === updated.id ? updated : t));
    };

    const handleDeleteTransaction = async (id: string) => {
        const tx = transactions.find(t => t.id === id);
        if (!tx) return;
        await DB.deleteTransaction(id);

        const cur = stateRef.current;
        let newSpent = cur.todaySpent;
        const today = new Date().toISOString().split('T')[0];
        if (tx.dateStr === today) {
            newSpent = Math.max(0, cur.todaySpent - tx.amount);
        }

        const newState = { ...cur, todaySpent: newSpent };
        stateRef.current = newState;
        setState(newState);
        await DB.saveBankState(newState);
        setTransactions(prev => prev.filter(t => t.id !== id));
        addToast('记录已删除', 'success');
    };

    // --- Game Logic ---

    const consumeAP = async (cost: number): Promise<boolean> => {
        const cur = stateRef.current;
        if (cur.shop.actionPoints < cost) {
            addToast(`AP 不足 (需 ${cost})。去省钱吧！`, 'error');
            return false;
        }
        const newAP = cur.shop.actionPoints - cost;
        const newState = { ...cur, shop: { ...cur.shop, actionPoints: newAP } };
        stateRef.current = newState;
        setState(newState);
        await DB.saveBankState(newState);
        return true;
    };

    const handleStaffRest = async (staffId: string) => {
        const COST = 20;
        if (!(await consumeAP(COST))) return;

        const cur = stateRef.current;
        const updatedStaff = cur.shop.staff.map(s =>
            s.id === staffId ? { ...s, fatigue: Math.max(0, s.fatigue - 50) } : s
        );

        const newState = { ...cur, shop: { ...cur.shop, staff: updatedStaff } };
        stateRef.current = newState;
        setState(newState);
        await DB.saveBankState(newState);
        addToast('店员休息好了！', 'success');
    };

    const handleUnlockRecipe = async (recipeId: string, cost: number) => {
        if (!(await consumeAP(cost))) return;

        const cur = stateRef.current;
        const newUnlocked = [...cur.shop.unlockedRecipes, recipeId];
        const newAppeal = calculateAppeal(cur.shop.staff.length, newUnlocked);

        const newState = {
            ...cur,
            shop: {
                ...cur.shop,
                unlockedRecipes: newUnlocked,
                appeal: newAppeal
            }
        };
        stateRef.current = newState;
        setState(newState);
        await DB.saveBankState(newState);
        addToast('新商品上架！店铺人气上升，营业时就能卖了', 'success');
    };

    // --- Fire / Rehire / Delete Staff ---

    const handleFireStaff = async (staffId: string) => {
        const cur = stateRef.current;
        const staff = cur.shop.staff.find(s => s.id === staffId);
        if (!staff) return;

        const updatedActive = cur.shop.staff.filter(s => s.id !== staffId);
        const firedPool = [...(cur.firedStaff || []), { ...staff, fatigue: 0 }];
        const newAppeal = calculateAppeal(updatedActive.length, cur.shop.unlockedRecipes);

        const newState = {
            ...cur,
            shop: { ...cur.shop, staff: updatedActive, appeal: newAppeal },
            firedStaff: firedPool
        };
        stateRef.current = newState;
        setState(newState);
        await DB.saveBankState(newState);
        addToast(`${staff.name} 已被解雇`, 'info');
    };

    const handleRehireStaff = async (staffId: string) => {
        const cur = stateRef.current;
        const staff = (cur.firedStaff || []).find(s => s.id === staffId);
        if (!staff) return;

        const randomX = 20 + Math.random() * 60;
        const rehired = { ...staff, fatigue: 0, x: randomX, y: 50 };
        const updatedActive = [...cur.shop.staff, rehired];
        const updatedFired = (cur.firedStaff || []).filter(s => s.id !== staffId);
        const newAppeal = calculateAppeal(updatedActive.length, cur.shop.unlockedRecipes);

        const newState = {
            ...cur,
            shop: { ...cur.shop, staff: updatedActive, appeal: newAppeal },
            firedStaff: updatedFired
        };
        stateRef.current = newState;
        setState(newState);
        await DB.saveBankState(newState);
        addToast(`${staff.name} 已重新入职！`, 'success');
    };

    const handleDeleteFiredStaff = async (staffId: string) => {
        const cur = stateRef.current;
        const staff = (cur.firedStaff || []).find(s => s.id === staffId);
        const updatedFired = (cur.firedStaff || []).filter(s => s.id !== staffId);

        const newState = { ...cur, firedStaff: updatedFired };
        stateRef.current = newState;
        setState(newState);
        await DB.saveBankState(newState);
        addToast(`${staff?.name || '员工'} 已彻底删除`, 'success');
    };

    const handleHireStaff = async (newStaff: ShopStaff, cost: number) => {
        if (!(await consumeAP(cost))) return;

        const cur = stateRef.current;
        const randomX = 20 + Math.random() * 60;
        const staffWithPos = { ...newStaff, x: randomX, y: 50 };

        const updatedStaff = [...cur.shop.staff, staffWithPos];
        const newAppeal = calculateAppeal(updatedStaff.length, cur.shop.unlockedRecipes);

        const newState = {
            ...cur,
            shop: {
                ...cur.shop,
                staff: updatedStaff,
                appeal: newAppeal
            }
        };
        stateRef.current = newState;
        setState(newState);
        await DB.saveBankState(newState);
        addToast('新店员入职！', 'success');
    };

    // --- Guestbook Logic (Gossip & Drama) ---
    const handleRefreshGuestbook = async () => {
        const COST = 40;
        if (stateRef.current.shop.actionPoints < COST) {
            addToast(`AP 不足 (需 ${COST})。去省钱吧！`, 'error');
            return;
        }
        if (!apiConfig.apiKey) { addToast('需配置 API Key', 'error'); return; }

        setIsRefreshingGuestbook(true);
        try {
            const current = stateRef.current;
            // 1. Pick a random Char (Try to avoid last visitor if possible)
            const availableChars = characters.filter(c => c.id !== current.shop.activeVisitor?.charId);
            const pool = availableChars.length > 0 ? availableChars : characters;
            if (pool.length === 0) { addToast('没有可用角色', 'error'); return; }
            const randomChar = pool[Math.floor(Math.random() * pool.length)];

            // 2. Build Context
            await injectMemoryPalace(randomChar);
            const charContext = ContextBuilder.buildCoreContext(randomChar, userProfile, true);
            const recentMsgs = await DB.getMessagesByCharId(randomChar.id);
            const chatSnippet = recentMsgs.slice(-10).map(m => m.content.substring(0, 50)).join(' | ');

            const previousGuestbook = (current.shop.guestbook || []).slice(0, 10).map(g => `${g.authorName}: ${g.content}`).join('\n');

            // 3. Prompt
            const prompt = `${charContext}
### Scenario: Visiting User's Savings App Café Guestbook
${userProfile.name} has a savings/budgeting app (记账App). Inside the app there's a virtual café mini-game, similar to how Alipay has "蚂蚁庄园" or how friends visit each other's farms in QQ Farm.
You are visiting this virtual café as a friend/player.
Café Name: "${current.shop.shopName}".
Recent Chat Context: ${chatSnippet}

### Task
Generate a guestbook page update.
1. **${randomChar.name}**: Write a guestbook message. React to the cafe or start drama. (Use your personality).
2. **NPCs**: Generate 3-4 other random messages from strangers or staff.
   - **Themes**: Gossip (e.g. staff fighting), Argument (e.g. arguing about food), Heartwarming story, or Continuing previous drama.
   - **Style**: Internet slang, funny, emotional, or chaotic ("乐子人").
   - **Continuity**: If previous guestbook entries show an argument, continue it!

Previous Guestbook:
${previousGuestbook}

### Output JSON Format
[
  { "authorName": "${randomChar.name}", "content": "...", "isChar": true },
  { "authorName": "AngryCustomer", "content": "...", "isChar": false },
  ...
]
`;

            const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
                body: JSON.stringify({ model: apiConfig.model, messages: [{ role: 'user', content: prompt }] })
            });

            if (response.ok) {
                const data = await safeResponseJson(response);
                let jsonStr = data.choices[0].message.content.replace(/```json/g, '').replace(/```/g, '').trim();
                const result = JSON.parse(jsonStr);

                const newEntries: BankGuestbookItem[] = result.map((item: any) => ({
                    id: `gb-${Date.now()}-${Math.random()}`,
                    authorName: item.authorName,
                    content: item.content,
                    isChar: item.isChar,
                    charId: item.isChar ? randomChar.id : undefined,
                    avatar: item.isChar ? randomChar.avatar : undefined,
                    timestamp: Date.now(),
                    systemMessageId: undefined,
                }));

                // Push system messages (🔔 format) for character entries
                for (const entry of newEntries) {
                    if (entry.isChar && entry.charId) {
                        try {
                            const msgId = await DB.saveMessage({
                                charId: entry.charId,
                                role: 'system',
                                type: 'text',
                                content: `[系统: ${entry.authorName} 拜访了${userProfile.name}的记账App咖啡馆，并表示："${entry.content}"]`,
                            });
                            entry.systemMessageId = msgId;
                        } catch (e) {
                            console.error('Failed to push visitor system message', e);
                        }
                    }
                }

                // Update State: 
                // 1. Add new entries to guestbook (prepend)
                // 2. Set Active Visitor to the Char who posted
                // Use separately managed dollhouseState for room lookup
                const unlockedRooms = (dollhouseState.rooms || []).filter(r => r.isUnlocked);
                const fallbackRoom = dollhouseState.rooms?.[0];
                const spawnRoom = unlockedRooms.length > 0
                    ? unlockedRooms[Math.floor(Math.random() * unlockedRooms.length)]
                    : fallbackRoom;
                const spawnX = 18 + Math.random() * 64;
                const spawnY = 64 + Math.random() * 24;

                await persistStateUpdate(prev => ({
                    ...prev,
                    shop: {
                        ...prev.shop,
                        actionPoints: Math.max(0, prev.shop.actionPoints - COST),
                        guestbook: [...newEntries, ...(prev.shop.guestbook || [])].slice(0, 50), // Keep last 50
                        activeVisitor: {
                            charId: randomChar.id,
                            message: newEntries.find(e => e.isChar)?.content || "来逛逛~",
                            timestamp: Date.now(),
                            roomId: spawnRoom?.id,
                            x: spawnX,
                            y: spawnY,
                        }
                    }
                }));
                addToast('留言板已刷新，新客人到了！', 'success');
            } else {
                throw new Error('API Error');
            }

        } catch (e: any) {
            console.error(e);
            addToast('刷新失败: ' + e.message, 'error');
        } finally {
            setIsRefreshingGuestbook(false);
        }
    };

    // --- Guestbook Deletion ---
    const handleDeleteGuestbookEntry = async (entryId: string) => {
        const entry = (state.shop.guestbook || []).find(g => g.id === entryId);
        if (!entry) return;

        // Delete linked system message from chat history
        if (entry.systemMessageId) {
            try {
                await DB.deleteMessage(entry.systemMessageId);
            } catch (e) {
                console.error('Failed to delete linked system message', e);
            }
        }

        await persistStateUpdate(prev => ({
            ...prev,
            shop: {
                ...prev.shop,
                guestbook: (prev.shop.guestbook || []).filter(g => g.id !== entryId),
            }
        }));
        addToast('留言已删除', 'success');
    };

    // --- Staff Editing & Movement ---

    const handleOpenStaffEdit = (staff: ShopStaff) => {
        setEditingStaff(staff);
        setShowStaffEdit(true);
    };

    const handleSaveStaff = async () => {
        if (!editingStaff) return;
        const cur = stateRef.current;
        const updatedStaffList = cur.shop.staff.map(s => s.id === editingStaff.id ? editingStaff : s);
        const newState = { ...cur, shop: { ...cur.shop, staff: updatedStaffList } };
        stateRef.current = newState;
        setState(newState);
        await DB.saveBankState(newState);
        setShowStaffEdit(false);
        setEditingStaff(null);
        addToast('员工信息已更新', 'success');
    };

    const handleStaffImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file && editingStaff) {
            try {
                const base64 = await processImage(file);
                setEditingStaff({ ...editingStaff, avatar: base64 });
            } catch (err: any) {
                addToast('图片上传失败', 'error');
            }
        }
    };

    const handleMoveStaff = async (x: number, y: number) => {
        const cur = stateRef.current;
        const manager = cur.shop.staff[0];
        if (!manager) return;

        const updatedManager = { ...manager, x, y };
        const updatedStaffList = [updatedManager, ...cur.shop.staff.slice(1)];

        const newState = { ...cur, shop: { ...cur.shop, staff: updatedStaffList } };
        stateRef.current = newState;
        setState(newState);
        await DB.saveBankState(newState);
    };

    const handleConfigUpdate = async (updates: Partial<typeof state.config>) => {
        const cur = stateRef.current;
        const normalizedUpdates = { ...updates };
        if (typeof normalizedUpdates.dailyBudget === 'number') {
            if (!Number.isFinite(normalizedUpdates.dailyBudget)) return;
            normalizedUpdates.dailyBudget = Math.max(0, Math.floor(normalizedUpdates.dailyBudget));
        }
        const newState = { ...cur, config: { ...cur.config, ...normalizedUpdates } };
        stateRef.current = newState;
        setState(newState);
        await DB.saveBankState(newState);
        addToast('设置已保存', 'success');
    };

    // --- Goals ---
    const handleAddGoal = async () => {
        if (!goalName || !goalTarget) return;
        const parsedTarget = parseFloat(goalTarget);
        if (!Number.isFinite(parsedTarget) || parsedTarget <= 0) {
            addToast('请输入有效目标金额', 'error');
            return;
        }
        const newGoal: SavingsGoal = {
            id: `goal-${Date.now()}`,
            name: goalName,
            targetAmount: parsedTarget,
            currentAmount: 0,
            icon: '🎁',
            isCompleted: false
        };
        const cur = stateRef.current;
        const newState = { ...cur, goals: [...cur.goals, newGoal] };
        stateRef.current = newState;
        setState(newState);
        await DB.saveBankState(newState);
        setShowGoalModal(false);
        setGoalName('');
        setGoalTarget('');
        addToast('心愿已添加', 'success');
    };

    // --- 营业：模拟一波顾客逐单消费，结算收入进钱包 + 产生评价（与记账无关） ---
    const handleOperate = async () => {
        const cur = stateRef.current;
        const last = cur.shop.lastBusinessAt || 0;
        const elapsed = Date.now() - last;
        if (elapsed < BUSINESS_COOLDOWN_MS) {
            const mins = Math.ceil((BUSINESS_COOLDOWN_MS - elapsed) / 60000);
            const txt = mins >= 60 ? `${Math.floor(mins / 60)} 小时 ${mins % 60} 分` : `${mins} 分钟`;
            addToast(`店员们还在歇着，${txt}后再开门吧`, 'info');
            return;
        }
        const staff = cur.shop.staff;
        if (staff.length === 0) {
            addToast('先去「经营」雇个店员，才能开门营业', 'info');
            return;
        }
        const products = SHOP_RECIPES.filter(r => cur.shop.unlockedRecipes.includes(r.id));
        if (products.length === 0) {
            addToast('菜单空空，先去「经营」解锁可卖的商品', 'info');
            return;
        }

        const appeal = cur.shop.appeal || calculateAppeal(staff.length, cur.shop.unlockedRecipes);
        const reviews = cur.shop.reviews || [];
        const avgRep = reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 4.2;
        const repBonusPct = Math.round((avgRep - 4) * 10); // 4★→0；5★→+10%；3★→-10%
        const energetic = staff.filter(s => s.fatigue < 90).length;
        const tiredFactor = energetic === 0 ? 0.5 : 1; // 全员疲惫，客流减半

        const customerCount = Math.max(2, Math.min(9, Math.round((appeal / 90) * (0.8 + Math.random() * 0.5) * tiredFactor) + 1));

        const itemMap = new Map<string, { name: string; icon: string; qty: number; subtotal: number }>();
        let base = 0, tips = 0;
        const newReviews: ShopReview[] = [];
        const usedNpc = new Set<string>();

        for (let i = 0; i < customerCount; i++) {
            const p = products[Math.floor(Math.random() * products.length)];
            const price = p.price ?? Math.max(10, Math.round(p.appeal * 0.8));
            base += price;
            if (Math.random() < 0.45) tips += Math.max(1, Math.round(price * (0.1 + Math.random() * 0.2)));
            const ex = itemMap.get(p.id);
            if (ex) { ex.qty++; ex.subtotal += price; } else itemMap.set(p.id, { name: p.name, icon: p.icon, qty: 1, subtotal: price });

            // 约 35% 顾客留评
            if (Math.random() < 0.35) {
                let authorName: string, avatar: string, isNpc: boolean;
                if (characters.length > 0 && Math.random() < 0.25) {
                    const c = characters[Math.floor(Math.random() * characters.length)];
                    authorName = c.name; avatar = c.avatar; isNpc = false;
                } else {
                    let npc = NPC_CUSTOMERS[0], tries = 0;
                    do { npc = NPC_CUSTOMERS[Math.floor(Math.random() * NPC_CUSTOMERS.length)]; tries++; } while (usedNpc.has(npc.name) && tries < 5);
                    usedNpc.add(npc.name); authorName = npc.name; avatar = npc.avatar; isNpc = true;
                }
                let rating = 4 + (Math.random() < 0.5 ? 1 : 0);
                if (energetic === 0) rating -= 2;
                else if (avgRep < 3.5 && Math.random() < 0.4) rating -= 1;
                if (Math.random() < 0.08) rating -= 2; // 偶发差评
                rating = Math.max(1, Math.min(5, rating));
                newReviews.push({
                    id: `rev-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 5)}`,
                    authorName, avatar, rating, text: buildReviewText(rating, p.name),
                    productName: p.name, ts: Date.now(), isNpc,
                });
            }
        }

        const total = Math.max(1, Math.round((base + tips) * (1 + repBonusPct / 100)));
        const updatedStaff = staff.map(s => ({ ...s, fatigue: Math.min(s.maxFatigue, s.fatigue + 18) }));
        const mergedReviews = [...newReviews, ...reviews].slice(0, 40);
        const newState: BankFullState = {
            ...cur,
            shop: {
                ...cur.shop,
                staff: updatedStaff,
                lastBusinessAt: Date.now(),
                totalRevenue: (cur.shop.totalRevenue || 0) + total,
                reviews: mergedReviews,
            },
        };
        stateRef.current = newState;
        setState(newState);
        await DB.saveBankState(newState);
        adjustUserBalance(total);

        setBusinessResult({
            total, base, tips, customerCount,
            items: Array.from(itemMap.values()).sort((a, b) => b.subtotal - a.subtotal),
            reviews: newReviews,
            repBonusPct,
        });
    };

    return (
        <div className="h-full w-full flex flex-col relative overflow-hidden" style={paperTexture('kraft')}>
            <div aria-hidden className="pointer-events-none absolute inset-0 z-0" style={{ boxShadow: 'inset 0 0 90px rgba(96,66,40,0.13)' }} />

            {/* 顶栏：手账封面条 */}
            <div className="relative shrink-0 z-[50] px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-3">
                <WashiTape className="top-0 left-12" color="rgba(231,196,120,0.7)" rotate={-10} width={78} height={18} />
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                        <button
                            onClick={closeApp}
                            className="px-3 py-1.5 text-[12px] font-bold active:scale-95 transition-transform"
                            style={{ background: '#fffdf7', boxShadow: '0 2px 6px rgba(96,66,40,0.18)', transform: 'rotate(-1.5deg)', color: '#7a5c44' }}
                        >
                            ← 合上
                        </button>
                        <div className="flex flex-col" style={{ fontFamily: HAND_FONT }}>
                            <span className="text-[10px] tracking-[0.22em]" style={{ color: '#a98e6f' }}>存钱罐 · 小本生意</span>
                            <div className="flex items-center gap-1.5 mt-0.5">
                                <span className="text-[19px] font-black leading-none" style={{ color: '#5b4636' }}>{state.shop.actionPoints}</span>
                                <span className="text-[10px]" style={{ color: '#a98e6f' }}>AP</span>
                                <span style={{ color: '#cbb89a' }}>·</span>
                                <span className="text-[19px] font-black leading-none" style={{ color: '#5a8a52' }}>¥{Math.round(userProfile.balance || 0)}</span>
                                <span className="text-[10px]" style={{ color: '#a98e6f' }}>钱包</span>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                        <button
                            onClick={() => setShowTutorial(true)}
                            className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-black active:scale-90 transition-transform"
                            style={{ background: '#fffdf7', boxShadow: '0 2px 6px rgba(96,66,40,0.18)', color: '#a98e6f' }}
                        >
                            ?
                        </button>
                        <button
                            onClick={handleOperate}
                            className="px-3 py-2 text-[12px] font-black active:scale-95 transition-transform inline-flex items-center gap-1"
                            style={{ background: '#dfeccd', color: '#4a6b3c', boxShadow: '0 2px 6px rgba(96,66,40,0.18)', transform: 'rotate(1deg)', fontFamily: HAND_FONT }}
                        >
                            💰 营业
                        </button>
                        <button
                            onClick={() => setShowAddTxModal(true)}
                            className="px-3 py-2 text-[12px] font-black active:scale-95 transition-transform inline-flex items-center gap-1"
                            style={{ background: '#f6ddc9', color: '#a85a3c', boxShadow: '0 2px 6px rgba(96,66,40,0.18)', transform: 'rotate(-1deg)', fontFamily: HAND_FONT }}
                        >
                            ✎ 记账
                        </button>
                    </div>
                </div>
                <div aria-hidden className="absolute left-0 right-0 bottom-0 h-[3px]" style={{ background: 'repeating-linear-gradient(90deg, #d8c7a8 0 6px, transparent 6px 12px)' }} />
            </div>

            {/* Main Content Area */}
            <div className="flex-1 overflow-hidden relative z-10 flex flex-col">
                
                {/* 1. Game View (Dollhouse) */}
                {activeTab === 'game' && (
                    <>
                    {isBankDataLoaded ? (
                    <BankDollhouse
                        shopState={state.shop}
                        dollhouseState={dollhouseState}
                        onDollhouseChange={async (updater) => { await persistDollhouseUpdate(updater); }}
                        characters={characters}
                        userProfile={userProfile}
                        apiConfig={apiConfig}
                        updateState={async (updater) => {
                            const nextState = { ...stateRef.current, shop: updater(stateRef.current.shop) };
                            stateRef.current = nextState;
                            setState(nextState);
                            await DB.saveBankState(nextState);
                        }}
                        onStaffClick={handleOpenStaffEdit}
                        onOpenGuestbook={() => setShowGuestbook(true)}
                    />
                    ) : (
                        <div className="flex-1 flex items-center justify-center text-sm text-[#8A5A3D]">加载咖啡店中...</div>
                    )}
                    {/* 口碑入口 */}
                    {(() => {
                        const rv = state.shop.reviews || [];
                        const avg = rv.length ? Math.round((rv.reduce((s, r) => s + r.rating, 0) / rv.length) * 10) / 10 : 0;
                        return (
                            <button onClick={() => setShowReviews(true)} className="absolute left-3 bottom-3 z-40 flex items-center gap-1.5 px-3 py-2 rounded-full active:scale-95 transition-all" style={{ background: 'rgba(255,253,247,0.95)', boxShadow: '0 4px 14px rgba(96,66,40,0.25)' }}>
                                <span className="text-sm">⭐</span>
                                <span className="text-[12px] font-black" style={{ color: '#8D6E63' }}>{avg || '口碑'}</span>
                                <span className="text-[10px]" style={{ color: '#A1887F' }}>{rv.length ? `${rv.length} 评价` : '看看'}</span>
                            </button>
                        );
                    })()}
                    </>
                )}

                {/* 2. Management Menu */}
                {activeTab === 'manage' && (
                    <div className="flex-1 overflow-y-auto no-scrollbar p-4">
                        {/* Budget Config at Top */}
                        <div className="relative p-4 mb-4 flex justify-between items-center" style={{ background: '#fffdf7', borderRadius: 14, boxShadow: '0 4px 12px rgba(96,66,40,0.14)', transform: 'rotate(-0.6deg)' }}>
                            <WashiTape className="-top-2 left-8" color="rgba(231,196,120,0.7)" rotate={-10} width={64} />
                            <div>
                                <h3 className="text-[15px] font-black" style={{ fontFamily: HAND_FONT, color: '#5b4636' }}>每日预算线</h3>
                                <p className="text-[10px]" style={{ color: '#a98e6f' }}>记账支出超过它，会轻轻提醒你一下</p>
                            </div>
                            <div className="flex items-center gap-1 px-2.5 py-1.5" style={{ background: '#fff', borderRadius: 10, boxShadow: 'inset 0 0 0 1px rgba(150,110,70,0.2)' }}>
                                <span className="text-xs" style={{ color: '#a98e6f' }}>{state.config.currencySymbol}</span>
                                <input
                                    type="number"
                                    value={state.config.dailyBudget}
                                    onChange={(e) => {
                                        const value = e.target.value;
                                        if (value === '') return;
                                        handleConfigUpdate({ dailyBudget: Number(value) });
                                    }}
                                    className="w-16 text-right bg-transparent border-none text-lg font-black outline-none p-0"
                                    style={{ color: '#b1543f', fontFamily: HAND_FONT }}
                                />
                            </div>
                        </div>

                        <BankGameMenu
                            state={state}
                            characters={characters}
                            onUnlockRecipe={handleUnlockRecipe}
                            onHireStaff={handleHireStaff}
                            onStaffRest={handleStaffRest}
                            onFireStaff={handleFireStaff}
                            onRehireStaff={handleRehireStaff}
                            onDeleteFiredStaff={handleDeleteFiredStaff}
                            onUpdateConfig={handleConfigUpdate}
                            onAddGoal={() => setShowGoalModal(true)}
                            onDeleteGoal={async (id) => {
                                await persistStateUpdate(prev => ({
                                    ...prev,
                                    goals: prev.goals.filter(g => g.id !== id)
                                }));
                            }}
                            onEditStaff={handleOpenStaffEdit}
                        />
                    </div>
                )}

                {/* 3. Analytics Report */}
                {activeTab === 'report' && (
                    <div className="flex-1 overflow-y-auto no-scrollbar flex flex-col">
                        {/* 子视图切换：分析 / 互评账本 —— 两枚纸签 */}
                        <div className="flex gap-2.5 px-4 pt-3 shrink-0">
                            {([['analytics', '📊 账目分析'], ['ledger', '💬 互评账本']] as const).map(([k, label], i) => (
                                <button key={k} onClick={() => setReportView(k)} className="flex-1 py-2 text-[13px] font-black active:scale-95 transition-transform"
                                    style={{ fontFamily: HAND_FONT, borderRadius: '8px 11px 7px 10px', transform: `rotate(${i === 0 ? -1 : 1}deg)`,
                                        ...(reportView === k
                                            ? { background: '#fffdf7', color: '#5b4636', boxShadow: '0 4px 12px rgba(96,66,40,0.18)' }
                                            : { background: '#efe2cd', color: '#a98e6f' }) }}>
                                    {label}
                                </button>
                            ))}
                        </div>
                        {reportView === 'analytics' ? (
                            <BankAnalytics
                                transactions={transactions}
                                goals={state.goals}
                                currency={state.config.currencySymbol}
                                onDeleteTx={handleDeleteTransaction}
                                apiConfig={apiConfig}
                                dailyBudget={state.config.dailyBudget}
                            />
                        ) : (
                            <BankLedger
                                transactions={transactions}
                                onTxUpdated={handleTxUpdated}
                                characters={characters}
                                apiConfig={apiConfig}
                                userProfile={userProfile}
                                addToast={addToast}
                                currency={state.config.currencySymbol}
                            />
                        )}
                    </div>
                )}
            </div>

            {/* Premium Guestbook Overlay */}
            {showGuestbook && (
                <div className="absolute inset-0 z-[100] flex flex-col animate-slide-up" style={{ background: 'linear-gradient(180deg, #FDF6E3 0%, #FFF8E1 100%)' }}>
                    {/* Header */}
                    <div className="pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-3 px-4 shrink-0"
                         style={{ background: 'linear-gradient(180deg, rgba(141, 110, 99, 0.95) 0%, rgba(109, 76, 65, 0.95) 100%)', backdropFilter: 'blur(10px)' }}>
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-white/15 rounded-xl flex items-center justify-center">
                                    <span className="text-xl">📜</span>
                                </div>
                                <div>
                                    <h2 className="text-base font-bold text-white tracking-wide">店铺情报志</h2>
                                    <p className="text-[10px] text-white/60 uppercase tracking-wider">Gossip & Rumors</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setShowGuestbook(false)}
                                className="w-9 h-9 rounded-xl bg-white/15 text-white/90 flex items-center justify-center hover:bg-white/25 active:scale-95 transition-all text-lg font-bold"
                            >
                                ×
                            </button>
                        </div>
                    </div>

                    {/* Content */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-5">

                        {/* Refresh Action Card */}
                        <div className="bg-white p-5 rounded-2xl shadow-md border border-[#E8DCC8] flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-12 h-12 bg-gradient-to-br from-[#FFE0B2] to-[#FFCC80] rounded-xl flex items-center justify-center text-2xl shadow-inner">
                                    👂
                                </div>
                                <div>
                                    <h3 className="font-bold text-[#5D4037] text-sm">打听消息</h3>
                                    <p className="text-[10px] text-[#A1887F] mt-0.5">消耗 AP 让大家聊聊八卦</p>
                                </div>
                            </div>
                            <button
                                onClick={handleRefreshGuestbook}
                                disabled={isRefreshingGuestbook}
                                className={`px-5 py-3 rounded-xl font-bold text-xs shadow-lg transition-all ${
                                    isRefreshingGuestbook
                                        ? 'bg-[#EFEBE9] text-[#BCAAA4]'
                                        : 'bg-gradient-to-r from-[#42A5F5] to-[#1E88E5] text-white hover:shadow-xl active:scale-95'
                                }`}
                            >
                                {isRefreshingGuestbook ? (
                                    <span className="flex items-center gap-2">
                                        <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                                        偷听中...
                                    </span>
                                ) : '刷新情报 · 40 AP'}
                            </button>
                        </div>

                        {(!state.shop.guestbook || state.shop.guestbook.length === 0) ? (
                            <div className="text-center py-20">
                                <div className="text-7xl mb-4 opacity-40">🍃</div>
                                <p className="text-sm font-bold text-[#BCAAA4]">风中什么声音都没有...</p>
                                <p className="text-xs text-[#D7CCC8] mt-1">点击上方按钮开始打听</p>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {state.shop.guestbook.map((msg, idx) => (
                                    <div
                                        key={msg.id}
                                        className={`relative p-4 rounded-2xl group animate-fade-in transition-all hover:shadow-md ${
                                            msg.isChar
                                                ? 'bg-white border-l-4 border-l-[#FF7043] shadow-md'
                                                : 'bg-[#FDF6E3] border border-[#E8DCC8]'
                                        }`}
                                    >
                                        <div className="flex justify-between items-start mb-2">
                                            <div className="flex items-center gap-2">
                                                {msg.isChar && (
                                                    <span className="w-5 h-5 bg-gradient-to-br from-[#FF8A65] to-[#FF7043] rounded-full flex items-center justify-center text-[10px] text-white">⭐</span>
                                                )}
                                                <span className={`font-bold text-sm ${msg.isChar ? 'text-[#E64A19]' : 'text-[#8D6E63]'}`}>
                                                    {msg.authorName}
                                                </span>
                                                <span className="text-[9px] text-[#BCAAA4] bg-[#EFEBE9] px-2 py-0.5 rounded-full">
                                                    {new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-1.5">
                                                <button
                                                    onClick={() => handleDeleteGuestbookEntry(msg.id)}
                                                    className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity text-[#E53935] text-xs font-bold px-1.5 py-0.5 rounded-lg hover:bg-[#FFEBEE]"
                                                    title="删除留言"
                                                >
                                                    ×
                                                </button>
                                                <div className="text-lg opacity-30 group-hover:opacity-60 transition-opacity select-none">
                                                    {idx % 2 === 0 ? '●' : '○'}
                                                </div>
                                            </div>
                                        </div>
                                        <p className="text-sm text-[#5D4037] leading-relaxed whitespace-pre-wrap">
                                            {msg.content}
                                        </p>
                                        {msg.isChar && (
                                            <div className="mt-3">
                                                <span className="text-[9px] text-white bg-gradient-to-r from-[#FF8A65] to-[#FF7043] px-3 py-1 rounded-full font-bold shadow-sm">
                                                    ⭐ 重要人物
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                ))}
                                <div className="text-center py-6 text-[10px] text-[#BCAAA4]">
                                    ——— 已经到底了 ———
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* 底部书签栏：三枚纸签 */}
            <div className="shrink-0 z-30 pb-safe px-4 pt-1.5 pb-2 relative">
                <div aria-hidden className="absolute left-0 right-0 top-0 h-[3px]" style={{ background: 'repeating-linear-gradient(90deg, #d8c7a8 0 6px, transparent 6px 12px)' }} />
                <div className="flex items-end justify-around gap-2 pt-1.5">
                    {[
                        { key: 'game', label: '店铺', emoji: '🏠', tip: '看店' },
                        { key: 'manage', label: '经营', emoji: '📋', tip: '打理' },
                        { key: 'report', label: '账本', emoji: '📖', tip: '记账' }
                    ].map((tab, i) => {
                        const on = activeTab === tab.key;
                        return (
                            <button
                                key={tab.key}
                                onClick={() => setActiveTab(tab.key as any)}
                                className="flex-1 flex flex-col items-center justify-center py-2 active:scale-95 transition-transform"
                                style={{
                                    background: on ? '#fffdf7' : 'transparent',
                                    boxShadow: on ? '0 4px 12px rgba(96,66,40,0.2)' : 'none',
                                    transform: `rotate(${[-1.5, 0.8, -0.6][i]}deg) translateY(${on ? -3 : 0}px)`,
                                    borderRadius: '8px 10px 7px 11px',
                                }}
                            >
                                <span className="text-[19px] leading-none mb-0.5" style={{ filter: on ? 'none' : 'grayscale(0.4) opacity(0.7)' }}>{tab.emoji}</span>
                                <span className="text-[13px] font-black leading-none" style={{ fontFamily: HAND_FONT, color: on ? '#5b4636' : '#a98e6f' }}>{tab.label}</span>
                                {on && <span className="text-[8px] mt-0.5" style={{ color: '#b1543f' }}>· {tab.tip} ·</span>}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* 记账弹窗 */}
            <HbModal open={showAddTxModal} onClose={() => setShowAddTxModal(false)} title="记一笔现实账" sub="进账还是支出，写下来，角色会看见" tapeColor="rgba(231,196,120,0.72)"
                footer={
                    <button onClick={handleAddTransaction} className="w-full py-3.5 text-[16px] font-black active:scale-[0.98] transition-transform" style={{ background: '#b1543f', color: '#fff7ef', borderRadius: 14, fontFamily: HAND_FONT, letterSpacing: 1 }}>
                        记下这笔
                    </button>
                }>
                <div className="space-y-4">
                    <div>
                        <TapeLabel color="#e8c8a0" className="mb-2">是进是出</TapeLabel>
                        <div className="flex gap-2 mt-2">
                            {([['expense', '📤 花出去'], ['income', '📥 进账来']] as const).map(([k, label]) => (
                                <button key={k} onClick={() => setTxType(k)} className="flex-1 py-2.5 text-[14px] font-black active:scale-95 transition-transform" style={{ borderRadius: 12, fontFamily: HAND_FONT,
                                    ...(txType === k
                                        ? (k === 'income' ? { background: '#dfeccd', color: '#3f7a38', boxShadow: '0 2px 6px rgba(96,66,40,0.18)' } : { background: '#f6ddc9', color: '#b1543f', boxShadow: '0 2px 6px rgba(96,66,40,0.18)' })
                                        : { background: '#f3ead7', color: '#a98e6f' }) }}>
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div>
                        <TapeLabel color="#cfe3c6" textColor="#4a6b3c" className="mb-2">多少钱</TapeLabel>
                        <div className="relative mt-2">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[18px] font-black" style={{ color: '#a98e6f' }}>{state.config.currencySymbol}</span>
                            <input type="number" value={txAmount} onChange={e => setTxAmount(e.target.value)} placeholder="0.00" className="w-full pl-10 pr-4 py-3.5 text-[24px] font-black focus:outline-none" style={{ ...hbInputStyle, fontFamily: HAND_FONT }} />
                        </div>
                    </div>
                    <div>
                        <TapeLabel color="#eec7cb" textColor="#8a3b4c" className="mb-2">记点什么</TapeLabel>
                        <input value={txNote} onChange={e => setTxNote(e.target.value)} placeholder={txType === 'income' ? '这笔钱哪来的？' : '钱花哪了？'} className="w-full px-4 py-3 text-[15px] focus:outline-none mt-2" style={{ ...hbInputStyle, fontFamily: HAND_FONT }} />
                    </div>
                </div>
            </HbModal>

            {/* 攒钱心愿弹窗 */}
            <HbModal open={showGoalModal} onClose={() => setShowGoalModal(false)} title="立一个攒钱心愿" sub="想买什么、要攒多少，贴上来" tapeColor="rgba(158,201,163,0.7)" rotate={0.6}
                footer={
                    <button onClick={handleAddGoal} className="w-full py-3.5 text-[16px] font-black active:scale-[0.98] transition-transform" style={{ background: '#3f8a6b', color: '#fff7ef', borderRadius: 14, fontFamily: HAND_FONT, letterSpacing: 1 }}>
                        贴上心愿
                    </button>
                }>
                <div className="space-y-4">
                    <div>
                        <TapeLabel color="#cfe3c6" textColor="#4a6b3c" className="mb-2">想要什么</TapeLabel>
                        <input value={goalName} onChange={e => setGoalName(e.target.value)} placeholder="比如：一台 Switch" className="w-full px-4 py-3 text-[15px] focus:outline-none mt-2" style={{ ...hbInputStyle, fontFamily: HAND_FONT }} />
                    </div>
                    <div>
                        <TapeLabel color="#e8c8a0" className="mb-2">要攒多少</TapeLabel>
                        <div className="relative mt-2">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[18px] font-black" style={{ color: '#a98e6f' }}>{state.config.currencySymbol}</span>
                            <input type="number" value={goalTarget} onChange={e => setGoalTarget(e.target.value)} placeholder="2000" className="w-full pl-10 pr-4 py-3.5 text-[24px] font-black focus:outline-none" style={{ ...hbInputStyle, fontFamily: HAND_FONT }} />
                        </div>
                    </div>
                </div>
            </HbModal>

            {/* 店员档案弹窗 */}
            <HbModal open={showStaffEdit} onClose={() => { setShowStaffEdit(false); setEditingStaff(null); }} title="店员小档案" sub="改个名字、写句性格备注" tapeColor="rgba(155,191,224,0.7)"
                footer={
                    <button onClick={handleSaveStaff} className="w-full py-3.5 text-[16px] font-black active:scale-[0.98] transition-transform" style={{ background: '#3f6b8a', color: '#fff7ef', borderRadius: 14, fontFamily: HAND_FONT, letterSpacing: 1 }}>
                        存好档案
                    </button>
                }>
                {editingStaff && (
                    <div className="space-y-4">
                        <div className="flex items-center gap-4">
                            <div className="w-24 h-24 flex items-center justify-center text-5xl relative overflow-hidden group cursor-pointer" style={{ background: '#fff', borderRadius: 14, boxShadow: '0 4px 12px rgba(96,66,40,0.18)', transform: 'rotate(-2deg)' }} onClick={() => staffImageInputRef.current?.click()}>
                                {editingStaff.avatar.startsWith('http') || editingStaff.avatar.startsWith('data')
                                    ? <img src={editingStaff.avatar} className="w-full h-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                                    : editingStaff.avatar}
                                <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                    <span className="text-white text-[11px] font-bold bg-black/40 px-2 py-1 rounded-lg">换张</span>
                                </div>
                                <input type="file" ref={staffImageInputRef} className="hidden" accept="image/*" onChange={handleStaffImageUpload} />
                            </div>
                            <div className="flex-1 space-y-2.5">
                                <input value={editingStaff.name} onChange={e => setEditingStaff({ ...editingStaff, name: e.target.value })} placeholder="名字" className="w-full font-black text-[20px] bg-transparent outline-none pb-1" style={{ fontFamily: HAND_FONT, color: '#5b4636', borderBottom: '2px dashed #d8c7a8' }} />
                                <TapeLabel color="#e8c8a0">{editingStaff.role === 'manager' ? '经理' : editingStaff.role === 'chef' ? '主厨' : '服务员'}</TapeLabel>
                            </div>
                        </div>
                        <div>
                            <TapeLabel color="#eec7cb" textColor="#8a3b4c" className="mb-2">性格 / 备注</TapeLabel>
                            <input value={editingStaff.personality || ''} onChange={e => setEditingStaff({ ...editingStaff, personality: e.target.value })} placeholder="懒洋洋的，爱晒太阳" className="w-full px-4 py-3 text-[14px] focus:outline-none mt-2" style={{ ...hbInputStyle, fontFamily: HAND_FONT }} />
                        </div>
                    </div>
                )}
            </HbModal>

            {/* 玩法说明弹窗（已按新玩法重写） */}
            <HbModal open={showTutorial} onClose={() => setShowTutorial(false)} title="这间小店怎么玩" sub="一页纸看懂" tapeColor="rgba(231,163,156,0.7)">
                <div className="space-y-3" style={{ color: '#5b4636' }}>
                    {[
                        { emoji: '💰', t: '开门营业赚钱', d: '点顶栏「营业」让店员接客，按人气来客、卖出商品收钱——赚的钱进「钱包」，能在聊天里给角色转账、发红包。', bg: '#dfeccd' },
                        { emoji: '🧾', t: '商品与口碑', d: '去「经营」花 AP 解锁更多商品；客人会点单、留下 1~5 星评价，口碑越好营业收入越高，点店铺里「⭐口碑」可翻看。', bg: '#f6ddc9' },
                        { emoji: '📖', t: '记账是另一本账', d: '「账本」记的是你现实的钱（进账/支出），和店铺的钱各算各的；记完角色会点评，角色也会记自己的账等你回应。', bg: '#cfe3e0' },
                        { emoji: '⚡', t: '行动点 AP', d: '每天登录领 AP，用来解锁商品、雇店员、装修房间。店员忙累了要歇会儿才能再营业。', bg: '#e7dcc4' },
                    ].map((c, i) => (
                        <div key={i} className="flex gap-3 p-3.5" style={{ background: c.bg, borderRadius: 14, transform: `rotate(${tinyRotate('tut' + i)}deg)`, boxShadow: '0 2px 8px rgba(96,66,40,0.12)' }}>
                            <span className="text-2xl shrink-0">{c.emoji}</span>
                            <div>
                                <div className="text-[15px] font-black mb-0.5" style={{ fontFamily: HAND_FONT }}>{c.t}</div>
                                <p className="text-[12px] leading-relaxed" style={{ color: '#6d5142' }}>{c.d}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </HbModal>

            {/* 营业结算 */}
            {businessResult && (
                <BusinessResultModal
                    result={businessResult}
                    currency={state.config.currencySymbol}
                    onClose={() => setBusinessResult(null)}
                    onViewReviews={() => { setBusinessResult(null); setShowReviews(true); }}
                />
            )}

            {/* 口碑墙 */}
            {showReviews && (
                <ReviewsOverlay reviews={state.shop.reviews || []} onClose={() => setShowReviews(false)} />
            )}

        </div>
    );
};

export default BankApp;
