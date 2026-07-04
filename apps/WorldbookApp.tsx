/**
 * 剪报夹 —— Lorebook 分组、条目与注入策略索引台。
 *
 * 一条 Worldbook 记录是一条世界书条目；category 分组是一整本世界书。
 * 这里只重构界面与信息层级，注入语义仍由 utils/worldbookRuntime.ts 统一处理。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    BookOpen,
    CaretDown,
    DownloadSimple,
    FileText,
    GlobeSimple,
    Key,
    MagnifyingGlass,
    NotePencil,
    NewspaperClipping,
    Stack,
    Trash,
    UploadSimple,
} from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import { AppID, Worldbook, WorldbookPosition, WorldbookSelectiveLogic } from '../types';
import { stringifyWorldbookExport, worldbookExportFileName } from '../utils/worldbookExport';
import { importWorldbookFromFile } from '../utils/worldbookImport';
import {
    DEFAULT_WB_CATEGORY,
    matchWorldbookKey,
    normalizeSelectiveLogic,
    type WorldbookGroupScope,
    type WorldbookGroupSettings,
} from '../utils/worldbookRuntime';
import { scrollToManualAnchor, useManualDeepLink } from '../utils/manualDeepLink';
import {
    Chip,
    HAIRLINE,
    IconCircle,
    INK,
    INK_SOFT,
    InsButton,
    InsCard,
    InsDialog,
    InsEmpty,
    InsHeader,
    InsScroll,
    InsShell,
    SectionLabel,
} from '../components/ui/insKit';
import { CUTE_STACK, MONO_STACK } from '../components/handbook/paper';

const AC = 'sky' as const;
const WB_CANVAS =
    'linear-gradient(180deg, #fafafa 0%, #f6fbfd 56%, #f7fbfa 100%)';
const WB_TEXT = {
    ink: '#31414c',
    soft: '#66808d',
    faint: '#8fa4ae',
};
const WB_SURFACE = {
    paper: '#fbfefe',
    panel: '#f1f8fb',
    border: '#dbe8ef',
    borderStrong: '#bfd6e3',
};
const A = {
    solid: '#9dc1d5',
    soft: '#f1f8fb',
    ink: '#3f6375',
};
const SECONDARY = {
    solid: '#9bcfb7',
    soft: '#f6fbf8',
    ink: '#405f56',
};
const MARK = {
    solid: '#c8a3dd',
    soft: '#f8f2fb',
    ink: '#6f4d85',
};
const DANGER = {
    solid: '#e8889d',
    soft: '#fff5f7',
    ink: '#9c4058',
};
const PAPER = {
    rule: 'rgba(157,193,213,0.34)',
};

type WorldbookFilter = 'all' | 'global' | 'local' | 'keyword' | 'disabled';

const FIELD_STYLE: React.CSSProperties = {
    background: WB_SURFACE.paper,
    border: `1px solid ${WB_SURFACE.border}`,
    borderRadius: 8,
    color: WB_TEXT.ink,
    boxShadow: 'inset 0 1px 2px rgba(72,105,122,0.06)',
};

const POSITION_OPTIONS: { value: WorldbookPosition; label: string; short: string }[] = [
    { value: 'before_char', label: '角色卡之前（↑CHAR）', short: '↑CHAR' },
    { value: 'after_char', label: '角色卡之后（↓CHAR · 默认）', short: '↓CHAR' },
    { value: 'depth_system', label: '插入聊天历史 · system（@Depth）', short: '@D system' },
    { value: 'depth_user', label: '插入聊天历史 · user（@Depth）', short: '@D user' },
    { value: 'depth_assistant', label: '插入聊天历史 · assistant（@Depth）', short: '@D assistant' },
];

const SELECTIVE_LOGIC_OPTIONS: { value: WorldbookSelectiveLogic; label: string; hint: string }[] = [
    { value: 'and_any', label: '主词 + 任一二级词', hint: 'AND ANY' },
    { value: 'and_all', label: '主词 + 全部二级词', hint: 'AND ALL' },
    { value: 'not_any', label: '主词 + 不命中二级词', hint: 'NOT ANY' },
    { value: 'not_all', label: '主词 + 不全命中二级词', hint: 'NOT ALL' },
];

const clampProbability = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

const parseKeyList = (raw: string): string[] =>
    raw.split(/[,，]/).map(s => s.trim()).filter(Boolean);

const positionLabel = (p?: WorldbookPosition) =>
    POSITION_OPTIONS.find(o => o.value === (p || 'after_char'))?.label || '角色卡之后';

const positionShort = (p?: WorldbookPosition) =>
    POSITION_OPTIONS.find(o => o.value === (p || 'after_char'))?.short || '↓CHAR';

const formatDate = (time?: number) =>
    new Date(time || Date.now()).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });

const sortBooksForExport = (books: Worldbook[]) =>
    [...books].sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || (a.createdAt ?? 0) - (b.createdAt ?? 0));

const snippet = (text: string, len = 84) => {
    const clean = (text || '').replace(/\s+/g, ' ').trim();
    return clean.length > len ? `${clean.slice(0, len)}...` : clean;
};

const BOOK_SPINES = [
    { cover: '#b9d3e0', edge: '#9dc1d5', label: '#3f6375', wash: '#f1f8fb' },
    { cover: '#bfe1cf', edge: '#9bcfb7', label: '#405f56', wash: '#f6fbf8' },
    { cover: '#d6c8e8', edge: '#bfa3dd', label: '#6f4d85', wash: '#f8f2fb' },
    { cover: '#f5e295', edge: '#e6cd72', label: '#78652a', wash: '#fffbe7' },
    { cover: '#dde5ed', edge: '#c8d2dc', label: '#586576', wash: '#f5f8fb' },
    { cover: '#d8eadf', edge: '#b8d8c8', label: '#49685b', wash: '#f4fbf7' },
    { cover: '#cfe1ee', edge: '#b4ccdc', label: '#415b6b', wash: '#f4f9fc' },
    { cover: '#e6edf2', edge: '#cbd8e0', label: '#596773', wash: '#f7fafc' },
];

const spineTheme = (category: string) => {
    const seed = [...category].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
    return BOOK_SPINES[seed % BOOK_SPINES.length];
};

const InkSwitch: React.FC<{ on: boolean; onChange: (on: boolean) => void; title?: string; disabled?: boolean }> = ({ on, onChange, title, disabled }) => (
    <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={(e) => { e.stopPropagation(); if (!disabled) onChange(!on); }}
        disabled={disabled}
        title={title}
        className="relative h-7 w-[52px] shrink-0 rounded-[8px] transition-all duration-300 press-soft disabled:opacity-45"
        style={{
            background: on ? A.solid : '#f8f4f6',
            border: '1px solid #dbe8ef',
            boxShadow: on ? '0 8px 16px -12px rgba(72,105,122,0.34)' : 'inset 0 1px 2px rgba(72,105,122,0.08)',
        }}
    >
        <span className="absolute top-1/2 -translate-y-1/2 text-[8px] font-bold text-white transition-opacity pointer-events-none" style={{ ...MONO_STACK, left: 8, opacity: on ? 1 : 0 }}>ON</span>
        <span className="absolute top-1/2 -translate-y-1/2 text-[8px] font-bold transition-opacity pointer-events-none" style={{ ...MONO_STACK, right: 7, color: '#aebfc8', opacity: on ? 0 : 1 }}>off</span>
        <span
            className="absolute top-1/2 h-[22px] w-[22px] -translate-y-1/2 rounded-[6px] bg-white transition-all duration-300"
            style={{ left: on ? 27 : 3, boxShadow: '0 2px 6px rgba(72,105,122,0.22)' }}
        />
    </button>
);

const FieldLabel: React.FC<{ children: React.ReactNode; en?: string }> = ({ children, en }) => (
    <label className="mb-2 flex items-center gap-2 text-[12px] font-bold" style={{ ...CUTE_STACK, color: WB_TEXT.ink }}>
        <span className="h-2 w-2 rounded-[2px]" style={{ background: A.solid }} />
        <span>{children}</span>
        {en && <span className="text-[8px] tracking-[0.22em] uppercase" style={{ ...MONO_STACK, color: WB_TEXT.faint }}>{en}</span>}
    </label>
);

const TextInput: React.FC<React.InputHTMLAttributes<HTMLInputElement>> = ({ className = '', style, ...props }) => (
    <input
        {...props}
        className={`w-full px-3 py-2.5 text-[13px] outline-none placeholder:text-[#aebfc8] ${className}`}
        style={{ ...FIELD_STYLE, ...style }}
    />
);

const TextArea: React.FC<React.TextareaHTMLAttributes<HTMLTextAreaElement>> = ({ className = '', style, ...props }) => (
    <textarea
        {...props}
        className={`w-full px-3 py-2.5 text-[13px] leading-relaxed outline-none resize-none placeholder:text-[#aebfc8] ${className}`}
        style={{ ...FIELD_STYLE, ...style }}
    />
);

const MetaBadge: React.FC<{ children: React.ReactNode; active?: boolean; tone?: 'default' | 'danger' | 'soft' | 'green' | 'mark' }> = ({ children, active, tone = 'default' }) => {
    const style: React.CSSProperties = active
        ? { background: A.soft, color: A.ink, border: '1px solid #dbe8ef' }
        : tone === 'danger'
            ? { background: '#fff5f7', color: DANGER.ink, border: '1px solid #f1c6d1' }
            : tone === 'green'
                ? { background: SECONDARY.soft, color: SECONDARY.ink, border: '1px solid #dbe9e2' }
                : tone === 'mark'
                    ? { background: MARK.soft, color: MARK.ink, border: '1px solid #d9d4ee' }
            : tone === 'soft'
                ? { background: A.soft, color: A.ink, border: '1px solid #dbe8ef' }
                : { background: '#fbfefe', color: WB_TEXT.faint, border: '1px solid #dbe8ef' };
    return (
        <span className="inline-flex items-center gap-1 rounded-[6px] px-2.5 py-1 text-[10px] font-bold leading-none" style={{ ...CUTE_STACK, ...style }}>
            {children}
        </span>
    );
};

const ToggleChoice: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode; icon?: React.ReactNode }> = ({ active, onClick, children, icon }) => (
    <button
        type="button"
        onClick={onClick}
        className="flex-1 rounded-[8px] px-3 py-2.5 text-[11px] font-bold press-soft inline-flex items-center justify-center gap-1.5"
        style={active
            ? { ...CUTE_STACK, background: A.soft, color: A.ink, border: '1px solid #bfd6e3', boxShadow: '0 6px 14px -12px rgba(72,105,122,0.28)' }
            : { ...CUTE_STACK, background: '#fbfefe', color: WB_TEXT.faint, border: '1px solid #dbe8ef' }}
    >
        {icon}{children}
    </button>
);

const ScopePill: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode; tone?: typeof A }> = ({ active, onClick, children, tone = A }) => (
    <button
        type="button"
        onClick={onClick}
        className="rounded-[8px] px-3 py-2 text-[11px] font-bold press-soft inline-flex items-center justify-center gap-1.5"
        style={active
            ? { ...CUTE_STACK, background: tone.soft, color: tone.ink, border: '1px solid #dbe8ef', boxShadow: '0 1px 2px rgba(72,105,122,0.10)' }
            : { ...CUTE_STACK, background: '#fbfefe', color: WB_TEXT.faint, border: '1px solid #dbe8ef', boxShadow: '0 1px 2px rgba(72,105,122,0.08)' }}
    >
        {children}
    </button>
);

const DeskMetric: React.FC<{ label: string; value: React.ReactNode; tone?: typeof A }> = ({ label, value, tone = A }) => (
    <div
        className="relative overflow-hidden rounded-[8px] bg-white px-3 py-3"
        style={{ color: tone.ink, border: '1px solid #dbe8ef', boxShadow: '0 1px 2px rgba(72,105,122,0.08)', ...CUTE_STACK }}
    >
        <span aria-hidden className="absolute inset-x-0 top-0 h-1" style={{ background: tone.solid }} />
        <div className="text-[21px] font-bold leading-none">{value}</div>
        <div className="mt-1 text-[10px] font-bold" style={{ color: WB_TEXT.faint }}>{label}</div>
    </div>
);

const WorldbookApp: React.FC = () => {
    const {
        closeApp,
        worldbooks,
        addWorldbook,
        updateWorldbook,
        deleteWorldbook,
        deleteWorldbookCategory,
        addToast,
        worldbookGroupToggles,
        setWorldbookGroupEnabled,
        worldbookGroupScopes,
        setWorldbookGroupScope,
        worldbookGroupSettings,
        setWorldbookGroupSettings,
        activeApp,
    } = useOS();

    const [isEditing, setIsEditing] = useState(false);
    const [editingBook, setEditingBook] = useState<Worldbook | null>(null);
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
    const [expandedCategories, setExpandedCategories] = useState<string[]>([]);
    const [didAutoExpandFirstGroup, setDidAutoExpandFirstGroup] = useState(false);
    const [bookSearch, setBookSearch] = useState('');
    const [bookFilter, setBookFilter] = useState<WorldbookFilter>('all');
    const [previewBookId, setPreviewBookId] = useState<string | null>(null);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [deleteCategoryConfirm, setDeleteCategoryConfirm] = useState<{ category: string; count: number } | null>(null);
    const [showNewBookDialog, setShowNewBookDialog] = useState(false);
    const [newBookName, setNewBookName] = useState('');
    const [newBookFirstTitle, setNewBookFirstTitle] = useState('分组说明');

    const [tempTitle, setTempTitle] = useState('');
    const [tempContent, setTempContent] = useState('');
    const [tempCategory, setTempCategory] = useState('');
    const [tempEnabled, setTempEnabled] = useState(true);
    const [tempPosition, setTempPosition] = useState<WorldbookPosition>('after_char');
    const [tempDepth, setTempDepth] = useState(4);
    const [tempOrder, setTempOrder] = useState(100);
    const [tempActivation, setTempActivation] = useState<'always' | 'keyword'>('keyword');
    const [tempKeys, setTempKeys] = useState('');
    const [tempSecondaryKeys, setTempSecondaryKeys] = useState('');
    const [tempSelective, setTempSelective] = useState(false);
    const [tempSelectiveLogic, setTempSelectiveLogic] = useState<WorldbookSelectiveLogic>('and_any');
    const [tempCaseSensitive, setTempCaseSensitive] = useState(false);
    const [tempMatchWholeWords, setTempMatchWholeWords] = useState(false);
    const [tempScanDepth, setTempScanDepth] = useState(4);
    const [tempUseProbability, setTempUseProbability] = useState(false);
    const [tempProbability, setTempProbability] = useState(100);
    const [tempIgnoreBudget, setTempIgnoreBudget] = useState(false);
    const [scanTestText, setScanTestText] = useState('');
    const [importing, setImporting] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const groupedBooks = useMemo(() => {
        const groups: Record<string, Worldbook[]> = {};
        worldbooks.forEach(wb => {
            const cat = wb.category || DEFAULT_WB_CATEGORY;
            if (!groups[cat]) groups[cat] = [];
            groups[cat].push(wb);
        });
        return groups;
    }, [worldbooks]);

    const groupedEntries = useMemo(
        () => Object.entries(groupedBooks).sort(([a], [b]) => a.localeCompare(b, 'zh-Hans-CN')),
        [groupedBooks]
    );
    const isGroupGlobal = (category: string) => worldbookGroupScopes[category || DEFAULT_WB_CATEGORY] === 'global';
    const visibleGroupedEntries = useMemo(() => {
        const q = bookSearch.trim().toLowerCase();
        return groupedEntries.reduce<Array<[string, Worldbook[]]>>((acc, [category, books]) => {
            const filteredByMode = books.filter(book => {
                const groupGlobal = worldbookGroupScopes[category || DEFAULT_WB_CATEGORY] === 'global';
                if (bookFilter === 'global') return groupGlobal;
                if (bookFilter === 'local') return !groupGlobal;
                if (bookFilter === 'keyword') return book.activation === 'keyword';
                if (bookFilter === 'disabled') return book.enabled === false || worldbookGroupToggles[category] === false;
                return true;
            });
            const categoryHit = category.toLowerCase().includes(q);
            const filtered = !q || categoryHit
                ? filteredByMode
                : filteredByMode.filter(book => [
                    book.title,
                    book.content,
                    positionLabel(book.position),
                    ...(book.keys || []),
                    ...(book.secondaryKeys || []),
                ].join(' ').toLowerCase().includes(q));
            if (filtered.length > 0) acc.push([category, filtered]);
            return acc;
        }, []);
    }, [bookFilter, bookSearch, groupedEntries, worldbookGroupScopes, worldbookGroupToggles]);
    const activeCategory = selectedCategory && groupedBooks[selectedCategory] ? selectedCategory : (groupedEntries[0]?.[0] || null);
    const searchActive = bookSearch.trim().length > 0;
    const resultEntryCount = visibleGroupedEntries.reduce((sum, [, books]) => sum + books.length, 0);
    const stats = useMemo(() => {
        const globalBooks = groupedEntries.filter(([category]) => isGroupGlobal(category)).length;
        const disabledBooks = groupedEntries.filter(([category]) => worldbookGroupToggles[category] === false).length;
        return {
            totalBooks: groupedEntries.length,
            totalEntries: worldbooks.length,
            globalBooks,
            localBooks: groupedEntries.length - globalBooks,
            keywordEntries: worldbooks.filter(wb => wb.activation === 'keyword').length,
            disabledEntries: worldbooks.filter(wb => wb.enabled === false).length,
            disabledBooks,
        };
    }, [groupedEntries, worldbooks, worldbookGroupScopes, worldbookGroupToggles]);

    useEffect(() => {
        if (didAutoExpandFirstGroup || groupedEntries.length === 0) return;
        const firstCategory = groupedEntries[0][0];
        setSelectedCategory(firstCategory);
        setExpandedCategories([firstCategory]);
        setDidAutoExpandFirstGroup(true);
    }, [didAutoExpandFirstGroup, groupedEntries]);

    const scanTestResult = useMemo(() => {
        if (tempActivation !== 'keyword') return null;
        const keys = parseKeyList(tempKeys);
        const secondary = parseKeyList(tempSecondaryKeys);
        if (!scanTestText.trim()) return null;
        if (keys.length === 0) return { triggered: false, hitKeys: [], hitSecondary: [], reason: '请先填写主关键词' };

        const lines = scanTestText.replace(/\r\n/g, '\n').split('\n').filter(l => l.trim());
        const depth = Math.max(1, tempScanDepth || 4);
        const hay = lines.slice(-depth).join('\n');
        const hit = (k: string) => matchWorldbookKey(hay, k, {
            caseSensitive: tempCaseSensitive,
            matchWholeWords: tempMatchWholeWords,
        });

        const hitKeys = keys.filter(hit);
        const hitSecondary = secondary.filter(hit);
        if (hitKeys.length === 0) {
            return { triggered: false, hitKeys, hitSecondary, reason: `最近 ${Math.min(depth, lines.length)} 条消息未命中主关键词` };
        }
        if (tempSelective && secondary.length > 0) {
            const secondaryHits = secondary.map(hit);
            const logic = normalizeSelectiveLogic(tempSelectiveLogic) || 'and_any';
            const secondaryPass =
                logic === 'and_all' ? secondaryHits.every(Boolean)
                    : logic === 'not_any' ? !secondaryHits.some(Boolean)
                        : logic === 'not_all' ? !secondaryHits.every(Boolean)
                            : secondaryHits.some(Boolean);
            if (!secondaryPass) {
                return { triggered: false, hitKeys, hitSecondary, reason: `已命中主关键词，但二级词逻辑「${SELECTIVE_LOGIC_OPTIONS.find(o => o.value === logic)?.label || logic}」未通过` };
            }
        }
        const probabilityHint = tempUseProbability && tempProbability < 100 ? `；触发概率 ${clampProbability(tempProbability)}%` : '';
        return { triggered: true, hitKeys, hitSecondary, reason: probabilityHint };
    }, [tempActivation, tempKeys, tempSecondaryKeys, tempSelective, tempSelectiveLogic, tempCaseSensitive, tempMatchWholeWords, tempScanDepth, tempUseProbability, tempProbability, scanTestText]);

    const openCreate = (categoryOverride?: string) => {
        const targetCategory = categoryOverride || activeCategory || groupedEntries[0]?.[0] || '';
        setEditingBook(null);
        setTempTitle('');
        setTempContent('');
        setTempCategory(targetCategory);
        if (targetCategory) {
            setSelectedCategory(targetCategory);
            setExpandedCategories(prev => prev.includes(targetCategory) ? prev : [...prev, targetCategory]);
        }
        setTempEnabled(true);
        setTempActivation('keyword');
        setTempPosition('after_char');
        setTempDepth(4);
        setTempOrder(100);
        setTempKeys('');
        setTempSecondaryKeys('');
        setTempSelective(false);
        setTempSelectiveLogic('and_any');
        setTempCaseSensitive(false);
        setTempMatchWholeWords(false);
        setTempScanDepth(4);
        setTempUseProbability(false);
        setTempProbability(100);
        setTempIgnoreBudget(false);
        setScanTestText('');
        setIsEditing(true);
    };

    const openCreateBook = () => {
        setNewBookName('');
        setNewBookFirstTitle('分组说明');
        setShowNewBookDialog(true);
    };

    const confirmCreateBook = async () => {
        const category = newBookName.trim();
        if (!category) {
            addToast('请填写世界书名称', 'error');
            return;
        }
        if (groupedBooks[category]) {
            addToast('该世界书已存在，可以直接添加条目', 'info');
            setSelectedCategory(category);
            setExpandedCategories(prev => prev.includes(category) ? prev : [...prev, category]);
            setShowNewBookDialog(false);
            return;
        }
        const title = newBookFirstTitle.trim() || '分组说明';
        const now = Date.now();
        const newBook: Worldbook = {
            id: `wb-${now}`,
            title,
            content: '',
            category,
            createdAt: now,
            updatedAt: now,
            enabled: true,
            position: 'after_char',
            order: 100,
            activation: 'keyword',
        };
        await addWorldbook(newBook);
        setSelectedCategory(category);
        setExpandedCategories(prev => prev.includes(category) ? prev : [...prev, category]);
        setPreviewBookId(newBook.id);
        setShowNewBookDialog(false);
        addToast(`已新建世界书「${category}」`, 'success');
    };

    const openEdit = (book: Worldbook) => {
        const stEntry = book.stData?.entry;
        setEditingBook(book);
        setTempTitle(book.title);
        setTempContent(book.content);
        setTempCategory(book.category || DEFAULT_WB_CATEGORY);
        setTempEnabled(book.enabled !== false);
        setTempActivation(book.activation ?? (stEntry?.constant ? 'always' : 'keyword'));
        setTempPosition(book.position || 'after_char');
        setTempDepth(typeof book.depth === 'number' ? book.depth : 4);
        setTempOrder(typeof book.order === 'number' ? book.order : 100);
        setTempKeys((book.keys ?? stEntry?.keys ?? []).join(', '));
        setTempSecondaryKeys((book.secondaryKeys ?? stEntry?.secondaryKeys ?? []).join(', '));
        setTempSelective(book.selective ?? !!stEntry?.selective);
        setTempSelectiveLogic(normalizeSelectiveLogic(book.selectiveLogic ?? stEntry?.selectiveLogic ?? stEntry?.extensions?.selectiveLogic ?? stEntry?.extensions?.selective_logic) || 'and_any');
        setTempCaseSensitive(book.caseSensitive ?? !!stEntry?.caseSensitive);
        setTempMatchWholeWords(book.matchWholeWords ?? stEntry?.matchWholeWords ?? !!stEntry?.extensions?.match_whole_words);
        setTempScanDepth(typeof book.scanDepth === 'number' ? book.scanDepth : (book.stData?.scanDepth ?? 4));
        const probability = typeof book.probability === 'number'
            ? book.probability
            : typeof stEntry?.probability === 'number'
                ? stEntry.probability
                : typeof stEntry?.extensions?.probability === 'number'
                    ? stEntry.extensions.probability
                    : 100;
        setTempProbability(clampProbability(probability));
        setTempUseProbability(book.useProbability !== false && (book.useProbability === true || stEntry?.useProbability === true || typeof book.probability === 'number' || typeof stEntry?.probability === 'number' || typeof stEntry?.extensions?.probability === 'number'));
        setTempIgnoreBudget(book.ignoreBudget ?? stEntry?.ignoreBudget ?? !!stEntry?.extensions?.ignore_budget);
        setScanTestText('');
        setIsEditing(true);
    };

    const openManualWorldbookTarget = useCallback((anchorId?: string, route?: string) => {
        const focusAnchor = anchorId || 'manual-worldbook-root';
        const firstCategory = activeCategory || groupedEntries[0]?.[0] || null;
        const firstBook = firstCategory ? groupedBooks[firstCategory]?.[0] : worldbooks[0];

        if (route === 'entry-settings' || focusAnchor === 'manual-worldbook-position' || focusAnchor === 'manual-worldbook-entry-toggle') {
            if (firstBook) {
                const category = firstBook.category || DEFAULT_WB_CATEGORY;
                setSelectedCategory(category);
                setExpandedCategories(prev => prev.includes(category) ? prev : [...prev, category]);
                if (focusAnchor === 'manual-worldbook-entry-toggle') {
                    setIsEditing(false);
                    setPreviewBookId(firstBook.id);
                } else {
                    openEdit(firstBook);
                }
                window.setTimeout(() => {
                    if (!scrollToManualAnchor(focusAnchor)) scrollToManualAnchor('manual-worldbook-root');
                }, focusAnchor === 'manual-worldbook-entry-toggle' ? 180 : 260);
                return;
            }
            setIsEditing(false);
            window.setTimeout(() => scrollToManualAnchor('manual-worldbook-root'), 120);
            return;
        }

        if (firstCategory) {
            setSelectedCategory(firstCategory);
            setExpandedCategories(prev => prev.includes(firstCategory) ? prev : [...prev, firstCategory]);
        }
        setIsEditing(false);
        window.setTimeout(() => {
            if (!scrollToManualAnchor(focusAnchor)) scrollToManualAnchor('manual-worldbook-root');
        }, 160);
    }, [activeCategory, groupedBooks, groupedEntries, openEdit, worldbooks]);

    useManualDeepLink(AppID.Worldbook, useCallback((target) => {
        openManualWorldbookTarget(target.anchorId, target.route);
    }, [openManualWorldbookTarget]), { enabled: activeApp === AppID.Worldbook });

    const handleSave = async () => {
        if (!tempTitle.trim()) {
            addToast('请填写条目标题', 'error');
            return;
        }

        const category = tempCategory.trim() || DEFAULT_WB_CATEGORY;
        const isKeyword = tempActivation === 'keyword';
        const keys = isKeyword ? parseKeyList(tempKeys) : [];
        const secondaryKeys = isKeyword ? parseKeyList(tempSecondaryKeys) : [];
        if (isKeyword && keys.length === 0) {
            addToast('关键词条目至少需要 1 个主关键词', 'error');
            return;
        }

        const settings = {
            enabled: tempEnabled,
            scope: undefined,
            position: tempPosition,
            depth: tempPosition.startsWith('depth_') ? Math.max(0, tempDepth) : undefined,
            order: tempOrder,
            activation: tempActivation,
            keys: isKeyword && keys.length > 0 ? keys : undefined,
            secondaryKeys: isKeyword && secondaryKeys.length > 0 ? secondaryKeys : undefined,
            selective: isKeyword && tempSelective ? true : undefined,
            selectiveLogic: isKeyword && tempSelective ? tempSelectiveLogic : undefined,
            caseSensitive: isKeyword && tempCaseSensitive ? true : undefined,
            matchWholeWords: isKeyword && tempMatchWholeWords ? true : undefined,
            scanDepth: isKeyword ? Math.max(1, tempScanDepth) : undefined,
            probability: tempUseProbability ? clampProbability(tempProbability) : undefined,
            useProbability: tempUseProbability ? true : undefined,
            ignoreBudget: tempIgnoreBudget ? true : undefined,
        };

        if (editingBook) {
            await updateWorldbook(editingBook.id, {
                title: tempTitle.trim(),
                content: tempContent,
                category,
                ...settings,
            });
            addToast('条目已保存，并同步相关角色挂载', 'success');
        } else {
            const newBook: Worldbook = {
                id: `wb-${Date.now()}`,
                title: tempTitle.trim(),
                content: tempContent,
                category,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                ...settings,
            };
            await addWorldbook(newBook);
            setSelectedCategory(category);
            setExpandedCategories(prev => prev.includes(category) ? prev : [...prev, category]);
            addToast('条目已创建', 'success');
        }
        setIsEditing(false);
    };

    const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        setImporting(true);
        try {
            const books = await importWorldbookFromFile(file);
            if (books.length === 0) {
                addToast('未解析到世界书条目', 'error');
                return;
            }
            for (const wb of books) await addWorldbook(wb);
            const category = books[0].category || DEFAULT_WB_CATEGORY;
            setSelectedCategory(category);
            setExpandedCategories(prev => prev.includes(category) ? prev : [...prev, category]);
            addToast(`已导入 ${books.length} 条世界书`, 'success');
        } catch (err: any) {
            addToast(err?.message || '导入失败', 'error');
        } finally {
            setImporting(false);
        }
    };

    const handleExportCategory = (category: string) => {
        const normalizedCategory = category || DEFAULT_WB_CATEGORY;
        const books = sortBooksForExport(groupedBooks[normalizedCategory] || []);
        if (books.length === 0) {
            addToast('这本世界书还没有可导出的条目', 'info');
            return;
        }
        const payload = stringifyWorldbookExport({
            category: normalizedCategory,
            books,
            groupEnabled: worldbookGroupToggles[normalizedCategory] !== false,
            groupScope: isGroupGlobal(normalizedCategory) ? 'global' : 'local',
            groupSettings: worldbookGroupSettings[normalizedCategory],
        });
        const blob = new Blob([payload], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = worldbookExportFileName(normalizedCategory);
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        addToast(`已导出「${normalizedCategory}」`, 'success');
    };

    const confirmDelete = async () => {
        if (!editingBook) return;
        await deleteWorldbook(editingBook.id);
        setShowDeleteConfirm(false);
        setEditingBook(null);
        setIsEditing(false);
    };

    const confirmDeleteCategory = async () => {
        if (!deleteCategoryConfirm) return;
        await deleteWorldbookCategory(deleteCategoryConfirm.category);
        if (activeCategory === deleteCategoryConfirm.category) setSelectedCategory(null);
        setExpandedCategories(prev => prev.filter(category => category !== deleteCategoryConfirm.category));
        if (editingBook && (editingBook.category || DEFAULT_WB_CATEGORY) === deleteCategoryConfirm.category) {
            setEditingBook(null);
            setIsEditing(false);
        }
        setPreviewBookId(null);
        setDeleteCategoryConfirm(null);
    };

    const renderStBadges = (book: Worldbook) => {
        if (book.source !== 'sillytavern') return null;
        const entry = book.stData?.entry;
        return (
            <div className="mt-3 flex flex-wrap gap-1.5">
                <MetaBadge active>ST 导入</MetaBadge>
                {entry && (
                    <>
                        <MetaBadge>{entry.constant ? 'constant 常驻' : '关键词触发'}</MetaBadge>
                        {entry.enabled === false && <MetaBadge tone="danger">原卡停用</MetaBadge>}
                        {(entry.keys?.length || 0) > 0 && <MetaBadge>关键词 {entry.keys!.join(', ')}</MetaBadge>}
                        {(entry.secondaryKeys?.length || 0) > 0 && <MetaBadge>二级词 {entry.secondaryKeys!.join(', ')}</MetaBadge>}
                        {entry.selectiveLogic && <MetaBadge>二级逻辑 {SELECTIVE_LOGIC_OPTIONS.find(o => o.value === entry.selectiveLogic)?.hint || entry.selectiveLogic}</MetaBadge>}
                        {entry.matchWholeWords && <MetaBadge>整词匹配</MetaBadge>}
                        {entry.probability !== undefined && <MetaBadge>概率 {entry.probability}%</MetaBadge>}
                        {entry.ignoreBudget && <MetaBadge>忽略预算</MetaBadge>}
                        {entry.insertionOrder !== undefined && <MetaBadge>顺序 {entry.insertionOrder}</MetaBadge>}
                        {entry.position !== undefined && <MetaBadge>位置 {String(entry.position)}</MetaBadge>}
                    </>
                )}
                {book.stData?.bookName && <MetaBadge>原书 {book.stData.bookName}</MetaBadge>}
                {book.stData?.scanDepth !== undefined && <MetaBadge>scan_depth {book.stData.scanDepth}</MetaBadge>}
                {book.stData?.tokenBudget !== undefined && <MetaBadge>token_budget {book.stData.tokenBudget}</MetaBadge>}
                {book.stData?.recursiveScanning !== undefined && <MetaBadge>递归扫描 {book.stData.recursiveScanning ? '开' : '关'}</MetaBadge>}
            </div>
        );
    };

    const toggleCategory = (category: string) => {
        setSelectedCategory(category);
        setPreviewBookId(null);
        setExpandedCategories(prev =>
            prev.includes(category)
                ? prev.filter(item => item !== category)
                : [...prev, category]
        );
    };

    const renderEntryCard = (book: Worldbook, index: number) => {
        const open = previewBookId === book.id;
        const disabled = book.enabled === false;
        const isKeywordEntry = book.activation === 'keyword';
        return (
            <div
                key={book.id}
                data-manual-anchor={index === 0 ? 'manual-worldbook-entry-toggle' : undefined}
                onClick={() => setPreviewBookId(open ? null : book.id)}
                className={`group relative overflow-hidden rounded-[8px] border transition-all press-soft ${disabled ? 'opacity-55' : ''}`}
                style={{
                    background: '#fbfefe',
                    borderColor: open ? '#bfd6e3' : '#dbe8ef',
                    boxShadow: open ? '0 10px 22px -18px rgba(72,105,122,0.34)' : '0 1px 2px rgba(72,105,122,0.08)',
                    animationDelay: `${Math.min(index, 10) * 28}ms`,
                }}
            >
                <div
                    className="absolute bottom-0 right-0 top-0 w-12 opacity-55"
                    style={{ background: `linear-gradient(90deg, transparent, ${isKeywordEntry ? MARK.soft : SECONDARY.soft})` }}
                />
                <div className="flex items-stretch gap-3 p-3">
                    <div
                        className="flex w-10 shrink-0 flex-col items-center justify-center rounded-[6px]"
                        style={{ background: disabled ? '#f0f1f5' : (isKeywordEntry ? MARK.soft : SECONDARY.soft), color: disabled ? '#9b9daa' : (isKeywordEntry ? MARK.ink : SECONDARY.ink) }}
                    >
                        <div className="text-[18px] font-bold leading-none tabular-nums" style={CUTE_STACK}>{index + 1}</div>
                        <div className="mt-1 text-[8px] font-bold uppercase" style={{ ...MONO_STACK, color: WB_TEXT.faint }}>card</div>
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-start gap-2">
                            <div className="min-w-0 flex-1">
                                <h3 className={`truncate text-[14px] font-bold ${disabled ? 'line-through' : ''}`} style={{ ...CUTE_STACK, color: WB_TEXT.ink }}>{book.title}</h3>
                                <p className={`mt-1 text-[11px] leading-relaxed ${open ? 'whitespace-pre-wrap' : 'line-clamp-2'}`} style={{ ...CUTE_STACK, color: WB_TEXT.soft }}>
                                    {book.content ? (open ? book.content : snippet(book.content, 112)) : <span className="italic" style={{ color: INK_SOFT }}>该条目暂无内容</span>}
                                </p>
                            </div>
                            <MetaBadge tone={isKeywordEntry ? 'mark' : 'green'}>
                                {isKeywordEntry ? <Key size={10} weight="bold" /> : <Stack size={10} weight="bold" />}
                                {isKeywordEntry ? '关键词' : '常驻'}
                            </MetaBadge>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                            <MetaBadge>{positionShort(book.position)}</MetaBadge>
                            <MetaBadge>order {book.order ?? 100}</MetaBadge>
                            <MetaBadge>{formatDate(book.updatedAt)}</MetaBadge>
                            {isKeywordEntry && (book.keys?.length || 0) > 0 && (
                                <MetaBadge tone="mark">{book.keys!.slice(0, 3).join(' / ')}{book.keys!.length > 3 ? '...' : ''}</MetaBadge>
                            )}
                            {isKeywordEntry && book.matchWholeWords && <MetaBadge>整词</MetaBadge>}
                            {typeof book.probability === 'number' && book.useProbability !== false && <MetaBadge>概率 {clampProbability(book.probability)}%</MetaBadge>}
                            {book.ignoreBudget && <MetaBadge>预算豁免</MetaBadge>}
                        </div>
                        {open && renderStBadges(book)}
                    </div>
                    <div className="flex shrink-0 flex-col items-center justify-between gap-2" onClick={e => e.stopPropagation()}>
                        <InkSwitch on={book.enabled !== false} onChange={(on) => updateWorldbook(book.id, { enabled: on })} title="条目开关" />
                        <div className="flex gap-1.5">
                            <IconCircle size={30} onClick={() => openEdit(book)} title="编辑条目"><NotePencil size={14} weight="bold" /></IconCircle>
                            <IconCircle size={30} onClick={() => { setEditingBook(book); setShowDeleteConfirm(true); }} title="删除条目"><Trash size={14} weight="bold" /></IconCircle>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    const renderCategoryPanel = ([category, visibleBooks]: [string, Worldbook[]], panelIndex = 0) => {
        const allBooks = groupedBooks[category] || visibleBooks;
        const totalCount = allBooks.length;
        const sortedBooks = [...visibleBooks].sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || b.updatedAt - a.updatedAt);
        const enabled = worldbookGroupToggles[category] !== false;
        const scope: WorldbookGroupScope = isGroupGlobal(category) ? 'global' : 'local';
        const enabledCount = allBooks.filter(wb => wb.enabled !== false).length;
        const keywordCount = allBooks.filter(wb => wb.activation === 'keyword').length;
        const expanded = searchActive || expandedCategories.includes(category);
        const countText = searchActive && visibleBooks.length !== totalCount
            ? `${visibleBooks.length}/${totalCount} 条`
            : `${totalCount} 条`;
        const theme = spineTheme(category);
        const scopeTone = scope === 'global' ? SECONDARY : A;
        const fallbackGroupSettings = (() => {
            for (const book of allBooks) {
                const data = book.stData;
                if (!data) continue;
                const out: WorldbookGroupSettings = {};
                if (typeof data.recursiveScanning === 'boolean') out.recursiveScanning = data.recursiveScanning;
                if (typeof data.tokenBudget === 'number' && data.tokenBudget >= 0) out.tokenBudget = data.tokenBudget;
                const maxSteps = data.bookExtensions?.max_recursion_steps ?? data.bookExtensions?.maxRecursionSteps;
                if (typeof maxSteps === 'number' && maxSteps >= 0) out.maxRecursionSteps = maxSteps;
                if (Object.keys(out).length > 0) return out;
            }
            return {};
        })();
        const groupSettings = { ...fallbackGroupSettings, ...(worldbookGroupSettings[category] || {}) };
        const updateGroupSettings = (updates: Partial<WorldbookGroupSettings>) => {
            setWorldbookGroupSettings(category, { ...groupSettings, ...updates });
        };

        return (
            <section key={category} className="space-y-3">
                <div
                    data-manual-anchor="manual-worldbook-group-toggle"
                    className={`relative overflow-hidden rounded-[8px] border bg-white transition-opacity ${enabled ? '' : 'opacity-65'}`}
                    style={{
                        borderColor: expanded ? '#bfd6e3' : '#ededed',
                        boxShadow: expanded ? '0 10px 22px -18px rgba(72,105,122,0.28)' : '0 1px 2px rgba(38,38,38,0.04), 0 14px 30px -24px rgba(38,38,38,0.22)',
                    }}
                >
                    <div className="absolute inset-x-0 top-0 h-1" style={{ background: `linear-gradient(90deg, ${theme.edge}, ${theme.cover}, ${scopeTone.solid})` }} />
                    <div
                        className="absolute bottom-0 right-0 top-0 w-14 opacity-35"
                        style={{ background: `linear-gradient(90deg, transparent, ${theme.wash})` }}
                    />
                    <div className="flex items-center gap-2 px-3 py-4">
                        <button
                            type="button"
                            onClick={() => toggleCategory(category)}
                            className="min-w-0 flex-1 press-soft rounded-[6px] px-1 py-1 text-left"
                        >
                            <div className="flex min-w-0 items-center gap-3">
                                <span
                                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] transition-transform"
                                    style={{ background: expanded ? theme.wash : '#fbfefe', border: '1px solid #dbe8ef', color: expanded ? theme.edge : WB_TEXT.faint }}
                                >
                                    <CaretDown size={16} weight="bold" className={`transition-transform ${expanded ? '' : '-rotate-90'}`} />
                                </span>
                                <div className="min-w-0 flex-1">
                                    <div className="flex min-w-0 items-center gap-2">
                                        <h3 className="truncate text-[15px] font-bold" style={{ ...CUTE_STACK, color: WB_TEXT.ink }}>{category}</h3>
                                        <span className="shrink-0 rounded-[6px] px-2.5 py-1 text-[10px] font-bold" style={{ ...CUTE_STACK, background: '#fbfefe', border: '1px solid #dbe8ef', color: WB_TEXT.faint }}>
                                            {countText}
                                        </span>
                                    </div>
                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                        <MetaBadge tone={scope === 'global' ? 'green' : 'soft'}>{scope === 'global' ? '整本全局' : '整本局部'}</MetaBadge>
                                        <MetaBadge tone="green">{enabledCount} 条启用</MetaBadge>
                                        <MetaBadge tone="mark">{keywordCount} 个关键词</MetaBadge>
                                        {groupSettings.recursiveScanning && <MetaBadge tone="mark">递归扫描</MetaBadge>}
                                        {(groupSettings.tokenBudget || 0) > 0 && <MetaBadge>预算 {groupSettings.tokenBudget}</MetaBadge>}
                                        {!enabled && <MetaBadge tone="danger">整本停用</MetaBadge>}
                                    </div>
                                </div>
                            </div>
                        </button>

                        <div className="flex shrink-0 items-center gap-2" onClick={e => e.stopPropagation()}>
                            <span data-manual-anchor={panelIndex === 0 ? 'manual-worldbook-export' : undefined}>
                                <IconCircle
                                    size={34}
                                    onClick={() => handleExportCategory(category)}
                                    title="导出这本世界书"
                                >
                                    <DownloadSimple size={15} weight="bold" />
                                </IconCircle>
                            </span>
                            <IconCircle
                                size={34}
                                onClick={() => setDeleteCategoryConfirm({ category, count: totalCount })}
                                title="删除整本世界书"
                            >
                                <Trash size={15} weight="bold" />
                            </IconCircle>
                            <InkSwitch
                                on={enabled}
                                onChange={(on) => {
                                    setWorldbookGroupEnabled(category, on);
                                    addToast(on ? `「${category}」已启用` : `「${category}」已停用（该书所有条目暂停注入）`, 'info');
                                }}
                                title="整本世界书开关"
                            />
                        </div>
                    </div>
                </div>

                {expanded && (
                    <div className="space-y-3 animate-fade-in">
                        <div data-manual-anchor="manual-worldbook-group-scope" className="rounded-[8px] bg-white p-3" style={{ border: '1px solid #ededed', boxShadow: '0 1px 2px rgba(38,38,38,0.04), 0 14px 30px -24px rgba(38,38,38,0.22)' }}>
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="text-[12.5px] font-bold" style={{ ...CUTE_STACK, color: WB_TEXT.ink }}>整本策略</div>
                                    <p className="mt-1 text-[10px] leading-relaxed" style={{ ...CUTE_STACK, color: WB_TEXT.soft }}>
                                        这里决定这本书给谁可用；条目仍按各自的常驻 / 关键词规则触发。
                                    </p>
                                </div>
                                <Chip accent={AC} active onClick={() => openCreate(category)}>新条目</Chip>
                            </div>
                            <div className="mt-3 grid grid-cols-2 gap-2">
                                <button
                                    type="button"
                                    onClick={() => { setWorldbookGroupScope(category, 'local'); addToast(`「${category}」已设为局部世界书`, 'success'); }}
                                    className="rounded-[8px] px-3 py-2.5 text-[12px] font-bold press-soft inline-flex items-center justify-center gap-1.5"
                                    style={scope === 'local'
                                        ? { ...CUTE_STACK, background: A.soft, color: A.ink, border: '1px solid #bfd6e3', boxShadow: '0 1px 2px rgba(72,105,122,0.10)' }
                                        : { ...CUTE_STACK, background: '#fbfefe', color: WB_TEXT.faint, border: '1px solid #dbe8ef' }}
                                >
                                    <BookOpen size={14} weight="bold" />局部：需绑定
                                </button>
                                <button
                                    type="button"
                                    onClick={() => { setWorldbookGroupScope(category, 'global'); addToast(`「${category}」已设为全局世界书`, 'success'); }}
                                    className="rounded-[8px] px-3 py-2.5 text-[12px] font-bold press-soft inline-flex items-center justify-center gap-1.5"
                                    style={scope === 'global'
                                        ? { ...CUTE_STACK, background: SECONDARY.soft, color: SECONDARY.ink, border: '1px solid #dbe9e2', boxShadow: '0 1px 2px rgba(72,105,122,0.08)' }
                                        : { ...CUTE_STACK, background: '#fbfefe', color: WB_TEXT.faint, border: '1px solid #dbe8ef' }}
                                >
                                    <GlobeSimple size={14} weight="bold" />全局：所有角色
                                </button>
                            </div>
                            <div className="mt-3 grid gap-2 sm:grid-cols-3">
                                <button
                                    type="button"
                                    onClick={() => updateGroupSettings({ recursiveScanning: !groupSettings.recursiveScanning })}
                                    className="rounded-[8px] px-3 py-2 text-left press-soft"
                                    style={{ background: groupSettings.recursiveScanning ? MARK.soft : '#fbfefe', border: `1px solid ${groupSettings.recursiveScanning ? '#d9d4ee' : '#dbe8ef'}` }}
                                >
                                    <div className="text-[11px] font-bold" style={{ ...CUTE_STACK, color: WB_TEXT.ink }}>递归扫描</div>
                                    <div className="mt-0.5 text-[10px]" style={{ ...CUTE_STACK, color: WB_TEXT.soft }}>{groupSettings.recursiveScanning ? '正文继续触发关键词' : '只扫描聊天近窗'}</div>
                                </button>
                                <div>
                                    <div className="mb-1 text-[10px] font-bold" style={{ ...CUTE_STACK, color: WB_TEXT.faint }}>TOKEN 预算</div>
                                    <TextInput
                                        type="number"
                                        min={0}
                                        value={(groupSettings.tokenBudget || 0) > 0 ? groupSettings.tokenBudget : ''}
                                        onChange={e => {
                                            const raw = e.target.value.trim();
                                            updateGroupSettings({ tokenBudget: raw ? Math.max(1, parseInt(raw, 10) || 1) : 0 });
                                        }}
                                        placeholder="不限"
                                    />
                                </div>
                                <div>
                                    <div className="mb-1 text-[10px] font-bold" style={{ ...CUTE_STACK, color: WB_TEXT.faint }}>递归轮数</div>
                                    <TextInput
                                        type="number"
                                        min={0}
                                        disabled={!groupSettings.recursiveScanning}
                                        value={typeof groupSettings.maxRecursionSteps === 'number' ? groupSettings.maxRecursionSteps : ''}
                                        onChange={e => {
                                            const raw = e.target.value.trim();
                                            updateGroupSettings({ maxRecursionSteps: raw ? Math.max(0, parseInt(raw, 10) || 0) : 0 });
                                        }}
                                        placeholder="默认 4"
                                        style={!groupSettings.recursiveScanning ? { opacity: 0.45 } : undefined}
                                    />
                                </div>
                            </div>
                        </div>

                        {sortedBooks.length === 0 ? (
                            <InsEmpty icon={<FileText size={42} weight="thin" />} title="当前世界书暂无条目" hint="添加条目后，才会有内容可被注入聊天提示词。" />
                        ) : (
                            <div className="space-y-2.5">
                                {sortedBooks.map(renderEntryCard)}
                            </div>
                        )}
                    </div>
                )}
            </section>
        );
    };

    const renderBookShelf = () => (
        <div
            className="relative overflow-hidden rounded-[8px] border bg-white px-4 pb-4 pt-3.5"
            style={{
                borderColor: '#ededed',
                boxShadow: '0 1px 2px rgba(38,38,38,0.04), 0 14px 30px -24px rgba(38,38,38,0.22)',
            }}
        >
            <div className="relative flex items-start justify-between gap-4">
                <div className="min-w-0">
                    <div
                        className="inline-flex items-center gap-2 rounded-[6px] px-3 py-1 text-[10px] font-bold uppercase"
                        style={{ ...MONO_STACK, color: '#55798a', background: '#f1f8fb', border: '1px solid #dbe8ef' }}
                    >
                        <NewspaperClipping size={13} weight="bold" /> Clipbook
                    </div>
                    <h1 className="mt-2 text-[21px] font-bold leading-tight" style={{ ...CUTE_STACK, color: WB_TEXT.ink }}>剪报书架</h1>
                    <p className="mt-1 max-w-[28rem] text-[11px] leading-relaxed" style={{ ...CUTE_STACK, color: WB_TEXT.soft }}>
                        每本书是一组设定。点书脊展开分组，配合搜索和筛选定位全局书、局部书、关键词条目与停用项。
                    </p>
                </div>
                <div className="hidden shrink-0 rounded-[8px] px-3 py-2.5 text-right sm:block" style={{ background: '#fbfefe', border: '1px solid #dbe8ef', boxShadow: '0 1px 2px rgba(72,105,122,0.10)' }}>
                    <div className="text-[24px] font-bold leading-none tabular-nums" style={{ ...CUTE_STACK, color: A.ink }}>{resultEntryCount}</div>
                    <div className="mt-1 text-[10px] font-bold" style={{ ...CUTE_STACK, color: WB_TEXT.faint }}>当前结果条目</div>
                </div>
            </div>

            <div
                className="relative mt-4 overflow-hidden rounded-[8px] border px-2.5 pb-[13px] pt-3"
                style={{
                    background: '#fbfefe',
                    borderColor: '#dbe8ef',
                }}
            >
                <div className="relative z-10 overflow-x-auto no-scrollbar">
                    <div className="flex min-h-[116px] min-w-max items-end gap-[2px]">
                    {groupedEntries.map(([category, books]) => {
                        const theme = spineTheme(category);
                        const selected = expandedCategories.includes(category) || (searchActive && visibleGroupedEntries.some(([c]) => c === category));
                        const height = 78 + Math.min(26, books.length * 5);
                        const global = isGroupGlobal(category);
                        const disabled = worldbookGroupToggles[category] === false;
                        const shortTitle = category.length > 8 ? `${category.slice(0, 8)}…` : category;
                        return (
                            <button
                                key={category}
                                type="button"
                                onClick={() => toggleCategory(category)}
                                className="relative flex w-[32px] shrink-0 flex-col justify-between overflow-hidden rounded-t-[4px] border px-1.5 py-1.5 text-left transition-transform press-soft"
                                style={{
                                    height,
                                    background: `linear-gradient(90deg, ${theme.edge}, ${theme.cover} 30%, ${theme.cover} 78%, rgba(255,255,255,0.38) 79%, ${theme.edge})`,
                                    borderColor: selected ? `${theme.edge}dd` : 'rgba(255,255,255,0.82)',
                                    color: theme.label,
                                    opacity: disabled ? 0.42 : 1,
                                    boxShadow: selected ? `0 8px 16px -12px ${theme.edge}` : '0 6px 14px -13px rgba(72,105,122,0.26)',
                                }}
                                title={category}
                            >
                                <span className="absolute inset-x-1 top-1 h-1 rounded-[2px] opacity-35" style={{ background: theme.label }} />
                                <span
                                    className="mt-1 overflow-hidden text-[10px] font-bold leading-none"
                                    style={{ ...CUTE_STACK, writingMode: 'vertical-rl', textOrientation: 'mixed', maxHeight: height - 26 }}
                                >
                                    {shortTitle}
                                </span>
                                <span className="mt-1 rounded-[4px] px-1 py-0.5 text-center text-[9px] font-bold tabular-nums" style={{ ...MONO_STACK, background: 'rgba(255,255,255,0.44)' }}>
                                    {books.length}
                                </span>
                                {global && <span className="absolute right-1 top-1 h-2 w-2 rounded-full border border-white" style={{ background: SECONDARY.solid }} />}
                                {disabled && <span className="absolute inset-0 bg-white/45" />}
                            </button>
                        );
                    })}
                    {groupedEntries.length === 0 && (
                        <div className="rounded-[8px] bg-white px-4 py-5 text-[12px] font-bold" style={{ ...CUTE_STACK, color: WB_TEXT.soft, border: '1px solid #dbe8ef' }}>
                            还没有世界书
                        </div>
                    )}
                    </div>
                </div>
                <div
                    aria-hidden
                    className="absolute inset-x-2.5 bottom-2 h-[12px] rounded-[3px]"
                    style={{
                        background: 'linear-gradient(90deg, #e7edf6, #dcebf2 48%, #e5f3ed)',
                        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.7)',
                    }}
                />
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <DeskMetric label="世界书" value={stats.totalBooks} />
                <DeskMetric label="条目" value={stats.totalEntries} tone={SECONDARY} />
                <DeskMetric label="关键词" value={stats.keywordEntries} tone={MARK} />
                <DeskMetric label="停用" value={stats.disabledEntries + stats.disabledBooks} tone={DANGER} />
            </div>
        </div>
    );

    if (isEditing) {
        const isDepthPosition = tempPosition.startsWith('depth_');
        return (
            <InsShell accent={AC} wash={false} style={{ background: WB_CANVAS }}>
                <InsHeader
                    accent={AC}
                    title={editingBook ? '编辑条目' : '新建条目'}
                    en={editingBook ? 'EDIT ENTRY' : 'NEW ENTRY'}
                    onBack={() => setIsEditing(false)}
                    right={<InsButton accent={AC} onClick={handleSave} className="px-4 py-2 text-[12px]">保存</InsButton>}
                />
                <InsScroll className="px-4 pb-8">
                    <div className="space-y-4 pt-2">
                        <InsCard accent={AC} edge className="p-4 space-y-4">
                            <SectionLabel en="CONTENT" accent={AC}>条目内容</SectionLabel>
                            <div>
                                <FieldLabel en="TITLE">条目标题</FieldLabel>
                                <TextInput value={tempTitle} onChange={e => setTempTitle(e.target.value)} placeholder="比如：魔法体系、公司背景..." />
                            </div>
                            <div>
                                <FieldLabel en="BOOK">所属世界书</FieldLabel>
                                <TextInput value={tempCategory} onChange={e => setTempCategory(e.target.value)} placeholder="比如：世界观、人物、地理..." list="worldbook-category-suggestions" />
                                <datalist id="worldbook-category-suggestions">
                                    {Object.keys(groupedBooks).map(cat => <option key={cat} value={cat} />)}
                                </datalist>
                            </div>
                            <div>
                                <FieldLabel en="BODY">正文</FieldLabel>
                                <TextArea value={tempContent} onChange={e => setTempContent(e.target.value)} rows={9} placeholder="写入会被注入聊天上下文的设定内容..." />
                            </div>
                        </InsCard>

                        <InsCard accent={AC} className="p-4 space-y-4">
                            <SectionLabel en="ROUTING" accent={AC}>注入设置</SectionLabel>
                            <div className="flex items-center justify-between gap-3 rounded-[8px] px-3 py-3" style={{ background: A.soft, border: '1px solid #dbe8ef' }}>
                                <div>
                                    <div className="text-[12px] font-bold" style={{ ...CUTE_STACK, color: WB_TEXT.ink }}>条目开关</div>
                                    <div className="mt-0.5 text-[11px]" style={{ ...CUTE_STACK, color: WB_TEXT.soft }}>关闭后，该条目不会参与任何提示词注入。</div>
                                </div>
                                <InkSwitch on={tempEnabled} onChange={setTempEnabled} />
                            </div>
                            <div>
                                <FieldLabel en="ACTIVATION">条目激活方式</FieldLabel>
                                <div className="flex gap-2">
                                    <ToggleChoice active={tempActivation === 'always'} onClick={() => setTempActivation('always')} icon={<Stack size={13} weight="bold" />}>常驻</ToggleChoice>
                                    <ToggleChoice active={tempActivation === 'keyword'} onClick={() => setTempActivation('keyword')} icon={<Key size={13} weight="bold" />}>关键词</ToggleChoice>
                                </div>
                                <p className="mt-2 text-[11px] leading-relaxed" style={{ ...CUTE_STACK, color: WB_TEXT.soft }}>
                                    常驻条目不需要关键词；关键词条目会先扫描最近聊天，命中主关键词后才注入。整本全局/局部只决定哪些角色可用。
                                </p>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <button type="button" onClick={() => setTempUseProbability(v => !v)} className="rounded-[8px] px-3 py-2 text-left press-soft" style={{ background: tempUseProbability ? '#fbfefe' : 'rgba(251,254,254,0.72)', border: `1px solid ${tempUseProbability ? '#b4ccdc' : '#dbe8ef'}` }}>
                                    <div className="text-[11px] font-bold" style={{ ...CUTE_STACK, color: WB_TEXT.ink }}>触发概率</div>
                                    <div className="mt-0.5 text-[10px]" style={{ ...CUTE_STACK, color: WB_TEXT.soft }}>{tempUseProbability ? `${clampProbability(tempProbability)}% 通过` : '必定通过'}</div>
                                </button>
                                <button type="button" onClick={() => setTempIgnoreBudget(v => !v)} className="rounded-[8px] px-3 py-2 text-left press-soft" style={{ background: tempIgnoreBudget ? '#fbfefe' : 'rgba(251,254,254,0.72)', border: `1px solid ${tempIgnoreBudget ? '#b4ccdc' : '#dbe8ef'}` }}>
                                    <div className="text-[11px] font-bold" style={{ ...CUTE_STACK, color: WB_TEXT.ink }}>预算豁免</div>
                                    <div className="mt-0.5 text-[10px]" style={{ ...CUTE_STACK, color: WB_TEXT.soft }}>{tempIgnoreBudget ? '不计入整书预算' : '计入整书预算'}</div>
                                </button>
                            </div>
                            {tempUseProbability && (
                                <div>
                                    <FieldLabel en="PROBABILITY">触发概率（0-100）</FieldLabel>
                                    <TextInput type="number" min={0} max={100} value={tempProbability} onChange={e => setTempProbability(clampProbability(parseInt(e.target.value, 10) || 0))} />
                                </div>
                            )}
                            {tempActivation === 'keyword' ? (
                                <div className="space-y-3 rounded-[8px] p-3 animate-fade-in" style={{ background: MARK.soft, border: '1px solid #d9d4ee' }}>
                                    <SectionLabel en="KEYWORDS" accent={AC}>关键词设置</SectionLabel>
                                    <div>
                                        <FieldLabel en="PRIMARY">主关键词</FieldLabel>
                                        <TextInput value={tempKeys} onChange={e => setTempKeys(e.target.value)} placeholder="逗号分隔，如：魔法, 学院" />
                                    </div>
                                    <div>
                                        <FieldLabel en="SECONDARY">二级关键词</FieldLabel>
                                        <TextInput value={tempSecondaryKeys} onChange={e => setTempSecondaryKeys(e.target.value)} placeholder="可选；开启二级过滤时使用" />
                                    </div>
                                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                                        <button type="button" onClick={() => setTempSelective(v => !v)} className="rounded-[8px] px-3 py-2 text-left press-soft" style={{ background: tempSelective ? '#fbfefe' : 'rgba(251,254,254,0.72)', border: `1px solid ${tempSelective ? '#b4ccdc' : '#dbe8ef'}` }}>
                                            <div className="text-[11px] font-bold" style={{ ...CUTE_STACK, color: WB_TEXT.ink }}>二级过滤</div>
                                            <div className="mt-0.5 text-[10px]" style={{ ...CUTE_STACK, color: WB_TEXT.soft }}>{tempSelective ? '启用二级逻辑' : '只看主关键词'}</div>
                                        </button>
                                        <button type="button" onClick={() => setTempCaseSensitive(v => !v)} className="rounded-[8px] px-3 py-2 text-left press-soft" style={{ background: tempCaseSensitive ? '#fbfefe' : 'rgba(251,254,254,0.72)', border: `1px solid ${tempCaseSensitive ? '#b4ccdc' : '#dbe8ef'}` }}>
                                            <div className="text-[11px] font-bold" style={{ ...CUTE_STACK, color: WB_TEXT.ink }}>大小写</div>
                                            <div className="mt-0.5 text-[10px]" style={{ ...CUTE_STACK, color: WB_TEXT.soft }}>{tempCaseSensitive ? '敏感匹配' : '不敏感匹配'}</div>
                                        </button>
                                        <button type="button" onClick={() => setTempMatchWholeWords(v => !v)} className="rounded-[8px] px-3 py-2 text-left press-soft" style={{ background: tempMatchWholeWords ? '#fbfefe' : 'rgba(251,254,254,0.72)', border: `1px solid ${tempMatchWholeWords ? '#b4ccdc' : '#dbe8ef'}` }}>
                                            <div className="text-[11px] font-bold" style={{ ...CUTE_STACK, color: WB_TEXT.ink }}>整词匹配</div>
                                            <div className="mt-0.5 text-[10px]" style={{ ...CUTE_STACK, color: WB_TEXT.soft }}>{tempMatchWholeWords ? '避免词内命中' : '允许片段命中'}</div>
                                        </button>
                                    </div>
                                    {tempSelective && (
                                        <div>
                                            <FieldLabel en="LOGIC">二级词逻辑</FieldLabel>
                                            <select
                                                value={tempSelectiveLogic}
                                                onChange={e => setTempSelectiveLogic(e.target.value as WorldbookSelectiveLogic)}
                                                className="w-full appearance-none px-4 py-3 text-sm font-bold outline-none"
                                                style={FIELD_STYLE}
                                            >
                                                {SELECTIVE_LOGIC_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                                            </select>
                                        </div>
                                    )}
                                    <div>
                                        <FieldLabel en="SCAN">扫描深度</FieldLabel>
                                        <TextInput type="number" min={1} value={tempScanDepth} onChange={e => setTempScanDepth(Math.max(1, parseInt(e.target.value, 10) || 1))} />
                                    </div>
                                    <div>
                                        <FieldLabel en="TEST">关键词测试</FieldLabel>
                                        <TextArea value={scanTestText} onChange={e => setScanTestText(e.target.value)} rows={4} placeholder="每行视作一条最近消息，用于测试该条目是否会被触发。" />
                                        {scanTestResult && (
                                            <div className="mt-2 rounded-[8px] px-3 py-2 text-[11px] leading-relaxed" style={{ ...CUTE_STACK, background: scanTestResult.triggered ? '#f6fbf8' : '#fbfefe', color: scanTestResult.triggered ? '#5f7f6d' : '#6f4d85', border: `1px solid ${scanTestResult.triggered ? '#dbe9e2' : '#dbe8ef'}` }}>
                                                {scanTestResult.triggered
                                                    ? `会触发。命中：${scanTestResult.hitKeys.join(' / ')}${scanTestResult.hitSecondary.length ? `；二级词：${scanTestResult.hitSecondary.join(' / ')}` : ''}${scanTestResult.reason}`
                                                    : scanTestResult.reason}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ) : (
                                <div className="rounded-[8px] p-3 animate-fade-in" style={{ background: SECONDARY.soft, border: '1px solid #dbe9e2' }}>
                                    <div className="flex items-center gap-2 text-[12px] font-bold" style={{ ...CUTE_STACK, color: SECONDARY.ink }}>
                                        <Stack size={14} weight="bold" />
                                        常驻条目
                                    </div>
                                    <p className="mt-1.5 text-[11px] leading-relaxed" style={{ ...CUTE_STACK, color: WB_TEXT.soft }}>
                                        该条目不需要关键词。是否参与某个角色的提示词，由条目开关、整本开关、整本作用域与局部绑定共同决定。
                                    </p>
                                </div>
                            )}
                            <div>
                                <FieldLabel en="POSITION">插入位置</FieldLabel>
                                <select
                                    value={tempPosition}
                                    onChange={e => setTempPosition(e.target.value as WorldbookPosition)}
                                    className="w-full appearance-none px-4 py-3 text-sm font-bold outline-none"
                                    style={FIELD_STYLE}
                                >
                                    {POSITION_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                                </select>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <FieldLabel en="ORDER">顺序</FieldLabel>
                                    <TextInput type="number" value={tempOrder} onChange={e => setTempOrder(parseInt(e.target.value, 10) || 0)} />
                                </div>
                                <div>
                                    <FieldLabel en="DEPTH">@Depth</FieldLabel>
                                    <TextInput type="number" min={0} disabled={!isDepthPosition} value={tempDepth} onChange={e => setTempDepth(Math.max(0, parseInt(e.target.value, 10) || 0))} style={!isDepthPosition ? { opacity: 0.45 } : undefined} />
                                </div>
                            </div>
                        </InsCard>

                        {editingBook?.source === 'sillytavern' && (
                            <InsCard accent={AC} className="p-4">
                                <SectionLabel en="SILLYTAVERN" accent={AC}>原卡信息</SectionLabel>
                                {renderStBadges(editingBook)}
                            </InsCard>
                        )}

                        <div className="flex gap-2 pb-4">
                            <InsButton accent={AC} variant="soft" onClick={() => setIsEditing(false)} className="flex-1 py-3 text-[13px]">取消</InsButton>
                            <InsButton accent={AC} onClick={handleSave} className="flex-1 py-3 text-[13px]">保存条目</InsButton>
                        </div>
                    </div>
                </InsScroll>
            </InsShell>
        );
    }

    return (
        <InsShell accent={AC} wash={false} style={{ background: WB_CANVAS }}>
            <input ref={fileInputRef} type="file" accept=".json,.zip,application/json,application/zip" className="hidden" onChange={handleImportFile} />
            <InsHeader
                accent={AC}
                title="剪报夹"
                en="CLIPBOOK"
                onBack={closeApp}
                right={
                    <div className="flex items-center gap-2">
                        <IconCircle onClick={() => fileInputRef.current?.click()} title="导入世界书"><UploadSimple size={17} weight="bold" /></IconCircle>
                        <InsButton accent={AC} onClick={openCreateBook} disabled={importing} className="px-3 py-2 text-[12px]" icon={<BookOpen size={14} weight="bold" />}>
                            {importing ? '导入中' : '新建世界书'}
                        </InsButton>
                    </div>
                }
            />

            <InsScroll className="px-4 pb-24">
                <div className="space-y-5 pt-2">
                    {renderBookShelf()}

                    {groupedEntries.length === 0 ? (
                        <InsEmpty
                            icon={<NewspaperClipping size={54} weight="thin" />}
                            title="暂无世界书"
                            hint="新建世界书，或导入 SillyTavern 世界书 JSON / ZIP。"
                        />
                    ) : (
                        <>
                            <div>
                                <div className="mb-3 flex items-center justify-between gap-3">
                                    <SectionLabel en="GROUPS" accent={AC}>世界书分组</SectionLabel>
                                </div>
                                <div className="relative">
                                    <MagnifyingGlass size={15} weight="bold" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2" style={{ color: INK_SOFT }} />
                                    <TextInput
                                        value={bookSearch}
                                        onChange={e => setBookSearch(e.target.value)}
                                        placeholder="搜索世界书、条目标题、正文或关键词"
                                        className="pl-10"
                                    />
                                </div>
                                <div className="mt-3 flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                                    <ScopePill active={bookFilter === 'all'} onClick={() => setBookFilter('all')}>全部</ScopePill>
                                    <ScopePill active={bookFilter === 'global'} onClick={() => setBookFilter('global')} tone={SECONDARY}><GlobeSimple size={13} weight="bold" />全局书</ScopePill>
                                    <ScopePill active={bookFilter === 'local'} onClick={() => setBookFilter('local')}><BookOpen size={13} weight="bold" />局部书</ScopePill>
                                    <ScopePill active={bookFilter === 'keyword'} onClick={() => setBookFilter('keyword')} tone={MARK}><Key size={13} weight="bold" />关键词条目</ScopePill>
                                    <ScopePill active={bookFilter === 'disabled'} onClick={() => setBookFilter('disabled')} tone={DANGER}>停用</ScopePill>
                                </div>
                                <div className="mt-2 text-[11px] font-bold" style={{ color: INK_SOFT }}>
                                    显示 {visibleGroupedEntries.length} 本 / {resultEntryCount} 条
                                    {bookFilter !== 'all' ? ` · 筛选：${bookFilter === 'global' ? '全局书' : bookFilter === 'local' ? '局部书' : bookFilter === 'keyword' ? '关键词条目' : '停用'}` : ''}
                                </div>
                                <div className="mt-4 space-y-4">
                                    {visibleGroupedEntries.length > 0 ? (
                                        visibleGroupedEntries.map(renderCategoryPanel)
                                    ) : (
                                        <InsEmpty icon={<FileText size={48} weight="thin" />} title="没有匹配的世界书" hint="换个分类名、条目标题或关键词再试。" />
                                    )}
                                </div>
                                {searchActive && (
                                    <button
                                        type="button"
                                        onClick={() => { setBookSearch(''); setBookFilter('all'); }}
                                        className="mt-3 w-full rounded-[8px] px-3 py-2 text-[12px] font-bold press-soft"
                                        style={{ ...CUTE_STACK, background: '#fbfefe', border: '1px solid #dbe8ef', color: WB_TEXT.faint }}
                                    >
                                        清空搜索和筛选
                                    </button>
                                )}
                            </div>
                        </>
                    )}
                </div>
            </InsScroll>

            <InsDialog
                open={showDeleteConfirm}
                title="删除条目？"
                en="DELETE ENTRY"
                accent="red"
                onClose={() => setShowDeleteConfirm(false)}
                actions={
                    <>
                        <InsButton accent={AC} variant="soft" onClick={() => setShowDeleteConfirm(false)} className="flex-1 py-3 text-[13px]">取消</InsButton>
                        <InsButton accent="red" onClick={confirmDelete} className="flex-1 py-3 text-[13px]">删除</InsButton>
                    </>
                }
            >
                「{editingBook?.title}」会从世界书中删除，并同步移除相关角色挂载。
            </InsDialog>

            <InsDialog
                open={!!deleteCategoryConfirm}
                title="删除世界书？"
                en="DELETE WORLDBOOK"
                accent="red"
                onClose={() => setDeleteCategoryConfirm(null)}
                actions={
                    <>
                        <InsButton accent={AC} variant="soft" onClick={() => setDeleteCategoryConfirm(null)} className="flex-1 py-3 text-[13px]">取消</InsButton>
                        <InsButton accent="red" onClick={confirmDeleteCategory} className="flex-1 py-3 text-[13px]">删除世界书</InsButton>
                    </>
                }
            >
                「{deleteCategoryConfirm?.category}」中的 {deleteCategoryConfirm?.count || 0} 个条目都会被删除，并清理整本开关与相关角色挂载。
            </InsDialog>

            <InsDialog
                open={showNewBookDialog}
                title="新建世界书"
                en="NEW WORLDBOOK"
                accent={AC}
                onClose={() => setShowNewBookDialog(false)}
                actions={
                    <>
                        <InsButton accent={AC} variant="soft" onClick={() => setShowNewBookDialog(false)} className="flex-1 py-3 text-[13px]">取消</InsButton>
                        <InsButton accent={AC} onClick={confirmCreateBook} className="flex-1 py-3 text-[13px]">创建世界书</InsButton>
                    </>
                }
            >
                <div className="space-y-3 text-left">
                    <div>
                        <FieldLabel en="BOOK">世界书名称</FieldLabel>
                        <TextInput value={newBookName} onChange={e => setNewBookName(e.target.value)} placeholder="例如：世界观、人物设定、地点资料" autoFocus />
                    </div>
                    <div>
                        <FieldLabel en="FIRST ENTRY">初始条目标题</FieldLabel>
                        <TextInput value={newBookFirstTitle} onChange={e => setNewBookFirstTitle(e.target.value)} placeholder="例如：分组说明" />
                    </div>
                    <p className="text-[11px] leading-relaxed" style={{ color: INK_SOFT }}>
                        系统以“世界书名称 + 条目”保存数据。创建时会自动生成一个空白条目，之后可编辑内容或继续添加条目。
                    </p>
                </div>
            </InsDialog>
        </InsShell>
    );
};
export default WorldbookApp;
