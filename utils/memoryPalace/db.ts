/**
 * 回忆标本馆 — IndexedDB CRUD 操作
 *
 * 封装 6 张表的增删改查，复用主 db.ts 的 openDB()。
 */

import { openDB } from '../db';
import type {
    MemoryNode, MemoryLink, MemoryBatch,
    TopicBox, Anticipation, MemoryRoom, BoxStatus, AnticipationStatus,
    EventBox,
} from './types';
import { bm25Index } from './bm25Index';

// ─── Store 名称常量 ────────────────────────────────────

const STORE_MEMORY_NODES   = 'memory_nodes';
const STORE_LEGACY_INDEX_ROWS = 'memory_vectors';
const STORE_MEMORY_LINKS   = 'memory_links';
const STORE_MEMORY_BATCHES = 'memory_batches';
const STORE_TOPIC_BOXES    = 'topic_boxes';
const STORE_ANTICIPATIONS  = 'anticipations';
const STORE_EVENT_BOXES    = 'event_boxes';

// ─── 通用辅助 ──────────────────────────────────────────

/** 通用 getAll by index */
async function getAllByIndex<T>(
    storeName: string, indexName: string, value: IDBValidKey
): Promise<T[]> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const index = store.index(indexName);
        const req = index.getAll(IDBKeyRange.only(value));
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });
}

/** 通用 put */
async function put<T>(storeName: string, data: T): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).put(data);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

/** 通用 get by key */
async function getByKey<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

/** 通用 delete by key */
async function deleteByKey(storeName: string, key: IDBValidKey): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

/** 通用 getAll (全表) */
async function getAll<T>(storeName: string): Promise<T[]> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });
}

// ─── MemoryNode CRUD ──────────────────────────────────

export const MemoryNodeDB = {
    save: async (node: MemoryNode) => {
        await put<MemoryNode>(STORE_MEMORY_NODES, node);
        // 写入验证：确认数据真的持久化了
        const verify = await getByKey<MemoryNode>(STORE_MEMORY_NODES, node.id);
        if (!verify) {
            console.error(`❌ [MemoryNodeDB] WRITE VERIFICATION FAILED for ${node.id}`);
            throw new Error(`Memory node write failed: ${node.id}`);
        }
        // BM25 倒排索引：内部按 contentSig 判断是否需要重新 tokenize，
        // touchAccess 之类只改 metadata 的写入会被自动跳过。
        bm25Index.onNodeSaved(node);
    },

    getById: (id: string) => getByKey<MemoryNode>(STORE_MEMORY_NODES, id),

    delete: async (id: string) => {
        await deleteByKey(STORE_MEMORY_NODES, id);
        bm25Index.onNodeDeleted(id);
    },

    getByCharId: (charId: string) =>
        getAllByIndex<MemoryNode>(STORE_MEMORY_NODES, 'charId', charId),

    getByRoom: (charId: string, room: MemoryRoom): Promise<MemoryNode[]> =>
        getAllByIndex<MemoryNode>(STORE_MEMORY_NODES, 'charId', charId)
            .then(nodes => nodes.filter(n => n.room === room)),

    getUnembedded: (charId: string): Promise<MemoryNode[]> =>
        getAllByIndex<MemoryNode>(STORE_MEMORY_NODES, 'charId', charId)
            .then(nodes => nodes.filter(n => !n.embedded)),

    /** @deprecated 旧话题盒 ID 查询，保留以兼容残留数据；新代码请用 getByEventBoxId */
    getByBoxId: (boxId: string) =>
        getAllByIndex<MemoryNode>(STORE_MEMORY_NODES, 'boxId', boxId),

    /** 按 EventBox ID 查询所属记忆节点（含 live + archived + summary） */
    getByEventBoxId: (eventBoxId: string) =>
        getAllByIndex<MemoryNode>(STORE_MEMORY_NODES, 'eventBoxId', eventBoxId),

    /** 批量保存 */
    saveMany: async (nodes: MemoryNode[]): Promise<void> => {
        const db = await openDB();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_MEMORY_NODES, 'readwrite');
            const store = tx.objectStore(STORE_MEMORY_NODES);
            for (const node of nodes) {
                store.put(node);
            }
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
        bm25Index.onNodesSaved(nodes);
    },

    /** 更新访问记录（检索后调用） */
    touchAccess: async (id: string): Promise<void> => {
        const node = await getByKey<MemoryNode>(STORE_MEMORY_NODES, id);
        if (!node) return;
        node.lastAccessedAt = Date.now();
        node.accessCount = (node.accessCount || 0) + 1;
        node.activationCount = (node.activationCount || 0) + 1;
        await put<MemoryNode>(STORE_MEMORY_NODES, node);
    },
};

// ─── Legacy local index cleanup ────────────────────────

