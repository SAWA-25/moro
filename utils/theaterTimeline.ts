/**
 * 折子戏·轨迹 & 对影 的共享数据层。
 *
 * 轨迹（Trajectory）：把角色「遇见你之前」的人生补成一条可回看的时间线。v2 在时间线
 * 之外增加人生档案、节点细看、非正史分支与单节点重写，全部仍存在 assets store，不做 DB
 * schema migration。
 *
 * 对影（Reflection）：从轨迹里挑两个时间节点，让「同一个人、不同时间里的两个自己」相逢对话。
 *
 * 📌 prompt 文案集中在 utils/theaterPrompts.ts（[陆] 轨迹 / [柒] 对影 区段），改文案去那里。
 */

import {
    CharacterProfile,
    TheaterReflectionLength,
    TheaterReflectionLine,
    TheaterReflectionMode,
    TheaterReflectionNodeSnapshot,
    TheaterReflectionOptions,
    TheaterReflectionScene,
    TheaterReflectionSession,
    TheaterReflectionTone,
} from '../types';
import { DB } from './db';
import { sanitizeLifeText } from './autonomousLife';
import { extractContent, extractJson } from './safeApi';
import { makeApiUsageMeta } from './apiUsageCatalog';
import { callChatCompletion } from './llmClient';
import {
    trajectoryBeforePrompt,
    trajectoryBranchPrompt,
    trajectoryDetailPrompt,
    trajectoryRewriteNodePrompt,
    reflectionPrompt,
    reflectionContinuePrompt,
} from './theaterPrompts';

export interface TimelineApi {
    baseUrl: string;
    apiKey: string;
    model: string;
    apiRole?: 'main' | 'aux' | 'custom';
    apiBinding?: string;
}

export interface TrajectoryNode {
    id: string;
    /** 该时刻的时间戳（ms） */
    ts: number;
    /** before=相遇之前 / meeting=相遇那天 / after=相遇之后 */
    era: 'before' | 'meeting' | 'after';
    title: string;
    /** 第三人称场景，2~4 句 */
    scene: string;
    mood?: string;
    place?: string;
    /** 这一帧在整条人生线里的戏剧功能 */
    beat?: string;
    /** 可放入相册/物件簿的代表物 */
    object?: string;
    /** 用于相册过滤的短标签 */
    tags?: string[];
    source: 'generated' | 'firstMet' | 'lifeEvent';
}

export interface TrajectoryDossier {
    arcTitle: string;
    summary: string;
    motifs: string[];
    coreWound?: string;
    coreWant?: string;
    places: string[];
    objects: string[];
    openQuestions: string[];
}

export interface TrajectoryNodeDetail {
    nodeId: string;
    generatedAt: number;
    stillFrame: string;
    senses: string[];
    innerMonologue: string;
    unsaidLine: string;
    consequence: string;
    keepsake?: string;
}

export interface TrajectoryBranch {
    id: string;
    nodeId: string;
    generatedAt: number;
    premise: string;
    title: string;
    scene: string;
    cost: string;
    unchanged: string;
}

export interface CharTrajectory {
    charId: string;
    generatedAt: number;
    version?: 2;
    /** 你走进 TA 人生的那天（最早一条真实聊天） */
    firstMetTs: number;
    dossier?: TrajectoryDossier;
    nodes: TrajectoryNode[];
    nodeDetails?: Record<string, TrajectoryNodeDetail>;
    branches?: Record<string, TrajectoryBranch[]>;
}

export type ReflectionLine = TheaterReflectionLine;
export type ReflectionScene = TheaterReflectionScene;

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const TRAJECTORY_VERSION = 2 as const;
const MAX_BRANCHES_PER_NODE = 5;
const ASSET_KEY = (charId: string) => `theater_trajectory_${charId}`;

const genId = () => Math.random().toString(36).slice(2, 10);

const DEFAULT_REFLECTION_OPTIONS: TheaterReflectionOptions = {
    mode: 'moonlight',
    tone: 'restrained',
    length: 'standard',
};

const REFLECTION_MODE_LABEL: Record<TheaterReflectionMode, string> = {
    moonlight: '月下照面',
    letter: '写给从前',
    crossroad: '命运岔路',
    reconcile: '自我和解',
};

const REFLECTION_TONE_LABEL: Record<TheaterReflectionTone, string> = {
    restrained: '克制',
    tender: '温柔',
    aching: '酸涩',
    relieved: '释然',
};

const REFLECTION_LENGTH_LABEL: Record<TheaterReflectionLength, string> = {
    short: '短章',
    standard: '标准',
    long: '长章',
};

