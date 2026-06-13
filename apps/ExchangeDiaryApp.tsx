import React, { useEffect, useRef, useState } from 'react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { CharacterProfile, ExchangeDiaryBook, ExchangeDiaryEntry } from '../types';
import { ContextBuilder } from '../utils/context';
import Modal from '../components/os/Modal';
import { safeResponseJson } from '../utils/safeApi';
import { formatMessageForPrompt } from '../utils/messageFormat';

// ============ 常量 ============

// 心情（5 选 1，存 key）
const MOODS = [
    { key: 'sunny', emoji: '☀️', label: '晴朗' },
    { key: 'rainy', emoji: '🌧️', label: '阴雨' },
    { key: 'starry', emoji: '🌙', label: '星夜' },
    { key: 'cozy', emoji: '🫖', label: '惬意' },
    { key: 'wild', emoji: '🧭', label: '放飞' },
] as const;

// 印章（可多选，存 key）
const SEALS = [
    { key: 'secret', emoji: '🔒', label: '秘密' },
    { key: 'gratitude', emoji: '💐', label: '感恩' },
    { key: 'courage', emoji: '🔥', label: '勇气' },
    { key: 'dream', emoji: '🌙', label: '梦想' },
    { key: 'routine', emoji: '📎', label: '日常' },
] as const;

// 信纸样式：作用在整本日记的时间线背景上（与 JournalApp 的纸张概念一致，但口味不同）
const PAPER_STYLES: { id: string; name: string; css: string; text: string; sub: string; style?: React.CSSProperties }[] = [
    { id: 'plain', name: '素白', css: 'bg-[#fdfcf8]', text: 'text-slate-700', sub: 'text-slate-400' },
    {
        id: 'grid', name: '方格', css: 'bg-white', text: 'text-slate-700', sub: 'text-slate-400',
        style: { backgroundImage: 'linear-gradient(#eef0f3 1px, transparent 1px), linear-gradient(90deg, #eef0f3 1px, transparent 1px)', backgroundSize: '22px 22px' },
    },
    {
        id: 'lined', name: '横线', css: 'bg-[#fffdf2]', text: 'text-slate-700', sub: 'text-slate-400',
        style: { backgroundImage: 'repeating-linear-gradient(transparent, transparent 27px, #ecebdd 27px, #ecebdd 28px)' },
    },
    {
        id: 'pink', name: '粉色', css: 'bg-pink-50', text: 'text-slate-700', sub: 'text-pink-400/80',
        style: { backgroundImage: 'radial-gradient(#fbcfe8 1.5px, transparent 1.5px)', backgroundSize: '26px 26px' },
    },
    { id: 'dark', name: '深色', css: 'bg-slate-900', text: 'text-white/90', sub: 'text-white/40' },
];

// 写作提示（本地内置，「换一个」随机切换）
const WRITING_PROMPTS = [
    '今天最让你印象深刻的一个瞬间是什么？',
    '如果用一种天气形容今天的心情，会是什么？为什么？',
    '最近有什么小事让你偷偷开心了很久？',
    '写一件你今天本来想做、却没做成的事。',
    '此刻你最想对谁说一句什么话？',
    '今天吃到 / 看到 / 听到的最好的东西是什么？',
    '记录一个你最近反复想起的画面。',
    '如果今天可以重来一次，你想改变哪个选择？',
    '写下一个你从没告诉过别人的小习惯。',
    '最近哪个瞬间让你觉得「啊，活着真好」？',
];

const moodOf = (key?: string) => MOODS.find(m => m.key === key);
const sealOf = (key: string) => SEALS.find(s => s.key === key);

// 本地日期 YYYY-MM-DD（别用 toISOString，会偏到 UTC）
const getLocalDateStr = (d = new Date()) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};

const randomPrompt = (exclude?: string) => {
    const pool = WRITING_PROMPTS.filter(p => p !== exclude);
    return pool[Math.floor(Math.random() * pool.length)];
};

