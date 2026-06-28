import React, { useMemo, useState } from 'react';
import { RegexScriptData } from '../../types';
import {
    regex_placement,
    substitute_find_regex,
    PLACEMENT_LABELS,
    runRegexScript,
} from '../../utils/regex/engine';
import { BracketsCurly, CaretLeft, FloppyDisk, Play } from '@phosphor-icons/react';

const AC = '#9ecfc4';
const AC_DARK = '#5b7771';
const AC_SOFT = '#f0faf7';
const AC_WASH = 'rgba(172,214,204,0.34)';
const CANVAS = 'radial-gradient(120% 72% at 50% -18%, rgba(172,214,204,0.30), transparent 62%), linear-gradient(158deg, #fffaf8 0%, #f8fbf7 44%, #f1f7f9 100%)';
const GRAD_MAIN = 'linear-gradient(135deg, #d4eee7 0%, #d8edf4 62%, #f2e6c2 145%)';
const GRAD_SOFT = 'linear-gradient(135deg, rgba(240,250,247,0.98) 0%, rgba(243,250,252,0.96) 58%, rgba(255,250,236,0.90) 100%)';
const GRAD_CARD = 'linear-gradient(180deg, rgba(255,255,255,0.98), rgba(255,255,255,0.94)), linear-gradient(135deg, rgba(172,214,204,0.12), rgba(191,220,232,0.10), rgba(232,213,164,0.09))';
const GRAD_FIELD = 'linear-gradient(135deg, rgba(255,255,255,0.98), rgba(247,252,250,0.96) 58%, rgba(255,250,241,0.94))';
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
        desc: '用户重新编辑消息时也执行这条正则。',
    },
] as const;

export interface RegexEditorProps {
    script: RegexScriptData;
    isNew: boolean;
    userName: string;
    charName: string;
    /** 弹层标题左上角的小标（默认 NEW REGEX / EDIT REGEX） */
    eyebrow?: { neu: string; old: string };
    onChange: (s: RegexScriptData) => void;
    onSave: () => void;
    onClose: () => void;
}

const FieldLabel: React.FC<{ children: React.ReactNode; hint?: string }> = ({ children, hint }) => (
    <div className="mb-1.5">
        <label className="block text-[9px] tracking-wider uppercase" style={{ ...LABEL_STACK, color: INK_FAINT }}>{children}</label>
        {hint && <p className="mt-0.5 text-[10px] leading-relaxed" style={{ color: INK_SOFT }}>{hint}</p>}
    </div>
);

const fieldStyle: React.CSSProperties = {
    color: INK,
    caretColor: AC,
    background: GRAD_FIELD,
    border: `1px solid ${HAIRLINE}`,
    borderRadius: 14,
};

const Page: React.FC<{ title: string; en: string; children: React.ReactNode }> = ({ title, en, children }) => (
    <section className="rounded-[20px]" style={{ background: GRAD_CARD, border: `1px solid ${HAIRLINE}`, boxShadow: CARD_SHADOW }}>
        <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-0.5" style={{ background: 'linear-gradient(135deg, rgba(232,245,241,0.34), rgba(255,255,255,0), rgba(255,247,229,0.24))' }}>
            <span className="text-[15px] font-bold leading-tight" style={{ color: INK }}>{title}</span>
            <span className="text-[8.5px] tracking-[0.22em] uppercase select-none shrink-0" style={{ ...LABEL_STACK, color: INK_FAINT }}>{en}</span>
        </div>
        <div className="px-4 pb-3.5 pt-0.5">{children}</div>
    </section>
);

const Entry: React.FC<{ title: string; note?: string; side?: React.ReactNode; children?: React.ReactNode }> = ({ title, note, side, children }) => (
    <div className="py-2.5 border-b last:border-b-0" style={{ borderColor: HAIRLINE }}>
        <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
                <div className="text-[12.5px] font-bold" style={{ color: INK }}>{title}</div>
                {note && <p className="text-[10px] mt-1 leading-relaxed" style={{ color: INK_SOFT }}>{note}</p>}
            </div>
            {side && <div className="shrink-0 pt-0.5">{side}</div>}
        </div>
        {children && <div className="mt-2">{children}</div>}
    </div>
);

