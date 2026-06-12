import React, { useEffect, useState } from 'react';
import { resolveThinkingChainStyle, ThinkingChainStyleId } from './MessageItem';
import JournalSheet, { SealBtn, CandyToggle, LinedInput, LinedArea, NoteStrip } from './JournalSheet';
import { MONO_STACK, CUTE_STACK, PAPER_TONES } from '../handbook/paper';

interface ThinkingChainSettingsValue {
    enabled: boolean;
    styleId: ThinkingChainStyleId;
    customColors: { bg: string; accent: string; text: string };
    customPrompt: string;
}

interface Props {
    isOpen: boolean;
    onClose: () => void;
    value: ThinkingChainSettingsValue;
    onChange: (next: Partial<ThinkingChainSettingsValue>) => void;
}

const SAMPLE_CHAIN = '又叫乖乖猫咪……烦死了。算了也没那么烦，比起这个——午饭吃没吃？她又拿力学所当借口，呵，老一套。算了，先骂一句再问。';

const STYLE_LIST: Array<{ id: ThinkingChainStyleId; name: string; sub: string }> = [
    { id: 'echo',    name: '夜批', sub: '深夜墨纸 × 烫金批注' },
    { id: 'whisper', name: '信笺', sub: '奶油信纸 × 玫瑰小字' },
    { id: 'minimal', name: '便签', sub: '白纸黑字，素面朝天' },
    { id: 'custom',  name: '自调', sub: '三种颜色自己配' },
];

const ColorField: React.FC<{ label: string; value: string; onChange: (v: string) => void }> = ({ label, value, onChange }) => (
    <label className="flex items-center gap-3 text-[12px]">
        <span className="w-10 shrink-0 font-bold" style={{ ...CUTE_STACK, color: PAPER_TONES.inkSoft }}>{label}</span>
        <input
            type="color"
            value={value.startsWith('#') ? value : '#1f2937'}
            onChange={e => onChange(e.target.value)}
            className="w-8 h-8 rounded cursor-pointer"
            style={{ border: '1px dashed #ddc9d3' }}
        />
        <input
            type="text"
            value={value}
            onChange={e => onChange(e.target.value)}
            className="flex-1 px-1 py-1.5 bg-transparent text-[11px] outline-none border-0 border-b border-dashed border-[#dcc3cf] focus:border-[#f29db0] placeholder:text-[#cfb8c4]"
            style={{ ...MONO_STACK, color: PAPER_TONES.ink, caretColor: '#f29db0' }}
            placeholder="#rrggbb 或 css 渐变"
        />
    </label>
);

// 折叠态 + 展开态的迷你预览，用 resolveThinkingChainStyle 渲染，避免重复样式逻辑
const StylePreview: React.FC<{ styleId: ThinkingChainStyleId; customColors: ThinkingChainSettingsValue['customColors']; compact?: boolean }> = ({ styleId, customColors, compact }) => {
    const spec = resolveThinkingChainStyle(styleId, customColors);
    return (
        <div
            className="relative overflow-hidden"
            style={{
                background: spec.bg,
                border: `1px solid ${spec.border}`,
                borderRadius: spec.radius,
                padding: compact ? '6px 8px' : '10px 12px',
            }}
        >
            {spec.showCorners && (
                <>
                    <span aria-hidden className="absolute top-1 left-1 w-1.5 h-1.5 border-t border-l" style={{ borderColor: spec.accent }} />
                    <span aria-hidden className="absolute top-1 right-1 w-1.5 h-1.5 border-t border-r" style={{ borderColor: spec.accent }} />
                    <span aria-hidden className="absolute bottom-1 left-1 w-1.5 h-1.5 border-b border-l" style={{ borderColor: spec.accent }} />
                    <span aria-hidden className="absolute bottom-1 right-1 w-1.5 h-1.5 border-b border-r" style={{ borderColor: spec.accent }} />
                </>
            )}
            <div className="relative flex items-center gap-1.5">
                <span style={{ color: spec.accent, fontSize: compact ? 9 : 11, letterSpacing: '0.3em', fontFamily: spec.fontFamily, fontWeight: 600 }}>
                    {spec.titleZh}
                </span>
                <span style={{ color: spec.text, opacity: 0.6, fontSize: compact ? 6 : 7, letterSpacing: '0.25em' }}>
                    {spec.titleEn}
                </span>
            </div>
            {!compact && (
                <div
                    className={`mt-1 truncate ${spec.italic ? 'italic' : ''}`}
                    style={{ color: spec.text, fontFamily: spec.fontFamily, fontSize: 10.5 }}
                >
                    <span style={{ color: spec.accent }}>{spec.quoteLeft}</span>
                    {SAMPLE_CHAIN.slice(0, 24)}…
                    <span style={{ color: spec.accent }}>{spec.quoteRight}</span>
                </div>
            )}
        </div>
    );
};

