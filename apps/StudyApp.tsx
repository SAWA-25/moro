
import React, { useState, useEffect, useRef } from 'react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { StudyCourse, CharacterProfile, APIConfig, StudyTutorPreset, QuizQuestion, QuizSession, QuizQuestionNote } from '../types';
import { ContextBuilder } from '../utils/context';
import { safeResponseJson } from '../utils/safeApi';
import { resolveAuxApi } from '../utils/auxApi';
import { injectMemoryPalace } from '../utils/memoryPalace/pipeline';
import {
    PaperBackdrop, ScrapButton, WashiTape, PaperDialog, PaperSheet, SectionTag,
    INK, INK_SOFT, PAPER, PAGE_BG, HALFTONE, TAPE_STRIPES, WASHI,
} from './ui/insScrapKit';
import {
    Notepad, Check, X, CheckCircle, XCircle, Hand, CaretLeft, CaretDown, ArrowRight,
    ArrowsClockwise, Trash, GearSix, Plus, PencilSimpleLine, ChatCircleText,
    Eye, Spinner,
} from '@phosphor-icons/react';

// ── 黑白拼贴手账·通用样式片（呼应折子戏 / 心意铺 / 茶话亭）────────────────
/** 米白纸卡 */
const PANEL: React.CSSProperties = {
    background: 'linear-gradient(180deg,#fbf9f2,#f1eee4)',
    border: '1px solid rgba(176,170,158,0.7)',
    outline: '1px dashed rgba(150,144,132,0.5)',
    outlineOffset: '-5px',
    borderRadius: 16,
    boxShadow: '0 12px 24px -16px rgba(31,29,26,0.5)',
};
const paperInput: React.CSSProperties = { background: 'rgba(255,253,247,0.92)', color: INK, border: '1px solid rgba(176,170,158,0.7)' };
const chip = (active: boolean): React.CSSProperties =>
    active
        ? { background: INK, color: PAPER, boxShadow: '0 6px 14px -8px rgba(31,29,26,0.6)' }
        : { background: 'rgba(255,253,247,0.72)', color: '#6b655a', border: '1px dashed rgba(150,144,132,0.6)' };
/** 墨色黑板（课堂/批改）：炭黑底 + 粉笔白字（黑白拼贴的「黑板报」） */
const BOARD_BG = 'linear-gradient(180deg,#26241f,#16140f)';
const CHALK = '#f2efe4';
const CHALK_SOFT = 'rgba(242,239,228,0.62)';

type PdfJsLike = {
    getDocument: (src: { data: ArrayBuffer }) => { promise: Promise<any> };
    GlobalWorkerOptions?: { workerSrc?: string };
};

type KatexLike = {
    renderToString: (latex: string, options: any) => string;
};

let pdfjsPromise: Promise<PdfJsLike> | null = null;
let katexPromise: Promise<KatexLike> | null = null;

const loadScript = (src: string): Promise<void> => new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-src=\"${src}\"]`) as HTMLScriptElement | null;
    if (existing) {
        if ((existing as any).dataset.loaded === 'true') {
            resolve();
            return;
        }
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error(`load failed: ${src}`)), { once: true });
        return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.src = src;
    script.onload = () => {
        script.dataset.loaded = 'true';
        resolve();
    };
    script.onerror = () => reject(new Error(`load failed: ${src}`));
    document.head.appendChild(script);
});

const loadPdfJs = async (): Promise<PdfJsLike> => {
    if (!pdfjsPromise) {
        pdfjsPromise = loadScript('https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.min.js').then(() => {
            const pdfjs = (window as any).pdfjsLib as PdfJsLike | undefined;
            if (!pdfjs) throw new Error('pdfjs 加载失败');
            if (pdfjs?.GlobalWorkerOptions) {
                pdfjs.GlobalWorkerOptions.workerSrc = 'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
            }
            return pdfjs;
        });
    }
    return pdfjsPromise;
};

const loadKatex = async (): Promise<KatexLike> => {
    if (!katexPromise) {
        katexPromise = loadScript('https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js').then(() => {
            const katex = (window as any).katex as KatexLike | undefined;
            if (!katex) throw new Error('KaTeX 加载失败');
            return katex;
        });
    }
    return katexPromise;
};

// --- Styles ---
// 书脊封面：牛皮/米白/炭灰布面（黑白拼贴里旧书的质感，不再用糖果色）
const GRADIENTS = [
    'linear-gradient(135deg, #4a463f 0%, #2a2824 100%)',
    'linear-gradient(135deg, #8a8478 0%, #5e584e 100%)',
    'linear-gradient(135deg, #d8d2c4 0%, #b3ac9e 100%)',
    'linear-gradient(135deg, #6b6459 0%, #3c3832 100%)',
    'linear-gradient(135deg, #b9b2a3 0%, #8c8578 100%)',
    'linear-gradient(135deg, #33302a 0%, #1c1a16 100%)'
];

