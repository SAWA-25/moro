import React, { useState, useEffect, useCallback } from 'react';
import { useOS } from '../../context/OSContext';
import { ArrowsClockwise, MapPin, Heart } from '@phosphor-icons/react';
import {
    CharTrajectory,
    TrajectoryNode,
    loadOrGenerateTrajectory,
    refreshAfterNodes,
    nodeWhen,
} from '../../utils/theaterTimeline';
import {
    PaperShell, ScrapScroll, ScrapHeader, PaperCard, Polaroid, WashiTape, WASHI, INK, INK_SOFT, type WashiColor,
} from './scrapbook';

/**
 * 小剧场·轨迹：回到过去的时间节点，看看那些你们还未曾相遇的日子。
 * 一个人不是从被看见的那一刻才开始存在的——回头看看角色原本走过的路，
 * 也看见自己是从什么时候开始，慢慢进入了 TA 的人生。
 *
 * 界面＝拼贴手账「旧时间线」：一条手缝的线，串起一张张贴上去的回忆剪贴。
 */

interface Props { onExit: () => void; }

const eraMeta: Record<TrajectoryNode['era'], { color: WashiColor; label: string; en: string }> = {
    before:  { color: 'lilac',  label: '遇见你之前',   en: 'BEFORE YOU' },
    meeting: { color: 'amber',  label: '你走进来的那天', en: 'THE DAY YOU CAME' },
    after:   { color: 'rose',   label: '相遇之后',     en: 'AFTER WE MET' },
};

const TrajectoryApp: React.FC<Props> = ({ onExit }) => {
    const { characters, userProfile, apiConfig, addToast } = useOS();
    const [selectedCharId, setSelectedCharId] = useState('');
    const [trajectory, setTrajectory] = useState<CharTrajectory | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [expandedId, setExpandedId] = useState<string | null>(null);

    const selectedChar = characters.find(c => c.id === selectedCharId);
    const userName = userProfile?.name || '你';
    const apiReady = !!(apiConfig?.baseUrl && apiConfig?.model);

    const load = useCallback(async (force: boolean) => {
        if (!selectedChar) return;
        if (!apiReady) { setError('还没配置主 API，去「文具盒」填好之后再回来翻轨迹。'); return; }
        setLoading(true);
        setError('');
        try {
            let t = await loadOrGenerateTrajectory(selectedChar, userName, apiConfig, { force });
            // 相遇之后可能又有新的自主生活事件，顺手刷新 after 段
            if (!force) t = await refreshAfterNodes(t, userName, selectedChar.name);
            setTrajectory(t);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setLoading(false);
        }
    }, [selectedChar, apiReady, apiConfig, userName]);

    useEffect(() => {
        if (selectedCharId) { setTrajectory(null); setExpandedId(null); void load(false); }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedCharId]);

    // ── 角色选择页 ──
    if (!selectedCharId) {
        return (
            <Shell onBack={onExit} title="轨迹" en="TRAJECTORY">
                <div className="px-7 pt-3 pb-6">
                    <PaperCard tilt={-0.6} tape="lilac" className="px-6 py-6">
                        <div className="text-2xl mb-2 select-none">🐾</div>
                        <p className="text-[13px] leading-relaxed" style={{ color: '#6b6456' }}>
                            一个人不是从被看见的那一刻才开始存在的。<br />
                            在遇见你之前，TA 也已经独自活过很久了。
                        </p>
                        <p className="text-[12px] mt-2" style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', color: '#8a7c5e' }}>
                            挑一个人，回去看看那些日子。
                        </p>
                    </PaperCard>
                </div>
                <CharPicker characters={characters} onPick={setSelectedCharId} />
            </Shell>
        );
    }

    return (
        <Shell
            onBack={() => { setSelectedCharId(''); setTrajectory(null); }}
            title={selectedChar?.name || '轨迹'}
            en="TRAJECTORY"
            right={trajectory && !loading ? (
                <button
                    onClick={() => { if (window.confirm('重新想象 TA 遇见你之前的人生？现有轨迹会被覆盖。')) void load(true); }}
                    className="relative inline-flex items-center gap-1 px-3 py-1.5 text-[10px] font-black active:scale-95 transition"
                    style={{ color: WASHI.sage.ink }}
                >
                    <span aria-hidden className="absolute inset-0 rounded-[5px]" style={{ background: WASHI.sage.base, transform: 'rotate(-2deg)' }} />
                    <span className="relative z-10 inline-flex items-center gap-1"><ArrowsClockwise size={12} weight="bold" /> 重走一遍</span>
                </button>
            ) : null}
        >
            {loading && (
                <div className="flex flex-col items-center justify-center py-24 text-center px-8">
                    <div className="text-3xl mb-4 select-none animate-pulse">🧭</div>
                    <p className="text-[13px] leading-relaxed" style={{ color: '#6b6456' }}>
                        正在回到 {selectedChar?.name} 走过的路上…
                        <br /><span className="text-[11px]" style={{ color: INK_SOFT }}>把那些没有你的日子，一帧一帧贴回来</span>
                    </p>
                </div>
            )}

            {!loading && error && <ErrorNote text={error} onRetry={apiReady ? () => void load(false) : undefined} />}

            {!loading && !error && trajectory && (
                <div className="px-5 pb-14 pt-1">
                    <Timeline trajectory={trajectory} expandedId={expandedId} onToggle={(id) => setExpandedId(prev => prev === id ? null : id)} />
                    <p className="text-center text-[11px] mt-9 tracking-[0.2em] select-none" style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', color: INK_SOFT }}>— 路还在往前走 —</p>
                </div>
            )}
        </Shell>
    );
};

