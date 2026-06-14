import React, { useState, useEffect, useCallback } from 'react';
import { useOS } from '../../context/OSContext';
import { ArrowsClockwise } from '@phosphor-icons/react';
import {
    CharTrajectory,
    ReflectionScene,
    loadOrGenerateTrajectory,
    generateReflection,
    nodeWhen,
} from '../../utils/theaterTimeline';
import { Shell, CharPicker, ErrorNote } from './TrajectoryApp';
import { PaperCard, WashiTape, WASHI, INK, INK_SOFT } from './scrapbook';

/**
 * 小剧场·对影：同一个人，在不同时间里的相逢。
 * 看见 TA 并不是突然变成今天的样子；也看见某个人，真的让命运偏离过原本的方向。
 * 举杯邀明月，对影成几人。—— 联动「轨迹」的时间节点。
 *
 * 界面＝拼贴手账「双重曝光」：从旧时间线里挑两张剪贴，叫两个 TA 在同一页照面。
 */

interface Props { onExit: () => void; }

const ReflectionApp: React.FC<Props> = ({ onExit }) => {
    const { characters, userProfile, apiConfig, addToast } = useOS();
    const [selectedCharId, setSelectedCharId] = useState('');
    const [trajectory, setTrajectory] = useState<CharTrajectory | null>(null);
    const [loadingTraj, setLoadingTraj] = useState(false);
    const [error, setError] = useState('');
    const [pick, setPick] = useState<string[]>([]); // 选中的两个节点 id
    const [scene, setScene] = useState<ReflectionScene | null>(null);
    const [generating, setGenerating] = useState(false);

    const selectedChar = characters.find(c => c.id === selectedCharId);
    const userName = userProfile?.name || '你';
    const apiReady = !!(apiConfig?.baseUrl && apiConfig?.model);

    const loadTraj = useCallback(async () => {
        if (!selectedChar) return;
        if (!apiReady) { setError('还没配置主 API，去「文具盒」填好之后再来对影。'); return; }
        setLoadingTraj(true);
        setError('');
        try {
            const t = await loadOrGenerateTrajectory(selectedChar, userName, apiConfig);
            setTrajectory(t);
            // 默认挑：最早的「遇见之前」 + 最后一个节点（此刻的 TA）
            const before = t.nodes.find(n => n.era === 'before');
            const last = t.nodes[t.nodes.length - 1];
            const uniq = Array.from(new Set([before?.id, last?.id].filter(Boolean))) as string[];
            setPick(uniq.length === 2 ? uniq : []);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setLoadingTraj(false);
        }
    }, [selectedChar, apiReady, apiConfig, userName]);

    useEffect(() => {
        if (selectedCharId) { setTrajectory(null); setScene(null); setPick([]); void loadTraj(); }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedCharId]);

    const togglePick = (id: string) => {
        setScene(null);
        setPick(prev => {
            if (prev.includes(id)) return prev.filter(x => x !== id);
            if (prev.length >= 2) return [prev[1], id]; // 满了就顶掉最早选的
            return [...prev, id];
        });
    };

    const doGenerate = async () => {
        if (!trajectory || !selectedChar || pick.length !== 2) return;
        const a = trajectory.nodes.find(n => n.id === pick[0]);
        const b = trajectory.nodes.find(n => n.id === pick[1]);
        if (!a || !b) return;
        setGenerating(true);
        setError('');
        try {
            const s = await generateReflection(selectedChar, userName, a, b, trajectory.firstMetTs, apiConfig);
            setScene(s);
        } catch (e) {
            addToast(e instanceof Error ? e.message : '对影生成失败', 'error');
        } finally {
            setGenerating(false);
        }
    };

    // ── 角色选择页 ──
    if (!selectedCharId) {
        return (
            <Shell onBack={onExit} title="对影" en="REFLECTION">
                <div className="px-7 pt-3 pb-6">
                    <PaperCard tilt={0.6} tape="butter" className="px-6 py-6">
                        <div className="text-2xl mb-2 select-none">🌙🍶</div>
                        <p className="text-[13px] leading-relaxed" style={{ color: '#6b6456' }}>
                            同一个人，在不同时间里的相逢。<br />
                            看见 TA 并非突然变成今天的样子，<br />
                            也看见——是谁让命运偏离过原本的方向。
                        </p>
                        <p className="text-[12.5px] mt-2.5" style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', color: '#8a7c5e' }}>
                            举杯邀明月，对影成几人。
                        </p>
                    </PaperCard>
                </div>
                <CharPicker characters={characters} onPick={setSelectedCharId} />
            </Shell>
        );
    }

    return (
        <Shell onBack={() => { setSelectedCharId(''); setTrajectory(null); setScene(null); }} title={selectedChar?.name || '对影'} en="REFLECTION">
            {loadingTraj && (
                <div className="flex flex-col items-center justify-center py-24 text-center px-8">
                    <div className="text-3xl mb-4 select-none animate-pulse">🌙</div>
                    <p className="text-[13px]" style={{ color: '#6b6456' }}>正在翻出 {selectedChar?.name} 走过的那条路…</p>
                </div>
            )}

            {!loadingTraj && error && <ErrorNote text={error} onRetry={apiReady ? () => void loadTraj() : undefined} />}

            {!loadingTraj && !error && trajectory && (
                <div className="px-5 pb-14">
                    {/* 节点挑选 */}
                    <div className="pt-3 pb-3">
                        <p className="text-[12px] leading-relaxed mb-3 px-1" style={{ color: '#6b6456' }}>
                            从 TA 的轨迹里挑 <span className="font-black px-1 rounded" style={{ background: WASHI.amber.base, color: WASHI.amber.ink }}>两个时刻</span>，让那两个 TA 在此刻照面。
                        </p>
                        <div className="space-y-2.5">
                            {trajectory.nodes.map((node, i) => {
                                const idx = pick.indexOf(node.id);
                                const selected = idx >= 0;
                                return (
                                    <PaperCard key={node.id} onClick={() => togglePick(node.id)} tilt={i % 2 ? 0.5 : -0.5}
                                        className="px-3.5 py-2.5 flex items-start gap-2.5"
                                        style={selected ? { background: 'linear-gradient(180deg,#fff6e2,#f6e9c8)', borderColor: WASHI.amber.edge } : undefined}>
                                        <span className="mt-0.5 w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-[10px] font-black" style={selected ? { background: '#3a3630', color: '#fcf8ef' } : { background: 'rgba(176,162,138,0.3)', color: INK_SOFT }}>
                                            {selected ? (idx + 1) : ''}
                                        </span>
                                        <span className="min-w-0 flex-1">
                                            <span className="flex items-center justify-between gap-2">
                                                <span className="text-[12.5px] font-black truncate" style={{ color: INK }}>{node.title}</span>
                                                <span className="text-[9px] shrink-0" style={{ color: INK_SOFT }}>{nodeWhen(node, trajectory.firstMetTs)}</span>
                                            </span>
                                            <span className="block text-[11px] line-clamp-1 mt-0.5" style={{ color: '#8b8576' }}>{node.scene}</span>
                                        </span>
                                    </PaperCard>
                                );
                            })}
                        </div>

                        <button
                            disabled={pick.length !== 2 || generating}
                            onClick={doGenerate}
                            className="mt-5 w-full py-3 rounded-full text-[13px] font-black tracking-wide transition-all active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-45"
                            style={pick.length === 2 && !generating
                                ? { background: '#3a3630', color: '#fcf8ef', outline: '1px dashed rgba(255,255,255,0.3)', outlineOffset: -4, boxShadow: '0 12px 22px -12px rgba(58,54,48,0.6)' }
                                : { background: 'rgba(255,253,247,0.9)', color: INK_SOFT, border: '1px dashed rgba(150,140,120,0.6)' }}
                        >
                            {generating ? <><span className="animate-pulse">✶</span> 两个 TA 正在照面…</> : <>🌗 对影成几人</>}
                        </button>
                    </div>

                    {/* 生成结果 */}
                    {scene && <ReflectionView scene={scene} onRegen={doGenerate} regenerating={generating} />}
                </div>
            )}
        </Shell>
    );
};

