export interface ReplyTimerMetadata {
    startedAt: number;
    finishedAt?: number;
    durationMs?: number;
    tokenCount?: number;
    model?: string;
    source?: 'fetch' | 'stream' | 'instant';
}

export const makeReplyTimerMetadata = (args: {
    startedAt: number;
    finishedAt: number;
    tokenCount?: number;
    model?: string;
    source?: ReplyTimerMetadata['source'];
}): ReplyTimerMetadata => {
    const durationMs = Math.max(0, args.finishedAt - args.startedAt);
    return {
        startedAt: args.startedAt,
        finishedAt: args.finishedAt,
        durationMs,
        ...(typeof args.tokenCount === 'number' && args.tokenCount > 0 ? { tokenCount: args.tokenCount } : {}),
        ...(args.model ? { model: args.model } : {}),
        ...(args.source ? { source: args.source } : {}),
    };
};

export const normalizeReplyTimerMetadata = (raw: unknown): ReplyTimerMetadata | null => {
    if (!raw || typeof raw !== 'object') return null;
    const data = raw as Partial<ReplyTimerMetadata>;
    const startedAt = Number(data.startedAt);
    if (!Number.isFinite(startedAt) || startedAt <= 0) return null;
    const finishedAt = Number(data.finishedAt);
    const durationMs = Number(data.durationMs);
    return {
        startedAt,
        ...(Number.isFinite(finishedAt) && finishedAt >= startedAt ? { finishedAt } : {}),
        ...(Number.isFinite(durationMs) && durationMs >= 0 ? { durationMs } : {}),
        ...(typeof data.tokenCount === 'number' && data.tokenCount > 0 ? { tokenCount: data.tokenCount } : {}),
        ...(typeof data.model === 'string' && data.model ? { model: data.model } : {}),
        ...(data.source === 'fetch' || data.source === 'stream' || data.source === 'instant' ? { source: data.source } : {}),
    };
};

export const getReplyTimerDurationMs = (timer: unknown, now = Date.now()): number | null => {
    const meta = normalizeReplyTimerMetadata(timer);
    if (!meta) return null;
    if (typeof meta.durationMs === 'number') return meta.durationMs;
    const end = meta.finishedAt || now;
    return Math.max(0, end - meta.startedAt);
};

export const formatReplyTimerDuration = (durationMs: number): string => {
    const seconds = Math.max(0, durationMs) / 1000;
    return `${seconds.toFixed(1)}s`;
};

export const formatReplyTimerValue = (timer: unknown, now = Date.now()): string => {
    const duration = getReplyTimerDurationMs(timer, now);
    return duration === null ? '' : formatReplyTimerDuration(duration);
};

const formatClock = (ts?: number): string => {
    if (!ts) return '';
    return new Date(ts).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    });
};

export const formatReplyTimerTitle = (timer: unknown, now = Date.now()): string => {
    const meta = normalizeReplyTimerMetadata(timer);
    if (!meta) return '';
    const duration = getReplyTimerDurationMs(meta, now);
    const lines = [
        `开始回复：${formatClock(meta.startedAt)}`,
        meta.finishedAt ? `收到回复：${formatClock(meta.finishedAt)}` : '',
        duration !== null ? `生成耗时：${formatReplyTimerDuration(duration)}` : '',
        meta.tokenCount && duration && duration > 0 ? `输出速度：${(meta.tokenCount / (duration / 1000)).toFixed(2)} tokens/s` : '',
        meta.model ? `模型：${meta.model}` : '',
    ];
    return lines.filter(Boolean).join('\n');
};