const clean = (value: unknown, max = 200, fallback = ''): string => {
    const s = String(value ?? '').replace(/\s+/g, ' ').trim();
    return (s || fallback).slice(0, max).trim();
};

const cleanMultiline = (value: unknown, max = 800, fallback = ''): string => {
    const s = String(value ?? '').replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').trim();
    return (s || fallback).slice(0, max).trim();
};

const cleanList = (value: unknown, maxItems: number, maxLen: number): string[] => {
    const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[、,，\n]/) : [];
    const out: string[] = [];
    for (const item of raw) {
        const s = clean(item, maxLen);
        if (s && !out.includes(s)) out.push(s);
        if (out.length >= maxItems) break;
    }
    return out;
};

async function callLLM(
    api: TimelineApi,
    prompt: string,
    temperature = 0.92,
    maxTokens = 3200,
    featureId: 'theater.timeline' | 'theater.reflection' = 'theater.timeline',
): Promise<string> {
    const data = await callChatCompletion(api, {
        model: api.model,
        messages: [{ role: 'user', content: prompt }],
        temperature,
        max_tokens: maxTokens,
        stream: false,
    }, {
        meta: makeApiUsageMeta(featureId, {
            apiRole: api.apiRole || 'aux',
            apiBinding: api.apiBinding,
        }),
    });
    return extractContent(data);
}

function buildPersona(char: CharacterProfile): string {
    return [
        char.systemPrompt ? `人设与性格：\n${char.systemPrompt}` : '',
        char.worldview ? `世界观 / 背景：\n${char.worldview}` : '',
        Array.isArray(char.selfInsights) && char.selfInsights.length
            ? `TA 沉淀下来的一些自我认知：\n${char.selfInsights.map(s => `- ${s}`).join('\n')}`
            : '',
    ].filter(Boolean).join('\n\n');
}

function fallbackDossier(charName: string, nodes: TrajectoryNode[]): TrajectoryDossier {
    const before = nodes.filter(n => n.era === 'before');
    const places = cleanList(before.map(n => n.place).filter(Boolean), 8, 18);
    const objects = cleanList(before.map(n => n.object).filter(Boolean), 8, 18);
    const motifs = cleanList(before.flatMap(n => n.tags || []), 6, 10);
    const first = before[0];
    const last = before[before.length - 1];
    return {
        arcTitle: `${charName} 的旧日放映`,
        summary: before.length
            ? `${charName} 在这些相遇前的片段里，慢慢从「${first?.title || '很早以前'}」走到「${last?.title || '临近相遇'}」。这些节点不是结论，只是 TA 成为今天之前留下的几帧底片。`
            : `${charName} 的轨迹暂时还很薄，但这条路已经从相遇那天向两端展开。`,
        motifs: motifs.length ? motifs : ['独自生活', '未说出口', '慢慢靠近'],
        coreWound: '有些事 TA 习惯先自己扛住。',
        coreWant: '被真正看见时，不必把自己解释得太完整。',
        places,
        objects,
        openQuestions: ['如果没有遇见你，TA 会把这条路走向哪里？'],
    };
}

function normalizeNode(raw: any, firstMetTs: number, idx = 0): TrajectoryNode | null {
    if (!raw || typeof raw !== 'object') return null;
    const era: TrajectoryNode['era'] =
        raw.era === 'meeting' || raw.era === 'after' || raw.era === 'before' ? raw.era : 'before';
    const scene = cleanMultiline(raw.scene, 900);
    if (!scene) return null;
    const yearsAgo = Math.max(0.1, Number(raw.yearsAgo) || 0);
    const rawTs = Number(raw.ts);
    const ts = Number.isFinite(rawTs)
        ? rawTs
        : era === 'before'
            ? Math.min(firstMetTs - 1, firstMetTs - yearsAgo * YEAR_MS)
            : firstMetTs + idx;
    const safeTs = era === 'before' ? Math.min(firstMetTs - 1, ts) : ts;
    return {
        id: clean(raw.id, 60) || genId(),
        ts: safeTs,
        era,
        title: clean(raw.title, 16, era === 'before' ? '那一年' : '某一天'),
        scene,
        mood: clean(raw.mood, 12) || undefined,
        place: clean(raw.place, 16) || undefined,
        beat: clean(raw.beat, 24) || undefined,
        object: clean(raw.object ?? raw.keepsake, 16) || undefined,
        tags: cleanList(raw.tags, 5, 10),
        source: raw.source === 'firstMet' || raw.source === 'lifeEvent' || raw.source === 'generated'
            ? raw.source
            : era === 'meeting'
                ? 'firstMet'
                : era === 'after'
                    ? 'lifeEvent'
                    : 'generated',
    };
}

