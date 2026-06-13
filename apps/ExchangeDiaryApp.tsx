import React, { useEffect, useRef, useState } from 'react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { CharacterProfile, ExchangeDiaryBook, ExchangeDiaryEntry } from '../types';
import { ContextBuilder } from '../utils/context';
import Modal from '../components/os/Modal';
import { formatMessageForPrompt } from '../utils/messageFormat';
import { getDiaryDateStr as getLocalDateStr, parseJsonLoose, callDiaryLLM } from './diaryShared';

// ============ 常量 ============
// 拼贴手账重制：文案 / 布局 / 按键全部原创。心情、印章、信纸的 key/id 持久化不可改，
// 只换显示用的 emoji / 名称；功能、数据模型、LLM 契约保持不变。

// 心情（5 选 1，存 key）
const MOODS = [
    { key: 'sunny', emoji: '☀️', label: '放晴' },
    { key: 'rainy', emoji: '🌧️', label: '落雨' },
    { key: 'starry', emoji: '🌠', label: '星河' },
    { key: 'cozy', emoji: '🫖', label: '温吞' },
    { key: 'wild', emoji: '🧭', label: '撒野' },
] as const;

// 印章（可多选，存 key）
const SEALS = [
    { key: 'secret', emoji: '🔒', label: '私密' },
    { key: 'gratitude', emoji: '💐', label: '谢谢' },
    { key: 'courage', emoji: '🔥', label: '打气' },
    { key: 'dream', emoji: '🌙', label: '心愿' },
    { key: 'routine', emoji: '📎', label: '日常' },
] as const;

// 信纸样式：作用在整本日记的时间线背景上（口味偏牛皮纸拼贴）
const PAPER_STYLES: { id: string; name: string; css: string; text: string; sub: string; style?: React.CSSProperties }[] = [
    { id: 'plain', name: '米白', css: 'bg-[#fbfaf7]', text: 'text-[#3b3833]', sub: 'text-[#a79c8e]' },
    {
        id: 'grid', name: '格纹', css: 'bg-[#fffdf8]', text: 'text-[#3b3833]', sub: 'text-[#a79c8e]',
        style: { backgroundImage: 'linear-gradient(#e7e2d6 1px, transparent 1px), linear-gradient(90deg, #e7e2d6 1px, transparent 1px)', backgroundSize: '22px 22px' },
    },
    {
        id: 'lined', name: '信笺', css: 'bg-[#fffdf2]', text: 'text-[#3b3833]', sub: 'text-[#a79c8e]',
        style: { backgroundImage: 'repeating-linear-gradient(transparent, transparent 27px, #e9e3d4 27px, #e9e3d4 28px)' },
    },
    {
        id: 'pink', name: '蜜桃', css: 'bg-[#fdf2f4]', text: 'text-[#3b3833]', sub: 'text-[#d98a98]',
        style: { backgroundImage: 'radial-gradient(#f4c9d2 1.5px, transparent 1.5px)', backgroundSize: '26px 26px' },
    },
    { id: 'dark', name: '墨夜', css: 'bg-[#2b2933]', text: 'text-white/90', sub: 'text-white/40' },
];

// 写作提示（本地内置，「换一题」随机切换）
const WRITING_PROMPTS = [
    '今天有哪个瞬间，过去好久还记得？',
    '要是用一种天气形容今天的心情，会是哪种？为什么？',
    '最近有件小事，让你偷偷高兴了很久吧？',
    '写一件你今天本来想做、最后没做成的事。',
    '此刻最想对谁说一句话？说什么？',
    '今天吃到 / 看到 / 听到的最好的东西是什么？',
    '记下一个你最近总会想起的画面。',
    '如果今天能重来一次，你想改哪个选择？',
    '写一个你从没告诉过别人的小习惯。',
    '最近哪一刻，让你觉得"啊，还好活着"？',
];

const moodOf = (key?: string) => MOODS.find(m => m.key === key);
const sealOf = (key: string) => SEALS.find(s => s.key === key);

const randomPrompt = (exclude?: string) => {
    const pool = WRITING_PROMPTS.filter(p => p !== exclude);
    return pool[Math.floor(Math.random() * pool.length)];
};

// ============ 组件 ============

interface ExchangeDiaryAppProps {
    // 由合并后的「日记」App 注入的模式切换器，渲染在书架（根）页头部。
    tabSwitcher?: React.ReactNode;
}

