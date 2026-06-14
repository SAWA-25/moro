import React, { useMemo, useState } from 'react';
import { RegexScriptData } from '../../types';
import {
    regex_placement,
    substitute_find_regex,
    PLACEMENT_LABELS,
    runRegexScript,
} from '../../utils/regex/engine';

/**
 * 共用缝纫台（正则编辑器）——补丁铺（全局/角色作用域）与活字盘（随字版的预设作用域）
 * 共用同一个编辑弹层，避免两处各写一份。黑白拼贴手账风，与剪影集全家同一套设计语言。
 *
 * 词汇对照（数据结构 / ST 语义不变，只换了说法）：
 *  - 补丁 = 一条正则脚本（RegexScriptData）；线头 = findRegex；缝上去的布 = replaceString
 *  - 先剪掉的线头 = trimStrings；补在哪些布上 = placement；试缝台 = 实时测试
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

const PLACEMENT_OPTIONS = [
    regex_placement.USER_INPUT,
    regex_placement.AI_OUTPUT,
    regex_placement.SLASH_COMMAND,
    regex_placement.WORLD_INFO,
    regex_placement.REASONING,
];

export interface RegexEditorProps {
    script: RegexScriptData;
    isNew: boolean;
    userName: string;
    charName: string;
    /** 弹层标题左上角的小标（默认 NEW PATCH / RE-STITCH） */
    eyebrow?: { neu: string; old: string };
    onChange: (s: RegexScriptData) => void;
    onSave: () => void;
    onClose: () => void;
}

