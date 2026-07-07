import { AdjustBalanceMeta, BankTransaction } from '../types';

const UNSUPPORTED_INCOME_BASIS = /(凭空|隨便|随便|乱写|编的|编造|幻想|空气|无来源|没来源|无依据|没依据|不知道|不清楚|测试|test|刷钱|作弊|加钱|想要钱|缺钱)/i;
const INCOME_BASIS_HINT = /(工资|薪资|薪水|奖金|提成|补贴|报销|兼职|稿费|接单|订单|营业|分红|利息|退款|退回|红包|转账|收款|到账|入账|存款|余额|现金|发票|票据|账单|单号|合同|结算|截图|记录|流水|凭证|工资条|回单|支付宝|微信|银行卡|银行|平台|店铺|客户|雇主|公司)/i;

export const normalizeIncomeBasis = (value: string): string => value.replace(/\s+/g, ' ').trim();

export const validateManualIncomeBasis = (
    note: string,
    basis: string,
): { ok: true; basis: string } | { ok: false; reason: string } => {
    const normalized = normalizeIncomeBasis(basis);
    const joined = `${note} ${normalized}`;

    if (!normalized) {
        return { ok: false, reason: '收入需要填写来源依据，例如工资条、转账记录、退款单号或已有存款说明。' };
    }
    if (UNSUPPORTED_INCOME_BASIS.test(joined)) {
        return { ok: false, reason: '收入不能凭空创造，请填写真实发生过的来源或凭证。' };
    }
    if (!INCOME_BASIS_HINT.test(normalized) && Array.from(normalized).length < 8) {
        return { ok: false, reason: '收入依据再写具体一点，例如来自谁、哪笔转账、哪次结算或哪份记录。' };
    }

    return { ok: true, basis: normalized };
};

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
