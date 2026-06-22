import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    Phone, PhoneOutgoing, PhoneIncoming, PhoneX, PhoneDisconnect,
    Backspace, Play, Pause, Trash, CaretDown, CaretUp,
    AddressBook, Receipt, GridNine, VinylRecord, Waveform,
} from '@phosphor-icons/react';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { startDialTone, startIncomingRing } from '../utils/ringtone';
import { AppID, CharacterProfile, Message, PhoneCallLog } from '../types';
import ConfirmDialog from '../components/os/ConfirmDialog';

// 回声亭 App（原「电话」）— 拨号键盘 / 通话存根（拨出·接起·漏接）/ 留声片逐字稿 / 名片夹。
// 真实语音通话由 CallApp 承担：拨给已知角色时通过 sessionStorage 握手跳转过去。
// 界面风格：黑白拼贴手账（纸张底 + 胶带 + 邮戳 + 硬阴影），完全原创布局。

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
const LOG_VIEWED_KEY = 'moro_phone_log_viewed_at';    // 漏接红点：记录上次查看通话存根的时间
const MAX_DIAL_LEN = 16;

/** 角色虚拟号码：char.id 确定性哈希 → 8 位数字，格式 010-XXXX-XXXX。
 *  名片展示、拨号匹配、通话存根落库共用同一映射。 */
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

/** 通话存根时间：今天只显示时分，昨天加前缀，更早显示日期 */
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

/* ─────────────── 黑白拼贴手账 视觉零件 ─────────────── */

const PAPER_BG = '#efece3';   // 牛皮/米纸底色
const INK = '#1b1a17';        // 墨黑

/** 一截斜贴的胶带 */
const Tape: React.FC<{ className?: string; style?: React.CSSProperties }> = ({ className = '', style }) => (
    <span
        className={`pointer-events-none absolute block ${className}`}
        style={{ background: 'rgba(27,26,23,0.10)', backdropFilter: 'blur(1px)', boxShadow: 'inset 0 0 0 1px rgba(27,26,23,0.06)', ...style }}
    />
);

/** 邮戳式标题徽记 */
const Postmark: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
    <span className={`inline-flex items-center justify-center border-2 border-dashed border-black px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.25em] ${className}`}>
        {children}
    </span>
);

/** 方形老照片头像（照片角 + 微旋转）。无图时落角色名首字。 */
const Avatar: React.FC<{ name: string; src?: string; sizeClass?: string; tilt?: string }> = ({ name, src, sizeClass = 'w-12 h-12 text-base', tilt = '-rotate-2' }) => (
    <div className={`relative shrink-0 ${tilt}`}>
        {src
            ? <img src={src} alt={name} className={`${sizeClass} object-cover border-2 border-black`} style={{ boxShadow: '2px 2px 0 #000' }} />
            : <div className={`${sizeClass} border-2 border-black bg-white flex items-center justify-center font-serif font-bold text-black`} style={{ boxShadow: '2px 2px 0 #000' }}>{name[0] || '某'}</div>}
        {/* 左上照片角 */}
        <span className="absolute -top-1 -left-1 w-2.5 h-2.5 border-t-2 border-l-2 border-black" />
        <span className="absolute -bottom-1 -right-1 w-2.5 h-2.5 border-b-2 border-r-2 border-black" />
    </div>
);

