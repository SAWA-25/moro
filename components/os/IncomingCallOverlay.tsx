import React, { useEffect, useRef, useState } from 'react';
import { useOS } from '../../context/OSContext';
import { DB } from '../../utils/db';
import { AppID } from '../../types';

/**
 * 角色主动来电覆盖层（全局挂载在 PhoneShell，锁屏时也能响铃）。
 *
 * 触发：聊天设置开启「主动语音通话」后，主动消息路径里角色输出 [[CALL_USER]]
 * 指令（见 OSContext runProactive），页面可见时 dispatch 'char-call-incoming'。
 *
 * 接听 → 写入电话 App 拨号握手键并打开 CallApp（角色先开口）；
 * 挂断 / 30 秒无人接 → 落一条「未接来电」call_log 进聊天上下文，角色"记得"这通电话。
 */
const RING_TIMEOUT_MS = 30_000;

const IncomingCallOverlay: React.FC = () => {
    const { characters, openApp, isLocked, unlock } = useOS();
    const [callCharId, setCallCharId] = useState<string | null>(null);
    const callCharIdRef = useRef<string | null>(null);
    callCharIdRef.current = callCharId;

    useEffect(() => {
        const handler = (e: Event) => {
            const d = (e as CustomEvent).detail as { charId?: string };
            if (!d?.charId) return;
            // 已经在响铃时忽略新来电（一次只接一通）
            if (callCharIdRef.current) return;
            setCallCharId(d.charId);
        };
        window.addEventListener('char-call-incoming', handler);
        return () => window.removeEventListener('char-call-incoming', handler);
    }, []);

    const saveMissedCall = async (charId: string, declined: boolean) => {
        try {
            await DB.saveMessage({
                charId,
                role: 'assistant',
                type: 'call_log',
                content: declined ? '对方已拒绝' : '未接来电',
                metadata: { callDirection: 'incoming', callOutcome: declined ? 'declined' : 'missed' },
            } as any);
        } catch { /* 通话记录落库失败不阻塞 UI */ }
    };

    // 响铃超时 → 未接来电
    useEffect(() => {
        if (!callCharId) return;
        const t = window.setTimeout(() => {
            void saveMissedCall(callCharId, false);
            setCallCharId(null);
        }, RING_TIMEOUT_MS);
        return () => window.clearTimeout(t);
    }, [callCharId]);

    if (!callCharId) return null;
    const char = characters.find(c => c.id === callCharId);
    if (!char) return null;

    const acceptCall = () => {
        // 电话 App 拨号握手键：CallApp 挂载时读取并直接选中该角色接通（角色先开口）
        try { sessionStorage.setItem('moro_phone_dial_char_id', char.id); } catch { /* ignore */ }
        setCallCharId(null);
        if (isLocked) unlock();
        openApp(AppID.Call);
    };

    const declineCall = () => {
        void saveMissedCall(char.id, true);
        setCallCharId(null);
    };

    return (
        <div className="fixed inset-0 z-[200] flex flex-col items-center bg-slate-900/95 backdrop-blur-xl animate-fade-in" style={{ paddingTop: 'calc(18vh + var(--safe-top, 0px))' }}>
            <div className="relative mb-7">
                <span className="absolute inset-0 rounded-full bg-emerald-400/20 animate-ping" />
                <span className="absolute -inset-4 rounded-full border border-white/10 animate-pulse" />
                <img src={char.avatar} className="relative w-28 h-28 rounded-full object-cover ring-4 ring-white/15 shadow-2xl" alt={char.name} />
            </div>
            <div className="text-white text-2xl font-bold mb-2">{char.name}</div>
            <div className="text-white/60 text-sm">邀请你语音通话…</div>

            <div className="mt-auto mb-20 flex items-center gap-24">
                <div className="flex flex-col items-center gap-2">
                    <button
                        onClick={declineCall}
                        className="w-16 h-16 rounded-full bg-red-500 text-white flex items-center justify-center shadow-lg active:scale-95 transition-transform"
                        aria-label="挂断"
                    >
                        <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" style={{ transform: 'rotate(135deg)' }}><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg>
                    </button>
                    <span className="text-[11px] text-white/50">挂断</span>
                </div>
                <div className="flex flex-col items-center gap-2">
                    <button
                        onClick={acceptCall}
                        className="w-16 h-16 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-lg active:scale-95 transition-transform animate-bounce"
                        aria-label="接听"
                    >
                        <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg>
                    </button>
                    <span className="text-[11px] text-white/50">接听</span>
                </div>
            </div>
        </div>
    );
};

export default IncomingCallOverlay;
