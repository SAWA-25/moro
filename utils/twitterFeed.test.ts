import { describe, expect, it } from 'vitest';
import {
    TWITTER_BATCH_SIZE,
    TWITTER_MIN_BATCH_SIZE,
    buildTwitterForYouFeed,
    appendTwitterDMMessage,
    buildTwitterAccounts,
    createDMThread,
    createTwitterSearchRecord,
    enforceTwitterPublicMix,
    getTwitterTranslationText,
    fallbackTwitterTweets,
    generateTwitterTimeline,
    inferCharPostingWeight,
    materializeTwitterReactions,
    materializeTwitterTweets,
    normalizeTwitterLang,
    parseTwitterJsonLoose,
    searchTwitter,
    translateTwitterTextLocal,
    twitterPublicCharacterQuota,
    twitterTranslationLabel,
} from './twitterFeed';
import type { CharacterProfile, TwitterTweet, UserProfile } from '../types';

const user: UserProfile = { name: 'User', avatar: '', bio: 'tester' } as UserProfile;
const chars = [
    { id: 'c1', name: '林夏', avatar: 'lin.png', systemPrompt: '爱吐槽，话很多', socialProfile: { handle: '@linxia' } },
    { id: 'c2', name: '阿青', avatar: 'qing.png', systemPrompt: '冷静敏锐' },
] as CharacterProfile[];

describe('parseTwitterJsonLoose', () => {
    it('parses plain arrays, fenced arrays, object-wrapped arrays, and truncated arrays', () => {
        expect(parseTwitterJsonLoose('[{"content":"a"}]')).toHaveLength(1);
        expect(parseTwitterJsonLoose('```json\n[{"content":"a"}]\n```')).toHaveLength(1);
        expect(parseTwitterJsonLoose('{"tweets":[{"content":"a"},{"content":"b"}]}')).toHaveLength(2);
        const cut = '[{"content":"done"},{"content":"also done"},{"content":"half';
        const rescued = parseTwitterJsonLoose(cut);
        expect(rescued).toHaveLength(2);
        expect(rescued[1].content).toBe('also done');
    });
});

describe('materializeTwitterTweets', () => {
    it('keeps repeated character authors instead of limiting one post per character', () => {
        const raw = [
            { authorType: 'character', charId: 'c1', authorName: '林夏', content: '第一条', replies: [] },
            { authorType: 'character', charId: 'c1', authorName: '林夏', content: '第二条继续说', replies: [] },
            { authorType: 'character', charId: 'c1', authorName: '林夏', content: '第三条还是我', replies: [] },
        ];
        const tweets = materializeTwitterTweets(raw, chars, user);
        expect(tweets).toHaveLength(3);
        expect(tweets.every(t => t.charId === 'c1')).toBe(true);
        expect(tweets.every(t => t.authorType === 'character')).toBe(true);
    });

    it('links quote/retweet sources by sourceIndex', () => {
        const tweets = materializeTwitterTweets([
            { authorName: '路人甲', content: '原推内容', topics: ['源头'] },
            { authorName: '路人乙', content: '引用一下', sourceIndex: 0, quoteNote: '有点意思' },
        ], chars, user);
        expect(tweets[1].sourceTweetId).toBe(tweets[0].id);
        expect(tweets[1].sourceTweet?.content).toBe('原推内容');
        expect(tweets[1].quoteNote).toBe('有点意思');
    });

    it('materializes nested replies from characters and NPCs', () => {
        const tweets = materializeTwitterTweets([{
            authorName: '路人甲',
            content: '大家怎么看',
            replies: [
                { charId: 'c2', authorName: '阿青', content: '我觉得先别急。', likes: 8 },
                { authorName: '普通网友', content: '蹲一个后续。', likes: 1 },
            ],
        }], chars, user);
        expect(tweets[0].replies).toHaveLength(2);
        expect(tweets[0].replies[0].authorType).toBe('character');
        expect(tweets[0].replies[0].charId).toBe('c2');
    });

    it('does not keep phantom reply counts without visible replies', () => {
        const tweets = materializeTwitterTweets([{
            authorName: '路人甲',
            content: '这条看起来很热闹',
            replyCount: 9,
            replies: [],
        }], chars, user);
        expect(tweets[0].replyCount).toBe(0);
        expect(tweets[0].replies).toHaveLength(0);
    });

    it('keeps multilingual metadata and account fields', () => {
        const tweets = materializeTwitterTweets([{
            authorName: 'Noah Park',
            authorHandle: '@noah',
            authorBio: 'Designer in Toronto',
            authorLocation: 'Toronto',
            language: 'en',
            country: 'Canada',
            content: 'A good timeline has doors behind every post.',
            topics: ['tech culture'],
            replies: [{ authorName: '佐藤未央', language: 'ja', country: '日本', content: 'わかる。' }],
        }], chars, user);
        expect(tweets[0].language).toBe('en');
        expect(tweets[0].country).toBe('Canada');
        expect(tweets[0].authorBio).toContain('Designer');
        expect(tweets[0].accountId).toContain('npc:');
        expect(tweets[0].replies[0].language).toBe('ja');
    });

    it('materializes rich media, polls, mentions, and thread metadata', () => {
        const tweets = materializeTwitterTweets([{
            authorName: 'Noah Park',
            authorHandle: '@noah',
            content: 'Vote on this tiny design thing @User https://developer.mozilla.org/',
            topics: ['design'],
            mentions: ['@User'],
            threadId: 'thread-1',
            threadIndex: 1,
            threadSize: 3,
            media: [{ type: 'link-card', url: 'https://developer.mozilla.org/', title: 'Design note', description: 'A link card', domain: 'developer.mozilla.org' }],
            poll: { question: 'Which one?', options: [{ label: 'A', votes: 2 }, { label: 'B', votes: 5 }] },
        }], chars, user);
        expect(tweets[0].media?.[0].type).toBe('link-card');
        expect(tweets[0].media?.[0].title).toBe('Design note');
        expect(tweets[0].poll?.options).toHaveLength(2);
        expect(tweets[0].mentions).toContain('@User');
        expect(tweets[0].threadSize).toBe(3);
    });
});

