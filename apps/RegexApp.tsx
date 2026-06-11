import React, { useMemo, useRef, useState } from 'react';
import { useOS } from '../context/OSContext';
import { RegexScriptData } from '../types';
import {
    regex_placement,
    substitute_find_regex,
    PLACEMENT_LABELS,
    createEmptyRegexScript,
    runRegexScript,
} from '../utils/regex/engine';
import {
    getGlobalRegexScripts,
    saveGlobalRegexScripts,
    parseRegexImportJson,
    exportRegexScriptsJson,
} from '../utils/regex/store';
import ConfirmDialog from '../components/os/ConfirmDialog';

/**
 * 正则 App — SillyTavern Regex 完整移植。
 *
 * 两个作用域（同 ST GLOBAL / SCOPED）：
 * - 全局：对所有角色生效，存 localStorage
 * - 角色：仅对选中角色生效，存 char.regexScripts（角色卡 extensions.regex_scripts 随卡导入到这里）
 * 支持导入酒馆正则 JSON（单条 / 数组）、导出、启停、编辑、测试。
 */

const PLACEMENT_OPTIONS = [
    regex_placement.USER_INPUT,
    regex_placement.AI_OUTPUT,
    regex_placement.SLASH_COMMAND,
    regex_placement.WORLD_INFO,
    regex_placement.REASONING,
];

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
            title: '删除正则脚本',
            message: `确定删除「${script.scriptName || '未命名正则'}」吗？此操作不可撤销。`,
            onConfirm: () => {
                void persist(scripts.filter(s => s.id !== script.id));
                setConfirmDialog(null);
                addToast('已删除', 'success');
            },
        });
    };

    const handleSaveEditing = async () => {
        if (!editing) return;
        if (!editing.findRegex.trim()) { addToast('查找正则不能为空', 'error'); return; }
        if (scope === 'scoped' && !scopedChar) { addToast('请先选择角色', 'error'); return; }
        const named = { ...editing, scriptName: editing.scriptName.trim() || '未命名正则' };
        const exists = scripts.some(s => s.id === named.id);
        await persist(exists ? scripts.map(s => s.id === named.id ? named : s) : [...scripts, named]);
        setEditing(null);
        addToast('已保存', 'success');
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
                addToast(`导入 ${imported.length} 条正则脚本`, 'success');
            } catch (err: any) {
                addToast(`导入失败：${err?.message || '无效的 JSON 文件'}`, 'error');
            } finally {
                if (importRef.current) importRef.current.value = '';
            }
        })();
    };

    const handleExport = () => {
        if (scripts.length === 0) { addToast('当前作用域没有脚本可导出', 'info'); return; }
        const blob = new Blob([exportRegexScriptsJson(scripts)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = scope === 'global' ? 'regex-global.json' : `regex-${scopedChar?.name || 'scoped'}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        addToast('已导出', 'success');
    };

    return (
        <div className="h-full w-full bg-slate-50 flex flex-col font-light relative">
            <ConfirmDialog
                isOpen={!!confirmDialog}
                title={confirmDialog?.title || ''}
                message={confirmDialog?.message || ''}
                variant="danger"
                confirmText="删除"
                onConfirm={confirmDialog?.onConfirm || (() => setConfirmDialog(null))}
                onCancel={() => setConfirmDialog(null)}
            />

            {/* Header */}
            <div className="h-14 bg-white/80 backdrop-blur-xl flex items-center px-4 border-b border-slate-100/60 shrink-0 z-10">
                <button onClick={closeApp} className="p-2 -ml-2 rounded-full hover:bg-black/5 active:scale-90 transition-transform">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-slate-600">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                    </svg>
                </button>
                <h1 className="text-lg font-semibold text-slate-800 ml-2 tracking-tight">正则</h1>
                <span className="text-xs text-slate-400 ml-2 font-mono">{scripts.length}</span>
                <div className="flex-1" />
                <button onClick={() => importRef.current?.click()}
                    className="px-3 py-1.5 text-xs font-bold text-violet-600 bg-violet-50 rounded-full active:scale-95 transition-transform">
                    导入
                </button>
                <button onClick={handleExport}
                    className="ml-2 px-3 py-1.5 text-xs font-bold text-slate-500 bg-slate-100 rounded-full active:scale-95 transition-transform">
                    导出
                </button>
                <input ref={importRef} type="file" accept=".json,application/json" className="hidden" onChange={handleImportFile} />
            </div>

            {/* 作用域切换 */}
            <div className="px-4 pt-3 shrink-0 space-y-2">
                <div className="flex bg-slate-200/70 rounded-xl p-1 text-[13px] font-medium">
                    <button onClick={() => setScope('global')}
                        className={`flex-1 py-1.5 rounded-lg transition-all ${scope === 'global' ? 'bg-white shadow text-slate-800' : 'text-slate-500'}`}>
                        全局
                    </button>
                    <button onClick={() => setScope('scoped')}
                        className={`flex-1 py-1.5 rounded-lg transition-all ${scope === 'scoped' ? 'bg-white shadow text-slate-800' : 'text-slate-500'}`}>
                        角色
                    </button>
                </div>
                {scope === 'scoped' && (
                    <select value={scopedCharId} onChange={e => setScopedCharId(e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm text-slate-700 outline-none">
                        {characters.length === 0 && <option value="">（还没有角色）</option>}
                        {characters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                )}
                <p className="text-[11px] text-slate-400 leading-relaxed px-1">
                    {scope === 'global'
                        ? '全局脚本对所有角色的聊天生效。支持直接导入 SillyTavern 正则 JSON。'
                        : '角色脚本仅对该角色生效。导入 SillyTavern 角色卡时，卡内自带的正则（extensions.regex_scripts）会自动同步到这里。'}
                </p>
            </div>

            {/* 脚本列表 */}
            <div className="flex-1 overflow-y-auto no-scrollbar px-4 py-3 space-y-2.5 pb-24">
                {scripts.length === 0 && (
                    <div className="text-center text-slate-300 text-sm pt-16">
                        还没有正则脚本<br />
                        <span className="text-[11px]">点右下角 + 新建，或右上角导入酒馆正则 JSON</span>
                    </div>
                )}
                {scripts.map(script => (
                    <div key={script.id}
                        className={`bg-white rounded-2xl border border-slate-100 shadow-sm px-4 py-3 transition-opacity ${script.disabled ? 'opacity-50' : ''}`}>
                        <div className="flex items-center gap-2">
                            <button onClick={() => { setEditing({ ...script, trimStrings: [...script.trimStrings], placement: [...script.placement] }); setEditingIsNew(false); }}
                                className="flex-1 min-w-0 text-left">
                                <div className="text-[14px] font-medium text-slate-800 truncate">{script.scriptName || '未命名正则'}</div>
                                <div className="text-[11px] text-slate-400 font-mono truncate mt-0.5">{script.findRegex}</div>
                            </button>
                            {/* 启停开关 */}
                            <button onClick={() => handleToggle(script)}
                                className={`shrink-0 w-10 h-6 rounded-full transition-colors relative ${script.disabled ? 'bg-slate-200' : 'bg-violet-500'}`}>
                                <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${script.disabled ? 'left-0.5' : 'left-[18px]'}`} />
                            </button>
                            <button onClick={() => handleDelete(script)}
                                className="shrink-0 p-1.5 text-slate-300 hover:text-red-400 transition-colors">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                                </svg>
                            </button>
                        </div>
                        <div className="flex flex-wrap gap-1 mt-2">
                            {script.placement.map(p => PLACEMENT_LABELS[p] && (
                                <span key={p} className="px-1.5 py-0.5 text-[10px] bg-slate-100 text-slate-500 rounded">{PLACEMENT_LABELS[p]}</span>
                            ))}
                            {script.markdownOnly && <span className="px-1.5 py-0.5 text-[10px] bg-sky-50 text-sky-500 rounded">仅显示</span>}
                            {script.promptOnly && <span className="px-1.5 py-0.5 text-[10px] bg-amber-50 text-amber-600 rounded">仅提示词</span>}
                            {(typeof script.minDepth === 'number' || typeof script.maxDepth === 'number') && (
                                <span className="px-1.5 py-0.5 text-[10px] bg-slate-100 text-slate-500 rounded">
                                    深度 {script.minDepth ?? '∞'}~{script.maxDepth ?? '∞'}
                                </span>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {/* 新建按钮 */}
            <button
                onClick={() => {
                    if (scope === 'scoped' && !scopedChar) { addToast('请先选择角色', 'error'); return; }
                    setEditing(createEmptyRegexScript());
                    setEditingIsNew(true);
                }}
                className="absolute bottom-6 right-5 p-4 bg-violet-500 text-white rounded-2xl shadow-lg active:scale-90 transition-transform z-10">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
            </button>

            {/* 编辑器 */}
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

// ── 编辑器弹层 ──────────────────────────────────────────────────────────────

interface RegexEditorProps {
    script: RegexScriptData;
    isNew: boolean;
    userName: string;
    charName: string;
    onChange: (s: RegexScriptData) => void;
    onSave: () => void;
    onClose: () => void;
}

const RegexEditor: React.FC<RegexEditorProps> = ({ script, isNew, userName, charName, onChange, onSave, onClose }) => {
    const [testInput, setTestInput] = useState('');
    const set = (patch: Partial<RegexScriptData>) => onChange({ ...script, ...patch });

    const togglePlacement = (p: number) => {
        const has = script.placement.includes(p);
        const next = has ? script.placement.filter(x => x !== p) : [...script.placement, p];
        set({ placement: next });
    };

    const testOutput = useMemo(() => {
        if (!testInput || !script.findRegex) return '';
        try {
            return runRegexScript({ ...script, disabled: false }, testInput, { userName, charName });
        } catch (e: any) {
            return `（正则执行出错：${e?.message || e}）`;
        }
    }, [testInput, script, userName, charName]);

    const field = 'w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-[13px] text-slate-700 outline-none focus:border-violet-300 transition-colors';
    const label = 'text-[11px] font-bold text-slate-500 mb-1 block';

    return (
        <div className="absolute inset-0 z-30 bg-black/40 flex items-end animate-fade-in" onClick={onClose}>
            <div className="w-full max-h-[88%] bg-white rounded-t-3xl flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="px-5 py-4 flex items-center border-b border-slate-100 shrink-0">
                    <span className="text-[15px] font-bold text-slate-800">{isNew ? '新建正则脚本' : '编辑正则脚本'}</span>
                    <div className="flex-1" />
                    <button onClick={onClose} className="px-3 py-1.5 text-xs text-slate-400">取消</button>
                    <button onClick={onSave} className="px-4 py-1.5 text-xs font-bold text-white bg-violet-500 rounded-full active:scale-95 transition-transform">保存</button>
                </div>
                <div className="flex-1 overflow-y-auto no-scrollbar px-5 py-4 space-y-4 pb-10">
                    <div>
                        <label className={label}>脚本名称</label>
                        <input className={field} value={script.scriptName} placeholder="例如：去除括号动作描写"
                            onChange={e => set({ scriptName: e.target.value })} />
                    </div>
                    <div>
                        <label className={label}>查找正则（findRegex）</label>
                        <textarea className={`${field} h-20 resize-none font-mono`} value={script.findRegex}
                            placeholder={'/pattern/gi 或裸 pattern'}
                            onChange={e => set({ findRegex: e.target.value })} />
                    </div>
                    <div>
                        <label className={label}>替换为（replaceString）</label>
                        <textarea className={`${field} h-20 resize-none font-mono`} value={script.replaceString}
                            placeholder={'支持 $1 / $<name> 捕获组与 {{match}} 宏，留空 = 删除命中内容'}
                            onChange={e => set({ replaceString: e.target.value })} />
                    </div>
                    <div>
                        <label className={label}>裁剪字符串（trimStrings，每行一条，从命中片段里删掉）</label>
                        <textarea className={`${field} h-16 resize-none font-mono`} value={script.trimStrings.join('\n')}
                            onChange={e => set({ trimStrings: e.target.value.split('\n').filter(s => s !== '') })} />
                    </div>
                    <div>
                        <label className={label}>作用对象（placement）</label>
                        <div className="flex flex-wrap gap-2">
                            {PLACEMENT_OPTIONS.map(p => (
                                <button key={p} onClick={() => togglePlacement(p)}
                                    className={`px-3 py-1.5 rounded-full text-[12px] font-medium transition-colors ${script.placement.includes(p) ? 'bg-violet-500 text-white' : 'bg-slate-100 text-slate-500'}`}>
                                    {PLACEMENT_LABELS[p]}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="space-y-2.5">
                        {([
                            ['markdownOnly', '仅改聊天显示（不改写消息原文）'],
                            ['promptOnly', '仅改发给 LLM 的提示词'],
                            ['runOnEdit', '编辑消息时也运行'],
                        ] as const).map(([key, text]) => (
                            <label key={key} className="flex items-center gap-2.5 text-[13px] text-slate-600">
                                <input type="checkbox" checked={!!script[key]} onChange={e => set({ [key]: e.target.checked } as any)}
                                    className="w-4 h-4 accent-violet-500" />
                                {text}
                            </label>
                        ))}
                    </div>
                    <div>
                        <label className={label}>查找正则里的宏（{'{{user}}/{{char}}'}）</label>
                        <select className={field} value={script.substituteRegex}
                            onChange={e => set({ substituteRegex: Number(e.target.value) })}>
                            <option value={substitute_find_regex.NONE}>不替换</option>
                            <option value={substitute_find_regex.RAW}>原样替换</option>
                            <option value={substitute_find_regex.ESCAPED}>替换并转义</option>
                        </select>
                    </div>
                    <div className="flex gap-3">
                        <div className="flex-1">
                            <label className={label}>最小深度（留空不限）</label>
                            <input className={field} type="number" value={script.minDepth ?? ''}
                                onChange={e => set({ minDepth: e.target.value === '' ? null : Number(e.target.value) })} />
                        </div>
                        <div className="flex-1">
                            <label className={label}>最大深度（留空不限）</label>
                            <input className={field} type="number" value={script.maxDepth ?? ''}
                                onChange={e => set({ maxDepth: e.target.value === '' ? null : Number(e.target.value) })} />
                        </div>
                    </div>
                    {/* 测试区 */}
                    <div className="bg-slate-50 rounded-2xl p-3 space-y-2 border border-slate-100">
                        <div className="text-[11px] font-bold text-slate-500">测试</div>
                        <textarea className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-[12px] h-16 resize-none outline-none"
                            placeholder="输入一段文本，实时预览替换结果" value={testInput}
                            onChange={e => setTestInput(e.target.value)} />
                        {testInput && (
                            <div className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-[12px] text-slate-600 whitespace-pre-wrap break-words min-h-[2rem]">
                                {testOutput || <span className="text-slate-300">（输出为空）</span>}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default RegexApp;
