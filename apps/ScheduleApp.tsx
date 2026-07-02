import React, { useState, useEffect, useMemo } from 'react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { Task, Anniversary } from '../types';
import { ContextBuilder } from '../utils/context';
import { extractContent } from '../utils/safeApi';
import { resolveAuxApi } from '../utils/auxApi';
import { injectMemoryPalace } from '../utils/memoryPalace/pipeline';
import { callChatCompletion } from '../utils/llmClient';
import { makeApiUsageMeta } from '../utils/apiUsageCatalog';
import { PaperPage, PaperNote, TapeLabel, Postmark, PaperClip, HAND_FONT, tinyRotate } from './almanac/handbookKit';

/**
 * 岁时记 ·「时光契约」（拼贴手账风）
 * ------------------------------------------------------------
 * 要做的事钉成约定（角色当监督人，完成后 AI 给一句验收点评），
 * 在意的日子贴上纪念日并倒数（AI 按人设写一句感想，24h 缓存）。
 * 玩法、数据、AI 链路全部沿用原版，只把界面 / 文案 / 主题 / 弹窗换成手账。
 * 三套手账主题（牛皮纸 / 方格本 / 便利贴）可一键翻面，记忆在 localStorage。
 */

type ThemeId = 'kraft' | 'grid' | 'sticky';

interface HbTheme {
    id: ThemeId;
    paper: 'kraft' | 'grid' | 'sticky';
    name: string;
    ink: string;       // 主文字
    inkSoft: string;   // 次要文字
    accent: string;    // 强调（印章 / 今日 / 主按钮）
    noteBg: string;    // 纸片底
    tabTodo: string;   // 左 Tab 文案
    tabDays: string;   // 右 Tab 文案
    switchEmoji: string;
}

const THEMES: Record<ThemeId, HbTheme> = {
    // 三套纸面统一走黑白灰：保留牛皮纸 / 方格本 / 便利贴的纸纹身份，强调色由彩色改墨灰。
    kraft: {
        id: 'kraft', paper: 'kraft', name: '牛皮纸',
        ink: '#3a342c', inkSoft: '#8a8276', accent: '#2c2823',
        noteBg: '#faf7f0',
        tabTodo: '要做的事', tabDays: '数着的日子', switchEmoji: '📜',
    },
    grid: {
        id: 'grid', paper: 'grid', name: '方格本',
        ink: '#33312c', inkSoft: '#857f74', accent: '#3a352e',
        noteBg: '#fbfaf6',
        tabTodo: '清单', tabDays: '倒数日', switchEmoji: '🟩',
    },
    sticky: {
        id: 'sticky', paper: 'sticky', name: '便利贴',
        ink: '#3a342c', inkSoft: '#908a7e', accent: '#1f1d1a',
        noteBg: '#f7f4ec',
        tabTodo: '便签事', tabDays: '惦记日', switchEmoji: '🟨',
    },
};
const THEME_ORDER: ThemeId[] = ['kraft', 'grid', 'sticky'];

