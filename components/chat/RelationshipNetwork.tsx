import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CharacterProfile, RelationshipNetworkAutoSettings, RelationshipNetworkEdge, RelationshipNetworkMessage, RelationshipStage } from '../../types';
import {
    STAGE_DEFAULT_LABEL,
    STAGE_NETWORK_META,
    STAGE_DASHED,
    inferStageFromAffection,
} from '../../utils/relationship';
import {
    buildRelationshipForwardCard,
    buildRelationshipNetworkFallbackEdges,
    generateCharPairInteraction,
    makeDefaultRelationshipNetworkAutoSettings,
    mergeRelationshipEdge,
    normalizeRelationshipNetworkSettings,
    organizeRelationshipNetwork,
    relationshipPairKey,
    RELATIONSHIP_NETWORK_UPDATED_EVENT,
} from '../../utils/relationshipNetwork';
import { DB } from '../../utils/db';
import { resolveAuxApi } from '../../utils/auxApi';
import { useOS } from '../../context/OSContext';
import { ShareNetwork, X, ChatCircleDots, Heart, MagicWand, GearSix, Robot, PaperPlaneRight, ArrowLeft, UsersThree } from '@phosphor-icons/react';

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

const nameOf = (c: CharacterProfile): string => c.convoSettings?.remarkName?.trim() || c.name;
const avatarOf = (c: CharacterProfile): string => c.convoSettings?.charAvatarOverride || c.avatar;
const stageOf = (c: CharacterProfile): RelationshipStage => c.relationship?.stage || inferStageFromAffection(c.affection);
const pairTitle = (a?: CharacterProfile, b?: CharacterProfile) => [a && nameOf(a), b && nameOf(b)].filter(Boolean).join(' × ');

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

