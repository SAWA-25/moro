/**
 * 折子戏·轨迹 & 对影 的共享数据层。
 *
 * 轨迹（Trajectory）：把角色「遇见你之前」的人生补成一条可回看的时间线——一个人不是从被看见
 *   的那一刻才开始存在的，在遇见你之前 TA 已经独自活过很久。时间线由三段组成：
 *     · before  —— LLM 想象出来的「相遇之前」的若干人生片段（持久化，不会每次乱变）
 *     · meeting —— 你走进 TA 人生的那一天（取最早一条真实聊天的时间）
 *     · after   —— 相遇之后 TA 真实经历过的自主生活事件（char_life_events）
 *
 * 对影（Reflection）：从轨迹里挑两个时间节点，让「同一个人、不同时间里的两个自己」相逢对话，
 *   照见 TA 一步步走到今天、也照见你确实让 TA 的命运偏离过原本的方向。复用轨迹的节点。
 *
 * 📌 prompt 文案集中在 utils/theaterPrompts.ts（[陆] 轨迹 / [柒] 对影 区段），改文案去那里。
 */

import { CharacterProfile } from '../types';
import { DB } from './db';
import { sanitizeLifeText } from './autonomousLife';
import { extractJson } from './safeApi';
import { trajectoryBeforePrompt, reflectionPrompt } from './theaterPrompts';

export interface TimelineApi {
    baseUrl: string;
    apiKey: string;
    model: string;
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
    source: 'generated' | 'firstMet' | 'lifeEvent';
}

export interface CharTrajectory {
    charId: string;
    generatedAt: number;
    /** 你走进 TA 人生的那天（最早一条真实聊天） */
    firstMetTs: number;
    nodes: TrajectoryNode[];
}

export interface ReflectionLine {
    who: 'past' | 'now' | 'narration';
    text: string;
}

export interface ReflectionScene {
    title: string;
    subtitle?: string;
    lines: ReflectionLine[];
}

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const ASSET_KEY = (charId: string) => `theater_trajectory_${charId}`;

const genId = () => Math.random().toString(36).slice(2, 10);

