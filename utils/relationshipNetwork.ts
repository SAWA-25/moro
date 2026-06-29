import type {
  CharacterProfile,
  RelationshipNetworkAutoSettings,
  RelationshipNetworkEdge,
  RelationshipNetworkForwardDecision,
  RelationshipNetworkGenerationResult,
  RelationshipNetworkMessage,
  UserProfile,
} from '../types';
import type { ResolvedApi } from './auxApi';
import { llmComplete } from './llmComplete';
import { ContextBuilder } from './context';
import { WorldbookRuntime } from './worldbookRuntime';
import { DB } from './db';

export const RELATIONSHIP_NETWORK_UPDATED_EVENT = 'moro-relationship-network-updated';

const MINUTE = 60 * 1000;

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const clean = (value: unknown, fallback = '', max = 500) => {
  const s = typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
  return (s || fallback).slice(0, max);
};
const arr = (value: unknown, max = 6): string[] => Array.isArray(value)
  ? value.map(v => clean(v, '', 80)).filter(Boolean).slice(0, max)
  : [];

function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function extractJson(text: string): any | null {
  const raw = (text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try { return JSON.parse(raw); } catch {}
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(raw.slice(start, end + 1)); } catch {}
  }
  const aStart = raw.indexOf('[');
  const aEnd = raw.lastIndexOf(']');
  if (aStart >= 0 && aEnd > aStart) {
    try { return JSON.parse(raw.slice(aStart, aEnd + 1)); } catch {}
  }
  return null;
}

export function relationshipPairKey(a: string, b: string): string {
  const [x, y] = [a, b].sort();
  return `rn_${x}__${y}`;
}

export function relationshipPairIds(pairKey: string): [string, string] | null {
  const m = pairKey.match(/^rn_(.+)__(.+)$/);
  return m ? [m[1], m[2]] : null;
}

export function makeDefaultRelationshipNetworkAutoSettings(now = Date.now()): RelationshipNetworkAutoSettings {
  return {
    id: 'settings',
    enabled: false,
    selectedCharIds: [],
    intervalMinutes: 120,
    charCooldownMinutes: 180,
    pairCooldownMinutes: 360,
    nextRunAt: now + 120 * MINUTE,
    lastRunAtByChar: {},
    lastRunAtByPair: {},
    forwardedCountByPair: {},
    updatedAt: now,
  };
}

export function normalizeRelationshipNetworkSettings(
  input?: Partial<RelationshipNetworkAutoSettings> | null,
  now = Date.now(),
): RelationshipNetworkAutoSettings {
  const base = makeDefaultRelationshipNetworkAutoSettings(now);
  const next: RelationshipNetworkAutoSettings = {
    ...base,
    ...(input || {}),
    id: 'settings',
    enabled: !!input?.enabled,
    selectedCharIds: Array.isArray(input?.selectedCharIds) ? Array.from(new Set(input!.selectedCharIds.filter(Boolean))) : [],
    intervalMinutes: clamp(Math.round(Number(input?.intervalMinutes ?? base.intervalMinutes) || base.intervalMinutes), 5, 24 * 60),
    charCooldownMinutes: clamp(Math.round(Number(input?.charCooldownMinutes ?? base.charCooldownMinutes) || base.charCooldownMinutes), 5, 7 * 24 * 60),
    pairCooldownMinutes: clamp(Math.round(Number(input?.pairCooldownMinutes ?? base.pairCooldownMinutes) || base.pairCooldownMinutes), 5, 14 * 24 * 60),
    nextRunAt: Number.isFinite(Number(input?.nextRunAt)) ? Number(input!.nextRunAt) : base.nextRunAt,
    lastRunAtByChar: { ...(input?.lastRunAtByChar || {}) },
    lastRunAtByPair: { ...(input?.lastRunAtByPair || {}) },
    forwardedCountByPair: { ...(input?.forwardedCountByPair || {}) },
    updatedAt: Number.isFinite(Number(input?.updatedAt)) ? Number(input!.updatedAt) : now,
  };
  return next;
}

