import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MoonStars, Microphone, SpeakerHigh, SpeakerSlash, Play, Trash, PhoneDisconnect, ChatTeardropText, PaperPlaneRight, Bed } from '@phosphor-icons/react';
import { useOS } from '../../context/OSContext';
import type { CharacterProfile, TheaterSleepChannel, TheaterSleepSession, TheaterSleepTurn } from '../../types';
import { DB } from '../../utils/db';
import { resolveAuxApi } from '../../utils/auxApi';
import { generateSleepOpening, generateSleepReply } from '../../utils/theaterSleep';
import { synthesizeSpeech, cleanTextForTts } from '../../utils/minimaxTts';
import { resolveMiniMaxApiKey } from '../../utils/minimaxApiKey';
import { useVoiceRecorder } from '../../components/chat/useVoiceRecorder';
import { PaperShell, ScrapScroll, ScrapHeader, Polaroid, PaperCard, ScrapButton, SectionTag, Stamp, INK, INK_SOFT } from '../ui/insScrapKit';

interface Props { onExit: () => void; }

const genId = () => `sleep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const formatTime = (ts: number) => new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
const formatDay = (ts: number) => new Date(ts).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
const titleFor = (intention?: string) => (intention?.trim() ? intention.trim().slice(0, 18) : '一起入眠');

const canUseVoice = (char: CharacterProfile | undefined, apiConfig: any) => {
    if (!char || !resolveMiniMaxApiKey(apiConfig)) return false;
    return !!(char.voiceProfile?.voiceId || (char.voiceProfile?.timberWeights?.length || 0) > 0);
};

const SleepTogetherApp: React.FC<Props> = ({ onExit }) => {
    const { characters, apiConfig, auxApiConfig, userProfile, addToast } = useOS();
    const api = resolveAuxApi(auxApiConfig, apiConfig);
    const apiReady = !!(api.baseUrl && api.model);

    const [view, setView] = useState<'pick' | 'sleep'>('pick');
    const [history, setHistory] = useState<TheaterSleepSession[]>([]);
    const [pickCharId, setPickCharId] = useState('');
    const [channel, setChannel] = useState<TheaterSleepChannel>('text');
    const [intention, setIntention] = useState('');
    const [session, setSession] = useState<TheaterSleepSession | null>(null);
    const [input, setInput] = useState('');
    const [busy, setBusy] = useState(false);
    const [speakerOn, setSpeakerOn] = useState(true);
    const [ttsBusy, setTtsBusy] = useState(false);
    const [audioUrl, setAudioUrl] = useState('');
    const [lastSpokenText, setLastSpokenText] = useState('');
    const scrollRef = useRef<HTMLDivElement>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const blobUrlRef = useRef<string>('');

    const selectedChar = useMemo(() => characters.find(c => c.id === pickCharId), [characters, pickCharId]);
    const activeChar = useMemo(() => characters.find(c => c.id === session?.charId), [characters, session?.charId]);
    const voiceReady = canUseVoice(selectedChar, apiConfig);

    const reload = async () => setHistory(await DB.getAllTheaterSleepSessions().catch(() => []));
    useEffect(() => { void reload(); }, []);
    useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [session?.turns, busy]);
    useEffect(() => () => {
        if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    }, []);

    const persist = async (next: TheaterSleepSession) => {
        setSession(next);
        await DB.saveTheaterSleepSession(next).catch(() => {});
        void reload();
    };

    const playAudio = (url = audioUrl) => {
        if (!url || !audioRef.current) return;
        audioRef.current.src = url;
        audioRef.current.currentTime = 0;
        audioRef.current.play().catch(() => addToast('音频已生成，浏览器拦截了自动播放，点重播就好', 'info'));
    };

    const speak = async (text: string, char?: CharacterProfile, channelOverride: TheaterSleepChannel = session?.channel || 'text') => {
        if (!speakerOn || !char || channelOverride !== 'voice') return;
        setLastSpokenText(text);
        if (!canUseVoice(char, apiConfig)) {
            addToast('语音还没配好，先用文字陪你睡', 'info');
            return;
        }
        setTtsBusy(true);
        try {
            const url = await synthesizeSpeech(cleanTextForTts(text), char, apiConfig);
            if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
            blobUrlRef.current = url.startsWith('blob:') ? url : '';
            setAudioUrl(url);
            window.setTimeout(() => playAudio(url), 0);
        } catch (e: any) {
            addToast(`语音生成失败：${e?.message || '已保留文字'}`, 'info');
        } finally {
            setTtsBusy(false);
        }
    };

    const startSession = async () => {
        const char = selectedChar;
        if (!char) { addToast('先选一个今晚陪你的人吧', 'info'); return; }
        if (!apiReady) { addToast('还没配置 API，去「文具盒」填好再来', 'error'); return; }
        const effectiveChannel: TheaterSleepChannel = channel === 'voice' && !voiceReady ? 'text' : channel;
        if (channel === 'voice' && !voiceReady) addToast('这位角色还不能出声，先用文字连着', 'info');
        const now = Date.now();
        const s: TheaterSleepSession = {
            id: genId(),
            charId: char.id,
            title: titleFor(intention),
            status: 'active',
            channel: effectiveChannel,
            intention: intention.trim() || undefined,
            turns: [],
            createdAt: now,
            lastActiveAt: now,
        };
        setSession(s);
        setView('sleep');
        setBusy(true);
        try {
            const opening = await generateSleepOpening(char, userProfile, api, effectiveChannel, s.intention);
            const turns: TheaterSleepTurn[] = opening ? [{ role: 'char', text: opening, at: Date.now() }] : [];
            const next = { ...s, turns, lastActiveAt: Date.now() };
            await persist(next);
            if (opening) void speak(opening, char, effectiveChannel);
        } catch (e: any) {
            addToast(`接通失败：${e?.message || e}`, 'error');
        } finally {
            setBusy(false);
        }
    };

    const resume = (s: TheaterSleepSession) => {
        setSession({ ...s, turns: s.turns || [], status: s.status || 'active', channel: s.channel || 'text' });
        setAudioUrl('');
        setLastSpokenText('');
        setView('sleep');
    };

    const send = async (override?: string, inputMode: 'text' | 'voice' = 'text') => {
        const text = (override ?? input).trim();
        if (!text || busy || !session) return;
        const char = characters.find(c => c.id === session.charId);
        if (!char) return;
        if (!apiReady) { addToast('还没配置 API，去「文具盒」填好再来', 'error'); return; }
        setInput('');
        if (audioRef.current) audioRef.current.pause();
        const withUser: TheaterSleepSession = {
            ...session,
            status: 'active',
            turns: [...session.turns, { role: 'user', text, at: Date.now(), inputMode }],
            title: session.turns.some(t => t.role === 'user') ? session.title : titleFor(text),
            lastActiveAt: Date.now(),
        };
        await persist(withUser);
        setBusy(true);
        try {
            const reply = await generateSleepReply(char, userProfile, api, withUser.channel, withUser.turns, text, withUser.intention);
            if (reply) {
                const next: TheaterSleepSession = {
                    ...withUser,
                    turns: [...withUser.turns, { role: 'char', text: reply, at: Date.now() }],
                    lastActiveAt: Date.now(),
                };
                await persist(next);
                void speak(reply, char, next.channel);
            }
        } catch (e: any) {
            addToast(`回应失败：${e?.message || e}`, 'error');
        } finally {
            setBusy(false);
        }
    };

    const voice = useVoiceRecorder({
        maxSecs: 45,
        onDenied: () => addToast('麦克风没有授权，先打字也可以', 'info'),
        onComplete: (_audio, _durationSec, transcript) => {
            const text = transcript.trim();
            if (!text) { addToast('这段语音没有识别出文字，先在下方打字吧', 'info'); return; }
            void send(text, 'voice');
        },
    });

    const endSession = async () => {
        if (!session) return;
        const now = Date.now();
        await persist({ ...session, status: 'ended', endedAt: now, lastActiveAt: now });
        addToast('这段入眠记录收好了', 'success');
    };

    const removeSession = async (id: string) => {
        await DB.deleteTheaterSleepSession(id);
        if (session?.id === id) { setSession(null); setView('pick'); }
        await reload();
    };

    if (view === 'sleep' && session) {
        const char = activeChar;
        return (
            <PaperShell>
                <div className="relative z-20 shrink-0 px-3.5 pt-3 pb-2">
                    <div className="flex items-center justify-between gap-2">
                        <ScrapButton variant="paper" className="px-3 py-1.5 text-[11px]" onClick={() => { setView('pick'); void reload(); }}>收起</ScrapButton>
                        <div className="text-center min-w-0">
                            <div className="text-[15px] font-black truncate" style={{ color: INK }}>{char?.name || '某人'} · 一起入眠</div>
                            <div className="text-[9px] tracking-[0.18em]" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>{session.channel === 'voice' ? 'VOICE LINE' : 'TEXT LINE'}</div>
                        </div>
                        <ScrapButton variant={session.status === 'ended' ? 'paper' : 'ink'} className="px-3 py-1.5 text-[11px]" onClick={endSession} disabled={session.status === 'ended'} icon={<PhoneDisconnect size={13} weight="bold" />}>
                            {session.status === 'ended' ? '已入眠' : '结束'}
                        </ScrapButton>
                    </div>
                </div>

                <ScrapScroll innerRef={scrollRef} className="px-4 pb-32 pt-1">
                    <PaperCard className="px-4 py-3 mb-4" tilt={-0.4}>
                        <div className="flex items-start gap-3">
                            <Stamp size={40}><MoonStars size={21} weight="duotone" /></Stamp>
                            <div className="min-w-0 flex-1">
                                <div className="text-[13px] font-black" style={{ color: INK }}>{session.title}</div>
                                <div className="text-[11px] mt-1 leading-relaxed" style={{ color: '#6b6558' }}>
                                    {session.intention || '今晚就慢慢安静下来。'}{session.status === 'ended' ? ' · 已结束' : ''}
                                </div>
                            </div>
                        </div>
                    </PaperCard>

                    <div className="space-y-3">
                        {session.turns.map((turn, i) => {
                            const mine = turn.role === 'user';
                            return (
                                <div key={`${turn.at}-${i}`} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                                    <div className={`max-w-[82%] px-3.5 py-2.5 rounded-[16px] border ${mine ? 'bg-[#1f1d1a] text-[#f6f3ec] border-[#1f1d1a]' : 'bg-white/80 text-[#1f1d1a] border-[rgba(176,170,158,0.75)]'}`}>
                                        <div className="text-[9px] mb-1 opacity-65">{mine ? (turn.inputMode === 'voice' ? '我 · 语音转文字' : '我') : char?.name || 'TA'} · {formatTime(turn.at)}</div>
                                        <div className="text-[13px] leading-relaxed whitespace-pre-wrap break-words">{turn.text}</div>
                                    </div>
                                </div>
                            );
                        })}
                        {busy && (
                            <div className="text-[12px] px-3 py-2 rounded-[14px] inline-flex" style={{ background: 'rgba(255,253,247,0.82)', color: INK_SOFT }}>正在轻声回应…</div>
                        )}
                    </div>
                </ScrapScroll>

                <div className="absolute left-0 right-0 bottom-0 z-30 px-4 pb-[calc(var(--safe-bottom)+0.75rem)] pt-3" style={{ background: 'linear-gradient(180deg, rgba(239,236,227,0), rgba(239,236,227,0.96) 26%, rgba(239,236,227,1))' }}>
                    {voice.isRecording && (
                        <div className="mb-2 rounded-[16px] px-3 py-2 text-center text-[12px]" style={{ background: '#1f1d1a', color: '#f6f3ec' }}>
                            录音中 {voice.recordSecs}s{voice.liveTranscript ? ` · ${voice.liveTranscript}` : ' · 说完点发送'}
                        </div>
                    )}
                    <div className="flex items-end gap-2 rounded-[20px] p-2" style={{ background: 'rgba(255,253,247,0.92)', border: '1px solid rgba(176,170,158,0.72)', boxShadow: '0 -10px 22px -20px rgba(31,29,26,0.5)' }}>
                        <button
                            onClick={() => voice.isRecording ? voice.stopRecording(true) : void voice.startRecording()}
                            disabled={busy || session.status === 'ended'}
                            className={`w-10 h-10 rounded-full shrink-0 inline-flex items-center justify-center active:scale-95 disabled:opacity-40 ${voice.isRecording ? 'bg-[#1f1d1a] text-[#f6f3ec]' : 'bg-white text-[#1f1d1a]'}`}
                            style={{ border: '1px solid rgba(31,29,26,0.35)' }}
                            title={voice.isRecording ? '发送录音转写' : '录一段语音'}
                        >
                            <Microphone size={18} weight="bold" />
                        </button>
                        <textarea
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            disabled={busy || session.status === 'ended'}
                            rows={1}
                            placeholder={session.status === 'ended' ? '这段已经收好啦' : '轻轻说一句…'}
                            className="flex-1 min-h-[40px] max-h-24 bg-transparent resize-none outline-none px-1 py-2 text-[13px] leading-relaxed placeholder:text-neutral-400"
                        />
                        {session.channel === 'voice' && (
                            <button
                                onClick={() => {
                                    const next = !speakerOn;
                                    setSpeakerOn(next);
                                    if (!next) audioRef.current?.pause();
                                }}
                                className={`w-10 h-10 rounded-full shrink-0 inline-flex items-center justify-center active:scale-95 ${speakerOn ? 'bg-white text-[#1f1d1a]' : 'bg-[#1f1d1a] text-[#f6f3ec]'}`}
                                style={{ border: '1px solid rgba(31,29,26,0.35)' }}
                                title={speakerOn ? '静音' : '开声'}
                            >
                                {speakerOn ? <SpeakerHigh size={18} weight="bold" /> : <SpeakerSlash size={18} weight="bold" />}
                            </button>
                        )}
                        {session.channel === 'voice' && audioUrl && (
                            <button
                                onClick={() => playAudio()}
                                disabled={ttsBusy || !lastSpokenText}
                                className="w-10 h-10 rounded-full shrink-0 inline-flex items-center justify-center active:scale-95 disabled:opacity-40 bg-white text-[#1f1d1a]"
                                style={{ border: '1px solid rgba(31,29,26,0.35)' }}
                                title="重播"
                            >
                                <Play size={17} weight="fill" />
                            </button>
                        )}
                        <button
                            onClick={() => void send()}
                            disabled={busy || session.status === 'ended' || !input.trim()}
                            className="w-10 h-10 rounded-full shrink-0 inline-flex items-center justify-center active:scale-95 disabled:opacity-40 bg-[#1f1d1a] text-[#f6f3ec]"
                            title="发送"
                        >
                            <PaperPlaneRight size={18} weight="fill" />
                        </button>
                    </div>
                    <audio ref={audioRef} muted={!speakerOn} />
                </div>
            </PaperShell>
        );
    }

    return (
        <PaperShell>
            <ScrapHeader title="一起入眠" en="SLEEP TOGETHER" onBack={onExit} backLabel="回戏单" />
            <ScrapScroll className="px-5 pb-12 pt-1">
                <PaperCard tilt={-0.6} className="px-5 py-5 mt-2">
                    <div className="flex items-start gap-3">
                        <Stamp size={46}><Bed size={24} weight="duotone" /></Stamp>
                        <div className="min-w-0 flex-1">
                            <div className="text-[24px] font-black" style={{ color: INK }}>今晚连着睡</div>
                            <div className="text-[12px] mt-1.5 leading-relaxed" style={{ color: '#5b554a' }}>选一个人陪你把一天慢慢放下。可文字，也可让 TA 的回复自动朗读出来。</div>
                        </div>
                    </div>
                </PaperCard>

                <SectionTag en="CAST" className="mt-6 mb-3">今晚陪你的人</SectionTag>
                <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2">
                    {characters.map((c, i) => (
                        <Polaroid key={c.id} src={c.avatar} caption={c.name} selected={pickCharId === c.id} rotate={(i % 3 - 1) * 2} size={62} onClick={() => {
                            setPickCharId(c.id);
                            if (canUseVoice(c, apiConfig)) setChannel('voice');
                        }} />
                    ))}
                    {characters.length === 0 && (
                        <PaperCard className="px-4 py-4 min-w-full">
                            <div className="text-[13px] font-black" style={{ color: INK }}>还没有可登场角色</div>
                            <div className="text-[11px] mt-1" style={{ color: INK_SOFT }}>先去剪影集创建角色，再回来一起入眠。</div>
                        </PaperCard>
                    )}
                </div>

                <SectionTag en="LINE" className="mt-5 mb-3">连接方式</SectionTag>
                <div className="grid grid-cols-2 gap-3">
                    {([
                        { id: 'voice' as TheaterSleepChannel, title: '语音连着', note: voiceReady ? 'TA 会自动朗读回复' : '未配语音时会退回文字', Icon: SpeakerHigh },
                        { id: 'text' as TheaterSleepChannel, title: '文字连着', note: '安静看几句睡前消息', Icon: ChatTeardropText },
                    ]).map(item => {
                        const on = channel === item.id;
                        return (
                            <button key={item.id} onClick={() => setChannel(item.id)} className="text-left active:scale-[0.98] transition-transform">
                                <PaperCard className="px-3.5 py-3 h-full" style={on ? { background: '#1f1d1a', color: '#f6f3ec' } : undefined}>
                                    <div className="flex items-center gap-2">
                                        <item.Icon size={19} weight="duotone" />
                                        <div className="text-[13px] font-black">{item.title}</div>
                                    </div>
                                    <div className="text-[10.5px] mt-1.5 leading-relaxed" style={{ color: on ? 'rgba(246,243,236,0.76)' : INK_SOFT }}>{item.note}</div>
                                </PaperCard>
                            </button>
                        );
                    })}
                </div>

                <SectionTag en="NOTE" className="mt-6 mb-3">睡前纸条</SectionTag>
                <textarea
                    value={intention}
                    onChange={e => setIntention(e.target.value)}
                    className="w-full min-h-[88px] rounded-[18px] px-4 py-3 text-[13px] leading-relaxed outline-none resize-none"
                    style={{ background: 'rgba(255,253,247,0.82)', border: '1px solid rgba(176,170,158,0.68)', color: INK }}
                    placeholder="比如：今天有点累，想听你轻轻说会儿话。"
                />

                <ScrapButton variant="ink" className="w-full mt-4 py-3 text-[13px]" onClick={startSession} disabled={!apiReady || !pickCharId} icon={<MoonStars size={16} weight="fill" />}>
                    接通今晚
                </ScrapButton>
                {!apiReady && <div className="text-[11px] mt-2 text-center" style={{ color: INK_SOFT }}>还没配置 API，去文具盒填好后再来。</div>}

                <SectionTag en="ARCHIVE" className="mt-8 mb-3">入眠记录</SectionTag>
                <div className="space-y-3">
                    {history.length === 0 ? (
                        <PaperCard className="px-4 py-4 flex items-start gap-3">
                            <Stamp size={38}><MoonStars size={19} weight="duotone" /></Stamp>
                            <div>
                                <div className="text-[13px] font-black" style={{ color: INK }}>还没有睡前记录</div>
                                <div className="text-[11px] mt-1" style={{ color: INK_SOFT }}>接通一次后，文字转写会留在这里。</div>
                            </div>
                        </PaperCard>
                    ) : history.map((s, i) => {
                        const c = characters.find(char => char.id === s.charId);
                        return (
                            <PaperCard key={s.id} tilt={i % 2 ? 0.35 : -0.35} className="px-3.5 py-3 flex items-center gap-3">
                                <Stamp size={38}><MoonStars size={19} weight="duotone" /></Stamp>
                                <button onClick={() => resume(s)} className="flex-1 min-w-0 text-left">
                                    <div className="text-[13px] font-black truncate" style={{ color: INK }}>{c?.name || '某人'} · {s.title}</div>
                                    <div className="text-[10.5px] mt-0.5 truncate" style={{ color: INK_SOFT }}>{s.turns?.length || 0} 句 · {s.status === 'ended' ? '已入眠' : '可继续'} · {formatDay(s.lastActiveAt)}</div>
                                </button>
                                <button onClick={() => void removeSession(s.id)} className="p-2 active:scale-95" title="删除"><Trash size={15} weight="bold" style={{ color: INK_SOFT }} /></button>
                            </PaperCard>
                        );
                    })}
                </div>
            </ScrapScroll>
        </PaperShell>
    );
};

export default SleepTogetherApp;
