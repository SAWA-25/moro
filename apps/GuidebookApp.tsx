
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useOS } from '../context/OSContext';
import { CharacterProfile, GuidebookSession, GuidebookRound, GuidebookOption } from '../types';
import { extractJson } from '../utils/safeApi';
import { injectMemoryPalace } from '../utils/memoryPalace/pipeline';
import {
    buildOpeningPrompt,
    buildRoundPrompt,
    buildOptionAssistPrompt,
    buildEndCardPrompt,
} from '../utils/guidebookPrompts';
import { DB } from '../utils/db';
import {
    ArrowLeft,
    ArrowRight,
    Heart,
    CaretUp,
    CaretDown,
    CaretRight,
    PencilSimple,
    Sparkle,
    FlowerLotus,
    Star,
    Diamond,
    DiamondsFour,
    Cards,
} from '@phosphor-icons/react';
import { PaperBackdrop, WashiTape, Stamp, WASHI, INK, INK_SOFT, PAGE_BG, TAPE_STRIPES, type WashiColor } from './theater/scrapbook';

// --- Helper: Generate ID ---
const genId = () => Math.random().toString(36).slice(2, 10);

// --- Helper: API Call ---
async function callAPI(apiConfig: { baseUrl: string; apiKey: string; model: string }, prompt: string): Promise<string> {
    const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
        body: JSON.stringify({
            model: apiConfig.model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.9,
            max_tokens: 4000,
            stream: false,
        }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    let json: any;
    try { json = JSON.parse(text); } catch {
        json = JSON.parse(text.replace(/^data: /, '').trim());
    }
    return json?.choices?.[0]?.message?.content?.trim() || '';
}

// --- Helper: Fetch recent messages as text (uses char.contextLimit) ---
async function fetchRecentMessages(charId: string, limit: number): Promise<string> {
    if (limit <= 0) return '';
    try {
        const msgs = await DB.getRecentMessagesByCharId(charId, limit);
        const privateMsgs = msgs.filter(m => !m.groupId && (m.type === 'text' || m.type === 'voice'));
        if (privateMsgs.length === 0) return '';
        return privateMsgs.map(m =>
            `[${m.role === 'user' ? 'User' : 'Char'}] ${m.content.replace(/\n/g, ' ').slice(0, 120)}`
        ).join('\n');
    } catch { return ''; }
}

// --- Helper: Extract established world context from opening segments ---
function extractWorldContext(openingSequence?: string): string {
    if (!openingSequence) return '';
    try {
        const segments: { speaker: string; text: string }[] = JSON.parse(openingSequence);
        // Collect GM narrations as the established world/scene
        const gmParts = segments.filter(s => s.speaker === 'gm').map(s => s.text);
        if (gmParts.length === 0) return '';
        return gmParts.join('\n');
    } catch { return ''; }
}

// --- Helper: Format date ---
const fmtDate = (ts: number) => {
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
};

// --- Long Press Hook ---
function useLongPress(callback: () => void, ms = 500) {
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const movedRef = useRef(false);
    const startPos = useRef({ x: 0, y: 0 });

    const start = useCallback((e: React.TouchEvent | React.MouseEvent) => {
        movedRef.current = false;
        const pos = 'touches' in e ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : { x: (e as React.MouseEvent).clientX, y: (e as React.MouseEvent).clientY };
        startPos.current = pos;
        timerRef.current = setTimeout(() => {
            if (!movedRef.current) callback();
        }, ms);
    }, [callback, ms]);

    const move = useCallback((e: React.TouchEvent | React.MouseEvent) => {
        const pos = 'touches' in e ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : { x: (e as React.MouseEvent).clientX, y: (e as React.MouseEvent).clientY };
        if (Math.abs(pos.x - startPos.current.x) > 10 || Math.abs(pos.y - startPos.current.y) > 10) {
            movedRef.current = true;
            if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
        }
    }, []);

    const end = useCallback(() => {
        if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    }, []);

    return { onTouchStart: start, onTouchMove: move, onTouchEnd: end, onMouseDown: start, onMouseMove: move, onMouseUp: end };
}

// 选中项高亮（和纸琥珀色）/ 好感增减小章
const chosenOptionStyle: React.CSSProperties = {
    background: 'linear-gradient(135deg, rgba(245,228,190,0.9), rgba(238,216,170,0.8))',
    border: `2px solid ${WASHI.amber.edge}`,
    color: '#5a4a34',
};
const affinityChip = (d: number): React.CSSProperties =>
    d > 0 ? { background: WASHI.sage.base, color: WASHI.sage.ink }
        : d < 0 ? { background: 'rgba(214,150,140,0.55)', color: '#9c4f47' }
            : { background: 'rgba(176,162,138,0.3)', color: INK_SOFT };

// 设置区纸卡底
const setupCardStyle: React.CSSProperties = {
    background: 'rgba(255,253,247,0.85)',
    border: '1px solid rgba(196,184,160,0.7)',
    outline: '1px dashed rgba(176,162,138,0.4)',
    outlineOffset: -5,
    boxShadow: '0 10px 20px -16px rgba(70,62,48,0.4)',
};
// 纸面弹窗 / 底部抽屉底
const paperDialogStyle: React.CSSProperties = {
    background: 'linear-gradient(180deg,#fdfaf3,#f5eedd)',
    border: '1px solid rgba(196,184,160,0.85)',
    borderRadius: 16,
    boxShadow: '0 28px 50px -20px rgba(40,34,26,0.55)',
    transform: 'rotate(-0.6deg)',
};
const sheetStyle: React.CSSProperties = {
    background: 'linear-gradient(180deg,#fdfaf3,#f5eedd)',
    borderTop: '1px solid rgba(196,184,160,0.8)',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    boxShadow: '0 -22px 48px -20px rgba(40,34,26,0.5)',
};

// ========== 拼贴手账 UI 组件 ==========

// 纸页外壳（牛皮纸 + 纸纹 + 角落胶带）
const GameFrame: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
    <div className={`relative w-full h-full flex flex-col overflow-hidden ${className}`}
        style={{ paddingTop: 'var(--safe-top)', color: INK, background: PAGE_BG }}>
        <PaperBackdrop />
        {children}
    </div>
);

// 顶栏：胶带返回钮 + 拍立得小头像 + 标题 + 好感火漆章
const GameHeader: React.FC<{
    title: string;
    subtitle?: string;
    onBack: () => void;
    affinity?: number | null;
    charAvatar?: string;
}> = ({ title, subtitle, onBack, affinity, charAvatar }) => (
    <div className="shrink-0 relative z-20 px-4 pt-2.5 pb-2.5">
        <div className="flex items-center gap-2.5">
            <button onClick={onBack} className="relative inline-flex items-center justify-center w-8 h-8 active:scale-90 transition-transform" style={{ color: '#5b4d3a' }}>
                <span aria-hidden className="absolute inset-0 rounded-[6px]" style={{ backgroundColor: WASHI.butter.base, backgroundImage: 'repeating-linear-gradient(90deg, rgba(255,255,255,0.16) 0 5px, transparent 5px 11px)', transform: 'rotate(-3deg)', boxShadow: '0 3px 7px -3px rgba(70,62,48,0.5)' }} />
                <ArrowLeft size={15} weight="bold" className="relative z-10" />
            </button>
            {charAvatar && (
                <span className="relative shrink-0" style={{ transform: 'rotate(-3deg)' }}>
                    <img src={charAvatar} className="w-9 h-9 object-cover" style={{ borderRadius: 4, border: '2px solid #fffdf8', boxShadow: '0 3px 7px -3px rgba(70,62,48,0.5)' }} />
                </span>
            )}
            <div className="flex-1 min-w-0">
                <div className="text-sm font-black truncate" style={{ color: INK }}>{title}</div>
                {subtitle && <div className="text-[10px] tracking-wide" style={{ color: INK_SOFT }}>{subtitle}</div>}
            </div>
            {affinity != null && (
                <div className="inline-flex items-center gap-0.5 px-2.5 py-1 rounded-full text-xs font-black" style={{
                    background: affinity >= 0 ? WASHI.rose.base : WASHI.sky.base,
                    color: affinity >= 0 ? WASHI.rose.ink : WASHI.sky.ink,
                }}>
                    <Heart size={11} weight="fill" />{affinity}
                </div>
            )}
        </div>
        <div aria-hidden className="mt-2 h-px" style={{ backgroundImage: 'repeating-linear-gradient(90deg, rgba(150,140,120,0.5) 0 5px, transparent 5px 10px)' }} />
    </div>
);

// 纸卡（缝线奶白卡，保留 className/style/onClick 透传）
const Card: React.FC<{ children: React.ReactNode; className?: string; onClick?: () => void; style?: React.CSSProperties }> = ({ children, className = '', onClick, style }) => (
    <div onClick={onClick}
        className={`relative ${onClick ? 'active:scale-[0.98] cursor-pointer' : ''} transition-all ${className}`}
        style={{
            background: 'linear-gradient(180deg, #fdfaf3, #f7f0e2)',
            border: '1px solid rgba(196,184,160,0.7)',
            outline: '1px dashed rgba(176,162,138,0.45)',
            outlineOffset: '-5px',
            borderRadius: 16,
            boxShadow: '0 12px 24px -16px rgba(70,62,48,0.42), 0 2px 0 rgba(255,255,255,0.6) inset',
            ...style,
        }}>
        {children}
    </div>
);

