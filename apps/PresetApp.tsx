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
import type { PresetPrompt, PresetPromptOrderEntry, TavernPreset } from '../types';
import {
    InsSheet, accent,
} from '../components/ui/insKit';
import {
    PenNib, TrayArrowDown, TrayArrowUp, NotePencil, Stamp, Trash,
    List, Placeholder, ArrowElbowDownRight, Eject, StackPlus,
    SlidersHorizontal, LinkSimple, FileText,
} from '@phosphor-icons/react';

const AC = 'typepress' as const;
const PRESS = accent(AC);
const INK = '#252338';
const INS_SOFT = '#716d80';
const CANVAS_BG = 'linear-gradient(155deg, #eef4ff 0%, #f7f1e8 48%, #ecf8f4 100%)';
const PAPER = '#fffdf8';
const LINE = 'rgba(37,35,56,0.10)';
const ACTIVE_TONE = { solid: '#16826f', soft: '#e3f4ef', ink: '#0d5c50' };
const COPPER_TONE = { solid: '#b86b2d', soft: '#fff0de', ink: '#7a4219' };
const WARN_TONE = { solid: '#c2582f', soft: '#fff1e8', ink: '#8a351c' };
const RULED_BG: React.CSSProperties = {
    backgroundImage: 'repeating-linear-gradient(transparent, transparent 23px, rgba(37,35,56,0.08) 23px, rgba(37,35,56,0.08) 24px)',
    lineHeight: '24px',
};
/** 斜纹（AI 口吻章的底纹） */
const HATCH_BG: React.CSSProperties = {
    backgroundImage: 'repeating-linear-gradient(45deg, rgba(22,130,111,0.17) 0 2px, transparent 2px 5px)',
};

const FIELD_STYLE: React.CSSProperties = {
    background: 'rgba(255,253,248,0.96)',
    border: `1px solid ${LINE}`,
    borderRadius: 16,
    color: INK,
    boxShadow: 'inset 0 1px 2px rgba(37,35,56,0.04)',
};

const PanelHeader: React.FC<{ title: string; en: string; sub?: string; onBack: () => void; status?: string }> = ({ title, en, sub, onBack, status }) => (
    <div className="shrink-0 flex items-center gap-3 px-3 py-3" style={{ paddingTop: 'calc(var(--safe-top) + 12px)', background: 'rgba(255,253,248,0.96)', borderBottom: `1px solid ${LINE}` }}>
        <button
            onClick={onBack}
            className="w-9 h-9 rounded-full flex items-center justify-center active:scale-90 transition-transform shrink-0"
            style={{ background: PAPER, color: PRESS.solid, border: `1px solid ${LINE}`, boxShadow: '0 1px 3px rgba(37,35,56,0.16)' }}
            aria-label="返回"
        >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.2} stroke="currentColor" className="w-[18px] h-[18px]">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
            </svg>
        </button>
        <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
                <span className="text-[16px] font-bold leading-tight" style={{ color: INK }}>{title}</span>
                <span className="text-[8.5px] tracking-[0.24em] select-none uppercase" style={{ color: PRESS.solid, fontFamily: 'var(--font-label)' }}>{en}</span>
            </div>
            {sub && <div className="text-[10px] truncate mt-0.5" style={{ color: INS_SOFT }}>{sub}</div>}
        </div>
        {status && (
            <span className="text-[10px] select-none shrink-0 px-2 py-1 rounded-full" style={{ color: ACTIVE_TONE.ink, background: ACTIVE_TONE.soft, border: `1px solid ${ACTIVE_TONE.solid}30` }}>
                {status}
            </span>
        )}
    </div>
);

const Page: React.FC<{ title: string; en: string; children: React.ReactNode }> = ({ title, en, children }) => (
    <section className="relative rounded-[18px]" style={{ background: 'rgba(255,253,248,0.96)', border: `1px solid ${LINE}`, boxShadow: '0 1px 2px rgba(37,35,56,0.04), 0 14px 30px -24px rgba(37,35,56,0.24)' }}>
        <div className="flex items-center justify-between gap-2 px-4 pt-3.5 pb-1">
            <span className="text-[15px] font-bold leading-tight" style={{ color: INK }}>{title}</span>
            <span className="text-[8.5px] tracking-[0.22em] uppercase select-none shrink-0" style={{ color: INS_SOFT, fontFamily: 'var(--font-label)' }}>{en}</span>
        </div>
        <div className="px-4 pb-5 pt-1">{children}</div>
    </section>
);

