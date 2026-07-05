import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  swBuildMessages,
  swBuildQueuedReplyMetadata,
  swCallLLM,
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

afterEach(() => {
  vi.restoreAllMocks();
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

  it('injects pending user messages and exposes queued reply metadata', () => {
    const snap = mkSnap({
      pendingUserMessages: [
        { id: 7, content: '你还没回我这句', timestamp: 1_788_000_000_000, type: 'text' },
      ],
      queuedReplyTarget: { id: 7, content: '你还没回我这句', name: '小夏' },
    });
    const messages = swBuildMessages(snap);

    expect(messages[0].content).toContain('还没被你回复');
    expect(messages[0].content).toContain('你还没回我这句');
    expect(messages[messages.length - 1].content).toContain('先自然回应');
    expect(swBuildQueuedReplyMetadata(snap)).toEqual({
      queuedReplyTarget: { id: 7, content: '你还没回我这句', name: '小夏' },
      pendingProactiveReplyIds: [7],
    });
  });

  it('uses preset-applied snapshot messages without duplicating mirrored recent chat', () => {
    const messages = swBuildMessages(mkSnap({
      presetMessages: [
        { role: 'system', content: 'PRESET_SYSTEM' },
        { role: 'user', content: 'PRESET_HISTORY' },
      ],
      lifeEvents: [{
        timestamp: 1_788_000_000_000,
        activity: '在雨棚下等了十分钟',
      }],
    }));

    expect(messages[0]).toEqual({ role: 'system', content: 'PRESET_SYSTEM' });
    expect(messages[1]).toEqual({ role: 'user', content: 'PRESET_HISTORY' });
    expect(messages.some(m => m.role === 'system' && m.content.includes('在雨棚下等了十分钟'))).toBe(true);
    expect(messages.filter(m => m.content.includes('昨天说好今天见'))).toHaveLength(0);
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
    expect(swShouldGenerateProactive(mkSnap({
      updatedAt: now,
      proactiveV2: { quietHours: { enabled: true, start: '00:00', end: '23:59', behavior: 'life_only' } },
      pendingUserMessages: [{ id: 9, content: '这句还没回' }],
    }), now)).toEqual({ ok: true, reason: 'ok' });
  });

  it('skips SW proactive generation while the character is in offline mode', () => {
    const now = 1_788_000_000_000;

    expect(swShouldGenerateProactive(mkSnap({
      updatedAt: now,
      activeOfflineSession: true,
      pendingUserMessages: [{ id: 9, content: '这句还没回' }],
    }), now)).toEqual({ ok: false, reason: 'offline_session_active' });
  });

  it('cleans directives and wrappers from SW generated text', () => {
    expect(swCleanProactiveText('```text\n「烦死了[[CALL_USER]]」\n```')).toBe('烦死了');
  });

  it('passes mirrored preset sampling params to SW LLM calls', async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '来了' } }] }),
    } as unknown as Response));
    global.fetch = fetchFn as unknown as typeof fetch;

    await expect(swCallLLM(
      { baseUrl: 'https://api.example.test/v1', apiKey: 'sk-test', model: 'm' },
      [{ role: 'user', content: 'hi' }],
      400,
      undefined,
      { temperature: 0.21, max_tokens: 123, top_p: 0.7 },
    )).resolves.toBe('来了');

    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.temperature).toBe(0.21);
    expect(body.max_tokens).toBe(123);
    expect(body.top_p).toBe(0.7);
  });
});
