import { describe, it, expect } from 'vitest';
import {
    targetFloorCount, parseThreads, materializeThreads, fallbackThreads, fallbackReplies,
    parseForumReplies, materializeReplies, buildForumPrompt, buildThreadsPrompt, FORUM_BOARDS,
    levelOf, levelInfo, levelTitle, MAX_LEVEL, defaultForumMeta, isCheckedIn,
    checkIn, maxStreak, toggleFollowBoard, toggleCollect, toggleMutePost, addExp, boardStat,
    makeNotif, unreadCount, hotRank, userLikesReceived, votePoll, pollTotal,
    normalizeForumState, normalizeForumMeta, fallbackTopicEvent, ensureForumTopic,
    materializeCharReply, filterForumPosts, upsertForumDraft, removeForumDraft, touchRecentPost,
    loadForumTrendPack, normalizeForumTrendItems, defaultForumTrendPack, FORUM_TRENDS_KEY, FORUM_TRENDS_COOLDOWN_MS,
    buildForumPostShareSnapshot, buildForumSharePendingPayload, normalizeForumSharePendingPayload,
    removeForumPost, removeForumReply, removeForumSubReply, normalizeForumTags,
    buildCharThreadPrompt, dedupeForumPosts, fallbackCharThread, isDuplicateForumThreadDraft, isGenericCharThreadDraft,
    type ForumTrendPack,
    type RawReply, type ForumReply, type ForumPost, type ForumPoll, type CharBrief,
} from './forum';

const mkPost = (over: Partial<ForumPost> = {}): ForumPost => ({
    id: over.id || Math.random().toString(36).slice(2), boardId: 'chat', authorType: 'npc',
    authorName: '网友', title: 't', body: '', createdAt: Date.now(), lastActiveAt: Date.now(),
    likes: 0, replies: [], ...over,
});

describe('targetFloorCount', () => {
    it('恒在 30~588 之间（最低 30，最高几百）', () => {
        for (let i = 0; i < 500; i++) {
            const n = targetFloorCount();
            expect(n).toBeGreaterThanOrEqual(30);
            expect(n).toBeLessThanOrEqual(588);
            expect(Number.isInteger(n)).toBe(true);
        }
    });
    it('给定 seed 时确定可复现', () => {
        expect(targetFloorCount(1.23)).toBe(targetFloorCount(1.23));
    });
    it('能覆盖到「爆楼」(>=200) 区间', () => {
        let max = 0;
        for (let i = 0; i < 2000; i++) max = Math.max(max, targetFloorCount());
        expect(max).toBeGreaterThanOrEqual(200);
    });
});

describe('parseThreads', () => {
    it('解析数组、夹紧 floors 到 30~588、补默认 likes', () => {
        const raw = '```json\n[' +
            '{"author":"夜航船","title":"深夜睡不着","body":"来报个到","floors":9,"likes":42},' +     // floors<30 → 夹到 30
            '{"author":"吃瓜群众","title":"蹲后续","body":"","floors":9999,"likes":0},' +            // floors>588 → 588
            '{"title":"无作者也能解析","body":"x"}' +
            ']\n```';
        const ts = parseThreads(raw);
        expect(ts.length).toBe(3);
        expect(ts[0].floors).toBe(30);
        expect(ts[1].floors).toBe(588);
        expect(ts[2].floors).toBeGreaterThanOrEqual(30);
    });
    it('丢掉没有标题的条目，非 JSON 返回空', () => {
        expect(parseThreads('[{"author":"a","body":"无标题"}]')).toEqual([]);
        expect(parseThreads('抱歉')).toEqual([]);
    });
    it('被 max_tokens 截断（数组没收尾）也能救回已写完的帖子', () => {
        const raw = '```json\n[' +
            '{"author":"夜航船","title":"深夜睡不着","body":"来报个到","floors":80,"likes":12},' +
            '{"author":"吃瓜群众","title":"蹲后续","body":"在线等","floors":60,"likes":3},' +
            '{"author":"半截","title":"还没写完';   // 截断
        const ts = parseThreads(raw);
        expect(ts.length).toBe(2);
        expect(ts[0].title).toBe('深夜睡不着');
        expect(ts[1].title).toBe('蹲后续');
    });
    it('去重复话题：标题撞车的帖子只留一个', () => {
        const ts = parseThreads('[{"author":"a","title":"深夜睡不着","body":"x","floors":50,"likes":1},{"author":"b","title":"深夜睡不着","body":"另一个但标题一样","floors":60,"likes":2},{"author":"c","title":"今天好开心","body":"y","floors":40,"likes":3}]');
        expect(ts.length).toBe(2);
        expect(ts.map(t => t.title)).toEqual(['深夜睡不着', '今天好开心']);
    });
});

describe('materializeThreads · 去重复角色', () => {
    it('同一实名角色一批里只当一次楼主，其余转匿名', () => {
        const chars = [{ id: 'c1', name: '林夏', avatar: 'a.png' }];
        const raw = parseThreads('[{"author":"林夏","title":"帖一","body":"x","floors":50,"likes":1},{"author":"林夏","title":"帖二","body":"y","floors":50,"likes":1},{"author":"路人","title":"帖三","body":"z","floors":50,"likes":1}]');
        const posts = materializeThreads(raw, 'chat', chars);
        const charPosts = posts.filter(p => p.authorType === 'char');
        expect(charPosts.length).toBe(1);            // 林夏只当一次楼主
        expect(charPosts[0].authorId).toBe('c1');
    });
});

