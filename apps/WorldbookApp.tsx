/**
 * 剪报夹 —— 世界书（Lorebook）管理，黑白拼贴手账风界面。
 *
 * 一条 Worldbook 记录是一条世界书条目；category 分组是一整本世界书。
 * 支持条目/整书开关、局部/全局作用域、插入位置（含 @Depth）、顺序、
 * 关键词触发、SillyTavern 导入信息展示，以及按整本世界书删除。
 */
import React, { useState, useMemo, useRef } from 'react';
import { useOS } from '../context/OSContext';
import { Worldbook, WorldbookPosition } from '../types';
import { Scissors, NotePencil, Trash, NewspaperClipping, X, Key, UploadSimple } from '@phosphor-icons/react';
import { importWorldbookFromFile } from '../utils/worldbookImport';
import { DEFAULT_WB_CATEGORY } from '../utils/worldbookRuntime';

// ── ins 风设计 token（剪报夹 = indigo 强调） ─────────────
const INK = '#26242a';
const STICKER = 'rounded-full bg-white press-soft border border-black/[0.05] shadow-[0_6px_16px_-8px_rgba(38,36,42,0.32)]';
const HAND_CN: React.CSSProperties = { fontFamily: "'Long Cang', 'Caveat', cursive" };
const DOT_PATTERN = 'radial-gradient(120% 80% at 50% -10%, rgba(99,102,241,0.06), transparent 60%)';
const DOT_BG: React.CSSProperties = { background: DOT_PATTERN };
const MODAL_BG: React.CSSProperties = { backgroundColor: '#fff', backgroundImage: DOT_PATTERN };
const RULED_BG: React.CSSProperties = {
    backgroundImage: 'repeating-linear-gradient(transparent, transparent 23px, rgba(38,36,42,0.08) 23px, rgba(38,36,42,0.08) 24px)',
    lineHeight: '24px',
};

const Tape: React.FC<{ className?: string }> = ({ className }) => (
    <div aria-hidden className={`pointer-events-none absolute h-5 w-16 ${className || ''}`}
        style={{ background: 'rgba(255,255,255,0.75)', backgroundImage: 'repeating-linear-gradient(90deg, rgba(255,255,255,0.4) 0 5px, transparent 5px 11px)', borderRadius: 2, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }} />
);

const POSITION_OPTIONS: { value: WorldbookPosition; label: string }[] = [
    { value: 'before_char', label: '角色卡之前（↑CHAR）' },
    { value: 'after_char', label: '角色卡之后（↓CHAR · 默认）' },
    { value: 'depth_system', label: '插入聊天历史 · system（@Depth）' },
    { value: 'depth_user', label: '插入聊天历史 · user（@Depth）' },
    { value: 'depth_assistant', label: '插入聊天历史 · assistant（@Depth）' },
];

const positionLabel = (p?: WorldbookPosition) =>
    POSITION_OPTIONS.find(o => o.value === (p || 'after_char'))?.label || '角色卡之后';

/** 条目/整书共用开关。 */
const InkSwitch: React.FC<{ on: boolean; onChange: (on: boolean) => void; title?: string }> = ({ on, onChange, title }) => (
    <button
        onClick={(e) => { e.stopPropagation(); onChange(!on); }}
        title={title}
        className="relative w-11 h-6 rounded-full shrink-0 transition-colors press-soft"
        style={{ background: on ? '#6366f1' : '#dcd9d3' }}
    >
        <span className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all shadow" style={{ left: on ? 'calc(100% - 1.375rem)' : '0.125rem' }} />
    </button>
);