const ExchangeDiaryApp: React.FC<ExchangeDiaryAppProps> = ({ tabSwitcher }) => {
    const { closeApp, characters, apiConfig, userProfile, addToast } = useOS();

    // --- 全局状态 ---
    const [books, setBooks] = useState<ExchangeDiaryBook[]>([]);
    const [activeBookId, setActiveBookId] = useState<string | null>(null);
    const activeBook = books.find(b => b.id === activeBookId) || null;
    const activeChar: CharacterProfile | null =
        (activeBook && characters.find(c => c.id === activeBook.activeCharId)) || null;

    // --- 日记本编辑（新建 / 改名 / 改成员 / 改信纸）---
    const [bookForm, setBookForm] = useState<{ id?: string; title: string; charIds: string[]; paperStyle: string } | null>(null);
    const [deletingBook, setDeletingBook] = useState<ExchangeDiaryBook | null>(null);

    // --- 写日记 composer ---
    const [composerOpen, setComposerOpen] = useState(false);
    const [draftContent, setDraftContent] = useState('');
    const [draftMood, setDraftMood] = useState<string>('sunny');
    const [draftSeals, setDraftSeals] = useState<string[]>([]);
    const [currentPrompt, setCurrentPrompt] = useState<string>(() => randomPrompt());

    // --- AI 忙碌状态（互斥，禁用相关按钮）---
    const [aiBusy, setAiBusy] = useState<null | 'opening' | 'entry' | 'summary'>(null);

    // --- 删除单篇 ---
    const [deletingEntry, setDeletingEntry] = useState<ExchangeDiaryEntry | null>(null);

    const feedRef = useRef<HTMLDivElement>(null);

    // 从最新 state 里取某本书（异步 AI 写作期间 book 可能已被其它操作更新，
    // 直接用闭包里的旧 book 追加会覆盖并发写入）
    const booksRef = useRef(books);
    booksRef.current = books;
    const booksRefLatest = (id: string) => booksRef.current.find(b => b.id === id) || null;

    // --- 加载 ---
    useEffect(() => {
        DB.getAllExchangeDiaryBooks().then(setBooks).catch(e => {
            console.warn('📔 [日记社] 加载失败:', e);
            addToast('本子没打开', 'error');
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // 统一落库：整本保存（entries 内嵌在 book 上），并同步内存态
    const persistBook = async (book: ExchangeDiaryBook): Promise<ExchangeDiaryBook> => {
        const updated = { ...book, updatedAt: Date.now() };
        await DB.saveExchangeDiaryBook(updated);
        setBooks(prev => {
            const exists = prev.some(b => b.id === updated.id);
            const next = exists ? prev.map(b => (b.id === updated.id ? updated : b)) : [updated, ...prev];
            return [...next].sort((a, b) => b.updatedAt - a.updatedAt);
        });
        return updated;
    };

    // ============ 日记本管理 ============

    const openCreateForm = () => {
        if (characters.length === 0) {
            addToast('先去捏一个角色吧', 'info');
            return;
        }
        setBookForm({ title: '', charIds: [], paperStyle: 'plain' });
    };

    const openEditForm = (book: ExchangeDiaryBook) => {
        setBookForm({ id: book.id, title: book.title, charIds: [...book.charIds], paperStyle: book.paperStyle || 'plain' });
    };

    const toggleFormChar = (charId: string) => {
        setBookForm(prev => {
            if (!prev) return prev;
            const has = prev.charIds.includes(charId);
            return { ...prev, charIds: has ? prev.charIds.filter(id => id !== charId) : [...prev.charIds, charId] };
        });
    };

    const submitBookForm = async () => {
        if (!bookForm) return;
        const title = bookForm.title.trim();
        if (!title) { addToast('先给本子取个名字', 'info'); return; }
        if (bookForm.charIds.length === 0) { addToast('至少拉一个人进来', 'info'); return; }

        try {
            if (bookForm.id) {
                const book = books.find(b => b.id === bookForm.id);
                if (!book) return;
                // 活跃角色被移出成员时回退到第一位成员
                const activeCharId = bookForm.charIds.includes(book.activeCharId) ? book.activeCharId : bookForm.charIds[0];
                await persistBook({ ...book, title, charIds: bookForm.charIds, activeCharId, paperStyle: bookForm.paperStyle });
                addToast('本子改好了', 'success');
            } else {
                const now = Date.now();
                const newBook: ExchangeDiaryBook = {
                    id: `edbook-${now}-${Math.floor(Math.random() * 1e4)}`,
                    title,
                    charIds: bookForm.charIds,
                    activeCharId: bookForm.charIds[0],
                    paperStyle: bookForm.paperStyle,
                    entries: [],
                    createdAt: now,
                    updatedAt: now,
                };
                await persistBook(newBook);
                setActiveBookId(newBook.id);
                addToast('新本子开张了', 'success');
            }
            setBookForm(null);
        } catch (e: any) {
            addToast(`没存上: ${e.message}`, 'error');
        }
    };

    const handleDeleteBook = async () => {
        if (!deletingBook) return;
        try {
            await DB.deleteExchangeDiaryBook(deletingBook.id);
            setBooks(prev => prev.filter(b => b.id !== deletingBook.id));
            if (activeBookId === deletingBook.id) setActiveBookId(null);
            setDeletingBook(null);
            setBookForm(null);
            addToast('整本撕掉了', 'success');
        } catch (e: any) {
            addToast(`没删掉: ${e.message}`, 'error');
        }
    };

    const switchActiveChar = async (book: ExchangeDiaryBook, charId: string) => {
        if (book.activeCharId === charId) return;
        await persistBook({ ...book, activeCharId: charId });
    };

    // ============ LLM 调用（沿用 JournalApp 的主 API 约定）============

    const callLLM = async (
        messages: { role: 'system' | 'user'; content: string }[],
        temperature = 0.85,
    ): Promise<string> => {
        const content = await callDiaryLLM(apiConfig, messages, { temperature });
        if (!content) throw new Error('AI 返回为空');
        return content;
    };

    // 今天与某角色的聊天节选：≤30 条、≤2000 字。
    // 用 formatMessageForPrompt 统一序列化，避免 score_card 等消息把 base64/JSON 灌进 prompt。
    const getTodayChatExcerpt = async (char: CharacterProfile): Promise<string> => {
        const msgs = await DB.getMessagesByCharId(char.id, true);
        const dayStart = new Date();
        dayStart.setHours(0, 0, 0, 0);
        const todays = msgs.filter(m => m.timestamp >= dayStart.getTime());
        const lines = todays.slice(-30).map(m => formatMessageForPrompt(m, char.name, userProfile.name));
        let text = lines.join('\n');
        if (text.length > 2000) text = '…' + text.slice(-2000);
        return text;
    };

    // 本子里最近几篇的简摘（给角色一点连续性，截断防膨胀）
    const buildRecentEntriesDigest = (book: ExchangeDiaryBook, limit = 6): string => {
        const recent = [...book.entries].sort((a, b) => a.timestamp - b.timestamp).slice(-limit);
        if (recent.length === 0) return '(这本日记还是空的)';
        return recent.map(e => {
            const mood = moodOf(e.mood);
            const body = e.content.length > 120 ? e.content.slice(0, 120) + '…' : e.content;
            return `- [${e.date}] ${e.authorName}${mood ? ` (${mood.label})` : ''}${e.isSummary ? ' [对话总结]' : ''}: ${body}`;
        }).join('\n');
    };

    // --- AI 帮我起头：替用户拟 2-3 句日记开头，插入输入框 ---
    const handleAiOpening = async () => {
        if (aiBusy) return;
        if (!apiConfig.apiKey) { addToast('先去文具盒里配好 API', 'error'); return; }
        setAiBusy('opening');
        try {
            const prompt = `你是一位温柔的日记写作助手。用户「${userProfile.name}」想写今天的日记，但不知道怎么开头。
${userProfile.bio ? `关于用户: ${userProfile.bio}\n` : ''}今天的写作提示是: "${currentPrompt}"
${draftContent.trim() ? `用户已经写了一点: "${draftContent.trim().slice(0, 200)}"\n请顺着已有内容续起开头。` : ''}
请以用户的第一人称口吻，写 2-3 句自然、有画面感的日记开头（中文，总共不超过 80 字）。
不要任何前缀、引号、标题或解释，直接输出正文。`;
            const text = await callLLM([{ role: 'user', content: prompt }], 0.9);
            const cleaned = text.replace(/^["'「『]+|["'」』]+$/g, '').trim();
            setDraftContent(prev => (prev.trim() ? `${prev.trimEnd()}\n${cleaned}` : cleaned));
            addToast('开头给你起好了，接着写 ✎', 'success');
        } catch (e: any) {
            addToast(`起头没成: ${e.message}`, 'error');
        } finally {
            setAiBusy(null);
        }
    };

    // ============ 角色回应 ============

    // 角色以自己的口吻写一篇日记（150-250 字），并自选心情。
    // 上下文 = 完整人设 (buildCoreContext) + 用户最新一篇 + 今天的聊天节选 + 本子近况。
    const requestCharEntry = async (book: ExchangeDiaryBook, char: CharacterProfile) => {
        if (aiBusy) return;
        if (!apiConfig.apiKey) { addToast('先去文具盒里配好 API', 'error'); return; }
        setAiBusy('entry');
        try {
            const latestUserEntry = [...book.entries]
                .filter(e => e.author === 'user')
                .sort((a, b) => b.timestamp - a.timestamp)[0];
            const chatExcerpt = await getTodayChatExcerpt(char);
            const moodOptions = MOODS.map(m => `${m.key}(${m.emoji}${m.label})`).join(' / ');

            let systemPrompt = ContextBuilder.buildCoreContext(char, userProfile);
            systemPrompt += `### [日记社 · 交换日记模式]
你和 ${userProfile.name} 等人共用一本交换日记《${book.title}》，现在轮到你写一篇。

### 本子里最近的几篇（保持话题与情绪的连续性）
${buildRecentEntriesDigest(book)}

### ${userProfile.name} 最新的一篇日记
${latestUserEntry
    ? `[${latestUserEntry.date}]${moodOf(latestUserEntry.mood) ? ` 心情: ${moodOf(latestUserEntry.mood)!.label}` : ''}\n"""\n${latestUserEntry.content}\n"""`
    : `(${userProfile.name} 还没在这本日记里写过，你可以主动开个头)`}

### 你们今天的聊天记录节选
${chatExcerpt || '(今天还没有聊过天)'}

### 任务
以你的角色口吻写一篇**你自己的日记**（不是聊天回复），要求：
1. 第一人称，符合你的性格与说话方式，可以更书面、更私密一些——这是写在日记本里的话。
2. 如果 ${userProfile.name} 写了日记，要对其中的内容有真实的回应或共鸣；但**务必同时写至少一件与对方无关的、你今天自己经历或想到的事**，让对方看到你独立的一面。
3. 如果聊天记录里有具体的事（聊过的话题、约定、玩笑），自然地带到。
4. 篇幅 150-250 字，中文。
5. 为这篇日记选一个最贴合你此刻心境的心情。

### 输出格式（必须是纯 JSON，不要代码块、不要多余文字）
{"content": "日记正文……", "mood": "${MOODS.map(m => m.key).join(' | ')}"}
mood 必须从这些选项里选: ${moodOptions}`;

            const raw = await callLLM([
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `请以 ${char.name} 的身份写下今天 (${getLocalDateStr()}) 的日记，按要求输出 JSON。` },
            ], 0.85);

            const parsed = parseJsonLoose(raw);
            const content: string = (parsed?.content && String(parsed.content).trim()) || raw.replace(/```json/gi, '').replace(/```/g, '').trim();
            const mood: string = MOODS.some(m => m.key === parsed?.mood) ? parsed.mood : 'sunny';
            if (!content) throw new Error('生成内容为空');

            const now = Date.now();
            const entry: ExchangeDiaryEntry = {
                id: `ed-${now}-${Math.floor(Math.random() * 1e4)}`,
                author: 'char',
                charId: char.id,
                authorName: char.name,
                avatar: char.avatar,
                mood,
                content,
                date: getLocalDateStr(),
                timestamp: now,
            };
            // 注意：异步期间 book 可能已被其它操作更新，重新从内存态取最新版本再追加
            const fresh = booksRefLatest(book.id) || book;
            await persistBook({ ...fresh, entries: [...fresh.entries, entry] });
            addToast(`${char.name} 写了一篇`, 'success');
        } catch (e: any) {
            addToast(`${char.name} 没写出来: ${e.message}`, 'error');
        } finally {
            setAiBusy(null);
        }
    };

    // ============ 今日对话总结 ============

    // 把今天与活跃角色的聊天，让 LLM 以角色视角写成一篇日记式总结（isSummary 标记）
    const generateDailySummary = async (book: ExchangeDiaryBook, char: CharacterProfile) => {
        if (aiBusy) return;
        if (!apiConfig.apiKey) { addToast('先去文具盒里配好 API', 'error'); return; }
        setAiBusy('summary');
        try {
            const chatExcerpt = await getTodayChatExcerpt(char);
            if (!chatExcerpt.trim()) {
                addToast(`今天还没和 ${char.name} 聊过呢`, 'info');
                return;
            }
            const moodOptions = MOODS.map(m => `${m.key}(${m.emoji}${m.label})`).join(' / ');

            let systemPrompt = ContextBuilder.buildCoreContext(char, userProfile);
            systemPrompt += `### [日记社 · 今日对话总结]
下面是你和 ${userProfile.name} 今天 (${getLocalDateStr()}) 的聊天记录节选：
[对话记录开始]
${chatExcerpt}
[对话记录结束]

### 任务
以你的角色口吻，把今天的对话写成一篇**日记式总结**，要求：
1. 第一人称、你的视角。不是流水账，而是带着你的情绪和感受去回顾：今天聊了什么、哪句话让你在意、你心里没说出口的想法。
2. 提到 1-2 个对话里的具体细节（话题、玩笑、约定），让 ${userProfile.name} 看了会心一笑。
3. 篇幅 120-200 字，中文。
4. 为这篇总结选一个贴合你今天心境的心情。

### 输出格式（必须是纯 JSON，不要代码块、不要多余文字）
{"content": "总结正文……", "mood": "${MOODS.map(m => m.key).join(' | ')}"}
mood 必须从这些选项里选: ${moodOptions}`;

            const raw = await callLLM([
                { role: 'system', content: systemPrompt },
                { role: 'user', content: '请写下今天的对话总结，按要求输出 JSON。' },
            ], 0.7);

            const parsed = parseJsonLoose(raw);
            const content: string = (parsed?.content && String(parsed.content).trim()) || raw.replace(/```json/gi, '').replace(/```/g, '').trim();
            const mood: string = MOODS.some(m => m.key === parsed?.mood) ? parsed.mood : 'cozy';
            if (!content) throw new Error('生成内容为空');

            const now = Date.now();
            const entry: ExchangeDiaryEntry = {
                id: `ed-${now}-${Math.floor(Math.random() * 1e4)}`,
                author: 'char',
                charId: char.id,
                authorName: char.name,
                avatar: char.avatar,
                mood,
                content,
                date: getLocalDateStr(),
                timestamp: now,
                isSummary: true,
            };
            const fresh = booksRefLatest(book.id) || book;
            await persistBook({ ...fresh, entries: [...fresh.entries, entry] });
            addToast('今天的对话总结贴进去了', 'success');
        } catch (e: any) {
            addToast(`总结没成: ${e.message}`, 'error');
        } finally {
            setAiBusy(null);
        }
    };

    // ============ 用户发布日记 ============

    const openComposer = () => {
        setDraftContent('');
        setDraftMood('sunny');
        setDraftSeals([]);
        setCurrentPrompt(randomPrompt());
        setComposerOpen(true);
    };

    const toggleSeal = (key: string) => {
        setDraftSeals(prev => (prev.includes(key) ? prev.filter(s => s !== key) : [...prev, key]));
    };

    const publishUserEntry = async () => {
        if (!activeBook) return;
        const content = draftContent.trim();
        if (!content) { addToast('写点什么再贴上去吧', 'info'); return; }
        const char = activeChar;

        const now = Date.now();
        const entry: ExchangeDiaryEntry = {
            id: `ed-${now}-${Math.floor(Math.random() * 1e4)}`,
            author: 'user',
            charId: activeBook.activeCharId, // user 篇记录"写给谁看"的当前活跃角色
            authorName: userProfile.name || '我',
            avatar: userProfile.avatar,
            mood: draftMood,
            seals: draftSeals,
            content,
            date: getLocalDateStr(),
            timestamp: now,
        };
        try {
            const updated = await persistBook({ ...activeBook, entries: [...activeBook.entries, entry] });
            setComposerOpen(false);
            addToast('贴进本子了', 'success');
            // 发布后自动请活跃角色回应一篇（未配置 API 时静默跳过，可稍后手动请 TA 写）
            if (char && apiConfig.apiKey) {
                void requestCharEntry(updated, char);
            }
        } catch (e: any) {
            addToast(`没贴上: ${e.message}`, 'error');
        }
    };

    const handleDeleteEntry = async () => {
        if (!deletingEntry || !activeBook) return;
        try {
            await persistBook({ ...activeBook, entries: activeBook.entries.filter(e => e.id !== deletingEntry.id) });
            setDeletingEntry(null);
            addToast('撕掉了', 'success');
        } catch (e: any) {
            addToast(`没删掉: ${e.message}`, 'error');
        }
    };

    // ============ 渲染辅助 ============

    const Spinner = () => (
        <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z" />
        </svg>
    );

    const Avatar: React.FC<{ src?: string; name: string; size?: string }> = ({ src, name, size = 'w-9 h-9' }) => (
        src
            ? <img src={src} className={`${size} rounded-full object-cover border border-black/5 shrink-0`} alt={name} />
            : <div className={`${size} rounded-full bg-[#e7ddc9] text-[#8a7a55] flex items-center justify-center text-xs font-bold shrink-0`}>{name.slice(0, 1)}</div>
    );

    // 拍立得头像（时间线里用，带一点歪斜的拼贴感）
    const Polaroid: React.FC<{ src?: string; name: string; tilt: string }> = ({ src, name, tilt }) => (
        <div className="bg-white p-[3px] pb-1.5 shadow-md border border-[#ece9e2] shrink-0" style={{ rotate: tilt }}>
            {src
                ? <img src={src} className="w-9 h-9 object-cover" alt={name} />
                : <div className="w-9 h-9 bg-[#e7ddc9] text-[#8a7a55] flex items-center justify-center text-sm font-bold">{name.slice(0, 1)}</div>}
        </div>
    );

    // 时间线按日期分组（日期新→旧；同一天内按时间正序，像翻日记一样自然）
    const groupEntries = (entries: ExchangeDiaryEntry[]) => {
        const byDate = new Map<string, ExchangeDiaryEntry[]>();
        for (const e of entries) {
            const list = byDate.get(e.date) || [];
            list.push(e);
            byDate.set(e.date, list);
        }
        return [...byDate.entries()]
            .sort((a, b) => b[0].localeCompare(a[0]))
            .map(([date, list]) => ({ date, list: list.sort((a, b) => a.timestamp - b.timestamp) }));
    };

    const dateLabel = (date: string) => {
        const today = getLocalDateStr();
        const yest = getLocalDateStr(new Date(Date.now() - 86400000));
        if (date === today) return `${date} · 今天`;
        if (date === yest) return `${date} · 昨天`;
        return date;
    };

    const timeLabel = (ts: number) =>
        new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

    // ============ 弹窗：日记本表单（新建 / 编辑）============

    const bookFormModal = bookForm ? (
        <Modal
            isOpen={true}
            title={bookForm.id ? '本子设定' : '开一本新的'}
            onClose={() => setBookForm(null)}
            footer={
                <div className="flex gap-2 w-full">
                    {bookForm.id && (
                        <button
                            onClick={() => {
                                const b = books.find(x => x.id === bookForm.id);
                                if (b) setDeletingBook(b);
                            }}
                            className="px-4 py-3 bg-[#f6e4e2] text-[#b03a34] rounded-full font-bold text-sm active:scale-95 transition-transform"
                        >撕掉</button>
                    )}
                    <button onClick={() => setBookForm(null)} className="scrap-btn-paper flex-1 py-3 font-bold text-sm">先不弄</button>
                    <button onClick={submitBookForm} className="scrap-btn flex-1 py-3 font-bold text-sm">
                        {bookForm.id ? '存好' : '开张'}
                    </button>
                </div>
            }
        >
            <div className="space-y-4 max-h-[55vh] overflow-y-auto no-scrollbar pr-1">
                <div className="drawer-tag mb-1"><span>本子名</span></div>
                <input
                    value={bookForm.title}
                    onChange={e => setBookForm(prev => prev ? { ...prev, title: e.target.value } : prev)}
                    placeholder="比如：我们仨的夏天"
                    maxLength={24}
                    className="w-full px-4 py-3 rounded-2xl bg-[#faf6ee] border border-[#ece4d3] outline-none focus:border-[#d8625b] text-sm text-[#4a463f] font-hand text-base"
                    style={{ outline: '1px dashed rgba(167,162,151,0.4)', outlineOffset: '-5px' }}
                />

                <div className="drawer-tag mb-1"><span>拉谁进来 · 可多选</span></div>
                <div className="grid grid-cols-2 gap-2">
                    {characters.map(c => {
                        const selected = bookForm.charIds.includes(c.id);
                        return (
                            <button
                                key={c.id}
                                onClick={() => toggleFormChar(c.id)}
                                className={`flex items-center gap-2 px-3 py-2 rounded-2xl border text-left transition-all active:scale-95 ${
                                    selected ? 'bg-[#faf0ee] border-[#e3b4af] ring-1 ring-[#ecc9c5]' : 'bg-white border-[#ece4d3]'
                                }`}
                            >
                                <Avatar src={c.avatar} name={c.name} size="w-8 h-8" />
                                <span className={`text-sm truncate font-hand ${selected ? 'font-bold text-[#b03a34]' : 'text-[#6b665d]'}`}>{c.name}</span>
                                {selected && <span className="ml-auto text-[#d8625b] text-xs">✓</span>}
                            </button>
                        );
                    })}
                </div>

                <div className="drawer-tag mb-1"><span>信纸</span></div>
                <div className="flex gap-2 flex-wrap">
                    {PAPER_STYLES.map(p => (
                        <button
                            key={p.id}
                            onClick={() => setBookForm(prev => prev ? { ...prev, paperStyle: p.id } : prev)}
                            className="flex flex-col items-center gap-1 active:scale-95 transition-transform"
                        >
                            <span
                                className={`w-12 h-12 rounded-lg border ${p.css} ${
                                    bookForm.paperStyle === p.id ? 'border-[#d8625b] ring-2 ring-[#ecc9c5]' : 'border-[#ddd6c8]'
                                }`}
                                style={p.style}
                            />
                            <span className={`text-[11px] font-hand ${bookForm.paperStyle === p.id ? 'text-[#b03a34] font-bold' : 'text-[#a79c8e]'}`}>{p.name}</span>
                        </button>
                    ))}
                </div>
            </div>
        </Modal>
    ) : null;

    // ============ 弹窗：删除确认 ============

    const deleteBookModal = deletingBook ? (
        <Modal
            isOpen={true}
            title="撕掉整本"
            onClose={() => setDeletingBook(null)}
            footer={
                <div className="flex gap-2 w-full">
                    <button onClick={() => setDeletingBook(null)} className="scrap-btn-paper flex-1 py-3 font-bold text-sm">留着</button>
                    <button onClick={handleDeleteBook} className="flex-1 py-3 bg-[#b03a34] text-white rounded-full font-bold text-sm active:scale-95 transition-transform">撕掉</button>
                </div>
            }
        >
            <p className="text-sm text-[#4a463f] leading-relaxed">
                确定撕掉《{deletingBook.title}》吗？里面的 {deletingBook.entries.length} 篇会一起没了，捡不回来。
            </p>
        </Modal>
    ) : null;

    const deleteEntryModal = deletingEntry ? (
        <Modal
            isOpen={true}
            title="撕掉这一页"
            onClose={() => setDeletingEntry(null)}
            footer={
                <div className="flex gap-2 w-full">
                    <button onClick={() => setDeletingEntry(null)} className="scrap-btn-paper flex-1 py-3 font-bold text-sm">留着</button>
                    <button onClick={handleDeleteEntry} className="flex-1 py-3 bg-[#b03a34] text-white rounded-full font-bold text-sm active:scale-95 transition-transform">撕掉</button>
                </div>
            }
        >
            <p className="text-sm text-[#4a463f] leading-relaxed">
                {deletingEntry.authorName} 在 {deletingEntry.date} 写的这一页，撕了就回不来了。
            </p>
        </Modal>
    ) : null;

    // ============ 弹窗：写日记 composer ============

    const composerModal = composerOpen && activeBook ? (
        <Modal
            isOpen={true}
            title="写今天这一页"
            onClose={() => setComposerOpen(false)}
            footer={
                <div className="flex gap-2 w-full">
                    <button onClick={() => setComposerOpen(false)} className="scrap-btn-paper flex-1 py-3 font-bold text-sm">先不写</button>
                    <button
                        onClick={publishUserEntry}
                        disabled={!draftContent.trim()}
                        className="scrap-btn flex-1 py-3 font-bold text-sm disabled:opacity-40 disabled:active:scale-100"
                    >贴上去</button>
                </div>
            }
        >
            <div className="space-y-3 max-h-[55vh] overflow-y-auto no-scrollbar pr-1">
                {/* 写作提示 */}
                <div className="rounded-2xl bg-[#faf6ee] border border-[#ece4d3] px-3 py-2.5" style={{ outline: '1px dashed rgba(167,162,151,0.4)', outlineOffset: '-5px' }}>
                    <div className="flex items-start gap-2">
                        <span className="text-base leading-none mt-0.5">📌</span>
                        <p className="flex-1 text-[14px] text-[#7a6f4f] leading-relaxed font-hand">{currentPrompt}</p>
                    </div>
                    <div className="flex gap-2 mt-2">
                        <button
                            onClick={() => setCurrentPrompt(p => randomPrompt(p))}
                            className="px-3 py-1.5 rounded-full bg-white border border-[#e3b4af] text-[#b03a34] text-[11px] font-bold active:scale-95 transition-transform"
                        >换一题</button>
                        <button
                            onClick={handleAiOpening}
                            disabled={aiBusy !== null}
                            className="scrap-btn px-3 py-1.5 text-[11px] font-bold disabled:opacity-50 flex items-center gap-1.5"
                        >
                            {aiBusy === 'opening' ? <Spinner /> : '✎'} 帮我起个头
                        </button>
                    </div>
                </div>

                {/* 心情 */}
                <div className="drawer-tag"><span>今天什么心情</span></div>
                <div className="flex gap-1.5">
                    {MOODS.map(m => (
                        <button
                            key={m.key}
                            onClick={() => setDraftMood(m.key)}
                            className={`flex-1 flex flex-col items-center gap-0.5 py-2 rounded-xl border transition-all active:scale-95 ${
                                draftMood === m.key ? 'bg-[#faf0ee] border-[#e3b4af] ring-1 ring-[#ecc9c5]' : 'bg-white border-[#ece4d3]'
                            }`}
                        >
                            <span className="text-lg leading-none">{m.emoji}</span>
                            <span className={`text-[11px] font-hand ${draftMood === m.key ? 'text-[#b03a34] font-bold' : 'text-[#a79c8e]'}`}>{m.label}</span>
                        </button>
                    ))}
                </div>

                {/* 印章 */}
                <div className="drawer-tag"><span>盖几枚印章</span></div>
                <div className="flex gap-1.5 flex-wrap">
                    {SEALS.map(s => (
                        <button
                            key={s.key}
                            onClick={() => toggleSeal(s.key)}
                            className={`px-2.5 py-1.5 rounded-full border text-[12px] flex items-center gap-1 transition-all active:scale-95 font-hand ${
                                draftSeals.includes(s.key) ? 'bg-[#faf0ee] border-[#e3b4af] text-[#b03a34] font-bold' : 'bg-white border-[#ece4d3] text-[#a79c8e]'
                            }`}
                        >
                            <span>{s.emoji}</span>{s.label}
                        </button>
                    ))}
                </div>

                {/* 正文 */}
                <textarea
                    value={draftContent}
                    onChange={e => setDraftContent(e.target.value)}
                    placeholder="今天过得怎么样……"
                    rows={6}
                    className="w-full px-4 py-3 rounded-2xl bg-[#faf6ee] border border-[#ece4d3] outline-none focus:border-[#d8625b] text-sm text-[#4a463f] leading-relaxed resize-none"
                    style={{ outline: '1px dashed rgba(167,162,151,0.4)', outlineOffset: '-5px' }}
                />
                {activeChar && (
                    <p className="text-[12px] text-[#a79c8e] font-hand">贴上去后，会自动请「{activeChar.name}」也写一页回应。</p>
                )}
            </div>
        </Modal>
    ) : null;

    // ============ 视图：书架 ============

    if (!activeBook) {
        return (
            <div className="h-full w-full flex flex-col font-light" style={{ background: '#f4f2ed', backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(120,116,106,0.06) 1px, transparent 0)', backgroundSize: '16px 16px' }}>
                {bookFormModal}
                {deleteBookModal}
                <div className="relative pt-12 pb-3 px-5 sticky top-0 z-20 flex items-center justify-between shrink-0" style={{ background: '#efe9dc', borderBottom: '1px solid rgba(180,172,156,0.5)' }}>
                    <button onClick={closeApp} className="scrap-btn-paper w-9 h-9 flex items-center justify-center" aria-label="返回">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5 text-[#2b2933]"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
                    </button>
                    {tabSwitcher || <span className="font-hand text-2xl font-bold text-[#2b2933]">合写本子</span>}
                    <button onClick={openCreateForm} className="scrap-btn w-9 h-9 flex items-center justify-center" aria-label="开一本新的">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.2} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                    </button>
                    <div className="lace-edge absolute left-0 right-0 -bottom-[10px]"></div>
                </div>

                <div className="flex-1 overflow-y-auto p-5 pt-7 pb-20 no-scrollbar">
                    {books.length === 0 ? (
                        <div className="flex flex-col items-center justify-center gap-3 pt-24 text-center">
                            <span className="text-5xl rotate-[-6deg]">📔</span>
                            <p className="font-hand text-2xl text-[#6b665d]">架子上还没有本子</p>
                            <p className="font-hand text-lg text-[#a79c8e] max-w-[240px] leading-relaxed">开一本，把喜欢的人都拉进来，一起写</p>
                            <button onClick={openCreateForm} className="scrap-btn mt-2 px-6 py-3 font-bold text-sm">
                                ＋ 开一本新的
                            </button>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {books.map((b, i) => {
                                const members = b.charIds
                                    .map(id => characters.find(c => c.id === id))
                                    .filter((c): c is CharacterProfile => !!c);
                                const paper = PAPER_STYLES.find(p => p.id === b.paperStyle) || PAPER_STYLES[0];
                                return (
                                    <div
                                        key={b.id}
                                        onClick={() => setActiveBookId(b.id)}
                                        className={`scrap-card press-soft relative p-4 cursor-pointer overflow-hidden ${i % 2 ? 'tilt-r' : 'tilt-l'}`}
                                        style={{ borderRadius: '4px 16px 16px 4px' }}
                                    >
                                        <div className="absolute inset-y-0 left-0 w-3 pointer-events-none" style={{ background: 'linear-gradient(90deg, rgba(43,41,51,0.16), transparent)' }}></div>
                                        {/* 书脊和纸胶带 */}
                                        <span aria-hidden className="pointer-events-none absolute" style={{ top: -8, left: 24, width: 56, height: 18, transform: 'rotate(-4deg)', background: 'linear-gradient(100deg, rgba(216,98,91,0.32), rgba(216,98,91,0.16))', borderLeft: '1px dashed rgba(160,156,146,0.5)', borderRight: '1px dashed rgba(160,156,146,0.5)' }}></span>
                                        <div className="flex items-start justify-between gap-2 pl-2">
                                            <div className="min-w-0">
                                                <h3 className="font-hand font-bold text-[#2b2933] text-xl truncate">{b.title}</h3>
                                                <p className="label-mono text-[9px] text-[#a79c8e] mt-0.5">
                                                    {b.entries.length} 篇 · {getLocalDateStr(new Date(b.updatedAt))}
                                                </p>
                                            </div>
                                            <button
                                                onClick={e => { e.stopPropagation(); openEditForm(b); }}
                                                className="p-2 -mt-1 -mr-1 rounded-full text-[#a79c8e] hover:bg-[#f0ece2] active:scale-90 transition-transform shrink-0 text-lg leading-none"
                                                aria-label="本子设定"
                                            >⋯</button>
                                        </div>
                                        <div className="flex items-center justify-between mt-3 pl-2">
                                            <div className="flex -space-x-2">
                                                {members.slice(0, 5).map(c => (
                                                    <img key={c.id} src={c.avatar} className="w-7 h-7 rounded-full object-cover border-2 border-white" alt={c.name} />
                                                ))}
                                                {members.length > 5 && (
                                                    <span className="w-7 h-7 rounded-full bg-[#e7ddc9] text-[#8a7a55] text-[10px] font-bold flex items-center justify-center border-2 border-white">+{members.length - 5}</span>
                                                )}
                                            </div>
                                            <span className={`w-5 h-5 rounded-md border border-[#ddd6c8] ${paper.css}`} style={paper.style} title={`信纸：${paper.name}`}></span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // ============ 视图：日记本内页 ============

    const paper = PAPER_STYLES.find(p => p.id === activeBook.paperStyle) || PAPER_STYLES[0];
    const isDark = paper.id === 'dark';
    const members = activeBook.charIds
        .map(id => characters.find(c => c.id === id))
        .filter((c): c is CharacterProfile => !!c);
    const grouped = groupEntries(activeBook.entries);

    return (
        <div className="h-full w-full bg-white flex flex-col font-light relative">
            {bookFormModal}
            {deleteBookModal}
            {deleteEntryModal}
            {composerModal}

            {/* 头部（墨色封面 + 蕾丝下边） */}
            <div className="relative pt-12 pb-5 px-5 shrink-0 z-20" style={{ background: '#2b2933' }}>
                <div className="flex items-center justify-between">
                    <button onClick={() => setActiveBookId(null)} className="scrap-btn-paper w-9 h-9 flex items-center justify-center" aria-label="返回">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5 text-[#2b2933]"><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" /></svg>
                    </button>
                    <div className="min-w-0 text-center">
                        <div className="label-mono text-[9px] text-white/45">everyone's diary</div>
                        <div className="font-hand text-2xl font-bold text-white truncate max-w-[200px]">{activeBook.title}</div>
                    </div>
                    <button onClick={() => openEditForm(activeBook)} className="scrap-btn-paper w-9 h-9 flex items-center justify-center" aria-label="本子设定">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5 text-[#2b2933]"><path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /></svg>
                    </button>
                </div>

                {/* 活跃角色切换 chips */}
                <div className="flex gap-2 mt-3 overflow-x-auto no-scrollbar pb-0.5">
                    {members.map(c => {
                        const isActive = activeBook.activeCharId === c.id;
                        return (
                            <button
                                key={c.id}
                                onClick={() => void switchActiveChar(activeBook, c.id)}
                                className={`flex items-center gap-1.5 pl-1 pr-3 py-1 rounded-full border transition-all active:scale-95 shrink-0 ${
                                    isActive ? 'bg-white border-white shadow-sm' : 'bg-white/15 border-white/30'
                                }`}
                            >
                                <Avatar src={c.avatar} name={c.name} size="w-6 h-6" />
                                <span className={`text-xs font-bold font-hand ${isActive ? 'text-[#2b2933]' : 'text-white/90'}`}>{c.name}</span>
                                {isActive && <span className="text-[9px] text-[#d8625b]">●</span>}
                            </button>
                        );
                    })}
                </div>
                <div className="lace-edge absolute left-0 right-0 -bottom-[9px]"></div>
            </div>

            {/* 操作按钮区（牛皮纸纸条工具条） */}
            <div className="px-4 py-3.5 flex gap-2 shrink-0 z-10" style={{ background: '#efe9dc', borderBottom: '1px solid rgba(180,172,156,0.5)' }}>
                <button
                    onClick={openComposer}
                    className="stationery-strip stationery-strip-ink flex-1 justify-center"
                >
                    <span className="stamp-box">✍️</span>
                    <span className="font-hand font-bold text-base">写一页</span>
                </button>
                <button
                    onClick={() => activeChar && void requestCharEntry(activeBook, activeChar)}
                    disabled={aiBusy !== null || !activeChar}
                    className="stationery-strip flex-1 justify-center disabled:opacity-50 disabled:active:scale-100"
                >
                    <span className="stamp-box">{aiBusy === 'entry' ? <Spinner /> : '📖'}</span>
                    <span className="font-hand font-bold text-base">请 TA 写</span>
                </button>
                <button
                    onClick={() => activeChar && void generateDailySummary(activeBook, activeChar)}
                    disabled={aiBusy !== null || !activeChar}
                    className="stationery-strip flex-1 justify-center disabled:opacity-50 disabled:active:scale-100"
                >
                    <span className="stamp-box">{aiBusy === 'summary' ? <Spinner /> : '💬'}</span>
                    <span className="font-hand font-bold text-base">今日总结</span>
                </button>
            </div>

            {/* AI 写作中提示条 */}
            {(aiBusy === 'entry' || aiBusy === 'summary') && activeChar && (
                <div className="px-4 py-2 bg-[#faf0ee] border-b border-[#ecc9c5] flex items-center gap-2 text-[12px] text-[#b03a34] shrink-0 font-hand">
                    <span className="text-[#d8625b]"><Spinner /></span>
                    {aiBusy === 'entry' ? `${activeChar.name} 正在写……` : `${activeChar.name} 正在回想今天……`}
                </div>
            )}

            {/* 时间线（信纸背景作用于此） */}
            <div ref={feedRef} className={`flex-1 overflow-y-auto no-scrollbar ${paper.css}`} style={paper.style}>
                <div className="p-4 pb-24 space-y-5">
                    {grouped.length === 0 && (
                        <div className={`text-center pt-20 space-y-2 ${paper.sub}`}>
                            <div className="text-4xl rotate-[-6deg]">🖋️</div>
                            <p className="font-hand text-xl">第一页还空着，写点什么吧 ✎</p>
                        </div>
                    )}
                    {grouped.map(group => (
                        <div key={group.date}>
                            {/* 日期分隔头：手写日签 + 两侧缝线 */}
                            <div className="flex items-center gap-3 mb-3">
                                <div className={`flex-1 border-t border-dashed ${isDark ? 'border-white/15' : 'border-black/10'}`}></div>
                                <span
                                    className={`font-hand text-sm font-bold px-2.5 py-0.5 rounded-md ${paper.text}`}
                                    style={{ background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.75)', border: isDark ? '1px dashed rgba(255,255,255,0.2)' : '1px dashed rgba(120,116,106,0.4)' }}
                                >{dateLabel(group.date)}</span>
                                <div className={`flex-1 border-t border-dashed ${isDark ? 'border-white/15' : 'border-black/10'}`}></div>
                            </div>

                            <div className="space-y-3.5">
                                {group.list.map((e, idx) => {
                                    const isUser = e.author === 'user';
                                    const mood = moodOf(e.mood);
                                    return (
                                        <div key={e.id} className={`flex gap-2.5 ${isUser ? 'flex-row-reverse' : ''}`}>
                                            <Polaroid src={e.avatar} name={e.authorName} tilt={isUser ? '3deg' : '-3deg'} />
                                            <div className={`max-w-[82%] min-w-0 ${isUser ? 'items-end' : 'items-start'} flex flex-col`}>
                                                {/* 作者行 */}
                                                <div className={`flex items-center gap-1.5 mb-1 px-1 ${isUser ? 'flex-row-reverse' : ''}`}>
                                                    <span className={`font-hand text-sm font-bold ${paper.text} opacity-80`}>{e.authorName}</span>
                                                    {mood && <span className="text-[14px]" title={mood.label}>{mood.emoji}</span>}
                                                    {e.isSummary && (
                                                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[#e7eef5] text-[#5b7fa6]">今日总结</span>
                                                    )}
                                                    <span className={`label-mono text-[9px] ${paper.sub}`}>{timeLabel(e.timestamp)}</span>
                                                </div>
                                                {/* 正文便签：用户右侧蜜桃描边，角色左侧奶白卡，带角落和纸胶带 */}
                                                <div
                                                    className={`relative px-4 py-3 shadow-sm border ${isUser ? 'bg-[#fdf3f0] border-[#ecc9c5]' : 'bg-white/97 border-[#ece4d3]'}`}
                                                    style={{ borderRadius: isUser ? '14px 4px 14px 14px' : '4px 14px 14px 14px', rotate: idx % 2 ? '0.5deg' : '-0.5deg' }}
                                                >
                                                    {/* 角落和纸胶带 */}
                                                    <span aria-hidden className="pointer-events-none absolute" style={{ top: -7, [isUser ? 'right' : 'left']: 12, width: 34, height: 13, transform: `rotate(${isUser ? 4 : -4}deg)`, background: isUser ? 'linear-gradient(100deg, rgba(216,98,91,0.3), rgba(216,98,91,0.15))' : 'linear-gradient(100deg, rgba(255,255,255,0.7), rgba(233,225,209,0.55))', borderLeft: '1px dashed rgba(160,156,146,0.45)', borderRight: '1px dashed rgba(160,156,146,0.45)' } as React.CSSProperties}></span>
                                                    <p className="text-[13.5px] text-[#4a463f] leading-relaxed whitespace-pre-wrap break-words">{e.content}</p>
                                                    {/* 印章 */}
                                                    {e.seals && e.seals.length > 0 && (
                                                        <div className={`flex gap-1 mt-2 flex-wrap ${isUser ? 'justify-end' : ''}`}>
                                                            {e.seals.map(k => {
                                                                const s = sealOf(k);
                                                                return s ? (
                                                                    <span key={k} className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#faf0ee] text-[#b03a34] border border-[#ecc9c5] flex items-center gap-0.5 font-hand">
                                                                        {s.emoji}{s.label}
                                                                    </span>
                                                                ) : null;
                                                            })}
                                                        </div>
                                                    )}
                                                </div>
                                                {/* ⋯ 删除 */}
                                                <button
                                                    onClick={() => setDeletingEntry(e)}
                                                    className={`mt-0.5 px-2 text-base ${paper.sub} hover:text-[#b03a34] active:scale-90 transition-transform`}
                                                    aria-label="撕掉这一页"
                                                >⋯</button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default ExchangeDiaryApp;
