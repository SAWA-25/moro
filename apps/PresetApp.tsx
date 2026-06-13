/**
 * 活字盘 —— SillyTavern Chat Completion 预设管理器的 Moro 移植，黑白拼贴手账风界面。
 *
 * 词汇对照（数据结构 / ST 语义不变，只换了说法）：
 *  - 字版 = 一份预设（TavernPreset）；排字架 = 提示词管理器（prompt_order）
 *  - 字条 = 一条提示词；占位铅块 = marker（系统占位，内容不可编辑）
 *  - 火候 = 生成/采样参数；开印 = 预设总开关
 *  - 新刻/收进/拓出/翻刻/销版 = 新建/导入/导出/另存为/删除
 *
 * 与 ST 对齐的交互（全部保留）：
 *  - 字版条：下拉选择 + 新刻 / 翻刻 / 改名 / 收进 / 拓出 / 销版
 *  - 火候：temperature / 惩罚 / top_p / top_k 等滑条 + 上下文 / 回复 token 数
 *  - 排字架：拖拽排序、逐条开关、编辑（名称 / 口吻 / 注入位置@深度 / 顺序 / 内容）、
 *    从架上取下（不销毁定义）、刻新字条、从字库捡回、token 估算
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
    PenNib, TrayArrowDown, TrayArrowUp, NotePencil, Stamp, Trash,
    List, Placeholder, ArrowElbowDownRight, Eject, StackPlus, X,
} from '@phosphor-icons/react';

// ── 黑白手账设计 token（与扮相手账 / 剪报夹同一套语言） ────
const INK = '#1c1b1a';
const STICKER = 'border-2 border-[#1c1b1a] bg-white shadow-[2px_2px_0_#1c1b1a] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all';
const INK_BTN = 'bg-[#1c1b1a] text-[#f7f5ef] border-2 border-[#1c1b1a] shadow-[2px_2px_0_rgba(28,27,26,0.35)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all';
const HAND_CN: React.CSSProperties = { fontFamily: "'Long Cang', 'Caveat', cursive" };
const DOT_BG: React.CSSProperties = {
    backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(28,27,26,0.10) 1px, transparent 0)',
    backgroundSize: '16px 16px',
};
const RULED_BG: React.CSSProperties = {
    backgroundImage: 'repeating-linear-gradient(transparent, transparent 23px, rgba(28,27,26,0.13) 23px, rgba(28,27,26,0.13) 24px)',
    lineHeight: '24px',
};
/** 斜纹（AI 口吻章的底纹） */
const HATCH_BG: React.CSSProperties = {
    backgroundImage: 'repeating-linear-gradient(45deg, rgba(28,27,26,0.22) 0 2px, transparent 2px 5px)',
};

const Tape: React.FC<{ className?: string }> = ({ className }) => (
    <div
        aria-hidden
        className={`pointer-events-none absolute h-5 w-16 bg-white/60 border-x border-dashed border-[#1c1b1a]/30 shadow-sm backdrop-blur-[1px] ${className || ''}`}
    />
);

// ---------------------------------------------------------------------------
// 小部件

/** 口吻章：旁白（系统）= 墨底 / 你（用户）= 描边 / TA（AI）= 斜纹 */
const VoiceStamp: React.FC<{ role?: string }> = ({ role }) => {
    const r = role || 'system';
    if (r === 'assistant') {
        return <span className="label-mono text-[8px] px-1.5 py-0.5 border border-[#1c1b1a]/60 text-[#1c1b1a] shrink-0" style={HATCH_BG}>TA</span>;
    }
    if (r === 'user') {
        return <span className="label-mono text-[8px] px-1.5 py-0.5 border border-[#1c1b1a] text-[#1c1b1a] bg-white shrink-0">你</span>;
    }
    return <span className="label-mono text-[8px] px-1.5 py-0.5 bg-[#1c1b1a] text-[#f7f5ef] shrink-0">旁白</span>;
};

