/**
 * 回忆标本馆 — 集成管线 (Pipeline)
 *
 * 对外暴露两个主要函数：
 * 1. retrieveMemories() — 检索管线，AI 回复前调用
 * 2. processNewMessages() — 缓冲区机制，AI 回复后后台调用
 *
 * 缓冲区机制（替代旧的 TopicLoom + 封盒方案）：
 * - 热区：最近 200 条消息留在聊天上下文
 * - 缓冲区：热区之前、高水位之后的消息
 * - 缓冲区 >= 50 条时触发：LLM 提取记忆 → 本地保存 → 更新高水位
 * - 保留缓冲区尾部 15% 作为下次提取的上下文衔接
 *
 * LLM 调用策略：
 * - 记忆提取 → 用 LightLLMConfig（来自文具盒全局副 API）
 * - 检索管线 → 纯计算，不调 LLM
 */

import type { Message } from '../../types';
import type { PersonalityStyle, ScoredMemory } from './types';

import { extractMemoriesFromBuffer } from './extraction';
import type { RelatedMemoryRef, PinnedMemoryRef } from './extraction';
import { fetchRelatedMemoriesForExtraction, sampleSnippetsFromMessages, splitMessagesToSpikes } from './relatedMemories';
import { getReceiptIdsInRange } from './recallReceipts';
import { buildLinks, strengthenCoActivated } from './links';
import { hybridSearch } from './hybridSearch';
import { spreadActivation } from './activation';
import { applyPriming, checkRumination } from './priming';
import { applyRecallFatigue } from './recallFatigue';
import { expandAndFormat } from './formatter';
import {
    loadWorkingMemory, saveWorkingMemory, buildWorkingMemory,
    applyContinuityBoost, formatWorkingMemory, formatCognitions,
    getCognitionNodes, applyCognitionBoost,
} from './cognition';
import { runConsolidation } from './consolidation';
import {
    filterCognitiveFlowResults,
    isCognitiveFlowMode,
    isMemoryFeatureEnabled,
    mergeCognitiveFlowSurfaceResults,
} from './cognitiveFlow';
// 认知消化由用户在回忆标本馆 App 手动触发，不在聊天管线中自动运行
import { MemoryNodeDB, AnticipationDB } from './db';
import { DB } from '../db';
import { isMessageSemanticallyRelevant, formatMessageForPrompt } from '../messageFormat';
import { isAuxContextBudgetEnabled, trimTextMiddle } from '../contextBudget';

// ─── 轻量 LLM 配置类型 ───────────────────────────────

/**
 * 轻量 LLM 配置，用于记忆提取等后台任务。
 * 来源是文具盒全局副 API，与日程 API / 心情 API 独立。
 * 这样可以用便宜快速的小模型（如 DeepSeek-V2-Lite、GLM-4-Flash）
 * 而不是主聊天模型。
 */
export interface LightLLMConfig {
    baseUrl: string;
    apiKey: string;
    model: string;
}

const EXTRACTION_CONTEXT_FIELD_LIMITS = {
    systemPrompt: 8_000,
    worldview: 5_000,
    userBio: 4_000,
};

function trimExtractionContextField(text: string | undefined, limit: number): string {
    const raw = (text || '').trim();
    if (!raw) return '无';
    if (!isAuxContextBudgetEnabled()) return raw;
    return trimTextMiddle(raw, limit);
}

function buildExtractionProfileContext(
    charName: string,
    systemPrompt?: string,
    worldview?: string,
    userName?: string,
    userBio?: string,
    sourceNote?: string,
): string {
    let context = `[角色档案]\n`;
    context += `名字: ${charName}\n`;
    context += `核心设定:\n${trimExtractionContextField(systemPrompt, EXTRACTION_CONTEXT_FIELD_LIMITS.systemPrompt)}\n`;
    if (worldview?.trim()) {
        context += `世界观: ${trimExtractionContextField(worldview, EXTRACTION_CONTEXT_FIELD_LIMITS.worldview)}\n`;
    }
    context += `\n[用户档案]\n`;
    context += `名字: ${userName || '用户'}\n`;
    if (userBio !== undefined) {
        context += `设定: ${trimExtractionContextField(userBio, EXTRACTION_CONTEXT_FIELD_LIMITS.userBio)}\n`;
    }
    if (sourceNote) context += `\n[来源说明]\n${sourceNote}\n`;
    context += `\n`;
    return context;
}

function estimateExtractionMessageChars(message: Message, charName: string, userName: string): number {
    return formatMessageForPrompt(message, charName, userName).slice(0, 600).length + 32;
}

function splitMessagesForExtraction(
    messages: Message[],
    charName: string,
    userName: string,
    maxChars: number = 90_000,
    maxMessages: number = 120,
): Message[][] {
    const chunks: Message[][] = [];
    let current: Message[] = [];
    let currentChars = 0;

    for (const msg of messages) {
        const msgChars = estimateExtractionMessageChars(msg, charName, userName);
        const shouldFlush = current.length > 0 && (
            current.length >= maxMessages || currentChars + msgChars > maxChars
        );
        if (shouldFlush) {
            chunks.push(current);
            current = [];
            currentChars = 0;
        }
        current.push(msg);
        currentChars += msgChars;
    }
    if (current.length > 0) chunks.push(current);
    return chunks;
}

// ─── 日期区间记忆加载 ────────────────────────────────

/**
 * 按 createdAt 区间从本地取记忆节点。
 * - 过滤当前 charId
 * - archived 节点也参与匹配（它们保留原事件的 createdAt）；命中后路由到其 EventBox 的 summary
 * - 每个 range 最多返回 5 条，整体去重
 */
async function loadMemoriesByDateRanges(
    charId: string,
    ranges: Array<{ start: number; end: number }>,
): Promise<import('./types').MemoryNode[]> {
    if (ranges.length === 0) return [];
    const all = await MemoryNodeDB.getByCharId(charId);
    const out: import('./types').MemoryNode[] = [];
    const seen = new Set<string>();
    for (const range of ranges) {
        const inRange = all.filter(n => n.createdAt >= range.start && n.createdAt < range.end);
        const sorted = inRange.sort((a, b) => b.importance - a.importance).slice(0, 5);
        for (const n of sorted) {
            // archived 节点 → 路由到其 box 的 summary（如果有）
            if (n.archived && n.eventBoxId) {
                const { EventBoxDB } = await import('./db');
                const box = await EventBoxDB.getById(n.eventBoxId);
                if (box?.summaryNodeId) {
                    if (seen.has(box.summaryNodeId)) continue;
                    const sum = await MemoryNodeDB.getById(box.summaryNodeId);
                    if (sum && !sum.archived) {
                        seen.add(sum.id);
                        out.push(sum);
                        continue;
                    }
                }
                // 没有 summary 就跳过（archived 独行条不该返回）
                continue;
            }
            if (seen.has(n.id)) continue;
            seen.add(n.id);
            out.push(n);
        }
    }
    return out;
}

// ─── 自动归档建议构造 ────────────────────────────────

/**
 * 把一批 MemoryNode 按 createdAt 日期 group，合成 YAML bullets 格式的 MemoryFragment 候选。
 *
 * 格式：
 *   date: "2026-04-17"
 *   summary: "- 我今天看 user 跟朋友吵架，心里担了好一会儿\n- 我今晚和 user 聊到了编程"
 *   mood: 'palace'
 *
 * 同日期多条记忆会合并成一条 MemoryFragment（summary 里多行 bullets）。
 * caller 拿到后还要和 char.memories 里已存在的同日期 'palace' 条目 merge，
 * 避免一天多次 buffer 触发产生重复条目。
 *
 * 返回 null：memories 为空（没有新记忆，不需要归档动作）。
 */
