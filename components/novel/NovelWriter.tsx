
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { NovelBook, NovelSegment, CharacterProfile, UserProfile } from '../../types';
import {
    NOVEL_THEMES, GenerationOptions, extractWritingTags,
    analyzeWriterPersonaSimple, generateWriterPersonaDeep,
    buildPrompt, parsePersonaMarkdown
} from '../../utils/novelUtils';
import { useOS } from '../../context/OSContext';
import { safeResponseJson } from '../../utils/safeApi';
import {
    PAPER, PAPER_CARD, HAND, BRUSH, DOT_BG, GRID_BG, LINES_BG,
    Tape, Stitch, Cut, Kicker, BackSticker, IconStamp, InkButton, Chip, TypingDots,
    CollageModal, CollageConfirm,
} from '../../apps/creative/collage';
import {
    CaretDown, PencilSimple, Trash, ArrowsClockwise, PaperPlaneRight,
    Books, BookmarkSimple, Brain, MagicWand,
} from '@phosphor-icons/react';

const MINCHO: React.CSSProperties = { fontFamily: "'Shippori Mincho','Noto Serif SC',serif" };

interface NovelWriterProps {
    activeBook: NovelBook;
    updateNovel: (id: string, updates: Partial<NovelBook>) => Promise<void>;
    characters: CharacterProfile[];
    userProfile: UserProfile;
    apiConfig: any;
    onBack: () => void;
    updateCharacter: (id: string, updates: Partial<CharacterProfile>) => void;
    collaborators: CharacterProfile[];
    setTargetCharId: (id: string) => void;
    targetCharId: string | null;
    onOpenSettings: () => void;
}

// Extracted Component: PersonaPanel
// Moving this outside ensures React doesn't re-mount it on every render of parent, preserving scroll state.
interface PersonaPanelProps {
    char: CharacterProfile;
    userProfile: UserProfile;
    targetCharId: string | null;
    isTyping: boolean;
    setIsTyping: (v: boolean) => void;
    setConfirmDialog: (v: any) => void;
    addToast: (msg: string, type: 'success' | 'error' | 'info') => void;
    apiConfig: any;
    updateCharacter: (id: string, updates: Partial<CharacterProfile>) => void;
}

const PersonaPanel: React.FC<PersonaPanelProps> = ({
    char, userProfile, targetCharId, isTyping, setIsTyping, setConfirmDialog, addToast, apiConfig, updateCharacter
}) => {
    const rawPersona = char.writerPersona || analyzeWriterPersonaSimple(char);
    const sections = parsePersonaMarkdown(rawPersona);

    return (
        <div className="border-t-2 border-dashed border-[#1c1b1a]/25" style={{ background: PAPER, ...DOT_BG }}>
            <div className="max-h-[45vh] overflow-y-auto p-4 space-y-3 overscroll-contain no-scrollbar">
                {sections.length === 0
                    ? <div className="text-center py-8 text-[#1c1b1a]/45 text-sm" style={HAND}>还没摸清这套笔法<br /><span className="text-xs">点下面让 AI 拆给你看</span></div>
                    : sections.map((sec, idx) => (
                        <div key={idx} className="relative bg-white border-2 border-[#1c1b1a] shadow-[2px_2px_0_#1c1b1a] p-3.5" style={{ transform: `rotate(${idx % 2 ? 0.5 : -0.5}deg)` }}>
                            <div className="flex items-center gap-2 mb-2 pb-2 border-b-2 border-dashed border-[#1c1b1a]/20"><span className="text-base">{sec.icon}</span><h4 className="text-sm font-black text-[#1c1b1a]" style={BRUSH}>{sec.title}</h4></div>
                            <div className="space-y-1">{sec.content.map((line, lIdx) => <p key={lIdx} className="text-sm text-[#1c1b1a]/70 leading-relaxed" style={HAND}>{line}</p>)}</div>
                        </div>
                    ))}
            </div>
            <div className="px-4 py-3 border-t-2 border-dashed border-[#1c1b1a]/25">
                <button onClick={async () => {
                    if (!targetCharId) return;
                    setConfirmDialog({
                        isOpen: true,
                        title: '重描这套笔法？',
                        message: '让 AI 重新拆解 TA 的写作习惯，会花掉一点点 token。',
                        variant: 'info',
                        confirmText: '重描',
                        onConfirm: async () => {
                            setConfirmDialog(null);
                            addToast('正在拆解笔法…', 'info');
                            setIsTyping(true);
                            try {
                                await generateWriterPersonaDeep(char, userProfile, apiConfig, updateCharacter, true);
                                addToast('笔法已更新', 'success');
                            } catch (e) {
                                addToast('没拆成', 'error');
                            } finally {
                                setIsTyping(false);
                            }
                        }
                    });
                }} disabled={isTyping} className="w-full bg-[#1c1b1a] text-[#f2f0e9] py-2.5 border-2 border-[#1c1b1a] text-sm font-black transition-all flex items-center justify-center gap-2 active:translate-y-[2px] disabled:opacity-50">
                    {isTyping ? <span className="w-4 h-4 border-2 border-[#f2f0e9] border-t-transparent rounded-full animate-spin" /> : <><MagicWand size={16} weight="bold" /> 让 AI 拆解笔法</>}
                </button>
            </div>
        </div>
    );
};