const DIAL_KEYS: { key: string; sub: string }[] = [
    { key: '1', sub: '✦' }, { key: '2', sub: 'ABC' }, { key: '3', sub: 'DEF' },
    { key: '4', sub: 'GHI' }, { key: '5', sub: 'JKL' }, { key: '6', sub: 'MNO' },
    { key: '7', sub: 'PQRS' }, { key: '8', sub: 'TUV' }, { key: '9', sub: 'WXYZ' },
    { key: '*', sub: '·' }, { key: '0', sub: '+' }, { key: '#', sub: '·' },
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

    // 留声片页
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

    // 漏接红点：上次查看存根页之后新产生的漏接来电数
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
        if (timedOut) addToast('那头没人接', 'info');
        await saveLog({ name: number, number, direction: 'outgoing', timestamp: Date.now(), durationSec: 0 });
    };

    const handleDial = (rawInput?: string) => {
        const raw = (rawInput ?? dialInput).trim();
        if (!raw) { addToast('先拨个号码吧', 'info'); return; }
        const dialed = digitsOnly(raw);
        const matched = dialed ? characters.find(c => digitsOnly(charPhoneNumber(c.id)) === dialed) : undefined;
        setDialInput('');
        if (matched) callCharacter(matched);
        else startFakeOutgoing(raw);
    };

    // --- 模拟来电：接起 → 跳转 CallApp；不接 / 25 秒超时 → 漏接 ---
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
        if (timedOut) addToast(`${char.name} 的来电没接起`, 'info');
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

    // 拨出回铃音「嘟——嘟——」：假呼叫（拨陌生号码）等待期间循环播放，结束（outgoingNumber 清空）即停。
    useEffect(() => {
        if (!outgoingNumber) return;
        const ring = startDialTone();
        return () => ring.stop();
    }, [outgoingNumber]);

    // 来电提示音：模拟来电响铃期间循环播放，接听 / 不接 / 超时（incomingChar 清空）即停。
    useEffect(() => {
        if (!incomingChar) return;
        const ring = startIncomingRing();
        return () => ring.stop();
    }, [incomingChar]);

    // --- 留声片页：跨所有角色聚合 CallApp 的通话逐字稿（按 callSessionId 分组） ---
    useEffect(() => {
        if (tab !== 'recordings' || recordingsLoaded) return;
        (async () => {
            const sessions: RecordingSession[] = [];
            for (const char of characters) {
                // includeProcessed=true：通话消息可能已被回忆标本馆水位线推进，必须读全量
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
            addToast('唱片放不出来了（这段录音可能已过期）', 'error');
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

    // 通话存根条目点击 → 回拨
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
        addToast('存根已全部撕掉', 'success');
    };

    const directionMeta = (direction: PhoneCallLog['direction']) => {
        switch (direction) {
            case 'outgoing': return { Icon: PhoneOutgoing, label: '拨出', dashed: false };
            case 'incoming': return { Icon: PhoneIncoming, label: '接起', dashed: false };
            default: return { Icon: PhoneX, label: '漏接', dashed: true };
        }
    };

    // ---------------- 各 Tab 渲染 ----------------

    const renderContacts = () => (
        <div className="flex-1 overflow-y-auto min-h-0 px-4 py-4">
            {!characters.length && (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                    <div className="border-2 border-dashed border-black p-5 -rotate-2 bg-white" style={{ boxShadow: '3px 3px 0 #000' }}>
                        <AddressBook size={30} className="text-black" />
                    </div>
                    <p className="text-sm font-serif font-bold text-black mt-4">名片夹空空如也</p>
                    <p className="text-xs text-neutral-500 mt-1.5">先去捏一个角色，名片才会贴进来</p>
                </div>
            )}
            <div className="space-y-3.5">
                {characters.map((char, i) => (
                    <div key={char.id} className={`relative bg-white border-2 border-black px-3.5 py-3 ${i % 2 ? 'rotate-[0.4deg]' : '-rotate-[0.4deg]'}`} style={{ boxShadow: '3px 3px 0 #000' }}>
                        <Tape className="w-12 h-5 -top-2.5 left-6 rotate-[-4deg]" />
                        <div className="flex items-center gap-3.5">
                            <button onClick={() => callCharacter(char)} className="flex items-center gap-3.5 flex-1 min-w-0 text-left active:translate-x-px active:translate-y-px transition-transform">
                                <Avatar name={char.name} src={char.avatar} tilt={i % 2 ? 'rotate-2' : '-rotate-2'} />
                                <div className="min-w-0">
                                    <div className="text-sm font-serif font-bold text-black truncate">{char.name}</div>
                                    <div className="text-[11px] text-neutral-500 mt-1 font-mono tracking-wider border-b border-dashed border-black/30 inline-block pb-0.5">{charPhoneNumber(char.id)}</div>
                                </div>
                            </button>
                            <button
                                onClick={() => callCharacter(char)}
                                className="w-9 h-9 border-2 border-black bg-black text-white flex items-center justify-center active:translate-x-px active:translate-y-px transition-transform"
                                title={`拨给 ${char.name}`}
                            >
                                <Phone size={16} weight="fill" />
                            </button>
                            <button
                                onClick={() => triggerIncoming(char)}
                                className="w-9 h-9 border-2 border-black bg-white text-black flex items-center justify-center active:translate-x-px active:translate-y-px transition-transform"
                                title="让 TA 摇一通电话给我"
                            >
                                <PhoneIncoming size={16} weight="bold" />
                            </button>
                        </div>
                    </div>
                ))}
            </div>
            {!!characters.length && (
                <p className="text-center text-[11px] text-neutral-500 mt-5 mb-2">
                    按下白格里的 <PhoneIncoming size={11} className="inline -mt-0.5" weight="bold" /> ，让 TA 摇一通电话过来
                </p>
            )}
        </div>
    );

    const renderLogs = () => (
        <div className="flex-1 overflow-y-auto min-h-0 px-4 py-4">
            {!logs.length && (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                    <div className="border-2 border-dashed border-black p-5 rotate-2 bg-white" style={{ boxShadow: '3px 3px 0 #000' }}>
                        <Receipt size={30} className="text-black" />
                    </div>
                    <p className="text-sm font-serif font-bold text-black mt-4">还没有存根</p>
                    <p className="text-xs text-neutral-500 mt-1.5">每通电话都会留下一张存根</p>
                </div>
            )}
            <div className="space-y-3">
                {logs.map((log, i) => {
                    const { Icon, label, dashed } = directionMeta(log.direction);
                    const missed = log.direction === 'missed';
                    return (
                        <div key={log.id} className={`relative bg-white px-3.5 py-3 ${dashed ? 'border-2 border-dashed' : 'border-2'} border-black ${i % 2 ? 'rotate-[0.3deg]' : '-rotate-[0.3deg]'}`} style={{ boxShadow: '3px 3px 0 #000' }}>
                            {/* 左侧票根锯齿缺口 */}
                            <span className="absolute -left-[2px] top-1/2 -translate-y-1/2 w-2 h-4 bg-[#efece3] border-2 border-black rounded-full -ml-2" />
                            <div className="flex items-center gap-3">
                                <button onClick={() => redial(log)} className="flex items-center gap-3 flex-1 min-w-0 text-left active:translate-x-px active:translate-y-px transition-transform">
                                    <div className="w-8 h-8 border-2 border-black flex items-center justify-center shrink-0 bg-white">
                                        <Icon size={16} weight="bold" className="text-black" />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className={`text-sm font-serif font-bold truncate text-black ${missed ? 'line-through decoration-1' : ''}`}>{log.name}</div>
                                        <div className="text-[11px] text-neutral-500 mt-0.5 font-mono">
                                            <span className="uppercase tracking-widest">{label}</span>
                                            {log.name !== log.number && <span> · {log.number}</span>}
                                            {log.durationSec > 0 && <span> · {formatDuration(log.durationSec)}</span>}
                                        </div>
                                    </div>
                                    <div className="text-[10px] text-neutral-500 shrink-0 font-mono text-right leading-tight">{formatLogTime(log.timestamp)}</div>
                                </button>
                                <button onClick={() => deleteLog(log)} className="p-1.5 text-black/40 hover:text-black active:scale-90 transition" title="撕掉这张存根">
                                    <Trash size={15} weight="bold" />
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );

    const renderDialPad = () => (
        <div className="flex-1 min-h-0 flex flex-col">
            {/* 号码显示区 — 仿账本横线 */}
            <div className="flex-1 flex flex-col items-center justify-end px-6 pb-3 min-h-[88px]">
                <div className="w-full max-w-[280px] border-b-2 border-black pb-1.5 text-center">
                    <div className="text-3xl font-serif text-black tracking-[0.15em] tabular-nums break-all min-h-[40px] flex items-center justify-center">
                        {formatDialDisplay(dialInput) || <span className="text-black/30 text-lg font-mono tracking-widest">拨个号码</span>}
                    </div>
                </div>
                <div className="h-5 mt-2 text-xs font-mono text-black">
                    {dialMatchedChar ? `↗ 接通 · ${dialMatchedChar.name}` : ''}
                </div>
            </div>
            {/* 键盘 */}
            <div className="px-7 pb-3">
                <div className="grid grid-cols-3 gap-x-5 gap-y-3 justify-items-center">
                    {DIAL_KEYS.map(({ key, sub }) => (
                        key === '0' ? (
                            <button
                                key={key}
                                onPointerDown={handleZeroDown}
                                onPointerUp={handleZeroUp}
                                onPointerLeave={handleZeroCancel}
                                onContextMenu={e => e.preventDefault()}
                                className="w-[64px] h-[64px] border-2 border-black bg-white flex flex-col items-center justify-center active:translate-x-px active:translate-y-px transition-transform select-none touch-none"
                                style={{ boxShadow: '3px 3px 0 #000' }}
                            >
                                <span className="text-2xl font-serif text-black leading-none">0</span>
                                <span className="text-[10px] text-neutral-500 mt-0.5 tracking-widest font-mono">+</span>
                            </button>
                        ) : (
                            <button
                                key={key}
                                onClick={() => appendKey(key)}
                                className="w-[64px] h-[64px] border-2 border-black bg-white flex flex-col items-center justify-center active:translate-x-px active:translate-y-px transition-transform select-none"
                                style={{ boxShadow: '3px 3px 0 #000' }}
                            >
                                <span className="text-2xl font-serif text-black leading-none">{key}</span>
                                <span className="text-[10px] text-neutral-500 mt-0.5 tracking-widest h-[12px] font-mono">{sub}</span>
                            </button>
                        )
                    ))}
                </div>
                {/* 拨号 / 退格行 — 退格挪到左、拨号居中、占位在右，与原版镜像 */}
                <div className="grid grid-cols-3 gap-x-5 justify-items-center items-center mt-3">
                    <button
                        onClick={() => setDialInput(prev => prev.slice(0, -1))}
                        onContextMenu={e => { e.preventDefault(); setDialInput(''); }}
                        disabled={!dialInput}
                        className="w-12 h-12 flex items-center justify-center text-black disabled:opacity-0 active:scale-90 transition"
                        title="退格（长按清空）"
                    >
                        <Backspace size={26} weight="bold" />
                    </button>
                    <button
                        onClick={() => handleDial()}
                        className="w-[64px] h-[64px] border-2 border-black bg-black text-white flex items-center justify-center active:translate-x-px active:translate-y-px transition-transform"
                        style={{ boxShadow: '3px 3px 0 #000' }}
                        title="拨号"
                    >
                        <Phone size={26} weight="fill" />
                    </button>
                    <div />
                </div>
            </div>
        </div>
    );

    const renderRecordings = () => (
        <div className="flex-1 overflow-y-auto min-h-0 px-4 py-4">
            {!recordingsLoaded && (
                <div className="flex items-center justify-center py-20">
                    <div className="w-6 h-6 border-2 border-black border-t-transparent rounded-full animate-spin" />
                </div>
            )}
            {recordingsLoaded && !recordings.length && (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                    <div className="border-2 border-dashed border-black p-5 -rotate-2 bg-white" style={{ boxShadow: '3px 3px 0 #000' }}>
                        <VinylRecord size={30} className="text-black" />
                    </div>
                    <p className="text-sm font-serif font-bold text-black mt-4">还没有留声片</p>
                    <p className="text-xs text-neutral-500 mt-1.5">通一次话，逐字稿会自动压成一张唱片</p>
                </div>
            )}
            <div className="space-y-3.5">
                {recordings.map((rec, i) => {
                    const expanded = expandedSessionId === rec.sessionId;
                    return (
                        <div key={`${rec.charId}-${rec.sessionId}`} className={`relative bg-white border-2 border-black ${i % 2 ? 'rotate-[0.4deg]' : '-rotate-[0.4deg]'}`} style={{ boxShadow: '3px 3px 0 #000' }}>
                            <button
                                onClick={() => { setExpandedSessionId(expanded ? null : rec.sessionId); if (expanded) stopPlayback(); }}
                                className="w-full flex items-center gap-3.5 px-3.5 py-3 text-left active:translate-x-px active:translate-y-px transition-transform"
                            >
                                <Avatar name={rec.charName} src={rec.charAvatar} sizeClass="w-11 h-11 text-sm" tilt={i % 2 ? 'rotate-2' : '-rotate-2'} />
                                <div className="min-w-0 flex-1">
                                    <div className="text-sm font-serif font-bold text-black truncate">{rec.charName}</div>
                                    <div className="text-[11px] text-neutral-500 mt-0.5 font-mono">
                                        {new Date(rec.startTs).toLocaleString('zh-CN')} · {formatDuration(rec.durationSec)} · {rec.lines.length} 句
                                    </div>
                                </div>
                                <div className="w-7 h-7 border-2 border-black flex items-center justify-center shrink-0">
                                    {expanded ? <CaretUp size={14} weight="bold" className="text-black" /> : <CaretDown size={14} weight="bold" className="text-black" />}
                                </div>
                            </button>
                            {expanded && (
                                <div className="border-t-2 border-dashed border-black px-3.5 py-3 space-y-2.5">
                                    {rec.lines.map(line => (
                                        <div key={line.id} className={`border border-black px-3 py-2 bg-white ${line.role === 'user' ? 'ml-6' : 'mr-6'}`} style={{ boxShadow: line.role === 'user' ? '-2px 2px 0 rgba(27,26,23,0.18)' : '2px 2px 0 rgba(27,26,23,0.18)' }}>
                                            <div className="text-[10px] text-neutral-500 font-mono uppercase tracking-wider">{line.role === 'user' ? '我' : rec.charName} · {line.time}</div>
                                            <div className="text-[13px] text-black mt-1 leading-relaxed whitespace-pre-wrap">{line.text}</div>
                                            {!!line.audioUrl && (
                                                <button
                                                    onClick={() => playLine(line.id, line.audioUrl)}
                                                    className={`mt-2 inline-flex items-center gap-1 text-[11px] px-2 py-0.5 border-2 border-black font-mono transition active:scale-95 ${playingLineId === line.id ? 'bg-black text-white' : 'bg-white text-black'}`}
                                                >
                                                    {playingLineId === line.id ? <><Pause size={11} weight="fill" /> 停</> : <><Play size={11} weight="fill" /> 放</>}
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

    // 索引标签（顶部贴纸式分页），原底部 Tab 栏整体上移并重排顺序
    const TABS: { id: PhoneTab; label: string; Icon: PhosphorIcon }[] = [
        { id: 'dial', label: '拨号盘', Icon: GridNine },
        { id: 'logs', label: '存根', Icon: Receipt },
        { id: 'contacts', label: '名片夹', Icon: AddressBook },
        { id: 'recordings', label: '留声片', Icon: VinylRecord },
    ];

    return (
        <div className="h-full w-full flex flex-col relative overflow-hidden" style={{ background: PAPER_BG, color: INK }}>
            {/* 顶部封面条 */}
            <div className="shrink-0 px-4 pt-3 pb-2 border-b-2 border-black bg-[#efece3] z-10">
                <div className="flex items-center gap-2">
                    <button onClick={closeApp} className="w-9 h-9 border-2 border-black bg-white flex items-center justify-center active:translate-x-px active:translate-y-px transition-transform" style={{ boxShadow: '2px 2px 0 #000' }} title="收起">
                        <span className="text-lg font-serif leading-none text-black">‹</span>
                    </button>
                    <div className="flex-1 flex items-center gap-2">
                        <h1 className="text-xl font-serif font-black tracking-[0.15em] text-black">回声亭</h1>
                        <Postmark className="-rotate-3 bg-white">tel</Postmark>
                    </div>
                    {tab === 'logs' && !!logs.length && (
                        <button onClick={() => setConfirmClearAll(true)} className="text-[11px] font-mono text-black underline decoration-dashed underline-offset-2 px-1 py-1 active:scale-95 transition">清空存根</button>
                    )}
                    {/* 语音通话已整合进回声亭：从这里进入实时语音通话（选角色 / 语音通话记录） */}
                    <button
                        onClick={() => openApp(AppID.Call)}
                        className="flex items-center gap-1.5 px-3 py-1.5 border-2 border-black bg-black text-white text-xs font-mono uppercase tracking-wider active:translate-x-px active:translate-y-px transition-transform"
                        style={{ boxShadow: '2px 2px 0 rgba(27,26,23,0.35)' }}
                    >
                        <Waveform size={14} weight="bold" />
                        拨通
                    </button>
                </div>

                {/* 索引标签行 */}
                <div className="flex items-end gap-1.5 mt-3 -mb-2.5">
                    {TABS.map(({ id, label, Icon }, i) => {
                        const active = tab === id;
                        return (
                            <button
                                key={id}
                                onClick={() => switchTab(id)}
                                className={`relative flex items-center gap-1.5 px-3 pt-1.5 pb-2 border-2 border-black border-b-0 transition-transform ${active ? 'bg-black text-white -translate-y-0.5' : 'bg-white text-black'} ${i % 2 ? 'rotate-[0.5deg]' : '-rotate-[0.5deg]'}`}
                            >
                                <Icon size={15} weight={active ? 'fill' : 'bold'} />
                                <span className="text-[11px] font-mono tracking-wide">{label}</span>
                                {id === 'logs' && missedBadge > 0 && (
                                    <span className="absolute -top-2 -right-2 min-w-[16px] h-4 px-1 border-2 border-black bg-white text-black text-[9px] font-bold flex items-center justify-center rotate-6">
                                        {missedBadge > 9 ? '9+' : missedBadge}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* 内容区（顶在索引标签下，露出标签底边） */}
            <div className="flex-1 min-h-0 flex flex-col border-t-2 border-black bg-[#efece3]">
                {tab === 'contacts' && renderContacts()}
                {tab === 'logs' && renderLogs()}
                {tab === 'dial' && renderDialPad()}
                {tab === 'recordings' && renderRecordings()}
            </div>

            {/* 拨打陌生号码：假呼叫全屏态 */}
            {outgoingNumber && (
                <div className="absolute inset-0 z-50 flex flex-col items-center justify-between pt-24 pb-16" style={{ background: INK, color: '#efece3' }}>
                    {/* 报纸网点纹理 */}
                    <div className="absolute inset-0 opacity-20 pointer-events-none" style={{ backgroundImage: 'radial-gradient(#efece3 1px, transparent 1px)', backgroundSize: '8px 8px' }} />
                    <div className="flex flex-col items-center relative">
                        <div className="w-24 h-24 border-2 border-[#efece3] flex items-center justify-center -rotate-3">
                            <Phone size={38} className="text-[#efece3]" />
                        </div>
                        <div className="mt-6 text-2xl font-serif tracking-[0.2em] tabular-nums text-center px-6 break-all">{formatDialDisplay(outgoingNumber)}</div>
                        <div className="mt-3 text-sm font-mono uppercase tracking-[0.3em] animate-pulse">正在接通…</div>
                    </div>
                    <button
                        onClick={() => endFakeOutgoing(false)}
                        className="w-16 h-16 border-2 border-[#efece3] bg-[#efece3] flex items-center justify-center active:scale-95 transition relative"
                        title="挂断"
                    >
                        <PhoneDisconnect size={28} weight="fill" className="text-black" />
                    </button>
                </div>
            )}

            {/* 模拟来电全屏态 */}
            {incomingChar && (
                <div className="absolute inset-0 z-50 flex flex-col items-center justify-between pt-20 pb-14" style={{ background: INK, color: '#efece3' }}>
                    <div className="absolute inset-0 opacity-20 pointer-events-none" style={{ backgroundImage: 'radial-gradient(#efece3 1px, transparent 1px)', backgroundSize: '8px 8px' }} />
                    <div className="flex flex-col items-center relative">
                        <Postmark className="border-[#efece3] mb-6 animate-pulse">incoming</Postmark>
                        <div className="relative">
                            <span className="absolute -inset-2 border-2 border-dashed border-[#efece3]/40 animate-ping" />
                            <Avatar name={incomingChar.name} src={incomingChar.avatar} sizeClass="w-28 h-28 text-4xl" tilt="-rotate-2" />
                        </div>
                        <div className="mt-6 text-2xl font-serif font-bold">{incomingChar.name}</div>
                        <div className="mt-1.5 text-sm font-mono tracking-wider opacity-70">{charPhoneNumber(incomingChar.id)}</div>
                        <div className="mt-3 text-sm font-mono uppercase tracking-[0.3em] animate-pulse">铃铃铃…</div>
                    </div>
                    <div className="w-full px-14 flex items-center justify-between relative">
                        <div className="flex flex-col items-center gap-2">
                            <button
                                onClick={() => declineIncoming(false)}
                                className="w-16 h-16 border-2 border-[#efece3] bg-transparent flex items-center justify-center active:scale-95 transition"
                            >
                                <PhoneDisconnect size={28} weight="fill" className="text-[#efece3]" />
                            </button>
                            <span className="text-xs font-mono uppercase tracking-widest">不接</span>
                        </div>
                        <div className="flex flex-col items-center gap-2">
                            <button
                                onClick={acceptIncoming}
                                className="w-16 h-16 border-2 border-[#efece3] bg-[#efece3] flex items-center justify-center active:scale-95 transition animate-bounce"
                            >
                                <Phone size={28} weight="fill" className="text-black" />
                            </button>
                            <span className="text-xs font-mono uppercase tracking-widest">接起</span>
                        </div>
                    </div>
                </div>
            )}

            {/* 清空全部确认 */}
            <ConfirmDialog
                isOpen={confirmClearAll}
                title="撕掉全部存根"
                message="所有通话存根会被永久撕掉（留声片与逐字稿不受影响）。确定吗？"
                variant="danger"
                confirmText="全撕掉"
                onConfirm={clearAllLogs}
                onCancel={() => setConfirmClearAll(false)}
            />
        </div>
    );
};

export default PhoneApp;
