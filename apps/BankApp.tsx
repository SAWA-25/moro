
import React, { useState, useEffect, useRef } from 'react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { BankFullState, BankTransaction, SavingsGoal, ShopStaff, BankGuestbookItem, DollhouseState, BankDollhousesByShopId, ShopReview, ShopRegular, BankJobPosting, BankLoanChannel, BankStockQuote, BankResumeProfile, BankLifeActionRecord, BankLifeActionResult, BankLifeActionTone } from '../types';
import { extractContent } from '../utils/safeApi';
import { resolveAuxApi } from '../utils/auxApi';
import { injectMemoryPalace } from '../utils/memoryPalace/pipeline';
import { callChatCompletion } from '../utils/llmClient';
import { makeApiUsageMeta } from '../utils/apiUsageCatalog';
import BankShopScene from '../components/bank/BankShopScene';
import BankDollhouse from '../components/bank/BankDollhouse';
import BankGameMenu from '../components/bank/BankGameMenu';
import BankAnalytics from '../components/bank/BankAnalytics';
import BankLedger from '../components/bank/BankLedger';
import BankJobCenter from '../components/bank/BankJobCenter';
import { BusinessResultModal, ReviewsOverlay, RegularsOverlay, BusinessResult } from '../components/bank/BankBusiness';
import { BankActionHistoryDrawer, BankActionResultModal, BankActionResultView, BankBadge, BankMetricGrid, BankModal, bankModalInputStyle } from '../components/bank/BankModalKit';
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
    BANK_OPEN_BRANCH_ENERGY_COST,
    BUSINESS_TEMPLATES,
    COMPANY_DIRECTIONS,
    COMPANY_FOUND_COST,
    JOB_CATEGORIES,
    JOB_POSTINGS,
    LOAN_PRODUCTS,
    createDefaultBankLifeState,
    advanceJobApplicationStageWithAi,
    appendBankActionRecord,
    advanceBankLifeDay,
    appendJobChatMessage,
    applyMarketPulses,
    applyCompanyIssue,
    applyCompanyIssueWithResult,
    borrowLoan,
    buildLifeSuggestions,
    claimBankShopDailyReward,
    computeCreditProfile,
    createBankActionResult,
    buyStock,
    channelLabel,
    declineJobApplication,
    foundCompany,
    leaveJob,
    loanTotal,
    mergeAiJobPostings,
    migrateBankLifeState,
    movingAverage,
    getDefaultBankBranchName,
    openBankShopBranch,
    openLifeShop,
    repayLoan,
    sellStock,
    SHOP_UNLOCK_COST,
    startJobApplication,
    switchActiveBankShop,
    stockMarketValue,
    syncActiveBranchFromMirror,
    syncActiveShopMirror,
    updateResumeProfile,
    withdrawCompanyDividend,
} from '../utils/bankLife';
import {
    generateAiBankActionDraft,
    generateAiCompanyActionDraft,
    generateAiDashboardInsight,
    generateAiInvestAdvice,
    generateAiJobs,
    generateAiJobStageDecision,
    generateAiLifeDay,
    generateAiLoanReview,
    generateAiMarketPulse,
    generateAiRecruiterReply,
    generateAiResumeReview,
    generateAiShopActionDraft,
    generateAiStockOrderDraft,
    generateAiLedgerInsight,
} from '../utils/bankLifeAi';

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
    life: createDefaultBankLifeState(new Date().toISOString().split('T')[0], false),
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
const BUSINESS_ENERGY_COST = 12;

const cloneDollhouseState = (state: DollhouseState): DollhouseState => ({
    ...state,
    rooms: (state.rooms || []).map(room => ({
        ...room,
        stickers: [...(room.stickers || [])],
    })),
});

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

const shopEnergyText = (value: number) => `${value} 点店员精力`;

const buildLocalGuestbookEntries = (
    shopName: string,
    char?: { id: string; name: string; avatar?: string }
): BankGuestbookItem[] => {
    const now = Date.now();
    const npcPool = [
        ['附近住户', `路过${shopName || '这家店'}，橱窗收拾得很清爽。`],
        ['回头客', '今天的服务比上次更顺，愿意再来一次。'],
        ['夜班客人', '打烊前还能买到东西，救了我一命。'],
        ['挑剔顾客', '货架可以再补快一点，想买的东西差点没了。'],
        ['慢悠悠的客人', '店里气氛不错，适合发会儿呆。'],
    ];
    const shuffled = [...npcPool].sort(() => Math.random() - 0.5).slice(0, 3);
    const entries: BankGuestbookItem[] = shuffled.map(([authorName, content], idx) => ({
        id: `gb-local-${now}-${idx}-${Math.random().toString(36).slice(2, 5)}`,
        authorName,
        content,
        isChar: false,
        timestamp: now - idx * 1000,
    }));
    if (char) {
        entries.unshift({
            id: `gb-local-char-${now}-${Math.random().toString(36).slice(2, 5)}`,
            authorName: char.name,
            content: `来${shopName || '店里'}看了看，感觉你真的在认真把日子经营起来。`,
            isChar: true,
            charId: char.id,
            avatar: char.avatar,
            timestamp: now,
        });
    }
    return entries;
};

const HbModal: React.FC<{
    open: boolean; onClose: () => void; title: string; sub?: string;
    footer?: React.ReactNode; children: React.ReactNode;
}> = ({ open, onClose, title, sub, footer, children }) => {
    return (
        <BankModal open={open} onClose={onClose} title={title} sub={sub} footer={footer}>
            {children}
        </BankModal>
    );
};

type BankImmersiveModal =
    | { kind: 'history' }
    | { kind: 'actionResult'; result: BankLifeActionResult }
    | { kind: 'eventDetail'; eventId: string }
    | { kind: 'transactionDetail'; txId: string }
    | { kind: 'goalDetail'; goalId: string }
    | { kind: 'dashboardInsight' }
    | { kind: 'shopUnlock' }
    | { kind: 'shopRestock'; productId: string }
    | { kind: 'shopUpgrade' }
    | { kind: 'stockDetail'; symbol: string }
    | { kind: 'stockOrder'; side: 'buy' | 'sell'; symbol: string }
    | { kind: 'companyFound' }
    | { kind: 'companyIssue'; optionId: string }
    | { kind: 'companyDividend' }
    | { kind: 'loanProduct'; channel: BankLoanChannel }
    | { kind: 'loanApply' }
    | { kind: 'loanRepay'; loanId: string }
    | { kind: 'recordDetail'; record: BankLifeActionRecord };

const mergeActionAiDraft = (result: BankLifeActionResult, draft?: { summary?: string; tone?: BankLifeActionTone; riskTags?: string[]; suggestions?: string[]; metrics?: { label: string; value: string; tone?: BankLifeActionTone }[] }): BankLifeActionResult => {
    if (!draft) return result;
    return {
        ...result,
        tone: draft.tone || result.tone,
        aiSummary: draft.summary || result.aiSummary,
        riskTags: Array.from(new Set([...(result.riskTags || []), ...(draft.riskTags || [])])).slice(0, 8),
        nextActions: draft.suggestions?.length ? draft.suggestions : result.nextActions,
        metrics: draft.metrics?.length ? [...(result.metrics || []), ...draft.metrics].slice(0, 8) : result.metrics,
    };
};

const actionRecordToResult = (record: BankLifeActionRecord): BankLifeActionResult => ({
    id: record.id,
    category: record.category,
    kind: record.kind,
    title: record.title,
    summary: record.summary,
    tone: record.tone || 'info',
    amount: record.amount,
    riskTags: record.riskTags,
    aiSummary: record.aiSummary,
    metrics: record.metrics,
    payload: record.payload,
});

