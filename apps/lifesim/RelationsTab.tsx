/**
 * RelationsTab — 人情网（拼贴手账 · 关系纸条）
 */

import React from 'react';
import { LifeSimState } from '../../types';
import { getRelLabel } from '../../utils/lifeSimEngine';
import { NPCAvatar, IconFlame, IconCrush } from '../../utils/styledIcons';

const RelationsTab: React.FC<{ gameState: LifeSimState }> = ({ gameState }) => {
    const { npcs, families } = gameState;
    if (npcs.length < 2) return (
        <div className="flex items-center justify-center p-10 font-hand" style={{ color: '#a79c8e', fontSize: 15, textAlign: 'center' }}>
            至少要有 2 位街坊，才看得出人情冷暖
        </div>
    );

    const getRelVal = (aId: string, bId: string): number => {
        for (const fam of families) {
            if (fam.memberIds.includes(aId) && fam.memberIds.includes(bId)) {
                return fam.relationships?.[aId]?.[bId] ?? 0;
            }
        }
        return 0;
    };

    const pairs: { a: typeof npcs[0]; b: typeof npcs[0]; val: number }[] = [];
    for (let i = 0; i < npcs.length; i++) {
        for (let j = i + 1; j < npcs.length; j++) {
            const val = getRelVal(npcs[i].id, npcs[j].id);
            pairs.push({ a: npcs[i], b: npcs[j], val });
        }
    }
    pairs.sort((x, y) => Math.abs(y.val) - Math.abs(x.val));

    return (
        <div style={{ padding: 10 }} className="space-y-2">
            {pairs.map(({ a, b, val }) => {
                const { label } = getRelLabel(val);
                const isGrudge = (a.grudges ?? []).includes(b.id) || (b.grudges ?? []).includes(a.id);
                const isCrush = (a.crushes ?? []).includes(b.id) || (b.crushes ?? []).includes(a.id);
                const barWidth = Math.abs(val);
                const barColor = val > 0 ? '#5b9b6b' : '#b85050';

                return (
                    <div key={`${a.id}-${b.id}`} className="scrap-card flex items-center gap-2" style={{ borderRadius: 11, padding: '6px 9px' }}>
                        {/* 街坊 A */}
                        <div className="flex items-center gap-1 flex-shrink-0" style={{ minWidth: 0 }}>
                            <NPCAvatar name={a.name} size={16} className="rounded-md" />
                            <span className="font-hand truncate" style={{ fontSize: 11, color: '#5c574f', fontWeight: 700, maxWidth: 46 }}>{a.name}</span>
                        </div>

                        {/* 关系条 */}
                        <div className="flex-1 relative" style={{
                            height: 6, background: 'rgba(120,116,106,0.1)',
                            borderRadius: 999, border: '1px solid rgba(167,162,151,0.35)', overflow: 'hidden',
                        }}>
                            <div className="absolute top-0 h-full transition-all duration-300" style={{
                                width: `${barWidth}%`, background: barColor,
                                left: val >= 0 ? '50%' : `${50 - barWidth}%`,
                                ...(val >= 0 ? {} : { right: '50%', left: 'auto' }),
                                borderRadius: 999,
                            }} />
                            <div className="absolute top-0 left-1/2 w-px h-full" style={{ background: 'rgba(120,116,106,0.3)' }} />
                        </div>

                        {/* 标签 + 图标 */}
                        <div className="flex items-center gap-1 flex-shrink-0">
                            <span className="font-hand" style={{
                                fontSize: 11, fontWeight: 700,
                                color: val > 0 ? '#5b9b6b' : val < 0 ? '#b85050' : '#a79c8e',
                            }}>{label}</span>
                            {isGrudge && <span title="记仇"><IconFlame size={10} /></span>}
                            {isCrush && <span title="暗恋"><IconCrush size={10} /></span>}
                        </div>

                        {/* 街坊 B */}
                        <div className="flex items-center gap-1 flex-shrink-0" style={{ minWidth: 0 }}>
                            <span className="font-hand truncate" style={{ fontSize: 11, color: '#5c574f', fontWeight: 700, maxWidth: 46 }}>{b.name}</span>
                            <NPCAvatar name={b.name} size={16} className="rounded-md" />
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

export default RelationsTab;
