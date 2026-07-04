import React, { useEffect, useRef, useState } from 'react';
import { ArrowsClockwise, Check, PencilSimple, Signpost, UsersThree, X } from '@phosphor-icons/react';
import type { CharacterProfile, GroupProfile, UserProfile } from '../../types';
import { useOS } from '../../context/OSContext';
import { CUTE_STACK, MONO_STACK, SERIF_STACK } from '../handbook/paper';
import {
    normalizeOfflineWordLimitValue,
    type OfflineCommitInfo,
    type OfflinePovPerson,
    type OfflineWordLimit,
} from '../../utils/offlineMode';
import {
    clearGroupOfflineSession,
    commitGroupOfflineSessionToContext,
    generateGroupOfflineOpening,
    generateGroupOfflineTurn,
    loadGroupOfflinePov,
    loadGroupOfflineSession,
    loadGroupOfflineWordLimit,
    saveGroupOfflinePov,
    saveGroupOfflineSession,
    saveGroupOfflineWordLimit,
    type GroupOfflineEntry,
    type GroupOfflinePov,
} from '../../utils/groupOfflineMode';

interface GroupOfflineModeModalProps {
    group: GroupProfile;
    members: CharacterProfile[];
    userProfile: UserProfile;
    /** 群聊线下场景生成用的 API。宿主传文具盒主 API，让赴约现场跟主聊天模型保持一致。 */
    apiConfig: { baseUrl: string; apiKey: string; model: string };
    /** 自动线下触发时传入：跳过手动开场选择，直接承接最近群聊生成第一幕。 */
    autoStartScenario?: string;
    onEnd: (info: OfflineCommitInfo | null) => void;
    onSuspend: (entryCount: number) => void;
    addToast: (msg: string, type: 'info' | 'success' | 'error') => void;
}

type GroupOpeningPreset = 'arrive' | 'gather' | 'encounter' | 'appointment' | 'custom';

const GROUP_OPENING_PRESETS: Array<{ key: GroupOpeningPreset; label: string; desc: string; frame: string }> = [
    {
        key: 'appointment',
        label: '按约赴会',
        desc: '延续群里约好的时间地点，大家陆续碰面。',
        frame: '{user} 和「{group}」此前已经在线上约好要见面。现在到了约定的时间地点，写大家陆续抵达、互相看见的第一刻。',
    },
    {
        key: 'arrive',
        label: '你去找大家',
        desc: '你主动到达大家所在的地方。',
        frame: '{user} 主动去找「{group}」的成员见面。开场写 {user} 抵达现场，看见谁已经在、谁正在赶来，以及大家的第一反应。',
    },
    {
        key: 'gather',
        label: '大家来找你',
        desc: '群成员一起出现在你面前。',
        frame: '「{group}」的成员来找 {user}。开场写他们出现的方式、现场气氛，以及这次见面的由头。',
    },
    {
        key: 'encounter',
        label: '偶然遇见',
        desc: '不期而遇，现场自然展开。',
        frame: '{user} 和「{group}」的成员在某个公共场所偶然遇见。开场写意外、认出彼此和自然聚到一起的瞬间。',
    },
    {
        key: 'custom',
        label: '自定义',
        desc: '自己写这场见面怎么开始。',
        frame: '',
    },
];

const resolveGroupOpeningFrame = (
    preset: GroupOpeningPreset,
    customText: string,
    groupName: string,
    userName: string,
): string => {
    if (preset === 'custom') return customText.trim();
    const def = GROUP_OPENING_PRESETS.find(item => item.key === preset);
    return (def?.frame || '').replace(/\{group\}/g, groupName).replace(/\{user\}/g, userName);
};

