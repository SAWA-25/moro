import React, { useState, useEffect, useCallback } from 'react';
import { useOS } from '../../context/OSContext';
import { Sparkle, ArrowClockwise, PaperPlaneTilt, Stack, Cards, Lightbulb, MagicWand } from '@phosphor-icons/react';
import { resolveAuxApi } from '../../utils/auxApi';
import { DB } from '../../utils/db';
import { WorldbookRuntime } from '../../utils/worldbookRuntime';
import {
    TAROT_SPREADS, LENORMAND_SPREADS, castLiuyao, castMeihua, nowToMeihuaTime,
    shuffledTarotDeck, tarotFromPicks, shuffledLenormandDeck, lenormandFromPicks,
    type SpreadDef, type DrawnTarot, type DrawnLenormand, type LiuyaoResult, type MeihuaResult, type TarotPick,
} from '../../utils/divination/engines';
import {
    interpretReading, tarotToText, lenormandToText, liuyaoToText, meihuaToText, type DivinationKind, type ReadingTurn,
} from '../../utils/divination/interpret';
import {
    tarotLocalInsight, lenormandLocalInsight, liuyaoLocalInsight, meihuaLocalInsight, type LocalReadingInsight,
} from '../../utils/divination/insights';
import { TarotSpreadView, LenormandSpreadView } from '../../components/theater/divination/TarotCard';
import { LiuyaoView, MeihuaView } from '../../components/theater/divination/HexagramView';
import CardDeckManager from '../../components/theater/divination/CardDeckManager';
import CardPicker from '../../components/theater/divination/CardPicker';
import { PaperShell, ScrapScroll, ScrapHeader, Polaroid, ScrapButton, INK, INK_SOFT } from '../ui/insScrapKit';

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

// 默认牌背图（放在 public/ 根，部署后按此路径取；该图在主支上）。取不到时回退到 CSS 黑白牌背。
const DEFAULT_CARD_BACK = '/A6581845961B07B58DA1E1E88DA367F3.jpg';

const QUESTION_PRESETS = [
    { label: '关系走向', text: '这段关系接下来最需要看清什么？' },
    { label: 'TA 的心意', text: 'TA 现在对我的真实心意和顾虑分别是什么？' },
    { label: '选择建议', text: '如果我在两个选择之间犹豫，现在更该看重什么？' },
    { label: '近期变化', text: '接下来一周最容易发生的变化是什么？' },
    { label: '阻碍来源', text: '这件事目前最大的阻碍在哪里，我能先处理哪一部分？' },
    { label: '行动一步', text: '我今天可以做的最小一步是什么？' },
];

