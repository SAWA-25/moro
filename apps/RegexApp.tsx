import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useOS } from '../context/OSContext';
import { RegexScriptData, TavernPreset } from '../types';
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
import { PAPER_TONES, MONO_STACK, CUTE_STACK } from '../components/handbook/paper';
import {
    BracketsCurly,
    DownloadSimple,
    Globe,
    Plus,
    SlidersHorizontal,
    Trash,
    UploadSimple,
    UserCircle,
    WarningCircle,
} from '@phosphor-icons/react';

const ROSE = '#d8a5b7';
const EDGE = '#eed6df';

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
            background: on ? ROSE : '#f8f4f6',
            border: `1px solid ${EDGE}`,
            boxShadow: on ? '0 8px 16px -12px rgba(122,90,114,0.42)' : 'inset 0 1px 2px rgba(122,90,114,0.08)',
        }}
    >
        <span className="absolute top-1/2 -translate-y-1/2 text-[8px] font-bold transition-opacity duration-300 pointer-events-none" style={{ ...MONO_STACK, left: 8, color: 'rgba(255,255,255,0.92)', opacity: on ? 1 : 0 }}>ON</span>
        <span className="absolute top-1/2 -translate-y-1/2 text-[8px] font-bold transition-opacity duration-300 pointer-events-none" style={{ ...MONO_STACK, right: 7, color: '#d8c2cd', opacity: on ? 0 : 1 }}>off</span>
        <span
            className="absolute top-1/2 -translate-y-1/2 w-[22px] h-[22px] rounded-full bg-white transition-all duration-300"
            style={{ left: on ? 27 : 3, boxShadow: '0 2px 6px rgba(122,90,114,0.24)' }}
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
        rose: { bg: '#fff4f7', ink: '#5a3140', edge: EDGE },
        blue: { bg: '#f1f6fa', ink: '#4c6f82', edge: '#d8e6ee' },
        mint: { bg: '#f6fbf8', ink: '#5f7f6d', edge: '#dbe9e2' },
        gold: { bg: '#fff9df', ink: '#8a6a19', edge: '#eee2a7' },
        plain: { bg: '#fffdfa', ink: '#7a5a72', edge: EDGE },
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
                background: active ? palette.bg : '#fffdfa',
                color: active ? palette.ink : '#a892a3',
                border: `1px solid ${active ? palette.edge : EDGE}`,
                boxShadow: active ? '0 6px 14px -12px rgba(122,90,114,0.35)' : 'none',
                ...CUTE_STACK,
            }}
        >
            {children}
        </button>
    );
};

const PinButton: React.FC<{ onClick: () => void; children: React.ReactNode; disabled?: boolean; tone?: 'rose' | 'mint' | 'danger' }> = ({ onClick, children, disabled, tone = 'rose' }) => {
    const styles: Record<string, React.CSSProperties> = {
        rose: { background: '#fffdfa', border: `1px solid ${EDGE}`, color: '#9c5e74', boxShadow: '0 1px 2px rgba(122,90,114,0.10)' },
        mint: { background: '#f6fbf8', border: '1px solid #dbe9e2', color: '#5f7f6d', boxShadow: '0 1px 2px rgba(122,90,114,0.08)' },
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
            style={{ ...styles[tone], ...CUTE_STACK }}
        >
            {children}
        </button>
    );
};

const Page: React.FC<{ title: string; en: string; children: React.ReactNode }> = ({ title, en, children }) => (
    <section className="relative rounded-[18px] bg-white" style={{ border: '1px solid #ededed', boxShadow: '0 1px 2px rgba(38,38,38,0.04), 0 14px 30px -24px rgba(38,38,38,0.22)' }}>
        <div className="flex items-center justify-between gap-2 px-4 pt-3.5 pb-1">
            <span className="text-[15px] font-bold leading-tight" style={{ color: PAPER_TONES.ink }}>{title}</span>
            <span className="text-[8.5px] tracking-[0.22em] uppercase select-none shrink-0" style={{ ...MONO_STACK, color: PAPER_TONES.inkFaint }}>{en}</span>
        </div>
        <div className="px-4 pb-5 pt-1">{children}</div>
    </section>
);