// 宽容地从 LLM 输出里抠 JSON：剥代码围栏 → 直接 parse → 截取首个 {...} 再 parse
const parseJsonLoose = (raw: string): any | null => {
    const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
    try { return JSON.parse(cleaned); } catch { /* fallthrough */ }
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
        try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { /* fallthrough */ }
    }
    return null;
};

// ============ 组件 ============

const ExchangeDiaryApp: React.FC = () => {
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
            addToast('日记本加载失败', 'error');
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
            addToast('请先创建一个角色', 'info');
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
        if (!title) { addToast('给日记本起个名字吧', 'info'); return; }
        if (bookForm.charIds.length === 0) { addToast('至少选择一位参与的角色', 'info'); return; }

        try {
            if (bookForm.id) {
                const book = books.find(b => b.id === bookForm.id);
                if (!book) return;
                // 活跃角色被移出成员时回退到第一位成员
                const activeCharId = bookForm.charIds.includes(book.activeCharId) ? book.activeCharId : bookForm.charIds[0];
                await persistBook({ ...book, title, charIds: bookForm.charIds, activeCharId, paperStyle: bookForm.paperStyle });
                addToast('日记本已更新', 'success');
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
                addToast('日记本已创建', 'success');
            }
            setBookForm(null);
        } catch (e: any) {
            addToast(`保存失败: ${e.message}`, 'error');
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
            addToast('日记本已删除', 'success');
        } catch (e: any) {
            addToast(`删除失败: ${e.message}`, 'error');
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
        if (!apiConfig.apiKey) throw new Error('请先在「文具盒」里配置 API');
        const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
            body: JSON.stringify({ model: apiConfig.model, messages, temperature }),
        });
        if (!response.ok) throw new Error(`API 请求失败 (${response.status})`);
        const data = await safeResponseJson(response);
        const content = (data.choices?.[0]?.message?.content || '').trim();
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
        if (!apiConfig.apiKey) { addToast('请先在「文具盒」里配置 API', 'error'); return; }
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
            addToast('开头已写好，接着写吧', 'success');
        } catch (e: any) {
            addToast(`起头失败: ${e.message}`, 'error');
        } finally {
            setAiBusy(null);
        }
    };

    // ============ 角色回应 ============

    // 角色以自己的口吻写一篇日记（150-250 字），并自选心情。
    // 上下文 = 完整人设 (buildCoreContext) + 用户最新一篇 + 今天的聊天节选 + 本子近况。
    const requestCharEntry = async (book: ExchangeDiaryBook, char: CharacterProfile) => {
        if (aiBusy) return;
        if (!apiConfig.apiKey) { addToast('请先在「文具盒」里配置 API', 'error'); return; }
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
            addToast(`${char.name} 写下了一篇日记`, 'success');
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
        if (!apiConfig.apiKey) { addToast('请先在「文具盒」里配置 API', 'error'); return; }
        setAiBusy('summary');
        try {
            const chatExcerpt = await getTodayChatExcerpt(char);
            if (!chatExcerpt.trim()) {
                addToast(`今天还没有和 ${char.name} 的对话`, 'info');
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
            addToast('今日对话总结已写入日记', 'success');
        } catch (e: any) {
            addToast(`总结失败: ${e.message}`, 'error');
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
        if (!content) { addToast('写点什么再发布吧', 'info'); return; }
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
            addToast('日记已发布', 'success');
            // 发布后自动请活跃角色回应一篇（未配置 API 时静默跳过，可稍后手动请 TA 写）
            if (char && apiConfig.apiKey) {
                void requestCharEntry(updated, char);
            }
        } catch (e: any) {
            addToast(`发布失败: ${e.message}`, 'error');
        }
    };

    const handleDeleteEntry = async () => {
        if (!deletingEntry || !activeBook) return;
        try {
            await persistBook({ ...activeBook, entries: activeBook.entries.filter(e => e.id !== deletingEntry.id) });
            setDeletingEntry(null);
            addToast('已删除', 'success');
        } catch (e: any) {
            addToast(`删除失败: ${e.message}`, 'error');
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
            : <div className={`${size} rounded-full bg-amber-200 text-amber-800 flex items-center justify-center text-xs font-bold shrink-0`}>{name.slice(0, 1)}</div>
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
            title={bookForm.id ? '日记本设定' : '新建日记本'}
            onClose={() => setBookForm(null)}
            footer={
                <div className="flex gap-2 w-full">
                    {bookForm.id && (
                        <button
                            onClick={() => {
                                const b = books.find(x => x.id === bookForm.id);
                                if (b) setDeletingBook(b);
                            }}
                            className="px-4 py-3 bg-red-50 text-red-500 rounded-2xl font-bold text-sm active:scale-95 transition-transform"
                        >删除</button>
                    )}
                    <button onClick={() => setBookForm(null)} className="flex-1 py-3 bg-slate-100 text-slate-500 rounded-2xl font-bold text-sm">取消</button>
                    <button onClick={submitBookForm} className="flex-1 py-3 bg-amber-500 text-white rounded-2xl font-bold text-sm active:scale-95 transition-transform">
                        {bookForm.id ? '保存' : '创建'}
                    </button>
                </div>
            }
        >
            <div className="space-y-4 max-h-[55vh] overflow-y-auto no-scrollbar pr-1">
                <div>
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">名字</label>
                    <input
                        value={bookForm.title}
                        onChange={e => setBookForm(prev => prev ? { ...prev, title: e.target.value } : prev)}
                        placeholder="比如：三人份的夏天"
                        maxLength={24}
                        className="mt-1 w-full px-4 py-3 rounded-2xl bg-slate-50 border border-slate-100 outline-none focus:border-amber-300 text-sm text-slate-700"
                    />
                </div>

                <div>
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">参与角色（可多选）</label>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                        {characters.map(c => {
                            const selected = bookForm.charIds.includes(c.id);
                            return (
                                <button
                                    key={c.id}
                                    onClick={() => toggleFormChar(c.id)}
                                    className={`flex items-center gap-2 px-3 py-2 rounded-2xl border text-left transition-all active:scale-95 ${
                                        selected ? 'bg-amber-50 border-amber-300 ring-1 ring-amber-200' : 'bg-white border-slate-100'
                                    }`}
                                >
                                    <Avatar src={c.avatar} name={c.name} size="w-8 h-8" />
                                    <span className={`text-sm truncate ${selected ? 'font-bold text-amber-800' : 'text-slate-600'}`}>{c.name}</span>
                                    {selected && <span className="ml-auto text-amber-500 text-xs">✓</span>}
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div>
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">信纸</label>
                    <div className="mt-2 flex gap-2 flex-wrap">
                        {PAPER_STYLES.map(p => (
                            <button
                                key={p.id}
                                onClick={() => setBookForm(prev => prev ? { ...prev, paperStyle: p.id } : prev)}
                                className={`flex flex-col items-center gap-1 active:scale-95 transition-transform`}
                            >
                                <span
                                    className={`w-12 h-12 rounded-xl border ${p.css} ${
                                        bookForm.paperStyle === p.id ? 'border-amber-400 ring-2 ring-amber-300' : 'border-slate-200'
                                    }`}
                                    style={p.style}
                                />
                                <span className={`text-[10px] ${bookForm.paperStyle === p.id ? 'text-amber-600 font-bold' : 'text-slate-400'}`}>{p.name}</span>
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </Modal>
    ) : null;

    // ============ 弹窗：删除确认 ============

    const deleteBookModal = deletingBook ? (
        <Modal
            isOpen={true}
            title="删除日记本"
            onClose={() => setDeletingBook(null)}
            footer={
                <div className="flex gap-2 w-full">
                    <button onClick={() => setDeletingBook(null)} className="flex-1 py-3 bg-slate-100 text-slate-500 rounded-2xl font-bold text-sm">取消</button>
                    <button onClick={handleDeleteBook} className="flex-1 py-3 bg-red-500 text-white rounded-2xl font-bold text-sm">删除</button>
                </div>
            }
        >
            <p className="text-sm text-slate-600 leading-relaxed">
                确定要删除《{deletingBook.title}》吗？里面的 {deletingBook.entries.length} 篇日记会一并消失，无法恢复。
            </p>
        </Modal>
    ) : null;

    const deleteEntryModal = deletingEntry ? (
        <Modal
            isOpen={true}
            title="删除这篇日记"
            onClose={() => setDeletingEntry(null)}
            footer={
                <div className="flex gap-2 w-full">
                    <button onClick={() => setDeletingEntry(null)} className="flex-1 py-3 bg-slate-100 text-slate-500 rounded-2xl font-bold text-sm">取消</button>
                    <button onClick={handleDeleteEntry} className="flex-1 py-3 bg-red-500 text-white rounded-2xl font-bold text-sm">删除</button>
                </div>
            }
        >
            <p className="text-sm text-slate-600 leading-relaxed">
                {deletingEntry.authorName} 在 {deletingEntry.date} 写的这篇会被永久删除。
            </p>
        </Modal>
    ) : null;

    // ============ 弹窗：写日记 composer ============

    const composerModal = composerOpen && activeBook ? (
        <Modal
            isOpen={true}
            title="写今天的日记"
            onClose={() => setComposerOpen(false)}
            footer={
                <div className="flex gap-2 w-full">
                    <button onClick={() => setComposerOpen(false)} className="flex-1 py-3 bg-slate-100 text-slate-500 rounded-2xl font-bold text-sm">取消</button>
                    <button
                        onClick={publishUserEntry}
                        disabled={!draftContent.trim()}
                        className="flex-1 py-3 bg-amber-500 text-white rounded-2xl font-bold text-sm active:scale-95 transition-transform disabled:opacity-40 disabled:active:scale-100"
                    >发布</button>
                </div>
            }
        >
            <div className="space-y-3 max-h-[55vh] overflow-y-auto no-scrollbar pr-1">
                {/* 写作提示 */}
                <div className="rounded-2xl bg-amber-50 border border-amber-100 px-3 py-2.5">
                    <div className="flex items-start gap-2">
                        <span className="text-base leading-none mt-0.5">💡</span>
                        <p className="flex-1 text-[13px] text-amber-800 leading-relaxed">{currentPrompt}</p>
                    </div>
                    <div className="flex gap-2 mt-2">
                        <button
                            onClick={() => setCurrentPrompt(p => randomPrompt(p))}
                            className="px-3 py-1.5 rounded-full bg-white border border-amber-200 text-amber-600 text-[11px] font-bold active:scale-95 transition-transform"
                        >换一个</button>
                        <button
                            onClick={handleAiOpening}
                            disabled={aiBusy !== null}
                            className="px-3 py-1.5 rounded-full bg-amber-500 text-white text-[11px] font-bold active:scale-95 transition-transform disabled:opacity-50 flex items-center gap-1.5"
                        >
                            {aiBusy === 'opening' ? <Spinner /> : '✨'} AI 帮我起头
                        </button>
                    </div>
                </div>

                {/* 心情 */}
                <div>
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">今天的心情</label>
                    <div className="mt-1.5 flex gap-1.5">
                        {MOODS.map(m => (
                            <button
                                key={m.key}
                                onClick={() => setDraftMood(m.key)}
                                className={`flex-1 flex flex-col items-center gap-0.5 py-2 rounded-xl border transition-all active:scale-95 ${
                                    draftMood === m.key ? 'bg-amber-50 border-amber-300 ring-1 ring-amber-200' : 'bg-white border-slate-100'
                                }`}
                            >
                                <span className="text-lg leading-none">{m.emoji}</span>
                                <span className={`text-[10px] ${draftMood === m.key ? 'text-amber-700 font-bold' : 'text-slate-400'}`}>{m.label}</span>
                            </button>
                        ))}
                    </div>
                </div>

                {/* 印章 */}
                <div>
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">盖个印章（可多选）</label>
                    <div className="mt-1.5 flex gap-1.5 flex-wrap">
                        {SEALS.map(s => (
                            <button
                                key={s.key}
                                onClick={() => toggleSeal(s.key)}
                                className={`px-2.5 py-1.5 rounded-full border text-[11px] flex items-center gap-1 transition-all active:scale-95 ${
                                    draftSeals.includes(s.key) ? 'bg-rose-50 border-rose-300 text-rose-600 font-bold' : 'bg-white border-slate-100 text-slate-400'
                                }`}
                            >
                                <span>{s.emoji}</span>{s.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* 正文 */}
                <textarea
                    value={draftContent}
                    onChange={e => setDraftContent(e.target.value)}
                    placeholder="今天发生了什么……"
                    rows={6}
                    className="w-full px-4 py-3 rounded-2xl bg-slate-50 border border-slate-100 outline-none focus:border-amber-300 text-sm text-slate-700 leading-relaxed resize-none"
                />
                {activeChar && (
                    <p className="text-[11px] text-slate-400">发布后会自动请「{activeChar.name}」也写一篇回应。</p>
                )}
            </div>
        </Modal>
    ) : null;

    // ============ 视图：书架 ============

    if (!activeBook) {
        return (
            <div className="h-full w-full bg-amber-50 flex flex-col font-light">
                {bookFormModal}
                {deleteBookModal}
                <div className="pt-12 pb-4 px-6 border-b border-amber-100 bg-amber-50/80 backdrop-blur-sm sticky top-0 z-20 flex items-center justify-between shrink-0">
                    <button onClick={closeApp} className="p-2 -ml-2 rounded-full hover:bg-amber-100/50 active:scale-90 transition-transform">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6 text-amber-900"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
                    </button>
                    <span className="font-bold text-amber-900 text-lg tracking-wide">日记社</span>
                    <button onClick={openCreateForm} className="p-2 -mr-2 rounded-full hover:bg-amber-100/50 active:scale-90 transition-transform">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6 text-amber-900"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-5 pb-20 no-scrollbar">
                    {books.length === 0 ? (
                        <div className="flex flex-col items-center justify-center gap-3 pt-24 text-center">
                            <span className="text-5xl">📔</span>
                            <p className="text-sm text-amber-800/70 font-medium">还没有日记本</p>
                            <p className="text-xs text-amber-600/60 max-w-[220px] leading-relaxed">建一本，拉上喜欢的角色们，一起写交换日记吧</p>
                            <button onClick={openCreateForm} className="mt-2 px-6 py-3 bg-amber-500 text-white rounded-2xl font-bold text-sm active:scale-95 transition-transform shadow-md shadow-amber-200">
                                + 新建日记本
                            </button>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {books.map(b => {
                                const members = b.charIds
                                    .map(id => characters.find(c => c.id === id))
                                    .filter((c): c is CharacterProfile => !!c);
                                const paper = PAPER_STYLES.find(p => p.id === b.paperStyle) || PAPER_STYLES[0];
                                return (
                                    <div
                                        key={b.id}
                                        onClick={() => setActiveBookId(b.id)}
                                        className="relative bg-white rounded-r-2xl rounded-l-md border-l-4 border-l-amber-700 shadow-[2px_4px_12px_rgba(0,0,0,0.08)] p-4 cursor-pointer active:scale-[0.98] transition-all overflow-hidden"
                                    >
                                        <div className="absolute inset-y-0 left-0 w-2 bg-gradient-to-r from-black/10 to-transparent pointer-events-none"></div>
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0">
                                                <h3 className="font-bold text-amber-900 text-base truncate">{b.title}</h3>
                                                <p className="text-[11px] text-slate-400 mt-0.5 font-mono">
                                                    {b.entries.length} 篇 · {getLocalDateStr(new Date(b.updatedAt))}
                                                </p>
                                            </div>
                                            <button
                                                onClick={e => { e.stopPropagation(); openEditForm(b); }}
                                                className="p-2 -mt-1 -mr-1 rounded-full text-slate-400 hover:bg-slate-50 active:scale-90 transition-transform shrink-0"
                                                aria-label="日记本设定"
                                            >⋯</button>
                                        </div>
                                        <div className="flex items-center justify-between mt-3">
                                            <div className="flex -space-x-2">
                                                {members.slice(0, 5).map(c => (
                                                    <img key={c.id} src={c.avatar} className="w-7 h-7 rounded-full object-cover border-2 border-white" alt={c.name} />
                                                ))}
                                                {members.length > 5 && (
                                                    <span className="w-7 h-7 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold flex items-center justify-center border-2 border-white">+{members.length - 5}</span>
                                                )}
                                            </div>
                                            <span className={`w-5 h-5 rounded-md border border-slate-200 ${paper.css}`} style={paper.style} title={`信纸: ${paper.name}`}></span>
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

            {/* 头部 */}
            <div className="pt-12 pb-4 px-5 bg-amber-500 shadow-lg shrink-0 rounded-b-[1.5rem] z-20">
                <div className="flex items-center justify-between">
                    <button onClick={() => setActiveBookId(null)} className="p-2 -ml-2 text-white/80 hover:text-white active:scale-90 transition-transform">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" /></svg>
                    </button>
                    <div className="min-w-0 text-center">
                        <div className="text-[10px] text-white/70 uppercase tracking-widest font-bold">Exchange Diary Club</div>
                        <div className="text-lg font-bold text-white truncate max-w-[180px]">{activeBook.title}</div>
                    </div>
                    <button onClick={() => openEditForm(activeBook)} className="p-2 -mr-2 text-white/80 hover:text-white active:scale-90 transition-transform" aria-label="日记本设定">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /></svg>
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
                                <span className={`text-xs font-bold ${isActive ? 'text-amber-700' : 'text-white/90'}`}>{c.name}</span>
                                {isActive && <span className="text-[9px] text-amber-500">●</span>}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* 操作按钮区 */}
            <div className="px-4 py-3 flex gap-2 bg-white border-b border-slate-100 shrink-0 z-10">
                <button
                    onClick={openComposer}
                    className="flex-1 py-2.5 rounded-2xl bg-amber-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 active:scale-95 transition-transform shadow-sm shadow-amber-200"
                >✍️ 写日记</button>
                <button
                    onClick={() => activeChar && void requestCharEntry(activeBook, activeChar)}
                    disabled={aiBusy !== null || !activeChar}
                    className="flex-1 py-2.5 rounded-2xl bg-amber-50 border border-amber-200 text-amber-700 text-xs font-bold flex items-center justify-center gap-1.5 active:scale-95 transition-transform disabled:opacity-50 disabled:active:scale-100"
                >
                    {aiBusy === 'entry' ? <Spinner /> : '📖'} 请 TA 写一篇
                </button>
                <button
                    onClick={() => activeChar && void generateDailySummary(activeBook, activeChar)}
                    disabled={aiBusy !== null || !activeChar}
                    className="flex-1 py-2.5 rounded-2xl bg-slate-50 border border-slate-200 text-slate-600 text-xs font-bold flex items-center justify-center gap-1.5 active:scale-95 transition-transform disabled:opacity-50 disabled:active:scale-100"
                >
                    {aiBusy === 'summary' ? <Spinner /> : '💬'} 今日对话总结
                </button>
            </div>

            {/* AI 写作中提示条 */}
            {(aiBusy === 'entry' || aiBusy === 'summary') && activeChar && (
                <div className="px-4 py-2 bg-amber-50 border-b border-amber-100 flex items-center gap-2 text-[11px] text-amber-700 shrink-0">
                    <span className="text-amber-500"><Spinner /></span>
                    {aiBusy === 'entry' ? `${activeChar.name} 正在写日记…` : `${activeChar.name} 正在回顾今天的对话…`}
                </div>
            )}

            {/* 时间线（信纸背景作用于此） */}
            <div ref={feedRef} className={`flex-1 overflow-y-auto no-scrollbar ${paper.css}`} style={paper.style}>
                <div className="p-4 pb-24 space-y-5">
                    {grouped.length === 0 && (
                        <div className={`text-center pt-20 space-y-2 ${paper.sub}`}>
                            <div className="text-4xl">🖋️</div>
                            <p className="text-sm">第一页还空着，写点什么吧</p>
                        </div>
                    )}
                    {grouped.map(group => (
                        <div key={group.date}>
                            {/* 日期分隔头 */}
                            <div className="flex items-center gap-3 mb-3">
                                <div className={`flex-1 h-px ${isDark ? 'bg-white/10' : 'bg-black/5'}`}></div>
                                <span className={`text-[11px] font-mono font-bold ${paper.sub}`}>{dateLabel(group.date)}</span>
                                <div className={`flex-1 h-px ${isDark ? 'bg-white/10' : 'bg-black/5'}`}></div>
                            </div>

                            <div className="space-y-3">
                                {group.list.map(e => {
                                    const isUser = e.author === 'user';
                                    const mood = moodOf(e.mood);
                                    return (
                                        <div key={e.id} className={`flex gap-2.5 ${isUser ? 'flex-row-reverse' : ''}`}>
                                            <Avatar src={e.avatar} name={e.authorName} />
                                            <div className={`max-w-[82%] min-w-0 ${isUser ? 'items-end' : 'items-start'} flex flex-col`}>
                                                {/* 作者行 */}
                                                <div className={`flex items-center gap-1.5 mb-1 px-1 ${isUser ? 'flex-row-reverse' : ''}`}>
                                                    <span className={`text-[11px] font-bold ${paper.text} opacity-70`}>{e.authorName}</span>
                                                    {mood && <span className="text-[13px]" title={mood.label}>{mood.emoji}</span>}
                                                    {e.isSummary && (
                                                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-sky-100 text-sky-600">对话总结</span>
                                                    )}
                                                    <span className={`text-[10px] font-mono ${paper.sub}`}>{timeLabel(e.timestamp)}</span>
                                                </div>
                                                {/* 正文卡片：用户右侧琥珀描边，角色左侧白卡 */}
                                                <div className={`relative rounded-2xl px-4 py-3 shadow-sm border ${
                                                    isUser
                                                        ? 'bg-amber-50/95 border-amber-200 rounded-tr-md'
                                                        : 'bg-white/95 border-black/5 rounded-tl-md'
                                                }`}>
                                                    <p className="text-[13.5px] text-slate-700 leading-relaxed whitespace-pre-wrap break-words">{e.content}</p>
                                                    {/* 印章 */}
                                                    {e.seals && e.seals.length > 0 && (
                                                        <div className={`flex gap-1 mt-2 flex-wrap ${isUser ? 'justify-end' : ''}`}>
                                                            {e.seals.map(k => {
                                                                const s = sealOf(k);
                                                                return s ? (
                                                                    <span key={k} className="text-[10px] px-1.5 py-0.5 rounded-full bg-rose-50 text-rose-500 border border-rose-100 flex items-center gap-0.5">
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
                                                    className={`mt-0.5 px-2 text-xs ${paper.sub} hover:text-red-400 active:scale-90 transition-transform`}
                                                    aria-label="删除这篇日记"
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
