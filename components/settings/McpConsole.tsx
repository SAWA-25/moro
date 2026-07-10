import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MCP_PROTOCOL_VERSION,
  appendMcpTranscript,
  makeJsonRpcRequest,
  normalizeMcpEnvelope,
  parseMcpResponseText,
  pickLastResponse,
  renderTransportContent,
  requestJsonRpcOverGateway,
  requestJsonRpcOverHttp,
  type McpJsonRpcRequest,
  type McpJsonRpcResponse,
  type McpParsedContent,
} from '../../utils/mcpProtocol';
import {
  createDefaultMcpServer,
  duplicateMcpServer,
  exportMcpServers,
  importMcpServersText,
  loadMcpServers,
  parseJsonObjectText,
  redactMcpServer,
  saveMcpServers,
  toGatewaySessionConfig,
  type McpServerConfig,
} from '../../utils/mcpStore';

type ToastKind = 'info' | 'success' | 'error';
type TabKey = 'connect' | 'tools' | 'resources' | 'prompts' | 'utilities' | 'tutorial';
type TranscriptDirection = 'out' | 'in' | 'event';

interface McpConsoleProps {
  addToast?: (message: string, kind: ToastKind) => void;
}

interface TranscriptEntry {
  id: string;
  direction: TranscriptDirection;
  label: string;
  data: unknown;
  time: string;
}

interface GatewayEvent {
  id: number;
  time: string;
  type: string;
  data: unknown;
}

interface ConnectionState {
  serverId: string;
  mode: 'direct-http' | 'gateway';
  connected: boolean;
  initialized: boolean;
  gatewaySessionId?: string;
  httpSessionId?: string | null;
  serverInfo?: unknown;
  capabilities?: unknown;
  instructions?: string;
  protocolVersion?: string;
  eventCursor: number;
}

const FIELD = 'w-full rounded-[10px] border border-[#e7e1d6] bg-white px-3 py-2 text-xs text-[#2f3437] caret-[#7fa8b3] outline-none transition focus:border-[#9dbbc2] placeholder:text-[#aab0ac]';
const TEXTAREA = `${FIELD} min-h-[76px] resize-y font-mono leading-relaxed`;
const LABEL = 'label-mono mb-1 block text-[9px] text-[#8a918d]';
const BTN = 'rounded-full border border-[#e7e1d6] bg-white/95 px-3 py-1.5 text-[11px] font-black text-[#577782] shadow-[0_1px_2px_rgba(31,35,38,0.05)] transition active:scale-[0.98] disabled:opacity-50';
const PRIMARY = 'rounded-full border border-[#d8e5e7] bg-[#7fa8b3] px-3 py-1.5 text-[11px] font-black text-white shadow-[0_10px_18px_-16px_rgba(31,35,38,0.42)] transition active:scale-[0.98] disabled:opacity-50';
const DANGER = 'rounded-full border border-[#ead6d6] bg-white px-3 py-1.5 text-[11px] font-black text-[#9a4d4d] transition active:scale-[0.98] disabled:opacity-50';
const PANEL = 'rounded-xl border border-[#e7e1d6] bg-[#fffdf8] p-3';

const tabLabels: Record<TabKey, string> = {
  connect: '连接',
  tools: 'Tools',
  resources: 'Resources',
  prompts: 'Prompts',
  utilities: 'Utilities',
  tutorial: '教程',
};

const RAW_REQUEST_TEMPLATES: Array<{ label: string; request: McpJsonRpcRequest }> = [
  { label: 'ping', request: { jsonrpc: '2.0', method: 'ping', id: 1 } },
  { label: 'tools/list', request: { jsonrpc: '2.0', method: 'tools/list', params: {}, id: 1 } },
  { label: 'resources/list', request: { jsonrpc: '2.0', method: 'resources/list', params: {}, id: 1 } },
  { label: 'templates/list', request: { jsonrpc: '2.0', method: 'resources/templates/list', params: {}, id: 1 } },
  { label: 'prompts/list', request: { jsonrpc: '2.0', method: 'prompts/list', params: {}, id: 1 } },
  { label: 'logging/setLevel', request: { jsonrpc: '2.0', method: 'logging/setLevel', params: { level: 'info' }, id: 1 } },
  { label: 'tools/call', request: { jsonrpc: '2.0', method: 'tools/call', params: { name: '', arguments: {} }, id: 1 } },
  { label: 'resources/read', request: { jsonrpc: '2.0', method: 'resources/read', params: { uri: '' }, id: 1 } },
  { label: 'prompts/get', request: { jsonrpc: '2.0', method: 'prompts/get', params: { name: '', arguments: {} }, id: 1 } },
];

