import React, { useMemo, useState } from 'react';
import { RegexScriptData } from '../../types';
import {
    regex_placement,
    substitute_find_regex,
    PLACEMENT_LABELS,
    runRegexScript,
} from '../../utils/regex/engine';
import { InsButton, SectionLabel, accent, INK, INK_SOFT } from '../ui/insKit';
import { BracketsCurly, FloppyDisk, Play, X } from '@phosphor-icons/react';

const AC = 'teal' as const;
const A = accent(AC);
const EDGE = 'rgba(0,0,0,0.06)';

const PLACEMENT_OPTIONS = [
    regex_placement.USER_INPUT,
    regex_placement.AI_OUTPUT,
    regex_placement.SLASH_COMMAND,
    regex_placement.WORLD_INFO,
    regex_placement.REASONING,
];

const RUN_MODE_OPTIONS = [
    {
        key: 'markdownOnly',
        title: '仅显示层',
        desc: '只影响聊天气泡渲染，不改消息原文。',
    },
    {
        key: 'promptOnly',
        title: '仅提示词',
        desc: '只影响发送给 LLM 的提示词，不改聊天原文。',
    },
    {
        key: 'runOnEdit',
        title: '编辑消息时运行',
        desc: '用户重新编辑消息时也执行这条脚本。',
    },
] as const;

export interface RegexEditorProps {
    script: RegexScriptData;
    isNew: boolean;
    userName: string;
    charName: string;
    /** 弹层标题左上角的小标（默认 NEW SCRIPT / EDIT SCRIPT） */
    eyebrow?: { neu: string; old: string };
    onChange: (s: RegexScriptData) => void;
    onSave: () => void;
    onClose: () => void;
}

const field = 'w-full px-4 py-3 bg-white text-[13px] outline-none transition-all placeholder:text-slate-400';
const monoField = `${field} font-mono leading-relaxed`;
const labelStyle: React.CSSProperties = { color: INK_SOFT, fontFamily: 'var(--font-label)' };

const fieldBox: React.CSSProperties = {
    border: `1px solid ${EDGE}`,
    borderRadius: 16,
    boxShadow: 'inset 0 1px 2px rgba(38,38,38,0.03)',
};