function fallbackEdgeFor(a: CharacterProfile, b: CharacterProfile, now = Date.now()): RelationshipNetworkEdge {
  const seed = hash(`${a.id}|${b.id}|${a.systemPrompt}|${b.systemPrompt}`);
  const intimacy = 28 + (seed % 42);
  const tension = 8 + ((seed >>> 8) % 34);
  const label = intimacy >= 62 ? '熟悉又在意' : tension >= 34 ? '微妙拉扯' : '认识但仍在摸索';
  const pairKey = relationshipPairKey(a.id, b.id);
  return {
    id: pairKey,
    pairKey,
    charIds: [a.id, b.id].sort() as [string, string],
    label,
    summary: `${a.name} 和 ${b.name} 的关系由各自人设与近期生活底色推断而来，适合继续通过互动慢慢显形。`,
    confidence: 42,
    intimacy,
    tension,
    signals: {
      intimacy: intimacy >= 55 ? ['人设气质有可接住彼此的部分'] : [],
      friction: tension >= 28 ? ['价值观或表达节奏可能有摩擦'] : [],
      conflict: tension >= 38 ? ['需要后续互动验证边界'] : [],
    },
    source: 'fallback',
    createdAt: now,
    updatedAt: now,
  };
}

export function buildRelationshipNetworkFallbackEdges(characters: CharacterProfile[], now = Date.now()): RelationshipNetworkEdge[] {
  const out: RelationshipNetworkEdge[] = [];
  for (let i = 0; i < characters.length; i++) {
    for (let j = i + 1; j < characters.length; j++) {
      out.push(fallbackEdgeFor(characters[i], characters[j], now));
    }
  }
  return out;
}

function worldbookSnapshot(char: CharacterProfile): string {
  const live = WorldbookRuntime.resolveForChar(char);
  const entries = [...live.local, ...live.global]
    .slice(0, 8)
    .map(wb => `- ${wb.title} (${wb.scope}): ${clean(wb.content, '', 220)}`);
  if (entries.length) return entries.join('\n');
  return (char.mountedWorldbooks || [])
    .filter(wb => wb.enabled !== false && wb.content?.trim())
    .slice(0, 8)
    .map(wb => `- ${wb.title}: ${clean(wb.content, '', 220)}`)
    .join('\n');
}

function charRelationshipBlock(char: CharacterProfile, userProfile: UserProfile): string {
  return [
    `ID: ${char.id}`,
    `Name: ${char.name}`,
    char.systemPrompt ? `systemPrompt:\n${clean(char.systemPrompt, '', 1200)}` : '',
    char.worldview ? `worldview:\n${clean(char.worldview, '', 800)}` : '',
    char.lifeProfile?.content ? `lifeProfile:\n${clean(char.lifeProfile.content, '', 900)}` : '',
    worldbookSnapshot(char) ? `mounted/live worldbooks:\n${worldbookSnapshot(char)}` : '',
    `core context excerpt:\n${clean(ContextBuilder.buildCoreContext(char, userProfile, false), '', 1600)}`,
  ].filter(Boolean).join('\n');
}

function normalizeEdgeFromAny(raw: any, characters: CharacterProfile[], now = Date.now()): RelationshipNetworkEdge | null {
  const ids = new Set(characters.map(c => c.id));
  const rawIds = Array.isArray(raw?.charIds) ? raw.charIds : [raw?.charAId, raw?.charBId];
  const pair = rawIds.map((v: unknown) => clean(v, '', 80)).filter((id: string) => ids.has(id)).slice(0, 2);
  if (pair.length !== 2 || pair[0] === pair[1]) return null;
  const pairKey = relationshipPairKey(pair[0], pair[1]);
  return {
    id: pairKey,
    pairKey,
    charIds: [...pair].sort() as [string, string],
    label: clean(raw?.label, '关系待定', 40),
    summary: clean(raw?.summary, 'AI 暂时只整理出了模糊关系，需要更多互动继续校准。', 600),
    confidence: clamp(Math.round(Number(raw?.confidence ?? 60) || 60), 0, 100),
    intimacy: clamp(Math.round(Number(raw?.intimacy ?? 45) || 45), 0, 100),
    tension: clamp(Math.round(Number(raw?.tension ?? 20) || 20), 0, 100),
    signals: {
      intimacy: arr(raw?.signals?.intimacy ?? raw?.intimacySignals, 8),
      friction: arr(raw?.signals?.friction ?? raw?.frictionSignals, 8),
      conflict: arr(raw?.signals?.conflict ?? raw?.conflictSignals, 8),
    },
    source: 'ai',
    createdAt: now,
    updatedAt: now,
  };
}