export const LegacyIndexResidueDB = {
    delete: (memoryId: string) => deleteByKey(STORE_LEGACY_INDEX_ROWS, memoryId),

    countByCharId: async (charId: string): Promise<number> => {
        try {
            const rows = await getAllByIndex<{ charId?: string }>(STORE_LEGACY_INDEX_ROWS, 'charId', charId);
            return rows.length;
        } catch {
            const rows = await getAll<{ charId?: string }>(STORE_LEGACY_INDEX_ROWS);
            return rows.filter(row => row?.charId === charId).length;
        }
    },
};

// ─── MemoryLink CRUD ──────────────────────────────────

export const MemoryLinkDB = {
    save: (link: MemoryLink) => put<MemoryLink>(STORE_MEMORY_LINKS, link),

    delete: (id: string) => deleteByKey(STORE_MEMORY_LINKS, id),

    getBySourceId: (sourceId: string) =>
        getAllByIndex<MemoryLink>(STORE_MEMORY_LINKS, 'sourceId', sourceId),

    getByTargetId: (targetId: string) =>
        getAllByIndex<MemoryLink>(STORE_MEMORY_LINKS, 'targetId', targetId),

    /** 获取与某节点相关的所有链接（source 或 target） */
    getByNodeId: async (nodeId: string): Promise<MemoryLink[]> => {
        const [asSource, asTarget] = await Promise.all([
            getAllByIndex<MemoryLink>(STORE_MEMORY_LINKS, 'sourceId', nodeId),
            getAllByIndex<MemoryLink>(STORE_MEMORY_LINKS, 'targetId', nodeId),
        ]);
        // 去重（同一条 link 不会同时出现在两个结果中，因为 sourceId ≠ targetId）
        const seen = new Set<string>();
        const result: MemoryLink[] = [];
        for (const link of [...asSource, ...asTarget]) {
            if (!seen.has(link.id)) {
                seen.add(link.id);
                result.push(link);
            }
        }
        return result;
    },

    /** 批量保存 */
    saveMany: async (links: MemoryLink[]): Promise<void> => {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_MEMORY_LINKS, 'readwrite');
            const store = tx.objectStore(STORE_MEMORY_LINKS);
            for (const link of links) {
                store.put(link);
            }
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    },
};

// ─── MemoryBatch CRUD ─────────────────────────────────

export const MemoryBatchDB = {
    save: (batch: MemoryBatch) => put<MemoryBatch>(STORE_MEMORY_BATCHES, batch),

    getByCharId: (charId: string) =>
        getAllByIndex<MemoryBatch>(STORE_MEMORY_BATCHES, 'charId', charId),
};

// ─── TopicBox CRUD ────────────────────────────────────

export const TopicBoxDB = {
    save: (box: TopicBox) => put<TopicBox>(STORE_TOPIC_BOXES, box),

    getById: (id: string) => getByKey<TopicBox>(STORE_TOPIC_BOXES, id),

    getByCharId: (charId: string) =>
        getAllByIndex<TopicBox>(STORE_TOPIC_BOXES, 'charId', charId),

    /** 获取角色当前 open 的盒子（最多一个） */
    getOpenBox: async (charId: string): Promise<TopicBox | undefined> => {
        const boxes = await getAllByIndex<TopicBox>(STORE_TOPIC_BOXES, 'charId', charId);
        return boxes.find(b => b.status === 'open');
    },

    /** 按状态过滤 */
    getByStatus: (charId: string, status: BoxStatus): Promise<TopicBox[]> =>
        getAllByIndex<TopicBox>(STORE_TOPIC_BOXES, 'charId', charId)
            .then(boxes => boxes.filter(b => b.status === status)),
};

// ─── EventBox CRUD ────────────────────────────────────

export const EventBoxDB = {
    save: (box: EventBox) => put<EventBox>(STORE_EVENT_BOXES, box),

    getById: (id: string) => getByKey<EventBox>(STORE_EVENT_BOXES, id),

    delete: (id: string) => deleteByKey(STORE_EVENT_BOXES, id),

    getByCharId: (charId: string) =>
        getAllByIndex<EventBox>(STORE_EVENT_BOXES, 'charId', charId),

    /** 批量保存（merge/compression 场景用） */
    saveMany: async (boxes: EventBox[]): Promise<void> => {
        if (boxes.length === 0) return;
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_EVENT_BOXES, 'readwrite');
            const store = tx.objectStore(STORE_EVENT_BOXES);
            for (const box of boxes) store.put(box);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    },
};

// ─── Anticipation CRUD ────────────────────────────────

export const AnticipationDB = {
    save: (ant: Anticipation) => put<Anticipation>(STORE_ANTICIPATIONS, ant),

    getById: (id: string) => getByKey<Anticipation>(STORE_ANTICIPATIONS, id),

    getByCharId: (charId: string) =>
        getAllByIndex<Anticipation>(STORE_ANTICIPATIONS, 'charId', charId),

    getByStatus: (charId: string, status: AnticipationStatus): Promise<Anticipation[]> =>
        getAllByIndex<Anticipation>(STORE_ANTICIPATIONS, 'charId', charId)
            .then(ants => ants.filter(a => a.status === status)),

    getActive: (charId: string) =>
        AnticipationDB.getByStatus(charId, 'active'),
};

