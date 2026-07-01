import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CharacterProfile } from '../types';

const dbMock = vi.hoisted(() => ({
    getAsset: vi.fn(),
    saveAsset: vi.fn(),
    getMessagesByCharId: vi.fn(),
    getLifeEvents: vi.fn(),
}));

vi.mock('./db', () => ({ DB: dbMock }));

import {
    CharTrajectory,
    TrajectoryBranch,
    generateTrajectoryBranch,
    normalizeTrajectory,
    parseTrajectorySkeleton,
    refreshAfterNodes,
    rewriteTrajectoryNode,
    sanitizeTrajectoryDetail,
} from './theaterTimeline';

const firstMetTs = Date.UTC(2026, 0, 1);

const char = {
    id: 'char-1',
    name: '阿墨',
    avatar: '',
    description: '',
    systemPrompt: '安静、敏锐，习惯把话咽回去。',
    memories: [],
} as CharacterProfile;

const api = { baseUrl: 'https://api.example.test', apiKey: 'sk-test', model: 'moro-test' };

const makeResponse = (content: unknown) => ({
    ok: true,
    text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }),
});

const branch = (id: string, nodeId = 'old'): TrajectoryBranch => ({
    id,
    nodeId,
    generatedAt: Number(id.replace(/\D/g, '')) || 1,
    premise: `假设 ${id}`,
    title: `岔路${id}`,
    scene: `岔路 ${id} 的场景。`,
    cost: '付出一点代价。',
    unchanged: '仍然会沉默。',
});

beforeEach(() => {
    vi.restoreAllMocks();
    dbMock.getAsset.mockReset();
    dbMock.saveAsset.mockReset().mockResolvedValue(undefined);
    dbMock.getMessagesByCharId.mockReset().mockResolvedValue([]);
    dbMock.getLifeEvents.mockReset().mockResolvedValue([]);
    vi.stubGlobal('fetch', vi.fn());
});

describe('trajectory v2 normalization', () => {
    it('lazily normalizes old trajectory shape into v2', () => {
        const old = {
            charId: 'char-1',
            generatedAt: 123,
            firstMetTs,
            nodes: [
                { id: 'b1', ts: firstMetTs - 365 * 24 * 60 * 60 * 1000, era: 'before', title: '旧车站', scene: 'TA 在车站等到末班车。', source: 'generated' },
                { id: 'met', ts: firstMetTs, era: 'meeting', title: '相遇', scene: '你出现了。', source: 'firstMet' },
            ],
        };

        const next = normalizeTrajectory(old, char.name);

        expect(next?.version).toBe(2);
        expect(next?.dossier?.arcTitle).toContain(char.name);
        expect(next?.nodeDetails).toEqual({});
        expect(next?.branches).toEqual({});
        expect(next?.nodes.map(n => n.id)).toEqual(['b1', 'met']);
    });

    it('parses v2 skeleton and legacy array fallback with clamped sorted before nodes', () => {
        const v2 = parseTrajectorySkeleton({
            dossier: {
                arcTitle: '旧日底片',
                summary: 'TA 慢慢学会沉默。',
                motifs: ['雨', '车票'],
                places: ['车站'],
                objects: ['旧票'],
                openQuestions: ['如果没走呢？'],
            },
            nodes: [
                { yearsAgo: 0.2, title: '近处', scene: '相遇前不久，TA 收好一张票。' },
                { yearsAgo: 3, title: '远处', scene: '更早以前，TA 独自离开一座城。' },
            ],
        }, firstMetTs, char.name);

        expect(v2.dossier.arcTitle).toBe('旧日底片');
        expect(v2.nodes.map(n => n.title)).toEqual(['远处', '近处']);
        expect(v2.nodes.every(n => n.ts < firstMetTs)).toBe(true);

        const legacy = parseTrajectorySkeleton([
            { yearsAgo: 0, title: '太近', scene: '这帧被钳制到相遇前。' },
        ], firstMetTs, char.name);

        expect(legacy.nodes).toHaveLength(1);
        expect(legacy.nodes[0].ts).toBeLessThan(firstMetTs);
        expect(legacy.dossier.summary).toContain(char.name);
    });
});

describe('trajectory cache preservation', () => {
    it('refreshAfterNodes preserves valid v2 caches and removes stale ones', async () => {
        dbMock.getLifeEvents.mockResolvedValue([
            { id: 'life-1', charId: 'char-1', timestamp: firstMetTs + 3 * 24 * 60 * 60 * 1000, activity: '散步', summary: 'TA 下楼散步。', mood: '平静', location: '楼下', source: 'catchup' },
        ]);
        const trajectory: CharTrajectory = {
            charId: 'char-1',
            generatedAt: 1,
            version: 2,
            firstMetTs,
            dossier: {
                arcTitle: '档案',
                summary: '摘要',
                motifs: ['雨'],
                places: ['车站'],
                objects: ['旧票'],
                openQuestions: ['问题'],
            },
            nodes: [
                { id: 'before-1', ts: firstMetTs - 1000, era: 'before', title: '旧票', scene: 'TA 收好旧票。', source: 'generated' },
                { id: 'old-after', ts: firstMetTs + 1000, era: 'after', title: '旧事件', scene: '已经不在生活事件里。', source: 'lifeEvent' },
            ],
            nodeDetails: {
                'before-1': { nodeId: 'before-1', generatedAt: 1, stillFrame: '旧票一角。', senses: [], innerMonologue: '别说。', unsaidLine: '等等。', consequence: '后来留下了沉默。' },
                'old-after': { nodeId: 'old-after', generatedAt: 1, stillFrame: '旧事件。', senses: [], innerMonologue: '旧。', unsaidLine: '旧。', consequence: '旧。' },
            },
            branches: {
                'before-1': [branch('b5', 'before-1')],
                'old-after': [branch('b6', 'old-after')],
            },
        };

        const next = await refreshAfterNodes(trajectory, '你', char.name);

        expect(next.nodes.some(n => n.id === 'life-1')).toBe(true);
        expect(next.nodeDetails?.['before-1']).toBeTruthy();
        expect(next.nodeDetails?.['old-after']).toBeUndefined();
        expect(next.branches?.['before-1']).toHaveLength(1);
        expect(next.branches?.['old-after']).toBeUndefined();
    });
});