export function sanitizeTrajectoryDossier(raw: any, charName = 'TA', nodes: TrajectoryNode[] = []): TrajectoryDossier {
    const fallback = fallbackDossier(charName, nodes);
    if (!raw || typeof raw !== 'object') return fallback;
    return {
        arcTitle: clean(raw.arcTitle, 24, fallback.arcTitle),
        summary: cleanMultiline(raw.summary, 360, fallback.summary),
        motifs: cleanList(raw.motifs, 8, 12).length ? cleanList(raw.motifs, 8, 12) : fallback.motifs,
        coreWound: clean(raw.coreWound, 80) || fallback.coreWound,
        coreWant: clean(raw.coreWant, 80) || fallback.coreWant,
        places: cleanList(raw.places, 10, 18).length ? cleanList(raw.places, 10, 18) : fallback.places,
        objects: cleanList(raw.objects, 10, 18).length ? cleanList(raw.objects, 10, 18) : fallback.objects,
        openQuestions: cleanList(raw.openQuestions, 6, 50).length ? cleanList(raw.openQuestions, 6, 50) : fallback.openQuestions,
    };
}

export function sanitizeTrajectoryDetail(raw: any, nodeId: string, now = Date.now()): TrajectoryNodeDetail | null {
    if (!raw || typeof raw !== 'object') return null;
    const stillFrame = cleanMultiline(raw.stillFrame, 360);
    const innerMonologue = cleanMultiline(raw.innerMonologue, 360);
    const unsaidLine = clean(raw.unsaidLine, 120);
    const consequence = cleanMultiline(raw.consequence, 260);
    const senses = cleanList(raw.senses, 5, 40);
    if (!stillFrame && !innerMonologue && !unsaidLine && !consequence && senses.length === 0) return null;
    return {
        nodeId,
        generatedAt: Number(raw.generatedAt) || now,
        stillFrame: stillFrame || '这一帧像被夹在旧相册里，还没有完全显影。',
        senses,
        innerMonologue: innerMonologue || '那一刻 TA 没有把心里的话说出口。',
        unsaidLine: unsaidLine || '其实我也不知道自己在等什么。',
        consequence: consequence || '这件事后来变成 TA 性格里一个很轻、但一直存在的折痕。',
        keepsake: clean(raw.keepsake, 30) || undefined,
    };
}

export function sanitizeTrajectoryBranch(raw: any, nodeId: string, premise: string, now = Date.now()): TrajectoryBranch | null {
    if (!raw || typeof raw !== 'object') return null;
    const scene = cleanMultiline(raw.scene, 700);
    if (!scene) return null;
    return {
        id: clean(raw.id, 60) || genId(),
        nodeId,
        generatedAt: Number(raw.generatedAt) || now,
        premise: clean(raw.premise, 120, premise),
        title: clean(raw.title, 18, '如果那天'),
        scene,
        cost: cleanMultiline(raw.cost, 220, '这条岔路会让 TA 失去一点原本留下来的东西。'),
        unchanged: cleanMultiline(raw.unchanged, 220, '但 TA 身上有些东西仍然不会改变。'),
    };
}

function sanitizeDetails(raw: any, validIds: Set<string>): Record<string, TrajectoryNodeDetail> {
    const out: Record<string, TrajectoryNodeDetail> = {};
    if (!raw || typeof raw !== 'object') return out;
    for (const [id, value] of Object.entries(raw)) {
        if (!validIds.has(id)) continue;
        const detail = sanitizeTrajectoryDetail(value, id, Number((value as any)?.generatedAt) || Date.now());
        if (detail) out[id] = detail;
    }
    return out;
}

function sanitizeBranches(raw: any, validIds: Set<string>): Record<string, TrajectoryBranch[]> {
    const out: Record<string, TrajectoryBranch[]> = {};
    if (!raw || typeof raw !== 'object') return out;
    for (const [id, value] of Object.entries(raw)) {
        if (!validIds.has(id) || !Array.isArray(value)) continue;
        const list = value
            .map((it: any) => sanitizeTrajectoryBranch(it, id, clean(it?.premise, 120), Number(it?.generatedAt) || Date.now()))
            .filter((it: TrajectoryBranch | null): it is TrajectoryBranch => !!it)
            .sort((a, b) => b.generatedAt - a.generatedAt)
            .slice(0, MAX_BRANCHES_PER_NODE);
        if (list.length) out[id] = list;
    }
    return out;
}