function buildAutoArchiveFragments(
    memories: { id: string; content: string; createdAt: number }[],
    hideBeforeMessageId: number,
): NonNullable<PipelineResult['autoArchive']> | null {
    if (memories.length === 0) return null;

    const fmtDate = (ts: number): string => {
        const d = new Date(ts);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };

    // 按日期 group；同一天内按 createdAt 升序
    // 零 LLM 调用：palace extraction 那 1 次已经按"基础规则 + 用户追加风格"产出了
    // 第一人称、控制字数的 content（见 extraction.ts 的 buildRulesBlock + 追加风格），
    // 这里直接拼 bullets 就行。想要自定义风格 → 在"记忆归档设置"里选模板即可，
    // extraction 阶段就会把用户模板作为额外风格偏好塞进 palace LLM 系统提示词。
    const byDate = new Map<string, string[]>();
    const sortedMems = [...memories].sort((a, b) => a.createdAt - b.createdAt);
    for (const m of sortedMems) {
        const date = fmtDate(m.createdAt);
        const arr = byDate.get(date) || [];
        arr.push(`- ${m.content.replace(/\n/g, ' ').trim()}`);
        byDate.set(date, arr);
    }

    const fragments: { id: string; date: string; summary: string; mood: string }[] = [];
    for (const [date, bullets] of byDate) {
        fragments.push({
            id: `mp_auto_${date}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            date,
            summary: bullets.join('\n'),
            mood: 'palace',
        });
    }

    fragments.sort((a, b) => a.date.localeCompare(b.date));
    return { fragments, hideBeforeMessageId };
}


/**
 * 把新产出的 palace MemoryFragment 合并进已有 char.memories。
 *
 * 策略：
 *  - 已有同日期的 mood='palace' 条目 → 把新的 bullets 追加到它的 summary 里（合并）
 *  - 没有同日期的 mood='palace' → 作为新条目追加
 *  - 其它 mood（手动归档 'archive' 等）的同日期条目不碰，让它们并存
 *
 * 好处：同一天多次 buffer 触发不会产生多条 palace 记录；手动归档和自动归档互不冲突。
 */
export function mergePalaceFragmentsIntoMemories(
    existing: import('../../types').MemoryFragment[],
    incoming: { id: string; date: string; summary: string; mood: string }[],
): import('../../types').MemoryFragment[] {
    if (incoming.length === 0) return existing;

    // 先按 date 建 index：只关心 mood='palace' 的
    const palaceByDate = new Map<string, number>(); // date → index in result
    const result = existing.slice();
    for (let i = 0; i < result.length; i++) {
        const m = result[i];
        if (m.mood === 'palace') palaceByDate.set(m.date, i);
    }

    for (const frag of incoming) {
        const existingIdx = palaceByDate.get(frag.date);
        if (existingIdx !== undefined) {
            // merge：把新 bullets 直接追加到 summary。
            // 不做字符串去重——LLM 偶尔写出相同短句的合法情况会被误杀，
            // high-water-mark 已保证消息不会被重复处理；尾部 15% 回滚那几条
            // 即使被重提，多一条 bullet 比丢数据强。
            const old = result[existingIdx];
            const existingBullets = old.summary.split('\n').map(s => s.trim()).filter(Boolean);
            const newBullets = frag.summary.split('\n').map(s => s.trim()).filter(Boolean);
            result[existingIdx] = {
                ...old,
                summary: [...existingBullets, ...newBullets].join('\n'),
            };
        } else {
            result.push(frag);
            palaceByDate.set(frag.date, result.length - 1);
        }
    }

    return result;
}

// ─── 检索管线（AI 回复前） ────────────────────────────

/**
 * 从消息列表末尾拆分"当前一轮"的两个语义部分：
 *
 * 调用时机是 AI 回复前，所以消息末尾通常是：
 *   ... [user] [user] [assistant] [user] [user] [user]
 *                                     └─── userIntent ───┘
 *                   └──────── contextTurns ────────┘
 *
 * - userIntent：末尾连续 user 消息 —— 用户刚说的话，是本次检索的真正主语。
 *   作为**主 query**，短而关键的词（"外公"、"2025年11月29日"）不会被
 *   char 的长回复稀释。
 *
 * - contextTurns：更早的 assistant 回复 + 上一轮 user 消息 —— 话题延续语境。
 *   作为**副 query**，提供背景召回，但分数会被折扣，永远不会压过 userIntent。
 *
 * 总计 cap 在 15 条，user 最多占 10 条留出 context 预算。
 */
function splitLastTurnQueries(messages: Message[]): {
    userIntent: Message[];
    contextTurns: Message[];
    /** 旧版拼接形式，仅用于兜底（userIntent 为空时） */
    fallbackAll: Message[];
} {
    if (messages.length === 0) return { userIntent: [], contextTurns: [], fallbackAll: [] };

    const MAX = 15;
    const USER_CAP = 10;
    const userIntent: Message[] = [];
    const contextTurns: Message[] = [];
    let i = messages.length - 1;

    // Phase 1: 末尾连续 user 消息（用户刚发的）→ userIntent
    while (i >= 0 && messages[i].role === 'user' && userIntent.length < USER_CAP) {
        userIntent.unshift(messages[i]);
        i--;
    }

    const contextBudget = MAX - userIntent.length;

    // Phase 2: 紧邻的 assistant 回复（上一轮角色回答）→ contextTurns
    while (i >= 0 && messages[i].role === 'assistant' && contextTurns.length < contextBudget) {
        contextTurns.unshift(messages[i]);
        i--;
    }

    // Phase 3: 再往回收集连续 user 消息（上一轮用户输入）→ contextTurns
    while (i >= 0 && messages[i].role === 'user' && contextTurns.length < contextBudget) {
        contextTurns.unshift(messages[i]);
        i--;
    }

    const fallbackAll = [...contextTurns, ...userIntent];
    return {
        userIntent,
        contextTurns,
        fallbackAll: fallbackAll.length > 0 ? fallbackAll : messages.slice(-3),
    };
}

/**
 * 检索记忆并格式化为可注入 System Prompt 的 Markdown
 *
 * 注意：检索管线全程本地计算，不调 LLM，不调额外检索服务。
 *
 * @param queryOverride App 自定义上下文（场景、题目等），会与最近一轮对话拼接后一起检索
 */
export async function retrieveMemories(
    recentMessages: Message[],
    charId: string,
    currentMood?: string,
    personalityStyle: PersonalityStyle = 'emotional',
    ruminationTendency: number = 0.3,
    queryOverride?: string,
    userName?: string,
    cognitiveFlow = true,
): Promise<string> {
    // ── 分段计时：定位 memoryPalace 到底是网络慢还是计算慢 ──
    // tag: NET = 远端 API RTT；IDB = IndexedDB 读写；CPU = 纯本地计算
    const perfRetrieveT0 = performance.now();
    const retrieveTimings: Array<{ label: string; ms: number; kind: 'NET' | 'IDB' | 'CPU' }> = [];
    const tRetrieve = async <T>(label: string, kind: 'NET' | 'IDB' | 'CPU', p: Promise<T>): Promise<T> => {
        const t0 = performance.now();
        try { return await p; }
        finally { retrieveTimings.push({ label, kind, ms: Math.round(performance.now() - t0) }); }
    };
    try {
        // 1. 构建查询 —— per-message 多路检索策略：
        //
        //    问题：任何形式的"把多条 user 消息 join 成一段 query"都会出现
        //          稀释问题。无论真正的意图在 burst 的开头、中间还是结尾，
        //          短而精的信号都会被周围的闲语/寒暄/语气词淹没。
        //
        //    方案：每条有意义的 user 消息（≥ 4 字，去重）独立跑一次 hybridSearch。
        //          合并时同一条记忆取所有 per-msg 搜索中的最高分，这样：
        //          - "今天我要回家看家人啦" 作为独立 query 时更容易直接命中家庭类记忆
        //          - "晚上好" / "你在做什么" 这些独立 query 只会命中寒暄类
        //            记忆（分数低），不会干扰真正意图的召回
        //
        //    context query：assistant 回复 + 更早 user 消息 + queryOverride。
        //                  （背景话题延续，分数 × 0.5 折扣，不会压过 user 意图）
        const { userIntent, contextTurns, fallbackAll } = splitLastTurnQueries(recentMessages);

        // 抽取每条有意义的 user 消息作为独立 spike + 二次拆分子 spike
        //
        // 过滤原则：
        // 1. 剥离 URL（表情包/图片/外链 URL 对文本检索没有帮助）
        // 2. 剥离 URL 后，再剥掉所有标点和空白来计算"有意义字符数"
        // 3. 有意义字符数 < MIN_SPIKE_LEN 的 pass（纯标点/单字语气词/"……"等）
        // 4. 同内容去重
        //
        // MIN_SPIKE_LEN=2 而不是 4：中文里 2 字已经可以成词（"晚安""回家""想你"
        // "外公""生气"），如果阈值设 4 会误伤大量短而关键的中文测试性输入。
        // 被过滤的只有 1 字的"嗯""好""?""哦""哈"类纯语气词，以及"……""。。。"
        // 这类纯标点输入——BM25 匹配不上任何东西。
        //
        // 注意：query 文本仍然用"剥 URL 后"的原始 trim 版本（保留标点），
        // 只在判长度时才看"剥光标点的有意义字符数"。这样"晚安……"这种
        // 带尾随省略号的合法输入能进池，且 query 里完整保留上下文。
        //
        // 二次拆分（sub-spike）：
        //   一条消息内部如果有标点/空格分隔多段语义（DateApp 见面模式的
        //   叙述格式 `"对白" 旁白 "对白"`、或者用户在一条消息里用逗号/
        //   句号串了多件事），单一 spike 会让真实意图被气泡内的其他片段
        //   稀释。把消息按 [\s\p{P}]+ 拆成子片段，每个 ≥ MIN_SPIKE_LEN 的
        //   子片段也作为独立 spike 入池（label 后缀 a/b/c/...）。原消息
        //   仍保留作 u<N>，捕获跨片段的整体语境。
        //
        //   这不是"扩搜索面"——子 spike 比原 spike 更短更专注，每路 query
        //   质心更精准（不是更宽），所以不会出现 joined / 候选池扩大那种
        //   "泛情感记忆借宽匹配反超"的问题。机制方向相反。
        const MIN_SPIKE_LEN = 2;
        const MAX_SPIKES = 10;
        const MAX_SUB_SPIKES_PER_MSG = 5;
        const URL_RE = /https?:\/\/\S+/gi;
        const PUNCT_WS_RE = /[\s\p{P}]/gu;
        const SPLIT_RE = /[\s\p{P}]+/gu;
        const seenSpike = new Set<string>();
        const userSpikes: { label: string; text: string; originalIdx: number }[] = [];
        userIntent.forEach((m, idx) => {
            const stripped = m.content.replace(URL_RE, ' ').trim();
            const text = stripped.slice(0, 2000);
            const meaningfulChars = text.replace(PUNCT_WS_RE, '');
            if (meaningfulChars.length < MIN_SPIKE_LEN) return;
            if (seenSpike.has(text)) return;
            seenSpike.add(text);
            const baseLabel = `u${idx + 1}`;
            userSpikes.push({ label: baseLabel, text, originalIdx: idx });

            // 二次拆分：消息内部有多段语义时，每段也作为子 spike
            const segments = text.split(SPLIT_RE)
                .map(s => s.trim())
                .filter(s => s.length > 0 && s !== text && s.replace(PUNCT_WS_RE, '').length >= MIN_SPIKE_LEN);
            let subIdx = 0;
            for (const seg of segments) {
                if (subIdx >= MAX_SUB_SPIKES_PER_MSG) break;
                if (seenSpike.has(seg)) continue;
                seenSpike.add(seg);
                subIdx++;
                const subLabel = `${baseLabel}${String.fromCharCode(96 + subIdx)}`; // a,b,c,...
                userSpikes.push({ label: subLabel, text: seg, originalIdx: idx });
            }
        });
        // 保留最后 MAX_SPIKES 条（如果超过上限，优先保留最近的）
        const effectiveSpikes = userSpikes.slice(-MAX_SPIKES);

        const contextQuery = [queryOverride, contextTurns.map(m => m.content).join('\n')]
            .filter(Boolean)
            .join('\n')
            .slice(0, 2000);
        const userQueryJoined = userIntent.map(m => m.content).join('\n'); // 仅用于日志显示原始 userIntent 文本

        // 兜底：极端情况下末尾没有任何可用的 user spike（如冷启动首轮，或全是语气词）
        const fallbackQuery = effectiveSpikes.length > 0
            ? ''
            : [queryOverride, fallbackAll.map(m => m.content).join('\n')]
                  .filter(Boolean)
                  .join('\n')
                  .slice(0, 2000);

        if (effectiveSpikes.length === 0 && !contextQuery.trim() && !fallbackQuery.trim()) return '';

        // ─── 调试日志：打印所有 query ─────────────────────────
        console.groupCollapsed(`🏰 [Retrieve] ═══ 检索开始 ═══`);
        console.log(`👤 userIntent: ${userIntent.length} 条消息，其中 ${effectiveSpikes.length} 条进入 per-msg 搜索`);
        if (userQueryJoined && effectiveSpikes.length < userIntent.length) {
            console.log(`   (被过滤的 ${userIntent.length - effectiveSpikes.length} 条：长度 < ${MIN_SPIKE_LEN} 字或重复内容)`);
        }
        effectiveSpikes.forEach(s => {
            console.log(`  🎯 ${s.label} (${s.text.length} 字): ${s.text.replace(/\n/g, ' ↵ ')}`);
        });
        console.log(`📄 context query (${contextQuery.length} 字，${contextTurns.length} 条 context 消息):`);
        console.log(contextQuery || '(空)');
        if (fallbackQuery) {
            console.log(`⚠️  fallback query (${fallbackQuery.length} 字):`);
            console.log(fallbackQuery);
        }
        console.groupEnd();

        // 2. 混合搜索（并行）
        //    - 每条 user spike：原样打分（权重 1.0）
        //    - context：分数 × CONTEXT_DISCOUNT 折扣
        //    合并时同一条记忆取 max(所有 spike 分, context 分×折扣)
        //
        //    per-query 返回 30 条，最终合并后裁到 15 条。
        //    原因：如果每路只返回 top 15，同一类主题（如"外公"）的多条
        //    记忆中，排名较低的几条会在 per-query 阶段就被切掉，永远
        //    进不到合并池。扩大 per-query 容量让"同主题的次要记忆"
        //    也有机会竞争最终名次。
        const CONTEXT_DISCOUNT = 0.5;
        const PER_QUERY_TOP_K = 30;
        const FINAL_TOP_K = 15;

        // 辅助：把 ScoredMemory 格式化成一行摘要
        const now = Date.now();
        const fmt = (r: ScoredMemory, prefix: string = '') => {
            const ageDays = Math.floor((now - r.node.createdAt) / (1000 * 60 * 60 * 24));
            const preview = r.node.content.slice(0, 50).replace(/\n/g, ' ');
            return `${prefix}[${r.node.room}|imp=${r.node.importance}|${ageDays}d前] `
                + `sim=${r.similarity.toFixed(3)} bm25=${r.bm25Score.toFixed(3)} `
                + `→ final=${r.finalScore.toFixed(3)}  "${preview}${r.node.content.length > 50 ? '...' : ''}"`;
        };

        let results: ScoredMemory[] = [];
        // 记录每条记忆被哪些 spike / context 命中以及各自分数
        type TraceEntry = {
            spikeScores: Map<string, number>; // label → finalScore
            contextScore?: number; // 原始分（未折扣）
        };
        const sourceTrace = new Map<string, TraceEntry>();

        if (effectiveSpikes.length > 0) {
            // 并行：每条 spike + context
            //
            // 历史教训：曾经加过 joined query 路径（所有 spike 拼成一条长 query
            // 并行检索）期望"BM25 跨气泡叠加"能提升主题收敛场景的召回。但
            // 实测反而变差——长 query 的 BM25 会被**泛情感高 imp 记忆**的
            // 随机 token 碰撞累积到虚高分，挤掉 per-message 本来精准的焦点
            // 命中。这和之前候选池 30→60 被回滚是同一类错误：任何"扩大
            // 搜索面"的机制都让泛情感记忆凭 imp/recency 反超 topic-specific
            // 记忆。回滚。

            // ─── Prefetch：把 K 路文本搜索共用的 MemoryNode 快照抽上来一次性做完 ───
            const contextQueryTrimmed = contextQuery.trim();
            const allNodes = await tRetrieve('MemoryNodeDB.getByCharId', 'IDB', MemoryNodeDB.getByCharId(charId));

            const spikePromises = effectiveSpikes.map((s) =>
                hybridSearch(s.text, charId, PER_QUERY_TOP_K, {
                    allNodes,
                })
            );
            const contextPromise = contextQueryTrimmed
                ? hybridSearch(contextQuery, charId, PER_QUERY_TOP_K, {
                    allNodes,
                })
                : Promise.resolve([] as ScoredMemory[]);

            const [contextResults, ...spikeResultsArr] = await tRetrieve(
                `hybridSearch×${spikePromises.length + (contextQueryTrimmed ? 1 : 0)}`,
                'CPU',
                Promise.all([contextPromise, ...spikePromises]),
            );

            // ─── 调试日志：每条 spike 的完整结果 ─────────────────
            spikeResultsArr.forEach((spikeResults, idx) => {
                const s = effectiveSpikes[idx];
                console.groupCollapsed(`🏰 [Retrieve] 🎯 ${s.label} 搜命中 ${spikeResults.length} 条 ("${s.text.slice(0, 30).replace(/\n/g, ' ')}${s.text.length > 30 ? '...' : ''}")`);
                spikeResults.forEach((r, i) => console.log(fmt(r, `#${i + 1} `)));
                console.groupEnd();
            });

            if (contextResults.length > 0) {
                console.groupCollapsed(`🏰 [Retrieve] 📄 context 搜命中 ${contextResults.length} 条（下方为折扣前原始分）`);
                contextResults.forEach((r, i) => {
                    console.log(fmt(r, `#${i + 1} `) + `  → 折扣后=${(r.finalScore * CONTEXT_DISCOUNT).toFixed(3)}`);
                });
                console.groupEnd();
            } else {
                console.log(`🏰 [Retrieve] context 搜跳过（context query 为空）`);
            }

            // 合并：每条记忆取 max(所有 spike 分, context 分×折扣)
            const merged = new Map<string, ScoredMemory>();
            spikeResultsArr.forEach((spikeResults, idx) => {
                const label = effectiveSpikes[idx].label;
                for (const r of spikeResults) {
                    const trace = sourceTrace.get(r.node.id) ?? { spikeScores: new Map<string, number>() } as TraceEntry;
                    trace.spikeScores.set(label, r.finalScore);
                    sourceTrace.set(r.node.id, trace);
                    const existing = merged.get(r.node.id);
                    if (!existing || r.finalScore > existing.finalScore) {
                        merged.set(r.node.id, r);
                    }
                }
            });
            for (const r of contextResults) {
                const trace = sourceTrace.get(r.node.id) ?? { spikeScores: new Map<string, number>() } as TraceEntry;
                trace.contextScore = r.finalScore;
                sourceTrace.set(r.node.id, trace);
                const discounted: ScoredMemory = {
                    ...r,
                    finalScore: r.finalScore * CONTEXT_DISCOUNT,
                    roomScore: r.roomScore * CONTEXT_DISCOUNT,
                };
                const existing = merged.get(r.node.id);
                if (!existing || discounted.finalScore > existing.finalScore) {
                    merged.set(r.node.id, discounted);
                }
            }

            results = [...merged.values()]
                .sort((a, b) => b.finalScore - a.finalScore)
                .slice(0, FINAL_TOP_K);

            // ─── 调试日志：合并后最终 top K ───────────────────
            console.groupCollapsed(`🏰 [Retrieve] 合并后 top ${results.length}（扩散激活/启动效应前）`);
            results.forEach((r, i) => {
                const t = sourceTrace.get(r.node.id) ?? { spikeScores: new Map<string, number>() } as TraceEntry;
                const spikeLabels = [...t.spikeScores.keys()];
                const srcTags = spikeLabels.map(l => `🎯${l}`);
                if (t.contextScore !== undefined) srcTags.push('📄');
                const tag = srcTags.join('+');
                const details: string[] = [];
                for (const [label, score] of t.spikeScores) {
                    details.push(`${label}=${score.toFixed(3)}`);
                }
                if (t.contextScore !== undefined) {
                    details.push(`ctx=${t.contextScore.toFixed(3)}×0.5=${(t.contextScore * CONTEXT_DISCOUNT).toFixed(3)}`);
                }
                console.log(fmt(r, `#${i + 1} [${tag}] `) + ` (${details.join(', ')})`);
            });
            console.groupEnd();

            console.log(`🏰 [Retrieve] 多路检索汇总：${effectiveSpikes.length} 个 spike + ${contextResults.length > 0 ? 'context' : '无 context'} → 合并 top ${results.length}`);
        } else {
            // 冷启动兜底：仅用 fallback 单 query
            results = await tRetrieve(
                'hybridSearch(fallback)',
                'CPU',
                hybridSearch(fallbackQuery, charId, FINAL_TOP_K),
            );
            console.groupCollapsed(`🏰 [Retrieve] 单 query 兜底命中 ${results.length} 条（无末尾 user 消息）`);
            results.forEach((r, i) => console.log(fmt(r, `#${i + 1} `)));
            console.groupEnd();
        }

        // 2.5 日期引用路径：从 user 意图里抽"去年12月""3月4号""上周"这类
        //     日期引用，直接按 createdAt 捞对应区间的记忆（BM25 对日期表达容易对不准）。
        //     archived 节点参与日期匹配 → 路由到其 EventBox summary 返回。
        const dateT0 = performance.now();
        try {
            const { resolveDateReferences } = await import('./dateResolver');
            const queryForDates = [userQueryJoined, contextQuery, fallbackQuery].filter(Boolean).join('\n');
            const ranges = resolveDateReferences(queryForDates);
            if (ranges.length > 0) {
                console.log(`📅 [Retrieve] 检测到日期引用 ${ranges.length} 个：${ranges.map(r => `${r.label}→[${new Date(r.start).toLocaleDateString('zh-CN')}..${new Date(r.end - 1).toLocaleDateString('zh-CN')}]`).join('、')}`);
                const dateHits = await loadMemoriesByDateRanges(charId, ranges);
                const DATE_BOOST = 0.3;
                const DATE_BASE = 0.5;
                const resultIdx = new Map(results.map((r, i) => [r.node.id, i]));
                let boosted = 0, added = 0;
                for (const node of dateHits) {
                    const idx = resultIdx.get(node.id);
                    if (idx !== undefined) {
                        results[idx].finalScore += DATE_BOOST;
                        results[idx].roomScore += DATE_BOOST;
                        boosted++;
                    } else {
                        results.push({
                            node,
                            finalScore: DATE_BASE + DATE_BOOST,
                            similarity: 0,
                            bm25Score: 0,
                            roomScore: DATE_BASE + DATE_BOOST,
                        });
                        added++;
                    }
                }
                if (boosted + added > 0) {
                    console.log(`📅 [Retrieve] 日期命中加权：${boosted} 条已命中 +${DATE_BOOST}，${added} 条新增`);
                }
            }
        } catch (e: any) {
            console.warn(`📅 [Retrieve] 日期解析失败（不影响常规召回）: ${e?.message || e}`);
        }
        retrieveTimings.push({ label: 'dateResolver', kind: 'IDB', ms: Math.round(performance.now() - dateT0) });

        if (cognitiveFlow) {
            const beforeCognitive = results.length;
            const cognitiveQuery = [userQueryJoined, contextQuery, fallbackQuery, queryOverride]
                .filter(Boolean)
                .join('\n');
            results = filterCognitiveFlowResults(results);
            results = await tRetrieve(
                'cognitiveFlowSurface',
                'IDB',
                mergeCognitiveFlowSurfaceResults(results, charId, cognitiveQuery),
            );
            if (results.length !== beforeCognitive) {
                console.log(`🏰 [Retrieve] Cognitive Flow surface: ${beforeCognitive} -> ${results.length}`);
            }
        }

        if (results.length === 0) {
            console.log(`🏰 [Retrieve] 混合搜索 + 日期路径均无结果，跳过记忆注入`);
            return '';
        }

        // 3. 扩散激活
        const beforeActivation = results.length;
        results = await tRetrieve('spreadActivation', 'IDB', spreadActivation(results, charId, personalityStyle));
        if (results.length !== beforeActivation) {
            console.log(`🏰 [Retrieve] 扩散激活后：${beforeActivation} → ${results.length} 条`);
        }

        // 4. 启动效应
        if (currentMood) {
            results = applyPriming(results, currentMood);
            console.log(`🏰 [Retrieve] 启动效应（mood=${currentMood}）已应用`);
        }

        // 4.5 连续性加权：用上一轮工作记忆快照，给同语义的记忆小幅上浮，联想不断线
        const prevWorkingMemory = loadWorkingMemory(charId);
        applyContinuityBoost(results, prevWorkingMemory);

        // 4.6 认知引导召回：让稳定认知影响"想起什么"——与认知同语义的记忆召回分上浮
        const cognitionNodes = await tRetrieve('getCognitionNodes', 'IDB', getCognitionNodes(charId));
        applyCognitionBoost(results, cognitionNodes);

        // 4.7 召回疲劳（习惯化）：连续多轮被注入的同一条记忆逐步降权，
        //     抵消上面连续性/启动/认知引导带来的正反馈，避免角色「揪着一件小事反复提」。
        //     放在所有加权之后、最终排序之前——它要对照的是「加权后的真实霸榜情况」。
        const fatigued = applyRecallFatigue(results, charId);
        if (fatigued > 0) {
            console.log(`🏰 [Retrieve] 召回疲劳：${fatigued} 条近期反复出现的记忆已降权（习惯化，防复读）`);
        }

        // 重新排序
        results.sort((a, b) => b.finalScore - a.finalScore);

        // ─── 调试日志：扩散+启动后的候选排序
        //    注意：这里是 pipeline 层的 ${results.length} 条候选，但 formatter
        //    (MAX_OUTPUT_MEMORIES=15) 会在格式化时再砍一刀，只有前 15 条真正
        //    写进 system prompt。多出来的会被标 "✂️ cut"。
        const FORMATTER_CUT = 15;
        console.groupCollapsed(
            `🏰 [Retrieve] 扩散+启动后 ${results.length} 条候选（formatter 只注入前 ${Math.min(FORMATTER_CUT, results.length)} 条）`
        );
        results.forEach((r, i) => {
            const marker = i < FORMATTER_CUT ? '✅ 注入' : '✂️ cut';
            console.log(fmt(r, `#${i + 1} [${marker}] `));
        });
        console.groupEnd();

        // 5. 反刍
        const ruminatedNode = await tRetrieve('checkRumination', 'IDB', checkRumination(charId, ruminationTendency));
        if (ruminatedNode) {
            const avgScore = results.length > 0
                ? results.reduce((s, r) => s + r.finalScore, 0) / results.length
                : 0.5;
            results.push({
                node: ruminatedNode,
                finalScore: avgScore * 0.8,
                similarity: 0,
                bm25Score: 0,
                roomScore: avgScore * 0.8,
            });
        }

        // 6+7. 更新访问记录 + 共同激活加强（并发写 IDB）
        if (cognitiveFlow) {
            const beforeFinalFilter = results.length;
            results = filterCognitiveFlowResults(results);
            if (results.length !== beforeFinalFilter) {
                console.log(`🏰 [Retrieve] Cognitive Flow final filter: ${beforeFinalFilter} -> ${results.length}`);
            }
            if (results.length === 0) return '';
        }

        const writeT0 = performance.now();
        const retrievedIds = results.map(r => r.node.id);
        await Promise.all([
            ...retrievedIds.map(id => MemoryNodeDB.touchAccess(id)),
            retrievedIds.length >= 2 ? strengthenCoActivated(retrievedIds.slice(0, 5)) : Promise.resolve(),
        ]);
        retrieveTimings.push({ label: `idbWrites(${retrievedIds.length})`, kind: 'IDB', ms: Math.round(performance.now() - writeT0) });

        // 8. 获取期盼
        const anticipations = await tRetrieve('AnticipationDB.getByCharId', 'IDB', AnticipationDB.getByCharId(charId));

        // 9. 格式化
        const formatted = await tRetrieve('expandAndFormat', 'IDB', expandAndFormat(results, charId, anticipations, userName));

        // 10.5 认知网络注入：长期认知（置顶，不占常规名额）+ 本轮工作记忆快照
        //   - 认知块放最顶：让角色「越聊越懂 TA」的稳定理解持续生效；
        //   - 工作记忆「此刻的思绪」放认知之后、回忆标本馆正文之前，串住联想线。
        // 认知参与召回：用本轮混合检索里认知节点拿到的分数排序置顶，最相关的认知优先注入
        const cogRelevance = new Map<string, number>();
        for (const r of results) if (r.node.origin === 'cognition') cogRelevance.set(r.node.id, r.finalScore);
        const cognitionBlock = await tRetrieve('formatCognitions', 'IDB', formatCognitions(charId, userName, cogRelevance));
        const newSnapshot = buildWorkingMemory(charId, results, currentMood);
        if (newSnapshot) saveWorkingMemory(newSnapshot);
        const workingBlock = formatWorkingMemory(newSnapshot);
        const combined = [cognitionBlock, workingBlock, formatted].filter(Boolean).join('\n\n');

        // ── 汇总打印 ──
        const perfTotal = Math.round(performance.now() - perfRetrieveT0);
        const byKind: Record<'NET' | 'IDB' | 'CPU', number> = { NET: 0, IDB: 0, CPU: 0 };
        retrieveTimings.forEach(t => { byKind[t.kind] += t.ms; });
        const detail = retrieveTimings
            .sort((a, b) => b.ms - a.ms)
            .map(t => `${t.label}[${t.kind}]=${t.ms}ms`)
            .join(' ');
        console.log(`⏱ [retrieveMemories] total=${perfTotal}ms | NET=${byKind.NET}ms IDB=${byKind.IDB}ms CPU=${byKind.CPU}ms | ${detail}`);

        return combined;

    } catch (err: any) {
        console.error(`❌ [Retrieve] 检索记忆失败:`, err.message);
        return '';
    }
}

