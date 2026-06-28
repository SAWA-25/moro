import React, { useEffect, useState, useCallback } from 'react';
import Modal from '../os/Modal';
import { DB } from '../../utils/db';
import type { ApiCallLogEntry } from '../../utils/apiCallLog';

interface ApiCallLogModalProps {
    isOpen: boolean;
    onClose: () => void;
}

/** 把时间戳格式化成「今天 14:03:21 / 昨天 09:12 / 06-04 22:08」这种好扫的形态。 */
function formatTime(ts: number): { day: string; time: string } {
    const d = new Date(ts);
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    const sameDay = (a: Date, b: Date) =>
        a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    let day: string;
    if (sameDay(d, now)) day = '今天';
    else if (sameDay(d, yesterday)) day = '昨天';
    else day = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    return { day, time };
}

const fmtNumber = (n: number) => n.toLocaleString('en-US');

function fmtDuration(ms?: number): string {
    if (typeof ms !== 'number' || !Number.isFinite(ms)) return '—';
    if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`;
    return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`;
}

function endpointLabel(endpoint?: string): string {
    if (endpoint === 'chat/completions') return '聊天补全';
    if (endpoint === 'models') return '拉取模型';
    if (endpoint === 'images/generations') return '图像生成';
    return endpoint || '未知端点';
}

function apiRoleLabel(role?: ApiCallLogEntry['apiRole']): string {
    if (role === 'main') return '主 API';
    if (role === 'aux') return '副 API';
    if (role === 'custom') return '自定义接口';
    return '未识别';
}

function metaSourceLabel(source?: ApiCallLogEntry['metaSource']): string {
    if (source === 'explicit') return '调用点标注';
    if (source === 'ambient') return '当前界面推断';
    return '自动推断';
}

function statusText(e: ApiCallLogEntry): string {
    const code = e.status ? ` ${e.status}` : '';
    const text = e.statusText ? ` ${e.statusText}` : '';
    return `${e.ok ? '成功' : '失败'}${code}${text}`;
}

function nonEmpty(value?: string): string | undefined {
    const v = value?.trim();
    return v || undefined;
}

