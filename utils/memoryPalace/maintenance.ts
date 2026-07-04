/**
 * Memory Palace maintenance helpers.
 *
 * These helpers keep UI repair actions out of React components: inspect what is
 * safe to inspect locally and repair only structural references.
 */

import type { MemoryFragment } from '../../types';
import type { EventBox, MemoryLink, MemoryNode } from './types';
import { EventBoxDB, LegacyIndexResidueDB, MemoryLinkDB, MemoryNodeDB } from './db';
import type { LightLLMConfig, MemoryPalaceProcessingStats, PipelineResult } from './pipeline';
import {
    getMemoryPalaceHighWaterMark,
    getMemoryPalaceProcessingStats,
    mergePalaceFragmentsIntoMemories,
    processNewMessages,
} from './pipeline';

export interface MemoryPalaceInspection {
    charId: string;
    processing: MemoryPalaceProcessingStats;
    counts: {
        nodes: number;
        links: number;
        eventBoxes: number;
        pinned: number;
        migratedTagged: number;
        legacyIndexRows: number;
    };
    issues: {
        brokenLinkIds: string[];
        missingEventBoxRefs: { boxId: string; field: 'summary' | 'live' | 'archived'; nodeId: string }[];
        nodeEventBoxMismatchIds: string[];
        nodesWithMissingBoxIds: string[];
    };
}

export interface MemoryPalaceRepairResult {
    deletedBrokenLinks: number;
    cleanedBoxRefs: number;
    fixedNodeBoxRefs: number;
    detachedMissingBoxes: number;
}

export interface MemoryPalaceCatchUpTarget {
    id: string;
    name: string;
    memories?: MemoryFragment[];
    hideBeforeMessageId?: number;
    autoArchiveEnabled?: boolean;
}

export interface MemoryPalaceCatchUpResult {
    rounds: number;
    processedMessages: number;
    stored: number;
    skipped: number;
    stoppedReason: 'done' | 'lock' | 'hot_zone' | 'threshold' | 'no_progress' | 'max_rounds' | 'error';
    updatedMemories: MemoryFragment[];
    hideBeforeMessageId?: number;
    shouldUpdateCharacter: boolean;
    lastPipelineResult?: PipelineResult | null;
    error?: string;
}

async function loadAllLinksForNodes(nodes: MemoryNode[]): Promise<MemoryLink[]> {
    const seen = new Set<string>();
    const out: MemoryLink[] = [];
    await Promise.all(nodes.map(async node => {
        const links = await MemoryLinkDB.getByNodeId(node.id);
        for (const link of links) {
            if (seen.has(link.id)) continue;
            seen.add(link.id);
            out.push(link);
        }
    }));
    return out;
}

function collectBoxRefIssues(boxes: EventBox[], nodeIds: Set<string>): MemoryPalaceInspection['issues']['missingEventBoxRefs'] {
    const issues: MemoryPalaceInspection['issues']['missingEventBoxRefs'] = [];
    for (const box of boxes) {
        if (box.summaryNodeId && !nodeIds.has(box.summaryNodeId)) {
            issues.push({ boxId: box.id, field: 'summary', nodeId: box.summaryNodeId });
        }
        for (const id of box.liveMemoryIds || []) {
            if (!nodeIds.has(id)) issues.push({ boxId: box.id, field: 'live', nodeId: id });
        }
        for (const id of box.archivedMemoryIds || []) {
            if (!nodeIds.has(id)) issues.push({ boxId: box.id, field: 'archived', nodeId: id });
        }
    }
    return issues;
}

