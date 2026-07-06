import { describe, expect, it } from 'vitest';
import {
    COMPANY_FOUND_COST,
    BUSINESS_TEMPLATES,
    BANK_SHOP_CLOSE_HOUR,
    BANK_SHOP_DAILY_RESET_HOUR,
    JOB_POSTINGS,
    bankShopBusinessDateStr,
    canFoundCompany,
    canCloseBankShopAt,
    canOpenBankShopForDate,
    canSettleBankShopForDate,
    getBankShopCloseBlockReason,
    canUnlockLifeShop,
    advanceBankLifeDay,
    advanceJobApplicationStage,
    advanceJobApplicationStageWithAi,
    applyForJob,
    applyMarketPulses,
    appendJobChatMessage,
    appendBankActionRecord,
    borrowLoan,
    buildLifeSuggestions,
    createBankActionResult,
    computeCreditProfile,
    buyStock,
    createDefaultBankShopState,
    createDefaultBankLifeState,
    claimBankShopDailyReward,
    foundCompany,
    getDefaultBankBranchName,
    migrateBankShopPortfolioState,
    openBankShopBranch,
    prepareBankStateForSave,
    applyCompanyIssueWithResult,
    leaveJob,
    loanTotal,
    mergeAiJobPostings,
    migrateBankLifeState,
    markBankShopBusinessOpened,
    openLifeShop,
    repayLoan,
    sellStock,
    startJobApplication,
    switchActiveBankShop,
    updateResumeProfile,
    withdrawCompanyDividend,
} from './bankLife';
import { BankFullState } from '../types';

