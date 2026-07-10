import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useOS } from '../context/OSContext';
import {
    Path, Scroll, Cards, Quotes, DiceFive, FilmReel, MaskSad, MaskHappy, Sparkle,
    PawPrint, BeerBottle, MoonStars, type Icon, ClockCounterClockwise, Compass,
    Archive, Play, BookmarkSimple, Ticket, UsersThree, NotePencil,
    ArrowClockwise, WarningCircle,
} from '@phosphor-icons/react';
import { AppID, type GameSession, type GuidebookSession, type TalkSession, type TheaterCustomLibraryItem, type TheaterFauxPiece, type TheaterQuizSession, type TheaterReflectionSession, type TruthDareSession, type WerewolfGame } from '../types';
import GuidebookApp from './GuidebookApp';
import GameApp from './GameApp';
import TrajectoryApp from './theater/TrajectoryApp';
import ReflectionApp from './theater/ReflectionApp';
import TalkTherapyApp from './theater/TalkTherapyApp';
import ExtraApp from './theater/ExtraApp';
import DivinationApp from './theater/DivinationApp';
import WerewolfApp from './theater/WerewolfApp';
import TruthDareApp from './theater/TruthDareApp';
import { PaperShell, ScrapScroll, ScrapHeader, PaperCard, Stamp, SectionTag, WashiTape, HALFTONE, INK, INK_SOFT } from './ui/insScrapKit';
import { DB } from '../utils/db';
import { loadTrajectory, type CharTrajectory } from '../utils/theaterTimeline';
import { scrollToManualAnchor, useManualDeepLink } from '../utils/manualDeepLink';

/**
 * 幕间集：九折玩法的总控台。
 * 首页只做导航、本地记录汇总和继续入口；各折玩法、存档与 LLM 调用仍由子 App 自己负责。
 */

type Section = 'home' | 'guide' | 'trpg' | 'trajectory' | 'reflection' | 'talk' | 'extra' | 'divination' | 'werewolf' | 'truthdare';
type PlayableSection = Exclude<Section, 'home'>;
type HomeTab = 'overview' | 'programme' | 'records';

interface Zhe {
    section: PlayableSection;
    no: string;
    name: string;
    en: string;
    tagline: string;
    desc: string;
    useCase: string;
    Icon: Icon;
}

interface TheaterRecentItem {
    id: string;
    section: PlayableSection;
    title: string;
    subtitle: string;
    at: number;
    badge?: string;
}

interface TheaterSnapshot {
    loaded: boolean;
    totalCount: number;
    activeCount: number;
    counts: Record<PlayableSection, number>;
    recent: TheaterRecentItem[];
    continueItems: TheaterRecentItem[];
    customCount: number;
}

const PLAYABLE_SECTIONS: PlayableSection[] = ['guide', 'extra', 'divination', 'talk', 'trpg', 'trajectory', 'reflection', 'werewolf', 'truthdare'];

const PROGRAMME: Zhe[] = [
    { section: 'guide',      no: '壹', name: '攻略本', en: 'THE COURTSHIP',  tagline: '择一言，赌一段心动',     desc: '和角色排一出恋爱戏：定场、择言、攒心动，落幕收一张攻略结算卡。', useCase: '想推进一段可复盘的关系小游戏', Icon: Path },
    { section: 'extra',      no: '贰', name: '番外',   en: 'SIDE LEAVES',    tagline: '正传之外的边角料',       desc: '做问卷、搓帖子、仿微信聊天或生成一页像从手机里翻出来的证据。', useCase: '想整活、补设定或制造旁观视角', Icon: Scroll },
    { section: 'divination', no: '叁', name: '占卜',   en: 'THE READING',    tagline: '向纸牌问一问前路',       desc: '塔罗、雷诺曼、六爻、梅花易数都在这里；可自解，也可让 TA 接着解牌。', useCase: '想把问题换一种象征语言看看', Icon: Cards },
    { section: 'talk',       no: '肆', name: '谈心',   en: 'HEART TO HEART', tagline: '把心里的话，轻轻放下',   desc: '找一个角色认真听你说，也能把这一段收成安放卡或留到典藏馆。', useCase: '想被接住、梳理或温柔鼓劲', Icon: Quotes },
    { section: 'trpg',       no: '伍', name: 'TRPG',   en: 'THE CAMPAIGN',   tagline: '掷一颗骰子，闯一段故事', desc: '拉熟人开团：AI 现搓世界观、骰子判定、自由行动，剧情可转回聊天。', useCase: '想和一队人跑长线冒险', Icon: DiceFive },
    { section: 'trajectory', no: '陆', name: '轨迹',   en: 'BEFORE WE MET',  tagline: '那些还没遇见你的日子',   desc: '回到过去的节点，看 TA 原本走过的路，也看你从哪一天起走进 TA 的人生。', useCase: '想理解角色过去和人生底色', Icon: FilmReel },
    { section: 'reflection', no: '柒', name: '对影',   en: 'BY MOONLIGHT',   tagline: '举杯邀明月，对影成三人', desc: '同一个人，在不同时间里重逢；让从前的 TA 与此刻的 TA 照一次面。', useCase: '想写一段有留档的小剧场', Icon: MoonStars },
    { section: 'werewolf',   no: '捌', name: '狼人杀', en: 'THE WOLF NIGHT', tagline: '天黑请闭眼，谁是狼',       desc: '拉一桌熟人开局，随机发牌，AI 玩家会夜行动、白天发言、投票推理。', useCase: '想玩一局带伪装和推理的桌游', Icon: PawPrint },
    { section: 'truthdare',  no: '玖', name: '真心话大冒险', en: 'TRUTH OR DARE', tagline: '瓶口指向谁，谁就摊牌', desc: '围一圈转瓶子：受题者挑真心话或大冒险，另一人出题，当场作答。', useCase: '想轻松破冰、暧昧或整活', Icon: BeerBottle },
];

