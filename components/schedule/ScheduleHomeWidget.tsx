import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CharacterProfile, DailySchedule, ScheduleSlot } from '../../types';
import ScheduleCard from './ScheduleCard';

const getCurrentSlotIndex = (slots: ScheduleSlot[]): number => {
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    for (let i = slots.length - 1; i >= 0; i--) {
        const [h, m] = slots[i].startTime.split(':').map(Number);
        if (currentMinutes >= h * 60 + m) return i;
    }
    return -1;
};

/* ══════════ ins 杂志风调色（与 ScheduleCard 同一套语言）══════════
   白底 + 发丝线 + 大圆角 + 极柔投影；强调色由角色 themeColor 派生；头像走彩色故事环。 */
const INK = '#26242b';
const INK_SOFT = '#8b8794';
const INK_FAINT = '#bdb9c6';
const HAIRLINE = '#ececec';

const palette = (character: CharacterProfile | null) => {
    const hue = character?.themeColor ?? 258;
    return {
        hue,
        accent: `hsl(${hue} 66% 56%)`,
        accentDeep: `hsl(${hue} 58% 44%)`,
        accentTint: `hsl(${hue} 72% 96%)`,
        accentBorder: `hsl(${hue} 52% 90%)`,
        ring: `linear-gradient(135deg, hsl(${hue} 88% 66%), hsl(${(hue + 46) % 360} 86% 68%))`,
    };
};

