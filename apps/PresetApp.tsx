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
    ORDER_CHAR_ID_GROUP,
    PRESET_SCOPE_KEYS,
    PRESET_SCOPE_META,
    PresetRuntime,
    applyPresetToMessages,
    applySafePresetFixes,
    createDefaultPreset,
    createPresetLocalId,
    createPresetSnapshot,
    diagnosePreset,
    diffPresetSnapshot,
    ensureDefaultPresetSeed,
    estimateTokens,
    exportTavernPreset,
    getEditablePresetOrderForScope,
    getPresetOrderForScope,
    getPresetOrderSource,
    importTavernPreset,
    normalizePresetScopes,
    restorePresetSnapshotAsCopy,
    setPresetScopeOrder,
} from '../utils/presets';
import { buildChatRequestPayload } from '../utils/chatRequestPayload';
import { setPresetRegexScripts } from '../utils/regex/store';
import type { Message, PresetPrompt, PresetPromptOrderEntry, PresetScopeKey, TavernPreset } from '../types';
import { InsSheet } from '../components/ui/insKit';
import { MONO_STACK, CUTE_STACK } from '../components/handbook/paper';
import {
    PenNib, TrayArrowDown, TrayArrowUp, NotePencil, Stamp, Trash,
    List, Placeholder, ArrowElbowDownRight, Eject, StackPlus,
    SlidersHorizontal, LinkSimple, FileText, MagnifyingGlass, PushPinSimple, XCircle, CaretDown,
} from '@phosphor-icons/react';

const PRESS = { solid: '#4f9dc3', soft: '#eef8fc', ink: '#165f79' };
const INK = '#263447';
const INS_SOFT = '#67768a';
const CANVAS_BG =
    'radial-gradient(90% 54% at 50% -18%, rgba(79,157,195,0.18), transparent 68%),' +
    'linear-gradient(180deg, #f6fbff 0%, #fffdf8 52%, #f4faf7 100%)';
const PAPER = '#fffefa';
const LINE = 'rgba(70,111,135,0.16)';
const ACTIVE_TONE = { solid: '#4f9f82', soft: '#effaf5', ink: '#276653' };
const COPPER_TONE = { solid: '#d7a64f', soft: '#fff7e6', ink: '#7a5b1f' };
const WARN_TONE = { solid: '#d96f77', soft: '#fff1f2', ink: '#9b3f48' };
const RULED_BG: React.CSSProperties = {
    backgroundImage: 'repeating-linear-gradient(transparent, transparent 23px, rgba(79,157,195,0.12) 23px, rgba(79,157,195,0.12) 24px)',
    lineHeight: '24px',
};
/** 斜纹（AI 口吻章的底纹） */
const HATCH_BG: React.CSSProperties = {
    backgroundImage: 'repeating-linear-gradient(45deg, rgba(79,159,130,0.18) 0 2px, transparent 2px 5px)',
};

const FIELD_STYLE: React.CSSProperties = {
    background: PAPER,
    border: `1px solid ${LINE}`,
    borderRadius: 14,
    color: INK,
    caretColor: PRESS.solid,
    boxShadow: 'inset 0 1px 2px rgba(38,52,71,0.04)',
};

const PINNED_PRESETS_KEY = 'os_preset_pinned_ids';

const readPinnedPresetIds = (): string[] => {
    try {
        if (typeof localStorage === 'undefined') return [];
        const raw = localStorage.getItem(PINNED_PRESETS_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
    } catch {
        return [];
    }
};

const savePinnedPresetIds = (ids: string[]) => {
    try {
        if (typeof localStorage === 'undefined') return;
        localStorage.setItem(PINNED_PRESETS_KEY, JSON.stringify(ids));
    } catch { /* ignore */ }
};

const PanelHeader: React.FC<{ title: string; en: string; sub?: string; onBack: () => void; status?: string }> = ({ title, en, sub, onBack, status }) => (
    <div className="shrink-0 flex items-center gap-3 px-3 py-3" style={{ background: '#ffffff', borderBottom: '1px solid #ededed' }}>
        <button
            onClick={onBack}
            className="w-9 h-9 rounded-full bg-white flex items-center justify-center active:scale-90 transition-transform shrink-0"
            style={{ color: PRESS.ink, border: '1px solid #e3edf2', boxShadow: '0 1px 3px rgba(38,52,71,0.14)' }}
            aria-label="返回"
        >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.2} stroke="currentColor" className="w-[18px] h-[18px]">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
            </svg>
        </button>
        <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
                <span className="text-[16px] font-bold leading-tight" style={{ ...CUTE_STACK, color: INK }}>{title}</span>
                <span className="text-[8.5px] tracking-[0.24em] select-none uppercase" style={{ ...MONO_STACK, color: PRESS.solid }}>{en}</span>
            </div>
            {sub && <div className="text-[10px] truncate mt-0.5" style={{ color: INS_SOFT }}>{sub}</div>}
        </div>
        {status && (
            <span className="text-[10px] select-none shrink-0 px-2 py-1 rounded-full" style={{ color: PRESS.ink, background: PRESS.soft, border: `1px solid ${LINE}` }}>
                {status}
            </span>
        )}
    </div>
);

const Page: React.FC<{ title: string; en: string; children: React.ReactNode; anchor?: string }> = ({ title, en, children, anchor }) => (
    <section data-manual-anchor={anchor} className="relative overflow-hidden rounded-[18px] bg-white" style={{ border: `1px solid ${LINE}`, boxShadow: '0 1px 2px rgba(38,38,38,0.04), 0 14px 30px -24px rgba(38,52,71,0.26)' }}>
        <span aria-hidden className="absolute left-4 top-0 h-[3px] w-16 rounded-b-full" style={{ background: `linear-gradient(90deg, ${PRESS.solid}, ${COPPER_TONE.solid})` }} />
        <div className="flex items-center justify-between gap-2 px-4 pt-3.5 pb-1">
            <span className="text-[15px] font-bold leading-tight" style={{ ...CUTE_STACK, color: INK }}>{title}</span>
            <span className="text-[8.5px] tracking-[0.22em] uppercase select-none shrink-0" style={{ ...MONO_STACK, color: INS_SOFT }}>{en}</span>
        </div>
        <div className="px-4 pb-5 pt-1">{children}</div>
    </section>
);

const Entry: React.FC<{ mark?: string; title: string; note?: string; side?: React.ReactNode; children?: React.ReactNode }> = ({ mark = 'TYPE', title, note, side, children }) => (
    <div className="py-3 border-b last:border-b-0" style={{ borderColor: 'rgba(70,111,135,0.14)' }}>
        <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                    <span className="text-[8px] leading-none font-bold tracking-[0.18em]" style={{ ...MONO_STACK, color: PRESS.solid }}>{mark}</span>
                    <span className="text-[12.5px] font-bold" style={{ ...CUTE_STACK, color: INK }}>{title}</span>
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
                ...CUTE_STACK,
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
                color: soft ? PRESS.ink : palette.ink,
                border: `1px solid ${soft ? LINE : `${palette.solid}3b`}`,
                boxShadow: '0 1px 2px rgba(38,52,71,0.08)',
                ...CUTE_STACK,
            }}
        >
            {icon}{children}
        </button>
    );
};