const FieldLabel: React.FC<{ children: React.ReactNode; hint?: string }> = ({ children, hint }) => (
    <div className="mb-2">
        <label className="block text-[10px] font-bold tracking-[0.18em] uppercase" style={labelStyle}>{children}</label>
        {hint && <p className="mt-1 text-[11px] leading-snug" style={{ color: INK_SOFT }}>{hint}</p>}
    </div>
);

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
            return `正则执行失败：${e?.message || e}`;
        }
    }, [testInput, script, userName, charName]);

    const eb = eyebrow ?? { neu: 'NEW SCRIPT', old: 'EDIT SCRIPT' };

    return (
        <div className="absolute inset-0 z-30 flex items-end justify-center animate-fade-in" onClick={onClose}>
            <div className="absolute inset-0" style={{ background: 'rgba(28,26,24,0.42)', backdropFilter: 'blur(4px)' }} />
            <div
                className="relative w-full max-h-[90%] flex flex-col overflow-hidden animate-slide-up"
                style={{
                    maxWidth: 460,
                    background: 'linear-gradient(180deg,#ffffff 0%,#fbfaf8 100%)',
                    borderTopLeftRadius: 28,
                    borderTopRightRadius: 28,
                    boxShadow: '0 -22px 60px -24px rgba(20,18,16,0.45)',
                    paddingBottom: 'max(env(safe-area-inset-bottom), 14px)',
                }}
                onClick={e => e.stopPropagation()}
            >
                <div className="flex justify-center pt-3 shrink-0">
                    <span className="w-10 h-1.5 rounded-full" style={{ background: '#e3e0da' }} />
                </div>

                <div className="px-5 pt-3 pb-3 flex items-center gap-3 shrink-0">
                    <div className="p-2 rounded-2xl shrink-0" style={{ background: A.soft, color: A.ink }}>
                        <BracketsCurly size={22} weight="bold" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="text-[9px] tracking-[0.28em] uppercase" style={{ fontFamily: 'var(--font-label)', color: A.solid }}>
                            {isNew ? eb.neu : eb.old}
                        </div>
                        <div className="text-[17px] font-extrabold truncate" style={{ color: INK }}>
                            {isNew ? '新建正则脚本' : '编辑正则脚本'}
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="w-9 h-9 rounded-full flex items-center justify-center press-soft shrink-0"
                        style={{ background: '#fff', color: INK, border: `1px solid ${EDGE}`, boxShadow: '0 8px 18px -16px rgba(38,38,38,0.4)' }}
                        aria-label="关闭"
                    >
                        <X size={16} weight="bold" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto no-scrollbar px-5 py-2 space-y-5">
                    <section>
                        <SectionLabel en="BASIC" accent={AC} className="mb-3">基础信息</SectionLabel>
                        <div className="space-y-3">
                            <div>
                                <FieldLabel>脚本名称</FieldLabel>
                                <input
                                    className={field}
                                    style={fieldBox}
                                    value={script.scriptName}
                                    placeholder="例如：隐藏状态栏标签"
                                    onChange={e => set({ scriptName: e.target.value })}
                                />
                            </div>
                            <div>
                                <FieldLabel hint="支持 /pattern/flags 或裸 pattern。">查找正则 findRegex</FieldLabel>
                                <textarea
                                    className={`${monoField} h-24 resize-none`}
                                    style={fieldBox}
                                    value={script.findRegex}
                                    placeholder="/pattern/gi"
                                    onChange={e => set({ findRegex: e.target.value })}
                                />
                            </div>
                            <div>
                                <FieldLabel hint="支持 $1、$<name> 捕获组与 {{match}}。留空表示删除命中的内容。">替换内容 replaceString</FieldLabel>
                                <textarea
                                    className={`${monoField} h-24 resize-none`}
                                    style={fieldBox}
                                    value={script.replaceString}
                                    placeholder="替换文本，或留空删除"
                                    onChange={e => set({ replaceString: e.target.value })}
                                />
                            </div>
                            <div>
                                <FieldLabel hint="每行一条；在命中片段内先移除这些文本，再执行替换。">预处理移除 trimStrings</FieldLabel>
                                <textarea
                                    className={`${monoField} h-20 resize-none`}
                                    style={fieldBox}
                                    value={script.trimStrings.join('\n')}
                                    placeholder="可选"
                                    onChange={e => set({ trimStrings: e.target.value.split('\n').filter(s => s !== '') })}
                                />
                            </div>
                        </div>
                    </section>

                    <section>
                        <SectionLabel en="WHERE" accent={AC} className="mb-3">运行位置</SectionLabel>
                        <div className="flex flex-wrap gap-2">
                            {PLACEMENT_OPTIONS.map((p) => {
                                const active = script.placement.includes(p);
                                return (
                                    <button
                                        key={p}
                                        onClick={() => togglePlacement(p)}
                                        className="px-3 py-2 rounded-full text-[12px] font-bold press-soft"
                                        style={active
                                            ? { background: A.solid, color: '#fff', boxShadow: `0 10px 20px -14px ${A.solid}` }
                                            : { background: '#fff', color: INK_SOFT, border: `1px solid ${EDGE}` }}
                                    >
                                        {PLACEMENT_LABELS[p]}
                                    </button>
                                );
                            })}
                        </div>
                    </section>

                    <section>
                        <SectionLabel en="MODE" accent={AC} className="mb-3">运行模式</SectionLabel>
                        <div className="space-y-2">
                            {RUN_MODE_OPTIONS.map(({ key, title, desc }) => (
                                <label
                                    key={key}
                                    className="flex items-start gap-3 p-3 rounded-[18px] cursor-pointer press-soft"
                                    style={{
                                        background: script[key] ? A.soft : '#fff',
                                        border: `1px solid ${script[key] ? A.solid + '55' : EDGE}`,
                                    }}
                                >
                                    <span
                                        className="mt-0.5 w-5 h-5 rounded-full shrink-0 flex items-center justify-center"
                                        style={{ background: script[key] ? A.solid : '#f1eee9', color: '#fff' }}
                                    >
                                        {!!script[key] && <span className="text-[12px] leading-none">✓</span>}
                                    </span>
                                    <input
                                        type="checkbox"
                                        checked={!!script[key]}
                                        onChange={e => set({ [key]: e.target.checked } as any)}
                                        className="hidden"
                                    />
                                    <span className="min-w-0">
                                        <span className="block text-[13px] font-extrabold" style={{ color: INK }}>{title}</span>
                                        <span className="block text-[11px] leading-snug mt-0.5" style={{ color: INK_SOFT }}>{desc}</span>
                                    </span>
                                </label>
                            ))}
                        </div>
                    </section>

                    <section>
                        <SectionLabel en="ADVANCED" accent={AC} className="mb-3">高级设置</SectionLabel>
                        <div className="space-y-3">
                            <div>
                                <FieldLabel hint="决定 findRegex 中的 {{user}} / {{char}} 是否替换为当前名字。">宏替换</FieldLabel>
                                <div className="relative">
                                    <select
                                        className={`${field} appearance-none font-bold`}
                                        style={fieldBox}
                                        value={script.substituteRegex}
                                        onChange={e => set({ substituteRegex: Number(e.target.value) })}
                                    >
                                        <option value={substitute_find_regex.NONE}>不替换宏</option>
                                        <option value={substitute_find_regex.RAW}>替换成名字</option>
                                        <option value={substitute_find_regex.ESCAPED}>替换成名字并正则转义</option>
                                    </select>
                                    <span aria-hidden className="absolute right-4 top-1/2 -translate-y-1/2 text-xs pointer-events-none" style={{ color: INK_SOFT }}>▾</span>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <FieldLabel>最小深度</FieldLabel>
                                    <input
                                        className={field}
                                        style={fieldBox}
                                        type="number"
                                        value={script.minDepth ?? ''}
                                        placeholder="不限"
                                        onChange={e => set({ minDepth: e.target.value === '' ? null : Number(e.target.value) })}
                                    />
                                </div>
                                <div>
                                    <FieldLabel>最大深度</FieldLabel>
                                    <input
                                        className={field}
                                        style={fieldBox}
                                        type="number"
                                        value={script.maxDepth ?? ''}
                                        placeholder="不限"
                                        onChange={e => set({ maxDepth: e.target.value === '' ? null : Number(e.target.value) })}
                                    />
                                </div>
                            </div>
                        </div>
                    </section>

                    <section className="pb-3">
                        <SectionLabel en="TEST" accent={AC} className="mb-3">实时测试</SectionLabel>
                        <div className="rounded-[22px] bg-white p-3 space-y-3" style={{ border: `1px solid ${EDGE}`, boxShadow: '0 18px 40px -28px rgba(38,38,38,0.30)' }}>
                            <textarea
                                className={`${monoField} h-24 resize-none`}
                                style={{ ...fieldBox, background: '#fbfaf8' }}
                                placeholder="输入一段测试文本，查看替换结果"
                                value={testInput}
                                onChange={e => setTestInput(e.target.value)}
                            />
                            {testInput && (
                                <div className="rounded-2xl px-3 py-3 min-h-[3rem] whitespace-pre-wrap break-words text-[12px] leading-relaxed" style={{ background: A.soft, color: A.ink }}>
                                    <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold tracking-[0.18em] uppercase" style={{ fontFamily: 'var(--font-label)' }}>
                                        <Play size={11} weight="fill" /> Output
                                    </div>
                                    {testOutput || <span style={{ color: INK_SOFT }}>结果为空</span>}
                                </div>
                            )}
                        </div>
                    </section>
                </div>

                <div className="px-5 pt-3 pb-2 flex gap-2.5 shrink-0" style={{ borderTop: `1px solid ${EDGE}` }}>
                    <InsButton variant="soft" accent="slate" onClick={onClose} className="flex-1 py-3 text-[13px]">取消</InsButton>
                    <InsButton variant="solid" accent={AC} onClick={onSave} className="flex-1 py-3 text-[13px]" icon={<FloppyDisk size={15} weight="bold" />}>
                        保存
                    </InsButton>
                </div>
            </div>
        </div>
    );
};

export default RegexEditor;