export async function inspectMemoryPalace(charId: string): Promise<MemoryPalaceInspection> {
    const [processing, nodes, legacyIndexRows, boxes] = await Promise.all([
        getMemoryPalaceProcessingStats(charId),
        MemoryNodeDB.getByCharId(charId),
        LegacyIndexResidueDB.countByCharId(charId),
        EventBoxDB.getByCharId(charId),
    ]);
    const links = await loadAllLinksForNodes(nodes);
    const nodeIds = new Set(nodes.map(n => n.id));
    const boxIds = new Set(boxes.map(b => b.id));
    const now = Date.now();

    const brokenLinkIds = links
        .filter(l => !nodeIds.has(l.sourceId) || !nodeIds.has(l.targetId))
        .map(l => l.id);
    const missingEventBoxRefs = collectBoxRefIssues(boxes, nodeIds);
    const nodesWithMissingBoxIds = nodes
        .filter(n => n.eventBoxId && !boxIds.has(n.eventBoxId))
        .map(n => n.id);
    const nodeEventBoxMismatchIds = nodes
        .filter(n => {
            if (!n.eventBoxId || !boxIds.has(n.eventBoxId)) return false;
            const box = boxes.find(b => b.id === n.eventBoxId);
            if (!box) return false;
            const isSummary = box.summaryNodeId === n.id;
            const isLive = (box.liveMemoryIds || []).includes(n.id);
            const isArchived = (box.archivedMemoryIds || []).includes(n.id);
            return !isSummary && !isLive && !isArchived;
        })
        .map(n => n.id);

    return {
        charId,
        processing,
        counts: {
            nodes: nodes.length,
            links: links.length,
            eventBoxes: boxes.length,
            pinned: nodes.filter(n => n.pinnedUntil && n.pinnedUntil > now).length,
            migratedTagged: nodes.filter(n => n.source?.kind === 'legacy_memory').length,
            legacyIndexRows,
        },
        issues: {
            brokenLinkIds,
            missingEventBoxRefs,
            nodeEventBoxMismatchIds,
            nodesWithMissingBoxIds,
        },
    };
}

export async function repairMemoryPalaceIntegrity(charId: string): Promise<MemoryPalaceRepairResult> {
    const [nodes, boxes] = await Promise.all([
        MemoryNodeDB.getByCharId(charId),
        EventBoxDB.getByCharId(charId),
    ]);
    const nodeIds = new Set(nodes.map(n => n.id));
    const boxIds = new Set(boxes.map(b => b.id));
    const nodeById = new Map(nodes.map(n => [n.id, n]));
    const links = await loadAllLinksForNodes(nodes);

    let deletedBrokenLinks = 0;
    for (const link of links) {
        if (!nodeIds.has(link.sourceId) || !nodeIds.has(link.targetId)) {
            await MemoryLinkDB.delete(link.id);
            deletedBrokenLinks++;
        }
    }

    let cleanedBoxRefs = 0;
    let fixedNodeBoxRefs = 0;
    for (const box of boxes) {
        let changed = false;
        if (box.summaryNodeId && !nodeIds.has(box.summaryNodeId)) {
            box.summaryNodeId = null;
            cleanedBoxRefs++;
            changed = true;
        }
        const live = (box.liveMemoryIds || []).filter(id => {
            const ok = nodeIds.has(id);
            if (!ok) cleanedBoxRefs++;
            return ok;
        });
        const archived = (box.archivedMemoryIds || []).filter(id => {
            const ok = nodeIds.has(id);
            if (!ok) cleanedBoxRefs++;
            return ok;
        });
        if (live.length !== box.liveMemoryIds.length || archived.length !== box.archivedMemoryIds.length) {
            box.liveMemoryIds = live;
            box.archivedMemoryIds = archived;
            changed = true;
        }

        const refs = [
            ...(box.summaryNodeId ? [{ id: box.summaryNodeId, summary: true, archived: false }] : []),
            ...box.liveMemoryIds.map(id => ({ id, summary: false, archived: false })),
            ...box.archivedMemoryIds.map(id => ({ id, summary: false, archived: true })),
        ];
        for (const ref of refs) {
            const node = nodeById.get(ref.id);
            if (!node) continue;
            let nodeChanged = false;
            if (node.eventBoxId !== box.id) { node.eventBoxId = box.id; nodeChanged = true; }
            if (ref.summary && !node.isBoxSummary) { node.isBoxSummary = true; nodeChanged = true; }
            if (!ref.summary && node.isBoxSummary) { node.isBoxSummary = false; nodeChanged = true; }
            if (ref.archived && !node.archived) { node.archived = true; nodeChanged = true; }
            if (!ref.archived && node.archived && !ref.summary) { node.archived = false; nodeChanged = true; }
            if (nodeChanged) {
                await MemoryNodeDB.save(node);
                fixedNodeBoxRefs++;
            }
        }

        if (changed) {
            box.updatedAt = Date.now();
            await EventBoxDB.save(box);
        }
    }

    let detachedMissingBoxes = 0;
    for (const node of nodes) {
        if (node.eventBoxId && !boxIds.has(node.eventBoxId)) {
            node.eventBoxId = null;
            node.isBoxSummary = false;
            node.archived = false;
            await MemoryNodeDB.save(node);
            detachedMissingBoxes++;
        }
    }

    for (const node of nodes) {
        if (!node.eventBoxId || !boxIds.has(node.eventBoxId)) continue;
        const box = boxes.find(b => b.id === node.eventBoxId);
        if (!box) continue;
        const isSummary = box.summaryNodeId === node.id;
        const isLive = (box.liveMemoryIds || []).includes(node.id);
        const isArchived = (box.archivedMemoryIds || []).includes(node.id);
        if (isSummary || isLive || isArchived) continue;
        node.eventBoxId = null;
        node.isBoxSummary = false;
        node.archived = false;
        await MemoryNodeDB.save(node);
        fixedNodeBoxRefs++;
    }

    return {
        deletedBrokenLinks,
        cleanedBoxRefs,
        fixedNodeBoxRefs,
        detachedMissingBoxes,
    };
}

