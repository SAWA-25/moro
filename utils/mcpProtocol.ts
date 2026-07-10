import { appendDevDebugMcpLog } from './devDebug';

export const MCP_PROTOCOL_VERSION = '2025-11-25';
export const MCP_LEGACY_PROTOCOL_VERSION = '2024-11-05';

export interface McpJsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params?: any;
  id?: string | number;
}

export interface McpJsonRpcError {
  code: number;
  message: string;
  data?: any;
}

export interface McpJsonRpcResponse {
  jsonrpc?: '2.0';
  id?: string | number | null;
  result?: any;
  error?: McpJsonRpcError;
  method?: string;
  params?: any;
}

export interface McpResponseEnvelope {
  status: number;
  contentType: string;
  text: string;
  headers: Record<string, string>;
  sessionId?: string | null;
}

export interface McpEventEnvelope {
  event?: string;
  data: string;
}

export interface McpToolDef {
  name: string;
  description?: string;
  inputSchema?: any;
}

export interface McpResourceDef {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

export interface McpPromptDef {
  name: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
}

export interface McpParsedContent {
  kind: 'text' | 'json' | 'blob' | 'image' | 'other';
  text?: string;
  json?: any;
  mimeType?: string;
  data?: string;
}

export interface McpClientHooks {
  onTranscript?: (entry: { direction: 'out' | 'in' | 'event'; label: string; data: unknown }) => void;
}

export interface McpCallOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  preserveId?: boolean;
}

export const makeJsonRpcRequest = (
  method: string,
  params?: any,
  id?: string | number,
): McpJsonRpcRequest => ({
  jsonrpc: '2.0',
  method,
  ...(params === undefined ? {} : { params }),
  ...(id === undefined ? {} : { id }),
});

export const isJsonRpcResponse = (value: unknown): value is McpJsonRpcResponse =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export const tryParseJson = <T,>(text: string): T | null => {
  const trimmed = (text || '').trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const match = trimmed.match(/[\[{][\s\S]*[\]}]/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as T;
    } catch {
      return null;
    }
  }
};

const parseSseEventBlock = (block: string): McpEventEnvelope | null => {
  const lines = block.split(/\r?\n/);
  let event = '';
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^\s/, ''));
  }
  if (dataLines.length === 0) return null;
  return { event: event || undefined, data: dataLines.join('\n') };
};

export const parseSsePayloads = (text: string): McpEventEnvelope[] => {
  const blocks = (text || '').split(/\r?\n\r?\n/).map(block => block.trim()).filter(Boolean);
  const out: McpEventEnvelope[] = [];
  for (const block of blocks) {
    const parsed = parseSseEventBlock(block);
    if (parsed) out.push(parsed);
  }
  return out;
};

export const parseMcpResponseText = (text: string, contentType = ''): McpJsonRpcResponse[] => {
  const trimmed = (text || '').trim();
  if (!trimmed) return [];

  if (/text\/event-stream/i.test(contentType) || /^\s*(event:|data:)/m.test(trimmed)) {
    const payloads = parseSsePayloads(trimmed);
    const responses: McpJsonRpcResponse[] = [];
    for (const payload of payloads) {
      const parsed = tryParseJson<McpJsonRpcResponse>(payload.data);
      if (parsed) responses.push(parsed);
    }
    if (responses.length > 0) return responses;
  }

  const parsed = tryParseJson<McpJsonRpcResponse | McpJsonRpcResponse[]>(trimmed);
  if (Array.isArray(parsed)) return parsed.filter(Boolean);
  return parsed ? [parsed] : [];
};

export const pickLastResponse = (responses: McpJsonRpcResponse[]): McpJsonRpcResponse | null =>
  responses.length ? responses[responses.length - 1] : null;

export const normalizeMcpEnvelope = (input: McpJsonRpcResponse | null | undefined): McpJsonRpcResponse | null => {
  if (!input) return null;
  if (input.error && typeof input.error.message !== 'string') {
    return {
      ...input,
      error: {
        code: Number(input.error.code) || -32603,
        message: String(input.error.message || 'MCP error'),
        ...(input.error.data !== undefined ? { data: input.error.data } : {}),
      },
    };
  }
  return input;
};

export const getResponseId = (response: McpJsonRpcResponse | null | undefined): string | number | null => {
  if (!response) return null;
  return response.id ?? null;
};

export const parseTextParts = (value: unknown): string[] => {
  if (!value) return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) {
    return value.flatMap((part) => {
      if (typeof part === 'string') return [part];
      if (!part || typeof part !== 'object') return [];
      const p = part as Record<string, any>;
      if (typeof p.text === 'string') return [p.text];
      if (typeof p.content === 'string') return [p.content];
      if (typeof p.value === 'string') return [p.value];
      return [];
    });
  }
  return [];
};

