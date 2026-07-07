import type { ApiCallMeta } from './apiCallLog';
import type { CharacterProfile } from '../types';
import type { PresetScopeKey } from '../types';
import type { OpenAiApiLike } from './openAiCompat';
import { buildOpenAiEndpoint, buildOpenAiHeaders, normalizeModelList, requireOpenAiChatConfig } from './openAiCompat';
import { extractContent, safeFetchJson } from './safeApi';
import { PresetRuntime, applyPresetToMessages, type PresetGenParams, type PresetMacroCtx } from './presets';
import { buildCharacterIdentityAnchorPrompt, resolveCharacterByModelId } from './characterIdentity';
import { getApiUsageFeature } from './apiUsageCatalog';

export interface ChatMsg { role: string; content: any; [key: string]: any }

export interface ChatCompletionRequest {
    model?: string;
    messages: ChatMsg[];
    temperature?: number;
    max_tokens?: number;
    maxTokens?: number;
    stream?: boolean;
    [key: string]: any;
}

export interface LlmRequestOptions {
    signal?: AbortSignal;
    meta?: ApiCallMeta;
    maxRetries?: number;
    timeoutMs?: number;
    /** false = 调用方已经手工套过活字盘骨架，或该请求必须完全跳过活字盘。 */
    presetScope?: PresetScopeKey | false;
    /** 给活字盘里的 {{char}} / {{user}} 等宏提供真实上下文。 */
    presetMacros?: PresetMacroCtx;
}

export interface CompleteTextOptions extends LlmRequestOptions, PresetGenParams {
    maxTokens?: number;
    continueRounds?: number;
    /** false = 只在服务端明确 finish_reason='length' 时续写，避免缺失 finish_reason 的代理误触发续写。 */
    continueOnMissingFinishReason?: boolean;
    /** 续写轮失败时，如果已有可见正文，直接返回已有正文，适合即时 UI。 */
    returnPartialOnContinueError?: boolean;
    /** 仅续写轮使用的超时；首轮仍沿用 timeoutMs。 */
    continueTimeoutMs?: number;
    /** 仅续写轮使用的重试次数。 */
    continueMaxRetries?: number;
    /** true = 调用方传入的 max_tokens / maxTokens 不被预设采样参数覆盖。 */
    preserveMaxTokens?: boolean;
}

export function stripThink(s: string): string {
    return (s || '')
        .replace(/<(think|thinking|thought)>[\s\S]*?<\/\1>/gi, '')
        .replace(/<(?:think|thinking|thought)>[\s\S]*$/i, '')
        .trim();
}

function looksTruncated(s: string): boolean {
    const t = (s || '').replace(/\s+$/, '');
    if (!t) return false;
    return !/[。．.!！?？…⋯”’"'」』）)\]】〉》>~～—]$/.test(t);
}

function modelOf(api: OpenAiApiLike, body: ChatCompletionRequest): string {
    return (body.model || api.model || '').trim();
}

const AUTO_IDENTITY_MARKER = 'Moro Character Identity Anchor';

const CHAT_FEATURE_PRESET_SCOPES: Record<string, PresetScopeKey> = {
    'chat.privateReply': 'chat.private',
    'chat.parallelReply': 'chat.private',
    'chat.liveDraftReply': 'chat.private',
    'chat.unblockAppeal': 'chat.private',
    'chat.offlineMode': 'chat.private',
    'chat.lockScreen': 'chat.private',
    'chat.userScreenWatch.comment': 'chat.private',
    'chat.proactiveReply': 'chat.proactive',
    'chat.autonomousLife': 'chat.proactive',
    'chat.groupReply': 'chat.groupText',
    'chat.groupLiveDraft': 'chat.groupText',
    'chat.groupOfflineMode': 'chat.groupText',
    'chat.phoneTextReply': 'chat.phoneText',
};

const ROLE_SCENE_APP_IDS = new Set(['lifesim', 'vrworld']);

const CREATIVE_APP_IDS = new Set([
    'bank',
    'browser',
    'check_phone',
    'co_view',
    'creative',
    'forum',
    'gallery',
    'game',
    'guidebook',
    'handbook',
    'journal',
    'music',
    'novel',
    'room',
    'shop',
    'social',
    'songwriting',
    'special_moments',
    'study',
    'takeout',
    'theater',
    'twitter',
    'xhs_free_roam',
    'xunji',
]);

const STRUCTURED_APP_IDS = new Set([
    'memory_palace',
    'settings',
]);

const CREATIVE_FEATURE_IDS = new Set([
    'almanac.flowNarrative',
    'almanac.calendarMarks',
    'character.create',
    'character.refine',
    'character.lifeProfile',
]);

const STRUCTURED_FEATURE_IDS = new Set([
    'character.importParse',
    'character.appearanceTags',
    'character.memoryArchive',
    'chat.translation',
    'chat.recenter',
    'chat.friendVerify',
    'chat.inputAnimation',
    'chat.userActionSuggest',
    'chat.memoGenerate',
    'chat.conversationSettings',
]);

const STRUCTURED_FEATURE_PATTERN =
    /(?:\.fetchModels$|\.testConnection$|postProcess|summary|digest|emotion|Eval|translation|topicSplit|extraction|Compression|links|cognition|personality|migration|scheduleGenerate|scheduleReconcile|importParse|appearanceTags|memoryArchive|resumeReview|jobStage|loanReview|stockOrder|companyAction|investAdvice|ledgerInsight|dashboardInsight|compat|recap|buff)$/i;

function messageText(content: any): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content.map(part => {
            if (typeof part === 'string') return part;
            if (typeof part?.text === 'string') return part.text;
            if (typeof part?.content === 'string') return part.content;
            return '';
        }).join('\n');
    }
    return '';
}