describe('trajectory detail and branches', () => {
    it('sanitizes detail fields and filters empty content', () => {
        expect(sanitizeTrajectoryDetail({}, 'n1')).toBeNull();

        const detail = sanitizeTrajectoryDetail({
            stillFrame: 'x'.repeat(500),
            senses: ['风', '雨', '灯', '纸', '鞋底', '多余'],
            innerMonologue: 'y'.repeat(500),
            unsaidLine: 'z'.repeat(200),
            consequence: '后来。'.repeat(100),
            keepsake: '旧票根',
        }, 'n1', 7);

        expect(detail?.generatedAt).toBe(7);
        expect(detail?.stillFrame.length).toBeLessThanOrEqual(360);
        expect(detail?.senses).toHaveLength(5);
        expect(detail?.unsaidLine.length).toBeLessThanOrEqual(120);
        expect(detail?.keepsake).toBe('旧票根');
    });

    it('keeps only the newest five branches for a node', async () => {
        vi.mocked(fetch).mockResolvedValue(makeResponse({
            premise: 'TA 没有离开',
            title: '没有离开',
            scene: '如果那天 TA 没有离开，车站的灯会把沉默照得更长。',
            cost: 'TA 会晚一点学会放手。',
            unchanged: 'TA 仍然会先照顾别人。',
        }) as any);
        const trajectory: CharTrajectory = {
            charId: 'char-1',
            generatedAt: 1,
            version: 2,
            firstMetTs,
            nodes: [{ id: 'before-1', ts: firstMetTs - 1000, era: 'before', title: '离开', scene: 'TA 离开了。', source: 'generated' }],
            branches: { 'before-1': ['1', '2', '3', '4', '5'].map(id => branch(id, 'before-1')) },
        };

        const result = await generateTrajectoryBranch(trajectory, char, '你', 'before-1', 'TA 没有离开', api);

        expect(result.branch.title).toBe('没有离开');
        expect(result.trajectory.branches?.['before-1']).toHaveLength(5);
        expect(result.trajectory.branches?.['before-1'][0].title).toBe('没有离开');
        expect(result.trajectory.branches?.['before-1'].some(b => b.id === '1')).toBe(false);
    });
});

describe('trajectory node rewrite', () => {
    it('rejects meeting and life event nodes', async () => {
        const trajectory: CharTrajectory = {
            charId: 'char-1',
            generatedAt: 1,
            version: 2,
            firstMetTs,
            nodes: [{ id: 'met', ts: firstMetTs, era: 'meeting', title: '相遇', scene: '你出现了。', source: 'firstMet' }],
        };

        await expect(rewriteTrajectoryNode(trajectory, char, '你', 'met', api)).rejects.toThrow('只有相遇前');
    });

    it('rewrites generated before node and clears its cached detail and branches', async () => {
        vi.mocked(fetch).mockResolvedValue(makeResponse({
            title: '雨夜旧伞',
            scene: '相遇前很久，TA 在雨夜把伞留给了陌生人，自己淋着雨回家。',
            mood: '冷',
            place: '巷口',
            beat: '第一次学会忍住',
            object: '旧伞',
            tags: ['雨', '忍住'],
        }) as any);
        const trajectory: CharTrajectory = {
            charId: 'char-1',
            generatedAt: 1,
            version: 2,
            firstMetTs,
            nodes: [{ id: 'before-1', ts: firstMetTs - 1000, era: 'before', title: '旧节点', scene: '旧场景。', source: 'generated' }],
            nodeDetails: {
                'before-1': { nodeId: 'before-1', generatedAt: 1, stillFrame: '旧。', senses: [], innerMonologue: '旧。', unsaidLine: '旧。', consequence: '旧。' },
            },
            branches: { 'before-1': [branch('b1', 'before-1')] },
        };

        const result = await rewriteTrajectoryNode(trajectory, char, '你', 'before-1', api);

        expect(result.node.title).toBe('雨夜旧伞');
        expect(result.node.ts).toBe(firstMetTs - 1000);
        expect(result.trajectory.nodeDetails?.['before-1']).toBeUndefined();
        expect(result.trajectory.branches?.['before-1']).toBeUndefined();
    });
});
