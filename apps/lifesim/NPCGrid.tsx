/**
 * NPCGrid - 街坊（拼贴手账 · 人物贴卡）
 */

import React, { useRef, useState } from 'react';
import { LifeSimState, SimNPC } from '../../types';
import { getMoodLabel, getProfessionInfo, getGenderLabel } from '../../utils/lifeSimEngine';
import { NPCAvatar, IconFlame, IconCrush } from '../../utils/styledIcons';

const MOOD_COLORS = (norm: number) =>
    norm > 60 ? '#5b9b6b' : norm > 30 ? '#b89840' : '#b85050';

const LONG_PRESS_MS = 420;

const NPCCard: React.FC<{
    npc: SimNPC;
    gameState: LifeSimState;
    index: number;
    onLongPressNpc?: (npc: SimNPC) => void;
}> = ({ npc, gameState, index, onLongPressNpc }) => {
    const [expanded, setExpanded] = useState(false);
    const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const didLongPress = useRef(false);
    const profInfo = getProfessionInfo(npc.profession ?? 'freelancer');
    const mood = npc.mood;
    const { label: moodLabel } = getMoodLabel(mood);
    const family = gameState.families.find(f => f.id === npc.familyId);
    const moodNorm = (mood + 100) / 2;
    const grudges = npc.grudges ?? [];
    const crushes = npc.crushes ?? [];
    const genderSymbol = getGenderLabel(npc.gender);
    const tilt = index % 2 === 0 ? 'tilt-l' : 'tilt-r';

    const clearPress = () => {
        if (pressTimer.current) {
            clearTimeout(pressTimer.current);
            pressTimer.current = null;
        }
    };

    const handlePressStart = () => {
        clearPress();
        didLongPress.current = false;
        if (!onLongPressNpc) return;
        pressTimer.current = setTimeout(() => {
            didLongPress.current = true;
            onLongPressNpc(npc);
        }, LONG_PRESS_MS);
    };

    const handleClick = () => {
        if (didLongPress.current) {
            didLongPress.current = false;
            return;
        }
        setExpanded(value => !value);
    };

    return (
        <div
            className={`scrap-card press-soft cursor-pointer relative ${tilt}`}
            style={{ borderRadius: 12, padding: '8px 9px' }}
            onClick={handleClick}
            onContextMenu={event => {
                event.preventDefault();
                onLongPressNpc?.(npc);
            }}
            onTouchStart={handlePressStart}
            onTouchEnd={clearPress}
            onTouchCancel={clearPress}
            onMouseDown={handlePressStart}
            onMouseUp={clearPress}
            onMouseLeave={clearPress}
        >
            <div className="flex items-center gap-2">
                {/* 头像贴片（邮票齿孔感） */}
                <div className="flex-shrink-0" style={{
                    width: 34, height: 34, borderRadius: 7, padding: 2,
                    background: '#fbfaf7',
                    outline: `1px dashed ${profInfo.color}66`, outlineOffset: -2,
                }}>
                    <NPCAvatar name={npc.name} size={30} className="rounded-md" />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                        <span className="font-hand truncate" style={{ fontSize: 14, fontWeight: 700, color: '#2b2933' }}>
                            {npc.name}{genderSymbol ? ` ${genderSymbol}` : ''}
                        </span>
                        <span style={{ fontSize: 9, color: '#bcb5a8', marginLeft: 'auto' }}>{expanded ? '▲' : '▼'}</span>
                    </div>
                    <div className="flex items-center gap-1 mt-0.5">
                        <span style={{
                            fontSize: 9, fontWeight: 700, color: profInfo.color,
                            background: `${profInfo.color}18`, padding: '0 5px', borderRadius: 4,
                            border: `1px solid ${profInfo.color}33`,
                        }}>{profInfo.zh}</span>
                        {family && (
                            <span className="font-hand truncate" style={{ fontSize: 10, color: '#a79c8e' }}>@{family.name}</span>
                        )}
                    </div>
                </div>
            </div>

            {/* 心情条 */}
            <div className="flex items-center gap-1.5 mt-2">
                <div className="flex-1" style={{
                    height: 6, borderRadius: 999, overflow: 'hidden',
                    background: 'rgba(120,116,106,0.1)', border: '1px solid rgba(167,162,151,0.35)',
                }}>
                    <div style={{ height: '100%', width: `${moodNorm}%`, background: MOOD_COLORS(moodNorm), borderRadius: 999, transition: 'width 0.5s' }} />
                </div>
                <span className="font-hand" style={{ fontSize: 11, color: MOOD_COLORS(moodNorm), fontWeight: 700 }}>{moodLabel}</span>
            </div>

            {/* 性格便签 */}
            <div className="flex flex-wrap gap-1 mt-1.5">
                {npc.personality.slice(0, 3).map(item => (
                    <span key={item} style={{
                        fontSize: 9, fontWeight: 700, color: '#5c574f',
                        background: 'rgba(255,255,255,0.9)', padding: '1px 6px', borderRadius: 999,
                        border: '1px solid rgba(236,233,226,0.95)',
                        outline: '1px dashed rgba(167,162,151,0.34)', outlineOffset: -2,
                    }}>{item}</span>
                ))}
            </div>

            {(grudges.length > 0 || crushes.length > 0) && (
                <div className="flex gap-1 mt-1.5 flex-wrap">
                    {grudges.map(gid => {
                        const target = gameState.npcs.find(n => n.id === gid);
                        return target ? (
                            <span key={`g-${gid}`} style={{
                                fontSize: 9, fontWeight: 700, background: 'rgba(184,80,80,0.1)', color: '#b85050',
                                border: '1px solid rgba(184,80,80,0.25)', borderRadius: 999, padding: '0 5px',
                                display: 'inline-flex', alignItems: 'center', gap: 2,
                            }}><IconFlame size={8} />{target.name}</span>
                        ) : null;
                    })}
                    {crushes.map(cid => {
                        const target = gameState.npcs.find(n => n.id === cid);
                        return target ? (
                            <span key={`c-${cid}`} style={{
                                fontSize: 9, fontWeight: 700, background: 'rgba(192,96,144,0.1)', color: '#c06090',
                                border: '1px solid rgba(192,96,144,0.25)', borderRadius: 999, padding: '0 5px',
                                display: 'inline-flex', alignItems: 'center', gap: 2,
                            }}><IconCrush size={8} />{target.name}</span>
                        ) : null;
                    })}
                </div>
            )}

            {expanded && (
                <div style={{ marginTop: 7, paddingTop: 7, borderTop: '1px dashed rgba(167,162,151,0.5)' }}>
                    {npc.bio && (
                        <p className="font-hand" style={{ fontSize: 12, color: '#6b665d', lineHeight: 1.55, marginBottom: 5 }}>{npc.bio}</p>
                    )}
                    {npc.backstory && (
                        <div style={{ padding: '5px 7px', marginTop: 4, background: 'rgba(120,116,106,0.05)', borderRadius: 8, border: '1px dashed rgba(167,162,151,0.4)' }}>
                            <p className="label-mono" style={{ fontSize: 8, color: '#a79c8e', marginBottom: 2 }}>backstory</p>
                            <p className="font-hand" style={{ fontSize: 12, color: '#5c574f', lineHeight: 1.55 }}>{npc.backstory}</p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

const NPCGrid: React.FC<{
    gameState: LifeSimState;
    onLongPressNpc?: (npc: SimNPC) => void;
}> = ({ gameState, onLongPressNpc }) => {
    const allNpcs = gameState.npcs;

    if (allNpcs.length === 0) {
        return (
            <div className="flex items-center justify-center p-10 font-hand" style={{ color: '#a79c8e', fontSize: 15 }}>
                还没有街坊住进来…
            </div>
        );
    }

    return (
        <div style={{ padding: 10 }}>
            <p className="font-hand" style={{ fontSize: 12, color: '#a79c8e', marginBottom: 9, lineHeight: 1.5 }}>
                点一下翻开街坊的故事，长按能改这局的人物设定 ✎
            </p>
            <div className="grid grid-cols-2 gap-2.5">
                {allNpcs.map((npc, i) => (
                    <NPCCard key={npc.id} npc={npc} gameState={gameState} index={i} onLongPressNpc={onLongPressNpc} />
                ))}
            </div>
        </div>
    );
};

export default NPCGrid;
