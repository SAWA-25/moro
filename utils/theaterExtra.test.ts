import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterProfile, TheaterFauxKind, TheaterQuizSession, UserProfile } from '../types';
import {
    getBankQuestions,
    bankQuizNames,
    bankQuizNamesByTag,
    bankQuizTags,
    quizBankMeta,
} from './theaterExtraBank';
import {
    LEGACY_THEATER_QUIZ_SETTINGS,
    formatFauxExport,
    genExtraPiece,
    normalizeFauxData,
    normalizeTheaterQuizSession,
    parseQuizResult,
} from './theaterExtra';
import { extraFauxPrompt } from './theaterPrompts';

const FAUX_KINDS: TheaterFauxKind[] = ['wechat', 'moments', 'xhs', 'forum', 'weibo', 'qzone', 'douban', 'campus', 'memo', 'schedule', 'receipt', 'browser'];
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

describe('theater extra quiz bank metadata', () => {
    it('exposes readable metadata and tags for built-in quiz banks', () => {
        const names = bankQuizNames();
        expect(names).toContain('恋爱相性甜蜜问');
        expect(names).toContain('深夜灵魂拷问');

        const meta = quizBankMeta('恋爱相性甜蜜问');
        expect(meta.title).toBe('恋爱相性甜蜜问');
        expect(meta.tags).toContain('恋爱');
        expect(meta.questionCount).toBe(getBankQuestions('恋爱相性甜蜜问')?.length);
        expect(meta.description).toContain('亲密问答');

        expect(bankQuizTags()).toEqual(expect.arrayContaining(['恋爱', '喜剧', '深夜']));
        expect(bankQuizNamesByTag('喜剧')).toEqual(expect.arrayContaining(['朋友局互损问卷', '无厘头默契测试']));
        expect(bankQuizNamesByTag('全部')).toEqual(names);
    });

    it('keeps legacy exact and trimmed bank lookup compatible', () => {
        const exact = getBankQuestions('同居日常小检查');
        const trimmed = getBankQuestions('  同居日常小检查  ');

        expect(exact?.[0]).toContain('一起住');
        expect(trimmed).toBe(exact);
        expect(getBankQuestions('没有这份问卷')).toBeNull();
    });
});

describe('normalizeTheaterQuizSession', () => {
    it('opens old quiz sessions with classic settings and safe item defaults', () => {
        const legacy = {
            id: 'q1',
            title: '旧问卷',
            topic: '旧问卷',
            status: 'active',
            participantIds: ['c1'],
            currentIndex: 0,
            total: 3,
            items: [
                {
                    no: 1,
                    question: '第一题？',
                    at: 1,
                },
            ],
            createdAt: 1,
            lastActiveAt: 2,
        } as unknown as TheaterQuizSession;

        const normalized = normalizeTheaterQuizSession(legacy);

        expect(normalized.settings).toEqual(LEGACY_THEATER_QUIZ_SETTINGS);
        expect(normalized.items[0].answers).toEqual({});
        expect(normalized.items[0].comments).toEqual([]);
        expect(normalized.items[0].state).toBe('answering');
    });
});

describe('parseQuizResult', () => {
    it('parses structured report JSON and clamps scores', () => {
        const result = parseQuizResult(JSON.stringify({
            title: '访谈画像',
            summary: '默契明显。',
            totalScore: 108,
            dimensions: [
                { key: 'chemistry', label: '默契', score: 96.4, summary: '接得住。' },
                { key: 'security', label: '安全感', score: -2, summary: '还要确认。' },
            ],
            highlights: ['会照顾彼此'],
            frictions: ['容易嘴硬'],
            suggestions: ['挑一道题继续聊'],
        }));

        expect(result.title).toBe('访谈画像');
        expect(result.totalScore).toBe(100);
        expect(result.dimensions[0]).toMatchObject({ key: 'chemistry', score: 96 });
        expect(result.dimensions[1]).toMatchObject({ key: 'security', score: 0 });
        expect(result.highlights).toEqual(['会照顾彼此']);
        expect(result.fallbackText).toBeUndefined();
    });

    it('falls back to a plain text report when JSON cannot be parsed', () => {
        const text = '这是一段纯文本画像：轻松、有默契，但还有一点点需要继续确认。';
        const result = parseQuizResult(text);

        expect(result.title).toBe('番外问卷画像报告');
        expect(result.summary).toBe(text);
        expect(result.fallbackText).toBe(text);
        expect(result.dimensions.length).toBeGreaterThan(0);
        expect(result.highlights.length).toBeGreaterThan(0);
    });
});