function requestLooksStructured(request?: ChatCompletionRequest): boolean {
    if (!request) return false;
    if (request.response_format || request.tools || request.tool_choice || request.functions || request.function_call) return true;
    const joined = (request.messages || [])
        .slice(0, 3)
        .concat((request.messages || []).slice(-2))
        .map(m => messageText(m.content))
        .join('\n')
        .slice(0, 8000);
    return /JSON|schema|数组|对象|字段|只输出|不要\s*Markdown|不要解释|extract|classify|summari[sz]e|translate|返回(?:一个)?(?:JSON|数组|对象)|输出必须是\s*JSON/i.test(joined);
}

function prepareMessagesForPreset(messages: ChatMsg[]): { messages: ChatMsg[]; syntheticCore: boolean } {
    if (messages[0]?.role === 'system') return { messages, syntheticCore: false };
    return { messages: [{ role: 'system', content: '' }, ...messages], syntheticCore: true };
}

function dropSyntheticBlankCore(messages: ChatMsg[], syntheticCore: boolean): ChatMsg[] {
    if (!syntheticCore) return messages;
    return messages.filter(message => !(message.role === 'system' && !messageText(message.content).trim()));
}

function inferPresetScopeFromFeature(featureId?: string): PresetScopeKey | null {
    const id = String(featureId || '').trim();
    if (!id) return null;
    if (CHAT_FEATURE_PRESET_SCOPES[id]) return CHAT_FEATURE_PRESET_SCOPES[id];
    if (/\.fetchModels$|\.testConnection$/i.test(id)) return null;
    if (id.startsWith('date.') || id.startsWith('vrWorld.') || id.startsWith('pixelHome.memoryDive.')) {
        return 'role.scene';
    }
    if (CREATIVE_FEATURE_IDS.has(id)) return 'creative.text';
    if (STRUCTURED_FEATURE_IDS.has(id) || STRUCTURED_FEATURE_PATTERN.test(id)) return 'structured.tool';
    if (id.startsWith('chat.')) return 'creative.text';

    const feature = getApiUsageFeature(id);
    const appId = String(feature?.appId || '').trim();
    if (ROLE_SCENE_APP_IDS.has(appId)) return 'role.scene';
    if (STRUCTURED_APP_IDS.has(appId)) return 'structured.tool';
    if (CREATIVE_APP_IDS.has(appId)) return 'creative.text';
    return null;
}

export function resolvePresetScopeForApiCall(input: {
    explicit?: PresetScopeKey | false;
    meta?: ApiCallMeta;
    request?: ChatCompletionRequest;
}): PresetScopeKey | null {
    if (input.explicit === false) return null;
    if (input.explicit) return input.explicit;
    const byFeature = inferPresetScopeFromFeature(input.meta?.featureId);
    if (byFeature) return byFeature;
    const first = input.request?.messages?.[0];
    if (first?.role !== 'system') return null;
    return requestLooksStructured(input.request) ? 'structured.tool' : 'creative.text';
}