describe('bankLife', () => {
    it('only allows shop closing from 18:00 through the end of the day', () => {
        expect(BANK_SHOP_CLOSE_HOUR).toBe(18);
        expect(canCloseBankShopAt(new Date(2026, 0, 1, 17, 59))).toBe(false);
        expect(canCloseBankShopAt(new Date(2026, 0, 1, 18, 0))).toBe(true);
        expect(canCloseBankShopAt(new Date(2026, 0, 1, 23, 59))).toBe(true);
        expect(canCloseBankShopAt(new Date(2026, 0, 2, 0, 0))).toBe(false);
    });

    it('prioritizes too-early close feedback before already-closed feedback', () => {
        const closed = createDefaultBankShopState('测试小店');
        const opened = { ...closed, isBusinessOpen: true, openedBusinessDateStr: '2026-01-01' };

        expect(getBankShopCloseBlockReason(closed, new Date(2026, 0, 1, 17, 59))).toBe('tooEarly');
        expect(getBankShopCloseBlockReason(opened, new Date(2026, 0, 1, 17, 59))).toBe('tooEarly');
        expect(getBankShopCloseBlockReason(closed, new Date(2026, 0, 1, 18, 0))).toBe('alreadyClosed');
        expect(getBankShopCloseBlockReason(opened, new Date(2026, 0, 1, 18, 0))).toBeUndefined();
    });

    it('separates opening a shop from same-day closing settlement', () => {
        const dateStr = '2026-06-01';
        const shop = createDefaultBankShopState('测试小店');

        expect(canOpenBankShopForDate(shop, dateStr)).toBe(true);
        expect(canSettleBankShopForDate(shop, dateStr)).toBe(false);

        const opened = { ...shop, isBusinessOpen: true, openedBusinessDateStr: dateStr };
        expect(canOpenBankShopForDate(opened, dateStr)).toBe(false);
        expect(canSettleBankShopForDate(opened, dateStr)).toBe(true);

        const settled = { ...opened, isBusinessOpen: false, openedBusinessDateStr: undefined, lastBusinessDateStr: dateStr };
        expect(canOpenBankShopForDate(settled, dateStr)).toBe(false);
        expect(canSettleBankShopForDate(settled, dateStr)).toBe(false);
        expect(canOpenBankShopForDate(settled, '2026-06-02')).toBe(true);
    });

    it('refreshes shop opening eligibility at 04:00 every day', () => {
        expect(BANK_SHOP_DAILY_RESET_HOUR).toBe(4);
        const settled = { ...createDefaultBankShopState('测试小店'), lastBusinessDateStr: '2026-06-01' };

        expect(bankShopBusinessDateStr(new Date(2026, 5, 2, 3, 59))).toBe('2026-06-01');
        expect(canOpenBankShopForDate(settled, new Date(2026, 5, 2, 3, 59))).toBe(false);
        expect(bankShopBusinessDateStr(new Date(2026, 5, 2, 4, 0))).toBe('2026-06-02');
        expect(canOpenBankShopForDate(settled, new Date(2026, 5, 2, 4, 0))).toBe(true);
    });

    it('initializes a Sims-like life calendar and personal status', () => {
        const life = createDefaultBankLifeState('2026-06-01');

        expect(life.dayIndex).toBe(1);
        expect(life.weekDay).toBe(1);
        expect(life.season).toBe('summer');
        expect(life.energy).toBeGreaterThan(0);
        expect(life.mood).toBeGreaterThan(0);
        expect(life.health).toBeGreaterThan(0);
        expect(life.dailyPlan?.some(item => item.kind === 'rest')).toBe(true);
        expect(life.events[0].title).toBe('人生拟启动');
    });

    it('advances the Sims-like calendar and recovers energy on rest days', () => {
        const life0 = { ...createDefaultBankLifeState('2026-06-01'), fatigue: 48, energy: 52, mood: 58, health: 92 };
        const advanced = advanceBankLifeDay(life0);

        expect(advanced.life.dateStr).toBe('2026-06-02');
        expect(advanced.life.dayIndex).toBe(2);
        expect(advanced.life.weekDay).toBe(2);
        expect(advanced.life.season).toBe('summer');
        expect(advanced.life.fatigue).toBeLessThan(life0.fatigue);
        expect(advanced.life.energy).toBeGreaterThan(life0.energy);
        expect(advanced.life.dailyPlan?.some(item => item.kind === 'rest')).toBe(true);
    });

    it('generates an extensible job market with example jobs plus more categories', () => {
        expect(JOB_POSTINGS.some(j => j.title.includes('保洁'))).toBe(true);
        expect(JOB_POSTINGS.some(j => j.title.includes('餐厅服务员'))).toBe(true);
        expect(JOB_POSTINGS.some(j => j.title.includes('程序员'))).toBe(true);
        expect(JOB_POSTINGS.some(j => j.title.includes('保安'))).toBe(true);
        expect(new Set(JOB_POSTINGS.map(j => j.category)).size).toBeGreaterThan(8);
    });

    it('enriches job posts with Boss-style recruiter and company details', () => {
        const programmer = JOB_POSTINGS.find(j => j.id === 'job-programmer')!;

        expect(programmer.location).toBeTruthy();
        expect(programmer.bossName).toBeTruthy();
        expect(programmer.companyIntro).toContain(programmer.employer);
        expect(programmer.tags?.length).toBeGreaterThan(1);
        expect(programmer.salaryDetail?.socialInsurance).toBeTruthy();
        expect(programmer.salaryDetail?.bonusSubsidies?.length).toBeGreaterThan(0);
        expect(programmer.responsibilities?.length).toBeGreaterThan(1);
        expect(programmer.requirementDetails?.length).toBeGreaterThan(1);
        expect(programmer.employeeBenefits).toContain('五险一金');
        expect(programmer.recruiterStats?.responseTime).toBeTruthy();
        expect(programmer.companyIndustry).toBeTruthy();
        expect(programmer.publishNote).toBeTruthy();
    });

    it('starts job applications with recruiter chat messages', () => {
        const life0 = createDefaultBankLifeState('2026-06-01');
        const job = JOB_POSTINGS.find(j => !j.black)!;
        const started = startJobApplication(life0, job);

        expect(started.application.chatMessages?.[0]).toMatchObject({ role: 'boss' });
        expect(started.application.chatMessages?.some(m => m.content.includes(job.title))).toBe(true);
    });

    it('settles daily wages when advancing a day', () => {
        const life0 = createDefaultBankLifeState('2026-06-01');
        const daily = JOB_POSTINGS.find(j => j.payCycle === 'daily')!;
        const applied = applyForJob(life0, daily, 0);
        const advanced = advanceBankLifeDay({ ...applied.life, currentJob: { ...daily, startedAt: life0.dateStr, accruedWage: 0, daysWorked: 0 } });
        expect(advanced.balanceDelta).toBeGreaterThan(0);
        expect(advanced.ledgerEvents[0].kind).toBe('salary');
    });

    it('keeps monthly wage accrued until payday', () => {
        const life0 = createDefaultBankLifeState('2026-06-04');
        const monthly = JOB_POSTINGS.find(j => j.payCycle === 'monthly' && j.payDay === 5)!;
        const advanced = advanceBankLifeDay({ ...life0, currentJob: { ...monthly, startedAt: life0.dateStr, accruedWage: 0, daysWorked: 0 } });
        expect(advanced.life.dateStr).toBe('2026-06-05');
        expect(advanced.balanceDelta).toBeGreaterThan(0);
    });

    it('turns accrued wage into pending wage after leaving a job', () => {
        const life0 = createDefaultBankLifeState('2026-06-10');
        const monthly = JOB_POSTINGS.find(j => j.payCycle === 'monthly')!;
        const left = leaveJob({ ...life0, currentJob: { ...monthly, startedAt: life0.dateStr, accruedWage: 1234, daysWorked: 7 } });
        expect(left.currentJob).toBeUndefined();
        expect(left.pendingWages[0].amount).toBe(1234);
    });

    it('migrates legacy bank state and marks existing shop progress as unlocked', () => {
        const legacy = {
            config: { dailyBudget: 100, currencySymbol: '¥' },
            shop: { actionPoints: 1, shopName: '旧店', shopLevel: 1, appeal: 100, background: '', staff: [], unlockedRecipes: ['a', 'b'], totalRevenue: 10 },
            goals: [],
            todaySpent: 0,
            lastLoginDate: '2026-06-01',
        } as unknown as BankFullState;
        const migrated = migrateBankLifeState(legacy);
        expect(migrated.life?.shopUnlocked).toBe(true);
        expect(migrated.life?.shopBusinessType).toBe('drinks');
        expect(migrated.life?.stockMarket.length).toBeGreaterThan(0);
    });

    it('migrates legacy shop data into the first portfolio branch and keeps mirrors aligned', () => {
        const legacy = {
            config: { dailyBudget: 100, currencySymbol: '¥' },
            shop: {
                actionPoints: 7,
                shopName: '旧饮品铺',
                shopLevel: 2,
                appeal: 180,
                background: '',
                staff: [{ id: 's1', name: '阿明', avatar: '🙂', role: 'waiter', fatigue: 12, maxFatigue: 100, hireDate: 1 }],
                unlockedRecipes: ['recipe-coffee-001', 'recipe-tea'],
                totalRevenue: 66,
                stock: { 'recipe-coffee-001': 3 },
            },
            firedStaff: [{ id: 'f1', name: '小周', avatar: '🙂', role: 'waiter', fatigue: 0, maxFatigue: 100, hireDate: 1 }],
            goals: [],
            todaySpent: 0,
            lastLoginDate: '2026-06-01',
            life: {
                ...createDefaultBankLifeState('2026-06-01', true),
                shopBusinessName: '旧饮品铺',
                shopProducts: [{ id: 'p1', name: '旧菜单', price: 10, cost: 4, stock: 2, appeal: 8 }],
            },
        } as unknown as BankFullState;

        const migrated = migrateBankShopPortfolioState(migrateBankLifeState(legacy));
        const branch = migrated.shopPortfolio?.branches[0];

        expect(branch?.id).toBe('shop-main');
        expect(branch?.shop.shopName).toBe('旧饮品铺');
        expect(branch?.firedStaff[0].id).toBe('f1');
        expect(branch?.shopProducts[0].name).toBe('旧菜单');
        expect(migrated.shop.shopName).toBe(branch?.shop.shopName);
        expect(migrated.life?.shopBusinessName).toBe(branch?.shop.shopName);
    });

    it('migrates AI extension fields with safe defaults', () => {
        const migrated = migrateBankLifeState({
            config: { dailyBudget: 100, currencySymbol: '¥' },
            shop: { actionPoints: 1, shopName: '旧店', shopLevel: 1, appeal: 100, background: '', staff: [], unlockedRecipes: [], totalRevenue: 0 },
            goals: [],
            todaySpent: 0,
            lastLoginDate: '2026-06-01',
        } as unknown as BankFullState);

        expect(migrated.life?.aiEvents).toEqual([]);
        expect(migrated.life?.jobSearchSessions).toEqual([]);
        expect(migrated.life?.marketPulses).toEqual([]);
        expect(migrated.life?.aiJobPostings).toEqual([]);
        expect(migrated.life?.actionHistory).toEqual([]);
        expect(migrated.life?.resume?.skills).toEqual([]);
        expect(migrated.life?.creditProfile?.score).toBeGreaterThan(0);
    });

    it('records generic bank action history for replayable modals', () => {
        const life0 = createDefaultBankLifeState('2026-06-01');
        const result = createBankActionResult({
            category: 'dashboard',
            kind: 'dashboard-insight',
            title: '复盘',
            summary: '今天先看现金流。',
            tone: 'info',
            metrics: [{ label: '现金', value: '¥100' }],
        });
        const life = appendBankActionRecord(life0, result);

        expect(life.actionHistory?.[0]).toMatchObject({ id: result.id, category: 'dashboard', kind: 'dashboard-insight' });
        expect(life.actionHistory?.[0].metrics?.[0].label).toBe('现金');
    });

    it('updates resume profile without losing existing life state', () => {
        const life0 = createDefaultBankLifeState('2026-06-01');
        const life = updateResumeProfile(life0, {
            headline: '前端新人，想找稳定工作',
            skills: ['React', '沟通'],
            expectedCategories: ['技术', '文职'],
            selfIntro: '能稳定排班，也愿意学习。',
        });

        expect(life.resume?.headline).toContain('前端新人');
        expect(life.resume?.skills).toContain('React');
        expect(life.dateStr).toBe(life0.dateStr);
    });

    it('merges AI job postings and records search sessions', () => {
        const life0 = createDefaultBankLifeState('2026-06-01');
        const life = mergeAiJobPostings(life0, [JOB_POSTINGS[0]], '前台', '服务业');
        expect(life.aiJobPostings?.[0].id).toBe(JOB_POSTINGS[0].id);
        expect(life.jobSearchSessions?.[0]).toMatchObject({ query: '前台', category: '服务业', source: 'ai' });
    });

    it('appends recruiter chat messages to an application', () => {
        const life0 = createDefaultBankLifeState('2026-06-01');
        const started = startJobApplication(life0, JOB_POSTINGS[0]);
        const life = appendJobChatMessage(started.life, started.application.id, { role: 'user', content: '我想了解排班。', at: '2026-06-01 10:00' });
        const messages = life.jobHistory[0].chatMessages || [];
        expect(messages[messages.length - 1]?.content).toContain('排班');
    });

    it('opens a selected business type with its own product shelf', () => {
        const life0 = createDefaultBankLifeState('2026-06-01');
        const flower = BUSINESS_TEMPLATES.find(b => b.id === 'flower')!;
        const life = openLifeShop(life0, flower.id, '花间一角');
        expect(life.shopUnlocked).toBe(true);
        expect(life.shopBusinessType).toBe('flower');
        expect(life.shopBusinessName).toBe('花间一角');
        expect(life.shopProducts?.map(p => p.name)).toEqual(flower.products.map(p => p.name));
    });

    it('opens repeat business-type branches with startup costs and headquarters energy checks', () => {
        const base = migrateBankLifeState({
            config: { dailyBudget: 100, currencySymbol: '¥' },
            shop: { actionPoints: 1, shopName: '镜像', shopLevel: 1, appeal: 100, background: '', staff: [], unlockedRecipes: [] },
            goals: [],
            todaySpent: 0,
            lastLoginDate: '2026-06-01',
            life: createDefaultBankLifeState('2026-06-01'),
        } as unknown as BankFullState);

        const first = openBankShopBranch(base, 'drinks', '', { walletBalance: 10000, dateStr: '2026-06-01' });
        expect(first.ok).toBe(true);
        expect(first.cost).toBe(10000);
        expect(first.state.shopPortfolio?.branches).toHaveLength(1);
        expect(first.state.shopPortfolio?.headquartersEnergy).toBe(50);

        const defaultName = getDefaultBankBranchName('drinks', first.state.shopPortfolio?.branches || []);
        expect(defaultName).toBe('饮品店 2号店');
        const second = openBankShopBranch(first.state, 'drinks', defaultName, { walletBalance: 10000, dateStr: '2026-06-02' });
        expect(second.ok).toBe(true);
        expect(second.state.shopPortfolio?.branches).toHaveLength(2);
        expect(second.branch?.shop.shopName).toBe('饮品店 2号店');

        const walletBlocked = openBankShopBranch(second.state, 'convenience', '', { walletBalance: 21999, dateStr: '2026-06-03' });
        expect(walletBlocked.ok).toBe(false);
        expect(walletBlocked.reason).toBe('wallet');
        expect(walletBlocked.state.shopPortfolio?.branches).toHaveLength(2);

        const energyBlocked = openBankShopBranch(second.state, 'snack', '', { walletBalance: 7000, dateStr: '2026-06-03' });
        expect(energyBlocked.ok).toBe(false);
        expect(energyBlocked.reason).toBe('energy');
        expect(energyBlocked.state.shopPortfolio?.branches).toHaveLength(2);
    });

    it('switches active branches without mixing stock, staff, reputation, or fired pools', () => {
        const base = migrateBankLifeState({
            config: { dailyBudget: 100, currencySymbol: '¥' },
            shop: { actionPoints: 1, shopName: '镜像', shopLevel: 1, appeal: 100, background: '', staff: [], unlockedRecipes: [] },
            goals: [],
            todaySpent: 0,
            lastLoginDate: '2026-06-01',
            life: createDefaultBankLifeState('2026-06-01'),
        } as unknown as BankFullState);
        const first = openBankShopBranch(base, 'drinks', 'A店', { walletBalance: 10000, dateStr: '2026-06-01' }).state;
        const secondResult = openBankShopBranch(first, 'flower', 'B店', { walletBalance: 14000, dateStr: '2026-06-01' });
        const second = secondResult.state;
        const [a, b] = second.shopPortfolio!.branches;
        const editedActive = {
            ...second,
            shop: {
                ...second.shop,
                actionPoints: 3,
                stock: { 'fl-bouquet': 1 },
                staff: [{ id: 'b-staff', name: '花店员', avatar: '🙂', role: 'waiter', fatigue: 0, maxFatigue: 100, hireDate: 1 }],
                reviews: [{ id: 'r1', authorName: '客人', avatar: '🙂', rating: 5, text: '好看', ts: 1 }],
            },
            firedStaff: [{ id: 'b-fired', name: '旧花店员', avatar: '🙂', role: 'waiter', fatigue: 0, maxFatigue: 100, hireDate: 1 }],
        } as BankFullState;
        const switched = switchActiveBankShop(editedActive, a.id);

        expect(switched.shop.shopName).toBe('A店');
        expect(switched.shop.staff.some(s => s.id === 'b-staff')).toBe(false);
        const savedB = switched.shopPortfolio?.branches.find(branch => branch.id === b.id);
        expect(savedB?.shop.stock?.['fl-bouquet']).toBe(1);
        expect(savedB?.shop.reviews?.[0].rating).toBe(5);
        expect(savedB?.firedStaff[0].id).toBe('b-fired');
    });

    it('keeps shop business-open state explicit across branch sync', () => {
        const defaultShop = createDefaultBankShopState('A店');
        expect(defaultShop.isBusinessOpen).toBe(false);

        const base = openBankShopBranch(migrateBankLifeState({
            config: { dailyBudget: 100, currencySymbol: '¥' },
            shop: { actionPoints: 1, shopName: '镜像', shopLevel: 1, appeal: 100, background: '', staff: [], unlockedRecipes: [] },
            goals: [],
            todaySpent: 0,
            lastLoginDate: '2026-06-01',
            life: createDefaultBankLifeState('2026-06-01'),
        } as unknown as BankFullState), 'drinks', 'A店', { walletBalance: 10000, dateStr: '2026-06-01' }).state;

        expect(base.shop.isBusinessOpen).toBe(false);

        const opened = { ...base, shop: { ...base.shop, isBusinessOpen: true } } as BankFullState;
        const synced = switchActiveBankShop(opened, base.shopPortfolio!.activeShopId);

        expect(synced.shop.isBusinessOpen).toBe(true);
        expect(synced.shopPortfolio?.branches[0].shop.isBusinessOpen).toBe(true);
    });

    it('saves active shop mirror edits into the active branch before commit', () => {
        const base = openBankShopBranch(migrateBankLifeState({
            config: { dailyBudget: 100, currencySymbol: '¥' },
            shop: { actionPoints: 1, shopName: '镜像', shopLevel: 1, appeal: 100, background: '', staff: [], unlockedRecipes: [] },
            goals: [],
            todaySpent: 0,
            lastLoginDate: '2026-06-01',
            life: createDefaultBankLifeState('2026-06-01'),
        } as unknown as BankFullState), 'drinks', 'A店', { walletBalance: 10000, dateStr: '2026-06-01' }).state;
        const now = new Date(2026, 5, 1, 10, 0).getTime();
        const openedShop = markBankShopBusinessOpened({
            ...base.shop,
            actionPoints: 30,
        }, now, now);
        const shopProducts = (base.life?.shopProducts || []).map((p, idx) => idx === 0 ? { ...p, stock: 3 } : p);

        const saved = prepareBankStateForSave({
            ...base,
            shop: openedShop,
            life: { ...base.life!, shopProducts },
        });
        const active = saved.shopPortfolio?.branches.find(branch => branch.id === saved.shopPortfolio?.activeShopId);

        expect(saved.shop.isBusinessOpen).toBe(true);
        expect(saved.shop.actionPoints).toBe(30);
        expect(saved.shop.openedBusinessDateStr).toBe('2026-06-01');
        expect(active?.shop.isBusinessOpen).toBe(true);
        expect(active?.shop.actionPoints).toBe(30);
        expect(active?.shop.openedBusinessDateStr).toBe('2026-06-01');
        expect(active?.shopProducts[0].stock).toBe(3);
    });

    it('claims daily shop lessons once per date and per branch', () => {
        const base = openBankShopBranch(migrateBankLifeState({
            config: { dailyBudget: 100, currencySymbol: '¥' },
            shop: { actionPoints: 1, shopName: '镜像', shopLevel: 1, appeal: 100, background: '', staff: [], unlockedRecipes: [] },
            goals: [],
            todaySpent: 0,
            lastLoginDate: '2026-06-01',
            life: createDefaultBankLifeState('2026-06-01'),
        } as unknown as BankFullState), 'drinks', 'A店', { walletBalance: 10000, dateStr: '2026-06-01' }).state;
        const hqBefore = base.shopPortfolio!.headquartersEnergy;
        const patrol = claimBankShopDailyReward(base, 'headquartersPatrol', { dateStr: '2026-06-01' });
        expect(patrol.claimed).toBe(true);
        expect(patrol.state.shopPortfolio!.headquartersEnergy).toBe(hqBefore + 25);
        expect(claimBankShopDailyReward(patrol.state, 'headquartersPatrol', { dateStr: '2026-06-01' }).claimed).toBe(false);

        const shopBefore = patrol.state.shop.actionPoints;
        const shelf = claimBankShopDailyReward(patrol.state, 'shelf', { dateStr: '2026-06-01' });
        expect(shelf.claimed).toBe(true);
        expect(shelf.state.shop.actionPoints).toBe(shopBefore + 18);
        expect(claimBankShopDailyReward(shelf.state, 'shelf', { dateStr: '2026-06-01' }).claimed).toBe(false);

        const nextDay = claimBankShopDailyReward(shelf.state, 'shelf', { dateStr: '2026-06-02' });
        expect(nextDay.claimed).toBe(true);
    });

    it('enforces the planned capital thresholds for shop and company unlocks', () => {
        expect(canUnlockLifeShop(9999)).toBe(false);
        expect(canUnlockLifeShop(10000)).toBe(true);
        expect(canFoundCompany(99999)).toBe(false);
        expect(canFoundCompany(100000)).toBe(true);
    });

    it('advances job applications through multiple stages', () => {
        const life0 = createDefaultBankLifeState('2026-06-01');
        const job = JOB_POSTINGS.find(j => !j.black)!;
        const started = startJobApplication(life0, job);
        expect(started.application.stage).toBe('submitted');
        const next = advanceJobApplicationStage(started.life, started.application.id, '我有相关经验，也能稳定排班。');
        expect(next.application?.stage).toBe('screening');
        expect(next.life.jobHistory[0].id).toBe(started.application.id);
    });

    it('migrates legacy active job applications into the staged pipeline', () => {
        const job = JOB_POSTINGS.find(j => !j.black)!;
        const migrated = migrateBankLifeState({
            config: { dailyBudget: 100, currencySymbol: '¥' },
            shop: { actionPoints: 1, shopName: '旧店', shopLevel: 1, appeal: 100, background: '', staff: [], unlockedRecipes: [], totalRevenue: 0 },
            goals: [],
            todaySpent: 0,
            lastLoginDate: '2026-06-01',
            life: {
                ...createDefaultBankLifeState('2026-06-01'),
                jobHistory: [{
                    id: 'legacy-app',
                    postingId: job.id,
                    title: job.title,
                    employer: job.employer,
                    status: 'rejected',
                    stage: 'submitted',
                    score: 0,
                    dateStr: '2026-06-01',
                    message: '旧版投递记录',
                }],
            },
        } as unknown as BankFullState);

        expect(migrated.life?.jobHistory[0].status).toBe('active');
        expect(migrated.life?.jobHistory[0].stageHistory?.length).toBeGreaterThan(0);
        expect(migrated.life?.jobHistory[0].todos?.length).toBeGreaterThan(0);
    });

    it('keeps offer as a review stage until the user accepts it', () => {
        const life0 = createDefaultBankLifeState('2026-06-01');
        const job = JOB_POSTINGS.find(j => !j.black)!;
        const started = startJobApplication(life0, job);
        const screening = advanceJobApplicationStageWithAi(started.life, started.application.id, '', 0, { nextStage: 'screening' });
        const chat = advanceJobApplicationStageWithAi(screening.life, started.application.id, '可以稳定排班', 0, { nextStage: 'recruiter_chat' });
        const assessment = advanceJobApplicationStageWithAi(chat.life, started.application.id, '到岗时间明确', 0, { nextStage: 'assessment' });
        const interview = advanceJobApplicationStageWithAi(assessment.life, started.application.id, '试岗表现稳定', 0, { nextStage: 'interview' });
        const offer = advanceJobApplicationStageWithAi(interview.life, started.application.id, '面试回答完整', 0, { nextStage: 'offer', offerSalary: job.salaryMin + 300 });

        expect(offer.application?.stage).toBe('offer');
        expect(offer.life.currentJob).toBeUndefined();

        const accepted = advanceJobApplicationStageWithAi(offer.life, started.application.id, '接受 Offer', 0, { nextStage: 'hired' });
        expect(accepted.application?.stage).toBe('hired');
        expect(accepted.life.currentJob?.title).toBe(job.title);
        expect(accepted.life.currentJob?.salaryMin).toBe(offer.application?.offerTerms?.salary);
    });

    it('caps virtual losses when an AI stage marks a risky job as a scam', () => {
        const life0 = createDefaultBankLifeState('2026-06-01');
        const risky = JOB_POSTINGS.find(j => j.black)!;
        const started = startJobApplication(life0, risky);
        const screening = advanceJobApplicationStageWithAi(started.life, started.application.id, '', 20, { nextStage: 'screening' });
        const scammed = advanceJobApplicationStageWithAi(screening.life, started.application.id, '对方要求押金', 20, { nextStage: 'scammed', riskFlags: ['押金'] });

        expect(scammed.application?.stage).toBe('scammed');
        expect(scammed.balanceDelta).toBeGreaterThanOrEqual(-20);
        expect(scammed.life.events[0].amount).toBe(scammed.balanceDelta);
    });

    it('buys and sells virtual stocks with holdings and money results', () => {
        const life0 = createDefaultBankLifeState('2026-06-01');
        expect(life0.stockMarket[0].history?.length).toBeGreaterThan(10);
        const bought = buyStock(life0, 'MORO', 1000);
        expect(bought.cost).toBeGreaterThan(0);
        expect(bought.life.holdings.MORO.shares).toBeGreaterThan(0);
        expect(bought.actionResult?.kind).toBe('stock-buy');
        expect(bought.life.actionHistory?.[0].category).toBe('invest');
        const sold = sellStock(bought.life, 'MORO', bought.life.holdings.MORO.shares);
        expect(sold.revenue).toBeGreaterThan(0);
        expect(sold.life.holdings.MORO).toBeUndefined();
        expect(sold.actionResult?.pnl).toBeTypeOf('number');
    });

    it('appends stock candles when advancing a day', () => {
        const life0 = createDefaultBankLifeState('2026-06-01');
        const before = life0.stockMarket[0].history?.length || 0;
        const advanced = advanceBankLifeDay(life0);
        expect(advanced.life.stockMarket[0].history?.length).toBe(before + 1);
        expect(advanced.life.stockMarket[0].intraday?.length).toBeGreaterThan(3);
        expect(advanced.life.stockMarket[0].newsList?.length).toBeGreaterThan(0);
        expect(advanced.life.stockMarket[0].bidAsk?.bid).toBeGreaterThan(0);
    });

    it('creates company state with starting capital', () => {
        const life = foundCompany(createDefaultBankLifeState('2026-06-01'), '月光社', '软件工作室');
        expect(life.company?.name).toBe('月光社');
        expect(life.company?.cash).toBe(COMPANY_FOUND_COST);
        expect(life.company?.orders?.length).toBeGreaterThan(0);
        expect(life.company?.pendingIssue?.options.length).toBeGreaterThan(0);
        expect(life.actionHistory?.[0].kind).toBe('company-found');
    });

    it('returns structured company issue and dividend results without reducing profit below zero', () => {
        const founded = foundCompany(createDefaultBankLifeState('2026-06-01'), '月光社', '软件工作室');
        const optionId = founded.company!.pendingIssue!.options[0].id;
        const issue = applyCompanyIssueWithResult(founded, optionId);
        expect(issue.actionResult?.category).toBe('company');
        expect(issue.life.actionHistory?.[0].kind).toBe('company-issue');

        const withCash = { ...issue.life, company: { ...issue.life.company!, cash: COMPANY_FOUND_COST + 10000, cumulativeProfit: 0 } };
        const dividend = withdrawCompanyDividend(withCash);
        expect(dividend.amount).toBeGreaterThan(0);
        expect(dividend.life.company?.cumulativeProfit).toBeGreaterThanOrEqual(0);
        expect(dividend.actionResult?.kind).toBe('company-dividend');
    });

    it('applies AI market pulses to stock news', () => {
        const life0 = createDefaultBankLifeState('2026-06-01');
        const life = applyMarketPulses(life0, [{ id: 'pulse-1', dateStr: '2026-06-01', headline: 'AI 板块升温', summary: '资金关注虚拟 AI 应用。', affectedSymbols: ['MORO'], sentiment: 'bullish', source: 'ai' }]);
        expect(life.stockMarket.find(q => q.symbol === 'MORO')?.aiReason).toContain('虚拟 AI');
        expect(life.marketPulses?.[0].headline).toBe('AI 板块升温');
    });

    it('computes loan credit profile from income and debt', () => {
        const life0 = createDefaultBankLifeState('2026-06-01');
        const profile = computeCreditProfile(life0);
        expect(profile.score).toBeGreaterThan(0);
        expect(profile.riskLevel).toMatch(/low|medium|high|danger/);
    });

    it('builds life suggestions for next actions', () => {
        const life0 = createDefaultBankLifeState('2026-06-01');
        const suggestions = buildLifeSuggestions(life0, 100);
        expect(suggestions.some(s => s.tab === 'jobs')).toBe(true);
        expect(suggestions.length).toBeGreaterThan(0);
    });

    it('accrues loan interest and supports repayment', () => {
        const borrowed = borrowLoan(createDefaultBankLifeState('2026-06-01'), 'formal', 5000);
        expect(borrowed.loan.contractTerms?.length).toBeGreaterThan(1);
        expect(borrowed.loan.repaymentPlan?.length).toBeGreaterThan(0);
        expect(borrowed.actionResult?.kind).toBe('loan-borrow');
        const advanced = advanceBankLifeDay(borrowed.life);
        expect(loanTotal(advanced.life)).toBeGreaterThan(5000);
        const repaid = repayLoan(advanced.life, borrowed.loan.id, 1000);
        expect(repaid.paid).toBe(1000);
        expect(loanTotal(repaid.life)).toBeLessThan(loanTotal(advanced.life));
        expect(repaid.actionResult?.kind).toBe('loan-repay');
    });

    it('caps shady loan metadata and repayment overpay at outstanding balance', () => {
        const borrowed = borrowLoan(createDefaultBankLifeState('2026-06-01'), 'shady', 12000);
        expect(borrowed.loan.serviceFee).toBeLessThanOrEqual(500);
        expect(borrowed.actionResult?.riskTags).toContain('高利息');
        const repaid = repayLoan(borrowed.life, borrowed.loan.id, 999999);
        expect(repaid.paid).toBe(12000);
        expect(repaid.life.loans).toHaveLength(0);
    });
});
