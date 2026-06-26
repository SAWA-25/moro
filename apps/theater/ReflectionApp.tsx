import React, { useState, useEffect, useCallback } from 'react';
import { useOS } from '../../context/OSContext';
import { MaskSad, Sparkle, MoonStars, ArrowsClockwise } from '@phosphor-icons/react';
import {
    CharTrajectory,
    TrajectoryNode,
    ReflectionScene,
    loadOrGenerateTrajectory,
    generateReflection,
    nodeWhen,
} from '../../utils/theaterTimeline';
import { Shell, CharPicker } from './TrajectoryApp';
import { ScrapButton, WashiTape, HALFTONE, INK, INK_SOFT } from '../ui/insScrapKit';
import { resolveAuxApi } from '../../utils/auxApi';

/**
 * 折子戏·对影（柒）：同一个人，在不同时间里的相逢。
 * 看见 TA 并不是突然变成今天的样子；也看见某个人，真的让命运偏离过原本的方向。
 * 举杯邀明月，对影成几人。—— 联动「轨迹」的时间节点。黑白拼贴手账皮肤。
 */

interface Props { onExit: () => void; }

const ReflectionApp: React.FC<Props> = ({ onExit }) => {
    const { characters, userProfile, apiConfig, auxApiConfig, addToast } = useOS();
    // 折子戏·对影属「聊天以外」的功能：走副 API（未配置副 API 时回退主 API）
    const auxApi = { ...apiConfig, ...resolveAuxApi(auxApiConfig, apiConfig) };
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
            const t = await loadOrGenerateTrajectory(selectedChar, userName, auxApi);
            setTrajectory(t);
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
            if (prev.length >= 2) return [prev[1], id];
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
            const s = await generateReflection(selectedChar, userName, a, b, trajectory.firstMetTs, auxApi);
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
            <Shell onBack={onExit} title="对影" en="BY MOONLIGHT">
                <div className="px-6 pt-3 pb-5 text-center">
                    <MaskSad size={30} weight="duotone" className="mx-auto mb-3" style={{ color: INK }} />
                    <p className="text-[13px] leading-relaxed" style={{ color: '#5b554a' }}>
                        同一个人，在不同时间里的相逢。<br />
                        看见 TA 并非突然变成今天的样子，<br />
                        也看见——是谁让命运偏离过原本的方向。<br />
                        <span className="italic" style={{ color: INK_SOFT }}>举杯邀明月，对影成几人。</span>
                    </p>
                </div>
                <CharPicker characters={characters} onPick={setSelectedCharId} />
            </Shell>
        );
    }

    return (
        <Shell onBack={() => { setSelectedCharId(''); setTrajectory(null); setScene(null); }} title={selectedChar?.name || '对影'} en="BY MOONLIGHT">
            {loadingTraj && (
                <div className="flex flex-col items-center justify-center py-24 text-center px-8">
                    <MoonStars size={32} weight="duotone" className="animate-pulse mb-4" style={{ color: INK }} />
                    <p className="text-[13px]" style={{ color: '#5b554a' }}>正在翻出 {selectedChar?.name} 走过的那条路…</p>
                </div>
            )}

            {!loadingTraj && error && (
                <div className="mx-6 mt-6 rounded-2xl px-5 py-4 text-center" style={{ border: '1px dashed rgba(150,144,132,0.6)', background: 'rgba(31,29,26,0.04)' }}>
                    <p className="text-[12px] leading-relaxed" style={{ color: '#6b6558' }}>{error}</p>
                    {apiReady && <ScrapButton variant="ink" className="mt-3 px-4 py-1.5 text-[11px]" onClick={() => void loadTraj()}>再试一次</ScrapButton>}
                </div>
            )}

            {!loadingTraj && !error && trajectory && (
                <div className="px-5 pb-12">
                    <div className="pt-3 pb-3">
                        <p className="text-[11px] leading-relaxed mb-3 px-1" style={{ color: '#6b6558' }}>
                            从 TA 的轨迹里挑 <span className="font-black" style={{ color: INK }}>两个时刻</span>，让那两个 TA 在此刻相逢。
                        </p>
                        <div className="space-y-2">
                            {trajectory.nodes.map((node, ni) => {
                                const idx = pick.indexOf(node.id);
                                const selected = idx >= 0;
                                return (
                                    <button
                                        key={node.id}
                                        onClick={() => togglePick(node.id)}
                                        className="w-full text-left rounded-xl px-3.5 py-2.5 transition-all flex items-start gap-2.5"
                                        style={{
                                            background: selected ? 'linear-gradient(180deg,#fbf9f2,#efece2)' : 'rgba(255,253,247,0.6)',
                                            border: selected ? '1px solid rgba(31,29,26,0.5)' : '1px solid rgba(176,170,158,0.55)',
                                            outline: selected ? '1px dashed rgba(31,29,26,0.28)' : 'none', outlineOffset: -5,
                                            transform: selected ? `rotate(${ni % 2 ? 0.5 : -0.5}deg)` : undefined,
                                        }}
                                    >
                                        <span className="mt-0.5 w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-[10px] font-black" style={{ background: selected ? '#1f1d1a' : 'rgba(31,29,26,0.08)', color: selected ? '#f6f3ec' : INK_SOFT }}>
                                            {selected ? (idx + 1) : ''}
                                        </span>
                                        <span className="min-w-0 flex-1">
                                            <span className="flex items-center justify-between gap-2">
                                                <span className="text-[12.5px] font-black truncate" style={{ color: INK }}>{node.title}</span>
                                                <span className="text-[9px] shrink-0" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>{nodeWhen(node, trajectory.firstMetTs)}</span>
                                            </span>
                                            <span className="block text-[11px] line-clamp-1 mt-0.5" style={{ color: '#6b6558' }}>{node.scene}</span>
                                        </span>
                                    </button>
                                );
                            })}
                        </div>

                        <ScrapButton
                            variant="ink"
                            disabled={pick.length !== 2 || generating}
                            onClick={doGenerate}
                            className="mt-4 w-full py-3 text-[13px] tracking-wide"
                            icon={generating ? <Sparkle size={15} weight="fill" className="animate-pulse" /> : <MaskSad size={15} weight="bold" />}
                        >
                            {generating ? '两个 TA 正在照面…' : '对影成几人'}
                        </ScrapButton>
                    </div>

                    {scene && <ReflectionView scene={scene} onRegen={doGenerate} regenerating={generating} />}
                </div>
            )}
        </Shell>
    );
};