/** 小节标头：打字机角标，与手账纸页统一 */
const SectionTag: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="text-[9px] mb-2 tracking-[0.22em] uppercase select-none" style={{ ...MONO_STACK, color: PAPER_TONES.inkFaint }}>{children}</div>
);

const ThinkingChainSettingsModal: React.FC<Props> = ({ isOpen, onClose, value, onChange }) => {
    const [draftPrompt, setDraftPrompt] = useState(value.customPrompt || '');
    useEffect(() => { if (isOpen) setDraftPrompt(value.customPrompt || ''); }, [isOpen, value.customPrompt]);

    const commitPrompt = () => onChange({ customPrompt: draftPrompt });
    const closeAndCommit = () => { commitPrompt(); onClose(); };

    return (
        <JournalSheet
            open={isOpen} title="看看思绪" en="Marginalia" tall zClass="z-[200]"
            sub="TA 回话之前，在页边写下的小字"
            tape="sky" pattern="star" paper="lined"
            onClose={closeAndCommit}
            footer={<SealBtn kind="rose" full onClick={closeAndCommit}>记好了</SealBtn>}
        >
            <div className="space-y-5">
                {/* 0. 这是什么 / 看不见怎么办 */}
                <NoteStrip tone="warn">
                    <div className="font-bold mb-1 text-[11px]" style={{ color: '#b08f3a' }}>先讲清楚：「思绪」到底是什么</div>
                    <p>
                        它是模型<b>自己原生吐出来的思考链</b>——
                        <code className="px-1 py-0.5 mx-0.5 rounded bg-white text-[10px]" style={{ ...MONO_STACK, border: '1px dashed #ecd9a0', color: '#b08f3a' }}>reasoning_content</code>
                        字段或
                        <code className="px-1 py-0.5 mx-0.5 rounded bg-white text-[10px]" style={{ ...MONO_STACK, border: '1px dashed #ecd9a0', color: '#b08f3a' }}>&lt;think&gt;</code>
                        标签里的内容。<b>不是我们额外让模型替角色编的内心戏</b>，而是它组织回话时本来就打的草稿。
                    </p>
                    <p className="mt-2">
                        正因为这个本性——<b>它读起来不会像台词那样鲜活</b>，更像演员在后台的碎碎念，而不是舞台上的戏。
                        这功能本来就是留给爱看大模型思维链的人的小彩蛋，<b>不见得合每个人口味</b>。
                    </p>
                    <p className="mt-2">
                        还有一条同样由本性决定：思绪<b>不进上下文</b>，也<b>不算正式回复的一部分</b>——它只是这一轮的念头。
                        所以<b>下一轮 TA 不会记得上一轮想过什么</b>，只会顺着真正发出去的那句话（和聊天记录）往下走。
                    </p>
                    <p className="mt-2">
                        看着跳戏、出戏、太「AI」？直接关掉就好，一点损失都没有，回复本身完全不受影响。
                    </p>
                    <p className="mt-2" style={{ color: PAPER_TONES.inkFaint }}>看不懂上面在讲什么？去问给你 API 的人，他/她讲得比这里清楚。</p>
                    <div className="mt-2.5 pt-2.5" style={{ borderTop: '1px dashed #ecd9a0' }}>
                        <div className="font-bold mb-1 text-[11px]" style={{ color: '#b08f3a' }}>开了却一直没看到「思绪」卡片？</div>
                        <ul className="list-disc pl-4 space-y-0.5">
                            <li><b>你的模型不带思考链</b> → 问 API 提供者哪些模型支持 thinking，或自己查一查</li>
                            <li><b>这一轮模型没思考</b>（回复短 / 它自己觉得不用想）→ 正常现象，下一轮可能就有</li>
                            <li><b>代理不转发 thinking 字段</b> → 找 API 方确认对应模型有没有开 extended thinking</li>
                        </ul>
                    </div>
                    <div className="mt-2.5 pt-2.5" style={{ borderTop: '1px dashed #ecd9a0' }}>
                        <div className="font-bold mb-1 text-[11px]" style={{ color: '#b08f3a' }}>思绪总是英文怎么办？</div>
                        <p>
                            这通常<b>不怪模型本身</b>——同一个模型走官方直连（Anthropic / OpenAI / 智谱等）能好好说中文，
                            多半是中转 API 把 system prompt 截短或改写了。可以试试：
                        </p>
                        <ul className="list-disc pl-4 space-y-0.5 mt-1">
                            <li>在下面「追加叮嘱」里补一句硬话：「thinking 必须中文，禁止英文」</li>
                            <li>直接在聊天里跟角色说一句「用中文想」</li>
                            <li>换一条更稳的渠道</li>
                        </ul>
                    </div>
                </NoteStrip>

                {/* 1. 总开关 */}
                <div className="flex items-start justify-between gap-3 cursor-pointer" onClick={() => onChange({ enabled: !value.enabled })}>
                    <div className="min-w-0 pointer-events-none">
                        <div className="flex items-center gap-1.5">
                            <span className="text-[11px] leading-none" style={{ color: PAPER_TONES.accentBlush }} aria-hidden>✎</span>
                            <span className="text-[12.5px] font-bold" style={{ ...CUTE_STACK, color: PAPER_TONES.ink }}>让页边小字现身</span>
                        </div>
                        <p className="text-[10px] mt-1 leading-relaxed" style={{ color: PAPER_TONES.inkSoft }}>
                            关掉后，新回复不再贴「思绪」卡片；以前消息上已有的照旧留着。
                        </p>
                    </div>
                    <CandyToggle on={value.enabled} onToggle={() => onChange({ enabled: !value.enabled })} candy="#9dc1d5" />
                </div>

                {/* 2. 卡片风格 */}
                <div>
                    <SectionTag>卡片穿什么</SectionTag>
                    <div className="grid grid-cols-2 gap-2.5">
                        {STYLE_LIST.map(item => {
                            const active = value.styleId === item.id;
                            return (
                                <button
                                    key={item.id}
                                    onClick={() => onChange({ styleId: item.id })}
                                    className="text-left p-2 transition-all active:scale-[0.97]"
                                    style={{
                                        background: active ? '#fdeef3' : 'rgba(255,253,250,0.7)',
                                        border: active ? '1.5px solid #e6a3b8' : '1px dashed #ddc9d3',
                                        borderRadius: '8px 14px 9px 14px',
                                        boxShadow: active ? '0 1px 3px rgba(122,90,114,0.2)' : 'none',
                                    }}
                                >
                                    <StylePreview styleId={item.id} customColors={value.customColors} compact />
                                    <div className="mt-1.5 flex items-baseline gap-1.5">
                                        {active && <span aria-hidden className="text-[10px]">📌</span>}
                                        <span className="text-[12px] font-bold" style={{ ...CUTE_STACK, color: active ? '#8a3d55' : PAPER_TONES.inkSoft }}>{item.name}</span>
                                        <span className="text-[9px]" style={{ color: PAPER_TONES.inkFaint }}>{item.sub}</span>
                                    </div>
                                </button>
                            );
                        })}
                    </div>

                    {value.styleId === 'custom' && (
                        <div className="mt-3 p-3 space-y-2.5 rounded-[8px]" style={{ background: 'rgba(255,253,250,0.7)', border: '1px dashed #ddc9d3' }}>
                            <SectionTag>三色自己配</SectionTag>
                            <ColorField
                                label="底色"
                                value={value.customColors.bg}
                                onChange={bg => onChange({ customColors: { ...value.customColors, bg } })}
                            />
                            <ColorField
                                label="点缀"
                                value={value.customColors.accent}
                                onChange={accent => onChange({ customColors: { ...value.customColors, accent } })}
                            />
                            <ColorField
                                label="字色"
                                value={value.customColors.text}
                                onChange={text => onChange({ customColors: { ...value.customColors, text } })}
                            />
                            <div className="text-[9.5px] leading-relaxed" style={{ color: PAPER_TONES.inkFaint }}>
                                底色支持 CSS 渐变（例：linear-gradient(135deg, #1a1a2e, #16213e)）。
                            </div>
                        </div>
                    )}

                    {/* 实时大预览 */}
                    <div className="mt-3 px-1">
                        <SectionTag>现在长这样</SectionTag>
                        <StylePreview styleId={value.styleId} customColors={value.customColors} />
                    </div>
                </div>

                {/* 3. 追加提示词 */}
                <div>
                    <SectionTag>追加叮嘱</SectionTag>
                    <p className="text-[10px] mb-2 leading-relaxed" style={{ color: PAPER_TONES.inkSoft }}>
                        原生提示词（让模型用角色第一人称、中文意识流来想）原样不动；这里写的会<b>追在最后</b>，算你对这段内心独白的额外要求。
                    </p>
                    <LinedArea
                        value={draftPrompt}
                        onChange={e => setDraftPrompt(e.target.value)}
                        onBlur={commitPrompt}
                        placeholder="比如：想事情时偶尔蹦句日语 / 多写点感官细节 / 想到用户时要用昵称…"
                        className="h-28"
                    />
                    <div className="text-[9.5px] mt-1" style={{ color: PAPER_TONES.inkFaint }}>空着 = 只用原生提示词。</div>
                </div>
            </div>
        </JournalSheet>
    );
};

export default ThinkingChainSettingsModal;
export type { ThinkingChainSettingsValue };