const GroupOfflineModeModal: React.FC<GroupOfflineModeModalProps> = ({
    group,
    members,
    userProfile,
    apiConfig,
    autoStartScenario,
    onEnd,
    onSuspend,
    addToast,
}) => {
    const { theme } = useOS();
    const modalStyle = theme.offlineModeStyle || {};
    const modalBg = modalStyle.background || 'linear-gradient(180deg,#fffdfa,#f6f6f6)';
    const modalInk = modalStyle.textColor || '#3b3438';
    const modalAccent = modalStyle.accentColor || '#d8a5b7';
    const modalRadius = typeof modalStyle.radius === 'number' ? Math.max(0, Math.min(32, modalStyle.radius)) : 22;
    const userName = userProfile.name || '你';
    const groupAvatar = group.avatar || members[0]?.avatar || userProfile.avatar;
    const [entries, setEntries] = useState<GroupOfflineEntry[]>(() => loadGroupOfflineSession(group.id));
    const [input, setInput] = useState('');
    const [busy, setBusy] = useState(false);
    const [ending, setEnding] = useState(false);
    const [editingIndex, setEditingIndex] = useState<number | null>(null);
    const [editingText, setEditingText] = useState('');
    const [pov, setPov] = useState<GroupOfflinePov>(() => loadGroupOfflinePov(group.id));
    const [openingChosen, setOpeningChosen] = useState(() => loadGroupOfflineSession(group.id).length > 0 || !!autoStartScenario?.trim());
    const [preset, setPreset] = useState<GroupOpeningPreset>('appointment');
    const [customScenario, setCustomScenario] = useState('');
    const [customOpen, setCustomOpen] = useState(false);
    const [wordLimitText, setWordLimitText] = useState(() => {
        const saved = loadGroupOfflineWordLimit(group.id).maxChars;
        return saved ? String(saved) : '';
    });
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
        saveGroupOfflineWordLimit(group.id, maxChars ? { maxChars } : {});
    };

    const normalizeWordLimitText = () => {
        const maxChars = normalizeOfflineWordLimitValue(wordLimitText);
        setWordLimitText(maxChars ? String(maxChars) : '');
    };

    const persistEntries = (next: GroupOfflineEntry[]) => {
        setEntries(next);
        saveGroupOfflineSession(group.id, next);
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
        const next = entries.map((entry, index) => index === editingIndex ? { ...entry, text } : entry);
        persistEntries(next);
        setEditingIndex(null);
        setEditingText('');
    };

    const setPovFor = (who: keyof GroupOfflinePov, person: OfflinePovPerson) => {
        setPov(prev => {
            const next = { ...prev, [who]: person };
            saveGroupOfflinePov(group.id, next);
            return next;
        });
    };

    useEffect(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, [entries, busy, openingChosen]);

    const startOpeningFromScenario = async (scenario: string, failurePrefix = '群聊赴约开场生成失败') => {
        if (busy || openingStartedRef.current) return;
        openingStartedRef.current = true;
        openingScenarioRef.current = scenario;
        setOpeningChosen(true);
        setBusy(true);
        try {
            const opening = await generateGroupOfflineOpening(group, members, userProfile, apiConfig, pov, scenario, undefined, currentWordLimit());
            if (opening) persistEntries([...entries, { role: 'scene', text: opening, at: Date.now() }]);
        } catch (e: any) {
            addToast(`${failurePrefix}：${e?.message || e}`, 'error');
            openingStartedRef.current = false;
            setOpeningChosen(false);
        } finally {
            setBusy(false);
        }
    };

    const startOpening = async (choice: GroupOpeningPreset) => {
        if (busy || openingStartedRef.current) return;
        if (choice === 'custom' && !customOpen) {
            setPreset(choice);
            setCustomOpen(true);
            return;
        }
        const scenario = resolveGroupOpeningFrame(choice, customScenario, group.name, userName);
        if (choice === 'custom' && !scenario) {
            addToast('写一句这场见面怎么开始吧', 'info');
            return;
        }
        setPreset(choice);
        await startOpeningFromScenario(scenario);
    };

    useEffect(() => {
        const scenario = autoStartScenario?.trim();
        if (!scenario || entries.length > 0 || openingStartedRef.current) return;
        void startOpeningFromScenario(scenario, '群聊自动赴约开场生成失败');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoStartScenario, group.id]);

    const runGroupTurn = async (baseEntries: GroupOfflineEntry[], userInput?: string) => {
        if (isEditing) return;
        setBusy(true);
        try {
            const reply = await generateGroupOfflineTurn(group, members, userProfile, apiConfig, baseEntries, userInput, pov, undefined, currentWordLimit());
            if (reply) {
                persistEntries([...baseEntries, {
                    role: 'char',
                    speakerId: group.id,
                    speakerName: group.name,
                    speakerAvatar: groupAvatar,
                    text: reply,
                    at: Date.now(),
                }]);
            }
        } catch (e: any) {
            addToast(`群聊赴约推进失败：${e?.message || e}`, 'error');
        } finally {
            setBusy(false);
        }
    };

    const lastUserInputOf = (items: GroupOfflineEntry[]): string | undefined => {
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
            addToast('先让大家接一下，再重写上一段现场', 'info');
            return;
        }
        const original = entries;
        const baseEntries = entries.slice(0, -1);
        persistEntries(baseEntries);
        setBusy(true);
        try {
            if (last.role === 'scene') {
                const opening = await generateGroupOfflineOpening(
                    group,
                    members,
                    userProfile,
                    apiConfig,
                    pov,
                    openingScenarioRef.current || undefined,
                    last.text,
                    currentWordLimit(),
                );
                persistEntries(opening ? [...baseEntries, { role: 'scene', text: opening, at: Date.now() }] : baseEntries);
            } else {
                const reply = await generateGroupOfflineTurn(
                    group,
                    members,
                    userProfile,
                    apiConfig,
                    baseEntries,
                    lastUserInputOf(baseEntries),
                    pov,
                    last.text,
                    currentWordLimit(),
                );
                persistEntries(reply ? [...baseEntries, {
                    role: 'char',
                    speakerId: group.id,
                    speakerName: group.name,
                    speakerAvatar: groupAvatar,
                    text: reply,
                    at: Date.now(),
                }] : baseEntries);
            }
            addToast('上一段线下现场已重写', 'success');
        } catch (e: any) {
            persistEntries(original);
            addToast(`群聊赴约重写失败：${e?.message || e}`, 'error');
        } finally {
            setBusy(false);
        }
    };

    const handleSend = async () => {
        const text = input.trim();
        if (!text || busy || ending || isEditing) return;
        setInput('');
        const next = [...entries, { role: 'user' as const, text, at: Date.now() }];
        persistEntries(next);
        await runGroupTurn(next, text);
    };

    const handleEnd = async () => {
        if (ending || isEditing) return;
        setEnding(true);
        try {
            const commitInfo = await commitGroupOfflineSessionToContext(group, userName, entries);
            clearGroupOfflineSession(group.id);
            onEnd(commitInfo);
        } catch (e: any) {
            addToast(`群聊赴约记录保存失败：${e?.message || e}`, 'error');
            setEnding(false);
        }
    };

    const handleSuspend = () => {
        if (busy || ending || isEditing || entries.length === 0) return;
        saveGroupOfflineSession(group.id, entries);
        onSuspend(entries.length);
    };

    const renderAvatarStack = (size = 'w-7 h-7') => (
        <div className="flex -space-x-2">
            {(members.length ? members : [{ id: 'group', avatar: groupAvatar, name: group.name } as CharacterProfile]).slice(0, 4).map(member => (
                <img
                    key={member.id}
                    src={member.avatar || groupAvatar}
                    alt=""
                    className={`${size} rounded-full object-cover border-2 border-white bg-white`}
                />
            ))}
        </div>
    );

    const renderEntryText = (text: string, index: number) => {
        const editingThis = editingIndex === index;
        const editButtonStyle = { background: 'rgba(255,255,255,0.72)', border: '1px solid rgba(210,204,199,0.72)', color: modalInk };
        if (editingThis) {
            return (
                <>
                    <textarea
                        value={editingText}
                        onChange={e => setEditingText(e.target.value)}
                        rows={4}
                        autoFocus
                        spellCheck={false}
                        className="w-full min-h-[88px] bg-transparent text-[13px] leading-relaxed outline-none resize-y placeholder:text-[#aaa]"
                        style={{ color: modalInk, caretColor: modalAccent }}
                    />
                    <div className="mt-2 flex justify-end gap-1.5">
                        <button
                            type="button"
                            onClick={saveEditEntry}
                            className="w-7 h-7 rounded-full flex items-center justify-center active:scale-95 transition disabled:opacity-50"
                            style={{ background: modalAccent, border: `1px solid ${modalAccent}`, color: '#fffdfa' }}
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
                className="moro-offline-modal relative w-full max-w-[420px] h-[78%] flex flex-col overflow-hidden"
                style={{
                    background: modalBg,
                    color: modalInk,
                    borderRadius: modalRadius,
                    boxShadow: '0 24px 60px -24px rgba(38,38,38,0.34), 0 0 0 1px rgba(255,255,255,0.72) inset',
                }}
            >
                <div className="moro-offline-modal-header px-4 pt-5 pb-3 flex items-center justify-between shrink-0 border-b" style={{ borderColor: 'rgba(210,204,199,0.72)' }}>
                    <div className="flex items-center gap-2.5 min-w-0">
                        <div className="shrink-0">{renderAvatarStack('w-8 h-8')}</div>
                        <div className="min-w-0">
                            <div className="text-[13px] font-bold truncate" style={{ ...SERIF_STACK, color: modalInk }}>和「{group.name}」面对面</div>
                            <div className="text-[9.5px]" style={{ color: '#918a8e' }}>{members.length + 1} 人在现场</div>
                        </div>
                    </div>
                    <div className="shrink-0 flex items-center gap-1.5">
                        <button
                            type="button"
                            onClick={() => void handleRerollLastGenerated()}
                            disabled={busy || ending || isEditing || entries.length === 0}
                            className="px-2.5 py-1.5 rounded-full text-[11px] font-bold flex items-center gap-1 active:scale-95 transition-all disabled:opacity-50"
                            style={{ background: 'rgba(255,253,250,0.72)', border: '1px solid rgba(210,204,199,0.72)', color: '#6f686c', boxShadow: '0 1px 2px rgba(38,38,38,0.06)' }}
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
                            style={{ background: 'rgba(255,253,250,0.72)', border: '1px solid rgba(210,204,199,0.72)', color: '#6f686c', boxShadow: '0 1px 2px rgba(38,38,38,0.06)', ...CUTE_STACK }}
                            title={isEditing ? '先保存或取消正在修改的内容' : entries.length === 0 ? '先开始这场赴约后再挂起' : '收起窗口，稍后继续这场线下现场'}
                        >
                            挂起
                        </button>
                        <button
                            onClick={handleEnd}
                            disabled={ending || isEditing}
                            className="px-3 py-1.5 rounded-full text-[11px] font-bold active:scale-95 transition-all disabled:opacity-50"
                            style={{ background: '#fffdfa', border: '1px solid rgba(210,204,199,0.72)', color: modalInk, boxShadow: '0 1px 2px rgba(38,38,38,0.08)', ...CUTE_STACK }}
                            title={isEditing ? '先保存或取消正在修改的内容' : undefined}
                        >
                            {ending ? '保存中' : '结束线下'}
                        </button>
                    </div>
                </div>

                <div className="shrink-0 px-4 py-2 flex items-center gap-x-3 gap-y-1.5 flex-wrap border-b" style={{ borderColor: 'rgba(210,204,199,0.72)' }}>
                    <span className="text-[10px] font-bold tracking-wider" style={{ ...MONO_STACK, color: '#918a8e' }}>POV</span>
                    {([
                        ['members', '群成员'],
                        ['user', userName],
                    ] as const).map(([who, label]) => (
                        <div key={who} className="flex items-center gap-1">
                            <span className="text-[10px]" style={{ color: '#918a8e' }}>{label}</span>
                            {([
                                ['first', '我'],
                                ['second', '你'],
                                ['third', 'TA'],
                            ] as const).map(([person, text]) => {
                                const active = pov[who] === person;
                                return (
                                    <button
                                        key={person}
                                        type="button"
                                        onClick={() => setPovFor(who, person)}
                                        className="px-2 py-0.5 rounded-full text-[10.5px] font-bold transition active:scale-95"
                                        style={active
                                            ? { background: modalAccent, color: '#fffdfa', boxShadow: '0 1px 2px rgba(38,38,38,0.14)' }
                                            : { background: 'rgba(255,255,255,0.68)', color: '#918a8e', border: '1px solid rgba(210,204,199,0.72)' }}
                                    >
                                        {text}
                                    </button>
                                );
                            })}
                        </div>
                    ))}
                </div>

                <div className="shrink-0 px-4 py-2 flex items-center gap-2 border-b" style={{ borderColor: 'rgba(210,204,199,0.72)' }}>
                    <span className="text-[10px] font-bold tracking-wider shrink-0" style={{ ...MONO_STACK, color: '#918a8e' }}>字数</span>
                    <input
                        value={wordLimitText}
                        onChange={e => updateWordLimitText(e.target.value)}
                        onBlur={normalizeWordLimitText}
                        inputMode="numeric"
                        pattern="[0-9]*"
                        placeholder="默认"
                        aria-label="群聊线下生成字数上限"
                        className="w-[76px] px-2 py-1 rounded-[8px] text-[11px] font-bold outline-none"
                        style={{ background: 'rgba(255,255,255,0.68)', border: '1px solid rgba(210,204,199,0.72)', color: modalInk, caretColor: modalAccent, ...MONO_STACK }}
                    />
                    <span className="text-[10.5px] shrink-0" style={{ color: '#918a8e' }}>字以内</span>
                    {displayedWordLimit && (
                        <button
                            type="button"
                            onClick={() => updateWordLimitText('')}
                            className="w-6 h-6 rounded-full flex items-center justify-center active:scale-95 transition"
                            style={{ background: 'rgba(255,255,255,0.68)', border: '1px solid rgba(210,204,199,0.72)', color: '#918a8e' }}
                            title="恢复默认字数"
                            aria-label="恢复默认字数"
                        >
                            <X size={12} weight="bold" />
                        </button>
                    )}
                    <span className="text-[10px] min-w-0 truncate" style={{ color: '#918a8e' }}>
                        {displayedWordLimit ? `${displayedWordLimit} 字上限` : '开场和续写沿用默认长度'}
                    </span>
                </div>

                <div ref={scrollRef} className="flex-1 overflow-y-auto no-scrollbar px-4 py-4 space-y-4">
                    {!openingChosen && (
                        <div className="pt-1">
                            <div className="text-center mb-3">
                                <div className="text-[14px] font-bold" style={{ ...SERIF_STACK, color: modalInk }}>这场群聊赴约怎么开始？</div>
                                <div className="text-[10.5px] mt-1" style={{ color: '#918a8e' }}>选择开场方式，窗口会生成单独的线下现场</div>
                            </div>
                            <div className="space-y-2.5">
                                {GROUP_OPENING_PRESETS.map((item, index) => {
                                    const active = preset === item.key;
                                    return (
                                        <button
                                            key={item.key}
                                            type="button"
                                            disabled={busy}
                                            onClick={() => startOpening(item.key)}
                                            className="w-full text-left rounded-[12px] px-4 py-3 active:scale-[0.98] transition disabled:opacity-50 flex items-center gap-3"
                                            style={{ background: active ? '#f6f6f6' : '#fffdfa', border: active ? `1px solid ${modalAccent}` : '1px solid rgba(210,204,199,0.72)', boxShadow: '0 1px 3px rgba(38,38,38,0.08)' }}
                                        >
                                            <span className="w-8 h-8 rounded-[10px] flex items-center justify-center shrink-0 text-[10px] font-black tracking-[0.12em]" style={{ background: '#f6f6f6', color: '#918a8e', border: '1px solid rgba(210,204,199,0.72)' }}>
                                                {String(index + 1).padStart(2, '0')}
                                            </span>
                                            <span className="min-w-0">
                                                <span className="block text-[13.5px] font-bold" style={{ ...CUTE_STACK, color: modalInk }}>{item.label}</span>
                                                <span className="block text-[10.5px] mt-0.5 leading-snug" style={{ color: '#918a8e' }}>{item.desc}</span>
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                            {customOpen && (
                                <div className="mt-3 rounded-[12px] px-3 py-3" style={{ background: '#fffdfa', border: '1px solid rgba(210,204,199,0.72)' }}>
                                    <textarea
                                        value={customScenario}
                                        onChange={e => setCustomScenario(e.target.value)}
                                        rows={3}
                                        placeholder="例：大家约在常去的咖啡馆，窗边已经拼好了桌，群里刚刚还在催最后一个人快到。"
                                        className="w-full bg-transparent text-[12.5px] outline-none resize-none placeholder:text-[#aaa]"
                                        style={{ color: modalInk }}
                                    />
                                    <div className="flex justify-end mt-1">
                                        <button
                                            type="button"
                                            disabled={busy || !customScenario.trim()}
                                            onClick={() => startOpening('custom')}
                                            className="px-4 py-1.5 rounded-[10px] text-[11px] font-bold active:translate-y-[1px] transition disabled:opacity-50"
                                            style={{ background: modalAccent, border: `1px solid ${modalAccent}`, color: '#fff', ...CUTE_STACK }}
                                        >
                                            就这样开始
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {entries.map((entry, index) => (
                        entry.role === 'scene' ? (
                            <div key={index} className="moro-offline-modal-entry moro-offline-modal-scene text-[12.5px] leading-relaxed italic whitespace-pre-wrap rounded-[8px] px-4 py-3" style={{ color: '#6f686c', background: '#fffdfa', border: '1px solid rgba(210,204,199,0.72)' }}>
                                {renderEntryText(entry.text, index)}
                            </div>
                        ) : entry.role === 'char' ? (
                            <div key={index} className="flex items-start gap-2.5">
                                <div className="shrink-0 mt-0.5">{renderAvatarStack('w-6 h-6')}</div>
                                <div className="max-w-[84%]">
                                    <div className="mb-1 text-[10px]" style={{ color: '#918a8e' }}>{entry.speakerName || group.name}</div>
                                    <div className="moro-offline-modal-entry moro-offline-modal-char text-[13px] leading-relaxed whitespace-pre-wrap px-4 py-2.5" style={{ color: modalInk, background: '#f6f6f6', borderRadius: '4px 14px 14px 14px' }}>
                                        {renderEntryText(entry.text, index)}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div key={index} className="flex justify-end">
                                <div className="moro-offline-modal-entry moro-offline-modal-user text-[13px] leading-relaxed whitespace-pre-wrap max-w-[85%] px-4 py-2.5" style={{ color: modalInk, background: '#f6f6f6', borderRadius: '14px 4px 14px 14px' }}>
                                    {renderEntryText(entry.text, index)}
                                </div>
                            </div>
                        )
                    ))}

                    {busy && (
                        <div className="flex items-center gap-2 text-[11px] px-1" style={{ color: '#6f686c' }}>
                            <Signpost size={14} weight="bold" style={{ color: modalAccent }} />
                            现场还在继续写...
                        </div>
                    )}
                </div>

                {openingChosen && (
                    <div className="moro-offline-modal-inputbar shrink-0 px-4 py-3 flex items-center gap-2 border-t" style={{ borderColor: 'rgba(210,204,199,0.72)' }}>
                        <input
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') void handleSend(); }}
                            placeholder="说句话，或写下你的动作..."
                            className="flex-1 px-2 py-2 bg-transparent text-[13px] outline-none border-0 border-b border-[#d2ccc7] placeholder:text-[#aaa]"
                            style={{ color: modalInk, caretColor: modalAccent }}
                            disabled={busy || ending || isEditing}
                        />
                        {input.trim() ? (
                            <button
                                onClick={() => void handleSend()}
                                disabled={busy || ending || isEditing}
                                className="shrink-0 px-4 py-2 rounded-[10px] text-[11px] font-bold active:translate-y-[2px] active:shadow-none transition-all disabled:opacity-50"
                                style={{ background: modalAccent, border: `1px solid ${modalAccent}`, color: '#fff', ...CUTE_STACK }}
                            >
                                递过去
                            </button>
                        ) : (
                            <button
                                onClick={() => { if (!busy && !ending) void runGroupTurn(entries); }}
                                disabled={busy || ending || isEditing || entries.length === 0}
                                className="shrink-0 px-4 py-2 rounded-[10px] text-[11px] font-bold active:translate-y-[2px] active:shadow-none transition-all disabled:opacity-50 flex items-center gap-1"
                                style={{ background: '#fffdfa', border: '1px solid rgba(210,204,199,0.72)', color: '#6f686c', ...CUTE_STACK }}
                                title="让群成员继续推进现场"
                            >
                                <UsersThree size={14} weight="bold" />
                                让大家来
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default GroupOfflineModeModal;