function clearMemoryPalaceLocalStateForChar(charId: string): number {
    let removed = 0;
    try {
        const exact = new Set([
            `mp_lastMsgId_${charId}`,
            `mp_working_memory_${charId}`,
            `mp_recall_receipts_${charId}`,
            `mp_recall_round_${charId}`,
            `mp_anchor_last_seen_${charId}`,
            `mp_cognized_clusters_${charId}`,
            `mp_digestRounds_${charId}`,
            `mp_lastDigest_${charId}`,
            `mp_anchor_cooldown_${charId}`,
            `os_mp_recall_receipts_${charId}`,
            `mp_personality_tried_${charId}`,
        ]);
        const prefixes = [
            `mp_cognition_cluster_`,
            `mp_digest_last_turn_${charId}`,
            `mp_first_archive_notice_${charId}`,
        ];
        const toRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key) continue;
            if (exact.has(key) || prefixes.some(p => key.startsWith(p) && key.includes(charId))) {
                toRemove.push(key);
            }
        }
        for (const key of toRemove) {
            localStorage.removeItem(key);
            removed++;
        }
    } catch { /* ignore */ }
    return removed;
}

export interface ClearMemoryPalaceForCharResult {
    nodes: number;
    legacyIndexRows: number;
    links: number;
    batches: number;
    topicBoxes: number;
    eventBoxes: number;
    anticipations: number;
    localState: number;
}

/** 清掉某个角色的本地回忆标本馆数据，并移除旧版本本地索引残留。 */
export async function clearMemoryPalaceForChar(charId: string): Promise<ClearMemoryPalaceForCharResult> {
    const db = await openDB();
    const stores = [
        STORE_MEMORY_NODES,
        STORE_LEGACY_INDEX_ROWS,
        STORE_MEMORY_LINKS,
        STORE_MEMORY_BATCHES,
        STORE_TOPIC_BOXES,
        STORE_ANTICIPATIONS,
        STORE_EVENT_BOXES,
    ].filter(name => db.objectStoreNames.contains(name));

    const result: ClearMemoryPalaceForCharResult = {
        nodes: 0,
        legacyIndexRows: 0,
        links: 0,
        batches: 0,
        topicBoxes: 0,
        eventBoxes: 0,
        anticipations: 0,
        localState: 0,
    };
    if (stores.length === 0) {
        result.localState = clearMemoryPalaceLocalStateForChar(charId);
        return result;
    }

    const existingNodes = stores.includes(STORE_MEMORY_NODES)
        ? await getAllByIndex<MemoryNode>(STORE_MEMORY_NODES, 'charId', charId)
        : [];
    const nodeIds = new Set(existingNodes.map(n => n.id));

    await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(stores, 'readwrite');
        let pending = 0;
        const fail = (err: any) => reject(err);
        const doneOne = () => { pending--; };
        const deleteByCharIndex = (storeName: string, countKey: keyof ClearMemoryPalaceForCharResult) => {
            if (!stores.includes(storeName)) return;
            pending++;
            const req = tx.objectStore(storeName).index('charId').openCursor(IDBKeyRange.only(charId));
            req.onsuccess = () => {
                const cursor = req.result;
                if (!cursor) { doneOne(); return; }
                (result[countKey] as number)++;
                cursor.delete();
                cursor.continue();
            };
            req.onerror = () => fail(req.error);
        };

        deleteByCharIndex(STORE_MEMORY_NODES, 'nodes');
        deleteByCharIndex(STORE_LEGACY_INDEX_ROWS, 'legacyIndexRows');
        deleteByCharIndex(STORE_MEMORY_BATCHES, 'batches');
        deleteByCharIndex(STORE_TOPIC_BOXES, 'topicBoxes');
        deleteByCharIndex(STORE_EVENT_BOXES, 'eventBoxes');
        deleteByCharIndex(STORE_ANTICIPATIONS, 'anticipations');

        if (stores.includes(STORE_MEMORY_LINKS)) {
            pending++;
            const req = tx.objectStore(STORE_MEMORY_LINKS).openCursor();
            req.onsuccess = () => {
                const cursor = req.result;
                if (!cursor) { doneOne(); return; }
                const link = cursor.value as MemoryLink;
                if (nodeIds.has(link.sourceId) || nodeIds.has(link.targetId)) {
                    result.links++;
                    cursor.delete();
                }
                cursor.continue();
            };
            req.onerror = () => fail(req.error);
        }

        tx.oncomplete = () => resolve();
        tx.onerror = () => fail(tx.error);
        tx.onabort = () => fail(tx.error);
    });

    bm25Index.drop(charId);
    result.localState = clearMemoryPalaceLocalStateForChar(charId);
    return result;
}
