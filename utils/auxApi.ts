/**
 * 副 API 解析 —— 「主 API 聊天以外」的辅助 LLM 任务该用哪根线。
 *
 * 全局副 API 在「文具盒」里配置（OSContext.auxApiConfig）。开启且填齐时，
 * 角色生活侧写、记忆整理等后台任务走副 API；否则回退主 apiConfig，行为不变。
 *
 * 设计成纯函数 + 无状态，方便在 hooks / utils / 组件里随处调用。
 */

import type { APIConfig, AuxApiConfig } from '../types';

export interface ResolvedApi {
    baseUrl: string;
    apiKey: string;
    model: string;
    apiRole?: 'main' | 'aux' | 'custom';
    apiBinding?: string;
    fallbackFromAux?: boolean;
}

export type OptionalCustomApiConfig = Partial<Pick<APIConfig, 'baseUrl' | 'apiKey' | 'model'>>;

/** 副 API 是否「真正可用」（开关开 + URL/模型填齐）。 */
export function isAuxApiOn(aux: AuxApiConfig | null | undefined): boolean {
    return !!(aux && aux.enabled && aux.baseUrl?.trim() && aux.model?.trim());
}

/**
 * 解析辅助任务该用的 API：副 API 可用就用副 API，否则回退主 API。
 * @param aux  全局副 API 配置（可空）
 * @param main 主 API 配置（回退目标）
 */
export function resolveAuxApi(
    aux: AuxApiConfig | null | undefined,
    main: Pick<APIConfig, 'baseUrl' | 'apiKey' | 'model'>,
): ResolvedApi {
    if (isAuxApiOn(aux)) {
        return { baseUrl: aux!.baseUrl, apiKey: aux!.apiKey, model: aux!.model, apiRole: 'aux', apiBinding: '文具盒副 API' };
    }
    return { baseUrl: main.baseUrl, apiKey: main.apiKey, model: main.model, apiRole: 'main', apiBinding: '副 API 未配置，回退主 API', fallbackFromAux: true };
}

/** 可选的自定义 API 是否填齐（URL + 模型；Key 可为空以兼容本地免鉴权接口）。 */
export function isOptionalCustomApiReady(custom: OptionalCustomApiConfig | null | undefined): boolean {
    return !!(custom?.baseUrl?.trim() && custom?.model?.trim());
}

/**
 * 解析“某功能自己的 API”：填齐则用自定义 API，否则直接回退主 API。
 * 不经过文具盒副 API，适合用户明确要求“留空 = 主 API”的功能级配置。
 */
export function resolveOptionalCustomApi(
    custom: OptionalCustomApiConfig | null | undefined,
    main: Pick<APIConfig, 'baseUrl' | 'apiKey' | 'model'>,
    options: { customBinding?: string; mainBinding?: string } = {},
): ResolvedApi {
    if (isOptionalCustomApiReady(custom)) {
        return {
            baseUrl: custom!.baseUrl!.trim(),
            apiKey: (custom!.apiKey || '').trim(),
            model: custom!.model!.trim(),
            apiRole: 'custom',
            apiBinding: options.customBinding || '功能专用 API',
        };
    }
    return {
        baseUrl: main.baseUrl,
        apiKey: main.apiKey,
        model: main.model,
        apiRole: 'main',
        apiBinding: options.mainBinding || '未配置专用 API，使用主 API',
    };
}