export function normalizeTrajectory(raw: any, charName = 'TA'): CharTrajectory | null {
    if (!raw || typeof raw !== 'object') return null;
    const firstMetTs = Number(raw.firstMetTs) || Date.now();
    const nodes: TrajectoryNode[] = (Array.isArray(raw.nodes) ? raw.nodes : [])
        .map((it: any, idx: number) => normalizeNode(it, firstMetTs, idx))
        .filter((n: TrajectoryNode | null): n is TrajectoryNode => !!n)
        .sort((a: TrajectoryNode, b: TrajectoryNode) => a.ts - b.ts);
    if (!nodes.length) return null;
    const validIds = new Set<string>(nodes.map((n: TrajectoryNode) => n.id));
    return {
        charId: clean(raw.charId, 80),
        generatedAt: Number(raw.generatedAt) || Date.now(),
        version: TRAJECTORY_VERSION,
        firstMetTs,
        dossier: sanitizeTrajectoryDossier(raw.dossier, charName, nodes),
        nodes,
        nodeDetails: sanitizeDetails(raw.nodeDetails, validIds),
        branches: sanitizeBranches(raw.branches, validIds),
    };
}

export function parseTrajectorySkeleton(raw: any, firstMetTs: number, charName: string): { nodes: TrajectoryNode[]; dossier: TrajectoryDossier } {
    const parsed = Array.isArray(raw) ? { nodes: raw } : raw;
    const beforeNodes: TrajectoryNode[] = (Array.isArray(parsed?.nodes) ? parsed.nodes : [])
        .map((it: any, idx: number) => normalizeNode({ ...it, era: 'before', source: 'generated' }, firstMetTs, idx))
        .filter((n: TrajectoryNode | null): n is TrajectoryNode => !!n)
        .map((n: TrajectoryNode): TrajectoryNode => ({ ...n, ts: Math.min(firstMetTs - 1, n.ts), era: 'before' as const, source: 'generated' as const }))
        .sort((a: TrajectoryNode, b: TrajectoryNode) => a.ts - b.ts);
    const dossier = sanitizeTrajectoryDossier(parsed?.dossier, charName, beforeNodes);
    return { nodes: beforeNodes, dossier };
}

function pruneTrajectoryCaches(
    trajectory: CharTrajectory,
    nodes: TrajectoryNode[],
    overrides: Partial<CharTrajectory> = {},
): CharTrajectory {
    const validIds = new Set(nodes.map(n => n.id));
    const detailSource = overrides.nodeDetails !== undefined ? overrides.nodeDetails : trajectory.nodeDetails;
    const branchSource = overrides.branches !== undefined ? overrides.branches : trajectory.branches;
    const nodeDetails = sanitizeDetails(detailSource || {}, validIds);
    const branches = sanitizeBranches(branchSource || {}, validIds);
    return {
        ...trajectory,
        ...overrides,
        version: TRAJECTORY_VERSION,
        nodes,
        dossier: sanitizeTrajectoryDossier(overrides.dossier || trajectory.dossier, 'TA', nodes),
        nodeDetails,
        branches,
    };
}

async function saveTrajectory(trajectory: CharTrajectory): Promise<void> {
    try { await DB.saveAsset(ASSET_KEY(trajectory.charId), JSON.stringify(trajectory)); } catch { /* 落库失败不致命 */ }
}

/** 你第一次走进 TA 的世界：取最早一条真实（非系统）聊天的时间，没有就退回 fallback。 */
export async function resolveFirstMet(charId: string, fallback: number): Promise<number> {
    try {
        const msgs = await DB.getMessagesByCharId(charId);
        let min = Infinity;
        for (const m of msgs) {
            if (m.role !== 'system' && typeof m.timestamp === 'number' && m.timestamp > 0 && m.timestamp < min) {
                min = m.timestamp;
            }
        }
        if (min !== Infinity) return min;
    } catch { /* ignore */ }
    return fallback;
}

/** 读已持久化的轨迹（没有则返回 null）。旧版存档会懒标准化成 v2 并写回。 */
export async function loadTrajectory(charId: string): Promise<CharTrajectory | null> {
    try {
        const raw = await DB.getAsset(ASSET_KEY(charId));
        if (!raw) return null;
        const parsed = normalizeTrajectory(JSON.parse(raw));
        if (parsed && parsed.charId === charId) {
            if (parsed.version !== TRAJECTORY_VERSION || raw !== JSON.stringify(parsed)) void saveTrajectory(parsed);
            return parsed;
        }
    } catch { /* ignore */ }
    return null;
}

