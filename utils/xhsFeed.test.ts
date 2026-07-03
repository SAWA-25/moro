import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterProfile, UserProfile } from '../types';
import {
  buildCharacterLifePostPrompt,
  buildFeedSystemPrompt,
  chooseXhsCoverUrl,
  classifyXhsFeedCategory,
  FEED_BATCH_SIZE,
  generateCharacterLifePost,
  getXhsCharacterPostQuota,
  resolveXhsAuthorCharacter,
} from './xhsFeed';

const sameNameChars = [
  { id: 'char-a', modelId: 'model-a', name: 'Same Name', systemPrompt: 'First persona.' },
  { id: 'char-b', name: 'Same Name', systemPrompt: 'Second persona.' },
] as CharacterProfile[];

const user = { name: 'User', avatar: '', bio: 'tester' } as UserProfile;

const jsonResponse = (data: unknown) => new Response(JSON.stringify(data), {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
});

let originalFetch: typeof fetch | undefined;

beforeEach(() => {
  originalFetch = global.fetch;
});

afterEach(() => {
  if (originalFetch) global.fetch = originalFetch;
  else delete (globalThis as any).fetch;
  vi.restoreAllMocks();
});

describe('xhs character identity', () => {
  it('scales character post quota with roster size', () => {
    expect(getXhsCharacterPostQuota(0)).toBe(0);
    expect(getXhsCharacterPostQuota(1)).toBe(1);
    expect(getXhsCharacterPostQuota(4)).toBe(4);
    expect(getXhsCharacterPostQuota(8)).toBeGreaterThan(getXhsCharacterPostQuota(4));
    expect(getXhsCharacterPostQuota(20)).toBeGreaterThan(getXhsCharacterPostQuota(8));
    expect(getXhsCharacterPostQuota(100)).toBe(Math.floor(FEED_BATCH_SIZE * 0.6));
  });

  it('lists same-name posters with distinct charIds in the prompt', () => {
    const prompt = buildFeedSystemPrompt(sameNameChars, user);

    expect(prompt).toContain('Same Name (ID: model-a)');
    expect(prompt).toContain('Same Name (ID: char-b)');
    expect(prompt).toContain('charId="model-a"');
    expect(prompt).toContain('charId="char-b"');
    expect(prompt).toContain('角色帖目标 2 条');
    expect(prompt).toContain('真正归属以 charId 为准');
  });

  it('resolves character posts by charId before falling back to name', () => {
    const matched = resolveXhsAuthorCharacter(
      { isCharacter: true, author: 'Same Name', charId: 'char-b' },
      sameNameChars,
    );

    expect(matched?.id).toBe('char-b');
  });

  it('resolves by modelId when it differs from the storage id', () => {
    const matched = resolveXhsAuthorCharacter(
      { isCharacter: true, author: 'Same Name', charId: 'model-a' },
      sameNameChars,
    );

    expect(matched?.id).toBe('char-a');
  });

  it('uses author name only as a fallback and prevents duplicate character authors', () => {
    const used = new Set<string>();

    const first = resolveXhsAuthorCharacter({ isCharacter: true, author: 'Same Name' }, sameNameChars, used);
    const duplicate = resolveXhsAuthorCharacter({ isCharacter: true, author: 'Same Name', charId: first?.id }, sameNameChars, used);

    expect(first?.id).toBe('char-a');
    expect(duplicate).toBeUndefined();
  });

  it('classifies generated posts into stable local categories', () => {
    expect(classifyXhsFeedCategory(['探店', '咖啡'], '周末咖啡店', '拿铁还不错')).toBe('food');
    expect(classifyXhsFeedCategory(['考研倒计时'], '图书馆自习', '今天刷完一套题')).toBe('study');
    expect(classifyXhsFeedCategory(['乱写'], '没有明显关键词', '只是路过')).toBe('other');
  });

  it('chooses stock covers by matching post tags first', () => {
    const used = new Set<string>();
    const url = chooseXhsCoverUrl([
      { id: 'a', url: 'https://img.test/food.jpg', tags: ['咖啡', '探店'], addedAt: 1, usedCount: 0 },
      { id: 'b', url: 'https://img.test/work.jpg', tags: ['工位'], addedAt: 2, usedCount: 0 },
    ], ['探店', '甜品'], used, () => 0);

    expect(url).toBe('https://img.test/food.jpg');
    expect(used.has('https://img.test/food.jpg')).toBe(true);
  });

  it('builds single-character life post prompts with identity anchor and category contract', () => {
    const prompt = buildCharacterLifePostPrompt(sameNameChars[0], user);

    expect(prompt).toContain('charId="model-a"');
    expect(prompt).toContain('category');
    expect(prompt).toContain('只保存在本地');
  });

  it('keeps custom API role and binding in the fetch meta', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({
      choices: [{
        message: {
          content: JSON.stringify([{
            author: 'Same Name',
            charId: 'model-a',
            isCharacter: true,
            title: '今天的小事',
            body: '今天路过一家新开的咖啡店，顺手记了一点生活碎片。',
            category: 'life',
            tags: ['日常', '咖啡', '熟人近况', '生活记录'],
            likes: 12,
            comments: [],
          }]),
        },
        finish_reason: 'stop',
      }],
    }));
    global.fetch = fetchFn as unknown as typeof fetch;

    await generateCharacterLifePost({
      baseUrl: 'https://custom.example.test/v1',
      apiKey: '',
      model: 'custom-model',
      apiRole: 'custom',
      apiBinding: '见闻簿专用 API',
    } as any, sameNameChars[0], user);

    const init = (fetchFn.mock.calls as any[])[0]?.[1] as RequestInit & { __moroMeta?: any };
    expect(init.__moroMeta).toMatchObject({
      featureId: 'social.generate',
      apiRole: 'custom',
      apiBinding: '见闻簿专用 API',
    });
  });
});
