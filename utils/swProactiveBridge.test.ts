import { describe, expect, it } from 'vitest';
import {
  swBuildMessages,
  swCleanProactiveText,
  swShouldGenerateProactive,
  type SwProactiveSnapshot,
} from './swProactiveBridge';

const mkSnap = (patch: Partial<SwProactiveSnapshot> = {}): SwProactiveSnapshot => ({
  charId: 'sw-char',
  name: 'SW Char',
  enabled: true,
  api: { baseUrl: 'https://api.example.test/v1', apiKey: 'sk-test', model: 'test-model' },
  systemPrompt: '你是 SW Char。',
  instruction: '直接写消息正文。',
  recentMessages: [{ role: 'user', content: '昨天说好今天见。' }],
  updatedAt: 1_788_000_000_000,
  ...patch,
});

describe('sw proactive v2 bridge', () => {
  it('injects mirrored life events into the SW prompt', () => {
    const messages = swBuildMessages(mkSnap({
      lifeEvents: [{
        timestamp: 1_788_000_000_000,
        activity: '把钥匙翻出来时指尖沾了一层灰',
        mood: '烦躁',
        eventKind: 'errand',
        energy: 'low',
        proactiveAngle: 'vent',
        thread: '出门已经晚了',
      }],
      proactiveV2: { messageFlavor: 'moody', materialSources: ['life', 'recentChat'] },
    }));

    expect(messages[0].content).toContain('把钥匙翻出来');
    expect(messages[0].content).toContain('来信口味：moody');
    expect(messages[messages.length - 1].role).toBe('user');
  });

  it('skips stale snapshots and quiet-hour life-only windows', () => {
    const now = 1_788_000_000_000;
    expect(swShouldGenerateProactive(mkSnap({ updatedAt: now - 49 * 60 * 60 * 1000 }), now).reason).toBe('stale_snapshot');

    const quiet = mkSnap({
      updatedAt: now,
      proactiveV2: { quietHours: { enabled: true, start: '00:00', end: '23:59', behavior: 'life_only' } },
    });
    expect(swShouldGenerateProactive(quiet, now)).toEqual({ ok: false, reason: 'quiet_hours_life_only' });
  });

  it('cleans directives and wrappers from SW generated text', () => {
    expect(swCleanProactiveText('```text\n「烦死了[[CALL_USER]]」\n```')).toBe('烦死了');
  });
});