export async function clearTrajectory(charId: string): Promise<void> {
    try { await DB.saveAsset(ASSET_KEY(charId), ''); } catch { /* ignore */ }
}

/** 合上相遇那天的 + 相遇之后真实自主生活事件，组成完整时间线。 */
async function assembleNodes(
    charId: string,
    userName: string,
    charName: string,
    firstMetTs: number,
    beforeNodes: TrajectoryNode[],
): Promise<TrajectoryNode[]> {
    const meeting: TrajectoryNode = {
        id: `met_${firstMetTs}`,
        ts: firstMetTs,
        era: 'meeting',
        title: `你走进了 TA 的人生`,
        scene: `就是这一天，${userName} 第一次出现在 ${charName} 的世界里。在此之前 TA 已经独自走了很长一段路，从这一刻起，那条路上多了一个人的脚步。`,
        beat: '命运改道',
        object: '第一条消息',
        tags: ['相遇', '转折'],
        source: 'firstMet',
    };

    let afterNodes: TrajectoryNode[] = [];
    try {
        const events = await DB.getLifeEvents(charId);
        afterNodes = (events || [])
            .filter(e => e.timestamp > firstMetTs)
            .map((e): TrajectoryNode | null => {
                const activity = sanitizeLifeText(e.activity) || sanitizeLifeText(e.summary || '');
                const summary = sanitizeLifeText(e.summary || '');
                if (!activity && !summary) return null;
                return {
                    id: e.id,
                    ts: e.timestamp,
                    era: 'after' as const,
                    title: (activity || summary).slice(0, 14) || '某一天',
                    scene: summary || activity || '',
                    mood: e.mood,
                    place: e.location,
                    beat: '相遇之后的日常证据',
                    tags: ['相遇之后', e.source === 'catchup' ? '离线生活' : '主动生活'].filter(Boolean),
                    source: 'lifeEvent' as const,
                };
            })
            .filter((node): node is TrajectoryNode => !!node);
    } catch { /* 没有自主生活事件也没关系 */ }

    return [...beforeNodes, meeting, ...afterNodes].sort((a, b) => a.ts - b.ts);
}

/**
 * 生成「相遇之前」的人生骨架并落库。已存在则直接返回（除非 force）。
 */
export async function loadOrGenerateTrajectory(
    char: CharacterProfile,
    userName: string,
    api: TimelineApi,
    opts: { force?: boolean } = {},
): Promise<CharTrajectory> {
    if (!opts.force) {
        const cached = await loadTrajectory(char.id);
        if (cached) return cached;
    }

    const firstMetTs = await resolveFirstMet(char.id, Date.now());
    const persona = buildPersona(char);
    const prompt = trajectoryBeforePrompt({ charName: char.name, userName, persona });

    let beforeNodes: TrajectoryNode[] = [];
    let dossier: TrajectoryDossier | undefined;
    try {
        const raw = await callLLM(api, prompt);
        const parsed = extractJson(raw);
        const skeleton = parseTrajectorySkeleton(parsed, firstMetTs, char.name);
        beforeNodes = skeleton.nodes;
        dossier = skeleton.dossier;
    } catch (e) {
        throw new Error(`轨迹生成失败：${e instanceof Error ? e.message : String(e)}`);
    }

    if (!beforeNodes.length) throw new Error('没能从模型那里得到可用的轨迹片段，换个角色或稍后再试。');

    const nodes = await assembleNodes(char.id, userName, char.name, firstMetTs, beforeNodes);
    const trajectory: CharTrajectory = {
        charId: char.id,
        generatedAt: Date.now(),
        version: TRAJECTORY_VERSION,
        firstMetTs,
        dossier: sanitizeTrajectoryDossier(dossier, char.name, nodes),
        nodes,
        nodeDetails: {},
        branches: {},
    };
    await saveTrajectory(trajectory);
    return trajectory;
}

/** 相遇之后真实事件可能增加，重新拼接 after 段（不重生成 before），保持时间线新鲜。 */
export async function refreshAfterNodes(
    trajectory: CharTrajectory,
    userName: string,
    charName: string,
): Promise<CharTrajectory> {
    const normalized = normalizeTrajectory(trajectory, charName) || trajectory;
    const before = normalized.nodes.filter(n => n.era === 'before');
    const nodes = await assembleNodes(normalized.charId, userName, charName, normalized.firstMetTs, before);
    const next = pruneTrajectoryCaches(normalized, nodes);
    await saveTrajectory(next);
    return next;
}