const ReflectionView: React.FC<{ scene: ReflectionScene; onRegen: () => void; regenerating: boolean }> = ({ scene, onRegen, regenerating }) => (
    <PaperCard tilt={-0.5} className="mt-6 px-5 py-6 relative overflow-hidden animate-fade-in">
        <WashiTape color="lilac" rotate={-6} className="absolute -top-3 right-6 w-20 h-6 rounded-[2px]" />
        <div aria-hidden className="pointer-events-none absolute -top-4 -right-2 text-7xl opacity-[0.06] select-none">🌙</div>
        <div className="text-center mb-5 relative z-10">
            <h3 className="text-[24px] font-black tracking-wide" style={{ color: INK }}>{scene.title}</h3>
            {scene.subtitle && <p className="text-[11.5px] mt-1.5" style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', color: '#8a7c5e' }}>{scene.subtitle}</p>}
        </div>
        <div className="space-y-3 relative z-10">
            {scene.lines.map((line, i) => {
                if (line.who === 'narration') {
                    return <p key={i} className="text-center text-[11.5px] px-4 py-1 leading-relaxed" style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', color: INK_SOFT }}>— {line.text} —</p>;
                }
                const isNow = line.who === 'now';
                const c = isNow ? WASHI.amber : WASHI.lilac;
                return (
                    <div key={i} className={`flex ${isNow ? 'justify-end' : 'justify-start'}`}>
                        <div className="max-w-[82%] px-3.5 py-2.5 text-[12.5px] leading-relaxed" style={{ background: c.base, color: '#4a4334', borderRadius: isNow ? '12px 12px 4px 12px' : '12px 12px 12px 4px', boxShadow: '0 6px 12px -8px rgba(70,62,48,0.4)' }}>
                            <span className="block text-[9px] font-black mb-1 tracking-wider" style={{ color: c.ink }}>{isNow ? '此刻的 TA' : '从前的 TA'}</span>
                            {line.text}
                        </div>
                    </div>
                );
            })}
        </div>
        <div className="flex justify-center mt-6 relative z-10">
            <button onClick={onRegen} disabled={regenerating} className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[10.5px] font-black active:scale-95 transition disabled:opacity-45" style={{ background: 'rgba(255,253,247,0.95)', color: '#6b6456', border: '1px dashed rgba(150,140,120,0.6)' }}>
                <ArrowsClockwise size={12} weight="bold" /> 再照一次
            </button>
        </div>
    </PaperCard>
);

export default ReflectionApp;
