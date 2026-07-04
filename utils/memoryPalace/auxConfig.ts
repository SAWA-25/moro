import type { AuxApiConfig } from '../../types';
import type { LightLLMConfig } from './pipeline';

const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

export function isMemoryPalaceAuxReady(aux: AuxApiConfig | null | undefined): boolean {
    return !!(aux?.enabled && clean(aux.baseUrl) && clean(aux.apiKey) && clean(aux.model));
}

export function resolveMemoryPalaceAuxConfigs(
    aux: AuxApiConfig | null | undefined,
    _legacy?: unknown,
): { llm: LightLLMConfig | null } {
    if (!isMemoryPalaceAuxReady(aux)) {
        return { llm: null };
    }

    const baseUrl = clean(aux!.baseUrl);
    const apiKey = clean(aux!.apiKey);
    const llmModel = clean(aux!.model);

    return {
        llm: { baseUrl, apiKey, model: llmModel },
    };
}

export function resolveMemoryPalaceAuxConfigsFromStorage(): { llm: LightLLMConfig | null } {
    try {
        const auxRaw = localStorage.getItem('os_aux_api_config');
        const aux = auxRaw ? JSON.parse(auxRaw) as AuxApiConfig : null;
        return resolveMemoryPalaceAuxConfigs(aux);
    } catch {
        return { llm: null };
    }
}
