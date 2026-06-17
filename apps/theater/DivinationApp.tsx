import React, { useState, useEffect, useCallback } from 'react';
import { useOS } from '../../context/OSContext';
import { Sparkle, ArrowClockwise, PaperPlaneTilt, Stack, PencilSimple, Cards } from '@phosphor-icons/react';
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
import { PaperShell, ScrapScroll, ScrapHeader, Polaroid, ScrapButton, INK, INK_SOFT } from './scrapbook';

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

// 浅纸面输入框样式
const paperInput: React.CSSProperties = { background: 'rgba(255,253,247,0.85)', color: '#3a362f', border: '1px solid rgba(176,170,158,0.7)' };

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

    const [tarotSpread, setTarotSpread] = useState<SpreadDef>(TAROT_SPREADS[1]);
    const [lenoSpread, setLenoSpread] = useState<SpreadDef>(LENORMAND_SPREADS[1]);
    const [meihuaMethod, setMeihuaMethod] = useState<'time' | 'number'>('time');
    const [n1, setN1] = useState(''); const [n2, setN2] = useState('');

    const [tarotImgs, setTarotImgs] = useState<Record<number, string>>({});
    const [lenoImgs, setLenoImgs] = useState<Record<number, string>>({});

    const [tarotDraws, setTarotDraws] = useState<DrawnTarot[] | null>(null);
    const [lenoDraws, setLenoDraws] = useState<DrawnLenormand[] | null>(null);
    const [liuyao, setLiuyao] = useState<LiuyaoResult | null>(null);
    const [meihua, setMeihua] = useState<MeihuaResult | null>(null);
    const [hasResult, setHasResult] = useState(false);

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

    // 牌阵 / 起卦 切换胶囊
    const chip = (on: boolean): React.CSSProperties => on
        ? { background: '#1f1d1a', color: '#f6f3ec', border: 'none' }
        : { background: 'rgba(255,253,247,0.7)', color: '#5b554a', border: '1px solid rgba(176,170,158,0.65)' };

    return (
        <PaperShell>
            <ScrapHeader title="占卜" en="THE READING" onBack={onExit} backLabel="回戏单" />

            <ScrapScroll className="px-5 pb-10 space-y-4 pt-1">
                {/* 模式选择 */}
                <div className="grid grid-cols-2 gap-2.5">
                    {MODES.map((m, i) => {
                        const on = mode === m.kind;
                        return (
                            <button key={m.kind} onClick={() => { setMode(m.kind); resetResult(); }}
                                className="text-left p-3 rounded-[14px] transition-all active:scale-[0.98]" style={{
                                    background: on ? 'linear-gradient(180deg,#2a2722,#1f1d1a)' : 'linear-gradient(180deg,#fbf9f2,#f1eee4)',
                                    color: on ? '#f6f3ec' : INK,
                                    border: on ? '1px solid #1f1d1a' : '1px solid rgba(176,170,158,0.7)',
                                    outline: '1px dashed', outlineColor: on ? 'rgba(255,255,255,0.25)' : 'rgba(150,144,132,0.45)', outlineOffset: -5,
                                    transform: `rotate(${i % 2 ? 0.5 : -0.5}deg)`,
                                }}>
                                <div className="text-[8px] tracking-[0.2em]" style={{ fontFamily: 'var(--font-label)', color: on ? 'rgba(246,243,236,0.6)' : INK_SOFT }}>{m.en}</div>
                                <div className="text-base font-black mt-0.5">{m.label}</div>
                                <div className="text-[10px] mt-0.5 leading-tight" style={{ color: on ? 'rgba(246,243,236,0.7)' : '#6b6558' }}>{m.desc}</div>
                            </button>
                        );
                    })}
                </div>

                {/* 角色选择 */}
                <div>
                    <div className="text-[11px] mb-2" style={{ color: '#6b6558' }}>和谁一起占卜（解牌时以 TA 口吻 + 世界书）</div>
                    <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1 px-0.5">
                        {characters.length === 0 && <div className="text-xs py-2" style={{ color: INK_SOFT }}>还没有角色，先去创建一个吧</div>}
                        {characters.map((c, i) => (
                            <Polaroid key={c.id} src={c.avatar} caption={c.name} size={48} rotate={i % 2 ? 1.5 : -1.5} selected={pickCharId === c.id} onClick={() => setPickCharId(c.id)} />
                        ))}
                    </div>
                </div>

                {/* 问题 */}
                <input value={question} onChange={e => setQuestion(e.target.value)} placeholder="想占问什么？（如：这段关系的走向 / 这个决定）"
                    className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={paperInput} />

                {/* 各模式参数 */}
                {mode === 'tarot' && (
                    <div className="space-y-2">
                        <div className="flex flex-wrap gap-1.5">
                            {TAROT_SPREADS.map(s => (
                                <button key={s.key} onClick={() => setTarotSpread(s)} className="px-2.5 py-1 rounded-full text-[11px] font-bold transition" style={chip(tarotSpread.key === s.key)}>{s.name}（{s.count}）</button>
                            ))}
                        </div>
                        {deckImported === 0 && (
                            <button onClick={() => { setDeckToManage('tarot'); setView('deck'); }} className="w-full py-2 rounded-xl text-[12px] font-bold inline-flex items-center justify-center gap-1.5" style={{ background: 'rgba(31,29,26,0.06)', color: '#5b554a', border: '1px dashed rgba(150,144,132,0.7)' }}>
                                <Stack size={15} weight="bold" /> 还没导入塔罗牌图，点此批量导入（也可不导入，用文字牌义占卜）
                            </button>
                        )}
                    </div>
                )}
                {mode === 'lenormand' && (
                    <div className="space-y-2">
                        <div className="flex flex-wrap gap-1.5">
                            {LENORMAND_SPREADS.map(s => (
                                <button key={s.key} onClick={() => setLenoSpread(s)} className="px-2.5 py-1 rounded-full text-[11px] font-bold transition" style={chip(lenoSpread.key === s.key)}>{s.name}（{s.count}）</button>
                            ))}
                        </div>
                        {deckImported === 0 && (
                            <button onClick={() => { setDeckToManage('lenormand'); setView('deck'); }} className="w-full py-2 rounded-xl text-[12px] font-bold inline-flex items-center justify-center gap-1.5" style={{ background: 'rgba(31,29,26,0.06)', color: '#5b554a', border: '1px dashed rgba(150,144,132,0.7)' }}>
                                <Stack size={15} weight="bold" /> 还没导入雷诺曼牌图，点此批量导入
                            </button>
                        )}
                    </div>
                )}
                {mode === 'meihua' && (
                    <div className="space-y-2">
                        <div className="flex gap-1.5">
                            {(['time', 'number'] as const).map(m => (
                                <button key={m} onClick={() => setMeihuaMethod(m)} className="px-3 py-1.5 rounded-full text-[11px] font-bold transition" style={chip(meihuaMethod === m)}>{m === 'time' ? '时间起卦' : '报数起卦'}</button>
                            ))}
                        </div>
                        {meihuaMethod === 'number' && (
                            <div className="flex gap-2">
                                <input value={n1} onChange={e => setN1(e.target.value)} inputMode="numeric" placeholder="第一个数" className="flex-1 rounded-xl px-3 py-2 text-sm outline-none" style={paperInput} />
                                <input value={n2} onChange={e => setN2(e.target.value)} inputMode="numeric" placeholder="第二个数" className="flex-1 rounded-xl px-3 py-2 text-sm outline-none" style={paperInput} />
                            </div>
                        )}
                    </div>
                )}

                {/* 起卦/抽牌按钮 */}
                <ScrapButton variant="ink" className="w-full py-3 text-sm" onClick={doDivine} icon={mode === 'tarot' || mode === 'lenormand' ? <Cards size={17} weight="bold" /> : <Sparkle size={17} weight="fill" />}>
                    {hasResult ? '重新' : ''}{mode === 'tarot' || mode === 'lenormand' ? '抽牌' : '起卦'}（{activeMode.label}）
                </ScrapButton>

                {/* 结果：拼贴里贴进一张「黑底相版」，保证牌面 / 卦象在深色上仍清晰 */}
                {hasResult && (
                    <div className="relative rounded-[16px] p-4 space-y-3" style={{
                        background: 'linear-gradient(180deg,#26231f,#1c1a17)', color: '#f3ecdf',
                        border: '1px solid rgba(31,29,26,0.8)', outline: '1px dashed rgba(246,243,236,0.22)', outlineOffset: -6,
                        boxShadow: '0 18px 34px -20px rgba(31,29,26,0.7)', transform: 'rotate(-0.4deg)',
                    }}>
                        {tarotDraws && <TarotSpreadView draws={tarotDraws} images={tarotImgs} skin={skin} />}
                        {lenoDraws && <LenormandSpreadView draws={lenoDraws} images={lenoImgs} skin={skin} />}
                        {liuyao && <LiuyaoView r={liuyao} />}
                        {meihua && <MeihuaView r={meihua} />}

                        <div className="border-t pt-3 space-y-2" style={{ borderColor: 'rgba(246,243,236,0.14)' }}>
                            <div className="flex gap-2">
                                <button onClick={() => void runInterpret()} disabled={busy} className="flex-1 py-2.5 rounded-xl text-[12px] font-bold active:scale-95 disabled:opacity-50 inline-flex items-center justify-center gap-1.5" style={{ background: '#f3ecdf', color: '#1f1d1a' }}>
                                    <Cards size={15} weight="bold" /> {busy ? '解牌中…' : `让 ${char?.name || 'TA'} 解牌`}
                                </button>
                                <button onClick={() => void doDivine()} className="px-3 py-2.5 rounded-xl text-[12px] font-bold active:scale-95 inline-flex items-center justify-center" style={{ background: 'rgba(246,243,236,0.12)', color: '#f3ecdf' }} title="重抽/重起">
                                    <ArrowClockwise size={15} weight="bold" />
                                </button>
                            </div>

                            {aiText && (
                                <div className="rounded-xl p-3 text-[13px] leading-relaxed whitespace-pre-wrap" style={{ background: 'rgba(246,243,236,0.08)', border: '1px solid rgba(246,243,236,0.16)', color: 'rgba(246,243,236,0.92)' }}>{aiText}</div>
                            )}

                            <details className="rounded-xl" style={{ background: 'rgba(246,243,236,0.05)', border: '1px solid rgba(246,243,236,0.12)' }}>
                                <summary className="px-3 py-2 text-[12px] cursor-pointer inline-flex items-center gap-1.5 list-none" style={{ color: 'rgba(246,243,236,0.7)' }}><PencilSimple size={14} weight="bold" /> 自己解（手写解读）</summary>
                                <div className="px-3 pb-3">
                                    <textarea value={manualText} onChange={e => setManualText(e.target.value)} rows={4} placeholder="写下你对这次占卜的理解…"
                                        className="w-full rounded-xl px-3 py-2 text-sm outline-none resize-none" style={{ background: 'rgba(0,0,0,0.25)', color: '#f3ecdf', border: '1px solid rgba(246,243,236,0.16)' }} />
                                </div>
                            </details>

                            <button onClick={() => void exportToChat()} className="w-full py-2.5 rounded-xl text-[12px] font-bold active:scale-95 inline-flex items-center justify-center gap-1.5" style={{ background: 'rgba(246,243,236,0.12)', color: '#f3ecdf' }}>
                                <PaperPlaneTilt size={15} weight="bold" /> 发到与 {char?.name || 'TA'} 的聊天
                            </button>
                        </div>
                    </div>
                )}

                {/* 牌库入口 */}
                {(mode === 'tarot' || mode === 'lenormand') && (
                    <ScrapButton variant="ghost" className="w-full py-2 text-[11px]" onClick={() => { setDeckToManage(mode); setView('deck'); }} icon={<Stack size={14} weight="bold" />}>
                        管理{activeMode.label}牌库（已导入 {mode === 'tarot' ? Object.keys(tarotImgs).length : Object.keys(lenoImgs).length} 张）
                    </ScrapButton>
                )}
            </ScrapScroll>
        </PaperShell>
    );
};

export default DivinationApp;
