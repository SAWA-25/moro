import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useOS } from '../../context/OSContext';
import { DB } from '../../utils/db';
import { AppID, CharacterProfile, TakeoutOrder } from '../../types';
import { playRingtone } from '../../utils/ringtone';
import { liveTakeoutStatus, STATUS_LABEL, etaText, pickActiveOrders, TAKEOUT_UPDATED_EVENT } from '../../utils/takeout';

/**
 * 灵动岛（Dynamic Island）：悬浮在状态栏中央的黑色胶囊。
 * - 有新消息时展开成「头像 + N 条新消息」的提醒胶囊，几秒后缩回。
 * - 点击 / 下滑胶囊展开通知面板：列出各角色的未读消息，点条目直达对应角色聊天。
 */

const cleanPreview = (content: string, type?: string): string => {
    const cleaned = (content || '').replace(/\[.*?\]/g, '').trim();
    if (cleaned) return cleaned;
    if (type === 'image') return '[图片]';
    if (type === 'voice') return '[语音]';
    return '[消息]';
};

// 实时消息横幅：新消息到达时灵动岛展开展示「头像 + 角色名 + 消息内容」
interface LiveNotice {
    id: string;
    charId: string;
    charName: string;
    body: string;
    avatarUrl?: string;
    at: number;
    ringtone?: Parameters<typeof playRingtone>[0];
}

