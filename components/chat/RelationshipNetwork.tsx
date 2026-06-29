import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CharacterProfile, RelationshipNetworkAutoSettings, RelationshipNetworkEdge, RelationshipNetworkMessage, RelationshipStage } from '../../types';
import {
    STAGE_DEFAULT_LABEL,
    STAGE_NETWORK_META,
    STAGE_DASHED,
    inferStageFromAffection,
} from '../../utils/relationship';
import {
    buildManualRelationshipEdge,
    buildRelationshipForwardCard,
    buildRelationshipNetworkFallbackEdges,
    generateCharPairInteraction,
    getRelationshipPerspective,
    makeDefaultRelationshipNetworkAutoSettings,
    makeRelationshipNpcId,
    maybeSummarizeRelationshipMessages,
    mergeRelationshipEdge,
    normalizeRelationshipNetworkSettings,
    organizeRelationshipNetwork,
    relationshipPairIds,
    relationshipPairKey,
    RELATIONSHIP_NETWORK_UPDATED_EVENT,
} from '../../utils/relationshipNetwork';
import { DB } from '../../utils/db';
import { resolveAuxApi } from '../../utils/auxApi';
import { useOS } from '../../context/OSContext';
import {
    ArrowLeft,
    ChatCircleDots,
    GearSix,
    Heart,
    MagicWand,
    PaperPlaneRight,
    PencilSimpleLine,
    Plus,
    Robot,
    ShareNetwork,
    UserPlus,
    UsersThree,
    X,
} from '@phosphor-icons/react';

interface NetNode {
    char: CharacterProfile;
    stage: RelationshipStage;
    affection: number;
    hasAffection: boolean;
    x: number;
    y: number;
    color: string;
    dashed: boolean;
}

interface Props {
    characters: CharacterProfile[];
    userName: string;
    userAvatar: string;
    onClose: () => void;
    onOpenChat: (charId: string) => void;
}

type SheetKind = 'none' | 'owner-picker' | 'target-picker' | 'relation-form' | 'settings';
type NodeKind = 'character' | 'npc';

interface NodeRef {
    id: string;
    kind: NodeKind;
    name: string;
    avatar?: string;
    description?: string;
    char?: CharacterProfile;
}

interface RelationFormState {
    ownerId: string;
    target?: NodeRef;
    pairKey?: string;
    name: string;
    label: string;
    note: string;
}

interface RelationView {
    edge: RelationshipNetworkEdge;
    pairKey: string;
    target: NodeRef;
    label: string;
    note: string;
    updatedAt: number;
}

const QUICK_RELATIONS = ['朋友', '知己', '暧昧', '恋人', '家人', '同事', '对手', '冷战', '熟人'];
const PANEL_INK = '#334155';
const PANEL_MUTED = '#7b8797';

const nameOf = (c: CharacterProfile): string => c.convoSettings?.remarkName?.trim() || c.name || '未命名角色';
const avatarOf = (c: CharacterProfile): string => c.convoSettings?.charAvatarOverride || c.avatar;
const stageOf = (c: CharacterProfile): RelationshipStage => c.relationship?.stage || inferStageFromAffection(c.affection);
const pairTitle = (a?: NodeRef, b?: NodeRef) => [a?.name, b?.name].filter(Boolean).join(' × ');
const initialsOf = (name?: string) => (name || '未').trim().slice(0, 1) || '未';
const profileSnippet = (c: CharacterProfile) => (
    c.description || c.systemPrompt || c.worldview || c.lifeProfile?.content || '点进编辑关系网'
).replace(/\s+/g, ' ').slice(0, 56);

const daysSince = (ts?: number): number | null => {
    if (!ts || !Number.isFinite(ts)) return null;
    const d = Math.floor((Date.now() - ts) / 86_400_000);
    return d >= 0 ? d + 1 : null;
};

const edgeColor = (edge: RelationshipNetworkEdge) => {
    if (edge.tension >= 62) return '#dc6477';
    if (edge.intimacy >= 70) return '#d8a5b7';
    if (edge.intimacy >= 48) return '#9c8fd6';
    return '#94a3b8';
};

const timeText = (ts?: number) => ts ? new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '暂无';

const AvatarNode: React.FC<{ node: NodeRef; size?: number; ring?: string }> = ({ node, size = 42, ring = '#e5e7eb' }) => {
    if (node.avatar) {
        return <img src={node.avatar} alt={node.name} className="rounded-full object-cover bg-white shrink-0" style={{ width: size, height: size, border: `2px solid ${ring}` }} />;
    }
    return (
        <div
            className="rounded-full flex items-center justify-center bg-white shrink-0"
            style={{ width: size, height: size, border: `2px solid ${ring}`, color: '#9c5e74', fontWeight: 900 }}
        >
            {initialsOf(node.name)}
        </div>
    );
};

