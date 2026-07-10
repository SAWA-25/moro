export const MCP_SERVERS_STORAGE_KEY = 'moro.mcp.servers.v1';
const LEGACY_MCP_SERVERS_STORAGE_KEY = 'moro.mcp.servers';

export type McpServerTransport = 'http' | 'stdio';

export interface McpServerConfig {
  id: string;
  name: string;
  enabled: boolean;
  transport: McpServerTransport;
  gatewayUrl: string;
  gatewayToken: string;
  httpUrl: string;
  headersText: string;
  command: string;
  argsText: string;
  cwd: string;
  envText: string;
  rootsEnabled: boolean;
  rootsText: string;
  samplingEnabled: boolean;
  elicitationEnabled: boolean;
  loggingLevel: 'debug' | 'info' | 'notice' | 'warning' | 'error' | 'critical' | 'alert' | 'emergency';
  createdAt: number;
  updatedAt: number;
}

export interface McpGatewaySessionConfig {
  transport: McpServerTransport;
  protocolVersion: string;
  clientInfo: { name: string; version: string };
  capabilities: Record<string, any>;
  roots?: Array<{ uri: string; name?: string }>;
  http?: {
    url: string;
    headers: Record<string, string>;
  };
  stdio?: {
    command: string;
    args: string[];
    cwd?: string;
    env: Record<string, string>;
  };
}

export interface McpServersExportPayload {
  kind: 'moro.mcp.servers';
  version: 1;
  exportedAt: string;
  includeSecrets: boolean;
  servers: McpServerConfig[];
}

const SECRET_KEY_PATTERN = /(api[-_]?key|authorization|bearer|token|secret|cookie|password|env|headers)$/i;

const now = () => Date.now();

const createId = () => `mcp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export const createDefaultMcpServer = (patch: Partial<McpServerConfig> = {}): McpServerConfig => {
  const ts = now();
  return {
    id: createId(),
    name: '本地 MCP',
    enabled: true,
    transport: 'http',
    gatewayUrl: 'http://127.0.0.1:18062',
    gatewayToken: '',
    httpUrl: 'http://127.0.0.1:18060/mcp',
    headersText: '',
    command: '',
    argsText: '[]',
    cwd: '',
    envText: '{}',
    rootsEnabled: false,
    rootsText: '[]',
    samplingEnabled: false,
    elicitationEnabled: false,
    loggingLevel: 'info',
    createdAt: ts,
    updatedAt: ts,
    ...patch,
  };
};

const normalizeServer = (value: any): McpServerConfig | null => {
  if (!value || typeof value !== 'object') return null;
  const base = createDefaultMcpServer();
  const transport = value.transport === 'stdio' ? 'stdio' : 'http';
  const loggingLevel = ['debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency'].includes(value.loggingLevel)
    ? value.loggingLevel
    : 'info';
  return {
    ...base,
    ...value,
    id: typeof value.id === 'string' && value.id.trim() ? value.id : createId(),
    name: typeof value.name === 'string' && value.name.trim() ? value.name : base.name,
    enabled: value.enabled !== false,
    transport,
    gatewayUrl: typeof value.gatewayUrl === 'string' && value.gatewayUrl.trim() ? value.gatewayUrl.trim() : base.gatewayUrl,
    gatewayToken: typeof value.gatewayToken === 'string' ? value.gatewayToken : '',
    httpUrl: typeof value.httpUrl === 'string' ? value.httpUrl.trim() : '',
    headersText: typeof value.headersText === 'string' ? value.headersText : '',
    command: typeof value.command === 'string' ? value.command.trim() : '',
    argsText: typeof value.argsText === 'string' ? value.argsText : '[]',
    cwd: typeof value.cwd === 'string' ? value.cwd.trim() : '',
    envText: typeof value.envText === 'string' ? value.envText : '{}',
    rootsEnabled: value.rootsEnabled === true,
    rootsText: typeof value.rootsText === 'string' ? value.rootsText : '[]',
    samplingEnabled: value.samplingEnabled === true,
    elicitationEnabled: value.elicitationEnabled === true,
    loggingLevel,
    createdAt: Number(value.createdAt) || base.createdAt,
    updatedAt: Number(value.updatedAt) || base.updatedAt,
  };
};

export const normalizeMcpServers = (value: unknown): McpServerConfig[] => {
  if (!Array.isArray(value)) return [];
  const out: McpServerConfig[] = [];
  const ids = new Set<string>();
  for (const item of value) {
    const normalized = normalizeServer(item);
    if (!normalized) continue;
    if (ids.has(normalized.id)) normalized.id = createId();
    ids.add(normalized.id);
    out.push(normalized);
  }
  return out;
};

const browserStorage = (): Storage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

export const loadMcpServers = (storage: Storage | null = browserStorage()): McpServerConfig[] => {
  if (!storage) return [];
  try {
    const raw = storage.getItem(MCP_SERVERS_STORAGE_KEY);
    if (raw) return normalizeMcpServers(JSON.parse(raw));
    const legacy = storage.getItem(LEGACY_MCP_SERVERS_STORAGE_KEY);
    if (!legacy) return [];
    const migrated = normalizeMcpServers(JSON.parse(legacy));
    if (migrated.length) storage.setItem(MCP_SERVERS_STORAGE_KEY, JSON.stringify(migrated));
    return migrated;
  } catch {
    return [];
  }
};

export const saveMcpServers = (
  servers: McpServerConfig[],
  storage: Storage | null = browserStorage(),
): McpServerConfig[] => {
  const normalized = normalizeMcpServers(servers);
  if (!storage) return normalized;
  try {
    storage.setItem(MCP_SERVERS_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Storage can be blocked; UI keeps in-memory state.
  }
  return normalized;
};

export const duplicateMcpServer = (server: McpServerConfig): McpServerConfig => createDefaultMcpServer({
  ...server,
  id: createId(),
  name: `${server.name || 'MCP'} 副本`,
  createdAt: now(),
  updatedAt: now(),
});

export const stripMcpServerSecrets = (server: McpServerConfig): McpServerConfig => ({
  ...server,
  gatewayToken: '',
  headersText: '',
  envText: '',
});

export const exportMcpServers = (
  servers: McpServerConfig[],
  options: { includeSecrets?: boolean } = {},
): string => {
  const normalized = normalizeMcpServers(servers);
  const includeSecrets = options.includeSecrets === true;
  const payload: McpServersExportPayload = {
    kind: 'moro.mcp.servers',
    version: 1,
    exportedAt: new Date().toISOString(),
    includeSecrets,
    servers: includeSecrets ? normalized : normalized.map(stripMcpServerSecrets),
  };
  return JSON.stringify(payload, null, 2);
};

export const importMcpServersText = (text: string): McpServerConfig[] => {
  const trimmed = (text || '').trim();
  if (!trimmed) throw new Error('MCP 配置为空');
  let parsed: any;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error('MCP 配置必须是 JSON');
  }
  const rawServers = Array.isArray(parsed) ? parsed : parsed?.servers;
  if (!Array.isArray(rawServers)) {
    throw new Error('MCP 配置需要包含 servers 数组');
  }
  const normalized = normalizeMcpServers(rawServers);
  if (!normalized.length) throw new Error('没有可导入的 MCP server');
  return normalized;
};

export const parseJsonObjectText = (text: string, label: string): Record<string, string> => {
  const trimmed = (text || '').trim();
  if (!trimmed) return {};
  let parsed: any;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // Also accept header/env line format:
    // Authorization: Bearer xxx
    // FOO=bar
    const out: Record<string, string> = {};
    for (const rawLine of trimmed.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const splitAt = line.includes(':') ? line.indexOf(':') : line.indexOf('=');
      if (splitAt <= 0) throw new Error(`${label} 需要 JSON 对象，或每行 key: value / key=value`);
      const key = line.slice(0, splitAt).trim();
      const value = line.slice(splitAt + 1).trim();
      if (key) out[key] = value;
    }
    return out;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} 必须是 JSON 对象`);
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!key) continue;
    if (value == null) continue;
    out[key] = String(value);
  }
  return out;
};

