/**
 * 心意图谱 (MindMap) —— 记忆关联网络的自我图谱视图。
 *
 * 回答「char 怎样把两条相关 / 看似不相干的记忆联系到一起」：以一条记忆为中心（ego-graph），
 * 把和它直接相连的记忆摆在四周，边按关联类型上色（时间 / 情绪 / 因果 / 人物 / 隐喻），
 * 点任一邻居即可把焦点切过去，顺着网络一路走下去。下方还有一张「连接清单」，
 * 把每条边的类型、强度、连到哪条记忆讲清楚——尤其是「隐喻 / 因果」这类看似不相干的连法。
 *
 * 纯展示组件：数据（nodes / links）由 MemoryPalaceApp 加载后传入。
 */

import React from 'react';
import type { MemoryNode, MemoryRoom, LinkType } from '../../utils/memoryPalace';

export type MindMapLinkType = LinkType | 'event_box';

export interface MindMapEdge {
    id: string;
    sourceId: string;
    targetId: string;
    type: MindMapLinkType;
    strength: number;
    label?: string;
    how?: string;
}

interface MindMapProps {
    nodes: MemoryNode[];
    links: MindMapEdge[];
    focusId: string | null;
    onFocus: (id: string) => void;
    roomColors: Record<string, string>;
    roomLabel: (room: MemoryRoom) => string;
}

/** 关联类型 → 颜色 + 人话标签 + 一句"怎么连上的" */
const LINK_META: Record<MindMapLinkType, { color: string; label: string; how: string }> = {
    temporal: { color: '#6b7fa8', label: '时间', how: '前后脚发生，被你顺着时间线串在了一起' },
    emotional: { color: '#c98aa6', label: '情绪', how: '当时的心情很像，于是一想起这件就带出那件' },
    causal: { color: '#c2954e', label: '因果', how: '一件事牵出了另一件，你把来龙去脉接上了' },
    person: { color: '#4f9a87', label: '人物', how: '都绕着同一个人，于是归到了一处' },
    metaphor: { color: '#8a6cc0', label: '隐喻', how: '两件看似不相干的事，被一个相似的意象/感觉勾连起来' },
    event_box: { color: '#3f3f3f', label: '同一事件', how: '被收进同一个事件盒，说明它们属于同一段连续发生的事' },
};

const MAX_NEIGHBORS = 12;
const VIEW = 360;
const CENTER = VIEW / 2;
const RING = 132;

function snippet(s: string, n: number): string {
    const t = (s || '').replace(/\s+/g, ' ').trim();
    return t.length > n ? t.slice(0, n) + '…' : t;
}

