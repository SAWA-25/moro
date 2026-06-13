/**
 * 往事柜 —— 角色记忆档案（登场人物「往事」页主体），黑白拼贴手账风界面。
 * 词汇对照：日账 = 每日记忆碎片（MemoryFragment）、月签 = 月度核心记忆
 * （refinedMemories）、摊开细账 = activeMemoryMonths（该月详细回忆进上下文）。
 * 功能与旧版完全一致：年/月/日三级浏览、月度精炼（含口吻模板）、日账编辑/
 * 批量删除、月签长按编辑/删除、按天强制重总结（含模板弹窗）。
 */
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { MemoryFragment } from '../../types';
import { FolderSimple, Eye, X } from '@phosphor-icons/react';
import { DEFAULT_REFINE_PROMPTS } from '../../components/chat/ChatConstants';

// ── 黑白手账设计 token（与剪影集全家同一套语言） ───────────
const INK = '#1c1b1a';
const STICKER = 'border-2 border-[#1c1b1a] bg-white shadow-[2px_2px_0_#1c1b1a] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all';
const INK_BTN = 'bg-[#1c1b1a] text-[#f7f5ef] border-2 border-[#1c1b1a] shadow-[2px_2px_0_rgba(28,27,26,0.35)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all';
const HAND_CN: React.CSSProperties = { fontFamily: "'Long Cang', 'Caveat', cursive" };
const DOT_BG: React.CSSProperties = {
    backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(28,27,26,0.10) 1px, transparent 0)',
    backgroundSize: '16px 16px',
};

const Tape: React.FC<{ className?: string }> = ({ className }) => (
    <div
        aria-hidden
        className={`pointer-events-none absolute h-5 w-16 bg-white/60 border-x border-dashed border-[#1c1b1a]/30 shadow-sm backdrop-blur-[1px] ${className || ''}`}
    />
);

/** 拼贴弹层：撕边纸卡 + 顶部胶带 */
const PaperSheet: React.FC<{
    open: boolean;
    tag: string;
    title: string;
    onClose: () => void;
    children: React.ReactNode;
    footer?: React.ReactNode;
}> = ({ open, tag, title, onClose, children, footer }) => {
    if (!open) return null;
    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-5 animate-fade-in">
            <div className="absolute inset-0 bg-[#1c1b1a]/45" onClick={onClose} />
            <div className="relative w-full max-w-sm bg-[#f7f5ef] border-2 border-[#1c1b1a] shadow-[5px_5px_0_#1c1b1a] rotate-[-0.4deg] animate-slide-up" style={DOT_BG}>
                <Tape className="-top-2.5 left-1/2 -translate-x-1/2 rotate-[-3deg]" />
                <button
                    onClick={onClose}
                    className={`absolute -top-3 -right-3 w-8 h-8 flex items-center justify-center rotate-[4deg] ${STICKER}`}
                    aria-label="合上"
                >
                    <X size={14} weight="bold" color={INK} />
                </button>
                <div className="px-5 pt-6 pb-2">
                    <div className="label-mono text-[9px] text-[#1c1b1a]/45">{tag}</div>
                    <h3 className="text-lg font-black text-[#1c1b1a] tracking-wide mt-0.5">{title}</h3>
                    <div className="h-[3px] w-14 bg-[#1c1b1a] mt-1.5" />
                </div>
                <div className="px-5 py-3 max-h-[58vh] overflow-y-auto no-scrollbar">{children}</div>
                {footer && <div className="px-5 pb-5 pt-2 flex gap-3">{footer}</div>}
            </div>
        </div>
    );
};

interface MemoryArchivistProps {
    memories: MemoryFragment[];
    refinedMemories: Record<string, string>;
    activeMemoryMonths: string[];
    charName: string;
    userName: string;
    onRefine: (year: string, month: string, summary: string, formattedPrompt?: string) => Promise<void>;
    onDeleteMemories: (ids: string[]) => void;
    onUpdateMemory: (id: string, newSummary: string) => void;
    onToggleActiveMonth: (year: string, month: string) => void;
    onUpdateRefinedMemory: (year: string, month: string, newContent: string) => void;
    onDeleteRefinedMemory: (year: string, month: string) => void;
    /**
     * 按日期强制从原始聊天重总结（忽略 hideBefore）。日期格式 YYYY-MM-DD。
     * overridePromptId 可选——用户在重总结小弹窗里选的模板 id。不提供则走调用方默认。
     */
    onForceArchiveDate?: (dateStr: string, overridePromptId?: string) => Promise<void>;
    /** 可选：传入归档模板列表 + 默认选中 id，用于重总结前让用户选模板（避开和内部月度精炼模板 state 同名） */
    forceArchiveTemplates?: { id: string; name: string; content: string }[];
    forceArchiveDefaultPromptId?: string;
}

