import React, { useMemo, useRef, useState } from 'react';
import { useOS } from '../context/OSContext';
import { RegexScriptData } from '../types';
import {
    PLACEMENT_LABELS,
    createEmptyRegexScript,
} from '../utils/regex/engine';
import {
    getGlobalRegexScripts,
    saveGlobalRegexScripts,
    parseRegexImportJson,
    exportRegexScriptsJson,
} from '../utils/regex/store';
import RegexEditor from '../components/regex/RegexEditor';
import { Bandaids, Needle, TrayArrowDown, TrayArrowUp, X } from '@phosphor-icons/react';

/**
 * 补丁铺（原「正则」App）— SillyTavern Regex 完整移植，黑白拼贴手账风界面。
 *
 * 词汇对照（数据结构 / ST 语义不变，只换了说法）：
 *  - 补丁 = 一条正则脚本（RegexScriptData）；缝补 = 执行替换
 *  - 满铺通用 = 全局作用域（localStorage）；只缝给 TA = 角色作用域（char.regexScripts）
 *  - 线头 = findRegex；缝上去的布 = replaceString；先剪掉的线头 = trimStrings
 *  - 补在哪些布上 = placement；试缝台 = 实时测试
 * 支持导入酒馆正则 JSON（单条 / 数组）、导出、启停、编辑、测试 —— 功能与旧版一致。
 */

// ── 黑白手账设计 token（与剪影集全家同一套语言） ─────────────
const INK = '#1c1b1a';
const STICKER = 'border-2 border-[#1c1b1a] bg-white shadow-[2px_2px_0_#1c1b1a] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all';
const INK_BTN = 'bg-[#1c1b1a] text-[#f7f5ef] border-2 border-[#1c1b1a] shadow-[2px_2px_0_rgba(28,27,26,0.35)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all';
const HAND_CN: React.CSSProperties = { fontFamily: "'Long Cang', 'Caveat', cursive" };
const DOT_BG: React.CSSProperties = {
    backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(28,27,26,0.10) 1px, transparent 0)',
    backgroundSize: '16px 16px',
};

const Tape: React.FC<{ className?: string }> = ({ className }) => (
    <div
        aria-hidden
        className={`pointer-events-none absolute h-5 w-16 bg-white/60 border-x border-dashed border-[#1c1b1a]/30 shadow-sm backdrop-blur-[1px] ${className || ''}`}
    />
);

/** 墨块开关：黑 = 缝着（启用） */
const InkSwitch: React.FC<{ on: boolean; onChange: () => void; title?: string }> = ({ on, onChange, title }) => (
    <button
        onClick={onChange}
        title={title}
        className={`relative w-10 h-5 border-2 border-[#1c1b1a] shrink-0 transition-colors ${on ? 'bg-[#1c1b1a]' : 'bg-white'}`}
    >
        <span className={`absolute top-0 bottom-0 w-4 transition-all ${on ? 'right-0 bg-[#f7f5ef]' : 'left-0 bg-[#1c1b1a]'}`} />
    </button>
);