export const renderTransportContent = (content: any): McpParsedContent[] => {
  if (content == null) return [];
  if (Array.isArray(content)) {
    return content.flatMap(renderTransportContent);
  }
  if (typeof content === 'string') {
    const parsed = tryParseJson<any>(content);
    if (parsed !== null && typeof parsed === 'object') {
      return [{ kind: 'json', json: parsed, text: JSON.stringify(parsed, null, 2) }];
    }
    return [{ kind: 'text', text: content }];
  }
  if (typeof content !== 'object') {
    return [{ kind: 'text', text: String(content) }];
  }

  const item = content as Record<string, any>;
  if (typeof item.type === 'string') {
    if (item.type === 'text') {
      return [{ kind: 'text', text: typeof item.text === 'string' ? item.text : String(item.text ?? '') }];
    }
    if (item.type === 'image') {
      return [{
        kind: 'image',
        mimeType: typeof item.mimeType === 'string' ? item.mimeType : undefined,
        data: typeof item.data === 'string' ? item.data : undefined,
        text: typeof item.text === 'string' ? item.text : undefined,
      }];
    }
    if (item.type === 'resource') {
      const blobText = typeof item.resource?.text === 'string' ? item.resource.text : '';
      return [{
        kind: 'blob',
        mimeType: typeof item.resource?.mimeType === 'string' ? item.resource.mimeType : undefined,
        text: blobText || undefined,
        json: tryParseJson(blobText),
      }];
    }
  }

  if (typeof item.text === 'string') {
    const maybeJson = tryParseJson<any>(item.text);
    return maybeJson !== null
      ? [{ kind: 'json', json: maybeJson, text: JSON.stringify(maybeJson, null, 2) }]
      : [{ kind: 'text', text: item.text }];
  }

  return [{ kind: 'json', json: content, text: JSON.stringify(content, null, 2) }];
};

export const makeProtocolHeaders = (sessionId?: string | null): Record<string, string> => {
  const headers: Record<string, string> = {
    Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
  };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;
  return headers;
};

export const makeJsonHeaders = (sessionId?: string | null): Record<string, string> => ({
  'Content-Type': 'application/json',
  ...makeProtocolHeaders(sessionId),
});

const toFetchError = (resp: Response, text: string): Error => {
  return new Error(`MCP HTTP ${resp.status}: ${text.slice(0, 300)}`);
};

const setTimer = (fn: () => void, timeoutMs: number): ReturnType<typeof setTimeout> =>
  globalThis.setTimeout(fn, timeoutMs);

const clearTimer = (timer: ReturnType<typeof setTimeout>): void => {
  globalThis.clearTimeout(timer);
};

export const requestJsonRpcOverHttp = async (
  url: string,
  body: McpJsonRpcRequest,
  options: {
    sessionId?: string | null;
    headers?: Record<string, string>;
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {},
): Promise<McpResponseEnvelope> => {
  const controller = options.timeoutMs ? new AbortController() : null;
  const onAbort = () => controller?.abort();
  if (options.signal) {
    if (options.signal.aborted) onAbort();
    else options.signal.addEventListener('abort', onAbort, { once: true });
  }
  const timeout = options.timeoutMs ? setTimer(onAbort, options.timeoutMs) : null;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        ...makeJsonHeaders(options.sessionId),
        ...(options.headers || {}),
      },
      body: JSON.stringify(body),
      signal: controller?.signal,
    });

    const sessionId = resp.headers.get('Mcp-Session-Id') || resp.headers.get('mcp-session-id') || undefined;
    const contentType = resp.headers.get('content-type') || '';
    const text = await resp.text().catch(() => '');
    if (!resp.ok && resp.status !== 202) {
      throw toFetchError(resp, text);
    }
    return {
      status: resp.status,
      contentType,
      text,
      headers: Object.fromEntries(resp.headers.entries()),
      sessionId,
    };
  } finally {
    if (timeout !== null) clearTimer(timeout);
    if (options.signal) options.signal.removeEventListener('abort', onAbort);
  }
};

export const requestJsonRpcOverGateway = async (
  gatewayUrl: string,
  token: string,
  sessionId: string,
  body: McpJsonRpcRequest,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<McpResponseEnvelope> => {
  const controller = options.timeoutMs ? new AbortController() : null;
  const onAbort = () => controller?.abort();
  if (options.signal) {
    if (options.signal.aborted) onAbort();
    else options.signal.addEventListener('abort', onAbort, { once: true });
  }
  const timeout = options.timeoutMs ? setTimer(onAbort, options.timeoutMs) : null;
  try {
    const resp = await fetch(`${gatewayUrl.replace(/\/+$/, '')}/sessions/${encodeURIComponent(sessionId)}/request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-moro-mcp-token': token,
      },
      body: JSON.stringify(body),
      signal: controller?.signal,
    });
    const text = await resp.text().catch(() => '');
    if (!resp.ok) {
      throw new Error(text || `MCP gateway HTTP ${resp.status}`);
    }
    const parsed = tryParseJson<McpResponseEnvelope>(text);
    return parsed || {
      status: resp.status,
      contentType: resp.headers.get('content-type') || '',
      text,
      headers: Object.fromEntries(resp.headers.entries()),
      sessionId,
    };
  } finally {
    if (timeout !== null) clearTimer(timeout);
    if (options.signal) options.signal.removeEventListener('abort', onAbort);
  }
};

export const appendMcpTranscript = (
  hooks: McpClientHooks | undefined,
  entry: { direction: 'out' | 'in' | 'event'; label: string; data: unknown },
): void => {
  try {
    appendDevDebugMcpLog({
      label: `${entry.direction.toUpperCase()} ${entry.label}`,
      data: entry.data,
    });
  } catch {
    // ignore dev debug failures
  }
  hooks?.onTranscript?.(entry);
};
