import React, { useEffect, useRef, useState } from 'react';
import { CharacterProfile, UserProfile } from '../../types';
import { WashiTape, MONO_STACK, SERIF_STACK, CUTE_STACK, PAPER_TONES } from '../handbook/paper';
import {
    OfflineEntry,
    OfflinePov,
    OfflinePovPerson,
    OfflineOpeningPreset,
    OFFLINE_OPENING_PRESETS,
    resolveOpeningFrame,
    loadOfflineSession,
    saveOfflineSession,
    clearOfflineSession,
    loadOfflinePov,
    saveOfflinePov,
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
    // 叙述人称：角色 / 用户各可选 第一/第二/第三人称，自由组合（存 localStorage，per-char）
    const [pov, setPov] = useState<OfflinePov>(() => loadOfflinePov(char.id));
    // 开场白方式：新会话先让用户挑这场见面怎么开始（靠近/造访/偶遇/赴约/自定义）；
    // 续上的会话（已有情景）直接跳过选择。
    const [openingChosen, setOpeningChosen] = useState(() => loadOfflineSession(char.id).length > 0);
    const [customScenario, setCustomScenario] = useState('');
    const [customOpen, setCustomOpen] = useState(false);

    const setPovFor = (who: 'char' | 'user', person: OfflinePovPerson) => {
        setPov(prev => {
            const next = { ...prev, [who]: person };
            saveOfflinePov(char.id, next);
            return next;
        });
    };
    const scrollRef = useRef<HTMLDivElement>(null);
    const openingStartedRef = useRef(false);

    const pushEntries = (...added: OfflineEntry[]) => {
        setEntries(prev => {
            const next = [...prev, ...added];
            saveOfflineSession(char.id, next);
            return next;
        });
    };

    // 选定开场白方式后才生成见面开场（不再一打开就自动生成）。
    const startOpening = async (preset: OfflineOpeningPreset) => {
        if (busy || openingStartedRef.current) return;
        if (preset === 'custom' && !customOpen) { setCustomOpen(true); return; }
        const scenario = resolveOpeningFrame(preset, customScenario, char.name, userProfile.name || '你');
        if (preset === 'custom' && !scenario) { addToast('写一句这场见面怎么开始吧～', 'info'); return; }
        openingStartedRef.current = true;
        setOpeningChosen(true);
        setBusy(true);
        try {
            const opening = await generateOfflineOpening(char, userProfile, apiConfig, pov, scenario);
            if (opening) pushEntries({ role: 'scene', text: opening, at: Date.now() });
        } catch (e: any) {
            addToast(`线下开场生成失败：${e?.message || e}`, 'error');
            openingStartedRef.current = false;
            setOpeningChosen(false); // 允许重新选
        } finally {
            setBusy(false);
        }
    };

    useEffect(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, [entries, busy]);

    const runCharTurn = async (userInput?: string) => {
        setBusy(true);
        try {
            const base = userInput
                ? [...entries, { role: 'user' as const, text: userInput, at: Date.now() }]
                : entries;
            const reply = await generateOfflineTurn(char, userProfile, apiConfig, base, userInput, pov);
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

                {/* 叙述人称选择：角色 / 用户各可选 第一(我)/第二(你)/第三(TA)人称，自由组合 */}
                <div className="shrink-0 px-4 py-2 flex items-center gap-x-3 gap-y-1.5 flex-wrap border-b border-dashed" style={{ borderColor: 'rgba(122,90,114,0.16)' }}>
                    <span className="text-[10px] font-bold tracking-wider" style={{ ...MONO_STACK, color: PAPER_TONES.inkFaint }}>人称</span>
                    {([['char', char.name], ['user', userProfile.name || '你']] as const).map(([who, label]) => (
                        <div key={who} className="flex items-center gap-1">
                            <span className="text-[10px]" style={{ color: PAPER_TONES.inkSoft }}>{label}</span>
                            {([['first', '我'], ['second', '你'], ['third', 'TA']] as const).map(([p, lbl]) => {
                                const active = pov[who] === p;
                                return (
                                    <button
                                        key={p}
                                        type="button"
                                        onClick={() => setPovFor(who, p)}
                                        className="px-2 py-0.5 rounded-full text-[10.5px] font-bold transition active:scale-95"
                                        style={active
                                            ? { background: '#f6a7bb', color: '#5d2434', boxShadow: '0 1px 2px rgba(122,90,114,0.2)' }
                                            : { background: 'rgba(255,255,255,0.55)', color: PAPER_TONES.inkSoft, border: '1px dashed #ddc9d3' }}
                                    >
                                        {lbl}
                                    </button>
                                );
                            })}
                        </div>
                    ))}
                </div>

                {/* 情景流 */}
                <div ref={scrollRef} className="flex-1 overflow-y-auto no-scrollbar px-4 py-4 space-y-4">
                    {/* 开场白方式选择：这场见面怎么开始（靠近/造访/偶遇/赴约/自定义） */}
                    {!openingChosen && (
                        <div className="pt-1">
                            <div className="text-center mb-3">
                                <div className="text-[14px] font-bold" style={{ ...SERIF_STACK, color: PAPER_TONES.ink }}>这场见面，怎么开始？</div>
                                <div className="text-[10.5px] mt-1" style={{ color: PAPER_TONES.inkSoft }}>挑一种起手式，下面就照着写开场</div>
                            </div>
                            <div className="space-y-2.5">
                                {OFFLINE_OPENING_PRESETS.map(p => {
                                    const desc = p.desc.replace(/\{char\}/g, char.name).replace(/\{user\}/g, userProfile.name || '你');
                                    return (
                                        <button
                                            key={p.key}
                                            type="button"
                                            disabled={busy}
                                            onClick={() => startOpening(p.key)}
                                            className="w-full text-left rounded-[12px] px-4 py-3 active:scale-[0.98] transition disabled:opacity-50 flex items-center gap-3"
                                            style={{ background: '#fffdfa', border: '1px dashed #ddc9d3', boxShadow: '0 1px 3px rgba(122,90,114,0.12)' }}
                                        >
                                            <span className="text-[22px] shrink-0" aria-hidden>{p.emoji}</span>
                                            <span className="min-w-0">
                                                <span className="block text-[13.5px] font-bold" style={{ ...CUTE_STACK, color: '#b25e7a' }}>{p.label}</span>
                                                <span className="block text-[10.5px] mt-0.5 leading-snug" style={{ color: PAPER_TONES.inkSoft }}>{desc}</span>
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                            {customOpen && (
                                <div className="mt-3 rounded-[12px] px-3 py-3" style={{ background: 'rgba(255,250,232,0.7)', border: '1px dashed #ecd9a0' }}>
                                    <textarea
                                        value={customScenario}
                                        onChange={e => setCustomScenario(e.target.value)}
                                        rows={3}
                                        placeholder="例：在你们常去的那家咖啡馆，TA 已经先到了，正低头翻一本书…"
                                        className="w-full bg-transparent text-[12.5px] outline-none resize-none placeholder:text-[#cbb6a2]"
                                        style={{ color: PAPER_TONES.ink }}
                                    />
                                    <div className="flex justify-end mt-1">
                                        <button
                                            type="button"
                                            disabled={busy || !customScenario.trim()}
                                            onClick={() => startOpening('custom')}
                                            className="px-4 py-1.5 rounded-[10px] text-[11px] font-bold active:translate-y-[1px] transition disabled:opacity-50"
                                            style={{ background: '#f6a7bb', border: '1.5px solid #d97a93', color: '#5d2434', ...CUTE_STACK }}
                                        >
                                            就这么开始
                                        </button>
                                    </div>
                                </div>
                            )}
                            {busy && (
                                <div className="flex items-center justify-center gap-2 text-[11px] pt-4" style={{ color: PAPER_TONES.inkFaint }}>
                                    <span className="animate-pulse" style={{ color: '#f29db0' }} aria-hidden>♥</span>
                                    正在布置见面的场景…
                                </div>
                            )}
                        </div>
                    )}
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
                </div>

                {/* 输入区：发言/行动 + 让角色继续（选好开场白方式后才出现） */}
                {openingChosen && (
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
                )}
            </div>
        </div>
    );
};

export default OfflineModeModal;
