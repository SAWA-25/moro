/**
 * 活字盘 —— SillyTavern Chat Completion 预设管理器的 Moro 移植。
 *
 * 数据结构 / ST 语义保持不变：这里管理预设、提示词顺序、marker、采样参数和随预设正则。
 * Moro 是 local-first，所有改动即时写入 IndexedDB，不需要额外保存按钮。
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
import { setPresetRegexScripts } from '../utils/regex/store';
import { PLACEMENT_LABELS, createEmptyRegexScript, looksLikeWrapMisconfig } from '../utils/regex/engine';
import RegexEditor from '../components/regex/RegexEditor';
import type { PresetPrompt, PresetPromptOrderEntry, RegexScriptData, TavernPreset } from '../types';
import {
    InsShell, InsHeader, InsScroll, InsCard, InsButton, IconCircle, Polaroid,
    SectionLabel, Chip, InsSheet, accent, INK as INS_INK, INK_SOFT as INS_SOFT,
} from '../components/ui/insKit';
import {
    PenNib, TrayArrowDown, TrayArrowUp, NotePencil, Stamp, Trash,
    List, Placeholder, ArrowElbowDownRight, Eject, StackPlus, X, Scissors,
    Power, SlidersHorizontal, LinkSimple, FileText, Sparkle, CheckCircle,
} from '@phosphor-icons/react';

const AC = 'sky' as const;
const SKY = accent(AC);
const INK = INS_INK;
const STICKER = 'rounded-full bg-white press-soft border border-black/[0.05] shadow-[0_6px_16px_-8px_rgba(38,36,42,0.32)]';
const INK_BTN = 'rounded-full bg-[#26242a] text-white press-soft shadow-[0_12px_24px_-12px_rgba(38,36,42,0.55)]';
const HAND_CN: React.CSSProperties = { fontFamily: "'Long Cang', 'Caveat', cursive" };
const DOT_BG: React.CSSProperties = { background: 'radial-gradient(120% 80% at 50% -10%, rgba(14,165,233,0.06), transparent 60%)' };
const RULED_BG: React.CSSProperties = {
    backgroundImage: 'repeating-linear-gradient(transparent, transparent 23px, rgba(38,36,42,0.08) 23px, rgba(38,36,42,0.08) 24px)',
    lineHeight: '24px',
};
/** 斜纹（AI 口吻章的底纹） */
const HATCH_BG: React.CSSProperties = {
    backgroundImage: 'repeating-linear-gradient(45deg, rgba(14,165,233,0.18) 0 2px, transparent 2px 5px)',
};

const FIELD_STYLE: React.CSSProperties = {
    background: 'rgba(255,255,255,0.94)',
    border: '1px solid rgba(0,0,0,0.06)',
    borderRadius: 16,
    color: INK,
    boxShadow: 'inset 0 1px 2px rgba(38,38,38,0.03)',
};

const Tape: React.FC<{ className?: string }> = ({ className }) => (
    <div aria-hidden className={`pointer-events-none absolute h-5 w-16 ${className || ''}`}
        style={{ background: 'rgba(255,255,255,0.75)', backgroundImage: 'repeating-linear-gradient(90deg, rgba(255,255,255,0.4) 0 5px, transparent 5px 11px)', borderRadius: 2, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }} />
);

// ---------------------------------------------------------------------------
// 小部件

/** role 标签 */
const VoiceStamp: React.FC<{ role?: string }> = ({ role }) => {
    const r = role || 'system';
    if (r === 'assistant') {
        return <span className="label-mono text-[8px] px-1.5 py-0.5 border border-[#0ea5e9]/30 text-[#075985] rounded-full shrink-0" style={HATCH_BG}>assistant</span>;
    }
    if (r === 'user') {
        return <span className="label-mono text-[8px] px-1.5 py-0.5 border border-[#0ea5e9]/30 text-[#075985] bg-white rounded-full shrink-0">user</span>;
    }
    return <span className="label-mono text-[8px] px-1.5 py-0.5 bg-[#0ea5e9] text-white rounded-full shrink-0">system</span>;
};

