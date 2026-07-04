/**
 * 群聊回忆标本馆 — 群聊后台总结管线
 *
 * 与私聊管线（pipeline.ts/processNewMessages）的关系：**完全平行、互不调用**。
 * 所有共享的只是底层 IndexedDB 表（memory_nodes 等通用 CRUD）和本地文本检索。
 * 私聊代码一行不动。
 *
 * 核心数据流：
 * 1. 群聊导演响应后，GroupChat fire-and-forget 调用 processGroupNewMessages
 * 2. 检查群聊高水位线（per-groupId localStorage key），缓冲区超 BUFFER_THRESHOLD_GROUP 才触发
 * 3. LLM 用第三人称提取群记忆草稿（groupExtraction.extractGroupMemoriesFromBuffer）
 * 4. 每个成员各持久化一份（同样的草稿，charId=member.id，附 groupId/groupName 字段）
 *    → 私聊里 retrieveMemories(member.id) 自然能召回这条群记忆，**无需额外注入路径**
 * 5. 更新群聊高水位线
 *
 * 删除群时，调用 deleteGroupMemoriesByGroupId 清理所有相关记忆。
 */
import type { Message, CharacterProfile, GroupProfile } from '../../types';
import type { MemoryNode } from './types';
import type { LightLLMConfig } from './pipeline';
import { DB } from '../db';
import { LegacyIndexResidueDB, MemoryNodeDB } from './db';
import { extractGroupMemoriesFromBuffer } from './groupExtraction';
import { isMessageSemanticallyRelevant } from '../messageFormat';
import { formatCharacterWithId } from '../characterIdentity';
import { resolveMemoryPalaceAuxConfigsFromStorage } from './auxConfig';
import { isMemoryFeatureEnabled } from './cognitiveFlow';

// ─── 群聊水位线：私聊用 200/100，群聊更宽松 300/200 ─────────────────
const HOT_ZONE_SIZE_GROUP = 300;
const BUFFER_THRESHOLD_GROUP = 200;
const PROCESS_RATIO = 0.85;

const LAST_MSG_KEY_GROUP = (groupId: string) => `mp_lastMsgId_group_${groupId}`;

function getLastProcessedGroupId(groupId: string): number {
    try {
        const val = parseInt(localStorage.getItem(LAST_MSG_KEY_GROUP(groupId)) || '0', 10);
        return isNaN(val) || val < 0 ? 0 : val;
    } catch { return 0; }
}

function setLastProcessedGroupId(groupId: string, msgId: number): void {
    try { localStorage.setItem(LAST_MSG_KEY_GROUP(groupId), String(msgId)); } catch {}
}

/** 全局回忆标本馆配置（自己读 localStorage，不调 pipeline.ts 的私有 getter） */
function readGlobalMemoryPalaceConfig(): {
    lightLLM?: LightLLMConfig;
} {
    const { llm } = resolveMemoryPalaceAuxConfigsFromStorage();
    return {
        lightLLM: llm || undefined,
    };
}

function normalizeMemoryText(text: string): string {
    return (text || '')
        .replace(/\s+/g, '')
        .replace(/[\p{P}\p{S}]/gu, '')
        .toLowerCase()
        .slice(0, 160);
}

