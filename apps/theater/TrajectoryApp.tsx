import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useOS } from '../../context/OSContext';
import {
    ArrowsClockwise,
    Sparkle,
    MapPin,
    Heart,
    FilmReel,
    BookOpen,
    ImageSquare,
    MagicWand,
    NotePencil,
    GitFork,
    X,
    Eye,
    Tag,
} from '@phosphor-icons/react';
import {
    CharTrajectory,
    TrajectoryBranch,
    TrajectoryNode,
    TrajectoryNodeDetail,
    ensureTrajectoryNodeDetail,
    generateTrajectoryBranch,
    loadOrGenerateTrajectory,
    nodeWhen,
    refreshAfterNodes,
    rewriteTrajectoryNode,
} from '../../utils/theaterTimeline';
import {
    PaperShell,
    ScrapScroll,
    ScrapHeader,
    Polaroid,
    ScrapButton,
    WashiTape,
    SectionTag,
    PaperCard,
    PaperSheet,
    Stamp,
    INK,
    INK_SOFT,
} from '../ui/insScrapKit';
import { resolveAuxApi } from '../../utils/auxApi';

/**
 * 折子戏·轨迹（陆）：回到过去的时间节点，看看那些你们还未曾相遇的日子。
 * v2 把时间线扩成「人生档案 + 相册式回看 + 节点深挖互动」。
 */

interface Props { onExit: () => void; }

type ViewMode = 'timeline' | 'dossier' | 'album';

const eraMeta: Record<TrajectoryNode['era'], { dot: string; line: string; label: string }> = {
    before:  { dot: '#a39d92', line: 'rgba(31,29,26,0.14)', label: '遇见你之前' },
    meeting: { dot: '#1f1d1a', line: 'rgba(31,29,26,0.42)', label: '你走进来的那天' },
    after:   { dot: '#6b6558', line: 'rgba(31,29,26,0.18)', label: '相遇之后' },
};

const viewMeta: Array<{ id: ViewMode; label: string; Icon: React.FC<any> }> = [
    { id: 'timeline', label: '时间线', Icon: FilmReel },
    { id: 'dossier', label: '档案', Icon: BookOpen },
    { id: 'album', label: '相册', Icon: ImageSquare },
];

