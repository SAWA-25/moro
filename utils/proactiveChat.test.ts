import { describe, expect, it, vi } from 'vitest';
import { RANDOM_INTERVAL_CHOICES_MIN, rollRandomIntervalMs } from './proactiveChat';

describe('proactive random interval', () => {
  it('keeps smart/random proactive intervals within 12 hours', () => {
    expect(Math.max(...RANDOM_INTERVAL_CHOICES_MIN)).toBe(720);
    expect(RANDOM_INTERVAL_CHOICES_MIN).not.toContain(1440);

    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.999999);
    try {
      expect(rollRandomIntervalMs()).toBe(720 * 60 * 1000);
    } finally {
      randomSpy.mockRestore();
    }
  });
});