export async function deleteTaggedLegacyMemories(charId: string): Promise<{ deleted: number }> {
    const nodes = await MemoryNodeDB.getByCharId(charId);
    const targets = nodes.filter(n => n.source?.kind === 'legacy_memory');
    for (const node of targets) {
        await LegacyIndexResidueDB.delete(node.id);
        const links = await MemoryLinkDB.getByNodeId(node.id);
        for (const link of links) await MemoryLinkDB.delete(link.id);
        await MemoryNodeDB.delete(node.id);
    }
    await repairMemoryPalaceIntegrity(charId);
    return { deleted: targets.length };
}

export async function runMemoryPalaceCatchUp(params: {
    char: MemoryPalaceCatchUpTarget;
    llmConfig: LightLLMConfig;
    userName?: string;
    maxRounds?: number;
    onProgress?: (stage: string) => void;
}): Promise<MemoryPalaceCatchUpResult> {
    const { char, llmConfig, userName = '', maxRounds = 50, onProgress } = params;
    let rounds = 0;
    let processedMessages = 0;
    let stored = 0;
    let skipped = 0;
    let stoppedReason: MemoryPalaceCatchUpResult['stoppedReason'] = 'done';
    let updatedMemories = char.memories ? [...char.memories] : [];
    let hideBeforeMessageId = char.hideBeforeMessageId;
    let lastPipelineResult: PipelineResult | null = null;

    try {
        for (let round = 1; round <= maxRounds; round++) {
            rounds = round;
            const stats = await getMemoryPalaceProcessingStats(char.id);
            if (!stats.forceEligible) {
                stoppedReason = stats.totalSemanticMessages <= stats.hotZoneSize ? 'hot_zone' : 'threshold';
                rounds = round - 1;
                break;
            }
            const beforeHwm = getMemoryPalaceHighWaterMark(char.id);
            onProgress?.(`第 ${round} 轮：可整理 ${stats.bufferCount} 条，预计处理 ${stats.processableCount} 条`);
            const result = await processNewMessages([], char.id, char.name, llmConfig, userName, true, onProgress);
            lastPipelineResult = result;
            if (!result) {
                stoppedReason = 'error';
                break;
            }
            if (result.skipReason) {
                stoppedReason = result.skipReason;
                break;
            }
            processedMessages += result.processedMessages || 0;
            stored += result.stored || 0;
            skipped += result.skipped || 0;

            if (result.autoArchive && char.autoArchiveEnabled) {
                updatedMemories = mergePalaceFragmentsIntoMemories(updatedMemories, result.autoArchive.fragments);
                hideBeforeMessageId = result.autoArchive.hideBeforeMessageId;
            }

            const afterHwm = getMemoryPalaceHighWaterMark(char.id);
            if (afterHwm <= beforeHwm) {
                stoppedReason = 'no_progress';
                break;
            }
        }
        if (rounds >= maxRounds && stoppedReason === 'done') stoppedReason = 'max_rounds';

        if (char.autoArchiveEnabled) {
            const hwmFinal = getMemoryPalaceHighWaterMark(char.id);
            if (hwmFinal > (hideBeforeMessageId || 0)) hideBeforeMessageId = hwmFinal;
        }

        const shouldUpdateCharacter = !!char.autoArchiveEnabled && (
            hideBeforeMessageId !== char.hideBeforeMessageId
            || updatedMemories.length !== (char.memories?.length || 0)
        );

        return {
            rounds,
            processedMessages,
            stored,
            skipped,
            stoppedReason,
            updatedMemories,
            hideBeforeMessageId,
            shouldUpdateCharacter,
            lastPipelineResult,
        };
    } catch (e: any) {
        return {
            rounds,
            processedMessages,
            stored,
            skipped,
            stoppedReason: 'error',
            updatedMemories,
            hideBeforeMessageId,
            shouldUpdateCharacter: false,
            lastPipelineResult,
            error: e?.message || String(e),
        };
    }
}
