import React, { useEffect, useMemo, useState, useCallback } from 'react';
import Modal from '../os/Modal';
import { DB } from '../../utils/db';
import type { ApiCallLogEntry } from '../../utils/apiCallLog';

interface ApiCallLogModalProps {
    isOpen: boolean;
    onClose: () => void;
}

interface FeatureGroup {
    key: string;
    appName: string;
    appId?: string;
    featureName: string;
    actionName: string;
    entryPath?: string[];
    entries: ApiCallLogEntry[];
}

interface AppGroup {
    key: string;
    appName: string;
    entries: ApiCallLogEntry[];
    features: FeatureGroup[];
}

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
    return endpoint || '未知端点';
}

function apiRoleLabel(role?: ApiCallLogEntry['apiRole']): string {
    if (role === 'main') return '主 API';
    if (role === 'aux') return '副 API';
    if (role === 'custom') return '自定义 API';
    return '未识别';
}

function metaSourceLabel(source?: ApiCallLogEntry['metaSource']): string {
    if (source === 'explicit') return '调用点标注';
    if (source === 'ambient') return '旧记录 / 当前界面推断';
    return '旧记录 / 自动推断';
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

function entryAppName(e: ApiCallLogEntry): string {
    return e.featureId ? (e.appName || '未知 App') : '旧记录 / 未精确标注';
}

function entryFeatureName(e: ApiCallLogEntry): string {
    if (e.featureName) return e.featureName;
    if (e.featureId) return e.purpose || '未命名功能';
    return e.purpose || '未标注用途';
}

function entryActionName(e: ApiCallLogEntry): string {
    return e.actionName || (e.featureId ? '调用模型' : '推断记录');
}

function tokenLabel(e: ApiCallLogEntry): string {
    if (e.totalTokens == null) return '服务商未返回 usage';
    return `${fmtNumber(e.totalTokens)}（入 ${fmtNumber(e.promptTokens ?? 0)} · 出 ${fmtNumber(e.completionTokens ?? 0)}）`;
}

function sumTokens(entries: ApiCallLogEntry[], role?: ApiCallLogEntry['apiRole']): number {
    return entries
        .filter(e => !role || e.apiRole === role)
        .reduce((s, e) => s + (e.totalTokens ?? 0), 0);
}

function groupEntries(entries: ApiCallLogEntry[]): AppGroup[] {
    const appMap = new Map<string, AppGroup>();
    for (const e of entries) {
        const appName = entryAppName(e);
        const appKey = e.featureId ? `${e.appId || appName}:${appName}` : '__legacy__';
        if (!appMap.has(appKey)) {
            appMap.set(appKey, { key: appKey, appName, entries: [], features: [] });
        }
        appMap.get(appKey)!.entries.push(e);
    }
    for (const app of appMap.values()) {
        const featureMap = new Map<string, FeatureGroup>();
        for (const e of app.entries) {
            const featureName = entryFeatureName(e);
            const actionName = entryActionName(e);
            const featureKey = e.featureId || `${featureName}:${actionName}`;
            if (!featureMap.has(featureKey)) {
                featureMap.set(featureKey, {
                    key: featureKey,
                    appName: app.appName,
                    appId: e.appId,
                    featureName,
                    actionName,
                    entryPath: e.entryPath,
                    entries: [],
                });
            }
            featureMap.get(featureKey)!.entries.push(e);
        }
        app.features = [...featureMap.values()].sort((a, b) => b.entries.length - a.entries.length);
    }
    return [...appMap.values()].sort((a, b) => b.entries.length - a.entries.length);
}

const ApiCallLogModal: React.FC<ApiCallLogModalProps> = ({ isOpen, onClose }) => {
    const [entries, setEntries] = useState<ApiCallLogEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [expandedFeature, setExpandedFeature] = useState<string | null>(null);
    const [expandedEntry, setExpandedEntry] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await DB.getApiCallLog();
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
        setExpandedFeature(null);
        setExpandedEntry(null);
        load();
    }, [isOpen, load]);

    const handleClear = useCallback(async () => {
        if (!window.confirm('确定清空所有 API 后台流水吗？此操作不可撤销。')) return;
        await DB.clearApiCallLog();
        setEntries([]);
        setExpandedFeature(null);
        setExpandedEntry(null);
    }, []);

    const groups = useMemo(() => groupEntries(entries), [entries]);
    const successCount = entries.filter(e => e.ok).length;
    const failedCount = entries.length - successCount;
    const knownTokenEntries = entries.filter(e => e.totalTokens != null).length;
    const durations = entries.map(e => e.durationMs).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    const avgDuration = durations.length ? durations.reduce((s, v) => s + v, 0) / durations.length : undefined;
    const totalTok = sumTokens(entries);
    const mainTok = sumTokens(entries, 'main');
    const auxTok = sumTokens(entries, 'aux');
    const customTok = sumTokens(entries, 'custom');

    return (
        <Modal
            isOpen={isOpen}
            title="API 后台流水"
            onClose={onClose}
            panelClassName="max-w-3xl"
            contentClassName="max-h-[72vh]"
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
                记录最近 <span className="font-semibold text-[#2f3437]">5 天</span>的 LLM 请求，按 App 和具体功能归类。数据只保存在本地；未返回 usage 的服务商只统计次数，不估算 Token。
            </p>

            {entries.length > 0 && (
                <div className="mb-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <StatCard label="调用" value={fmtNumber(entries.length)} sub={`成功 ${successCount} · 失败 ${failedCount}`} />
                    <StatCard label="已知 Token" value={fmtNumber(totalTok)} sub={`${knownTokenEntries}/${entries.length} 条返回 usage`} />
                    <StatCard label="API 消耗" value={`主 ${fmtNumber(mainTok)} · 副 ${fmtNumber(auxTok)}`} sub={`自定义 ${fmtNumber(customTok)}`} />
                    <StatCard label="失败 / 耗时" value={`${entries.length ? Math.round((failedCount / entries.length) * 100) : 0}%`} sub={`平均 ${fmtDuration(avgDuration)}`} danger={failedCount > 0} />
                </div>
            )}

            {loading ? (
                <div className="py-10 text-center text-sm text-[#8a918d]">加载中…</div>
            ) : entries.length === 0 ? (
                <div className="py-10 text-center text-sm text-[#8a918d]">
                    暂无 API 后台流水。<br />
                    <span className="text-[11px]">测试连接、拉取模型、发起聊天或刷新此刻后，这里会显示消耗来源。</span>
                </div>
            ) : (
                <div className="space-y-4">
                    {groups.map(app => (
                        <section key={app.key} className="rounded-[22px] border border-[#e7e1d6] bg-[#fffdf8] p-3">
                            <div className="flex items-center justify-between gap-3 mb-2">
                                <div className="min-w-0">
                                    <div className="text-[10px] font-mono text-[#8a918d] uppercase">APP</div>
                                    <h3 className="text-sm font-black text-[#2f3437] truncate">{app.appName}</h3>
                                </div>
                                <div className="text-right text-[10px] text-[#69716d] shrink-0">
                                    <div className="font-black text-[#2f3437]">{fmtNumber(app.entries.length)} 次</div>
                                    <div>{fmtNumber(sumTokens(app.entries))} Token</div>
                                </div>
                            </div>

                            <div className="space-y-2">
                                {app.features.map(feature => {
                                    const expanded = expandedFeature === feature.key;
                                    const latest = feature.entries[0];
                                    const featureFailed = feature.entries.filter(e => !e.ok).length;
                                    const path = feature.entryPath?.join(' → ') || '旧记录没有精确入口';
                                    return (
                                        <div key={feature.key} className="rounded-[18px] border border-[#ece5da] bg-white p-3">
                                            <button
                                                type="button"
                                                onClick={() => setExpandedFeature(expanded ? null : feature.key)}
                                                className="w-full text-left"
                                            >
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="min-w-0">
                                                        <div className="text-sm font-black text-[#2f3437] truncate">
                                                            {feature.featureName} · {feature.actionName}
                                                        </div>
                                                        <div className="mt-1 text-[10px] text-[#69716d] truncate" title={path}>{path}</div>
                                                        <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] font-bold">
                                                            <Badge>{apiRoleLabel(latest.apiRole)}</Badge>
                                                            {latest.apiBinding ? <Badge>{latest.apiBinding}</Badge> : null}
                                                            <Badge>{feature.entries.length} 次</Badge>
                                                            {featureFailed ? <Badge danger>失败 {featureFailed}</Badge> : null}
                                                        </div>
                                                    </div>
                                                    <div className="text-right shrink-0 text-[10px] text-[#69716d]">
                                                        <div className="font-black text-[#2f3437]">{fmtNumber(sumTokens(feature.entries))}</div>
                                                        <div>Token</div>
                                                    </div>
                                                </div>
                                            </button>

                                            {expanded && (
                                                <div className="mt-3 space-y-2">
                                                    {feature.entries.map(e => (
                                                        <EntryRow
                                                            key={e.id}
                                                            entry={e}
                                                            expanded={expandedEntry === e.id}
                                                            onToggle={() => setExpandedEntry(expandedEntry === e.id ? null : e.id)}
                                                        />
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </section>
                    ))}
                </div>
            )}
        </Modal>
    );
};

const EntryRow: React.FC<{ entry: ApiCallLogEntry; expanded: boolean; onToggle: () => void }> = ({ entry: e, expanded, onToggle }) => {
    const { day, time } = formatTime(e.timestamp);
    const error = nonEmpty(e.errorMessage);
    const response = nonEmpty(e.responsePreview);
    const request = nonEmpty(e.requestPreview);
    const hasDetails = !!(error || response || request || e.baseUrl);

    return (
        <div className={`rounded-[16px] border p-3 ${e.ok ? 'bg-[#fffdf8] border-[#eee6da]' : 'bg-rose-50 border-rose-200'}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-bold">
                        <span className="text-[#8a918d]">{day}</span>
                        <span className="font-mono text-[#69716d]">{time}</span>
                        <Badge>{endpointLabel(e.endpoint)}</Badge>
                        <Badge>{metaSourceLabel(e.metaSource)}</Badge>
                    </div>
                    <div className="mt-1 text-[11px] text-[#69716d] truncate">
                        {e.presetName || e.baseUrl || '未知 API'}{e.charName ? ` · ${e.charName}` : ''}
                    </div>
                </div>
                <div className="text-right shrink-0">
                    <div className={`text-[10px] font-black px-2 py-1 rounded-full ${e.ok ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`} title={statusText(e)}>
                        {statusText(e)}
                    </div>
                    <div className="mt-1 text-[10px] text-[#8a918d]">{fmtDuration(e.durationMs)}</div>
                </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                <Field label="模型" value={e.model || (e.endpoint === 'models' ? '模型列表' : '')} mono />
                <Field label="方法" value={`${e.method || 'GET'} / ${e.endpoint || 'unknown'}`} mono />
                <Field label="API" value={apiRoleLabel(e.apiRole)} />
                <Field label="Token" value={tokenLabel(e)} />
            </div>

            {error && !expanded && (
                <div className="mt-3 rounded-2xl bg-white/70 border border-rose-100 px-3 py-2 text-[11px] text-rose-700 line-clamp-2">
                    {error}
                </div>
            )}

            {hasDetails && (
                <button
                    type="button"
                    onClick={onToggle}
                    className="mt-3 w-full py-2 rounded-2xl border border-[#e7e1d6] bg-white/80 text-[11px] font-black text-[#577782] active:scale-[0.99] transition-transform"
                >
                    {expanded ? '收起详情' : e.ok ? '查看详情' : '查看报错'}
                </button>
            )}

            {expanded && (
                <div className="mt-3 space-y-2">
                    <DetailLine label="Base URL" value={e.baseUrl} mono />
                    {e.entryPath?.length ? <DetailLine label="入口路径" value={e.entryPath.join(' → ')} /> : null}
                    {e.status || e.statusText ? <DetailLine label="HTTP 状态" value={statusText(e)} /> : null}
                    {error ? <DetailBlock label="报错文案" value={error} danger /> : null}
                    {response ? <DetailBlock label="响应摘要" value={response} mono /> : null}
                    {request ? <DetailBlock label="请求摘要" value={request} mono /> : null}
                </div>
            )}
        </div>
    );
};

const StatCard: React.FC<{ label: string; value: string; sub: string; danger?: boolean }> = ({ label, value, sub, danger }) => (
    <div className={`rounded-[18px] border px-3 py-2 ${danger ? 'bg-rose-50 border-rose-200' : 'bg-white border-[#e7e1d6]'}`}>
        <div className="text-[10px] text-[#8a918d]">{label}</div>
        <div className={`text-sm font-black ${danger ? 'text-rose-600' : 'text-[#2f3437]'}`}>{value}</div>
        <div className="text-[9px] text-[#69716d] truncate">{sub}</div>
    </div>
);

const Badge: React.FC<{ children: React.ReactNode; danger?: boolean }> = ({ children, danger }) => (
    <span className={`px-2 py-0.5 rounded-full border ${danger ? 'bg-rose-50 text-rose-600 border-rose-200' : 'bg-[#f3f7f6] text-[#577782] border-[#dce8ea]'}`}>
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
