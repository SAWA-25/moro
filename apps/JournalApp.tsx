
import React, { useState, useEffect, useRef } from 'react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { CharacterProfile, DiaryEntry, StickerData, DiaryPage, MemoryFragment } from '../types';
import { ContextBuilder } from '../utils/context';
import { processImage } from '../utils/file';
import Modal from '../components/os/Modal';
import { normalizeMessageContent } from '../utils/messageFormat';
import { injectMemoryPalace, ingestDiaryToPalace, type DiaryIngestResult } from '../utils/memoryPalace/pipeline';
import { getRoomLabel } from '../utils/memoryPalace/types';
import { Sparkle, Archive } from '@phosphor-icons/react';
import { getDiaryDateStr, callDiaryLLM } from './diaryShared';
import { resolveAuxApi } from '../utils/auxApi';

// 拼贴手账重制：界面文案 / 布局 / 按键全部原创，功能、数据模型、LLM 契约、score_card 结构均不变。

const TWEMOJI_BASE = `${import.meta.env.BASE_URL}vendor/twemoji/72x72`;
const twemojiUrl = (codepoint: string) => `${TWEMOJI_BASE}/${codepoint}.png`;
const PAPER_FIBER_TEXTURE = 'radial-gradient(rgba(80,70,58,0.2) 0.7px, transparent 0.9px), radial-gradient(rgba(80,70,58,0.12) 0.5px, transparent 0.7px)';
const CARDBOARD_TEXTURE = 'repeating-linear-gradient(12deg, rgba(255,255,255,0.05) 0 1px, transparent 1px 12px), repeating-linear-gradient(92deg, rgba(0,0,0,0.08) 0 1px, transparent 1px 18px)';

// --- Assets & Constants ---

// 信纸：id 持久化不可改（落库 + 卡片回显都按 id 找），只换显示名与拼贴质感配色。
const PAPER_STYLES = [
    { id: 'plain', name: '奶白', css: 'bg-[#fbfaf7]', text: 'text-[#3b3833]' },
    { id: 'grid', name: '格子', css: 'bg-[#fffdf8]', text: 'text-[#3b3833]', style: { backgroundImage: 'linear-gradient(#e7e2d6 1px, transparent 1px), linear-gradient(90deg, #e7e2d6 1px, transparent 1px)', backgroundSize: '20px 20px' } },
    { id: 'dot', name: '圆点', css: 'bg-[#fffdf5]', text: 'text-[#3b3833]', style: { backgroundImage: 'radial-gradient(#d8d2c4 1px, transparent 1px)', backgroundSize: '20px 20px' } },
    { id: 'lined', name: '横格', css: 'bg-[#fefcf2]', text: 'text-[#3b3833]', style: { backgroundImage: 'repeating-linear-gradient(transparent, transparent 23px, #e9e3d4 23px, #e9e3d4 24px)' } },
    { id: 'dark', name: '夜色', css: 'bg-[#2b2933]', text: 'text-white/90' },
    { id: 'pink', name: '樱粉', css: 'bg-[#fdf2f4]', text: 'text-[#3b3833]', style: { backgroundImage: 'radial-gradient(#f4c9d2 2px, transparent 2px)', backgroundSize: '30px 30px' } },
];

const DEFAULT_STICKERS = [
    twemojiUrl('2728'), twemojiUrl('1f496'), twemojiUrl('1f338'), twemojiUrl('1f380'), twemojiUrl('1f370'),
    twemojiUrl('1f431'), twemojiUrl('1f436'), twemojiUrl('2601-fe0f'), twemojiUrl('1f319'), twemojiUrl('2b50'),
    twemojiUrl('1f3b5'), twemojiUrl('1f33f'), twemojiUrl('1f353'), twemojiUrl('1f9f8'), twemojiUrl('1f388'),
    twemojiUrl('1f48c'), twemojiUrl('1f4a4'), twemojiUrl('1f97a'), twemojiUrl('1f621'), twemojiUrl('1f62d'),
];

// HELPER: Get local date string YYYY-MM-DD（沿用公共实现，避免两套日记重复定义）
const getLocalDateStr = () => getDiaryDateStr();

// --- 拼贴小部件（纯装饰，pointer-events-none） ---

// 和纸胶带条：贴在卡片 / 纸页边缘
const Washi: React.FC<{ className?: string; style?: React.CSSProperties; tone?: 'rose' | 'cream' | 'ink' }> = ({ className = '', style, tone = 'cream' }) => {
    const grad = tone === 'rose'
        ? 'linear-gradient(100deg, rgba(216,98,91,0.34), rgba(216,98,91,0.16))'
        : tone === 'ink'
            ? 'linear-gradient(100deg, rgba(43,41,51,0.55), rgba(43,41,51,0.32))'
            : 'linear-gradient(100deg, rgba(255,255,255,0.7), rgba(233,225,209,0.5))';
    return (
        <span
            aria-hidden
            className={`pointer-events-none absolute ${className}`}
            style={{
                background: grad,
                borderLeft: '1px dashed rgba(160,156,146,0.5)',
                borderRight: '1px dashed rgba(160,156,146,0.5)',
                boxShadow: '0 1px 4px rgba(50,48,60,0.14)',
                ...style,
            }}
        />
    );
};

interface JournalAppProps {
    // 由合并后的「日记」App 注入的模式切换器，渲染在书架（根）页头部。
    tabSwitcher?: React.ReactNode;
}

