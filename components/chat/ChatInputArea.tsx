import React, { useRef, useState, useEffect } from 'react';
import { ArrowBendUpRight, BookBookmark, CalendarCheck, Camera, CassetteTape, Coins, Detective, EnvelopeOpen, EnvelopeSimple, Eraser, Hamburger, HandHeart, HandTap, Heart, ImageSquare, Lightbulb, Lock, MapTrifold, Microphone, PaintBrush, Paperclip, PencilSimple, PhoneOutgoing, Scissors, Scroll, StopCircle, Sticker, Trash, Wind, X } from '@phosphor-icons/react';
import { EmojiCategory, Emoji, OSTheme } from '../../types';
import { isIOSStandaloneWebApp } from '../../utils/iosStandalone';
import { inputAnimationSrc } from '../../utils/inputAnimationSvg';

interface ChatInputAreaProps {
    input: string;
    setInput: (v: string) => void;
    isTyping: boolean;
    selectionMode: boolean;
    showPanel: 'none' | 'actions' | 'emojis';
    setShowPanel: (v: 'none' | 'actions' | 'emojis') => void;
    onSend: () => void;
    onDeleteSelected: () => void;
    onForwardSelected?: () => void;
    selectedCount: number;
    emojis: Emoji[];
    /** 全量可见表情（不按当前分类过滤），表情面板搜索时跨分类匹配名字/描述。不传则只搜当前分类。 */
    allEmojis?: Emoji[];
    onPanelAction: (type: string, payload?: any) => void;
    onImageSelect: (file: File) => void;
    /** 用户录音语音消息：audio 是 data URI（webm/opus），transcript 来自录音时的实时语音识别（可能为空） */
    onSendVoice?: (audio: string, durationSec: number, transcript: string) => void;
    isSummarizing: boolean;
    // Categories Support
    categories?: EmojiCategory[];
    activeCategory?: string;
    // Reroll Support
    onReroll: () => void;
    canReroll: boolean;
    // Proactive messaging
    isProactiveActive?: boolean;
    // 麦当劳 MCP
    mcdConfigured?: boolean;   // 设置里 token 已填且启用
    mcdActivated?: boolean;    // 当前会话已发"麦请求"
    // 思考过程展示（会话级）
    showThinkingChain?: boolean;
    // Input style
    inputStyle?: 'default' | 'rounded' | 'flat' | 'wechat' | 'ios' | 'telegram' | 'discord' | 'pixel';
    sendButtonStyle?: 'circle' | 'pill' | 'minimal';
    chromeStyle?: 'soft' | 'flat' | 'floating' | 'pixel';
    /** 自定义输入框占位文案（会话设置「输入框文案」，默认 "说点什么…"） */
    inputPlaceholder?: string;
    /** 拼贴册·输入动效：贴在输入栏上的装饰动画（上传图片或 AI 写的 SVG）。 */
    inputAnimation?: OSTheme['chatInputAnimation'];
    /** 动森彩蛋模式：输入栏换成木质草绿圆角。 */
}

/** 文具盒纸条按钮：邮票图标格在左、标签 + 小注在右，开启中的功能点上火漆点 */
const ActionStrip: React.FC<{
    label: string;
    /** 一行小注：写明这条纸条干什么用 */
    hint?: string;
    onClick?: () => void;
    disabled?: boolean;
    /** 功能处于开启状态：墨色实底纸条 + 火漆点 */
    active?: boolean;
    /** 仅外观用墨色实底（不带火漆点），如幕后指令 */
    ink?: boolean;
    dark?: boolean;
    children: React.ReactNode;
}> = ({ label, hint, onClick, disabled, active, ink, dark, children }) => (
    <button
        onClick={onClick}
        disabled={disabled}
        className={`stationery-strip ${(active || ink) ? 'stationery-strip-ink' : ''} ${dark && !(active || ink) ? 'stationery-strip-dark' : ''} ${disabled ? 'opacity-40' : ''}`}
    >
        <div className="stamp-box">{children}</div>
        <div className="flex-1 min-w-0">
            <div className={`text-[12px] font-bold tracking-wide truncate ${(active || ink) ? 'text-white' : dark ? 'text-slate-200' : 'text-slate-700'}`}>{label}</div>
            {hint && <div className={`text-[9px] mt-0.5 truncate ${(active || ink) ? 'text-white/60' : dark ? 'text-slate-400' : 'text-slate-400'}`}>{hint}</div>}
        </div>
        {active && <span className="wax-dot" />}
    </button>
);

/** 文具盒分区标签：墨色小旗 + 缝线延伸 */
const DrawerTag: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="drawer-tag col-span-2"><span>{children}</span></div>
);

