import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  MCP_PROTOCOL_VERSION,
  makeProtocolHeaders,
  parseMcpResponseText,
  parseSsePayloads,
  renderTransportContent,
  requestJsonRpcOverHttp,
  tryParseJson,
} from './mcpProtocol';

describe('mcpProtocol', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses multiple SSE events into JSON-RPC responses', () => {
    const sse = [
      'event: message',
      'data: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}',
      '',
      'event: notification',
      'data: {"jsonrpc":"2.0","method":"notifications/tools/list_changed"}',
      '',
    ].join('\n');

    expect(parseSsePayloads(sse)).toHaveLength(2);
    expect(parseMcpResponseText(sse, 'text/event-stream')).toEqual([
      { jsonrpc: '2.0', id: 1, result: { ok: true } },
      { jsonrpc: '2.0', method: 'notifications/tools/list_changed' },
    ]);
  });

  it('parses JSON wrapped in noisy text when a legacy server is loose', () => {
    expect(tryParseJson('prefix {"result":{"tools":[]}} suffix')).toEqual({ result: { tools: [] } });
  });

  it('builds MCP protocol headers with session id', () => {
    expect(makeProtocolHeaders('sid-1')).toMatchObject({
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
      'Mcp-Session-Id': 'sid-1',
    });
  });

  it('renders common MCP content types', () => {
    expect(renderTransportContent([{ type: 'text', text: '{"a":1}' }])[0]).toMatchObject({
      kind: 'text',
      text: '{"a":1}',
    });
    expect(renderTransportContent({ text: '{"a":1}' })[0]).toMatchObject({
      kind: 'json',
      json: { a: 1 },
    });
    expect(renderTransportContent({ type: 'resource', resource: { mimeType: 'text/plain', text: 'hello' } })[0]).toMatchObject({
      kind: 'blob',
      mimeType: 'text/plain',
      text: 'hello',
    });
    expect(renderTransportContent({ type: 'image', mimeType: 'image/png', data: 'abc' })[0]).toMatchObject({
      kind: 'image',
      mimeType: 'image/png',
      data: 'abc',
    });
  });

  it('returns response envelopes and preserves already-read error bodies', async () => {
    const fetchMock = vi.fn(async () => new Response('bad upstream', {
      status: 500,
      headers: { 'content-type': 'text/plain' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(requestJsonRpcOverHttp('http://example.test/mcp', {
      jsonrpc: '2.0',
      method: 'ping',
      id: 1,
    })).rejects.toThrow('bad upstream');
  });
});
