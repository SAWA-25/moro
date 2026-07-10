#!/usr/bin/env node
/**
 * Moro MCP Gateway
 *
 * Usage:
 *   node scripts/mcp-gateway.mjs --port 18062 --token <token>
 *   node scripts/mcp-gateway.mjs --port 18062
 *
 * The gateway binds 127.0.0.1 only. Every non-OPTIONS request must include:
 *   x-moro-mcp-token: <token>
 */

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const MCP_PROTOCOL_VERSION = '2025-11-25';
const MCP_LEGACY_PROTOCOL_VERSION = '2024-11-05';
const HOST = '127.0.0.1';

const args = process.argv.slice(2);
const getArg = (name, fallback = '') => {
  const idx = args.indexOf(name);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
};

const PORT = Number.parseInt(getArg('--port', '18062'), 10);
const TOKEN = getArg('--token', '') || randomBytes(24).toString('hex');
const TOKEN_WAS_GENERATED = !args.includes('--token');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, x-moro-mcp-token, MCP-Protocol-Version, Mcp-Session-Id, Authorization',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id, MCP-Protocol-Version',
  'Access-Control-Max-Age': '86400',
};

const sessions = new Map();

const jsonHeaders = (extra = {}) => ({
  ...CORS_HEADERS,
  'Content-Type': 'application/json; charset=utf-8',
  ...extra,
});

const textHeaders = (extra = {}) => ({
  ...CORS_HEADERS,
  'Content-Type': 'text/plain; charset=utf-8',
  ...extra,
});

const redactKeyPattern = /(api[-_]?key|authorization|bearer|token|secret|cookie|password|env|headers)$/i;

const redactValue = (value) => {
  if (Array.isArray(value)) return value.map(redactValue);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = redactKeyPattern.test(key) ? '<redacted>' : redactValue(item);
  }
  return out;
};

const sendJson = (res, status, payload, extraHeaders = {}) => {
  res.writeHead(status, jsonHeaders(extraHeaders));
  res.end(JSON.stringify(payload, null, 2));
};

const sendText = (res, status, text) => {
  res.writeHead(status, textHeaders());
  res.end(text);
};

const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  req.on('error', reject);
});

const parseBody = async (req) => {
  const text = await readBody(req);
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch (error) {
    error.statusCode = 400;
    error.exposeMessage = 'Request body must be valid JSON';
    throw error;
  }
};