const StickerChip: React.FC<{ active: boolean; onClick?: () => void; children: React.ReactNode; tone?: 'rose' | 'blue' | 'mint' | 'plain' }> = ({ active, onClick, children, tone = 'rose' }) => {
    const palette = {
        rose: { bg: GRAD_MAIN, ink: AC_DARK, edge: 'rgba(91,119,113,0.24)' },
        blue: { bg: 'linear-gradient(135deg, #e7f5fa, #d8edf4)', ink: '#607780', edge: 'rgba(121,161,174,0.24)' },
        mint: { bg: 'linear-gradient(135deg, #edf9f5, #dff2ec)', ink: AC_DARK, edge: 'rgba(91,119,113,0.24)' },
        plain: { bg: GRAD_FIELD, ink: INK_SOFT, edge: HAIRLINE },
    }[tone];
    return (
        <button
            onClick={onClick}
            className="px-3 py-1.5 text-[11px] font-bold rounded-full transition-all active:scale-95 max-w-full truncate"
            style={{
                background: active ? palette.bg : GRAD_FIELD,
                color: active ? palette.ink : INK_SOFT,
                border: `1px solid ${active ? palette.edge : HAIRLINE}`,
                boxShadow: active ? '0 8px 16px -13px rgba(91,119,113,0.26)' : 'none',
            }}
        >
            {children}
        </button>
    );
};

