/**
 * Memory Palace — 一键清空
 *
 * 把本地所有记忆宫殿数据清零；包括旧版本留下的本地 memory_vectors 表。
 *
 * 使用场景：
 *  - 用户想"重来"（比如希望应用新版 boxId 体系）
 *  - 开发/测试重置
 */

import { openDB } from '../db';
import { bm25Index } from './bm25Index';

const MP_STORES = [
    'memory_nodes',
    'memory_vectors',
    'memory_links',
    'memory_batches',
    'topic_boxes',
    'anticipations',
    'event_boxes',
];

/** 清空 localStorage 中所有 mp_lastMsgId_<charId> 高水位标记 */
function clearHighWatermarks(): number {
    let n = 0;
    try {
        const toRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('mp_lastMsgId_')) toRemove.push(key);
        }
        for (const key of toRemove) {
            localStorage.removeItem(key);
            n++;
        }
    } catch { /* ignore */ }
    return n;
}

/** 清空本地 IndexedDB 的所有记忆宫殿表 */
async function clearLocalStores(): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    const db = await openDB();

    // 只对实际存在的 store 操作（兼容旧版本未建 event_boxes 的情况）
    const presentStores = MP_STORES.filter(name => db.objectStoreNames.contains(name));
    if (presentStores.length === 0) return counts;

    return await new Promise<Record<string, number>>((resolve, reject) => {
        const tx = db.transaction(presentStores, 'readwrite');

        // 先异步收集每张表的行数，再清空；用嵌套 onsuccess 串起来
        let pending = presentStores.length;
        const checkDone = () => {
            if (pending === 0) {
                // 所有 count 回调完成，这里发起 clear
                for (const name of presentStores) {
                    try { tx.objectStore(name).clear(); } catch { /* ignore */ }
                }
            }
        };

        for (const name of presentStores) {
            const req = tx.objectStore(name).count();
            req.onsuccess = () => {
                counts[name] = req.result || 0;
                pending--;
                checkDone();
            };
            req.onerror = () => {
                counts[name] = 0;
                pending--;
                checkDone();
            };
        }

        tx.oncomplete = () => resolve(counts);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
}

export interface WipeResult {
    local: Record<string, number>;
    localRowsTotal: number;
    highWatermarks: number;
}

/**
 * 一键清空记忆宫殿数据。
 *
 */
export async function wipeAllMemoryPalace(): Promise<WipeResult> {
    console.log(`🗑️ [Wipe] 开始一键清空记忆宫殿...`);

    const local = await clearLocalStores();
    const localRowsTotal = Object.values(local).reduce((s, v) => s + v, 0);
    const hwm = clearHighWatermarks();

    // 同步清空内存中的 BM25 倒排索引（否则下次查询会拿到孤儿 nodeId）
    bm25Index.dropAll();

    console.log(`🗑️ [Wipe] 完成：本地 ${localRowsTotal} 行、高水位 ${hwm} 条`);
    return { local, localRowsTotal, highWatermarks: hwm };
}
