import React, { useEffect, useRef, useState } from 'react';
import { ArrowsClockwise, Check, PencilSimple, X } from '@phosphor-icons/react';
import { CharacterProfile, UserProfile } from '../../types';
import { useOS } from '../../context/OSContext';
import { MONO_STACK, SERIF_STACK, CUTE_STACK, PAPER_TONES } from '../handbook/paper';
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
    markOfflineSessionActive,
    loadOfflinePov,
    saveOfflinePov,
    loadOfflineWordLimit,
    normalizeOfflineWordLimitValue,
    saveOfflineWordLimit,
    generateOfflineOpening,
    generateOfflineTurn,
    commitOfflineSessionToContext,
    prepareOfflineGeneratedText,
    type OfflineCommitInfo,
    type OfflineWordLimit,
} from '../../utils/offlineMode';
import { TAKEOUT_ORDER_EVENT } from '../../utils/takeout';

/**
 * 线下模式弹窗：角色输出 [[OFFLINE_START]]（自动线下开启时）后弹出。
 * 窗口里只记录线下发生的情景：场景旁白 / 角色言行 / 用户行动。
 * 用户可在输入框发言或行动，角色实时回应；「退出线下」会把全部情景
 * 合成一条 system 消息进入上下文，并由宿主（Chat.tsx）延迟酌情收尾。
 */

interface OfflineModeModalProps {
    char: CharacterProfile;
    userProfile: UserProfile;
    /** 线下场景生成用的 API。宿主传文具盒主 API，让面对面现场跟主聊天模型保持一致。 */
    apiConfig: { baseUrl: string; apiKey: string; model: string };
    /** 自动线下触发时传入：跳过手动开场选择，直接承接最近聊天生成第一幕。 */
    autoStartScenario?: string;
    /** 结束线下模式：情景已落库后回调，宿主负责 reload + 延迟收尾 */
    onEnd: (info: OfflineCommitInfo | null) => void;
    /** 挂起线下模式：只收起窗口，保留 localStorage 草稿，不落库、不触发收尾 */
    onSuspend: (entryCount: number) => void;
    addToast: (msg: string, type: 'info' | 'success' | 'error') => void;
}