// 好感进度条（缝线针脚填充）
const StatBar: React.FC<{ label: string; value: number; max?: number; color?: string }> = ({ label, value, max = 100, color = 'warm' }) => {
    const pct = Math.min(Math.max((value + 100) / 200 * 100, 0), 100);
    const fillMap: Record<string, string> = {
        warm: WASHI.rose.base, blue: WASHI.sky.base, green: WASHI.sage.base, purple: WASHI.lilac.base,
    };
    return (
        <div className="flex items-center gap-2">
            <span className="text-[10px] font-black w-14 text-right shrink-0" style={{ color: INK_SOFT }}>{label}</span>
            <div className="flex-1 h-3 rounded-full overflow-hidden" style={{ background: 'rgba(176,162,138,0.28)', border: '1px solid rgba(196,184,160,0.6)' }}>
                <div className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${pct}%`, background: fillMap[color] || fillMap.warm, backgroundImage: 'repeating-linear-gradient(90deg, rgba(255,255,255,0.25) 0 3px, transparent 3px 7px)' }} />
            </div>
            <span className="text-[10px] font-black w-8" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>{value}</span>
        </div>
    );
};

// --- Animated Text Display ---
const TypewriterSegments: React.FC<{
    segments: { speaker: string; text: string }[];
    charName: string;
    onDone: () => void;
}> = ({ segments, charName, onDone }) => {
    const [visibleCount, setVisibleCount] = useState(0);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (visibleCount < segments.length) {
            const delay = 600 + Math.random() * 800;
            const timer = setTimeout(() => setVisibleCount(v => v + 1), delay);
            return () => clearTimeout(timer);
        } else {
            const timer = setTimeout(onDone, 500);
            return () => clearTimeout(timer);
        }
    }, [visibleCount, segments.length]);

    useEffect(() => {
        containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight, behavior: 'smooth' });
    }, [visibleCount]);

    return (
        <div ref={containerRef} className="flex-1 overflow-y-auto p-4 space-y-3 no-scrollbar">
            {segments.slice(0, visibleCount).map((seg, i) => (
                <SegmentBubble key={i} seg={seg} charName={charName} />
            ))}
            {visibleCount < segments.length && (
                <div className="flex items-center gap-1.5 text-xs" style={{ color: INK_SOFT }}>
                    <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#3a3630' }} />
                    <span>{segments[visibleCount]?.speaker === 'gm' ? 'GM' : charName} 正在说话...</span>
                </div>
            )}
        </div>
    );
};

// --- Segment Bubble (game dialogue style — warm neutral) ---
const SegmentBubble: React.FC<{ seg: { speaker: string; text: string }; charName: string }> = ({ seg, charName }) => (
    <div className="animate-fade-in">
        {seg.speaker === 'gm' ? (
            <div className="rounded-xl px-3 py-2" style={{ background: 'linear-gradient(180deg,#fdfaf3,#f5eedd)', border: '1px solid rgba(196,184,160,0.6)', boxShadow: '0 5px 11px -9px rgba(70,62,48,0.4)' }}>
                <span className="text-[10px] font-black mr-1.5 px-1.5 py-0.5 rounded tracking-wider" style={{ fontFamily: 'var(--font-label)', color: '#fcf8ef', background: '#3a3630' }}>GM</span>
                <span className="text-xs leading-relaxed" style={{ color: '#5b5346' }}>{seg.text}</span>
            </div>
        ) : (
            <div className="rounded-xl px-3 py-2 ml-4" style={{ background: WASHI.rose.base, border: `1px solid ${WASHI.rose.edge}`, boxShadow: '0 5px 11px -9px rgba(120,70,64,0.4)' }}>
                <span className="text-[10px] font-black mr-1.5 inline-flex items-center gap-0.5" style={{ color: WASHI.rose.ink }}><Heart size={10} weight="fill" /> {charName}</span>
                <span className="text-sm leading-relaxed" style={{ color: '#5a3a36' }}>{seg.text}</span>
            </div>
        )}
    </div>
);

// --- Round Display ---
const RoundDisplay: React.FC<{
    round: GuidebookRound;
    charName: string;
    isLatest: boolean;
    onLongPress?: () => void;
    isReplay?: boolean;
}> = ({ round, charName, isLatest, onLongPress, isReplay }) => {
    const chosen = round.options[round.charChoice];
    const affinityDiff = round.affinityAfter - round.affinityBefore;
    const longPressHandlers = useLongPress(() => onLongPress?.(), 500);
    const [expanded, setExpanded] = useState(false);

    return (
        <div
            className={`${isLatest && !isReplay ? 'animate-fade-in' : ''}`}
            {...(onLongPress ? longPressHandlers : {})}
        >
            <Card className="p-3 space-y-2.5">
                {/* 回合页眉 — 点一下展开 */}
                <button className="w-full flex items-center gap-2" onClick={() => setExpanded(e => !e)}>
                    <div className="w-6 h-6 rounded-[6px] flex items-center justify-center text-[10px] font-black" style={{ background: '#3a3630', color: '#fcf8ef' }}>
                        {round.roundNumber}
                    </div>
                    <div className="h-px flex-1" style={{ backgroundImage: 'repeating-linear-gradient(90deg, rgba(150,140,120,0.5) 0 5px, transparent 5px 10px)' }} />
                    <div className="text-xs font-black px-2 py-0.5 rounded-full" style={affinityChip(affinityDiff)}>
                        {affinityDiff >= 0 ? '+' : ''}{affinityDiff}
                    </div>
                    <span className="text-[10px] shrink-0" style={{ color: INK_SOFT }}>{expanded ? <CaretUp size={12} weight="bold" /> : <CaretDown size={12} weight="bold" />}</span>
                </button>

                {/* GM 旁白 — 常驻 */}
                <div className="rounded-lg px-2.5 py-1.5" style={{ background: 'linear-gradient(180deg,#fdfaf3,#f5eedd)', border: '1px solid rgba(196,184,160,0.55)' }}>
                    <span className="text-[9px] font-black mr-1 px-1 py-0.5 rounded tracking-wider" style={{ fontFamily: 'var(--font-label)', color: '#fcf8ef', background: '#3a3630' }}>GM</span>
                    <span className="text-[11px]" style={{ color: '#5b5346' }}>{round.gmNarration}</span>
                </div>

                {/* 收起态：只显示被选中的那项 + 简短反应 */}
                {!expanded && (
                    <div className="space-y-1.5">
                        <div className="text-xs px-2.5 py-2 rounded-xl flex items-center gap-2" style={chosenOptionStyle}>
                            <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black shrink-0" style={{ background: '#fffdf8', color: INK, border: '1px solid rgba(196,184,160,0.7)' }}>
                                {String.fromCharCode(65 + round.charChoice)}
                            </span>
                            <span className="flex-1 truncate">{chosen?.text}</span>
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full font-black shrink-0" style={{ background: '#3a3630', color: '#fcf8ef' }}>
                                <ArrowLeft size={10} className="inline" /> {charName}
                            </span>
                            <span className="text-[10px] font-black shrink-0" style={{ fontFamily: 'var(--font-label)', color: (chosen?.affinity || 0) >= 0 ? WASHI.sage.ink : '#9c4f47' }}>
                                {(chosen?.affinity || 0) >= 0 ? '+' : ''}{chosen?.affinity}
                            </span>
                        </div>
                        <div className="rounded-lg px-2.5 py-1.5" style={{ background: WASHI.rose.base, border: `1px solid ${WASHI.rose.edge}` }}>
                            <span className="font-black text-[11px] mr-1 inline-flex items-center gap-0.5" style={{ color: WASHI.rose.ink }}><Heart size={11} weight="fill" /> {charName}</span>
                            <span className="text-xs" style={{ color: '#5a3a36' }}>{round.charReaction}</span>
                        </div>
                    </div>
                )}

                {/* 展开态：完整细节 */}
                {expanded && (
                    <>
                        {/* 选项 */}
                        <div className="space-y-1.5">
                            {round.options.map((opt, i) => (
                                <div key={i} className="text-xs px-2.5 py-2 rounded-xl transition-all flex items-center gap-2"
                                    style={i === round.charChoice ? chosenOptionStyle : {
                                        background: 'rgba(255,253,247,0.55)',
                                        border: '1px dashed rgba(176,162,138,0.5)',
                                        color: 'rgba(91,83,70,0.55)',
                                    }}>
                                    <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black shrink-0" style={{ background: '#fffdf8', color: INK, border: '1px solid rgba(196,184,160,0.7)' }}>
                                        {String.fromCharCode(65 + i)}
                                    </span>
                                    <span className="flex-1">{opt.text}</span>
                                    {i === round.charChoice && (
                                        <span className="text-[9px] px-1.5 py-0.5 rounded-full font-black shrink-0" style={{ background: '#3a3630', color: '#fcf8ef' }}>
                                            <ArrowLeft size={10} className="inline" /> {charName}
                                        </span>
                                    )}
                                    <span className="text-[10px] font-black shrink-0" style={{ fontFamily: 'var(--font-label)', color: opt.affinity >= 0 ? WASHI.sage.ink : '#9c4f47' }}>
                                        {opt.affinity >= 0 ? '+' : ''}{opt.affinity}
                                    </span>
                                </div>
                            ))}
                        </div>

                        {/* 内心 OS & 预判 */}
                        <div className="rounded-lg px-2.5 py-2" style={{ background: WASHI.lilac.base, border: `1px solid ${WASHI.lilac.edge}` }}>
                            <div className="text-[9px] font-black mb-0.5" style={{ color: WASHI.lilac.ink }}>内心 OS &amp; 预判</div>
                            <div className="text-[11px] italic leading-relaxed" style={{ color: '#5a4f70' }}>{round.charInnerThought}</div>
                        </div>

                        {/* 好感进度 */}
                        <div className="flex items-center gap-2">
                            <span className="text-[10px]" style={{ color: INK_SOFT }}>好感度</span>
                            <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'rgba(176,162,138,0.28)' }}>
                                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(Math.abs(affinityDiff) * 3, 100)}%`, background: affinityDiff >= 0 ? WASHI.sage.base : 'rgba(214,150,140,0.7)', backgroundImage: 'repeating-linear-gradient(90deg, rgba(255,255,255,0.25) 0 3px, transparent 3px 7px)' }} />
                            </div>
                            <span className="text-[10px]" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>{round.affinityBefore}<ArrowRight size={10} className="inline" />{round.affinityAfter}</span>
                        </div>

                        {/* 反应 */}
                        <div className="rounded-lg px-2.5 py-2" style={{ background: WASHI.rose.base, border: `1px solid ${WASHI.rose.edge}` }}>
                            <span className="font-black text-[11px] mr-1 inline-flex items-center gap-0.5" style={{ color: WASHI.rose.ink }}><Heart size={11} weight="fill" /> {charName}</span>
                            <span className="text-xs" style={{ color: '#5a3a36' }}>{round.charReaction}</span>
                        </div>

                        {/* 关于你的发现 */}
                        {round.charInsight && (
                            <div className="rounded-xl px-3 py-2.5" style={{ background: WASHI.sky.base, border: `1px solid ${WASHI.sky.edge}` }}>
                                <div className="text-[9px] font-black mb-1 flex items-center gap-1" style={{ color: WASHI.sky.ink }}>
                                    <Diamond size={12} weight="fill" /> 关于你的发现
                                </div>
                                <div className="text-xs leading-relaxed italic" style={{ color: '#3a5a72' }}>
                                    {round.charInsight}
                                </div>
                            </div>
                        )}

                        {/* 深入探讨 */}
                        {round.charExploration && (
                            <div className="rounded-xl px-3 py-2.5" style={{ background: WASHI.butter.base, border: `1px solid ${WASHI.butter.edge}` }}>
                                <div className="text-[9px] font-black mb-1 flex items-center gap-1" style={{ color: WASHI.butter.ink }}>
                                    <Sparkle size={12} weight="fill" /> 深入探讨
                                </div>
                                <div className="text-xs leading-relaxed" style={{ color: '#6a5a35' }}>
                                    <span className="font-black mr-1" style={{ color: WASHI.butter.ink }}>{charName}:</span>{round.charExploration}
                                </div>
                            </div>
                        )}
                    </>
                )}
            </Card>
        </div>
    );
};