const Entry: React.FC<{ mark?: string; title: string; note?: string; side?: React.ReactNode; children?: React.ReactNode; onClick?: () => void }> = ({ mark = '✿', title, note, side, children, onClick }) => (
    <div
        onClick={onClick}
        className={`py-3 border-b last:border-b-0 ${onClick ? 'cursor-pointer active:scale-[0.99] transition-transform' : ''}`}
        style={{ borderColor: 'rgba(216,165,183,0.35)' }}
    >
        <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                    <span className="text-[11px] leading-none" style={{ color: PAPER_TONES.accentBlush }}>{mark}</span>
                    <span className="text-[12.5px] font-bold" style={{ ...CUTE_STACK, color: PAPER_TONES.ink }}>{title}</span>
                </div>
                {note && <p className="text-[10px] mt-1 leading-relaxed" style={{ color: PAPER_TONES.inkSoft }}>{note}</p>}
            </div>
            {side && <div className="shrink-0 pt-0.5">{side}</div>}
        </div>
        {children && <div className="mt-2.5">{children}</div>}
    </div>
);

const ScopeCard: React.FC<{
    active: boolean;
    icon: React.ReactNode;
    title: string;
    note: string;
    onClick: () => void;
}> = ({ active, icon, title, note, onClick }) => (
    <button
        onClick={onClick}
        className="flex-1 min-w-0 text-left rounded-[16px] p-3 active:scale-[0.98] transition-transform"
        style={{
            background: active ? '#fff4f7' : '#fffdfa',
            border: `1px solid ${active ? ROSE : EDGE}`,
            boxShadow: active ? '0 10px 18px -16px rgba(122,90,114,0.38)' : 'none',
        }}
    >
        <div className="flex items-center gap-2">
            <span style={{ color: active ? '#9c5e74' : PAPER_TONES.inkFaint }}>{icon}</span>
            <span className="text-[12px] font-bold truncate" style={{ ...CUTE_STACK, color: active ? '#5a3140' : PAPER_TONES.ink }}>{title}</span>
        </div>
        <div className="mt-1 text-[9.5px] leading-snug" style={{ color: PAPER_TONES.inkSoft }}>{note}</div>
    </button>
);