export async function organizeRelationshipNetwork(args: {
  characters: CharacterProfile[];
  userProfile: UserProfile;
  api?: ResolvedApi | null;
}): Promise<RelationshipNetworkEdge[]> {
  const { characters, userProfile, api } = args;
  if (characters.length < 2) return [];
  const now = Date.now();
  const fallback = buildRelationshipNetworkFallbackEdges(characters, now);
  if (!api?.baseUrl || !api.model) return fallback;

  const prompt = `你是 Moro 的关系网整理器。请读取每个角色的人设、世界观、生活侧写、已绑定世界书的 live 解析摘要，整理角色与角色之间的关系。

要求：
- 只输出 JSON，不要 Markdown。
- 输出格式：{"edges":[{"charIds":["idA","idB"],"label":"短标签","summary":"关系摘要","confidence":0-100,"intimacy":0-100,"tension":0-100,"signals":{"intimacy":["..."],"friction":["..."],"conflict":["..."]}}]}
- 每条关系必须是两个不同角色。可以输出你有把握的全部 pair；如果资料不足，也要给出保守推断。
- intimacy 表示亲密/互相在意，tension 表示张力/冲突/误解，confidence 表示你对推断的把握。

用户名：${userProfile.name || '用户'}

角色资料：
${characters.map(c => `\n--- CHARACTER ---\n${charRelationshipBlock(c, userProfile)}`).join('\n')}`;

  try {
    const raw = await llmComplete(api, [{ role: 'user', content: prompt }], { temperature: 0.45, maxTokens: 2200 });
    const parsed = extractJson(raw);
    const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.edges) ? parsed.edges : [];
    const edges = rows
      .map((row: any) => normalizeEdgeFromAny(row, characters, now))
      .filter(Boolean) as RelationshipNetworkEdge[];
    if (!edges.length) return fallback;
    return edges;
  } catch {
    return fallback;
  }
}

function fallbackInteraction(a: CharacterProfile, b: CharacterProfile, edge: RelationshipNetworkEdge | undefined, source: 'manual' | 'auto'): RelationshipNetworkGenerationResult {
  const now = Date.now();
  const pairKey = relationshipPairKey(a.id, b.id);
  const topic = edge?.label || '关系待定';
  const messages: RelationshipNetworkMessage[] = [
    {
      id: `rnm_${now}_${a.id}_${hash(pairKey + now).toString(36)}`,
      pairKey,
      speakerId: a.id,
      speakerName: a.name,
      content: `${b.name}，我刚才想到你。我们现在这种「${topic}」的状态，好像还挺适合慢慢试探的。`,
      createdAt: now,
      source,
    },
    {
      id: `rnm_${now + 1}_${b.id}_${hash(pairKey + now + 'b').toString(36)}`,
      pairKey,
      speakerId: b.id,
      speakerName: b.name,
      content: `你这句话倒是让我有点在意。先别急着下结论，聊下去再说。`,
      createdAt: now + 1,
      source,
    },
  ];
  const shouldForward = source === 'auto' && (hash(`${pairKey}:${Math.floor(now / (30 * MINUTE))}`) % 5 === 0);
  return {
    messages,
    edgePatch: {
      summary: edge?.summary || `${a.name} 与 ${b.name} 有了一段新的后台互动。`,
      lastInteractionAt: now,
      updatedAt: now,
      source,
    },
    forward: shouldForward ? {
      shouldForward: true,
      forwarderId: a.id,
      reason: `${a.name} 觉得这段可以给用户看一点。`,
      excerptMessageIds: messages.slice(-2).map(m => m.id),
    } : { shouldForward: false },
  };
}