describe('materializeThreads', () => {
    it('落成 ForumPost：带 replyCount/generated，命中角色名→char', () => {
        const chars = [{ id: 'c1', name: '林夏', avatar: 'a.png' }];
        const raw = parseThreads('[{"author":"林夏","title":"冒个泡","body":"在吗","floors":120,"likes":5},{"author":"路人","title":"嗨","body":"y","floors":60,"likes":1}]');
        const posts = materializeThreads(raw, 'chat', chars);
        expect(posts.length).toBe(2);
        const linxia = posts.find(p => p.authorName === '林夏')!;
        expect(linxia.authorType).toBe('char');
        expect(linxia.authorId).toBe('c1');
        expect(linxia.replyCount).toBe(120);
        expect(linxia.generated).toBe(true);
        expect(linxia.replies).toEqual([]);
        const luren = posts.find(p => p.authorName === '路人')!;
        expect(luren.authorType).toBe('npc');
    });
});

describe('materializeThreads identity anchors', () => {
    it('uses charId anchors for same-name thread authors and avoids name guessing', () => {
        const chars = [
            { id: 'row-a', modelId: 'model-a', name: 'Same', avatar: 'a.png' },
            { id: 'row-b', modelId: 'model-b', name: 'Same', avatar: 'b.png' },
        ];
        const byAnchor = materializeThreads(parseThreads('[{"author":"Same","charId":"model-b","title":"anchor","body":"x","floors":50,"likes":1}]'), 'chat', chars);
        expect(byAnchor[0].authorType).toBe('char');
        expect(byAnchor[0].authorId).toBe('row-b');
        expect(byAnchor[0].avatar).toBe('b.png');

        const ambiguous = materializeThreads(parseThreads('[{"author":"Same","title":"ambiguous","body":"x","floors":50,"likes":1}]'), 'chat', chars);
        expect(ambiguous[0].authorType).toBe('npc');
        expect(ambiguous[0].authorId).toBeUndefined();
    });
});

describe('forum character thread safeguards', () => {
    it('keeps full character persona in single-character thread prompt', () => {
        const longPersona = `完整人设 ${'甲'.repeat(1200)} FORUM_PERSONA_SENTINEL`;
        const { system, user } = buildCharThreadPrompt({ id: 'c1', name: '林夏', persona: longPersona });
        expect(system).toContain('FORUM_PERSONA_SENTINEL');
        expect(user).toContain('不要写成通用网友');
    });

    it('fallback character thread uses persona hint and avoids generic lonely posts', () => {
        const char: CharBrief = { id: 'c1', name: '林夏', persona: '林夏是海边车站的画家，遇事先把伞往别人那边倾。' };
        const thread = fallbackCharThread(char);
        expect(thread.body).toContain('海边车站的画家');
        expect(isGenericCharThreadDraft(thread)).toBe(false);
    });

    it('detects duplicate character drafts but never dedupes user posts', () => {
        const posts = [
            mkPost({ id: 'u1', authorType: 'user', authorName: '我', title: '同标题', body: '同正文', createdAt: 1, lastActiveAt: 1 }),
            mkPost({ id: 'u2', authorType: 'user', authorName: '我', title: '同标题', body: '同正文', createdAt: 2, lastActiveAt: 2 }),
            mkPost({ id: 'c-old', authorType: 'char', authorId: 'c1', authorName: '林夏', title: '重复', body: '重复正文', createdAt: 1, lastActiveAt: 1 }),
            mkPost({ id: 'c-new', authorType: 'char', authorId: 'c1', authorName: '林夏', title: '重复', body: '重复正文', createdAt: 3, lastActiveAt: 3 }),
        ];
        const deduped = dedupeForumPosts(posts);
        expect(deduped.map(p => p.id)).toEqual(['u1', 'u2', 'c-new']);
        expect(isDuplicateForumThreadDraft(posts, { boardId: 'chat', title: '重复', body: '重复正文' }, { type: 'char', id: 'c1', name: '林夏' })).toBe(true);
    });
});

describe('forum identity prompts', () => {
    it('prints model ids and identity rules for generated replies', () => {
        const { user } = buildForumPrompt(
            { boardId: 'chat', title: 'topic', body: 'body' },
            [{ id: 'row-a', modelId: 'model-a', name: 'Same', persona: 'quiet' }],
            2,
        );
        expect(user).toContain('charId="model-a"');
        expect(user).toContain('Identity rule');
        expect(user).toContain('do not merge');
    });

    it('prints model ids and identity rules for generated threads', () => {
        const { user } = buildThreadsPrompt(
            FORUM_BOARDS[0],
            [{ id: 'row-a', modelId: 'model-a', name: 'Same', persona: 'quiet' }],
            2,
        );
        expect(user).toContain('charId="model-a"');
        expect(user).toContain('Identity rule');
        expect(user).toContain('do not merge');
    });
});