const newId = () => `gw_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;

const enqueueEvent = (session, event) => {
  const payload = {
    id: ++session.eventSeq,
    time: new Date().toISOString(),
    ...event,
  };
  session.events.push(payload);
  if (session.events.length > 500) session.events.splice(0, session.events.length - 500);
  for (const client of session.sseClients) {
    client.write(`event: ${payload.type || 'event'}\n`);
    client.write(`data: ${JSON.stringify(payload)}\n\n`);
  }
};

const jsonRpcError = (id, code, message, data) => ({
  jsonrpc: '2.0',
  id: id ?? null,
  error: { code, message, ...(data === undefined ? {} : { data }) },
});

const jsonRpcResult = (id, result) => ({
  jsonrpc: '2.0',
  id,
  result,
});

const writeStdioMessage = (session, message) => {
  if (!session.process || session.process.killed) {
    throw new Error('stdio process is not running');
  }
  session.process.stdin.write(`${JSON.stringify(message)}\n`);
};

const handleServerInitiatedRequest = (session, message) => {
  enqueueEvent(session, { type: 'server-request', data: message });

  if (message.method === 'roots/list') {
    writeStdioMessage(session, jsonRpcResult(message.id, { roots: session.roots || [] }));
    return;
  }

  if (message.method === 'sampling/createMessage') {
    if (!session.capabilities?.sampling) {
      writeStdioMessage(session, jsonRpcError(message.id, -32000, 'Moro MCP Gateway: sampling is disabled for this server'));
      return;
    }
    session.pendingServerRequests.set(String(message.id), message);
    enqueueEvent(session, {
      type: 'pending-server-request',
      data: {
        id: message.id,
        method: message.method,
        hint: 'Use method moro.gateway/respond on /request to send a manual JSON-RPC response.',
      },
    });
    return;
  }

  if (message.method === 'elicitation/create') {
    if (!session.capabilities?.elicitation) {
      writeStdioMessage(session, jsonRpcError(message.id, -32000, 'Moro MCP Gateway: elicitation is disabled for this server'));
      return;
    }
    session.pendingServerRequests.set(String(message.id), message);
    enqueueEvent(session, {
      type: 'pending-server-request',
      data: {
        id: message.id,
        method: message.method,
        hint: 'Use method moro.gateway/respond on /request to send a manual JSON-RPC response.',
      },
    });
    return;
  }

  writeStdioMessage(session, jsonRpcError(message.id, -32601, `Unsupported server-initiated request: ${message.method}`));
};

const processStdioLine = (session, line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    enqueueEvent(session, { type: 'stdout', data: trimmed });
    return;
  }

  if (message && typeof message === 'object' && 'id' in message && (message.result !== undefined || message.error !== undefined)) {
    const key = String(message.id);
    const pending = session.pendingClientRequests.get(key);
    if (pending) {
      clearTimeout(pending.timer);
      session.pendingClientRequests.delete(key);
      pending.resolve(message);
      return;
    }
  }

  if (message && typeof message === 'object' && message.method && 'id' in message) {
    try {
      handleServerInitiatedRequest(session, message);
    } catch (error) {
      enqueueEvent(session, { type: 'gateway-error', data: { message: error?.message || String(error) } });
    }
    return;
  }

  enqueueEvent(session, {
    type: message?.method ? 'notification' : 'stdout-json',
    data: message,
  });
};

const spawnStdioSession = (session) => {
  const stdio = session.stdio;
  if (!stdio?.command) throw new Error('stdio command is required');

  const child = spawn(stdio.command, stdio.args || [], {
    cwd: stdio.cwd || process.cwd(),
    env: { ...process.env, ...(stdio.env || {}) },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  session.process = child;
  session.stdoutBuffer = '';
  session.stderrBuffer = '';

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    session.stdoutBuffer += chunk;
    let idx;
    while ((idx = session.stdoutBuffer.indexOf('\n')) >= 0) {
      const line = session.stdoutBuffer.slice(0, idx);
      session.stdoutBuffer = session.stdoutBuffer.slice(idx + 1);
      processStdioLine(session, line);
    }
  });

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    session.stderrBuffer += chunk;
    const lines = session.stderrBuffer.split(/\r?\n/);
    session.stderrBuffer = lines.pop() || '';
    for (const line of lines) {
      if (line.trim()) enqueueEvent(session, { type: 'stderr', data: line });
    }
  });

  child.on('error', (error) => {
    enqueueEvent(session, { type: 'process-error', data: { message: error?.message || String(error) } });
    for (const pending of session.pendingClientRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    session.pendingClientRequests.clear();
  });

  child.on('exit', (code, signal) => {
    enqueueEvent(session, { type: 'process-exit', data: { code, signal } });
    session.closed = true;
    if (session.stderrBuffer.trim()) enqueueEvent(session, { type: 'stderr', data: session.stderrBuffer.trim() });
    for (const pending of session.pendingClientRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`stdio process exited (${code ?? signal ?? 'unknown'})`));
    }
    session.pendingClientRequests.clear();
  });

  enqueueEvent(session, {
    type: 'process-start',
    data: {
      command: stdio.command,
      args: stdio.args || [],
      cwd: stdio.cwd || process.cwd(),
      env: redactValue(stdio.env || {}),
    },
  });
};

const createSession = (config) => {
  const transport = config.transport === 'stdio' ? 'stdio' : 'http';
  const id = newId();
  const session = {
    id,
    transport,
    protocolVersion: config.protocolVersion || MCP_PROTOCOL_VERSION,
    clientInfo: config.clientInfo || { name: 'Moro-McpGateway', version: '1.0.0' },
    capabilities: config.capabilities || {},
    roots: Array.isArray(config.roots) ? config.roots : [],
    http: config.http || null,
    stdio: config.stdio || null,
    upstreamSessionId: null,
    pendingClientRequests: new Map(),
    pendingServerRequests: new Map(),
    events: [],
    sseClients: new Set(),
    eventSeq: 0,
    createdAt: new Date().toISOString(),
    closed: false,
  };

  if (transport === 'http' && !session.http?.url) {
    throw new Error('http.url is required');
  }
  if (transport === 'stdio') {
    spawnStdioSession(session);
  }

  sessions.set(id, session);
  enqueueEvent(session, {
    type: 'session-created',
    data: {
      id,
      transport,
      protocolVersion: session.protocolVersion,
      clientInfo: session.clientInfo,
      capabilities: session.capabilities,
      roots: session.roots,
      http: session.http ? { url: session.http.url, headers: redactValue(session.http.headers || {}) } : undefined,
      stdio: session.stdio ? {
        command: session.stdio.command,
        args: session.stdio.args || [],
        cwd: session.stdio.cwd,
        env: redactValue(session.stdio.env || {}),
      } : undefined,
    },
  });
  return session;
};

const deleteSession = (session) => {
  session.closed = true;
  for (const client of session.sseClients) {
    client.end();
  }
  session.sseClients.clear();
  if (session.process && !session.process.killed) {
    session.process.kill();
  }
  for (const pending of session.pendingClientRequests.values()) {
    clearTimeout(pending.timer);
    pending.reject(new Error('session closed'));
  }
  session.pendingClientRequests.clear();
  sessions.delete(session.id);
};

const makeProtocolHeaders = (session, legacy = false) => {
  const headers = {
    Accept: 'application/json, text/event-stream',
    'Content-Type': 'application/json',
    ...(session.http?.headers || {}),
  };
  if (!legacy) headers['MCP-Protocol-Version'] = session.protocolVersion || MCP_PROTOCOL_VERSION;
  if (legacy) headers['MCP-Protocol-Version'] = MCP_LEGACY_PROTOCOL_VERSION;
  if (session.upstreamSessionId) headers['Mcp-Session-Id'] = session.upstreamSessionId;
  return headers;
};

const collectHeaders = (headers) => Object.fromEntries(headers.entries());

const forwardHttpRequestOnce = async (session, body, legacy = false) => {
  const resp = await fetch(session.http.url, {
    method: 'POST',
    headers: makeProtocolHeaders(session, legacy),
    body: JSON.stringify(body),
  });
  const text = await resp.text().catch(() => '');
  const sessionId = resp.headers.get('Mcp-Session-Id') || resp.headers.get('mcp-session-id');
  if (sessionId) session.upstreamSessionId = sessionId;
  return {
    status: resp.status,
    contentType: resp.headers.get('content-type') || '',
    text,
    headers: collectHeaders(resp.headers),
    sessionId: session.upstreamSessionId,
  };
};

const withLegacyInitializeFallback = (body) => ({
  ...body,
  params: {
    ...(body.params || {}),
    protocolVersion: MCP_LEGACY_PROTOCOL_VERSION,
  },
});

const forwardHttpRequest = async (session, body) => {
  let envelope = await forwardHttpRequestOnce(session, body, false);
  if (
    body?.method === 'initialize'
    && [400, 404, 405].includes(envelope.status)
  ) {
    enqueueEvent(session, {
      type: 'legacy-fallback',
      data: { status: envelope.status, protocolVersion: MCP_LEGACY_PROTOCOL_VERSION },
    });
    envelope = await forwardHttpRequestOnce(session, withLegacyInitializeFallback(body), true);
  }
  enqueueEvent(session, {
    type: 'http-response',
    data: {
      status: envelope.status,
      contentType: envelope.contentType,
      sessionId: envelope.sessionId,
      textPreview: envelope.text.slice(0, 1200),
    },
  });
  return envelope;
};

const stdioRequest = async (session, body) => {
  if (body?.method === 'moro.gateway/respond') {
    const id = body.params?.id;
    if (id === undefined || id === null) throw new Error('moro.gateway/respond requires params.id');
    const pending = session.pendingServerRequests.get(String(id));
    if (!pending) throw new Error(`No pending server request for id ${id}`);
    session.pendingServerRequests.delete(String(id));
    const response = body.params?.error
      ? jsonRpcError(id, Number(body.params.error.code) || -32000, String(body.params.error.message || 'Manual MCP error'), body.params.error.data)
      : jsonRpcResult(id, body.params?.result ?? {});
    writeStdioMessage(session, response);
    return {
      status: 200,
      contentType: 'application/json',
      text: JSON.stringify(jsonRpcResult(body.id ?? null, { ok: true })),
      headers: {},
      sessionId: session.id,
    };
  }

  if (!('id' in body)) {
    writeStdioMessage(session, body);
    enqueueEvent(session, { type: 'client-request', data: redactValue(body) });
    return {
      status: 202,
      contentType: 'application/json',
      text: '',
      headers: {},
      sessionId: session.id,
    };
  }

  const responsePromise = new Promise((resolve, reject) => {
    const key = String(body.id);
    const timer = setTimeout(() => {
      session.pendingClientRequests.delete(key);
      reject(new Error(`MCP stdio request timed out: ${body.method || key}`));
    }, 60_000);
    session.pendingClientRequests.set(key, { resolve, reject, timer });
  });

  try {
    writeStdioMessage(session, body);
    enqueueEvent(session, { type: 'client-request', data: redactValue(body) });
  } catch (error) {
    const pending = session.pendingClientRequests.get(String(body.id));
    if (pending) {
      clearTimeout(pending.timer);
      session.pendingClientRequests.delete(String(body.id));
    }
    throw error;
  }

  const response = await responsePromise;

  return {
    status: 200,
    contentType: 'application/json',
    text: JSON.stringify(response),
    headers: {},
    sessionId: session.id,
  };
};

const handleEvents = (req, res, session) => {
  const accept = String(req.headers.accept || '');
  if (/text\/event-stream/i.test(accept)) {
    res.writeHead(200, {
      ...CORS_HEADERS,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    });
    for (const event of session.events) {
      res.write(`event: ${event.type || 'event'}\n`);
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
    session.sseClients.add(res);
    req.on('close', () => session.sseClients.delete(res));
    return;
  }

  const since = Number(new URL(req.url, `http://${HOST}:${PORT}`).searchParams.get('since') || 0);
  sendJson(res, 200, {
    events: session.events.filter(event => event.id > since),
    pendingServerRequests: Array.from(session.pendingServerRequests.values()),
  });
};