const Entry: React.FC<{ mark?: string; title: string; note?: string; side?: React.ReactNode; children?: React.ReactNode }> = ({ mark = '•', title, note, side, children }) => (
    <div className="py-3 border-b last:border-b-0" style={{ borderColor: `${PRESS.solid}22` }}>
        <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                    <span className="text-[10px] leading-none font-bold" style={{ color: PRESS.solid, fontFamily: 'var(--font-label)' }}>{mark}</span>
                    <span className="text-[12.5px] font-bold" style={{ color: INK }}>{title}</span>
                </div>
                {note && <p className="text-[10px] mt-1 leading-relaxed" style={{ color: INS_SOFT }}>{note}</p>}
            </div>
            {side && <div className="shrink-0 pt-0.5">{side}</div>}
        </div>
        {children && <div className="mt-2.5">{children}</div>}
    </div>
);

const PressChip: React.FC<{ active?: boolean; children: React.ReactNode; onClick?: () => void; tone?: 'press' | 'active' | 'copper' | 'plain' }> = ({ active, children, onClick, tone = 'press' }) => {
    const palette = tone === 'active' ? ACTIVE_TONE : tone === 'copper' ? COPPER_TONE : tone === 'plain' ? { solid: LINE, soft: PAPER, ink: INS_SOFT } : PRESS;
    const Comp = onClick ? 'button' : 'span';
    return (
        <Comp
            onClick={onClick as any}
            className={`px-3 py-1.5 text-[11px] font-bold rounded-full max-w-full truncate ${onClick ? 'active:scale-95 transition-transform' : ''}`}
            style={{
                background: active ? palette.soft : PAPER,
                color: active ? palette.ink : INS_SOFT,
                border: `1px solid ${active ? `${palette.solid}42` : LINE}`,
                boxShadow: active ? `0 6px 14px -12px ${palette.solid}` : 'none',
            }}
        >
            {children}
        </Comp>
    );
};

const PressButton: React.FC<{ children: React.ReactNode; onClick?: () => void; icon?: React.ReactNode; disabled?: boolean; tone?: 'press' | 'plain' | 'danger' | 'active' | 'copper'; className?: string; title?: string }> = ({ children, onClick, icon, disabled, tone = 'press', className = '', title }) => {
    const palette = tone === 'danger' ? WARN_TONE : tone === 'active' ? ACTIVE_TONE : tone === 'copper' ? COPPER_TONE : PRESS;
    const soft = tone === 'plain';
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            title={title}
            className={`inline-flex items-center justify-center gap-1.5 rounded-full text-[11px] font-bold active:scale-95 transition-transform disabled:opacity-40 disabled:active:scale-100 ${className}`}
            style={{
                background: soft ? PAPER : palette.soft,
                color: soft ? INS_SOFT : palette.ink,
                border: `1px solid ${soft ? LINE : `${palette.solid}3b`}`,
                boxShadow: '0 1px 2px rgba(37,35,56,0.07)',
            }}
        >
            {icon}{children}
        </button>
    );
};

// ---------------------------------------------------------------------------
// 小部件

/** role 标签 */
const VoiceStamp: React.FC<{ role?: string }> = ({ role }) => {
    const r = role || 'system';
    if (r === 'assistant') {
        return <span className="label-mono text-[8px] px-1.5 py-0.5 rounded-full shrink-0" style={{ ...HATCH_BG, backgroundColor: ACTIVE_TONE.soft, border: `1px solid ${ACTIVE_TONE.solid}3f`, color: ACTIVE_TONE.ink }}>assistant</span>;
    }
    if (r === 'user') {
        return <span className="label-mono text-[8px] px-1.5 py-0.5 rounded-full shrink-0" style={{ background: COPPER_TONE.soft, border: `1px solid ${COPPER_TONE.solid}3f`, color: COPPER_TONE.ink }}>user</span>;
    }
    return <span className="label-mono text-[8px] px-1.5 py-0.5 text-white rounded-full shrink-0" style={{ background: PRESS.solid }}>system</span>;
};