describe('fallbackThreads', () => {
    it('无 API 也能填满板块（≥count 个、各有标题与楼层）', () => {
        const ts = fallbackThreads('emo', 12);
        expect(ts.length).toBe(12);
        ts.forEach(t => {
            expect(t.title.length).toBeGreaterThan(0);
            expect(t.floors).toBeGreaterThanOrEqual(30);
        });
    });
    it('未知板块回退到水区池', () => {
        expect(fallbackThreads('nope', 3).length).toBe(3);
    });
    it('有趋势素材时生成不重复标题与更具体正文', () => {
        const ts = fallbackThreads('chat', 6, undefined, [{ title: '网友说这届打工人太抽象', source: '测试热榜', tags: ['打工人'] }]);
        expect(new Set(ts.map(t => t.title)).size).toBe(ts.length);
        expect(ts.some(t => t.title.includes('网友说这届打工人太抽象'))).toBe(true);
        expect(ts.every(t => t.body.length > 30)).toBe(true);
    });
    it('话题兜底会结合趋势素材生成不同角度', () => {
        const topic = fallbackTopicEvent('gossip', '2026-06-30');
        const ts = fallbackThreads('gossip', 4, topic, [{ title: '后续比正片还离谱', source: '测试热榜' }]);
        expect(ts.length).toBe(4);
        expect(new Set(ts.map(t => t.title)).size).toBeGreaterThan(1);
        expect(ts.some(t => t.body.includes('后续比正片还离谱'))).toBe(true);
    });
});

describe('ForumTrendPack', () => {
    const makeStorage = (initial?: Record<string, string>) => {
        const data = new Map(Object.entries(initial || {}));
        return {
            getItem: (key: string) => data.get(key) || null,
            setItem: (key: string, value: string) => { data.set(key, value); },
            dump: () => data,
        };
    };

    it('trend items 会去重、过滤空标题并限制数量', () => {
        const items = normalizeForumTrendItems([
            { title: ' 热梗 A ', source: 's' },
            { title: '热梗A', source: 's2' },
            { title: '', source: 'bad' },
            { title: '热梗 B', source: 's' },
        ], 2);
        expect(items.map(x => x.title)).toEqual(['热梗 A', '热梗 B']);
    });

    it('缓存未过期时不请求远端', async () => {
        const now = 1000;
        const cached: ForumTrendPack = { items: [{ title: '缓存热梗', source: 'cache' }], fetchedAt: now, expiresAt: now + FORUM_TRENDS_COOLDOWN_MS };
        const storage = makeStorage({ [FORUM_TRENDS_KEY]: JSON.stringify(cached) });
        let calls = 0;
        const pack = await loadForumTrendPack({
            now,
            storage,
            fetcher: async () => { calls++; return new Response('{}'); },
        });
        expect(calls).toBe(0);
        expect(pack.items[0].title).toBe('缓存热梗');
    });

    it('缓存过期时请求远端并写入本地缓存', async () => {
        const now = 10_000;
        const storage = makeStorage();
        const pack = await loadForumTrendPack({
            now,
            storage,
            fetcher: async () => new Response(JSON.stringify({ items: [{ title: '远端热梗', source: 'worker' }], fetchedAt: now - 1, expiresAt: now + 1 })),
        });
        expect(pack.items[0].title).toBe('远端热梗');
        expect(pack.expiresAt).toBe(now + FORUM_TRENDS_COOLDOWN_MS);
        expect(JSON.parse(storage.dump().get(FORUM_TRENDS_KEY)!).items[0].title).toBe('远端热梗');
    });

    it('远端失败时回退到旧缓存或本地梗库', async () => {
        const expired: ForumTrendPack = { items: [{ title: '旧缓存热梗', source: 'cache' }], fetchedAt: 1, expiresAt: 2 };
        const storage = makeStorage({ [FORUM_TRENDS_KEY]: JSON.stringify(expired) });
        const pack = await loadForumTrendPack({
            now: 10_000,
            storage,
            fetcher: async () => { throw new Error('offline'); },
        });
        expect(pack.items[0].title).toBe('旧缓存热梗');

        const local = await loadForumTrendPack({
            now: 10_000,
            storage: makeStorage(),
            fetcher: async () => { throw new Error('offline'); },
        });
        expect(local.items.length).toBe(defaultForumTrendPack(10_000).items.length);
    });
});

describe('parseForumReplies', () => {
    it('解析跟帖、提取 reply_to（楼中楼），cap 提升到 20', () => {
        const raw = '[' +
            '{"name":"a","body":"前排"},' +
            '{"name":"b","body":"回你","reply_to":"a"},' +
            '{"name":"c","body":"replyTo 也认","replyTo":"b"}' +
            ']';
        const rs = parseForumReplies(raw);
        expect(rs.length).toBe(3);
        expect(rs[1].reply_to).toBe('a');
        expect(rs[2].reply_to).toBe('b');
    });
    it('被截断（数组没收尾）也能救回已写完的跟帖', () => {
        const raw = '[{"name":"夜航船","body":"前排，蹲后续。"},{"name":"今天也emo","body":"握手。"},{"name":"半截","body":"还没写';
        const rs = parseForumReplies(raw);
        expect(rs.length).toBe(2);
        expect(rs[0].name).toBe('夜航船');
        expect(rs[1].name).toBe('今天也emo');
    });
    it('同批完全重复的跟帖只保留一条', () => {
        const rs = parseForumReplies('[{"name":"甲","body":"理性建议：早点睡。"},{"name":"乙","body":"理性建议：早点睡。"}]');
        expect(rs).toHaveLength(1);
    });
});

