import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

let gateway: ChildProcessWithoutNullStreams | null = null;
let tempDir = '';

const waitForOutput = (child: ChildProcessWithoutNullStreams, pattern: RegExp) => new Promise<void>((resolve, reject) => {
  let text = '';
  const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${pattern}`)), 5000);
  const onData = (chunk: Buffer) => {
    text += chunk.toString('utf8');
    if (pattern.test(text)) {
      clearTimeout(timer);
      child.stdout.off('data', onData);
      resolve();
    }
  };
  child.stdout.on('data', onData);
  child.once('exit', code => {
    clearTimeout(timer);
    reject(new Error(`Gateway exited before ready: ${code}`));
  });
});

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('scripts/mcp-gateway.mjs', () => {
  afterEach(() => {
    if (gateway && !gateway.killed) gateway.kill();
    gateway = null;
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = '';
  });

  it('requires token auth and proxies a stdio MCP server', async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'moro-mcp-gateway-'));
    const fixturePath = path.join(tempDir, 'fixture.mjs');
    writeFileSync(fixturePath, `
process.stdin.setEncoding('utf8');
let buffer = '';
const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n');
console.error('fixture stderr ready');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf('\\n')) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    const req = JSON.parse(line);
    if (req.method === 'initialize') {
      send({ jsonrpc: '2.0', id: req.id, result: {
        protocolVersion: req.params.protocolVersion,
        serverInfo: { name: 'fixture-mcp', version: '1.0.0' },
        capabilities: { tools: {}, resources: {}, prompts: {} },
        instructions: 'fixture instructions'
      } });
    } else if (req.method === 'tools/list') {
      send({ jsonrpc: '2.0', id: req.id, result: { tools: [{ name: 'echo', inputSchema: { type: 'object' } }] } });
    } else if (req.method === 'ping') {
      send({ jsonrpc: '2.0', id: req.id, result: {} });
    } else if (req.id !== undefined) {
      send({ jsonrpc: '2.0', id: req.id, result: { ok: true } });
    }
  }
});
`, 'utf8');

    const token = 'test-token';
    const port = 19062 + Math.floor(Math.random() * 1000);
    const gatewayPath = path.join(process.cwd(), 'scripts', 'mcp-gateway.mjs');
    gateway = spawn(process.execPath, [gatewayPath, '--port', String(port), '--token', token], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    await waitForOutput(gateway, /Moro MCP Gateway started/);

    const base = `http://127.0.0.1:${port}`;
    expect((await fetch(`${base}/health`)).status).toBe(401);

    const health = await fetch(`${base}/health`, { headers: { 'x-moro-mcp-token': token } });
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toMatchObject({ ok: true });

    const created = await fetch(`${base}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-moro-mcp-token': token },
      body: JSON.stringify({
        transport: 'stdio',
        protocolVersion: '2025-11-25',
        capabilities: {},
        stdio: {
          command: process.execPath,
          args: [fixturePath],
          env: {},
        },
      }),
    });
    expect(created.status).toBe(201);
    const { id } = await created.json() as { id: string };
    expect(id).toBeTruthy();

    const initEnvelope = await fetch(`${base}/sessions/${id}/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-moro-mcp-token': token },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0.0' },
        },
        id: 1,
      }),
    }).then(resp => resp.json());
    expect(JSON.parse(initEnvelope.text)).toMatchObject({
      id: 1,
      result: { serverInfo: { name: 'fixture-mcp' } },
    });

    const toolsEnvelope = await fetch(`${base}/sessions/${id}/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-moro-mcp-token': token },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 2 }),
    }).then(resp => resp.json());
    expect(JSON.parse(toolsEnvelope.text).result.tools[0].name).toBe('echo');

    await sleep(100);
    const events = await fetch(`${base}/sessions/${id}/events`, {
      headers: { 'x-moro-mcp-token': token },
    }).then(resp => resp.json()) as { events: Array<{ type: string }> };
    expect(events.events.some(event => event.type === 'process-start')).toBe(true);
    expect(events.events.some(event => event.type === 'stderr')).toBe(true);

    const deleted = await fetch(`${base}/sessions/${id}`, {
      method: 'DELETE',
      headers: { 'x-moro-mcp-token': token },
    });
    expect(deleted.status).toBe(200);
  });
});