const StatTile: React.FC<{ label: string; value: React.ReactNode; tone?: 'press' | 'active' | 'copper' | 'plain' }> = ({ label, value, tone = 'plain' }) => {
    const palette = tone === 'active' ? ACTIVE_TONE : tone === 'copper' ? COPPER_TONE : tone === 'press' ? PRESS : { solid: '#cfd9df', soft: '#ffffff', ink: INS_SOFT };
    return (
        <div
            className="min-w-0 rounded-[14px] px-3 py-2"
            style={{ background: palette.soft, border: `1px solid ${palette.solid}30`, boxShadow: '0 8px 18px -16px rgba(38,52,71,0.24)' }}
        >
            <div className="text-[8px] tracking-[0.22em] uppercase truncate" style={{ ...MONO_STACK, color: palette.ink }}>{label}</div>
            <div className="text-[16px] font-black truncate mt-0.5" style={{ color: palette.ink }}>{value}</div>
        </div>
    );
};

const HeroPlate: React.FC<{ activeName: string; enabled: boolean; presetCount: number; enabledEntries: number; totalEntries: number; totalTokens: number; markerEntries: number; onToggle: (v: boolean) => void }> = ({
    activeName, enabled, presetCount, enabledEntries, totalEntries, totalTokens, markerEntries, onToggle,
}) => (
    <section
        data-manual-anchor="manual-presets-root"
        className="relative overflow-hidden rounded-[24px] p-4"
        style={{
            background: 'linear-gradient(135deg, rgba(255,255,255,0.96), rgba(238,248,252,0.96))',
            border: `1px solid ${LINE}`,
            boxShadow: '0 20px 48px -30px rgba(38,52,71,0.42)',
        }}
    >
        <div
            aria-hidden
            className="absolute left-4 bottom-3 right-4 h-px"
            style={{ background: 'linear-gradient(90deg, transparent, rgba(79,157,195,0.22), transparent)' }}
        />
        <div className="relative flex items-start gap-3">
            <div className="shrink-0 bg-white p-1.5 pb-3 rounded-[10px]" style={{ boxShadow: '0 14px 28px -18px rgba(38,52,71,0.42)', border: '1px solid rgba(70,111,135,0.12)' }}>
                <div
                    className="w-16 h-16 rounded-[5px] flex flex-col items-center justify-center"
                    style={{
                        background: 'linear-gradient(135deg, #eef8fc 0%, #fff7e6 100%)',
                        border: `1px solid ${LINE}`,
                    }}
                >
                    <Stamp size={32} weight="duotone" style={{ color: INK }} />
                </div>
                <div className="text-[9px] font-bold text-center mt-1 truncate max-w-16" style={{ ...CUTE_STACK, color: INS_SOFT }}>活字盘</div>
            </div>
            <div className="min-w-0 flex-1 pt-1">
                <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[9px] tracking-[0.28em] uppercase shrink-0" style={{ ...MONO_STACK, color: PRESS.solid }}>当前预设</span>
                    <span className="h-px flex-1" style={{ background: 'rgba(70,111,135,0.16)' }} />
                </div>
                <div className="text-[19px] font-black truncate mt-1" style={{ ...CUTE_STACK, color: INK }}>{activeName}</div>
                <div className="text-[10.5px] leading-relaxed mt-1" style={{ color: INS_SOFT }}>
                    {enabled ? '当前预设已接管提示词顺序、marker 和随预设正则。' : '当前未启用预设，聊天仍使用默认提示词组装。'}
                </div>
            </div>
            <InkSwitch on={enabled} onChange={onToggle} />
        </div>
        <div className="relative grid grid-cols-4 gap-2 mt-4">
            <StatTile tone="press" label="预设数" value={presetCount} />
            <StatTile tone="active" label="启用条目" value={`${enabledEntries}/${totalEntries}`} />
            <StatTile tone="copper" label="预计 tokens" value={`≈${totalTokens}`} />
            <StatTile label="占位符" value={markerEntries} />
        </div>
    </section>
);

// ---------------------------------------------------------------------------
// 小部件

