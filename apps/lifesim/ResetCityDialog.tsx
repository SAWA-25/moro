import React from 'react';
import { Sparkle, X } from '@phosphor-icons/react';

const ResetCityDialog: React.FC<{
    participantCount: number;
    mainPlotCount: number;
    processing: boolean;
    onCancel: () => void;
    onArchiveAndReset: () => void;
    onDirectReset: () => void;
}> = ({ participantCount, mainPlotCount, processing, onCancel, onArchiveAndReset, onDirectReset }) => {
    return (
        <div
            className="absolute inset-0 z-50 flex items-center justify-center px-4"
            style={{ background: 'rgba(43,41,51,0.4)', animation: 'fadeIn 0.25s ease' }}
            onClick={event => { if (event.target === event.currentTarget && !processing) onCancel(); }}
        >
            <div className="scrap-card relative" style={{
                width: '100%', maxWidth: 340, borderRadius: 16,
                animation: 'popIn 0.3s cubic-bezier(0.175,0.885,0.32,1.275)',
            }}>
                {/* 顶部胶带 */}
                <span style={{
                    position: 'absolute', top: -10, left: '50%', transform: 'translateX(-50%) rotate(-2deg)',
                    width: 104, height: 18, background: 'rgba(255,255,255,0.6)',
                    borderLeft: '1px dashed rgba(160,156,146,0.5)', borderRight: '1px dashed rgba(160,156,146,0.5)',
                    pointerEvents: 'none',
                }} />

                <div className="flex items-center justify-between px-4 pt-4 pb-2">
                    <span className="flex items-center gap-1.5 font-hand" style={{ fontSize: 18, fontWeight: 700, color: '#2b2933' }}>
                        <Sparkle size={15} weight="fill" style={{ color: '#b03a34' }} /> 翻篇 · 收尾这一本
                    </span>
                    {!processing && (
                        <button onClick={onCancel} className="scrap-btn-paper flex items-center justify-center" style={{ width: 30, height: 30 }}>
                            <X size={14} weight="bold" />
                        </button>
                    )}
                </div>
                <div className="lace-edge mx-4" />

                <div style={{ padding: '12px 16px' }}>
                    <p className="font-hand" style={{ fontSize: 15, fontWeight: 700, color: '#2b2933', lineHeight: 1.5 }}>
                        要把这一本合上，再写一张小结吗？
                    </p>
                    <p className="font-hand" style={{ fontSize: 12, color: '#a79c8e', lineHeight: 1.6, marginTop: 6 }}>
                        这一本里有 {participantCount} 位角色登场，记下了 {mainPlotCount} 条主线。
                    </p>

                    <div style={{ padding: '8px 11px', marginTop: 9, background: 'rgba(120,116,106,0.06)', borderRadius: 10, border: '1px dashed rgba(167,162,151,0.45)' }}>
                        <p className="font-hand" style={{ fontSize: 12, color: '#6b665d', lineHeight: 1.6 }}>
                            「写小结」会调用 API，把这一本《街角》浓缩成一张拼贴小卡片，夹进参与角色的聊天记录里。
                        </p>
                    </div>
                </div>

                <div style={{ padding: '0 16px 16px' }} className="space-y-2">
                    <button onClick={onArchiveAndReset} disabled={processing}
                        className="scrap-btn w-full" style={{ padding: '11px', background: '#b03a34', opacity: processing ? 0.6 : 1, fontFamily: 'var(--font-hand)', fontSize: 15, fontWeight: 700 }}>
                        {processing ? '正在写小结…' : '写小结，合上本子'}
                    </button>
                    <button onClick={onDirectReset} disabled={processing}
                        className="scrap-btn-paper w-full" style={{ padding: '10px', opacity: processing ? 0.6 : 1, fontFamily: 'var(--font-hand)', fontSize: 14, fontWeight: 700, color: '#9a6a6a' }}>
                        不写了，直接翻篇
                    </button>
                    <button onClick={onCancel} disabled={processing}
                        className="w-full font-hand" style={{ padding: '8px', opacity: processing ? 0.6 : 1, fontSize: 13, fontWeight: 700, color: '#a79c8e', background: 'transparent', border: 'none' }}>
                        再想想
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ResetCityDialog;
