import type { ApiCallMeta } from './apiCallLog';
import type { CharacterProfile } from '../types';
import type { PresetScopeKey } from '../types';
import type { OpenAiApiLike } from './openAiCompat';
import { buildOpenAiEndpoint, buildOpenAiHeaders, normalizeModelList, requireOpenAiChatConfig } from './openAiCompat';
import { extractContent, safeFetchJson } from './safeApi';
import { PresetRuntime, applyPresetToMessages, type PresetGenParams, type PresetMacroCtx } from './presets';
import { buildCharacterIdentityAnchorPrompt, resolveCharacterByModelId } from './characterIdentity';

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
}

export interface CompleteTextOptions extends LlmRequestOptions, PresetGenParams {
    maxTokens?: number;
    continueRounds?: number;
    presetScope?: PresetScopeKey;
    presetMacros?: PresetMacroCtx;
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
    const data = await callChatCompletion(api, request, opts);
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
    const presetGenParams = opts.presetScope ? await PresetRuntime.getActiveGenParams(opts.presetScope) : null;
    const effectiveOpts: CompleteTextOptions = {
        ...opts,
        // 预设开启且允许下发采样参数时，预设应像 ST 一样接管本轮请求火候；
        // 调用点的 temperature / maxTokens 只作为没有预设参数时的默认值。
        ...(presetGenParams ?? {}),
    };
    let convo = messages.slice();
    if (opts.presetScope && messages[0]?.role === 'system') {
        const preset = await PresetRuntime.getActivePresetForScope(opts.presetScope);
        if (preset) {
            convo = applyPresetToMessages(messages, preset, {
                macros: opts.presetMacros ?? { charName: '角色', userName: '用户' },
                presetScope: opts.presetScope,
            }) as ChatMsg[];
        }
    }

    let full = '';
    for (let round = 0; round <= rounds; round++) {
        const { content, finishReason } = await callOnce(api, convo, effectiveOpts);
        const chunk = stripThink(content);
        full += chunk;
        const needMore = finishReason === 'length'
            || (finishReason == null && looksTruncated(full));
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
