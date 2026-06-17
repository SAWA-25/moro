import React, { useState, useEffect, useCallback } from 'react';
import { useOS } from '../../context/OSContext';
import { ArrowsClockwise, Sparkle, MapPin, Heart, FilmReel } from '@phosphor-icons/react';
import {
    CharTrajectory,
    TrajectoryNode,
    loadOrGenerateTrajectory,
    refreshAfterNodes,
    nodeWhen,
} from '../../utils/theaterTimeline';
import { PaperShell, ScrapScroll, ScrapHeader, Polaroid, ScrapButton, WashiTape, INK, INK_SOFT } from './scrapbook';

/**
 * 折子戏·轨迹（陆）：回到过去的时间节点，看看那些你们还未曾相遇的日子。
 * 一个人不是从被看见的那一刻才开始存在的——回头看看角色原本走过的路，
 * 也看见自己是从什么时候开始，慢慢进入了 TA 的人生。黑白拼贴手账皮肤。
 */

interface Props { onExit: () => void; }

// 三段时期：黑白灰区分（相遇那天用墨黑强调）
const eraMeta: Record<TrajectoryNode['era'], { dot: string; line: string; label: string }> = {
    before:  { dot: '#a39d92', line: 'rgba(31,29,26,0.14)', label: '遇见你之前' },
    meeting: { dot: '#1f1d1a', line: 'rgba(31,29,26,0.42)', label: '你走进来的那天' },
    after:   { dot: '#6b6558', line: 'rgba(31,29,26,0.18)', label: '相遇之后' },
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
            <Shell onBack={onExit} title="轨迹" en="BEFORE WE MET">
                <div className="px-6 pt-3 pb-5 text-center">
                    <FilmReel size={30} weight="duotone" className="mx-auto mb-3" style={{ color: INK }} />
                    <p className="text-[13px] leading-relaxed" style={{ color: '#5b554a' }}>
                        一个人不是从被看见的那一刻才开始存在的。<br />
                        在遇见你之前，TA 也已经独自活过很久了。<br />
                        <span style={{ color: INK_SOFT }}>挑一个角色，回去看看那些日子。</span>
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
            en="BEFORE WE MET"
            right={trajectory && !loading ? (
                <ScrapButton variant="paper" className="px-3 py-1.5 text-[10px]" icon={<ArrowsClockwise size={12} weight="bold" />}
                    onClick={() => { if (window.confirm('重新想象 TA 遇见你之前的人生？现有轨迹会被覆盖。')) void load(true); }}>
                    重走一遍
                </ScrapButton>
            ) : null}
        >
            {loading && (
                <div className="flex flex-col items-center justify-center py-24 text-center px-8">
                    <div className="relative mb-5">
                        <FilmReel size={34} weight="duotone" className="animate-pulse" style={{ color: INK }} />
                        <Sparkle size={14} weight="fill" className="absolute -top-1 -right-2 animate-pulse" style={{ color: INK_SOFT }} />
                    </div>
                    <p className="text-[13px] leading-relaxed" style={{ color: '#5b554a' }}>正在回到 {selectedChar?.name} 走过的路上…<br /><span className="text-[11px]" style={{ color: INK_SOFT }}>把那些没有你的日子，一帧一帧找回来</span></p>
                </div>
            )}

            {!loading && error && (
                <div className="mx-6 mt-6 rounded-2xl px-5 py-4 text-center" style={{ border: '1px dashed rgba(150,144,132,0.6)', background: 'rgba(31,29,26,0.04)' }}>
                    <p className="text-[12px] leading-relaxed" style={{ color: '#6b6558' }}>{error}</p>
                    {apiReady && (
                        <ScrapButton variant="ink" className="mt-3 px-4 py-1.5 text-[11px]" onClick={() => void load(false)}>再试一次</ScrapButton>
                    )}
                </div>
            )}

            {!loading && !error && trajectory && (
                <div className="px-5 pb-12 pt-1">
                    <Timeline trajectory={trajectory} userName={userName} expandedId={expandedId} onToggle={(id) => setExpandedId(prev => prev === id ? null : id)} />
                    <p className="text-center text-[10px] mt-8 tracking-[0.3em] select-none" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>— 路 还 在 往 前 走 —</p>
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
                                <span className="text-[10px] font-black tracking-[0.16em] px-2.5 py-1 rounded-[4px]" style={{ background: isMeeting ? '#1f1d1a' : 'rgba(31,29,26,0.08)', color: isMeeting ? '#f6f3ec' : '#4a463e' }}>{meta.label}</span>
                                <span className="flex-1 h-px" style={{ backgroundImage: 'repeating-linear-gradient(90deg, rgba(140,132,118,0.55) 0 5px, transparent 5px 10px)' }} />
                            </div>
                        )}
                        <button onClick={() => !isMeeting && onToggle(node.id)} className="w-full flex gap-3 text-left group">
                            {/* 时间轴竖线 + 节点 */}
                            <div className="flex flex-col items-center shrink-0" style={{ width: 18 }}>
                                <span className="rounded-full mt-1.5 transition-transform group-active:scale-90" style={{ width: isMeeting ? 12 : 9, height: isMeeting ? 12 : 9, background: meta.dot, boxShadow: isMeeting ? '0 0 0 3px rgba(31,29,26,0.12)' : 'none' }} />
                                {i < trajectory.nodes.length - 1 && <span className="flex-1 w-px mt-1" style={{ background: meta.line, minHeight: 24 }} />}
                            </div>
                            {/* 纸卡 */}
                            <div className="relative flex-1 mb-3 rounded-[14px] px-4 py-3" style={{
                                background: isMeeting ? 'linear-gradient(180deg,#fbf9f2,#f0ede2)' : 'rgba(255,253,247,0.7)',
                                border: isMeeting ? '1px solid rgba(31,29,26,0.5)' : '1px solid rgba(176,170,158,0.6)',
                                outline: isMeeting ? '1px dashed rgba(31,29,26,0.3)' : 'none', outlineOffset: -5,
                                boxShadow: isMeeting ? '0 12px 22px -16px rgba(31,29,26,0.5)' : 'none',
                            }}>
                                {isMeeting && <WashiTape color="ink" rotate={-6} className="absolute -top-2.5 right-4 w-12 h-4 rounded-[2px] text-[7px] tracking-[0.2em]" style={{ fontFamily: 'var(--font-label)' }}>★</WashiTape>}
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-[13px] font-black" style={{ color: INK }}>{node.title}</span>
                                    <span className="text-[9.5px] shrink-0 whitespace-nowrap" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>{nodeWhen(node, trajectory.firstMetTs)}</span>
                                </div>
                                <p className={`text-[12px] leading-relaxed mt-1.5 ${expanded ? '' : 'line-clamp-2'}`} style={{ color: '#5b554a' }}>{node.scene}</p>
                                {expanded && (node.mood || node.place) && (
                                    <div className="flex flex-wrap items-center gap-2.5 mt-2">
                                        {node.mood && <span className="inline-flex items-center gap-1 text-[10px]" style={{ color: '#6b6558' }}><Heart size={10} weight="fill" />{node.mood}</span>}
                                        {node.place && <span className="inline-flex items-center gap-1 text-[10px]" style={{ color: '#6b6558' }}><MapPin size={10} weight="fill" />{node.place}</span>}
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

// ── 通用外壳（轨迹 / 对影 共用，黑白拼贴手账）──
export const Shell: React.FC<{ onBack: () => void; title: string; en?: string; right?: React.ReactNode; children: React.ReactNode }> = ({ onBack, title, en, right, children }) => (
    <PaperShell>
        <ScrapHeader title={title} en={en} onBack={onBack} right={right} />
        <ScrapScroll>{children}</ScrapScroll>
    </PaperShell>
);

// ── 角色选择（拍立得九宫格）──
export const CharPicker: React.FC<{ characters: ReturnType<typeof useOS>['characters']; onPick: (id: string) => void }> = ({ characters, onPick }) => {
    const list = characters;
    if (!list.length) {
        return <p className="text-center text-[12px] px-8 py-12" style={{ color: INK_SOFT }}>还没有角色。先去认识一个人，才有路可回看。</p>;
    }
    return (
        <div className="grid grid-cols-3 gap-x-3 gap-y-5 px-6 pb-10 place-items-center">
            {list.map((c, i) => (
                <Polaroid key={c.id} src={c.avatar} caption={c.name} size={72} rotate={i % 3 === 0 ? -2 : i % 3 === 1 ? 1.5 : -0.8} onClick={() => onPick(c.id)} />
            ))}
        </div>
    );
};

export default TrajectoryApp;