describe('materializeReplies', () => {
    it('reply_to 命中前面楼层→落成楼中楼，不占楼号；isOp 标楼主', () => {
        const raw: RawReply[] = [
            { name: '楼主大大', body: '自己顶一下' },          // floor 2，isOp
            { name: '甲', body: '前排' },                      // floor 3
            { name: '乙', body: '回复甲', reply_to: '甲' },     // 楼中楼，挂到 floor 3
        ];
        const out = materializeReplies(raw, [], 2, '楼主大大');
        // 3 条里 1 条是楼中楼 → 主楼只有 2 层
        expect(out.length).toBe(2);
        expect(out[0].floor).toBe(2);
        expect(out[0].isOp).toBe(true);
        expect(out[1].floor).toBe(3);
        expect(out[1].subReplies?.length).toBe(1);
        expect(out[1].subReplies?.[0].authorName).toBe('乙');
    });
    it('reply_to 能命中「已有楼层」existing', () => {
        const existing: ForumReply[] = [
            { id: 'x', floor: 2, authorType: 'npc', authorName: '老网友', body: '占楼', createdAt: 0, likes: 0 },
        ];
        const raw: RawReply[] = [{ name: '新人', body: '回复老网友', reply_to: '老网友' }];
        const out = materializeReplies(raw, [], 3, undefined, existing);
        // 落成楼中楼挂到 existing，不产生新主楼
        expect(out.length).toBe(0);
        expect(existing[0].subReplies?.length).toBe(1);
    });
    it('带帖子上下文时过滤重复、低质和无关跟帖', () => {
        const post = mkPost({
            title: '朋友三天没回消息是不是该问问',
            body: '她以前每天都会回我，最近突然只读不回，我有点拿不准。',
        });
        const raw: RawReply[] = [
            { name: '甲', body: '理性建议：早点睡。' },
            { name: '乙', body: '她三天没回消息这个细节才是重点，可以先轻轻问一句。' },
            { name: '丙', body: '她三天没回消息这个细节才是重点，可以先轻轻问一句。' },
        ];
        const out = materializeReplies(raw, [], 2, undefined, [], post);
        expect(out).toHaveLength(1);
        expect(out[0].authorName).toBe('乙');
        expect(out[0].body).toContain('三天没回消息');
    });
});

describe('fallbackReplies', () => {
    it('带帖子上下文时生成贴题且不复读的兜底回复', () => {
        const replies = fallbackReplies(6, {
            boardId: 'emo',
            title: '朋友三天没回消息是不是该问问',
            body: '她以前每天都会回我，最近突然只读不回，我有点拿不准。',
        });
        expect(replies).toHaveLength(6);
        expect(new Set(replies.map(r => r.body))).toHaveLength(6);
        expect(replies.some(r => r.body.includes('三天没回消息') || r.body.includes('只读不回') || r.body.includes('态度'))).toBe(true);
        expect(replies.every(r => !['理性建议：早点睡。', '前排', '蹲后续'].includes(r.body))).toBe(true);
    });
});

describe('materializeReplies identity anchors', () => {
    it('uses charId anchors for same-name replies and avoids name guessing', () => {
        const chars = [
            { id: 'row-a', modelId: 'model-a', name: 'Same', avatar: 'a.png' },
            { id: 'row-b', modelId: 'model-b', name: 'Same', avatar: 'b.png' },
        ];
        const byAnchor = materializeReplies([{ name: 'Same', charId: 'model-b', body: 'from b' }], chars, 2);
        expect(byAnchor[0].authorType).toBe('char');
        expect(byAnchor[0].authorId).toBe('row-b');
        expect(byAnchor[0].avatar).toBe('b.png');

        const ambiguous = materializeReplies([{ name: 'Same', body: 'without id' }], chars, 2);
        expect(ambiguous[0].authorType).toBe('npc');
        expect(ambiguous[0].authorId).toBeUndefined();
    });
});

describe('normalizeForumState / participants', () => {
    it('旧状态归一化后补齐安全字段，不丢旧帖', () => {
        const old = { posts: [{ id: 'p1', boardId: 'chat', authorType: 'npc', authorName: '甲', title: '旧帖', body: '旧正文', createdAt: 1, lastActiveAt: 2, likes: 3 }] };
        const s = normalizeForumState(old);
        expect(s.posts).toHaveLength(1);
        expect(s.posts[0].replies).toEqual([]);
        expect(s.posts[0].tags).toEqual([]);
        expect(s.posts[0].participants?.[0].name).toBe('甲');
    });

    it('角色单条回复落成后写入 participants', () => {
        const base = mkPost({ id: 'p2', authorType: 'user', authorName: '我' });
        const { post, reply } = materializeCharReply(base, { name: '林夏', body: '我接一句' }, { id: 'c1', name: '林夏', avatar: 'a.png' });
        expect(reply.authorType).toBe('char');
        expect(post.replies).toHaveLength(1);
        expect(post.participants?.some(p => p.type === 'char' && p.id === 'c1')).toBe(true);
    });
});

