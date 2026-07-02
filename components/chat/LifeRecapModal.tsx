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

const LIFE_KIND_LABELS: Record<string, string> = {
    routine: '日常',
    work: '工作',
    study: '学习',
    social: '社交',
    errand: '琐事',
    rest: '休息',
    media: '刷到',
    food: '吃喝',
    travel: '路上',
    health: '身体',
    emotion: '情绪',
    relationship: '关系',
    accident: '小意外',
    other: '生活',
};

const ENERGY_LABELS: Record<string, string> = { low: '低能量', medium: '普通能量', high: '高能量' };
const ANGLE_LABELS: Record<string, string> = {
    share: '想分享',
    vent: '想吐槽',
    ask: '想问你',
    tease: '想逗你',
    care: '想关心',
    invite: '想邀你',
    followup: '接旧话',
    silence: '不想说',
    other: '顺手说',
};

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
            sub={`${char.name} 的离线生活记录`}
            tape="blush" pattern="dot" paper="plain"
            onClose={onClose}
            tall
            footer={<SealBtn kind="rose" onClick={onClose}>关闭</SealBtn>}
        >
            {loading ? (
                <div className="py-10 text-center text-[11px]" style={{ ...CUTE_STACK, color: PAPER_TONES.inkSoft }}>加载中…</div>
            ) : events.length === 0 ? (
                <div className="py-8 px-3 text-center">
                    <div className="mx-auto mb-3 w-10 h-10 rounded-full flex items-center justify-center text-[18px]" style={{ color: '#d8a5b7', border: '1px solid #eed6df', background: '#fffdfa' }} aria-hidden>♡</div>
                    <p className="text-[11.5px] leading-relaxed" style={{ ...CUTE_STACK, color: PAPER_TONES.inkSoft }}>
                        还没有 {char.name} 的日常记录。<br />
                        在「聊天设置」里启用<b>「离线生活取材」</b>后，<br />
                        TA 离线时的日常会整理在这里。
                    </p>
                </div>
            ) : (
                <div className="space-y-4 pb-1">
                    {groups.map(group => (
                        <div key={group.day}>
                            {/* 日期标签 */}
                            <div className="flex items-center gap-2 mb-2">
                                <span className="text-[10px] font-bold tracking-[0.15em] px-2 py-0.5 rounded-full"
                                    style={{ ...MONO_STACK, color: '#5a3140', background: '#fff4f7', border: '1px solid #eed6df' }}>{group.day}</span>
                                <span className="flex-1 h-px" style={{ background: 'rgba(122,90,114,0.12)' }} />
                            </div>
                            {/* 时间线 */}
                            <div className="pl-1 space-y-2.5">
                                {group.items.map(ev => (
                                    <div key={ev.id} className="flex items-start gap-2.5">
                                        {/* 时间轴节点 + 竖线 */}
                                        <div className="flex flex-col items-center pt-1 shrink-0" style={{ width: 38 }}>
                                            <span className="text-[9px]" style={{ ...MONO_STACK, color: PAPER_TONES.inkFaint }}>{timeLabel(ev.timestamp)}</span>
                                            <span className="w-1.5 h-1.5 rounded-full mt-1" style={{ background: '#d8a5b7' }} />
                                        </div>
                                        {/* 内容卡 */}
                                        <div className="flex-1 min-w-0 rounded-[9px] px-3 py-2"
                                            style={{ background: '#fffdfa', border: '1px solid #eed6df' }}>
                                            <p className="text-[12px] leading-relaxed whitespace-pre-wrap break-words" style={{ ...CUTE_STACK, color: PAPER_TONES.ink, overflowWrap: 'anywhere' }}>{sanitizeLifeText(ev.activity) || ev.activity}</p>
                                            <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                                {ev.eventKind && (
                                                    <span className="text-[9.5px] px-1.5 py-0.5 rounded-full" style={{ color: '#5a3140', background: '#fff4f7', border: '1px solid #eed6df' }}>{LIFE_KIND_LABELS[ev.eventKind] || '生活'}</span>
                                                )}
                                                {ev.energy && (
                                                    <span className="text-[9.5px] px-1.5 py-0.5 rounded-full" style={{ color: '#5a3140', background: '#f7f2e9', border: '1px solid #eed6df' }}>{ENERGY_LABELS[ev.energy] || ev.energy}</span>
                                                )}
                                                {ev.proactiveAngle && (
                                                    <span className="text-[9.5px] px-1.5 py-0.5 rounded-full" style={{ color: '#5a3140', background: '#fffdfa', border: '1px solid #eed6df' }}>{ANGLE_LABELS[ev.proactiveAngle] || '顺手说'}</span>
                                                )}
                                                {ev.mood && (
                                                    <span className="text-[9.5px] px-1.5 py-0.5 rounded-full" style={{ color: '#5a3140', background: '#fff4f7', border: '1px solid #eed6df' }}>{ev.mood}</span>
                                                )}
                                                {ev.location && (
                                                    <span className="text-[9.5px] break-words min-w-0" style={{ color: PAPER_TONES.inkFaint, overflowWrap: 'anywhere' }}>位置：{ev.location}</span>
                                                )}
                                                {ev.surfacedAsMsg && (
                                                    <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ ...MONO_STACK, color: '#a892a3', background: '#fff4f7', border: '1px solid #eed6df' }}>已跟你说过{ev.surfacedAt ? ` ${timeLabel(ev.surfacedAt)}` : ''}</span>
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
