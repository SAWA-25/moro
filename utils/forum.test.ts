import { describe, it, expect } from 'vitest';
import {
    targetFloorCount, parseThreads, materializeThreads, fallbackThreads,
    parseForumReplies, materializeReplies, buildThreadsPrompt, FORUM_BOARDS,
    type RawReply, type ForumReply,
} from './forum';

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
});

describe('buildThreadsPrompt', () => {
    it('包含板块名与「一次性生成 N 个」指令', () => {
        const { system, user } = buildThreadsPrompt(FORUM_BOARDS[0], [{ id: 'c1', name: '林夏' }], 12);
        expect(system).toContain(FORUM_BOARDS[0].name);
        expect(user).toContain('12');
        expect(user).toContain('floors');
    });
});
