import { describe, expect, it, vi } from 'vitest';
import {
  RANDOM_INTERVAL_CHOICES_MIN,
  planProactiveReplay,
  rollRandomIntervalMs,
} from './proactiveChat';

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

describe('proactive offline replay planning', () => {
  const hour = 60 * 60 * 1000;
  const lastFire = 1_000_000;

  it('replays every missed fixed-interval slot in chronological order', () => {
    const plan = planProactiveReplay(
      { charId: 'char-1', intervalMs: hour },
      lastFire,
      lastFire + 3 * hour + 5_000,
    );

    expect(plan?.missedCount).toBe(3);
    expect(plan?.scheduledTimes).toEqual([
      lastFire + hour,
      lastFire + 2 * hour,
      lastFire + 3 * hour,
    ]);
    expect(plan?.droppedBacklog).toBe(false);
    expect(plan?.nextLastFire).toBe(lastFire + 3 * hour);
  });

  it('keeps long fixed-interval gaps as a continuous replay sequence', () => {
    const now = lastFire + 13 * hour + 5_000;
    const plan = planProactiveReplay(
      { charId: 'char-1', intervalMs: hour },
      lastFire,
      now,
    );

    expect(plan?.missedCount).toBe(13);
    expect(plan?.scheduledTimes).toHaveLength(13);
    expect(plan?.scheduledTimes.at(0)).toBe(lastFire + hour);
    expect(plan?.scheduledTimes.at(-1)).toBe(lastFire + 13 * hour);
    expect(plan?.droppedBacklog).toBe(false);
    expect(plan?.nextLastFire).toBe(lastFire + 13 * hour);
  });

  it('also replays random-mode missed slots as a backlog', () => {
    const plan = planProactiveReplay(
      { charId: 'char-1', intervalMs: hour, random: true },
      lastFire,
      lastFire + 5 * hour + 5_000,
    );

    expect(plan?.missedCount).toBe(5);
    expect(plan?.scheduledTimes).toEqual([
      lastFire + hour,
      lastFire + 2 * hour,
      lastFire + 3 * hour,
      lastFire + 4 * hour,
      lastFire + 5 * hour,
    ]);
    expect(plan?.droppedBacklog).toBe(false);
    expect(plan?.nextLastFire).toBe(lastFire + 5 * hour);
  });
});
