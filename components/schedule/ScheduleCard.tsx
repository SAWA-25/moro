
import React, { useState, useRef } from 'react';
import { DailySchedule, ScheduleSlot, CharacterProfile } from '../../types';
import type { ScheduleLifeNotesBySlot } from '../../utils/scheduleLifeSync';

interface ScheduleCardProps {
    schedule: DailySchedule | null;
    character: CharacterProfile | null;
    contentColor?: string; // 兼容旧调用方；ins 浅色卡自带墨色文字，不再依赖此项
    compact?: boolean; // widget mode (no editing)
    onEdit?: (index: number, slot: ScheduleSlot) => void;
    onDelete?: (index: number) => void;
    onReroll?: () => void;
    onCoverImageChange?: (dataUrl: string) => void;
    isGenerating?: boolean;
    lifeNotes?: ScheduleLifeNotesBySlot;
}

const getCurrentSlotIndex = (slots: ScheduleSlot[]): number => {
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    for (let i = slots.length - 1; i >= 0; i--) {
        const [h, m] = slots[i].startTime.split(':').map(Number);
        if (currentMinutes >= h * 60 + m) return i;
    }
    return -1;
};

const formatDate = (): string => {
    const now = new Date();
    const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    return `${months[now.getMonth()]} ${now.getDate()} · ${days[now.getDay()]}`;
};