const MemoryArchivist: React.FC<MemoryArchivistProps> = ({ memories, refinedMemories, activeMemoryMonths, charName, userName, onRefine, onDeleteMemories, onUpdateMemory, onToggleActiveMonth, onUpdateRefinedMemory, onDeleteRefinedMemory, onForceArchiveDate, forceArchiveTemplates, forceArchiveDefaultPromptId }) => {
    // 每个日期的"强制重总结"运行状态
    const [forcingDate, setForcingDate] = useState<string | null>(null);
    // 重总结前弹出模板选择器：把 date 存起来打开 modal
    const [forcePickerDate, setForcePickerDate] = useState<string | null>(null);
    const [forcePickerPromptId, setForcePickerPromptId] = useState<string>(forceArchiveDefaultPromptId || '');

    const openForcePicker = (date: string) => {
        if (!onForceArchiveDate || forcingDate) return;
        // 如果没有模板数据，就退回到原行为——直接跑
        if (!forceArchiveTemplates || forceArchiveTemplates.length === 0) {
            setForcingDate(date);
            onForceArchiveDate(date).finally(() => setForcingDate(null));
            return;
        }
        setForcePickerPromptId(forceArchiveDefaultPromptId || forceArchiveTemplates[0].id);
        setForcePickerDate(date);
    };
    const confirmForcePicker = async () => {
        if (!forcePickerDate || !onForceArchiveDate) return;
        const date = forcePickerDate;
        const promptId = forcePickerPromptId;
        setForcePickerDate(null);
        setForcingDate(date);
        try { await onForceArchiveDate(date, promptId); } finally { setForcingDate(null); }
    };
    const [viewState, setViewState] = useState<{
        level: 'root' | 'year' | 'month';
        selectedYear: string | null;
        selectedMonth: string | null;
    }>({ level: 'root', selectedYear: null, selectedMonth: null });
    const [isRefining, setIsRefining] = useState(false);
    const [isManageMode, setIsManageMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [editMemory, setEditMemory] = useState<MemoryFragment | null>(null);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [expandedMemoryIds, setExpandedMemoryIds] = useState<Set<string>>(new Set());

    // Core Memory Edit State
    const [editingCore, setEditingCore] = useState<{year: string, month: string, content: string} | null>(null);
    const [showCoreDeleteConfirm, setShowCoreDeleteConfirm] = useState(false);
    const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Monthly refinement prompt selection (character-specific, independent from Chat app)
    const [archivePrompts, setArchivePrompts] = useState<{id: string, name: string, content: string}[]>(DEFAULT_REFINE_PROMPTS);
    const [selectedPromptId, setSelectedPromptId] = useState<string>('refine_atmosphere');
    const [showPromptPanel, setShowPromptPanel] = useState(false);

    useEffect(() => {
        const savedPrompts = localStorage.getItem('character_refine_prompts');
        if (savedPrompts) {
            try {
                const parsed = JSON.parse(savedPrompts);
                const merged = [...DEFAULT_REFINE_PROMPTS, ...parsed.filter((p: any) => !p.id.startsWith('refine_'))];
                setArchivePrompts(merged);
            } catch(e) {}
        }
        const savedId = localStorage.getItem('character_active_refine_prompt_id');
        if (savedId) setSelectedPromptId(savedId);
    }, []);

    const { tree, stats } = useMemo(() => {
        const tree: Record<string, Record<string, MemoryFragment[]>> = {};
        let totalChars = 0;
        const safeMemories = Array.isArray(memories) ? memories : [];
        safeMemories.forEach(m => {
            totalChars += m.summary.length;
            let year = '未知年份', month = '未知';
            const dateMatch = m.date.match(/(\d{4})[-/年](\d{1,2})/);
            if (dateMatch) {
                year = dateMatch[1];
                month = dateMatch[2].padStart(2, '0');
            } else if (m.date.includes('unknown')) year = '未归档';
            if (!tree[year]) tree[year] = {};
            if (!tree[year][month]) tree[year][month] = [];
            tree[year][month].push(m);
        });
        const sortedTree: typeof tree = {};
        Object.keys(tree).sort((a, b) => b.localeCompare(a)).forEach(y => {
            sortedTree[y] = {};
            Object.keys(tree[y]).sort((a, b) => b.localeCompare(a)).forEach(m => {
                sortedTree[y][m] = tree[y][m].sort((ma, mb) => mb.date.localeCompare(ma.date));
            });
        });
        return { tree: sortedTree, stats: { totalChars, count: safeMemories.length } };
    }, [memories]);

    const handleYearClick = (year: string) => setViewState({ level: 'year', selectedYear: year, selectedMonth: null });
    const handleMonthClick = (month: string) => {
        setExpandedMemoryIds(new Set());
        setViewState(prev => ({ ...prev, level: 'month', selectedMonth: month }));
    };
    const handleBack = () => {
        if (viewState.level === 'month') setViewState(prev => ({ ...prev, level: 'year', selectedMonth: null }));
        else if (viewState.level === 'year') setViewState({ level: 'root', selectedYear: null, selectedMonth: null });
    };

    const triggerRefine = async () => {
        if (!viewState.selectedYear || !viewState.selectedMonth) return;
        setIsRefining(true);
        const monthMems = tree[viewState.selectedYear][viewState.selectedMonth];
        const combinedText = monthMems.map(m => `${m.date}: ${m.summary} (${m.mood || '无'})`).join('\n');

        // Build formatted prompt if a template is selected
        let formattedPrompt: string | undefined;
        const templateObj = archivePrompts.find(p => p.id === selectedPromptId);
        if (templateObj) {
            const dateStr = `${viewState.selectedYear}-${viewState.selectedMonth}`;
            // ${rawLog} 不再当场替换成 combinedText：rawText 由 handleRefineMonth 以
            // role:user 单独投喂（Gemini 3.1 preview 对"规则/身份 → 迟到 rawLog"
            // 的 all-in-one user 消息会静默拒答，拆开再发能解决）。这里只留占位提示。
            formattedPrompt = templateObj.content
                .replace(/\$\{dateStr\}/g, dateStr)
                .replace(/\$\{char\.name\}/g, charName)
                .replace(/\$\{userProfile\.name\}/g, userName)
                .replace(/\$\{rawLog.*?\}/g, '<见 user 消息里的本月日记原件>');
            formattedPrompt = `[角色记忆精炼: ${charName} - ${dateStr}]\n${formattedPrompt}`;
        }

        try { await onRefine(viewState.selectedYear, viewState.selectedMonth, combinedText, formattedPrompt); } finally { setIsRefining(false); }
    };

    const toggleSelection = (id: string) => {
        const next = new Set(selectedIds);
        if (next.has(id)) next.delete(id); else next.add(id);
        setSelectedIds(next);
    };

    const toggleMemoryExpanded = (id: string) => {
        setExpandedMemoryIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };
    const requestDelete = () => { if (selectedIds.size > 0) setShowDeleteConfirm(true); };
    const performDelete = () => { onDeleteMemories(Array.from(selectedIds)); setSelectedIds(new Set()); setIsManageMode(false); setShowDeleteConfirm(false); };

    // Core Memory Interaction
    const handleCoreTouchStart = (content: string) => {
        if (!viewState.selectedYear || !viewState.selectedMonth) return;
        const y = viewState.selectedYear;
        const m = viewState.selectedMonth;
        longPressTimer.current = setTimeout(() => {
            setEditingCore({ year: y, month: m, content });
        }, 600);
    };

    const handleCoreTouchEnd = () => {
        if (longPressTimer.current) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
        }
    };

    const saveCoreEdit = () => {
        if (editingCore) {
            onUpdateRefinedMemory(editingCore.year, editingCore.month, editingCore.content);
            setEditingCore(null);
        }
    };

    const confirmCoreDelete = () => {
        if (editingCore) {
            onDeleteRefinedMemory(editingCore.year, editingCore.month);
            setEditingCore(null);
            setShowCoreDeleteConfirm(false);
        }
    };

    if (!memories || memories.length === 0) return (
        <div className="flex flex-col items-center justify-center h-48 text-[#1c1b1a]/40 gap-2">
            <FolderSimple size={32} weight="bold" />
            <p className="text-sm" style={HAND_CN}>往事栏还空着，先去聊出点故事吧。</p>
        </div>
    );

    /** 返回上一层的小贴纸 */
    const BackChip = () => (
        <button onClick={handleBack} className={`px-2 py-1.5 rotate-[-2deg] ${STICKER}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth={2.5} className="w-3 h-3">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
            </svg>
        </button>
    );

    const renderYears = () => (
        <div className="grid grid-cols-2 gap-3 animate-fade-in">
            {Object.keys(tree).map((year, i) => (
                <div
                    key={year}
                    onClick={() => handleYearClick(year)}
                    className={`relative bg-white border-2 border-[#1c1b1a] shadow-[3px_3px_0_#1c1b1a] p-4 flex flex-col justify-between h-28 cursor-pointer active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all ${i % 2 === 0 ? 'rotate-[-0.6deg]' : 'rotate-[0.6deg]'}`}
                >
                    <Tape className="-top-2.5 left-5 rotate-[-4deg] w-12" />
                    <div className="flex justify-between items-start">
                        <FolderSimple size={24} weight="bold" color={INK} className="opacity-60" />
                        <span className="label-mono text-[8px] border border-[#1c1b1a]/50 px-1.5 py-0.5">{Object.values(tree[year]).reduce((acc, curr: any) => acc + curr.length, 0)} 条</span>
                    </div>
                    <div>
                        <h3 className="text-xl font-black tracking-tight">{year}</h3>
                        <p className="text-[12px] text-[#1c1b1a]/50" style={HAND_CN}>这一年的卷宗</p>
                    </div>
                </div>
            ))}
        </div>
    );

    const renderMonths = () => viewState.selectedYear && tree[viewState.selectedYear] && (
        <div className="grid grid-cols-3 gap-3 animate-fade-in">
            {Object.keys(tree[viewState.selectedYear]).map((month, i) => {
                const monthKey = `${viewState.selectedYear}-${month}`;
                const isActive = activeMemoryMonths.includes(monthKey);
                return (
                    <div key={month} className="relative">
                        <div
                            onClick={() => handleMonthClick(month)}
                            className={`bg-white border-2 border-[#1c1b1a]/60 p-3 flex flex-col justify-center items-center gap-1.5 aspect-square cursor-pointer hover:border-[#1c1b1a] transition-all active:scale-95 relative overflow-hidden ${i % 3 === 1 ? 'rotate-[0.8deg]' : 'rotate-[-0.5deg]'}`}
                        >
                            {/* 已有月签：右上角折角墨标 */}
                            {refinedMemories?.[monthKey] && (
                                <div aria-hidden className="absolute top-0 right-0 w-0 h-0 border-t-[16px] border-t-[#1c1b1a] border-l-[16px] border-l-transparent" title="已有月签" />
                            )}
                            <span className="text-2xl font-black">{parseInt(month)}<span className="text-xs ml-0.5 text-[#1c1b1a]/45 font-bold">月</span></span>
                            <div className="h-[2px] w-5 bg-[#1c1b1a]/40" />
                            <span className="label-mono text-[8px] text-[#1c1b1a]/45">{tree[viewState.selectedYear!][month].length} 条日账</span>
                        </div>
                        {/* 摊开细账（详细回忆进上下文）开关 */}
                        <button
                            onClick={(e) => { e.stopPropagation(); onToggleActiveMonth(viewState.selectedYear!, month); }}
                            title={isActive ? '细账已摊开（详细回忆会带进聊天）' : '只带月签（点一下摊开细账）'}
                            className={`absolute -top-2 -right-2 p-1.5 z-10 border-2 border-[#1c1b1a] transition-all active:scale-90 rotate-[4deg] ${isActive ? 'bg-[#1c1b1a] text-[#f7f5ef]' : 'bg-white text-[#1c1b1a]/40'}`}
                        >
                            <Eye size={12} weight="bold" />
                        </button>
                    </div>
                );
            })}
        </div>
    );

    const renderMemories = () => {
        if (!viewState.selectedYear || !viewState.selectedMonth) return null;
        const key = `${viewState.selectedYear}-${viewState.selectedMonth}`;
        const refinedContent = refinedMemories?.[key];
        const rawMemories = tree[viewState.selectedYear]?.[viewState.selectedMonth] || [];
        const isActive = activeMemoryMonths.includes(key);

        const groupedByDay: Record<string, MemoryFragment[]> = {};
        rawMemories.forEach(m => { if (!groupedByDay[m.date]) groupedByDay[m.date] = []; groupedByDay[m.date].push(m); });

        if (rawMemories.length === 0) return <div className="flex flex-col items-center justify-center h-32 text-[#1c1b1a]/40"><p className="text-sm" style={HAND_CN}>这个月的日账撕光了。</p></div>;

        return (
            <div className="space-y-6 animate-fade-in pb-8">
                {/* 月签（喂给 AI 的核心记忆） */}
                <div className="relative bg-[#fbfaf6] border-2 border-[#1c1b1a] shadow-[4px_4px_0_#1c1b1a] p-4">
                    <Tape className="-top-2.5 left-6 rotate-[-4deg]" />
                    <div className="flex justify-between items-start mb-2 flex-wrap gap-2">
                        <h4 className="label-mono text-[8px] text-[#1c1b1a]/45 pt-1">本月月签（喂给 AI 的核心记忆）</h4>
                        <div className="flex gap-1.5 flex-wrap">
                             <button
                                 onClick={() => onToggleActiveMonth(viewState.selectedYear!, viewState.selectedMonth!)}
                                 className={`px-2.5 py-1 text-[9px] font-black flex items-center gap-1 border-2 border-[#1c1b1a] transition-all ${isActive ? 'bg-[#1c1b1a] text-[#f7f5ef]' : 'bg-white text-[#1c1b1a]/60'}`}
                             >
                                 <Eye size={10} weight="bold" />{isActive ? '细账已摊开' : '只带月签'}
                             </button>
                             <button onClick={() => setShowPromptPanel(!showPromptPanel)} className={`px-2.5 py-1 text-[9px] font-black ${STICKER}`}>
                                 换口吻
                             </button>
                             <button onClick={triggerRefine} disabled={isRefining} className={`px-2.5 py-1 text-[9px] font-black disabled:opacity-50 ${INK_BTN}`}>
                                 {isRefining ? '凝缩中…' : (refinedContent ? '重凝月签' : '凝出月签')}
                             </button>
                        </div>
                    </div>
                    {/* Prompt Selection Panel */}
                    {showPromptPanel && (
                        <div className="mb-3 border-2 border-dashed border-[#1c1b1a]/40 p-3 animate-fade-in">
                            <label className="label-mono text-[8px] text-[#1c1b1a]/45 mb-2 block">挑一种凝缩口吻</label>
                            <div className="flex flex-col gap-1.5">
                                {archivePrompts.map(p => (
                                    <div key={p.id} onClick={() => { setSelectedPromptId(p.id); localStorage.setItem('character_active_refine_prompt_id', p.id); }} className={`px-3 py-2 border-2 cursor-pointer text-xs font-black transition-all ${selectedPromptId === p.id ? 'border-[#1c1b1a] bg-white shadow-[2px_2px_0_#1c1b1a]' : 'border-[#1c1b1a]/30 bg-white/60 text-[#1c1b1a]/60'}`}>
                                        {selectedPromptId === p.id ? '◉ ' : '○ '}{p.name}
                                    </div>
                                ))}
                            </div>
                            <p className="text-[11px] text-[#1c1b1a]/45 mt-2" style={HAND_CN}>月签专用口吻，和聊天归档互不打扰。</p>
                        </div>
                    )}
                    {/* Display Refined Memory Content if exists */}
                    {refinedContent && (
                        <div
                            className="text-sm leading-relaxed bg-white border border-[#1c1b1a]/30 p-3 cursor-pointer active:scale-[0.99] transition-transform select-none"
                            onTouchStart={() => handleCoreTouchStart(refinedContent)}
                            onTouchEnd={handleCoreTouchEnd}
                            onMouseDown={() => handleCoreTouchStart(refinedContent)}
                            onMouseUp={handleCoreTouchEnd}
                            onMouseLeave={handleCoreTouchEnd}
                            onContextMenu={(e) => { e.preventDefault(); setEditingCore({year: viewState.selectedYear!, month: viewState.selectedMonth!, content: refinedContent}); }}
                            title="长按修改 / 撕掉"
                        >
                            {refinedContent}
                        </div>
                    )}
                </div>

                {/* 日账 */}
                <div className="flex items-center justify-between px-1">
                    <h4 className="label-mono text-[8px] text-[#1c1b1a]/45">日账 / DAY LOG</h4>
                    <div className="flex gap-2">
                        {isManageMode && selectedIds.size > 0 && (
                            <button onClick={(e) => { e.stopPropagation(); requestDelete(); }} className={`px-3 py-1 text-[10px] font-black line-through decoration-2 ${INK_BTN}`}>撕掉 ({selectedIds.size})</button>
                        )}
                        <button
                            onClick={() => { setIsManageMode(!isManageMode); setSelectedIds(new Set()); }}
                            className={`px-3 py-1 text-[10px] font-black border-2 border-[#1c1b1a] transition-all ${isManageMode ? 'bg-[#1c1b1a] text-[#f7f5ef]' : 'bg-white'}`}
                        >{isManageMode ? '收工' : '整理'}</button>
                    </div>
                </div>

                <div className="mt-2 pl-2">
                    {Object.entries(groupedByDay).map(([date, dayMemories]) => (
                        <div key={date} className="relative pl-7 pb-7 last:pb-0 border-l-2 border-dashed border-[#1c1b1a]/30">
                            {/* 装订点 */}
                            <div className="absolute left-[-6px] top-0 w-2.5 h-2.5 bg-[#1c1b1a] rotate-45 z-10"></div>
                            <div className="mb-3 -mt-1 flex items-center gap-2">
                                <span className="label-mono text-[10px] font-bold">{date}</span>
                                {dayMemories.length > 1 && <span className="label-mono text-[8px] border border-[#1c1b1a]/40 px-1.5 py-0.5 text-[#1c1b1a]/55">{dayMemories.length} 笔</span>}
                                {onForceArchiveDate && (
                                    <button
                                        onClick={(e) => { e.stopPropagation(); openForcePicker(date); }}
                                        disabled={forcingDate === date}
                                        title={`从原始聊天重誊 ${date} 这一天（忽略已隐藏状态）`}
                                        className={`ml-auto px-2 py-0.5 text-[9px] font-black disabled:opacity-50 ${STICKER}`}
                                    >
                                        {forcingDate === date ? '誊写中…' : '重誊这天'}
                                    </button>
                                )}
                            </div>
                            <div className="space-y-3">
                                {dayMemories.map((mem, mi) => (
                                    <div
                                        key={mem.id}
                                        className={`relative transition-all duration-300 ${isManageMode ? 'cursor-pointer' : ''}`}
                                        onClick={() => { if (isManageMode) toggleSelection(mem.id); }}
                                    >
                                        {isManageMode && (
                                            <div className={`absolute -left-[34px] top-1/2 -translate-y-1/2 w-5 h-5 border-2 border-[#1c1b1a] flex items-center justify-center z-20 transition-colors ${selectedIds.has(mem.id) ? 'bg-[#1c1b1a]' : 'bg-white'}`}>
                                                {selectedIds.has(mem.id) && <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="#f7f5ef" strokeWidth={3.5}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>}
                                            </div>
                                        )}
                                        <div
                                            className={`bg-white p-3.5 border-2 relative transition-all ${mi % 2 === 0 ? 'rotate-[-0.25deg]' : 'rotate-[0.25deg]'} ${isManageMode && selectedIds.has(mem.id) ? 'border-[#1c1b1a] shadow-[3px_3px_0_#1c1b1a]' : 'border-[#1c1b1a]/40 shadow-sm hover:border-[#1c1b1a]'}`}
                                            onClick={(e) => { if (!isManageMode) { e.stopPropagation(); toggleMemoryExpanded(mem.id); } }}
                                        >
                                            {/* 修一笔：常驻贴纸（手机也摸得到） */}
                                            {!isManageMode && (
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); setEditMemory(mem); }}
                                                    className="absolute -top-2 -right-2 px-1.5 py-0.5 text-[9px] font-black rotate-[3deg] z-10 border-2 border-[#1c1b1a]/40 bg-white text-[#1c1b1a]/50 hover:border-[#1c1b1a] hover:text-[#1c1b1a] transition-colors"
                                                    title="修这一笔"
                                                >
                                                    修
                                                </button>
                                            )}

                                            {mem.mood && <div className="mb-1 pr-6"><span className="label-mono text-[8px] px-1.5 py-0.5 border border-[#1c1b1a]/40 text-[#1c1b1a]/60">#{mem.mood}</span></div>}
                                            <p className="text-sm text-[#1c1b1a]/80 leading-relaxed text-justify whitespace-pre-wrap">{expandedMemoryIds.has(mem.id) ? mem.summary : (mem.summary.length > 120 ? `${mem.summary.slice(0, 120)}...` : mem.summary)}</p>
                                            {!isManageMode && mem.summary.length > 120 && <div className="mt-2 text-[11px] text-[#1c1b1a]/45" style={HAND_CN}>{expandedMemoryIds.has(mem.id) ? '▴ 折起来' : '▾ 摊开看全文'}</div>}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full relative">
            {/* 柜门：统计 + 面包屑 */}
            <div className="flex justify-between items-center mb-5 px-1 flex-wrap gap-2">
                <div className="flex gap-4">
                    <div><span className="label-mono text-[8px] text-[#1c1b1a]/45 block">墨迹</span><span className="text-base font-black font-mono">{stats.totalChars.toLocaleString()} 字</span></div>
                    <div><span className="label-mono text-[8px] text-[#1c1b1a]/45 block">日账</span><span className="text-base font-black font-mono">{stats.count} 条</span></div>
                </div>
                <div className="flex items-center gap-1 text-xs font-black border-2 border-[#1c1b1a]/50 bg-white px-3 py-1.5 rotate-[0.5deg]">
                    {viewState.level === 'root' ? <span>往事柜</span> : (
                        <>
                            <button onClick={() => setViewState({level: 'root', selectedYear: null, selectedMonth: null})} className="underline decoration-dashed underline-offset-2">往事柜</button><span className="text-[#1c1b1a]/30">/</span>
                            {viewState.level === 'year' ? <span>{viewState.selectedYear}</span> : (<><button onClick={() => setViewState(prev => ({...prev, level: 'year', selectedMonth: null}))} className="underline decoration-dashed underline-offset-2">{viewState.selectedYear}</button><span className="text-[#1c1b1a]/30">/</span><span>{parseInt(viewState.selectedMonth!)}月</span></>)}
                        </>
                    )}
                </div>
            </div>
            {viewState.level === 'root' && renderYears()}
            {viewState.level === 'year' && <><div className="mb-4 flex items-center gap-2"><BackChip /><h3 className="text-sm text-[#1c1b1a]/60" style={HAND_CN}>翻到哪个月？</h3></div>{renderMonths()}</>}
            {viewState.level === 'month' && <><div className="mb-4 flex items-center gap-2"><BackChip /><h3 className="text-sm text-[#1c1b1a]/60" style={HAND_CN}>这个月的日账（点角上的眼睛把细账摊给 AI）</h3></div>{renderMemories()}</>}

            {/* ── 修日账 ── */}
            <PaperSheet
                open={!!editMemory}
                tag="DAY LOG / 日账"
                title="修这一笔"
                onClose={() => setEditMemory(null)}
                footer={<button onClick={() => { if(editMemory) onUpdateMemory(editMemory.id, editMemory.summary); setEditMemory(null); }} className={`w-full py-2.5 text-xs font-black ${INK_BTN}`}>就这样记</button>}
            >
                {editMemory && (
                    <div className="space-y-3">
                        <div className="label-mono text-[9px] text-[#1c1b1a]/45">记于 {editMemory.date}</div>
                        <textarea value={editMemory.summary} onChange={e => setEditMemory({...editMemory, summary: e.target.value})} className="w-full h-40 bg-white border-2 border-[#1c1b1a]/60 p-3 text-sm resize-none outline-none focus:border-[#1c1b1a]" />
                    </div>
                )}
            </PaperSheet>

            {/* ── 撕日账确认 ── */}
            <PaperSheet
                open={showDeleteConfirm}
                tag="TEAR OFF / 不可复原"
                title={`撕掉这 ${selectedIds.size} 条？`}
                onClose={() => setShowDeleteConfirm(false)}
                footer={<div className="flex gap-2 w-full">
                    <button onClick={() => setShowDeleteConfirm(false)} className={`flex-1 py-2.5 text-xs font-black ${STICKER}`}>还是留着</button>
                    <button onClick={performDelete} className={`flex-1 py-2.5 text-xs font-black ${INK_BTN}`}>撕！</button>
                </div>}
            >
                <p className="text-sm text-[#1c1b1a]/70 text-center py-2">选中的 {selectedIds.size} 条日账撕下去就拼不回来了。</p>
            </PaperSheet>

            {/* ── 修月签 ── */}
            <PaperSheet
                open={!!editingCore}
                tag="MONTH SEAL / 月签"
                title="修这枚月签"
                onClose={() => setEditingCore(null)}
                footer={
                    <div className="flex gap-2 w-full">
                        <button onClick={() => setShowCoreDeleteConfirm(true)} className={`flex-1 py-2.5 text-xs font-black line-through decoration-2 ${STICKER}`}>撕掉</button>
                        <button onClick={saveCoreEdit} className={`flex-1 py-2.5 text-xs font-black ${INK_BTN}`}>就这样记</button>
                    </div>
                }
            >
                {editingCore && (
                    <div className="space-y-2">
                        <div className="label-mono text-[9px] text-[#1c1b1a]/45">{editingCore.year} 年 {editingCore.month} 月</div>
                        <textarea
                            value={editingCore.content}
                            onChange={e => setEditingCore({...editingCore, content: e.target.value})}
                            className="w-full h-48 bg-white border-2 border-[#1c1b1a]/60 p-3 text-sm resize-none outline-none focus:border-[#1c1b1a] leading-relaxed"
                        />
                    </div>
                )}
            </PaperSheet>

            {/* ── 撕月签确认 ── */}
            <PaperSheet
                open={showCoreDeleteConfirm}
                tag="TEAR OFF / 不可复原"
                title="撕掉这枚月签？"
                onClose={() => setShowCoreDeleteConfirm(false)}
                footer={<div className="flex gap-2 w-full">
                    <button onClick={() => setShowCoreDeleteConfirm(false)} className={`flex-1 py-2.5 text-xs font-black ${STICKER}`}>还是留着</button>
                    <button onClick={confirmCoreDelete} className={`flex-1 py-2.5 text-xs font-black ${INK_BTN}`}>撕！</button>
                </div>}
            >
                <p className="text-center text-sm text-[#1c1b1a]/70 py-2">撕掉后，这个月喂给 AI 的上下文摘要就没了。</p>
            </PaperSheet>

            {/* ── 重誊这一天：口吻选择 ── */}
            <PaperSheet
                open={!!forcePickerDate}
                tag="REWRITE / 重誊"
                title="重誊这一天"
                onClose={() => setForcePickerDate(null)}
                footer={<div className="flex gap-2 w-full">
                    <button onClick={() => setForcePickerDate(null)} className={`flex-1 py-2.5 text-xs font-black ${STICKER}`}>先不誊</button>
                    <button onClick={confirmForcePicker} className={`flex-1 py-2.5 text-xs font-black ${INK_BTN}`}>开誊</button>
                </div>}
            >
                <div className="space-y-3">
                    <p className="text-[13px] text-[#1c1b1a]/60 leading-relaxed" style={HAND_CN}>
                        要把 <b className="text-[#1c1b1a]">{forcePickerDate}</b> 这一天从原始聊天重誊一遍——不管藏没藏，当天全部原话都会重新读。挑一种誊写口吻：
                    </p>
                    <div className="space-y-1.5 max-h-[40vh] overflow-y-auto">
                        {(forceArchiveTemplates || []).map(p => (
                            <div
                                key={p.id}
                                onClick={() => setForcePickerPromptId(p.id)}
                                className={`p-3 border-2 cursor-pointer transition-colors ${forcePickerPromptId === p.id ? 'border-[#1c1b1a] bg-white shadow-[2px_2px_0_#1c1b1a]' : 'border-[#1c1b1a]/30 bg-white/60'}`}
                            >
                                <div className="text-xs font-black">
                                    {forcePickerPromptId === p.id ? '◉ ' : '○ '}{p.name}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </PaperSheet>
        </div>
    );
};

export default MemoryArchivist;
