/**
 * 扮相手账 —— SillyTavern Persona Management 的 Moro 移植（用户人设管理）。
 *
 * UI 为黑白拼贴手账风（纸面 / 胶带 / 贴纸按钮 / 拍立得 / 印章），功能对齐 ST 人设面板：
 *  - 多套扮相（署名 / 照片 / 页角注记 / 自述），翻找 / 页序排序 / 摊开-叠起视图
 *  - 点击某页即戴上（写入档案，聊天气泡与 prompt 全链路生效）
 *  - 钉为常驻（=ST 默认人设）/ 别在角色上（进对应聊天自动换页）/ 剪一份 / 撕掉
 *  - 自述寄送方式：缝进提示词 / 夹进对话（@Depth，深度 + 口吻）/ 压在箱底（不注入）
 *  - 随页夹带世界书分组（=ST 人设世界书），主聊天时该组条目自动注入
 *  - 整本装箱 / 拆箱回填（JSON 备份恢复）
 *
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
    PushPin, Paperclip, Scissors, Trash, Package, ClockCounterClockwise,
    Binoculars, ArrowsDownUp, GridFour, Rows, BookOpenText, X,
} from '@phosphor-icons/react';

// ── 黑白手账设计 token ─────────────────────────────────────
const INK = '#1c1b1a';
/** 贴纸按钮：硬描边 + 错位实心投影，按下时整张贴纸"按扁" */
const STICKER = 'border-2 border-[#1c1b1a] bg-white shadow-[2px_2px_0_#1c1b1a] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all';
/** 手写中文（手账旁注） */
const HAND_CN: React.CSSProperties = { fontFamily: "'Long Cang', 'Caveat', cursive" };
/** 信纸横线（自述区） */
const RULED_BG: React.CSSProperties = {
    backgroundImage: 'repeating-linear-gradient(transparent, transparent 23px, rgba(28,27,26,0.13) 23px, rgba(28,27,26,0.13) 24px)',
    lineHeight: '24px',
};
/** 内页点纹 */
const DOT_BG: React.CSSProperties = {
    backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(28,27,26,0.10) 1px, transparent 0)',
    backgroundSize: '16px 16px',
};
/** 条形码装饰 */
const BARCODE_BG: React.CSSProperties = {
    backgroundImage: 'repeating-linear-gradient(90deg, #1c1b1a 0 2px, transparent 2px 4px, #1c1b1a 4px 5px, transparent 5px 9px, #1c1b1a 9px 12px, transparent 12px 14px)',
};

/** 一截半透明和纸胶带 */
const Tape: React.FC<{ className?: string }> = ({ className }) => (
    <div
        aria-hidden
        className={`pointer-events-none absolute h-5 w-16 bg-white/60 border-x border-dashed border-[#1c1b1a]/30 shadow-sm backdrop-blur-[1px] ${className || ''}`}
    />
);

/** 自述寄送方式（= ST persona_description_position 的三种语义，文案原创） */
const SEND_MODES: { value: number; label: string; en: string; hint: string }[] = [
    { value: PERSONA_POSITION.IN_PROMPT, label: '缝进提示词', en: 'SEW-IN', hint: '自述缝进开头的「互动对象」一栏；启用预设时落在 Persona Description 占位上。' },
    { value: PERSONA_POSITION.AT_DEPTH, label: '夹进对话', en: 'TUCK-IN', hint: '从最新一条消息往回数 N 层，把自述以指定口吻夹进聊天记录中间。' },
    { value: PERSONA_POSITION.NONE, label: '压在箱底', en: 'KEEP', hint: '自述一个字都不寄出；署名照常生效（{{user}} 与名字行不受影响）。' },
];

/** 夹进对话时的口吻（role） */
const VOICE_CHIPS: { value: 0 | 1 | 2; label: string }[] = [
    { value: 0, label: '旁白印（系统）' },
    { value: 1, label: '你本人（用户）' },
    { value: 2, label: '对面的 TA（AI）' },
];

/** 拼贴弹层：撕边纸卡 + 顶部胶带（替代通用 Modal，保持手账质感） */
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
                    className={`absolute -top-3 -right-3 w-8 h-8 flex items-center justify-center rounded-none rotate-[4deg] ${STICKER}`}
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

