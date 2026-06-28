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
    getGlobalRegexScripts,
    saveGlobalRegexScripts,
    parseRegexImportJson,
    exportRegexScriptsJson,
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

const AC = '#6bb7a8';
const AC_DARK = '#3f756d';
const AC_SOFT = '#e8f5f1';
const AC_WASH = 'rgba(125,199,182,0.44)';
const CANVAS = 'radial-gradient(120% 72% at 50% -18%, rgba(125,199,182,0.42), transparent 62%), linear-gradient(158deg, #fffaf7 0%, #f6faf6 44%, #edf5f8 100%)';
const PAPER = '#ffffff';
const EDGE = 'rgba(63,117,109,0.16)';
const HAIRLINE = 'rgba(43,41,51,0.07)';
const INK = '#2b2933';
const INK_SOFT = '#6f6b76';
const INK_FAINT = '#a6a1ad';
const CARD_SHADOW = '0 1px 2px rgba(38,38,38,0.04), 0 18px 40px -28px rgba(38,38,38,0.32)';
const LABEL_STACK: React.CSSProperties = {
    fontFamily: '"SFMono-Regular", "Roboto Mono", "Courier New", monospace',
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
            background: on ? AC : '#f1f0ec',
            border: `1px solid ${EDGE}`,
            boxShadow: on ? '0 8px 18px -12px rgba(95,175,160,0.48)' : 'inset 0 1px 2px rgba(38,38,38,0.08)',
        }}
    >
        <span className="absolute top-1/2 -translate-y-1/2 text-[8px] font-bold transition-opacity duration-300 pointer-events-none" style={{ ...LABEL_STACK, left: 8, color: 'rgba(255,255,255,0.92)', opacity: on ? 1 : 0 }}>ON</span>
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
        rose: { bg: AC, ink: '#ffffff', edge: AC },
        blue: { bg: '#0ea5e9', ink: '#ffffff', edge: '#0ea5e9' },
        mint: { bg: '#10b981', ink: '#ffffff', edge: '#10b981' },
        gold: { bg: '#f59e0b', ink: '#ffffff', edge: '#f59e0b' },
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
                background: active ? palette.bg : PAPER,
                color: active ? palette.ink : INK_SOFT,
                border: `1px solid ${active ? palette.edge : HAIRLINE}`,
                boxShadow: active ? '0 7px 16px -12px rgba(95,175,160,0.34)' : 'none',
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
            background: active ? AC : PAPER,
            color: active ? '#fff' : INK,
            border: `1px solid ${active ? 'rgba(95,175,160,0.24)' : HAIRLINE}`,
            boxShadow: active ? '0 14px 26px -16px rgba(95,175,160,0.52)' : '0 10px 24px -22px rgba(38,38,38,0.28)',
        }}
    >
        <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-full flex items-center justify-center shrink-0" style={{ background: active ? 'rgba(255,255,255,0.18)' : AC_SOFT, color: active ? '#fff' : AC_DARK }}>
                {icon}
            </span>
            <span className="min-w-0 flex-1 text-[12px] font-bold truncate">{title}</span>
            <span className="text-[15px] font-black tabular-nums leading-none">{count}</span>
        </div>
    </button>
);

const ToolCard: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
    <section
        className={`rounded-[22px] bg-white ${className}`}
        style={{ border: `1px solid ${HAIRLINE}`, boxShadow: CARD_SHADOW }}
    >
        {children}
    </section>
);