/** 墨块开关 */
const InkSwitch: React.FC<{ on: boolean; onChange: (v: boolean) => void; small?: boolean }> = ({ on, onChange, small }) => (
    <button
        onClick={() => onChange(!on)}
        className={`relative ${small ? 'w-9 h-[18px]' : 'w-11 h-[22px]'} border-2 border-[#1c1b1a] shrink-0 transition-colors ${on ? 'bg-[#1c1b1a]' : 'bg-white'}`}
    >
        <span className={`absolute top-0 bottom-0 ${small ? 'w-3.5' : 'w-4'} transition-all ${on ? 'right-0 bg-[#f7f5ef]' : 'left-0 bg-[#1c1b1a]'}`} />
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
                <span className="text-[11px] font-black">{label}</span>
                <input
                    type="number"
                    value={v}
                    min={min}
                    max={max}
                    step={step}
                    onChange={e => { const n = parseFloat(e.target.value); if (Number.isFinite(n)) onChange(n); }}
                    className="w-20 text-right text-xs font-mono bg-white border-2 border-[#1c1b1a]/50 px-2 py-1 outline-none focus:border-[#1c1b1a]"
                />
            </div>
            <input
                type="range"
                value={v}
                min={min}
                max={max}
                step={step}
                onChange={e => onChange(parseFloat(e.target.value))}
                className="w-full accent-[#1c1b1a]"
            />
        </div>
    );
};

