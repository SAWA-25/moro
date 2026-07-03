import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useOS } from '../context/OSContext';
import { VideoCamera, VideoCameraSlash, Microphone, MicrophoneSlash, PhoneX, CameraRotate, PaperPlaneRight, Minus } from '@phosphor-icons/react';
import { extractContent } from '../utils/safeApi';
import { callChatCompletion } from '../utils/llmClient';
import { makeApiUsageMeta } from '../utils/apiUsageCatalog';
import { ContextBuilder } from '../utils/context';
import { synthesizeSpeechDetailed, cleanTextForTts } from '../utils/minimaxTts';
import { resolveMiniMaxApiKey } from '../utils/minimaxApiKey';
import { videoCallPromptBody } from '../utils/laiwangPrompts';
import { DB } from '../utils/db';
import { AppID } from '../types';

/**
 * 视频通话 —— 从聊天发起的视频通话页。
 *  - 角色侧：用「通话立绘」(convoSettings.callSprites['默认']) / 立绘 / 头像作为对方画面。
 *  - 用户侧：默认不开摄像头，可自选开/关（「只开一下就关了」），可翻转前后置；调 getUserMedia，
 *    关掉即停轨（摄像头灯熄灭）。麦克风为通话静音指示。
 *  - 挂断 / 离开即停掉所有摄像头轨道。
 */

const fmt = (s: number): string => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
type VideoChatLine = { id: string; role: 'user' | 'char'; text: string; timestamp: number };

const charPhoneNumber = (charId: string): string => {
    let hash = 0;
    for (let i = 0; i < charId.length; i++) hash = (hash * 31 + charId.charCodeAt(i)) >>> 0;
    const digits = String(hash % 100000000).padStart(8, '0');
    return `010-${digits.slice(0, 4)}-${digits.slice(4)}`;
};

const summarizeKeepsakeLine = (lines: VideoChatLine[], charName: string) => {
    const charLine = [...lines].reverse().find(item => item.role === 'char' && item.text.trim());
    if (!charLine) return `这通视频我会悄悄收藏，下次也记得来找我。 —— ${charName}`;
    const normalized = charLine.text.replace(/\s+/g, ' ').trim();
    const cutAt = normalized.search(/[。！？!?]/);
    const sentence = cutAt >= 0 ? normalized.slice(0, cutAt + 1) : normalized.slice(0, 42);
    const polished = sentence.length > 48 ? `${sentence.slice(0, 48)}...` : sentence;
    return `“${polished}” —— ${charName}`;
};

