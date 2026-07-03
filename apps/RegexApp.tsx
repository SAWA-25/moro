import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useOS } from '../context/OSContext';
import { CharacterProfile, RegexScriptData, TavernPreset } from '../types';
import { DB } from '../utils/db';
import { PresetRuntime, refreshPresetRegexCache } from '../utils/presets';
import {
    PLACEMENT_LABELS,
    createEmptyRegexScript,
    looksLikeWrapMisconfig,
} from '../utils/regex/engine';
import {
    REGEX_DEBUG_EVENT,
    RegexDebugEventDetail,
    buildRegexImportPreview,
    getGlobalRegexScripts,
    saveGlobalRegexScripts,
    exportRegexScriptsJson,
    getRegexScriptRiskFlags,
    pickRegexImportScripts,
    setRegexDebugEventEnabled,
    RegexImportPreview,
} from '../utils/regex/store';
import RegexEditor from '../components/regex/RegexEditor';
import {
    BracketsCurly,
    CaretDown,
    CaretLeft,
    DownloadSimple,
    Globe,
    MagnifyingGlass,
    Plus,
    PushPinSimple,
    SlidersHorizontal,
    Trash,
    UploadSimple,
    UserCircle,
    WarningCircle,
} from '@phosphor-icons/react';

const AC = '#9ecfc4';
const AC_DARK = '#5b7771';
const AC_SOFT = '#f0faf7';
const AC_WASH = 'rgba(172,214,204,0.34)';
const CANVAS = 'radial-gradient(120% 72% at 50% -18%, rgba(172,214,204,0.30), transparent 62%), linear-gradient(158deg, #fffaf8 0%, #f8fbf7 44%, #f1f7f9 100%)';
const GRAD_MAIN = 'linear-gradient(135deg, #d4eee7 0%, #d8edf4 62%, #f2e6c2 145%)';
const GRAD_SOFT = 'linear-gradient(135deg, rgba(240,250,247,0.98) 0%, rgba(243,250,252,0.96) 58%, rgba(255,250,236,0.90) 100%)';
const GRAD_CARD = 'linear-gradient(180deg, rgba(255,255,255,0.98), rgba(255,255,255,0.94)), linear-gradient(135deg, rgba(172,214,204,0.12), rgba(191,220,232,0.10), rgba(232,213,164,0.09))';
const GRAD_FIELD = 'linear-gradient(135deg, rgba(255,255,255,0.98), rgba(247,252,250,0.96) 58%, rgba(255,250,241,0.94))';
const GRAD_WARM = 'linear-gradient(135deg, #fff8ea 0%, #f8eccb 58%, #ead89f 120%)';
const PAPER = '#ffffff';
const EDGE = 'rgba(91,119,113,0.14)';
const HAIRLINE = 'rgba(43,41,51,0.07)';
const INK = '#2b2933';
const INK_SOFT = '#6f6b76';
const INK_FAINT = '#a6a1ad';
const CARD_SHADOW = '0 1px 2px rgba(38,38,38,0.04), 0 18px 40px -28px rgba(38,38,38,0.32)';
const LABEL_STACK: React.CSSProperties = {
    fontFamily: '"SFMono-Regular", "Roboto Mono", "Courier New", monospace',
};
const PINNED_PRESETS_KEY = 'os_preset_pinned_ids';

type ScriptFilter = 'all' | 'enabled' | 'disabled' | 'raw' | 'prompt' | 'display' | 'risky';
type ImportSafetyMode = 'disabled' | 'original';

interface ImportPreviewState {
    preview: RegexImportPreview;
    selectedIndexes: number[];
    safetyMode: ImportSafetyMode;
}

const SCRIPT_FILTERS: Array<{ id: ScriptFilter; label: string }> = [
    { id: 'all', label: '全部' },
    { id: 'enabled', label: '启用' },
    { id: 'disabled', label: '停用' },
    { id: 'raw', label: '改原文' },
    { id: 'prompt', label: '仅提示词' },
    { id: 'display', label: '仅显示' },
    { id: 'risky', label: '风险' },
];

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

const CandyToggle: React.FC<{ on: boolean; onToggle: () => void }> = ({ on, onToggle }) => (
    <button
        onClick={(e) => {
            e.stopPropagation();
            onToggle();
        }}
        role="switch"
        aria-checked={on}
        className="relative w-[52px] h-[28px] shrink-0 rounded-full transition-all duration-300 active:scale-95"
        style={{
            background: on ? GRAD_MAIN : 'linear-gradient(135deg, #f7f6f2, #ebe9e3)',
            border: `1px solid ${EDGE}`,
            boxShadow: on ? '0 8px 18px -13px rgba(91,119,113,0.34)' : 'inset 0 1px 2px rgba(38,38,38,0.08)',
        }}
    >
        <span className="absolute top-1/2 -translate-y-1/2 text-[8px] font-bold transition-opacity duration-300 pointer-events-none" style={{ ...LABEL_STACK, left: 8, color: AC_DARK, opacity: on ? 1 : 0 }}>ON</span>
        <span className="absolute top-1/2 -translate-y-1/2 text-[8px] font-bold transition-opacity duration-300 pointer-events-none" style={{ ...LABEL_STACK, right: 7, color: '#aaa6a0', opacity: on ? 0 : 1 }}>off</span>
        <span
            className="absolute top-1/2 -translate-y-1/2 w-[22px] h-[22px] rounded-full bg-white transition-all duration-300"
            style={{ left: on ? 27 : 3, boxShadow: '0 2px 6px rgba(38,38,38,0.24)' }}
        />
    </button>
);

const StickerChip: React.FC<{
    active: boolean;
    onClick?: () => void;
    children: React.ReactNode;
    title?: string;
    tone?: 'rose' | 'blue' | 'mint' | 'gold' | 'plain';
}> = ({ active, onClick, children, title, tone = 'rose' }) => {
    const palette = {
        rose: { bg: GRAD_MAIN, ink: AC_DARK, edge: 'rgba(91,119,113,0.24)' },
        blue: { bg: 'linear-gradient(135deg, #e7f5fa, #d8edf4)', ink: '#607780', edge: 'rgba(121,161,174,0.24)' },
        mint: { bg: 'linear-gradient(135deg, #edf9f5, #dff2ec)', ink: AC_DARK, edge: 'rgba(91,119,113,0.24)' },
        gold: { bg: GRAD_WARM, ink: '#6f4c1c', edge: 'rgba(215,166,79,0.36)' },
        plain: { bg: '#fbfaf8', ink: INK_SOFT, edge: HAIRLINE },
    }[tone];
    return (
        <button
            onClick={(e) => {
                e.stopPropagation();
                onClick?.();
            }}
            title={title}
            className="px-3 py-1.5 text-[11px] font-bold rounded-full transition-all active:scale-95 max-w-full truncate"
            style={{
                background: active ? palette.bg : GRAD_FIELD,
                color: active ? palette.ink : INK_SOFT,
                border: `1px solid ${active ? palette.edge : HAIRLINE}`,
                boxShadow: active ? '0 7px 16px -13px rgba(91,119,113,0.24)' : 'none',
            }}
        >
            {children}
        </button>
    );
};