export const parseArgsText = (text: string): string[] => {
  const trimmed = (text || '').trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) throw new Error('stdio args 必须是 JSON 字符串数组');
    return parsed.map(item => String(item));
  }
  return trimmed.split(/\s+/).filter(Boolean);
};

export const parseRootsText = (text: string): Array<{ uri: string; name?: string }> => {
  const trimmed = (text || '').trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) throw new Error('roots 必须是 JSON 数组，或每行一个 URI');
    return parsed
      .map((item) => {
        if (typeof item === 'string') return { uri: item };
        if (item && typeof item === 'object' && typeof item.uri === 'string') {
          return { uri: item.uri, ...(typeof item.name === 'string' ? { name: item.name } : {}) };
        }
        return null;
      })
      .filter(Boolean) as Array<{ uri: string; name?: string }>;
  }
  return trimmed
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(uri => ({ uri }));
};

export const toGatewaySessionConfig = (server: McpServerConfig): McpGatewaySessionConfig => {
  const roots = server.rootsEnabled ? parseRootsText(server.rootsText) : [];
  const capabilities: Record<string, any> = {};
  if (server.rootsEnabled) capabilities.roots = { listChanged: true };
  if (server.samplingEnabled) capabilities.sampling = {};
  if (server.elicitationEnabled) capabilities.elicitation = {};
  const base: McpGatewaySessionConfig = {
    transport: server.transport,
    protocolVersion: '2025-11-25',
    clientInfo: { name: 'Moro-McpConsole', version: '1.0.0' },
    capabilities,
    ...(roots.length ? { roots } : {}),
  };
  if (server.transport === 'http') {
    return {
      ...base,
      http: {
        url: server.httpUrl.trim(),
        headers: parseJsonObjectText(server.headersText, 'HTTP headers'),
      },
    };
  }
  return {
    ...base,
    stdio: {
      command: server.command.trim(),
      args: parseArgsText(server.argsText),
      cwd: server.cwd.trim() || undefined,
      env: parseJsonObjectText(server.envText, 'stdio env'),
    },
  };
};

export const redactMcpValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redactMcpValue);
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_KEY_PATTERN.test(key) ? '<redacted>' : redactMcpValue(item);
  }
  return out;
};

export const redactMcpServer = (server: McpServerConfig): McpServerConfig => ({
  ...server,
  gatewayToken: server.gatewayToken ? '<redacted>' : '',
  headersText: server.headersText ? '<redacted>' : '',
  envText: server.envText ? '<redacted>' : '',
});
