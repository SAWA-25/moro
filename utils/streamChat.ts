/**
 * 聊天流式请求：POST /chat/completions（stream: true），增量回调 + 末尾合成完整响应对象。
 *
 * 与 safeApi.parseSseToCompletion 的区别：那边是「响应整体到手后」把 SSE 文本拼回
 * 完整 completion（不支持中间态）；这里用 ReadableStream 边收边解析，把已累积的
 * 正文通过 onDelta 推给 UI 做打字机效果，结束时返回与非流式响应同构的对象，
 * 下游（后处理管线 / token 统计）无需任何修改。
 *
 * 兜底：后端不认 stream / 返回普通 JSON（content-type 非 event-stream 且正文不是
 * data: 开头）时，按 JSON 解析直接返回 —— 调用方拿到的仍是完整 completion。
 */

import { flattenContent } from './llmReasoning';

export interface StreamChatResult {
    choices: Array<{ message: { content: string; reasoning_content?: string }; finish_reason?: string }>;
    usage?: any;
    model?: string;
    id?: string;
}

export async function streamChatCompletion(
    url: string,
    init: { headers: Record<string, string>; body: any },
    onDelta: (accumulated: string) => void,
): Promise<StreamChatResult> {
    const response = await fetch(url, {
        method: 'POST',
        headers: init.headers,
        body: JSON.stringify({ ...init.body, stream: true, stream_options: { include_usage: true } }),
    });

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`API ${response.status}${text ? `: ${text.slice(0, 300)}` : ''}`);
    }

    const contentType = response.headers.get('content-type') || '';
    const isSse = /text\/event-stream/i.test(contentType);

    // 非 SSE：可能是不支持流式的代理直接回了完整 JSON，原样解析返回
    if (!isSse && !response.body) {
        return await response.json();
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let reasoning = '';
    let usage: any = undefined;
    let finishReason: string | undefined;
    let model: string | undefined;
    let id: string | undefined;
    let sawSseData = false;
    let rawAll = '';
    // 节流：每 ~60ms 推一次 UI，避免高频 setState 拖垮渲染
    let lastEmit = 0;
    const emit = (force = false) => {
        const now = Date.now();
        if (!force && now - lastEmit < 60) return;
        lastEmit = now;
        onDelta(content);
    };

    const consumeLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) return;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === '[DONE]') return;
        let json: any;
        try { json = JSON.parse(payload); } catch { return; }
        sawSseData = true;
        if (json.usage) usage = json.usage;
        if (json.model) model = json.model;
        if (json.id) id = json.id;
        const choice = json.choices?.[0];
        if (!choice) return;
        if (choice.finish_reason) finishReason = choice.finish_reason;
        // delta 流（标准）与 message 整段（部分代理一次性 SSE）两种形态都接
        const delta = choice.delta;
        if (delta) {
            content += flattenContent(delta.content);
            reasoning += flattenContent(
                delta.reasoning_content
                ?? delta.reasoning
                ?? delta.reasoningContent
                ?? delta.thinking_content
                ?? delta.thinking
                ?? delta.thought,
            );
        } else if (choice.message) {
            const msg = choice.message;
            content += flattenContent(msg.content);
            reasoning = flattenContent(
                msg.reasoning_content
                ?? msg.reasoning
                ?? msg.reasoningContent
                ?? msg.thinking_content
                ?? msg.thinking
                ?? msg.thought,
            );
        }
        emit();
    };

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        rawAll += chunk;
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // 最后一行可能不完整，留到下个 chunk
        for (const line of lines) consumeLine(line);
    }
    if (buffer) consumeLine(buffer);
    emit(true);

    // 整条流里没有任何 data: 帧 → 多半是代理无视 stream 参数回了普通 JSON
    if (!sawSseData) {
        try {
            const json = JSON.parse(rawAll);
            if (json?.choices) return json;
        } catch { /* fallthrough */ }
        if (!content) throw new Error('流式响应为空（无 SSE 数据帧，正文也不是 JSON）');
    }

    return {
        choices: [{
            message: {
                content,
                ...(reasoning ? { reasoning_content: reasoning } : {}),
            },
            finish_reason: finishReason,
        }],
        ...(usage ? { usage } : {}),
        ...(model ? { model } : {}),
        ...(id ? { id } : {}),
    };
}
