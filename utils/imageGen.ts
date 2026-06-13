/**
 * AI 生图：走 OpenAI 兼容的 /images/generations 端点（与主聊天 API 共用 baseUrl + key）。
 *
 * 返回 data URI（b64_json 优先；只给 url 的供应商则直接透传 url），
 * 由调用方决定是否落相册 / 发进聊天。模型名可由调用方传入并自行持久化
 * （聊天里的「AI 画图」面板记在 localStorage，避免每次重填）。
 */

import { APIConfig } from '../types';
import { safeResponseJson } from './safeApi';

export const IMAGE_GEN_MODEL_KEY = 'moro_image_gen_model';
export const DEFAULT_IMAGE_GEN_MODEL = 'gemini-2.0-flash-exp-image-generation';

const normalizeBaseUrl = (baseUrl: string): string => {
    let url = (baseUrl || '').trim().replace(/\/+$/, '');
    // 与聊天端点同样的宽容处理：用户可能填到 /chat/completions 级别
    url = url.replace(/\/chat\/completions$/, '');
    return url;
};

export async function generateImage(
    prompt: string,
    apiConfig: APIConfig,
    model?: string,
): Promise<string> {
    const baseUrl = normalizeBaseUrl(apiConfig.baseUrl);
    if (!baseUrl || !apiConfig.apiKey) throw new Error('请先在「文具盒」里配置 API');
    const useModel = (model || '').trim() || DEFAULT_IMAGE_GEN_MODEL;

    const resp = await fetch(`${baseUrl}/images/generations`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiConfig.apiKey}`,
        },
        body: JSON.stringify({
            model: useModel,
            prompt,
            n: 1,
            response_format: 'b64_json',
        }),
    });

    if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        throw new Error(`生图失败 (${resp.status})：${errText.slice(0, 200) || resp.statusText}`);
    }

    const data = await safeResponseJson(resp);
    const item = data?.data?.[0];
    if (item?.b64_json) {
        // 多数兼容端点不回传 mime，按 png 兜底（data URI 渲染对 jpeg 数据也不敏感）
        return `data:image/png;base64,${item.b64_json}`;
    }
    if (typeof item?.url === 'string' && item.url) return item.url;
    throw new Error('生图接口没有返回图片数据（检查模型名是否支持图片生成）');
}
