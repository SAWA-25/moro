import React, { useState, useMemo } from 'react';
import { useOS } from '../context/OSContext';
import { Worldbook, WorldbookPosition } from '../types';
import Modal from '../components/os/Modal';
import { DiamondsFour, BookOpen } from '@phosphor-icons/react';

const POSITION_OPTIONS: { value: WorldbookPosition; label: string }[] = [
    { value: 'before_char', label: '角色定义前 (↑Char)' },
    { value: 'after_char', label: '角色定义后 (↓Char · 默认)' },
    { value: 'depth_system', label: '@深度 · 系统 (@D System)' },
    { value: 'depth_user', label: '@深度 · 用户 (@D User)' },
    { value: 'depth_assistant', label: '@深度 · AI (@D Assistant)' },
];

const positionLabel = (p?: WorldbookPosition) =>
    POSITION_OPTIONS.find(o => o.value === (p || 'after_char'))?.label || '角色定义后';

/** 小型开关（条目/整书共用） */
const MiniToggle: React.FC<{ on: boolean; onChange: (on: boolean) => void; title?: string }> = ({ on, onChange, title }) => (
    <button
        onClick={(e) => { e.stopPropagation(); onChange(!on); }}
        title={title}
        className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${on ? 'bg-indigo-500' : 'bg-slate-300'}`}
    >
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${on ? 'left-[18px]' : 'left-0.5'}`}></span>
    </button>
);