const ReflectionView: React.FC<{ scene: ReflectionScene; onRegen: () => void; regenerating: boolean }> = ({ scene, onRegen, regenerating }) => (
    <div className="mt-6 rounded-[20px] px-5 py-6 animate-fade-in relative overflow-hidden" style={{
        background: 'linear-gradient(180deg,#fbf9f2,#f1eee4)',
        border: '1px solid rgba(176,170,158,0.7)', outline: '1px dashed rgba(150,144,132,0.5)', outlineOffset: -6,
        boxShadow: '0 16px 30px -20px rgba(31,29,26,0.5)', transform: 'rotate(-0.5deg)',
    }}>
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.07]" style={{ backgroundImage: HALFTONE, backgroundSize: '7px 7px' }} />
        <WashiTape color="ink" rotate={-5} className="absolute -top-3 left-1/2 -translate-x-1/2 w-24 h-6 rounded-[2px]" />
        <div aria-hidden className="pointer-events-none absolute -top-8 right-2 opacity-[0.08]"><MoonStars size={90} weight="fill" style={{ color: INK }} /></div>
        <div className="text-center mb-5 relative z-10">
            <h3 className="text-2xl font-black tracking-wide" style={{ color: INK }}>{scene.title}</h3>
            {scene.subtitle && <p className="text-[11px] italic mt-1.5" style={{ color: INK_SOFT }}>{scene.subtitle}</p>}
        </div>
        <div className="space-y-3 relative z-10">
            {scene.lines.map((line, i) => {
                if (line.who === 'narration') {
                    return <p key={i} className="text-center text-[11.5px] italic px-4 py-1 leading-relaxed" style={{ color: INK_SOFT }}>— {line.text} —</p>;
                }
                const isNow = line.who === 'now';
                return (
                    <div key={i} className={`flex ${isNow ? 'justify-end' : 'justify-start'}`}>
                        <div className="max-w-[82%] px-3.5 py-2.5 text-[12.5px] leading-relaxed" style={{
                            background: isNow ? '#1f1d1a' : 'rgba(255,253,247,0.95)',
                            color: isNow ? '#f3ecdf' : '#3a362f',
                            border: isNow ? 'none' : '1px solid rgba(176,170,158,0.7)',
                            borderRadius: isNow ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                            boxShadow: '0 8px 16px -12px rgba(31,29,26,0.4)',
                        }}>
                            <span className="block text-[9px] font-black mb-1 tracking-wider" style={{ color: isNow ? 'rgba(243,236,223,0.65)' : INK_SOFT }}>{isNow ? '此刻的 TA' : '从前的 TA'}</span>
                            {line.text}
                        </div>
                    </div>
                );
            })}
        </div>
        <div className="flex justify-center mt-6 relative z-10">
            <ScrapButton variant="paper" className="px-3.5 py-1.5 text-[10px]" disabled={regenerating} onClick={onRegen} icon={<ArrowsClockwise size={12} weight="bold" />}>再照一次</ScrapButton>
        </div>
    </div>
);

export default ReflectionApp;