const HOME_TABS: { id: HomeTab; label: string; en: string; Icon: Icon }[] = [
    { id: 'overview', label: '总览', en: 'FOYER', Icon: Compass },
    { id: 'programme', label: '戏单', en: 'PROGRAMME', Icon: Ticket },
    { id: 'records', label: '记录', en: 'ARCHIVE', Icon: Archive },
];

const emptyCounts = (): Record<PlayableSection, number> => ({
    guide: 0,
    extra: 0,
    divination: 0,
    talk: 0,
    trpg: 0,
    trajectory: 0,
    reflection: 0,
    werewolf: 0,
    truthdare: 0,
});

const initialSnapshot: TheaterSnapshot = {
    loaded: false,
    totalCount: 0,
    activeCount: 0,
    counts: emptyCounts(),
    recent: [],
    continueItems: [],
    customCount: 0,
};

const programmeOf = (section: PlayableSection) => PROGRAMME.find(item => item.section === section)!;

const safeList = async <T,>(promise: Promise<T[]>): Promise<T[]> => {
    try { return await promise; } catch { return []; }
};

const formatRelativeTime = (ts?: number) => {
    if (!ts) return '刚刚';
    const diff = Math.max(0, Date.now() - ts);
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    if (diff < minute) return '刚刚';
    if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
    if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
    if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`;
    return new Date(ts).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
};

const uniqueSections = (sections: PlayableSection[]) => {
    const seen = new Set<PlayableSection>();
    return sections.filter(section => {
        if (seen.has(section)) return false;
        seen.add(section);
        return true;
    });
};

const countLabel = (count: number, unit = '份') => count > 99 ? `99+${unit}` : `${count}${unit}`;

const recentTitle = (item: TheaterRecentItem) => {
    const z = programmeOf(item.section);
    return `${z.name} · ${item.title}`;
};

const TheaterApp: React.FC = () => {
    const { closeApp, characters } = useOS();
    const [section, setSection] = useState<Section>('home');
    const [tab, setTab] = useState<HomeTab>('overview');
    const [snapshot, setSnapshot] = useState<TheaterSnapshot>(initialSnapshot);

    const handleManualDeepLink = useCallback((target: { anchorId?: string; payload?: Record<string, unknown> }) => {
        setSection('home');
        const payloadTab = target.payload?.tab;
        if (payloadTab === 'overview' || payloadTab === 'programme' || payloadTab === 'records') setTab(payloadTab);
        window.setTimeout(() => scrollToManualAnchor(target.anchorId || 'manual-theater-root'), 140);
    }, []);
    useManualDeepLink(AppID.Theater, handleManualDeepLink);

    useEffect(() => {
        let alive = true;
        const charName = (id?: string) => characters.find(c => c.id === id)?.name || '某人';

        const load = async () => {
            const [
                guidebook,
                games,
                talks,
                quizSessions,
                fauxPieces,
                customLibrary,
                reflections,
                werewolves,
                truthDares,
                trajectories,
            ] = await Promise.all([
                safeList<GuidebookSession>(DB.getAllGuidebookSessions()),
                safeList<GameSession>(DB.getAllGames()),
                safeList<TalkSession>(DB.getAllTalkSessions()),
                safeList<TheaterQuizSession>(DB.getAllTheaterQuizSessions()),
                safeList<TheaterFauxPiece>(DB.getAllTheaterFauxPieces()),
                safeList<TheaterCustomLibraryItem>(DB.getAllTheaterCustomLibraryItems()),
                safeList<TheaterReflectionSession>(DB.getAllTheaterReflectionSessions()),
                safeList<WerewolfGame>(DB.getAllWerewolfGames()),
                safeList<TruthDareSession>(DB.getAllTruthDareSessions()),
                Promise.all(characters.map(c => loadTrajectory(c.id).catch(() => null))).then(list => list.filter(Boolean) as CharTrajectory[]).catch(() => []),
            ]);

            const counts = emptyCounts();
            counts.guide = guidebook.length;
            counts.trpg = games.length;
            counts.talk = talks.length;
            counts.extra = quizSessions.length + fauxPieces.length + customLibrary.length;
            counts.trajectory = trajectories.length;
            counts.reflection = reflections.length;
            counts.werewolf = werewolves.length;
            counts.truthdare = truthDares.length;

            const activeGuide = guidebook.filter(s => s.status !== 'ended');
            const activeQuiz = quizSessions.filter(s => s.status === 'active');
            const activeWerewolves = werewolves.filter(g => g.phase !== 'over' && !g.winner);

            const recent: TheaterRecentItem[] = [
                ...guidebook.map(s => ({
                    id: `guide-${s.id}`,
                    section: 'guide' as const,
                    title: charName(s.charId),
                    subtitle: `${s.rounds?.length || 0}/${s.maxRounds || 0} 回合 · ${s.status === 'ended' ? '已结算' : '可继续'}`,
                    at: s.lastPlayedAt || s.createdAt,
                    badge: s.status === 'ended' ? '结算' : '待续',
                })),
                ...games.map(g => ({
                    id: `trpg-${g.id}`,
                    section: 'trpg' as const,
                    title: g.title || '一场冒险',
                    subtitle: `${g.logs?.length || 0} 段记录 · ${g.status?.location || '旅途中'}`,
                    at: g.lastPlayedAt || g.createdAt,
                    badge: '战役',
                })),
                ...talks.map(s => ({
                    id: `talk-${s.id}`,
                    section: 'talk' as const,
                    title: s.title || '一次谈心',
                    subtitle: `和 ${charName(s.charId)} · ${s.turns?.length || 0} 句 · ${s.insights?.length || 0} 张安放卡`,
                    at: s.lastActiveAt || s.createdAt,
                    badge: s.mood || '谈心',
                })),
                ...quizSessions.map(s => ({
                    id: `quiz-${s.id}`,
                    section: 'extra' as const,
                    title: s.title || s.topic || '问卷番外',
                    subtitle: `${s.participantIds?.map(charName).join('、') || '多人'} · ${s.currentIndex || 0}/${s.total || 0} 题`,
                    at: s.lastActiveAt || s.createdAt,
                    badge: s.status === 'finished' ? '完成' : '问卷',
                })),
                ...fauxPieces.map(p => ({
                    id: `faux-${p.id}`,
                    section: 'extra' as const,
                    title: p.keyword || p.charName || '仿真图文',
                    subtitle: `${p.charName} · ${p.kind}`,
                    at: p.updatedAt || p.createdAt,
                    badge: '图文',
                })),
                ...trajectories.map(t => ({
                    id: `trajectory-${t.charId}`,
                    section: 'trajectory' as const,
                    title: charName(t.charId),
                    subtitle: `${t.nodes?.length || 0} 个节点 · ${Object.keys(t.nodeDetails || {}).length} 帧细看`,
                    at: t.generatedAt,
                    badge: '轨迹',
                })),
                ...reflections.map(s => ({
                    id: `reflection-${s.id}`,
                    section: 'reflection' as const,
                    title: s.title || s.charName || '一段对影',
                    subtitle: `${s.charName} · ${s.nodes?.past?.when || '过去'} / ${s.nodes?.now?.when || '此刻'}`,
                    at: s.updatedAt || s.createdAt,
                    badge: '对影',
                })),
                ...werewolves.map(g => ({
                    id: `werewolf-${g.id}`,
                    section: 'werewolf' as const,
                    title: g.title || '一局狼人杀',
                    subtitle: `${g.players?.length || 0} 人 · 第 ${g.round || 1} 轮 · ${g.winner ? '已散场' : '进行中'}`,
                    at: g.lastActiveAt || g.createdAt,
                    badge: g.winner ? '终局' : '待续',
                })),
                ...truthDares.map(s => ({
                    id: `truthdare-${s.id}`,
                    section: 'truthdare' as const,
                    title: s.title || '真心话大冒险',
                    subtitle: `${s.players?.length || 0} 人 · ${s.rounds?.length || 0} 回合`,
                    at: s.lastActiveAt || s.createdAt,
                    badge: '转瓶子',
                })),
            ].sort((a, b) => b.at - a.at);

            const continueItems: TheaterRecentItem[] = [
                ...activeGuide.map(s => ({
                    id: `continue-guide-${s.id}`,
                    section: 'guide' as const,
                    title: charName(s.charId),
                    subtitle: `攻略局停在第 ${Math.max(1, s.currentRound || 1)} 回合`,
                    at: s.lastPlayedAt || s.createdAt,
                    badge: '攻略待续',
                })),
                ...games.map(g => ({
                    id: `continue-trpg-${g.id}`,
                    section: 'trpg' as const,
                    title: g.title || '一场冒险',
                    subtitle: g.chapter?.title || g.status?.location || '战役仍可继续',
                    at: g.lastPlayedAt || g.createdAt,
                    badge: 'TRPG',
                })),
                ...activeQuiz.map(s => ({
                    id: `continue-quiz-${s.id}`,
                    section: 'extra' as const,
                    title: s.title || s.topic || '问卷番外',
                    subtitle: `做到第 ${Math.min((s.currentIndex || 0) + 1, s.total || 1)} 题`,
                    at: s.lastActiveAt || s.createdAt,
                    badge: '问卷待续',
                })),
                ...activeWerewolves.map(g => ({
                    id: `continue-werewolf-${g.id}`,
                    section: 'werewolf' as const,
                    title: g.title || '一局狼人杀',
                    subtitle: `${g.players?.length || 0} 人 · 第 ${g.round || 1} 轮`,
                    at: g.lastActiveAt || g.createdAt,
                    badge: '牌局待续',
                })),
                ...truthDares.map(s => ({
                    id: `continue-truthdare-${s.id}`,
                    section: 'truthdare' as const,
                    title: s.title || '真心话大冒险',
                    subtitle: `${s.rounds?.length || 0} 回合后可继续转瓶子`,
                    at: s.lastActiveAt || s.createdAt,
                    badge: '续玩',
                })),
            ].sort((a, b) => b.at - a.at).slice(0, 5);

            if (!alive) return;
            setSnapshot({
                loaded: true,
                counts,
                totalCount: PLAYABLE_SECTIONS.reduce((sum, key) => sum + counts[key], 0),
                activeCount: activeGuide.length + games.length + activeQuiz.length + activeWerewolves.length + truthDares.length,
                recent: recent.slice(0, 24),
                continueItems,
                customCount: customLibrary.length,
            });
        };

        setSnapshot(prev => ({ ...prev, loaded: false }));
        void load();
        return () => { alive = false; };
    }, [characters]);

    const recommendations = useMemo(() => {
        const hour = new Date().getHours();
        const latestContinue = snapshot.continueItems[0]?.section;
        const timePicks: PlayableSection[] = hour >= 22
            ? ['talk', 'divination', 'reflection']
            : hour < 11
                ? ['trajectory', 'guide', 'divination']
                : characters.length >= 5
                    ? ['werewolf', 'extra', 'guide']
                    : ['extra', 'guide', 'truthdare'];
        const base = uniqueSections([latestContinue, ...timePicks, 'talk', 'divination'].filter(Boolean) as PlayableSection[]);
        return base.slice(0, 3).map(section => {
            const z = programmeOf(section);
            const active = snapshot.continueItems.find(item => item.section === section);
            return {
                ...z,
                reason: active ? active.badge || '有记录可续' : z.useCase,
            };
        });
    }, [characters.length, snapshot.continueItems]);

    if (section === 'guide') return <GuidebookApp onExit={() => setSection('home')} />;
    if (section === 'trpg') return <GameApp onExit={() => setSection('home')} />;
    if (section === 'trajectory') return <TrajectoryApp onExit={() => setSection('home')} />;
    if (section === 'reflection') return <ReflectionApp onExit={() => setSection('home')} />;
    if (section === 'talk') return <TalkTherapyApp onExit={() => setSection('home')} />;
    if (section === 'extra') return <ExtraApp onExit={() => setSection('home')} />;
    if (section === 'divination') return <DivinationApp onExit={() => setSection('home')} />;
    if (section === 'werewolf') return <WerewolfApp onExit={() => setSection('home')} />;
    if (section === 'truthdare') return <TruthDareApp onExit={() => setSection('home')} />;

    return (
        <PaperShell>
            <ScrapHeader title="幕间集" en="INTERLUDES" onBack={closeApp} backLabel="回桌面" />

            <div className="relative z-20 px-5 pb-2" data-manual-anchor="manual-theater-root">
                <div className="grid grid-cols-3 gap-2 rounded-[18px] p-1" style={{ background: 'rgba(255,253,247,0.66)', border: '1px solid rgba(176,170,158,0.55)' }}>
                    {HOME_TABS.map(item => {
                        const on = tab === item.id;
                        return (
                            <button
                                key={item.id}
                                onClick={() => setTab(item.id)}
                                className="h-10 rounded-[14px] inline-flex items-center justify-center gap-1.5 text-[12px] font-black active:scale-95 transition"
                                style={on ? { background: INK, color: '#f6f3ec', boxShadow: '0 12px 20px -16px rgba(31,29,26,0.7)' } : { color: INK_SOFT }}
                                data-manual-anchor={`manual-theater-${item.id}`}
                            >
                                <item.Icon size={14} weight={on ? 'fill' : 'bold'} />
                                {item.label}
                            </button>
                        );
                    })}
                </div>
            </div>

            <ScrapScroll className="px-5 pb-12 pt-1">
                {tab === 'overview' && (
                    <div className="space-y-5">
                        <HeroCard snapshot={snapshot} characterCount={characters.length} />
                        <QuickPicks recommendations={recommendations} onOpen={setSection} />
                        <ContinueBoard items={snapshot.continueItems} loading={!snapshot.loaded} onOpen={setSection} />
                        <RecentBoard items={snapshot.recent.slice(0, 5)} loading={!snapshot.loaded} onOpen={setSection} onOpenRecords={() => setTab('records')} />
                    </div>
                )}

                {tab === 'programme' && <ProgrammeBoard snapshot={snapshot} onOpen={setSection} />}
                {tab === 'records' && <RecordsBoard snapshot={snapshot} onOpen={setSection} />}

                <div className="mt-8 text-center text-[9px] tracking-[0.34em]" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>— 散 场 不 谢 幕 —</div>
            </ScrapScroll>
        </PaperShell>
    );
};

const HeroCard: React.FC<{ snapshot: TheaterSnapshot; characterCount: number }> = ({ snapshot, characterCount }) => (
    <PaperCard tilt={-0.8} className="px-6 py-6 mt-2 overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.10]" style={{ backgroundImage: HALFTONE, backgroundSize: '7px 7px' }} />
        <WashiTape color="ink" rotate={-7} className="absolute -top-2 right-6 w-20 h-6 rounded-[2px] text-[8px] tracking-[0.35em]" style={{ fontFamily: 'var(--font-label)' }}>TICKET</WashiTape>
        <div className="relative">
            <div className="text-[9px] tracking-[0.42em] mb-2" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>TONIGHT'S BILL · 幕 间 总 览</div>
            <div className="flex items-end gap-2.5">
                <div className="text-[52px] leading-[0.9] font-black tracking-tight" style={{ color: INK }}>幕间集</div>
                <MaskHappy size={30} weight="fill" className="mb-2 -rotate-[8deg]" style={{ color: INK }} />
                <MaskSad size={22} weight="regular" className="mb-2.5 rotate-[6deg]" style={{ color: INK_SOFT }} />
            </div>
            <div className="mt-3 flex items-center gap-2">
                <span className="h-px flex-1" style={{ backgroundImage: 'repeating-linear-gradient(90deg, rgba(140,132,118,0.6) 0 5px, transparent 5px 10px)' }} />
                <Sparkle size={12} weight="fill" style={{ color: INK_SOFT }} />
                <span className="h-px flex-1" style={{ backgroundImage: 'repeating-linear-gradient(90deg, rgba(140,132,118,0.6) 0 5px, transparent 5px 10px)' }} />
            </div>
            <div className="text-[12.5px] mt-2.5 leading-relaxed" style={{ color: '#54504a' }}>
                九折都在一张戏单里：想续上回的局，看总览；想开新戏，翻戏单；想找旧记录，进记录。
            </div>
            <div className="grid grid-cols-3 gap-2 mt-4">
                <MiniStat icon={<Ticket size={14} weight="fill" />} value="九折" label="可开演" />
                <MiniStat icon={<UsersThree size={14} weight="fill" />} value={`${characterCount}`} label="位登场" />
                <MiniStat icon={<Archive size={14} weight="fill" />} value={snapshot.loaded ? `${snapshot.totalCount}` : '…'} label="份留档" />
            </div>
        </div>
    </PaperCard>
);

const MiniStat: React.FC<{ icon: React.ReactNode; value: string; label: string }> = ({ icon, value, label }) => (
    <div className="rounded-[12px] px-2.5 py-2" style={{ background: 'rgba(255,253,247,0.68)', border: '1px solid rgba(176,170,158,0.55)' }}>
        <div className="flex items-center gap-1.5 text-[15px] font-black leading-none" style={{ color: INK }}>{icon}{value}</div>
        <div className="text-[9px] mt-1 tracking-[0.16em]" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>{label}</div>
    </div>
);

const QuickPicks: React.FC<{ recommendations: Array<Zhe & { reason: string }>; onOpen: (section: PlayableSection) => void }> = ({ recommendations, onOpen }) => (
    <div>
        <SectionTag en="TONIGHT">今日开演</SectionTag>
        <div className="grid grid-cols-3 gap-2.5 mt-3">
            {recommendations.map((item, i) => (
                <button key={item.section} onClick={() => onOpen(item.section)} className="text-left active:scale-[0.97] transition-transform">
                    <PaperCard tilt={i === 1 ? 0.3 : i === 2 ? 0.7 : -0.7} className="px-3 py-3 h-full min-h-[128px]">
                        <div className="flex items-center justify-between">
                            <Stamp size={34}><item.Icon size={18} weight="duotone" /></Stamp>
                            <span className="text-[18px] font-black" style={{ color: INK }}>{item.no}</span>
                        </div>
                        <div className="text-[14px] font-black mt-3 leading-tight" style={{ color: INK }}>{item.name}</div>
                        <div className="text-[10.5px] leading-snug mt-1.5 line-clamp-3" style={{ color: '#6b6558' }}>{item.reason}</div>
                    </PaperCard>
                </button>
            ))}
        </div>
    </div>
);

const ContinueBoard: React.FC<{ items: TheaterRecentItem[]; loading: boolean; onOpen: (section: PlayableSection) => void }> = ({ items, loading, onOpen }) => (
    <div>
        <SectionTag en="CONTINUE">待续场次</SectionTag>
        <div className="mt-3 space-y-3">
            {loading ? <LoadingCard text="正在翻本地戏票…" /> : items.length ? items.slice(0, 3).map((item, i) => (
                <RecentCard key={item.id} item={item} tilt={i % 2 ? 0.45 : -0.45} onOpen={onOpen} compact />
            )) : <EmptyCard icon={<Play size={18} weight="fill" />} title="没有悬着的场次" text="开一折新戏后，未完的攻略局、问卷、牌局和战役会出现在这里。" />}
        </div>
    </div>
);

const RecentBoard: React.FC<{ items: TheaterRecentItem[]; loading: boolean; onOpen: (section: PlayableSection) => void; onOpenRecords: () => void }> = ({ items, loading, onOpen, onOpenRecords }) => (
    <div>
        <div className="flex items-center gap-2">
            <SectionTag en="RECENT" className="flex-1">最近留档</SectionTag>
            {items.length > 0 && (
                <button onClick={onOpenRecords} className="shrink-0 px-3 py-1.5 rounded-full text-[11px] font-black active:scale-95" style={{ background: '#1f1d1a', color: '#f6f3ec' }}>
                    全部
                </button>
            )}
        </div>
        <div className="mt-3 space-y-3">
            {loading ? <LoadingCard text="正在整理旧记录…" /> : items.length ? items.map((item, i) => (
                <RecentCard key={item.id} item={item} tilt={i % 2 ? 0.4 : -0.4} onOpen={onOpen} />
            )) : <EmptyCard icon={<Archive size={18} weight="fill" />} title="还没有幕间记录" text="生成过番外、谈心、对影或玩过牌局后，这里会按时间倒序收起来。" />}
        </div>
    </div>
);

const ProgrammeBoard: React.FC<{ snapshot: TheaterSnapshot; onOpen: (section: PlayableSection) => void }> = ({ snapshot, onOpen }) => (
    <div>
        <PaperCard tilt={-0.4} className="px-5 py-4 mt-2">
            <div className="text-[9px] tracking-[0.34em] mb-1.5" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>THE PROGRAMME</div>
            <div className="text-[24px] font-black" style={{ color: INK }}>完整戏单</div>
            <div className="text-[12px] mt-1.5 leading-relaxed" style={{ color: '#5b554a' }}>每一折都是独立玩法，存档彼此分开；退出子页会回到这张戏单。</div>
        </PaperCard>

        <SectionTag en="ALL ACTS" className="mt-7 mb-3.5">九折入口</SectionTag>
        <div className="space-y-4">
            {PROGRAMME.map((z, i) => <ProgrammeCard key={z.section} item={z} index={i} count={snapshot.counts[z.section]} onOpen={onOpen} />)}
        </div>
    </div>
);

const ProgrammeCard: React.FC<{ item: Zhe; index: number; count: number; onOpen: (section: PlayableSection) => void }> = ({ item: z, index, count, onOpen }) => {
    const tilt = index % 2 === 0 ? -0.7 : 0.6;
    const tape = (['amber', 'sage', 'butter', 'lilac'] as const)[index % 4];
    return (
        <PaperCard tilt={tilt} tape={tape} onClick={() => onOpen(z.section)} className="px-4 py-4">
            <div className="flex items-stretch gap-3.5">
                <div className="shrink-0 flex flex-col items-center justify-center px-2.5 py-1 self-stretch" style={{ borderRight: '1px dashed rgba(150,144,132,0.6)' }}>
                    <div className="text-[8px] tracking-[0.2em]" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>折</div>
                    <div className="text-[26px] leading-none font-black" style={{ color: INK }}>{z.no}</div>
                    <div className="text-[7px] mt-1" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>No.{index + 1}</div>
                </div>

                <Stamp size={46} className="self-center">
                    <z.Icon size={24} weight="duotone" />
                </Stamp>

                <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                        <div className="text-[21px] font-black tracking-wide" style={{ color: INK }}>{z.name}</div>
                        <div className="text-[8px] tracking-[0.28em] uppercase truncate" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>{z.en}</div>
                    </div>
                    <div className="text-[12px] font-bold mt-0.5" style={{ color: '#4a463e' }}>「{z.tagline}」</div>
                    <div className="text-[11px] mt-1.5 leading-relaxed" style={{ color: '#6b6558' }}>{z.desc}</div>
                    {count > 0 && (
                        <div className="inline-flex items-center gap-1 mt-2 px-2 py-0.5 rounded-full text-[10px] font-black" style={{ background: 'rgba(31,29,26,0.06)', color: INK_SOFT }}>
                            <BookmarkSimple size={10} weight="fill" /> {countLabel(count)}
                        </div>
                    )}
                </div>

                <div className="shrink-0 self-center flex flex-col items-center gap-1" style={{ color: INK }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
                    <span className="text-[8px] tracking-[0.16em]" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>OPEN</span>
                </div>
            </div>
        </PaperCard>
    );
};

const RecordsBoard: React.FC<{ snapshot: TheaterSnapshot; onOpen: (section: PlayableSection) => void }> = ({ snapshot, onOpen }) => (
    <div className="space-y-5">
        <PaperCard tilt={0.35} className="px-5 py-4 mt-2">
            <div className="flex items-start gap-3">
                <Stamp size={44}><Archive size={23} weight="duotone" /></Stamp>
                <div className="min-w-0 flex-1">
                    <div className="text-[22px] font-black" style={{ color: INK }}>幕间档案</div>
                    <div className="text-[12px] mt-1 leading-relaxed" style={{ color: '#5b554a' }}>
                        本机共 {snapshot.loaded ? snapshot.totalCount : '…'} 份幕间记录，{snapshot.activeCount} 个可继续的场次。
                    </div>
                </div>
            </div>
        </PaperCard>

        <SectionTag en="COUNT">分折统计</SectionTag>
        <div className="grid grid-cols-3 gap-2.5">
            {PROGRAMME.map(item => (
                <button key={item.section} onClick={() => onOpen(item.section)} className="active:scale-95 transition text-left">
                    <div className="rounded-[14px] px-3 py-3 min-h-[82px]" style={{ background: 'rgba(255,253,247,0.78)', border: '1px solid rgba(176,170,158,0.6)' }}>
                        <div className="flex items-center gap-1.5">
                            <item.Icon size={14} weight="fill" style={{ color: INK }} />
                            <span className="text-[12px] font-black truncate" style={{ color: INK }}>{item.name}</span>
                        </div>
                        <div className="text-[22px] font-black mt-2 leading-none" style={{ color: INK }}>{snapshot.loaded ? snapshot.counts[item.section] : '…'}</div>
                        <div className="text-[9px] mt-1" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>{item.en}</div>
                    </div>
                </button>
            ))}
        </div>

        {snapshot.customCount > 0 && (
            <PaperCard tilt={-0.25} className="px-4 py-3 flex items-center gap-3">
                <Stamp size={38}><NotePencil size={19} weight="duotone" /></Stamp>
                <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-black" style={{ color: INK }}>自定义导入库</div>
                    <div className="text-[11px] mt-0.5" style={{ color: INK_SOFT }}>{snapshot.customCount} 条问卷题库 / 小剧场指令，已并入番外。</div>
                </div>
            </PaperCard>
        )}

        <div>
            <SectionTag en="TIMELINE">最近记录</SectionTag>
            <div className="mt-3 space-y-3">
                {!snapshot.loaded ? <LoadingCard text="正在打开档案盒…" /> : snapshot.recent.length ? snapshot.recent.slice(0, 14).map((item, i) => (
                    <RecentCard key={item.id} item={item} tilt={i % 2 ? 0.4 : -0.4} onOpen={onOpen} />
                )) : <EmptyCard icon={<WarningCircle size={18} weight="fill" />} title="档案盒还是空的" text="从戏单开一折，完成或保存后的记录会出现在这里。" />}
            </div>
        </div>
    </div>
);

const RecentCard: React.FC<{ item: TheaterRecentItem; tilt: number; onOpen: (section: PlayableSection) => void; compact?: boolean }> = ({ item, tilt, onOpen, compact }) => {
    const z = programmeOf(item.section);
    return (
        <PaperCard tilt={tilt} className={`px-3.5 ${compact ? 'py-3' : 'py-3.5'} flex items-center gap-3`}>
            <Stamp size={compact ? 38 : 42}><z.Icon size={compact ? 19 : 21} weight="duotone" /></Stamp>
            <button onClick={() => onOpen(item.section)} className="flex-1 min-w-0 text-left active:scale-[0.99]">
                <div className="flex items-center gap-2 min-w-0">
                    <div className="text-[13.5px] font-black truncate" style={{ color: INK }}>{recentTitle(item)}</div>
                    {item.badge && <span className="shrink-0 px-1.5 py-0.5 rounded-full text-[9px] font-black" style={{ background: 'rgba(31,29,26,0.08)', color: INK_SOFT }}>{item.badge}</span>}
                </div>
                <div className="text-[10.5px] mt-0.5 truncate" style={{ color: INK_SOFT }}>{item.subtitle}</div>
            </button>
            <div className="shrink-0 text-right">
                <ClockCounterClockwise size={14} weight="bold" className="ml-auto mb-1" style={{ color: INK_SOFT }} />
                <div className="text-[9px] whitespace-nowrap" style={{ color: INK_SOFT }}>{formatRelativeTime(item.at)}</div>
            </div>
        </PaperCard>
    );
};

const LoadingCard: React.FC<{ text: string }> = ({ text }) => (
    <PaperCard className="px-4 py-4 flex items-center gap-3">
        <ArrowClockwise size={18} weight="bold" className="animate-spin" style={{ color: INK_SOFT }} />
        <div className="text-[12px]" style={{ color: INK_SOFT }}>{text}</div>
    </PaperCard>
);

const EmptyCard: React.FC<{ icon: React.ReactNode; title: string; text: string }> = ({ icon, title, text }) => (
    <PaperCard className="px-4 py-4 flex items-start gap-3">
        <Stamp size={38}>{icon}</Stamp>
        <div className="min-w-0 flex-1">
            <div className="text-[13px] font-black" style={{ color: INK }}>{title}</div>
            <div className="text-[11.5px] leading-relaxed mt-1" style={{ color: '#6b6558' }}>{text}</div>
        </div>
    </PaperCard>
);

export default TheaterApp;