/**
 * 便捷函数：检索记忆并挂到 char.memoryPalaceInjection 上。
 *
 * 各 App 在构建 System Prompt 前调用一次即可，
 * 之后 buildCoreContext 会自动读取并注入。
 *
 * @param recentMessages 可选，不传则自动从 DB 加载
 * @param queryHint 可选，App 自定义检索词（如场景描述、游戏叙事）。
 *                  传了就直接用这个检索，不走 getLastTurnMessages。
 */
export async function injectMemoryPalace(
    char: { memoryMode?: any; memoryPalaceEnabled?: boolean; activeBuffs?: any[]; personalityStyle?: string; ruminationTendency?: number; id: string; memoryPalaceInjection?: string },
    recentMessages?: Message[],
    queryHint?: string,
    userName?: string,
): Promise<void> {
    if (!isMemoryFeatureEnabled(char)) return;
    try {
        const msgs = recentMessages ?? await DB.getMessagesByCharId(char.id);
        const currentMood = char.activeBuffs?.[0]?.name;
        const context = await retrieveMemories(
            msgs, char.id,
            currentMood,
            (char.personalityStyle as PersonalityStyle) || 'emotional',
            char.ruminationTendency ?? 0.3,
            queryHint,
            userName,
            isCognitiveFlowMode(char),
        );
        if (context) {
            char.memoryPalaceInjection = context;
        }
    } catch (e: any) {
        console.warn(`🏰 [MemoryPalace] injectMemoryPalace failed: ${e.message}`);
    }
}

