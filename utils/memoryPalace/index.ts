/**
 * Memory Palace (记忆宫殿) — 统一导出
 */

// 类型
export type {
    MemoryRoom, RoomConfig, MemoryNode, MemoryVector,
    LinkType, MemoryLink, BoxStatus, TopicBox, TopicContinuity,
    AnticipationStatus, Anticipation, MemoryBatch,
    PersonalityStyle, EmbeddingConfig, ScoredMemory, RemoteVectorConfig,
    EventBox, MemoryNodeSource, MemoryNodeSourceKind,
} from './types';

export { ROOM_CONFIGS, ROOM_LABELS, getRoomLabel, PERSONALITY_WEIGHTS, EVENT_BOX_COMPRESSION_THRESHOLD } from './types';

// 数据库
export { MemoryNodeDB, MemoryVectorDB, MemoryLinkDB, MemoryBatchDB, TopicBoxDB, AnticipationDB, EventBoxDB } from './db';

// Embedding
export { getEmbedding, getEmbeddings, cosineSimilarity } from './embedding';

// 输入管线
export { extractMemoriesFromBuffer } from './extraction';
export { vectorizeAndStore, checkModelConsistency, rebuildAllVectors } from './vectorStore';

// 认知过程
export { runConsolidation, calculateEffectiveImportance, shouldPromote } from './consolidation';
export { buildLinks, strengthenCoActivated } from './links';

// 输出管线
export { vectorSearch } from './vectorSearch';
export { bm25Search, tokenize } from './bm25';
export { hybridSearch } from './hybridSearch';
export { spreadActivation } from './activation';
export { applyPriming, checkRumination } from './priming';
export { expandAndFormat } from './formatter';

// 集成
export type { LightLLMConfig, PipelineResult, DiaryIngestResult } from './pipeline';
export type { MemoryPalaceProcessingStats } from './pipeline';
export {
    retrieveMemories, injectMemoryPalace, processNewMessages, getMemoryPalaceHighWaterMark,
    getMemoryPalaceProcessingStats, getMemoryPalaceUnprocessedBufferCount, ingestDiaryToPalace,
    MEMORY_PALACE_HOT_ZONE_SIZE, MEMORY_PALACE_BUFFER_THRESHOLD,
    MEMORY_PALACE_FORCE_MIN_THRESHOLD, MEMORY_PALACE_PROCESS_RATIO,
} from './pipeline';

// 期盼
export {
    processAnticipationLifecycle, fulfillAnticipation,
    disappointAnticipation, createAnticipation,
} from './anticipation';

// 认知消化
export { runCognitiveDigestion, incrementDigestRound, getDigestRoundCount, detectPersonalityStyle } from './digestion';
export type { DigestResult } from './digestion';

// 迁移
export { migrateOldMemories, getAvailableMonths, getAvailableChunks } from './migration';
export type { MigrationProgress } from './migration';

// EventBox（事件盒：替代旧的 boxId 批次盒）
export {
    bindMemoriesIntoEventBox, manuallyBindMemories,
    removeMemoryFromBox, reviveArchivedMemory,
    unbindAllLiveMemories, setEventBoxSealed,
} from './eventBox';
export {
    maybeCompressEventBoxes, compressAllEligibleBoxes,
} from './eventBoxCompression';

// 一键清空（本地 + 云端）
export { wipeAllMemoryPalace } from './wipe';
export type { WipeResult } from './wipe';

// 体检 / 修复 / 维护
export {
    inspectMemoryPalace,
    repairMemoryPalaceIntegrity,
    revectorizeMemoryNodes,
    runMemoryPalaceCatchUp,
    deleteTaggedLegacyMemories,
} from './maintenance';
export type {
    MemoryPalaceInspection,
    MemoryPalaceRepairResult,
    MemoryPalaceRevectorizeResult,
    MemoryPalaceCatchUpResult,
    MemoryPalaceCatchUpTarget,
} from './maintenance';
