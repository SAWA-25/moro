/**
 * 人设 App —— SillyTavern Persona Management 的 Moro 移植。
 *
 * 功能对齐 ST 人设管理面板：
 *  - 多套人设（名字 / 头像 / 小标题 / 描述），搜索 / 排序 / 网格-列表切换
 *  - 点击人设即启用（写入档案，聊天气泡与 prompt 全链路生效）
 *  - 设为默认（👑）/ 绑定角色（进对应聊天自动切换）/ 复制 / 删除
 *  - 描述注入位置：嵌入提示词 / @Depth（深度 + role）/ 不注入
 *  - 绑定世界书分组（=ST 人设世界书），主聊天时该组条目自动注入
 *  - 备份 / 恢复（JSON）
 *
 * 数据存 IndexedDB `personas` store；激活/默认 id 存 localStorage（见 utils/personas.ts）。
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { processImage } from '../utils/file';
import { Persona, PERSONA_POSITION } from '../types';
import { PersonaRuntime, PERSONA_POSITION_OPTIONS, createPersona, normalizePersonaPosition } from '../utils/personas';
import { estimateTokens } from '../utils/presets';
import Modal from '../components/os/Modal';
import {
    Crown, Link as LinkIcon, Copy, Skull, Plus, UploadSimple, DownloadSimple,
    MagnifyingGlass, SortAscending, SortDescending, SquaresFour, List as ListIcon, Globe,
} from '@phosphor-icons/react';

const DEPTH_ROLE_LABELS: { value: 0 | 1 | 2; label: string }[] = [
    { value: 0, label: '系统 (System)' },
    { value: 1, label: '用户 (User)' },
    { value: 2, label: 'AI (Assistant)' },
];

/** onExit：人设库（PersonaHubApp）嵌入时返回选择页；不传则关闭 App 回桌面（旧行为） */
const PersonaApp: React.FC<{ onExit?: () => void }> = ({ onExit }) => {
    const { closeApp: closeAppOS, addToast, userProfile, updateUserProfile, characters, worldbooks } = useOS();
    const closeApp = onExit || closeAppOS;

    const [personas, setPersonas] = useState<Persona[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [activeId, setActiveId] = useState<string | null>(PersonaRuntime.getActiveId());
    const [defaultId, setDefaultId] = useState<string | null>(PersonaRuntime.getDefaultId());
    const [selectedId, setSelectedId] = useState<string | null>(null);

    const [search, setSearch] = useState('');
    const [sortAsc, setSortAsc] = useState(true);
    const [gridView, setGridView] = useState(false);

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
            addToast('人设加载失败', 'error');
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
        // 编辑的是当前启用的人设 → 档案同步跟着改（聊天链路读档案）
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

    // ── 操作（对齐 ST 人设面板按钮） ───────────────────────

    /** 点击人设 = 启用（同 ST 点击 persona 头像块） */
    const activatePersona = (p: Persona) => {
        setSelectedId(p.id);
        PersonaRuntime.setActiveId(p.id);
        setActiveId(p.id);
        const updates: Partial<typeof userProfile> = { name: p.name, bio: p.description };
        if (p.avatar) updates.avatar = p.avatar;
        updateUserProfile(updates);
        addToast(`已启用人设：${p.name}`, 'success');
    };

    const handleCreate = async (fromProfile = false) => {
        const p = createPersona(fromProfile
            ? { name: userProfile.name || '新人设', avatar: userProfile.avatar || '', description: userProfile.bio || '' }
            : { name: `新人设 ${personas.length + 1}`, avatar: userProfile.avatar || '' });
        setPersonas(prev => [...prev, p]);
        try { await DB.savePersona(p); } catch (e) { console.error('[Personas] 保存失败:', e); }
        setSelectedId(p.id);
        if (fromProfile) {
            PersonaRuntime.setActiveId(p.id);
            setActiveId(p.id);
            addToast('已把当前档案保存为人设并启用', 'success');
        } else {
            addToast('已新建人设', 'success');
        }
    };

    /** 设为默认（👑）：无绑定的聊天会自动用默认人设；再点一次取消 */
    const toggleDefault = (p: Persona) => {
        const next = defaultId === p.id ? null : p.id;
        PersonaRuntime.setDefaultId(next);
        setDefaultId(next);
        addToast(next ? `已把「${p.name}」设为默认人设` : '已取消默认人设', 'info');
    };

    const handleDuplicate = async (p: Persona) => {
        const copy = createPersona({
            ...p,
            id: undefined as any, createdAt: undefined as any, updatedAt: undefined as any,
            name: `${p.name} (副本)`,
            connections: undefined, // 绑定不复制：一个角色只该绑一套人设
        });
        setPersonas(prev => [...prev, copy]);
        try { await DB.savePersona(copy); } catch (e) { console.error('[Personas] 保存失败:', e); }
        setSelectedId(copy.id);
        addToast(`已复制为「${copy.name}」`, 'success');
    };

    const handleDelete = async (p: Persona) => {
        setPersonas(prev => prev.filter(x => x.id !== p.id));
        try { await DB.deletePersona(p.id); } catch (e) { console.error('[Personas] 删除失败:', e); }
        if (PersonaRuntime.getActiveId() === p.id) { PersonaRuntime.setActiveId(null); setActiveId(null); }
        if (PersonaRuntime.getDefaultId() === p.id) { PersonaRuntime.setDefaultId(null); setDefaultId(null); }
        if (selectedId === p.id) setSelectedId(null);
        setConfirmDelete(null);
        addToast(`已删除人设「${p.name}」`, 'info');
    };

    const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file && selected) {
            try {
                const base64 = await processImage(file);
                updateSelected({ avatar: base64 });
                addToast('人设头像已更新', 'success');
            } catch (err: any) {
                addToast(err.message, 'error');
            }
        }
        if (avatarInputRef.current) avatarInputRef.current.value = '';
    };

    /** 绑定/解绑角色。同 ST 默认行为：一个角色同时只绑一套人设，绑到这套时从其他人设上摘掉 */
    const toggleConnection = async (persona: Persona, charId: string) => {
        const has = (persona.connections || []).some(c => c.type === 'character' && c.id === charId);
        if (has) {
            const next = { ...persona, connections: (persona.connections || []).filter(c => !(c.type === 'character' && c.id === charId)) };
            await persist(next);
            setConnectionsTarget(next);
            return;
        }
        // 从其他人设上摘掉该角色
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

    // ── 备份 / 恢复 ────────────────────────────────────────

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
        addToast(`已导出 ${personas.length} 套人设`, 'success');
    };

    const handleRestore = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        (async () => {
            try {
                const data = JSON.parse(await file.text());
                const list: any[] = Array.isArray(data?.personas) ? data.personas : (Array.isArray(data) ? data : []);
                if (list.length === 0) throw new Error('文件里没有可导入的人设');
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
                addToast(`人设恢复完成：新增 ${added} 套，更新 ${updated} 套`, 'success');
            } catch (err: any) {
                addToast(err?.message || '人设恢复失败', 'error');
            } finally {
                if (restoreInputRef.current) restoreInputRef.current.value = '';
            }
        })();
    };

    // ── 渲染 ───────────────────────────────────────────────

    const renderBadges = (p: Persona) => (
        <div className="flex items-center gap-1 shrink-0">
            {activeId === p.id && <span className="text-[9px] font-bold bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">当前</span>}
            {defaultId === p.id && <Crown size={12} weight="fill" className="text-amber-400" />}
            {(p.connections?.length || 0) > 0 && <LinkIcon size={12} weight="bold" className="text-sky-400" />}
            {p.lorebookCategory && <Globe size={12} weight="bold" className="text-indigo-400" />}
        </div>
    );

    const selectedConnections = (selected?.connections || []).filter(c => c.type === 'character');

    return (
        <div className="h-full w-full bg-slate-50 flex flex-col animate-fade-in">
            {/* Header */}
            <div className="h-20 bg-white/70 backdrop-blur-md flex items-end pb-3 px-4 border-b border-white/40 shrink-0 sticky top-0 z-10">
                <div className="flex items-center gap-2 w-full">
                    <button onClick={closeApp} className="p-2 -ml-2 rounded-full hover:bg-black/5 active:scale-90 transition-transform">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-slate-600">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                        </svg>
                    </button>
                    <h1 className="text-xl font-medium text-slate-700 tracking-wide flex-1">人设</h1>
                    <button onClick={handleBackup} className="p-2 rounded-full hover:bg-black/5 active:scale-90 transition-transform" title="备份全部人设 (JSON)">
                        <DownloadSimple size={18} weight="bold" className="text-slate-500" />
                    </button>
                    <button onClick={() => restoreInputRef.current?.click()} className="p-2 rounded-full hover:bg-black/5 active:scale-90 transition-transform" title="从 JSON 恢复人设">
                        <UploadSimple size={18} weight="bold" className="text-slate-500" />
                    </button>
                    <input type="file" ref={restoreInputRef} className="hidden" accept=".json,application/json" onChange={handleRestore} />
                    <button onClick={() => handleCreate(false)} className="p-2 rounded-full bg-primary text-white shadow-sm shadow-primary/30 active:scale-90 transition-transform" title="新建人设">
                        <Plus size={18} weight="bold" />
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto no-scrollbar p-4 space-y-4">
                {/* 工具条：搜索 / 排序 / 视图 */}
                <div className="flex items-center gap-2">
                    <div className="flex-1 flex items-center gap-2 bg-white rounded-full px-3 py-2 border border-slate-200">
                        <MagnifyingGlass size={14} className="text-slate-400 shrink-0" />
                        <input
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="搜索人设（名字 / 描述）..."
                            className="flex-1 bg-transparent text-xs text-slate-700 outline-none placeholder:text-slate-300"
                        />
                    </div>
                    <button onClick={() => setSortAsc(v => !v)} className="p-2 rounded-full bg-white border border-slate-200 active:scale-90 transition-transform" title={sortAsc ? '按名字 A→Z（点击反转）' : '按名字 Z→A（点击反转）'}>
                        {sortAsc ? <SortAscending size={14} className="text-slate-500" /> : <SortDescending size={14} className="text-slate-500" />}
                    </button>
                    <button onClick={() => setGridView(v => !v)} className="p-2 rounded-full bg-white border border-slate-200 active:scale-90 transition-transform" title={gridView ? '切换列表视图' : '切换网格视图'}>
                        {gridView ? <ListIcon size={14} className="text-slate-500" /> : <SquaresFour size={14} className="text-slate-500" />}
                    </button>
                </div>

                {/* 空状态：建议从档案迁移（同 ST 首次进入的人设迁移） */}
                {loaded && personas.length === 0 && (
                    <div className="bg-white/60 border border-white rounded-3xl p-6 text-center space-y-3">
                        <p className="text-sm text-slate-500">还没有人设。人设是「你是谁」的多套档案 —— 不同角色面前可以用不同的名字、头像和自我介绍。</p>
                        <button onClick={() => handleCreate(true)} className="px-4 py-2 bg-primary text-white text-xs font-bold rounded-full shadow-sm shadow-primary/30 active:scale-95 transition-transform">
                            把当前档案保存为第一套人设
                        </button>
                    </div>
                )}

                {/* 人设列表 */}
                <div className={gridView ? 'grid grid-cols-3 gap-2' : 'space-y-2'}>
                    {visiblePersonas.map(p => gridView ? (
                        <button
                            key={p.id}
                            onClick={() => activatePersona(p)}
                            className={`p-3 rounded-3xl border bg-white/60 flex flex-col items-center gap-1.5 transition-all active:scale-95 ${activeId === p.id ? 'border-primary/40 ring-2 ring-primary/20' : 'border-white/60 hover:bg-white'}`}
                        >
                            <img src={p.avatar || userProfile.avatar} className="w-12 h-12 rounded-full object-cover shadow-sm" />
                            <span className="text-[11px] font-bold text-slate-600 truncate w-full text-center">{p.name}</span>
                            {renderBadges(p)}
                        </button>
                    ) : (
                        <div
                            key={p.id}
                            onClick={() => activatePersona(p)}
                            className={`p-3 rounded-3xl border bg-white/60 flex items-center gap-3 cursor-pointer transition-all hover:bg-white ${activeId === p.id ? 'border-primary/40 ring-2 ring-primary/20' : 'border-white/60'}`}
                        >
                            <img src={p.avatar || userProfile.avatar} className="w-11 h-11 rounded-full object-cover shadow-sm shrink-0" />
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                    <span className="text-sm font-bold text-slate-700 truncate">{p.name}</span>
                                    {p.title && <span className="text-[10px] text-slate-400 truncate">「{p.title}」</span>}
                                </div>
                                <p className="text-[10px] text-slate-400 truncate">{p.description || '（无描述）'}</p>
                            </div>
                            {renderBadges(p)}
                        </div>
                    ))}
                </div>

                {/* 编辑面板（对齐 ST 右栏） */}
                {selected && (
                    <div className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100 space-y-4">
                        <div className="flex items-center gap-4">
                            <div onClick={() => avatarInputRef.current?.click()} className="w-16 h-16 rounded-full bg-slate-100 shadow-sm cursor-pointer group relative shrink-0" title="更换人设头像">
                                <img src={selected.avatar || userProfile.avatar} className="w-full h-full rounded-full object-cover group-hover:opacity-80 transition-opacity" />
                                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                    <span className="text-[9px] font-bold text-slate-600 bg-white/80 px-1.5 py-0.5 rounded-full">更换</span>
                                </div>
                            </div>
                            <input type="file" ref={avatarInputRef} className="hidden" accept="image/*" onChange={handleAvatarChange} />
                            <div className="flex-1 min-w-0 space-y-1.5">
                                <input
                                    value={selected.name}
                                    onChange={e => updateSelected({ name: e.target.value })}
                                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold text-slate-700 focus:border-primary outline-none transition-all"
                                    placeholder="人设名（聊天中作为你的名字）"
                                />
                                <input
                                    value={selected.title || ''}
                                    onChange={e => updateSelected({ title: e.target.value || undefined })}
                                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-[11px] text-slate-500 focus:border-primary outline-none transition-all"
                                    placeholder="小标题（仅展示，不发给 AI）"
                                />
                            </div>
                        </div>

                        {/* 操作按钮排（对齐 ST 图标排：👑 默认 / 🔗 绑定 / 复制 / 💀 删除） */}
                        <div className="flex items-center gap-2 flex-wrap">
                            <button
                                onClick={() => toggleDefault(selected)}
                                className={`px-3 py-1.5 rounded-full text-[10px] font-bold flex items-center gap-1 active:scale-95 transition-all ${defaultId === selected.id ? 'bg-amber-100 text-amber-600' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                                title="默认人设：没有绑定人设的聊天自动用它"
                            >
                                <Crown size={12} weight={defaultId === selected.id ? 'fill' : 'bold'} /> {defaultId === selected.id ? '默认人设' : '设为默认'}
                            </button>
                            <button
                                onClick={() => setConnectionsTarget(selected)}
                                className="px-3 py-1.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-500 hover:bg-slate-200 flex items-center gap-1 active:scale-95 transition-all"
                                title="绑定角色：进入对应聊天时自动切换到这套人设"
                            >
                                <LinkIcon size={12} weight="bold" /> 绑定角色{selectedConnections.length > 0 ? ` (${selectedConnections.length})` : ''}
                            </button>
                            <button
                                onClick={() => handleDuplicate(selected)}
                                className="px-3 py-1.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-500 hover:bg-slate-200 flex items-center gap-1 active:scale-95 transition-all"
                            >
                                <Copy size={12} weight="bold" /> 复制
                            </button>
                            <button
                                onClick={() => setConfirmDelete(selected)}
                                className="px-3 py-1.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-500 hover:bg-rose-100 flex items-center gap-1 active:scale-95 transition-all"
                            >
                                <Skull size={12} weight="bold" /> 删除
                            </button>
                        </div>

                        {/* 描述 */}
                        <div>
                            <div className="flex items-center justify-between mb-1.5">
                                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">人设描述</label>
                                <span className="text-[9px] text-slate-300">≈ {estimateTokens(selected.description || '')} tokens</span>
                            </div>
                            <textarea
                                value={selected.description}
                                onChange={e => updateSelected({ description: e.target.value })}
                                className="w-full h-32 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-xs text-slate-700 leading-relaxed resize-none focus:border-primary outline-none transition-all"
                                placeholder="向 AI 介绍这套身份下的你（支持 {{char}} / {{user}} 宏）..."
                            />
                        </div>

                        {/* 注入位置（ST persona_description_position） */}
                        <div>
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block">描述注入位置</label>
                            <select
                                value={normalizePersonaPosition(selected.position)}
                                onChange={e => updateSelected({ position: Number(e.target.value) })}
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-700 outline-none focus:border-primary"
                            >
                                {PERSONA_POSITION_OPTIONS.map(opt => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                            </select>
                            <p className="text-[9px] text-slate-400 mt-1 pl-1 leading-relaxed">
                                {PERSONA_POSITION_OPTIONS.find(o => o.value === normalizePersonaPosition(selected.position))?.hint}
                            </p>
                            {normalizePersonaPosition(selected.position) === PERSONA_POSITION.AT_DEPTH && (
                                <div className="grid grid-cols-2 gap-2 mt-2">
                                    <div>
                                        <label className="text-[9px] text-slate-400 mb-1 block pl-1">深度（0 = 紧贴最后一条消息）</label>
                                        <input
                                            type="number" min={0} max={999}
                                            value={selected.depth ?? 2}
                                            onChange={e => updateSelected({ depth: Math.max(0, Number(e.target.value) || 0) })}
                                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-700 outline-none focus:border-primary"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[9px] text-slate-400 mb-1 block pl-1">消息身份 (Role)</label>
                                        <select
                                            value={selected.role ?? 0}
                                            onChange={e => updateSelected({ role: Number(e.target.value) as 0 | 1 | 2 })}
                                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-700 outline-none focus:border-primary"
                                        >
                                            {DEPTH_ROLE_LABELS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                                        </select>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* 人设世界书（ST persona lorebook → 世界书分组绑定） */}
                        <div>
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block">绑定世界书</label>
                            <select
                                value={selected.lorebookCategory || ''}
                                onChange={e => updateSelected({ lorebookCategory: e.target.value || undefined })}
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-700 outline-none focus:border-primary"
                            >
                                <option value="">不绑定</option>
                                {worldbookCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                            </select>
                            <p className="text-[9px] text-slate-400 mt-1 pl-1 leading-relaxed">
                                启用这套人设聊天时，所选分组下的世界书条目即使没挂载到角色也会按各自的位置 / 开关注入（同酒馆的人设世界书）。
                            </p>
                        </div>
                    </div>
                )}

                <p className="text-[10px] text-slate-300 text-center pb-4 leading-relaxed">
                    点击人设即启用：名字 / 头像 / 描述会写入「档案」，聊天与 prompt 立即生效。<br />
                    启用预设 App 时，人设描述对应 Persona Description 占位。
                </p>
            </div>

            {/* 删除确认 */}
            <Modal
                isOpen={!!confirmDelete}
                title="删除人设"
                onClose={() => setConfirmDelete(null)}
                footer={confirmDelete ? (
                    <>
                        <button onClick={() => setConfirmDelete(null)} className="flex-1 py-3 bg-slate-100 text-slate-500 font-bold rounded-2xl active:scale-95 transition-transform">取消</button>
                        <button onClick={() => handleDelete(confirmDelete)} className="flex-1 py-3 bg-rose-500 text-white font-bold rounded-2xl active:scale-95 transition-transform">删除</button>
                    </>
                ) : undefined}
            >
                {confirmDelete && (
                    <p className="text-sm text-slate-500 text-center leading-relaxed">
                        确定删除人设「{confirmDelete.name}」吗？此操作不可恢复。
                        {defaultId === confirmDelete.id && <><br /><span className="text-amber-500 text-xs">它是当前的默认人设。</span></>}
                        {activeId === confirmDelete.id && <><br /><span className="text-rose-400 text-xs">它是当前启用中的人设（档案内容不受影响）。</span></>}
                    </p>
                )}
            </Modal>

            {/* 绑定角色 */}
            <Modal
                isOpen={!!connectionsTarget}
                title={`绑定角色 — ${connectionsTarget?.name || ''}`}
                onClose={() => setConnectionsTarget(null)}
            >
                {connectionsTarget && (
                    <div className="space-y-2">
                        <p className="text-[10px] text-slate-400 leading-relaxed mb-2">
                            进入勾选角色的聊天时会自动切换到这套人设（一个角色同时只能绑一套；在这里勾选会自动从其他人设上解绑）。
                        </p>
                        {characters.length === 0 && <p className="text-xs text-slate-400 text-center">还没有角色，先去「神经链接」创建或导入。</p>}
                        {characters.map(c => {
                            const bound = (connectionsTarget.connections || []).some(conn => conn.type === 'character' && conn.id === c.id);
                            const boundElsewhere = !bound && personas.some(p => p.id !== connectionsTarget.id && (p.connections || []).some(conn => conn.type === 'character' && conn.id === c.id));
                            return (
                                <button
                                    key={c.id}
                                    onClick={() => toggleConnection(connectionsTarget, c.id)}
                                    className={`w-full p-2.5 rounded-2xl border flex items-center gap-3 transition-all active:scale-[0.98] ${bound ? 'border-primary/40 bg-primary/5' : 'border-slate-100 bg-slate-50 hover:bg-slate-100'}`}
                                >
                                    <img src={c.avatar} className="w-8 h-8 rounded-full object-cover shrink-0" />
                                    <span className="flex-1 text-left text-xs font-bold text-slate-600 truncate">{c.name}</span>
                                    {boundElsewhere && <span className="text-[9px] text-slate-300 shrink-0">已绑其他人设</span>}
                                    <span className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${bound ? 'border-primary bg-primary' : 'border-slate-300'}`}>
                                        {bound && <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={4} className="w-2.5 h-2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                )}
            </Modal>
        </div>
    );
};

export default PersonaApp;