describe('forum remove helpers', () => {
    it('removeForumPost 从状态里移除指定帖子', () => {
        const state = { posts: [mkPost({ id: 'p1' }), mkPost({ id: 'p2' })] };
        expect(removeForumPost(state, 'p1').posts.map(p => p.id)).toEqual(['p2']);
    });

    it('removeForumReply 删除主楼评论后重排楼层、收紧总楼数并重建参与者', () => {
        const post = mkPost({
            id: 'p1',
            authorType: 'npc',
            authorName: '楼主',
            replyCount: 4,
            replies: [
                { id: 'r1', floor: 2, authorType: 'user', authorName: '我', body: '删掉我', createdAt: 1, likes: 0 },
                { id: 'r2', floor: 3, authorType: 'char', authorId: 'c1', authorName: '林夏', body: '留下', createdAt: 2, likes: 0 },
            ],
        });
        const next = removeForumReply(post, 'r1');
        expect(next.replies.map(r => [r.id, r.floor])).toEqual([['r2', 2]]);
        expect(next.replyCount).toBe(3);
        expect(next.participants?.some(p => p.name === '我')).toBe(false);
        expect(next.participants?.some(p => p.type === 'char' && p.id === 'c1')).toBe(true);
    });

    it('removeForumSubReply 删除楼中楼评论且不改变主楼层数', () => {
        const post = mkPost({
            id: 'p1',
            replyCount: 3,
            replies: [
                {
                    id: 'r1',
                    floor: 2,
                    authorType: 'npc',
                    authorName: '甲',
                    body: '主楼',
                    createdAt: 1,
                    likes: 0,
                    subReplies: [
                        { id: 's1', authorType: 'user', authorName: '我', body: '删掉', createdAt: 2 },
                        { id: 's2', authorType: 'npc', authorName: '乙', body: '留下', createdAt: 3 },
                    ],
                },
            ],
        });
        const next = removeForumSubReply(post, 'r1', 's1');
        expect(next.replyCount).toBe(3);
        expect(next.replies[0].subReplies?.map(s => s.id)).toEqual(['s2']);
        expect(next.participants?.some(p => p.name === '我')).toBe(false);
        expect(next.participants?.some(p => p.name === '乙')).toBe(true);
    });
});

describe('forum chat share helpers', () => {
    it('buildForumPostShareSnapshot truncates long body and reply previews with complete fields', () => {
        const post = mkPost({
            id: 'post-share-1',
            boardId: 'gossip',
            authorType: 'char',
            authorId: 'c1',
            authorName: '林夏',
            title: '一个很像真论坛的帖子标题',
            body: '正文'.repeat(400),
            likes: 88,
            replyCount: 260,
            tags: ['热梗', '好贴', '蹲后续', '很长很长很长很长很长的标签'],
            replies: [
                { id: 'r1', floor: 2, authorType: 'npc', authorName: '路人甲', body: '短回复', createdAt: 1, likes: 2 },
                { id: 'r2', floor: 3, authorType: 'char', authorName: '沈星', body: '长回复'.repeat(120), createdAt: 2, likes: 3 },
            ],
        });
        const snap = buildForumPostShareSnapshot(post, { boardName: '吃瓜', bodyLimit: 80, replyBodyLimit: 30, now: 123 });
        expect(snap.postId).toBe('post-share-1');
        expect(snap.boardName).toBe('吃瓜');
        expect(snap.author.name).toBe('林夏');
        expect(snap.stats.likes).toBe(88);
        expect(snap.stats.floors).toBe(260);
        expect(snap.body.length).toBeLessThanOrEqual(80);
        expect(snap.repliesPreview).toHaveLength(2);
        expect(snap.repliesPreview[1].body.length).toBeLessThanOrEqual(30);
        expect(snap.tags.length).toBeGreaterThan(0);
        expect(snap.sharedAt).toBe(123);
    });

    it('normalizes private pending payload and rejects invalid char or post ids', () => {
        const post = mkPost({ id: 'p-valid', title: '分享帖', body: '正文' });
        const payload = buildForumSharePendingPayload({
            post,
            targetKind: 'character',
            targetId: 'c1',
            shareMode: 'char_to_user',
            sharedBy: { type: 'char', id: 'c1', name: '林夏' },
            now: 1000,
        });
        const ok = normalizeForumSharePendingPayload(payload, { validCharIds: ['c1'] });
        expect(ok?.targetKind).toBe('character');
        expect(ok?.charId).toBe('c1');
        expect(ok?.shareMode).toBe('char_to_user');
        expect(ok?.snapshot.postId).toBe('p-valid');

        expect(normalizeForumSharePendingPayload({ ...payload, targetId: 'missing', charId: 'missing' }, { validCharIds: ['c1'] })).toBeNull();
        expect(normalizeForumSharePendingPayload({ ...payload, snapshot: { ...payload.snapshot, postId: '' } }, { validCharIds: ['c1'] })).toBeNull();
    });

    it('normalizes group pending payload and preserves group share modes', () => {
        const post = mkPost({ id: 'p-group', title: '群聊分享帖', body: '正文' });
        const userPayload = buildForumSharePendingPayload({
            post,
            targetKind: 'group',
            targetId: 'g1',
            shareMode: 'user_to_group',
            sharedBy: { type: 'user', name: '我' },
            now: 2000,
        });
        const userOk = normalizeForumSharePendingPayload(userPayload, { validGroupIds: ['g1'] });
        expect(userOk?.targetKind).toBe('group');
        expect(userOk?.groupId).toBe('g1');
        expect(userOk?.shareMode).toBe('user_to_group');

        const charPayload = buildForumSharePendingPayload({
            post,
            targetKind: 'group',
            targetId: 'g1',
            charId: 'c2',
            shareMode: 'char_to_group',
            sharedBy: { type: 'char', id: 'c2', name: '沈星' },
            now: 2001,
        });
        const charOk = normalizeForumSharePendingPayload(charPayload, { validCharIds: ['c2'], validGroupIds: ['g1'] });
        expect(charOk?.charId).toBe('c2');
        expect(charOk?.shareMode).toBe('char_to_group');
        expect(normalizeForumSharePendingPayload(charPayload, { validCharIds: ['c3'], validGroupIds: ['g1'] })).toBeNull();
        expect(normalizeForumSharePendingPayload(charPayload, { validCharIds: ['c2'], validGroupIds: ['g2'] })).toBeNull();
    });
});

