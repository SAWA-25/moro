import React, { useEffect, useMemo, useState } from 'react';
import { useOS } from '../../context/OSContext';
import {
    ArrowsClockwise,
    BookmarkSimple,
    ChatCircleText,
    Copy,
    MaskSad,
    MoonStars,
    PaperPlaneTilt,
    Sparkle,
    Trash,
} from '@phosphor-icons/react';
import {
    CharTrajectory,
    TrajectoryNode,
    ReflectionLine,
    continueReflection,
    generateReflection,
    loadOrGenerateTrajectory,
    makeReflectionSession,
    nodeWhen,
    normalizeReflectionOptions,
    reflectionOptionsLabel,
    refreshAfterNodes,
} from '../../utils/theaterTimeline';
import { Shell, CharPicker } from './TrajectoryApp';
import { PaperCard, ScrapButton, SectionTag, WashiTape, HALFTONE, INK, INK_SOFT } from '../ui/insScrapKit';
import { resolveAuxApi } from '../../utils/auxApi';
import { DB } from '../../utils/db';
import { collectionId } from '../../utils/collection';
import type {
    TheaterReflectionLength,
    TheaterReflectionMode,
    TheaterReflectionOptions,
    TheaterReflectionSession,
    TheaterReflectionTone,
} from '../../types';

/**
 * 折子戏·对影（柒）：同一个人，在不同时间里的相逢。
 * v2：对影册 + 模式/气氛/篇幅 + 用户短会面 + 发到聊天 / 收进典藏馆。
 */

interface Props { onExit: () => void; }

type View = 'pick' | 'compose' | 'session';

const MODE_TABS: { value: TheaterReflectionMode; label: string; desc: string }[] = [
    { value: 'moonlight', label: '月下照面', desc: '偶然遇见另一个自己' },
    { value: 'letter', label: '写给从前', desc: '像一封没寄出的信' },
    { value: 'crossroad', label: '命运岔路', desc: '照见如果没有那一步' },
    { value: 'reconcile', label: '自我和解', desc: '承认狼狈，也承认走过来了' },
];

const TONE_TABS: { value: TheaterReflectionTone; label: string }[] = [
    { value: 'restrained', label: '克制' },
    { value: 'tender', label: '温柔' },
    { value: 'aching', label: '酸涩' },
    { value: 'relieved', label: '释然' },
];

const LENGTH_TABS: { value: TheaterReflectionLength; label: string }[] = [
    { value: 'short', label: '短章' },
    { value: 'standard', label: '标准' },
    { value: 'long', label: '长章' },
];

const genId = () => Math.random().toString(36).slice(2, 10);

const lineLabel = (line: ReflectionLine, userName: string) => {
    if (line.who === 'past') return '从前的 TA';
    if (line.who === 'now') return '此刻的 TA';
    if (line.who === 'user') return userName;
    return '';
};

const formatSessionText = (session: TheaterReflectionSession, userName: string) => {
    const lines = [
        `【折子戏·对影】${session.title}`,
        session.subtitle || '',
        `角色：${session.charName}`,
        `节点：${session.nodes.past.when}「${session.nodes.past.title}」 / ${session.nodes.now.when}「${session.nodes.now.title}」`,
        '',
    ];
    [...session.initialScene.lines, ...(session.continuationLines || [])].forEach(line => {
        if (line.who === 'narration') lines.push(`（${line.text}）`);
        else lines.push(`${lineLabel(line, userName)}：${line.text}`);
    });
    return lines.filter((line, idx) => line || idx > 4).join('\n').trim();
};

const sessionExcerpt = (session: TheaterReflectionSession) => (
    session.initialScene.lines.find(l => l.who !== 'narration')?.text
    || session.initialScene.lines[0]?.text
    || session.subtitle
    || ''
).slice(0, 72);

const snapshotToNode = (session: TheaterReflectionSession, which: 'past' | 'now'): TrajectoryNode => {
    const n = session.nodes[which];
    return {
        id: n.id,
        ts: n.ts,
        era: n.era,
        title: n.title,
        scene: n.scene,
        mood: n.mood,
        place: n.place,
        source: n.source || (n.era === 'meeting' ? 'firstMet' : n.era === 'after' ? 'lifeEvent' : 'generated'),
    };
};

