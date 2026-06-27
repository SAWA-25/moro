
import React, { useRef, useState } from 'react';
import Modal, { ScrapBtn, ScrapInput, ScrapTextarea, ScrapNote, ScrapDivider, ScrapRowBtn, ScrapStamp, INK, INK_SOFT } from './ScrapModal';
import JournalSheet, { SealBtn, CandyToggle, LinedInput, LinedArea, NoteStrip } from './JournalSheet';
import { MONO_STACK, CUTE_STACK } from '../handbook/paper';
import { CharacterProfile, Message, EmojiCategory, DailySchedule, ScheduleSlot, ApiPreset, APIConfig } from '../../types';
import ScheduleCard from '../schedule/ScheduleCard';
import EmotionSettingsPanel from './EmotionSettingsPanel';
import { REACTION_EMOJIS } from '../../utils/messageReactions';
import { ListNumbers, ShareNetwork, PencilSimpleLine, Copy, ClockCounterClockwise, Trash, Quotes, SpeakerHigh, Eye } from '@phosphor-icons/react';

interface ChatModalsProps {
    modalType: string;
    setModalType: (v: any) => void;
    // Data Props
    transferAmt: string;
    setTransferAmt: (v: string) => void;
    // 转账/红包模式切换 + 红包附言（Kakao Pay 风格）
    transferMode: 'transfer' | 'redpacket';
    setTransferMode: (v: 'transfer' | 'redpacket') => void;
    transferNote: string;
    setTransferNote: (v: string) => void;
    /** 口令红包：填了就是口令红包，角色要答对口令才领得到 */
    transferPassword: string;
    setTransferPassword: (v: string) => void;
    /** 钱包余额（来自存钱罐营业所得），转账/红包从这里扣 */
    walletBalance?: number;
    emojiImportText: string;
    setEmojiImportText: (v: string) => void;
    settingsContextLimit: number;
    setSettingsContextLimit: (v: number) => void;
    settingsHideSysLogs: boolean;
    setSettingsHideSysLogs: (v: boolean) => void;
    preserveContext: boolean;
    setPreserveContext: (v: boolean) => void;
    editContent: string;
    setEditContent: (v: string) => void;
    
    // New Category Props
    newCategoryName: string;
    setNewCategoryName: (v: string) => void;
    onAddCategory: () => void;

    // Archive Props
    archivePrompts: {id: string, name: string, content: string}[];
    selectedPromptId: string;
    setSelectedPromptId: (id: string) => void;
    editingPrompt: {id: string, name: string, content: string} | null;
    setEditingPrompt: (p: any) => void;
    isSummarizing: boolean;
    archiveProgress?: string;

    // Selection Props
    selectedMessage: Message | null;
    selectedEmoji: {name: string, url: string} | null;
    selectedCategory: EmojiCategory | null;
    activeCharacter: CharacterProfile;
    messages: Message[];
    allHistoryMessages?: Message[];

    // Handlers
    onTransfer: () => void;
    onImportEmoji: () => void;
    onSaveSettings: () => void;
    onBgUpload: (file: File) => void;
    onRemoveBg: () => void;
    onClearHistory: () => void;
    onClearChatContextOnly: () => void;
    onArchive: () => void;
    onCreatePrompt: () => void;
    onEditPrompt: () => void;
    onSavePrompt: () => void;
    onDeletePrompt: (id: string) => void;
    onSetHistoryStart: (id: number | undefined) => void;
    onJumpToMessageInChat?: (id: number) => void;
    onEnterSelectionMode: () => void;
    onReplyMessage: () => void;
    onEditMessageStart: () => void;
    onConfirmEditMessage: () => void;
    onDeleteMessage: () => void;
    onRecallMessage: () => void;
    onForwardMessage: () => void;
    onReactMessage: (emoji: string) => void;
    onCopyMessage: () => void;
    onDeleteEmoji: () => void;
    onDeleteCategory: () => void;
    // Category Visibility
    allCharacters?: CharacterProfile[];
    onSaveCategoryVisibility?: (categoryId: string, allowedCharacterIds: string[] | undefined) => void;
    // Translation
    translationEnabled?: boolean;
    onToggleTranslation?: () => void;
    translateSourceLang?: string;
    translateTargetLang?: string;
    onSetTranslateSourceLang?: (lang: string) => void;
    onSetTranslateLang?: (lang: string) => void;
    // XHS toggle
    xhsEnabled?: boolean;
    onToggleXhs?: () => void;
    // HTML mode
    htmlModeEnabled?: boolean;
    onToggleHtmlMode?: () => void;
    htmlModeCustomPrompt?: string;
    setHtmlModeCustomPrompt?: (v: string) => void;
    // 时间感知强化
    timeAwarenessEnabled?: boolean;
    onToggleTimeAwareness?: () => void;
    // Voice TTS
    chatVoiceEnabled?: boolean;
    onToggleChatVoice?: () => void;
    chatVoiceLang?: string;
    onSetChatVoiceLang?: (lang: string) => void;
    // Voice generation from long-press
    onGenerateVoice?: () => void;
    voiceAvailable?: boolean; // true if char has voiceProfile configured
    // Schedule
    scheduleData?: DailySchedule | null;
    isScheduleGenerating?: boolean;
    onScheduleEdit?: (index: number, slot: ScheduleSlot) => void;
    onScheduleDelete?: (index: number) => void;
    onScheduleReroll?: () => void;
    onScheduleCoverChange?: (dataUrl: string) => void;
    onScheduleStyleChange?: (style: 'lifestyle' | 'mindful') => void;
    // Schedule master toggle
    isScheduleFeatureEnabled?: boolean;
    onToggleScheduleFeature?: () => void;
    // Memory Palace force vectorize
    isMemoryPalaceEnabled?: boolean;
    isVectorizing?: boolean;
    onForceVectorize?: () => void;
    // Emotion (embedded under schedule modal, synced on/off with scheduleStyle)
    apiPresets?: ApiPreset[];
    onAddApiPreset?: (name: string, config: APIConfig) => void;
    onSaveEmotion?: (config: NonNullable<CharacterProfile['emotionConfig']>) => void;
    onClearBuffs?: () => void;
}