export async function generateCharPairInteraction(args: {
  a: CharacterProfile;
  b: CharacterProfile;
  edge?: RelationshipNetworkEdge;
  recentMessages?: RelationshipNetworkMessage[];
  api?: ResolvedApi | null;
  userProfile: UserProfile;
  source: 'manual' | 'auto';
}): Promise<RelationshipNetworkGenerationResult> {
  const { a, b, edge, recentMessages = [], api, userProfile, source } = args;
  const pairKey = relationshipPairKey(a.id, b.id);
  if (!api?.baseUrl || !api.model) return fallbackInteraction(a, b, edge, source);
  const now = Date.now();
  const recent = recentMessages.slice(-12).map(m => `${m.speakerName}: ${m.content}`).join('\n') || '(暂无角色间私聊记录)';
  const prompt = `你正在为 Moro 的关系网生成一小段角色与角色的后台私聊。用户不会默认看到完整记录，角色可以选择是否裁剪片段转发给用户。

输出 JSON，格式：
{"messages":[{"speakerId":"${a.id} 或 ${b.id}","content":"一句自然发言"}],"edgePatch":{"label":"可选","summary":"可选关系变化摘要","intimacy":0-100,"tension":0-100,"confidence":0-100,"signals":{"intimacy":[],"friction":[],"conflict":[]}},"forward":{"shouldForward":true/false,"forwarderId":"可选，必须是参与者","reason":"为什么想转发","excerptIndexes":[0,1]}}

要求：
- 生成 2 到 5 条消息，像真实私聊，不要写旁白，不要出现 JSON 以外内容。
- 两个角色都要符合自己的人设；不是围着用户转，但可以偶尔提到用户 ${userProfile.name || '用户'}。
- 如果 shouldForward=true，代表转发角色自主决定给 user 看一小段，不一定完整。excerptIndexes 是 messages 的下标。
- 这次来源：${source === 'auto' ? '后台自动生成' : '用户手动生成'}

关系摘要：
${edge ? `${edge.label}: ${edge.summary}\n亲密 ${edge.intimacy}/100，张力 ${edge.tension}/100` : '暂无'}

最近私聊：
${recent}

角色 A：
${charRelationshipBlock(a, userProfile)}

角色 B：
${charRelationshipBlock(b, userProfile)}`;

  try {
    const raw = await llmComplete(api, [{ role: 'user', content: prompt }], { temperature: 0.82, maxTokens: 1400 });
    const parsed = extractJson(raw);
    const validIds = new Set([a.id, b.id]);
    const rows = Array.isArray(parsed?.messages) ? parsed.messages : [];
    const messages: RelationshipNetworkMessage[] = rows
      .map((row: any, index: number) => {
        const speakerId = clean(row?.speakerId, '', 80);
        if (!validIds.has(speakerId)) return null;
        const speaker = speakerId === a.id ? a : b;
        const content = clean(row?.content, '', 600);
        if (!content) return null;
        return {
          id: `rnm_${now}_${index}_${speakerId}_${Math.random().toString(36).slice(2, 7)}`,
          pairKey,
          speakerId,
          speakerName: speaker.name,
          content,
          createdAt: now + index,
          source,
        } satisfies RelationshipNetworkMessage;
      })
      .filter(Boolean) as RelationshipNetworkMessage[];
    if (messages.length < 1) return fallbackInteraction(a, b, edge, source);
    const patchRaw = parsed?.edgePatch || {};
    const edgePatch: Partial<RelationshipNetworkEdge> = {
      label: patchRaw.label ? clean(patchRaw.label, '', 40) : undefined,
      summary: patchRaw.summary ? clean(patchRaw.summary, '', 600) : edge?.summary,
      confidence: patchRaw.confidence != null ? clamp(Math.round(Number(patchRaw.confidence) || 0), 0, 100) : edge?.confidence,
      intimacy: patchRaw.intimacy != null ? clamp(Math.round(Number(patchRaw.intimacy) || 0), 0, 100) : edge?.intimacy,
      tension: patchRaw.tension != null ? clamp(Math.round(Number(patchRaw.tension) || 0), 0, 100) : edge?.tension,
      signals: patchRaw.signals ? {
        intimacy: arr(patchRaw.signals.intimacy, 8),
        friction: arr(patchRaw.signals.friction, 8),
        conflict: arr(patchRaw.signals.conflict, 8),
      } : edge?.signals,
      lastInteractionAt: now,
      updatedAt: now,
      source,
    };
    const fwd = parsed?.forward || {};
    const excerptIndexes = Array.isArray(fwd.excerptIndexes) ? fwd.excerptIndexes.map((n: any) => Number(n)).filter(Number.isFinite) : [];
    const excerptMessageIds = excerptIndexes
      .map((idx: number) => messages[idx]?.id)
      .filter(Boolean);
    const forward: RelationshipNetworkForwardDecision = {
      shouldForward: !!fwd.shouldForward && validIds.has(clean(fwd.forwarderId, '', 80)),
      forwarderId: validIds.has(clean(fwd.forwarderId, '', 80)) ? clean(fwd.forwarderId, '', 80) : undefined,
      reason: clean(fwd.reason, '', 160),
      excerptMessageIds: excerptMessageIds.length ? excerptMessageIds : undefined,
    };
    return { messages, edgePatch, forward };
  } catch {
    return fallbackInteraction(a, b, edge, source);
  }
}

