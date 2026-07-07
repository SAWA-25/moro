import { describe, expect, it } from 'vitest';
import { createAutoBankTransaction, validateManualIncomeBasis } from './bankLedger';

describe('bankLedger', () => {
    it('creates automatic ledger records for wallet balance changes', () => {
        const tx = createAutoBankTransaction(88.888, 188.888, {
            note: '测试工资',
            category: 'job',
            kind: 'salary',
            sourceApp: '人生拟',
            sourceId: 'job_cleaner',
        }, { now: Date.UTC(2026, 5, 1), idSuffix: 'test' });

        expect(tx).toMatchObject({
            id: 'auto-tx-1780272000000-test',
            amount: 88.89,
            category: 'job',
            note: '测试工资',
            type: 'income',
            sourceApp: '人生拟',
            sourceId: 'job_cleaner',
            kind: 'salary',
            auto: true,
            balanceAfter: 188.89,
            createdBy: 'system',
        });
        expect(tx?.dateStr).toBe('2026-06-01');
    });

    it('supports expense records with default metadata for legacy calls', () => {
        const tx = createAutoBankTransaction(-12, 30, {}, { now: Date.UTC(2026, 5, 2), idSuffix: 'legacy' });

        expect(tx).toMatchObject({
            amount: 12,
            category: 'expense',
            note: '钱包支出',
            type: 'expense',
            sourceApp: '人生拟',
            balanceAfter: 30,
        });
    });

    it('defaults automatic wallet ledger records to 人生拟 after the app rename', () => {
        const tx = createAutoBankTransaction(6, 36, {}, { now: Date.UTC(2026, 5, 3), idSuffix: 'default-app' });

        expect(tx).toMatchObject({
            amount: 6,
            note: '钱包进账',
            type: 'income',
            sourceApp: '人生拟',
            balanceAfter: 36,
        });
    });

    it('skips ledger records when disabled or delta is zero', () => {
        expect(createAutoBankTransaction(10, 100, { ledger: false })).toBeNull();
        expect(createAutoBankTransaction(0, 100)).toBeNull();
    });

    it('requires a concrete basis for manual income records', () => {
        expect(validateManualIncomeBasis('补一笔收入', '')).toMatchObject({ ok: false });
        expect(validateManualIncomeBasis('补一笔收入', '凭空加钱测试')).toMatchObject({ ok: false });
        expect(validateManualIncomeBasis('7月工资', '嗯嗯')).toMatchObject({ ok: false });
        expect(validateManualIncomeBasis('7月工资', '工资条已到账')).toMatchObject({ ok: true, basis: '工资条已到账' });
        expect(validateManualIncomeBasis('退货退款', '支付宝退款记录')).toMatchObject({ ok: true, basis: '支付宝退款记录' });
        expect(validateManualIncomeBasis('过去收入', '已有存款余额补录')).toMatchObject({ ok: true, basis: '已有存款余额补录' });
    });
});