async function applyResolvedPresetScope(
    request: ChatCompletionRequest,
    scope: PresetScopeKey | null,
    opts: LlmRequestOptions,
): Promise<ChatCompletionRequest> {
    if (!scope) return request;
    let body = request;
    const presetGenParams = await PresetRuntime.getActiveGenParams(scope);
    if (presetGenParams) {
        body = { ...body, ...presetGenParams };
    }
    const preset = await PresetRuntime.getActivePresetForScope(scope);
    if (preset) {
        const prepared = prepareMessagesForPreset(body.messages || []);
        body = {
            ...body,
            messages: dropSyntheticBlankCore(applyPresetToMessages(prepared.messages, preset, {
                macros: opts.presetMacros ?? { charName: String(opts.meta?.charName || '角色'), userName: '用户' },
                presetScope: scope,
            }) as ChatMsg[], prepared.syntheticCore),
        };
    }
    return body;
}

function messageTextForIdentityCheck(content: any): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content.map(part => {
            if (typeof part === 'string') return part;
            if (typeof part?.text === 'string') return part.text;
            if (typeof part?.content === 'string') return part.content;
            return '';
        }).join('\n');
    }
    return '';
}

function requestAlreadyHasCharacterIdentity(messages: ChatMsg[]): boolean {
    return messages.slice(0, 4).some(message => {
        const text = messageTextForIdentityCheck(message.content);
        return text.includes(AUTO_IDENTITY_MARKER)
            || text.includes('Hidden Character ID')
            || text.includes('targetModelCharId')
            || text.includes('角色ID')
            || text.includes('身份锚');
    });
}

async function resolveMetaCharacter(meta?: ApiCallMeta): Promise<Pick<CharacterProfile, 'id' | 'modelId' | 'name'> | null> {
    const charId = String(meta?.charId || '').trim();
    if (!charId) return null;

    try {
        const { DB } = await import('./db');
        const characters = await DB.getAllCharacters();
        const found = resolveCharacterByModelId(characters, charId);
        if (found) return found;
    } catch {
        // Best effort only. Falling back to the local row id is still safer than omitting the anchor.
    }

    return {
        id: charId,
        modelId: charId,
        name: String(meta?.charName || 'Character').trim() || 'Character',
    };
}

async function injectMetaCharacterIdentity(
    request: ChatCompletionRequest,
    meta?: ApiCallMeta,
): Promise<ChatCompletionRequest> {
    if (!meta?.charId || requestAlreadyHasCharacterIdentity(request.messages || [])) return request;

    const char = await resolveMetaCharacter(meta);
    if (!char) return request;

    const anchor = buildCharacterIdentityAnchorPrompt(char, {
        heading: AUTO_IDENTITY_MARKER,
        taskLabel: meta.purpose || meta.featureName || meta.featureId || 'this API task',
    });
    const messages = request.messages || [];
    const first = messages[0];
    if (first?.role === 'system' && typeof first.content === 'string') {
        return {
            ...request,
            messages: [
                { ...first, content: `${anchor}\n\n${first.content}` },
                ...messages.slice(1),
            ],
        };
    }

    return {
        ...request,
        messages: [
            { role: 'system', content: anchor },
            ...messages,
        ],
    };
}

export async function callChatCompletion(
    api: OpenAiApiLike,
    request: ChatCompletionRequest,
    opts: LlmRequestOptions = {},
): Promise<any> {
    requireOpenAiChatConfig({ ...api, model: modelOf(api, request) });
    let body: ChatCompletionRequest = {
        ...request,
        model: modelOf(api, request),
        max_tokens: request.max_tokens ?? request.maxTokens,
    };
    delete body.maxTokens;
    if (body.max_tokens === undefined) delete body.max_tokens;
    const presetScope = resolvePresetScopeForApiCall({
        explicit: opts.presetScope,
        meta: opts.meta,
        request: body,
    });
    body = await applyResolvedPresetScope(body, presetScope, opts);
    body = await injectMetaCharacterIdentity(body, opts.meta);

    return safeFetchJson(
        buildOpenAiEndpoint(api.baseUrl, 'chat.completions'),
        {
            method: 'POST',
            headers: buildOpenAiHeaders(api.apiKey),
            body: JSON.stringify(body),
            signal: opts.signal,
        },
        opts.maxRetries ?? 2,
        opts.timeoutMs ?? 0,
        opts.meta,
    );
}

const COMPLETE_TEXT_EXTRA_SAMPLING_KEYS = [
    'top_p',
    'frequency_penalty',
    'presence_penalty',
    'top_k',
    'min_p',
    'top_a',
    'repetition_penalty',
] as const;