export function chooseAutoRelationshipTargets(args: {
  selectedCharIds: string[];
  characters: CharacterProfile[];
  edges: RelationshipNetworkEdge[];
  settings: RelationshipNetworkAutoSettings;
  now?: number;
  maxPairs?: number;
}): Array<{ a: CharacterProfile; b: CharacterProfile; pairKey: string; edge?: RelationshipNetworkEdge }> {
  const now = args.now ?? Date.now();
  const settings = normalizeRelationshipNetworkSettings(args.settings, now);
  if (!settings.enabled || settings.nextRunAt > now) return [];
  const chars = args.characters.filter(c => c.id);
  const byId = new Map(chars.map(c => [c.id, c]));
  const selected = Array.from(new Set(args.selectedCharIds.filter(id => byId.has(id))));
  const edgeByPair = new Map(args.edges.map(e => [e.pairKey, e]));
  const picked = new Set<string>();
  const out: Array<{ a: CharacterProfile; b: CharacterProfile; pairKey: string; edge?: RelationshipNetworkEdge }> = [];

  const dueSelected = selected.filter(id => {
    const last = settings.lastRunAtByChar[id] || 0;
    return now - last >= settings.charCooldownMinutes * MINUTE;
  });

  for (const charId of dueSelected) {
    const a = byId.get(charId);
    if (!a) continue;
    const candidates = chars
      .filter(b => b.id !== a.id)
      .map(b => {
        const pairKey = relationshipPairKey(a.id, b.id);
        const edge = edgeByPair.get(pairKey);
        const lastPair = settings.lastRunAtByPair[pairKey] || 0;
        const lastOther = settings.lastRunAtByChar[b.id] || 0;
        const pairDue = now - lastPair >= settings.pairCooldownMinutes * MINUTE;
        const otherPenalty = now - lastOther < settings.charCooldownMinutes * MINUTE ? 18 : 0;
        const score = (edge?.intimacy ?? 35) + (edge?.confidence ?? 40) / 5 - (edge?.tension ?? 15) / 2 - otherPenalty + (hash(pairKey) % 17);
        return { b, pairKey, edge, pairDue, score };
      })
      .filter(c => c.pairDue && !picked.has(c.pairKey))
      .sort((x, y) => y.score - x.score);
    const best = candidates[0];
    if (!best) continue;
    out.push({ a, b: best.b, pairKey: best.pairKey, edge: best.edge });
    picked.add(best.pairKey);
    if (out.length >= (args.maxPairs ?? 2)) break;
  }
  return out;
}

