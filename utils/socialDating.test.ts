import { describe, it, expect } from 'vitest';
import {
    parseDatingProfiles, fallbackDatingProfiles, buildDatingPrompt, intentMeta,
    DATING_INTENTS, type CharBrief,
} from './socialDating';

const chars: CharBrief[] = [{ id: 'c1', name: '林夏', persona: '高冷御姐', avatar: 'a.png' }];

describe('socialDating · parseDatingProfiles', () => {
    it('解析、校验 intent、夹紧 age/distance、命中角色带头像', () => {
        const raw = '[' +
            '{"name":"林夏","isChar":true,"age":99,"gender":"女","intent":"sm","distanceKm":999,"online":true,"tags":["#圈内"],"bio":"圈内轻度，先做朋友。"},' +
            '{"name":"游戏菜鸡","isChar":false,"age":22,"gender":"男","intent":"gamemate","distanceKm":1.2,"tags":["上分"],"bio":"求一个不送的辅助搭子。"}' +
            ']';
        const ps = parseDatingProfiles(raw, chars);
        expect(ps.length).toBe(2);
        const lx = ps.find(p => p.name === '林夏')!;
        expect(lx.isChar).toBe(true);
        expect(lx.charId).toBe('c1');
        expect(lx.avatar).toBe('a.png');
        expect(lx.age).toBe(60);          // 99 夹到 60
        expect(lx.distanceKm).toBeLessThanOrEqual(80); // 999 夹紧
        expect(lx.tags[0]).toBe('圈内');   // # 去掉
        expect(lx.intent).toBe('sm');
    });
    it('非法 intent 回退到合法 key；空 bio 丢弃', () => {
        const ps = parseDatingProfiles('[{"name":"A","intent":"乱写","distanceKm":1,"bio":"有内容"},{"name":"B","intent":"date","bio":""}]', []);
        expect(ps.length).toBe(1);
        expect(DATING_INTENTS.some(i => i.key === ps[0].intent)).toBe(true);
    });
    it('去重昵称；同一角色只出镜一次（第二张转路人）', () => {
        const raw = '[' +
            '{"name":"林夏","isChar":true,"intent":"date","distanceKm":1,"bio":"一"},' +
            '{"name":"林夏","isChar":true,"intent":"date","distanceKm":2,"bio":"二（重名应去重）"},' +
            '{"name":"路人","isChar":false,"intent":"bored","distanceKm":3,"bio":"三"}' +
            ']';
        const ps = parseDatingProfiles(raw, chars);
        expect(ps.length).toBe(2);                       // 重名去重
        expect(ps.filter(p => p.isChar).length).toBe(1); // 林夏只出镜一次
    });
    it('被 max_tokens 截断也能救回已写完的卡片', () => {
        const raw = '[{"name":"甲","intent":"casual","distanceKm":1,"bio":"完整一张"},{"name":"乙","intent":"soul","distanceKm":2,"bio":"完整两张"},{"name":"半截","intent":"date","bio":"还没写';
        const ps = parseDatingProfiles(raw, []);
        expect(ps.length).toBe(2);
    });
    it('非 JSON 返回空', () => {
        expect(parseDatingProfiles('抱歉做不到', [])).toEqual([]);
    });
});

describe('socialDating · 兜底 / prompt', () => {
    it('fallbackDatingProfiles：无 API 也能逛、各有简介与目的', () => {
        const ps = fallbackDatingProfiles(12);
        expect(ps.length).toBe(12);
        ps.forEach(p => {
            expect(p.bio.length).toBeGreaterThan(0);
            expect(DATING_INTENTS.some(i => i.key === p.intent)).toBe(true);
        });
    });
    it('buildDatingPrompt 含目的池与「不限题材/SM」要求', () => {
        const prompt = buildDatingPrompt(chars, { name: '我' } as any, 14);
        expect(prompt).toContain('14');
        expect(prompt).toContain('sm');
        expect(prompt).toContain('不限题材');
    });
    it('intentMeta 命中与兜底', () => {
        expect(intentMeta('gamemate').label).toContain('游戏');
        expect(intentMeta('不存在').label.length).toBeGreaterThan(0);
    });
});