// ─── 外部摘要 / 日记一次性吞吐 ────────────────────────

/**
 * 把"交换日记"一次性塞进回忆标本馆。
 * 跟 processNewMessages 用的同一套抽取逻辑（lightLLM 副 API、extractMemoriesFromBuffer），
 * 但不走缓冲区/高水位机制 —— 因为日记不是普通聊天消息，
 * 是一篇独立的、用户主动触发的归档。
 *
 * 关键差异（对比 chat 自动归档）：
 *  - 时间戳来自 diary.date，不是 Date.now() —— 这样记忆按 createdAt 排序时
 *    日记会落在它真正发生的那天而不是归档的那天
 *  - 不动 mp_lastMsgId_ 高水位 —— 防止把后续聊天处理跳过
 *  - 不写 EventBox 跨时间链接（日记是孤立事件，绑链接需要再过一遍消息流，价值不大）
 *
 * @param char 至少要 id / name / memoryPalaceEnabled
 * @param dateStr 日记日期 YYYY-MM-DD，决定 MemoryNode.createdAt
 * @param userDiaryText 用户那页的正文
 * @param charDiaryText 角色那页的正文（可空）
 * @param lightLLMConfig 回忆标本馆副 API
 * @param userName 用户昵称
 */
/** 一次日记归档对标本馆的具体影响, 用 status 区分各种"为什么没入馆"的情况, 供 UI 弹窗直接展示 */
export type DiaryIngestResult =
    | { status: 'palace_disabled' }
    | { status: 'lightllm_missing' }
    | { status: 'empty_input' }
    | { status: 'extracted_none'; stored: 0; skipped: 0 }
    | {
        status: 'done';
        stored: number;
        skipped: number;
        nodes: { content: string; room: import('./types').MemoryRoom; importance: number; mood: string; tags: string[] }[];
    };

