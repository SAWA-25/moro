/**
 * DramaFeed - 街谈（拼贴手账 · 动态纸条 + 主线剪报夹）
 */

import React, { useEffect, useMemo, useState } from 'react';
import { LifeSimState, SimAction } from '../../types';
import {
    Alien, BookOpen, ChatCircleDots, Globe, Lightning, Sparkle,
} from '@phosphor-icons/react';
import StoryAttachments from './StoryAttachments';
import { formatLifeSimActionDescription } from '../../utils/lifeSimTone';

const EVENT_ACCENTS: Record<string, string> = {
    fight: '#b85050',
    romance: '#c06090',
    gossip: '#8b6bb8',
    alliance: '#5080b8',
    party: '#b89840',
    rivalry: '#c07040',
    mainPlot: '#b86c3d',
    system: '#9b958a',
};

const TONE_DOTS: Record<string, string> = {
    vengeful: '#b85050',
    romantic: '#c06090',
    scheming: '#8b6bb8',
    chaotic: '#c07040',
    peaceful: '#5b9b6b',
    amused: '#b89840',
    anxious: '#5070b0',
};

type DramaFilter = 'all' | 'character' | 'main_plot' | 'system';

const FILTERS: { value: DramaFilter; label: string }[] = [
    { value: 'all', label: '全部' },
    { value: 'character', label: '街坊' },
    { value: 'main_plot', label: '主线' },
    { value: 'system', label: '系统' },
];

function getEventAccent(action: SimAction): string {
    if (action.storyKind === 'main_plot') return EVENT_ACCENTS.mainPlot;
    if (action.storyKind === 'system') return EVENT_ACCENTS.system;

    const desc = action.description.toLowerCase();
    if (desc.includes('fight') || desc.includes('吵架') || desc.includes('打架')) return EVENT_ACCENTS.fight;
    if (desc.includes('romance') || desc.includes('暧昧') || desc.includes('恋')) return EVENT_ACCENTS.romance;
    if (desc.includes('gossip') || desc.includes('闲话') || desc.includes('八卦')) return EVENT_ACCENTS.gossip;
    if (desc.includes('alliance') || desc.includes('结盟')) return EVENT_ACCENTS.alliance;
    if (desc.includes('party') || desc.includes('派对')) return EVENT_ACCENTS.party;
    if (desc.includes('rivalry') || desc.includes('竞争')) return EVENT_ACCENTS.rivalry;
    if (action.actorId === 'system' || action.actorId === 'autonomous') return '#8b6bb8';
    if (action.actorId === 'user') return '#5b9b6b';
    return '#9b958a';
}

function getStoryBadge(action: SimAction): string {
    if (action.storyKind === 'main_plot') return '主线';
    if (action.storyKind === 'character_drama') return '街坊';
    if (action.storyKind === 'system') return '系统';
    return '';
}

function matchesDramaFilter(action: SimAction, filter: DramaFilter): boolean {
    if (filter === 'all') return true;
    if (filter === 'main_plot') return action.storyKind === 'main_plot';
    if (filter === 'system') return action.storyKind === 'system' || action.actorId === 'system' || action.actorId === 'autonomous';
    return action.storyKind === 'character_drama' || action.actorId === 'user' || (!!action.actorId && !['system', 'autonomous', 'story'].includes(action.actorId));
}