describe('fallbackTwitterTweets', () => {
    it('returns at least the minimum and defaults to batch size', () => {
        expect(fallbackTwitterTweets(chars, user, 1).length).toBeGreaterThanOrEqual(TWITTER_MIN_BATCH_SIZE);
        expect(fallbackTwitterTweets(chars, user).length).toBe(TWITTER_BATCH_SIZE);
    });

    it('keeps public fallback dominated by NPC strangers', () => {
        const tweets = fallbackTwitterTweets(chars, user);
        const characterCount = tweets.filter(t => t.authorType === 'character').length;
        expect(characterCount).toBeLessThanOrEqual(twitterPublicCharacterQuota(tweets.length));
        expect(tweets.filter(t => t.authorType === 'npc').length).toBeGreaterThanOrEqual(tweets.length - characterCount);
    });

    it('includes international virtual posts', () => {
        const tweets = fallbackTwitterTweets([], user);
        expect(tweets.some(t => t.language && t.language !== 'zh-CN')).toBe(true);
        expect(tweets.every(t => t.content.length > 20)).toBe(true);
    });

    it('uses real image URLs for fallback image media', () => {
        const tweets = fallbackTwitterTweets([], user);
        const imageTweet = tweets.find(t => t.media?.some(m => m.type === 'image'));
        expect(imageTweet?.media?.some(m => m.type === 'image' && /^https:\/\/picsum\.photos\//.test(m.url || ''))).toBe(true);
    });
});

describe('public timeline mix enforcement', () => {
    it('keeps only the allowed number of character posts and fills with NPCs', () => {
        const raw = [
            { authorType: 'character', charId: 'c1', authorName: '鏋楀', content: 'public character note one' },
            { authorType: 'character', charId: 'c2', authorName: '闃块潚', content: 'public character note two' },
            { authorType: 'character', charId: 'c1', authorName: '鏋楀', content: 'public character note three' },
            { authorName: 'Noah Park', authorHandle: '@noah', language: 'en', country: 'Canada', content: 'NPC timeline note about design', topics: ['design'] },
        ];
        const mixed = enforceTwitterPublicMix(materializeTwitterTweets(raw, chars, user), chars, user, TWITTER_BATCH_SIZE);
        expect(mixed).toHaveLength(TWITTER_BATCH_SIZE);
        expect(mixed.filter(t => t.authorType === 'character')).toHaveLength(twitterPublicCharacterQuota(TWITTER_BATCH_SIZE));
        expect(mixed.filter(t => t.authorType === 'npc').length).toBeGreaterThanOrEqual(TWITTER_BATCH_SIZE - twitterPublicCharacterQuota(TWITTER_BATCH_SIZE));
    });

    it('drops model-generated user-authored public posts without inspecting normal content', () => {
        const raw = [
            { authorType: 'user', authorName: 'User', content: 'I should not be generated into public refresh' },
            { authorName: 'Moro', authorHandle: '@moro', content: '主人今天醒得好早，黑眼圈都出来了' },
            { authorName: 'Watcher', authorHandle: '@watcher', content: '@User looks tired today' },
            { authorName: 'Noah Park', authorHandle: '@noah', language: 'en', country: 'Canada', content: 'A normal stranger post about morning trains', topics: ['city'] },
        ];
        const mixed = enforceTwitterPublicMix(materializeTwitterTweets(raw, chars, user), chars, user, TWITTER_BATCH_SIZE);
        expect(mixed.some(t => t.authorType === 'user')).toBe(false);
        expect(mixed.some(t => /主人|@User/.test(t.content))).toBe(true);
        expect(mixed.some(t => t.content.includes('normal stranger post'))).toBe(true);
    });

    it('limits legacy For You character density while preserving user posts', () => {
        const raw = [
            { authorType: 'character', charId: 'c1', authorName: '鏋楀', content: 'legacy character top one' },
            { authorType: 'user', authorName: 'User', content: 'my own tweet stays visible' },
            { authorType: 'character', charId: 'c2', authorName: '闃块潚', content: 'legacy character top two' },
            ...Array.from({ length: 11 }).map((_, i) => ({
                authorName: `NPC ${i}`,
                authorHandle: `@npc_${i}`,
                language: 'en',
                country: 'US',
                content: `legacy npc post ${i}`,
                topics: ['npc'],
            })),
        ];
        const feed = buildTwitterForYouFeed(materializeTwitterTweets(raw, chars, user), user);
        expect(feed.some(t => t.authorType === 'user' && t.content.includes('my own tweet'))).toBe(true);
        const firstPublicTen = feed.filter(t => t.authorType !== 'user').slice(0, 10);
        expect(firstPublicTen.filter(t => t.authorType === 'character').length).toBeLessThanOrEqual(1);
    });

    it('uses prompt-only guidance for focused character timelines', async () => {
        const originalFetch = globalThis.fetch;
        let requestBody: any = null;
        const payload = Array.from({ length: TWITTER_MIN_BATCH_SIZE }).map((_, i) => ({
            authorType: 'character',
            charId: 'c1',
            authorName: '鏋楀',
            content: i === 0 ? '主人今天醒得好早，像是没睡够' : `整理完书桌后的角色自己状态 ${i}`,
        }));
        globalThis.fetch = (async (_url, init) => {
            requestBody = JSON.parse(String((init as RequestInit)?.body || '{}'));
            return new Response(JSON.stringify({
            choices: [{ message: { content: JSON.stringify(payload) } }],
            }), { status: 200 });
        }) as typeof fetch;
        try {
            const tweets = await generateTwitterTimeline(
                { baseUrl: 'https://api.example.test', apiKey: 'sk-test', model: 'test-model' } as any,
                [chars[0]],
                user,
                [],
                [],
                { mode: 'focused' },
            );
            const systemPrompt = requestBody?.messages?.[0]?.content || '';
            expect(systemPrompt).toContain('Character tweets must show the character account');
            expect(systemPrompt).not.toContain('User: User');
            expect(tweets.some(t => /主人|醒得好早/.test(t.content))).toBe(true);
            expect(tweets.some(t => t.content.includes('整理完书桌'))).toBe(true);
            expect(tweets).toHaveLength(TWITTER_MIN_BATCH_SIZE);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});

describe('accounts, search, and DMs', () => {
    it('builds complete accounts and persona-driven posting weights', () => {
        const accounts = buildTwitterAccounts(chars, user, null, [], []);
        const linxia = accounts.find(a => a.charId === 'c1');
        const aqing = accounts.find(a => a.charId === 'c2');
        expect(linxia?.handle).toBe('@linxia');
        expect(linxia?.postingWeight).toBeGreaterThan(aqing?.postingWeight || 0);
        expect(inferCharPostingWeight(chars[0])).toBeGreaterThan(inferCharPostingWeight(chars[1]));
        expect(linxia?.profileTabs).toContain('about');
        expect(linxia?.profileSummary).toBeTruthy();
        expect(linxia?.recentStatus).toBeTruthy();
    });

    it('searches tweets by language, topic, content, and people', () => {
        const tweets = materializeTwitterTweets([
            { authorName: 'Noah Park', authorHandle: '@noah', language: 'en', country: 'Canada', content: 'Timeline design note', topics: ['tech culture'] },
            { charId: 'c1', authorName: '林夏', content: '今天继续吐槽时间线', topics: ['今日碎片'] },
            { authorName: 'Linker', content: 'Look at this', topics: ['links'], media: [{ type: 'link-card', url: 'https://archive.org/', title: 'Hidden card title', domain: 'archive.org' }], poll: { options: [{ label: 'Quiet option', votes: 1 }, { label: 'Loud option', votes: 2 }] } },
        ], chars, user);
        const accounts = buildTwitterAccounts(chars, user, null, [], tweets);
        expect(searchTwitter('timeline', tweets, accounts, { language: 'en' }).top).toHaveLength(1);
        expect(searchTwitter('今日碎片', tweets, accounts).top).toHaveLength(1);
        expect(searchTwitter('Hidden card', tweets, accounts).top).toHaveLength(1);
        expect(searchTwitter('Quiet option', tweets, accounts).top).toHaveLength(1);
        expect(searchTwitter('linxia', tweets, accounts).people.some(a => a.charId === 'c1')).toBe(true);
        const rec = createTwitterSearchRecord('timeline', 1);
        expect(rec.query).toBe('timeline');
    });

    it('creates DM threads and appends tweet-card messages', () => {
        const account = buildTwitterAccounts(chars, user, null, [], []).find(a => a.charId === 'c1')!;
        const thread = createDMThread(account);
        const next = appendTwitterDMMessage(thread, {
            senderType: 'user',
            content: '看看这条',
            tweetSnapshot: {
                id: 't1',
                authorName: 'Noah',
                authorHandle: '@noah',
                content: 'Timeline design note',
                topics: ['tech'],
                replyCount: 0,
                retweets: 0,
                likes: 1,
                language: 'en',
            },
        });
        expect(next.messages).toHaveLength(1);
        expect(next.lastMessage).toContain('转发推文');
    });
});

describe('localized translation helpers', () => {
    it('normalizes browser/profile language codes', () => {
        expect(normalizeTwitterLang('zh-Hans-CN')).toBe('zh-CN');
        expect(normalizeTwitterLang('zh_TW')).toBe('zh-TW');
        expect(normalizeTwitterLang('en-US')).toBe('en');
        expect(twitterTranslationLabel('ja-JP')).toBe('日本語');
    });

    it('picks the best local translation with Chinese fallback', () => {
        const translations = {
            'zh-CN': { text: '简体译文' },
            en: { text: 'English translation' },
        };
        expect(getTwitterTranslationText(translations, 'en-US')).toBe('English translation');
        expect(getTwitterTranslationText(translations, 'zh-TW')).toBe('简体译文');
        expect(getTwitterTranslationText(translations, 'fr')).toBe('简体译文');
    });

    it('creates a usable local translation without API config', () => {
        const translated = translateTwitterTextLocal(
            'Tiny product thought: a timeline feels alive when every post has a door behind it.',
            'zh-CN',
            'en',
        );
        expect(translated).toContain('本地速译');
        expect(translated).toContain('时间线');
        expect(translated.length).toBeGreaterThan(12);
    });

    it('preserves handles, hashtags, and links in local translation', () => {
        const translated = translateTwitterTextLocal(
            'Replying to @noahpark about timeline design #indieWeb https://example.com/post',
            'zh-CN',
            'en',
        );
        expect(translated).toContain('@noahpark');
        expect(translated).toContain('#indieWeb');
        expect(translated).toContain('https://example.com/post');
    });
});

describe('materializeTwitterReactions', () => {
    const tweet: TwitterTweet = {
        id: 't1',
        authorType: 'user',
        authorName: 'User',
        authorHandle: '@User',
        content: '今天想发一条推',
        topics: [],
        replies: [],
        replyCount: 0,
        retweets: 0,
        quotes: 0,
        likes: 0,
        views: 1,
        createdAt: Date.now(),
    };

    it('creates replies, counters, and notifications for user tweets', () => {
        const result = materializeTwitterReactions([
            { action: 'reply', charId: 'c1', authorName: '林夏', content: '我看见了。' },
            { action: 'like', charId: 'c1', authorName: '林夏' },
            { action: 'retweet', authorName: '路人' },
            { action: 'quote', charId: 'c2', authorName: '阿青', content: '转一下。' },
            { action: 'mention', authorName: 'Noah', content: '@User this made me think' },
            { action: 'follow', authorName: 'Mina' },
        ], tweet, chars);
        expect(result.replies).toHaveLength(1);
        expect(result.notifications).toHaveLength(6);
        expect(result.notifications.some(n => n.kind === 'mention')).toBe(true);
        expect(result.notifications.some(n => n.kind === 'follow')).toBe(true);
        expect(result.patch.replyCount).toBe(1);
        expect(result.patch.likes).toBe(1);
        expect(result.patch.retweets).toBe(1);
        expect(result.patch.quotes).toBe(1);
    });
});
