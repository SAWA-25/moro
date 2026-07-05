import { describe, expect, it } from 'vitest';
import { getLocalDateKey, getNextLocalMidnightDelay } from './dateKey';

describe('date key helpers', () => {
  it('formats the browser-local calendar day', () => {
    expect(getLocalDateKey(new Date(2026, 6, 5, 0, 30))).toBe('2026-07-05');
  });

  it('computes delay until the next local midnight', () => {
    expect(getNextLocalMidnightDelay(new Date(2026, 6, 5, 23, 59, 30))).toBe(30_000);
  });
});
