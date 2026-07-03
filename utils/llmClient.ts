import type { ApiCallMeta } from './apiCallLog';
import type { PresetScopeKey } from '../types';
import type { OpenAiApiLike } from './openAiCompat';
import { buildOpenAiEndpoint, buildOpenAiHeaders, normalizeModelList, requireOpenAiChatConfig } from './openAiCompat';
import { extractContent, safeFetchJson } from './safeApi';
import { PresetRuntime, applyPresetToMessages } from './presets';

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

export interface CompleteTextOptions extends LlmRequestOptions {
    temperature?: number;
    maxTokens?: number;
    continueRounds?: number;
    presetScope?: PresetScopeKey;
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

export async function callChatCompletion(
    api: OpenAiApiLike,
    request: ChatCompletionRequest,
    opts: LlmRequestOptions = {},
): Promise<any> {
    requireOpenAiChatConfig({ ...api, model: modelOf(api, request) });
    const body: ChatCompletionRequest = {
        ...request,
        model: modelOf(api, request),
        max_tokens: request.max_tokens ?? request.maxTokens,
    };
    delete body.maxTokens;
    if (body.max_tokens === undefined) delete body.max_tokens;

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

async function callOnce(
    api: OpenAiApiLike,
    messages: ChatMsg[],
    opts: CompleteTextOptions,
): Promise<{ content: string; finishReason: string | null }> {
    const data = await callChatCompletion(api, {
        model: api.model,
        messages,
        temperature: opts.temperature ?? 0.85,
        max_tokens: opts.maxTokens ?? 1200,
        stream: false,
    }, opts);
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
        temperature: opts.temperature ?? presetGenParams?.temperature,
        maxTokens: opts.maxTokens ?? presetGenParams?.max_tokens,
    };
    let convo = messages.slice();
    if (opts.presetScope && messages[0]?.role === 'system') {
        const preset = await PresetRuntime.getActivePresetForScope(opts.presetScope);
        if (preset) {
            convo = applyPresetToMessages(messages, preset, {
                macros: { charName: '角色', userName: '用户' },
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