const JournalApp: React.FC<JournalAppProps> = ({ tabSwitcher }) => {
    const { closeApp, characters, activeCharacterId, apiConfig, auxApiConfig, addToast, userProfile, updateCharacter, memoryPalaceConfig } = useOS();
    // 交换日记属「聊天以外」的功能：走副 API（未配置副 API 时 resolveAuxApi 自动回退主 API）
    const auxApi = { ...apiConfig, ...resolveAuxApi(auxApiConfig, apiConfig) };

    const [mode, setMode] = useState<'select' | 'calendar' | 'write'>('select');
    const [selectedChar, setSelectedChar] = useState<CharacterProfile | null>(null);
    const [diaries, setDiaries] = useState<DiaryEntry[]>([]);
    const [currentEntry, setCurrentEntry] = useState<DiaryEntry | null>(null);
    const [selectedDate, setSelectedDate] = useState<string>(getLocalDateStr());

    // Editor State
    const [isThinking, setIsThinking] = useState(false);
    const [archivingId, setArchivingId] = useState<string | null>(null);
    const [archiveResult, setArchiveResult] = useState<{
        date: string;
        charName: string;
        summary: string;
        summaryOrigin: 'palace_bullets' | 'prose_fallback';
        palace: DiaryIngestResult | null;
    } | null>(null);
    const [showStickerPanel, setShowStickerPanel] = useState(false);
    const [activeTab, setActiveTab] = useState<'user' | 'char'>('user'); // View Tab
    const [hideCharStickers, setHideCharStickers] = useState(false); // Toggle to hide char stickers

    // Sticker Interaction State
    const [draggingSticker, setDraggingSticker] = useState<string | null>(null);
    const [selectedStickerId, setSelectedStickerId] = useState<string | null>(null); // For resizing/deleting
    const [resizingSticker, setResizingSticker] = useState<string | null>(null);
    const paperRef = useRef<HTMLDivElement>(null);

    // Custom Stickers State (Separate from Chat Emojis)
    const [customStickers, setCustomStickers] = useState<{name: string, url: string}[]>([]);
    const [showImportModal, setShowImportModal] = useState(false);
    const [importText, setImportText] = useState('');
    const [deletingSticker, setDeletingSticker] = useState<{name: string, url: string} | null>(null);
    const [deletingDiary, setDeletingDiary] = useState<DiaryEntry | null>(null);
    const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // --- Data Loading ---

    useEffect(() => {
        // 合并后的「日记」App 里，本模式作为一个 Tab 嵌入：根页（书架）要承载模式切换器，
        // 所以嵌入时不自动跳进某个角色的日历，停在书架页让用户能切到「合写本子」。
        if (!tabSwitcher && characters.length > 0 && activeCharacterId) {
            const initial = characters.find(c => c.id === activeCharacterId);
            if (initial) {
                setSelectedChar(initial);
                setMode('calendar');
                loadDiaries(initial.id);
            }
        }
        // Load custom stickers from new journal store
        DB.getJournalStickers().then(setCustomStickers);
    }, [activeCharacterId]);

    const loadDiaries = async (charId: string) => {
        const list = await DB.getDiariesByCharId(charId);
        setDiaries(list.sort((a, b) => b.date.localeCompare(a.date)));
    };

    const handleCharSelect = (char: CharacterProfile) => {
        setSelectedChar(char);
        setMode('calendar');
        loadDiaries(char.id);
    };

    const openEntry = (date: string) => {
        const existing = diaries.find(d => d.date === date);
        if (existing) {
            setCurrentEntry(existing);
            // Default to char tab if they replied
            setActiveTab(existing.charPage ? 'char' : 'user');
        } else {
            // New Entry — 打 autoSync=true, 后续不在列表里显示手动归档按钮
            setCurrentEntry({
                id: `diary-${Date.now()}`,
                charId: selectedChar!.id,
                date: date,
                userPage: { text: '', paperStyle: 'grid', stickers: [] },
                timestamp: Date.now(),
                isArchived: false,
                autoSync: true,
            });
            setActiveTab('user');
        }
        setMode('write');
        setSelectedDate(date);
        setSelectedStickerId(null); // Reset selection
    };

    // --- Editor Logic ---

    const updatePage = (updates: Partial<DiaryEntry['userPage']>, side: 'user' | 'char' = 'user') => {
        if (!currentEntry) return;
        const targetPage = side === 'user' ? 'userPage' : 'charPage';

        // If char page doesn't exist yet, init it
        let pageData = currentEntry[targetPage] || { text: '', paperStyle: 'plain', stickers: [] };

        setCurrentEntry(prev => {
            if (!prev) return null;
            return {
                ...prev,
                [targetPage]: { ...pageData, ...updates }
            };
        });
    };

    const addSticker = (url: string) => {
        const side = activeTab;
        const targetPage = side === 'user' ? currentEntry?.userPage : currentEntry?.charPage;
        if (!targetPage && side === 'char') return;

        const newSticker: StickerData = {
            id: `st-${Date.now()}-${Math.random()}`,
            url,
            x: 50,
            y: 50,
            rotation: (Math.random() - 0.5) * 40,
            scale: 1.0 // Default scale
        };

        const currentStickers = targetPage?.stickers || [];
        updatePage({ stickers: [...currentStickers, newSticker] }, side);
        setShowStickerPanel(false);
    };

    const handleImportStickers = async () => {
        if (!importText.trim()) return;
        const lines = importText.split('\n');
        let count = 0;
        for (const line of lines) {
            const parts = line.split('--');
            if (parts.length >= 2) {
                const name = parts[0].trim();
                const url = parts.slice(1).join('--').trim();
                if (name && url) {
                    await DB.saveJournalSticker(name, url); // Changed Store
                    count++;
                }
            }
        }
        setCustomStickers(await DB.getJournalStickers()); // Changed Store
        setImportText('');
        setShowImportModal(false);
        addToast(`贴好了 ${count} 张新贴纸`, 'success');
    };

    const handleDeleteStickerAsset = async () => {
        if (deletingSticker) {
            await DB.deleteJournalSticker(deletingSticker.name); // Changed Store
            setCustomStickers(prev => prev.filter(s => s.name !== deletingSticker.name));
            setDeletingSticker(null);
            addToast('贴纸撕掉了', 'success');
        }
    };

    // 把一条 diary 序列化成 score_card payload（含纸张样式名等卡片显示需要的字段）
    const buildDiaryCardPayload = (entry: DiaryEntry, char: CharacterProfile) => {
        const userPaperName = PAPER_STYLES.find(p => p.id === entry.userPage.paperStyle)?.name || '奶白';
        const charPaperName = entry.charPage
            ? (PAPER_STYLES.find(p => p.id === entry.charPage!.paperStyle)?.name || '奶白')
            : '';
        return {
            type: 'diary_card',
            date: entry.date,
            charName: char.name,
            charAvatar: char.avatar || '',
            userName: userProfile.name,
            userText: entry.userPage.text,
            charText: entry.charPage?.text || '',
            userPaperStyle: entry.userPage.paperStyle,
            userPaperName,
            charPaperStyle: entry.charPage?.paperStyle || '',
            charPaperName,
            userStickerCount: entry.userPage.stickers?.length || 0,
            charStickerCount: entry.charPage?.stickers?.length || 0,
        };
    };

    // 把一条已有 charPage 的日记同步到聊天里（新建或更新 score_card）。
    // 没有 charPage → 不做任何事（单方面写的日记不进上下文，这是产品规则）。
    // 返回最终带 chatCardMessageId 的 entry，供调用方接着 setCurrentEntry/saveDiary。
    const syncDiaryCardToChat = async (entry: DiaryEntry, char: CharacterProfile): Promise<DiaryEntry> => {
        if (!entry.charPage) return entry;
        const cardData = buildDiaryCardPayload(entry, char);

        if (entry.chatCardMessageId) {
            try {
                await DB.updateMessage(entry.chatCardMessageId, JSON.stringify(cardData));
                await DB.updateMessageMetadata(entry.chatCardMessageId, prev => ({
                    ...(prev || {}),
                    scoreCard: cardData,
                    source: 'journal-exchange',
                }));
                return entry;
            } catch (e) {
                console.warn('🗒 [Journal] 已存在的卡片更新失败, 重新创建:', e);
            }
        }
        const newId = await DB.saveMessage({
            charId: char.id,
            role: 'system',
            type: 'score_card',
            content: JSON.stringify(cardData),
            metadata: { scoreCard: cardData, source: 'journal-exchange' },
        });
        return { ...entry, chatCardMessageId: newId };
    };

    const saveEntry = async () => {
        if (!currentEntry || !selectedChar) return;
        // 若该日记已经在聊天里有卡片（char 回复过 + 自动发送过），保存时同步更新卡片
        let toSave = currentEntry;
        if (currentEntry.chatCardMessageId && currentEntry.charPage) {
            toSave = await syncDiaryCardToChat(currentEntry, selectedChar);
        }
        await DB.saveDiary(toSave);
        if (toSave !== currentEntry) setCurrentEntry(toSave);
        await loadDiaries(toSave.charId);
        addToast('夹进本子了', 'success');
    };

    const handleDeleteDiary = async () => {
        if (!deletingDiary || !selectedChar) return;
        // 同步删除聊天里的卡片（如果之前发过）
        if (deletingDiary.chatCardMessageId) {
            try { await DB.deleteMessage(deletingDiary.chatCardMessageId); }
            catch (e) { console.warn('🗒 [Journal] 卡片删除失败 (可能已不存在):', e); }
        }
        await DB.deleteDiary(deletingDiary.id);
        await loadDiaries(selectedChar.id);
        setDeletingDiary(null);
        addToast('这一页撕掉了', 'success');
    };

    // --- Interaction Logic (Move, Resize, Delete) ---

    // 1. Selection
    const selectSticker = (e: React.MouseEvent | React.TouchEvent, id: string) => {
        e.stopPropagation();
        setSelectedStickerId(id);
    };

    // 2. Remove Sticker from Page
    const removeStickerFromPage = (id: string) => {
        const targetPage = activeTab === 'user' ? currentEntry?.userPage : currentEntry?.charPage;
        if (!targetPage) return;
        const updated = targetPage.stickers.filter(s => s.id !== id);
        updatePage({ stickers: updated }, activeTab);
        setSelectedStickerId(null);
    };

    // 3. Pointer Handlers (Move & Resize)
    const handlePointerDown = (e: React.PointerEvent, stickerId: string, action: 'move' | 'resize') => {
        // Allow editing on char page too now
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);

        if (action === 'move') {
            setDraggingSticker(stickerId);
            setSelectedStickerId(stickerId); // Select on drag start
        } else {
            setResizingSticker(stickerId);
        }
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        if ((!draggingSticker && !resizingSticker) || !paperRef.current || !currentEntry) return;

        const rect = paperRef.current.getBoundingClientRect();

        const targetPage = activeTab === 'user' ? currentEntry.userPage : currentEntry.charPage;
        if (!targetPage) return;

        // Logic for Moving
        if (draggingSticker) {
            const x = ((e.clientX - rect.left) / rect.width) * 100;
            const y = ((e.clientY - rect.top) / rect.height) * 100;
            const clampedX = Math.max(0, Math.min(100, x));
            const clampedY = Math.max(0, Math.min(100, y));

            const updatedStickers = targetPage.stickers.map(s =>
                s.id === draggingSticker ? { ...s, x: clampedX, y: clampedY } : s
            );
            updatePage({ stickers: updatedStickers }, activeTab);
        }

        // Logic for Resizing
        if (resizingSticker) {
            const sticker = targetPage.stickers.find(s => s.id === resizingSticker);
            if (!sticker) return;

            // Simple scale logic based on distance from center of sticker (simulated by pointer position relative to paper)
            const dx = (e.clientX - rect.left) - (sticker.x / 100 * rect.width);
            const dy = (e.clientY - rect.top) - (sticker.y / 100 * rect.height);
            const dist = Math.sqrt(dx*dx + dy*dy);

            // Assume 50px is scale 1
            const newScale = Math.max(0.2, Math.min(3.0, dist / 40));

            const updatedStickers = targetPage.stickers.map(s =>
                s.id === resizingSticker ? { ...s, scale: newScale } : s
            );
            updatePage({ stickers: updatedStickers }, activeTab);
        }
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        setDraggingSticker(null);
        setResizingSticker(null);
        e.currentTarget.releasePointerCapture(e.pointerId);
    };

    const handleBackgroundClick = () => {
        setSelectedStickerId(null); // Deselect when clicking background
    };

    // Long press handler for drawer items
    const handleDrawerTouchStart = (s: {name: string, url: string}) => {
        longPressTimer.current = setTimeout(() => {
            setDeletingSticker(s);
        }, 600);
    };

    const handleDrawerTouchEnd = () => {
        if (longPressTimer.current) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
        }
    };

    // --- AI Interaction ---

    const handleExchange = async () => {
        if (!currentEntry || !selectedChar || !auxApi.apiKey) {
            addToast('先写点什么，或去文具盒里配好 API', 'error');
            return;
        }
        if (!currentEntry.userPage.text.trim()) {
            addToast('先在左页写下今天吧', 'info');
            return;
        }

        setIsThinking(true);
        saveEntry();

        try {
            await injectMemoryPalace(selectedChar, undefined, currentEntry.userPage.text);
            let systemPrompt = ContextBuilder.buildCoreContext(selectedChar, userProfile);

            const styleOptions = PAPER_STYLES.map(p => p.id).join(', ');
            const defaultStickers = DEFAULT_STICKERS.join(' ');
            const customStickerContext = customStickers.length > 0
                ? `Custom Stickers (Name: URL): \n${customStickers.map(s => `- ${s.name}: ${s.url}`).join('\n')}`
                : '';

            const recentMsgs = await DB.getMessagesByCharId(selectedChar.id);
            const contextLimit = 30;
            // 用统一的 normalizeMessageContent 把消息转成可读文本，绝不能直接塞 m.content：
            // score_card（含上一次交换日记同步进来的卡片）的 content 是整段 JSON，里面带
            // charAvatar 的 base64 data URL + 双方日记全文。重新生成时这张卡已在历史里，
            // 直接 dump 原始 content 会把 base64 头像和 JSON 结构整个灌进 prompt，
            // 造成 token 异常膨胀。normalize 后日记卡会被压成一行摘要，不再泄漏 base64/JSON。
            const recentContext = recentMsgs.slice(-contextLimit).map(m => {
                const content = normalizeMessageContent(m, selectedChar.name, userProfile.name);
                return `[${new Date(m.timestamp).toLocaleTimeString()}] ${m.role === 'user' ? 'User' : 'You'}: ${content}`;
            }).join('\n');

            systemPrompt += `### [Exchange Diary Mode Instructions]
你正在和用户进行【交换日记】互动。

### 关键：最近发生的互动 (Recent Context)
这是你们最近在聊天软件或见面时的对话记录。请**务必**阅读这些记录，并在日记中提及今天发生的具体事情（例如聊过的话题、去过的地方、用户发过的图片）。
不要只写空泛的回复，还要说一些用户不知道的，你自己没有说过的想法，和你自己独立于用户经历过的今天的事情。
[RECENT LOGS START]
${recentContext}
[RECENT LOGS END]

### 任务
1. 阅读用户今天的日记 (${currentEntry.date})。
2. 以你的角色口吻写一篇**回复日记**。
   - 首先结合上文的聊天记录，回应用户的内容。
   - 最重要的是分享你的生活，此条为必须项**务必说至少一件用户不知道的，你今天做的事情，尽量与用户无关！用户希望看到角色完全独立的一面**。
   - 语言风格在符合设定的基础上，应该更加书面化和诗意，不过一切以角色性格优先。
3. 选择适合你心情的信纸和贴纸。

### 关于贴纸 (Stickers)
你可以使用默认的 Emoji，也可以使用【Custom Stickers】。
${customStickerContext}
如果要使用 Custom Sticker，请将 URL 直接放入返回的 stickers 数组中。

### 输出格式 (必须是纯 JSON)
Structure:
{
  "text": "日记正文...",
  "paperStyle": "one of: ${styleOptions}",
  "stickers": ["sticker1", "http://custom-sticker-url..."] (从默认列表或 Custom Stickers 中选0-3个)
}`;

            let content = await callDiaryLLM(auxApi, [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `Users Diary:\n${currentEntry.userPage.text}` },
            ], { temperature: 0.85 });
            content = content.replace(/```json/g, '').replace(/```/g, '').trim();

            let parsed;
            try {
                parsed = JSON.parse(content);
            } catch (e) {
                parsed = { text: content, paperStyle: 'plain', stickers: [] };
            }

            const charStickers: StickerData[] = (parsed.stickers || []).map((s: string) => ({
                id: `st-${Math.random()}`,
                url: s,
                x: Math.random() * 70 + 10,
                y: Math.random() * 70 + 10,
                rotation: (Math.random() - 0.5) * 40,
                scale: 1.0
            }));

            const charPage: DiaryPage = {
                text: parsed.text || '',
                paperStyle: PAPER_STYLES.find(p => p.id === parsed.paperStyle)?.id || 'plain',
                stickers: charStickers
            };

            const updatedEntry = { ...currentEntry, charPage };
            // 自动发送 / 同步到聊天：char 有回复 → 卡片落地到对应角色的聊天历史。
            // 重交换（同一日记重新让 char 写回复）会复用已有 chatCardMessageId 走更新而不是再创建一条。
            const synced = await syncDiaryCardToChat(updatedEntry, selectedChar);
            setCurrentEntry(synced);
            await DB.saveDiary(synced);
            await loadDiaries(selectedChar.id);
            setActiveTab('char');
            addToast('TA 回了一页 · 已塞进聊天', 'success');

        } catch (e: any) {
            addToast(`TA 没接住: ${e.message}`, 'error');
        } finally {
            setIsThinking(false);
        }
    };

    // 手动归档: 把一条日记总结成神经链接条目 (char.memories), 跟 chatapp 的自动归档对齐 —
    //   - 开了回忆标本馆: 走副 API extractMemoriesFromBuffer 一次提取多条 MemoryNode → 节点入馆,
    //     同一组节点 bullets 化拼成 MemoryFragment 写 char.memories (mood='diary_palace')。
    //     不再调主 API。神经链接里那条 bullets 跟标本馆节点严格一比一对应。
    //   - 没开回忆标本馆 / 副 API 缺失 / 副 API 没提取出: 回落主 API + 升级 prompt 出 150~300 字
    //     散文式总结 → 写 char.memories (mood='diary')。这条沿用老路径升级版。
    //
    // mood 用 'diary_palace' / 'diary' 跟 chatapp 自动归档的 'palace' 区分,
    // 避免被 mergePalaceFragmentsIntoMemories 误合并到当天聊天那条 palace bullets 里。
    // 召回链路不看 mood,只是元数据 / UI 徽章,所以两种 mood 都正常进 chat 上下文。
    const handleArchiveDiary = async (diary: DiaryEntry) => {
        if (!selectedChar || diary.isArchived) return;
        if (!auxApi.apiKey) { addToast('先去文具盒里配好 API', 'error'); return; }
        if (!diary.userPage.text.trim() && !diary.charPage?.text?.trim()) {
            addToast('空白页收不进记忆', 'info');
            return;
        }

        setArchivingId(diary.id);

        // 主 API 散文式总结 — 当标本馆没开 / 副 API 缺失 / 提取为空时的 fallback
        const generateProseSummary = async (): Promise<string> => {
            const baseContext = ContextBuilder.buildCoreContext(selectedChar, userProfile);
            const charPart = diary.charPage?.text?.trim() || '(对方没有回复)';
            const prompt = `${baseContext}

### [系统指令: 交换日记归档]
当前任务: 把这篇【交换日记】(日期 ${diary.date}) 总结成一段对你 (${selectedChar.name}) 长期有效的记忆。

### 输入内容
${userProfile.name} 的那页:
"""
${diary.userPage.text || '(空白页)'}
"""

你 (${selectedChar.name}) 的回复页:
"""
${charPart}
"""

### 输出要求
1. **第一人称**: 全程用"我"称呼自己,用"${userProfile.name}"称呼对方,不要写成第三视角叙述。
2. **要点齐全**: 至少覆盖以下信息 (有就写,没有就跳过,不要生造):
   - ${userProfile.name} 那天的关键事件 / 心情 / 提到的人或物
   - 我对这些内容的反应、共鸣、或心里没说出口的想法
   - 我在自己那页里分享的、属于我自己的事
   - 如果出现任何承诺、约定、未解决的疑问,都要点名记录下来 (这些以后可能要兑现)
3. **细节胜过抽象**: 多说具体的事 (人名、地点、物件、当时的情绪),少用"我们度过了美好的一天"这种空话。
4. **篇幅**: 150~300 字之间的一段中文叙述,不要分段,不要列表,不要任何前缀和标题,直接出叙述。
`;
            let s = await callDiaryLLM(auxApi, [{ role: 'user', content: prompt }], {
                temperature: 0.4,
                maxTokens: 1200,
            });
            s = s.replace(/^["'「『]|["'」』]$/g, '').trim();
            if (!s) throw new Error('归档总结为空');
            return s;
        };

        try {
            // 1. 如果开了标本馆,先走副 API 一次提取,成败决定神经链接走哪条路径
            let palaceResult: DiaryIngestResult | null = null;
            if (selectedChar.memoryPalaceEnabled) {
                try {
                    palaceResult = await ingestDiaryToPalace(
                        selectedChar,
                        diary.date,
                        diary.userPage.text,
                        diary.charPage?.text || '',
                        auxApi,
                        userProfile.name,
                    );
                } catch (e: any) {
                    console.warn('🏰 [Journal] 写入标本馆失败:', e);
                    palaceResult = null;
                }
            } else {
                palaceResult = { status: 'palace_disabled' };
            }

            // 2. 决定神经链接那条的 summary / mood
            //    标本馆成功 (status==='done' 且 nodes 非空) → bullets 化, mood='diary_palace'
            //    其它一切情况 → 主 API 散文 fallback, mood='diary'
            let summary: string;
            let mood: string;
            let summaryOrigin: 'palace_bullets' | 'prose_fallback';
            if (palaceResult && palaceResult.status === 'done' && palaceResult.nodes.length > 0) {
                summary = palaceResult.nodes
                    .map(n => `- ${(n.content || '').replace(/\n/g, ' ').trim()}`)
                    .filter(line => line.length > 2)
                    .join('\n');
                mood = 'diary_palace';
                summaryOrigin = 'palace_bullets';
            } else {
                summary = await generateProseSummary();
                mood = 'diary';
                summaryOrigin = 'prose_fallback';
            }

            // 3. 神经链接 (char.memories): date 对齐到日记当天
            const newMem: MemoryFragment = {
                id: `mem-diary-${Date.now()}`,
                date: diary.date,
                summary,
                mood,
            };
            updateCharacter(selectedChar.id, {
                memories: [...(selectedChar.memories || []), newMem],
            });

            // 4. 标记 isArchived 防止重复
            const updatedDiary: DiaryEntry = { ...diary, isArchived: true };
            await DB.saveDiary(updatedDiary);
            if (currentEntry?.id === diary.id) setCurrentEntry(updatedDiary);
            await loadDiaries(selectedChar.id);

            // 5. 弹窗展示归档全貌
            setArchiveResult({
                date: diary.date,
                charName: selectedChar.name,
                summary,
                summaryOrigin,
                palace: palaceResult,
            });
        } catch (e: any) {
            console.error(e);
            addToast(`没收进记忆: ${e.message}`, 'error');
        } finally {
            setArchivingId(null);
        }
    };

    // --- Renderers ---

    const renderPage = (page: DiaryPage, side: 'user' | 'char') => {
        const style = PAPER_STYLES.find(s => s.id === page.paperStyle) || PAPER_STYLES[0];
        const isInteractive = true; // Always interactive now for editing
        const isDark = style.id === 'dark';

        return (
            <div
                ref={side === activeTab ? paperRef : undefined}
                className={`relative w-full h-full transition-all duration-300 overflow-hidden ${style.css} flex flex-col touch-none`}
                style={{
                    ...style.style,
                    borderRadius: '6px',
                    boxShadow: '0 18px 40px -22px rgba(20,18,14,0.7), 0 2px 6px rgba(20,18,14,0.25)',
                }}
                onPointerMove={isInteractive && side === activeTab ? handlePointerMove : undefined}
                onPointerUp={isInteractive && side === activeTab ? handlePointerUp : undefined}
                onPointerLeave={isInteractive && side === activeTab ? handlePointerUp : undefined}
                onClick={handleBackgroundClick}
            >
                {/* 四角和纸胶带：把纸页"贴"在桌面上 */}
                <Washi tone={side === 'user' ? 'rose' : 'cream'} className="z-30" style={{ top: 14, left: -22, width: 78, height: 24, transform: 'rotate(-42deg)' }} />
                <Washi tone="cream" className="z-30" style={{ top: 14, right: -22, width: 78, height: 24, transform: 'rotate(42deg)' }} />

                {/* Content Container */}
                <div className="flex-1 p-6 pt-9 relative z-10 flex flex-col">
                    <div className="flex justify-between items-center mb-4 pb-2 shrink-0" style={{ borderBottom: isDark ? '1px dashed rgba(255,255,255,0.18)' : '1px dashed rgba(120,116,106,0.4)' }}>
                        <span className={`font-hand text-xl font-bold ${style.text}`} style={{ opacity: 0.8 }}>
                            {side === 'user' ? '我写的这页' : 'TA 回的这页'}
                        </span>
                        <span
                            className={`label-mono text-[9px] ${style.text}`}
                            style={{
                                opacity: 0.75,
                                padding: '3px 7px',
                                borderRadius: 4,
                                border: isDark ? '1px dashed rgba(255,255,255,0.25)' : '1px dashed rgba(120,116,106,0.45)',
                            }}
                        >
                            {currentEntry?.date}
                        </span>
                    </div>

                    <textarea
                        value={page.text}
                        onChange={e => updatePage({ text: e.target.value }, side)}
                        placeholder={side === 'user' ? '把今天写下来，随便几行也好……' : '这一页还空着，等 TA 来写……'}
                        className={`flex-1 w-full bg-transparent resize-none outline-none leading-loose text-[16px] font-normal ${style.text} placeholder:opacity-30 no-scrollbar`}
                        readOnly={isThinking}
                    />
                </div>

                {/* Stickers Layer */}
                {/* Check Hide Flag for Char Side */}
                {!(side === 'char' && hideCharStickers) && page.stickers.map(s => {
                    const isSelected = selectedStickerId === s.id;
                    const scale = s.scale || 1.0;

                    return (
                        <div
                            key={s.id}
                            onPointerDown={(e) => handlePointerDown(e, s.id, 'move')}
                            onClick={(e) => selectSticker(e, s.id)}
                            className={`absolute text-6xl select-none drop-shadow-md z-20 cursor-move ${draggingSticker === s.id ? 'opacity-90' : ''} transition-transform`}
                            style={{
                                left: `${s.x}%`,
                                top: `${s.y}%`,
                                transform: `translate(-50%, -50%) rotate(${s.rotation}deg) scale(${scale})`,
                                border: isSelected ? '2px dashed #d8625b' : 'none',
                                borderRadius: '8px',
                                padding: '4px'
                            }}
                        >
                            {s.url.startsWith('http') || s.url.startsWith('data') ? (
                                <img src={s.url} className="w-20 h-20 object-contain pointer-events-none" draggable={false} />
                            ) : s.url}

                            {/* Controls for Selected Sticker */}
                            {isSelected && (
                                <>
                                    {/* Delete Button (Top Right) */}
                                    <div
                                        className="absolute -top-3 -right-3 w-6 h-6 bg-[#b03a34] text-white rounded-full flex items-center justify-center text-xs shadow-md cursor-pointer pointer-events-auto"
                                        onClick={(e) => { e.stopPropagation(); removeStickerFromPage(s.id); }}
                                    >×</div>

                                    {/* Resize Handle (Bottom Right) */}
                                    <div
                                        className="absolute -bottom-2 -right-2 w-5 h-5 bg-[#2b2933] rounded-full border-2 border-white shadow-md cursor-nwse-resize pointer-events-auto"
                                        onPointerDown={(e) => handlePointerDown(e, s.id, 'resize')}
                                    ></div>
                                </>
                            )}
                        </div>
                    );
                })}

                {/* Paper Texture Overlay (Subtle) */}
                <div className="absolute inset-0 opacity-10 pointer-events-none z-0 mix-blend-multiply" style={{ backgroundImage: PAPER_FIBER_TEXTURE, backgroundSize: '18px 18px, 29px 29px' }}></div>
            </div>
        );
    };

    // 归档结果弹窗: 让用户清楚知道生成了哪些内容、被送去了哪里
    const archiveResultModal = archiveResult ? (() => {
        const p = archiveResult.palace;
        const userName = userProfile.name || '我';
        // 标本馆状态文案
        let palaceStatus: { tone: 'on' | 'off' | 'warn' | 'fail'; title: string; detail: string } = { tone: 'off', title: '', detail: '' };
        if (!p) {
            palaceStatus = { tone: 'fail', title: '回忆标本馆 · 写入失败', detail: '处理过程抛了异常，详情看控制台。往事柜已 fallback 走主 API 散文版，写入成功。' };
        } else if (p.status === 'palace_disabled') {
            palaceStatus = { tone: 'off', title: '回忆标本馆 · 没开', detail: `${archiveResult.charName} 没开回忆标本馆，走的是主 API 散文路径写往事柜。想让日记进入本地结构化记忆，去角色设置里打开"回忆标本馆"开关再收一次。` };
        } else if (p.status === 'lightllm_missing') {
            palaceStatus = { tone: 'warn', title: '回忆标本馆 · 副 API 没配', detail: '标本馆开着，但文具盒副 API 没填；没法做结构化抽取，往事柜已 fallback 走散文版。' };
        } else if (p.status === 'empty_input') {
            palaceStatus = { tone: 'warn', title: '回忆标本馆 · 内容是空的', detail: '日记两页都没有正文，没东西可收进馆。' };
        } else if (p.status === 'extracted_none') {
            palaceStatus = { tone: 'warn', title: '回忆标本馆 · 副 API 没抽出东西', detail: '副 API 读完日记，但没觉得有值得记的内容。往事柜已 fallback 走主 API 散文版写入。' };
        } else {
            palaceStatus = {
                tone: 'on',
                title: `回忆标本馆 · 收了 ${p.stored} 条${p.skipped > 0 ? `（另有 ${p.skipped} 条撞上已有记忆去重）` : ''}`,
                detail: '副 API 把日记拆成下面这几条结构化记忆并保存到本地，同一组内容也 bullet 化进了上面的往事柜。之后聊天召回时按本地文本语义命中。createdAt 已对齐到日记当天。',
            };
        }

        const palaceNodes = (p && p.status === 'done') ? p.nodes : [];

        return (
            <Modal
                isOpen={true}
                title={`收进记忆 · ${archiveResult.date}`}
                onClose={() => setArchiveResult(null)}
                footer={
                    <button onClick={() => setArchiveResult(null)} className="scrap-btn w-full py-3 font-bold">
                        合上本子
                    </button>
                }
            >
                <div className="space-y-3 text-sm text-[#4a463f] leading-relaxed max-h-[60vh] overflow-y-auto no-scrollbar pr-1">
                    {/* 顶部一行: 数据流向示意 */}
                    {archiveResult.summaryOrigin === 'palace_bullets' ? (
                        <div className="rounded-xl bg-gradient-to-r from-emerald-50 to-purple-50 border border-emerald-200/60 px-3 py-2 text-[11px] text-slate-600">
                            ✓ 这次同时进了 <b className="text-emerald-700">往事柜</b> 和 <b className="text-purple-700">回忆标本馆</b>，
                            两边拿的是 <b>同一组抽出来的内容</b> —— 副 API 抽的 MemoryNode 直接 bullet 化写进往事柜，跟 chatapp 自动归档一致。
                        </div>
                    ) : (
                        <div className="rounded-xl bg-emerald-50/70 border border-emerald-100 px-3 py-2 text-[11px] text-slate-600">
                            这次只进了 <b className="text-emerald-700">往事柜</b>，用主 API 生成的散文式总结。原因看下面"回忆标本馆"那块。
                        </div>
                    )}

                    {/* 往事柜 */}
                    <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 px-4 py-3 space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10px] font-bold tracking-widest uppercase text-emerald-700">● 往事柜 · char.memories</span>
                            <span className="text-[10px] text-emerald-600/70">写入 1 条 · 日期 {archiveResult.date}</span>
                            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">mood={archiveResult.summaryOrigin === 'palace_bullets' ? 'diary_palace' : 'diary'}</span>
                        </div>
                        <p className="text-[13px] text-slate-700 leading-relaxed whitespace-pre-wrap" style={{ fontFamily: archiveResult.summaryOrigin === 'palace_bullets' ? 'inherit' : 'ui-serif, Georgia, serif' }}>
                            {archiveResult.summary}
                        </p>
                        <p className="text-[10px] text-emerald-700/70">
                            ↑ 这条会进「{archiveResult.charName}」的往事柜（本月日账），自动跟聊天上下文一起送进 LLM。
                            {archiveResult.summaryOrigin === 'palace_bullets'
                                ? ' 每个 bullet 都对应下面回忆标本馆里的一个标本。'
                                : ''}
                        </p>
                    </div>

                    {/* 回忆标本馆 */}
                    <div className={`rounded-2xl border px-4 py-3 space-y-2 ${
                        palaceStatus.tone === 'on' ? 'border-purple-100 bg-purple-50/70'
                        : palaceStatus.tone === 'off' ? 'border-slate-100 bg-slate-50'
                        : palaceStatus.tone === 'warn' ? 'border-amber-100 bg-amber-50/70'
                        : 'border-red-100 bg-red-50/70'
                    }`}>
                        <div className={`text-[10px] font-bold tracking-widest uppercase ${
                            palaceStatus.tone === 'on' ? 'text-purple-700'
                            : palaceStatus.tone === 'off' ? 'text-slate-500'
                            : palaceStatus.tone === 'warn' ? 'text-amber-700'
                            : 'text-red-600'
                        }`}>
                            ◆ {palaceStatus.title}
                        </div>
                        <p className="text-[12px] text-slate-600">{palaceStatus.detail}</p>
                        {palaceNodes.length > 0 && (
                            <div className="space-y-1.5 pt-1">
                                {palaceNodes.map((n, i) => (
                                    <div key={i} className="rounded-xl bg-white/80 border border-purple-100 px-3 py-2">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">{getRoomLabel(n.room, userName)}</span>
                                            <span className="text-[9px] font-mono text-purple-500/70">重要度 {n.importance}/10</span>
                                            {n.mood && <span className="text-[9px] text-slate-400">· {n.mood}</span>}
                                        </div>
                                        <p className="text-[12px] text-slate-700 leading-snug">{n.content}</p>
                                        {n.tags?.length > 0 && (
                                            <div className="flex flex-wrap gap-1 mt-1.5">
                                                {n.tags.slice(0, 6).map((t, ti) => (
                                                    <span key={ti} className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">#{t}</span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </Modal>
        );
    })() : null;

    // ============ 视图：书架（选角色 / 选本子）============
    if (mode === 'select') {
        return (
            <div className="h-full w-full flex flex-col font-light" style={{ background: '#f4f2ed', backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(120,116,106,0.06) 1px, transparent 0)', backgroundSize: '16px 16px' }}>
                {archiveResultModal}
                {/* 牛皮纸页眉 + 蕾丝下边 */}
                <div className="relative pt-12 pb-3 px-5 shrink-0 z-20 box-border" style={{ background: '#efe9dc', borderBottom: '1px solid rgba(180,172,156,0.5)' }}>
                    <div className="flex items-center justify-between">
                        <button onClick={closeApp} className="scrap-btn-paper w-9 h-9 flex items-center justify-center" aria-label="返回">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5 text-[#2b2933]"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
                        </button>
                        {tabSwitcher || <span className="font-hand text-2xl font-bold text-[#2b2933]">本子架</span>}
                        <div className="w-9"></div>
                    </div>
                    <div className="lace-edge absolute left-0 right-0 -bottom-[10px]"></div>
                </div>

                <p className="font-hand text-lg text-[#a79c8e] px-6 pt-5 pb-1">挑一个人，翻开你们的本子 ✎</p>

                <div className="p-5 grid grid-cols-2 gap-5 overflow-y-auto pb-24 no-scrollbar">
                    {characters.map((c, i) => (
                        <div
                            key={c.id}
                            onClick={() => handleCharSelect(c)}
                            className={`scrap-card press-soft relative aspect-[3/4] p-4 flex flex-col items-center justify-center gap-3 cursor-pointer ${i % 2 ? 'tilt-r' : 'tilt-l'}`}
                            style={{ borderRadius: '4px 14px 14px 4px' }}
                        >
                            {/* 书脊 */}
                            <div className="absolute inset-y-0 left-0 w-3" style={{ background: 'linear-gradient(90deg, rgba(43,41,51,0.16), transparent)' }}></div>
                            {/* 顶部和纸胶带 */}
                            <Washi tone="rose" style={{ top: -8, left: '50%', width: 64, height: 18, transform: 'translateX(-50%) rotate(-3deg)' }} />
                            {/* 拍立得头像 */}
                            <div className="bg-white p-1 pb-3 shadow-md border border-[#ece9e2] rotate-[-2deg]">
                                <img src={c.avatar} className="w-16 h-16 object-cover" />
                            </div>
                            <span className="font-hand text-lg font-bold text-[#2b2933] text-center leading-tight">{c.name}</span>
                            <span className="label-mono text-[8px] text-[#a79c8e]">open me</span>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    // ============ 视图：某角色的日历 / 日记列表 ============
    if (mode === 'calendar' && selectedChar) {
        return (
            <div className="h-full w-full flex flex-col font-light relative" style={{ background: '#f4f2ed', backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(120,116,106,0.06) 1px, transparent 0)', backgroundSize: '16px 16px' }}>
                {archiveResultModal}
                {/* 墨色封面页眉：拍立得头像 + 手写名字 */}
                <div className="relative pt-12 pb-7 px-5 shrink-0 z-20" style={{ background: '#2b2933' }}>
                    <button onClick={() => setMode('select')} className="scrap-btn-paper w-9 h-9 flex items-center justify-center" aria-label="返回">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5 text-[#2b2933]"><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" /></svg>
                    </button>
                    <div className="flex items-center gap-3 mt-4">
                        <div className="bg-white p-1 pb-2 shadow-lg rotate-[-3deg] shrink-0">
                            <img src={selectedChar.avatar} className="w-14 h-14 object-cover" />
                        </div>
                        <div className="min-w-0">
                            <div className="label-mono text-[9px] text-white/50">our exchange diary</div>
                            <div className="font-hand text-3xl font-bold text-white truncate">{selectedChar.name}</div>
                        </div>
                    </div>
                    <div className="lace-edge absolute left-0 right-0 -bottom-[9px]"></div>
                </div>

                <div className="flex-1 overflow-y-auto p-5 pt-7 pb-28 no-scrollbar">
                    {diaries.length === 0 && (
                        <div className="flex flex-col items-center gap-2 pt-20 text-center">
                            <span className="text-5xl rotate-[-6deg]">✑</span>
                            <p className="font-hand text-xl text-[#8b8996]">这本还是空的</p>
                            <p className="font-hand text-base text-[#a79c8e]">按右下角的印章，贴上第一页吧</p>
                        </div>
                    )}
                    <div className="space-y-4">
                        {diaries.map((d, i) => (
                            <div
                                key={d.id}
                                onClick={() => openEntry(d.date)}
                                className={`scrap-card press-soft relative flex items-center gap-3 p-3 pl-4 cursor-pointer ${i % 2 ? 'tilt-r' : 'tilt-l'}`}
                            >
                                {/* 日期邮戳格 */}
                                <div className="shrink-0 w-14 h-14 flex flex-col items-center justify-center" style={{ background: '#f6f4ef', outline: '1px dashed rgba(120,116,106,0.5)', outlineOffset: '-3px', borderRadius: 9 }}>
                                    <span className="label-mono text-[8px] text-[#a79c8e] leading-none">{d.date.split('-')[1]} 月</span>
                                    <span className="font-display-italic text-2xl text-[#2b2933] leading-none mt-0.5">{d.date.split('-')[2]}</span>
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm text-[#4a463f] truncate">{d.userPage.text || '（这页还没写字……）'}</p>
                                    <div className="flex gap-1.5 items-center mt-1.5 flex-wrap">
                                        <span className="label-mono text-[9px] text-[#a79c8e]">{d.date.split('-')[0]}</span>
                                        {d.charPage && <span className="text-[9px] font-bold px-2 py-0.5 rounded-full" style={{ background: '#e7f3ec', color: '#3f8c66', border: '1px dashed rgba(63,140,102,0.4)' }}>TA 回了</span>}
                                        {d.chatCardMessageId && <span className="text-[9px] font-bold px-2 py-0.5 rounded-full" style={{ background: '#2b2933', color: '#fff' }}>进了聊天</span>}
                                        {d.isArchived && <span className="text-[9px] font-bold px-2 py-0.5 rounded-full" style={{ background: '#f6e4e2', color: '#b03a34', border: '1px dashed rgba(176,58,52,0.4)' }}>收进记忆</span>}
                                    </div>
                                </div>
                                {/* 归档入口统一在"点进日记后的右上角印章". 列表只留撕页按钮, 不重复入口. */}
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setDeletingDiary(d);
                                    }}
                                    className="w-8 h-8 rounded-full text-[#a79c8e] hover:text-[#b03a34] hover:bg-[#f6e4e2] transition-colors flex items-center justify-center shrink-0"
                                    title="撕掉这一页"
                                    aria-label="撕掉这一页"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-4 h-4">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                                    </svg>
                                </button>
                            </div>
                        ))}
                    </div>
                </div>

                {/* 写今天：右下角圆印章按钮（位置从顶部大按钮挪到悬浮印章） */}
                <button
                    onClick={() => openEntry(getLocalDateStr())}
                    className="scrap-btn absolute bottom-6 right-6 z-30 w-[68px] h-[68px] flex flex-col items-center justify-center gap-0.5"
                    style={{ rotate: '-5deg' }}
                    aria-label="写今天的日记"
                >
                    <span className="text-2xl leading-none">✎</span>
                    <span className="font-hand text-xs font-bold">写今天</span>
                </button>

                <Modal
                    isOpen={!!deletingDiary}
                    title="撕掉这一页"
                    onClose={() => setDeletingDiary(null)}
                    footer={
                        <div className="flex gap-2 w-full">
                            <button onClick={() => setDeletingDiary(null)} className="scrap-btn-paper flex-1 py-3 font-bold">留着</button>
                            <button onClick={handleDeleteDiary} className="flex-1 py-3 bg-[#b03a34] text-white rounded-full font-bold active:scale-95 transition-transform">撕掉</button>
                        </div>
                    }
                >
                    <p className="text-sm text-[#4a463f]">
                        确定撕掉 {deletingDiary?.date} 这一页吗？撕了就贴不回去了。
                    </p>
                </Modal>
            </div>
        );
    }

    // --- WRITE MODE ---
    return (
        <div className="h-full w-full flex flex-col relative overflow-hidden" style={{ background: '#26241f', backgroundImage: CARDBOARD_TEXTURE, backgroundSize: '28px 28px, 36px 36px' }}>
            {archiveResultModal}

            {/* Editor Header（书桌上方工具条） */}
            <div className="pt-12 pb-3 px-4 flex items-center justify-between shrink-0 z-30 h-24 box-border" style={{ background: 'rgba(31,29,25,0.85)', backdropFilter: 'blur(8px)' }}>
                <button onClick={() => setMode('calendar')} className="scrap-btn-paper w-9 h-9 flex items-center justify-center" aria-label="返回">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5 text-[#2b2933]"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
                </button>
                <div className="flex items-center gap-2">
                    {/* Toggle Char Sticker Visibility Button */}
                    {activeTab === 'char' && (
                        <button
                            onClick={() => setHideCharStickers(!hideCharStickers)}
                            className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${hideCharStickers ? 'bg-[#b03a34]/25 text-[#e8a39d]' : 'bg-white/10 text-white/60'}`}
                            title={hideCharStickers ? '让贴纸露出来' : '先把贴纸藏起来'}
                        >
                            {hideCharStickers ? (
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" /></svg>
                            ) : (
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /></svg>
                            )}
                        </button>
                    )}

                    {currentEntry?.chatCardMessageId && (
                        <div className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-300 flex items-center gap-1" title="这一页已自动同步为聊天卡片">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
                            进了聊天
                        </div>
                    )}
                    {currentEntry?.isArchived && (
                        <div className="px-2.5 py-1 rounded-full text-[10px] font-bold flex items-center gap-1" style={{ background: 'rgba(176,58,52,0.18)', color: '#e8a39d' }} title="这一页已收进往事柜">
                            <Archive size={11} weight="fill" />
                            收过了
                        </div>
                    )}
                    {/* 老日记 (本次更新前留下的, autoSync 未设) 且角色已回复 → 右上角出现"收进记忆"印章.
                        新日记走自动同步聊天那条线, 不显示这个按钮防止重复入库. */}
                    {currentEntry && !currentEntry.autoSync && currentEntry.charPage && !currentEntry.isArchived && (
                        <button
                            onClick={() => handleArchiveDiary(currentEntry)}
                            disabled={archivingId === currentEntry.id}
                            className={`px-3 py-1.5 rounded-full text-xs font-bold shadow-lg transition-all flex items-center gap-1.5 ${archivingId === currentEntry.id ? 'bg-[#7a3531] text-[#e8c7c3] cursor-wait' : 'bg-[#b03a34] text-white hover:bg-[#c2453e] active:scale-95'}`}
                            title={'把这页老日记收进往事柜' + (selectedChar?.memoryPalaceEnabled ? ' / 回忆标本馆' : '')}
                        >
                            {archivingId === currentEntry.id ? (
                                <>
                                    <div className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin"></div>
                                    收着…
                                </>
                            ) : (
                                <>
                                    <Archive size={12} weight="fill" />
                                    收进记忆
                                </>
                            )}
                        </button>
                    )}
                    <button onClick={saveEntry} className="scrap-btn px-4 h-9 flex items-center gap-1.5 text-xs font-bold">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
                        夹好
                    </button>
                </div>
            </div>

            {/* Main Page Area */}
            <div className="flex-1 relative w-full overflow-hidden flex flex-col">
                <div className="flex-1 w-full max-w-xl mx-auto px-3 pb-3 pt-3 flex flex-col relative">
                    <div className="flex-1 relative transition-all duration-500">
                        {activeTab === 'user' && currentEntry && renderPage(currentEntry.userPage, 'user')}

                        {activeTab === 'char' && (
                            currentEntry?.charPage ? renderPage(currentEntry.charPage, 'char') : (
                                <div className="w-full h-full flex flex-col items-center justify-center text-white/50 gap-4 p-8 text-center" style={{ background: '#f4f1ea', borderRadius: 6, boxShadow: '0 18px 40px -22px rgba(20,18,14,0.7)' }}>
                                    <Washi tone="rose" style={{ top: 14, left: '50%', width: 90, height: 22, transform: 'translateX(-50%) rotate(-3deg)' }} />
                                    <div className="opacity-30"><img src={twemojiUrl('1f48c')} alt="letter" className="w-12 h-12 rotate-[-6deg]" /></div>
                                    {isThinking ? (
                                        <div className="space-y-2">
                                            <p className="font-hand text-xl text-[#b03a34]">{selectedChar?.name} 正在读你写的……</p>
                                            <div className="flex justify-center gap-1">
                                                <div className="w-1.5 h-1.5 bg-[#b03a34] rounded-full animate-bounce"></div>
                                                <div className="w-1.5 h-1.5 bg-[#b03a34] rounded-full animate-bounce delay-100"></div>
                                                <div className="w-1.5 h-1.5 bg-[#b03a34] rounded-full animate-bounce delay-200"></div>
                                            </div>
                                        </div>
                                    ) : (
                                        <>
                                            <p className="font-hand text-lg text-[#6b665d]">左页写完了？<br />按一下，请 {selectedChar?.name} 也写一页给你。</p>
                                            <button
                                                onClick={handleExchange}
                                                className="scrap-btn px-6 py-3 text-sm font-bold mt-1"
                                            >
                                                请 TA 写一页 ✎
                                            </button>
                                        </>
                                    )}
                                </div>
                            )
                        )}
                    </div>
                </div>
            </div>

            {/* Bottom Controls（铅笔盒托盘） */}
            <div className="shrink-0 pb-safe pt-3 z-30" style={{ background: '#1f1d19', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="flex justify-center gap-2 mb-3 px-4">
                    <button
                        onClick={() => { setActiveTab('user'); setSelectedStickerId(null); }}
                        className={`flex-1 py-3 text-sm font-bold font-hand transition-all duration-300 relative ${activeTab === 'user' ? 'bg-white text-[#2b2933] shadow-lg' : 'bg-white/5 text-white/40 hover:bg-white/10'}`}
                        style={{ borderRadius: '12px 12px 4px 4px', rotate: activeTab === 'user' ? '0deg' : '-1.5deg' }}
                    >
                        我写的
                    </button>
                    <button
                        onClick={() => { setActiveTab('char'); setSelectedStickerId(null); }}
                        className={`flex-1 py-3 text-sm font-bold font-hand transition-all duration-300 relative ${activeTab === 'char' ? 'bg-[#b03a34] text-white shadow-lg' : 'bg-white/5 text-white/40 hover:bg-white/10'}`}
                        style={{ borderRadius: '12px 12px 4px 4px', rotate: activeTab === 'char' ? '0deg' : '1.5deg' }}
                    >
                        {selectedChar?.name || 'TA'} 的
                        {currentEntry?.charPage && activeTab !== 'char' && <div className="absolute top-2 right-2 w-2 h-2 bg-emerald-400 rounded-full shadow-sm animate-pulse"></div>}
                    </button>
                </div>

                <div className="flex items-center justify-between px-5 pb-4">
                    <div className="flex items-center gap-2.5 px-3 py-2 rounded-2xl" style={{ background: 'rgba(255,255,255,0.06)', outline: '1px dashed rgba(255,255,255,0.14)', outlineOffset: '-4px' }}>
                        <span className="label-mono text-[8px] text-white/35">纸</span>
                        {PAPER_STYLES.slice(0, 4).map(s => (
                            <button
                                key={s.id}
                                onClick={() => updatePage({ paperStyle: s.id }, activeTab)}
                                className={`w-7 h-7 rounded-md border transition-transform active:scale-90 ${s.css} ${(activeTab === 'user' ? currentEntry?.userPage.paperStyle : currentEntry?.charPage?.paperStyle) === s.id ? 'border-white ring-2 ring-white/60' : 'border-white/15'}`}
                                style={s.style}
                                title={s.name}
                            />
                        ))}
                    </div>

                    <div className="flex gap-2.5">
                        {activeTab === 'char' && currentEntry?.charPage && !isThinking && (
                            <button onClick={handleExchange} className="w-11 h-11 bg-white/10 text-white rounded-full flex items-center justify-center active:scale-90 transition-transform border border-white/10" title="让 TA 重写一页">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" /></svg>
                            </button>
                        )}

                        <button
                            onClick={() => setShowStickerPanel(!showStickerPanel)}
                            className={`w-11 h-11 rounded-full flex items-center justify-center shadow-lg active:scale-90 transition-transform ${showStickerPanel ? 'bg-white text-[#2b2933]' : 'bg-[#b03a34] text-white'}`}
                            title="贴纸抽屉"
                        >
                            <Sparkle size={22} weight="fill" />
                        </button>
                    </div>
                </div>

                {showStickerPanel && (
                    <div className="scrap-panel border-t border-white/10 p-4 animate-slide-up h-48 overflow-y-auto no-scrollbar" style={{ background: '#221f1b' }}>
                        <p className="font-hand text-base text-white/50 mb-2">贴纸抽屉 · 点一下贴上去，长按删素材</p>
                        <div className="grid grid-cols-6 gap-3">
                            <button onClick={() => setShowImportModal(true)} className="flex items-center justify-center bg-white/10 rounded-xl border-2 border-dashed border-white/25 text-white/50 text-xl font-bold hover:bg-white/20 hover:text-white transition-all aspect-square">
                                +
                            </button>
                            {DEFAULT_STICKERS.map((s, i) => (
                                <button key={`def-${i}`} onClick={() => addSticker(s)} className="hover:scale-110 transition-transform p-2 bg-white/5 rounded-xl border border-white/5 flex items-center justify-center">
                                    <img src={s} alt="" className="w-8 h-8 object-contain pointer-events-none" />
                                </button>
                            ))}
                            {customStickers.map((s, i) => (
                                <button
                                    key={`cust-${i}`}
                                    onClick={() => addSticker(s.url)}
                                    onTouchStart={() => handleDrawerTouchStart(s)}
                                    onTouchEnd={handleDrawerTouchEnd}
                                    onMouseDown={() => handleDrawerTouchStart(s)}
                                    onMouseUp={handleDrawerTouchEnd}
                                    onMouseLeave={handleDrawerTouchEnd}
                                    onContextMenu={(e) => { e.preventDefault(); setDeletingSticker(s); }}
                                    className="p-2 bg-white/5 rounded-xl border border-white/5 flex items-center justify-center relative active:scale-95 transition-transform"
                                >
                                    <img src={s.url} className="w-8 h-8 object-contain pointer-events-none" />
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Sticker Import Modal */}
            <Modal
                isOpen={showImportModal} title="新贴纸进库" onClose={() => setShowImportModal(false)}
                footer={<button onClick={handleImportStickers} className="scrap-btn w-full py-3 font-bold">贴进抽屉</button>}
            >
                <div className="space-y-3">
                    <p className="font-hand text-base text-[#8b8996]">每行一张，写成「名字--图片网址」就行 ✎</p>
                    <textarea
                        value={importText}
                        onChange={e => setImportText(e.target.value)}
                        placeholder={`小猫--https://...\n爱心--https://...`}
                        className="w-full h-32 bg-[#faf6ee] rounded-2xl p-4 text-sm resize-none focus:outline-none text-[#4a463f] border border-[#ece4d3]"
                        style={{ outline: '1px dashed rgba(167,162,151,0.4)', outlineOffset: '-5px' }}
                    />
                </div>
            </Modal>

            {/* Sticker Delete Confirmation Modal */}
            <Modal
                isOpen={!!deletingSticker} title="撕掉这张贴纸" onClose={() => setDeletingSticker(null)}
                footer={<div className="flex gap-2 w-full"><button onClick={() => setDeletingSticker(null)} className="scrap-btn-paper flex-1 py-3 font-bold">留着</button><button onClick={handleDeleteStickerAsset} className="flex-1 py-3 bg-[#b03a34] text-white rounded-full font-bold active:scale-95 transition-transform">撕掉</button></div>}
            >
                <div className="flex flex-col items-center gap-3 py-2">
                    {deletingSticker && <img src={deletingSticker.url} className="w-16 h-16 object-contain rounded-lg bg-[#f6f4ef] border border-[#ece4d3] rotate-[-4deg]" />}
                    <p className="text-sm text-[#4a463f] text-center">把这张贴纸从抽屉里撕掉？<br />已经贴到日记上的那些不受影响。</p>
                </div>
            </Modal>
        </div>
    );
};

export default JournalApp;