const ApiCallLogModal: React.FC<ApiCallLogModalProps> = ({ isOpen, onClose }) => {
    const [entries, setEntries] = useState<ApiCallLogEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [expandedId, setExpandedId] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await DB.getApiCallLog();
            // DB 里已按新→旧 unshift，这里再兜底排一次序。
            data.sort((a: ApiCallLogEntry, b: ApiCallLogEntry) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
            setEntries(data);
        } catch {
            setEntries([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!isOpen) return;
        setExpandedId(null);
        load();
    }, [isOpen, load]);

    const handleClear = useCallback(async () => {
        if (!window.confirm('确定清空所有 API 调用记录吗？此操作不可撤销。')) return;
        await DB.clearApiCallLog();
        setEntries([]);
        setExpandedId(null);
    }, []);

    const successCount = entries.filter(e => e.ok).length;
    const failedCount = entries.length - successCount;
    const durations = entries.map(e => e.durationMs).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    const avgDuration = durations.length ? durations.reduce((s, v) => s + v, 0) / durations.length : undefined;
    const totalTok = entries.reduce((s, e) => s + (e.totalTokens ?? 0), 0);
    const promptTok = entries.reduce((s, e) => s + (e.promptTokens ?? 0), 0);
    const compTok = entries.reduce((s, e) => s + (e.completionTokens ?? 0), 0);

    return (
        <Modal
            isOpen={isOpen}
            title="API 调用记录"
            onClose={onClose}
            panelClassName="max-w-2xl"
            contentClassName="max-h-[70vh]"
            footer={
                <div className="flex gap-2 w-full">
                    <button
                        onClick={onClose}
                        className="flex-1 py-3 bg-white border border-[#e7e1d6] text-[#577782] font-bold rounded-2xl active:scale-95 transition-transform"
                    >
                        关闭
                    </button>
                    <button
                        onClick={handleClear}
                        disabled={entries.length === 0}
                        className="px-5 py-3 bg-rose-50 text-rose-500 font-bold rounded-2xl active:scale-95 transition-transform disabled:opacity-40"
                    >
                        清空
                    </button>
                </div>
            }
        >
            <p className="text-[11px] text-[#69716d] mb-3 leading-relaxed px-1">
                记录最近 <span className="font-semibold text-[#2f3437]">5 天</span>的聊天补全和模型列表请求。数据只保存在本地，用来定位接口、应用、用途和错误原因。
            </p>

            {entries.length > 0 && (
                <div className="mb-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <StatCard label="调用" value={fmtNumber(entries.length)} sub={`成功 ${successCount} · 失败 ${failedCount}`} />
                    <StatCard label="平均耗时" value={fmtDuration(avgDuration)} sub="按已记录耗时计算" />
                    <StatCard label="总 Token" value={fmtNumber(totalTok)} sub={`入 ${fmtNumber(promptTok)} · 出 ${fmtNumber(compTok)}`} />
                    <StatCard label="失败率" value={`${entries.length ? Math.round((failedCount / entries.length) * 100) : 0}%`} sub="失败项可查看报错" danger={failedCount > 0} />
                </div>
            )}

            {loading ? (
                <div className="py-10 text-center text-sm text-[#8a918d]">加载中…</div>
            ) : entries.length === 0 ? (
                <div className="py-10 text-center text-sm text-[#8a918d]">
                    暂无调用记录。<br />
                    <span className="text-[11px]">测试连接、拉取模型或发起聊天后，这里会显示接口记录。</span>
                </div>
            ) : (
                <div className="space-y-2">
                    {entries.map((e) => {
                        const { day, time } = formatTime(e.timestamp);
                        const expanded = expandedId === e.id;
                        const error = nonEmpty(e.errorMessage);
                        const response = nonEmpty(e.responsePreview);
                        const request = nonEmpty(e.requestPreview);
                        const hasDetails = !!(error || response || request || e.baseUrl);

                        return (
                            <div
                                key={e.id}
                                className={`rounded-[22px] border p-3 shadow-[0_10px_24px_-22px_rgba(90,49,64,0.35)] ${
                                    e.ok ? 'bg-white border-[#e7e1d6]' : 'bg-rose-50/80 border-rose-200'
                                }`}
                            >
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-bold">
                                            <span className="text-[#8a918d]">{day}</span>
                                            <span className="font-mono text-[#69716d]">{time}</span>
                                            <Badge>{apiRoleLabel(e.apiRole)}</Badge>
                                            <Badge>{endpointLabel(e.endpoint)}</Badge>
                                        </div>
                                        <div className="mt-1 text-sm font-black text-[#2f3437] truncate">
                                            {e.appName || '未知 App'} · {e.purpose || '未标注用途'}
                                        </div>
                                        <div className="mt-1 text-[11px] text-[#69716d] truncate">
                                            {e.presetName || e.baseUrl || '未知 API'}{e.charName ? ` · ${e.charName}` : ''}
                                        </div>
                                    </div>

                                    <div className="text-right shrink-0">
                                        <div
                                            className={`text-[10px] font-black px-2 py-1 rounded-full ${
                                                e.ok ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                                            }`}
                                            title={statusText(e)}
                                        >
                                            {statusText(e)}
                                        </div>
                                        <div className="mt-1 text-[10px] text-[#8a918d]">{fmtDuration(e.durationMs)}</div>
                                    </div>
                                </div>

                                <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                                    <Field label="模型" value={e.model || (e.endpoint === 'models' ? '模型列表' : '')} mono />
                                    <Field label="方法" value={`${e.method || 'GET'} / ${e.endpoint || 'unknown'}`} mono />
                                    <Field label="来源" value={metaSourceLabel(e.metaSource)} />
                                    <Field label="Token" value={e.totalTokens != null ? `${fmtNumber(e.totalTokens)}（入 ${fmtNumber(e.promptTokens ?? 0)} · 出 ${fmtNumber(e.completionTokens ?? 0)}）` : '—'} />
                                </div>

                                {error && !expanded && (
                                    <div className="mt-3 rounded-2xl bg-white/70 border border-rose-100 px-3 py-2 text-[11px] text-rose-700 line-clamp-2">
                                        {error}
                                    </div>
                                )}

                                {hasDetails && (
                                    <button
                                        type="button"
                                        onClick={() => setExpandedId(expanded ? null : e.id)}
                                        className="mt-3 w-full py-2 rounded-2xl border border-[#e7e1d6] bg-white/80 text-[11px] font-black text-[#577782] active:scale-[0.99] transition-transform"
                                    >
                                        {expanded ? '收起详情' : e.ok ? '查看详情' : '查看报错'}
                                    </button>
                                )}

                                {expanded && (
                                    <div className="mt-3 space-y-2">
                                        <DetailLine label="Base URL" value={e.baseUrl} mono />
                                        {e.status || e.statusText ? <DetailLine label="HTTP 状态" value={statusText(e)} /> : null}
                                        {error ? <DetailBlock label="报错文案" value={error} danger /> : null}
                                        {response ? <DetailBlock label="响应摘要" value={response} mono /> : null}
                                        {request ? <DetailBlock label="请求摘要" value={request} mono /> : null}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </Modal>
    );
};

const StatCard: React.FC<{ label: string; value: string; sub: string; danger?: boolean }> = ({ label, value, sub, danger }) => (
    <div className={`rounded-[18px] border px-3 py-2 ${danger ? 'bg-rose-50 border-rose-200' : 'bg-white border-[#e7e1d6]'}`}>
        <div className="text-[10px] text-[#8a918d]">{label}</div>
        <div className={`text-sm font-black ${danger ? 'text-rose-600' : 'text-[#2f3437]'}`}>{value}</div>
        <div className="text-[9px] text-[#69716d] truncate">{sub}</div>
    </div>
);

const Badge: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <span className="px-2 py-0.5 rounded-full bg-[#f3f7f6] text-[#577782] border border-[#dce8ea]">
        {children}
    </span>
);

const Field: React.FC<{ label: string; value?: string; mono?: boolean }> = ({ label, value, mono }) => (
    <div className="flex items-baseline gap-1.5 min-w-0">
        <span className="text-[10px] text-[#8a918d] shrink-0">{label}</span>
        <span className={`truncate text-[#2f3437] ${mono ? 'font-mono' : ''}`} title={value || ''}>
            {value && value.trim() ? value : '—'}
        </span>
    </div>
);

const DetailLine: React.FC<{ label: string; value?: string; mono?: boolean }> = ({ label, value, mono }) => (
    <div className="rounded-2xl bg-white/80 border border-[#e7e1d6] px-3 py-2 text-[11px]">
        <div className="text-[10px] font-black text-[#8a918d]">{label}</div>
        <div className={`mt-0.5 text-[#2f3437] break-all ${mono ? 'font-mono' : ''}`}>{value || '—'}</div>
    </div>
);

const DetailBlock: React.FC<{ label: string; value: string; mono?: boolean; danger?: boolean }> = ({ label, value, mono, danger }) => (
    <div className={`rounded-2xl border px-3 py-2 ${danger ? 'bg-rose-50 border-rose-200' : 'bg-white/80 border-[#e7e1d6]'}`}>
        <div className={`text-[10px] font-black ${danger ? 'text-rose-500' : 'text-[#8a918d]'}`}>{label}</div>
        <pre className={`mt-1 whitespace-pre-wrap break-words text-[11px] leading-relaxed ${danger ? 'text-rose-700' : 'text-[#2f3437]'} ${mono ? 'font-mono' : 'font-sans'}`}>
            {value}
        </pre>
    </div>
);

export default ApiCallLogModal;