const CheckRow: React.FC<{
    active: boolean;
    title: string;
    desc: string;
    onToggle: (next: boolean) => void;
}> = ({ active, title, desc, onToggle }) => (
    <label
        className="flex items-start gap-3 rounded-[14px] px-3 py-2.5 cursor-pointer active:scale-[0.99] transition-transform"
        style={{ background: active ? GRAD_SOFT : GRAD_FIELD, border: `1px solid ${active ? 'rgba(91,119,113,0.24)' : HAIRLINE}` }}
    >
        <span className="mt-0.5 w-5 h-5 rounded-full shrink-0 flex items-center justify-center" style={{ background: active ? GRAD_MAIN : 'linear-gradient(135deg, #f7f6f2, #ebe9e3)', border: `1px solid ${EDGE}`, color: AC_DARK }}>
            {active && <span className="text-[12px] leading-none">✓</span>}
        </span>
        <input type="checkbox" checked={active} onChange={e => onToggle(e.target.checked)} className="hidden" />
        <span className="min-w-0">
            <span className="block text-[12px] font-bold" style={{ color: INK }}>{title}</span>
            <span className="block text-[10px] leading-relaxed mt-0.5" style={{ color: INK_SOFT }}>{desc}</span>
        </span>
    </label>
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

    const eb = eyebrow ?? { neu: 'NEW REGEX', old: 'EDIT REGEX' };

    return (
        <div className="fixed inset-0 z-[320] flex flex-col animate-fade-in overflow-hidden" style={{ background: CANVAS, color: INK }}>
            <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-72" style={{ background: `radial-gradient(115% 88% at 50% -22%, ${AC_WASH}, transparent 68%)` }} />
            <div aria-hidden className="pointer-events-none absolute inset-x-0 top-[92px] h-48" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0), rgba(130,189,213,0.13), rgba(255,247,229,0))' }} />

            <div className="relative z-20 shrink-0 flex items-center gap-3 px-3 py-3" style={{ paddingTop: 'calc(var(--safe-top) + 12px)', background: PAPER, borderBottom: '1px solid #ededed' }}>
                <button
                    onClick={onClose}
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
                        <span className="text-[17px] font-extrabold leading-tight truncate" style={{ color: INK }}>{isNew ? '新建正则' : '编辑正则'}</span>
                        <span className="text-[8px] tracking-[0.28em] select-none shrink-0" style={{ ...LABEL_STACK, color: AC }}>{isNew ? eb.neu : eb.old}</span>
                    </div>
                    <div className="text-[10px] truncate mt-0.5" style={{ color: INK_SOFT }}>保存后立即生效</div>
                </div>
                <span className="text-[10px] font-bold select-none shrink-0 px-2.5 py-1 rounded-full" style={{ color: AC_DARK, background: GRAD_SOFT, border: `1px solid ${EDGE}` }}>
                    编辑中
                </span>
            </div>

            <div className="relative z-10 flex-1 overflow-y-auto no-scrollbar px-3 pt-2.5 pb-24 space-y-3">
                <Page title="基础与替换" en="Basic">
                    <Entry title="正则名称" note="用于在列表里辨认这条正则。">
                        <input
                            className="w-full px-3 py-2 text-[13px] outline-none placeholder:text-[#b8b3bd]"
                            style={fieldStyle}
                            value={script.scriptName}
                            placeholder="例如：隐藏状态栏标签"
                            onChange={e => set({ scriptName: e.target.value })}
                        />
                    </Entry>

                    <Entry title="查找正则" note="支持 /pattern/flags 或裸 pattern。">
                        <textarea
                            className="w-full px-3 py-2 text-[12px] leading-relaxed outline-none resize-none font-mono placeholder:text-[#b8b3bd] h-20"
                            style={fieldStyle}
                            value={script.findRegex}
                            placeholder="/pattern/gi"
                            onChange={e => set({ findRegex: e.target.value })}
                        />
                    </Entry>

                    <Entry title="替换内容" note="支持 $1、$<name> 捕获组与 {{match}}。留空表示删除命中的内容。">
                        <textarea
                            className="w-full px-3 py-2 text-[12px] leading-relaxed outline-none resize-none font-mono placeholder:text-[#b8b3bd] h-20"
                            style={fieldStyle}
                            value={script.replaceString}
                            placeholder="替换文本，或留空删除"
                            onChange={e => set({ replaceString: e.target.value })}
                        />
                    </Entry>

                    <Entry title="预处理移除" note="每行一条；在命中片段内先移除这些文本，再执行替换。">
                        <textarea
                            className="w-full px-3 py-2 text-[12px] leading-relaxed outline-none resize-none font-mono placeholder:text-[#b8b3bd] h-16"
                            style={fieldStyle}
                            value={script.trimStrings.join('\n')}
                            placeholder="可选"
                            onChange={e => set({ trimStrings: e.target.value.split('\n').filter(s => s !== '') })}
                        />
                    </Entry>
                </Page>

                <Page title="执行与过滤" en="Runtime">
                    <Entry title="运行位置" note="决定正则会处理哪一种文本。">
                        <div className="flex flex-wrap gap-2">
                            {PLACEMENT_OPTIONS.map((p) => (
                                <StickerChip key={p} active={script.placement.includes(p)} onClick={() => togglePlacement(p)} tone="rose">
                                    {PLACEMENT_LABELS[p]}
                                </StickerChip>
                            ))}
                        </div>
                    </Entry>

                    <Entry title="运行模式" note="不勾仅显示层/仅提示词时，正则会直接改写消息原文。">
                        <div className="space-y-2">
                            {RUN_MODE_OPTIONS.map(({ key, title, desc }) => (
                                <CheckRow
                                    key={key}
                                    active={!!script[key]}
                                    title={title}
                                    desc={desc}
                                    onToggle={(next) => set({ [key]: next } as any)}
                                />
                            ))}
                        </div>
                    </Entry>
                    <Entry title="宏替换" note="决定 findRegex 中的 {{user}} / {{char}} 是否替换为当前名字。">
                        <div className="relative">
                            <select
                                className="w-full appearance-none px-3 py-2 text-[13px] font-bold outline-none"
                                style={fieldStyle}
                                value={script.substituteRegex}
                                onChange={e => set({ substituteRegex: Number(e.target.value) })}
                            >
                                <option value={substitute_find_regex.NONE}>不替换宏</option>
                                <option value={substitute_find_regex.RAW}>替换成名字</option>
                                <option value={substitute_find_regex.ESCAPED}>替换成名字并正则转义</option>
                            </select>
                            <span aria-hidden className="absolute right-3 top-1/2 -translate-y-1/2 text-xs pointer-events-none" style={{ color: INK_FAINT }}>▾</span>
                        </div>
                    </Entry>

                    <Entry title="消息深度" note="0 表示最后一条消息；留空表示不限。">
                        <div className="grid grid-cols-2 gap-2.5">
                            <div>
                                <FieldLabel>最小深度</FieldLabel>
                                <input
                                    className="w-full px-3 py-2 text-[13px] outline-none placeholder:text-[#b8b3bd]"
                                    style={fieldStyle}
                                    type="number"
                                    value={script.minDepth ?? ''}
                                    placeholder="不限"
                                    onChange={e => set({ minDepth: e.target.value === '' ? null : Number(e.target.value) })}
                                />
                            </div>
                            <div>
                                <FieldLabel>最大深度</FieldLabel>
                                <input
                                    className="w-full px-3 py-2 text-[13px] outline-none placeholder:text-[#b8b3bd]"
                                    style={fieldStyle}
                                    type="number"
                                    value={script.maxDepth ?? ''}
                                    placeholder="不限"
                                    onChange={e => set({ maxDepth: e.target.value === '' ? null : Number(e.target.value) })}
                                />
                            </div>
                        </div>
                    </Entry>
                </Page>

                <Page title="试运行" en="Test">
                    <Entry title="测试文本" note="输入一段文本，立即查看这条正则的替换结果。">
                        <textarea
                            className="w-full px-3 py-2 text-[12px] leading-relaxed outline-none resize-none font-mono placeholder:text-[#b8b3bd] h-20"
                            style={fieldStyle}
                            placeholder="输入测试文本"
                            value={testInput}
                            onChange={e => setTestInput(e.target.value)}
                        />
                        {testInput && (
                            <div className="mt-2.5 rounded-[14px] px-3 py-3 min-h-[3rem] whitespace-pre-wrap break-words text-[12px] leading-relaxed" style={{ background: GRAD_SOFT, color: AC_DARK, border: `1px solid ${EDGE}` }}>
                                <div className="mb-1.5 flex items-center gap-1.5 text-[10px] tracking-[0.18em] uppercase" style={{ ...LABEL_STACK, color: AC }}>
                                    <Play size={11} weight="fill" /> Output
                                </div>
                                {testOutput || <span style={{ color: INK_FAINT }}>结果为空</span>}
                            </div>
                        )}
                    </Entry>
                </Page>
            </div>

            <div className="absolute bottom-0 inset-x-0 z-20 px-3 pt-3 flex gap-2.5" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 14px)', background: 'linear-gradient(180deg, transparent, rgba(247,245,242,0.96) 36%, #f7f5f2)' }}>
                <button
                    onClick={onClose}
                    className="flex-1 rounded-full py-3 text-[13px] font-bold active:scale-[0.98] transition-transform"
                    style={{ background: PAPER, color: INK_SOFT, border: `1px solid ${HAIRLINE}` }}
                >
                    取消
                </button>
                <button
                    onClick={onSave}
                    className="flex-1 rounded-full py-3 text-[13px] font-bold active:scale-[0.98] transition-transform"
                    style={{ background: GRAD_MAIN, color: AC_DARK, boxShadow: '0 12px 24px -14px rgba(91,119,113,0.38)' }}
                >
                    <span className="inline-flex items-center gap-1.5"><FloppyDisk size={15} weight="bold" /> 保存</span>
                </button>
            </div>
        </div>
    );
};

export default RegexEditor;
