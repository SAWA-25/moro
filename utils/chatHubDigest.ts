import type { APIConfig, ChatFollowup, ChatHubDigest } from '../types';
import type { ResolvedApi } from './auxApi';
import { llmComplete } from './llmComplete';
import { makeApiUsageMeta } from './apiUsageCatalog';
import type { ChatTimelineItem } from './chatTimeline';

const ymd = (ts = Date.now()) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const clip = (value: unknown, limit = 180): string => {
  const clean = String(value ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > limit ? `${clean.slice(0, limit)}...` : clean;
};

const parseDigestJson = (raw: string): { summary: string; highlights: string[] } | null => {
  const clean = String(raw || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  const first = clean.indexOf('{');
  const last = clean.lastIndexOf('}');
  if (first < 0 || last < first) return null;
  try {
    const parsed = JSON.parse(clean.slice(first, last + 1));
    const summary = clip(parsed.summary || parsed.text || '', 220);
    const highlights = Array.isArray(parsed.highlights)
      ? parsed.highlights.map((item: unknown) => clip(item, 80)).filter(Boolean).slice(0, 5)
      : [];
    if (!summary && highlights.length === 0) return null;
    return { summary: summary || highlights.join('；'), highlights };
  } catch {
    return null;
  }
};

export function fallbackChatHubDigest(input: {
  items: ChatTimelineItem[];
  date?: string;
  now?: number;
}): ChatHubDigest {
  const now = input.now || Date.now();
  const date = input.date || ymd(now);
  const items = input.items.slice(0, 8);
  const highlights = items.slice(0, 5).map(item => `${item.title}：${item.summary}`);
  return {
    id: `chat_digest_${date}`,
    date,
    range: {
      from: new Date(new Date(now).getFullYear(), new Date(now).getMonth(), new Date(now).getDate()).getTime(),
      to: now,
    },
    sourceItemIds: items.map(item => item.id),
    summary: highlights.length
      ? `今天絮语里有 ${highlights.length} 条值得回看的线索，先从未处理和关系变化看起。`
      : '今天絮语还很安静，没有需要特别处理的线索。',
    highlights,
    createdAt: now,
  };
}

export async function generateChatHubDigest(input: {
  api?: ResolvedApi | APIConfig | null;
  items: ChatTimelineItem[];
  date?: string;
  now?: number;
}): Promise<ChatHubDigest> {
  const now = input.now || Date.now();
  const date = input.date || ymd(now);
  const fallback = fallbackChatHubDigest({ items: input.items, date, now });
  const api = input.api;
  if (!api?.baseUrl || !api?.apiKey || !api?.model || input.items.length === 0) return fallback;

  const lines = input.items.slice(0, 18).map((item, idx) => (
    `${idx + 1}. [${item.source}/${item.kind}] ${item.title}：${item.summary}`
  )).join('\n');

  try {
    const raw = await llmComplete(api as ResolvedApi, [
      {
        role: 'system',
        content: '你是 Moro「絮语总览」的今日摘要助手。只输出 JSON，不要 Markdown。总结要克制、具体、面向普通用户，不要替用户做重大关系判断。',
      },
      {
        role: 'user',
        content: `请基于这些絮语事件生成今日摘要。\n日期：${date}\n事件：\n${lines}\n\nJSON 格式：{"summary":"80字以内","highlights":["最多5条，每条60字以内"]}`,
      },
    ], {
      temperature: 0.55,
      maxTokens: 360,
      meta: makeApiUsageMeta('chat.dashboard.digest', { apiRole: 'aux', isBackgroundTask: true }),
    });
    const parsed = parseDigestJson(raw);
    if (!parsed) return fallback;
    return {
      ...fallback,
      summary: parsed.summary,
      highlights: parsed.highlights.length ? parsed.highlights : fallback.highlights,
    };
  } catch {
    return fallback;
  }
}

export function buildChatHubV2ContextBlock(input: {
  followups?: ChatFollowup[];
  digest?: ChatHubDigest | null;
  relationshipHints?: string[];
  maxLines?: number;
}): string {
  const maxLines = input.maxLines || 6;
  const lines: string[] = [];
  (input.followups || [])
    .filter(item => item.status === 'open')
    .slice(0, 3)
    .forEach(item => lines.push(`- 待回看：${item.title}${item.note ? `（${clip(item.note, 54)}）` : ''}`));
  if (input.digest?.summary) lines.push(`- 今日总览：${clip(input.digest.summary, 90)}`);
  (input.relationshipHints || []).slice(0, 2).forEach(hint => lines.push(`- 关系线索：${clip(hint, 72)}`));
  if (!lines.length) return '';
  return [
    '### 絮语总览轻线索',
    '下面只是近期线索，帮助你自然承接；不要逐条汇报，不要强行提起，更不要催促用户处理。',
    ...lines.slice(0, maxLines),
  ].join('\n');
}
