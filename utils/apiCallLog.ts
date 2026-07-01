/**
 * 全局 API 后台流水（给 文具盒 → API 后台流水 页面用）。
 *
 * 设计：项目里 LLM 调用分两类——走 `utils/safeApi.ts` 的 `safeFetchJson` 的，和
 * 各 App 自己写的裸 `fetch`（TRPG / 自习室 / 群聊 / 日记…）。为了一个都不漏，记录点
 * 放在 `OSContext` 里那个全局 `fetch` monkey-patch 上：所有 `/chat/completions`
 * 与 `/models`（含 safeFetchJson 内部 fetch）都经过它，统一调 `recordApiCall`，不重复计。
 *
 * 「时间 / 哪个 API / 哪个模型 / token」从请求体 + 响应里自动解析；「哪个 App / 哪个
 * 角色 / 具体用途」靠两条来源：
 *   1. 显式 meta —— safeFetchJson 调用点通过第 5 个参数传，挂到 RequestInit 的
 *      `__moroMeta` 上由拦截器读取（精确，含 purpose）。
 *   2. 环境兜底 ambientMeta —— OSContext 在切 App / 角色时写入「当前在哪个 App、
 *      当前角色」，裸 fetch 没有显式 meta 时用它兜底标 App / 角色。
 *
 * 只保留近 5 天，超期在 DB 层写入时丢弃。recordApiCall 是 best-effort：任何异常都
 * 吞掉，绝不影响主请求链路。
 */

import { getApiUsageFeature, hydrateApiUsageMeta } from './apiUsageCatalog';
import type { ApiRole } from './apiUsageCatalog';

/** 调用方可补充的语义信息（哪个 App / 角色 / 用途）。能填多少填多少。 */
export interface ApiCallMeta {
    /** 统一登记表里的稳定功能 ID，如 settings.mainApi.testConnection。 */
    featureId?: string;
    /** AppID 字符串，如 'chat' / 'lifesim'，可空 */
    appId?: string;
    /** App 显示名，如 '消息' / '记忆宫殿'，列表里直接展示这个 */
    appName?: string;
    /** 角色 id，可空 */
    charId?: string;
    /** 角色名，可空 */
    charName?: string;
    /** 具体用途，如 '聊天回复' / '情绪评估' / '记忆提取'，可空 */
    purpose?: string;
    /** 调用的是主 API / 副 API / 自定义接口；调用点知道时可显式传入。 */
    apiRole?: ApiRole | string;
    /** 具体绑定来源，如 群聊默认 API / 成员专属 API / 页外独立 API。 */
    apiBinding?: string;
    /** 是否属于后台 / 辅助任务。 */
    isBackgroundTask?: boolean;
    /** 展示字段：功能名、动作名、入口路径。 */
    featureName?: string;
    actionName?: string;
    entryPath?: string[];
}

/** 落库的一条记录。 */
export interface ApiCallLogEntry extends ApiCallMeta {
    id: string;
    /** 调用发起（实际是响应回来）时间戳 ms */
    timestamp: number;
    /** 命中的预设名；匹配不到时回退成 baseUrl 的 host */
    presetName: string;
    baseUrl: string;
    model: string;
    /** HTTP 状态码（成功 / 失败均记，失败时可能是最后一次的状态） */
    status?: number;
    statusText?: string;
    /** 请求是否成功拿到 JSON */
    ok: boolean;
    /** 请求方法与端点类型，方便区分 /chat/completions 与 /models。 */
    method?: string;
    endpoint?: string;
    /** 主 API / 副 API / 自定义接口。 */
    apiRole?: ApiRole;
    /** 从发起 fetch 到收到响应/失败的耗时。 */
    durationMs?: number;
    /** 记录信息的来源：显式 meta、当前界面兜底、自动推断。 */
    metaSource?: 'explicit' | 'ambient' | 'inferred';
    /** 请求摘要（本地保存，不上传；避免整段 prompt 占用过多空间）。 */
    requestPreview?: string;
    /** 失败响应或解析失败时的原始返回摘要。 */
    responsePreview?: string;
    /** 失败时抽取出来的核心错误文案。 */
    errorMessage?: string;
    /** 输入 token（prompt_tokens），来自响应 usage，拿不到则空 */
    promptTokens?: number;
    /** 输出 token（completion_tokens） */
    completionTokens?: number;
    /** 总 token（total_tokens） */
    totalTokens?: number;
}

const PRESETS_STORAGE_KEY = 'os_api_presets';