const ReflectionApp: React.FC<Props> = ({ onExit }) => {
    const { characters, userProfile, apiConfig, auxApiConfig, addToast } = useOS();
    const auxApi = { ...apiConfig, ...resolveAuxApi(auxApiConfig, apiConfig) };
    const userName = userProfile?.name || '你';
    const apiReady = !!(apiConfig?.baseUrl && apiConfig?.model);

    const [view, setView] = useState<View>('pick');
    const [selectedCharId, setSelectedCharId] = useState('');
    const [trajectory, setTrajectory] = useState<CharTrajectory | null>(null);
    const [loadingTraj, setLoadingTraj] = useState(false);
    const [error, setError] = useState('');
    const [pick, setPick] = useState<string[]>([]);
    const [options, setOptions] = useState<TheaterReflectionOptions>(normalizeReflectionOptions());
    const [seed, setSeed] = useState('');
    const [generating, setGenerating] = useState(false);
    const [currentSession, setCurrentSession] = useState<TheaterReflectionSession | null>(null);
    const [replyInput, setReplyInput] = useState('');
    const [replying, setReplying] = useState(false);
    const [sessions, setSessions] = useState<TheaterReflectionSession[]>([]);
    const [collectedIds, setCollectedIds] = useState<Set<string>>(new Set());

    const selectedChar = characters.find(c => c.id === selectedCharId);

    const reloadCollections = async () => {
        const items = await DB.getCollectionItems().catch(() => []);
        setCollectedIds(new Set(items.map(i => i.id)));
    };

    const reloadSessions = async (charId?: string) => {
        const list = charId
            ? await DB.getTheaterReflectionSessionsByCharId(charId).catch(() => [])
            : await DB.getAllTheaterReflectionSessions().catch(() => []);
        setSessions(list);
        await reloadCollections();
    };

    useEffect(() => { void reloadSessions(); }, []);

    const loadTrajectoryFor = async (charId: string) => {
        const char = characters.find(c => c.id === charId);
        if (!char) return;
        if (!apiReady) { setError('还没配置主 API，去「文具盒」填好之后再来对影。'); return; }
        setLoadingTraj(true);
        setError('');
        try {
            let t = await loadOrGenerateTrajectory(char, userName, auxApi);
            t = await refreshAfterNodes(t, userName, char.name);
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
    };

    const openCharacter = (id: string) => {
        setSelectedCharId(id);
        setCurrentSession(null);
        setTrajectory(null);
        setError('');
        setView('compose');
        void reloadSessions(id);
        void loadTrajectoryFor(id);
    };

    const openSession = (session: TheaterReflectionSession) => {
        setSelectedCharId(session.charId);
        setCurrentSession(session);
        setPick([session.nodes.past.id, session.nodes.now.id]);
        setOptions(normalizeReflectionOptions(session.options));
        setSeed(session.options.userSeed || '');
        setError('');
        setView('session');
        void reloadSessions(session.charId);
        void loadTrajectoryFor(session.charId);
    };

    const backToPick = () => {
        setView('pick');
        setSelectedCharId('');
        setCurrentSession(null);
        setTrajectory(null);
        setPick([]);
        void reloadSessions();
    };

    const togglePick = (id: string) => {
        setCurrentSession(null);
        setPick(prev => {
            if (prev.includes(id)) return prev.filter(x => x !== id);
            if (prev.length >= 2) return [prev[1], id];
            return [...prev, id];
        });
    };

    const applyQuickPick = (kind: 'wide' | 'beforeMeet' | 'afterMeet') => {
        if (!trajectory) return;
        const beforeNodes = trajectory.nodes.filter(n => n.era === 'before');
        const meeting = trajectory.nodes.find(n => n.era === 'meeting');
        const afterNodes = trajectory.nodes.filter(n => n.era === 'after');
        const pairs: Record<typeof kind, Array<TrajectoryNode | undefined>> = {
            wide: [beforeNodes[0], trajectory.nodes[trajectory.nodes.length - 1]],
            beforeMeet: [beforeNodes[beforeNodes.length - 1], meeting],
            afterMeet: [meeting, afterNodes[afterNodes.length - 1] || trajectory.nodes[trajectory.nodes.length - 1]],
        };
        const ids = Array.from(new Set(pairs[kind].filter(Boolean).map(n => n!.id)));
        if (ids.length === 2) setPick(ids);
    };

    const resolvePickedNodes = (): [TrajectoryNode, TrajectoryNode] | null => {
        if (currentSession && (!trajectory || pick.length !== 2)) {
            return [snapshotToNode(currentSession, 'past'), snapshotToNode(currentSession, 'now')];
        }
        if (!trajectory || pick.length !== 2) return null;
        const a = trajectory.nodes.find(n => n.id === pick[0]);
        const b = trajectory.nodes.find(n => n.id === pick[1]);
        return a && b ? [a, b] : null;
    };

    const doGenerate = async (sourceSession?: TheaterReflectionSession) => {
        const char = selectedChar || (sourceSession ? characters.find(c => c.id === sourceSession.charId) : null);
        const nodes = sourceSession
            ? [
                trajectory?.nodes.find(n => n.id === sourceSession.nodes.past.id) || snapshotToNode(sourceSession, 'past'),
                trajectory?.nodes.find(n => n.id === sourceSession.nodes.now.id) || snapshotToNode(sourceSession, 'now'),
            ] as [TrajectoryNode, TrajectoryNode]
            : resolvePickedNodes();
        if (!char || !nodes) return;
        if (!apiReady) { addToast('还没配置 API，去「文具盒」填好再来', 'error'); return; }
        setGenerating(true);
        setError('');
        try {
            const finalOptions = normalizeReflectionOptions({ ...options, userSeed: seed });
            const scene = await generateReflection(
                char,
                userName,
                nodes[0],
                nodes[1],
                trajectory?.firstMetTs || Math.min(nodes[0].ts, nodes[1].ts),
                auxApi,
                finalOptions,
                trajectory?.nodeDetails,
            );
            const session = makeReflectionSession({
                char,
                userName,
                nodeA: nodes[0],
                nodeB: nodes[1],
                firstMetTs: trajectory?.firstMetTs || Math.min(nodes[0].ts, nodes[1].ts),
                scene,
                options: finalOptions,
            });
            await DB.saveTheaterReflectionSession(session);
            setCurrentSession(session);
            setView('session');
            await reloadSessions(char.id);
            addToast('对影写好了，已经收进对影册', 'success');
        } catch (e) {
            addToast(e instanceof Error ? e.message : '对影生成失败', 'error');
        } finally {
            setGenerating(false);
        }
    };

    const submitReply = async () => {
        if (!currentSession || !selectedChar) return;
        setReplying(true);
        try {
            const next = await continueReflection(selectedChar, userName, currentSession, replyInput, auxApi);
            await DB.saveTheaterReflectionSession(next);
            setCurrentSession(next);
            setReplyInput('');
            await reloadSessions(selectedChar.id);
        } catch (e) {
            addToast(e instanceof Error ? e.message : '这句话没能落进对影里', 'error');
        } finally {
            setReplying(false);
        }
    };

    const exportToChat = async (session: TheaterReflectionSession) => {
        try {
            await DB.saveMessage({
                charId: session.charId,
                role: 'system',
                type: 'text',
                content: formatSessionText(session, userName),
                timestamp: Date.now(),
                metadata: { theaterReflectionId: session.id },
            } as any);
            addToast(`已发到与 ${session.charName} 的聊天`, 'success');
        } catch {
            addToast('发送失败', 'error');
        }
    };

    const copySession = async (session: TheaterReflectionSession) => {
        try {
            await navigator.clipboard.writeText(formatSessionText(session, userName));
            addToast('对影文本已复制', 'success');
        } catch {
            addToast('复制失败，请稍后再试', 'error');
        }
    };

    const toggleCollect = async (session: TheaterReflectionSession) => {
        const id = collectionId('reflection', session.id);
        if (collectedIds.has(id)) {
            await DB.deleteCollectionItem(id);
            setCollectedIds(prev => {
                const next = new Set(prev);
                next.delete(id);
                return next;
            });
            addToast('已从典藏馆移出', 'success');
            return;
        }
        await DB.saveCollectionItem({
            id,
            sourceType: 'reflection',
            sourceId: session.id,
            title: `对影 · ${session.title}`,
            subtitle: `折子戏 · ${session.charName} · ${session.nodes.past.when} / ${session.nodes.now.when}`,
            excerpt: sessionExcerpt(session),
            charIds: [session.charId],
            cover: '🌙',
            collectedAt: Date.now(),
        });
        setCollectedIds(prev => new Set(prev).add(id));
        addToast('已收进典藏馆', 'success');
    };

    const deleteSession = async (session: TheaterReflectionSession) => {
        if (!window.confirm('删除这段对影？对影册里会移除，已经发到聊天的文本不会撤回。')) return;
        await DB.deleteTheaterReflectionSession(session.id);
        await DB.deleteCollectionItem(collectionId('reflection', session.id)).catch(() => {});
        if (currentSession?.id === session.id) {
            setCurrentSession(null);
            setView(selectedCharId ? 'compose' : 'pick');
        }
        await reloadSessions(selectedCharId || undefined);
    };

    const selectedPair = useMemo(() => {
        if (!trajectory || pick.length !== 2) return null;
        const a = trajectory.nodes.find(n => n.id === pick[0]);
        const b = trajectory.nodes.find(n => n.id === pick[1]);
        if (!a || !b) return null;
        return a.ts <= b.ts ? [a, b] as const : [b, a] as const;
    }, [trajectory, pick]);

    if (view === 'pick') {
        return (
            <Shell onBack={onExit} title="对影" en="BY MOONLIGHT">
                <div className="px-6 pt-3 pb-5 text-center">
                    <MaskSad size={30} weight="duotone" className="mx-auto mb-3" style={{ color: INK }} />
                    <p className="text-[13px] leading-relaxed" style={{ color: '#5b554a' }}>
                        同一个人，在不同时间里的相逢。<br />
                        挑两个时刻，让从前的 TA 和此刻的 TA 照一次面。<br />
                        <span className="italic" style={{ color: INK_SOFT }}>生成后的作品会留在本机对影册。</span>
                    </p>
                </div>
                <CharPicker characters={characters} onPick={openCharacter} />
                {sessions.length > 0 && (
                    <div className="px-5 pb-10">
                        <SectionTag en="ALBUM" className="mb-3">最近的对影</SectionTag>
                        <div className="space-y-3">
                            {sessions.slice(0, 6).map((s, i) => (
                                <SessionListCard key={s.id} session={s} tilt={i % 2 ? 0.5 : -0.5} onOpen={() => openSession(s)} />
                            ))}
                        </div>
                    </div>
                )}
            </Shell>
        );
    }

    const headerRight = selectedCharId ? (
        <ScrapButton variant="paper" className="px-3 py-1.5 text-[10px]" onClick={backToPick}>
            换人
        </ScrapButton>
    ) : null;

    return (
        <Shell onBack={view === 'session' ? () => setView('compose') : backToPick} title={selectedChar?.name || '对影'} en="BY MOONLIGHT" right={headerRight}>
            {loadingTraj && (
                <div className="flex flex-col items-center justify-center py-24 text-center px-8">
                    <MoonStars size={32} weight="duotone" className="animate-pulse mb-4" style={{ color: INK }} />
                    <p className="text-[13px]" style={{ color: '#5b554a' }}>正在翻出 {selectedChar?.name} 走过的那条路…</p>
                </div>
            )}

            {!loadingTraj && error && (
                <div className="mx-6 mt-6 rounded-2xl px-5 py-4 text-center" style={{ border: '1px dashed rgba(150,144,132,0.6)', background: 'rgba(31,29,26,0.04)' }}>
                    <p className="text-[12px] leading-relaxed" style={{ color: '#6b6558' }}>{error}</p>
                    {apiReady && selectedCharId && <ScrapButton variant="ink" className="mt-3 px-4 py-1.5 text-[11px]" onClick={() => void loadTrajectoryFor(selectedCharId)}>再试一次</ScrapButton>}
                </div>
            )}

            {!loadingTraj && !error && view === 'compose' && trajectory && (
                <div className="px-5 pb-12 pt-1 space-y-5">
                    <PaperCard className="p-4">
                        <SectionTag en="PICK TWO" className="mb-3">挑两个时刻</SectionTag>
                        <div className="grid grid-cols-3 gap-2 mb-3">
                            <TinyButton onClick={() => applyQuickPick('wide')}>最远一眼</TinyButton>
                            <TinyButton onClick={() => applyQuickPick('beforeMeet')}>相遇前夕</TinyButton>
                            <TinyButton onClick={() => applyQuickPick('afterMeet')}>相遇之后</TinyButton>
                        </div>
                        <div className="space-y-2">
                            {trajectory.nodes.map((node, ni) => {
                                const idx = pick.indexOf(node.id);
                                const selected = idx >= 0;
                                return (
                                    <button
                                        key={node.id}
                                        onClick={() => togglePick(node.id)}
                                        className="w-full text-left rounded-2xl px-3.5 py-2.5 transition-all flex items-start gap-2.5"
                                        style={{
                                            background: selected ? 'linear-gradient(180deg,#fff,#fff7ed)' : 'rgba(255,255,255,0.76)',
                                            border: selected ? '1px solid rgba(249,115,22,0.55)' : '1px solid rgba(0,0,0,0.05)',
                                            boxShadow: selected ? '0 12px 26px -20px rgba(249,115,22,0.45)' : 'none',
                                            transform: selected ? `rotate(${ni % 2 ? 0.4 : -0.4}deg)` : undefined,
                                        }}
                                    >
                                        <span className="mt-0.5 w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-[10px] font-black" style={{ background: selected ? INK : 'rgba(43,41,51,0.08)', color: selected ? '#fff' : INK_SOFT }}>
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
                    </PaperCard>

                    <PaperCard className="p-4">
                        <SectionTag en="TASTE" className="mb-3">调一盏月光</SectionTag>
                        <ChoiceGrid
                            values={MODE_TABS}
                            active={options.mode}
                            onPick={(mode) => setOptions(prev => normalizeReflectionOptions({ ...prev, mode }))}
                            withDesc
                        />
                        <div className="mt-3 grid grid-cols-4 gap-2">
                            {TONE_TABS.map(t => <Chip key={t.value} active={options.tone === t.value} onClick={() => setOptions(prev => normalizeReflectionOptions({ ...prev, tone: t.value }))}>{t.label}</Chip>)}
                        </div>
                        <div className="mt-3 grid grid-cols-3 gap-2">
                            {LENGTH_TABS.map(t => <Chip key={t.value} active={options.length === t.value} onClick={() => setOptions(prev => normalizeReflectionOptions({ ...prev, length: t.value }))}>{t.label}</Chip>)}
                        </div>
                        <textarea
                            value={seed}
                            onChange={e => setSeed(e.target.value)}
                            placeholder="可选：写一句想让两个 TA 照见的事。"
                            className="mt-3 w-full min-h-[74px] rounded-2xl px-3.5 py-3 text-[12.5px] outline-none resize-none"
                            style={{ background: '#fff', border: '1px solid rgba(0,0,0,0.06)', color: INK }}
                        />
                        {selectedPair && (
                            <p className="text-[11px] mt-2 leading-relaxed" style={{ color: INK_SOFT }}>
                                将让「{selectedPair[0].title}」和「{selectedPair[1].title}」照面。
                            </p>
                        )}
                        <ScrapButton
                            variant="ink"
                            disabled={pick.length !== 2 || generating}
                            onClick={() => void doGenerate()}
                            className="mt-4 w-full py-3 text-[13px]"
                            icon={generating ? <Sparkle size={15} weight="fill" className="animate-pulse" /> : <MaskSad size={15} weight="bold" />}
                        >
                            {generating ? '两个 TA 正在照面…' : '对影成几人'}
                        </ScrapButton>
                    </PaperCard>

                    {sessions.length > 0 && (
                        <div>
                            <SectionTag en="ALBUM" className="mb-3">TA 的对影册</SectionTag>
                            <div className="space-y-3">
                                {sessions.map((s, i) => <SessionListCard key={s.id} session={s} tilt={i % 2 ? 0.4 : -0.4} onOpen={() => openSession(s)} />)}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {!loadingTraj && !error && view === 'session' && currentSession && (
                <div className="px-5 pb-12 pt-1">
                    <ReflectionView
                        session={currentSession}
                        userName={userName}
                        collected={collectedIds.has(collectionId('reflection', currentSession.id))}
                        onRegen={() => void doGenerate(currentSession)}
                        regenerating={generating}
                        onCopy={() => void copySession(currentSession)}
                        onExport={() => void exportToChat(currentSession)}
                        onCollect={() => void toggleCollect(currentSession)}
                        onDelete={() => void deleteSession(currentSession)}
                    />
                    <PaperCard className="mt-5 p-4">
                        <SectionTag en="MEET" className="mb-3">写一句给他们</SectionTag>
                        <textarea
                            value={replyInput}
                            onChange={e => setReplyInput(e.target.value)}
                            placeholder="你想对从前的 TA、此刻的 TA 说什么？"
                            className="w-full min-h-[76px] rounded-2xl px-3.5 py-3 text-[12.5px] outline-none resize-none"
                            style={{ background: '#fff', border: '1px solid rgba(0,0,0,0.06)', color: INK }}
                        />
                        <ScrapButton
                            variant="ink"
                            className="w-full mt-3 py-2.5 text-[12.5px]"
                            disabled={!replyInput.trim() || replying}
                            onClick={() => void submitReply()}
                            icon={replying ? <Sparkle size={14} weight="fill" className="animate-pulse" /> : <PaperPlaneTilt size={14} weight="fill" />}
                        >
                            {replying ? '这句话正在落下…' : '投进这场照面'}
                        </ScrapButton>
                    </PaperCard>
                </div>
            )}
        </Shell>
    );
};

const TinyButton: React.FC<{ children: React.ReactNode; onClick: () => void }> = ({ children, onClick }) => (
    <button onClick={onClick} className="rounded-full px-2 py-1.5 text-[10.5px] font-bold active:scale-95 transition" style={{ background: '#fff', border: '1px solid rgba(0,0,0,0.06)', color: INK }}>
        {children}
    </button>
);

const Chip: React.FC<{ children: React.ReactNode; active: boolean; onClick: () => void }> = ({ children, active, onClick }) => (
    <button onClick={onClick} className="rounded-full px-2 py-2 text-[11px] font-bold active:scale-95 transition" style={active ? { background: INK, color: '#fff' } : { background: '#fff', color: INK_SOFT, border: '1px solid rgba(0,0,0,0.06)' }}>
        {children}
    </button>
);

const ChoiceGrid: React.FC<{
    values: typeof MODE_TABS;
    active: TheaterReflectionMode;
    onPick: (value: TheaterReflectionMode) => void;
    withDesc?: boolean;
}> = ({ values, active, onPick, withDesc }) => (
    <div className="grid grid-cols-2 gap-2">
        {values.map(v => (
            <button key={v.value} onClick={() => onPick(v.value)} className="rounded-2xl px-3 py-2.5 text-left active:scale-[0.98] transition" style={active === v.value ? { background: INK, color: '#fff' } : { background: '#fff', color: INK, border: '1px solid rgba(0,0,0,0.06)' }}>
                <span className="block text-[12px] font-black">{v.label}</span>
                {withDesc && <span className="block text-[10px] mt-0.5 opacity-70 leading-snug">{v.desc}</span>}
            </button>
        ))}
    </div>
);

const SessionListCard: React.FC<{ session: TheaterReflectionSession; tilt: number; onOpen: () => void }> = ({ session, tilt, onOpen }) => (
    <PaperCard tilt={tilt} className="px-4 py-3.5" onClick={onOpen}>
        <div className="flex items-start gap-3">
            <span className="text-[24px] leading-none mt-0.5">🌙</span>
            <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                    <div className="text-[14px] font-black truncate" style={{ color: INK }}>{session.title}</div>
                    <span className="text-[9px] shrink-0" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>{new Date(session.updatedAt).toLocaleDateString()}</span>
                </div>
                <div className="text-[10.5px] mt-0.5 truncate" style={{ color: INK_SOFT }}>{session.charName} · {session.nodes.past.when} / {session.nodes.now.when}</div>
                <div className="text-[11.5px] leading-snug line-clamp-2 mt-1.5" style={{ color: '#6b6558' }}>{sessionExcerpt(session)}</div>
            </div>
        </div>
    </PaperCard>
);

const ReflectionView: React.FC<{
    session: TheaterReflectionSession;
    userName: string;
    collected: boolean;
    onRegen: () => void;
    regenerating: boolean;
    onCopy: () => void;
    onExport: () => void;
    onCollect: () => void;
    onDelete: () => void;
}> = ({ session, userName, collected, onRegen, regenerating, onCopy, onExport, onCollect, onDelete }) => {
    const lines = [...session.initialScene.lines, ...(session.continuationLines || [])];
    return (
        <div className="rounded-[26px] px-5 py-6 animate-fade-in relative overflow-hidden" style={{
            background: 'linear-gradient(180deg,#fff,#fff7ed)',
            border: '1px solid rgba(0,0,0,0.05)',
            boxShadow: '0 18px 44px -30px rgba(38,38,38,0.42)',
        }}>
            <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.65]" style={{ backgroundImage: HALFTONE, backgroundSize: '7px 7px' }} />
            <WashiTape color="ink" rotate={-5} className="absolute -top-3 left-1/2 -translate-x-1/2 w-24 h-6 rounded-[4px]" />
            <div aria-hidden className="pointer-events-none absolute -top-8 right-2 opacity-[0.08]"><MoonStars size={90} weight="fill" style={{ color: INK }} /></div>
            <div className="text-center mb-5 relative z-10">
                <div className="text-[9px] tracking-[0.32em] uppercase mb-1" style={{ fontFamily: 'var(--font-label)', color: '#f97316' }}>{reflectionOptionsLabel(session.options)}</div>
                <h3 className="text-2xl font-black tracking-wide" style={{ color: INK }}>{session.title}</h3>
                {session.subtitle && <p className="text-[11px] italic mt-1.5" style={{ color: INK_SOFT }}>{session.subtitle}</p>}
                <p className="text-[10.5px] mt-2" style={{ color: INK_SOFT }}>{session.nodes.past.when}「{session.nodes.past.title}」 / {session.nodes.now.when}「{session.nodes.now.title}」</p>
            </div>
            <div className="space-y-3 relative z-10">
                {lines.map((line, i) => <ReflectionBubble key={i} line={line} userName={userName} />)}
            </div>
            <div className="grid grid-cols-3 gap-2 mt-6 relative z-10">
                <ScrapButton variant="paper" className="py-2 text-[10px]" disabled={regenerating} onClick={onRegen} icon={<ArrowsClockwise size={12} weight="bold" />}>再照</ScrapButton>
                <ScrapButton variant="paper" className="py-2 text-[10px]" onClick={onCopy} icon={<Copy size={12} weight="bold" />}>复制</ScrapButton>
                <ScrapButton variant="paper" className="py-2 text-[10px]" onClick={onExport} icon={<ChatCircleText size={12} weight="bold" />}>聊天</ScrapButton>
                <ScrapButton variant={collected ? 'ghost' : 'paper'} className="py-2 text-[10px]" onClick={onCollect} icon={<BookmarkSimple size={12} weight={collected ? 'fill' : 'bold'} />}>{collected ? '已收' : '典藏'}</ScrapButton>
                <ScrapButton variant="ghost" className="col-span-2 py-2 text-[10px]" onClick={onDelete} icon={<Trash size={12} weight="bold" />}>删除这段对影</ScrapButton>
            </div>
        </div>
    );
};

const ReflectionBubble: React.FC<{ line: ReflectionLine; userName: string }> = ({ line, userName }) => {
    if (line.who === 'narration') {
        return <p className="text-center text-[11.5px] italic px-4 py-1 leading-relaxed" style={{ color: INK_SOFT }}>— {line.text} —</p>;
    }
    const isNow = line.who === 'now';
    const isUser = line.who === 'user';
    return (
        <div className={`flex ${isNow || isUser ? 'justify-end' : 'justify-start'}`}>
            <div className="max-w-[84%] px-3.5 py-2.5 text-[12.5px] leading-relaxed" style={{
                background: isUser ? '#fff' : isNow ? INK : 'rgba(255,255,255,0.96)',
                color: isUser ? INK : isNow ? '#fff' : '#3a362f',
                border: isNow ? 'none' : '1px solid rgba(0,0,0,0.06)',
                borderRadius: isUser ? '16px 16px 4px 16px' : isNow ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                boxShadow: '0 8px 18px -14px rgba(38,38,38,0.32)',
            }}>
                <span className="block text-[9px] font-black mb-1 tracking-wider" style={{ color: isNow ? 'rgba(255,255,255,0.62)' : INK_SOFT }}>
                    {isUser ? userName : isNow ? '此刻的 TA' : '从前的 TA'}
                </span>
                {line.text}
            </div>
        </div>
    );
};

export default ReflectionApp;