const NovelWriter: React.FC<NovelWriterProps> = ({
    activeBook, updateNovel, characters, userProfile,
    apiConfig, onBack, updateCharacter, collaborators,
    targetCharId, setTargetCharId, onOpenSettings
}) => {
    const { addToast } = useOS();
    const activeTheme = useMemo(() => NOVEL_THEMES.find(t => t.id === activeBook.coverStyle) || NOVEL_THEMES[0], [activeBook.coverStyle]);

    // State
    const [genOptions, setGenOptions] = useState<GenerationOptions>({ write: true, comment: false, analyze: false });
    const [inputText, setInputText] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [segments, setSegments] = useState<NovelSegment[]>(activeBook.segments);
    const [lastTokenUsage, setLastTokenUsage] = useState<number | null>(null);
    const [isStyleExpanded, setIsStyleExpanded] = useState(false);

    // Modals & Dialogs
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [editingSegment, setEditingSegment] = useState<NovelSegment | null>(null);
    const [editSegmentContent, setEditSegmentContent] = useState('');
    const [confirmDialog, setConfirmDialog] = useState<{ isOpen: boolean; title: string; message: string; variant: 'danger' | 'warning' | 'info'; confirmText?: string; onConfirm: () => void; } | null>(null);

    // Summary States
    const [showSummaryModal, setShowSummaryModal] = useState(false);
    const [summaryContent, setSummaryContent] = useState('');
    const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
    const [showHistoryModal, setShowHistoryModal] = useState(false);
    const [readingChapterIndex, setReadingChapterIndex] = useState<number | null>(null);

    const scrollRef = useRef<HTMLDivElement>(null);

    // Sync local segments with book
    useEffect(() => {
        setSegments(activeBook.segments);
    }, [activeBook.segments]);

    useEffect(() => {
        if (scrollRef.current && !isEditModalOpen) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [segments, isTyping, isEditModalOpen]);

    const chapterCount = useMemo(() => segments.filter(s => s.focus === 'chapter_summary').length + 1, [segments]);
    const targetChar = characters.find(c => c.id === targetCharId);
    const canReroll = segments.length > 0 && segments[segments.length - 1].authorId !== 'user';

    const displaySegments = useMemo(() => {
        let lastSummaryIdx = -1;
        for (let i = segments.length - 1; i >= 0; i--) {
            if (segments[i].focus === 'chapter_summary') { lastSummaryIdx = i; break; }
        }
        return segments.slice(lastSummaryIdx + 1);
    }, [segments]);

    const historicalSummaries = useMemo(() => {
        return segments.filter(s => s.focus === 'chapter_summary');
    }, [segments]);

    // Compute full chapter content list for reading mode
    const chapterContentList = useMemo(() => {
        const chapters: { title: string; segments: NovelSegment[]; summary: string }[] = [];
        const summaryIndices: number[] = [];
        segments.forEach((s, i) => { if (s.focus === 'chapter_summary') summaryIndices.push(i); });

        for (let ci = 0; ci < summaryIndices.length; ci++) {
            const start = ci === 0 ? 0 : summaryIndices[ci - 1] + 1;
            const end = summaryIndices[ci];
            const chapterSegs = segments.slice(start, end).filter(s => s.type === 'story');
            chapters.push({
                title: `第 ${ci + 1} 章`,
                segments: chapterSegs,
                summary: segments[summaryIndices[ci]].content
            });
        }
        return chapters;
    }, [segments]);

    // --- Actions ---

    const runGeneration = async (char: CharacterProfile, userPrompt: string, contextSegments: NovelSegment[]) => {
        setIsTyping(true);
        setLastTokenUsage(null);

        try {
            const allSummaries = contextSegments.filter(s => s.focus === 'chapter_summary');
            let currentChapterStart = 0;
            if (allSummaries.length > 0) {
                const lastSummary = allSummaries[allSummaries.length - 1];
                currentChapterStart = contextSegments.findIndex(s => s.id === lastSummary.id) + 1;
            }
            const currentChapterSegs = contextSegments.slice(currentChapterStart).filter(s => s.role === 'writer' || s.type === 'story');

            let storyContext = '';
            if (allSummaries.length > 0) {
                storyContext += '【前情回顾 / Chapter Recaps】\n';
                allSummaries.forEach((summary, idx) => storyContext += `\n第${idx + 1}章总结：\n${summary.content}\n`);
                storyContext += '\n---\n\n【当前章节 / Current Chapter】\n';
            } else {
                storyContext += '【当前章节 / Current Chapter】\n';
            }

            currentChapterSegs.forEach(s => {
                const authorName = s.authorId === 'user' ? userProfile.name : (characters.find(c => c.id === s.authorId)?.name || 'AI');
                storyContext += `\n[${authorName}]: ${s.content}\n`;
            });

            const prompt = buildPrompt(char, userProfile, activeBook, userPrompt, storyContext, genOptions, contextSegments, characters);
            const temperature = 0.85;

            const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
                body: JSON.stringify({ model: apiConfig.model, messages: [{ role: "user", content: prompt }], temperature, max_tokens: 8000 })
            });

            if (response.ok) {
                const data = await safeResponseJson(response);
                if (data.usage?.total_tokens) setLastTokenUsage(data.usage.total_tokens);

                let content = data.choices[0].message.content.trim();
                const originalRaw = content;
                content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '');
                const jsonMatch = content.match(/\{[\s\S]*\}/);
                if (jsonMatch) content = jsonMatch[0];

                let res;
                try { res = JSON.parse(content); } catch (e) { res = { writer: { content: originalRaw } }; }

                const newAiSegments: NovelSegment[] = [];
                const baseTime = Date.now();

                if (res.analysis && (res.analysis.critique || res.analysis.reaction)) {
                    newAiSegments.push({ id: `seg-${baseTime}-a`, role: 'analyst', type: 'analysis', authorId: char.id, content: res.analysis.critique || JSON.stringify(res.analysis), focus: res.analysis.focus, meta: { reaction: res.analysis.reaction }, timestamp: baseTime + 1 });
                }
                if (res.writer && res.writer.content) {
                    newAiSegments.push({ id: `seg-${baseTime}-w`, role: 'writer', type: 'story', authorId: char.id, content: res.writer.content, meta: { ...(res.meta || {}), technique: res.writer.technique, mood: res.writer.mood }, timestamp: baseTime + 2 });
                }
                if (res.comment && res.comment.content) {
                    newAiSegments.push({ id: `seg-${baseTime}-c`, role: 'commenter', type: 'discussion', authorId: char.id, content: res.comment.content, timestamp: baseTime + 3 });
                }

                setSegments(prev => {
                    const next = [...prev, ...newAiSegments];
                    updateNovel(activeBook.id, { segments: next });
                    return next;
                });
            } else { throw new Error(`API Error: ${response.status}`); }
        } catch (e: any) { addToast('没写出来：' + e.message, 'error'); } finally { setIsTyping(false); }
    };

    const handleSend = async () => {
        if (!targetCharId) { addToast('先在上面挑个搭子', 'error'); return; }
        const selectedChar = characters.find(c => c.id === targetCharId);
        if (!selectedChar) return;

        let currentSegments = segments;
        if (inputText.trim()) {
            const userSegment: NovelSegment = { id: `seg-${Date.now()}`, role: 'writer', type: 'story', authorId: 'user', content: inputText, timestamp: Date.now() };
            currentSegments = [...segments, userSegment];
            setSegments(currentSegments);
            updateNovel(activeBook.id, { segments: currentSegments });
        }
        const userPrompt = inputText;
        setInputText('');
        await runGeneration(selectedChar, userPrompt, currentSegments);
    };

    const handleReroll = async () => {
        if (!targetCharId) return;
        const selectedChar = characters.find(c => c.id === targetCharId);
        if (!selectedChar) return;

        let newSegments = [...segments];
        let deletedCount = 0;
        while (newSegments.length > 0) {
            const last = newSegments[newSegments.length - 1];
            if (last.authorId !== 'user') { newSegments.pop(); deletedCount++; } else { break; }
        }
        if (deletedCount === 0) { addToast('没有可以重写的 AI 段落', 'info'); return; }
        setSegments(newSegments);
        updateNovel(activeBook.id, { segments: newSegments });
        addToast('换个写法…', 'info');
        await runGeneration(selectedChar, "", newSegments);
    };

    const handleEditSegment = (seg: NovelSegment) => {
        setEditingSegment(seg);
        setEditSegmentContent(seg.content);
        setIsEditModalOpen(true);
    };

    const saveSegmentEdit = () => {
        if (!editingSegment) return;
        const newSegments = segments.map(s => s.id === editingSegment.id ? { ...s, content: editSegmentContent } : s);
        setSegments(newSegments);
        updateNovel(activeBook.id, { segments: newSegments });
        setIsEditModalOpen(false);
        setEditingSegment(null);
    };

    const handleDeleteSegment = (id: string) => {
        setConfirmDialog({
            isOpen: true,
            title: '划掉这段？',
            message: '这一段会从稿子里抹掉，没法复原。',
            variant: 'danger',
            confirmText: '划掉',
            onConfirm: () => {
                const newSegments = segments.filter(s => s.id !== id);
                setSegments(newSegments);
                updateNovel(activeBook.id, { segments: newSegments });
                setConfirmDialog(null);
            }
        });
    };

    // Chapter Summary Logic
    const handleGenerateChapterSummary = async () => {
        setIsGeneratingSummary(true);
        setShowSummaryModal(true);
        setSummaryContent('正在回顾本章节内容...');
        try {
            let startIndex = 0;
            let lastSummaryIdx = -1;
            for (let i = segments.length - 1; i >= 0; i--) {
                if (segments[i].focus === 'chapter_summary') { lastSummaryIdx = i; break; }
            }
            if (lastSummaryIdx !== -1) startIndex = lastSummaryIdx + 1;

            const currentChapterSegs = segments.slice(startIndex).filter(s => s.type === 'story' || s.role === 'writer');
            const chapterText = currentChapterSegs.map(s => s.content).join('\n\n');

            if (!chapterText.trim()) {
                setSummaryContent('本章似乎还没有足够的内容来生成总结。');
                setIsGeneratingSummary(false);
                return;
            }

            const existingSummaries = segments.filter(s => s.focus === 'chapter_summary');
            const prevSummaryContext = existingSummaries.length > 0
                ? `\n### 前章摘要参考（保持一致性）\n${existingSummaries.map((s, i) => `第${i+1}章：${s.content.substring(0, 300)}`).join('\n')}\n`
                : '';

            const prompt = `### 任务：章节归档总结
小说：《${activeBook.title}》
世界观：${activeBook.worldSetting || '未设定'}
${prevSummaryContext}
### 当前章节正文
${chapterText.substring(0, 200000)}

### 总结要求
请为上述章节内容生成一份**高质量归档总结**，满足以下要求：

1. **剧情轨迹**：按时间顺序梳理本章发生的所有关键事件，不遗漏任何主线或支线转折点。
2. **角色动态**：记录每个出场角色的行为、态度变化、关系发展。特别注意角色之间的互动和情感变化。
3. **氛围与基调**：描述本章的整体氛围（例如：紧张、温馨、悬疑），以及氛围的转折点。
4. **重要信息**：标记所有可能影响后续剧情的伏笔、承诺、悬念、新设定等。
5. **场景与环境**：记录关键场景的地点、时间、环境特征。
6. **写作格式**：使用清晰的结构化格式（可以分段或使用标记），让后续章节的AI仅凭此总结就能无缝衔接创作。

请直接输出总结内容，不需要JSON格式。`;
            const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
                body: JSON.stringify({ model: apiConfig.model, messages: [{ role: "user", content: prompt }] })
            });

            if (response.ok) {
                const data = await safeResponseJson(response);
                setSummaryContent(data.choices[0].message.content);
            } else { setSummaryContent('生成失败，请重试。'); }
        } catch (e: any) { setSummaryContent(`错误: ${e.message}`); } finally { setIsGeneratingSummary(false); }
    };

    const confirmChapterSummary = async () => {
        const summarySeg: NovelSegment = { id: `seg-summary-${Date.now()}`, role: 'analyst', type: 'analysis', authorId: 'system', content: summaryContent, focus: 'chapter_summary', timestamp: Date.now(), meta: { reaction: '本章结束', suggestion: '新章节开始' } };
        const newSegments = [...segments, summarySeg];
        setSegments(newSegments);
        await updateNovel(activeBook.id, { segments: newSegments });

        const currentDate = new Date().toISOString().split('T')[0];
        const chapterNum = newSegments.filter(s => s.focus === 'chapter_summary').length;
        const collabNames = collaborators.map(c => c.name).join('、');

        for (const cId of activeBook.collaboratorIds) {
            const char = characters.find(c => c.id === cId);
            if (char) {
                const memory = { id: `mem-${Date.now()}-${Math.random()}`, date: currentDate, summary: `与${collabNames}一起为《${activeBook.title}》创作了第${chapterNum}章，已完成归档。`, mood: 'creative' };
                updateCharacter(char.id, { memories: [...(char.memories || []), memory] });
            }
        }
        setShowSummaryModal(false);
        setSummaryContent('');
        addToast('本章归档，记忆已同步', 'success');
    };

    // 段落悬浮操作（改 / 删）
    const HoverMenu = ({ seg }: { seg: NovelSegment }) => (
        <div className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1 z-10">
            <button onClick={() => handleEditSegment(seg)} className="w-6 h-6 bg-white border-2 border-[#1c1b1a] flex items-center justify-center text-[#1c1b1a] active:translate-y-[1px]"><PencilSimple size={12} weight="bold" /></button>
            <button onClick={() => handleDeleteSegment(seg.id)} className="w-6 h-6 bg-white border-2 border-[#1c1b1a] flex items-center justify-center text-[#1c1b1a] active:translate-y-[1px]"><Trash size={12} weight="bold" /></button>
        </div>
    );

    return (
        <div className="h-full w-full flex flex-col relative animate-fade-in" style={{ background: PAPER, ...DOT_BG }}>
            <CollageConfirm isOpen={!!confirmDialog} title={confirmDialog?.title || ''} message={confirmDialog?.message || ''} variant={confirmDialog?.variant} confirmText={confirmDialog?.confirmText || '确认'} cancelText="算了" onConfirm={confirmDialog?.onConfirm || (() => setConfirmDialog(null))} onCancel={() => setConfirmDialog(null)} />

            {/* 顶栏 */}
            <div className="shrink-0 z-20 border-b-2 border-[#1c1b1a]" style={{ background: PAPER }}>
                <div className="relative flex items-center gap-2 px-4 pb-2" style={{ paddingTop: 'calc(var(--safe-top) + 0.6rem)' }}>
                    <BackSticker onClick={onBack} label="回抽屉" />
                    <button onClick={onOpenSettings} className="flex-1 min-w-0 flex flex-col items-center active:opacity-70 transition-opacity">
                        <span className="font-black text-lg text-[#1c1b1a] truncate max-w-[150px]" style={BRUSH}>{activeBook.title}</span>
                        <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="label-mono text-[8px] text-[#1c1b1a]/55">CH.{String(chapterCount).padStart(2, '0')}</span>
                            {lastTokenUsage && <span className="label-mono text-[7px] px-1 border border-[#1c1b1a]/45 text-[#1c1b1a]/55">{lastTokenUsage}t</span>}
                        </div>
                    </button>
                    <div className="flex items-center gap-1.5">
                        <IconStamp onClick={() => setShowHistoryModal(true)} title="读过的章节"><Books size={18} weight="bold" /></IconStamp>
                        <IconStamp tone="ink" onClick={handleGenerateChapterSummary} disabled={isTyping} title="收束本章"><BookmarkSimple size={18} weight="bold" /></IconStamp>
                    </div>
                </div>
                {/* 搭子标签 */}
                <div className="px-4 pb-2.5 flex gap-2 overflow-x-auto no-scrollbar">
                    {collaborators.map(c => { const on = targetCharId === c.id; return (
                        <button key={c.id} onClick={() => setTargetCharId(c.id)} className={`shrink-0 flex items-center gap-1.5 px-2 py-1 border-2 border-[#1c1b1a] transition-all relative ${on ? 'bg-[#1c1b1a] text-[#f2f0e9]' : 'bg-white text-[#1c1b1a] shadow-[1px_1px_0_#1c1b1a]'}`}>
                            <img src={c.avatar} className="w-5 h-5 object-cover border border-current" />
                            <span className="text-xs font-bold whitespace-nowrap">{c.name}</span>
                            {c.writerPersona && <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-[#1c1b1a] border border-[#f2f0e9]" />}
                        </button>
                    ); })}
                </div>
            </div>

            {/* 笔法条 + 展开 */}
            <div className="shrink-0 z-10 border-b-2 border-dashed border-[#1c1b1a]/30" style={{ background: PAPER }}>
                <div className="px-4 py-2 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 overflow-x-auto no-scrollbar flex-1">
                        {targetChar && <img src={targetChar.avatar} className="w-6 h-6 object-cover border border-[#1c1b1a] shrink-0" />}
                        <span className="label-mono text-[8px] text-[#1c1b1a]/60 shrink-0 whitespace-nowrap">{targetChar?.name ? `${targetChar.name} 的笔法` : '还没挑人'}</span>
                        <div className="flex gap-1.5">
                            {targetChar && extractWritingTags(targetChar).slice(0, 3).map((tag, idx) => (
                                <span key={idx} className="px-1.5 py-0.5 text-[9px] font-bold border border-[#1c1b1a] bg-white text-[#1c1b1a] whitespace-nowrap" style={{ transform: `rotate(${idx % 2 ? 1 : -1}deg)` }}>{tag}</span>
                            ))}
                        </div>
                    </div>
                    <button onClick={() => setIsStyleExpanded(!isStyleExpanded)} className="shrink-0 inline-flex items-center gap-1 label-mono text-[8px] px-2 py-1 border-2 border-[#1c1b1a] bg-white shadow-[1px_1px_0_#1c1b1a] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all">底细 <CaretDown size={10} weight="bold" className={`transition-transform ${isStyleExpanded ? 'rotate-180' : ''}`} /></button>
                </div>
                <div className={`transition-all duration-300 ease-out overflow-hidden ${isStyleExpanded ? 'max-h-[60vh] opacity-100' : 'max-h-0 opacity-0'}`}>
                    {targetChar ? <PersonaPanel
                        char={targetChar}
                        userProfile={userProfile}
                        targetCharId={targetCharId}
                        isTyping={isTyping}
                        setIsTyping={setIsTyping}
                        setConfirmDialog={setConfirmDialog}
                        addToast={addToast}
                        apiConfig={apiConfig}
                        updateCharacter={updateCharacter}
                    /> : <div className="p-4 text-center text-sm text-[#1c1b1a]/40" style={HAND}>先在上面挑个人</div>}
                </div>
            </div>

            {/* 正文流 */}
            <div className="flex-1 overflow-y-auto px-4 py-5 space-y-7 no-scrollbar pb-44" ref={scrollRef}>
                {displaySegments.length === 0 && <div className="text-center py-20 text-[#1c1b1a]/40"><p className="text-base leading-loose" style={HAND}>第 {chapterCount} 章<br />提起笔，写下第一句</p></div>}
                {displaySegments.map(seg => {
                    const isUser = seg.authorId === 'user';
                    const char = !isUser ? characters.find(c => c.id === seg.authorId) : null;
                    const role = seg.role || (seg.type === 'story' ? 'writer' : (seg.type === 'analysis' ? 'analyst' : 'commenter'));

                    if (role === 'writer') return (
                        <div key={seg.id} className={`relative group border-2 border-[#1c1b1a] shadow-[4px_4px_0_#1c1b1a] p-5 pt-7 leading-loose text-justify text-[17px] ${activeTheme.paper} ${activeTheme.text}`} style={MINCHO}>
                            <HoverMenu seg={seg} />
                            <div className="absolute -top-3 left-4 flex items-center gap-1.5 bg-white border-2 border-[#1c1b1a] px-2 py-0.5">
                                {!isUser && <img src={char?.avatar} className="w-3 h-3 object-cover border border-[#1c1b1a]" />}
                                <span className="label-mono text-[7px] text-[#1c1b1a]">{isUser ? '我 · 落笔' : `${char?.name} · 执笔`}</span>
                                {!isUser && seg.meta?.mood && <span className="bg-[#1c1b1a] text-[#f2f0e9] px-1 text-[7px]">{seg.meta.mood}</span>}
                            </div>
                            {isUser && <span aria-hidden className="absolute left-0 top-0 bottom-0 w-1.5 bg-[#1c1b1a]" />}
                            <div className="whitespace-pre-wrap">{seg.content}</div>
                        </div>
                    );
                    if (role === 'commenter') return (
                        <div key={seg.id} className="flex gap-2 max-w-[88%] ml-auto flex-row-reverse animate-slide-up group relative">
                            <div className="w-8 h-8 overflow-hidden shrink-0 border-2 border-[#1c1b1a] mt-1"><img src={isUser ? userProfile.avatar : char?.avatar} className="w-full h-full object-cover" /></div>
                            <div className="relative p-3 text-sm border-2 border-[#1c1b1a] shadow-[2px_2px_0_#1c1b1a] bg-[#fdf6b2] text-[#1c1b1a] rotate-1" style={HAND}><HoverMenu seg={seg} />{seg.content}</div>
                        </div>
                    );
                    if (role === 'analyst') return (
                        <div key={seg.id} className="relative group mx-1 bg-white border-2 border-[#1c1b1a] shadow-[3px_3px_0_#1c1b1a] p-4 text-xs text-[#1c1b1a]/75" style={GRID_BG}>
                            <HoverMenu seg={seg} />
                            <div className="flex items-center gap-2 mb-2 pb-2 border-b-2 border-dashed border-[#1c1b1a]/25"><Brain size={16} weight="bold" className="text-[#1c1b1a]" /><span className="font-black text-[#1c1b1a]" style={BRUSH}>{char?.name} 的批注</span>{seg.focus && <span className="label-mono text-[7px] px-1.5 py-0.5 border border-[#1c1b1a]">{seg.focus}</span>}</div>
                            {seg.meta?.reaction && <div className="mb-2 pb-2 border-b border-dashed border-[#1c1b1a]/20"><span className="label-mono text-[7px] text-[#1c1b1a]/45">第一反应</span><p className="text-sm font-bold mt-0.5" style={HAND}>「{seg.meta.reaction}」</p></div>}
                            <p className="leading-relaxed whitespace-pre-wrap">{seg.content}</p>
                        </div>
                    );
                    return null;
                })}
                {isTyping && <div className="flex justify-center py-4"><div className="px-3 py-2 bg-white border-2 border-[#1c1b1a] shadow-[2px_2px_0_#1c1b1a]"><TypingDots /></div></div>}
            </div>

            {/* 输入区 */}
            <div className="absolute bottom-0 w-full border-t-2 border-[#1c1b1a] z-30 pb-safe" style={{ background: PAPER_CARD }}>
                <div className="flex gap-2 px-4 py-2 overflow-x-auto no-scrollbar border-b-2 border-dashed border-[#1c1b1a]/25">
                    <Chip active={genOptions.write} onClick={() => setGenOptions({ ...genOptions, write: !genOptions.write })}>续写正文</Chip>
                    <Chip active={genOptions.comment} onClick={() => setGenOptions({ ...genOptions, comment: !genOptions.comment })}>角色吐槽</Chip>
                    <Chip active={genOptions.analyze} onClick={() => setGenOptions({ ...genOptions, analyze: !genOptions.analyze })}>深度批注</Chip>
                </div>
                <div className="p-3 flex gap-2 items-end">
                    <textarea value={inputText} onChange={e => setInputText(e.target.value)} placeholder={genOptions.write ? (inputText.trim() ? "补一句剧情走向…" : "写句开头，或留空让 TA 接着写…") : "说说你的想法…"} className="flex-1 bg-white border-2 border-[#1c1b1a] px-3 py-2.5 text-sm text-[#1c1b1a] outline-none resize-none max-h-32 placeholder:text-[#1c1b1a]/35 focus:shadow-[2px_2px_0_#1c1b1a] transition-shadow" rows={1} style={{ minHeight: '46px' }} />
                    {canReroll && !isTyping && !inputText.trim() && <IconStamp onClick={handleReroll} title="换个写法"><ArrowsClockwise size={18} weight="bold" /></IconStamp>}
                    <IconStamp tone="ink" onClick={handleSend} disabled={isTyping || (!inputText.trim() && !genOptions.write)} title="落笔"><PaperPlaneRight size={18} weight="bold" /></IconStamp>
                </div>
            </div>

            {/* 弹窗 */}
            <CollageModal isOpen={isEditModalOpen} title="改两笔" kicker="EDIT" onClose={() => setIsEditModalOpen(false)} footer={<InkButton tone="ink" onClick={saveSegmentEdit} className="w-full text-sm tracking-[0.3em]">改 好 了</InkButton>}>
                <textarea value={editSegmentContent} onChange={e => setEditSegmentContent(e.target.value)} className="w-full h-48 bg-white border-2 border-[#1c1b1a] p-3 text-sm resize-none focus:outline-none focus:shadow-[2px_2px_0_#1c1b1a] transition-shadow leading-relaxed" style={MINCHO} />
            </CollageModal>

            <CollageModal isOpen={showSummaryModal} title="本章收束" kicker="CHAPTER WRAP-UP" onClose={() => setShowSummaryModal(false)} footer={isGeneratingSummary ? <div className="w-full py-3 border-2 border-dashed border-[#1c1b1a]/40 text-[#1c1b1a]/55 font-black text-center text-sm flex items-center justify-center gap-2"><TypingDots /> AI 归档中</div> : <InkButton tone="ink" onClick={confirmChapterSummary} className="w-full text-sm tracking-[0.2em]">归档，翻开新章</InkButton>}>
                <textarea value={summaryContent} onChange={e => setSummaryContent(e.target.value)} className="w-full h-64 bg-white border-2 border-[#1c1b1a] p-3 text-sm resize-none focus:outline-none focus:shadow-[2px_2px_0_#1c1b1a] transition-shadow leading-relaxed" style={{ ...LINES_BG }} placeholder="总结生成中..." />
            </CollageModal>

            <CollageModal isOpen={showHistoryModal} title="读过的章节" kicker="PAST CHAPTERS" onClose={() => setShowHistoryModal(false)}>
                <div className="space-y-4">
                    {historicalSummaries.length === 0 && <div className="text-center text-[#1c1b1a]/40 py-6 text-sm" style={HAND}>还没有归档的章节</div>}
                    {historicalSummaries.map((s, i) => (
                        <div key={s.id} className="relative bg-white border-2 border-[#1c1b1a] shadow-[2px_2px_0_#1c1b1a] p-4">
                            <div className="flex items-center justify-between mb-2">
                                <div className="font-black text-[#1c1b1a]" style={BRUSH}>第 {i + 1} 章</div>
                                <button onClick={() => { setReadingChapterIndex(i); setShowHistoryModal(false); }} className="label-mono text-[8px] px-2 py-1 border-2 border-[#1c1b1a] bg-[#1c1b1a] text-[#f2f0e9] active:translate-y-[1px] transition-all">翻原文</button>
                            </div>
                            <div className="text-xs text-[#1c1b1a]/65 leading-relaxed whitespace-pre-wrap line-clamp-4" style={HAND}>{s.content}</div>
                        </div>
                    ))}
                </div>
            </CollageModal>

            {/* 整章阅读 */}
            <CollageModal isOpen={readingChapterIndex !== null} title={chapterContentList[readingChapterIndex ?? 0]?.title || ''} kicker="READING" onClose={() => setReadingChapterIndex(null)}>
                <div className="space-y-4">
                    {readingChapterIndex !== null && chapterContentList[readingChapterIndex] && (
                        <>
                            {chapterContentList[readingChapterIndex].segments.map(seg => {
                                const isUser = seg.authorId === 'user';
                                const char = !isUser ? characters.find(c => c.id === seg.authorId) : null;
                                return (
                                    <div key={seg.id} className={`relative border-2 border-[#1c1b1a] p-4 pt-6 leading-loose text-justify text-[15px] ${activeTheme.paper} ${activeTheme.text}`} style={MINCHO}>
                                        <div className="absolute -top-3 left-3 flex items-center gap-1.5 bg-white border-2 border-[#1c1b1a] px-1.5 py-0.5">
                                            {!isUser && char && <img src={char.avatar} className="w-3 h-3 object-cover border border-[#1c1b1a]" />}
                                            <span className="label-mono text-[7px] text-[#1c1b1a]">{isUser ? '我 · 落笔' : `${char?.name} · 执笔`}</span>
                                        </div>
                                        <div className="whitespace-pre-wrap">{seg.content}</div>
                                    </div>
                                );
                            })}
                            <div className="relative bg-white border-2 border-[#1c1b1a] shadow-[2px_2px_0_#1c1b1a] p-4 mt-2">
                                <div className="label-mono text-[8px] text-[#1c1b1a]/50 mb-2">CHAPTER SUMMARY · 本章梗概</div>
                                <div className="text-xs text-[#1c1b1a]/70 leading-relaxed whitespace-pre-wrap" style={HAND}>{chapterContentList[readingChapterIndex].summary}</div>
                            </div>
                            <Cut className="my-1" />
                            <div className="flex justify-between">
                                <button onClick={() => setReadingChapterIndex(Math.max(0, (readingChapterIndex ?? 0) - 1))} disabled={readingChapterIndex === 0} className="label-mono text-[9px] text-[#1c1b1a] disabled:opacity-25 px-3 py-1.5 border-2 border-[#1c1b1a] bg-white shadow-[1px_1px_0_#1c1b1a] active:translate-y-[1px] disabled:active:translate-y-0">← 上一章</button>
                                <button onClick={() => setReadingChapterIndex(Math.min(chapterContentList.length - 1, (readingChapterIndex ?? 0) + 1))} disabled={readingChapterIndex === chapterContentList.length - 1} className="label-mono text-[9px] text-[#1c1b1a] disabled:opacity-25 px-3 py-1.5 border-2 border-[#1c1b1a] bg-white shadow-[1px_1px_0_#1c1b1a] active:translate-y-[1px] disabled:active:translate-y-0">下一章 →</button>
                            </div>
                        </>
                    )}
                </div>
            </CollageModal>
        </div>
    );
};

export default NovelWriter;