const StatTile: React.FC<{ label: string; value: number | string; tone: 'teal' | 'sky' | 'paper' }> = ({ label, value, tone }) => {
    const palette = {
        teal: { bg: AC_SOFT, ink: AC_DARK },
        sky: { bg: '#e6f6fe', ink: '#075985' },
        paper: { bg: '#fff6e8', ink: '#6f4c1c' },
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
                        ? 'linear-gradient(145deg, rgba(232,245,241,0.98), rgba(223,239,246,0.92))'
                        : 'linear-gradient(145deg, #fbfaf8, #eef6f2)',
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
                                background: active ? AC : 'rgba(255,255,255,0.86)',
                                color: active ? '#fff' : AC_DARK,
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
    onOpen: () => void;
    onToggle: () => void;
    onFix: () => void;
    onDelete: () => void;
}> = ({ script, disabled, mode, onOpen, onToggle, onFix, onDelete }) => (
    <div
        onClick={onOpen}
        className="relative cursor-pointer rounded-[16px] px-3 py-2.5 active:scale-[0.99] transition-transform"
        style={{
            background: disabled ? '#f6f5f2' : PAPER,
            border: `1px solid ${HAIRLINE}`,
            boxShadow: '0 10px 24px -22px rgba(38,38,38,0.32)',
            opacity: disabled ? 0.72 : 1,
        }}
    >
        <div className="flex items-start gap-2.5">
            <span className="shrink-0 mt-0.5 w-8 h-8 rounded-[11px] flex items-center justify-center" style={{ background: disabled ? '#eceae6' : AC_SOFT, color: disabled ? '#aaa6a0' : AC_DARK }}>
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
                    </div>
                </div>
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
                const imported = parseRegexImportJson(await file.text());
                const map = new Map(scripts.map(s => [s.id, s]));
                imported.forEach(s => map.set(s.id, s));
                await persist(Array.from(map.values()));
                addToast(`已导入 ${imported.length} 条正则`, 'success');
            } catch (err: any) {
                addToast(`导入失败：${err?.message || '不是有效的 JSON 文件'}`, 'error');
            } finally {
                if (importRef.current) importRef.current.value = '';
            }
        })();
    };

    const handleExport = () => {
        if (scripts.length === 0) { addToast('当前范围没有可导出的正则', 'info'); return; }
        const blob = new Blob([exportRegexScriptsJson(scripts)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = scope === 'global'
            ? 'regex-global.json'
            : scope === 'preset'
                ? `regex-preset-${preset?.name || 'preset'}.json`
                : `regex-${scopedChar?.name || 'scoped'}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        addToast('已导出 JSON', 'success');
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

            <div className="relative z-20 shrink-0 flex items-center gap-3 px-3 py-3" style={{ paddingTop: 'calc(var(--safe-top) + 12px)', background: PAPER, borderBottom: '1px solid #ededed' }}>
                <button
                    onClick={closeApp}
                    className="w-9 h-9 rounded-full bg-white flex items-center justify-center active:scale-90 transition-transform shrink-0"
                    style={{ boxShadow: '0 1px 3px rgba(38,38,38,0.14)', border: `1px solid ${HAIRLINE}`, color: AC_DARK }}
                    aria-label="返回"
                >
                    <CaretLeft size={18} weight="bold" />
                </button>
                <div className="w-9 h-9 rounded-[12px] p-1.5 shrink-0" style={{ background: PAPER, border: `1px solid ${HAIRLINE}` }}>
                    <div className="w-full h-full rounded-[5px] flex items-center justify-center" style={{ background: AC_SOFT, color: AC_DARK }}>
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
                <span className="text-[10px] font-bold select-none shrink-0 px-2.5 py-1 rounded-full" style={{ color: AC_DARK, background: AC_SOFT, border: `1px solid ${EDGE}` }}>已保存</span>
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
                                style={{ background: AC_SOFT, color: AC_DARK, border: `1px solid ${EDGE}`, transform: (scope === 'preset' ? presetSelectorOpen : characterSelectorOpen) ? 'rotate(180deg)' : 'rotate(0deg)' }}
                            >
                                <CaretDown size={15} weight="bold" />
                            </span>
                        </button>

                        {scope === 'preset' && presetSelectorOpen && (
                            <div className="pt-2.5 space-y-2.5">
                                <label className="flex h-12 items-center gap-2 rounded-[18px] px-4" style={{ background: PAPER, border: `1px solid ${HAIRLINE}`, boxShadow: 'inset 0 1px 2px rgba(38,38,38,0.03)' }}>
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
                                            className="w-full h-12 appearance-none rounded-[18px] bg-white pl-4 pr-10 text-[14px] font-extrabold outline-none disabled:opacity-50"
                                            style={{ color: INK, border: `1px solid ${HAIRLINE}`, boxShadow: '0 8px 18px -16px rgba(38,38,38,0.24)' }}
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
                                            background: presetPinned ? '#fff7e6' : PAPER,
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

                <ToolCard>
                    <div className="px-4 pt-3 pb-2.5 border-b" style={{ borderColor: HAIRLINE }}>
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
                        <div className="grid grid-cols-3 gap-2 mt-3">
                            <StatTile label="总数" value={scripts.length} tone="teal" />
                            <StatTile label="启用" value={enabledCount} tone="sky" />
                            <StatTile label="停用" value={scripts.length - enabledCount} tone="paper" />
                        </div>
                    </div>

                    <div className="px-3 py-2.5">
                        {scripts.length === 0 ? (
                            <div className="py-7 text-center">
                                <div className="mx-auto mb-2.5 w-14 h-14 rounded-[18px] bg-white p-2" style={{ boxShadow: '0 14px 26px -18px rgba(38,38,38,0.36)' }}>
                                    <div className="w-full h-full rounded-[14px] flex items-center justify-center" style={{ background: AC_SOFT, color: AC }}>
                                        <BracketsCurly size={26} weight="thin" />
                                    </div>
                                </div>
                                <div className="text-[13px] font-bold" style={{ color: INK }}>{scope === 'preset' && !preset ? '未选择预设' : '暂无正则'}</div>
                                <p className="mt-1 text-[10px] leading-relaxed" style={{ color: INK_SOFT }}>
                                    {scope === 'preset' && !preset ? '请先选择一个活字盘预设，再管理随预设生效的正则。' : '新建正则或导入 JSON 后，会显示在这里。'}
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {scripts.map((script) => {
                                    const disabled = !!script.disabled;
                                    const mode = script.markdownOnly ? '仅显示层' : script.promptOnly ? '仅提示词' : '改写原文';
                                    return (
                                        <ScriptCard
                                            key={script.id}
                                            script={script}
                                            disabled={disabled}
                                            mode={mode}
                                            onOpen={() => openEditor(script)}
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
                    style={{ background: AC, color: '#fff', boxShadow: '0 12px 24px -13px rgba(95,175,160,0.52)' }}
                >
                    <span className="inline-flex items-center gap-1.5"><Plus size={15} weight="bold" /> 新建正则</span>
                </button>
            </div>

            <input ref={importRef} type="file" accept=".json,application/json" className="hidden" onChange={handleImportFile} />

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