const TrajectoryApp: React.FC<Props> = ({ onExit }) => {
    const { characters, userProfile, apiConfig, auxApiConfig, addToast } = useOS();
    const auxApi = { ...apiConfig, ...resolveAuxApi(auxApiConfig, apiConfig) };
    const [selectedCharId, setSelectedCharId] = useState('');
    const [trajectory, setTrajectory] = useState<CharTrajectory | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [view, setView] = useState<ViewMode>('timeline');
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
    const [filter, setFilter] = useState('');
    const [detailBusy, setDetailBusy] = useState(false);
    const [branchBusy, setBranchBusy] = useState(false);
    const [rewriteBusy, setRewriteBusy] = useState(false);

    const selectedChar = characters.find(c => c.id === selectedCharId);
    const selectedNode = trajectory?.nodes.find(n => n.id === selectedNodeId) || null;
    const userName = userProfile?.name || '你';
    const apiReady = !!(apiConfig?.baseUrl && apiConfig?.model);

    const load = useCallback(async (force: boolean) => {
        if (!selectedChar) return;
        if (!apiReady) { setError('还没配置主 API，去「文具盒」填好之后再回来看轨迹。'); return; }
        setLoading(true);
        setError('');
        try {
            let t = await loadOrGenerateTrajectory(selectedChar, userProfile, auxApi, { force });
            if (!force) t = await refreshAfterNodes(t, userName, selectedChar.name);
            setTrajectory(t);
            setSelectedNodeId(null);
            setFilter('');
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setLoading(false);
        }
    }, [selectedChar, apiReady, userName, userProfile, auxApi]);

    useEffect(() => {
        if (selectedCharId) { setTrajectory(null); setSelectedNodeId(null); setView('timeline'); void load(false); }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedCharId]);

    const handleEnsureDetail = async (force = false) => {
        if (!trajectory || !selectedChar || !selectedNode) return;
        setDetailBusy(true);
        try {
            const result = await ensureTrajectoryNodeDetail(trajectory, selectedChar, userProfile, selectedNode.id, auxApi, { force });
            setTrajectory(result.trajectory);
        } catch (e) {
            addToast(e instanceof Error ? e.message : '这一帧没有显影出来', 'error');
        } finally {
            setDetailBusy(false);
        }
    };

    const handleBranch = async (premise: string) => {
        if (!trajectory || !selectedChar || !selectedNode) return;
        setBranchBusy(true);
        try {
            const result = await generateTrajectoryBranch(trajectory, selectedChar, userProfile, selectedNode.id, premise, auxApi);
            setTrajectory(result.trajectory);
            addToast('已经另开一条非正史岔路', 'success');
        } catch (e) {
            addToast(e instanceof Error ? e.message : '分支生成失败', 'error');
        } finally {
            setBranchBusy(false);
        }
    };

    const handleRewrite = async () => {
        if (!trajectory || !selectedChar || !selectedNode) return;
        if (!window.confirm('重写这一帧会覆盖当前片段，并清掉它的细看和分支缓存。继续吗？')) return;
        setRewriteBusy(true);
        try {
            const result = await rewriteTrajectoryNode(trajectory, selectedChar, userProfile, selectedNode.id, auxApi);
            setTrajectory(result.trajectory);
            addToast('这一帧已经重写', 'success');
        } catch (e) {
            addToast(e instanceof Error ? e.message : '这一帧不能重写', 'error');
        } finally {
            setRewriteBusy(false);
        }
    };

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
            onBack={() => { setSelectedCharId(''); setTrajectory(null); setSelectedNodeId(null); }}
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
                    <p className="text-[13px] leading-relaxed" style={{ color: '#5b554a' }}>正在回到 {selectedChar?.name} 走过的路上…<br /><span className="text-[11px]" style={{ color: INK_SOFT }}>先找回骨架，再把想细看的地方慢慢显影</span></p>
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
                    <ViewTabs view={view} onChange={setView} />
                    {view === 'timeline' && <Timeline trajectory={trajectory} onPick={setSelectedNodeId} selectedId={selectedNodeId} />}
                    {view === 'dossier' && <DossierView trajectory={trajectory} charName={selectedChar?.name || 'TA'} onFilter={(v) => { setFilter(v); setView('album'); }} />}
                    {view === 'album' && (
                        <AlbumView
                            trajectory={trajectory}
                            filter={filter}
                            onFilter={setFilter}
                            onPick={(id) => { setSelectedNodeId(id); setView('timeline'); }}
                        />
                    )}
                    <p className="text-center text-[10px] mt-8 tracking-[0.3em] select-none" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>— 路 还 在 往 前 走 —</p>
                </div>
            )}

            {trajectory && selectedNode && (
                <NodeSheet
                    open={!!selectedNode}
                    onClose={() => setSelectedNodeId(null)}
                    trajectory={trajectory}
                    node={selectedNode}
                    detail={trajectory.nodeDetails?.[selectedNode.id]}
                    branches={trajectory.branches?.[selectedNode.id] || []}
                    onEnsureDetail={handleEnsureDetail}
                    onBranch={handleBranch}
                    onRewrite={handleRewrite}
                    detailBusy={detailBusy}
                    branchBusy={branchBusy}
                    rewriteBusy={rewriteBusy}
                />
            )}
        </Shell>
    );
};

const ViewTabs: React.FC<{ view: ViewMode; onChange: (v: ViewMode) => void }> = ({ view, onChange }) => (
    <div className="grid grid-cols-3 gap-2 mb-4">
        {viewMeta.map(item => {
            const on = view === item.id;
            return (
                <button
                    key={item.id}
                    onClick={() => onChange(item.id)}
                    className="h-10 rounded-full text-[12px] font-black inline-flex items-center justify-center gap-1.5"
                    style={{
                        background: on ? INK : '#fff',
                        color: on ? '#fff' : INK,
                        border: '1px solid rgba(0,0,0,0.06)',
                        boxShadow: on ? '0 12px 24px -16px rgba(38,38,38,0.55)' : '0 8px 18px -14px rgba(38,38,38,0.28)',
                    }}
                >
                    <item.Icon size={14} weight={on ? 'fill' : 'bold'} />
                    {item.label}
                </button>
            );
        })}
    </div>
);

