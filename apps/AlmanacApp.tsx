import React, { useCallback, useMemo, useState } from 'react';
import {
    BookmarkSimple,
    CalendarCheck,
    CalendarDots,
    CaretRight,
    ClockClockwise,
    Heart,
    Sparkle,
} from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import { AppID } from '../types';
import { scrollToManualAnchor, useManualDeepLink } from '../utils/manualDeepLink';
import ScheduleApp from './ScheduleApp';
import { SpecialMomentsApp } from '../components/ValentineEvent';
import AlmanacCalendar from './almanac/AlmanacCalendar';
import CollectionHall from './almanac/CollectionHall';
import WeddingSection from './almanac/WeddingSection';
import {
    InsButton,
    InsCard,
    InsHeader,
    InsScroll,
    InsShell,
    Polaroid,
    SectionLabel,
    accent,
    INK,
    INK_SOFT,
} from '../components/ui/insKit';

/**
 * 岁时记 · 封面页
 * ------------------------------------------------------------
 * 合并入口：时光契约、共享月历、典藏馆、喜事、特别时光。
 * 只负责导航和视觉壳，子页的数据与玩法保持原本独立。
 */

const MONTHS_CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六'];
type AlmanacSection = 'home' | 'schedule' | 'moments' | 'calendar' | 'collection' | 'wedding';

const useMonthCells = (now: Date) => useMemo(() => {
    const y = now.getFullYear();
    const m = now.getMonth();
    const first = new Date(y, m, 1).getDay();
    const days = new Date(y, m + 1, 0).getDate();
    const cells: Array<number | null> = [];
    for (let i = 0; i < first; i++) cells.push(null);
    for (let d = 1; d <= days; d++) cells.push(d);
    while (cells.length < 35) cells.push(null);
    return cells.slice(0, 35);
}, [now]);

const PolaroidBackdrop: React.FC<{ icon: React.ReactNode; tone: string; label: string }> = ({ icon, tone, label }) => (
    <div className="w-full h-full flex flex-col items-center justify-center gap-2">
        <span
            className="w-14 h-14 rounded-full flex items-center justify-center"
            style={{ background: '#fff', border: '1px solid rgba(0,0,0,0.06)', color: tone, boxShadow: '0 10px 24px -18px rgba(38,38,38,0.36)' }}
        >
            {icon}
        </span>
        <span className="text-[8px] tracking-[0.24em] uppercase" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>
            {label}
        </span>
    </div>
);

