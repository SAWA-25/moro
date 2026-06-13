/**
 * GameOverOverlay — 整条街搬空了（拼贴手账 · 便签）
 */

import React from 'react';
import { Storefront, ArrowCounterClockwise } from '@phosphor-icons/react';

const GameOverOverlay: React.FC<{ reason?: string; onRestart: () => void }> = ({ reason, onRestart }) => (
    <div className="absolute inset-0 flex items-center justify-center z-50 px-4"
        style={{ background: 'rgba(43,41,51,0.42)', animation: 'fadeIn 0.25s ease' }}>
        <div className="scrap-card relative tilt-l" style={{
            width: '100%', maxWidth: 290, borderRadius: 16,
            borderTop: '4px solid #b03a34',
            animation: 'popIn 0.3s cubic-bezier(0.175,0.885,0.32,1.275)',
        }}>
            {/* 顶部胶带 */}
            <span style={{
                position: 'absolute', top: -10, left: '50%', transform: 'translateX(-50%) rotate(-2.5deg)',
                width: 96, height: 18, background: 'rgba(216,98,91,0.28)',
                borderLeft: '1px dashed rgba(176,58,52,0.5)', borderRight: '1px dashed rgba(176,58,52,0.5)',
                pointerEvents: 'none',
            }} />

            <div style={{ padding: '22px 18px 18px', textAlign: 'center' }}>
                <Storefront size={46} weight="duotone" style={{ color: '#b03a34', margin: '0 auto 6px' }} />

                <p className="font-hand" style={{ fontSize: 22, fontWeight: 700, color: '#2b2933', marginBottom: 4 }}>
                    整条街都搬空了
                </p>
                <p className="label-mono" style={{ fontSize: 8, color: '#a79c8e', marginBottom: 12 }}>the end of this page</p>

                <div style={{ padding: '9px 12px', marginBottom: 14, textAlign: 'left', background: 'rgba(120,116,106,0.06)', borderRadius: 10, border: '1px dashed rgba(167,162,151,0.45)' }}>
                    <p className="font-hand" style={{ fontSize: 13, color: '#6b665d', lineHeight: 1.6 }}>
                        {reason || '人都散了……这条街空空荡荡，只剩本子上的字。'}
                    </p>
                </div>

                <button onClick={onRestart}
                    className="scrap-btn w-full flex items-center justify-center gap-1.5"
                    style={{ padding: '11px', background: '#b03a34', fontFamily: 'var(--font-hand)', fontSize: 15, fontWeight: 700 }}>
                    <ArrowCounterClockwise size={15} weight="bold" /> 再开新的一页
                </button>
            </div>
        </div>
    </div>
);

export default GameOverOverlay;