export async function ingestDiaryToPalace(
    char: { id: string; name: string; memoryMode?: any; memoryPalaceEnabled?: boolean; systemPrompt?: string; worldview?: string },
    dateStr: string,
    userDiaryText: string,
    charDiaryText: string,
    lightLLMConfig: LightLLMConfig | null | undefined,
    userName: string,
): Promise<DiaryIngestResult> {
    if (!isMemoryFeatureEnabled(char)) return { status: 'palace_disabled' };
    if (!lightLLMConfig?.baseUrl || !lightLLMConfig?.apiKey) {
        console.warn(`🏰 [DiaryIngest] 跳过：lightLLM 未配置`);
        return { status: 'lightllm_missing' };
    }

    // 构造时间戳：YYYY-MM-DD → 当地中午 12:00（避免时区把日期撇到前一天）
    let createdAt = Date.now();
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
    if (m) {
        const d = new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]), 12, 0, 0);
        if (!isNaN(d.getTime())) createdAt = d.getTime();
    }

    // 把日记伪装成两条 Message 喂给 extractMemoriesFromBuffer（id 给负数，不入库不冲突）
    const fakeMessages: Message[] = [];
    if (userDiaryText?.trim()) {
        fakeMessages.push({
            id: -Math.floor(Math.random() * 1e9),
            charId: char.id,
            role: 'user',
            type: 'text',
            content: `【交换日记 ${dateStr}】我今天写道：\n${userDiaryText.trim()}`,
            timestamp: createdAt,
        } as Message);
    }
    if (charDiaryText?.trim()) {
        fakeMessages.push({
            id: -Math.floor(Math.random() * 1e9),
            charId: char.id,
            role: 'assistant',
            type: 'text',
            content: `【交换日记 ${dateStr}】我（${char.name}）的回复日记：\n${charDiaryText.trim()}`,
            timestamp: createdAt + 1000,
        } as Message);
    }
    if (fakeMessages.length === 0) return { status: 'empty_input' };

    // 角色 / 用户档案给 LLM 当上下文；只保留提取所需的摘要级信息，避免超长人设撞模型窗口。
    const charContext = buildExtractionProfileContext(
        char.name,
        char.systemPrompt,
        char.worldview,
        userName || '用户',
        undefined,
        '这是来自【交换日记】app 的一次归档，不是普通聊天，是一篇双方各写一页的正式日记。',
    );

    const extracted = await extractMemoriesFromBuffer(
        fakeMessages,
        char.id,
        char.name,
        lightLLMConfig,
        charContext,
        userName || '用户',
        [], // 不喂相关记忆，避免一次归档把 LLM 拉去做跨时间纠正
        [], // 不喂便利贴
    );

    if (extracted.memories.length === 0) {
        console.log(`🏰 [DiaryIngest] LLM 未提取出记忆节点`);
        return { status: 'extracted_none', stored: 0, skipped: 0 };
    }

    // 把 createdAt 改成日记日期，origin 标 system（用户主动触发的归档）
    for (const node of extracted.memories) {
        node.createdAt = createdAt;
        node.lastAccessedAt = createdAt;
        node.origin = 'system';
        node.cognitiveLayer = 'event';
        node.eventTime = createdAt;
        node.source = { kind: 'diary', label: `交换日记 ${dateStr}`, refId: dateStr };
    }

    await MemoryNodeDB.saveMany(extracted.memories);
    console.log(`🏰 [DiaryIngest] 日记 ${dateStr} 入宫：提取并保存 ${extracted.memories.length} 条`);
    return {
        status: 'done',
        stored: extracted.memories.length,
        skipped: 0,
        nodes: extracted.memories.map(n => ({
            content: n.content,
            room: n.room,
            importance: n.importance,
            mood: n.mood,
            tags: n.tags,
        })),
    };
}