const formatNoteTime = (timestamp: number): string => {
    const d = new Date(timestamp);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/* ══════════ ins 杂志风调色 ══════════
   白底 + 发丝线 + 大圆角 + 极柔投影；强调色由角色 themeColor 派生成柔和的彩色，
   头像走「故事环」（角色色渐变描边 + 白缝 + 彩色头像）。 */
const INK = '#26242b';
const INK_SOFT = '#8b8794';
const INK_FAINT = '#bdb9c6';
const HAIRLINE = '#ededed';
const CARD_BG = '#ffffff';

const palette = (character: CharacterProfile | null) => {
    const hue = character?.themeColor ?? 258;
    return {
        hue,
        accent: `hsl(${hue} 66% 56%)`,
        accentDeep: `hsl(${hue} 58% 44%)`,
        accentTint: `hsl(${hue} 72% 96.5%)`,
        accentBorder: `hsl(${hue} 52% 90%)`,
        ring: `linear-gradient(135deg, hsl(${hue} 88% 66%), hsl(${(hue + 46) % 360} 86% 68%))`,
    };
};

/* 故事环头像（彩色）：渐变描边 + 白缝 + 彩色头像。无图时落角色名首字。 */
const StoryAvatar: React.FC<{
    character: CharacterProfile | null;
    size?: number;
    ring: string;
    accent: string;
}> = ({ character, size = 46, ring, accent }) => {
    const avatar = character?.avatar;
    const isImg = !!avatar && (avatar.startsWith('http') || avatar.startsWith('data:'));
    const inner = size - 6;
    return (
        <div
            className="shrink-0 rounded-full"
            style={{ width: size, height: size, padding: 2.5, background: ring }}
        >
            <div
                className="w-full h-full rounded-full overflow-hidden flex items-center justify-center"
                style={{ border: '2px solid #fff', background: '#fff' }}
            >
                {isImg ? (
                    <img src={avatar} alt="" className="w-full h-full object-cover" style={{ width: inner, height: inner }} />
                ) : (
                    <span
                        className="font-bold"
                        style={{ color: accent, fontSize: Math.round(inner * 0.42) }}
                    >
                        {(character?.name || '·').slice(0, 1)}
                    </span>
                )}
            </div>
        </div>
    );
};

const ScheduleCard: React.FC<ScheduleCardProps> = ({
    schedule,
    character,
    compact = false,
    onEdit,
    onDelete,
    onReroll,
    onCoverImageChange,
    isGenerating = false,
    lifeNotes = {},
}) => {
    const [editingIdx, setEditingIdx] = useState<number | null>(null);
    const [editTime, setEditTime] = useState('');
    const [editActivity, setEditActivity] = useState('');
    const [editDesc, setEditDesc] = useState('');
    const [editEmoji, setEditEmoji] = useState('');
    const coverInputRef = useRef<HTMLInputElement>(null);

    // 长按菜单状态：记录哪一条日程被长按触发 action sheet（修改 / 删除）
    const [actionIdx, setActionIdx] = useState<number | null>(null);
    const longPressTimerRef = useRef<number | null>(null);
    const longPressTriggeredRef = useRef(false);
    const LONG_PRESS_MS = 500;

    const startLongPress = (idx: number) => {
        longPressTriggeredRef.current = false;
        if (longPressTimerRef.current) window.clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = window.setTimeout(() => {
            longPressTriggeredRef.current = true;
            setActionIdx(idx);
        }, LONG_PRESS_MS);
    };

    const cancelLongPress = () => {
        if (longPressTimerRef.current) {
            window.clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
        }
    };

    const currentIdx = schedule ? getCurrentSlotIndex(schedule.slots) : -1;
    const charName = character?.name || '角色';
    const coverImage = schedule?.coverImage;
    const pal = palette(character);

    const startEdit = (idx: number, slot: ScheduleSlot) => {
        setEditingIdx(idx);
        setEditTime(slot.startTime);
        setEditActivity(slot.activity);
        setEditDesc(slot.description || '');
        setEditEmoji(slot.emoji || '');
    };

    const saveEdit = () => {
        if (editingIdx !== null && onEdit) {
            onEdit(editingIdx, {
                startTime: editTime,
                activity: editActivity,
                description: editDesc || undefined,
                emoji: editEmoji || undefined,
            });
        }
        setEditingIdx(null);
    };

    const handleCoverUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !onCoverImageChange) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const img = new window.Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const maxW = 400;
                const scale = Math.min(1, maxW / img.width);
                canvas.width = img.width * scale;
                canvas.height = img.height * scale;
                canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
                onCoverImageChange(canvas.toDataURL('image/jpeg', 0.8));
            };
            img.src = ev.target?.result as string;
        };
        reader.readAsDataURL(file);
        e.target.value = '';
    };

    return (
        <div
            className="relative rounded-[24px] overflow-hidden"
            style={{
                background: CARD_BG,
                border: `1px solid ${HAIRLINE}`,
                boxShadow: '0 1px 2px rgba(38,38,38,0.04), 0 18px 38px -28px rgba(38,38,38,0.30)',
                color: INK,
            }}
        >
            {/* 可选封面：ins 个人页式头图，渐变收口后落入白底 */}
            {coverImage && (
                <div className="relative w-full h-24 overflow-hidden">
                    <img src={coverImage} alt="" className="absolute inset-0 w-full h-full object-cover" style={{ objectPosition: 'center 32%' }} />
                    <div className="absolute inset-0" style={{ background: `linear-gradient(to bottom, rgba(255,255,255,0) 35%, ${CARD_BG} 98%)` }} />
                    {!compact && onCoverImageChange && (
                        <button
                            onClick={() => coverInputRef.current?.click()}
                            className="absolute top-2.5 right-2.5 w-7 h-7 rounded-full flex items-center justify-center text-[11px] transition-transform active:scale-90"
                            style={{ background: 'rgba(255,255,255,0.9)', color: INK_SOFT, boxShadow: '0 2px 8px rgba(38,38,38,0.12)' }}
                            title="更换看板图"
                        >
                            ✎
                        </button>
                    )}
                </div>
            )}

            {/* ins 头部：故事环头像 + 名字 + 副标题 + 日期/重排 */}
            <div className={`relative flex items-center gap-3 px-4 ${coverImage ? 'pt-1' : 'pt-4'} pb-3`}>
                <StoryAvatar character={character} size={compact ? 42 : 48} ring={pal.ring} accent={pal.accent} />
                <div className="flex-1 min-w-0">
                    <div className="text-[15px] font-bold leading-tight truncate" style={{ color: INK }}>{charName}</div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[10px] font-bold tracking-[0.16em] uppercase" style={{ color: pal.accent }}>Daily</span>
                        <span className="w-1 h-1 rounded-full" style={{ background: INK_FAINT }} />
                        <span className="text-[10.5px]" style={{ color: INK_SOFT }}>今日作息</span>
                    </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className="text-[9.5px] font-bold tracking-wider px-2 py-0.5 rounded-full" style={{ background: '#f6f6f6', color: INK_SOFT }}>
                        {formatDate()}
                    </span>
                    {!compact && onReroll && (
                        <button
                            onClick={onReroll}
                            disabled={isGenerating}
                            className="text-[9.5px] font-bold px-2 py-0.5 rounded-full transition-all active:scale-95 disabled:opacity-40"
                            style={{ background: pal.accentTint, color: pal.accentDeep, border: `1px solid ${pal.accentBorder}` }}
                        >
                            {isGenerating ? '生成中…' : '↻ 重排'}
                        </button>
                    )}
                    {!compact && onCoverImageChange && !coverImage && (
                        <button
                            onClick={() => coverInputRef.current?.click()}
                            className="text-[9.5px] px-2 py-0.5 rounded-full transition-all active:scale-95"
                            style={{ background: '#f6f6f6', color: INK_SOFT }}
                            title="添加看板图"
                        >
                            ＋图
                        </button>
                    )}
                </div>
                <input ref={coverInputRef} type="file" accept="image/*" className="hidden" onChange={handleCoverUpload} />
            </div>

            {/* 发丝分隔线 */}
            <div className="mx-4" style={{ height: 1, background: HAIRLINE }} />

            {/* 作息列表（时间线 feed） */}
            <div className="px-3.5 pb-4 pt-2 space-y-1 min-w-0">
                {isGenerating && !schedule ? (
                    <div className="py-12 text-center">
                        <div className="inline-block w-6 h-6 border-2 rounded-full animate-spin mb-3" style={{ borderColor: pal.accentBorder, borderTopColor: pal.accent }}></div>
                        <p className="text-xs" style={{ color: INK_FAINT }}>正在排今天的作息…</p>
                    </div>
                ) : schedule && schedule.slots.length > 0 ? (
                    schedule.slots.map((slot, idx) => {
                        const isCurrent = idx === currentIdx;
                        const isPast = currentIdx >= 0 && idx < currentIdx;
                        const isEditing = editingIdx === idx;
                        const slotLifeNotes = lifeNotes[slot.startTime] || [];

                        if (isEditing && !compact) {
                            return (
                                <div key={idx} className="p-3 rounded-2xl" style={{ background: pal.accentTint, border: `1px solid ${pal.accentBorder}` }}>
                                    <div className="flex gap-2 mb-2">
                                        <input
                                            type="time"
                                            value={editTime}
                                            onChange={e => setEditTime(e.target.value)}
                                            className="rounded-lg px-2 py-1 text-xs font-mono w-24 focus:outline-none"
                                            style={{ background: '#fff', border: `1px solid ${HAIRLINE}`, color: INK }}
                                        />
                                        <input
                                            value={editEmoji}
                                            onChange={e => setEditEmoji(e.target.value)}
                                            placeholder="emoji"
                                            className="rounded-lg px-2 py-1 text-xs w-14 focus:outline-none text-center"
                                            style={{ background: '#fff', border: `1px solid ${HAIRLINE}`, color: INK }}
                                        />
                                    </div>
                                    <input
                                        value={editActivity}
                                        onChange={e => setEditActivity(e.target.value)}
                                        placeholder="活动"
                                        className="w-full rounded-lg px-2 py-1 text-sm font-bold mb-1 focus:outline-none"
                                        style={{ background: '#fff', border: `1px solid ${HAIRLINE}`, color: INK }}
                                    />
                                    <input
                                        value={editDesc}
                                        onChange={e => setEditDesc(e.target.value)}
                                        placeholder="描述 (可选)"
                                        className="w-full rounded-lg px-2 py-1 text-xs focus:outline-none"
                                        style={{ background: '#fff', border: `1px solid ${HAIRLINE}`, color: INK_SOFT }}
                                    />
                                    <div className="flex gap-2 mt-2">
                                        <button onClick={saveEdit} className="text-[10px] font-bold px-3 py-1 rounded-lg text-white transition-transform active:scale-95" style={{ background: pal.accent }}>保存</button>
                                        <button onClick={() => setEditingIdx(null)} className="text-[10px] font-bold px-3 py-1 rounded-lg transition-transform active:scale-95" style={{ background: '#f0f0f0', color: INK_SOFT }}>取消</button>
                                    </div>
                                </div>
                            );
                        }

                        const editable = !compact && !!onEdit;
                        const pressHandlers = editable ? {
                            onPointerDown: (e: React.PointerEvent) => {
                                if (e.button !== undefined && e.button !== 0) return;
                                startLongPress(idx);
                            },
                            onPointerUp: () => cancelLongPress(),
                            onPointerLeave: () => cancelLongPress(),
                            onPointerCancel: () => cancelLongPress(),
                            onClick: () => {
                                if (longPressTriggeredRef.current) {
                                    longPressTriggeredRef.current = false;
                                    return;
                                }
                                startEdit(idx, slot);
                            },
                            onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
                        } : {};
                        return (
                            <div
                                key={idx}
                                className={`relative flex items-start gap-2.5 py-2 px-2.5 rounded-2xl transition-all ${editable ? 'cursor-pointer select-none' : ''}`}
                                style={isCurrent
                                    ? { background: pal.accentTint, border: `1px solid ${pal.accentBorder}` }
                                    : { border: '1px solid transparent' }}
                                {...pressHandlers}
                            >
                                {/* Time */}
                                <div className="flex flex-col items-center w-11 flex-shrink-0 pt-0.5">
                                    <span className="text-xs font-mono font-bold tabular-nums" style={{ color: isPast ? INK_FAINT : isCurrent ? pal.accentDeep : INK }}>
                                        {slot.startTime}
                                    </span>
                                    {slot.endTime && (
                                        <span className="text-[8px] font-mono leading-none mt-0.5" style={{ color: INK_FAINT }}>
                                            ~{slot.endTime}
                                        </span>
                                    )}
                                </div>

                                {/* Timeline dot + line */}
                                <div className="flex flex-col items-center pt-1.5 flex-shrink-0 self-stretch">
                                    <div
                                        className="w-2.5 h-2.5 rounded-full"
                                        style={{
                                            border: `2px solid ${isCurrent ? pal.accent : isPast ? INK_FAINT : '#d8d6dd'}`,
                                            background: isCurrent ? pal.accent : (isPast ? INK_FAINT : '#fff'),
                                            boxShadow: isCurrent ? `0 0 0 3px ${pal.accentTint}` : 'none',
                                        }}
                                    />
                                    {idx < schedule.slots.length - 1 && (
                                        <div className="w-px flex-1 min-h-[18px] mt-1" style={{ background: HAIRLINE }}></div>
                                    )}
                                </div>

                                {/* Content */}
                                <div className={`flex-1 min-w-0 ${isPast ? 'opacity-45' : ''}`}>
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                        {slot.emoji && <span className="text-sm flex-shrink-0">{slot.emoji}</span>}
                                        <span className="text-[13.5px] font-bold" style={{ color: INK }}>{slot.activity}</span>
                                        {isCurrent && (
                                            <span className="text-[8px] font-bold tracking-wider px-1.5 py-0.5 rounded-full text-white animate-pulse" style={{ background: pal.accent }}>
                                                NOW
                                            </span>
                                        )}
                                    </div>
                                    {slot.description && (
                                        <p className="text-[11px] mt-0.5 leading-snug" style={{ color: INK_SOFT }}>{slot.description}</p>
                                    )}
                                    {/* 节点元信息：地点 / 情绪 / 精力 */}
                                    {(slot.location || slot.mood || typeof slot.energy === 'number') && (
                                        <div className="flex flex-wrap items-center gap-1 mt-1">
                                            {slot.location && (
                                                <span className="inline-flex items-center text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: '#f4f4f5', color: INK_SOFT }}>📍 {slot.location}</span>
                                            )}
                                            {slot.mood && (
                                                <span className="inline-flex items-center text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: '#f4f4f5', color: INK_SOFT }}>{slot.mood}</span>
                                            )}
                                            {typeof slot.energy === 'number' && slot.energy > 0 && (
                                                <span className="text-[9px] font-mono tracking-tighter" style={{ color: pal.accent }} title={`精力 ${slot.energy}/5`}>
                                                    {'●'.repeat(Math.min(5, slot.energy))}{'○'.repeat(Math.max(0, 5 - slot.energy))}
                                                </span>
                                            )}
                                        </div>
                                    )}
                                    {/* 当前时段：露出一句此刻的心里话 */}
                                    {isCurrent && slot.innerThought && (
                                        <p className="text-[10.5px] italic mt-1 leading-snug" style={{ color: pal.accentDeep }}>「{slot.innerThought}」</p>
                                    )}
                                    {slotLifeNotes.length > 0 && (
                                        <div className="mt-2 space-y-1">
                                            <div className="text-[9px] font-bold tracking-[0.16em] uppercase" style={{ color: pal.accent }}>
                                                线下近况
                                            </div>
                                            {slotLifeNotes.map(note => {
                                                const noteText = note.summary || note.activity;
                                                const meta = [
                                                    formatNoteTime(note.timestamp),
                                                    note.location ? `在${note.location}` : '',
                                                    note.mood || '',
                                                    note.surfacedAsMsg ? '已说过' : '',
                                                ].filter(Boolean).join(' · ');
                                                return (
                                                    <div
                                                        key={note.id}
                                                        className="rounded-xl px-2.5 py-1.5"
                                                        style={{ background: '#faf8fb', border: `1px solid ${pal.accentBorder}` }}
                                                    >
                                                        <div className="text-[10.5px] leading-snug break-words" style={{ color: INK }}>
                                                            {noteText}
                                                        </div>
                                                        {meta && (
                                                            <div className="mt-0.5 text-[9px] leading-tight" style={{ color: INK_SOFT }}>
                                                                {meta}
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })
                ) : (
                    <div className="py-12 text-center">
                        <p className="text-xs" style={{ color: INK_FAINT }}>今天还没排作息</p>
                        {onReroll && (
                            <button onClick={onReroll} className="mt-2 text-xs font-bold px-3 py-1.5 rounded-full transition-transform active:scale-95" style={{ background: pal.accentTint, color: pal.accentDeep, border: `1px solid ${pal.accentBorder}` }}>
                                生成今日作息
                            </button>
                        )}
                    </div>
                )}

                {/* OFFLINE footer */}
                {schedule && schedule.slots.length > 0 && (
                    <div className="flex items-center gap-2 pt-2 pl-2.5">
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: INK_FAINT }} />
                        <span className="text-[10px] font-bold tracking-widest" style={{ color: INK_FAINT }}>OFFLINE · 就寝</span>
                    </div>
                )}
            </div>

            {/* 长按菜单：修改 / 删除 */}
            {actionIdx !== null && schedule && schedule.slots[actionIdx] && (
                <div
                    className="absolute inset-0 z-30 flex items-end sm:items-center justify-center bg-black/30 backdrop-blur-sm"
                    onClick={() => setActionIdx(null)}
                >
                    <div
                        className="w-full sm:w-64 bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden"
                        style={{ border: `1px solid ${HAIRLINE}` }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="px-4 py-3" style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
                            <p className="text-xs" style={{ color: INK_FAINT }}>作息项</p>
                            <p className="text-sm font-bold truncate" style={{ color: INK }}>
                                {schedule.slots[actionIdx].startTime} · {schedule.slots[actionIdx].activity}
                            </p>
                        </div>
                        <button
                            className="w-full py-3 text-sm font-bold transition-colors hover:bg-slate-50"
                            style={{ color: INK }}
                            onClick={() => {
                                const i = actionIdx;
                                setActionIdx(null);
                                if (i !== null && schedule) startEdit(i, schedule.slots[i]);
                            }}
                        >
                            修改
                        </button>
                        <button
                            className="w-full py-3 text-sm font-bold text-red-500 hover:bg-red-50 transition-colors"
                            style={{ borderTop: `1px solid ${HAIRLINE}` }}
                            onClick={() => {
                                const i = actionIdx;
                                setActionIdx(null);
                                if (i !== null && onDelete) onDelete(i);
                            }}
                        >
                            删除
                        </button>
                        <button
                            className="w-full py-3 text-sm transition-colors hover:bg-slate-50"
                            style={{ color: INK_FAINT, borderTop: `1px solid ${HAIRLINE}` }}
                            onClick={() => setActionIdx(null)}
                        >
                            取消
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ScheduleCard;
