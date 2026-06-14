import React, { useEffect, useMemo, useState } from 'react';
import { useOS } from '../../context/OSContext';
import { DB } from '../../utils/db';
import { AppID, Message } from '../../types';
import { getLockPasscode, isLockPasscodeEnabled } from '../../utils/lockScreenSettings';

/**
 * 锁屏：壁纸 + 大时钟 + 消息通知卡（仿 iPhone 锁屏：每条消息气泡一张卡片，
 * 竖向排列，排不下时折叠成覆盖在最新消息上的堆叠），
 * 解锁需输入锁屏密码（默认 0103，可在设置 App「锁屏与密码」修改/关闭）。
 * 点通知卡 = 解锁后直达对应角色的聊天。
 */

interface LockNotification {
    key: string;
    charId: string;
    name: string;
    avatar: string;
    preview: string;
    timestamp: number;
}

/** 竖向完整展示的卡片数上限；超出的older通知折叠成最底部的覆盖堆叠 */
const MAX_FULL_CARDS = 5;

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
    // 解锁退场动画进行中（主题 → 锁屏 → 解锁动画）
    const [unlocking, setUnlocking] = useState(false);

    const contentColor = theme.contentColor || '#3f3d49';
    // 锁屏样式自定义（主题 → 锁屏）：专属壁纸 / 时钟字体 / 通知卡风格 / 解锁动画 / 自定义 CSS
    const lockStyle = theme.lockScreenStyle;
    const wallpaper = lockStyle?.wallpaper || theme.wallpaper;
    const bgImageValue = wallpaper.startsWith('http') || wallpaper.startsWith('data:') || wallpaper.startsWith('blob:')
        ? `url(${wallpaper})` : wallpaper;

    const clockFontStyle: React.CSSProperties =
        lockStyle?.clockFont === 'sans' ? { fontFamily: 'var(--app-font)', fontStyle: 'normal' }
        : lockStyle?.clockFont === 'mono' ? { fontFamily: 'var(--font-label)', fontStyle: 'normal' }
        : lockStyle?.clockFont === 'hand' ? { fontFamily: 'var(--font-hand)', fontStyle: 'normal' }
        : {}; // 'serif' / 缺省沿用 font-display-italic

    // 通知卡风格：玻璃拟态（默认）/ 纸面手帐 / 墨色
    const notifCardClass =
        lockStyle?.notifCardStyle === 'paper'
            ? 'bg-white/95 rounded-2xl shadow-[0_14px_28px_-18px_rgba(50,48,60,0.45)] border border-slate-100 text-slate-700'
            : lockStyle?.notifCardStyle === 'ink'
                ? 'bg-[#16151d]/90 backdrop-blur-xl rounded-2xl shadow-lg border border-white/10 text-white'
                : 'bg-white/25 backdrop-blur-xl rounded-2xl shadow-lg border border-white/20';

    const unlockAnim = lockStyle?.unlockAnimation || 'fade';
    const UNLOCK_ANIM_MS = unlockAnim === 'none' ? 0 : 360;

    // 未读变化（含锁屏期间新到的主动消息）→ 每条未读消息气泡一张通知卡
    // （角色一次回复拆成几个气泡就出几张卡，与未读数一致），新消息在最上面
    useEffect(() => {
        let cancelled = false;
        (async () => {
            const entries = Object.entries(unreadMessages).filter(([, n]) => (n || 0) > 0).slice(0, 8);
            const out: LockNotification[] = [];
            for (const [charId, count] of entries) {
                const char = characters.find(c => c.id === charId);
                if (!char) continue;
                const perCharCap = Math.min(count || 1, 8);
                let bubbles: Message[] = [];
                try {
                    const msgs = await DB.getRecentMessagesByCharId(charId, perCharCap + 8);
                    bubbles = msgs
                        .filter(m => m.role === 'assistant' && !m.metadata?.hidden)
                        .slice(-perCharCap);
                } catch { /* 取不到就用占位文案 */ }
                if (bubbles.length === 0) bubbles = [undefined as unknown as Message];
                bubbles.forEach((m, i) => out.push({
                    key: `${charId}-${m?.id ?? `ph-${i}`}`,
                    charId,
                    name: char.convoSettings?.remarkName?.trim() || char.name,
                    avatar: char.convoSettings?.charAvatarOverride || char.avatar,
                    preview: previewOf(m),
                    timestamp: m?.timestamp || Date.now(),
                }));
            }
            out.sort((a, b) => b.timestamp - a.timestamp);
            if (!cancelled) setNotifications(out.slice(0, 12));
        })();
        return () => { cancelled = true; };
    }, [unreadMessages, lastMsgTimestamp, characters]);

    const doUnlock = (charId?: string | null) => {
        const finish = () => {
            unlock();
            if (charId) {
                setActiveCharacterId(charId);
                openApp(AppID.Chat);
            }
        };
        if (UNLOCK_ANIM_MS <= 0 || unlocking) { finish(); return; }
        // 先播放退场动画再真正解锁（动画种类来自主题 → 锁屏 → 解锁动画）
        setUnlocking(true);
        window.setTimeout(finish, UNLOCK_ANIM_MS);
    };

    const requestUnlock = (charId?: string | null) => {
        // 注意：这里不再隐式申请通知权限。
        // 旧行为在解锁手势/退场动画期间直接调 Notification.requestPermission()，会和锁屏
        // 这层叠加 + 安卓系统悬浮窗（其他 App 的气泡/叠加层）撞上，触发 Chrome 的
        // 「此网站无法请求您授权 · 请关闭来自其他应用的所有气泡或叠加层」错误弹窗。
        // 通知授权改为完全由用户在「文具盒 → 通知」/ 主动消息设置里显式开启（走
        // browserNotify 的安全封装），不在解锁这种带叠加层的时机突然弹系统授权。
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
            style={{
                backgroundImage: bgImageValue,
                color: contentColor,
                animation: unlocking
                    ? `lockExit${unlockAnim === 'slide' ? 'Slide' : unlockAnim === 'zoom' ? 'Zoom' : 'Fade'} ${UNLOCK_ANIM_MS}ms ease-in both`
                    : 'lockReveal 600ms ease-out both',
            }}
            onClick={() => { if (!showPad && !unlocking) requestUnlock(); }}
        >
            {/* 锁屏柔和淡入：与开机「世界入场」退场衔接；body 背景本就是壁纸，故是无缝融入而非硬切。 */}
            <style>{`
                @keyframes lockReveal{from{opacity:0}to{opacity:1}}
                @keyframes lockNotifIn{from{opacity:0;transform:translateY(-14px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}
                @keyframes lockPadShake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-7px)}40%,80%{transform:translateX(7px)}}
                @keyframes lockExitFade{from{opacity:1}to{opacity:0}}
                @keyframes lockExitSlide{from{opacity:1;transform:translateY(0)}to{opacity:0;transform:translateY(-12%)}}
                @keyframes lockExitZoom{from{opacity:1;transform:scale(1)}to{opacity:0;transform:scale(1.12)}}
            `}</style>
            {theme.globalCustomCss && <style>{theme.globalCustomCss}</style>}
            {lockStyle?.customCss && <style>{lockStyle.customCss}</style>}
            <div className="absolute inset-0 bg-black/5 backdrop-blur-sm" />

            {/* 治愈系氛围光斑：缓慢漂移的暖紫/蜜桃光晕 */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <div className="absolute -top-16 -left-16 w-72 h-72 rounded-full animate-drift-slow"
                     style={{ background: 'radial-gradient(circle, rgba(196,181,253,0.28), transparent 70%)' }} />
                <div className="absolute -bottom-20 -right-12 w-80 h-80 rounded-full animate-drift-slower"
                     style={{ background: 'radial-gradient(circle, rgba(253,213,184,0.25), transparent 70%)' }} />
            </div>

            {/* 时钟（字体风格来自主题 → 锁屏 → 时钟字体） */}
            <div className="moro-lock-clock absolute top-16 w-full text-center pointer-events-none">
                <div className="text-[10px] label-mono font-bold opacity-50 mb-2">Moro · Lock</div>
                <div className="text-7xl tracking-tight opacity-95 font-display-italic font-semibold" style={clockFontStyle}>
                    {virtualTime.hours.toString().padStart(2, '0')}<span className="animate-pulse">:</span>{virtualTime.minutes.toString().padStart(2, '0')}
                </div>
                <div className="label-mono opacity-70 mt-2 text-[10px] font-bold">Moro Simulation</div>
            </div>

            {/* 消息通知（仿 iPhone 锁屏）：每条消息气泡一张卡片竖向排列，新消息在上；
                排不下（超过 MAX_FULL_CARDS）时其余通知折叠成覆盖在最新一批下方的堆叠 */}
            {notifications.length > 0 && (
                <div className="absolute top-[34%] left-3 right-3 space-y-2 max-h-[44%] overflow-y-auto no-scrollbar pb-4">
                    {notifications.slice(0, MAX_FULL_CARDS).map((n, i) => (
                        <div
                            key={n.key}
                            onClick={(e) => { e.stopPropagation(); requestUnlock(n.charId); }}
                            className={`moro-lock-notif ${notifCardClass} p-3.5 flex items-center gap-3 cursor-pointer active:scale-[0.98] transition-transform`}
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
                        </div>
                    ))}
                    {notifications.length > MAX_FULL_CARDS && (
                        <div
                            onClick={(e) => { e.stopPropagation(); requestUnlock(notifications[MAX_FULL_CARDS].charId); }}
                            className="relative cursor-pointer active:scale-[0.98] transition-transform"
                            style={{ animation: `lockNotifIn 420ms cubic-bezier(0.2,0.9,0.3,1.2) both`, animationDelay: `${MAX_FULL_CARDS * 70}ms` }}
                        >
                            {/* 仿 iOS 的折叠堆叠：两层卡片边缘从最上面那张下探出来 */}
                            <div className="absolute left-3 right-3 -bottom-1.5 h-4 rounded-2xl bg-white/15 backdrop-blur-xl border border-white/15" />
                            <div className="absolute left-6 right-6 -bottom-3 h-4 rounded-2xl bg-white/10 backdrop-blur-xl border border-white/10" />
                            <div className={`moro-lock-notif relative ${notifCardClass} p-3 flex items-center gap-3`}>
                                <img src={notifications[MAX_FULL_CARDS].avatar} alt="" className="w-8 h-8 rounded-xl object-cover shrink-0 shadow-sm" />
                                <div className="flex-1 min-w-0 text-left">
                                    <div className="text-xs font-bold truncate">{notifications[MAX_FULL_CARDS].name}</div>
                                    <div className="text-[11px] opacity-80 truncate mt-0.5">{notifications[MAX_FULL_CARDS].preview}</div>
                                </div>
                                <span className="shrink-0 text-[10px] font-bold opacity-70">还有 {notifications.length - MAX_FULL_CARDS} 条</span>
                            </div>
                        </div>
                    )}
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