export function markAutoRelationshipRun(
  settings: RelationshipNetworkAutoSettings,
  pairs: Array<{ a: CharacterProfile; b: CharacterProfile; pairKey: string; forwarded?: boolean }>,
  now = Date.now(),
): RelationshipNetworkAutoSettings {
  const next = normalizeRelationshipNetworkSettings(settings, now);
  next.lastRunAtByChar = { ...next.lastRunAtByChar };
  next.lastRunAtByPair = { ...next.lastRunAtByPair };
  next.forwardedCountByPair = { ...next.forwardedCountByPair };
  for (const pair of pairs) {
    next.lastRunAtByChar[pair.a.id] = now;
    next.lastRunAtByChar[pair.b.id] = now;
    next.lastRunAtByPair[pair.pairKey] = now;
    if (pair.forwarded) next.forwardedCountByPair[pair.pairKey] = (next.forwardedCountByPair[pair.pairKey] || 0) + 1;
  }
  next.nextRunAt = now + next.intervalMinutes * MINUTE;
  next.updatedAt = now;
  return next;
}

export function mergeRelationshipEdge(
  base: RelationshipNetworkEdge | undefined,
  a: CharacterProfile,
  b: CharacterProfile,
  patch?: Partial<RelationshipNetworkEdge>,
  source: RelationshipNetworkEdge['source'] = 'manual',
  now = Date.now(),
): RelationshipNetworkEdge {
  const fallback = fallbackEdgeFor(a, b, now);
  return {
    ...fallback,
    ...(base || {}),
    ...(patch || {}),
    id: relationshipPairKey(a.id, b.id),
    pairKey: relationshipPairKey(a.id, b.id),
    charIds: [a.id, b.id].sort() as [string, string],
    signals: patch?.signals || base?.signals || fallback.signals,
    source,
    createdAt: base?.createdAt || fallback.createdAt,
    updatedAt: now,
  };
}

export function buildRelationshipForwardCard(args: {
  forwarder: CharacterProfile;
  other: CharacterProfile;
  messages: RelationshipNetworkMessage[];
  edge?: RelationshipNetworkEdge;
  partial?: boolean;
}) {
  const preview = args.messages.slice(0, 4).map(m => `${m.speakerName}: ${m.content}`);
  return {
    kind: 'char_pair',
    title: `${args.forwarder.name} 转发了一段和 ${args.other.name} 的私聊`,
    fromCharName: args.forwarder.name,
    toCharName: args.other.name,
    participantNames: [args.forwarder.name, args.other.name],
    relationLabel: args.edge?.label,
    partial: args.partial !== false,
    count: args.messages.length,
    preview,
    messages: args.messages.map(m => ({
      role: 'assistant',
      type: 'text',
      senderId: m.speakerId,
      senderName: m.speakerName,
      content: m.content,
      timestamp: m.createdAt,
    })),
  };
}

export async function buildRelationshipNetworkContextBlock(charId: string, characters: CharacterProfile[] = [], limit = 8): Promise<string> {
  try {
    const edges = (await DB.getRelationshipNetworkEdges())
      .filter(edge => edge.charIds.includes(charId))
      .sort((a, b) => (b.lastInteractionAt || b.updatedAt || 0) - (a.lastInteractionAt || a.updatedAt || 0))
      .slice(0, limit);
    if (!edges.length) return '';
    const allCharacters = characters.length > 1 ? characters : await DB.getAllCharacters();
    const nameById = new Map(allCharacters.map(c => [c.id, c.name]));
    const lines: string[] = [];
    for (const edge of edges) {
      const otherId = edge.charIds.find(id => id !== charId) || '';
      const otherName = nameById.get(otherId) || '另一位角色';
      const msgs = await DB.getRelationshipNetworkMessagesByPair(edge.pairKey, 3);
      const msgText = msgs.map(m => `${m.speakerName}: ${m.content}`).join(' / ');
      lines.push(`- 与 ${otherName}：${edge.label}；${edge.summary}${msgText ? `；最近私聊：${msgText}` : ''}`);
    }
    return lines.length
      ? `### 关系网：你与其他角色的私下关系\n这些是后台关系网里你已经能知道的互动摘要。可以自然记得，但不要机械复述。\n${lines.join('\n')}\n`
      : '';
  } catch {
    return '';
  }
}
