import React, { useEffect, useMemo, useState } from 'react';
import { useOS } from '../../context/OSContext';
import { DB } from '../../utils/db';
import { AppID, Message } from '../../types';
import { getLockPasscode, isLockPasscodeEnabled } from '../../utils/lockScreenSettings';

/**
 * 锁屏：壁纸 + 大时钟 + 角色最新消息通知卡（iOS 风格弹出，未读时实时更新），
 * 解锁需输入锁屏密码（默认 0103，可在设置 App「锁屏与密码」修改/关闭）。
 * 点通知卡 = 解锁后直达对应角色的聊天。
 */

interface LockNotification {
    charId: string;
    name: string;
    avatar: string;
    preview: string;
    timestamp: number;
    count: number;
}

const previewOf = (m?: Message): string => {
    if (!m) return '发来了一条新消息';
    switch (m.type) {
        case 'text': return String(m.content || '').replace(/\s+/g, ' ').slice(0, 60) || '发来了一条新消息';
        case 'emoji': return '[表情]';
        case 'image': return '[图片]';
        case 'voice': return '[语音]';
        case 'transfer': return '[转账]';
        case 'location': return '[位置]';
        case 'music_card': return '[音乐分享]';
        default: return '发来了一条新消息';
    }
};

const formatNotifTime = (ts: number): string => {
    const gapMin = Math.floor((Date.now() - ts) / 60000);
    if (gapMin < 1) return '现在';
    if (gapMin < 60) return `${gapMin}分钟前`;
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const LockScreen: React.FC = () => {
    const { theme, virtualTime, unlock, unreadMessages, characters, lastMsgTimestamp, openApp, setActiveCharacterId } = useOS();
    const [notifications, setNotifications] = useState<LockNotification[]>([]);
    const [showPad, setShowPad] = useState(false);
    const [entered, setEntered] = useState('');
    const [padError, setPadError] = useState(false);
    // 解锁成功后要直达的角色聊天（点通知卡进入）
    const [pendingCharId, setPendingCharId] = useState<string | null>(null);

    const contentColor = theme.contentColor || '#3f3d49';
    const wallpaper = theme.wallpaper;
    const bgImageValue = wallpaper.startsWith('http') || wallpaper.startsWith('data:') || wallpaper.startsWith('blob:')
        ? `url(${wallpaper})` : wallpaper;

    // 未读变化（含锁屏期间新到的主动消息）→ 拉每个角色的最新一条消息做通知卡
    useEffect(() => {
        let cancelled = false;
        (async () => {
            const entries = Object.entries(unreadMessages).filter(([, n]) => (n || 0) > 0).slice(0, 8);
            const out: LockNotification[] = [];
            for (const [charId, count] of entries) {
                const char = characters.find(c => c.id === charId);
                if (!char) continue;
                let last: Message | undefined;
                try {
                    const msgs = await DB.getRecentMessagesByCharId(charId, 10);
                    last = [...msgs].reverse().find(m => m.role === 'assistant' && !m.metadata?.hidden);
                } catch { /* 取不到就用占位文案 */ }
                out.push({
                    charId,
                    name: char.convoSettings?.remarkName?.trim() || char.name,
                    avatar: char.convoSettings?.charAvatarOverride || char.avatar,
                    preview: previewOf(last),
                    timestamp: last?.timestamp || Date.now(),
                    count: count || 1,
                });
            }
            out.sort((a, b) => b.timestamp - a.timestamp);
            if (!cancelled) setNotifications(out);
        })();
        return () => { cancelled = true; };
    }, [unreadMessages, lastMsgTimestamp, characters]);

    const doUnlock = (charId?: string | null) => {
        unlock();
        if (charId) {
            setActiveCharacterId(charId);
            openApp(AppID.Chat);
        }
    };

    const requestUnlock = (charId?: string | null) => {
        // 首次交互顺便申请通知权限（沿用旧锁屏行为，仅在未决定时询问）
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }
        if (!isLockPasscodeEnabled()) {
            doUnlock(charId);
            return;
        }
        setPendingCharId(charId || null);
        setEntered('');
        setPadError(false);
        setShowPad(true);
    };

    const pressKey = (key: string) => {
        if (key === 'del') {
            setEntered(prev => prev.slice(0, -1));
            setPadError(false);
            return;
        }
        if (entered.length >= 4) return;
        const next = entered + key;
        setEntered(next);
        if (next.length === 4) {
            if (next === getLockPasscode()) {
                doUnlock(pendingCharId);
            } else {
                setPadError(true);
                setTimeout(() => { setEntered(''); setPadError(false); }, 600);
            }
        }
    };

    const keypad = useMemo(() => ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'], []);

    return (
        <div
            className="moro-lock-screen relative w-full h-full bg-cover bg-center overflow-hidden font-light select-none overscroll-none"
            style={{ backgroundImage: bgImageValue, color: contentColor, animation: 'lockReveal 600ms ease-out both' }}
            onClick={() => { if (!showPad) requestUnlock(); }}
        >
            {/* 锁屏柔和淡入：与开机「世界入场」退场衔接；body 背景本就是壁纸，故是无缝融入而非硬切。 */}
            <style>{`
                @keyframes lockReveal{from{opacity:0}to{opacity:1}}
                @keyframes lockNotifIn{from{opacity:0;transform:translateY(-14px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}
                @keyframes lockPadShake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-7px)}40%,80%{transform:translateX(7px)}}
            `}</style>
            {theme.globalCustomCss && <style>{theme.globalCustomCss}</style>}
            <div className="absolute inset-0 bg-black/5 backdrop-blur-sm" />

            {/* 治愈系氛围光斑：缓慢漂移的暖紫/蜜桃光晕 */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <div className="absolute -top-16 -left-16 w-72 h-72 rounded-full animate-drift-slow"
                     style={{ background: 'radial-gradient(circle, rgba(196,181,253,0.28), transparent 70%)' }} />
                <div className="absolute -bottom-20 -right-12 w-80 h-80 rounded-full animate-drift-slower"
                     style={{ background: 'radial-gradient(circle, rgba(253,213,184,0.25), transparent 70%)' }} />
            </div>

            {/* 时钟 */}
            <div className="absolute top-16 w-full text-center pointer-events-none">
                <div className="text-[10px] label-mono font-bold opacity-50 mb-2">Moro · Lock</div>
                <div className="text-7xl tracking-tight opacity-95 font-display-italic font-semibold">
                    {virtualTime.hours.toString().padStart(2, '0')}<span className="animate-pulse">:</span>{virtualTime.minutes.toString().padStart(2, '0')}
                </div>
                <div className="label-mono opacity-70 mt-2 text-[10px] font-bold">Moro Simulation</div>
            </div>

            {/* 角色最新消息通知（iOS 锁屏风格弹出，点卡片解锁后直达聊天） */}
            {notifications.length > 0 && (
                <div className="absolute top-[34%] left-3 right-3 space-y-2 max-h-[44%] overflow-y-auto no-scrollbar">
                    {notifications.map((n, i) => (
                        <div
                            key={n.charId}
                            onClick={(e) => { e.stopPropagation(); requestUnlock(n.charId); }}
                            className="bg-white/25 backdrop-blur-xl rounded-2xl p-3.5 shadow-lg border border-white/20 flex items-center gap-3 cursor-pointer active:scale-[0.98] transition-transform"
                            style={{ animation: `lockNotifIn 420ms cubic-bezier(0.2,0.9,0.3,1.2) both`, animationDelay: `${i * 70}ms` }}
                        >
                            <img src={n.avatar} alt={n.name} className="w-10 h-10 rounded-xl object-cover shrink-0 shadow-sm" />
                            <div className="flex-1 min-w-0 text-left">
                                <div className="flex items-baseline justify-between gap-2">
                                    <span className="font-bold text-sm truncate">{n.name}</span>
                                    <span className="text-[10px] opacity-60 shrink-0">{formatNotifTime(n.timestamp)}</span>
                                </div>
                                <div className="text-xs opacity-85 truncate mt-0.5">{n.preview}</div>
                            </div>
                            {n.count > 1 && (
                                <span className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">{n.count > 99 ? '99+' : n.count}</span>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* 底部解锁提示 */}
            {!showPad && (
                <div className="absolute bottom-12 w-full flex flex-col items-center gap-3 animate-pulse opacity-80 drop-shadow-md pointer-events-none">
                    <div className="w-1 h-8 rounded-full bg-gradient-to-b from-transparent to-current"></div>
                    <span className="text-[10px] tracking-widest uppercase font-semibold">
                        {isLockPasscodeEnabled() ? 'Tap to Enter Passcode' : 'Tap to Unlock'}
                    </span>
                </div>
            )}

            {/* 密码键盘 */}
            {showPad && (
                <div
                    className="absolute inset-0 z-20 flex flex-col items-center justify-end pb-10 bg-black/30 backdrop-blur-md animate-fade-in"
                    onClick={(e) => { e.stopPropagation(); setShowPad(false); }}
                >
                    <div className="w-full max-w-[300px] px-4" onClick={e => e.stopPropagation()}>
                        <div className="text-center text-white text-sm font-medium mb-4 drop-shadow">
                            {padError ? '密码错误，请重试' : '输入锁屏密码'}
                        </div>
                        {/* 四位密码圆点 */}
                        <div
                            className="flex items-center justify-center gap-4 mb-7"
                            style={padError ? { animation: 'lockPadShake 360ms ease-in-out' } : undefined}
                        >
                            {[0, 1, 2, 3].map(i => (
                                <span
                                    key={i}
                                    className={`w-3.5 h-3.5 rounded-full border border-white/80 transition-colors ${i < entered.length ? (padError ? 'bg-red-400 border-red-400' : 'bg-white') : 'bg-transparent'}`}
                                />
                            ))}
                        </div>
                        {/* 3×4 键盘 */}
                        <div className="grid grid-cols-3 gap-3">
                            {keypad.map((key, i) => key === '' ? <span key={i} /> : (
                                <button
                                    key={i}
                                    onClick={() => pressKey(key)}
                                    className="h-[60px] rounded-full bg-white/20 backdrop-blur-md text-white text-2xl font-light flex items-center justify-center active:bg-white/40 transition-colors"
                                >
                                    {key === 'del' ? (
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor" className="w-6 h-6">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9.75 14.25 12m0 0 2.25 2.25M14.25 12l2.25-2.25M14.25 12 12 14.25m-2.58 4.92-6.374-6.375a1.125 1.125 0 0 1 0-1.59L9.42 4.83c.21-.211.497-.33.795-.33H19.5a2.25 2.25 0 0 1 2.25 2.25v10.5a2.25 2.25 0 0 1-2.25 2.25h-9.284c-.298 0-.585-.119-.795-.33Z" />
                                        </svg>
                                    ) : key}
                                </button>
                            ))}
                        </div>
                        <button
                            onClick={(e) => { e.stopPropagation(); setShowPad(false); }}
                            className="w-full mt-5 text-center text-white/80 text-xs font-medium"
                        >
                            取消
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default LockScreen;
