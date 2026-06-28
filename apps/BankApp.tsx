
import React, { useState, useEffect, useRef } from 'react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { BankFullState, BankTransaction, SavingsGoal, ShopStaff, BankGuestbookItem, DollhouseState, ShopReview, ShopRegular, BankJobPosting, BankLoanChannel, BankStockQuote } from '../types';
import { safeResponseJson } from '../utils/safeApi';
import { resolveAuxApi } from '../utils/auxApi';
import { injectMemoryPalace } from '../utils/memoryPalace/pipeline';
import BankShopScene from '../components/bank/BankShopScene';
import BankDollhouse from '../components/bank/BankDollhouse';
import BankGameMenu from '../components/bank/BankGameMenu';
import BankAnalytics from '../components/bank/BankAnalytics';
import BankLedger from '../components/bank/BankLedger';
import { BusinessResultModal, ReviewsOverlay, RegularsOverlay, BusinessResult } from '../components/bank/BankBusiness';
import { SHOP_RECIPES, INITIAL_DOLLHOUSE, NPC_CUSTOMERS, buildReviewText, buildMishapText, recipePrice, restockBatchCost, STARTING_STOCK, RESTOCK_BATCH, STOCK_CAP, DAILY_STOCK_FLOOR, MAX_SHOP_LEVEL, shopUpgradeCost, shopLevelBonusPct, shopLevelExtraCustomers, shopLevelPassiveMult, REGULAR_VISITS, VIP_VISITS, MAX_REGULARS, idleRatePerHour, IDLE_CAP_HOURS, getWeatherDef, rollWeatherId, WEATHER_DURATION_MS } from '../components/bank/BankGameConstants';
import { processImage } from '../utils/file';
import { ContextBuilder } from '../utils/context';
import { HAND_FONT } from './almanac/handbookKit';
import {
    PAGE_BG,
    PaperCard,
    SectionTag,
    ScrapButton,
    INK,
    INK_SOFT,
} from './ui/insScrapKit';
import {
    BANK_LIFE_VERSION,
    BUSINESS_TEMPLATES,
    COMPANY_DIRECTIONS,
    COMPANY_FOUND_COST,
    JOB_CATEGORIES,
    JOB_POSTINGS,
    LOAN_PRODUCTS,
    SHOP_UNLOCK_COST,
    advanceJobApplicationStage,
    advanceBankLifeDay,
    applyCompanyIssue,
    applyForJob,
    borrowLoan,
    buyStock,
    channelLabel,
    foundCompany,
    getJobsByCategory,
    leaveJob,
    loanTotal,
    migrateBankLifeState,
    movingAverage,
    openLifeShop,
    repayLoan,
    sellStock,
    startJobApplication,
    stockMarketValue,
} from '../utils/bankLife';

const INITIAL_STATE: BankFullState = {
    config: {
        dailyBudget: 100,
        currencySymbol: '¥', 
    },
    shop: {
        actionPoints: 100,
        shopName: '我的小店',
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
        stock: { 'recipe-coffee-001': STARTING_STOCK },
        activeVisitor: undefined,
        guestbook: [] // New
    },
    life: {
        version: BANK_LIFE_VERSION,
        dateStr: new Date().toISOString().split('T')[0],
        shopUnlocked: false,
        jobHistory: [],
        pendingWages: [],
        fatigue: 0,
        reputation: 50,
        experience: {},
        stockMarket: [],
        holdings: {},
        watchlist: [],
        loans: [],
        events: [],
    },
    goals: [],
    todaySpent: 0,
    lastLoginDate: new Date().toISOString().split('T')[0],
};

// 失效图床：sharkpan.xyz 已无法访问，历史默认资源（店铺背景 / 系统店员头像 / 房间贴图）
// 都指向它，会渲染成裂图。加载时统一清洗成可用的兜底（emoji / 留空走渐变），并配合 <img onError>。
const DEAD_IMG_HOSTS = ['sharkpan.xyz'];
const isDeadImg = (u?: string | null): boolean =>
    typeof u === 'string' && DEAD_IMG_HOSTS.some(h => u.includes(h));

// 营业冷却：每 3 小时可「营业」一轮赚一笔进钱包
const BUSINESS_COOLDOWN_MS = 3 * 60 * 60 * 1000;

// 当前每小时挂机产出：基础(人气×等级) × 天气倍率 × 雇员/精力加成（有店员才产出）。
type IdleShopShape = { staff: { id: string; fatigue?: number }[]; appeal?: number; shopLevel?: number; pendingRevenue?: number; lastAccrualAt?: number; weather?: { id: string; until: number } };
const computeIdleRatePerHour = (shop: IdleShopShape): number => {
    const n = shop.staff?.length || 0;
    if (n === 0) return 0;
    const level = shop.shopLevel || 1;
    const appeal = shop.appeal || 100;
    const weatherMult = getWeatherDef(shop.weather?.id).idleMult;
    // 雇员加速挂机：人越多产出越高，且全员越精神(疲劳越低)越高效
    const avgEnergy = shop.staff.reduce((s, x) => s + (100 - (x.fatigue || 0)), 0) / n / 100;
    const staffMult = (1 + 0.1 * (n - 1)) * (0.6 + 0.4 * Math.max(0, Math.min(1, avgEnergy)));
    return Math.max(1, Math.floor(idleRatePerHour(appeal, level) * weatherMult * staffMult));
};
/** 当前挂机上限（攒满约 IDLE_CAP_HOURS 小时） */
const idleCapNow = (shop: IdleShopShape): number => computeIdleRatePerHour(shop) * IDLE_CAP_HOURS;

// 挂机营业额结算（纯函数）：把「锚点→现在」流逝的时间折算成待收营业额（封顶）。
// 锚点 lastAccrualAt 只在真正入账时前移，所以不足 1 元的零头会保留到下次，不丢。
const accrueShopIdle = (shop: IdleShopShape, now: number): { pendingRevenue: number; lastAccrualAt: number } => {
    const rate = computeIdleRatePerHour(shop);
    const cap = rate * IDLE_CAP_HOURS;
    const last = shop.lastAccrualAt || now;
    const gained = Math.max(0, Math.floor(rate * ((now - last) / 3600000)));
    const pending = Math.min(cap, Math.max(0, shop.pendingRevenue || 0) + gained);
    const advanced = pending > Math.max(0, shop.pendingRevenue || 0) ? now : last;
    return { pendingRevenue: pending, lastAccrualAt: advanced };
};

// 天气：到期或缺失就随机切一种（约 4 小时一段）
const ensureWeather = (shop: { weather?: { id: string; until: number } }, now: number): { id: string; until: number } => {
    const w = shop.weather;
    if (w && w.until > now) return w;
    return { id: rollWeatherId(), until: now + WEATHER_DURATION_MS };
};