const BankApp: React.FC = () => {
    const { closeApp, characters, addToast, apiConfig, auxApiConfig, userProfile, adjustUserBalance } = useOS();
    // 回形针·银行属「聊天以外」的功能：走副 API（未配置副 API 时回退主 API）
    const auxApi = { ...apiConfig, ...resolveAuxApi(auxApiConfig, apiConfig) };
    const [state, setState] = useState<BankFullState>(INITIAL_STATE);
    const [transactions, setTransactions] = useState<BankTransaction[]>([]);
    const [dollhouseState, setDollhouseState] = useState<DollhouseState>(INITIAL_DOLLHOUSE);
    const [dollhousesByShopId, setDollhousesByShopId] = useState<BankDollhousesByShopId>({});
    const [isBankDataLoaded, setIsBankDataLoaded] = useState(false);

    // Refs to track latest state synchronously (React 18 batches setState,
    // so we can't rely on setState's updater callback running before DB.save)
    const stateRef = useRef<BankFullState>(INITIAL_STATE);
    const dollhouseRef = useRef<DollhouseState>(INITIAL_DOLLHOUSE);
    const dollhousesByShopIdRef = useRef<BankDollhousesByShopId>({});
    
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
    const [bankModal, setBankModal] = useState<BankImmersiveModal | null>(null);
    
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
    const [jobSearchQuery, setJobSearchQuery] = useState('');
    const [aiBusy, setAiBusy] = useState<'day' | 'jobs' | 'resume' | 'recruiter' | 'stage' | 'market' | 'loan' | 'dashboard' | 'shop' | 'invest' | 'company' | 'ledger' | null>(null);
    const [resumeDraft, setResumeDraft] = useState<Partial<BankResumeProfile>>({});
    const [selectedStockSymbol, setSelectedStockSymbol] = useState('MORO');
    const [marketView, setMarketView] = useState<'all' | 'watch' | 'gainers' | 'losers'>('all');
    const [selectedLoanId, setSelectedLoanId] = useState('');

    // Staff Edit Form
    const [editingStaff, setEditingStaff] = useState<ShopStaff | null>(null);
    const staffImageInputRef = useRef<HTMLInputElement>(null);

    // Guestbook Processing
    const [isRefreshingGuestbook, setIsRefreshingGuestbook] = useState(false);

    const normalizeBankStateForSave = (next: BankFullState): BankFullState =>
        syncActiveBranchFromMirror(migrateBankLifeState(next));

    const commitBankStateSync = (next: BankFullState): BankFullState => {
        const normalized = normalizeBankStateForSave(next);
        stateRef.current = normalized;
        setState(normalized);
        void DB.saveBankState(normalized);
        return normalized;
    };

    const commitBankState = async (next: BankFullState): Promise<BankFullState> => {
        const normalized = normalizeBankStateForSave(next);
        stateRef.current = normalized;
        setState(normalized);
        await DB.saveBankState(normalized);
        return normalized;
    };

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
                commitBankStateSync({ ...stateRef.current, todaySpent: (stateRef.current.todaySpent || 0) + tx.amount });
            }
        };
        window.addEventListener('moro-bank-transaction-added', onAutoTx as EventListener);
        return () => window.removeEventListener('moro-bank-transaction-added', onAutoTx as EventListener);
    }, []);

    // 挂机营业额累计 + 天气轮换：每 30s 折算待收金币、到点换天气（仅在有变化时落库）
    useEffect(() => {
        const t = window.setInterval(() => {
            const cur = syncActiveBranchFromMirror(migrateBankLifeState(stateRef.current));
            const portfolio = cur.shopPortfolio;
            if (!portfolio?.branches?.length) return;
            const now = Date.now();
            let changed = false;
            let activeWeatherToast: string | null = null;
            const branches = portfolio.branches.map(branch => {
                const weather = ensureWeather(branch.shop, now);
                const weatherChanged = weather.id !== branch.shop.weather?.id || weather.until !== branch.shop.weather?.until;
                const baseShop = weatherChanged ? { ...branch.shop, weather } : branch.shop;
                const idle = (baseShop.staff?.length || 0) > 0
                    ? accrueShopIdle(baseShop, now)
                    : { pendingRevenue: baseShop.pendingRevenue || 0, lastAccrualAt: baseShop.lastAccrualAt || now };
                const pendingChanged = idle.pendingRevenue !== Math.max(0, branch.shop.pendingRevenue || 0);
                if (!weatherChanged && !pendingChanged) return branch;
                changed = true;
                if (weatherChanged && branch.id === portfolio.activeShopId && branch.shop.weather) {
                    const w = getWeatherDef(weather.id);
                    activeWeatherToast = `${w.emoji} ${branch.shop.shopName} 天气转${w.label} —— ${w.note}`;
                }
                return { ...branch, shop: { ...baseShop, pendingRevenue: idle.pendingRevenue, lastAccrualAt: idle.lastAccrualAt } };
            });
            if (changed) {
                const ns = syncActiveShopMirror({ ...cur, shopPortfolio: { ...portfolio, branches } });
                commitBankStateSync(ns);
                if (activeWeatherToast) addToast(activeWeatherToast, 'info');
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
        return commitBankState(nextState);
    };

    const persistDollhouseUpdate = async (updater: DollhouseState | ((prev: DollhouseState) => DollhouseState)): Promise<DollhouseState> => {
        const nextDollhouse = typeof updater === 'function'
            ? (updater as (prev: DollhouseState) => DollhouseState)(dollhouseRef.current)
            : updater;
        const activeShopId = stateRef.current.shopPortfolio?.activeShopId;
        dollhouseRef.current = nextDollhouse;
        setDollhouseState(nextDollhouse);
        if (activeShopId) {
            const nextMap = { ...dollhousesByShopIdRef.current, [activeShopId]: nextDollhouse };
            dollhousesByShopIdRef.current = nextMap;
            setDollhousesByShopId(nextMap);
            await DB.saveBankDollhouses(nextMap);
        }
        await DB.saveBankDollhouse(nextDollhouse);
        return nextDollhouse;
    };

    const activateDollhouseForShop = async (shopId?: string): Promise<DollhouseState> => {
        const id = shopId || stateRef.current.shopPortfolio?.activeShopId;
        const nextDollhouse = id
            ? (dollhousesByShopIdRef.current[id] || cloneDollhouseState(INITIAL_DOLLHOUSE))
            : cloneDollhouseState(INITIAL_DOLLHOUSE);
        dollhouseRef.current = nextDollhouse;
        setDollhouseState(nextDollhouse);
        if (id && !dollhousesByShopIdRef.current[id]) {
            const nextMap = { ...dollhousesByShopIdRef.current, [id]: nextDollhouse };
            dollhousesByShopIdRef.current = nextMap;
            setDollhousesByShopId(nextMap);
            await DB.saveBankDollhouses(nextMap);
        }
        await DB.saveBankDollhouse(nextDollhouse);
        return nextDollhouse;
    };

    const showActionResult = (result?: BankLifeActionResult | null) => {
        if (result) setBankModal({ kind: 'actionResult', result });
    };

    const persistStandaloneActionResult = async (result: BankLifeActionResult) => {
        await persistStateUpdate(prev => {
            const withLife = migrateBankLifeState(prev);
            return { ...withLife, life: appendBankActionRecord(withLife.life!, result) };
        });
        showActionResult(result);
    };

    const syncActionHistoryResult = async (result: BankLifeActionResult) => {
        await persistStateUpdate(prev => {
            const withLife = migrateBankLifeState(prev);
            const life = withLife.life!;
            return {
                ...withLife,
                life: {
                    ...life,
                    actionHistory: (life.actionHistory || []).map(record => record.id === result.id ? {
                        ...record,
                        tone: result.tone,
                        summary: result.summary,
                        aiSummary: result.aiSummary,
                        riskTags: result.riskTags,
                        metrics: result.metrics,
                        payload: result.payload,
                    } : record),
                },
            };
        });
    };

    const enrichResultWithAi = async (
        result: BankLifeActionResult,
        busy: typeof aiBusy,
        loader: () => Promise<{ summary?: string; tone?: BankLifeActionTone; riskTags?: string[]; suggestions?: string[]; metrics?: { label: string; value: string; tone?: BankLifeActionTone }[] }>
    ): Promise<BankLifeActionResult> => {
        if (!auxApi.baseUrl || !auxApi.model) return result;
        setAiBusy(busy);
        try {
            return mergeActionAiDraft(result, await loader());
        } catch (error) {
            console.warn('[BankActionAI] fallback', error);
            return result;
        } finally {
            setAiBusy(null);
        }
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

        currentState = syncActiveBranchFromMirror(migrateBankLifeState(currentState));

        // --- Dollhouse: Load separately. New saves are keyed by shop id; legacy single save becomes the first branch's decor. ---
        const loadedDollhouses = await DB.getBankDollhouses();
        let loadedDollhouse = await DB.getBankDollhouse();
        const activeShopId = currentState.shopPortfolio?.activeShopId;
        let dollhouseMap: BankDollhousesByShopId = loadedDollhouses ? { ...loadedDollhouses } : {};

        // Migration: If dollhouse was embedded in shop state, extract and save separately.
        if (!loadedDollhouse && currentState.shop.dollhouse) {
            loadedDollhouse = currentState.shop.dollhouse;
            await DB.saveBankDollhouse(loadedDollhouse);
        }
        if (loadedDollhouse && activeShopId && Object.keys(dollhouseMap).length === 0) {
            dollhouseMap[activeShopId] = loadedDollhouse;
        }
        for (const branch of currentState.shopPortfolio?.branches || []) {
            if (!dollhouseMap[branch.id]) dollhouseMap[branch.id] = cloneDollhouseState(INITIAL_DOLLHOUSE);
        }

        let dh = activeShopId ? (dollhouseMap[activeShopId] || cloneDollhouseState(INITIAL_DOLLHOUSE)) : (loadedDollhouse || cloneDollhouseState(INITIAL_DOLLHOUSE));
        dollhouseRef.current = dh;
        setDollhouseState(dh);
        dollhousesByShopIdRef.current = dollhouseMap;
        setDollhousesByShopId(dollhouseMap);

        if (activeShopId || Object.keys(dollhouseMap).length > 0) {
            await DB.saveBankDollhouses(dollhouseMap);
        }
        if (!loadedDollhouse || activeShopId) {
            await DB.saveBankDollhouse(dh);
        }

        // 清洗失效图床(sharkpan)留下的死链：救回历史存档里裂掉的店员头像 / 房间贴图 / 装饰 / 背景。
        // 幂等——没有死链就什么都不做、不写库。
        {
            let shopChanged = false;
            const portfolio = currentState.shopPortfolio;
            if (portfolio?.branches?.length) {
                const branches = portfolio.branches.map(branch => {
                    let branchChanged = false;
                    const cleanStaff = branch.shop.staff.map(s =>
                        isDeadImg(s.avatar)
                            ? (branchChanged = true, { ...s, avatar: s.id === 'staff-001' ? '🐱' : '🙂' })
                            : s
                    );
                    let cleanBg = branch.shop.background;
                    if (isDeadImg(cleanBg)) { cleanBg = ''; branchChanged = true; }
                    if (!branchChanged) return branch;
                    shopChanged = true;
                    return { ...branch, shop: { ...branch.shop, staff: cleanStaff, background: cleanBg } };
                });
                if (shopChanged) {
                    currentState = syncActiveShopMirror({ ...currentState, shopPortfolio: { ...portfolio, branches } });
                }
            } else {
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
            }

            let dhChanged = false;
            const cleanOneDollhouse = (source: DollhouseState): DollhouseState => {
                let changed = false;
                const cleanRooms = source.rooms.map(r => {
                    let room = r;
                    if (isDeadImg(room.roomTextureUrl)) { room = { ...room, roomTextureUrl: undefined }; changed = true; }
                    if (room.stickers?.some(st => isDeadImg(st.url))) {
                        room = { ...room, stickers: room.stickers.map(st => isDeadImg(st.url) ? { ...st, url: '⭐' } : st) };
                        changed = true;
                    }
                    return room;
                });
                if (changed) dhChanged = true;
                return changed ? { ...source, rooms: cleanRooms } : source;
            };
            dollhouseMap = Object.fromEntries(Object.entries(dollhouseMap).map(([shopId, source]) => [shopId, cleanOneDollhouse(source)]));
            dh = activeShopId ? (dollhouseMap[activeShopId] || dh) : cleanOneDollhouse(dh);
            if (dhChanged) {
                dollhouseRef.current = dh;
                setDollhouseState(dh);
                dollhousesByShopIdRef.current = dollhouseMap;
                setDollhousesByShopId(dollhouseMap);
                await DB.saveBankDollhouses(dollhouseMap);
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
            const moro = characters.find(c => c.name.toLowerCase().includes('moro')) || characters[0];
            const portfolio = currentState.shopPortfolio;
            if (portfolio?.branches?.length) {
                let changed = false;
                const branches = portfolio.branches.map(branch => {
                    const systemStaff = branch.shop.staff.find(s => s.id === 'staff-001');
                    if (!systemStaff || !systemStaff.isPet || (systemStaff.ownerCharId && systemStaff.ownerCharId !== '')) return branch;
                    changed = true;
                    return {
                        ...branch,
                        shop: {
                            ...branch.shop,
                            staff: branch.shop.staff.map(s => s.id === 'staff-001' ? { ...s, ownerCharId: moro.id } : s),
                        },
                    };
                });
                if (changed) currentState = syncActiveShopMirror({ ...currentState, shopPortfolio: { ...portfolio, branches } });
            } else {
                const systemStaff = currentState.shop.staff.find(s => s.id === 'staff-001');
                if (systemStaff && systemStaff.isPet && (!systemStaff.ownerCharId || systemStaff.ownerCharId === '')) {
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
                dh = updatedDh;
                if (activeShopId) {
                    dollhouseMap = { ...dollhouseMap, [activeShopId]: updatedDh };
                    dollhousesByShopIdRef.current = dollhouseMap;
                    setDollhousesByShopId(dollhouseMap);
                    await DB.saveBankDollhouses(dollhouseMap);
                }
                dollhouseRef.current = updatedDh;
                setDollhouseState(updatedDh);
                await DB.saveBankDollhouse(updatedDh);
            }

            // Mark migration as done so it never runs again
            currentState = { ...currentState, dataVersion: 2 };
        }
        currentState = syncActiveBranchFromMirror(migrateBankLifeState(currentState));

        // DAILY RESET LOGIC
        const today = new Date().toISOString().split('T')[0];

        if (currentState.lastLoginDate !== today) {
            const portfolio = currentState.shopPortfolio;
            if (portfolio?.branches?.length) {
                let totalDailyEnergy = 0;
                const branches = portfolio.branches.map(branch => {
                    const appealNow = branch.shop.appeal || calculateAppeal(branch.shop.staff.length, branch.shop.unlockedRecipes);
                    const dailyEnergy = 10 + Math.floor(appealNow / 25);
                    totalDailyEnergy += dailyEnergy;
                    const updatedStaff = branch.shop.staff.map(s => ({
                        ...s,
                        fatigue: Math.max(0, s.fatigue - 30)
                    }));
                    const replenishedStock = { ...(branch.shop.stock || {}) };
                    for (const id of branch.shop.unlockedRecipes) {
                        replenishedStock[id] = Math.max(replenishedStock[id] || 0, DAILY_STOCK_FLOOR);
                    }
                    const shopProducts = branch.shopProducts.map(p => ({ ...p, stock: Math.max(p.stock || 0, DAILY_STOCK_FLOOR) }));
                    return {
                        ...branch,
                        shopProducts,
                        shop: {
                            ...branch.shop,
                            actionPoints: (branch.shop.actionPoints || 0) + dailyEnergy,
                            staff: updatedStaff,
                            activeVisitor: undefined,
                            stock: replenishedStock,
                        },
                    };
                });
                currentState = syncActiveShopMirror({
                    ...currentState,
                    todaySpent: 0,
                    lastLoginDate: today,
                    shopPortfolio: {
                        ...portfolio,
                        branches,
                        dailyRewards: {
                            dateStr: today,
                            headquartersPatrol: false,
                            shelfByShopId: {},
                            reviewByShopId: {},
                            idleBonusByShopId: {},
                        },
                    },
                });
                addToast(`新的一天！${branches.length} 家店经营精力共 +${totalDailyEnergy}`, 'success');
            } else {
                currentState = { ...currentState, todaySpent: 0, lastLoginDate: today };
                addToast('新的一天！今日预算已重置', 'success');
            }
        }

        const todayTx = txs.filter(t => t.dateStr === today);
        const spent = todayTx.reduce((sum, t) => sum + (t.type === 'income' ? 0 : t.amount), 0);

        // 挂机营业额 + 天气：每家已开分店都折算待收金币，当前活跃店同步到兼容镜像。
        const nowTs = Date.now();
        const portfolio = currentState.shopPortfolio;
        if (portfolio?.branches?.length) {
            const branches = portfolio.branches.map(branch => {
                const appeal = branch.shop.appeal || calculateAppeal(branch.shop.staff.length, branch.shop.unlockedRecipes);
                const weather = ensureWeather(branch.shop, nowTs);
                const shopWithWeather = { ...branch.shop, appeal, weather };
                const idle = accrueShopIdle(shopWithWeather, nowTs);
                return { ...branch, shop: { ...shopWithWeather, pendingRevenue: idle.pendingRevenue, lastAccrualAt: idle.lastAccrualAt } };
            });
            currentState = syncActiveShopMirror({ ...currentState, shopPortfolio: { ...portfolio, branches } });
        }
        const finalState = syncActiveBranchFromMirror(migrateBankLifeState({ ...currentState, todaySpent: spent }));
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
        // 只有「支出」计入今日花费（进账不算）；记账纯记现实金钱，不再影响店铺精力
        const newSpent = cur.todaySpent + (txType === 'expense' ? amount : 0);
        let actionResult = createBankActionResult({
            category: 'ledger',
            kind: 'ledger-add',
            title: txType === 'income' ? '进账已记录' : '支出已记录',
            summary: `${txNote} · ${txType === 'income' ? '收入' : '支出'} ¥${amount}`,
            tone: txType === 'income' ? 'good' : newSpent > cur.config.dailyBudget ? 'warn' : 'info',
            amount: txType === 'income' ? amount : -amount,
            riskTags: txType === 'expense' && newSpent > cur.config.dailyBudget ? ['超过今日预算'] : [],
            metrics: [
                { label: '金额', value: `¥${amount}`, tone: txType === 'income' ? 'good' : 'warn' },
                { label: '类型', value: txType === 'income' ? '收入' : '支出' },
                { label: '今日支出', value: `¥${Math.round(newSpent)}`, tone: newSpent > cur.config.dailyBudget ? 'warn' : 'info' },
                { label: '今日预算', value: `¥${cur.config.dailyBudget}` },
            ],
            payload: { txId: newTx.id, note: txNote, type: txType },
        });
        actionResult = await enrichResultWithAi(actionResult, 'ledger', () => generateAiLedgerInsight(auxApi, cur.life!, { transaction: newTx, todaySpent: newSpent, dailyBudget: cur.config.dailyBudget }));
        const newState = { ...cur, todaySpent: newSpent, life: appendBankActionRecord(cur.life!, actionResult) };
        await commitBankState(newState);

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
        showActionResult(actionResult);
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
        if (tx.dateStr === today && tx.type !== 'income') {
            newSpent = Math.max(0, cur.todaySpent - tx.amount);
        }

        const newState = { ...cur, todaySpent: newSpent };
        await commitBankState(newState);
        setTransactions(prev => prev.filter(t => t.id !== id));
        addToast('记录已删除', 'success');
    };

    // --- Game Logic ---

    const consumeHeadquartersEnergy = async (cost: number, label = '装修'): Promise<boolean> => {
        const cur = migrateBankLifeState(stateRef.current);
        const portfolio = cur.shopPortfolio;
        const currentEnergy = portfolio?.headquartersEnergy ?? 0;
        if (currentEnergy < cost) {
            addToast(`总部精力不够，${label}需要 ${cost} 点`, 'error');
            return false;
        }
        await persistStateUpdate(prev => {
            const withPortfolio = migrateBankLifeState(prev);
            const p = withPortfolio.shopPortfolio!;
            return {
                ...withPortfolio,
                shopPortfolio: { ...p, headquartersEnergy: Math.max(0, (p.headquartersEnergy || 0) - cost) },
            };
        });
        return true;
    };

    const consumeShopEnergy = async (cost: number): Promise<boolean> => {
        const cur = stateRef.current;
        if (cur.shop.actionPoints < cost) {
            addToast(`当前店精力不够（需要 ${cost} 点）`, 'error');
            return false;
        }
        const nextEnergy = cur.shop.actionPoints - cost;
        const newState = { ...cur, shop: { ...cur.shop, actionPoints: nextEnergy } };
        await commitBankState(newState);
        return true;
    };

    // 擦柜台恢复精力：60s 冷却，每次 +1~2。
    const wipeCooldownRef = useRef(0);
    const handleWipeCounter = async (): Promise<number> => {
        const now = Date.now();
        if (now - wipeCooldownRef.current < 60000) return 0;
        wipeCooldownRef.current = now;
        const ap = 1 + Math.floor(Math.random() * 2);
        const cur = stateRef.current;
        const newState = { ...cur, shop: { ...cur.shop, actionPoints: (cur.shop.actionPoints || 0) + ap } };
        await commitBankState(newState);
        return ap;
    };

    const handleStaffRest = async (staffId: string) => {
        const COST = 20;
        if (!(await consumeShopEnergy(COST))) return;

        const cur = migrateBankLifeState(stateRef.current);
        const staff = cur.shop.staff.find(s => s.id === staffId);
        const updatedStaff = cur.shop.staff.map(s =>
            s.id === staffId ? { ...s, fatigue: Math.max(0, s.fatigue - 50) } : s
        );
        const actionResult = createBankActionResult({
            category: 'shop',
            kind: 'staff-rest',
            title: '店员休息完成',
            summary: `${staff?.name || '店员'} 的疲劳下降了，下一轮营业更稳。`,
            tone: 'good',
            metrics: [
                { label: '消耗精力', value: `${COST}`, tone: 'warn' },
                { label: '店员', value: staff?.name || staffId },
            ],
            payload: { staffId, cost: COST },
        });

        const newState = { ...cur, shop: { ...cur.shop, staff: updatedStaff }, life: appendBankActionRecord(cur.life!, actionResult) };
        await commitBankState(newState);
        addToast('店员休息好了！', 'success');
        showActionResult(actionResult);
    };

    const handleUnlockRecipe = async (recipeId: string, cost: number) => {
        if (!(await consumeShopEnergy(cost))) return;

        const cur = migrateBankLifeState(stateRef.current);
        const recipe = SHOP_RECIPES.find(r => r.id === recipeId);
        const newUnlocked = [...cur.shop.unlockedRecipes, recipeId];
        const newAppeal = calculateAppeal(cur.shop.staff.length, newUnlocked);
        const actionResult = createBankActionResult({
            category: 'shop',
            kind: 'recipe-unlock',
            title: '新品已上架',
            summary: `${recipe?.name || '新品'} 已加入菜单，并附赠 ${STARTING_STOCK} 份起始库存。`,
            tone: 'good',
            metrics: [
                { label: '新品', value: recipe?.name || recipeId },
                { label: '消耗精力', value: `${cost}`, tone: 'warn' },
                { label: '起始库存', value: `${STARTING_STOCK}` },
                { label: '人气', value: `${newAppeal}` },
            ],
            payload: { recipeId, cost },
        });

        const newState = {
            ...cur,
            shop: {
                ...cur.shop,
                unlockedRecipes: newUnlocked,
                appeal: newAppeal,
                // 上架即附赠一批起始库存，新品当场就能卖
                stock: { ...(cur.shop.stock || {}), [recipeId]: STARTING_STOCK },
            },
            life: appendBankActionRecord(cur.life!, actionResult),
        };
        await commitBankState(newState);
        addToast(`新商品上架！附赠 ${STARTING_STOCK} 份起始库存，营业时就能卖了`, 'success');
        showActionResult(actionResult);
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
        let actionResult = createBankActionResult({
            category: 'shop',
            kind: 'shop-restock',
            title: '进货完成',
            summary: `${r.name} 补货 +${RESTOCK_BATCH}，库存到 ${newStock[recipeId]}。`,
            tone: 'good',
            amount: -cost,
            metrics: [
                { label: '商品', value: r.name },
                { label: '补货数量', value: `${RESTOCK_BATCH}` },
                { label: '进货成本', value: `${cur.config.currencySymbol}${cost}`, tone: 'warn' },
                { label: '当前库存', value: `${newStock[recipeId]}` },
            ],
            payload: { recipeId, cost, quantity: RESTOCK_BATCH },
        });
        actionResult = await enrichResultWithAi(actionResult, 'shop', () => generateAiShopActionDraft(auxApi, migrateBankLifeState(cur).life!, { action: 'restock', product: r.name, cost, quantity: RESTOCK_BATCH }));
        const migrated = migrateBankLifeState(cur);
        const newState = { ...migrated, shop: { ...migrated.shop, stock: newStock }, life: appendBankActionRecord(migrated.life!, actionResult) };
        await commitBankState(newState);
        adjustUserBalance(-cost, { note: `${r.name} 进货`, category: 'shop', kind: 'shop-restock', sourceApp: '人生拟', sourceId: recipeId });
        addToast(`${r.name} 进货 +${RESTOCK_BATCH}（花了 ${cur.config.currencySymbol}${cost}）`, 'success');
        showActionResult(actionResult);
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
        let actionResult = createBankActionResult({
            category: 'shop',
            kind: 'shop-restock',
            title: '货架补货完成',
            summary: `${product.name} 补货 +${batch}，货架又满起来了。`,
            tone: 'good',
            amount: -cost,
            metrics: [
                { label: '商品', value: product.name },
                { label: '补货数量', value: `${batch}` },
                { label: '进货成本', value: `¥${cost}`, tone: 'warn' },
                { label: '库存上限', value: `${STOCK_CAP}` },
            ],
            payload: { productId, cost, quantity: batch },
        });
        actionResult = await enrichResultWithAi(actionResult, 'shop', () => generateAiShopActionDraft(auxApi, cur.life!, { action: 'restock', product: product.name, cost, quantity: batch }));
        const nextLife = appendBankActionRecord({
            ...cur.life!,
            shopProducts: (cur.life!.shopProducts || []).map(p => p.id === productId ? { ...p, stock: Math.min(STOCK_CAP, p.stock + batch) } : p),
            shopEvents: [{ id: `shop-event-${Date.now()}`, dateStr: cur.life!.dateStr, title: '补了一批货', detail: `${product.name} 补货 +${batch}，货架又满起来了。`, tone: 'info' as const }, ...(cur.life!.shopEvents || [])].slice(0, 20),
        }, actionResult);
        await persistStateUpdate(prev => ({ ...migrateBankLifeState(prev), life: nextLife }));
        adjustUserBalance(-cost, { note: `${product.name} 进货`, category: 'shop', kind: 'shop-restock', sourceApp: '人生拟', sourceId: product.id });
        addToast(`${product.name} 进货 +${batch}`, 'success');
        showActionResult(actionResult);
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
        let actionResult = createBankActionResult({
            category: 'shop',
            kind: 'shop-upgrade',
            title: `店铺升到 Lv.${level + 1}`,
            summary: '客流、价格溢价和挂机收入都会跟着提升。',
            tone: 'good',
            amount: -cost,
            metrics: [
                { label: '新等级', value: `Lv.${level + 1}` },
                { label: '升级费用', value: `${cur.config.currencySymbol}${cost}`, tone: 'warn' },
                { label: '客流加成', value: `+${shopLevelExtraCustomers(level + 1)} 位` },
                { label: '挂机倍率', value: `${shopLevelPassiveMult(level + 1)}x` },
            ],
            nextActions: ['检查库存是否够卖', '安排店员休息'],
            payload: { fromLevel: level, toLevel: level + 1, cost },
        });
        const migrated = migrateBankLifeState(cur);
        actionResult = await enrichResultWithAi(actionResult, 'shop', () => generateAiShopActionDraft(auxApi, migrated.life!, { action: 'shop-upgrade', fromLevel: level, toLevel: level + 1, cost }));
        const newState = { ...migrated, shop: { ...migrated.shop, shopLevel: level + 1 }, life: appendBankActionRecord(migrated.life!, actionResult) };
        await commitBankState(newState);
        adjustUserBalance(-cost, { note: `店铺升级 Lv.${level + 1}`, category: 'shop', kind: 'shop-upgrade', sourceApp: '人生拟' });
        addToast(`店铺升到 Lv.${level + 1}！客流更旺、档次更高`, 'success');
        showActionResult(actionResult);
    };

    // --- 收取挂机营业额：把待收金币进钱包 ---
    const handleCollectIdle = async () => {
        const cur = stateRef.current;
        const idle = accrueShopIdle(cur.shop, Date.now()); // 先把零头折算进来再收
        const amount = Math.floor(idle.pendingRevenue);
        if (amount < 1) { addToast('还没攒下营业额，过会儿再来收～', 'info'); return; }
        const migrated = migrateBankLifeState(cur);
        const actionResult = createBankActionResult({
            category: 'shop',
            kind: 'shop-idle',
            title: '挂机营业额已收取',
            summary: `离店期间攒下的 ¥${amount} 已进入钱包。`,
            tone: 'good',
            amount,
            metrics: [
                { label: '收取金额', value: `${cur.config.currencySymbol}${amount}`, tone: 'good' },
                { label: '当前天气', value: getWeatherDef(cur.shop.weather?.id).label },
                { label: '每小时估算', value: `${cur.config.currencySymbol}${computeIdleRatePerHour(cur.shop)}` },
            ],
            payload: { amount },
        });
        let newState: BankFullState = { ...migrated, shop: { ...migrated.shop, pendingRevenue: 0, lastAccrualAt: Date.now(), totalRevenue: (migrated.shop.totalRevenue || 0) + amount }, life: appendBankActionRecord(migrated.life!, actionResult) };
        const reward = claimBankShopDailyReward(newState, 'idleBonus');
        if (reward.claimed) newState = reward.state;
        await commitBankState(newState);
        adjustUserBalance(amount, { note: '领取挂机营业额', category: 'shop', kind: 'shop-idle', sourceApp: '人生拟' });
        addToast(`收下挂机营业额 +${cur.config.currencySymbol}${amount}${reward.claimed ? '，当前店精力 +6' : ''}`, 'success');
        showActionResult(actionResult);
    };

    const handleClaimShopDailyReward = async (kind: 'headquartersPatrol' | 'shelf' | 'review') => {
        const result = claimBankShopDailyReward(stateRef.current, kind);
        if (!result.claimed) {
            addToast('今天这项已经领取过了', 'info');
            return;
        }
        await commitBankState(result.state);
        addToast(result.target === 'headquarters' ? `总部精力 +${result.amount}` : `当前店精力 +${result.amount}`, 'success');
        showActionResult(result.actionResult);
    };

    // --- Fire / Rehire / Delete Staff ---

    const handleFireStaff = async (staffId: string) => {
        const cur = migrateBankLifeState(stateRef.current);
        const staff = cur.shop.staff.find(s => s.id === staffId);
        if (!staff) return;

        const updatedActive = cur.shop.staff.filter(s => s.id !== staffId);
        const firedPool = [...(cur.firedStaff || []), { ...staff, fatigue: 0 }];
        const newAppeal = calculateAppeal(updatedActive.length, cur.shop.unlockedRecipes);
        const actionResult = createBankActionResult({
            category: 'shop',
            kind: 'staff-fire',
            title: '店员已离开排班',
            summary: `${staff.name} 已移入离职池，店铺人气会按当前员工数重新计算。`,
            tone: 'warn',
            metrics: [
                { label: '店员', value: staff.name },
                { label: '当前人气', value: `${newAppeal}` },
            ],
            payload: { staffId },
        });

        const newState = {
            ...cur,
            shop: { ...cur.shop, staff: updatedActive, appeal: newAppeal },
            firedStaff: firedPool,
            life: appendBankActionRecord(cur.life!, actionResult),
        };
        await commitBankState(newState);
        addToast(`${staff.name} 已被解雇`, 'info');
        showActionResult(actionResult);
    };

    const handleRehireStaff = async (staffId: string) => {
        const cur = migrateBankLifeState(stateRef.current);
        const staff = (cur.firedStaff || []).find(s => s.id === staffId);
        if (!staff) return;

        const randomX = 20 + Math.random() * 60;
        const rehired = { ...staff, fatigue: 0, x: randomX, y: 50 };
        const updatedActive = [...cur.shop.staff, rehired];
        const updatedFired = (cur.firedStaff || []).filter(s => s.id !== staffId);
        const newAppeal = calculateAppeal(updatedActive.length, cur.shop.unlockedRecipes);
        const actionResult = createBankActionResult({
            category: 'shop',
            kind: 'staff-rehire',
            title: '店员重新入职',
            summary: `${staff.name} 回到店里，排班人数和人气已更新。`,
            tone: 'good',
            metrics: [
                { label: '店员', value: staff.name },
                { label: '当前人气', value: `${newAppeal}` },
            ],
            payload: { staffId },
        });

        const newState = {
            ...cur,
            shop: { ...cur.shop, staff: updatedActive, appeal: newAppeal },
            firedStaff: updatedFired,
            life: appendBankActionRecord(cur.life!, actionResult),
        };
        await commitBankState(newState);
        addToast(`${staff.name} 已重新入职！`, 'success');
        showActionResult(actionResult);
    };

    const handleDeleteFiredStaff = async (staffId: string) => {
        const cur = stateRef.current;
        const staff = (cur.firedStaff || []).find(s => s.id === staffId);
        const updatedFired = (cur.firedStaff || []).filter(s => s.id !== staffId);

        const newState = { ...cur, firedStaff: updatedFired };
        await commitBankState(newState);
        addToast(`${staff?.name || '员工'} 已彻底删除`, 'success');
    };

    const handleHireStaff = async (newStaff: ShopStaff, cost: number) => {
        if (!(await consumeShopEnergy(cost))) return;

        const cur = migrateBankLifeState(stateRef.current);
        const randomX = 20 + Math.random() * 60;
        const staffWithPos = { ...newStaff, x: randomX, y: 50 };

        const updatedStaff = [...cur.shop.staff, staffWithPos];
        const newAppeal = calculateAppeal(updatedStaff.length, cur.shop.unlockedRecipes);
        const actionResult = createBankActionResult({
            category: 'shop',
            kind: 'staff-hire',
            title: '新店员入职',
            summary: `${newStaff.name} 加入排班，店铺人气提升到 ${newAppeal}。`,
            tone: 'good',
            metrics: [
                { label: '店员', value: newStaff.name },
                { label: '消耗精力', value: `${cost}`, tone: 'warn' },
                { label: '当前人气', value: `${newAppeal}` },
            ],
            payload: { staffId: staffWithPos.id, cost },
        });

        const newState = {
            ...cur,
            shop: {
                ...cur.shop,
                staff: updatedStaff,
                appeal: newAppeal
            },
            life: appendBankActionRecord(cur.life!, actionResult),
        };
        await commitBankState(newState);
        addToast('新店员入职！', 'success');
        showActionResult(actionResult);
    };

    const handleRefreshGuestbook = async () => {
        const COST = 40;
        if (stateRef.current.shop.actionPoints < COST) {
            addToast(`店员精力不够（需要 ${COST} 点）`, 'error');
            return;
        }

        setIsRefreshingGuestbook(true);
        try {
            const current = stateRef.current;
            const availableChars = characters.filter(c => c.id !== current.shop.activeVisitor?.charId);
            const pool = availableChars.length > 0 ? availableChars : characters;
            const randomChar = pool.length ? pool[Math.floor(Math.random() * pool.length)] : undefined;
            let newEntries: BankGuestbookItem[] | null = null;

            if (auxApi.baseUrl && auxApi.model && randomChar) {
                try {
                    await injectMemoryPalace(randomChar);
                    const charContext = ContextBuilder.buildCoreContext(randomChar, userProfile, true);
                    const recentMsgs = await DB.getMessagesByCharId(randomChar.id);
                    const chatSnippet = recentMsgs.slice(-10).map(m => m.content.substring(0, 50)).join(' | ');
                    const previousGuestbook = (current.shop.guestbook || []).slice(0, 10).map(g => `${g.authorName}: ${g.content}`).join('\n');
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
   - **Themes**: small shop notes, customer opinions, warm stories, or continuing previous guestbook threads.
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

                    const data = await callChatCompletion(auxApi, {
                        model: auxApi.model,
                        messages: [{ role: 'user', content: prompt }],
                        stream: false,
                    }, {
                        meta: makeApiUsageMeta('bank.shopAction', {
                            charId: randomChar.id,
                            charName: randomChar.name,
                            apiRole: auxApi.apiRole || 'aux',
                            apiBinding: auxApi.apiBinding || '留言簿',
                        }),
                    });

                    const jsonStr = (extractContent(data) || '').replace(/```json/g, '').replace(/```/g, '').trim();
                    const result = JSON.parse(jsonStr);
                    newEntries = result.map((item: any) => ({
                        id: `gb-${Date.now()}-${Math.random()}`,
                        authorName: item.authorName,
                        content: item.content,
                        isChar: item.isChar,
                        charId: item.isChar ? randomChar.id : undefined,
                        avatar: item.isChar ? randomChar.avatar : undefined,
                        timestamp: Date.now(),
                        systemMessageId: undefined,
                    }));
                } catch (e) {
                    console.warn('Guestbook AI failed, using local notes', e);
                }
            }

            if (!newEntries?.length) {
                newEntries = buildLocalGuestbookEntries(current.shop.shopName, randomChar ? { id: randomChar.id, name: randomChar.name, avatar: randomChar.avatar } : undefined);
            }

            for (const entry of newEntries) {
                if (entry.isChar && entry.charId) {
                    try {
                        const msgId = await DB.saveMessage({
                            charId: entry.charId,
                            role: 'system',
                            type: 'text',
                            content: `[系统: ${entry.authorName} 拜访了${userProfile.name}的人生拟小店，并表示："${entry.content}"]`,
                        });
                        entry.systemMessageId = msgId;
                    } catch (e) {
                        console.error('Failed to push visitor system message', e);
                    }
                }
            }

            const unlockedRooms = (dollhouseState.rooms || []).filter(r => r.isUnlocked);
            const fallbackRoom = dollhouseState.rooms?.[0];
            const spawnRoom = unlockedRooms.length > 0
                ? unlockedRooms[Math.floor(Math.random() * unlockedRooms.length)]
                : fallbackRoom;
            const spawnX = 18 + Math.random() * 64;
            const spawnY = 64 + Math.random() * 24;
            const charEntry = newEntries.find(e => e.isChar && e.charId);

            await persistStateUpdate(prev => ({
                ...prev,
                shop: {
                    ...prev.shop,
                    actionPoints: Math.max(0, prev.shop.actionPoints - COST),
                    guestbook: [...newEntries, ...(prev.shop.guestbook || [])].slice(0, 50),
                    activeVisitor: charEntry ? {
                        charId: charEntry.charId!,
                        message: charEntry.content || "来逛逛~",
                        timestamp: Date.now(),
                        roomId: spawnRoom?.id,
                        x: spawnX,
                        y: spawnY,
                    } : prev.shop.activeVisitor
                }
            }));
            addToast('收到新的店里来信', 'success');

        } catch (e: any) {
            console.error(e);
            addToast('今天暂时没有新留言', 'info');
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
        await commitBankState(newState);
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
        await commitBankState(newState);
    };

    const handleConfigUpdate = async (updates: Partial<typeof state.config>) => {
        const cur = stateRef.current;
        const normalizedUpdates = { ...updates };
        if (typeof normalizedUpdates.dailyBudget === 'number') {
            if (!Number.isFinite(normalizedUpdates.dailyBudget)) return;
            normalizedUpdates.dailyBudget = Math.max(0, Math.floor(normalizedUpdates.dailyBudget));
        }
        const newState = { ...cur, config: { ...cur.config, ...normalizedUpdates } };
        await commitBankState(newState);
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
            adjustUserBalance(ev.amount, { note: ev.note, category: ev.category, kind: ev.kind, sourceApp: '人生拟', sourceId: ev.sourceId });
        }
        addToast(result.balanceDelta > 0 ? `来到 ${result.life.dateStr}，入账 ¥${result.balanceDelta}` : `来到 ${result.life.dateStr}`, 'success');
        if (auxApi.model) {
            setAiBusy('day');
            void (async () => {
                try {
                    const [events, pulses] = await Promise.all([
                        generateAiLifeDay(auxApi, result.life),
                        generateAiMarketPulse(auxApi, result.life),
                    ]);
                    await persistStateUpdate(prev => {
                        const withLife = migrateBankLifeState(prev);
                        const baseLife = withLife.life!;
                        const withEvents = { ...baseLife, aiEvents: [...events, ...(baseLife.aiEvents || [])].slice(0, 30), events: [...events, ...baseLife.events].slice(0, 80) };
                        return { ...withLife, life: applyMarketPulses(withEvents, pulses) };
                    });
                } finally {
                    setAiBusy(null);
                }
            })();
        }
    };

    const handleDashboardInsight = async () => {
        const cur = migrateBankLifeState(stateRef.current);
        let actionResult = createBankActionResult({
            category: 'dashboard',
            kind: 'dashboard-insight',
            title: '首页复盘',
            summary: '已按当前现金流、疲劳、持仓、负债和经营状态生成一张人生拟看板。',
            tone: debtValue > 0 || cur.life!.fatigue > 70 ? 'warn' : 'info',
            riskTags: [
                ...(cur.life!.fatigue > 70 ? ['疲劳偏高'] : []),
                ...(debtValue > 0 ? ['存在负债'] : []),
                ...(Object.keys(cur.life!.holdings).length > 0 ? ['持仓波动'] : []),
            ],
            metrics: [
                { label: '钱包', value: `¥${Math.round(userProfile.balance || 0)}`, tone: 'good' },
                { label: '净资产', value: `¥${netWorth}` },
                { label: '疲劳', value: `${cur.life!.fatigue}/100`, tone: cur.life!.fatigue > 70 ? 'warn' : 'info' },
                { label: '负债', value: `¥${Math.round(debtValue)}`, tone: debtValue > 0 ? 'warn' : 'good' },
            ],
            nextActions: lifeSuggestions.map(s => s.title).slice(0, 3),
            payload: { netWorth, stockValue, debtValue },
        });
        actionResult = await enrichResultWithAi(actionResult, 'dashboard', () => generateAiDashboardInsight(auxApi, cur.life!));
        await persistStandaloneActionResult(actionResult);
    };

    const handleStartJobApplication = async (posting: BankJobPosting) => {
        const cur = migrateBankLifeState(stateRef.current);
        setAiBusy('resume');
        try {
            const aiReview = await generateAiResumeReview(auxApi, cur.life!, posting);
            const result = startJobApplication(cur.life!, posting);
            result.application.aiReview = aiReview;
            result.life.jobHistory = result.life.jobHistory.map(app => app.id === result.application.id ? { ...app, aiReview } : app);
            await persistStateUpdate(prev => ({ ...migrateBankLifeState(prev), life: result.life }));
            setSelectedApplicationId(result.application.id);
            addToast('简历已投出', 'success');
        } finally {
            setAiBusy(null);
        }
    };

    const handleSendRecruiterMessage = async (applicationId: string, message: string) => {
        const cur = migrateBankLifeState(stateRef.current);
        const current = cur.life?.jobHistory.find(app => app.id === applicationId);
        if (!current || !message.trim()) return;
        setAiBusy('recruiter');
        try {
            const reply = await generateAiRecruiterReply(auxApi, cur.life!, current, message.trim());
            await persistStateUpdate(prev => {
                const withLife = migrateBankLifeState(prev);
                let nextLife = appendJobChatMessage(withLife.life!, applicationId, { role: 'user', content: message.trim(), at: new Date().toLocaleString() });
                nextLife = appendJobChatMessage(nextLife, applicationId, { role: 'boss', content: reply.content, at: new Date().toLocaleString() });
                return { ...withLife, life: nextLife };
            });
            setSelectedApplicationId(applicationId);
        } finally {
            setAiBusy(null);
        }
    };

    const handleAdvanceJobApplication = async (applicationId: string, answer = '') => {
        const cur = migrateBankLifeState(stateRef.current);
        const current = cur.life?.jobHistory.find(app => app.id === applicationId);
        setAiBusy('stage');
        try {
            const aiDraft = current ? await generateAiJobStageDecision(auxApi, cur.life!, current, answer) : undefined;
            const result = advanceJobApplicationStageWithAi(cur.life!, applicationId, answer, userProfile.balance || 0, aiDraft);
            if (!result.application) return;
            await persistStateUpdate(prev => ({ ...migrateBankLifeState(prev), life: result.life }));
            if (result.balanceDelta !== 0) {
                adjustUserBalance(result.balanceDelta, { note: `${result.application.title} 求职损失`, category: 'job', kind: 'job-risk', sourceApp: '人生拟', sourceId: result.application.postingId });
            }
            setSelectedApplicationId(result.application.id);
            addToast(result.application.message, result.application.status === 'hired' ? 'success' : result.application.status === 'scammed' ? 'error' : 'info');
        } finally {
            setAiBusy(null);
        }
    };

    const handleDeclineJobApplication = async (applicationId: string, reason: string) => {
        const cur = migrateBankLifeState(stateRef.current);
        const result = declineJobApplication(cur.life!, applicationId, reason);
        if (!result.application) return;
        await persistStateUpdate(prev => ({ ...migrateBankLifeState(prev), life: result.life }));
        setSelectedApplicationId(result.application.id);
        addToast('已放弃这份机会', 'info');
    };

    const handleGenerateAiJobs = async () => {
        const cur = migrateBankLifeState(stateRef.current);
        setAiBusy('jobs');
        try {
            const jobs = await generateAiJobs(auxApi, cur.life!, jobSearchQuery || jobCategory, jobCategory);
            if (!jobs.length) { addToast('暂时没有生成新岗位，先看看本地岗位', 'info'); return; }
            const nextLife = mergeAiJobPostings(cur.life!, jobs, jobSearchQuery || jobCategory, jobCategory);
            await persistStateUpdate(prev => ({ ...migrateBankLifeState(prev), life: nextLife }));
            setSelectedJobId(jobs[0].id);
            addToast(`AI 生成了 ${jobs.length} 个新岗位`, 'success');
        } finally {
            setAiBusy(null);
        }
    };

    const handleSaveResume = async () => {
        const cur = migrateBankLifeState(stateRef.current);
        const updates: Partial<BankResumeProfile> = {
            headline: resumeDraft.headline ?? cur.life?.resume?.headline,
            selfIntro: resumeDraft.selfIntro ?? cur.life?.resume?.selfIntro,
            skills: typeof resumeDraft.skills === 'string' ? String(resumeDraft.skills).split(/[，,]/).map(s => s.trim()).filter(Boolean) : resumeDraft.skills,
            expectedCategories: typeof resumeDraft.expectedCategories === 'string' ? String(resumeDraft.expectedCategories).split(/[，,]/).map(s => s.trim()).filter(Boolean) : resumeDraft.expectedCategories,
        };
        await persistStateUpdate(prev => {
            const withLife = migrateBankLifeState(prev);
            return { ...withLife, life: updateResumeProfile(withLife.life!, updates) };
        });
        setResumeDraft({});
        addToast('简历已更新', 'success');
    };

    const handleLeaveJob = async () => {
        const cur = migrateBankLifeState(stateRef.current);
        if (!cur.life?.currentJob) return;
        await persistStateUpdate(prev => ({ ...migrateBankLifeState(prev), life: leaveJob(migrateBankLifeState(prev).life!) }));
        addToast('已离职，未结工资会按发薪日补发', 'info');
    };

    const handleUnlockLifeShop = async () => {
        const wallet = Math.round(userProfile.balance || 0);
        const tpl = BUSINESS_TEMPLATES.find(b => b.id === selectedBusinessType) || BUSINESS_TEMPLATES[0];
        const current = migrateBankLifeState(stateRef.current);
        const shopName = newShopName.trim() || getDefaultBankBranchName(tpl.id, current.shopPortfolio?.branches || []);
        const opened = openBankShopBranch(current, tpl.id, shopName, { walletBalance: wallet, dateStr: current.life?.dateStr });
        if (!opened.ok) {
            if (opened.reason === 'wallet') addToast(`钱包不够开这家店（需要 ¥${opened.cost}）`, 'error');
            else addToast(`总部精力不够开新店（需要 ${opened.energyCost} 点）`, 'error');
            return;
        }
        const nextState = await commitBankState(opened.state);
        if (opened.branch) await activateDollhouseForShop(opened.branch.id);
        adjustUserBalance(-opened.cost, { note: `${shopName} 开店启动金`, category: 'shop', kind: 'shop-open', sourceApp: '人生拟', sourceId: opened.branch?.id });
        addToast(`${shopName} 准备开张`, 'success');
        setNewShopName('');
        setBankModal(null);
        if (opened.actionResult) {
            let result: BankLifeActionResult = opened.actionResult;
            result = await enrichResultWithAi(result, 'shop', () => generateAiShopActionDraft(auxApi, nextState.life!, { action: 'shop-open', businessType: tpl.name, shopName, cost: opened.cost }));
            await syncActionHistoryResult(result);
            showActionResult(result);
        }
    };

    const handleSwitchBankShop = async (shopId: string) => {
        const next = await commitBankState(switchActiveBankShop(stateRef.current, shopId));
        await activateDollhouseForShop(next.shopPortfolio?.activeShopId || shopId);
        const branch = next.shopPortfolio?.branches.find(b => b.id === shopId);
        if (branch) addToast(`已切到 ${branch.shop.shopName}`, 'success');
    };

    const handleBuyStock = async (symbol: string) => {
        const amount = Number(stockBudget[symbol]);
        if (!Number.isFinite(amount) || amount <= 0) { addToast('请输入买入金额', 'error'); return; }
        if ((userProfile.balance || 0) < amount) { addToast('钱包不够买入', 'error'); return; }
        const cur = migrateBankLifeState(stateRef.current);
        const result = buyStock(cur.life!, symbol, amount);
        if (result.cost <= 0) { addToast('金额太小，买不了一份', 'info'); return; }
        await persistStateUpdate(prev => ({ ...migrateBankLifeState(prev), life: result.life }));
        adjustUserBalance(-result.cost, { note: `买入 ${symbol}`, category: 'stock', kind: 'stock-buy', sourceApp: '人生拟', sourceId: symbol, relatedEntityId: symbol });
        setStockBudget(prev => ({ ...prev, [symbol]: '' }));
        addToast(`买入 ${symbol} ${result.shares} 股`, 'success');
        if (result.actionResult) {
            const actionResult = await enrichResultWithAi(result.actionResult, 'invest', () => generateAiStockOrderDraft(auxApi, result.life, { side: 'buy', symbol, cost: result.cost, shares: result.shares }));
            await syncActionHistoryResult(actionResult);
            showActionResult(actionResult);
        }
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
        adjustUserBalance(result.revenue, { note: `卖出 ${symbol}`, category: 'stock', kind: 'stock-sell', sourceApp: '人生拟', sourceId: symbol, relatedEntityId: symbol });
        setStockSellShares(prev => ({ ...prev, [symbol]: '' }));
        addToast(`卖出 ${symbol}，到账 ¥${result.revenue}`, 'success');
        if (result.actionResult) {
            const actionResult = await enrichResultWithAi(result.actionResult, 'invest', () => generateAiStockOrderDraft(auxApi, result.life, { side: 'sell', symbol, revenue: result.revenue, soldShares: result.soldShares }));
            await syncActionHistoryResult(actionResult);
            showActionResult(actionResult);
        }
    };

    const handleToggleWatchlist = async (symbol: string) => {
        const quote = migrateBankLifeState(stateRef.current).life?.stockMarket.find(s => s.symbol === symbol);
        let actionResult: BankLifeActionResult | undefined;
        await updateLifeState(life => {
            const exists = life.watchlist.includes(symbol);
            const nextActionResult = createBankActionResult({
                category: 'invest',
                kind: 'watchlist',
                title: exists ? '移出自选' : '加入自选',
                summary: `${quote?.name || symbol} 已${exists ? '移出' : '加入'}自选列表。`,
                tone: 'info',
                metrics: [
                    { label: '代码', value: symbol },
                    { label: '当前价格', value: quote ? `¥${quote.price}` : '未知' },
                    { label: '风险', value: quote ? `${quote.risk}/5` : '未知', tone: quote && quote.risk >= 4 ? 'warn' : 'info' },
                ],
                payload: { symbol, action: exists ? 'remove' : 'add' },
            });
            actionResult = nextActionResult;
            return appendBankActionRecord({ ...life, watchlist: exists ? life.watchlist.filter(s => s !== symbol) : [symbol, ...life.watchlist] }, nextActionResult);
        });
        showActionResult(actionResult);
    };

    const handleFoundCompany = async () => {
        if ((userProfile.balance || 0) < COMPANY_FOUND_COST) { addToast(`开公司至少需要 ¥${COMPANY_FOUND_COST}`, 'error'); return; }
        const cur = migrateBankLifeState(stateRef.current);
        if (cur.life?.company) { addToast('已经有公司啦', 'info'); return; }
        const nextLife = foundCompany(cur.life!, companyName, companyDirection);
        await persistStateUpdate(prev => ({ ...migrateBankLifeState(prev), life: nextLife }));
        adjustUserBalance(-COMPANY_FOUND_COST, { note: `创办${companyName || companyDirection}`, category: 'company', kind: 'company-found', sourceApp: '人生拟' });
        addToast('公司成立，第一笔启动资金已转入公司', 'success');
        const record = nextLife.actionHistory?.[0];
        if (record) {
            let result = actionRecordToResult(record);
            result = await enrichResultWithAi(result, 'company', () => generateAiCompanyActionDraft(auxApi, nextLife, { action: 'company-found', name: companyName, direction: companyDirection, cost: COMPANY_FOUND_COST }));
            await syncActionHistoryResult(result);
            showActionResult(result);
        }
    };

    const handleCompanyIssue = async (optionId: string) => {
        const cur = migrateBankLifeState(stateRef.current);
        const beforeCash = cur.life?.company?.cash || 0;
        const result = applyCompanyIssueWithResult(cur.life!, optionId);
        const nextLife = result.life;
        const afterCash = nextLife.company?.cash || beforeCash;
        await persistStateUpdate(prev => ({ ...migrateBankLifeState(prev), life: nextLife }));
        addToast(afterCash >= beforeCash ? '事务处理完成，公司现金增加' : '事务处理完成，公司现金减少', 'success');
        if (result.actionResult) {
            const actionResult = await enrichResultWithAi(result.actionResult, 'company', () => generateAiCompanyActionDraft(auxApi, nextLife, { action: 'company-issue', optionId, beforeCash, afterCash }));
            await syncActionHistoryResult(actionResult);
            showActionResult(actionResult);
        }
    };

    const handleCompanyDividend = async () => {
        const cur = migrateBankLifeState(stateRef.current);
        const company = cur.life?.company;
        if (!company || company.cash <= COMPANY_FOUND_COST) { addToast('公司暂时没有可分红利润', 'info'); return; }
        const result = withdrawCompanyDividend(cur.life!);
        const amount = result.amount;
        if (amount <= 0) return;
        const nextLife = result.life;
        await persistStateUpdate(prev => ({ ...migrateBankLifeState(prev), life: nextLife }));
        adjustUserBalance(amount, { note: `${company.name} 分红`, category: 'company', kind: 'company-dividend', sourceApp: '人生拟', sourceId: company.id });
        addToast(`公司分红到账 ¥${amount}`, 'success');
        if (result.actionResult) {
            const actionResult = await enrichResultWithAi(result.actionResult, 'company', () => generateAiCompanyActionDraft(auxApi, nextLife, { action: 'company-dividend', amount, company: company.name }));
            await syncActionHistoryResult(actionResult);
            showActionResult(actionResult);
        }
    };

    const handleBorrowLoan = async () => {
        const amount = Math.round(Number(loanAmount));
        if (!Number.isFinite(amount) || amount <= 0) { addToast('请输入借款金额', 'error'); return; }
        const product = LOAN_PRODUCTS[loanChannel];
        if (amount < product.min || amount > product.max) { addToast(`${product.name} 可借 ¥${product.min}-${product.max}`, 'error'); return; }
        const cur = migrateBankLifeState(stateRef.current);
        setAiBusy('loan');
        const creditProfile = computeCreditProfile(cur.life!);
        const review = await generateAiLoanReview(auxApi, { ...cur.life!, creditProfile }, loanChannel, amount);
        setAiBusy(null);
        if (!review.approved || review.approvedAmount <= 0) {
            const actionResult = createBankActionResult({
                category: 'loan',
                kind: 'loan-reject',
                title: '借款审核未通过',
                summary: review.reason,
                aiSummary: review.reason,
                tone: 'warn',
                riskTags: review.warnings,
                metrics: [
                    { label: '申请渠道', value: product.name },
                    { label: '申请金额', value: `¥${amount}` },
                    { label: '信用分', value: `${creditProfile.score}` },
                ],
                nextActions: ['降低申请金额', '先减少负债压力'],
                payload: { channel: loanChannel, amount, creditProfile },
            });
            await persistStateUpdate(prev => {
                const withLife = migrateBankLifeState(prev);
                const lifeWithEvent = { ...withLife.life!, creditProfile, events: [{ id: `loan-reject-${Date.now()}`, dateStr: withLife.life!.dateStr, title: '借款审核未通过', detail: review.reason, tone: 'warn' as const }, ...withLife.life!.events].slice(0, 80) };
                return { ...withLife, life: appendBankActionRecord(lifeWithEvent, actionResult) };
            });
            addToast(review.reason, 'error');
            showActionResult(actionResult);
            return;
        }
        const result = borrowLoan({ ...cur.life!, creditProfile }, loanChannel, review.approvedAmount);
        result.loan.reviewReason = review.reason;
        result.loan.contractTerms = [...(result.loan.contractTerms || []), ...review.warnings].slice(0, 8);
        result.life.loans = result.life.loans.map(loan => loan.id === result.loan.id ? result.loan : loan);
        await persistStateUpdate(prev => ({ ...migrateBankLifeState(prev), life: result.life }));
        adjustUserBalance(review.approvedAmount, { note: result.loan.note, category: 'loan', kind: 'loan-borrow', sourceApp: '人生拟', sourceId: result.loan.id });
        addToast(`${result.loan.note} ¥${review.approvedAmount} 到账`, loanChannel === 'shady' ? 'info' : 'success');
        if (result.actionResult) {
            const actionResult = mergeActionAiDraft({ ...result.actionResult, aiSummary: review.reason, riskTags: [...(result.actionResult.riskTags || []), ...review.warnings] }, {
                summary: review.reason,
                tone: loanChannel === 'shady' ? 'warn' : 'good',
                riskTags: review.warnings,
            });
            await syncActionHistoryResult(actionResult);
            showActionResult(actionResult);
        }
    };

    const handleRepayLoan = async (loanId: string) => {
        const amount = Math.round(Number(loanRepayAmount[loanId]));
        if (!Number.isFinite(amount) || amount <= 0) { addToast('请输入还款金额', 'error'); return; }
        const cur = migrateBankLifeState(stateRef.current);
        const loan = cur.life?.loans.find(l => l.id === loanId);
        const dueNow = loan ? Math.round(loan.outstanding + loan.interestDue) : amount;
        if ((userProfile.balance || 0) < Math.min(amount, dueNow)) { addToast('钱包不够还这笔', 'error'); return; }
        const result = repayLoan(cur.life!, loanId, amount);
        if (result.paid <= 0) return;
        await persistStateUpdate(prev => ({ ...migrateBankLifeState(prev), life: result.life }));
        adjustUserBalance(-result.paid, { note: '贷款还款', category: 'loan', kind: 'loan-repay', sourceApp: '人生拟', sourceId: loanId });
        setLoanRepayAmount(prev => ({ ...prev, [loanId]: '' }));
        addToast(`已还款 ¥${result.paid}`, 'success');
        showActionResult(result.actionResult);
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
        const cur = migrateBankLifeState(stateRef.current);
        const actionResult = createBankActionResult({
            category: 'goal',
            kind: 'goal-create',
            title: '攒钱心愿已建立',
            summary: `${goalName} 的目标金额是 ¥${parsedTarget}，之后可以在经营和账本里慢慢推进。`,
            tone: 'good',
            metrics: [
                { label: '心愿', value: goalName },
                { label: '目标金额', value: `¥${parsedTarget}` },
                { label: '当前进度', value: '0%' },
            ],
            nextActions: ['记一笔收入', '规划每日预算'],
            payload: { goalId: newGoal.id, targetAmount: parsedTarget },
        });
        const newState = { ...cur, goals: [...cur.goals, newGoal], life: appendBankActionRecord(cur.life!, actionResult) };
        await commitBankState(newState);
        setShowGoalModal(false);
        setGoalName('');
        setGoalTarget('');
        addToast('心愿已添加', 'success');
        showActionResult(actionResult);
    };

    // --- AI 后台润色评价：把模板评价改写得更多样、有个性，并据点评情绪微调星级（影响口碑）。
    //     非阻塞、失败时沿用本地点评。营业时若配了 AI 服务才调用。 ---
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

            const data = await callChatCompletion(auxApi, {
                model: auxApi.model,
                messages: [{ role: 'user', content: prompt }],
                stream: false,
            }, {
                meta: makeApiUsageMeta('bank.shopAction', { apiRole: auxApi.apiRole || 'aux', apiBinding: auxApi.apiBinding || '顾客点评' }),
            });
            const jsonStr = (extractContent(data) || '').replace(/```json/g, '').replace(/```/g, '').trim();
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
            console.warn('AI review enrich failed', e); // 失败沿用本地点评，不打扰用户
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
        if ((cur.shop.actionPoints || 0) < BUSINESS_ENERGY_COST) {
            addToast(`当前店精力不够（营业需要 ${BUSINESS_ENERGY_COST} 点）`, 'error');
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
        const soldItems = Array.from(itemMap.values()).sort((a, b) => b.subtotal - a.subtotal);
        const actionResult = createBankActionResult({
            category: 'shop',
            kind: 'shop-business',
            title: '本轮营业结算',
            summary: `${lifeState.shopBusinessName || cur.shop.shopName} 接待了 ${customerCount} 位客人，收入 ¥${total}。`,
            tone: mishaps > 0 || lostSales > 0 ? 'warn' : 'good',
            amount: total,
            riskTags: [
                ...(lostSales > 0 ? ['缺货流失'] : []),
                ...(mishaps > 0 ? ['服务失误'] : []),
                ...(energetic === 0 ? ['店员疲劳'] : []),
            ],
            metrics: [
                { label: '总收入', value: `¥${total}`, tone: 'good' },
                { label: '客人数', value: `${customerCount}` },
                { label: '小费', value: `¥${tips}`, tone: tips > 0 ? 'good' : 'info' },
                { label: '差错', value: `${mishaps}`, tone: mishaps > 0 ? 'warn' : 'good' },
                { label: '流失', value: `${lostSales}`, tone: lostSales > 0 ? 'warn' : 'good' },
                { label: '天气', value: weather.label },
                { label: '消耗精力', value: `${BUSINESS_ENERGY_COST}`, tone: 'warn' },
            ],
            nextActions: lostSales > 0 ? ['先补货再营业'] : ['查看顾客评价'],
            payload: { total, base, tips, customerCount, soldItems, lostSales, mishaps },
        });
        const newState: BankFullState = {
            ...cur,
            shop: {
                ...cur.shop,
                staff: updatedStaff,
                actionPoints: Math.max(0, (cur.shop.actionPoints || 0) - BUSINESS_ENERGY_COST),
                lastBusinessAt: Date.now(),
                totalRevenue: (cur.shop.totalRevenue || 0) + total,
                reviews: mergedReviews,
                stock: stockLeft,
                regulars: prunedRegulars,
            },
            life: appendBankActionRecord({
                ...lifeState,
                shopProducts: usingLifeProducts
                    ? (lifeState.shopProducts || []).map(p => ({ ...p, stock: Math.max(0, lifeStockLeft[p.id] ?? p.stock) }))
                    : lifeState.shopProducts,
                shopEvents: usingLifeProducts
                    ? [{ id: `shop-event-${Date.now()}`, dateStr: lifeState.dateStr, title: '今日营业', detail: `${lifeState.shopBusinessName || cur.shop.shopName} 接待了 ${customerCount} 位客人，收入 ¥${total}。`, tone: 'good' as const }, ...(lifeState.shopEvents || [])].slice(0, 20)
                    : lifeState.shopEvents,
            }, actionResult),
        };
        await commitBankState(newState);
        adjustUserBalance(total, { note: '店铺营业收入', category: 'shop', kind: 'shop-business', sourceApp: '人生拟' });

        for (const ev of loyaltyEvents.filter(e => e.tier === 'vip')) {
            addToast(`👑 ${ev.name} 成了你店里的 VIP！`, 'success');
        }

        setBusinessResult({
            total, base, tips, customerCount,
            items: soldItems,
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
        // 非阻塞——营业已即时出结果；没配 API 或失败就沿用本地点评。
        if (auxApi.baseUrl && auxApi.model && newReviews.length > 0) {
            void enrichReviewsWithAI(newReviews, Array.from(itemMap.values()).map(it => it.name), level);
        }
    };

    // 库存告急：有在售商品快卖光（≤3 份）时，给「经营」书签贴个小红点，点进去就能进货
    const LOW_STOCK_THRESHOLD = 3;
    const lowStockCount = state.shop.unlockedRecipes.reduce(
        (n, id) => n + ((state.shop.stock?.[id] ?? 0) <= LOW_STOCK_THRESHOLD ? 1 : 0), 0);
    const hasLowStock = lowStockCount > 0;
    const migratedViewState = migrateBankLifeState(state);
    const life = migratedViewState.life!;
    const shopPortfolio = migratedViewState.shopPortfolio;
    const shopBranches = shopPortfolio?.branches || [];
    const activeShopId = shopPortfolio?.activeShopId || '';
    const activeBranch = shopBranches.find(b => b.id === activeShopId) || shopBranches[0];
    const dailyRewards = shopPortfolio?.dailyRewards?.dateStr === life.dateStr ? shopPortfolio.dailyRewards : undefined;
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
    const allJobPostings = [...(life.aiJobPostings || []), ...JOB_POSTINGS];
    const lifeSuggestions = buildLifeSuggestions(life, userProfile.balance || 0);
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
                <div className="mt-4 grid grid-cols-3 gap-2">
                    <ScrapButton onClick={handleAdvanceLifeDay} className="col-span-2 py-2.5 text-[13px]">{aiBusy === 'day' ? 'AI 生成今日事件中…' : '下一天'}</ScrapButton>
                    <button onClick={() => setBankModal({ kind: 'history' })} className="py-2.5 text-[12px] font-black active:scale-95 transition-transform" style={chipStyle(false)}>记录</button>
                </div>
            </PaperCard>

            <div className="grid grid-cols-2 gap-2.5">
                {statTiles.map(s => (
                    <button key={s.label} onClick={() => setBankModal({ kind: 'dashboardInsight' })} className="text-left active:scale-[0.99] transition-transform">
                    <PaperCard className="px-3 py-3 h-full">
                        <div className="text-[10px] font-bold" style={{ color: INK_SOFT }}>{s.label}</div>
                        <div className="text-[22px] font-black leading-tight mt-0.5 truncate" style={{ color: s.color, fontFamily: HAND_FONT }}>{s.value}</div>
                    </PaperCard>
                    </button>
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

            {lifeSuggestions.length > 0 && (
                <PaperCard className="p-4">
                    <SectionTag en="coach">首页建议</SectionTag>
                    <div className="mt-3 grid gap-2">
                        {lifeSuggestions.map(s => (
                            <button key={s.id} onClick={() => setActiveTab(s.tab)} className="text-left rounded-2xl px-3 py-2 press-soft" style={{ background: '#faf8f5', color: '#4a4750' }}>
                                <div className="font-black" style={{ color: INK }}>{s.title}</div>
                                <div className="text-[11px] mt-0.5">{s.detail}</div>
                            </button>
                        ))}
                    </div>
                </PaperCard>
            )}

            <PaperCard className="p-4">
                <SectionTag en="today">今日事件</SectionTag>
                <div className="space-y-2.5 mt-3">
                    {life.events.slice(0, 6).map(ev => (
                        <button key={ev.id} onClick={() => setBankModal({ kind: 'eventDetail', eventId: ev.id })} className="w-full flex items-start gap-2 text-[12px] text-left active:scale-[0.99] transition-transform">
                            <span className="mt-0.5 w-5 h-5 rounded-full flex items-center justify-center text-[10px] shrink-0" style={{ background: ev.tone === 'good' ? '#dcfce7' : ev.tone === 'bad' ? '#ffe4e6' : ev.tone === 'warn' ? '#fef3c7' : '#f1f5f9', color: ev.tone === 'good' ? '#15803d' : ev.tone === 'bad' ? '#be123c' : ev.tone === 'warn' ? '#92400e' : INK_SOFT }}>{ev.tone === 'good' ? '✓' : ev.tone === 'bad' ? '!' : ev.tone === 'warn' ? '△' : '·'}</span>
                            <div className="flex-1 min-w-0">
                                <div className="font-bold truncate" style={{ color: INK }}>{ev.title} <span className="font-normal" style={{ color: INK_SOFT }}>{ev.dateStr}</span></div>
                                <div className="leading-relaxed" style={{ color: '#5a5660' }}>{ev.detail}</div>
                            </div>
                            {ev.amount !== undefined && <span className="font-black shrink-0" style={{ color: ev.amount >= 0 ? '#16a34a' : '#e11d48' }}>{ev.amount >= 0 ? '+' : '-'}¥{Math.abs(ev.amount)}</span>}
                        </button>
                    ))}
                </div>
            </PaperCard>

            <PaperCard className="p-4">
                <SectionTag en="ledger">最近流水</SectionTag>
                <div className="mt-2">
                    {transactions.slice(0, 5).map(tx => (
                        <button key={tx.id} onClick={() => setBankModal({ kind: 'transactionDetail', txId: tx.id })} className="w-full flex items-center justify-between py-2 text-[12px] border-b last:border-0 text-left active:scale-[0.99] transition-transform" style={{ borderColor: 'rgba(43,41,51,0.06)' }}>
                            <span className="truncate pr-2">{tx.note}<span style={{ color: INK_SOFT }}> · {tx.sourceApp || '手动'}</span></span>
                            <span className="font-black shrink-0" style={{ color: tx.type === 'income' ? '#16a34a' : '#e11d48' }}>{tx.type === 'income' ? '+' : '-'}¥{tx.amount}</span>
                        </button>
                    ))}
                </div>
            </PaperCard>
        </div>
    );

    const renderJobs = () => (
        <BankJobCenter
            life={life}
            walletBalance={userProfile.balance || 0}
            jobPostings={allJobPostings}
            jobCategories={JOB_CATEGORIES}
            jobCategory={jobCategory}
            onJobCategoryChange={setJobCategory}
            selectedJobId={selectedJobId}
            onSelectJob={setSelectedJobId}
            selectedApplicationId={selectedApplicationId}
            onSelectApplication={setSelectedApplicationId}
            jobSearchQuery={jobSearchQuery}
            onJobSearchQueryChange={setJobSearchQuery}
            resumeDraft={resumeDraft}
            onResumeDraftChange={setResumeDraft}
            aiBusy={aiBusy}
            onSaveResume={handleSaveResume}
            onGenerateAiJobs={handleGenerateAiJobs}
            onStartApplication={handleStartJobApplication}
            onAdvanceApplication={handleAdvanceJobApplication}
            onSendRecruiterMessage={handleSendRecruiterMessage}
            onDeclineApplication={handleDeclineJobApplication}
            onLeaveJob={handleLeaveJob}
        />
    );

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
                        <button onClick={() => setBankModal({ kind: 'stockDetail', symbol: q.symbol })} className="w-full py-2 text-[12px] font-black" style={chipStyle(false)}>查看行情详情 / 风险</button>
                        {renderStockChart(q)}
                        <div className="grid grid-cols-3 gap-2 text-center">
                            <div className="rounded-2xl py-2" style={{ background: '#faf8f5' }}><div className="text-[13px] font-black">{q.intraday?.[q.intraday.length - 1]?.time || '15:00'}</div><div className="text-[10px]" style={{ color: INK_SOFT }}>分时</div></div>
                            <div className="rounded-2xl py-2" style={{ background: '#faf8f5' }}><div className="text-[13px] font-black">{q.history?.[q.history.length - 1]?.volume.toLocaleString() || 0}</div><div className="text-[10px]" style={{ color: INK_SOFT }}>成交量</div></div>
                            <div className="rounded-2xl py-2" style={{ background: '#faf8f5' }}><div className="text-[13px] font-black">{life.watchlist.includes(q.symbol) ? '已加' : '未加'}</div><div className="text-[10px]" style={{ color: INK_SOFT }}>自选</div></div>
                        </div>
                        <p className="text-[12px] rounded-2xl px-3 py-2" style={{ color: '#4a4750', background: '#faf8f5' }}>{q.aiReason || q.news}</p>
                        {(q.newsList || []).slice(0, 3).map(n => (
                            <div key={n.id} className="text-[11px] rounded-2xl px-3 py-2" style={{ background: '#fff7ed', color: '#9a3412' }}><b>{n.source}：</b>{n.title}</div>
                        ))}
                        <div className="flex flex-wrap gap-1.5">{(q.eventTags || []).map(tag => <CleanBadge key={tag} tone="blue">{tag}</CleanBadge>)}</div>
                        {hold && <div className="text-[11px]" style={{ color: INK_SOFT }}>持仓 {hold.shares} 股 · 成本 ¥{hold.avgCost} · 浮盈亏 <b style={{ color: pnl >= 0 ? '#e11d48' : '#16a34a' }}>{pnl >= 0 ? '+' : ''}¥{pnl}</b></div>}
                        <div className="grid grid-cols-2 gap-2">
                            <div className="flex gap-1.5">
                                <input type="number" value={stockBudget[q.symbol] || ''} onChange={e => setStockBudget(prev => ({ ...prev, [q.symbol]: e.target.value }))} placeholder="买入金额" className="min-w-0 flex-1 px-3 py-2 text-[12px] outline-none" style={hbInputStyle} />
                                <button onClick={() => setBankModal({ kind: 'stockOrder', side: 'buy', symbol: q.symbol })} className="px-3 text-[12px] font-black" style={smallBtn('#f43f5e')}>买</button>
                            </div>
                            <div className="flex gap-1.5">
                                <input type="number" value={stockSellShares[q.symbol] || ''} onChange={e => setStockSellShares(prev => ({ ...prev, [q.symbol]: e.target.value }))} placeholder="卖出股数" className="min-w-0 flex-1 px-3 py-2 text-[12px] outline-none" style={hbInputStyle} />
                                <button onClick={() => setBankModal({ kind: 'stockOrder', side: 'sell', symbol: q.symbol })} className="px-3 text-[12px] font-black" style={smallBtn('#16a34a')}>卖</button>
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
                    <button onClick={() => setBankModal({ kind: 'companyFound' })} className="w-full py-2.5 text-[14px] font-black active:scale-95 transition-transform" style={smallBtn('#8b5cf6')}>投入 ¥{COMPANY_FOUND_COST}</button>
                </PaperCard>
            ) : (
                <>
                    <PaperCard className="p-4">
                        <div className="flex justify-between gap-3">
                            <div className="min-w-0">
                                <div className="text-[20px] font-black truncate" style={{ color: INK, fontFamily: HAND_FONT }}>{life.company.name}</div>
                                <div className="text-[11px]" style={{ color: INK_SOFT }}>{life.company.direction} · 员工 {life.company.employees}</div>
                            </div>
                            <button onClick={() => setBankModal({ kind: 'companyDividend' })} className="px-3 py-2 text-[12px] font-black active:scale-95 transition-transform" style={smallBtn('#16a34a')}>分红</button>
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
                                {life.company.pendingIssue.options.map(opt => <button key={opt.id} onClick={() => setBankModal({ kind: 'companyIssue', optionId: opt.id })} className="py-2 text-[12px] font-black active:scale-95 transition-transform" style={smallBtn(opt.cashDelta >= 0 ? '#16a34a' : '#f43f5e')}>{opt.label}</button>)}
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
                        return <button key={ch} onClick={() => { setLoanChannel(ch); setBankModal({ kind: 'loanProduct', channel: ch }); }} className="p-3 text-left press-soft" style={{ ...cleanCardStyle, borderColor: loanChannel === ch ? '#f43f5e' : 'rgba(43,41,51,0.06)' }}>
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
                        <button onClick={() => setBankModal({ kind: 'loanApply' })} className="px-4 text-[13px] font-black active:scale-95 transition-transform" style={smallBtn('#f43f5e')}>{aiBusy === 'loan' ? '审核中…' : '申请'}</button>
                    </div>
                </PaperCard>
                {selectedLoan && (
                    <PaperCard className="p-4 space-y-3">
                        <SectionTag en="repay">还款计划</SectionTag>
                        {selectedLoan.reviewReason && <div className="rounded-2xl px-3 py-2 text-[12px]" style={{ background: '#f5f3ff', color: '#4c1d95' }}>审核意见：{selectedLoan.reviewReason}</div>}
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
                            <button onClick={() => setBankModal({ kind: 'loanRepay', loanId: selectedLoan.id })} className="px-4 text-[13px] font-black active:scale-95 transition-transform" style={smallBtn('#16a34a')}>还款</button>
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
                                <div className="text-[12px] mt-1" style={{ color: INK_SOFT }}>启动金 ¥{selectedBusiness.startupCost} · 总部精力 {BANK_OPEN_BRANCH_ENERGY_COST}</div>
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
                                            <div className="text-[10px]" style={{ color: INK_SOFT }}>¥{b.startupCost} · 毛利 {Math.round(b.margin * 100)}% · 风险 {b.risk}/5</div>
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
                        <button onClick={() => setBankModal({ kind: 'shopUnlock' })} className="w-full py-3 text-[15px] font-black active:scale-95 transition-transform" style={smallBtn('#f43f5e')}>
                            投入 ¥{selectedBusiness.startupCost} 开始营业
                        </button>
                    </PaperCard>
                </div>
            );
        }

        const products = life.shopProducts?.length ? life.shopProducts : tpl.products.map(p => ({ ...p, stock: 8 }));
        return (
            <div className="flex-1 overflow-hidden flex flex-col">
                <div className="px-3.5 pt-3 shrink-0">
                    <PaperCard className="p-3 space-y-3">
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
                        <div className="grid grid-cols-3 gap-2 text-[11px]">
                            <div className="rounded-2xl px-3 py-2" style={{ background: '#faf8f5', color: INK_SOFT }}><b style={{ color: INK }}>总部</b><br />{shopPortfolio?.headquartersEnergy ?? 0} 精力</div>
                            <div className="rounded-2xl px-3 py-2" style={{ background: '#faf8f5', color: INK_SOFT }}><b style={{ color: INK }}>当前店</b><br />{state.shop.actionPoints || 0} 精力</div>
                            <div className="rounded-2xl px-3 py-2" style={{ background: '#faf8f5', color: INK_SOFT }}><b style={{ color: INK }}>分店</b><br />{shopBranches.length || 1} 家</div>
                        </div>
                        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-0.5">
                            {shopBranches.map(branch => {
                                const branchTpl = BUSINESS_TEMPLATES.find(b => b.id === branch.businessTypeId) || BUSINESS_TEMPLATES[0];
                                const active = branch.id === activeShopId;
                                return (
                                    <button key={branch.id} onClick={() => { void handleSwitchBankShop(branch.id); }} className="shrink-0 px-3 py-2 text-left active:scale-95 transition-transform" style={chipStyle(active)}>
                                        <span className="text-[12px] font-black">{branchTpl.icon} {branch.shop.shopName}</span>
                                        <span className="block text-[10px] opacity-75">Lv.{branch.shop.shopLevel || 1} · {branch.shop.actionPoints || 0} 精力</span>
                                    </button>
                                );
                            })}
                            <button onClick={() => { setNewShopName(''); setBankModal({ kind: 'shopUnlock' }); }} className="shrink-0 px-3 py-2 text-[12px] font-black active:scale-95 transition-transform" style={chipStyle(false)}>
                                + 开新店
                            </button>
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
                                onConsumeDecorEnergy={consumeHeadquartersEnergy}
                                updateState={async (updater) => {
                                    const nextState = { ...stateRef.current, shop: updater(stateRef.current.shop) };
                                    await commitBankState(nextState);
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
                                <button onClick={() => setShowRegulars(true)} className="absolute left-3 z-40 flex items-center gap-1.5 px-3 py-2 rounded-full active:scale-95 transition-all" style={{ bottom: 'max(58px, calc(var(--safe-bottom, 0px) + 24px))', background: 'rgba(255,255,255,0.95)', boxShadow: '0 8px 20px -12px rgba(38,38,38,0.42)' }}>
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
                                <button onClick={handleCollectIdle} className="absolute left-1/2 -translate-x-1/2 z-40 flex items-center gap-1.5 px-3.5 py-2 rounded-full active:scale-95 transition-transform animate-bounce" style={{ bottom: 'max(60px, calc(var(--safe-bottom, 0px) + 26px))', background: 'linear-gradient(135deg,#ffe08a,#f3b24a)', boxShadow: '0 6px 16px rgba(220,160,40,0.45)' }}>
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
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <SectionTag en="daily">经营日课</SectionTag>
                                    <div className="text-[11px] mt-1" style={{ color: INK_SOFT }}>总部精力和当前店精力分开恢复</div>
                                </div>
                                <CleanBadge tone="amber">{life.dateStr.slice(5)}</CleanBadge>
                            </div>
                            <div className="grid grid-cols-3 gap-2 mt-3 max-[420px]:grid-cols-1">
                                {([
                                    ['headquartersPatrol', '每日巡店', '+25 总部', !!dailyRewards?.headquartersPatrol],
                                    ['shelf', '整理货架', '+18 当前店', !!dailyRewards?.shelfByShopId?.[activeShopId]],
                                    ['review', '营业复盘', '+10 当前店', !!dailyRewards?.reviewByShopId?.[activeShopId]],
                                ] as const).map(([kind, label, gain, claimed]) => (
                                    <button
                                        key={kind}
                                        disabled={claimed}
                                        onClick={() => { void handleClaimShopDailyReward(kind); }}
                                        className="rounded-2xl px-3 py-2 text-left active:scale-95 transition-transform disabled:opacity-55"
                                        style={{ background: claimed ? '#f5f3ef' : '#faf8f5', color: claimed ? INK_SOFT : INK, border: '1px solid rgba(43,41,51,0.06)' }}
                                    >
                                        <div className="text-[12px] font-black">{label}</div>
                                        <div className="text-[10px]" style={{ color: INK_SOFT }}>{claimed ? '今日已领' : gain}</div>
                                    </button>
                                ))}
                            </div>
                        </PaperCard>
                        <PaperCard className="p-4">
                            <SectionTag en="goods">今日货架</SectionTag>
                            <div className="grid grid-cols-2 gap-2 mt-3">
                                {products.map(p => (
                                    <div key={p.id} className="rounded-2xl p-3 text-[12px]" style={{ background: '#faf8f5' }}>
                                        <div className="font-black truncate" style={{ color: INK }}>{p.name}</div>
                                        <div className="mt-1 flex justify-between" style={{ color: INK_SOFT }}><span>售价 ¥{p.price}</span><span>库存 {p.stock}</span></div>
                                        <button onClick={() => setBankModal({ kind: 'shopRestock', productId: p.id })} className="mt-2 w-full py-1.5 text-[11px] font-black active:scale-95 transition-transform" style={chipStyle(false)}>
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
                                <button onClick={() => setBankModal({ kind: 'shopUpgrade' })} className="px-3 py-2 text-[12px] font-black active:scale-95 transition-transform" style={smallBtn('#16a34a')}>
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

    const renderImmersiveModal = () => {
        const modal = bankModal;
        const close = () => setBankModal(null);
        const confirmBtn = (label: string, onClick: () => void | Promise<void>, bg = INK) => (
            <button onClick={() => { void onClick(); }} className="w-full py-3 text-[14px] font-black active:scale-95 transition-transform" style={smallBtn(bg)}>
                {label}
            </button>
        );

        if (!modal) return null;
        if (modal.kind === 'actionResult') {
            return <BankActionResultModal result={modal.result} currency={state.config.currencySymbol} onClose={close} />;
        }
        if (modal.kind === 'history') {
            return (
                <BankActionHistoryDrawer
                    open
                    records={life.actionHistory || []}
                    onClose={close}
                    onSelect={(record) => setBankModal({ kind: 'recordDetail', record })}
                />
            );
        }
        if (modal.kind === 'recordDetail') {
            return (
                <BankModal open title={modal.record.title} sub={`${modal.record.category} · ${modal.record.dateStr}`} onClose={close}>
                    <BankActionResultView result={actionRecordToResult(modal.record)} currency={state.config.currencySymbol} />
                </BankModal>
            );
        }
        if (modal.kind === 'eventDetail') {
            const ev = life.events.find(e => e.id === modal.eventId);
            return (
                <BankModal open title={ev?.title || '事件详情'} sub={ev?.dateStr} onClose={close}>
                    {ev ? <div className="space-y-3">
                        <p className="rounded-2xl p-3 text-[13px] leading-relaxed" style={{ background: '#faf8f5', color: '#4a4750' }}>{ev.detail}</p>
                        <BankMetricGrid items={[
                            { label: '类型', value: ev.tone || 'info', tone: ev.tone || 'info' },
                            ...(typeof ev.amount === 'number' ? [{ label: '金额影响', value: `${ev.amount >= 0 ? '+' : '-'}${state.config.currencySymbol}${Math.abs(Math.round(ev.amount))}`, tone: ev.amount >= 0 ? 'good' as const : 'warn' as const }] : []),
                        ]} />
                    </div> : <div className="text-[12px]" style={{ color: INK_SOFT }}>这条事件已经不在最近记录里。</div>}
                </BankModal>
            );
        }
        if (modal.kind === 'transactionDetail') {
            const tx = transactions.find(t => t.id === modal.txId);
            return (
                <BankModal open title={tx?.note || '流水详情'} sub={tx?.dateStr} onClose={close}>
                    {tx ? <div className="space-y-3">
                        <BankMetricGrid items={[
                            { label: '金额', value: `${tx.type === 'income' ? '+' : '-'}${state.config.currencySymbol}${tx.amount}`, tone: tx.type === 'income' ? 'good' : 'warn' },
                            { label: '分类', value: tx.category || 'general' },
                            { label: '来源', value: tx.sourceApp || '手动记录' },
                            { label: '时间', value: new Date(tx.timestamp).toLocaleString() },
                        ]} />
                        {tx.charComment && <p className="rounded-2xl p-3 text-[12px] leading-relaxed" style={{ background: '#f5f3ff', color: '#4c1d95' }}><b>{tx.charComment.charName}：</b>{tx.charComment.text}</p>}
                    </div> : <div className="text-[12px]" style={{ color: INK_SOFT }}>这笔流水已经被删除。</div>}
                </BankModal>
            );
        }
        if (modal.kind === 'goalDetail') {
            const goal = state.goals.find(g => g.id === modal.goalId);
            const pct = goal ? Math.min(100, Math.round((goal.currentAmount / Math.max(1, goal.targetAmount)) * 100)) : 0;
            return (
                <BankModal open title={goal?.name || '心愿详情'} sub="攒钱目标" onClose={close}>
                    {goal ? <div className="space-y-3">
                        <BankMetricGrid items={[
                            { label: '目标金额', value: `${state.config.currencySymbol}${goal.targetAmount}` },
                            { label: '已攒', value: `${state.config.currencySymbol}${goal.currentAmount}`, tone: 'good' },
                            { label: '进度', value: `${pct}%` },
                            { label: '状态', value: goal.isCompleted ? '已完成' : '进行中', tone: goal.isCompleted ? 'good' : 'info' },
                        ]} />
                        <div className="h-2 rounded-full overflow-hidden" style={{ background: '#efece7' }}><div className="h-full" style={{ width: `${pct}%`, background: '#16a34a' }} /></div>
                    </div> : <div className="text-[12px]" style={{ color: INK_SOFT }}>这个心愿已经不在列表里。</div>}
                </BankModal>
            );
        }
        if (modal.kind === 'dashboardInsight') {
            return (
                <BankModal open title="首页看板复盘" sub="现金流、状态、经营和风险先过一遍" onClose={close} footer={confirmBtn(aiBusy === 'dashboard' ? 'AI 复盘中…' : '生成 AI 复盘', handleDashboardInsight, '#f43f5e')}>
                    <div className="space-y-3">
                        <BankMetricGrid items={[
                            { label: '钱包', value: `${state.config.currencySymbol}${Math.round(userProfile.balance || 0)}`, tone: 'good' },
                            { label: '净资产', value: `${state.config.currencySymbol}${netWorth}` },
                            { label: '股票市值', value: `${state.config.currencySymbol}${Math.round(stockValue)}`, tone: stockValue > 0 ? 'info' : 'good' },
                            { label: '负债', value: `${state.config.currencySymbol}${Math.round(debtValue)}`, tone: debtValue > 0 ? 'warn' : 'good' },
                            { label: '疲劳', value: `${life.fatigue}/100`, tone: life.fatigue > 70 ? 'warn' : 'info' },
                            { label: '声誉', value: `${life.reputation}/100` },
                        ]} />
                        <div className="space-y-2">
                            {lifeSuggestions.map(s => <button key={s.id} onClick={() => { setActiveTab(s.tab); close(); }} className="w-full rounded-2xl px-3 py-2 text-left text-[12px]" style={{ background: '#faf8f5', color: '#4a4750' }}><b style={{ color: INK }}>{s.title}</b><div>{s.detail}</div></button>)}
                        </div>
                    </div>
                </BankModal>
            );
        }
        if (modal.kind === 'shopUnlock') {
            return (
                <BankModal open title={life.shopUnlocked ? '开新分店' : '开店确认'} sub="本版支持同业态重复开分店，暂不支持关店" onClose={close} footer={confirmBtn(`投入 ${state.config.currencySymbol}${selectedBusiness.startupCost} 开店`, handleUnlockLifeShop, '#f43f5e')}>
                    <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                            <div><FieldLabel>店铺名字</FieldLabel><input value={newShopName} onChange={e => setNewShopName(e.target.value)} placeholder={getDefaultBankBranchName(selectedBusiness.id, shopBranches)} className="w-full px-3 py-2 outline-none" style={bankModalInputStyle} /></div>
                            <div><FieldLabel>业态</FieldLabel><div className="px-3 py-2 text-[13px] font-black" style={bankModalInputStyle}>{selectedBusiness.icon} {selectedBusiness.name}</div></div>
                        </div>
                        <p className="rounded-2xl p-3 text-[12px] leading-relaxed" style={{ background: '#faf8f5', color: '#4a4750' }}>{selectedBusiness.vibe}</p>
                        <BankMetricGrid items={[
                            { label: '启动金', value: `${state.config.currencySymbol}${selectedBusiness.startupCost}`, tone: 'warn' },
                            { label: '总部精力', value: `${BANK_OPEN_BRANCH_ENERGY_COST}`, tone: (shopPortfolio?.headquartersEnergy || 0) >= BANK_OPEN_BRANCH_ENERGY_COST ? 'good' : 'warn' },
                            { label: '毛利', value: `${Math.round(selectedBusiness.margin * 100)}%` },
                            { label: '风险', value: `${selectedBusiness.risk}/5`, tone: selectedBusiness.risk >= 4 ? 'warn' : 'info' },
                            { label: '钱包', value: `${state.config.currencySymbol}${Math.round(userProfile.balance || 0)}` },
                        ]} />
                    </div>
                </BankModal>
            );
        }
        if (modal.kind === 'shopRestock') {
            const product = life.shopProducts?.find(p => p.id === modal.productId);
            const cost = product ? Math.max(1, Math.round(product.cost * RESTOCK_BATCH)) : 0;
            return (
                <BankModal open title="补货确认" sub="补货会立刻从钱包扣除虚拟成本" onClose={close} footer={confirmBtn(`确认补货 ${RESTOCK_BATCH} 份`, () => handleRestockLifeProduct(modal.productId), '#16a34a')}>
                    {product ? <BankMetricGrid items={[
                        { label: '商品', value: product.name },
                        { label: '当前库存', value: `${product.stock}` },
                        { label: '补货后', value: `${Math.min(STOCK_CAP, product.stock + RESTOCK_BATCH)}` },
                        { label: '成本', value: `${state.config.currencySymbol}${cost}`, tone: 'warn' },
                    ]} /> : <div className="text-[12px]" style={{ color: INK_SOFT }}>这个商品已经不在货架上。</div>}
                </BankModal>
            );
        }
        if (modal.kind === 'shopUpgrade') {
            const level = state.shop.shopLevel || 1;
            const cost = shopUpgradeCost(level);
            return (
                <BankModal open title="店铺升级" sub="升级会提升客流、溢价和挂机收入" onClose={close} footer={confirmBtn(level >= MAX_SHOP_LEVEL ? '已经满级' : `支付 ${state.config.currencySymbol}${cost} 升级`, handleUpgradeShop, '#16a34a')}>
                    <BankMetricGrid items={[
                        { label: '当前等级', value: `Lv.${level}` },
                        { label: '升级后', value: `Lv.${Math.min(MAX_SHOP_LEVEL, level + 1)}`, tone: 'good' },
                        { label: '费用', value: `${state.config.currencySymbol}${cost}`, tone: 'warn' },
                        { label: '钱包', value: `${state.config.currencySymbol}${Math.round(userProfile.balance || 0)}` },
                    ]} />
                </BankModal>
            );
        }
        if (modal.kind === 'stockDetail' || modal.kind === 'stockOrder') {
            const quote = life.stockMarket.find(s => s.symbol === modal.symbol);
            const hold = quote ? life.holdings[quote.symbol] : undefined;
            if (!quote) return <BankModal open title="股票详情" onClose={close}>没有找到这只虚拟股票。</BankModal>;
            if (modal.kind === 'stockDetail') {
                return (
                    <BankModal open title={`${quote.name} ${quote.symbol}`} sub={`${quote.industry} · 虚拟行情`} onClose={close} wide footer={confirmBtn(aiBusy === 'invest' ? 'AI 分析中…' : '生成 AI 风险点评', async () => {
                        let result = createBankActionResult({
                            category: 'invest',
                            kind: 'invest-advice',
                            title: `${quote.name} 行情点评`,
                            summary: quote.aiReason || quote.news,
                            tone: quote.risk >= 4 ? 'warn' : 'info',
                            riskTags: quote.risk >= 4 ? ['高波动', '虚拟投资'] : ['虚拟投资'],
                            metrics: [
                                { label: '价格', value: `${state.config.currencySymbol}${quote.price}` },
                                { label: '涨跌', value: `${quote.changePct >= 0 ? '+' : ''}${quote.changePct}%`, tone: quote.changePct >= 0 ? 'good' : 'warn' },
                                { label: '风险', value: `${quote.risk}/5`, tone: quote.risk >= 4 ? 'warn' : 'info' },
                                { label: '持仓', value: hold ? `${hold.shares} 股` : '未持仓' },
                            ],
                            payload: { symbol: quote.symbol },
                        });
                        result = await enrichResultWithAi(result, 'invest', () => generateAiInvestAdvice(auxApi, life, quote));
                        await persistStandaloneActionResult(result);
                    }, '#0284c7')}>
                        <div className="space-y-3">
                            {renderStockChart(quote)}
                            <BankMetricGrid items={[
                                { label: '现价', value: `${state.config.currencySymbol}${quote.price}` },
                                { label: '涨跌', value: `${quote.changePct >= 0 ? '+' : ''}${quote.changePct}%`, tone: quote.changePct >= 0 ? 'good' : 'warn' },
                                { label: '风险', value: `${quote.risk}/5`, tone: quote.risk >= 4 ? 'warn' : 'info' },
                                { label: '持仓', value: hold ? `${hold.shares} 股` : '未持仓' },
                            ]} />
                            <p className="rounded-2xl p-3 text-[12px] leading-relaxed" style={{ background: '#faf8f5', color: '#4a4750' }}>{quote.aiReason || quote.news}</p>
                            <div className="flex flex-wrap gap-1.5">{(quote.eventTags || []).map(tag => <BankBadge key={tag} tone="info">{tag}</BankBadge>)}</div>
                        </div>
                    </BankModal>
                );
            }
            const side = modal.side;
            const rawAmount = side === 'buy' ? Number(stockBudget[quote.symbol]) : Number(stockSellShares[quote.symbol] || hold?.shares || 0);
            const fee = side === 'buy' ? Math.max(1, Math.round((Number.isFinite(rawAmount) ? rawAmount : 0) * 0.003)) : Math.max(1, Math.round((Number.isFinite(rawAmount) ? rawAmount : 0) * quote.price * 0.003));
            const estimatedShares = side === 'buy' ? Math.max(0, Math.floor((((Number.isFinite(rawAmount) ? rawAmount : 0) - fee) / quote.price) * 1000) / 1000) : Math.min(hold?.shares || 0, Number.isFinite(rawAmount) ? rawAmount : 0);
            return (
                <BankModal open title={side === 'buy' ? `买入 ${quote.name}` : `卖出 ${quote.name}`} sub="订单会按当前虚拟行情撮合" onClose={close} footer={confirmBtn(side === 'buy' ? '确认买入' : '确认卖出', () => side === 'buy' ? handleBuyStock(quote.symbol) : handleSellStock(quote.symbol), side === 'buy' ? '#f43f5e' : '#16a34a')}>
                    <div className="space-y-3">
                        <div><FieldLabel>{side === 'buy' ? '买入金额' : '卖出股数'}</FieldLabel><input type="number" value={side === 'buy' ? stockBudget[quote.symbol] || '' : stockSellShares[quote.symbol] || ''} onChange={e => side === 'buy' ? setStockBudget(prev => ({ ...prev, [quote.symbol]: e.target.value })) : setStockSellShares(prev => ({ ...prev, [quote.symbol]: e.target.value }))} className="w-full px-3 py-2 outline-none" style={bankModalInputStyle} /></div>
                        <BankMetricGrid items={[
                            { label: '现价', value: `${state.config.currencySymbol}${quote.price}` },
                            { label: '预计份额', value: `${estimatedShares} 股` },
                            { label: '手续费估算', value: `${state.config.currencySymbol}${fee}`, tone: 'warn' },
                            { label: '持仓', value: hold ? `${hold.shares} 股` : '未持仓' },
                        ]} />
                        <div className="flex flex-wrap gap-1.5"><BankBadge tone={quote.risk >= 4 ? 'warn' : 'info'}>风险 {quote.risk}/5</BankBadge><BankBadge tone="default">虚拟投资</BankBadge></div>
                    </div>
                </BankModal>
            );
        }
        if (modal.kind === 'companyFound') {
            return (
                <BankModal open title="创办公司确认" sub="启动资金会进入公司现金池" onClose={close} footer={confirmBtn(`投入 ${state.config.currencySymbol}${COMPANY_FOUND_COST}`, handleFoundCompany, '#8b5cf6')}>
                    <BankMetricGrid items={[
                        { label: '公司名', value: companyName || `${companyDirection}小公司` },
                        { label: '方向', value: companyDirection },
                        { label: '启动资金', value: `${state.config.currencySymbol}${COMPANY_FOUND_COST}`, tone: 'warn' },
                        { label: '钱包', value: `${state.config.currencySymbol}${Math.round(userProfile.balance || 0)}` },
                    ]} />
                </BankModal>
            );
        }
        if (modal.kind === 'companyIssue') {
            const issue = life.company?.pendingIssue;
            const opt = issue?.options.find(o => o.id === modal.optionId);
            return (
                <BankModal open title={issue?.title || '公司事项'} sub={issue?.description} onClose={close} footer={opt ? confirmBtn(`选择：${opt.label}`, () => handleCompanyIssue(opt.id), opt.cashDelta >= 0 ? '#16a34a' : '#f43f5e') : undefined}>
                    {opt ? <BankMetricGrid items={[
                        { label: '方案', value: opt.label },
                        { label: '现金变化', value: `${opt.cashDelta >= 0 ? '+' : '-'}${state.config.currencySymbol}${Math.abs(opt.cashDelta)}`, tone: opt.cashDelta >= 0 ? 'good' : 'warn' },
                        { label: '声誉变化', value: `${opt.reputationDelta >= 0 ? '+' : ''}${opt.reputationDelta}` },
                        { label: '压力变化', value: `${opt.stressDelta >= 0 ? '+' : ''}${opt.stressDelta}`, tone: opt.stressDelta > 0 ? 'warn' : 'good' },
                    ]} /> : <div className="text-[12px]" style={{ color: INK_SOFT }}>这件事项已经处理过。</div>}
                </BankModal>
            );
        }
        if (modal.kind === 'companyDividend') {
            const company = life.company;
            const amount = company ? Math.max(0, Math.floor((company.cash - COMPANY_FOUND_COST) * 0.35)) : 0;
            return (
                <BankModal open title="公司分红确认" sub="只分配安全垫以上的一部分现金" onClose={close} footer={confirmBtn(amount > 0 ? `确认分红 ${state.config.currencySymbol}${amount}` : '暂无可分红', handleCompanyDividend, '#16a34a')}>
                    <BankMetricGrid items={[
                        { label: '公司现金', value: `${state.config.currencySymbol}${Math.round(company?.cash || 0)}` },
                        { label: '安全垫', value: `${state.config.currencySymbol}${COMPANY_FOUND_COST}` },
                        { label: '预计到账', value: `${state.config.currencySymbol}${amount}`, tone: amount > 0 ? 'good' : 'warn' },
                    ]} />
                </BankModal>
            );
        }
        if (modal.kind === 'loanProduct' || modal.kind === 'loanApply') {
            const channel = modal.kind === 'loanProduct' ? modal.channel : loanChannel;
            const product = LOAN_PRODUCTS[channel];
            return (
                <BankModal open title={product.name} sub="Moro 内虚拟借款合同，不连接真实机构" onClose={close} footer={modal.kind === 'loanApply' ? confirmBtn(aiBusy === 'loan' ? '审核中…' : '提交审核', handleBorrowLoan, '#f43f5e') : confirmBtn('按这个产品申请', () => { setLoanChannel(channel); setBankModal({ kind: 'loanApply' }); }, '#f43f5e')}>
                    <div className="space-y-3">
                        <div><FieldLabel>申请金额</FieldLabel><input type="number" value={loanAmount} onChange={e => setLoanAmount(e.target.value)} className="w-full px-3 py-2 outline-none" style={bankModalInputStyle} /></div>
                        <BankMetricGrid items={[
                            { label: '额度', value: `${state.config.currencySymbol}${product.min}-${product.max}` },
                            { label: '日息', value: `${(product.dailyRate * 100).toFixed(3)}%`, tone: channel === 'shady' ? 'warn' : 'info' },
                            { label: '期限', value: `${product.days} 天` },
                            { label: '渠道', value: channelLabel(channel), tone: channel === 'shady' ? 'warn' : 'info' },
                        ]} />
                        <p className="rounded-2xl p-3 text-[12px] leading-relaxed" style={{ background: channel === 'shady' ? '#fff1f2' : '#faf8f5', color: channel === 'shady' ? '#be123c' : '#4a4750' }}>{product.review}</p>
                        <div className="flex flex-wrap gap-1.5">{product.terms.map(term => <BankBadge key={term} tone={channel === 'shady' ? 'warn' : 'default'}>{term}</BankBadge>)}</div>
                    </div>
                </BankModal>
            );
        }
        if (modal.kind === 'loanRepay') {
            const loan = life.loans.find(l => l.id === modal.loanId);
            const due = loan ? Math.round(loan.outstanding + loan.interestDue) : 0;
            return (
                <BankModal open title="还款确认" sub="还款会优先抵扣利息，再抵扣本金" onClose={close} footer={loan ? confirmBtn('确认还款', () => handleRepayLoan(loan.id), '#16a34a') : undefined}>
                    {loan ? <div className="space-y-3">
                        <div><FieldLabel>还款金额</FieldLabel><input type="number" value={loanRepayAmount[loan.id] || ''} onChange={e => setLoanRepayAmount(prev => ({ ...prev, [loan.id]: e.target.value }))} placeholder={`${due}`} className="w-full px-3 py-2 outline-none" style={bankModalInputStyle} /></div>
                        <BankMetricGrid items={[
                            { label: '产品', value: loan.note },
                            { label: '应还合计', value: `${state.config.currencySymbol}${due}`, tone: 'warn' },
                            { label: '利息', value: `${state.config.currencySymbol}${Math.round(loan.interestDue)}` },
                            { label: '到期日', value: loan.dueDate },
                        ]} />
                    </div> : <div className="text-[12px]" style={{ color: INK_SOFT }}>这笔借款已经结清。</div>}
                </BankModal>
            );
        }
        return null;
    };

    return (
        <div className="h-full w-full flex flex-col relative overflow-hidden" style={{ background: PAGE_BG, color: INK }}>
            <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-64 z-0" style={{ background: 'radial-gradient(120% 90% at 50% -28%, rgba(244,63,94,0.10), transparent 70%)' }} />

            <div className="relative shrink-0 z-[50] px-3.5 pt-3 pb-2.5">
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
                                <span className="text-[18px] font-black truncate" style={{ color: INK, fontFamily: HAND_FONT }}>人生拟</span>
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
            {/* Guestbook Overlay */}
            {showGuestbook && (
                <div className="absolute inset-0 z-[100] flex flex-col animate-slide-up" style={{ background: PAGE_BG }}>
                    <div className="pt-3 pb-3 px-4 shrink-0">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-[14px] flex items-center justify-center text-[18px] font-black" style={{ background: '#ffe4e6', color: '#be123c' }}>
                                    ✦
                                </div>
                                <div>
                                    <h2 className="text-base font-black tracking-wide" style={{ color: INK }}>店里来信</h2>
                                    <p className="text-[10px] tracking-[0.2em] uppercase" style={{ color: INK_SOFT }}>guest notes</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setShowGuestbook(false)}
                                className="w-9 h-9 rounded-full flex items-center justify-center active:scale-95 transition-all text-lg font-bold"
                                style={{ background: '#fff', color: INK, border: '1px solid rgba(43,41,51,0.06)' }}
                            >
                                ×
                            </button>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-5">
                        <div className="bg-white p-4 rounded-[22px] flex items-center justify-between gap-3" style={{ border: '1px solid rgba(43,41,51,0.06)', boxShadow: '0 1px 2px rgba(38,38,38,0.04), 0 18px 40px -30px rgba(38,38,38,0.30)' }}>
                            <div className="flex items-center gap-3">
                                <div className="w-11 h-11 rounded-[16px] flex items-center justify-center text-[18px]" style={{ background: '#faf8f5' }}>
                                    ✉
                                </div>
                                <div>
                                    <h3 className="font-black text-sm" style={{ color: INK }}>看看今天谁来过</h3>
                                    <p className="text-[10px] mt-0.5" style={{ color: INK_SOFT }}>花一点店员精力，收集新的留言</p>
                                </div>
                            </div>
                            <button
                                onClick={handleRefreshGuestbook}
                                disabled={isRefreshingGuestbook}
                                className="px-4 py-2.5 rounded-full font-black text-xs transition-all active:scale-95 disabled:opacity-50"
                                style={isRefreshingGuestbook ? chipStyle(false) : smallBtn('#f43f5e')}
                            >
                                {isRefreshingGuestbook ? (
                                    <span className="flex items-center gap-2">
                                        <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                                        等一等
                                    </span>
                                ) : '收新留言'}
                            </button>
                        </div>

                        {(!state.shop.guestbook || state.shop.guestbook.length === 0) ? (
                            <div className="text-center py-20">
                                <div className="text-5xl mb-4 opacity-50">✉</div>
                                <p className="text-sm font-black" style={{ color: INK_SOFT }}>留言板还很安静</p>
                                <p className="text-xs mt-1" style={{ color: '#aaa3ad' }}>开门久一点，来信会慢慢多起来。</p>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {state.shop.guestbook.map((msg, idx) => (
                                    <div
                                        key={msg.id}
                                        className="relative p-4 rounded-[22px] group animate-fade-in transition-all bg-white"
                                        style={{ border: msg.isChar ? '1px solid rgba(244,63,94,0.24)' : '1px solid rgba(43,41,51,0.06)', boxShadow: '0 1px 2px rgba(38,38,38,0.04), 0 14px 32px -28px rgba(38,38,38,0.25)' }}
                                    >
                                        <div className="flex justify-between items-start mb-2">
                                            <div className="flex items-center gap-2">
                                                {msg.isChar && (
                                                    <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] text-white" style={{ background: '#f43f5e' }}>★</span>
                                                )}
                                                <span className="font-black text-sm" style={{ color: msg.isChar ? '#be123c' : INK }}>
                                                    {msg.authorName}
                                                </span>
                                                <span className="text-[9px] px-2 py-0.5 rounded-full" style={{ color: INK_SOFT, background: '#f5f3ef' }}>
                                                    {new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-1.5">
                                                <button
                                                    onClick={() => handleDeleteGuestbookEntry(msg.id)}
                                                    className="opacity-0 group-hover:opacity-70 hover:!opacity-100 transition-opacity text-xs font-bold px-1.5 py-0.5 rounded-lg"
                                                    style={{ color: '#e11d48' }}
                                                    title="删除留言"
                                                >
                                                    ×
                                                </button>
                                            </div>
                                        </div>
                                        <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: '#4a4750' }}>
                                            {msg.content}
                                        </p>
                                        {msg.isChar && (
                                            <div className="mt-3">
                                                <span className="text-[9px] text-white px-3 py-1 rounded-full font-bold" style={{ background: '#f43f5e' }}>
                                                    熟人来过
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                ))}
                                <div className="text-center py-6 text-[10px]" style={{ color: INK_SOFT }}>
                                    今天的来信到这里
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            <div className="shrink-0 z-30 px-2.5 pt-2 relative" style={{ paddingBottom: 10 }}>
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

            {renderImmersiveModal()}

        </div>
    );
};

export default BankApp;

