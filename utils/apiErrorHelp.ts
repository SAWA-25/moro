import type { ApiCallLogEntry } from './apiCallLog';

export type ApiErrorHelpKind =
    | 'missing-api'
    | 'auth'
    | 'model-not-found'
    | 'invalid-request'
    | 'rate-limit'
    | 'quota'
    | 'timeout-network'
    | 'context-length'
    | 'json-format'
    | 'empty-or-cut'
    | 'content-filter'
    | 'stream'
    | 'server'
    | 'first-aid';

export interface ApiErrorHelp {
    kind: ApiErrorHelpKind;
    title: string;
    shortReason: string;
    manualSettingId: string;
    manualAnchorId: string;
    actionLabel: string;
    keywords: string[];
}

export interface ApiErrorHelpSummary {
    kind: ApiErrorHelpKind;
    help: ApiErrorHelp;
    count: number;
    latestAt: number;
}

const SETTINGS_MANUAL_APP = '文具盒';

export const manualSettingsErrorAnchor = (settingId: string): string =>
    `manual-guide-setting-${SETTINGS_MANUAL_APP}-${settingId}`;

const help = (
    kind: ApiErrorHelpKind,
    title: string,
    shortReason: string,
    manualSettingId: string,
    actionLabel = '看解决方法',
    keywords: string[] = [],
): ApiErrorHelp => ({
    kind,
    title,
    shortReason,
    manualSettingId,
    manualAnchorId: manualSettingsErrorAnchor(manualSettingId),
    actionLabel,
    keywords,
});

const HELP: Record<ApiErrorHelpKind, ApiErrorHelp> = {
    'missing-api': help(
        'missing-api',
        '缺少 API 配置',
        '通常是 Base URL、API Key 或模型名没填完整，也可能是当前功能需要单独的外部服务 Key。',
        'settings-error-missing-api',
        '去看怎么补配置',
        ['missing api key', '未配置 API', '缺少 key'],
    ),
    auth: help(
        'auth',
        '密钥或权限不对',
        '401 多半是 Key 不对或过期；403 多半是账号、地区、余额或模型权限被服务商拒绝。',
        'settings-error-401-403',
        '去看密钥排查',
        ['401', '403', 'unauthorized', 'forbidden', 'invalid api key'],
    ),
    'model-not-found': help(
        'model-not-found',
        '模型名或接口不匹配',
        '服务商找不到这个模型，或 Base URL 和模型来自不同服务商。',
        'settings-error-404-model',
        '去看模型名排查',
        ['404', 'model not found', '模型不存在'],
    ),
    'invalid-request': help(
        'invalid-request',
        '参数或地址写法不兼容',
        '请求格式不合服务商要求，常见原因是 Base URL 多写了路径，或模型不支持某个参数。',
        'settings-error-400-params',
        '去看参数排查',
        ['400', 'invalid request', 'bad request'],
    ),
    'rate-limit': help(
        'rate-limit',
        '请求太频繁',
        '服务商暂时限流，可能是同时请求太多、频率太高或套餐并发限制到了。',
        'settings-error-429',
        '去看限流排查',
        ['429', 'rate limit', 'too many requests'],
    ),
    quota: help(
        'quota',
        '余额或额度不足',
        '账号余额、赠送额度、套餐额度或请求配额不够，通常需要去服务商后台确认。',
        'settings-error-insufficient-balance',
        '去看额度排查',
        ['insufficient balance', 'quota', 'billing', 'payment required'],
    ),
    'timeout-network': help(
        'timeout-network',
        '网络、代理或接口连不上',
        'Moro 没能顺利连到服务商，可能是网络、代理、CORS、Base URL 或服务商响应太慢。',
        'settings-error-timeout-network',
        '去看网络排查',
        ['timeout', 'failed to fetch', 'network error', 'cors'],
    ),
    'context-length': help(
        'context-length',
        '内容超过模型上限',
        '聊天历史、世界书、记忆或后台资料太长，超过模型一次能看的上下文窗口。',
        'settings-error-context',
        '去看上下文排查',
        ['context length', 'too many tokens', 'maximum context'],
    ),
    'json-format': help(
        'json-format',
        '返回格式读不懂',
        '模型没有按功能要求返回格式，或中转返回了网页 / HTML 错误页。',
        'settings-error-json',
        '去看格式排查',
        ['invalid json', 'unexpected token', 'html', '格式解析'],
    ),
    'empty-or-cut': help(
        'empty-or-cut',
        '回复为空或被截断',
        '模型没有返回可见正文，或因为回复 token 太小、流式中断等原因只返回半句。',
        'settings-error-empty-or-cut',
        '去看截断排查',
        ['empty response', 'finish_reason=length', 'length'],
    ),
    'content-filter': help(
        'content-filter',
        '内容被服务商拦截',
        '服务商认为请求或回复触碰了它的策略，因此拒绝生成。',
        'settings-error-content-filter',
        '去看拦截排查',
        ['content filter', 'policy', 'safety'],
    ),
    stream: help(
        'stream',
        '流式输出中断',
        '流式传输半路断开，常见于网络抖动、中转不兼容或服务商限制。',
        'settings-error-stream',
        '去看流式排查',
        ['stream', 'sse', 'terminated'],
    ),
    server: help(
        'server',
        '服务商或中转临时出错',
        '500、502、503、504 一般是服务商、中转或网络链路临时不稳定。',
        'settings-error-5xx',
        '去看服务商排查',
        ['500', '502', '503', '504', 'bad gateway'],
    ),
    'first-aid': help(
        'first-aid',
        '先按错误原文排查',
        '这条错误没有命中明确分类，先看原文、入口、主副 API 线路和最近改过的配置。',
        'settings-error-first-aid',
        '去看排查顺序',
        ['报错后先看哪里'],
    ),
};