const InkSwitch: React.FC<{ on: boolean; onChange: (v: boolean) => void; small?: boolean }> = ({ on, onChange, small }) => (
    <button
        onClick={() => onChange(!on)}
        className={`relative ${small ? 'w-9 h-5' : 'w-11 h-6'} rounded-full shrink-0 transition-colors press-soft`}
        style={{ background: on ? '#0ea5e9' : '#dcd9d3' }}
    >
        <span className={`absolute top-0.5 ${small ? 'w-4 h-4' : 'w-5 h-5'} rounded-full bg-white transition-all shadow`} style={{ left: on ? `calc(100% - ${small ? '1.125rem' : '1.375rem'})` : '0.125rem' }} />
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
                <span className="text-[11px] font-extrabold" style={{ color: INK }}>{label}</span>
                <input
                    type="number"
                    value={v}
                    min={min}
                    max={max}
                    step={step}
                    onChange={e => { const n = parseFloat(e.target.value); if (Number.isFinite(n)) onChange(n); }}
                    className="w-20 text-right text-xs font-mono px-2 py-1 outline-none focus:ring-2 focus:ring-sky-100"
                    style={FIELD_STYLE}
                />
            </div>
            <input
                type="range"
                value={v}
                min={min}
                max={max}
                step={step}
                onChange={e => onChange(parseFloat(e.target.value))}
                className="w-full accent-[#0ea5e9]"
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
        <div className="fixed inset-0 z-[100] flex flex-col animate-fade-in" style={{ background: '#f7f5f2', color: INK }}>
            <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-56" style={{ background: `radial-gradient(120% 90% at 50% -28%, ${SKY.soft}, transparent 70%)` }} />
            <InsHeader
                accent={AC}
                title={isMarker ? '系统占位' : '编辑提示词'}
                en={isMarker ? 'MARKER' : 'PROMPT'}
                onBack={onClose}
                right={!isMarker ? <InsButton onClick={save} accent={AC} className="px-4 py-2 text-[12px]">保存</InsButton> : undefined}
            />

            <InsScroll className="p-4 space-y-4 pb-8">
                <InsCard accent={AC} className="p-4 space-y-2">
                    <SectionLabel en="NAME" accent={AC}>提示词名称</SectionLabel>
                    <input
                        value={name}
                        onChange={e => setName(e.target.value)}
                        disabled={isMarker}
                        className="w-full px-4 py-3 text-sm font-bold outline-none disabled:opacity-45"
                        style={FIELD_STYLE}
                    />
                </InsCard>

                {isMarker ? (
                    <InsCard accent={AC} edge className="p-4 space-y-3">
                        <SectionLabel en="SYSTEM SLOT" accent={AC}>自动插入内容</SectionLabel>
                        <div className="flex items-start gap-3">
                            <span className="mt-0.5 inline-flex w-9 h-9 rounded-full items-center justify-center shrink-0" style={{ background: SKY.soft, color: SKY.solid }}>
                                <Placeholder size={18} weight="bold" />
                            </span>
                            <p className="text-[13px] leading-relaxed" style={{ color: INS_SOFT }}>
                                {markerHint || '发送时由系统自动填充内容，这里只能调整它在提示词列表中的位置和开关。'}
                            </p>
                        </div>
                    </InsCard>
                ) : (
                    <>
                        <InsCard accent={AC} className="p-4 space-y-4">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[11px] font-extrabold mb-1.5 block" style={{ color: INK }}>消息角色</label>
                                    <div className="relative">
                                        <select
                                            value={role}
                                            onChange={e => setRole(e.target.value as 'system' | 'user' | 'assistant')}
                                            className="w-full appearance-none px-3 py-3 text-xs font-bold outline-none"
                                            style={FIELD_STYLE}
                                        >
                                            <option value="system">system · 系统提示</option>
                                            <option value="user">user · 用户消息</option>
                                            <option value="assistant">assistant · 助手消息</option>
                                        </select>
                                        <span aria-hidden className="absolute right-3 top-1/2 -translate-y-1/2 text-xs pointer-events-none">▾</span>
                                    </div>
                                </div>
                                <div>
                                    <label className="text-[11px] font-extrabold mb-1.5 block" style={{ color: INK }}>注入位置</label>
                                    <div className="relative">
                                        <select
                                            value={position}
                                            onChange={e => setPosition(parseInt(e.target.value, 10))}
                                            className="w-full appearance-none px-3 py-3 text-xs font-bold outline-none"
                                            style={FIELD_STYLE}
                                        >
                                            <option value={INJECTION_POSITION.RELATIVE}>按列表顺序插入</option>
                                            <option value={INJECTION_POSITION.ABSOLUTE}>按 @Depth 插入历史</option>
                                        </select>
                                        <span aria-hidden className="absolute right-3 top-1/2 -translate-y-1/2 text-xs pointer-events-none">▾</span>
                                    </div>
                                </div>
                            </div>

                            {position === INJECTION_POSITION.ABSOLUTE && (
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="text-[11px] font-extrabold mb-1.5 block" style={{ color: INK }}>@Depth 深度</label>
                                        <input
                                            type="number" min={0} max={9999} value={depth}
                                            onChange={e => { const n = parseInt(e.target.value, 10); if (Number.isFinite(n)) setDepth(Math.max(0, n)); }}
                                            className="w-full px-3 py-3 text-xs font-mono outline-none"
                                            style={FIELD_STYLE}
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[11px] font-extrabold mb-1.5 block" style={{ color: INK }}>同深度排序</label>
                                        <input
                                            type="number" min={0} max={9999} value={order}
                                            onChange={e => { const n = parseInt(e.target.value, 10); if (Number.isFinite(n)) setOrder(n); }}
                                            className="w-full px-3 py-3 text-xs font-mono outline-none"
                                            style={FIELD_STYLE}
                                        />
                                    </div>
                                </div>
                            )}
                        </InsCard>

                        <InsCard accent={AC} className="p-4">
                            <div className="flex items-end justify-between mb-2">
                                <SectionLabel en="CONTENT" accent={AC}>提示词内容</SectionLabel>
                                <span className="label-mono text-[8px]" style={{ color: INS_SOFT }}>≈ {estimateTokens(content)} tokens</span>
                            </div>
                            <textarea
                                value={content}
                                onChange={e => setContent(e.target.value)}
                                placeholder="支持 {{char}} / {{user}} / {{date}} / {{time}} 等宏"
                                className="w-full h-72 px-4 py-3 text-xs leading-6 resize-none outline-none placeholder:text-slate-400"
                                style={{ ...FIELD_STYLE, ...RULED_BG }}
                            />
                        </InsCard>

                        {onDelete && (
                            <InsButton
                                variant="soft"
                                accent="rose"
                                onClick={onDelete}
                                className="w-full py-3 text-[13px]"
                                icon={<Trash size={15} weight="bold" />}
                            >
                                删除这条提示词
                            </InsButton>
                        )}
                    </>
                )}
            </InsScroll>
        </div>
    );
};