const Timeline: React.FC<{ trajectory: CharTrajectory; selectedId: string | null; onPick: (id: string) => void }> = ({ trajectory, selectedId, onPick }) => (
    <div className="relative">
        {trajectory.nodes.map((node, i) => {
            const meta = eraMeta[node.era];
            const isMeeting = node.era === 'meeting';
            const selected = selectedId === node.id;
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
                    <button onClick={() => onPick(node.id)} className="w-full flex gap-3 text-left group">
                        <div className="flex flex-col items-center shrink-0" style={{ width: 18 }}>
                            <span className="rounded-full mt-1.5 transition-transform group-active:scale-90" style={{ width: isMeeting ? 12 : 9, height: isMeeting ? 12 : 9, background: meta.dot, boxShadow: selected ? '0 0 0 4px rgba(43,41,51,0.14)' : isMeeting ? '0 0 0 3px rgba(31,29,26,0.12)' : 'none' }} />
                            {i < trajectory.nodes.length - 1 && <span className="flex-1 w-px mt-1" style={{ background: meta.line, minHeight: 24 }} />}
                        </div>
                        <NodeCard node={node} trajectory={trajectory} selected={selected} />
                    </button>
                </div>
            );
        })}
    </div>
);

const NodeCard: React.FC<{ node: TrajectoryNode; trajectory: CharTrajectory; selected?: boolean }> = ({ node, trajectory, selected }) => {
    const isMeeting = node.era === 'meeting';
    return (
        <div className="relative flex-1 mb-3 rounded-[14px] px-4 py-3" style={{
            background: isMeeting ? 'linear-gradient(180deg,#fbf9f2,#f0ede2)' : 'rgba(255,253,247,0.76)',
            border: selected || isMeeting ? '1px solid rgba(31,29,26,0.5)' : '1px solid rgba(176,170,158,0.6)',
            outline: selected || isMeeting ? '1px dashed rgba(31,29,26,0.3)' : 'none', outlineOffset: -5,
            boxShadow: selected || isMeeting ? '0 12px 22px -16px rgba(31,29,26,0.5)' : 'none',
        }}>
            {isMeeting && <WashiTape color="ink" rotate={-6} className="absolute -top-2.5 right-4 w-12 h-4 rounded-[2px] text-[7px] tracking-[0.2em]" style={{ fontFamily: 'var(--font-label)' }}>★</WashiTape>}
            <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-black" style={{ color: INK }}>{node.title}</span>
                <span className="text-[9.5px] shrink-0 whitespace-nowrap" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>{nodeWhen(node, trajectory.firstMetTs)}</span>
            </div>
            <p className="text-[12px] leading-relaxed mt-1.5 line-clamp-3" style={{ color: '#5b554a' }}>{node.scene}</p>
            <NodeChips node={node} />
        </div>
    );
};

const NodeChips: React.FC<{ node: TrajectoryNode }> = ({ node }) => (
    <div className="flex flex-wrap items-center gap-2 mt-2">
        {node.mood && <Chip icon={<Heart size={10} weight="fill" />}>{node.mood}</Chip>}
        {node.place && <Chip icon={<MapPin size={10} weight="fill" />}>{node.place}</Chip>}
        {node.object && <Chip icon={<FilmReel size={10} weight="fill" />}>{node.object}</Chip>}
        {(node.tags || []).slice(0, 3).map(tag => <Chip key={tag} icon={<Tag size={10} weight="fill" />}>{tag}</Chip>)}
    </div>
);

const Chip: React.FC<{ icon?: React.ReactNode; children: React.ReactNode; onClick?: () => void }> = ({ icon, children, onClick }) => (
    onClick ? (
        <button
            type="button"
            onClick={onClick}
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold"
            style={{ color: '#6b6558', background: 'rgba(31,29,26,0.06)' }}
        >
            {icon}{children}
        </button>
    ) : (
        <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold"
            style={{ color: '#6b6558', background: 'rgba(31,29,26,0.06)' }}
        >
            {icon}{children}
        </span>
    )
);