const textOf = (entry: ApiCallLogEntry): string => [
    entry.status ? `HTTP ${entry.status}` : '',
    entry.statusText || '',
    entry.errorMessage || '',
    entry.responsePreview || '',
    entry.requestPreview || '',
    entry.endpoint || '',
].filter(Boolean).join('\n');

const matches = (text: string, patterns: RegExp[]): boolean =>
    patterns.some(pattern => pattern.test(text));

export function resolveApiErrorHelp(entry?: ApiCallLogEntry | null): ApiErrorHelp | null {
    if (!entry || entry.ok) return null;
    const text = textOf(entry);
    const status = entry.status;

    if (matches(text, [/missing\s+(api\s*)?key/i, /missing\s+api/i, /未配置\s*API/i, /缺少.*(?:API|Key|密钥)/i, /请先.*配置.*API/i])) {
        return HELP['missing-api'];
    }
    if (status === 402 || matches(text, [/insufficient[_\s-]*(?:balance|quota|credits?)/i, /quota[_\s-]*exceeded/i, /exceeded.*quota/i, /billing/i, /payment required/i, /余额不足|额度不足|欠费|配额不足/])) {
        return HELP.quota;
    }
    if (status === 401 || status === 403 || matches(text, [/unauthori[sz]ed/i, /forbidden/i, /invalid[_\s-]*(?:api\s*)?key/i, /permission denied/i, /access denied/i, /鉴权|认证|权限|密钥.*(?:无效|错误|过期)/])) {
        return HELP.auth;
    }
    if (matches(text, [/context[_\s-]*length/i, /maximum context/i, /too many tokens/i, /token.*(?:exceed|limit)/i, /prompt.*too long/i, /上下文.*(?:过长|超出)|内容太长/])) {
        return HELP['context-length'];
    }
    if (matches(text, [/content[_\s-]*filter/i, /policy/i, /safety/i, /moderation/i, /sensitive content/i, /内容.*(?:拦截|过滤|审核|违规)/])) {
        return HELP['content-filter'];
    }
    if (matches(text, [/invalid\s*json/i, /unexpected token/i, /<html|<!doctype html/i, /html.*json/i, /API返回了HTML|无效JSON|格式解析|返回格式错误/])) {
        return HELP['json-format'];
    }
    if (status === 404 || matches(text, [/model[_\s-]*(?:not[_\s-]*)?found/i, /model.*(?:not exist|does not exist|doesn.t exist)/i, /unknown model/i, /模型.*(?:不存在|找不到|无效)/])) {
        return HELP['model-not-found'];
    }
    if (status === 429 || matches(text, [/rate[_\s-]*limit/i, /too many requests/i, /\bRPM\b|\bTPM\b/i, /请求.*(?:太频繁|过快)|限流|频率限制/])) {
        return HELP['rate-limit'];
    }
    if (matches(text, [/timeout|timed out/i, /failed to fetch/i, /network\s*error/i, /load failed/i, /abort(?:ed)?/i, /cors/i, /econnreset|enotfound|err_name_not_resolved/i, /超时|网络错误|连接失败|请求失败/])) {
        return HELP['timeout-network'];
    }
    if (matches(text, [/stream/i, /\bSSE\b/i, /terminated/i, /premature close/i, /incomplete.*chunk/i, /流式.*(?:中断|失败)|回复到一半/])) {
        return HELP.stream;
    }
    if (matches(text, [/finish_reason.{0,20}length/i, /max[_\s-]*tokens/i, /empty response/i, /blank response/i, /空响应|回复为空|只回半句|截断/])) {
        return HELP['empty-or-cut'];
    }
    if (status === 400 || matches(text, [/invalid[_\s-]*request/i, /bad request/i, /unsupported (?:parameter|field)/i, /invalid (?:parameter|field)/i, /参数.*(?:错误|不支持|无效)/])) {
        return HELP['invalid-request'];
    }
    if ((status && status >= 500) || matches(text, [/bad gateway/i, /service unavailable/i, /gateway timeout/i, /internal server error/i, /服务商.*(?:忙|错误)|中转.*(?:忙|错误)/])) {
        return HELP.server;
    }
    return HELP['first-aid'];
}

export function summarizeApiErrorHelps(entries: ApiCallLogEntry[], limit = 3): ApiErrorHelpSummary[] {
    const grouped = new Map<ApiErrorHelpKind, ApiErrorHelpSummary>();
    for (const entry of entries) {
        const help = resolveApiErrorHelp(entry);
        if (!help) continue;
        const current = grouped.get(help.kind);
        if (current) {
            current.count += 1;
            current.latestAt = Math.max(current.latestAt, entry.timestamp || 0);
        } else {
            grouped.set(help.kind, {
                kind: help.kind,
                help,
                count: 1,
                latestAt: entry.timestamp || 0,
            });
        }
    }
    return [...grouped.values()]
        .sort((a, b) => (b.count - a.count) || (b.latestAt - a.latestAt))
        .slice(0, limit);
}