const PanelSheet: React.FC<{
    title: string;
    kicker?: string;
    onClose: () => void;
    children: React.ReactNode;
}> = ({ title, kicker, onClose, children }) => (
    <div className="absolute inset-0 z-[80] bg-slate-950/28 backdrop-blur-[2px] flex items-end animate-fade-in" onClick={onClose}>
        <div
            className="w-full max-h-[84%] overflow-y-auto rounded-t-[24px] bg-[#fbfcff] shadow-2xl border-t border-white"
            onClick={e => e.stopPropagation()}
        >
            <div className="sticky top-0 z-10 bg-[#fbfcff]/95 backdrop-blur-md border-b border-slate-200/70 px-4 py-3">
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-2xl bg-white shadow-sm border border-slate-200 flex items-center justify-center text-[#9c5e74]">
                        <ShareNetwork size={18} weight="duotone" />
                    </div>
                    <div className="min-w-0">
                        {kicker && <div className="text-[10px] uppercase tracking-[0.22em] text-slate-400">{kicker}</div>}
                        <div className="text-[17px] font-black truncate" style={{ color: PANEL_INK }}>{title}</div>
                    </div>
                    <div className="flex-1" />
                    <button onClick={onClose} className="w-9 h-9 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-500 active:scale-95">
                        <X size={18} />
                    </button>
                </div>
            </div>
            <div className="px-4 pb-[calc(var(--safe-bottom)+1.25rem)] pt-4">{children}</div>
        </div>
    </div>
);

const RelationshipNetwork: React.FC<Props> = ({ characters, userName, userAvatar, onClose, onOpenChat }) => {
    const { apiConfig, auxApiConfig, userProfile, addToast, markUnread } = useOS();
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [edges, setEdges] = useState<RelationshipNetworkEdge[]>([]);
    const [selectedPairKey, setSelectedPairKey] = useState<string | null>(null);
    const [privatePairKey, setPrivatePairKey] = useState<string | null>(null);
    const [pairMessages, setPairMessages] = useState<RelationshipNetworkMessage[]>([]);
    const [settings, setSettings] = useState<RelationshipNetworkAutoSettings>(() => makeDefaultRelationshipNetworkAutoSettings());
    const [sheet, setSheet] = useState<SheetKind>('none');
    const [pickerOwnerId, setPickerOwnerId] = useState<string | null>(null);
    const [relationForm, setRelationForm] = useState<RelationFormState | null>(null);
    const [busy, setBusy] = useState<string | null>(null);

    const charById = useMemo(() => new Map(characters.map(c => [c.id, c])), [characters]);
    const charNode = useCallback((c: CharacterProfile): NodeRef => ({
        id: c.id,
        kind: 'character',
        name: nameOf(c),
        avatar: avatarOf(c),
        description: profileSnippet(c),
        char: c,
    }), []);

    const nodeForId = useCallback((id: string, edge?: RelationshipNetworkEdge): NodeRef => {
        const c = charById.get(id);
        if (c) return charNode(c);
        const meta = edge?.nodeMeta?.[id];
        return {
            id,
            kind: meta?.kind || 'npc',
            name: meta?.name || '未命名角色',
            avatar: meta?.avatar,
            description: meta?.description || '手动加入的非角色 NPC',
        };
    }, [charById, charNode]);

    const nodes = useMemo<NetNode[]>(() => {
        const sorted = [...characters].sort(
            (a, b) => STAGE_NETWORK_META[stageOf(b)].intimacy - STAGE_NETWORK_META[stageOf(a)].intimacy,
        );
        const n = sorted.length;
        const center = 50;
        const rNear = 18;
        const rFar = 40;
        return sorted.map((char, i) => {
            const stage = stageOf(char);
            const meta = STAGE_NETWORK_META[stage];
            const t = meta.intimacy / 7;
            const jitter = (i % 2 === 0 ? 1 : -1) * (n > 6 ? 2.4 : 0);
            const radius = Math.max(rNear, Math.min(rFar, rFar - t * (rFar - rNear) + jitter));
            const angle = (i / Math.max(n, 1)) * Math.PI * 2 - Math.PI / 2;
            return {
                char,
                stage,
                affection: typeof char.affection === 'number' ? char.affection : 50,
                hasAffection: typeof char.affection === 'number',
                x: center + radius * Math.cos(angle),
                y: center + radius * Math.sin(angle),
                color: meta.color,
                dashed: STAGE_DASHED.has(stage),
            };
        });
    }, [characters]);

    const nodeById = useMemo(() => new Map(nodes.map(n => [n.char.id, n])), [nodes]);
    const selected = useMemo(() => nodes.find(nd => nd.char.id === selectedId) || null, [nodes, selectedId]);

    const graphEdges = useMemo(() => {
        const valid = edges.filter(e => e.charIds.every(id => charById.has(id)));
        if (valid.length) return valid;
        return buildRelationshipNetworkFallbackEdges(characters);
    }, [edges, characters, charById]);

    const selectedEdge = useMemo(
        () => edges.find(e => e.pairKey === selectedPairKey) || graphEdges.find(e => e.pairKey === selectedPairKey) || null,
        [edges, graphEdges, selectedPairKey],
    );
    const privateEdge = useMemo(() => edges.find(e => e.pairKey === privatePairKey) || null, [edges, privatePairKey]);

    const selectedPairNodes = useMemo(() => {
        const edge = selectedEdge || privateEdge;
        if (!edge) return [] as NodeRef[];
        return edge.charIds.map(id => nodeForId(id, edge));
    }, [selectedEdge, privateEdge, nodeForId]);

    const pairCharacters = useCallback((pairKey: string | null): CharacterProfile[] => {
        if (!pairKey) return [];
        const ids = relationshipPairIds(pairKey);
        if (!ids) return [];
        return ids.map(id => charById.get(id)).filter(Boolean) as CharacterProfile[];
    }, [charById]);

    const relationViewsFor = useCallback((ownerId: string): RelationView[] => {
        return edges
            .map(edge => {
                if (!edge.charIds.includes(ownerId)) return null;
                const p = getRelationshipPerspective(edge, ownerId);
                if (!p?.targetId || p.targetId === ownerId) return null;
                return {
                    edge,
                    pairKey: edge.pairKey,
                    target: nodeForId(p.targetId, edge),
                    label: p.label || edge.label,
                    note: p.note || p.summary || edge.summary,
                    updatedAt: p.updatedAt || edge.updatedAt,
                } satisfies RelationView;
            })
            .filter(Boolean)
            .sort((a, b) => (b!.updatedAt || 0) - (a!.updatedAt || 0)) as RelationView[];
    }, [edges, nodeForId]);

    const loadData = useCallback(async () => {
        const [storedEdges, storedSettings] = await Promise.all([
            DB.getRelationshipNetworkEdges().catch(() => []),
            DB.getRelationshipNetworkAutoSettings().catch(() => undefined),
        ]);
        setEdges(storedEdges);
        setSettings(normalizeRelationshipNetworkSettings(storedSettings || makeDefaultRelationshipNetworkAutoSettings()));
    }, []);

    const loadPairMessages = useCallback(async (pairKey: string) => {
        const msgs = await DB.getRelationshipNetworkMessagesByPair(pairKey).catch(() => []);
        setPairMessages(msgs);
    }, []);

    useEffect(() => {
        void loadData();
        const onUpdate = () => {
            void loadData();
            if (privatePairKey) void loadPairMessages(privatePairKey);
        };
        window.addEventListener(RELATIONSHIP_NETWORK_UPDATED_EVENT, onUpdate);
        return () => window.removeEventListener(RELATIONSHIP_NETWORK_UPDATED_EVENT, onUpdate);
    }, [loadData, loadPairMessages, privatePairKey]);

    useEffect(() => {
        if (privatePairKey) void loadPairMessages(privatePairKey);
        else setPairMessages([]);
    }, [privatePairKey, loadPairMessages]);

    const openOwnerPicker = () => {
        setPickerOwnerId(null);
        setSheet('owner-picker');
    };

    const openTargetPicker = (ownerId: string) => {
        setPickerOwnerId(ownerId);
        setSheet('target-picker');
    };

    const openRelationForm = (ownerId: string, target?: NodeRef, edge?: RelationshipNetworkEdge) => {
        const perspective = edge ? getRelationshipPerspective(edge, ownerId) : null;
        setSelectedPairKey(null);
        setRelationForm({
            ownerId,
            target,
            pairKey: edge?.pairKey,
            name: target?.name || '',
            label: perspective?.label || '',
            note: perspective?.note || perspective?.summary || '',
        });
        setSheet('relation-form');
    };

    const saveForwardIfNeeded = useCallback(async (
        result: Awaited<ReturnType<typeof generateCharPairInteraction>>,
        a: CharacterProfile,
        b: CharacterProfile,
        edge: RelationshipNetworkEdge,
    ) => {
        if (!result.forward?.shouldForward || !result.forward.forwarderId) return false;
        const forwarder = result.forward.forwarderId === a.id ? a : b;
        const other = forwarder.id === a.id ? b : a;
        const selectedMessages = result.forward.excerptMessageIds?.length
            ? result.messages.filter(m => result.forward?.excerptMessageIds?.includes(m.id))
            : result.messages.slice(-Math.min(3, result.messages.length));
        if (!selectedMessages.length) return false;
        const card = buildRelationshipForwardCard({ forwarder, other, messages: selectedMessages, edge, partial: true });
        await DB.saveMessage({
            charId: forwarder.id,
            role: 'assistant',
            type: 'chat_forward',
            content: JSON.stringify(card),
            metadata: {
                relationshipNetworkForward: true,
                pairKey: edge.pairKey,
                forwardReason: result.forward.reason,
            },
        } as any);
        markUnread(forwarder.id, 1);
        addToast(`${nameOf(forwarder)} 转发了一段角色私聊给你`, 'success');
        return true;
    }, [addToast, markUnread]);

    const runOrganize = async () => {
        if (busy) {
            addToast('关系网正在处理上一项任务，请稍等一下', 'info');
            return;
        }
        if (characters.length < 1) {
            addToast('至少需要 1 位角色，才能根据设定整理关系', 'info');
            return;
        }
        setBusy('organize');
        try {
            const api = resolveAuxApi(auxApiConfig, apiConfig);
            const existing = await DB.getRelationshipNetworkEdges().catch(() => []);
            const existingByPair = new Map(existing.map(e => [e.pairKey, e]));
            const aiEdges = await organizeRelationshipNetwork({ characters, userProfile, api });
            const nextEdges = aiEdges.map(edge => {
                const old = existingByPair.get(edge.pairKey);
                if (!old) return edge;
                return {
                    ...edge,
                    nodeMeta: { ...(edge.nodeMeta || {}), ...(old.nodeMeta || {}) },
                    perspectives: Object.keys(old.perspectives || {}).length
                        ? { ...(edge.perspectives || {}), ...(old.perspectives || {}) }
                        : edge.perspectives,
                    privateChatSummary: old.privateChatSummary || edge.privateChatSummary,
                    createdAt: old.createdAt || edge.createdAt,
                };
            });
            const npcOrManualOnly = existing.filter(edge => !aiEdges.some(next => next.pairKey === edge.pairKey));
            await DB.saveRelationshipNetworkEdges([...nextEdges, ...npcOrManualOnly]);
            await loadData();
            window.dispatchEvent(new Event(RELATIONSHIP_NETWORK_UPDATED_EVENT));
            addToast(nextEdges.length > 0 ? `已整理 ${nextEdges.length} 条关系` : '没有生成新的关系；请确认已配置 API，或给角色设定补充亲友、组织、宿敌等关系线索', nextEdges.length > 0 ? 'success' : 'info');
        } catch (err: any) {
            addToast(`关系网整理失败：${err?.message || '未知错误'}`, 'error');
        } finally {
            setBusy(null);
        }
    };

    const runGenerate = async (pairKey: string, source: 'manual' | 'auto' = 'manual') => {
        if (busy) return;
        const chars = pairCharacters(pairKey);
        if (chars.length !== 2) {
            addToast('非角色 NPC 关系只记录关系，不生成私聊', 'info');
            return;
        }
        const [a, b] = chars;
        setBusy(pairKey);
        try {
            const api = resolveAuxApi(auxApiConfig, apiConfig);
            const storedEdge = await DB.getRelationshipNetworkEdgeByPair(pairKey);
            const edge = storedEdge || graphEdges.find(e => e.pairKey === pairKey);
            const allMessages = await DB.getRelationshipNetworkMessagesByPair(pairKey).catch(() => []);
            const compactedEdge = edge
                ? await maybeSummarizeRelationshipMessages({ edge, messages: allMessages, settings, api, names: [nameOf(a), nameOf(b)] })
                : edge;
            if (compactedEdge && compactedEdge !== edge) await DB.saveRelationshipNetworkEdge(compactedEdge);
            const recent = allMessages.slice(-settings.summaryKeepRaw);
            const result = await generateCharPairInteraction({ a, b, edge: compactedEdge || edge, recentMessages: recent, api, userProfile, source });
            await DB.saveRelationshipNetworkMessages(result.messages);
            const merged = mergeRelationshipEdge(compactedEdge || edge, a, b, result.edgePatch, source, Date.now());
            await DB.saveRelationshipNetworkEdge(merged);
            const forwarded = await saveForwardIfNeeded(result, a, b, merged);
            await loadData();
            await loadPairMessages(pairKey);
            window.dispatchEvent(new Event(RELATIONSHIP_NETWORK_UPDATED_EVENT));
            addToast(forwarded ? '已生成互动，并有角色转发了片段' : '已生成一段角色私聊', 'success');
        } catch (err: any) {
            addToast(`生成失败：${err?.message || '未知错误'}`, 'error');
        } finally {
            setBusy(null);
        }
    };

    const submitRelationForm = async () => {
        if (!relationForm) return;
        const owner = charById.get(relationForm.ownerId);
        if (!owner) return;
        const label = relationForm.label.trim();
        if (!label) {
            addToast('先写一个关系名称', 'info');
            return;
        }
        const targetName = (relationForm.target?.kind === 'character' ? relationForm.target.name : relationForm.name).trim();
        if (!targetName) {
            addToast('先写 NPC 名字', 'info');
            return;
        }
        const target: NodeRef = relationForm.target || {
            id: makeRelationshipNpcId(),
            kind: 'npc',
            name: targetName,
            description: relationForm.note.trim() || '手动加入的非角色 NPC',
        };
        const normalizedTarget = target.kind === 'character'
            ? target
            : { ...target, name: targetName, description: relationForm.note.trim() || target.description };
        const pairKey = relationshipPairKey(owner.id, normalizedTarget.id);
        const existing = await DB.getRelationshipNetworkEdgeByPair(relationForm.pairKey || pairKey).catch(() => undefined);
        const syncBothWays = normalizedTarget.kind === 'character'
            && !existing?.perspectives?.[owner.id]
            && !existing?.perspectives?.[normalizedTarget.id];
        const edge = buildManualRelationshipEdge({
            base: existing,
            owner: { id: owner.id, name: nameOf(owner), avatar: avatarOf(owner) },
            target: normalizedTarget,
            label,
            note: relationForm.note.trim(),
            syncBothWays,
        });
        await DB.saveRelationshipNetworkEdge(edge);
        await loadData();
        setSelectedId(owner.id);
        setRelationForm(null);
        setSheet('none');
        window.dispatchEvent(new Event(RELATIONSHIP_NETWORK_UPDATED_EVENT));
        addToast(existing ? '关系已更新' : '已加入关系网', 'success');
    };

    const saveSettings = async () => {
        const next = normalizeRelationshipNetworkSettings({
            ...settings,
            nextRunAt: settings.enabled ? Math.max(settings.nextRunAt || 0, Date.now() + settings.intervalMinutes * 60_000) : settings.nextRunAt,
            updatedAt: Date.now(),
        });
        await DB.saveRelationshipNetworkAutoSettings(next);
        setSettings(next);
        setSheet('none');
        window.dispatchEvent(new Event(RELATIONSHIP_NETWORK_UPDATED_EVENT));
        addToast('关系网后台生成设置已保存', 'success');
    };

    const updateSummarySettings = (patch: Partial<RelationshipNetworkAutoSettings>) => {
        const next = normalizeRelationshipNetworkSettings({ ...settings, ...patch, updatedAt: Date.now() });
        setSettings(next);
        void DB.saveRelationshipNetworkAutoSettings(next);
    };

    const toggleSelectedChar = (id: string) => {
        setSettings(prev => {
            const set = new Set(prev.selectedCharIds);
            if (set.has(id)) set.delete(id); else set.add(id);
            return { ...prev, selectedCharIds: Array.from(set), updatedAt: Date.now() };
        });
    };

    const renderGraph = () => (
        <div className="relative w-full max-w-[460px] mx-auto aspect-square">
            <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" className="absolute inset-0 w-full h-full">
                {[18, 29, 40].map(r => (
                    <circle key={r} cx={50} cy={50} r={r} fill="none" stroke="#00000008" strokeWidth={0.4} />
                ))}
                {nodes.map(nd => {
                    const active = nd.char.id === selectedId;
                    return (
                        <line
                            key={nd.char.id}
                            x1={50} y1={50} x2={nd.x} y2={nd.y}
                            stroke={nd.color}
                            strokeOpacity={selectedId && !active ? 0.16 : 0.42}
                            strokeWidth={0.5 + (nd.affection / 100) * 1.1}
                            strokeDasharray={nd.dashed ? '2 1.6' : undefined}
                            strokeLinecap="round"
                            pointerEvents="none"
                        />
                    );
                })}
                {graphEdges.map(edge => {
                    const a = nodeById.get(edge.charIds[0]);
                    const b = nodeById.get(edge.charIds[1]);
                    if (!a || !b) return null;
                    const active = selectedPairKey === edge.pairKey || privatePairKey === edge.pairKey;
                    return (
                        <line
                            key={edge.pairKey}
                            x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                            stroke={edgeColor(edge)}
                            strokeOpacity={active ? 0.88 : 0.34}
                            strokeWidth={active ? 1.9 : Math.max(0.8, (edge.intimacy + edge.confidence) / 95)}
                            strokeLinecap="round"
                            strokeDasharray={edge.tension >= 55 ? '2.4 1.6' : undefined}
                            className="cursor-pointer"
                            onClick={() => { setSelectedPairKey(edge.pairKey); setSelectedId(null); }}
                        />
                    );
                })}
            </svg>

            {nodes.map(nd => {
                const active = nd.char.id === selectedId;
                return (
                    <button
                        key={nd.char.id}
                        onClick={() => { setSelectedId(active ? null : nd.char.id); setSelectedPairKey(null); }}
                        className="absolute flex flex-col items-center gap-0.5 transition-transform active:scale-95"
                        style={{
                            left: `${nd.x}%`,
                            top: `${nd.y}%`,
                            transform: 'translate(-50%, -50%)',
                            opacity: (selectedId && !active) || (selectedPairKey && !selectedPairNodes.some(c => c.id === nd.char.id)) ? 0.5 : 1,
                            zIndex: active ? 20 : 10,
                        }}
                    >
                        <img
                            src={avatarOf(nd.char)}
                            alt={nameOf(nd.char)}
                            className="w-11 h-11 rounded-full object-cover bg-white"
                            style={{
                                border: `2.5px solid ${nd.color}`,
                                boxShadow: active ? `0 0 0 4px ${nd.color}33, 0 6px 14px rgba(0,0,0,0.16)` : '0 2px 6px rgba(0,0,0,0.12)',
                            }}
                        />
                        <span className="text-[10px] font-semibold text-slate-600 max-w-[64px] truncate leading-tight px-1 rounded bg-white/70 backdrop-blur-sm">
                            {nameOf(nd.char)}
                        </span>
                    </button>
                );
            })}

            <div className="absolute flex flex-col items-center gap-0.5 pointer-events-none" style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)', zIndex: 15 }}>
                <img src={userAvatar} alt={userName} className="w-14 h-14 rounded-full object-cover border-[3px] border-white bg-slate-100" style={{ boxShadow: '0 4px 16px rgba(0,0,0,0.18)' }} />
                <span className="text-[11px] font-bold text-[#5a3140] max-w-[80px] truncate px-1.5 rounded-full bg-white/80 backdrop-blur-sm">
                    {userName || '我'}
                </span>
            </div>
        </div>
    );

    const renderRelationDock = () => {
        if (!selected) return (
            <div className="max-w-[460px] mx-auto mt-4 rounded-[22px] bg-white border border-slate-100 shadow-sm px-4 py-3">
                <div className="flex items-center gap-2 text-[12px] text-slate-500">
                    <ShareNetwork size={17} weight="duotone" className="text-[#9c5e74]" />
                    选择图上的角色后，可以给 TA 添加角色关系或 NPC 关系。
                </div>
            </div>
        );
        const relations = relationViewsFor(selected.char.id);
        return (
            <div className="max-w-[460px] mx-auto mt-4 rounded-[24px] bg-white shadow-lg shadow-slate-200/60 border border-slate-100 overflow-hidden">
                <div className="p-4">
                    <div className="flex items-center gap-3">
                        <img src={avatarOf(selected.char)} className="w-13 h-13 rounded-full object-cover" style={{ width: 52, height: 52, border: `2.5px solid ${selected.color}` }} />
                        <div className="min-w-0 flex-1">
                            <div className="font-black text-slate-800 truncate">{nameOf(selected.char)}</div>
                            <div className="mt-1 text-[11px] text-slate-400 truncate">
                                {relations.length ? `${relations.length} 条视角关系` : '还没有手写关系'}
                            </div>
                        </div>
                        <button onClick={() => openTargetPicker(selected.char.id)} className="px-3 h-9 rounded-full bg-[#fff4f7] text-[#9c5e74] border border-[#f0d9e2] text-xs font-black flex items-center gap-1 active:scale-95">
                            <Plus size={15} weight="bold" /> 加关系
                        </button>
                    </div>
                    <div className="mt-3">
                        <div className="flex items-center justify-between text-[11px] mb-1">
                            <span className="text-slate-400 flex items-center gap-1"><Heart size={12} weight="fill" className="text-pink-400" />好感</span>
                            <span className="font-bold tabular-nums" style={{ color: selected.color }}>
                                {selected.hasAffection ? selected.affection : '-'}<span className="text-slate-300 font-normal"> / 100</span>
                            </span>
                        </div>
                        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                            <div className="h-full rounded-full transition-all" style={{ width: `${selected.affection}%`, background: selected.color }} />
                        </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
                        {(() => {
                            const d = daysSince(selected.char.relationship?.since);
                            return d != null && STAGE_NETWORK_META[selected.stage].intimacy >= 5 ? <span>在一起 <b className="text-slate-700">{d}</b> 天</span> : null;
                        })()}
                        {selected.char.currentMood?.label && <span>当前心情 {selected.char.currentMood.emoji || ''}<b className="text-slate-700">{selected.char.currentMood.label}</b></span>}
                    </div>
                    {relations.length > 0 && (
                        <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
                            {relations.map(rel => (
                                <button
                                    key={rel.pairKey}
                                    onClick={() => setSelectedPairKey(rel.pairKey)}
                                    className="shrink-0 max-w-[190px] rounded-2xl border border-slate-100 bg-slate-50/80 px-3 py-2 text-left active:scale-[0.98]"
                                >
                                    <div className="flex items-center gap-2">
                                        <AvatarNode node={rel.target} size={28} ring="#fff" />
                                        <div className="min-w-0">
                                            <div className="text-[12px] font-black text-slate-700 truncate">{rel.target.name}</div>
                                            <div className="text-[10px] text-slate-400 truncate">{rel.label}</div>
                                        </div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                    <button onClick={() => onOpenChat(selected.char.id)} className="mt-4 w-full py-3 bg-[#d8a5b7] text-white font-bold rounded-2xl shadow-lg shadow-rose-100/70 active:scale-[0.98] transition-transform flex items-center justify-center gap-2">
                        <ChatCircleDots size={18} weight="fill" />
                        进入聊天
                    </button>
                </div>
            </div>
        );
    };

    const renderOwnerPicker = () => (
        <PanelSheet title="选择关系视角" kicker="Start From" onClose={() => setSheet('none')}>
            <div className="grid gap-2">
                {characters.map(c => {
                    const node = charNode(c);
                    return (
                        <button
                            key={c.id}
                            onClick={() => openTargetPicker(c.id)}
                            className="w-full rounded-2xl bg-white border border-slate-200 px-3 py-3 flex items-center gap-3 text-left active:scale-[0.99]"
                        >
                            <AvatarNode node={node} size={42} ring="#f1dbe5" />
                            <div className="min-w-0 flex-1">
                                <div className="text-sm font-black truncate" style={{ color: PANEL_INK }}>{node.name}</div>
                                <div className="text-[11px] truncate" style={{ color: PANEL_MUTED }}>{node.description}</div>
                            </div>
                        </button>
                    );
                })}
            </div>
        </PanelSheet>
    );

    const renderTargetPicker = () => {
        const owner = pickerOwnerId ? charById.get(pickerOwnerId) : selected?.char;
        if (!owner) return null;
        return (
            <PanelSheet title={`给 ${nameOf(owner)} 连一条关系`} kicker="Link Target" onClose={() => setSheet('none')}>
                <button
                    onClick={() => openRelationForm(owner.id)}
                    className="w-full rounded-2xl bg-[#fff4f7] border border-[#f0d9e2] px-3 py-3 flex items-center gap-3 text-left active:scale-[0.99]"
                >
                    <div className="w-11 h-11 rounded-full bg-white flex items-center justify-center text-[#9c5e74]"><UserPlus size={22} weight="bold" /></div>
                    <div className="min-w-0 flex-1">
                        <div className="text-sm font-black text-[#5a3140]">手动添加 NPC</div>
                        <div className="text-[11px] text-[#9c5e74]/70 truncate">同事、家人、路人、对手，不需要在剪影集建卡</div>
                    </div>
                </button>
                <div className="mt-3 grid gap-2">
                    {characters.filter(c => c.id !== owner.id).map(c => {
                        const node = charNode(c);
                        const pairKey = relationshipPairKey(owner.id, c.id);
                        return (
                            <button
                                key={c.id}
                                onClick={() => openRelationForm(owner.id, node, edges.find(e => e.pairKey === pairKey))}
                                className="w-full rounded-2xl bg-white border border-slate-200 px-3 py-3 flex items-center gap-3 text-left active:scale-[0.99]"
                            >
                                <AvatarNode node={node} size={42} ring="#e6e8f0" />
                                <div className="min-w-0 flex-1">
                                    <div className="text-sm font-black truncate" style={{ color: PANEL_INK }}>{node.name}</div>
                                    <div className="text-[11px] truncate" style={{ color: PANEL_MUTED }}>{node.description}</div>
                                </div>
                            </button>
                        );
                    })}
                </div>
            </PanelSheet>
        );
    };

    const renderRelationForm = () => {
        if (!relationForm) return null;
        const owner = charById.get(relationForm.ownerId);
        if (!owner) return null;
        const targetIsCharacter = relationForm.target?.kind === 'character';
        return (
            <PanelSheet title="写一条关系" kicker={nameOf(owner)} onClose={() => { setRelationForm(null); setSheet('none'); }}>
                <div className="rounded-3xl bg-white border border-slate-200 p-4">
                    <div className="flex items-center gap-3 mb-4">
                        <AvatarNode node={charNode(owner)} size={44} ring="#f1dbe5" />
                        <div className="text-sm font-black text-slate-500">看向</div>
                        {relationForm.target ? <AvatarNode node={relationForm.target} size={44} ring="#dbeafe" /> : <div className="w-11 h-11 rounded-full bg-slate-100 flex items-center justify-center text-slate-400"><UserPlus size={20} /></div>}
                    </div>
                    <label className="block">
                        <div className="text-[11px] font-black text-slate-400 mb-1">对象名字</div>
                        <input
                            value={targetIsCharacter ? relationForm.target?.name || '' : relationForm.name}
                            disabled={targetIsCharacter}
                            onChange={e => setRelationForm(prev => prev ? { ...prev, name: e.target.value } : prev)}
                            placeholder="NPC 名字"
                            className="w-full h-12 px-3 rounded-2xl border border-slate-200 bg-white outline-none text-sm font-bold disabled:bg-slate-50"
                            style={{ color: PANEL_INK }}
                        />
                    </label>
                    <label className="block mt-3">
                        <div className="text-[11px] font-black text-slate-400 mb-1">关系名称</div>
                        <input
                            value={relationForm.label}
                            onChange={e => setRelationForm(prev => prev ? { ...prev, label: e.target.value } : prev)}
                            placeholder="如 闺蜜、上司、死对头"
                            className="w-full h-12 px-3 rounded-2xl border border-slate-200 bg-white outline-none text-sm font-bold"
                            style={{ color: PANEL_INK }}
                        />
                    </label>
                    <div className="mt-3 flex flex-wrap gap-2">
                        {QUICK_RELATIONS.map(label => (
                            <button
                                key={label}
                                onClick={() => setRelationForm(prev => prev ? { ...prev, label } : prev)}
                                className="px-3 h-8 rounded-full border text-[12px] font-bold active:scale-95"
                                style={{
                                    borderColor: relationForm.label === label ? '#d8a5b7' : '#e2e8f0',
                                    background: relationForm.label === label ? '#fff4f7' : '#fff',
                                    color: relationForm.label === label ? '#9c5e74' : PANEL_MUTED,
                                }}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                    <label className="block mt-3">
                        <div className="text-[11px] font-black text-slate-400 mb-1">补充说明</div>
                        <textarea
                            value={relationForm.note}
                            onChange={e => setRelationForm(prev => prev ? { ...prev, note: e.target.value } : prev)}
                            placeholder="可选。写清楚渊源、距离感、旧账或称呼习惯。"
                            className="w-full h-24 px-3 py-3 rounded-2xl border border-slate-200 bg-white outline-none text-sm resize-none"
                            style={{ color: PANEL_INK }}
                        />
                    </label>
                    <button onClick={submitRelationForm} className="mt-4 w-full h-12 rounded-2xl bg-slate-900 text-white text-sm font-black active:scale-[0.98]">
                        {relationForm.pairKey ? '保存这条关系' : '加入关系网'}
                    </button>
                </div>
            </PanelSheet>
        );
    };

    const renderPairSheet = () => {
        if (!selectedEdge || selectedPairNodes.length !== 2) return null;
        const ownerId = selectedId && selectedEdge.charIds.includes(selectedId) ? selectedId : selectedPairNodes.find(n => n.kind === 'character')?.id || selectedPairNodes[0].id;
        const perspective = getRelationshipPerspective(selectedEdge, ownerId);
        const target = perspective?.targetId ? nodeForId(perspective.targetId, selectedEdge) : selectedPairNodes.find(n => n.id !== ownerId) || selectedPairNodes[1];
        const canChat = pairCharacters(selectedEdge.pairKey).length === 2;
        return (
            <PanelSheet title={pairTitle(selectedPairNodes[0], selectedPairNodes[1]) || '关系详情'} kicker={selectedEdge.label} onClose={() => setSelectedPairKey(null)}>
                <div className="rounded-3xl bg-white border border-slate-200 p-4">
                    <div className="flex items-center gap-3">
                        <div className="flex -space-x-2">
                            {selectedPairNodes.map(n => <AvatarNode key={n.id} node={n} size={44} ring="#fff" />)}
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="text-sm font-black truncate" style={{ color: PANEL_INK }}>{perspective?.label || selectedEdge.label}</div>
                            <div className="text-[11px] truncate" style={{ color: PANEL_MUTED }}>上次互动 {timeText(selectedEdge.lastInteractionAt)}</div>
                        </div>
                    </div>
                    <p className="mt-3 text-[13px] leading-relaxed whitespace-pre-wrap" style={{ color: PANEL_MUTED }}>
                        {perspective?.note || perspective?.summary || selectedEdge.summary}
                    </p>
                    {selectedEdge.privateChatSummary?.text && (
                        <div className="mt-3 rounded-2xl bg-slate-50 border border-slate-100 p-3 text-[12px] leading-relaxed text-slate-500">
                            <b className="text-slate-600">早期私聊摘要：</b>{selectedEdge.privateChatSummary.text}
                        </div>
                    )}
                    <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                        <div className="rounded-2xl bg-rose-50 py-2"><div className="text-[10px] text-slate-400">亲密</div><b className="text-rose-500">{selectedEdge.intimacy}</b></div>
                        <div className="rounded-2xl bg-amber-50 py-2"><div className="text-[10px] text-slate-400">张力</div><b className="text-amber-500">{selectedEdge.tension}</b></div>
                        <div className="rounded-2xl bg-slate-50 py-2"><div className="text-[10px] text-slate-400">把握</div><b className="text-slate-600">{selectedEdge.confidence}</b></div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                        <button
                            onClick={() => {
                                const owner = charById.get(ownerId);
                                if (owner) openRelationForm(owner.id, target, selectedEdge);
                            }}
                            className="py-2.5 rounded-2xl bg-white border border-slate-200 text-slate-700 text-xs font-black flex items-center justify-center gap-1"
                        >
                            <PencilSimpleLine size={16} /> 编辑视角
                        </button>
                        <button
                            onClick={() => canChat ? setPrivatePairKey(selectedEdge.pairKey) : addToast('非角色 NPC 没有私聊记录', 'info')}
                            className="py-2.5 rounded-2xl bg-slate-900 text-white text-xs font-black flex items-center justify-center gap-1"
                        >
                            <UsersThree size={16} weight="bold" /> 查看私聊
                        </button>
                        <button
                            onClick={() => runGenerate(selectedEdge.pairKey)}
                            disabled={!canChat || !!busy}
                            className="col-span-2 py-2.5 rounded-2xl bg-[#d8a5b7] text-white text-xs font-black flex items-center justify-center gap-1 disabled:opacity-50"
                        >
                            <Robot size={16} weight="bold" /> {busy === selectedEdge.pairKey ? '生成中' : '生成一段'}
                        </button>
                    </div>
                </div>
            </PanelSheet>
        );
    };

    const renderPrivateChat = () => {
        const edge = privateEdge;
        const chars = pairCharacters(privatePairKey);
        if (!privatePairKey || !edge || chars.length !== 2) return null;
        return (
            <div className="absolute inset-0 z-[90] bg-[#f6f6f6] flex flex-col animate-fade-in">
                <div className="shrink-0 bg-white border-b border-slate-100">
                    <div className="bg-transparent" style={{ height: 'var(--safe-top)' }} />
                    <div className="h-14 px-4 flex items-center gap-3">
                        <button onClick={() => setPrivatePairKey(null)} className="p-2 -ml-2 rounded-full hover:bg-slate-100"><ArrowLeft size={21} /></button>
                        <div className="flex -space-x-2">
                            {chars.map(c => <AvatarNode key={c.id} node={charNode(c)} size={34} ring="#fff" />)}
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="text-sm font-black truncate">{chars.map(nameOf).join(' × ')}</div>
                            <div className="text-[10px] text-slate-400 truncate">{edge.label}</div>
                        </div>
                        <button onClick={() => runGenerate(privatePairKey)} disabled={!!busy} className="px-3 py-2 rounded-full bg-[#d8a5b7] text-white text-xs font-black disabled:opacity-50">
                            {busy === privatePairKey ? '生成中' : '生成'}
                        </button>
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
                    {edge.privateChatSummary?.text && (
                        <div className="mx-auto max-w-[86%] rounded-2xl bg-white border border-slate-100 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
                            {edge.privateChatSummary.text}
                        </div>
                    )}
                    {pairMessages.length === 0 && (
                        <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-2">
                            <ChatCircleDots size={34} weight="thin" />
                            <p className="text-xs">还没有角色间私聊，点右上角生成一段。</p>
                        </div>
                    )}
                    {pairMessages.map(m => {
                        const speaker = charById.get(m.speakerId);
                        const alignRight = m.speakerId === chars[1]?.id;
                        return (
                            <div key={m.id} className={`flex gap-2 ${alignRight ? 'justify-end' : 'justify-start'}`}>
                                {!alignRight && <AvatarNode node={speaker ? charNode(speaker) : { id: m.speakerId, kind: 'npc', name: m.speakerName }} size={32} ring="#fff" />}
                                <div className={`max-w-[78%] ${alignRight ? 'items-end' : 'items-start'} flex flex-col`}>
                                    <div className="text-[10px] text-slate-400 mb-1 px-1">{m.speakerName} · {timeText(m.createdAt)}</div>
                                    <div className={`px-3 py-2.5 rounded-2xl text-[13px] leading-relaxed whitespace-pre-wrap break-words ${alignRight ? 'bg-[#d8a5b7] text-white rounded-br-sm' : 'bg-white text-slate-700 rounded-bl-sm border border-slate-100'}`}>
                                        {m.content}
                                    </div>
                                </div>
                                {alignRight && <AvatarNode node={speaker ? charNode(speaker) : { id: m.speakerId, kind: 'npc', name: m.speakerName }} size={32} ring="#fff" />}
                            </div>
                        );
                    })}
                </div>
                <div className="shrink-0 px-4 pb-[calc(var(--safe-bottom)+0.75rem)] pt-2 bg-white border-t border-slate-100">
                    <button onClick={() => runGenerate(privatePairKey)} disabled={!!busy} className="w-full py-3 rounded-2xl bg-slate-900 text-white text-sm font-black flex items-center justify-center gap-2 disabled:opacity-50">
                        <PaperPlaneRight size={18} weight="fill" />
                        手动生成一段
                    </button>
                </div>
            </div>
        );
    };

    const renderSettings = () => (
        <PanelSheet title="后台与摘要" kicker="Automation" onClose={() => setSheet('none')}>
            <label className="flex items-center justify-between rounded-2xl bg-white border border-slate-200 px-3 py-3">
                <span className="text-sm font-bold text-slate-700">开启后台互动</span>
                <input type="checkbox" checked={settings.enabled} onChange={e => setSettings(prev => ({ ...prev, enabled: e.target.checked }))} />
            </label>
            <div className="mt-3 grid grid-cols-3 gap-2">
                {[
                    ['间隔', 'intervalMinutes'],
                    ['单人冷却', 'charCooldownMinutes'],
                    ['两人冷却', 'pairCooldownMinutes'],
                ].map(([label, key]) => (
                    <label key={key} className="rounded-2xl bg-white border border-slate-200 px-3 py-2">
                        <div className="text-[10px] text-slate-400 mb-1">{label}</div>
                        <input
                            type="number"
                            min={5}
                            value={(settings as any)[key]}
                            onChange={e => setSettings(prev => ({ ...prev, [key]: Number(e.target.value) }))}
                            className="w-full bg-transparent outline-none text-sm font-black text-slate-700"
                        />
                    </label>
                ))}
            </div>
            <div className="mt-4 rounded-2xl bg-white border border-slate-200 px-3 py-3">
                <div className="text-[12px] font-black text-slate-600 mb-2">关系私聊摘要</div>
                <div className="grid grid-cols-2 gap-2">
                    <label className="rounded-2xl bg-slate-50 px-3 py-2">
                        <div className="text-[10px] text-slate-400 mb-1">满几条压缩</div>
                        <input
                            type="number"
                            min={12}
                            value={settings.summaryCompressAfter}
                            onChange={e => updateSummarySettings({ summaryCompressAfter: Number(e.target.value) })}
                            className="w-full bg-transparent outline-none text-sm font-black text-slate-700"
                        />
                    </label>
                    <label className="rounded-2xl bg-slate-50 px-3 py-2">
                        <div className="text-[10px] text-slate-400 mb-1">保留原文</div>
                        <input
                            type="number"
                            min={6}
                            value={settings.summaryKeepRaw}
                            onChange={e => updateSummarySettings({ summaryKeepRaw: Number(e.target.value) })}
                            className="w-full bg-transparent outline-none text-sm font-black text-slate-700"
                        />
                    </label>
                </div>
                <div className="mt-2 text-[11px] leading-relaxed text-slate-400">生成新私聊前会压缩早期记录，完整原文仍保存在关系网里。</div>
            </div>
            <div className="mt-4">
                <div className="text-[11px] font-black text-slate-400 mb-2">勾选会主动找人的角色</div>
                <div className="space-y-2">
                    {characters.map(c => (
                        <label key={c.id} className="flex items-center gap-3 rounded-2xl bg-white border border-slate-200 px-3 py-2">
                            <AvatarNode node={charNode(c)} size={36} ring="#f1dbe5" />
                            <span className="flex-1 text-sm font-bold text-slate-700 truncate">{nameOf(c)}</span>
                            <input type="checkbox" checked={settings.selectedCharIds.includes(c.id)} onChange={() => toggleSelectedChar(c.id)} />
                        </label>
                    ))}
                </div>
            </div>
            <button onClick={saveSettings} className="mt-4 w-full py-3 rounded-2xl bg-[#d8a5b7] text-white text-sm font-black">
                保存设置
            </button>
        </PanelSheet>
    );

    const headerActions = (
        <>
            <button
                onClick={runOrganize}
                aria-disabled={!!busy || characters.length < 1}
                className={`px-3 py-2 rounded-full bg-[#fff4f7] text-[#9c5e74] text-xs font-bold border border-[#f0d9e2] flex items-center gap-1 ${busy || characters.length < 1 ? 'opacity-60' : ''}`}
                title={characters.length < 1 ? '至少需要 1 位角色' : 'AI 根据角色设定整理关系'}
            >
                <MagicWand size={15} weight="bold" />
                {busy === 'organize' ? '整理中' : 'AI整理'}
            </button>
            <button
                onClick={openOwnerPicker}
                className="p-2 rounded-full bg-[#fff4f7] text-[#9c5e74] border border-[#f0d9e2]"
                title="添加关系"
            >
                <Plus size={18} weight="bold" />
            </button>
            <button
                onClick={() => setSheet('settings')}
                className="p-2 rounded-full bg-[#fff4f7] text-[#9c5e74] border border-[#f0d9e2]"
                title="后台生成设置"
            >
                <GearSix size={18} weight="bold" />
            </button>
        </>
    );

    return (
        <div className="absolute inset-0 z-[60] flex flex-col bg-[#fafafa] moro-laiwang animate-fade-in">
            <div className="shrink-0">
                <div className="bg-transparent backdrop-blur-xl" style={{ height: 'var(--safe-top)' }} />
                <div className="bg-white/90 backdrop-blur-md flex items-center px-4 border-b border-[#ededed] h-16 gap-2">
                    <ShareNetwork size={22} weight="duotone" className="text-[#9c5e74]" />
                    <span className="font-bold text-[#262626] text-lg tracking-tight">关系网</span>
                    <span className="text-[11px] text-slate-400 ml-1">{nodes.length} 位角色</span>
                    <div className="flex-1" />
                    {headerActions}
                    <button onClick={onClose} className="p-2 -mr-2 rounded-full hover:bg-black/5 active:scale-90 transition-transform" title="关闭">
                        <X size={22} className="text-slate-500" />
                    </button>
                </div>
            </div>

            {nodes.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-slate-400 gap-2">
                    <ShareNetwork size={40} weight="thin" />
                    <p className="text-sm">还没有角色，先去添加好友吧</p>
                </div>
            ) : (
                <div className="flex-1 overflow-y-auto scrap-list px-4 py-4 pb-[calc(var(--safe-bottom)+1rem)]">
                    {renderGraph()}
                    <div className="max-w-[460px] mx-auto mt-3 flex flex-wrap justify-center gap-x-3 gap-y-1.5">
                        {(['friend', 'close', 'crush', 'lover', 'married', 'ex'] as RelationshipStage[]).map(s => (
                            <span key={s} className="inline-flex items-center gap-1 text-[10px] text-slate-500">
                                <span className="w-2.5 h-2.5 rounded-full" style={{ background: STAGE_NETWORK_META[s].color }} />
                                {STAGE_DEFAULT_LABEL[s]}
                            </span>
                        ))}
                    </div>
                    <p className="max-w-[460px] mx-auto mt-2 text-center text-[10px] text-slate-400">
                        中心线是你和角色；角色之间的线可点开，查看关系、私聊和生成记录。手写 NPC 关系会收在所选角色的关系卡里。
                    </p>
                    {renderRelationDock()}
                </div>
            )}

            {sheet === 'owner-picker' && renderOwnerPicker()}
            {sheet === 'target-picker' && renderTargetPicker()}
            {sheet === 'relation-form' && renderRelationForm()}
            {sheet === 'settings' && renderSettings()}
            {selectedPairKey && renderPairSheet()}
            {renderPrivateChat()}
        </div>
    );
};

export default RelationshipNetwork;