// ─── 输入管线（AI 回复后，后台） ──────────────────────

// ─── 高水位标记：记录每个角色处理到的最后消息 ID ────────

const LAST_MSG_KEY = (charId: string) => `mp_lastMsgId_${charId}`;

function getLastProcessedId(charId: string): number {
    try {
        const val = parseInt(localStorage.getItem(LAST_MSG_KEY(charId)) || '0', 10);
        return isNaN(val) || val < 0 ? 0 : val;
    } catch { return 0; }
}

function setLastProcessedId(charId: string, msgId: number): void {
    try { localStorage.setItem(LAST_MSG_KEY(charId), String(msgId)); } catch {}
}

/** 获取当前高水位标记（供外部上下文过滤使用） */
export function getMemoryPalaceHighWaterMark(charId: string): number {
    return getLastProcessedId(charId);
}

// ─── 缓冲区配置 ─────────────────────────────────────

/** 热区大小：最近 N 条消息始终留在聊天上下文，不处理 */
export const MEMORY_PALACE_HOT_ZONE_SIZE = 200;
/** 缓冲区阈值：累积超过 N 条消息后触发处理 */
export const MEMORY_PALACE_BUFFER_THRESHOLD = 100;
/** 处理比例：取缓冲区前 85%，保留尾部 15% 作为下次总结的上下文 */
export const MEMORY_PALACE_PROCESS_RATIO = 0.85;
/** 手动整理最低阈值：保留热区机制，但允许用户显式追平较小缓冲区 */
export const MEMORY_PALACE_FORCE_MIN_THRESHOLD = 10;
const HOT_ZONE_SIZE = MEMORY_PALACE_HOT_ZONE_SIZE;
const BUFFER_THRESHOLD = MEMORY_PALACE_BUFFER_THRESHOLD;
const PROCESS_RATIO = MEMORY_PALACE_PROCESS_RATIO;

export interface MemoryPalaceProcessingStats {
    totalSemanticMessages: number;
    highWaterMark: number;
    hotZoneSize: number;
    hotZoneProtectedCount: number;
    hotZoneStartId: number | null;
    bufferCount: number;
    processableCount: number;
    autoThreshold: number;
    forceThreshold: number;
    autoEligible: boolean;
    forceEligible: boolean;
}

export async function getMemoryPalaceProcessingStats(charId: string): Promise<MemoryPalaceProcessingStats> {
    const allMessages = await DB.getMessagesByCharId(charId, true);
    const semantic = allMessages
        .filter(m => isMessageSemanticallyRelevant(m))
        .sort((a, b) => a.id - b.id);
    const highWaterMark = getLastProcessedId(charId);
    if (semantic.length <= HOT_ZONE_SIZE) {
        return {
            totalSemanticMessages: semantic.length,
            highWaterMark,
            hotZoneSize: HOT_ZONE_SIZE,
            hotZoneProtectedCount: semantic.length,
            hotZoneStartId: semantic[0]?.id ?? null,
            bufferCount: 0,
            processableCount: 0,
            autoThreshold: BUFFER_THRESHOLD,
            forceThreshold: MEMORY_PALACE_FORCE_MIN_THRESHOLD,
            autoEligible: false,
            forceEligible: false,
        };
    }
    const hotZoneStartId = semantic[semantic.length - HOT_ZONE_SIZE].id;
    const buffer = semantic.filter(m => m.id > highWaterMark && m.id < hotZoneStartId);
    return {
        totalSemanticMessages: semantic.length,
        highWaterMark,
        hotZoneSize: HOT_ZONE_SIZE,
        hotZoneProtectedCount: HOT_ZONE_SIZE,
        hotZoneStartId,
        bufferCount: buffer.length,
        processableCount: buffer.length >= MEMORY_PALACE_FORCE_MIN_THRESHOLD
            ? Math.ceil(buffer.length * PROCESS_RATIO)
            : 0,
        autoThreshold: BUFFER_THRESHOLD,
        forceThreshold: MEMORY_PALACE_FORCE_MIN_THRESHOLD,
        autoEligible: buffer.length >= BUFFER_THRESHOLD,
        forceEligible: buffer.length >= MEMORY_PALACE_FORCE_MIN_THRESHOLD,
    };
}

/**
 * 计算当前"真正可被 pipeline 处理"的缓冲区消息数。
 *
 * 与 processNewMessages 的口径完全一致：
 *   - 只数语义相关消息（排除纯图片/语音/表情）
 *   - 排除最后 HOT_ZONE_SIZE 条（热区永远不会被处理）
 *   - 只数 id > 高水位标记的部分
 *
 * 切勿用"id > hwm"裸过滤——那会把热区的 200 条也算进未同步，
 * 导致 UI 显示的"未同步条数"远大于 pipeline 实际能处理的量
 * （表现：弹窗说有几百条未同步，点立即追平却跑不出新 hwm）。
 */
export async function getMemoryPalaceUnprocessedBufferCount(charId: string): Promise<number> {
    return (await getMemoryPalaceProcessingStats(charId)).bufferCount;
}

/** 并发锁：防止多次 AI 回复同时触发 processNewMessages 产生竞态 */
const processingLocks = new Set<string>();

/**
 * 缓冲区机制处理聊天消息：
 *
 * 1. 热区 = 最近 200 条消息（留在聊天上下文，不处理）
 * 2. 缓冲区 = 高水位标记之后、热区之前的消息
 * 3. 缓冲区 >= 阈值时：取前 85% → LLM 提取记忆 → 本地保存 → 更新高水位
 * 4. 保留尾部 15%，避免下次总结时事件没有起因
 *
 * 相比旧方案（每轮 TopicLoom + 封盒），LLM 调用频率大幅降低：
 * 只在缓冲区满时触发，且只需 1 次 LLM 提取。
 */
/** Pipeline 处理结果 */
export interface PipelineResult {
    stored: number;
    skipped: number;
    /** 本轮 pipeline 从缓冲区取出处理的消息条数（caller 用于进度展示） */
    processedMessages?: number;
    memories: { content: string; room: string; importance: number; mood: string; tags: string[] }[];
    batches: { index: number; total: number; extracted: number; ok: boolean; error?: string }[];
    /**
     * 自动归档建议（供 React 层调用 updateCharacter 应用到 char.memories + hideBeforeMessageId）。
     * null = 本轮没产出新记忆或没更新水位线，caller 不需要做任何事。
     */
    autoArchive?: {
        /** 按日期切好的新 MemoryFragment 列表，id 已生成，mood='palace' */
        fragments: { id: string; date: string; summary: string; mood: string }[];
        /** 这一批 buffer 处理完后的水位线（= 最后一条被处理 Message.id），应设到 char.hideBeforeMessageId */
        hideBeforeMessageId: number;
    } | null;
    /**
     * 软跳过原因（非错误）：LLM 根本没跑，原因可能是缓冲区未到阈值 / 热区还没被挤出 / 已有任务在跑。
     * caller 看到这个字段就应当提示"聊天还不够，继续聊"，而不是报"LLM 提取失败"。
     */
    skipReason?: 'lock' | 'hot_zone' | 'threshold';
}

/** 构造一个"软跳过"结果，统一 caller 的分支处理 */
function makeSkipResult(reason: 'lock' | 'hot_zone' | 'threshold'): PipelineResult {
    return { stored: 0, skipped: 0, memories: [], batches: [], skipReason: reason };
}