async function callLLM(api: TimelineApi, prompt: string, temperature = 0.92, maxTokens = 3200): Promise<string> {
    const res = await fetch(`${api.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${api.apiKey || 'sk-none'}` },
        body: JSON.stringify({
            model: api.model,
            messages: [{ role: 'user', content: prompt }],
            temperature,
            max_tokens: maxTokens,
            stream: false,
        }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    let json: any;
    try { json = JSON.parse(text); } catch { json = JSON.parse(text.replace(/^data:\s*/, '').trim()); }
    return String(json?.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
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

/** 你第一次走进 TA 的世界：取最早一条真实（非系统）聊天的时间，没有就退回 fallback。 */
export async function resolveFirstMet(charId: string, fallback: number): Promise<number> {
    try {
        const msgs = await DB.getMessagesByCharId(charId);
        // 用循环求最小值，别用 Math.min(...stamps)——消息可能上万条，展开会爆调用栈。
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

/** 读已持久化的轨迹（没有则返回 null）。 */
export async function loadTrajectory(charId: string): Promise<CharTrajectory | null> {
    try {
        const raw = await DB.getAsset(ASSET_KEY(charId));
        if (!raw) return null;
        const parsed = JSON.parse(raw) as CharTrajectory;
        if (parsed && Array.isArray(parsed.nodes) && parsed.nodes.length) return parsed;
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
        source: 'firstMet',
    };

    let afterNodes: TrajectoryNode[] = [];
    try {
        const events = await DB.getLifeEvents(charId);
        afterNodes = (events || [])
            .filter(e => e.timestamp > firstMetTs)
            .map(e => {
                const activity = sanitizeLifeText(e.activity) || e.activity || '';
                const summary = sanitizeLifeText(e.summary || '') || e.summary || '';
                return {
                    id: e.id,
                    ts: e.timestamp,
                    era: 'after' as const,
                    title: (activity || summary).slice(0, 14) || '某一天',
                    scene: summary || activity || '',
                    mood: e.mood,
                    place: e.location,
                    source: 'lifeEvent' as const,
                };
            });
    } catch { /* 没有自主生活事件也没关系 */ }

    return [...beforeNodes, meeting, ...afterNodes].sort((a, b) => a.ts - b.ts);
}

/**
 * 生成「相遇之前」的人生片段并落库。已存在则直接返回（除非 force）。
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
    try {
        const raw = await callLLM(api, prompt);
        const arr = extractJson(raw);
        if (Array.isArray(arr)) {
            beforeNodes = arr
                .map((it: any): TrajectoryNode | null => {
                    const yearsAgo = Math.max(0.1, Number(it?.yearsAgo) || 0);
                    const scene = String(it?.scene || '').trim();
                    if (!scene) return null;
                    // 钳制在相遇之前，并按 yearsAgo 反推时间戳
                    const ts = Math.min(firstMetTs - 1, firstMetTs - yearsAgo * YEAR_MS);
                    return {
                        id: genId(),
                        ts,
                        era: 'before',
                        title: String(it?.title || '').trim().slice(0, 16) || '那一年',
                        scene,
                        mood: it?.mood ? String(it.mood).trim().slice(0, 12) : undefined,
                        place: it?.place ? String(it.place).trim().slice(0, 16) : undefined,
                        source: 'generated',
                    };
                })
                .filter((n): n is TrajectoryNode => !!n)
                .sort((a, b) => a.ts - b.ts);
        }
    } catch (e) {
        throw new Error(`轨迹生成失败：${e instanceof Error ? e.message : String(e)}`);
    }

    if (!beforeNodes.length) throw new Error('没能从模型那里得到可用的轨迹片段，换个角色或稍后再试。');

    const nodes = await assembleNodes(char.id, userName, char.name, firstMetTs, beforeNodes);
    const trajectory: CharTrajectory = { charId: char.id, generatedAt: Date.now(), firstMetTs, nodes };
    try { await DB.saveAsset(ASSET_KEY(char.id), JSON.stringify(trajectory)); } catch { /* 落库失败不致命 */ }
    return trajectory;
}

/** 相遇之后真实事件可能增加，重新拼接 after 段（不重生成 before），保持时间线新鲜。 */
export async function refreshAfterNodes(
    trajectory: CharTrajectory,
    userName: string,
    charName: string,
): Promise<CharTrajectory> {
    const before = trajectory.nodes.filter(n => n.era === 'before');
    const nodes = await assembleNodes(trajectory.charId, userName, charName, trajectory.firstMetTs, before);
    const next = { ...trajectory, nodes };
    try { await DB.saveAsset(ASSET_KEY(trajectory.charId), JSON.stringify(next)); } catch { /* ignore */ }
    return next;
}

function nodeWhen(node: TrajectoryNode, firstMetTs: number): string {
    if (node.era === 'meeting') return '你们相遇的那天';
    if (node.era === 'before') {
        const years = (firstMetTs - node.ts) / YEAR_MS;
        if (years >= 1) return `相遇前约 ${Math.round(years)} 年`;
        const months = Math.max(1, Math.round((firstMetTs - node.ts) / (30 * 24 * 60 * 60 * 1000)));
        return `相遇前约 ${months} 个月`;
    }
    const days = Math.max(0, Math.round((node.ts - firstMetTs) / (24 * 60 * 60 * 1000)));
    return days <= 1 ? '相遇之后不久' : `相遇之后第 ${days} 天`;
}

/**
 * 对影：让两个时间里的同一个 TA 相逢对话。
 */
export async function generateReflection(
    char: CharacterProfile,
    userName: string,
    nodeA: TrajectoryNode,
    nodeB: TrajectoryNode,
    firstMetTs: number,
    api: TimelineApi,
): Promise<ReflectionScene> {
    // 约定 past = 更早的那个，now = 更晚的那个
    const [past, now] = nodeA.ts <= nodeB.ts ? [nodeA, nodeB] : [nodeB, nodeA];
    const persona = buildPersona(char);

    const prompt = reflectionPrompt({
        charName: char.name, userName, persona,
        pastWhen: nodeWhen(past, firstMetTs), pastTitle: past.title, pastScene: past.scene, pastMood: past.mood,
        nowWhen: nodeWhen(now, firstMetTs), nowTitle: now.title, nowScene: now.scene, nowMood: now.mood,
    });

    const raw = await callLLM(api, prompt, 0.95, 2600);
    const parsed = extractJson(raw);
    const rawLines: any[] = Array.isArray(parsed?.lines) ? parsed.lines : [];
    const lines: ReflectionLine[] = rawLines
        .map((l: any): ReflectionLine | null => {
            const text = String(l?.text || '').trim();
            if (!text) return null;
            const who: ReflectionLine['who'] = l?.who === 'now' ? 'now' : l?.who === 'narration' ? 'narration' : 'past';
            return { who, text };
        })
        .filter((l: ReflectionLine | null): l is ReflectionLine => !!l);

    if (!lines.length) throw new Error('对影没能生成出来，稍后再试一次。');

    return {
        title: String(parsed?.title || '对影').trim().slice(0, 12) || '对影',
        subtitle: parsed?.subtitle ? String(parsed.subtitle).trim().slice(0, 40) : '举杯邀明月，对影成几人',
        lines,
    };
}

export { nodeWhen };