export function nodeWhen(node: TrajectoryNode, firstMetTs: number): string {
    if (node.era === 'meeting') return '你们相遇的那天';
    if (node.era === 'before') {
        const years = (firstMetTs - node.ts) / YEAR_MS;
        if (years >= 1) return `相遇前约 ${Math.round(years)} 年`;
        const months = Math.max(1, Math.round((firstMetTs - node.ts) / MONTH_MS));
        return `相遇前约 ${months} 个月`;
    }
    const days = Math.max(0, Math.round((node.ts - firstMetTs) / DAY_MS));
    return days <= 1 ? '相遇之后不久' : `相遇之后第 ${days} 天`;
}

export function normalizeReflectionOptions(options?: Partial<TheaterReflectionOptions>): TheaterReflectionOptions {
    const mode: TheaterReflectionMode =
        options?.mode === 'letter' || options?.mode === 'crossroad' || options?.mode === 'reconcile' || options?.mode === 'moonlight'
            ? options.mode
            : DEFAULT_REFLECTION_OPTIONS.mode;
    const tone: TheaterReflectionTone =
        options?.tone === 'tender' || options?.tone === 'aching' || options?.tone === 'relieved' || options?.tone === 'restrained'
            ? options.tone
            : DEFAULT_REFLECTION_OPTIONS.tone;
    const length: TheaterReflectionLength =
        options?.length === 'short' || options?.length === 'long' || options?.length === 'standard'
            ? options.length
            : DEFAULT_REFLECTION_OPTIONS.length;
    const userSeed = cleanMultiline(options?.userSeed, 180);
    return { mode, tone, length, ...(userSeed ? { userSeed } : {}) };
}

export function reflectionOptionsLabel(options?: Partial<TheaterReflectionOptions>): string {
    const o = normalizeReflectionOptions(options);
    return `${REFLECTION_MODE_LABEL[o.mode]} · ${REFLECTION_TONE_LABEL[o.tone]} · ${REFLECTION_LENGTH_LABEL[o.length]}${o.userSeed ? ` · 引子：${o.userSeed}` : ''}`;
}

export function reflectionNodeSnapshot(node: TrajectoryNode, firstMetTs: number): TheaterReflectionNodeSnapshot {
    return {
        id: node.id,
        ts: node.ts,
        era: node.era,
        title: node.title,
        scene: node.scene,
        mood: node.mood,
        place: node.place,
        source: node.source,
        when: nodeWhen(node, firstMetTs),
    };
}

function describeNodeForPrompt(node: TrajectoryNode, firstMetTs: number): string {
    return [
        `时间：${nodeWhen(node, firstMetTs)}`,
        `标题：${node.title}`,
        `场景：${node.scene}`,
        node.mood ? `心情：${node.mood}` : '',
        node.place ? `地点：${node.place}` : '',
        node.beat ? `人生功能：${node.beat}` : '',
        node.object ? `代表物：${node.object}` : '',
        node.tags?.length ? `标签：${node.tags.join('、')}` : '',
    ].filter(Boolean).join('\n');
}

/** 节点细看：按需生成并缓存。 */
export async function ensureTrajectoryNodeDetail(
    trajectory: CharTrajectory,
    char: CharacterProfile,
    userName: string,
    nodeId: string,
    api: TimelineApi,
    opts: { force?: boolean } = {},
): Promise<{ trajectory: CharTrajectory; detail: TrajectoryNodeDetail }> {
    const node = trajectory.nodes.find(n => n.id === nodeId);
    if (!node) throw new Error('这一帧已经不在轨迹里了，先刷新轨迹再试。');
    const cached = trajectory.nodeDetails?.[nodeId];
    if (cached && !opts.force) return { trajectory, detail: cached };

    const prompt = trajectoryDetailPrompt({
        charName: char.name,
        userName,
        persona: buildPersona(char),
        nodeText: describeNodeForPrompt(node, trajectory.firstMetTs),
    });
    const raw = await callLLM(api, prompt, 0.88, 1800);
    const detail = sanitizeTrajectoryDetail(extractJson(raw), nodeId);
    if (!detail) throw new Error('这一帧没有显影出来，稍后再试一次。');
    const next = pruneTrajectoryCaches(trajectory, trajectory.nodes, {
        nodeDetails: { ...(trajectory.nodeDetails || {}), [nodeId]: detail },
    });
    await saveTrajectory(next);
    return { trajectory: next, detail };
}

