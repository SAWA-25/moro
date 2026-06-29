import { describe, expect, it } from 'vitest';
import type { CharacterProfile, RelationshipNetworkEdge } from '../types';
import {
  buildManualRelationshipEdge,
  buildRelationshipNetworkFallbackEdges,
  chooseAutoRelationshipTargets,
  getRelationshipPerspective,
  makeDefaultRelationshipNetworkAutoSettings,
  makeRelationshipNpcStableId,
  markAutoRelationshipRun,
  maybeSummarizeRelationshipMessages,
  normalizeRelationshipNetworkSettings,
  relationshipPairIds,
  relationshipPairKey,
} from './relationshipNetwork';

const char = (id: string, name = id): CharacterProfile => ({
  id,
  name,
  avatar: '',
  systemPrompt: `${name} setting`,
} as CharacterProfile);

describe('relationship network helpers', () => {
  it('uses a stable sorted pair key', () => {
    const key = relationshipPairKey('char_b', 'char_a');
    expect(key).toBe(relationshipPairKey('char_a', 'char_b'));
    expect(relationshipPairIds(key)).toEqual(['char_a', 'char_b']);
  });

  it('uses stable ids for generated NPC relationship nodes', () => {
    expect(makeRelationshipNpcStableId('char_a', '父亲')).toBe(makeRelationshipNpcStableId('char_a', '父亲'));
    expect(makeRelationshipNpcStableId('char_a', '父亲')).not.toBe(makeRelationshipNpcStableId('char_b', '父亲'));
  });

  it('normalizes auto settings with clamps and de-duped selected ids', () => {
    const settings = normalizeRelationshipNetworkSettings({
      enabled: true,
      selectedCharIds: ['a', 'a', 'b', ''],
      intervalMinutes: 1,
      charCooldownMinutes: 1,
      pairCooldownMinutes: 999999,
      summaryCompressAfter: 8,
      summaryKeepRaw: 999,
    }, 1000);

    expect(settings.enabled).toBe(true);
    expect(settings.selectedCharIds).toEqual(['a', 'b']);
    expect(settings.intervalMinutes).toBe(5);
    expect(settings.charCooldownMinutes).toBe(5);
    expect(settings.pairCooldownMinutes).toBe(14 * 24 * 60);
    expect(settings.summaryCompressAfter).toBe(12);
    expect(settings.summaryKeepRaw).toBe(11);
  });

  it('builds fallback edges for every character pair', () => {
    const edges = buildRelationshipNetworkFallbackEdges([char('a'), char('b'), char('c')], 1234);
    expect(edges).toHaveLength(3);
    expect(edges.map(edge => edge.pairKey).sort()).toEqual([
      relationshipPairKey('a', 'b'),
      relationshipPairKey('a', 'c'),
      relationshipPairKey('b', 'c'),
    ].sort());
  });

  it('stores manual relationships as per-owner perspectives and can sync first write', () => {
    const edge = buildManualRelationshipEdge({
      owner: { id: 'a', name: 'A' },
      target: { id: 'b', name: 'B', kind: 'character' },
      label: '朋友',
      note: '一起行动过',
      syncBothWays: true,
      now: 1000,
    });

    expect(edge.charIds).toEqual(['a', 'b']);
    expect(getRelationshipPerspective(edge, 'a')).toMatchObject({ ownerId: 'a', targetId: 'b', label: '朋友', note: '一起行动过' });
    expect(getRelationshipPerspective(edge, 'b')).toMatchObject({ ownerId: 'b', targetId: 'a', label: '朋友' });

    const edited = buildManualRelationshipEdge({
      base: edge,
      owner: { id: 'a', name: 'A' },
      target: { id: 'b', name: 'B', kind: 'character' },
      label: '冷战',
      syncBothWays: false,
      now: 2000,
    });
    expect(getRelationshipPerspective(edited, 'a')?.label).toBe('冷战');
    expect(getRelationshipPerspective(edited, 'b')?.label).toBe('朋友');
  });

  it('summarizes old pair messages after the configured threshold', async () => {
    const edge = buildManualRelationshipEdge({
      owner: { id: 'a', name: 'A' },
      target: { id: 'b', name: 'B', kind: 'character' },
      label: '朋友',
      now: 1000,
    });
    const settings = normalizeRelationshipNetworkSettings({
      summaryCompressAfter: 12,
      summaryKeepRaw: 6,
    }, 2000);
    const messages = Array.from({ length: 14 }, (_, i) => ({
      id: `m${i}`,
      pairKey: edge.pairKey,
      speakerId: i % 2 ? 'a' : 'b',
      speakerName: i % 2 ? 'A' : 'B',
      content: `message ${i}`,
      createdAt: 1000 + i,
      source: 'manual' as const,
    }));

    const summarized = await maybeSummarizeRelationshipMessages({ edge, messages, settings, now: 3000 });
    expect(summarized.privateChatSummary?.messageCount).toBe(8);
    expect(summarized.privateChatSummary?.summarizedUntilAt).toBe(1007);
    expect(summarized.privateChatSummary?.text).toContain('message');
  });

  it('respects global, character, and pair cooldowns when choosing auto targets', () => {
    const now = 10_000_000;
    const chars = [char('a'), char('b'), char('c')];
    const edgeAB: RelationshipNetworkEdge = {
      id: relationshipPairKey('a', 'b'),
      pairKey: relationshipPairKey('a', 'b'),
      charIds: ['a', 'b'],
      label: 'close',
      summary: 'close but cooling down',
      confidence: 100,
      intimacy: 100,
      tension: 0,
      signals: { intimacy: [], friction: [], conflict: [] },
      source: 'ai',
      createdAt: now - 1000,
      updatedAt: now - 1000,
    };
    const settings = normalizeRelationshipNetworkSettings({
      enabled: true,
      selectedCharIds: ['a', 'b'],
      nextRunAt: now - 1,
      intervalMinutes: 30,
      charCooldownMinutes: 60,
      pairCooldownMinutes: 60,
      lastRunAtByChar: { b: now - 10 * 60 * 1000 },
      lastRunAtByPair: { [edgeAB.pairKey]: now - 10 * 60 * 1000 },
    }, now);

    expect(chooseAutoRelationshipTargets({
      selectedCharIds: settings.selectedCharIds,
      characters: chars,
      edges: [edgeAB],
      settings: { ...settings, nextRunAt: now + 1000 },
      now,
    })).toEqual([]);

    const due = chooseAutoRelationshipTargets({
      selectedCharIds: settings.selectedCharIds,
      characters: chars,
      edges: [edgeAB],
      settings,
      now,
      maxPairs: 3,
    });

    expect(due).toHaveLength(1);
    expect(due[0].a.id).toBe('a');
    expect(due[0].b.id).toBe('c');
  });

  it('marks auto runs and advances the next run watermark', () => {
    const now = 2000;
    const a = char('a');
    const b = char('b');
    const settings = makeDefaultRelationshipNetworkAutoSettings(now);
    const next = markAutoRelationshipRun(settings, [{ a, b, pairKey: relationshipPairKey('a', 'b'), forwarded: true }], now);

    expect(next.lastRunAtByChar.a).toBe(now);
    expect(next.lastRunAtByChar.b).toBe(now);
    expect(next.lastRunAtByPair[relationshipPairKey('a', 'b')]).toBe(now);
    expect(next.forwardedCountByPair[relationshipPairKey('a', 'b')]).toBe(1);
    expect(next.nextRunAt).toBe(now + next.intervalMinutes * 60 * 1000);
  });
});