function generateGroupMemoryId(): string {
    return `mng_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 把消息按 charId 映射成显示名（用户消息 → userName，角色消息 → 角色名） */
function makeSpeakerNameOf(members: CharacterProfile[], userName: string) {
    const charIdToName = new Map<string, string>();
    for (const m of members) charIdToName.set(m.id, formatCharacterWithId(m));
    return (msg: Message): string => {
        if (msg.role === 'user') return userName || '用户';
        if (msg.charId) return charIdToName.get(msg.charId) || '群友';
        return '群友';
    };
}

// ─── 并发锁：每个群同时只跑一个处理任务 ─────────────────
const processingLocks = new Set<string>();

/**
 * 删除某个群的所有群记忆（成员各自存的副本一并清掉）
 *
 * 群被删除时调用：扫描全表，删除 groupId 匹配的 MemoryNode，并顺手清理旧版本索引残留。
 * 全表扫不快但删群是低频操作，可接受。
 */
export async function deleteGroupMemoriesByGroupId(groupId: string): Promise<{ deleted: number }> {
    if (!groupId) return { deleted: 0 };
    try {
        const all = await (async () => {
            // MemoryNodeDB 没有 getAll；走通用 db 表名直查
            const db = await (await import('../db')).openDB();
            return new Promise<MemoryNode[]>((resolve, reject) => {
                const tx = db.transaction('memory_nodes', 'readonly');
                const req = tx.objectStore('memory_nodes').getAll();
                req.onsuccess = () => resolve(req.result || []);
                req.onerror = () => reject(req.error);
            });
        })();
        const targets = all.filter(n => n.groupId === groupId);
        if (targets.length === 0) return { deleted: 0 };
        for (const node of targets) {
            try {
                await MemoryNodeDB.delete(node.id);
                // 顺手清掉旧版本可能留下的索引行。
                await LegacyIndexResidueDB.delete(node.id);
            } catch (e: any) {
                console.warn(`🗑️ [GroupPalace] 删除节点 ${node.id} 失败: ${e.message}`);
            }
        }
        console.log(`🗑️ [GroupPalace] 删除群 ${groupId} 的群记忆 ${targets.length} 条`);
        return { deleted: targets.length };
    } catch (e: any) {
        console.warn(`🗑️ [GroupPalace] 清理群记忆失败: ${e.message}`);
        return { deleted: 0 };
    }
}

/**
 * 群聊后台缓冲区处理。
 *
 * - 至少需要 1 个成员开启了回忆标本馆才跑（否则直接 return null）
 * - 全程异常吞掉，console.warn 后返回 null，绝不影响 GroupChat 主流程
 * - 写出来的 MemoryNode 自带 groupId/groupName，私聊代码读到这俩字段不感知（无副作用）
 * - onProgress 回调：每进入一个关键阶段触发一次（"扫描缓冲区" / "LLM 提取中" / "保存第 X 个成员"），
 *   caller 用它做 toast/状态条等用户可见提示。skip 路径（hot_zone/threshold）**不触发** onProgress，
 *   避免水位线没到时也弹"在整理"造成误导。
 */
export async function processGroupNewMessages(
    group: GroupProfile,
    members: CharacterProfile[],
    userName: string,
    onProgress?: (stage: string) => void,
): Promise<{
    stored: number;
    perMemberStored: Record<string, number>;
    /** drafts 数量（即从 LLM 提取出的群记忆条数；可能 ≥ stored，因为 dedup 会扣掉一些） */
    extracted?: number;
    /** 本轮处理的群消息条数（用于 result toast 显示信息量） */
    processedMessageCount?: number;
    reason?: 'lock' | 'hot_zone' | 'threshold' | 'no_config' | 'no_enabled_member';
} | null> {
    if (!group?.id) return null;
    const lockKey = group.id;
    if (processingLocks.has(lockKey)) {
        return { stored: 0, perMemberStored: {}, reason: 'lock' };
    }
    processingLocks.add(lockKey);

    try {
        // 1. 至少要有一个成员开启了回忆标本馆
        const enabledMembers = members.filter(m => isMemoryFeatureEnabled(m as any));
        if (enabledMembers.length === 0) {
            return { stored: 0, perMemberStored: {}, reason: 'no_enabled_member' };
        }

        // 2. 解析全局 LLM 配置
        const globalCfg = readGlobalMemoryPalaceConfig();
        const lightLLM = globalCfg.lightLLM;
        if (!lightLLM) {
            console.warn(`🏰 [GroupPalace] 群 ${group.name} 没有可用的 lightLLM 配置，跳过`);
            return { stored: 0, perMemberStored: {}, reason: 'no_config' };
        }

        // 3. 加载群消息 → 计算热区 / 缓冲区
        const allMsgs = await DB.getGroupMessages(group.id);
        const textMsgs = allMsgs
            .filter(isMessageSemanticallyRelevant)
            .sort((a, b) => a.id - b.id);

        const totalCount = textMsgs.length;
        if (totalCount <= HOT_ZONE_SIZE_GROUP) {
            console.log(`🏰 [GroupPalace] 群 ${group.name}：消息总数 ${totalCount} <= 热区 ${HOT_ZONE_SIZE_GROUP}，无需处理`);
            return { stored: 0, perMemberStored: {}, reason: 'hot_zone' };
        }

        const hotZoneStartIdx = totalCount - HOT_ZONE_SIZE_GROUP;
        const hotZoneStartId = textMsgs[hotZoneStartIdx].id;

        const lastProcessedId = getLastProcessedGroupId(group.id);
        const buffer = textMsgs.filter(m => m.id > lastProcessedId && m.id < hotZoneStartId);

        if (buffer.length < BUFFER_THRESHOLD_GROUP) {
            console.log(`🏰 [GroupPalace] 群 ${group.name}：缓冲区 ${buffer.length} < ${BUFFER_THRESHOLD_GROUP}，跳过（hwm=${lastProcessedId}, 热区起点 id=${hotZoneStartId}）`);
            return { stored: 0, perMemberStored: {}, reason: 'threshold' };
        }

        // 4. 取前 85%
        const processCount = Math.ceil(buffer.length * PROCESS_RATIO);
        const toProcess = buffer.slice(0, processCount);
        const sourceMessageIds = Array.from(new Set(
            toProcess
                .map(m => m.id)
                .filter((id): id is number => typeof id === 'number' && id > 0),
        )).slice(-120);
        const keptTail = buffer.length - processCount;
        if (toProcess.length === 0) return { stored: 0, perMemberStored: {}, reason: 'threshold' };

        console.log(`🏰 [GroupPalace] 群 ${group.name}：开始处理 ${toProcess.length} 条群消息（保留尾部 ${keptTail} 条）`);
        onProgress?.(`正在整理 ${toProcess.length} 条群消息...`);

        // 5. LLM 提取（第三人称草稿）
        const memberNames = members.map(m => formatCharacterWithId(m));
        const speakerNameOf = makeSpeakerNameOf(members, userName);
        onProgress?.(`正在提取【${group.name}】群记忆...`);
        const { drafts } = await extractGroupMemoriesFromBuffer(
            toProcess,
            group.name,
            memberNames,
            userName || '用户',
            speakerNameOf,
            lightLLM,
        );

        if (drafts.length === 0) {
            console.warn(`🏰 [GroupPalace] 群 ${group.name}：提取 0 条群记忆，不更新水位线，下次重试`);
            return { stored: 0, perMemberStored: {}, extracted: 0, processedMessageCount: toProcess.length };
        }

        console.log(`🏰 [GroupPalace] 群 ${group.name}：提取 ${drafts.length} 条群记忆，开始为 ${enabledMembers.length} 个成员各持久化一份`);
        onProgress?.(`提取到 ${drafts.length} 条群记忆，正在存入 ${enabledMembers.length} 个成员的回忆标本馆...`);

        // 6. 为每个开启回忆标本馆的成员各存一份
        const perMemberStored: Record<string, number> = {};
        let totalStored = 0;

        for (const member of enabledMembers) {
            try {
                const existingNodes = await MemoryNodeDB.getByCharId(member.id);
                const existingSignatures = new Set(existingNodes.map(n => normalizeMemoryText(n.content)).filter(Boolean));

                let storedForMember = 0;
                for (let i = 0; i < drafts.length; i++) {
                    const draft = drafts[i];
                    const signature = normalizeMemoryText(draft.content);

                    if (signature && existingSignatures.has(signature)) {
                        console.log(`♻️ [GroupPalace] ${member.name}：重复群记忆跳过 "${draft.content.slice(0, 30)}..."`);
                        continue;
                    }

                    const node: MemoryNode = {
                        id: generateGroupMemoryId(),
                        charId: member.id,
                        content: draft.content,
                        room: draft.room,
                        tags: draft.tags,
                        importance: draft.importance,
                        mood: draft.mood,
                        valence: draft.valence,
                        arousal: draft.arousal,
                        embedded: false,
                        createdAt: draft.createdAt,
                        lastAccessedAt: draft.createdAt,
                        accessCount: 0,
                        eventBoxId: null,
                        origin: 'extraction',
                        groupId: group.id,
                        groupName: group.name,
                        source: { kind: 'group_chat', label: group.name, refId: group.id },
                        cognitiveLayer: 'event',
                        sourceMessageIds: sourceMessageIds.length > 0 ? sourceMessageIds : undefined,
                        eventTime: draft.createdAt,
                    };
                    await MemoryNodeDB.save(node);
                    if (signature) existingSignatures.add(signature);
                    storedForMember++;
                }

                perMemberStored[member.id] = storedForMember;
                totalStored += storedForMember;
                console.log(`🏰 [GroupPalace] ${member.name}：存入 ${storedForMember} 条群记忆`);
            } catch (e: any) {
                console.warn(`🏰 [GroupPalace] ${member.name} 持久化群记忆失败: ${e.message}（其他成员继续）`);
                perMemberStored[member.id] = 0;
            }
        }

        // 7. 更新群聊水位线（即使部分成员失败也推进——避免重复提取）
        if (totalStored > 0) {
            const newHighWaterMark = toProcess[toProcess.length - 1].id;
            setLastProcessedGroupId(group.id, newHighWaterMark);
            console.log(`✅ [GroupPalace] 群 ${group.name}：处理完成 ${totalStored} 条总入库, hwm ${lastProcessedId} → ${newHighWaterMark}`);
        } else {
            console.warn(`🏰 [GroupPalace] 群 ${group.name}：所有成员都没存进 0 条，不更新水位线`);
        }

        return {
            stored: totalStored,
            perMemberStored,
            extracted: drafts.length,
            processedMessageCount: toProcess.length,
        };
    } catch (e: any) {
        console.warn(`❌ [GroupPalace] 群 ${group.name} 处理失败: ${e.message}`);
        return null;
    } finally {
        processingLocks.delete(lockKey);
    }
}
