import { describe, expect, it } from 'vitest';
import {
  AFFECTION_DAILY_CAP,
  AFFECTION_DECISIVE_CAP,
  affectionBandSummary,
  affectionShiftSummary,
  applyAffectionDelta,
  applyAffectionEval,
  applyAffectionEvent,
  getAffectionBand,
  getAffectionEventProfile,
} from './relationship';

describe('relationship affection helpers', () => {
  it('maps affection values to stable semantic bands', () => {
    expect(getAffectionBand(0).key).toBe('rejected');
    expect(getAffectionBand(14).key).toBe('rejected');
    expect(getAffectionBand(15).key).toBe('guarded');
    expect(getAffectionBand(44).key).toBe('distant');
    expect(getAffectionBand(45).key).toBe('neutral');
    expect(getAffectionBand(69).key).toBe('friendly');
    expect(getAffectionBand(70).key).toBe('close');
    expect(getAffectionBand(94).key).toBe('attached');
    expect(getAffectionBand(100).key).toBe('overflowing');
  });

  it('summarizes affection as emotion balance instead of obedience', () => {
    const text = affectionBandSummary(96);

    expect(text).toContain('满溢');
    expect(text).toContain('不等于无底线顺从');
  });

  it('keeps routine affection evaluations gradual', () => {
    expect(applyAffectionEval(50, 100)).toBe(50 + AFFECTION_DAILY_CAP);
    expect(applyAffectionEval(50, 0)).toBe(50 - AFFECTION_DAILY_CAP);
  });

  it('allows wider but still capped decisive affection changes', () => {
    expect(applyAffectionEval(50, 100, { decisive: true })).toBe(50 + AFFECTION_DECISIVE_CAP);
    expect(applyAffectionDelta(50, -99, { decisive: true })).toBe(50 - AFFECTION_DECISIVE_CAP);
  });

  it('applies named affection events with reusable semantic deltas', () => {
    expect(getAffectionEventProfile('gift_or_takeout')).toMatchObject({
      label: '投喂/礼物',
      delta: 2,
    });
    expect(applyAffectionEvent(50, 'gift_or_takeout')).toBe(52);
    expect(applyAffectionEvent(80, 'betrayal_or_abandonment')).toBe(62);
  });

  it('describes affection shifts without turning them into obedience scores', () => {
    expect(affectionShiftSummary(50, 52)).toContain('微微升温');
    expect(affectionShiftSummary(88, 63)).toContain('关系降温');
    expect(affectionShiftSummary(88, 63)).toContain('牵挂 → 友好');
  });
});
