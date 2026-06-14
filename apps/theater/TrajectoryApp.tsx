import React, { useState, useEffect, useCallback } from 'react';
import { useOS } from '../../context/OSContext';
import { ArrowLeft, Footprints, ArrowsClockwise, Sparkle, MapPin, Heart } from '@phosphor-icons/react';
import {
    CharTrajectory,
    TrajectoryNode,
    loadOrGenerateTrajectory,
    refreshAfterNodes,
    nodeWhen,
} from '../../utils/theaterTimeline';

/**
 * 小剧场·轨迹：回到过去的时间节点，看看那些你们还未曾相遇的日子。
 * 一个人不是从被看见的那一刻才开始存在的——回头看看角色原本走过的路，
 * 也看见自己是从什么时候开始，慢慢进入了 TA 的人生。
 */

interface Props { onExit: () => void; }

const eraMeta: Record<TrajectoryNode['era'], { dot: string; line: string; chip: string; label: string }> = {
    before: { dot: '#7c6f9a', line: 'rgba(124,111,154,0.35)', chip: 'text-indigo-200/70 border-indigo-300/20', label: '遇见你之前' },
    meeting: { dot: '#f5b971', line: 'rgba(245,185,113,0.6)', chip: 'text-amber-200 border-amber-300/40', label: '你走进来的那天' },
    after: { dot: '#e0879f', line: 'rgba(224,135,159,0.35)', chip: 'text-rose-200/80 border-rose-300/20', label: '相遇之后' },
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
        if (!apiReady) { setError('还没配置主 API，去「文具盒」填好之后再回来看轨迹。'); return; }
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
            <Shell onBack={onExit} title="轨迹">
                <div className="px-6 pt-2 pb-5 text-center">
                    <Footprints size={30} weight="duotone" className="mx-auto text-indigo-200/80 mb-3" />
                    <p className="text-[13px] leading-relaxed text-white/55">
                        一个人不是从被看见的那一刻才开始存在的。<br />
                        在遇见你之前，TA 也已经独自活过很久了。<br />
                        <span className="text-white/40">挑一个角色，回去看看那些日子。</span>
                    </p>
                </div>
                <CharPicker characters={characters} onPick={setSelectedCharId} />
            </Shell>
        );
    }

    return (
        <Shell
            onBack={() => { setSelectedCharId(''); setTrajectory(null); }}
            title={selectedChar?.name || '轨迹'}
            right={trajectory && !loading ? (
                <button
                    onClick={() => { if (window.confirm('重新想象 TA 遇见你之前的人生？现有轨迹会被覆盖。')) void load(true); }}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[10px] font-bold bg-white/10 hover:bg-white/15 text-white/70 active:scale-95 transition"
                >
                    <ArrowsClockwise size={12} weight="bold" /> 重走一遍
                </button>
            ) : null}
        >
            {loading && (
                <div className="flex flex-col items-center justify-center py-24 text-center px-8">
                    <div className="relative mb-5">
                        <Footprints size={34} weight="duotone" className="text-indigo-200/80 animate-pulse" />
                        <Sparkle size={14} weight="fill" className="absolute -top-1 -right-2 text-amber-300/70 animate-pulse" />
                    </div>
                    <p className="text-[13px] text-white/60 leading-relaxed">正在回到 {selectedChar?.name} 走过的路上…<br /><span className="text-white/35 text-[11px]">把那些没有你的日子，一帧一帧找回来</span></p>
                </div>
            )}

            {!loading && error && (
                <div className="mx-6 mt-6 rounded-2xl border border-rose-300/20 bg-rose-500/10 px-5 py-4 text-center">
                    <p className="text-[12px] text-rose-100/80 leading-relaxed">{error}</p>
                    {apiReady && (
                        <button onClick={() => void load(false)} className="mt-3 px-4 py-1.5 rounded-full text-[11px] font-bold bg-white/10 hover:bg-white/15 text-white/75 active:scale-95 transition">再试一次</button>
                    )}
                </div>
            )}

            {!loading && !error && trajectory && (
                <div className="px-5 pb-12 pt-1">
                    <Timeline trajectory={trajectory} userName={userName} expandedId={expandedId} onToggle={(id) => setExpandedId(prev => prev === id ? null : id)} />
                    <p className="text-center text-[10px] text-white/25 mt-8 tracking-wide select-none">— 路还在往前走 —</p>
                </div>
            )}
        </Shell>
    );
};