const DossierView: React.FC<{ trajectory: CharTrajectory; charName: string; onFilter: (v: string) => void }> = ({ trajectory, charName, onFilter }) => {
    const dossier = trajectory.dossier;
    return (
        <div className="space-y-4">
            <PaperCard className="px-5 py-5 overflow-hidden" tape="butter">
                <div className="text-[9px] tracking-[0.34em] mb-1.5" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>LIFE FILE</div>
                <h3 className="text-[22px] font-black leading-tight" style={{ color: INK }}>{dossier?.arcTitle || `${charName} 的旧日放映`}</h3>
                <p className="text-[12.5px] leading-relaxed mt-3" style={{ color: '#5b554a' }}>{dossier?.summary || '这条轨迹还在显影。先从时间线里挑一帧细看，档案会慢慢变得有重量。'}</p>
            </PaperCard>

            <TwoColumn labelA="核心伤口" valueA={dossier?.coreWound} labelB="核心渴望" valueB={dossier?.coreWant} />
            <TagCloud title="反复意象" items={dossier?.motifs || []} onFilter={onFilter} />
            <TagCloud title="地点簿" items={dossier?.places || []} onFilter={onFilter} icon={<MapPin size={12} weight="fill" />} />
            <TagCloud title="物件簿" items={dossier?.objects || []} onFilter={onFilter} icon={<FilmReel size={12} weight="fill" />} />
            {!!dossier?.openQuestions?.length && (
                <PaperCard className="px-4 py-4">
                    <SectionTag en="QUESTIONS">未解问题</SectionTag>
                    <div className="space-y-2 mt-3">
                        {dossier.openQuestions.map((q, i) => (
                            <p key={i} className="text-[12px] leading-relaxed px-3 py-2 rounded-xl" style={{ color: '#5b554a', background: 'rgba(31,29,26,0.04)' }}>{q}</p>
                        ))}
                    </div>
                </PaperCard>
            )}
        </div>
    );
};

const TwoColumn: React.FC<{ labelA: string; valueA?: string; labelB: string; valueB?: string }> = ({ labelA, valueA, labelB, valueB }) => (
    <div className="grid grid-cols-2 gap-3">
        {[{ label: labelA, value: valueA }, { label: labelB, value: valueB }].map(item => (
            <PaperCard key={item.label} className="px-3.5 py-4">
                <div className="text-[9px] font-black tracking-[0.18em]" style={{ color: INK_SOFT }}>{item.label}</div>
                <p className="text-[12px] leading-relaxed mt-2" style={{ color: '#5b554a' }}>{item.value || '还没有完全显影。'}</p>
            </PaperCard>
        ))}
    </div>
);

const TagCloud: React.FC<{ title: string; items: string[]; onFilter: (v: string) => void; icon?: React.ReactNode }> = ({ title, items, onFilter, icon }) => (
    <PaperCard className="px-4 py-4">
        <SectionTag en="INDEX">{title}</SectionTag>
        <div className="flex flex-wrap gap-2 mt-3">
            {items.length ? items.map(item => <Chip key={item} icon={icon} onClick={() => onFilter(item)}>{item}</Chip>) : <span className="text-[11px]" style={{ color: INK_SOFT }}>暂时没有条目。</span>}
        </div>
    </PaperCard>
);

