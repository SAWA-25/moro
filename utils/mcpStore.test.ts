import { describe, expect, it } from 'vitest';
import {
  MCP_SERVERS_STORAGE_KEY,
  createDefaultMcpServer,
  duplicateMcpServer,
  exportMcpServers,
  importMcpServersText,
  loadMcpServers,
  normalizeMcpServers,
  parseArgsText,
  parseJsonObjectText,
  parseRootsText,
  redactMcpServer,
  redactMcpValue,
  saveMcpServers,
  toGatewaySessionConfig,
} from './mcpStore';

const fakeStorage = () => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
    clear: () => data.clear(),
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    get length() { return data.size; },
  } as Storage;
};

describe('mcpStore', () => {
  it('normalizes server configs and avoids duplicate ids', () => {
    const servers = normalizeMcpServers([
      { id: 'same', name: 'A', transport: 'http', httpUrl: ' http://localhost/mcp ' },
      { id: 'same', name: 'B', transport: 'stdio', command: 'node' },
    ]);

    expect(servers).toHaveLength(2);
    expect(servers[0].id).toBe('same');
    expect(servers[1].id).not.toBe('same');
    expect(servers[0].httpUrl).toBe('http://localhost/mcp');
    expect(servers[1].transport).toBe('stdio');
  });

  it('parses headers, env, args and roots in friendly formats', () => {
    expect(parseJsonObjectText('Authorization: Bearer a\nFOO=bar', 'headers')).toEqual({
      Authorization: 'Bearer a',
      FOO: 'bar',
    });
    expect(parseJsonObjectText('{"A":1,"B":true}', 'env')).toEqual({ A: '1', B: 'true' });
    expect(parseArgsText('["server.mjs","--flag"]')).toEqual(['server.mjs', '--flag']);
    expect(parseArgsText('server.mjs --flag')).toEqual(['server.mjs', '--flag']);
    expect(parseRootsText('file:///tmp/a\nfile:///tmp/b')).toEqual([
      { uri: 'file:///tmp/a' },
      { uri: 'file:///tmp/b' },
    ]);
    expect(parseRootsText('[{"uri":"file:///tmp","name":"tmp"}]')).toEqual([
      { uri: 'file:///tmp', name: 'tmp' },
    ]);
  });

  it('migrates legacy storage and saves to v1 key', () => {
    const storage = fakeStorage();
    storage.setItem('moro.mcp.servers', JSON.stringify([{ id: 'old', name: 'Old MCP' }]));

    const loaded = loadMcpServers(storage);
    expect(loaded[0].id).toBe('old');
    expect(storage.getItem(MCP_SERVERS_STORAGE_KEY)).toContain('Old MCP');

    const saved = saveMcpServers([createDefaultMcpServer({ id: 'new', name: 'New MCP' })], storage);
    expect(saved[0].id).toBe('new');
    expect(storage.getItem(MCP_SERVERS_STORAGE_KEY)).toContain('New MCP');
  });

  it('builds gateway session config with opt-in client capabilities', () => {
    const server = createDefaultMcpServer({
      transport: 'stdio',
      command: 'node',
      argsText: '["fixture.mjs"]',
      envText: 'SECRET_TOKEN=abc',
      rootsEnabled: true,
      rootsText: '[{"uri":"file:///workspace","name":"workspace"}]',
      samplingEnabled: true,
      elicitationEnabled: true,
    });

    expect(toGatewaySessionConfig(server)).toMatchObject({
      transport: 'stdio',
      protocolVersion: '2025-11-25',
      capabilities: {
        roots: { listChanged: true },
        sampling: {},
        elicitation: {},
      },
      roots: [{ uri: 'file:///workspace', name: 'workspace' }],
      stdio: {
        command: 'node',
        args: ['fixture.mjs'],
        env: { SECRET_TOKEN: 'abc' },
      },
    });
  });

  it('duplicates configs and redacts secrets for logs and UI previews', () => {
    const server = createDefaultMcpServer({
      id: 'one',
      name: 'Main',
      gatewayToken: 'token',
      headersText: '{"Authorization":"Bearer abc"}',
      envText: '{"API_KEY":"abc"}',
    });
    const copy = duplicateMcpServer(server);

    expect(copy.id).not.toBe(server.id);
    expect(copy.name).toContain('副本');
    expect(redactMcpServer(server)).toMatchObject({
      gatewayToken: '<redacted>',
      headersText: '<redacted>',
      envText: '<redacted>',
    });
    expect(redactMcpValue({ nested: { apiKey: 'abc', visible: 'ok' } })).toEqual({
      nested: { apiKey: '<redacted>', visible: 'ok' },
    });
  });

  it('exports configs without secrets by default and imports payloads back', () => {
    const server = createDefaultMcpServer({
      id: 'export-one',
      name: 'Exported',
      gatewayToken: 'secret-token',
      headersText: '{"Authorization":"Bearer abc"}',
      envText: '{"API_KEY":"abc"}',
    });

    const safeExport = exportMcpServers([server]);
    expect(safeExport).toContain('"kind": "moro.mcp.servers"');
    expect(safeExport).not.toContain('secret-token');
    expect(safeExport).not.toContain('Bearer abc');
    expect(safeExport).not.toContain('API_KEY');

    const imported = importMcpServersText(safeExport);
    expect(imported).toHaveLength(1);
    expect(imported[0]).toMatchObject({
      id: 'export-one',
      name: 'Exported',
      gatewayToken: '',
      headersText: '',
      envText: '',
    });

    const secretExport = exportMcpServers([server], { includeSecrets: true });
    expect(secretExport).toContain('secret-token');
    expect(importMcpServersText(secretExport)[0].gatewayToken).toBe('secret-token');
  });

  it('imports a raw server array for quick hand-edited configs', () => {
    const imported = importMcpServersText(JSON.stringify([
      { id: 'raw-one', name: 'Raw', transport: 'http', httpUrl: 'http://localhost/mcp' },
    ]));

    expect(imported).toHaveLength(1);
    expect(imported[0]).toMatchObject({
      id: 'raw-one',
      name: 'Raw',
      httpUrl: 'http://localhost/mcp',
    });
  });
});