/** 非正史分支：不会改主时间线，每个节点最多保留最近 5 条。 */
export async function generateTrajectoryBranch(
    trajectory: CharTrajectory,
    char: CharacterProfile,
    userName: string,
    nodeId: string,
    premise: string,
    api: TimelineApi,
): Promise<{ trajectory: CharTrajectory; branch: TrajectoryBranch }> {
    const node = trajectory.nodes.find(n => n.id === nodeId);
    if (!node) throw new Error('这一帧已经不在轨迹里了，先刷新轨迹再试。');
    const cleanPremise = clean(premise, 120);
    if (!cleanPremise) throw new Error('先写一句“如果那天……”的假设。');
    const prompt = trajectoryBranchPrompt({
        charName: char.name,
        userName,
        persona: buildPersona(char),
        nodeText: describeNodeForPrompt(node, trajectory.firstMetTs),
        premise: cleanPremise,
    });
    const raw = await callLLM(api, prompt, 0.94, 1900);
    const branch = sanitizeTrajectoryBranch(extractJson(raw), nodeId, cleanPremise);
    if (!branch) throw new Error('这条岔路没能生成出来，换个假设再试。');
    const list = [branch, ...(trajectory.branches?.[nodeId] || [])]
        .sort((a, b) => b.generatedAt - a.generatedAt)
        .slice(0, MAX_BRANCHES_PER_NODE);
    const next = pruneTrajectoryCaches(trajectory, trajectory.nodes, {
        branches: { ...(trajectory.branches || {}), [nodeId]: list },
    });
    await saveTrajectory(next);
    return { trajectory: next, branch };
}

/** 单节点重写：只允许改写 AI 生成的 before 节点，并清空该节点详情/分支。 */
export async function rewriteTrajectoryNode(
    trajectory: CharTrajectory,
    char: CharacterProfile,
    userName: string,
    nodeId: string,
    api: TimelineApi,
): Promise<{ trajectory: CharTrajectory; node: TrajectoryNode }> {
    const node = trajectory.nodes.find(n => n.id === nodeId);
    if (!node) throw new Error('这一帧已经不在轨迹里了，先刷新轨迹再试。');
    if (node.era !== 'before' || node.source !== 'generated') {
        throw new Error('只有相遇前由 AI 想象出来的片段可以重写；相遇日和真实生活事件会保留原样。');
    }
    const prompt = trajectoryRewriteNodePrompt({
        charName: char.name,
        userName,
        persona: buildPersona(char),
        nodeText: describeNodeForPrompt(node, trajectory.firstMetTs),
    });
    const raw = await callLLM(api, prompt, 0.96, 1800);
    const parsed = extractJson(raw);
    const replacement = normalizeNode({
        ...parsed,
        id: node.id,
        ts: node.ts,
        era: 'before',
        source: 'generated',
    }, trajectory.firstMetTs);
    if (!replacement) throw new Error('没能重写这一帧，稍后再试一次。');
    const nodes = trajectory.nodes
        .map(n => n.id === nodeId ? { ...replacement, id: node.id, ts: node.ts } : n)
        .sort((a, b) => a.ts - b.ts);
    const nextDetails = { ...(trajectory.nodeDetails || {}) };
    const nextBranches = { ...(trajectory.branches || {}) };
    delete nextDetails[nodeId];
    delete nextBranches[nodeId];
    const next = pruneTrajectoryCaches(trajectory, nodes, { nodeDetails: nextDetails, branches: nextBranches });
    await saveTrajectory(next);
    return { trajectory: next, node: next.nodes.find(n => n.id === nodeId)! };
}

/**
 * 对影：让两个时间里的同一个 TA 相逢对话。
 */
export function sanitizeReflectionLines(rawLines: any[], allowUser = false): ReflectionLine[] {
    return (Array.isArray(rawLines) ? rawLines : [])
        .map((l: any): ReflectionLine | null => {
            const text = cleanMultiline(l?.text, 320);
            if (!text) return null;
            const rawWho = l?.who;
            const who: ReflectionLine['who'] | null =
                rawWho === 'past' || rawWho === 'now' || rawWho === 'narration'
                    ? rawWho
                    : allowUser && rawWho === 'user'
                        ? 'user'
                        : null;
            if (!who) return null;
            const at = Number(l?.at);
            return { who, text, ...(Number.isFinite(at) && at > 0 ? { at } : {}) };
        })
        .filter((l: ReflectionLine | null): l is ReflectionLine => !!l);
}

