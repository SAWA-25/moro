import { AdjustBalanceMeta, BankTransaction } from '../types';

export const createAutoBankTransaction = (
    delta: number,
    balanceAfter: number,
    meta: AdjustBalanceMeta = {},
    options: { now?: number; idSuffix?: string } = {},
): BankTransaction | null => {
    const roundedDelta = Math.round(delta * 100) / 100;
    if (meta.ledger === false || roundedDelta === 0) return null;

    const now = options.now ?? Date.now();
    const idSuffix = options.idSuffix ?? Math.random().toString(36).slice(2, 7);
    const type = roundedDelta > 0 ? 'income' : 'expense';

    return {
        id: `auto-tx-${now}-${idSuffix}`,
        amount: Math.abs(roundedDelta),
        category: meta.category || meta.kind || type,
        note: meta.note || (type === 'income' ? '钱包进账' : '钱包支出'),
        timestamp: now,
        dateStr: new Date(now).toISOString().slice(0, 10),
        type,
        sourceApp: meta.sourceApp || '人生拟',
        sourceId: meta.sourceId,
        kind: meta.kind,
        auto: true,
        balanceAfter: Math.max(0, Math.round(balanceAfter * 100) / 100),
        createdBy: meta.createdBy || 'system',
        relatedEntityId: meta.relatedEntityId,
    };
};
