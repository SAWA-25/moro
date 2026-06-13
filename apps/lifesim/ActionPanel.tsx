/**
 * ActionPanel — 行动面板（拼贴手账 · 抽屉纸条）
 */

import React, { useState } from 'react';
import { LifeSimState, SimEventType } from '../../types';
import { MaskHappy, UserPlus, Lightning, CheckCircle, X } from '@phosphor-icons/react';
import { NPCAvatar, IconFight, IconParty, IconRomance, IconGossip, IconRivalry, IconAlliance } from '../../utils/styledIcons';

const EVENT_TYPES: { type: SimEventType; label: string; Icon: React.FC<{ size?: number }> }[] = [
    { type: 'fight', label: '吵架', Icon: IconFight },
    { type: 'party', label: '联谊', Icon: IconParty },
    { type: 'romance', label: '暧昧', Icon: IconRomance },
    { type: 'gossip', label: '说闲话', Icon: IconGossip },
    { type: 'rivalry', label: '竞争', Icon: IconRivalry },
    { type: 'alliance', label: '结盟', Icon: IconAlliance },
];

const NPC_PERSONALITY_OPTIONS = [
    '社牛','社恐','卷王','摸鱼','文青','话题女王','职场精英','暖男/暖女',
    '叛逆','精致','独立','自恋','佛系','焦虑','八卦','高冷','上进',
    '有品味','消息灵通','目标明确','热心','老好人','不按常理出牌','外貌协会',
];

const NPC_STYLE_OPTIONS = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y'];

export interface StirAction {
    eventType: SimEventType;
    involvedNpcIds: string[];
    eventDesc: string;
    worldStory?: boolean;
}

export interface AddNpcAction {
    name: string;
    emoji: string;
    personalities: string[];
    familyId: string;
}

