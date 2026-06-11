import React, { useEffect, useRef, useState } from 'react';
import { CharacterProfile, UserProfile } from '../../types';
import {
    OfflineEntry,
    loadOfflineSession,
    saveOfflineSession,
    clearOfflineSession,
    generateOfflineOpening,
    generateOfflineTurn,
    commitOfflineSessionToContext,
} from '../../utils/offlineMode';

/**
 * 线下模式弹窗：角色输出 [[OFFLINE_START]]（自动线下开启时）后弹出。
 * 窗口里只记录线下发生的情景：场景旁白 / 角色言行 / 用户行动。
 * 用户可在输入框发言或行动，角色实时回应；「退出线下」会把全部情景
 * 合成一条 system 消息进入上下文，并由宿主（Chat.tsx）触发角色主动发消息收尾。
 */

interface OfflineModeModalProps {
    char: CharacterProfile;
    userProfile: UserProfile;
    apiConfig: { baseUrl: string; apiKey: string; model: string };
    /** 结束线下模式：情景已落库后回调，宿主负责 reload + 触发角色主动消息 */
    onEnd: () => void;
    addToast: (msg: string, type: 'info' | 'success' | 'error') => void;
}

const OfflineModeModal: React.FC<OfflineModeModalProps> = ({ char, userProfile, apiConfig, onEnd, addToast }) => {
    const [entries, setEntries] = useState<OfflineEntry[]>(() => loadOfflineSession(char.id));
    const [input, setInput] = useState('');
    const [busy, setBusy] = useState(false);
    const [ending, setEnding] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);
    const openingStartedRef = useRef(false);

    const pushEntries = (...added: OfflineEntry[]) => {
        setEntries(prev => {
            const next = [...prev, ...added];
            saveOfflineSession(char.id, next);
            return next;
        });
    };

    // 首次打开（无历史情景）：生成见面开场
    useEffect(() => {
        if (entries.length > 0 || openingStartedRef.current) return;
        openingStartedRef.current = true;
        let cancelled = false;
        (async () => {
            setBusy(true);
            try {
                const opening = await generateOfflineOpening(char, userProfile, apiConfig);
                if (!cancelled && opening) pushEntries({ role: 'scene', text: opening, at: Date.now() });
            } catch (e: any) {
                if (!cancelled) addToast(`线下开场生成失败：${e?.message || e}`, 'error');
            } finally {
                if (!cancelled) setBusy(false);
            }
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, [entries, busy]);

    const runCharTurn = async (userInput?: string) => {
        setBusy(true);
        try {
            const base = userInput
                ? [...entries, { role: 'user' as const, text: userInput, at: Date.now() }]
                : entries;
            const reply = await generateOfflineTurn(char, userProfile, apiConfig, base, userInput);
            if (reply) pushEntries({ role: 'char', text: reply, at: Date.now() });
        } catch (e: any) {
            addToast(`线下情景生成失败：${e?.message || e}`, 'error');
        } finally {
            setBusy(false);
        }
    };

    const handleSend = async () => {
        const text = input.trim();
        if (!text || busy) return;
        setInput('');
        pushEntries({ role: 'user', text, at: Date.now() });
        await runCharTurn(text);
    };

    const handleEnd = async () => {
        if (ending) return;
        setEnding(true);
        try {
            await commitOfflineSessionToContext(char, userProfile.name, entries);
            clearOfflineSession(char.id);
            onEnd();
        } catch (e: any) {
            addToast(`线下记录保存失败：${e?.message || e}`, 'error');
            setEnding(false);
        }
    };

    return (
        <div className="absolute inset-0 z-[420] flex items-center justify-center bg-black/50 animate-fade-in p-4">
            <div className="w-full max-w-[400px] h-[78%] bg-[#fdfaf4] rounded-3xl shadow-2xl flex flex-col overflow-hidden border border-amber-100">
                {/* 头部 */}
                <div className="px-5 py-3.5 flex items-center justify-between shrink-0 bg-gradient-to-r from-amber-50 to-orange-50 border-b border-amber-100">
                    <div className="flex items-center gap-2.5 min-w-0">
                        <img src={char.avatar} className="w-8 h-8 rounded-full object-cover shrink-0" alt="" />
                        <div className="min-w-0">
                            <div className="text-sm font-bold text-slate-800 truncate">线下 · 和{char.name}见面中</div>
                            <div className="text-[10px] text-amber-600/80">这里只记录线下发生的情景</div>
                        </div>
                    </div>
                    <button
                        onClick={handleEnd}
                        disabled={ending}
                        className="shrink-0 px-3 py-1.5 rounded-full text-xs font-bold bg-white text-amber-700 border border-amber-200 active:scale-95 transition-all disabled:opacity-50"
                    >
                        {ending ? '收尾中…' : '退出线下'}
                    </button>
                </div>

                {/* 情景流 */}
                <div ref={scrollRef} className="flex-1 overflow-y-auto no-scrollbar px-5 py-4 space-y-4">
                    {entries.map((e, i) => (
                        e.role === 'scene' ? (
                            <div key={i} className="text-[13px] leading-relaxed text-slate-500 italic bg-amber-50/60 rounded-2xl px-4 py-3 border border-amber-100/80 whitespace-pre-wrap">
                                {e.text}
                            </div>
                        ) : e.role === 'char' ? (
                            <div key={i} className="flex items-start gap-2.5">
                                <img src={char.avatar} className="w-7 h-7 rounded-full object-cover shrink-0 mt-0.5" alt="" />
                                <div className="text-[13px] leading-relaxed text-slate-700 bg-white rounded-2xl rounded-tl-md px-4 py-2.5 shadow-sm border border-slate-100 whitespace-pre-wrap max-w-[85%]">
                                    {e.text}
                                </div>
                            </div>
                        ) : (
                            <div key={i} className="flex justify-end">
                                <div className="text-[13px] leading-relaxed text-white bg-amber-500 rounded-2xl rounded-tr-md px-4 py-2.5 shadow-sm whitespace-pre-wrap max-w-[85%]">
                                    {e.text}
                                </div>
                            </div>
                        )
                    ))}
                    {busy && (
                        <div className="flex items-center gap-2 text-xs text-slate-400 px-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                            现场推进中…
                        </div>
                    )}
                    {!busy && entries.length === 0 && (
                        <div className="text-center text-xs text-slate-400 pt-10">正在布置见面场景…</div>
                    )}
                </div>

                {/* 输入区：发言/行动 + 让角色继续 */}
                <div className="shrink-0 px-4 py-3 bg-white border-t border-slate-100 flex items-center gap-2">
                    <input
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleSend(); }}
                        placeholder="说点什么 / 描述你的行动…"
                        className="flex-1 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-full text-[13px] outline-none focus:border-amber-300"
                        disabled={busy || ending}
                    />
                    {input.trim() ? (
                        <button
                            onClick={handleSend}
                            disabled={busy || ending}
                            className="shrink-0 px-4 py-2.5 rounded-full bg-amber-500 text-white text-xs font-bold active:scale-95 transition-all disabled:opacity-50"
                        >
                            发送
                        </button>
                    ) : (
                        <button
                            onClick={() => { if (!busy && !ending) void runCharTurn(); }}
                            disabled={busy || ending || entries.length === 0}
                            className="shrink-0 px-4 py-2.5 rounded-full bg-slate-100 text-slate-500 text-xs font-bold active:scale-95 transition-all disabled:opacity-50"
                            title="让 TA 继续推进现场"
                        >
                            TA继续
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default OfflineModeModal;
