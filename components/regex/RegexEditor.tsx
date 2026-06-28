import React, { useMemo, useState } from 'react';
import { RegexScriptData } from '../../types';
import {
    regex_placement,
    substitute_find_regex,
    PLACEMENT_LABELS,
    runRegexScript,
} from '../../utils/regex/engine';
import { PAPER_TONES, MONO_STACK, CUTE_STACK } from '../handbook/paper';
import { BracketsCurly, FloppyDisk, Play } from '@phosphor-icons/react';

const ROSE = '#d8a5b7';
const EDGE = '#eed6df';

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

const FieldLabel: React.FC<{ children: React.ReactNode; hint?: string }> = ({ children, hint }) => (
    <div className="mb-1.5">
        <label className="block text-[9px] tracking-wider" style={{ ...MONO_STACK, color: PAPER_TONES.inkFaint }}>{children}</label>
        {hint && <p className="mt-0.5 text-[10px] leading-relaxed" style={{ color: PAPER_TONES.inkSoft }}>{hint}</p>}
    </div>
);

const fieldStyle: React.CSSProperties = {
    color: PAPER_TONES.ink,
    caretColor: ROSE,
    background: '#fffdfa',
    border: `1px solid ${EDGE}`,
    borderRadius: 14,
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

const Entry: React.FC<{ mark?: string; title: string; note?: string; side?: React.ReactNode; children?: React.ReactNode }> = ({ mark = '✿', title, note, side, children }) => (
    <div className="py-3 border-b last:border-b-0" style={{ borderColor: 'rgba(216,165,183,0.35)' }}>
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

const StickerChip: React.FC<{ active: boolean; onClick?: () => void; children: React.ReactNode; tone?: 'rose' | 'blue' | 'mint' | 'plain' }> = ({ active, onClick, children, tone = 'rose' }) => {
    const palette = {
        rose: { bg: '#fff4f7', ink: '#5a3140', edge: EDGE },
        blue: { bg: '#f1f6fa', ink: '#4c6f82', edge: '#d8e6ee' },
        mint: { bg: '#f6fbf8', ink: '#5f7f6d', edge: '#dbe9e2' },
        plain: { bg: '#fffdfa', ink: '#7a5a72', edge: EDGE },
    }[tone];
    return (
        <button
            onClick={onClick}
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

const CheckRow: React.FC<{
    active: boolean;
    title: string;
    desc: string;
    onToggle: (next: boolean) => void;
}> = ({ active, title, desc, onToggle }) => (
    <label
        className="flex items-start gap-3 rounded-[14px] px-3 py-2.5 cursor-pointer active:scale-[0.99] transition-transform"
        style={{ background: active ? '#fff4f7' : '#fffdfa', border: `1px solid ${active ? ROSE : EDGE}` }}
    >
        <span className="mt-0.5 w-5 h-5 rounded-full shrink-0 flex items-center justify-center" style={{ background: active ? ROSE : '#f8f4f6', border: `1px solid ${EDGE}`, color: '#fff' }}>
            {active && <span className="text-[12px] leading-none">✓</span>}
        </span>
        <input type="checkbox" checked={active} onChange={e => onToggle(e.target.checked)} className="hidden" />
        <span className="min-w-0">
            <span className="block text-[12px] font-bold" style={{ ...CUTE_STACK, color: PAPER_TONES.ink }}>{title}</span>
            <span className="block text-[10px] leading-relaxed mt-0.5" style={{ color: PAPER_TONES.inkSoft }}>{desc}</span>
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

    const eb = eyebrow ?? { neu: 'NEW SCRIPT', old: 'EDIT SCRIPT' };

    return (
        <div className="fixed inset-0 z-[320] flex flex-col animate-fade-in" style={{ paddingTop: 'var(--safe-top)', backgroundColor: '#fafafa' }}>
            <div className="shrink-0 flex items-center gap-3 px-3 py-3" style={{ background: '#ffffff', borderBottom: '1px solid #ededed' }}>
                <button
                    onClick={onClose}
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
                        <span className="text-[16px] font-bold leading-tight" style={{ color: '#5a3140' }}>{isNew ? '新建正则脚本' : '编辑正则脚本'}</span>
                        <span className="text-[8.5px] tracking-[0.24em] select-none" style={{ ...MONO_STACK, color: '#b07a8d' }}>{isNew ? eb.neu : eb.old}</span>
                    </div>
                    <div className="text-[10px] truncate mt-0.5" style={{ color: '#a96f84' }}>保存后立即生效</div>
                </div>
                <span className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ color: ROSE, background: '#fff4f7', border: `1px solid ${EDGE}` }}>
                    <BracketsCurly size={18} weight="bold" />
                </span>
            </div>

            <div className="flex-1 overflow-y-auto no-scrollbar px-3 pt-6 pb-28 space-y-8">
                <Page title="基础信息" en="Basic">
                    <Entry mark="♡" title="脚本名称" note="用于在补丁铺列表里辨认这条脚本。">
                        <input
                            className="w-full px-3 py-2 text-[13px] outline-none placeholder:text-[#cfb8c4]"
                            style={fieldStyle}
                            value={script.scriptName}
                            placeholder="例如：隐藏状态栏标签"
                            onChange={e => set({ scriptName: e.target.value })}
                        />
                    </Entry>

                    <Entry mark="♡" title="查找正则" note="支持 /pattern/flags 或裸 pattern。">
                        <textarea
                            className="w-full px-3 py-2 text-[12px] leading-relaxed outline-none resize-none font-mono placeholder:text-[#cfb8c4] h-24"
                            style={fieldStyle}
                            value={script.findRegex}
                            placeholder="/pattern/gi"
                            onChange={e => set({ findRegex: e.target.value })}
                        />
                    </Entry>

                    <Entry mark="♡" title="替换内容" note="支持 $1、$<name> 捕获组与 {{match}}。留空表示删除命中的内容。">
                        <textarea
                            className="w-full px-3 py-2 text-[12px] leading-relaxed outline-none resize-none font-mono placeholder:text-[#cfb8c4] h-24"
                            style={fieldStyle}
                            value={script.replaceString}
                            placeholder="替换文本，或留空删除"
                            onChange={e => set({ replaceString: e.target.value })}
                        />
                    </Entry>

                    <Entry mark="♡" title="预处理移除" note="每行一条；在命中片段内先移除这些文本，再执行替换。">
                        <textarea
                            className="w-full px-3 py-2 text-[12px] leading-relaxed outline-none resize-none font-mono placeholder:text-[#cfb8c4] h-20"
                            style={fieldStyle}
                            value={script.trimStrings.join('\n')}
                            placeholder="可选"
                            onChange={e => set({ trimStrings: e.target.value.split('\n').filter(s => s !== '') })}
                        />
                    </Entry>
                </Page>

                <Page title="运行设置" en="Runtime">
                    <Entry mark="✩" title="运行位置" note="决定脚本会处理哪一种文本。">
                        <div className="flex flex-wrap gap-2">
                            {PLACEMENT_OPTIONS.map((p) => (
                                <StickerChip key={p} active={script.placement.includes(p)} onClick={() => togglePlacement(p)} tone="rose">
                                    {PLACEMENT_LABELS[p]}
                                </StickerChip>
                            ))}
                        </div>
                    </Entry>

                    <Entry mark="✩" title="运行模式" note="不勾仅显示层/仅提示词时，脚本会直接改写消息原文。">
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
                </Page>

                <Page title="高级设置" en="Advanced">
                    <Entry mark="✦" title="宏替换" note="决定 findRegex 中的 {{user}} / {{char}} 是否替换为当前名字。">
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
                            <span aria-hidden className="absolute right-3 top-1/2 -translate-y-1/2 text-xs pointer-events-none" style={{ color: PAPER_TONES.inkFaint }}>▾</span>
                        </div>
                    </Entry>

                    <Entry mark="✦" title="消息深度" note="0 表示最后一条消息；留空表示不限。">
                        <div className="grid grid-cols-2 gap-2.5">
                            <div>
                                <FieldLabel>最小深度</FieldLabel>
                                <input
                                    className="w-full px-3 py-2 text-[13px] outline-none placeholder:text-[#cfb8c4]"
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
                                    className="w-full px-3 py-2 text-[13px] outline-none placeholder:text-[#cfb8c4]"
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

                <Page title="实时测试" en="Test">
                    <Entry mark="☼" title="测试文本" note="输入一段文本，立即查看这条脚本的替换结果。">
                        <textarea
                            className="w-full px-3 py-2 text-[12px] leading-relaxed outline-none resize-none font-mono placeholder:text-[#cfb8c4] h-24"
                            style={fieldStyle}
                            placeholder="输入测试文本"
                            value={testInput}
                            onChange={e => setTestInput(e.target.value)}
                        />
                        {testInput && (
                            <div className="mt-2.5 rounded-[14px] px-3 py-3 min-h-[3rem] whitespace-pre-wrap break-words text-[12px] leading-relaxed" style={{ background: '#fff4f7', color: '#5a3140', border: `1px solid ${EDGE}` }}>
                                <div className="mb-1.5 flex items-center gap-1.5 text-[10px] tracking-[0.18em] uppercase" style={{ ...MONO_STACK, color: '#b07a8d' }}>
                                    <Play size={11} weight="fill" /> Output
                                </div>
                                {testOutput || <span style={{ color: PAPER_TONES.inkFaint }}>结果为空</span>}
                            </div>
                        )}
                    </Entry>
                </Page>
            </div>

            <div className="absolute bottom-0 inset-x-0 z-20 px-3 pt-3 flex gap-2.5" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 14px)', background: 'linear-gradient(180deg, transparent, rgba(250,250,250,0.96) 36%, #fafafa)' }}>
                <button
                    onClick={onClose}
                    className="flex-1 rounded-full py-3 text-[13px] font-bold active:scale-[0.98] transition-transform"
                    style={{ background: '#fffdfa', color: PAPER_TONES.inkSoft, border: `1px solid ${EDGE}`, ...CUTE_STACK }}
                >
                    取消
                </button>
                <button
                    onClick={onSave}
                    className="flex-1 rounded-full py-3 text-[13px] font-bold active:scale-[0.98] transition-transform"
                    style={{ background: ROSE, color: '#fff', boxShadow: '0 10px 22px -14px rgba(122,90,114,0.45)', ...CUTE_STACK }}
                >
                    <span className="inline-flex items-center gap-1.5"><FloppyDisk size={15} weight="bold" /> 保存</span>
                </button>
            </div>
        </div>
    );
};

export default RegexEditor;