export async function processNewMessages(
    _allRecentMessages: Message[], // 保留参数兼容，但内部直接从 DB 加载
    charId: string,
    charName: string,
    llmConfig: LightLLMConfig,
    userName: string = '',
    /** 强制模式：跳过缓冲区阈值检查，用于一键整理旧聊天 */
    force: boolean = false,
    /** 进度回调：通知调用方当前阶段 */
    onProgress?: (stage: string) => void,
): Promise<PipelineResult | null> {
    // 并发锁：同一角色同时只能跑一次
    if (processingLocks.has(charId)) {
        console.log(`🏰 [Pipeline] 跳过：${charName} 已有处理任务在运行`);
        return makeSkipResult('lock');
    }
    processingLocks.add(charId);

    try {
        // 1. 加载全部消息（含已处理的），计算热区和缓冲区
        //    过滤：保留任何有语义的消息类型（text / score_card / system / transfer / interaction），
        //    只排除纯视觉/音频类（image / emoji / voice）—— 后者经 normalize 变短占位，对 LLM 无增益
        const allMessages = await DB.getMessagesByCharId(charId, true);
        const textMessages = allMessages
            .filter(m => isMessageSemanticallyRelevant(m))
            .sort((a, b) => a.id - b.id);

        const totalCount = textMessages.length;

        if (totalCount <= HOT_ZONE_SIZE) {
            console.log(`🏰 [Pipeline] 跳过：消息总数 ${totalCount} <= 热区 ${HOT_ZONE_SIZE}，无需处理`);
            return makeSkipResult('hot_zone');
        }

        // 2. 热区 = 最后 HOT_ZONE_SIZE 条
        const hotZoneStartIdx = totalCount - HOT_ZONE_SIZE;
        const hotZoneStartId = textMessages[hotZoneStartIdx].id;

        // 3. 缓冲区 = 高水位标记之后、热区之前
        const lastProcessedId = getLastProcessedId(charId);
        const buffer = textMessages.filter(m => m.id > lastProcessedId && m.id < hotZoneStartId);

        const minThreshold = force ? 10 : BUFFER_THRESHOLD;
        if (buffer.length < minThreshold) {
            console.log(`🏰 [Pipeline] 跳过：缓冲区 ${buffer.length} 条 < 阈值 ${minThreshold}（hwm=${lastProcessedId}, hotZone起始id=${hotZoneStartId}）`);
            return makeSkipResult('threshold');
        }

        // 4. 取前 85% 处理，保留尾部 15%
        const processCount = Math.ceil(buffer.length * PROCESS_RATIO);
        const toProcess = buffer.slice(0, processCount);
        const keptTail = buffer.length - processCount;

        if (toProcess.length === 0) return makeSkipResult('threshold');

        console.log(`🏰 [Pipeline] 开始处理缓冲区：${toProcess.length} 条消息（保留尾部 ${keptTail} 条）`);
        console.log(`🏰 [Pipeline]   消息ID范围: ${toProcess[0].id} ~ ${toProcess[toProcess.length - 1].id}`);
        console.log(`🏰 [Pipeline]   总消息: ${totalCount}, 热区: ${HOT_ZONE_SIZE}, 缓冲区: ${buffer.length}, hwm: ${lastProcessedId}`);
        onProgress?.(`正在整理 ${toProcess.length} 条对话...`);

        // 5. 构建精简上下文：角色档案 + 用户档案 + 相关已有记忆
        let charContext = '';
        let relatedMemoryRefs: RelatedMemoryRef[] = [];
        try {
            const chars = await DB.getAllCharacters();
            const charProfile = chars.find(c => c.id === charId);
            const userProfile = await DB.getUserProfile();

            // 5a. 精简角色档案（姓名、设定、世界观）
            if (charProfile) {
                charContext = buildExtractionProfileContext(
                    charProfile.name,
                    charProfile.systemPrompt,
                    charProfile.worldview,
                    userProfile?.name || userName || '用户',
                    userProfile?.bio,
                );
            } else if (userProfile) {
                charContext = buildExtractionProfileContext(
                    charName,
                    undefined,
                    undefined,
                    userProfile.name,
                    userProfile.bio,
                );
            }

            // 5c. 文本检索相关已有记忆，用于两个目的：
            //     ① 为 LLM 提取提供上下文（防止误解隐式指代）
            //     ② 收集结构化引用供 LLM 标注 relatedTo → EventBox 绑定
            //     细粒度策略：每条 ≥4 字的 user 消息独立 query（和 retrieval spike 对齐，避免把
            //     一整段 chat 揉成 3 段 embed 导致语义平均稀释）；消息太少时 fallback 3 段切法
            let snippets = splitMessagesToSpikes(toProcess);
            let strategy = 'per-msg';
            if (snippets.length === 0) {
                snippets = sampleSnippetsFromMessages(toProcess, 5, 300);
                strategy = 'fallback-3seg';
            }
            relatedMemoryRefs = await fetchRelatedMemoriesForExtraction(snippets, charId);
            if (relatedMemoryRefs.length > 0) {
                console.log(`🏰 [Pipeline] 检索到 ${relatedMemoryRefs.length} 条相关记忆作为提取上下文（${strategy}，${snippets.length} 段 query）`);
            }

            // 5d. 召回回执补强：路径①召回时被实际注入 prompt 的 memoryId 一定
            //     参与了角色这段对话——这是判断"用户纠正了哪条旧记忆"的可靠线索。
            //     普通相关性召回经常漏掉这类目标（纠正话题离原记忆语义已偏移），所以用
            //     回执查表保底。配额 5 条优先，剩余格子留给普通召回。
            try {
                const RECEIPT_QUOTA = 5;
                const RECEIPT_TIME_TOLERANCE_MS = 10 * 60 * 1000; // 消息 ts 与 receipt ts 的容差
                const tsList = toProcess.map(m => m.timestamp).filter(t => t > 0);
                if (tsList.length > 0) {
                    const fromTs = Math.min(...tsList) - RECEIPT_TIME_TOLERANCE_MS;
                    const toTs = Math.max(...tsList) + RECEIPT_TIME_TOLERANCE_MS;
                    const receiptIds = getReceiptIdsInRange(charId, fromTs, toTs, RECEIPT_QUOTA);
                    if (receiptIds.length > 0) {
                            // 已经在文本召回里出现的就不重复加
                        const existingIds = new Set(relatedMemoryRefs.map(r => r.id));
                        const receiptRefs: RelatedMemoryRef[] = [];
                        for (const id of receiptIds) {
                            if (existingIds.has(id)) continue;
                            const node = await MemoryNodeDB.getById(id);
                            // 不喂 archived 节点（早被压缩归档了，纠正它没意义；该纠正
                            // 的是 box 的 summary，summary 是非 archived，能正常进来）
                            if (!node || node.archived) continue;
                            receiptRefs.push({
                                id: node.id,
                                room: node.room,
                                content: (node.content || '').slice(0, 100),
                            });
                        }
                        if (receiptRefs.length > 0) {
                            // 回执优先放前面（O0..On），普通召回继续往后排
                            relatedMemoryRefs = [...receiptRefs, ...relatedMemoryRefs];
                            console.log(`🧾 [Pipeline] 召回回执补强：从最近注入历史拉回 ${receiptRefs.length} 条记忆作为高优先级 relatedMemories`);
                        }
                    }
                }
            } catch (e: any) {
                console.warn(`🧾 [Pipeline] 召回回执查询失败（不影响提取）: ${e.message}`);
            }
        } catch (e: any) {
            console.warn(`🏰 [Pipeline] 加载角色上下文失败（不影响提取）: ${e.message}`);
        }

        // 6. 收集当前便利贴（供 LLM 判断是否需要提前摘除）
        const now = Date.now();
        const allCharNodes = await MemoryNodeDB.getByCharId(charId);
        const pinnedRefs: PinnedMemoryRef[] = allCharNodes
            .filter(n => n.pinnedUntil && n.pinnedUntil > now)
            .map(n => ({ id: n.id, content: n.content.slice(0, 80) }));

        // 7. LLM 提取记忆 — 默认按实际 prompt 体积分批。
        //    关闭文具盒「上下文防爆保护」时回退旧策略，方便调试完整原始请求。
        const auxContextBudgetEnabled = isAuxContextBudgetEnabled();
        const chunks = auxContextBudgetEnabled
            ? splitMessagesForExtraction(toProcess, charName, userName || '用户')
            : (() => {
                const legacyChunkSize = 250;
                const legacyChunks: Message[][] = [];
                for (let i = 0; i < toProcess.length; i += legacyChunkSize) {
                    legacyChunks.push(toProcess.slice(i, i + legacyChunkSize));
                }
                return legacyChunks;
            })();

        console.log(`🏰 [Pipeline] 开始提取记忆：${toProcess.length} 条消息，拆成 ${chunks.length} 批${auxContextBudgetEnabled ? '（按请求体积）' : '（旧版固定条数）'}`);

        const allMemories: import('./types').MemoryNode[] = [];
        const allCrossTimeLinks: { newMemoryId: string; existingMemoryId: string }[] = [];
        const allEventBoxHints: import('./extraction').EventBoxHint[] = [];
        const allCorrections: { targetId: string; note: string }[] = [];
        const batchResults: PipelineResult['batches'] = [];

        for (let ci = 0; ci < chunks.length; ci++) {
            const chunk = chunks[ci];
            onProgress?.(`正在提取记忆 (${ci + 1}/${chunks.length})...`);
            console.log(`🏰 [Pipeline] 调用 LLM 提取 batch ${ci + 1}/${chunks.length}（${chunk.length} 条消息 → ${llmConfig.model}）`);

            try {
                const extractionResult = await extractMemoriesFromBuffer(
                    chunk, charId, charName, llmConfig, charContext, userName, relatedMemoryRefs, pinnedRefs,
                );
                allMemories.push(...extractionResult.memories);
                allCrossTimeLinks.push(...extractionResult.crossTimeLinks);
                allEventBoxHints.push(...extractionResult.eventBoxHints);
                allCorrections.push(...extractionResult.corrections);
                batchResults.push({ index: ci + 1, total: chunks.length, extracted: extractionResult.memories.length, ok: true });

                // 处理便利贴摘除
                if (extractionResult.unpinIds.length > 0) {
                    for (const unpinId of extractionResult.unpinIds) {
                        const node = allCharNodes.find(n => n.id === unpinId);
                        if (node) {
                            node.pinnedUntil = null;
                            await MemoryNodeDB.save(node);
                        }
                    }
                    console.log(`📌 [Pipeline] batch ${ci + 1}: 摘除 ${extractionResult.unpinIds.length} 条便利贴`);
                }
            } catch (e: any) {
                console.warn(`🏰 [Pipeline] batch ${ci + 1} 提取失败: ${e.message}（继续下一批）`);
                batchResults.push({ index: ci + 1, total: chunks.length, extracted: 0, ok: false, error: e.message });
            }
        }

        const memories = allMemories;

        if (memories.length === 0) {
            console.warn(`🏰 [Pipeline] 所有批次共提取 0 条记忆（${toProcess.length} 条消息），不更新高水位，下次重试`);
            return { stored: 0, skipped: 0, memories: [], batches: batchResults };
        }

        console.log(`🏰 [Pipeline] 提取完成：${chunks.length} 批共 ${memories.length} 条记忆`);

        // 8. 本地保存节点。高水位由保存成功决定，不依赖旧索引表。
        console.log(`🏰 [Pipeline] 开始保存 ${memories.length} 条本地记忆...`);
        onProgress?.(`正在保存 ${memories.length} 条记忆...`);
        await MemoryNodeDB.saveMany(memories);
        const storedCount = memories.length;
        console.log(`🏰 [Pipeline] 本地保存完成：${storedCount} 条`);

        // 9. 保存成功后更新高水位
        const newHighWaterMark = toProcess[toProcess.length - 1].id;
        setLastProcessedId(charId, newHighWaterMark);
        console.log(`✅ [Pipeline] 缓冲区处理完成：${storedCount} 条记忆, hwm ${lastProcessedId} → ${newHighWaterMark}`);
        onProgress?.(`记忆整理完成！新增 ${storedCount} 条记忆`);

        // 9b. 自动归档建议：按日期 group 新记忆 → YAML bullets → 合成 MemoryFragment
        //     caller（useChatAI / Chat）拿到后做"同日期 merge 进 char.memories + 推 hideBeforeMessageId"
        //     这条路径让 palace 成功后自动同步到传统归档+聊天水位线
        //     零 LLM 调用——风格化已经在 palace extraction 那次 LLM 调用里完成
        const autoArchive = buildAutoArchiveFragments(memories, newHighWaterMark);

        // 构建返回结果
        const pipelineResult: PipelineResult = {
            stored: storedCount,
            skipped: 0,
            processedMessages: toProcess.length,
            memories: memories.map(m => ({ content: m.content, room: m.room, importance: m.importance, mood: m.mood, tags: m.tags })),
            batches: batchResults,
            autoArchive,
        };

        // 10. 建关联（仅规则，不调 LLM，省钱）— 失败不影响已保存的记忆
        try {
            const existingNodes = await MemoryNodeDB.getByCharId(charId);
            const justStored = existingNodes.filter(n => memories.some(nn => nn.id === n.id));
            const others = existingNodes.filter(n => !memories.some(nn => nn.id === n.id));
            await buildLinks(justStored, others);
            console.log(`🏰 [Pipeline] 关联建立完成（${justStored.length} 新节点 vs ${Math.min(others.length, 50)} 已有节点）`);
        } catch (e: any) {
            console.warn(`🏰 [Pipeline] 关联建立失败（不影响已保存记忆）: ${e.message}`);
        }

        // 10b. EventBox 绑定：把 LLM 标注的 relatedTo 转为 EventBox 收纳
        //      （旧逻辑：转 causal MemoryLink 已废弃，让位给更强的 EventBox 机制）
        const touchedBoxIds = new Set<string>();
        if (allCrossTimeLinks.length > 0) {
            try {
                const { bindMemoriesIntoEventBox } = await import('./eventBox');
                const touched = await bindMemoriesIntoEventBox(charId, allCrossTimeLinks, allEventBoxHints);
                for (const id of touched) touchedBoxIds.add(id);
                console.log(`📦 [Pipeline] EventBox 绑定：${allCrossTimeLinks.length} 条关联 → 触达 ${touched.size} 个事件盒`);
            } catch (e: any) {
                console.warn(`📦 [Pipeline] EventBox 绑定失败（不影响已保存记忆）: ${e.message}`);
            }
        }

        // 10c. EventBox 压缩：扫描刚被触达的盒，活节点 ≥ 4 → LLM 二次总结
        if (touchedBoxIds.size > 0) {
            try {
                const { maybeCompressEventBoxes } = await import('./eventBoxCompression');
                await maybeCompressEventBoxes(touchedBoxIds, llmConfig, charName, userName);
            } catch (e: any) {
                console.warn(`🗜️ [Pipeline] EventBox 压缩失败（不影响已保存记忆）: ${e.message}`);
            }
        }

        // 10d. 应用纠正：把 LLM 标的"用户纠正了 OX"翻译成对原节点 content 的追加。
        //     设计：不新增节点、不动 EventBox 结构、不删原内容——只在 content 末尾
        //     追加一行"（YYYY-MM-DD 纠正：xxx）"。下次召回时 LLM
        //     看到带纠正标签的内容会自然采用新版本。
        //     放在压缩之后：避免刚改完 content 的节点被同轮压缩当 live 节点吞掉。
        if (allCorrections.length > 0) {
            try {
                // 同一目标多次纠正：合并成一条多分号 note，避免追加多次
                const merged = new Map<string, string[]>();
                for (const c of allCorrections) {
                    const arr = merged.get(c.targetId) || [];
                    arr.push(c.note);
                    merged.set(c.targetId, arr);
                }

                const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
                for (const [targetId, notes] of merged) {
                    const node = await MemoryNodeDB.getById(targetId);
                    if (!node) {
                        console.warn(`✏️ [Pipeline] 纠正目标 ${targetId} 已不存在，跳过`);
                        continue;
                    }
                    if (node.archived) {
                        // archived 节点不参与召回，纠正它没意义
                        console.warn(`✏️ [Pipeline] 纠正目标 ${targetId} 已归档，跳过`);
                        continue;
                    }
                    const noteText = notes.map(n => n.trim()).filter(Boolean).join('；');
                    if (!noteText) continue;
                    node.content = `${node.content}\n（${dateStr} 纠正：${noteText}）`;
                    node.lastAccessedAt = Date.now();
                    await MemoryNodeDB.save(node);
                    console.log(`✏️ [Pipeline] 纠正应用 ${targetId}: "${noteText.slice(0, 40)}…"`);
                }
            } catch (e: any) {
                console.warn(`✏️ [Pipeline] 应用纠正失败（不影响已保存记忆）: ${e.message}`);
            }
        }

        // 11. 巩固（纯计算）— 失败不影响已保存的记忆
        try {
            await runConsolidation(charId);
        } catch (e: any) {
            console.warn(`🏰 [Pipeline] 巩固失败（不影响已保存记忆）: ${e.message}`);
        }

        return pipelineResult;

    } catch (err: any) {
        console.error(`❌ [Pipeline] processNewMessages 失败 (charId=${charId}):`, err.message, err.stack?.split('\n')[1] || '');
        return null;
    } finally {
        processingLocks.delete(charId);
    }
}
