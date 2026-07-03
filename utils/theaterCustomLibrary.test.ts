import { describe, expect, it } from 'vitest';
import { parseTheaterCustomLibraryJson, theaterCustomLibraryId } from './theaterCustomLibrary';

describe('theater custom library import', () => {
    it('parses pieces and quizzes from a valid bundle', () => {
        const parsed = parseTheaterCustomLibraryJson(JSON.stringify({
            moroTheaterLibraryVersion: 1,
            pieces: [
                {
                    title: '雨夜摊牌',
                    instruction: '写一段雨夜摊牌小剧场。',
                    description: '适合酸涩关系',
                    tags: ['虐恋', '小剧场'],
                },
            ],
            quizzes: [
                {
                    title: '亲密边界20问',
                    questions: ['第一题？', '第二题？'],
                    description: '边界感访谈',
                    tags: ['恋爱'],
                    recommendedParticipants: '1-3 位',
                },
            ],
        }), { sourceName: 'library.json', now: 1234 });

        expect(parsed.pieceCount).toBe(1);
        expect(parsed.quizCount).toBe(1);
        expect(parsed.items).toHaveLength(2);
        expect(parsed.items[0]).toMatchObject({
            kind: 'piece',
            title: '雨夜摊牌',
            sourceName: 'library.json',
            createdAt: 1234,
            updatedAt: 1234,
        });
        expect(parsed.items[1]).toMatchObject({
            kind: 'quiz',
            title: '亲密边界20问',
            questions: ['第一题？', '第二题？'],
            recommendedParticipants: '1-3 位',
        });
    });

    it('ignores empty titles, instructions, and questions', () => {
        const parsed = parseTheaterCustomLibraryJson(JSON.stringify({
            pieces: [
                { title: '', instruction: '无标题' },
                { title: '无指令', instruction: '' },
                { title: '有效小剧场', instruction: '写一段。' },
            ],
            quizzes: [
                { title: '空问卷', questions: ['', '   '] },
                { title: '', questions: ['有题无标题'] },
                { title: '有效问卷', questions: ['题目 A', '', '题目 B'] },
            ],
        }), { now: 1 });

        expect(parsed.items.map(item => item.title)).toEqual(['有效小剧场', '有效问卷']);
        const quiz = parsed.items.find(item => item.kind === 'quiz');
        expect(quiz && quiz.kind === 'quiz' ? quiz.questions : []).toEqual(['题目 A', '题目 B']);
    });

    it('uses stable ids and overwrites duplicate titles in one import', () => {
        const parsed = parseTheaterCustomLibraryJson(JSON.stringify({
            pieces: [
                { title: '  雨夜摊牌 ', instruction: '旧指令' },
                { title: '雨夜摊牌', instruction: '新指令' },
            ],
        }), { now: 1 });

        expect(theaterCustomLibraryId('piece', '雨夜摊牌')).toBe(theaterCustomLibraryId('piece', '  雨夜摊牌 '));
        expect(parsed.items).toHaveLength(1);
        const piece = parsed.items[0];
        expect(piece.kind).toBe('piece');
        expect(piece.kind === 'piece' ? piece.instruction : '').toBe('新指令');
    });

    it('throws clear errors for invalid or empty bundles', () => {
        expect(() => parseTheaterCustomLibraryJson('{bad json')).toThrow('导入文件不是有效 JSON');
        expect(() => parseTheaterCustomLibraryJson(JSON.stringify({ pieces: [], quizzes: [] }))).toThrow('没有找到可导入的小剧场或问卷');
    });
});