const MindMap: React.FC<MindMapProps> = ({ nodes, links, focusId, onFocus, roomColors, roomLabel }) => {
    const nodeMap = React.useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);
    const focus = focusId ? nodeMap.get(focusId) || null : null;

    // 与焦点直接相连的边 + 对端节点，按强度降序，截断到 MAX_NEIGHBORS
    const neighbors = React.useMemo(() => {
        if (!focus) return [] as { link: MindMapEdge; node: MemoryNode }[];
        const out: { link: MindMapEdge; node: MemoryNode }[] = [];
        for (const l of links) {
            let otherId: string | null = null;
            if (l.sourceId === focus.id) otherId = l.targetId;
            else if (l.targetId === focus.id) otherId = l.sourceId;
            if (!otherId) continue;
            const node = nodeMap.get(otherId);
            if (node) out.push({ link: l, node });
        }
        out.sort((a, b) => b.link.strength - a.link.strength);
        return out;
    }, [focus, links, nodeMap]);

    const shown = neighbors.slice(0, MAX_NEIGHBORS);
    const hiddenCount = neighbors.length - shown.length;

    if (!focus) {
        return (
            <div style={{ textAlign: 'center', color: '#a2a2a2', padding: 48, fontSize: 13, lineHeight: 1.7 }}>
                还没有可展示的关联。<br />
                等记忆多起来、彼此之间生出联系（时间 / 情绪 / 因果 / 人物 / 隐喻），这里就会长出一张图谱。
            </div>
        );
    }

    const nodeR = (n: MemoryNode) => 5 + Math.min(8, Math.max(0, (n.importance || 5) - 1)) * 0.7;
    const positions = shown.map((_, i) => {
        const ang = (i / shown.length) * Math.PI * 2 - Math.PI / 2;
        return { x: CENTER + Math.cos(ang) * RING, y: CENTER + Math.sin(ang) * RING };
    });

    return (
        <div>
            {/* 图例 */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                {(Object.keys(LINK_META) as MindMapLinkType[]).map(t => (
                    <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#626262' }}>
                        <span style={{ width: 14, height: 2, background: LINK_META[t].color, display: 'inline-block' }} />
                        {LINK_META[t].label}
                    </span>
                ))}
            </div>

            {/* SVG ego-graph */}
            <div style={{ border: '2px solid #1a1a1a', background: '#fbfaf7', boxShadow: '3px 3px 0 #1a1a1a', marginBottom: 14 }}>
                <svg viewBox={`0 0 ${VIEW} ${VIEW}`} width="100%" style={{ display: 'block' }}>
                    {/* 边 */}
                    {shown.map((nb, i) => {
                        const p = positions[i];
                        const m = LINK_META[nb.link.type] || LINK_META.temporal;
                        return (
                            <line
                                key={nb.link.id}
                                x1={CENTER} y1={CENTER} x2={p.x} y2={p.y}
                                stroke={m.color}
                                strokeWidth={1 + nb.link.strength * 3}
                                strokeOpacity={0.85}
                            />
                        );
                    })}
                    {/* 邻居节点 */}
                    {shown.map((nb, i) => {
                        const p = positions[i];
                        const color = roomColors[nb.node.room] || '#9a9a9a';
                        return (
                            <g key={nb.node.id} style={{ cursor: 'pointer' }} onClick={() => onFocus(nb.node.id)}>
                                <circle cx={p.x} cy={p.y} r={nodeR(nb.node)} fill={color} stroke="#1a1a1a" strokeWidth={1.5} />
                                <text
                                    x={p.x} y={p.y + nodeR(nb.node) + 11}
                                    textAnchor="middle" fontSize={9} fill="#3a3a3a"
                                >{snippet(nb.node.content, 9)}</text>
                            </g>
                        );
                    })}
                    {/* 焦点节点 */}
                    <circle cx={CENTER} cy={CENTER} r={nodeR(focus) + 4} fill={roomColors[focus.room] || '#9a9a9a'} stroke="#1a1a1a" strokeWidth={2.5} />
                    <text x={CENTER} y={CENTER - nodeR(focus) - 9} textAnchor="middle" fontSize={10} fontWeight={700} fill="#1a1a1a">
                        {snippet(focus.content, 12)}
                    </text>
                </svg>
            </div>

            {/* 焦点卡片 */}
            <div style={{ border: '2px solid #1a1a1a', background: '#fff', padding: 12, marginBottom: 12 }}>
                <div style={{ fontSize: 10, color: '#9a9a9a', marginBottom: 4, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ color: roomColors[focus.room] || '#626262', fontWeight: 600 }}>{roomLabel(focus.room)}</span>
                    <span>重要性 {focus.importance}</span>
                    <span>{new Date(focus.createdAt).toLocaleDateString('zh-CN')}</span>
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.6 }}>{focus.content}</div>
                <div style={{ fontSize: 11, color: '#727272', marginTop: 8 }}>
                    {neighbors.length > 0
                        ? `和 ${neighbors.length} 条记忆连在一起${hiddenCount > 0 ? `（图上只画了最紧的 ${MAX_NEIGHBORS} 条）` : ''}：`
                        : '这条记忆暂时还没和别的连起来。'}
                </div>
            </div>

            {/* 连接清单：每条边怎么连上的 */}
            {neighbors.map(nb => {
                const m = LINK_META[nb.link.type] || LINK_META.temporal;
                return (
                    <div
                        key={nb.link.id}
                        onClick={() => onFocus(nb.node.id)}
                        style={{ border: '2px solid #1a1a1a', background: '#fafafa', padding: 10, marginBottom: 8, cursor: 'pointer' }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 10, fontWeight: 700, color: '#fff', background: m.color, padding: '1px 7px', borderRadius: 3 }}>{m.label}</span>
                            {/* 强度条 */}
                            <span style={{ display: 'inline-block', width: 48, height: 6, background: '#eee', border: '1px solid #cfcfcf', position: 'relative' }}>
                                <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.round(nb.link.strength * 100)}%`, background: m.color }} />
                            </span>
                            <span style={{ fontSize: 10, color: '#9a9a9a' }}>{nb.link.how || m.how}</span>
                        </div>
                        <div style={{ fontSize: 12, lineHeight: 1.5, color: '#2a2a2a' }}>{snippet(nb.node.content, 64)}</div>
                    </div>
                );
            })}
        </div>
    );
};

export default MindMap;