describe('buildThreadsPrompt', () => {
    it('包含板块名与「一次性生成 N 个」指令', () => {
        const { system, user } = buildThreadsPrompt(FORUM_BOARDS[0], [{ id: 'c1', name: '林夏' }], 12);
        expect(system).toContain(FORUM_BOARDS[0].name);
        expect(user).toContain('12');
        expect(user).toContain('floors');
    });
    it('带今日风向时写入主题要求', () => {
        const topic = fallbackTopicEvent('chat', '2026-06-30');
        const { user } = buildThreadsPrompt(FORUM_BOARDS[0], [], 6, topic);
        expect(user).toContain(topic.title);
        expect(user).toContain('不同人物、场景或立场');
    });
    it('带趋势素材时写入热梗与混合帖型要求', () => {
        const { system, user } = buildThreadsPrompt(FORUM_BOARDS[0], [], 6, undefined, {
            items: [{ title: '这届网友太会整活', source: '测试热榜', tags: ['整活'] }],
            fetchedAt: 1,
            expiresAt: 2,
        });
        expect(system).toContain('热梗短帖');
        expect(user).toContain('这届网友太会整活');
        expect(user).toContain('混合帖型');
        expect(user).toContain('不要复刻真实事件细节');
    });
});

describe('ForumTopicEvent', () => {
    it('兜底今日风向稳定且字段完整', () => {
        const a = fallbackTopicEvent('gossip', '2026-06-30');
        const b = fallbackTopicEvent('gossip', '2026-06-30');
        expect(a.title).toBe(b.title);
        expect(a.boardId).toBe('gossip');
        expect(a.heat).toBeGreaterThan(0);
        expect(a.tags.length).toBeGreaterThan(0);
    });
    it('ensureForumTopic 会写入 meta，旧 meta 也能兼容', () => {
        const { meta, event } = ensureForumTopic({ exp: 1, followedBoards: [], collectedPostIds: [], checkIn: {} }, 'emo', '2026-06-30');
        expect(meta.topicEvents?.['2026-06-30:emo']).toEqual(event);
    });
    it('ensureForumTopic 命中已有话题时也返回归一化 meta', () => {
        const event = fallbackTopicEvent('chat', '2026-06-30');
        const { meta } = ensureForumTopic({
            exp: 1,
            followedBoards: [],
            collectedPostIds: [],
            checkIn: {},
            topicEvents: { '2026-06-30:chat': event },
        }, 'chat', '2026-06-30');
        expect(meta.drafts).toEqual([]);
        expect(meta.recentPostIds).toEqual([]);
        expect(meta.topicEvents?.['2026-06-30:chat']).toEqual(event);
    });
});

// ── 个人体系：等级 / 经验 ──────────────────────────────────────────────
describe('levelOf / levelInfo', () => {
    it('0 经验＝Lv1，经验越高等级越高，封顶 MAX_LEVEL', () => {
        expect(levelOf(0)).toBe(1);
        expect(levelOf(-50)).toBe(1);
        expect(levelOf(20)).toBe(3);
        expect(levelOf(999999)).toBe(MAX_LEVEL);
        expect(levelOf(8)).toBe(2);
    });
    it('levelInfo 段内进度 0~100，满级 pct=100、max=true', () => {
        const a = levelInfo(0);
        expect(a.level).toBe(1);
        expect(a.pct).toBeGreaterThanOrEqual(0);
        expect(a.pct).toBeLessThanOrEqual(100);
        expect(a.max).toBe(false);
        const max = levelInfo(999999);
        expect(max.max).toBe(true);
        expect(max.pct).toBe(100);
    });
    it('levelTitle 给每级一个头衔', () => {
        expect(levelTitle(1)).toBeTruthy();
        expect(levelTitle(MAX_LEVEL)).toBeTruthy();
        expect(levelTitle(1)).not.toBe(levelTitle(MAX_LEVEL));
    });
    it('addExp 累加且不为负', () => {
        const m = defaultForumMeta();
        expect(addExp(m, 10).exp).toBe(10);
        expect(addExp(addExp(m, 10), -100).exp).toBe(0);
    });
});