/** 缝纫台（编辑器弹层） */
const RegexEditor: React.FC<RegexEditorProps> = ({ script, isNew, userName, charName, eyebrow, onChange, onSave, onClose }) => {
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
            return `（这针下歪了：${e?.message || e}）`;
        }
    }, [testInput, script, userName, charName]);

    const field = 'w-full px-3 py-2 bg-white border-2 border-[#1c1b1a]/60 text-xs outline-none focus:border-[#1c1b1a] transition-colors placeholder:text-[#1c1b1a]/25';
    const label = 'label-mono text-[8px] text-[#1c1b1a]/45 mb-1 block';
    const eb = eyebrow ?? { neu: 'NEW PATCH', old: 'RE-STITCH' };

    return (
        <div className="absolute inset-0 z-30 bg-[#1c1b1a]/45 flex items-end animate-fade-in" onClick={onClose}>
            <div className="relative w-full max-h-[88%] bg-[#f7f5ef] border-t-2 border-x-2 border-[#1c1b1a] flex flex-col overflow-hidden animate-slide-up" style={DOT_BG} onClick={e => e.stopPropagation()}>
                <Tape className="-top-0.5 left-1/2 -translate-x-1/2 rotate-[-3deg] z-10" />
                <div className="px-5 py-4 flex items-center border-b-2 border-dashed border-[#1c1b1a]/30 shrink-0 gap-2">
                    <div className="flex-1 min-w-0">
                        <div className="label-mono text-[8px] text-[#1c1b1a]/45">{isNew ? eb.neu : eb.old}</div>
                        <span className="text-lg font-black tracking-wide">{isNew ? '缝一块新补丁' : '把这块补丁拆开重缝'}</span>
                    </div>
                    <button onClick={onClose} className={`px-3 py-1.5 text-[10px] font-black rotate-[-1deg] ${STICKER}`}>不缝了</button>
                    <button onClick={onSave} className={`px-4 py-1.5 text-[10px] font-black rotate-[1deg] ${INK_BTN}`}>缝牢</button>
                </div>
                <div className="flex-1 overflow-y-auto no-scrollbar px-5 py-4 space-y-4 pb-10">
                    <div>
                        <label className={label}>补丁名 / LABEL</label>
                        <input className={field} value={script.scriptName} placeholder="比如：拆掉括号里的动作描写"
                            onChange={e => set({ scriptName: e.target.value })} />
                    </div>
                    <div>
                        <label className={label}>要找的线头（findRegex）</label>
                        <textarea className={`${field} h-20 resize-none font-mono`} value={script.findRegex}
                            placeholder={'/pattern/gi 或裸 pattern'}
                            onChange={e => set({ findRegex: e.target.value })} />
                    </div>
                    <div>
                        <label className={label}>缝上去的布（replaceString）</label>
                        <textarea className={`${field} h-20 resize-none font-mono`} value={script.replaceString}
                            placeholder={'支持 $1 / $<name> 捕获组与 {{match}} 宏；留白 = 把找到的整段剪掉'}
                            onChange={e => set({ replaceString: e.target.value })} />
                    </div>
                    <div>
                        <label className={label}>先剪掉的线头（trimStrings，每行一条，从找到的片段里剪掉）</label>
                        <textarea className={`${field} h-16 resize-none font-mono`} value={script.trimStrings.join('\n')}
                            onChange={e => set({ trimStrings: e.target.value.split('\n').filter(s => s !== '') })} />
                    </div>
                    <div>
                        <label className={label}>补在哪些布上（placement）</label>
                        <div className="flex flex-wrap gap-2">
                            {PLACEMENT_OPTIONS.map((p, i) => (
                                <button key={p} onClick={() => togglePlacement(p)}
                                    className={`px-3 py-1.5 text-[10px] font-black border-2 border-[#1c1b1a] transition-all ${i % 2 === 0 ? 'rotate-[-0.6deg]' : 'rotate-[0.6deg]'} ${script.placement.includes(p) ? 'bg-[#1c1b1a] text-[#f7f5ef] shadow-[2px_2px_0_rgba(28,27,26,0.35)]' : 'bg-white shadow-[2px_2px_0_#1c1b1a]'}`}>
                                    {PLACEMENT_LABELS[p]}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="space-y-2.5 border-l-2 border-dashed border-[#1c1b1a]/40 pl-3">
                        {([
                            ['markdownOnly', '只改表面：动聊天显示，不动消息原文'],
                            ['promptOnly', '只改寄出的信：动发给 LLM 的提示词'],
                            ['runOnEdit', '改字的时候这针也跟着走（编辑消息时运行）'],
                        ] as const).map(([key, text]) => (
                            <label key={key} className="flex items-center gap-2.5 text-xs font-bold cursor-pointer">
                                <span className={`w-4 h-4 border-2 border-[#1c1b1a] shrink-0 flex items-center justify-center ${script[key] ? 'bg-[#1c1b1a]' : 'bg-white'}`}>
                                    {!!script[key] && <svg viewBox="0 0 24 24" fill="none" stroke="#f7f5ef" strokeWidth={4.5} className="w-2.5 h-2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                                </span>
                                <input type="checkbox" checked={!!script[key]} onChange={e => set({ [key]: e.target.checked } as any)} className="hidden" />
                                {text}
                            </label>
                        ))}
                    </div>
                    <div>
                        <label className={label}>线头里的宏怎么处理（{'{{user}}/{{char}}'}）</label>
                        <div className="relative">
                            <select className={`${field} appearance-none font-bold`} value={script.substituteRegex}
                                onChange={e => set({ substituteRegex: Number(e.target.value) })}>
                                <option value={substitute_find_regex.NONE}>原封不动（不替换）</option>
                                <option value={substitute_find_regex.RAW}>替换成名字（原样）</option>
                                <option value={substitute_find_regex.ESCAPED}>替换成名字并转义</option>
                            </select>
                            <span aria-hidden className="absolute right-3 top-1/2 -translate-y-1/2 text-xs pointer-events-none">▾</span>
                        </div>
                    </div>
                    <div className="flex gap-3">
                        <div className="flex-1">
                            <label className={label}>最浅缝到第几层（留空不限）</label>
                            <input className={field} type="number" value={script.minDepth ?? ''}
                                onChange={e => set({ minDepth: e.target.value === '' ? null : Number(e.target.value) })} />
                        </div>
                        <div className="flex-1">
                            <label className={label}>最深缝到第几层（留空不限）</label>
                            <input className={field} type="number" value={script.maxDepth ?? ''}
                                onChange={e => set({ maxDepth: e.target.value === '' ? null : Number(e.target.value) })} />
                        </div>
                    </div>
                    {/* 试缝台 */}
                    <div className="relative bg-white border-2 border-[#1c1b1a] shadow-[3px_3px_0_#1c1b1a] p-3 space-y-2">
                        <Tape className="-top-2.5 left-5 rotate-[-4deg] w-12" />
                        <div className="label-mono text-[8px] text-[#1c1b1a]/45 pt-1">试缝台 / FITTING</div>
                        <textarea className="w-full px-3 py-2 bg-[#fbfaf6] border-2 border-[#1c1b1a]/40 text-xs h-16 resize-none outline-none focus:border-[#1c1b1a] placeholder:text-[#1c1b1a]/25"
                            placeholder="丢一段布料（文本）进来，立刻看这块补丁缝完的样子" value={testInput}
                            onChange={e => setTestInput(e.target.value)} />
                        {testInput && (
                            <div className="px-3 py-2 border-2 border-dashed border-[#1c1b1a]/50 text-xs whitespace-pre-wrap break-words min-h-[2rem]">
                                {testOutput || <span className="text-[#1c1b1a]/35" style={HAND_CN}>（缝完一个字不剩）</span>}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default RegexEditor;