// ---------------------------------------------------------------------------
// 主组件

const PresetApp: React.FC = () => {
    const { closeApp, addToast, apiPresets, apiConfig, updateApiConfig, userProfile } = useOS();
    const [presets, setPresets] = useState<TavernPreset[]>([]);
    const [activeId, setActiveId] = useState<string | null>(PresetRuntime.getActiveId());
    const [enabled, setEnabled] = useState(PresetRuntime.isEnabled());
    const [applySampling, setApplySampling] = useState(PresetRuntime.isSamplingApplied());
    const [loaded, setLoaded] = useState(false);
    const [showParams, setShowParams] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [showInsert, setShowInsert] = useState(false);
    // 随字版正则补丁的编辑弹层（缝纫台），与补丁铺共用同一个 RegexEditor
    const [editingRegex, setEditingRegex] = useState<RegexScriptData | null>(null);
    const [editingRegexIsNew, setEditingRegexIsNew] = useState(false);
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
            .catch(e => addToast(`预设列表读取失败: ${e?.message || e}`, 'error'))
            .finally(() => setLoaded(true));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // 把激活字版自带的正则即时推进运行时缓存：选字版 / 开关印坊 / 改动正则都会
    // 立刻反映到聊天管线与气泡渲染（歇业或没选中本字版时为空）。其余时机（App 启动、
    // 每次发送）由 OSContext / chatRequestPayload 兜底刷新。
    useEffect(() => {
        setPresetRegexScripts(enabled && active ? active.regexScripts ?? null : null);
    }, [enabled, active]);

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
                addToast(`已切换 API 方案：「${bound.name}」`, 'info');
            }
        }
    };

    // ── 预设操作 ──────────────────────────────────────
    const handleNewPreset = () => {
        const name = window.prompt('新建预设名称', `预设 ${presets.length + 1}`);
        if (name === null) return;
        const preset = createDefaultPreset(name.trim() || 'Default');
        setPresets(prev => [...prev, preset]);
        DB.savePreset(preset).catch(() => addToast('预设保存失败', 'error'));
        selectPreset(preset.id);
        addToast('已新建预设', 'success');
    };

    const handleSaveAs = () => {
        if (!active) return;
        const name = window.prompt('复制为新预设', `${active.name} 副本`);
        if (name === null) return;
        const copy: TavernPreset = JSON.parse(JSON.stringify(active));
        copy.id = crypto.randomUUID();
        copy.name = name.trim() || `${active.name} 副本`;
        copy.createdAt = Date.now();
        copy.updatedAt = Date.now();
        setPresets(prev => [...prev, copy]);
        DB.savePreset(copy).catch(() => addToast('预设保存失败', 'error'));
        selectPreset(copy.id);
        addToast('已复制为新预设', 'success');
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
        DB.deletePreset(id).catch(() => addToast('预设删除失败', 'error'));
        const rest = presets.filter(p => p.id !== id);
        setPresets(rest);
        const nextId = rest[0]?.id ?? null;
        setActiveId(nextId);
        PresetRuntime.setActiveId(nextId);
        addToast('已删除预设', 'success');
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
            const regexCount = preset.regexScripts?.length ?? 0;
            const regexNote = regexCount > 0 ? `，随带 ${regexCount} 条正则补丁` : '';
            if (!enabled) addToast(`已导入${regexNote}。当前未启用预设，请在右上角打开开关`, 'info');
            else addToast(`已导入「${preset.name}」${regexNote}`, 'success');
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

    // ── 提示词顺序 ──────────────────────────────────────
    const orderEntries: PresetPromptOrderEntry[] = useMemo(() => {
        if (!active) return [];
        const po = active.prompt_order.find(p => p.character_id === ORDER_CHAR_ID_SINGLE) || active.prompt_order[0];
        return po?.order ?? [];
    }, [active]);

    const promptById = useMemo(() => new Map((active?.prompts ?? []).map(p => [p.identifier, p])), [active]);

    const mutateOrder = (fn: (order: PresetPromptOrderEntry[]) => void) => {
        mutateActive(d => {
            // 单聊 / 群聊两份 order 同步改：Moro 的群聊走独立链路，保持两份一致最不意外。
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
        if (!window.confirm('删除这条提示词？它会从当前预设中彻底移除。')) return;
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

    // ── 随字版的正则补丁（ST extensions.regex_scripts，PRESET 作用域） ──────
    const presetRegex = active?.regexScripts ?? [];

    const togglePresetRegex = (id: string, on: boolean) => {
        mutateActive(d => {
            d.regexScripts = (d.regexScripts ?? []).map(s => (s.id === id ? { ...s, disabled: !on } : s));
        });
    };

    /** 「误配置一键修」：USER_INPUT + 看起来在包裹但没勾 promptOnly → 一键改成 promptOnly=true。 */
    const fixPresetRegexWrap = (id: string) => {
        const target = (active?.regexScripts ?? []).find(s => s.id === id);
        if (!target) return;
        if (!window.confirm(`把「${target.scriptName || '未命名补丁'}」改为只处理发送给 LLM 的内容？\n\n勾上 promptOnly 后，聊天原文和气泡显示不会被改写。`)) return;
        mutateActive(d => {
            d.regexScripts = (d.regexScripts ?? []).map(s => (s.id === id ? { ...s, promptOnly: true } : s));
        });
        addToast('已改为只处理发送内容', 'success');
    };

    const deletePresetRegex = (id: string) => {
        if (!window.confirm('删除这条随预设的正则补丁？不会影响补丁铺里的通用补丁。')) return;
        mutateActive(d => {
            d.regexScripts = (d.regexScripts ?? []).filter(s => s.id !== id);
        });
    };

    // 新缝一条 / 拆开重缝（与补丁铺共用 RegexEditor）。缝牢后写回 active.regexScripts，
    // 经 mutateActive → persistPreset → setPresets 触发 active 引用更新，上面那条
    // useEffect([enabled, active]) 立刻把改动推进运行时缓存，聊天与气泡渲染即时生效。
    const openNewPresetRegex = () => {
        if (!active) return;
        setEditingRegex(createEmptyRegexScript());
        setEditingRegexIsNew(true);
    };

    const openEditPresetRegex = (s: RegexScriptData) => {
        setEditingRegex({ ...s, trimStrings: [...(s.trimStrings || [])], placement: [...(s.placement || [])] });
        setEditingRegexIsNew(false);
    };

    const savePresetRegex = () => {
        if (!editingRegex) return;
        if (!editingRegex.findRegex.trim()) { addToast('查找正则不能为空', 'error'); return; }
        const named = { ...editingRegex, scriptName: editingRegex.scriptName.trim() || '未命名补丁' };
        mutateActive(d => {
            const list = d.regexScripts ?? [];
            d.regexScripts = list.some(s => s.id === named.id)
                ? list.map(s => (s.id === named.id ? named : s))
                : [...list, named];
        });
        setEditingRegex(null);
        addToast('正则补丁已保存', 'success');
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
            DB.savePreset(next).catch(() => addToast('预设保存失败', 'error'));
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

    const enabledEntriesCount = useMemo(() => orderEntries.filter(e => e.enabled).length, [orderEntries]);
    const markerEntriesCount = useMemo(
        () => orderEntries.filter(e => !!promptById.get(e.identifier)?.marker).length,
        [orderEntries, promptById],
    );
    const activeApiPreset = useMemo(() => {
        if (!active?.moroApiPresetId) return null;
        return apiPresets.find(ap => ap.id === active.moroApiPresetId) || null;
    }, [active?.moroApiPresetId, apiPresets]);
    const apiHost = useMemo(() => {
        if (!apiConfig.baseUrl) return '';
        try { return new URL(apiConfig.baseUrl).host; } catch { return apiConfig.baseUrl; }
    }, [apiConfig.baseUrl]);

    // ── 渲染 ────────────────────────────────────────────
    return (
        <div className="h-full w-full bg-[#f7f5f2] text-[#26242a] flex flex-col animate-fade-in" style={{ ...DOT_BG, paddingTop: 'var(--safe-top)' }}>
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
                        <div className="label-mono text-[8px] text-[#26242a]/45">TYPESETTING TRAY — PROMPT PRESS</div>
                        <div className="flex items-baseline gap-2">
                            <h1 className="text-2xl font-black tracking-[0.08em]">活字盘</h1>
                            <span className="text-sm text-[#26242a]/55 truncate" style={HAND_CN}>提示词一块块排好再开印</span>
                        </div>
                    </div>
                    {/* 开印章：预设总开关 */}
                    <button
                        onClick={() => toggleEnabled(!enabled)}
                        title={enabled ? '印坊开着工：激活的字版接管提示词与火候。点一下歇业' : '印坊歇业中：聊天走 Moro 原生组装。点一下开印'}
                        className={`shrink-0 w-14 h-14 rounded-full border-2 flex flex-col items-center justify-center rotate-[6deg] select-none transition-all active:scale-95 ${enabled ? 'border-[#1c1b1a] bg-[#1c1b1a] text-white shadow-[0_12px_24px_-12px_rgba(38,36,42,0.45)]' : 'border-dashed border-[#1c1b1a]/60 bg-white text-[#26242a]/60'}`}
                    >
                        <span className="text-sm font-black leading-none">{enabled ? '开印' : '歇业'}</span>
                        <span className="label-mono text-[6px] leading-none mt-1 opacity-70">{enabled ? 'ON' : 'OFF'}</span>
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto no-scrollbar p-4 space-y-5 pb-10">
                {!enabled && (
                    <div className="relative border-2 border-dashed border-[#1c1b1a]/50 bg-white/55 px-4 py-3 rotate-[-0.3deg]">
                        <p className="text-[13px] text-[#26242a]/60 leading-relaxed" style={HAND_CN}>
                            印坊歇业中：聊天走 Moro 原生的信件组装，下面排得再好也不会上机。按一下右上角的「开印」章，激活的字版才会接管提示词结构和火候。
                        </p>
                    </div>
                )}

                {/* 字版条 */}
                <div className="relative bg-white border border-black/10 rounded-xl shadow-[0_12px_24px_-12px_rgba(38,36,42,0.45)] p-4 space-y-3">
                    <Tape className="-top-2.5 left-6 rotate-[-4deg]" />
                    <div className="flex items-end justify-between">
                        <span className="label-mono text-[8px] text-[#26242a]/45">ACTIVE PLATE / 在用的字版</span>
                        <span className="text-[11px] text-[#26242a]/45" style={HAND_CN}>改动随手就存，不用按保存</span>
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
                                    className="w-full appearance-none bg-white border border-black/10 rounded-xl px-3 py-2.5 text-sm font-black outline-none focus:border-dashed"
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
                        <div className="relative bg-white border border-black/10 rounded-xl/60 p-4 space-y-3 rotate-[0.3deg]">
                            <span className="absolute -top-2 left-3 px-1.5 bg-[#f7f5f2] label-mono text-[8px] text-[#26242a]/50">WIRE-UP / 接口联动</span>
                            <div className="border border-dashed border-[#1c1b1a]/40 px-3 py-2 text-xs text-[#26242a]/60">
                                现在接的线：<span className="font-mono font-black text-[#26242a]">{apiConfig.model || '还没设置'}</span>
                                {apiConfig.baseUrl && (
                                    <span className="font-mono text-[#26242a]/40"> @ {(() => { try { return new URL(apiConfig.baseUrl).host; } catch { return apiConfig.baseUrl; } })()}</span>
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
                                        className="w-full appearance-none bg-white border border-black/10 rounded-xl/60 px-3 py-2 text-xs font-bold outline-none focus:border-[#1c1b1a]"
                                    >
                                        <option value="">不绑（沿用文具盒里的全局 API）</option>
                                        {apiPresets.map(ap => (
                                            <option key={ap.id} value={ap.id}>{ap.name}（{ap.config.model}）</option>
                                        ))}
                                    </select>
                                    <span aria-hidden className="absolute right-3 top-1/2 -translate-y-1/2 text-xs pointer-events-none">▾</span>
                                </div>
                                <p className="text-[12px] text-[#26242a]/55 mt-1 leading-relaxed" style={HAND_CN}>
                                    ✎ API 方案在「文具盒 → 接线盒（API 配置）」里存。温度那些由下面的「火候」接管（可以关）。
                                </p>
                            </div>
                        </div>

                        {/* 火候（生成参数） */}
                        <div className="relative bg-white border border-black/10 rounded-xl/60 rotate-[-0.3deg]">
                            <span className="absolute -top-2 left-3 px-1.5 bg-[#f7f5f2] label-mono text-[8px] text-[#26242a]/50">SAMPLING / 火候</span>
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
                                            <p className="text-[12px] text-[#26242a]/50 mt-0.5" style={HAND_CN}>关掉的话字版只管排版，火候仍走「文具盒」里的全局 API 配置</p>
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
                                            <label className="label-mono text-[8px] text-[#26242a]/45 mb-1 block">上下文长度 (TOKENS)</label>
                                            <input
                                                type="number"
                                                value={active.openai_max_context ?? 4095}
                                                onChange={e => { const n = parseInt(e.target.value, 10); if (Number.isFinite(n)) mutateActive(d => { d.openai_max_context = n; }); }}
                                                className="w-full bg-white border border-black/10 rounded-xl/50 px-3 py-2 text-xs font-mono outline-none focus:border-[#1c1b1a]"
                                            />
                                            <p className="text-[12px] text-[#26242a]/50 mt-1" style={HAND_CN}>只是存档（Moro 按消息条数截上下文）</p>
                                        </div>
                                        <div>
                                            <label className="label-mono text-[8px] text-[#26242a]/45 mb-1 block">回复上限 (MAX_TOKENS)</label>
                                            <input
                                                type="number"
                                                value={active.openai_max_tokens ?? 8000}
                                                onChange={e => { const n = parseInt(e.target.value, 10); if (Number.isFinite(n)) mutateActive(d => { d.openai_max_tokens = n; }); }}
                                                className="w-full bg-white border border-black/10 rounded-xl/50 px-3 py-2 text-xs font-mono outline-none focus:border-[#1c1b1a]"
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* 排字架（提示词管理器） */}
                        <div className="relative bg-white border border-black/10 rounded-xl shadow-[0_12px_24px_-12px_rgba(38,36,42,0.45)] p-4 space-y-3">
                            <Tape className="-top-2.5 right-6 rotate-[5deg] w-12" />
                            <div className="flex items-end justify-between">
                                <span className="label-mono text-[8px] text-[#26242a]/45">COMPOSING STICK / 排字架</span>
                                <span className="label-mono text-[8px] text-[#26242a]/35">墨量 ≈ {totalTokens} TK</span>
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
                                            className={`flex items-center gap-2 border-2 px-2 py-2 bg-white transition-all ${dragIdx === idx ? 'border-[#1c1b1a] shadow-[0_12px_24px_-12px_rgba(38,36,42,0.45)] rotate-[-0.5deg]' : 'border-[#1c1b1a]/40'} ${entry.enabled ? '' : 'opacity-45'}`}
                                        >
                                            <div
                                                onPointerDown={onDragPointerDown(idx)}
                                                className="p-1 cursor-grab touch-none text-[#26242a]/35 shrink-0"
                                                title="捏住拖动换位置"
                                            >
                                                <List size={15} weight="bold" />
                                            </div>
                                            <button onClick={() => setEditingId(entry.identifier)} className="flex-1 min-w-0 text-left">
                                                <div className="flex items-center gap-1.5">
                                                    {isMarker && <Placeholder size={12} weight="bold" className="shrink-0 text-[#26242a]/60" />}
                                                    {isAbsolute && <ArrowElbowDownRight size={12} weight="bold" className="shrink-0 text-[#26242a]/60" />}
                                                    <span className={`text-sm font-black truncate ${entry.enabled ? '' : 'line-through decoration-2'}`}>{prompt.name}</span>
                                                    {isAbsolute && <span className="label-mono text-[8px] text-[#26242a]/50 shrink-0">@{prompt.injection_depth ?? 4}</span>}
                                                </div>
                                                <div className="flex items-center gap-1.5 mt-0.5">
                                                    <VoiceStamp role={prompt.role} />
                                                    {isCore
                                                        ? <span className="text-[10px] text-[#26242a]/45 truncate">{hint}</span>
                                                        : <span className="label-mono text-[8px] text-[#26242a]/40">≈{estimateTokens(prompt.content || '')} TK</span>}
                                                </div>
                                            </button>
                                            {!isCore && (
                                                <button onClick={() => handleDetach(entry.identifier)} className="p-1.5 text-[#26242a]/40 hover:text-[#26242a] active:scale-90 transition-all shrink-0" title="从架上取下（字条留在字库）">
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

                        <p className="text-[13px] text-[#26242a]/50 leading-relaxed px-2" style={HAND_CN}>
                            带 <Placeholder size={12} weight="bold" className="inline" /> 的是占位铅块（marker）：Chat History 处填进聊天记录；角色相关的铅块共同对应
                            Moro 的角色核心上下文（人设+世界书+记忆+印象），填在架上第一枚启用的角色铅块处。带 <ArrowElbowDownRight size={12} weight="bold" className="inline" /> 的按
                            @深度插进聊天历史（和酒馆的 In-Chat 注入一致）。
                        </p>

                        {/* 随字版的正则补丁（ST extensions.regex_scripts，PRESET 作用域）：
                            随字版走，可在这里直接增/删/改/启停（与补丁铺共用缝纫台）。 */}
                        <div className="relative bg-white border border-black/10 rounded-xl shadow-[0_12px_24px_-12px_rgba(38,36,42,0.45)] p-4 space-y-3">
                            <Tape className="-top-2.5 left-8 rotate-[3deg] w-12" />
                            <div className="flex items-end justify-between">
                                <span className="label-mono text-[8px] text-[#26242a]/45 flex items-center gap-1">
                                    <Scissors size={11} weight="bold" /> PRESET PATCHES / 随字版的补丁
                                </span>
                                <span className="label-mono text-[8px] text-[#26242a]/35">{presetRegex.length} 条</span>
                            </div>
                            <p className="text-[12px] text-[#26242a]/55 leading-relaxed" style={HAND_CN}>
                                这些正则补丁跟着这副字版走（酒馆 extensions.regex_scripts）：只有选中本字版、且印坊开印时才生效，执行顺序排在补丁铺「满铺通用」之后、角色「只缝给 TA」之前。点一条即可拆开重缝。
                            </p>
                            {presetRegex.length > 0 && (
                                <div className="space-y-2">
                                    {presetRegex.map(s => {
                                        const places = (s.placement || []).map(p => PLACEMENT_LABELS[p]).filter(Boolean).join(' · ');
                                        const scope = s.markdownOnly ? '只改显示' : s.promptOnly ? '只改寄出' : '改原文';
                                        return (
                                            <div
                                                key={s.id}
                                                className={`flex items-center gap-2 border border-black/10 rounded-xl/40 px-2 py-2 bg-white ${s.disabled ? 'opacity-45' : ''}`}
                                            >
                                                <Scissors size={14} weight="bold" className="shrink-0 text-[#26242a]/55" />
                                                <button onClick={() => openEditPresetRegex(s)} className="flex-1 min-w-0 text-left" title="拆开重缝这条补丁">
                                                    <div className={`text-sm font-black truncate ${s.disabled ? 'line-through decoration-2' : ''}`}>{s.scriptName}</div>
                                                    <div className="label-mono text-[9px] text-[#26242a]/40 truncate">{s.findRegex}</div>
                                                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                                        <span className="label-mono text-[8px] px-1.5 py-0.5 border border-[#1c1b1a]/60 text-[#26242a]/70">{scope}</span>
                                                        {places && <span className="label-mono text-[8px] text-[#26242a]/40 truncate">{places}</span>}
                                                        {looksLikeWrapMisconfig(s) && (
                                                            <span
                                                                role="button"
                                                                tabIndex={0}
                                                                onClick={(e) => { e.stopPropagation(); fixPresetRegexWrap(s.id); }}
                                                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); fixPresetRegexWrap(s.id); } }}
                                                                title="这条会改聊天原文（包裹会落库）。多半本意是只改寄给 LLM 的提示词——点这里一键改成「只改寄出的信」。"
                                                                className="label-mono text-[8px] px-1.5 py-0.5 border border-[#1c1b1a] bg-[#fff3a3] text-[#26242a] rotate-[-1.5deg] shadow-[1.5px_1.5px_0_#1c1b1a] cursor-pointer active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all"
                                                            >
                                                                ⚠ 像在改原文？一键改
                                                            </span>
                                                        )}
                                                    </div>
                                                </button>
                                                <button onClick={() => deletePresetRegex(s.id)} className="p-1.5 text-[#26242a]/40 hover:text-[#26242a] active:scale-90 transition-all shrink-0" title="拆掉这条补丁">
                                                    <Trash size={14} weight="bold" />
                                                </button>
                                                <InkSwitch small on={!s.disabled} onChange={v => togglePresetRegex(s.id, v)} />
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                            <button
                                onClick={openNewPresetRegex}
                                className={`w-full py-2 text-[10px] font-black flex items-center justify-center gap-1.5 ${STICKER}`}
                            >
                                <Scissors size={13} weight="bold" /> 给这副字版缝一条补丁
                            </button>
                        </div>
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

            {/* 随字版正则补丁的缝纫台（与补丁铺共用 RegexEditor） */}
            {editingRegex && (
                <RegexEditor
                    script={editingRegex}
                    isNew={editingRegexIsNew}
                    userName={userProfile?.name || 'User'}
                    charName={'{{char}}'}
                    eyebrow={{ neu: 'NEW PRESET PATCH', old: 'RE-STITCH PRESET' }}
                    onChange={setEditingRegex}
                    onSave={savePresetRegex}
                    onClose={() => setEditingRegex(null)}
                />
            )}

            {/* 从字库里捡一枚 */}
            {showInsert && (
                <div className="fixed inset-0 z-[100] flex items-end justify-center animate-fade-in" onClick={() => setShowInsert(false)}>
                    <div className="absolute inset-0 bg-black/40" />
                    <div
                        className="relative w-full max-h-[60vh] bg-white border-t-2 border-x-2 border-[#1c1b1a] p-5 overflow-y-auto no-scrollbar animate-slide-up"
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
                        <div className="label-mono text-[9px] text-[#26242a]/45">SPARE TYPES</div>
                        <h3 className="text-lg font-black tracking-wide mb-3">字库 —— 捡一枚回排字架</h3>
                        <div className="space-y-2">
                            {detachedPrompts.map((p, i) => (
                                <button
                                    key={p.identifier}
                                    onClick={() => handleInsertExisting(p.identifier)}
                                    className={`w-full flex items-center gap-2 px-3 py-2.5 text-left ${i % 2 === 0 ? 'rotate-[-0.3deg]' : 'rotate-[0.3deg]'} ${STICKER}`}
                                >
                                    {p.marker && <Placeholder size={12} weight="bold" className="shrink-0 text-[#26242a]/60" />}
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