// ── 签到（连续天数 / 经验 / 已签判断）─────────────────────────────────────
describe('checkIn', () => {
    it('首签 streak=1、给经验；当天重复签 already=true 不变', () => {
        const m = defaultForumMeta();
        const r1 = checkIn(m, 'chat', '2026-06-25');
        expect(r1.already).toBe(false);
        expect(r1.streak).toBe(1);
        expect(r1.gained).toBeGreaterThan(0);
        expect(r1.meta.exp).toBe(r1.gained);
        expect(isCheckedIn(r1.meta, 'chat', '2026-06-25')).toBe(true);
        const r2 = checkIn(r1.meta, 'chat', '2026-06-25');
        expect(r2.already).toBe(true);
        expect(r2.meta.exp).toBe(r1.meta.exp); // 不再加经验
    });
    it('连续两天 streak 累进；断签后重置为 1', () => {
        let m = defaultForumMeta();
        m = checkIn(m, 'chat', '2026-06-24').meta;
        const cont = checkIn(m, 'chat', '2026-06-25');
        expect(cont.streak).toBe(2);
        const broke = checkIn(cont.meta, 'chat', '2026-06-28'); // 隔了好几天
        expect(broke.streak).toBe(1);
    });
    it('maxStreak 取所有吧里的最长连签', () => {
        let m = defaultForumMeta();
        m = checkIn(m, 'chat', '2026-06-24').meta;
        m = checkIn(m, 'chat', '2026-06-25').meta; // chat 连签 2
        m = checkIn(m, 'emo', '2026-06-25').meta;  // emo 连签 1
        expect(maxStreak(m)).toBe(2);
    });
});

// ── 关注吧 / 收藏帖 ──────────────────────────────────────────────────────
describe('toggleFollowBoard / toggleCollect', () => {
    it('关注/取关来回切', () => {
        let m = defaultForumMeta();
        m = toggleFollowBoard(m, 'emo');
        expect(m.followedBoards).toContain('emo');
        m = toggleFollowBoard(m, 'emo');
        expect(m.followedBoards).not.toContain('emo');
    });
    it('收藏/取消收藏来回切', () => {
        let m = defaultForumMeta();
        m = toggleCollect(m, 'p1');
        expect(m.collectedPostIds).toContain('p1');
        m = toggleCollect(m, 'p1');
        expect(m.collectedPostIds).not.toContain('p1');
    });
});

describe('forum meta helpers', () => {
    it('旧 meta 归一化后补齐新字段', () => {
        const m = normalizeForumMeta({ exp: 3, followedBoards: ['chat', 'bad'], collectedPostIds: ['p1'], checkIn: {} });
        expect(m.followedBoards).toEqual(['chat']);
        expect(m.recentPostIds).toEqual([]);
        expect(m.drafts).toEqual([]);
        expect(m.topicEvents).toEqual({});
    });

    it('草稿保存、覆盖、删除', () => {
        let m = defaultForumMeta();
        m = upsertForumDraft(m, { id: 'd1', board: 'chat', title: '标题', body: '', tags: ['#求助', '求助', '12345678901234567890'], pollOn: false, pollQ: '', pollOpts: ['', ''], updatedAt: 1 });
        expect(m.drafts?.[0].title).toBe('标题');
        expect(m.drafts?.[0].tags).toEqual(['求助', '1234567890123456']);
        m = upsertForumDraft(m, { id: 'd1', board: 'chat', title: '新标题', body: '正文', tags: ['后续'], pollOn: false, pollQ: '', pollOpts: ['', ''], updatedAt: 2 });
        expect(m.drafts).toHaveLength(1);
        expect(m.drafts?.[0].title).toBe('新标题');
        expect(m.drafts?.[0].tags).toEqual(['后续']);
        m = removeForumDraft(m, 'd1');
        expect(m.drafts).toEqual([]);
    });

    it('最近看过去重且最新在前', () => {
        let m = defaultForumMeta();
        m = touchRecentPost(m, 'p1');
        m = touchRecentPost(m, 'p2');
        m = touchRecentPost(m, 'p1');
        expect(m.recentPostIds).toEqual(['p1', 'p2']);
    });

    it('标签清洗会去掉 #、去重和截断', () => {
        expect(normalizeForumTags(['#求助', '求助', '  后续  ', '', '12345678901234567890'])).toEqual(['求助', '后续', '1234567890123456']);
    });
});