// --- End Card ---
const EndCard: React.FC<{
    session: GuidebookSession;
    charName: string;
    charAvatar: string;
    onClose: () => void;
    onSendToChat: () => void;
}> = ({ session, charName, charAvatar, onClose, onSendToChat }) => {
    const [expanded, setExpanded] = useState(false);
    if (!session.endCard) return null;
    const { title, finalAffinity, charVerdict, highlights, charSummary } = session.endCard;
    const diff = finalAffinity - session.initialAffinity;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in">
            <div className="absolute inset-0" style={{ background: 'rgba(46,40,32,0.45)', backdropFilter: 'blur(3px)' }} onClick={onClose} />
            <div className="relative w-full max-w-sm max-h-[85vh] overflow-y-auto no-scrollbar animate-pop-in"
                style={{ background: 'linear-gradient(180deg, #fdfaf3, #f4ecda)', border: '1px solid rgba(196,184,160,0.85)', outline: '1px dashed rgba(176,162,138,0.5)', outlineOffset: -6, borderRadius: 20, boxShadow: '0 32px 60px -22px rgba(40,34,26,0.6)', transform: 'rotate(-0.5deg)' }}>
                <WashiTape color="rose" rotate={-5} className="absolute -top-3 left-1/2 -translate-x-1/2 w-28 h-6 rounded-[2px] z-10" />
                {/* 报告页眉：拍立得头像 */}
                <div className="text-center pt-7 pb-3 px-5 relative">
                    {charAvatar ? (
                        <span className="inline-block p-1.5 pb-3 mb-2" style={{ background: '#fffdf8', border: '1px solid rgba(196,184,160,0.8)', borderRadius: 6, boxShadow: '0 8px 16px -10px rgba(70,62,48,0.5)', transform: 'rotate(-2.5deg)' }}>
                            <img src={charAvatar} className="w-16 h-16 object-cover" style={{ borderRadius: 3 }} />
                        </span>
                    ) : (
                        <div className="w-16 h-16 rounded-[6px] flex items-center justify-center text-2xl font-black mx-auto mb-2" style={{ background: '#3a3630', color: '#fcf8ef' }}>
                            {charName[0]}
                        </div>
                    )}
                    <div className="text-[10px] font-black tracking-[0.34em] uppercase mb-1" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>攻略本 · 结算报告</div>
                    <div className="text-xl font-black" style={{ color: INK }}>「{title}」</div>
                </div>

                <div className="px-4 pb-4 space-y-3">
                    {/* 数值 */}
                    <Card className="p-3">
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="text-sm font-black" style={{ color: INK }}>{charName}</div>
                                <div className="text-[10px]" style={{ color: INK_SOFT }}>{session.rounds.length} 回合</div>
                            </div>
                            <div className="text-right">
                                <div className="text-2xl font-black" style={{ color: diff > 0 ? WASHI.sage.ink : diff < 0 ? '#9c4f47' : INK_SOFT }}>
                                    {finalAffinity}
                                </div>
                                <div className="text-[10px]" style={{ color: INK_SOFT }}>
                                    {diff >= 0 ? '+' : ''}{diff} 从 {session.initialAffinity}
                                </div>
                            </div>
                        </div>
                        <StatBar label="好感度" value={finalAffinity} color="warm" />
                    </Card>

                    {/* 一句话判词 */}
                    <Card className="p-3">
                        <div className="text-sm leading-relaxed italic" style={{ fontFamily: 'var(--font-display)', color: '#5b5346' }}>
                            “{charVerdict}”
                        </div>
                    </Card>

                    {/* 名场面 */}
                    {highlights.length > 0 && (
                        <Card className="p-3 space-y-1.5">
                            <div className="text-[10px] tracking-wider font-black flex items-center gap-1" style={{ color: WASHI.amber.ink }}>
                                <Star size={12} weight="fill" /> 名场面
                            </div>
                            {highlights.map((h, i) => (
                                <div key={i} className="text-xs flex gap-2 rounded-lg p-2" style={{ color: '#5b5346', background: WASHI.butter.base }}>
                                    <span className="shrink-0" style={{ color: WASHI.butter.ink }}><CaretRight size={12} weight="bold" /></span>
                                    <span>{h}</span>
                                </div>
                            ))}
                        </Card>
                    )}

                    {/* 这局游戏让我发现的你 */}
                    {session.endCard?.charNewInsight && (
                        <div className="rounded-2xl p-4" style={{ background: WASHI.sky.base, border: `1px solid ${WASHI.sky.edge}` }}>
                            <div className="text-[10px] font-black flex items-center gap-1 mb-2" style={{ color: WASHI.sky.ink }}>
                                <Diamond size={12} weight="fill" /> 这局游戏让我发现的你
                            </div>
                            <div className="text-sm leading-relaxed italic" style={{ color: '#2a4a62' }}>
                                {session.endCard.charNewInsight}
                            </div>
                        </div>
                    )}

                    {/* 真心话 */}
                    {charSummary && (
                        <button onClick={() => setExpanded(!expanded)} className="w-full text-left">
                            <div className="rounded-2xl p-3 transition-all" style={{ background: WASHI.rose.base, border: `1px solid ${WASHI.rose.edge}` }}>
                                <div className="flex items-center justify-between mb-1">
                                    <div className="text-[10px] font-black flex items-center gap-1" style={{ color: WASHI.rose.ink }}>
                                        <Heart size={12} weight="fill" /> {charName}的真心话
                                    </div>
                                    <span className="text-xs" style={{ color: WASHI.rose.ink }}>{expanded ? <CaretUp size={12} /> : <CaretDown size={12} />}</span>
                                </div>
                                <div className={`text-sm leading-relaxed ${expanded ? '' : 'line-clamp-2'}`} style={{ color: '#5a3a36' }}>
                                    {charSummary}
                                </div>
                            </div>
                        </button>
                    )}
                </div>

                {/* 操作 */}
                <div className="px-4 pb-4 pt-1 flex gap-2 sticky bottom-0" style={{ background: 'linear-gradient(0deg, #f4ecda 30%, transparent 100%)' }}>
                    <button onClick={onClose}
                        className="flex-1 py-2.5 text-sm font-black rounded-full active:scale-95 transition-transform" style={{ background: 'rgba(255,253,247,0.96)', color: '#6b6456', border: '1px solid rgba(196,184,160,0.85)' }}>
                        关闭
                    </button>
                    <button onClick={onSendToChat}
                        className="flex-1 py-2.5 text-sm font-black rounded-full active:scale-95 transition-transform" style={{ background: '#3a3630', color: '#fcf8ef', outline: '1px dashed rgba(255,255,255,0.3)', outlineOffset: -4 }}>
                        发送到聊天
                    </button>
                </div>
            </div>
        </div>
    );
};

// --- Session Card ---
const SessionCard: React.FC<{
    session: GuidebookSession;
    char?: CharacterProfile;
    onTap: () => void;
    onLongPress: () => void;
}> = ({ session, char, onTap, onLongPress }) => {
    const diff = session.currentAffinity - session.initialAffinity;
    const longPressHandlers = useLongPress(onLongPress, 500);
    const tappedRef = useRef(false);

    return (
        <Card className="p-3 active:scale-[0.98]"
            onClick={() => { if (!tappedRef.current) onTap(); }}>
            <div {...longPressHandlers}>
                <div className="flex items-center gap-3">
                    {char?.avatar ? (
                        <span className="shrink-0" style={{ transform: 'rotate(-2.5deg)' }}>
                            <img src={char.avatar} className="w-11 h-11 object-cover" style={{ borderRadius: 4, border: '2px solid #fffdf8', boxShadow: '0 4px 9px -5px rgba(70,62,48,0.5)' }} />
                        </span>
                    ) : (
                        <div className="w-11 h-11 rounded-[5px] flex items-center justify-center font-black shrink-0" style={{ background: '#3a3630', color: '#fcf8ef' }}>
                            {char?.name?.[0] || '?'}
                        </div>
                    )}
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-black truncate" style={{ color: INK }}>{char?.name || '???'}</span>
                            {session.endCard && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded-full font-black" style={{ background: WASHI.amber.base, color: WASHI.amber.ink }}>
                                    「{session.endCard.title}」
                                </span>
                            )}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-[10px]" style={{ color: INK_SOFT }}>{fmtDate(session.createdAt)}</span>
                            <span className="text-[10px]" style={{ color: '#c4b8a0' }}>·</span>
                            <span className="text-[10px]" style={{ color: INK_SOFT }}>{session.rounds.length}回合</span>
                            <span className="text-[10px]" style={{ color: '#c4b8a0' }}>·</span>
                            <span className="text-[10px] font-black" style={{ color: session.status === 'ended' ? INK_SOFT : WASHI.amber.ink }}>
                                {session.status === 'ended' ? '已结算' : '进行中'}
                            </span>
                        </div>
                    </div>
                    <div className="text-right shrink-0">
                        <div className="text-lg font-black" style={{ color: diff > 0 ? WASHI.sage.ink : diff < 0 ? '#9c4f47' : INK_SOFT }}>
                            {session.currentAffinity}
                        </div>
                        <div className="text-[10px]" style={{ color: INK_SOFT }}>
                            {diff >= 0 ? '+' : ''}{diff}
                        </div>
                    </div>
                </div>
            </div>
        </Card>
    );
};

