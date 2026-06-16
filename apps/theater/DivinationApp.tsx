import React, { useState, useEffect, useCallback } from 'react';
import { useOS } from '../../context/OSContext';
import { ArrowLeft, Sparkle, ArrowClockwise, PaperPlaneTilt, Stack, PencilSimple, MagicWand } from '@phosphor-icons/react';
import { resolveAuxApi } from '../../utils/auxApi';
import { DB } from '../../utils/db';
import { WorldbookRuntime } from '../../utils/worldbookRuntime';
import {
    TAROT_SPREADS, LENORMAND_SPREADS, drawTarot, drawLenormand, castLiuyao, castMeihua, nowToMeihuaTime,
    type SpreadDef, type DrawnTarot, type DrawnLenormand, type LiuyaoResult, type MeihuaResult,
} from '../../utils/divination/engines';
import {
    interpretReading, tarotToText, lenormandToText, liuyaoToText, meihuaToText, type DivinationKind,
} from '../../utils/divination/interpret';
import { TarotSpreadView, LenormandSpreadView } from '../../components/theater/divination/TarotCard';
import { LiuyaoView, MeihuaView } from '../../components/theater/divination/HexagramView';
import CardDeckManager from '../../components/theater/divination/CardDeckManager';

interface Props { onExit: () => void; }

const MODES: { kind: DivinationKind; label: string; en: string; desc: string; needsDeck?: 'tarot' | 'lenormand' }[] = [
    { kind: 'tarot', label: '塔罗', en: 'TAROT · 78', desc: '韦特 78 张，正逆位 + 牌阵', needsDeck: 'tarot' },
    { kind: 'lenormand', label: '雷诺曼', en: 'LENORMAND · 36', desc: '36 张小牌，串读直白', needsDeck: 'lenormand' },
    { kind: 'liuyao', label: '六爻', en: 'LIU YAO · 金钱卦', desc: '三枚铜钱摇六爻，本卦变卦', },
    { kind: 'meihua', label: '梅花易数', en: 'MEI HUA', desc: '时间 / 报数起卦，体用互变', },
];

/** 构建角色当前生效的世界书文本（local + global），用于喂解牌 prompt。 */
const buildWorldbookText = (char: any): string => {
    try {
        const { local, global } = WorldbookRuntime.resolveForChar(char);
        const all = [...local, ...global].map(e => `【${e.title}】${e.content}`).filter(Boolean);
        return all.join('\n').slice(0, 2000);
    } catch { return ''; }
};

