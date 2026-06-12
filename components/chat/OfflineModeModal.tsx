import React, { useEffect, useRef, useState } from 'react';
import { CharacterProfile, UserProfile } from '../../types';
import { WashiTape, MONO_STACK, SERIF_STACK, CUTE_STACK, PAPER_TONES } from '../handbook/paper';
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
        <div className="absolute inset-0 z-[420] flex items-center justify-center animate-fade-in p-4" style={{ background: 'rgba(61,47,61,0.5)', backdropFilter: 'blur(3px)' }}>
            <div
                className="relative w-full max-w-[400px] h-[78%] flex flex-col rounded-[18px]"
                style={{
                    background: '#fff8f3',
                    backgroundImage: 'repeating-linear-gradient(transparent, transparent 25px, rgba(242,157,176,0.14) 25px, rgba(242,157,176,0.14) 26px)',
                    boxShadow: '0 10px 40px rgba(61,47,61,0.35), 0 0 0 1px rgba(220,199,213,0.5) inset',
                }}
            >
                {/* 胶带标题 */}
                <div className="absolute -top-3 left-5 z-10">
                    <WashiTape color="lemon" pattern="heart" rotate={-2}>见面这一页</WashiTape>
                </div>

                {/* 头部 */}
                <div className="px-4 pt-5 pb-3 flex items-center justify-between shrink-0 border-b border-dashed" style={{ borderColor: 'rgba(122,90,114,0.22)' }}>
                    <div className="flex items-center gap-2.5 min-w-0">
                        {/* 别在页角的小照片 */}
                        <div className="shrink-0 bg-white p-0.5 rounded-[3px]" style={{ transform: 'rotate(-4deg)', boxShadow: '0 1px 4px rgba(122,90,114,0.3)' }}>
                            <img src={char.avatar} className="w-8 h-8 object-cover" alt="" />
                        </div>
                        <div className="min-w-0">
                            <div className="text-[13px] font-bold truncate" style={{ ...SERIF_STACK, color: PAPER_TONES.ink }}>和 {char.name} 面对面</div>
                            <div className="text-[9.5px]" style={{ color: PAPER_TONES.inkSoft }}>这一页只写线下发生的事</div>
                        </div>
                    </div>
                    <button
                        onClick={handleEnd}
                        disabled={ending}
                        className="shrink-0 px-3 py-1.5 rounded-full text-[11px] font-bold active:scale-95 transition-all disabled:opacity-50"
                        style={{ background: '#fffdfa', border: '1px dashed #ddc9d3', color: '#b25e7a', boxShadow: '0 1px 2px rgba(122,90,114,0.15)', ...CUTE_STACK }}
                    >
                        {ending ? '收尾中…' : '合上这一页'}
                    </button>
                </div>

                {/* 情景流 */}
                <div ref={scrollRef} className="flex-1 overflow-y-auto no-scrollbar px-4 py-4 space-y-4">
                    {entries.map((e, i) => (
                        e.role === 'scene' ? (
                            // 旁白：贴在页中央的便签
                            <div key={i} className="text-[12.5px] leading-relaxed italic whitespace-pre-wrap rounded-[8px] px-4 py-3" style={{ color: PAPER_TONES.inkSoft, background: 'rgba(255,250,232,0.85)', border: '1px dashed #ecd9a0' }}>
                                {e.text}
                            </div>
                        ) : e.role === 'char' ? (
                            <div key={i} className="flex items-start gap-2.5">
                                <div className="shrink-0 bg-white p-0.5 rounded-[3px] mt-0.5" style={{ transform: 'rotate(-3deg)', boxShadow: '0 1px 3px rgba(122,90,114,0.25)' }}>
                                    <img src={char.avatar} className="w-6 h-6 object-cover" alt="" />
                                </div>
                                <div className="text-[13px] leading-relaxed whitespace-pre-wrap max-w-[85%] px-4 py-2.5" style={{ color: PAPER_TONES.ink, background: '#fffdfa', border: '1px solid #efe2e9', borderRadius: '4px 14px 14px 14px', boxShadow: '0 1px 3px rgba(122,90,114,0.15)' }}>
                                    {e.text}
                                </div>
                            </div>
                        ) : (
                            <div key={i} className="flex justify-end">
                                <div className="text-[13px] leading-relaxed whitespace-pre-wrap max-w-[85%] px-4 py-2.5" style={{ color: '#5d2434', background: '#f6a7bb', border: '1px solid rgba(93,36,52,0.15)', borderRadius: '14px 4px 14px 14px', boxShadow: '0 1px 3px rgba(122,90,114,0.2)' }}>
                                    {e.text}
                                </div>
                            </div>
                        )
                    ))}
                    {busy && (
                        <div className="flex items-center gap-2 text-[11px] px-1" style={{ color: PAPER_TONES.inkFaint }}>
                            <span className="animate-pulse" style={{ color: '#f29db0' }} aria-hidden>♥</span>
                            这一幕还在写…
                        </div>
                    )}
                    {!busy && entries.length === 0 && (
                        <div className="text-center text-[11px] pt-10" style={{ color: PAPER_TONES.inkFaint }}>正在布置见面的场景…</div>
                    )}
                </div>

                {/* 输入区：发言/行动 + 让角色继续 */}
                <div className="shrink-0 px-4 py-3 flex items-center gap-2 border-t border-dashed" style={{ borderColor: 'rgba(122,90,114,0.22)' }}>
                    <input
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleSend(); }}
                        placeholder="说句话，或写下你的动作…"
                        className="flex-1 px-2 py-2 bg-transparent text-[13px] outline-none border-0 border-b border-dashed border-[#dcc3cf] focus:border-[#f29db0] placeholder:text-[#cfb8c4]"
                        style={{ color: PAPER_TONES.ink, caretColor: '#f29db0' }}
                        disabled={busy || ending}
                    />
                    {input.trim() ? (
                        <button
                            onClick={handleSend}
                            disabled={busy || ending}
                            className="shrink-0 px-4 py-2 rounded-[10px] text-[11px] font-bold active:translate-y-[2px] active:shadow-none transition-all disabled:opacity-50"
                            style={{ background: '#f6a7bb', border: '1.5px solid #d97a93', color: '#5d2434', boxShadow: '2px 2px 0 #f3cdd8', ...CUTE_STACK }}
                        >
                            递过去
                        </button>
                    ) : (
                        <button
                            onClick={() => { if (!busy && !ending) void runCharTurn(); }}
                            disabled={busy || ending || entries.length === 0}
                            className="shrink-0 px-4 py-2 rounded-[10px] text-[11px] font-bold active:translate-y-[2px] active:shadow-none transition-all disabled:opacity-50"
                            style={{ background: '#fffdfa', border: '1.5px dashed #ddc9d3', color: '#8a6478', boxShadow: '2px 2px 0 #eadfe6', ...CUTE_STACK }}
                            title="让 TA 继续推进现场"
                        >
                            让 TA 来
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default OfflineModeModal;