const VideoCallApp: React.FC = () => {
    const { activeApp, closeApp, characters, activeCharacterId, userProfile, addToast, apiConfig, suspendedVideoCall, suspendVideoCall, clearSuspendedVideoCall } = useOS();
    const char = useMemo(() => characters.find(c => c.id === activeCharacterId) || null, [characters, activeCharacterId]);

    const [secs, setSecs] = useState(0);
    const [camOn, setCamOn] = useState(false);
    const [micOn, setMicOn] = useState(true);
    const [facing, setFacing] = useState<'user' | 'environment'>('user');
    const [chatLines, setChatLines] = useState<VideoChatLine[]>([]);
    const [textInput, setTextInput] = useState('');
    const [replying, setReplying] = useState(false);
    const [isSuspended, setIsSuspended] = useState(false);
    const streamRef = useRef<MediaStream | null>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const chatLinesRef = useRef<VideoChatLine[]>([]);
    const secsRef = useRef(0);
    const endedRef = useRef(false);
    const suspendedRef = useRef(false);
    const sessionIdRef = useRef(`video-call-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);

    // 通话计时
    useEffect(() => {
        const t = setInterval(() => {
            if (!endedRef.current && !suspendedRef.current) setSecs(s => s + 1);
        }, 1000);
        return () => clearInterval(t);
    }, []);
    // 离开时停掉摄像头
    useEffect(() => () => { streamRef.current?.getTracks().forEach(t => t.stop()); audioRef.current?.pause(); }, []);
    useEffect(() => { chatLinesRef.current = chatLines; }, [chatLines]);
    useEffect(() => { secsRef.current = secs; }, [secs]);
    useEffect(() => { suspendedRef.current = isSuspended; }, [isSuspended]);

    const hasVoiceOutput = !!(char?.voiceProfile?.voiceId || char?.voiceProfile?.timberWeights?.length) && !!resolveMiniMaxApiKey(apiConfig);

    const playReplyVoice = useCallback(async (reply: string) => {
        if (!char || !hasVoiceOutput || endedRef.current) return;
        try {
            const audio = await synthesizeSpeechDetailed(cleanTextForTts(reply), char, apiConfig);
            if (endedRef.current) return;
            audioRef.current?.pause();
            audioRef.current = new Audio(audio.url);
            void audioRef.current.play();
        } catch {
            addToast('语音没生成出来，先用文字聊吧', 'info');
        }
    }, [addToast, apiConfig, char, hasVoiceOutput]);

    const requestCharReply = useCallback(async (params: { userText?: string; eventLabel?: string; fallback: string; cameraOn?: boolean }): Promise<boolean> => {
        if (!char || replying || endedRef.current || suspendedRef.current) return false;
        const nextCameraOn = params.cameraOn ?? camOn;
        const text = params.userText?.trim();
        const userLine = text ? { id: `u-${Date.now()}`, role: 'user' as const, text, timestamp: Date.now() } : null;
        if (userLine) setChatLines(prev => [...prev, userLine]);
        setReplying(true);
        try {
            if (!apiConfig.baseUrl || !apiConfig.model) {
                if (endedRef.current || suspendedRef.current) return false;
                setChatLines(prev => [...prev, { id: `c-${Date.now()}`, role: 'char', text: params.fallback, timestamp: Date.now() }]);
                return true;
            }
            const recentLines = [...chatLinesRef.current, ...(userLine ? [userLine] : [])];
            const recent = recentLines
                .slice(-8)
                .map(line => `${line.role === 'user' ? userProfile.name || '用户' : char.name}: ${line.text}`)
                .join('\n');
            const prompt = `${ContextBuilder.buildCoreContext(char, userProfile, true)}

${videoCallPromptBody({
                userName: userProfile.name || '用户',
                charName: char.name,
                recent,
                userText: text,
                eventLabel: params.eventLabel,
                cameraOn: nextCameraOn,
                micOn,
                hasVoice: hasVoiceOutput,
            })}`;
            const data = await callChatCompletion(apiConfig, {
                model: apiConfig.model,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.85,
            }, {
                meta: makeApiUsageMeta('chat.phoneTextReply', {
                    charId: char.id,
                    charName: char.name,
                    apiRole: 'main',
                    apiBinding: '视频通话',
                }),
            });
            const reply = (extractContent(data) || '').trim() || params.fallback;
            if (endedRef.current || suspendedRef.current) return false;
            setChatLines(prev => [...prev, { id: `c-${Date.now()}`, role: 'char', text: reply, timestamp: Date.now() }]);
            void playReplyVoice(reply);
            return true;
        } catch (err: any) {
            if (!endedRef.current) addToast(`视频聊天回复失败：${err?.message || '未知错误'}`, 'error');
            return !!userLine;
        } finally {
            if (!endedRef.current) setReplying(false);
        }
    }, [apiConfig, camOn, char, hasVoiceOutput, micOn, playReplyVoice, replying, userProfile]);

    const stopCam = (notify = true) => {
        streamRef.current?.getTracks().forEach(t => t.stop());
        streamRef.current = null;
        if (videoRef.current) videoRef.current.srcObject = null;
        setCamOn(false);
        if (notify) void requestCharReply({ eventLabel: '用户关闭了摄像头', fallback: '好，我看不到你了。没事，你打字我也在听。', cameraOn: false });
    };
    const startCam = async (mode: 'user' | 'environment', notify = true) => {
        if (!navigator.mediaDevices?.getUserMedia) { addToast('此环境不支持摄像头', 'error'); return; }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: mode }, audio: false });
            streamRef.current?.getTracks().forEach(t => t.stop());
            streamRef.current = stream;
            if (videoRef.current) videoRef.current.srcObject = stream;
            setCamOn(true);
            if (notify) void requestCharReply({ eventLabel: '用户打开了摄像头，你现在能看见 TA 的画面', fallback: '看见你了。这样聊天好像近一点。', cameraOn: true });
        } catch {
            addToast('打不开摄像头（权限被拒或没有可用设备）', 'error');
            setCamOn(false);
        }
    };
    const toggleCam = () => { camOn ? stopCam(true) : startCam(facing, true); };
    const flip = () => { const next = facing === 'user' ? 'environment' : 'user'; setFacing(next); if (camOn) startCam(next, false); };

    const handleSuspendVideoCall = () => {
        if (!char || endedRef.current) return;
        const wasCamOn = camOn;
        const currentFacing = facing;
        const elapsedSeconds = Math.max(0, secsRef.current);
        const lines = chatLinesRef.current;
        suspendedRef.current = true;
        setIsSuspended(true);
        stopCam(false);
        audioRef.current?.pause();
        setReplying(false);
        suspendVideoCall({
            charId: char.id,
            charName,
            charAvatar: char.avatar,
            startedAt: Date.now() - elapsedSeconds * 1000,
            elapsedSeconds,
            chatLines: lines,
            sessionId: sessionIdRef.current,
            camOn: wasCamOn,
            micOn,
            facing: currentFacing,
        });
        addToast('视频通话已挂起', 'info');
    };

    useEffect(() => {
        if (!suspendedVideoCall || activeApp !== AppID.VideoCall || !char || suspendedVideoCall.charId !== char.id) return;
        sessionIdRef.current = suspendedVideoCall.sessionId;
        setSecs(Math.max(0, suspendedVideoCall.elapsedSeconds || 0));
        setChatLines(suspendedVideoCall.chatLines || []);
        setMicOn(suspendedVideoCall.micOn);
        setFacing(suspendedVideoCall.facing || 'user');
        suspendedRef.current = false;
        setIsSuspended(false);
        endedRef.current = false;
        clearSuspendedVideoCall();
        if (suspendedVideoCall.camOn) {
            void startCam(suspendedVideoCall.facing || 'user', false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeApp, suspendedVideoCall, char?.id]);

    const finishVideoCall = async () => {
        if (!char || endedRef.current) return;
        endedRef.current = true;
        suspendedRef.current = false;
        setIsSuspended(false);
        stopCam(false);
        audioRef.current?.pause();

        const endedAt = Date.now();
        const durationSec = Math.max(1, secsRef.current);
        const lines = chatLinesRef.current;
        const userTurns = lines.filter(line => line.role === 'user').length;
        const keepsakeLine = summarizeKeepsakeLine(lines, charName);
        const sessionId = sessionIdRef.current;

        try {
            for (const [index, line] of lines.entries()) {
                await DB.saveMessage({
                    charId: char.id,
                    role: line.role === 'user' ? 'user' : 'assistant',
                    type: 'text',
                    content: line.text,
                    timestamp: line.timestamp || (endedAt - Math.max(1, lines.length - index) * 1000),
                    metadata: { source: 'call', callSessionId: sessionId, callMode: 'video' },
                });
            }

            await DB.saveMessage({
                charId: char.id,
                role: 'system',
                type: 'system',
                content: `视频通话结束 · ${charName}｜${fmt(durationSec)}｜${Math.max(1, userTurns)}轮对话`,
                metadata: {
                    source: 'call-end-popup',
                    callSessionId: sessionId,
                    callMode: 'video',
                    characterId: char.id,
                    characterName: charName,
                    characterAvatar: char.avatar,
                    durationSec,
                    turnCount: userTurns,
                    keepsakeLine,
                    endedAt,
                },
            });

            await DB.saveMessage({
                charId: char.id,
                role: 'user',
                type: 'call_log',
                content: `视频通话已结束 · ${fmt(durationSec)}`,
                timestamp: endedAt,
                metadata: {
                    callDirection: 'outgoing',
                    callOutcome: 'ended',
                    callMode: 'video',
                    durationSec,
                    turnCount: userTurns,
                    callSessionId: sessionId,
                    msgStatus: 'sent',
                },
            } as any);

            await DB.savePhoneCallLog({
                id: `pcl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                charId: char.id,
                name: charName,
                number: charPhoneNumber(char.id),
                direction: 'outgoing',
                timestamp: endedAt,
                durationSec,
                sessionId,
                mode: 'video',
            });
            addToast('视频通话记录已保存', 'success');
        } catch (err: any) {
            addToast(`视频通话记录保存失败：${err?.message || '未知错误'}`, 'error');
        } finally {
            clearSuspendedVideoCall();
            closeApp();
        }
    };
    const hangUp = () => { void finishVideoCall(); };
    const sendText = useCallback(async () => {
        const text = textInput.trim();
        if (!char || !text || replying) return;
        setTextInput('');
        const accepted = await requestCharReply({ userText: text, fallback: '嗯，我在听。' });
        if (!accepted && !endedRef.current && !suspendedRef.current) {
            setTextInput(prev => prev ? prev : text);
        }
    }, [char, replying, textInput, requestCharReply]);

    const charImg = char?.convoSettings?.callSprites?.['默认']
        || char?.convoSettings?.spriteImage
        || char?.convoSettings?.charAvatarOverride
        || char?.avatar;
    const charName = char?.convoSettings?.remarkName?.trim() || char?.name || '对方';

    if (!char) {
        return (
            <div className="h-full w-full flex flex-col items-center justify-center gap-3 text-black" style={{ background: '#efece3' }}>
                <div className="border-2 border-dashed border-black bg-white p-5 -rotate-2" style={{ boxShadow: '3px 3px 0 #000' }}>
                    <VideoCameraSlash size={34} weight="bold" />
                </div>
                <p className="text-sm font-serif font-bold">没有可通话的对象</p>
                <button onClick={closeApp} className="mt-2 px-5 py-2 border-2 border-black bg-white text-sm font-mono active:translate-x-px active:translate-y-px transition-transform">返回</button>
            </div>
        );
    }

    return (
        <div className="h-full w-full relative text-black flex flex-col overflow-hidden select-none" style={{ background: '#efece3' }}>
            {charImg && (
                <div
                    className="absolute inset-0 bg-cover bg-center scale-125 blur-2xl opacity-20"
                    style={{ backgroundImage: `url(${charImg})` }}
                />
            )}
            <div className="absolute inset-0 opacity-[0.06] pointer-events-none" style={{ backgroundImage: 'radial-gradient(#1b1a17 1px, transparent 1px)', backgroundSize: '7px 7px' }} />
            <div className="absolute inset-0 bg-gradient-to-b from-[#efece3]/72 via-[#efece3]/88 to-[#efece3]" />

            <div className="relative z-10 flex min-h-0 flex-col h-full">
                <div className="px-4 pt-10 pb-3 border-b-2 border-black flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <button onClick={hangUp} className="w-8 h-8 border-2 border-black bg-white flex items-center justify-center active:translate-x-px active:translate-y-px transition-transform" title="挂断">
                            <PhoneX size={15} weight="bold" />
                        </button>
                        <button onClick={handleSuspendVideoCall} className="w-8 h-8 border-2 border-black bg-white flex items-center justify-center active:translate-x-px active:translate-y-px transition-transform" title="挂起">
                            <Minus size={15} weight="bold" />
                        </button>
                    </div>
                    <div className="flex items-center gap-2 min-w-0">
                        <div className="w-8 h-8 border-2 border-black flex items-center justify-center text-xs font-serif font-bold overflow-hidden -rotate-2 bg-white">
                            {char?.avatar ? <img src={char.avatar} alt="" className="w-full h-full object-cover" /> : charName[0]}
                        </div>
                        <div className="text-sm font-serif font-bold truncate max-w-[150px]">{charName}</div>
                    </div>
                    <div className="text-sm tabular-nums font-mono border-2 border-black bg-white px-1.5 py-0.5">{fmt(secs)}</div>
                </div>

                <div className="px-4 pt-2.5">
                    <div className="inline-flex items-center gap-2 border-2 border-black bg-white px-3 py-1 text-xs font-mono uppercase tracking-widest">
                        <span>{replying ? '回应中' : '视频接通'}</span>
                        <div className="flex items-end gap-1 h-3" aria-hidden>
                            {[10, 18, 13, 16].map((h, idx) => (
                                <span
                                    key={`${h}-${idx}`}
                                    className={`w-1 bg-black ${replying ? 'animate-pulse' : 'opacity-55'}`}
                                    style={{ height: `${replying ? h : 6}px`, animationDelay: `${idx * 90}ms` }}
                                />
                            ))}
                        </div>
                    </div>
                </div>

                <div className="px-5 pt-4">
                    <div className="relative mx-auto w-full max-w-[320px] border-2 border-black bg-white p-2 -rotate-[0.4deg]" style={{ height: 'clamp(180px, 34vh, 360px)', boxShadow: '4px 4px 0 #000' }}>
                        <div className="relative w-full h-full overflow-hidden bg-[#efece3] border-2 border-black">
                            {charImg
                                ? <img src={charImg} className="w-full h-full object-contain" alt={charName} />
                                : <div className="w-full h-full flex items-center justify-center text-4xl font-serif font-black">{charName[0]}</div>}
                            <div className="absolute left-2 top-2 border-2 border-black bg-white px-2 py-0.5 text-[10px] font-mono tracking-widest">LIVE</div>
                            <div className="absolute right-2 bottom-2 w-24 h-32 border-2 border-black bg-[#efece3] overflow-hidden rotate-[1deg]" style={{ boxShadow: '3px 3px 0 rgba(27,26,23,0.35)' }}>
                                <video
                                    ref={videoRef} autoPlay playsInline muted
                                    className="w-full h-full object-cover"
                                    style={{ transform: facing === 'user' ? 'scaleX(-1)' : undefined, display: camOn ? 'block' : 'none' }}
                                />
                                {!camOn && (
                                    <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 text-black/55 bg-white">
                                        {userProfile.avatar
                                            ? <img src={userProfile.avatar} className="w-9 h-9 border-2 border-black object-cover bg-white" />
                                            : <VideoCameraSlash size={20} weight="bold" />}
                                        <span className="text-[9px] font-mono">摄像头已关</span>
                                    </div>
                                )}
                            </div>
                        </div>
                        <span className="absolute z-20 -top-1 -left-1 w-3 h-3 border-t-2 border-l-2 border-black" />
                        <span className="absolute z-20 -bottom-1 -right-1 w-3 h-3 border-b-2 border-r-2 border-black" />
                    </div>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-6 py-3 space-y-2.5">
                    {!chatLines.length && (
                        <div className="flex flex-col items-center justify-center py-4 text-center">
                            <p className="text-base font-serif font-bold">线已接通</p>
                            <p className="text-sm text-neutral-600 mt-2">{charName}在屏幕那头等你开口……</p>
                        </div>
                    )}
                    {chatLines.slice(-8).map((line, index) => {
                        const fromBottom = chatLines.length - 1 - index;
                        const opacity = Math.max(0.38, 1 - fromBottom * 0.12);
                        return (
                            <div key={line.id} style={{ opacity }} className={`px-1 py-1 ${line.role === 'user' ? 'text-right' : ''}`}>
                                <div className="text-[10px] text-neutral-500 mb-1 font-mono uppercase tracking-wider">{line.role === 'user' ? '我' : charName}</div>
                                <div className={`whitespace-pre-wrap leading-relaxed ${line.role === 'user' ? 'text-neutral-600 text-sm' : 'text-black text-[15px]'}`}>
                                    {line.text}
                                </div>
                            </div>
                        );
                    })}
                    {replying && <div className="text-center text-[11px] text-neutral-500 font-mono uppercase tracking-widest animate-pulse">请稍等</div>}
                </div>

                <div className="px-4 pb-2">
                    <div className="border-2 border-black bg-white p-2 flex gap-2" style={{ boxShadow: '3px 3px 0 #000' }}>
                        <input
                            value={textInput}
                            onChange={e => setTextInput(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') void sendText(); }}
                            placeholder={`想对${charName}说些什么？`}
                            className="min-w-0 flex-1 bg-transparent px-3 text-sm outline-none placeholder:text-neutral-400"
                        />
                        <button onClick={() => void sendText()} disabled={!textInput.trim() || replying} className="px-3 py-2 border-2 border-black bg-black text-white disabled:opacity-40 flex items-center justify-center active:scale-95">
                            <PaperPlaneRight size={16} weight="fill" />
                        </button>
                    </div>
                </div>

                <div className="px-5 pb-5 pt-1.5">
                    <div className="border-2 border-black bg-white px-5 py-3 flex items-center justify-between" style={{ boxShadow: '4px 4px 0 #000' }}>
                        <CtrlBtn active={!micOn} onClick={() => setMicOn(v => !v)} label={micOn ? '静音' : '已静音'}
                            icon={micOn ? <Microphone size={22} weight="fill" /> : <MicrophoneSlash size={22} weight="fill" />} />
                        <CtrlBtn active={!camOn} onClick={toggleCam} label={camOn ? '关摄像头' : '开摄像头'}
                            icon={camOn ? <VideoCamera size={22} weight="fill" /> : <VideoCameraSlash size={22} weight="fill" />} />
                        <CtrlBtn active={false} onClick={flip} label="翻转"
                            icon={<CameraRotate size={22} weight="bold" />} disabled={!camOn} />
                        <button onClick={hangUp} className="flex flex-col items-center gap-1">
                            <span className="w-14 h-14 border-2 border-black bg-black text-white flex items-center justify-center transition active:translate-x-px active:translate-y-px" style={{ boxShadow: '3px 3px 0 rgba(27,26,23,0.35)' }}>
                                <PhoneX size={24} weight="fill" />
                            </span>
                            <span className="text-[10px] text-neutral-600 font-mono">收线</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

const CtrlBtn: React.FC<{ active: boolean; onClick: () => void; icon: React.ReactNode; label: string; disabled?: boolean }> = ({ active, onClick, icon, label, disabled = false }) => (
    <button onClick={onClick} disabled={disabled} className="flex flex-col items-center gap-1 disabled:opacity-35">
        <span className={`w-12 h-12 border-2 border-black flex items-center justify-center transition active:translate-x-px active:translate-y-px ${active ? 'bg-black text-white' : 'bg-white text-black'}`}>
            {icon}
        </span>
        <span className="text-[10px] text-neutral-600 font-mono">{label}</span>
    </button>
);

export default VideoCallApp;
