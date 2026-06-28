/**
 * 角色记忆档案：年/月/日三级浏览、月度核心记忆生成、记忆条目编辑/
 * 批量删除、核心记忆长按编辑/删除、按天强制重新生成（含模板弹窗）。
 */
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { MemoryFragment } from '../../types';
import { FolderSimple, Eye, X } from '@phosphor-icons/react';
import { DEFAULT_REFINE_PROMPTS } from '../../components/chat/ChatConstants';
import { PAPER_TONES, MONO_STACK } from '../handbook/paper';

// ── 剪影集专属照片资料册色板：记忆档案侧使用旧胶片琥珀强调 ──
const INK = '#2f3432';
const ROSE = '#a98756';
const ROSE_DARK = '#6f5938';
const BORDER = '#e5dfd2';
const CARD_SHADOW = '0 1px 2px rgba(72,62,44,0.08), 0 14px 30px -24px rgba(72,62,44,0.34)';
const STICKER = 'border border-[#e5dfd2] rounded-full bg-[#fcfbf5] text-[#6f5938] shadow-[0_1px_2px_rgba(72,62,44,0.10)] press-soft';
const INK_BTN = 'bg-[#a98756] text-white border border-[#e5dfd2] rounded-full shadow-[0_8px_16px_-12px_rgba(72,62,44,0.44)] press-soft';
const AREA_INPUT = 'w-full bg-white border border-[#e5dfd2] rounded-[14px] px-3 py-2 text-sm resize-none outline-none focus:border-[#a98756] placeholder:text-[#aaa08d]';
const NOTE_TEXT = { color: PAPER_TONES.inkSoft };