export async function generateReflection(
    char: CharacterProfile,
    userName: string,
    nodeA: TrajectoryNode,
    nodeB: TrajectoryNode,
    firstMetTs: number,
    api: TimelineApi,
    options?: Partial<TheaterReflectionOptions>,
    details?: Record<string, TrajectoryNodeDetail>,
): Promise<ReflectionScene> {
    const [past, now] = nodeA.ts <= nodeB.ts ? [nodeA, nodeB] : [nodeB, nodeA];
    const persona = buildPersona(char);
    const reflectionOptions = normalizeReflectionOptions(options);
    const detailText = (n: TrajectoryNode) => {
        const d = details?.[n.id];
        return d ? `\n补充细节：${[d.stillFrame, d.innerMonologue, d.consequence].filter(Boolean).join(' / ')}` : '';
    };

    const prompt = reflectionPrompt({
        charName: char.name, userName, persona,
        pastWhen: nodeWhen(past, firstMetTs), pastTitle: past.title, pastScene: past.scene + detailText(past), pastMood: past.mood,
        nowWhen: nodeWhen(now, firstMetTs), nowTitle: now.title, nowScene: now.scene + detailText(now), nowMood: now.mood,
        ...reflectionOptions,
    });

    const raw = await callLLM(api, prompt, 0.95, 2600, 'theater.reflection');
    const parsed = extractJson(raw);
    const lines = sanitizeReflectionLines(parsed?.lines, false);

    if (!lines.length) throw new Error('对影没能生成出来，稍后再试一次。');

    return {
        title: clean(parsed?.title, 12, '对影'),
        subtitle: clean(parsed?.subtitle, 40, '举杯邀明月，对影成几人'),
        lines,
    };
}

export function makeReflectionSession(input: {
    char: CharacterProfile;
    userName: string;
    nodeA: TrajectoryNode;
    nodeB: TrajectoryNode;
    firstMetTs: number;
    scene: ReflectionScene;
    options?: Partial<TheaterReflectionOptions>;
    now?: number;
}): TheaterReflectionSession {
    const [past, nowNode] = input.nodeA.ts <= input.nodeB.ts ? [input.nodeA, input.nodeB] : [input.nodeB, input.nodeA];
    const now = input.now || Date.now();
    return {
        id: `reflection_${now}_${genId()}`,
        charId: input.char.id,
        charName: input.char.name,
        userName: input.userName,
        title: input.scene.title || '对影',
        subtitle: input.scene.subtitle,
        nodes: {
            past: reflectionNodeSnapshot(past, input.firstMetTs),
            now: reflectionNodeSnapshot(nowNode, input.firstMetTs),
        },
        options: normalizeReflectionOptions(input.options),
        initialScene: input.scene,
        continuationLines: [],
        createdAt: now,
        updatedAt: now,
    };
}

function formatReflectionHistory(session: TheaterReflectionSession, userName: string): string {
    const label = (line: ReflectionLine) => {
        if (line.who === 'past') return '过去的TA';
        if (line.who === 'now') return '此刻的TA';
        if (line.who === 'user') return userName;
        return '旁白';
    };
    return [...(session.initialScene.lines || []), ...(session.continuationLines || [])]
        .slice(-28)
        .map(line => `${label(line)}：${line.text}`)
        .join('\n');
}

export async function continueReflection(
    char: CharacterProfile,
    userName: string,
    session: TheaterReflectionSession,
    userMessage: string,
    api: TimelineApi,
): Promise<TheaterReflectionSession> {
    const text = cleanMultiline(userMessage, 420);
    if (!text) throw new Error('先写一句想对他们说的话。');
    const userLine: ReflectionLine = { who: 'user', text, at: Date.now() };
    const prompt = reflectionContinuePrompt({
        charName: char.name,
        userName,
        persona: buildPersona(char),
        title: session.title || session.initialScene.title || '对影',
        subtitle: session.subtitle || session.initialScene.subtitle,
        pastLabel: `${session.nodes.past.when} · ${session.nodes.past.title}`,
        nowLabel: `${session.nodes.now.when} · ${session.nodes.now.title}`,
        optionsText: reflectionOptionsLabel(session.options),
        history: formatReflectionHistory(session, userName),
        userMessage: text,
    });

    const raw = await callLLM(api, prompt, 0.92, 1400, 'theater.reflection');
    const parsed = extractJson(raw);
    const lines = sanitizeReflectionLines(parsed?.lines, false).slice(0, 6).map(line => ({ ...line, at: Date.now() }));
    if (!lines.length) throw new Error('这句话没有落进对影里，稍后再试一次。');
    return {
        ...session,
        continuationLines: [...(session.continuationLines || []), userLine, ...lines],
        updatedAt: Date.now(),
    };
}