const OfflineModeModal: React.FC<OfflineModeModalProps> = ({ char, userProfile, apiConfig, autoStartScenario, onEnd, onSuspend, addToast }) => {
    const { theme } = useOS();
    const modalStyle = theme.offlineModeStyle || {};
    const modalBg = modalStyle.background || 'linear-gradient(180deg,#fffdfa,#fff4f7)';
    const modalInk = modalStyle.textColor || '#5a3140';
    const modalAccent = modalStyle.accentColor || '#d8a5b7';
    const modalRadius = typeof modalStyle.radius === 'number' ? Math.max(0, Math.min(32, modalStyle.radius)) : 22;
    const [entries, setEntries] = useState<OfflineEntry[]>(() => loadOfflineSession(char.id));
    const [input, setInput] = useState('');
    const [busy, setBusy] = useState(false);
    const [ending, setEnding] = useState(false);
    const [editingIndex, setEditingIndex] = useState<number | null>(null);
    const [editingText, setEditingText] = useState('');
    // 叙述人称：角色 / 用户各可选 第一/第二/第三人称，自由组合（存 localStorage，per-char）
    const [pov, setPov] = useState<OfflinePov>(() => loadOfflinePov(char.id));
    // 开场白方式：新会话先让用户挑这场见面怎么开始（靠近/造访/偶遇/赴约/自定义）；
    // 续上的会话（已有情景）直接跳过选择。
    const [openingChosen, setOpeningChosen] = useState(() => loadOfflineSession(char.id).length > 0 || !!autoStartScenario?.trim());
    const [customScenario, setCustomScenario] = useState('');
    const [customOpen, setCustomOpen] = useState(false);
    const [wordLimitText, setWordLimitText] = useState(() => {
        const saved = loadOfflineWordLimit(char.id).maxChars;
        return saved ? String(saved) : '';
    });

    const setPovFor = (who: 'char' | 'user', person: OfflinePovPerson) => {
        setPov(prev => {
            const next = { ...prev, [who]: person };
            saveOfflinePov(char.id, next);
            return next;
        });
    };
    const scrollRef = useRef<HTMLDivElement>(null);
    const openingStartedRef = useRef(false);
    const openingScenarioRef = useRef('');
    const isEditing = editingIndex !== null;

    const currentWordLimit = (): OfflineWordLimit => {
        const maxChars = normalizeOfflineWordLimitValue(wordLimitText);
        return maxChars ? { maxChars } : {};
    };

    const updateWordLimitText = (value: string) => {
        const nextText = value.replace(/[^\d]/g, '').slice(0, 4);
        setWordLimitText(nextText);
        const maxChars = normalizeOfflineWordLimitValue(nextText);
        saveOfflineWordLimit(char.id, maxChars ? { maxChars } : {});
    };

    const normalizeWordLimitText = () => {
        const maxChars = normalizeOfflineWordLimitValue(wordLimitText);
        setWordLimitText(maxChars ? String(maxChars) : '');
    };

    useEffect(() => {
        markOfflineSessionActive(char.id);
    }, [char.id]);

    const persistEntries = (next: OfflineEntry[]) => {
        setEntries(next);
        saveOfflineSession(char.id, next);
    };

    const pushEntries = (...added: OfflineEntry[]) => {
        setEntries(prev => {
            const next = [...prev, ...added];
            saveOfflineSession(char.id, next);
            return next;
        });
    };

    const consumeGeneratedText = (raw: string): string => {
        const processed = prepareOfflineGeneratedText(raw);
        if (processed.takeoutDesc !== undefined) {
            window.dispatchEvent(new CustomEvent(TAKEOUT_ORDER_EVENT, {
                detail: { charId: char.id, desc: processed.takeoutDesc },
            }));
        }
        return processed.content;
    };

    const beginEditEntry = (index: number, text: string) => {
        if (busy || ending) return;
        setEditingIndex(index);
        setEditingText(text);
    };

    const cancelEditEntry = () => {
        setEditingIndex(null);
        setEditingText('');
    };

    const saveEditEntry = () => {
        if (editingIndex === null) return;
        const text = editingText.trim();
        if (!text) {
            addToast('线下内容不能为空', 'info');
            return;
        }
        setEntries(prev => {
            if (!prev[editingIndex]) return prev;
            const next = prev.map((entry, index) => index === editingIndex ? { ...entry, text } : entry);
            saveOfflineSession(char.id, next);
            return next;
        });
        setEditingIndex(null);
        setEditingText('');
    };

    const startOpeningFromScenario = async (scenario: string, failurePrefix = '线下开场生成失败') => {
        if (busy || openingStartedRef.current) return;
        openingStartedRef.current = true;
        openingScenarioRef.current = scenario;
        setOpeningChosen(true);
        setBusy(true);
        try {
            const opening = consumeGeneratedText(await generateOfflineOpening(char, userProfile, apiConfig, pov, scenario, undefined, currentWordLimit()));
            if (opening) pushEntries({ role: 'scene', text: opening, at: Date.now() });
        } catch (e: any) {
            addToast(`${failurePrefix}：${e?.message || e}`, 'error');
            openingStartedRef.current = false;
            setOpeningChosen(false); // 允许重新选
        } finally {
            setBusy(false);
        }
    };

    // 选定开场白方式后才生成见面开场；自动线下会传入 scenario 并跳过选择。
    const startOpening = async (preset: OfflineOpeningPreset) => {
        if (busy || openingStartedRef.current) return;
        if (preset === 'custom' && !customOpen) { setCustomOpen(true); return; }
        const scenario = resolveOpeningFrame(preset, customScenario, char.name, userProfile.name || '你');
        if (preset === 'custom' && !scenario) { addToast('写一句这场见面怎么开始吧～', 'info'); return; }
        await startOpeningFromScenario(scenario);
    };

    useEffect(() => {
        const scenario = autoStartScenario?.trim();
        if (!scenario || entries.length > 0 || openingStartedRef.current) return;
        void startOpeningFromScenario(scenario, '自动线下开场生成失败');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoStartScenario, char.id]);

    useEffect(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, [entries, busy]);

    const runCharTurn = async (userInput?: string) => {
        if (isEditing) return;
        setBusy(true);
        try {
            const base = userInput
                ? [...entries, { role: 'user' as const, text: userInput, at: Date.now() }]
                : entries;
            const reply = consumeGeneratedText(await generateOfflineTurn(char, userProfile, apiConfig, base, userInput, pov, undefined, currentWordLimit()));
            if (reply) pushEntries({ role: 'char', text: reply, at: Date.now() });
        } catch (e: any) {
            addToast(`线下情景生成失败：${e?.message || e}`, 'error');
        } finally {
            setBusy(false);
        }
    };

    const lastUserInputOf = (items: OfflineEntry[]): string | undefined => {
        for (let i = items.length - 1; i >= 0; i--) {
            if (items[i].role === 'user') return items[i].text;
        }
        return undefined;
    };

    const handleRerollLastGenerated = async () => {
        if (busy || ending || isEditing) return;
        const last = entries[entries.length - 1];
        if (!last) {
            addToast('还没有可重写的线下内容', 'info');
            return;
        }
        if (last.role === 'user') {
            addToast('先让 TA 接一下，再重写上一段现场', 'info');
            return;
        }
        const original = entries;
        const baseEntries = entries.slice(0, -1);
        persistEntries(baseEntries);
        setBusy(true);
        try {
            if (last.role === 'scene') {
                const opening = consumeGeneratedText(await generateOfflineOpening(
                    char,
                    userProfile,
                    apiConfig,
                    pov,
                    openingScenarioRef.current || undefined,
                    last.text,
                    currentWordLimit(),
                ));
                persistEntries(opening ? [...baseEntries, { role: 'scene', text: opening, at: Date.now() }] : baseEntries);
            } else {
                const reply = consumeGeneratedText(await generateOfflineTurn(
                    char,
                    userProfile,
                    apiConfig,
                    baseEntries,
                    lastUserInputOf(baseEntries),
                    pov,
                    last.text,
                    currentWordLimit(),
                ));
                persistEntries(reply ? [...baseEntries, { role: 'char', text: reply, at: Date.now() }] : baseEntries);
            }
            addToast('上一段线下现场已重写', 'success');
        } catch (e: any) {
            persistEntries(original);
            addToast(`线下重写失败：${e?.message || e}`, 'error');
        } finally {
            setBusy(false);
        }
    };

    const handleSend = async () => {
        const text = input.trim();
        if (!text || busy || isEditing) return;
        setInput('');
        pushEntries({ role: 'user', text, at: Date.now() });
        await runCharTurn(text);
    };

    const handleEnd = async () => {
        if (ending || isEditing) return;
        setEnding(true);
        try {
            const commitInfo = await commitOfflineSessionToContext(char, userProfile.name, entries);
            clearOfflineSession(char.id);
            onEnd(commitInfo);
        } catch (e: any) {
            addToast(`线下记录保存失败：${e?.message || e}`, 'error');
            setEnding(false);
        }
    };

    const handleSuspend = () => {
        if (busy || ending || isEditing || entries.length === 0) return;
        saveOfflineSession(char.id, entries);
        onSuspend(entries.length);
    };

    const renderEntryText = (text: string, index: number, onAccent = false) => {
        const editingThis = editingIndex === index;
        const editButtonStyle = onAccent
            ? { background: 'rgba(255,255,255,0.18)', border: '1px solid rgba(255,255,255,0.34)', color: '#fffdfa' }
            : { background: 'rgba(255,255,255,0.72)', border: '1px solid #eed6df', color: modalInk };
        if (editingThis) {
            return (
                <>
                    <textarea
                        value={editingText}
                        onChange={e => setEditingText(e.target.value)}
                        rows={4}
                        autoFocus
                        spellCheck={false}
                        className="w-full min-h-[88px] bg-transparent text-[13px] leading-relaxed outline-none resize-y placeholder:text-[#a9a195]"
                        style={{ color: onAccent ? '#fffdfa' : modalInk, caretColor: onAccent ? '#fffdfa' : modalAccent }}
                    />
                    <div className="mt-2 flex justify-end gap-1.5">
                        <button
                            type="button"
                            onClick={saveEditEntry}
                            className="w-7 h-7 rounded-full flex items-center justify-center active:scale-95 transition disabled:opacity-50"
                            style={{ background: onAccent ? 'rgba(255,255,255,0.28)' : modalAccent, border: onAccent ? '1px solid rgba(255,255,255,0.42)' : `1px solid ${modalAccent}`, color: '#fffdfa' }}
                            title="保存修改"
                        >
                            <Check size={14} weight="bold" />
                        </button>
                        <button
                            type="button"
                            onClick={cancelEditEntry}
                            className="w-7 h-7 rounded-full flex items-center justify-center active:scale-95 transition"
                            style={editButtonStyle}
                            title="取消修改"
                        >
                            <X size={14} weight="bold" />
                        </button>
                    </div>
                </>
            );
        }
        return (
            <>
                <div>{text}</div>
                <div className="mt-2 flex justify-end">
                    <button
                        type="button"
                        onClick={() => beginEditEntry(index, text)}
                        disabled={busy || ending || (isEditing && !editingThis)}
                        className="w-7 h-7 rounded-full flex items-center justify-center active:scale-95 transition disabled:opacity-40"
                        style={editButtonStyle}
                        title="修改这条线下内容"
                    >
                        <PencilSimple size={14} weight="bold" />
                    </button>
                </div>
            </>
        );
    };

    const displayedWordLimit = normalizeOfflineWordLimitValue(wordLimitText);

    return (
        <div className="moro-offline-modal-backdrop absolute inset-0 z-[420] flex items-center justify-center animate-fade-in p-4" style={{ background: 'rgba(20,18,16,0.5)', backdropFilter: 'blur(3px)' }}>
            {modalStyle.customCss && <style>{modalStyle.customCss}</style>}
            <div
                className="moro-offline-modal relative w-full max-w-[400px] h-[78%] flex flex-col overflow-hidden"
                style={{
                    background: modalBg,
                    color: modalInk,
                    borderRadius: modalRadius,
                    boxShadow: '0 24px 60px -24px rgba(122,90,114,0.35), 0 0 0 1px #eed6df inset',
                }}
            >

                {/* 头部 */}
                <div className="moro-offline-modal-header px-4 pt-5 pb-3 flex items-center justify-between shrink-0 border-b" style={{ borderColor: '#eed6df' }}>
                    <div className="flex items-center gap-2.5 min-w-0">
                        <div className="shrink-0 bg-white p-0.5 rounded-[8px]" style={{ border: '1px solid #eed6df', boxShadow: '0 8px 18px -14px rgba(122,90,114,0.45)' }}>
                            <img src={char.avatar} className="w-8 h-8 object-cover" alt="" />
                        </div>
                        <div className="min-w-0">
                            <div className="text-[13px] font-bold truncate" style={{ ...SERIF_STACK, color: modalInk }}>和 {char.name} 面对面</div>
                            <div className="text-[9.5px]" style={{ color: '#a892a3' }}>只记录线下发生的事</div>
                        </div>
                    </div>
                    <div className="shrink-0 flex items-center gap-1.5">
                        <button
                            type="button"
                            onClick={() => void handleRerollLastGenerated()}
                            disabled={busy || ending || isEditing || entries.length === 0}
                            className="px-2.5 py-1.5 rounded-full text-[11px] font-bold flex items-center gap-1 active:scale-95 transition-all disabled:opacity-50"
                            style={{ background: 'rgba(255,253,250,0.72)', border: '1px solid #eed6df', color: '#8a6478', boxShadow: '0 1px 2px rgba(122,90,114,0.08)' }}
                            title={isEditing ? '先保存或取消正在修改的内容' : '重写上一段线下现场'}
                            aria-label="重写上一段线下现场"
                        >
                            <ArrowsClockwise size={13} weight="bold" />
                            重写
                        </button>
                        <button
                            onClick={handleSuspend}
                            disabled={busy || ending || isEditing || entries.length === 0}
                            className="px-3 py-1.5 rounded-full text-[11px] font-bold active:scale-95 transition-all disabled:opacity-50"
                            style={{ background: 'rgba(255,253,250,0.72)', border: '1px solid #eed6df', color: '#8a6478', boxShadow: '0 1px 2px rgba(122,90,114,0.08)', ...CUTE_STACK }}
                            title={isEditing ? '先保存或取消正在修改的内容' : entries.length === 0 ? '先开始这场见面后再挂起' : '收起窗口，稍后继续这场线下现场'}
                        >
                            挂起
                        </button>
                        <button
                            onClick={handleEnd}
                            disabled={ending || isEditing}
                            className="px-3 py-1.5 rounded-full text-[11px] font-bold active:scale-95 transition-all disabled:opacity-50"
                            style={{ background: '#fffdfa', border: '1px solid #eed6df', color: modalInk, boxShadow: '0 1px 2px rgba(122,90,114,0.12)', ...CUTE_STACK }}
                            title={isEditing ? '先保存或取消正在修改的内容' : undefined}
                        >
                            {ending ? '保存中…' : '结束线下'}
                        </button>
                    </div>
                </div>

                {/* 叙述人称选择：角色 / 用户各可选 第一(我)/第二(你)/第三(TA)人称，自由组合 */}
                <div className="shrink-0 px-4 py-2 flex items-center gap-x-3 gap-y-1.5 flex-wrap border-b" style={{ borderColor: '#eed6df' }}>
                    <span className="text-[10px] font-bold tracking-wider" style={{ ...MONO_STACK, color: '#a892a3' }}>人称</span>
                    {([['char', char.name], ['user', userProfile.name || '你']] as const).map(([who, label]) => (
                        <div key={who} className="flex items-center gap-1">
                            <span className="text-[10px]" style={{ color: '#a892a3' }}>{label}</span>
                            {([['first', '我'], ['second', '你'], ['third', 'TA']] as const).map(([p, lbl]) => {
                                const active = pov[who] === p;
                                return (
                                    <button
                                        key={p}
                                        type="button"
                                        onClick={() => setPovFor(who, p)}
                                        className="px-2 py-0.5 rounded-full text-[10.5px] font-bold transition active:scale-95"
                                        style={active
                                            ? { background: modalAccent, color: '#fffdfa', boxShadow: '0 1px 2px rgba(122,90,114,0.2)' }
                                            : { background: 'rgba(255,255,255,0.65)', color: '#a892a3', border: '1px solid #eed6df' }}
                                    >
                                        {lbl}
                                    </button>
                                );
                            })}
                        </div>
                    ))}
                </div>

                <div className="shrink-0 px-4 py-2 flex items-center gap-2 border-b" style={{ borderColor: '#eed6df' }}>
                    <span className="text-[10px] font-bold tracking-wider shrink-0" style={{ ...MONO_STACK, color: '#a892a3' }}>字数</span>
                    <input
                        value={wordLimitText}
                        onChange={e => updateWordLimitText(e.target.value)}
                        onBlur={normalizeWordLimitText}
                        inputMode="numeric"
                        pattern="[0-9]*"
                        placeholder="默认"
                        aria-label="线下生成字数上限"
                        className="w-[76px] px-2 py-1 rounded-[8px] text-[11px] font-bold outline-none"
                        style={{ background: 'rgba(255,255,255,0.65)', border: '1px solid #eed6df', color: modalInk, caretColor: modalAccent, ...MONO_STACK }}
                    />
                    <span className="text-[10.5px] shrink-0" style={{ color: '#a892a3' }}>字以内</span>
                    {displayedWordLimit && (
                        <button
                            type="button"
                            onClick={() => updateWordLimitText('')}
                            className="w-6 h-6 rounded-full flex items-center justify-center active:scale-95 transition"
                            style={{ background: 'rgba(255,255,255,0.65)', border: '1px solid #eed6df', color: '#a892a3' }}
                            title="恢复默认字数"
                            aria-label="恢复默认字数"
                        >
                            <X size={12} weight="bold" />
                        </button>
                    )}
                    <span className="text-[10px] min-w-0 truncate" style={{ color: '#a892a3' }}>
                        {displayedWordLimit ? `${displayedWordLimit} 字上限` : '开场和续写沿用默认长度'}
                    </span>
                </div>

                {/* 情景流 */}
                <div ref={scrollRef} className="flex-1 overflow-y-auto no-scrollbar px-4 py-4 space-y-4">
                    {/* 开场白方式选择：这场见面怎么开始（靠近/造访/偶遇/赴约/自定义） */}
                    {!openingChosen && (
                        <div className="pt-1">
                            <div className="text-center mb-3">
                                <div className="text-[14px] font-bold" style={{ ...SERIF_STACK, color: modalInk }}>这场见面怎么开始？</div>
                                <div className="text-[10.5px] mt-1" style={{ color: '#a892a3' }}>选择开场方式，系统会生成线下开场</div>
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
                                            style={{ background: '#fffdfa', border: '1px solid #eed6df', boxShadow: '0 1px 3px rgba(122,90,114,0.12)' }}
                                        >
                                            <span className="text-[22px] shrink-0" aria-hidden>{p.emoji}</span>
                                            <span className="min-w-0">
                                                <span className="block text-[13.5px] font-bold" style={{ ...CUTE_STACK, color: modalInk }}>{p.label}</span>
                                                <span className="block text-[10.5px] mt-0.5 leading-snug" style={{ color: '#a892a3' }}>{desc}</span>
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                            {customOpen && (
                                <div className="mt-3 rounded-[12px] px-3 py-3" style={{ background: '#fffdfa', border: '1px solid #eed6df' }}>
                                    <textarea
                                        value={customScenario}
                                        onChange={e => setCustomScenario(e.target.value)}
                                        rows={3}
                                        placeholder="例：在你们常去的那家咖啡馆，TA 已经先到了，正低头翻一本书…"
                                        className="w-full bg-transparent text-[12.5px] outline-none resize-none placeholder:text-[#a9a195]"
                                        style={{ color: '#5a3140' }}
                                    />
                                    <div className="flex justify-end mt-1">
                                        <button
                                            type="button"
                                            disabled={busy || !customScenario.trim()}
                                            onClick={() => startOpening('custom')}
                                            className="px-4 py-1.5 rounded-[10px] text-[11px] font-bold active:translate-y-[1px] transition disabled:opacity-50"
                                            style={{ background: '#d8a5b7', border: '1px solid #d8a5b7', color: '#fff', ...CUTE_STACK }}
                                        >
                                            就这么开始
                                        </button>
                                    </div>
                                </div>
                            )}
                            {busy && (
                                <div className="flex items-center justify-center gap-2 text-[11px] pt-4" style={{ color: '#857f74' }}>
                                    <span className="animate-pulse" style={{ color: '#d8a5b7' }} aria-hidden>♥</span>
                                    正在布置见面的场景…
                                </div>
                            )}
                        </div>
                    )}
                    {entries.map((e, i) => (
                        e.role === 'scene' ? (
                            // 旁白：贴在页中央的便签
                            <div key={i} className="moro-offline-modal-entry moro-offline-modal-scene text-[12.5px] leading-relaxed italic whitespace-pre-wrap rounded-[8px] px-4 py-3" style={{ color: '#857f74', background: '#fffdfa', border: '1px solid #eed6df' }}>
                                {renderEntryText(e.text, i)}
                            </div>
                        ) : e.role === 'char' ? (
                            <div key={i} className="flex items-start gap-2.5">
                                <div className="shrink-0 bg-white p-0.5 rounded-[8px] mt-0.5" style={{ transform: 'none', boxShadow: '0 1px 3px rgba(122,90,114,0.16)' }}>
                                    <img src={char.avatar} className="w-6 h-6 object-cover" alt="" />
                                </div>
                                <div className="moro-offline-modal-entry moro-offline-modal-char text-[13px] leading-relaxed whitespace-pre-wrap max-w-[85%] px-4 py-2.5" style={{ color: modalInk, background: '#fffdfa', border: '1px solid #efe2e9', borderRadius: '4px 14px 14px 14px', boxShadow: '0 1px 3px rgba(122,90,114,0.16)' }}>
                                    {renderEntryText(e.text, i)}
                                </div>
                            </div>
                        ) : (
                            <div key={i} className="flex justify-end">
                                <div className="moro-offline-modal-entry moro-offline-modal-user text-[13px] leading-relaxed whitespace-pre-wrap max-w-[85%] px-4 py-2.5" style={{ color: '#fffdfa', background: modalAccent, border: '1px solid rgba(216,165,183,0.55)', borderRadius: '14px 4px 14px 14px', boxShadow: '0 1px 3px rgba(122,90,114,0.18)' }}>
                                    {renderEntryText(e.text, i, true)}
                                </div>
                            </div>
                        )
                    ))}
                    {busy && (
                        <div className="flex items-center gap-2 text-[11px] px-1" style={{ color: '#857f74' }}>
                            <span className="animate-pulse" style={{ color: '#d8a5b7' }} aria-hidden>♥</span>
                            这一幕还在写…
                        </div>
                    )}
                </div>

                {/* 输入区：发言/行动 + 让角色继续（选好开场白方式后才出现） */}
                {openingChosen && (
                <div className="moro-offline-modal-inputbar shrink-0 px-4 py-3 flex items-center gap-2 border-t" style={{ borderColor: '#eed6df' }}>
                    <input
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleSend(); }}
                        placeholder="说句话，或写下你的动作…"
                        className="flex-1 px-2 py-2 bg-transparent text-[13px] outline-none border-0 border-b border-[#dcc3cf] focus:border-[#d8a5b7] placeholder:text-[#a9a195]"
                        style={{ color: modalInk, caretColor: modalAccent }}
                        disabled={busy || ending || isEditing}
                    />
                    {input.trim() ? (
                        <button
                            onClick={handleSend}
                            disabled={busy || ending || isEditing}
                            className="shrink-0 px-4 py-2 rounded-[10px] text-[11px] font-bold active:translate-y-[2px] active:shadow-none transition-all disabled:opacity-50"
                            style={{ background: modalAccent, border: '1px solid #d8a5b7', color: '#fff', boxShadow: '0 8px 18px -14px rgba(122,90,114,0.35)', ...CUTE_STACK }}
                        >
                            递过去
                        </button>
                    ) : (
                        <button
                            onClick={() => { if (!busy && !ending) void runCharTurn(); }}
                            disabled={busy || ending || isEditing || entries.length === 0}
                            className="shrink-0 px-4 py-2 rounded-[10px] text-[11px] font-bold active:translate-y-[2px] active:shadow-none transition-all disabled:opacity-50"
                            style={{ background: '#fffdfa', border: '1px solid #eed6df', color: '#8a6478', boxShadow: '0 8px 18px -16px rgba(122,90,114,0.24)', ...CUTE_STACK }}
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
