/**
 * NarrativeReplayOverlay — 叙事回放（拼贴手账 · 翻页明信片）
 */

import React from 'react';
import { SimAction } from '../../types';
import {
    Alien, BookOpen, Lightning, Globe, ChatCircleDots, BookmarkSimple, CaretRight,
} from '@phosphor-icons/react';
import StoryAttachments from './StoryAttachments';
import { formatLifeSimActionDescription } from '../../utils/lifeSimTone';

const TONE_STYLES: Record<string, { accent: string; label: string }> = {
    vengeful: { accent: '#b85050', label: '复仇' },
    romantic: { accent: '#c06090', label: '浪漫' },
    scheming: { accent: '#8b6bb8', label: '阴谋' },
    chaotic:  { accent: '#c07040', label: '混乱' },
    peaceful: { accent: '#5b9b6b', label: '平和' },
    amused:   { accent: '#b89840', label: '有趣' },
    anxious:  { accent: '#5070b0', label: '焦虑' },
};

const NarrativeReplayOverlay: React.FC<{
    actions: SimAction[];
    currentIndex: number;
    onNext: () => void;
}> = ({ actions, currentIndex, onNext }) => {
    const action = actions[currentIndex];
    if (!action) return null;
    const isLast = currentIndex >= actions.length - 1;
    const narrative = action.narrative;
    const displayDescription = formatLifeSimActionDescription(action.description);
    const tone = narrative?.emotionalTone;
    const toneStyle = tone ? TONE_STYLES[tone] : null;
    const storyLabel = action.storyKind === 'main_plot'
        ? '主线剧情'
        : action.storyKind === 'character_drama'
            ? '街坊剧情'
            : action.storyKind === 'system'
                ? '系统播报'
                : null;
    const accent = action.storyKind === 'main_plot'
        ? '#b86c3d'
        : action.storyKind === 'system'
            ? '#9b958a'
            : toneStyle?.accent || '#6f9b6a';

    const box: React.CSSProperties = {
        padding: '7px 10px', borderRadius: 10, marginBottom: 9,
        background: 'rgba(120,116,106,0.05)', border: '1px dashed rgba(167,162,151,0.45)',
    };

    return (
        <div className="absolute inset-0 flex items-center justify-center z-50 px-4"
            style={{ background: 'rgba(43,41,51,0.4)', animation: 'fadeIn 0.25s ease' }}>
            <div className="scrap-card relative" style={{
                width: '100%', maxWidth: 320,
                maxHeight: 'calc(var(--app-height, 100lvh) - 32px)',
                borderTop: `4px solid ${accent}`,
                borderRadius: 16,
                display: 'flex', flexDirection: 'column', minHeight: 0,
                animation: 'popIn 0.3s cubic-bezier(0.175,0.885,0.32,1.275)',
            }}>
                {/* 顶部胶带 */}
                <span style={{
                    position: 'absolute', top: -10, left: '50%', transform: 'translateX(-50%) rotate(-2deg)',
                    width: 100, height: 18, background: `${accent}33`,
                    borderLeft: `1px dashed ${accent}66`, borderRight: `1px dashed ${accent}66`,
                    pointerEvents: 'none',
                }} />

                {/* 页眉 */}
                <div className="flex items-center justify-between px-4 pt-4 pb-2">
                    <span className="font-hand" style={{ fontSize: 16, fontWeight: 700, color: accent }}>回放</span>
                    <div className="flex items-center gap-1.5">
                        {storyLabel && <span className="font-hand" style={{ fontSize: 11, color: '#a79c8e' }}>{storyLabel}</span>}
                        {toneStyle && <span style={{ fontSize: 9, fontWeight: 700, color: accent, border: `1px solid ${accent}55`, borderRadius: 999, padding: '0 6px' }}>{toneStyle.label}</span>}
                        <span className="label-mono" style={{ fontSize: 9, color: '#bcb5a8' }}>{currentIndex + 1}/{actions.length}</span>
                    </div>
                </div>
                <div className="lace-edge mx-4" />

                <div className="no-scrollbar" style={{ padding: 14, overflowY: 'auto', overflowX: 'hidden', minHeight: 0, flex: 1, overscrollBehavior: 'contain' }}>
                    {/* 人物 */}
                    <div className="flex items-start gap-2.5 mb-3">
                        <div style={{
                            width: 38, height: 38, borderRadius: 8, padding: 2,
                            background: '#fbfaf7', outline: '1px dashed rgba(167,162,151,0.5)', outlineOffset: -2,
                            display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0,
                        }}>
                            {action.actorAvatar?.startsWith('http') || action.actorAvatar?.startsWith('data:')
                                ? <img src={action.actorAvatar} style={{ width: 34, height: 34, objectFit: 'cover', borderRadius: 6 }} alt="" />
                                : action.actorAvatar ? <span style={{ fontSize: 18 }}>{action.actorAvatar}</span>
                                : <Alien size={18} weight="bold" style={{ color: '#bcb5a8' }} />}
                        </div>
                        <div>
                            <p className="font-hand" style={{ fontSize: 15, fontWeight: 700, color: accent }}>{action.actor}</p>
                            <p className="label-mono" style={{ fontSize: 8.5, color: '#bcb5a8' }}>page {action.turnNumber}</p>
                        </div>
                    </div>

                    {action.headline && (
                        <div style={box}>
                            <p className="font-hand" style={{ fontSize: 11, fontWeight: 700, color: accent, marginBottom: 3 }}>标题</p>
                            <p className="font-hand" style={{ fontSize: 16, color: '#2b2933', lineHeight: 1.4, fontWeight: 700 }}>{action.headline}</p>
                        </div>
                    )}

                    {(narrative?.innerThought || action.reasoning) && (
                        <div style={box}>
                            <p className="font-hand" style={{ fontSize: 11, fontWeight: 700, color: '#b89840', marginBottom: 3, display: 'flex', alignItems: 'center', gap: 3 }}>
                                <ChatCircleDots size={11} weight="bold" /> 内心独白
                            </p>
                            <p className="font-hand" style={{ fontSize: 13, color: '#887750', lineHeight: 1.55, fontStyle: 'italic' }}>
                                "{narrative?.innerThought || action.reasoning}"
                            </p>
                        </div>
                    )}

                    {narrative?.dialogue && (
                        <div style={box}>
                            <p className="font-hand" style={{ fontSize: 11, fontWeight: 700, color: '#a79c8e', marginBottom: 3, display: 'flex', alignItems: 'center', gap: 3 }}>
                                <BookOpen size={11} weight="bold" /> 场景
                            </p>
                            <p style={{ fontSize: 11.5, color: '#5c574f', lineHeight: 1.55 }}>{narrative.dialogue}</p>
                        </div>
                    )}

                    <p style={{ fontSize: 12, color: '#3f3a32', lineHeight: 1.55, marginBottom: 9, fontWeight: 500 }}>
                        {displayDescription}
                    </p>

                    <div style={{ ...box, marginBottom: 0 }}>
                        <p className="font-hand" style={{ fontSize: 11, fontWeight: 700, color: '#a79c8e', marginBottom: 3, display: 'flex', alignItems: 'center', gap: 3 }}>
                            <Lightning size={11} weight="bold" /> 结果
                        </p>
                        <p style={{ fontSize: 12, color: '#3f3a32', lineHeight: 1.5 }}>{action.immediateResult}</p>
                    </div>

                    <StoryAttachments attachments={action.attachments} />

                    {narrative?.commentOnWorld && (
                        <p style={{ fontSize: 10, color: '#a79c8e', fontStyle: 'italic', marginTop: 9, textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
                            <Globe size={9} weight="bold" /> "{narrative.commentOnWorld}"
                        </p>
                    )}

                    {action.reactionToUser && (
                        <p className="font-hand" style={{ fontSize: 12, color: '#9080a0', fontStyle: 'italic', marginTop: 5, textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
                            <ChatCircleDots size={10} weight="bold" /> "{action.reactionToUser}"
                        </p>
                    )}
                </div>

                {/* 翻页 */}
                <div style={{ padding: '10px 16px 14px' }}>
                    <button onClick={onNext}
                        className="scrap-btn w-full flex items-center justify-center gap-1.5"
                        style={{ padding: '11px', background: accent, fontFamily: 'var(--font-hand)', fontSize: 15, fontWeight: 700 }}>
                        {isLast ? <><BookmarkSimple size={15} weight="bold" /> 合上回放</> : <>翻下一页 <CaretRight size={14} weight="bold" /></>}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default NarrativeReplayOverlay;
