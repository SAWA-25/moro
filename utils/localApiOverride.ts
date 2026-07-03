import type { APIConfig, AuxApiConfig } from '../types';
import { resolveAuxApi, type ResolvedApi } from './auxApi';

export const SOCIAL_API_OVERRIDE_STORAGE_KEY = 'moro_social_api_override_v1';
export const THEATER_EXTRA_API_OVERRIDE_STORAGE_KEY = 'moro_theater_extra_api_override_v1';

export type LocalApiOverrideScope = 'social' | 'theaterExtra';

export interface LocalApiOverrideConfig {
    baseUrl: string;
    apiKey: string;
    model: string;
    updatedAt?: number;
}

const EMPTY_OVERRIDE: LocalApiOverrideConfig = { baseUrl: '', apiKey: '', model: '' };

const SCOPE_META: Record<LocalApiOverrideScope, { storageKey: string; apiBinding: string }> = {
    social: { storageKey: SOCIAL_API_OVERRIDE_STORAGE_KEY, apiBinding: '见闻簿专用 API' },
    theaterExtra: { storageKey: THEATER_EXTRA_API_OVERRIDE_STORAGE_KEY, apiBinding: '折子戏番外专用 API' },
};

const storage = (): Storage | null => {
    try {
        return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
        return null;
    }
};

export function getLocalApiOverrideMeta(scope: LocalApiOverrideScope) {
    return SCOPE_META[scope];
}

export function normalizeLocalApiOverrideConfig(config: Partial<LocalApiOverrideConfig> | null | undefined): LocalApiOverrideConfig {
    return {
        baseUrl: String(config?.baseUrl || '').trim(),
        apiKey: String(config?.apiKey || '').trim(),
        model: String(config?.model || '').trim(),
        updatedAt: typeof config?.updatedAt === 'number' ? config.updatedAt : undefined,
    };
}

export function isLocalApiOverrideComplete(config: Partial<LocalApiOverrideConfig> | null | undefined): boolean {
    const normalized = normalizeLocalApiOverrideConfig(config);
    return !!(normalized.baseUrl && normalized.model);
}

export function loadLocalApiOverride(scope: LocalApiOverrideScope): LocalApiOverrideConfig {
    const store = storage();
    if (!store) return { ...EMPTY_OVERRIDE };
    try {
        const raw = store.getItem(SCOPE_META[scope].storageKey);
        if (!raw) return { ...EMPTY_OVERRIDE };
        return normalizeLocalApiOverrideConfig(JSON.parse(raw));
    } catch {
        return { ...EMPTY_OVERRIDE };
    }
}

export function saveLocalApiOverride(scope: LocalApiOverrideScope, config: Partial<LocalApiOverrideConfig>): LocalApiOverrideConfig {
    const normalized = normalizeLocalApiOverrideConfig({ ...config, updatedAt: Date.now() });
    const store = storage();
    const hasAnyField = !!(normalized.baseUrl || normalized.apiKey || normalized.model);
    if (!hasAnyField) {
        if (store) store.removeItem(SCOPE_META[scope].storageKey);
        return { ...EMPTY_OVERRIDE };
    }
    if (!normalized.baseUrl || !normalized.model) {
        throw new Error('专用 API 需要填写 Base URL 和模型名');
    }
    if (store) store.setItem(SCOPE_META[scope].storageKey, JSON.stringify(normalized));
    return normalized;
}

export function clearLocalApiOverride(scope: LocalApiOverrideScope): void {
    storage()?.removeItem(SCOPE_META[scope].storageKey);
}

export function resolveLocalApiOverride(scope: LocalApiOverrideScope, fallback: ResolvedApi): ResolvedApi {
    const local = loadLocalApiOverride(scope);
    if (!isLocalApiOverrideComplete(local)) return fallback;
    return {
        baseUrl: local.baseUrl,
        apiKey: local.apiKey,
        model: local.model,
        apiRole: 'custom',
        apiBinding: SCOPE_META[scope].apiBinding,
    };
}

export function resolveScopedLocalApi(
    scope: LocalApiOverrideScope,
    aux: AuxApiConfig | null | undefined,
    main: Pick<APIConfig, 'baseUrl' | 'apiKey' | 'model'>,
): ResolvedApi {
    return resolveLocalApiOverride(scope, resolveAuxApi(aux, main));
}