const RegexApp: React.FC = () => {
    const { closeApp, addToast, characters, updateCharacter, userProfile } = useOS();
    const [scope, setScope] = useState<'global' | 'preset' | 'scoped'>('global');
    const [scopedCharId, setScopedCharId] = useState<string>(characters[0]?.id || '');
    const [globalScripts, setGlobalScripts] = useState<RegexScriptData[]>(() => getGlobalRegexScripts());
    const [presets, setPresets] = useState<TavernPreset[]>([]);
    const [presetId, setPresetId] = useState<string>(PresetRuntime.getActiveId() || '');
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

    const openEditor = (script: RegexScriptData) => {
        setEditing({ ...script, trimStrings: [...script.trimStrings], placement: [...script.placement] });
        setEditingIsNew(false);
    };

    const handleToggle = (script: RegexScriptData) => {
        void persist(scripts.map(s => s.id === script.id ? { ...s, disabled: !s.disabled } : s));
    };

    const handleFixWrapMisconfig = (script: RegexScriptData) => {
        if (!window.confirm(`将「${script.scriptName || '未命名脚本'}」设置为仅提示词模式？\n\n启用后，它只会改写发送给 LLM 的提示词，不会改动聊天原文或气泡显示。`)) return;
        void persist(scripts.map(s => s.id === script.id ? { ...s, promptOnly: true } : s));
        addToast('已设置为仅提示词模式', 'success');
    };

    const handleDelete = (script: RegexScriptData) => {
        setConfirmDialog({
            title: '删除正则脚本？',
            message: `「${script.scriptName || '未命名脚本'}」删除后无法恢复。`,
            onConfirm: () => {
                void persist(scripts.filter(s => s.id !== script.id));
                setConfirmDialog(null);
                addToast('已删除正则脚本', 'success');
            },
        });
    };

    const handleSaveEditing = async () => {
        if (!editing) return;
        if (!editing.findRegex.trim()) { addToast('查找正则不能为空', 'error'); return; }
        if (scope === 'scoped' && !scopedChar) { addToast('请先选择角色', 'error'); return; }
        if (scope === 'preset' && !preset) { addToast('请先选择预设', 'error'); return; }
        const named = { ...editing, scriptName: editing.scriptName.trim() || '未命名脚本' };
        const exists = scripts.some(s => s.id === named.id);
        await persist(exists ? scripts.map(s => s.id === named.id ? named : s) : [...scripts, named]);
        setEditing(null);
        addToast('已保存正则脚本', 'success');
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
                addToast(`已导入 ${imported.length} 条正则脚本`, 'success');
            } catch (err: any) {
                addToast(`导入失败：${err?.message || '不是有效的 JSON 文件'}`, 'error');
            } finally {
                if (importRef.current) importRef.current.value = '';
            }
        })();
    };

    const handleExport = () => {
        if (scripts.length === 0) { addToast('当前范围没有可导出的脚本', 'info'); return; }
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
            className="absolute inset-0 z-[260] flex flex-col animate-fade-in"
            style={{ paddingTop: 'var(--safe-top)', backgroundColor: '#fafafa' }}
        >
            <div className="shrink-0 flex items-center gap-3 px-3 py-3" style={{ background: '#ffffff', borderBottom: '1px solid #ededed' }}>
                <button
                    onClick={closeApp}
                    className="w-9 h-9 rounded-full bg-white flex items-center justify-center active:scale-90 transition-transform shrink-0"
                    style={{ boxShadow: '0 1px 3px rgba(122,90,114,0.18)', border: '1px solid #ededed' }}
                    aria-label="返回"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.2} stroke="#9c5e74" className="w-[18px] h-[18px]">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                    </svg>
                </button>
                <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                        <span className="text-[16px] font-bold leading-tight" style={{ color: '#5a3140' }}>补丁铺</span>
                        <span className="text-[8.5px] tracking-[0.24em] select-none" style={{ ...MONO_STACK, color: '#b07a8d' }}>REGEX SETTINGS</span>
                    </div>
                    <div className="text-[10px] truncate mt-0.5" style={{ color: '#a96f84' }}>
                        {scope === 'global' ? '全局脚本' : scope === 'preset' ? (preset?.name || '预设脚本') : scopedChar?.name || '角色脚本'} · 更改会自动保存
                    </div>
                </div>
                <span className="text-[10px] select-none shrink-0 px-2 py-1 rounded-full" style={{ color: '#a96f84', background: '#fff4f7', border: `1px solid ${EDGE}` }}>已保存</span>
            </div>

            <div className="flex-1 overflow-y-auto no-scrollbar px-3 pt-6 pb-28 space-y-8">
                <Page title="作用范围" en="Scope">
                    <Entry mark="♡" title="脚本应用到哪里" note="全局脚本作用于所有聊天；预设脚本只随当前预设启用；角色脚本只作用于选中的角色。">
                        <div className="flex gap-2">
                            <ScopeCard
                                active={scope === 'global'}
                                icon={<Globe size={17} weight="bold" />}
                                title="全局脚本"
                                note="所有角色聊天"
                                onClick={() => setScope('global')}
                            />
                            <ScopeCard
                                active={scope === 'preset'}
                                icon={<SlidersHorizontal size={17} weight="bold" />}
                                title="预设脚本"
                                note="随活字盘预设"
                                onClick={() => setScope('preset')}
                            />
                            <ScopeCard
                                active={scope === 'scoped'}
                                icon={<UserCircle size={17} weight="bold" />}
                                title="角色脚本"
                                note="只对一位角色"
                                onClick={() => setScope('scoped')}
                            />
                        </div>
                    </Entry>

                    {scope === 'preset' && (
                        <Entry mark="♡" title="选择预设" note="这里管理 SillyTavern PRESET 作用域正则；只有活字盘启用且选中该预设时生效。">
                            <div className="flex flex-wrap gap-2">
                                {presets.map(p => (
                                    <StickerChip
                                        key={p.id}
                                        active={presetId === p.id}
                                        onClick={() => setPresetId(p.id)}
                                        tone="blue"
                                    >
                                        {p.name}
                                    </StickerChip>
                                ))}
                                {presets.length === 0 && <span className="text-[10px]" style={{ color: PAPER_TONES.inkFaint }}>暂无预设，请先到活字盘新建或导入。</span>}
                            </div>
                        </Entry>
                    )}

                    {scope === 'scoped' && (
                        <Entry mark="♡" title="选择角色" note="随 SillyTavern 角色卡导入的正则，也会出现在对应角色这里。">
                            <div className="flex flex-wrap gap-2">
                                {characters.map(c => (
                                    <StickerChip
                                        key={c.id}
                                        active={scopedCharId === c.id}
                                        onClick={() => setScopedCharId(c.id)}
                                        tone="rose"
                                    >
                                        {c.name}
                                    </StickerChip>
                                ))}
                                {characters.length === 0 && <span className="text-[10px]" style={{ color: PAPER_TONES.inkFaint }}>暂无角色</span>}
                            </div>
                        </Entry>
                    )}
                </Page>

                <Page title="脚本概览" en="Summary">
                    <div className="grid grid-cols-3 gap-2 py-3 border-b" style={{ borderColor: 'rgba(216,165,183,0.35)' }}>
                        {[
                            ['总数', scripts.length],
                            ['启用', enabledCount],
                            ['停用', scripts.length - enabledCount],
                        ].map(([label, value]) => (
                            <div key={label} className="rounded-[14px] px-3 py-2.5 text-center" style={{ background: '#fffdfa', border: `1px solid ${EDGE}` }}>
                                <div className="text-[18px] font-bold tabular-nums" style={{ color: '#5a3140' }}>{value}</div>
                                <div className="text-[9px] mt-0.5" style={{ ...MONO_STACK, color: PAPER_TONES.inkFaint }}>{label}</div>
                            </div>
                        ))}
                    </div>

                    <Entry
                        mark="✦"
                        title="导入 / 导出"
                        note="支持 SillyTavern Regex JSON。导入时同 id 脚本会覆盖，避免重复堆积。"
                    >
                        <div className="flex gap-2">
                            <PinButton onClick={() => importRef.current?.click()} tone="mint">
                                <span className="inline-flex items-center gap-1"><UploadSimple size={13} weight="bold" />导入 JSON</span>
                            </PinButton>
                            <PinButton onClick={handleExport}>
                                <span className="inline-flex items-center gap-1"><DownloadSimple size={13} weight="bold" />导出 JSON</span>
                            </PinButton>
                        </div>
                    </Entry>
                </Page>

                <Page title="正则脚本" en="Scripts">
                    {scripts.length === 0 ? (
                        <div className="py-8 text-center">
                            <BracketsCurly size={36} weight="thin" className="mx-auto mb-3" style={{ color: PAPER_TONES.inkFaint }} />
                            <div className="text-[13px] font-bold" style={{ color: PAPER_TONES.ink }}>{scope === 'preset' && !preset ? '未选择预设' : '暂无正则脚本'}</div>
                            <p className="mt-1 text-[10px] leading-relaxed" style={{ color: PAPER_TONES.inkSoft }}>
                                {scope === 'preset' && !preset ? '请先选择一个活字盘预设，再管理随预设生效的正则脚本。' : '新建脚本或导入 JSON 后，会显示在这里。'}
                            </p>
                        </div>
                    ) : (
                        scripts.map((script) => {
                            const disabled = !!script.disabled;
                            const mode = script.markdownOnly ? '仅显示层' : script.promptOnly ? '仅提示词' : '改写原文';
                            return (
                                <Entry
                                    key={script.id}
                                    mark={disabled ? '○' : '✿'}
                                    title={script.scriptName || '未命名脚本'}
                                    note={script.findRegex || '未填写查找正则'}
                                    onClick={() => openEditor(script)}
                                    side={<CandyToggle on={!disabled} onToggle={() => handleToggle(script)} />}
                                >
                                    <div className="flex flex-wrap gap-2">
                                        <StickerChip active tone={script.promptOnly ? 'gold' : script.markdownOnly ? 'blue' : 'rose'}>{mode}</StickerChip>
                                        {script.placement.map(p => PLACEMENT_LABELS[p] && (
                                            <StickerChip key={p} active={false} tone="plain">{PLACEMENT_LABELS[p]}</StickerChip>
                                        ))}
                                        {(typeof script.minDepth === 'number' || typeof script.maxDepth === 'number') && (
                                            <StickerChip active={false} tone="mint">深度 {script.minDepth ?? '∞'}~{script.maxDepth ?? '∞'}</StickerChip>
                                        )}
                                    </div>
                                    <div className="mt-2.5 flex items-center gap-2">
                                        {looksLikeWrapMisconfig(script) && (
                                            <PinButton onClick={() => handleFixWrapMisconfig(script)} tone="mint">
                                                <span className="inline-flex items-center gap-1"><WarningCircle size={13} weight="fill" />改为仅提示词</span>
                                            </PinButton>
                                        )}
                                        <PinButton onClick={() => handleDelete(script)} tone="danger">
                                            <span className="inline-flex items-center gap-1"><Trash size={13} weight="bold" />删除</span>
                                        </PinButton>
                                    </div>
                                </Entry>
                            );
                        })
                    )}
                </Page>
            </div>

            <div className="absolute bottom-0 inset-x-0 z-20 px-3 pt-3" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 14px)', background: 'linear-gradient(180deg, transparent, rgba(250,250,250,0.96) 36%, #fafafa)' }}>
                <button
                    onClick={handleNewScript}
                    disabled={scope === 'preset' && !preset}
                    className="w-full rounded-full py-3 text-[13px] font-bold active:scale-[0.98] transition-transform"
                    style={{ background: ROSE, color: '#fff', boxShadow: '0 10px 22px -14px rgba(122,90,114,0.45)', ...CUTE_STACK }}
                >
                    <span className="inline-flex items-center gap-1.5"><Plus size={15} weight="bold" /> 新建正则脚本</span>
                </button>
            </div>

            <input ref={importRef} type="file" accept=".json,application/json" className="hidden" onChange={handleImportFile} />

            {confirmDialog && (
                <div className="fixed inset-0 z-[300] flex items-center justify-center p-5 animate-fade-in">
                    <div className="absolute inset-0" style={{ background: 'rgba(28,26,24,0.42)', backdropFilter: 'blur(4px)' }} onClick={() => setConfirmDialog(null)} />
                    <div className="relative w-full max-w-sm rounded-[26px] bg-white px-6 pt-7 pb-6 text-center animate-pop-in" style={{ border: `1px solid ${EDGE}`, boxShadow: '0 30px 70px -34px rgba(38,38,38,0.58)' }}>
                        <div className="text-[9px] tracking-[0.32em] uppercase mb-1.5" style={{ ...MONO_STACK, color: ROSE }}>DELETE SCRIPT</div>
                        <h3 className="text-[18px] font-bold" style={{ color: '#5a3140' }}>{confirmDialog.title}</h3>
                        <p className="text-[13px] leading-relaxed mt-3" style={{ color: PAPER_TONES.inkSoft }}>{confirmDialog.message}</p>
                        <div className="flex gap-2.5 mt-5">
                            <button onClick={() => setConfirmDialog(null)} className="flex-1 py-3 rounded-full text-[13px] font-bold active:scale-95" style={{ background: '#fffdfa', color: PAPER_TONES.inkSoft, border: `1px solid ${EDGE}` }}>取消</button>
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
