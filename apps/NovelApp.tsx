
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useOS } from '../context/OSContext';
import { NovelBook, NovelProtagonist, CharacterProfile } from '../types';
import { processImage } from '../utils/file';
import { NOVEL_THEMES, analyzeWriterPersonaSimple } from '../utils/novelUtils';
import { resolveAuxApi } from '../utils/auxApi';
import NovelWriter from '../components/novel/NovelWriter';
import { PenNib, Books, FolderOpen, Robot, MaskHappy, Plus, Trash, Image as ImageIcon, Stack, Quotes } from '@phosphor-icons/react';
import {
    PAPER, PAPER_CARD, HAND, BRUSH, DOT_BG, LINES_BG, BARCODE_BG, paperField,
    Tape, Cut, Stitch, Kicker, SectionTitle, BackSticker,
    IconStamp, InkButton, Chip, TopBar, CollageModal, CollageConfirm,
} from './creative/collage';

/** onExit：当本 App 嵌在「创作社」壳里时，顶层返回回到创作社首页而非直接关到桌面。未传则回桌面。 */
const NovelApp: React.FC<{ onExit?: () => void }> = ({ onExit }) => {
    const { closeApp, novels, addNovel, updateNovel, deleteNovel, characters, updateCharacter, apiConfig, auxApiConfig, addToast, userProfile, worldbooks } = useOS();
    // 小说创作属「聊天以外」的功能：走副 API（未配置副 API 时回退主 API）
    const auxApi = { ...apiConfig, ...resolveAuxApi(auxApiConfig, apiConfig) };
    const exitApp = onExit ?? closeApp;

    // Navigation State
    const [view, setView] = useState<'shelf' | 'create' | 'write' | 'settings' | 'library'>('shelf');
    const [activeBook, setActiveBook] = useState<NovelBook | null>(null);
    const [activeTheme, setActiveTheme] = useState(NOVEL_THEMES[0]);

    // Create / Settings Form
    const [tempTitle, setTempTitle] = useState('');
    const [tempSubtitle, setTempSubtitle] = useState('');
    const [tempSummary, setTempSummary] = useState('');
    const [tempWorld, setTempWorld] = useState('');
    const [selectedCollaborators, setSelectedCollaborators] = useState<Set<string>>(new Set());
    const [tempProtagonists, setTempProtagonists] = useState<NovelProtagonist[]>([]);

    // Cover Image State
    const [coverInputUrl, setCoverInputUrl] = useState('');
    const [tempCoverImage, setTempCoverImage] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Protagonist Modal State
    const [editingProtagonist, setEditingProtagonist] = useState<NovelProtagonist | null>(null);
    const [isProtagonistModalOpen, setIsProtagonistModalOpen] = useState(false);

    // Protagonist Import State
    const [isProtoImportOpen, setIsProtoImportOpen] = useState(false);
    const [importTab, setImportTab] = useState<'system' | 'history'>('system');

    // Worldbook Import Modal State
    const [isWorldbookModalOpen, setIsWorldbookModalOpen] = useState(false);

    // Persona View Modal State
    const [showPersonaModal, setShowPersonaModal] = useState(false);
    const [libraryPersonaChar, setLibraryPersonaChar] = useState<CharacterProfile | null>(null);

    // Dialog
    const [confirmDialog, setConfirmDialog] = useState<{ isOpen: boolean; title: string; message: string; variant: 'danger' | 'warning' | 'info'; confirmText?: string; onConfirm: () => void; } | null>(null);

    // Writer State (Lifted slightly for init)
    const [targetCharId, setTargetCharId] = useState<string | null>(null);

    // Helpers
    const getTheme = (styleId: string) => NOVEL_THEMES.find(t => t.id === styleId) || NOVEL_THEMES[0];

    const collaborators = useMemo(() => {
        if (!activeBook) return [];
        return characters.filter(c => activeBook.collaboratorIds.includes(c.id));
    }, [activeBook, characters]);

    const historyProtagonists = useMemo(() => {
        const all: NovelProtagonist[] = [];
        const seen = new Set<string>();
        novels.forEach(n => {
            n.protagonists.forEach(p => {
                const key = `${p.name}-${p.role}`;
                if (!seen.has(key)) { seen.add(key); all.push(p); }
            });
        });
        return all;
    }, [novels]);

    useEffect(() => {
        if (activeBook && collaborators.length > 0 && !targetCharId) {
            setTargetCharId(collaborators[0].id);
        }
    }, [activeBook, collaborators]);

    useEffect(() => {
        if (activeBook) {
            setActiveTheme(getTheme(activeBook.coverStyle));
        }
    }, [activeBook]);

    // --- CRUD ---

    const handleCreateBook = () => {
        if (!tempTitle.trim()) { addToast('给稿子起个名字吧', 'error'); return; }
        const newBook: NovelBook = {
            id: `novel-${Date.now()}`,
            title: tempTitle, subtitle: tempSubtitle, summary: tempSummary,
            coverStyle: activeTheme.id, coverImage: tempCoverImage, worldSetting: tempWorld,
            collaboratorIds: Array.from(selectedCollaborators), protagonists: tempProtagonists,
            segments: [], createdAt: Date.now(), lastActiveAt: Date.now()
        };
        addNovel(newBook);
        setActiveBook(newBook);
        setView('write');
        resetTempState();
    };

    const handleEditBookSettings = () => {
        if (!activeBook) return;
        setTempTitle(activeBook.title);
        setTempSubtitle(activeBook.subtitle || '');
        setTempSummary(activeBook.summary);
        setTempWorld(activeBook.worldSetting);
        setActiveTheme(getTheme(activeBook.coverStyle));
        setTempCoverImage(activeBook.coverImage || '');
        setSelectedCollaborators(new Set(activeBook.collaboratorIds));
        setTempProtagonists(activeBook.protagonists);
        setView('settings');
    };

    const handleSaveSettings = async () => {
        if (!activeBook) return;
        const updated = {
            ...activeBook,
            title: tempTitle, subtitle: tempSubtitle, summary: tempSummary,
            worldSetting: tempWorld, coverStyle: activeTheme.id, coverImage: tempCoverImage,
            collaboratorIds: Array.from(selectedCollaborators), protagonists: tempProtagonists,
            segments: activeBook.segments, lastActiveAt: Date.now()
        };
        await updateNovel(activeBook.id, updated);
        setActiveBook(updated);
        setView('write');
        addToast('设定收好了，正文一字没动', 'success');
    };

    const resetTempState = () => {
        setTempTitle(''); setTempSubtitle(''); setTempSummary(''); setTempWorld(''); setSelectedCollaborators(new Set()); setTempProtagonists([]); setTempCoverImage(''); setCoverInputUrl('');
    };

    const handleDeleteBook = async (id: string) => {
        setConfirmDialog({
            isOpen: true, title: '撕掉这本？', message: '整本稿子会从抽屉里消失，撕了就捡不回来了。', variant: 'danger', confirmText: '撕掉',
            onConfirm: () => { deleteNovel(id); if (activeBook?.id === id) setView('shelf'); addToast('稿子已撕掉', 'success'); setConfirmDialog(null); }
        });
    };

    // --- Cover Image Logic ---
    const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            try {
                const base64 = await processImage(file, { maxWidth: 800, quality: 0.8 });
                setTempCoverImage(base64);
            } catch (e) { addToast('这张图贴不上去', 'error'); }
        }
    };

    const handleCoverUrlBlur = () => { if (coverInputUrl) setTempCoverImage(coverInputUrl); };

    // --- Protagonist Management ---
    const openProtagonistEdit = (p?: NovelProtagonist) => {
        setEditingProtagonist(p || { id: `proto-${Date.now()}`, name: '', role: '主角', description: '' });
        setIsProtagonistModalOpen(true);
    };

    const saveProtagonist = () => {
        if (!editingProtagonist || !editingProtagonist.name.trim()) { addToast('总得有个名字', 'error'); return; }
        setTempProtagonists(prev => {
            const exists = prev.find(p => p.id === editingProtagonist.id);
            return exists ? prev.map(p => p.id === editingProtagonist.id ? editingProtagonist : p) : [...prev, editingProtagonist];
        });
        setIsProtagonistModalOpen(false);
        setEditingProtagonist(null);
    };

    const handleImportProtagonist = (p: {name: string, role?: string, description: string}) => {
        const newP: NovelProtagonist = { id: `proto-${Date.now()}-${Math.random()}`, name: p.name, role: p.role || '主角', description: p.description || '' };
        setTempProtagonists(prev => [...prev, newP]);
        setIsProtoImportOpen(false);
        addToast(`${p.name} 入册了`, 'success');
    };

    const importWorldbook = (wb: any) => {
        const textToAppend = `\n\n【${wb.title}】\n${wb.content}`;
        setTempWorld(prev => (prev + textToAppend).trim());
        setIsWorldbookModalOpen(false);
        addToast(`贴入设定：${wb.title}`, 'success');
    };

    // 剧中人卡片（拼贴：钉在纸上的人物卡）
    const ProtagonistCard = ({ p, onDelete, onClick }: { p: NovelProtagonist, onDelete?: () => void, onClick?: () => void }) => (
        <div onClick={onClick} className="relative bg-white border-2 border-[#1c1b1a] shadow-[3px_3px_0_#1c1b1a] p-3 cursor-pointer active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all group">
            <span aria-hidden className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-[#1c1b1a]" />
            <div className="flex items-center justify-between gap-2">
                <span className="font-black text-sm text-[#1c1b1a] truncate" style={BRUSH}>{p.name}</span>
                <span className="shrink-0 label-mono text-[7px] px-1.5 py-0.5 border border-[#1c1b1a] text-[#1c1b1a]/70">{p.role}</span>
            </div>
            <div className="text-xs text-[#1c1b1a]/55 mt-1 line-clamp-2 leading-relaxed" style={HAND}>{p.description || '（这个人还没写设定）'}</div>
            {onDelete && <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="absolute -top-2 -right-2 w-5 h-5 bg-white border-2 border-[#1c1b1a] text-[#1c1b1a] text-xs leading-none flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">✕</button>}
        </div>
    );

    // ============================ 4. 角色名册 ============================
    if (view === 'library') {
        return (
            <div className="absolute inset-0 flex flex-col text-[#1c1b1a] animate-fade-in" style={{ background: PAPER, ...DOT_BG }}>
                <TopBar
                    left={<BackSticker onClick={() => setView('shelf')} label="回抽屉" />}
                    center={<><div className="label-mono text-[9px] text-[#1c1b1a]/45">CAST &amp; CREW</div><div className="text-[11px] tracking-[0.3em] text-[#1c1b1a]/45 mt-0.5">角 色 名 册</div></>}
                />
                <div className="flex-1 overflow-y-auto no-scrollbar px-4 pb-12 pt-2 space-y-7">
                    {/* 系统角色 / AI 共创者 */}
                    <section>
                        <div className="flex items-center gap-2 mb-3">
                            <Robot size={16} weight="bold" />
                            <SectionTitle en="AI COLLABORATORS" cn="能搭笔的人" />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            {characters.map((c, i) => (
                                <button key={c.id} onClick={() => { setLibraryPersonaChar(c); setShowPersonaModal(true); }} className="relative bg-white border-2 border-[#1c1b1a] shadow-[3px_3px_0_#1c1b1a] p-3 flex flex-col items-center gap-2 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all" style={{ transform: `rotate(${i % 2 ? 0.8 : -0.8}deg)` }}>
                                    <div className="relative">
                                        <Tape className="-top-3 left-1/2 -translate-x-1/2 rotate-[-4deg] w-10 h-3" />
                                        <img src={c.avatar} className="w-16 h-16 object-cover border-2 border-[#1c1b1a]" />
                                    </div>
                                    <div className="font-black text-sm text-center text-[#1c1b1a]" style={BRUSH}>{c.name}</div>
                                    <span className="label-mono text-[7px] px-1.5 py-0.5 border border-[#1c1b1a] text-[#1c1b1a]/70">共创者</span>
                                </button>
                            ))}
                        </div>
                    </section>
                    <Cut label="ARCHIVE" />
                    {/* 历史剧中人 */}
                    <section>
                        <div className="flex items-center gap-2 mb-3">
                            <MaskHappy size={16} weight="bold" />
                            <SectionTitle en="FROM PAST STORIES" cn="写过的角色" />
                        </div>
                        {historyProtagonists.length === 0
                            ? <div className="text-center py-10 text-[#1c1b1a]/40 text-sm" style={HAND}>名册还空着，写本书就有人了</div>
                            : <div className="space-y-3">{historyProtagonists.map((p, idx) => (
                                <div key={idx} className="relative bg-white border-2 border-[#1c1b1a] shadow-[3px_3px_0_#1c1b1a] p-4">
                                    <div className="flex justify-between items-start mb-1.5">
                                        <span className="font-black text-[#1c1b1a]" style={BRUSH}>{p.name}</span>
                                        <span className="label-mono text-[7px] px-1.5 py-0.5 border border-[#1c1b1a] text-[#1c1b1a]/70">{p.role}</span>
                                    </div>
                                    <p className="text-xs text-[#1c1b1a]/60 leading-relaxed line-clamp-3" style={HAND}>{p.description || '（没留下设定）'}</p>
                                </div>
                            ))}</div>}
                    </section>
                </div>

                <CollageModal isOpen={showPersonaModal} title={libraryPersonaChar?.name || '笔法'} kicker="WRITING STYLE" onClose={() => setShowPersonaModal(false)}>
                    {libraryPersonaChar && (
                        <div className="relative bg-white border-2 border-[#1c1b1a] p-4 text-sm leading-relaxed text-[#1c1b1a]/80 whitespace-pre-wrap" style={{ ...LINES_BG }}>
                            <Quotes size={18} weight="fill" className="text-[#1c1b1a]/25 mb-1" />
                            {libraryPersonaChar.writerPersona || analyzeWriterPersonaSimple(libraryPersonaChar)}
                        </div>
                    )}
                </CollageModal>
            </div>
        );
    }

    // ============================ 1. 稿子抽屉（书架） ============================
    if (view === 'shelf') {
        return (
            <div className="absolute inset-0 flex flex-col text-[#1c1b1a] animate-fade-in" style={{ background: PAPER, ...DOT_BG }}>
                <CollageConfirm isOpen={!!confirmDialog} title={confirmDialog?.title || ''} message={confirmDialog?.message || ''} variant={confirmDialog?.variant} confirmText={confirmDialog?.confirmText || '确认'} cancelText="算了" onConfirm={confirmDialog?.onConfirm || (() => setConfirmDialog(null))} onCancel={() => setConfirmDialog(null)} />
                <TopBar
                    left={<BackSticker onClick={exitApp} label="返回" />}
                    center={<><div className="label-mono text-[9px] text-[#1c1b1a]/45">PROSE · 笔友会</div><div className="text-[11px] tracking-[0.3em] text-[#1c1b1a]/45 mt-0.5">稿 子 抽 屉</div></>}
                    right={<>
                        <IconStamp onClick={() => setView('library')} title="角色名册"><Stack size={18} weight="bold" /></IconStamp>
                        <IconStamp tone="ink" onClick={() => { setView('create'); resetTempState(); }} title="开新稿"><Plus size={18} weight="bold" /></IconStamp>
                    </>}
                />
                <div className="flex-1 overflow-y-auto no-scrollbar px-4 pt-2 pb-16">
                    <div className="grid grid-cols-2 gap-5">
                        {novels.map((book, idx) => {
                            const style = getTheme(book.coverStyle);
                            const wordCount = book.segments.reduce((acc, seg) => acc + (seg.type === 'story' ? seg.content.length : 0), 0);
                            const bookCollaborators = characters.filter(c => book.collaboratorIds.includes(c.id));
                            return (
                                <button key={book.id} onClick={() => { setActiveBook(book); setView('write'); }} className="group relative text-left active:translate-x-[2px] active:translate-y-[2px] transition-transform" style={{ transform: `rotate(${idx % 2 ? 0.7 : -0.7}deg)` }}>
                                    <div className="relative border-2 border-[#1c1b1a] shadow-[4px_4px_0_#1c1b1a] overflow-hidden" style={{ background: PAPER_CARD }}>
                                        <Tape className={`-top-2 ${idx % 2 ? 'right-4 rotate-[5deg]' : 'left-4 rotate-[-5deg]'} w-12 h-4`} />
                                        {/* 封面带：贴图 or 主题色纸条 */}
                                        <div className={`h-20 relative ${book.coverImage ? '' : style.bg}`} style={book.coverImage ? { backgroundImage: `url(${book.coverImage})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}}>
                                            {book.coverImage && <div className="absolute inset-0 bg-[#1c1b1a]/15" />}
                                            <div className="absolute top-1.5 left-2 label-mono text-[7px] text-[#1c1b1a]/50">NO.{String(idx + 1).padStart(2, '0')}</div>
                                            <div aria-hidden className="absolute bottom-1.5 right-2 w-10 h-3 opacity-50" style={BARCODE_BG} />
                                        </div>
                                        <div className="border-t-2 border-[#1c1b1a] p-3">
                                            <h3 className="font-black text-base leading-tight line-clamp-2 text-[#1c1b1a]" style={BRUSH}>{book.title}</h3>
                                            {book.subtitle && <div className="label-mono text-[7px] text-[#1c1b1a]/45 mt-0.5 truncate">{book.subtitle}</div>}
                                            <p className="text-xs text-[#1c1b1a]/55 line-clamp-3 leading-relaxed mt-1.5 min-h-[2.5rem]" style={HAND}>{book.summary || '（还没写简介）'}</p>
                                            <Stitch className="my-2" />
                                            <div className="flex items-center justify-between">
                                                <div className="flex -space-x-1.5">{bookCollaborators.slice(0, 3).map(c => (<img key={c.id} src={c.avatar} className="w-5 h-5 border border-[#1c1b1a] object-cover bg-white" />))}{bookCollaborators.length === 0 && <span className="text-[9px] text-[#1c1b1a]/35" style={HAND}>独自写</span>}</div>
                                                <span className="label-mono text-[7px] px-1.5 py-0.5 border border-[#1c1b1a] text-[#1c1b1a]/65">{(wordCount / 1000).toFixed(1)}k 字</span>
                                            </div>
                                        </div>
                                    </div>
                                    <button onClick={(e) => { e.stopPropagation(); handleDeleteBook(book.id); }} className="absolute -top-2 -right-2 w-6 h-6 bg-white border-2 border-[#1c1b1a] text-[#1c1b1a] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"><Trash size={12} weight="bold" /></button>
                                </button>
                            );
                        })}
                    </div>
                    {novels.length === 0 && (
                        <div className="flex flex-col items-center justify-center h-72 gap-4 text-[#1c1b1a]/45">
                            <div className="relative">
                                <Tape className="-top-3 left-1/2 -translate-x-1/2 rotate-[-6deg] w-14" />
                                <div className="w-24 h-32 bg-white border-2 border-dashed border-[#1c1b1a]/40 flex items-center justify-center rotate-[-3deg]"><PenNib size={40} weight="light" /></div>
                            </div>
                            <div className="text-center" style={HAND}>
                                <div className="text-lg text-[#1c1b1a]/70">抽屉空空</div>
                                <div className="text-sm">点右上角 ＋ 开张第一本</div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // ============================ 2. 开新稿 / 稿子设定 ============================
    if (view === 'create' || view === 'settings') {
        const isCreate = view === 'create';
        return (
            <div className="absolute inset-0 flex flex-col text-[#1c1b1a] animate-fade-in" style={{ background: PAPER, ...DOT_BG }}>
                <CollageConfirm isOpen={!!confirmDialog} title={confirmDialog?.title || ''} message={confirmDialog?.message || ''} variant={confirmDialog?.variant} confirmText={confirmDialog?.confirmText || '确认'} cancelText="算了" onConfirm={confirmDialog?.onConfirm || (() => setConfirmDialog(null))} onCancel={() => setConfirmDialog(null)} />
                <TopBar
                    left={<button onClick={() => setView(isCreate ? 'shelf' : 'write')} className="px-3 py-2 text-[10px] font-black border-2 border-[#1c1b1a] bg-white shadow-[2px_2px_0_#1c1b1a] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all rotate-[-2deg]">不写了</button>}
                    center={<><div className="label-mono text-[9px] text-[#1c1b1a]/45">{isCreate ? 'NEW MANUSCRIPT' : 'EDIT SETUP'}</div><div className="text-[11px] tracking-[0.3em] text-[#1c1b1a]/45 mt-0.5">{isCreate ? '开 新 稿' : '稿 子 设 定'}</div></>}
                    right={<IconStamp tone="ink" onClick={isCreate ? handleCreateBook : handleSaveSettings} title="收好" className="w-auto px-3 text-[10px] font-black tracking-widest">收好</IconStamp>}
                />
                <div className="flex-1 overflow-y-auto no-scrollbar px-4 pt-2 pb-20 space-y-6">
                    {/* 扉页：书名 / 副标 / 简介 */}
                    <section className="relative bg-white border-2 border-[#1c1b1a] shadow-[4px_4px_0_#1c1b1a] p-5 space-y-4 rotate-[-0.4deg]">
                        <Tape className="-top-2.5 left-8 rotate-[3deg] w-16" />
                        <Kicker>TITLE PAGE · 扉页</Kicker>
                        <input value={tempTitle} onChange={e => setTempTitle(e.target.value)} placeholder="书名" className="w-full text-3xl bg-transparent border-b-2 border-[#1c1b1a]/30 py-1 outline-none focus:border-[#1c1b1a] placeholder:text-[#1c1b1a]/25" style={BRUSH} />
                        <input value={tempSubtitle} onChange={e => setTempSubtitle(e.target.value)} placeholder="副标题 / 卷名（可留空）" className="w-full text-sm bg-transparent border-b border-dashed border-[#1c1b1a]/30 py-1.5 outline-none focus:border-[#1c1b1a] text-[#1c1b1a]/70 placeholder:text-[#1c1b1a]/30" />
                        <textarea value={tempSummary} onChange={e => setTempSummary(e.target.value)} placeholder="一句话，这是个关于……的故事" className="w-full h-20 bg-[#fbfaf6] border-2 border-[#1c1b1a] p-3 text-sm resize-none outline-none focus:shadow-[2px_2px_0_#1c1b1a] transition-shadow" style={HAND} />
                    </section>

                    {/* 纸张风格 + 贴照片 */}
                    <section className="space-y-4">
                        <SectionTitle en="PAPER & COVER" cn="纸张 · 封面" />
                        <div>
                            <Kicker className="mb-2">内页纸张</Kicker>
                            <div className="flex gap-3 overflow-x-auto pb-2 no-scrollbar">{NOVEL_THEMES.map(t => (
                                <button key={t.id} onClick={() => setActiveTheme(t)} className={`shrink-0 flex flex-col items-center gap-1 ${activeTheme.id === t.id ? '' : 'opacity-70'}`}>
                                    <div className={`w-12 h-16 border-2 border-[#1c1b1a] ${t.paper} ${activeTheme.id === t.id ? 'shadow-[2px_2px_0_#1c1b1a] -translate-y-0.5' : ''} flex items-end justify-center pb-1`}>{activeTheme.id === t.id && <span className="w-2 h-2 rounded-full bg-[#1c1b1a]" />}</div>
                                    <span className="label-mono text-[7px] text-[#1c1b1a]/60">{t.name.split(' ')[0]}</span>
                                </button>
                            ))}</div>
                        </div>
                        <div>
                            <Kicker className="mb-2">贴张封面照（可选）</Kicker>
                            <div className="flex gap-3 items-start">
                                <div onClick={() => fileInputRef.current?.click()} className="relative w-16 h-24 bg-white border-2 border-[#1c1b1a] shadow-[2px_2px_0_#1c1b1a] flex items-center justify-center cursor-pointer overflow-hidden shrink-0">
                                    <Tape className="-top-2 left-1/2 -translate-x-1/2 rotate-[-3deg] w-10 h-3" />
                                    {tempCoverImage ? <img src={tempCoverImage} className="w-full h-full object-cover" /> : <ImageIcon size={20} weight="light" className="text-[#1c1b1a]/40" />}
                                    <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleCoverUpload} />
                                </div>
                                <div className="flex-1 space-y-2">
                                    <input value={coverInputUrl} onChange={e => setCoverInputUrl(e.target.value)} onBlur={handleCoverUrlBlur} placeholder="或贴一个图片链接…" className={paperField} />
                                    {tempCoverImage && <button onClick={() => { setTempCoverImage(''); setCoverInputUrl(''); }} className="text-xs text-[#1c1b1a]/55 underline decoration-dashed" style={HAND}>撕掉这张照片</button>}
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* 世界观 */}
                    <section className="space-y-3">
                        <div className="flex justify-between items-end">
                            <SectionTitle en="WORLD SETTING" cn="世界观" />
                            <button onClick={() => setIsWorldbookModalOpen(true)} className="inline-flex items-center gap-1 label-mono text-[8px] px-2 py-1 border-2 border-[#1c1b1a] bg-white shadow-[2px_2px_0_#1c1b1a] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all"><Books size={12} weight="bold" /> 贴入世界书</button>
                        </div>
                        <textarea value={tempWorld} onChange={e => setTempWorld(e.target.value)} placeholder="时代、地点、规则、禁忌……世界长什么样？" className="w-full h-32 bg-white border-2 border-[#1c1b1a] p-3 text-sm resize-none outline-none focus:shadow-[2px_2px_0_#1c1b1a] transition-shadow leading-relaxed" style={{ ...LINES_BG }} />
                    </section>

                    {/* 共创者 */}
                    <section className="space-y-3">
                        <SectionTitle en="CO-WRITERS" cn="找谁一起写" />
                        <div className="flex gap-3 overflow-x-auto pb-2 no-scrollbar">{characters.map(c => { const on = selectedCollaborators.has(c.id); return (
                            <button key={c.id} onClick={() => { const s = new Set(selectedCollaborators); if (s.has(c.id)) s.delete(c.id); else s.add(c.id); setSelectedCollaborators(s); }} className="shrink-0 flex flex-col items-center gap-1.5">
                                <div className={`relative ${on ? '' : 'opacity-45 grayscale'}`}>
                                    <img src={c.avatar} className={`w-12 h-12 object-cover border-2 border-[#1c1b1a] ${on ? 'shadow-[2px_2px_0_#1c1b1a]' : ''}`} />
                                    {on && <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-[#1c1b1a] text-[#f2f0e9] text-[9px] flex items-center justify-center">✓</span>}
                                </div>
                                <span className={`text-[10px] font-bold ${on ? 'text-[#1c1b1a]' : 'text-[#1c1b1a]/45'}`}>{c.name}</span>
                            </button>
                        ); })}</div>
                    </section>

                    {/* 剧中人 */}
                    <section className="space-y-3">
                        <div className="flex justify-between items-end">
                            <SectionTitle en="CHARACTERS" cn="剧中人" />
                            <div className="flex gap-2">
                                <button onClick={() => setIsProtoImportOpen(true)} className="inline-flex items-center gap-1 label-mono text-[8px] px-2 py-1 border-2 border-[#1c1b1a] bg-white shadow-[2px_2px_0_#1c1b1a] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all"><FolderOpen size={12} weight="bold" /> 调取</button>
                                <button onClick={() => openProtagonistEdit()} className="inline-flex items-center gap-1 label-mono text-[8px] px-2 py-1 border-2 border-[#1c1b1a] bg-[#1c1b1a] text-[#f2f0e9] shadow-[2px_2px_0_#1c1b1a] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all"><Plus size={12} weight="bold" /> 新增</button>
                            </div>
                        </div>
                        {tempProtagonists.length === 0
                            ? <div className="text-center py-6 text-sm text-[#1c1b1a]/40" style={HAND}>还没排人物，从这里加</div>
                            : <div className="grid grid-cols-2 gap-3">{tempProtagonists.map((p, idx) => (<ProtagonistCard key={p.id} p={p} onClick={() => openProtagonistEdit(p)} onDelete={() => setTempProtagonists(tempProtagonists.filter((_, i) => i !== idx))} />))}</div>}
                    </section>
                </div>

                {/* 编辑剧中人 */}
                <CollageModal isOpen={isProtagonistModalOpen} title="人物卡" kicker="CHARACTER CARD" onClose={() => setIsProtagonistModalOpen(false)} footer={<InkButton tone="ink" onClick={saveProtagonist} className="w-full text-sm tracking-[0.3em]">钉 上</InkButton>}>
                    {editingProtagonist && (
                        <div className="space-y-4">
                            <div><Kicker className="mb-1">名字</Kicker><input value={editingProtagonist.name} onChange={e => setEditingProtagonist({ ...editingProtagonist, name: e.target.value })} className={paperField + ' text-base font-bold'} /></div>
                            <div><Kicker className="mb-1">定位</Kicker><input value={editingProtagonist.role} onChange={e => setEditingProtagonist({ ...editingProtagonist, role: e.target.value })} className={paperField} placeholder="主角 / 反派 / 配角…" /></div>
                            <div><Kicker className="mb-1">设定</Kicker><textarea value={editingProtagonist.description} onChange={e => setEditingProtagonist({ ...editingProtagonist, description: e.target.value })} className="w-full h-32 bg-white border-2 border-[#1c1b1a] p-3 text-sm resize-none outline-none focus:shadow-[2px_2px_0_#1c1b1a] transition-shadow leading-relaxed" style={HAND} /></div>
                        </div>
                    )}
                </CollageModal>

                {/* 调取角色 */}
                <CollageModal isOpen={isProtoImportOpen} title="调取角色" kicker="IMPORT CAST" onClose={() => setIsProtoImportOpen(false)}>
                    <div className="flex gap-2 mb-3">
                        <Chip active={importTab === 'system'} onClick={() => setImportTab('system')} className="flex-1">AI 共创者</Chip>
                        <Chip active={importTab === 'history'} onClick={() => setImportTab('history')} className="flex-1">写过的角色</Chip>
                    </div>
                    <div className="space-y-2.5">
                        {importTab === 'system' && characters.map(c => (
                            <button key={c.id} onClick={() => handleImportProtagonist({ name: c.name, role: '客串', description: c.systemPrompt })} className="w-full flex items-center gap-3 p-2.5 bg-white border-2 border-[#1c1b1a] shadow-[2px_2px_0_#1c1b1a] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all text-left">
                                <img src={c.avatar} className="w-9 h-9 object-cover border border-[#1c1b1a]" />
                                <div className="flex-1 min-w-0"><div className="font-black text-sm text-[#1c1b1a]" style={BRUSH}>{c.name}</div><div className="text-[10px] text-[#1c1b1a]/50 truncate" style={HAND}>{c.description}</div></div>
                            </button>
                        ))}
                        {importTab === 'history' && (historyProtagonists.length === 0
                            ? <div className="text-center py-6 text-sm text-[#1c1b1a]/40" style={HAND}>还没写过角色</div>
                            : historyProtagonists.map((p, idx) => (
                                <button key={`hist-${idx}`} onClick={() => handleImportProtagonist(p)} className="w-full flex items-center gap-3 p-2.5 bg-white border-2 border-[#1c1b1a] shadow-[2px_2px_0_#1c1b1a] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all text-left">
                                    <div className="w-9 h-9 bg-[#f2f0e9] border border-[#1c1b1a] flex items-center justify-center text-sm font-black" style={BRUSH}>{p.name[0]}</div>
                                    <div className="flex-1 min-w-0"><div className="font-black text-sm text-[#1c1b1a]" style={BRUSH}>{p.name}</div><div className="text-[10px] text-[#1c1b1a]/50 truncate" style={HAND}>{p.role} · {p.description || '无描述'}</div></div>
                                </button>
                            )))}
                    </div>
                </CollageModal>

                {/* 贴入世界书 */}
                <CollageModal isOpen={isWorldbookModalOpen} title="贴入世界书" kicker="WORLDBOOK" onClose={() => setIsWorldbookModalOpen(false)}>
                    <div className="space-y-2.5">{worldbooks.map(wb => (
                        <button key={wb.id} onClick={() => importWorldbook(wb)} className="w-full text-left p-3 border-2 border-[#1c1b1a] bg-white shadow-[2px_2px_0_#1c1b1a] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all">
                            <div className="font-black text-sm text-[#1c1b1a]" style={BRUSH}>{wb.title}</div>
                            <div className="label-mono text-[7px] text-[#1c1b1a]/45 mt-1">{wb.category || '未分类'}</div>
                        </button>
                    ))}{worldbooks.length === 0 && <div className="text-center py-6 text-sm text-[#1c1b1a]/40" style={HAND}>还没有世界书</div>}</div>
                </CollageModal>
            </div>
        );
    }

    // ============================ 3. 写作台（交给 NovelWriter） ============================
    if (view === 'write' && activeBook) {
        return (
            <NovelWriter
                activeBook={activeBook}
                updateNovel={updateNovel}
                characters={characters}
                userProfile={userProfile}
                apiConfig={auxApi}
                onBack={() => setView('shelf')}
                updateCharacter={updateCharacter}
                collaborators={collaborators}
                targetCharId={targetCharId}
                setTargetCharId={setTargetCharId}
                onOpenSettings={handleEditBookSettings}
            />
        );
    }

    return null;
};

export default NovelApp;