const ChatInputArea: React.FC<ChatInputAreaProps> = ({
    input, setInput, isTyping, selectionMode,
    showPanel, setShowPanel, onSend, onDeleteSelected, onForwardSelected, selectedCount,
    emojis, allEmojis,
    onPanelAction, onImageSelect, onSendVoice, isSummarizing,
    categories = [], activeCategory = 'default',
    onReroll, canReroll,
    isProactiveActive,
    mcdConfigured = false,
    mcdActivated = false,
    showThinkingChain = false,
    inputStyle = 'default',
    sendButtonStyle = 'circle',
    chromeStyle = 'soft',
    inputPlaceholder,
    inputAnimation,
}) => {
    const chatImageInputRef = useRef<HTMLInputElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [emojiSelectionMode, setEmojiSelectionMode] = useState(false);
    const [selectedEmojis, setSelectedEmojis] = useState<any[]>([]);
    const [emojiSearch, setEmojiSearch] = useState('');
    const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const startPos = useRef({ x: 0, y: 0 });
    const isLongPressTriggered = useRef(false); // Track if long press action fired
    const useIOSStandaloneInputFix = isIOSStandaloneWebApp();

    // 表情面板搜索：有关键词时跨分类匹配名字/描述（联动所有导入的表情包），否则按当前分类显示
    const emojiSearchTerm = emojiSearch.trim().toLowerCase();
    const displayedEmojis = emojiSearchTerm
        ? (allEmojis ?? emojis).filter(e =>
            e.name.toLowerCase().includes(emojiSearchTerm) ||
            (e.description || '').toLowerCase().includes(emojiSearchTerm))
        : emojis;

    // --- 语音消息录音（MediaRecorder + Web Speech API 实时转写）---
    const [isRecording, setIsRecording] = useState(false);
    const [recordSecs, setRecordSecs] = useState(0);
    const [liveTranscript, setLiveTranscript] = useState('');
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const recordChunksRef = useRef<Blob[]>([]);
    const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const recognitionRef = useRef<any>(null);
    const transcriptRef = useRef('');
    const recordCancelledRef = useRef(false);
    const MAX_RECORD_SECS = 60;

    const cleanupRecording = () => {
        if (recordTimerRef.current) { clearInterval(recordTimerRef.current); recordTimerRef.current = null; }
        try { recognitionRef.current?.stop(); } catch { /* ignore */ }
        recognitionRef.current = null;
        const rec = mediaRecorderRef.current;
        if (rec) {
            try { rec.stream.getTracks().forEach(t => t.stop()); } catch { /* ignore */ }
        }
        mediaRecorderRef.current = null;
        setIsRecording(false);
        setRecordSecs(0);
        setLiveTranscript('');
    };

    // 组件卸载（切角色/退出聊天）时确保麦克风被释放
    useEffect(() => () => cleanupRecording(), []);

    const startRecording = async () => {
        if (isRecording) return;
        let stream: MediaStream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch {
            onPanelAction('voice-record-denied');
            return;
        }
        recordChunksRef.current = [];
        transcriptRef.current = '';
        recordCancelledRef.current = false;
        const recorder = new MediaRecorder(stream);
        mediaRecorderRef.current = recorder;
        recorder.ondataavailable = (e) => { if (e.data.size > 0) recordChunksRef.current.push(e.data); };
        recorder.onstop = () => {
            const durationSec = Math.max(1, recordSecsRef.current);
            const cancelled = recordCancelledRef.current;
            const blob = new Blob(recordChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
            stream.getTracks().forEach(t => t.stop());
            if (!cancelled && blob.size > 0) {
                const reader = new FileReader();
                reader.onloadend = () => {
                    if (typeof reader.result === 'string') {
                        onSendVoice?.(reader.result, durationSec, transcriptRef.current.trim());
                    }
                };
                reader.readAsDataURL(blob);
            }
            cleanupRecording();
        };

        // 实时转写：浏览器支持 SpeechRecognition 时同步识别，识别文字随消息一起发给 AI。
        // 不支持（如 Firefox / 部分 WebView）时静默跳过，语音照发、只是没有转写。
        const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (SR) {
            try {
                const recognition = new SR();
                recognition.lang = 'zh-CN';
                recognition.continuous = true;
                recognition.interimResults = true;
                recognition.onresult = (event: any) => {
                    let finalText = '';
                    let interim = '';
                    for (let i = 0; i < event.results.length; i++) {
                        const r = event.results[i];
                        if (r.isFinal) finalText += r[0].transcript;
                        else interim += r[0].transcript;
                    }
                    transcriptRef.current = finalText + interim;
                    setLiveTranscript(transcriptRef.current);
                };
                recognition.onerror = () => { /* 转写失败不影响录音 */ };
                recognition.start();
                recognitionRef.current = recognition;
            } catch { /* ignore */ }
        }

        recorder.start();
        setIsRecording(true);
        setRecordSecs(0);
        recordSecsRef.current = 0;
        recordTimerRef.current = setInterval(() => {
            recordSecsRef.current += 1;
            setRecordSecs(recordSecsRef.current);
            if (recordSecsRef.current >= MAX_RECORD_SECS) stopRecording(true);
        }, 1000);
    };
    const recordSecsRef = useRef(0);

    const stopRecording = (send: boolean) => {
        const rec = mediaRecorderRef.current;
        if (!rec) { cleanupRecording(); return; }
        recordCancelledRef.current = !send;
        if (recordTimerRef.current) { clearInterval(recordTimerRef.current); recordTimerRef.current = null; }
        try { recognitionRef.current?.stop(); } catch { /* ignore */ }
        if (rec.state !== 'inactive') {
            try { rec.stop(); return; } catch { /* fallthrough */ }
        }
        cleanupRecording();
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            // 空输入回车 = 触发 AI 回复：发完消息后输入框留空再按一次回车即可让角色接话/恢复生成
            if (!input.trim()) {
                if (!isTyping) onPanelAction('trigger-ai');
                return;
            }
            onSend();
        }
    };

    const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>, type: 'chat' | 'bg') => {
        const file = e.target.files?.[0];
        if (file) {
            onImageSelect(file);
        }
        if (e.target) e.target.value = ''; // Reset
    };

    // --- Unified Touch/Long-Press Logic ---
    
    const clearTimer = () => {
        if (longPressTimer.current) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
        }
    };

    const handleTouchStart = (item: any, type: 'emoji' | 'category', e: React.TouchEvent | React.MouseEvent) => {
        // 1. Always reset state first to ensure clean slate for any interaction
        // This fixes the bug where deleting a category leaves the flag true, blocking clicks on system categories
        clearTimer(); 
        isLongPressTriggered.current = false;

        // 2. Skip long-press for the default category (no options needed)
        if (type === 'category' && item.id === 'default') return;
        
        // 3. Store coordinates and start timer for valid long-press candidates
        if ('touches' in e) {
            startPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        } else {
            startPos.current = { x: e.clientX, y: e.clientY };
        }

        longPressTimer.current = setTimeout(() => {
            isLongPressTriggered.current = true;
            // Trigger action
            if (type === 'emoji') {
                if (!emojiSelectionMode) {
                    setEmojiSelectionMode(true);
                    setSelectedEmojis([item]);
                }
            } else {
                onPanelAction('category-options', item);
            }
        }, 500); // 500ms threshold
    };

    const handleTouchMove = (e: React.TouchEvent | React.MouseEvent) => {
        if (!longPressTimer.current) return;

        let clientX, clientY;
        if ('touches' in e) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else {
            clientX = e.clientX;
            clientY = e.clientY;
        }

        const diffX = Math.abs(clientX - startPos.current.x);
        const diffY = Math.abs(clientY - startPos.current.y);

        // Cancel long press if moved more than 10px (scrolling)
        if (diffX > 10 || diffY > 10) {
            clearTimer();
        }
    };

    const handleTouchEnd = () => {
        clearTimer();
    };

    // Wrapper for Click to prevent conflicts
    const handleItemClick = (e: React.MouseEvent, item: any, type: 'emoji' | 'category') => {
        // If long press action triggered, block the click event (do not send)
        if (isLongPressTriggered.current) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }

        // If click happens, ensure timer is cleared (prevents "Send then Pop up" ghost issue)
        clearTimer();

        if (type === 'emoji') {
            if (emojiSelectionMode) {
                setSelectedEmojis(prev => {
                    const exists = prev.find(e => e.url === item.url);
                    if (exists) return prev.filter(e => e.url !== item.url);
                    return [...prev, item];
                });
            } else {
                onPanelAction('send-emoji', item);
            }
        } else {
            onPanelAction('select-category', item.id);
        }
    };

    const handleInputFocus = () => {
        if (!useIOSStandaloneInputFix) return;
        setShowPanel('none');
        const textarea = textareaRef.current;
        if (!textarea) return;
        window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
                if (document.activeElement !== textarea) return;
                try {
                    textarea.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                } catch {
                    // Older iOS builds can throw on unsupported scroll options.
                }
            });
        });
    };

    React.useEffect(() => {
        if (showPanel !== 'emojis') {
            setEmojiSelectionMode(false);
            setSelectedEmojis([]);
        }
    }, [showPanel]);

    React.useEffect(() => {
        if (!emojiSelectionMode) {
            setSelectedEmojis([]);
        }
    }, [emojiSelectionMode]);

    React.useEffect(() => {
        if (emojiSelectionMode) {
            setSelectedEmojis(prev => prev.filter(se => emojis.some(e => e.url === se.url)));
        }
    }, [emojis]);

    const isDiscordStyle = inputStyle === 'discord';
    const isPixelStyle = inputStyle === 'pixel' || chromeStyle === 'pixel';
    const shellClass = chromeStyle === 'pixel'
        ? 'bg-[#eadfce] border-t-[3px] border-[#8f674a] shadow-[0_-4px_0_rgba(123,90,64,0.15)]'
        : chromeStyle === 'flat'
          ? 'bg-white border-t border-slate-200 shadow-none'
          : chromeStyle === 'floating'
            ? 'bg-white/80 backdrop-blur-2xl border-t border-white/60 shadow-[0_-12px_30px_rgba(148,163,184,0.18)]'
            // 默认输入栏（黑白手帐）：白色圆顶卡片悬浮感，与顶栏呼应
            : 'bg-white/95 backdrop-blur-2xl rounded-t-[1.75rem] shadow-[0_-14px_30px_-18px_rgba(50,48,60,0.3)]';
    const actionButtonClass = isPixelStyle
        ? 'w-11 h-11 shrink-0 rounded-[4px] border-2 border-[#8f674a] bg-[#f8f0e0] flex items-center justify-center text-[#8f674a] hover:bg-[#fff7ed] transition-colors'
        : isDiscordStyle
          ? 'w-11 h-11 shrink-0 rounded-full bg-slate-800 flex items-center justify-center text-slate-200 hover:bg-slate-700 transition-colors'
          // 默认 + 按钮：裸墨色图标，无底色（参考图左下角的极简加号）
          : 'w-11 h-11 shrink-0 rounded-full flex items-center justify-center text-slate-700 hover:bg-slate-100 transition-colors';
    const inputWrapClass =
        inputStyle === 'rounded'
            ? 'bg-[#f4f4f6] rounded-full'
            : inputStyle === 'flat'
              ? 'bg-transparent border-b border-slate-200 rounded-none'
              : inputStyle === 'wechat'
                ? 'bg-white border border-slate-200 rounded-full'
                : inputStyle === 'ios'
                  ? 'bg-white/80 border border-white/80 shadow-inner rounded-[26px]'
                  : inputStyle === 'telegram'
                    ? 'bg-white border border-sky-100 rounded-2xl'
                    : inputStyle === 'discord'
                      ? 'bg-slate-800 border border-white/10 rounded-2xl text-white'
                      : inputStyle === 'pixel'
                        ? 'bg-[#f8f0e0] border-2 border-[#8f674a] rounded-[4px]'
                        : 'bg-slate-100 rounded-[24px]';
    const sendButtonClass = sendButtonStyle === 'pill'
            ? isPixelStyle
                ? 'h-11 min-w-[72px] shrink-0 rounded-[4px] border-2 border-[#8f674a] bg-[#c99872] px-4 text-[11px] font-bold text-[#fff7ed]'
                : 'h-11 min-w-[72px] shrink-0 rounded-full bg-primary px-4 text-[11px] font-bold text-white shadow-lg'
            : sendButtonStyle === 'minimal'
              ? isPixelStyle
                ? 'w-11 h-11 shrink-0 rounded-[4px] border-2 border-[#8f674a] bg-[#c99872] text-[#fff7ed] flex items-center justify-center'
                : isDiscordStyle
                  ? 'w-11 h-11 shrink-0 rounded-full bg-transparent text-sky-300 flex items-center justify-center'
                  : 'w-11 h-11 shrink-0 rounded-full bg-transparent text-primary flex items-center justify-center'
              : isPixelStyle
                ? 'w-11 h-11 shrink-0 rounded-[4px] border-2 border-[#8f674a] bg-[#c99872] text-[#fff7ed] flex items-center justify-center'
                : 'w-11 h-11 shrink-0 rounded-full bg-primary text-white flex items-center justify-center transition-all shadow-lg';
    const panelClass = isPixelStyle
        ? 'bg-[#f8f0e0] border-t-2 border-[#8f674a]'
        : isDiscordStyle
          ? 'bg-slate-900/95 border-t border-white/10'
          : 'bg-slate-50 border-t border-slate-200/60';
    const panelTopBarClass = isPixelStyle
        ? 'h-10 bg-[#eadfce] border-b-2 border-[#8f674a] flex items-center px-2 gap-2 overflow-x-auto no-scrollbar shrink-0'
        : isDiscordStyle
          ? 'h-10 bg-slate-950 border-b border-white/10 flex items-center px-2 gap-2 overflow-x-auto no-scrollbar shrink-0'
          : 'h-10 bg-white border-b border-slate-100 flex items-center px-2 gap-2 overflow-x-auto no-scrollbar shrink-0';
    const inactiveCategoryClass = isPixelStyle
        ? 'bg-[#f3e7d6] text-[#8f674a] border border-[#8f674a]/30'
        : isDiscordStyle
          ? 'bg-slate-800 text-slate-300 border border-white/10'
          : 'bg-slate-100 text-slate-500 border border-transparent';
    const activeCategoryClass = isPixelStyle
        ? 'bg-[#c99872] text-[#fff7ed] font-bold border border-[#8f674a]'
        : isDiscordStyle
          ? 'bg-indigo-500 text-white font-bold border border-indigo-400/60 shadow-sm'
          : 'bg-primary text-white font-bold shadow-sm border border-transparent';
    const categoryAddButtonClass = isPixelStyle
        ? 'w-6 h-6 rounded-full border border-[#8f674a] bg-[#f8f0e0] text-[#8f674a] flex items-center justify-center shrink-0 hover:bg-[#fff7ed]'
        : isDiscordStyle
          ? 'w-6 h-6 rounded-full border border-white/10 bg-slate-800 text-slate-300 flex items-center justify-center shrink-0 hover:bg-slate-700'
          : 'w-6 h-6 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center shrink-0 hover:bg-slate-200';
    const emojiImportTileClass = isPixelStyle
        ? 'aspect-square bg-[#fff7ed] rounded-2xl border-2 border-dashed border-[#8f674a]/40 flex items-center justify-center text-2xl text-[#8f674a]'
        : isDiscordStyle
          ? 'aspect-square bg-slate-800 rounded-2xl border-2 border-dashed border-slate-700 flex items-center justify-center text-2xl text-slate-400'
          : 'aspect-square bg-slate-100 rounded-2xl border-2 border-dashed border-slate-300 flex items-center justify-center text-2xl text-slate-400';
    const emojiTileClass = isPixelStyle
        ? 'bg-[#fff7ed] rounded-2xl p-2 border-2 border-[#8f674a]/20 shadow-sm relative active:scale-95 transition-transform select-none flex flex-col items-center'
        : isDiscordStyle
          ? 'bg-slate-800 rounded-2xl p-2 border border-white/10 shadow-sm relative active:scale-95 transition-transform select-none flex flex-col items-center'
          : 'bg-white rounded-2xl p-2 shadow-sm relative active:scale-95 transition-transform select-none flex flex-col items-center';
    const emojiLabelClass = isPixelStyle
        ? 'text-[#8f674a]'
        : isDiscordStyle
          ? 'text-slate-400'
          : 'text-slate-400';

    const selectedEmojiUrls = emojiSelectionMode ? new Set(selectedEmojis.map(se => se.url)) : new Set();

    return (
        <>
        {emojiSelectionMode && (
            <div className={`fixed inset-0 z-[-1] ${isPixelStyle ? 'bg-[#eadfce]/70 backdrop-blur-[2px]' : isDiscordStyle ? 'bg-slate-950/70 backdrop-blur-[2px]' : 'bg-white/60 backdrop-blur-[2px]'}`} />
        )}
        {/* 语音消息录音浮层 */}
        {isRecording && (
            <div className="fixed inset-0 z-[120] flex flex-col items-center justify-end pb-24" style={{ background: 'rgba(28,27,34,0.35)', backdropFilter: 'blur(6px)' }}>
                <div className="w-72 bg-white/95 backdrop-blur-xl rounded-[2rem] shadow-[0_30px_60px_-20px_rgba(40,38,50,0.45)] border border-white/60 p-6 flex flex-col items-center gap-4">
                    <span className="text-[9px] font-mono font-bold tracking-[0.35em] text-slate-300 uppercase">Voice&nbsp;Letter</span>
                    <div className="relative">
                        <div className="absolute inset-0 rounded-full bg-slate-400/25 animate-ping" />
                        <div className="relative w-16 h-16 rounded-full bg-slate-900 flex items-center justify-center shadow-[0_12px_24px_-10px_rgba(15,23,42,0.55)]">
                            <Microphone className="w-7 h-7 text-white" weight="fill" />
                        </div>
                    </div>
                    <div className="text-2xl font-bold text-slate-700 tabular-nums tracking-wider">{Math.floor(recordSecs / 60)}:{String(recordSecs % 60).padStart(2, '0')}</div>
                    {liveTranscript ? (
                        <div className="max-h-16 w-full overflow-y-auto no-scrollbar text-xs text-slate-500 text-center leading-relaxed">{liveTranscript}</div>
                    ) : (
                        <div className="text-xs text-slate-400">声音正落在纸上……说完就封进信封</div>
                    )}
                    <div className="flex gap-3 w-full">
                        <button onClick={() => stopRecording(false)} className="flex-1 py-3 rounded-2xl bg-slate-100 text-slate-500 font-bold flex items-center justify-center gap-1 active:scale-[0.97] transition-transform">
                            <X className="w-5 h-5" weight="bold" /> 揉掉
                        </button>
                        <button onClick={() => stopRecording(true)} className="flex-1 py-3 rounded-2xl bg-slate-900 text-white font-bold flex items-center justify-center gap-1 shadow-lg shadow-slate-300 active:scale-[0.97] transition-transform">
                            <StopCircle className="w-5 h-5" weight="fill" /> 封好寄出
                        </button>
                    </div>
                </div>
            </div>
        )}
        <div className={`moro-chat-inputbar ${shellClass} pb-safe shrink-0 z-40 relative`}>
            {/* 拼贴册·输入动效：贴在输入栏上的装饰（上传图片或 AI 写的 SVG） */}
            {inputAnimation?.data && !selectionMode && (() => {
                const src = inputAnimationSrc(inputAnimation);
                if (!src) return null;
                const op = inputAnimation.opacity ?? 0.9;
                const pos = inputAnimation.position || 'corner';
                const base: React.CSSProperties = { position: 'absolute', pointerEvents: 'none', userSelect: 'none', zIndex: 5 };
                const style: React.CSSProperties = pos === 'top'
                    ? { ...base, left: 0, right: 0, top: -12, height: 28, width: '100%', objectFit: 'contain', opacity: op }
                    : pos === 'background'
                        ? { ...base, inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: Math.min(op, 0.4) }
                        : { ...base, right: 12, top: -24, height: 50, width: 'auto', opacity: op, animation: 'moroInputFloat 3.2s ease-in-out infinite' };
                return (
                    <>
                        <style>{`@keyframes moroInputFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}`}</style>
                        <img src={src} alt="" aria-hidden className="max-w-none" style={style} />
                    </>
                );
            })()}

            {selectionMode ? (
                <div className={`p-3 flex gap-2 ${isPixelStyle ? 'bg-[#f3e7d6]' : isDiscordStyle ? 'bg-slate-900/60 backdrop-blur-md' : 'bg-white/50 backdrop-blur-md'}`}>
                    {onForwardSelected && (
                        <button
                            onClick={onForwardSelected}
                            disabled={selectedCount === 0}
                            className={`flex-1 py-3 font-bold rounded-2xl active:scale-95 transition-all flex items-center justify-center gap-2 ${selectedCount === 0 ? 'bg-slate-200 text-slate-400' : 'bg-[#2b2933] text-white shadow-lg shadow-slate-300/70'}`}
                            style={selectedCount === 0 ? undefined : { outline: '1px dashed rgba(255,255,255,0.35)', outlineOffset: '-4px' }}
                        >
                            <ArrowBendUpRight className="w-5 h-5" weight="bold" />
                            转交 {selectedCount} 条
                        </button>
                    )}
                    <button
                        onClick={onDeleteSelected}
                        className={`${onForwardSelected ? 'flex-1' : 'w-full'} py-3 bg-white text-red-500 font-bold rounded-2xl border border-red-200 shadow-sm active:scale-95 transition-transform flex items-center justify-center gap-2`}
                        style={{ outline: '1px dashed rgba(239,68,68,0.4)', outlineOffset: '-4px' }}
                    >
                        <Scissors className="w-5 h-5" weight="bold" />
                        撕掉 {selectedCount} 条
                    </button>
                </div>
            ) : (
                <div className="p-3 px-4 flex gap-3 items-end relative">
                    {/* 左外侧：贴纸册（原表情面板）。文具盒入口挪进输入框右内侧的回形针 */}
                    <button onClick={() => setShowPanel(showPanel === 'emojis' ? 'none' : 'emojis')} className={actionButtonClass}>
                        <Sticker className="w-6 h-6" weight={showPanel === 'emojis' ? 'fill' : 'bold'} />
                    </button>
                    <div className={`flex-1 min-w-0 flex items-center px-1 transition-all ${useIOSStandaloneInputFix ? 'overflow-visible' : 'overflow-hidden'} ${inputWrapClass} ${isPixelStyle ? 'focus-within:bg-[#fff7ed]' : isDiscordStyle ? 'focus-within:bg-slate-800 focus-within:border-white/20' : 'border border-transparent focus-within:bg-white focus-within:border-primary/30'}`}>
                        <textarea 
                            ref={textareaRef}
                            rows={1} 
                            value={input} 
                            onChange={(e) => setInput(e.target.value)} 
                            onKeyDown={handleKeyDown} 
                            onFocus={handleInputFocus}
                            inputMode="text"
                            enterKeyHint="send"
                            autoCorrect="on"
                            autoCapitalize="sentences"
                            className={`flex-1 min-w-0 bg-transparent px-4 py-3 ${useIOSStandaloneInputFix ? 'text-[16px]' : 'text-[15px]'} resize-none max-h-24 no-scrollbar ${isDiscordStyle ? 'text-white placeholder:text-slate-500' : isPixelStyle ? 'text-[#6a4c35] placeholder:text-[#9b8677]' : ''}`} 
                            placeholder={inputPlaceholder || '说点什么…'}
                            style={{ height: 'auto' }} 
                        />
                        {/* 输入框内右侧：回形针 = 别上点什么（文具盒功能面板） */}
                        <button onClick={() => setShowPanel(showPanel === 'actions' ? 'none' : 'actions')} className={`p-2 shrink-0 transition-transform ${showPanel === 'actions' ? 'rotate-45' : ''} ${isDiscordStyle ? 'text-slate-400 hover:text-sky-300' : isPixelStyle ? 'text-[#8f674a] hover:text-[#a16207]' : 'text-slate-400 hover:text-slate-700'}`}>
                            <Paperclip className="w-6 h-6" weight={showPanel === 'actions' ? 'bold' : 'regular'} />
                        </button>
                    </div>
                    {(() => {
                        // 空输入时的默认圆钮 = 灰色爱心（参考图右下角），点按触发 AI 回复；输入后变实色纸飞机
                        const idleHeart = !input.trim() && sendButtonStyle !== 'pill' && !isPixelStyle && !isDiscordStyle;
                        return (
                    <button
                        onClick={() => {
                            // 空输入点发送 = 触发 AI 回复（与空输入回车一致），不再拦截提交
                            if (!input.trim()) {
                                if (!isTyping) onPanelAction('trigger-ai');
                                return;
                            }
                            onSend();
                        }}
                        className={idleHeart
                            ? 'w-11 h-11 shrink-0 rounded-full flex items-center justify-center text-slate-300 hover:text-rose-300 transition-colors'
                            : `${sendButtonClass} ${input.trim() ? '' : 'opacity-70'}`}
                    >
                        {sendButtonStyle === 'pill'
                            ? <span>寄出</span>
                            : idleHeart
                              ? <Heart className="w-7 h-7" weight="fill" />
                              : <EnvelopeSimple className="w-5 h-5" weight="fill" />}
                    </button>
                        );
                    })()}

                    {emojiSelectionMode && (
                        <div className={`absolute inset-0 z-10 ${isPixelStyle ? 'bg-[#eadfce]/70 backdrop-blur-[2px]' : isDiscordStyle ? 'bg-slate-950/70 backdrop-blur-[2px]' : 'bg-white/60 backdrop-blur-[2px]'}`} />
                    )}
                </div>
            )}

            {/* Panels — always mounted, height transitions for smooth open/close */}
            {!selectionMode && (
                <div
                    className={`moro-chat-panel ${panelClass} overflow-hidden relative z-0 flex flex-col will-change-[max-height] transition-[max-height] duration-200 ease-out`}
                    style={{ maxHeight: showPanel !== 'none' ? '18rem' : '0px' }}
                >
                    
                    {/* Emojis Panel with Categories */}
                    {showPanel === 'emojis' && (
                        <>
                            {/* Categories Bar */}
                            <div className="relative">
                                <div className={panelTopBarClass}>
                                    {categories.map(cat => (
                                        <button 
                                            key={cat.id} 
                                            onClick={(e) => handleItemClick(e, cat, 'category')}
                                            // Long press handlers for Categories
                                            onTouchStart={(e) => handleTouchStart(cat, 'category', e)}
                                            onTouchMove={handleTouchMove}
                                            onTouchEnd={handleTouchEnd}
                                            onMouseDown={(e) => handleTouchStart(cat, 'category', e)}
                                            onMouseMove={handleTouchMove}
                                            onMouseUp={handleTouchEnd}
                                            onMouseLeave={handleTouchEnd}
                                            onContextMenu={(e) => e.preventDefault()}
                                            className={`px-3 py-1 text-xs rounded-full whitespace-nowrap transition-all select-none flex items-center gap-1 ${activeCategory === cat.id ? activeCategoryClass : inactiveCategoryClass}`}
                                        >
                                            {cat.name}
                                            {cat.allowedCharacterIds && cat.allowedCharacterIds.length > 0 && (
                                                <Lock className="w-3 h-3 opacity-60" weight="bold" />
                                            )}
                                        </button>
                                    ))}
                                    <button onClick={() => onPanelAction('add-category')} className={categoryAddButtonClass}>+</button>
                                    <div className="w-6 shrink-0 pointer-events-none" />
                                </div>
                                {emojiSelectionMode ? (
                                    <div 
                                        className={`absolute inset-0 z-10 flex items-center justify-end px-3 ${
                                            isPixelStyle ? 'bg-[#eadfce]/70 backdrop-blur-[2px]' : 
                                            isDiscordStyle ? 'bg-slate-950/70 backdrop-blur-[2px]' : 
                                            'bg-white/60 backdrop-blur-[2px]'
                                        }`}
                                    >
                                        <button 
                                            onClick={(e) => { e.stopPropagation(); setEmojiSelectionMode(false); }} 
                                            className={`w-6 h-6 rounded-full flex items-center justify-center transition-colors shadow-sm ${
                                                isPixelStyle ? 'bg-[#c99872] text-[#fff7ed] hover:bg-[#b07d57]' :
                                                isDiscordStyle ? 'bg-slate-700 text-slate-300 hover:bg-slate-600' :
                                                'bg-slate-200/80 text-slate-600 hover:bg-slate-300'
                                            }`}
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-3.5 h-3.5">
                                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                            </svg>
                                        </button>
                                    </div>
                                ) : (
                                    <div className="absolute right-0 top-0 bottom-0 z-10 flex items-center justify-end px-3 pointer-events-none">
                                        <button 
                                            onClick={(e) => { e.stopPropagation(); setEmojiSelectionMode(true); }} 
                                            className={`w-6 h-6 rounded-full flex items-center justify-center transition-colors shadow-sm pointer-events-auto ${
                                                isPixelStyle ? 'bg-[#c99872] text-[#fff7ed] hover:bg-[#b07d57]' :
                                                isDiscordStyle ? 'bg-slate-700 text-slate-300 hover:bg-slate-600' :
                                                'bg-white/90 text-slate-600 hover:bg-slate-100 backdrop-blur-sm border border-slate-200/50'
                                            }`}
                                        >
                                            <PencilSimple className="w-3.5 h-3.5" weight="bold" />
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* 表情搜索框：按名字/描述模糊搜索，命中时跨分类显示 */}
                            <div className="px-4 pt-2">
                                <input
                                    value={emojiSearch}
                                    onChange={e => setEmojiSearch(e.target.value)}
                                    placeholder="翻找贴纸：按名字或描述…"
                                    className={`w-full px-3 py-1.5 text-xs rounded-full outline-none border transition-colors ${
                                        isDiscordStyle ? 'bg-slate-800 border-slate-700 text-white placeholder:text-slate-500' :
                                        isPixelStyle ? 'bg-[#fff7ed] border-[#8f674a]/40 text-[#6a4c35] placeholder:text-[#9b8677]' :
                                        'bg-white border-slate-200 text-slate-700 placeholder:text-slate-400 focus:border-primary/40'
                                    }`}
                                />
                            </div>
                            <div className="flex-1 overflow-y-auto no-scrollbar p-4">
                                <div className="grid grid-cols-4 gap-3">
                                    {emojiSelectionMode ? (
                                        <button 
                                            onClick={() => {
                                                if (selectedEmojis.length > 0) {
                                                    onPanelAction('delete-emoji-req', selectedEmojis);
                                                }
                                            }} 
                                            disabled={selectedEmojis.length === 0}
                                            className={`${emojiImportTileClass} !bg-red-50 !border-red-400 !text-red-500 ${selectedEmojis.length === 0 ? 'opacity-40 cursor-not-allowed' : 'active:scale-95'}`}
                                        >
                                            <Trash className="w-8 h-8" weight="fill" />
                                        </button>
                                    ) : (
                                        <button onClick={() => onPanelAction('emoji-import')} className={`${emojiImportTileClass} flex-col gap-1`}>
                                            <Sticker className="w-7 h-7" weight="bold" />
                                            <span className="text-[9px] font-bold tracking-widest">收集</span>
                                        </button>
                                    )}
                                    {displayedEmojis.map((e, i) => {
                                        const isSelected = selectedEmojiUrls.has(e.url);
                                        return (
                                        <button 
                                            key={i} 
                                            onClick={(ev) => handleItemClick(ev, e, 'emoji')}
                                            // Long press handlers for Emojis
                                            onTouchStart={(ev) => handleTouchStart(e, 'emoji', ev)}
                                            onTouchMove={handleTouchMove}
                                            onTouchEnd={handleTouchEnd}
                                            onMouseDown={(ev) => handleTouchStart(e, 'emoji', ev)}
                                            onMouseMove={handleTouchMove}
                                            onMouseUp={handleTouchEnd}
                                            onMouseLeave={handleTouchEnd}
                                            onContextMenu={(ev) => ev.preventDefault()}
                                            className={`${emojiTileClass} ${isSelected ? '!border-blue-500' : ''}`}
                                        >
                                            <div className="aspect-square w-full">
                                                <img src={e.url} className="w-full h-full object-contain pointer-events-none" />
                                            </div>
                                            <span className={`text-[9px] truncate w-full text-center mt-0.5 leading-tight pointer-events-none ${emojiLabelClass}`}>{e.name}</span>
                                            {isSelected && <div className="absolute inset-0 bg-blue-500/20 rounded-2xl pointer-events-none border-2 border-blue-500" />}
                                        </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </>
                    )}

                    {/* 文具盒面板：分区滚动抽屉（原翻页加号面板重构版，功能一项不少） */}
                    {showPanel === 'actions' && (
                        <div className="overflow-y-auto no-scrollbar">
                          <div className="scrap-panel stationery-grid px-4 py-4 grid grid-cols-2 gap-x-3 gap-y-2.5">
                            <DrawerTag>寄 给 T A</DrawerTag>

                            <ActionStrip label="寄零花" hint="塞张零花钱或红包" dark={isDiscordStyle} onClick={() => onPanelAction('transfer')}>
                                <Coins className="w-5 h-5" weight="bold" />
                            </ActionStrip>

                            {/* 「设置」已迁移到聊天页右上角齿轮按钮（ChatHeaderShell.onOpenChatSettings） */}
                            <ActionStrip label="贴照片" hint="从相册挑一张寄去" dark={isDiscordStyle} onClick={() => chatImageInputRef.current?.click()}>
                                <ImageSquare className="w-5 h-5" weight="bold" />
                            </ActionStrip>
                            <input type="file" ref={chatImageInputRef} className="hidden" accept="image/*" onChange={(e) => handleImageChange(e, 'chat')} />

                            <ActionStrip label="留个声" hint="录一段声音随信寄出" dark={isDiscordStyle} onClick={() => { setShowPanel('none'); startRecording(); }}>
                                <CassetteTape className="w-5 h-5" weight="bold" />
                            </ActionStrip>

                            <ActionStrip label="落脚点" hint="告诉 TA 你此刻在哪" dark={isDiscordStyle} onClick={() => onPanelAction('location')}>
                                <MapTrifold className="w-5 h-5" weight="bold" />
                            </ActionStrip>

                            <ActionStrip label="画一张" hint="描述画面，画好寄去" dark={isDiscordStyle} onClick={() => onPanelAction('image-gen')}>
                                <PaintBrush className="w-5 h-5" weight="bold" />
                            </ActionStrip>

                            <ActionStrip label="碰一碰" hint="轻轻戳 TA 一下" dark={isDiscordStyle} onClick={() => onPanelAction('poke')}>
                                <HandTap className="w-5 h-5" weight="bold" />
                            </ActionStrip>

                            <DrawerTag>两 个 人 的 事</DrawerTag>

                            {/* 语音通话：用户主动拨语音电话，角色按人设决定接不接 */}
                            <ActionStrip label="拨过去" hint="现在就想听 TA 说话" dark={isDiscordStyle} onClick={() => onPanelAction('voice-call')}>
                                <PhoneOutgoing className="w-5 h-5" weight="bold" />
                            </ActionStrip>

                            {/* 赴约：用户主动发起线下模式（原桌面独立「见面」App 并入此处，与聊天设置「自动线下」共用线下模式） */}
                            <ActionStrip label="赴个约" hint="放下手机，线下见面" dark={isDiscordStyle} onClick={() => onPanelAction('offline-date')}>
                                <HandHeart className="w-5 h-5" weight="bold" />
                            </ActionStrip>

                            {/* 翻翻手机：查看当前角色的手机（原桌面独立 App 并入此处） */}
                            <ActionStrip label="翻翻手机" hint="偷偷看一眼 TA 的屏幕" dark={isDiscordStyle} onClick={() => onPanelAction('check-phone')}>
                                <Detective className="w-5 h-5" weight="bold" />
                            </ActionStrip>

                            {/* 拍张照：用 TA 的手机拍一张此刻寄给 TA 看，一起讨论 */}
                            <ActionStrip label="拍张照" hint="用 TA 的手机拍下此刻" dark={isDiscordStyle} onClick={() => onPanelAction('camera')}>
                                <Camera className="w-5 h-5" weight="bold" />
                            </ActionStrip>

                            <ActionStrip label="悄悄来信" hint="让 TA 时不时主动找你" dark={isDiscordStyle} active={isProactiveActive} onClick={() => onPanelAction('proactive')}>
                                <EnvelopeOpen className="w-5 h-5" weight="bold" />
                            </ActionStrip>

                            <ActionStrip label="TA 的日常" hint="看看 TA 自己的生活轨迹" dark={isDiscordStyle} onClick={() => onPanelAction('life-recap')}>
                                <Scroll className="w-5 h-5" weight="bold" />
                            </ActionStrip>

                            <DrawerTag>这 本 手 帐</DrawerTag>

                            <ActionStrip label={isSummarizing ? '装订中…' : '装订成册'} hint="把聊天归档进记忆" dark={isDiscordStyle} onClick={() => onPanelAction('archive')}>
                                <BookBookmark className="w-5 h-5" weight="bold" />
                            </ActionStrip>

                            <ActionStrip label="重写一遍" hint="擦掉上一条回复重来" dark={isDiscordStyle} onClick={onReroll} disabled={!canReroll}>
                                <Eraser className="w-5 h-5" weight="bold" />
                            </ActionStrip>

                            {/* 回神：觉得 TA「说话的味道」跑偏了 → 让 ta 自己暂停、第一人称审视、悄悄校准回来 */}
                            <ActionStrip label="回个神" hint="TA 跑味了？让 ta 自己校准" dark={isDiscordStyle} onClick={() => onPanelAction('recenter')}>
                                <Wind className="w-5 h-5" weight="bold" />
                            </ActionStrip>

                            {/* 情绪按钮已并入作息 — 情绪/意识流与日程强制同步，配置面板在日程 Modal 下方 */}
                            <ActionStrip label="今日作息" hint="TA 的日程与心情" dark={isDiscordStyle} onClick={() => onPanelAction('schedule')}>
                                <CalendarCheck className="w-5 h-5" weight="bold" />
                            </ActionStrip>

                            {/* 偷看心声入口已移至顶栏角色头像（点头像查看心声/好感/心情） */}

                            <DrawerTag>特 别 通 道</DrawerTag>

                            <ActionStrip
                              label={mcdActivated ? '收摊点单' : '麦麦点单'}
                              hint={mcdActivated ? '结束这次麦当劳点单' : '麦当劳外送（需配置）'}
                              dark={isDiscordStyle}
                              active={mcdActivated}
                              disabled={!mcdConfigured}
                              onClick={() => {
                                if (!mcdConfigured) { onPanelAction('mcd-not-configured'); return; }
                                onPanelAction(mcdActivated ? 'mcd-end' : 'mcd-request');
                              }}
                            >
                                <Hamburger className="w-5 h-5" weight="bold" />
                            </ActionStrip>

                            {/* 思绪按钮：tap → 直接打开思考链设置弹窗（含开关），不再做 inline toggle */}
                            <ActionStrip
                              label={showThinkingChain ? '思绪可见中' : '看看思绪'}
                              hint="展示 TA 的思考过程"
                              dark={isDiscordStyle}
                              active={showThinkingChain}
                              onClick={() => onPanelAction('thinking-settings')}
                            >
                                <Lightbulb className="w-5 h-5" weight="bold" />
                            </ActionStrip>

                            {/* 幕后指令：用户以系统身份下达最高优先级指令（暂停扮演 / 生成番外 / 指定角色行为等） */}
                            <ActionStrip label="幕后指令" hint="以系统身份改写剧本" dark={isDiscordStyle} ink onClick={() => onPanelAction('system-command')}>
                                <Scroll className="w-5 h-5" weight="bold" />
                            </ActionStrip>
                          </div>
                        </div>
                     )}
                </div>
            )}
        </div>
        </>
    );
};

export default React.memo(ChatInputArea);
