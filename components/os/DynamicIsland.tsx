import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useOS } from '../../context/OSContext';
import { DB } from '../../utils/db';
import { AppID, CharacterProfile } from '../../types';
import { playRingtone } from '../../utils/ringtone';

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
    charId: string;
    charName: string;
    body: string;
    avatarUrl?: string;
    at: number;
}

const DynamicIsland: React.FC = () => {
    const { unreadMessages, characters, openApp, setActiveCharacterId, clearUnread, activeApp, activeCharacterId } = useOS();
    // 正在跟该角色聊天时不弹横幅（用 ref 让事件监听器拿到最新值，不重挂监听）
    const activeChatRef = useRef<{ app: AppID; charId: string | null }>({ app: activeApp, charId: activeCharacterId });
    activeChatRef.current = { app: activeApp, charId: activeCharacterId };
    const [expanded, setExpanded] = useState(false);
    const [previews, setPreviews] = useState<Record<string, string>>({});
    const [notice, setNotice] = useState<LiveNotice | null>(null);
    const noticeRef = useRef<LiveNotice | null>(null);
    const noticeTimer = useRef<number | null>(null);
    const prevUnreadRef = useRef<Record<string, number>>({});
    const touchStartY = useRef<number | null>(null);

    const unreadEntries = useMemo(() =>
        Object.entries(unreadMessages)
            .filter(([, n]) => n > 0)
            .map(([charId, count]) => ({ char: characters.find(c => c.id === charId), count }))
            .filter((x): x is { char: CharacterProfile; count: number } => !!x.char),
        [unreadMessages, characters]);

    const totalUnread = unreadEntries.reduce((a, b) => a + b.count, 0);

    const showNotice = React.useCallback((n: LiveNotice) => {
        noticeRef.current = n;
        setNotice(n);
        if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
        noticeTimer.current = window.setTimeout(() => {
            noticeRef.current = null;
            setNotice(null);
        }, 5000);
    }, []);

    useEffect(() => () => {
        if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    }, []);

    // 实时联动：主动消息 / instant push 落库事件自带消息正文，第一时间弹横幅
    useEffect(() => {
        const onIncoming = (e: Event) => {
            const d = (e as CustomEvent).detail || {};
            // emotionUpdate 等空 body 事件不弹横幅
            if (!d.charId || !String(d.body || '').trim()) return;
            // 正在该角色聊天页时消息已经可见，不再弹横幅
            const cur = activeChatRef.current;
            if (cur.app === AppID.Chat && cur.charId === d.charId) return;
            // 会话设置「专属铃声」
            playRingtone(characters.find(c => c.id === d.charId)?.convoSettings?.ringtone);
            showNotice({
                charId: d.charId,
                charName: d.charName || characters.find(c => c.id === d.charId)?.name || '',
                body: cleanPreview(String(d.body)),
                avatarUrl: d.avatarUrl,
                at: Date.now(),
            });
        };
        window.addEventListener('proactive-message-sent', onIncoming);
        window.addEventListener('active-msg-received', onIncoming);
        return () => {
            window.removeEventListener('proactive-message-sent', onIncoming);
            window.removeEventListener('active-msg-received', onIncoming);
        };
    }, [characters, showNotice]);

    // 兜底：未读数上涨但没收到带正文的事件（如定时生成的消息）→ 从 DB 取最后一条做预览
    useEffect(() => {
        const prev = prevUnreadRef.current;
        let newest: string | null = null;
        for (const [id, n] of Object.entries(unreadMessages)) {
            if (n > (prev[id] || 0)) newest = id;
        }
        prevUnreadRef.current = { ...unreadMessages };
        if (!newest) return;
        const cur = noticeRef.current;
        if (cur && cur.charId === newest && Date.now() - cur.at < 4000) return; // 事件横幅已带详情
        const char = characters.find(c => c.id === newest);
        if (!char) return;
        let cancelled = false;
        (async () => {
            let body = '发来了新消息';
            try {
                const msgs = await DB.getMessagesByCharId(char.id);
                const visible = msgs.filter(m => m.role !== 'system');
                const last = visible[visible.length - 1];
                if (last) body = cleanPreview(last.content, last.type as any);
            } catch { /* 预览失败不阻塞横幅 */ }
            if (!cancelled) showNotice({ charId: char.id, charName: char.name, body, at: Date.now() });
        })();
        return () => { cancelled = true; };
    }, [unreadMessages, characters, showNotice]);

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
                        // 横幅展示期间点击 = 直达该角色聊天（仿 iOS 通知横幅）
                        if (notice) {
                            const target = notice.charId;
                            if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
                            noticeRef.current = null;
                            setNotice(null);
                            jumpToChat(target);
                            return;
                        }
                        setExpanded(v => !v);
                    }}
                    onTouchStart={(e) => { touchStartY.current = e.touches[0]?.clientY ?? null; }}
                    onTouchMove={(e) => {
                        if (touchStartY.current === null) return;
                        const dy = (e.touches[0]?.clientY ?? 0) - touchStartY.current;
                        if (dy > 24) { setExpanded(true); touchStartY.current = null; }
                    }}
                    onTouchEnd={() => { touchStartY.current = null; }}
                    className="moro-dynamic-island flex items-center justify-center gap-2 rounded-full text-white shadow-lg select-none"
                    style={{
                        background: '#0b0b12',
                        height: notice ? '38px' : '26px',
                        minWidth: notice ? undefined : '92px',
                        maxWidth: '78vw',
                        padding: notice ? '0 14px 0 8px' : '0 12px',
                        animation: notice ? 'islandPop 320ms ease-out' : undefined,
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