const InkSwitch: React.FC<{ on: boolean; onChange: (v: boolean) => void; small?: boolean }> = ({ on, onChange, small }) => (
    <button
        onClick={() => onChange(!on)}
        role="switch"
        aria-checked={on}
        className={`relative ${small ? 'w-[42px] h-[24px]' : 'w-[52px] h-[28px]'} rounded-full shrink-0 transition-all duration-300 active:scale-95`}
        style={{
            background: on ? ACTIVE_TONE.solid : '#f6f2ed',
            border: `1px solid ${on ? `${ACTIVE_TONE.solid}30` : LINE}`,
            boxShadow: on ? `0 8px 16px -12px ${ACTIVE_TONE.solid}` : 'inset 0 1px 2px rgba(37,35,56,0.08)',
        }}
    >
        {!small && <span className="absolute top-1/2 -translate-y-1/2 left-2 text-[8px] font-bold transition-opacity pointer-events-none" style={{ color: 'rgba(255,255,255,0.92)', opacity: on ? 1 : 0, fontFamily: 'var(--font-label)' }}>ON</span>}
        {!small && <span className="absolute top-1/2 -translate-y-1/2 right-2 text-[8px] font-bold transition-opacity pointer-events-none" style={{ color: '#b4aaa0', opacity: on ? 0 : 1, fontFamily: 'var(--font-label)' }}>off</span>}
        <span
            className={`absolute top-1/2 -translate-y-1/2 ${small ? 'w-[18px] h-[18px]' : 'w-[22px] h-[22px]'} rounded-full bg-white transition-all duration-300`}
            style={{ left: on ? (small ? 20 : 27) : 3, boxShadow: '0 2px 6px rgba(37,35,56,0.22)' }}
        />
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
                    className="w-20 text-right text-xs font-mono px-2 py-1 outline-none focus:ring-2"
                    style={{ ...FIELD_STYLE, ['--tw-ring-color' as any]: `${PRESS.solid}24` }}
                />
            </div>
            <input
                type="range"
                value={v}
                min={min}
                max={max}
                step={step}
                onChange={e => onChange(parseFloat(e.target.value))}
                className="w-full"
                style={{ accentColor: PRESS.solid }}
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
        <div className="fixed inset-0 z-[100] flex flex-col animate-fade-in" style={{ background: CANVAS_BG, color: INK }}>
            <PanelHeader
                title={isMarker ? '系统占位' : '编辑提示词'}
                en={isMarker ? 'MARKER' : 'PROMPT'}
                sub={isMarker ? '系统自动填充，支持调整列表位置' : '编辑后自动写入当前预设'}
                onBack={onClose}
                status={isMarker ? '只读' : '待保存'}
            />

            <div className="relative z-10 flex-1 overflow-y-auto no-scrollbar px-3 pt-5 pb-10 space-y-6">
                <Page title="基础信息" en="Name">
                    <Entry mark="ID" title="提示词名称" note={isMarker ? '系统占位名称用于在列表中识别，内容由发送流程自动填充。' : '名称只影响管理界面，不会直接写入发送内容。'}>
                    <input
                        value={name}
                        onChange={e => setName(e.target.value)}
                        disabled={isMarker}
                        className="w-full px-4 py-3 text-sm font-bold outline-none disabled:opacity-45"
                        style={FIELD_STYLE}
                    />
                    </Entry>
                </Page>

                {isMarker ? (
                    <Page title="自动内容" en="System Slot">
                        <Entry mark="SYS" title="发送时填充" note={markerHint || '发送时由系统自动填充内容，这里只能调整它在提示词列表中的位置和开关。'}>
                            <div className="rounded-[14px] px-3 py-2.5 text-[11px] leading-relaxed" style={{ background: PRESS.soft, color: PRESS.ink, border: `1px solid ${PRESS.solid}26` }}>
                                该条目属于内置 marker，不需要手动编辑正文。
                            </div>
                        </Entry>
                    </Page>
                ) : (
                    <>
                        <Page title="注入规则" en="Runtime">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[11px] font-bold mb-1.5 block" style={{ color: INK }}>消息角色</label>
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
                                    <label className="text-[11px] font-bold mb-1.5 block" style={{ color: INK }}>注入位置</label>
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
                                        <label className="text-[11px] font-bold mb-1.5 block" style={{ color: INK }}>@Depth 深度</label>
                                        <input
                                            type="number" min={0} max={9999} value={depth}
                                            onChange={e => { const n = parseInt(e.target.value, 10); if (Number.isFinite(n)) setDepth(Math.max(0, n)); }}
                                            className="w-full px-3 py-3 text-xs font-mono outline-none"
                                            style={FIELD_STYLE}
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[11px] font-bold mb-1.5 block" style={{ color: INK }}>同深度排序</label>
                                        <input
                                            type="number" min={0} max={9999} value={order}
                                            onChange={e => { const n = parseInt(e.target.value, 10); if (Number.isFinite(n)) setOrder(n); }}
                                            className="w-full px-3 py-3 text-xs font-mono outline-none"
                                            style={FIELD_STYLE}
                                        />
                                    </div>
                                </div>
                            )}
                        </Page>

                        <Page title="提示词内容" en="Content">
                            <div className="flex items-end justify-between mb-2">
                                <span className="text-[12.5px] font-bold" style={{ color: INK }}>正文</span>
                                <span className="label-mono text-[8px]" style={{ color: INS_SOFT }}>≈ {estimateTokens(content)} tokens</span>
                            </div>
                            <textarea
                                value={content}
                                onChange={e => setContent(e.target.value)}
                                placeholder="支持 {{char}} / {{user}} / {{date}} / {{time}} 等宏"
                                className="w-full h-72 px-4 py-3 text-xs leading-6 resize-none outline-none placeholder:text-slate-400"
                                style={{ ...FIELD_STYLE, ...RULED_BG }}
                            />
                        </Page>

                        <div className="grid grid-cols-2 gap-2">
                            {onDelete && <PressButton tone="danger" onClick={onDelete} className="py-3 text-[12px]" icon={<Trash size={15} weight="bold" />}>删除提示词</PressButton>}
                            <PressButton tone="press" onClick={save} className={`${onDelete ? '' : 'col-span-2'} py-3 text-[12px]`} icon={<PenNib size={15} weight="bold" />}>保存修改</PressButton>
                        </div>
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
            .catch(e => addToast(`预设列表读取失败: ${e?.message || e}`, 'error'))
            .finally(() => setLoaded(true));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // 把激活预设自带的正则即时推进运行时缓存：切换预设 / 启停预设 / 改动正则都会
    // 立刻反映到聊天管线与气泡渲染（未启用或没选中本预设时为空）。其余时机（App 启动、
    // 每次发送）由 OSContext / chatRequestPayload 兜底刷新。
    useEffect(() => {
        setPresetRegexScripts(enabled && active ? active.regexScripts ?? null : null);
    }, [enabled, active]);

    // ── 持久化 ──────────────────────────────────────────
    const persistPreset = (next: TavernPreset) => {
        next.updatedAt = Date.now();
        setPresets(prev => prev.map(p => (p.id === next.id ? next : p)));
        DB.savePreset(next).catch(e => addToast(`预设保存失败: ${e?.message || e}`, 'error'));
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
        // API 联动：预设绑定了 API 方案时，激活即套用对应连接配置。
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
        const preset = createDefaultPreset(`预设 ${presets.length + 1}`);
        setPresets(prev => [...prev, preset]);
        DB.savePreset(preset).catch(() => addToast('预设保存失败', 'error'));
        selectPreset(preset.id);
        addToast('已新建默认预设', 'success');
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
            if (!enabled) addToast(`已导入${regexNote}。当前未启用预设，请在顶部状态区打开开关`, 'info');
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
        <div className="absolute inset-0 flex flex-col overflow-hidden animate-fade-in" style={{ background: CANVAS_BG, color: INK }}>
            <input type="file" ref={fileInputRef} className="hidden" accept=".json,application/json" onChange={handleImportFile} />
            <PanelHeader
                title="活字盘"
                en="PROMPT PRESETS"
                sub={loaded ? `${active?.name || '未选择预设'} · 更改会自动保存` : '正在读取本地预设'}
                onBack={closeApp}
                status="自动保存"
            />

            <div className="relative z-10 flex-1 overflow-y-auto no-scrollbar px-3 pt-5 pb-12 space-y-6">
                <Page title="当前预设" en="Active Preset">
                    <Entry
                        mark="ON"
                        title={enabled ? '预设已启用' : '预设未启用'}
                        note={enabled ? '聊天请求会使用当前选中的提示词顺序、marker 和随预设正则。' : '聊天请求仍使用 Moro 默认提示词组装，下面的预设配置暂不接管。'}
                        side={<InkSwitch on={enabled} onChange={toggleEnabled} />}
                    >
                        <div className="flex flex-wrap gap-2">
                            <PressChip active tone="press">{presets.length} 个预设</PressChip>
                            <PressChip active tone="active">{enabledEntriesCount}/{orderEntries.length} 条启用</PressChip>
                            <PressChip tone="plain">约 {totalTokens} tokens</PressChip>
                            <PressChip tone="plain">{markerEntriesCount} 个 marker</PressChip>
                        </div>
                    </Entry>

                    <Entry mark="SET" title="预设文件" note="新建、导入、复制后会自动选中；所有修改都会写入本地 IndexedDB。">

                    {loaded && presets.length === 0 ? (
                        <div className="py-2 space-y-3 text-center">
                            <div className="text-[13px] font-bold" style={{ color: INK }}>暂无预设</div>
                            <div className="grid grid-cols-2 gap-2">
                                <PressButton onClick={handleNewPreset} className="py-2.5" icon={<PenNib size={14} weight="bold" />}>新建默认预设</PressButton>
                                <PressButton onClick={() => fileInputRef.current?.click()} tone="plain" className="py-2.5" icon={<TrayArrowDown size={14} weight="bold" />}>导入 JSON</PressButton>
                            </div>
                        </div>
                    ) : (
                        <>
                            <div className="relative">
                                <select
                                    value={activeId ?? ''}
                                    onChange={e => selectPreset(e.target.value)}
                                    className="w-full appearance-none px-4 py-3 text-sm font-extrabold outline-none"
                                    style={FIELD_STYLE}
                                >
                                    {presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                </select>
                                <span aria-hidden className="absolute right-3 top-1/2 -translate-y-1/2 text-sm pointer-events-none">▾</span>
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                                {[
                                    { icon: PenNib, label: '新建', fn: handleNewPreset, tone: 'press' as const },
                                    { icon: TrayArrowDown, label: '导入', fn: () => fileInputRef.current?.click(), tone: 'press' as const },
                                    { icon: TrayArrowUp, label: '导出', fn: handleExport, tone: 'press' as const },
                                    { icon: NotePencil, label: '重命名', fn: handleRename, tone: 'plain' as const },
                                    { icon: Stamp, label: '复制', fn: handleSaveAs, tone: 'plain' as const },
                                    { icon: Trash, label: '删除', fn: handleDelete, tone: 'danger' as const },
                                ].map(({ icon: Icon, label, fn, tone }) => (
                                    <PressButton
                                        key={label}
                                        tone={tone}
                                        onClick={fn}
                                        className="py-2.5 text-[11px]"
                                        icon={<Icon size={14} weight="bold" />}
                                    >
                                        {label}
                                    </PressButton>
                                ))}
                            </div>
                        </>
                    )}
                    </Entry>
                </Page>

                {active && (
                    <>
                        <Page title="API 与采样" en="Model Route">
                            <Entry mark="API" title="API 方案" note="绑定后，切换到这个预设时会同步套用对应的连接配置。" side={<LinkSimple size={18} weight="bold" style={{ color: PRESS.solid }} />}>
                                <div className="rounded-[14px] px-3 py-2.5 text-[11px] font-mono mb-2.5" style={{ background: PRESS.soft, color: PRESS.ink, border: `1px solid ${PRESS.solid}20` }}>
                                    {apiConfig.model || '未设置模型'}{apiHost ? ` @ ${apiHost}` : ''}
                                </div>
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
                                                    addToast(`已切换 API 方案：「${bound.name}」`, 'success');
                                                }
                                            }
                                        }}
                                        className="w-full appearance-none px-4 py-3 text-xs font-bold outline-none"
                                        style={FIELD_STYLE}
                                    >
                                        <option value="">不绑定 API 方案</option>
                                        {apiPresets.map(ap => (
                                            <option key={ap.id} value={ap.id}>{ap.name}（{ap.config.model}）</option>
                                        ))}
                                    </select>
                                    <span aria-hidden className="absolute right-3 top-1/2 -translate-y-1/2 text-xs pointer-events-none">▾</span>
                                </div>
                            </Entry>

                            <Entry
                                mark="SMP"
                                title="采样参数"
                                note="控制当前预设的回复自由度、长度和重复惩罚；可选择是否随请求下发。"
                                side={<PressButton tone="copper" onClick={() => setShowParams(v => !v)} className="px-3 py-1.5" icon={<SlidersHorizontal size={14} weight="bold" />}>{showParams ? '收起' : '展开'}</PressButton>}
                            >
                                {showParams && (
                                    <div className="space-y-4">
                                        <div className="flex items-center justify-between rounded-[14px] px-3 py-2.5" style={{ background: COPPER_TONE.soft, border: `1px solid ${COPPER_TONE.solid}24` }}>
                                            <div>
                                                <p className="text-[11px] font-bold" style={{ color: COPPER_TONE.ink }}>采样参数随请求下发</p>
                                                <p className="text-[10px] mt-0.5" style={{ color: COPPER_TONE.ink, opacity: 0.72 }}>关闭后使用全局 API 配置。</p>
                                            </div>
                                            <InkSwitch on={applySampling} onChange={toggleSampling} small />
                                        </div>
                                        <SliderRow label="Temperature" value={active.temperature} fallback={1} min={0} max={2} step={0.01} onChange={v => mutateActive(d => { d.temperature = v; })} />
                                        <SliderRow label="Frequency Penalty" value={active.frequency_penalty} fallback={0} min={-2} max={2} step={0.01} onChange={v => mutateActive(d => { d.frequency_penalty = v; })} />
                                        <SliderRow label="Presence Penalty" value={active.presence_penalty} fallback={0} min={-2} max={2} step={0.01} onChange={v => mutateActive(d => { d.presence_penalty = v; })} />
                                        <SliderRow label="Top P" value={active.top_p} fallback={1} min={0} max={1} step={0.01} onChange={v => mutateActive(d => { d.top_p = v; })} />
                                        <SliderRow label="Top K" value={active.top_k} fallback={0} min={0} max={500} step={1} onChange={v => mutateActive(d => { d.top_k = v; })} />
                                        <SliderRow label="Repetition Penalty" value={active.repetition_penalty} fallback={1} min={0} max={3} step={0.01} onChange={v => mutateActive(d => { d.repetition_penalty = v; })} />
                                        <div className="grid grid-cols-2 gap-3">
                                            <div>
                                                <label className="text-[11px] font-bold mb-1 block" style={{ color: INK }}>上下文 tokens</label>
                                                <input
                                                    type="number"
                                                    value={active.openai_max_context ?? 4095}
                                                    onChange={e => { const n = parseInt(e.target.value, 10); if (Number.isFinite(n)) mutateActive(d => { d.openai_max_context = n; }); }}
                                                    className="w-full px-3 py-2 text-xs font-mono outline-none"
                                                    style={FIELD_STYLE}
                                                />
                                            </div>
                                            <div>
                                                <label className="text-[11px] font-bold mb-1 block" style={{ color: INK }}>回复 tokens</label>
                                                <input
                                                    type="number"
                                                    value={active.openai_max_tokens ?? 8000}
                                                    onChange={e => { const n = parseInt(e.target.value, 10); if (Number.isFinite(n)) mutateActive(d => { d.openai_max_tokens = n; }); }}
                                                    className="w-full px-3 py-2 text-xs font-mono outline-none"
                                                    style={FIELD_STYLE}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </Entry>
                        </Page>

                        <Page title="提示词列表" en="Prompt Order">
                            <Entry mark="ORD" title="发送顺序" note="拖动左侧列表图标排序；关闭某条后，它不会进入本次聊天请求。" side={<PressChip tone="plain">≈ {totalTokens} tokens</PressChip>}>
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
                                                className={`flex items-center gap-2 rounded-[14px] px-2.5 py-2.5 transition-all ${entry.enabled ? '' : 'opacity-50'}`}
                                                style={{
                                                    background: dragIdx === idx ? PRESS.soft : PAPER,
                                                    border: `1px solid ${dragIdx === idx ? PRESS.solid : LINE}`,
                                                    boxShadow: dragIdx === idx ? `0 14px 30px -18px ${PRESS.solid}` : '0 1px 2px rgba(37,35,56,0.04)',
                                                }}
                                            >
                                                <div
                                                    onPointerDown={onDragPointerDown(idx)}
                                                    className="p-1 cursor-grab touch-none shrink-0"
                                                    style={{ color: INS_SOFT }}
                                                    title="拖动排序"
                                                >
                                                    <List size={16} weight="bold" />
                                                </div>
                                                <button onClick={() => setEditingId(entry.identifier)} className="flex-1 min-w-0 text-left">
                                                    <div className="flex items-center gap-1.5">
                                                        {isMarker && <Placeholder size={13} weight="bold" className="shrink-0" style={{ color: PRESS.solid }} />}
                                                        {isAbsolute && <ArrowElbowDownRight size={13} weight="bold" className="shrink-0" style={{ color: PRESS.solid }} />}
                                                        <span className={`text-sm font-bold truncate ${entry.enabled ? '' : 'line-through decoration-2'}`} style={{ color: INK }}>{prompt.name}</span>
                                                        {isAbsolute && <span className="label-mono text-[8px] shrink-0" style={{ color: INS_SOFT }}>@{prompt.injection_depth ?? 4}</span>}
                                                    </div>
                                                    <div className="flex items-center gap-1.5 mt-1 min-w-0">
                                                        <VoiceStamp role={prompt.role} />
                                                        {isCore
                                                            ? <span className="text-[10px] truncate" style={{ color: INS_SOFT }}>{hint}</span>
                                                            : <span className="label-mono text-[8px]" style={{ color: INS_SOFT }}>≈ {estimateTokens(prompt.content || '')} tokens</span>}
                                                    </div>
                                                </button>
                                                {!isCore && (
                                                    <button onClick={() => handleDetach(entry.identifier)} className="p-1.5 active:scale-90 transition-all shrink-0" style={{ color: INS_SOFT }} title="从当前列表移除">
                                                        <Eject size={15} weight="bold" />
                                                    </button>
                                                )}
                                                <InkSwitch small on={entry.enabled} onChange={v => handleToggleEntry(entry.identifier, v)} />
                                            </div>
                                        );
                                    })}
                                </div>
                            </Entry>

                            <Entry mark="ADD" title="管理提示词" note="marker 由系统在发送时填充；@Depth 提示词按 ST In-Chat 规则插入聊天历史。">
                                <div className="grid grid-cols-2 gap-2">
                                    <PressButton onClick={handleNewPrompt} className="py-2.5 text-[12px]" icon={<PenNib size={14} weight="bold" />}>新增提示词</PressButton>
                                    <PressButton
                                        onClick={() => setShowInsert(true)}
                                        disabled={detachedPrompts.length === 0}
                                        tone="plain"
                                        className="py-2.5 text-[12px]"
                                        icon={<StackPlus size={14} weight="bold" />}
                                    >
                                        插入未使用
                                    </PressButton>
                                </div>
                            </Entry>
                        </Page>

                    </>
                )}
            </div>

            {editingPrompt && (
                <PromptEditor
                    prompt={editingPrompt}
                    onSave={handleSavePrompt}
                    onDelete={!editingPrompt.system_prompt && !editingPrompt.marker ? () => handleDeletePrompt(editingPrompt.identifier) : undefined}
                    onClose={() => setEditingId(null)}
                />
            )}

            <InsSheet open={showInsert} title="未使用提示词" onClose={() => setShowInsert(false)}>
                <div className="space-y-2 max-h-[55vh] overflow-y-auto no-scrollbar">
                    {detachedPrompts.length === 0 ? (
                        <div className="py-8 text-center text-[12px]" style={{ color: INS_SOFT }}>没有可插入的未使用提示词。</div>
                    ) : detachedPrompts.map((p) => (
                        <button
                            key={p.identifier}
                            onClick={() => handleInsertExisting(p.identifier)}
                            className="w-full flex items-center gap-2 px-3 py-3 text-left rounded-2xl active:scale-[0.98] transition-transform"
                            style={{ background: PAPER, border: `1px solid ${LINE}`, color: INK }}
                        >
                            {p.marker ? <Placeholder size={14} weight="bold" className="shrink-0" style={{ color: PRESS.solid }} /> : <FileText size={14} weight="bold" className="shrink-0" style={{ color: PRESS.solid }} />}
                            <span className="text-sm font-extrabold truncate flex-1">{p.name}</span>
                            <VoiceStamp role={p.role} />
                        </button>
                    ))}
                </div>
            </InsSheet>
        </div>
    );
};

export default PresetApp;
