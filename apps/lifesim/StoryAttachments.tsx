import React, { useState } from 'react';
import { SimStoryAttachment } from '../../types';
import { BookOpen, FileText, ImageSquare, Package, X } from '@phosphor-icons/react';

const KIND_META = {
    image: { label: '插图', Icon: ImageSquare },
    item: { label: '道具', Icon: Package },
    fanfic: { label: '同人文', Icon: BookOpen },
    evidence: { label: '附件', Icon: FileText },
} as const;

const RARITY_COLORS = {
    common: '#8b8996',
    rare: '#5b7bb8',
    epic: '#9b5bb8',
} as const;

const StoryAttachments: React.FC<{
    attachments?: SimStoryAttachment[];
    compact?: boolean;
}> = ({ attachments, compact = false }) => {
    const [active, setActive] = useState<SimStoryAttachment | null>(null);

    if (!attachments || attachments.length === 0) return null;

    return (
        <>
            <div style={{ marginTop: compact ? 6 : 8, minWidth: 0 }}>
                <div className="flex items-center gap-1.5 mb-1.5">
                    <span className="font-hand" style={{ fontSize: compact ? 11 : 12, fontWeight: 700, color: '#9b6238' }}>
                        夹页
                    </span>
                    <span className="label-mono" style={{ fontSize: 8, color: '#bcb5a8' }}>{attachments.length} clippings</span>
                </div>
                <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1.5 pt-1">
                    {attachments.map((item, idx) => {
                        const meta = KIND_META[item.kind];
                        const Icon = meta.Icon;
                        const accent = RARITY_COLORS[item.rarity || 'common'];
                        return (
                            <button
                                key={item.id}
                                onClick={(event) => { event.stopPropagation(); setActive(item); }}
                                className="flex-shrink-0 press-soft relative"
                                style={{
                                    width: compact ? 120 : 134,
                                    textAlign: 'left',
                                    background: '#fbfaf7',
                                    border: '1px solid rgba(236,233,226,0.95)',
                                    outline: `1px dashed ${accent}55`, outlineOffset: -3,
                                    borderRadius: 8,
                                    padding: 7,
                                    boxShadow: '0 8px 16px -12px rgba(50,48,60,0.4)',
                                    rotate: idx % 2 ? '1.4deg' : '-1.4deg',
                                }}
                            >
                                {/* 角落胶带 */}
                                <span style={{
                                    position: 'absolute', top: -6, left: '50%', transform: 'translateX(-50%) rotate(-3deg)',
                                    width: 34, height: 11, background: `${accent}33`,
                                    borderLeft: `1px dashed ${accent}66`, borderRight: `1px dashed ${accent}66`,
                                    pointerEvents: 'none',
                                }} />
                                {item.imageUrl && (
                                    <img src={item.imageUrl} alt={item.title} style={{
                                        width: '100%', height: compact ? 58 : 66, objectFit: 'cover',
                                        borderRadius: 4, border: '1px solid rgba(0,0,0,0.06)', marginBottom: 5,
                                    }} />
                                )}
                                <div className="flex items-center gap-1">
                                    <Icon size={11} weight="bold" style={{ color: accent, flexShrink: 0 }} />
                                    <span className="font-hand" style={{ fontSize: 11, fontWeight: 700, color: accent }}>{meta.label}</span>
                                </div>
                                <div className="font-hand" style={{ fontSize: compact ? 12 : 13, fontWeight: 700, color: '#2b2933', marginTop: 2, lineHeight: 1.3, overflowWrap: 'anywhere' }}>
                                    {item.title}
                                </div>
                                <div style={{ fontSize: 9, color: '#a79c8e', marginTop: 2, lineHeight: 1.4, overflowWrap: 'anywhere' }}>
                                    {item.summary}
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>

            {active && (
                <div onClick={() => setActive(null)} style={{
                    position: 'fixed', inset: 0, background: 'rgba(43,41,51,0.42)', zIndex: 70,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
                    animation: 'fadeIn 0.2s ease',
                }}>
                    <div className="scrap-card" onClick={event => event.stopPropagation()} style={{
                        width: '100%', maxWidth: 360, maxHeight: '78vh', overflow: 'hidden',
                        display: 'flex', flexDirection: 'column', minWidth: 0, borderRadius: 16,
                    }}>
                        <div className="flex items-center justify-between px-4 pt-4 pb-2">
                            <span className="font-hand" style={{ fontSize: 18, fontWeight: 700, color: '#2b2933', minWidth: 0, overflowWrap: 'anywhere' }}>{active.title}</span>
                            <button onClick={() => setActive(null)} className="scrap-btn-paper flex items-center justify-center flex-shrink-0" style={{ width: 30, height: 30 }}>
                                <X size={14} weight="bold" />
                            </button>
                        </div>
                        <div className="lace-edge mx-4" />

                        <div className="no-scrollbar" style={{ padding: 14, overflowY: 'auto', overflowX: 'hidden' }}>
                            {active.imageUrl && (
                                <div className="sj-att-photo" style={{ position: 'relative', background: '#fbfaf7', padding: '8px 8px 8px', borderRadius: 6, border: '1px solid rgba(236,233,226,0.95)', marginBottom: 12, boxShadow: '0 10px 22px -16px rgba(50,48,60,0.4)' }}>
                                    <img src={active.imageUrl} alt={active.title} style={{ width: '100%', borderRadius: 3, border: '1px solid rgba(0,0,0,0.06)' }} />
                                </div>
                            )}

                            <div className="label-mono" style={{ fontSize: 9, color: '#9b6238', marginBottom: 6 }}>
                                {KIND_META[active.kind].label} · {(active.rarity || 'common').toUpperCase()}
                            </div>

                            {(active.kind === 'fanfic' || active.kind === 'evidence') && active.detail ? (
                                <>
                                    <div style={{ padding: '9px 11px', background: 'rgba(120,116,106,0.05)', borderRadius: 10, border: '1px dashed rgba(167,162,151,0.4)' }}>
                                        <div className="font-hand" style={{ fontSize: 12, color: '#a79c8e', fontWeight: 700, marginBottom: 4 }}>原文</div>
                                        <div style={{ fontSize: 12, color: '#4f4b58', lineHeight: 1.8, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{active.detail}</div>
                                    </div>
                                    <div style={{ fontSize: 11, color: '#7b7387', lineHeight: 1.6, marginTop: 10, overflowWrap: 'anywhere' }}>{active.summary}</div>
                                </>
                            ) : (
                                <>
                                    <div style={{ fontSize: 13, color: '#3f3a32', lineHeight: 1.65, overflowWrap: 'anywhere' }}>{active.summary}</div>
                                    {active.detail && (
                                        <div style={{ padding: '9px 11px', marginTop: 11, background: 'rgba(120,116,106,0.05)', borderRadius: 10, border: '1px dashed rgba(167,162,151,0.4)' }}>
                                            <div className="font-hand" style={{ fontSize: 12, color: '#a79c8e', fontWeight: 700, marginBottom: 4 }}>展开看看</div>
                                            <div style={{ fontSize: 12, color: '#4f4b58', lineHeight: 1.75, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{active.detail}</div>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default StoryAttachments;
