import React, { useEffect, useRef, useState } from 'react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { processImage } from '../utils/file';
import { safeResponseJson } from '../utils/safeApi';
import { GalleryImage } from '../types';
import { ArrowLeft, ArrowsClockwise, Camera as CameraIcon, Images } from '@phosphor-icons/react';

/**
 * 相机 App —— 用「TA 的手机」拍下此刻，让 TA 看见并一起聊。
 *
 * 用户可实时取景拍照（getUserMedia，失败则回退系统相机/相册），拍好后点「让 TA 看看」，
 * 走多模态（vision）让角色看图并即时点评（"已读此刻"）。照片连同点评存进相册；也可一键
 * 把这张照片发进聊天，由角色顺着聊下去。从聊天 + 号面板「拍张照」进入。
 */

interface CameraAppProps {
    charId: string;
    onExit: () => void;
    /** 把这张照片发进聊天（由宿主插入图片消息并触发角色回复） */
    onSendToChat?: (dataUrl: string) => void;
}

interface Bubble { text: string }

const CameraApp: React.FC<CameraAppProps> = ({ charId, onExit, onSendToChat }) => {
    const { characters, apiConfig, addToast, userProfile } = useOS();
    const char = characters.find(c => c.id === charId);

    const videoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const captureInputRef = useRef<HTMLInputElement>(null);
    const albumInputRef = useRef<HTMLInputElement>(null);

    const [camReady, setCamReady] = useState(false);
    const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment');
    const [photo, setPhoto] = useState<string | null>(null);
    const [bubbles, setBubbles] = useState<Bubble[]>([]);
    const [busy, setBusy] = useState(false);
    const [savedToGallery, setSavedToGallery] = useState(false);

    // ── 实时取景（getUserMedia）；失败则回退到系统相机/相册 ──
    useEffect(() => {
        let cancelled = false;
        const stop = () => {
            streamRef.current?.getTracks().forEach(t => t.stop());
            streamRef.current = null;
        };
        stop();
        if (photo) return () => stop(); // 已拍好就不再占用摄像头
        (async () => {
            try {
                if (!navigator.mediaDevices?.getUserMedia) { setCamReady(false); return; }
                const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode }, audio: false });
                if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
                streamRef.current = stream;
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                    await videoRef.current.play().catch(() => { /* 自动播放被拦截时忽略 */ });
                }
                setCamReady(true);
            } catch {
                if (!cancelled) setCamReady(false);
            }
        })();
        return () => { cancelled = true; stop(); };
    }, [facingMode, photo]);

    const resetShot = () => { setPhoto(null); setBubbles([]); setSavedToGallery(false); };

    // 实时取景：把当前帧画到 canvas → dataURL
    const snap = () => {
        const v = videoRef.current;
        if (camReady && v && v.videoWidth) {
            const canvas = document.createElement('canvas');
            const maxW = 1024;
            const scale = Math.min(1, maxW / v.videoWidth);
            canvas.width = Math.round(v.videoWidth * scale);
            canvas.height = Math.round(v.videoHeight * scale);
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
                setBubbles([]);
                setSavedToGallery(false);
                setPhoto(canvas.toDataURL('image/jpeg', 0.82));
                return;
            }
        }
        // 没有实时取景：唤起系统相机
        captureInputRef.current?.click();
    };

    const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        try {
            const dataUrl = await processImage(file, { maxWidth: 1024, quality: 0.82, forceJpeg: true });
            setBubbles([]);
            setSavedToGallery(false);
            setPhoto(dataUrl);
        } catch (err: any) {
            addToast(err?.message || '图片处理失败', 'error');
        }
    };

    // ── 让 TA 看看（多模态点评）──
    const showToChar = async () => {
        if (!photo || !char) return;
        if (!apiConfig.apiKey || !apiConfig.baseUrl) { addToast('请先配置 API', 'error'); return; }
        setBusy(true);
        try {
            const systemContent = `你是「${char.name}」。${char.systemPrompt || ''}
此刻 ${userProfile.name} 用你的手机拍了一张照片给你看。请你看着这张照片，按你的人设即时点评 1~2 句（像在聊天里收到一张照片那样自然、口语、有你的语气和情绪），不要 AI 助手腔，不要描述"这是一张图片"这类废话。
如果要分成两句，用换行分开。`;
            const payload = {
                model: apiConfig.model,
                messages: [
                    { role: 'system', content: systemContent },
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: `这是我刚用你的手机拍的，给你看看。` },
                            { type: 'image_url', image_url: { url: photo } },
                        ],
                    },
                ],
                max_tokens: 4000,
                temperature: 0.85,
                stream: false,
            };
            const res = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
                body: JSON.stringify(payload),
            });
            if (!res.ok) {
                let msg = `HTTP ${res.status}`;
                try { const d = await safeResponseJson(res); msg = d?.error?.message || msg; } catch { /* ignore */ }
                if (/vision|image|multimodal|不支持/i.test(msg)) msg = '当前模型可能不支持图片识别(Vision)，请切换模型。';
                throw new Error(msg);
            }
            const data = await safeResponseJson(res);
            const choice = data.choices?.[0];
            let text: string = choice?.message?.content || choice?.message?.reasoning_content || choice?.text || '';
            text = (text || '').trim();
            if (!text) throw new Error('TA 没有回应，请重试');

            const parts = text.split(/\n+/).map(s => s.trim()).filter(Boolean).slice(0, 3);
            setBubbles(parts.map(t => ({ text: t })));

            // 存进相册（连同点评）
            try {
                const img: GalleryImage = {
                    id: `cam-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                    charId: char.id,
                    url: photo,
                    timestamp: Date.now(),
                    review: parts.join('\n'),
                    reviewTimestamp: Date.now(),
                    savedDate: new Date().toISOString().split('T')[0],
                };
                await DB.saveGalleryImage(img);
                setSavedToGallery(true);
            } catch { /* 存相册失败不阻塞讨论 */ }
        } catch (e: any) {
            addToast(e?.message || '让 TA 看看失败', 'error');
        } finally {
            setBusy(false);
        }
    };

    const sendToChat = () => {
        if (!photo) return;
        onSendToChat?.(photo);
        addToast('照片已发进聊天', 'success');
        onExit();
    };

    const deviceName = char ? `${char.name} 的手机` : '手机';

    return (
        <div className="absolute inset-0 z-[420] flex flex-col overflow-hidden text-white"
            style={{ background: 'linear-gradient(165deg, #3a2730 0%, #281b22 55%, #1e1419 100%)', paddingTop: 'max(8px, var(--safe-top))' }}>
            {/* 顶栏 */}
            <div className="shrink-0 px-4 pt-2 pb-3 flex items-center justify-between">
                <button onClick={onExit} className="w-11 h-11 rounded-full flex items-center justify-center bg-white/10 active:scale-90 transition-transform" aria-label="返回">
                    <ArrowLeft size={20} weight="bold" />
                </button>
                <div className="text-center">
                    <div className="text-[20px] font-bold tracking-wide" style={{ fontFamily: "'Long Cang','Caveat',serif" }}>相机</div>
                    <div className="text-[11px] text-white/55 mt-0.5">让 TA 看见你的此刻</div>
                </div>
                <button onClick={() => { resetShot(); setFacingMode(m => m === 'user' ? 'environment' : 'user'); }}
                    className="w-11 h-11 rounded-full flex items-center justify-center bg-white/10 active:scale-90 transition-transform" aria-label="切换/重拍">
                    <ArrowsClockwise size={18} weight="bold" />
                </button>
            </div>

            {/* 取景 / 已拍画面 */}
            <div className="shrink-0 px-4">
                <button
                    onClick={photo ? resetShot : snap}
                    className="relative w-full rounded-[22px] overflow-hidden border border-white/15 bg-black/40"
                    style={{ aspectRatio: '4 / 3' }}
                >
                    {photo ? (
                        <img src={photo} alt="" className="w-full h-full object-cover" />
                    ) : camReady ? (
                        <video ref={videoRef} playsInline muted className="w-full h-full object-cover" style={{ transform: facingMode === 'user' ? 'scaleX(-1)' : undefined }} />
                    ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-white/70">
                            <CameraIcon size={40} weight="light" />
                            <span className="text-[13px]">轻点拍一张</span>
                        </div>
                    )}
                    {/* 取景叠层提示 */}
                    {!photo && (
                        <>
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                <div className="flex flex-col items-center gap-1.5 text-white/85" style={{ textShadow: '0 1px 6px rgba(0,0,0,0.5)' }}>
                                    <CameraIcon size={34} weight="light" />
                                    <span className="text-[12px]">轻点拍一张</span>
                                </div>
                            </div>
                            <div className="absolute left-3 bottom-3 flex items-center gap-1.5 text-[11px] text-white/70" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.6)' }}>
                                <span className="w-1.5 h-1.5 rounded-full bg-rose-400 inline-block" /> 轻点画面拍一张
                            </div>
                        </>
                    )}
                    <div className="absolute right-3 bottom-3 text-[11px] text-white/70" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.6)' }}>
                        设备：{deviceName}
                    </div>
                    {photo && (
                        <div className="absolute left-3 top-3 text-[10px] px-2 py-0.5 rounded-full bg-black/45 text-white/85">轻点重拍</div>
                    )}
                </button>
            </div>

            {/* 照片 + TA 的点评 */}
            <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-4 py-4">
                {photo && (
                    <div className="flex flex-col items-center">
                        {/* 拍立得 */}
                        <div className="bg-[#f3efe6] p-2.5 pb-7 rounded-[6px] shadow-[0_18px_36px_-18px_rgba(0,0,0,0.7)] rotate-[-1.5deg] max-w-[62%]">
                            <img src={photo} alt="" className="w-full aspect-square object-cover" />
                            <div className="text-center text-[12px] text-[#3a2730] mt-2" style={{ fontFamily: "'Long Cang','Caveat',serif" }}>
                                让 {char?.name ?? 'TA'} 看看
                            </div>
                        </div>

                        {/* TA 已读此刻 */}
                        {bubbles.length > 0 && char && (
                            <div className="w-full mt-5 rounded-[18px] bg-white/8 border border-white/12 p-3.5 animate-fade-in">
                                <div className="flex items-center gap-2 mb-2">
                                    <img src={char.avatar} className="w-7 h-7 rounded-full object-cover" alt="" />
                                    <span className="text-[12px] font-bold text-white/80">{char.name} 已读此刻</span>
                                </div>
                                <div className="space-y-2">
                                    {bubbles.map((b, i) => (
                                        <div key={i} className="relative bg-white/12 rounded-2xl rounded-tl-md px-3.5 py-2.5 text-[13px] leading-relaxed text-white/95">
                                            {b.text}
                                            {bubbles.length > 1 && (
                                                <span className="absolute right-3 bottom-1 text-[9px] text-white/35">{i + 1}/{bubbles.length}</span>
                                            )}
                                        </div>
                                    ))}
                                </div>
                                {savedToGallery && <div className="text-[10px] text-white/35 mt-2">已存进相册</div>}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* 底栏 */}
            <div className="shrink-0 px-5 pb-5 pt-2 flex items-center justify-between gap-3" style={{ paddingBottom: 'max(20px, var(--safe-bottom))' }}>
                <button onClick={() => albumInputRef.current?.click()}
                    className="flex-1 max-w-[34%] py-3 rounded-full bg-white/10 text-[13px] font-bold active:scale-95 transition-transform flex items-center justify-center gap-1.5">
                    <Images size={16} weight="bold" /> 从相册选
                </button>

                <button onClick={snap} disabled={busy}
                    className="w-[78px] h-[78px] rounded-full bg-white/10 border-4 border-white/70 flex items-center justify-center active:scale-90 transition-transform disabled:opacity-50 shrink-0">
                    <span className="w-[58px] h-[58px] rounded-full bg-[#f3efe6] shadow-inner" />
                </button>

                <button onClick={showToChar} disabled={!photo || busy}
                    className="flex-1 max-w-[34%] py-3 rounded-full text-[13px] font-bold active:scale-95 transition-transform flex items-center justify-center gap-1.5 disabled:opacity-40"
                    style={{ background: photo && !busy ? '#e88aa0' : 'rgba(255,255,255,0.1)', color: photo && !busy ? '#3a1622' : '#fff' }}>
                    {busy ? '看着呢…' : `让${char?.name ?? 'TA'}看看`}
                </button>
            </div>

            {/* 看完后：把这张发进聊天 */}
            {photo && bubbles.length > 0 && onSendToChat && !busy && (
                <div className="shrink-0 px-5 pb-5">
                    <button onClick={sendToChat}
                        className="w-full py-2.5 rounded-full bg-white/12 text-[12px] font-bold text-white/80 active:scale-95 transition-transform">
                        把这张照片发进聊天，接着聊 →
                    </button>
                </div>
            )}

            {/* 隐藏的系统相机 / 相册输入（取景失败时回退） */}
            <input ref={captureInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onPickFile} />
            <input ref={albumInputRef} type="file" accept="image/*" className="hidden" onChange={onPickFile} />
        </div>
    );
};

export default CameraApp;
