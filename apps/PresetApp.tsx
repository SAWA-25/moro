/**
 * 预设 App —— SillyTavern Chat Completion 预设管理器的 Moro 移植。
 *
 * 与 ST 对齐的交互：
 *  - 预设条：下拉选择 + 新建 / 另存为 / 重命名 / 导入 / 导出 / 删除
 *  - 生成参数：temperature / 惩罚 / top_p / top_k 等滑条 + 上下文 / 回复 token 数
 *  - 提示词管理器：拖拽排序、逐条开关、编辑（名称 / 角色 / 注入位置@深度 / 顺序 / 内容）、
 *    从列表移除（不删定义）、新建提示词、插入已有提示词、token 估算
 *  - marker（Chat History / Char Description 等）为系统占位，内容不可编辑
 *
 * 与 ST 的差异：所有改动即时落库（Moro 是 local-first，没有 ST 的「设置区 vs 预设文件」
 * 双层结构，省去手动「更新预设」按钮）。
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import {
    CORE_CONTEXT_MARKERS,
    CHAT_HISTORY_MARKER,
    INJECTION_POSITION,
    MARKER_HINTS,
    ORDER_CHAR_ID_SINGLE,
    PresetRuntime,
    createDefaultPreset,
    estimateTokens,
    exportTavernPreset,
    importTavernPreset,
} from '../utils/presets';
import type { PresetPrompt, PresetPromptOrderEntry, TavernPreset } from '../types';
import {
    CaretLeft, Plus, UploadSimple, DownloadSimple, PencilSimple, CopySimple, Trash,
    DotsSixVertical, Syringe, PushPin, LinkBreak, Power, ListPlus, CaretDown, CaretUp,
} from '@phosphor-icons/react';

// ---------------------------------------------------------------------------
// 小部件

const RoleBadge: React.FC<{ role?: string }> = ({ role }) => {
    const r = role || 'system';
    const style = r === 'assistant'
        ? 'bg-violet-100 text-violet-600'
        : r === 'user'
            ? 'bg-emerald-100 text-emerald-600'
            : 'bg-slate-100 text-slate-500';
    const label = r === 'assistant' ? 'AI' : r === 'user' ? '用户' : '系统';
    return <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold shrink-0 ${style}`}>{label}</span>;
};

const Toggle: React.FC<{ on: boolean; onChange: (v: boolean) => void; small?: boolean }> = ({ on, onChange, small }) => (
    <button
        onClick={() => onChange(!on)}
        className={`${small ? 'w-9 h-5' : 'w-11 h-6'} rounded-full transition-colors relative shrink-0 ${on ? 'bg-emerald-400' : 'bg-slate-300'}`}
    >
        <span className={`absolute top-0.5 ${small ? 'w-4 h-4' : 'w-5 h-5'} bg-white rounded-full shadow transition-all ${on ? (small ? 'left-[18px]' : 'left-[22px]') : 'left-0.5'}`} />
    </button>
);

interface SliderRowProps {
    label: string;
    value: number | undefined;
    fallback: number;
    min: number;
    max: number;
    step: number;
    onChange: (v: number) => void;
}

const SliderRow: React.FC<SliderRowProps> = ({ label, value, fallback, min, max, step, onChange }) => {
    const v = value ?? fallback;
    return (
        <div>
            <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-bold text-slate-500">{label}</span>
                <input
                    type="number"
                    value={v}
                    min={min}
                    max={max}
                    step={step}
                    onChange={e => { const n = parseFloat(e.target.value); if (Number.isFinite(n)) onChange(n); }}
                    className="w-20 text-right text-xs font-mono bg-white border border-slate-200 rounded-lg px-2 py-1 outline-none focus:border-primary"
                />
            </div>
            <input
                type="range"
                value={v}
                min={min}
                max={max}
                step={step}
                onChange={e => onChange(parseFloat(e.target.value))}
                className="w-full accent-sky-500"
            />
        </div>
    );
};

// ---------------------------------------------------------------------------
// 提示词编辑弹层

interface PromptEditorProps {
    prompt: PresetPrompt;
    onSave: (p: PresetPrompt) => void;
    onDelete?: () => void;
    onClose: () => void;
}

const PromptEditor: React.FC<PromptEditorProps> = ({ prompt, onSave, onDelete, onClose }) => {
    const isMarker = !!prompt.marker;
    const [name, setName] = useState(prompt.name);
    const [role, setRole] = useState(prompt.role || 'system');
    const [content, setContent] = useState(prompt.content || '');
    const [position, setPosition] = useState(prompt.injection_position ?? INJECTION_POSITION.RELATIVE);
    const [depth, setDepth] = useState(prompt.injection_depth ?? 4);
    const [order, setOrder] = useState(prompt.injection_order ?? 100);
    const markerHint = MARKER_HINTS[prompt.identifier]?.hint;

    const save = () => {
        const next: PresetPrompt = { ...prompt, name: name.trim() || prompt.identifier };
        if (!isMarker) {
            next.role = role as PresetPrompt['role'];
            next.content = content;
            next.injection_position = position;
            next.injection_depth = depth;
            next.injection_order = order;
        }
        onSave(next);
    };

    return (
        <div className="fixed inset-0 z-[100] flex flex-col bg-slate-50 animate-fade-in">
            <div className="h-16 bg-white/80 backdrop-blur-md flex items-center px-4 border-b border-white/40 shrink-0 gap-2">
                <button onClick={onClose} className="p-2 -ml-2 rounded-full hover:bg-black/5 active:scale-90 transition-transform">
                    <CaretLeft className="w-5 h-5 text-slate-600" />
                </button>
                <h2 className="text-base font-bold text-slate-700 flex-1 truncate">{isMarker ? '查看占位提示词' : '编辑提示词'}</h2>
                {!isMarker && (
                    <button onClick={save} className="px-4 py-1.5 bg-sky-500 text-white text-sm font-bold rounded-full active:scale-95 transition-transform">保存</button>
                )}
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                <div>
                    <label className="text-xs font-bold text-slate-400 mb-1 block">名称</label>
                    <input
                        value={name}
                        onChange={e => setName(e.target.value)}
                        disabled={isMarker}
                        className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-primary disabled:bg-slate-100 disabled:text-slate-400"
                    />
                </div>

                {isMarker ? (
                    <div className="bg-sky-50 border border-sky-100 rounded-xl p-4 text-xs text-sky-700 leading-relaxed">
                        <div className="flex items-center gap-1.5 font-bold mb-1"><PushPin className="w-3.5 h-3.5" />系统占位提示词（marker）</div>
                        {markerHint || '此占位由系统在发送时自动填充，内容不可编辑。'}
                    </div>
                ) : (
                    <>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-xs font-bold text-slate-400 mb-1 block">角色</label>
                                <select
                                    value={role}
                                    onChange={e => setRole(e.target.value as 'system' | 'user' | 'assistant')}
                                    className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-primary"
                                >
                                    <option value="system">系统 (system)</option>
                                    <option value="user">用户 (user)</option>
                                    <option value="assistant">AI (assistant)</option>
                                </select>
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-400 mb-1 block">注入位置</label>
                                <select
                                    value={position}
                                    onChange={e => setPosition(parseInt(e.target.value, 10))}
                                    className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-primary"
                                >
                                    <option value={INJECTION_POSITION.RELATIVE}>相对（按列表顺序）</option>
                                    <option value={INJECTION_POSITION.ABSOLUTE}>绝对（注入聊天 @深度）</option>
                                </select>
                            </div>
                        </div>

                        {position === INJECTION_POSITION.ABSOLUTE && (
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs font-bold text-slate-400 mb-1 block">深度（距聊天末尾）</label>
                                    <input
                                        type="number" min={0} max={9999} value={depth}
                                        onChange={e => { const n = parseInt(e.target.value, 10); if (Number.isFinite(n)) setDepth(Math.max(0, n)); }}
                                        className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-mono text-slate-700 outline-none focus:border-primary"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-slate-400 mb-1 block">顺序（大的更靠后）</label>
                                    <input
                                        type="number" min={0} max={9999} value={order}
                                        onChange={e => { const n = parseInt(e.target.value, 10); if (Number.isFinite(n)) setOrder(n); }}
                                        className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-mono text-slate-700 outline-none focus:border-primary"
                                    />
                                </div>
                            </div>
                        )}

                        <div>
                            <div className="flex items-center justify-between mb-1">
                                <label className="text-xs font-bold text-slate-400">提示词内容</label>
                                <span className="text-[10px] text-slate-400 font-mono">~{estimateTokens(content)} tokens</span>
                            </div>
                            <textarea
                                value={content}
                                onChange={e => setContent(e.target.value)}
                                placeholder="支持 {{char}} / {{user}} / {{date}} / {{time}} 宏"
                                className="w-full h-64 bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-700 leading-relaxed outline-none focus:border-primary resize-none font-mono"
                            />
                        </div>

                        {onDelete && (
                            <button
                                onClick={onDelete}
                                className="w-full py-2.5 text-rose-500 text-sm font-bold bg-rose-50 border border-rose-100 rounded-xl active:scale-95 transition-transform"
                            >
                                彻底删除此提示词
                            </button>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};

// ---------------------------------------------------------------------------
// 主组件

const PresetApp: React.FC = () => {
    const { closeApp, addToast } = useOS();
    const [presets, setPresets] = useState<TavernPreset[]>([]);
    const [activeId, setActiveId] = useState<string | null>(PresetRuntime.getActiveId());
    const [enabled, setEnabled] = useState(PresetRuntime.isEnabled());
    const [applySampling, setApplySampling] = useState(PresetRuntime.isSamplingApplied());
    const [loaded, setLoaded] = useState(false);
    const [showParams, setShowParams] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [showInsert, setShowInsert] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // 拖拽排序状态
    const [dragIdx, setDragIdx] = useState<number | null>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const rowRefs = useRef<Array<HTMLDivElement | null>>([]);

    const active = useMemo(() => presets.find(p => p.id === activeId) || null, [presets, activeId]);

    useEffect(() => {
        DB.getAllPresets()
            .then(list => {
                list.sort((a, b) => a.createdAt - b.createdAt);
                setPresets(list);
                const storedId = PresetRuntime.getActiveId();
                if (list.length > 0 && !list.some(p => p.id === storedId)) {
                    setActiveId(list[0].id);
                    PresetRuntime.setActiveId(list[0].id);
                }
            })
            .catch(e => addToast(`读取预设失败: ${e?.message || e}`, 'error'))
            .finally(() => setLoaded(true));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── 持久化 ──────────────────────────────────────────
    const persistPreset = (next: TavernPreset) => {
        next.updatedAt = Date.now();
        setPresets(prev => prev.map(p => (p.id === next.id ? next : p)));
        DB.savePreset(next).catch(e => addToast(`保存失败: ${e?.message || e}`, 'error'));
    };

    const mutateActive = (fn: (draft: TavernPreset) => void) => {
        if (!active) return;
        const draft: TavernPreset = JSON.parse(JSON.stringify(active));
        fn(draft);
        persistPreset(draft);
    };

    const selectPreset = (id: string) => {
        setActiveId(id);
        PresetRuntime.setActiveId(id);
    };

    // ── 预设条操作 ──────────────────────────────────────
    const handleNewPreset = () => {
        const name = window.prompt('新预设名称', `预设 ${presets.length + 1}`);
        if (name === null) return;
        const preset = createDefaultPreset(name.trim() || 'Default');
        setPresets(prev => [...prev, preset]);
        DB.savePreset(preset).catch(() => addToast('保存失败', 'error'));
        selectPreset(preset.id);
        addToast('已创建预设', 'success');
    };

    const handleSaveAs = () => {
        if (!active) return;
        const name = window.prompt('另存为', `${active.name} 副本`);
        if (name === null) return;
        const copy: TavernPreset = JSON.parse(JSON.stringify(active));
        copy.id = crypto.randomUUID();
        copy.name = name.trim() || `${active.name} 副本`;
        copy.createdAt = Date.now();
        copy.updatedAt = Date.now();
        setPresets(prev => [...prev, copy]);
        DB.savePreset(copy).catch(() => addToast('保存失败', 'error'));
        selectPreset(copy.id);
        addToast('已另存', 'success');
    };

    const handleRename = () => {
        if (!active) return;
        const name = window.prompt('重命名预设', active.name);
        if (name === null || !name.trim()) return;
        mutateActive(d => { d.name = name.trim(); });
    };

    const handleDelete = () => {
        if (!active) return;
        if (!window.confirm(`删除预设「${active.name}」？此操作不可撤销。`)) return;
        const id = active.id;
        DB.deletePreset(id).catch(() => addToast('删除失败', 'error'));
        const rest = presets.filter(p => p.id !== id);
        setPresets(rest);
        const nextId = rest[0]?.id ?? null;
        setActiveId(nextId);
        PresetRuntime.setActiveId(nextId);
        addToast('已删除', 'success');
    };

    const handleExport = () => {
        if (!active) return;
        const json = JSON.stringify(exportTavernPreset(active), null, 4);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${active.name}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            const preset = importTavernPreset(data, file.name.replace(/\.json$/i, ''));
            setPresets(prev => [...prev, preset]);
            await DB.savePreset(preset);
            selectPreset(preset.id);
            if (!enabled) addToast('导入成功。预设总开关当前是关闭的，记得打开', 'info');
            else addToast(`已导入「${preset.name}」`, 'success');
        } catch (err: any) {
            addToast(`导入失败: ${err?.message || err}`, 'error');
        }
    };

    // ── 开关 ────────────────────────────────────────────
    const toggleEnabled = (on: boolean) => {
        setEnabled(on);
        PresetRuntime.setEnabled(on);
        if (on && !activeId && presets.length > 0) selectPreset(presets[0].id);
    };

    const toggleSampling = (on: boolean) => {
        setApplySampling(on);
        PresetRuntime.setSamplingApplied(on);
    };

    // ── 提示词管理器 ────────────────────────────────────
    const orderEntries: PresetPromptOrderEntry[] = useMemo(() => {
        if (!active) return [];
        const po = active.prompt_order.find(p => p.character_id === ORDER_CHAR_ID_SINGLE) || active.prompt_order[0];
        return po?.order ?? [];
    }, [active]);

    const promptById = useMemo(() => new Map((active?.prompts ?? []).map(p => [p.identifier, p])), [active]);

    const mutateOrder = (fn: (order: PresetPromptOrderEntry[]) => void) => {
        mutateActive(d => {
            // 单聊 / 群聊两份 order 同步改 —— Moro 的群聊走独立链路，保持两份一致最不意外
            for (const po of d.prompt_order) fn(po.order);
            if (d.prompt_order.length === 0) {
                const order: PresetPromptOrderEntry[] = [];
                fn(order);
                d.prompt_order.push({ character_id: ORDER_CHAR_ID_SINGLE, order });
            }
        });
    };

    const handleToggleEntry = (identifier: string, on: boolean) => {
        mutateOrder(order => {
            const e = order.find(x => x.identifier === identifier);
            if (e) e.enabled = on;
        });
    };

    const handleDetach = (identifier: string) => {
        mutateOrder(order => {
            const i = order.findIndex(x => x.identifier === identifier);
            if (i >= 0) order.splice(i, 1);
        });
    };

    const handleNewPrompt = () => {
        if (!active) return;
        const identifier = crypto.randomUUID();
        mutateActive(d => {
            d.prompts.push({ identifier, name: '新提示词', role: 'system', content: '', system_prompt: false });
            for (const po of d.prompt_order) po.order.push({ identifier, enabled: true });
        });
        setEditingId(identifier);
    };

    const handleSavePrompt = (next: PresetPrompt) => {
        mutateActive(d => {
            const i = d.prompts.findIndex(p => p.identifier === next.identifier);
            if (i >= 0) d.prompts[i] = next;
            else d.prompts.push(next);
        });
        setEditingId(null);
    };

    const handleDeletePrompt = (identifier: string) => {
        if (!window.confirm('彻底删除此提示词（从预设中移除定义）？')) return;
        mutateActive(d => {
            d.prompts = d.prompts.filter(p => p.identifier !== identifier);
            for (const po of d.prompt_order) {
                po.order = po.order.filter(e => e.identifier !== identifier);
            }
        });
        setEditingId(null);
    };

    const handleInsertExisting = (identifier: string) => {
        mutateOrder(order => {
            if (!order.some(e => e.identifier === identifier)) {
                order.push({ identifier, enabled: true });
            }
        });
        setShowInsert(false);
    };

    // ── 拖拽排序（pointer events，手机 / 桌面通吃） ──────
    const dragState = useRef<{ from: number; to: number } | null>(null);

    const onDragPointerDown = (idx: number) => (e: React.PointerEvent) => {
        e.preventDefault();
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        dragState.current = { from: idx, to: idx };
        setDragIdx(idx);
    };

    const onDragPointerMove = (e: React.PointerEvent) => {
        if (!dragState.current) return;
        const y = e.clientY;
        let to = dragState.current.to;
        rowRefs.current.forEach((el, i) => {
            if (!el) return;
            const rect = el.getBoundingClientRect();
            if (y >= rect.top && y <= rect.bottom) to = i;
        });
        if (to !== dragState.current.to) {
            dragState.current.to = to;
            setDragIdx(to);
            // 实时把列表里的位置换过去（受控状态先动，pointerup 再落库）
            const { from } = dragState.current;
            if (from !== to) {
                setPresets(prev => prev.map(p => {
                    if (p.id !== activeId) return p;
                    const copy: TavernPreset = JSON.parse(JSON.stringify(p));
                    for (const po of copy.prompt_order) {
                        const [moved] = po.order.splice(from, 1);
                        if (moved) po.order.splice(to, 0, moved);
                    }
                    return copy;
                }));
                dragState.current.from = to;
            }
        }
    };

    const onDragPointerUp = () => {
        if (!dragState.current) return;
        dragState.current = null;
        setDragIdx(null);
        const current = presets.find(p => p.id === activeId);
        if (current) {
            const next = { ...current, updatedAt: Date.now() };
            DB.savePreset(next).catch(() => addToast('保存失败', 'error'));
        }
    };

    const totalTokens = useMemo(() => {
        let sum = 0;
        for (const e of orderEntries) {
            if (!e.enabled) continue;
            const p = promptById.get(e.identifier);
            if (p && !p.marker && p.content) sum += estimateTokens(p.content);
        }
        return sum;
    }, [orderEntries, promptById]);

    const editingPrompt = editingId ? promptById.get(editingId) : null;
    const detachedPrompts = useMemo(() => {
        if (!active) return [];
        const attached = new Set(orderEntries.map(e => e.identifier));
        return active.prompts.filter(p => !attached.has(p.identifier));
    }, [active, orderEntries]);

    // ── 渲染 ────────────────────────────────────────────
    return (
        <div className="h-full w-full bg-slate-50 flex flex-col animate-fade-in">
            {/* Header */}
            <div className="h-20 bg-white/70 backdrop-blur-md flex items-end pb-3 px-4 border-b border-white/40 shrink-0 sticky top-0 z-10">
                <div className="flex items-center gap-2 w-full">
                    <button onClick={closeApp} className="p-2 -ml-2 rounded-full hover:bg-black/5 active:scale-90 transition-transform">
                        <CaretLeft className="w-6 h-6 text-slate-600" />
                    </button>
                    <h1 className="text-xl font-medium text-slate-700 tracking-wide flex-1">预设</h1>
                    <div className="flex items-center gap-1.5">
                        <Power className={`w-4 h-4 ${enabled ? 'text-emerald-500' : 'text-slate-300'}`} weight="bold" />
                        <Toggle on={enabled} onChange={toggleEnabled} />
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-10">
                {!enabled && (
                    <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-xs text-amber-700 leading-relaxed">
                        预设总开关已关闭：聊天走 Moro 原始消息组装，下面的编辑不会生效。打开右上角开关后，激活的预设会接管提示词结构与采样参数。
                    </div>
                )}

                {/* 预设选择条 */}
                <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 space-y-3">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">当前预设</span>
                        <span className="text-[10px] text-slate-300">改动自动保存</span>
                    </div>
                    {loaded && presets.length === 0 ? (
                        <div className="text-center py-6 space-y-3">
                            <p className="text-sm text-slate-400">还没有预设</p>
                            <div className="flex justify-center gap-3">
                                <button onClick={handleNewPreset} className="px-4 py-2 bg-sky-500 text-white text-sm font-bold rounded-full active:scale-95 transition-transform">创建默认预设</button>
                                <button onClick={() => fileInputRef.current?.click()} className="px-4 py-2 bg-slate-100 text-slate-600 text-sm font-bold rounded-full active:scale-95 transition-transform">导入酒馆预设</button>
                            </div>
                        </div>
                    ) : (
                        <>
                            <select
                                value={activeId ?? ''}
                                onChange={e => selectPreset(e.target.value)}
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-primary"
                            >
                                {presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                            <div className="flex items-center justify-between">
                                {[
                                    { icon: Plus, label: '新建', fn: handleNewPreset },
                                    { icon: UploadSimple, label: '导入', fn: () => fileInputRef.current?.click() },
                                    { icon: DownloadSimple, label: '导出', fn: handleExport },
                                    { icon: PencilSimple, label: '重命名', fn: handleRename },
                                    { icon: CopySimple, label: '另存为', fn: handleSaveAs },
                                    { icon: Trash, label: '删除', fn: handleDelete, danger: true },
                                ].map(({ icon: Icon, label, fn, danger }) => (
                                    <button
                                        key={label}
                                        onClick={fn}
                                        className={`flex flex-col items-center gap-0.5 px-1.5 py-1 rounded-xl active:scale-90 transition-transform ${danger ? 'text-rose-400' : 'text-slate-500'}`}
                                    >
                                        <Icon className="w-5 h-5" weight="bold" />
                                        <span className="text-[10px] font-bold">{label}</span>
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                    <input type="file" ref={fileInputRef} className="hidden" accept=".json,application/json" onChange={handleImportFile} />
                </div>

                {active && (
                    <>
                        {/* 生成参数 */}
                        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                            <button
                                onClick={() => setShowParams(v => !v)}
                                className="w-full px-4 py-3.5 flex items-center justify-between"
                            >
                                <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">生成参数</span>
                                {showParams ? <CaretUp className="w-4 h-4 text-slate-400" /> : <CaretDown className="w-4 h-4 text-slate-400" />}
                            </button>
                            {showParams && (
                                <div className="px-4 pb-4 space-y-4">
                                    <div className="flex items-center justify-between bg-slate-50 rounded-xl px-3 py-2.5">
                                        <div>
                                            <p className="text-xs font-bold text-slate-600">采样参数随请求下发</p>
                                            <p className="text-[10px] text-slate-400 mt-0.5">关闭后预设只管提示词，参数仍走「设置」里的全局 API 配置</p>
                                        </div>
                                        <Toggle on={applySampling} onChange={toggleSampling} small />
                                    </div>
                                    <SliderRow label="温度 Temperature" value={active.temperature} fallback={1} min={0} max={2} step={0.01} onChange={v => mutateActive(d => { d.temperature = v; })} />
                                    <SliderRow label="频率惩罚 Frequency Penalty" value={active.frequency_penalty} fallback={0} min={-2} max={2} step={0.01} onChange={v => mutateActive(d => { d.frequency_penalty = v; })} />
                                    <SliderRow label="存在惩罚 Presence Penalty" value={active.presence_penalty} fallback={0} min={-2} max={2} step={0.01} onChange={v => mutateActive(d => { d.presence_penalty = v; })} />
                                    <SliderRow label="Top P" value={active.top_p} fallback={1} min={0} max={1} step={0.01} onChange={v => mutateActive(d => { d.top_p = v; })} />
                                    <SliderRow label="Top K" value={active.top_k} fallback={0} min={0} max={500} step={1} onChange={v => mutateActive(d => { d.top_k = v; })} />
                                    <SliderRow label="重复惩罚 Repetition Penalty" value={active.repetition_penalty} fallback={1} min={0} max={3} step={0.01} onChange={v => mutateActive(d => { d.repetition_penalty = v; })} />
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="text-xs font-bold text-slate-500 mb-1 block">上下文长度 (tokens)</label>
                                            <input
                                                type="number"
                                                value={active.openai_max_context ?? 4095}
                                                onChange={e => { const n = parseInt(e.target.value, 10); if (Number.isFinite(n)) mutateActive(d => { d.openai_max_context = n; }); }}
                                                className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-mono text-slate-700 outline-none focus:border-primary"
                                            />
                                            <p className="text-[10px] text-slate-400 mt-1">仅存档（Moro 按消息条数截上下文）</p>
                                        </div>
                                        <div>
                                            <label className="text-xs font-bold text-slate-500 mb-1 block">回复上限 (max_tokens)</label>
                                            <input
                                                type="number"
                                                value={active.openai_max_tokens ?? 8000}
                                                onChange={e => { const n = parseInt(e.target.value, 10); if (Number.isFinite(n)) mutateActive(d => { d.openai_max_tokens = n; }); }}
                                                className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-mono text-slate-700 outline-none focus:border-primary"
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* 提示词管理器 */}
                        <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 space-y-3">
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">提示词管理器</span>
                                <span className="text-[10px] font-mono text-slate-400">~{totalTokens} tokens</span>
                            </div>

                            <div ref={listRef} className="space-y-1.5" onPointerMove={onDragPointerMove} onPointerUp={onDragPointerUp} onPointerCancel={onDragPointerUp}>
                                {orderEntries.map((entry, idx) => {
                                    const prompt = promptById.get(entry.identifier);
                                    if (!prompt) return null;
                                    const isMarker = !!prompt.marker;
                                    const isAbsolute = prompt.injection_position === INJECTION_POSITION.ABSOLUTE;
                                    const isCore = CORE_CONTEXT_MARKERS.has(prompt.identifier) || prompt.identifier === CHAT_HISTORY_MARKER;
                                    const hint = MARKER_HINTS[prompt.identifier]?.hint;
                                    return (
                                        <div
                                            key={entry.identifier}
                                            ref={el => { rowRefs.current[idx] = el; }}
                                            className={`flex items-center gap-2 rounded-xl border px-2 py-2 transition-colors ${dragIdx === idx ? 'bg-sky-50 border-sky-200 shadow-md' : 'bg-slate-50 border-slate-100'} ${entry.enabled ? '' : 'opacity-50'}`}
                                        >
                                            <div
                                                onPointerDown={onDragPointerDown(idx)}
                                                className="p-1 cursor-grab touch-none text-slate-300 shrink-0"
                                            >
                                                <DotsSixVertical className="w-4 h-4" weight="bold" />
                                            </div>
                                            <button onClick={() => setEditingId(entry.identifier)} className="flex-1 min-w-0 text-left">
                                                <div className="flex items-center gap-1.5">
                                                    {isMarker && <PushPin className="w-3 h-3 text-sky-400 shrink-0" weight="fill" />}
                                                    {isAbsolute && <Syringe className="w-3 h-3 text-violet-400 shrink-0" weight="fill" />}
                                                    <span className="text-sm font-bold text-slate-700 truncate">{prompt.name}</span>
                                                    {isAbsolute && <span className="text-[10px] font-mono text-violet-400 shrink-0">@{prompt.injection_depth ?? 4}</span>}
                                                </div>
                                                <div className="flex items-center gap-1.5 mt-0.5">
                                                    <RoleBadge role={prompt.role} />
                                                    {isCore
                                                        ? <span className="text-[10px] text-slate-400 truncate">{hint}</span>
                                                        : <span className="text-[10px] font-mono text-slate-400">~{estimateTokens(prompt.content || '')}t</span>}
                                                </div>
                                            </button>
                                            {!isCore && (
                                                <button onClick={() => handleDetach(entry.identifier)} className="p-1.5 text-slate-300 active:scale-90 transition-transform shrink-0" title="从列表移除（保留定义）">
                                                    <LinkBreak className="w-4 h-4" weight="bold" />
                                                </button>
                                            )}
                                            <Toggle small on={entry.enabled} onChange={v => handleToggleEntry(entry.identifier, v)} />
                                        </div>
                                    );
                                })}
                            </div>

                            <div className="flex gap-2 pt-1">
                                <button onClick={handleNewPrompt} className="flex-1 py-2.5 bg-sky-500 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 active:scale-95 transition-transform">
                                    <Plus className="w-3.5 h-3.5" weight="bold" />新建提示词
                                </button>
                                <button
                                    onClick={() => setShowInsert(true)}
                                    disabled={detachedPrompts.length === 0}
                                    className="flex-1 py-2.5 bg-slate-100 text-slate-600 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 active:scale-95 transition-transform disabled:opacity-40"
                                >
                                    <ListPlus className="w-3.5 h-3.5" weight="bold" />插入已有提示词
                                </button>
                            </div>
                        </div>

                        <p className="text-[10px] text-slate-400 leading-relaxed px-2">
                            带 <PushPin className="w-3 h-3 inline text-sky-400" weight="fill" /> 的是系统占位（marker）：Chat History 处插入聊天记录；角色相关占位共同对应
                            Moro 的角色核心上下文（人设+世界书+记忆+印象），注入在列表中第一个启用的角色占位处。带 <Syringe className="w-3 h-3 inline text-violet-400" weight="fill" /> 的按
                            @深度注入聊天历史（与酒馆的 In-Chat 注入一致）。
                        </p>
                    </>
                )}
            </div>

            {/* 编辑弹层 */}
            {editingPrompt && (
                <PromptEditor
                    prompt={editingPrompt}
                    onSave={handleSavePrompt}
                    onDelete={!editingPrompt.system_prompt && !editingPrompt.marker ? () => handleDeletePrompt(editingPrompt.identifier) : undefined}
                    onClose={() => setEditingId(null)}
                />
            )}

            {/* 插入已有提示词 */}
            {showInsert && (
                <div className="fixed inset-0 z-[100] flex items-end justify-center animate-fade-in" onClick={() => setShowInsert(false)}>
                    <div className="absolute inset-0 bg-black/40" />
                    <div className="relative w-full max-h-[60vh] bg-white rounded-t-3xl shadow-2xl p-5 overflow-y-auto animate-slide-up" onClick={e => e.stopPropagation()}>
                        <h3 className="text-sm font-bold text-slate-700 mb-3">插入已有提示词</h3>
                        <div className="space-y-1.5">
                            {detachedPrompts.map(p => (
                                <button
                                    key={p.identifier}
                                    onClick={() => handleInsertExisting(p.identifier)}
                                    className="w-full flex items-center gap-2 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2.5 text-left active:scale-[0.98] transition-transform"
                                >
                                    {p.marker && <PushPin className="w-3 h-3 text-sky-400 shrink-0" weight="fill" />}
                                    <span className="text-sm font-bold text-slate-700 truncate flex-1">{p.name}</span>
                                    <RoleBadge role={p.role} />
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default PresetApp;
