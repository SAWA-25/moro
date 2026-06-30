import type { AuxApiConfig } from '../../types';
import type { EmbeddingConfig } from './types';
import type { LightLLMConfig } from './pipeline';

export const MEMORY_PALACE_EMBEDDING_MODEL = 'BAAI/bge-m3';
export const MEMORY_PALACE_EMBEDDING_DIMENSIONS = 1024;

type LegacyMemoryPalaceConfig = {
    embedding?: {
        model?: string;
        dimensions?: number;
    };
};

const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

export function isMemoryPalaceAuxReady(aux: AuxApiConfig | null | undefined): boolean {
    return !!(aux?.enabled && clean(aux.baseUrl) && clean(aux.apiKey) && clean(aux.model));
}

export function resolveMemoryPalaceAuxConfigs(
    aux: AuxApiConfig | null | undefined,
    legacy?: LegacyMemoryPalaceConfig | null,
): { llm: LightLLMConfig | null; embedding: EmbeddingConfig | null } {
    if (!isMemoryPalaceAuxReady(aux)) {
        return { llm: null, embedding: null };
    }

    const baseUrl = clean(aux!.baseUrl);
    const apiKey = clean(aux!.apiKey);
    const llmModel = clean(aux!.model);
    const embeddingModel = clean(legacy?.embedding?.model) || MEMORY_PALACE_EMBEDDING_MODEL;
    const embeddingDimensions = Math.max(1, Math.floor(Number(legacy?.embedding?.dimensions)) || MEMORY_PALACE_EMBEDDING_DIMENSIONS);

    return {
        llm: { baseUrl, apiKey, model: llmModel },
        embedding: {
            baseUrl,
            apiKey,
            model: embeddingModel,
            dimensions: embeddingDimensions,
        },
    };
}

export function resolveMemoryPalaceAuxConfigsFromStorage(): { llm: LightLLMConfig | null; embedding: EmbeddingConfig | null } {
    try {
        const auxRaw = localStorage.getItem('os_aux_api_config');
        const legacyRaw = localStorage.getItem('os_memory_palace_config');
        const aux = auxRaw ? JSON.parse(auxRaw) as AuxApiConfig : null;
        const legacy = legacyRaw ? JSON.parse(legacyRaw) as LegacyMemoryPalaceConfig : null;
        return resolveMemoryPalaceAuxConfigs(aux, legacy);
    } catch {
        return { llm: null, embedding: null };
    }
}