/** 浅色设置弹层 */
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
            <div className="absolute inset-0 bg-[#1f2a27]/28 backdrop-blur-[2px]" onClick={onClose} />
            <div className="relative w-full max-w-sm bg-white border border-[#e6ece8] rounded-[18px] animate-slide-up" style={{ boxShadow: CARD_SHADOW }}>
                <button
                    onClick={onClose}
                    className={`absolute -top-3 -right-3 w-8 h-8 flex items-center justify-center ${STICKER}`}
                    aria-label="关闭"
                >
                    <X size={14} weight="bold" color={INK} />
                </button>
                <div className="px-5 pt-6 pb-2">
                    <div className="text-[9px] tracking-[0.18em] uppercase" style={{ ...MONO_STACK, color: PAPER_TONES.inkFaint }}>{tag}</div>
                    <h3 className="text-lg font-black mt-0.5" style={{ color: INK }}>{title}</h3>
                    <div className="h-[3px] w-14 rounded-full mt-1.5" style={{ background: ROSE }} />
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
        <div className="flex flex-col items-center justify-center h-48 gap-2" style={{ color: PAPER_TONES.inkFaint }}>
            <FolderSimple size={32} weight="bold" />
            <p className="text-sm">暂无记忆。可以从聊天记录批量生成，或导入旧文本。</p>
        </div>
    );

    /** 返回上一层 */
    const BackChip = () => (
        <button onClick={handleBack} className={`px-2 py-1.5 ${STICKER}`}>
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
                    className="relative bg-white border p-4 flex flex-col justify-between h-28 cursor-pointer active:scale-[0.99] transition-all rounded-[18px]"
                    style={{ borderColor: '#e6ece8', boxShadow: CARD_SHADOW }}
                >
                    <div className="flex justify-between items-start">
                        <FolderSimple size={24} weight="bold" color={ROSE} className="opacity-80" />
                        <span className="text-[8px] border rounded-full px-1.5 py-0.5" style={{ ...MONO_STACK, borderColor: BORDER, color: PAPER_TONES.inkSoft }}>{Object.values(tree[year]).reduce((acc, curr: any) => acc + curr.length, 0)} 条</span>
                    </div>
                    <div>
                        <h3 className="text-xl font-black tracking-tight">{year}</h3>
                        <p className="text-[12px]" style={NOTE_TEXT}>年度记忆</p>
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
                            className="bg-white border p-3 flex flex-col justify-center items-center gap-1.5 aspect-square cursor-pointer transition-all active:scale-95 relative overflow-hidden rounded-[18px]"
                            style={{ borderColor: '#e6ece8', boxShadow: '0 1px 2px rgba(72,62,44,0.06)' }}
                        >
                            {/* 已有核心记忆 */}
                            {refinedMemories?.[monthKey] && (
                                <div aria-hidden className="absolute top-0 right-0 w-0 h-0 border-t-[16px] border-t-[#a98756] border-l-[16px] border-l-transparent" title="已有核心记忆" />
                            )}
                            <span className="text-2xl font-black">{parseInt(month)}<span className="text-xs ml-0.5 font-bold" style={{ color: PAPER_TONES.inkFaint }}>月</span></span>
                            <div className="h-[2px] w-5 rounded-full" style={{ background: ROSE }} />
                            <span className="text-[8px]" style={{ ...MONO_STACK, color: PAPER_TONES.inkFaint }}>{tree[viewState.selectedYear!][month].length} 条记忆</span>
                        </div>
                        {/* 详细记忆是否进入上下文 */}
                        <button
                            onClick={(e) => { e.stopPropagation(); onToggleActiveMonth(viewState.selectedYear!, month); }}
                            title={isActive ? '详细记忆会进入聊天上下文' : '仅使用核心记忆摘要'}
                            className="absolute -top-2 -right-2 p-1.5 z-10 border transition-all active:scale-90 rounded-full"
                            style={isActive ? { borderColor: BORDER, background: ROSE, color: '#fff' } : { borderColor: BORDER, background: '#fcfbf5', color: PAPER_TONES.inkFaint }}
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

        if (rawMemories.length === 0) return <div className="flex flex-col items-center justify-center h-32" style={{ color: PAPER_TONES.inkFaint }}><p className="text-sm">这个月暂无记忆。</p></div>;

        return (
            <div className="space-y-6 animate-fade-in pb-8">
                {/* 核心记忆 */}
                <div className="relative bg-white border rounded-[18px] p-4" style={{ borderColor: '#e6ece8', boxShadow: CARD_SHADOW }}>
                    <div className="flex justify-between items-start mb-2 flex-wrap gap-2">
                        <h4 className="text-[8px] pt-1 tracking-[0.16em] uppercase" style={{ ...MONO_STACK, color: PAPER_TONES.inkFaint }}>本月核心记忆</h4>
                        <div className="flex gap-1.5 flex-wrap">
                             <button
                                 onClick={() => onToggleActiveMonth(viewState.selectedYear!, viewState.selectedMonth!)}
                                 className="px-2.5 py-1 text-[9px] font-black flex items-center gap-1 border rounded-full transition-all"
                                 style={isActive ? { borderColor: BORDER, background: ROSE, color: '#fff' } : { borderColor: BORDER, background: '#fcfbf5', color: ROSE_DARK }}
                             >
                                 <Eye size={10} weight="bold" />{isActive ? '包含详细记忆' : '仅核心记忆'}
                             </button>
                             <button onClick={() => setShowPromptPanel(!showPromptPanel)} className={`px-2.5 py-1 text-[9px] font-black ${STICKER}`}>
                                 切换模板
                             </button>
                             <button onClick={triggerRefine} disabled={isRefining} className={`px-2.5 py-1 text-[9px] font-black disabled:opacity-50 ${INK_BTN}`}>
                                 {isRefining ? '生成中…' : (refinedContent ? '重新生成' : '生成核心记忆')}
                             </button>
                        </div>
                    </div>
                    {/* Prompt Selection Panel */}
                    {showPromptPanel && (
                        <div className="mb-3 border border-dashed rounded-[16px] p-3 animate-fade-in" style={{ borderColor: BORDER }}>
                            <label className="text-[8px] mb-2 block tracking-[0.16em] uppercase" style={{ ...MONO_STACK, color: PAPER_TONES.inkFaint }}>选择核心记忆模板</label>
                            <div className="flex flex-col gap-1.5">
                                {archivePrompts.map(p => (
                                    <div
                                        key={p.id}
                                        onClick={() => { setSelectedPromptId(p.id); localStorage.setItem('character_active_refine_prompt_id', p.id); }}
                                        className="px-3 py-2 border cursor-pointer text-xs font-black transition-all rounded-[14px] bg-white"
                                        style={selectedPromptId === p.id ? { borderColor: ROSE, boxShadow: CARD_SHADOW } : { borderColor: BORDER, color: PAPER_TONES.inkSoft }}
                                    >
                                        {selectedPromptId === p.id ? '◉ ' : '○ '}{p.name}
                                    </div>
                                ))}
                            </div>
                            <p className="text-[11px] mt-2" style={NOTE_TEXT}>核心记忆模板与聊天归档模板互不影响。</p>
                        </div>
                    )}
                    {/* Display Refined Memory Content if exists */}
                    {refinedContent && (
                        <div
                            className="text-sm leading-relaxed bg-white border p-3 cursor-pointer active:scale-[0.99] transition-transform select-none rounded-[14px]"
                            style={{ borderColor: BORDER, color: PAPER_TONES.ink }}
                            onTouchStart={() => handleCoreTouchStart(refinedContent)}
                            onTouchEnd={handleCoreTouchEnd}
                            onMouseDown={() => handleCoreTouchStart(refinedContent)}
                            onMouseUp={handleCoreTouchEnd}
                            onMouseLeave={handleCoreTouchEnd}
                            onContextMenu={(e) => { e.preventDefault(); setEditingCore({year: viewState.selectedYear!, month: viewState.selectedMonth!, content: refinedContent}); }}
                            title="长按编辑或删除"
                        >
                            {refinedContent}
                        </div>
                    )}
                </div>

                {/* 记忆条目 */}
                <div className="flex items-center justify-between px-1">
                    <h4 className="text-[8px] tracking-[0.16em] uppercase" style={{ ...MONO_STACK, color: PAPER_TONES.inkFaint }}>记忆条目 / MEMORY ITEMS</h4>
                    <div className="flex gap-2">
                        {isManageMode && selectedIds.size > 0 && (
                            <button onClick={(e) => { e.stopPropagation(); requestDelete(); }} className={`px-3 py-1 text-[10px] font-black ${INK_BTN}`}>删除 ({selectedIds.size})</button>
                        )}
                        <button
                            onClick={() => { setIsManageMode(!isManageMode); setSelectedIds(new Set()); }}
                            className="px-3 py-1 text-[10px] font-black border rounded-full transition-all"
                            style={isManageMode ? { borderColor: BORDER, background: '#f8f1e3', color: ROSE_DARK } : { borderColor: BORDER, background: '#fcfbf5', color: ROSE_DARK }}
                        >{isManageMode ? '完成' : '管理'}</button>
                    </div>
                </div>

                <div className="mt-2 pl-2">
                    {Object.entries(groupedByDay).map(([date, dayMemories]) => (
                        <div key={date} className="relative pl-7 pb-7 last:pb-0 border-l-2 border-dashed border-[#e5dfd2]">
                            <div className="absolute left-[-6px] top-0 w-2.5 h-2.5 rounded-full z-10" style={{ background: ROSE }}></div>
                            <div className="mb-3 -mt-1 flex items-center gap-2">
                                <span className="text-[10px] font-bold" style={MONO_STACK}>{date}</span>
                                {dayMemories.length > 1 && <span className="text-[8px] border rounded-full px-1.5 py-0.5" style={{ ...MONO_STACK, borderColor: BORDER, color: PAPER_TONES.inkSoft }}>{dayMemories.length} 条</span>}
                                {onForceArchiveDate && (
                                    <button
                                        onClick={(e) => { e.stopPropagation(); openForcePicker(date); }}
                                        disabled={forcingDate === date}
                                        title={`从原始聊天重新生成 ${date} 的记忆`}
                                        className={`ml-auto px-2 py-0.5 text-[9px] font-black disabled:opacity-50 ${STICKER}`}
                                    >
                                        {forcingDate === date ? '生成中…' : '重新生成'}
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
                                            <div className="absolute -left-[34px] top-1/2 -translate-y-1/2 w-5 h-5 border flex items-center justify-center z-20 transition-colors rounded-full" style={{ borderColor: BORDER, background: selectedIds.has(mem.id) ? ROSE : '#fff' }}>
                                                {selectedIds.has(mem.id) && <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="#fff" strokeWidth={3.5}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>}
                                            </div>
                                        )}
                                        <div
                                            className="bg-white p-3.5 border relative transition-all rounded-[16px]"
                                            style={isManageMode && selectedIds.has(mem.id) ? { borderColor: ROSE, boxShadow: CARD_SHADOW } : { borderColor: BORDER, boxShadow: '0 1px 2px rgba(72,62,44,0.06)' }}
                                            onClick={(e) => { if (!isManageMode) { e.stopPropagation(); toggleMemoryExpanded(mem.id); } }}
                                        >
                                            {/* 编辑按钮 */}
                                            {!isManageMode && (
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); setEditMemory(mem); }}
                                                    className="absolute -top-2 -right-2 px-1.5 py-0.5 text-[9px] font-black z-10 border bg-white transition-colors rounded-full"
                                                    style={{ borderColor: BORDER, color: ROSE_DARK }}
                                                    title="编辑这条记忆"
                                                >
                                                    编辑
                                                </button>
                                            )}

                                            {mem.mood && <div className="mb-1 pr-6"><span className="text-[8px] px-1.5 py-0.5 border rounded-full" style={{ ...MONO_STACK, borderColor: BORDER, color: PAPER_TONES.inkSoft }}>#{mem.mood}</span></div>}
                                            <p className="text-sm leading-relaxed text-justify whitespace-pre-wrap" style={{ color: PAPER_TONES.ink }}>{expandedMemoryIds.has(mem.id) ? mem.summary : (mem.summary.length > 120 ? `${mem.summary.slice(0, 120)}...` : mem.summary)}</p>
                                            {!isManageMode && mem.summary.length > 120 && <div className="mt-2 text-[11px]" style={NOTE_TEXT}>{expandedMemoryIds.has(mem.id) ? '收起全文' : '展开全文'}</div>}
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
            {/* 统计 + 面包屑 */}
            <div className="flex justify-between items-center mb-5 px-1 flex-wrap gap-2">
                <div className="flex gap-4">
                    <div><span className="text-[8px] block" style={{ ...MONO_STACK, color: PAPER_TONES.inkFaint }}>字数</span><span className="text-base font-black font-mono">{stats.totalChars.toLocaleString()} 字</span></div>
                    <div><span className="text-[8px] block" style={{ ...MONO_STACK, color: PAPER_TONES.inkFaint }}>记忆</span><span className="text-base font-black font-mono">{stats.count} 条</span></div>
                </div>
                <div className="flex items-center gap-1 text-xs font-black border bg-white px-3 py-1.5 rounded-full" style={{ borderColor: BORDER, color: PAPER_TONES.ink }}>
                    {viewState.level === 'root' ? <span>记忆档案</span> : (
                        <>
                            <button onClick={() => setViewState({level: 'root', selectedYear: null, selectedMonth: null})} className="underline decoration-dashed underline-offset-2">记忆档案</button><span style={{ color: PAPER_TONES.inkFaint }}>/</span>
                            {viewState.level === 'year' ? <span>{viewState.selectedYear}</span> : (<><button onClick={() => setViewState(prev => ({...prev, level: 'year', selectedMonth: null}))} className="underline decoration-dashed underline-offset-2">{viewState.selectedYear}</button><span style={{ color: PAPER_TONES.inkFaint }}>/</span><span>{parseInt(viewState.selectedMonth!)}月</span></>)}
                        </>
                    )}
                </div>
            </div>
            {viewState.level === 'root' && renderYears()}
            {viewState.level === 'year' && <><div className="mb-4 flex items-center gap-2"><BackChip /><h3 className="text-sm" style={NOTE_TEXT}>选择月份</h3></div>{renderMonths()}</>}
            {viewState.level === 'month' && <><div className="mb-4 flex items-center gap-2"><BackChip /><h3 className="text-sm" style={NOTE_TEXT}>本月记忆，右上角眼睛控制是否带入详细记忆。</h3></div>{renderMemories()}</>}

            {/* ── 编辑记忆 ── */}
            <PaperSheet
                open={!!editMemory}
                tag="MEMORY / 记忆条目"
                title="编辑记忆"
                onClose={() => setEditMemory(null)}
                footer={<button onClick={() => { if(editMemory) onUpdateMemory(editMemory.id, editMemory.summary); setEditMemory(null); }} className={`w-full py-2.5 text-xs font-black ${INK_BTN}`}>保存修改</button>}
            >
                {editMemory && (
                    <div className="space-y-3">
                        <div className="text-[9px]" style={{ ...MONO_STACK, color: PAPER_TONES.inkFaint }}>日期 {editMemory.date}</div>
                        <textarea value={editMemory.summary} onChange={e => setEditMemory({...editMemory, summary: e.target.value})} className={`${AREA_INPUT} h-40`} />
                    </div>
                )}
            </PaperSheet>

            {/* ── 删除记忆确认 ── */}
            <PaperSheet
                open={showDeleteConfirm}
                tag="DELETE / 不可复原"
                title={`删除 ${selectedIds.size} 条记忆？`}
                onClose={() => setShowDeleteConfirm(false)}
                footer={<div className="flex gap-2 w-full">
                    <button onClick={() => setShowDeleteConfirm(false)} className={`flex-1 py-2.5 text-xs font-black ${STICKER}`}>取消</button>
                    <button onClick={performDelete} className={`flex-1 py-2.5 text-xs font-black ${INK_BTN}`}>确认删除</button>
                </div>}
            >
                <p className="text-sm text-center py-2" style={{ color: PAPER_TONES.inkSoft }}>删除后无法撤销。</p>
            </PaperSheet>

            {/* ── 编辑核心记忆 ── */}
            <PaperSheet
                open={!!editingCore}
                tag="CORE MEMORY / 核心记忆"
                title="编辑核心记忆"
                onClose={() => setEditingCore(null)}
                footer={
                    <div className="flex gap-2 w-full">
                        <button onClick={() => setShowCoreDeleteConfirm(true)} className={`flex-1 py-2.5 text-xs font-black ${STICKER}`}>删除</button>
                        <button onClick={saveCoreEdit} className={`flex-1 py-2.5 text-xs font-black ${INK_BTN}`}>保存修改</button>
                    </div>
                }
            >
                {editingCore && (
                    <div className="space-y-2">
                        <div className="text-[9px]" style={{ ...MONO_STACK, color: PAPER_TONES.inkFaint }}>{editingCore.year} 年 {editingCore.month} 月</div>
                        <textarea
                            value={editingCore.content}
                            onChange={e => setEditingCore({...editingCore, content: e.target.value})}
                            className={`${AREA_INPUT} h-48 leading-relaxed`}
                        />
                    </div>
                )}
            </PaperSheet>

            {/* ── 删除核心记忆确认 ── */}
            <PaperSheet
                open={showCoreDeleteConfirm}
                tag="DELETE / 不可复原"
                title="删除核心记忆？"
                onClose={() => setShowCoreDeleteConfirm(false)}
                footer={<div className="flex gap-2 w-full">
                    <button onClick={() => setShowCoreDeleteConfirm(false)} className={`flex-1 py-2.5 text-xs font-black ${STICKER}`}>取消</button>
                    <button onClick={confirmCoreDelete} className={`flex-1 py-2.5 text-xs font-black ${INK_BTN}`}>确认删除</button>
                </div>}
            >
                <p className="text-center text-sm py-2" style={{ color: PAPER_TONES.inkSoft }}>删除后，这个月不会再提供核心记忆摘要。</p>
            </PaperSheet>

            {/* ── 重新生成这一天 ── */}
            <PaperSheet
                open={!!forcePickerDate}
                tag="REGENERATE / 重新生成"
                title="重新生成当天记忆"
                onClose={() => setForcePickerDate(null)}
                footer={<div className="flex gap-2 w-full">
                    <button onClick={() => setForcePickerDate(null)} className={`flex-1 py-2.5 text-xs font-black ${STICKER}`}>取消</button>
                    <button onClick={confirmForcePicker} className={`flex-1 py-2.5 text-xs font-black ${INK_BTN}`}>开始生成</button>
                </div>}
            >
                <div className="space-y-3">
                    <p className="text-[13px] leading-relaxed" style={NOTE_TEXT}>
                        将从原始聊天重新读取 <b style={{ color: PAPER_TONES.ink }}>{forcePickerDate}</b> 的全部消息，并生成新的记忆摘要。请选择模板：
                    </p>
                    <div className="space-y-1.5 max-h-[40vh] overflow-y-auto">
                        {(forceArchiveTemplates || []).map(p => (
                            <div
                                key={p.id}
                                onClick={() => setForcePickerPromptId(p.id)}
                                className="p-3 border cursor-pointer transition-colors rounded-[14px] bg-white"
                                style={forcePickerPromptId === p.id ? { borderColor: ROSE, boxShadow: CARD_SHADOW } : { borderColor: BORDER }}
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