/** role 标签 */
const VoiceStamp: React.FC<{ role?: string }> = ({ role }) => {
    const r = role || 'system';
    if (r === 'assistant') {
        return <span className="label-mono text-[8px] px-1.5 py-0.5 rounded-full shrink-0" style={{ ...HATCH_BG, backgroundColor: ACTIVE_TONE.soft, border: `1px solid ${ACTIVE_TONE.solid}55`, color: ACTIVE_TONE.ink }}>assistant</span>;
    }
    if (r === 'user') {
        return <span className="label-mono text-[8px] px-1.5 py-0.5 rounded-full shrink-0" style={{ background: COPPER_TONE.soft, border: `1px solid ${COPPER_TONE.solid}55`, color: COPPER_TONE.ink }}>user</span>;
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
            border: on ? `1px solid ${ACTIVE_TONE.solid}40` : `1px solid ${LINE}`,
            boxShadow: on ? '0 8px 16px -12px rgba(79,159,130,0.48)' : 'inset 0 1px 2px rgba(38,52,71,0.08)',
        }}
    >
        {!small && <span className="absolute top-1/2 -translate-y-1/2 left-2 text-[8px] font-bold transition-opacity pointer-events-none" style={{ ...MONO_STACK, color: 'rgba(255,255,255,0.92)', opacity: on ? 1 : 0 }}>ON</span>}
        {!small && <span className="absolute top-1/2 -translate-y-1/2 right-2 text-[8px] font-bold transition-opacity pointer-events-none" style={{ ...MONO_STACK, color: '#a8b5bf', opacity: on ? 0 : 1 }}>off</span>}
        <span
            className={`absolute top-1/2 -translate-y-1/2 ${small ? 'w-[18px] h-[18px]' : 'w-[22px] h-[22px]'} rounded-full bg-white transition-all duration-300`}
            style={{ left: on ? (small ? 20 : 27) : 3, boxShadow: '0 2px 6px rgba(38,52,71,0.24)' }}
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
                <span className="text-[11px] font-extrabold" style={{ ...CUTE_STACK, color: INK }}>{label}</span>
                <input
                    type="number"
                    value={v}
                    min={min}
                    max={max}
                    step={step}
                    onChange={e => { const n = parseFloat(e.target.value); if (Number.isFinite(n)) onChange(n); }}
                    className="w-20 text-right text-xs font-mono px-2 py-1 outline-none focus:ring-2"
                    style={{ ...FIELD_STYLE, ['--tw-ring-color' as any]: 'rgba(216,165,183,0.22)' }}
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
    const [triggerText, setTriggerText] = useState((prompt.injection_trigger || []).join(', '));
    const markerHint = MARKER_HINTS[prompt.identifier]?.hint;

    const save = () => {
        const next: PresetPrompt = { ...prompt, name: name.trim() || prompt.identifier };
        if (!isMarker) {
            next.role = role as PresetPrompt['role'];
            next.content = content;
            next.injection_position = position;
            next.injection_depth = depth;
            next.injection_order = order;
            const triggers = triggerText
                .split(/[,\n]/)
                .map(item => item.trim())
                .filter(Boolean);
            if (triggers.length > 0) next.injection_trigger = Array.from(new Set(triggers));
            else delete next.injection_trigger;
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

            <div className="relative z-10 flex-1 overflow-y-auto no-scrollbar px-3 pt-6 pb-10 space-y-8">
                <Page title="基础信息" en="Name">
                    <Entry mark="KEY" title="唯一标识" note="identifier 会参与 prompt_order 和酒馆往返；这里只读，避免改名后顺序悬空。">
                        <input
                            value={prompt.identifier}
                            readOnly
                            className="w-full px-4 py-3 text-xs font-mono outline-none opacity-70"
                            style={FIELD_STYLE}
                        />
                    </Entry>
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
                            <div className="rounded-[14px] px-3 py-2.5 text-[11px] leading-relaxed" style={{ background: PRESS.soft, color: PRESS.ink, border: `1px solid ${LINE}` }}>
                                该条目属于内置 marker，不需要手动编辑正文。
                            </div>
                        </Entry>
                    </Page>
                ) : (
                    <>
                        <Page title="注入规则" en="Runtime">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[11px] font-bold mb-1.5 block" style={{ ...CUTE_STACK, color: INK }}>消息角色</label>
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
                                    <label className="text-[11px] font-bold mb-1.5 block" style={{ ...CUTE_STACK, color: INK }}>注入位置</label>
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
                                        <label className="text-[11px] font-bold mb-1.5 block" style={{ ...CUTE_STACK, color: INK }}>@Depth 深度</label>
                                        <input
                                            type="number" min={0} max={9999} value={depth}
                                            onChange={e => { const n = parseInt(e.target.value, 10); if (Number.isFinite(n)) setDepth(Math.max(0, n)); }}
                                            className="w-full px-3 py-3 text-xs font-mono outline-none"
                                            style={FIELD_STYLE}
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[11px] font-bold mb-1.5 block" style={{ ...CUTE_STACK, color: INK }}>同深度排序</label>
                                        <input
                                            type="number" min={0} max={9999} value={order}
                                            onChange={e => { const n = parseInt(e.target.value, 10); if (Number.isFinite(n)) setOrder(n); }}
                                            className="w-full px-3 py-3 text-xs font-mono outline-none"
                                            style={FIELD_STYLE}
                                        />
                                    </div>
                                </div>
                            )}

                            <div>
                                <label className="text-[11px] font-bold mb-1.5 block" style={{ ...CUTE_STACK, color: INK }}>触发类型 injection_trigger</label>
                                <input
                                    value={triggerText}
                                    onChange={e => setTriggerText(e.target.value)}
                                    placeholder="留空 = normal/全部；多个用逗号或换行分隔"
                                    className="w-full px-3 py-3 text-xs outline-none"
                                    style={FIELD_STYLE}
                                />
                                <p className="text-[10px] mt-1 leading-relaxed" style={{ color: INS_SOFT }}>
                                    保留 SillyTavern 原字段；Moro 运行时会按 generation type 过滤。
                                </p>
                            </div>
                        </Page>

                        <Page title="提示词内容" en="Content">
                            <div className="flex items-end justify-between mb-2">
                                <span className="text-[12.5px] font-bold" style={{ ...CUTE_STACK, color: INK }}>正文</span>
                                <span className="label-mono text-[8px]" style={{ color: INS_SOFT }}>≈ {estimateTokens(content)} tokens</span>
                            </div>
                            <textarea
                                value={content}
                                onChange={e => setContent(e.target.value)}
                                placeholder="支持 {{char}} / {{user}} / {{date}} / {{time}} 等宏"
                                className="w-full h-72 px-4 py-3 text-xs leading-6 resize-none outline-none placeholder:text-[#cfb8c4]"
                                style={{ ...FIELD_STYLE, ...RULED_BG, boxShadow: '0 8px 18px -16px rgba(38,52,71,0.24)' }}
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
    const { closeApp, addToast, apiPresets, apiConfig, updateApiConfig, characters, activeCharacterId, groups, userProfile, realtimeConfig } = useOS();
    const [presets, setPresets] = useState<TavernPreset[]>([]);
    const [activeId, setActiveId] = useState<string | null>(PresetRuntime.getActiveId());
    const [enabled, setEnabled] = useState(PresetRuntime.isEnabled());
    const [applySampling, setApplySampling] = useState(PresetRuntime.isSamplingApplied());
    const [globalScopes, setGlobalScopes] = useState<Record<PresetScopeKey, boolean>>(() => PresetRuntime.getGlobalScopes());
    const [loaded, setLoaded] = useState(false);
    const [showParams, setShowParams] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [showInsert, setShowInsert] = useState(false);
    const [presetSearch, setPresetSearch] = useState('');
    const [pinnedPresetIds, setPinnedPresetIds] = useState<string[]>(() => readPinnedPresetIds());
    const [activeScope, setActiveScope] = useState<PresetScopeKey>('chat.private');
    const [selectedPromptIds, setSelectedPromptIds] = useState<string[]>([]);
    const [batchRole, setBatchRole] = useState<PresetPrompt['role']>('system');
    const [batchTrigger, setBatchTrigger] = useState('');
    const [snapshotId, setSnapshotId] = useState('');
    const [previewTargetId, setPreviewTargetId] = useState('');
    const [previewInput, setPreviewInput] = useState('你好，帮我确认现在会怎么组装上下文。');
    const [previewBusy, setPreviewBusy] = useState(false);
    const [previewError, setPreviewError] = useState('');
    const [previewMessages, setPreviewMessages] = useState<Array<{ role: string; content: any }> | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // 拖拽排序状态
    const [dragIdx, setDragIdx] = useState<number | null>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const rowRefs = useRef<Array<HTMLDivElement | null>>([]);

    const active = useMemo(() => presets.find(p => p.id === activeId) || null, [presets, activeId]);

    useEffect(() => {
        setSelectedPromptIds([]);
        setPreviewMessages(null);
        setPreviewError('');
    }, [activeId, activeScope]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                await ensureDefaultPresetSeed();
                const list = await DB.getAllPresets();
                if (cancelled) return;
                list.sort((a, b) => a.createdAt - b.createdAt);
                setPresets(list);
                const storedId = PresetRuntime.getActiveId();
                if (list.length > 0 && !list.some(p => p.id === storedId)) {
                    setActiveId(list[0].id);
                    PresetRuntime.setActiveId(list[0].id);
                } else {
                    setActiveId(storedId);
                }
                setEnabled(PresetRuntime.isEnabled());
                setApplySampling(PresetRuntime.isSamplingApplied());
                setGlobalScopes(PresetRuntime.getGlobalScopes());
            } catch (e: any) {
                if (!cancelled) addToast(`预设列表读取失败: ${e?.message || e}`, 'error');
            } finally {
                if (!cancelled) setLoaded(true);
            }
        })();
        return () => { cancelled = true; };
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
        copy.id = createPresetLocalId('preset');
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
        setPinnedPresetIds(prev => {
            const next = prev.filter(pinId => pinId !== id);
            if (next.length !== prev.length) savePinnedPresetIds(next);
            return next;
        });
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
            preset.moroSnapshots = [createPresetSnapshot(preset, '导入初始快照', '导入 JSON')];
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

    const activeScopes = useMemo(() => normalizePresetScopes(active?.moroScopes), [active?.moroScopes]);

    const toggleGlobalScope = (scope: PresetScopeKey, on: boolean) => {
        const next = { ...globalScopes, [scope]: on };
        setGlobalScopes(next);
        PresetRuntime.setGlobalScopes(next);
    };

    const togglePresetScope = (scope: PresetScopeKey, on: boolean) => {
        mutateActive(d => {
            d.moroScopes = { ...normalizePresetScopes(d.moroScopes), [scope]: on };
        });
    };

    // ── 提示词顺序 ──────────────────────────────────────
    const orderSource = useMemo(() => active ? getPresetOrderSource(active, activeScope) : null, [active, activeScope]);

    const orderEntries: PresetPromptOrderEntry[] = useMemo(() => {
        if (!active) return [];
        return getPresetOrderForScope(active, activeScope);
    }, [active, activeScope]);

    const promptById = useMemo(() => new Map((active?.prompts ?? []).map(p => [p.identifier, p])), [active]);

    const mutateOrder = (fn: (order: PresetPromptOrderEntry[]) => void) => {
        mutateActive(d => {
            fn(getEditablePresetOrderForScope(d, activeScope));
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
        const identifier = createPresetLocalId('prompt');
        mutateActive(d => {
            d.prompts.push({ identifier, name: '新提示词', role: 'system', content: '', system_prompt: false });
            getEditablePresetOrderForScope(d, activeScope).push({ identifier, enabled: true });
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
            for (const key of PRESET_SCOPE_KEYS) {
                const order = d.moroPromptOrdersByScope?.[key];
                if (order) d.moroPromptOrdersByScope![key] = order.filter(e => e.identifier !== identifier);
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
                    const order = getEditablePresetOrderForScope(copy, activeScope);
                    const [moved] = order.splice(from, 1);
                    if (moved) {
                        order.splice(to, 0, moved);
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
    const pinnedPresetSet = useMemo(() => new Set(pinnedPresetIds), [pinnedPresetIds]);
    const sortedPresets = useMemo(() => {
        return [...presets].sort((a, b) => {
            const pinnedDelta = Number(pinnedPresetSet.has(b.id)) - Number(pinnedPresetSet.has(a.id));
            if (pinnedDelta !== 0) return pinnedDelta;
            return a.createdAt - b.createdAt;
        });
    }, [presets, pinnedPresetSet]);
    const filteredPresets = useMemo(() => {
        const q = presetSearch.trim().toLowerCase();
        if (!q) return sortedPresets;
        return sortedPresets.filter(p => p.name.toLowerCase().includes(q));
    }, [presetSearch, sortedPresets]);
    const activePinned = !!activeId && pinnedPresetSet.has(activeId);
    const selectOptions = useMemo(() => {
        if (!active || filteredPresets.some(p => p.id === active.id)) return filteredPresets;
        return [active, ...filteredPresets];
    }, [active, filteredPresets]);
    const togglePinnedPreset = () => {
        if (!activeId) return;
        setPinnedPresetIds(prev => {
            const next = prev.includes(activeId) ? prev.filter(id => id !== activeId) : [activeId, ...prev];
            savePinnedPresetIds(next);
            return next;
        });
    };
    const apiHost = useMemo(() => {
        if (!apiConfig.baseUrl) return '';
        try { return new URL(apiConfig.baseUrl).host; } catch { return apiConfig.baseUrl; }
    }, [apiConfig.baseUrl]);
    const selectedPromptSet = useMemo(() => new Set(selectedPromptIds), [selectedPromptIds]);
    const diagnostics = useMemo(() => active ? diagnosePreset(active, activeScope) : [], [active, activeScope]);
    const currentSnapshot = useMemo(
        () => active?.moroSnapshots?.find(s => s.id === snapshotId) || active?.moroSnapshots?.[0] || null,
        [active, snapshotId],
    );
    const snapshotDiff = useMemo(
        () => active && currentSnapshot ? diffPresetSnapshot(currentSnapshot, active) : null,
        [active, currentSnapshot],
    );
    const previewTargets = useMemo(() => {
        if (activeScope === 'chat.groupText' || activeScope === 'chat.groupVoice') {
            return groups.map(g => ({ id: g.id, name: g.name || '未命名群聊' }));
        }
        return characters.map(c => ({ id: c.id, name: c.name || '未命名角色' }));
    }, [activeScope, characters, groups]);

    const addSnapshotToDraft = (draft: TavernPreset, name: string, reason: string) => {
        const snap = createPresetSnapshot(draft, name, reason);
        draft.moroSnapshots = [snap, ...(draft.moroSnapshots || [])].slice(0, 24);
        return snap;
    };

    const handleCreateScopeOrder = () => {
        if (!active) return;
        mutateActive(d => {
            addSnapshotToDraft(d, `复制 ${PRESET_SCOPE_META[activeScope].title} 顺序前`, '创建 scope 专用顺序');
            setPresetScopeOrder(d, activeScope, getPresetOrderForScope(d, activeScope));
        });
        addToast('已复制为当前 scope 专用顺序', 'success');
    };

    const handleResetScopeOrder = () => {
        if (!active) return;
        if (!window.confirm(`重置「${PRESET_SCOPE_META[activeScope].title}」的专用顺序，改为继承默认？`)) return;
        mutateActive(d => {
            addSnapshotToDraft(d, `重置 ${PRESET_SCOPE_META[activeScope].title} 顺序前`, '重置 scope 专用顺序');
            setPresetScopeOrder(d, activeScope, null);
        });
        setSelectedPromptIds([]);
        addToast('已重置为继承默认顺序', 'success');
    };

    const togglePromptSelected = (identifier: string) => {
        setSelectedPromptIds(prev => prev.includes(identifier) ? prev.filter(id => id !== identifier) : [...prev, identifier]);
    };

    const batchMutate = (label: string, fn: (draft: TavernPreset) => void) => {
        if (!active || selectedPromptIds.length === 0) return;
        mutateActive(d => {
            addSnapshotToDraft(d, `${label}前`, label);
            fn(d);
        });
        addToast(`已执行：${label}`, 'success');
    };

    const batchSetEnabled = (on: boolean) => batchMutate(on ? '批量启用提示词' : '批量停用提示词', d => {
        const order = getEditablePresetOrderForScope(d, activeScope);
        for (const entry of order) if (selectedPromptSet.has(entry.identifier)) entry.enabled = on;
    });

    const batchMove = (where: 'top' | 'bottom') => batchMutate(where === 'top' ? '批量移到顶部' : '批量移到底部', d => {
        const order = getEditablePresetOrderForScope(d, activeScope);
        const moving = order.filter(e => selectedPromptSet.has(e.identifier));
        const rest = order.filter(e => !selectedPromptSet.has(e.identifier));
        order.splice(0, order.length, ...(where === 'top' ? [...moving, ...rest] : [...rest, ...moving]));
    });

    const batchSetRole = () => batchMutate('批量设置 role', d => {
        for (const prompt of d.prompts) {
            if (selectedPromptSet.has(prompt.identifier) && !prompt.marker) prompt.role = batchRole;
        }
    });

    const batchSetTriggers = () => batchMutate('批量设置 trigger', d => {
        const triggers = batchTrigger.split(/[,\n]/).map(x => x.trim()).filter(Boolean);
        for (const prompt of d.prompts) {
            if (!selectedPromptSet.has(prompt.identifier) || prompt.marker) continue;
            if (triggers.length > 0) prompt.injection_trigger = Array.from(new Set(triggers));
            else delete prompt.injection_trigger;
        }
    });

    const batchDetach = () => batchMutate('批量从当前顺序移除', d => {
        const order = getEditablePresetOrderForScope(d, activeScope);
        const removable = new Set(selectedPromptIds.filter(id => !CORE_CONTEXT_MARKERS.has(id) && id !== CHAT_HISTORY_MARKER));
        const next = order.filter(e => !removable.has(e.identifier));
        order.splice(0, order.length, ...next);
    });

    const batchDeletePrompts = () => {
        if (!active || selectedPromptIds.length === 0) return;
        const deletable = new Set(active.prompts
            .filter(p => selectedPromptSet.has(p.identifier) && !p.system_prompt && !p.marker)
            .map(p => p.identifier));
        if (deletable.size === 0) {
            addToast('选中的条目里没有可删除的用户提示词', 'info');
            return;
        }
        if (!window.confirm(`彻底删除 ${deletable.size} 条用户提示词？`)) return;
        batchMutate('批量删除用户提示词', d => {
            d.prompts = d.prompts.filter(p => !deletable.has(p.identifier));
            for (const po of d.prompt_order) po.order = po.order.filter(e => !deletable.has(e.identifier));
            for (const key of PRESET_SCOPE_KEYS) {
                const order = d.moroPromptOrdersByScope?.[key];
                if (order) d.moroPromptOrdersByScope![key] = order.filter(e => !deletable.has(e.identifier));
            }
        });
        setSelectedPromptIds([]);
    };

    const handleApplySafeFixes = () => {
        if (!active) return;
        const result = applySafePresetFixes(active, activeScope);
        if (result.fixed.length === 0) {
            addToast('没有需要自动修复的问题', 'info');
            return;
        }
        result.preset.moroSnapshots = [
            createPresetSnapshot(active, '自动修复前', '诊断安全修复'),
            ...(active.moroSnapshots || []),
        ].slice(0, 24);
        persistPreset(result.preset);
        addToast(`已修复 ${result.fixed.length} 项`, 'success');
    };

    const handleManualSnapshot = () => {
        if (!active) return;
        mutateActive(d => {
            addSnapshotToDraft(d, '手动快照', '用户手动创建');
        });
        addToast('已创建快照', 'success');
    };

    const handleRestoreSnapshot = () => {
        if (!currentSnapshot) return;
        const restored = restorePresetSnapshotAsCopy(currentSnapshot);
        setPresets(prev => [...prev, restored]);
        DB.savePreset(restored).catch(() => addToast('快照恢复保存失败', 'error'));
        selectPreset(restored.id);
        addToast('已从快照恢复为新预设副本', 'success');
    };

    const handleRunPreview = async () => {
        if (!active) return;
        setPreviewBusy(true);
        setPreviewError('');
        setPreviewMessages(null);
        try {
            const isGroupScope = activeScope === 'chat.groupText' || activeScope === 'chat.groupVoice';
            if (isGroupScope) {
                const group = groups.find(g => g.id === previewTargetId) || groups[0];
                const preset = await PresetRuntime.getActivePresetForScope(activeScope);
                const baseMessages = [{ role: 'system', content: `[群聊预览]\n群名：${group?.name || '群聊'}\n任务：${previewInput || '请根据当前群聊生成回复。'}` }];
                const messages = preset
                    ? applyPresetToMessages(baseMessages, preset, {
                        presetScope: activeScope,
                        orderCharacterId: ORDER_CHAR_ID_GROUP,
                        macros: { charName: group?.name || '群聊', userName: userProfile.name || '用户' },
                        tailMessages: [{ role: 'system', content: '只输出本轮群聊所需内容；若任务要求 JSON，保持可解析格式。' }],
                    })
                    : baseMessages;
                setPreviewMessages(messages);
                return;
            }
            const char = characters.find(c => c.id === previewTargetId) || characters.find(c => c.id === activeCharacterId) || characters[0];
            if (!char) throw new Error('没有可用于预览的角色');
            const [emojis, categories, history] = await Promise.all([
                DB.getEmojis(),
                DB.getEmojiCategories(),
                DB.getRecentMessagesByCharId(char.id, Math.max(20, Math.min(char.contextLimit || 80, 120))).catch(() => [] as Message[]),
            ]);
            const input = previewInput.trim();
            const previewHistory: Message[] = input
                ? [...history, { id: -Date.now(), charId: char.id, role: 'user', type: 'text', content: input, timestamp: Date.now() }]
                : history;
            const payload = await buildChatRequestPayload({
                char,
                userProfile,
                groups,
                emojis,
                categories,
                historyMsgs: previewHistory,
                contextLimit: Math.max(20, Math.min(char.contextLimit || 80, 120)),
                realtimeConfig,
                presetScope: activeScope,
                previewMode: true,
            });
            setPreviewMessages(payload.fullMessages);
        } catch (e: any) {
            setPreviewError(e?.message || String(e));
        } finally {
            setPreviewBusy(false);
        }
    };

    // ── 渲染 ────────────────────────────────────────────
    return (
        <div className="absolute inset-0 flex flex-col overflow-hidden animate-fade-in" style={{ background: CANVAS_BG, color: INK }}>
            <input type="file" ref={fileInputRef} className="hidden" accept=".json,application/json" onChange={handleImportFile} />
            <PanelHeader
                title="活字盘"
                en="PRESETS"
                sub={loaded ? `当前预设：${active?.name || '未选择'} · 自动保存` : '正在读取预设'}
                onBack={closeApp}
                status="已保存"
            />

            <div className="relative z-10 flex-1 overflow-y-auto no-scrollbar px-3 pt-6 pb-12 space-y-8">
                <HeroPlate
                    activeName={loaded ? active?.name || '未选择预设' : '正在读取预设'}
                    enabled={enabled}
                    presetCount={presets.length}
                    enabledEntries={enabledEntriesCount}
                    totalEntries={orderEntries.length}
                    totalTokens={totalTokens}
                    markerEntries={markerEntriesCount}
                    onToggle={toggleEnabled}
                />

                <Page title="预设管理" en="Library" anchor="manual-presets-library">
                    <Entry mark="FILE" title="预设文件" note="新建、导入或复制后会自动选中；修改会保存到本地。">

                    {loaded && presets.length === 0 ? (
                        <div className="py-2 space-y-3 text-center">
                            <div className="text-[13px] font-bold" style={{ ...CUTE_STACK, color: INK }}>暂无预设</div>
                            <div className="grid grid-cols-2 gap-2">
                                <PressButton onClick={handleNewPreset} className="py-2.5" icon={<PenNib size={14} weight="bold" />}>新建默认预设</PressButton>
                                <PressButton onClick={() => fileInputRef.current?.click()} tone="plain" className="py-2.5" icon={<TrayArrowDown size={14} weight="bold" />}>导入 JSON</PressButton>
                            </div>
                        </div>
                    ) : (
                        <>
                            <div className="space-y-2">
                                <div className="relative">
                                    <MagnifyingGlass
                                        size={15}
                                        weight="bold"
                                        className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                                        style={{ color: INS_SOFT }}
                                    />
                                    <input
                                        value={presetSearch}
                                        onChange={e => setPresetSearch(e.target.value)}
                                        placeholder="搜索预设名称"
                                        className="w-full pl-9 pr-9 py-3 text-[12px] font-bold outline-none"
                                        style={FIELD_STYLE}
                                    />
                                    {presetSearch && (
                                        <button
                                            onClick={() => setPresetSearch('')}
                                            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 active:scale-90 transition-transform"
                                            style={{ color: INS_SOFT }}
                                            aria-label="清空搜索"
                                            title="清空搜索"
                                        >
                                            <XCircle size={15} weight="bold" />
                                        </button>
                                    )}
                                </div>
                                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                                    <div className="relative min-w-0">
                                        <select
                                            value={activeId ?? ''}
                                            onChange={e => selectPreset(e.target.value)}
                                            className="w-full appearance-none px-4 py-3 pr-9 text-sm font-extrabold outline-none"
                                            style={FIELD_STYLE}
                                        >
                                            {selectOptions.map(p => (
                                                <option key={p.id} value={p.id}>
                                                    {pinnedPresetSet.has(p.id) ? '置顶 · ' : ''}{p.name}
                                                </option>
                                            ))}
                                        </select>
                                        <CaretDown
                                            aria-hidden
                                            size={14}
                                            weight="bold"
                                            className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none"
                                            style={{ color: INS_SOFT }}
                                        />
                                    </div>
                                    <button
                                        onClick={togglePinnedPreset}
                                        disabled={!active}
                                        className="w-12 rounded-[14px] flex items-center justify-center active:scale-95 transition-transform disabled:opacity-40"
                                        style={{
                                            background: activePinned ? COPPER_TONE.soft : PAPER,
                                            color: activePinned ? COPPER_TONE.ink : INS_SOFT,
                                            border: `1px solid ${activePinned ? `${COPPER_TONE.solid}55` : LINE}`,
                                            boxShadow: activePinned ? `0 8px 18px -16px ${COPPER_TONE.solid}` : '0 8px 18px -16px rgba(38,52,71,0.24)',
                                        }}
                                        aria-label={activePinned ? '取消置顶当前预设' : '置顶当前预设'}
                                        title={activePinned ? '取消置顶当前预设' : '置顶当前预设'}
                                    >
                                        <PushPinSimple size={17} weight={activePinned ? 'fill' : 'bold'} />
                                    </button>
                                </div>
                                {presetSearch && filteredPresets.length === 0 && (
                                    <div className="text-[10px] px-1" style={{ color: INS_SOFT }}>
                                        没找到匹配项，当前预设仍保留在下拉框里。
                                    </div>
                                )}
                            </div>
                            <div className="grid grid-cols-3 gap-2 mt-3">
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
                        <Page title="连接与参数" en="API & Params" anchor="manual-presets-root">
                            <Entry mark="API" title="API 方案" note="绑定后，切换到这个预设时会同步套用对应的连接配置。" side={<LinkSimple size={18} weight="bold" style={{ color: PRESS.solid }} />}>
                                <div className="rounded-[14px] px-3 py-2.5 text-[11px] font-mono mb-2.5" style={{ background: PRESS.soft, color: PRESS.ink, border: `1px solid ${LINE}`, boxShadow: '0 8px 18px -16px rgba(38,52,71,0.24)' }}>
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
                                                <p className="text-[11px] font-bold" style={{ ...CUTE_STACK, color: COPPER_TONE.ink }}>采样参数随请求下发</p>
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
                                                <label className="text-[11px] font-bold mb-1 block" style={{ ...CUTE_STACK, color: INK }}>上下文 tokens</label>
                                                <input
                                                    type="number"
                                                    value={active.openai_max_context ?? 4095}
                                                    onChange={e => { const n = parseInt(e.target.value, 10); if (Number.isFinite(n)) mutateActive(d => { d.openai_max_context = n; }); }}
                                                    className="w-full px-3 py-2 text-xs font-mono outline-none"
                                                    style={FIELD_STYLE}
                                                />
                                            </div>
                                            <div>
                                                <label className="text-[11px] font-bold mb-1 block" style={{ ...CUTE_STACK, color: INK }}>回复 tokens</label>
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

                        <Page title="作用范围" en="Scopes" anchor="manual-presets-scopes">
                            <Entry mark="RUN" title="任务联动" note="最终生效需要“全局允许”和“本预设启用”同时打开；结构化任务默认保护，避免 JSON / 总结被聊天预设带偏。">
                                <div className="space-y-2">
                                    {PRESET_SCOPE_KEYS.map(scope => {
                                        const meta = PRESET_SCOPE_META[scope];
                                        const effective = !!globalScopes[scope] && !!activeScopes[scope];
                                        return (
                                            <div
                                                key={scope}
                                                className="rounded-[14px] px-3 py-3"
                                                style={{
                                                    background: effective ? ACTIVE_TONE.soft : (meta.risky ? WARN_TONE.soft : PAPER),
                                                    border: `1px solid ${effective ? `${ACTIVE_TONE.solid}44` : (meta.risky ? `${WARN_TONE.solid}34` : LINE)}`,
                                                    boxShadow: '0 8px 18px -16px rgba(38,52,71,0.24)',
                                                }}
                                            >
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="min-w-0">
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-[12px] font-bold" style={{ ...CUTE_STACK, color: meta.risky ? WARN_TONE.ink : INK }}>{meta.title}</span>
                                                            <span className="label-mono text-[8px]" style={{ color: effective ? ACTIVE_TONE.ink : INS_SOFT }}>{effective ? '生效' : '未生效'}</span>
                                                            {meta.risky && <span className="label-mono text-[8px]" style={{ color: WARN_TONE.ink }}>谨慎</span>}
                                                        </div>
                                                        <p className="text-[10px] leading-relaxed mt-1" style={{ color: INS_SOFT }}>{meta.note}</p>
                                                    </div>
                                                    <div className="grid grid-cols-2 gap-2 shrink-0">
                                                        <div className="flex flex-col items-center gap-1">
                                                            <span className="text-[8px] font-bold" style={{ ...MONO_STACK, color: INS_SOFT }}>全局</span>
                                                            <InkSwitch small on={!!globalScopes[scope]} onChange={v => toggleGlobalScope(scope, v)} />
                                                        </div>
                                                        <div className="flex flex-col items-center gap-1">
                                                            <span className="text-[8px] font-bold" style={{ ...MONO_STACK, color: INS_SOFT }}>本预设</span>
                                                            <InkSwitch small on={!!activeScopes[scope]} onChange={v => togglePresetScope(scope, v)} />
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </Entry>
                        </Page>

                        <Page title="提示词顺序" en="Order" anchor="manual-presets-prompts">
                            <Entry mark="ORDER" title="发送顺序" note="拖动左侧图标调整顺序；关闭条目后，该条不会写入聊天请求。" side={<PressChip tone="plain">≈ {totalTokens} tokens</PressChip>}>
                                <div className="space-y-2 mb-3">
                                    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                                        <div className="relative min-w-0">
                                            <select
                                                value={activeScope}
                                                onChange={e => setActiveScope(e.target.value as PresetScopeKey)}
                                                className="w-full appearance-none px-4 py-3 pr-9 text-xs font-bold outline-none"
                                                style={FIELD_STYLE}
                                            >
                                                {PRESET_SCOPE_KEYS.map(scope => (
                                                    <option key={scope} value={scope}>{PRESET_SCOPE_META[scope].title} · {scope}</option>
                                                ))}
                                            </select>
                                            <CaretDown
                                                aria-hidden
                                                size={14}
                                                weight="bold"
                                                className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none"
                                                style={{ color: INS_SOFT }}
                                            />
                                        </div>
                                        <PressChip active={!orderSource?.inherited} tone={orderSource?.inherited ? 'plain' : 'active'}>
                                            {orderSource?.inherited ? `继承 ${orderSource.characterId}` : 'scope 专用'}
                                        </PressChip>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                        <PressButton
                                            onClick={handleCreateScopeOrder}
                                            disabled={!orderSource?.inherited}
                                            tone="copper"
                                            className="py-2"
                                            icon={<StackPlus size={14} weight="bold" />}
                                        >
                                            复制为本 scope 专用
                                        </PressButton>
                                        <PressButton
                                            onClick={handleResetScopeOrder}
                                            disabled={!!orderSource?.inherited}
                                            tone="plain"
                                            className="py-2"
                                            icon={<Eject size={14} weight="bold" />}
                                        >
                                            重置继承默认
                                        </PressButton>
                                    </div>
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
                                                className={`relative overflow-hidden flex items-center gap-2 rounded-[14px] px-2.5 py-2.5 transition-all ${entry.enabled ? '' : 'opacity-50'}`}
                                                style={{
                                                    background: dragIdx === idx ? PRESS.soft : PAPER,
                                                    border: dragIdx === idx ? `1px solid ${PRESS.solid}` : `1px solid ${LINE}`,
                                                    boxShadow: dragIdx === idx ? '0 14px 30px -18px rgba(79,157,195,0.52)' : '0 8px 18px -16px rgba(38,52,71,0.24)',
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
                                                <button
                                                    onClick={() => togglePromptSelected(entry.identifier)}
                                                    className="w-6 h-6 rounded-full shrink-0 flex items-center justify-center active:scale-90 transition-transform"
                                                    style={{
                                                        background: selectedPromptSet.has(entry.identifier) ? ACTIVE_TONE.soft : '#fff',
                                                        border: `1px solid ${selectedPromptSet.has(entry.identifier) ? `${ACTIVE_TONE.solid}66` : LINE}`,
                                                        color: selectedPromptSet.has(entry.identifier) ? ACTIVE_TONE.ink : INS_SOFT,
                                                    }}
                                                    aria-label="选择提示词"
                                                    title="选择提示词"
                                                >
                                                    <span className="text-[11px] font-black">{selectedPromptSet.has(entry.identifier) ? '✓' : ''}</span>
                                                </button>
                                                <button onClick={() => setEditingId(entry.identifier)} className="flex-1 min-w-0 text-left">
                                                    <div className="flex items-center gap-1.5">
                                                        {isMarker && <Placeholder size={13} weight="bold" className="shrink-0" style={{ color: PRESS.solid }} />}
                                                        {isAbsolute && <ArrowElbowDownRight size={13} weight="bold" className="shrink-0" style={{ color: PRESS.solid }} />}
                                                        <span className={`text-sm font-bold truncate ${entry.enabled ? '' : 'line-through decoration-2'}`} style={{ ...CUTE_STACK, color: INK }}>{prompt.name}</span>
                                                        {isAbsolute && <span className="label-mono text-[8px] shrink-0" style={{ color: INS_SOFT }}>@{prompt.injection_depth ?? 4}</span>}
                                                        {prompt.injection_trigger?.length ? <span className="label-mono text-[8px] shrink-0" style={{ color: COPPER_TONE.ink }}>trigger</span> : null}
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

                            <Entry mark="BATCH" title={`批量编辑（已选 ${selectedPromptIds.length} 条）`} note="批量操作会先留快照；移除只影响当前 scope 顺序，删除只允许用户自建提示词。">
                                <div className="grid grid-cols-2 gap-2">
                                    <PressButton disabled={selectedPromptIds.length === 0} onClick={() => batchSetEnabled(true)} className="py-2" tone="active">启用</PressButton>
                                    <PressButton disabled={selectedPromptIds.length === 0} onClick={() => batchSetEnabled(false)} className="py-2" tone="plain">停用</PressButton>
                                    <PressButton disabled={selectedPromptIds.length === 0} onClick={() => batchMove('top')} className="py-2" tone="plain">移到顶部</PressButton>
                                    <PressButton disabled={selectedPromptIds.length === 0} onClick={() => batchMove('bottom')} className="py-2" tone="plain">移到底部</PressButton>
                                </div>
                                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 mt-2">
                                    <select
                                        value={batchRole}
                                        onChange={e => setBatchRole(e.target.value as PresetPrompt['role'])}
                                        className="px-3 py-2 text-xs font-bold outline-none"
                                        style={FIELD_STYLE}
                                    >
                                        <option value="system">system</option>
                                        <option value="user">user</option>
                                        <option value="assistant">assistant</option>
                                    </select>
                                    <PressButton disabled={selectedPromptIds.length === 0} onClick={batchSetRole} className="px-3" tone="copper">设 role</PressButton>
                                </div>
                                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 mt-2">
                                    <input
                                        value={batchTrigger}
                                        onChange={e => setBatchTrigger(e.target.value)}
                                        placeholder="trigger：留空=清除，多个用逗号"
                                        className="px-3 py-2 text-xs outline-none"
                                        style={FIELD_STYLE}
                                    />
                                    <PressButton disabled={selectedPromptIds.length === 0} onClick={batchSetTriggers} className="px-3" tone="copper">设 trigger</PressButton>
                                </div>
                                <div className="grid grid-cols-3 gap-2 mt-2">
                                    <PressButton disabled={selectedPromptIds.length === 0} onClick={batchDetach} className="py-2" tone="plain">从本顺序移除</PressButton>
                                    <PressButton disabled={selectedPromptIds.length === 0} onClick={batchDeletePrompts} className="py-2" tone="danger">删除用户词</PressButton>
                                    <PressButton disabled={selectedPromptIds.length === 0} onClick={() => setSelectedPromptIds([])} className="py-2" tone="plain">清空选择</PressButton>
                                </div>
                            </Entry>
                        </Page>

                        <Page title="诊断与修复" en="Doctor">
                            <Entry mark="CHECK" title="当前 scope 结构检查" note="自动修复只处理低风险项目：补回 marker、去重、关闭空提示词、补齐悬空定义。">
                                <div className="space-y-2">
                                    {diagnostics.length === 0 ? (
                                        <div className="rounded-[14px] px-3 py-3 text-[12px]" style={{ background: ACTIVE_TONE.soft, color: ACTIVE_TONE.ink, border: `1px solid ${ACTIVE_TONE.solid}35` }}>
                                            当前 scope 没有发现明显结构问题。
                                        </div>
                                    ) : diagnostics.map((issue, idx) => (
                                        <div key={`${issue.code}-${issue.identifier || issue.scope || idx}`} className="rounded-[14px] px-3 py-2.5" style={{ background: issue.severity === 'error' ? WARN_TONE.soft : PAPER, border: `1px solid ${issue.severity === 'error' ? `${WARN_TONE.solid}40` : LINE}` }}>
                                            <div className="flex items-center gap-2">
                                                <span className="text-[11px] font-bold" style={{ ...CUTE_STACK, color: issue.severity === 'error' ? WARN_TONE.ink : INK }}>{issue.title}</span>
                                                <span className="label-mono text-[8px]" style={{ color: issue.fixable ? ACTIVE_TONE.ink : INS_SOFT }}>{issue.fixable ? '可修复' : '提示'}</span>
                                            </div>
                                            <p className="text-[10px] mt-1 leading-relaxed" style={{ color: INS_SOFT }}>{issue.detail}</p>
                                        </div>
                                    ))}
                                </div>
                                <PressButton disabled={!diagnostics.some(issue => issue.fixable)} onClick={handleApplySafeFixes} className="mt-3 py-2.5 w-full" tone="active" icon={<Stamp size={14} weight="bold" />}>安全修复可修复项</PressButton>
                            </Entry>
                        </Page>

                        <Page title="快照与对比" en="Snapshots">
                            <Entry mark="SAVE" title="编辑快照" note="快照只存在本机预设里；恢复时会创建新预设副本，不覆盖当前预设。">
                                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                                    <select
                                        value={currentSnapshot?.id || ''}
                                        onChange={e => setSnapshotId(e.target.value)}
                                        className="px-3 py-2 text-xs font-bold outline-none"
                                        style={FIELD_STYLE}
                                    >
                                        {(active.moroSnapshots || []).map(s => (
                                            <option key={s.id} value={s.id}>{s.name}</option>
                                        ))}
                                    </select>
                                    <PressButton onClick={handleManualSnapshot} className="px-3" tone="copper" icon={<Stamp size={14} weight="bold" />}>留快照</PressButton>
                                </div>
                                {currentSnapshot ? (
                                    <div className="mt-3 space-y-2">
                                        <div className="text-[10px]" style={{ color: INS_SOFT }}>
                                            {new Date(currentSnapshot.createdAt).toLocaleString('zh-CN')} · {currentSnapshot.reason || '无备注'}
                                        </div>
                                        <div className="rounded-[14px] px-3 py-2.5 max-h-40 overflow-y-auto no-scrollbar" style={{ background: PAPER, border: `1px solid ${LINE}` }}>
                                            {snapshotDiff?.changed ? snapshotDiff.items.slice(0, 12).map((item, idx) => (
                                                <div key={idx} className="text-[10px] leading-relaxed" style={{ color: INK }}>· {item}</div>
                                            )) : <div className="text-[10px]" style={{ color: INS_SOFT }}>当前预设与该快照没有可见差异。</div>}
                                        </div>
                                        <PressButton onClick={handleRestoreSnapshot} className="py-2.5 w-full" tone="active">恢复为新预设副本</PressButton>
                                    </div>
                                ) : (
                                    <div className="mt-3 text-[11px]" style={{ color: INS_SOFT }}>还没有快照。执行批量操作、重置 scope 顺序或手动留快照后会显示在这里。</div>
                                )}
                            </Entry>
                        </Page>

                        <Page title="完整预览" en="Preview">
                            <Entry mark="RUN" title="不发 API 的消息预览" note="预览会读取本地角色、群聊、世界书和最近聊天，但不会调用模型，也不会写入新消息。">
                                <div className="grid grid-cols-2 gap-2">
                                    <select
                                        value={activeScope}
                                        onChange={e => setActiveScope(e.target.value as PresetScopeKey)}
                                        className="px-3 py-2 text-xs font-bold outline-none"
                                        style={FIELD_STYLE}
                                    >
                                        {PRESET_SCOPE_KEYS.map(scope => <option key={scope} value={scope}>{PRESET_SCOPE_META[scope].title}</option>)}
                                    </select>
                                    <select
                                        value={previewTargetId}
                                        onChange={e => setPreviewTargetId(e.target.value)}
                                        className="px-3 py-2 text-xs font-bold outline-none"
                                        style={FIELD_STYLE}
                                    >
                                        <option value="">自动选择</option>
                                        {previewTargets.map(target => <option key={target.id} value={target.id}>{target.name}</option>)}
                                    </select>
                                </div>
                                <textarea
                                    value={previewInput}
                                    onChange={e => setPreviewInput(e.target.value)}
                                    className="w-full h-24 mt-2 px-3 py-2 text-xs leading-5 resize-none outline-none"
                                    style={{ ...FIELD_STYLE, ...RULED_BG }}
                                    placeholder="追加一条预览用用户输入"
                                />
                                <PressButton onClick={handleRunPreview} disabled={previewBusy} className="mt-2 py-2.5 w-full" tone="active" icon={<MagnifyingGlass size={14} weight="bold" />}>{previewBusy ? '生成中' : '生成预览'}</PressButton>
                                {previewError && <div className="mt-2 rounded-[14px] px-3 py-2 text-[11px]" style={{ background: WARN_TONE.soft, color: WARN_TONE.ink, border: `1px solid ${WARN_TONE.solid}35` }}>{previewError}</div>}
                                {previewMessages && (
                                    <div className="mt-3 space-y-2 max-h-[55vh] overflow-y-auto no-scrollbar">
                                        {previewMessages.map((msg, idx) => {
                                            const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
                                            return (
                                                <div key={idx} className="rounded-[14px] px-3 py-2.5" style={{ background: PAPER, border: `1px solid ${LINE}` }}>
                                                    <div className="flex items-center justify-between gap-2">
                                                        <VoiceStamp role={msg.role} />
                                                        <span className="label-mono text-[8px]" style={{ color: INS_SOFT }}>#{idx + 1} · ≈ {estimateTokens(text)} tokens</span>
                                                    </div>
                                                    <pre className="mt-2 whitespace-pre-wrap break-words text-[10px] leading-relaxed max-h-44 overflow-y-auto no-scrollbar" style={{ color: INK }}>{text}</pre>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
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
                            style={{ background: PAPER, border: `1px solid ${LINE}`, color: INK, boxShadow: '0 8px 18px -16px rgba(38,52,71,0.24)' }}
                        >
                            {p.marker ? <Placeholder size={14} weight="bold" className="shrink-0" style={{ color: PRESS.solid }} /> : <FileText size={14} weight="bold" className="shrink-0" style={{ color: PRESS.solid }} />}
                            <span className="text-sm font-extrabold truncate flex-1" style={CUTE_STACK}>{p.name}</span>
                            <VoiceStamp role={p.role} />
                        </button>
                    ))}
                </div>
            </InsSheet>
        </div>
    );
};

export default PresetApp;
