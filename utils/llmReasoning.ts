/** Helpers for OpenAI-compatible content / reasoning response shapes. */

/** Flatten string, Gemini-style part arrays, or small text-like objects into text. */
export function flattenContent(c: any): string {
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) return c.map(p => flattenContentPart(p)).join('');
    if (c && typeof c === 'object') return flattenContentPart(c);
    return '';
}

function flattenContentPart(part: any): string {
    if (typeof part === 'string') return part;
    if (!part || typeof part !== 'object') return '';
    return String(part.text ?? part.content ?? '');
}

/** Strip hidden reasoning blocks from visible assistant text. */
export function stripThinkBlocks(text: string): string {
    return (text || '')
        .replace(/<(think|thinking|thought)>[\s\S]*?<\/\1>/gi, '')
        .replace(/<(?:think|thinking|thought)>[\s\S]*$/i, '');
}

/** Extract inline <think>/<thinking>/<thought> blocks, including an unclosed tail. */
export function extractThinkBlocks(raw: any): string[] {
    const text = flattenContent(raw);
    if (!text) return [];
    const blocks: string[] = [];
    const thinkPat = /<(think|thinking|thought)>([\s\S]*?)<\/\1>/gi;
    let tm: RegExpExecArray | null;
    while ((tm = thinkPat.exec(text)) !== null) {
        const t = tm[2].trim();
        if (t) blocks.push(t);
    }
    if (!/<\/(?:think|thinking|thought)>/i.test(text)) {
        const openOnly = text.match(/<(?:think|thinking|thought)>([\s\S]*$)/i);
        if (openOnly && openOnly[1].trim()) blocks.push(openOnly[1].trim());
    }
    return blocks;
}

/** Pull provider-specific native reasoning/thinking fields from one choice/message object. */
export function extractNativeReasoningFromChoice(choice: any, override?: string): string {
    const overrideText = flattenContent(override).trim();
    if (overrideText) return overrideText;

    const msg = choice?.message || {};
    const delta = choice?.delta || {};
    const candidates = [
        msg.reasoning_content,
        msg.reasoning,
        msg.reasoningContent,
        msg.thinking_content,
        msg.thinking,
        msg.thought,
        delta.reasoning_content,
        delta.reasoning,
        delta.reasoningContent,
        delta.thinking_content,
        delta.thinking,
        delta.thought,
        choice.reasoning_content,
        choice.reasoning,
        choice.reasoningContent,
        choice.thinking_content,
        choice.thinking,
        choice.thought,
    ];

    const text = candidates.map(flattenContent).filter(s => !!s.trim()).join('\n\n').trim();
    if (text) return text;

    // Some Gemini-compatible proxies put separate reasoning parts in content arrays.
    const parts = Array.isArray(msg.content) ? msg.content : [];
    return parts
        .filter((p: any) => /reason|think|thought/i.test(String(p?.type || p?.role || '')))
        .map(flattenContent)
        .filter((s: string) => !!s.trim())
        .join('\n\n')
        .trim();
}

/** Extract the thinking-chain text to show in Moro's "看看思绪" card. */
export function extractThinkingChainFromCompletion(data: any, override?: string): string | null {
    const choice = data?.choices?.[0];
    const msg = choice?.message || {};
    const nativeReasoning = extractNativeReasoningFromChoice(choice, override);
    const thinkBlocks = extractThinkBlocks(msg.content ?? choice?.text ?? '');
    const chain = [nativeReasoning, ...thinkBlocks].filter(s => !!s.trim()).join('\n\n').trim();
    return chain || null;
}