// ---------------------------------------------------------------------------
// 字条编辑弹层

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
        <div className="fixed inset-0 z-[100] flex flex-col bg-[#f2f0e9] text-[#1c1b1a] animate-fade-in" style={{ ...DOT_BG, paddingTop: 'var(--safe-top)' }}>
            <div className="relative flex items-center gap-3 px-4 pt-3 pb-3 border-b-2 border-dashed border-[#1c1b1a]/30 shrink-0">
                <button onClick={onClose} className={`px-2.5 py-2 rotate-[-2deg] text-[10px] font-black ${STICKER}`}>
                    ✕ 退回
                </button>
                <div className="flex-1 min-w-0">
                    <div className="label-mono text-[8px] text-[#1c1b1a]/45">{isMarker ? 'LEAD SLUG' : 'TYPE PIECE'}</div>
                    <h2 className="text-lg font-black tracking-wide truncate">{isMarker ? '看看这枚占位铅块' : '修这枚字条'}</h2>
                </div>
                {!isMarker && (
                    <button onClick={save} className={`px-4 py-2 text-xs font-black rotate-[1.5deg] ${INK_BTN}`}>排上</button>
                )}
            </div>

            <div className="flex-1 overflow-y-auto no-scrollbar p-4 space-y-5">
                <div>
                    <label className="label-mono text-[8px] text-[#1c1b1a]/45 block">字条名 / LABEL</label>
                    <input
                        value={name}
                        onChange={e => setName(e.target.value)}
                        disabled={isMarker}
                        className="w-full bg-transparent border-b-2 border-[#1c1b1a] py-1.5 text-base font-black outline-none focus:border-dashed disabled:border-[#1c1b1a]/30 disabled:text-[#1c1b1a]/45"
                    />
                </div>

                {isMarker ? (
                    <div className="relative bg-[#fbfaf6] border-2 border-[#1c1b1a] shadow-[4px_4px_0_#1c1b1a] p-4 text-xs leading-relaxed">
                        <Tape className="-top-2.5 left-6 rotate-[-4deg]" />
                        <div className="flex items-center gap-1.5 font-black mb-1.5">
                            <Placeholder size={14} weight="bold" /> 占位铅块（marker）
                        </div>
                        <p className="text-[#1c1b1a]/70">{markerHint || '这枚铅块在上机印刷（发送）时由系统自动填进内容，这里改不了。'}</p>
                    </div>
                ) : (
                    <>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="label-mono text-[8px] text-[#1c1b1a]/45 mb-1 block">口吻 / VOICE</label>
                                <div className="relative">
                                    <select
                                        value={role}
                                        onChange={e => setRole(e.target.value as 'system' | 'user' | 'assistant')}
                                        className="w-full appearance-none bg-white border-2 border-[#1c1b1a]/60 px-3 py-2 text-xs font-bold outline-none focus:border-[#1c1b1a]"
                                    >
                                        <option value="system">旁白（system）</option>
                                        <option value="user">你（user）</option>
                                        <option value="assistant">TA（assistant）</option>
                                    </select>
                                    <span aria-hidden className="absolute right-3 top-1/2 -translate-y-1/2 text-xs pointer-events-none">▾</span>
                                </div>
                            </div>
                            <div>
                                <label className="label-mono text-[8px] text-[#1c1b1a]/45 mb-1 block">怎么排 / PLACEMENT</label>
                                <div className="relative">
                                    <select
                                        value={position}
                                        onChange={e => setPosition(parseInt(e.target.value, 10))}
                                        className="w-full appearance-none bg-white border-2 border-[#1c1b1a]/60 px-3 py-2 text-xs font-bold outline-none focus:border-[#1c1b1a]"
                                    >
                                        <option value={INJECTION_POSITION.RELATIVE}>跟着架上的顺序（相对）</option>
                                        <option value={INJECTION_POSITION.ABSOLUTE}>插进对话 @深度（绝对）</option>
                                    </select>
                                    <span aria-hidden className="absolute right-3 top-1/2 -translate-y-1/2 text-xs pointer-events-none">▾</span>
                                </div>
                            </div>
                        </div>

                        {position === INJECTION_POSITION.ABSOLUTE && (
                            <div className="grid grid-cols-2 gap-3 border-l-2 border-dashed border-[#1c1b1a]/40 pl-3">
                                <div>
                                    <label className="label-mono text-[8px] text-[#1c1b1a]/45 mb-1 block">离末尾几层（深度）</label>
                                    <input
                                        type="number" min={0} max={9999} value={depth}
                                        onChange={e => { const n = parseInt(e.target.value, 10); if (Number.isFinite(n)) setDepth(Math.max(0, n)); }}
                                        className="w-full bg-white border-2 border-[#1c1b1a]/60 px-3 py-2 text-xs font-mono outline-none focus:border-[#1c1b1a]"
                                    />
                                </div>
                                <div>
                                    <label className="label-mono text-[8px] text-[#1c1b1a]/45 mb-1 block">同层先后（大的靠后）</label>
                                    <input
                                        type="number" min={0} max={9999} value={order}
                                        onChange={e => { const n = parseInt(e.target.value, 10); if (Number.isFinite(n)) setOrder(n); }}
                                        className="w-full bg-white border-2 border-[#1c1b1a]/60 px-3 py-2 text-xs font-mono outline-none focus:border-[#1c1b1a]"
                                    />
                                </div>
                            </div>
                        )}

                        <div>
                            <div className="flex items-end justify-between mb-1">
                                <label className="label-mono text-[8px] text-[#1c1b1a]/45">字条内容 / TYPE</label>
                                <span className="label-mono text-[8px] text-[#1c1b1a]/35">墨量 ≈ {estimateTokens(content)} TK</span>
                            </div>
                            <textarea
                                value={content}
                                onChange={e => setContent(e.target.value)}
                                placeholder="支持 {{char}} / {{user}} / {{date}} / {{time}} 宏"
                                className="w-full h-64 bg-white border-2 border-[#1c1b1a]/60 px-3 py-0 text-xs resize-none outline-none focus:border-[#1c1b1a] placeholder:text-[#1c1b1a]/25"
                                style={RULED_BG}
                            />
                        </div>

                        {onDelete && (
                            <button
                                onClick={onDelete}
                                className={`w-full py-2.5 text-xs font-black line-through decoration-2 ${STICKER}`}
                            >
                                把这枚字条熔掉（从字版里彻底移除）
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
    const { closeApp, addToast, apiPresets, apiConfig, updateApiConfig } = useOS();
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
            .catch(e => addToast(`字版箱打不开: ${e?.message || e}`, 'error'))
            .finally(() => setLoaded(true));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── 持久化 ──────────────────────────────────────────
    const persistPreset = (next: TavernPreset) => {
        next.updatedAt = Date.now();
        setPresets(prev => prev.map(p => (p.id === next.id ? next : p)));
        DB.savePreset(next).catch(e => addToast(`没存上: ${e?.message || e}`, 'error'));
    };

    const mutateActive = (fn: (draft: TavernPreset) => void) => {
        if (!active) return;
        const draft: TavernPreset = JSON.parse(JSON.stringify(active));
        fn(draft);
        persistPreset(draft);
    };

    const selectPreset = (id: string, list?: TavernPreset[]) => {
        setActiveId(id);
        PresetRuntime.setActiveId(id);
        // API 联动：字版绑定了 API 预设时，激活即套用对应连接配置（类似 ST 切连接档案）
        const preset = (list ?? presets).find(p => p.id === id);
        if (preset?.moroApiPresetId) {
            const bound = apiPresets.find(ap => ap.id === preset.moroApiPresetId);
            if (bound) {
                updateApiConfig(bound.config);
                addToast(`接口已换线：「${bound.name}」`, 'info');
            }
        }
    };

    // ── 字版条操作 ──────────────────────────────────────
    const handleNewPreset = () => {
        const name = window.prompt('给新字版起个名', `字版 ${presets.length + 1}`);
        if (name === null) return;
        const preset = createDefaultPreset(name.trim() || 'Default');
        setPresets(prev => [...prev, preset]);
        DB.savePreset(preset).catch(() => addToast('没存上', 'error'));
        selectPreset(preset.id);
        addToast('新字版刻好了', 'success');
    };

    const handleSaveAs = () => {
        if (!active) return;
        const name = window.prompt('翻刻为', `${active.name} 翻刻`);
        if (name === null) return;
        const copy: TavernPreset = JSON.parse(JSON.stringify(active));
        copy.id = crypto.randomUUID();
        copy.name = name.trim() || `${active.name} 翻刻`;
        copy.createdAt = Date.now();
        copy.updatedAt = Date.now();
        setPresets(prev => [...prev, copy]);
        DB.savePreset(copy).catch(() => addToast('没存上', 'error'));
        selectPreset(copy.id);
        addToast('翻刻好了', 'success');
    };

    const handleRename = () => {
        if (!active) return;
        const name = window.prompt('给字版改个名', active.name);
        if (name === null || !name.trim()) return;
        mutateActive(d => { d.name = name.trim(); });
    };

    const handleDelete = () => {
        if (!active) return;
        if (!window.confirm(`销掉字版「${active.name}」？销了就拼不回来了。`)) return;
        const id = active.id;
        DB.deletePreset(id).catch(() => addToast('没销掉', 'error'));
        const rest = presets.filter(p => p.id !== id);
        setPresets(rest);
        const nextId = rest[0]?.id ?? null;
        setActiveId(nextId);
        PresetRuntime.setActiveId(nextId);
        addToast('已销版', 'success');
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
            if (!enabled) addToast('收进来了。不过印坊还歇着业，记得按右上角「开印」', 'info');
            else addToast(`已收进「${preset.name}」`, 'success');
        } catch (err: any) {
            addToast(`收不进来: ${err?.message || err}`, 'error');
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

    // ── 排字架 ──────────────────────────────────────────
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
            d.prompts.push({ identifier, name: '新字条', role: 'system', content: '', system_prompt: false });
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
        if (!window.confirm('把这枚字条熔掉（从字版里彻底移除定义）？')) return;
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
            DB.savePreset(next).catch(() => addToast('没存上', 'error'));
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
        <div className="h-full w-full bg-[#f2f0e9] text-[#1c1b1a] flex flex-col animate-fade-in" style={{ ...DOT_BG, paddingTop: 'var(--safe-top)' }}>
            {/* 刊头：合上贴纸 + 标题 + 开印章 */}
            <div className="relative shrink-0 px-4 pt-3 pb-3 border-b-2 border-dashed border-[#1c1b1a]/30">
                <div className="flex items-center gap-3">
                    <button onClick={closeApp} className={`shrink-0 px-2.5 py-2 rotate-[-2deg] flex items-center gap-1 ${STICKER}`} title="合上活字盘">
                        <svg viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth={2.5} className="w-3.5 h-3.5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
                        </svg>
                        <span className="text-[10px] font-black">合上</span>
                    </button>
                    <div className="flex-1 min-w-0 relative">
                        <Tape className="-top-4 left-8 rotate-[-5deg] w-12" />
                        <div className="label-mono text-[8px] text-[#1c1b1a]/45">TYPESETTING TRAY — PROMPT PRESS</div>
                        <div className="flex items-baseline gap-2">
                            <h1 className="text-2xl font-black tracking-[0.08em]">活字盘</h1>
                            <span className="text-sm text-[#1c1b1a]/55 truncate" style={HAND_CN}>提示词一块块排好再开印</span>
                        </div>
                    </div>
                    {/* 开印章：预设总开关 */}
                    <button
                        onClick={() => toggleEnabled(!enabled)}
                        title={enabled ? '印坊开着工：激活的字版接管提示词与火候。点一下歇业' : '印坊歇业中：聊天走 Moro 原生组装。点一下开印'}
                        className={`shrink-0 w-14 h-14 rounded-full border-2 flex flex-col items-center justify-center rotate-[6deg] select-none transition-all active:scale-95 ${enabled ? 'border-[#1c1b1a] bg-[#1c1b1a] text-[#f7f5ef] shadow-[2px_2px_0_rgba(28,27,26,0.35)]' : 'border-dashed border-[#1c1b1a]/60 bg-white text-[#1c1b1a]/60'}`}
                    >
                        <span className="text-sm font-black leading-none">{enabled ? '开印' : '歇业'}</span>
                        <span className="label-mono text-[6px] leading-none mt-1 opacity-70">{enabled ? 'ON' : 'OFF'}</span>
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto no-scrollbar p-4 space-y-5 pb-10">
                {!enabled && (
                    <div className="relative border-2 border-dashed border-[#1c1b1a]/50 bg-white/55 px-4 py-3 rotate-[-0.3deg]">
                        <p className="text-[13px] text-[#1c1b1a]/60 leading-relaxed" style={HAND_CN}>
                            印坊歇业中：聊天走 Moro 原生的信件组装，下面排得再好也不会上机。按一下右上角的「开印」章，激活的字版才会接管提示词结构和火候。
                        </p>
                    </div>
                )}

                {/* 字版条 */}
                <div className="relative bg-[#fbfaf6] border-2 border-[#1c1b1a] shadow-[4px_4px_0_#1c1b1a] p-4 space-y-3">
                    <Tape className="-top-2.5 left-6 rotate-[-4deg]" />
                    <div className="flex items-end justify-between">
                        <span className="label-mono text-[8px] text-[#1c1b1a]/45">ACTIVE PLATE / 在用的字版</span>
                        <span className="text-[11px] text-[#1c1b1a]/45" style={HAND_CN}>改动随手就存，不用按保存</span>
                    </div>
                    {loaded && presets.length === 0 ? (
                        <div className="text-center py-5 space-y-3">
                            <p className="text-lg" style={HAND_CN}>盘里还没有字版。</p>
                            <div className="flex justify-center gap-3 flex-wrap">
                                <button onClick={handleNewPreset} className={`px-4 py-2 text-xs font-black rotate-[-0.5deg] ${INK_BTN}`}>刻一副默认字版</button>
                                <button onClick={() => fileInputRef.current?.click()} className={`px-4 py-2 text-xs font-black rotate-[0.5deg] ${STICKER}`}>收一副酒馆预设进来</button>
                            </div>
                        </div>
                    ) : (
                        <>
                            <div className="relative">
                                <select
                                    value={activeId ?? ''}
                                    onChange={e => selectPreset(e.target.value)}
                                    className="w-full appearance-none bg-white border-2 border-[#1c1b1a] px-3 py-2.5 text-sm font-black outline-none focus:border-dashed"
                                >
                                    {presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                </select>
                                <span aria-hidden className="absolute right-3 top-1/2 -translate-y-1/2 text-sm pointer-events-none">▾</span>
                            </div>
                            <div className="grid grid-cols-6 gap-1.5 pt-1">
                                {[
                                    { icon: PenNib, label: '新刻', fn: handleNewPreset, tilt: '-1deg' },
                                    { icon: TrayArrowDown, label: '收进', fn: () => fileInputRef.current?.click(), tilt: '0.8deg' },
                                    { icon: TrayArrowUp, label: '拓出', fn: handleExport, tilt: '-0.6deg' },
                                    { icon: NotePencil, label: '改名', fn: handleRename, tilt: '0.6deg' },
                                    { icon: Stamp, label: '翻刻', fn: handleSaveAs, tilt: '-0.8deg' },
                                    { icon: Trash, label: '销版', fn: handleDelete, tilt: '1deg', danger: true },
                                ].map(({ icon: Icon, label, fn, tilt, danger }) => (
                                    <button
                                        key={label}
                                        onClick={fn}
                                        style={{ rotate: tilt }}
                                        className={`flex flex-col items-center gap-1 py-2 ${danger ? INK_BTN : STICKER}`}
                                    >
                                        <Icon size={15} weight="bold" />
                                        <span className="text-[9px] font-black">{label}</span>
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                    <input type="file" ref={fileInputRef} className="hidden" accept=".json,application/json" onChange={handleImportFile} />
                </div>

                {active && (
                    <>
                        {/* 接口联动 */}
                        <div className="relative bg-white border-2 border-[#1c1b1a]/60 p-4 space-y-3 rotate-[0.3deg]">
                            <span className="absolute -top-2 left-3 px-1.5 bg-[#f2f0e9] label-mono text-[8px] text-[#1c1b1a]/50">WIRE-UP / 接口联动</span>
                            <div className="border border-dashed border-[#1c1b1a]/40 px-3 py-2 text-xs text-[#1c1b1a]/60">
                                现在接的线：<span className="font-mono font-black text-[#1c1b1a]">{apiConfig.model || '还没设置'}</span>
                                {apiConfig.baseUrl && (
                                    <span className="font-mono text-[#1c1b1a]/40"> @ {(() => { try { return new URL(apiConfig.baseUrl).host; } catch { return apiConfig.baseUrl; } })()}</span>
                                )}
                            </div>
                            <div>
                                <label className="text-[11px] font-black mb-1 block">绑一套 API 方案（启用这副字版时自动接线）</label>
                                <div className="relative">
                                    <select
                                        value={active.moroApiPresetId ?? ''}
                                        onChange={e => {
                                            const val = e.target.value || undefined;
                                            mutateActive(d => { d.moroApiPresetId = val; });
                                            if (val) {
                                                const bound = apiPresets.find(ap => ap.id === val);
                                                if (bound) {
                                                    updateApiConfig(bound.config);
                                                    addToast(`接口已换线：「${bound.name}」`, 'success');
                                                }
                                            }
                                        }}
                                        className="w-full appearance-none bg-white border-2 border-[#1c1b1a]/60 px-3 py-2 text-xs font-bold outline-none focus:border-[#1c1b1a]"
                                    >
                                        <option value="">不绑（沿用文具盒里的全局 API）</option>
                                        {apiPresets.map(ap => (
                                            <option key={ap.id} value={ap.id}>{ap.name}（{ap.config.model}）</option>
                                        ))}
                                    </select>
                                    <span aria-hidden className="absolute right-3 top-1/2 -translate-y-1/2 text-xs pointer-events-none">▾</span>
                                </div>
                                <p className="text-[12px] text-[#1c1b1a]/55 mt-1 leading-relaxed" style={HAND_CN}>
                                    ✎ API 方案在「文具盒 → 接线盒（API 配置）」里存。温度那些由下面的「火候」接管（可以关）。
                                </p>
                            </div>
                        </div>

                        {/* 火候（生成参数） */}
                        <div className="relative bg-white border-2 border-[#1c1b1a]/60 rotate-[-0.3deg]">
                            <span className="absolute -top-2 left-3 px-1.5 bg-[#f2f0e9] label-mono text-[8px] text-[#1c1b1a]/50">SAMPLING / 火候</span>
                            <button
                                onClick={() => setShowParams(v => !v)}
                                className="w-full px-4 py-3.5 flex items-center justify-between"
                            >
                                <span className="text-[11px] font-black">温度、惩罚、token 上限…都在这格抽屉里</span>
                                <span className={`text-sm font-black transition-transform inline-block ${showParams ? 'rotate-90' : ''}`}>▸</span>
                            </button>
                            {showParams && (
                                <div className="px-4 pb-4 space-y-4">
                                    <div className="flex items-center justify-between border-2 border-dashed border-[#1c1b1a]/40 px-3 py-2.5">
                                        <div>
                                            <p className="text-[11px] font-black">火候随请求下发</p>
                                            <p className="text-[12px] text-[#1c1b1a]/50 mt-0.5" style={HAND_CN}>关掉的话字版只管排版，火候仍走「文具盒」里的全局 API 配置</p>
                                        </div>
                                        <InkSwitch on={applySampling} onChange={toggleSampling} small />
                                    </div>
                                    <SliderRow label="温度 Temperature" value={active.temperature} fallback={1} min={0} max={2} step={0.01} onChange={v => mutateActive(d => { d.temperature = v; })} />
                                    <SliderRow label="频率惩罚 Frequency Penalty" value={active.frequency_penalty} fallback={0} min={-2} max={2} step={0.01} onChange={v => mutateActive(d => { d.frequency_penalty = v; })} />
                                    <SliderRow label="存在惩罚 Presence Penalty" value={active.presence_penalty} fallback={0} min={-2} max={2} step={0.01} onChange={v => mutateActive(d => { d.presence_penalty = v; })} />
                                    <SliderRow label="Top P" value={active.top_p} fallback={1} min={0} max={1} step={0.01} onChange={v => mutateActive(d => { d.top_p = v; })} />
                                    <SliderRow label="Top K" value={active.top_k} fallback={0} min={0} max={500} step={1} onChange={v => mutateActive(d => { d.top_k = v; })} />
                                    <SliderRow label="重复惩罚 Repetition Penalty" value={active.repetition_penalty} fallback={1} min={0} max={3} step={0.01} onChange={v => mutateActive(d => { d.repetition_penalty = v; })} />
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="label-mono text-[8px] text-[#1c1b1a]/45 mb-1 block">上下文长度 (TOKENS)</label>
                                            <input
                                                type="number"
                                                value={active.openai_max_context ?? 4095}
                                                onChange={e => { const n = parseInt(e.target.value, 10); if (Number.isFinite(n)) mutateActive(d => { d.openai_max_context = n; }); }}
                                                className="w-full bg-white border-2 border-[#1c1b1a]/50 px-3 py-2 text-xs font-mono outline-none focus:border-[#1c1b1a]"
                                            />
                                            <p className="text-[12px] text-[#1c1b1a]/50 mt-1" style={HAND_CN}>只是存档（Moro 按消息条数截上下文）</p>
                                        </div>
                                        <div>
                                            <label className="label-mono text-[8px] text-[#1c1b1a]/45 mb-1 block">回复上限 (MAX_TOKENS)</label>
                                            <input
                                                type="number"
                                                value={active.openai_max_tokens ?? 8000}
                                                onChange={e => { const n = parseInt(e.target.value, 10); if (Number.isFinite(n)) mutateActive(d => { d.openai_max_tokens = n; }); }}
                                                className="w-full bg-white border-2 border-[#1c1b1a]/50 px-3 py-2 text-xs font-mono outline-none focus:border-[#1c1b1a]"
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* 排字架（提示词管理器） */}
                        <div className="relative bg-[#fbfaf6] border-2 border-[#1c1b1a] shadow-[4px_4px_0_#1c1b1a] p-4 space-y-3">
                            <Tape className="-top-2.5 right-6 rotate-[5deg] w-12" />
                            <div className="flex items-end justify-between">
                                <span className="label-mono text-[8px] text-[#1c1b1a]/45">COMPOSING STICK / 排字架</span>
                                <span className="label-mono text-[8px] text-[#1c1b1a]/35">墨量 ≈ {totalTokens} TK</span>
                            </div>

                            <div ref={listRef} className="space-y-2" onPointerMove={onDragPointerMove} onPointerUp={onDragPointerUp} onPointerCancel={onDragPointerUp}>
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
                                            className={`flex items-center gap-2 border-2 px-2 py-2 bg-white transition-all ${dragIdx === idx ? 'border-[#1c1b1a] shadow-[3px_3px_0_#1c1b1a] rotate-[-0.5deg]' : 'border-[#1c1b1a]/40'} ${entry.enabled ? '' : 'opacity-45'}`}
                                        >
                                            <div
                                                onPointerDown={onDragPointerDown(idx)}
                                                className="p-1 cursor-grab touch-none text-[#1c1b1a]/35 shrink-0"
                                                title="捏住拖动换位置"
                                            >
                                                <List size={15} weight="bold" />
                                            </div>
                                            <button onClick={() => setEditingId(entry.identifier)} className="flex-1 min-w-0 text-left">
                                                <div className="flex items-center gap-1.5">
                                                    {isMarker && <Placeholder size={12} weight="bold" className="shrink-0 text-[#1c1b1a]/60" />}
                                                    {isAbsolute && <ArrowElbowDownRight size={12} weight="bold" className="shrink-0 text-[#1c1b1a]/60" />}
                                                    <span className={`text-sm font-black truncate ${entry.enabled ? '' : 'line-through decoration-2'}`}>{prompt.name}</span>
                                                    {isAbsolute && <span className="label-mono text-[8px] text-[#1c1b1a]/50 shrink-0">@{prompt.injection_depth ?? 4}</span>}
                                                </div>
                                                <div className="flex items-center gap-1.5 mt-0.5">
                                                    <VoiceStamp role={prompt.role} />
                                                    {isCore
                                                        ? <span className="text-[10px] text-[#1c1b1a]/45 truncate">{hint}</span>
                                                        : <span className="label-mono text-[8px] text-[#1c1b1a]/40">≈{estimateTokens(prompt.content || '')} TK</span>}
                                                </div>
                                            </button>
                                            {!isCore && (
                                                <button onClick={() => handleDetach(entry.identifier)} className="p-1.5 text-[#1c1b1a]/40 hover:text-[#1c1b1a] active:scale-90 transition-all shrink-0" title="从架上取下（字条留在字库）">
                                                    <Eject size={14} weight="bold" />
                                                </button>
                                            )}
                                            <InkSwitch small on={entry.enabled} onChange={v => handleToggleEntry(entry.identifier, v)} />
                                        </div>
                                    );
                                })}
                            </div>

                            <div className="flex gap-2 pt-1">
                                <button onClick={handleNewPrompt} className={`flex-1 py-2.5 text-[10px] font-black flex items-center justify-center gap-1.5 rotate-[-0.4deg] ${INK_BTN}`}>
                                    <PenNib size={13} weight="bold" />刻一枚新字条
                                </button>
                                <button
                                    onClick={() => setShowInsert(true)}
                                    disabled={detachedPrompts.length === 0}
                                    className={`flex-1 py-2.5 text-[10px] font-black flex items-center justify-center gap-1.5 rotate-[0.4deg] disabled:opacity-35 ${STICKER}`}
                                >
                                    <StackPlus size={13} weight="bold" />从字库里捡一枚
                                </button>
                            </div>
                        </div>

                        <p className="text-[13px] text-[#1c1b1a]/50 leading-relaxed px-2 pb-4" style={HAND_CN}>
                            带 <Placeholder size={12} weight="bold" className="inline" /> 的是占位铅块（marker）：Chat History 处填进聊天记录；角色相关的铅块共同对应
                            Moro 的角色核心上下文（人设+世界书+记忆+印象），填在架上第一枚启用的角色铅块处。带 <ArrowElbowDownRight size={12} weight="bold" className="inline" /> 的按
                            @深度插进聊天历史（和酒馆的 In-Chat 注入一致）。
                        </p>
                    </>
                )}
            </div>

            {/* 字条编辑弹层 */}
            {editingPrompt && (
                <PromptEditor
                    prompt={editingPrompt}
                    onSave={handleSavePrompt}
                    onDelete={!editingPrompt.system_prompt && !editingPrompt.marker ? () => handleDeletePrompt(editingPrompt.identifier) : undefined}
                    onClose={() => setEditingId(null)}
                />
            )}

            {/* 从字库里捡一枚 */}
            {showInsert && (
                <div className="fixed inset-0 z-[100] flex items-end justify-center animate-fade-in" onClick={() => setShowInsert(false)}>
                    <div className="absolute inset-0 bg-[#1c1b1a]/45" />
                    <div
                        className="relative w-full max-h-[60vh] bg-[#f7f5ef] border-t-2 border-x-2 border-[#1c1b1a] p-5 overflow-y-auto no-scrollbar animate-slide-up"
                        style={DOT_BG}
                        onClick={e => e.stopPropagation()}
                    >
                        <Tape className="-top-2.5 left-1/2 -translate-x-1/2 rotate-[-3deg]" />
                        <button
                            onClick={() => setShowInsert(false)}
                            className={`absolute top-3 right-3 w-7 h-7 flex items-center justify-center rotate-[3deg] ${STICKER}`}
                            aria-label="合上字库"
                        >
                            <X size={13} weight="bold" color={INK} />
                        </button>
                        <div className="label-mono text-[9px] text-[#1c1b1a]/45">SPARE TYPES</div>
                        <h3 className="text-lg font-black tracking-wide mb-3">字库 —— 捡一枚回排字架</h3>
                        <div className="space-y-2">
                            {detachedPrompts.map((p, i) => (
                                <button
                                    key={p.identifier}
                                    onClick={() => handleInsertExisting(p.identifier)}
                                    className={`w-full flex items-center gap-2 px-3 py-2.5 text-left ${i % 2 === 0 ? 'rotate-[-0.3deg]' : 'rotate-[0.3deg]'} ${STICKER}`}
                                >
                                    {p.marker && <Placeholder size={12} weight="bold" className="shrink-0 text-[#1c1b1a]/60" />}
                                    <span className="text-sm font-black truncate flex-1">{p.name}</span>
                                    <VoiceStamp role={p.role} />
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