const DramaEntry: React.FC<{ action: SimAction }> = ({ action }) => {
    const [expanded, setExpanded] = useState(false);
    const accent = getEventAccent(action);
    const narrative = action.narrative;
    const displayDescription = formatLifeSimActionDescription(action.description);
    const hasDetails = !!(narrative?.innerThought || narrative?.dialogue || narrative?.commentOnWorld || action.reasoning || action.reactionToUser);
    const toneColor = narrative?.emotionalTone ? TONE_DOTS[narrative.emotionalTone] : undefined;
    const storyBadge = getStoryBadge(action);
    const isMain = action.storyKind === 'main_plot';

    return (
        <div
            style={{
                background: isMain ? 'rgba(255,247,234,0.85)' : 'rgba(255,255,255,0.95)',
                border: '1px solid rgba(236,233,226,0.95)',
                borderLeft: `4px solid ${accent}`,
                borderRadius: 10,
                outline: '1px dashed rgba(167,162,151,0.3)', outlineOffset: -4,
                padding: '7px 10px',
                cursor: hasDetails ? 'pointer' : 'default',
                minWidth: 0,
                boxShadow: '0 6px 14px -12px rgba(50,48,60,0.32)',
            }}
            onClick={() => hasDetails && setExpanded(!expanded)}
        >
            <div className="flex items-center gap-1.5" style={{ minWidth: 0 }}>
                <div className="flex-shrink-0" style={{
                    width: 20, height: 20, borderRadius: 5, overflow: 'hidden',
                    background: '#fbfaf7', outline: '1px dashed rgba(167,162,151,0.5)', outlineOffset: -2,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                    {action.actorAvatar?.startsWith('http') || action.actorAvatar?.startsWith('data:')
                        ? <img src={action.actorAvatar} style={{ width: 20, height: 20, objectFit: 'cover', borderRadius: 4 }} alt="" />
                        : action.actorAvatar
                            ? <span style={{ fontSize: 12 }}>{action.actorAvatar}</span>
                            : <Alien size={11} weight="bold" style={{ color: '#bcb5a8' }} />}
                </div>
                <span className="font-hand" style={{ fontSize: 13, fontWeight: 700, color: accent }}>{action.actor}</span>
                {storyBadge && (
                    <span style={{
                        fontSize: 8.5, fontWeight: 700, color: accent,
                        border: `1px solid ${accent}55`, background: `${accent}14`,
                        borderRadius: 999, padding: '1px 6px', flexShrink: 0,
                    }}>{storyBadge}</span>
                )}
                {toneColor && <span style={{ width: 5, height: 5, borderRadius: '50%', background: toneColor, flexShrink: 0 }} />}
                <span className="label-mono" style={{ fontSize: 8, color: '#bcb5a8', marginLeft: 'auto', flexShrink: 0 }}>pg.{action.turnNumber}</span>
                {hasDetails && <span style={{ fontSize: 8, color: '#cfc8bb', flexShrink: 0 }}>{expanded ? '▲' : '▼'}</span>}
            </div>

            {action.headline && (
                <p className="font-hand" style={{ fontSize: 13.5, fontWeight: 700, color: '#2b2933', lineHeight: 1.4, marginTop: 4, overflowWrap: 'anywhere' }}>
                    {action.headline}
                </p>
            )}

            <p style={{ fontSize: 11.5, color: '#5c574f', lineHeight: 1.5, marginTop: 3, overflowWrap: 'anywhere' }}>{displayDescription}</p>

            {action.immediateResult && action.immediateResult !== action.description && (
                <p style={{ fontSize: 10.5, color: '#a79c8e', marginTop: 3, overflowWrap: 'anywhere' }}>→ {action.immediateResult}</p>
            )}

            <StoryAttachments attachments={action.attachments} compact />

            {expanded && hasDetails && (
                <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px dashed rgba(167,162,151,0.5)' }}>
                    {(narrative?.innerThought || action.reasoning) && (
                        <div style={{ padding: '4px 7px', marginBottom: 5, background: 'rgba(120,116,106,0.05)', borderRadius: 7 }}>
                            <p className="font-hand" style={{ fontSize: 11.5, color: '#8a8196', fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: 3, overflowWrap: 'anywhere' }}>
                                <ChatCircleDots size={10} weight="bold" /> {narrative?.innerThought || action.reasoning}
                            </p>
                        </div>
                    )}
                    {narrative?.dialogue && (
                        <p style={{ fontSize: 11, color: '#6b665d', display: 'flex', alignItems: 'center', gap: 3, marginBottom: 3, overflowWrap: 'anywhere' }}>
                            <BookOpen size={10} weight="bold" style={{ flexShrink: 0 }} /> {narrative.dialogue}
                        </p>
                    )}
                    {narrative?.commentOnWorld && (
                        <p style={{ fontSize: 10, color: '#a79c8e', fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: 3, overflowWrap: 'anywhere' }}>
                            <Globe size={9} weight="bold" style={{ flexShrink: 0 }} /> {narrative.commentOnWorld}
                        </p>
                    )}
                    {action.reactionToUser && (
                        <p className="font-hand" style={{ fontSize: 11.5, color: '#9080a0', fontStyle: 'italic', marginTop: 4, display: 'flex', alignItems: 'center', gap: 3, overflowWrap: 'anywhere' }}>
                            <ChatCircleDots size={10} weight="bold" style={{ flexShrink: 0 }} /> "{action.reactionToUser}"
                        </p>
                    )}
                </div>
            )}

            {action.chainFromId && (
                <p style={{ fontSize: 9, color: '#b89840', marginTop: 4, display: 'flex', alignItems: 'center', gap: 3 }}>
                    <Lightning size={9} weight="bold" style={{ flexShrink: 0 }} /> 连锁事件
                </p>
            )}
        </div>
    );
};

const MainPlotArchive: React.FC<{ gameState: LifeSimState }> = ({ gameState }) => {
    const mainPlots = useMemo(
        () => [...gameState.actionLog].filter(action => action.storyKind === 'main_plot').reverse(),
        [gameState.actionLog]
    );
    const [selectedId, setSelectedId] = useState<string | null>(mainPlots[0]?.id || null);

    useEffect(() => {
        if (!mainPlots.length) { setSelectedId(null); return; }
        if (!selectedId || !mainPlots.some(action => action.id === selectedId)) {
            setSelectedId(mainPlots[0].id);
        }
    }, [mainPlots, selectedId]);

    const selectedPlot = mainPlots.find(action => action.id === selectedId) || mainPlots[0] || null;
    const npcNameMap = new Map(gameState.npcs.map(npc => [npc.id, `${npc.emoji || ''}${npc.name}`.trim()]));
    const involvedNames = selectedPlot?.involvedNpcIds?.map(id => npcNameMap.get(id)).filter(Boolean) || [];
    const mp = EVENT_ACCENTS.mainPlot;

    return (
        <div className="scrap-card" style={{ minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column', borderRadius: 12 }}>
            <div className="flex items-center justify-between px-3 pt-2.5 pb-1.5">
                <span className="font-hand" style={{ fontSize: 15, fontWeight: 700, color: '#9b6238' }}>主线剪报夹</span>
                <span className="flex items-center gap-1 label-mono" style={{ fontSize: 9, color: mp }}>
                    <Sparkle size={11} weight="fill" /> {mainPlots.length}
                </span>
            </div>
            <div className="lace-edge mx-3" />

            {!selectedPlot ? (
                <div className="flex-1 flex items-center justify-center text-center" style={{ padding: 18 }}>
                    <div>
                        <p className="font-hand" style={{ fontSize: 15, fontWeight: 700, color: '#7f6c5d' }}>主线剪报夹还是空的</p>
                        <p className="font-hand" style={{ fontSize: 12, color: '#a79c8e', marginTop: 6, lineHeight: 1.5 }}>
                            多点几次「吃瓜」，世界线就会在这里留下剪报。
                        </p>
                    </div>
                </div>
            ) : (
                <>
                    <div style={{ padding: 10, borderBottom: '1px dashed rgba(167,162,151,0.5)' }}>
                        <div className="label-mono" style={{ fontSize: 8.5, color: '#a79c8e', marginBottom: 7 }}>timeline</div>
                        <div className="space-y-1.5 no-scrollbar" style={{ maxHeight: 168, overflowY: 'auto', overflowX: 'hidden', paddingRight: 2 }}>
                            {mainPlots.map(action => {
                                const active = action.id === selectedPlot.id;
                                return (
                                    <button key={action.id} onClick={() => setSelectedId(action.id)}
                                        style={{
                                            width: '100%', textAlign: 'left',
                                            border: active ? `1px solid ${mp}55` : '1px solid rgba(236,233,226,0.95)',
                                            borderLeft: `4px solid ${active ? mp : '#d8d2c7'}`,
                                            borderRadius: 9, padding: '6px 8px',
                                            background: active ? 'rgba(255,247,234,0.9)' : 'rgba(255,255,255,0.7)',
                                            minWidth: 0,
                                        }}>
                                        <div className="flex items-center gap-2" style={{ minWidth: 0 }}>
                                            <span className="font-hand" style={{ fontSize: 12, fontWeight: 700, color: active ? mp : '#7f756e', flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
                                                {action.headline || action.description}
                                            </span>
                                            <span className="label-mono" style={{ fontSize: 8, color: '#bcb5a8', flexShrink: 0 }}>pg.{action.turnNumber}</span>
                                        </div>
                                        {action.attachments && action.attachments.length > 0 && (
                                            <div className="font-hand" style={{ fontSize: 10, color: '#9f8b7d', marginTop: 3 }}>夹页 {action.attachments.length}</div>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div style={{ padding: 10, borderBottom: '1px dashed rgba(167,162,151,0.5)', background: 'rgba(184,108,61,0.06)' }}>
                        <div className="flex items-center gap-1.5 flex-wrap">
                            <span style={{
                                fontSize: 9, fontWeight: 700, color: mp,
                                border: `1px solid ${mp}55`, background: `${mp}14`,
                                borderRadius: 999, padding: '1px 7px',
                            }}>当前主线</span>
                            <span className="label-mono" style={{ fontSize: 8, color: '#a1968c' }}>pg.{selectedPlot.turnNumber}</span>
                        </div>
                        <p className="font-hand" style={{ fontSize: 16, fontWeight: 700, color: '#4b3c31', marginTop: 6, lineHeight: 1.4, overflowWrap: 'anywhere' }}>
                            {selectedPlot.headline || selectedPlot.description}
                        </p>
                        <p style={{ fontSize: 11.5, color: '#6a615a', lineHeight: 1.6, marginTop: 5, overflowWrap: 'anywhere' }}>
                            {selectedPlot.description}
                        </p>
                        {selectedPlot.immediateResult && (
                            <div style={{ padding: '6px 9px', marginTop: 8, background: 'rgba(255,255,255,0.7)', borderRadius: 9, border: '1px dashed rgba(184,108,61,0.4)' }}>
                                <div className="font-hand" style={{ fontSize: 11, fontWeight: 700, color: '#9b765e', marginBottom: 3 }}>这一段的结果</div>
                                <div style={{ fontSize: 11, color: '#59504a', lineHeight: 1.55, overflowWrap: 'anywhere' }}>{selectedPlot.immediateResult}</div>
                            </div>
                        )}
                        {involvedNames.length > 0 && (
                            <div className="flex gap-1.5 flex-wrap" style={{ marginTop: 8 }}>
                                {involvedNames.map(name => (
                                    <span key={name} className="font-hand" style={{
                                        fontSize: 10, fontWeight: 700, color: '#7c6555',
                                        background: 'rgba(255,255,255,0.8)', border: '1px solid rgba(184,108,61,0.25)',
                                        borderRadius: 999, padding: '2px 8px',
                                    }}>{name}</span>
                                ))}
                            </div>
                        )}
                        <StoryAttachments attachments={selectedPlot.attachments} />
                    </div>

                    {(selectedPlot.narrative?.innerThought || selectedPlot.narrative?.commentOnWorld) && (
                        <div style={{ padding: 10 }}>
                            <div className="font-hand" style={{ fontSize: 12, fontWeight: 700, color: '#8b7b72', marginBottom: 6 }}>编剧室的批注</div>
                            {selectedPlot.narrative?.innerThought && (
                                <div style={{ padding: '6px 9px', marginBottom: selectedPlot.narrative?.commentOnWorld ? 6 : 0, background: 'rgba(120,116,106,0.05)', borderRadius: 9, border: '1px dashed rgba(167,162,151,0.4)' }}>
                                    <p className="font-hand" style={{ fontSize: 12, color: '#7d705e', lineHeight: 1.6, fontStyle: 'italic', overflowWrap: 'anywhere' }}>
                                        {selectedPlot.narrative.innerThought}
                                    </p>
                                </div>
                            )}
                            {selectedPlot.narrative?.commentOnWorld && (
                                <p style={{ fontSize: 10.5, color: '#8e847d', lineHeight: 1.6, marginTop: 5, overflowWrap: 'anywhere' }}>
                                    {selectedPlot.narrative.commentOnWorld}
                                </p>
                            )}
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

const DramaFeed: React.FC<{ gameState: LifeSimState }> = ({ gameState }) => {
    const [filter, setFilter] = useState<DramaFilter>('all');
    const logs = [...gameState.actionLog]
        .filter(action => matchesDramaFilter(action, filter))
        .reverse();

    return (
        <div style={{ padding: 10, minHeight: '100%', minWidth: 0, overflowX: 'hidden' }}>
            {/* 筛选纸条 */}
            <div className="flex items-center gap-1.5 flex-wrap mb-3">
                {FILTERS.map(item => {
                    const active = filter === item.value;
                    return (
                        <button key={item.value} onClick={() => setFilter(item.value)}
                            className="font-hand press-soft"
                            style={{
                                padding: '3px 12px', fontSize: 13, fontWeight: 700, borderRadius: 999,
                                color: active ? '#fbfaf7' : '#5c574f',
                                background: active ? '#2b2933' : 'rgba(255,255,255,0.95)',
                                border: active ? '1px solid #2b2933' : '1px solid rgba(236,233,226,0.95)',
                                outline: active ? '1px dashed rgba(255,255,255,0.35)' : '1px dashed rgba(167,162,151,0.36)',
                                outlineOffset: -3,
                            }}>
                            {item.label}
                        </button>
                    );
                })}
            </div>

            <div className="grid gap-2.5 lg:grid-cols-2" style={{ minHeight: 'calc(100% - 44px)', minWidth: 0 }}>
                {/* 街谈巷议 */}
                <div className="scrap-card order-2 lg:order-1" style={{ minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column', borderRadius: 12 }}>
                    <div className="flex items-center justify-between px-3 pt-2.5 pb-1.5">
                        <span className="font-hand" style={{ fontSize: 15, fontWeight: 700, color: '#2b2933' }}>街谈巷议</span>
                        <span className="label-mono" style={{ fontSize: 9, color: '#a79c8e' }}>{logs.length}</span>
                    </div>
                    <div className="lace-edge mx-3" />
                    <div style={{ padding: 10, minWidth: 0 }} className="space-y-2 flex-1 overflow-y-auto overflow-x-hidden no-scrollbar">
                        {logs.length === 0 ? (
                            <div className="text-center py-10 font-hand" style={{ color: '#a79c8e', fontSize: 14 }}>这条街还没传出新消息…</div>
                        ) : logs.map(action => (
                            <DramaEntry key={action.id} action={action} />
                        ))}
                    </div>
                </div>

                {/* 主线剪报夹 */}
                <div className="order-1 lg:order-2" style={{ minWidth: 0 }}>
                    <MainPlotArchive gameState={gameState} />
                </div>
            </div>
        </div>
    );
};

export default DramaFeed;