const ActionPanel: React.FC<{
    gameState: LifeSimState;
    mode: 'stir' | 'add';
    accent?: string;
    onStir: (action: StirAction) => void;
    onAdd: (action: AddNpcAction) => void;
    onClose: () => void;
}> = ({ gameState, mode, accent = '#6f9b6a', onStir, onAdd, onClose }) => {

    const [eventType, setEventType] = useState<SimEventType>('fight');
    const [eventDesc, setEventDesc] = useState('');
    const [npcName, setNpcName] = useState('');
    const [npcEmoji, setNpcEmoji] = useState(NPC_STYLE_OPTIONS[0]);
    const [personalities, setPersonalities] = useState<string[]>([]);
    const [familyId, setFamilyId] = useState('');

    const handleStir = () => {
        const shuffledNpcs = [...gameState.npcs].sort(() => Math.random() - 0.5);
        const autoCount = Math.min(shuffledNpcs.length, Math.floor(Math.random() * 2) + 2);
        const autoInvolved = shuffledNpcs.slice(0, autoCount).map(n => n.id);
        onStir({
            eventType,
            involvedNpcIds: autoInvolved,
            eventDesc: eventDesc || `${EVENT_TYPES.find(e => e.type === eventType)?.label}事件`,
            worldStory: true,
        });
    };

    const handleAdd = () => {
        if (!familyId || !npcName.trim() || personalities.length === 0) {
            alert('把名字、性格、要入住的门牌都填上吧！'); return;
        }
        onAdd({ name: npcName.trim(), emoji: npcEmoji, personalities, familyId });
    };

    const inputStyle: React.CSSProperties = {
        width: '100%', padding: '8px 11px', fontSize: 12,
        background: '#fbfaf7', border: '1px solid rgba(236,233,226,0.95)',
        outline: '1px dashed rgba(167,162,151,0.4)', outlineOffset: -3,
        borderRadius: 10, color: '#2b2933',
        fontFamily: 'var(--font-hand)',
    };
    const chipBase: React.CSSProperties = {
        padding: '4px 10px', fontSize: 12, borderRadius: 999,
        fontFamily: 'var(--font-hand)', fontWeight: 700,
        border: '1px solid rgba(236,233,226,0.95)',
        background: 'rgba(255,255,255,0.95)', color: '#5c574f',
        outline: '1px dashed rgba(167,162,151,0.36)', outlineOffset: -3,
    };
    const chipActive = (a: string): React.CSSProperties => ({ background: a, color: '#fbfaf7', borderColor: a, outlineColor: 'rgba(255,255,255,0.4)' });

    return (
        <div className="sj-sheet absolute inset-0 z-40 flex items-end justify-center"
            style={{ background: 'rgba(43,41,51,0.34)' }}
            onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <style>{`
                .sj-sheet { animation: fadeIn 0.25s ease; }
                .sj-sheet .sheet-card { animation: slideUp 0.3s cubic-bezier(0.25,1,0.5,1); }
            `}</style>
            <div className="sheet-card scrap-card w-full mx-2 mb-2 relative" style={{
                maxHeight: '72vh', display: 'flex', flexDirection: 'column', borderRadius: 18,
            }}>
                {/* 顶部和纸胶带 + 标题 */}
                <span style={{
                    position: 'absolute', top: -11, left: '50%', transform: 'translateX(-50%) rotate(-2deg)',
                    width: 120, height: 20, background: 'rgba(255,255,255,0.6)',
                    borderLeft: '1px dashed rgba(160,156,146,0.5)', borderRight: '1px dashed rgba(160,156,146,0.5)',
                    boxShadow: '0 2px 6px rgba(50,48,60,0.14)', pointerEvents: 'none',
                }} />
                <div className="flex items-center justify-between px-4 pt-4 pb-2">
                    <span className="flex items-center gap-1.5 font-hand" style={{ fontSize: 19, fontWeight: 700, color: '#2b2933' }}>
                        {mode === 'stir'
                            ? <><MaskHappy size={17} weight="bold" style={{ color: accent }} /> 搅局 · 给街角加点戏</>
                            : <><UserPlus size={17} weight="bold" style={{ color: accent }} /> 拉人 · 请位新邻居</>}
                    </span>
                    <button onClick={onClose} className="scrap-btn-paper flex items-center justify-center" style={{ width: 30, height: 30 }}>
                        <X size={14} weight="bold" />
                    </button>
                </div>
                <div className="lace-edge mx-4" />

                {/* 内容 */}
                <div className="overflow-y-auto overflow-x-hidden no-scrollbar flex-1" style={{ padding: '12px 16px 4px', minWidth: 0 }}>

                    {mode === 'stir' && (
                        <div className="space-y-3">
                            <p className="font-hand" style={{ fontSize: 13, color: '#a79c8e', lineHeight: 1.5 }}>
                                挑个搅局的法子，本子会自动把相关街坊卷进来 ✎
                            </p>

                            <div className="drawer-tag"><span>搅局的法子</span></div>
                            <div className="grid grid-cols-3 gap-1.5">
                                {EVENT_TYPES.map(et => {
                                    const sel = eventType === et.type;
                                    return (
                                        <button key={et.type} onClick={() => setEventType(et.type)}
                                            className="flex items-center justify-center gap-1 press-soft"
                                            style={{ ...chipBase, padding: '6px 4px', ...(sel ? chipActive(accent) : {}) }}>
                                            <et.Icon size={13} /> {et.label}
                                        </button>
                                    );
                                })}
                            </div>

                            <input value={eventDesc} onChange={e => setEventDesc(e.target.value)}
                                placeholder="想写点剧情？（可选）" style={inputStyle} />

                            <button onClick={handleStir}
                                className="scrap-btn w-full flex items-center justify-center gap-1.5"
                                style={{ padding: '11px', background: accent, fontFamily: 'var(--font-hand)', fontSize: 15, fontWeight: 700 }}>
                                <Lightning size={15} weight="bold" /> 搅动这条街！
                            </button>
                        </div>
                    )}

                    {mode === 'add' && (
                        <div className="space-y-3">
                            <div className="drawer-tag"><span>给 TA 取个名字</span></div>
                            <input value={npcName} onChange={e => setNpcName(e.target.value)}
                                placeholder="写下名字…" style={inputStyle} />

                            <div className="drawer-tag"><span>头像风格</span></div>
                            <div className="flex flex-wrap gap-1.5">
                                {NPC_STYLE_OPTIONS.map(e => (
                                    <button key={e} onClick={() => setNpcEmoji(e)}
                                        style={{
                                            borderRadius: 8, overflow: 'hidden', padding: 2,
                                            border: npcEmoji === e ? `2px solid ${accent}` : '2px solid transparent',
                                            background: npcEmoji === e ? `${accent}22` : 'transparent',
                                        }}>
                                        <NPCAvatar name={e + (npcName || 'NPC')} size={24} className="rounded-md" />
                                    </button>
                                ))}
                            </div>

                            <div className="drawer-tag"><span>性格 · 至少 1 个</span></div>
                            <div className="flex flex-wrap gap-1.5">
                                {NPC_PERSONALITY_OPTIONS.map(p => {
                                    const sel = personalities.includes(p);
                                    return (
                                        <button key={p} onClick={() => setPersonalities(
                                            sel ? personalities.filter(x => x !== p) : [...personalities, p]
                                        )} style={{ ...chipBase, padding: '3px 9px', ...(sel ? chipActive(accent) : {}) }}>
                                            {p}
                                        </button>
                                    );
                                })}
                            </div>

                            <div className="drawer-tag"><span>入住哪个门牌</span></div>
                            <div className="grid grid-cols-2 gap-1.5">
                                {gameState.families.map(f => {
                                    const sel = familyId === f.id;
                                    return (
                                        <button key={f.id} onClick={() => setFamilyId(f.id)}
                                            className="flex items-center justify-center gap-1.5 press-soft"
                                            style={{ ...chipBase, padding: '6px 8px', ...(sel ? chipActive(accent) : {}) }}>
                                            <NPCAvatar name={f.name} size={14} className="rounded-sm" /> {f.name}
                                        </button>
                                    );
                                })}
                            </div>

                            <button onClick={handleAdd}
                                className="scrap-btn w-full flex items-center justify-center gap-1.5"
                                style={{ padding: '11px', marginTop: 2, background: accent, fontFamily: 'var(--font-hand)', fontSize: 15, fontWeight: 700 }}>
                                <CheckCircle size={15} weight="bold" /> 请 TA 入住
                            </button>
                        </div>
                    )}
                </div>

                {/* 关闭 */}
                <div style={{ padding: '8px 16px 14px' }}>
                    <button onClick={onClose} className="scrap-btn-paper w-full" style={{ padding: '9px', fontFamily: 'var(--font-hand)', fontSize: 14, fontWeight: 700 }}>
                        先收起来
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ActionPanel;
