import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    Phone, PhoneOutgoing, PhoneIncoming, PhoneX, PhoneDisconnect,
    Backspace, Play, Pause, DotsNine, Waveform, Star, ClockCounterClockwise,
    Trash, CaretDown, CaretUp,
} from '@phosphor-icons/react';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { AppID, CharacterProfile, Message, PhoneCallLog } from '../types';
import ConfirmDialog from '../components/os/ConfirmDialog';

// 电话 App — 拨号键盘 / 通话记录（拨出·接听·未接）/ 通话录音与逐字稿 / 联系人收藏。
// 真实语音通话由 CallApp 承担：拨给已知角色时通过 sessionStorage 握手跳转过去。

type PhoneTab = 'contacts' | 'logs' | 'dial' | 'recordings';

/** CallApp 落库的一通电话（按 callSessionId 聚合的逐字稿） */
type RecordingSession = {
    sessionId: string;
    charId: string;
    charName: string;
    charAvatar?: string;
    startTs: number;
    durationSec: number;
    lines: { id: string; role: 'user' | 'assistant'; text: string; time: string; audioUrl?: string }[];
};

const DIAL_HANDOFF_KEY = 'moro_phone_dial_char_id';   // 与 CallApp 的跳转握手键
const LOG_VIEWED_KEY = 'moro_phone_log_viewed_at';    // 未接红点：记录上次查看通话记录的时间
const MAX_DIAL_LEN = 16;

/** 角色虚拟号码：char.id 确定性哈希 → 8 位数字，格式 010-XXXX-XXXX。
 *  联系人展示、拨号匹配、通话记录落库共用同一映射。 */
const charPhoneNumber = (charId: string): string => {
    let hash = 0;
    for (let i = 0; i < charId.length; i++) hash = (hash * 31 + charId.charCodeAt(i)) >>> 0;
    const digits = String(hash % 100000000).padStart(8, '0');
    return `010-${digits.slice(0, 4)}-${digits.slice(4)}`;
};

const digitsOnly = (raw: string) => raw.replace(/\D/g, '');

/** 拨号显示分组：3-4-4-…（带 + 前缀时首组 4 位），组间空格 */
const formatDialDisplay = (raw: string): string => {
    if (!raw) return '';
    const sizes = [raw.startsWith('+') ? 4 : 3, 4, 4];
    const out: string[] = [];
    let i = 0;
    for (const size of sizes) {
        if (i >= raw.length) break;
        out.push(raw.slice(i, i + size));
        i += size;
    }
    if (i < raw.length) out.push(raw.slice(i));
    return out.join(' ');
};