const DynamicIsland: React.FC = () => {
    const { unreadMessages, characters, openApp, setActiveCharacterId, clearUnread, activeApp, activeCharacterId, theme } = useOS();
    // 灵动岛样式自定义（主题 → 灵动岛）：背景 / 文字色 / 圆角 / 自定义 CSS
    const islandStyle = theme.dynamicIslandStyle;
    // 正在跟该角色聊天时不弹横幅（用 ref 让事件监听器拿到最新值，不重挂监听）
    const activeChatRef = useRef<{ app: AppID; charId: string | null }>({ app: activeApp, charId: activeCharacterId });
    activeChatRef.current = { app: activeApp, charId: activeCharacterId };
    const [expanded, setExpanded] = useState(false);
    const [previews, setPreviews] = useState<Record<string, string>>({});
    const [notice, setNotice] = useState<LiveNotice | null>(null);
    const [noticeStack, setNoticeStack] = useState<LiveNotice[]>([]);
    const noticeRef = useRef<LiveNotice | null>(null);
    const noticeTimers = useRef<number[]>([]);
    const prevUnreadRef = useRef<Record<string, number>>({});
    const touchStartY = useRef<number | null>(null);

    const unreadEntries = useMemo(() =>
        Object.entries(unreadMessages)
            .filter(([, n]) => n > 0)
            .map(([charId, count]) => ({ char: characters.find(c => c.id === charId), count }))
            .filter((x): x is { char: CharacterProfile; count: number } => !!x.char),
        [unreadMessages, characters]);

    const totalUnread = unreadEntries.reduce((a, b) => a + b.count, 0);

    // 记录每个角色最近一次弹过横幅的时间，供未读数兜底去重
    const lastShownRef = useRef<Record<string, number>>({});

    const showNotice = React.useCallback((n: LiveNotice) => {
        lastShownRef.current[n.charId] = Date.now();
        // 每条消息弹出时各响一次提示音；多条消息会在岛下按时间叠成 iOS 式通知栈。
        playRingtone(n.ringtone);
        noticeRef.current = n;
        setNotice(n);
        setNoticeStack(prev => [n, ...prev.filter(item => item.id !== n.id)].slice(0, 5));
        const timer = window.setTimeout(() => {
            setNoticeStack(prev => {
                const next = prev.filter(item => item.id !== n.id);
                const latest = next[0] || null;
                noticeRef.current = latest;
                setNotice(latest);
                return next;
            });
        }, 6200);
        noticeTimers.current.push(timer);
    }, []);

    useEffect(() => () => {
        noticeTimers.current.forEach(t => window.clearTimeout(t));
        noticeTimers.current = [];
    }, []);

    const scheduleNotice = React.useCallback((n: Omit<LiveNotice, 'id'>, delay = 0) => {
        const timer = window.setTimeout(() => {
            showNotice({ ...n, id: `${n.charId}-${n.at}-${Math.random().toString(36).slice(2, 7)}` });
        }, delay);
        noticeTimers.current.push(timer);
    }, [showNotice]);

    // 实时联动：主动消息 / instant push 落库事件自带消息正文，第一时间弹横幅
    useEffect(() => {
        const onIncoming = (e: Event) => {
            const d = (e as CustomEvent).detail || {};
            // emotionUpdate 等空 body 事件不弹横幅
            if (!d.charId || !String(d.body || '').trim()) return;
            // 正在该角色聊天页时消息已经可见，不再弹横幅
            const cur = activeChatRef.current;
            if (cur.app === AppID.Chat && cur.charId === d.charId) return;
            const srcChar = characters.find(c => c.id === d.charId);
            // 会话设置「专属铃声」：挂在每条 notice 上，弹出时逐条播放
            const ringtone = srcChar?.convoSettings?.ringtone;
            // detail.bodies = 本轮逐条消息正文数组（主动消息多气泡时逐条弹横幅）；
            // 没带 bodies 的旧事件退化为单条 body
            const bodies: string[] = (Array.isArray(d.bodies) && d.bodies.length ? d.bodies : [String(d.body)])
                .map((b: any) => cleanPreview(String(b || '')))
                .filter((b: string) => !!b.trim())
                .slice(0, 8);
            const charName = d.charName || srcChar?.name || '';
            bodies.forEach((body, i) => {
                scheduleNotice({ charId: d.charId, charName, body, avatarUrl: d.avatarUrl, at: Date.now() + i, ringtone }, i * 260);
            });
        };
        window.addEventListener('proactive-message-sent', onIncoming);
        window.addEventListener('active-msg-received', onIncoming);
        return () => {
            window.removeEventListener('proactive-message-sent', onIncoming);
            window.removeEventListener('active-msg-received', onIncoming);
        };
    }, [characters, scheduleNotice]);

    // 兜底：未读数上涨但没收到带正文的事件（如定时生成的消息）→ 从 DB 按本次新增条数
    // 取尾部消息，逐条入队弹横幅（一条覆盖一条），而不是只弹最新一条
    useEffect(() => {
        const prev = prevUnreadRef.current;
        const bumps: { id: string; delta: number }[] = [];
        for (const [id, n] of Object.entries(unreadMessages)) {
            const delta = n - (prev[id] || 0);
            if (delta > 0) bumps.push({ id, delta });
        }
        prevUnreadRef.current = { ...unreadMessages };
        if (!bumps.length) return;
        let cancelled = false;
        (async () => {
            for (const { id, delta } of bumps) {
                // 事件横幅（含桌面堆叠卡片）刚弹过该角色时不再兜底重复弹
                if (Date.now() - (lastShownRef.current[id] || 0) < 4000) continue;
                const char = characters.find(c => c.id === id);
                if (!char) continue;
                let bodies: string[] = [];
                try {
                    const msgs = await DB.getMessagesByCharId(char.id);
                    const visible = msgs.filter(m => m.role !== 'system');
                    bodies = visible
                        .slice(-Math.min(delta, 8))
                        .map(m => cleanPreview(m.content, m.type as any));
                } catch { /* 预览失败不阻塞横幅 */ }
                if (!bodies.length) bodies = ['发来了新消息'];
                if (cancelled) return;
                bodies.forEach((body, i) => {
                    scheduleNotice({ charId: char.id, charName: char.name, body, at: Date.now() + i, ringtone: char.convoSettings?.ringtone }, i * 260);
                });
            }
        })();
        return () => { cancelled = true; };
    }, [unreadMessages, characters, scheduleNotice]);

    // 展开面板时为每个未读角色取最后一条消息作预览
    useEffect(() => {
        if (!expanded || unreadEntries.length === 0) return;
        let cancelled = false;
        (async () => {
            const next: Record<string, string> = {};
            for (const { char } of unreadEntries) {
                try {
                    const msgs = await DB.getMessagesByCharId(char.id);
                    const visible = msgs.filter(m => m.role !== 'system');
                    const last = visible[visible.length - 1];
                    if (last) next[char.id] = cleanPreview(last.content, last.type as any);
                } catch { /* 预览失败不阻塞面板 */ }
            }
            if (!cancelled) setPreviews(next);
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [expanded, totalUnread]);

    // ── 外卖 Live Activity：进行中的订单实时显示在灵动岛下方 ──
    const [takeoutOrders, setTakeoutOrders] = useState<TakeoutOrder[]>([]);
    const [, setIslandTick] = useState(0);
    useEffect(() => {
        let alive = true;
        const load = async () => { try { const all = await DB.getTakeoutOrders(); if (alive) setTakeoutOrders(all); } catch { /* ignore */ } };
        void load();
        const timer = window.setInterval(() => { setIslandTick(t => t + 1); void load(); }, 10000);
        const onUpd = () => void load();
        window.addEventListener(TAKEOUT_UPDATED_EVENT, onUpd);
        return () => { alive = false; window.clearInterval(timer); window.removeEventListener(TAKEOUT_UPDATED_EVENT, onUpd); };
    }, []);
    const activeTakeout = useMemo(() => pickActiveOrders(takeoutOrders), [takeoutOrders]);
    const liveOrder = activeTakeout[0] || null;
    const liveStatus = liveOrder ? liveTakeoutStatus(liveOrder) : null;
    const liveStColor = liveStatus === 'arrived' ? '#ffcf6b' : '#ffd161';
    const showTakeoutLive = !!liveOrder && !notice && !expanded;

    const jumpToChat = (charId: string) => {
        setExpanded(false);
        setActiveCharacterId(charId);
        openApp(AppID.Chat);
    };

    const noticeChar = notice ? characters.find(c => c.id === notice.charId) : null;
    const noticeAvatar = noticeChar?.avatar || notice?.avatarUrl;
    const noticeCount = notice ? (unreadMessages[notice.charId] || 0) : 0;

    return (
        <>
            <style>{`
                @keyframes islandDrop { from { opacity: 0; transform: translateY(-10px) scale(0.96); } to { opacity: 1; transform: translateY(0) scale(1); } }
                @keyframes islandPop { 0% { transform: scale(0.9); } 60% { transform: scale(1.04); } 100% { transform: scale(1); } }
            `}</style>
            {islandStyle?.customCss && <style>{islandStyle.customCss}</style>}

            {/* 展开时的遮罩：点空白处收起 */}
            {expanded && (
                <div
                    className="absolute inset-0 z-[58]"
                    style={{ background: 'rgba(15,15,25,0.28)', backdropFilter: 'blur(2px)' }}
                    onClick={() => setExpanded(false)}
                />
            )}

            {/* 胶囊本体 */}
            <div className="absolute left-1/2 -translate-x-1/2 z-[59]" style={{ top: 'max(6px, var(--safe-top))' }}>
                <button
                    onClick={() => {
                        // 横幅展示期间点击 = 直达该角色聊天（仿 iOS 通知横幅）。
                        // 同角色已经堆出的横幅一并丢弃（进聊天页即视为已读），其余角色保留。
                        if (notice) {
                            const target = notice.charId;
                            setNoticeStack(prev => {
                                const next = prev.filter(q => q.charId !== target);
                                const latest = next[0] || null;
                                noticeRef.current = latest;
                                setNotice(latest);
                                return next;
                            });
                            jumpToChat(target);
                            return;
                        }
                        // 灵动岛此刻正作为外卖 Live Activity 展示 → 点击进外卖 App（仍可下滑展开通知）
                        if (showTakeoutLive) { openApp(AppID.Takeout); return; }
                        setExpanded(v => !v);
                    }}
                    onTouchStart={(e) => { touchStartY.current = e.touches[0]?.clientY ?? null; }}
                    onTouchMove={(e) => {
                        if (touchStartY.current === null) return;
                        const dy = (e.touches[0]?.clientY ?? 0) - touchStartY.current;
                        if (dy > 24) { setExpanded(true); touchStartY.current = null; }
                    }}
                    onTouchEnd={() => { touchStartY.current = null; }}
                    className="moro-dynamic-island flex items-center justify-center gap-2 rounded-full shadow-lg select-none"
                    style={{
                        background: islandStyle?.background || '#0b0b12',
                        color: islandStyle?.textColor || '#ffffff',
                        height: (notice || showTakeoutLive) ? '38px' : '26px',
                        minWidth: (notice || showTakeoutLive) ? undefined : '92px',
                        maxWidth: '78vw',
                        padding: (notice || showTakeoutLive) ? '0 14px 0 8px' : '0 12px',
                        ...(typeof islandStyle?.radius === 'number' ? { borderRadius: `${islandStyle.radius}px` } : {}),
                        animation: notice ? 'islandPop 320ms ease-out' : showTakeoutLive ? 'islandDrop 240ms ease-out both' : undefined,
                        transition: 'min-width 300ms ease, height 240ms ease',
                        WebkitTapHighlightColor: 'transparent',
                        boxShadow: '0 8px 20px -8px rgba(0,0,0,0.55)',
                    }}
                    aria-label="通知中心"
                >
                    {notice ? (
                        <>
                            {noticeAvatar ? (
                                <img src={noticeAvatar} className="w-[26px] h-[26px] rounded-full object-cover border border-white/30 shrink-0" alt="" />
                            ) : (
                                <span className="w-[26px] h-[26px] rounded-full bg-white/15 shrink-0" />
                            )}
                            <span className="flex flex-col items-start min-w-0 text-left leading-tight">
                                <span className="text-[10px] font-bold whitespace-nowrap max-w-[200px] truncate">
                                    {notice.charName}{noticeCount > 1 ? ` · ${noticeCount > 99 ? '99+' : noticeCount} 条新消息` : ''}
                                </span>
                                <span className="text-[10px] opacity-70 whitespace-nowrap max-w-[200px] truncate">
                                    {notice.body}
                                </span>
                            </span>
                        </>
                    ) : showTakeoutLive && liveOrder ? (
                        <>
                            <span className="w-[26px] h-[26px] rounded-full flex items-center justify-center text-[15px] shrink-0" style={{ background: 'rgba(255,209,97,0.18)' }}>{liveOrder.riderEmoji || '🛵'}</span>
                            <span className="flex flex-col items-start min-w-0 text-left leading-tight">
                                <span className="text-[10px] font-bold whitespace-nowrap max-w-[200px] truncate" style={{ color: '#ffe1a8' }}>
                                    {liveOrder.storeName}{activeTakeout.length > 1 ? ` 等${activeTakeout.length}单` : ''} · {liveStatus ? STATUS_LABEL[liveStatus] : ''}
                                </span>
                                <span className="text-[10px] opacity-75 whitespace-nowrap max-w-[200px] truncate">{etaText(liveOrder)}</span>
                            </span>
                            <span className="ml-0.5 w-1.5 h-1.5 rounded-full shrink-0 animate-pulse" style={{ background: liveStColor, boxShadow: `0 0 6px ${liveStColor}` }} />
                            {totalUnread > 0 && (
                                <span className="ml-1 px-1.5 py-px rounded-full bg-red-500 text-white text-[9px] font-bold shrink-0">{totalUnread > 99 ? '99+' : totalUnread}</span>
                            )}
                        </>
                    ) : totalUnread > 0 ? (
                        <>
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" style={{ boxShadow: '0 0 6px #34d399' }} />
                            <span className="text-[10px] font-bold whitespace-nowrap">{totalUnread > 99 ? '99+' : totalUnread} 条新消息</span>
                        </>
                    ) : (
                        <span className="w-1.5 h-1.5 rounded-full bg-white/35 shrink-0" />
                    )}
                </button>
            </div>

            {/* iOS 式通知栈：消息一条条从灵动岛下方落下，短暂停驻后自动消散。 */}
            {!expanded && noticeStack.length > 0 && (
                <div
                    className="absolute left-3 right-3 z-[57] pointer-events-none"
                    style={{ top: 'calc(max(6px, var(--safe-top)) + 2.45rem)' }}
                >
                    <div className="relative h-[150px]">
                        {noticeStack.map((n, i) => {
                            const char = characters.find(c => c.id === n.charId);
                            const avatar = char?.avatar || n.avatarUrl;
                            return (
                                <button
                                    key={n.id}
                                    onClick={() => jumpToChat(n.charId)}
                                    className="absolute left-0 right-0 pointer-events-auto rounded-[1.35rem] px-3.5 py-3 flex items-center gap-3 text-left active:scale-[0.985] transition-[transform,opacity] duration-300"
                                    style={{
                                        top: i * 18,
                                        transform: `translateY(${i * 2}px) scale(${1 - i * 0.035})`,
                                        opacity: Math.max(0.36, 1 - i * 0.16),
                                        zIndex: 20 - i,
                                        background: 'rgba(245,245,247,0.88)',
                                        color: '#15151d',
                                        backdropFilter: 'blur(18px) saturate(1.4)',
                                        boxShadow: '0 18px 38px -20px rgba(0,0,0,0.65)',
                                        border: '1px solid rgba(255,255,255,0.72)',
                                        animation: `islandDrop 320ms cubic-bezier(0.18,0.9,0.22,1.12) both`,
                                    }}
                                >
                                    {avatar ? (
                                        <img src={avatar} className="w-10 h-10 rounded-2xl object-cover shrink-0 shadow-sm" alt="" />
                                    ) : (
                                        <span className="w-10 h-10 rounded-2xl bg-slate-200 shrink-0" />
                                    )}
                                    <span className="min-w-0 flex-1">
                                        <span className="flex items-baseline gap-2">
                                            <span className="text-[12px] font-black truncate">{n.charName || char?.name || '新消息'}</span>
                                            <span className="text-[10px] text-slate-400 shrink-0">现在</span>
                                        </span>
                                        <span className="block text-[11px] text-slate-600 truncate mt-0.5">{n.body}</span>
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* 外卖 Live Activity 已并入灵动岛本体（见上方胶囊的 showTakeoutLive 分支），
                不再单独悬浮在岛外，避免「通知出现在灵动岛外」。 */}

            {/* 下滑通知面板 */}
            {expanded && (
                <div
                    className="absolute left-4 right-4 z-[59] rounded-[1.5rem] p-3 text-white border border-white/10"
                    style={{
                        top: 'calc(max(6px, var(--safe-top)) + 2.3rem)',
                        background: 'rgba(13,13,22,0.94)',
                        backdropFilter: 'blur(18px)',
                        boxShadow: '0 24px 48px -16px rgba(0,0,0,0.6)',
                        animation: 'islandDrop 240ms ease-out both',
                    }}
                >
                    <div className="flex items-center justify-between px-2 pb-2">
                        <span className="text-[10px] label-mono font-bold opacity-60 tracking-widest">通知中心</span>
                        {unreadEntries.length > 0 && (
                            <button
                                onClick={() => unreadEntries.forEach(({ char }) => clearUnread(char.id))}
                                className="text-[10px] font-bold opacity-60 hover:opacity-100 transition-opacity px-2 py-1 rounded-full active:scale-95"
                            >
                                全部已读
                            </button>
                        )}
                    </div>

                    {unreadEntries.length === 0 ? (
                        <div className="text-center text-xs opacity-40 py-6">暂无新消息</div>
                    ) : (
                        <div className="space-y-1 max-h-[50vh] overflow-y-auto no-scrollbar">
                            {unreadEntries.map(({ char, count }) => (
                                <button
                                    key={char.id}
                                    onClick={() => jumpToChat(char.id)}
                                    className="w-full flex items-center gap-3 p-2.5 rounded-2xl hover:bg-white/10 active:scale-[0.98] transition-all text-left"
                                >
                                    <img src={char.avatar} className="w-10 h-10 rounded-xl object-cover shrink-0 border border-white/15" alt={char.name} />
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-bold truncate">{char.name}</span>
                                            <span className="px-1.5 py-px rounded-full bg-red-500 text-white text-[9px] font-bold shrink-0">
                                                {count > 99 ? '99+' : count}
                                            </span>
                                        </div>
                                        <div className="text-[11px] opacity-55 truncate mt-0.5">
                                            {previews[char.id] || '发来了新消息'}
                                        </div>
                                    </div>
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5 opacity-30 shrink-0">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                                    </svg>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </>
    );
};

export default DynamicIsland;