const WorldbookApp: React.FC = () => {
    const { closeApp, worldbooks, addWorldbook, updateWorldbook, deleteWorldbook, addToast, worldbookGroupToggles, setWorldbookGroupEnabled } = useOS();

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
    // 关键词激活（ST 绿灯条目移植）
    const [tempActivation, setTempActivation] = useState<'always' | 'keyword'>('always');
    const [tempKeys, setTempKeys] = useState('');
    const [tempSecondaryKeys, setTempSecondaryKeys] = useState('');
    const [tempSelective, setTempSelective] = useState(false);
    const [tempCaseSensitive, setTempCaseSensitive] = useState(false);
    const [tempScanDepth, setTempScanDepth] = useState(4);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    const parseKeys = (raw: string): string[] =>
        raw.split(/[,，]/).map(s => s.trim()).filter(Boolean);

    // Grouping Logic
    const groupedBooks = useMemo(() => {
        const groups: Record<string, Worldbook[]> = {};
        const defaultCat = '未分类设定 (General)';
        
        worldbooks.forEach(wb => {
            const cat = wb.category || defaultCat;
            if (!groups[cat]) groups[cat] = [];
            groups[cat].push(wb);
        });
        
        // Auto-expand the first category if none selected and groups exist
        if (!expandedCategory && Object.keys(groups).length > 0) {
            // setExpandedCategory(Object.keys(groups)[0]); // Optional: Auto open first
        }
        
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
        setIsEditing(true);
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
        setIsEditing(true);
    };

    const handleSave = async () => {
        if (!tempTitle.trim()) {
            addToast('请输入标题', 'error');
            return;
        }

        const category = tempCategory.trim() || '未分类设定 (General)';
        const keys = parseKeys(tempKeys);
        if (tempActivation === 'keyword' && keys.length === 0) {
            addToast('关键词触发模式至少需要一个关键词', 'error');
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
            addToast('已保存 (同步至相关角色)', 'success');
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
            addToast('新条目已创建', 'success');
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
            // Toast logic handled in Context
            setShowDeleteConfirm(false);
            setEditingBook(null);
            setIsEditing(false);
        }
    };

    const toggleCategory = (cat: string) => {
        setExpandedCategory(expandedCategory === cat ? null : cat);
    };

    const togglePreview = (id: string) => {
        setPreviewBookId(previewBookId === id ? null : id);
    };

    // --- Render ---

    // EDIT MODAL (Full Screen Overlay Style)
    if (isEditing) {
        return (
            <div className="h-full w-full bg-slate-50 flex flex-col font-sans animate-fade-in">
                <div className="h-16 flex items-center justify-between px-4 bg-white/80 backdrop-blur-md border-b border-slate-200 shrink-0 z-20">
                    <button onClick={() => setIsEditing(false)} className="px-3 py-1 text-slate-500 font-bold text-sm">取消</button>
                    <span className="font-bold text-slate-800">{editingBook ? '编辑条目' : '新建条目'}</span>
                    <button onClick={handleSave} className="px-4 py-1.5 bg-indigo-500 text-white rounded-full text-xs font-bold shadow-md active:scale-95 transition-transform">保存</button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    <div className="space-y-4">
                        <div>
                            <label className="text-xs font-bold text-slate-400 uppercase mb-2 block tracking-wider">标题 (Title)</label>
                            <input 
                                value={tempTitle}
                                onChange={e => setTempTitle(e.target.value)}
                                placeholder="例如: 魔法体系、公司背景..." 
                                className="w-full text-lg font-bold text-slate-800 bg-white border border-slate-200 rounded-xl px-4 py-3 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all"
                            />
                        </div>

                        <div>
                            <label className="text-xs font-bold text-slate-400 uppercase mb-2 block tracking-wider">分组 (Group)</label>
                            <div className="relative">
                                <input 
                                    value={tempCategory}
                                    onChange={e => setTempCategory(e.target.value)}
                                    placeholder="例如: 世界观、人物、地理..." 
                                    className="w-full text-sm text-slate-700 bg-white border border-slate-200 rounded-xl px-4 py-3 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all"
                                    list="category-suggestions"
                                />
                                <datalist id="category-suggestions">
                                    {Object.keys(groupedBooks).map(cat => (
                                        <option key={cat} value={cat} />
                                    ))}
                                </datalist>
                            </div>
                            <p className="text-[10px] text-slate-400 mt-1 pl-1">输入相同名称可自动归入已有分组（同一分组 = 同一本世界书）。</p>
                        </div>

                        {/* 条目级设置：开关 / 作用域 / 位置 / 深度 / 顺序 */}
                        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <label className="text-xs font-bold text-slate-500 block">条目开关 (Enabled)</label>
                                    <p className="text-[10px] text-slate-400 mt-0.5">关闭后任何场景都不会注入此条目</p>
                                </div>
                                <MiniToggle on={tempEnabled} onChange={setTempEnabled} />
                            </div>

                            <div>
                                <label className="text-xs font-bold text-slate-500 mb-1.5 block">作用域 (Scope)</label>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => setTempScope('local')}
                                        className={`flex-1 py-2 rounded-lg text-xs font-bold border transition-all ${tempScope === 'local' ? 'bg-indigo-500 text-white border-indigo-500 shadow-sm' : 'bg-slate-50 text-slate-500 border-slate-200'}`}
                                    >
                                        局部 (需角色挂载)
                                    </button>
                                    <button
                                        onClick={() => setTempScope('global')}
                                        className={`flex-1 py-2 rounded-lg text-xs font-bold border transition-all ${tempScope === 'global' ? 'bg-emerald-500 text-white border-emerald-500 shadow-sm' : 'bg-slate-50 text-slate-500 border-slate-200'}`}
                                    >
                                        全局 (所有对话)
                                    </button>
                                </div>
                                <p className="text-[10px] text-slate-400 mt-1.5 leading-relaxed">
                                    局部：仅当角色在神经链接「扩展设定」里挂载本书后注入。全局：任意发消息都带上，无需挂载。两者同时生效时，系统提示先写局部、再写全局。
                                </p>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div className={tempPosition.startsWith('depth_') ? '' : 'col-span-2'}>
                                    <label className="text-xs font-bold text-slate-500 mb-1.5 block">插入位置 (Position)</label>
                                    <select
                                        value={tempPosition}
                                        onChange={e => setTempPosition(e.target.value as WorldbookPosition)}
                                        className="w-full text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 outline-none focus:border-indigo-500"
                                    >
                                        {POSITION_OPTIONS.map(o => (
                                            <option key={o.value} value={o.value}>{o.label}</option>
                                        ))}
                                    </select>
                                </div>
                                {tempPosition.startsWith('depth_') && (
                                    <div>
                                        <label className="text-xs font-bold text-slate-500 mb-1.5 block">深度 (Depth)</label>
                                        <input
                                            type="number" min={0}
                                            value={tempDepth}
                                            onChange={e => setTempDepth(parseInt(e.target.value) || 0)}
                                            className="w-full text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 outline-none focus:border-indigo-500"
                                        />
                                    </div>
                                )}
                            </div>

                            <div>
                                <label className="text-xs font-bold text-slate-500 mb-1.5 block">插入顺序 (Order)</label>
                                <input
                                    type="number"
                                    value={tempOrder}
                                    onChange={e => setTempOrder(parseInt(e.target.value) || 0)}
                                    className="w-full text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 outline-none focus:border-indigo-500"
                                />
                                <p className="text-[10px] text-slate-400 mt-1">同一位置内数值小的排前面（与 SillyTavern 最终生效顺序一致）。@深度位置 = 以所选角色身份插到聊天历史倒数第 N 条处（深度 0 = 最末尾）。</p>
                            </div>

                            {/* 激活方式（ST 蓝灯/绿灯移植） */}
                            <div>
                                <label className="text-xs font-bold text-slate-500 mb-1.5 block">激活方式 (Activation)</label>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => setTempActivation('always')}
                                        className={`flex-1 py-2 rounded-lg text-xs font-bold border transition-all ${tempActivation === 'always' ? 'bg-sky-500 text-white border-sky-500 shadow-sm' : 'bg-slate-50 text-slate-500 border-slate-200'}`}
                                    >
                                        🔵 常驻 (Constant)
                                    </button>
                                    <button
                                        onClick={() => setTempActivation('keyword')}
                                        className={`flex-1 py-2 rounded-lg text-xs font-bold border transition-all ${tempActivation === 'keyword' ? 'bg-emerald-500 text-white border-emerald-500 shadow-sm' : 'bg-slate-50 text-slate-500 border-slate-200'}`}
                                    >
                                        🟢 关键词触发
                                    </button>
                                </div>
                                <p className="text-[10px] text-slate-400 mt-1.5 leading-relaxed">
                                    常驻：开关开着就注入（ST 蓝灯）。关键词触发：扫描最近的聊天消息，命中关键词才注入（ST 绿灯）——适合大体量设定按需出场，省 token。
                                </p>
                            </div>

                            {tempActivation === 'keyword' && (
                                <div className="space-y-3 bg-emerald-50/50 border border-emerald-100 rounded-lg p-3">
                                    <div>
                                        <label className="text-xs font-bold text-slate-500 mb-1.5 block">触发关键词（逗号分隔，任一命中即激活）</label>
                                        <input
                                            value={tempKeys}
                                            onChange={e => setTempKeys(e.target.value)}
                                            placeholder="例如: 魔法, 咒语, 法术"
                                            className="w-full text-xs text-slate-700 bg-white border border-slate-200 rounded-lg px-3 py-2.5 outline-none focus:border-emerald-500"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-slate-500 mb-1.5 block">二级过滤词（可选，逗号分隔）</label>
                                        <input
                                            value={tempSecondaryKeys}
                                            onChange={e => setTempSecondaryKeys(e.target.value)}
                                            placeholder="例如: 学院, 导师"
                                            className="w-full text-xs text-slate-700 bg-white border border-slate-200 rounded-lg px-3 py-2.5 outline-none focus:border-emerald-500"
                                        />
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <label className="text-xs font-bold text-slate-500 block">需同时命中二级词 (Selective)</label>
                                            <p className="text-[10px] text-slate-400 mt-0.5">开启后：主关键词 + 任一二级词都命中才注入</p>
                                        </div>
                                        <MiniToggle on={tempSelective} onChange={setTempSelective} />
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <label className="text-xs font-bold text-slate-500">大小写敏感</label>
                                        <MiniToggle on={tempCaseSensitive} onChange={setTempCaseSensitive} />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-slate-500 mb-1.5 block">扫描深度（最近 N 条消息）</label>
                                        <input
                                            type="number" min={1}
                                            value={tempScanDepth}
                                            onChange={e => setTempScanDepth(parseInt(e.target.value) || 1)}
                                            className="w-full text-xs text-slate-700 bg-white border border-slate-200 rounded-lg px-3 py-2.5 outline-none focus:border-emerald-500"
                                        />
                                    </div>
                                </div>
                            )}
                        </div>

                        <div>
                            <label className="text-xs font-bold text-slate-400 uppercase mb-2 block tracking-wider">设定内容 (Content)</label>
                            <textarea 
                                value={tempContent}
                                onChange={e => setTempContent(e.target.value)}
                                placeholder="在此输入详细的设定内容，支持 Markdown 格式..." 
                                className="w-full h-80 bg-white border border-slate-200 rounded-xl p-4 text-sm text-slate-700 leading-relaxed resize-none outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all font-mono"
                            />
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // LIST VIEW
    return (
        <div className="h-full w-full relative overflow-hidden font-sans bg-slate-100 flex flex-col">
            {/* Background Atmosphere */}
            <div className="absolute inset-0 bg-gradient-to-br from-indigo-50 via-slate-100 to-violet-50 pointer-events-none"></div>
            <div className="absolute -top-20 -right-20 w-64 h-64 bg-indigo-200/20 rounded-full blur-3xl pointer-events-none"></div>
            <div className="absolute bottom-0 left-0 w-full h-32 bg-gradient-to-t from-white/80 to-transparent pointer-events-none z-10"></div>

            {/* Header */}
            <div className="h-20 bg-white/70 backdrop-blur-xl flex items-end pb-3 px-6 border-b border-white/40 shrink-0 sticky top-0 z-20 shadow-sm">
                <div className="flex justify-between items-center w-full">
                    <button onClick={closeApp} className="p-2 -ml-2 rounded-full hover:bg-black/5 active:scale-90 transition-transform">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-slate-600"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
                    </button>
                    <span className="font-bold text-slate-700 text-lg tracking-wide flex items-center gap-2">
                        <DiamondsFour size={18} className="text-indigo-500" /> 世界书
                    </span>
                    <button onClick={handleCreate} className="w-9 h-9 bg-indigo-500 text-white rounded-full shadow-lg shadow-indigo-200 flex items-center justify-center active:scale-90 transition-transform hover:bg-indigo-600">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                    </button>
                </div>
            </div>

            {/* Content List */}
            <div className="flex-1 overflow-y-auto p-5 pb-24 space-y-4 no-scrollbar relative z-0">
                {Object.keys(groupedBooks).length === 0 && (
                    <div className="flex flex-col items-center justify-center h-64 text-slate-400 gap-4 opacity-60">
                        <BookOpen size={48} className="text-slate-400" />
                        <span className="text-xs font-medium">世界还是空白的...</span>
                    </div>
                )}

                {Object.entries(groupedBooks).map(([category, books]) => {
                    const bookEnabled = worldbookGroupToggles[category] !== false;
                    return (
                    <div key={category} className={`animate-slide-up ${bookEnabled ? '' : 'opacity-60'}`}>
                        {/* Category Header（分组 = 一本世界书） */}
                        <div
                            onClick={() => toggleCategory(category)}
                            className="flex items-center gap-2 py-2 px-1 cursor-pointer select-none group"
                        >
                            <div className={`transition-transform duration-300 ${expandedCategory === category ? 'rotate-90' : ''}`}>
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-slate-400 group-hover:text-indigo-500"><path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" /></svg>
                            </div>
                            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider group-hover:text-indigo-600 transition-colors">{category}</h3>
                            <span className="text-[9px] bg-white/50 px-1.5 rounded text-slate-400 border border-white/50">{books.length}</span>
                            {!bookEnabled && <span className="text-[9px] bg-red-50 px-1.5 rounded text-red-400 border border-red-100 font-bold">整书已关</span>}
                            <div className="ml-auto flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                                <span className="text-[9px] text-slate-400">整书开关</span>
                                <MiniToggle
                                    on={bookEnabled}
                                    onChange={(on) => { setWorldbookGroupEnabled(category, on); addToast(on ? `《${category}》整书已开启` : `《${category}》整书已关闭（所有条目暂停注入）`, 'info'); }}
                                    title="关闭后本书所有条目（含全局条目）都不再注入"
                                />
                            </div>
                        </div>

                        {/* Group Items */}
                        <div className={`space-y-3 pl-2 transition-all duration-300 overflow-hidden ${expandedCategory === category ? 'max-h-[1000px] opacity-100 mt-2' : 'max-h-0 opacity-0'}`}>
                            {books.map(book => (
                                <div key={book.id} className="bg-white/60 backdrop-blur-md rounded-2xl border border-white/60 shadow-sm hover:shadow-md transition-all group relative overflow-hidden">
                                    {/* Item Header */}
                                    <div 
                                        onClick={() => togglePreview(book.id)}
                                        className="p-4 cursor-pointer flex justify-between items-start"
                                    >
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-1">
                                                <div className={`w-1.5 h-1.5 rounded-full ${previewBookId === book.id ? 'bg-indigo-400' : 'bg-slate-300'}`}></div>
                                                <h4 className={`text-sm font-bold truncate transition-colors ${book.enabled === false ? 'text-slate-400 line-through' : previewBookId === book.id ? 'text-indigo-700' : 'text-slate-700'}`}>{book.title}</h4>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        const next = book.scope === 'global' ? 'local' : 'global';
                                                        updateWorldbook(book.id, { scope: next });
                                                        addToast(next === 'global' ? `「${book.title}」已切为全局（所有对话生效）` : `「${book.title}」已切回局部（需角色挂载）`, 'info');
                                                    }}
                                                    title="点击切换 局部 / 全局"
                                                    className={`text-[9px] px-1.5 py-0.5 rounded font-bold border shrink-0 transition-colors ${book.scope === 'global' ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-indigo-50 text-indigo-500 border-indigo-100'}`}
                                                >
                                                    {book.scope === 'global' ? '全局' : '局部'}
                                                </button>
                                            </div>
                                            <div className="text-[10px] text-slate-400 font-mono pl-3.5 truncate">
                                                {book.activation === 'keyword' ? '🟢' : '🔵'} {positionLabel(book.position)} · 顺序 {book.order ?? 100} · {new Date(book.updatedAt).toLocaleDateString()}
                                                {book.activation === 'keyword' && (book.keys?.length || 0) > 0 && ` · 🔑 ${book.keys!.slice(0, 3).join('/')}${book.keys!.length > 3 ? '…' : ''}`}
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-2 ml-2" onClick={e => e.stopPropagation()}>
                                            <MiniToggle
                                                on={book.enabled !== false}
                                                onChange={(on) => updateWorldbook(book.id, { enabled: on })}
                                                title="条目开关"
                                            />
                                        </div>

                                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button 
                                                onClick={(e) => { e.stopPropagation(); handleEdit(book); }} 
                                                className="p-2 rounded-full hover:bg-white text-slate-400 hover:text-indigo-600 transition-colors"
                                                title="编辑"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" /></svg>
                                            </button>
                                            <button 
                                                onClick={(e) => requestDelete(e, book)} 
                                                className="p-2 rounded-full hover:bg-red-50 text-slate-300 hover:text-red-500 transition-colors"
                                                title="删除"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
                                            </button>
                                        </div>
                                    </div>

                                    {/* Expanded Content Preview */}
                                    {previewBookId === book.id && (
                                        <div className="px-4 pb-4 pt-0 animate-fade-in">
                                            <div className="h-px w-full bg-gradient-to-r from-transparent via-slate-200 to-transparent mb-3"></div>
                                            {/* SillyTavern 导入条目：展示原卡设置。关键词激活现已由 WorldbookRuntime 执行
                                                （新导入自动启用；旧导入条目在编辑器里保存一次即可接上） */}
                                            {book.source === 'sillytavern' && (
                                                <div className="mb-3 flex flex-wrap gap-1.5 text-[9px] font-mono">
                                                    <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-500 border border-indigo-100 font-bold">SillyTavern</span>
                                                    {book.stData?.entry && (
                                                        <>
                                                            <span className="px-1.5 py-0.5 rounded bg-slate-50 text-slate-500 border border-slate-200">
                                                                {book.stData.entry.constant ? '🔵 常驻 (constant)' : '🟢 关键词触发'}
                                                            </span>
                                                            {book.stData.entry.enabled === false && (
                                                                <span className="px-1.5 py-0.5 rounded bg-red-50 text-red-400 border border-red-100">原卡已禁用</span>
                                                            )}
                                                            {(book.stData.entry.keys?.length || 0) > 0 && (
                                                                <span className="px-1.5 py-0.5 rounded bg-slate-50 text-slate-500 border border-slate-200">关键词: {book.stData.entry.keys!.join(', ')}</span>
                                                            )}
                                                            {(book.stData.entry.secondaryKeys?.length || 0) > 0 && (
                                                                <span className="px-1.5 py-0.5 rounded bg-slate-50 text-slate-500 border border-slate-200">过滤词: {book.stData.entry.secondaryKeys!.join(', ')}</span>
                                                            )}
                                                            {book.stData.entry.insertionOrder !== undefined && (
                                                                <span className="px-1.5 py-0.5 rounded bg-slate-50 text-slate-500 border border-slate-200">顺序: {book.stData.entry.insertionOrder}</span>
                                                            )}
                                                            {book.stData.entry.position !== undefined && (
                                                                <span className="px-1.5 py-0.5 rounded bg-slate-50 text-slate-500 border border-slate-200">位置: {String(book.stData.entry.position)}</span>
                                                            )}
                                                        </>
                                                    )}
                                                    {book.stData?.bookName && (
                                                        <span className="px-1.5 py-0.5 rounded bg-slate-50 text-slate-500 border border-slate-200">书: {book.stData.bookName}</span>
                                                    )}
                                                    {book.stData?.scanDepth !== undefined && (
                                                        <span className="px-1.5 py-0.5 rounded bg-slate-50 text-slate-500 border border-slate-200">scan_depth: {book.stData.scanDepth}</span>
                                                    )}
                                                    {book.stData?.tokenBudget !== undefined && (
                                                        <span className="px-1.5 py-0.5 rounded bg-slate-50 text-slate-500 border border-slate-200">token_budget: {book.stData.tokenBudget}</span>
                                                    )}
                                                    {book.stData?.recursiveScanning !== undefined && (
                                                        <span className="px-1.5 py-0.5 rounded bg-slate-50 text-slate-500 border border-slate-200">递归扫描: {book.stData.recursiveScanning ? '开' : '关'}</span>
                                                    )}
                                                </div>
                                            )}
                                            <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap font-light select-text">
                                                {book.content || <span className="italic text-slate-400">暂无内容...</span>}
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

            {/* Delete Confirmation Modal */}
            <Modal 
                isOpen={showDeleteConfirm} 
                title="删除确认" 
                onClose={() => setShowDeleteConfirm(false)}
                footer={
                    <div className="flex gap-3 w-full">
                        <button onClick={() => setShowDeleteConfirm(false)} className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-2xl active:scale-95 transition-transform">取消</button>
                        <button onClick={confirmDelete} className="flex-1 py-3 bg-red-500 text-white font-bold rounded-2xl shadow-lg shadow-red-200 active:scale-95 transition-transform">确认删除</button>
                    </div>
                }
            >
                <div className="text-center py-4 text-sm text-slate-600 flex flex-col items-center gap-3">
                    <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center text-red-500 mb-1">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
                    </div>
                    <div>
                        确定要删除 <span className="font-bold text-slate-900">"{editingBook?.title}"</span> 吗？
                        <br/><span className="text-xs text-red-400 opacity-80 mt-1 block">此操作无法撤销。</span>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default WorldbookApp;