// 日记 App 公共逻辑：被「交换日记」(JournalApp) 与「日记社」(ExchangeDiaryApp) 两个模式共用。
// 两种模式 UI / 数据模型不同，但底层调用 LLM、抠 JSON、取本地日期是同一套，统一收在这里。
import { safeResponseJson } from '../utils/safeApi';

// 本地日期 YYYY-MM-DD（别用 toISOString，会偏到 UTC）
export const getDiaryDateStr = (d = new Date()): string => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};

// 宽容地从 LLM 输出里抠 JSON：剥代码围栏 → 直接 parse → 截取首个 {...} 再 parse
export const parseJsonLoose = (raw: string): any | null => {
    const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
    try { return JSON.parse(cleaned); } catch { /* fallthrough */ }
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
        try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { /* fallthrough */ }
    }
    return null;
};

export interface DiaryApiConfig {
    apiKey: string;
    baseUrl: string;
    model: string;
}

// 主 API 一次性 chat/completions 调用，返回 trim 过的正文（可能为空，由调用方按需校验）。
export const callDiaryLLM = async (
    apiConfig: DiaryApiConfig,
    messages: { role: 'system' | 'user'; content: string }[],
    options: { temperature?: number; maxTokens?: number } = {},
): Promise<string> => {
    if (!apiConfig.apiKey) throw new Error('请先在「文具盒」里配置 API');
    const body: Record<string, unknown> = {
        model: apiConfig.model,
        messages,
        temperature: options.temperature ?? 0.85,
    };
    if (options.maxTokens) body.max_tokens = options.maxTokens;
    const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
        body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`API 请求失败 (${response.status})`);
    const data = await safeResponseJson(response);
    return (data.choices?.[0]?.message?.content || '').trim();
};