/** onExit：当本 App 嵌在「岁时记」壳里时，顶层返回回到岁时记封面页而非直接关到桌面。未传则回桌面。 */
const ScheduleApp: React.FC<{ onExit?: () => void }> = ({ onExit }) => {
    const { closeApp, characters, activeCharacterId, apiConfig, auxApiConfig, addToast, userProfile } = useOS();
    // 日程表（TA 的日程）属「聊天以外」的功能：走副 API（未配置副 API 时回退主 API）
    const auxApi = { ...apiConfig, ...resolveAuxApi(auxApiConfig, apiConfig) };
    const exitApp = onExit ?? closeApp;
    const [tasks, setTasks] = useState<Task[]>([]);
    const [anniversaries, setAnniversaries] = useState<Anniversary[]>([]);
    const [activeTab, setActiveTab] = useState<'quest' | 'server_events'>('quest');

    // Processing State for feedback
    const [processingTaskIds, setProcessingTaskIds] = useState<Set<string>>(new Set());

    // Theme State
    const [themeId, setThemeId] = useState<ThemeId>('kraft');
    const theme = THEMES[themeId];

    // Add Modal States
    const [showTaskModal, setShowTaskModal] = useState(false);
    const [showAnniModal, setShowAnniModal] = useState(false);

    // Forms
    const [newTaskTitle, setNewTaskTitle] = useState('');
    const [newTaskSupervisor, setNewTaskSupervisor] = useState<string>(activeCharacterId || '');

    const [newAnniTitle, setNewAnniTitle] = useState('');
    const [newAnniDate, setNewAnniDate] = useState('');
    const [newAnniChar, setNewAnniChar] = useState<string>(activeCharacterId || '');

    useEffect(() => {
        loadData();
        const saved = localStorage.getItem('almanac_promise_theme');
        if (saved && THEMES[saved as ThemeId]) {
            setThemeId(saved as ThemeId);
        }
    }, []);

    const toggleTheme = () => {
        const nextIndex = (THEME_ORDER.indexOf(themeId) + 1) % THEME_ORDER.length;
        const nextMode = THEME_ORDER[nextIndex];
        setThemeId(nextMode);
        localStorage.setItem('almanac_promise_theme', nextMode);
        addToast(`翻到「${THEMES[nextMode].name}」`, 'info');
    };

    const loadData = async () => {
        const [t, a] = await Promise.all([DB.getAllTasks(), DB.getAllAnniversaries()]);
        setTasks(t.sort((a, b) => b.createdAt - a.createdAt));
        setAnniversaries(a.sort((a, b) => a.date.localeCompare(b.date)));
    };

    // --- AI Logic（沿用原版，未改动行为） ---

    const generateTaskReward = async (task: Task) => {
        const supervisor = characters.find(c => c.id === task.supervisorId);
        if (!supervisor || !auxApi.baseUrl || !auxApi.model) {
            addToast('任务已完成', 'success');
            return;
        }

        addToast(`${supervisor.name} 正在确认你的成果...`, 'info');

        try {
            await injectMemoryPalace(supervisor, undefined, task.title);
            const baseContext = ContextBuilder.buildCoreContext(supervisor, userProfile);

            const userPrompt = `
### 场景：任务完成 (Task Completed)
用户 (${userProfile.name}) 刚刚在现实生活中完成了一个任务/契约： "${task.title}"。
你是监督人。

### 任务
请根据你的人设，对用户完成任务这一行为做出反应。
- 如果你是严厉的：勉强认可，或者催促下一个。
- 如果你是温柔的：给予温暖的夸奖。
- 如果你是傲娇的：别扭地表示一下。
- **关键**：不要问我用什么语气，**你自己**根据你的人设决定。

**输出要求**:
- 仅输出一句话（类似气泡通知）。
- **必须使用用户常用语言**。
- 不要有引号。`;

            const messages = [
                { role: "system", content: baseContext },
                { role: "user", content: userPrompt }
            ];

            const data = await callChatCompletion(auxApi, {
                model: auxApi.model,
                messages: messages,
                temperature: 0.9,
                max_tokens: 8000
            }, {
                meta: makeApiUsageMeta('almanac.scheduleGenerate', {
                    charId: supervisor.id,
                    charName: supervisor.name,
                    apiRole: auxApi.apiRole || 'aux',
                    apiBinding: auxApi.apiBinding || '时光契约',
                }),
            });

            let text = extractContent(data)?.trim();
            if (!text && data.choices?.[0]?.message?.reasoning_content) {
                console.warn("AI returned empty content but has reasoning.");
            }

            if (text) {
                text = text.replace(/^["']|["']$/g, '');
                addToast(`${supervisor.name}: ${text}`, 'success');
                await DB.saveMessage({
                    charId: supervisor.id,
                    role: 'system',
                    type: 'text',
                    content: `[系统: ${userProfile.name} 完成了任务 "${task.title}"。${supervisor.name} 评价道: "${text}"]`
                });
            } else {
                console.warn("AI returned empty content", data);
                addToast('任务完成 (AI 未返回评价)', 'success');
            }

        } catch (e: any) {
            console.error("Task Reward Error:", e);
            addToast(`评价生成失败: ${e.message}`, 'error');
        }
    };

    const generateAnniversaryThought = async (anni: Anniversary) => {
        const char = characters.find(c => c.id === anni.charId);
        if (!char || !auxApi.baseUrl || !auxApi.model) return;

        // Check cache (24h)
        if (anni.aiThought && anni.lastThoughtGeneratedAt && (Date.now() - anni.lastThoughtGeneratedAt < 24 * 60 * 60 * 1000)) {
            return;
        }

        if (Date.now() - (anni.lastThoughtGeneratedAt || 0) > 10000) {
             addToast(`${char.name} 正在查阅日历...`, 'info');
        }

        const daysDiff = Math.ceil((new Date(anni.date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
        const dayText = daysDiff > 0 ? `还有 ${daysDiff} 天` : (daysDiff === 0 ? '就是今天!' : `已经过去 ${Math.abs(daysDiff)} 天了`);

        await injectMemoryPalace(char, undefined, anni.title);
        const baseContext = ContextBuilder.buildCoreContext(char, userProfile);

        const userPrompt = `
### 场景：纪念日提醒
事件: "${anni.title}"
时间状态: ${dayText}

### 任务
请根据你的人设，针对这个日期发表一句简短的感想。
**输出要求**:
- 仅输出一句话。
- **必须使用用户常用语言**。`;

        const messages = [
            { role: "system", content: baseContext },
            { role: "user", content: userPrompt }
        ];

        try {
            const data = await callChatCompletion(auxApi, {
                model: auxApi.model,
                messages: messages,
                temperature: 0.8,
                max_tokens: 8000
            }, {
                meta: makeApiUsageMeta('almanac.scheduleGenerate', {
                    charId: char.id,
                    charName: char.name,
                    apiRole: auxApi.apiRole || 'aux',
                    apiBinding: auxApi.apiBinding || '时光契约',
                }),
            });
            const text = extractContent(data)?.trim().replace(/^["']|["']$/g, '');

            if (text) {
                const updatedAnni = { ...anni, aiThought: text, lastThoughtGeneratedAt: Date.now() };
                await DB.saveAnniversary(updatedAnni);
                setAnniversaries(prev => prev.map(a => a.id === anni.id ? updatedAnni : a));
            } else {
                console.warn("AI returned empty thought", data);
            }
        } catch (e: any) {
            console.error("Anniversary Thought Error:", e);
        }
    };

    // --- Actions ---

    const handleAddTask = async () => {
        if (!newTaskTitle.trim()) return;
        const task: Task = {
            id: `task-${Date.now()}`,
            title: newTaskTitle,
            supervisorId: newTaskSupervisor || characters[0]?.id,
            tone: 'gentle',
            isCompleted: false,
            createdAt: Date.now()
        };
        await DB.saveTask(task);
        setTasks(prev => [task, ...prev]);
        setShowTaskModal(false);
        setNewTaskTitle('');
    };

    const handleToggleTask = async (task: Task) => {
        const updated = { ...task, isCompleted: !task.isCompleted, completedAt: !task.isCompleted ? Date.now() : undefined };
        await DB.saveTask(updated);
        setTasks(prev => prev.map(t => t.id === task.id ? updated : t));

        if (updated.isCompleted) {
            setProcessingTaskIds(prev => new Set(prev).add(task.id));
            try {
                await generateTaskReward(updated);
            } finally {
                setProcessingTaskIds(prev => {
                    const next = new Set(prev);
                    next.delete(task.id);
                    return next;
                });
            }
        }
    };

    const handleDeleteTask = async (id: string) => {
        await DB.deleteTask(id);
        setTasks(prev => prev.filter(t => t.id !== id));
    };

    const handleAddAnni = async () => {
        if (!newAnniTitle.trim() || !newAnniDate) return;
        const anni: Anniversary = {
            id: `anni-${Date.now()}`,
            title: newAnniTitle,
            date: newAnniDate,
            charId: newAnniChar || characters[0]?.id
        };
        await DB.saveAnniversary(anni);
        setAnniversaries(prev => [...prev, anni].sort((a, b) => a.date.localeCompare(b.date)));
        setShowAnniModal(false);
        setNewAnniTitle('');
        setNewAnniDate('');
    };

    const handleDeleteAnni = async (id: string) => {
        await DB.deleteAnniversary(id);
        setAnniversaries(prev => prev.filter(a => a.id !== id));
    };

    // --- Render Helpers ---

    const getDaysUntil = (dateStr: string) => {
        const today = new Date();
        today.setHours(0,0,0,0);
        const target = new Date(dateStr);
        target.setHours(0,0,0,0);
        const diff = target.getTime() - today.getTime();
        return Math.ceil(diff / (1000 * 60 * 60 * 24));
    };

    const upcomingAnni = useMemo(() => {
        return anniversaries.filter(a => getDaysUntil(a.date) >= 0).sort((a, b) => a.date.localeCompare(b.date))[0];
    }, [anniversaries]);

    useEffect(() => {
        if (upcomingAnni) {
            generateAnniversaryThought(upcomingAnni);
        }
    }, [upcomingAnni]);

    const openTasks = tasks.filter(t => !t.isCompleted);
    const doneTasks = tasks.filter(t => t.isCompleted);

    // 选人小列表（任务监督人 / 纪念日关联对象共用）
    const CharPicker = ({ value, onPick }: { value: string; onPick: (id: string) => void }) => (
        <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1">
            {characters.length === 0 && <span className="text-[12px]" style={{ color: theme.inkSoft }}>还没有角色</span>}
            {characters.map(c => {
                const on = value === c.id;
                return (
                    <button key={c.id} onClick={() => onPick(c.id)} className="flex flex-col items-center gap-1 shrink-0 active:scale-95 transition-transform">
                        {c.avatar?.startsWith('http') || c.avatar?.startsWith('data:')
                            ? <img src={c.avatar} className="w-12 h-12 rounded-full object-cover" style={{ border: on ? `2.5px solid ${theme.accent}` : '2.5px solid transparent', opacity: on ? 1 : 0.55 }} />
                            : <span className="w-12 h-12 rounded-full flex items-center justify-center text-xl" style={{ background: '#f3ead7', border: on ? `2.5px solid ${theme.accent}` : '2.5px solid transparent', opacity: on ? 1 : 0.55 }}>{c.avatar || '🌸'}</span>}
                        <span className="text-[10px] font-bold whitespace-nowrap" style={{ color: on ? theme.ink : theme.inkSoft }}>{c.name}</span>
                    </button>
                );
            })}
        </div>
    );

    return (
        <PaperPage kind={theme.paper}>
            <div className="h-full flex flex-col" style={{ color: theme.ink }}>
                {/* 顶栏 */}
                <div className="relative flex items-center justify-between px-4 pt-12 pb-3 shrink-0 z-20">
                    <button onClick={exitApp} className="px-3 py-1.5 text-[12px] font-bold active:scale-95 transition-transform" style={{ background: theme.noteBg, boxShadow: '0 2px 6px rgba(96,66,40,0.18)', transform: 'rotate(-1.5deg)', color: theme.inkSoft }}>
                        ← 回封面
                    </button>

                    {/* Tab：两枚票签 */}
                    <div className="flex gap-1.5">
                        <button onClick={() => setActiveTab('quest')} className="active:scale-95 transition-transform" style={{ opacity: activeTab === 'quest' ? 1 : 0.5 }}>
                            <TapeLabel color={activeTab === 'quest' ? theme.accent : '#e3d6bf'} textColor={activeTab === 'quest' ? '#fff7ef' : theme.inkSoft} rotate={-2}>{theme.tabTodo}</TapeLabel>
                        </button>
                        <button onClick={() => setActiveTab('server_events')} className="active:scale-95 transition-transform" style={{ opacity: activeTab === 'server_events' ? 1 : 0.5 }}>
                            <TapeLabel color={activeTab === 'server_events' ? theme.accent : '#e3d6bf'} textColor={activeTab === 'server_events' ? '#fff7ef' : theme.inkSoft} rotate={2}>{theme.tabDays}</TapeLabel>
                        </button>
                    </div>

                    <div className="flex items-center gap-1">
                        <button onClick={toggleTheme} className="w-9 h-9 rounded-full flex items-center justify-center text-lg active:scale-90 transition-transform" style={{ background: theme.noteBg, boxShadow: '0 2px 6px rgba(96,66,40,0.18)' }} title="翻面换纸">
                            {theme.switchEmoji}
                        </button>
                        <button onClick={() => activeTab === 'quest' ? setShowTaskModal(true) : setShowAnniModal(true)} className="w-9 h-9 rounded-full flex items-center justify-center text-xl font-black active:scale-90 transition-transform" style={{ background: theme.accent, color: '#fff7ef', boxShadow: '0 2px 6px rgba(96,66,40,0.22)' }} title="贴一张新的">
                            ＋
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto no-scrollbar px-5 pb-10 z-10">
                    {/* 即将到来的日子 —— Hero */}
                    {upcomingAnni && (
                        <PaperNote className="mt-2 mb-6 px-5 py-5" rotate={-1} bg={theme.noteBg}>
                            <PaperClip className="-top-3 left-7" color="#b6a78c" />
                            <div className="flex items-start justify-between">
                                <div>
                                    <TapeLabel color={theme.accent} textColor="#fff7ef">最近就到</TapeLabel>
                                    <div className="text-[20px] font-black mt-2" style={{ fontFamily: HAND_FONT, color: theme.ink }}>{upcomingAnni.title}</div>
                                </div>
                                <div className="text-right shrink-0 pl-2" style={{ fontFamily: HAND_FONT }}>
                                    <div className="text-[40px] leading-none font-black" style={{ color: theme.accent }}>{getDaysUntil(upcomingAnni.date)}</div>
                                    <div className="text-[11px]" style={{ color: theme.inkSoft }}>天以后</div>
                                </div>
                            </div>
                            {/* 角色感想 */}
                            <div className="mt-4 flex items-start gap-2.5 px-3 py-2.5" style={{ background: '#fff', borderRadius: 12, boxShadow: 'inset 0 0 0 1px rgba(150,110,70,0.12)' }}>
                                {(() => {
                                    const ch = characters.find(c => c.id === upcomingAnni.charId);
                                    return ch?.avatar?.startsWith('http') || ch?.avatar?.startsWith('data:')
                                        ? <img src={ch!.avatar} className="w-8 h-8 rounded-full object-cover shrink-0" />
                                        : <span className="w-8 h-8 rounded-full flex items-center justify-center text-base shrink-0" style={{ background: '#f3ead7' }}>{ch?.avatar || '🌸'}</span>;
                                })()}
                                <div className="text-[13px] leading-relaxed" style={{ color: theme.ink, fontFamily: HAND_FONT }}>
                                    「{upcomingAnni.aiThought || '让 ta 翻翻日历……'}」
                                </div>
                            </div>
                        </PaperNote>
                    )}

                    {/* 要做的事 Tab */}
                    {activeTab === 'quest' && (
                        <div>
                            <div className="flex items-center gap-2 mb-3 pl-1">
                                <span className="w-2.5 h-2.5 rounded-full animate-pulse" style={{ background: theme.accent }} />
                                <h3 className="text-[14px] font-black" style={{ fontFamily: HAND_FONT, color: theme.ink }}>正钉着的约定</h3>
                            </div>

                            {openTasks.length === 0 && (
                                <div className="text-center py-12" style={{ border: `2px dashed ${theme.inkSoft}55`, borderRadius: 16 }}>
                                    <div className="text-[28px] mb-1">🧷</div>
                                    <div className="text-[12px]" style={{ color: theme.inkSoft }}>还没钉上任何约定</div>
                                </div>
                            )}

                            <div className="space-y-4">
                                {openTasks.map(task => {
                                    const supervisor = characters.find(c => c.id === task.supervisorId);
                                    const isProcessing = processingTaskIds.has(task.id);
                                    return (
                                        <PaperNote key={task.id} className="px-4 py-4" rotate={tinyRotate(task.id)} bg={theme.noteBg}>
                                            <div className="flex items-center gap-3">
                                                <div className="relative shrink-0">
                                                    {supervisor?.avatar?.startsWith('http') || supervisor?.avatar?.startsWith('data:')
                                                        ? <img src={supervisor!.avatar} className="w-12 h-12 rounded-full object-cover" style={{ border: '2px solid #fff' }} />
                                                        : <span className="w-12 h-12 rounded-full flex items-center justify-center text-xl" style={{ background: '#f3ead7' }}>{supervisor?.avatar || '👤'}</span>}
                                                    <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black" style={{ background: theme.accent, color: '#fff7ef' }}>盯</span>
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-[15px] font-bold leading-snug" style={{ fontFamily: HAND_FONT, color: theme.ink }}>{task.title}</div>
                                                    <div className="text-[10px] mt-0.5" style={{ color: theme.inkSoft }}>监督人 · {supervisor?.name || '未指定'}</div>
                                                </div>
                                                {isProcessing ? (
                                                    <div className="flex items-center gap-1.5 px-2 shrink-0">
                                                        <span className="w-3 h-3 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: `${theme.accent}`, borderTopColor: 'transparent' }} />
                                                        <span className="text-[10px] font-bold animate-pulse" style={{ color: theme.accent }}>验收中</span>
                                                    </div>
                                                ) : (
                                                    <button onClick={() => handleToggleTask(task)} className="shrink-0 active:scale-90 transition-transform" title="盖个完成章">
                                                        <Postmark size={46} color={theme.accent} rotate={-8}>办妥</Postmark>
                                                    </button>
                                                )}
                                            </div>
                                            <button onClick={() => handleDeleteTask(task.id)} className="absolute top-1.5 right-2.5 text-[14px] active:scale-90" style={{ color: theme.inkSoft }}>✕</button>
                                        </PaperNote>
                                    );
                                })}
                            </div>

                            {doneTasks.length > 0 && (
                                <div className="mt-8">
                                    <h3 className="text-[12px] font-bold mb-3 pl-1" style={{ color: theme.inkSoft }}>—— 已经办妥 ——</h3>
                                    <div className="space-y-1.5">
                                        {doneTasks.map(task => (
                                            <div key={task.id} className="flex items-center gap-2 py-1.5 px-2" style={{ borderBottom: `1px dashed ${theme.inkSoft}44` }}>
                                                <span className="text-[11px] font-black" style={{ color: theme.accent }}>✓</span>
                                                <span className="text-[13px] flex-1" style={{ color: theme.inkSoft, textDecoration: 'line-through', fontFamily: HAND_FONT }}>{task.title}</span>
                                                <button onClick={() => handleDeleteTask(task.id)} className="text-[11px] active:scale-90" style={{ color: theme.inkSoft }}>撕掉</button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* 数着的日子 Tab */}
                    {activeTab === 'server_events' && (
                        <div className="relative pl-5" style={{ borderLeft: `2px dashed ${theme.inkSoft}55`, marginLeft: 6 }}>
                            <h3 className="text-[14px] font-black mb-5 -ml-5 pl-5" style={{ fontFamily: HAND_FONT, color: theme.ink }}>一页页贴着的日子</h3>
                            <div className="space-y-4 mb-8">
                                {anniversaries.length === 0 && (
                                    <div className="text-[12px] -ml-2" style={{ color: theme.inkSoft }}>还没贴上任何日子，点右上角 ＋ 来一张</div>
                                )}
                                {anniversaries.map(a => {
                                    const ch = characters.find(c => c.id === a.charId);
                                    const days = getDaysUntil(a.date);
                                    return (
                                        <div key={a.id} className="relative">
                                            <span className="absolute -left-[26px] top-4 w-3 h-3 rounded-full" style={{ background: theme.accent, boxShadow: '0 0 0 3px rgba(255,255,255,0.8)' }} />
                                            <PaperNote className="px-4 py-3" rotate={tinyRotate(a.id)} bg={theme.noteBg}>
                                                <div className="flex items-center justify-between gap-2">
                                                    <div className="min-w-0">
                                                        <div className="text-[15px] font-bold" style={{ fontFamily: HAND_FONT, color: theme.ink }}>{a.title}</div>
                                                        <div className="text-[10px] mt-0.5" style={{ color: theme.inkSoft }}>{a.date} · {ch?.name || '—'}</div>
                                                    </div>
                                                    <div className="text-right shrink-0" style={{ fontFamily: HAND_FONT }}>
                                                        <div className="text-[18px] font-black leading-none" style={{ color: theme.accent }}>{days > 0 ? `还有${days}` : (days === 0 ? '今天' : `过了${-days}`)}</div>
                                                        <div className="text-[9px]" style={{ color: theme.inkSoft }}>{days > 0 ? '天' : (days === 0 ? '就是今天' : '天')}</div>
                                                    </div>
                                                </div>
                                                <button onClick={() => handleDeleteAnni(a.id)} className="absolute top-1 right-2 text-[13px] active:scale-90" style={{ color: theme.inkSoft }}>✕</button>
                                            </PaperNote>
                                        </div>
                                    );
                                })}
                            </div>

                            {doneTasks.length > 0 && (
                                <div>
                                    <h3 className="text-[13px] font-black mb-4 -ml-5 pl-5" style={{ fontFamily: HAND_FONT, color: theme.inkSoft }}>办妥的事 · 存档</h3>
                                    <div className="space-y-3">
                                        {doneTasks.sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0)).map(t => (
                                            <div key={t.id} className="relative">
                                                <span className="absolute -left-[26px] top-2 w-3 h-3 rounded-full" style={{ background: theme.inkSoft, boxShadow: '0 0 0 3px rgba(255,255,255,0.8)' }} />
                                                <div className="text-[10px]" style={{ color: theme.inkSoft }}>{new Date(t.completedAt || 0).toLocaleDateString()} · 盖了完成章</div>
                                                <div className="text-[14px] font-bold pl-2 mt-0.5" style={{ fontFamily: HAND_FONT, color: theme.ink, borderLeft: `3px solid ${theme.accent}` }}>{t.title}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* 新建约定 弹窗 */}
            {showTaskModal && (
                <div className="fixed inset-0 z-[9999] flex items-center justify-center p-6" onClick={() => setShowTaskModal(false)}>
                    <div className="absolute inset-0 bg-black/45 animate-fade-in" />
                    <div className="relative w-full max-w-sm animate-slide-up" style={{ background: theme.noteBg, borderRadius: 18, boxShadow: '0 16px 40px rgba(96,66,40,0.34)', transform: 'rotate(-0.6deg)' }} onClick={e => e.stopPropagation()}>
                        <div className="p-6">
                            <div className="text-[22px] font-black mb-1" style={{ fontFamily: HAND_FONT, color: theme.ink }}>钉一条新约定</div>
                            <div className="text-[11px] mb-4" style={{ color: theme.inkSoft }}>写下要做的事，挑一位角色来盯着你</div>
                            <input autoFocus value={newTaskTitle} onChange={e => setNewTaskTitle(e.target.value)} placeholder="比如：今晚背完 20 个单词" className="w-full px-4 py-3 text-[14px] focus:outline-none" style={{ background: '#fff', borderRadius: 12, color: theme.ink, fontFamily: HAND_FONT, boxShadow: 'inset 0 0 0 1px rgba(150,110,70,0.18)' }} />
                            <div className="mt-5">
                                <TapeLabel color="#e8c8a0" className="mb-3">谁来当监督人</TapeLabel>
                                <div className="mt-3"><CharPicker value={newTaskSupervisor} onPick={setNewTaskSupervisor} /></div>
                            </div>
                            <div className="flex gap-2 mt-6">
                                <button onClick={() => setShowTaskModal(false)} className="px-4 py-3 text-[13px] font-bold active:scale-95 transition-transform" style={{ background: '#f0e9da', color: theme.inkSoft, borderRadius: 12 }}>先不了</button>
                                <button onClick={handleAddTask} disabled={!newTaskTitle.trim()} className="flex-1 py-3 text-[15px] font-black active:scale-95 transition-transform disabled:opacity-40" style={{ background: theme.accent, color: '#fff7ef', borderRadius: 12, fontFamily: HAND_FONT, letterSpacing: 1 }}>钉上去</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* 添加日子 弹窗 */}
            {showAnniModal && (
                <div className="fixed inset-0 z-[9999] flex items-center justify-center p-6" onClick={() => setShowAnniModal(false)}>
                    <div className="absolute inset-0 bg-black/45 animate-fade-in" />
                    <div className="relative w-full max-w-sm animate-slide-up" style={{ background: theme.noteBg, borderRadius: 18, boxShadow: '0 16px 40px rgba(96,66,40,0.34)', transform: 'rotate(0.6deg)' }} onClick={e => e.stopPropagation()}>
                        <div className="p-6">
                            <div className="text-[22px] font-black mb-1" style={{ fontFamily: HAND_FONT, color: theme.ink }}>贴一个要数的日子</div>
                            <div className="text-[11px] mb-4" style={{ color: theme.inkSoft }}>取个名、定个日期，再关联一位角色</div>
                            <input value={newAnniTitle} onChange={e => setNewAnniTitle(e.target.value)} placeholder="比如：第一次见面" className="w-full px-4 py-3 text-[14px] focus:outline-none mb-3" style={{ background: '#fff', borderRadius: 12, color: theme.ink, fontFamily: HAND_FONT, boxShadow: 'inset 0 0 0 1px rgba(150,110,70,0.18)' }} />
                            <input type="date" value={newAnniDate} onChange={e => setNewAnniDate(e.target.value)} className="w-full px-4 py-3 text-[14px] focus:outline-none" style={{ background: '#fff', borderRadius: 12, color: theme.ink, boxShadow: 'inset 0 0 0 1px rgba(150,110,70,0.18)' }} />
                            <div className="mt-5">
                                <TapeLabel color="#e8c8a0" className="mb-3">和谁有关</TapeLabel>
                                <div className="mt-3"><CharPicker value={newAnniChar} onPick={setNewAnniChar} /></div>
                            </div>
                            <div className="flex gap-2 mt-6">
                                <button onClick={() => setShowAnniModal(false)} className="px-4 py-3 text-[13px] font-bold active:scale-95 transition-transform" style={{ background: '#f0e9da', color: theme.inkSoft, borderRadius: 12 }}>先不了</button>
                                <button onClick={handleAddAnni} disabled={!newAnniTitle.trim() || !newAnniDate} className="flex-1 py-3 text-[15px] font-black active:scale-95 transition-transform disabled:opacity-40" style={{ background: theme.accent, color: '#fff7ef', borderRadius: 12, fontFamily: HAND_FONT, letterSpacing: 1 }}>贴上去</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </PaperPage>
    );
};

export default ScheduleApp;