const AlbumView: React.FC<{ trajectory: CharTrajectory; filter: string; onFilter: (v: string) => void; onPick: (id: string) => void }> = ({ trajectory, filter, onFilter, onPick }) => {
    const tokens = useMemo(() => {
        const all = trajectory.nodes.flatMap(n => [n.place, n.object, ...(n.tags || [])]).filter(Boolean) as string[];
        return Array.from(new Set(all)).slice(0, 18);
    }, [trajectory.nodes]);
    const list = filter
        ? trajectory.nodes.filter(n => [n.place, n.object, ...(n.tags || [])].some(v => v?.includes(filter)))
        : trajectory.nodes;
    return (
        <div>
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-3">
                <Chip onClick={() => onFilter('')}>{filter ? '全部' : '全部片段'}</Chip>
                {tokens.map(t => <Chip key={t} onClick={() => onFilter(t)}>{t}</Chip>)}
            </div>
            {filter && <p className="text-[11px] mb-3" style={{ color: INK_SOFT }}>正在只看和「{filter}」有关的底片。</p>}
            <div className="grid grid-cols-2 gap-3">
                {list.map((node, i) => (
                    <button key={node.id} onClick={() => onPick(node.id)} className="text-left">
                        <div className="relative px-3 pt-3 pb-5" style={{
                            background: '#fff',
                            borderRadius: 8,
                            boxShadow: '0 12px 24px -16px rgba(38,38,38,0.4)',
                            transform: `rotate(${i % 2 ? 0.8 : -0.8}deg)`,
                        }}>
                            <div className="aspect-[4/3] rounded-[5px] px-3 py-3 flex flex-col justify-between" style={{ background: 'linear-gradient(135deg,#f3f0ea,#fffaf2)', border: '1px solid rgba(0,0,0,0.05)' }}>
                                <Stamp size={30}><FilmReel size={15} weight="fill" /></Stamp>
                                <div>
                                    <div className="text-[12px] font-black line-clamp-1" style={{ color: INK }}>{node.title}</div>
                                    <div className="text-[9px] mt-1" style={{ color: INK_SOFT }}>{nodeWhen(node, trajectory.firstMetTs)}</div>
                                </div>
                            </div>
                            <p className="text-[10.5px] leading-snug mt-2 line-clamp-2" style={{ color: '#5b554a' }}>{node.object || node.place || node.beat || node.scene}</p>
                        </div>
                    </button>
                ))}
            </div>
            {!list.length && <p className="text-center text-[12px] py-12" style={{ color: INK_SOFT }}>没有找到这类底片。</p>}
        </div>
    );
};

const NodeSheet: React.FC<{
    open: boolean;
    onClose: () => void;
    trajectory: CharTrajectory;
    node: TrajectoryNode;
    detail?: TrajectoryNodeDetail;
    branches: TrajectoryBranch[];
    onEnsureDetail: (force?: boolean) => void;
    onBranch: (premise: string) => void;
    onRewrite: () => void;
    detailBusy: boolean;
    branchBusy: boolean;
    rewriteBusy: boolean;
}> = ({ open, onClose, trajectory, node, detail, branches, onEnsureDetail, onBranch, onRewrite, detailBusy, branchBusy, rewriteBusy }) => {
    const [premise, setPremise] = useState('');
    useEffect(() => { setPremise(''); }, [node.id]);
    const canRewrite = node.era === 'before' && node.source === 'generated';
    return (
        <PaperSheet open={open} onClose={onClose} title={node.title}>
            <div className="max-h-[72vh] overflow-y-auto no-scrollbar pr-1">
                <div className="flex items-start gap-3">
                    <Stamp size={42}><FilmReel size={22} weight="fill" /></Stamp>
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                            <div className="text-[11px] font-black tracking-[0.16em]" style={{ color: INK_SOFT }}>{nodeWhen(node, trajectory.firstMetTs)}</div>
                            <button onClick={onClose} className="w-7 h-7 rounded-full inline-flex items-center justify-center" style={{ background: 'rgba(31,29,26,0.06)', color: INK }}><X size={14} weight="bold" /></button>
                        </div>
                        <p className="text-[12.5px] leading-relaxed mt-2" style={{ color: '#5b554a' }}>{node.scene}</p>
                        <NodeChips node={node} />
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-2 mt-4">
                    <ScrapButton variant="ink" className="py-2 text-[11px]" disabled={detailBusy} onClick={() => onEnsureDetail(false)} icon={detailBusy ? <Sparkle size={13} weight="fill" className="animate-pulse" /> : <Eye size={13} weight="bold" />}>
                        {detail ? '重看细节' : '细看这一帧'}
                    </ScrapButton>
                    <ScrapButton variant="paper" className="py-2 text-[11px]" disabled={rewriteBusy || !canRewrite} onClick={onRewrite} icon={<MagicWand size={13} weight="bold" />} title={canRewrite ? '重写这一帧' : '真实节点不能重写'}>
                        {rewriteBusy ? '重写中…' : '重写这一帧'}
                    </ScrapButton>
                </div>

                {detail && <DetailCard detail={detail} onRefresh={() => onEnsureDetail(true)} busy={detailBusy} />}

                <div className="mt-5">
                    <SectionTag en="BRANCH">如果那天…</SectionTag>
                    <textarea
                        value={premise}
                        onChange={(e) => setPremise(e.target.value)}
                        rows={2}
                        placeholder="例如：TA 当时没有离开，或者终于把那句话说出来。"
                        className="w-full mt-3 rounded-2xl px-3.5 py-3 text-[12px] outline-none resize-none"
                        style={{ background: '#f8f5ef', border: '1px solid rgba(0,0,0,0.06)', color: INK }}
                    />
                    <ScrapButton
                        variant="paper"
                        className="w-full mt-2 py-2.5 text-[12px]"
                        disabled={branchBusy || !premise.trim()}
                        onClick={() => { onBranch(premise); setPremise(''); }}
                        icon={branchBusy ? <Sparkle size={13} weight="fill" className="animate-pulse" /> : <GitFork size={13} weight="bold" />}
                    >
                        {branchBusy ? '岔路生成中…' : '另开一条非正史岔路'}
                    </ScrapButton>
                </div>

                {branches.length > 0 && (
                    <div className="mt-5 space-y-3">
                        <SectionTag en="ALT">已有岔路</SectionTag>
                        {branches.map(b => (
                            <PaperCard key={b.id} className="px-4 py-3">
                                <div className="text-[13px] font-black" style={{ color: INK }}>{b.title}</div>
                                <div className="text-[10px] mt-1" style={{ color: INK_SOFT }}>如果：{b.premise}</div>
                                <p className="text-[12px] leading-relaxed mt-2" style={{ color: '#5b554a' }}>{b.scene}</p>
                                <div className="grid grid-cols-2 gap-2 mt-3">
                                    <MiniNote title="代价" text={b.cost} />
                                    <MiniNote title="不变" text={b.unchanged} />
                                </div>
                            </PaperCard>
                        ))}
                    </div>
                )}
            </div>
        </PaperSheet>
    );
};

