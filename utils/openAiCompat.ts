import type { APIConfig } from '../types';

export type OpenAiEndpoint = 'chat.completions' | 'models' | 'images.generations' | 'embeddings';

export type OpenAiApiLike = Pick<APIConfig, 'baseUrl' | 'apiKey' | 'model'> | {
    baseUrl: string;
    apiKey?: string;
    model?: string;
};

const ENDPOINT_SUFFIXES = [
    /\/chat\/completions\/?$/i,
    /\/models\/?$/i,
    /\/images\/generations\/?$/i,
    /\/embeddings\/?$/i,
];

export function normalizeOpenAiBaseUrl(baseUrl: string): string {
    let value = (baseUrl || '').trim();
    if (!value) return '';
    value = value.replace(/[?#].*$/, '').replace(/\/+$/, '');
    for (const suffix of ENDPOINT_SUFFIXES) {
        value = value.replace(suffix, '').replace(/\/+$/, '');
    }
    try {
        const url = new URL(value);
        if (!url.pathname || url.pathname === '/') {
            url.pathname = '/v1';
            return url.toString().replace(/\/+$/, '');
        }
    } catch {
        // Non-absolute values are left as-is; callers may intentionally use a local proxy path.
    }
    return value;
}

export function buildOpenAiEndpoint(baseUrl: string, endpoint: OpenAiEndpoint): string {
    const base = normalizeOpenAiBaseUrl(baseUrl);
    const suffix = endpoint === 'chat.completions'
        ? 'chat/completions'
        : endpoint === 'images.generations'
            ? 'images/generations'
            : endpoint;
    return `${base}/${suffix}`;
}

export function buildOpenAiHeaders(apiKey?: string, extra?: Record<string, string>): Record<string, string> {
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${(apiKey || '').trim() || 'sk-none'}`,
        ...(extra || {}),
    };
}

export function normalizeModelList(data: unknown): string[] {
    const list =
        Array.isArray(data) ? data :
        Array.isArray((data as any)?.data) ? (data as any).data :
        Array.isArray((data as any)?.models) ? (data as any).models :
        Array.isArray((data as any)?.model_list) ? (data as any).model_list :
        [];
    return Array.from(new Set(
        list
            .map((m: any) => typeof m === 'string' ? m : (m?.id ?? m?.name ?? m?.model))
            .filter((m: unknown): m is string => typeof m === 'string' && !!m.trim())
            .map((m: string) => m.trim()),
    ));
}

export function extractApiErrorMessage(data: unknown, fallback: string): string {
    const value = data as any;
    const candidates = [
        value?.error?.message,
        typeof value?.error === 'string' ? value.error : undefined,
        value?.message,
        value?.detail,
        value?.details,
    ];
    return candidates.find((v): v is string => typeof v === 'string' && !!v.trim()) || fallback;
}

export function requireOpenAiChatConfig(api: OpenAiApiLike): void {
    if (!normalizeOpenAiBaseUrl(api.baseUrl) || !(api.model || '').trim()) {
        throw new Error('请先在「文具盒」里配置 API');
    }
}