const PinButton: React.FC<{ onClick: () => void; children: React.ReactNode; disabled?: boolean; tone?: 'rose' | 'mint' | 'danger' }> = ({ onClick, children, disabled, tone = 'rose' }) => {
    const styles: Record<string, React.CSSProperties> = {
        rose: { background: PAPER, border: `1px solid ${HAIRLINE}`, color: AC_DARK, boxShadow: '0 1px 2px rgba(38,38,38,0.08)' },
        mint: { background: AC_SOFT, border: `1px solid ${EDGE}`, color: AC_DARK, boxShadow: '0 1px 2px rgba(38,38,38,0.08)' },
        danger: { background: '#fff5f7', border: '1px solid #f1c6d1', color: '#d4536f', boxShadow: '0 1px 2px rgba(212,83,111,0.10)' },
    };
    return (
        <button
            onClick={(e) => {
                e.stopPropagation();
                onClick();
            }}
            disabled={disabled}
            className="text-[11px] font-bold px-2.5 py-1 rounded-full active:scale-95 transition-transform whitespace-nowrap disabled:opacity-40"
            style={styles[tone]}
        >
            {children}
        </button>
    );
};

const ScopeTab: React.FC<{
    active: boolean;
    icon: React.ReactNode;
    title: string;
    count: number;
    onClick: () => void;
}> = ({ active, icon, title, count, onClick }) => (
    <button
        onClick={onClick}
        className="min-w-[104px] flex-1 rounded-[16px] px-3 py-2.5 text-left active:scale-[0.98] transition-transform"
        style={{
            background: active ? GRAD_MAIN : GRAD_FIELD,
            color: active ? AC_DARK : INK,
            border: `1px solid ${active ? 'rgba(91,119,113,0.20)' : HAIRLINE}`,
            boxShadow: active ? '0 14px 26px -17px rgba(91,119,113,0.32)' : '0 10px 24px -22px rgba(38,38,38,0.28)',
        }}
    >
        <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-full flex items-center justify-center shrink-0" style={{ background: active ? 'rgba(255,255,255,0.48)' : GRAD_SOFT, color: AC_DARK }}>
                {icon}
            </span>
            <span className="min-w-0 flex-1 text-[12px] font-bold truncate">{title}</span>
            <span className="text-[15px] font-black tabular-nums leading-none">{count}</span>
        </div>
    </button>
);

const ToolCard: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
    <section
        className={`rounded-[22px] ${className}`}
        style={{ background: GRAD_CARD, border: `1px solid ${HAIRLINE}`, boxShadow: CARD_SHADOW }}
    >
        {children}
    </section>
);

const StatTile: React.FC<{ label: string; value: number | string; tone: 'teal' | 'sky' | 'paper' }> = ({ label, value, tone }) => {
    const palette = {
        teal: { bg: 'linear-gradient(135deg, #f0faf7, #e5f4ef)', ink: AC_DARK },
        sky: { bg: 'linear-gradient(135deg, #eff8fb, #edf8f4)', ink: '#607780' },
        paper: { bg: 'linear-gradient(135deg, #fff6e8, #f6eed3)', ink: '#6f4c1c' },
    }[tone];
    return (
        <div className="rounded-[14px] px-3 py-2 text-center" style={{ background: palette.bg, border: `1px solid ${HAIRLINE}` }}>
            <div className="text-[16px] font-black tabular-nums leading-none" style={{ color: palette.ink }}>{value}</div>
            <div className="text-[9px] mt-1 font-bold truncate" style={{ color: '#5a5660' }}>{label}</div>
        </div>
    );
};

const CharacterPolaroid: React.FC<{
    character: CharacterProfile;
    active: boolean;
    onClick: () => void;
}> = ({ character, active, onClick }) => {
    const total = character.regexScripts?.length || 0;
    const enabled = character.regexScripts?.filter(s => !s.disabled).length || 0;
    return (
        <button
            onClick={onClick}
            className="shrink-0 w-[118px] rounded-[18px] bg-white p-2 text-left active:scale-[0.98] transition-transform"
            style={{
                border: `1px solid ${active ? 'rgba(63,117,109,0.36)' : HAIRLINE}`,
                boxShadow: active ? '0 16px 28px -20px rgba(63,117,109,0.50)' : '0 10px 22px -20px rgba(38,38,38,0.28)',
            }}
        >
            <div
                className="relative h-[72px] rounded-[10px] overflow-hidden"
                style={{
                    background: active
                        ? 'linear-gradient(145deg, rgba(232,245,241,0.98), rgba(223,239,246,0.92), rgba(255,247,229,0.78))'
                        : 'linear-gradient(145deg, #fbfaf8, #eef6f2, #fff8ea)',
                    border: `1px solid ${active ? EDGE : HAIRLINE}`,
                }}
            >
                <div aria-hidden className="absolute inset-x-0 top-0 h-5" style={{ background: 'rgba(255,255,255,0.52)' }} />
                <div aria-hidden className="absolute -right-5 -bottom-6 w-16 h-16 rounded-full" style={{ background: active ? 'rgba(107,183,168,0.22)' : 'rgba(166,161,173,0.12)' }} />
                <div className="absolute inset-0 flex items-center justify-center">
                    {character.avatar ? (
                        <img src={character.avatar} alt="" className="w-full h-full object-cover" />
                    ) : (
                        <span
                            className="w-10 h-10 rounded-[14px] flex items-center justify-center"
                            style={{
                            background: active ? GRAD_MAIN : 'linear-gradient(135deg, rgba(255,255,255,0.94), rgba(240,250,247,0.90))',
                                color: AC_DARK,
                                border: `1px solid ${active ? 'rgba(255,255,255,0.28)' : HAIRLINE}`,
                            }}
                        >
                            <UserCircle size={22} weight="bold" />
                        </span>
                    )}
                </div>
                {active && (
                    <span className="absolute right-2 top-2 text-[8px] font-black px-1.5 py-0.5 rounded-full" style={{ background: '#fff', color: AC_DARK, border: `1px solid ${EDGE}` }}>
                        ON
                    </span>
                )}
            </div>
            <div className="pt-2 pb-0.5 px-0.5">
                <div className="text-[12px] font-extrabold truncate" style={{ color: INK }}>{character.name || '未命名角色'}</div>
                <div className="mt-0.5 text-[9px] font-bold truncate" style={{ color: INK_SOFT }}>{total} 条正则 · {enabled} 启用</div>
            </div>
        </button>
    );
};