// ── 时间线 ──
const Timeline: React.FC<{ trajectory: CharTrajectory; userName: string; expandedId: string | null; onToggle: (id: string) => void }> = ({ trajectory, expandedId, onToggle }) => {
    return (
        <div className="relative">
            {trajectory.nodes.map((node, i) => {
                const meta = eraMeta[node.era];
                const isMeeting = node.era === 'meeting';
                const expanded = expandedId === node.id || isMeeting;
                const prevEra = i > 0 ? trajectory.nodes[i - 1].era : null;
                const showEraLabel = node.era !== prevEra;
                return (
                    <div key={node.id}>
                        {showEraLabel && (
                            <div className="flex items-center gap-2 mt-5 mb-2.5 first:mt-1">
                                <span className={`text-[10px] font-bold tracking-[0.2em] px-2 py-0.5 rounded-full border ${meta.chip}`}>{meta.label}</span>
                                <span className="flex-1 h-px" style={{ background: meta.line }} />
                            </div>
                        )}
                        <button
                            onClick={() => !isMeeting && onToggle(node.id)}
                            className="w-full flex gap-3 text-left group"
                        >
                            {/* 时间轴竖线 + 节点 */}
                            <div className="flex flex-col items-center shrink-0" style={{ width: 18 }}>
                                <span
                                    className="rounded-full mt-1.5 transition-transform group-active:scale-90"
                                    style={{ width: isMeeting ? 12 : 9, height: isMeeting ? 12 : 9, background: meta.dot, boxShadow: isMeeting ? `0 0 10px ${meta.dot}` : `0 0 5px ${meta.dot}66` }}
                                />
                                {i < trajectory.nodes.length - 1 && <span className="flex-1 w-px mt-1" style={{ background: meta.line, minHeight: 24 }} />}
                            </div>
                            {/* 卡片 */}
                            <div className={`flex-1 mb-3 rounded-2xl px-4 py-3 border transition-all ${isMeeting ? 'border-amber-300/30 bg-gradient-to-br from-amber-400/[0.14] to-rose-400/[0.05]' : 'border-white/[0.07] bg-white/[0.04] group-hover:bg-white/[0.06]'}`}>
                                <div className="flex items-center justify-between gap-2">
                                    <span className={`text-[13px] font-bold ${isMeeting ? 'text-amber-100' : 'text-white/85'}`}>{node.title}</span>
                                    <span className="text-[9.5px] text-white/35 shrink-0 whitespace-nowrap">{nodeWhen(node, trajectory.firstMetTs)}</span>
                                </div>
                                <p className={`text-[12px] leading-relaxed text-white/55 mt-1.5 ${expanded ? '' : 'line-clamp-2'}`}>{node.scene}</p>
                                {expanded && (node.mood || node.place) && (
                                    <div className="flex flex-wrap items-center gap-2 mt-2">
                                        {node.mood && <span className="inline-flex items-center gap-1 text-[10px] text-rose-200/70"><Heart size={10} weight="fill" />{node.mood}</span>}
                                        {node.place && <span className="inline-flex items-center gap-1 text-[10px] text-indigo-200/60"><MapPin size={10} weight="fill" />{node.place}</span>}
                                    </div>
                                )}
                            </div>
                        </button>
                    </div>
                );
            })}
        </div>
    );
};

// ── 通用外壳 ──
export const Shell: React.FC<{ onBack: () => void; title: string; right?: React.ReactNode; children: React.ReactNode }> = ({ onBack, title, right, children }) => (
    <div className="absolute inset-0 flex flex-col bg-[#14101c] text-white animate-fade-in overflow-hidden" style={{ paddingTop: 'var(--safe-top)' }}>
        <div aria-hidden className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-[140%] h-72 rounded-full blur-3xl opacity-30 bg-gradient-to-b from-indigo-400/40 via-rose-500/15 to-transparent" />
        <div className="relative flex items-center px-4 pt-3 pb-2 shrink-0 z-10">
            <button onClick={onBack} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-[11px] font-bold bg-white/10 hover:bg-white/15 text-white/80 active:scale-95 transition-all backdrop-blur-sm border border-white/10">
                <ArrowLeft size={14} weight="bold" /> 返回
            </button>
            <div className="absolute left-1/2 -translate-x-1/2 text-[13px] font-bold tracking-[0.15em] text-white/70 select-none">{title}</div>
            <div className="ml-auto z-10">{right}</div>
        </div>
        <div className="flex-1 overflow-y-auto no-scrollbar z-10">{children}</div>
    </div>
);

// ── 角色选择 ──
export const CharPicker: React.FC<{ characters: ReturnType<typeof useOS>['characters']; onPick: (id: string) => void }> = ({ characters, onPick }) => {
    const list = characters;
    if (!list.length) {
        return <p className="text-center text-[12px] text-white/40 px-8 py-12">还没有角色。先去认识一个人，才有路可回看。</p>;
    }
    return (
        <div className="grid grid-cols-3 gap-3 px-6 pb-10">
            {list.map(c => (
                <button key={c.id} onClick={() => onPick(c.id)} className="flex flex-col items-center gap-2 p-3 rounded-2xl bg-white/[0.04] border border-white/[0.07] hover:bg-white/[0.07] active:scale-95 transition">
                    <img src={c.avatar} alt={c.name} className="w-14 h-14 rounded-2xl object-cover border border-white/15" />
                    <span className="text-[11px] font-bold text-white/75 truncate max-w-full">{c.name}</span>
                </button>
            ))}
        </div>
    );
};

export default TrajectoryApp;