describe('filterForumPosts', () => {
    it('支持我参与 / 角色参与 / 收藏 / 最近看过筛选', () => {
        const mine = mkPost({ id: 'mine', authorType: 'user', authorName: '我' });
        const char = mkPost({ id: 'char', authorType: 'npc', participants: [{ type: 'char', id: 'c1', name: '林夏', lastAt: 1, count: 1 }] });
        const plain = mkPost({ id: 'plain', authorType: 'npc', authorName: '路人' });
        const meta = { ...defaultForumMeta(), collectedPostIds: ['plain'], recentPostIds: ['char', 'mine'] };
        expect(filterForumPosts([mine, char, plain], meta, '我', 'mine').map(p => p.id)).toEqual(['mine']);
        expect(filterForumPosts([mine, char, plain], meta, '我', 'char').map(p => p.id)).toEqual(['char']);
        expect(filterForumPosts([mine, char, plain], meta, '我', 'collect').map(p => p.id)).toEqual(['plain']);
        expect(filterForumPosts([mine, char, plain], meta, '我', 'recent').map(p => p.id)).toEqual(['char', 'mine']);
    });

    it('淡出帖子后列表不再显示，恢复后重新出现', () => {
        const hidden = mkPost({ id: 'hidden' });
        const visible = mkPost({ id: 'visible' });
        const muted = toggleMutePost(defaultForumMeta(), 'hidden');
        expect(filterForumPosts([hidden, visible], muted, '我').map(p => p.id)).toEqual(['visible']);
        const restored = toggleMutePost(muted, 'hidden');
        expect(filterForumPosts([hidden, visible], restored, '我').map(p => p.id)).toEqual(['hidden', 'visible']);
    });
});

// ── 吧头：稳定派生 ───────────────────────────────────────────────────────
describe('boardStat', () => {
    it('同一吧多次取值稳定一致（不随机跳数）', () => {
        const a = boardStat('chat');
        const b = boardStat('chat');
        expect(a).toEqual(b);
        expect(a.members).toBeGreaterThan(0);
        expect(a.posts).toBeGreaterThan(0);
        expect(a.owner).toBeTruthy();
    });
    it('不同吧通常不同', () => {
        expect(boardStat('chat').members).not.toBe(boardStat('gossip').members);
    });
});

// ── 通知中心 ─────────────────────────────────────────────────────────────
describe('makeNotif / unreadCount', () => {
    it('makeNotif 默认未读、截断 snippet', () => {
        const n = makeNotif('reply', { id: 'p1', title: '帖子' }, { name: '甲', type: 'npc' }, 'x'.repeat(200));
        expect(n.read).toBe(false);
        expect(n.kind).toBe('reply');
        expect(n.snippet!.length).toBeLessThanOrEqual(60);
    });
    it('unreadCount 只数未读', () => {
        const a = makeNotif('like', { id: 'p1', title: 't' }, { name: 'a', type: 'npc' });
        const b = { ...makeNotif('reply', { id: 'p2', title: 't' }, { name: 'b', type: 'npc' }), read: true };
        expect(unreadCount([a, b])).toBe(1);
    });
});

// ── 热议榜 ───────────────────────────────────────────────────────────────
describe('hotRank', () => {
    it('按热度排序、取前 n、爆楼/精华更靠前', () => {
        const now = Date.now();
        const cold = mkPost({ id: 'cold', likes: 1, replyCount: 30, lastActiveAt: now - 86_400_000 * 5 });
        const hot = mkPost({ id: 'hot', likes: 500, replyCount: 400, hot: true, essence: true, lastActiveAt: now });
        const mid = mkPost({ id: 'mid', likes: 50, replyCount: 120, lastActiveAt: now });
        const top = hotRank([cold, mid, hot], 2);
        expect(top.length).toBe(2);
        expect(top[0].id).toBe('hot');
    });
});

// ── 获赞统计 ─────────────────────────────────────────────────────────────
describe('userLikesReceived', () => {
    it('累计用户帖子与楼层的赞', () => {
        const posts: ForumPost[] = [
            mkPost({ authorType: 'user', authorName: '我', likes: 10, replies: [
                { id: 'r1', floor: 2, authorType: 'user', authorName: '我', body: 'x', createdAt: 0, likes: 3 },
                { id: 'r2', floor: 3, authorType: 'npc', authorName: '别人', body: 'y', createdAt: 0, likes: 99 },
            ] }),
            mkPost({ authorType: 'npc', authorName: '别人', likes: 999 }),
        ];
        expect(userLikesReceived(posts, '我')).toBe(13); // 10 + 3，别人的不算
    });
});

// ── 投票帖 ───────────────────────────────────────────────────────────────
describe('votePoll / pollTotal', () => {
    const base = (): ForumPoll => ({ question: 'q', options: [{ text: 'A', votes: 0 }, { text: 'B', votes: 0 }] });
    it('投票 +1、记录 voted、total 增加', () => {
        const p = votePoll(base(), 0);
        expect(p.options[0].votes).toBe(1);
        expect(p.voted).toBe(0);
        expect(pollTotal(p)).toBe(1);
    });
    it('改投：撤回旧票、新票 +1，总数不变', () => {
        let p = votePoll(base(), 0);
        p = votePoll(p, 1);
        expect(p.options[0].votes).toBe(0);
        expect(p.options[1].votes).toBe(1);
        expect(p.voted).toBe(1);
        expect(pollTotal(p)).toBe(1);
    });
    it('非法 index 原样返回', () => {
        const p0 = base();
        expect(votePoll(p0, 9)).toBe(p0);
    });
});
