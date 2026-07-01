import { describe, expect, it } from 'vitest';
import { DB } from './db';
import {
    buildForwardText,
    candidateToItem,
    collectionId,
    listCollectibles,
} from './collection';
import type { TheaterReflectionSession } from '../types';

const makeTestReflectionSession = (overrides: Partial<TheaterReflectionSession> = {}): TheaterReflectionSession => ({
    id: 'reflection-test',
    charId: 'char-reflection',
    charName: '阿照',
    userName: '你',
    title: '雨中照面',
    subtitle: '月光也认得旧伞',
    nodes: {
        past: {
            id: 'past-node',
            ts: 1_000,
            era: 'before',
            title: '旧站台',
            scene: 'TA 在很早以前的站台等一班不会来的车。',
            mood: '倔强',
            place: '站台',
            source: 'generated',
            when: '相遇前约 1 个月',
        },
        now: {
            id: 'now-node',
            ts: 3_000,
            era: 'after',
            title: '新雨夜',
            scene: 'TA 后来在雨夜里学会把伞递给别人。',
            mood: '安静',
            place: '街口',
            source: 'lifeEvent',
            when: '相遇之后不久',
        },
    },
    options: { mode: 'moonlight', tone: 'restrained', length: 'standard' },
    initialScene: {
        title: '雨中照面',
        subtitle: '月光也认得旧伞',
        lines: [
            { who: 'past', text: '我以为车会来。' },
            { who: 'now', text: '后来我学会走回去。' },
        ],
    },
    continuationLines: [],
    createdAt: 10,
    updatedAt: 20,
    ...overrides,
});

describe('collection reflection source', () => {
    it('lists theater reflection sessions as collectible candidates', async () => {
        await DB.deleteDB();
        await DB.saveTheaterReflectionSession(makeTestReflectionSession());

        const candidates = await listCollectibles(id => id === 'char-reflection' ? '阿照' : id);
        const reflection = candidates.find(c => c.sourceType === 'reflection');

        expect(reflection).toMatchObject({
            sourceType: 'reflection',
            sourceId: 'reflection-test',
            title: '对影 · 雨中照面',
            charIds: ['char-reflection'],
            cover: '🌙',
        });
        expect(reflection?.subtitle).toContain('折子戏');
        expect(reflection?.excerpt).toContain('我以为车会来');
    });

    it('builds reflection collection ids, items, and forward text', () => {
        const item = candidateToItem({
            sourceType: 'reflection',
            sourceId: 'reflection-test',
            title: '对影 · 雨中照面',
            subtitle: '折子戏 · 阿照',
            excerpt: '我以为车会来。',
            charIds: ['char-reflection'],
            cover: '🌙',
            at: 20,
        });

        expect(item.id).toBe(collectionId('reflection', 'reflection-test'));
        expect(buildForwardText(item, '你', ['阿照'])).toContain('对影');
        expect(buildForwardText(item, '你', ['阿照'])).toContain('不同时间里的 TA 照了个面');
    });
});