const RegexApp: React.FC = () => {
    const { closeApp, addToast, characters, updateCharacter, userProfile } = useOS();
    const [scope, setScope] = useState<'global' | 'scoped'>('global');
    const [scopedCharId, setScopedCharId] = useState<string>(characters[0]?.id || '');
    const [globalScripts, setGlobalScripts] = useState<RegexScriptData[]>(() => getGlobalRegexScripts());
    const [editing, setEditing] = useState<RegexScriptData | null>(null);
    const [editingIsNew, setEditingIsNew] = useState(false);
    const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null);
    const importRef = useRef<HTMLInputElement>(null);

    const scopedChar = useMemo(
        () => characters.find(c => c.id === scopedCharId) || null,
        [characters, scopedCharId],
    );
    const scripts: RegexScriptData[] = scope === 'global'
        ? globalScripts
        : (scopedChar?.regexScripts || []);

    const persist = async (next: RegexScriptData[]) => {
        if (scope === 'global') {
            setGlobalScripts(next);
            saveGlobalRegexScripts(next);
        } else if (scopedChar) {
            await updateCharacter(scopedChar.id, { regexScripts: next });
        }
    };

    const handleToggle = (script: RegexScriptData) => {
        void persist(scripts.map(s => s.id === script.id ? { ...s, disabled: !s.disabled } : s));
    };

    const handleDelete = (script: RegexScriptData) => {
        setConfirmDialog({
            title: '拆掉这块补丁？',
            message: `「${script.scriptName || '没名字的补丁'}」拆下来就缝不回去了。`,
            onConfirm: () => {
                void persist(scripts.filter(s => s.id !== script.id));
                setConfirmDialog(null);
                addToast('补丁拆掉了', 'success');
            },
        });
    };

    const handleSaveEditing = async () => {
        if (!editing) return;
        if (!editing.findRegex.trim()) { addToast('还没写要找的线头（查找正则不能为空）', 'error'); return; }
        if (scope === 'scoped' && !scopedChar) { addToast('先挑一位角色再缝', 'error'); return; }
        const named = { ...editing, scriptName: editing.scriptName.trim() || '没名字的补丁' };
        const exists = scripts.some(s => s.id === named.id);
        await persist(exists ? scripts.map(s => s.id === named.id ? named : s) : [...scripts, named]);
        setEditing(null);
        addToast('补丁缝牢了', 'success');
    };

    const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        (async () => {
            try {
                const imported = parseRegexImportJson(await file.text());
                // 同 id 的脚本覆盖（重复导入不堆积），其余追加
                const map = new Map(scripts.map(s => [s.id, s]));
                imported.forEach(s => map.set(s.id, s));
                await persist(Array.from(map.values()));
                addToast(`收进 ${imported.length} 块补丁`, 'success');
            } catch (err: any) {
                addToast(`收不进来：${err?.message || '不是有效的 JSON 文件'}`, 'error');
            } finally {
                if (importRef.current) importRef.current.value = '';
            }
        })();
    };

    const handleExport = () => {
        if (scripts.length === 0) { addToast('这边货架上没有补丁可装箱', 'info'); return; }
        const blob = new Blob([exportRegexScriptsJson(scripts)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = scope === 'global' ? 'regex-global.json' : `regex-${scopedChar?.name || 'scoped'}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        addToast('装箱带走了', 'success');
    };

    return (
        <div className="h-full w-full relative overflow-hidden bg-[#f2f0e9] text-[#1c1b1a] flex flex-col animate-fade-in" style={{ ...DOT_BG, paddingTop: 'var(--safe-top)' }}>
            {/* ── 拆补丁确认（撕边纸卡） ── */}
            {confirmDialog && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-5 animate-fade-in">
                    <div className="absolute inset-0 bg-[#1c1b1a]/45" onClick={() => setConfirmDialog(null)} />
                    <div className="relative w-full max-w-sm bg-[#f7f5ef] border-2 border-[#1c1b1a] shadow-[5px_5px_0_#1c1b1a] rotate-[-0.4deg] animate-slide-up" style={DOT_BG}>
                        <Tape className="-top-2.5 left-1/2 -translate-x-1/2 rotate-[-3deg]" />
                        <button
                            onClick={() => setConfirmDialog(null)}
                            className={`absolute -top-3 -right-3 w-8 h-8 flex items-center justify-center rotate-[4deg] ${STICKER}`}
                            aria-label="合上"
                        >
                            <X size={14} weight="bold" color={INK} />
                        </button>
                        <div className="px-5 pt-6 pb-2">
                            <div className="label-mono text-[9px] text-[#1c1b1a]/45">UNPICK / 不可复原</div>
                            <h3 className="text-lg font-black tracking-wide mt-0.5">{confirmDialog.title}</h3>
                            <div className="h-[3px] w-14 bg-[#1c1b1a] mt-1.5" />
                        </div>
                        <div className="px-5 py-3 text-sm text-[#1c1b1a]/70 leading-relaxed">{confirmDialog.message}</div>
                        <div className="px-5 pb-5 pt-2 flex gap-3">
                            <button onClick={() => setConfirmDialog(null)} className={`flex-1 py-2.5 text-xs font-black ${STICKER}`}>还是留着</button>
                            <button onClick={confirmDialog.onConfirm} className={`flex-1 py-2.5 text-xs font-black ${INK_BTN}`}>拆！</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── 刊头 ── */}
            <div className="relative shrink-0 px-4 pt-3 pb-3 border-b-2 border-dashed border-[#1c1b1a]/30">
                <div className="flex items-center gap-3">
                    <button onClick={closeApp} className={`shrink-0 px-2.5 py-2 rotate-[-2deg] flex items-center gap-1 ${STICKER}`} title="打烊关门">
                        <svg viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth={2.5} className="w-3.5 h-3.5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
                        </svg>
                        <span className="text-[10px] font-black">打烊</span>
                    </button>
                    <div className="flex-1 min-w-0 relative">
                        <Tape className="-top-4 left-8 rotate-[-5deg] w-12" />
                        <div className="label-mono text-[8px] text-[#1c1b1a]/45">PATCH SHOP — REGEX TAILORING</div>
                        <div className="flex items-baseline gap-2">
                            <h1 className="text-2xl font-black tracking-[0.08em]">补丁铺</h1>
                            <span className="text-sm text-[#1c1b1a]/55 truncate" style={HAND_CN}>哪句话不顺眼，剪下来缝块补丁</span>
                        </div>
                    </div>
                    <div className="shrink-0 w-12 h-12 rounded-full border-2 border-dashed border-[#1c1b1a]/60 flex flex-col items-center justify-center rotate-[6deg] select-none">
                        <span className="text-base font-black leading-none">{scripts.length}</span>
                        <span className="label-mono text-[7px] text-[#1c1b1a]/55 leading-none mt-0.5">块</span>
                    </div>
                </div>
            </div>

            {/* ── 货架（作用域切换） ── */}
            <div className="px-4 pt-4 shrink-0 space-y-2">
                <div className="flex gap-2">
                    <button onClick={() => setScope('global')}
                        className={`flex-1 py-2 text-[10px] font-black border-2 border-[#1c1b1a] transition-all rotate-[-0.5deg] ${scope === 'global' ? 'bg-[#1c1b1a] text-[#f7f5ef] shadow-[2px_2px_0_rgba(28,27,26,0.35)]' : 'bg-white shadow-[2px_2px_0_#1c1b1a]'}`}>
                        满铺通用（全局）
                    </button>
                    <button onClick={() => setScope('scoped')}
                        className={`flex-1 py-2 text-[10px] font-black border-2 border-[#1c1b1a] transition-all rotate-[0.5deg] ${scope === 'scoped' ? 'bg-[#1c1b1a] text-[#f7f5ef] shadow-[2px_2px_0_rgba(28,27,26,0.35)]' : 'bg-white shadow-[2px_2px_0_#1c1b1a]'}`}>
                        只缝给 TA（角色）
                    </button>
                </div>
                {scope === 'scoped' && (
                    <div className="relative">
                        <select value={scopedCharId} onChange={e => setScopedCharId(e.target.value)}
                            className="w-full appearance-none px-3 py-2 bg-white border-2 border-[#1c1b1a]/60 text-xs font-bold outline-none focus:border-[#1c1b1a]">
                            {characters.length === 0 && <option value="">（名册上还没有人）</option>}
                            {characters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                        <span aria-hidden className="absolute right-3 top-1/2 -translate-y-1/2 text-xs pointer-events-none">▾</span>
                    </div>
                )}
                <p className="text-[12px] text-[#1c1b1a]/55 leading-relaxed px-1" style={HAND_CN}>
                    {scope === 'global'
                        ? '✎ 满铺通用的补丁缝在所有角色的聊天上。酒馆（SillyTavern）的正则 JSON 可以直接收进来。'
                        : '✎ 这排货架上的补丁只缝给选中的这位。收 SillyTavern 角色卡时，卡里自带的正则（extensions.regex_scripts）会自动摆到这里。'}
                </p>
            </div>

            {/* ── 补丁货架 ── */}
            <div className="flex-1 overflow-y-auto no-scrollbar px-4 py-3 space-y-3 pb-28">
                {scripts.length === 0 && (
                    <div className="relative bg-[#fbfaf6] border-2 border-[#1c1b1a] shadow-[4px_4px_0_#1c1b1a] p-6 mt-4 rotate-[-0.6deg] text-center space-y-2">
                        <Tape className="-top-2.5 left-1/2 -translate-x-1/2 rotate-[2deg]" />
                        <Bandaids size={32} weight="bold" className="mx-auto text-[#1c1b1a]/40" />
                        <p className="text-lg" style={HAND_CN}>这排货架还空着。</p>
                        <p className="text-xs text-[#1c1b1a]/55 leading-relaxed">点右下角的缝针缝一块新的，或者把酒馆正则 JSON 收进来。</p>
                    </div>
                )}
                {scripts.map((script, i) => (
                    <div key={script.id}
                        className={`relative bg-white border-2 px-3.5 py-3 transition-all ${i % 2 === 0 ? 'rotate-[-0.3deg]' : 'rotate-[0.3deg]'} ${script.disabled ? 'opacity-45 border-dashed border-[#1c1b1a]/40' : 'border-[#1c1b1a]/45 shadow-sm'}`}>
                        {/* 补丁角的缝线 */}
                        <span aria-hidden className="absolute -top-1 -left-1 w-2.5 h-2.5 border-t-2 border-l-2 border-[#1c1b1a]/60" />
                        <span aria-hidden className="absolute -bottom-1 -right-1 w-2.5 h-2.5 border-b-2 border-r-2 border-[#1c1b1a]/60" />
                        <div className="flex items-center gap-2">
                            <button onClick={() => { setEditing({ ...script, trimStrings: [...script.trimStrings], placement: [...script.placement] }); setEditingIsNew(false); }}
                                className="flex-1 min-w-0 text-left">
                                <div className={`text-sm font-black truncate ${script.disabled ? 'line-through decoration-2' : ''}`}>{script.scriptName || '没名字的补丁'}</div>
                                <div className="label-mono text-[9px] text-[#1c1b1a]/45 truncate mt-0.5">{script.findRegex}</div>
                            </button>
                            <InkSwitch on={!script.disabled} onChange={() => handleToggle(script)} title={script.disabled ? '这块补丁先拆线放着（点击缝上）' : '缝着呢（点击拆线放着）'} />
                            <button onClick={() => handleDelete(script)}
                                className="shrink-0 p-1.5 rotate-[2deg] border-2 border-[#1c1b1a]/30 bg-white text-[#1c1b1a]/40 hover:border-[#1c1b1a] hover:text-[#1c1b1a] active:scale-90 transition-all"
                                title="拆掉这块补丁">
                                <X size={12} weight="bold" />
                            </button>
                        </div>
                        <div className="flex flex-wrap gap-1 mt-2">
                            {script.placement.map(p => PLACEMENT_LABELS[p] && (
                                <span key={p} className="label-mono text-[8px] px-1.5 py-0.5 border border-[#1c1b1a]/40 text-[#1c1b1a]/60">{PLACEMENT_LABELS[p]}</span>
                            ))}
                            {script.markdownOnly && <span className="label-mono text-[8px] px-1.5 py-0.5 bg-[#1c1b1a] text-[#f7f5ef] rotate-[-1deg]">只改表面</span>}
                            {script.promptOnly && <span className="label-mono text-[8px] px-1.5 py-0.5 bg-[#1c1b1a] text-[#f7f5ef] rotate-[1deg]">只改寄出的信</span>}
                            {(typeof script.minDepth === 'number' || typeof script.maxDepth === 'number') && (
                                <span className="label-mono text-[8px] px-1.5 py-0.5 border border-[#1c1b1a]/40 text-[#1c1b1a]/60">
                                    深度 {script.minDepth ?? '∞'}~{script.maxDepth ?? '∞'}
                                </span>
                            )}
                        </div>
                    </div>
                ))}

                {/* 收进 / 装箱：移到列表底部的装订台（原右上角按钮） */}
                <div className="relative border-2 border-[#1c1b1a]/45 bg-white/55 p-3 rotate-[0.3deg] mt-4">
                    <span className="absolute -top-2 left-3 px-1.5 bg-[#f2f0e9] label-mono text-[8px] text-[#1c1b1a]/50">CRATE / 进出货</span>
                    <div className="flex items-center gap-2">
                        <button onClick={() => importRef.current?.click()}
                            className={`flex-1 py-2 text-[10px] font-black flex items-center justify-center gap-1.5 ${STICKER}`}
                            title="把酒馆正则 JSON 收进这排货架">
                            <TrayArrowDown size={13} weight="bold" /> 收一箱补丁
                        </button>
                        <button onClick={handleExport}
                            className={`flex-1 py-2 text-[10px] font-black flex items-center justify-center gap-1.5 ${STICKER}`}
                            title="把这排货架的补丁打包成 JSON 带走">
                            <TrayArrowUp size={13} weight="bold" /> 装箱带走
                        </button>
                        <input ref={importRef} type="file" accept=".json,application/json" className="hidden" onChange={handleImportFile} />
                    </div>
                </div>
            </div>

            {/* ── 缝一块新的：右下角缝针贴纸 ── */}
            <button
                onClick={() => {
                    if (scope === 'scoped' && !scopedChar) { addToast('先挑一位角色再缝', 'error'); return; }
                    setEditing(createEmptyRegexScript());
                    setEditingIsNew(true);
                }}
                className="absolute bottom-7 right-5 z-20 px-4 py-3 rotate-[-3deg] flex items-center gap-1.5 bg-[#1c1b1a] text-[#f7f5ef] border-2 border-[#1c1b1a] shadow-[3px_3px_0_rgba(28,27,26,0.35)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all">
                <Needle size={16} weight="bold" />
                <span className="text-xs font-black">缝一块</span>
            </button>

            {/* ── 缝纫台（编辑器） ── */}
            {editing && (
                <RegexEditor
                    script={editing}
                    isNew={editingIsNew}
                    userName={userProfile?.name || 'User'}
                    charName={scope === 'scoped' ? (scopedChar?.name || '') : (characters[0]?.name || 'Char')}
                    onChange={setEditing}
                    onSave={() => void handleSaveEditing()}
                    onClose={() => setEditing(null)}
                />
            )}
        </div>
    );
};

export default RegexApp;