// 弹窗壳 + 输入样式
const hbInputStyle: React.CSSProperties = {
    background: '#fff',
    borderRadius: 16,
    color: INK,
    border: '1px solid rgba(43,41,51,0.07)',
    boxShadow: 'inset 0 1px 2px rgba(43,41,51,0.04)',
};
const CleanBadge: React.FC<{ children: React.ReactNode; tone?: 'default' | 'green' | 'red' | 'blue' | 'amber'; className?: string }> = ({ children, tone = 'default', className = '' }) => {
    const styles: Record<string, React.CSSProperties> = {
        default: { background: '#f5f3ef', color: INK_SOFT },
        green: { background: '#dcfce7', color: '#15803d' },
        red: { background: '#ffe4e6', color: '#be123c' },
        blue: { background: '#e0f2fe', color: '#0369a1' },
        amber: { background: '#fef3c7', color: '#92400e' },
    };
    return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${className}`} style={styles[tone]}>{children}</span>;
};

const FieldLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="text-[11px] font-extrabold mb-1.5" style={{ color: INK_SOFT }}>{children}</div>
);

const cleanCardStyle: React.CSSProperties = {
    background: '#fff',
    border: '1px solid rgba(43,41,51,0.06)',
    borderRadius: 20,
    boxShadow: '0 1px 2px rgba(38,38,38,0.04), 0 16px 34px -26px rgba(38,38,38,0.28)',
};

const HbModal: React.FC<{
    open: boolean; onClose: () => void; title: string; sub?: string;
    footer?: React.ReactNode; children: React.ReactNode;
}> = ({ open, onClose, title, sub, footer, children }) => {
    if (!open) return null;
    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-6" onClick={onClose}>
            <div className="absolute inset-0 bg-black/40 animate-fade-in" style={{ backdropFilter: 'blur(6px)' }} />
            <div className="relative w-full max-w-sm animate-slide-up flex flex-col" style={{ background: '#fff', borderRadius: 28, boxShadow: '0 34px 80px -32px rgba(20,18,16,0.58)', maxHeight: '86vh' }} onClick={e => e.stopPropagation()}>
                <div className="p-6 overflow-y-auto no-scrollbar">
                    <div className="text-[22px] font-black" style={{ fontFamily: HAND_FONT, color: INK }}>{title}</div>
                    {sub && <div className="text-[11px] mt-0.5 mb-4" style={{ color: INK_SOFT }}>{sub}</div>}
                    {!sub && <div className="mb-4" />}
                    {children}
                </div>
                {footer && <div className="px-6 pb-6">{footer}</div>}
            </div>
        </div>
    );
};

const BankApp: React.FC = () => {
    const { closeApp, characters, addToast, apiConfig, auxApiConfig, userProfile, adjustUserBalance } = useOS();
    // 回形针·银行属「聊天以外」的功能：走副 API（未配置副 API 时回退主 API）
    const auxApi = { ...apiConfig, ...resolveAuxApi(auxApiConfig, apiConfig) };
    const [state, setState] = useState<BankFullState>(INITIAL_STATE);
    const [transactions, setTransactions] = useState<BankTransaction[]>([]);
    const [dollhouseState, setDollhouseState] = useState<DollhouseState>(INITIAL_DOLLHOUSE);
    const [isBankDataLoaded, setIsBankDataLoaded] = useState(false);

    // Refs to track latest state synchronously (React 18 batches setState,
    // so we can't rely on setState's updater callback running before DB.save)
    const stateRef = useRef<BankFullState>(INITIAL_STATE);
    const dollhouseRef = useRef<DollhouseState>(INITIAL_DOLLHOUSE);
    
    const [activeTab, setActiveTab] = useState<'life' | 'jobs' | 'shop' | 'invest' | 'company' | 'loans' | 'report'>('life');
    const [shopView, setShopView] = useState<'game' | 'manage'>('game');
    
    // UI Modals
    const [showAddTxModal, setShowAddTxModal] = useState(false);
    const [showGoalModal, setShowGoalModal] = useState(false);
    const [showStaffEdit, setShowStaffEdit] = useState(false);
    
    // Guestbook Fullscreen State (Changed from Modal)
    const [showGuestbook, setShowGuestbook] = useState(false);
    // 营业结算 & 口碑评价
    const [businessResult, setBusinessResult] = useState<BusinessResult | null>(null);
    const [showReviews, setShowReviews] = useState(false);
    const [showRegulars, setShowRegulars] = useState(false);
    
    // Forms
    const [txAmount, setTxAmount] = useState('');
    const [txNote, setTxNote] = useState('');
    const [txType, setTxType] = useState<'income' | 'expense'>('expense');
    // 账本子视图：分析 / 互评账本
    const [reportView, setReportView] = useState<'analytics' | 'ledger'>('analytics');
    const [goalName, setGoalName] = useState('');
    const [goalTarget, setGoalTarget] = useState('');
    const [jobCategory, setJobCategory] = useState('全部');
    const [stockBudget, setStockBudget] = useState<Record<string, string>>({});
    const [stockSellShares, setStockSellShares] = useState<Record<string, string>>({});
    const [companyName, setCompanyName] = useState('');
    const [companyDirection, setCompanyDirection] = useState(COMPANY_DIRECTIONS[0]);
    const [loanAmount, setLoanAmount] = useState('5000');
    const [loanChannel, setLoanChannel] = useState<BankLoanChannel>('bank');
    const [loanRepayAmount, setLoanRepayAmount] = useState<Record<string, string>>({});
    const [selectedBusinessType, setSelectedBusinessType] = useState(BUSINESS_TEMPLATES[0]?.id || 'drinks');
    const [newShopName, setNewShopName] = useState('');
    const [selectedJobId, setSelectedJobId] = useState<string>(JOB_POSTINGS[0]?.id || '');
    const [selectedApplicationId, setSelectedApplicationId] = useState<string>('');
    const [interviewAnswer, setInterviewAnswer] = useState('');
    const [selectedStockSymbol, setSelectedStockSymbol] = useState('MORO');
    const [marketView, setMarketView] = useState<'all' | 'watch' | 'gainers' | 'losers'>('all');
    const [selectedLoanId, setSelectedLoanId] = useState('');

    // Staff Edit Form
    const [editingStaff, setEditingStaff] = useState<ShopStaff | null>(null);
    const staffImageInputRef = useRef<HTMLInputElement>(null);

    // Guestbook Processing
    const [isRefreshingGuestbook, setIsRefreshingGuestbook] = useState(false);

    // Load Data
    useEffect(() => {
        loadData();
    }, []);

    useEffect(() => {
        const onAutoTx = (e: Event) => {
            const tx = (e as CustomEvent<BankTransaction>).detail;
            if (!tx?.id) return;
            setTransactions(prev => prev.some(x => x.id === tx.id) ? prev : [tx, ...prev].sort((a, b) => b.timestamp - a.timestamp));
            if (tx.dateStr === new Date().toISOString().split('T')[0] && tx.type === 'expense') {
                setState(prev => {
                    const next = { ...prev, todaySpent: (prev.todaySpent || 0) + tx.amount };
                    stateRef.current = next;
                    void DB.saveBankState(next);
                    return next;
                });
            }
        };
        window.addEventListener('moro-bank-transaction-added', onAutoTx as EventListener);
        return () => window.removeEventListener('moro-bank-transaction-added', onAutoTx as EventListener);
    }, []);

    // 挂机营业额累计 + 天气轮换：每 30s 折算待收金币、到点换天气（仅在有变化时落库）
    useEffect(() => {
        const t = window.setInterval(() => {
            const cur = stateRef.current;
            if (!cur?.shop) return;
            const now = Date.now();
            const weather = ensureWeather(cur.shop, now);
            const weatherChanged = weather.id !== cur.shop.weather?.id || weather.until !== cur.shop.weather?.until;
            const baseShop = weatherChanged ? { ...cur.shop, weather } : cur.shop;
            const idle = (baseShop.staff?.length || 0) > 0
                ? accrueShopIdle(baseShop, now)
                : { pendingRevenue: baseShop.pendingRevenue || 0, lastAccrualAt: baseShop.lastAccrualAt || now };
            const pendingChanged = idle.pendingRevenue !== Math.max(0, cur.shop.pendingRevenue || 0);
            if (weatherChanged || pendingChanged) {
                const ns = { ...cur, shop: { ...baseShop, pendingRevenue: idle.pendingRevenue, lastAccrualAt: idle.lastAccrualAt } };
                stateRef.current = ns;
                setState(ns);
                void DB.saveBankState(ns);
                if (weatherChanged && cur.shop.weather) {
                    const w = getWeatherDef(weather.id);
                    addToast(`${w.emoji} 天气转${w.label} —— ${w.note}`, 'info');
                }
            }
        }, 30000);
        return () => window.clearInterval(t);
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

        let currentState = migrateBankLifeState(savedState || INITIAL_STATE);

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
        // Migration: 库存系统。老存档没有 stock 字段 / 新解锁过的商品没有库存条目时，
        // 给在售商品补上起始库存，营业才有货可卖（幂等：已有条目——哪怕是 0——不覆盖）。
        {
            const stock = { ...(currentState.shop.stock || {}) };
            let stockChanged = currentState.shop.stock === undefined;
            for (const id of currentState.shop.unlockedRecipes) {
                if (stock[id] === undefined) { stock[id] = STARTING_STOCK; stockChanged = true; }
            }
            if (stockChanged) {
                currentState = { ...currentState, shop: { ...currentState.shop, stock } };
            }
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

        // 清洗失效图床(sharkpan)留下的死链：救回历史存档里裂掉的店员头像 / 房间贴图 / 装饰 / 背景。
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

            // Force-update main shop room texture URL in dollhouse
            const mainShopRoom = dh.rooms.find(r => r.id === 'room-1f-left');
            const expectedShopTexture = INITIAL_DOLLHOUSE.rooms.find(r => r.id === 'room-1f-left')?.roomTextureUrl;
            if (mainShopRoom && expectedShopTexture) {
                const updatedDh: DollhouseState = {
                    ...dh,
                    rooms: dh.rooms.map(r =>
                        r.id === 'room-1f-left' ? { ...r, roomTextureUrl: expectedShopTexture } : r
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
            // 过夜营业额已并入「挂机营业额」——离店时间会在下方折算成待收金币，不再一次性补发。

            // Recover Fatigue
            const updatedStaff = currentState.shop.staff.map(s => ({
                ...s,
                fatigue: Math.max(0, s.fatigue - 30)
            }));

            // 每日把在售商品的库存「保底」补到 DAILY_STOCK_FLOOR——不至于完全断货卡死，
            // 但量很小，真正的供货还得靠进货。已高于保底线的不动（不覆盖囤的货）。
            const replenishedStock = { ...(currentState.shop.stock || {}) };
            for (const id of currentState.shop.unlockedRecipes) {
                replenishedStock[id] = Math.max(replenishedStock[id] || 0, DAILY_STOCK_FLOOR);
            }

            currentState = {
                ...currentState,
                todaySpent: 0,
                lastLoginDate: today,
                shop: {
                    ...currentState.shop,
                    actionPoints: (currentState.shop.actionPoints || 0) + dailyAP,
                    staff: updatedStaff,
                    activeVisitor: undefined,
                    stock: replenishedStock,
                }
            };

            await DB.saveBankState(currentState);
            addToast(`新的一天！店铺补给 +${dailyAP} AP`, 'success');
        }

        const todayTx = txs.filter(t => t.dateStr === today);
        const spent = todayTx.reduce((sum, t) => sum + (t.type === 'income' ? 0 : t.amount), 0);
        const appeal = calculateAppeal(currentState.shop.staff.length, currentState.shop.unlockedRecipes);

        // 挂机营业额 + 天气：先定天气（影响挂机产出），再按离店时长折算待收金币
        const nowTs = Date.now();
        const weather = ensureWeather(currentState.shop, nowTs);
        const shopWithWeather = { ...currentState.shop, appeal, weather };
        const idle = accrueShopIdle(shopWithWeather, nowTs);
        const finalState = { ...currentState, todaySpent: spent, shop: { ...shopWithWeather, pendingRevenue: idle.pendingRevenue, lastAccrualAt: idle.lastAccrualAt } };
        stateRef.current = finalState;
        setState(finalState);
        setTransactions(txs.sort((a,b) => b.timestamp - a.timestamp));

        // Always persist after load to ensure migrations are saved
        await DB.saveBankState(finalState);

        // Show tutorial if first time (default budget is 100 and ap is 100 initial)
        if (!savedState) setActiveTab('life');
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
        
        const cur = migrateBankLifeState(stateRef.current);
        const lifeState = cur.life!;
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

    // 擦吧台攒 AP：60s 冷却，每次 +1~2 AP（轻量「活的店」互动，返回实得 AP，0=冷却中）
    const wipeCooldownRef = useRef(0);
    const handleWipeCounter = async (): Promise<number> => {
        const now = Date.now();
        if (now - wipeCooldownRef.current < 60000) return 0;
        wipeCooldownRef.current = now;
        const ap = 1 + Math.floor(Math.random() * 2);
        const cur = stateRef.current;
        const newState = { ...cur, shop: { ...cur.shop, actionPoints: (cur.shop.actionPoints || 0) + ap } };
        stateRef.current = newState;
        setState(newState);
        await DB.saveBankState(newState);
        return ap;
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
                appeal: newAppeal,
                // 上架即附赠一批起始库存，新品当场就能卖
                stock: { ...(cur.shop.stock || {}), [recipeId]: STARTING_STOCK },
            }
        };
        stateRef.current = newState;
        setState(newState);
        await DB.saveBankState(newState);
        addToast(`新商品上架！附赠 ${STARTING_STOCK} 份起始库存，营业时就能卖了`, 'success');
    };

    // --- 进货：花钱包的钱补一批库存（毛利来自进货价 < 售价） ---
    const handleRestock = async (recipeId: string) => {
        const cur = stateRef.current;
        if (!cur.shop.unlockedRecipes.includes(recipeId)) return;
        const r = SHOP_RECIPES.find(x => x.id === recipeId);
        if (!r) return;

        const curStock = cur.shop.stock?.[recipeId] || 0;
        if (curStock >= STOCK_CAP) {
            addToast(`${r.name} 库存已满（${STOCK_CAP}），先卖一些再进货`, 'info');
            return;
        }
        const cost = restockBatchCost(r);
        const wallet = Math.round(userProfile.balance || 0);
        if (wallet < cost) {
            addToast(`钱包不够进货（需 ${cur.config.currencySymbol}${cost}），先开门营业赚一笔吧`, 'error');
            return;
        }

        const newStock = { ...(cur.shop.stock || {}), [recipeId]: Math.min(STOCK_CAP, curStock + RESTOCK_BATCH) };
        const newState = { ...cur, shop: { ...cur.shop, stock: newStock } };
        stateRef.current = newState;
        setState(newState);
        await DB.saveBankState(newState);
        adjustUserBalance(-cost, { note: `${r.name} 进货`, category: 'shop', kind: 'shop-restock', sourceApp: '生活拟', sourceId: recipeId });
        addToast(`${r.name} 进货 +${RESTOCK_BATCH}（花了 ${cur.config.currencySymbol}${cost}）`, 'success');
    };

    const handleRestockLifeProduct = async (productId: string) => {
        const cur = migrateBankLifeState(stateRef.current);
        const product = cur.life?.shopProducts?.find(p => p.id === productId);
        if (!product) return;
        if (product.stock >= STOCK_CAP) {
            addToast(`${product.name} 库存已满`, 'info');
            return;
        }
        const batch = RESTOCK_BATCH;
        const cost = Math.max(1, Math.round(product.cost * batch));
        if ((userProfile.balance || 0) < cost) {
            addToast(`钱包不够进货（需 ¥${cost}）`, 'error');
            return;
        }
        const nextLife = {
            ...cur.life!,
            shopProducts: (cur.life!.shopProducts || []).map(p => p.id === productId ? { ...p, stock: Math.min(STOCK_CAP, p.stock + batch) } : p),
            shopEvents: [{ id: `shop-event-${Date.now()}`, dateStr: cur.life!.dateStr, title: '补了一批货', detail: `${product.name} 补货 +${batch}，货架又满起来了。`, tone: 'info' as const }, ...(cur.life!.shopEvents || [])].slice(0, 20),
        };
        await persistStateUpdate(prev => ({ ...migrateBankLifeState(prev), life: nextLife }));
        adjustUserBalance(-cost, { note: `${product.name} 进货`, category: 'shop', kind: 'shop-restock', sourceApp: '生活拟', sourceId: product.id });
        addToast(`${product.name} 进货 +${batch}`, 'success');
    };

    // --- 店铺升级：花钱包的钱提升等级（客流↑、档次溢价↑、过夜分红↑） ---
    const handleUpgradeShop = async () => {
        const cur = stateRef.current;
        const level = cur.shop.shopLevel || 1;
        if (level >= MAX_SHOP_LEVEL) {
            addToast('店铺已是最高等级啦', 'info');
            return;
        }
        const cost = shopUpgradeCost(level);
        const wallet = Math.round(userProfile.balance || 0);
        if (wallet < cost) {
            addToast(`钱包不够升级（需 ${cur.config.currencySymbol}${cost}），先开门营业多赚点`, 'error');
            return;
        }
        const newState = { ...cur, shop: { ...cur.shop, shopLevel: level + 1 } };
        stateRef.current = newState;
        setState(newState);
        await DB.saveBankState(newState);
        adjustUserBalance(-cost, { note: `店铺升级 Lv.${level + 1}`, category: 'shop', kind: 'shop-upgrade', sourceApp: '生活拟' });
        addToast(`店铺升到 Lv.${level + 1}！客流更旺、档次更高`, 'success');
    };

    // --- 收取挂机营业额：把待收金币进钱包 ---
    const handleCollectIdle = async () => {
        const cur = stateRef.current;
        const idle = accrueShopIdle(cur.shop, Date.now()); // 先把零头折算进来再收
        const amount = Math.floor(idle.pendingRevenue);
        if (amount < 1) { addToast('还没攒下营业额，过会儿再来收～', 'info'); return; }
        const newState = { ...cur, shop: { ...cur.shop, pendingRevenue: 0, lastAccrualAt: Date.now(), totalRevenue: (cur.shop.totalRevenue || 0) + amount } };
        stateRef.current = newState;
        setState(newState);
        await DB.saveBankState(newState);
        adjustUserBalance(amount, { note: '领取挂机营业额', category: 'shop', kind: 'shop-idle', sourceApp: '生活拟' });
        addToast(`收下挂机营业额 +${cur.config.currencySymbol}${amount}`, 'success');
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
        if (!auxApi.apiKey) { addToast('需配置 API Key', 'error'); return; }

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
### Scenario: Visiting User's Life-Sim Shop Guestbook
${userProfile.name} has a virtual life finance app. Inside the app there's a small shop that friends can visit.
You are visiting this shop as a friend/customer.
Shop Name: "${current.shop.shopName}".
Recent Chat Context: ${chatSnippet}

### Task
Generate a guestbook page update.
1. **${randomChar.name}**: Write a guestbook message. React to the shop or start drama. (Use your personality).
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

            const response = await fetch(`${auxApi.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${auxApi.apiKey}` },
                body: JSON.stringify({ model: auxApi.model, messages: [{ role: 'user', content: prompt }] })
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
                                content: `[系统: ${entry.authorName} 拜访了${userProfile.name}的生活拟小店，并表示："${entry.content}"]`,
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

    const updateLifeState = async (updater: (life: NonNullable<BankFullState['life']>) => NonNullable<BankFullState['life']>) => {
        await persistStateUpdate(prev => {
            const withLife = migrateBankLifeState(prev);
            return { ...withLife, life: updater(withLife.life!) };
        });
    };

    const handleAdvanceLifeDay = async () => {
        const cur = migrateBankLifeState(stateRef.current);
        const result = advanceBankLifeDay(cur.life!);
        await persistStateUpdate(prev => ({ ...migrateBankLifeState(prev), life: result.life }));
        for (const ev of result.ledgerEvents) {
            adjustUserBalance(ev.amount, { note: ev.note, category: ev.category, kind: ev.kind, sourceApp: '生活拟', sourceId: ev.sourceId });
        }
        addToast(result.balanceDelta > 0 ? `来到 ${result.life.dateStr}，入账 ¥${result.balanceDelta}` : `来到 ${result.life.dateStr}`, 'success');
    };

    const handleApplyJob = async (posting: BankJobPosting) => {
        const cur = migrateBankLifeState(stateRef.current);
        const result = applyForJob(cur.life!, posting, userProfile.balance || 0);
        await persistStateUpdate(prev => ({ ...migrateBankLifeState(prev), life: result.life }));
        if (result.balanceDelta !== 0) {
            adjustUserBalance(result.balanceDelta, { note: `${posting.title} 求职踩坑`, category: 'job', kind: 'job-risk', sourceApp: '生活拟', sourceId: posting.id });
        }
        addToast(result.application.message, result.application.status === 'hired' ? 'success' : result.application.status === 'scammed' ? 'error' : 'info');
    };

    const handleStartJobApplication = async (posting: BankJobPosting) => {
        const cur = migrateBankLifeState(stateRef.current);
        const result = startJobApplication(cur.life!, posting);
        await persistStateUpdate(prev => ({ ...migrateBankLifeState(prev), life: result.life }));
        setSelectedApplicationId(result.application.id);
        addToast('简历已投出', 'success');
    };

    const handleAdvanceJobApplication = async (applicationId: string) => {
        const cur = migrateBankLifeState(stateRef.current);
        const result = advanceJobApplicationStage(cur.life!, applicationId, interviewAnswer, userProfile.balance || 0);
        if (!result.application) return;
        await persistStateUpdate(prev => ({ ...migrateBankLifeState(prev), life: result.life }));
        if (result.balanceDelta !== 0) {
            adjustUserBalance(result.balanceDelta, { note: `${result.application.title} 求职损失`, category: 'job', kind: 'job-risk', sourceApp: '生活拟', sourceId: result.application.postingId });
        }
        setSelectedApplicationId(result.application.id);
        setInterviewAnswer('');
        addToast(result.application.message, result.application.status === 'hired' ? 'success' : result.application.status === 'scammed' ? 'error' : 'info');
    };

    const handleLeaveJob = async () => {
        const cur = migrateBankLifeState(stateRef.current);
        if (!cur.life?.currentJob) return;
        await persistStateUpdate(prev => ({ ...migrateBankLifeState(prev), life: leaveJob(migrateBankLifeState(prev).life!) }));
        addToast('已离职，未结工资会按发薪日补发', 'info');
    };

    const handleUnlockLifeShop = async () => {
        const wallet = Math.round(userProfile.balance || 0);
        if (wallet < SHOP_UNLOCK_COST) { addToast(`开店至少需要 ¥${SHOP_UNLOCK_COST}`, 'error'); return; }
        const tpl = BUSINESS_TEMPLATES.find(b => b.id === selectedBusinessType) || BUSINESS_TEMPLATES[0];
        const shopName = newShopName.trim() || `${tpl.name}`;
        await persistStateUpdate(prev => {
            const withLife = migrateBankLifeState(prev);
            return {
                ...withLife,
                life: openLifeShop(withLife.life!, tpl.id, shopName),
                shop: { ...withLife.shop, shopName },
            };
        });
        adjustUserBalance(-SHOP_UNLOCK_COST, { note: '生活拟开店启动金', category: 'shop', kind: 'shop-open', sourceApp: '生活拟' });
        addToast(`${shopName} 准备开张`, 'success');
    };

    const handleBuyStock = async (symbol: string) => {
        const amount = Number(stockBudget[symbol]);
        if (!Number.isFinite(amount) || amount <= 0) { addToast('请输入买入金额', 'error'); return; }
        if ((userProfile.balance || 0) < amount) { addToast('钱包不够买入', 'error'); return; }
        const cur = migrateBankLifeState(stateRef.current);
        const result = buyStock(cur.life!, symbol, amount);
        if (result.cost <= 0) { addToast('金额太小，买不了一份', 'info'); return; }
        await persistStateUpdate(prev => ({ ...migrateBankLifeState(prev), life: result.life }));
        adjustUserBalance(-result.cost, { note: `买入 ${symbol}`, category: 'stock', kind: 'stock-buy', sourceApp: '生活拟', sourceId: symbol, relatedEntityId: symbol });
        setStockBudget(prev => ({ ...prev, [symbol]: '' }));
        addToast(`买入 ${symbol} ${result.shares} 股`, 'success');
    };

    const handleSellStock = async (symbol: string) => {
        const cur = migrateBankLifeState(stateRef.current);
        const own = cur.life?.holdings[symbol]?.shares || 0;
        const input = stockSellShares[symbol]?.trim();
        const shares = input ? Number(input) : own;
        if (!Number.isFinite(shares) || shares <= 0) { addToast('请输入卖出份额', 'error'); return; }
        const result = sellStock(cur.life!, symbol, shares);
        if (result.revenue <= 0) { addToast('没有可卖持仓', 'info'); return; }
        await persistStateUpdate(prev => ({ ...migrateBankLifeState(prev), life: result.life }));
        adjustUserBalance(result.revenue, { note: `卖出 ${symbol}`, category: 'stock', kind: 'stock-sell', sourceApp: '生活拟', sourceId: symbol, relatedEntityId: symbol });
        setStockSellShares(prev => ({ ...prev, [symbol]: '' }));
        addToast(`卖出 ${symbol}，到账 ¥${result.revenue}`, 'success');
    };

    const handleToggleWatchlist = async (symbol: string) => {
        await updateLifeState(life => {
            const exists = life.watchlist.includes(symbol);
            return { ...life, watchlist: exists ? life.watchlist.filter(s => s !== symbol) : [symbol, ...life.watchlist] };
        });
    };

    const handleFoundCompany = async () => {
        if ((userProfile.balance || 0) < COMPANY_FOUND_COST) { addToast(`开公司至少需要 ¥${COMPANY_FOUND_COST}`, 'error'); return; }
        const cur = migrateBankLifeState(stateRef.current);
        if (cur.life?.company) { addToast('已经有公司啦', 'info'); return; }
        const nextLife = foundCompany(cur.life!, companyName, companyDirection);
        await persistStateUpdate(prev => ({ ...migrateBankLifeState(prev), life: nextLife }));
        adjustUserBalance(-COMPANY_FOUND_COST, { note: `创办${companyName || companyDirection}`, category: 'company', kind: 'company-found', sourceApp: '生活拟' });
        addToast('公司成立，第一笔启动资金已转入公司', 'success');
    };

    const handleCompanyIssue = async (optionId: string) => {
        const cur = migrateBankLifeState(stateRef.current);
        const beforeCash = cur.life?.company?.cash || 0;
        const nextLife = applyCompanyIssue(cur.life!, optionId);
        const afterCash = nextLife.company?.cash || beforeCash;
        await persistStateUpdate(prev => ({ ...migrateBankLifeState(prev), life: nextLife }));
        addToast(afterCash >= beforeCash ? '事务处理完成，公司现金增加' : '事务处理完成，公司现金减少', 'success');
    };

    const handleCompanyDividend = async () => {
        const cur = migrateBankLifeState(stateRef.current);
        const company = cur.life?.company;
        if (!company || company.cash <= COMPANY_FOUND_COST) { addToast('公司暂时没有可分红利润', 'info'); return; }
        const amount = Math.floor((company.cash - COMPANY_FOUND_COST) * 0.35);
        if (amount <= 0) return;
        const nextLife = { ...cur.life!, company: { ...company, cash: company.cash - amount, cumulativeProfit: company.cumulativeProfit - amount } };
        await persistStateUpdate(prev => ({ ...migrateBankLifeState(prev), life: nextLife }));
        adjustUserBalance(amount, { note: `${company.name} 分红`, category: 'company', kind: 'company-dividend', sourceApp: '生活拟', sourceId: company.id });
        addToast(`公司分红到账 ¥${amount}`, 'success');
    };

    const handleBorrowLoan = async () => {
        const amount = Math.round(Number(loanAmount));
        if (!Number.isFinite(amount) || amount <= 0) { addToast('请输入借款金额', 'error'); return; }
        const product = LOAN_PRODUCTS[loanChannel];
        if (amount < product.min || amount > product.max) { addToast(`${product.name} 可借 ¥${product.min}-${product.max}`, 'error'); return; }
        const cur = migrateBankLifeState(stateRef.current);
        const result = borrowLoan(cur.life!, loanChannel, amount);
        await persistStateUpdate(prev => ({ ...migrateBankLifeState(prev), life: result.life }));
        adjustUserBalance(amount, { note: result.loan.note, category: 'loan', kind: 'loan-borrow', sourceApp: '生活拟', sourceId: result.loan.id });
        addToast(`${result.loan.note} ¥${amount} 到账`, loanChannel === 'shady' ? 'info' : 'success');
    };

    const handleRepayLoan = async (loanId: string) => {
        const amount = Math.round(Number(loanRepayAmount[loanId]));
        if (!Number.isFinite(amount) || amount <= 0) { addToast('请输入还款金额', 'error'); return; }
        if ((userProfile.balance || 0) < amount) { addToast('钱包不够还这笔', 'error'); return; }
        const cur = migrateBankLifeState(stateRef.current);
        const result = repayLoan(cur.life!, loanId, amount);
        if (result.paid <= 0) return;
        await persistStateUpdate(prev => ({ ...migrateBankLifeState(prev), life: result.life }));
        adjustUserBalance(-result.paid, { note: '贷款还款', category: 'loan', kind: 'loan-repay', sourceApp: '生活拟', sourceId: loanId });
        setLoanRepayAmount(prev => ({ ...prev, [loanId]: '' }));
        addToast(`已还款 ¥${result.paid}`, 'success');
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

    // --- AI 后台润色评价：把模板评价改写得更多样、有个性，并据点评情绪微调星级（影响口碑）。
    //     非阻塞、失败兜底（保留模板）。营业时若配了 API Key 才调用。 ---
    const enrichReviewsWithAI = async (batch: ShopReview[], soldProductNames: string[], shopLevel: number) => {
        try {
            const cur = stateRef.current;
            const shopName = cur.shop.shopName || '我的小店';
            const rv = cur.shop.reviews || [];
            const avg = rv.length ? (rv.reduce((s, r) => s + r.rating, 0) / rv.length).toFixed(1) : '—';
            const charNote = (name: string) => {
                const c = characters.find(ch => ch.name === name);
                return c ? `（熟人，人设：${(c.systemPrompt || '').replace(/\s+/g, ' ').slice(0, 60)}）` : '（普通顾客）';
            };
            const list = batch.map(r => ({ id: r.id, 顾客: r.authorName + (r.isNpc ? '' : charNote(r.authorName)), 点的: r.productName || '商品', 初评分: r.rating }));
            const prompt = `你在为一家叫「${shopName}」的小店生成顾客点评。店铺等级 Lv.${shopLevel}，当前口碑均分 ${avg}。本轮卖出：${soldProductNames.join('、') || '商品'}。
请为下面每位顾客写一条**真实、多样、口语化**的点评（中文，约 20~40 字，可用网络梗 / 吐槽 / 夸赞 / 中肯等不同口吻，切忌雷同套话）。熟人顾客要贴合其人设口吻。
同时给出 1~5 的星级：以「初评分」为基准，按你写的点评情绪适度上下浮动（最多差 1 星），不要全给五星。

顾客列表：
${JSON.stringify(list, null, 2)}

只输出 JSON 数组，每项 {"id":"原样照抄","text":"点评","rating":1到5整数}：`;

            const response = await fetch(`${auxApi.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${auxApi.apiKey}` },
                body: JSON.stringify({ model: auxApi.model, messages: [{ role: 'user', content: prompt }] }),
            });
            if (!response.ok) return;
            const data = await safeResponseJson(response);
            const jsonStr = (data.choices?.[0]?.message?.content || '').replace(/```json/g, '').replace(/```/g, '').trim();
            const parsed = JSON.parse(jsonStr);
            if (!Array.isArray(parsed)) return;

            const byId = new Map<string, { text?: string; rating?: number }>();
            for (const item of parsed) {
                if (item && typeof item.id === 'string') {
                    byId.set(item.id, { text: typeof item.text === 'string' ? item.text.trim() : undefined, rating: Number(item.rating) });
                }
            }
            const apply = (r: ShopReview): ShopReview => {
                const u = byId.get(r.id);
                if (!u) return r;
                const rating = Number.isFinite(u.rating) ? Math.max(1, Math.min(5, Math.round(u.rating as number))) : r.rating;
                return { ...r, text: u.text || r.text, rating };
            };
            const ids = new Set(batch.map(b => b.id));
            await persistStateUpdate(prev => ({
                ...prev,
                shop: { ...prev.shop, reviews: (prev.shop.reviews || []).map(r => ids.has(r.id) ? apply(r) : r) },
            }));
            // 结算弹窗若仍在展示这批，原地刷新文案 / 星级
            setBusinessResult(prev => prev && prev.reviews.some(r => ids.has(r.id)) ? { ...prev, reviews: prev.reviews.map(apply) } : prev);
        } catch (e) {
            console.warn('AI review enrich failed', e); // 失败保留模板，不打扰用户
        }
    };

    // --- 营业：模拟一波顾客逐单消费，结算收入进钱包 + 产生评价（与记账无关） ---
    const handleOperate = async () => {
        const cur = migrateBankLifeState(stateRef.current);
        const lifeState = cur.life!;
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
        const lifeProducts = (lifeState.shopProducts || []).filter(p => p.stock > 0 || p.stock === 0);
        const products = lifeProducts.length
            ? lifeProducts.map(p => ({ id: p.id, name: p.name, icon: '🛍️', price: p.price, appeal: p.appeal, stock: p.stock }))
            : SHOP_RECIPES.filter(r => cur.shop.unlockedRecipes.includes(r.id)).map(r => ({ ...r, price: recipePrice(r), stock: cur.shop.stock?.[r.id] || 0 }));
        const usingLifeProducts = lifeProducts.length > 0;
        if (products.length === 0) {
            addToast('菜单空空，先去「经营」解锁可卖的商品', 'info');
            return;
        }

        // 库存：取一份可变副本，营业卖出逐个扣减。货架全空就别开门（不消耗营业冷却），先去进货。
        const stockLeft: Record<string, number> = { ...(cur.shop.stock || {}) };
        const lifeStockLeft: Record<string, number> = Object.fromEntries((lifeState.shopProducts || []).map(p => [p.id, p.stock]));
        const availableStock = products.reduce((s, p) => s + Math.max(0, usingLifeProducts ? (lifeStockLeft[p.id] || 0) : (stockLeft[p.id] || 0)), 0);
        if (availableStock === 0) {
            addToast('货架都空了，先去「经营」里进货，再开门营业', 'info');
            return;
        }

        const appeal = cur.shop.appeal || calculateAppeal(staff.length, cur.shop.unlockedRecipes);
        const level = cur.shop.shopLevel || 1;
        const reviews = cur.shop.reviews || [];
        const avgRep = reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 4.2;
        const repBonusPct = Math.round((avgRep - 4) * 10); // 4★→0；5★→+10%；3★→-10%
        const levelBonusPct = shopLevelBonusPct(level); // 店铺档次溢价，与口碑加成叠加
        const energetic = staff.filter(s => s.fatigue < 90).length;
        const tiredFactor = energetic === 0 ? 0.5 : 1; // 全员疲惫，客流减半
        const weather = getWeatherDef(cur.shop.weather?.id); // 天气：影响客流与小费
        // 店员会失误：越累越容易手忙脚乱（出错/上错单），丢小费 + 招差评，提醒你让店员歇歇
        const avgFatigue = staff.reduce((s, x) => s + x.fatigue, 0) / Math.max(1, staff.length);
        const fumbleChance = Math.min(0.3, Math.max(0, (avgFatigue - 40) / 100 * 0.5));

        // 客流：基础随人气波动 × 天气倍率，外加店铺等级带来的额外客人；等级越高客流上限越大
        const customerCount = Math.max(2, Math.min(8 + level,
            Math.round((appeal / 90) * (0.8 + Math.random() * 0.5) * tiredFactor * weather.trafficMult) + 1 + shopLevelExtraCustomers(level)));

        const itemMap = new Map<string, { name: string; icon: string; qty: number; subtotal: number }>();
        let base = 0, tips = 0, lostSales = 0, regularVisits = 0, mishaps = 0;
        const newReviews: ShopReview[] = [];
        const usedNpc = new Set<string>();
        const regulars: Record<string, ShopRegular> = { ...(cur.shop.regulars || {}) };
        const loyaltyEvents: { name: string; tier: 'regular' | 'vip' }[] = [];

        // 选一位顾客身份：已有常客有概率「回头」光顾（按到访次数加权，VIP 最常来）；否则来个新客
        const pickCustomer = (): { id: string; name: string; avatar: string; isNpc: boolean } => {
            const pool = Object.values(regulars);
            if (pool.length > 0 && Math.random() < 0.5) {
                const weighted: ShopRegular[] = [];
                pool.forEach(r => { const w = Math.min(6, 1 + Math.floor(r.visits / 2)); for (let k = 0; k < w; k++) weighted.push(r); });
                const r = weighted[Math.floor(Math.random() * weighted.length)];
                return { id: r.id, name: r.name, avatar: r.avatar, isNpc: r.isNpc };
            }
            if (characters.length > 0 && Math.random() < 0.25) {
                const c = characters[Math.floor(Math.random() * characters.length)];
                return { id: `char:${c.id}`, name: c.name, avatar: c.avatar, isNpc: false };
            }
            let npc = NPC_CUSTOMERS[0], tries = 0;
            do { npc = NPC_CUSTOMERS[Math.floor(Math.random() * NPC_CUSTOMERS.length)]; tries++; } while (usedNpc.has(npc.name) && tries < 5);
            usedNpc.add(npc.name);
            return { id: `npc:${npc.name}`, name: npc.name, avatar: npc.avatar, isNpc: true };
        };

        for (let i = 0; i < customerCount; i++) {
            // 只卖还有库存的商品；若全部售罄，这位客人空手而归（缺货流失，不计收入也不留评，也不算到访）
            const inStock = products.filter(p => (usingLifeProducts ? (lifeStockLeft[p.id] || 0) : (stockLeft[p.id] || 0)) > 0);
            if (inStock.length === 0) { lostSales++; continue; }

            const who = pickCustomer();
            const priorVisits = regulars[who.id]?.visits || 0;
            const isVip = priorVisits >= VIP_VISITS;
            const isRegular = priorVisits >= REGULAR_VISITS;
            if (isRegular) regularVisits++;

            const p = inStock[Math.floor(Math.random() * inStock.length)];
            if (usingLifeProducts) lifeStockLeft[p.id] = (lifeStockLeft[p.id] || 0) - 1;
            else stockLeft[p.id] = (stockLeft[p.id] || 0) - 1;
            const price = p.price;
            base += price;
            const fumbled = Math.random() < fumbleChance; // 店员手忙脚乱：照付钱，但没小费 + 招差评
            if (fumbled) mishaps++;

            // 小费：失误就别想要小费了；否则常客/VIP/天气加成
            if (!fumbled) {
                const tipChance = (isVip ? 1 : isRegular ? 0.7 : 0.45) + weather.tipBias;
                const tipMult = isVip ? 1.6 : isRegular ? 1.3 : 1;
                if (Math.random() < tipChance) tips += Math.max(1, Math.round(price * (0.1 + Math.random() * 0.2) * tipMult));
            }

            const ex = itemMap.get(p.id);
            if (ex) { ex.qty++; ex.subtotal += price; } else itemMap.set(p.id, { name: p.name, icon: p.icon, qty: 1, subtotal: price });

            if (fumbled) {
                // 失误必留差评（吐槽手忙脚乱 / 等太久）
                const rating = Math.random() < 0.4 ? 1 : 2;
                newReviews.push({
                    id: `rev-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 5)}`,
                    authorName: who.name, avatar: who.avatar, rating, text: buildMishapText(p.name),
                    productName: p.name, ts: Date.now(), isNpc: who.isNpc,
                });
            } else {
                // 留评：常客更爱留评，且评分更高更稳
                const reviewChance = isRegular ? 0.5 : 0.35;
                if (Math.random() < reviewChance) {
                    let rating = 4 + (Math.random() < 0.5 ? 1 : 0);
                    if (energetic === 0) rating -= 2;
                    else if (avgRep < 3.5 && Math.random() < 0.4) rating -= 1;
                    if (Math.random() < 0.08) rating -= 2; // 偶发差评
                    if (isVip) rating = Math.max(rating, 4) + (Math.random() < 0.5 ? 1 : 0);
                    else if (isRegular) rating = Math.max(rating, 4);
                    rating = Math.max(1, Math.min(5, rating));
                    newReviews.push({
                        id: `rev-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 5)}`,
                        authorName: who.name, avatar: who.avatar, rating, text: buildReviewText(rating, p.name),
                        productName: p.name, ts: Date.now(), isNpc: who.isNpc,
                    });
                }
            }

            // 累计到访 + 晋升检测（常客 / VIP）
            const nextVisits = priorVisits + 1;
            regulars[who.id] = { id: who.id, name: who.name, avatar: who.avatar, isNpc: who.isNpc, visits: nextVisits };
            if (priorVisits < REGULAR_VISITS && nextVisits >= REGULAR_VISITS) loyaltyEvents.push({ name: who.name, tier: 'regular' });
            if (priorVisits < VIP_VISITS && nextVisits >= VIP_VISITS) loyaltyEvents.push({ name: who.name, tier: 'vip' });
        }

        // 常客表按到访次数保留 Top N，防止无限膨胀
        const prunedRegulars: Record<string, ShopRegular> = {};
        Object.values(regulars)
            .sort((a, b) => b.visits - a.visits)
            .slice(0, MAX_REGULARS)
            .forEach(r => { prunedRegulars[r.id] = r; });

        const total = Math.max(1, Math.round((base + tips) * (1 + (repBonusPct + levelBonusPct) / 100)));
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
                stock: stockLeft,
                regulars: prunedRegulars,
            },
            life: {
                ...lifeState,
                shopProducts: usingLifeProducts
                    ? (lifeState.shopProducts || []).map(p => ({ ...p, stock: Math.max(0, lifeStockLeft[p.id] ?? p.stock) }))
                    : lifeState.shopProducts,
                shopEvents: usingLifeProducts
                    ? [{ id: `shop-event-${Date.now()}`, dateStr: lifeState.dateStr, title: '今日营业', detail: `${lifeState.shopBusinessName || cur.shop.shopName} 接待了 ${customerCount} 位客人，收入 ¥${total}。`, tone: 'good' as const }, ...(lifeState.shopEvents || [])].slice(0, 20)
                    : lifeState.shopEvents,
            },
        };
        stateRef.current = newState;
        setState(newState);
        await DB.saveBankState(newState);
        adjustUserBalance(total, { note: '店铺营业收入', category: 'shop', kind: 'shop-business', sourceApp: '生活拟' });

        for (const ev of loyaltyEvents.filter(e => e.tier === 'vip')) {
            addToast(`👑 ${ev.name} 成了你店里的 VIP！`, 'success');
        }

        setBusinessResult({
            total, base, tips, customerCount,
            items: Array.from(itemMap.values()).sort((a, b) => b.subtotal - a.subtotal),
            reviews: newReviews,
            repBonusPct,
            levelBonusPct,
            shopLevel: level,
            lostSales,
            loyaltyEvents,
            regularVisits,
            mishaps,
            weather: { emoji: weather.emoji, label: weather.label, note: weather.note },
        });

        // 客户评价交给 AI 后台润色：把模板评价改写得更多样、有个性，并据此微调星级（影响口碑）。
        // 非阻塞——营业已即时出结果；没配 Key 或失败就保留模板。
        if (auxApi.apiKey && newReviews.length > 0) {
            void enrichReviewsWithAI(newReviews, Array.from(itemMap.values()).map(it => it.name), level);
        }
    };

    // 库存告急：有在售商品快卖光（≤3 份）时，给「经营」书签贴个小红点，点进去就能进货
    const LOW_STOCK_THRESHOLD = 3;
    const lowStockCount = state.shop.unlockedRecipes.reduce(
        (n, id) => n + ((state.shop.stock?.[id] ?? 0) <= LOW_STOCK_THRESHOLD ? 1 : 0), 0);
    const hasLowStock = lowStockCount > 0;
    const life = migrateBankLifeState(state).life!;
    const stockValue = stockMarketValue(life);
    const debtValue = loanTotal(life);
    const netWorth = Math.round((userProfile.balance || 0) + stockValue + (life.company?.cash || 0) - debtValue);

    const cardStyle: React.CSSProperties = { background: '#fff', borderRadius: 22, border: '1px solid rgba(43,41,51,0.06)', boxShadow: '0 1px 2px rgba(38,38,38,0.04), 0 18px 40px -28px rgba(38,38,38,0.30)' };
    const smallBtn = (bg: string, color = '#fff'): React.CSSProperties => ({ background: bg, color, borderRadius: 999, fontFamily: HAND_FONT, boxShadow: bg === '#fff' || bg.startsWith('#f') ? '0 8px 18px -14px rgba(38,38,38,0.35)' : '0 12px 24px -14px rgba(38,38,38,0.48)' });
    const chipStyle = (active = false): React.CSSProperties => ({
        background: active ? INK : '#fff',
        color: active ? '#fff' : INK_SOFT,
        border: '1px solid rgba(43,41,51,0.08)',
        boxShadow: active ? '0 10px 20px -14px rgba(43,41,51,0.65)' : '0 6px 16px -14px rgba(43,41,51,0.35)',
        borderRadius: 999,
    });
    const statTiles = [
        { label: '钱包', value: `¥${Math.round(userProfile.balance || 0)}`, color: '#16a34a' },
        { label: '净资产', value: `¥${netWorth}`, color: INK },
        { label: '股票市值', value: `¥${Math.round(stockValue)}`, color: '#0284c7' },
        { label: '负债', value: `¥${Math.round(debtValue)}`, color: '#e11d48' },
    ];
    const fmt = (n: number) => `¥${Math.round(n)}`;
    const selectedBusiness = BUSINESS_TEMPLATES.find(b => b.id === selectedBusinessType) || BUSINESS_TEMPLATES[0];
    const selectedJob = JOB_POSTINGS.find(j => j.id === selectedJobId) || getJobsByCategory(jobCategory)[0] || JOB_POSTINGS[0];
    const selectedApplication = selectedApplicationId
        ? life.jobHistory.find(a => a.id === selectedApplicationId)
        : life.jobHistory[0];
    const selectedStock = life.stockMarket.find(s => s.symbol === selectedStockSymbol) || life.stockMarket[0];
    const selectedLoan = selectedLoanId ? life.loans.find(l => l.id === selectedLoanId) : life.loans[0];

    const renderStockChart = (quote: BankStockQuote) => {
        const candles = (quote.history || []).slice(-28);
        if (!candles.length) return <div className="h-[174px] rounded-[18px]" style={{ background: '#faf8f5' }} />;
        const width = 320;
        const height = 174;
        const top = 12;
        const bottom = 42;
        const priceMax = Math.max(...candles.map(c => c.high));
        const priceMin = Math.min(...candles.map(c => c.low));
        const volMax = Math.max(...candles.map(c => c.volume), 1);
        const scaleY = (price: number) => top + (priceMax - price) / Math.max(0.01, priceMax - priceMin) * (height - bottom - top);
        const closes = candles.map(c => c.close);
        const ma5 = movingAverage(closes, 5);
        const ma10 = movingAverage(closes, 10);
        const step = width / candles.length;
        const linePath = (values: number[]) => values.map((v, i) => `${i === 0 ? 'M' : 'L'} ${Math.round(i * step + step / 2)} ${Math.round(scaleY(v))}`).join(' ');
        return (
            <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-[174px] rounded-[18px]" style={{ background: '#fbfaf8' }} role="img" aria-label={`${quote.name} K线`}>
                {[0, 1, 2].map(i => <line key={i} x1="0" x2={width} y1={top + i * 42} y2={top + i * 42} stroke="rgba(43,41,51,0.06)" />)}
                {candles.map((c, i) => {
                    const x = i * step + step / 2;
                    const up = c.close >= c.open;
                    const y1 = scaleY(Math.max(c.open, c.close));
                    const y2 = scaleY(Math.min(c.open, c.close));
                    const volH = Math.max(3, c.volume / volMax * 30);
                    return (
                        <g key={c.dateStr}>
                            <rect x={x - step * 0.26} y={height - volH - 5} width={Math.max(2, step * 0.52)} height={volH} rx="1.5" fill={up ? 'rgba(225,29,72,0.22)' : 'rgba(22,163,74,0.22)'} />
                            <line x1={x} x2={x} y1={scaleY(c.high)} y2={scaleY(c.low)} stroke={up ? '#e11d48' : '#16a34a'} strokeWidth="1.2" />
                            <rect x={x - step * 0.22} y={Math.min(y1, y2)} width={Math.max(2, step * 0.44)} height={Math.max(2, Math.abs(y2 - y1))} rx="1.5" fill={up ? '#e11d48' : '#16a34a'} />
                        </g>
                    );
                })}
                <path d={linePath(ma5)} fill="none" stroke="#2563eb" strokeWidth="1.6" strokeLinecap="round" />
                <path d={linePath(ma10)} fill="none" stroke="#f59e0b" strokeWidth="1.6" strokeLinecap="round" />
                <text x="10" y="20" fontSize="10" fill="#2563eb" fontWeight="700">MA5</text>
                <text x="48" y="20" fontSize="10" fill="#f59e0b" fontWeight="700">MA10</text>
                <text x={width - 74} y="20" fontSize="10" fill={quote.changePct >= 0 ? '#e11d48' : '#16a34a'} fontWeight="800">{quote.changePct >= 0 ? '+' : ''}{quote.changePct}%</text>
            </svg>
        );
    };

    const renderLifeHome = () => (
        <div className="flex-1 overflow-y-auto no-scrollbar px-3.5 pt-3 pb-4 space-y-4">
            <PaperCard className="p-4 overflow-hidden">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <div className="text-[10px] tracking-[0.28em] uppercase" style={{ color: '#f43f5e', fontFamily: 'var(--font-label)' }}>Life Sim</div>
                        <div className="text-[34px] font-black leading-none mt-1" style={{ color: INK, fontFamily: HAND_FONT }}>{life.dateStr.slice(5)}</div>
                        <div className="mt-2 text-[12px] leading-relaxed truncate" style={{ color: INK_SOFT }}>
                            {life.currentJob ? `${life.currentJob.title} · ${life.currentJob.employer}` : '自由安排的一天'}
                        </div>
                    </div>
                    <div className="w-16 h-16 rounded-[20px] flex items-center justify-center text-[28px] shrink-0" style={{ background: '#faf8f5', border: '1px solid rgba(43,41,51,0.06)' }}>¥</div>
                </div>
                <ScrapButton onClick={handleAdvanceLifeDay} className="mt-4 w-full py-2.5 text-[13px]">下一天</ScrapButton>
            </PaperCard>

            <div className="grid grid-cols-2 gap-2.5">
                {statTiles.map(s => (
                    <PaperCard key={s.label} className="px-3 py-3">
                        <div className="text-[10px] font-bold" style={{ color: INK_SOFT }}>{s.label}</div>
                        <div className="text-[22px] font-black leading-tight mt-0.5 truncate" style={{ color: s.color, fontFamily: HAND_FONT }}>{s.value}</div>
                    </PaperCard>
                ))}
            </div>

            <PaperCard className="p-4">
                <SectionTag en="status">今日看板</SectionTag>
                <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]" style={{ color: '#4a4750' }}>
                    <div className="rounded-2xl px-3 py-2" style={{ background: '#faf8f5' }}>店铺：{life.shopUnlocked ? `${life.shopBusinessName || state.shop.shopName} · Lv.${state.shop.shopLevel}` : '还没开张'}</div>
                    <div className="rounded-2xl px-3 py-2" style={{ background: '#faf8f5' }}>公司：{life.company ? life.company.name : '尚未创业'}</div>
                    <div className="rounded-2xl px-3 py-2" style={{ background: '#faf8f5' }}>贷款：{life.loans.length} 笔</div>
                    <div className="rounded-2xl px-3 py-2" style={{ background: '#faf8f5' }}>持仓：{Object.keys(life.holdings).length} 只</div>
                </div>
                <div className="mt-3">
                    <div className="flex items-center justify-between text-[11px] font-bold" style={{ color: INK_SOFT }}><span>疲劳</span><span>{life.fatigue}/100</span></div>
                    <div className="mt-1 h-2 rounded-full overflow-hidden" style={{ background: '#efece7' }}>
                        <div className="h-full rounded-full" style={{ width: `${Math.min(100, life.fatigue)}%`, background: life.fatigue > 70 ? '#f43f5e' : '#22c55e' }} />
                    </div>
                </div>
            </PaperCard>

            <PaperCard className="p-4">
                <SectionTag en="today">今日事件</SectionTag>
                <div className="space-y-2.5 mt-3">
                    {life.events.slice(0, 6).map(ev => (
                        <div key={ev.id} className="flex items-start gap-2 text-[12px]">
                            <span className="mt-0.5 w-5 h-5 rounded-full flex items-center justify-center text-[10px] shrink-0" style={{ background: ev.tone === 'good' ? '#dcfce7' : ev.tone === 'bad' ? '#ffe4e6' : ev.tone === 'warn' ? '#fef3c7' : '#f1f5f9', color: ev.tone === 'good' ? '#15803d' : ev.tone === 'bad' ? '#be123c' : ev.tone === 'warn' ? '#92400e' : INK_SOFT }}>{ev.tone === 'good' ? '✓' : ev.tone === 'bad' ? '!' : ev.tone === 'warn' ? '△' : '·'}</span>
                            <div className="flex-1 min-w-0">
                                <div className="font-bold truncate" style={{ color: INK }}>{ev.title} <span className="font-normal" style={{ color: INK_SOFT }}>{ev.dateStr}</span></div>
                                <div className="leading-relaxed" style={{ color: '#5a5660' }}>{ev.detail}</div>
                            </div>
                            {ev.amount !== undefined && <span className="font-black shrink-0" style={{ color: ev.amount >= 0 ? '#16a34a' : '#e11d48' }}>{ev.amount >= 0 ? '+' : '-'}¥{Math.abs(ev.amount)}</span>}
                        </div>
                    ))}
                </div>
            </PaperCard>

            <PaperCard className="p-4">
                <SectionTag en="ledger">最近流水</SectionTag>
                <div className="mt-2">
                    {transactions.slice(0, 5).map(tx => (
                        <div key={tx.id} className="flex items-center justify-between py-2 text-[12px] border-b last:border-0" style={{ borderColor: 'rgba(43,41,51,0.06)' }}>
                            <span className="truncate pr-2">{tx.note}<span style={{ color: INK_SOFT }}> · {tx.sourceApp || '手动'}</span></span>
                            <span className="font-black shrink-0" style={{ color: tx.type === 'income' ? '#16a34a' : '#e11d48' }}>{tx.type === 'income' ? '+' : '-'}¥{tx.amount}</span>
                        </div>
                    ))}
                </div>
            </PaperCard>
        </div>
    );

    const renderJobs = () => {
        const jobs = getJobsByCategory(jobCategory);
        const applicationStageLabel: Record<string, string> = {
            submitted: '已投递',
            screening: '简历筛选',
            assessment: '笔试 / 试岗',
            interview: '面试问答',
            offer: 'Offer',
            hired: '已入职',
            trial: '试用中',
            rejected: '未通过',
            scammed: '踩坑',
        };
        return (
            <div className="flex-1 overflow-y-auto no-scrollbar px-3.5 pt-3 pb-4 space-y-4">
                {life.currentJob && (
                    <PaperCard className="p-4">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <CleanBadge tone="green">当前在职</CleanBadge>
                                <div className="text-[18px] font-black mt-1 truncate" style={{ color: INK, fontFamily: HAND_FONT }}>{life.currentJob.title}</div>
                                <div className="text-[12px]" style={{ color: INK_SOFT }}>{life.currentJob.employer} · 已工作 {life.currentJob.daysWorked} 天 · 待发 ¥{Math.round(life.currentJob.accruedWage)}</div>
                            </div>
                            <ScrapButton onClick={handleLeaveJob} variant="ghost" className="px-3 py-2 text-[12px]">离职</ScrapButton>
                        </div>
                    </PaperCard>
                )}
                <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                    {JOB_CATEGORIES.map(c => (
                        <button key={c} onClick={() => { setJobCategory(c); const first = getJobsByCategory(c)[0]; if (first) setSelectedJobId(first.id); }} className="shrink-0 px-3 py-1.5 text-[12px] font-bold press-soft" style={chipStyle(jobCategory === c)}>{c}</button>
                    ))}
                </div>
                <div className="grid grid-cols-[0.9fr_1.1fr] gap-3 max-[420px]:grid-cols-1">
                    <div className="space-y-2.5">
                        {jobs.map(job => (
                            <button key={job.id} onClick={() => setSelectedJobId(job.id)} className="w-full text-left p-3 press-soft" style={{ ...cleanCardStyle, borderColor: selectedJob?.id === job.id ? '#f43f5e' : 'rgba(43,41,51,0.06)' }}>
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <div className="text-[14px] font-black truncate" style={{ color: INK }}>{job.title}</div>
                                        <div className="text-[10px] truncate" style={{ color: INK_SOFT }}>{job.employer}</div>
                                    </div>
                                    {job.black && <CleanBadge tone="red">谨慎</CleanBadge>}
                                </div>
                                <div className="mt-2 text-[12px] font-black" style={{ color: '#16a34a' }}>¥{job.salaryMin}-{job.salaryMax}{job.payCycle === 'daily' ? '/天' : '/月'}</div>
                            </button>
                        ))}
                    </div>
                    {selectedJob && (
                        <PaperCard className="p-4 space-y-3">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="text-[20px] font-black leading-tight" style={{ color: INK, fontFamily: HAND_FONT }}>{selectedJob.title}</div>
                                    <div className="text-[12px] mt-1" style={{ color: INK_SOFT }}>{selectedJob.employer} · {selectedJob.category} · {selectedJob.payCycle === 'daily' ? '日结' : `${selectedJob.payDay}号发薪`}</div>
                                </div>
                                <div className="text-right shrink-0">
                                    <div className="text-[16px] font-black" style={{ color: '#16a34a' }}>¥{selectedJob.salaryMin}-{selectedJob.salaryMax}</div>
                                    <div className="text-[10px]" style={{ color: INK_SOFT }}>{selectedJob.payCycle === 'daily' ? '每天' : '每月'}</div>
                                </div>
                            </div>
                            <p className="text-[12px] leading-relaxed" style={{ color: '#4a4750' }}>{selectedJob.description}</p>
                            <div className="grid grid-cols-2 gap-2 text-[11px]">
                                <div className="rounded-2xl p-3" style={{ background: '#faf8f5' }}><b>强度</b><div>{selectedJob.intensity}/5</div></div>
                                <div className="rounded-2xl p-3" style={{ background: '#faf8f5' }}><b>结算</b><div>{selectedJob.payCycle === 'daily' ? '当天到账' : `${selectedJob.payDay}号`}</div></div>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                                {[...selectedJob.requirements, ...selectedJob.benefits, ...selectedJob.riskTags].map(tag => <CleanBadge key={tag} tone={selectedJob.riskTags.includes(tag) ? 'amber' : 'default'}>{tag}</CleanBadge>)}
                            </div>
                            <button onClick={() => handleStartJobApplication(selectedJob)} className="w-full py-2.5 text-[13px] font-black active:scale-95 transition-transform" style={smallBtn(selectedJob.black ? '#f43f5e' : INK)}>
                                投递简历
                            </button>
                        </PaperCard>
                    )}
                </div>
                {selectedApplication && (
                    <PaperCard className="p-4 space-y-3">
                        <SectionTag en="interview">求职进展</SectionTag>
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <div className="font-black text-[16px] truncate" style={{ color: INK }}>{selectedApplication.title}</div>
                                <div className="text-[12px]" style={{ color: INK_SOFT }}>{selectedApplication.employer} · {applicationStageLabel[selectedApplication.stage || selectedApplication.status] || selectedApplication.status}</div>
                            </div>
                            <CleanBadge tone={selectedApplication.status === 'scammed' ? 'red' : selectedApplication.status === 'hired' ? 'green' : 'blue'}>评分 {selectedApplication.score || 0}</CleanBadge>
                        </div>
                        <div className="rounded-2xl p-3 text-[12px] leading-relaxed" style={{ background: '#faf8f5', color: '#4a4750' }}>{selectedApplication.message}</div>
                        {(selectedApplication.questions || []).slice(0, 3).map(q => (
                            <div key={q.id} className="rounded-2xl p-3 text-[12px]" style={{ background: '#fff', border: '1px solid rgba(43,41,51,0.06)' }}>
                                <div className="font-bold" style={{ color: INK }}>{q.question}</div>
                                {q.answer && <div className="mt-1" style={{ color: INK_SOFT }}>{q.answer}</div>}
                            </div>
                        ))}
                        {(['assessment', 'interview'].includes(selectedApplication.stage || '')) && (
                            <textarea value={interviewAnswer} onChange={e => setInterviewAnswer(e.target.value)} rows={3} placeholder="写下面试回答或试岗表现" className="w-full px-3 py-2 text-[12px] outline-none resize-none" style={hbInputStyle} />
                        )}
                        {!['hired', 'trial', 'rejected', 'scammed'].includes(selectedApplication.stage || selectedApplication.status) && (
                            <button onClick={() => handleAdvanceJobApplication(selectedApplication.id)} className="w-full py-2.5 text-[13px] font-black active:scale-95 transition-transform" style={smallBtn('#f43f5e')}>
                                {selectedApplication.stage === 'offer' ? '接受 Offer' : selectedApplication.stage === 'submitted' ? '查看筛选' : selectedApplication.stage === 'screening' ? '进入下一步' : '提交回答'}
                            </button>
                        )}
                    </PaperCard>
                )}
            </div>
        );
    };

    const renderInvest = () => {
        const market = [...life.stockMarket].filter(q => marketView === 'watch' ? life.watchlist.includes(q.symbol) : true);
        const sorted = marketView === 'gainers' ? market.sort((a, b) => b.changePct - a.changePct) : marketView === 'losers' ? market.sort((a, b) => a.changePct - b.changePct) : market;
        const q = selectedStock || sorted[0];
        const hold = q ? life.holdings[q.symbol] : undefined;
        const pnl = q && hold ? Math.round((q.price - hold.avgCost) * hold.shares) : 0;
        return (
            <div className="flex-1 overflow-y-auto no-scrollbar px-3.5 pt-3 pb-4 space-y-3">
                <PaperCard className="p-4">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <SectionTag en="market">行情</SectionTag>
                            <div className="mt-2 text-[24px] font-black" style={{ color: INK, fontFamily: HAND_FONT }}>¥{Math.round(stockValue)}</div>
                            <div className="text-[11px]" style={{ color: INK_SOFT }}>持仓总市值</div>
                        </div>
                        <div className="flex flex-wrap justify-end gap-1.5 max-w-[180px]">
                            {(['all', 'watch', 'gainers', 'losers'] as const).map(k => <button key={k} onClick={() => setMarketView(k)} className="px-2.5 py-1.5 text-[11px] font-bold press-soft" style={chipStyle(marketView === k)}>{k === 'all' ? '全部' : k === 'watch' ? '自选' : k === 'gainers' ? '涨幅' : '跌幅'}</button>)}
                        </div>
                    </div>
                </PaperCard>
                {q && (
                    <PaperCard className="p-4 space-y-3">
                        <div className="flex justify-between gap-3">
                            <div className="min-w-0">
                                <div className="text-[20px] font-black truncate" style={{ color: INK, fontFamily: HAND_FONT }}>{q.name} <span className="text-[11px]" style={{ color: INK_SOFT }}>{q.symbol}</span></div>
                                <div className="text-[11px]" style={{ color: INK_SOFT }}>{q.industry} · 风险 {q.risk}/5</div>
                            </div>
                            <div className="text-right shrink-0">
                                <div className="text-[20px] font-black" style={{ color: q.changePct >= 0 ? '#e11d48' : '#16a34a' }}>¥{q.price}</div>
                                <div className="text-[11px]" style={{ color: q.changePct >= 0 ? '#e11d48' : '#16a34a' }}>{q.changePct >= 0 ? '+' : ''}{q.changePct}%</div>
                            </div>
                        </div>
                        {renderStockChart(q)}
                        <div className="grid grid-cols-3 gap-2 text-center">
                            <div className="rounded-2xl py-2" style={{ background: '#faf8f5' }}><div className="text-[13px] font-black">{q.intraday?.[q.intraday.length - 1]?.time || '15:00'}</div><div className="text-[10px]" style={{ color: INK_SOFT }}>分时</div></div>
                            <div className="rounded-2xl py-2" style={{ background: '#faf8f5' }}><div className="text-[13px] font-black">{q.history?.[q.history.length - 1]?.volume.toLocaleString() || 0}</div><div className="text-[10px]" style={{ color: INK_SOFT }}>成交量</div></div>
                            <div className="rounded-2xl py-2" style={{ background: '#faf8f5' }}><div className="text-[13px] font-black">{life.watchlist.includes(q.symbol) ? '已加' : '未加'}</div><div className="text-[10px]" style={{ color: INK_SOFT }}>自选</div></div>
                        </div>
                        <p className="text-[12px] rounded-2xl px-3 py-2" style={{ color: '#4a4750', background: '#faf8f5' }}>{q.news}</p>
                        <div className="flex flex-wrap gap-1.5">{(q.eventTags || []).map(tag => <CleanBadge key={tag} tone="blue">{tag}</CleanBadge>)}</div>
                        {hold && <div className="text-[11px]" style={{ color: INK_SOFT }}>持仓 {hold.shares} 股 · 成本 ¥{hold.avgCost} · 浮盈亏 <b style={{ color: pnl >= 0 ? '#e11d48' : '#16a34a' }}>{pnl >= 0 ? '+' : ''}¥{pnl}</b></div>}
                        <div className="grid grid-cols-2 gap-2">
                            <div className="flex gap-1.5">
                                <input type="number" value={stockBudget[q.symbol] || ''} onChange={e => setStockBudget(prev => ({ ...prev, [q.symbol]: e.target.value }))} placeholder="买入金额" className="min-w-0 flex-1 px-3 py-2 text-[12px] outline-none" style={hbInputStyle} />
                                <button onClick={() => handleBuyStock(q.symbol)} className="px-3 text-[12px] font-black" style={smallBtn('#f43f5e')}>买</button>
                            </div>
                            <div className="flex gap-1.5">
                                <input type="number" value={stockSellShares[q.symbol] || ''} onChange={e => setStockSellShares(prev => ({ ...prev, [q.symbol]: e.target.value }))} placeholder="卖出股数" className="min-w-0 flex-1 px-3 py-2 text-[12px] outline-none" style={hbInputStyle} />
                                <button onClick={() => handleSellStock(q.symbol)} className="px-3 text-[12px] font-black" style={smallBtn('#16a34a')}>卖</button>
                            </div>
                        </div>
                        <button onClick={() => handleToggleWatchlist(q.symbol)} className="w-full py-2 text-[12px] font-black" style={chipStyle(false)}>{life.watchlist.includes(q.symbol) ? '移出自选' : '加入自选'}</button>
                    </PaperCard>
                )}
                <div className="grid gap-2">
                    {sorted.map(item => (
                        <button key={item.symbol} onClick={() => setSelectedStockSymbol(item.symbol)} className="p-3 text-left press-soft" style={{ ...cleanCardStyle, borderColor: q?.symbol === item.symbol ? '#f43f5e' : 'rgba(43,41,51,0.06)' }}>
                            <div className="flex justify-between gap-3">
                                <div className="min-w-0"><div className="font-black truncate" style={{ color: INK }}>{item.name}</div><div className="text-[10px]" style={{ color: INK_SOFT }}>{item.symbol} · {item.industry}</div></div>
                                <div className="text-right shrink-0"><div className="font-black">¥{item.price}</div><div className="text-[11px]" style={{ color: item.changePct >= 0 ? '#e11d48' : '#16a34a' }}>{item.changePct >= 0 ? '+' : ''}{item.changePct}%</div></div>
                            </div>
                        </button>
                    ))}
                </div>
            </div>
        );
    };

    const renderCompany = () => (
        <div className="flex-1 overflow-y-auto no-scrollbar px-3.5 pt-3 pb-4 space-y-4">
            {!life.company ? (
                <PaperCard className="p-4 space-y-3">
                    <SectionTag en="startup">开一家公司</SectionTag>
                    <div className="grid grid-cols-2 gap-2">
                        <div><FieldLabel>公司昵称</FieldLabel><input value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="比如：月光社" className="w-full px-3 py-2 outline-none" style={hbInputStyle} /></div>
                        <div><FieldLabel>启动资金</FieldLabel><div className="px-3 py-2 text-[14px] font-black" style={hbInputStyle}>¥{COMPANY_FOUND_COST}</div></div>
                    </div>
                    <div className="flex gap-2 overflow-x-auto no-scrollbar">
                        {COMPANY_DIRECTIONS.map(d => <button key={d} onClick={() => setCompanyDirection(d)} className="shrink-0 px-3 py-1.5 text-[12px] font-bold press-soft" style={chipStyle(companyDirection === d)}>{d}</button>)}
                    </div>
                    <button onClick={handleFoundCompany} className="w-full py-2.5 text-[14px] font-black active:scale-95 transition-transform" style={smallBtn('#8b5cf6')}>投入 ¥{COMPANY_FOUND_COST}</button>
                </PaperCard>
            ) : (
                <>
                    <PaperCard className="p-4">
                        <div className="flex justify-between gap-3">
                            <div className="min-w-0">
                                <div className="text-[20px] font-black truncate" style={{ color: INK, fontFamily: HAND_FONT }}>{life.company.name}</div>
                                <div className="text-[11px]" style={{ color: INK_SOFT }}>{life.company.direction} · 员工 {life.company.employees}</div>
                            </div>
                            <button onClick={handleCompanyDividend} className="px-3 py-2 text-[12px] font-black active:scale-95 transition-transform" style={smallBtn('#16a34a')}>分红</button>
                        </div>
                        <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                            <div className="rounded-2xl py-2" style={{ background: '#faf8f5' }}><div className="text-[15px] font-black">¥{Math.round(life.company.cash)}</div><div className="text-[10px]" style={{ color: INK_SOFT }}>现金</div></div>
                            <div className="rounded-2xl py-2" style={{ background: '#faf8f5' }}><div className="text-[15px] font-black">{life.company.reputation}</div><div className="text-[10px]" style={{ color: INK_SOFT }}>声誉</div></div>
                            <div className="rounded-2xl py-2" style={{ background: '#faf8f5' }}><div className="text-[15px] font-black">{life.company.stress}</div><div className="text-[10px]" style={{ color: INK_SOFT }}>压力</div></div>
                        </div>
                    </PaperCard>
                    {life.company.pendingIssue && (
                        <PaperCard className="p-4 space-y-3">
                            <SectionTag en={life.company.pendingIssue.kind || 'issue'}>{life.company.pendingIssue.title}</SectionTag>
                            <p className="text-[12px] leading-relaxed" style={{ color: '#4a4750' }}>{life.company.pendingIssue.description}</p>
                            <div className="grid grid-cols-2 gap-2">
                                {life.company.pendingIssue.options.map(opt => <button key={opt.id} onClick={() => handleCompanyIssue(opt.id)} className="py-2 text-[12px] font-black active:scale-95 transition-transform" style={smallBtn(opt.cashDelta >= 0 ? '#16a34a' : '#f43f5e')}>{opt.label}</button>)}
                            </div>
                        </PaperCard>
                    )}
                    <PaperCard className="p-4">
                        <SectionTag en="orders">订单池</SectionTag>
                        <div className="space-y-2 mt-3">
                            {(life.company.orders || []).slice(0, 5).map(order => (
                                <div key={order.id} className="rounded-2xl px-3 py-2 text-[12px] flex justify-between gap-2" style={{ background: '#faf8f5' }}>
                                    <div className="min-w-0"><b className="truncate block">{order.title}</b><span style={{ color: INK_SOFT }}>{order.client} · 难度 {order.difficulty}/5</span></div>
                                    <div className="text-right shrink-0"><b>¥{order.value}</b><div style={{ color: INK_SOFT }}>{order.status}</div></div>
                                </div>
                            ))}
                            {!(life.company.orders || []).length && <div className="text-[12px] rounded-2xl p-3" style={{ background: '#faf8f5', color: INK_SOFT }}>今天先把手头事理顺，订单会慢慢找上门。</div>}
                        </div>
                    </PaperCard>
                    <PaperCard className="p-4">
                        <SectionTag en="cashflow">现金流</SectionTag>
                        <div className="space-y-2 mt-3">
                            {(life.company.cashflow || []).slice(0, 5).map((flow, idx) => (
                                <div key={`${flow.dateStr}-${idx}`} className="flex justify-between gap-2 text-[12px] border-b last:border-0 py-2" style={{ borderColor: 'rgba(43,41,51,0.06)' }}>
                                    <span className="truncate">{flow.note} · {flow.dateStr}</span>
                                    <b style={{ color: flow.profit >= 0 ? '#16a34a' : '#e11d48' }}>{flow.profit >= 0 ? '+' : '-'}¥{Math.abs(flow.profit)}</b>
                                </div>
                            ))}
                        </div>
                    </PaperCard>
                </>
            )}
        </div>
    );

    const renderLoans = () => {
        const product = LOAN_PRODUCTS[loanChannel];
        return (
            <div className="flex-1 overflow-y-auto no-scrollbar px-3.5 pt-3 pb-4 space-y-4">
                <div className="grid grid-cols-3 gap-2">
                    {(['bank', 'formal', 'shady'] as BankLoanChannel[]).map(ch => {
                        const p = LOAN_PRODUCTS[ch];
                        return <button key={ch} onClick={() => setLoanChannel(ch)} className="p-3 text-left press-soft" style={{ ...cleanCardStyle, borderColor: loanChannel === ch ? '#f43f5e' : 'rgba(43,41,51,0.06)' }}>
                            <div className="text-[13px] font-black truncate" style={{ color: INK }}>{channelLabel(ch)}</div>
                            <div className="text-[10px]" style={{ color: INK_SOFT }}>{p.dailyRate < 0.001 ? '低息' : p.dailyRate < 0.002 ? '灵活' : '高风险'}</div>
                        </button>;
                    })}
                </div>
                <PaperCard className="p-4 space-y-3">
                    <SectionTag en="contract">{product.name}</SectionTag>
                    <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="rounded-2xl py-2" style={{ background: '#faf8f5' }}><div className="text-[13px] font-black">¥{product.min}-{product.max}</div><div className="text-[10px]" style={{ color: INK_SOFT }}>额度</div></div>
                        <div className="rounded-2xl py-2" style={{ background: '#faf8f5' }}><div className="text-[13px] font-black">{(product.dailyRate * 100).toFixed(3)}%</div><div className="text-[10px]" style={{ color: INK_SOFT }}>日息</div></div>
                        <div className="rounded-2xl py-2" style={{ background: '#faf8f5' }}><div className="text-[13px] font-black">{product.days}天</div><div className="text-[10px]" style={{ color: INK_SOFT }}>期限</div></div>
                    </div>
                    <div className="rounded-2xl px-3 py-2 text-[12px]" style={{ background: '#faf8f5', color: '#4a4750' }}>{product.review}</div>
                    <div className="flex flex-wrap gap-1.5">{product.terms.map(term => <CleanBadge key={term} tone={loanChannel === 'shady' ? 'red' : 'default'}>{term}</CleanBadge>)}</div>
                    <div className="flex gap-2">
                        <input type="number" value={loanAmount} onChange={e => setLoanAmount(e.target.value)} className="flex-1 px-3 py-2 outline-none" style={hbInputStyle} />
                        <button onClick={handleBorrowLoan} className="px-4 text-[13px] font-black active:scale-95 transition-transform" style={smallBtn('#f43f5e')}>申请</button>
                    </div>
                </PaperCard>
                {selectedLoan && (
                    <PaperCard className="p-4 space-y-3">
                        <SectionTag en="repay">还款计划</SectionTag>
                        <div className="flex justify-between gap-3">
                            <div>
                                <div className="font-black" style={{ color: INK }}>{selectedLoan.note}</div>
                                <div className="text-[11px]" style={{ color: INK_SOFT }}>到期 {selectedLoan.dueDate} · 逾期 {selectedLoan.overdueDays} 天</div>
                            </div>
                            <div className="text-right"><div className="font-black" style={{ color: '#e11d48' }}>{fmt(selectedLoan.outstanding + selectedLoan.interestDue)}</div><div className="text-[10px]" style={{ color: INK_SOFT }}>含息 {fmt(selectedLoan.interestDue)}</div></div>
                        </div>
                        {(selectedLoan.repaymentPlan || []).map((p, idx) => (
                            <div key={`${p.dueDate}-${idx}`} className="rounded-2xl px-3 py-2 flex justify-between text-[12px]" style={{ background: '#faf8f5' }}>
                                <span>{p.dueDate}</span><span>{fmt(p.amount)} · {p.status === 'paid' ? '已还' : p.status === 'overdue' ? '逾期' : '待还'}</span>
                            </div>
                        ))}
                        <div className="flex gap-2">
                            <input type="number" value={loanRepayAmount[selectedLoan.id] || ''} onChange={e => setLoanRepayAmount(prev => ({ ...prev, [selectedLoan.id]: e.target.value }))} placeholder="还款金额" className="flex-1 px-3 py-2 outline-none" style={hbInputStyle} />
                            <button onClick={() => handleRepayLoan(selectedLoan.id)} className="px-4 text-[13px] font-black active:scale-95 transition-transform" style={smallBtn('#16a34a')}>还款</button>
                        </div>
                    </PaperCard>
                )}
                <div className="grid gap-2">
                    {life.loans.map(loan => (
                        <button key={loan.id} onClick={() => setSelectedLoanId(loan.id)} className="p-3 text-left press-soft" style={{ ...cleanCardStyle, borderColor: selectedLoan?.id === loan.id ? '#f43f5e' : 'rgba(43,41,51,0.06)' }}>
                            <div className="flex justify-between gap-3 text-[12px]">
                                <div className="min-w-0"><b className="truncate block">{loan.note}</b><span style={{ color: INK_SOFT }}>{channelLabel(loan.channel)} · {loan.dueDate}</span></div>
                                <b className="shrink-0" style={{ color: '#e11d48' }}>{fmt(loan.outstanding + loan.interestDue)}</b>
                            </div>
                        </button>
                    ))}
                </div>
            </div>
        );
    };

    const renderShop = () => {
        const tpl = BUSINESS_TEMPLATES.find(b => b.id === life.shopBusinessType) || selectedBusiness || BUSINESS_TEMPLATES[0];
        if (!life.shopUnlocked) {
            return (
                <div className="flex-1 overflow-y-auto no-scrollbar px-3.5 pt-3 pb-4 space-y-4">
                    <PaperCard className="p-4 space-y-4">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <div className="text-[22px] font-black" style={{ color: INK, fontFamily: HAND_FONT }}>选择你的第一间店</div>
                                <div className="text-[12px] mt-1" style={{ color: INK_SOFT }}>准备开业资金 ¥{SHOP_UNLOCK_COST}</div>
                            </div>
                            <div className="w-14 h-14 rounded-[18px] flex items-center justify-center text-[26px]" style={{ background: '#faf8f5', border: '1px solid rgba(43,41,51,0.06)' }}>{selectedBusiness.icon}</div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            {BUSINESS_TEMPLATES.map(b => (
                                <button key={b.id} onClick={() => setSelectedBusinessType(b.id)} className="p-3 text-left press-soft" style={{ ...cleanCardStyle, borderColor: selectedBusinessType === b.id ? '#f43f5e' : 'rgba(43,41,51,0.06)' }}>
                                    <div className="flex items-center gap-2">
                                        <span className="w-9 h-9 rounded-2xl flex items-center justify-center text-[20px]" style={{ background: '#faf8f5' }}>{b.icon}</span>
                                        <div className="min-w-0">
                                            <div className="text-[13px] font-black truncate" style={{ color: INK }}>{b.name}</div>
                                            <div className="text-[10px]" style={{ color: INK_SOFT }}>毛利 {Math.round(b.margin * 100)}% · 风险 {b.risk}/5</div>
                                        </div>
                                    </div>
                                </button>
                            ))}
                        </div>
                        <div className="grid grid-cols-2 gap-2 max-[420px]:grid-cols-1">
                            <div>
                                <FieldLabel>店铺名字</FieldLabel>
                                <input value={newShopName} onChange={e => setNewShopName(e.target.value)} placeholder={`${selectedBusiness.name}小店`} className="w-full px-3 py-2 outline-none" style={hbInputStyle} />
                            </div>
                            <div>
                                <FieldLabel>钱包余额</FieldLabel>
                                <div className="px-3 py-2 text-[14px] font-black" style={hbInputStyle}>¥{Math.round(userProfile.balance || 0)}</div>
                            </div>
                        </div>
                        <div className="rounded-2xl p-3 text-[12px] leading-relaxed" style={{ background: '#faf8f5', color: '#4a4750' }}>
                            <b>{selectedBusiness.name}</b> · {selectedBusiness.vibe}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            {selectedBusiness.products.map(p => <CleanBadge key={p.id} tone="default">{p.name} ¥{p.price}</CleanBadge>)}
                        </div>
                        <button onClick={handleUnlockLifeShop} className="w-full py-3 text-[15px] font-black active:scale-95 transition-transform" style={smallBtn('#f43f5e')}>
                            投入 ¥{SHOP_UNLOCK_COST} 开始营业
                        </button>
                    </PaperCard>
                </div>
            );
        }

        const products = life.shopProducts?.length ? life.shopProducts : tpl.products.map(p => ({ ...p, stock: 8 }));
        return (
            <div className="flex-1 overflow-hidden flex flex-col">
                <div className="px-3.5 pt-3 shrink-0">
                    <PaperCard className="p-3">
                        <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0 flex items-center gap-3">
                                <span className="w-12 h-12 rounded-[18px] flex items-center justify-center text-[24px]" style={{ background: '#faf8f5' }}>{tpl.icon}</span>
                                <div className="min-w-0">
                                    <div className="text-[18px] font-black truncate" style={{ color: INK, fontFamily: HAND_FONT }}>{life.shopBusinessName || state.shop.shopName || tpl.name}</div>
                                    <div className="text-[11px] truncate" style={{ color: INK_SOFT }}>{tpl.name} · Lv.{state.shop.shopLevel || 1} · 口碑 {state.shop.reviews?.length || 0} 条</div>
                                </div>
                            </div>
                            <button onClick={handleOperate} className="px-4 py-2 text-[12px] font-black active:scale-95 transition-transform" style={smallBtn('#16a34a')}>营业</button>
                        </div>
                    </PaperCard>
                    <div className="flex gap-2 pt-2 pb-2">
                        {([['game', '店铺现场'], ['manage', '经营打理']] as const).map(([k, label]) => (
                            <button key={k} onClick={() => setShopView(k)} className="flex-1 py-2 text-[13px] font-black active:scale-95 transition-transform" style={chipStyle(shopView === k)}>
                                {label}
                            </button>
                        ))}
                    </div>
                </div>
                {shopView === 'game' ? (
                    <div className="flex-1 overflow-hidden relative">
                        {isBankDataLoaded ? (
                            <BankDollhouse
                                shopState={state.shop}
                                dollhouseState={dollhouseState}
                                onDollhouseChange={async (updater) => { await persistDollhouseUpdate(updater); }}
                                characters={characters}
                                userProfile={userProfile}
                                apiConfig={auxApi}
                                updateState={async (updater) => {
                                    const nextState = { ...stateRef.current, shop: updater(stateRef.current.shop) };
                                    stateRef.current = nextState;
                                    setState(nextState);
                                    await DB.saveBankState(nextState);
                                }}
                                onStaffClick={handleOpenStaffEdit}
                                onOpenGuestbook={() => setShowGuestbook(true)}
                                onWipeCounter={handleWipeCounter}
                            />
                        ) : <div className="flex-1 flex items-center justify-center text-sm" style={{ color: INK_SOFT }}>加载店铺中...</div>}
                        {(() => {
                            const rv = state.shop.reviews || [];
                            const avg = rv.length ? Math.round((rv.reduce((s, r) => s + r.rating, 0) / rv.length) * 10) / 10 : 0;
                            return (
                                <button onClick={() => setShowReviews(true)} className="absolute left-3 bottom-3 z-40 flex items-center gap-1.5 px-3 py-2 rounded-full active:scale-95 transition-all" style={{ background: 'rgba(255,255,255,0.95)', boxShadow: '0 8px 20px -12px rgba(38,38,38,0.42)' }}>
                                    <span className="text-[12px] font-black" style={{ color: INK }}>{avg || '口碑'}</span>
                                    <span className="text-[10px]" style={{ color: INK_SOFT }}>{rv.length ? `${rv.length} 条` : '看看'}</span>
                                </button>
                            );
                        })()}
                        {(() => {
                            const regs = Object.values(state.shop.regulars || {});
                            const regN = regs.filter(r => r.visits >= REGULAR_VISITS).length;
                            return (
                                <button onClick={() => setShowRegulars(true)} className="absolute left-3 bottom-[58px] z-40 flex items-center gap-1.5 px-3 py-2 rounded-full active:scale-95 transition-all" style={{ background: 'rgba(255,255,255,0.95)', boxShadow: '0 8px 20px -12px rgba(38,38,38,0.42)' }}>
                                    <span className="text-[12px] font-black" style={{ color: INK }}>{regN || '常客'}</span>
                                    <span className="text-[10px]" style={{ color: INK_SOFT }}>名册</span>
                                </button>
                            );
                        })()}
                        {(() => {
                            const pending = Math.floor(state.shop.pendingRevenue || 0);
                            if (pending < 1) return null;
                            const full = pending >= idleCapNow(state.shop);
                            return (
                                <button onClick={handleCollectIdle} className="absolute left-1/2 -translate-x-1/2 bottom-[60px] z-40 flex items-center gap-1.5 px-3.5 py-2 rounded-full active:scale-95 transition-transform animate-bounce" style={{ background: 'linear-gradient(135deg,#ffe08a,#f3b24a)', boxShadow: '0 6px 16px rgba(220,160,40,0.45)' }}>
                                    <span className="text-[13px] font-black" style={{ color: '#7a5212' }}>收 {state.config.currencySymbol}{pending}</span>
                                    {full && <span className="text-[9px] font-bold px-1 py-0.5 rounded-full" style={{ background: '#fff6e0', color: '#b9772a' }}>满</span>}
                                </button>
                            );
                        })()}
                        {(() => {
                            const w = getWeatherDef(state.shop.weather?.id);
                            return (
                                <div className="absolute right-3 bottom-3 z-40 flex items-center gap-1.5 px-3 py-2 rounded-full" style={{ background: 'rgba(255,255,255,0.95)', boxShadow: '0 8px 20px -12px rgba(38,38,38,0.42)' }} title={w.note}>
                                    <span className="text-sm">{w.emoji}</span>
                                    <span className="text-[12px] font-black" style={{ color: INK }}>{w.label}</span>
                                </div>
                            );
                        })()}
                    </div>
                ) : (
                    <div className="flex-1 overflow-y-auto no-scrollbar px-3.5 pb-4 space-y-3">
                        <PaperCard className="p-4">
                            <SectionTag en="goods">今日货架</SectionTag>
                            <div className="grid grid-cols-2 gap-2 mt-3">
                                {products.map(p => (
                                    <div key={p.id} className="rounded-2xl p-3 text-[12px]" style={{ background: '#faf8f5' }}>
                                        <div className="font-black truncate" style={{ color: INK }}>{p.name}</div>
                                        <div className="mt-1 flex justify-between" style={{ color: INK_SOFT }}><span>售价 ¥{p.price}</span><span>库存 {p.stock}</span></div>
                                        <button onClick={() => handleRestockLifeProduct(p.id)} className="mt-2 w-full py-1.5 text-[11px] font-black active:scale-95 transition-transform" style={chipStyle(false)}>
                                            补货 · 约 ¥{Math.max(1, Math.round(p.cost * RESTOCK_BATCH))}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </PaperCard>
                        <PaperCard className="p-4">
                            <SectionTag en="crowd">客群和动向</SectionTag>
                            <div className="flex flex-wrap gap-1.5 mt-3">
                                {(life.shopCustomers?.length ? life.shopCustomers : tpl.customerGroups).map(c => <CleanBadge key={c} tone="blue">{c}</CleanBadge>)}
                            </div>
                            <div className="space-y-2 mt-3">
                                {(life.shopEvents?.length ? life.shopEvents : tpl.events.map((detail, idx) => ({ id: `shop-event-${idx}`, dateStr: life.dateStr, title: '店里动向', detail }))).slice(0, 3).map(ev => (
                                    <div key={ev.id} className="rounded-2xl p-3 text-[12px]" style={{ background: '#faf8f5', color: '#4a4750' }}>
                                        <b>{ev.title}</b><div>{ev.detail}</div>
                                    </div>
                                ))}
                            </div>
                        </PaperCard>
                        <PaperCard className="p-4">
                            <div className="flex justify-between items-center gap-3">
                                <div>
                                    <div className="text-[15px] font-black" style={{ color: INK }}>店铺等级</div>
                                    <div className="text-[11px]" style={{ color: INK_SOFT }}>Lv.{state.shop.shopLevel || 1} · 客流、价格和挂机收入会跟着成长</div>
                                </div>
                                <button onClick={handleUpgradeShop} className="px-3 py-2 text-[12px] font-black active:scale-95 transition-transform" style={smallBtn('#16a34a')}>
                                    升级
                                </button>
                            </div>
                        </PaperCard>
                        <BankGameMenu
                            state={state}
                            characters={characters}
                            walletBalance={Math.round(userProfile.balance || 0)}
                            onUnlockRecipe={handleUnlockRecipe}
                            onRestock={handleRestock}
                            onHireStaff={handleHireStaff}
                            onStaffRest={handleStaffRest}
                            onFireStaff={handleFireStaff}
                            onRehireStaff={handleRehireStaff}
                            onDeleteFiredStaff={handleDeleteFiredStaff}
                            onUpdateConfig={handleConfigUpdate}
                            onAddGoal={() => setShowGoalModal(true)}
                            onDeleteGoal={async (id) => { await persistStateUpdate(prev => ({ ...prev, goals: prev.goals.filter(g => g.id !== id) })); }}
                            onEditStaff={handleOpenStaffEdit}
                        />
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="h-full w-full flex flex-col relative overflow-hidden" style={{ background: PAGE_BG, color: INK }}>
            <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-64 z-0" style={{ background: 'radial-gradient(120% 90% at 50% -28%, rgba(244,63,94,0.10), transparent 70%)' }} />

            <div className="relative shrink-0 z-[50] px-3.5 pt-[calc(env(safe-area-inset-top)+0.65rem)] pb-2.5">
                <div className="flex items-center gap-2.5 rounded-[26px] bg-white px-2.5 py-2.5" style={{ border: '1px solid rgba(43,41,51,0.06)', boxShadow: '0 1px 2px rgba(38,38,38,0.04), 0 18px 40px -28px rgba(38,38,38,0.35)' }}>
                        <button
                            onClick={closeApp}
                            className="w-9 h-9 rounded-full flex items-center justify-center text-[18px] font-bold active:scale-90 transition-transform shrink-0"
                            style={{ background: '#faf8f5', color: INK, border: '1px solid rgba(43,41,51,0.06)' }}
                        >
                            ‹
                        </button>
                        <span className="w-10 h-10 rounded-[14px] flex items-center justify-center text-[18px] font-black shrink-0" style={{ background: '#ffe4e6', color: '#be123c' }}>¥</span>
                        <div className="min-w-0 flex-1">
                            <div className="flex items-baseline gap-2">
                                <span className="text-[18px] font-black truncate" style={{ color: INK, fontFamily: HAND_FONT }}>生活拟</span>
                                <span className="text-[8px] tracking-[0.28em] uppercase shrink-0" style={{ color: '#f43f5e', fontFamily: 'var(--font-label)' }}>life gram</span>
                            </div>
                            <div className="flex items-center gap-1.5 mt-0.5 min-w-0 text-[10.5px]" style={{ color: INK_SOFT }}>
                                <span>{life.dateStr}</span>
                                <span>·</span>
                                <span className="truncate">钱包 ¥{Math.round(userProfile.balance || 0)}</span>
                                <span>·</span>
                                <span className="truncate">净资产 ¥{netWorth}</span>
                            </div>
                        </div>
                        <button
                            onClick={handleOperate}
                            disabled={!life.shopUnlocked}
                            className="hidden sm:inline-flex px-3 py-2 text-[12px] font-black active:scale-95 transition-transform items-center gap-1 disabled:opacity-50"
                            style={smallBtn(life.shopUnlocked ? '#16a34a' : '#e5e7eb', life.shopUnlocked ? '#fff' : INK_SOFT)}
                        >
                            营业
                        </button>
                        <button
                            onClick={() => setShowAddTxModal(true)}
                            className="px-3 py-2 text-[12px] font-black active:scale-95 transition-transform inline-flex items-center gap-1 shrink-0"
                            style={smallBtn('#f43f5e')}
                        >
                            记账
                        </button>
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 overflow-hidden relative z-10 flex flex-col">
                {activeTab === 'life' && renderLifeHome()}
                {activeTab === 'jobs' && renderJobs()}
                {activeTab === 'shop' && renderShop()}
                {activeTab === 'invest' && renderInvest()}
                {activeTab === 'company' && renderCompany()}
                {activeTab === 'loans' && renderLoans()}
                {activeTab === 'report' && (
                    <div className="flex-1 overflow-y-auto no-scrollbar flex flex-col">
                        <div className="flex gap-2 px-3.5 pt-3 shrink-0">
                            {([['analytics', '账目分析'], ['ledger', '互评账本']] as const).map(([k, label]) => (
                                <button key={k} onClick={() => setReportView(k)} className="flex-1 py-2 text-[13px] font-black active:scale-95 transition-transform"
                                    style={chipStyle(reportView === k)}>
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
                                apiConfig={auxApi}
                                dailyBudget={state.config.dailyBudget}
                            />
                        ) : (
                            <BankLedger
                                transactions={transactions}
                                onTxUpdated={handleTxUpdated}
                                characters={characters}
                                apiConfig={auxApi}
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

            <div className="shrink-0 z-30 px-2.5 pt-2 relative" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 10px)' }}>
                <div className="grid grid-cols-7 gap-1 rounded-[26px] bg-white p-1.5" style={{ border: '1px solid rgba(43,41,51,0.06)', boxShadow: '0 -8px 30px -24px rgba(38,38,38,0.45), 0 1px 2px rgba(38,38,38,0.04)' }}>
                    {[
                        { key: 'life', label: '人生', emoji: '📆' },
                        { key: 'jobs', label: '求职', emoji: '💼' },
                        { key: 'shop', label: '经营', emoji: '🏠' },
                        { key: 'invest', label: '投资', emoji: '📈' },
                        { key: 'company', label: '公司', emoji: '🏢' },
                        { key: 'loans', label: '借款', emoji: '💳' },
                        { key: 'report', label: '账本', emoji: '📖' },
                    ].map((tab, i) => {
                        const on = activeTab === tab.key;
                        return (
                            <button key={tab.key} onClick={() => setActiveTab(tab.key as any)} className="relative flex flex-col items-center justify-center min-w-0 py-1.5 active:scale-95 transition-transform" style={{ background: on ? INK : 'transparent', color: on ? '#fff' : INK_SOFT, borderRadius: 18 }}>
                                {tab.key === 'shop' && hasLowStock && life.shopUnlocked && <span aria-hidden className="absolute w-2 h-2 rounded-full animate-pulse" style={{ top: 5, right: 8, background: '#f43f5e', boxShadow: '0 0 0 2px #fff' }} />}
                                <span className="text-[15px] leading-none mb-0.5" style={{ filter: on ? 'none' : 'grayscale(0.25) opacity(0.75)' }}>{tab.emoji}</span>
                                <span className="text-[9.5px] font-black leading-none truncate max-w-full" style={{ fontFamily: HAND_FONT }}>{tab.label}</span>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* 记账弹窗 */}
            <HbModal open={showAddTxModal} onClose={() => setShowAddTxModal(false)} title="记一笔现实账" sub="进账还是支出，写下来，角色会看见"
                footer={
                    <button onClick={handleAddTransaction} className="w-full py-3.5 text-[16px] font-black active:scale-[0.98] transition-transform" style={{ background: '#b1543f', color: '#fff7ef', borderRadius: 14, fontFamily: HAND_FONT, letterSpacing: 1 }}>
                        记下这笔
                    </button>
                }>
                <div className="space-y-4">
                    <div>
                        <FieldLabel>是进是出</FieldLabel>
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
                        <FieldLabel>多少钱</FieldLabel>
                        <div className="relative mt-2">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[18px] font-black" style={{ color: '#a98e6f' }}>{state.config.currencySymbol}</span>
                            <input type="number" value={txAmount} onChange={e => setTxAmount(e.target.value)} placeholder="0.00" className="w-full pl-10 pr-4 py-3.5 text-[24px] font-black focus:outline-none" style={{ ...hbInputStyle, fontFamily: HAND_FONT }} />
                        </div>
                    </div>
                    <div>
                        <FieldLabel>记点什么</FieldLabel>
                        <input value={txNote} onChange={e => setTxNote(e.target.value)} placeholder={txType === 'income' ? '这笔钱哪来的？' : '钱花哪了？'} className="w-full px-4 py-3 text-[15px] focus:outline-none mt-2" style={{ ...hbInputStyle, fontFamily: HAND_FONT }} />
                    </div>
                </div>
            </HbModal>

            {/* 攒钱心愿弹窗 */}
            <HbModal open={showGoalModal} onClose={() => setShowGoalModal(false)} title="立一个攒钱心愿" sub="想买什么、要攒多少，写下来"
                footer={
                    <button onClick={handleAddGoal} className="w-full py-3.5 text-[16px] font-black active:scale-[0.98] transition-transform" style={{ background: '#3f8a6b', color: '#fff7ef', borderRadius: 14, fontFamily: HAND_FONT, letterSpacing: 1 }}>
                        存好心愿
                    </button>
                }>
                <div className="space-y-4">
                    <div>
                        <FieldLabel>想要什么</FieldLabel>
                        <input value={goalName} onChange={e => setGoalName(e.target.value)} placeholder="比如：一台 Switch" className="w-full px-4 py-3 text-[15px] focus:outline-none mt-2" style={{ ...hbInputStyle, fontFamily: HAND_FONT }} />
                    </div>
                    <div>
                        <FieldLabel>要攒多少</FieldLabel>
                        <div className="relative mt-2">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[18px] font-black" style={{ color: '#a98e6f' }}>{state.config.currencySymbol}</span>
                            <input type="number" value={goalTarget} onChange={e => setGoalTarget(e.target.value)} placeholder="2000" className="w-full pl-10 pr-4 py-3.5 text-[24px] font-black focus:outline-none" style={{ ...hbInputStyle, fontFamily: HAND_FONT }} />
                        </div>
                    </div>
                </div>
            </HbModal>

            {/* 店员档案弹窗 */}
            <HbModal open={showStaffEdit} onClose={() => { setShowStaffEdit(false); setEditingStaff(null); }} title="店员小档案" sub="改个名字、写句性格备注"
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
                                <CleanBadge>{editingStaff.role === 'manager' ? '经理' : editingStaff.role === 'chef' ? '主厨' : '服务员'}</CleanBadge>
                            </div>
                        </div>
                        <div>
                            <FieldLabel>性格 / 备注</FieldLabel>
                            <input value={editingStaff.personality || ''} onChange={e => setEditingStaff({ ...editingStaff, personality: e.target.value })} placeholder="懒洋洋的，爱晒太阳" className="w-full px-4 py-3 text-[14px] focus:outline-none mt-2" style={{ ...hbInputStyle, fontFamily: HAND_FONT }} />
                        </div>
                    </div>
                )}
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

            {/* 常客名册 */}
            {showRegulars && (
                <RegularsOverlay regulars={state.shop.regulars || {}} onClose={() => setShowRegulars(false)} />
            )}

        </div>
    );
};

export default BankApp;

