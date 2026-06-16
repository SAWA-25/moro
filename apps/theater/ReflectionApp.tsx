import React, { useState, useEffect, useCallback } from 'react';
import { useOS } from '../../context/OSContext';
import { Users, Sparkle, MoonStars, ArrowsClockwise } from '@phosphor-icons/react';
import {
    CharTrajectory,
    TrajectoryNode,
    ReflectionScene,
    loadOrGenerateTrajectory,
    generateReflection,
    nodeWhen,
} from '../../utils/theaterTimeline';
import { Shell, CharPicker } from './TrajectoryApp';

/**
 * 小剧场·对影：同一个人，在不同时间里的相逢。
 * 看见 TA 并不是突然变成今天的样子；也看见某个人，真的让命运偏离过原本的方向。
 * 举杯邀明月，对影成几人。—— 联动「轨迹」的时间节点。
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
            <Shell onBack={onExit} title="对影">
                <div className="px-6 pt-2 pb-5 text-center">
                    <Users size={30} weight="duotone" className="mx-auto text-amber-200/80 mb-3" />
                    <p className="text-[13px] leading-relaxed text-white/55">
                        同一个人，在不同时间里的相逢。<br />
                        看见 TA 并非突然变成今天的样子，<br />
                        也看见——是谁让命运偏离过原本的方向。<br />
                        <span className="text-white/40 italic">举杯邀明月，对影成几人。</span>
                    </p>
                </div>
                <CharPicker characters={characters} onPick={setSelectedCharId} />
            </Shell>
        );
    }

    return (
        <Shell onBack={() => { setSelectedCharId(''); setTrajectory(null); setScene(null); }} title={selectedChar?.name || '对影'}>
            {loadingTraj && (
                <div className="flex flex-col items-center justify-center py-24 text-center px-8">
                    <MoonStars size={32} weight="duotone" className="text-amber-200/80 animate-pulse mb-4" />
                    <p className="text-[13px] text-white/60">正在翻出 {selectedChar?.name} 走过的那条路…</p>
                </div>
            )}

            {!loadingTraj && error && (
                <div className="mx-6 mt-6 rounded-2xl border border-rose-300/20 bg-rose-500/10 px-5 py-4 text-center">
                    <p className="text-[12px] text-rose-100/80 leading-relaxed">{error}</p>
                    {apiReady && <button onClick={() => void loadTraj()} className="mt-3 px-4 py-1.5 rounded-full text-[11px] font-bold bg-white/10 hover:bg-white/15 text-white/75 active:scale-95 transition">再试一次</button>}
                </div>
            )}

            {!loadingTraj && !error && trajectory && (
                <div className="px-5 pb-12">
                    {/* 节点挑选 */}
                    <div className="pt-2 pb-3">
                        <p className="text-[11px] text-white/45 leading-relaxed mb-3 px-1">
                            从 TA 的轨迹里挑 <span className="text-amber-200/90 font-bold">两个时刻</span>，让那两个 TA 在此刻相逢。
                        </p>
                        <div className="space-y-2">
                            {trajectory.nodes.map(node => {
                                const idx = pick.indexOf(node.id);
                                const selected = idx >= 0;
                                return (
                                    <button
                                        key={node.id}
                                        onClick={() => togglePick(node.id)}
                                        className={`w-full text-left rounded-xl px-3.5 py-2.5 border transition-all flex items-start gap-2.5 ${selected ? 'border-amber-300/40 bg-amber-400/[0.12]' : 'border-white/[0.07] bg-white/[0.03] hover:bg-white/[0.05]'}`}
                                    >
                                        <span className={`mt-0.5 w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-[10px] font-black ${selected ? 'bg-amber-300 text-[#14101c]' : 'bg-white/10 text-white/40'}`}>
                                            {selected ? (idx + 1) : ''}
                                        </span>
                                        <span className="min-w-0 flex-1">
                                            <span className="flex items-center justify-between gap-2">
                                                <span className="text-[12.5px] font-bold text-white/85 truncate">{node.title}</span>
                                                <span className="text-[9px] text-white/35 shrink-0">{nodeWhen(node, trajectory.firstMetTs)}</span>
                                            </span>
                                            <span className="block text-[11px] text-white/45 line-clamp-1 mt-0.5">{node.scene}</span>
                                        </span>
                                    </button>
                                );
                            })}
                        </div>

                        <button
                            disabled={pick.length !== 2 || generating}
                            onClick={doGenerate}
                            className={`mt-4 w-full py-3 rounded-2xl text-[13px] font-black tracking-wide transition-all active:scale-[0.98] flex items-center justify-center gap-2 ${pick.length === 2 && !generating ? 'bg-gradient-to-r from-amber-300 to-rose-300 text-[#14101c] shadow-lg shadow-amber-500/20' : 'bg-white/[0.06] text-white/30'}`}
                        >
                            {generating ? <><Sparkle size={15} weight="fill" className="animate-pulse" /> 两个 TA 正在照面…</> : <><Users size={15} weight="bold" /> 对影成几人</>}
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
    <div className="mt-6 rounded-3xl border border-white/[0.08] bg-gradient-to-b from-white/[0.05] to-transparent px-5 py-6 animate-fade-in relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute -top-10 right-0 opacity-20"><MoonStars size={90} weight="fill" className="text-amber-200" /></div>
        <div className="text-center mb-5 relative z-10">
            <h3 className="text-2xl font-black tracking-wide bg-clip-text text-transparent bg-gradient-to-r from-amber-200 via-rose-200 to-amber-200">{scene.title}</h3>
            {scene.subtitle && <p className="text-[11px] text-white/40 italic mt-1.5">{scene.subtitle}</p>}
        </div>
        <div className="space-y-3 relative z-10">
            {scene.lines.map((line, i) => {
                if (line.who === 'narration') {
                    return <p key={i} className="text-center text-[11.5px] text-white/40 italic px-4 py-1 leading-relaxed">— {line.text} —</p>;
                }
                const isNow = line.who === 'now';
                return (
                    <div key={i} className={`flex ${isNow ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[82%] px-3.5 py-2.5 rounded-2xl text-[12.5px] leading-relaxed ${isNow ? 'bg-amber-400/[0.16] border border-amber-300/20 text-amber-50/90 rounded-br-md' : 'bg-indigo-400/[0.12] border border-indigo-300/15 text-indigo-50/85 rounded-bl-md'}`}>
                            <span className={`block text-[9px] font-bold mb-1 tracking-wider ${isNow ? 'text-amber-200/70' : 'text-indigo-200/60'}`}>{isNow ? '此刻的 TA' : '从前的 TA'}</span>
                            {line.text}
                        </div>
                    </div>
                );
            })}
        </div>
        <div className="flex justify-center mt-6 relative z-10">
            <button onClick={onRegen} disabled={regenerating} className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[10px] font-bold bg-white/8 hover:bg-white/12 text-white/55 active:scale-95 transition disabled:opacity-40">
                <ArrowsClockwise size={12} weight="bold" /> 再照一次
            </button>
        </div>
    </div>
);

export default ReflectionApp;