const route = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  if (req.headers['x-moro-mcp-token'] !== TOKEN) {
    sendJson(res, 401, { error: 'missing or invalid x-moro-mcp-token' });
    return;
  }

  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (path === '/health' && req.method === 'GET') {
    sendJson(res, 200, {
      ok: true,
      protocolVersion: MCP_PROTOCOL_VERSION,
      sessions: sessions.size,
    });
    return;
  }

  if (path === '/sessions' && req.method === 'GET') {
    sendJson(res, 200, {
      sessions: Array.from(sessions.values()).map((session) => ({
        id: session.id,
        transport: session.transport,
        createdAt: session.createdAt,
        closed: session.closed,
        upstreamSessionId: session.upstreamSessionId,
        events: session.events.length,
      })),
    });
    return;
  }

  if (path === '/sessions' && req.method === 'POST') {
    const config = await parseBody(req);
    const session = createSession(config);
    sendJson(res, 201, {
      id: session.id,
      transport: session.transport,
      createdAt: session.createdAt,
    });
    return;
  }

  const match = path.match(/^\/sessions\/([^/]+)(?:\/(request|events))?$/);
  if (!match) {
    sendJson(res, 404, { error: 'not found' });
    return;
  }

  const session = sessions.get(decodeURIComponent(match[1]));
  if (!session) {
    sendJson(res, 404, { error: 'session not found' });
    return;
  }

  const action = match[2] || '';
  if (!action && req.method === 'DELETE') {
    deleteSession(session);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (action === 'events' && req.method === 'GET') {
    handleEvents(req, res, session);
    return;
  }

  if (action === 'request' && req.method === 'POST') {
    const body = await parseBody(req);
    const envelope = session.transport === 'stdio'
      ? await stdioRequest(session, body)
      : await forwardHttpRequest(session, body);
    sendJson(res, 200, envelope, envelope.sessionId ? { 'Mcp-Session-Id': envelope.sessionId } : {});
    return;
  }

  sendJson(res, 405, { error: 'method not allowed' });
};

const server = createServer((req, res) => {
  route(req, res).catch((error) => {
    const status = error?.statusCode || 500;
    sendJson(res, status, {
      error: error?.exposeMessage || error?.message || String(error),
    });
  });
});

server.listen(PORT, HOST, () => {
  console.log('Moro MCP Gateway started');
  console.log(`  URL:   http://${HOST}:${PORT}`);
  console.log(`  Token: ${TOKEN}`);
  if (TOKEN_WAS_GENERATED) {
    console.log('');
    console.log('A temporary token was generated. Paste it into 文具盒 → MCP 控制台.');
  }
  console.log('');
  console.log('Health check:');
  console.log(`  curl -H "x-moro-mcp-token: ${TOKEN}" http://${HOST}:${PORT}/health`);
});

process.on('SIGINT', () => {
  for (const session of Array.from(sessions.values())) deleteSession(session);
  server.close(() => process.exit(0));
});
