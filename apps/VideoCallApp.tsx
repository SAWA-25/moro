import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useOS } from '../context/OSContext';
import { VideoCamera, VideoCameraSlash, Microphone, MicrophoneSlash, PhoneX, CameraRotate } from '@phosphor-icons/react';

/**
 * 视频通话 —— 从聊天发起的视频通话页。
 *  - 角色侧：用「通话立绘」(convoSettings.callSprites['默认']) / 立绘 / 头像作为对方画面。
 *  - 用户侧：默认不开摄像头，可自选开/关（「只开一下就关了」），可翻转前后置；调 getUserMedia，
 *    关掉即停轨（摄像头灯熄灭）。麦克风为通话静音指示。
 *  - 挂断 / 离开即停掉所有摄像头轨道。
 */

const fmt = (s: number): string => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

const VideoCallApp: React.FC = () => {
    const { closeApp, characters, activeCharacterId, userProfile, addToast } = useOS();
    const char = useMemo(() => characters.find(c => c.id === activeCharacterId) || null, [characters, activeCharacterId]);

    const [secs, setSecs] = useState(0);
    const [camOn, setCamOn] = useState(false);
    const [micOn, setMicOn] = useState(true);
    const [facing, setFacing] = useState<'user' | 'environment'>('user');
    const streamRef = useRef<MediaStream | null>(null);
    const videoRef = useRef<HTMLVideoElement>(null);

    // 通话计时
    useEffect(() => { const t = setInterval(() => setSecs(s => s + 1), 1000); return () => clearInterval(t); }, []);
    // 离开时停掉摄像头
    useEffect(() => () => { streamRef.current?.getTracks().forEach(t => t.stop()); }, []);

    const stopCam = () => {
        streamRef.current?.getTracks().forEach(t => t.stop());
        streamRef.current = null;
        if (videoRef.current) videoRef.current.srcObject = null;
        setCamOn(false);
    };
    const startCam = async (mode: 'user' | 'environment') => {
        if (!navigator.mediaDevices?.getUserMedia) { addToast('此环境不支持摄像头', 'error'); return; }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: mode }, audio: false });
            streamRef.current?.getTracks().forEach(t => t.stop());
            streamRef.current = stream;
            if (videoRef.current) videoRef.current.srcObject = stream;
            setCamOn(true);
        } catch {
            addToast('打不开摄像头（权限被拒或没有可用设备）', 'error');
            setCamOn(false);
        }
    };
    const toggleCam = () => { camOn ? stopCam() : startCam(facing); };
    const flip = () => { const next = facing === 'user' ? 'environment' : 'user'; setFacing(next); if (camOn) startCam(next); };
    const hangUp = () => { stopCam(); closeApp(); };

    const charImg = char?.convoSettings?.callSprites?.['默认']
        || char?.convoSettings?.spriteImage
        || char?.convoSettings?.charAvatarOverride
        || char?.avatar;
    const charName = char?.convoSettings?.remarkName?.trim() || char?.name || '对方';

    if (!char) {
        return (
            <div className="h-full w-full flex flex-col items-center justify-center bg-[#15131a] text-white gap-3">
                <VideoCameraSlash size={40} weight="thin" className="opacity-60" />
                <p className="text-sm opacity-70">没有可通话的对象</p>
                <button onClick={closeApp} className="mt-2 px-5 py-2 rounded-full bg-white/10 text-sm">返回</button>
            </div>
        );
    }

    return (
        <div className="h-full w-full relative overflow-hidden bg-black select-none">
            {/* 对方画面（通话立绘 / 头像） */}
            {charImg
                ? <>
                    <img src={charImg} className="absolute inset-0 w-full h-full object-cover scale-110 blur-2xl opacity-50" aria-hidden />
                    <img src={charImg} className="absolute inset-0 w-full h-full object-contain" />
                </>
                : <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'radial-gradient(circle at 50% 35%,#3a3550,#15131a)' }}>
                    <div className="w-32 h-32 rounded-full bg-white/10 flex items-center justify-center text-[52px]">🙂</div>
                </div>}

            {/* 顶部：名字 + 计时 */}
            <div className="absolute top-0 inset-x-0 pt-[calc(var(--safe-top)+12px)] pb-10 px-5 bg-gradient-to-b from-black/55 to-transparent text-white text-center">
                <div className="text-[19px] font-bold drop-shadow">{charName}</div>
                <div className="text-[12px] opacity-80 mt-0.5 tracking-wide drop-shadow">视频通话中 · {fmt(secs)}</div>
            </div>

            {/* 自己的画面 PiP */}
            <div className="absolute right-4 top-[calc(var(--safe-top)+64px)] w-24 h-36 rounded-2xl overflow-hidden shadow-2xl shadow-black/50 border border-white/15 bg-[#22202a]">
                <video
                    ref={videoRef} autoPlay playsInline muted
                    className="w-full h-full object-cover"
                    style={{ transform: facing === 'user' ? 'scaleX(-1)' : undefined, display: camOn ? 'block' : 'none' }}
                />
                {!camOn && (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 text-white/55">
                        {userProfile.avatar
                            ? <img src={userProfile.avatar} className="w-9 h-9 rounded-full object-cover opacity-70" />
                            : <VideoCameraSlash size={20} weight="bold" />}
                        <span className="text-[9px]">摄像头已关</span>
                    </div>
                )}
                {camOn && (
                    <button onClick={flip} className="absolute bottom-1 right-1 w-6 h-6 rounded-full bg-black/45 text-white flex items-center justify-center active:scale-90" title="翻转镜头">
                        <CameraRotate size={13} weight="bold" />
                    </button>
                )}
            </div>

            {/* 底部控制条 */}
            <div className="absolute bottom-0 inset-x-0 pb-[calc(env(safe-area-inset-bottom)+22px)] pt-12 px-8 bg-gradient-to-t from-black/60 to-transparent">
                <div className="flex items-center justify-center gap-5">
                    <CtrlBtn active={!micOn} onClick={() => setMicOn(v => !v)} label={micOn ? '静音' : '已静音'}
                        icon={micOn ? <Microphone size={24} weight="fill" /> : <MicrophoneSlash size={24} weight="fill" />} />
                    <CtrlBtn active={!camOn} onClick={toggleCam} label={camOn ? '关摄像头' : '开摄像头'}
                        icon={camOn ? <VideoCamera size={24} weight="fill" /> : <VideoCameraSlash size={24} weight="fill" />} />
                    <button onClick={hangUp} className="flex flex-col items-center gap-1">
                        <span className="w-[60px] h-[60px] rounded-full bg-[#ef4444] text-white flex items-center justify-center shadow-xl shadow-red-900/40 active:scale-90 transition-transform">
                            <PhoneX size={26} weight="fill" />
                        </span>
                        <span className="text-[10px] text-white/80">挂断</span>
                    </button>
                </div>
            </div>
        </div>
    );
};

const CtrlBtn: React.FC<{ active: boolean; onClick: () => void; icon: React.ReactNode; label: string }> = ({ active, onClick, icon, label }) => (
    <button onClick={onClick} className="flex flex-col items-center gap-1">
        <span className={`w-[52px] h-[52px] rounded-full flex items-center justify-center transition-all active:scale-90 ${active ? 'bg-white text-[#22202a]' : 'bg-white/15 text-white backdrop-blur-sm'}`}>
            {icon}
        </span>
        <span className="text-[10px] text-white/80">{label}</span>
    </button>
);

export default VideoCallApp;
