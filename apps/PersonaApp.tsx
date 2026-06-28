/**
 * 用户身份：SillyTavern Persona Management 的 Moro 移植。
 * 支持多套身份、默认身份、角色绑定、描述注入方式、世界书分组、JSON 备份恢复。
 * 数据存 IndexedDB `personas` store；激活/默认 id 存 localStorage（见 utils/personas.ts）。
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { processImage } from '../utils/file';
import { Persona, PERSONA_POSITION } from '../types';
import { PersonaRuntime, createPersona, normalizePersonaPosition } from '../utils/personas';
import { estimateTokens } from '../utils/presets';
import {
    PushPin, Paperclip, UserPlus, CopySimple, Trash, Package, ClockCounterClockwise,
    Binoculars, ArrowsDownUp, BookOpenText, X, UserFocus,
} from '@phosphor-icons/react';
import { PAPER_TONES, MONO_STACK } from '../components/handbook/paper';

// ── 剪影集专属照片资料册色板：用户身份侧使用雾蓝强调 ──
const INK = '#2f3432';
const ROSE = '#6e8fa1';
const ROSE_DARK = '#3f6375';
const BORDER = '#dbe5e8';
const CARD_SHADOW = '0 1px 2px rgba(44,65,72,0.08), 0 14px 30px -24px rgba(44,65,72,0.34)';
const STICKER = 'border border-[#dbe5e8] rounded-full bg-[#f8fbfb] text-[#3f6375] shadow-[0_1px_2px_rgba(44,65,72,0.10)] press-soft';
const INK_BTN = 'bg-[#6e8fa1] text-white border border-[#dbe5e8] rounded-full shadow-[0_8px_16px_-12px_rgba(44,65,72,0.44)] press-soft';
const DOT_BG: React.CSSProperties = {
    background: '#f5f7f4',
};
const LINE_INPUT = 'w-full px-3 py-2 text-[13px] outline-none rounded-[14px] bg-[#f8fbfb] border border-[#dbe5e8] text-[#2f3432] placeholder:text-[#8fa5ae] focus:border-[#6e8fa1]';
const AREA_INPUT = 'w-full bg-white border border-[#dbe5e8] rounded-[14px] px-3 py-2 text-xs resize-none outline-none focus:border-[#6e8fa1] placeholder:text-[#8fa5ae]';
const NOTE_TEXT = { color: PAPER_TONES.inkSoft };

const isGeneratedLetterAvatar = (src?: string) => {
    if (!src?.startsWith('data:image/svg+xml')) return false;
    let decoded = src;
    try { decoded = decodeURIComponent(src); } catch {}
    return decoded.includes('<text') && decoded.includes('font-size="50"');
};

const usablePhoto = (src?: string) => (src && !isGeneratedLetterAvatar(src) ? src : '');

const PhotoPlaceholder: React.FC = () => (
    <div className="w-full h-full flex items-center justify-center bg-[#edf5f7]">
        <div className="w-16 h-16 rounded-full border flex items-center justify-center" style={{ borderColor: '#cbdde3', color: ROSE_DARK }}>
            <UserFocus size={30} weight="bold" />
        </div>
    </div>
);

const ActionPhoto: React.FC = () => (
    <div className="relative w-9 h-9 shrink-0">
        <div className="absolute left-1 top-1 w-7 h-8 rounded-[6px] bg-white border rotate-[-8deg]" style={{ borderColor: BORDER }} />
        <div className="absolute left-3 top-0 w-7 h-8 rounded-[6px] bg-[#edf5f7] border rotate-[6deg] flex items-center justify-center" style={{ borderColor: BORDER }}>
            <UserPlus size={13} weight="bold" color={ROSE_DARK} />
        </div>
    </div>
);

/** 自述寄送方式（= ST persona_description_position 的三种语义，文案原创） */
const SEND_MODES: { value: number; label: string; en: string; hint: string }[] = [
    { value: PERSONA_POSITION.IN_PROMPT, label: '放入提示词', en: 'PROMPT', hint: '身份描述会写入提示词；启用预设时落在 Persona Description 占位上。' },
    { value: PERSONA_POSITION.AT_DEPTH, label: '插入对话', en: 'DEPTH', hint: '从最新消息往回数 N 层，把身份描述以指定角色插入聊天记录。' },
    { value: PERSONA_POSITION.NONE, label: '不注入', en: 'OFF', hint: '身份描述不发送给 AI；用户名仍然生效。' },
];

/** 夹进对话时的口吻（role） */
const VOICE_CHIPS: { value: 0 | 1 | 2; label: string }[] = [
    { value: 0, label: '系统消息' },
    { value: 1, label: '用户消息' },
    { value: 2, label: 'AI 消息' },
];

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

