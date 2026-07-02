/**
 * 副 API 解析 —— 「主 API 聊天以外」的辅助 LLM 任务该用哪根线。
 *
 * 全局副 API 在「文具盒」里配置（OSContext.auxApiConfig）。开启且填齐时，
 * 日程生成/协调、角色生活侧写等后台任务走副 API；否则回退主 apiConfig，行为不变。
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
