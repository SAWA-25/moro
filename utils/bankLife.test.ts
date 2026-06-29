import { describe, expect, it } from 'vitest';
import {
    COMPANY_FOUND_COST,
    BUSINESS_TEMPLATES,
    JOB_POSTINGS,
    canFoundCompany,
    canUnlockLifeShop,
    advanceBankLifeDay,
    advanceJobApplicationStage,
    applyForJob,
    applyMarketPulses,
    appendJobChatMessage,
    borrowLoan,
    buildLifeSuggestions,
    computeCreditProfile,
    buyStock,
    createDefaultBankLifeState,
    foundCompany,
    leaveJob,
    loanTotal,
    mergeAiJobPostings,
    migrateBankLifeState,
    openLifeShop,
    repayLoan,
    sellStock,
    startJobApplication,
    updateResumeProfile,
} from './bankLife';
import { BankFullState } from '../types';

describe('bankLife', () => {
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
        expect(migrated.life?.resume?.skills).toEqual([]);
        expect(migrated.life?.creditProfile?.score).toBeGreaterThan(0);
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

    it('buys and sells virtual stocks with holdings and money results', () => {
        const life0 = createDefaultBankLifeState('2026-06-01');
        expect(life0.stockMarket[0].history?.length).toBeGreaterThan(10);
        const bought = buyStock(life0, 'MORO', 1000);
        expect(bought.cost).toBeGreaterThan(0);
        expect(bought.life.holdings.MORO.shares).toBeGreaterThan(0);
        const sold = sellStock(bought.life, 'MORO', bought.life.holdings.MORO.shares);
        expect(sold.revenue).toBeGreaterThan(0);
        expect(sold.life.holdings.MORO).toBeUndefined();
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
        const advanced = advanceBankLifeDay(borrowed.life);
        expect(loanTotal(advanced.life)).toBeGreaterThan(5000);
        const repaid = repayLoan(advanced.life, borrowed.loan.id, 1000);
        expect(repaid.paid).toBe(1000);
        expect(loanTotal(repaid.life)).toBeLessThan(loanTotal(advanced.life));
    });
});