const InsightPanel: React.FC<{ insight: LocalReadingInsight; onPickPrompt: (text: string) => void }> = ({ insight, onPickPrompt }) => (
    <div className="rounded-[14px] p-3 space-y-2.5" style={{ background: 'rgba(246,243,236,0.08)', border: '1px solid rgba(246,243,236,0.14)' }}>
        <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-full flex items-center justify-center shrink-0" style={{ background: 'rgba(246,243,236,0.12)', color: '#f3ecdf' }}>
                <Lightbulb size={15} weight="fill" />
            </span>
            <div className="min-w-0">
                <div className="text-[9px] tracking-[0.28em]" style={{ fontFamily: 'var(--font-label)', color: 'rgba(246,243,236,0.42)' }}>LOCAL READING</div>
                <div className="text-[13px] font-black truncate" style={{ color: '#f3ecdf' }}>{insight.title}</div>
            </div>
        </div>
        <div className="space-y-1.5">
            {insight.items.map((item, i) => (
                <div key={i} className="flex gap-2 text-[12px] leading-relaxed" style={{ color: 'rgba(246,243,236,0.72)' }}>
                    <span className="mt-[0.45em] w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'rgba(246,243,236,0.38)' }} />
                    <span>{item}</span>
                </div>
            ))}
        </div>
        <div className="flex flex-wrap gap-1.5 pt-1">
            {insight.prompts.map(p => (
                <button key={p} onClick={() => onPickPrompt(p)}
                    className="px-2.5 py-1 rounded-full text-[10.5px] font-bold active:scale-95"
                    style={{ background: 'rgba(246,243,236,0.12)', color: '#f3ecdf', border: '1px solid rgba(246,243,236,0.12)' }}>
                    {p}
                </button>
            ))}
        </div>
    </div>
);

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

    // 翻牌挑选（塔罗 / 雷诺曼）：洗牌 → 抽牌两段式交互在 CardPicker 里；这里只持有「当前那副洗好的牌」。
    const [pickPhase, setPickPhase] = useState(false);
    const [tarotPickDeck, setTarotPickDeck] = useState<TarotPick[]>([]);
    const [lenoPickDeck, setLenoPickDeck] = useState<ReturnType<typeof shuffledLenormandDeck>>([]);

    // 抽牌后「继续和角色对话」：角色围绕同一副牌继续回应追问（取代旧的「自己解」手写框）
    const [convo, setConvo] = useState<{ role: 'user' | 'char'; text: string }[]>([]);
    const [askInput, setAskInput] = useState('');
    const [busy, setBusy] = useState(false);
    const userName = (userProfile?.name || '').trim() || '我';

    const loadDecks = useCallback(async () => {
        const [t, l] = await Promise.all([DB.getDivinationCards('tarot'), DB.getDivinationCards('lenormand')]);
        setTarotImgs(Object.fromEntries(t.map(c => [c.index, c.dataUrl])));
        setLenoImgs(Object.fromEntries(l.map(c => [c.index, c.dataUrl])));
    }, []);
    useEffect(() => { void loadDecks(); }, [loadDecks]);

    const resetResult = () => { setTarotDraws(null); setLenoDraws(null); setLiuyao(null); setMeihua(null); setHasResult(false); setConvo([]); setAskInput(''); setPickPhase(false); };

    const fillQuestion = (text: string) => {
        setQuestion(text);
        setAskInput(prev => (convo.length ? text : prev));
    };

    const randomMeihuaNumbers = () => {
        const buf = new Uint32Array(2);
        crypto.getRandomValues(buf);
        setN1(String((buf[0] % 999) + 1));
        setN2(String((buf[1] % 999) + 1));
    };

    /** 塔罗 / 雷诺曼：进入洗牌+抽牌挑选；六爻 / 梅花：直接起卦出结果。 */
    const startDivine = () => {
        resetResult();
        if (mode === 'tarot') { setTarotPickDeck(shuffledTarotDeck()); setPickPhase(true); return; }
        if (mode === 'lenormand') { setLenoPickDeck(shuffledLenormandDeck()); setPickPhase(true); return; }
        if (mode === 'liuyao') setLiuyao(castLiuyao());
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

    /** CardPicker 抽满后回调：按牌阵位置顺序把选中的索引落到各位置，翻开出结果。 */
    const handleReveal = (picks: number[]) => {
        if (mode === 'tarot') setTarotDraws(tarotFromPicks(tarotSpread, picks.map(i => tarotPickDeck[i])));
        else if (mode === 'lenormand') setLenoDraws(lenormandFromPicks(lenoSpread, picks.map(i => lenoPickDeck[i])));
        setPickPhase(false);
        setHasResult(true);
    };

    const currentReadingText = (): string => {
        if (tarotDraws) return tarotToText(tarotSpread.name, tarotDraws);
        if (lenoDraws) return lenormandToText(lenoSpread.name, lenoDraws);
        if (liuyao) return liuyaoToText(liuyao);
        if (meihua) return meihuaToText(meihua);
        return '';
    };

    const currentInsight = (): LocalReadingInsight | null => {
        if (tarotDraws) return tarotLocalInsight(tarotDraws);
        if (lenoDraws) return lenormandLocalInsight(lenoDraws);
        if (liuyao) return liuyaoLocalInsight(liuyao);
        if (meihua) return meihuaLocalInsight(meihua);
        return null;
    };

    const insightToText = (v: LocalReadingInsight | null): string => {
        if (!v) return '';
        const prompts = v.prompts.length ? `\n可继续追问：${v.prompts.join(' / ')}` : '';
        return `【本地速读 · ${v.title}】\n${v.items.map(item => `- ${item}`).join('\n')}${prompts}`;
    };

    /**
     * 解牌 / 继续追问统一入口：
     *  - 无入参 = 首次解牌（角色给完整解读）；
     *  - 传 userMessage = 围绕同一副牌的追问，角色顺着已抽的牌口语化回应。
     */
    const ask = async (userMessage?: string) => {
        if (!char) { addToast('先选一个为你解牌的角色', 'info'); return; }
        if (!apiReady) { addToast('还没配置 API，去「文具盒」填好再来', 'error'); return; }
        if (busy) return;
        const q = userMessage?.trim();
        // 显示态对话 → LLM 角色历史；追问把新问题接在末尾
        const history: ReadingTurn[] = convo.map(m => ({ role: m.role === 'char' ? 'assistant' : 'user', content: m.text }));
        if (q) history.push({ role: 'user', content: q });
        setBusy(true);
        if (q) { setConvo(prev => [...prev, { role: 'user', text: q }]); setAskInput(''); }
        try {
            const out = await interpretReading({
                api, kind: mode, readingText: currentReadingText(), question,
                char, userProfile, worldbookText: buildWorldbookText(char),
                history: history.length ? history : undefined,
            });
            setConvo(prev => [...prev, { role: 'char', text: out }]);
        } catch (e: any) {
            addToast('解牌失败：' + (e?.message || e), 'error');
        } finally { setBusy(false); }
    };

    const exportToChat = async () => {
        if (!char) { addToast('先选一个角色才能发到 TA 的聊天', 'info'); return; }
        const lines = convo.map(m => m.role === 'char' ? `— ${char.name}：${m.text}` : `— ${userName}：${m.text}`);
        const local = insightToText(currentInsight());
        const body = `【占卜${question ? `·${question}` : ''}】\n${currentReadingText()}`
            + (local ? `\n\n${local}` : '')
            + (lines.length ? `\n\n${lines.join('\n\n')}` : '');
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
    const insight = hasResult ? currentInsight() : null;

    // 牌阵 / 起卦 切换胶囊
    const chip = (on: boolean): React.CSSProperties => on
        ? { background: '#1f1d1a', color: '#f6f3ec', border: 'none' }
        : { background: 'rgba(255,253,247,0.7)', color: '#5b554a', border: '1px solid rgba(176,170,158,0.65)' };

    return (
        <>
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

                <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
                    {QUESTION_PRESETS.map(p => (
                        <button key={p.label} onClick={() => fillQuestion(p.text)}
                            className="shrink-0 px-2.5 py-1.5 rounded-full text-[11px] font-bold active:scale-95 inline-flex items-center gap-1"
                            style={{ background: 'rgba(255,253,247,0.78)', color: '#5b554a', border: '1px solid rgba(176,170,158,0.55)' }}>
                            <MagicWand size={12} weight="bold" /> {p.label}
                        </button>
                    ))}
                </div>

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
                                <Stack size={15} weight="bold" /> 已内置整副韦特塔罗牌面，可直接抽牌；想用自己的牌图？点此批量导入
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
                                <Stack size={15} weight="bold" /> 雷诺曼无牌面图，已用每张对应的传统扑克牌代替，可直接抽牌；想用自己的牌图？点此批量导入
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
                            <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
                                <input value={n1} onChange={e => setN1(e.target.value)} inputMode="numeric" placeholder="第一个数" className="min-w-0 rounded-xl px-3 py-2 text-sm outline-none" style={paperInput} />
                                <input value={n2} onChange={e => setN2(e.target.value)} inputMode="numeric" placeholder="第二个数" className="min-w-0 rounded-xl px-3 py-2 text-sm outline-none" style={paperInput} />
                                <button onClick={randomMeihuaNumbers} className="px-3 rounded-xl text-[11px] font-bold inline-flex items-center gap-1 active:scale-95" style={{ background: '#1f1d1a', color: '#f6f3ec' }}>
                                    <Sparkle size={13} weight="fill" /> 随机
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {/* 起卦/抽牌按钮（塔罗/雷诺曼的抽牌走全屏 CardPicker，见下方 overlay） */}
                {!pickPhase && (
                    <ScrapButton variant="ink" className="w-full py-3 text-sm" onClick={startDivine} icon={mode === 'tarot' || mode === 'lenormand' ? <Cards size={17} weight="bold" /> : <Sparkle size={17} weight="fill" />}>
                        {hasResult ? '重新' : ''}{mode === 'tarot' || mode === 'lenormand' ? '抽牌' : '起卦'}（{activeMode.label}）
                    </ScrapButton>
                )}

                {/* 结果：拼贴里贴进一张「黑底相版」，保证牌面 / 卦象在深色上仍清晰 */}
                {hasResult && (
                    <div className="relative rounded-[16px] p-4 space-y-3" style={{
                        background: 'linear-gradient(180deg,#26231f,#1c1a17)', color: '#f3ecdf',
                        border: '1px solid rgba(31,29,26,0.8)', outline: '1px dashed rgba(246,243,236,0.22)', outlineOffset: -6,
                        boxShadow: '0 18px 34px -20px rgba(31,29,26,0.7)', transform: 'rotate(-0.4deg)',
                    }}>
                        {tarotDraws && <TarotSpreadView draws={tarotDraws} images={tarotImgs} skin={skin} cardBack={skin?.cardBack || DEFAULT_CARD_BACK} />}
                        {lenoDraws && <LenormandSpreadView draws={lenoDraws} images={lenoImgs} skin={skin} cardBack={skin?.cardBack || DEFAULT_CARD_BACK} />}
                        {liuyao && <LiuyaoView r={liuyao} />}
                        {meihua && <MeihuaView r={meihua} />}
                        {insight && <InsightPanel insight={insight} onPickPrompt={(text) => { if (convo.length) setAskInput(text); else setQuestion(text); }} />}

                        <div className="border-t pt-3 space-y-2.5" style={{ borderColor: 'rgba(246,243,236,0.14)' }}>
                            {convo.length === 0 ? (
                                // 还没解牌：让角色先给一段完整解读
                                <button onClick={() => void ask()} disabled={busy} className="w-full py-2.5 rounded-xl text-[12.5px] font-bold active:scale-95 disabled:opacity-50 inline-flex items-center justify-center gap-1.5" style={{ background: '#f3ecdf', color: '#1f1d1a' }}>
                                    <Cards size={15} weight="bold" /> {busy ? `${char?.name || 'TA'} 解牌中…` : `让 ${char?.name || 'TA'} 解牌`}
                                </button>
                            ) : (
                                <>
                                    {/* 解牌 + 继续追问：像和角色聊天一样，TA 顺着这副牌继续回应 */}
                                    <div className="space-y-2">
                                        {convo.map((m, i) => m.role === 'char' ? (
                                            <div key={i} className="rounded-xl p-3 text-[13px] leading-relaxed whitespace-pre-wrap" style={{ background: 'rgba(246,243,236,0.08)', border: '1px solid rgba(246,243,236,0.16)', color: 'rgba(246,243,236,0.92)' }}>
                                                <div className="text-[9px] mb-1 tracking-wide" style={{ fontFamily: 'var(--font-label)', color: 'rgba(246,243,236,0.45)' }}>{char?.name || 'TA'}</div>
                                                {m.text}
                                            </div>
                                        ) : (
                                            <div key={i} className="flex justify-end">
                                                <div className="rounded-xl px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap max-w-[84%]" style={{ background: '#f3ecdf', color: '#26231f' }}>{m.text}</div>
                                            </div>
                                        ))}
                                        {busy && <div className="text-[11px] pl-1" style={{ color: 'rgba(246,243,236,0.5)' }}>{char?.name || 'TA'} 正在回应…</div>}
                                    </div>

                                    {/* 继续追问输入框：回车 / 点发送，角色继续回答牌上的问题 */}
                                    <div className="flex gap-2 items-end">
                                        <textarea
                                            value={askInput}
                                            onChange={e => setAskInput(e.target.value)}
                                            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (askInput.trim() && !busy) void ask(askInput); } }}
                                            rows={1}
                                            placeholder={`继续问 ${char?.name || 'TA'}…（这张牌是什么意思 / 那我该怎么办）`}
                                            className="flex-1 rounded-xl px-3 py-2 text-[13px] outline-none resize-none"
                                            style={{ background: 'rgba(0,0,0,0.25)', color: '#f3ecdf', border: '1px solid rgba(246,243,236,0.16)', maxHeight: 96 }}
                                        />
                                        <button onClick={() => askInput.trim() && void ask(askInput)} disabled={busy || !askInput.trim()} className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center active:scale-95 disabled:opacity-40" style={{ background: '#f3ecdf', color: '#1f1d1a' }} title="继续问">
                                            <PaperPlaneTilt size={17} weight="fill" />
                                        </button>
                                    </div>
                                </>
                            )}

                            {/* 重抽 + 发到聊天 */}
                            <div className="flex gap-2">
                                <button onClick={() => startDivine()} className="px-3 py-2.5 rounded-xl text-[12px] font-bold active:scale-95 inline-flex items-center justify-center gap-1.5" style={{ background: 'rgba(246,243,236,0.12)', color: '#f3ecdf' }} title="重抽/重起">
                                    <ArrowClockwise size={15} weight="bold" /> 重抽
                                </button>
                                <button onClick={() => void exportToChat()} className="flex-1 py-2.5 rounded-xl text-[12px] font-bold active:scale-95 inline-flex items-center justify-center gap-1.5" style={{ background: 'rgba(246,243,236,0.12)', color: '#f3ecdf' }}>
                                    <PaperPlaneTilt size={15} weight="bold" /> 发到与 {char?.name || 'TA'} 的聊天
                                </button>
                            </div>
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

        {/* 塔罗 / 雷诺曼·全屏抽牌：洗牌花 → 牌轮抽牌两段式（CardPicker 全屏接管，盖住整个占卜页） */}
        {pickPhase && (
            <CardPicker
                modeLabel={activeMode.label}
                positions={mode === 'tarot' ? tarotSpread.positions : lenoSpread.positions}
                deckCount={mode === 'tarot' ? tarotPickDeck.length : lenoPickDeck.length}
                cardBack={skin?.cardBack || DEFAULT_CARD_BACK}
                onReshuffle={() => { mode === 'tarot' ? setTarotPickDeck(shuffledTarotDeck()) : setLenoPickDeck(shuffledLenormandDeck()); }}
                onReveal={handleReveal}
                onCancel={() => setPickPhase(false)}
            />
        )}
        </>
    );
};

export default DivinationApp;