const DivinationApp: React.FC<Props> = ({ onExit }) => {
    const { characters, apiConfig, auxApiConfig, userProfile, addToast, theme } = useOS();
    const api = resolveAuxApi(auxApiConfig, apiConfig);
    const apiReady = !!(api.baseUrl && api.model);
    const skin = theme?.tarotSkin;

    const [mode, setMode] = useState<DivinationKind>('tarot');
    const [pickCharId, setPickCharId] = useState('');
    const char = characters.find(c => c.id === pickCharId);
    const [question, setQuestion] = useState('');
    const [view, setView] = useState<'home' | 'deck'>('home');
    const [deckToManage, setDeckToManage] = useState<'tarot' | 'lenormand'>('tarot');

    // 牌阵
    const [tarotSpread, setTarotSpread] = useState<SpreadDef>(TAROT_SPREADS[1]);
    const [lenoSpread, setLenoSpread] = useState<SpreadDef>(LENORMAND_SPREADS[1]);
    // 梅花起卦法
    const [meihuaMethod, setMeihuaMethod] = useState<'time' | 'number'>('time');
    const [n1, setN1] = useState(''); const [n2, setN2] = useState('');

    // 已导入的牌图：deck → (index → dataUrl)
    const [tarotImgs, setTarotImgs] = useState<Record<number, string>>({});
    const [lenoImgs, setLenoImgs] = useState<Record<number, string>>({});

    // 占卜结果
    const [tarotDraws, setTarotDraws] = useState<DrawnTarot[] | null>(null);
    const [lenoDraws, setLenoDraws] = useState<DrawnLenormand[] | null>(null);
    const [liuyao, setLiuyao] = useState<LiuyaoResult | null>(null);
    const [meihua, setMeihua] = useState<MeihuaResult | null>(null);
    const [hasResult, setHasResult] = useState(false);

    // 解读
    const [manualText, setManualText] = useState('');
    const [aiText, setAiText] = useState('');
    const [busy, setBusy] = useState(false);

    const loadDecks = useCallback(async () => {
        const [t, l] = await Promise.all([DB.getDivinationCards('tarot'), DB.getDivinationCards('lenormand')]);
        setTarotImgs(Object.fromEntries(t.map(c => [c.index, c.dataUrl])));
        setLenoImgs(Object.fromEntries(l.map(c => [c.index, c.dataUrl])));
    }, []);
    useEffect(() => { void loadDecks(); }, [loadDecks]);

    const resetResult = () => { setTarotDraws(null); setLenoDraws(null); setLiuyao(null); setMeihua(null); setHasResult(false); setManualText(''); setAiText(''); };

    const doDivine = () => {
        resetResult();
        if (mode === 'tarot') setTarotDraws(drawTarot(tarotSpread));
        else if (mode === 'lenormand') setLenoDraws(drawLenormand(lenoSpread));
        else if (mode === 'liuyao') setLiuyao(castLiuyao());
        else if (mode === 'meihua') {
            if (meihuaMethod === 'time') setMeihua(castMeihua({ method: 'time', time: nowToMeihuaTime() }));
            else {
                const a = parseInt(n1, 10), b = parseInt(n2, 10);
                if (!Number.isFinite(a) || !Number.isFinite(b)) { addToast('报数起卦请填两个数字', 'info'); return; }
                setMeihua(castMeihua({ method: 'number', numbers: { n1: a, n2: b } }));
            }
        }
        setHasResult(true);
    };

    /** 当前结果转文字摘要（解读 / 发到聊天共用）。 */
    const currentReadingText = (): string => {
        if (tarotDraws) return tarotToText(tarotSpread.name, tarotDraws);
        if (lenoDraws) return lenormandToText(lenoSpread.name, lenoDraws);
        if (liuyao) return liuyaoToText(liuyao);
        if (meihua) return meihuaToText(meihua);
        return '';
    };

    const runInterpret = async () => {
        if (!char) { addToast('先选一个为你解牌的角色', 'info'); return; }
        if (!apiReady) { addToast('还没配置 API，去「文具盒」填好再来', 'error'); return; }
        setBusy(true); setAiText('');
        try {
            const out = await interpretReading({
                api, kind: mode, readingText: currentReadingText(), question,
                char, userProfile, worldbookText: buildWorldbookText(char),
            });
            setAiText(out);
        } catch (e: any) {
            addToast('解牌失败：' + (e?.message || e), 'error');
        } finally { setBusy(false); }
    };

    const exportToChat = async () => {
        if (!char) { addToast('先选一个角色才能发到 TA 的聊天', 'info'); return; }
        const interp = aiText || manualText.trim();
        const body = `【占卜${question ? `·${question}` : ''}】\n${currentReadingText()}` + (interp ? `\n\n— ${char.name} 的解读 —\n${interp}` : '');
        try {
            await DB.saveMessage({ charId: char.id, role: 'system', type: 'text', content: body, timestamp: Date.now() });
            addToast(`已发到与 ${char.name} 的聊天`, 'success');
        } catch { addToast('发送失败', 'error'); }
    };

    // 牌库管理子页
    if (view === 'deck') {
        return (
            <CardDeckManager
                deck={deckToManage}
                images={deckToManage === 'tarot' ? tarotImgs : lenoImgs}
                onChanged={loadDecks}
                onBack={() => setView('home')}
                addToast={addToast}
            />
        );
    }

    const activeMode = MODES.find(m => m.kind === mode)!;
    const deckImported = mode === 'tarot' ? Object.keys(tarotImgs).length : mode === 'lenormand' ? Object.keys(lenoImgs).length : -1;

    return (
        <div className="absolute inset-0 flex flex-col bg-[#14101c] text-white animate-fade-in overflow-hidden" style={{ paddingTop: 'var(--safe-top)' }}>
            <div aria-hidden className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-[140%] h-72 rounded-full blur-3xl opacity-40 bg-gradient-to-b from-violet-500/50 via-indigo-500/20 to-transparent" />
            <div className="relative flex items-center px-4 pt-3 pb-2 shrink-0 z-10">
                <button onClick={onExit} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-[11px] font-bold bg-white/10 hover:bg-white/15 text-white/80 active:scale-95 transition-all border border-white/10">
                    <ArrowLeft size={14} weight="bold" /> 返回
                </button>
                <div className="absolute left-1/2 -translate-x-1/2 text-[11px] tracking-[0.3em] text-white/45 select-none">占卜 · DIVINATION</div>
            </div>

            <div className="flex-1 overflow-y-auto no-scrollbar px-5 pb-10 space-y-4 z-10">
                {/* 模式选择 */}
                <div className="grid grid-cols-2 gap-2">
                    {MODES.map(m => (
                        <button key={m.kind} onClick={() => { setMode(m.kind); resetResult(); }}
                            className={`text-left p-3 rounded-2xl border transition-all ${mode === m.kind ? 'border-violet-300/60 bg-violet-300/10' : 'border-white/10 bg-white/[0.03]'}`}>
                            <div className="text-[8px] tracking-widest text-violet-200/60 font-mono">{m.en}</div>
                            <div className="text-base font-black text-white mt-0.5">{m.label}</div>
                            <div className="text-[10px] text-white/45 mt-0.5 leading-tight">{m.desc}</div>
                        </button>
                    ))}
                </div>

                {/* 角色选择 */}
                <div>
                    <div className="text-[11px] text-white/55 mb-1.5">和谁一起占卜（解牌时以 TA 口吻 + 世界书）</div>
                    <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                        {characters.length === 0 && <div className="text-white/40 text-xs py-2">还没有角色，先去创建一个吧</div>}
                        {characters.map(c => (
                            <button key={c.id} onClick={() => setPickCharId(c.id)}
                                className={`shrink-0 flex flex-col items-center gap-1 px-2 py-1.5 rounded-2xl border transition-all ${pickCharId === c.id ? 'border-violet-300/60 bg-violet-300/10' : 'border-white/10 bg-white/[0.03]'}`}>
                                <img src={c.avatar} className="w-11 h-11 rounded-full object-cover" alt={c.name} />
                                <span className="text-[10px] text-white/70 max-w-[56px] truncate">{c.name}</span>
                            </button>
                        ))}
                    </div>
                </div>

                {/* 问题 */}
                <input value={question} onChange={e => setQuestion(e.target.value)} placeholder="想占问什么？（如：这段关系的走向 / 这个决定）"
                    className="w-full bg-black/30 rounded-xl px-3 py-2.5 text-sm outline-none border border-white/10 focus:border-violet-300/40" />

                {/* 各模式的参数 */}
                {mode === 'tarot' && (
                    <div className="space-y-2">
                        <div className="flex flex-wrap gap-1.5">
                            {TAROT_SPREADS.map(s => (
                                <button key={s.key} onClick={() => setTarotSpread(s)}
                                    className={`px-2.5 py-1 rounded-full text-[11px] border ${tarotSpread.key === s.key ? 'bg-violet-400/20 border-violet-300/50 text-violet-100' : 'bg-white/[0.04] border-white/10 text-white/60'}`}>{s.name}（{s.count}）</button>
                            ))}
                        </div>
                        {deckImported === 0 && (
                            <button onClick={() => { setDeckToManage('tarot'); setView('deck'); }} className="w-full py-2 rounded-xl text-[12px] font-bold bg-amber-300/15 border border-amber-300/30 text-amber-100 inline-flex items-center justify-center gap-1.5">
                                <Stack size={15} weight="bold" /> 还没导入塔罗牌图，点此批量导入（也可不导入，用文字牌义占卜）
                            </button>
                        )}
                    </div>
                )}
                {mode === 'lenormand' && (
                    <div className="space-y-2">
                        <div className="flex flex-wrap gap-1.5">
                            {LENORMAND_SPREADS.map(s => (
                                <button key={s.key} onClick={() => setLenoSpread(s)}
                                    className={`px-2.5 py-1 rounded-full text-[11px] border ${lenoSpread.key === s.key ? 'bg-violet-400/20 border-violet-300/50 text-violet-100' : 'bg-white/[0.04] border-white/10 text-white/60'}`}>{s.name}（{s.count}）</button>
                            ))}
                        </div>
                        {deckImported === 0 && (
                            <button onClick={() => { setDeckToManage('lenormand'); setView('deck'); }} className="w-full py-2 rounded-xl text-[12px] font-bold bg-amber-300/15 border border-amber-300/30 text-amber-100 inline-flex items-center justify-center gap-1.5">
                                <Stack size={15} weight="bold" /> 还没导入雷诺曼牌图，点此批量导入
                            </button>
                        )}
                    </div>
                )}
                {mode === 'meihua' && (
                    <div className="space-y-2">
                        <div className="flex gap-1.5">
                            {(['time', 'number'] as const).map(m => (
                                <button key={m} onClick={() => setMeihuaMethod(m)}
                                    className={`px-3 py-1.5 rounded-full text-[11px] border ${meihuaMethod === m ? 'bg-violet-400/20 border-violet-300/50 text-violet-100' : 'bg-white/[0.04] border-white/10 text-white/60'}`}>{m === 'time' ? '时间起卦' : '报数起卦'}</button>
                            ))}
                        </div>
                        {meihuaMethod === 'number' && (
                            <div className="flex gap-2">
                                <input value={n1} onChange={e => setN1(e.target.value)} inputMode="numeric" placeholder="第一个数" className="flex-1 bg-black/30 rounded-xl px-3 py-2 text-sm outline-none border border-white/10 focus:border-violet-300/40" />
                                <input value={n2} onChange={e => setN2(e.target.value)} inputMode="numeric" placeholder="第二个数" className="flex-1 bg-black/30 rounded-xl px-3 py-2 text-sm outline-none border border-white/10 focus:border-violet-300/40" />
                            </div>
                        )}
                    </div>
                )}

                {/* 起卦/抽牌按钮 */}
                <button onClick={doDivine}
                    className="w-full py-3 rounded-xl text-sm font-black bg-gradient-to-r from-violet-400 to-indigo-400 text-[#14101c] active:scale-95 inline-flex items-center justify-center gap-2">
                    <Sparkle size={18} weight="fill" /> {hasResult ? '重新' : ''}{mode === 'tarot' || mode === 'lenormand' ? '抽牌' : '起卦'}（{activeMode.label}）
                </button>

                {/* 结果 */}
                {hasResult && (
                    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 space-y-3">
                        {tarotDraws && <TarotSpreadView draws={tarotDraws} images={tarotImgs} skin={skin} />}
                        {lenoDraws && <LenormandSpreadView draws={lenoDraws} images={lenoImgs} skin={skin} />}
                        {liuyao && <LiuyaoView r={liuyao} />}
                        {meihua && <MeihuaView r={meihua} />}

                        {/* 解读区 */}
                        <div className="border-t border-white/10 pt-3 space-y-2">
                            <div className="flex gap-2">
                                <button onClick={() => void runInterpret()} disabled={busy}
                                    className="flex-1 py-2.5 rounded-xl text-[12px] font-bold bg-violet-300/90 text-[#14101c] active:scale-95 disabled:opacity-50 inline-flex items-center justify-center gap-1.5">
                                    <MagicWand size={15} weight="bold" /> {busy ? '解牌中…' : `让 ${char?.name || 'TA'} 解牌`}
                                </button>
                                <button onClick={() => void doDivine()} className="px-3 py-2.5 rounded-xl text-[12px] font-bold bg-white/10 active:scale-95 inline-flex items-center justify-center gap-1.5" title="重抽/重起">
                                    <ArrowClockwise size={15} weight="bold" />
                                </button>
                            </div>

                            {aiText && (
                                <div className="rounded-xl border border-violet-300/20 bg-violet-500/[0.06] p-3 text-[13px] text-white/85 leading-relaxed whitespace-pre-wrap">{aiText}</div>
                            )}

                            <details className="rounded-xl border border-white/10 bg-white/[0.02]">
                                <summary className="px-3 py-2 text-[12px] text-white/60 cursor-pointer inline-flex items-center gap-1.5 list-none"><PencilSimple size={14} weight="bold" /> 自己解（手写解读）</summary>
                                <div className="px-3 pb-3">
                                    <textarea value={manualText} onChange={e => setManualText(e.target.value)} rows={4} placeholder="写下你对这次占卜的理解…"
                                        className="w-full bg-black/30 rounded-xl px-3 py-2 text-sm outline-none border border-white/10 focus:border-violet-300/40 resize-none" />
                                </div>
                            </details>

                            <button onClick={() => void exportToChat()}
                                className="w-full py-2.5 rounded-xl text-[12px] font-bold bg-white/10 active:scale-95 inline-flex items-center justify-center gap-1.5">
                                <PaperPlaneTilt size={15} weight="bold" /> 发到与 {char?.name || 'TA'} 的聊天
                            </button>
                        </div>
                    </div>
                )}

                {/* 牌库入口（常驻底部，方便管理） */}
                {(mode === 'tarot' || mode === 'lenormand') && (
                    <button onClick={() => { setDeckToManage(mode); setView('deck'); }}
                        className="w-full py-2 rounded-xl text-[11px] text-white/55 bg-white/[0.03] border border-white/10 inline-flex items-center justify-center gap-1.5">
                        <Stack size={14} weight="bold" /> 管理{activeMode.label}牌库（已导入 {mode === 'tarot' ? Object.keys(tarotImgs).length : Object.keys(lenoImgs).length} 张）
                    </button>
                )}
            </div>
        </div>
    );
};

export default DivinationApp;