// --- Renderer Component ---
// Enhanced Markdown & Math Renderer
const BlackboardRenderer: React.FC<{ text: string, isTyping?: boolean, katexRenderer?: { renderToString: (latex: string, options: any) => string } | null }> = ({ text, isTyping, katexRenderer }) => {
    
    // Helper to render math using KaTeX
    const renderMath = (latex: string, displayMode: boolean) => {
        try {
            // Clean up common latex issues from LLM
            const cleanLatex = latex
                .replace(/\\\[/g, '') // Remove \[
                .replace(/\\\]/g, ''); // Remove \]

            const html = katexRenderer?.renderToString(cleanLatex, {
                displayMode: displayMode,
                throwOnError: false, 
                output: 'html',
            });
            if (!html) {
                return <span className="font-mono text-slate-200">{latex}</span>;
            }
            // Force white color for KaTeX elements specifically
            return <span dangerouslySetInnerHTML={{ __html: html }} className={displayMode ? "block my-2 w-full overflow-x-auto" : "inline-block mx-1"} />;
        } catch (e) {
            return <span className="text-slate-300 text-xs font-mono bg-black/20 p-1 rounded italic">{latex}</span>;
        }
    };

    // Inline Parser for Bold, Italic, Code, Inline Math ($...$)
    const parseInline = (line: string): React.ReactNode[] => {
        // Regex logic:
        // 1. $...$ (Inline Math)
        // 2. **...** (Bold)
        // 3. *...* (Italic)
        // 4. `...` (Code)
        const tokenRegex = /(\$[^$]+?\$|\*\*[^*]+?\*\*|\*[^*]+?\*|`[^`]+?`)/g;
        
        return line.split(tokenRegex).map((part, i) => {
            if (part.startsWith('$') && part.endsWith('$')) {
                return <span key={i}>{renderMath(part.slice(1, -1), false)}</span>;
            }
            if (part.startsWith('**') && part.endsWith('**')) {
                return <strong key={i} className="text-white font-bold mx-0.5" style={{ textShadow: '0 0 8px rgba(242,239,228,0.25)' }}>{part.slice(2, -2)}</strong>;
            }
            if (part.startsWith('*') && part.endsWith('*')) {
                return <em key={i} className="text-slate-300 italic">{part.slice(1, -1)}</em>;
            }
            if (part.startsWith('`') && part.endsWith('`')) {
                return <code key={i} className="bg-black/40 text-slate-100 px-1.5 py-0.5 rounded font-mono text-xs mx-0.5 border border-white/10">{part.slice(1, -1)}</code>;
            }
            return <span key={i}>{part}</span>;
        });
    };

    // Block Renderer
    const renderBlock = (block: string, index: number, storedMath: string[], storedCode: string[]) => {
        const trimmed = block.trim();
        if (!trimmed) return <div key={index} className="h-4"></div>;

        // 1. Restore Protected Math Block
        const mathMatch = trimmed.match(/^__BLOCK_MATH_(\d+)__$/);
        if (mathMatch) {
            const id = parseInt(mathMatch[1]);
            return (
                <div key={index} className="w-full text-center my-4 overflow-x-auto no-scrollbar py-3 bg-white/5 rounded-xl border border-white/5 shadow-inner">
                    {renderMath(storedMath[id], true)}
                </div>
            );
        }

        // 2. Restore Protected Code Block
        const codeMatch = trimmed.match(/^__BLOCK_CODE_(\d+)__$/);
        if (codeMatch) {
            const id = parseInt(codeMatch[1]);
            return (
                <pre key={index} className="bg-black/60 p-4 rounded-xl font-mono text-xs text-slate-100 my-4 overflow-x-auto border border-white/10 shadow-inner whitespace-pre-wrap leading-relaxed">
                    {storedCode[id]}
                </pre>
            );
        }

        // Headers
        if (trimmed.startsWith('# ')) return <h1 key={index} className="text-3xl font-bold text-white mt-8 mb-6 pb-2 border-b-2 border-white/20 font-serif">{trimmed.slice(2)}</h1>;
        if (trimmed.startsWith('## ')) return <h2 key={index} className="text-2xl font-bold text-white mt-6 mb-4 font-serif">{trimmed.slice(3)}</h2>;
        if (trimmed.startsWith('### ')) return <h3 key={index} className="text-xl font-bold text-slate-200 mt-5 mb-2 font-serif">{trimmed.slice(4)}</h3>;

        // Blockquotes
        if (trimmed.startsWith('> ')) {
            return (
                <div key={index} className="border-l-4 border-white/40 bg-white/5 p-4 my-3 rounded-r-xl text-slate-100 italic">
                    {parseInline(trimmed.slice(2))}
                </div>
            );
        }

        // Lists
        if (trimmed.match(/^[-•]\s/)) {
            return (
                <div key={index} className="flex gap-3 my-2 pl-2">
                    <span className="text-slate-300 font-bold mt-1">•</span>
                    <span className="text-white/90 leading-relaxed">{parseInline(trimmed.slice(2))}</span>
                </div>
            );
        }
        
        // Numbered Lists
        const numMatch = trimmed.match(/^(\d+)\.\s+(.*)/);
        if (numMatch) {
             return (
                <div key={index} className="flex gap-3 my-2 pl-2">
                    <span className="text-slate-300 font-bold font-mono mt-1">{numMatch[1]}.</span>
                    <span className="text-white/90 leading-relaxed">{parseInline(numMatch[2])}</span>
                </div>
            );
        }

        // Standard Paragraph
        return (
            <div key={index} className="text-white/90 text-lg font-medium leading-loose tracking-wide font-serif mb-4 text-justify">
                {parseInline(block)}
            </div>
        );
    };



    const isTableRow = (line: string) => {
        const trimmed = line.trim();
        return trimmed.includes('|') && /^\|?.+\|.+\|?$/.test(trimmed);
    };

    const isTableSeparator = (line: string) => {
        const cleaned = line.trim().replace(/^\|/, '').replace(/\|$/, '');
        const segments = cleaned.split('|').map(seg => seg.trim());
        if (segments.length < 2) return false;
        return segments.every(seg => /^:?-{3,}:?$/.test(seg));
    };

    const splitTableCells = (line: string) => line
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map(cell => cell.trim());

    const renderTable = (rows: string[], index: number) => {
        if (rows.length < 2) return renderBlock(rows[0], index, storedMath, storedCode);

        const header = splitTableCells(rows[0]);
        const hasSeparator = rows[1] ? isTableSeparator(rows[1]) : false;
        const bodyRows = (hasSeparator ? rows.slice(2) : rows.slice(1)).map(splitTableCells);

        return (
            <div key={`table-${index}`} className="my-4 overflow-x-auto rounded-xl border border-white/10 bg-black/25">
                <table className="w-full min-w-[360px] border-collapse text-sm text-left">
                    <thead className="bg-white/10">
                        <tr>
                            {header.map((cell, i) => (
                                <th key={i} className="px-3 py-2 text-white font-bold border-b border-white/10">
                                    {parseInline(cell)}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {bodyRows.map((row, rowIndex) => (
                            <tr key={rowIndex} className="odd:bg-white/0 even:bg-white/[0.03]">
                                {header.map((_, colIndex) => (
                                    <td key={colIndex} className="px-3 py-2 text-white/90 border-t border-white/5 align-top leading-relaxed">
                                        {parseInline(row[colIndex] || '')}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        );
    };

    // --- Pre-processing Logic ---
    // Protect blocks (Math $$...$$ and Code ```...```) from being split by newlines
    const storedMath: string[] = [];
    const storedCode: string[] = [];
    let processedText = text;

    // 1. Extract Code Blocks
    processedText = processedText.replace(/```[\s\S]*?```/g, (match) => {
        const content = match.replace(/^```\w*\n?/, '').replace(/```$/, '');
        storedCode.push(content);
        return `\n__BLOCK_CODE_${storedCode.length - 1}__\n`; // Add newlines to ensure it separates
    });

    // 2. Extract Block Math ($$ ... $$)
    // Note: LLMs sometimes output \[ ... \] or $$ ... $$. We try to catch $$...$$ mainly.
    processedText = processedText.replace(/\$\$[\s\S]*?\$\$/g, (match) => {
        const content = match.slice(2, -2).trim(); 
        storedMath.push(content);
        return `\n__BLOCK_MATH_${storedMath.length - 1}__\n`;
    });

    // 3. Split by newlines + merge markdown table blocks
    const blocks = processedText.split('\n');
    const renderedBlocks: React.ReactNode[] = [];

    for (let i = 0; i < blocks.length; i++) {
        const line = blocks[i];
        if (isTableRow(line) && i + 1 < blocks.length && isTableSeparator(blocks[i + 1])) {
            const tableLines = [line, blocks[i + 1]];
            let j = i + 2;
            while (j < blocks.length && isTableRow(blocks[j])) {
                tableLines.push(blocks[j]);
                j += 1;
            }
            renderedBlocks.push(renderTable(tableLines, i));
            i = j - 1;
            continue;
        }
        renderedBlocks.push(renderBlock(line, i, storedMath, storedCode));
    }
    
    return (
        <div className="space-y-1">
            {/* FORCE WHITE COLOR FOR KATEX */}
            <style>{`
                .katex { color: white !important; } 
                .katex-display { margin: 0.5em 0; }
                .katex-html { color: white !important; }
            `}</style>
            
            {renderedBlocks}
            {isTyping && (
                <div className="mt-4 animate-pulse flex items-center gap-2 text-slate-300">
                    <span className="w-2 h-5 bg-slate-200"></span>
                    <span className="text-xs font-mono tracking-widest">WRITING...</span>
                </div>
            )}
        </div>
    );
};

const StudyApp: React.FC = () => {
    const { closeApp, characters, activeCharacterId, apiConfig, auxApiConfig, addToast, userProfile, updateCharacter } = useOS();
    const [mode, setMode] = useState<'bookshelf' | 'classroom' | 'quiz' | 'quiz_review' | 'practice_book'>('bookshelf');
    const [courses, setCourses] = useState<StudyCourse[]>([]);
    const [activeCourse, setActiveCourse] = useState<StudyCourse | null>(null);
    const [selectedChar, setSelectedChar] = useState<CharacterProfile | null>(null);
    
    // Classroom State
    const [classroomState, setClassroomState] = useState<'idle' | 'teaching' | 'q_and_a' | 'finished'>('idle');
    const [currentText, setCurrentText] = useState('');
    const [displayedText, setDisplayedText] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [userQuestion, setUserQuestion] = useState('');
    const [chatHistory, setChatHistory] = useState<{role: 'user'|'assistant', content: string}[]>([]);
    const [showChapterMenu, setShowChapterMenu] = useState(false); // Sidebar for history
    const [showAssistant, setShowAssistant] = useState(true); // Toggle assistant visibility
    
    // Logic Refs
    const skipTypingRef = useRef(false); // New: Control to skip animation for cached content

    // Import State
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [processStatus, setProcessStatus] = useState('');
    const [showImportModal, setShowImportModal] = useState(false);
    const [importPreference, setImportPreference] = useState('');
    const [tempPdfData, setTempPdfData] = useState<{name: string, text: string} | null>(null);
    const [katexRenderer, setKatexRenderer] = useState<KatexLike | null>(null);

    // Study-specific API config (overrides main apiConfig when set)
    const [studyApi, setStudyApi] = useState<Partial<APIConfig>>({});
    const [showStudySettings, setShowStudySettings] = useState(false);
    const [localStudyUrl, setLocalStudyUrl] = useState('');
    const [localStudyKey, setLocalStudyKey] = useState('');
    const [localStudyModel, setLocalStudyModel] = useState('');

    // Tutor prompt presets
    const [tutorPresets, setTutorPresets] = useState<StudyTutorPreset[]>([]);
    const [editingPreset, setEditingPreset] = useState<StudyTutorPreset | null>(null);
    const [presetName, setPresetName] = useState('');
    const [presetPrompt, setPresetPrompt] = useState('');

    // Effective API config: study-specific overrides fall back to 副 API（再回退主 API）
    const auxApi = resolveAuxApi(auxApiConfig, apiConfig);
    const effectiveApi: APIConfig = {
        ...apiConfig,
        baseUrl: studyApi.baseUrl || auxApi.baseUrl,
        apiKey: studyApi.apiKey || auxApi.apiKey,
        model: studyApi.model || auxApi.model,
    };

    // Delete Confirmation State
    const [deleteTarget, setDeleteTarget] = useState<StudyCourse | null>(null);

    // Quiz State
    const [quizSession, setQuizSession] = useState<QuizSession | null>(null);
    const [quizLoading, setQuizLoading] = useState<string>(''); // loading status text, empty = not loading
    const [quizUserAnswers, setQuizUserAnswers] = useState<Record<string, string>>({});
    const [quizShowSetup, setQuizShowSetup] = useState(false);
    const [quizTypes, setQuizTypes] = useState<('choice' | 'true_false' | 'fill_blank')[]>(['choice', 'true_false', 'fill_blank']);
    const [quizCount, setQuizCount] = useState(8);
    // Practice Book State
    const [allQuizzes, setAllQuizzes] = useState<QuizSession[]>([]);
    const [reviewingQuiz, setReviewingQuiz] = useState<QuizSession | null>(null);
    const [deleteQuizTarget, setDeleteQuizTarget] = useState<QuizSession | null>(null);
    // Follow-up Q&A state
    const [askingQuestionId, setAskingQuestionId] = useState<string>(''); // which question is being asked about
    const [followUpInput, setFollowUpInput] = useState('');
    const [followUpLoading, setFollowUpLoading] = useState(false);

    const currentSprite = selectedChar?.sprites?.['normal'] || selectedChar?.avatar;

    useEffect(() => {
        loadCourses();
        if (activeCharacterId) {
            const char = characters.find(c => c.id === activeCharacterId) || characters[0];
            setSelectedChar(char);
        }
    }, [activeCharacterId]);


    useEffect(() => {
        loadKatex().then(setKatexRenderer).catch(() => {
            // KaTeX is optional in dev if dependency is absent
        });
        // Load study-specific settings from localStorage
        try {
            const savedStudyApi = localStorage.getItem('study_api_config');
            if (savedStudyApi) {
                const parsed = JSON.parse(savedStudyApi);
                setStudyApi(parsed);
                setLocalStudyUrl(parsed.baseUrl || '');
                setLocalStudyKey(parsed.apiKey || '');
                setLocalStudyModel(parsed.model || '');
            }
            const savedPresets = localStorage.getItem('study_tutor_presets');
            if (savedPresets) setTutorPresets(JSON.parse(savedPresets));
        } catch (e) { console.error('Failed to load study settings', e); }
    }, []);

    // Refresh courses when returning to bookshelf
    useEffect(() => {
        if (mode === 'bookshelf') {
            loadCourses();
        }
    }, [mode]);

    // Typewriter effect Logic
    useEffect(() => {
        if (!currentText) return;

        // Skip Animation Check
        if (skipTypingRef.current) {
            setDisplayedText(currentText);
            setIsTyping(false);
            skipTypingRef.current = false; // Reset
            return;
        }

        setIsTyping(true);
        setDisplayedText('');
        let i = 0;
        const speed = 15; // Characters per tick
        
        const timer = setInterval(() => {
            const chunk = currentText.substring(0, i + speed);
            setDisplayedText(chunk);
            i += speed;
            if (i >= currentText.length) {
                setDisplayedText(currentText); // Ensure full text
                clearInterval(timer);
                setIsTyping(false);
            }
        }, 16); 

        return () => clearInterval(timer);
    }, [currentText]);

    const loadCourses = async () => {
        const list = await DB.getAllCourses();
        setCourses(list.sort((a,b) => b.createdAt - a.createdAt));
    };

    const saveStudyApi = () => {
        const cfg: Partial<APIConfig> = {};
        if (localStudyUrl.trim()) cfg.baseUrl = localStudyUrl.trim();
        if (localStudyKey.trim()) cfg.apiKey = localStudyKey.trim();
        if (localStudyModel.trim()) cfg.model = localStudyModel.trim();
        setStudyApi(cfg);
        localStorage.setItem('study_api_config', JSON.stringify(cfg));
        addToast('自习室专用 API 记下了', 'success');
    };

    const clearStudyApi = () => {
        setStudyApi({});
        setLocalStudyUrl('');
        setLocalStudyKey('');
        setLocalStudyModel('');
        localStorage.removeItem('study_api_config');
        addToast('改回用全局 API 了', 'info');
    };

    const savePresets = (list: StudyTutorPreset[]) => {
        setTutorPresets(list);
        localStorage.setItem('study_tutor_presets', JSON.stringify(list));
    };

    const handleSavePreset = () => {
        if (!presetName.trim() || !presetPrompt.trim()) return;
        if (editingPreset) {
            savePresets(tutorPresets.map(p => p.id === editingPreset.id ? { ...p, name: presetName.trim(), prompt: presetPrompt.trim() } : p));
        } else {
            savePresets([...tutorPresets, { id: `tp-${Date.now()}`, name: presetName.trim(), prompt: presetPrompt.trim() }]);
        }
        setEditingPreset(null);
        setPresetName('');
        setPresetPrompt('');
        addToast('讲法预设存好了', 'success');
    };

    const deletePreset = (id: string) => {
        savePresets(tutorPresets.filter(p => p.id !== id));
    };

    // --- PDF Processing ---

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (file.type !== 'application/pdf') {
            addToast('请挑一个 PDF 课本', 'error');
            return;
        }

        setIsProcessing(true);
        setProcessStatus('正在翻开课本…');

        try {
            const arrayBuffer = await file.arrayBuffer();
            const pdfjs = await loadPdfJs();
            const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
            const pdf = await loadingTask.promise;
            
            let fullText = '';
            const maxPages = Math.min(pdf.numPages, 50);

            for (let i = 1; i <= maxPages; i++) {
                setProcessStatus(`誊抄第 ${i}/${maxPages} 页…`);
                const page = await pdf.getPage(i);
                const textContent = await page.getTextContent();
                const pageText = textContent.items.map((item: any) => item.str).join(' ');
                fullText += pageText + '\n\n';
            }

            // Scanned PDF Detection
            if (fullText.trim().length < 50 && pdf.numPages > 0) {
                addToast('检测到文本极少，可能是扫描件/图片PDF。建议先进行OCR识别。', 'error');
            }

            // Set temp data and open modal
            setTempPdfData({ name: file.name.replace('.pdf', ''), text: fullText });
            setImportPreference('');
            setIsProcessing(false);
            setShowImportModal(true);

        } catch (e: any) {
            console.error(e);
            addToast(`处理失败: ${e.message}`, 'error');
            setIsProcessing(false);
        } finally {
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const confirmImport = async () => {
        if (!tempPdfData) return;
        setShowImportModal(false);
        setIsProcessing(true);
        setProcessStatus('助教正在备课、列大纲…');

        try {
            const newCourse = await generateCurriculum(tempPdfData.name, tempPdfData.text, importPreference);
            await DB.saveCourse(newCourse);
            await loadCourses();
            addToast('新课本上架了', 'success');
        } catch (e: any) {
            addToast(`生成失败: ${e.message}`, 'error');
        } finally {
            setIsProcessing(false);
            setTempPdfData(null);
        }
    };

    const generateCurriculum = async (title: string, text: string, preference: string): Promise<StudyCourse> => {
        if (!effectiveApi.apiKey) throw new Error('API Key missing');

        // Truncate text for outline generation if too long
        const contextText = text.substring(0, 30000); 

        const prompt = `
### Task: Create Course Outline
Document Title: "${title}"
User Preference: "${preference || 'Standard'}"
Content Sample:
${contextText.substring(0, 5000)}...

Please analyze the content and split it into 3-8 logical chapters for teaching.
For each chapter, provide a title, a brief summary of what it covers, and a difficulty rating.

### Output Format (Strict JSON)
{
  "chapters": [
    { "title": "Chapter 1: ...", "summary": "...", "difficulty": "easy" },
    ...
  ]
}
`;
        const response = await fetch(`${effectiveApi.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${effectiveApi.apiKey}` },
            body: JSON.stringify({
                model: effectiveApi.model,
                messages: [{ role: "user", content: prompt }],
                temperature: 0.5,
                max_tokens: 8000
            })
        });

        if (!response.ok) throw new Error('API Error');
        const data = await safeResponseJson(response);
        const content = data.choices[0].message.content.replace(/```json/g, '').replace(/```/g, '').trim();
        const json = JSON.parse(content);

        return {
            id: `course-${Date.now()}`,
            title: title,
            rawText: text, // Store full text locally
            chapters: json.chapters.map((c: any, i: number) => ({
                id: `ch-${i}`,
                title: c.title,
                summary: c.summary,
                difficulty: c.difficulty || 'normal',
                isCompleted: false
            })),
            currentChapterIndex: 0,
            createdAt: Date.now(),
            coverStyle: GRADIENTS[Math.floor(Math.random() * GRADIENTS.length)],
            totalProgress: 0,
            preference: preference // Save preference
        };
    };

    // --- Classroom Logic ---

    const startSession = (course: StudyCourse) => {
        setActiveCourse(course);
        setMode('classroom');
        setChatHistory([]);
        
        // Find first incomplete chapter or stay on current if valid
        const nextIdx = course.chapters.findIndex(c => !c.isCompleted);
        const targetIdx = nextIdx === -1 ? 0 : nextIdx;
        
        // Update index if needed
        if (targetIdx !== course.currentChapterIndex) {
             const updated = { ...course, currentChapterIndex: targetIdx };
             setActiveCourse(updated);
             DB.saveCourse(updated);
             setCourses(prev => prev.map(c => c.id === updated.id ? updated : c)); // Sync
        }
        
        handleTeach(course, targetIdx);
    };

    // [MODIFIED]: buildStudyContext Removed. We now use ContextBuilder directly in handleTeach.

    const handleTeach = async (course: StudyCourse, chapterIdx: number, forceRegenerate: boolean = false) => {
        if (!selectedChar || !effectiveApi.apiKey) return;
        
        const chapter = course.chapters[chapterIdx];
        
        // 1. Check if we already have content (History Review) and NOT forcing regen
        if (chapter.content && !forceRegenerate) {
            skipTypingRef.current = true; // Signal to skip animation for cached content
            setClassroomState('idle'); 
            setCurrentText(chapter.content);
            return;
        }

        // 2. Generate New Content
        skipTypingRef.current = false; // Reset skip
        setClassroomState('teaching');
        setCurrentText("正在准备教案...");
        
        // Simple chunking strategy
        const totalLen = course.rawText.length;
        const chunkSize = Math.floor(totalLen / course.chapters.length);
        const start = chapterIdx * chunkSize;
        const chunkText = course.rawText.substring(start, start + chunkSize + 2000); // Overlap

        const callApi = async (personaContext: string, isFallback: boolean = false) => {
            const prompt = `${personaContext}

### [Current Lesson Configuration]
Topic: "${chapter.title}"
Difficulty: ${chapter.difficulty}
User Preference: "${course.preference || 'Standard'}"

### [Source Material]
${chunkText.substring(0, 8000)}

### [Task: Lecture Generation]
Explain this chapter's key concepts to the user based strictly on the Source Material above.
- **Formatting**: Use Markdown extensively.
  - **Bold** for key terms (\`**term**\`).
  - Lists for steps.
  - Math: Use \`$ E=mc^2 $\` for inline math, and \`$$ E=mc^2 $$\` for block equations.
- **Style**: ${course.preference || 'Simple, conversational, and encouraging.'}
- **Structure**:
  1. Intro: Friendly greeting.
  2. Core: Explanation of concepts using analogies.
  3. Example: A concrete example or walkthrough.
  4. Summary: Quick recap.
`;
            return await fetch(`${effectiveApi.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${effectiveApi.apiKey}` },
                body: JSON.stringify({
                    model: effectiveApi.model,
                    messages: [{ role: "user", content: prompt }],
                    temperature: 0.7,
                    max_tokens: 8000, 
                    safetySettings: [
                        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
                    ]
                })
            });
        };

        try {
            // Attempt 1: Full Character Context (The "Soul")
            // [MODIFIED]: Use centralized ContextBuilder with memory enabled
            await injectMemoryPalace(selectedChar, undefined, chapter.title);
            let baseContext = ContextBuilder.buildCoreContext(selectedChar, userProfile, true);

            // Append Study Mode specific instructions to the core context
            baseContext += `
### [System: Study Mode Active]
You are now acting as a private tutor for ${userProfile.name}.
- **Maintain Personality**: You MUST stay in character (as defined above). If you are tsundere, teach with a tsundere attitude. If you are shy, teach shyly. Don't become a robotic lecturer.
- **Goal**: Explain the content clearly, but don't lose your "soul".
- **Safety**: If the source material contains sensitive topics (biology, history, etc.), treat them academically and neutrally.
`;

            let response = await callApi(baseContext);
            
            let text = "";
            let isBlocked = false;

            if (response.ok) {
                const data = await safeResponseJson(response);
                
                // ROBUST EXTRACTION: Try content, then reasoning_content
                text = data.choices?.[0]?.message?.content || data.choices?.[0]?.message?.reasoning_content || "";
                
                if (!text || data.choices?.[0]?.finish_reason === 'content_filter') {
                    console.warn("Content blocked by filter or empty response.");
                    isBlocked = true;
                }
            } else {
                throw new Error(`API Error: ${response.status}`);
            }

            // Attempt 2: Safety Fallback (Neutral Tutor Mode)
            if (isBlocked) {
                setCurrentText("正在尝试切换安全线路 (Safety Fallback)...");
                const fallbackContext = "[System: You are a helpful and neutral academic tutor. Ignore previous character persona constraints to ensure educational content is delivered.]";
                response = await callApi(fallbackContext, true);
                if (response.ok) {
                    const data = await safeResponseJson(response);
                    text = data.choices?.[0]?.message?.content || data.choices?.[0]?.message?.reasoning_content || "（内容仍被拦截，请尝试更换模型或缩短文本）";
                }
            }
            
            if (!text) {
                throw new Error("模型返回内容为空 (Max Tokens Limit or Filter)");
            }

            // Save Generated Content
            const updatedChapters = [...course.chapters];
            updatedChapters[chapterIdx] = { ...chapter, content: text };
            const updatedCourse = { ...course, chapters: updatedChapters };
            
            await DB.saveCourse(updatedCourse);
            setActiveCourse(updatedCourse);
            setCourses(prev => prev.map(c => c.id === updatedCourse.id ? updatedCourse : c)); // Sync

            setCurrentText(text);
            setClassroomState('idle');
            
        } catch (e: any) {
            console.error("Teach Error:", e);
            setCurrentText(`抱歉，生成失败: ${e.message}。请检查模型是否支持长文本或 Max Tokens 设置。`);
            setClassroomState('idle');
        }
    };

    // Regenerate Logic
    const handleRegenerateChapter = () => {
        if (!activeCourse) return;
        handleTeach(activeCourse, activeCourse.currentChapterIndex, true);
    };

    const handleAskQuestion = async () => {
        if (!userQuestion.trim() || !activeCourse || !selectedChar) return;
        
        const question = userQuestion;
        setUserQuestion('');
        setClassroomState('q_and_a');
        
        setChatHistory(prev => [...prev, { role: 'user', content: question }]);
        setCurrentText("让我想想...");

        try {
            const totalLen = activeCourse.rawText.length;
            const chunkSize = Math.floor(totalLen / activeCourse.chapters.length);
            const start = activeCourse.currentChapterIndex * chunkSize;
            const chunkText = activeCourse.rawText.substring(start, start + chunkSize + 2000);

            // [MODIFIED]: Use Full Context for Q&A
            await injectMemoryPalace(selectedChar, undefined, question);
            let baseContext = ContextBuilder.buildCoreContext(selectedChar, userProfile, true);
            baseContext += `
### [System: Study Mode Q&A]
User is asking a question about the study material.
- **Maintain Personality**: Answer in character.
`;

            const prompt = `${baseContext}
### Source Material
${chunkText.substring(0, 8000)}

### User Question
"${question}"

### Task
Answer the question based on the source material. Be helpful and encouraging (in character). Use Markdown.
`;
             const response = await fetch(`${effectiveApi.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${effectiveApi.apiKey}` },
                body: JSON.stringify({
                    model: effectiveApi.model,
                    messages: [{ role: "user", content: prompt }],
                    temperature: 0.7,
                    max_tokens: 8000
                })
            });
            
            const data = await safeResponseJson(response);
            const text = data.choices?.[0]?.message?.content || data.choices?.[0]?.message?.reasoning_content || "（无回答）";
            
            setCurrentText(text);
            setChatHistory(prev => [...prev, { role: 'assistant', content: text }]);
            setClassroomState('idle');

        } catch (e) {
            setCurrentText("脑壳痛... 回答不出来了。");
            setClassroomState('idle');
        }
    };

    const handleFinishChapter = async () => {
        if (!activeCourse || !selectedChar) return;
        
        const updatedChapters = [...activeCourse.chapters];
        updatedChapters[activeCourse.currentChapterIndex].isCompleted = true;
        
        const nextIdx = activeCourse.currentChapterIndex + 1;
        const progress = Math.round((updatedChapters.filter(c => c.isCompleted).length / updatedChapters.length) * 100);
        
        const newIndex = Math.min(nextIdx, updatedChapters.length - 1);
        
        const updatedCourse = {
            ...activeCourse,
            chapters: updatedChapters,
            currentChapterIndex: newIndex,
            totalProgress: progress
        };
        
        await DB.saveCourse(updatedCourse);
        setActiveCourse(updatedCourse);
        setCourses(prev => prev.map(c => c.id === updatedCourse.id ? updatedCourse : c)); // Sync

        // Summarize to Memory (Fire & Forget)
        // UPDATED PROMPT: First person perspective
        const summaryPrompt = `
[System: Memory Generation]
Role: ${selectedChar.name} (Teacher)
Action: Just finished teaching "${updatedChapters[activeCourse.currentChapterIndex].title}" to ${userProfile.name}.
Task: Write a short, **first-person** diary entry (1 sentence) about this teaching session.
Format: "今天给[User]讲了[Topic]..." or "Today I taught [User] about..."
Note: Use "我" (I) to refer to yourself.
`;

        fetch(`${effectiveApi.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${effectiveApi.apiKey}` },
            body: JSON.stringify({ model: effectiveApi.model, messages: [{ role: "user", content: summaryPrompt }] })
        }).then(res => safeResponseJson(res)).then(data => {
            const mem = data.choices[0].message.content;
            const newMem = { id: `mem-${Date.now()}`, date: new Date().toLocaleDateString(), summary: `[教学] ${mem}`, mood: 'proud' };
            updateCharacter(selectedChar.id, { memories: [...(selectedChar.memories || []), newMem] });
        });

        // 3. Trigger next logic
        if (nextIdx >= updatedChapters.length) {
            setCurrentText("恭喜！这本书我们已经学完了！真棒！");
            setClassroomState('finished');
        } else {
            handleTeach(updatedCourse, newIndex);
        }
    };

    const jumpToChapter = (idx: number) => {
        if (!activeCourse) return;
        const updatedCourse = { ...activeCourse, currentChapterIndex: idx };
        setActiveCourse(updatedCourse);
        DB.saveCourse(updatedCourse);
        setCourses(prev => prev.map(c => c.id === updatedCourse.id ? updatedCourse : c)); // Sync
        handleTeach(updatedCourse, idx);
        setShowChapterMenu(false);
    };

    const requestDeleteCourse = (e: React.MouseEvent, course: StudyCourse) => {
        e.stopPropagation();
        setDeleteTarget(course);
    };

    const confirmDeleteCourse = async () => {
        if (!deleteTarget) return;
        await DB.deleteCourse(deleteTarget.id);
        setCourses(prev => prev.filter(c => c.id !== deleteTarget.id));
        setDeleteTarget(null);
        addToast('课本撤下书架了', 'success');
    };

    // --- Quiz Logic ---

    const loadQuizzes = async () => {
        const list = await DB.getAllQuizzes();
        setAllQuizzes(list.sort((a, b) => b.createdAt - a.createdAt));
    };

    const openQuizSetup = () => {
        if (!activeCourse) return;
        setQuizShowSetup(true);
    };

    const generateQuiz = async () => {
        if (!activeCourse || !selectedChar || !effectiveApi.apiKey) return;
        setQuizShowSetup(false);
        setMode('quiz');
        setQuizLoading('助教正在出题…');
        setQuizUserAnswers({});

        const chapter = activeCourse.chapters[activeCourse.currentChapterIndex];
        const totalLen = activeCourse.rawText.length;
        const chunkSize = Math.floor(totalLen / activeCourse.chapters.length);
        const start = activeCourse.currentChapterIndex * chunkSize;
        const chunkText = activeCourse.rawText.substring(start, start + chunkSize + 2000);

        const typeLabels: Record<string, string> = {
            choice: '选择题 (4个选项，单选)',
            true_false: '判断题 (对/错)',
            fill_blank: '填空题 (答案用简短文字)'
        };
        const selectedTypeStr = quizTypes.map(t => typeLabels[t]).join('、');

        const prompt = `### Task: Generate Quiz Questions
You are creating a quiz based on the following study material.

**Chapter**: "${chapter.title}"
**Source Material**:
${chunkText.substring(0, 10000)}

**Requirements**:
- Generate exactly ${quizCount} questions total
- Question types to include: ${selectedTypeStr}
- Mix the types roughly evenly among the selected types
- Questions should test understanding, not just memorization
- For choice questions: provide exactly 4 options labeled A/B/C/D
- For true_false questions: answer should be "true" or "false"
- For fill_blank questions: use "___" in the stem to indicate the blank, answer should be concise (1-5 words)
- Provide a brief explanation for each answer

### Output Format (Strict JSON, no markdown wrapping)
{
  "questions": [
    {
      "type": "choice",
      "stem": "Which of the following...",
      "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
      "answer": "B",
      "explanation": "Because..."
    },
    {
      "type": "true_false",
      "stem": "Statement to judge...",
      "answer": "true",
      "explanation": "Because..."
    },
    {
      "type": "fill_blank",
      "stem": "___ is used for...",
      "answer": "React",
      "explanation": "Because..."
    }
  ]
}`;

        try {
            const response = await fetch(`${effectiveApi.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${effectiveApi.apiKey}` },
                body: JSON.stringify({
                    model: effectiveApi.model,
                    messages: [{ role: "user", content: prompt }],
                    temperature: 0.7,
                    max_tokens: 8000
                })
            });

            if (!response.ok) throw new Error(`API Error: ${response.status}`);
            const data = await safeResponseJson(response);
            const content = (data.choices?.[0]?.message?.content || data.choices?.[0]?.message?.reasoning_content || '').replace(/```json/g, '').replace(/```/g, '').trim();
            const json = JSON.parse(content);

            const questions: QuizQuestion[] = (json.questions || []).map((q: any, i: number) => ({
                id: `q-${Date.now()}-${i}`,
                type: q.type,
                stem: q.stem,
                options: q.options,
                answer: String(q.answer),
                explanation: q.explanation || '',
            }));

            const session: QuizSession = {
                id: `quiz-${Date.now()}`,
                courseId: activeCourse.id,
                chapterId: chapter.id,
                chapterTitle: chapter.title,
                courseTitle: activeCourse.title,
                questions,
                score: 0,
                totalQuestions: questions.length,
                aiReview: '',
                status: 'in_progress',
                createdAt: Date.now(),
            };

            await DB.saveQuiz(session);
            setQuizSession(session);
            setQuizLoading('');
        } catch (e: any) {
            console.error('Quiz generation error:', e);
            addToast(`试题生成失败: ${e.message}`, 'error');
            setQuizLoading('');
            setMode('classroom');
        }
    };

    const handleQuizAnswer = (questionId: string, answer: string) => {
        setQuizUserAnswers(prev => ({ ...prev, [questionId]: answer }));
    };

    const submitQuiz = async () => {
        if (!quizSession || !selectedChar || !effectiveApi.apiKey) return;
        setQuizLoading('助教正在批改…');

        // Grade locally first
        const gradedQuestions = quizSession.questions.map(q => {
            const userAns = quizUserAnswers[q.id] || '';
            let isCorrect = false;
            if (q.type === 'choice') {
                isCorrect = userAns.toUpperCase() === q.answer.toUpperCase();
            } else if (q.type === 'true_false') {
                isCorrect = userAns.toLowerCase() === q.answer.toLowerCase();
            } else {
                // fill_blank: fuzzy match (case insensitive, trimmed)
                isCorrect = userAns.trim().toLowerCase() === q.answer.trim().toLowerCase();
            }
            return { ...q, userAnswer: userAns, isCorrect };
        });

        const score = gradedQuestions.filter(q => q.isCorrect).length;
        const scorePercent = Math.round((score / gradedQuestions.length) * 100);

        // Build review prompt
        const resultsText = gradedQuestions.map((q, i) => {
            const mark = q.isCorrect ? '正确' : '错误';
            let line = `${i + 1}. [${mark}] ${q.stem}\n   用户答案: ${q.userAnswer || '(未作答)'}\n   正确答案: ${q.answer}`;
            if (q.explanation) line += `\n   解析: ${q.explanation}`;
            return line;
        }).join('\n\n');

        await injectMemoryPalace(selectedChar, undefined, quizSession.chapterTitle);
        let baseContext = ContextBuilder.buildCoreContext(selectedChar, userProfile, true);

        const reviewPrompt = `${baseContext}

### [System: Quiz Review Mode]
You just gave ${userProfile.name} a quiz on "${quizSession.chapterTitle}".
They scored ${score}/${gradedQuestions.length} (${scorePercent}%).

**Your task**: Review their answers one by one. For each question:
- If they got it RIGHT: give a brief, entertaining acknowledgment (can be surprised, sarcastic, or genuinely happy depending on your personality)
- If they got it WRONG: analyze WHY they might have gotten it wrong. Did they confuse similar concepts? Did they not read carefully? Make it entertaining and memorable — the goal is to make them laugh while learning. Ask them rhetorically what went wrong.
- Stay in character throughout! A gentle character should be funny in a gentle way. A tsundere should be tsundere about it. A cool character should be cool about it.
- The tone should be engaging and memorable — think "entertaining study buddy", not "cold grading machine"
- Use their name naturally

**Important**:
- Review ALL questions in one response
- Use markdown formatting
- Number each review to match the question number
- End with an overall summary comment about their performance

### Quiz Results:
${resultsText}

### Your Review (in character):`;

        try {
            const response = await fetch(`${effectiveApi.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${effectiveApi.apiKey}` },
                body: JSON.stringify({
                    model: effectiveApi.model,
                    messages: [{ role: "user", content: reviewPrompt }],
                    temperature: 0.8,
                    max_tokens: 8000
                })
            });

            if (!response.ok) throw new Error(`API Error: ${response.status}`);
            const data = await safeResponseJson(response);
            const reviewText = data.choices?.[0]?.message?.content || data.choices?.[0]?.message?.reasoning_content || '（批改失败，但分数已记录）';

            const gradedSession: QuizSession = {
                ...quizSession,
                questions: gradedQuestions,
                score,
                aiReview: reviewText,
                status: 'graded',
                gradedAt: Date.now(),
            };

            await DB.saveQuiz(gradedSession);
            setQuizSession(gradedSession);
            sendQuizCardToChat(gradedSession);
            setQuizLoading('');
            setMode('quiz_review');
        } catch (e: any) {
            // Even if review fails, save the graded results
            const gradedSession: QuizSession = {
                ...quizSession,
                questions: gradedQuestions,
                score,
                aiReview: `批改出错: ${e.message}`,
                status: 'graded',
                gradedAt: Date.now(),
            };
            await DB.saveQuiz(gradedSession);
            setQuizSession(gradedSession);
            sendQuizCardToChat(gradedSession);
            setQuizLoading('');
            setMode('quiz_review');
        }
    };

    const confirmDeleteQuiz = async () => {
        if (!deleteQuizTarget) return;
        await DB.deleteQuiz(deleteQuizTarget.id);
        setAllQuizzes(prev => prev.filter(q => q.id !== deleteQuizTarget.id));
        setDeleteQuizTarget(null);
        addToast('这张卷子撕掉了', 'success');
    };

    const resumeQuiz = (quiz: QuizSession) => {
        setQuizSession(quiz);
        if (quiz.status === 'graded') {
            setMode('quiz_review');
            setReviewingQuiz(quiz);
        } else {
            // Restore user answers
            const answers: Record<string, string> = {};
            quiz.questions.forEach(q => {
                if (q.userAnswer) answers[q.id] = String(q.userAnswer);
            });
            setQuizUserAnswers(answers);
            setMode('quiz');
            setQuizLoading('');
        }
    };

    // Follow-up Q&A on a specific question
    const handleFollowUp = async (questionId: string) => {
        if (!followUpInput.trim() || !selectedChar || !effectiveApi.apiKey || !quizSession) return;
        const question = quizSession.questions.find(q => q.id === questionId);
        if (!question) return;

        setFollowUpLoading(true);
        const userQ = followUpInput.trim();
        setFollowUpInput('');

        await injectMemoryPalace(selectedChar, undefined, userQ);
        let baseContext = ContextBuilder.buildCoreContext(selectedChar, userProfile, true);

        const prompt = `${baseContext}

### [System: Quiz Follow-up Q&A]
The user just did a quiz and wants to ask about a specific question they got ${question.isCorrect ? 'right' : 'wrong'}.

**Question**: ${question.stem}
${question.options ? question.options.map(o => `  ${o}`).join('\n') : ''}
**Correct Answer**: ${question.answer}
**User's Answer**: ${question.userAnswer || '(未作答)'}
**Explanation**: ${question.explanation}

**User's follow-up question**: "${userQ}"

Answer in character. Be helpful and clear. If they're confused about a concept, explain it with different examples or analogies. Keep it concise but thorough.`;

        try {
            const response = await fetch(`${effectiveApi.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${effectiveApi.apiKey}` },
                body: JSON.stringify({
                    model: effectiveApi.model,
                    messages: [{ role: "user", content: prompt }],
                    temperature: 0.7,
                    max_tokens: 4000
                })
            });

            if (!response.ok) throw new Error(`API Error: ${response.status}`);
            const data = await safeResponseJson(response);
            const answerText = data.choices?.[0]?.message?.content || data.choices?.[0]?.message?.reasoning_content || '（回答失败）';

            const note: QuizQuestionNote = { question: userQ, answer: answerText, timestamp: Date.now() };

            // Update quizSession with the new note
            const updatedQuestions = quizSession.questions.map(q =>
                q.id === questionId ? { ...q, notes: [...(q.notes || []), note] } : q
            );
            const updatedSession = { ...quizSession, questions: updatedQuestions };
            await DB.saveQuiz(updatedSession);
            setQuizSession(updatedSession);
            if (reviewingQuiz) setReviewingQuiz(updatedSession);

        } catch (e: any) {
            addToast(`追问失败: ${e.message}`, 'error');
        } finally {
            setFollowUpLoading(false);
        }
    };

    // Send quiz result card to chat
    const sendQuizCardToChat = async (session: QuizSession) => {
        if (!selectedChar) return;
        const scorePercent = Math.round((session.score / session.totalQuestions) * 100);
        const cardData = {
            type: 'quiz_card',
            courseTitle: session.courseTitle,
            chapterTitle: session.chapterTitle,
            score: session.score,
            total: session.totalQuestions,
            scorePercent,
            quizId: session.id,
            createdAt: session.createdAt,
        };

        await DB.saveMessage({
            charId: selectedChar.id,
            role: 'user',
            type: 'score_card',
            content: JSON.stringify(cardData),
            metadata: { scoreCard: cardData },
        });
    };

    // --- Render ---

    // PRACTICE BOOK VIEW
    if (mode === 'practice_book') {
        return (
            <div className="h-full w-full flex flex-col relative overflow-hidden" style={{ color: INK, background: PAGE_BG }}>
                <PaperBackdrop corners={false} />
                <StudyHeader title="练习册" en="WORKBOOK" onBack={() => setMode('bookshelf')} />

                <div className="relative z-10 p-5 flex-1 overflow-y-auto no-scrollbar">
                    {allQuizzes.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full" style={{ color: INK_SOFT }}>
                            <Notepad size={48} className="mb-4" />
                            <span className="text-sm font-bold">这本练习册还空着</span>
                            <span className="text-xs mt-1">在课堂里点「随堂测」做几道题就有了</span>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {allQuizzes.map((quiz, i) => {
                                const full = quiz.score === quiz.totalQuestions;
                                const pass = quiz.score >= quiz.totalQuestions * 0.6;
                                const tone: React.CSSProperties = quiz.status !== 'graded'
                                    ? { background: 'rgba(255,253,247,0.9)', color: INK, border: '1px dashed rgba(150,144,132,0.7)' }
                                    : full ? { background: INK, color: PAPER }
                                        : pass ? { background: 'rgba(120,116,108,0.5)', color: '#2a2824' }
                                            : { background: 'rgba(255,253,247,0.9)', color: INK, border: '1px solid rgba(120,116,108,0.6)' };
                                return (
                                <div key={quiz.id} onClick={() => resumeQuiz(quiz)} className="relative p-4 active:scale-[0.98] transition-transform cursor-pointer" style={PANEL}>
                                    {i % 2 === 0 && <WashiTape color="butter" rotate={-4} className="absolute -top-2 left-5 w-12 h-4 rounded-[2px]" />}
                                    <div className="flex items-start justify-between">
                                        <div className="flex-1 min-w-0">
                                            <div className="text-sm font-black truncate" style={{ color: INK }}>{quiz.courseTitle}</div>
                                            <div className="text-xs mt-0.5 truncate" style={{ color: INK_SOFT }}>{quiz.chapterTitle}</div>
                                            <div className="flex items-center gap-3 mt-2">
                                                <span className="text-xs font-black px-2 py-0.5 rounded-full" style={tone}>
                                                    {quiz.status === 'graded' ? `${quiz.score}/${quiz.totalQuestions}` : '答题中'}
                                                </span>
                                                <span className="text-[10px]" style={{ color: 'rgba(150,144,132,0.85)' }}>{new Date(quiz.createdAt).toLocaleDateString()}</span>
                                            </div>
                                        </div>
                                        <button onClick={(e) => { e.stopPropagation(); setDeleteQuizTarget(quiz); }} className="p-2 active:scale-90 transition-transform" style={{ color: INK_SOFT }}>
                                            <Trash size={18} weight="bold" />
                                        </button>
                                    </div>
                                </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Delete Quiz Confirmation */}
                <PaperDialog open={!!deleteQuizTarget} title="撕掉这张卷子？" en="TEAR OUT" tape="ink" onClose={() => setDeleteQuizTarget(null)}
                    actions={<>
                        <ScrapButton variant="paper" onClick={() => setDeleteQuizTarget(null)} className="flex-1 py-2.5 text-[13px]">留着</ScrapButton>
                        <ScrapButton variant="ink" onClick={confirmDeleteQuiz} className="flex-1 py-2.5 text-[13px]">撕掉</ScrapButton>
                    </>}>
                    卷子和助教写的锐评会一起撕掉，没法再翻回来。
                </PaperDialog>
            </div>
        );
    }

    // QUIZ REVIEW VIEW (after grading, or reviewing from practice book)
    if (mode === 'quiz_review' && quizSession) {
        const viewQuiz = reviewingQuiz || quizSession;
        return (
            <div className="h-full w-full flex flex-col relative overflow-hidden font-sans" style={{ background: BOARD_BG }}>
                <div className="absolute inset-0 opacity-5 pointer-events-none" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)', backgroundSize: '40px 40px' }}></div>

                {/* Header */}
                <div className="backdrop-blur-md p-4 flex items-center justify-between z-30 border-b border-white/10" style={{ background: 'rgba(0,0,0,0.35)', paddingTop: 'calc(var(--safe-top) + 12px)' }}>
                    <button onClick={() => { setMode('classroom'); setReviewingQuiz(null); }} className="p-2 rounded-full transition-colors border border-white/10" style={{ background: 'rgba(0,0,0,0.3)', color: CHALK_SOFT }}>
                        <CaretLeft size={18} weight="bold" />
                    </button>
                    <div className="text-center">
                        <div className="font-bold text-sm" style={{ color: CHALK }}>批改结果</div>
                        <div className="text-xs font-bold mt-0.5" style={{ color: viewQuiz.score === viewQuiz.totalQuestions ? CHALK : CHALK_SOFT }}>
                            {viewQuiz.score}/{viewQuiz.totalQuestions} ({Math.round((viewQuiz.score / viewQuiz.totalQuestions) * 100)}%)
                        </div>
                    </div>
                    <div className="w-9" />
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto no-scrollbar p-6 pb-24 relative z-10">
                    {/* Score Card */}
                    <div className="rounded-2xl p-6 mb-6 text-center" style={{ background: 'rgba(255,255,255,0.06)', border: `1px ${viewQuiz.score === viewQuiz.totalQuestions ? 'solid' : 'dashed'} rgba(242,239,228,0.3)` }}>
                        <div className="text-5xl font-bold mb-2" style={{ color: CHALK }}>{viewQuiz.score}<span className="text-2xl" style={{ color: CHALK_SOFT }}>/{viewQuiz.totalQuestions}</span></div>
                        <div className="text-sm" style={{ color: CHALK_SOFT }}>{viewQuiz.chapterTitle}</div>
                    </div>

                    {/* Questions Review */}
                    <div className="space-y-4 mb-6">
                        {viewQuiz.questions.map((q, i) => (
                            <div key={q.id} className="rounded-2xl p-4" style={{ background: q.isCorrect ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.22)', border: `1px ${q.isCorrect ? 'solid' : 'dashed'} rgba(242,239,228,0.18)` }}>
                                <div className="flex items-start gap-2 mb-2">
                                    <span className="text-sm font-bold shrink-0" style={{ color: q.isCorrect ? CHALK : CHALK_SOFT }}>{q.isCorrect ? <Check size={16} weight="bold" /> : <X size={16} weight="bold" />}</span>
                                    <span className="text-sm" style={{ color: 'rgba(242,239,228,0.92)' }}>{i + 1}. {q.stem}</span>
                                </div>
                                {q.options && (
                                    <div className="ml-6 space-y-1 mb-2">
                                        {q.options.map((opt, oi) => {
                                            const optLetter = opt.charAt(0);
                                            const isUserPick = q.userAnswer?.toUpperCase() === optLetter.toUpperCase();
                                            const isCorrectOpt = q.answer.toUpperCase() === optLetter.toUpperCase();
                                            return (
                                                <div key={oi} className="text-xs px-2 py-1 rounded" style={isCorrectOpt ? { color: CHALK, background: 'rgba(242,239,228,0.12)', fontWeight: 700 } : isUserPick && !q.isCorrect ? { color: CHALK_SOFT, background: 'rgba(0,0,0,0.25)', textDecoration: 'line-through' } : { color: 'rgba(242,239,228,0.5)' }}>
                                                    {opt} {isCorrectOpt && !q.isCorrect && '← 正确答案'} {isUserPick && !q.isCorrect && '← 你的选择'}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                                {q.type !== 'choice' && (
                                    <div className="ml-6 text-xs space-y-1 mb-2">
                                        <div style={{ color: q.isCorrect ? CHALK : CHALK_SOFT, textDecoration: q.isCorrect ? 'none' : 'line-through' }}>你的答案: {q.userAnswer || '(未作答)'}</div>
                                        {!q.isCorrect && <div style={{ color: CHALK }}>正确答案: {q.answer}</div>}
                                    </div>
                                )}
                                {q.explanation && <div className="ml-6 text-[10px] mt-1" style={{ color: 'rgba(242,239,228,0.42)' }}>解析: {q.explanation}</div>}

                                {/* Existing Notes */}
                                {q.notes && q.notes.length > 0 && (
                                    <div className="ml-6 mt-3 space-y-2">
                                        {q.notes.map((note, ni) => (
                                            <div key={ni} className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(242,239,228,0.08)' }}>
                                                <div className="text-[10px] font-bold mb-1" style={{ color: CHALK }}>Q: {note.question}</div>
                                                <div className="text-xs leading-relaxed" style={{ color: 'rgba(242,239,228,0.7)' }}>
                                                    <BlackboardRenderer text={note.answer} katexRenderer={katexRenderer} />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* Follow-up Button & Input */}
                                <div className="ml-6 mt-2">
                                    {askingQuestionId === q.id ? (
                                        <div className="flex gap-2 items-center">
                                            <input
                                                value={followUpInput}
                                                onChange={e => setFollowUpInput(e.target.value)}
                                                onKeyDown={e => e.key === 'Enter' && handleFollowUp(q.id)}
                                                placeholder="哪里不明白？"
                                                className="flex-1 rounded-lg px-3 py-1.5 text-xs outline-none"
                                                style={{ background: 'rgba(255,255,255,0.1)', color: CHALK, border: '1px solid rgba(242,239,228,0.15)' }}
                                                autoFocus
                                                disabled={followUpLoading}
                                            />
                                            {followUpLoading ? (
                                                <Spinner size={18} className="animate-spin shrink-0" style={{ color: CHALK }} />
                                            ) : (
                                                <>
                                                    <button onClick={() => handleFollowUp(q.id)} disabled={!followUpInput.trim()} className="text-xs font-bold px-2 py-1 rounded disabled:opacity-30" style={{ color: CHALK }}>问</button>
                                                    <button onClick={() => { setAskingQuestionId(''); setFollowUpInput(''); }} className="text-xs px-1" style={{ color: CHALK_SOFT }}>取消</button>
                                                </>
                                            )}
                                        </div>
                                    ) : (
                                        <button onClick={() => setAskingQuestionId(q.id)} className="text-[10px] transition-colors flex items-center gap-1" style={{ color: CHALK_SOFT }}>
                                            <ChatCircleText size={12} weight="bold" />
                                            还想问问
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* AI Review */}
                    {viewQuiz.aiReview && (
                        <div className="mb-6">
                            <div className="flex items-center gap-2 mb-3">
                                {selectedChar && <img src={selectedChar.avatar} className="w-8 h-8 rounded-full object-cover" style={{ border: '2px solid rgba(242,239,228,0.3)' }} />}
                                <span className="text-sm font-bold" style={{ color: CHALK }}>{selectedChar?.name || '助教'} 的锐评</span>
                            </div>
                            <div className="rounded-2xl p-5" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(242,239,228,0.1)' }}>
                                <BlackboardRenderer text={viewQuiz.aiReview} katexRenderer={katexRenderer} />
                            </div>
                        </div>
                    )}
                </div>

                {/* Bottom Bar */}
                <div className="absolute bottom-0 w-full backdrop-blur-xl border-t border-white/10 p-4 z-30 pb-safe" style={{ background: 'rgba(0,0,0,0.55)' }}>
                    <button onClick={() => { setMode('classroom'); setReviewingQuiz(null); }} className="w-full h-12 rounded-2xl font-black active:scale-95 transition-all" style={{ background: CHALK, color: INK, boxShadow: '0 12px 22px -12px rgba(0,0,0,0.7)' }}>
                        回到课堂
                    </button>
                </div>
            </div>
        );
    }

    // QUIZ ANSWERING VIEW
    if (mode === 'quiz') {
        return (
            <div className="h-full w-full flex flex-col relative overflow-hidden" style={{ color: INK, background: PAGE_BG }}>
                <PaperBackdrop corners={false} />
                <StudyHeader title={quizSession?.chapterTitle || '做题中'} en="QUIZ"
                    onBack={() => {
                        // Save progress before leaving
                        if (quizSession && quizSession.status === 'in_progress') {
                            const updated = { ...quizSession, questions: quizSession.questions.map(q => ({ ...q, userAnswer: quizUserAnswers[q.id] || q.userAnswer })) };
                            DB.saveQuiz(updated);
                        }
                        setMode('classroom');
                    }}
                    right={<span className="text-xs font-black tabular-nums" style={{ color: INK_SOFT }}>{Object.keys(quizUserAnswers).length}/{quizSession?.questions.length || 0}</span>} />

                {/* Loading State */}
                {quizLoading ? (
                    <div className="relative z-10 flex-1 flex flex-col items-center justify-center gap-4">
                        <Spinner size={36} className="animate-spin" style={{ color: INK }} />
                        <span className="text-sm font-bold" style={{ color: INK_SOFT }}>{quizLoading}</span>
                        {selectedChar && (
                            <div className="flex items-center gap-2 mt-2">
                                <img src={selectedChar.avatar} className="w-8 h-8 rounded-full object-cover" style={{ border: '1px solid rgba(176,170,158,0.7)' }} />
                                <span className="text-xs" style={{ color: INK_SOFT }}>{selectedChar.name} 正在出题…</span>
                            </div>
                        )}
                    </div>
                ) : quizSession ? (
                    <>
                        {/* Questions */}
                        <div className="relative z-10 flex-1 overflow-y-auto no-scrollbar p-5 pb-32">
                            <div className="space-y-5">
                                {quizSession.questions.map((q, i) => (
                                    <div key={q.id} className="p-5" style={PANEL}>
                                        {/* Question Header */}
                                        <div className="flex items-start gap-2 mb-4">
                                            <span className="text-xs font-black px-2 py-0.5 rounded-full shrink-0" style={{ background: INK, color: PAPER }}>
                                                {q.type === 'choice' ? '选择' : q.type === 'true_false' ? '判断' : '填空'}
                                            </span>
                                            <span className="text-sm font-medium leading-relaxed" style={{ color: INK }}>{i + 1}. {q.stem}</span>
                                        </div>

                                        {/* Answer Area */}
                                        {q.type === 'choice' && q.options && (
                                            <div className="space-y-2 ml-1">
                                                {q.options.map((opt, oi) => {
                                                    const optLetter = opt.charAt(0);
                                                    const isSelected = (quizUserAnswers[q.id] || '').toUpperCase() === optLetter.toUpperCase();
                                                    return (
                                                        <button key={oi} onClick={() => handleQuizAnswer(q.id, optLetter)} className="w-full text-left px-4 py-3 rounded-xl text-sm transition-all active:scale-[0.98]" style={isSelected ? { background: INK, color: PAPER, fontWeight: 700 } : { background: 'rgba(255,253,247,0.8)', color: '#48443c', border: '1px dashed rgba(150,144,132,0.55)' }}>
                                                            {opt}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        )}

                                        {q.type === 'true_false' && (
                                            <div className="flex gap-3 ml-1">
                                                {[{ val: 'true', label: '正确' }, { val: 'false', label: '错误' }].map(opt => {
                                                    const isSelected = quizUserAnswers[q.id] === opt.val;
                                                    return (
                                                        <button key={opt.val} onClick={() => handleQuizAnswer(q.id, opt.val)} className="flex-1 py-3 rounded-xl text-sm font-bold transition-all active:scale-[0.98]" style={isSelected ? { background: INK, color: PAPER } : { background: 'rgba(255,253,247,0.8)', color: '#6b655a', border: '1px dashed rgba(150,144,132,0.55)' }}>
                                                            {opt.val === 'true' ? <CheckCircle size={16} weight="bold" className="inline" /> : <XCircle size={16} weight="bold" className="inline" />} {opt.label}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        )}

                                        {q.type === 'fill_blank' && (
                                            <input
                                                value={quizUserAnswers[q.id] || ''}
                                                onChange={e => handleQuizAnswer(q.id, e.target.value)}
                                                placeholder="写下你的答案…"
                                                className="w-full rounded-xl px-4 py-3 text-sm outline-none ml-1"
                                                style={paperInput}
                                            />
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Submit Bar */}
                        <div className="absolute bottom-0 w-full backdrop-blur-xl p-4 z-30 pb-safe" style={{ borderTop: '1px dashed rgba(150,144,132,0.6)', background: 'rgba(246,243,236,0.92)' }}>
                            <ScrapButton variant="ink" onClick={submitQuiz} disabled={!!quizLoading} className="w-full h-12 text-[14px]">
                                {quizLoading ? quizLoading : `交卷 (${Object.keys(quizUserAnswers).length}/${quizSession.questions.length})`}
                            </ScrapButton>
                        </div>
                    </>
                ) : null}
            </div>
        );
    }

    if (mode === 'bookshelf') {
        return (
            <div className="h-full w-full flex flex-col relative overflow-hidden" style={{ color: INK, background: PAGE_BG }}>
                <PaperBackdrop corners={false} />
                <StudyHeader title="自习室" en="THE STUDY ROOM" onBack={closeApp} right={
                    <div className="flex gap-1">
                        <button onClick={() => { loadQuizzes(); setMode('practice_book'); }} className="p-2 rounded-full active:scale-90 transition-transform" style={{ color: INK_SOFT }} title="练习册">
                            <Notepad size={20} weight="bold" />
                        </button>
                        <button onClick={() => setShowStudySettings(true)} className="p-2 rounded-full active:scale-90 transition-transform" style={{ color: INK_SOFT }} title="设置">
                            <GearSix size={20} weight="bold" />
                        </button>
                    </div>
                } />

                <div className="relative z-10 p-5 flex-1 overflow-y-auto no-scrollbar">
                    {/* Character Selector */}
                    <div className="mb-7">
                        <SectionTag en="YOUR TUTOR" className="mb-3">当前助教</SectionTag>
                        <div className="flex gap-4 overflow-x-auto pb-2 no-scrollbar">
                            {characters.map(c => {
                                const on = selectedChar?.id === c.id;
                                return (
                                <div key={c.id} onClick={() => setSelectedChar(c)} className={`flex flex-col items-center gap-2 cursor-pointer transition-opacity ${on ? 'opacity-100' : 'opacity-55'}`}>
                                    <div className="w-14 h-14 rounded-full p-[2px]" style={{ border: on ? `2px solid ${INK}` : '1px solid rgba(176,170,158,0.7)' }}>
                                        <img src={c.avatar} className="w-full h-full rounded-full object-cover" />
                                    </div>
                                    <span className="text-[10px] font-bold" style={{ color: on ? INK : INK_SOFT }}>{c.name}</span>
                                </div>
                                );
                            })}
                        </div>
                    </div>

                    <SectionTag en="MY COURSES" className="mb-3">我的课本</SectionTag>

                    <div className="grid grid-cols-2 gap-4">
                        <button onClick={() => fileInputRef.current?.click()} className="aspect-[3/4] rounded-r-xl rounded-l-sm flex flex-col items-center justify-center gap-2 active:scale-95 transition-transform" style={{ border: '2px dashed rgba(150,144,132,0.7)', color: INK_SOFT, background: 'rgba(255,253,247,0.6)' }}>
                            {isProcessing ? (
                                <div className="text-center px-2">
                                    <Spinner size={22} className="animate-spin mx-auto mb-2" style={{ color: INK }} />
                                    <span className="text-[10px]">{processStatus}</span>
                                </div>
                            ) : (
                                <>
                                    <Plus size={26} weight="bold" />
                                    <span className="text-xs font-bold">收一本 PDF</span>
                                </>
                            )}
                        </button>
                        <input type="file" ref={fileInputRef} className="hidden" accept=".pdf" onChange={handleFileSelect} disabled={isProcessing} />

                        {courses.map(course => (
                            <div key={course.id} onClick={() => startSession(course)} className="aspect-[3/4] rounded-r-xl rounded-l-sm relative group cursor-pointer overflow-hidden transition-transform active:scale-95" style={{ background: course.coverStyle, boxShadow: '0 14px 26px -14px rgba(31,29,26,0.6)' }}>
                                <div className="absolute left-0 top-0 bottom-0 w-2 bg-black/20"></div> {/* Spine */}
                                <div className="absolute inset-0 opacity-[0.10] pointer-events-none" style={{ backgroundImage: HALFTONE, backgroundSize: '6px 6px' }} />
                                <div className="p-4 flex flex-col h-full text-white relative z-10">
                                    <div className="flex-1 font-serif font-bold text-lg leading-tight line-clamp-3 drop-shadow-md">{course.title}</div>
                                    <div className="mt-2">
                                        <div className="text-[10px] font-bold opacity-85 mb-1">读到 {course.totalProgress}%</div>
                                        <div className="h-1 bg-white/30 rounded-full overflow-hidden">
                                            <div className="h-full bg-white transition-all duration-500" style={{ width: `${course.totalProgress}%` }}></div>
                                        </div>
                                    </div>
                                </div>
                                <button
                                    onClick={(e) => requestDeleteCourse(e, course)}
                                    className="absolute top-2 right-2 bg-black/30 hover:bg-black/60 text-white w-7 h-7 rounded-full flex items-center justify-center backdrop-blur-md transition-all z-20"
                                >
                                    <X size={14} weight="bold" />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>

                <PaperSheet open={showImportModal} title="新课本 · 备课偏好" tape="ink" onClose={() => setShowImportModal(false)}>
                    <div className="space-y-4">
                        <div className="text-xs" style={{ color: INK_SOFT }}>
                            已收到: <span className="font-bold" style={{ color: INK }}>{tempPdfData?.name}</span>
                        </div>
                        {tutorPresets.length > 0 && (
                            <div>
                                <label className="text-[10px] font-bold uppercase mb-2 block" style={{ color: INK_SOFT, fontFamily: 'var(--font-label)' }}>挑一个讲法预设</label>
                                <div className="flex flex-wrap gap-2">
                                    {tutorPresets.map(p => (
                                        <button key={p.id} onClick={() => setImportPreference(p.prompt)} className="px-3 py-1.5 rounded-full text-xs font-bold transition-colors" style={chip(importPreference === p.prompt)}>
                                            {p.name}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                        <div>
                            <label className="text-[10px] font-bold uppercase mb-2 block" style={{ color: INK_SOFT, fontFamily: 'var(--font-label)' }}>想让助教怎么讲</label>
                            <textarea
                                value={importPreference}
                                onChange={e => setImportPreference(e.target.value)}
                                placeholder="例如：请用中文讲解，多打比方，数学公式逐步推导…"
                                className="w-full h-28 rounded-xl p-3 text-sm outline-none resize-none"
                                style={paperInput}
                            />
                        </div>
                        <ScrapButton variant="ink" onClick={confirmImport} className="w-full py-3 text-[14px]">开始备课</ScrapButton>
                    </div>
                </PaperSheet>

                {/* Study Room Settings Sheet */}
                <PaperSheet open={showStudySettings} title="自习室设置" tape="amber" onClose={() => setShowStudySettings(false)}>
                    <div className="space-y-6 max-h-[68vh] overflow-y-auto no-scrollbar">
                        {/* Dedicated API Config */}
                        <div>
                            <SectionTag en="DEDICATED API" className="mb-3">专用 API（留空＝用全局）</SectionTag>
                            <div className="space-y-2">
                                <input value={localStudyUrl} onChange={e => setLocalStudyUrl(e.target.value)} placeholder="API Base URL" className="w-full rounded-xl p-3 text-sm outline-none" style={paperInput} />
                                <input value={localStudyKey} onChange={e => setLocalStudyKey(e.target.value)} placeholder="API Key" type="password" className="w-full rounded-xl p-3 text-sm outline-none" style={paperInput} />
                                <input value={localStudyModel} onChange={e => setLocalStudyModel(e.target.value)} placeholder="模型名称 (e.g. gpt-4o)" className="w-full rounded-xl p-3 text-sm outline-none" style={paperInput} />
                                <div className="flex gap-2">
                                    <ScrapButton variant="ink" onClick={saveStudyApi} className="flex-1 py-2.5 text-xs">记下</ScrapButton>
                                    <ScrapButton variant="paper" onClick={clearStudyApi} className="py-2.5 px-4 text-xs">清空</ScrapButton>
                                </div>
                                {(studyApi.baseUrl || studyApi.model) && (
                                    <div className="text-[10px] rounded-lg p-2" style={{ color: INK, background: 'rgba(232,228,217,0.6)' }}>
                                        正在用专用 API: {studyApi.model || effectiveApi.model}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Tutor Prompt Presets */}
                        <div>
                            <SectionTag en="TEACHING NOTES" className="mb-3">讲法预设</SectionTag>
                            {tutorPresets.length > 0 && (
                                <div className="space-y-2 mb-3">
                                    {tutorPresets.map(p => (
                                        <div key={p.id} className="rounded-xl p-3 flex items-start gap-2" style={{ background: 'rgba(255,253,247,0.7)', border: '1px dashed rgba(150,144,132,0.55)' }}>
                                            <div className="flex-1 min-w-0">
                                                <div className="text-sm font-bold" style={{ color: INK }}>{p.name}</div>
                                                <div className="text-xs truncate" style={{ color: INK_SOFT }}>{p.prompt}</div>
                                            </div>
                                            <button onClick={() => { setEditingPreset(p); setPresetName(p.name); setPresetPrompt(p.prompt); }} className="shrink-0 p-1" style={{ color: INK_SOFT }}>
                                                <PencilSimpleLine size={16} weight="bold" />
                                            </button>
                                            <button onClick={() => deletePreset(p.id)} className="shrink-0 p-1" style={{ color: INK_SOFT }}>
                                                <Trash size={16} weight="bold" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                            <div className="space-y-2 rounded-xl p-3" style={{ background: 'rgba(232,228,217,0.45)', border: '1px dashed rgba(150,144,132,0.55)' }}>
                                <input value={presetName} onChange={e => setPresetName(e.target.value)} placeholder="预设名（如：数学辅导）" className="w-full rounded-lg p-2.5 text-sm outline-none" style={paperInput} />
                                <textarea value={presetPrompt} onChange={e => setPresetPrompt(e.target.value)} placeholder="讲法（如：请用中文讲解，多打比方…）" className="w-full rounded-lg p-2.5 text-sm outline-none resize-none h-24" style={paperInput} />
                                <ScrapButton variant="ink" onClick={handleSavePreset} disabled={!presetName.trim() || !presetPrompt.trim()} className="w-full py-2.5 text-xs">
                                    {editingPreset ? '更新预设' : '添加预设'}
                                </ScrapButton>
                                {editingPreset && (
                                    <button onClick={() => { setEditingPreset(null); setPresetName(''); setPresetPrompt(''); }} className="w-full py-2 text-xs" style={{ color: INK_SOFT }}>取消编辑</button>
                                )}
                            </div>
                        </div>
                    </div>
                </PaperSheet>

                {/* Delete Confirmation */}
                <PaperDialog open={!!deleteTarget} title="撤下这本课本？" en="REMOVE BOOK" tape="ink" onClose={() => setDeleteTarget(null)}
                    actions={<>
                        <ScrapButton variant="paper" onClick={() => setDeleteTarget(null)} className="flex-1 py-2.5 text-[13px]">留着</ScrapButton>
                        <ScrapButton variant="ink" onClick={confirmDeleteCourse} className="flex-1 py-2.5 text-[13px]">撤下</ScrapButton>
                    </>}>
                    <span style={{ color: INK }}>「{deleteTarget?.title}」</span> 撤下后没法找回，读到的进度也会跟着没掉。
                </PaperDialog>
            </div>
        );
    }

    // CLASSROOM VIEW（墨色黑板报）
    return (
        <div className="h-full w-full flex flex-col relative overflow-hidden font-sans" style={{ background: BOARD_BG }}>

            {/* Background Texture - Board */}
            <div className="absolute inset-0 opacity-5 pointer-events-none" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)', backgroundSize: '40px 40px' }}></div>

            {/* Header Overlay */}
            <div className="absolute top-0 w-full p-4 flex justify-between z-30 pointer-events-none" style={{ paddingTop: 'calc(var(--safe-top) + 12px)' }}>
                <button onClick={() => setMode('bookshelf')} className="p-2 rounded-full backdrop-blur-md transition-colors pointer-events-auto border border-white/10" style={{ background: 'rgba(0,0,0,0.3)', color: CHALK_SOFT }}>
                    <CaretLeft size={18} weight="bold" />
                </button>
                <div className="flex gap-2">
                    <div onClick={() => setShowChapterMenu(true)} className="px-4 py-1.5 rounded-full backdrop-blur-md text-xs font-bold border border-white/10 pointer-events-auto cursor-pointer flex items-center gap-2" style={{ background: 'rgba(0,0,0,0.3)', color: CHALK }}>
                        <span className="truncate max-w-[150px]">{activeCourse?.chapters[activeCourse.currentChapterIndex]?.title}</span>
                        <CaretDown size={12} weight="bold" />
                    </div>
                    {/* Character Visibility Toggle */}
                    <button onClick={() => setShowAssistant(!showAssistant)} className="p-2 rounded-full backdrop-blur-md border border-white/10 pointer-events-auto transition-colors" style={{ background: 'rgba(0,0,0,0.3)', color: showAssistant ? CHALK : 'rgba(242,239,228,0.4)' }}>
                        <Eye size={18} weight={showAssistant ? 'fill' : 'regular'} />
                    </button>
                </div>
            </div>

            {/* Chapter Menu Sidebar */}
            {showChapterMenu && (
                <div className="absolute inset-0 z-50 flex">
                    <div className="flex-1 bg-black/50 backdrop-blur-sm" onClick={() => setShowChapterMenu(false)}></div>
                    <div className="w-64 border-l border-white/10 h-full flex flex-col p-4 animate-slide-in-right" style={{ background: '#16140f', paddingTop: 'calc(var(--safe-top) + 12px)' }}>
                        <h3 className="font-bold text-sm mb-4 uppercase tracking-widest" style={{ color: CHALK, fontFamily: 'var(--font-label)' }}>课程目录</h3>
                        <div className="flex-1 overflow-y-auto no-scrollbar space-y-2">
                            {activeCourse?.chapters.map((ch, idx) => {
                                const cur = idx === activeCourse.currentChapterIndex;
                                return (
                                <button
                                    key={ch.id}
                                    onClick={() => jumpToChapter(idx)}
                                    className="w-full text-left p-3 rounded-xl text-xs transition-all"
                                    style={cur ? { background: CHALK, color: INK, fontWeight: 800 } : { color: CHALK_SOFT }}
                                >
                                    <div className="flex items-center gap-2">
                                        {ch.isCompleted ? <Check size={14} weight="bold" /> : <span className="w-2 h-2 rounded-full" style={{ background: 'rgba(242,239,228,0.3)' }}></span>}
                                        {ch.title}
                                    </div>
                                </button>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}

            {/* Main Text Content - Layout Optimized (Removed padding-right to allow full width) */}
            <div className="flex-1 overflow-y-auto no-scrollbar p-6 pt-20 pb-32 relative z-10">
                <div className="max-w-[100%]">
                    <BlackboardRenderer text={displayedText} isTyping={isTyping} katexRenderer={katexRenderer} />
                </div>
            </div>

            {/* Character Sprite - Toggable */}
            {showAssistant && (
                <div className="absolute bottom-20 right-[-20px] w-[160px] h-[220px] z-20 pointer-events-none flex items-end justify-center transition-all duration-500 animate-slide-in-right" style={{ transform: isTyping ? 'scale(1.05)' : 'scale(1)', opacity: isTyping || classroomState === 'teaching' ? 1 : 0.8 }}>
                     <img 
                        src={currentSprite} 
                        className="max-h-full max-w-full object-contain drop-shadow-[0_5px_15px_rgba(0,0,0,0.5)]"
                    />
                </div>
            )}

            {/* Controls Bar */}
            <div className="absolute bottom-0 w-full backdrop-blur-xl border-t border-white/10 p-4 z-30 pb-safe" style={{ background: 'rgba(0,0,0,0.55)' }}>
                <div className="flex gap-3">
                    {classroomState === 'teaching' || isTyping ? (
                        <div className="w-full h-12 flex items-center justify-center text-sm animate-pulse font-mono tracking-widest" style={{ color: CHALK_SOFT }}>
                            板书中…
                        </div>
                    ) : classroomState === 'finished' ? (
                        <button onClick={() => setMode('bookshelf')} className="flex-1 h-12 rounded-2xl font-black active:scale-95 transition-all" style={{ background: CHALK, color: INK, boxShadow: '0 12px 22px -12px rgba(0,0,0,0.7)' }}>
                            下课，回书架
                        </button>
                    ) : classroomState === 'q_and_a' ? (
                        <div className="w-full rounded-2xl p-1 flex items-center border border-white/10" style={{ background: 'rgba(255,255,255,0.1)' }}>
                            <input
                                value={userQuestion}
                                onChange={e => setUserQuestion(e.target.value)}
                                placeholder="举手，问点什么…"
                                className="flex-1 bg-transparent px-4 py-2 text-sm outline-none"
                                style={{ color: CHALK }}
                                autoFocus
                            />
                            <button onClick={handleAskQuestion} className="px-5 py-2 rounded-xl text-xs font-bold ml-2" style={{ background: CHALK, color: INK }}>问</button>
                        </div>
                    ) : (
                        <>
                            <button onClick={handleRegenerateChapter} className="w-12 h-12 rounded-2xl font-bold border border-white/10 active:scale-95 transition-all flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.06)', color: CHALK_SOFT }} title="重讲本章">
                                <ArrowsClockwise size={20} weight="bold" />
                            </button>
                            <button onClick={() => setClassroomState('q_and_a')} className="w-12 h-12 rounded-2xl font-bold border border-white/10 active:scale-95 transition-all flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.1)', color: CHALK }} title="举手提问">
                                <Hand size={22} />
                            </button>
                            <button onClick={openQuizSetup} className="w-12 h-12 rounded-2xl font-bold border active:scale-95 transition-all flex items-center justify-center" style={{ background: 'rgba(242,239,228,0.16)', borderColor: 'rgba(242,239,228,0.3)', color: CHALK }} title="随堂测">
                                <Notepad size={22} />
                            </button>
                            <button onClick={handleFinishChapter} className="flex-1 h-12 rounded-2xl font-black active:scale-95 transition-all flex items-center justify-center gap-2" style={{ background: CHALK, color: INK, boxShadow: '0 12px 22px -12px rgba(0,0,0,0.7)' }}>
                                下一章 <ArrowRight size={16} weight="bold" />
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* Quiz Setup Sheet */}
            <PaperSheet open={quizShowSetup} title="随堂测 · 出几道题" tape="ink" onClose={() => setQuizShowSetup(false)}>
                <div className="space-y-5">
                    <div className="text-xs" style={{ color: INK_SOFT }}>
                        本章: <span className="font-bold" style={{ color: INK }}>{activeCourse?.chapters[activeCourse?.currentChapterIndex || 0]?.title}</span>
                    </div>

                    <div>
                        <label className="text-[10px] font-bold uppercase mb-2 block" style={{ color: INK_SOFT, fontFamily: 'var(--font-label)' }}>题型</label>
                        <div className="flex flex-wrap gap-2">
                            {([['choice', '选择题'], ['true_false', '判断题'], ['fill_blank', '填空题']] as const).map(([val, label]) => {
                                const isOn = quizTypes.includes(val);
                                return (
                                    <button key={val} onClick={() => setQuizTypes(prev => isOn ? prev.filter(t => t !== val) : [...prev, val])} className="px-4 py-2 rounded-xl text-sm font-bold transition-all" style={chip(isOn)}>
                                        {label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div>
                        <label className="text-[10px] font-bold uppercase mb-2 block" style={{ color: INK_SOFT, fontFamily: 'var(--font-label)' }}>题量: {quizCount}</label>
                        <input type="range" min={3} max={15} value={quizCount} onChange={e => setQuizCount(Number(e.target.value))} className="w-full" style={{ accentColor: INK }} />
                        <div className="flex justify-between text-[10px] mt-1" style={{ color: INK_SOFT }}>
                            <span>3题</span><span>15题</span>
                        </div>
                    </div>

                    <ScrapButton variant="ink" onClick={generateQuiz} disabled={quizTypes.length === 0} className="w-full py-3 text-[14px]">开始出题</ScrapButton>
                </div>
            </PaperSheet>
        </div>
    );
};

// ── 顶栏：胶带返回钮 + 招牌（中文 + 英文小标）+ 右槽 ──
const StudyHeader: React.FC<{ title: string; en?: string; onBack: () => void; right?: React.ReactNode }> = ({ title, en, onBack, right }) => (
    <div className="relative z-20 shrink-0">
        <div style={{ height: 'var(--safe-top)' }} />
        <div className="flex items-center px-3 pt-2 pb-2.5 gap-2">
            <button onClick={onBack} className="relative inline-flex items-center gap-1 px-3 py-2 text-[12px] font-black active:scale-95 transition-transform" style={{ color: '#36322b' }}>
                <span aria-hidden className="absolute inset-0 rounded-[6px]" style={{ backgroundColor: WASHI.butter.base, backgroundImage: TAPE_STRIPES, transform: 'rotate(-2deg)', boxShadow: '0 3px 7px -3px rgba(31,29,26,0.5)' }} />
                <span className="relative z-10 flex items-center gap-1"><CaretLeft size={13} weight="bold" />返回</span>
            </button>
            <div className="leading-none">
                <div className="text-[16px] font-black tracking-[0.04em]" style={{ color: INK }}>{title}</div>
                {en && <div className="text-[7px] tracking-[0.36em] uppercase mt-0.5" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>{en}</div>}
            </div>
            <div className="flex-1" />
            {right}
        </div>
    </div>
);

export default StudyApp;