/**
 * 环境上下文（兜底用）：很多 App 走的是裸 fetch，调用点无法/来不及传 meta。
 * OSContext 会在切换 App / 角色时把「当前在哪个 App、当前角色是谁」写到这里，
 * 全局 fetch 拦截器记录裸 fetch 调用时拿它当兜底标签。
 * 注意：safeFetchJson 传了显式 meta 的调用以显式 meta 为准，不用兜底（避免后台
 * 任务被误标成用户当前所在的 App）。
 */
let ambientMeta: ApiCallMeta = {};

export function setApiCallAmbientContext(meta: ApiCallMeta): void {
    ambientMeta = meta || {};
}

function hasMeta(meta?: ApiCallMeta): boolean {
    return !!meta && Object.values(meta).some((v) => v != null && v !== '');
}

function stripTrailingSlash(s: string): string {
    return s.replace(/\/+$/, '');
}

/** 把 `https://host/v1/chat/completions` 还原成 `https://host/v1`（预设里存的 baseUrl 形态）。 */
function deriveBaseUrl(url: string): string {
    try {
        const u = new URL(url);
        u.pathname = u.pathname
            .replace(/\/chat\/completions\/?$/i, '')
            .replace(/\/models\/?$/i, '')
            .replace(/\/images\/generations\/?$/i, '');
        u.search = '';
        u.hash = '';
        return stripTrailingSlash(u.toString());
    } catch {
        return stripTrailingSlash(url.split(/[?#]/)[0]
        .replace(/\/chat\/completions\/?$/i, '')
        .replace(/\/models\/?$/i, '')
        .replace(/\/images\/generations\/?$/i, ''));
    }
}

function hostOf(url: string): string {
    try {
        return new URL(url).host;
    } catch {
        return url;
    }
}

/** 从请求体里抠出 model 字段（body 可能是 JSON 字符串或对象）。 */
function parseBody(body: unknown): any {
    if (!body) return '';
    let parsed: any = body;
    if (typeof body === 'string') {
        try { parsed = JSON.parse(body); } catch { return ''; }
    }
    return parsed;
}

function extractModel(body: unknown): string {
    const parsed = parseBody(body);
    return typeof parsed?.model === 'string' ? parsed.model : '';
}

function endpointOf(url: string): string {
    const path = (() => {
        try { return new URL(url).pathname; } catch { return url.split(/[?#]/)[0]; }
    })();
    if (/\/chat\/completions\/?$/i.test(path)) return 'chat/completions';
    if (/\/models\/?$/i.test(path)) return 'models';
    if (/\/images\/generations\/?$/i.test(path)) return 'images/generations';
    return path.replace(/^\/+/, '') || 'unknown';
}

/**
 * 用 baseUrl + model 在用户保存的预设里反查预设名（截图里的「奇异果 / 铃兰 / 千岛2」那些）。
 * 预设结构见 types.ts ApiPreset：{ id, name, config: { baseUrl, apiKey, model } }。
 * 匹配不到（比如用的是没存成预设的临时配置）就回退成 host。
 */
function resolvePresetName(baseUrl: string, model: string): string {
    try {
        if (typeof localStorage === 'undefined') return hostOf(baseUrl);
        const raw = localStorage.getItem(PRESETS_STORAGE_KEY);
        if (!raw) return hostOf(baseUrl);
        const presets = JSON.parse(raw);
        if (!Array.isArray(presets)) return hostOf(baseUrl);
        const normBase = stripTrailingSlash(baseUrl);
        // 优先 baseUrl + model 都对上；退而求其次只对 baseUrl
        const exact = presets.find((p: any) =>
            stripTrailingSlash(p?.config?.baseUrl || '') === normBase &&
            (p?.config?.model || '') === model);
        if (exact?.name) return exact.name;
        const byBase = presets.find((p: any) =>
            stripTrailingSlash(p?.config?.baseUrl || '') === normBase);
        if (byBase?.name) return byBase.name;
        return hostOf(baseUrl);
    } catch {
        return hostOf(baseUrl);
    }
}

function readJsonLocalStorage(key: string): any | null {
    try {
        if (typeof localStorage === 'undefined') return null;
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function explicitApiRole(role?: ApiCallMeta['apiRole']): ApiRole | undefined {
    return role === 'main' || role === 'aux' || role === 'custom' ? role : undefined;
}

function resolveApiRole(baseUrl: string, model: string, explicit?: ApiCallMeta['apiRole']): ApiRole {
    const explicitRole = explicitApiRole(explicit);
    if (explicitRole) return explicitRole;
    const normBase = stripTrailingSlash(baseUrl);
    const same = (cfg: any) => cfg && stripTrailingSlash(cfg.baseUrl || '') === normBase
        && (!model || !cfg.model || cfg.model === model);
    const aux = readJsonLocalStorage('os_aux_api_config');
    if (aux?.enabled && same(aux)) return 'aux';
    const main = readJsonLocalStorage('os_api_config');
    if (same(main)) return 'main';
    return 'custom';
}

/**
 * 记录一次 API 调用。fire-and-forget，绝不 throw / 阻塞主链路。
 * 在全局 fetch 拦截器里对 `/chat/completions` 和 `/models` 的成功与失败都会调用。
 */
/** 从 OpenAI 兼容响应里抠 usage（各家代理大多遵循这个字段）。 */
function extractUsage(response: unknown): { prompt?: number; completion?: number; total?: number } {
    const usage = (response as any)?.usage;
    if (!usage || typeof usage !== 'object') return {};
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
    return {
        prompt: num(usage.prompt_tokens),
        completion: num(usage.completion_tokens),
        total: num(usage.total_tokens),
    };
}

function flattenMessagesForHint(body: unknown): string {
    const parsed = parseBody(body);
    const messages = Array.isArray(parsed?.messages) ? parsed.messages : [];
    const pieces = messages.slice(-4).map((m: any) => {
        const content = m?.content;
        if (typeof content === 'string') return content;
        if (Array.isArray(content)) return content.map((p: any) => p?.text || p?.content || '').join('\n');
        return '';
    });
    return pieces.join('\n').slice(0, 4000);
}

function inferPurpose(input: { endpoint: string; body?: unknown; appName?: string; explicitPurpose?: string }): string | undefined {
    if (input.explicitPurpose?.trim()) return input.explicitPurpose.trim();
    if (input.endpoint === 'models') return '拉取模型列表';
    const parsed = parseBody(input.body);
    const hint = flattenMessagesForHint(input.body);
    const shortHint = hint.trim();
    if (/^hi$/i.test(shortHint) || (parsed?.max_tokens ?? 0) <= 8 && /hi|ping|hello/i.test(shortHint)) return '连接测试';
    const rules: Array<[RegExp, string]> = [
        [/回神|校准|漂移|recenter/i, '回神校准'],
        [/日程|行程|schedule|anchor/i, '日程生成/协调'],
        [/生活侧写|life\s*profile|更了解自己/i, '生活侧写'],
        [/记忆|回忆|memory|向量|消化|提取|关联|认知|总结|摘要/i, '记忆处理'],
        [/翻译|translate|translation/i, '翻译'],
        [/情绪|心情|emotion|mood/i, '情绪分析'],
        [/小红书|xhs|rednote/i, '小红书工具'],
        [/外卖|店铺|食评|takeout|订单/i, '外卖生成'],
        [/约会|街角|场景|世界引擎|date/i, '约会/街角生成'],
        [/世界书|worldbook/i, '世界书处理'],
        [/番外|占卜|塔罗|狼人杀|真心话|TRPG|剧本/i, '折子戏生成'],
        [/歌词|歌曲|写歌|music|song/i, '音乐生成'],
        [/HTML|CSS|网页|浏览器|搜索|search/i, '网页/搜索生成'],
        [/人设|角色卡|导入|润色|persona|character/i, '角色资料生成'],
    ];
    const matched = rules.find(([re]) => re.test(hint));
    if (matched) return matched[1];
    if (input.appName === '文具盒') return '连接测试';
    if (input.appName === '絮语' || input.appName === '消息') return '聊天回复';
    return undefined;
}

function inferAppName(purpose?: string, appName?: string): string | undefined {
    if (appName?.trim()) return appName.trim();
    if (!purpose) return undefined;
    if (/记忆|回忆|认知/.test(purpose)) return '回忆标本馆';
    if (/日程/.test(purpose)) return '岁时记';
    if (/生活侧写|角色资料/.test(purpose)) return '登场人物';
    if (/小红书/.test(purpose)) return '小红书';
    if (/外卖/.test(purpose)) return '外卖';
    if (/约会|街角/.test(purpose)) return '街角';
    if (/折子戏/.test(purpose)) return '折子戏';
    return undefined;
}

function compactText(text: string | undefined, max = 4000): string | undefined {
    const t = (text || '').trim();
    if (!t) return undefined;
    return t.length > max ? `${t.slice(0, max)}\n…（已截断 ${t.length - max} 字）` : t;
}

function requestPreview(body: unknown): string | undefined {
    const parsed = parseBody(body);
    if (!parsed || typeof parsed !== 'object') return compactText(typeof body === 'string' ? body : '');
    const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
    const last = messages.length ? messages[messages.length - 1] : undefined;
    const content = typeof last?.content === 'string'
        ? last.content
        : Array.isArray(last?.content)
            ? last.content.map((p: any) => p?.text || p?.content || '').join('\n')
            : '';
    const summary = [
        parsed.model ? `model: ${parsed.model}` : '',
        messages.length ? `messages: ${messages.length}` : '',
        parsed.max_tokens != null ? `max_tokens: ${parsed.max_tokens}` : '',
        parsed.temperature != null ? `temperature: ${parsed.temperature}` : '',
        content ? `last ${last?.role || 'message'}: ${content}` : '',
    ].filter(Boolean).join('\n');
    return compactText(summary, 1600);
}

function responsePreview(response: unknown, responseText?: string, ok?: boolean): string | undefined {
    if (response && !ok) {
        try { return compactText(JSON.stringify(response, null, 2)); } catch { /* ignore */ }
    }
    return ok ? undefined : compactText(responseText);
}

function extractErrorMessage(input: { status?: number; statusText?: string; response?: unknown; responseText?: string; errorMessage?: string }): string | undefined {
    if (input.errorMessage?.trim()) return compactText(input.errorMessage, 1200);
    const data: any = input.response;
    const candidates = [
        data?.error?.message,
        typeof data?.error === 'string' ? data.error : undefined,
        data?.message,
        data?.detail,
        data?.details,
    ];
    const found = candidates.find((v) => typeof v === 'string' && v.trim());
    if (found) return compactText(found, 1200);
    const raw = (input.responseText || '').trim();
    if (raw) {
        const title = raw.match(/<title>(.*?)<\/title>/i)?.[1];
        return compactText(title || raw, 1200);
    }
    if (input.status) return `HTTP ${input.status}${input.statusText ? ` ${input.statusText}` : ''}`;
    return undefined;
}

export function recordApiCall(input: {
    url: string;
    method?: string;
    body?: unknown;
    status?: number;
    statusText?: string;
    ok: boolean;
    response?: unknown;
    responseText?: string;
    errorMessage?: string;
    durationMs?: number;
    meta?: ApiCallMeta;
}): void {
    try {
        const baseUrl = deriveBaseUrl(input.url);
        const model = extractModel(input.body);
        const endpoint = endpointOf(input.url);
        // 显式 meta 优先（safeFetchJson 各调用点传的精确信息）；没有就用环境兜底（裸 fetch）。
        const metaSource: ApiCallLogEntry['metaSource'] = hasMeta(input.meta)
            ? 'explicit'
            : hasMeta(ambientMeta)
                ? 'ambient'
                : 'inferred';
        const rawMeta = hasMeta(input.meta) ? input.meta! : ambientMeta;
        const meta = hydrateApiUsageMeta(rawMeta);
        const feature = getApiUsageFeature(meta.featureId);
        const purpose = feature
            ? `${feature.featureName} · ${feature.actionName}`
            : inferPurpose({ endpoint, body: input.body, appName: meta.appName, explicitPurpose: meta.purpose });
        const appName = feature?.appName || inferAppName(purpose, meta.appName);
        const usage = extractUsage(input.response);
        const entry: ApiCallLogEntry = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            timestamp: Date.now(),
            presetName: resolvePresetName(baseUrl, model),
            baseUrl,
            model,
            status: input.status,
            statusText: input.statusText,
            ok: input.ok,
            method: input.method || 'POST',
            endpoint,
            apiRole: resolveApiRole(baseUrl, model, meta.apiRole),
            durationMs: input.durationMs,
            metaSource,
            requestPreview: requestPreview(input.body),
            responsePreview: responsePreview(input.response, input.responseText, input.ok),
            errorMessage: extractErrorMessage(input),
            promptTokens: usage.prompt,
            completionTokens: usage.completion,
            totalTokens: usage.total,
            appId: meta.appId,
            appName,
            charId: meta.charId,
            charName: meta.charName,
            purpose,
            featureId: feature?.featureId || meta.featureId,
            featureName: feature?.featureName || meta.featureName,
            actionName: feature?.actionName || meta.actionName,
            entryPath: feature?.entryPath || meta.entryPath,
            apiBinding: meta.apiBinding,
            isBackgroundTask: meta.isBackgroundTask,
        };
        // 动态 import 避开 safeApi ↔ db 的潜在加载顺序问题；写库失败静默吞掉。
        import('./db')
            .then(({ DB }) => DB.appendApiCallLog(entry))
            .catch(() => {});
    } catch {
        // best-effort：任何异常都不影响主请求
    }
}
