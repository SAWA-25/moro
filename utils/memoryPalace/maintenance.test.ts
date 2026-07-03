import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DB } from '../db';
import { EventBoxDB, MemoryLinkDB, MemoryNodeDB, MemoryVectorDB } from './db';
import type { EmbeddingConfig, EventBox, MemoryNode } from './types';
import {
    inspectMemoryPalace,
    repairMemoryPalaceIntegrity,
    revectorizeMemoryNodes,
} from './maintenance';

const CHAR = 'maintenance-char';

function node(id: string, patch: Partial<MemoryNode> = {}): MemoryNode {
    const now = Date.now();
    return {
        id,
        charId: CHAR,
        content: `记忆 ${id}`,
        room: 'living_room',
        tags: [],
        importance: 5,
        mood: 'neutral',
        embedded: true,
        createdAt: now,
        lastAccessedAt: now,
        accessCount: 0,
        ...patch,
    };
}

function box(id: string, patch: Partial<EventBox> = {}): EventBox {
    const now = Date.now();
    return {
        id,
        charId: CHAR,
        name: `事件盒 ${id}`,
        tags: [],
        summaryNodeId: null,
        liveMemoryIds: [],
        archivedMemoryIds: [],
        compressionCount: 0,
        createdAt: now,
        updatedAt: now,
        lastCompressedAt: null,
        ...patch,
    };
}

const embeddingConfig: EmbeddingConfig = {
    baseUrl: 'https://api.test/v1',
    apiKey: 'test-key',
    model: 'BAAI/bge-m3',
    dimensions: 3,
};

beforeEach(async () => {
    vi.restoreAllMocks();
    localStorage.clear();
    await DB.deleteDB();
});

