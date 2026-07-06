import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterProfile, Message, UserProfile } from '../types';
import { applyAssistantPostProcessing, type PostProcessCtx } from './applyAssistantPostProcessing';
import { DB } from './db';
import { OFFLINE_START_EVENT, consumeDueOfflineAutoStarts, consumeOfflinePending } from './offlineMode';

const baseChar = {
  id: 'char-a',
  name: '阿迟',
  avatar: '',
  description: '',
  systemPrompt: '',
  memories: [],
  contextLimit: 50,
} as CharacterProfile;

const userProfile = {
  name: '小夏',
  avatar: '',
  bio: '',
} as UserProfile;

const initialData = {
  choices: [{ message: { content: '' } }],
};

const makeCtx = (char: CharacterProfile, contextMsgs: Message[] = []): PostProcessCtx => ({
  char,
  userProfile,
  emojis: [],
  contextMsgs,
  fullMessages: [],
  initialData,
  historyMsgCount: contextMsgs.length,
  xhsCaches: {
    xsecTokenCache: new Map(),
    noteTitleCache: new Map(),
    commentUserIdCache: new Map(),
    commentAuthorNameCache: new Map(),
    commentParentIdCache: new Map(),
  },
  api: {
    baseUrl: '',
    headers: {},
    effectiveApi: { baseUrl: '', apiKey: '', model: '' },
  },
  hooks: {
    setMessages: vi.fn(),
    addToast: vi.fn(),
  },
  skipSecondPassLLM: true,
  skipTypingDelay: true,
});

const stubWindowEvents = () => {
  const target = new EventTarget();
  vi.stubGlobal('window', {
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
  });
  vi.stubGlobal('CustomEvent', class TestCustomEvent<T = unknown> extends Event {
    detail: T;
    constructor(type: string, init?: CustomEventInit<T>) {
      super(type);
      this.detail = init?.detail as T;
    }
  });
};

describe('applyAssistantPostProcessing offline auto-start', () => {
  beforeEach(async () => {
    stubWindowEvents();
    localStorage.clear();
    await DB.deleteDB();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('strips offline directives and dispatches only when auto offline is enabled', async () => {
    const seen: unknown[] = [];
    const handler = (event: Event) => seen.push((event as CustomEvent).detail);
    window.addEventListener(OFFLINE_START_EVENT, handler);

    try {
      const count = await applyAssistantPostProcessing(
        '我到你楼下了。\n[[OFFLINE_START：已经到门口]]',
        makeCtx({ ...baseChar, convoSettings: { autoOffline: true } }),
      );

      const messages = await DB.getMessagesByCharId(baseChar.id, true);
      expect(count).toBe(1);
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('我到你楼下了。');
      expect(messages[0].content).not.toContain('OFFLINE_START');
      expect(seen).toHaveLength(1);
      expect(seen[0]).toEqual(expect.objectContaining({
        charId: baseChar.id,
        scenario: expect.stringContaining('小夏 和 阿迟 已经从线上聊到线下现场'),
      }));

      await DB.deleteDB();
      localStorage.clear();
      seen.length = 0;
      await applyAssistantPostProcessing(
        '我到你楼下了。\n[[OFFLINE_START]]',
        makeCtx({ ...baseChar, convoSettings: { autoOffline: false } }),
      );

      const disabledMessages = await DB.getMessagesByCharId(baseChar.id, true);
      expect(disabledMessages).toHaveLength(1);
      expect(disabledMessages[0].content).toBe('我到你楼下了。');
      expect(disabledMessages[0].content).not.toContain('OFFLINE_START');
      expect(seen).toHaveLength(0);
    } finally {
      window.removeEventListener(OFFLINE_START_EVENT, handler);
    }
  });

  it('uses local scene detection without directives and respects long-distance mode', async () => {
    const seen: unknown[] = [];
    const handler = (event: Event) => seen.push((event as CustomEvent).detail);
    window.addEventListener(OFFLINE_START_EVENT, handler);

    try {
      await applyAssistantPostProcessing(
        '开门，我就在门口。',
        makeCtx({ ...baseChar, convoSettings: { autoOffline: true } }),
      );
      expect(seen).toHaveLength(1);

      await DB.deleteDB();
      seen.length = 0;
      await applyAssistantPostProcessing(
        '开门，我就在门口。\n[[OFFLINE_START]]',
        makeCtx({ ...baseChar, convoSettings: { autoOffline: true, longDistanceMode: true } }),
      );

      const messages = await DB.getMessagesByCharId(baseChar.id, true);
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('开门，我就在门口。');
      expect(seen).toHaveLength(0);
    } finally {
      window.removeEventListener(OFFLINE_START_EVENT, handler);
    }
  });

  it('suppresses offline auto-start for one-shot online followups', async () => {
    const seen: unknown[] = [];
    const handler = (event: Event) => seen.push((event as CustomEvent).detail);
    window.addEventListener(OFFLINE_START_EVENT, handler);

    try {
      const ctx = makeCtx({ ...baseChar, convoSettings: { autoOffline: true } }) as PostProcessCtx & { suppressAutoOffline?: boolean };
      ctx.suppressAutoOffline = true;

      await applyAssistantPostProcessing(
        '刚才线下结束了，我先回到线上和你说一声。\n[[OFFLINE_START]]',
        ctx,
      );

      const messages = await DB.getMessagesByCharId(baseChar.id, true);
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('刚才线下结束了，我先回到线上和你说一声。');
      expect(seen).toHaveLength(0);
      expect(consumeOfflinePending(baseChar.id)).toBe(false);
    } finally {
      window.removeEventListener(OFFLINE_START_EVENT, handler);
    }
  });

  it('stores future meetups for later instead of opening offline immediately', async () => {
    const seen: unknown[] = [];
    const handler = (event: Event) => seen.push((event as CustomEvent).detail);
    window.addEventListener(OFFLINE_START_EVENT, handler);

    try {
      await applyAssistantPostProcessing(
        '那就明天下午三点楼下见，我去接你。',
        makeCtx({ ...baseChar, convoSettings: { autoOffline: true } }),
      );

      expect(seen).toHaveLength(0);
      expect(consumeDueOfflineAutoStarts({
        mode: 'private',
        targetId: baseChar.id,
        nowMs: Date.now() + 3 * 24 * 60 * 60 * 1000,
      })).toEqual([
        expect.objectContaining({
          mode: 'private',
          targetId: baseChar.id,
          scenario: expect.stringContaining('现在已经到了约定时间'),
          matchedText: expect.stringContaining('明天下午三点楼下见'),
        }),
      ]);
    } finally {
      window.removeEventListener(OFFLINE_START_EVENT, handler);
    }
  });
});