const RelationshipNetwork: React.FC<Props> = ({ characters, userName, userAvatar, onClose, onOpenChat }) => {
    const { apiConfig, auxApiConfig, userProfile, addToast, markUnread } = useOS();
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [edges, setEdges] = useState<RelationshipNetworkEdge[]>([]);
    const [selectedPairKey, setSelectedPairKey] = useState<string | null>(null);
    const [privatePairKey, setPrivatePairKey] = useState<string | null>(null);
    const [pairMessages, setPairMessages] = useState<RelationshipNetworkMessage[]>([]);
    const [settings, setSettings] = useState<RelationshipNetworkAutoSettings>(() => makeDefaultRelationshipNetworkAutoSettings());
    const [showSettings, setShowSettings] = useState(false);
    const [busy, setBusy] = useState<string | null>(null);

    const charById = useMemo(() => new Map(characters.map(c => [c.id, c])), [characters]);

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

    const displayEdges = useMemo(() => {
        const valid = edges.filter(e => e.charIds.every(id => charById.has(id)));
        if (valid.length) return valid;
        return buildRelationshipNetworkFallbackEdges(characters);
    }, [edges, characters, charById]);

    const selectedEdge = useMemo(() => displayEdges.find(e => e.pairKey === selectedPairKey) || null, [displayEdges, selectedPairKey]);
    const privateEdge = useMemo(() => displayEdges.find(e => e.pairKey === privatePairKey) || null, [displayEdges, privatePairKey]);
    const selectedPairChars = useMemo(() => {
        const edge = selectedEdge || privateEdge;
        if (!edge) return [] as CharacterProfile[];
        return edge.charIds.map(id => charById.get(id)).filter(Boolean) as CharacterProfile[];
    }, [selectedEdge, privateEdge, charById]);

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
        if (characters.length < 2 || busy) return;
        setBusy('organize');
        try {
            const api = resolveAuxApi(auxApiConfig, apiConfig);
            const nextEdges = await organizeRelationshipNetwork({ characters, userProfile, api });
            await DB.saveRelationshipNetworkEdges(nextEdges);
            setEdges(nextEdges);
            window.dispatchEvent(new Event(RELATIONSHIP_NETWORK_UPDATED_EVENT));
            addToast(`已整理 ${nextEdges.length} 条角色关系`, 'success');
        } catch (err: any) {
            addToast(`关系网整理失败：${err?.message || '未知错误'}`, 'error');
        } finally {
            setBusy(null);
        }
    };

    const runGenerate = async (pairKey: string, source: 'manual' | 'auto' = 'manual') => {
        if (busy) return;
        const ids = pairKey.replace(/^rn_/, '').split('__');
        const a = charById.get(ids[0]);
        const b = charById.get(ids[1]);
        if (!a || !b) return;
        setBusy(pairKey);
        try {
            const storedEdge = await DB.getRelationshipNetworkEdgeByPair(pairKey);
            const edge = storedEdge || displayEdges.find(e => e.pairKey === pairKey);
            const recent = await DB.getRelationshipNetworkMessagesByPair(pairKey, 12).catch(() => []);
            const api = resolveAuxApi(auxApiConfig, apiConfig);
            const result = await generateCharPairInteraction({ a, b, edge, recentMessages: recent, api, userProfile, source });
            await DB.saveRelationshipNetworkMessages(result.messages);
            const merged = mergeRelationshipEdge(edge, a, b, result.edgePatch, source, Date.now());
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

    const saveSettings = async () => {
        const next = normalizeRelationshipNetworkSettings({
            ...settings,
            nextRunAt: settings.enabled ? Math.max(settings.nextRunAt || 0, Date.now() + settings.intervalMinutes * 60_000) : settings.nextRunAt,
            updatedAt: Date.now(),
        });
        await DB.saveRelationshipNetworkAutoSettings(next);
        setSettings(next);
        setShowSettings(false);
        window.dispatchEvent(new Event(RELATIONSHIP_NETWORK_UPDATED_EVENT));
        addToast('关系网后台生成设置已保存', 'success');
    };

    const toggleSelectedChar = (id: string) => {
        setSettings(prev => {
            const set = new Set(prev.selectedCharIds);
            if (set.has(id)) set.delete(id); else set.add(id);
            return { ...prev, selectedCharIds: Array.from(set), updatedAt: Date.now() };
        });
    };

    const headerActions = (
        <>
            <button
                onClick={runOrganize}
                disabled={!!busy || characters.length < 2}
                className="px-3 py-2 rounded-full bg-[#fff4f7] text-[#9c5e74] text-xs font-bold border border-[#f0d9e2] flex items-center gap-1 disabled:opacity-45"
            >
                <MagicWand size={15} weight="bold" />
                {busy === 'organize' ? '整理中' : 'AI整理'}
            </button>
            <button
                onClick={() => setShowSettings(true)}
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
                <div className="flex-1 overflow-y-auto scrap-list px-4 py-4">
                    <div className="relative w-full max-w-[440px] mx-auto aspect-square">
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
                            {displayEdges.map(edge => {
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
                                        opacity: (selectedId && !active) || (selectedPairKey && !selectedPairChars.some(c => c.id === nd.char.id)) ? 0.5 : 1,
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

                    <div className="max-w-[440px] mx-auto mt-3 flex flex-wrap justify-center gap-x-3 gap-y-1.5">
                        {(['friend', 'close', 'crush', 'lover', 'married', 'ex'] as RelationshipStage[]).map(s => (
                            <span key={s} className="inline-flex items-center gap-1 text-[10px] text-slate-500">
                                <span className="w-2.5 h-2.5 rounded-full" style={{ background: STAGE_NETWORK_META[s].color }} />
                                {STAGE_DEFAULT_LABEL[s]}
                            </span>
                        ))}
                    </div>
                    <p className="max-w-[440px] mx-auto mt-2 text-center text-[10px] text-slate-400">
                        中心线是你和角色；角色之间的线可点开，查看关系、私聊和生成记录。
                    </p>
                </div>
            )}

            {selected && (
                <div className="absolute inset-x-0 bottom-0 z-30 animate-slide-up">
                    <div className="mx-3 mb-3 rounded-3xl bg-white shadow-2xl border border-slate-100 overflow-hidden">
                        <div className="p-4">
                            <div className="flex items-center gap-3">
                                <img src={avatarOf(selected.char)} className="w-14 h-14 rounded-full object-cover" style={{ border: `2.5px solid ${selected.color}` }} />
                                <div className="flex-1 min-w-0">
                                    <div className="font-bold text-slate-800 truncate">{nameOf(selected.char)}</div>
                                    <span className="inline-block mt-1 px-2 py-0.5 rounded-full text-[11px] font-semibold text-white" style={{ background: selected.color }}>
                                        {selected.char.relationship?.label?.trim() || STAGE_DEFAULT_LABEL[selected.stage]}
                                    </span>
                                </div>
                                <button onClick={() => setSelectedId(null)} className="p-1.5 rounded-full hover:bg-slate-100 text-slate-400 shrink-0">
                                    <X size={18} />
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
                            <button onClick={() => onOpenChat(selected.char.id)} className="mt-4 w-full py-3 bg-[#d8a5b7] text-white font-bold rounded-2xl shadow-lg shadow-rose-100/70 active:scale-[0.98] transition-transform flex items-center justify-center gap-2">
                                <ChatCircleDots size={18} weight="fill" />
                                进入聊天
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {selectedEdge && selectedPairChars.length === 2 && (
                <div className="absolute inset-x-0 bottom-0 z-40 animate-slide-up">
                    <div className="mx-3 mb-3 rounded-3xl bg-white shadow-2xl border border-slate-100 overflow-hidden">
                        <div className="p-4">
                            <div className="flex items-center gap-3">
                                <div className="flex -space-x-2 shrink-0">
                                    {selectedPairChars.map(c => <img key={c.id} src={avatarOf(c)} className="w-11 h-11 rounded-full border-2 border-white object-cover bg-white" />)}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="text-sm font-black text-slate-800 truncate">{pairTitle(selectedPairChars[0], selectedPairChars[1])}</div>
                                    <div className="text-[11px] text-slate-400 truncate">{selectedEdge.label} · 上次互动 {timeText(selectedEdge.lastInteractionAt)}</div>
                                </div>
                                <button onClick={() => setSelectedPairKey(null)} className="p-1.5 rounded-full hover:bg-slate-100 text-slate-400">
                                    <X size={18} />
                                </button>
                            </div>
                            <p className="mt-3 text-[12px] leading-relaxed text-slate-600">{selectedEdge.summary}</p>
                            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                                <div className="rounded-2xl bg-rose-50 py-2"><div className="text-[10px] text-slate-400">亲密</div><b className="text-rose-500">{selectedEdge.intimacy}</b></div>
                                <div className="rounded-2xl bg-amber-50 py-2"><div className="text-[10px] text-slate-400">张力</div><b className="text-amber-500">{selectedEdge.tension}</b></div>
                                <div className="rounded-2xl bg-slate-50 py-2"><div className="text-[10px] text-slate-400">把握</div><b className="text-slate-600">{selectedEdge.confidence}</b></div>
                            </div>
                            <div className="mt-3 flex gap-2">
                                <button onClick={() => setPrivatePairKey(selectedEdge.pairKey)} className="flex-1 py-2.5 rounded-2xl bg-slate-900 text-white text-xs font-black flex items-center justify-center gap-1">
                                    <UsersThree size={16} weight="bold" /> 查看私聊
                                </button>
                                <button onClick={() => runGenerate(selectedEdge.pairKey)} disabled={!!busy} className="flex-1 py-2.5 rounded-2xl bg-[#d8a5b7] text-white text-xs font-black flex items-center justify-center gap-1 disabled:opacity-50">
                                    <Robot size={16} weight="bold" /> {busy === selectedEdge.pairKey ? '生成中' : '生成一段'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {privatePairKey && privateEdge && selectedPairChars.length === 2 && (
                <div className="absolute inset-0 z-50 bg-[#f6f6f6] flex flex-col animate-fade-in">
                    <div className="shrink-0 bg-white border-b border-slate-100">
                        <div className="bg-transparent" style={{ height: 'var(--safe-top)' }} />
                        <div className="h-14 px-4 flex items-center gap-3">
                            <button onClick={() => setPrivatePairKey(null)} className="p-2 -ml-2 rounded-full hover:bg-slate-100"><ArrowLeft size={21} /></button>
                            <div className="flex -space-x-2">
                                {selectedPairChars.map(c => <img key={c.id} src={avatarOf(c)} className="w-8 h-8 rounded-full border-2 border-white object-cover" />)}
                            </div>
                            <div className="min-w-0 flex-1">
                                <div className="text-sm font-black truncate">{pairTitle(selectedPairChars[0], selectedPairChars[1])}</div>
                                <div className="text-[10px] text-slate-400 truncate">{privateEdge.label}</div>
                            </div>
                            <button onClick={() => runGenerate(privatePairKey)} disabled={!!busy} className="px-3 py-2 rounded-full bg-[#d8a5b7] text-white text-xs font-black disabled:opacity-50">
                                {busy === privatePairKey ? '生成中' : '生成'}
                            </button>
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
                        {pairMessages.length === 0 && (
                            <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-2">
                                <ChatCircleDots size={34} weight="thin" />
                                <p className="text-xs">还没有角色间私聊，点右上角生成一段。</p>
                            </div>
                        )}
                        {pairMessages.map(m => {
                            const speaker = charById.get(m.speakerId);
                            const alignRight = m.speakerId === selectedPairChars[1]?.id;
                            return (
                                <div key={m.id} className={`flex gap-2 ${alignRight ? 'justify-end' : 'justify-start'}`}>
                                    {!alignRight && <img src={speaker ? avatarOf(speaker) : ''} className="w-8 h-8 rounded-full object-cover bg-slate-200 shrink-0" />}
                                    <div className={`max-w-[78%] ${alignRight ? 'items-end' : 'items-start'} flex flex-col`}>
                                        <div className="text-[10px] text-slate-400 mb-1 px-1">{m.speakerName} · {timeText(m.createdAt)}</div>
                                        <div className={`px-3 py-2.5 rounded-2xl text-[13px] leading-relaxed whitespace-pre-wrap break-words ${alignRight ? 'bg-[#d8a5b7] text-white rounded-br-sm' : 'bg-white text-slate-700 rounded-bl-sm border border-slate-100'}`}>
                                            {m.content}
                                        </div>
                                    </div>
                                    {alignRight && <img src={speaker ? avatarOf(speaker) : ''} className="w-8 h-8 rounded-full object-cover bg-slate-200 shrink-0" />}
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
            )}

            {showSettings && (
                <div className="absolute inset-0 z-[70] bg-black/25 flex items-end" onClick={() => setShowSettings(false)}>
                    <div className="w-full max-h-[82%] overflow-y-auto rounded-t-3xl bg-white shadow-2xl p-4" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-2 mb-3">
                            <GearSix size={20} weight="bold" className="text-[#9c5e74]" />
                            <h3 className="font-black text-slate-800">后台自动生成</h3>
                            <div className="flex-1" />
                            <button onClick={() => setShowSettings(false)} className="p-2 rounded-full hover:bg-slate-100"><X size={18} /></button>
                        </div>
                        <label className="flex items-center justify-between rounded-2xl bg-slate-50 px-3 py-3">
                            <span className="text-sm font-bold text-slate-700">开启后台互动</span>
                            <input type="checkbox" checked={settings.enabled} onChange={e => setSettings(prev => ({ ...prev, enabled: e.target.checked }))} />
                        </label>
                        <div className="mt-3 grid grid-cols-3 gap-2">
                            {[
                                ['间隔(分钟)', 'intervalMinutes'],
                                ['单人冷却', 'charCooldownMinutes'],
                                ['两人冷却', 'pairCooldownMinutes'],
                            ].map(([label, key]) => (
                                <label key={key} className="rounded-2xl bg-slate-50 px-3 py-2">
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
                        <div className="mt-4">
                            <div className="text-[11px] font-black text-slate-400 mb-2">勾选会主动找人的角色</div>
                            <div className="space-y-2">
                                {characters.map(c => (
                                    <label key={c.id} className="flex items-center gap-3 rounded-2xl border border-slate-100 px-3 py-2">
                                        <img src={avatarOf(c)} className="w-9 h-9 rounded-full object-cover" />
                                        <span className="flex-1 text-sm font-bold text-slate-700 truncate">{nameOf(c)}</span>
                                        <input type="checkbox" checked={settings.selectedCharIds.includes(c.id)} onChange={() => toggleSelectedChar(c.id)} />
                                    </label>
                                ))}
                            </div>
                        </div>
                        <div className="mt-4 rounded-2xl bg-[#fff4f7] px-3 py-2 text-[11px] leading-relaxed text-[#8a5268]">
                            后台生成只在页面可运行或回到页面补跑时执行。角色可能自主转发片段给你，完整记录在这里查看。
                        </div>
                        <button onClick={saveSettings} className="mt-4 w-full py-3 rounded-2xl bg-[#d8a5b7] text-white text-sm font-black">
                            保存设置
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default RelationshipNetwork;