// ===== MAIN APP =====
/** onExit：当本 App 嵌在「小剧场」壳里时，顶层返回回到小剧场封面页而非直接关到桌面。未传则回桌面。 */
const GuidebookApp: React.FC<{ onExit?: () => void }> = ({ onExit }) => {
    const { closeApp, characters, userProfile, apiConfig, addToast, updateCharacter } = useOS();
    const exitApp = onExit ?? closeApp;

    // View State
    const [view, setView] = useState<'lobby' | 'setup' | 'opening' | 'playing' | 'replay'>('lobby');
    const [session, setSession] = useState<GuidebookSession | null>(null);
    const [savedSessions, setSavedSessions] = useState<GuidebookSession[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');

    // Setup State
    const [selectedCharId, setSelectedCharId] = useState('');
    const [initialAffinity, setInitialAffinity] = useState(50);
    const [maxRounds, setMaxRounds] = useState(5);
    const [scenarioHint, setScenarioHint] = useState('');

    // Tutorial modal
    const [showTutorial, setShowTutorial] = useState(false);

    // Option edit overlay (tap to expand for mobile editing)
    const [editingOptIdx, setEditingOptIdx] = useState<number | null>(null);
    const [editOptText, setEditOptText] = useState('');
    const [editOptScore, setEditOptScore] = useState('');

    // Scenario edit overlay (tap to expand)
    const [editingScenario, setEditingScenario] = useState(false);
    const [editScenarioText, setEditScenarioText] = useState('');

    // Direction hint for next round
    const [nextDirectionHint, setNextDirectionHint] = useState('');

    // Exit confirm (replaces window.confirm on back)
    const [showExitConfirm, setShowExitConfirm] = useState(false);

    // Round Input State (manual mode)
    const [optionTexts, setOptionTexts] = useState(['', '', '']);
    const [optionScores, setOptionScores] = useState([0, 0, 0]);
    const [roundScenario, setRoundScenario] = useState('');

    // Cached recent messages
    const [cachedRecentMsgs, setCachedRecentMsgs] = useState('');

    // Opening segments
    const [openingSegments, setOpeningSegments] = useState<{ speaker: string; text: string }[]>([]);
    const [openingDone, setOpeningDone] = useState(false);

    // End card / warnings
    const [showEndCard, setShowEndCard] = useState(false);
    const [showExceedWarning, setShowExceedWarning] = useState(false);

    // Round context menu
    const [contextMenuRound, setContextMenuRound] = useState<number | null>(null);

    // Delete session confirm
    const [deleteSessionId, setDeleteSessionId] = useState<string | null>(null);

    // Input area collapsed
    const [inputCollapsed, setInputCollapsed] = useState(false);

    // Scroll ref
    const logsRef = useRef<HTMLDivElement>(null);

    // Load saved sessions
    useEffect(() => { loadSessions(); }, []);

    const loadSessions = async () => {
        const list = await DB.getAllGuidebookSessions();
        setSavedSessions(list.sort((a, b) => b.lastPlayedAt - a.lastPlayedAt));
    };

    // Auto-scroll
    useEffect(() => {
        if (logsRef.current && (view === 'playing' || view === 'replay')) {
            setTimeout(() => {
                logsRef.current?.scrollTo({ top: logsRef.current.scrollHeight, behavior: 'smooth' });
            }, 100);
        }
    }, [session?.rounds, isLoading, view]);

    // Auto-save session
    const saveSession = useCallback(async (s: GuidebookSession) => {
        await DB.saveGuidebookSession(s);
        loadSessions();
    }, []);

    const selectedChar = characters.find(c => c.id === selectedCharId);

    // --- Start Game ---
    const handleStartGame = async () => {
        if (!selectedCharId) { addToast('请先选择角色', 'error'); return; }

        setIsLoading(true);
        setError('');

        const char = characters.find(c => c.id === selectedCharId)!;
        const contextLimit = char.contextLimit || 500;
        const recentMsgs = await fetchRecentMessages(selectedCharId, contextLimit);
        setCachedRecentMsgs(recentMsgs);

        const newSession: GuidebookSession = {
            id: genId(),
            charId: selectedCharId,
            initialAffinity,
            currentAffinity: initialAffinity,
            maxRounds,
            currentRound: 0,
            mode: 'manual' as const,
            scenarioHint: scenarioHint || undefined,
            rounds: [],
            status: 'opening',
            createdAt: Date.now(),
            lastPlayedAt: Date.now(),
        };
        setSession(newSession);

        try {
            await injectMemoryPalace(char, undefined, scenarioHint || undefined);
            const prompt = buildOpeningPrompt(char, userProfile, initialAffinity, scenarioHint, 'manual', recentMsgs, char.guidebookInsights);
            const raw = await callAPI(apiConfig, prompt);
            let data = extractJson(raw);

            // Flexible segment extraction: try multiple paths
            let rawSegs: any[] | null = null;
            if (Array.isArray(data?.segments)) rawSegs = data.segments;
            else if (Array.isArray(data)) rawSegs = data; // bare array
            else if (data && typeof data === 'object') {
                // Look for any array field that looks like segments
                for (const val of Object.values(data)) {
                    if (Array.isArray(val) && val.length >= 2 && val[0] && (val[0].text || val[0].content)) {
                        rawSegs = val;
                        break;
                    }
                }
            }
            // Also try re-parsing raw as array if extractJson returned object without segments
            if (!rawSegs) {
                try {
                    const arrMatch = raw.match(/\[[\s\S]*\]/);
                    if (arrMatch) {
                        const arr = JSON.parse(arrMatch[0]);
                        if (Array.isArray(arr) && arr.length >= 2 && arr[0]?.text) rawSegs = arr;
                    }
                } catch {}
            }

            const segments = rawSegs?.filter((s: any) => s && (typeof s.text === 'string' || typeof s.content === 'string'));
            if (segments && segments.length > 0) {
                // Normalize: accept text or content field, speaker/role field
                const cleaned = segments.map((s: any) => ({
                    speaker: (s.speaker === 'char' || s.role === 'char') ? 'char' : 'gm',
                    text: String(s.text || s.content || ''),
                }));
                setOpeningSegments(cleaned);
                const updated = { ...newSession, openingSequence: JSON.stringify(cleaned) };
                setSession(updated);
                await saveSession(updated);
                setView('opening');
            } else {
                throw new Error('AI 返回格式不正确，请重试');
            }
        } catch (e: any) {
            setError(e.message);
            setView('setup');
        } finally {
            setIsLoading(false);
        }
    };

    // --- Opening Done ---
    const handleOpeningDone = () => {
        setOpeningDone(true);
        if (session) {
            const updated = { ...session, status: 'playing' as const };
            setSession(updated);
            saveSession(updated);
        }
        setView('playing');
    };

    // --- AI Assist ---
    const handleAIAssist = async () => {
        if (!session || !selectedChar) return;
        setIsLoading(true);
        setError('');
        const wc = extractWorldContext(session.openingSequence);
        try {
            await injectMemoryPalace(selectedChar, undefined, session.scenarioHint || undefined);
            const prompt = buildOptionAssistPrompt(
                selectedChar, userProfile, session.currentAffinity,
                session.currentRound + 1, session.rounds, session.scenarioHint || '',
                cachedRecentMsgs, wc, nextDirectionHint || undefined
            );
            const raw = await callAPI(apiConfig, prompt);
            const data = extractJson(raw);
            // Flexible: try data.options, or any array field with 3+ items that have text
            let opts: any[] | null = null;
            if (Array.isArray(data?.options) && data.options.length >= 3) opts = data.options;
            else if (data && typeof data === 'object') {
                for (const val of Object.values(data)) {
                    if (Array.isArray(val) && val.length >= 3 && (val as any[])[0]?.text) { opts = val as any[]; break; }
                }
            }
            if (opts && opts.length >= 3 && opts.slice(0, 3).every((o: any) => o && (o.text || o.content))) {
                setOptionTexts(opts.slice(0, 3).map((o: any) => String(o.text || o.content || '')));
                setOptionScores(opts.slice(0, 3).map((o: any) => Number(o.affinity || o.score || o.value) || 0));
                if (data.scenario || data.scene) setRoundScenario(String(data.scenario || data.scene));
            } else {
                throw new Error('AI 生成的选项格式不正确，请重试');
            }
        } catch (e: any) { setError(e.message); }
        finally { setIsLoading(false); }
    };

    // --- Submit Round (shared logic) ---
    const processRoundResult = async (data: any, options: GuidebookOption[], roundNum: number) => {
        if (!session) return;
        // Robust choice extraction: handle number, string number, "A"/"B"/"C", letter in text
        let rawChoice: number;
        const c = data.choice;
        if (typeof c === 'number') rawChoice = c;
        else if (typeof c === 'string') {
            const upper = c.trim().toUpperCase();
            if (upper === 'A' || upper.includes('A')) rawChoice = 0;
            else if (upper === 'B' || upper.includes('B')) rawChoice = 1;
            else if (upper === 'C' || upper.includes('C')) rawChoice = 2;
            else rawChoice = parseInt(c, 10);
        } else rawChoice = 0;
        const choiceIdx = Math.min(Math.max(isNaN(rawChoice) ? 0 : Math.round(rawChoice), 0), 2);
        const affinityChange = options[choiceIdx].affinity;
        const newAffinity = session.currentAffinity + affinityChange;

        const round: GuidebookRound = {
            id: genId(),
            roundNumber: roundNum,
            scenario: roundScenario || String(data.gm_narration || ''),
            options,
            gmNarration: String(data.gm_narration || ''),
            charInnerThought: String(data.inner_thought || ''),
            charChoice: choiceIdx,
            charReaction: String(data.reaction || ''),
            charExploration: data.exploration ? String(data.exploration) : undefined,
            charInsight: data.char_insight ? String(data.char_insight) : undefined,
            affinityBefore: session.currentAffinity,
            affinityAfter: newAffinity,
            timestamp: Date.now(),
        };

        const updated: GuidebookSession = {
            ...session,
            currentAffinity: newAffinity,
            currentRound: roundNum,
            rounds: [...session.rounds, round],
            lastPlayedAt: Date.now(),
        };
        setSession(updated);
        await saveSession(updated);

        // Pre-fill next round options from AI suggestions (bundled with round result)
        const nextOpts = data.next_options?.options || data.nextOptions?.options;
        if (Array.isArray(nextOpts) && nextOpts.length >= 3 && nextOpts.slice(0, 3).every((o: any) => o && (o.text || o.content))) {
            setOptionTexts(nextOpts.slice(0, 3).map((o: any) => String(o.text || o.content || '')));
            setOptionScores(nextOpts.slice(0, 3).map((o: any) => Number(o.affinity || o.score || o.value) || 0));
            const nextScenario = data.next_options?.scenario || data.nextOptions?.scenario;
            if (nextScenario) setRoundScenario(String(nextScenario));
        } else {
            setOptionTexts(['', '', '']);
            setOptionScores([0, 0, 0]);
            setRoundScenario('');
        }
        setNextDirectionHint('');

        if (roundNum >= session.maxRounds) setShowExceedWarning(true);
    };

    const handleSubmitRound = async () => {
        if (!session || !selectedChar) return;
        if (optionTexts.some(t => !t.trim())) { addToast('请填写所有选项', 'error'); return; }
        setIsLoading(true);
        setError('');
        const roundNum = session.currentRound + 1;
        const options: GuidebookOption[] = optionTexts.map((text, i) => ({ text: text.trim(), affinity: optionScores[i] }));
        const wc = extractWorldContext(session.openingSequence);

        try {
            await injectMemoryPalace(selectedChar, undefined, roundScenario || session.scenarioHint || undefined);
            const prompt = buildRoundPrompt(
                selectedChar, userProfile, session.currentAffinity,
                roundNum, session.maxRounds, options, session.rounds, session.scenarioHint || '',
                cachedRecentMsgs, wc, nextDirectionHint || undefined, roundScenario || undefined
            );
            const raw = await callAPI(apiConfig, prompt);
            const data = extractJson(raw);
            const choice = data?.choice;
            // Accept number, string number, or letter A/B/C
            const hasChoice = data && (typeof choice === 'number' || (typeof choice === 'string' && choice.trim().length > 0));
            if (hasChoice) {
                await processRoundResult(data, options, roundNum);
            } else throw new Error('AI 返回格式不正确，请重试');
        } catch (e: any) { setError(e.message); }
        finally { setIsLoading(false); }
    };


    // --- Regenerate from round ---
    const handleRegenerateFrom = async (roundIdx: number) => {
        if (!session || !selectedChar) return;
        setContextMenuRound(null);

        // Restore input fields from the round being regenerated
        const targetRound = session.rounds[roundIdx];
        if (targetRound) {
            setOptionTexts(targetRound.options.map(o => o.text));
            setOptionScores(targetRound.options.map(o => o.affinity));
            setRoundScenario(targetRound.scenario || '');
        }

        const trimmedRounds = session.rounds.slice(0, roundIdx);
        const prevAffinity = roundIdx > 0 ? session.rounds[roundIdx - 1].affinityAfter : session.initialAffinity;
        const updated: GuidebookSession = {
            ...session,
            rounds: trimmedRounds,
            currentRound: roundIdx,
            currentAffinity: prevAffinity,
            lastPlayedAt: Date.now(),
        };
        setSession(updated);
        await saveSession(updated);
    };

    // --- Delete round ---
    const handleDeleteFrom = async (roundIdx: number) => {
        if (!session) return;
        setContextMenuRound(null);

        // Restore input fields from the deleted round
        const targetRound = session.rounds[roundIdx];
        if (targetRound) {
            setOptionTexts(targetRound.options.map(o => o.text));
            setOptionScores(targetRound.options.map(o => o.affinity));
            setRoundScenario(targetRound.scenario || '');
        }

        const trimmedRounds = session.rounds.slice(0, roundIdx);
        const prevAffinity = roundIdx > 0 ? session.rounds[roundIdx - 1].affinityAfter : session.initialAffinity;
        const updated: GuidebookSession = {
            ...session, rounds: trimmedRounds, currentRound: roundIdx,
            currentAffinity: prevAffinity, lastPlayedAt: Date.now(),
        };
        setSession(updated);
        await saveSession(updated);
    };

    // --- End Game ---
    const handleEndGame = async () => {
        if (!session || !selectedChar) return;
        setIsLoading(true);
        setError('');
        setShowExceedWarning(false);

        try {
            await injectMemoryPalace(selectedChar, undefined, session.scenarioHint || undefined);
            const prompt = buildEndCardPrompt(
                selectedChar, userProfile,
                session.initialAffinity, session.currentAffinity, session.rounds,
                cachedRecentMsgs
            );
            const raw = await callAPI(apiConfig, prompt);
            const data = extractJson(raw);

            if (data) {
                const newInsight = String(data.charNewInsight || data.char_new_insight || '') || undefined;
                const rawHighlights = data.highlights;
                const highlights = Array.isArray(rawHighlights) ? rawHighlights.map((h: any) => String(h)) : [];
                const updated: GuidebookSession = {
                    ...session,
                    status: 'ended',
                    endCard: {
                        finalAffinity: session.currentAffinity,
                        charVerdict: String(data.verdict || data.charVerdict || ''),
                        title: String(data.title || '???'),
                        highlights,
                        charSummary: String(data.charSummary || data.char_summary || '') || undefined,
                        charNewInsight: newInsight,
                    },
                    lastPlayedAt: Date.now(),
                };
                setSession(updated);
                await saveSession(updated);

                // Persist insight to character for cross-session awareness
                if (newInsight && selectedChar) {
                    const prev = selectedChar.guidebookInsights || [];
                    updateCharacter(selectedChar.id, {
                        guidebookInsights: [...prev, newInsight].slice(-8), // keep last 8
                    });
                }

                setShowEndCard(true);
            } else throw new Error('AI 返回格式不正确');
        } catch (e: any) { setError(e.message); }
        finally { setIsLoading(false); }
    };

    // --- Send to Chat ---
    const handleSendToChat = async () => {
        if (!session?.endCard || !selectedChar) return;
        const card = session.endCard;

        const cardData = {
            type: 'guidebook_card',
            title: card.title,
            charName: selectedChar.name,
            charAvatar: selectedChar.avatar || '',
            initialAffinity: session.initialAffinity,
            finalAffinity: card.finalAffinity,
            charVerdict: card.charVerdict,
            charNewInsight: card.charNewInsight || '',
            rounds: session.rounds.length,
        };

        try {
            await DB.saveMessage({
                charId: selectedChar.id,
                role: 'system',
                type: 'score_card',
                content: JSON.stringify(cardData),
                metadata: { scoreCard: cardData },
            });
            addToast('已发送到聊天', 'success');
            setShowEndCard(false);
        } catch (e: any) { addToast('发送失败: ' + e.message, 'error'); }
    };

    // --- Delete Session ---
    const handleDeleteSession = async (id: string) => {
        await DB.deleteGuidebookSession(id);
        setDeleteSessionId(null);
        loadSessions();
        if (session?.id === id) {
            setSession(null);
            setView('lobby');
        }
        addToast('已删除', 'success');
    };

    // --- Open Replay ---
    const openReplay = (s: GuidebookSession) => {
        setSession(s);
        setSelectedCharId(s.charId);
        if (s.openingSequence) {
            try { setOpeningSegments(JSON.parse(s.openingSequence)); } catch { setOpeningSegments([]); }
        } else { setOpeningSegments([]); }

        if (s.status === 'ended') {
            setView('replay');
        } else {
            setCachedRecentMsgs('');
            const resumeChar = characters.find(c => c.id === s.charId);
            fetchRecentMessages(s.charId, resumeChar?.contextLimit || 500).then(setCachedRecentMsgs);
            setView('playing');
        }
    };

    // --- Go back to lobby ---
    const backToLobby = () => {
        setSession(null);
        setOpeningDone(false);
        setOpeningSegments([]);
        setError('');
        setView('lobby');
        loadSessions();
    };

    // ============ RENDER: LOBBY ============
    if (view === 'lobby') {
        return (
            <GameFrame>
                {/* 顶栏：纸页页眉 */}
                <div className="shrink-0 relative z-20 px-4 pt-2.5 pb-2.5">
                    <div className="flex items-center gap-2.5">
                        <button onClick={exitApp} className="relative inline-flex items-center justify-center w-8 h-8 active:scale-90 transition-transform" style={{ color: '#5b4d3a' }}>
                            <span aria-hidden className="absolute inset-0 rounded-[6px]" style={{ backgroundColor: WASHI.butter.base, backgroundImage: TAPE_STRIPES, transform: 'rotate(-3deg)', boxShadow: '0 3px 7px -3px rgba(70,62,48,0.5)' }} />
                            <ArrowLeft size={15} weight="bold" className="relative z-10" />
                        </button>
                        <div className="flex-1">
                            <div className="text-[9px] tracking-[0.32em] uppercase" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>Guidebook · Casting</div>
                            <div className="text-base font-black tracking-wide" style={{ color: INK }}>攻略本</div>
                        </div>
                        <button onClick={() => setShowTutorial(true)} className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-black active:scale-90 transition-transform" style={{ background: 'rgba(255,253,247,0.96)', color: '#6b6456', border: '1px solid rgba(196,184,160,0.85)' }}>?</button>
                    </div>
                    <div aria-hidden className="mt-2 h-px" style={{ backgroundImage: 'repeating-linear-gradient(90deg, rgba(150,140,120,0.5) 0 5px, transparent 5px 10px)' }} />
                </div>

                <div className="flex-1 overflow-y-auto no-scrollbar">
                    {/* 标题 */}
                    <div className="px-5 pt-3 pb-1">
                        <div className="text-[9px] tracking-[0.28em] uppercase mb-0.5" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>— Pick your lead —</div>
                        <div className="text-[12px]" style={{ color: '#6b6456' }}>挑一位登场角色，开一局攻略</div>
                    </div>

                    {/* 登场角色卡 */}
                    <div className="px-4 pt-3 pb-3 space-y-3.5">
                        {characters.map((c, idx) => {
                            const charSessions = savedSessions.filter(s => s.charId === c.id);
                            const lastSession = charSessions[0];
                            const tones: WashiColor[] = ['rose', 'amber', 'sage', 'sky', 'lilac', 'butter'];
                            const tone = tones[idx % tones.length];
                            const tilt = idx % 2 === 0 ? -0.7 : 0.8;
                            return (
                                <button key={c.id} onClick={() => { setSelectedCharId(c.id); setView('setup'); }} className="w-full block active:scale-[0.98] transition-transform">
                                    <div className="relative flex items-center gap-3 p-3" style={{ background: 'linear-gradient(180deg,#fdfaf3,#f7f0e2)', border: '1px solid rgba(196,184,160,0.7)', outline: '1px dashed rgba(176,162,138,0.45)', outlineOffset: -5, borderRadius: 14, boxShadow: '0 12px 24px -16px rgba(70,62,48,0.42)', transform: `rotate(${tilt}deg)` }}>
                                        <WashiTape color={tone} rotate={-5} className="absolute -top-2.5 left-7 w-14 h-5 rounded-[2px] z-10" />
                                        {/* 拍立得头像 */}
                                        <span className="shrink-0" style={{ transform: 'rotate(-2.5deg)' }}>
                                            {c.avatar ? (
                                                <span className="block p-1 pb-2" style={{ background: '#fffdf8', border: '1px solid rgba(196,184,160,0.8)', borderRadius: 5, boxShadow: '0 5px 11px -7px rgba(70,62,48,0.5)' }}>
                                                    <img src={c.avatar} className="w-[58px] h-[58px] object-cover" style={{ borderRadius: 3 }} />
                                                </span>
                                            ) : (
                                                <span className="w-[58px] h-[58px] rounded-[5px] flex items-center justify-center text-xl font-black" style={{ background: '#3a3630', color: '#fcf8ef' }}>{c.name[0]}</span>
                                            )}
                                        </span>
                                        <div className="flex-1 min-w-0 text-left">
                                            <div className="text-[9px] tracking-widest" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>NO.{String(idx + 1).padStart(2, '0')}</div>
                                            <div className="text-lg font-black tracking-wide leading-tight truncate" style={{ color: INK }}>{c.name}</div>
                                            <div className="text-[10.5px] mt-0.5 leading-tight truncate" style={{ color: '#8b8576' }}>{c.description ? c.description.slice(0, 25) : '等待攻略…'}</div>
                                            {charSessions.length > 0 && (
                                                <span className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded-full" style={{ background: WASHI[tone].base, color: WASHI[tone].ink }}>
                                                    <span className="text-[8px] font-black tracking-wide">{charSessions.length}回攻略{lastSession?.endCard ? ` ·「${lastSession.endCard.title}」` : ''}</span>
                                                </span>
                                            )}
                                        </div>
                                        <CaretRight size={16} weight="bold" className="shrink-0" style={{ color: INK_SOFT }} />
                                    </div>
                                </button>
                            );
                        })}
                    </div>

                    {characters.length === 0 && (
                        <div className="text-center py-16 px-6">
                            <div className="text-3xl mb-2 select-none">🎭</div>
                            <div className="text-xs" style={{ color: INK_SOFT }}>还没有角色，先去创建一个吧</div>
                        </div>
                    )}

                    {/* 历史存档 */}
                    {savedSessions.length > 0 && (
                        <div className="px-4 pb-4 mt-2">
                            <div className="flex items-center gap-2 mb-3 px-1">
                                <span className="text-[8px] tracking-[0.3em] px-2 py-0.5 rounded-[3px]" style={{ fontFamily: 'var(--font-label)', background: '#3a3630', color: '#fcf8ef' }}>HISTORY</span>
                                <div className="h-px flex-1" style={{ backgroundImage: 'repeating-linear-gradient(90deg, rgba(150,140,120,0.5) 0 5px, transparent 5px 10px)' }} />
                            </div>
                            <div className="space-y-2.5">
                                {savedSessions.map(s => (
                                    <SessionCard
                                        key={s.id}
                                        session={s}
                                        char={characters.find(c => c.id === s.charId)}
                                        onTap={() => openReplay(s)}
                                        onLongPress={() => setDeleteSessionId(s.id)}
                                    />
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* 玩法说明 */}
                {showTutorial && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-5 animate-fade-in">
                        <div className="absolute inset-0" style={{ background: 'rgba(46,40,32,0.45)', backdropFilter: 'blur(3px)' }} onClick={() => setShowTutorial(false)} />
                        <div className="relative w-full max-w-sm overflow-hidden animate-pop-in" style={{ background: 'linear-gradient(180deg,#fdfaf3,#f4ecda)', border: '1px solid rgba(196,184,160,0.85)', outline: '1px dashed rgba(176,162,138,0.5)', outlineOffset: -6, borderRadius: 20, boxShadow: '0 32px 60px -22px rgba(40,34,26,0.6)', transform: 'rotate(-0.5deg)' }}>
                            <WashiTape color="sky" rotate={-5} className="absolute -top-3 left-1/2 -translate-x-1/2 w-28 h-6 rounded-[2px] z-10" />
                            <div className="px-5 pt-7 pb-2">
                                <div className="text-[9px] tracking-[0.3em] uppercase mb-1" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>How to Play</div>
                                <div className="text-lg font-black" style={{ color: INK }}>攻略本 · 玩法说明</div>
                            </div>
                            <div className="px-5 py-3 space-y-3 max-h-[60vh] overflow-y-auto no-scrollbar">
                                {[
                                    { icon: <Sparkle size={15} weight="fill" />, color: 'amber' as WashiColor, title: '基本概念', desc: '你是出题人，角色是答题者。每回合你设计三个行为选项（含好感度分值），AI角色会根据自己的性格选一个——你需要猜到她会选哪个！' },
                                    { icon: <Heart size={15} weight="fill" />, color: 'rose' as WashiColor, title: '好感度系统', desc: '每个选项对应一个分值（可以是负数）。角色选择后，分值累加到当前好感度。结局好坏取决于最终好感度。' },
                                    { icon: <FlowerLotus size={15} weight="fill" />, color: 'sage' as WashiColor, title: 'AI 一键填入', desc: '不知道出什么题？点"AI 一键填入"，AI会根据当前剧情自动帮你生成三个选项和分值，你可以直接用或者修改。' },
                                    { icon: <Star size={15} weight="fill" />, color: 'butter' as WashiColor, title: '点击选项快速编辑', desc: '游戏过程中，点击任意选项（A/B/C）可以在弹出框里快速编辑内容和分值，手机党友好！' },
                                    { icon: <DiamondsFour size={15} weight="fill" />, color: 'sky' as WashiColor, title: '幻想场景', desc: '开始时可以设定一个场景背景（比如异世界冒险、校园日常），AI会据此生成开场白并保持世界观一致。' },
                                    { icon: <Cards size={15} weight="fill" />, color: 'lilac' as WashiColor, title: '结算卡片', desc: '游戏结束后生成结算卡，包含角色的真实评语和本局高光时刻，还可以发送到聊天。' },
                                ].map((item, i) => (
                                    <div key={i} className="flex gap-3">
                                        <Stamp color={item.color} size={30} className="mt-0.5">{item.icon}</Stamp>
                                        <div>
                                            <div className="text-xs font-black mb-0.5" style={{ color: INK }}>{item.title}</div>
                                            <div className="text-[11px] leading-relaxed" style={{ color: '#6b6456' }}>{item.desc}</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <div className="px-5 pb-5 pt-2">
                                <button onClick={() => setShowTutorial(false)} className="w-full py-2.5 rounded-full text-sm font-black active:scale-95 transition-transform" style={{ background: '#3a3630', color: '#fcf8ef', outline: '1px dashed rgba(255,255,255,0.3)', outlineOffset: -4 }}>
                                    明白了！开始攻略 <ArrowRight size={14} className="inline" />
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* 撕掉记录确认 */}
                {deleteSessionId && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 animate-fade-in">
                        <div className="absolute inset-0" style={{ background: 'rgba(46,40,32,0.4)', backdropFilter: 'blur(3px)' }} onClick={() => setDeleteSessionId(null)} />
                        <div className="relative w-full max-w-xs animate-pop-in" style={{ background: 'linear-gradient(180deg,#fdfaf3,#f5eedd)', border: '1px solid rgba(196,184,160,0.85)', borderRadius: 16, boxShadow: '0 28px 50px -20px rgba(40,34,26,0.55)', transform: 'rotate(-0.6deg)' }}>
                            <WashiTape color="rose" rotate={-5} className="absolute -top-3 left-1/2 -translate-x-1/2 w-20 h-5 rounded-[2px] z-10" />
                            <div className="px-5 pt-6 pb-5 space-y-3">
                                <div className="font-black text-sm text-center" style={{ color: INK }}>撕掉这张记录？</div>
                                <div className="flex gap-2">
                                    <button onClick={() => setDeleteSessionId(null)} className="flex-1 py-2.5 text-xs font-black rounded-full active:scale-95 transition-transform" style={{ background: 'rgba(255,253,247,0.96)', color: '#6b6456', border: '1px solid rgba(196,184,160,0.85)' }}>取消</button>
                                    <button onClick={() => handleDeleteSession(deleteSessionId)} className="flex-1 py-2.5 text-white text-xs font-black rounded-full active:scale-95 transition-transform" style={{ background: '#b3564e' }}>撕掉</button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </GameFrame>
        );
    }

    // ============ RENDER: SETUP ============
    if (view === 'setup') {
        const setupChar = characters.find(c => c.id === selectedCharId);
        return (
            <GameFrame>
                {/* 顶栏 */}
                <div className="shrink-0 relative z-20 px-4 pt-2.5 pb-2.5">
                    <div className="flex items-center gap-2.5">
                        <button onClick={backToLobby} className="relative inline-flex items-center justify-center w-8 h-8 active:scale-90 transition-transform" style={{ color: '#5b4d3a' }}>
                            <span aria-hidden className="absolute inset-0 rounded-[6px]" style={{ backgroundColor: WASHI.butter.base, backgroundImage: TAPE_STRIPES, transform: 'rotate(-3deg)', boxShadow: '0 3px 7px -3px rgba(70,62,48,0.5)' }} />
                            <ArrowLeft size={15} weight="bold" className="relative z-10" />
                        </button>
                        <div className="flex-1">
                            <div className="text-[9px] tracking-[0.32em] uppercase" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>New Game</div>
                            <div className="text-base font-black tracking-wide" style={{ color: INK }}>新游戏</div>
                        </div>
                    </div>
                    <div aria-hidden className="mt-2 h-px" style={{ backgroundImage: 'repeating-linear-gradient(90deg, rgba(150,140,120,0.5) 0 5px, transparent 5px 10px)' }} />
                </div>

                <div className="flex-1 overflow-y-auto no-scrollbar">
                    {/* 登场角色条 */}
                    {setupChar && (
                        <div className="mx-4 mt-4 relative flex items-center gap-3 p-3" style={{ background: 'linear-gradient(180deg,#fdfaf3,#f7f0e2)', border: '1px solid rgba(196,184,160,0.7)', outline: '1px dashed rgba(176,162,138,0.45)', outlineOffset: -5, borderRadius: 14, boxShadow: '0 12px 24px -16px rgba(70,62,48,0.42)', transform: 'rotate(-0.6deg)' }}>
                            <WashiTape color="rose" rotate={-5} className="absolute -top-2.5 left-7 w-16 h-5 rounded-[2px] z-10" />
                            <span className="shrink-0" style={{ transform: 'rotate(-2.5deg)' }}>
                                {setupChar.avatar ? (
                                    <span className="block p-1 pb-2" style={{ background: '#fffdf8', border: '1px solid rgba(196,184,160,0.8)', borderRadius: 5, boxShadow: '0 5px 11px -7px rgba(70,62,48,0.5)' }}>
                                        <img src={setupChar.avatar} className="w-14 h-14 object-cover" style={{ borderRadius: 3 }} />
                                    </span>
                                ) : (
                                    <span className="w-14 h-14 rounded-[5px] flex items-center justify-center text-xl font-black" style={{ background: '#3a3630', color: '#fcf8ef' }}>{setupChar.name[0]}</span>
                                )}
                            </span>
                            <div className="flex-1 min-w-0">
                                <div className="text-[9px] tracking-[0.24em]" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>TARGET · 攻略对象</div>
                                <div className="font-black text-lg tracking-wide" style={{ color: INK }}>{setupChar.name}</div>
                                <div className="text-[10px] truncate mt-0.5" style={{ color: '#8b8576' }}>{setupChar.description ? setupChar.description.slice(0, 30) : '准备被攻略…'}</div>
                            </div>
                        </div>
                    )}

                    {/* 设置区 */}
                    <div className="px-4 pt-4 pb-3 space-y-3">
                        {/* 初始好感度 */}
                        <div className="relative rounded-2xl" style={setupCardStyle}>
                            <div className="p-3.5 space-y-2.5">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-1.5">
                                        <Stamp color="rose" size={22}><Heart size={12} weight="fill" /></Stamp>
                                        <span className="text-xs font-black" style={{ color: INK }}>初始好感度</span>
                                    </div>
                                    <div className="px-2.5 py-0.5 rounded-full text-xs font-black" style={{ color: WASHI.rose.ink, background: WASHI.rose.base }}>
                                        {initialAffinity}
                                    </div>
                                </div>
                                <div className="flex items-center gap-2.5">
                                    <div className="flex-1 relative h-7 flex items-center">
                                        <div className="absolute inset-x-0 h-2 rounded-full" style={{ background: 'rgba(176,162,138,0.28)', top: '50%', transform: 'translateY(-50%)' }} />
                                        <div className="absolute h-2 rounded-full" style={{
                                            background: WASHI.rose.base, backgroundImage: 'repeating-linear-gradient(90deg, rgba(255,255,255,0.25) 0 3px, transparent 3px 7px)',
                                            width: `${(initialAffinity + 100) / 200 * 100}%`, top: '50%', transform: 'translateY(-50%)',
                                        }} />
                                        <input type="range" min={-100} max={100} value={initialAffinity}
                                            onChange={e => setInitialAffinity(Number(e.target.value))}
                                            className="absolute inset-0 w-full opacity-0 cursor-pointer" style={{ zIndex: 2 }} />
                                        <div className="absolute w-5 h-5 rounded-full pointer-events-none" style={{
                                            left: `calc(${(initialAffinity + 100) / 200 * 100}% - 10px)`, top: '50%', transform: 'translateY(-50%)',
                                            background: '#fffdf8', border: '2.5px solid #3a3630', boxShadow: '0 2px 5px rgba(70,62,48,0.3)', zIndex: 1,
                                        }} />
                                    </div>
                                    <input type="number" value={initialAffinity}
                                        onChange={e => setInitialAffinity(Number(e.target.value))}
                                        className="w-14 rounded-xl px-2 py-1.5 text-center text-xs font-black focus:outline-none"
                                        style={{ color: INK, background: '#fffdf8', border: '1px solid rgba(196,184,160,0.8)' }} />
                                </div>
                                <div className="text-[9px]" style={{ color: INK_SOFT }}>支持负数，随便填（角色会看到并做出反应）</div>
                            </div>
                        </div>

                        {/* 回合数 */}
                        <div className="rounded-2xl" style={setupCardStyle}>
                            <div className="p-3 space-y-2">
                                <div className="flex items-center gap-1.5">
                                    <Stamp color="amber" size={22}><Sparkle size={12} weight="fill" /></Stamp>
                                    <span className="text-xs font-black" style={{ color: INK }}>回合数</span>
                                </div>
                                <div className="grid grid-cols-4 gap-1.5">
                                    {[3, 5, 8, 10].map(n => (
                                        <button key={n} onClick={() => setMaxRounds(n)}
                                            className="py-2 rounded-xl text-xs font-black transition-all active:scale-90"
                                            style={maxRounds === n
                                                ? { background: '#3a3630', color: '#fcf8ef', boxShadow: '0 6px 12px -8px rgba(58,54,48,0.6)' }
                                                : { background: 'rgba(255,253,247,0.7)', color: INK_SOFT, border: '1px solid rgba(196,184,160,0.7)' }}>{n}</button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* 幻想场景 */}
                        <div className="rounded-2xl" style={setupCardStyle}>
                            <div className="p-3.5 space-y-2.5">
                                <div className="flex items-center gap-1.5">
                                    <Stamp color="lilac" size={22}><FlowerLotus size={12} weight="fill" /></Stamp>
                                    <span className="text-xs font-black" style={{ color: INK }}>幻想场景</span>
                                    <span className="text-[9px] ml-0.5" style={{ color: INK_SOFT }}>选一个或自己写</span>
                                </div>
                                <div className="grid grid-cols-3 gap-1.5">
                                    {[
                                        { label: '游戏世界', icon: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f3ae.png', value: '你们在一起玩的游戏世界里冒险（RPG/开放世界），角色用游戏内的方式攻略用户' },
                                        { label: '小说剧情', icon: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f4d6.png', value: '你们是小说里的角色，身处用户喜欢的故事类型中，角色按剧情节奏推进攻略' },
                                        { label: '校园日常', icon: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f3eb.png', value: '校园背景，放学后/午休/社团活动等经典galgame场景' },
                                        { label: '都市奇遇', icon: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f303.png', value: '现代都市奇幻背景，偶然相遇在咖啡馆/书店/雨天的街角' },
                                        { label: '异世界', icon: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/2694.png', value: '奇幻异世界冒险，勇者与同伴的旅程，角色在冒险途中制造心动瞬间' },
                                        { label: '自由想象', icon: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f52e.png', value: '' },
                                    ].map(preset => (
                                        <button key={preset.label} onClick={() => setScenarioHint(preset.value)}
                                            className="py-2 px-1 rounded-xl text-[10px] font-bold transition-all active:scale-90 text-center leading-tight"
                                            style={scenarioHint === preset.value && preset.value
                                                ? { background: '#3a3630', color: '#fcf8ef', boxShadow: '0 6px 12px -8px rgba(58,54,48,0.6)' }
                                                : { background: 'rgba(255,253,247,0.7)', color: '#6b6456', border: '1px solid rgba(196,184,160,0.7)' }}>
                                            <img src={preset.icon} className="w-4 h-4 inline" alt="" />{' '}{preset.label}
                                        </button>
                                    ))}
                                </div>
                                <input type="text" value={scenarioHint} onChange={e => setScenarioHint(e.target.value)}
                                    placeholder="自由描述: 在某个游戏里/小说背景/咖啡馆偶遇/雨天同伞..."
                                    className="w-full rounded-xl px-3 py-2.5 text-xs focus:outline-none"
                                    style={{ color: INK, background: '#fffdf8', border: '1px solid rgba(196,184,160,0.8)' }}
                                    />
                                <div className="text-[9px]" style={{ color: INK_SOFT }}>大胆设想！这是游戏，不用拘束于现实</div>
                            </div>
                        </div>

                        {error && (
                            <div className="rounded-2xl p-3 text-xs" style={{ color: '#8a5a52', background: WASHI.rose.base, border: `1px solid ${WASHI.rose.edge}` }}>
                                {error}
                            </div>
                        )}
                    </div>
                </div>

                {/* 开始 */}
                <div className="p-4 shrink-0">
                    <button onClick={handleStartGame} disabled={!selectedCharId || isLoading}
                        className="w-full py-3.5 font-black text-sm tracking-wider active:scale-[0.97] transition-all disabled:opacity-40 rounded-full"
                        style={{ background: '#3a3630', color: '#fcf8ef', outline: '1px dashed rgba(255,255,255,0.3)', outlineOffset: -5, boxShadow: '0 14px 26px -14px rgba(58,54,48,0.6)' }}>
                        {isLoading ? (
                            <span className="flex items-center justify-center gap-2">
                                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                生成开场白...
                            </span>
                        ) : (
                            <span>✎ 开始游戏</span>
                        )}
                    </button>
                </div>
            </GameFrame>
        );
    }

    // ============ RENDER: OPENING ============
    if (view === 'opening' && openingSegments.length > 0 && !openingDone) {
        return (
            <GameFrame>
                <GameHeader
                    title="攻略本 · 开场"
                    subtitle={`${selectedChar?.name} 的攻略之旅`}
                    onBack={handleOpeningDone}
                    affinity={session?.currentAffinity}
                    charAvatar={selectedChar?.avatar}
                />
                <TypewriterSegments segments={openingSegments} charName={selectedChar?.name || '???'} onDone={handleOpeningDone} />
                <div className="p-4 shrink-0">
                    <button onClick={handleOpeningDone}
                        className="w-full py-2.5 text-sm font-black rounded-full active:scale-95 transition-transform" style={{ background: 'rgba(255,253,247,0.96)', color: '#6b6456', border: '1px solid rgba(196,184,160,0.85)' }}>
                        跳过 <ArrowRight size={14} className="inline" />
                    </button>
                </div>
            </GameFrame>
        );
    }

    // ============ RENDER: PLAYING / REPLAY ============
    const char = characters.find(c => c.id === (session?.charId || selectedCharId));
    const charName = char?.name || '???';
    const isReplay = view === 'replay';

    return (
        <GameFrame>
            {/* Header */}
            <GameHeader
                title={isReplay ? '攻略本 · 回放' : `攻略本 · ${session?.currentRound || 0}/${session?.maxRounds || 0}`}
                subtitle={`${charName} vs ${userProfile.name}`}
                onBack={() => {
                    if (isReplay || !session?.rounds.length || session?.status === 'ended') {
                        backToLobby();
                    } else {
                        setShowExitConfirm(true);
                    }
                }}
                affinity={session?.currentAffinity}
                charAvatar={char?.avatar}
            />

            {/* Log Area */}
            <div ref={logsRef} className="flex-1 overflow-y-auto p-4 space-y-3 no-scrollbar">
                {/* Opening recap */}
                {openingSegments.length > 0 && (
                    <div className="space-y-2 pb-3">
                        {openingSegments.map((seg, i) => (
                            <SegmentBubble key={i} seg={seg} charName={charName} />
                        ))}
                        <div className="flex items-center gap-2 my-2">
                            <div className="h-px flex-1" style={{ backgroundImage: 'repeating-linear-gradient(90deg, rgba(150,140,120,0.5) 0 5px, transparent 5px 10px)' }} />
                            <span className="text-[9px] font-black tracking-[0.2em] px-2 py-0.5 rounded-[3px]" style={{ fontFamily: 'var(--font-label)', background: '#3a3630', color: '#fcf8ef' }}>游戏开始</span>
                            <div className="h-px flex-1" style={{ backgroundImage: 'repeating-linear-gradient(90deg, rgba(150,140,120,0.5) 0 5px, transparent 5px 10px)' }} />
                        </div>
                    </div>
                )}

                {/* Rounds */}
                {session?.rounds.map((round, i) => (
                    <RoundDisplay
                        key={round.id}
                        round={round}
                        charName={charName}
                        isLatest={i === session.rounds.length - 1}
                        isReplay={isReplay}
                        onLongPress={isReplay ? undefined : () => setContextMenuRound(i)}
                    />
                ))}

                {/* End card inline for replay */}
                {isReplay && session?.endCard && (
                    <Card className="p-4 space-y-3 mt-2">
                        <WashiTape color="amber" rotate={-5} className="absolute -top-2.5 left-1/2 -translate-x-1/2 w-20 h-5 rounded-[2px] z-10" />
                        <div className="text-center">
                            <div className="text-[10px] tracking-[0.3em] font-black mb-1 flex items-center justify-center gap-1" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}><Sparkle size={12} weight="fill" /> 结算 <Sparkle size={12} weight="fill" /></div>
                            <div className="text-lg font-black" style={{ color: INK }}>「{session.endCard.title}」</div>
                        </div>
                        <div className="text-sm italic text-center rounded-xl p-2" style={{ fontFamily: 'var(--font-display)', color: '#5b5346', background: WASHI.butter.base }}>
                            “{session.endCard.charVerdict}”
                        </div>
                        {session.endCard.highlights.map((h, i) => (
                            <div key={i} className="text-xs flex gap-2 rounded-lg p-2" style={{ color: '#5b5346', background: 'rgba(245,236,218,0.6)' }}>
                                <span className="shrink-0" style={{ color: WASHI.amber.ink }}><CaretRight size={12} weight="bold" /></span><span>{h}</span>
                            </div>
                        ))}
                        {session.endCard.charSummary && (
                            <div className="rounded-xl p-3" style={{ background: WASHI.rose.base, border: `1px solid ${WASHI.rose.edge}` }}>
                                <div className="text-[10px] font-black mb-1 flex items-center gap-1" style={{ color: WASHI.rose.ink }}>
                                    <Heart size={12} weight="fill" /> {charName}的真心话
                                </div>
                                <div className="text-sm leading-relaxed" style={{ color: '#5a3a36' }}>{session.endCard.charSummary}</div>
                            </div>
                        )}
                    </Card>
                )}

                {/* 思考中 */}
                {isLoading && (
                    <div className="flex items-center gap-2 text-xs" style={{ color: INK_SOFT }}>
                        <div className="w-4 h-4 rounded-full animate-spin" style={{ border: '2px solid rgba(176,162,138,0.35)', borderTopColor: '#3a3630' }} />
                        <span>{charName} 正在思考...</span>
                    </div>
                )}

                {error && (
                    <Card className="p-3" style={{ border: `1px solid ${WASHI.rose.edge}`, background: WASHI.rose.base }}>
                        <div className="text-xs" style={{ color: '#8a5a52' }}>{error}</div>
                    </Card>
                )}
            </div>

            {/* 出题面板（仅进行中） */}
            {!isReplay && session?.status === 'playing' && !isLoading && (
                <div className="shrink-0 relative z-10"
                    style={{ background: 'linear-gradient(0deg, #f3ecdb 0%, #efe6d2 100%)', borderTop: '1px dashed rgba(150,140,120,0.5)' }}>

                    {/* 折叠条 */}
                    <button onClick={() => setInputCollapsed(c => !c)}
                        className="w-full flex items-center justify-center gap-1.5 py-2 active:bg-black/5 transition-colors">
                        <span className="text-[10px] font-black" style={{ color: '#6b6456' }}>
                            {inputCollapsed ? '展开出题本' : '收起出题本'}
                        </span>
                        <span className="text-[10px]" style={{ color: INK_SOFT }}>
                            {inputCollapsed ? <CaretUp size={12} weight="bold" /> : <CaretDown size={12} weight="bold" />}
                        </span>
                    </button>

                    {!inputCollapsed && (
                        <div className="p-3 pt-1.5 space-y-2.5">
                            {/* 场景行 */}
                            <button onClick={() => { setEditingScenario(true); setEditScenarioText(roundScenario); }}
                                className="w-full flex gap-2 items-center active:scale-[0.98] transition-transform"
                                style={{ background: '#fffdf8', border: '1px dashed rgba(176,162,138,0.6)', borderRadius: '12px', padding: '8px 10px' }}>
                                <Stamp color="lilac" size={22}><FlowerLotus size={12} weight="fill" /></Stamp>
                                <span className="flex-1 text-left text-xs leading-relaxed truncate" style={{ color: roundScenario ? INK : INK_SOFT }}>
                                    {roundScenario || '场景描述 (可选，留空由GM发挥)'}
                                </span>
                                <span className="text-[10px] shrink-0" style={{ color: INK_SOFT }}><PencilSimple size={12} /></span>
                            </button>

                            {/* 三个选项行 */}
                            {[0, 1, 2].map(i => (
                                <button key={i} onClick={() => { setEditingOptIdx(i); setEditOptText(optionTexts[i]); setEditOptScore(String(optionScores[i])); }}
                                    className="w-full flex gap-2 items-center active:scale-[0.98] transition-transform"
                                    style={{ background: '#fffdf8', border: '1px solid rgba(196,184,160,0.7)', borderRadius: '12px', padding: '8px 10px' }}>
                                    <span className="w-6 h-6 rounded-[6px] flex items-center justify-center text-[10px] font-black shrink-0" style={{ background: '#3a3630', color: '#fcf8ef' }}>
                                        {String.fromCharCode(65 + i)}
                                    </span>
                                    <span className="flex-1 text-left text-xs leading-relaxed truncate" style={{ color: optionTexts[i] ? INK : INK_SOFT }}>
                                        {optionTexts[i] || `${charName}的行为${String.fromCharCode(65 + i)}...`}
                                    </span>
                                    <span className="text-[10px] font-black shrink-0 px-1.5 py-0.5 rounded-lg" style={optionScores[i] >= 0 ? { color: WASHI.sage.ink, background: WASHI.sage.base } : { color: '#9c4f47', background: 'rgba(214,150,140,0.4)' }}>
                                        {optionScores[i] >= 0 ? '+' : ''}{optionScores[i]}
                                    </span>
                                    <span className="text-[10px] shrink-0" style={{ color: INK_SOFT }}><PencilSimple size={12} /></span>
                                </button>
                            ))}

                            {/* 给 GM 的方向提示 */}
                            <input type="text" value={nextDirectionHint} onChange={e => setNextDirectionHint(e.target.value)}
                                placeholder="接下来对GM的剧情方向指导 (选填)"
                                className="w-full rounded-xl px-3 py-2 text-[11px] focus:outline-none"
                                style={{ background: '#fffdf8', border: '1px dashed rgba(176,162,138,0.6)', color: INK }} />

                            <div className="flex gap-2">
                                <button onClick={handleAIAssist} disabled={isLoading}
                                    className="flex-1 py-2 text-xs font-black rounded-full active:scale-95 transition-transform" style={{ background: 'rgba(255,253,247,0.96)', color: '#6b6456', border: '1px solid rgba(196,184,160,0.85)' }}>
                                    <Sparkle size={12} weight="fill" className="inline" /> AI 一键填入
                                </button>
                                <button onClick={handleSubmitRound} disabled={isLoading || optionTexts.some(t => !t.trim())}
                                    className="flex-1 py-2 text-xs font-black rounded-full active:scale-95 transition-transform disabled:opacity-50" style={{ background: '#3a3630', color: '#fcf8ef', outline: '1px dashed rgba(255,255,255,0.3)', outlineOffset: -4 }}>
                                    提交本回合
                                </button>
                            </div>

                            <button onClick={handleEndGame} disabled={isLoading || !session.rounds.length}
                                className="w-full py-2 text-xs font-bold rounded-full active:scale-95 transition-transform disabled:opacity-30" style={{ background: 'transparent', color: '#6b6456', border: '1px dashed rgba(150,140,120,0.6)' }}>
                                就到这吧 · 生成结算卡片
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* 回放页脚 */}
            {isReplay && (
                <div className="shrink-0 p-3" style={{ background: 'linear-gradient(0deg, #efe6d2 0%, transparent 100%)' }}>
                    <button onClick={backToLobby}
                        className="w-full py-2.5 text-sm font-black rounded-full active:scale-95 transition-transform" style={{ background: 'rgba(255,253,247,0.96)', color: '#6b6456', border: '1px solid rgba(196,184,160,0.85)' }}>
                        返回列表
                    </button>
                </div>
            )}

            {/* End Card Popup */}
            {showEndCard && session?.endCard && char && (
                <EndCard
                    session={session}
                    charName={charName}
                    charAvatar={char.avatar}
                    onClose={() => setShowEndCard(false)}
                    onSendToChat={handleSendToChat}
                />
            )}

            {/* 回合数已满 */}
            {showExceedWarning && (
                <div className="fixed inset-0 z-40 flex items-center justify-center p-6 animate-fade-in">
                    <div className="absolute inset-0" style={{ background: 'rgba(46,40,32,0.4)', backdropFilter: 'blur(3px)' }} onClick={() => setShowExceedWarning(false)} />
                    <div className="relative w-full max-w-xs animate-pop-in" style={paperDialogStyle}>
                        <WashiTape color="amber" rotate={-5} className="absolute -top-3 left-1/2 -translate-x-1/2 w-24 h-5 rounded-[2px] z-10" />
                        <div className="px-5 pt-6 pb-5 space-y-3">
                            <div className="font-black text-sm text-center" style={{ color: INK }}>已达到预设回合数 ({session?.maxRounds})</div>
                            <div className="text-xs text-center" style={{ color: '#6b6456' }}>要继续玩还是结算？</div>
                            <div className="flex gap-2">
                                <button onClick={() => setShowExceedWarning(false)}
                                    className="flex-1 py-2.5 text-xs font-black rounded-full active:scale-95 transition-transform" style={{ background: 'rgba(255,253,247,0.96)', color: '#6b6456', border: '1px solid rgba(196,184,160,0.85)' }}>
                                    继续玩！
                                </button>
                                <button onClick={handleEndGame}
                                    className="flex-1 py-2.5 text-xs font-black rounded-full active:scale-95 transition-transform" style={{ background: '#3a3630', color: '#fcf8ef', outline: '1px dashed rgba(255,255,255,0.3)', outlineOffset: -4 }}>
                                    结算
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* 选项编辑（底部抽屉） */}
            {editingOptIdx !== null && (
                <div className="fixed inset-0 z-50 flex items-end justify-center p-3 pb-4 animate-fade-in" style={{ paddingBottom: `calc(1rem + var(--safe-bottom))` }}>
                    <div className="absolute inset-0" style={{ background: 'rgba(46,40,32,0.42)', backdropFilter: 'blur(3px)' }} onClick={() => setEditingOptIdx(null)} />
                    <div className="relative w-full max-w-md overflow-hidden animate-slide-up max-h-[85vh] overflow-y-auto no-scrollbar" style={sheetStyle}>
                        <div className="flex justify-center pt-2.5"><WashiTape color="rose" rotate={-2} className="w-16 h-2.5 rounded-full" /></div>
                        <div className="px-5 pt-3 pb-2">
                            <div className="flex items-center gap-2">
                                <span className="w-7 h-7 rounded-[7px] flex items-center justify-center text-sm font-black" style={{ background: '#3a3630', color: '#fcf8ef' }}>
                                    {editingOptIdx !== null ? String.fromCharCode(65 + editingOptIdx) : ''}
                                </span>
                                <span className="text-sm font-black" style={{ color: INK }}>编辑选项</span>
                            </div>
                        </div>
                        <div className="px-5 py-2 space-y-3">
                            <div>
                                <div className="text-[10px] font-black mb-1.5" style={{ color: INK_SOFT }}>选项内容</div>
                                <textarea
                                    autoFocus
                                    value={editOptText}
                                    onChange={e => setEditOptText(e.target.value)}
                                    rows={8}
                                    placeholder={`${charName}的行为...`}
                                    className="w-full rounded-2xl px-3.5 py-3 text-sm focus:outline-none resize-none"
                                    style={{ background: '#fffdf8', border: '1px solid rgba(196,184,160,0.8)', color: INK, lineHeight: '1.8' }}
                                />
                            </div>
                            <div>
                                <div className="text-[10px] font-black mb-1.5" style={{ color: INK_SOFT }}>好感度变化（支持负数）</div>
                                <input
                                    type="text" inputMode="numeric"
                                    value={editOptScore}
                                    onChange={e => {
                                        const v = e.target.value;
                                        // Allow empty, minus sign, or valid number input
                                        if (v === '' || v === '-' || /^-?\d*$/.test(v)) setEditOptScore(v);
                                    }}
                                    placeholder="0"
                                    className="w-full rounded-2xl px-3 py-2.5 text-sm text-center font-black focus:outline-none"
                                    style={{ background: '#fffdf8', border: '1px solid rgba(196,184,160,0.8)', color: INK }}
                                />
                            </div>
                        </div>
                        <div className="flex gap-2 px-5 pb-5 pt-1">
                            <button onClick={() => setEditingOptIdx(null)}
                                className="flex-1 py-2.5 text-xs font-black rounded-full active:scale-95 transition-transform" style={{ background: 'rgba(255,253,247,0.96)', color: '#6b6456', border: '1px solid rgba(196,184,160,0.85)' }}>
                                取消
                            </button>
                            <button onClick={() => {
                                if (editingOptIdx === null) return;
                                const t = [...optionTexts]; t[editingOptIdx] = editOptText; setOptionTexts(t);
                                const s = [...optionScores]; s[editingOptIdx] = Number(editOptScore) || 0; setOptionScores(s);
                                setEditingOptIdx(null);
                            }}
                                className="flex-1 py-2.5 text-xs font-black rounded-full active:scale-95 transition-transform" style={{ background: '#3a3630', color: '#fcf8ef', outline: '1px dashed rgba(255,255,255,0.3)', outlineOffset: -4 }}>
                                确认
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 场景编辑（底部抽屉） */}
            {editingScenario && (
                <div className="fixed inset-0 z-50 flex items-end justify-center p-3 pb-4 animate-fade-in" style={{ paddingBottom: `calc(1rem + var(--safe-bottom))` }}>
                    <div className="absolute inset-0" style={{ background: 'rgba(46,40,32,0.42)', backdropFilter: 'blur(3px)' }} onClick={() => setEditingScenario(false)} />
                    <div className="relative w-full max-w-md overflow-hidden animate-slide-up max-h-[85vh] overflow-y-auto no-scrollbar" style={sheetStyle}>
                        <div className="flex justify-center pt-2.5"><WashiTape color="lilac" rotate={-2} className="w-16 h-2.5 rounded-full" /></div>
                        <div className="px-5 pt-3 pb-2">
                            <div className="flex items-center gap-2">
                                <Stamp color="lilac" size={24}><FlowerLotus size={13} weight="fill" /></Stamp>
                                <span className="text-sm font-black" style={{ color: INK }}>编辑场景描述</span>
                            </div>
                        </div>
                        <div className="px-5 py-2">
                            <div className="text-[10px] font-black mb-1.5" style={{ color: INK_SOFT }}>GM 会在这个场景基础上展开叙事 (留空则由GM自由发挥)</div>
                            <textarea
                                autoFocus
                                value={editScenarioText}
                                onChange={e => setEditScenarioText(e.target.value)}
                                rows={10}
                                placeholder="比如: 雨天在咖啡馆偶遇 / 一起被困在电梯里 / 在图书馆发现对方的秘密日记..."
                                className="w-full rounded-2xl px-3.5 py-3 text-sm focus:outline-none resize-none"
                                style={{ background: '#fffdf8', border: '1px solid rgba(196,184,160,0.8)', color: INK, lineHeight: '1.8' }}
                            />
                        </div>
                        <div className="flex gap-2 px-5 pb-5 pt-1">
                            <button onClick={() => setEditingScenario(false)}
                                className="flex-1 py-2.5 text-xs font-black rounded-full active:scale-95 transition-transform" style={{ background: 'rgba(255,253,247,0.96)', color: '#6b6456', border: '1px solid rgba(196,184,160,0.85)' }}>
                                取消
                            </button>
                            <button onClick={() => { setRoundScenario(editScenarioText); setEditingScenario(false); }}
                                className="flex-1 py-2.5 text-xs font-black rounded-full active:scale-95 transition-transform" style={{ background: '#3a3630', color: '#fcf8ef', outline: '1px dashed rgba(255,255,255,0.3)', outlineOffset: -4 }}>
                                确认
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 退出确认 */}
            {showExitConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-6 animate-fade-in">
                    <div className="absolute inset-0" style={{ background: 'rgba(46,40,32,0.4)', backdropFilter: 'blur(3px)' }} onClick={() => setShowExitConfirm(false)} />
                    <div className="relative w-full max-w-xs animate-pop-in" style={paperDialogStyle}>
                        <WashiTape color="sage" rotate={-5} className="absolute -top-3 left-1/2 -translate-x-1/2 w-24 h-5 rounded-[2px] z-10" />
                        <div className="px-5 pt-6 pb-5 space-y-3">
                            <div className="font-black text-sm text-center" style={{ color: INK }}>退出游戏？</div>
                            <div className="text-xs text-center" style={{ color: '#6b6456' }}>进度已自动夹进本子，下次翻开还在</div>
                            <div className="flex gap-2">
                                <button onClick={() => setShowExitConfirm(false)}
                                    className="flex-1 py-2.5 text-xs font-black rounded-full active:scale-95 transition-transform" style={{ background: '#3a3630', color: '#fcf8ef', outline: '1px dashed rgba(255,255,255,0.3)', outlineOffset: -4 }}>
                                    继续玩
                                </button>
                                <button onClick={() => { setShowExitConfirm(false); backToLobby(); }}
                                    className="flex-1 py-2.5 text-xs font-black rounded-full active:scale-95 transition-transform" style={{ background: 'rgba(255,253,247,0.96)', color: '#6b6456', border: '1px solid rgba(196,184,160,0.85)' }}>
                                    退出
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* 回合长按菜单 */}
            {contextMenuRound !== null && (
                <div className="fixed inset-0 z-40 flex items-end justify-center p-4 pb-8 animate-fade-in" style={{ paddingBottom: `calc(2rem + var(--safe-bottom))` }}>
                    <div className="absolute inset-0" style={{ background: 'rgba(46,40,32,0.4)', backdropFilter: 'blur(3px)' }} onClick={() => setContextMenuRound(null)} />
                    <div className="relative w-full max-w-sm overflow-hidden animate-slide-up" style={{ ...paperDialogStyle, transform: 'none' }}>
                        <WashiTape color="lilac" rotate={-3} className="absolute -top-3 left-1/2 -translate-x-1/2 w-20 h-5 rounded-[2px] z-10" />
                        <div className="text-center text-[11px] font-black py-3 pt-5" style={{ color: INK_SOFT, borderBottom: '1px dashed rgba(176,162,138,0.5)' }}>
                            第 {(session?.rounds[contextMenuRound]?.roundNumber) || '?'} 回合
                        </div>
                        <button onClick={() => handleRegenerateFrom(contextMenuRound)} className="w-full py-3.5 text-sm font-black transition-colors active:bg-black/5" style={{ color: INK }}>
                            从这里重新生成
                        </button>
                        <div className="h-px mx-4" style={{ backgroundImage: 'repeating-linear-gradient(90deg, rgba(176,162,138,0.5) 0 5px, transparent 5px 10px)' }} />
                        <button onClick={() => handleDeleteFrom(contextMenuRound)} className="w-full py-3.5 text-sm font-black transition-colors active:bg-black/5" style={{ color: '#b3564e' }}>
                            撕掉此回合及之后的内容
                        </button>
                        <div className="h-px mx-4" style={{ backgroundImage: 'repeating-linear-gradient(90deg, rgba(176,162,138,0.5) 0 5px, transparent 5px 10px)' }} />
                        <button onClick={() => setContextMenuRound(null)} className="w-full py-3 text-sm font-bold transition-colors active:bg-black/5" style={{ color: INK_SOFT }}>
                            取消
                        </button>
                    </div>
                </div>
            )}
        </GameFrame>
    );
};

export default GuidebookApp;