describe('extraFauxPrompt', () => {
    it('gives every faux kind a strict JSON schema instruction', () => {
        for (const kind of FAUX_KINDS) {
            const prompt = extraFauxPrompt({
                kind,
                charName: '阿澈',
                description: '冷静但嘴硬。',
                userName: '我',
                userBio: '喜欢夜跑。',
                keyword: '深夜想念',
            });
            const text = `${prompt.sys}\n${prompt.user}`;

            expect(text).toContain('严格只输出 JSON');
            expect(text).toContain('所有内容用中文');
            expect(text).toContain('图片只返回 images 数量');
            expect(text).toMatch(/\{.+\}/s);
        }
    });
});

describe('normalizeFauxData', () => {
    it('returns null for unparseable faux JSON', () => {
        expect(normalizeFauxData('wechat', 'not json')).toBeNull();
        expect(normalizeFauxData('memo', null)).toBeNull();
    });

    it('normalizes all 12 faux kinds with safe defaults', () => {
        for (const kind of FAUX_KINDS) {
            const data = normalizeFauxData(kind, { title: '', messages: [{ from: 'bot', content: '你好' }], images: 99, likes: 'bad' });
            expect(data).toBeTruthy();
        }

        const wechat = normalizeFauxData('wechat', { messages: Array.from({ length: 50 }, (_, i) => ({ from: i % 2 ? 'user' : 'char', text: `消息${i}` })) });
        expect(wechat && 'messages' in wechat ? wechat.messages.length : 0).toBe(40);

        const xhs = normalizeFauxData('xhs', { images: 99, likes: 'NaN', comments: Array.from({ length: 20 }, (_, i) => ({ text: `评论${i}` })) });
        expect(xhs && 'images' in xhs ? xhs.images : 0).toBe(9);
        expect(xhs && 'comments' in xhs ? xhs.comments.length : 0).toBe(10);

        const receipt = normalizeFauxData('receipt', { items: [{ name: '奶茶', count: -5, price: 'abc' }], total: 'abc' });
        const receiptItems = receipt && 'items' in receipt ? receipt.items as Array<{ count?: number }> : [];
        expect(receiptItems[0]?.count).toBe(1);
        expect(receipt && 'total' in receipt ? receipt.total : -1).toBe(0);
    });
});

describe('formatFauxExport', () => {
    it('formats structured faux data as a readable chat summary', () => {
        const text = formatFauxExport({
            kind: 'weibo',
            charName: '阿澈',
            keyword: '路人偶遇',
            fallbackText: '',
            data: {
                topic: '#阿澈路人偶遇#',
                rank: '热搜第3',
                posts: [{ author: '吃瓜号', text: '刚刚看到两个人一起买夜宵。', time: '刚刚', likes: 120, reposts: 4, comments: 18 }],
                hotComments: [{ name: '网友A', text: '这还不明显吗', likes: 66 }],
            },
        });

        expect(text).toContain('【番外·微博热搜】');
        expect(text).toContain('角色：阿澈');
        expect(text).toContain('主题：路人偶遇');
        expect(text).toContain('热搜第3 #阿澈路人偶遇#');
        expect(text).not.toContain('"posts"');
    });

    it('keeps plain fallback text when structured parsing failed', () => {
        const text = formatFauxExport({
            kind: 'memo',
            charName: '阿澈',
            fallbackText: '这次只生成了一段文字稿。',
            data: null,
        });

        expect(text).toContain('【番外·备忘录】');
        expect(text).toContain('这次只生成了一段文字稿。');
    });
});

describe('theater extra API usage meta', () => {
    it('keeps custom API role and binding in llmComplete meta', async () => {
        const fetchFn = vi.fn(async () => jsonResponse({
            choices: [{ message: { content: '这是一段番外正文。' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
        }));
        global.fetch = fetchFn as unknown as typeof fetch;

        await genExtraPiece({
            api: {
                baseUrl: 'https://custom.example.test/v1',
                apiKey: '',
                model: 'custom-model',
                apiRole: 'custom',
                apiBinding: '折子戏番外专用 API',
            },
            kind: 'diary',
            char: { id: 'c1', name: '阿澈', systemPrompt: '冷静但嘴硬。' } as CharacterProfile,
            userProfile: { name: '我', avatar: '', bio: '喜欢夜跑。' } as UserProfile,
            prompt: '写一段晚饭后的番外',
        });

        const init = (fetchFn.mock.calls as any[])[0]?.[1] as RequestInit & { __moroMeta?: any };
        expect(init.__moroMeta).toMatchObject({
            featureId: 'theater.extra',
            apiRole: 'custom',
            apiBinding: '折子戏番外专用 API',
        });
    });
});