async function callOnce(
    api: OpenAiApiLike,
    messages: ChatMsg[],
    opts: CompleteTextOptions,
): Promise<{ content: string; finishReason: string | null }> {
    const request: ChatCompletionRequest = {
        model: api.model,
        messages,
        temperature: opts.temperature ?? 0.85,
        max_tokens: opts.max_tokens ?? opts.maxTokens ?? 1200,
        stream: false,
    };
    for (const key of COMPLETE_TEXT_EXTRA_SAMPLING_KEYS) {
        const value = opts[key];
        if (value !== undefined) request[key] = value;
    }
    const data = await callChatCompletion(api, request, { ...opts, presetScope: false });
    return {
        content: extractContent(data) || '',
        finishReason: data?.choices?.[0]?.finish_reason ?? null,
    };
}

export async function completeText(
    api: OpenAiApiLike,
    messages: ChatMsg[],
    opts: CompleteTextOptions = {},
): Promise<string> {
    const rounds = Math.max(0, opts.continueRounds ?? 0);
    const presetScope = resolvePresetScopeForApiCall({
        explicit: opts.presetScope,
        meta: opts.meta,
        request: { model: api.model, messages },
    });
    const presetGenParams = presetScope ? await PresetRuntime.getActiveGenParams(presetScope) : null;
    const requestedMaxTokens = opts.max_tokens ?? opts.maxTokens;
    const effectiveOpts: CompleteTextOptions = {
        ...opts,
        // 预设开启且允许下发采样参数时，预设应像 ST 一样接管本轮请求火候；
        // 调用点的 temperature / maxTokens 只作为没有预设参数时的默认值。
        ...(presetGenParams ?? {}),
        ...(opts.preserveMaxTokens && requestedMaxTokens !== undefined ? { max_tokens: requestedMaxTokens, maxTokens: undefined } : {}),
        presetScope: false,
    };
    let convo = messages.slice();
    if (presetScope) {
        const preset = await PresetRuntime.getActivePresetForScope(presetScope);
        if (preset) {
            const prepared = prepareMessagesForPreset(messages);
            convo = dropSyntheticBlankCore(applyPresetToMessages(prepared.messages, preset, {
                macros: opts.presetMacros ?? { charName: '角色', userName: '用户' },
                presetScope,
            }) as ChatMsg[], prepared.syntheticCore);
        }
    }

    let full = '';
    for (let round = 0; round <= rounds; round++) {
        const roundOpts: CompleteTextOptions = round > 0
            ? {
                ...effectiveOpts,
                ...(opts.continueTimeoutMs !== undefined ? { timeoutMs: opts.continueTimeoutMs } : {}),
                ...(opts.continueMaxRetries !== undefined ? { maxRetries: opts.continueMaxRetries } : {}),
            }
            : effectiveOpts;
        let content = '';
        let finishReason: string | null = null;
        try {
            const result = await callOnce(api, convo, roundOpts);
            content = result.content;
            finishReason = result.finishReason;
        } catch (e) {
            if (round > 0 && opts.returnPartialOnContinueError && full.trim()) break;
            throw e;
        }
        const chunk = stripThink(content);
        full += chunk;
        const allowMissingFinishHeuristic = opts.continueOnMissingFinishReason !== false;
        const needMore = finishReason === 'length'
            || (allowMissingFinishHeuristic && finishReason == null && looksTruncated(full));
        if (!needMore || !chunk.trim() || round === rounds) break;
        convo = [
            ...convo,
            { role: 'assistant', content: chunk },
            { role: 'user', content: '直接从刚才断开的地方接着写下去，自然衔接，不要重复已经写过的内容，不要任何前缀、说明或重新开头。' },
        ];
    }
    return full;
}

export async function fetchModelList(
    api: Pick<OpenAiApiLike, 'baseUrl' | 'apiKey'>,
    opts: LlmRequestOptions = {},
): Promise<string[]> {
    const data = await safeFetchJson(
        buildOpenAiEndpoint(api.baseUrl, 'models'),
        {
            method: 'GET',
            headers: buildOpenAiHeaders(api.apiKey),
            signal: opts.signal,
        },
        opts.maxRetries ?? 2,
        opts.timeoutMs ?? 0,
        opts.meta,
    );
    return normalizeModelList(data);
}

export async function testChatConnection(
    api: OpenAiApiLike,
    opts: LlmRequestOptions & { stream?: boolean } = {},
): Promise<string> {
    const data = await callChatCompletion(api, {
        model: api.model,
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 5,
        stream: opts.stream ?? false,
    }, opts);
    return extractContent(data) || '';
}
