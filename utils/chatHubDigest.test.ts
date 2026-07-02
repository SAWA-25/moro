import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildChatHubV2ContextBlock, fallbackChatHubDigest, generateChatHubDigest } from './chatHubDigest';
import type { ChatTimelineItem } from './chatTimeline';
import type { ResolvedApi } from './auxApi';

const api: ResolvedApi = { baseUrl: 'https://example.test/v1', apiKey: 'k', model: 'm' };
const item: ChatTimelineItem = {
  id: 'private:1',
  source: 'private',
  kind: 'text',
  targetId: 'c1',
  title: '阿迟 发来消息',
  summary: '今天雨很大',
  at: 100,
  weight: 70,
};

function response(content: string) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }),
  } as unknown as Response;
}

afterEach(() => vi.restoreAllMocks());

describe('chatHubDigest', () => {
  it('builds a local fallback digest', () => {
    const digest = fallbackChatHubDigest({ items: [item], date: '2026-07-03', now: 1000 });

    expect(digest.id).toBe('chat_digest_2026-07-03');
    expect(digest.highlights[0]).toContain('今天雨很大');
  });

  it('uses LLM JSON when available', async () => {
    global.fetch = vi.fn(async () => response('{"summary":"今天有一条雨天线索。","highlights":["阿迟提到了雨。"]}')) as unknown as typeof fetch;

    const digest = await generateChatHubDigest({ api, items: [item], date: '2026-07-03', now: 1000 });

    expect(digest.summary).toBe('今天有一条雨天线索。');
    expect(digest.highlights).toEqual(['阿迟提到了雨。']);
  });

  it('falls back when LLM fails', async () => {
    global.fetch = vi.fn(async () => { throw new Error('network'); }) as unknown as typeof fetch;

    const digest = await generateChatHubDigest({ api, items: [item], date: '2026-07-03', now: 1000 });

    expect(digest.summary).toContain('絮语');
    expect(digest.highlights.length).toBeGreaterThan(0);
  });

  it('creates a compact context block from open followups and digest', () => {
    const block = buildChatHubV2ContextBlock({
      followups: [{ id: 'f', source: 'manual', targetKind: 'char', targetId: 'c1', title: '回阿迟', status: 'open', createdAt: 1, updatedAt: 1 }],
      digest: { id: 'd', date: '2026-07-03', range: { from: 0, to: 1 }, sourceItemIds: [], summary: '今天有雨天线索。', highlights: [], createdAt: 1 },
      relationshipHints: ['朋友：刚缓和'],
    });

    expect(block).toContain('絮语总览轻线索');
    expect(block).toContain('不要逐条汇报');
    expect(block).toContain('回阿迟');
  });
});
