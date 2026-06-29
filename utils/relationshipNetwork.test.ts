import { describe, expect, it } from 'vitest';
import type { CharacterProfile, RelationshipNetworkEdge } from '../types';
import {
  buildRelationshipNetworkFallbackEdges,
  chooseAutoRelationshipTargets,
  makeDefaultRelationshipNetworkAutoSettings,
  markAutoRelationshipRun,
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

  it('normalizes auto settings with clamps and de-duped selected ids', () => {
    const settings = normalizeRelationshipNetworkSettings({
      enabled: true,
      selectedCharIds: ['a', 'a', 'b', ''],
      intervalMinutes: 1,
      charCooldownMinutes: 1,
      pairCooldownMinutes: 999999,
    }, 1000);

    expect(settings.enabled).toBe(true);
    expect(settings.selectedCharIds).toEqual(['a', 'b']);
    expect(settings.intervalMinutes).toBe(5);
    expect(settings.charCooldownMinutes).toBe(5);
    expect(settings.pairCooldownMinutes).toBe(14 * 24 * 60);
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
