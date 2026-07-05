import type { PresetGenParams, PresetMacroCtx } from './presets';
import { PresetRuntime, applyPresetToMessages } from './presets';

export type ProactivePresetMessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ProactivePresetMessage {
    role: ProactivePresetMessageRole;
    content: string;
}

export interface ChatProactivePresetResult {
    presetApplied: boolean;
    messages: ProactivePresetMessage[] | null;
    genParams: PresetGenParams | null;
}

export interface ActiveMsg2ScheduledLlmPayload {
    completePrompt?: string;
    messages?: ProactivePresetMessage[];
    temperature?: number;
    maxTokens?: number;
}

const PROACTIVE_SCOPE = 'chat.proactive' as const;

const normalizeRole = (role: string): ProactivePresetMessageRole => (
    role === 'system' || role === 'assistant' || role === 'tool' ? role : 'user'
);

const textContent = (content: unknown): string => {
    if (typeof content === 'string') return content;
    if (content == null) return '';
    try {
        return JSON.stringify(content);
    } catch {
        return String(content);
    }
};

const normalizeMessages = (
    messages: Array<{ role: string; content: unknown }>,
): ProactivePresetMessage[] => messages
    .map(message => ({
        role: normalizeRole(message.role),
        content: textContent(message.content).trim(),
    }))
    .filter(message => message.content.length > 0);

const finiteNumber = (value: unknown): number | undefined => (
    typeof value === 'number' && Number.isFinite(value) ? value : undefined
);

const positiveInt = (value: unknown): number | undefined => {
    const n = finiteNumber(value);
    return n !== undefined && n > 0 ? Math.floor(n) : undefined;
};

export function normalizePresetGenParamsForOpenAi(genParams: PresetGenParams | null | undefined): PresetGenParams | undefined {
    if (!genParams) return undefined;
    const out: PresetGenParams = {};
    for (const key of ['temperature', 'top_p', 'frequency_penalty', 'presence_penalty', 'top_k', 'min_p', 'top_a', 'repetition_penalty'] as const) {
        const n = finiteNumber(genParams[key]);
        if (n !== undefined) out[key] = n;
    }
    const maxTokens = positiveInt(genParams.max_tokens);
    if (maxTokens !== undefined) out.max_tokens = maxTokens;
    return Object.keys(out).length > 0 ? out : undefined;
}

export async function buildChatProactivePresetResult(
    baseMessages: Array<{ role: string; content: unknown }>,
    macros: PresetMacroCtx,
): Promise<ChatProactivePresetResult> {
    const [genParams, preset] = await Promise.all([
        PresetRuntime.getActiveGenParams(PROACTIVE_SCOPE),
        PresetRuntime.getActivePresetForScope(PROACTIVE_SCOPE),
    ]);

    if (!preset) {
        return { presetApplied: false, messages: null, genParams };
    }

    const messages = normalizeMessages(applyPresetToMessages(baseMessages, preset, {
        macros,
        presetScope: PROACTIVE_SCOPE,
    }) as Array<{ role: string; content: unknown }>);

    return {
        presetApplied: messages.length > 0,
        messages: messages.length > 0 ? messages : null,
        genParams,
    };
}

export async function buildActiveMsg2ScheduledLlmPayload(input: {
    completePrompt: string;
    charName: string;
    userName: string;
    configMaxTokens?: number;
}): Promise<ActiveMsg2ScheduledLlmPayload> {
    const result = await buildChatProactivePresetResult([
        { role: 'system', content: '' },
        { role: 'user', content: input.completePrompt },
    ], {
        charName: input.charName || '角色',
        userName: input.userName || '用户',
    });

    const genParams = normalizePresetGenParamsForOpenAi(result.genParams);
    const payload: ActiveMsg2ScheduledLlmPayload = result.presetApplied && result.messages
        ? { messages: result.messages }
        : { completePrompt: input.completePrompt };

    if (genParams?.temperature !== undefined) {
        payload.temperature = genParams.temperature;
    } else if (payload.messages) {
        // The ActiveMsg worker only applies its 0.8 default to completePrompt payloads.
        payload.temperature = 0.8;
    }

    const maxTokens = positiveInt(genParams?.max_tokens) ?? positiveInt(input.configMaxTokens);
    if (maxTokens !== undefined) payload.maxTokens = maxTokens;

    return payload;
}