describe('memoryPalace maintenance', () => {
    it('inspectMemoryPalace reports high water mark, hot zone and processable buffer', async () => {
        for (let i = 0; i < 215; i++) {
            await DB.saveMessage({
                charId: CHAR,
                role: i % 2 === 0 ? 'user' : 'assistant',
                type: 'text',
                content: `message ${i}`,
                timestamp: i + 1,
            });
        }

        const report = await inspectMemoryPalace(CHAR);

        expect(report.processing.totalSemanticMessages).toBe(215);
        expect(report.processing.highWaterMark).toBe(0);
        expect(report.processing.hotZoneProtectedCount).toBe(200);
        expect(report.processing.bufferCount).toBe(15);
        expect(report.processing.processableCount).toBe(13);
        expect(report.processing.autoEligible).toBe(false);
        expect(report.processing.forceEligible).toBe(true);
    });

    it('inspectMemoryPalace finds missing vectors, orphan vectors, broken links and bad EventBox refs', async () => {
        await MemoryNodeDB.save(node('embedded-missing-vector'));
        await MemoryNodeDB.save(node('unembedded', { embedded: false }));
        await MemoryNodeDB.save(node('linked'));
        await MemoryNodeDB.save(node('missing-box', { eventBoxId: 'box-gone', archived: true }));
        await MemoryNodeDB.save(node('mismatch', { eventBoxId: 'box-ok' }));
        await MemoryNodeDB.save(node('tagged', { source: { kind: 'legacy_memory', label: '旧记忆导入' } }));
        await MemoryVectorDB.save({ memoryId: 'orphan-vector', charId: CHAR, vector: [1, 0, 0], dimensions: 3, model: 'test' });
        await MemoryLinkDB.save({ id: 'broken-link', sourceId: 'linked', targetId: 'gone', type: 'causal', strength: 0.6 });
        await EventBoxDB.save(box('box-ok', {
            summaryNodeId: 'missing-summary',
            liveMemoryIds: ['linked', 'missing-live'],
            archivedMemoryIds: ['missing-archived'],
        }));

        const report = await inspectMemoryPalace(CHAR);

        expect(report.counts.nodes).toBe(6);
        expect(report.counts.migratedTagged).toBe(1);
        expect(report.issues.missingVectorNodeIds).toContain('embedded-missing-vector');
        expect(report.issues.unembeddedNodeIds).toContain('unembedded');
        expect(report.issues.orphanVectorIds).toContain('orphan-vector');
        expect(report.issues.brokenLinkIds).toContain('broken-link');
        expect(report.issues.missingEventBoxRefs).toEqual(expect.arrayContaining([
            { boxId: 'box-ok', field: 'summary', nodeId: 'missing-summary' },
            { boxId: 'box-ok', field: 'live', nodeId: 'missing-live' },
            { boxId: 'box-ok', field: 'archived', nodeId: 'missing-archived' },
        ]));
        expect(report.issues.nodesWithMissingBoxIds).toContain('missing-box');
        expect(report.issues.nodeEventBoxMismatchIds).toContain('mismatch');
    });

    it('repairMemoryPalaceIntegrity removes unsafe references and normalizes node box state', async () => {
        await MemoryNodeDB.save(node('live', { eventBoxId: null }));
        await MemoryNodeDB.save(node('archived', { eventBoxId: null, archived: false }));
        await MemoryNodeDB.save(node('missing-box', { eventBoxId: 'box-gone', archived: true, isBoxSummary: true }));
        await MemoryNodeDB.save(node('mismatch', { eventBoxId: 'box-ok', archived: true }));
        await MemoryVectorDB.save({ memoryId: 'orphan-vector', charId: CHAR, vector: [1, 0, 0], dimensions: 3, model: 'test' });
        await MemoryLinkDB.save({ id: 'broken-link', sourceId: 'live', targetId: 'gone', type: 'causal', strength: 0.6 });
        await EventBoxDB.save(box('box-ok', {
            summaryNodeId: 'missing-summary',
            liveMemoryIds: ['live', 'missing-live'],
            archivedMemoryIds: ['archived', 'missing-archived'],
        }));

        const result = await repairMemoryPalaceIntegrity(CHAR);
        const report = await inspectMemoryPalace(CHAR);
        const freshBox = await EventBoxDB.getById('box-ok');
        const live = await MemoryNodeDB.getById('live');
        const archived = await MemoryNodeDB.getById('archived');
        const missingBox = await MemoryNodeDB.getById('missing-box');
        const mismatch = await MemoryNodeDB.getById('mismatch');

        expect(result.deletedOrphanVectors).toBe(1);
        expect(result.deletedBrokenLinks).toBe(1);
        expect(result.cleanedBoxRefs).toBe(3);
        expect(result.detachedMissingBoxes).toBe(1);
        expect(report.issues.orphanVectorIds).toEqual([]);
        expect(report.issues.brokenLinkIds).toEqual([]);
        expect(report.issues.missingEventBoxRefs).toEqual([]);
        expect(freshBox?.summaryNodeId).toBeNull();
        expect(freshBox?.liveMemoryIds).toEqual(['live']);
        expect(freshBox?.archivedMemoryIds).toEqual(['archived']);
        expect(live?.eventBoxId).toBe('box-ok');
        expect(live?.archived).toBeFalsy();
        expect(archived?.eventBoxId).toBe('box-ok');
        expect(archived?.archived).toBe(true);
        expect(missingBox?.eventBoxId).toBeNull();
        expect(missingBox?.archived).toBe(false);
        expect(mismatch?.eventBoxId).toBeNull();
        expect(mismatch?.archived).toBe(false);
    });

    it('revectorizeMemoryNodes deletes stale vectors and leaves node pending when embedding config is missing', async () => {
        await MemoryNodeDB.save(node('edit-node'));
        await MemoryVectorDB.save({ memoryId: 'edit-node', charId: CHAR, vector: [0.1, 0.2, 0.3], dimensions: 3, model: 'old' });

        const result = await revectorizeMemoryNodes(CHAR, ['edit-node'], null);
        const fresh = await MemoryNodeDB.getById('edit-node');
        const vector = await MemoryVectorDB.getByMemoryId('edit-node');

        expect(result).toEqual({ requested: 1, rebuilt: 0, failed: 1, error: 'embedding_missing' });
        expect(fresh?.embedded).toBe(false);
        expect(vector).toBeUndefined();
    });

    it('revectorizeMemoryNodes rebuilds vectors with the current content and model', async () => {
        await MemoryNodeDB.save(node('edit-node', { content: '新的正文' }));
        await MemoryVectorDB.save({ memoryId: 'edit-node', charId: CHAR, vector: [0.1, 0.2, 0.3], dimensions: 3, model: 'old' });
        global.fetch = vi.fn(async (_url: any, init: any) => {
            const body = JSON.parse(init.body as string);
            expect(body.input).toEqual(['新的正文']);
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    data: [{ index: 0, embedding: [1, 2, 3] }],
                }),
            } as any;
        }) as any;

        const result = await revectorizeMemoryNodes(CHAR, ['edit-node'], embeddingConfig);
        const fresh = await MemoryNodeDB.getById('edit-node');
        const vector = await MemoryVectorDB.getByMemoryId('edit-node');

        expect(result).toEqual({ requested: 1, rebuilt: 1, failed: 0 });
        expect(fresh?.embedded).toBe(true);
        expect(vector?.model).toBe(embeddingConfig.model);
        expect(Array.from(vector?.vector as Float32Array)).toEqual([1, 2, 3]);
    });
});