const AlmanacApp: React.FC = () => {
    const { closeApp } = useOS();
    const [section, setSection] = useState<AlmanacSection>('home');
    const now = useMemo(() => new Date(), []);
    const today = now.getDate();
    const monthCells = useMonthCells(now);
    const a = accent('pink');

    useManualDeepLink(AppID.Almanac, useCallback((target) => {
        const route = target.route as AlmanacSection | undefined;
        const knownRoutes: AlmanacSection[] = ['schedule', 'moments', 'calendar', 'collection', 'wedding'];
        if (route && knownRoutes.includes(route)) {
            setSection(route);
            window.setTimeout(() => {
                if (target.anchorId) scrollToManualAnchor(target.anchorId);
            }, 160);
            return;
        }
        setSection('home');
        window.setTimeout(() => {
            if (!scrollToManualAnchor(target.anchorId)) scrollToManualAnchor('manual-almanac-root');
        }, 120);
    }, []));

    if (section === 'schedule') return <ScheduleApp onExit={() => setSection('home')} />;
    if (section === 'moments') return <SpecialMomentsApp onExit={() => setSection('home')} />;
    if (section === 'calendar') return <AlmanacCalendar onExit={() => setSection('home')} />;
    if (section === 'collection') return <CollectionHall onExit={() => setSection('home')} />;
    if (section === 'wedding') return <WeddingSection onExit={() => setSection('home')} />;

    const entries: Array<{
        key: Exclude<AlmanacSection, 'home'>;
        title: string;
        en: string;
        date: string;
        icon: React.ReactNode;
        tone: string;
        anchor: string;
        rotate: number;
    }> = [
        {
            key: 'calendar',
            title: '这个月',
            en: 'calendar',
            date: `${now.getMonth() + 1}/${today}`,
            icon: <CalendarDots size={30} weight="bold" />,
            tone: a.solid,
            anchor: 'manual-almanac-calendar-card',
            rotate: -1.5,
        },
        {
            key: 'schedule',
            title: '时光契约',
            en: 'promise',
            date: 'PLAN',
            icon: <CalendarCheck size={30} weight="bold" />,
            tone: '#7fa8b3',
            anchor: 'manual-almanac-schedule-card',
            rotate: 1.2,
        },
        {
            key: 'collection',
            title: '典藏馆',
            en: 'archive',
            date: 'SAVE',
            icon: <BookmarkSimple size={30} weight="bold" />,
            tone: '#9b7ad8',
            anchor: 'manual-almanac-collection-card',
            rotate: 0.8,
        },
        {
            key: 'wedding',
            title: '喜事',
            en: 'wedding',
            date: 'LOVE',
            icon: <Heart size={30} weight="fill" />,
            tone: '#d76a96',
            anchor: 'manual-almanac-wedding-card',
            rotate: -0.9,
        },
        {
            key: 'moments',
            title: '特别时光',
            en: 'moments',
            date: 'MEMO',
            icon: <Sparkle size={30} weight="fill" />,
            tone: '#f29f6b',
            anchor: 'manual-almanac-moments-card',
            rotate: 1.4,
        },
    ];

    return (
        <InsShell accent="pink" className="almanac-polaroid">
            <InsHeader
                title="岁时记"
                en="ALMANAC"
                onBack={closeApp}
                accent="pink"
                right={
                    <span
                        className="h-9 px-3 rounded-full inline-flex items-center gap-1.5 text-[11px] font-black"
                        style={{ background: '#fff', border: '1px solid rgba(0,0,0,0.06)', color: a.ink, boxShadow: '0 6px 16px -12px rgba(38,38,38,0.32)' }}
                    >
                        <CalendarDots size={15} weight="bold" />
                        {MONTHS_CN[now.getMonth()]}月{today}日
                    </span>
                }
            />

            <InsScroll className="px-4 pb-8">
                <section data-manual-anchor="manual-almanac-root" className="space-y-5">
                    <InsCard className="p-4 overflow-visible" accent="pink">
                        <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                                <div className="text-[9px] tracking-[0.34em] uppercase" style={{ fontFamily: 'var(--font-label)', color: a.solid }}>
                                    SEASONAL CAMERA ROLL
                                </div>
                                <h1 className="mt-1 text-[40px] leading-none font-black tracking-tight" style={{ color: INK }}>岁时记</h1>
                                <p className="mt-2 text-[12px] leading-relaxed max-w-[13rem]" style={{ color: '#6f6974' }}>
                                    把约定、月历、纪念日和节日回忆，排进同一卷时间相册。
                                </p>
                            </div>
                            <div className="relative shrink-0 w-[96px] bg-white rounded-[14px] p-2 pb-4 rotate-[2deg]" style={{ boxShadow: '0 18px 34px -22px rgba(38,38,38,0.42)' }}>
                                <div className="text-center text-[8px] tracking-[0.22em] uppercase mb-1.5" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>
                                    {now.getFullYear()}
                                </div>
                                <div className="grid grid-cols-7 gap-[2px]">
                                    {monthCells.slice(0, 28).map((d, idx) => (
                                        <span
                                            key={`${d || 'e'}-${idx}`}
                                            className="aspect-square rounded-[3px]"
                                            style={{
                                                background: d === today ? a.solid : d ? a.soft : '#f0ede8',
                                                opacity: d ? 1 : 0.55,
                                            }}
                                        />
                                    ))}
                                </div>
                                <div className="absolute left-0 right-0 bottom-1 text-center text-[12px] font-bold" style={{ color: INK, fontFamily: 'var(--font-hand)' }}>
                                    {MONTHS_CN[now.getMonth()]}月
                                </div>
                            </div>
                        </div>

                        <div className="mt-4 grid grid-cols-7 gap-1">
                            {WEEK_CN.map((w) => (
                                <div key={w} className="text-center text-[9px] font-bold" style={{ color: INK_SOFT }}>{w}</div>
                            ))}
                            {monthCells.map((d, idx) => (
                                <button
                                    key={`${d || 'blank'}-${idx}`}
                                    type="button"
                                    onClick={d ? () => setSection('calendar') : undefined}
                                    disabled={!d}
                                    className="aspect-square rounded-[10px] text-[11px] font-black transition-transform active:scale-95 disabled:opacity-30"
                                    style={d === today
                                        ? { background: a.solid, color: '#fff', boxShadow: `0 10px 18px -12px ${a.solid}` }
                                        : { background: d ? '#fff7fb' : '#f2eee8', color: d ? a.ink : 'transparent', border: '1px solid rgba(236,72,153,0.10)' }}
                                    title={d ? `${d}日` : undefined}
                                >
                                    {d}
                                </button>
                            ))}
                        </div>
                    </InsCard>

                    <div>
                        <SectionLabel en="PHOTO ENTRIES" accent="pink" className="mb-3">相片入口</SectionLabel>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-5 pb-1">
                            {entries.map((entry, idx) => (
                                <div key={entry.key} data-manual-anchor={entry.anchor} className={idx === entries.length - 1 ? 'col-span-2 flex justify-center' : ''}>
                                    <Polaroid
                                        onClick={() => setSection(entry.key)}
                                        caption={entry.title}
                                        date={entry.date}
                                        rotate={entry.rotate}
                                        ratio={0.86}
                                        develop
                                        className={idx === entries.length - 1 ? 'w-[48%] min-w-[132px]' : 'w-full'}
                                        style={{ maxWidth: 178 }}
                                        fallback={<PolaroidBackdrop icon={entry.icon} tone={entry.tone} label={entry.en} />}
                                    />
                                </div>
                            ))}
                        </div>
                    </div>

                    <InsCard className="p-4 mb-2" accent="pink">
                        <SectionLabel en="TODAY" accent="pink" className="mb-3">今天的时间签</SectionLabel>
                        <div className="grid grid-cols-3 gap-2">
                            <div className="rounded-[16px] px-3 py-3" style={{ background: a.soft }}>
                                <div className="text-[8px] tracking-[0.24em] uppercase" style={{ fontFamily: 'var(--font-label)', color: a.solid }}>date</div>
                                <div className="mt-1 text-[15px] font-black" style={{ color: a.ink }}>{now.getMonth() + 1}/{today}</div>
                            </div>
                            <div className="rounded-[16px] px-3 py-3" style={{ background: '#f3f7f6' }}>
                                <div className="text-[8px] tracking-[0.24em] uppercase" style={{ fontFamily: 'var(--font-label)', color: '#7fa8b3' }}>week</div>
                                <div className="mt-1 text-[15px] font-black" style={{ color: '#577782' }}>周{WEEK_CN[now.getDay()]}</div>
                            </div>
                            <div className="rounded-[16px] px-3 py-3" style={{ background: '#fff7ed' }}>
                                <div className="text-[8px] tracking-[0.24em] uppercase" style={{ fontFamily: 'var(--font-label)', color: '#f29f6b' }}>roll</div>
                                <div className="mt-1 text-[15px] font-black" style={{ color: '#9a5a24' }}>{entries.length}格</div>
                            </div>
                        </div>
                        <InsButton
                            variant="soft"
                            accent="pink"
                            className="w-full mt-4 py-3 text-[13px]"
                            onClick={() => setSection('calendar')}
                            icon={<ClockClockwise size={16} weight="bold" />}
                        >
                            翻到共享月历
                            <CaretRight size={14} weight="bold" />
                        </InsButton>
                    </InsCard>
                </section>
            </InsScroll>
        </InsShell>
    );
};

export default AlmanacApp;