/** onExit：剪影集（PersonaHubApp）嵌入时返回封面页；不传则关闭 App 回桌面（旧行为） */
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
            addToast('手账没翻开：扮相加载失败', 'error');
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
        // 编辑的是当前戴着的扮相 → 档案同步跟着改（聊天链路读档案）
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

    /** 点击某页 = 戴上（同 ST 点击 persona 头像块） */
    const activatePersona = (p: Persona) => {
        setSelectedId(p.id);
        PersonaRuntime.setActiveId(p.id);
        setActiveId(p.id);
        const updates: Partial<typeof userProfile> = { name: p.name, bio: p.description };
        if (p.avatar) updates.avatar = p.avatar;
        updateUserProfile(updates);
        addToast(`已换上「${p.name}」这一页`, 'success');
    };

    const handleCreate = async (fromProfile = false) => {
        const p = createPersona(fromProfile
            ? { name: userProfile.name || '新扮相', avatar: userProfile.avatar || '', description: userProfile.bio || '' }
            : { name: `第 ${personas.length + 1} 页扮相`, avatar: userProfile.avatar || '' });
        setPersonas(prev => [...prev, p]);
        try { await DB.savePersona(p); } catch (e) { console.error('[Personas] 保存失败:', e); }
        setSelectedId(p.id);
        if (fromProfile) {
            PersonaRuntime.setActiveId(p.id);
            setActiveId(p.id);
            addToast('已把现在的你誊成第一页，并直接戴上', 'success');
        } else {
            addToast('新的一页已贴进手账', 'success');
        }
    };

    /** 钉为常驻（=ST 默认人设）：没别针的聊天自动用它；再点一次拔掉图钉 */
    const toggleDefault = (p: Persona) => {
        const next = defaultId === p.id ? null : p.id;
        PersonaRuntime.setDefaultId(next);
        setDefaultId(next);
        addToast(next ? `图钉按下：「${p.name}」成为常驻扮相` : '图钉拔起：不再有常驻扮相', 'info');
    };

    const handleDuplicate = async (p: Persona) => {
        const copy = createPersona({
            ...p,
            id: undefined as any, createdAt: undefined as any, updatedAt: undefined as any,
            name: `${p.name}（拓页）`,
            connections: undefined, // 别针不复制：一个角色只该别一页扮相
        });
        setPersonas(prev => [...prev, copy]);
        try { await DB.savePersona(copy); } catch (e) { console.error('[Personas] 保存失败:', e); }
        setSelectedId(copy.id);
        addToast(`剪好了：「${copy.name}」`, 'success');
    };

    const handleDelete = async (p: Persona) => {
        setPersonas(prev => prev.filter(x => x.id !== p.id));
        try { await DB.deletePersona(p.id); } catch (e) { console.error('[Personas] 删除失败:', e); }
        if (PersonaRuntime.getActiveId() === p.id) { PersonaRuntime.setActiveId(null); setActiveId(null); }
        if (PersonaRuntime.getDefaultId() === p.id) { PersonaRuntime.setDefaultId(null); setDefaultId(null); }
        if (selectedId === p.id) setSelectedId(null);
        setConfirmDelete(null);
        addToast(`「${p.name}」这一页已撕下`, 'info');
    };

    const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file && selected) {
            try {
                const base64 = await processImage(file);
                updateSelected({ avatar: base64 });
                addToast('照片已重新贴好', 'success');
            } catch (err: any) {
                addToast(err.message, 'error');
            }
        }
        if (avatarInputRef.current) avatarInputRef.current.value = '';
    };

    /** 别上/取下角色。同 ST 默认行为：一个角色同时只别一页扮相，别到这页时从其他页上摘掉 */
    const toggleConnection = async (persona: Persona, charId: string) => {
        const has = (persona.connections || []).some(c => c.type === 'character' && c.id === charId);
        if (has) {
            const next = { ...persona, connections: (persona.connections || []).filter(c => !(c.type === 'character' && c.id === charId)) };
            await persist(next);
            setConnectionsTarget(next);
            return;
        }
        // 从其他页上摘掉该角色
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

    // ── 装箱 / 拆箱（备份 / 恢复） ─────────────────────────

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
        addToast(`装箱完成：${personas.length} 页扮相已打包带走`, 'success');
    };

    const handleRestore = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        (async () => {
            try {
                const data = JSON.parse(await file.text());
                const list: any[] = Array.isArray(data?.personas) ? data.personas : (Array.isArray(data) ? data : []);
                if (list.length === 0) throw new Error('这个文件里翻不出任何扮相');
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
                addToast(`拆箱完成：新贴 ${added} 页，描补 ${updated} 页`, 'success');
            } catch (err: any) {
                addToast(err?.message || '拆箱失败：文件读不出来', 'error');
            } finally {
                if (restoreInputRef.current) restoreInputRef.current.value = '';
            }
        })();
    };

    // ── 渲染 ───────────────────────────────────────────────

    /** 每页右上角的小记号：佩戴中墨章 / 常驻图钉 / 别针 / 夹带世界书 */
    const renderMarks = (p: Persona) => (
        <div className="flex items-center gap-1 shrink-0">
            {activeId === p.id && (
                <span className="label-mono text-[8px] bg-[#1c1b1a] text-[#f7f5ef] px-1.5 py-0.5 rotate-[-2deg]">佩戴中</span>
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
            className="h-full w-full bg-[#f2f0e9] text-[#1c1b1a] flex flex-col animate-fade-in"
            style={{ ...DOT_BG, paddingTop: 'var(--safe-top)' }}
        >
            {/* ── 刊头：胶带 + 撕边横幅 ── */}
            <div className="relative shrink-0 px-4 pt-3 pb-3 border-b-2 border-dashed border-[#1c1b1a]/30">
                <div className="flex items-center gap-3">
                    <button
                        onClick={closeApp}
                        className={`shrink-0 px-2.5 py-2 rotate-[-2deg] flex items-center gap-1 ${STICKER}`}
                        title="合上这本手账"
                    >
                        <svg viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth={2.5} className="w-3.5 h-3.5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
                        </svg>
                        <span className="text-[10px] font-black">合上</span>
                    </button>
                    <div className="flex-1 min-w-0 relative">
                        <Tape className="-top-4 left-6 rotate-[-5deg] w-12" />
                        <div className="label-mono text-[8px] text-[#1c1b1a]/45">GUISE JOURNAL — WHO AM I TODAY</div>
                        <div className="flex items-baseline gap-2">
                            <h1 className="text-2xl font-black tracking-[0.08em]">扮相手账</h1>
                            <span className="text-sm text-[#1c1b1a]/55" style={HAND_CN}>今天以谁的身份赴约？</span>
                        </div>
                    </div>
                    {/* 藏页数的邮戳 */}
                    <div className="shrink-0 w-12 h-12 rounded-full border-2 border-dashed border-[#1c1b1a]/60 flex flex-col items-center justify-center rotate-[6deg] select-none">
                        <span className="text-base font-black leading-none">{personas.length}</span>
                        <span className="label-mono text-[7px] text-[#1c1b1a]/55 leading-none mt-0.5">页</span>
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto no-scrollbar p-4 space-y-5">
                {/* ── 翻找条：纸条搜索 + 页序 + 摊开/叠起 ── */}
                <div className="flex items-stretch gap-2">
                    <div className="flex-1 flex items-center gap-2 bg-white border-2 border-[#1c1b1a] px-3 rotate-[-0.3deg]">
                        <Binoculars size={15} color={INK} className="shrink-0 opacity-70" />
                        <input
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="翻找某一页…（署名 / 注记 / 自述）"
                            className="flex-1 bg-transparent py-2 text-xs outline-none placeholder:text-[#1c1b1a]/30"
                        />
                    </div>
                    <button
                        onClick={() => setSortAsc(v => !v)}
                        className={`px-2.5 rotate-[1.5deg] flex items-center gap-1 ${STICKER}`}
                        title={sortAsc ? '页序：名字甲→乙（点击倒过来翻）' : '页序：名字乙→甲（点击倒过来翻）'}
                    >
                        <ArrowsDownUp size={14} color={INK} />
                        <span className="label-mono text-[8px]">{sortAsc ? 'A-Z' : 'Z-A'}</span>
                    </button>
                    <button
                        onClick={() => setGridView(v => !v)}
                        className={`px-2.5 rotate-[-1.5deg] flex items-center ${STICKER}`}
                        title={gridView ? '叠起来：一页一条' : '摊开看：满桌拍立得'}
                    >
                        {gridView ? <Rows size={14} color={INK} /> : <GridFour size={14} color={INK} />}
                    </button>
                </div>

                {/* ── 空手账：建议把当前档案誊进来（同 ST 首次进入的人设迁移） ── */}
                {loaded && personas.length === 0 && (
                    <div className="relative bg-[#f7f5ef] border-2 border-[#1c1b1a] shadow-[4px_4px_0_#1c1b1a] p-6 rotate-[-0.6deg] text-center space-y-3">
                        <Tape className="-top-2.5 left-1/2 -translate-x-1/2 rotate-[2deg]" />
                        <p className="text-lg" style={HAND_CN}>这本手账还空着。</p>
                        <p className="text-xs text-[#1c1b1a]/60 leading-relaxed">
                            每一页扮相都是一个「你是谁」：在不同的人面前，可以亮出不同的署名、照片和自述。
                        </p>
                        <button
                            onClick={() => handleCreate(true)}
                            className="px-4 py-2.5 text-xs font-black bg-[#1c1b1a] text-[#f7f5ef] shadow-[3px_3px_0_rgba(28,27,26,0.35)] border-2 border-[#1c1b1a] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all rotate-[0.5deg]"
                        >
                            把现在的我，誊成第一页 →
                        </button>
                    </div>
                )}

                {/* ── 扮相页面：摊开（拍立得网格）/ 叠起（票据条） ── */}
                <div className={gridView ? 'grid grid-cols-3 gap-3' : 'space-y-3'}>
                    {visiblePersonas.map((p, i) => gridView ? (
                        // 拍立得：白框 + 底部署名 + 微旋转
                        <button
                            key={p.id}
                            onClick={() => activatePersona(p)}
                            className={`relative bg-white border-2 p-1.5 pb-2 flex flex-col gap-1.5 transition-all active:scale-95 ${i % 3 === 0 ? 'rotate-[-1.6deg]' : i % 3 === 1 ? 'rotate-[1.2deg]' : 'rotate-[-0.4deg]'} ${activeId === p.id ? 'border-[#1c1b1a] shadow-[3px_3px_0_#1c1b1a]' : 'border-[#1c1b1a]/35 shadow-sm'}`}
                        >
                            {activeId === p.id && <Tape className="-top-2 left-1/2 -translate-x-1/2 rotate-[-4deg] w-10" />}
                            <img src={p.avatar || userProfile.avatar} className="w-full aspect-square object-cover grayscale-[35%] contrast-105" />
                            <span className="text-[10px] font-black truncate w-full text-center">{p.name}</span>
                            <div className="flex justify-center">{renderMarks(p)}</div>
                        </button>
                    ) : (
                        // 票据条：左缘撕孔 + 方形照片 + 署名/注记
                        <div
                            key={p.id}
                            onClick={() => activatePersona(p)}
                            className={`relative bg-white border-2 pl-5 pr-3 py-2.5 flex items-center gap-3 cursor-pointer transition-all active:scale-[0.99] ${i % 2 === 0 ? 'rotate-[-0.35deg]' : 'rotate-[0.35deg]'} ${activeId === p.id ? 'border-[#1c1b1a] shadow-[3px_3px_0_#1c1b1a]' : 'border-[#1c1b1a]/35 shadow-sm'}`}
                        >
                            {/* 撕孔装订边 */}
                            <div
                                aria-hidden
                                className="absolute left-1.5 top-1 bottom-1 w-[3px] opacity-40"
                                style={{ backgroundImage: 'repeating-linear-gradient(180deg, #1c1b1a 0 3px, transparent 3px 8px)' }}
                            />
                            <div className="relative shrink-0">
                                <img src={p.avatar || userProfile.avatar} className="w-11 h-11 object-cover border-2 border-[#1c1b1a]/70 grayscale-[35%] contrast-105" />
                                {/* 相角贴 */}
                                <span aria-hidden className="absolute -top-1 -left-1 w-2.5 h-2.5 border-t-2 border-l-2 border-[#1c1b1a]" />
                                <span aria-hidden className="absolute -bottom-1 -right-1 w-2.5 h-2.5 border-b-2 border-r-2 border-[#1c1b1a]" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-baseline gap-1.5">
                                    <span className="text-sm font-black truncate">{p.name}</span>
                                    {p.title && <span className="text-[11px] text-[#1c1b1a]/50 truncate" style={HAND_CN}>{p.title}</span>}
                                </div>
                                <p className="text-[10px] text-[#1c1b1a]/45 truncate">{p.description || '（自述栏还空着）'}</p>
                            </div>
                            {renderMarks(p)}
                        </div>
                    ))}

                    {/* 贴一张新的：虚线裁切框（新建入口） */}
                    {loaded && personas.length > 0 && (
                        <button
                            onClick={() => handleCreate(false)}
                            className={`border-2 border-dashed border-[#1c1b1a]/50 text-[#1c1b1a]/60 hover:border-[#1c1b1a] hover:text-[#1c1b1a] active:scale-[0.98] transition-all flex items-center justify-center gap-1.5 bg-white/40 ${gridView ? 'aspect-[3/4] flex-col rotate-[0.8deg]' : 'w-full py-3 rotate-[-0.3deg]'}`}
                            title="沿虚线裁下，贴一页新扮相"
                        >
                            <Scissors size={gridView ? 18 : 14} weight="bold" />
                            <span className="text-[11px] font-black">贴一张新扮相</span>
                        </button>
                    )}
                </div>

                {/* ── 摊开的当前页：编辑区（撕边日记页） ── */}
                {selected && (
                    <div className="relative bg-[#fbfaf6] border-2 border-[#1c1b1a] shadow-[5px_5px_0_#1c1b1a] p-5 space-y-5">
                        <Tape className="-top-2.5 left-5 rotate-[-4deg]" />
                        <Tape className="-top-2.5 right-5 rotate-[5deg] w-12" />
                        <div className="label-mono text-[8px] text-[#1c1b1a]/40 -mb-3">NOW EDITING / 摊开的这一页</div>

                        {/* 拍立得照片 + 署名/注记 */}
                        <div className="flex items-start gap-4 pt-1">
                            <div
                                onClick={() => avatarInputRef.current?.click()}
                                className="shrink-0 bg-white border-2 border-[#1c1b1a]/70 p-1.5 pb-4 rotate-[-2.5deg] shadow-[2px_2px_0_rgba(28,27,26,0.4)] cursor-pointer relative group"
                                title="揭下旧照片，贴一张新的"
                            >
                                <img src={selected.avatar || userProfile.avatar} className="w-16 h-16 object-cover grayscale-[35%] contrast-105 group-hover:opacity-75 transition-opacity" />
                                <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 text-[10px] text-[#1c1b1a]/55 whitespace-nowrap" style={HAND_CN}>换张照片</span>
                            </div>
                            <input type="file" ref={avatarInputRef} className="hidden" accept="image/*" onChange={handleAvatarChange} />
                            <div className="flex-1 min-w-0 space-y-3">
                                <div>
                                    <label className="label-mono text-[8px] text-[#1c1b1a]/45 block">署名 / SIGNED AS</label>
                                    <input
                                        value={selected.name}
                                        onChange={e => updateSelected({ name: e.target.value })}
                                        className="w-full bg-transparent border-b-2 border-[#1c1b1a] py-1 text-base font-black outline-none focus:border-dashed"
                                        placeholder="这一页里，TA 怎么称呼你"
                                    />
                                </div>
                                <div>
                                    <label className="label-mono text-[8px] text-[#1c1b1a]/45 block">页角注记 / MARGIN NOTE</label>
                                    <input
                                        value={selected.title || ''}
                                        onChange={e => updateSelected({ title: e.target.value || undefined })}
                                        className="w-full bg-transparent border-b border-dashed border-[#1c1b1a]/50 py-1 text-[11px] text-[#1c1b1a]/70 outline-none focus:border-[#1c1b1a]"
                                        placeholder="写给自己看的小字，不会寄给 AI"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* 文具排：图钉 / 别针 / 剪刀 / 撕页 */}
                        <div className="flex items-center gap-2.5 flex-wrap">
                            <button
                                onClick={() => toggleDefault(selected)}
                                className={`px-3 py-1.5 text-[10px] font-black flex items-center gap-1.5 rotate-[-1deg] transition-all border-2 border-[#1c1b1a] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none ${defaultId === selected.id ? 'bg-[#1c1b1a] text-[#f7f5ef] shadow-[2px_2px_0_rgba(28,27,26,0.35)]' : 'bg-white shadow-[2px_2px_0_#1c1b1a]'}`}
                                title="常驻扮相：没别在任何人身上的聊天，自动用这一页"
                            >
                                <PushPin size={12} weight={defaultId === selected.id ? 'fill' : 'bold'} />
                                {defaultId === selected.id ? '常驻 · 已钉牢' : '钉为常驻'}
                            </button>
                            <button
                                onClick={() => setConnectionsTarget(selected)}
                                className={`px-3 py-1.5 text-[10px] font-black flex items-center gap-1.5 rotate-[0.8deg] ${STICKER}`}
                                title="别在角色上：走进 TA 的聊天时，自动翻到这一页"
                            >
                                <Paperclip size={12} weight="bold" />
                                别在角色上{selectedConnections.length > 0 ? ` ×${selectedConnections.length}` : ''}
                            </button>
                            <button
                                onClick={() => handleDuplicate(selected)}
                                className={`px-3 py-1.5 text-[10px] font-black flex items-center gap-1.5 rotate-[-0.6deg] ${STICKER}`}
                                title="照着这一页剪一份新的"
                            >
                                <Scissors size={12} weight="bold" /> 剪一份
                            </button>
                            <button
                                onClick={() => setConfirmDelete(selected)}
                                className={`px-3 py-1.5 text-[10px] font-black flex items-center gap-1.5 rotate-[1.2deg] border-2 border-[#1c1b1a] bg-white shadow-[2px_2px_0_#1c1b1a] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all line-through decoration-2`}
                                title="把这一页从手账里撕下来"
                            >
                                <Trash size={12} weight="bold" /> 撕掉
                            </button>
                        </div>

                        {/* 自述拼贴（信纸横线） */}
                        <div>
                            <div className="flex items-end justify-between mb-1">
                                <label className="label-mono text-[8px] text-[#1c1b1a]/45">自述拼贴 / ABOUT ME</label>
                                <span className="label-mono text-[8px] text-[#1c1b1a]/35">墨水 ≈ {estimateTokens(selected.description || '')} TK</span>
                            </div>
                            <textarea
                                value={selected.description}
                                onChange={e => updateSelected({ description: e.target.value })}
                                className="w-full h-32 bg-white border-2 border-[#1c1b1a]/60 px-3 py-0 text-xs resize-none outline-none focus:border-[#1c1b1a]"
                                style={RULED_BG}
                                placeholder="向 AI 介绍这一页身份下的你（{{char}} / {{user}} 宏照常可用）…"
                            />
                        </div>

                        {/* 拍一拍后缀（全局，不分扮相）：别人「拍了拍 你 的<后缀>」里的后缀 */}
                        <div>
                            <label className="label-mono text-[8px] text-[#1c1b1a]/45 mb-1.5 block">拍一拍后缀 / PAT · 全局（别人拍你时显示）</label>
                            <input
                                value={userProfile.patSuffix ?? ''}
                                onChange={e => updateUserProfile({ patSuffix: e.target.value.slice(0, 20) })}
                                className="w-full bg-white border-2 border-[#1c1b1a]/60 px-3 py-2 text-xs outline-none focus:border-[#1c1b1a]"
                                placeholder="脑袋 / 肩膀 / 头发…（拍了拍 你 的___）"
                                maxLength={20}
                            />
                        </div>

                        {/* 自述寄送方式（ST persona_description_position） */}
                        <div>
                            <label className="label-mono text-[8px] text-[#1c1b1a]/45 mb-1.5 block">自述寄往何处 / DELIVERY</label>
                            <div className="flex gap-2">
                                {SEND_MODES.map((m, i) => {
                                    const on = selectedSendMode === m.value;
                                    return (
                                        <button
                                            key={m.value}
                                            onClick={() => updateSelected({ position: m.value })}
                                            className={`flex-1 px-1 py-2 border-2 border-[#1c1b1a] flex flex-col items-center gap-0.5 transition-all active:translate-y-[1px] ${i === 0 ? 'rotate-[-0.8deg]' : i === 2 ? 'rotate-[0.8deg]' : ''} ${on ? 'bg-[#1c1b1a] text-[#f7f5ef] shadow-[2px_2px_0_rgba(28,27,26,0.35)]' : 'bg-white shadow-[2px_2px_0_#1c1b1a]'}`}
                                        >
                                            <span className="label-mono text-[7px] opacity-60">{m.en}</span>
                                            <span className="text-[10px] font-black">{m.label}</span>
                                        </button>
                                    );
                                })}
                            </div>
                            <p className="text-[12px] text-[#1c1b1a]/55 mt-1.5 leading-relaxed" style={HAND_CN}>
                                ✎ {SEND_MODES.find(m => m.value === selectedSendMode)?.hint}
                            </p>
                            {selectedSendMode === PERSONA_POSITION.AT_DEPTH && (
                                <div className="grid grid-cols-2 gap-3 mt-2 border-l-2 border-dashed border-[#1c1b1a]/40 pl-3">
                                    <div>
                                        <label className="label-mono text-[8px] text-[#1c1b1a]/45 mb-1 block">夹在第几层（0 = 紧贴最新一条）</label>
                                        <input
                                            type="number" min={0} max={999}
                                            value={selected.depth ?? 2}
                                            onChange={e => updateSelected({ depth: Math.max(0, Number(e.target.value) || 0) })}
                                            className="w-full bg-white border-2 border-[#1c1b1a]/60 px-3 py-1.5 text-xs font-bold outline-none focus:border-[#1c1b1a]"
                                        />
                                    </div>
                                    <div>
                                        <label className="label-mono text-[8px] text-[#1c1b1a]/45 mb-1 block">以谁的口吻夹进去</label>
                                        <div className="space-y-1">
                                            {VOICE_CHIPS.map(r => {
                                                const on = (selected.role ?? 0) === r.value;
                                                return (
                                                    <button
                                                        key={r.value}
                                                        onClick={() => updateSelected({ role: r.value })}
                                                        className={`w-full px-2 py-1 text-[9px] font-bold border text-left transition-all ${on ? 'border-[#1c1b1a] bg-[#1c1b1a] text-[#f7f5ef]' : 'border-[#1c1b1a]/40 bg-white text-[#1c1b1a]/70'}`}
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

                        {/* 随页夹带的世界书（ST persona lorebook → 世界书分组绑定） */}
                        <div>
                            <label className="label-mono text-[8px] text-[#1c1b1a]/45 mb-1.5 block">随页夹带的卷册（世界书）/ ENCLOSED CLIPPINGS</label>
                            <div className="relative">
                                <select
                                    value={selected.lorebookCategory || ''}
                                    onChange={e => updateSelected({ lorebookCategory: e.target.value || undefined })}
                                    className="w-full appearance-none bg-white border-2 border-[#1c1b1a]/60 px-3 py-2 text-xs font-bold outline-none focus:border-[#1c1b1a]"
                                >
                                    <option value="">什么都不夹</option>
                                    {worldbookCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                                </select>
                                <span aria-hidden className="absolute right-3 top-1/2 -translate-y-1/2 text-xs pointer-events-none">▾</span>
                            </div>
                            <p className="text-[12px] text-[#1c1b1a]/55 mt-1.5 leading-relaxed" style={HAND_CN}>
                                ✎ 戴着这一页聊天时，所选卷册里的剪报（世界书条目）就算没挂到角色身上，也会按各自的位置和开关一并寄出。
                            </p>
                        </div>
                    </div>
                )}

                {/* ── 装订工具：整本装箱 / 拆箱回填 ── */}
                <div className="relative border-2 border-[#1c1b1a]/45 bg-white/55 p-3 rotate-[0.3deg]">
                    <span className="absolute -top-2 left-3 px-1.5 bg-[#f2f0e9] label-mono text-[8px] text-[#1c1b1a]/50">BINDERY / 装订台</span>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleBackup}
                            className={`flex-1 py-2 text-[10px] font-black flex items-center justify-center gap-1.5 ${STICKER}`}
                            title="把整本手账打包成 JSON 带走"
                        >
                            <Package size={13} weight="bold" /> 整本装箱
                        </button>
                        <button
                            onClick={() => restoreInputRef.current?.click()}
                            className={`flex-1 py-2 text-[10px] font-black flex items-center justify-center gap-1.5 ${STICKER}`}
                            title="从 JSON 箱子里把扮相一页页贴回来"
                        >
                            <ClockCounterClockwise size={13} weight="bold" /> 拆箱回填
                        </button>
                        <input type="file" ref={restoreInputRef} className="hidden" accept=".json,application/json" onChange={handleRestore} />
                        <div aria-hidden className="hidden sm:block w-16 h-7 opacity-50" style={BARCODE_BG} />
                    </div>
                </div>

                {/* 页脚手写备忘 */}
                <p className="text-center text-[13px] text-[#1c1b1a]/45 pb-5 leading-relaxed" style={HAND_CN}>
                    点哪一页就戴上哪一页：署名、照片、自述会写进「档案」，聊天和 prompt 立刻生效。<br />
                    开着活字盘（预设）时，自述落在 Persona Description 那个占位上。
                </p>
            </div>

            {/* ── 撕页确认 ── */}
            <PaperSheet
                open={!!confirmDelete}
                tag="TEAR OFF / 不可复原"
                title="撕掉这一页？"
                onClose={() => setConfirmDelete(null)}
                footer={confirmDelete ? (
                    <>
                        <button
                            onClick={() => setConfirmDelete(null)}
                            className={`flex-1 py-2.5 text-xs font-black ${STICKER}`}
                        >
                            还是留着
                        </button>
                        <button
                            onClick={() => handleDelete(confirmDelete)}
                            className="flex-1 py-2.5 text-xs font-black bg-[#1c1b1a] text-[#f7f5ef] border-2 border-[#1c1b1a] shadow-[2px_2px_0_rgba(28,27,26,0.35)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all"
                        >
                            撕！
                        </button>
                    </>
                ) : undefined}
            >
                {confirmDelete && (
                    <div className="text-sm text-[#1c1b1a]/70 leading-relaxed space-y-2">
                        <p>「{confirmDelete.name}」这一页撕下来就拼不回去了。</p>
                        {defaultId === confirmDelete.id && (
                            <p className="text-xs flex items-center gap-1"><PushPin size={12} weight="fill" /> 它现在还钉着常驻图钉。</p>
                        )}
                        {activeId === confirmDelete.id && (
                            <p className="text-xs">它正是你现在戴着的扮相（档案里的内容不受影响）。</p>
                        )}
                    </div>
                )}
            </PaperSheet>

            {/* ── 别在谁身上 ── */}
            <PaperSheet
                open={!!connectionsTarget}
                tag="PAPERCLIP / 自动换页"
                title={`「${connectionsTarget?.name || ''}」别在谁身上`}
                onClose={() => setConnectionsTarget(null)}
            >
                {connectionsTarget && (
                    <div className="space-y-2">
                        <p className="text-[12px] text-[#1c1b1a]/55 leading-relaxed mb-2" style={HAND_CN}>
                            走进打勾角色的聊天时，手账会自动翻到这一页。一个角色身上只别得下一枚别针——在这里打勾，会顺手把 TA 从别的页上摘下来。
                        </p>
                        {characters.length === 0 && (
                            <p className="text-xs text-[#1c1b1a]/50 text-center py-3 border border-dashed border-[#1c1b1a]/40">
                                名册还是空的——先去「登场人物」那边请几位来。
                            </p>
                        )}
                        {characters.map(c => {
                            const bound = (connectionsTarget.connections || []).some(conn => conn.type === 'character' && conn.id === c.id);
                            const boundElsewhere = !bound && personas.some(p => p.id !== connectionsTarget.id && (p.connections || []).some(conn => conn.type === 'character' && conn.id === c.id));
                            return (
                                <button
                                    key={c.id}
                                    onClick={() => toggleConnection(connectionsTarget, c.id)}
                                    className={`w-full p-2.5 flex items-center gap-3 transition-all active:scale-[0.99] border-2 ${bound ? 'border-[#1c1b1a] bg-white shadow-[2px_2px_0_#1c1b1a]' : 'border-[#1c1b1a]/30 bg-white/70'}`}
                                >
                                    <img src={c.avatar} className="w-8 h-8 object-cover border border-[#1c1b1a]/50 grayscale-[35%] shrink-0" />
                                    <span className="flex-1 text-left text-xs font-black truncate">{c.name}</span>
                                    {boundElsewhere && <span className="text-[9px] text-[#1c1b1a]/40 shrink-0" style={HAND_CN}>别在别页上</span>}
                                    <span className={`w-4 h-4 border-2 border-[#1c1b1a] shrink-0 flex items-center justify-center ${bound ? 'bg-[#1c1b1a]' : 'bg-white'}`}>
                                        {bound && <svg viewBox="0 0 24 24" fill="none" stroke="#f7f5ef" strokeWidth={4.5} className="w-2.5 h-2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
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
