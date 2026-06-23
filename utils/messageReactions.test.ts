import { describe, it, expect } from 'vitest';
import { toggleReaction, extractReactDirective } from './messageReactions';

describe('toggleReaction', () => {
    it('新表情：新增一条 { emoji, by:[reactorId] }', () => {
        const r = toggleReaction([], '👍', 'user');
        expect(r).toEqual([{ emoji: '👍', by: ['user'] }]);
    });

    it('已有表情、该人未回应：把 id 加进去', () => {
        const r = toggleReaction([{ emoji: '👍', by: ['user'] }], '👍', 'char_1');
        expect(r).toEqual([{ emoji: '👍', by: ['user', 'char_1'] }]);
    });

    it('已有表情、该人已回应：移除该人', () => {
        const r = toggleReaction([{ emoji: '👍', by: ['user', 'char_1'] }], '👍', 'user');
        expect(r).toEqual([{ emoji: '👍', by: ['char_1'] }]);
    });

    it('移除最后一个回应者时整条删除', () => {
        const r = toggleReaction([{ emoji: '👍', by: ['user'] }], '👍', 'user');
        expect(r).toEqual([]);
    });

    it('不改动入参（返回新数组）', () => {
        const input = [{ emoji: '❤️', by: ['user'] }];
        const r = toggleReaction(input, '😂', 'user');
        expect(input).toEqual([{ emoji: '❤️', by: ['user'] }]);
        expect(r.length).toBe(2);
    });

    it('undefined 入参安全', () => {
        expect(toggleReaction(undefined, '🎉', 'user')).toEqual([{ emoji: '🎉', by: ['user'] }]);
    });
});

describe('extractReactDirective', () => {
    it('剥离 [[REACT: 👍]] 并返回表情', () => {
        const r = extractReactDirective('哈哈你真好笑 [[REACT: 😂]]');
        expect(r.emoji).toBe('😂');
        expect(r.content).toBe('哈哈你真好笑');
    });

    it('中文冒号 + 无空格也能解析', () => {
        expect(extractReactDirective('[[REACT：❤️]]').emoji).toBe('❤️');
    });

    it('没有指令时 emoji=null、内容原样', () => {
        const r = extractReactDirective('普通回复');
        expect(r.emoji).toBeNull();
        expect(r.content).toBe('普通回复');
    });
});