// ── 时间线：手缝的线 + 回忆剪贴 ──
const Timeline: React.FC<{ trajectory: CharTrajectory; expandedId: string | null; onToggle: (id: string) => void }> = ({ trajectory, expandedId, onToggle }) => (
    <div className="relative">
        {trajectory.nodes.map((node, i) => {
            const meta = eraMeta[node.era];
            const c = WASHI[meta.color];
            const isMeeting = node.era === 'meeting';
            const expanded = expandedId === node.id || isMeeting;
            const prevEra = i > 0 ? trajectory.nodes[i - 1].era : null;
            const showEraLabel = node.era !== prevEra;
            const tilt = i % 2 === 0 ? -0.8 : 0.9;
            return (
                <div key={node.id}>
                    {showEraLabel && (
                        <div className="flex items-center gap-2 mt-6 mb-3 first:mt-1">
                            <WashiTape color={meta.color} rotate={-2} className="px-3 py-1 rounded-[3px] text-[11px] font-black" style={{ color: c.ink }}>{meta.label}</WashiTape>
                            <span className="text-[8px] tracking-[0.32em] uppercase" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>{meta.en}</span>
                            <span className="flex-1 h-px" style={{ backgroundImage: 'repeating-linear-gradient(90deg, rgba(150,140,120,0.5) 0 5px, transparent 5px 10px)' }} />
                        </div>
                    )}
                    <button onClick={() => !isMeeting && onToggle(node.id)} className="w-full flex gap-3 text-left group">
                        {/* 手缝线 + 线结 */}
                        <div className="flex flex-col items-center shrink-0" style={{ width: 20 }}>
                            <span className="rounded-full mt-2 transition-transform group-active:scale-90" style={{ width: isMeeting ? 14 : 10, height: isMeeting ? 14 : 10, background: c.ink, boxShadow: `0 0 0 3px ${c.base}` }} />
                            {i < trajectory.nodes.length - 1 && <span className="flex-1 w-px mt-1" style={{ backgroundImage: `repeating-linear-gradient(180deg, ${c.edge} 0 4px, transparent 4px 9px)`, minHeight: 26 }} />}
                        </div>
                        {/* 回忆剪贴 */}
                        <PaperCard tilt={tilt} tape={isMeeting ? 'amber' : null} pin={isMeeting} className="flex-1 mb-3 px-4 py-3.5">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-[13.5px] font-black" style={{ color: INK }}>{isMeeting && <span aria-hidden className="mr-1">★</span>}{node.title}</span>
                                <span className="text-[9.5px] shrink-0 whitespace-nowrap" style={{ color: INK_SOFT }}>{nodeWhen(node, trajectory.firstMetTs)}</span>
                            </div>
                            <p className={`text-[12px] leading-relaxed mt-1.5 ${expanded ? '' : 'line-clamp-2'}`} style={{ color: '#6b6456' }}>{node.scene}</p>
                            {expanded && (node.mood || node.place) && (
                                <div className="flex flex-wrap items-center gap-2 mt-2.5">
                                    {node.mood && <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full" style={{ background: WASHI.rose.base, color: WASHI.rose.ink }}><Heart size={10} weight="fill" />{node.mood}</span>}
                                    {node.place && <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full" style={{ background: WASHI.sky.base, color: WASHI.sky.ink }}><MapPin size={10} weight="fill" />{node.place}</span>}
                                </div>
                            )}
                        </PaperCard>
                    </button>
                </div>
            );
        })}
    </div>
);

// ── 错误便条（轨迹 / 对影共用）──
export const ErrorNote: React.FC<{ text: string; onRetry?: () => void }> = ({ text, onRetry }) => (
    <div className="px-6 mt-6">
        <PaperCard tilt={-1} tape="rose" className="px-5 py-4 text-center">
            <p className="text-[12px] leading-relaxed" style={{ color: '#8a5a52' }}>{text}</p>
            {onRetry && (
                <button onClick={onRetry} className="mt-3 px-4 py-1.5 rounded-full text-[11px] font-black active:scale-95 transition" style={{ background: '#3a3630', color: '#fcf8ef' }}>再试一次</button>
            )}
        </PaperCard>
    </div>
);

// ── 通用纸页外壳（轨迹 / 对影共用）──
export const Shell: React.FC<{ onBack: () => void; title: string; en?: string; right?: React.ReactNode; children: React.ReactNode }> = ({ onBack, title, en, right, children }) => (
    <PaperShell>
        <ScrapHeader title={title} en={en} onBack={onBack} right={right} />
        <ScrapScroll>{children}</ScrapScroll>
    </PaperShell>
);

// ── 角色选择：拍立得照片墙（轨迹 / 对影共用）──
export const CharPicker: React.FC<{ characters: ReturnType<typeof useOS>['characters']; onPick: (id: string) => void }> = ({ characters, onPick }) => {
    if (!characters.length) {
        return <p className="text-center text-[12px] px-8 py-12" style={{ color: INK_SOFT }}>还没有角色。先去认识一个人，才有路可回看。</p>;
    }
    return (
        <div className="grid grid-cols-3 gap-x-3 gap-y-5 px-6 pb-12 pt-2">
            {characters.map((c, i) => (
                <div key={c.id} className="flex justify-center">
                    <Polaroid src={c.avatar} caption={c.name} size={66} rotate={i % 3 === 0 ? -2.4 : i % 3 === 1 ? 1.8 : -1} onClick={() => onPick(c.id)} />
                </div>
            ))}
        </div>
    );
};

export default TrajectoryApp;