const ChatModals: React.FC<ChatModalsProps> = ({
    modalType, setModalType,
    transferAmt, setTransferAmt,
    transferMode, setTransferMode, transferNote, setTransferNote, transferPassword, setTransferPassword,
    walletBalance = 0,
    emojiImportText, setEmojiImportText,
    settingsContextLimit, setSettingsContextLimit,
    settingsHideSysLogs, setSettingsHideSysLogs,
    preserveContext, setPreserveContext,
    editContent, setEditContent,
    newCategoryName, setNewCategoryName, onAddCategory,
    archivePrompts, selectedPromptId, setSelectedPromptId,
    editingPrompt, setEditingPrompt, isSummarizing, archiveProgress,
    selectedMessage, selectedEmoji, selectedCategory, activeCharacter, messages,
    allHistoryMessages = [],
    onTransfer, onImportEmoji, onSaveSettings,
    onBgUpload, onRemoveBg, onClearHistory,
    onClearChatContextOnly,
    onArchive, onCreatePrompt, onEditPrompt, onSavePrompt, onDeletePrompt,
    onSetHistoryStart, onJumpToMessageInChat, onEnterSelectionMode, onReplyMessage, onEditMessageStart, onConfirmEditMessage, onDeleteMessage, onRecallMessage, onForwardMessage, onReactMessage, onCopyMessage, onDeleteEmoji, onDeleteCategory,
    allCharacters = [], onSaveCategoryVisibility,
    translationEnabled, onToggleTranslation, translateSourceLang, translateTargetLang, onSetTranslateSourceLang, onSetTranslateLang,
    xhsEnabled, onToggleXhs,
    htmlModeEnabled, onToggleHtmlMode, htmlModeCustomPrompt, setHtmlModeCustomPrompt,
    timeAwarenessEnabled, onToggleTimeAwareness,
    chatVoiceEnabled, onToggleChatVoice, chatVoiceLang, onSetChatVoiceLang,
    onGenerateVoice, voiceAvailable,
    scheduleData, isScheduleGenerating, onScheduleEdit, onScheduleDelete, onScheduleReroll, onScheduleCoverChange,
    onScheduleStyleChange,
    isScheduleFeatureEnabled, onToggleScheduleFeature,
    isMemoryPalaceEnabled, isVectorizing, onForceVectorize,
    apiPresets, onAddApiPreset, onSaveEmotion, onClearBuffs,
}) => {
    const bgInputRef = useRef<HTMLInputElement>(null);
    const [visibilitySelection, setVisibilitySelection] = useState<Set<string>>(new Set());
    const [historyPage, setHistoryPage] = useState(0);
    const [historySearch, setHistorySearch] = useState('');
    const [pendingHideMsgId, setPendingHideMsgId] = useState<number | null>(null);
    const longPressTimerRef = useRef<number | null>(null);
    const longPressTriggeredRef = useRef(false);
    const HISTORY_PAGE_SIZE = 50;
    const HISTORY_SEARCH_MAX = 200;
    const LONG_PRESS_MS = 450;

    const startHistoryLongPress = (msgId: number) => {
        longPressTriggeredRef.current = false;
        if (longPressTimerRef.current) window.clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = window.setTimeout(() => {
            longPressTriggeredRef.current = true;
            if (onJumpToMessageInChat) {
                setModalType('none');
                setHistoryPage(0);
                setHistorySearch('');
                setPendingHideMsgId(null);
                onJumpToMessageInChat(msgId);
            }
        }, LONG_PRESS_MS);
    };
    const cancelHistoryLongPress = () => {
        if (longPressTimerRef.current) {
            window.clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
        }
    };
    const handleHistoryItemClick = (msgId: number) => {
        if (longPressTriggeredRef.current) {
            longPressTriggeredRef.current = false;
            return;
        }
        setPendingHideMsgId(msgId);
    };

    // 模糊匹配：query 的所有字符按顺序在 content 里出现即算命中（大小写不敏感）。
    // 中文按字符级 subsequence 匹配，英文同理。
    const fuzzyMatch = (content: string, query: string): boolean => {
        if (!query) return true;
        const c = content.toLowerCase();
        const q = query.toLowerCase();
        if (c.includes(q)) return true;
        let idx = 0;
        for (const ch of q) {
            const found = c.indexOf(ch, idx);
            if (found < 0) return false;
            idx = found + 1;
        }
        return true;
    };

    // 高亮命中的连续子串（优先），否则不高亮（subsequence 命中时高亮意义不大）。
    const renderHighlighted = (text: string, query: string, baseClass: string) => {
        if (!query) return <span className={baseClass}>{text}</span>;
        const lower = text.toLowerCase();
        const q = query.toLowerCase();
        const idx = lower.indexOf(q);
        if (idx < 0) return <span className={baseClass}>{text}</span>;
        return (
            <span className={baseClass}>
                {text.slice(0, idx)}
                <mark className="bg-yellow-200 text-slate-800 rounded px-0.5">{text.slice(idx, idx + q.length)}</mark>
                {text.slice(idx + q.length)}
            </span>
        );
    };

    const openVisibilityModal = () => {
        if (selectedCategory) {
            setVisibilitySelection(new Set(selectedCategory.allowedCharacterIds || []));
            setModalType('category-visibility');
        }
    };

    const toggleVisibilityChar = (charId: string) => {
        setVisibilitySelection(prev => {
            const next = new Set(prev);
            if (next.has(charId)) next.delete(charId);
            else next.add(charId);
            return next;
        });
    };

    const handleSaveVisibility = () => {
        if (selectedCategory && onSaveCategoryVisibility) {
            const ids = Array.from(visibilitySelection);
            onSaveCategoryVisibility(selectedCategory.id, ids.length > 0 ? ids : undefined);
        }
        setModalType('none');
    };

    return (
        <>
            <JournalSheet
                open={modalType === 'transfer'} title="转账与红包" en="Send Money"
                sub={transferMode === 'redpacket' ? '设置金额并发送红包' : '设置金额并发送转账'}
                tape={transferMode === 'redpacket' ? 'blush' : 'lemon'} pattern="heart" paper="cream"
                onClose={() => setModalType('none')}
                footer={<>
                    <SealBtn kind="ghost" onClick={() => setModalType('none')}>再想想</SealBtn>
                    <SealBtn kind="ink" onClick={onTransfer}>
                        {transferMode === 'redpacket' ? '发送红包' : '发送转账'}
                    </SealBtn>
                </>}
            >
                <div className="space-y-4">
                    {/* 模式切换 */}
                    <div className="flex gap-2.5">
                        <button
                            onClick={() => setTransferMode('transfer')}
                            className="flex-1 py-2.5 text-[13px] font-bold transition-all active:scale-95"
                            style={{
                                background: transferMode === 'transfer' ? '#fff4f7' : '#fffdfa',
                                color: transferMode === 'transfer' ? '#5a3140' : '#a892a3',
                                border: transferMode === 'transfer' ? '1px solid #d8a5b7' : '1px solid #eed6df',
                                borderRadius: 14,
                                boxShadow: transferMode === 'transfer' ? '0 8px 18px -14px rgba(122,90,114,0.45)' : 'none',
                                ...CUTE_STACK,
                            }}
                        >💴 转账</button>
                        <button
                            onClick={() => setTransferMode('redpacket')}
                            className="flex-1 py-2.5 text-[13px] font-bold transition-all active:scale-95"
                            style={{
                                background: transferMode === 'redpacket' ? '#fff4f7' : '#fffdfa',
                                color: transferMode === 'redpacket' ? '#5a3140' : '#a892a3',
                                border: transferMode === 'redpacket' ? '1px solid #d8a5b7' : '1px solid #eed6df',
                                borderRadius: 14,
                                boxShadow: transferMode === 'redpacket' ? '0 8px 18px -14px rgba(122,90,114,0.45)' : 'none',
                                ...CUTE_STACK,
                            }}
                        >🧧 红包</button>
                    </div>
                    {/* 金额 */}
                    <div className="flex items-end gap-2 px-1">
                        <span className="text-[18px] font-bold pb-1.5 select-none" style={{ color: '#857f74' }}>¥</span>
                        <input
                            type="number" value={transferAmt} onChange={e => setTransferAmt(e.target.value)}
                            placeholder="输入金额"
                            className="flex-1 bg-transparent px-1 py-1.5 text-[22px] font-bold outline-none border-0 border-b-2 border-[#eed6df] focus:border-[#d8a5b7] placeholder:text-[#c4bdb0] placeholder:text-[15px]"
                            style={{ color: INK, caretColor: '#d8a5b7' }}
                            autoFocus
                        />
                    </div>
                    {/* 快捷金额贴片（点一下就填，含 520 / 1314 这种心意数） */}
                    <div className="flex flex-wrap gap-2 px-1">
                        {[5, 20, 52, 88, 520, 1314].map(v => {
                            const active = (parseFloat(transferAmt) || 0) === v;
                            return (
                                <button
                                    key={v}
                                    onClick={() => setTransferAmt(String(v))}
                                    className="px-3 py-1 text-[12px] font-bold transition-all active:scale-95"
                                    style={{
                                        background: active ? '#fff4f7' : '#fffdfa',
                                        color: active ? '#5a3140' : '#6b665d',
                                        border: active ? '1px solid #d8a5b7' : '1px solid #eed6df',
                                        borderRadius: 9999,
                                        ...CUTE_STACK,
                                    }}
                                >¥{v}</button>
                            );
                        })}
                    </div>
                    {transferMode === 'redpacket' && (
                        <LinedInput
                            value={transferNote} onChange={e => setTransferNote(e.target.value)}
                            tag="红包备注"
                            placeholder="比如：恭喜发财，大吉大利" maxLength={30}
                        />
                    )}
                    {transferMode === 'redpacket' && (
                        <LinedInput
                            value={transferPassword} onChange={e => setTransferPassword(e.target.value)}
                            tag="口令（选填）"
                            placeholder="填了就是口令红包 · TA 要答对才领得到" maxLength={20}
                        />
                    )}
                    {/* 钱包余额（存钱罐营业所得），转账/红包从这里扣 */}
                    {(() => {
                        const amt = parseFloat(transferAmt) || 0;
                        const insufficient = amt > walletBalance;
                        return (
                            <div className="flex items-center justify-between px-1 text-[12px]" style={{ color: insufficient ? '#9a3b3b' : '#857f74' }}>
                                <span>钱包余额 ¥{Math.round(walletBalance)}</span>
                                {insufficient && <span className="font-bold">不够啦，去存钱罐营业赚点</span>}
                            </div>
                        );
                    })()}
                </div>
            </JournalSheet>

            {/* New Category Modal */}
            <Modal
                isOpen={modalType === 'add-category'} title="新建表情分组" en="NEW GROUP" onClose={() => setModalType('none')}
                footer={<ScrapBtn onClick={onAddCategory}>新建分组</ScrapBtn>}
            >
                <ScrapInput
                    value={newCategoryName}
                    onChange={e => setNewCategoryName(e.target.value)}
                    placeholder="给这个分组起个名…"
                    className="text-base font-bold"
                    autoFocus
                />
            </Modal>

            <Modal
                isOpen={modalType === 'emoji-import'} title="导入表情" en="IMPORT" icon={<ScrapStamp><span className="text-[13px]">＋</span></ScrapStamp>} onClose={() => setModalType('none')}
                footer={<ScrapBtn onClick={onImportEmoji}>导入到分组</ScrapBtn>}
            >
                <div className="space-y-3">
                    <ScrapNote>表情会加入当前选中的分组。末尾能补一句描述（用来搜索，AI 选择表情时也看得到）。</ScrapNote>
                    <ScrapTextarea value={emojiImportText} onChange={e => setEmojiImportText(e.target.value)} placeholder={"名字--URL（每行一个）\n名字--URL--描述（描述可选）"} className="h-40" />
                </div>
            </Modal>

            {/* 旧版聊天设置弹窗已由全屏 ConvoSettingsPanel（apps/Chat.tsx 渲染）取代；
                条件改为 legacy 占位保留代码以备回退，不再随 'chat-settings' 打开。 */}
            <Modal
                isOpen={modalType === 'chat-settings-legacy'} title="聊天设置" onClose={() => setModalType('none')}
                footer={<button onClick={onSaveSettings} className="w-full py-3 bg-primary text-white font-bold rounded-2xl">保存设置</button>}
            >
                <div className="space-y-6">
                     <div>
                         <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">聊天背景</label>
                         <div onClick={() => bgInputRef.current?.click()} className="h-24 bg-[#fffdfa] rounded-xl border-2 border-[#eed6df] flex items-center justify-center cursor-pointer hover:border-[#d8a5b7] overflow-hidden relative">
                             {activeCharacter.chatBackground ? <img src={activeCharacter.chatBackground} className="w-full h-full object-cover opacity-60" /> : <span className="text-xs text-slate-400">点击上传图片 (原画质)</span>}
                             {activeCharacter.chatBackground && <span className="absolute z-10 text-xs bg-white/80 px-2 py-1 rounded">更换</span>}
                         </div>
                         <input type="file" ref={bgInputRef} className="hidden" accept="image/*" onChange={(e) => e.target.files?.[0] && onBgUpload(e.target.files[0])} />
                         {activeCharacter.chatBackground && <button onClick={onRemoveBg} className="text-[10px] text-red-400 mt-1">移除背景</button>}
                     </div>
                     <div>
                         <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">上下文条数 ({settingsContextLimit})</label>
                         <input type="range" min="20" max="5000" step="10" value={settingsContextLimit} onChange={e => setSettingsContextLimit(parseInt(e.target.value))} className="w-full h-2 bg-slate-200 rounded-full appearance-none accent-primary" />
                         <div className="flex justify-between text-[10px] text-slate-400 mt-1"><span>20 (省流)</span><span>5000 (超长记忆)</span></div>
                     </div>

                     <div className="pt-2 border-t border-slate-100">
                         <div className="flex justify-between items-center cursor-pointer" onClick={() => setSettingsHideSysLogs(!settingsHideSysLogs)}>
                             <label className="text-xs font-bold text-slate-400 uppercase pointer-events-none">隐藏系统日志</label>
                             <div className={`w-10 h-6 rounded-full p-1 transition-colors flex items-center ${settingsHideSysLogs ? 'bg-[#d8a5b7]' : 'bg-[#e7e2d8]'}`}>
                                 <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${settingsHideSysLogs ? 'translate-x-4' : ''}`}></div>
                             </div>
                         </div>
                         <p className="text-[10px] text-slate-400 mt-2 leading-relaxed">
                             开启后，将不再显示 Date/App 产生的上下文提示文本（转账、戳一戳、图片发送提示除外）。
                         </p>
                     </div>

                     {/* Translation Settings */}
                     <div className="pt-2 border-t border-slate-100">
                         <div className="flex justify-between items-center cursor-pointer" onClick={onToggleTranslation}>
                             <label className="text-xs font-bold text-slate-400 uppercase pointer-events-none">消息翻译</label>
                             <div className={`w-10 h-6 rounded-full p-1 transition-colors flex items-center ${translationEnabled ? 'bg-[#d8a5b7]' : 'bg-[#e7e2d8]'}`}>
                                 <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${translationEnabled ? 'translate-x-4' : ''}`}></div>
                             </div>
                         </div>
                         <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">
                             开启后，AI 消息自动翻译为「选」的语言显示，点「译」切换到目标语言。
                         </p>
                         {translationEnabled && (
                             <div className="mt-3 space-y-3">
                                 {/* Source Language (选) */}
                                 <div>
                                     <label className="text-[10px] font-bold text-slate-400 mb-1.5 block">选（气泡显示语言）</label>
                                     <div className="flex flex-wrap gap-1.5">
                                         {['中文', 'English', '日本語', '한국어', 'Français', 'Español'].map(lang => (
                                             <button
                                                 key={`src-${lang}`}
                                                 onClick={() => onSetTranslateSourceLang?.(lang)}
                                                 className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-all ${translateSourceLang === lang ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-500'}`}
                                             >
                                                 {lang}
                                             </button>
                                         ))}
                                     </div>
                                 </div>
                                 {/* Target Language (译) */}
                                 <div>
                                     <label className="text-[10px] font-bold text-slate-400 mb-1.5 block">译（翻译目标语言）</label>
                                     <div className="flex flex-wrap gap-1.5">
                                         {['中文', 'English', '日本語', '한국어', 'Français', 'Español'].map(lang => (
                                             <button
                                                 key={`tgt-${lang}`}
                                                 onClick={() => onSetTranslateLang?.(lang)}
                                                 className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-all ${translateTargetLang === lang ? 'bg-primary text-white' : 'bg-slate-100 text-slate-500'}`}
                                             >
                                                 {lang}
                                             </button>
                                         ))}
                                     </div>
                                 </div>
                                 {/* Preview */}
                                 <div className="text-[11px] text-center text-slate-500 bg-slate-50 rounded-lg py-2">
                                     选<span className="font-bold text-slate-700">{translateSourceLang || '?'}</span> 译<span className="font-bold text-primary">{translateTargetLang || '?'}</span>
                                 </div>
                             </div>
                         )}
                     </div>

                     {/* XHS Toggle */}
                     <div className="pt-2 border-t border-slate-100">
                         <div className="flex justify-between items-center cursor-pointer" onClick={onToggleXhs}>
                             <label className="text-xs font-bold text-slate-400 uppercase pointer-events-none">小红书</label>
                             <div className={`w-10 h-6 rounded-full p-1 transition-colors flex items-center ${xhsEnabled ? 'bg-[#d8a5b7]' : 'bg-[#e7e2d8]'}`}>
                                 <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${xhsEnabled ? 'translate-x-4' : ''}`}></div>
                             </div>
                         </div>
                         <p className="text-[10px] text-slate-400 mt-2 leading-relaxed">
                             开启后，角色在聊天中可以搜索、浏览、发帖、评论小红书。需要在全局设置中配置 MCP 或 Cookie。
                         </p>
                     </div>

                     {/* HTML 模块模式 */}
                     <div className="pt-2 border-t border-slate-100">
                         <div className="flex justify-between items-center cursor-pointer" onClick={onToggleHtmlMode}>
                             <label className="text-xs font-bold text-slate-400 uppercase pointer-events-none">HTML 模块模式</label>
                             <div className={`w-10 h-6 rounded-full p-1 transition-colors flex items-center ${htmlModeEnabled ? 'bg-[#d8a5b7]' : 'bg-[#e7e2d8]'}`}>
                                 <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${htmlModeEnabled ? 'translate-x-4' : ''}`}></div>
                             </div>
                         </div>
                         <p className="text-[10px] text-slate-400 mt-2 leading-relaxed">
                             开启后注入"用 [html]...[/html] 包裹的精美卡片"提示词，AI 会在合适场景输出邀请函 / 票据 / 通知等可视化模块。
                             历史上下文里只保留剥离 HTML 后的文字摘要，不浪费 token。
                         </p>
                         {htmlModeEnabled && (
                             <div className="mt-3">
                                 <label className="text-[10px] font-bold text-slate-400 mb-1.5 block">自定义提示词补充（追加在内置提示词之后，不会覆盖）</label>
                                 <textarea
                                     value={htmlModeCustomPrompt || ''}
                                     onChange={e => setHtmlModeCustomPrompt?.(e.target.value)}
                                     placeholder="比如：偏好暖色调 / 默认风格走 minimal 杂志感 / 票据类必须含二维码占位…"
                                     className="w-full h-28 bg-slate-50 rounded-2xl p-3 text-[12px] resize-none border border-slate-200 focus:outline-none focus:border-fuchsia-300"
                                 />
                                 <p className="text-[10px] text-slate-400 mt-1">留空则只使用内置提示词。</p>
                             </div>
                         )}
                     </div>

                     {/* Voice TTS */}
                     <div className="pt-2 border-t border-slate-100">
                         <div className="flex justify-between items-center cursor-pointer" onClick={onToggleChatVoice}>
                             <label className="text-xs font-bold text-slate-400 uppercase pointer-events-none">语音消息</label>
                             <div className={`w-10 h-6 rounded-full p-1 transition-colors flex items-center ${chatVoiceEnabled ? 'bg-[#d8a5b7]' : 'bg-[#e7e2d8]'}`}>
                                 <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${chatVoiceEnabled ? 'translate-x-4' : ''}`}></div>
                             </div>
                         </div>
                         <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">
                             开启后，AI 回复自动生成语音条（需配置 MiniMax 和角色语音）。
                         </p>
                         {chatVoiceEnabled && (
                             <div className="mt-3">
                                 <label className="text-[10px] font-bold text-slate-400 mb-1.5 block">语音语种</label>
                                 <div className="flex flex-wrap gap-1.5">
                                     {[{v:'',l:'默认'},{v:'en',l:'English'},{v:'ja',l:'日本語'},{v:'ko',l:'한국어'},{v:'fr',l:'Français'},{v:'es',l:'Español'}].map(opt => (
                                         <button key={opt.v} onClick={() => onSetChatVoiceLang?.(opt.v)}
                                             className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-all ${chatVoiceLang === opt.v ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-500'}`}>
                                             {opt.l}
                                         </button>
                                     ))}
                                 </div>
                                 {chatVoiceLang && <p className="text-[10px] text-emerald-600/70 mt-1.5">选择非默认语种时，AI 台词会先翻译再生成语音。</p>}
                             </div>
                         )}
                     </div>

                     {/* 时间感知强化 */}
                     <div className="pt-2 border-t border-slate-100">
                         <div className="flex justify-between items-center cursor-pointer" onClick={onToggleTimeAwareness}>
                             <div className="flex items-center gap-1.5 pointer-events-none">
                                 <label className="text-xs font-bold text-slate-400 uppercase">时间感知强化</label>
                                 <span
                                     className="w-4 h-4 rounded-full bg-slate-200 text-slate-500 text-[10px] font-bold flex items-center justify-center pointer-events-auto cursor-help"
                                     title="时间感知强化是「时间感知」的重要功能。开启时会向上下文注入「距离上次聊天已过去多久」的提示，强化角色的时间观念、让 ta 主动匹配现实世界时间。关掉后不再注入这组提示词，角色不会被强制强化时间观念、也不会被强制匹配现实世界——但具体会弱化多少，取决于 API（模型）自己的理解。"
                                 >?</span>
                             </div>
                             <div className={`w-10 h-6 rounded-full p-1 transition-colors flex items-center ${timeAwarenessEnabled ? 'bg-[#d8a5b7]' : 'bg-[#e7e2d8]'}`}>
                                 <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${timeAwarenessEnabled ? 'translate-x-4' : ''}`}></div>
                             </div>
                         </div>
                         <p className="text-[10px] text-slate-400 mt-2 leading-relaxed">
                             默认开启。开启时角色会强化时间观念、主动匹配现实世界时间。关掉后不再强化时间观念，也不会强制匹配现实世界；
                             但具体弱化多少取决于 API 自己的理解。
                         </p>
                     </div>

                     <div className="pt-2 border-t border-slate-100">
                         <button onClick={() => setModalType('history-manager')} className="w-full py-3 bg-slate-50 text-slate-600 font-bold rounded-2xl border border-slate-200 active:scale-95 transition-transform flex items-center justify-center gap-2">
                             管理上下文 / 隐藏历史
                         </button>
                         <p className="text-[10px] text-slate-400 mt-2 text-center">可选择从某条消息开始显示，隐藏之前的记录（不被 AI 读取）。</p>
                     </div>
                     
                     {/* 记忆宫殿：一键向量化所有聊天记录 */}
                     {isMemoryPalaceEnabled && onForceVectorize && (
                         <div className="pt-2 border-t border-slate-100">
                             <button
                                 onClick={onForceVectorize}
                                 disabled={isVectorizing}
                                 className="w-full py-3 bg-emerald-50 text-emerald-600 font-bold rounded-2xl border border-emerald-200 active:scale-95 transition-transform flex items-center justify-center gap-2"
                             >
                                 {isVectorizing ? '🏰 向量化处理中...' : '🏰 一键向量化所有聊天记录'}
                             </button>
                             <p className="text-[10px] text-slate-400 mt-2 text-center leading-relaxed">
                                 将所有未处理的聊天记录交给回忆标本馆向量化，完成后可安全清空聊天。<br/>
                                 <span className="text-slate-300">看不懂这是什么的话不需要操作此按钮。</span>
                             </p>
                         </div>
                     )}

                     <div className="pt-2 border-t border-slate-100">
                         <label className="text-xs font-bold text-red-400 uppercase mb-3 block">危险区域 (Danger Zone)</label>
                        <div className="flex items-center gap-2 mb-3 cursor-pointer" onClick={() => setPreserveContext(!preserveContext)}>
                            <div className={`w-5 h-5 rounded-full border flex items-center justify-center transition-colors ${preserveContext ? 'bg-primary border-primary' : 'bg-slate-100 border-slate-300'}`}>
                                {preserveContext && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>}
                            </div>
                            <span className="text-sm text-slate-600">清空时保留最后10条记录 (维持语境)</span>
                        </div>
                        <button onClick={onClearChatContextOnly} className="w-full py-3 mb-2 bg-slate-50 text-slate-700 font-bold rounded-2xl border border-slate-200 active:scale-95 transition-transform flex items-center justify-center gap-2">
                            仅清空絮语上下文
                        </button>
                        <button onClick={onClearHistory} className="w-full py-3 bg-red-50 text-red-500 font-bold rounded-2xl border border-red-100 active:scale-95 transition-transform flex items-center justify-center gap-2">
                            执行清空
                        </button>
                     </div>
                </div>
            </Modal>

            {/* Archive Settings Modal */}
            <JournalSheet
                open={modalType === 'archive-settings'} title="记忆归档" en="Archive"
                sub="把最近聊天总结进长期记忆"
                tape="blue" pattern="stripe" paper="lined"
                onClose={() => { if (!isSummarizing) setModalType('none'); }}
                footer={
                    isSummarizing
                        ? <div className="w-full py-3 rounded-[12px] text-[13px] font-bold text-center flex items-center justify-center gap-2" style={{ background: '#fffdfa', border: `1px solid ${INK_SOFT}66`, color: INK, ...CUTE_STACK }}>
                            <div className="w-4 h-4 rounded-full animate-spin" style={{ border: `2px solid ${INK_SOFT}55`, borderTopColor: INK }} />
                            {archiveProgress || '正在归档…'}
                        </div>
                        : <SealBtn kind="rose" full onClick={onArchive} disabled={isSummarizing}>开始归档</SealBtn>
                }
            >
                <div className="space-y-4">
                    {(() => {
                        const palaceOn = !!(activeCharacter as any).memoryPalaceEnabled;
                        const autoOn = !!(activeCharacter as any).autoArchiveEnabled;
                        const activePrompt = archivePrompts.find(p => p.id === selectedPromptId);
                        const activeName = activePrompt?.name || '理性精炼 (Rational)';
                        if (palaceOn && autoOn) {
                            return (
                                <NoteStrip tone="good">
                                    <b>自动归档已经开启</b>：palace 处理完会按日期把聊天自动收进「本月日度总结」。
                                    自动流程用的是<b>回忆标本馆内置模板</b>（保证向量检索稳定）；
                                    下面选择的模板<b>只影响手动归档</b>，怎么换都不影响自动归档。
                                </NoteStrip>
                            );
                        }
                        if (palaceOn && !autoOn) {
                            return (
                                <NoteStrip tone="warn">
                                    回忆标本馆开着，但<b>自动归档没开</b>——palace 只在后台做向量索引，
                                    <b>不会</b>自动写进「本月日度总结」。想让它自动写：剪影集 → 登场人物 → 角色 →
                                    回忆标本馆开关下面的<b>「📚 自动归档」</b>；或者就用下面的按钮，
                                    按选中的<b>《{activeName}》</b>模板手动归档一次。
                                </NoteStrip>
                            );
                        }
                        return (
                            <NoteStrip>
                                <b>手动归档模式</b>（回忆标本馆没开）。按钮会按选中的<b>《{activeName}》</b>模板
                                把聊天按天总结进「本月日度总结」；归档后会自动把已总结的旧消息收起来（留最近一段可见）。
                            </NoteStrip>
                        );
                    })()}
                    {/* 总结模板列表 */}
                    <div>
                        <div className="text-[9px] mb-2 tracking-[0.22em] uppercase select-none" style={{ ...MONO_STACK, color: INK_SOFT }}>选择总结模板</div>
                        <div className="flex flex-col gap-2">
                            {archivePrompts.map(p => {
                                const isSelected = selectedPromptId === p.id;
                                return (
                                    <div
                                        key={p.id}
                                        onClick={() => setSelectedPromptId(p.id)}
                                        className="px-3 py-2.5 cursor-pointer flex items-center justify-between gap-2 transition-all"
                                        style={{
                                            background: isSelected ? '#fff4f7' : '#fffdfa',
                                            border: isSelected ? '1px solid #d8a5b7' : `1px solid ${INK_SOFT}66`,
                                            borderRadius: 14,
                                            boxShadow: isSelected ? '0 8px 18px -16px rgba(122,90,114,0.32)' : 'none',
                                        }}
                                    >
                                        <div className="flex items-center gap-1.5 min-w-0">
                                            {isSelected && <span aria-hidden className="text-[11px] shrink-0" style={{ color: '#b07a8d' }}>✓</span>}
                                            <span className="text-[12px] font-bold truncate" style={{ ...CUTE_STACK, color: isSelected ? INK : INK_SOFT }}>{p.name}</span>
                                        </div>
                                        <div className="flex gap-1.5 shrink-0">
                                            <button
                                                onClick={(e) => { e.stopPropagation(); setSelectedPromptId(p.id); onEditPrompt(); }}
                                                className="text-[10px] font-bold px-2 py-1 rounded-full active:scale-95 transition-transform"
                                                style={{ background: '#fffdfa', border: `1px solid ${INK_SOFT}66`, color: INK }}
                                            >查看</button>
                                            {!p.id.startsWith('preset_') && (
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); onDeletePrompt(p.id); }}
                                                    className="text-[10px] px-2 py-1 rounded-full active:scale-95 transition-transform"
                                                    style={{ color: '#d4536f', border: `1px solid ${isSelected ? '#f1c6d1' : `${INK_SOFT}66`}` }}
                                                    aria-label={`删除《${p.name}》`}
                                                >删除</button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        <button
                            onClick={onCreatePrompt}
                            className="mt-2.5 w-full py-2 text-[11px] font-bold rounded-[10px] active:scale-[0.98] transition-transform"
                            style={{ border: `1px solid ${INK_SOFT}66`, color: INK, background: 'rgba(255,253,250,0.72)', ...CUTE_STACK }}
                        >＋ 新建总结模板</button>
                    </div>
                    <NoteStrip>
                        《理性精炼》会生成条理清楚的事件日志，方便 AI 回看旧事；《日记风格》会生成 TA 第一人称的日记，更有温度。
                        模板里可以用变量：<code>{'${dateStr}'}</code>、<code>{'${char.name}'}</code>、<code>{'${userProfile.name}'}</code>、<code>{'${rawLog}'}</code>。
                    </NoteStrip>
                </div>
            </JournalSheet>

            {/* Prompt Editor Modal */}
            <JournalSheet
                open={modalType === 'prompt-editor'} title="编辑总结模板" en="Archive Template"
                sub="这套模板决定归档摘要的口吻"
                tape="silver" pattern="plain" paper="plain"
                onClose={() => setModalType('archive-settings')}
                footer={<SealBtn kind="rose" full onClick={onSavePrompt}>保存模板</SealBtn>}
            >
                <div className="space-y-3.5">
                    <LinedInput
                        value={editingPrompt?.name || ''}
                        onChange={e => setEditingPrompt((prev: any) => prev ? { ...prev, name: e.target.value } : null)}
                        tag="模板名称"
                        placeholder="给这套模板起个名…"
                        className="font-bold"
                    />
                    <LinedArea
                        value={editingPrompt?.content || ''}
                        onChange={e => setEditingPrompt((prev: any) => prev ? { ...prev, content: e.target.value } : null)}
                        className="h-64"
                        placeholder="写下归档要用的提示词…"
                    />
                </div>
            </JournalSheet>

            {/* History Manager Modal */}
            <Modal
                isOpen={modalType === 'history-manager'} title="从哪条起翻给 AI 看" en="HISTORY" onClose={() => { setModalType('none'); setHistoryPage(0); setHistorySearch(''); setPendingHideMsgId(null); }}
                footer={<><ScrapBtn variant="paper" onClick={() => onSetHistoryStart(undefined)}>全都放出来</ScrapBtn><ScrapBtn onClick={() => { setModalType('none'); setHistoryPage(0); setHistorySearch(''); setPendingHideMsgId(null); }}>好了</ScrapBtn></>}
            >
                <div className="space-y-2 max-h-[50vh] overflow-y-auto no-scrollbar p-1">
                    <ScrapNote center className="mb-2"><b>轻点</b>一条 = 设成隐藏起点（会再确认） · <b>长按</b>一条 = 跳到聊天里看原文</ScrapNote>
                    {typeof activeCharacter.hideBeforeMessageId === 'number' && activeCharacter.hideBeforeMessageId > 0 && (
                        <div className="p-2.5 text-[11px] leading-relaxed mb-2" style={{ background: 'rgba(255,253,247,0.82)', border: `1px solid ${INK_SOFT}55`, outline: `1px dashed ${INK_SOFT}55`, outlineOffset: -4, borderRadius: 12, color: INK }}>
                            <b>💡 已经设了隐藏起点</b>：灰掉的消息是归档时标「已总结」的，AI 看不到原文、但读得到它们的总结。<br/>
                            <span style={{ color: INK_SOFT }}>回忆标本馆的向量记忆另有自己的水位线（跟这儿无关），不用手动管。</span>
                        </div>
                    )}
                    <div className="sticky top-0 backdrop-blur-sm z-10 pb-1.5 -mx-1 px-1" style={{ background: 'rgba(246,243,236,0.95)' }}>
                        <div className="relative">
                            <input
                                type="text"
                                value={historySearch}
                                onChange={(e) => { setHistorySearch(e.target.value); setHistoryPage(0); }}
                                placeholder="翻找旧消息（关键词 / 字序模糊匹配）"
                                className="w-full pl-8 pr-8 py-2 text-xs focus:outline-none transition-colors"
                                style={{ background: 'rgba(255,253,247,0.82)', border: `1px solid ${INK_SOFT}55`, outline: `1px dashed ${INK_SOFT}44`, outlineOffset: -3, borderRadius: 12, color: INK }}
                            />
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                                <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                            </svg>
                            {historySearch && (
                                <button onClick={() => { setHistorySearch(''); setHistoryPage(0); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-base leading-none">×</button>
                            )}
                        </div>
                    </div>
                    {(() => {
                        const reversed = allHistoryMessages.slice().reverse();
                        const query = historySearch.trim();
                        const filtered = query ? reversed.filter(m => fuzzyMatch(m.content || '', query)) : reversed;
                        const limited = query ? filtered.slice(0, HISTORY_SEARCH_MAX) : filtered;
                        const totalPages = Math.max(1, Math.ceil(limited.length / HISTORY_PAGE_SIZE));
                        const pageMessages = limited.slice(historyPage * HISTORY_PAGE_SIZE, (historyPage + 1) * HISTORY_PAGE_SIZE);
                        const hideCut = activeCharacter.hideBeforeMessageId;
                        return (<>
                            {query && (
                                <div className="text-xs text-slate-500 px-1 py-1">
                                    找到 <b className="text-primary">{filtered.length}</b> 条匹配
                                    {filtered.length > HISTORY_SEARCH_MAX && <span className="text-slate-400">（仅显示前 {HISTORY_SEARCH_MAX} 条）</span>}
                                </div>
                            )}
                            {!query && filtered.length === 0 && (
                                <div className="text-xs text-slate-400 text-center py-4">暂无历史消息</div>
                            )}
                            {query && filtered.length === 0 && (
                                <div className="text-xs text-slate-400 text-center py-4">没有匹配的消息</div>
                            )}
                            {limited.length > HISTORY_PAGE_SIZE && (
                                <div className="flex items-center justify-between px-1 py-1">
                                    <button onClick={() => setHistoryPage(p => Math.max(0, p - 1))} disabled={historyPage === 0} className={`px-3 py-1 text-xs rounded-lg ${historyPage === 0 ? 'text-slate-300' : 'text-primary hover:bg-primary/10'}`}>上一页</button>
                                    <span className="text-xs text-slate-400">{historyPage + 1} / {totalPages}（共 {limited.length} 条）</span>
                                    <button onClick={() => setHistoryPage(p => Math.min(totalPages - 1, p + 1))} disabled={historyPage >= totalPages - 1} className={`px-3 py-1 text-xs rounded-lg ${historyPage >= totalPages - 1 ? 'text-slate-300' : 'text-primary hover:bg-primary/10'}`}>下一页</button>
                                </div>
                            )}
                            {pageMessages.map(m => {
                                const isCurrentStart = hideCut === m.id;
                                const isHidden = !!(hideCut && m.id < hideCut);
                                const cls = isCurrentStart
                                    ? 'bg-primary/10 border-primary ring-1 ring-primary'
                                    : isHidden
                                        ? 'bg-slate-50 border-slate-100 opacity-55'
                                        : 'bg-white border-slate-100 hover:bg-slate-50';
                                const contentClass = isHidden ? 'text-slate-400 line-through decoration-slate-300/70' : 'text-slate-500';
                                return (
                                    <div
                                        key={m.id}
                                        id={`history-msg-${m.id}`}
                                        onClick={() => handleHistoryItemClick(m.id)}
                                        onPointerDown={() => startHistoryLongPress(m.id)}
                                        onPointerUp={cancelHistoryLongPress}
                                        onPointerLeave={cancelHistoryLongPress}
                                        onPointerCancel={cancelHistoryLongPress}
                                        onContextMenu={(e) => e.preventDefault()}
                                        className={`p-3 rounded-xl border cursor-pointer text-xs flex gap-2 items-start transition-colors select-none ${cls}`}
                                    >
                                        <span className="text-slate-400 font-mono whitespace-nowrap pt-0.5">[{new Date(m.timestamp).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}]</span>
                                        <div className="flex-1 min-w-0">
                                            <div className="font-bold text-slate-600 mb-0.5">{m.role === 'user' ? '我' : activeCharacter.name}</div>
                                            <div className="truncate">{renderHighlighted(m.content || '', query, contentClass)}</div>
                                        </div>
                                        {isCurrentStart && <span className="text-primary font-bold text-[10px] bg-white px-2 rounded-full border border-primary/20">起点</span>}
                                        {!isCurrentStart && isHidden && <span className="text-slate-400 font-bold text-[10px] bg-white px-2 rounded-full border border-slate-200">已隐</span>}
                                    </div>
                                );
                            })}
                            {limited.length > HISTORY_PAGE_SIZE && (
                                <div className="flex items-center justify-center px-1 pt-2">
                                    <span className="text-xs text-slate-400">{historyPage + 1} / {totalPages}</span>
                                </div>
                            )}
                        </>);
                    })()}
                </div>
            </Modal>

            {/* Confirm Set Hide Start Point */}
            <Modal
                isOpen={pendingHideMsgId !== null}
                title="从这条起藏起来？"
                en="SET START"
                onClose={() => setPendingHideMsgId(null)}
                footer={<>
                    <ScrapBtn variant="paper" onClick={() => setPendingHideMsgId(null)}>再想想</ScrapBtn>
                    <ScrapBtn onClick={() => { if (pendingHideMsgId !== null) onSetHistoryStart(pendingHideMsgId); setPendingHideMsgId(null); }}>就从这儿</ScrapBtn>
                </>}
            >
                <div className="space-y-3 text-xs leading-relaxed" style={{ color: INK }}>
                    {(() => {
                        const m = allHistoryMessages.find(x => x.id === pendingHideMsgId);
                        if (!m) return <ScrapNote>这条消息找不到了。</ScrapNote>;
                        return (<>
                            <p>这条之前的消息都会被藏起来、不再发给 AI（你自己还能在聊天里翻看）。</p>
                            <div className="p-3" style={{ background: 'rgba(255,253,247,0.82)', border: `1px solid ${INK_SOFT}55`, outline: `1px dashed ${INK_SOFT}44`, outlineOffset: -4, borderRadius: 12 }}>
                                <div className="font-black mb-1" style={{ color: INK }}>{m.role === 'user' ? '我' : activeCharacter.name} <span className="font-normal text-[10px] ml-1" style={{ color: INK_SOFT }}>{new Date(m.timestamp).toLocaleString()}</span></div>
                                <div className="line-clamp-3" style={{ color: INK_SOFT }}>{m.content}</div>
                            </div>
                            {onJumpToMessageInChat && (
                                <button
                                    onClick={() => {
                                        const id = pendingHideMsgId;
                                        setPendingHideMsgId(null);
                                        setModalType('none');
                                        setHistoryPage(0);
                                        setHistorySearch('');
                                        if (id !== null) onJumpToMessageInChat(id);
                                    }}
                                    className="w-full py-2 text-xs font-bold transition-transform active:scale-[0.98]"
                                    style={{ background: 'rgba(255,253,247,0.9)', color: INK, border: `1px solid ${INK_SOFT}66`, outline: `1px dashed ${INK_SOFT}55`, outlineOffset: -4, borderRadius: 11 }}
                                >
                                    要不先跳去聊天里看看原文
                                </button>
                            )}
                        </>);
                    })()}
                </div>
            </Modal>

            <Modal isOpen={modalType === 'message-options'} title="这条怎么处理" en="MESSAGE" onClose={() => setModalType('none')}>
                <div className="space-y-2.5">
                    {/* 表情回应快捷条（QQ/微信 tap-to-react）：点一个表情即回应并关闭 */}
                    <div className="flex items-center justify-between gap-1 px-1 pb-1">
                        {REACTION_EMOJIS.map(emoji => {
                            const reacted = Array.isArray(selectedMessage?.metadata?.reactions)
                                && selectedMessage!.metadata.reactions.some((r: any) => r.emoji === emoji && r.by?.includes('user'));
                            return (
                                <button
                                    key={emoji}
                                    onClick={() => onReactMessage(emoji)}
                                    className="w-9 h-9 rounded-full text-[18px] leading-none flex items-center justify-center active:scale-90 transition-transform"
                                    style={reacted ? { background: INK, outline: '1px dashed rgba(255,255,255,0.35)', outlineOffset: -3 } : { background: 'rgba(255,253,247,0.7)', border: `1px solid ${INK_SOFT}44` }}
                                >
                                    {emoji}
                                </button>
                            );
                        })}
                    </div>
                    <ScrapRowBtn onClick={onEnterSelectionMode} icon={<ListNumbers size={18} weight="bold" />}>挑几条一起收拾</ScrapRowBtn>
                    <ScrapRowBtn onClick={onReplyMessage} icon={<Quotes size={18} weight="bold" />}>引一句来回</ScrapRowBtn>
                    <ScrapRowBtn onClick={onForwardMessage} icon={<ShareNetwork size={18} weight="bold" />}>转给别人看</ScrapRowBtn>
                    {selectedMessage?.type === 'text' && (
                        <ScrapRowBtn onClick={onEditMessageStart} icon={<PencilSimpleLine size={18} weight="bold" />}>改改措辞</ScrapRowBtn>
                    )}
                    {selectedMessage?.type === 'text' && (
                        <ScrapRowBtn onClick={onCopyMessage} icon={<Copy size={18} weight="bold" />}>抄下这段字</ScrapRowBtn>
                    )}
                    {voiceAvailable && selectedMessage?.role === 'assistant' && selectedMessage?.type === 'text' && onGenerateVoice && (
                        <ScrapRowBtn onClick={() => { onGenerateVoice(); setModalType('none'); }} icon={<SpeakerHigh size={18} weight="bold" />}>读成一段声音</ScrapRowBtn>
                    )}
                    {selectedMessage?.role === 'user' && !selectedMessage?.metadata?.recalled && (
                        <ScrapRowBtn onClick={onRecallMessage} icon={<ClockCounterClockwise size={18} weight="bold" />}>当作没说过</ScrapRowBtn>
                    )}
                    <ScrapRowBtn onClick={onDeleteMessage} danger icon={<Trash size={18} weight="bold" />}>删除这条</ScrapRowBtn>
                </div>
            </Modal>
            
             <Modal
                isOpen={modalType === 'delete-emoji'} title="删除表情" en="REMOVE" onClose={() => setModalType('none')}
                footer={<><ScrapBtn variant="paper" onClick={() => setModalType('none')}>保留</ScrapBtn><ScrapBtn variant="danger" onClick={onDeleteEmoji}>删除</ScrapBtn></>}
            >
                <div className="flex flex-col items-center gap-4 py-2">
                    {Array.isArray(selectedEmoji) ? (
                        <div className="flex flex-wrap justify-center gap-2 max-h-48 overflow-y-auto no-scrollbar w-full px-2">
                            {selectedEmoji.map((e: any, idx: number) => (
                                <img key={idx} src={e.url} className="w-16 h-16 object-contain rounded-xl" style={{ border: `1px solid ${INK_SOFT}55` }} />
                            ))}
                        </div>
                    ) : (
                        selectedEmoji && <img src={selectedEmoji.url} className="w-24 h-24 object-contain rounded-xl" style={{ border: `1px solid ${INK_SOFT}55` }} />
                    )}
                    <ScrapNote center>
                        {Array.isArray(selectedEmoji) ? `要删除这 ${selectedEmoji.length} 个表情吗？` : "要删除这个表情吗？"}
                    </ScrapNote>
                </div>
            </Modal>

            {/* Delete Category Modal */}
            <Modal
                isOpen={modalType === 'delete-category'} title="删除分组" en="REMOVE GROUP" onClose={() => setModalType('none')}
                footer={<><ScrapBtn variant="paper" onClick={() => setModalType('none')}>保留</ScrapBtn><ScrapBtn variant="danger" onClick={onDeleteCategory}>删除</ScrapBtn></>}
            >
                <div className="py-4 text-center space-y-2">
                    <p className="text-sm font-bold" style={{ color: INK }}>表情分组 <br/><span className="font-black">「{selectedCategory?.name}」</span> 要删除吗？</p>
                    <ScrapNote center>注意：这个分组里的表情会一起删除。</ScrapNote>
                </div>
            </Modal>

            {/* Category Options Modal (shown on long-press) */}
            <Modal isOpen={modalType === 'category-options'} title="表情分组" en="GROUP" onClose={() => setModalType('none')}>
                <div className="space-y-2.5">
                    <ScrapRowBtn onClick={openVisibilityModal} icon={<Eye size={18} weight="bold" />}>可用角色</ScrapRowBtn>
                    {selectedCategory && !selectedCategory.isSystem && selectedCategory.id !== 'default' && (
                        <ScrapRowBtn onClick={() => setModalType('delete-category')} danger icon={<Trash size={18} weight="bold" />}>删除分组</ScrapRowBtn>
                    )}
                </div>
            </Modal>

            {/* Category Visibility Modal */}
            <Modal
                isOpen={modalType === 'category-visibility'} title={`「${selectedCategory?.name}」谁能用`} en="WHO CAN USE" onClose={() => setModalType('none')}
                footer={<ScrapBtn onClick={handleSaveVisibility}>就这么定</ScrapBtn>}
            >
                <div className="space-y-3">
                    <ScrapNote>挑出能使用这个表情分组的角色。一个都不勾，就是谁都能用。</ScrapNote>
                    <div className="space-y-2 max-h-[40vh] overflow-y-auto no-scrollbar">
                        {allCharacters.map(c => {
                            const on = visibilitySelection.has(c.id);
                            return (
                                <div
                                    key={c.id}
                                    onClick={() => toggleVisibilityChar(c.id)}
                                    className="flex items-center gap-3 p-3 cursor-pointer transition-all"
                                    style={{ background: on ? INK : 'rgba(255,253,247,0.82)', border: `1px solid ${on ? INK : INK_SOFT + '55'}`, outline: `1px dashed ${on ? 'rgba(255,255,255,0.3)' : INK_SOFT + '55'}`, outlineOffset: -4, borderRadius: 13 }}
                                >
                                    <div className="w-5 h-5 flex items-center justify-center transition-colors shrink-0" style={{ borderRadius: 6, background: on ? '#f6f3ec' : 'rgba(255,253,247,0.6)', border: `1px solid ${on ? '#f6f3ec' : INK_SOFT + '66'}` }}>
                                        {on && <svg className="w-3 h-3" style={{ color: INK }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>}
                                    </div>
                                    <img src={c.avatar} className="w-9 h-9 rounded-xl object-cover" />
                                    <div className="flex-1 min-w-0">
                                        <div className="font-black text-sm" style={{ color: on ? '#f6f3ec' : INK }}>{c.name}</div>
                                        <div className="text-[10px] truncate" style={{ color: on ? '#cfc7b8' : INK_SOFT }}>{c.description}</div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    {visibilitySelection.size > 0 && (
                        <ScrapNote center>挑了 <span className="font-black" style={{ color: INK }}>{visibilitySelection.size}</span> 个角色能用这页。</ScrapNote>
                    )}
                </div>
            </Modal>

            <Modal
                isOpen={modalType === 'edit-message'} title="改改这句" en="EDIT" onClose={() => setModalType('none')}
                footer={<><ScrapBtn variant="paper" onClick={() => setModalType('none')}>算了</ScrapBtn><ScrapBtn onClick={onConfirmEditMessage}>就这么改</ScrapBtn></>}
            >
                <ScrapTextarea
                    value={editContent}
                    onChange={e => setEditContent(e.target.value)}
                    className="h-32"
                />
            </Modal>

            {/* Schedule Modal */}
            <JournalSheet
                open={modalType === 'schedule'} title="今日作息" en="Day Planner" tall
                sub={`${activeCharacter?.name || 'TA'} 的一天，查看详情`}
                tape="mint" pattern="dot" paper="cream"
                onClose={() => setModalType('none')}
            >
                <div>
                    {/* 总开关：关闭时不调副 API、不生成日程、不注入情绪 buff */}
                    {onToggleScheduleFeature && (
                        <div className="mb-4 flex items-start justify-between gap-3 pb-3 border-b" style={{ borderColor: '#eed6df' }}>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: '#d8a5b7' }} aria-hidden />
                                    <span className="text-[12.5px] font-bold" style={{ ...CUTE_STACK, color: INK }}>作息与心情</span>
                                </div>
                                <p className="text-[10px] mt-1 leading-relaxed" style={{ color: INK_SOFT }}>
                                    {isScheduleFeatureEnabled
                                        ? '开着：会请副 API 排出 TA 今天的日程，聊天时顺带掂量心情 buff。'
                                        : '关着：不请副 API、不排日程，也不会往对话里塞心情 buff。'}
                                </p>
                            </div>
                            <CandyToggle on={!!isScheduleFeatureEnabled} onToggle={onToggleScheduleFeature} candy="#d8a5b7" />
                        </div>
                    )}

                    {isScheduleFeatureEnabled && (
                        <>
                            {/* Schedule Style Selector */}
                            {onScheduleStyleChange && (
                                <div className="mb-4">
                                    {!activeCharacter?.scheduleStyle && (
                                        <div className="mb-3">
                                            <NoteStrip tone="warn">
                                                先挑一种过日子的写法——写法不同，TA 内心独白的味道也不同；挑好会立刻重排今天的日程。
                                            </NoteStrip>
                                        </div>
                                    )}
                                    <div className="flex gap-2.5">
                                        <button
                                            onClick={() => onScheduleStyleChange('lifestyle')}
                                            disabled={isScheduleGenerating}
                                            className="flex-1 py-2.5 px-3 text-left transition-all active:scale-[0.97] disabled:opacity-40"
                                            style={{
                                                background: (activeCharacter?.scheduleStyle || 'lifestyle') === 'lifestyle' ? '#fff4f7' : '#fffdfa',
                                                color: (activeCharacter?.scheduleStyle || 'lifestyle') === 'lifestyle' ? INK : INK_SOFT,
                                                border: (activeCharacter?.scheduleStyle || 'lifestyle') === 'lifestyle' ? '1px solid #d8a5b7' : `1px solid ${INK_SOFT}66`,
                                                borderRadius: 14,
                                                boxShadow: (activeCharacter?.scheduleStyle || 'lifestyle') === 'lifestyle' ? '0 8px 18px -16px rgba(122,90,114,0.32)' : 'none',
                                            }}
                                        >
                                            <span className="block text-[13px] font-bold mb-0.5" style={CUTE_STACK}>生活系</span>
                                            <span className="block text-[9.5px] leading-snug">把日常编出来：跑步、做饭、逛街</span>
                                        </button>
                                        <button
                                            onClick={() => onScheduleStyleChange('mindful')}
                                            disabled={isScheduleGenerating}
                                            className="flex-1 py-2.5 px-3 text-left transition-all active:scale-[0.97] disabled:opacity-40"
                                            style={{
                                                background: activeCharacter?.scheduleStyle === 'mindful' ? '#fff4f7' : '#fffdfa',
                                                color: activeCharacter?.scheduleStyle === 'mindful' ? INK : INK_SOFT,
                                                border: activeCharacter?.scheduleStyle === 'mindful' ? '1px solid #d8a5b7' : `1px solid ${INK_SOFT}66`,
                                                borderRadius: 14,
                                                boxShadow: activeCharacter?.scheduleStyle === 'mindful' ? '0 8px 18px -16px rgba(122,90,114,0.32)' : 'none',
                                            }}
                                        >
                                            <span className="block text-[13px] font-bold mb-0.5" style={CUTE_STACK}>意识系</span>
                                            <span className="block text-[9.5px] leading-snug">只写真实内心：不编造、不说谎</span>
                                        </button>
                                    </div>
                                </div>
                            )}

                            <ScheduleCard
                                schedule={scheduleData || null}
                                character={activeCharacter}
                                compact={false}
                                onEdit={onScheduleEdit}
                                onDelete={onScheduleDelete}
                                onReroll={onScheduleReroll}
                                onCoverImageChange={onScheduleCoverChange}
                                isGenerating={isScheduleGenerating}
                            />
                            <p className="text-[10px] text-center mt-3 leading-relaxed" style={{ color: INK_SOFT }}>
                                点一条可以改 · 按住不放是删掉
                            </p>

                            {/* 情绪 / 意识流 API — 与日程强制同步 */}
                            {activeCharacter && apiPresets && onAddApiPreset && onSaveEmotion && onClearBuffs && (
                                <EmotionSettingsPanel
                                    char={activeCharacter}
                                    apiPresets={apiPresets}
                                    addApiPreset={onAddApiPreset}
                                    onSave={onSaveEmotion}
                                    onClearBuffs={onClearBuffs}
                                />
                            )}
                        </>
                    )}
                </div>
            </JournalSheet>
        </>
    );
};

export default ChatModals;