const formatDuration = (sec: number) =>
    `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

/** 通话记录时间：今天只显示时分，昨天加前缀，更早显示日期 */
const formatLogTime = (ts: number): string => {
    const d = new Date(ts);
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const hm = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    if (ts >= startOfToday) return hm;
    if (ts >= startOfToday - 86400000) return `昨天 ${hm}`;
    if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
};

/** 逐字稿展示前去掉 <语音>（外语朗读用）标签，避免双语堆叠 */
const stripVoiceTag = (text: string): string => {
    const cleaned = text.replace(/<[语語]音>[\s\S]*?<\/[语語]音>/g, '').trim();
    return cleaned || text.trim();
};

const Avatar: React.FC<{ name: string; src?: string; sizeClass?: string }> = ({ name, src, sizeClass = 'w-11 h-11 text-base' }) => (
    src
        ? <img src={src} alt={name} className={`${sizeClass} rounded-full object-cover shrink-0`} />
        : <div className={`${sizeClass} rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center font-semibold shrink-0`}>{name[0] || '角'}</div>
);

const DIAL_KEYS: { key: string; sub: string }[] = [
    { key: '1', sub: '' }, { key: '2', sub: 'ABC' }, { key: '3', sub: 'DEF' },
    { key: '4', sub: 'GHI' }, { key: '5', sub: 'JKL' }, { key: '6', sub: 'MNO' },
    { key: '7', sub: 'PQRS' }, { key: '8', sub: 'TUV' }, { key: '9', sub: 'WXYZ' },
    { key: '*', sub: '' }, { key: '0', sub: '+' }, { key: '#', sub: '' },
];

const PhoneApp: React.FC = () => {
    const { closeApp, openApp, characters, addToast } = useOS();

    const [tab, setTab] = useState<PhoneTab>('dial');
    const [dialInput, setDialInput] = useState('');
    const [logs, setLogs] = useState<PhoneCallLog[]>([]);
    const [logViewedAt, setLogViewedAt] = useState<number>(() => {
        try { return parseInt(localStorage.getItem(LOG_VIEWED_KEY) || '0', 10) || 0; } catch { return 0; }
    });
    const [confirmClearAll, setConfirmClearAll] = useState(false);

    // 录音页
    const [recordings, setRecordings] = useState<RecordingSession[]>([]);
    const [recordingsLoaded, setRecordingsLoaded] = useState(false);
    const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
    const [playingLineId, setPlayingLineId] = useState<string | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    // 拨打陌生号码的假呼叫态
    const [outgoingNumber, setOutgoingNumber] = useState<string | null>(null);
    const outgoingNumberRef = useRef<string | null>(null);
    const outgoingTimerRef = useRef<number | null>(null);

    // 模拟来电态
    const [incomingChar, setIncomingChar] = useState<CharacterProfile | null>(null);
    const incomingCharRef = useRef<CharacterProfile | null>(null);
    const incomingTimerRef = useRef<number | null>(null);

    // 长按 0 → '+'
    const zeroTimerRef = useRef<number | null>(null);
    const zeroLongPressedRef = useRef(false);

    const reloadLogs = async () => {
        try { setLogs(await DB.getAllPhoneCallLogs()); } catch { /* 首次打开 store 可能未就绪，静默 */ }
    };
    useEffect(() => { reloadLogs(); }, []);

    // 未接红点：上次查看记录页之后新产生的未接来电数
    const missedBadge = useMemo(
        () => logs.filter(l => l.direction === 'missed' && l.timestamp > logViewedAt).length,
        [logs, logViewedAt],
    );

    const markLogsViewed = () => {
        const now = Date.now();
        setLogViewedAt(now);
        try { localStorage.setItem(LOG_VIEWED_KEY, String(now)); } catch { /* ignore */ }
    };

    const switchTab = (next: PhoneTab) => {
        setTab(next);
        if (next === 'logs') markLogsViewed();
    };

    const saveLog = async (log: Omit<PhoneCallLog, 'id'>) => {
        await DB.savePhoneCallLog({ id: `pcl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, ...log });
        await reloadLogs();
    };

    // --- 拨打已知角色：记录呼出 + sessionStorage 握手 + 跳转 CallApp 真实通话 ---
    const callCharacter = async (char: CharacterProfile) => {
        await saveLog({
            charId: char.id, name: char.name, number: charPhoneNumber(char.id),
            direction: 'outgoing', timestamp: Date.now(), durationSec: 0,
        });
        try { sessionStorage.setItem(DIAL_HANDOFF_KEY, char.id); } catch { /* ignore */ }
        openApp(AppID.Call);
    };

    // --- 拨打陌生号码：假呼叫 ~6 秒 → 无人接听 ---
    const startFakeOutgoing = (number: string) => {
        outgoingNumberRef.current = number;
        setOutgoingNumber(number);
        outgoingTimerRef.current = window.setTimeout(() => endFakeOutgoing(true), 6000);
    };
    const endFakeOutgoing = async (timedOut: boolean) => {
        const number = outgoingNumberRef.current;
        if (!number) return;
        outgoingNumberRef.current = null;
        if (outgoingTimerRef.current) { window.clearTimeout(outgoingTimerRef.current); outgoingTimerRef.current = null; }
        setOutgoingNumber(null);
        if (timedOut) addToast('无人接听', 'info');
        await saveLog({ name: number, number, direction: 'outgoing', timestamp: Date.now(), durationSec: 0 });
    };

    const handleDial = (rawInput?: string) => {
        const raw = (rawInput ?? dialInput).trim();
        if (!raw) { addToast('先输入号码吧', 'info'); return; }
        const dialed = digitsOnly(raw);
        const matched = dialed ? characters.find(c => digitsOnly(charPhoneNumber(c.id)) === dialed) : undefined;
        setDialInput('');
        if (matched) callCharacter(matched);
        else startFakeOutgoing(raw);
    };

    // --- 模拟来电：接听 → 跳转 CallApp；拒接 / 25 秒超时 → 未接 ---
    const clearIncomingTimer = () => {
        if (incomingTimerRef.current) { window.clearTimeout(incomingTimerRef.current); incomingTimerRef.current = null; }
    };
    const triggerIncoming = (char: CharacterProfile) => {
        if (incomingCharRef.current) return;
        incomingCharRef.current = char;
        setIncomingChar(char);
        incomingTimerRef.current = window.setTimeout(() => declineIncoming(true), 25000);
    };
    const acceptIncoming = async () => {
        const char = incomingCharRef.current;
        if (!char) return;
        clearIncomingTimer();
        incomingCharRef.current = null;
        setIncomingChar(null);
        await saveLog({
            charId: char.id, name: char.name, number: charPhoneNumber(char.id),
            direction: 'incoming', timestamp: Date.now(), durationSec: 0,
        });
        try { sessionStorage.setItem(DIAL_HANDOFF_KEY, char.id); } catch { /* ignore */ }
        openApp(AppID.Call);
    };
    const declineIncoming = async (timedOut = false) => {
        const char = incomingCharRef.current;
        if (!char) return;
        clearIncomingTimer();
        incomingCharRef.current = null;
        setIncomingChar(null);
        if (timedOut) addToast(`${char.name} 的来电未接听`, 'info');
        await saveLog({
            charId: char.id, name: char.name, number: charPhoneNumber(char.id),
            direction: 'missed', timestamp: Date.now(), durationSec: 0,
        });
    };

    // 卸载时清掉所有计时器和播放器
    useEffect(() => () => {
        if (outgoingTimerRef.current) window.clearTimeout(outgoingTimerRef.current);
        if (incomingTimerRef.current) window.clearTimeout(incomingTimerRef.current);
        if (zeroTimerRef.current) window.clearTimeout(zeroTimerRef.current);
        if (audioRef.current) audioRef.current.pause();
    }, []);

    // --- 录音页：跨所有角色聚合 CallApp 的通话逐字稿（按 callSessionId 分组） ---
    useEffect(() => {
        if (tab !== 'recordings' || recordingsLoaded) return;
        (async () => {
            const sessions: RecordingSession[] = [];
            for (const char of characters) {
                // includeProcessed=true：通话消息可能已被记忆宫殿水位线推进，必须读全量
                let msgs: Message[] = [];
                try { msgs = await DB.getMessagesByCharId(char.id, true); } catch { continue; }
                const callMsgs = msgs
                    .filter(m => m.metadata?.source === 'call' && m.metadata?.callSessionId)
                    .sort((a, b) => a.timestamp - b.timestamp);
                const grouped = new Map<string, Message[]>();
                callMsgs.forEach(m => {
                    const sid = String(m.metadata?.callSessionId);
                    const arr = grouped.get(sid);
                    if (arr) arr.push(m); else grouped.set(sid, [m]);
                });
                grouped.forEach((list, sessionId) => {
                    const start = list[0]?.timestamp || Date.now();
                    const end = list[list.length - 1]?.timestamp || start;
                    sessions.push({
                        sessionId,
                        charId: char.id,
                        charName: char.name,
                        charAvatar: char.avatar,
                        startTs: start,
                        durationSec: Math.max(1, Math.floor((end - start) / 1000)),
                        lines: list.map(m => ({
                            id: `rec-${m.id}`,
                            role: m.role === 'user' ? 'user' as const : 'assistant' as const,
                            text: stripVoiceTag(m.content),
                            time: new Date(m.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
                            audioUrl: typeof m.metadata?.audioUrl === 'string' ? m.metadata.audioUrl : undefined,
                        })),
                    });
                });
            }
            sessions.sort((a, b) => b.startTs - a.startTs);
            setRecordings(sessions);
            setRecordingsLoaded(true);
        })();
    }, [tab, recordingsLoaded, characters]);

    // --- 逐字稿气泡音频播放：单实例，播下一条前先停上一条 ---
    const stopPlayback = () => {
        if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
        setPlayingLineId(null);
    };
    const playLine = (lineId: string, url?: string) => {
        if (!url) return;
        if (playingLineId === lineId) { stopPlayback(); return; }
        stopPlayback();
        const audio = new Audio(url);
        audioRef.current = audio;
        setPlayingLineId(lineId);
        const fail = () => {
            if (audioRef.current === audio) { audioRef.current = null; setPlayingLineId(null); }
            addToast('音频播放失败（这段录音可能已过期）', 'error');
        };
        audio.onended = () => { if (audioRef.current === audio) { audioRef.current = null; setPlayingLineId(null); } };
        audio.onerror = fail;
        audio.play().catch(fail);
    };

    // --- 拨号键盘：长按 0 输出 '+' ---
    const appendKey = (k: string) => setDialInput(prev => (prev.length >= MAX_DIAL_LEN ? prev : prev + k));
    const handleZeroDown = () => {
        zeroLongPressedRef.current = false;
        zeroTimerRef.current = window.setTimeout(() => {
            zeroLongPressedRef.current = true;
            appendKey('+');
        }, 450);
    };
    const handleZeroUp = () => {
        if (zeroTimerRef.current) { window.clearTimeout(zeroTimerRef.current); zeroTimerRef.current = null; }
        if (!zeroLongPressedRef.current) appendKey('0');
        zeroLongPressedRef.current = false;
    };
    const handleZeroCancel = () => {
        if (zeroTimerRef.current) { window.clearTimeout(zeroTimerRef.current); zeroTimerRef.current = null; }
        zeroLongPressedRef.current = true; // 指针移出按键则本次不输出
    };

    // 拨号输入实时匹配角色，命中时在号码下方提示
    const dialMatchedChar = useMemo(() => {
        const dialed = digitsOnly(dialInput);
        if (!dialed) return null;
        return characters.find(c => digitsOnly(charPhoneNumber(c.id)) === dialed) || null;
    }, [dialInput, characters]);

    // 通话记录条目点击 → 回拨
    const redial = (log: PhoneCallLog) => {
        const byId = log.charId ? characters.find(c => c.id === log.charId) : undefined;
        const byNumber = byId || characters.find(c => digitsOnly(charPhoneNumber(c.id)) === digitsOnly(log.number));
        if (byNumber) callCharacter(byNumber);
        else startFakeOutgoing(log.number);
    };

    const deleteLog = async (log: PhoneCallLog) => {
        await DB.deletePhoneCallLog(log.id);
        await reloadLogs();
    };

    const clearAllLogs = async () => {
        setConfirmClearAll(false);
        await DB.clearPhoneCallLogs();
        await reloadLogs();
        addToast('通话记录已清空', 'success');
    };

    const directionMeta = (direction: PhoneCallLog['direction']) => {
        switch (direction) {
            case 'outgoing': return { Icon: PhoneOutgoing, cls: 'text-emerald-500', label: '呼出' };
            case 'incoming': return { Icon: PhoneIncoming, cls: 'text-sky-500', label: '已接' };
            default: return { Icon: PhoneX, cls: 'text-rose-500', label: '未接' };
        }
    };

    // ---------------- 各 Tab 渲染 ----------------

    const renderContacts = () => (
        <div className="flex-1 overflow-y-auto min-h-0 px-4 py-3">
            {!characters.length && (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                    <Star size={32} className="text-slate-300" />
                    <p className="text-sm text-slate-400 mt-3">还没有联系人</p>
                    <p className="text-xs text-slate-300 mt-1">先去捏一个角色吧</p>
                </div>
            )}
            <div className="space-y-2">
                {characters.map(char => (
                    <div key={char.id} className="flex items-center gap-3 bg-white rounded-2xl border border-slate-100 px-3.5 py-3 shadow-sm">
                        <button onClick={() => callCharacter(char)} className="flex items-center gap-3 flex-1 min-w-0 text-left active:scale-[0.99] transition">
                            <Avatar name={char.name} src={char.avatar} />
                            <div className="min-w-0">
                                <div className="text-sm font-medium text-slate-800 truncate">{char.name}</div>
                                <div className="text-xs text-slate-400 mt-0.5 font-mono">{charPhoneNumber(char.id)}</div>
                            </div>
                        </button>
                        <button
                            onClick={() => callCharacter(char)}
                            className="w-9 h-9 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center active:scale-90 transition"
                            title={`拨给 ${char.name}`}
                        >
                            <Phone size={17} weight="fill" />
                        </button>
                        <button
                            onClick={() => triggerIncoming(char)}
                            className="w-9 h-9 rounded-full bg-sky-50 text-sky-600 flex items-center justify-center active:scale-90 transition"
                            title="让 TA 打给我"
                        >
                            <PhoneIncoming size={17} weight="fill" />
                        </button>
                    </div>
                ))}
            </div>
            {!!characters.length && <p className="text-center text-[11px] text-slate-300 mt-4 mb-2">点击 <PhoneIncoming size={11} className="inline -mt-0.5" /> 可以让 TA 给你打电话</p>}
        </div>
    );

    const renderLogs = () => (
        <div className="flex-1 overflow-y-auto min-h-0 px-4 py-3">
            {!logs.length && (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                    <ClockCounterClockwise size={32} className="text-slate-300" />
                    <p className="text-sm text-slate-400 mt-3">还没有通话记录</p>
                    <p className="text-xs text-slate-300 mt-1">拨出去的每一通电话都会留在这里</p>
                </div>
            )}
            <div className="space-y-2">
                {logs.map(log => {
                    const { Icon, cls, label } = directionMeta(log.direction);
                    const missed = log.direction === 'missed';
                    return (
                        <div key={log.id} className="flex items-center gap-3 bg-white rounded-2xl border border-slate-100 px-3.5 py-3 shadow-sm">
                            <button onClick={() => redial(log)} className="flex items-center gap-3 flex-1 min-w-0 text-left active:scale-[0.99] transition">
                                <Icon size={18} weight="bold" className={`${cls} shrink-0`} />
                                <div className="min-w-0 flex-1">
                                    <div className={`text-sm font-medium truncate ${missed ? 'text-rose-500' : 'text-slate-800'}`}>{log.name}</div>
                                    <div className="text-xs text-slate-400 mt-0.5">
                                        {label}
                                        {log.name !== log.number && <span className="font-mono"> · {log.number}</span>}
                                        {log.durationSec > 0 && <span> · {formatDuration(log.durationSec)}</span>}
                                    </div>
                                </div>
                                <div className="text-[11px] text-slate-400 shrink-0">{formatLogTime(log.timestamp)}</div>
                            </button>
                            <button onClick={() => deleteLog(log)} className="p-1.5 rounded-full text-slate-300 hover:text-rose-400 active:scale-90 transition" title="删除这条记录">
                                <Trash size={15} />
                            </button>
                        </div>
                    );
                })}
            </div>
        </div>
    );

    const renderDialPad = () => (
        <div className="flex-1 min-h-0 flex flex-col">
            {/* 号码显示区 */}
            <div className="flex-1 flex flex-col items-center justify-end px-6 pb-2 min-h-[88px]">
                <div className="text-3xl font-light text-slate-800 tracking-wider tabular-nums break-all text-center min-h-[40px]">
                    {formatDialDisplay(dialInput) || <span className="text-slate-300 text-xl">输入号码</span>}
                </div>
                <div className="h-5 mt-1 text-xs text-emerald-600">
                    {dialMatchedChar ? `→ ${dialMatchedChar.name}` : ''}
                </div>
            </div>
            {/* 键盘 */}
            <div className="px-8 pb-3">
                <div className="grid grid-cols-3 gap-x-6 gap-y-3 justify-items-center">
                    {DIAL_KEYS.map(({ key, sub }) => (
                        key === '0' ? (
                            <button
                                key={key}
                                onPointerDown={handleZeroDown}
                                onPointerUp={handleZeroUp}
                                onPointerLeave={handleZeroCancel}
                                onContextMenu={e => e.preventDefault()}
                                className="w-[68px] h-[68px] rounded-full bg-white border border-slate-100 shadow-sm flex flex-col items-center justify-center active:bg-slate-100 active:scale-95 transition select-none touch-none"
                            >
                                <span className="text-2xl font-light text-slate-800 leading-none">0</span>
                                <span className="text-[10px] text-slate-400 mt-0.5 tracking-widest">+</span>
                            </button>
                        ) : (
                            <button
                                key={key}
                                onClick={() => appendKey(key)}
                                className="w-[68px] h-[68px] rounded-full bg-white border border-slate-100 shadow-sm flex flex-col items-center justify-center active:bg-slate-100 active:scale-95 transition select-none"
                            >
                                <span className="text-2xl font-light text-slate-800 leading-none">{key}</span>
                                <span className="text-[10px] text-slate-400 mt-0.5 tracking-widest h-[12px]">{sub}</span>
                            </button>
                        )
                    ))}
                </div>
                {/* 拨号 / 退格行 */}
                <div className="grid grid-cols-3 gap-x-6 justify-items-center items-center mt-3">
                    <div />
                    <button
                        onClick={() => handleDial()}
                        className="w-[68px] h-[68px] rounded-full bg-emerald-500 text-white shadow-lg shadow-emerald-200 flex items-center justify-center active:scale-95 transition"
                        title="拨号"
                    >
                        <Phone size={28} weight="fill" />
                    </button>
                    <button
                        onClick={() => setDialInput(prev => prev.slice(0, -1))}
                        onContextMenu={e => { e.preventDefault(); setDialInput(''); }}
                        disabled={!dialInput}
                        className="w-12 h-12 rounded-full flex items-center justify-center text-slate-500 disabled:opacity-0 active:scale-90 transition"
                        title="退格"
                    >
                        <Backspace size={26} />
                    </button>
                </div>
            </div>
        </div>
    );

    const renderRecordings = () => (
        <div className="flex-1 overflow-y-auto min-h-0 px-4 py-3">
            {!recordingsLoaded && (
                <div className="flex items-center justify-center py-20">
                    <div className="w-5 h-5 border-2 border-slate-200 border-t-emerald-500 rounded-full animate-spin" />
                </div>
            )}
            {recordingsLoaded && !recordings.length && (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                    <Waveform size={32} className="text-slate-300" />
                    <p className="text-sm text-slate-400 mt-3">还没有通话录音</p>
                    <p className="text-xs text-slate-300 mt-1">打一通语音电话，逐字稿会自动留档</p>
                </div>
            )}
            <div className="space-y-2">
                {recordings.map(rec => {
                    const expanded = expandedSessionId === rec.sessionId;
                    return (
                        <div key={`${rec.charId}-${rec.sessionId}`} className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                            <button
                                onClick={() => { setExpandedSessionId(expanded ? null : rec.sessionId); if (expanded) stopPlayback(); }}
                                className="w-full flex items-center gap-3 px-3.5 py-3 text-left active:bg-slate-50 transition"
                            >
                                <Avatar name={rec.charName} src={rec.charAvatar} sizeClass="w-10 h-10 text-sm" />
                                <div className="min-w-0 flex-1">
                                    <div className="text-sm font-medium text-slate-800 truncate">{rec.charName}</div>
                                    <div className="text-xs text-slate-400 mt-0.5">
                                        {new Date(rec.startTs).toLocaleString('zh-CN')} · {formatDuration(rec.durationSec)} · {rec.lines.length} 句
                                    </div>
                                </div>
                                {expanded ? <CaretUp size={15} className="text-slate-400 shrink-0" /> : <CaretDown size={15} className="text-slate-400 shrink-0" />}
                            </button>
                            {expanded && (
                                <div className="border-t border-slate-100 px-3.5 py-3 space-y-2.5 bg-slate-50/60">
                                    {rec.lines.map(line => (
                                        <div key={line.id} className={`rounded-xl px-3 py-2 ${line.role === 'user' ? 'bg-emerald-50 ml-6' : 'bg-white border border-slate-100 mr-6'}`}>
                                            <div className="text-[10px] text-slate-400">{line.role === 'user' ? '我' : rec.charName} · {line.time}</div>
                                            <div className="text-[13px] text-slate-700 mt-0.5 leading-relaxed whitespace-pre-wrap">{line.text}</div>
                                            {!!line.audioUrl && (
                                                <button
                                                    onClick={() => playLine(line.id, line.audioUrl)}
                                                    className={`mt-1.5 inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border transition active:scale-95 ${playingLineId === line.id ? 'bg-emerald-500 border-emerald-500 text-white' : 'bg-white border-slate-200 text-slate-500'}`}
                                                >
                                                    {playingLineId === line.id ? <><Pause size={11} weight="fill" /> 停止</> : <><Play size={11} weight="fill" /> 播放</>}
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );

    const TABS: { id: PhoneTab; label: string; Icon: PhosphorIcon }[] = [
        { id: 'contacts', label: '收藏', Icon: Star },
        { id: 'logs', label: '通话记录', Icon: ClockCounterClockwise },
        { id: 'dial', label: '键盘', Icon: DotsNine },
        { id: 'recordings', label: '录音', Icon: Waveform },
    ];

    return (
        <div className="h-full w-full bg-slate-50 flex flex-col relative overflow-hidden">
            {/* 顶部栏 */}
            <div className="h-16 bg-white/80 backdrop-blur-xl flex items-center px-4 border-b border-slate-100/60 shrink-0 z-10">
                <button onClick={closeApp} className="p-2 -ml-2 rounded-full hover:bg-black/5 active:scale-90 transition-transform">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-slate-600"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
                </button>
                <h1 className="text-lg font-semibold text-slate-800 ml-2 tracking-tight">电话</h1>
                <div className="flex-1" />
                {tab === 'logs' && !!logs.length && (
                    <button onClick={() => setConfirmClearAll(true)} className="text-xs text-slate-400 hover:text-rose-400 px-2 py-1 transition">清空全部</button>
                )}
                {/* 语音通话已整合进电话 App：从这里进入实时语音通话（选角色 / 语音通话记录） */}
                <button
                    onClick={() => openApp(AppID.Call)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500 text-white text-xs font-bold shadow-sm active:scale-95 transition"
                >
                    <Waveform size={14} weight="bold" />
                    语音通话
                </button>
            </div>

            {/* 内容区 */}
            {tab === 'contacts' && renderContacts()}
            {tab === 'logs' && renderLogs()}
            {tab === 'dial' && renderDialPad()}
            {tab === 'recordings' && renderRecordings()}

            {/* 底部 Tab 栏 */}
            <div className="shrink-0 bg-white/90 backdrop-blur-xl border-t border-slate-100 grid grid-cols-4 pb-[max(env(safe-area-inset-bottom),6px)] pt-1.5 z-10">
                {TABS.map(({ id, label, Icon }) => {
                    const active = tab === id;
                    return (
                        <button key={id} onClick={() => switchTab(id)} className="relative flex flex-col items-center gap-0.5 py-1 active:scale-95 transition">
                            <span className="relative">
                                <Icon size={22} weight={active ? 'fill' : 'regular'} className={active ? 'text-emerald-500' : 'text-slate-400'} />
                                {id === 'logs' && missedBadge > 0 && (
                                    <span className="absolute -top-1 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[10px] font-semibold flex items-center justify-center">
                                        {missedBadge > 9 ? '9+' : missedBadge}
                                    </span>
                                )}
                            </span>
                            <span className={`text-[10px] ${active ? 'text-emerald-600 font-medium' : 'text-slate-400'}`}>{label}</span>
                        </button>
                    );
                })}
            </div>

            {/* 拨打陌生号码：假呼叫全屏态 */}
            {outgoingNumber && (
                <div className="absolute inset-0 z-50 bg-gradient-to-b from-slate-900 via-slate-950 to-black text-white flex flex-col items-center justify-between pt-24 pb-16">
                    <div className="flex flex-col items-center">
                        <div className="w-24 h-24 rounded-full bg-white/10 border border-white/15 flex items-center justify-center">
                            <Phone size={40} className="text-white/80" />
                        </div>
                        <div className="mt-6 text-2xl font-light tracking-wider tabular-nums text-center px-6 break-all">{formatDialDisplay(outgoingNumber)}</div>
                        <div className="mt-3 text-sm text-slate-400 animate-pulse">正在呼叫…</div>
                    </div>
                    <button
                        onClick={() => endFakeOutgoing(false)}
                        className="w-16 h-16 rounded-full bg-rose-500 flex items-center justify-center shadow-lg shadow-rose-900/40 active:scale-95 transition"
                        title="挂断"
                    >
                        <PhoneDisconnect size={28} weight="fill" />
                    </button>
                </div>
            )}

            {/* 模拟来电全屏态 */}
            {incomingChar && (
                <div className="absolute inset-0 z-50 bg-gradient-to-b from-slate-900 via-slate-950 to-black text-white flex flex-col items-center justify-between pt-20 pb-14">
                    <div className="flex flex-col items-center">
                        <div className="relative">
                            <div className="absolute -inset-3 rounded-full bg-emerald-400/15 animate-ping" />
                            <Avatar name={incomingChar.name} src={incomingChar.avatar} sizeClass="w-28 h-28 text-4xl relative z-10" />
                        </div>
                        <div className="mt-6 text-2xl font-medium">{incomingChar.name}</div>
                        <div className="mt-1.5 text-sm text-slate-400 font-mono">{charPhoneNumber(incomingChar.id)}</div>
                        <div className="mt-3 text-sm text-slate-300 animate-pulse">来电…</div>
                    </div>
                    <div className="w-full px-14 flex items-center justify-between">
                        <div className="flex flex-col items-center gap-2">
                            <button
                                onClick={() => declineIncoming(false)}
                                className="w-16 h-16 rounded-full bg-rose-500 flex items-center justify-center shadow-lg shadow-rose-900/40 active:scale-95 transition"
                            >
                                <PhoneDisconnect size={28} weight="fill" />
                            </button>
                            <span className="text-xs text-slate-400">拒接</span>
                        </div>
                        <div className="flex flex-col items-center gap-2">
                            <button
                                onClick={acceptIncoming}
                                className="w-16 h-16 rounded-full bg-emerald-500 flex items-center justify-center shadow-lg shadow-emerald-900/40 active:scale-95 transition animate-bounce"
                            >
                                <Phone size={28} weight="fill" />
                            </button>
                            <span className="text-xs text-slate-400">接听</span>
                        </div>
                    </div>
                </div>
            )}

            {/* 清空全部确认 */}
            <ConfirmDialog
                isOpen={confirmClearAll}
                title="清空通话记录"
                message="所有通话记录将被永久删除（通话录音与逐字稿不受影响）。确定吗？"
                variant="danger"
                confirmText="清空"
                onConfirm={clearAllLogs}
                onCancel={() => setConfirmClearAll(false)}
            />
        </div>
    );
};

export default PhoneApp;