/* 彩色故事环头像 */
const StoryAvatar: React.FC<{
    character: CharacterProfile | null;
    size?: number;
    ring: string;
    accent: string;
}> = ({ character, size = 48, ring, accent }) => {
    const avatar = character?.avatar;
    const isImg = !!avatar && (/^https?:\/\//i.test(avatar) || avatar.startsWith('data:') || avatar.startsWith('blob:') || avatar.startsWith('/'));
    return (
        <div className="shrink-0 rounded-full" style={{ width: size, height: size, padding: 2.5, background: ring }}>
            <div className="w-full h-full rounded-full overflow-hidden flex items-center justify-center" style={{ border: '2px solid #fff', background: '#fff' }}>
                {isImg ? (
                    <img src={avatar} alt="" loading="lazy" className="w-full h-full object-cover" style={{ objectPosition: 'center 28%' }} />
                ) : (
                    <span className="font-bold" style={{ color: accent, fontSize: Math.round(size * 0.36) }}>
                        {(character?.name || '·').slice(0, 1)}
                    </span>
                )}
            </div>
        </div>
    );
};

const OpenChevron: React.FC<{ color?: string }> = ({ color = INK_SOFT }) => (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth={2.2} stroke="currentColor" className="w-3.5 h-3.5" style={{ color }}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 7.5V5a2 2 0 0 1 2-2h2.5M21 7.5V5a2 2 0 0 0-2-2h-2.5M3 16.5V19a2 2 0 0 0 2 2h2.5M21 16.5V19a2 2 0 0 1-2 2h-2.5" />
    </svg>
);

interface ScheduleSquareWidgetProps {
    schedule: DailySchedule | null;
    character: CharacterProfile | null;
    contentColor?: string; // 兼容旧调用方
    onOpen: () => void;
}

export const ScheduleSquareWidget: React.FC<ScheduleSquareWidgetProps> = ({
    schedule,
    character,
    onOpen,
}) => {
    const currentIdx = schedule ? getCurrentSlotIndex(schedule.slots) : -1;
    const currentSlot = currentIdx >= 0 ? schedule!.slots[currentIdx] : null;
    const nextSlot = schedule && currentIdx < schedule.slots.length - 1
        ? schedule.slots[currentIdx + 1]
        : null;
    const pal = palette(character);

    const now = new Date();
    const timeLabel = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    return (
        <button
            onClick={onOpen}
            className="relative w-full h-full rounded-[1.75rem] overflow-hidden cursor-pointer transition-transform duration-200 active:scale-[0.98] animate-fade-in text-left"
            style={{
                background: 'rgba(255,255,255,0.95)',
                backdropFilter: 'blur(20px) saturate(1.4)',
                WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
                border: `1px solid ${HAIRLINE}`,
                boxShadow: '0 1px 2px rgba(38,38,38,0.04), 0 16px 32px -26px rgba(38,38,38,0.34)',
                color: INK,
            }}
        >
            <div className="absolute inset-y-0 right-0 w-[34%] pointer-events-none opacity-55"
                style={{
                    background: `linear-gradient(155deg, ${pal.accent}22, transparent 72%)`,
                    clipPath: 'polygon(36% 0, 100% 0, 100% 100%, 0 100%)',
                }}
            />

            {/* Top row: Now badge + time */}
            <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-3 pt-3 z-10">
                <span className="text-[8.5px] font-bold tracking-[0.2em] uppercase px-1.5 py-0.5 rounded-full"
                    style={{
                        background: currentSlot ? pal.accentTint : '#f4f4f5',
                        color: currentSlot ? pal.accentDeep : INK_SOFT,
                        border: `1px solid ${currentSlot ? pal.accentBorder : HAIRLINE}`,
                    }}>
                    {currentSlot ? 'Now' : 'Idle'}
                </span>
                <span className="text-[10px] font-mono tracking-wider" style={{ color: INK_SOFT }}>
                    {currentSlot ? currentSlot.startTime : timeLabel}
                </span>
            </div>

            {/* Center avatar */}
            <div className="absolute top-[34%] left-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
                <StoryAvatar character={character} size={52} ring={pal.ring} accent={pal.accent} />
            </div>

            {/* Bottom content */}
            <div className="absolute bottom-0 left-0 right-0 p-3 z-10">
                <div className="flex items-center gap-1.5 mb-0.5">
                    {currentSlot?.emoji && <span className="text-base shrink-0">{currentSlot.emoji}</span>}
                    <span className="text-[13px] font-bold truncate leading-tight" style={{ color: INK }}>
                        {currentSlot?.activity || (schedule ? '休息中' : '未生成')}
                    </span>
                </div>
                {nextSlot ? (
                    <div className="text-[9.5px] truncate leading-tight" style={{ color: INK_SOFT }}>
                        <span className="font-mono mr-1" style={{ color: pal.accent }}>→ {nextSlot.startTime}</span>
                        {nextSlot.activity}
                    </div>
                ) : (
                    <div className="text-[9.5px] truncate tracking-widest uppercase" style={{ color: INK_FAINT }}>
                        {character?.name || '—'}
                    </div>
                )}
            </div>
        </button>
    );
};

interface ScheduleHomeWidgetProps {
    schedule: DailySchedule | null;
    character: CharacterProfile | null;
    contentColor?: string; // 兼容旧调用方
    onOpen: () => void;
}

export const ScheduleHomeWidget: React.FC<ScheduleHomeWidgetProps> = ({
    schedule,
    character,
    onOpen,
}) => {
    const widgetRef = useRef<HTMLButtonElement | null>(null);
    const [isCompact, setIsCompact] = useState(false);
    const currentIdx = schedule ? getCurrentSlotIndex(schedule.slots) : -1;
    const currentSlot = currentIdx >= 0 ? schedule!.slots[currentIdx] : null;
    const nextSlot = schedule && currentIdx < schedule.slots.length - 1
        ? schedule.slots[currentIdx + 1]
        : null;
    const pal = palette(character);

    const now = new Date();
    const timeLabel = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    const timelineSlots = schedule?.slots ?? [];
    const nextLabel = nextSlot ? `${nextSlot.startTime} ${nextSlot.emoji ? `${nextSlot.emoji} ` : ''}${nextSlot.activity}` : '';
    const noteText = currentSlot?.description || (nextLabel ? `Next · ${nextLabel}` : 'Tap for details');

    useEffect(() => {
        const el = widgetRef.current;
        if (!el || typeof ResizeObserver === 'undefined') return;

        const measure = () => {
            const { width, height } = el.getBoundingClientRect();
            setIsCompact(height < 190 || width < 420);
        };

        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    return (
        <button
            ref={widgetRef}
            onClick={onOpen}
            className={`moro-routine-widget w-full h-full group text-left overflow-hidden press-soft relative${isCompact ? ' moro-routine-widget--compact' : ''}`}
            style={{ color: INK }}
        >
            <span className="moro-routine-glow" style={{ background: pal.accent }} />

            <div className="moro-routine-shell">
                <div className="moro-routine-header">
                    <div className="moro-routine-title">
                        <div className="moro-routine-kicker">routine</div>
                        <div className="moro-routine-date truncate">{character?.name ? `${character.name} rhythm` : 'daily rhythm'}</div>
                    </div>
                    <div className="moro-routine-open">
                        <OpenChevron color={INK_SOFT} />
                    </div>
                </div>

                <div className="moro-routine-body">
                    <div className="moro-routine-timecard shrink-0">
                        <span>{currentSlot ? currentSlot.startTime : timeLabel}</span>
                        <i>{currentSlot ? 'now' : 'idle'}</i>
                    </div>
                    <div className="moro-routine-avatar shrink-0" aria-hidden="true">
                        <StoryAvatar character={character} size={isCompact ? 46 : 54} ring={pal.ring} accent={pal.accent} />
                    </div>
                    <div className="moro-routine-copy">
                        <div className="moro-routine-activity truncate">
                            {currentSlot?.emoji && <span className="mr-1.5">{currentSlot.emoji}</span>}
                            {currentSlot?.activity || (schedule ? '休息中' : '尚未生成作息')}
                        </div>
                        <div className="moro-routine-note" title={noteText}>
                            {noteText}
                        </div>
                    </div>
                </div>

                {timelineSlots.length > 0 && (
                    <div className="moro-routine-timeline">
                        {timelineSlots.slice(0, 7).map((slot, i) => {
                            const isCurrent = i === currentIdx;
                            const isPast = currentIdx >= 0 && i < currentIdx;
                            return (
                                <div key={i} className="moro-routine-tick">
                                    <span
                                        style={{
                                            background: isCurrent ? pal.accent : isPast ? '#aaa79f' : '#dedbd0',
                                            boxShadow: isCurrent ? `0 0 0 3px ${pal.accent}20` : 'none',
                                        }}
                                    />
                                    <i style={{ color: isCurrent ? pal.accentDeep : INK_FAINT }}>{slot.startTime.slice(0, 5)}</i>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </button>
    );
};

interface ScheduleFullscreenViewerProps {
    open: boolean;
    onClose: () => void;
    characters: CharacterProfile[];
    activeCharId: string | null;
    onSwitchCharacter: (id: string) => void;
    schedule: DailySchedule | null;
    activeCharacter: CharacterProfile | null;
    contentColor?: string; // 兼容旧调用方
}

export const ScheduleFullscreenViewer: React.FC<ScheduleFullscreenViewerProps> = ({
    open,
    onClose,
    characters,
    activeCharId,
    onSwitchCharacter,
    schedule,
    activeCharacter,
}) => {
    // Lock scroll of background
    useEffect(() => {
        if (!open) return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = prev; };
    }, [open]);

    // Close on ESC
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    const pal = useMemo(() => palette(activeCharacter), [activeCharacter]);

    if (!open) return null;

    return (
        <div
            className="fixed inset-0 z-[200] flex flex-col animate-fade-in"
            style={{
                background: 'rgba(250, 250, 251, 0.82)',
                backdropFilter: 'blur(26px) saturate(1.3)',
                WebkitBackdropFilter: 'blur(26px) saturate(1.3)',
                color: INK,
            }}
            onClick={onClose}
        >
            {/* Header */}
            <div
                className="flex items-center justify-between px-5 pt-[calc(env(safe-area-inset-top)+1rem)] pb-3 shrink-0"
                onClick={(e) => e.stopPropagation()}
            >
                <div>
                    <div className="text-[10px] font-bold tracking-[0.22em] uppercase" style={{ color: pal.accent }}>Today</div>
                    <div className="text-lg font-black tracking-tight" style={{ color: INK }}>
                        今日作息 · Daily
                    </div>
                </div>
                <button
                    onClick={onClose}
                    className="w-9 h-9 rounded-full flex items-center justify-center transition-transform active:scale-90"
                    style={{ background: '#fff', border: `1px solid ${HAIRLINE}`, color: INK_SOFT, boxShadow: '0 2px 10px rgba(38,38,38,0.08)' }}
                    aria-label="Close"
                >
                    <svg viewBox="0 0 24 24" fill="none" strokeWidth={2.2} stroke="currentColor" className="w-4 h-4">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
                    </svg>
                </button>
            </div>

            {/* Character switcher — 故事环头像横排 */}
            {characters.length > 0 && (
                <div
                    className="shrink-0 px-5 pb-3"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="flex gap-3 overflow-x-auto no-scrollbar py-1 -mx-1 px-1">
                        {characters.map(c => {
                            const isActive = c.id === activeCharId;
                            const cp = palette(c);
                            return (
                                <button
                                    key={c.id}
                                    onClick={() => onSwitchCharacter(c.id)}
                                    className="shrink-0 flex flex-col items-center gap-1 transition-transform active:scale-95"
                                    style={{ width: 58 }}
                                >
                                    <div style={{ opacity: isActive ? 1 : 0.5, transform: isActive ? 'scale(1.04)' : 'scale(1)', transition: 'all .2s' }}>
                                        <StoryAvatar character={c} size={52} ring={isActive ? cp.ring : 'linear-gradient(135deg,#d8d6dd,#ececec)'} accent={cp.accent} />
                                    </div>
                                    <span
                                        className="text-[10px] truncate max-w-full font-semibold tracking-wide"
                                        style={{ color: isActive ? INK : INK_FAINT }}
                                    >
                                        {c.name}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Schedule card */}
            <div
                className="flex-1 min-h-0 overflow-y-auto px-5 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] no-scrollbar"
                onClick={(e) => e.stopPropagation()}
            >
                <ScheduleCard
                    schedule={schedule}
                    character={activeCharacter}
                    compact={true}
                />
                <div className="text-[10px] text-center mt-4 tracking-widest" style={{ color: INK_FAINT }}>
                    TAP OUTSIDE TO CLOSE · 点空白处关闭
                </div>
            </div>
        </div>
    );
};