/** onExit：剪影集（PersonaHubApp）嵌入时返回封面页；不传则关闭 App 回桌面（旧行为） */
const PersonaApp: React.FC<{ onExit?: () => void }> = ({ onExit }) => {
    const { closeApp: closeAppOS, addToast, userProfile, updateUserProfile, characters, worldbooks } = useOS();
    const closeApp = onExit || closeAppOS;

    const [personas, setPersonas] = useState<Persona[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [activeId, setActiveId] = useState<string | null>(PersonaRuntime.getActiveId());
    const [defaultId, setDefaultId] = useState<string | null>(PersonaRuntime.getDefaultId());
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [view, setView] = useState<'list' | 'detail'>('list');

    const [search, setSearch] = useState('');
    const [sortAsc, setSortAsc] = useState(true);

    const [confirmDelete, setConfirmDelete] = useState<Persona | null>(null);
    const [connectionsTarget, setConnectionsTarget] = useState<Persona | null>(null);

    const avatarInputRef = useRef<HTMLInputElement>(null);
    const restoreInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        DB.getAllPersonas().then(list => {
            setPersonas(list);
            setLoaded(true);
            const active = PersonaRuntime.getActiveId();
            if (active && list.some(p => p.id === active)) setSelectedId(active);
            else if (list.length > 0) setSelectedId(list[0].id);
        }).catch(e => {
            console.error('[Personas] 加载失败:', e);
            addToast('用户身份加载失败', 'error');
        });
    }, []);

    const selected = personas.find(p => p.id === selectedId) || null;

    const visiblePersonas = useMemo(() => {
        const q = search.trim().toLowerCase();
        const filtered = q
            ? personas.filter(p =>
                p.name.toLowerCase().includes(q)
                || (p.title || '').toLowerCase().includes(q)
                || (p.description || '').toLowerCase().includes(q))
            : personas;
        return [...filtered].sort((a, b) => sortAsc
            ? a.name.localeCompare(b.name, 'zh')
            : b.name.localeCompare(a.name, 'zh'));
    }, [personas, search, sortAsc]);

    const worldbookCategories = useMemo(() => {
        const cats = new Set<string>();
        worldbooks.forEach(wb => cats.add(wb.category || '通用设定 (General)'));
        return [...cats].sort((a, b) => a.localeCompare(b, 'zh'));
    }, [worldbooks]);

    // ── 写入 ───────────────────────────────────────────────

    const persist = async (next: Persona) => {
        next.updatedAt = Date.now();
        setPersonas(prev => prev.map(p => p.id === next.id ? next : p));
        try { await DB.savePersona(next); } catch (e) { console.error('[Personas] 保存失败:', e); }
        // 编辑当前身份时，同步写入用户档案，聊天链路会读取档案。
        if (PersonaRuntime.getActiveId() === next.id) {
            const updates: Partial<typeof userProfile> = { name: next.name, bio: next.description };
            if (next.avatar) updates.avatar = next.avatar;
            updateUserProfile(updates);
        }
    };

    const updateSelected = (updates: Partial<Persona>) => {
        if (!selected) return;
        persist({ ...selected, ...updates });
    };

    // ── 操作（语义对齐 ST 人设面板按钮） ───────────────────

    /** 点击身份 = 启用（同 ST 点击 persona 头像块） */
    const activatePersona = (p: Persona) => {
        setSelectedId(p.id);
        setView('detail');
        PersonaRuntime.setActiveId(p.id);
        setActiveId(p.id);
        const updates: Partial<typeof userProfile> = { name: p.name, bio: p.description };
        if (p.avatar) updates.avatar = p.avatar;
        updateUserProfile(updates);
        addToast(`已启用身份「${p.name}」`, 'success');
    };

    const handleCreate = async (fromProfile = false) => {
        const p = createPersona(fromProfile
            ? { name: userProfile.name || '新身份', avatar: userProfile.avatar || '', description: userProfile.bio || '' }
            : { name: `身份 ${personas.length + 1}`, avatar: userProfile.avatar || '' });
        setPersonas(prev => [...prev, p]);
        try { await DB.savePersona(p); } catch (e) { console.error('[Personas] 保存失败:', e); }
        setSelectedId(p.id);
        setView('detail');
        if (fromProfile) {
            PersonaRuntime.setActiveId(p.id);
            setActiveId(p.id);
            addToast('已从当前档案创建身份，并设为启用', 'success');
        } else {
            addToast('新身份已创建', 'success');
        }
    };

    /** 设为默认（=ST 默认人设）：未绑定角色的聊天自动使用。 */
    const toggleDefault = (p: Persona) => {
        const next = defaultId === p.id ? null : p.id;
        PersonaRuntime.setDefaultId(next);
        setDefaultId(next);
        addToast(next ? `已设为默认身份：「${p.name}」` : '已取消默认身份', 'info');
    };

    const handleDuplicate = async (p: Persona) => {
        const copy = createPersona({
            ...p,
            id: undefined as any, createdAt: undefined as any, updatedAt: undefined as any,
            name: `${p.name}（副本）`,
            connections: undefined, // 角色绑定不复制：一个角色只应绑定一个用户身份
        });
        setPersonas(prev => [...prev, copy]);
        try { await DB.savePersona(copy); } catch (e) { console.error('[Personas] 保存失败:', e); }
        setSelectedId(copy.id);
        setView('detail');
        addToast(`身份副本已创建：「${copy.name}」`, 'success');
    };

    const handleDelete = async (p: Persona) => {
        setPersonas(prev => prev.filter(x => x.id !== p.id));
        try { await DB.deletePersona(p.id); } catch (e) { console.error('[Personas] 删除失败:', e); }
        if (PersonaRuntime.getActiveId() === p.id) { PersonaRuntime.setActiveId(null); setActiveId(null); }
        if (PersonaRuntime.getDefaultId() === p.id) { PersonaRuntime.setDefaultId(null); setDefaultId(null); }
        if (selectedId === p.id) setSelectedId(null);
        setView('list');
        setConfirmDelete(null);
        addToast(`身份「${p.name}」已删除`, 'info');
    };

    const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file && selected) {
            try {
                const base64 = await processImage(file);
                updateSelected({ avatar: base64 });
                addToast('头像已更新', 'success');
            } catch (err: any) {
                addToast(err.message, 'error');
            }
        }
        if (avatarInputRef.current) avatarInputRef.current.value = '';
    };

    /** 绑定/解绑角色。同 ST 默认行为：一个角色同时只绑定一个用户身份。 */
    const toggleConnection = async (persona: Persona, charId: string) => {
        const has = (persona.connections || []).some(c => c.type === 'character' && c.id === charId);
        if (has) {
            const next = { ...persona, connections: (persona.connections || []).filter(c => !(c.type === 'character' && c.id === charId)) };
            await persist(next);
            setConnectionsTarget(next);
            return;
        }
        // 从其他身份上移除该角色绑定
        for (const other of personas) {
            if (other.id === persona.id) continue;
            if ((other.connections || []).some(c => c.type === 'character' && c.id === charId)) {
                const cleaned = { ...other, connections: (other.connections || []).filter(c => !(c.type === 'character' && c.id === charId)), updatedAt: Date.now() };
                setPersonas(prev => prev.map(p => p.id === cleaned.id ? cleaned : p));
                try { await DB.savePersona(cleaned); } catch { /* ignore */ }
            }
        }
        const next = { ...persona, connections: [...(persona.connections || []), { type: 'character' as const, id: charId }] };
        await persist(next);
        setConnectionsTarget(next);
    };

    // ── 备份 / 恢复 ─────────────────────────

    const handleBackup = () => {
        const payload = {
            type: 'moro_personas_backup',
            version: 1,
            exportedAt: Date.now(),
            defaultPersonaId: defaultId,
            personas,
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `moro-personas-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        addToast(`备份完成：${personas.length} 个身份已导出`, 'success');
    };

    const handleRestore = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        (async () => {
            try {
                const data = JSON.parse(await file.text());
                const list: any[] = Array.isArray(data?.personas) ? data.personas : (Array.isArray(data) ? data : []);
                if (list.length === 0) throw new Error('这个文件里没有可恢复的身份');
                let added = 0, updated = 0;
                const byId = new Map(personas.map(p => [p.id, p]));
                for (const raw of list) {
                    if (!raw || typeof raw !== 'object' || typeof raw.name !== 'string') continue;
                    const p: Persona = createPersona({
                        ...raw,
                        name: raw.name,
                        avatar: typeof raw.avatar === 'string' ? raw.avatar : '',
                        position: normalizePersonaPosition(raw.position),
                    });
                    if (typeof raw.id === 'string' && raw.id) {
                        p.id = raw.id;
                        if (byId.has(raw.id)) updated++; else added++;
                    } else {
                        added++;
                    }
                    byId.set(p.id, p);
                    await DB.savePersona(p);
                }
                const merged = [...byId.values()];
                setPersonas(merged);
                if (typeof data?.defaultPersonaId === 'string' && merged.some(p => p.id === data.defaultPersonaId)) {
                    PersonaRuntime.setDefaultId(data.defaultPersonaId);
                    setDefaultId(data.defaultPersonaId);
                }
                addToast(`恢复完成：新增 ${added} 个，更新 ${updated} 个`, 'success');
            } catch (err: any) {
                addToast(err?.message || '恢复失败：文件无法读取', 'error');
            } finally {
                if (restoreInputRef.current) restoreInputRef.current.value = '';
            }
        })();
    };

    // ── 渲染 ───────────────────────────────────────────────

    /** 身份卡右上角状态 */
    const renderMarks = (p: Persona) => (
        <div className="flex items-center gap-1 shrink-0">
            {activeId === p.id && (
                <span className="text-[8px] bg-[#edf5f7] px-1.5 py-0.5 rounded-full" style={{ ...MONO_STACK, color: ROSE_DARK, border: `1px solid ${BORDER}` }}>启用中</span>
            )}
            {defaultId === p.id && <PushPin size={13} weight="fill" color={INK} />}
            {(p.connections?.length || 0) > 0 && <Paperclip size={13} weight="bold" color={INK} className="opacity-60" />}
            {p.lorebookCategory && <BookOpenText size={13} weight="bold" color={INK} className="opacity-60" />}
        </div>
    );

    const selectedConnections = (selected?.connections || []).filter(c => c.type === 'character');
    const selectedSendMode = selected ? normalizePersonaPosition(selected.position) : PERSONA_POSITION.IN_PROMPT;

    return (
        <div
            className="h-full w-full text-[#2f3432] flex flex-col animate-fade-in"
            style={{ ...DOT_BG, paddingTop: 'var(--safe-top)' }}
        >
            {/* ── 顶栏 ── */}
            <div className="relative shrink-0 px-4 pt-3 pb-3 bg-[#f5f7f4]/95 backdrop-blur border-b border-[#e6ece8]">
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => view === 'detail' ? setView('list') : closeApp()}
                        className={`shrink-0 px-2.5 py-2 flex items-center gap-1 ${STICKER}`}
                        title={view === 'detail' ? '返回身份列表' : '返回剪影集'}
                    >
                        <svg viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth={2.5} className="w-3.5 h-3.5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
                        </svg>
                        <span className="text-[10px] font-black">返回</span>
                    </button>
                    <div className="flex-1 min-w-0 relative">
                        <div className="text-[8px] tracking-[0.18em] uppercase" style={{ ...MONO_STACK, color: PAPER_TONES.inkFaint }}>USER PERSONAS</div>
                        <div className="flex items-baseline gap-2">
                            <h1 className="text-2xl font-black tracking-normal">用户身份</h1>
                            <span className="text-sm truncate" style={{ color: PAPER_TONES.inkSoft }}>{view === 'detail' ? '编辑当前身份资料' : '点击照片进入身份资料'}</span>
                        </div>
                    </div>
                    <div className="shrink-0 w-12 h-12 rounded-full flex flex-col items-center justify-center select-none bg-white" style={{ border: `1px solid ${BORDER}`, color: PAPER_TONES.ink }}>
                        <span className="text-base font-black leading-none">{personas.length}</span>
                        <span className="text-[7px] leading-none mt-0.5" style={{ ...MONO_STACK, color: PAPER_TONES.inkFaint }}>身份</span>
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto no-scrollbar p-4 space-y-5">
                {view === 'list' && (
                    <>
                {/* ── 操作条 ── */}
                <div className="space-y-3">
                    <div className="flex items-stretch gap-2">
                        <div className="flex-1 flex items-center gap-2 bg-white border rounded-[14px] px-3" style={{ borderColor: BORDER }}>
                            <Binoculars size={15} color={INK} className="shrink-0 opacity-70" />
                            <input
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                placeholder="搜索身份名称、备注或描述"
                                className="flex-1 bg-transparent py-2 text-xs outline-none placeholder:text-[#8fa5ae]"
                            />
                        </div>
                        <button
                            onClick={() => setSortAsc(v => !v)}
                            className={`px-2.5 flex items-center gap-1 ${STICKER}`}
                            title={sortAsc ? '按名称升序' : '按名称降序'}
                        >
                            <ArrowsDownUp size={14} color={INK} />
                            <span className="label-mono text-[8px]">{sortAsc ? 'A-Z' : 'Z-A'}</span>
                        </button>
                    </div>
                    <button
                        onClick={() => handleCreate(false)}
                        className="w-full bg-white border rounded-[16px] px-3 py-2.5 flex items-center gap-3 text-left active:scale-[0.99] transition-all"
                        style={{ borderColor: BORDER, boxShadow: '0 1px 2px rgba(44,65,72,0.06)' }}
                    >
                        <ActionPhoto />
                        <div className="flex-1 min-w-0">
                            <div className="text-xs font-black" style={{ color: INK }}>新建身份</div>
                            <div className="text-[10px] truncate" style={{ color: PAPER_TONES.inkSoft }}>创建一套新的聊天用户资料</div>
                        </div>
                        <UserPlus size={15} weight="bold" color={ROSE_DARK} />
                    </button>
                </div>

                {/* ── 空状态 ── */}
                {loaded && personas.length === 0 && (
                    <div className="relative bg-white border rounded-[18px] p-6 text-center space-y-3" style={{ borderColor: '#e6ece8', boxShadow: CARD_SHADOW }}>
                        <p className="text-lg font-black">未创建用户身份</p>
                        <p className="text-xs leading-relaxed" style={{ color: PAPER_TONES.inkSoft }}>
                            用户身份会控制聊天中使用的名字、头像和自我描述。
                        </p>
                        <button
                            onClick={() => handleCreate(true)}
                            className={`px-4 py-2.5 text-xs font-black ${INK_BTN}`}
                        >
                            从当前档案创建身份
                        </button>
                    </div>
                )}

                {/* ── 身份照片墙 ── */}
                <div className="grid grid-cols-2 gap-3">
                    {visiblePersonas.map((p) => {
                        const isActive = activeId === p.id;
                        const bindingCount = p.connections?.length || 0;
                        const avatarSrc = usablePhoto(p.avatar) || usablePhoto(userProfile.avatar);
                        return (
                        <button
                            key={p.id}
                            onClick={() => activatePersona(p)}
                            className="relative bg-white border rounded-[16px] p-2 pb-3 text-left transition-all active:scale-[0.98]"
                            style={isActive ? { borderColor: ROSE, boxShadow: CARD_SHADOW } : { borderColor: '#e6ece8', boxShadow: '0 8px 18px -16px rgba(44,65,72,0.30)' }}
                        >
                            {isActive && (
                                <span className="absolute top-3 left-3 z-10 rounded-full px-2 py-0.5 text-[9px] font-black text-white" style={{ background: ROSE }}>
                                    启用中
                                </span>
                            )}
                            <div className="aspect-[4/5] rounded-[11px] overflow-hidden bg-[#edf5f7]">
                                {avatarSrc ? (
                                    <img src={avatarSrc} className="w-full h-full object-cover" alt={p.name} />
                                ) : (
                                    <PhotoPlaceholder />
                                )}
                            </div>
                            <div className="pt-2 min-w-0">
                                <div className="flex items-start justify-between gap-2">
                                    <h3 className="text-sm font-black truncate">{p.name}</h3>
                                    <div className="flex items-center gap-1 shrink-0">
                                        {defaultId === p.id && <PushPin size={12} weight="fill" color={ROSE_DARK} />}
                                        {bindingCount > 0 && <Paperclip size={12} weight="bold" color={ROSE_DARK} className="opacity-70" />}
                                        {p.lorebookCategory && <BookOpenText size={12} weight="bold" color={ROSE_DARK} className="opacity-70" />}
                                    </div>
                                </div>
                                <p className="text-[11px] truncate mt-0.5" style={{ color: PAPER_TONES.inkSoft }}>
                                    {p.title || p.description || '未填写身份描述'}
                                </p>
                                <div className="mt-2 flex flex-wrap gap-1">
                                    {defaultId === p.id && <span className="rounded-full border px-1.5 py-0.5 text-[8px]" style={{ borderColor: BORDER, color: ROSE_DARK }}>默认</span>}
                                    {bindingCount > 0 && <span className="rounded-full border px-1.5 py-0.5 text-[8px]" style={{ borderColor: BORDER, color: ROSE_DARK }}>绑定 {bindingCount}</span>}
                                </div>
                            </div>
                        </button>
                    );
                    })}

                </div>
                    </>
                )}

                {/* ── 当前身份编辑区 ── */}
                {view === 'detail' && selected && (
                    <div className="relative bg-white border rounded-[18px] p-5 space-y-5" style={{ borderColor: '#e6ece8', boxShadow: CARD_SHADOW }}>
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <div className="text-[8px] tracking-[0.16em] uppercase" style={{ ...MONO_STACK, color: PAPER_TONES.inkFaint }}>CURRENT IDENTITY</div>
                                <h2 className="text-lg font-black mt-0.5">当前身份资料</h2>
                            </div>
                            {renderMarks(selected)}
                        </div>

                        {/* 头像 + 名称/备注 */}
                        <div className="flex items-start gap-4">
                            <div
                                onClick={() => avatarInputRef.current?.click()}
                                className="shrink-0 bg-white border border-[#dbe5e8] rounded-[14px] p-1.5 pb-5 cursor-pointer relative group"
                                style={{ boxShadow: '0 8px 18px -16px rgba(44,65,72,0.30)' }}
                                title="上传头像"
                            >
                                {usablePhoto(selected.avatar) || usablePhoto(userProfile.avatar) ? (
                                    <img src={usablePhoto(selected.avatar) || usablePhoto(userProfile.avatar)} className="w-20 h-20 object-cover rounded-[10px] group-hover:opacity-75 transition-opacity" alt="用户身份头像" />
                                ) : (
                                    <div className="w-20 h-20 rounded-[10px] overflow-hidden group-hover:opacity-75 transition-opacity"><PhotoPlaceholder /></div>
                                )}
                                <span className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[9px] whitespace-nowrap font-black" style={{ color: ROSE_DARK }}>上传头像</span>
                            </div>
                            <input type="file" ref={avatarInputRef} className="hidden" accept="image/*" onChange={handleAvatarChange} />
                            <div className="flex-1 min-w-0 space-y-3">
                                <div>
                                    <label className="text-[8px] tracking-[0.16em] uppercase block mb-1" style={{ ...MONO_STACK, color: PAPER_TONES.inkFaint }}>身份名称 / NAME</label>
                                    <input
                                        value={selected.name}
                                        onChange={e => updateSelected({ name: e.target.value })}
                                        className={`${LINE_INPUT} text-base font-black`}
                                        placeholder="聊天中显示的用户名"
                                    />
                                </div>
                                <div>
                                    <label className="text-[8px] tracking-[0.16em] uppercase block mb-1" style={{ ...MONO_STACK, color: PAPER_TONES.inkFaint }}>内部备注 / NOTE</label>
                                    <input
                                        value={selected.title || ''}
                                        onChange={e => updateSelected({ title: e.target.value || undefined })}
                                        className={`${LINE_INPUT} text-[11px]`}
                                        placeholder="仅用于列表识别，不发送给 AI"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* 操作 */}
                        <div className="flex items-center gap-2.5 flex-wrap">
                            <button
                                onClick={() => toggleDefault(selected)}
                                className="px-3 py-1.5 text-[10px] font-black flex items-center gap-1.5 transition-all border rounded-full"
                                style={defaultId === selected.id ? { background: '#edf5f7', borderColor: BORDER, color: ROSE_DARK, boxShadow: CARD_SHADOW } : { background: '#f8fbfb', borderColor: BORDER, color: ROSE_DARK }}
                                title="默认身份：未绑定角色的聊天会自动使用"
                            >
                                <PushPin size={12} weight={defaultId === selected.id ? 'fill' : 'bold'} />
                                {defaultId === selected.id ? '默认身份' : '设为默认'}
                            </button>
                            <button
                                onClick={() => setConnectionsTarget(selected)}
                                className={`px-3 py-1.5 text-[10px] font-black flex items-center gap-1.5 ${STICKER}`}
                                title="绑定角色：进入该角色聊天时自动使用此身份"
                            >
                                <Paperclip size={12} weight="bold" />
                                绑定角色{selectedConnections.length > 0 ? ` ×${selectedConnections.length}` : ''}
                            </button>
                            <button
                                onClick={() => handleDuplicate(selected)}
                                className={`px-3 py-1.5 text-[10px] font-black flex items-center gap-1.5 ${STICKER}`}
                                title="复制此身份"
                            >
                                <CopySimple size={12} weight="bold" /> 复制
                            </button>
                            <button
                                onClick={() => setConfirmDelete(selected)}
                                className="px-3 py-1.5 text-[10px] font-black flex items-center gap-1.5 border rounded-full bg-white press-soft"
                                style={{ borderColor: BORDER, color: '#b36a5e' }}
                                title="删除此身份"
                            >
                                <Trash size={12} weight="bold" /> 删除
                            </button>
                        </div>

                        {/* 身份描述 */}
                        <div>
                            <div className="flex items-end justify-between mb-1">
                                <label className="text-[8px] tracking-[0.16em] uppercase" style={{ ...MONO_STACK, color: PAPER_TONES.inkFaint }}>身份描述 / ABOUT ME</label>
                                <span className="text-[8px]" style={{ ...MONO_STACK, color: PAPER_TONES.inkFaint }}>≈ {estimateTokens(selected.description || '')} TK</span>
                            </div>
                            <textarea
                                value={selected.description}
                                onChange={e => updateSelected({ description: e.target.value })}
                                className={`${AREA_INPUT} h-32`}
                                placeholder="向 AI 介绍这个身份下的你。支持 {{char}} / {{user}} 宏。"
                            />
                        </div>

                        {/* 拍一拍后缀（全局，不分身份）：别人「拍了拍 你 的<后缀>」里的后缀 */}
                        <div>
                            <label className="text-[8px] tracking-[0.16em] uppercase mb-1.5 block" style={{ ...MONO_STACK, color: PAPER_TONES.inkFaint }}>拍一拍后缀 / PAT</label>
                            <input
                                value={userProfile.patSuffix ?? ''}
                                onChange={e => updateUserProfile({ patSuffix: e.target.value.slice(0, 20) })}
                                className={LINE_INPUT}
                                placeholder="脑袋 / 肩膀 / 头发…（拍了拍 你 的___）"
                                maxLength={20}
                            />
                        </div>

                        {/* 描述注入方式（ST persona_description_position） */}
                        <div>
                            <label className="text-[8px] tracking-[0.16em] uppercase mb-1.5 block" style={{ ...MONO_STACK, color: PAPER_TONES.inkFaint }}>描述注入方式 / DELIVERY</label>
                            <div className="flex gap-2">
                                {SEND_MODES.map((m, i) => {
                                    const on = selectedSendMode === m.value;
                                    return (
                                        <button
                                            key={m.value}
                                            onClick={() => updateSelected({ position: m.value })}
                                            className="flex-1 px-1 py-2 border rounded-[14px] flex flex-col items-center gap-0.5 transition-all active:translate-y-[1px]"
                                            style={on ? { background: '#edf5f7', borderColor: BORDER, color: INK, boxShadow: CARD_SHADOW } : { background: '#f8fbfb', borderColor: BORDER, color: PAPER_TONES.inkFaint }}
                                        >
                                            <span className="text-[7px] opacity-60" style={MONO_STACK}>{m.en}</span>
                                            <span className="text-[10px] font-black">{m.label}</span>
                                        </button>
                                    );
                                })}
                            </div>
                            <p className="text-[12px] mt-1.5 leading-relaxed" style={NOTE_TEXT}>
                                {SEND_MODES.find(m => m.value === selectedSendMode)?.hint}
                            </p>
                            {selectedSendMode === PERSONA_POSITION.AT_DEPTH && (
                                <div className="grid grid-cols-2 gap-3 mt-2 border-l-2 border-dashed border-[#dbe5e8] pl-3">
                                    <div>
                                        <label className="text-[8px] mb-1 block" style={{ ...MONO_STACK, color: PAPER_TONES.inkFaint }}>插入深度（0 = 最新消息后）</label>
                                        <input
                                            type="number" min={0} max={999}
                                            value={selected.depth ?? 2}
                                            onChange={e => updateSelected({ depth: Math.max(0, Number(e.target.value) || 0) })}
                                            className={`${LINE_INPUT} font-bold`}
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[8px] mb-1 block" style={{ ...MONO_STACK, color: PAPER_TONES.inkFaint }}>消息角色</label>
                                        <div className="space-y-1">
                                            {VOICE_CHIPS.map(r => {
                                                const on = (selected.role ?? 0) === r.value;
                                                return (
                                                    <button
                                                        key={r.value}
                                                        onClick={() => updateSelected({ role: r.value })}
                                                        className="w-full px-2 py-1 text-[9px] font-bold border text-left transition-all rounded-full"
                                                        style={on ? { borderColor: BORDER, background: '#edf5f7', color: ROSE_DARK } : { borderColor: BORDER, background: '#f8fbfb', color: PAPER_TONES.inkSoft }}
                                                    >
                                                        {on ? '◉ ' : '○ '}{r.label}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* 绑定世界书分组（ST persona lorebook） */}
                        <div>
                            <label className="text-[8px] tracking-[0.16em] uppercase mb-1.5 block" style={{ ...MONO_STACK, color: PAPER_TONES.inkFaint }}>绑定世界书分组 / WORLD BOOK</label>
                            <div className="relative">
                                <select
                                    value={selected.lorebookCategory || ''}
                                    onChange={e => updateSelected({ lorebookCategory: e.target.value || undefined })}
                                    className={`${LINE_INPUT} appearance-none font-bold`}
                                >
                                    <option value="">不绑定世界书</option>
                                    {worldbookCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                                </select>
                                <span aria-hidden className="absolute right-3 top-1/2 -translate-y-1/2 text-xs pointer-events-none">▾</span>
                            </div>
                            <p className="text-[12px] mt-1.5 leading-relaxed" style={NOTE_TEXT}>
                                启用此身份聊天时，所选世界书分组会按条目设置一并注入。
                            </p>
                        </div>
                    </div>
                )}
                {view === 'detail' && !selected && (
                    <div className="bg-white border rounded-[18px] p-6 text-center" style={{ borderColor: '#e6ece8', color: PAPER_TONES.inkSoft }}>
                        未选择身份。请返回列表选择一张身份照片。
                    </div>
                )}

                {/* ── 备份恢复 ── */}
                {view === 'list' && (
                    <>
                        <div className="relative border rounded-[18px] bg-white/75 p-3" style={{ borderColor: '#e6ece8', boxShadow: '0 1px 2px rgba(44,65,72,0.06)' }}>
                            <span className="absolute -top-2 left-3 px-1.5 bg-[#fafafa] text-[8px]" style={{ ...MONO_STACK, color: PAPER_TONES.inkFaint }}>BACKUP / 数据管理</span>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={handleBackup}
                                    className={`flex-1 py-2 text-[10px] font-black flex items-center justify-center gap-1.5 ${STICKER}`}
                                    title="导出所有用户身份为 JSON"
                                >
                                    <Package size={13} weight="bold" /> 备份身份
                                </button>
                                <button
                                    onClick={() => restoreInputRef.current?.click()}
                                    className={`flex-1 py-2 text-[10px] font-black flex items-center justify-center gap-1.5 ${STICKER}`}
                                    title="从 JSON 恢复用户身份"
                                >
                                    <ClockCounterClockwise size={13} weight="bold" /> 恢复身份
                                </button>
                                <input type="file" ref={restoreInputRef} className="hidden" accept=".json,application/json" onChange={handleRestore} />
                            </div>
                        </div>

                        {/* 页脚说明 */}
                        <p className="text-center text-[12px] pb-5 leading-relaxed" style={{ color: PAPER_TONES.inkFaint }}>
                            点击身份照片即可启用并进入资料编辑。
                        </p>
                    </>
                )}
            </div>

            {/* ── 删除确认 ── */}
            <PaperSheet
                open={!!confirmDelete}
                tag="DELETE / 不可复原"
                title="删除身份？"
                onClose={() => setConfirmDelete(null)}
                footer={confirmDelete ? (
                    <>
                        <button
                            onClick={() => setConfirmDelete(null)}
                            className={`flex-1 py-2.5 text-xs font-black ${STICKER}`}
                        >
                            取消
                        </button>
                        <button
                            onClick={() => handleDelete(confirmDelete)}
                            className={`flex-1 py-2.5 text-xs font-black ${INK_BTN}`}
                        >
                            确认删除
                        </button>
                    </>
                ) : undefined}
            >
                {confirmDelete && (
                    <div className="text-sm leading-relaxed space-y-2" style={{ color: PAPER_TONES.inkSoft }}>
                        <p>删除「{confirmDelete.name}」后无法撤销。</p>
                        {defaultId === confirmDelete.id && (
                            <p className="text-xs flex items-center gap-1"><PushPin size={12} weight="fill" /> 它当前是默认身份。</p>
                        )}
                        {activeId === confirmDelete.id && (
                            <p className="text-xs">它当前正在启用。删除不会自动清空用户档案。</p>
                        )}
                    </div>
                )}
            </PaperSheet>

            {/* ── 绑定角色 ── */}
            <PaperSheet
                open={!!connectionsTarget}
                tag="BINDING / 自动切换"
                title={`绑定角色：${connectionsTarget?.name || ''}`}
                onClose={() => setConnectionsTarget(null)}
            >
                {connectionsTarget && (
                    <div className="space-y-2">
                        <p className="text-[12px] leading-relaxed mb-2" style={NOTE_TEXT}>
                            勾选角色后，进入该角色聊天时会自动启用这个用户身份。一个角色只能绑定一个身份。
                        </p>
                        {characters.length === 0 && (
                            <p className="text-xs text-center py-3 border border-dashed rounded-[14px]" style={{ borderColor: BORDER, color: PAPER_TONES.inkFaint }}>
                                暂无角色。请先在「登场人物」中新建或导入角色。
                            </p>
                        )}
                        {characters.map(c => {
                            const bound = (connectionsTarget.connections || []).some(conn => conn.type === 'character' && conn.id === c.id);
                            const boundElsewhere = !bound && personas.some(p => p.id !== connectionsTarget.id && (p.connections || []).some(conn => conn.type === 'character' && conn.id === c.id));
                            return (
                                <button
                                    key={c.id}
                                    onClick={() => toggleConnection(connectionsTarget, c.id)}
                                    className="w-full p-2.5 flex items-center gap-3 transition-all active:scale-[0.99] border rounded-[14px] bg-white"
                                    style={bound ? { borderColor: ROSE, boxShadow: CARD_SHADOW } : { borderColor: BORDER }}
                                >
                                    <img src={c.avatar} className="w-8 h-8 object-cover border shrink-0 rounded-[8px]" style={{ borderColor: BORDER }} />
                                    <span className="flex-1 text-left text-xs font-black truncate">{c.name}</span>
                                    {boundElsewhere && <span className="text-[9px] shrink-0" style={{ color: PAPER_TONES.inkFaint }}>已绑定其他身份</span>}
                                    <span className="w-4 h-4 border rounded-full shrink-0 flex items-center justify-center" style={{ borderColor: BORDER, background: bound ? ROSE : '#fff' }}>
                                        {bound && <svg viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth={4.5} className="w-2.5 h-2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                )}
            </PaperSheet>
        </div>
    );
};

export default PersonaApp;