const WorldbookApp: React.FC = () => {
    const { closeApp, worldbooks, addWorldbook, updateWorldbook, deleteWorldbook, deleteWorldbookCategory, addToast, worldbookGroupToggles, setWorldbookGroupEnabled } = useOS();

    // View State
    const [isEditing, setIsEditing] = useState(false);
    const [editingBook, setEditingBook] = useState<Worldbook | null>(null);
    const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
    const [previewBookId, setPreviewBookId] = useState<string | null>(null);

    // Edit Form State
    const [tempTitle, setTempTitle] = useState('');
    const [tempContent, setTempContent] = useState('');
    const [tempCategory, setTempCategory] = useState('');
    const [tempEnabled, setTempEnabled] = useState(true);
    const [tempScope, setTempScope] = useState<'local' | 'global'>('local');
    const [tempPosition, setTempPosition] = useState<WorldbookPosition>('after_char');
    const [tempDepth, setTempDepth] = useState(4);
    const [tempOrder, setTempOrder] = useState(100);
    // 关键词触发（ST 绿灯条目移植）
    const [tempActivation, setTempActivation] = useState<'always' | 'keyword'>('always');
    const [tempKeys, setTempKeys] = useState('');
    const [tempSecondaryKeys, setTempSecondaryKeys] = useState('');
    const [tempSelective, setTempSelective] = useState(false);
    const [tempCaseSensitive, setTempCaseSensitive] = useState(false);
    const [tempScanDepth, setTempScanDepth] = useState(4);
    // 关键词测试：粘贴一段聊天文本，实时测试本条条目会不会注入。
    const [scanTestText, setScanTestText] = useState('');
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [deleteCategoryConfirm, setDeleteCategoryConfirm] = useState<{ category: string; count: number } | null>(null);

    const parseKeys = (raw: string): string[] =>
        raw.split(/[,，]/).map(s => s.trim()).filter(Boolean);

    /**
     * 与 WorldbookRuntime.isEntryTriggered 同一套判定逻辑的本地演练版：
     * 每行视为一条消息，取最近 scanDepth 行做扫描窗口，返回命中详情。
     */
    const scanTestResult = useMemo(() => {
        if (tempActivation !== 'keyword') return null;
        const keys = parseKeys(tempKeys);
        const secondary = parseKeys(tempSecondaryKeys);
        if (!scanTestText.trim()) return null;
        if (keys.length === 0) return { triggered: false, hitKeys: [], hitSecondary: [], reason: '请先填写主关键词' };

        const lines = scanTestText.replace(/\r\n/g, '\n').split('\n').filter(l => l.trim());
        const depth = Math.max(1, tempScanDepth || 4);
        const hay = lines.slice(-depth).join('\n');
        const hayCmp = tempCaseSensitive ? hay : hay.toLowerCase();
        const hit = (k: string) => hayCmp.includes(tempCaseSensitive ? k : k.toLowerCase());

        const hitKeys = keys.filter(hit);
        const hitSecondary = secondary.filter(hit);
        if (hitKeys.length === 0) {
            return { triggered: false, hitKeys, hitSecondary, reason: `最近 ${Math.min(depth, lines.length)} 条消息未命中主关键词` };
        }
        if (tempSelective && secondary.length > 0 && hitSecondary.length === 0) {
            return { triggered: false, hitKeys, hitSecondary, reason: '已命中主关键词，但未命中二级关键词' };
        }
        return { triggered: true, hitKeys, hitSecondary, reason: '' };
    }, [tempActivation, tempKeys, tempSecondaryKeys, tempSelective, tempCaseSensitive, tempScanDepth, scanTestText]);

    // Grouping Logic
    const groupedBooks = useMemo(() => {
        const groups: Record<string, Worldbook[]> = {};

        worldbooks.forEach(wb => {
            const cat = wb.category || DEFAULT_WB_CATEGORY;
            if (!groups[cat]) groups[cat] = [];
            groups[cat].push(wb);
        });

        return groups;
    }, [worldbooks]);

    const handleCreate = () => {
        setEditingBook(null);
        setTempTitle('');
        setTempContent('');
        setTempCategory(''); // Default empty
        setTempEnabled(true);
        setTempScope('local');
        setTempPosition('after_char');
        setTempDepth(4);
        setTempOrder(100);
        setTempActivation('always');
        setTempKeys('');
        setTempSecondaryKeys('');
        setTempSelective(false);
        setTempCaseSensitive(false);
        setTempScanDepth(4);
        setScanTestText('');
        setIsEditing(true);
    };

    // 导入世界书（.json / .zip）：解析 → 逐条 addWorldbook
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [importing, setImporting] = useState(false);
    const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = ''; // 允许重复选同一文件
        if (!file) return;
        setImporting(true);
        try {
            const books = await importWorldbookFromFile(file);
            if (books.length === 0) { addToast('没解析出任何世界书条目', 'error'); return; }
            for (const wb of books) await addWorldbook(wb);
            addToast(`已导入 ${books.length} 条世界书`, 'success');
        } catch (err: any) {
            addToast(err?.message || '导入失败', 'error');
        } finally {
            setImporting(false);
        }
    };

    const handleEdit = (book: Worldbook) => {
        setEditingBook(book);
        setTempTitle(book.title);
        setTempContent(book.content);
        setTempCategory(book.category || '');
        setTempEnabled(book.enabled !== false);
        setTempScope(book.scope === 'global' ? 'global' : 'local');
        setTempPosition(book.position || 'after_char');
        setTempDepth(typeof book.depth === 'number' ? book.depth : 4);
        setTempOrder(typeof book.order === 'number' ? book.order : 100);
        // 关键词字段缺省时回填 ST 原卡设定（旧导入条目第一次编辑即可接上关键词激活）
        const stEntry = book.stData?.entry;
        setTempActivation(book.activation ?? (stEntry && !stEntry.constant && (stEntry.keys?.length || 0) > 0 ? 'keyword' : 'always'));
        setTempKeys((book.keys ?? stEntry?.keys ?? []).join(', '));
        setTempSecondaryKeys((book.secondaryKeys ?? stEntry?.secondaryKeys ?? []).join(', '));
        setTempSelective(book.selective ?? !!stEntry?.selective);
        setTempCaseSensitive(book.caseSensitive ?? !!stEntry?.caseSensitive);
        setTempScanDepth(typeof book.scanDepth === 'number' ? book.scanDepth : (book.stData?.scanDepth ?? 4));
        setScanTestText('');
        setIsEditing(true);
    };

    const handleSave = async () => {
        if (!tempTitle.trim()) {
            addToast('请填写条目标题', 'error');
            return;
        }

        const category = tempCategory.trim() || DEFAULT_WB_CATEGORY;
        const keys = parseKeys(tempKeys);
        if (tempActivation === 'keyword' && keys.length === 0) {
            addToast('关键词触发模式至少需要 1 个主关键词', 'error');
            return;
        }
        const settings = {
            enabled: tempEnabled,
            scope: tempScope,
            position: tempPosition,
            depth: tempPosition.startsWith('depth_') ? Math.max(0, tempDepth) : undefined,
            order: tempOrder,
            activation: tempActivation,
            keys: keys.length > 0 ? keys : undefined,
            secondaryKeys: parseKeys(tempSecondaryKeys).length > 0 ? parseKeys(tempSecondaryKeys) : undefined,
            selective: tempSelective || undefined,
            caseSensitive: tempCaseSensitive || undefined,
            scanDepth: tempActivation === 'keyword' ? Math.max(1, tempScanDepth) : undefined,
        };

        if (editingBook) {
            await updateWorldbook(editingBook.id, {
                title: tempTitle,
                content: tempContent,
                category: category,
                ...settings,
            });
            addToast('条目已保存，并同步相关角色挂载', 'success');
        } else {
            const newBook: Worldbook = {
                id: `wb-${Date.now()}`,
                title: tempTitle,
                content: tempContent,
                category: category,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                ...settings,
            };
            addWorldbook(newBook);
            addToast('世界书条目已创建', 'success');
        }
        setIsEditing(false);
    };

    const requestDelete = (e: React.MouseEvent, book: Worldbook) => {
        e.stopPropagation();
        setEditingBook(book);
        setShowDeleteConfirm(true);
    };

    const confirmDelete = () => {
        if (editingBook) {
            deleteWorldbook(editingBook.id);
            setShowDeleteConfirm(false);
            setEditingBook(null);
            setIsEditing(false);
        }
    };

    const requestDeleteCategory = (e: React.MouseEvent, category: string, count: number) => {
        e.stopPropagation();
        setDeleteCategoryConfirm({ category, count });
    };

    const confirmDeleteCategory = async () => {
        if (!deleteCategoryConfirm) return;
        await deleteWorldbookCategory(deleteCategoryConfirm.category);
        if (expandedCategory === deleteCategoryConfirm.category) setExpandedCategory(null);
        if (editingBook && (editingBook.category || DEFAULT_WB_CATEGORY) === deleteCategoryConfirm.category) {
            setEditingBook(null);
            setIsEditing(false);
        }
        if (previewBookId) setPreviewBookId(null);
        setDeleteCategoryConfirm(null);
    };

    const toggleCategory = (cat: string) => {
        setExpandedCategory(expandedCategory === cat ? null : cat);
    };

    const togglePreview = (id: string) => {
        setPreviewBookId(previewBookId === id ? null : id);
    };

    // 触发方式标签：常驻（ST constant）或关键词触发。
    const triggerStamp = (book: Worldbook) => book.activation === 'keyword'
        ? <span className="inline-flex items-center gap-0.5"><Key size={10} weight="bold" />关键词</span>
        : <span>常驻</span>;

    // ── 编辑页（全屏纸面） ────────────────────────────────
    if (isEditing) {
        return (
            <div className="h-full w-full bg-[#f7f5f2] text-[#26242a] flex flex-col animate-fade-in" style={{ ...DOT_BG, paddingTop: 'var(--safe-top)' }}>
                <div className="relative flex items-center gap-3 px-4 pt-3 pb-3 border-b-2 border-dashed border-[#1c1b1a]/30 shrink-0">
                    <button onClick={() => setIsEditing(false)} className={`px-2.5 py-2 rotate-[-2deg] text-[10px] font-black ${STICKER}`}>
                        取消
                    </button>
                    <div className="flex-1 min-w-0">
                        <div className="label-mono text-[8px] text-[#26242a]/45">{editingBook ? 'EDIT ENTRY' : 'NEW ENTRY'}</div>
                        <h2 className="text-lg font-black tracking-wide truncate">{editingBook ? '编辑世界书条目' : '新建世界书条目'}</h2>
                    </div>
                    <button
                        onClick={handleSave}
                        className="px-4 py-2 text-xs font-black bg-[#1c1b1a] text-white border border-black/10 rounded-xl shadow-[0_12px_24px_-12px_rgba(38,36,42,0.45)] press-soft rotate-[1.5deg]"
                    >
                        保存
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto no-scrollbar p-4 space-y-5">
                    <div>
                        <label className="label-mono text-[8px] text-[#26242a]/45 block">条目标题 / TITLE</label>
                        <input
                            value={tempTitle}
                            onChange={e => setTempTitle(e.target.value)}
                            placeholder="比如：魔法体系、公司背景…"
                            className="w-full bg-transparent border-b-2 border-[#1c1b1a] py-1.5 text-base font-black outline-none focus:border-dashed placeholder:text-[#26242a]/25"
                        />
                    </div>

                    <div>
                        <label className="label-mono text-[8px] text-[#26242a]/45 block">所属世界书 / CATEGORY</label>
                        <input
                            value={tempCategory}
                            onChange={e => setTempCategory(e.target.value)}
                            placeholder="比如：世界观、人物、地理…"
                            className="w-full bg-transparent border-b border-dashed border-[#1c1b1a]/50 py-1.5 text-sm outline-none focus:border-[#1c1b1a] placeholder:text-[#26242a]/25"
                            list="category-suggestions"
                        />
                        <datalist id="category-suggestions">
                            {Object.keys(groupedBooks).map(cat => (
                                <option key={cat} value={cat} />
                            ))}
                        </datalist>
                        <p className="text-[12px] text-[#26242a]/55 mt-1 leading-relaxed" style={HAND_CN}>相同分类名会归入同一本世界书。</p>
                    </div>

                    {/* 条目级设置：开关 / 作用域 / 位置 / 深度 / 顺序 */}
                    <div className="relative bg-white border border-black/10 rounded-xl shadow-[0_12px_24px_-12px_rgba(38,36,42,0.45)] p-4 space-y-4">
                        <Tape className="-top-2.5 left-6 rotate-[-4deg]" />
                        <div className="flex items-center justify-between">
                            <div>
                                <label className="text-[11px] font-black block">条目开关</label>
                                <p className="text-[12px] text-[#26242a]/50 mt-0.5" style={HAND_CN}>关闭后，这条条目不会注入任何聊天上下文。</p>
                            </div>
                            <InkSwitch on={tempEnabled} onChange={setTempEnabled} />
                        </div>

                        <div>
                            <label className="label-mono text-[8px] text-[#26242a]/45 mb-1.5 block">作用域 / SCOPE</label>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setTempScope('local')}
                                    className={`flex-1 py-2 text-[10px] font-black border border-black/10 rounded-xl transition-all rotate-[-0.5deg] ${tempScope === 'local' ? 'bg-[#1c1b1a] text-white shadow-[0_12px_24px_-12px_rgba(38,36,42,0.45)]' : 'bg-white shadow-[0_12px_24px_-12px_rgba(38,36,42,0.45)]'}`}
                                >
                                    局部（需挂载）
                                </button>
                                <button
                                    onClick={() => setTempScope('global')}
                                    className={`flex-1 py-2 text-[10px] font-black border border-black/10 rounded-xl transition-all rotate-[0.5deg] ${tempScope === 'global' ? 'bg-[#1c1b1a] text-white shadow-[0_12px_24px_-12px_rgba(38,36,42,0.45)]' : 'bg-white shadow-[0_12px_24px_-12px_rgba(38,36,42,0.45)]'}`}
                                >
                                    全局（自动生效）
                                </button>
                            </div>
                            <p className="text-[12px] text-[#26242a]/55 mt-1.5 leading-relaxed" style={HAND_CN}>
                                局部条目需要在聊天设置中挂载对应世界书后才会注入；全局条目会在所有聊天中自动注入。局部和全局同时生效时，局部内容排在全局内容前。
                            </p>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div className={tempPosition.startsWith('depth_') ? '' : 'col-span-2'}>
                                <label className="label-mono text-[8px] text-[#26242a]/45 mb-1.5 block">注入位置 / POSITION</label>
                                <div className="relative">
                                    <select
                                        value={tempPosition}
                                        onChange={e => setTempPosition(e.target.value as WorldbookPosition)}
                                        className="w-full appearance-none bg-white border border-black/10 rounded-xl/60 px-3 py-2 text-xs font-bold outline-none focus:border-[#1c1b1a]"
                                    >
                                        {POSITION_OPTIONS.map(o => (
                                            <option key={o.value} value={o.value}>{o.label}</option>
                                        ))}
                                    </select>
                                    <span aria-hidden className="absolute right-3 top-1/2 -translate-y-1/2 text-xs pointer-events-none">▾</span>
                                </div>
                            </div>
                            {tempPosition.startsWith('depth_') && (
                                <div>
                                    <label className="label-mono text-[8px] text-[#26242a]/45 mb-1.5 block">Depth 值</label>
                                    <input
                                        type="number" min={0}
                                        value={tempDepth}
                                        onChange={e => setTempDepth(parseInt(e.target.value) || 0)}
                                        className="w-full bg-white border border-black/10 rounded-xl/60 px-3 py-2 text-xs font-bold outline-none focus:border-[#1c1b1a]"
                                    />
                                </div>
                            )}
                        </div>

                        <div>
                            <label className="label-mono text-[8px] text-[#26242a]/45 mb-1.5 block">先后顺序 / ORDER</label>
                            <input
                                type="number"
                                value={tempOrder}
                                onChange={e => setTempOrder(parseInt(e.target.value) || 0)}
                                className="w-full bg-white border border-black/10 rounded-xl/60 px-3 py-2 text-xs font-bold outline-none focus:border-[#1c1b1a]"
                            />
                            <p className="text-[12px] text-[#26242a]/55 mt-1 leading-relaxed" style={HAND_CN}>
                                同一注入位置内，数字小的条目排在前面（与 SillyTavern 最终生效顺序一致）。@Depth 会把条目插入聊天历史倒数第 N 条处（0 = 最末尾）。
                            </p>
                        </div>

                        {/* 触发方式（ST 蓝灯/绿灯移植） */}
                        <div>
                            <label className="label-mono text-[8px] text-[#26242a]/45 mb-1.5 block">触发方式 / TRIGGER</label>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setTempActivation('always')}
                                    className={`flex-1 py-2 text-[10px] font-black border border-black/10 rounded-xl transition-all rotate-[-0.5deg] ${tempActivation === 'always' ? 'bg-[#1c1b1a] text-white shadow-[0_12px_24px_-12px_rgba(38,36,42,0.45)]' : 'bg-white shadow-[0_12px_24px_-12px_rgba(38,36,42,0.45)]'}`}
                                >
                                    常驻（每次注入）
                                </button>
                                <button
                                    onClick={() => setTempActivation('keyword')}
                                    className={`flex-1 py-2 text-[10px] font-black border border-black/10 rounded-xl transition-all rotate-[0.5deg] flex items-center justify-center gap-1 ${tempActivation === 'keyword' ? 'bg-[#1c1b1a] text-white shadow-[0_12px_24px_-12px_rgba(38,36,42,0.45)]' : 'bg-white shadow-[0_12px_24px_-12px_rgba(38,36,42,0.45)]'}`}
                                >
                                    <Key size={11} weight="bold" /> 关键词触发
                                </button>
                            </div>
                            <p className="text-[12px] text-[#26242a]/55 mt-1.5 leading-relaxed" style={HAND_CN}>
                                常驻：开关开启时每次注入（ST 蓝灯）。关键词触发：扫描最近聊天消息，命中关键词后才注入（ST 绿灯），适合按需启用的大段设定。
                            </p>
                        </div>

                        {tempActivation === 'keyword' && (
                            <div className="space-y-3 border-2 border-dashed border-[#1c1b1a]/40 p-3">
                                <div>
                                    <label className="label-mono text-[8px] text-[#26242a]/45 mb-1.5 block">主关键词（逗号分隔，命中任意一个即可触发）</label>
                                    <input
                                        value={tempKeys}
                                        onChange={e => setTempKeys(e.target.value)}
                                        placeholder="比如：魔法, 咒语, 法术"
                                        className="w-full bg-white border border-black/10 rounded-xl/60 px-3 py-2 text-xs outline-none focus:border-[#1c1b1a] placeholder:text-[#26242a]/25"
                                    />
                                </div>
                                <div>
                                    <label className="label-mono text-[8px] text-[#26242a]/45 mb-1.5 block">二级关键词（可选，逗号分隔）</label>
                                    <input
                                        value={tempSecondaryKeys}
                                        onChange={e => setTempSecondaryKeys(e.target.value)}
                                        placeholder="比如：学院, 导师"
                                        className="w-full bg-white border border-black/10 rounded-xl/60 px-3 py-2 text-xs outline-none focus:border-[#1c1b1a] placeholder:text-[#26242a]/25"
                                    />
                                </div>
                                <div className="flex items-center justify-between">
                                    <div>
                                        <label className="text-[11px] font-black block">要求同时命中二级关键词</label>
                                        <p className="text-[12px] text-[#26242a]/50 mt-0.5" style={HAND_CN}>开启后，需要主关键词 + 任一二级关键词同时命中（Selective）。</p>
                                    </div>
                                    <InkSwitch on={tempSelective} onChange={setTempSelective} />
                                </div>
                                <div className="flex items-center justify-between">
                                    <label className="text-[11px] font-black">关键词区分大小写</label>
                                    <InkSwitch on={tempCaseSensitive} onChange={setTempCaseSensitive} />
                                </div>
                                <div>
                                    <label className="label-mono text-[8px] text-[#26242a]/45 mb-1.5 block">回看几条消息（扫描深度）</label>
                                    <input
                                        type="number" min={1}
                                        value={tempScanDepth}
                                        onChange={e => setTempScanDepth(parseInt(e.target.value) || 1)}
                                        className="w-full bg-white border border-black/10 rounded-xl/60 px-3 py-2 text-xs font-bold outline-none focus:border-[#1c1b1a]"
                                    />
                                </div>

                                {/* 关键词测试：和聊天注入用同一套判定逻辑，编辑时即可验证。 */}
                                <div className="pt-2 border-t border-dashed border-[#1c1b1a]/30">
                                    <label className="label-mono text-[8px] text-[#26242a]/45 mb-1.5 block">关键词测试（每行视为一条消息）</label>
                                    <textarea
                                        value={scanTestText}
                                        onChange={e => setScanTestText(e.target.value)}
                                        placeholder={'比如：\n今晚的月色真好\n要不要一起去学魔法？'}
                                        className="w-full h-20 bg-white border border-black/10 rounded-xl/60 px-3 py-2 text-xs outline-none focus:border-[#1c1b1a] resize-none placeholder:text-[#26242a]/25"
                                    />
                                    {scanTestResult && (
                                        <div className={`mt-2 px-3 py-2 text-[11px] leading-relaxed border-2 ${scanTestResult.triggered ? 'border-[#1c1b1a] bg-[#1c1b1a] text-white' : 'border-dashed border-[#1c1b1a]/60 bg-white'}`}>
                                            <div className="font-black mb-0.5">{scanTestResult.triggered ? '✓ 会注入该条目' : '✗ 不会注入该条目'}</div>
                                            {scanTestResult.hitKeys.length > 0 && (
                                                <div>命中的主关键词：{scanTestResult.hitKeys.join('、')}</div>
                                            )}
                                            {scanTestResult.hitSecondary.length > 0 && (
                                                <div>命中的二级关键词：{scanTestResult.hitSecondary.join('、')}</div>
                                            )}
                                            {!scanTestResult.triggered && <div>{scanTestResult.reason}</div>}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="pb-6">
                        <label className="label-mono text-[8px] text-[#26242a]/45 mb-1.5 block">条目内容 / CONTENT</label>
                        <textarea
                            value={tempContent}
                            onChange={e => setTempContent(e.target.value)}
                            placeholder="填写要注入聊天上下文的设定内容，可使用 Markdown。"
                            className="w-full h-72 bg-white border border-black/10 rounded-xl/60 px-3 py-0 text-xs resize-none outline-none focus:border-[#1c1b1a] placeholder:text-[#26242a]/25"
                            style={RULED_BG}
                        />
                    </div>
                </div>
            </div>
        );
    }

    // ── 列表页（世界书 + 条目） ───────────────────────────
    return (
        <div className="h-full w-full relative overflow-hidden bg-[#f7f5f2] text-[#26242a] flex flex-col animate-fade-in" style={{ ...DOT_BG, paddingTop: 'var(--safe-top)' }}>
            {/* 刊头 */}
            <div className="relative shrink-0 px-4 pt-3 pb-3 border-b-2 border-dashed border-[#1c1b1a]/30">
                <div className="flex items-center gap-3">
                    <button onClick={closeApp} className={`shrink-0 px-2.5 py-2 rotate-[-2deg] flex items-center gap-1 ${STICKER}`} title="关闭剪报夹">
                        <svg viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth={2.5} className="w-3.5 h-3.5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
                        </svg>
                        <span className="text-[10px] font-black">返回</span>
                    </button>
                    <div className="flex-1 min-w-0 relative">
                        <Tape className="-top-4 left-8 rotate-[-5deg] w-12" />
                        <div className="label-mono text-[8px] text-[#26242a]/45">WORLDBOOK MANAGER</div>
                        <div className="flex items-baseline gap-2">
                            <h1 className="text-2xl font-black tracking-[0.08em]">剪报夹</h1>
                            <span className="text-sm text-[#26242a]/55 truncate" style={HAND_CN}>管理世界书分组、条目开关、关键词触发和注入位置</span>
                        </div>
                    </div>
                    <div className="shrink-0 w-12 h-12 rounded-full border-2 border-dashed border-[#1c1b1a]/60 flex flex-col items-center justify-center rotate-[6deg] select-none">
                        <span className="text-base font-black leading-none">{worldbooks.length}</span>
                        <span className="label-mono text-[7px] text-[#26242a]/55 leading-none mt-0.5">条</span>
                    </div>
                </div>
            </div>

            {/* 世界书列表 */}
            <div className="flex-1 overflow-y-auto no-scrollbar p-4 pb-28 space-y-5">
                {Object.keys(groupedBooks).length === 0 && (
                    <div className="relative bg-white border border-black/10 rounded-xl shadow-[0_12px_24px_-12px_rgba(38,36,42,0.45)] p-6 rotate-[-0.6deg] text-center space-y-2">
                        <Tape className="-top-2.5 left-1/2 -translate-x-1/2 rotate-[2deg]" />
                        <NewspaperClipping size={36} weight="bold" className="mx-auto text-[#26242a]/40" />
                        <p className="text-lg" style={HAND_CN}>暂无世界书条目</p>
                        <p className="text-xs text-[#26242a]/55 leading-relaxed">点击右下角“新建条目”，或导入 .json / .zip 世界书文件。</p>
                    </div>
                )}

                {Object.entries(groupedBooks).map(([category, books]) => {
                    const bookEnabled = worldbookGroupToggles[category] !== false;
                    const open = expandedCategory === category;
                    return (
                        <div key={category} className={`animate-slide-up transition-opacity ${bookEnabled ? '' : 'opacity-55'}`}>
                            {/* 世界书标题行（分组 = 一本世界书） */}
                            <div
                                onClick={() => toggleCategory(category)}
                                className={`relative bg-white border border-black/10 rounded-xl px-3 py-2.5 flex items-center gap-2 cursor-pointer select-none ${open ? 'shadow-none translate-x-[2px] translate-y-[2px]' : 'shadow-[0_12px_24px_-12px_rgba(38,36,42,0.45)]'} transition-all`}
                            >
                                <span className={`text-sm font-black transition-transform inline-block ${open ? 'rotate-90' : ''}`}>▸</span>
                                <h3 className="text-sm font-black truncate">{category}</h3>
                                <span className="label-mono text-[8px] border border-[#1c1b1a]/50 px-1 py-0.5 shrink-0">{books.length} 条</span>
                                {!bookEnabled && <span className="label-mono text-[8px] bg-[#1c1b1a] text-white px-1.5 py-0.5 rotate-[-2deg] shrink-0">整书停用</span>}
                                <div className="ml-auto flex items-center gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
                                    <button
                                        onClick={(e) => requestDeleteCategory(e, category, books.length)}
                                        className={`p-1.5 rotate-[2deg] ${STICKER}`}
                                        title="删除整本世界书"
                                    >
                                        <Trash size={13} weight="bold" color={INK} />
                                    </button>
                                    <span className="text-[11px] text-[#26242a]/50" style={HAND_CN}>整书</span>
                                    <InkSwitch
                                        on={bookEnabled}
                                        onChange={(on) => { setWorldbookGroupEnabled(category, on); addToast(on ? `「${category}」已启用` : `「${category}」已停用（该书所有条目暂停注入）`, 'info'); }}
                                        title="关闭后，这本世界书的所有条目（包括全局条目）都不会注入"
                                    />
                                </div>
                            </div>

                            {/* 世界书条目 */}
                            <div className={`space-y-3 pl-3 border-l-2 border-dashed border-[#1c1b1a]/30 ml-2 transition-all duration-300 overflow-hidden ${open ? 'max-h-[1000px] opacity-100 mt-3 pb-1' : 'max-h-0 opacity-0'}`}>
                                {books.map((book, i) => (
                                    <div key={book.id} className={`relative bg-white border border-black/10 rounded-xl/45 shadow-sm ${i % 2 === 0 ? 'rotate-[-0.3deg]' : 'rotate-[0.3deg]'}`}>
                                        {/* 条目头 */}
                                        <div
                                            onClick={() => togglePreview(book.id)}
                                            className="p-3 cursor-pointer flex items-start gap-2"
                                        >
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <h4 className={`text-sm font-black truncate ${book.enabled === false ? 'text-[#26242a]/35 line-through decoration-2' : ''}`}>{book.title}</h4>
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            const next = book.scope === 'global' ? 'local' : 'global';
                                                            updateWorldbook(book.id, { scope: next });
                                                            addToast(next === 'global' ? `「${book.title}」已设为全局条目` : `「${book.title}」已设为局部条目（需挂载世界书）`, 'info');
                                                        }}
                                                        title="切换局部 / 全局作用域"
                                                        className={`label-mono text-[8px] px-1.5 py-0.5 border shrink-0 transition-colors ${book.scope === 'global' ? 'bg-[#1c1b1a] text-white border-[#1c1b1a]' : 'bg-white text-[#26242a]/70 border-[#1c1b1a]/50'}`}
                                                    >
                                                        {book.scope === 'global' ? '全局' : '局部'}
                                                    </button>
                                                </div>
                                                <div className="label-mono text-[8px] text-[#26242a]/45 truncate flex items-center gap-1.5">
                                                    {triggerStamp(book)}
                                                    <span>· {positionLabel(book.position)} · 顺序 {book.order ?? 100} · {new Date(book.updatedAt).toLocaleDateString()}</span>
                                                </div>
                                                {book.activation === 'keyword' && (book.keys?.length || 0) > 0 && (
                                                    <div className="text-[11px] text-[#26242a]/50 truncate mt-0.5" style={HAND_CN}>
                                                        关键词：{book.keys!.slice(0, 3).join(' / ')}{book.keys!.length > 3 ? '…' : ''}
                                                    </div>
                                                )}
                                            </div>

                                            <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                                                <InkSwitch
                                                    on={book.enabled !== false}
                                                    onChange={(on) => updateWorldbook(book.id, { enabled: on })}
                                                    title="条目开关"
                                                />
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); handleEdit(book); }}
                                                    className={`p-1.5 ${STICKER}`}
                                                    title="编辑条目"
                                                >
                                                    <NotePencil size={13} weight="bold" color={INK} />
                                                </button>
                                                <button
                                                    onClick={(e) => requestDelete(e, book)}
                                                    className={`p-1.5 rotate-[2deg] ${STICKER}`}
                                                    title="删除条目"
                                                >
                                                    <Trash size={13} weight="bold" color={INK} />
                                                </button>
                                            </div>
                                        </div>

                                        {/* 展开的条目正文 */}
                                        {previewBookId === book.id && (
                                            <div className="px-3 pb-3 pt-0 animate-fade-in">
                                                <div className="border-t border-dashed border-[#1c1b1a]/30 mb-2.5" />
                                                {/* SillyTavern 导入条目：展示原卡设置。关键词激活现已由 WorldbookRuntime 执行
                                                    （新导入自动启用；旧导入条目在编辑器里保存一次即可接上） */}
                                                {book.source === 'sillytavern' && (
                                                    <div className="mb-2.5 flex flex-wrap gap-1.5 label-mono text-[8px]">
                                                        <span className="px-1.5 py-0.5 bg-[#1c1b1a] text-white rotate-[-1deg]">ST 导入</span>
                                                        {book.stData?.entry && (
                                                            <>
                                                                <span className="px-1.5 py-0.5 border border-[#1c1b1a]/40 text-[#26242a]/70">
                                                                    {book.stData.entry.constant ? '常驻 (constant)' : '关键词触发'}
                                                                </span>
                                                                {book.stData.entry.enabled === false && (
                                                                    <span className="px-1.5 py-0.5 border border-[#1c1b1a] bg-white line-through">原卡停用</span>
                                                                )}
                                                                {(book.stData.entry.keys?.length || 0) > 0 && (
                                                                    <span className="px-1.5 py-0.5 border border-[#1c1b1a]/40 text-[#26242a]/70">关键词: {book.stData.entry.keys!.join(', ')}</span>
                                                                )}
                                                                {(book.stData.entry.secondaryKeys?.length || 0) > 0 && (
                                                                    <span className="px-1.5 py-0.5 border border-[#1c1b1a]/40 text-[#26242a]/70">二级关键词: {book.stData.entry.secondaryKeys!.join(', ')}</span>
                                                                )}
                                                                {book.stData.entry.insertionOrder !== undefined && (
                                                                    <span className="px-1.5 py-0.5 border border-[#1c1b1a]/40 text-[#26242a]/70">顺序: {book.stData.entry.insertionOrder}</span>
                                                                )}
                                                                {book.stData.entry.position !== undefined && (
                                                                    <span className="px-1.5 py-0.5 border border-[#1c1b1a]/40 text-[#26242a]/70">位置: {String(book.stData.entry.position)}</span>
                                                                )}
                                                            </>
                                                        )}
                                                        {book.stData?.bookName && (
                                                            <span className="px-1.5 py-0.5 border border-[#1c1b1a]/40 text-[#26242a]/70">原书: {book.stData.bookName}</span>
                                                        )}
                                                        {book.stData?.scanDepth !== undefined && (
                                                            <span className="px-1.5 py-0.5 border border-[#1c1b1a]/40 text-[#26242a]/70">scan_depth: {book.stData.scanDepth}</span>
                                                        )}
                                                        {book.stData?.tokenBudget !== undefined && (
                                                            <span className="px-1.5 py-0.5 border border-[#1c1b1a]/40 text-[#26242a]/70">token_budget: {book.stData.tokenBudget}</span>
                                                        )}
                                                        {book.stData?.recursiveScanning !== undefined && (
                                                            <span className="px-1.5 py-0.5 border border-[#1c1b1a]/40 text-[#26242a]/70">递归扫描: {book.stData.recursiveScanning ? '开' : '关'}</span>
                                                        )}
                                                    </div>
                                                )}
                                                <p className="text-xs text-[#26242a]/75 leading-relaxed whitespace-pre-wrap select-text">
                                                    {book.content || <span className="italic text-[#26242a]/35">该条目暂无内容</span>}
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* 导入世界书（.json / .zip）：新建按钮上方的贴纸 */}
            <input ref={fileInputRef} type="file" accept=".json,.zip,application/json,application/zip" className="hidden" onChange={handleImportFile} />
            <button
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
                className="absolute bottom-[4.7rem] right-5 z-20 px-4 py-2.5 rotate-[2deg] flex items-center gap-1.5 bg-white text-[#26242a] border border-black/10 rounded-xl shadow-[0_12px_24px_-12px_rgba(38,36,42,0.45)] press-soft disabled:opacity-50"
                title="导入世界书（.json 或 .zip 压缩包）"
            >
                <UploadSimple size={15} weight="bold" />
                <span className="text-xs font-black">{importing ? '导入中…' : '导入'}</span>
            </button>

            {/* 新建条目：右下角剪刀贴纸（替代原顶栏 + 号） */}
            <button
                onClick={handleCreate}
                className="absolute bottom-7 right-5 z-20 px-4 py-3 rotate-[-3deg] flex items-center gap-1.5 bg-[#1c1b1a] text-white border border-black/10 rounded-xl shadow-[0_12px_24px_-12px_rgba(38,36,42,0.45)] press-soft"
                title="新建世界书条目"
            >
                <Scissors size={16} weight="bold" />
                <span className="text-xs font-black">新建条目</span>
            </button>

            {/* 删除条目确认 */}
            {showDeleteConfirm && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-5 animate-fade-in">
                    <div className="absolute inset-0 z-0 bg-black/40" onClick={() => setShowDeleteConfirm(false)} />
                    <div className="relative z-10 w-full max-w-sm bg-white border border-black/10 rounded-xl shadow-[0_12px_24px_-12px_rgba(38,36,42,0.45)] rotate-[-0.4deg] animate-slide-up" style={MODAL_BG}>
                        <Tape className="-top-2.5 left-1/2 -translate-x-1/2 rotate-[-3deg]" />
                        <button
                            onClick={() => setShowDeleteConfirm(false)}
                            className={`absolute -top-3 -right-3 w-8 h-8 flex items-center justify-center rotate-[4deg] ${STICKER}`}
                            aria-label="关闭"
                        >
                            <X size={14} weight="bold" color={INK} />
                        </button>
                        <div className="px-5 pt-6 pb-2">
                            <div className="label-mono text-[9px] text-[#26242a]/45">DELETE ENTRY / 不可恢复</div>
                            <h3 className="text-lg font-black tracking-wide mt-0.5">删除这条世界书条目？</h3>
                            <div className="h-[3px] w-14 bg-[#1c1b1a] mt-1.5" />
                        </div>
                        <div className="px-5 py-3 text-sm text-[#26242a]/70 leading-relaxed">
                            「{editingBook?.title}」会从世界书库中删除，并同步移除相关角色挂载。
                        </div>
                        <div className="px-5 pb-5 pt-2 flex gap-3">
                            <button onClick={() => setShowDeleteConfirm(false)} className={`flex-1 py-2.5 text-xs font-black ${STICKER}`}>取消</button>
                            <button
                                onClick={confirmDelete}
                                className="flex-1 py-2.5 text-xs font-black bg-[#1c1b1a] text-white border border-black/10 rounded-xl shadow-[0_12px_24px_-12px_rgba(38,36,42,0.45)] press-soft"
                            >
                                删除条目
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 删除整本世界书确认 */}
            {deleteCategoryConfirm && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-5 animate-fade-in">
                    <div className="absolute inset-0 z-0 bg-black/40" onClick={() => setDeleteCategoryConfirm(null)} />
                    <div className="relative z-10 w-full max-w-sm bg-white border border-black/10 rounded-xl shadow-[0_12px_24px_-12px_rgba(38,36,42,0.45)] rotate-[-0.4deg] animate-slide-up" style={MODAL_BG}>
                        <Tape className="-top-2.5 left-1/2 -translate-x-1/2 rotate-[-3deg]" />
                        <button
                            onClick={() => setDeleteCategoryConfirm(null)}
                            className={`absolute -top-3 -right-3 w-8 h-8 flex items-center justify-center rotate-[4deg] ${STICKER}`}
                            aria-label="关闭"
                        >
                            <X size={14} weight="bold" color={INK} />
                        </button>
                        <div className="px-5 pt-6 pb-2">
                            <div className="label-mono text-[9px] text-[#26242a]/45">DELETE BOOK / 不可恢复</div>
                            <h3 className="text-lg font-black tracking-wide mt-0.5">删除整本世界书？</h3>
                            <div className="h-[3px] w-14 bg-[#1c1b1a] mt-1.5" />
                        </div>
                        <div className="px-5 py-3 text-sm text-[#26242a]/70 leading-relaxed space-y-2">
                            <p>「{deleteCategoryConfirm.category}」中的 {deleteCategoryConfirm.count} 条条目都会被删除。</p>
                            <p>该操作也会清理整书开关，并从相关角色挂载中移除这本世界书。</p>
                        </div>
                        <div className="px-5 pb-5 pt-2 flex gap-3">
                            <button onClick={() => setDeleteCategoryConfirm(null)} className={`flex-1 py-2.5 text-xs font-black ${STICKER}`}>取消</button>
                            <button
                                onClick={confirmDeleteCategory}
                                className="flex-1 py-2.5 text-xs font-black bg-[#1c1b1a] text-white border border-black/10 rounded-xl shadow-[0_12px_24px_-12px_rgba(38,36,42,0.45)] press-soft"
                            >
                                删除整本
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default WorldbookApp;
