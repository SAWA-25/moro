import React from 'react';
import type { BankLifeActionRecord, BankLifeActionResult, BankLifeActionTone } from '../../types';
import { HAND_FONT } from '../../apps/almanac/handbookKit';
import { INK, INK_SOFT } from '../../apps/ui/insScrapKit';

const toneColor: Record<BankLifeActionTone, { bg: string; fg: string }> = {
    good: { bg: '#dcfce7', fg: '#15803d' },
    warn: { bg: '#fef3c7', fg: '#92400e' },
    bad: { bg: '#ffe4e6', fg: '#be123c' },
    info: { bg: '#e0f2fe', fg: '#0369a1' },
};

export const bankModalInputStyle: React.CSSProperties = {
    background: '#fff',
    borderRadius: 16,
    color: INK,
    border: '1px solid rgba(43,41,51,0.07)',
    boxShadow: 'inset 0 1px 2px rgba(43,41,51,0.04)',
};

export const BankBadge: React.FC<{ children: React.ReactNode; tone?: BankLifeActionTone | 'default'; className?: string }> = ({ children, tone = 'default', className = '' }) => {
    const picked = tone === 'default' ? { bg: '#f5f3ef', fg: INK_SOFT } : toneColor[tone];
    const style: React.CSSProperties = { background: picked.bg, color: picked.fg };
    return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${className}`} style={style}>{children}</span>;
};

export const BankModal: React.FC<{
    open: boolean;
    title: string;
    sub?: string;
    onClose: () => void;
    footer?: React.ReactNode;
    children: React.ReactNode;
    wide?: boolean;
}> = ({ open, title, sub, onClose, footer, children, wide = false }) => {
    if (!open) return null;
    return (
        <div className="fixed inset-0 z-[9999] flex items-end justify-center p-0 sm:items-center sm:p-5" onClick={onClose}>
            <div className="absolute inset-0 bg-black/40 animate-fade-in" style={{ backdropFilter: 'blur(6px)' }} />
            <div
                className="bank-modal-shell relative w-full animate-slide-up flex flex-col"
                style={{
                    background: '#fff',
                    borderRadius: '28px 28px 0 0',
                    boxShadow: '0 34px 80px -32px rgba(20,18,16,0.58)',
                    maxHeight: '88vh',
                    maxWidth: wide ? 560 : 420,
                }}
                onClick={e => e.stopPropagation()}
            >
                <style>{'@media (min-width: 640px){.bank-modal-shell{border-radius:28px!important}}'}</style>
                <div className="bank-modal-shell flex flex-col min-h-0" style={{ borderRadius: 28 }}>
                    <div className="p-5 overflow-y-auto no-scrollbar">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <div className="text-[22px] font-black leading-tight break-words" style={{ fontFamily: HAND_FONT, color: INK }}>{title}</div>
                                {sub && <div className="text-[11px] mt-1" style={{ color: INK_SOFT }}>{sub}</div>}
                            </div>
                            <button onClick={onClose} className="w-8 h-8 rounded-full shrink-0 text-[18px] font-black active:scale-95 transition-transform" style={{ background: '#f5f3ef', color: INK }}>×</button>
                        </div>
                        <div className="mt-4">{children}</div>
                    </div>
                    {footer && <div className="px-5 pb-5 pt-1 shrink-0">{footer}</div>}
                </div>
            </div>
        </div>
    );
};

export const BankMetricGrid: React.FC<{ items?: { label: string; value: string; tone?: BankLifeActionTone }[] }> = ({ items = [] }) => {
    if (!items.length) return null;
    return (
        <div className="grid grid-cols-2 gap-2">
            {items.map((item, idx) => (
                <div key={`${item.label}-${idx}`} className="rounded-2xl px-3 py-2 min-w-0" style={{ background: '#faf8f5' }}>
                    <div className="text-[10px] font-bold truncate" style={{ color: INK_SOFT }}>{item.label}</div>
                    <div className="text-[14px] font-black leading-tight break-words" style={{ color: item.tone ? toneColor[item.tone].fg : INK }}>{item.value}</div>
                </div>
            ))}
        </div>
    );
};

export const BankActionResultView: React.FC<{ result: BankLifeActionResult; currency?: string }> = ({ result, currency = '¥' }) => (
    <div className="space-y-3">
        <div className="rounded-[22px] p-4" style={{ background: toneColor[result.tone].bg, color: toneColor[result.tone].fg }}>
            <div className="text-[12px] font-black">{result.title}</div>
            <div className="mt-1 text-[13px] leading-relaxed break-words">{result.aiSummary || result.summary}</div>
            {typeof result.amount === 'number' && (
                <div className="mt-2 text-[22px] font-black" style={{ fontFamily: HAND_FONT }}>
                    {result.amount >= 0 ? '+' : '-'}{currency}{Math.abs(Math.round(result.amount))}
                </div>
            )}
        </div>
        <BankMetricGrid items={result.metrics} />
        {!!result.lines?.length && (
            <div className="space-y-2">
                {result.lines.map((line, idx) => (
                    <div key={`${line.label}-${idx}`} className="flex justify-between gap-3 rounded-2xl px-3 py-2 text-[12px]" style={{ background: '#faf8f5' }}>
                        <span className="min-w-0 break-words" style={{ color: INK_SOFT }}>{line.label}</span>
                        <b className="text-right break-words" style={{ color: line.tone ? toneColor[line.tone].fg : INK }}>{line.value}</b>
                    </div>
                ))}
            </div>
        )}
        {!!result.riskTags?.length && (
            <div className="flex flex-wrap gap-1.5">
                {result.riskTags.map(tag => <BankBadge key={tag} tone={result.tone === 'bad' ? 'bad' : 'warn'}>{tag}</BankBadge>)}
            </div>
        )}
        {!!result.nextActions?.length && (
            <div className="rounded-2xl p-3 text-[12px] leading-relaxed" style={{ background: '#f5f3ef', color: '#4a4750' }}>
                <b style={{ color: INK }}>下一步</b>
                <div className="mt-1 space-y-1">{result.nextActions.map(action => <div key={action}>· {action}</div>)}</div>
            </div>
        )}
    </div>
);

export const BankActionResultModal: React.FC<{ result: BankLifeActionResult | null; currency?: string; onClose: () => void }> = ({ result, currency, onClose }) => (
    <BankModal open={!!result} title={result?.title || '结果'} sub="这次动作已经写入人生拟记录" onClose={onClose} footer={
        <button onClick={onClose} className="w-full py-3 text-[14px] font-black active:scale-95 transition-transform" style={{ background: INK, color: '#fff', borderRadius: 16, fontFamily: HAND_FONT }}>收好</button>
    }>
        {result && <BankActionResultView result={result} currency={currency} />}
    </BankModal>
);

export const BankActionHistoryDrawer: React.FC<{
    open: boolean;
    records: BankLifeActionRecord[];
    onClose: () => void;
    onSelect?: (record: BankLifeActionRecord) => void;
}> = ({ open, records, onClose, onSelect }) => (
    <BankModal open={open} title="进度记录" sub="求职、经营、投资、公司、借款和账本动作都会留在这里" onClose={onClose} wide>
        <div className="space-y-2">
            {records.length === 0 && <div className="rounded-2xl p-4 text-[12px]" style={{ background: '#faf8f5', color: INK_SOFT }}>还没有动作记录。做一次经营、投资、借款或记账后，这里会出现可回看的结果。</div>}
            {records.map(record => (
                <button
                    key={record.id}
                    onClick={() => onSelect?.(record)}
                    className="w-full text-left rounded-2xl px-3 py-2.5 active:scale-[0.99] transition-transform"
                    style={{ background: '#faf8f5', border: '1px solid rgba(43,41,51,0.06)' }}
                >
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <div className="font-black text-[13px] truncate" style={{ color: INK }}>{record.title}</div>
                            <div className="text-[11px] mt-0.5 leading-relaxed line-clamp-2" style={{ color: '#5a5660' }}>{record.aiSummary || record.summary}</div>
                        </div>
                        <div className="text-right shrink-0">
                            <BankBadge tone={record.tone || 'info'}>{record.category}</BankBadge>
                            {typeof record.amount === 'number' && <div className="mt-1 text-[11px] font-black" style={{ color: record.amount >= 0 ? '#16a34a' : '#e11d48' }}>{record.amount >= 0 ? '+' : '-'}¥{Math.abs(Math.round(record.amount))}</div>}
                        </div>
                    </div>
                    <div className="mt-1 text-[10px]" style={{ color: INK_SOFT }}>{record.dateStr}</div>
                </button>
            ))}
        </div>
    </BankModal>
);
