import React, { useEffect, useState } from 'react';
import JournalSheet, { SealBtn } from './JournalSheet';
import { MONO_STACK, CUTE_STACK, PAPER_TONES } from '../handbook/paper';
import { CharacterProfile, CharLifeEvent } from '../../types';
import { DB } from '../../utils/db';
import { sanitizeLifeText } from '../../utils/autonomousLife';

interface LifeRecapModalProps {
    isOpen: boolean;
    onClose: () => void;
    char: CharacterProfile;
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function dayLabel(ts: number): string {
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return '今天';
    const yest = new Date(now);
    yest.setDate(now.getDate() - 1);
    if (d.toDateString() === yest.toDateString()) return '昨天';
    return `${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAYS[d.getDay()]}`;
}

function timeLabel(ts: number): string {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 标记某角色的回顾已看到（清掉聊天里的「TA 经历了…」横幅）。 */
export function markLifeRecapSeen(charId: string) {
    try { localStorage.setItem(`life_recap_seen_${charId}`, String(Date.now())); } catch { /* ignore */ }
}

/** 取某角色「未看过的离线事件」条数（横幅用）：lastSeen 之后产生的 catchup 事件。 */
export async function countUnseenCatchup(charId: string): Promise<number> {
    let lastSeen = 0;
    try { lastSeen = parseInt(localStorage.getItem(`life_recap_seen_${charId}`) || '0', 10) || 0; } catch { /* ignore */ }
    const all = await DB.getLifeEvents(charId);
    return all.filter(e => e.source === 'catchup' && e.timestamp > lastSeen).length;
}

const LifeRecapModal: React.FC<LifeRecapModalProps> = ({ isOpen, onClose, char }) => {
    const [events, setEvents] = useState<CharLifeEvent[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        let alive = true;
        setLoading(true);
        DB.getLifeEvents(char.id)
            .then(list => {
                if (!alive) return;
                setEvents([...list].reverse()); // 最近的排最上面
                setLoading(false);
                markLifeRecapSeen(char.id);
            })
            .catch(() => { if (alive) { setEvents([]); setLoading(false); } });
        return () => { alive = false; };
    }, [isOpen, char.id]);

    // 按天分组（events 已是新→旧）
    const groups: { day: string; items: CharLifeEvent[] }[] = [];
    for (const ev of events) {
        const day = dayLabel(ev.timestamp);
        const last = groups[groups.length - 1];
        if (last && last.day === day) last.items.push(ev);
        else groups.push({ day, items: [ev] });
    }

    return (
        <JournalSheet
            open={isOpen} title="TA 的日常" en="Daily Life"
            sub={`${char.name} 自己的生活轨迹`}
            tape="mint" pattern="dot" paper="sage"
            onClose={onClose}
            footer={<SealBtn kind="rose" onClick={onClose}>看完啦</SealBtn>}
        >
            {loading ? (
                <div className="py-10 text-center text-[11px]" style={{ ...CUTE_STACK, color: PAPER_TONES.inkSoft }}>翻看中…</div>
            ) : events.length === 0 ? (
                <div className="py-8 px-3 text-center">
                    <div className="text-[26px] mb-2" aria-hidden>🌱</div>
                    <p className="text-[11.5px] leading-relaxed" style={{ ...CUTE_STACK, color: PAPER_TONES.inkSoft }}>
                        还没有 {char.name} 的日常记录。<br />
                        在「悄悄来信」里开启<b>「让 TA 过自己的生活」</b>后，<br />
                        你不在身边时，TA 会慢慢攒下属于自己的故事。
                    </p>
                </div>
            ) : (
                <div className="space-y-4">
                    {groups.map(group => (
                        <div key={group.day}>
                            {/* 日期标签 */}
                            <div className="flex items-center gap-2 mb-2">
                                <span className="text-[10px] font-bold tracking-[0.15em] px-2 py-0.5 rounded-full"
                                    style={{ ...MONO_STACK, color: '#3f7d5c', background: 'rgba(191,225,207,0.4)' }}>{group.day}</span>
                                <span className="flex-1 h-px" style={{ background: 'rgba(122,90,114,0.12)' }} />
                            </div>
                            {/* 时间线 */}
                            <div className="pl-1 space-y-2.5">
                                {group.items.map(ev => (
                                    <div key={ev.id} className="flex gap-2.5">
                                        {/* 时间轴节点 + 竖线 */}
                                        <div className="flex flex-col items-center pt-1 shrink-0" style={{ width: 38 }}>
                                            <span className="text-[9px]" style={{ ...MONO_STACK, color: PAPER_TONES.inkFaint }}>{timeLabel(ev.timestamp)}</span>
                                            <span className="w-1.5 h-1.5 rounded-full mt-1" style={{ background: '#bfa3dd' }} />
                                        </div>
                                        {/* 内容卡 */}
                                        <div className="flex-1 min-w-0 rounded-[9px] px-3 py-2"
                                            style={{ background: 'rgba(255,255,255,0.62)', border: '1px dashed rgba(122,90,114,0.18)' }}>
                                            <p className="text-[12px] leading-relaxed" style={{ ...CUTE_STACK, color: PAPER_TONES.ink }}>{sanitizeLifeText(ev.activity) || ev.activity}</p>
                                            <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                                {ev.mood && (
                                                    <span className="text-[9.5px] px-1.5 py-0.5 rounded-full" style={{ color: '#7a3845', background: 'rgba(251,184,200,0.32)' }}>{ev.mood}</span>
                                                )}
                                                {ev.location && (
                                                    <span className="text-[9.5px]" style={{ color: PAPER_TONES.inkFaint }}>📍{ev.location}</span>
                                                )}
                                                {ev.surfacedAsMsg && (
                                                    <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ ...MONO_STACK, color: '#5a7d9a', background: 'rgba(157,193,213,0.28)' }}>已跟你说过</span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </JournalSheet>
    );
};

export default React.memo(LifeRecapModal);