const ScriptCard: React.FC<{
    script: RegexScriptData;
    disabled: boolean;
    mode: string;
    selected: boolean;
    selectionMode: boolean;
    riskFlags: string[];
    onOpen: () => void;
    onSelect: () => void;
    onToggle: () => void;
    onFix: () => void;
    onDelete: () => void;
}> = ({ script, disabled, mode, selected, selectionMode, riskFlags, onOpen, onSelect, onToggle, onFix, onDelete }) => (
    <div
        onClick={selectionMode ? onSelect : onOpen}
        className="relative cursor-pointer rounded-[16px] px-3 py-2.5 active:scale-[0.99] transition-transform"
        style={{
            background: disabled ? 'linear-gradient(135deg, #f6f5f2, #eeece8)' : GRAD_CARD,
            border: `1px solid ${selected ? 'rgba(91,119,113,0.42)' : HAIRLINE}`,
            boxShadow: '0 10px 24px -22px rgba(38,38,38,0.32)',
            opacity: disabled ? 0.72 : 1,
        }}
    >
        <div className="flex items-start gap-2.5">
            {selectionMode && (
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onSelect();
                    }}
                    className="mt-1 w-6 h-6 rounded-full flex items-center justify-center shrink-0 active:scale-95"
                    style={{ background: selected ? GRAD_MAIN : PAPER, border: `1px solid ${selected ? EDGE : HAIRLINE}`, color: AC_DARK }}
                    aria-label={selected ? '取消选择' : '选择脚本'}
                >
                    {selected ? '✓' : ''}
                </button>
            )}
            <span className="shrink-0 mt-0.5 w-8 h-8 rounded-[11px] flex items-center justify-center" style={{ background: disabled ? '#eceae6' : GRAD_SOFT, color: disabled ? '#aaa6a0' : AC_DARK }}>
                <BracketsCurly size={16} weight="bold" />
            </span>
            <div className="min-w-0 flex-1">
                <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-bold truncate" style={{ color: disabled ? '#8b8996' : INK }}>{script.scriptName || '未命名正则'}</div>
                        <div className="mt-0.5 text-[10px] leading-snug font-mono line-clamp-1 break-all" style={{ color: disabled ? '#aaa6a0' : '#60706c' }}>
                            {script.findRegex || '未填写查找正则'}
                        </div>
                    </div>
                    <CandyToggle on={!disabled} onToggle={onToggle} />
                </div>

                <div className="mt-2 flex items-end justify-between gap-2">
                    <div className="min-w-0 flex-1 flex flex-wrap gap-1.5">
                        <StickerChip active tone={script.promptOnly ? 'gold' : script.markdownOnly ? 'blue' : 'mint'}>{mode}</StickerChip>
                        {riskFlags.length > 0 && <StickerChip active tone="gold">风险 {riskFlags.length}</StickerChip>}
                        {script.placement.slice(0, 3).map(p => PLACEMENT_LABELS[p] && (
                            <StickerChip key={p} active={false} tone="plain">{PLACEMENT_LABELS[p]}</StickerChip>
                        ))}
                        {script.placement.length > 3 && <StickerChip active={false} tone="plain">+{script.placement.length - 3}</StickerChip>}
                        {(typeof script.minDepth === 'number' || typeof script.maxDepth === 'number') && (
                            <StickerChip active={false} tone="plain">深度 {script.minDepth ?? '∞'}~{script.maxDepth ?? '∞'}</StickerChip>
                        )}
                    </div>
                    <div className="shrink-0 flex items-center gap-1.5">
                        {looksLikeWrapMisconfig(script) && (
                            <PinButton onClick={onFix} tone="mint">
                                <span className="inline-flex items-center gap-1"><WarningCircle size={13} weight="fill" />仅提示词</span>
                            </PinButton>
                        )}
                        {!selectionMode && (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onDelete();
                                }}
                                className="w-8 h-8 rounded-full flex items-center justify-center active:scale-95 transition-transform"
                                style={{ background: '#fff5f7', border: '1px solid #f1c6d1', color: '#d4536f' }}
                                aria-label="删除"
                                title="删除"
                            >
                                <Trash size={15} weight="bold" />
                            </button>
                        )}
                    </div>
                </div>
                {riskFlags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                        {riskFlags.slice(0, 3).map(flag => (
                            <span key={flag} className="text-[10px] px-2 py-1 rounded-full" style={{ background: '#fff8ea', color: '#7a5b1f', border: '1px solid rgba(215,166,79,0.30)' }}>
                                {flag}
                            </span>
                        ))}
                    </div>
                )}
            </div>
        </div>
    </div>
);

