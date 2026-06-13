import React, { useState, useEffect, useRef, useLayoutEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { AppID, Message, MessageType, MemoryFragment, Emoji, EmojiCategory, DailySchedule, ScheduleSlot, CharacterProfile } from '../types';
import { processImage } from '../utils/file';
import { safeResponseJson, extractContent } from '../utils/safeApi';
import { generateDailyScheduleForChar, isScheduleFeatureOn } from '../utils/scheduleGenerator';
import { formatMessageWithTime } from '../utils/messageFormat';
import { XhsMcpClient, extractNotesFromMcpData, normalizeNote } from '../utils/xhsMcpClient';
import { isMcdConfigured } from '../utils/mcdMcpClient';
import { isMcdActivatedInMessages, MCD_ACTIVATE_TRIGGER, MCD_DEACTIVATE_TRIGGER } from '../utils/mcdToolBridge';
import MessageItem from '../components/chat/MessageItem';
import CharacterProfilePage from '../components/character/CharacterProfilePage';
import CheckPhone from './CheckPhone';
import CharPhoneCheckOverlay from '../components/chat/CharPhoneCheckOverlay';
import OfflineModeModal from '../components/chat/OfflineModeModal';
import { OFFLINE_START_EVENT, consumeOfflinePending, hasOfflineSession } from '../utils/offlineMode';
import { CHAR_PHONE_CHECK_EVENT, consumePhoneCheckPending } from '../utils/charPhoneCheck';
import { CHAR_USER_REMARK_EVENT, type UserRemarkEventDetail } from '../utils/userRemarkSystem';
import { applyRegexToText, REGEX_SCRIPTS_UPDATED_EVENT } from '../utils/regex/store';
import { regex_placement } from '../utils/regex/engine';
import McdMiniApp from '../components/mcd/McdMiniApp';
import { PRESET_THEMES, DEFAULT_ARCHIVE_PROMPTS } from '../components/chat/ChatConstants';
import ChatHeader from '../components/chat/ChatHeaderShell';
import CharacterEntryTransition from '../components/chat/CharacterEntryTransition';
import ChromeCssEditor from '../components/chat/ChromeCssEditor';
import ChatInputArea from '../components/chat/ChatInputArea';
import ConvoSettingsPanel from '../components/chat/ConvoSettingsPanel';
import ChatModals from '../components/chat/ChatModals';
import Modal from '../components/os/Modal';
import JournalSheet, { SealBtn, LinedInput, LinedArea, NoteStrip } from '../components/chat/JournalSheet';
import { MONO_STACK, SERIF_STACK, CUTE_STACK } from '../components/handbook/paper';
import { PhoneSlash } from '@phosphor-icons/react';
import ProactiveSettingsModal from '../components/chat/ProactiveSettingsModal';
import ThinkingChainSettingsModal from '../components/chat/ThinkingChainSettingsModal';
import FriendVerifyModal from '../components/chat/FriendVerifyModal';
import { useChatAI } from '../hooks/useChatAI';
import { synthesizeSpeechDetailed, cleanTextForTts } from '../utils/minimaxTts';
import { resolveMiniMaxApiKey } from '../utils/minimaxApiKey';
import { isInstantConfigReady, loadInstantConfig } from '../utils/instantPushClient';
import { ContextBuilder } from '../utils/context';
import { substituteMacros } from '../utils/macros';
import { PersonaRuntime } from '../utils/personas';
import { generateImage, IMAGE_GEN_MODEL_KEY, DEFAULT_IMAGE_GEN_MODEL } from '../utils/imageGen';
import { InnerVoiceEntry } from '../types';

const VOICE_LANG_LABELS: Record<string, string> = { en: 'English', ja: '日本語', ko: '한국어', fr: 'Français', es: 'Español' };
type InstantToolUiStatus = {
    charId: string;
    phase: 'running' | 'continuing' | 'done' | 'failed';
    text: string;
    sessionId?: string;
    updatedAt?: number;
};

const Chat: React.FC = () => {
    const { characters, activeCharacterId, setActiveCharacterId, updateCharacter, apiConfig, apiPresets, addApiPreset, closeApp, openApp, customThemes, addToast, showError, userProfile, updateUserProfile, adjustUserBalance, lastMsgTimestamp, groups, clearUnread, realtimeConfig, memoryPalaceConfig, syncEmotionApiToAllCharacters, theme: osTheme, proactiveComposingChars } = useOS();
    const isProactiveComposing = !!(activeCharacterId && proactiveComposingChars[activeCharacterId]);

    // 记忆宫殿高水位（用于清空聊天时的安全检查）
    const getMemoryPalaceHWM = useCallback(async (charId: string): Promise<number> => {
        try {
            const { getMemoryPalaceHighWaterMark } = await import('../utils/memoryPalace/pipeline');
            return getMemoryPalaceHighWaterMark(charId);
        } catch { return 0; }
    }, []);
    const [messages, setMessages] = useState<Message[]>([]);
    // Instant Push 路径："准备中"三个点 = 消息正在拼接+发送; 消失 = SSE POST 已排进
    // 浏览器网络栈. 页面关闭时会主动 abort SSE, 让 worker 尽量走 Web Push fallback。
    const [instantSendingActive, setInstantSendingActive] = useState(false);
    const [instantToolStatus, setInstantToolStatus] = useState<InstantToolUiStatus | null>(null);
    const [totalMsgCount, setTotalMsgCount] = useState(0);
    const [visibleCount, setVisibleCount] = useState(30);
    const [windowedFocusMsgId, setWindowedFocusMsgId] = useState<number | null>(null);
    const [flashMsgId, setFlashMsgId] = useState<number | null>(null);
    // 角色切换/进入时的缓入开关：先 false（透明），下一帧转 true，靠 CSS transition 平滑淡入。
    // 初值 false 让首次打开也是淡入、且不会有"先显示再变透明"的闪烁。
    // 角色切换「登场」过场是否显示。切换/进入角色时由 useLayoutEffect 在绘制前置真，覆盖住加载、避免闪到新聊天。
    const [showEntry, setShowEntry] = useState(false);
    const WINDOW_RADIUS = 25;
    const [input, setInput] = useState('');
    const [showPanel, setShowPanel] = useState<'none' | 'actions' | 'emojis'>('none');
    
    // Emoji State
    const [emojis, setEmojis] = useState<Emoji[]>([]);
    const [categories, setCategories] = useState<EmojiCategory[]>([]);
    const [activeCategory, setActiveCategory] = useState<string>('default');
    const [newCategoryName, setNewCategoryName] = useState('');

    const scrollRef = useRef<HTMLDivElement>(null);
    const lastMsgIdRef = useRef<number | null>(null);
    const scrollThrottleRef = useRef(0);
    const visibleCountRef = useRef(30);
    const activeCharIdRef = useRef(activeCharacterId);
    const charRef = useRef<typeof char>(null as any);

    // Reply Logic
    const [replyTarget, setReplyTarget] = useState<Message | null>(null);

    const [modalType, setModalType] = useState<'none' | 'transfer' | 'emoji-import' | 'chat-settings' | 'message-options' | 'edit-message' | 'delete-emoji' | 'delete-category' | 'add-category' | 'history-manager' | 'archive-settings' | 'prompt-editor' | 'category-options' | 'category-visibility' | 'schedule' | 'chrome-css'>('none');
    const [scheduleData, setScheduleData] = useState<DailySchedule | null>(null);
    const [isScheduleGenerating, setIsScheduleGenerating] = useState(false);
    const [allHistoryMessages, setAllHistoryMessages] = useState<Message[]>([]);
    const [transferAmt, setTransferAmt] = useState('');
    const [transferMode, setTransferMode] = useState<'transfer' | 'redpacket'>('transfer');
    const [transferNote, setTransferNote] = useState('');

    // 角色主页（微信好友资料页风格，单击消息头像进入）
    const [showCharProfile, setShowCharProfile] = useState(false);

    // ── 拉黑系统 ──
    // 回到聊天界面时弹一次「你已将对方拉黑」提示（按角色记忆，解除后重置）
    const [showUserBlockNotice, setShowUserBlockNotice] = useState(false);
    // 角色给用户换备注弹窗（点开看动机）
    const [remarkChangeNotice, setRemarkChangeNotice] = useState<{ remark: string; motivation?: string } | null>(null);
    const [remarkMotivationOpen, setRemarkMotivationOpen] = useState(false);
    const userBlockNoticeShownRef = useRef<string | null>(null);
    // 被角色拉黑后重新发送好友验证
    const [showFriendVerify, setShowFriendVerify] = useState(false);

    // ── 查手机（双向）──
    // 用户查角色手机：+ 号面板入口，内嵌 CheckPhone（原桌面独立 App）
    const [showCheckPhone, setShowCheckPhone] = useState(false);
    // 角色查用户手机：「允许 char 看手机」开启时角色主动发起的全屏覆盖层
    const [charPhoneCheckActive, setCharPhoneCheckActive] = useState(false);

    // ── 线下模式 ──「自动线下」开启 + 角色输出 [[OFFLINE_START]] 时弹出
    const [showOfflineMode, setShowOfflineMode] = useState(false);

    // 位置分享 modal
    const [showLocationModal, setShowLocationModal] = useState(false);
    const [locationName, setLocationName] = useState('');
    const [locationDetail, setLocationDetail] = useState('');

    // AI 画图 modal
    const [showImageGenModal, setShowImageGenModal] = useState(false);
    const [imageGenPrompt, setImageGenPrompt] = useState('');
    const [imageGenModel, setImageGenModel] = useState<string>(() => {
        try { return localStorage.getItem(IMAGE_GEN_MODEL_KEY) || DEFAULT_IMAGE_GEN_MODEL; } catch { return DEFAULT_IMAGE_GEN_MODEL; }
    });
    const [isGeneratingImage, setIsGeneratingImage] = useState(false);
    const [imageGenPreview, setImageGenPreview] = useState<string | null>(null);

    // 偷看心声 modal（角色不知情：结果不写进聊天上下文，仅存 inner_voices）
    const [showInnerVoiceModal, setShowInnerVoiceModal] = useState(false);
    const [innerVoiceLoading, setInnerVoiceLoading] = useState(false);
    const [innerVoiceCurrent, setInnerVoiceCurrent] = useState<InnerVoiceEntry | null>(null);
    const [innerVoiceHistory, setInnerVoiceHistory] = useState<InnerVoiceEntry[]>([]);
    const [emojiImportText, setEmojiImportText] = useState('');
    const [settingsContextLimit, setSettingsContextLimit] = useState(500);
    const [settingsHideSysLogs, setSettingsHideSysLogs] = useState(false);
    const [settingsHtmlModeCustomPrompt, setSettingsHtmlModeCustomPrompt] = useState('');
    const [preserveContext, setPreserveContext] = useState(true);
    const [isVectorizing, setIsVectorizing] = useState(false);
    const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
    const [selectedEmoji, setSelectedEmoji] = useState<Emoji | null>(null);
    const [selectedCategory, setSelectedCategory] = useState<EmojiCategory | null>(null); // For deletion modal
    const [editContent, setEditContent] = useState('');
    const [isSummarizing, setIsSummarizing] = useState(false);
    const [archiveProgress, setArchiveProgress] = useState('');
    const [showProactiveModal, setShowProactiveModal] = useState(false);
    const [showThinkingChainModal, setShowThinkingChainModal] = useState(false);

    // ── 语音通话（聊天内发起，角色按人设决定接不接）──
    const [voiceCallPhase, setVoiceCallPhase] = useState<'none' | 'dialing' | 'rejected'>('none');
    const voiceCallCancelRef = useRef(false);

    // ── 系统命令 modal：用户以系统身份下达最高优先级指令 ──
    const [showSystemCmdModal, setShowSystemCmdModal] = useState(false);
    const [systemCmdInput, setSystemCmdInput] = useState('');

    // Archive Prompts State
    const [archivePrompts, setArchivePrompts] = useState<{id: string, name: string, content: string}[]>(DEFAULT_ARCHIVE_PROMPTS);
    const [selectedPromptId, setSelectedPromptId] = useState<string>('preset_rational');
    const [editingPrompt, setEditingPrompt] = useState<{id: string, name: string, content: string} | null>(null);

    // --- Multi-Select State ---
    const [selectionMode, setSelectionMode] = useState(false);
    const [selectedMsgIds, setSelectedMsgIds] = useState<Set<number>>(new Set());
    // 思维链是 metadata.thinkingChain，没有独立 id，所以用宿主消息 id 作为键，
    // 与 selectedMsgIds 并行存在 —— 只勾思维链时只清 metadata，宿主消息保留。
    const [selectedThinkingMsgIds, setSelectedThinkingMsgIds] = useState<Set<number>>(new Set());

    // --- Translation State (per-character) ---
    const [translationEnabled, setTranslationEnabled] = useState(() => {
        try { return JSON.parse(localStorage.getItem(`chat_translate_enabled_${activeCharacterId}`) || 'false'); } catch { return false; }
    });
    const [translateSourceLang, setTranslateSourceLang] = useState(() => {
        // Fallback to legacy global key so existing users don't lose their setting on upgrade.
        return localStorage.getItem(`chat_translate_source_lang_${activeCharacterId}`)
            || localStorage.getItem('chat_translate_source_lang')
            || '日本語';
    });
    const [translateTargetLang, setTranslateTargetLang] = useState(() => {
        return localStorage.getItem(`chat_translate_lang_${activeCharacterId}`)
            || localStorage.getItem('chat_translate_lang')
            || '中文';
    });
    // Which messages are currently showing "译" version (toggle state only, no API calls)
    const [showingTargetIds, setShowingTargetIds] = useState<Set<number>>(new Set());

    const char = characters.find(c => c.id === activeCharacterId) || characters[0];
    charRef.current = char; // Keep ref in sync for async callbacks

    // ── 正则脚本：全局脚本变更时刷新显示层（displayMessages 依赖 regexVersion 重算）──
    const [regexVersion, setRegexVersion] = useState(0);
    useEffect(() => {
        const bump = () => setRegexVersion(v => v + 1);
        window.addEventListener(REGEX_SCRIPTS_UPDATED_EVENT, bump);
        return () => window.removeEventListener(REGEX_SCRIPTS_UPDATED_EVENT, bump);
    }, []);

    // ── 拉黑状态（双向） ──
    const userBlockedChar = !!char?.blacklisted;      // 用户拉黑了角色
    const charBlockedUser = !!char?.charBlock?.active; // 角色拉黑了用户

    // 回到聊天界面（角色资料/朋友设置收起后）弹一次「已拉黑」提示
    useEffect(() => {
        if (!char) return;
        if (char.blacklisted && !showCharProfile && userBlockNoticeShownRef.current !== char.id) {
            userBlockNoticeShownRef.current = char.id;
            setShowUserBlockNotice(true);
        }
        if (!char.blacklisted && userBlockNoticeShownRef.current === char.id) {
            userBlockNoticeShownRef.current = null;
        }
    }, [char?.id, char?.blacklisted, showCharProfile]);

    // 从角色 App（朋友资料 → 设置朋友资料）返回时重新打开角色主页：
    // 返回键只回上一个页面，而不是直接落回聊天消息列表
    useEffect(() => {
        try {
            const target = localStorage.getItem('moro_chat_reopen_profile');
            if (!target) return;
            localStorage.removeItem('moro_chat_reopen_profile');
            if (target === activeCharacterId) setShowCharProfile(true);
        } catch { /* ignore */ }
    }, [activeCharacterId]);

    // ── 开场白选择（SillyTavern first_mes / alternate_greetings 移植）──
    // 空聊天 + 角色带开场白时，在消息区显示一条可左右切换的预览气泡；
    // 点「以这条开场白开始」或直接发第一条消息时，把当前选中的开场白
    // 作为 assistant 消息落库（宏在此刻按当前用户名替换）。
    const [greetingIdx, setGreetingIdx] = useState(0);
    // 首次加载完成前不显示选择器，避免角色切换瞬间（totalMsgCount 还是 0）闪一下
    const [historyLoaded, setHistoryLoaded] = useState(false);
    const greetingOptions = useMemo(() => {
        const opts = [char?.firstMes, ...(char?.alternateGreetings || [])];
        return opts.map(g => (g || '').trim()).filter(Boolean);
    }, [char?.firstMes, char?.alternateGreetings]);
    const greetingPickerActive = !!char && historyLoaded && totalMsgCount === 0 && messages.length === 0 && greetingOptions.length > 0;
    // handleSendText 经 useCallback 持有旧闭包，用 ref 取实时值
    const greetingPickerRef = useRef({ active: false, idx: 0 });
    greetingPickerRef.current = { active: greetingPickerActive, idx: greetingIdx };

    const greetingMacroCtx = { charName: char?.name || '角色', userName: (userProfile?.name || '').trim() || '用户' };

    const commitGreeting = async (): Promise<void> => {
        const { active, idx } = greetingPickerRef.current;
        const currentChar = charRef.current;
        if (!active || !currentChar) return;
        const opts = [currentChar.firstMes, ...(currentChar.alternateGreetings || [])]
            .map(g => (g || '').trim()).filter(Boolean);
        if (opts.length === 0) return;
        const chosen = opts[Math.min(idx, opts.length - 1)];
        const content = substituteMacros(chosen, {
            charName: currentChar.name || '角色',
            userName: (userProfile?.name || '').trim() || '用户',
        });
        await DB.saveMessage({
            charId: currentChar.id,
            role: 'assistant',
            type: 'text',
            content,
            metadata: { greeting: true, greetingIndex: Math.min(idx, opts.length - 1) },
        });
        greetingPickerRef.current = { active: false, idx: 0 };
    };
    const currentThemeId = char?.bubbleStyle || 'default';
    const activeTheme = useMemo(() => {
        const fallback = PRESET_THEMES.default;
        const found = customThemes.find(t => t.id === currentThemeId) || PRESET_THEMES[currentThemeId] || fallback;
        // Defensive: legacy/imported themes may be missing `user` or `ai`, which would
        // crash MessageItem when reading styleConfig.borderRadius. Fill from default.
        return {
            ...found,
            user: { ...fallback.user, ...(found.user || {}) },
            ai: { ...fallback.ai, ...(found.ai || {}) },
        };
    }, [currentThemeId, customThemes]);
    const draftKey = `chat_draft_${activeCharacterId}`;

    // Filter categories and emojis by active character's visibility (used for both AI prompt and UI)
    const visibleCategories = useMemo(() => categories.filter(cat => {
        if (!cat.allowedCharacterIds || cat.allowedCharacterIds.length === 0) return true;
        return cat.allowedCharacterIds.includes(activeCharacterId);
    }), [categories, activeCharacterId]);

    const aiVisibleEmojis = useMemo(() => {
        const hiddenIds = new Set(categories.filter(c => !visibleCategories.some(vc => vc.id === c.id)).map(c => c.id));
        if (hiddenIds.size === 0) return emojis;
        return emojis.filter(e => !e.categoryId || !hiddenIds.has(e.categoryId));
    }, [emojis, categories, visibleCategories]);




    // 小程序快照 ref: MiniApp 状态变化时塞进来, useChatAI 在 build system prompt 时读取并注入
    const mcdMiniAppRef = useRef<import('../utils/mcdToolBridge').McdMiniAppSnapshot | undefined>(undefined);

    // --- Initialize Hook ---
    const { isTyping, streamingText, recallStatus, searchStatus, diaryStatus, emotionStatus, memoryPalaceStatus, memoryPalaceResult, setMemoryPalaceResult, lastDigestResult, setLastDigestResult, lastTokenUsage, tokenBreakdown, setLastTokenUsage, triggerAI, startProactiveChat, stopProactiveChat, isProactiveActive } = useChatAI({
        char,
        userProfile,
        apiConfig,
        groups,
        emojis: aiVisibleEmojis,
        categories: visibleCategories,
        addToast,
        showError,
        setMessages,
        realtimeConfig,
        translationConfig: translationEnabled
            ? { enabled: true, sourceLang: translateSourceLang, targetLang: translateTargetLang, style: char?.convoSettings?.translateStyle }
            : undefined,
        memoryPalaceConfig,
        mcdMiniAppRef,
        updateCharacter,
    });

    // --- Voice TTS for chat messages ---
    interface VoiceData { url: string; originalText: string; spokenText?: string; lang?: string; }
    // Persisted shape (IndexedDB assets store). `blob` is the raw audio;
    // `remoteUrl` is the fallback when fetching the MiniMax CDN blob was blocked by CORS.
    interface StoredVoice { blob?: Blob; remoteUrl?: string; originalText: string; spokenText?: string; lang?: string; }
    const voiceAssetKey = (msgId: number) => `voice_msg_${msgId}`;
    const [voiceDataMap, setVoiceDataMap] = useState<Record<number, VoiceData>>({});
    const [voiceLoading, setVoiceLoading] = useState<Set<number>>(new Set());
    const [playingMsgId, setPlayingMsgId] = useState<number | null>(null);
    const chatAudioRef = useRef<HTMLAudioElement | null>(null);
    const prevIsTypingRef = useRef(false);
    // Track blob: URLs we created so we can revoke them on character switch / unmount.
    const voiceBlobUrlsRef = useRef<Set<string>>(new Set());
    // We warn the user at most once (per character) that MiniMax voice isn't configured —
    // a character can produce many <语音> messages and we don't want to spam toasts.
    const minimaxWarnedRef = useRef(false);

    /** Whether this character can synthesize real voice (MiniMax key + a voice profile). */
    const isMinimaxReady = useCallback(() => {
        const vp = char.voiceProfile;
        const hasVoiceProfile = !!(vp?.voiceId || (vp?.timberWeights && vp.timberWeights.length > 0));
        return hasVoiceProfile && !!resolveMiniMaxApiKey(apiConfig);
    }, [char, apiConfig]);

    const persistVoice = async (msgId: number, url: string, blob: Blob | null, originalText: string, spokenText: string | undefined, lang: string | undefined) => {
        try {
            const stored: StoredVoice = blob
                ? { blob, originalText, spokenText, lang }
                : { remoteUrl: url, originalText, spokenText, lang };
            await DB.saveAssetRaw(voiceAssetKey(msgId), stored);
        } catch (e) {
            console.warn('[Chat] persist voice failed', e);
        }
    };

    /** Drop in-memory + on-disk voice data for the given message ids. */
    const discardVoiceForMessages = (ids: Iterable<number>) => {
        const idList = Array.from(ids);
        if (!idList.length) return;
        setVoiceDataMap(prev => {
            let changed = false;
            const next = { ...prev };
            for (const id of idList) {
                const entry = next[id];
                if (!entry) continue;
                if (entry.url && entry.url.startsWith('blob:')) {
                    try { URL.revokeObjectURL(entry.url); } catch { /* ignore */ }
                    voiceBlobUrlsRef.current.delete(entry.url);
                }
                delete next[id];
                changed = true;
            }
            return changed ? next : prev;
        });
        // Best-effort: remove persisted entries so they don't reappear on next load.
        for (const id of idList) {
            DB.deleteAsset(voiceAssetKey(id)).catch(() => { /* ignore */ });
        }
    };

    const handlePlayVoice = (msgId: number) => {
        const data = voiceDataMap[msgId];
        if (!data) {
            // No voice data yet — trigger TTS generation (e.g. placeholder voice bar clicked)
            const msg = messages.find(m => m.id === msgId);
            if (msg) handleManualTts(msg, false);
            return;
        }
        if (!chatAudioRef.current) chatAudioRef.current = new Audio();
        const audio = chatAudioRef.current;
        if (playingMsgId === msgId) {
            audio.pause();
            setPlayingMsgId(null);
            return;
        }
        audio.src = data.url;
        audio.onended = () => setPlayingMsgId(null);
        audio.play().catch(() => {});
        setPlayingMsgId(msgId);
    };

    // 稳定的播放回调：用 ref 持有最新闭包，引用永不变 —— 避免每条消息每次渲染都新建箭头函数，
    // 否则 MessageItem 的 React.memo 会被击穿（30 条重组件每次都全量重渲染 = 进入聊天卡顿主因之一）。
    const handlePlayVoiceRef = useRef(handlePlayVoice);
    handlePlayVoiceRef.current = handlePlayVoice;
    const onPlayVoiceStable = useCallback((id: number) => handlePlayVoiceRef.current(id), []);

    /** Extract <语音>...</语音> tag content from a message, if present */
    const extractVoiceTag = (content: string): string | null => {
        const match = content.match(/<[语語]音>([\s\S]*?)<\/[语語]音>/);
        return match ? match[1].trim() : null;
    };

    const handleManualTts = async (msg: Message, autoTriggered = false) => {
        if (voiceDataMap[msg.id] || voiceLoading.has(msg.id)) return;

        // Check if message contains a <语音> tag (AI chose to send voice)
        const voiceTagContent = extractVoiceTag(msg.content);

        // Auto-TTS: only generate voice when AI explicitly used <语音> tag
        if (autoTriggered && !voiceTagContent) return;

        // MiniMax not configured for this character: don't attempt synthesis (it would
        // throw and surface an error toast on every message / every tap). Instead remind
        // the user just once — the <语音> bubble still shows its 转文字 button so the
        // text stays readable, matching real voice messages.
        if (!isMinimaxReady()) {
            if (!autoTriggered && !minimaxWarnedRef.current) {
                minimaxWarnedRef.current = true;
                addToast('该角色未配置 MiniMax 语音，无法播放真实语音，可点「转文字」查看内容', 'info');
            }
            return;
        }

        setVoiceLoading(prev => new Set(prev).add(msg.id));
        try {
            let spokenText: string;
            let originalText: string;
            const voiceLang = char.chatVoiceLang || '';

            if (voiceTagContent) {
                // AI already provided the spoken text (possibly translated) in <语音> tag
                spokenText = cleanTextForTts(`<语音>${voiceTagContent}</语音>`);
                // originalText = text OUTSIDE the voice tag (the display/Chinese text)
                const textOutsideTag = msg.content.replace(/<[语語]音>[\s\S]*?<\/[语語]音>/g, '').trim();
                originalText = textOutsideTag ? cleanTextForTts(textOutsideTag) : '';
                // If voice lang is set and no Chinese text outside the tag, translate spoken text back to Chinese
                if (voiceLang && !originalText && spokenText) {
                    try {
                        const transRes = await fetch(`${apiConfig.baseUrl}/chat/completions`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiConfig.apiKey}` },
                            body: JSON.stringify({
                                model: apiConfig.model,
                                messages: [{ role: 'system', content: '把以下内容翻译成中文。只输出翻译结果，不要任何解释。' }, { role: 'user', content: spokenText }],
                                temperature: 0.3,
                            }),
                        });
                        const transData = await transRes.json();
                        const chineseText = transData?.choices?.[0]?.message?.content?.trim();
                        if (chineseText) originalText = chineseText;
                    } catch { /* keep originalText empty */ }
                }
            } else {
                // Manual TTS (long-press): no <语音> tag.
                // Bilingual messages already contain both a target-language side (before
                // %%BILINGUAL%%) and a Chinese side (after). When the char's voice language
                // matches the message's target language we reuse those halves directly —
                // translating again would just echo the target language back and produce
                // two identical foreign-language lines in the expanded voice bar.
                const bilingualIdx = msg.content.toLowerCase().indexOf('%%bilingual%%');
                const hasBilingual = bilingualIdx !== -1;
                if (hasBilingual && voiceLang) {
                    const langAText = cleanTextForTts(msg.content.substring(0, bilingualIdx));
                    const langBText = cleanTextForTts(msg.content.substring(bilingualIdx + '%%BILINGUAL%%'.length));
                    if (!langAText || langAText.length < 2) return;
                    spokenText = langAText;
                    originalText = langBText || '';
                } else {
                    originalText = cleanTextForTts(msg.content);
                    if (!originalText || originalText.length < 2) return;
                    spokenText = originalText;
                    if (voiceLang) {
                        const langLabel = VOICE_LANG_LABELS[voiceLang] || voiceLang;
                        try {
                            const transRes = await fetch(`${apiConfig.baseUrl}/chat/completions`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiConfig.apiKey}` },
                                body: JSON.stringify({
                                    model: apiConfig.model,
                                    messages: [{ role: 'system', content: `Translate the following text to ${langLabel}. Output ONLY the translation, nothing else.` }, { role: 'user', content: originalText }],
                                    temperature: 0.3,
                                }),
                            });
                            const transData = await transRes.json();
                            const translated = transData?.choices?.[0]?.message?.content?.trim();
                            if (translated) spokenText = translated;
                        } catch { /* use original */ }
                    }
                }
            }

            if (!spokenText || spokenText.length < 2) return;

            const { url: blobUrl, blob } = await synthesizeSpeechDetailed(spokenText, char, apiConfig, {
                languageBoost: voiceLang || undefined,
                groupId: apiConfig.minimaxGroupId || undefined,
            });
            if (blobUrl.startsWith('blob:')) voiceBlobUrlsRef.current.add(blobUrl);
            const storedSpokenText = voiceTagContent ? spokenText : (voiceLang ? spokenText : undefined);
            const storedLang = voiceLang || undefined;
            setVoiceDataMap(prev => ({ ...prev, [msg.id]: { url: blobUrl, originalText, spokenText: storedSpokenText, lang: storedLang } }));
            // Persist so the voice bar survives leaving and re-entering the chat.
            persistVoice(msg.id, blobUrl, blob, originalText, storedSpokenText, storedLang);
            // Auto-play
            if (!chatAudioRef.current) chatAudioRef.current = new Audio();
            chatAudioRef.current.src = blobUrl;
            chatAudioRef.current.onended = () => setPlayingMsgId(null);
            chatAudioRef.current.play().catch(() => {});
            setPlayingMsgId(msg.id);
        } catch (err: any) {
            addToast(`语音生成失败: ${err?.message || '未知错误'}`, 'error');
        } finally {
            setVoiceLoading(prev => { const next = new Set(prev); next.delete(msg.id); return next; });
        }
    };

    // --- Auto-TTS: when chatVoiceEnabled, auto-generate voice when AI uses <语音> tag ---
    // Scans ALL recent assistant messages (not just the last one) because chunkText
    // may split a single AI response into multiple messages, and the <语音> tag could
    // end up in any chunk — not necessarily the final one.
    useEffect(() => {
        const wasTyping = prevIsTypingRef.current;
        prevIsTypingRef.current = isTyping;
        // Only trigger when AI just finished typing (wasTyping → !isTyping)
        if (!wasTyping || isTyping) return;
        if (!char.chatVoiceEnabled) return;
        const voiceProfile = char.voiceProfile;
        if (!voiceProfile?.voiceId && (!voiceProfile?.timberWeights || voiceProfile.timberWeights.length === 0)) return;
        // Scan recent assistant messages for unprocessed <语音> tags
        for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            // Stop scanning once we hit a non-assistant message (end of current AI response batch)
            if (msg.role !== 'assistant') break;
            if (msg.type !== 'text') continue;
            if (voiceDataMap[msg.id] || voiceLoading.has(msg.id)) continue;
            handleManualTts(msg, true);
        }
    }, [isTyping]); // eslint-disable-line react-hooks/exhaustive-deps

    const canReroll = !isTyping && messages.length > 0 && messages[messages.length - 1].role === 'assistant';

    // --- Translation: pure frontend toggle (no API calls, bilingual data is already in message content) ---
    const handleTranslateToggle = useCallback((msgId: number) => {
        setShowingTargetIds(prev => {
            const next = new Set(prev);
            if (next.has(msgId)) next.delete(msgId);
            else next.add(msgId);
            return next;
        });
    }, []);

    const loadEmojiData = async () => {
        await DB.initializeEmojiData();
        const [es, cats] = await Promise.all([DB.getEmojis(), DB.getEmojiCategories()]);
        setEmojis(es);
        setCategories(cats);
        if (activeCategory !== 'default' && !cats.some(c => c.id === activeCategory)) {
            setActiveCategory('default');
        }
    };

    // Hydrate voice data from IndexedDB for currently visible messages.
    // Voice URLs are stored as blob: URLs that become invalid whenever the
    // component unmounts — persisting the raw blob and rebuilding the URL on
    // mount is what keeps previously-generated voice bars alive across
    // chat entries.
    useEffect(() => {
        if (!messages.length) return;
        const map = voiceDataMap;
        const toFetch = messages.filter(m => m.id && m.type === 'text' && m.role !== 'user' && !map[m.id]);
        if (!toFetch.length) return;
        let cancelled = false;
        (async () => {
            const updates: Record<number, VoiceData> = {};
            for (const m of toFetch) {
                try {
                    const stored = await DB.getAssetRaw(voiceAssetKey(m.id)) as StoredVoice | null;
                    if (!stored) continue;
                    let url: string | null = null;
                    if (stored.blob instanceof Blob) {
                        url = URL.createObjectURL(stored.blob);
                        voiceBlobUrlsRef.current.add(url);
                    } else if (stored.remoteUrl) {
                        url = stored.remoteUrl;
                    }
                    if (!url) continue;
                    updates[m.id] = { url, originalText: stored.originalText || '', spokenText: stored.spokenText, lang: stored.lang };
                } catch { /* ignore single-message hydration errors */ }
            }
            if (cancelled || !Object.keys(updates).length) return;
            setVoiceDataMap(prev => ({ ...updates, ...prev }));
        })();
        return () => { cancelled = true; };
    }, [messages]);

    // Revoke blob URLs when switching characters / unmounting to avoid leaks.
    useEffect(() => {
        // Reset the "MiniMax not configured" warning so each character gets one reminder.
        minimaxWarnedRef.current = false;
        const urls = voiceBlobUrlsRef.current;
        return () => {
            urls.forEach(u => { try { URL.revokeObjectURL(u); } catch { /* ignore */ } });
            urls.clear();
        };
    }, [activeCharacterId]);

    // How many messages to load per batch (initial load + each "load more" click)
    const LOAD_BATCH_SIZE = 30;

    const reloadMessages = useCallback(async (requestedVisibleCount: number) => {
        if (!activeCharacterId) return;

        const charIdAtStart = activeCharacterId;
        // 只用倒序游标取「最近 N 条」（含少量缓冲，抵消 date/call/系统消息被过滤后条数变少），
        // 不再 getAll 全量反序列化 —— 图片多/消息多的账号原本要把整段历史（含内联图片）一次性读进
        // 内存才显示 30 条，首次打开会卡好几秒。totalCount 走 index.count，不反序列化、极廉价。
        const fetchLimit = requestedVisibleCount >= 100000 ? requestedVisibleCount : requestedVisibleCount + 16;
        const applyResult = (recent: Message[], totalCount: number) => {
            // 用 ref 取当前 char（避免闭包过期）
            const currentChar = charRef.current;
            // 不在视觉层过滤 hideBeforeMessageId —— 用户能往上滚回看，
            // 上下文截断仅作用于发给 LLM 的 prompt（在 chatPrompts.ts 里处理）。
            const chatScopeMsgs = recent
                .filter(m => m.metadata?.source !== 'date' && m.metadata?.source !== 'call')
                .filter(m => !(currentChar?.hideSystemLogs && m.role === 'system' && m.type !== 'score_card'));
            setTotalMsgCount(totalCount);
            setMessages(chatScopeMsgs.slice(-requestedVisibleCount));
            setHistoryLoaded(true);
        };
        try {
            const { messages: recent, totalCount } = await DB.getRecentMessagesWithCount(activeCharacterId, fetchLimit);
            // Guard against stale async results: if the user switched characters
            // while the DB query was in flight, discard this result.
            if (activeCharIdRef.current !== charIdAtStart) return;
            applyResult(recent, totalCount);
        } catch (e) {
            // DB read failed — retry once after a short delay
            if (activeCharIdRef.current !== charIdAtStart) return;
            await new Promise(r => setTimeout(r, 200));
            if (activeCharIdRef.current !== charIdAtStart) return;
            try {
                const { messages: recent, totalCount } = await DB.getRecentMessagesWithCount(activeCharacterId, fetchLimit);
                if (activeCharIdRef.current !== charIdAtStart) return;
                applyResult(recent, totalCount);
            } catch { /* give up silently */ }
        }
    }, [activeCharacterId]);

    useEffect(() => {
        if (activeCharacterId) {
            // Update ref BEFORE any async work so stale reloadMessages calls
            // from a previous character can detect the switch and bail out.
            activeCharIdRef.current = activeCharacterId;

            // Clear messages immediately to prevent showing stale chat from previous character
            setMessages([]);
            setTotalMsgCount(0);
            setHistoryLoaded(false);
            setGreetingIdx(0);
            // Reset voice map — stale blob: URLs from the previous char are revoked
            // by the cleanup effect and must not be reused against new messages.
            setVoiceDataMap({});
            setPlayingMsgId(null);
            if (chatAudioRef.current) { try { chatAudioRef.current.pause(); } catch { /* ignore */ } }

            reloadMessages(LOAD_BATCH_SIZE);
            loadEmojiData();
            const savedDraft = localStorage.getItem(draftKey);
            setInput(savedDraft || '');
            if (char) {
                setSettingsContextLimit(char.contextLimit || 500);
                setSettingsHideSysLogs(char.hideSystemLogs || false);
                setSettingsHtmlModeCustomPrompt((char as any).htmlModeCustomPrompt || '');
                clearUnread(char.id);
            }
            // Per-character translation toggle + language pair
            try {
                setTranslationEnabled(JSON.parse(localStorage.getItem(`chat_translate_enabled_${activeCharacterId}`) || 'false'));
            } catch { setTranslationEnabled(false); }
            setTranslateSourceLang(
                localStorage.getItem(`chat_translate_source_lang_${activeCharacterId}`)
                || localStorage.getItem('chat_translate_source_lang')
                || '日本語'
            );
            setTranslateTargetLang(
                localStorage.getItem(`chat_translate_lang_${activeCharacterId}`)
                || localStorage.getItem('chat_translate_lang')
                || '中文'
            );
            setVisibleCount(30);
            visibleCountRef.current = 30;
            lastMsgIdRef.current = null;
            scrollThrottleRef.current = 0;
            setLastTokenUsage(null);
            setReplyTarget(null);
            setSelectionMode(false);
            setSelectedMsgIds(new Set());
            setShowingTargetIds(new Set());
            setWindowedFocusMsgId(null);
            setFlashMsgId(null);
            try {
                const rawToolStatus = localStorage.getItem(`instant_tool_status_${activeCharacterId}`);
                const parsed = rawToolStatus ? JSON.parse(rawToolStatus) as InstantToolUiStatus : null;
                const fresh = parsed?.updatedAt && Date.now() - parsed.updatedAt < 2 * 60_000;
                setInstantToolStatus(fresh && parsed.phase !== 'done' ? parsed : null);
            } catch {
                setInstantToolStatus(null);
            }
        }
    }, [activeCharacterId, reloadMessages]);

    // 进入/切换角色时触发「登场」过场。useLayoutEffect 在浏览器绘制前置真，
    // 让过场层先盖住，避免一帧闪到新角色的空聊天界面。
    useLayoutEffect(() => {
        if (activeCharacterId) setShowEntry(true);
        setShowCharProfile(false); // 切角色时收起上一个角色的主页
    }, [activeCharacterId]);

    // 人设自动切换（SillyTavern 角色绑定 / 默认人设语义）：进入某个角色的聊天时，
    // 若该角色绑定了人设（或无绑定但设了默认人设）且与当前激活的不同，自动切换 ——
    // 名字/头像/描述写入档案，气泡与 prompt 全链路即时生效。
    useEffect(() => {
        if (!activeCharacterId) return;
        let cancelled = false;
        PersonaRuntime.resolveForConnection({ type: 'character', id: activeCharacterId }).then(persona => {
            if (cancelled || !persona) return;
            PersonaRuntime.setActiveId(persona.id);
            const updates: Partial<typeof userProfile> = { name: persona.name, bio: persona.description };
            if (persona.avatar) updates.avatar = persona.avatar;
            updateUserProfile(updates);
            addToast(`已切换人设：${persona.name}`, 'info');
        }).catch(() => { /* 人设解析失败不拦聊天 */ });
        return () => { cancelled = true; };
    }, [activeCharacterId]);

    useEffect(() => {
        let clearTimer: ReturnType<typeof setTimeout> | null = null;
        const handler = (e: Event) => {
            const detail = (e as CustomEvent<InstantToolUiStatus>).detail;
            if (!detail?.charId || detail.charId !== activeCharIdRef.current) return;

            setInstantToolStatus(detail);
            if (clearTimer) {
                clearTimeout(clearTimer);
                clearTimer = null;
            }
            if (detail.phase === 'done' || detail.phase === 'failed') {
                clearTimer = setTimeout(() => {
                    setInstantToolStatus((prev) => (
                        prev?.sessionId && detail.sessionId && prev.sessionId !== detail.sessionId ? prev : null
                    ));
                    clearTimer = null;
                }, detail.phase === 'failed' ? 8000 : 5000);
            }
        };
        const receivedHandler = (e: Event) => {
            const detail = (e as CustomEvent<{ charId?: string }>).detail;
            if (detail?.charId && detail.charId !== activeCharIdRef.current) return;
            try {
                const charId = detail?.charId || activeCharIdRef.current;
                if (charId) localStorage.removeItem(`instant_tool_status_${charId}`);
            } catch { /* ignore */ }
            setInstantToolStatus(null);
        };
        window.addEventListener('instant-tool-status', handler);
        window.addEventListener('active-msg-received', receivedHandler);
        return () => {
            window.removeEventListener('instant-tool-status', handler);
            window.removeEventListener('active-msg-received', receivedHandler);
            if (clearTimer) clearTimeout(clearTimer);
        };
    }, []);

    // Auto-generate daily schedule (fire-and-forget on chat load)
    // 总开关关闭时完全跳过：不查询 DB、不调用副 API、不跑兜底
    useEffect(() => {
        if (!char || !apiConfig.apiKey) return;
        if (!isScheduleFeatureOn(char)) {
            setScheduleData(null);
            return;
        }
        const today = new Date().toISOString().split('T')[0];
        DB.getDailySchedule(char.id, today).then(existing => {
            if (!existing) {
                // Generate in background, don't block chat
                generateDailySchedule(char, false);
            } else {
                setScheduleData(existing);
            }
        }).catch(() => {});
    }, [activeCharacterId, char?.scheduleFeatureEnabled]);

    // Load all messages when history-manager modal opens
    useEffect(() => {
        if (modalType === 'history-manager' && activeCharacterId) {
            DB.getMessagesByCharId(activeCharacterId, true).then(allMsgs => {
                const filtered = allMsgs
                    .filter(m => m.metadata?.source !== 'date' && m.metadata?.source !== 'call')
                    .filter(m => !(char?.hideSystemLogs && m.role === 'system' && m.type !== 'score_card'));
                setAllHistoryMessages(filtered);
            });
        }
    }, [modalType, activeCharacterId, char?.hideSystemLogs]);

    useEffect(() => {
        const savedPrompts = localStorage.getItem('chat_archive_prompts');
        if (savedPrompts) {
            try {
                const parsed = JSON.parse(savedPrompts);
                const merged = [...DEFAULT_ARCHIVE_PROMPTS, ...parsed.filter((p: any) => !p.id.startsWith('preset_'))];
                setArchivePrompts(merged);
            } catch(e) {}
        }
        const savedId = localStorage.getItem('chat_active_archive_prompt_id');
        if (savedId && archivePrompts.some(p => p.id === savedId)) setSelectedPromptId(savedId);
    }, []);

    useEffect(() => {
        if (activeCharacterId && lastMsgTimestamp > 0) {
            reloadMessages(visibleCountRef.current);
            clearUnread(activeCharacterId);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- clearUnread is stable (useCallback with []), omit to prevent stale-dep lint noise
    }, [lastMsgTimestamp, activeCharacterId, reloadMessages, clearUnread]);

    useEffect(() => {
        visibleCountRef.current = visibleCount;
    }, [visibleCount]);

    // （旧的"首次自动归档 banner"已移除，自动归档改为用户在神经链接里显式 opt-in）

    // buff 同步已上移到 OSContext 的 App 级 'emotion-updated' 监听 (无条件按事件 charId 更新内存,
    // 不再受"当前是否开着该角色聊天页"限制). 之前这里有个 `charId === activeCharacterId` 守卫的
    // handler, 导致 instant 模式下用户不在该角色页时 buff 回不到前端 (只落 DB), 故移除, 同时
    // 避免和 OSContext 双写.

    // 人格抢救（角色分析弹窗）已整体移除：进聊天不再自动跑认知风格检测，也不再弹窗。

    const handleInputChange = (val: string) => {
        setInput(val);
        if (val.trim()) localStorage.setItem(draftKey, val);
        else localStorage.removeItem(draftKey);
    };

    useLayoutEffect(() => {
        if (!scrollRef.current || selectionMode) return;
        const currentLastId = messages.length > 0 ? messages[messages.length - 1].id : null;
        // Only auto-scroll when a new message is appended (ID changes),
        // not when loading older history or updating existing messages in-place.
        // windowed 模式下用户在翻旧消息，不要被新消息打断滚走。
        if (currentLastId !== lastMsgIdRef.current) {
            if (windowedFocusMsgId === null) {
                scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
            }
            lastMsgIdRef.current = currentLastId;
        }
    }, [messages, activeCharacterId, selectionMode, windowedFocusMsgId]);

    useEffect(() => {
        if (isTyping && scrollRef.current && !selectionMode && windowedFocusMsgId === null) {
            const now = Date.now();
            if (now - scrollThrottleRef.current > 150) {
                scrollThrottleRef.current = now;
                scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
            }
        }
    }, [messages, isTyping, streamingText, recallStatus, searchStatus, diaryStatus, selectionMode, windowedFocusMsgId]);

    const formatTime = (ts: number) => {
        return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    };

    // --- Actions ---

    const handleSendText = async (customContent?: string, customType?: MessageType, metadata?: any) => {
        if (!char || (!input.trim() && !customContent)) return;

        // 拉黑拦截：任意一方拉黑期间私聊都发不出去
        if (char.charBlock?.active) {
            addToast('你已被对方拉黑，消息无法送达', 'error');
            return;
        }
        if (char.blacklisted) {
            addToast(`你已将 ${char.name} 拉黑，无法发送消息`, 'error');
            return;
        }

        let text = customContent || input.trim();
        const type = customType || 'text';

        // 正则脚本（用户输入，改写消息原文）：全局 + 角色局部脚本中勾选「用户输入」
        // 且非仅显示/仅提示词的脚本在落库前生效（同 ST USER_INPUT placement）
        if (type === 'text' && text) {
            text = applyRegexToText(text, regex_placement.USER_INPUT, { char, userName: userProfile?.name });
        }

        // 发消息隐含"回到当前聊天"——退出 windowed 旧消息浏览模式
        if (windowedFocusMsgId !== null) {
            setWindowedFocusMsgId(null);
            setFlashMsgId(null);
        }

        // 用户手打"麦请求"三个字 → 等价于点击麦克风按钮 (拉起麦当劳菜单)
        // 不落库, 跟按钮点击行为完全一致, 避免出现"banner 在但菜单没拉起"的诡异状态
        if (!customContent && type === 'text' && text === MCD_ACTIVATE_TRIGGER) {
            setInput(''); localStorage.removeItem(draftKey);
            if (!isMcdConfigured()) {
                addToast('请先到 文具盒 → 麦当劳 启用并填入 MCP Token', 'info');
                return;
            }
            setMcdAppOpen(true);
            setShowPanel('none');
            return;
        }

        if (!customContent) { setInput(''); localStorage.removeItem(draftKey); }
        
        if (type === 'image') {
            const recentChat = messages.slice(-10).map(m => {
                const sender = m.role === 'user' ? userProfile.name : char.name;
                return `${sender}: ${m.content.substring(0, 100)}`;
            });
            await DB.saveGalleryImage({
                id: `img-${Date.now()}-${Math.random()}`,
                charId: char.id,
                url: text,
                timestamp: Date.now(),
                savedDate: new Date().toISOString().split('T')[0],
                chatContext: recentChat
            });
            addToast('图片已保存至相册', 'info');
        }

        // 开场白选择器还开着时直接发消息 = 以当前选中的开场白开场（同 ST：
        // 开场白本来就是聊天的第一条消息，用户回复即确认了当前 swipe 到的那条）
        if (greetingPickerRef.current.active) {
            try { await commitGreeting(); } catch (e) { console.warn('[Greeting] 开场白落库失败:', e); }
        }

        // Telegram 式回执：用户消息落库即「已发出」（单勾），角色回复成功后升级为「已读」（双勾）
        const msgPayload: any = { charId: char.id, role: 'user', type, content: text, metadata: { ...(metadata || {}), msgStatus: 'sent' } };

        if (replyTarget) {
            msgPayload.replyTo = {
                id: replyTarget.id,
                content: replyTarget.content,
                name: replyTarget.role === 'user' ? '我' : char.name
            };
            setReplyTarget(null);
        }

        const savedUserMsgId = await DB.saveMessage(msgPayload);

        // Detect XHS link in user text and create xhs_card via MCP
        if (type === 'text') {
            const xhsUrlMatch = text.match(/xiaohongshu\.com\/(?:discovery\/item|explore)\/([a-f0-9]{24})/);
            const mcpUrl = realtimeConfig?.xhsMcpConfig?.serverUrl;
            if (xhsUrlMatch && mcpUrl && realtimeConfig?.xhsMcpConfig?.enabled) {
                const noteUrl = `https://www.xiaohongshu.com/explore/${xhsUrlMatch[1]}`;
                try {
                    const result = await XhsMcpClient.getNoteDetail(mcpUrl, noteUrl);
                    if (result.success && result.data) {
                        const note = normalizeNote(result.data);
                        await DB.saveMessage({
                            charId: char.id,
                            role: 'user',
                            type: 'xhs_card',
                            content: note.title || '小红书笔记',
                            metadata: { xhsNote: note }
                        });
                    }
                } catch (e) {
                    console.warn('XHS link fetch via MCP failed:', e);
                }
            }
        }

        await reloadMessages(visibleCountRef.current);
        setShowPanel('none');

        // Instant Push 模式：发完文本自动触发 AI（响应在 worker 端跑、后台 push 回写聊天页）。
        // 本地模式仍维持手动触发以保留现有 UX。triggerAI 内部会从 DB 拉完整历史，
        // 闭包里的 messages 还没包含刚写入的 user msg 也没关系。
        // 仅文本消息触发；image / xhs_card 等卡片消息不触发，与本地手动行为对齐。
        // autoTriggerOnSend gate：instant ready 也只在用户显式开启"发送后自动触发"时才自动回复，
        // 否则保留手动 ⚡（避免"启用 instant = 自动回复"的反直觉强绑定）。
        const instantCfg = loadInstantConfig();
        if (type === 'text' && isInstantConfigReady(instantCfg) && instantCfg.autoTriggerOnSend) {
            // 上一轮还在跑时直接跳过：triggerAI 内部会因 isTyping=true 静默 reject，
            // 提前 guard 避免点亮"准备中"指示灯后没人来清，UI 灯被卡住。
            if (isTyping) return;
            // 标记"准备中"三个点：拼接+发送期间显示，SSE POST 入队 (onInstantPosted) 后清除。
            setInstantSendingActive(true);
            triggerAI(messages, undefined, () => setInstantSendingActive(false));
        }
    };

    // 顶栏 ⚡ 手动触发。instant 模式下给"上一条 assistant 之后的所有 user 消息"打上"准备中"
    // 三个点（从写入 DB 到 SSE POST 入队之间），由 onInstantPosted 清除 ——
    // 与 autoTriggerOnSend 自动路径的指示器行为一致。本地模式无此指示器，直接 triggerAI。
    const handleManualTrigger = () => {
        // 拉黑期间不触发 AI 回复（双向都无法继续私聊）
        if (char && (char.blacklisted || char.charBlock?.active)) {
            addToast(char.charBlock?.active ? '你已被对方拉黑' : '你已将对方拉黑，无法继续私聊', 'error');
            return;
        }
        // 同上：上一轮还在跑时 triggerAI 会静默 reject，提前挡掉避免指示灯卡死。
        if (isTyping) return;
        if (!isInstantConfigReady()) { triggerAI(messages); return; }
        // instantSendingActive 驱动 header "发送中…" 徽章 (拼接+发送窗口). 消息上的三个小圆点
        // 另走纯前端判定 (isTyping && 最后一条消息), 见渲染处.
        setInstantSendingActive(true);
        triggerAI(messages, undefined, () => setInstantSendingActive(false));
    };

    const handleReroll = async () => {
        if (isTyping || messages.length === 0) return;

        const lastMsg = messages[messages.length - 1];
        if (lastMsg.role !== 'assistant') return;

        const toDeleteIds: number[] = [];
        let index = messages.length - 1;
        while (index >= 0 && messages[index].role === 'assistant') {
            toDeleteIds.push(messages[index].id);
            index--;
        }

        if (toDeleteIds.length === 0) return;

        await DB.deleteMessages(toDeleteIds);
        discardVoiceForMessages(toDeleteIds);
        const newHistory = messages.slice(0, index + 1);
        setMessages(newHistory);
        addToast('回溯对话中...', 'info');

        triggerAI(newHistory);
    };

    const handleImageSelect = async (file: File) => {
        try {
            const base64 = await processImage(file, { maxWidth: 600, quality: 0.6, forceJpeg: true });
            setShowPanel('none');
            await handleSendText(base64, 'image');
        } catch (err: any) {
            addToast(err.message || '图片处理失败', 'error');
        }
    };

    // ── 拉黑模式「看看 TA 在做什么」：用户仍无法私聊，但落一条引导 system 消息后
    //    触发角色生成此刻的动态（发现被拉黑的反应 / 把对话框当备忘录 / 试图挽回等，按人设）──
    const handlePeekBlockedChar = async () => {
        if (!char || isTyping) return;
        setShowUserBlockNotice(false);
        await DB.saveMessage({
            charId: char.id,
            role: 'system',
            type: 'text',
            content: `[拉黑观察] ${userProfile.name} 在拉黑「${char.name}」期间悄悄点开了对话框，想看看 TA 在做什么。请以「${char.name}」的身份生成 TA 此刻发出的消息：可能 TA 本想正常发消息却发现自己被拉黑、可能把这个发不出去的对话框当成备忘录/树洞自言自语、可能在尝试挽回、也可能赌气或装作无所谓——完全按 TA 的人设来。TA 并不知道 ${userProfile.name} 看得到这些。`,
            metadata: { blockPeek: true },
        } as any);
        await reloadMessages(visibleCountRef.current);
        triggerAI(messages);
    };

    // ── 角色主动查用户手机：「允许 char 看手机」开启时，AI 回复落定后小概率发起（带冷却）──
    const CHAR_PHONE_CHECK_COOLDOWN_MS = 6 * 60 * 60 * 1000;
    const phoneCheckPrevTypingRef = useRef(false);
    useEffect(() => {
        const wasTyping = phoneCheckPrevTypingRef.current;
        phoneCheckPrevTypingRef.current = isTyping;
        if (!wasTyping || isTyping) return; // 仅在 AI 刚回复完的下降沿判定
        if (!char?.convoSettings?.allowPhoneBrowse) return; // 设置关闭则角色绝不发起
        if (charPhoneCheckActive || showOfflineMode || showCheckPhone || showCharProfile) return;
        if (char.blacklisted || char.charBlock?.active) return;
        if (!apiConfig?.apiKey || !apiConfig?.baseUrl) return;
        const cooldownKey = `moro_char_phone_check_last_${char.id}`;
        let last = 0;
        try { last = Number(localStorage.getItem(cooldownKey) || 0); } catch { /* ignore */ }
        if (Date.now() - last < CHAR_PHONE_CHECK_COOLDOWN_MS) return;
        if (Math.random() > 0.15) return;
        try { localStorage.setItem(cooldownKey, String(Date.now())); } catch { /* ignore */ }
        const timer = setTimeout(() => setCharPhoneCheckActive(true), 1500);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isTyping]);

    // 查手机结束：记录已由覆盖层落库进上下文，这里刷新消息并让角色主动发消息收尾
    const handleCharPhoneCheckEnd = (exitMode: 'consent' | 'questions' | 'forced' | 'finished') => {
        setCharPhoneCheckActive(false);
        void reloadMessages(visibleCountRef.current);
        addToast(exitMode === 'forced' ? `你抢回了手机，${char?.name} 好像有话要说…` : `${char?.name} 把手机还给了你`, 'info');
        setTimeout(() => { triggerAI(messages); }, 800);
    };

    // ── 线下模式：监听 [[OFFLINE_START]] 广播（applyAssistantPostProcessing 剥离指令后发出）──
    useEffect(() => {
        const handler = (e: Event) => {
            const d = (e as CustomEvent).detail as { charId?: string };
            if (!d?.charId || d.charId !== activeCharIdRef.current) return;
            consumeOfflinePending(d.charId); // 事件路径直接弹，吃掉 pending 防止下次重复弹
            setShowOfflineMode(true);
        };
        window.addEventListener(OFFLINE_START_EVENT, handler);
        return () => window.removeEventListener(OFFLINE_START_EVENT, handler);
    }, []);

    // ── 角色查用户手机：监听 [[CHECK_PHONE]] 广播（系统命令指示角色发起，
    //    applyAssistantPostProcessing 剥离指令后发出）──
    useEffect(() => {
        const handler = (e: Event) => {
            const d = (e as CustomEvent).detail as { charId?: string };
            if (!d?.charId || d.charId !== activeCharIdRef.current) return;
            consumePhoneCheckPending(d.charId); // 事件路径直接弹，吃掉 pending 防止下次重复弹
            setCharPhoneCheckActive(true);
        };
        window.addEventListener(CHAR_PHONE_CHECK_EVENT, handler);
        return () => window.removeEventListener(CHAR_PHONE_CHECK_EVENT, handler);
    }, []);

    // ── 角色给用户换备注：监听 [[SET_USER_REMARK]] 广播，弹「换备注」弹窗（点开看动机）──
    useEffect(() => {
        const handler = (e: Event) => {
            const d = (e as CustomEvent).detail as Partial<UserRemarkEventDetail>;
            if (!d?.charId || d.charId !== activeCharIdRef.current || !d.remark) return;
            setRemarkMotivationOpen(false);
            setRemarkChangeNotice({ remark: d.remark, motivation: d.motivation });
        };
        window.addEventListener(CHAR_USER_REMARK_EVENT, handler);
        return () => window.removeEventListener(CHAR_USER_REMARK_EVENT, handler);
    }, []);

    // 进入/切换角色时兜底：有 pending（事件发出时不在本聊天页）或未结束的线下会话则恢复弹窗
    useEffect(() => {
        if (!activeCharacterId) return;
        if (consumeOfflinePending(activeCharacterId) || hasOfflineSession(activeCharacterId)) {
            setShowOfflineMode(true);
        } else {
            setShowOfflineMode(false);
        }
        setShowCheckPhone(false);
        // 查手机 pending 兜底：系统命令触发时用户不在本聊天页的情况
        setCharPhoneCheckActive(consumePhoneCheckPending(activeCharacterId));
    }, [activeCharacterId]);

    // 线下模式结束：情景已合成 system 消息落库，刷新后让角色主动发消息收尾
    const handleOfflineEnd = () => {
        setShowOfflineMode(false);
        void reloadMessages(visibleCountRef.current);
        addToast('线下模式已结束，回到线上聊天', 'info');
        setTimeout(() => { triggerAI(messages); }, 800);
    };

    // ── 已读回执：聊天页打开着时，把当前可见的角色消息标记为已读（Telegram 式双勾）──
    useEffect(() => {
        if (!char) return;
        const unread = messages.filter(m => m.role === 'assistant' && !m.groupId && m.metadata?.msgStatus !== 'read');
        if (unread.length === 0) return;
        let cancelled = false;
        void (async () => {
            try {
                await DB.setMessagesStatus(unread.map(m => m.id), 'read');
                if (cancelled) return;
                setMessages(prev => prev.map(m => (m.role === 'assistant' && !m.groupId && m.metadata?.msgStatus !== 'read')
                    ? { ...m, metadata: { ...(m.metadata || {}), msgStatus: 'read' } }
                    : m));
            } catch { /* 回执写入失败不影响消息本体 */ }
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [messages, char?.id]);

    // ── 语音通话：用户主动拨打 → 角色按人设 + 当前剧情决定接不接 → 接通则跳转电话 App ──
    const startVoiceCall = async () => {
        if (!char) return;
        if (char.blacklisted || char.charBlock?.active) {
            addToast(char.charBlock?.active ? '你已被对方拉黑，无法拨打' : '你已将对方拉黑，无法拨打', 'error');
            return;
        }
        if (!apiConfig.baseUrl || !apiConfig.apiKey) { addToast('请先在「文具盒」里配置 API', 'error'); return; }
        setShowPanel('none');
        voiceCallCancelRef.current = false;
        setVoiceCallPhase('dialing');
        try {
            const context = ContextBuilder.buildCoreContext(char, userProfile, true);
            const allMsgs = await DB.getMessagesByCharId(char.id);
            const recent = allMsgs.slice(-30).map(m => formatMessageWithTime(m, char.name, userProfile.name, formatTime)).join('\n');
            const prompt = `${context}

### [最近的对话]
${recent || '（你们还没怎么聊过）'}

### [Task: 来电决策]
${userProfile.name} 此刻正在给你拨语音电话。根据你的人设、你们当前的关系与剧情走向、以及你此刻可能正在做的事，决定接还是不接——完全按你自己的性格来，不用迎合。
只输出一行 JSON，不要任何其他内容：{"answer": true 或 false, "reason": "你做这个决定时的内心想法（一句话）"}`;
            // 决策请求与最短响铃时间并行：让"正在呼叫"至少停留一会儿，更像真的在拨号
            const minRing = new Promise(r => setTimeout(r, 2500));
            const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
                body: JSON.stringify({
                    model: apiConfig.model,
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.9,
                }),
            });
            if (!response.ok) throw new Error(`API ${response.status}`);
            const data = await safeResponseJson(response);
            await minRing;
            if (voiceCallCancelRef.current) return;
            const raw = (extractContent(data) || '').trim();
            let answer = true;
            let reason = '';
            try {
                const jsonMatch = raw.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch[0]);
                    answer = parsed.answer !== false;
                    reason = String(parsed.reason || '').slice(0, 120);
                }
            } catch { /* 解析失败按接听处理 */ }
            if (answer) {
                setVoiceCallPhase('none');
                // 电话 App 拨号握手键：CallApp 挂载时读取并直接选中该角色接通
                try { sessionStorage.setItem('moro_phone_dial_char_id', char.id); } catch { /* ignore */ }
                openApp(AppID.Call);
            } else {
                await DB.saveMessage({
                    charId: char.id,
                    role: 'user',
                    type: 'call_log',
                    content: '对方未接听',
                    metadata: { callDirection: 'outgoing', callOutcome: 'declined', declineReason: reason, msgStatus: 'sent' },
                } as any);
                // 让角色按人设决定要不要为没接电话发消息解释（也可以只回一句很短的，或语气敷衍——都按人设）
                await DB.saveMessage({
                    charId: char.id,
                    role: 'system',
                    type: 'text',
                    content: `[语音通话] ${userProfile.name} 刚刚给「${char.name}」拨了语音电话，但「${char.name}」没有接（TA 当时的内心想法：${reason || '现在不太方便接'}）。请以「${char.name}」的身份决定接下来的反应：可以发消息解释为什么没接、可以含糊带过、可以发一句很短的话、也可以表现得若无其事——完全按 TA 的人设和此刻的心情来。`,
                    metadata: { proactiveHint: true, hidden: true },
                } as any);
                setVoiceCallPhase('rejected');
                await reloadMessages(visibleCountRef.current);
                setTimeout(() => setVoiceCallPhase('none'), 2000);
                setTimeout(() => { triggerAI(messages); }, 600);
            }
        } catch (e: any) {
            if (!voiceCallCancelRef.current) {
                setVoiceCallPhase('none');
                addToast(`呼叫失败：${e?.message || '未知错误'}`, 'error');
            }
        }
    };

    const cancelVoiceCall = async () => {
        voiceCallCancelRef.current = true;
        setVoiceCallPhase('none');
        if (!char) return;
        await DB.saveMessage({
            charId: char.id,
            role: 'user',
            type: 'call_log',
            content: '已取消',
            metadata: { callDirection: 'outgoing', callOutcome: 'cancelled', msgStatus: 'sent' },
        } as any);
        await reloadMessages(visibleCountRef.current);
    };

    // ── 系统命令：用户以系统身份下达最高优先级指令，发出后立即触发角色执行 ──
    const handleSendSystemCommand = async () => {
        const cmd = systemCmdInput.trim();
        if (!char || !cmd) return;
        if (isTyping) { addToast('角色正在回复中，稍等片刻再下达命令', 'info'); return; }
        setShowSystemCmdModal(false);
        setSystemCmdInput('');
        await DB.saveMessage({
            charId: char.id,
            role: 'system',
            type: 'text',
            content: `[系统命令] ${cmd}`,
            metadata: { systemCommand: true },
        } as any);
        await reloadMessages(visibleCountRef.current);
        triggerAI(messages);
    };

    const handlePanelAction = (type: string, payload?: any) => {
        switch (type) {
            case 'transfer': setModalType('transfer'); break;
            case 'poke': handleSendText('[戳一戳]', 'interaction'); break;
            case 'trigger-ai': handleManualTrigger(); break;
            case 'archive': setModalType('archive-settings'); break;
            case 'settings': setModalType('chat-settings'); break;
            case 'chrome-css': setModalType('chrome-css'); break;
            case 'emoji-import': setModalType('emoji-import'); break;
            case 'send-emoji': if (payload) handleSendText(payload.url, 'emoji'); break;
            case 'delete-emoji-req': setSelectedEmoji(payload); setModalType('delete-emoji'); break;
            case 'add-category': setModalType('add-category'); break;
            case 'select-category': setActiveCategory(payload); break;
            case 'category-options': setSelectedCategory(payload); setModalType('category-options'); break;
            case 'delete-category-req': setSelectedCategory(payload); setModalType('delete-category'); break;
            case 'proactive': setShowProactiveModal(true); break;
            case 'emotion': setModalType('schedule'); break; // 情绪已并入日程，打开同一 modal
            case 'schedule': setModalType('schedule'); break;
            case 'mcd-not-configured':
                addToast('请先到 文具盒 → 麦当劳 启用并填入 MCP Token', 'info');
                break;
            case 'mcd-request':
                setMcdAppOpen(true);
                break;
            case 'mcd-end':
                handleSendText(MCD_DEACTIVATE_TRIGGER, 'text', { mcdDeactivate: true });
                break;
            case 'thinking-settings': {
                // 「展示思考」按钮 → 打开思考链设置 modal（开关 / 卡片风格 / 配色 / 追加提示词）
                if (!char) break;
                setShowThinkingChainModal(true);
                break;
            }
            case 'check-phone': setShowPanel('none'); setShowCheckPhone(true); break;
            case 'location': setShowPanel('none'); setShowLocationModal(true); break;
            case 'image-gen': setShowPanel('none'); setShowImageGenModal(true); break;
            case 'voice-record-denied': addToast('无法访问麦克风，请检查浏览器权限', 'error'); break;
            case 'voice-call': void startVoiceCall(); break;
            case 'system-command': setShowPanel('none'); setShowSystemCmdModal(true); break;
            case 'offline-date': {
                // 用户主动发起线下模式（原「见面」App 并入此处）：直接打开线下场景窗口，
                // OfflineModeModal 没有进行中的会话时会自动生成见面开场；与角色 [[OFFLINE_START]]
                // 自动触发（聊天设置「自动线下」）共用同一套线下模式与上下文落库。
                if (!char) break;
                if (char.blacklisted || char.charBlock?.active) { addToast('拉黑期间无法见面', 'error'); break; }
                setShowPanel('none');
                setShowOfflineMode(true);
                break;
            }
        }
    };

    // --- 语音消息：录音结束后落库发送（转写文字进 metadata，AI 上下文可读）---
    const handleSendVoice = async (audio: string, durationSec: number, transcript: string) => {
        await handleSendText('[语音消息]', 'voice', { voiceAudio: audio, durationSec, transcript });
    };

    // --- 位置分享 ---
    const handleSendLocation = async () => {
        const name = locationName.trim();
        if (!name) { addToast('填一下地点名称', 'info'); return; }
        await handleSendText(name, 'location', { address: locationDetail.trim() });
        setShowLocationModal(false);
        setLocationName('');
        setLocationDetail('');
    };

    // --- AI 画图：生成 → 预览 → 确认发送（发送走 image 通道，自动存相册）---
    const handleGenerateImage = async () => {
        const prompt = imageGenPrompt.trim();
        if (!prompt) { addToast('描述一下想画什么', 'info'); return; }
        setIsGeneratingImage(true);
        try {
            try { localStorage.setItem(IMAGE_GEN_MODEL_KEY, imageGenModel.trim()); } catch {}
            const dataUri = await generateImage(prompt, apiConfig, imageGenModel);
            setImageGenPreview(dataUri);
        } catch (e: any) {
            showError('AI 画图失败', e?.message || String(e));
        } finally {
            setIsGeneratingImage(false);
        }
    };
    const handleSendGeneratedImage = async () => {
        if (!imageGenPreview) return;
        await handleSendText(imageGenPreview, 'image', { aiGenerated: true, genPrompt: imageGenPrompt.trim() });
        setShowImageGenModal(false);
        setImageGenPreview(null);
        setImageGenPrompt('');
    };

    // --- 偷看心声（入口：顶栏角色头像）：用完整人设 + 最近对话生成角色"没说出口的
    //     内心独白"，同一轮顺带评估「当前心情」与「好感值」（落在 char 上）。
    //     独白只存 inner_voices，不进聊天上下文 —— 角色"不知道"被偷看过。 ---
    const tryOpenInnerVoice = () => {
        // 会话设置「心声手记」开关：关闭后不可偷看心声
        if (char?.convoSettings?.innerVoiceEnabled === false) {
            addToast('心声手记已在聊天设置中关闭', 'info');
            return;
        }
        openInnerVoiceModal();
    };
    const openInnerVoiceModal = async () => {
        setShowInnerVoiceModal(true);
        setInnerVoiceCurrent(null);
        if (activeCharacterId) {
            try { setInnerVoiceHistory(await DB.getInnerVoicesByCharId(activeCharacterId)); } catch { setInnerVoiceHistory([]); }
        }
        generateInnerVoice();
    };
    const generateInnerVoice = async () => {
        if (!char || innerVoiceLoading) return;
        if (!apiConfig.baseUrl || !apiConfig.apiKey) { addToast('请先在「文具盒」里配置 API', 'error'); return; }
        setInnerVoiceLoading(true);
        try {
            try {
                const { injectMemoryPalace } = await import('../utils/memoryPalace/pipeline');
                await injectMemoryPalace(char);
            } catch { /* 记忆宫殿未启用时跳过 */ }
            const context = ContextBuilder.buildCoreContext(char, userProfile, true);
            const allMsgs = await DB.getMessagesByCharId(char.id);
            const recent = allMsgs.slice(-30).map(m => formatMessageWithTime(m, char.name, userProfile.name, formatTime)).join('\n');
            const currentAffection = typeof char.affection === 'number' ? Math.round(char.affection) : null;
            const fullPrompt = `${context}

### [最近的对话]
${recent || '（你们还没怎么聊过）'}

### [Task: 内心独白 + 状态评估]
此刻，用户悄悄"偷看"了你的内心。请以「${char.name}」的第一人称完成三件事：

1. voice —— 写一段此刻真实的内心独白（150-250字）：
- 写那些你**没有说出口**的想法：对刚才对话的真实感受、藏起来的情绪、对用户的真实看法、心里盘算的小心思
- 必须与你的人设和最近对话强相关，可以坦率、可以矛盾、可以有不想承认的部分
- 不要写成对用户说话的语气，这是你自己脑内的声音

2. mood —— 你此刻的心情：label 是 2~6 个字的中文词（如"有点雀跃"、"烦躁"、"安心"），emoji 是最贴切的一个表情符号。

3. affection —— 你当前对用户的好感值（0~100 整数；50 为中性，关系亲密则高，疏远/闹矛盾则低）。${currentAffection !== null ? `你此前的好感值是 ${currentAffection}，请基于最近互动微调（一次变化一般不超过 ±8），重大事件才允许大幅波动。` : '这是第一次评估，请基于人设与目前关系给出基准值。'}

只输出一个 JSON 对象（不要 markdown 代码块、不要任何解释）：
{"voice":"内心独白正文","mood":{"emoji":"🙂","label":"平静"},"affection":${currentAffection ?? 50}}`;
            const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
                body: JSON.stringify({
                    model: apiConfig.model,
                    messages: [{ role: 'user', content: fullPrompt }],
                    temperature: 0.9,
                }),
            });
            if (!response.ok) throw new Error(`API ${response.status}`);
            const data = await safeResponseJson(response);
            const content = (extractContent(data) || '').trim();
            if (!content) throw new Error('返回为空');

            // 解析 JSON（模型偶尔包代码块/夹杂文字时取首个 {...}）；解析失败则整段当独白，
            // 心情/好感保持原值不动 —— 独白永远不能因为格式问题丢失
            let voice = content;
            let moodPatch: CharacterProfile['currentMood'] | undefined;
            let affectionPatch: number | undefined;
            try {
                const jsonMatch = content.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch[0]);
                    if (typeof parsed.voice === 'string' && parsed.voice.trim()) {
                        voice = parsed.voice.trim();
                        const moodLabel = typeof parsed.mood?.label === 'string' ? parsed.mood.label.trim() : '';
                        if (moodLabel) {
                            moodPatch = {
                                label: moodLabel.slice(0, 12),
                                emoji: typeof parsed.mood?.emoji === 'string' ? parsed.mood.emoji.trim().slice(0, 4) : undefined,
                                updatedAt: Date.now(),
                            };
                        }
                        const aff = Number(parsed.affection);
                        if (Number.isFinite(aff)) affectionPatch = Math.max(0, Math.min(100, Math.round(aff)));
                    }
                }
            } catch { /* 按纯文本独白兜底 */ }

            const entry: InnerVoiceEntry = {
                id: `iv-${Date.now()}-${Math.floor(Math.random() * 1e4)}`,
                charId: char.id,
                content: voice,
                timestamp: Date.now(),
            };
            await DB.saveInnerVoice(entry);
            setInnerVoiceCurrent(entry);
            setInnerVoiceHistory(prev => [entry, ...prev]);

            if (moodPatch || affectionPatch !== undefined) {
                const patch: Partial<CharacterProfile> = {};
                if (moodPatch) patch.currentMood = moodPatch;
                if (affectionPatch !== undefined) patch.affection = affectionPatch;
                updateCharacter(char.id, patch);
            }
        } catch (e: any) {
            showError('偷看失败', e?.message || String(e));
        } finally {
            setInnerVoiceLoading(false);
        }
    };

    // 当前会话麦请求是否激活 (从消息历史推导, 无新存储)
    const mcdActivated = useMemo(() => isMcdActivatedInMessages(messages), [messages]);
    const [mcdAppOpen, setMcdAppOpen] = useState(false);
    // mcdMiniAppRef 声明在文件靠前 (传给 useChatAI), 这里仅占位
    const mcdConfiguredFlag = useMemo(() => isMcdConfigured(), [showPanel, mcdActivated]);

    // 用户在菜单卡里点"发送给角色"时, 把购物车作为 user 消息插入
    const handleMcdSendCart = useCallback(async (items: import('../components/chat/McdCard').McdCartItem[]) => {
        if (!char || !items.length) return;
        const summary = items.map(i => `${i.name}×${i.qty}`).join('、');
        const total = items.reduce((s, c) => {
            const p = typeof c.price === 'string' ? parseFloat(c.price) : (typeof c.price === 'number' ? c.price : 0);
            return s + (isFinite(p) ? p * c.qty : 0);
        }, 0);
        const totalStr = total > 0 ? ` 共¥${total.toFixed(2)}` : '';
        const content = `想要下单：${summary}${totalStr}`;
        await DB.saveMessage({
            charId: char.id,
            role: 'user',
            type: 'mcd_card',
            content,
            metadata: { mcdCardKind: 'cart', mcdCartItems: items },
        } as any);
        await reloadMessages(visibleCountRef.current);
    }, [char, reloadMessages]);

    // 用户在菜单卡某条单品上点 💭 → 立即把这条扔给角色让 ta 评价 (候选状态, 不进购物车)
    const handleMcdCandidate = useCallback(async (item: import('../components/chat/McdCard').McdCartItem) => {
        if (!char || !item) return;
        const priceStr = typeof item.price === 'number' ? ` ¥${item.price}` : (typeof item.price === 'string' && item.price ? ` ¥${item.price}` : '');
        const content = `「${item.name}」${priceStr}—— 这个怎么样？`;
        await DB.saveMessage({
            charId: char.id,
            role: 'user',
            type: 'mcd_card',
            content,
            metadata: { mcdCardKind: 'candidate', mcdCandidate: item },
        } as any);
        await reloadMessages(visibleCountRef.current);
    }, [char, reloadMessages]);

    // 小程序内输入 → 直接保存 user 消息 + 立即触发 AI (主聊天 handleSendText 不自动触发,
    // 那是设计上的"手动 ⚡ 触发"流程, 但小程序里用户预期发完就有回复, 跳过那个步骤)。
    // 走完整 pipeline: useChatAI 在 build prompt 时会读 mcdMiniAppRef 注入小程序状态。
    const handleMcdMiniAppSend = useCallback(async (text: string) => {
        if (!char || !text.trim() || isTyping) return;
        const trimmed = text.trim();
        await DB.saveMessage({
            charId: char.id,
            role: 'user',
            type: 'text',
            content: trimmed,
            metadata: { fromMcdMiniApp: true },
        } as any);
        const recent = await DB.getRecentMessagesByCharId(char.id, 200);
        setMessages(recent);
        triggerAI(recent);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [char, isTyping, triggerAI]);

    // 小程序状态实时同步到 ref, 让下次 send 走主 pipeline 时能注入到 system prompt
    const handleMcdMiniAppStateChange = useCallback((state: import('../utils/mcdToolBridge').McdMiniAppSnapshot) => {
        mcdMiniAppRef.current = state;
    }, []);

    // 小程序里"敲定"购物车 → 把购物车转成 cart 卡 (复用现有渲染), 之后 Phase 2
    // 会在这里挂 calculate-price + create-order。当前先让 char 看到购物车评论。
    const handleMcdAppConfirm = useCallback(async (
        cart: import('../components/mcd/McdMiniApp').CartLine[],
        ctx: import('../components/mcd/McdMiniApp').OrderContext,
    ) => {
        if (!char || !cart.length) return;
        const items: import('../components/chat/McdCard').McdCartItem[] = cart.map(l => ({
            code: l.code,
            name: l.name,
            price: l.price,
            qty: l.qty,
        }));
        const summary = items.map(i => `${i.name}×${i.qty}`).join('、');
        const total = items.reduce((s, c) => {
            const p = typeof c.price === 'string' ? parseFloat(c.price) : (typeof c.price === 'number' ? c.price : 0);
            return s + (isFinite(p) ? p * c.qty : 0);
        }, 0);
        const totalStr = total > 0 ? ` 共¥${total.toFixed(2)}` : '';
        const where = ctx.orderType === 2
            ? `外送至 ${ctx.addressLabel || ctx.addressId}`
            : `到店取餐 (${ctx.storeName || ctx.storeCode})`;
        const content = `${where} · ${summary}${totalStr}`;
        await DB.saveMessage({
            charId: char.id,
            role: 'user',
            type: 'mcd_card',
            content,
            metadata: {
                mcdCardKind: 'cart',
                mcdCartItems: items,
                mcdOrderContext: ctx,
            },
        } as any);
        await reloadMessages(visibleCountRef.current);
    }, [char, reloadMessages]);

    // --- Schedule Handlers ---
    const loadSchedule = async () => {
        if (!char) return;
        if (!isScheduleFeatureOn(char)) { setScheduleData(null); return; }
        const today = new Date().toISOString().split('T')[0];
        const s = await DB.getDailySchedule(char.id, today);
        setScheduleData(s);
    };

    // Load schedule when modal opens
    React.useEffect(() => {
        if (modalType === 'schedule') loadSchedule();
    }, [modalType]);

    const handleScheduleEdit = async (index: number, slot: ScheduleSlot) => {
        if (!scheduleData) return;
        const newSlots = [...scheduleData.slots];
        newSlots[index] = slot;
        const updated = { ...scheduleData, slots: newSlots };
        setScheduleData(updated);
        await DB.saveDailySchedule(updated);
    };

    const handleScheduleDelete = async (index: number) => {
        if (!scheduleData) return;
        const newSlots = scheduleData.slots.filter((_, i) => i !== index);
        const updated = { ...scheduleData, slots: newSlots };
        setScheduleData(updated);
        await DB.saveDailySchedule(updated);
    };

    const handleScheduleCoverChange = async (dataUrl: string) => {
        if (!scheduleData) return;
        const updated = { ...scheduleData, coverImage: dataUrl };
        setScheduleData(updated);
        await DB.saveDailySchedule(updated);
    };

    const generateDailySchedule = async (targetChar: typeof char, forceRegenerate: boolean = false) => {
        if (!targetChar || isScheduleGenerating) return;
        setIsScheduleGenerating(true);
        try {
            const result = await generateDailyScheduleForChar(targetChar, userProfile, apiConfig, forceRegenerate);
            if (result) setScheduleData(result);
        } catch (e) {
            console.error('[Schedule] Generation error:', e);
        } finally {
            setIsScheduleGenerating(false);
        }
    };

    const handleScheduleStyleChange = async (style: 'lifestyle' | 'mindful') => {
        if (!char) return;
        // 与情绪/意识流强制同步：启用日程时自动启用情绪感知
        const prevEmotion = char.emotionConfig;
        const nextEmotion = { ...(prevEmotion || {}), enabled: true };
        updateCharacter(char.id, { scheduleStyle: style, emotionConfig: nextEmotion });
        // Force regenerate with new style — use updated char object
        const updatedChar = { ...char, scheduleStyle: style, emotionConfig: nextEmotion };
        if (!isScheduleFeatureOn(updatedChar)) return;
        setIsScheduleGenerating(true);
        try {
            const result = await generateDailyScheduleForChar(updatedChar, userProfile, apiConfig, true);
            if (result) setScheduleData(result);
        } catch (e) {
            console.error('[Schedule] Regeneration after style change failed:', e);
        } finally {
            setIsScheduleGenerating(false);
        }
    };

    // 日程 / 情绪 buff 总开关
    // 关闭：清空前台 scheduleData，同时清空可能已缓存的 buff 注入（防止继续污染下一轮 prompt）
    // 打开：若还没生成今日日程，立即生成一次
    const handleToggleScheduleFeature = async () => {
        if (!char) return;
        const nextEnabled = !isScheduleFeatureOn(char);
        const patch: any = { scheduleFeatureEnabled: nextEnabled };
        if (nextEnabled) {
            // 与 handleScheduleStyleChange 对齐：开日程 = 同步开情绪/意识流。
            // 旧逻辑下，新角色的 emotionConfig 从未初始化（undefined），
            // 仅切总开关而不点风格时，emotionConfig?.enabled 始终落 false，
            // 副 API 闸门 (isScheduleFeatureOn && emotionConfig?.enabled) 永远过不去。
            patch.emotionConfig = { ...(char.emotionConfig || {}), enabled: true };
        } else {
            // 关闭时顺手把 buff 注入清空，避免上一轮残留继续注入
            patch.buffInjection = '';
            patch.activeBuffs = [];
        }
        updateCharacter(char.id, patch);
        if (!nextEnabled) {
            setScheduleData(null);
            addToast('日程与情绪已关闭', 'info');
            return;
        }
        addToast('日程与情绪已开启', 'success');
        // 打开后立刻尝试生成（若今日未生成且已选风格）
        const updatedChar = { ...char, ...patch };
        if (updatedChar.scheduleStyle) {
            const today = new Date().toISOString().split('T')[0];
            const existing = await DB.getDailySchedule(char.id, today).catch(() => null);
            if (existing) {
                setScheduleData(existing);
            } else {
                generateDailySchedule(updatedChar, false);
            }
        }
    };

    // --- Modal Handlers ---

    const handleAddCategory = async () => {
        if (!newCategoryName.trim()) {
             addToast('先给这页贴纸起个名字吧', 'error');
             return;
        }
        const newCat = { id: `cat-${Date.now()}`, name: newCategoryName.trim() };
        await DB.saveEmojiCategory(newCat);
        await loadEmojiData();
        setActiveCategory(newCat.id);
        setModalType('none');
        setNewCategoryName('');
        addToast('新的一页建好了', 'success');
    };

    const handleImportEmoji = async () => {
        if (!emojiImportText.trim()) return;
        const lines = emojiImportText.split('\n');
        const targetCatId = activeCategory === 'default' ? undefined : activeCategory;

        for (const line of lines) {
            const parts = line.split('--');
            if (parts.length >= 2) {
                const name = parts[0].trim();
                // 第三段（如果最后一段不是 URL）当作描述：名字--URL--描述。
                // URL 自身可能含 "--"，所以从尾部判断：最后一段不以协议/data: 开头才算描述。
                let urlParts = parts.slice(1);
                let description = '';
                if (urlParts.length > 1) {
                    const last = urlParts[urlParts.length - 1].trim();
                    if (last && !/^(https?:|data:|\/\/)/i.test(last) && !/\.(png|jpe?g|gif|webp)$/i.test(last)) {
                        description = last;
                        urlParts = urlParts.slice(0, -1);
                    }
                }
                const url = urlParts.join('--').trim();
                if (name && url) {
                    await DB.saveEmoji(name, url, targetCatId, description || undefined);
                }
            }
        }
        await loadEmojiData();
        setModalType('none');
        setEmojiImportText('');
        addToast('贴纸收集好了', 'success');
    };

    const handleDeleteCategory = async () => {
        if (!selectedCategory) return;
        await DB.deleteEmojiCategory(selectedCategory.id);
        await loadEmojiData();
        setActiveCategory('default');
        setModalType('none');
        setSelectedCategory(null);
        addToast('这一页连同上面的贴纸都撕掉了', 'success');
    };

    const handleSaveCategoryVisibility = async (categoryId: string, allowedCharacterIds: string[] | undefined) => {
        const cat = categories.find(c => c.id === categoryId);
        if (!cat) return;
        await DB.saveEmojiCategory({ ...cat, allowedCharacterIds });
        await loadEmojiData();
        setSelectedCategory(null);
        addToast(allowedCharacterIds ? `已设置 ${allowedCharacterIds.length} 个角色可见` : '已设为所有角色可见', 'success');
    };

    const handleSavePrompt = () => {
        if (!editingPrompt || !editingPrompt.name.trim() || !editingPrompt.content.trim()) {
            addToast('请填写完整', 'error');
            return;
        }
        setArchivePrompts(prev => {
            let next;
            if (prev.some(p => p.id === editingPrompt.id)) {
                next = prev.map(p => p.id === editingPrompt.id ? editingPrompt : p);
            } else {
                next = [...prev, editingPrompt];
            }
            const customOnly = next.filter(p => !p.id.startsWith('preset_'));
            localStorage.setItem('chat_archive_prompts', JSON.stringify(customOnly));
            return next;
        });
        setSelectedPromptId(editingPrompt.id);
        setModalType('archive-settings');
        setEditingPrompt(null);
    };

    const handleDeletePrompt = (id: string) => {
        if (id.startsWith('preset_')) {
            addToast('默认预设不可删除', 'error');
            return;
        }
        setArchivePrompts(prev => {
            const next = prev.filter(p => p.id !== id);
            const customOnly = next.filter(p => !p.id.startsWith('preset_'));
            localStorage.setItem('chat_archive_prompts', JSON.stringify(customOnly));
            return next;
        });
        if (selectedPromptId === id) setSelectedPromptId('preset_rational');
        addToast('预设已删除', 'success');
    };

    const createNewPrompt = () => {
        setEditingPrompt({ id: `custom_${Date.now()}`, name: '新预设', content: DEFAULT_ARCHIVE_PROMPTS[0].content });
        setModalType('prompt-editor');
    };

    const editSelectedPrompt = () => {
        const p = archivePrompts.find(a => a.id === selectedPromptId);
        if (!p) return;
        if (p.id.startsWith('preset_')) {
            setEditingPrompt({ id: `custom_${Date.now()}`, name: `${p.name} (Copy)`, content: p.content });
        } else {
            setEditingPrompt({ ...p });
        }
        setModalType('prompt-editor');
    };

    const handleBgUpload = async (file: File) => {
        try {
            const dataUrl = await processImage(file, { skipCompression: true });
            updateCharacter(char.id, { chatBackground: dataUrl });
            addToast('聊天背景已更新', 'success');
        } catch(err: any) {
            addToast(err.message, 'error');
        }
    };

    const saveSettings = () => {
        updateCharacter(char.id, {
            contextLimit: settingsContextLimit,
            hideSystemLogs: settingsHideSysLogs,
            htmlModeCustomPrompt: settingsHtmlModeCustomPrompt,
        } as any);
        setModalType('none');
        addToast('设置已保存', 'success');
    };

    const handleClearHistory = async () => {
        if (!char) return;

        // 记忆宫殿安全检查：如果角色启用了记忆宫殿，检查是否有未被向量化处理的消息
        if (char.memoryPalaceEnabled) {
            const hwm = await getMemoryPalaceHWM(char.id);
            const allMessages = await DB.getMessagesByCharId(char.id, true);
            const textMessages = allMessages.filter(m => m.type === 'text' && m.content?.trim());
            const unprocessedCount = textMessages.filter(m => m.id > hwm).length;

            if (unprocessedCount > 0) {
                // 有未处理的消息，弹出选择对话框
                const processedMsgs = allMessages.filter(m => m.id <= hwm);
                const choice = confirm(
                    `⚠️ 回忆标本馆提醒\n\n` +
                    `当前有 ${unprocessedCount} 条聊天记录尚未被回忆标本馆处理（向量化）。\n` +
                    `直接清空会导致这些记录永久丢失，无法被角色记住。\n\n` +
                    `点击「确定」→ 仅删除已被回忆标本馆处理过的记录（安全）\n` +
                    `点击「取消」→ 取消清空操作\n\n` +
                    `（看不懂在问什么的话就点确定）`
                );

                if (!choice) {
                    return; // 用户取消
                }

                // 安全删除：只删除高水位之前的消息
                if (processedMsgs.length === 0) {
                    addToast('没有已处理的记录可以删除', 'info');
                    return;
                }
                const processedIds = processedMsgs.map(m => m.id);
                await DB.deleteMessages(processedIds);
                discardVoiceForMessages(processedIds);
                const remaining = allMessages.filter(m => m.id > hwm);
                setMessages(remaining.slice(-200));
                setTotalMsgCount(remaining.length);
                setVisibleCount(LOAD_BATCH_SIZE);
                visibleCountRef.current = LOAD_BATCH_SIZE;
                addToast(`已安全清理 ${processedMsgs.length} 条已处理记录，保留 ${remaining.length} 条未处理记录`, 'success');
                setModalType('none');
                return;
            }
        }

        // 原有逻辑（无记忆宫殿 or 所有消息已处理）
        if (preserveContext) {
            const allMessages = await DB.getMessagesByCharId(char.id, true);
            const toKeep = allMessages.slice(-10);
            const toKeepIds = new Set(toKeep.map(m => m.id));
            const toDelete = allMessages.filter(m => !toKeepIds.has(m.id));
            if (toDelete.length === 0) {
                addToast('消息太少，无需清理', 'info');
                return;
            }
            const toDeleteIds = toDelete.map(m => m.id);
            await DB.deleteMessages(toDeleteIds);
            discardVoiceForMessages(toDeleteIds);
            setMessages(toKeep);
            setTotalMsgCount(toKeep.length);
            setVisibleCount(LOAD_BATCH_SIZE);
            visibleCountRef.current = LOAD_BATCH_SIZE;
            addToast(`已清理 ${toDelete.length} 条历史，保留最近10条`, 'success');
        } else {
            const allIds = (await DB.getMessagesByCharId(char.id, true)).map(m => m.id);
            await DB.clearMessages(char.id);
            discardVoiceForMessages(allIds);
            setMessages([]);
            setTotalMsgCount(0);
            setVisibleCount(LOAD_BATCH_SIZE);
            visibleCountRef.current = LOAD_BATCH_SIZE;
            addToast('已清空', 'success');
        }
        setModalType('none');
    };

    const handleForceVectorize = async () => {
        if (!char || !char.memoryPalaceEnabled || isVectorizing) return;
        const mpEmb = memoryPalaceConfig?.embedding;
        const mpLLM = memoryPalaceConfig?.lightLLM;
        if (!mpEmb?.baseUrl || !mpEmb?.apiKey || !mpLLM?.baseUrl) {
            addToast('请先在回忆标本馆设置中配置 API', 'error');
            return;
        }

        setIsVectorizing(true);
        setModalType('none');
        addToast('🏰 开始向量化所有聊天记录...', 'info');

        try {
            const { processNewMessages, getMemoryPalaceHighWaterMark, mergePalaceFragmentsIntoMemories } = await import('../utils/memoryPalace/pipeline');
            const BATCH_PROCESS_RATIO = 0.85;
            const BATCH_SIZE = 170; // 200 * 0.85
            let totalProcessed = 0;
            let round = 0;
            const MAX_ROUNDS = 50; // 安全上限
            // 每轮合并进来的 palace MemoryFragment；全部处理完后一次性 updateCharacter
            let accumulatedMemories = char.memories ? [...char.memories] : [];
            let latestHideBefore = char.hideBeforeMessageId;

            while (round < MAX_ROUNDS) {
                round++;
                const hwm = getMemoryPalaceHighWaterMark(char.id);
                const allMessages = await DB.getMessagesByCharId(char.id, true);
                const textMessages = allMessages
                    .filter(m => m.type === 'text' && m.content?.trim())
                    .sort((a, b) => a.id - b.id);

                // 计算未处理的消息
                const unprocessed = textMessages.filter(m => m.id > hwm);
                if (unprocessed.length < 10) break; // 剩余太少，停止

                // 取一批处理
                const batch = unprocessed.slice(0, BATCH_SIZE);
                console.log(`🏰 [ForceVectorize] 第 ${round} 轮：处理 ${batch.length} 条消息（hwm=${hwm}，剩余 ${unprocessed.length}）`);

                const pipelineResult = await processNewMessages(batch, char.id, char.name, mpEmb, mpLLM, userProfile?.name || '', true);

                // 软跳过：缓冲区还没到阈值 / 热区还没被挤出 / 已有任务在跑 —— 不是 LLM 失败
                if (pipelineResult?.skipReason) {
                    if (pipelineResult.skipReason !== 'lock') {
                        addToast('当前聊天不足以触发总结，请保持这个状态聊天~', 'info');
                    }
                    break;
                }

                totalProcessed += batch.length;

                // 累积自动归档，统一在循环结束后 updateCharacter
                // 避免每轮 setState 触发 char 对象重建进而 dep 失效
                // 仅在 char.autoArchiveEnabled 开启时累积；未开启则 palace 仍向量化，但不推 hideBefore
                if (pipelineResult?.autoArchive && (char as any).autoArchiveEnabled) {
                    accumulatedMemories = mergePalaceFragmentsIntoMemories(
                        accumulatedMemories,
                        pipelineResult.autoArchive.fragments,
                    );
                    latestHideBefore = pipelineResult.autoArchive.hideBeforeMessageId;
                }

                // 检查高水位是否前进了（如果没前进说明 LLM 失败了）
                const newHwm = getMemoryPalaceHighWaterMark(char.id);
                if (newHwm <= hwm) {
                    addToast('⚠️ 处理中断：LLM 提取失败，请检查副 API 配置', 'error');
                    break;
                }
            }

            // 隐藏线追平到向量高水位：覆盖「关闭期推进了 hwm 但 hide 被冻结」的历史空档。
            // 只要全自动记忆开着，即便本轮没有新批次也把 hide 追平到 hwm（之前的消息都已向量化）。
            if ((char as any).autoArchiveEnabled) {
                const hwmFinal = getMemoryPalaceHighWaterMark(char.id);
                if (hwmFinal > (latestHideBefore || 0)) latestHideBefore = hwmFinal;
            }

            // 循环结束后把累积的自动归档一次性写回角色
            if (latestHideBefore !== char.hideBeforeMessageId || accumulatedMemories.length !== (char.memories?.length || 0)) {
                updateCharacter(char.id, {
                    memories: accumulatedMemories,
                    hideBeforeMessageId: latestHideBefore,
                } as any);
            }

            if (totalProcessed > 0) {
                addToast(`✅ 向量化完成：${round} 轮处理了约 ${totalProcessed} 条消息`, 'success');
            } else {
                addToast('所有聊天记录都已处理完毕，无需操作', 'info');
            }
        } catch (e: any) {
            addToast(`❌ 向量化失败：${e.message}`, 'error');
        } finally {
            setIsVectorizing(false);
        }
    };

    const handleSetHistoryStart = (messageId: number | undefined) => {
        updateCharacter(char.id, { hideBeforeMessageId: messageId });
        setModalType('none');
        addToast(messageId ? '已隐藏历史消息' : '已恢复全部历史记录', 'success');
    };

    // 跳转到旧消息：加载全量到 messages，再用 windowedFocusMsgId 把 displayMessages
    // 收窄到目标周围 51 条。"回到当前聊天"会把 visibleCount 重置回 30。
    const handleJumpToMessageInChat = async (messageId: number) => {
        if (!activeCharacterId) return;
        setModalType('none');
        const LARGE = 999999;
        visibleCountRef.current = LARGE;
        setVisibleCount(LARGE);
        await reloadMessages(LARGE);
        setWindowedFocusMsgId(messageId);
        setFlashMsgId(messageId);
        // 等下一帧让目标节点挂上 DOM 再滚
        requestAnimationFrame(() => {
            const el = document.getElementById(`chat-msg-${messageId}`);
            el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
        window.setTimeout(() => setFlashMsgId(null), 2200);
    };

    const handleBackToCurrent = async () => {
        setWindowedFocusMsgId(null);
        setFlashMsgId(null);
        visibleCountRef.current = 30;
        setVisibleCount(30);
        await reloadMessages(30);
        requestAnimationFrame(() => {
            scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
        });
    };

    const handleFullArchive = async () => {
        if (!apiConfig.apiKey || !char) {
            addToast('请先配置 API Key', 'error');
            return;
        }
        const allMessages = await DB.getMessagesByCharId(char.id, true);
        const msgsByDate: Record<string, Message[]> = {};
        allMessages
        .filter(m => !char.hideBeforeMessageId || m.id >= char.hideBeforeMessageId)
        .forEach(m => {
            const d = new Date(m.timestamp);
            const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            if (!msgsByDate[dateStr]) msgsByDate[dateStr] = [];
            msgsByDate[dateStr].push(m);
        });

        const datesToProcess = Object.keys(msgsByDate).sort();
        if (datesToProcess.length === 0) {
            addToast('聊天记录为空，无法归档', 'info');
            return;
        }

        setIsSummarizing(true);
        setShowPanel('none');
        setArchiveProgress(`准备归档 ${datesToProcess.length} 天...`);
        addToast(`开始归档 ${datesToProcess.length} 天聊天记录`, 'info');

        try {
            let processedCount = 0;
            const newMemories: MemoryFragment[] = [];
            const templateObj = archivePrompts.find(p => p.id === selectedPromptId) || DEFAULT_ARCHIVE_PROMPTS[0];
            const template = templateObj.content;

            for (let idx = 0; idx < datesToProcess.length; idx++) {
                const dateStr = datesToProcess[idx];
                setArchiveProgress(`归档中 ${dateStr} (${idx + 1}/${datesToProcess.length})`);
                const dayMsgs = msgsByDate[dateStr];
                const rawLog = dayMsgs
                    .map(m => formatMessageWithTime(m, char.name, userProfile.name, formatTime))
                    .join('\n');
                
                let prompt = template;
                prompt = prompt.replace(/\$\{dateStr\}/g, dateStr);
                prompt = prompt.replace(/\$\{char\.name\}/g, char.name);
                prompt = prompt.replace(/\$\{userProfile\.name\}/g, userProfile.name);
                prompt = prompt.replace(/\$\{rawLog.*?\}/g, rawLog.substring(0, 200000));

                const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
                    body: JSON.stringify({
                        model: apiConfig.model,
                        messages: [{ role: "user", content: prompt }],
                        temperature: 0.5,
                        max_tokens: 8000 
                    })
                });

                if (!response.ok) throw new Error(`API Error on ${dateStr}`);
                const data = await safeResponseJson(response);
                let summary = extractContent(data);
                summary = summary.replace(/^["']|["']$/g, '').trim();

                if (summary) {
                    newMemories.push({ id: `mem-${Date.now()}-${idx}`, date: dateStr, summary: summary, mood: 'archive' });
                    processedCount++;
                }
                await new Promise(r => setTimeout(r, 500));
            }

            const total = datesToProcess.length;

            if (processedCount === 0) {
                addToast(`归档失败：${total} 天均未生成摘要（请检查 API/模型）`, 'error');
                setModalType('none');
            } else {
                const finalMemories = [...(char.memories || []), ...newMemories];

                // 关键修复：全量归档成功后把 hideBeforeMessageId 推到"倒数第 reserve 条"的位置。
                // 不推的话下次再点归档，hideBefore 过滤没作用，之前已归档的几天会被重总结一遍，
                // 往 char.memories 里堆重复条目。保留最近 max(100, 15%) 条不隐藏（和 palace
                // auto-archive 的 hot-zone 概念对齐），这样聊天 UI 不会突然空掉。
                //
                // 部分失败时不推 hideBefore —— 那几天的原消息没写进 MemoryFragment，推了
                // 就真的读不到了。用户下次重试归档会把失败的那几天补上。
                let newHideBefore = char.hideBeforeMessageId;
                let reservedCount = 0;
                let hiddenCount = 0;
                if (processedCount === total) {
                    const allArchivedMsgs: Message[] = [];
                    for (const d of datesToProcess) allArchivedMsgs.push(...msgsByDate[d]);
                    allArchivedMsgs.sort((a, b) => a.id - b.id);
                    const RESERVE = Math.max(100, Math.ceil(allArchivedMsgs.length * 0.15));
                    if (allArchivedMsgs.length > RESERVE) {
                        const candidate = allArchivedMsgs[allArchivedMsgs.length - RESERVE].id;
                        // 只前进不后退
                        if (!char.hideBeforeMessageId || candidate > char.hideBeforeMessageId) {
                            newHideBefore = candidate;
                            reservedCount = RESERVE;
                            hiddenCount = allArchivedMsgs.length - RESERVE;
                        }
                    }
                }

                const updates: Partial<typeof char> = { memories: finalMemories };
                if (newHideBefore !== char.hideBeforeMessageId) {
                    (updates as any).hideBeforeMessageId = newHideBefore;
                }
                updateCharacter(char.id, updates as any);

                const hideStr = hiddenCount > 0
                    ? `（已隐藏 ${hiddenCount} 条旧消息，保留最近 ${reservedCount} 条可见）`
                    : '';
                if (processedCount < total) {
                    addToast(`归档完成：${processedCount}/${total} 天成功（部分失败，下次再点会补上）`, 'info');
                } else {
                    addToast(`归档完成：成功归档 ${processedCount} 天${hideStr}`, 'success');
                }
                setModalType('none');
            }

        } catch (e: any) {
            addToast(`归档中断: ${e.message}`, 'error');
        } finally {
            setIsSummarizing(false);
            setArchiveProgress('');
        }
    };

    // --- Message Management ---
    const handleDeleteMessage = async () => {
        if (!selectedMessage) return;
        const deletedId = selectedMessage.id;
        await DB.deleteMessage(deletedId);
        discardVoiceForMessages([deletedId]);
        setMessages(prev => prev.filter(m => m.id !== deletedId));
        setTotalMsgCount(prev => Math.max(0, prev - 1));
        setModalType('none');
        setSelectedMessage(null);
        addToast('消息已删除', 'success');
    };

    const confirmEditMessage = async () => {
        if (!selectedMessage) return;
        await DB.updateMessage(selectedMessage.id, editContent);
        setMessages(prev => prev.map(m => m.id === selectedMessage.id ? { ...m, content: editContent } : m));
        setModalType('none');
        setSelectedMessage(null);
        addToast('消息已修改', 'success');
    };

    const handleReplyMessage = () => {
        if (!selectedMessage) return;
        setReplyTarget({
            ...selectedMessage,
            metadata: { ...selectedMessage.metadata, senderName: selectedMessage.role === 'user' ? '我' : char.name }
        });
        setModalType('none');
    };

    // 左滑气泡触发引用：直接拿到该条消息设为回复目标（与长按菜单的「引用/回复」同效）
    const handleSwipeReply = useCallback((msg: Message) => {
        setReplyTarget({
            ...msg,
            metadata: { ...msg.metadata, senderName: msg.role === 'user' ? '我' : char.name }
        });
    }, [char.name]);

    const handleCopyMessage = () => {
        if (!selectedMessage) return;
        navigator.clipboard.writeText(selectedMessage.content);
        setModalType('none');
        setSelectedMessage(null);
        addToast('已复制到剪贴板', 'success');
    };

    const handleDeleteEmoji = async () => {
        if (!selectedEmoji) return;
        const emojisToDelete = Array.isArray(selectedEmoji) ? selectedEmoji : [selectedEmoji];
        try {
            await Promise.all(emojisToDelete.map(emoji => DB.deleteEmoji(emoji.name)));
            addToast(Array.isArray(selectedEmoji) ? `撕下了 ${selectedEmoji.length} 张贴纸` : '贴纸撕下来了', 'success');
        } catch (err) {
            console.error('Failed to delete emojis:', err);
            addToast('贴纸没撕下来，再试一次', 'error');
        } finally {
            await loadEmojiData();
            setModalType('none');
            setSelectedEmoji(null);
        }
    };

    // --- Batch Selection ---
    const handleEnterSelectionMode = () => {
        if (selectedMessage) {
            setSelectedMsgIds(new Set([selectedMessage.id]));
            setSelectionMode(true);
            setModalType('none');
            setSelectedMessage(null);
        }
    };

    const toggleMessageSelection = useCallback((id: number) => {
        setSelectedMsgIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    const toggleThinkingSelection = useCallback((id: number) => {
        setSelectedThinkingMsgIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    // Memoized callbacks for MessageItem to avoid busting React.memo
    const handleMessageLongPress = useCallback((msg: Message) => {
        setSelectedMessage(msg);
        setModalType('message-options');
    }, []);

    const handleBatchDelete = async () => {
        const msgIdsToDelete = new Set<number>(selectedMsgIds);
        // 思维链单独勾选、但宿主消息没选 -> 只清 metadata.thinkingChain，保留消息
        const thinkingIdsToClear = new Set<number>();
        selectedThinkingMsgIds.forEach(id => {
            if (!msgIdsToDelete.has(id)) thinkingIdsToClear.add(id);
        });
        if (msgIdsToDelete.size === 0 && thinkingIdsToClear.size === 0) return;

        // 删消息时，如果它身上的思维链没被勾选，就尝试迁移到同一轮里下一条 assistant 消息上，
        // 让"只想删第一条输出，但想留思维链"成立
        const sorted = [...messages].sort((a, b) => a.id - b.id);
        const idxById = new Map<number, number>();
        sorted.forEach((m, i) => idxById.set(m.id, i));
        const migrations: { targetId: number; chain: string }[] = [];
        msgIdsToDelete.forEach(id => {
            const msg = messages.find(x => x.id === id);
            const chain = msg?.metadata?.thinkingChain;
            if (!msg || !chain) return;
            if (selectedThinkingMsgIds.has(id)) return; // 用户主动连思维链一起删
            const startIdx = idxById.get(id);
            if (startIdx == null) return;
            for (let i = startIdx + 1; i < sorted.length; i++) {
                const next = sorted[i];
                if (next.role !== 'assistant') break; // 出了这一轮，没法挂靠了
                if (msgIdsToDelete.has(next.id)) continue;
                migrations.push({ targetId: next.id, chain: String(chain) });
                break;
            }
        });

        for (const mig of migrations) {
            await DB.updateMessageMetadata(mig.targetId, (prev) => ({ ...(prev || {}), thinkingChain: mig.chain }));
        }
        for (const id of thinkingIdsToClear) {
            await DB.updateMessageMetadata(id, (prev) => {
                if (!prev || !('thinkingChain' in prev)) return prev;
                const { thinkingChain, ...rest } = prev;
                return rest;
            });
        }
        const ids = Array.from(msgIdsToDelete);
        if (ids.length > 0) {
            await DB.deleteMessages(ids);
            discardVoiceForMessages(ids);
        }

        const migMap = new Map(migrations.map(m => [m.targetId, m.chain]));
        setMessages(prev => prev
            .filter(m => !msgIdsToDelete.has(m.id))
            .map(m => {
                if (migMap.has(m.id)) {
                    return { ...m, metadata: { ...(m.metadata || {}), thinkingChain: migMap.get(m.id) } };
                }
                if (thinkingIdsToClear.has(m.id) && m.metadata?.thinkingChain) {
                    const { thinkingChain, ...rest } = m.metadata;
                    return { ...m, metadata: rest };
                }
                return m;
            })
        );
        setTotalMsgCount(prev => Math.max(0, prev - msgIdsToDelete.size));

        const parts: string[] = [];
        if (msgIdsToDelete.size > 0) parts.push(`已删除 ${msgIdsToDelete.size} 条消息`);
        if (thinkingIdsToClear.size > 0) parts.push(`已清除 ${thinkingIdsToClear.size} 条思维链`);
        addToast(parts.join('，'), 'success');

        setSelectionMode(false);
        setSelectedMsgIds(new Set());
        setSelectedThinkingMsgIds(new Set());
    };

    // --- Forward Chat Records ---
    const [showForwardModal, setShowForwardModal] = useState(false);

    const handleForwardSelected = () => {
        if (selectedMsgIds.size === 0) return;
        setShowForwardModal(true);
    };

    const handleForwardToCharacter = async (targetCharId: string) => {
        if (!char) return;
        const selectedMsgs = messages
            .filter(m => selectedMsgIds.has(m.id))
            .sort((a, b) => a.id - b.id);

        if (selectedMsgs.length === 0) return;

        // Build preview text (first few messages)
        const previewLines = selectedMsgs.slice(0, 4).map(m => {
            const sender = m.role === 'user' ? userProfile.name : char.name;
            const text = m.type === 'text' ? m.content.slice(0, 30) : `[${m.type === 'image' ? '图片' : m.type === 'emoji' ? '表情' : m.type}]`;
            return `${sender}: ${text}`;
        });
        if (selectedMsgs.length > 4) previewLines.push(`... 共 ${selectedMsgs.length} 条消息`);

        const forwardData = {
            fromUserName: userProfile.name,
            fromCharName: char.name,
            count: selectedMsgs.length,
            preview: previewLines,
            messages: selectedMsgs.map(m => ({
                role: m.role,
                type: m.type,
                content: m.content,
                timestamp: m.timestamp || Date.now()
            }))
        };

        // Save forward card to target character's chat
        await DB.saveMessage({
            charId: targetCharId,
            role: 'user',
            type: 'chat_forward' as MessageType,
            content: JSON.stringify(forwardData),
        });

        // Also save a copy in the current chat so the user can see what they forwarded
        const targetChar = characters.find(c => c.id === targetCharId);
        if (char.id !== targetCharId) {
            await DB.saveMessage({
                charId: char.id,
                role: 'system',
                type: 'text' as MessageType,
                content: `[转发了 ${selectedMsgs.length} 条聊天记录给 ${targetChar?.name || ''}]`,
            });
            // Refresh messages to show the forwarding system message
            reloadMessages(visibleCountRef.current);
        }

        addToast(`已转发 ${selectedMsgs.length} 条记录给 ${targetChar?.name || ''}`, 'success');
        setShowForwardModal(false);
        setSelectionMode(false);
        setSelectedMsgIds(new Set());
    };

    // hideBeforeMessageId 不在视觉层过滤：用户依旧能往上翻到旧消息，只是 LLM 拉不到。
    // 真正想从聊天记录里抹掉，应该走"删除"。
    // windowed 模式：定位到旧消息时只渲染目标周围 51 条，避免 DOM 卡爆。
    const displayMessages = useMemo(() => {
        // 正则脚本显示层（markdownOnly）：只改气泡渲染内容，不改写消息原文。
        // 在传给 MessageItem 之前替换 content，memo 比较 msg.content 即可正确失效。
        // depth 同 ST 语义（0 = 最后一条），让 minDepth/maxDepth 的显示层脚本按深度生效。
        const withDisplayRegex = (list: Message[]): Message[] => list.map((m, idx) => {
            if (m.type !== 'text' || m.role === 'system' || typeof m.content !== 'string' || !m.content) return m;
            const placement = m.role === 'user' ? regex_placement.USER_INPUT : regex_placement.AI_OUTPUT;
            const out = applyRegexToText(m.content, placement, {
                char, userName: userProfile?.name, isMarkdown: true, depth: list.length - 1 - idx,
            });
            return out === m.content ? m : { ...m, content: out };
        });
        const base = messages
            .filter(m => m.metadata?.source !== 'date' && m.metadata?.source !== 'call')
            .filter(m => !m.metadata?.proactiveHint)
            .filter(m => { if (char?.hideSystemLogs && m.role === 'system' && m.type !== 'score_card' && !m.metadata?.systemCommand) return false; return true; });
        if (windowedFocusMsgId !== null) {
            const idx = base.findIndex(m => m.id === windowedFocusMsgId);
            if (idx >= 0) {
                const start = Math.max(0, idx - WINDOW_RADIUS);
                const end = Math.min(base.length, idx + WINDOW_RADIUS + 1);
                return withDisplayRegex(base.slice(start, end));
            }
        }
        return withDisplayRegex(base.slice(-visibleCount));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [messages, char?.id, char?.hideSystemLogs, char?.regexScripts, visibleCount, windowedFocusMsgId, regexVersion]);

    const collapsedCount = Math.max(0, totalMsgCount - displayMessages.length);

    // 稳定的思维链配置对象：只在角色/样式变化时重建，避免每次渲染新建对象击穿 MessageItem.memo。
    const thinkingChainOptions = useMemo(() => ({
        styleId: (char as any)?.thinkingChainStyle || 'echo',
        customColors: (char as any)?.thinkingChainCustomColors,
        onOpenSettings: () => setShowThinkingChainModal(true),
    }), [(char as any)?.thinkingChainStyle, (char as any)?.thinkingChainCustomColors]);

    // Reset active category if it becomes invisible for the current character
    useEffect(() => {
        if (activeCategory !== 'default' && visibleCategories.length > 0 && !visibleCategories.some(c => c.id === activeCategory)) {
            setActiveCategory('default');
        }
    }, [visibleCategories, activeCategory]);

    // Build a set of hidden category IDs for quick lookup
    const hiddenCategoryIds = useMemo(() => {
        const visible = new Set(visibleCategories.map(c => c.id));
        return new Set(categories.filter(c => !visible.has(c.id)).map(c => c.id));
    }, [categories, visibleCategories]);

    // Memoize filtered emojis for ChatInputArea
    const filteredEmojis = useMemo(() => emojis.filter(e => {
        // Exclude emojis from hidden categories
        if (e.categoryId && hiddenCategoryIds.has(e.categoryId)) return false;
        if (activeCategory === 'default') return !e.categoryId || e.categoryId === 'default';
        return e.categoryId === activeCategory;
    }), [emojis, activeCategory, hiddenCategoryIds]);

    // 全量可见表情（只排除隐藏分类，不按当前分类切）——表情面板搜索时跨分类匹配
    const allVisibleEmojis = useMemo(() => emojis.filter(e => !(e.categoryId && hiddenCategoryIds.has(e.categoryId))), [emojis, hiddenCategoryIds]);

    // Memoize ChatInputArea callbacks
    const handleSendCallback = useCallback(() => handleSendText(), [char, input, replyTarget]);

    // ── 会话设置（聊天设置面板）派生值：备注名 / 头像覆盖 / 时间戳等 ──
    const convo = char?.convoSettings;
    const displayCharName = convo?.remarkName?.trim() || char?.name || '';
    const displayCharAvatar = convo?.charAvatarOverride || char?.avatar || '';
    const displayUserAvatar = convo?.userAvatarOverride || userProfile.avatar;
    const headerChar = useMemo(
        () => (char && (displayCharName !== char.name || displayCharAvatar !== char.avatar))
            ? { ...char, name: displayCharName, avatar: displayCharAvatar }
            : char,
        [char, displayCharName, displayCharAvatar]
    );
    // 表情分类条数统计（会话设置「表情分类总览」用）
    const emojiCounts = useMemo(() => {
        const counts: Record<string, number> = {};
        for (const e of emojis) {
            const k = e.categoryId || 'default';
            counts[k] = (counts[k] || 0) + 1;
        }
        return counts;
    }, [emojis]);

    // 导出聊天记录（会话设置 06 数据）
    const handleExportChat = () => {
        if (!char) return;
        try {
            const source = (allHistoryMessages && allHistoryMessages.length > 0) ? allHistoryMessages : messages;
            const data = {
                type: 'moro_chat_export',
                character: { id: char.id, name: char.name },
                exportedAt: new Date().toISOString(),
                count: source.length,
                messages: source,
            };
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `moro_chat_${char.name}_${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 5000);
            addToast('聊天记录已导出', 'success');
        } catch {
            addToast('导出失败', 'error');
        }
    };
    // 兜底：正常情况下 OSContext 启动时一定会保底一个角色，char 不该为空。
    // 但若 init 期间某个 store 读取失败（数据其实还在 IndexedDB 里），characters 可能暂时为空，
    // 此时下面 char.chatBackground 会直接抛 "undefined is not an object" 把整个 App 崩到错误页。
    // 这里给个温和空态，避免硬崩，也好让用户能退回桌面/重启恢复。
    if (!char) {
        return (
            <div className="flex flex-col items-center justify-center h-full bg-[#f1f5f9] text-center px-8 gap-3">
                <div className="text-4xl">💤</div>
                <div className="text-slate-600 text-sm font-medium">暂时没有可用的角色</div>
                <div className="text-slate-400 text-xs leading-relaxed">数据可能未加载完成。请退回桌面后重新进入；若仍为空，重启应用即可恢复。</div>
                <button onClick={closeApp} className="mt-2 px-4 py-2 rounded-full bg-slate-800 text-white text-xs">返回桌面</button>
            </div>
        );
    }

    const chatChromeStyle = osTheme.chatChromeStyle || 'soft';
    const chatBackgroundStyle = osTheme.chatBackgroundStyle || 'plain';
    const chatRootClass =
        chatChromeStyle === 'pixel'
            ? 'flex flex-col h-full bg-[#efe1cf] overflow-hidden relative font-sans transition-[background-image,background-color] duration-500'
            : chatChromeStyle === 'flat'
              ? 'flex flex-col h-full bg-white overflow-hidden relative font-sans transition-[background-image,background-color] duration-500'
              : chatChromeStyle === 'floating'
                ? 'flex flex-col h-full bg-[#eef2ff] overflow-hidden relative font-sans transition-[background-image,background-color] duration-500'
                : 'flex flex-col h-full bg-[#fafafa] overflow-hidden relative font-sans transition-[background-image,background-color] duration-500';
    const chatRootStyle: React.CSSProperties = char.chatBackground
        ? {
            backgroundImage: `url(${char.chatBackground})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
        }
        : chatBackgroundStyle === 'grid'
          ? {
              backgroundColor: chatChromeStyle === 'pixel' ? '#efe1cf' : '#f8fafc',
              backgroundImage:
                  'linear-gradient(rgba(148,163,184,0.14) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.14) 1px, transparent 1px)',
              backgroundSize: '20px 20px',
            }
          : chatBackgroundStyle === 'paper'
            ? {
                backgroundColor: chatChromeStyle === 'pixel' ? '#f4e8d9' : '#f9f7f2',
                backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(148,163,184,0.12) 1px, transparent 0)',
                backgroundSize: '16px 16px',
              }
            : chatBackgroundStyle === 'mesh'
              ? {
                  backgroundColor: '#f8fafc',
                  backgroundImage:
                      'radial-gradient(circle at 15% 20%, rgba(59,130,246,0.18), transparent 28%), radial-gradient(circle at 85% 15%, rgba(244,114,182,0.18), transparent 24%), radial-gradient(circle at 60% 75%, rgba(45,212,191,0.18), transparent 26%)',
                }
              : {
                  backgroundImage: 'none',
                };
    // 进入/切换的过场由 CharacterEntryTransition 覆盖层负责，根容器不再自己做淡入。
    const finalRootClass = chatRootClass;
    const finalRootStyle = chatRootStyle;
    const chatAvatarSizeClass = osTheme.chatAvatarSize === 'small' ? 'w-7 h-7' : osTheme.chatAvatarSize === 'large' ? 'w-12 h-12' : 'w-9 h-9';
    const chatAvatarRadiusClass = osTheme.chatAvatarShape === 'square' ? 'rounded-sm' : osTheme.chatAvatarShape === 'rounded' ? 'rounded-xl' : 'rounded-full';
    const chatPendingAvatarClass = `${chatAvatarSizeClass} ${chatAvatarRadiusClass} object-cover`;

    return (
        <div
            className={`moro-chat-root ${finalRootClass}`}
            style={finalRootStyle}
        >
             {/* 白框自定义 CSS：全局默认在前、角色专属在后（后者叠加覆盖）。作用于 .moro-chat-* 各零件。 */}
             {osTheme.chatChromeCustomCss && <style>{osTheme.chatChromeCustomCss}</style>}
             {char.chromeCustomCss && <style>{char.chromeCustomCss}</style>}
             {/* 会话设置「背景图」：顶栏背景 / 底部输入栏背景，走 .moro-chat-* 白框钩子注入 */}
             {(convo?.headerBgImage || convo?.inputBarImage) && (
               <style>{[
                   convo?.headerBgImage ? `.moro-chat-header{background-image:url(${convo.headerBgImage}) !important;background-size:cover !important;background-position:center !important;}` : '',
                   convo?.inputBarImage ? `.moro-chat-inputbar{background-image:url(${convo.inputBarImage}) !important;background-size:cover !important;background-position:center !important;}` : '',
               ].filter(Boolean).join('\n')}</style>
             )}
             {/* 守护样式（注在用户 CSS 之后）：保证返回键永远可见可点 —— 防止坏 CSS 把它隐藏/变透明/拦截点击，
                 让用户在样式写崩时仍能退出聊天（再去「外观→聊天界面→一键还原」清掉坏 CSS）。不锁位置，正常挪位仍可用。 */}
             {(osTheme.chatChromeCustomCss || char.chromeCustomCss) && (
               <style>{`.moro-chat-back{visibility:visible!important;opacity:1!important;pointer-events:auto!important;}`}</style>
             )}
             {/* 角色「登场」过场：切换/进入时以 ta 的头像氛围铺底登场，再推进穿过进入聊天。key 切换即重放。 */}
             {showEntry && char && (
               <CharacterEntryTransition
                 key={activeCharacterId}
                 name={displayCharName}
                 avatar={displayCharAvatar}
                 onDone={() => setShowEntry(false)}
               />
             )}

             {activeTheme.customCss && <style>{activeTheme.customCss}</style>}


             {/* 记忆整理中 — 顶部浮动胶囊（不阻塞交互，轻量无 backdrop-filter） */}
             {memoryPalaceStatus && (
                 <div
                     className="absolute top-[76px] left-1/2 z-[150] animate-fade-in"
                     style={{
                         transform: 'translateX(-50%)',
                         pointerEvents: 'none',
                         willChange: 'transform, opacity',
                     }}
                 >
                     <div
                         className="flex items-center gap-2.5 pl-2.5 pr-3.5 py-2 max-w-[18rem]"
                         style={{
                             background: 'rgba(255,255,255,0.88)',
                             borderRadius: 999,
                             border: '1px solid rgba(99,102,241,0.18)',
                             boxShadow: '0 6px 18px -6px rgba(15,23,42,0.22)',
                         }}
                     >
                         <span
                             className="shrink-0 inline-block w-3.5 h-3.5 rounded-full border-2 border-slate-200 animate-spin"
                             style={{ borderTopColor: '#6366f1', animationDuration: '0.9s' }}
                         />
                         <span className="text-[11px] font-semibold text-slate-700 whitespace-nowrap">
                             {char?.name || '角色'}正在沉思
                         </span>
                         <span className="text-[10px] text-slate-400 truncate">{memoryPalaceStatus}</span>
                     </div>
                 </div>
             )}


             {/* 记忆整理结果 — 弹窗（高级感） */}
             {memoryPalaceResult && (
                 <div
                     className="absolute inset-0 z-[200] flex items-center justify-center p-4 animate-fade-in"
                     style={{
                         pointerEvents: 'all',
                         background: 'rgba(15,23,42,0.55)',
                     }}
                     onClick={() => setMemoryPalaceResult(null)}
                 >
                     <div
                         className="w-full max-w-sm max-h-[82vh] overflow-hidden flex flex-col relative"
                         style={{
                             background: 'linear-gradient(160deg, #ffffff 0%, #f8fafc 100%)',
                             borderRadius: 28,
                             border: '1px solid rgba(148,163,184,0.18)',
                             boxShadow: '0 20px 50px -20px rgba(15,23,42,0.35)',
                         }}
                         onClick={(e) => e.stopPropagation()}
                     >
                         <div
                             className="absolute top-0 left-0 right-0 h-[2px] pointer-events-none"
                             style={{ background: 'linear-gradient(90deg, transparent, #6366f1, #a5b4fc, #6366f1, transparent)' }}
                         />
                         <div className="px-6 pt-7 pb-4 text-center">
                             <div
                                 className="w-14 h-14 mx-auto rounded-2xl flex items-center justify-center mb-3"
                                 style={{
                                     background: 'linear-gradient(135deg, rgba(99,102,241,0.12), rgba(129,140,248,0.06))',
                                     border: '1px solid rgba(99,102,241,0.15)',
                                 }}
                             >
                                 <span style={{ fontSize: 26 }}>🗂️</span>
                             </div>
                             <div className="text-[10px] tracking-[0.25em] uppercase font-semibold" style={{ color: '#6366f1' }}>Memory Palace</div>
                             <p className="text-[17px] font-bold mt-1" style={{ color: '#0f172a' }}>记忆整理完成</p>
                             <p className="text-[11px] text-slate-400 mt-1">
                                 新增 {memoryPalaceResult.stored} 条 · 去重跳过 {memoryPalaceResult.skipped} 条
                                 {memoryPalaceResult.batches.length > 1 && ` · ${memoryPalaceResult.batches.length} 批`}
                             </p>
                             {memoryPalaceResult.batches.some(b => !b.ok) && (
                                 <p className="text-[10px] text-red-500 mt-1">
                                     {memoryPalaceResult.batches.filter(b => !b.ok).map(b => `batch ${b.index} 失败`).join(', ')}
                                 </p>
                             )}
                         </div>
                         <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-2 no-scrollbar">
                             {memoryPalaceResult.memories.map((m, i) => {
                                 const roomMeta: Record<string, { label: string; color: string }> = {
                                     living_room: { label: '客厅', color: '#f59e0b' },
                                     bedroom: { label: '卧室', color: '#8b5cf6' },
                                     study: { label: '书房', color: '#0ea5e9' },
                                     user_room: { label: '用户房间', color: '#ec4899' },
                                     self_room: { label: '自我房间', color: '#10b981' },
                                     attic: { label: '阁楼', color: '#6366f1' },
                                     windowsill: { label: '窗台', color: '#14b8a6' },
                                 };
                                 const meta = roomMeta[m.room] || { label: m.room, color: '#64748b' };
                                 return (
                                     <div
                                         key={i}
                                         className="p-3 rounded-2xl"
                                         style={{
                                             background: 'rgba(255,255,255,0.75)',
                                             border: `1px solid ${meta.color}22`,
                                             boxShadow: `0 2px 8px ${meta.color}14, inset 0 1px 0 rgba(255,255,255,0.8)`,
                                         }}
                                     >
                                         <div className="flex items-center gap-2 mb-1.5">
                                             <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                                                 style={{ background: `${meta.color}18`, color: meta.color }}
                                             >
                                                 {meta.label}
                                             </span>
                                             <span className="text-[10px] text-slate-400">{m.mood}</span>
                                             <span className="text-[10px] font-bold ml-auto" style={{ color: '#f59e0b' }}>{'★'.repeat(Math.min(m.importance, 5))}</span>
                                         </div>
                                         <p className="text-[12px] text-slate-700 leading-relaxed">{m.content}</p>
                                         {m.tags.length > 0 && (
                                             <div className="flex gap-1 mt-2 flex-wrap">
                                                 {m.tags.map((t, j) => (
                                                     <span key={j} className="text-[9px] px-1.5 py-0.5 rounded-full"
                                                         style={{ background: 'rgba(148,163,184,0.15)', color: '#64748b' }}
                                                     >{t}</span>
                                                 ))}
                                             </div>
                                         )}
                                     </div>
                                 );
                             })}
                             {memoryPalaceResult.memories.length === 0 && (
                                 <p className="text-center text-xs text-slate-400 py-4">本次未提取到新记忆</p>
                             )}
                         </div>
                         <div className="px-6 pb-6 pt-2">
                             <button
                                 onClick={() => setMemoryPalaceResult(null)}
                                 className="w-full py-3 text-white text-[13px] font-bold rounded-2xl active:scale-[0.98] transition-transform"
                                 style={{
                                     background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
                                     boxShadow: '0 6px 18px -6px rgba(79,70,229,0.5)',
                                 }}
                             >
                                 确认
                             </button>
                         </div>
                     </div>
                 </div>
             )}

             {/* 语音通话拨号中覆盖层：呼叫 → 角色决策 → 接通跳电话 App / 未接听 */}
             {voiceCallPhase !== 'none' && char && (
                <div
                    className="fixed inset-0 z-[120] flex flex-col items-center justify-center animate-fade-in"
                    style={{
                        backgroundColor: '#fbf2ee',
                        backgroundImage: 'radial-gradient(rgba(242,157,176,0.2) 1.2px, transparent 1.2px)',
                        backgroundSize: '18px 18px',
                    }}
                >
                    <div className="text-[9px] font-bold tracking-[0.4em] uppercase mb-8 select-none" style={{ ...MONO_STACK, color: voiceCallPhase === 'dialing' ? '#d18ba0' : '#b3a3ad' }}>
                        {voiceCallPhase === 'dialing' ? '☎ Calling — Hold On' : '☎ No Answer Today'}
                    </div>
                    <div className="relative mb-7" style={{ transform: 'rotate(-2deg)' }}>
                        {voiceCallPhase === 'dialing' && (
                            <>
                                <span className="absolute -inset-3 rounded-[10px] border-2 border-dashed animate-ping" style={{ borderColor: 'rgba(242,157,176,0.55)' }} />
                                <span className="absolute -inset-6 rounded-[12px] border border-dashed animate-ping" style={{ borderColor: 'rgba(242,157,176,0.35)', animationDelay: '0.4s' }} />
                                <span className="absolute -inset-9 rounded-[14px] border border-dashed animate-ping" style={{ borderColor: 'rgba(242,157,176,0.18)', animationDelay: '0.8s' }} />
                            </>
                        )}
                        {/* 拍立得相框：TA 的照片别在画面正中 */}
                        <div className="relative bg-white p-2 pb-7 rounded-[4px]" style={{ boxShadow: '0 4px 14px rgba(122,90,114,0.3)' }}>
                            <span aria-hidden className="absolute -top-2 left-1/2 -translate-x-1/2 w-12 h-4 pointer-events-none" style={{ background: 'rgba(251,184,200,0.75)', transform: 'rotate(-3deg)', clipPath: 'polygon(3% 0, 100% 8%, 97% 100%, 0 92%)' }} />
                            <img src={char.avatar} className="relative w-24 h-24 object-cover" alt={char.name} />
                            <span className="absolute bottom-1.5 left-0 right-0 text-center text-[9px] select-none" style={{ ...MONO_STACK, color: '#a892a3' }}>
                                {voiceCallPhase === 'dialing' ? 'ring ring…' : 'missed'}
                            </span>
                        </div>
                    </div>
                    <div className="text-xl font-bold mb-1.5" style={{ ...SERIF_STACK, color: '#3d2f3d' }}>{char.name}</div>
                    <div className="text-[13px] mb-12" style={{ color: '#7a5a72' }}>
                        {voiceCallPhase === 'dialing' ? '铃声已经响过去了，等 TA 把听筒拿起来…' : '这回 TA 没接到，晚点再拨一次吧'}
                    </div>
                    {voiceCallPhase === 'dialing' && (
                        <button
                            onClick={() => { void cancelVoiceCall(); }}
                            className="w-16 h-16 rounded-full flex items-center justify-center active:translate-y-[2px] active:shadow-none transition-all"
                            style={{ background: '#e26b84', color: '#fff', border: '1.5px solid #c14a64', boxShadow: '2px 3px 0 #f3c1cd' }}
                            aria-label="挂断这通呼叫"
                        >
                            <PhoneSlash className="w-7 h-7" weight="fill" />
                        </button>
                    )}
                </div>
             )}

             {/* 系统命令 Modal：用户以系统身份下达最高优先级指令 */}
             <JournalSheet
                open={showSystemCmdModal} title="红笔批注" en="Director's Red Pen" sub="在剧本页边写一句不容商量的话"
                tape="lavender" pattern="plain" paper="lined"
                onClose={() => setShowSystemCmdModal(false)}
                footer={<>
                    <SealBtn kind="ghost" onClick={() => setShowSystemCmdModal(false)}>先收笔</SealBtn>
                    <SealBtn kind="ink" onClick={() => { void handleSendSystemCommand(); }} disabled={!systemCmdInput.trim()}>落笔生效</SealBtn>
                </>}
             >
                <div className="space-y-3">
                    {/* 批注纸：左缘一道红线，像批改作业的页边 */}
                    <div className="relative rounded-[8px] pl-9 pr-3 py-3" style={{ background: '#fffdfa', border: '1px dashed #dcc3cf' }}>
                        <span aria-hidden className="absolute left-6 top-2 bottom-2 w-[1.5px]" style={{ background: 'rgba(226,107,132,0.55)' }} />
                        <div className="flex items-center gap-1.5 mb-1.5">
                            <span aria-hidden className="text-[10px] leading-none" style={{ color: '#e26b84' }}>✦</span>
                            <span className="text-[8.5px] font-bold tracking-[0.25em] uppercase select-none" style={{ ...MONO_STACK, color: '#c98ba0' }}>In Red Ink</span>
                        </div>
                        <textarea
                            value={systemCmdInput}
                            onChange={e => setSystemCmdInput(e.target.value)}
                            placeholder={`想改的戏写在这儿，比如：\n· 让${char?.name || '角色'}主动拿走${userProfile?.name || '用户'}的手机翻一翻\n· 暂停这场戏，补一段两人初遇的番外\n· 接下来这段换成${char?.name || '角色'}的第一人称来写`}
                            rows={4}
                            className="w-full bg-transparent placeholder:text-[#cfb8c4] text-[13px] resize-none outline-none leading-relaxed"
                            style={{ color: '#3d2f3d', caretColor: '#e26b84' }}
                            autoFocus
                        />
                    </div>
                    <NoteStrip tone="danger">这一笔以「系统」的名义落下——盖过 TA 的人设和此前全部剧情，写完立刻照办。</NoteStrip>
                </div>
             </JournalSheet>

             {/* 位置分享 Modal */}
             <JournalSheet
                open={showLocationModal} title="落脚点" en="You Are Here" sub="给 TA 画张能找到你的小地图"
                tape="sky" pattern="dot" paper="grid"
                onClose={() => setShowLocationModal(false)}
                footer={<>
                    <SealBtn kind="ghost" onClick={() => setShowLocationModal(false)}>先不说</SealBtn>
                    <SealBtn kind="rose" onClick={handleSendLocation}>插上小旗寄出</SealBtn>
                </>}
             >
                <div className="space-y-3.5">
                    <div className="flex items-center gap-2">
                        <span aria-hidden className="text-[15px] leading-none" style={{ transform: 'rotate(-6deg)', display: 'inline-block' }}>🚩</span>
                        <span className="text-[8.5px] font-bold tracking-[0.25em] uppercase select-none" style={{ ...MONO_STACK, color: '#9bb3c4' }}>Mark The Spot</span>
                        <span aria-hidden className="flex-1 border-t border-dashed" style={{ borderColor: 'rgba(122,90,114,0.25)' }} />
                    </div>
                    <LinedInput value={locationName} onChange={e => setLocationName(e.target.value)} placeholder="这儿叫什么（比如：江汉路口那家咖啡店）" maxLength={40} className="font-bold" autoFocus />
                    <LinedInput value={locationDetail} onChange={e => setLocationDetail(e.target.value)} placeholder="几楼几号、怎么找到你，空着也行" maxLength={80} />
                    <NoteStrip>TA 会收到一张插着小旗的位置卡片，一眼就知道你这会儿落在哪儿。</NoteStrip>
                </div>
             </JournalSheet>

             {/* AI 画图 Modal */}
             <JournalSheet
                open={showImageGenModal} title="随手画一张" en="Doodle Post" sub="把想看的画面讲出来，画好就寄"
                tape="lemon" pattern="star" paper="dot"
                onClose={() => { if (!isGeneratingImage) { setShowImageGenModal(false); setImageGenPreview(null); } }}
                footer={imageGenPreview
                    ? <>
                        <SealBtn kind="ghost" onClick={() => setImageGenPreview(null)}>不行，重画</SealBtn>
                        <SealBtn kind="rose" onClick={handleSendGeneratedImage}>就它了，寄出</SealBtn>
                    </>
                    : <SealBtn kind="rose" full onClick={handleGenerateImage} disabled={isGeneratingImage}>{isGeneratingImage ? '颜料还没干，等等…' : '开始画'}</SealBtn>}
             >
                <div className="space-y-3.5">
                    {imageGenPreview ? (
                        <div className="px-4 py-1">
                            {/* 刚画好的拍立得 */}
                            <div className="relative bg-white p-2 pb-8 rounded-[4px]" style={{ boxShadow: '0 4px 14px rgba(122,90,114,0.28)', transform: 'rotate(-1.2deg)' }}>
                                <span aria-hidden className="absolute -top-2 left-1/2 -translate-x-1/2 w-12 h-4 pointer-events-none" style={{ background: 'rgba(245,226,149,0.85)', transform: 'rotate(-3deg)', clipPath: 'polygon(3% 0, 100% 8%, 97% 100%, 0 92%)' }} />
                                <img src={imageGenPreview} className="w-full" alt="刚画好的一张" />
                                <div className="absolute bottom-2 left-3 right-3 flex items-center justify-between">
                                    <span className="text-[10px] font-bold" style={{ ...CUTE_STACK, color: '#7a5a72' }}>刚晾干的一张</span>
                                    <span className="text-[8px] tracking-[0.2em] uppercase select-none" style={{ ...MONO_STACK, color: '#bfa8b8' }}>fresh print</span>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <>
                            <LinedArea value={imageGenPrompt} onChange={e => setImageGenPrompt(e.target.value)} placeholder="想要什么画面，讲给画笔听（比如：雨停后的天台，水洼里漂着霓虹的影子）" rows={3} autoFocus />
                            <LinedInput value={imageGenModel} onChange={e => setImageGenModel(e.target.value)} tag="换支画笔（生图模型）" placeholder={`空着就用 ${DEFAULT_IMAGE_GEN_MODEL}`} style={{ fontSize: 12 }} />
                            <NoteStrip>画的请求走当前 API 的 /images/generations 端点，填的模型得会画画；寄出后相册里也会留一张底。</NoteStrip>
                        </>
                    )}
                </div>
             </JournalSheet>

             {/* 心声面板（入口：顶栏角色头像）：社交主页式卡片（参考设计 MiMi Space）——
                 书签缎带 + 渐变圆环头像 + 好感/心声/心情统计行 + Follow/Message 式双按钮 */}
             {showInnerVoiceModal && char && (
                <div
                    className="absolute inset-0 z-[220] flex items-center justify-center p-5 animate-fade-in"
                    style={{ background: 'rgba(20,20,28,0.45)', backdropFilter: 'blur(4px)' }}
                    onClick={() => setShowInnerVoiceModal(false)}
                >
                    <div
                        className="w-full max-w-sm bg-white rounded-[1.8rem] shadow-2xl flex flex-col max-h-[84vh] overflow-hidden animate-slide-up relative"
                        onClick={e => e.stopPropagation()}
                    >
                        {/* 右上角书签缎带 */}
                        <div className="absolute top-0 right-7 w-6 h-10 bg-slate-900 z-10" style={{ clipPath: 'polygon(0 0, 100% 0, 100% 100%, 50% 72%, 0 100%)' }} />

                        {/* 标题条：居中标题 + 左上关闭 */}
                        <div className="relative flex items-center justify-center px-6 pt-5 pb-1 shrink-0">
                            <button onClick={() => setShowInnerVoiceModal(false)} className="absolute left-4 p-1.5 rounded-full text-slate-400 hover:bg-slate-50 active:scale-95 transition-all" aria-label="关闭">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
                            </button>
                            <div className="text-center">
                                <div className="text-[12px] font-mono font-bold tracking-[0.45em] text-slate-700 uppercase">Inner&nbsp;Space</div>
                                <div className="text-[9px] font-mono tracking-[0.3em] text-slate-300 mt-0.5">You &amp; Me</div>
                            </div>
                        </div>

                        {/* 主页卡：名字条 + 渐变圆环头像 + 统计行 + 心情签名 */}
                        <div className="mx-5 mt-2 rounded-3xl border border-slate-100 shadow-[0_10px_28px_-18px_rgba(50,48,60,0.35)] shrink-0">
                            <div className="flex items-center justify-between px-5 pt-3.5">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5 text-slate-400"><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" /></svg>
                                <span className="text-[14px] font-bold text-slate-800 tracking-widest truncate max-w-[60%]">{displayCharName}</span>
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-slate-400"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" /></svg>
                            </div>
                            <div className="flex items-center gap-4 px-5 pt-3 pb-1">
                                {/* 手缝圆环头像（手账风：白纸底 + 墨色虚线缝边） */}
                                <div className="shrink-0 p-[3px] rounded-full bg-white border-2 border-dashed border-[#bdb7a8] shadow-[0_6px_16px_-8px_rgba(50,48,60,0.4)]">
                                    <img src={displayCharAvatar} className="w-[4.6rem] h-[4.6rem] rounded-full object-cover border-[3px] border-white" alt={displayCharName} />
                                </div>
                                {/* 统计行：好感 / 心声 / 心情 */}
                                <div className="flex-1 flex items-start justify-around text-center">
                                    <div>
                                        <div className="text-lg font-extrabold text-slate-800 leading-tight">{typeof char.affection === 'number' ? Math.round(char.affection) : '—'}</div>
                                        <div className="text-[10px] text-slate-400">好感值</div>
                                    </div>
                                    <div>
                                        <div className="text-lg font-extrabold text-slate-800 leading-tight">{innerVoiceHistory.length}</div>
                                        <div className="text-[10px] text-slate-400">心声</div>
                                    </div>
                                    <div>
                                        <div className="text-lg font-extrabold text-slate-800 leading-tight">{char.currentMood?.emoji || '🤍'}</div>
                                        <div className="text-[10px] text-slate-400">{char.currentMood?.label || '心情'}</div>
                                    </div>
                                </div>
                            </div>
                            {/* 好感进度细线 */}
                            <div className="px-5 pt-1">
                                <div className="h-1 rounded-full bg-slate-100 overflow-hidden">
                                    <div className="h-full rounded-full bg-slate-900 transition-all duration-700" style={{ width: `${typeof char.affection === 'number' ? Math.max(0, Math.min(100, char.affection)) : 0}%` }} />
                                </div>
                            </div>
                            {/* 双按钮（Follow / Message 式） */}
                            <div className="flex gap-2.5 px-5 py-3.5">
                                <button onClick={generateInnerVoice} disabled={innerVoiceLoading} className={`flex-1 py-2.5 text-[13px] font-bold rounded-xl text-white active:scale-[0.98] transition-transform ${innerVoiceLoading ? 'bg-slate-400' : 'bg-[#2b2933] shadow-[0_10px_22px_-12px_rgba(43,41,51,0.6)]'}`}>{innerVoiceLoading ? '偷听中…' : '再偷看一次'}</button>
                                <button onClick={() => setShowInnerVoiceModal(false)} className="flex-1 py-2.5 text-[13px] font-bold rounded-xl bg-slate-100 text-slate-600 active:scale-[0.98] transition-transform">悄悄合上</button>
                            </div>
                        </div>

                        {/* 心声内容（可滚动） */}
                        <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-6 space-y-3 pt-4 pb-2">
                            {innerVoiceLoading && !innerVoiceCurrent && (
                                <div className="flex flex-col items-center gap-2 py-8 text-slate-400">
                                    <div className="w-6 h-6 border-2 border-slate-200 border-t-slate-700 rounded-full animate-spin" />
                                    <span className="text-xs">正在窥探 {displayCharName} 的内心…</span>
                                </div>
                            )}
                            {innerVoiceCurrent && (
                                <div
                                    className="p-4 rounded-2xl rounded-tl-md bg-slate-900 text-white shadow-md"
                                    style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.06) 1px, transparent 1px)', backgroundSize: '7px 7px' }}
                                >
                                    <p className="text-[13px] leading-relaxed whitespace-pre-wrap">「{innerVoiceCurrent.content}」</p>
                                    <p className="text-[10px] text-white/40 mt-2 text-right font-mono">{new Date(innerVoiceCurrent.timestamp).toLocaleString('zh-CN')}</p>
                                </div>
                            )}
                            {innerVoiceHistory.filter(h => h.id !== innerVoiceCurrent?.id).length > 0 && (
                                <div className="space-y-2">
                                    <p className="text-[10px] font-bold text-slate-300 uppercase tracking-wider px-1">之前偷看到的</p>
                                    {innerVoiceHistory.filter(h => h.id !== innerVoiceCurrent?.id).slice(0, 10).map(h => (
                                        <div key={h.id} className="p-3 rounded-2xl rounded-tl-md bg-slate-50 border border-slate-100">
                                            <p className="text-[12px] text-slate-500 leading-relaxed whitespace-pre-wrap line-clamp-3">{h.content}</p>
                                            <p className="text-[9px] text-slate-300 mt-1.5 text-right font-mono">{new Date(h.timestamp).toLocaleString('zh-CN')}</p>
                                        </div>
                                    ))}
                                </div>
                            )}
                            <p className="text-[10px] text-slate-300 text-center pt-1 pb-3">{displayCharName} 不会知道你偷看过 ——「心声」不会进入对话。</p>
                        </div>
                    </div>
                </div>
             )}

             <ChatModals
                modalType={modalType} setModalType={setModalType}
                transferAmt={transferAmt} setTransferAmt={setTransferAmt}
                transferMode={transferMode} setTransferMode={setTransferMode}
                transferNote={transferNote} setTransferNote={setTransferNote}
                walletBalance={userProfile.balance || 0}
                emojiImportText={emojiImportText} setEmojiImportText={setEmojiImportText}
                settingsContextLimit={settingsContextLimit} setSettingsContextLimit={setSettingsContextLimit}
                settingsHideSysLogs={settingsHideSysLogs} setSettingsHideSysLogs={setSettingsHideSysLogs}
                preserveContext={preserveContext} setPreserveContext={setPreserveContext}
                editContent={editContent} setEditContent={setEditContent}
                archivePrompts={archivePrompts} selectedPromptId={selectedPromptId} setSelectedPromptId={(id: string) => {
                    setSelectedPromptId(id);
                    // 同步写 localStorage，让 palace extraction 的风格追加能读到最新选择
                    try { localStorage.setItem('chat_active_archive_prompt_id', id); } catch {}
                }}
                editingPrompt={editingPrompt} setEditingPrompt={setEditingPrompt} isSummarizing={isSummarizing} archiveProgress={archiveProgress}
                selectedMessage={selectedMessage} selectedEmoji={selectedEmoji} activeCharacter={char} messages={messages}
                allHistoryMessages={allHistoryMessages}
                
                newCategoryName={newCategoryName} setNewCategoryName={setNewCategoryName} onAddCategory={handleAddCategory}
                selectedCategory={selectedCategory}

                onTransfer={() => {
                    const amt = parseFloat(transferAmt);
                    if (!transferAmt || isNaN(amt) || amt <= 0) { setModalType('none'); setTransferNote(''); return; }
                    // 与钱包绑定：从存钱罐营业赚来的余额里扣，不足则拦下（弹窗不关，方便改数目）
                    const bal = userProfile.balance || 0;
                    if (amt > bal) {
                        addToast(`钱包只有 ¥${Math.round(bal)}，先去存钱罐营业赚点再寄吧`, 'error');
                        return;
                    }
                    adjustUserBalance(-amt);
                    handleSendText(
                        transferMode === 'redpacket' ? `[红包]` : `[转账]`,
                        'transfer',
                        { amount: transferAmt, ...(transferMode === 'redpacket' ? { kind: 'redpacket', note: transferNote.trim() || undefined } : {}) }
                    );
                    addToast(transferMode === 'redpacket' ? `红包已寄出 · 钱包 -¥${Math.round(amt)}` : `零花钱已寄出 · 钱包 -¥${Math.round(amt)}`, 'success');
                    setModalType('none');
                    setTransferNote('');
                }}
                onImportEmoji={handleImportEmoji}
                onSaveSettings={saveSettings} onBgUpload={handleBgUpload} onRemoveBg={() => updateCharacter(char.id, { chatBackground: undefined })}
                onClearHistory={handleClearHistory} onArchive={handleFullArchive}
                onCreatePrompt={createNewPrompt} onEditPrompt={editSelectedPrompt} onSavePrompt={handleSavePrompt} onDeletePrompt={handleDeletePrompt}
                onSetHistoryStart={handleSetHistoryStart} onJumpToMessageInChat={handleJumpToMessageInChat} onEnterSelectionMode={handleEnterSelectionMode}
                onReplyMessage={handleReplyMessage} onEditMessageStart={() => { if (selectedMessage) { setEditContent(selectedMessage.content); setModalType('edit-message'); } }}
                onConfirmEditMessage={confirmEditMessage} onDeleteMessage={handleDeleteMessage} onCopyMessage={handleCopyMessage} onDeleteEmoji={handleDeleteEmoji} onDeleteCategory={handleDeleteCategory}
                allCharacters={characters} onSaveCategoryVisibility={handleSaveCategoryVisibility}
                translationEnabled={translationEnabled}
                onToggleTranslation={() => { const next = !translationEnabled; setTranslationEnabled(next); localStorage.setItem(`chat_translate_enabled_${activeCharacterId}`, JSON.stringify(next)); if (!next) { setShowingTargetIds(new Set()); } }}
                translateSourceLang={translateSourceLang}
                translateTargetLang={translateTargetLang}
                onSetTranslateSourceLang={(lang: string) => { setTranslateSourceLang(lang); localStorage.setItem(`chat_translate_source_lang_${activeCharacterId}`, lang); setShowingTargetIds(new Set()); }}
                onSetTranslateLang={(lang: string) => { setTranslateTargetLang(lang); localStorage.setItem(`chat_translate_lang_${activeCharacterId}`, lang); setShowingTargetIds(new Set()); }}
                xhsEnabled={!!char.xhsEnabled}
                onToggleXhs={() => updateCharacter(char.id, { xhsEnabled: !char.xhsEnabled })}
                timeAwarenessEnabled={char.timeAwarenessEnabled !== false}
                onToggleTimeAwareness={() => updateCharacter(char.id, { timeAwarenessEnabled: char.timeAwarenessEnabled === false })}
                htmlModeEnabled={(char as any).htmlModeEnabled !== false}
                onToggleHtmlMode={() => updateCharacter(char.id, { htmlModeEnabled: (char as any).htmlModeEnabled === false } as any)}
                htmlModeCustomPrompt={settingsHtmlModeCustomPrompt}
                setHtmlModeCustomPrompt={setSettingsHtmlModeCustomPrompt}
                chatVoiceEnabled={!!char.chatVoiceEnabled}
                onToggleChatVoice={() => updateCharacter(char.id, { chatVoiceEnabled: !char.chatVoiceEnabled })}
                chatVoiceLang={char.chatVoiceLang || ''}
                onSetChatVoiceLang={(lang: string) => updateCharacter(char.id, { chatVoiceLang: lang })}
                voiceAvailable={!!(char.voiceProfile?.voiceId || char.voiceProfile?.timberWeights?.length)}
                onGenerateVoice={selectedMessage ? () => handleManualTts(selectedMessage) : undefined}
                scheduleData={scheduleData}
                isScheduleGenerating={isScheduleGenerating}
                onScheduleEdit={handleScheduleEdit}
                onScheduleDelete={handleScheduleDelete}
                onScheduleReroll={() => generateDailySchedule(char, true)}
                onScheduleCoverChange={handleScheduleCoverChange}
                onScheduleStyleChange={handleScheduleStyleChange}
                isScheduleFeatureEnabled={isScheduleFeatureOn(char)}
                onToggleScheduleFeature={handleToggleScheduleFeature}
                isMemoryPalaceEnabled={!!char.memoryPalaceEnabled}
                isVectorizing={isVectorizing}
                onForceVectorize={handleForceVectorize}
                apiPresets={apiPresets}
                onAddApiPreset={addApiPreset}
                onSaveEmotion={(config) => {
                    // API 同步到所有角色，enabled 仅写到当前角色
                    syncEmotionApiToAllCharacters(config.api);
                    updateCharacter(char.id, {
                        emotionConfig: {
                            enabled: config.enabled,
                            ...(config.api && config.api.baseUrl ? { api: config.api } : {}),
                        },
                    });
                }}
                onClearBuffs={() => {
                    updateCharacter(char.id, { activeBuffs: [], buffInjection: '' });
                    addToast('情绪状态已清除', 'info');
                }}
             />
             
             <ChatHeader
                selectionMode={selectionMode}
                selectedCount={selectedMsgIds.size + Array.from(selectedThinkingMsgIds).filter(id => !selectedMsgIds.has(id)).length}
                onCancelSelection={() => { setSelectionMode(false); setSelectedMsgIds(new Set()); setSelectedThinkingMsgIds(new Set()); }}
                activeCharacter={headerChar}
                isTyping={isTyping}
                isSummarizing={isSummarizing}
                isEmotionEvaluating={emotionStatus === 'evaluating'}
                isInstantSending={instantSendingActive}
                isMemoryPalaceProcessing={!!memoryPalaceStatus}
                memoryPalaceStatusText={memoryPalaceStatus}
                lastTokenUsage={lastTokenUsage}
                tokenBreakdown={tokenBreakdown}
                onClose={() => openApp(AppID.GroupChat)}
                // 左上角头像 = 心声面板（心声 / 好感值 / 当前心情）；点角色名的「切换角色 / 信纸花样」弹窗已移除
                onAvatarClick={tryOpenInnerVoice}
                // 聊天设置移入右上角 ··· 内
                onOpenSettings={() => setModalType('chat-settings')}
                onDeleteBuff={(buffId) => {
                    const currentBuffs = char.activeBuffs || [];
                    const newBuffs = currentBuffs.filter(b => b.id !== buffId);
                    const newInjection = '';
                    updateCharacter(char.id, { activeBuffs: newBuffs, buffInjection: newInjection });
                    addToast('已删除该情绪状态', 'info');
                }}
                // 默认风格对照参考设计：居中头像的浅色圆润顶栏（用户在「主题」里改过则尊重用户配置）
                headerStyle={osTheme.chatHeaderStyle || 'minimal'}
                avatarShape={osTheme.chatAvatarShape}
                headerAlign={osTheme.chatHeaderAlign || 'center'}
                headerDensity={osTheme.chatHeaderDensity}
                statusStyle={osTheme.chatStatusStyle || 'dot'}
                chromeStyle={osTheme.chatChromeStyle}
                hideBuffs={osTheme.chatHideHeaderBuffs}
                decorText={convo?.headerDecorText}
             />

            {/* 会话设置「顶部贴边」：顶栏下方装饰横条（不占布局，浮在消息区顶部） */}
            {convo?.headerEdgeImage && (
                <div className="relative z-20 h-0 pointer-events-none">
                    <img src={convo.headerEdgeImage} alt="" className="absolute top-0 left-0 w-full h-6 object-cover" />
                </div>
            )}
            {/* 顶部装饰文案已移到 ChatHeaderShell（顶栏卡片上方居中小字，参考设计） */}

            {/* 认知消化结果弹窗 — 全屏玻璃拟态 */}
            {lastDigestResult && (() => {
                const r = lastDigestResult;
                const groups: Array<{
                    key: string;
                    label: string;
                    icon: string;
                    accent: string;       // base hue for chip/dot
                    items: Array<{ content: string; sub?: string }>;
                }> = [];
                if (r.resolved.length) groups.push({ key: 'resolved', label: '困惑化解', icon: '🕊️', accent: '#10b981', items: r.resolved.map(e => ({ content: e.content })) });
                if (r.deepened.length) groups.push({ key: 'deepened', label: '创伤加深', icon: '💢', accent: '#f43f5e', items: r.deepened.map(e => ({ content: e.content })) });
                if (r.internalized.length) groups.push({ key: 'internalized', label: '知识内化', icon: '🪞', accent: '#8b5cf6', items: r.internalized.map(e => ({ content: e.content })) });
                if (r.selfInsights.length) groups.push({ key: 'insights', label: '自我领悟', icon: '💡', accent: '#f59e0b', items: r.selfInsights.map(t => ({ content: t })) });
                if (r.selfConfused.length) groups.push({ key: 'confused', label: '新的自我困惑', icon: '🌀', accent: '#6366f1', items: r.selfConfused.map(e => ({ content: e.content })) });
                if (r.synthesizedUser.length) groups.push({ key: 'synth', label: '用户认知整合', icon: '👤', accent: '#0ea5e9', items: r.synthesizedUser.map(e => ({ content: e.content, sub: e.category })) });
                if (r.fulfilled.length) groups.push({ key: 'fulfilled', label: '期盼实现', icon: '✨', accent: '#22c55e', items: r.fulfilled.map(e => ({ content: e.content })) });
                if (r.disappointed.length) groups.push({ key: 'disappointed', label: '期盼落空', icon: '🍂', accent: '#94a3b8', items: r.disappointed.map(e => ({ content: e.content })) });
                if (r.faded.length) groups.push({ key: 'faded', label: '淡忘', icon: '🌫️', accent: '#cbd5e1', items: r.faded.map(e => ({ content: e.content })) });
                if (groups.length === 0) return null;
                return (
                    <div
                        className="absolute inset-0 z-[200] flex items-center justify-center p-4 animate-fade-in"
                        style={{
                            background: 'radial-gradient(ellipse at top, rgba(16,185,129,0.18), rgba(0,0,0,0.55))',
                            backdropFilter: 'blur(10px)',
                            WebkitBackdropFilter: 'blur(10px)',
                        }}
                        onClick={() => setLastDigestResult(null)}
                    >
                        <div
                            className="w-full max-w-sm max-h-[85vh] overflow-hidden flex flex-col relative"
                            style={{
                                background: 'linear-gradient(160deg, rgba(255,255,255,0.98) 0%, rgba(240,253,250,0.96) 100%)',
                                borderRadius: 28,
                                border: '1px solid rgba(255,255,255,0.7)',
                                boxShadow: '0 30px 80px -20px rgba(16,185,129,0.35), 0 10px 40px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.9)',
                            }}
                            onClick={(e) => e.stopPropagation()}
                        >
                            {/* 顶部光晕条 */}
                            <div
                                className="absolute top-0 left-0 right-0 h-1 pointer-events-none"
                                style={{ background: 'linear-gradient(90deg, transparent, #10b981, #6ee7b7, #10b981, transparent)' }}
                            />
                            {/* 头部 */}
                            <div className="px-6 pt-7 pb-4 text-center">
                                <div
                                    className="w-14 h-14 mx-auto rounded-2xl flex items-center justify-center mb-3"
                                    style={{
                                        background: 'linear-gradient(135deg, rgba(16,185,129,0.15), rgba(52,211,153,0.08))',
                                        boxShadow: 'inset 0 1px 2px rgba(255,255,255,0.9), 0 4px 16px rgba(16,185,129,0.2)',
                                    }}
                                >
                                    <span style={{ fontSize: 28 }}>🧠</span>
                                </div>
                                <div className="text-[11px] tracking-[0.2em] uppercase font-semibold" style={{ color: '#059669' }}>Cognitive Digest</div>
                                <div className="text-[17px] font-bold mt-1" style={{ color: '#0f172a' }}>{char.name} 完成了一次认知消化</div>
                                <div className="text-[11px] text-slate-400 mt-1">内心整理 · {groups.reduce((s, g) => s + g.items.length, 0)} 项变化</div>
                            </div>

                            {/* 内容列表 */}
                            <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-3 no-scrollbar">
                                {groups.map(g => (
                                    <div key={g.key}
                                        className="rounded-2xl overflow-hidden"
                                        style={{
                                            background: 'rgba(255,255,255,0.7)',
                                            border: `1px solid ${g.accent}22`,
                                            boxShadow: `0 2px 8px ${g.accent}14, inset 0 1px 0 rgba(255,255,255,0.8)`,
                                        }}
                                    >
                                        <div className="px-4 py-2.5 flex items-center gap-2"
                                            style={{ background: `linear-gradient(90deg, ${g.accent}18, transparent)` }}
                                        >
                                            <span style={{ fontSize: 14 }}>{g.icon}</span>
                                            <span className="text-[12px] font-bold" style={{ color: g.accent }}>{g.label}</span>
                                            <span className="text-[10px] font-bold ml-auto px-1.5 py-0.5 rounded-full"
                                                style={{ background: `${g.accent}22`, color: g.accent }}
                                            >{g.items.length}</span>
                                        </div>
                                        <div className="px-4 py-2 space-y-1.5">
                                            {g.items.slice(0, 3).map((it, i) => (
                                                <div key={i} className="text-[12px] leading-relaxed text-slate-700 flex gap-2">
                                                    <span className="shrink-0 mt-[7px] w-1 h-1 rounded-full" style={{ background: g.accent }} />
                                                    <span className="flex-1">
                                                        {it.sub && <span className="text-[10px] font-semibold mr-1.5 px-1.5 py-0.5 rounded" style={{ background: `${g.accent}18`, color: g.accent }}>{it.sub}</span>}
                                                        <span>{it.content.length > 80 ? it.content.slice(0, 80) + '…' : it.content}</span>
                                                    </span>
                                                </div>
                                            ))}
                                            {g.items.length > 3 && (
                                                <div className="text-[10px] text-slate-400 pl-3">还有 {g.items.length - 3} 条…</div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* 确认按钮 */}
                            <div className="px-6 pb-6 pt-2">
                                <button
                                    onClick={() => setLastDigestResult(null)}
                                    className="w-full py-3 text-white text-[13px] font-bold rounded-2xl active:scale-[0.98] transition-transform"
                                    style={{
                                        background: 'linear-gradient(135deg, #10b981, #059669)',
                                        boxShadow: '0 8px 24px -4px rgba(16,185,129,0.45), inset 0 1px 0 rgba(255,255,255,0.25)',
                                    }}
                                >
                                    放入心里
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* 会话设置「角色立绘」：galgame 式半透明立绘，垫在消息气泡之下、背景之上 */}
            {convo?.spriteImage && (
                <img
                    src={convo.spriteImage}
                    alt=""
                    className="absolute bottom-0 right-0 max-h-[62%] max-w-[58%] object-contain pointer-events-none select-none opacity-95"
                    style={{ zIndex: 0 }}
                />
            )}
            <div ref={scrollRef} className="relative z-[1] flex-1 overflow-y-auto overflow-x-hidden pt-6 pb-6 no-scrollbar" style={{ backgroundImage: activeTheme.type === 'custom' && activeTheme.user.backgroundImage ? 'none' : undefined }}>
                {windowedFocusMsgId !== null && (
                    <div className="sticky top-0 z-20 flex justify-center pb-2 pointer-events-none">
                        <button onClick={handleBackToCurrent} className="pointer-events-auto px-4 py-2 bg-primary text-white rounded-full text-xs font-bold shadow-lg active:scale-95 transition-transform flex items-center gap-1.5">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.2} stroke="currentColor" className="w-3.5 h-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 13.5 12 21m0 0-7.5-7.5M12 21V3" /></svg>
                            回到当前聊天
                        </button>
                    </div>
                )}
                {collapsedCount > 0 && windowedFocusMsgId === null && (
                    <div className="flex justify-center mb-6">
                        <button onClick={async () => {
                            const nextVisibleCount = visibleCount + LOAD_BATCH_SIZE;
                            visibleCountRef.current = nextVisibleCount;
                            setVisibleCount(nextVisibleCount);
                            await reloadMessages(nextVisibleCount);
                        }} className="px-4 py-2 bg-white/50 backdrop-blur-sm rounded-full text-xs text-slate-500 shadow-sm border border-white hover:bg-white transition-colors">加载历史消息 ({collapsedCount})</button>
                    </div>
                )}

                {/* 开场白选择器（空聊天 + 角色带开场白时）：预览气泡 + 左右切换（同 ST 开场白 swipe） */}
                {greetingPickerActive && !selectionMode && (
                    <div className="px-3 mb-4 animate-fade-in">
                        <div className="flex items-end gap-3">
                            <img src={char.avatar} className="w-9 h-9 rounded-full object-cover shadow-sm shrink-0" />
                            <div className="max-w-[78%] min-w-0">
                                <div className="bg-white/90 border border-white rounded-2xl rounded-bl-md px-4 py-3 shadow-sm text-sm text-slate-700 leading-relaxed whitespace-pre-wrap break-words">
                                    {substituteMacros(greetingOptions[Math.min(greetingIdx, greetingOptions.length - 1)], greetingMacroCtx)}
                                </div>
                                <div className="flex items-center gap-2 mt-2 pl-1 flex-wrap">
                                    {greetingOptions.length > 1 && (
                                        <div className="flex items-center gap-1.5 bg-white/60 rounded-full px-2 py-1 border border-white shadow-sm">
                                            <button
                                                onClick={() => setGreetingIdx(i => (i - 1 + greetingOptions.length) % greetingOptions.length)}
                                                className="p-1 rounded-full hover:bg-black/5 active:scale-90 transition-transform"
                                                title="上一条开场白"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.2} stroke="currentColor" className="w-3.5 h-3.5 text-slate-500"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
                                            </button>
                                            <span className="text-[10px] font-bold text-slate-500 tabular-nums select-none">
                                                {Math.min(greetingIdx, greetingOptions.length - 1) + 1} / {greetingOptions.length}
                                            </span>
                                            <button
                                                onClick={() => setGreetingIdx(i => (i + 1) % greetingOptions.length)}
                                                className="p-1 rounded-full hover:bg-black/5 active:scale-90 transition-transform"
                                                title="下一条开场白"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.2} stroke="currentColor" className="w-3.5 h-3.5 text-slate-500"><path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" /></svg>
                                            </button>
                                        </div>
                                    )}
                                    <button
                                        onClick={async () => {
                                            try {
                                                await commitGreeting();
                                                await reloadMessages(visibleCountRef.current);
                                            } catch (e: any) {
                                                addToast(e?.message || '开场白保存失败', 'error');
                                            }
                                        }}
                                        className="px-3 py-1.5 bg-primary text-white text-[10px] font-bold rounded-full shadow-sm shadow-primary/30 active:scale-95 transition-transform"
                                    >以这条开场白开始</button>
                                </div>
                                <p className="text-[10px] text-slate-400 mt-1.5 pl-1">
                                    {greetingOptions.length > 1 ? '左右切换选择开场白；' : ''}直接发消息也会以当前这条开场。
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                {displayMessages.map((m, i) => {
                    const prevMessage = i > 0 ? displayMessages[i - 1] : null;
                    const nextMessage = i < displayMessages.length - 1 ? displayMessages[i + 1] : null;
                    const messageGroupGapMs = 30 * 60 * 1000;
                    const breaksWithPrevious =
                        !prevMessage ||
                        prevMessage.role !== m.role ||
                        Math.abs(m.timestamp - prevMessage.timestamp) > messageGroupGapMs;
                    const breaksWithNext =
                        !nextMessage ||
                        nextMessage.role !== m.role ||
                        Math.abs(nextMessage.timestamp - m.timestamp) > messageGroupGapMs;
                    // 时间分割线（黑白手帐式「🤍 Today 22:28」）：会话开头或间隔超过 30 分钟时插入
                    const needsTimeDivider = m.role !== 'system' &&
                        (!prevMessage || Math.abs(m.timestamp - prevMessage.timestamp) > messageGroupGapMs);
                    const dividerLabel = (() => {
                        if (!needsTimeDivider) return '';
                        const d = new Date(m.timestamp);
                        const today = new Date();
                        const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
                        const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
                        const dayStr = sameDay(d, today) ? 'Today'
                            : sameDay(d, yesterday) ? 'Yesterday'
                            : d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
                        const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
                        return `${dayStr} ${timeStr}`;
                    })();
                    return (
                        <div
                            key={m.id || i}
                            id={`chat-msg-${m.id}`}
                            className={[
                                flashMsgId === m.id ? 'ring-2 ring-yellow-300 bg-yellow-50/40 rounded-2xl mx-2' : '',
                                'transition-all duration-300',
                            ].filter(Boolean).join(' ')}
                        >
                        {needsTimeDivider && (
                            <div className="flex items-center justify-center gap-1.5 py-3 select-none">
                                <span className="text-[11px] opacity-60">🤍</span>
                                <span className="text-[11px] font-medium text-slate-400 tracking-wide">{dividerLabel}</span>
                                <span className="text-[11px] opacity-60">💬</span>
                            </div>
                        )}
                        <MessageItem
                            msg={m}
                            isFirstInGroup={breaksWithPrevious}
                            isLastInGroup={breaksWithNext}
                            activeTheme={activeTheme}
                            charAvatar={displayCharAvatar}
                            charName={displayCharName}
                            userAvatar={displayUserAvatar}
                            onLongPress={handleMessageLongPress}
                            onSwipeReply={handleSwipeReply}
                            selectionMode={selectionMode}
                            isSelected={selectedMsgIds.has(m.id)}
                            onToggleSelect={toggleMessageSelection}
                            isThinkingSelected={selectedThinkingMsgIds.has(m.id)}
                            onToggleThinkingSelect={toggleThinkingSelection}
                            translationEnabled={translationEnabled && m.type === 'text' && m.role === 'assistant'}
                            isShowingTarget={showingTargetIds.has(m.id)}
                            onTranslateToggle={handleTranslateToggle}
                            voiceData={voiceDataMap[m.id]}
                            voiceLoading={voiceLoading.has(m.id)}
                            isVoicePlaying={playingMsgId === m.id}
                            onPlayVoice={onPlayVoiceStable}
                            avatarShape={osTheme.chatAvatarShape}
                            avatarSize={osTheme.chatAvatarSize}
                            avatarMode={osTheme.chatAvatarMode}
                            bubbleVariant={osTheme.chatBubbleStyle || 'wechat'}
                            messageSpacing={osTheme.chatMessageSpacing}
                            showTimestamp={convo?.hideTimestamp ? 'never' : osTheme.chatShowTimestamp}
                            isPending={false}
                            pendingIndicator={osTheme.chatPendingIndicator !== false}
                            onMcdSendCart={handleMcdSendCart}
                            onMcdCandidate={handleMcdCandidate}
                            thinkingChainOptions={thinkingChainOptions}
                            onAvatarClick={() => setShowCharProfile(true)}
                            onAvatarPoke={() => handleSendText(`[戳了戳 ${char.name}]`, 'interaction')}
                            blockedMark={m.role === 'assistant' && userBlockedChar && !!char.blacklistedAt && m.timestamp >= char.blacklistedAt}
                        />
                        </div>
                    );
                })}
                
                {/* 纯前端「发送准备中」三个点: 不走 MessageItem (那条逐条路径实测渲染不出来), 直接挂在
                    消息列表末尾、靠右(用户侧). 跟 header「发送中」同源 instantSendingActive 一起亮灭.
                    原版精致观感 = 小号 (w-1) + 轻脉冲. 但原版用的 Tailwind 自定义类 animate-dot-pulse
                    CDN 没生成 (一换就消失), 原版色 slate-400/70 又太淡看不见. 解法: 自己写 inline @keyframes
                    (不依赖 CDN) 还原脉冲, 用实色 slate-400 (峰值满不透明) 保证看得见, 尺寸回到原版 w-1. */}
                {instantSendingActive && !selectionMode && (
                    <div className="flex justify-end px-3 -mt-1 -mb-4">
                        <style>{`@keyframes chatPendingDot{0%,80%,100%{opacity:.35;transform:scale(.8)}40%{opacity:1;transform:scale(1)}}`}</style>
                        <span className="inline-flex items-center gap-[3px] mr-12 select-none pointer-events-none" role="status" aria-label="发送准备中">
                            <span className="w-1 h-1 rounded-full bg-slate-400" style={{ animation: 'chatPendingDot 1.2s ease-in-out infinite' }} />
                            <span className="w-1 h-1 rounded-full bg-slate-400" style={{ animation: 'chatPendingDot 1.2s ease-in-out infinite', animationDelay: '0.2s' }} />
                            <span className="w-1 h-1 rounded-full bg-slate-400" style={{ animation: 'chatPendingDot 1.2s ease-in-out infinite', animationDelay: '0.4s' }} />
                        </span>
                    </div>
                )}

                {instantToolStatus && !selectionMode && (
                    <div className="flex items-end gap-3 px-3 mb-4 animate-fade-in">
                        <img src={char.avatar} className={chatPendingAvatarClass} />
                        <div className={`max-w-[78%] px-4 py-3 rounded-2xl shadow-sm border ${
                            instantToolStatus.phase === 'failed'
                                ? 'bg-rose-50 border-rose-100 text-rose-700'
                                : 'bg-white/95 border-white/70 text-slate-600'
                        }`}>
                            <div className="flex items-center gap-2 text-xs font-semibold leading-relaxed">
                                {instantToolStatus.phase === 'failed' ? (
                                    <span className="w-2 h-2 rounded-full bg-rose-400 shrink-0" />
                                ) : instantToolStatus.phase === 'done' ? (
                                    <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                                ) : (
                                    <svg className="animate-spin h-3 w-3 shrink-0 text-indigo-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                )}
                                <span>{instantToolStatus.text}</span>
                            </div>
                        </div>
                    </div>
                )}

                {/* 流式输出预览：SSE 增量正文的打字机气泡，回复完成后由真实消息接管 */}
                {streamingText && !selectionMode && (
                    <div className="flex items-end gap-3 px-3 mb-6 animate-fade-in">
                        <img src={char.avatar} className={chatPendingAvatarClass} />
                        <div className="bg-white px-4 py-3 rounded-2xl shadow-sm max-w-[72%]">
                            <div className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap break-words">
                                {streamingText}
                                <span className="inline-block w-0.5 h-4 bg-slate-400 ml-0.5 align-text-bottom animate-pulse" />
                            </div>
                        </div>
                    </div>
                )}

                {(isTyping || recallStatus || searchStatus || diaryStatus || isProactiveComposing) && !selectionMode && !streamingText && (
                    <div className="flex items-end gap-3 px-3 mb-6 animate-fade-in">
                        <img src={char.avatar} className={chatPendingAvatarClass} />
                        <div className="bg-white px-4 py-3 rounded-2xl shadow-sm">
                            {isProactiveComposing && !isTyping && !recallStatus && !searchStatus && !diaryStatus ? (
                                <div className="flex items-center gap-2 text-xs text-teal-600 font-medium">
                                    <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                    {char.name} 在给你写消息…
                                </div>
                            ) : searchStatus ? (
                                <div className="flex items-center gap-2 text-xs text-emerald-500 font-medium">
                                    <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                    🔍 {searchStatus}
                                </div>
                            ) : recallStatus ? (
                                <div className="flex items-center gap-2 text-xs text-indigo-500 font-medium">
                                    <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                    {recallStatus}
                                </div>
                            ) : diaryStatus ? (
                                <div className="flex items-center gap-2 text-xs text-amber-600 font-medium">
                                    <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                    📖 {diaryStatus}
                                </div>
                            ) : (
                                <div className="flex gap-1"><div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce"></div><div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce delay-75"></div><div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce delay-150"></div></div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* 会话设置「消息区贴边」：输入栏上方装饰横条 */}
            {convo?.msgEdgeImage && (
                <div className="relative z-20 h-0 pointer-events-none">
                    <img src={convo.msgEdgeImage} alt="" className="absolute bottom-0 left-0 w-full h-6 object-cover" />
                </div>
            )}

            {/* 会话设置「底部装饰文案」：消息列表下方 / 输入栏上方的居中小字（参考设计） */}
            {convo?.footerDecorText && !selectionMode && (
                <div className="moro-chat-footdecor shrink-0 z-20 flex justify-center items-center pt-0.5 pb-1.5 px-8">
                    <span className="text-[13px] font-bold text-slate-500 tracking-wide truncate max-w-full">{convo.footerDecorText}</span>
                </div>
            )}

            <div className="relative z-40">
                {mcdActivated && (
                    <div className="flex items-center justify-between px-4 py-1.5 bg-yellow-50 border-b border-yellow-200 text-xs">
                        <div className="flex items-center gap-1.5 text-yellow-700 font-bold">
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-yellow-500 animate-pulse"/>
                            🍔 麦请求进行中
                        </div>
                        <button
                          onClick={() => handleSendText(MCD_DEACTIVATE_TRIGGER, 'text', { mcdDeactivate: true })}
                          className="px-2.5 py-0.5 bg-yellow-200/80 text-yellow-800 rounded-full text-[11px] font-bold active:scale-95"
                        >
                          结束
                        </button>
                    </div>
                )}
                {replyTarget && (
                    <div className="flex items-center justify-between px-4 py-2 bg-slate-50 border-b border-slate-200 text-xs text-slate-500">
                        <div className="flex items-center gap-2 truncate"><span className="font-bold text-slate-700">正在回复:</span><span className="truncate max-w-[200px]">{replyTarget.content.length > 10 ? replyTarget.content.slice(0, 10) + '...' : replyTarget.content}</span></div>
                        <button onClick={() => setReplyTarget(null)} className="p-1 text-slate-400 hover:text-slate-600">×</button>
                    </div>
                )}

                {/* 拉黑状态横幅：双向拉黑期间盖在输入栏上方 */}
                {charBlockedUser && char && (
                    <div className="flex items-center justify-between gap-2 px-4 py-2.5 bg-red-50 border-b border-red-100 text-xs">
                        <div className="flex items-center gap-1.5 text-red-500 font-bold min-w-0">
                            <span className="w-4 h-4 rounded-full bg-[#fa5151] text-white text-[10px] flex items-center justify-center shrink-0">!</span>
                            <span className="truncate">你已被 {char.name} 拉黑，无法发送消息</span>
                        </div>
                        <button
                            onClick={() => setShowFriendVerify(true)}
                            className="px-2.5 py-1 bg-red-500 text-white rounded-full text-[11px] font-bold active:scale-95 shrink-0"
                        >
                            发送好友验证
                        </button>
                    </div>
                )}
                {!charBlockedUser && userBlockedChar && char && (
                    <div className="flex items-center justify-between gap-2 px-4 py-2.5 bg-slate-100 border-b border-slate-200 text-xs">
                        <span className="text-slate-500 font-bold truncate">你已将 {char.name} 加入黑名单，无法发送消息</span>
                        <button
                            onClick={() => { updateCharacter(char.id, { blacklisted: false, blacklistedAt: undefined }); addToast(`已将 ${char.name} 移出黑名单`, 'success'); }}
                            className="px-2.5 py-1 bg-slate-600 text-white rounded-full text-[11px] font-bold active:scale-95 shrink-0"
                        >
                            解除拉黑
                        </button>
                    </div>
                )}

                <ChatInputArea
                    input={input} setInput={handleInputChange}
                    isTyping={isTyping} selectionMode={selectionMode}
                    showPanel={showPanel} setShowPanel={setShowPanel}
                    onSend={handleSendCallback}
                    onDeleteSelected={handleBatchDelete}
                    onForwardSelected={handleForwardSelected}
                    selectedCount={selectedMsgIds.size + Array.from(selectedThinkingMsgIds).filter(id => !selectedMsgIds.has(id)).length}
                    emojis={filteredEmojis}
                    allEmojis={allVisibleEmojis}
                    onPanelAction={handlePanelAction}
                    onImageSelect={handleImageSelect}
                    onSendVoice={handleSendVoice}
                    isSummarizing={isSummarizing}
                    categories={visibleCategories}
                    activeCategory={activeCategory}
                    onReroll={handleReroll}
                    canReroll={canReroll}
                    isProactiveActive={isProactiveActive}
                    mcdConfigured={mcdConfiguredFlag}
                    mcdActivated={mcdActivated}
                    showThinkingChain={!!(char as any).showThinkingChain}
                    inputStyle={osTheme.chatInputStyle || 'rounded'}
                    sendButtonStyle={osTheme.chatSendButtonStyle}
                    chromeStyle={osTheme.chatChromeStyle}
                    inputPlaceholder={convo?.inputPlaceholderText}
                />
            </div>


            {/* Proactive Settings Modal */}
            {char && (
                <ProactiveSettingsModal
                    isOpen={showProactiveModal}
                    onClose={() => setShowProactiveModal(false)}
                    char={char}
                    isProactiveActive={isProactiveActive}
                    onSave={(config) => {
                        updateCharacter(char.id, { proactiveConfig: config });
                        if (config.enabled) {
                            startProactiveChat(config.intervalMinutes, config.randomMode);
                            addToast(
                                config.randomMode
                                    ? `已启动随机主动消息，${char.name} 会按自己的节奏找你`
                                    : `已启动主动消息，每 ${config.intervalMinutes >= 60 ? (config.intervalMinutes / 60) + ' 小时' : config.intervalMinutes + ' 分钟'}发送一次`,
                                'success'
                            );
                        } else {
                            stopProactiveChat();
                            addToast('已关闭主动消息', 'info');
                        }
                    }}
                    onStop={() => {
                        stopProactiveChat();
                        updateCharacter(char.id, { proactiveConfig: { ...char.proactiveConfig!, enabled: false } });
                        addToast('已停止主动消息', 'info');
                    }}
                />
            )}

            {/* 思考链设置 Modal — 入口：聊天加号面板「展示思考」按钮长按 / 思考链卡片右上齿轮 */}
            {char && (
                <ThinkingChainSettingsModal
                    isOpen={showThinkingChainModal}
                    onClose={() => setShowThinkingChainModal(false)}
                    value={{
                        enabled: !!(char as any).showThinkingChain,
                        styleId: ((char as any).thinkingChainStyle as any) || 'echo',
                        customColors: {
                            bg: (char as any).thinkingChainCustomColors?.bg || '#1f2937',
                            accent: (char as any).thinkingChainCustomColors?.accent || '#fbbf24',
                            text: (char as any).thinkingChainCustomColors?.text || '#f1f5f9',
                        },
                        customPrompt: (char as any).thinkingChainCustomPrompt || '',
                    }}
                    onChange={(next) => {
                        const patch: any = {};
                        if (next.enabled !== undefined) patch.showThinkingChain = next.enabled;
                        if (next.styleId !== undefined) patch.thinkingChainStyle = next.styleId;
                        if (next.customColors !== undefined) patch.thinkingChainCustomColors = next.customColors;
                        if (next.customPrompt !== undefined) patch.thinkingChainCustomPrompt = next.customPrompt;
                        if (Object.keys(patch).length) updateCharacter(char.id, patch as any);
                    }}
                />
            )}

            {/* 角色专属「白框自定义」Modal —— 从加号面板「白框」进入；写到 char.chromeCustomCss，叠加在全局之上 */}
            {char && modalType === 'chrome-css' && (
                <div className="fixed inset-0 z-[110] flex items-end justify-center bg-black/5" onClick={() => setModalType('none')}>
                    <div
                        className="w-full max-h-[68vh] overflow-y-auto rounded-t-3xl border-t border-white/60 bg-white/95 p-5 shadow-[0_-12px_40px_rgba(15,23,42,0.18)] backdrop-blur-xl [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                        style={{ paddingBottom: 'calc(1.25rem + var(--safe-bottom))' }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="mb-2 flex items-start justify-between">
                            <div>
                                <div className="text-sm font-bold text-slate-800">白框自定义 · {char.name}</div>
                                <div className="mt-0.5 text-[10px] text-slate-400">↑ 上方聊天界面即实时预览；仅对该角色生效，叠加在全局设置之上。</div>
                            </div>
                            <button onClick={() => setModalType('none')} className="px-2 text-xl leading-none text-slate-400 hover:text-slate-600">{'×'}</button>
                        </div>
                        <ChromeCssEditor value={char.chromeCustomCss || ''} onChange={(css) => updateCharacter(char.id, { chromeCustomCss: css } as any)} />
                    </div>
                    {/* 脱离 CSS 控制的救援键：只在「白框」自定义弹窗开着时出现（平时不显示，不丑）。portal 到 body
                        在聊天 DOM 之外 + id 守护(#moro-safe-reset 特异性高于 *)，连 *{display:none!important} 也盖不掉，
                        保证你刚粘进坏 CSS 当场崩掉时，这个还原键一定点得到。 */}
                    {createPortal(
                        <>
                            <style>{`#moro-safe-reset{position:fixed!important;top:calc(var(--safe-top) + 6px)!important;left:50%!important;transform:translateX(-50%)!important;visibility:visible!important;opacity:1!important;pointer-events:auto!important;display:flex!important;z-index:2147483647!important;}`}</style>
                            <button
                                id="moro-safe-reset"
                                onClick={() => { updateCharacter(char.id, { chromeCustomCss: '' } as any); addToast('已还原该角色白框', 'success'); }}
                                style={{
                                    position: 'fixed', top: 'calc(var(--safe-top) + 6px)', left: '50%', transform: 'translateX(-50%)',
                                    zIndex: 2147483647, display: 'flex', alignItems: 'center', gap: '4px',
                                    padding: '5px 12px', borderRadius: '999px',
                                    background: 'rgba(15,23,42,0.62)', color: '#fff', fontSize: '11px', fontWeight: 700,
                                    border: '1px solid rgba(255,255,255,0.3)', cursor: 'pointer', boxShadow: '0 2px 10px rgba(0,0,0,0.35)',
                                }}
                            >⟲ 还原此角色白框</button>
                        </>,
                        document.body,
                    )}
                </div>
            )}

            {/* 情绪设置已嵌入日程 Modal（与日程强制同步开/关），不再单独渲染 */}

            {/* 🍔 麦当劳小程序 - MCP 数据流按钮驱动, 协同聊天走主 pipeline (完整人设/记忆/日程) */}
            <McdMiniApp
                open={mcdAppOpen}
                onClose={() => setMcdAppOpen(false)}
                char={char}
                userProfile={userProfile}
                messages={messages}
                isTyping={isTyping}
                onSendMessage={handleMcdMiniAppSend}
                onStateChange={handleMcdMiniAppStateChange}
                onConfirmOrder={handleMcdAppConfirm}
            />


            {/* Forward Modal */}
            <Modal isOpen={showForwardModal} title="转交聊天记录" onClose={() => setShowForwardModal(false)}>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                    <p className="text-xs text-slate-400 mb-3">选择要把这几页转交给谁（已选 {selectedMsgIds.size} 条消息）</p>
                    {characters.filter(c => c.id !== activeCharacterId).map(c => (
                        <button
                            key={c.id}
                            onClick={() => handleForwardToCharacter(c.id)}
                            className="w-full flex items-center gap-3 p-3 rounded-2xl bg-slate-50 hover:bg-slate-100 active:scale-[0.98] transition-all border border-slate-100"
                        >
                            <img src={c.avatar} className="w-10 h-10 rounded-xl object-cover" />
                            <div className="flex-1 text-left">
                                <div className="font-bold text-sm text-slate-700">{c.name}</div>
                                <div className="text-[10px] text-slate-400 truncate">{c.description}</div>
                            </div>
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-slate-300"><path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" /></svg>
                        </button>
                    ))}
                    {characters.filter(c => c.id !== activeCharacterId).length === 0 && (
                        <div className="text-center text-xs text-slate-400 py-8">没有其他角色可以转发</div>
                    )}
                </div>
            </Modal>

            {/* 会话设置（聊天设置）全屏面板：右上角 ··· 进入 */}
            {modalType === 'chat-settings' && char && (
                <ConvoSettingsPanel
                    char={char}
                    onClose={() => setModalType('none')}
                    contextLimit={settingsContextLimit}
                    onContextLimitChange={setSettingsContextLimit}
                    hideSysLogs={settingsHideSysLogs}
                    onToggleHideSysLogs={() => {
                        const next = !settingsHideSysLogs;
                        setSettingsHideSysLogs(next);
                        updateCharacter(char.id, { hideSystemLogs: next });
                    }}
                    translationEnabled={translationEnabled}
                    onToggleTranslation={() => {
                        const next = !translationEnabled;
                        setTranslationEnabled(next);
                        localStorage.setItem(`chat_translate_enabled_${activeCharacterId}`, JSON.stringify(next));
                        if (!next) setShowingTargetIds(new Set());
                    }}
                    translateSourceLang={translateSourceLang}
                    translateTargetLang={translateTargetLang}
                    onSetTranslateSourceLang={(lang: string) => { setTranslateSourceLang(lang); localStorage.setItem(`chat_translate_source_lang_${activeCharacterId}`, lang); setShowingTargetIds(new Set()); }}
                    onSetTranslateLang={(lang: string) => { setTranslateTargetLang(lang); localStorage.setItem(`chat_translate_lang_${activeCharacterId}`, lang); setShowingTargetIds(new Set()); }}
                    onOpenHistoryManager={() => setModalType('history-manager')}
                    onClearHistory={handleClearHistory}
                    preserveContext={preserveContext}
                    onTogglePreserveContext={() => setPreserveContext(!preserveContext)}
                    isVectorizing={isVectorizing}
                    onForceVectorize={handleForceVectorize}
                    onExportChat={handleExportChat}
                    messagesCount={(allHistoryMessages && allHistoryMessages.length > 0) ? allHistoryMessages.length : messages.length}
                    onOpenChromeCss={() => setModalType('chrome-css')}
                    categories={categories}
                    emojiCounts={emojiCounts}
                    onSaveCategoryVisibility={handleSaveCategoryVisibility}
                    onBgUpload={handleBgUpload}
                    onRemoveBg={() => updateCharacter(char.id, { chatBackground: undefined })}
                />
            )}

            {/* 角色主页（微信好友资料页风格）：单击消息头像进入；角色设置入口移到 ··· / 朋友资料 */}
            {showCharProfile && char && (
                <CharacterProfilePage
                    char={char}
                    onBack={() => setShowCharProfile(false)}
                    onSendMessage={() => setShowCharProfile(false)}
                    onVoiceCall={() => { setShowCharProfile(false); openApp(AppID.Call); }}
                    onOpenSettings={() => {
                        setShowCharProfile(false);
                        try {
                            localStorage.setItem('moro_character_open_target', char.id);
                            // 返回键回到聊天页而非桌面
                            localStorage.setItem('moro_character_return_app', AppID.Chat);
                            // 返回后重新展开角色主页：返回键只回上一个页面（角色设定 → 角色资料）
                            localStorage.setItem('moro_chat_reopen_profile', char.id);
                        } catch {}
                        openApp(AppID.Character);
                    }}
                    onOpenMoments={() => {
                        // 朋友圈已并入聊天枢纽标签页（独立朋友圈 App 已改造为小红书）
                        setShowCharProfile(false);
                        try { localStorage.setItem('moro_chathub_open_tab', 'moments'); } catch { /* ignore */ }
                        openApp(AppID.GroupChat);
                    }}
                    onDeleted={() => { setShowCharProfile(false); openApp(AppID.GroupChat); }}
                />
            )}

            {/* 「你已将对方拉黑」弹窗：回到聊天界面时提示一次 */}
            {showUserBlockNotice && char && (
                <div className="absolute inset-0 z-[400] flex items-center justify-center bg-black/40 animate-fade-in" onClick={() => setShowUserBlockNotice(false)}>
                    <div className="w-[min(80vw,300px)] bg-white rounded-2xl overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
                        <div className="px-6 pt-6 pb-5 text-center">
                            <div className="w-10 h-10 mx-auto mb-3 rounded-full bg-[#fa5151] text-white text-xl font-bold flex items-center justify-center">!</div>
                            <div className="text-[16px] font-medium text-slate-800">已拉黑 {char.name}</div>
                            <div className="text-[13px] text-slate-500 mt-2 leading-relaxed">
                                你已将 TA 加入黑名单，无法继续私聊。TA 发来的消息仍会显示在聊天中，气泡旁带有红色感叹号。
                                可在「角色资料 → 朋友设置」解除拉黑。
                            </div>
                        </div>
                        <button
                            onClick={() => { void handlePeekBlockedChar(); }}
                            disabled={isTyping}
                            className="w-full py-3.5 text-[16px] text-[#fa5151] font-medium border-t border-slate-100 active:bg-slate-50 disabled:opacity-50"
                        >
                            看看 TA 在做什么
                        </button>
                        <button
                            onClick={() => setShowUserBlockNotice(false)}
                            className="w-full py-3.5 text-[16px] text-[#576b95] font-medium border-t border-slate-100 active:bg-slate-50"
                        >
                            知道了
                        </button>
                    </div>
                </div>
            )}

            {/* 「角色给你换备注」弹窗：点开看动机 */}
            {remarkChangeNotice && char && (
                <div className="absolute inset-0 z-[400] flex items-center justify-center bg-black/40 animate-fade-in p-6" onClick={() => setRemarkChangeNotice(null)}>
                    <div className="w-[min(82vw,320px)] bg-white rounded-3xl overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
                        <div className="px-6 pt-6 pb-5 text-center">
                            <img src={displayCharAvatar} className="w-12 h-12 mx-auto mb-3 rounded-full object-cover ring-2 ring-white shadow" alt="" />
                            <div className="text-[15px] font-bold text-slate-800">{displayCharName} 给你换了备注</div>
                            <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-indigo-50 border border-indigo-100">
                                <span className="text-[11px] text-indigo-400">现在叫你</span>
                                <span className="text-[14px] font-bold text-indigo-600">{remarkChangeNotice.remark}</span>
                            </div>
                            {remarkChangeNotice.motivation && (
                                remarkMotivationOpen ? (
                                    <div className="mt-4 rounded-2xl bg-slate-50 border border-slate-100 p-3.5 text-[13px] text-slate-600 leading-relaxed text-left animate-fade-in">
                                        {remarkChangeNotice.motivation}
                                    </div>
                                ) : (
                                    <button
                                        onClick={() => setRemarkMotivationOpen(true)}
                                        className="mt-4 text-[12px] text-indigo-500 font-bold active:scale-95 transition-transform"
                                    >
                                        TA 为什么这么改？ 💭
                                    </button>
                                )
                            )}
                        </div>
                        <button
                            onClick={() => setRemarkChangeNotice(null)}
                            className="w-full py-3.5 text-[15px] text-[#576b95] font-medium border-t border-slate-100 active:bg-slate-50"
                        >
                            知道了
                        </button>
                    </div>
                </div>
            )}

            {/* 查手机（用户 → 角色）：+ 号面板入口，内嵌原 CheckPhone */}
            {showCheckPhone && char && (
                <div className="absolute inset-0 z-[410]">
                    <CheckPhone initialCharId={char.id} onExit={() => setShowCheckPhone(false)} />
                </div>
            )}

            {/* 查手机（角色 → 用户）：界面变成用户桌面，角色自己翻看 + 想法框 */}
            {charPhoneCheckActive && char && (
                <CharPhoneCheckOverlay
                    char={char}
                    userProfile={userProfile}
                    characters={characters}
                    apiConfig={apiConfig}
                    updateCharacter={updateCharacter}
                    addToast={addToast}
                    onEnd={handleCharPhoneCheckEnd}
                />
            )}

            {/* 线下模式弹窗 */}
            {showOfflineMode && char && (
                <OfflineModeModal
                    char={char}
                    userProfile={userProfile}
                    apiConfig={apiConfig}
                    addToast={addToast}
                    onEnd={handleOfflineEnd}
                />
            )}

            {/* 被角色拉黑后的好友验证 */}
            {char && (
                <FriendVerifyModal
                    char={char}
                    isOpen={showFriendVerify}
                    onClose={() => setShowFriendVerify(false)}
                    onAccepted={() => { void reloadMessages(visibleCountRef.current); }}
                />
            )}
        </div>
    );
};

export default Chat;
