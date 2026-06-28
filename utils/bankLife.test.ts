import { describe, expect, it } from 'vitest';
import {
    COMPANY_FOUND_COST,
    JOB_POSTINGS,
    advanceBankLifeDay,
    applyForJob,
    borrowLoan,
    buyStock,
    createDefaultBankLifeState,
    foundCompany,
    leaveJob,
    loanTotal,
    migrateBankLifeState,
    repayLoan,
    sellStock,
} from './bankLife';
import { BankFullState } from '../types';

describe('bankLife', () => {
    it('generates an extensible job market with example jobs plus more categories', () => {
        expect(JOB_POSTINGS.some(j => j.title.includes('保洁'))).toBe(true);
        expect(JOB_POSTINGS.some(j => j.title.includes('餐厅服务员'))).toBe(true);
        expect(JOB_POSTINGS.some(j => j.title.includes('程序员'))).toBe(true);
        expect(JOB_POSTINGS.some(j => j.title.includes('保安'))).toBe(true);
        expect(new Set(JOB_POSTINGS.map(j => j.category)).size).toBeGreaterThan(8);
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
        expect(migrated.life?.stockMarket.length).toBeGreaterThan(0);
    });

    it('buys and sells virtual stocks with holdings and money results', () => {
        const life0 = createDefaultBankLifeState('2026-06-01');
        const bought = buyStock(life0, 'MORO', 1000);
        expect(bought.cost).toBeGreaterThan(0);
        expect(bought.life.holdings.MORO.shares).toBeGreaterThan(0);
        const sold = sellStock(bought.life, 'MORO', bought.life.holdings.MORO.shares);
        expect(sold.revenue).toBeGreaterThan(0);
        expect(sold.life.holdings.MORO).toBeUndefined();
    });

    it('creates company state with starting capital', () => {
        const life = foundCompany(createDefaultBankLifeState('2026-06-01'), '月光社', '软件工作室');
        expect(life.company?.name).toBe('月光社');
        expect(life.company?.cash).toBe(COMPANY_FOUND_COST);
    });

    it('accrues loan interest and supports repayment', () => {
        const borrowed = borrowLoan(createDefaultBankLifeState('2026-06-01'), 'formal', 5000);
        const advanced = advanceBankLifeDay(borrowed.life);
        expect(loanTotal(advanced.life)).toBeGreaterThan(5000);
        const repaid = repayLoan(advanced.life, borrowed.loan.id, 1000);
        expect(repaid.paid).toBe(1000);
        expect(loanTotal(repaid.life)).toBeLessThan(loanTotal(advanced.life));
    });
});