const RegexApp: React.FC = () => {
    const { closeApp, addToast, characters, updateCharacter, userProfile } = useOS();
    const [scope, setScope] = useState<'global' | 'preset' | 'scoped'>('global');
    const [scopedCharId, setScopedCharId] = useState<string>(characters[0]?.id || '');
    const [globalScripts, setGlobalScripts] = useState<RegexScriptData[]>(() => getGlobalRegexScripts());
    const [presets, setPresets] = useState<TavernPreset[]>([]);
    const [presetId, setPresetId] = useState<string>(PresetRuntime.getActiveId() || '');
    const [presetSelectorOpen, setPresetSelectorOpen] = useState(true);
    const [characterSelectorOpen, setCharacterSelectorOpen] = useState(true);
    const [presetQuery, setPresetQuery] = useState('');
    const [pinnedPresetIds, setPinnedPresetIds] = useState<string[]>(() => readPinnedPresetIds());
    const [scriptQuery, setScriptQuery] = useState('');
    const [scriptFilter, setScriptFilter] = useState<ScriptFilter>('all');
    const [selectionMode, setSelectionMode] = useState(false);
    const [selectedScriptIds, setSelectedScriptIds] = useState<string[]>([]);
    const [importPreview, setImportPreview] = useState<ImportPreviewState | null>(null);
    const [debugEnabled, setDebugEnabled] = useState(false);
    const [debugLogs, setDebugLogs] = useState<RegexDebugEventDetail[]>([]);
    const [editing, setEditing] = useState<RegexScriptData | null>(null);
    const [editingIsNew, setEditingIsNew] = useState(false);
    const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null);
    const importRef = useRef<HTMLInputElement>(null);

    const scopedChar = useMemo(
        () => characters.find(c => c.id === scopedCharId) || null,
        [characters, scopedCharId],
    );
    const preset = useMemo(
        () => presets.find(p => p.id === presetId) || null,
        [presets, presetId],
    );
    const pinnedPresetSet = useMemo(() => new Set(pinnedPresetIds), [pinnedPresetIds]);
    const sortedPresets = useMemo(() => {
        return [...presets].sort((a, b) => {
            const pinnedDelta = Number(pinnedPresetSet.has(b.id)) - Number(pinnedPresetSet.has(a.id));
            if (pinnedDelta !== 0) return pinnedDelta;
            return a.createdAt - b.createdAt;
        });
    }, [presets, pinnedPresetSet]);
    const filteredPresets = useMemo(() => {
        const q = presetQuery.trim().toLowerCase();
        if (!q) return sortedPresets;
        return sortedPresets.filter(p => p.name.toLowerCase().includes(q));
    }, [sortedPresets, presetQuery]);
    const presetSelectOptions = useMemo(() => {
        if (!preset || filteredPresets.some(p => p.id === preset.id)) return filteredPresets;
        return [preset, ...filteredPresets];
    }, [preset, filteredPresets]);
    const presetPinned = !!presetId && pinnedPresetSet.has(presetId);
    const scripts: RegexScriptData[] = scope === 'global'
        ? globalScripts
        : scope === 'preset'
            ? (preset?.regexScripts || [])
            : (scopedChar?.regexScripts || []);
    const enabledCount = scripts.filter(s => !s.disabled).length;
    const riskMap = useMemo(() => new Map(scripts.map(s => [s.id, getRegexScriptRiskFlags(s)])), [scripts]);
    const riskCount = useMemo(() => scripts.filter(s => (riskMap.get(s.id)?.length || 0) > 0).length, [scripts, riskMap]);
    const selectedSet = useMemo(() => new Set(selectedScriptIds), [selectedScriptIds]);
    const filteredScripts = useMemo(() => {
        const q = scriptQuery.trim().toLowerCase();
        return scripts.filter(script => {
            const riskFlags = riskMap.get(script.id) || [];
            const mode = script.markdownOnly ? '仅显示层' : script.promptOnly ? '仅提示词' : '改写原文';
            const text = [
                script.scriptName,
                script.findRegex,
                script.replaceString,
                mode,
                ...script.placement.map(p => PLACEMENT_LABELS[p] || ''),
                ...riskFlags,
            ].join(' ').toLowerCase();
            if (q && !text.includes(q)) return false;
            switch (scriptFilter) {
                case 'enabled': return !script.disabled;
                case 'disabled': return !!script.disabled;
                case 'raw': return !script.markdownOnly && !script.promptOnly;
                case 'prompt': return !!script.promptOnly;
                case 'display': return !!script.markdownOnly;
                case 'risky': return riskFlags.length > 0;
                default: return true;
            }
        });
    }, [scripts, scriptQuery, scriptFilter, riskMap]);
    const selectedScripts = useMemo(() => scripts.filter(s => selectedSet.has(s.id)), [scripts, selectedSet]);
    const allVisibleSelected = filteredScripts.length > 0 && filteredScripts.every(s => selectedSet.has(s.id));

    useEffect(() => {
        DB.getAllPresets()
            .then(list => {
                list.sort((a, b) => a.createdAt - b.createdAt);
                setPresets(list);
                setPresetId(cur => {
                    if (cur && list.some(p => p.id === cur)) return cur;
                    const activeId = PresetRuntime.getActiveId();
                    if (activeId && list.some(p => p.id === activeId)) return activeId;
                    return list[0]?.id || '';
                });
            })
            .catch(e => addToast(`预设列表读取失败：${e?.message || e}`, 'error'));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        setSelectedScriptIds(prev => {
            const next = prev.filter(id => scripts.some(s => s.id === id));
            return next.length === prev.length ? prev : next;
        });
    }, [scripts]);

    useEffect(() => {
        setRegexDebugEventEnabled(debugEnabled);
        const onDebug = (event: Event) => {
            const detail = (event as CustomEvent<RegexDebugEventDetail>).detail;
            if (!detail) return;
            setDebugLogs(prev => [detail, ...prev].slice(0, 40));
        };
        window.addEventListener(REGEX_DEBUG_EVENT, onDebug);
        return () => {
            window.removeEventListener(REGEX_DEBUG_EVENT, onDebug);
            setRegexDebugEventEnabled(false);
        };
    }, [debugEnabled]);

    const persist = async (next: RegexScriptData[]) => {
        if (scope === 'global') {
            setGlobalScripts(next);
            saveGlobalRegexScripts(next);
        } else if (scope === 'preset' && preset) {
            const nextPreset = { ...preset, regexScripts: next, updatedAt: Date.now() };
            setPresets(prev => prev.map(p => (p.id === nextPreset.id ? nextPreset : p)));
            await DB.savePreset(nextPreset);
            if (PresetRuntime.getActiveId() === nextPreset.id) void refreshPresetRegexCache();
        } else if (scopedChar) {
            await updateCharacter(scopedChar.id, { regexScripts: next });
        }
    };

    const selectPreset = (id: string) => {
        setPresetId(id);
    };

    const togglePinnedPreset = () => {
        if (!presetId) return;
        setPinnedPresetIds(prev => {
            const next = prev.includes(presetId) ? prev.filter(id => id !== presetId) : [presetId, ...prev];
            savePinnedPresetIds(next);
            return next;
        });
    };

    const openEditor = (script: RegexScriptData) => {
        setEditing({ ...script, trimStrings: [...script.trimStrings], placement: [...script.placement] });
        setEditingIsNew(false);
    };

    const handleToggle = (script: RegexScriptData) => {
        void persist(scripts.map(s => s.id === script.id ? { ...s, disabled: !s.disabled } : s));
    };

    const toggleScriptSelection = (id: string) => {
        setSelectedScriptIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    };

    const toggleSelectVisible = () => {
        if (allVisibleSelected) {
            const visible = new Set(filteredScripts.map(s => s.id));
            setSelectedScriptIds(prev => prev.filter(id => !visible.has(id)));
        } else {
            setSelectedScriptIds(prev => Array.from(new Set([...prev, ...filteredScripts.map(s => s.id)])));
        }
    };

    const persistSelectedPatch = (patch: Partial<RegexScriptData>, toast: string) => {
        if (selectedScriptIds.length === 0) { addToast('请先选择正则', 'info'); return; }
        void persist(scripts.map(s => selectedSet.has(s.id) ? { ...s, ...patch } : s));
        addToast(toast, 'success');
    };

    const handleBatchDelete = () => {
        if (selectedScriptIds.length === 0) { addToast('请先选择正则', 'info'); return; }
        setConfirmDialog({
            title: '删除选中的正则？',
            message: `将删除 ${selectedScriptIds.length} 条正则，删除后无法恢复。`,
            onConfirm: () => {
                void persist(scripts.filter(s => !selectedSet.has(s.id)));
                setSelectedScriptIds([]);
                setSelectionMode(false);
                setConfirmDialog(null);
                addToast('已删除选中正则', 'success');
            },
        });
    };

    const downloadScripts = (list: RegexScriptData[], filename: string) => {
        if (list.length === 0) { addToast('没有可导出的正则', 'info'); return; }
        const blob = new Blob([exportRegexScriptsJson(list)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        addToast('已导出 JSON', 'success');
    };

    const handleFixWrapMisconfig = (script: RegexScriptData) => {
        if (!window.confirm(`将「${script.scriptName || '未命名正则'}」设置为仅提示词模式？\n\n启用后，它只会改写发送给 LLM 的提示词，不会改动聊天原文或气泡显示。`)) return;
        void persist(scripts.map(s => s.id === script.id ? { ...s, promptOnly: true } : s));
        addToast('已设置为仅提示词模式', 'success');
    };

    const handleDelete = (script: RegexScriptData) => {
        setConfirmDialog({
            title: '删除正则？',
            message: `「${script.scriptName || '未命名正则'}」删除后无法恢复。`,
            onConfirm: () => {
                void persist(scripts.filter(s => s.id !== script.id));
                setConfirmDialog(null);
                addToast('已删除正则', 'success');
            },
        });
    };

    const handleSaveEditing = async () => {
        if (!editing) return;
        if (!editing.findRegex.trim()) { addToast('查找正则不能为空', 'error'); return; }
        if (scope === 'scoped' && !scopedChar) { addToast('请先选择角色', 'error'); return; }
        if (scope === 'preset' && !preset) { addToast('请先选择预设', 'error'); return; }
        const named = { ...editing, scriptName: editing.scriptName.trim() || '未命名正则' };
        const exists = scripts.some(s => s.id === named.id);
        await persist(exists ? scripts.map(s => s.id === named.id ? named : s) : [...scripts, named]);
        setEditing(null);
        addToast('已保存正则', 'success');
    };

    const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        (async () => {
            try {
                const preview = buildRegexImportPreview(await file.text(), scripts);
                setImportPreview({
                    preview,
                    selectedIndexes: preview.items.map((_, idx) => idx),
                    safetyMode: 'disabled',
                });
            } catch (err: any) {
                addToast(`导入失败：${err?.message || '不是有效的 JSON 文件'}`, 'error');
            } finally {
                if (importRef.current) importRef.current.value = '';
            }
        })();
    };

    const handleExport = () => {
        downloadScripts(scripts, scope === 'global'
            ? 'regex-global.json'
            : scope === 'preset'
                ? `regex-preset-${preset?.name || 'preset'}.json`
                : `regex-${scopedChar?.name || 'scoped'}.json`);
    };

    const handleExportSelected = () => {
        downloadScripts(selectedScripts, scope === 'global'
            ? 'regex-global-selected.json'
            : scope === 'preset'
                ? `regex-preset-${preset?.name || 'preset'}-selected.json`
                : `regex-${scopedChar?.name || 'scoped'}-selected.json`);
    };

    const handleConfirmImport = async () => {
        if (!importPreview) return;
        const picked = pickRegexImportScripts(importPreview.preview, importPreview.selectedIndexes, {
            disableImported: importPreview.safetyMode === 'disabled',
        });
        if (picked.length === 0) { addToast('请至少选择一条正则', 'info'); return; }
        const map = new Map(scripts.map(s => [s.id, s]));
        picked.forEach(s => map.set(s.id, s));
        await persist(Array.from(map.values()));
        setImportPreview(null);
        addToast(`已导入 ${picked.length} 条正则`, 'success');
    };

    const toggleImportIndex = (idx: number) => {
        setImportPreview(prev => {
            if (!prev) return prev;
            const selected = prev.selectedIndexes.includes(idx)
                ? prev.selectedIndexes.filter(i => i !== idx)
                : [...prev.selectedIndexes, idx];
            return { ...prev, selectedIndexes: selected };
        });
    };

    const toggleAllImportIndexes = () => {
        setImportPreview(prev => {
            if (!prev) return prev;
            const all = prev.selectedIndexes.length === prev.preview.items.length;
            return { ...prev, selectedIndexes: all ? [] : prev.preview.items.map((_, idx) => idx) };
        });
    };

    const handleNewScript = () => {
        if (scope === 'scoped' && !scopedChar) { addToast('请先选择角色', 'error'); return; }
        if (scope === 'preset' && !preset) { addToast('请先选择预设', 'error'); return; }
        setEditing(createEmptyRegexScript());
        setEditingIsNew(true);
    };

    return (
        <div
            className="absolute inset-0 z-[260] flex flex-col animate-fade-in overflow-hidden"
            style={{ background: CANVAS, color: INK }}
        >
            <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-72" style={{ background: `radial-gradient(115% 88% at 50% -22%, ${AC_WASH}, transparent 68%)` }} />
            <div aria-hidden className="pointer-events-none absolute inset-x-0 top-[92px] h-48" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0), rgba(130,189,213,0.13), rgba(255,247,229,0))' }} />

            <div className="relative z-20 shrink-0 flex items-center gap-3 px-3 py-3" style={{ background: PAPER, borderBottom: '1px solid #ededed' }}>
                <button
                    onClick={closeApp}
                    className="w-9 h-9 rounded-full bg-white flex items-center justify-center active:scale-90 transition-transform shrink-0"
                    style={{ boxShadow: '0 1px 3px rgba(38,38,38,0.14)', border: `1px solid ${HAIRLINE}`, color: AC_DARK }}
                    aria-label="返回"
                >
                    <CaretLeft size={18} weight="bold" />
                </button>
                <div className="w-9 h-9 rounded-[12px] p-1.5 shrink-0" style={{ background: GRAD_FIELD, border: `1px solid ${HAIRLINE}` }}>
                    <div className="w-full h-full rounded-[5px] flex items-center justify-center" style={{ background: GRAD_MAIN, color: AC_DARK, boxShadow: '0 8px 18px -14px rgba(91,119,113,0.38)' }}>
                        <BracketsCurly size={18} weight="bold" />
                    </div>
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                        <span className="text-[17px] font-extrabold leading-tight truncate" style={{ color: INK }}>补丁铺</span>
                        <span className="text-[8px] tracking-[0.28em] select-none shrink-0" style={{ ...LABEL_STACK, color: AC }}>PATCH SHOP</span>
                    </div>
                    <div className="text-[10px] truncate mt-0.5" style={{ color: INK_SOFT }}>
                        {scope === 'global' ? '全局正则' : scope === 'preset' ? (preset?.name || '预设正则') : scopedChar?.name || '角色正则'} · 更改会自动保存
                    </div>
                </div>
                <span className="text-[10px] font-bold select-none shrink-0 px-2.5 py-1 rounded-full" style={{ color: AC_DARK, background: GRAD_SOFT, border: `1px solid ${EDGE}` }}>已保存</span>
            </div>

            <div className="relative z-10 flex-1 overflow-y-auto no-scrollbar px-3 pt-2.5 pb-24 space-y-2.5">
                <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                    <ScopeTab
                        active={scope === 'global'}
                        icon={<Globe size={17} weight="bold" />}
                        title="全局"
                        count={globalScripts.length}
                        onClick={() => setScope('global')}
                    />
                    <ScopeTab
                        active={scope === 'preset'}
                        icon={<SlidersHorizontal size={17} weight="bold" />}
                        title="预设"
                        count={preset?.regexScripts?.length || 0}
                        onClick={() => setScope('preset')}
                    />
                    <ScopeTab
                        active={scope === 'scoped'}
                        icon={<UserCircle size={17} weight="bold" />}
                        title="角色"
                        count={scopedChar?.regexScripts?.length || 0}
                        onClick={() => setScope('scoped')}
                    />
                </div>

                {(scope === 'preset' || scope === 'scoped') && (
                    <ToolCard className="px-3 py-2.5">
                        <button
                            onClick={() => scope === 'preset' ? setPresetSelectorOpen(v => !v) : setCharacterSelectorOpen(v => !v)}
                            className="w-full flex items-center justify-between gap-3 text-left active:scale-[0.99] transition-transform"
                        >
                            <div className="min-w-0">
                                <div className="text-[12px] font-bold" style={{ color: INK }}>
                                    {scope === 'preset' ? '选择预设' : '选择角色'}
                                </div>
                                <div className="text-[10px] mt-0.5 truncate" style={{ color: INK_SOFT }}>
                                    {scope === 'preset' ? '当前只管理这个预设自带的正则' : '当前只管理这个角色的局部正则'}
                                </div>
                            </div>
                            <span
                                className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-transform"
                                style={{ background: GRAD_SOFT, color: AC_DARK, border: `1px solid ${EDGE}`, transform: (scope === 'preset' ? presetSelectorOpen : characterSelectorOpen) ? 'rotate(180deg)' : 'rotate(0deg)' }}
                            >
                                <CaretDown size={15} weight="bold" />
                            </span>
                        </button>

                        {scope === 'preset' && presetSelectorOpen && (
                            <div className="pt-2.5 space-y-2.5">
                                <label className="flex h-12 items-center gap-2 rounded-[18px] px-4" style={{ background: GRAD_FIELD, border: `1px solid ${HAIRLINE}`, boxShadow: 'inset 0 1px 2px rgba(38,38,38,0.03)' }}>
                                    <MagnifyingGlass size={18} weight="bold" style={{ color: '#718096' }} />
                                    <input
                                        value={presetQuery}
                                        onChange={e => setPresetQuery(e.target.value)}
                                        className="min-w-0 flex-1 bg-transparent outline-none text-[13px] font-bold placeholder:text-[#9aa3af]"
                                        style={{ color: INK }}
                                        placeholder="搜索预设名称"
                                    />
                                </label>
                                <div className="grid grid-cols-[minmax(0,1fr)_56px] gap-2.5">
                                    <div className="relative min-w-0">
                                        <select
                                            value={presetId || ''}
                                            onChange={e => selectPreset(e.target.value)}
                                            disabled={presetSelectOptions.length === 0}
                                            className="w-full h-12 appearance-none rounded-[18px] pl-4 pr-10 text-[14px] font-extrabold outline-none disabled:opacity-50"
                                            style={{ background: GRAD_FIELD, color: INK, border: `1px solid ${HAIRLINE}`, boxShadow: '0 8px 18px -16px rgba(38,38,38,0.24)' }}
                                        >
                                            {presetSelectOptions.map(p => (
                                                <option key={p.id} value={p.id}>
                                                    {pinnedPresetSet.has(p.id) ? '置顶 · ' : ''}{p.name}
                                                </option>
                                            ))}
                                        </select>
                                        <CaretDown
                                            aria-hidden
                                            size={16}
                                            weight="bold"
                                            className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none"
                                            style={{ color: '#718096' }}
                                        />
                                    </div>
                                    <button
                                        onClick={togglePinnedPreset}
                                        disabled={!preset}
                                        className="h-12 rounded-[18px] flex items-center justify-center active:scale-95 transition-transform disabled:opacity-40"
                                        style={{
                                            background: presetPinned ? GRAD_WARM : GRAD_FIELD,
                                            color: presetPinned ? '#7a5b1f' : '#718096',
                                            border: `1px solid ${presetPinned ? 'rgba(215,166,79,0.40)' : HAIRLINE}`,
                                            boxShadow: presetPinned ? '0 10px 20px -17px rgba(215,166,79,0.58)' : '0 8px 18px -16px rgba(38,38,38,0.24)',
                                        }}
                                        aria-label={presetPinned ? '取消置顶当前预设' : '置顶当前预设'}
                                        title={presetPinned ? '取消置顶当前预设' : '置顶当前预设'}
                                    >
                                        <PushPinSimple size={20} weight={presetPinned ? 'fill' : 'bold'} />
                                    </button>
                                </div>
                                {presets.length === 0 && <span className="block text-[10px]" style={{ color: INK_FAINT }}>暂无预设，请先到活字盘新建或导入。</span>}
                                {presets.length > 0 && filteredPresets.length === 0 && (
                                    <span className="block text-[10px]" style={{ color: INK_FAINT }}>没有匹配的预设，当前预设仍保留在下拉框里。</span>
                                )}
                            </div>
                        )}

                        {scope === 'scoped' && characterSelectorOpen && (
                            <div className="pt-2.5">
                                <div className="flex gap-2.5 overflow-x-auto no-scrollbar pb-0.5">
                                    {characters.map(c => (
                                        <CharacterPolaroid key={c.id} character={c} active={scopedCharId === c.id} onClick={() => setScopedCharId(c.id)} />
                                    ))}
                                    {characters.length === 0 && <span className="text-[10px]" style={{ color: INK_FAINT }}>暂无角色</span>}
                                </div>
                            </div>
                        )}
                    </ToolCard>
                )}

                {debugEnabled && (
                    <ToolCard>
                        <div className="px-4 pt-3 pb-2.5 border-b" style={{ borderColor: HAIRLINE }}>
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="text-[14px] font-extrabold" style={{ color: INK }}>本次会话调试</div>
                                    <div className="text-[10px] mt-1" style={{ color: INK_SOFT }}>只显示入口、模式和短预览，不保存完整聊天。</div>
                                </div>
                                <div className="flex gap-1.5 shrink-0">
                                    <PinButton onClick={() => setDebugLogs([])} tone="rose">清空</PinButton>
                                    <PinButton onClick={() => setDebugEnabled(false)} tone="mint">关闭</PinButton>
                                </div>
                            </div>
                        </div>
                        <div className="px-3 py-2.5 space-y-2 max-h-56 overflow-y-auto no-scrollbar">
                            {debugLogs.length === 0 ? (
                                <div className="py-5 text-center text-[11px]" style={{ color: INK_FAINT }}>开启后，聊天管线触发正则改写时会出现在这里。</div>
                            ) : debugLogs.map((log, idx) => (
                                <div key={`${log.timestamp}-${idx}`} className="rounded-[14px] px-3 py-2.5" style={{ background: GRAD_FIELD, border: `1px solid ${HAIRLINE}` }}>
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="text-[11px] font-bold truncate" style={{ color: INK }}>
                                            {PLACEMENT_LABELS[log.placement] || `位置 ${log.placement}`} · {log.mode === 'markdown' ? '仅显示层' : log.mode === 'prompt' ? '仅提示词' : '改原文'}
                                        </div>
                                        <div className="text-[9px] shrink-0" style={{ ...LABEL_STACK, color: INK_FAINT }}>
                                            {new Date(log.timestamp).toLocaleTimeString()}
                                        </div>
                                    </div>
                                    <div className="mt-1 text-[10px] leading-relaxed font-mono break-words" style={{ color: INK_SOFT }}>
                                        {log.inputPreview || '(空)'} → {log.outputPreview || '(空)'}
                                    </div>
                                    <div className="mt-1 text-[9px]" style={{ color: INK_FAINT }}>脚本数 {log.scriptCount}</div>
                                </div>
                            ))}
                        </div>
                    </ToolCard>
                )}

                <ToolCard>
                    <div className="px-4 pt-3 pb-2.5 border-b" style={{ borderColor: HAIRLINE, background: 'linear-gradient(135deg, rgba(232,245,241,0.42), rgba(255,255,255,0.18), rgba(255,247,229,0.34))' }}>
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <div className="text-[15px] font-extrabold truncate" style={{ color: INK }}>
                                    {scope === 'global' ? '全局正则' : scope === 'preset' ? (preset?.name || '未选择预设') : scopedChar?.name || '未选择角色'}
                                </div>
                                <div className="text-[10px] mt-1" style={{ color: INK_SOFT }}>
                                    {scripts.length} 条正则 · {enabledCount} 条启用 · {scripts.length - enabledCount} 条停用
                                </div>
                            </div>
                            <div className="flex gap-1.5 shrink-0">
                                <button
                                    onClick={() => importRef.current?.click()}
                                    className="w-9 h-9 rounded-full flex items-center justify-center active:scale-95 transition-transform"
                                    style={{ background: AC_SOFT, color: AC_DARK, border: `1px solid ${EDGE}` }}
                                    title="导入 JSON"
                                >
                                    <UploadSimple size={16} weight="bold" />
                                </button>
                                <button
                                    onClick={handleExport}
                                    className="w-9 h-9 rounded-full flex items-center justify-center active:scale-95 transition-transform"
                                    style={{ background: PAPER, color: AC_DARK, border: `1px solid ${HAIRLINE}` }}
                                    title="导出 JSON"
                                >
                                    <DownloadSimple size={16} weight="bold" />
                                </button>
                            </div>
                        </div>
                        <div className="grid grid-cols-4 gap-2 mt-3">
                            <StatTile label="总数" value={scripts.length} tone="teal" />
                            <StatTile label="启用" value={enabledCount} tone="sky" />
                            <StatTile label="停用" value={scripts.length - enabledCount} tone="paper" />
                            <StatTile label="风险" value={riskCount} tone="paper" />
                        </div>
                        <div className="mt-3 space-y-2.5">
                            <label className="flex h-11 items-center gap-2 rounded-[16px] px-3" style={{ background: GRAD_FIELD, border: `1px solid ${HAIRLINE}` }}>
                                <MagnifyingGlass size={16} weight="bold" style={{ color: '#718096' }} />
                                <input
                                    value={scriptQuery}
                                    onChange={e => setScriptQuery(e.target.value)}
                                    className="min-w-0 flex-1 bg-transparent outline-none text-[12px] font-bold placeholder:text-[#9aa3af]"
                                    style={{ color: INK }}
                                    placeholder="搜索名称、正则、替换内容或风险标签"
                                />
                            </label>
                            <div className="flex flex-wrap gap-1.5">
                                {SCRIPT_FILTERS.map(filter => (
                                    <StickerChip key={filter.id} active={scriptFilter === filter.id} onClick={() => setScriptFilter(filter.id)} tone={filter.id === 'risky' ? 'gold' : 'plain'}>
                                        {filter.label}
                                    </StickerChip>
                                ))}
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                                <PinButton onClick={() => setSelectionMode(v => !v)} tone={selectionMode ? 'mint' : 'rose'}>
                                    {selectionMode ? '退出选择' : '批量选择'}
                                </PinButton>
                                {selectionMode && (
                                    <>
                                        <PinButton onClick={toggleSelectVisible} tone="rose">{allVisibleSelected ? '取消本页' : '选择本页'}</PinButton>
                                        <PinButton onClick={() => persistSelectedPatch({ disabled: false }, '已启用选中正则')} tone="mint">启用</PinButton>
                                        <PinButton onClick={() => persistSelectedPatch({ disabled: true }, '已停用选中正则')} tone="rose">停用</PinButton>
                                        <PinButton onClick={handleExportSelected} tone="rose">导出选中</PinButton>
                                        <PinButton onClick={handleBatchDelete} tone="danger">删除</PinButton>
                                    </>
                                )}
                                <PinButton onClick={() => setDebugEnabled(v => !v)} tone={debugEnabled ? 'mint' : 'rose'}>
                                    {debugEnabled ? '调试中' : '调试日志'}
                                </PinButton>
                                {selectionMode && (
                                    <span className="text-[10px] font-bold px-2.5 py-1 rounded-full" style={{ color: INK_SOFT, background: GRAD_FIELD, border: `1px solid ${HAIRLINE}` }}>
                                        已选 {selectedScripts.length}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="px-3 py-2.5">
                        {scripts.length === 0 ? (
                            <div className="py-7 text-center">
                                <div className="mx-auto mb-2.5 w-14 h-14 rounded-[18px] bg-white p-2" style={{ boxShadow: '0 14px 26px -18px rgba(38,38,38,0.36)' }}>
                                    <div className="w-full h-full rounded-[14px] flex items-center justify-center" style={{ background: GRAD_SOFT, color: AC }}>
                                        <BracketsCurly size={26} weight="thin" />
                                    </div>
                                </div>
                                <div className="text-[13px] font-bold" style={{ color: INK }}>{scope === 'preset' && !preset ? '未选择预设' : '暂无正则'}</div>
                                <p className="mt-1 text-[10px] leading-relaxed" style={{ color: INK_SOFT }}>
                                    {scope === 'preset' && !preset ? '请先选择一个活字盘预设，再管理随预设生效的正则。' : '新建正则或导入 JSON 后，会显示在这里。'}
                                </p>
                            </div>
                        ) : filteredScripts.length === 0 ? (
                            <div className="py-7 text-center">
                                <div className="text-[13px] font-bold" style={{ color: INK }}>没有匹配的正则</div>
                                <p className="mt-1 text-[10px] leading-relaxed" style={{ color: INK_SOFT }}>换个关键词或筛选条件再看。</p>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {filteredScripts.map((script) => {
                                    const disabled = !!script.disabled;
                                    const mode = script.markdownOnly ? '仅显示层' : script.promptOnly ? '仅提示词' : '改写原文';
                                    const riskFlags = riskMap.get(script.id) || [];
                                    return (
                                        <ScriptCard
                                            key={script.id}
                                            script={script}
                                            disabled={disabled}
                                            mode={mode}
                                            selected={selectedSet.has(script.id)}
                                            selectionMode={selectionMode}
                                            riskFlags={riskFlags}
                                            onOpen={() => openEditor(script)}
                                            onSelect={() => toggleScriptSelection(script.id)}
                                            onToggle={() => handleToggle(script)}
                                            onFix={() => handleFixWrapMisconfig(script)}
                                            onDelete={() => handleDelete(script)}
                                        />
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </ToolCard>
            </div>

            <div className="absolute bottom-0 inset-x-0 z-20 px-3 pt-3" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 14px)', background: 'linear-gradient(180deg, transparent, rgba(247,245,242,0.96) 36%, #f7f5f2)' }}>
                <button
                    onClick={handleNewScript}
                    disabled={scope === 'preset' && !preset}
                    className="w-full rounded-full py-3 text-[13px] font-bold active:scale-[0.98] transition-transform"
                    style={{ background: GRAD_MAIN, color: AC_DARK, boxShadow: '0 12px 24px -14px rgba(91,119,113,0.38)' }}
                >
                    <span className="inline-flex items-center gap-1.5"><Plus size={15} weight="bold" /> 新建正则</span>
                </button>
            </div>

            <input ref={importRef} type="file" accept=".json,application/json" className="hidden" onChange={handleImportFile} />

            {importPreview && (
                <div className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center p-3 animate-fade-in">
                    <div className="absolute inset-0" style={{ background: 'rgba(28,26,24,0.42)', backdropFilter: 'blur(4px)' }} onClick={() => setImportPreview(null)} />
                    <div className="relative w-full max-w-md max-h-[86vh] rounded-[26px] bg-white overflow-hidden animate-pop-in" style={{ border: `1px solid ${HAIRLINE}`, boxShadow: '0 30px 70px -34px rgba(38,38,38,0.58)' }}>
                        <div className="px-5 pt-5 pb-3 border-b" style={{ borderColor: HAIRLINE, background: GRAD_SOFT }}>
                            <div className="text-[9px] tracking-[0.32em] uppercase mb-1" style={{ ...LABEL_STACK, color: AC }}>IMPORT PREVIEW</div>
                            <h3 className="text-[18px] font-bold" style={{ color: INK }}>导入前检查</h3>
                            <p className="text-[12px] leading-relaxed mt-1" style={{ color: INK_SOFT }}>
                                {importPreview.preview.total} 条 · 新增 {importPreview.preview.newCount} · 覆盖 {importPreview.preview.overwriteCount} · 风险 {importPreview.preview.riskyCount}
                            </p>
                            {importPreview.preview.duplicateInImportCount > 0 && (
                                <p className="text-[10px] leading-relaxed mt-1" style={{ color: '#7a5b1f' }}>文件内有重复 ID，后导入的同 ID 脚本会覆盖前一条。</p>
                            )}
                            <div className="mt-3 grid grid-cols-2 gap-2">
                                <button
                                    onClick={() => setImportPreview(prev => prev ? { ...prev, safetyMode: 'disabled' } : prev)}
                                    className="rounded-full py-2 text-[12px] font-bold active:scale-95"
                                    style={{ background: importPreview.safetyMode === 'disabled' ? GRAD_MAIN : GRAD_FIELD, color: AC_DARK, border: `1px solid ${importPreview.safetyMode === 'disabled' ? EDGE : HAIRLINE}` }}
                                >
                                    全部停用
                                </button>
                                <button
                                    onClick={() => setImportPreview(prev => prev ? { ...prev, safetyMode: 'original' } : prev)}
                                    className="rounded-full py-2 text-[12px] font-bold active:scale-95"
                                    style={{ background: importPreview.safetyMode === 'original' ? GRAD_MAIN : GRAD_FIELD, color: AC_DARK, border: `1px solid ${importPreview.safetyMode === 'original' ? EDGE : HAIRLINE}` }}
                                >
                                    保持原状态
                                </button>
                            </div>
                        </div>
                        <div className="px-3 py-3 max-h-[48vh] overflow-y-auto no-scrollbar space-y-2">
                            <button
                                onClick={toggleAllImportIndexes}
                                className="w-full rounded-[14px] px-3 py-2 text-left text-[12px] font-bold active:scale-[0.99]"
                                style={{ background: GRAD_FIELD, color: AC_DARK, border: `1px solid ${HAIRLINE}` }}
                            >
                                {importPreview.selectedIndexes.length === importPreview.preview.items.length ? '取消全选' : '全选'} · 已选 {importPreview.selectedIndexes.length}
                            </button>
                            {importPreview.preview.items.map((item, idx) => {
                                const selected = importPreview.selectedIndexes.includes(idx);
                                return (
                                    <button
                                        key={`${item.script.id}-${idx}`}
                                        onClick={() => toggleImportIndex(idx)}
                                        className="w-full rounded-[16px] px-3 py-2.5 text-left active:scale-[0.99]"
                                        style={{ background: selected ? GRAD_SOFT : GRAD_FIELD, border: `1px solid ${selected ? EDGE : HAIRLINE}` }}
                                    >
                                        <div className="flex items-start gap-2.5">
                                            <span className="mt-0.5 w-5 h-5 rounded-full flex items-center justify-center shrink-0" style={{ background: selected ? GRAD_MAIN : PAPER, border: `1px solid ${EDGE}`, color: AC_DARK }}>{selected ? '✓' : ''}</span>
                                            <span className="min-w-0 flex-1">
                                                <span className="block text-[12px] font-bold truncate" style={{ color: INK }}>{item.script.scriptName || '未命名正则'}</span>
                                                <span className="block mt-0.5 text-[10px] font-mono truncate" style={{ color: INK_SOFT }}>{item.script.findRegex || '未填写查找正则'}</span>
                                                <span className="mt-1 flex flex-wrap gap-1.5">
                                                    {item.duplicate && <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: '#fff8ea', color: '#7a5b1f', border: '1px solid rgba(215,166,79,0.30)' }}>覆盖现有</span>}
                                                    {item.duplicateInImport && <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: '#fff8ea', color: '#7a5b1f', border: '1px solid rgba(215,166,79,0.30)' }}>文件内重复</span>}
                                                    {item.riskFlags.map(flag => (
                                                        <span key={flag} className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: '#fff5f7', color: '#d4536f', border: '1px solid #f1c6d1' }}>{flag}</span>
                                                    ))}
                                                </span>
                                            </span>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                        <div className="px-5 py-4 flex gap-2.5 border-t" style={{ borderColor: HAIRLINE }}>
                            <button onClick={() => setImportPreview(null)} className="flex-1 py-3 rounded-full text-[13px] font-bold active:scale-95" style={{ background: PAPER, color: INK_SOFT, border: `1px solid ${HAIRLINE}` }}>取消</button>
                            <button onClick={() => void handleConfirmImport()} className="flex-1 py-3 rounded-full text-[13px] font-bold active:scale-95" style={{ background: GRAD_MAIN, color: AC_DARK }}>导入选中</button>
                        </div>
                    </div>
                </div>
            )}

            {confirmDialog && (
                <div className="fixed inset-0 z-[300] flex items-center justify-center p-5 animate-fade-in">
                    <div className="absolute inset-0" style={{ background: 'rgba(28,26,24,0.42)', backdropFilter: 'blur(4px)' }} onClick={() => setConfirmDialog(null)} />
                    <div className="relative w-full max-w-sm rounded-[26px] bg-white px-6 pt-7 pb-6 text-center animate-pop-in" style={{ border: `1px solid ${HAIRLINE}`, boxShadow: '0 30px 70px -34px rgba(38,38,38,0.58)' }}>
                        <div className="text-[9px] tracking-[0.32em] uppercase mb-1.5" style={{ ...LABEL_STACK, color: AC }}>DELETE REGEX</div>
                        <h3 className="text-[18px] font-bold" style={{ color: INK }}>{confirmDialog.title}</h3>
                        <p className="text-[13px] leading-relaxed mt-3" style={{ color: INK_SOFT }}>{confirmDialog.message}</p>
                        <div className="flex gap-2.5 mt-5">
                            <button onClick={() => setConfirmDialog(null)} className="flex-1 py-3 rounded-full text-[13px] font-bold active:scale-95" style={{ background: PAPER, color: INK_SOFT, border: `1px solid ${HAIRLINE}` }}>取消</button>
                            <button onClick={confirmDialog.onConfirm} className="flex-1 py-3 rounded-full text-[13px] font-bold active:scale-95" style={{ background: '#d4536f', color: '#fff' }}>删除</button>
                        </div>
                    </div>
                </div>
            )}

            {editing && (
                <RegexEditor
                    script={editing}
                    isNew={editingIsNew}
                    userName={userProfile?.name || 'User'}
                    charName={scope === 'scoped' ? (scopedChar?.name || '') : scope === 'preset' ? (preset?.name || 'Preset') : (characters[0]?.name || 'Char')}
                    onChange={setEditing}
                    onSave={() => void handleSaveEditing()}
                    onClose={() => setEditing(null)}
                />
            )}
        </div>
    );
};

export default RegexApp;