const DetailCard: React.FC<{ detail: TrajectoryNodeDetail; onRefresh: () => void; busy: boolean }> = ({ detail, onRefresh, busy }) => (
    <PaperCard className="mt-5 px-4 py-4" tape="butter">
        <div className="flex items-center justify-between gap-3 mb-3">
            <SectionTag en="FRAME">这一帧背面</SectionTag>
            <button onClick={onRefresh} disabled={busy} className="shrink-0 text-[10px] font-black inline-flex items-center gap-1" style={{ color: INK_SOFT }}>
                <ArrowsClockwise size={11} weight="bold" />重显影
            </button>
        </div>
        <p className="text-[12.5px] leading-relaxed" style={{ color: '#5b554a' }}>{detail.stillFrame}</p>
        {!!detail.senses.length && (
            <div className="flex flex-wrap gap-2 mt-3">
                {detail.senses.map(s => <Chip key={s}>{s}</Chip>)}
            </div>
        )}
        <div className="space-y-2 mt-4">
            <MiniNote title="心里转过" text={detail.innerMonologue} icon={<Heart size={12} weight="fill" />} />
            <MiniNote title="没说出口" text={detail.unsaidLine} icon={<NotePencil size={12} weight="fill" />} />
            <MiniNote title="后来留下" text={detail.consequence} icon={<FilmReel size={12} weight="fill" />} />
            {detail.keepsake && <MiniNote title="物件" text={detail.keepsake} icon={<ImageSquare size={12} weight="fill" />} />}
        </div>
    </PaperCard>
);

const MiniNote: React.FC<{ title: string; text?: string; icon?: React.ReactNode }> = ({ title, text, icon }) => (
    <div className="rounded-xl px-3 py-2" style={{ background: 'rgba(31,29,26,0.045)' }}>
        <div className="text-[9px] font-black tracking-[0.18em] inline-flex items-center gap-1" style={{ color: INK_SOFT }}>{icon}{title}</div>
        <p className="text-[11.5px] leading-relaxed mt-1" style={{ color: '#5b554a' }}>{text || '还没有显影。'}</p>
    </div>
);

export const Shell: React.FC<{ onBack: () => void; title: string; en?: string; right?: React.ReactNode; children: React.ReactNode }> = ({ onBack, title, en, right, children }) => (
    <PaperShell>
        <ScrapHeader title={title} en={en} onBack={onBack} right={right} />
        <ScrapScroll>{children}</ScrapScroll>
    </PaperShell>
);

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