const stringify = (value: unknown): string => {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const parseJsonText = <T,>(text: string, fallback: T): T => {
  const trimmed = text.trim();
  if (!trimmed) return fallback;
  return JSON.parse(trimmed) as T;
};

const makeTranscriptId = () => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const isResponseError = (response: McpJsonRpcResponse | null): response is McpJsonRpcResponse & { error: NonNullable<McpJsonRpcResponse['error']> } =>
  !!response?.error;

const downloadText = (filename: string, text: string, mimeType = 'text/plain;charset=utf-8') => {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

const getToolSchema = (tool: any): unknown => tool?.inputSchema || tool?.input_schema || { type: 'object', properties: {} };

const renderContentBlock = (item: McpParsedContent, index: number) => {
  if (item.kind === 'image' && item.data) {
    const src = `data:${item.mimeType || 'image/png'};base64,${item.data}`;
    return (
      <div key={index} className="space-y-2">
        <img src={src} alt="MCP image result" className="max-h-64 w-full rounded-[8px] border border-[#e7e1d6] object-contain" />
        {item.text && <pre className="whitespace-pre-wrap break-words text-[11px] leading-relaxed text-[#2f3437]/80">{item.text}</pre>}
      </div>
    );
  }
  if (item.kind === 'blob' && item.data) {
    return (
      <pre key={index} className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-[8px] bg-white p-2 text-[11px] leading-relaxed text-[#2f3437]/80">
        {`base64 blob (${item.mimeType || 'application/octet-stream'})\n${item.data.slice(0, 2000)}`}
      </pre>
    );
  }
  return (
    <pre key={index} className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-[8px] bg-white p-2 text-[11px] leading-relaxed text-[#2f3437]/80">
      {item.text || stringify(item.json)}
    </pre>
  );
};

const McpConsole: React.FC<McpConsoleProps> = ({ addToast }) => {
  const [servers, setServers] = useState<McpServerConfig[]>(() => {
    const loaded = loadMcpServers();
    return loaded.length ? loaded : [createDefaultMcpServer()];
  });
  const [selectedId, setSelectedId] = useState(() => servers[0]?.id || '');
  const [activeTab, setActiveTab] = useState<TabKey>('connect');
  const [importText, setImportText] = useState('');
  const [connection, setConnection] = useState<ConnectionState | null>(null);
  const connectionRef = useRef<ConnectionState | null>(null);
  const [busy, setBusy] = useState('');
  const rpcIdRef = useRef(1);

  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [tools, setTools] = useState<any[]>([]);
  const [toolCursor, setToolCursor] = useState<string>('');
  const [selectedTool, setSelectedTool] = useState('');
  const [toolArgsText, setToolArgsText] = useState('{}');
  const [toolResult, setToolResult] = useState<unknown>(null);

  const [resources, setResources] = useState<any[]>([]);
  const [resourceTemplates, setResourceTemplates] = useState<any[]>([]);
  const [resourceCursor, setResourceCursor] = useState('');
  const [resourceUri, setResourceUri] = useState('');
  const [resourceResult, setResourceResult] = useState<unknown>(null);

  const [prompts, setPrompts] = useState<any[]>([]);
  const [promptCursor, setPromptCursor] = useState('');
  const [selectedPrompt, setSelectedPrompt] = useState('');
  const [promptArgs, setPromptArgs] = useState<Record<string, string>>({});
  const [promptResult, setPromptResult] = useState<unknown>(null);

  const [completionText, setCompletionText] = useState('{\n  "ref": { "type": "ref/prompt", "name": "" },\n  "argument": { "name": "", "value": "" }\n}');
  const [serverResponseText, setServerResponseText] = useState('{\n  "jsonrpc": "2.0",\n  "method": "moro.gateway/respond",\n  "params": {\n    "id": "",\n    "result": {}\n  },\n  "id": 9001\n}');
  const [rawRequestText, setRawRequestText] = useState('{\n  "jsonrpc": "2.0",\n  "method": "tools/list",\n  "params": {}\n}');
  const [utilityResult, setUtilityResult] = useState<unknown>(null);
  const [gatewayStatus, setGatewayStatus] = useState<unknown>(null);
  const [gatewayEvents, setGatewayEvents] = useState<GatewayEvent[]>([]);

  useEffect(() => {
    connectionRef.current = connection;
  }, [connection]);

  const selectedServer = useMemo(
    () => servers.find(server => server.id === selectedId) || servers[0] || null,
    [servers, selectedId],
  );

  const notify = useCallback((message: string, kind: ToastKind = 'info') => {
    if (addToast) addToast(message, kind);
  }, [addToast]);

  const persistServers = useCallback((nextServers: McpServerConfig[]) => {
    const saved = saveMcpServers(nextServers);
    setServers(saved);
    if (!saved.some(server => server.id === selectedId)) {
      setSelectedId(saved[0]?.id || '');
    }
  }, [selectedId]);

  const updateServer = useCallback((patch: Partial<McpServerConfig>) => {
    if (!selectedServer) return;
    persistServers(servers.map(server => (
      server.id === selectedServer.id ? { ...server, ...patch, updatedAt: Date.now() } : server
    )));
  }, [persistServers, selectedServer, servers]);

  const applyServerTemplate = useCallback((template: 'http-direct' | 'http-gateway' | 'stdio-node' | 'stdio-python') => {
    const common = {
      gatewayUrl: 'http://127.0.0.1:18062',
      updatedAt: Date.now(),
    };
    if (template === 'http-direct') {
      updateServer({
        ...common,
        name: selectedServer?.name || 'HTTP MCP',
        transport: 'http',
        gatewayToken: '',
        httpUrl: 'http://127.0.0.1:18060/mcp',
        headersText: '',
      });
    } else if (template === 'http-gateway') {
      updateServer({
        ...common,
        name: selectedServer?.name || 'HTTP MCP',
        transport: 'http',
        httpUrl: 'http://127.0.0.1:18060/mcp',
        headersText: '',
      });
    } else if (template === 'stdio-node') {
      updateServer({
        ...common,
        name: selectedServer?.name || 'Node stdio MCP',
        transport: 'stdio',
        command: 'node',
        argsText: '["server.mjs"]',
        cwd: '',
        envText: '{}',
      });
    } else {
      updateServer({
        ...common,
        name: selectedServer?.name || 'Python stdio MCP',
        transport: 'stdio',
        command: 'python',
        argsText: '["server.py"]',
        cwd: '',
        envText: '{}',
      });
    }
    notify('模板已填入，按你的 server 实际路径和 token 再改一下', 'success');
  }, [notify, selectedServer?.name, updateServer]);

  const exportConfigs = useCallback((includeSecrets = false) => {
    const text = exportMcpServers(servers, { includeSecrets });
    downloadText(includeSecrets ? 'moro-mcp-servers-with-secrets.json' : 'moro-mcp-servers.json', text, 'application/json;charset=utf-8');
    notify(includeSecrets ? '已导出 MCP 配置（包含敏感字段）' : '已导出 MCP 配置（已去掉敏感字段）', 'success');
  }, [notify, servers]);

  const importConfigs = useCallback((mode: 'replace' | 'merge') => {
    try {
      const imported = importMcpServersText(importText);
      const next = mode === 'merge' ? [...servers, ...imported] : imported;
      persistServers(next);
      setSelectedId(imported[0]?.id || next[0]?.id || '');
      notify(mode === 'merge' ? `已合并 ${imported.length} 个 MCP server` : `已导入 ${imported.length} 个 MCP server`, 'success');
    } catch (error: any) {
      notify(error?.message || 'MCP 配置导入失败', 'error');
    }
  }, [importText, notify, persistServers, servers]);

  const checkGateway = useCallback(async () => {
    if (!selectedServer) return;
    if (!selectedServer.gatewayUrl.trim() || !selectedServer.gatewayToken.trim()) {
      notify('请先填写 gateway URL 和 token', 'error');
      return;
    }
    setBusy('gateway-health');
    try {
      const base = selectedServer.gatewayUrl.replace(/\/+$/, '');
      const headers = { 'x-moro-mcp-token': selectedServer.gatewayToken };
      const [healthResp, sessionsResp] = await Promise.all([
        fetch(`${base}/health`, { headers }),
        fetch(`${base}/sessions`, { headers }),
      ]);
      const healthText = await healthResp.text();
      const sessionsText = await sessionsResp.text();
      if (!healthResp.ok) throw new Error(healthText || `Gateway health HTTP ${healthResp.status}`);
      if (!sessionsResp.ok) throw new Error(sessionsText || `Gateway sessions HTTP ${sessionsResp.status}`);
      const status = {
        health: parseJsonText(healthText, {}),
        sessions: parseJsonText(sessionsText, {}),
      };
      setGatewayStatus(status);
      setUtilityResult(status);
      notify('网关在线，token 可用', 'success');
    } catch (error: any) {
      const status = { error: error?.message || String(error) };
      setGatewayStatus(status);
      setUtilityResult(status);
      notify(error?.message || '网关检查失败', 'error');
    } finally {
      setBusy('');
    }
  }, [notify, selectedServer]);

  const pushTranscript = useCallback((entry: Omit<TranscriptEntry, 'id' | 'time'>) => {
    const full: TranscriptEntry = {
      ...entry,
      id: makeTranscriptId(),
      time: new Date().toLocaleTimeString(),
    };
    appendMcpTranscript(undefined, {
      direction: entry.direction,
      label: entry.label,
      data: entry.data,
    });
    setTranscript(prev => [...prev.slice(-119), full]);
  }, []);

  const nextRpcId = useCallback(() => rpcIdRef.current++, []);

  const sendBody = useCallback(async (
    body: McpJsonRpcRequest,
    options: { expectResponse?: boolean; label?: string } = {},
  ): Promise<McpJsonRpcResponse | null> => {
    const conn = connectionRef.current;
    const server = servers.find(item => item.id === conn?.serverId);
    if (!conn || !server) throw new Error('请先连接 MCP server');

    pushTranscript({ direction: 'out', label: options.label || body.method, data: body });

    const envelope = conn.mode === 'gateway'
      ? await requestJsonRpcOverGateway(server.gatewayUrl, server.gatewayToken, conn.gatewaySessionId || '', body, { timeoutMs: 70_000 })
      : await requestJsonRpcOverHttp(server.httpUrl, body, {
        sessionId: conn.httpSessionId,
        headers: parseJsonObjectText(server.headersText, 'HTTP headers'),
        timeoutMs: 70_000,
      });

    if (conn.mode === 'direct-http' && envelope.sessionId && envelope.sessionId !== conn.httpSessionId) {
      setConnection(prev => prev ? { ...prev, httpSessionId: envelope.sessionId } : prev);
    }

    pushTranscript({
      direction: envelope.status === 202 ? 'event' : 'in',
      label: `${body.method} · HTTP ${envelope.status}`,
      data: {
        status: envelope.status,
        contentType: envelope.contentType,
        sessionId: envelope.sessionId,
        body: envelope.text,
      },
    });

    if (envelope.status === 202 || options.expectResponse === false) return null;
    const responses = parseMcpResponseText(envelope.text, envelope.contentType).map(normalizeMcpEnvelope);
    const response = normalizeMcpEnvelope(pickLastResponse(responses.filter(Boolean) as McpJsonRpcResponse[]));
    if (!response) return null;
    if (isResponseError(response)) {
      throw new Error(`MCP error ${response.error.code}: ${response.error.message}`);
    }
    return response;
  }, [pushTranscript, servers]);

  const callRpc = useCallback(async (
    method: string,
    params?: unknown,
    options: { notification?: boolean; label?: string; expectResponse?: boolean } = {},
  ): Promise<McpJsonRpcResponse | null> => {
    const body = makeJsonRpcRequest(method, params, options.notification ? undefined : nextRpcId());
    return sendBody(body, { label: options.label, expectResponse: options.notification ? false : options.expectResponse });
  }, [nextRpcId, sendBody]);

  const createGatewaySession = useCallback(async (server: McpServerConfig): Promise<string> => {
    if (!server.gatewayUrl.trim()) throw new Error('请填写 gateway URL');
    if (!server.gatewayToken.trim()) throw new Error('请填写 gateway token。未指定 token 启动网关时，脚本会在终端打印临时 token。');
    const config = toGatewaySessionConfig(server);
    const resp = await fetch(`${server.gatewayUrl.replace(/\/+$/, '')}/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-moro-mcp-token': server.gatewayToken,
      },
      body: JSON.stringify(config),
    });
    const text = await resp.text();
    if (!resp.ok) throw new Error(text || `Gateway HTTP ${resp.status}`);
    const parsed = parseJsonText<{ id: string }>(text, { id: '' });
    if (!parsed.id) throw new Error('Gateway 没有返回 session id');
    return parsed.id;
  }, []);

  const connect = useCallback(async () => {
    if (!selectedServer) return;
    setBusy('connect');
    setTranscript([]);
    setTools([]);
    setResources([]);
    setResourceTemplates([]);
    setPrompts([]);
    setGatewayEvents([]);
    setToolResult(null);
    setResourceResult(null);
    setPromptResult(null);
    setUtilityResult(null);
    try {
      const useGateway = selectedServer.transport === 'stdio' || !!selectedServer.gatewayToken.trim();
      const gatewaySessionId = useGateway ? await createGatewaySession(selectedServer) : undefined;
      const nextConnection: ConnectionState = {
        serverId: selectedServer.id,
        mode: useGateway ? 'gateway' : 'direct-http',
        connected: true,
        initialized: false,
        gatewaySessionId,
        httpSessionId: null,
        eventCursor: 0,
      };
      connectionRef.current = nextConnection;
      setConnection(nextConnection);

      const config = toGatewaySessionConfig(selectedServer);
      const initResponse = await sendBody(makeJsonRpcRequest('initialize', {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: config.capabilities,
        clientInfo: config.clientInfo,
      }, nextRpcId()), { label: 'initialize' });

      const result = initResponse?.result || {};
      const initializedConnection: ConnectionState = {
        ...nextConnection,
        initialized: true,
        serverInfo: result.serverInfo,
        capabilities: result.capabilities,
        instructions: result.instructions,
        protocolVersion: result.protocolVersion || MCP_PROTOCOL_VERSION,
      };
      connectionRef.current = initializedConnection;
      setConnection(initializedConnection);

      await sendBody(makeJsonRpcRequest('notifications/initialized', {}), {
        label: 'notifications/initialized',
        expectResponse: false,
      }).catch((error) => {
        pushTranscript({ direction: 'event', label: 'initialized notification failed', data: String(error?.message || error) });
      });

      notify('MCP server 已连接', 'success');
      setActiveTab('connect');
    } catch (error: any) {
      setConnection(null);
      notify(error?.message || 'MCP 连接失败', 'error');
      pushTranscript({ direction: 'event', label: 'connect failed', data: error?.message || String(error) });
    } finally {
      setBusy('');
    }
  }, [createGatewaySession, nextRpcId, notify, pushTranscript, selectedServer, sendBody]);

  const disconnect = useCallback(async () => {
    const conn = connectionRef.current;
    const server = servers.find(item => item.id === conn?.serverId);
    setConnection(null);
    connectionRef.current = null;
    if (conn?.mode === 'gateway' && server?.gatewayUrl && server.gatewayToken && conn.gatewaySessionId) {
      try {
        await fetch(`${server.gatewayUrl.replace(/\/+$/, '')}/sessions/${encodeURIComponent(conn.gatewaySessionId)}`, {
          method: 'DELETE',
          headers: { 'x-moro-mcp-token': server.gatewayToken },
        });
      } catch {
        // The local gateway may already be closed.
      }
    }
    notify('MCP 连接已断开', 'info');
  }, [notify, servers]);

  const listTools = useCallback(async (append = false) => {
    setBusy('tools/list');
    try {
      const response = await callRpc('tools/list', append && toolCursor ? { cursor: toolCursor } : undefined);
      const result = response?.result || {};
      const nextTools = Array.isArray(result.tools) ? result.tools : [];
      setTools(prev => append ? [...prev, ...nextTools] : nextTools);
      setToolCursor(result.nextCursor || result.next_cursor || '');
      if (!selectedTool && nextTools[0]?.name) setSelectedTool(nextTools[0].name);
      notify(`拿到 ${nextTools.length} 个工具`, 'success');
    } catch (error: any) {
      notify(error?.message || 'tools/list 失败', 'error');
    } finally {
      setBusy('');
    }
  }, [callRpc, notify, selectedTool, toolCursor]);

  const callTool = useCallback(async () => {
    if (!selectedTool) return;
    if (!window.confirm(`确认调用工具：${selectedTool}？\n\n工具可能访问本地文件、网络账号或真实服务。`)) return;
    setBusy('tools/call');
    try {
      const args = parseJsonText<Record<string, unknown>>(toolArgsText, {});
      const response = await callRpc('tools/call', { name: selectedTool, arguments: args });
      setToolResult(response?.result || null);
      notify('工具调用完成', 'success');
    } catch (error: any) {
      notify(error?.message || 'tools/call 失败', 'error');
      setToolResult({ error: error?.message || String(error) });
    } finally {
      setBusy('');
    }
  }, [callRpc, notify, selectedTool, toolArgsText]);

  const listResources = useCallback(async (append = false) => {
    setBusy('resources/list');
    try {
      const response = await callRpc('resources/list', append && resourceCursor ? { cursor: resourceCursor } : undefined);
      const result = response?.result || {};
      const nextResources = Array.isArray(result.resources) ? result.resources : [];
      setResources(prev => append ? [...prev, ...nextResources] : nextResources);
      setResourceCursor(result.nextCursor || result.next_cursor || '');
      if (!resourceUri && nextResources[0]?.uri) setResourceUri(nextResources[0].uri);
      notify(`拿到 ${nextResources.length} 个资源`, 'success');
    } catch (error: any) {
      notify(error?.message || 'resources/list 失败', 'error');
    } finally {
      setBusy('');
    }
  }, [callRpc, notify, resourceCursor, resourceUri]);

  const listResourceTemplates = useCallback(async () => {
    setBusy('resources/templates/list');
    try {
      const response = await callRpc('resources/templates/list');
      setResourceTemplates(Array.isArray(response?.result?.resourceTemplates) ? response.result.resourceTemplates : []);
      notify('资源模板已刷新', 'success');
    } catch (error: any) {
      notify(error?.message || 'resources/templates/list 失败', 'error');
    } finally {
      setBusy('');
    }
  }, [callRpc, notify]);

  const readResource = useCallback(async () => {
    if (!resourceUri.trim()) return;
    setBusy('resources/read');
    try {
      const response = await callRpc('resources/read', { uri: resourceUri.trim() });
      setResourceResult(response?.result || null);
      notify('资源已读取', 'success');
    } catch (error: any) {
      notify(error?.message || 'resources/read 失败', 'error');
      setResourceResult({ error: error?.message || String(error) });
    } finally {
      setBusy('');
    }
  }, [callRpc, notify, resourceUri]);

  const resourceSubscription = useCallback(async (method: 'resources/subscribe' | 'resources/unsubscribe') => {
    if (!resourceUri.trim()) return;
    setBusy(method);
    try {
      const response = await callRpc(method, { uri: resourceUri.trim() });
      setUtilityResult(response?.result || { ok: true });
      notify(method === 'resources/subscribe' ? '已订阅资源' : '已取消订阅', 'success');
    } catch (error: any) {
      notify(error?.message || `${method} 失败`, 'error');
    } finally {
      setBusy('');
    }
  }, [callRpc, notify, resourceUri]);

  const listPrompts = useCallback(async (append = false) => {
    setBusy('prompts/list');
    try {
      const response = await callRpc('prompts/list', append && promptCursor ? { cursor: promptCursor } : undefined);
      const result = response?.result || {};
      const nextPrompts = Array.isArray(result.prompts) ? result.prompts : [];
      setPrompts(prev => append ? [...prev, ...nextPrompts] : nextPrompts);
      setPromptCursor(result.nextCursor || result.next_cursor || '');
      if (!selectedPrompt && nextPrompts[0]?.name) setSelectedPrompt(nextPrompts[0].name);
      notify(`拿到 ${nextPrompts.length} 个 prompt`, 'success');
    } catch (error: any) {
      notify(error?.message || 'prompts/list 失败', 'error');
    } finally {
      setBusy('');
    }
  }, [callRpc, notify, promptCursor, selectedPrompt]);

  const getPrompt = useCallback(async () => {
    if (!selectedPrompt) return;
    setBusy('prompts/get');
    try {
      const args = Object.fromEntries(Object.entries(promptArgs).filter(([, value]) => value.trim()));
      const response = await callRpc('prompts/get', { name: selectedPrompt, arguments: args });
      setPromptResult(response?.result || null);
      notify('Prompt 已获取', 'success');
    } catch (error: any) {
      notify(error?.message || 'prompts/get 失败', 'error');
      setPromptResult({ error: error?.message || String(error) });
    } finally {
      setBusy('');
    }
  }, [callRpc, notify, promptArgs, selectedPrompt]);

  const callUtility = useCallback(async (method: string, params?: unknown) => {
    setBusy(method);
    try {
      const response = await callRpc(method, params);
      setUtilityResult(response?.result || { ok: true });
      notify(`${method} 完成`, 'success');
    } catch (error: any) {
      notify(error?.message || `${method} 失败`, 'error');
      setUtilityResult({ error: error?.message || String(error) });
    } finally {
      setBusy('');
    }
  }, [callRpc, notify]);

  const sendRawRequest = useCallback(async () => {
    setBusy('raw');
    try {
      const raw = parseJsonText<McpJsonRpcRequest>(rawRequestText, { jsonrpc: '2.0', method: 'ping' });
      const body: McpJsonRpcRequest = {
        jsonrpc: '2.0',
        ...raw,
      };
      const response = await sendBody(body, { label: `raw:${body.method}`, expectResponse: !('id' in body) ? false : undefined });
      setUtilityResult(response?.result ?? { ok: true });
      notify('原始请求已发送', 'success');
    } catch (error: any) {
      notify(error?.message || '原始请求失败', 'error');
      setUtilityResult({ error: error?.message || String(error) });
    } finally {
      setBusy('');
    }
  }, [notify, rawRequestText, sendBody]);

  const sendServerResponse = useCallback(async () => {
    const conn = connectionRef.current;
    if (!conn || conn.mode !== 'gateway') {
      notify('server-initiated request 只能通过本地网关手动响应', 'info');
      return;
    }
    setBusy('gateway-response');
    try {
      const body = parseJsonText<McpJsonRpcRequest>(serverResponseText, {
        jsonrpc: '2.0',
        method: 'moro.gateway/respond',
      });
      const response = await sendBody({ jsonrpc: '2.0', ...body }, { label: 'moro.gateway/respond' });
      setUtilityResult(response?.result ?? { ok: true });
      notify('手动响应已发送', 'success');
    } catch (error: any) {
      notify(error?.message || '手动响应失败', 'error');
      setUtilityResult({ error: error?.message || String(error) });
    } finally {
      setBusy('');
    }
  }, [notify, sendBody, serverResponseText]);

  const pollGatewayEvents = useCallback(async () => {
    const conn = connectionRef.current;
    const server = servers.find(item => item.id === conn?.serverId);
    if (!conn || conn.mode !== 'gateway' || !server) {
      notify('只有通过本地网关连接时才有网关事件流', 'info');
      return;
    }
    setBusy('events');
    try {
      const resp = await fetch(`${server.gatewayUrl.replace(/\/+$/, '')}/sessions/${encodeURIComponent(conn.gatewaySessionId || '')}/events?since=${conn.eventCursor || 0}`, {
        headers: { 'x-moro-mcp-token': server.gatewayToken },
      });
      const text = await resp.text();
      if (!resp.ok) throw new Error(text || `Gateway HTTP ${resp.status}`);
      const parsed = parseJsonText<{ events: GatewayEvent[] }>(text, { events: [] });
      const events = Array.isArray(parsed.events) ? parsed.events : [];
      if (events.length) {
        setGatewayEvents(prev => [...prev.slice(-199), ...events]);
        const maxId = Math.max(...events.map(event => event.id));
        setConnection(prev => prev ? { ...prev, eventCursor: maxId } : prev);
        pushTranscript({ direction: 'event', label: `gateway events +${events.length}`, data: events });
      }
      notify(events.length ? `收到 ${events.length} 条事件` : '暂无新事件', 'info');
    } catch (error: any) {
      notify(error?.message || '读取网关事件失败', 'error');
    } finally {
      setBusy('');
    }
  }, [notify, pushTranscript, servers]);

  const fillLatestPendingServerResponse = useCallback(() => {
    const pending = [...gatewayEvents]
      .reverse()
      .find(event => event.type === 'pending-server-request' || event.type === 'server-request') as GatewayEvent | undefined;
    const data = pending?.data as any;
    const id = data?.id ?? data?.data?.id ?? '';
    const method = data?.method ?? data?.data?.method ?? '';
    setServerResponseText(JSON.stringify({
      jsonrpc: '2.0',
      method: 'moro.gateway/respond',
      params: {
        id,
        result: method === 'sampling/createMessage'
          ? { model: 'manual', role: 'assistant', content: { type: 'text', text: '' } }
          : {},
      },
      id: nextRpcId(),
    }, null, 2));
  }, [gatewayEvents, nextRpcId]);

  const selectedToolDef = useMemo(() => tools.find(tool => tool.name === selectedTool), [selectedTool, tools]);
  const selectedPromptDef = useMemo(() => prompts.find(prompt => prompt.name === selectedPrompt), [selectedPrompt, prompts]);

  useEffect(() => {
    if (!selectedPromptDef?.arguments) return;
    setPromptArgs(prev => {
      const next = { ...prev };
      for (const arg of selectedPromptDef.arguments || []) {
        if (typeof arg?.name === 'string' && !(arg.name in next)) next[arg.name] = '';
      }
      return next;
    });
  }, [selectedPromptDef]);

  const renderResult = (value: unknown, filename: string) => {
    const content = renderTransportContent((value as any)?.content || (value as any)?.contents || value);
    const text = stringify(value);
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <button type="button" className={BTN} onClick={() => navigator.clipboard.writeText(text).then(() => notify('JSON 已复制', 'success')).catch(() => notify('复制失败', 'error'))}>复制 JSON</button>
          <button type="button" className={BTN} onClick={() => downloadText(filename, text, 'application/json;charset=utf-8')}>下载 JSON</button>
        </div>
        {content.length ? content.map(renderContentBlock) : (
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-[8px] bg-white p-2 text-[11px] leading-relaxed text-[#2f3437]/80">
            {text}
          </pre>
        )}
      </div>
    );
  };

  if (!selectedServer) return null;

  const connectedToSelected = connection?.connected && connection.serverId === selectedServer.id;
  const sanitizedSelected = redactMcpServer(selectedServer);

  return (
    <div data-manual-anchor="manual-settings-mcp-console" className="rounded-xl border border-black/10 bg-white p-4 text-[#2f3437]">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-black text-[#26242a]">MCP 控制台</span>
            <span className="label-mono rounded-full border border-[#1c1b1a]/30 px-2 py-0.5 text-[8px] text-[#26242a]/60">HTTP / stdio</span>
          </div>
          <p className="mt-1 text-[10px] leading-relaxed text-[#26242a]/55">
            手动连接和调试 MCP server。这里不会接入角色聊天，也不会自动调用 Moro 的 LLM。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={BTN}
            onClick={() => {
              const next = createDefaultMcpServer({ name: `MCP ${servers.length + 1}` });
              persistServers([...servers, next]);
              setSelectedId(next.id);
            }}
          >
            新增
          </button>
          <button
            type="button"
            className={BTN}
            onClick={() => {
              const copy = duplicateMcpServer(selectedServer);
              persistServers([...servers, copy]);
              setSelectedId(copy.id);
            }}
          >
            复制
          </button>
          <button
            type="button"
            className={DANGER}
            disabled={servers.length <= 1}
            onClick={() => {
              if (!window.confirm(`删除 MCP server：${selectedServer.name}？`)) return;
              const next = servers.filter(server => server.id !== selectedServer.id);
              persistServers(next.length ? next : [createDefaultMcpServer()]);
            }}
          >
            删除
          </button>
          <button type="button" className={BTN} onClick={() => exportConfigs(false)}>导出</button>
          <button type="button" className={BTN} onClick={() => setActiveTab('tutorial')}>教程</button>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)]">
        <section className={PANEL}>
          <div className="space-y-3">
            <div>
              <label className={LABEL}>SERVER</label>
              <select value={selectedServer.id} onChange={event => setSelectedId(event.target.value)} className={FIELD}>
                {servers.map(server => (
                  <option key={server.id} value={server.id}>{server.enabled ? '' : '[停用] '}{server.name}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                className={selectedServer.enabled ? PRIMARY : BTN}
                onClick={() => updateServer({ enabled: !selectedServer.enabled })}
              >
                {selectedServer.enabled ? '已启用' : '已停用'}
              </button>
              <button
                type="button"
                className={connectedToSelected ? DANGER : PRIMARY}
                disabled={!!busy || !selectedServer.enabled}
                onClick={connectedToSelected ? disconnect : connect}
              >
                {busy === 'connect' ? '连接中' : connectedToSelected ? '断开' : '连接'}
              </button>
            </div>

            <div>
              <label className={LABEL}>名称</label>
              <input value={selectedServer.name} onChange={event => updateServer({ name: event.target.value })} className={FIELD} />
            </div>
            <div>
              <label className={LABEL}>TRANSPORT</label>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" className={selectedServer.transport === 'http' ? PRIMARY : BTN} onClick={() => updateServer({ transport: 'http' })}>HTTP</button>
                <button type="button" className={selectedServer.transport === 'stdio' ? PRIMARY : BTN} onClick={() => updateServer({ transport: 'stdio' })}>stdio</button>
              </div>
            </div>

            <div className="space-y-2 border-t border-[#e7e1d6] pt-3">
              <div>
                <label className={LABEL}>GATEWAY URL</label>
                <input value={selectedServer.gatewayUrl} onChange={event => updateServer({ gatewayUrl: event.target.value })} className={`${FIELD} font-mono`} placeholder="http://127.0.0.1:18062" />
              </div>
              <div>
                <label className={LABEL}>GATEWAY TOKEN</label>
                <input type="password" value={selectedServer.gatewayToken} onChange={event => updateServer({ gatewayToken: event.target.value })} className={`${FIELD} font-mono`} placeholder="node scripts/mcp-gateway.mjs 打印的 token" />
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={BTN} disabled={busy === 'gateway-health'} onClick={checkGateway}>
                  {busy === 'gateway-health' ? '检查中' : '检查网关'}
                </button>
                <button
                  type="button"
                  className={BTN}
                  onClick={() => navigator.clipboard.writeText(`node scripts/mcp-gateway.mjs --port 18062 --token ${selectedServer.gatewayToken || '<token>'}`).then(() => notify('网关命令已复制', 'success')).catch(() => notify('复制失败', 'error'))}
                >
                  复制命令
                </button>
              </div>
              {gatewayStatus !== null && (
                <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-[8px] bg-white p-2 text-[10px] leading-relaxed text-[#2f3437]/75">{stringify(gatewayStatus)}</pre>
              )}
              <p className="text-[10px] leading-relaxed text-[#26242a]/55">
                stdio 必须走本地网关。HTTP 可直连；遇到 CORS、Session ID 读不到或要隐藏 headers 时，也建议走网关。
              </p>
            </div>

            {selectedServer.transport === 'http' ? (
              <div className="space-y-2 border-t border-[#e7e1d6] pt-3">
                <div>
                  <label className={LABEL}>HTTP MCP URL</label>
                  <input value={selectedServer.httpUrl} onChange={event => updateServer({ httpUrl: event.target.value })} className={`${FIELD} font-mono`} placeholder="http://127.0.0.1:18060/mcp" />
                </div>
                <div>
                  <label className={LABEL}>HEADERS · JSON 或 key: value</label>
                  <textarea value={selectedServer.headersText} onChange={event => updateServer({ headersText: event.target.value })} className={TEXTAREA} placeholder={'{\n  "Authorization": "Bearer ..."\n}'} />
                </div>
              </div>
            ) : (
              <div className="space-y-2 border-t border-[#e7e1d6] pt-3">
                <div>
                  <label className={LABEL}>COMMAND</label>
                  <input value={selectedServer.command} onChange={event => updateServer({ command: event.target.value })} className={`${FIELD} font-mono`} placeholder="node" />
                </div>
                <div>
                  <label className={LABEL}>ARGS · JSON 数组或空格分隔</label>
                  <textarea value={selectedServer.argsText} onChange={event => updateServer({ argsText: event.target.value })} className={TEXTAREA} placeholder={'["server.mjs"]'} />
                </div>
                <div>
                  <label className={LABEL}>CWD</label>
                  <input value={selectedServer.cwd} onChange={event => updateServer({ cwd: event.target.value })} className={`${FIELD} font-mono`} placeholder="可留空" />
                </div>
                <div>
                  <label className={LABEL}>ENV · JSON 或 key=value</label>
                  <textarea value={selectedServer.envText} onChange={event => updateServer({ envText: event.target.value })} className={TEXTAREA} placeholder={'{\n  "API_KEY": "..."\n}'} />
                </div>
              </div>
            )}

            <div className="space-y-2 border-t border-[#e7e1d6] pt-3">
              <label className="flex items-center justify-between gap-3 text-xs font-bold text-[#26242a]">
                roots/list
                <input type="checkbox" checked={selectedServer.rootsEnabled} onChange={event => updateServer({ rootsEnabled: event.target.checked })} />
              </label>
              {selectedServer.rootsEnabled && (
                <textarea value={selectedServer.rootsText} onChange={event => updateServer({ rootsText: event.target.value })} className={TEXTAREA} placeholder={'[\n  { "uri": "file:///C:/path", "name": "workspace" }\n]'} />
              )}
              <label className="flex items-center justify-between gap-3 text-xs font-bold text-[#26242a]">
                sampling 手动响应
                <input type="checkbox" checked={selectedServer.samplingEnabled} onChange={event => updateServer({ samplingEnabled: event.target.checked })} />
              </label>
              <label className="flex items-center justify-between gap-3 text-xs font-bold text-[#26242a]">
                elicitation 手动响应
                <input type="checkbox" checked={selectedServer.elicitationEnabled} onChange={event => updateServer({ elicitationEnabled: event.target.checked })} />
              </label>
            </div>
          </div>
        </section>

        <section className="min-w-0 space-y-3">
          <div className="flex flex-wrap gap-2">
            {(Object.keys(tabLabels) as TabKey[]).map(tab => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={activeTab === tab ? PRIMARY : BTN}
              >
                {tabLabels[tab]}
              </button>
            ))}
          </div>

          {activeTab === 'connect' && (
            <div className={PANEL}>
              <div className="mb-3 flex flex-wrap gap-2">
                <button type="button" className={connectedToSelected ? DANGER : PRIMARY} disabled={!!busy || !selectedServer.enabled} onClick={connectedToSelected ? disconnect : connect}>
                  {connectedToSelected ? '断开连接' : '连接并 initialize'}
                </button>
                <button type="button" className={BTN} onClick={() => setTranscript([])}>清空 transcript</button>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <div className="rounded-[8px] bg-white p-2">
                  <p className="label-mono text-[9px] text-[#8a918d]">STATUS</p>
                  <pre className="whitespace-pre-wrap break-words text-[11px] leading-relaxed text-[#2f3437]/80">{stringify({
                    connected: connectedToSelected,
                    mode: connection?.mode,
                    initialized: connection?.initialized,
                    protocolVersion: connection?.protocolVersion,
                    gatewaySessionId: connection?.gatewaySessionId,
                    httpSessionId: connection?.httpSessionId,
                  })}</pre>
                </div>
                <div className="rounded-[8px] bg-white p-2">
                  <p className="label-mono text-[9px] text-[#8a918d]">SERVER CONFIG · 脱敏预览</p>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-[#2f3437]/80">{stringify(sanitizedSelected)}</pre>
                </div>
              </div>
              <div className="mt-2 grid gap-2 md:grid-cols-3">
                <div className="rounded-[8px] bg-white p-2">
                  <p className="label-mono text-[9px] text-[#8a918d]">SERVER INFO</p>
                  <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words text-[11px]">{stringify(connection?.serverInfo || {})}</pre>
                </div>
                <div className="rounded-[8px] bg-white p-2">
                  <p className="label-mono text-[9px] text-[#8a918d]">CAPABILITIES</p>
                  <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words text-[11px]">{stringify(connection?.capabilities || {})}</pre>
                </div>
                <div className="rounded-[8px] bg-white p-2">
                  <p className="label-mono text-[9px] text-[#8a918d]">INSTRUCTIONS</p>
                  <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words text-[11px]">{connection?.instructions || '无'}</pre>
                </div>
              </div>
              <div className="mt-3">
                <p className="label-mono mb-1 text-[9px] text-[#8a918d]">RAW TRANSCRIPT</p>
                <div className="max-h-72 space-y-2 overflow-auto rounded-[8px] bg-white p-2">
                  {transcript.length === 0 ? (
                    <p className="text-[11px] text-[#26242a]/45">连接和请求会显示在这里。</p>
                  ) : transcript.map(item => (
                    <div key={item.id} className="border-b border-[#e7e1d6] pb-2 last:border-0">
                      <div className="mb-1 flex items-center justify-between gap-2 text-[10px] font-bold text-[#26242a]/60">
                        <span>{item.time} · {item.direction.toUpperCase()} · {item.label}</span>
                      </div>
                      <pre className="whitespace-pre-wrap break-words text-[10px] leading-relaxed text-[#26242a]/75">{stringify(item.data)}</pre>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'tools' && (
            <div className={PANEL}>
              <div className="mb-3 flex flex-wrap gap-2">
                <button type="button" className={PRIMARY} disabled={!connectedToSelected || !!busy} onClick={() => listTools(false)}>tools/list</button>
                <button type="button" className={BTN} disabled={!connectedToSelected || !toolCursor || !!busy} onClick={() => listTools(true)}>下一页</button>
              </div>
              <div className="grid gap-3 md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
                <div>
                  <label className={LABEL}>工具</label>
                  <select value={selectedTool} onChange={event => setSelectedTool(event.target.value)} className={FIELD}>
                    <option value="">选择工具</option>
                    {tools.map(tool => <option key={tool.name} value={tool.name}>{tool.name}</option>)}
                  </select>
                  <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-[8px] bg-white p-2 text-[11px] leading-relaxed text-[#2f3437]/80">{stringify({
                    description: selectedToolDef?.description,
                    inputSchema: selectedToolDef ? getToolSchema(selectedToolDef) : undefined,
                  })}</pre>
                </div>
                <div className="space-y-2">
                  <div>
                    <label className={LABEL}>参数 JSON</label>
                    <textarea value={toolArgsText} onChange={event => setToolArgsText(event.target.value)} className={`${TEXTAREA} min-h-[130px]`} />
                  </div>
                  <button type="button" className={PRIMARY} disabled={!connectedToSelected || !selectedTool || !!busy} onClick={callTool}>确认并调用 tools/call</button>
                  {toolResult !== null && renderResult(toolResult, `mcp-tool-${selectedTool || 'result'}.json`)}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'resources' && (
            <div className={PANEL}>
              <div className="mb-3 flex flex-wrap gap-2">
                <button type="button" className={PRIMARY} disabled={!connectedToSelected || !!busy} onClick={() => listResources(false)}>resources/list</button>
                <button type="button" className={BTN} disabled={!connectedToSelected || !resourceCursor || !!busy} onClick={() => listResources(true)}>下一页</button>
                <button type="button" className={BTN} disabled={!connectedToSelected || !!busy} onClick={listResourceTemplates}>templates/list</button>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <div>
                    <label className={LABEL}>RESOURCE URI</label>
                    <input value={resourceUri} onChange={event => setResourceUri(event.target.value)} className={`${FIELD} font-mono`} placeholder="file:///... 或自定义 uri" />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={PRIMARY} disabled={!connectedToSelected || !resourceUri.trim() || !!busy} onClick={readResource}>resources/read</button>
                    <button type="button" className={BTN} disabled={!connectedToSelected || !resourceUri.trim() || !!busy} onClick={() => resourceSubscription('resources/subscribe')}>subscribe</button>
                    <button type="button" className={BTN} disabled={!connectedToSelected || !resourceUri.trim() || !!busy} onClick={() => resourceSubscription('resources/unsubscribe')}>unsubscribe</button>
                  </div>
                  <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-[8px] bg-white p-2 text-[11px] leading-relaxed text-[#2f3437]/80">{stringify({ resources, resourceTemplates })}</pre>
                </div>
                <div>
                  {resourceResult !== null ? renderResult(resourceResult, 'mcp-resource.json') : (
                    <p className="rounded-[8px] bg-white p-2 text-[11px] text-[#26242a]/45">读取资源后会显示 text / blob 预览，并可下载 JSON。</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'prompts' && (
            <div className={PANEL}>
              <div className="mb-3 flex flex-wrap gap-2">
                <button type="button" className={PRIMARY} disabled={!connectedToSelected || !!busy} onClick={() => listPrompts(false)}>prompts/list</button>
                <button type="button" className={BTN} disabled={!connectedToSelected || !promptCursor || !!busy} onClick={() => listPrompts(true)}>下一页</button>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <div>
                    <label className={LABEL}>PROMPT</label>
                    <select value={selectedPrompt} onChange={event => setSelectedPrompt(event.target.value)} className={FIELD}>
                      <option value="">选择 prompt</option>
                      {prompts.map(prompt => <option key={prompt.name} value={prompt.name}>{prompt.name}</option>)}
                    </select>
                  </div>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-[8px] bg-white p-2 text-[11px] leading-relaxed text-[#2f3437]/80">{stringify(selectedPromptDef || {})}</pre>
                  {(selectedPromptDef?.arguments || []).map((arg: any) => (
                    <div key={arg.name}>
                      <label className={LABEL}>{arg.name}{arg.required ? ' · 必填' : ''}</label>
                      <input value={promptArgs[arg.name] || ''} onChange={event => setPromptArgs(prev => ({ ...prev, [arg.name]: event.target.value }))} className={FIELD} placeholder={arg.description || ''} />
                    </div>
                  ))}
                  <button type="button" className={PRIMARY} disabled={!connectedToSelected || !selectedPrompt || !!busy} onClick={getPrompt}>prompts/get</button>
                </div>
                <div>
                  {promptResult !== null ? renderResult(promptResult, `mcp-prompt-${selectedPrompt || 'result'}.json`) : (
                    <p className="rounded-[8px] bg-white p-2 text-[11px] text-[#26242a]/45">Prompt messages 会显示在这里，可复制 JSON。</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'utilities' && (
            <div className={PANEL}>
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={PRIMARY} disabled={!connectedToSelected || !!busy} onClick={() => callUtility('ping')}>ping</button>
                  <button type="button" className={BTN} disabled={!connectedToSelected || !!busy} onClick={() => callUtility('logging/setLevel', { level: selectedServer.loggingLevel })}>logging/setLevel</button>
                  <select value={selectedServer.loggingLevel} onChange={event => updateServer({ loggingLevel: event.target.value as McpServerConfig['loggingLevel'] })} className="rounded-full border border-[#e7e1d6] bg-white px-3 py-1.5 text-[11px] font-bold text-[#2f3437]">
                    {['debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency'].map(level => <option key={level} value={level}>{level}</option>)}
                  </select>
                  <button type="button" className={BTN} disabled={!connectedToSelected || !!busy} onClick={pollGatewayEvents}>刷新通知/日志流</button>
                </div>
                <div>
                  <label className={LABEL}>completion/complete 参数 JSON</label>
                  <textarea value={completionText} onChange={event => setCompletionText(event.target.value)} className={TEXTAREA} />
                  <button type="button" className={`${BTN} mt-2`} disabled={!connectedToSelected || !!busy} onClick={() => callUtility('completion/complete', parseJsonText(completionText, {}))}>completion/complete</button>
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <label className={LABEL}>server-initiated 手动响应 JSON</label>
                    <button type="button" className={BTN} disabled={!gatewayEvents.length} onClick={fillLatestPendingServerResponse}>填入最近请求</button>
                  </div>
                  <textarea value={serverResponseText} onChange={event => setServerResponseText(event.target.value)} className={`${TEXTAREA} min-h-[130px]`} />
                  <button type="button" className={`${BTN} mt-2`} disabled={!connectedToSelected || connection?.mode !== 'gateway' || !!busy} onClick={sendServerResponse}>发送手动响应</button>
                </div>
                <div>
                  <label className={LABEL}>原始 JSON-RPC 请求</label>
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {RAW_REQUEST_TEMPLATES.map(template => (
                      <button
                        key={template.label}
                        type="button"
                        className={BTN}
                        onClick={() => setRawRequestText(JSON.stringify({ ...template.request, id: template.request.id === undefined ? undefined : nextRpcId() }, null, 2))}
                      >
                        {template.label}
                      </button>
                    ))}
                  </div>
                  <textarea value={rawRequestText} onChange={event => setRawRequestText(event.target.value)} className={`${TEXTAREA} min-h-[130px]`} />
                  <button type="button" className={`${PRIMARY} mt-2`} disabled={!connectedToSelected || !!busy} onClick={sendRawRequest}>发送 raw request</button>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <p className="label-mono mb-1 text-[9px] text-[#8a918d]">通知 / 日志流</p>
                    <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-[8px] bg-white p-2 text-[10px] leading-relaxed text-[#2f3437]/80">{stringify(gatewayEvents)}</pre>
                  </div>
                  <div>
                    <p className="label-mono mb-1 text-[9px] text-[#8a918d]">UTILITY RESULT</p>
                    {utilityResult !== null ? renderResult(utilityResult, 'mcp-utility-result.json') : (
                      <p className="rounded-[8px] bg-white p-2 text-[11px] text-[#26242a]/45">ping、logging、completion 或 raw request 的结果会显示在这里。</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'tutorial' && (
            <div data-manual-anchor="manual-settings-mcp-tutorial" className={PANEL}>
              <div className="space-y-4">
                <div className="rounded-[8px] bg-white p-3">
                  <p className="text-sm font-black text-[#26242a]">从零连一个 MCP server</p>
                  <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-[11px] leading-relaxed text-[#2f3437]/75">
                    <li>先确认 server 类型：浏览器能访问的 endpoint 选 HTTP；需要启动本地命令的选 stdio。</li>
                    <li>stdio 或 HTTP 跨域失败时，先在项目目录运行本地网关，再把终端打印的 token 粘到左侧。</li>
                    <li>点「检查网关」确认 token 和端口正确，再点「连接并 initialize」。</li>
                    <li>连接页看到 serverInfo / capabilities 后，按 server 文档去 Tools、Resources 或 Prompts 页测试。</li>
                    <li>调用任何会改数据、访问账号、读文件或下单的工具前，先检查 schema 和参数，再确认调用。</li>
                  </ol>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-[8px] bg-white p-3">
                    <p className="label-mono text-[9px] text-[#8a918d]">GATEWAY COMMAND</p>
                    <pre className="mt-1 whitespace-pre-wrap break-words rounded-[8px] bg-[#f8f6ef] p-2 text-[11px] text-[#2f3437]">{`node scripts/mcp-gateway.mjs --port 18062 --token ${selectedServer.gatewayToken || '<token>'}`}</pre>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className={BTN}
                        onClick={() => navigator.clipboard.writeText(`node scripts/mcp-gateway.mjs --port 18062 --token ${selectedServer.gatewayToken || '<token>'}`).then(() => notify('网关命令已复制', 'success')).catch(() => notify('复制失败', 'error'))}
                      >
                        复制命令
                      </button>
                      <button type="button" className={BTN} onClick={checkGateway}>检查网关</button>
                    </div>
                    <p className="mt-2 text-[10px] leading-relaxed text-[#26242a]/55">
                      不传 token 时，脚本会生成临时 token 并打印。网关只监听 127.0.0.1，所有请求都需要 x-moro-mcp-token。
                    </p>
                  </div>

                  <div className="rounded-[8px] bg-white p-3">
                    <p className="label-mono text-[9px] text-[#8a918d]">配置模板</p>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <button type="button" className={BTN} onClick={() => applyServerTemplate('http-direct')}>HTTP 直连</button>
                      <button type="button" className={BTN} onClick={() => applyServerTemplate('http-gateway')}>HTTP 走网关</button>
                      <button type="button" className={BTN} onClick={() => applyServerTemplate('stdio-node')}>Node stdio</button>
                      <button type="button" className={BTN} onClick={() => applyServerTemplate('stdio-python')}>Python stdio</button>
                    </div>
                    <p className="mt-2 text-[10px] leading-relaxed text-[#26242a]/55">
                      模板只填常见字段，实际 command、args、cwd、headers、env 仍要按 server 文档调整。
                    </p>
                  </div>
                </div>

                <div className="rounded-[8px] bg-white p-3">
                  <p className="text-xs font-black text-[#26242a]">常见排错</p>
                  <div className="mt-2 grid gap-2 md:grid-cols-2">
                    {[
                      ['401 / invalid token', '检查左侧 gateway token 是否和终端打印一致；/health 也要求 token。'],
                      ['Failed to fetch / CORS', 'HTTP 直连时常见。改用 HTTP 走网关，或让上游暴露 Mcp-Session-Id。'],
                      ['initialize 失败', '看 transcript 里的协议版本、server 返回体和状态码；旧 HTTP+SSE server 可尝试走网关 fallback。'],
                      ['stdio 没响应', '确认 command、args、cwd 正确；stderr 不是失败，会在通知 / 日志流里显示。'],
                      ['tools/call 参数错', '先看 inputSchema，用 raw request 或工具参数 JSON 保持字段名和类型一致。'],
                      ['sampling / elicitation 卡住', 'Utilities 里刷新事件流，填入最近 server-initiated request 后手动发送 response。'],
                    ].map(([title, body]) => (
                      <div key={title} className="rounded-[8px] border border-[#e7e1d6] bg-[#fffdf8] p-2">
                        <p className="text-[11px] font-black text-[#26242a]">{title}</p>
                        <p className="mt-1 text-[10px] leading-relaxed text-[#26242a]/60">{body}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-[8px] bg-white p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-black text-[#26242a]">配置导入 / 导出</p>
                      <p className="mt-1 text-[10px] leading-relaxed text-[#26242a]/55">默认导出会去掉 token、headers 和 env；只有你明确点击包含敏感字段时才会一起导出。</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className={BTN} onClick={() => exportConfigs(false)}>导出脱敏配置</button>
                      <button
                        type="button"
                        className={DANGER}
                        onClick={() => {
                          if (window.confirm('确认导出包含 token、headers 和 env 的 MCP 配置？请只保存到可信位置。')) exportConfigs(true);
                        }}
                      >
                        导出含密钥
                      </button>
                    </div>
                  </div>
                  <textarea
                    value={importText}
                    onChange={event => setImportText(event.target.value)}
                    className={`${TEXTAREA} mt-3 min-h-[120px]`}
                    placeholder={'粘贴 moro-mcp-servers.json，或直接粘贴 server 数组'}
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" className={BTN} disabled={!importText.trim()} onClick={() => importConfigs('merge')}>合并导入</button>
                    <button
                      type="button"
                      className={DANGER}
                      disabled={!importText.trim()}
                      onClick={() => {
                        if (window.confirm('确认用导入内容替换当前 MCP server 列表？')) importConfigs('replace');
                      }}
                    >
                      替换导入
                    </button>
                  </div>
                </div>

                <div className="rounded-[8px] bg-white p-3">
                  <p className="text-xs font-black text-[#26242a]">安全边界</p>
                  <p className="mt-2 text-[11px] leading-relaxed text-[#2f3437]/70">
                    MCP server 可能读本地文件、访问网络账号或执行真实动作。Moro 这里只做手动控制台，不会把工具自动交给角色聊天；但只要你点了工具调用，实际权限取决于 server 自身。stdio 命令尤其要确认来源可信。
                  </p>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

      <p className="mt-3 text-[10px] leading-relaxed text-[#26242a]/55">
        本地 stdio server 会以你填写的命令在电脑上运行；只连接可信 server。token、headers 和 env 只保存在本机 localStorage，完整备份不会包含 MCP 控制台配置。
      </p>
    </div>
  );
};

export default McpConsole;
