import type { MemoryNode } from './types';
import type { LightLLMConfig } from './pipeline';
import { MemoryNodeDB } from './db';
import { callChatCompletion } from '../llmClient';
import { makeApiUsageMeta } from '../apiUsageCatalog';
import { safeParseJsonArray } from './jsonUtils';

export interface DreamDigestResult {
    status: 'done' | 'no_material' | 'llm_empty';
    created: number;
    stored: number;
    skipped: number;
    internalized: number;
    dreams: { content: string; layer: NonNullable<MemoryNode['cognitiveLayer']>; sourceIds: string[] }[];
}

function generateId(): string {
    return `mem_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function compactNode(n: MemoryNode, idx: number): string {
    const layer = n.cognitiveLayer || (n.origin === 'cognition' ? 'saga' : n.isBoxSummary ? 'episode_summary' : n.eventBoxId ? 'episode' : 'event');
    const flags = [
        n.resolved ? 'resolved' : '',
        n.internalized ? 'internalized' : '',
        n.highlight ? 'highlight' : '',
        n.protected ? 'protected' : '',
    ].filter(Boolean).join(',');
    return [
        `[M${idx}] id=${n.id}`,
        `layer=${layer}`,
        `room=${n.room}`,
        `importance=${n.importance}`,
        `mood=${n.mood}`,
        `access=${n.accessCount || 0}`,
        `activation=${n.activationCount || 0}`,
        flags ? `flags=${flags}` : '',
        `content=${n.content}`,
        n.sourceQuote ? `quote=${n.sourceQuote}` : '',
        n.genNote ? `aside=${n.genNote}` : '',
    ].filter(Boolean).join(' | ');
}

function pickDreamMaterial(nodes: MemoryNode[], limit: number): MemoryNode[] {
    const now = Date.now();
    return nodes
        .filter(n => !n.archived && !n.internalized && n.cognitiveLayer !== 'feel')
        .map(n => {
            const ageHours = Math.max(0, (now - (n.eventTime || n.createdAt || now)) / 3_600_000);
            const recency = 1 / (1 + ageHours / 168);
            const activation = Math.min(1, Math.log1p((n.activationCount || 0) + (n.accessCount || 0)) / 4);
            const unresolved = n.room === 'attic' || n.resolved === false ? 0.35 : 0;
            const emotion = Math.min(0.25, Math.abs(n.valence ?? 0) * 0.08 + Math.abs(n.arousal ?? 0) * 0.12);
            const importance = Math.max(1, Math.min(10, n.importance || 5)) / 10;
            const score = importance * 0.42 + activation * 0.25 + recency * 0.18 + unresolved + emotion;
            return { node: n, score };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(item => item.node);
}

function parseDreamItems(raw: unknown[], material: MemoryNode[]): Array<{
    content: string;
    layer: NonNullable<MemoryNode['cognitiveLayer']>;
    sourceIds: string[];
    tags: string[];
    mood: string;
    importance: number;
    valence?: number;
    arousal?: number;
}> {
    const byRef = new Map(material.map((n, i) => [`M${i}`, n]));
    const byId = new Map(material.map(n => [n.id, n]));
    return raw
        .map((item: any) => {
            const content = typeof item?.content === 'string' ? item.content.trim() : '';
            if (!content) return null;
            const layer: NonNullable<MemoryNode['cognitiveLayer']> = item.layer === 'saga' ? 'saga' : 'feel';
            const refs = Array.isArray(item.sourceRefs) ? item.sourceRefs : [];
            const sourceIds = refs
                .map((ref: any) => String(ref).trim())
                .map((ref: string) => byRef.get(ref)?.id || byId.get(ref)?.id || '')
                .filter(Boolean);
            if (sourceIds.length === 0) return null;
            const tags = Array.isArray(item.tags)
                ? item.tags.map((t: any) => String(t).trim()).filter(Boolean).slice(0, 6)
                : ['梦境消化'];
            const importance = Math.max(1, Math.min(10, Math.round(Number(item.importance) || 6)));
            const mood = typeof item.mood === 'string' && item.mood.trim() ? item.mood.trim() : 'reflective';
            const valence = typeof item.valence === 'number' ? Math.max(-1, Math.min(1, item.valence)) : undefined;
            const arousal = typeof item.arousal === 'number' ? Math.max(-1, Math.min(1, item.arousal)) : undefined;
            return { content: content.slice(0, 500), layer, sourceIds, tags, mood, importance, valence, arousal };
        })
        .filter((item): item is NonNullable<typeof item> => !!item)
        .slice(0, 6);
}

export async function runLocalDreamDigestion(
    charId: string,
    charName: string,
    charPersona: string,
    llmConfig: LightLLMConfig,
    userName?: string,
): Promise<DreamDigestResult> {
    const allNodes = await MemoryNodeDB.getByCharId(charId);
    const material = pickDreamMaterial(allNodes, 18);
    if (material.length === 0) {
        return { status: 'no_material', created: 0, stored: 0, skipped: 0, internalized: 0, dreams: [] };
    }

    const systemPrompt = `你是 ${charName}。你正在做一次本地的梦境消化，不是对话回复。

角色设定参考：
${charPersona.slice(0, 1200)}

你会看到一些已经发生过的记忆。请像睡前做梦、醒来后写下梦的残片一样，把它们沉淀成：
- feel：第一人称的感受层，不是事实复述，不参与普通事实召回。
- saga：极少量长期主线，只在多条记忆明显汇成关系、目标或自我理解时使用。

要求：
1. 输出严格 JSON 数组，不要 markdown。
2. 每条必须引用 sourceRefs，例如 ["M0","M3"]。
3. 不要编造新事实，只写这些记忆在 ${charName} 心里留下的形状。
4. content 用第一人称，短而有画面，不要像总结报告。
5. 最多输出 4 条 feel 和 1 条 saga；如果没什么可消化，输出 []。

格式：
[
  {
    "layer": "feel",
    "content": "我好像还把那句话攥在手心里，不疼了，但还温着。",
    "sourceRefs": ["M0", "M2"],
    "tags": ["梦境消化", "关系", "安心"],
    "mood": "tender",
    "importance": 6,
    "valence": 0.3,
    "arousal": -0.2
  }
]`;

    const userPrompt = `待消化记忆：\n${material.map(compactNode).join('\n')}`;
    const data = await callChatCompletion(llmConfig, {
        model: llmConfig.model,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
        ],
        temperature: 0.45,
        max_tokens: 4000,
        stream: false,
    }, {
        meta: makeApiUsageMeta('memoryPalace.dreamDigestion', { apiRole: 'aux', charName }),
    });

    const reply = data.choices?.[0]?.message?.content || '';
    const parsed = parseDreamItems(safeParseJsonArray(reply), material);
    if (parsed.length === 0) {
        return { status: 'llm_empty', created: 0, stored: 0, skipped: 0, internalized: 0, dreams: [] };
    }

    const now = Date.now();
    const sourceNodeById = new Map(allNodes.map(node => [node.id, node]));
    const nodes: MemoryNode[] = parsed.map(item => {
        const sourceNodes = item.sourceIds
            .map(id => sourceNodeById.get(id))
            .filter((node): node is MemoryNode => !!node);
        const sourceMessageIds = Array.from(new Set(sourceNodes.flatMap(node => node.sourceMessageIds || [])))
            .sort((a, b) => a - b);
        const sourceQuote = sourceNodes
            .map(node => node.sourceQuote || node.content)
            .filter(Boolean)
            .slice(0, 4)
            .join('\n---\n');

        return {
            id: generateId(),
            charId,
            content: item.content,
            room: item.layer === 'saga' ? 'self_room' : 'attic',
            tags: Array.from(new Set(['梦境消化', ...item.tags])),
            importance: item.importance,
            mood: item.mood,
            valence: item.valence,
            arousal: item.arousal,
            embedded: false,
            createdAt: now,
            lastAccessedAt: now,
            accessCount: 0,
            cognitiveLayer: item.layer,
            sourceId: item.sourceIds[0],
            sourceMessageIds: sourceMessageIds.length > 0 ? sourceMessageIds : undefined,
            sourceQuote: sourceQuote || undefined,
            eventTime: now,
            source: { kind: 'digestion', label: item.layer === 'saga' ? '梦境主线' : '梦境感受', refId: item.sourceIds.join(',') },
            origin: item.layer === 'saga' ? 'cognition' : 'digestion',
            modelValence: item.valence,
        };
    });

    for (const node of nodes) {
        await MemoryNodeDB.save(node);
    }

    const sourceIds = new Set(parsed.flatMap(item => item.sourceIds));
    let internalized = 0;
    for (const id of sourceIds) {
        const source = await MemoryNodeDB.getById(id);
        if (!source || source.protected || source.highlight) continue;
        source.internalized = true;
        source.resolved = source.resolved ?? true;
        await MemoryNodeDB.save(source);
        internalized++;
    }

    return {
        status: 'done',
        created: nodes.length,
        stored: nodes.length,
        skipped: 0,
        internalized,
        dreams: nodes.map(n => ({
            content: n.content,
            layer: n.cognitiveLayer || 'feel',
            sourceIds: parsed.find(item => item.content === n.content)?.sourceIds || [],
        })),
    };
}
