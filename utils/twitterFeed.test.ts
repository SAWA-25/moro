import { describe, expect, it } from 'vitest';
import {
    TWITTER_BATCH_SIZE,
    TWITTER_MIN_BATCH_SIZE,
    appendTwitterDMMessage,
    buildTwitterAccounts,
    createDMThread,
    createTwitterSearchRecord,
    getTwitterTranslationText,
    fallbackTwitterTweets,
    inferCharPostingWeight,
    materializeTwitterReactions,
    materializeTwitterTweets,
    normalizeTwitterLang,
    parseTwitterJsonLoose,
    searchTwitter,
    translateTwitterTextLocal,
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
});

describe('fallbackTwitterTweets', () => {
    it('returns at least the minimum and defaults to batch size', () => {
        expect(fallbackTwitterTweets(chars, user, 1).length).toBeGreaterThanOrEqual(TWITTER_MIN_BATCH_SIZE);
        expect(fallbackTwitterTweets(chars, user).length).toBe(TWITTER_BATCH_SIZE);
    });

    it('includes international virtual posts', () => {
        const tweets = fallbackTwitterTweets([], user);
        expect(tweets.some(t => t.language && t.language !== 'zh-CN')).toBe(true);
        expect(tweets.every(t => t.content.length > 20)).toBe(true);
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
    });

    it('searches tweets by language, topic, content, and people', () => {
        const tweets = materializeTwitterTweets([
            { authorName: 'Noah Park', authorHandle: '@noah', language: 'en', country: 'Canada', content: 'Timeline design note', topics: ['tech culture'] },
            { charId: 'c1', authorName: '林夏', content: '今天继续吐槽时间线', topics: ['今日碎片'] },
        ], chars, user);
        const accounts = buildTwitterAccounts(chars, user, null, [], tweets);
        expect(searchTwitter('timeline', tweets, accounts, { language: 'en' }).top).toHaveLength(1);
        expect(searchTwitter('今日碎片', tweets, accounts).top).toHaveLength(1);
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
        ], tweet, chars);
        expect(result.replies).toHaveLength(1);
        expect(result.notifications).toHaveLength(4);
        expect(result.patch.replyCount).toBe(1);
        expect(result.patch.likes).toBe(1);
        expect(result.patch.retweets).toBe(1);
        expect(result.patch.quotes).toBe(1);
    });
});
