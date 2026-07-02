/**
 * 街角 · 约会世界引擎 —— UI
 * char 带着 user 在场景里溜达。副 API 当世界引擎；话/动作分输入；多世界线分支；
 * 氛围 BGM（MiniMax）；角色台词语音（TTS）；每 20 回合自动总结 + 隐藏上文。
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useOS } from '../../context/OSContext';
import { DateScene, DateWorldline, DateMessage } from '../../types';
import { resolveAuxApi, isAuxApiOn } from '../../utils/auxApi';
import {
    BUILTIN_DATE_SCENES, makeCustomScene, runDateTurn, runDateRecap,
    buildDateBgmPrompt, DATE_RECAP_EVERY, DATE_KEEP_TAIL,
} from '../../utils/dateEngine';
import {
    listWorldlines, saveWorldline, createWorldline, forkWorldline,
    deleteWorldline, newDateMessageId,
} from '../../utils/dateStore';
import { synthesizeSongMinimax, loadMinimaxMusicBlob } from '../../utils/minimaxMusic';
import { synthesizeSpeech } from '../../utils/minimaxTts';
import { buildCoupleDateMemoryCard, ensureCoupleSpace } from '../../utils/coupleSpace';

// 暮色暖调
const C = {
    bg: '#1c1822', ink: '#f3ecf5',
    accent: '#e8a0b8', accent2: '#a78bdc', line: 'rgba(255,255,255,0.12)', card: 'rgba(255,255,255,0.05)',
};

const Pill: React.FC<{ children: React.ReactNode; onClick?: () => void; active?: boolean; disabled?: boolean; title?: string }> = ({ children, onClick, active, disabled, title }) => (
    <button onClick={onClick} disabled={disabled} title={title}
        style={{
            fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 999, cursor: disabled ? 'default' : 'pointer',
            border: `1px solid ${active ? C.accent : C.line}`, color: active ? '#1c1822' : C.ink,
            background: active ? C.accent : 'transparent', opacity: disabled ? 0.5 : 1, whiteSpace: 'nowrap',
        }}>{children}</button>
);

const DateView: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const { characters, activeCharacterId, userProfile, apiConfig, auxApiConfig, addToast, updateCharacter } = useOS();
    const char = useMemo(() => characters.find(c => c.id === activeCharacterId), [characters, activeCharacterId]);

    const [screen, setScreen] = useState<'list' | 'scene' | 'session'>('list');
    const [worldlines, setWorldlines] = useState<DateWorldline[]>([]);
    const [active, setActive] = useState<DateWorldline | null>(null);
    const [speech, setSpeech] = useState('');
    const [action, setAction] = useState('');
    const [sending, setSending] = useState(false);
    const [busyNote, setBusyNote] = useState('');

    // 自定义场景
    const [cName, setCName] = useState('');
    const [cVibe, setCVibe] = useState('');
    const [cEmoji, setCEmoji] = useState('✨');

    // 语音 / BGM
    const [voiceOn, setVoiceOn] = useState(false);
    const [bgmOn, setBgmOn] = useState(false);
    const [bgmBusy, setBgmBusy] = useState(false);
    const [listening, setListening] = useState(false);
    const bgmAudioRef = useRef<HTMLAudioElement | null>(null);
    const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
    const streamRef = useRef<HTMLDivElement | null>(null);
    const recognitionRef = useRef<any>(null);
    const micBaseRef = useRef('');
    // 浏览器语音识别（STT）：用户用嘴说「话」，转写进说点什么输入框
    const sttSupported = typeof window !== 'undefined' && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

    const stopMic = () => {
        try { recognitionRef.current?.stop(); } catch { /* ignore */ }
        recognitionRef.current = null;
        setListening(false);
    };
    const toggleMic = () => {
        if (listening) { stopMic(); return; }
        const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SR) { addToast('这台设备的浏览器不支持语音输入', 'info'); return; }
        try {
            const rec = new SR();
            rec.lang = 'zh-CN'; rec.continuous = true; rec.interimResults = true;
            micBaseRef.current = speech ? speech.trimEnd() + ' ' : '';
            rec.onresult = (event: any) => {
                let finalText = '', interim = '';
                for (let i = 0; i < event.results.length; i++) {
                    const r = event.results[i];
                    if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript;
                }
                setSpeech(micBaseRef.current + finalText + interim);
            };
            rec.onerror = () => { stopMic(); };
            rec.onend = () => { setListening(false); recognitionRef.current = null; };
            rec.start();
            recognitionRef.current = rec;
            setListening(true);
        } catch { addToast('麦克风启动失败', 'error'); }
    };

    const auxOn = isAuxApiOn(auxApiConfig);
    const api = resolveAuxApi(auxApiConfig, apiConfig);

    const reload = () => { if (char) setWorldlines(listWorldlines(char.id)); };
    useEffect(() => { if (char) { const ls = listWorldlines(char.id); setWorldlines(ls); setScreen(ls.length ? 'list' : 'scene'); } }, [char?.id]);

    // 卸载时停掉 BGM / TTS / 麦克风
    useEffect(() => () => { bgmAudioRef.current?.pause(); ttsAudioRef.current?.pause(); try { recognitionRef.current?.stop(); } catch { /* ignore */ } }, []);

    useEffect(() => {
        if (streamRef.current) streamRef.current.scrollTop = streamRef.current.scrollHeight;
    }, [active?.messages.length, busyNote]);

    if (!char) {
        return (
            <Overlay onClose={onClose}>
                <div style={{ color: C.ink, textAlign: 'center', paddingTop: 80 }}>先在「剪影集」里选一位角色，再来约会。</div>
            </Overlay>
        );
    }

    // ── 开一条新世界线 ──
    const startScene = (scene: DateScene) => {
        const wl = createWorldline(char.id, scene);
        setActive(wl); reload(); setScreen('session');
    };
    const startCustom = () => {
        if (!cVibe.trim() && !cName.trim()) { addToast('给场景起个名/写点氛围吧', 'info'); return; }
        startScene(makeCustomScene(cName, cVibe, cEmoji));
        setCName(''); setCVibe(''); setCEmoji('✨');
    };

    const persist = (wl: DateWorldline) => { saveWorldline(wl); setActive({ ...wl }); reload(); };

    // ── 发一回合 ──
    const send = async () => {
        if (!active || sending) return;
        if (listening) stopMic();
        const sp = speech.trim(), ac = action.trim();
        if (!sp && !ac) { addToast('说句话，或者做个动作～', 'info'); return; }
        if (!api.baseUrl || !api.model) { addToast('请先在「文具盒」配置 API（主线或副线）', 'error'); return; }

        const scene: DateScene = {
            id: active.sceneId, name: active.sceneName, emoji: active.sceneEmoji,
            vibe: active.vibe, opening: '', builtin: active.sceneId.startsWith('sc_') && !active.sceneId.includes('custom'),
        };
        const userMsg: DateMessage = { id: newDateMessageId(), role: 'user', speech: sp || undefined, action: ac || undefined, ts: Date.now() };
        let wl: DateWorldline = { ...active, messages: [...active.messages, userMsg] };
        persist(wl);
        setSpeech(''); setAction('');
        setSending(true); setBusyNote(`${char.name} 在回应…`);
        try {
            const res = await runDateTurn(api, char, userProfile, scene, wl, sp, ac);
            if (!res) { addToast('世界引擎走神了，再试一次', 'error'); setSending(false); setBusyNote(''); return; }
            const charMsg: DateMessage = { id: newDateMessageId(), role: 'char', speech: res.charSpeech || undefined, action: res.charAction || undefined, ts: Date.now() };
            const msgs = [...wl.messages, charMsg];
            if (res.world) msgs.push({ id: newDateMessageId(), role: 'world', action: res.world, ts: Date.now() });
            wl = {
                ...wl, messages: msgs, turnCount: wl.turnCount + 1,
                vibe: res.vibe || wl.vibe,
                title: wl.turnCount === 0 && res.title ? res.title : wl.title,
            };
            persist(wl);

            // 语音：把角色这句话读出来
            if (voiceOn && res.charSpeech) void speakChar(res.charSpeech);

            // 每 20 回合：总结 + 隐藏上文
            if (wl.turnCount > 0 && wl.turnCount % DATE_RECAP_EVERY === 0) {
                setBusyNote('在把这段路收进回忆…');
                const recap = await runDateRecap(api, char, userProfile, scene, wl);
                if (recap) {
                    const tail = wl.messages.slice(-DATE_KEEP_TAIL);
                    wl = { ...wl, recap, recapTurnMark: wl.turnCount, messages: tail };
                    persist(wl);
                    addToast('已把前面的路浓缩进前情提要', 'success');
                }
            }
        } catch (e: any) {
            console.warn('[DateView] send failed:', e?.message || e);
            addToast('出了点状况，再试试', 'error');
        } finally {
            setSending(false); setBusyNote('');
        }
    };

    const speakChar = async (text: string) => {
        try {
            const url = await synthesizeSpeech(text, char, apiConfig);
            if (!ttsAudioRef.current) ttsAudioRef.current = new Audio();
            ttsAudioRef.current.src = url; void ttsAudioRef.current.play();
        } catch (e: any) {
            console.warn('[DateView] tts failed:', e?.message || e);
            addToast('读不出声——去角色「声音」里配一下 MiniMax 音色', 'info');
            setVoiceOn(false);
        }
    };

    // ── BGM ──
    const toggleBgm = async () => {
        if (!active) return;
        if (bgmOn) { bgmAudioRef.current?.pause(); setBgmOn(false); return; }
        setBgmBusy(true);
        try {
            // 已生成过 + 氛围没大变 → 直接放缓存
            let url: string | null = null;
            if (active.bgmAssetKey && active.bgmVibe === active.vibe) {
                const cached = await loadMinimaxMusicBlob(active.bgmAssetKey);
                if (cached) url = URL.createObjectURL(cached.blob);
            }
            if (!url) {
                const prompt = buildDateBgmPrompt({ id: active.sceneId, name: active.sceneName, emoji: active.sceneEmoji, vibe: active.vibe, opening: '' }, active.vibe);
                const r = await synthesizeSongMinimax(
                    { model: 'music-2.6', prompt, lyrics: '', isInstrumental: true, lyricsOptimizer: false },
                    apiConfig,
                );
                url = r.url;
                persist({ ...active, bgmAssetKey: r.assetKey, bgmVibe: active.vibe });
            }
            if (!bgmAudioRef.current) bgmAudioRef.current = new Audio();
            bgmAudioRef.current.loop = true; bgmAudioRef.current.volume = 0.5;
            bgmAudioRef.current.src = url; void bgmAudioRef.current.play();
            setBgmOn(true);
        } catch (e: any) {
            console.warn('[DateView] bgm failed:', e?.message || e);
            addToast(e?.message?.includes('MiniMax') ? e.message : '生成 BGM 失败（需要 MiniMax Key）', 'error');
        } finally {
            setBgmBusy(false);
        }
    };

    const doFork = (atIndex: number) => {
        if (!active) return;
        const wl = forkWorldline(active, atIndex);
        setActive(wl); reload();
        addToast('从这一刻分出了一条新世界线', 'success');
    };

    const saveToCoupleSpace = async () => {
        if (!active || !char) return;
        const latest = characters.find(c => c.id === char.id) || char;
        if (!latest.coupleSpace) { addToast('先在「絮语 · 情侣空间」给 TA 开一个空间吧', 'info'); return; }
        const recent = active.messages.slice(-8).map(m => {
            if (m.role === 'user') return `${userProfile.name || '我'}：${[m.speech, m.action].filter(Boolean).join(' / ')}`;
            if (m.role === 'char') return `${latest.name}：${[m.speech, m.action].filter(Boolean).join(' / ')}`;
            return `场景：${m.action || m.speech || ''}`;
        }).filter(Boolean).join('；');
        const card = buildCoupleDateMemoryCard({
            title: active.title,
            sceneName: active.sceneName,
            summary: active.recap || recent || `${active.sceneName}里的一次约会。`,
            sourceId: active.id,
            sourceAt: active.updatedAt || Date.now(),
        });
        const cs = ensureCoupleSpace(latest);
        await updateCharacter(latest.id, { coupleSpace: { ...cs, memoryCards: [card, ...(cs.memoryCards || [])], updatedAt: Date.now() } });
        addToast('已收进情侣空间的记忆卡', 'success');
    };

    // ───────────────────────── 渲染 ─────────────────────────
    if (screen === 'scene') {
        return (
            <Overlay onClose={onClose} title={`和 ${char.name} 去哪儿`} onBack={worldlines.length ? () => setScreen('list') : undefined}>
                <div style={{ padding: 16, overflowY: 'auto', flex: 1 }}>
                    <div style={{ color: C.accent, fontSize: 12, marginBottom: 12 }}>挑个地方，开始一条新世界线</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        {BUILTIN_DATE_SCENES.map(s => (
                            <button key={s.id} onClick={() => startScene(s)}
                                style={{ textAlign: 'left', padding: 14, borderRadius: 14, border: `1px solid ${C.line}`, background: C.card, color: C.ink, cursor: 'pointer' }}>
                                <div style={{ fontSize: 24 }}>{s.emoji}</div>
                                <div style={{ fontSize: 14, fontWeight: 700, marginTop: 4 }}>{s.name}</div>
                                <div style={{ fontSize: 11, color: C.accent2, marginTop: 4, lineHeight: 1.5 }}>{s.vibe}</div>
                            </button>
                        ))}
                    </div>

                    <div style={{ marginTop: 18, padding: 14, borderRadius: 14, border: `1px dashed ${C.line}`, background: C.card }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, marginBottom: 8 }}>＋ 自定义一个场景</div>
                        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                            <input value={cEmoji} onChange={e => setCEmoji(e.target.value.slice(0, 2))} placeholder="🎡" style={inputStyle(48, true)} />
                            <input value={cName} onChange={e => setCName(e.target.value)} placeholder="场景名（如 摩天轮顶）" style={inputStyle()} />
                        </div>
                        <textarea value={cVibe} onChange={e => setCVibe(e.target.value)} placeholder="写两句氛围/基调，世界引擎照着搭台（如：缓缓升空、脚下灯海、有点高有点心跳）" style={{ ...inputStyle(), height: 64, resize: 'none' as const }} />
                        <button onClick={startCustom} style={primaryBtn}>就去这儿</button>
                    </div>
                </div>
            </Overlay>
        );
    }

    if (screen === 'list') {
        return (
            <Overlay onClose={onClose} title={`和 ${char.name} 的约会`}>
                <div style={{ padding: 16, overflowY: 'auto', flex: 1 }}>
                    {!auxOn && (
                        <div style={{ fontSize: 11, color: C.accent2, background: C.card, border: `1px solid ${C.line}`, borderRadius: 10, padding: '8px 12px', marginBottom: 12, lineHeight: 1.6 }}>
                            提示：约会的「世界引擎」建议用副 API。去「文具盒 → 副线盒」开启后，这边会自动走副线（现在先用主线也能玩）。
                        </div>
                    )}
                    <button onClick={() => setScreen('scene')} style={{ ...primaryBtn, marginBottom: 14 }}>＋ 开一条新世界线</button>

                    {worldlines.length === 0 ? (
                        <div style={{ color: C.accent2, textAlign: 'center', padding: 40, fontSize: 13 }}>还没有约会过。挑个场景，带 TA 出门吧。</div>
                    ) : (() => {
                        const forest = buildForest(worldlines);
                        const hasForks = worldlines.some(w => w.parentId && worldlines.some(p => p.id === w.parentId));
                        return (
                            <>
                                {hasForks && <div style={{ fontSize: 10.5, color: C.accent2, marginBottom: 10 }}>🌳 分叉树：缩进的是从某条世界线分出来的剧情走向</div>}
                                {forest.map(n => (
                                    <WorldlineNode key={n.wl.id} node={n} depth={0}
                                        onResume={(wl) => { setActive(wl); setScreen('session'); }}
                                        onDelete={(wl) => { if (confirm('删除这条世界线？它的分叉会变成独立世界线。')) { deleteWorldline(char.id, wl.id); reload(); } }} />
                                ))}
                            </>
                        );
                    })()}
                </div>
            </Overlay>
        );
    }

    // ── session ──（切到 session 前必先 setActive；兜底直接不渲染，避免 render 内 setState）
    if (!active) return null;
    const recapDue = DATE_RECAP_EVERY - (active.turnCount % DATE_RECAP_EVERY);

    return (
        <Overlay onClose={onClose}
            title={`${active.sceneEmoji} ${active.title}`}
            onBack={() => { bgmAudioRef.current?.pause(); setBgmOn(false); setScreen('list'); }}
            right={
                <div style={{ display: 'flex', gap: 6 }}>
                    <Pill onClick={saveToCoupleSpace} title="收进情侣空间">收进空间</Pill>
                    <Pill onClick={toggleBgm} active={bgmOn} disabled={bgmBusy} title="氛围 BGM（MiniMax 生成）">{bgmBusy ? '谱曲…' : (bgmOn ? '♪ 暂停' : '♪ BGM')}</Pill>
                    <Pill onClick={() => setVoiceOn(v => !v)} active={voiceOn} title="角色台词语音">{voiceOn ? '🔊 有声' : '🔈 静音'}</Pill>
                </div>
            }>
            <div style={{ fontSize: 10.5, color: C.accent2, padding: '4px 16px', borderBottom: `1px solid ${C.line}` }}>
                {active.vibe ? `氛围：${active.vibe} · ` : ''}{active.turnCount} 回合 · 再 {recapDue} 回合自动收一次前情
            </div>

            {/* 消息流 */}
            <div ref={streamRef} style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
                {active.recap && (
                    <div style={{ fontSize: 11, color: C.accent2, background: C.card, border: `1px dashed ${C.line}`, borderRadius: 12, padding: '10px 12px', marginBottom: 14, lineHeight: 1.7 }}>
                        <b style={{ color: C.accent }}>前情提要</b>　{active.recap}
                    </div>
                )}
                {active.messages.map((m, i) => <MessageRow key={m.id} m={m} char={char} userName={userProfile.name} onFork={() => doFork(i)} />)}
                {busyNote && <div style={{ color: C.accent2, fontSize: 12, fontStyle: 'italic', padding: '6px 2px' }}>{busyNote}</div>}
            </div>

            {/* 话 / 动作 分输入 */}
            <div style={{ borderTop: `1px solid ${C.line}`, padding: 12, background: 'rgba(0,0,0,0.2)' }}>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 16, alignSelf: 'center' }}>💬</span>
                    <input value={speech} onChange={e => setSpeech(e.target.value)} placeholder={listening ? '在听你说…' : '说点什么…'}
                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
                        style={inputStyle()} disabled={sending} />
                    {sttSupported && (
                        <button onClick={toggleMic} disabled={sending} title="用嘴说（语音输入）"
                            style={{
                                width: 40, flexShrink: 0, borderRadius: 10, cursor: 'pointer', fontSize: 16,
                                border: `1px solid ${listening ? C.accent : C.line}`,
                                background: listening ? C.accent : 'rgba(255,255,255,0.06)',
                                color: listening ? '#1c1822' : C.ink,
                            }}>{listening ? '⏺' : '🎤'}</button>
                    )}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                    <span style={{ fontSize: 16, alignSelf: 'center' }}>🤍</span>
                    <input value={action} onChange={e => setAction(e.target.value)} placeholder="做个动作（牵起 TA 的手 / 偷偷看 TA…）"
                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
                        style={inputStyle()} disabled={sending} />
                    <button onClick={send} disabled={sending} style={{ ...primaryBtn, width: 76, marginTop: 0, opacity: sending ? 0.5 : 1 }}>{sending ? '…' : '发送'}</button>
                </div>
                <div style={{ fontSize: 10, color: C.accent2, marginTop: 6 }}>话和动作可以只填一个 · TA 会一一回应</div>
            </div>
        </Overlay>
    );
};

// ── 子组件 ──
const MessageRow: React.FC<{ m: DateMessage; char: any; userName: string; onFork: () => void }> = ({ m, char, userName, onFork }) => {
    if (m.role === 'world') {
        return <div style={{ textAlign: 'center', color: '#9b8fae', fontSize: 12, fontStyle: 'italic', margin: '12px 0', lineHeight: 1.6 }}>— {m.action} —</div>;
    }
    const mine = m.role === 'user';
    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: mine ? 'flex-end' : 'flex-start', marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: '#9b8fae', marginBottom: 3 }}>{mine ? userName : char.name}</div>
            {m.speech && (
                <div style={{
                    maxWidth: '82%', padding: '9px 13px', borderRadius: 14, fontSize: 13.5, lineHeight: 1.6,
                    background: mine ? 'rgba(232,160,184,0.22)' : 'rgba(255,255,255,0.08)', color: '#f3ecf5',
                    borderTopRightRadius: mine ? 4 : 14, borderTopLeftRadius: mine ? 14 : 4,
                }}>{m.speech}</div>
            )}
            {m.action && (
                <div style={{ maxWidth: '82%', fontSize: 12, color: '#c5b6d2', fontStyle: 'italic', marginTop: m.speech ? 4 : 0, padding: '0 4px' }}>（{m.action}）</div>
            )}
            {!mine && (
                <button onClick={onFork} title="从这一刻另开一条世界线"
                    style={{ fontSize: 10, color: '#8a7ea0', background: 'none', border: 'none', cursor: 'pointer', marginTop: 3, padding: '2px 4px' }}>⑂ 从这儿分叉</button>
            )}
        </div>
    );
};

// ── 世界线分叉树 ──
interface ForestNode { wl: DateWorldline; children: ForestNode[] }
function buildForest(list: DateWorldline[]): ForestNode[] {
    const byId = new Map(list.map(w => [w.id, w]));
    const nodes = new Map<string, ForestNode>(list.map(w => [w.id, { wl: w, children: [] }]));
    const roots: ForestNode[] = [];
    for (const w of list) {
        const node = nodes.get(w.id)!;
        if (w.parentId && byId.has(w.parentId)) nodes.get(w.parentId)!.children.push(node);
        else roots.push(node);
    }
    const sortKids = (arr: ForestNode[]) => { arr.sort((a, b) => a.wl.createdAt - b.wl.createdAt); arr.forEach(n => sortKids(n.children)); };
    roots.forEach(r => sortKids(r.children));
    roots.sort((a, b) => b.wl.updatedAt - a.wl.updatedAt);
    return roots;
}

const WorldlineNode: React.FC<{ node: ForestNode; depth: number; onResume: (wl: DateWorldline) => void; onDelete: (wl: DateWorldline) => void }> = ({ node, depth, onResume, onDelete }) => {
    const wl = node.wl;
    return (
        <div style={{ marginLeft: depth ? 12 : 0, borderLeft: depth ? `1px solid ${C.line}` : undefined, paddingLeft: depth ? 12 : 0, position: 'relative' }}>
            {depth > 0 && <span style={{ position: 'absolute', left: -1, top: 16, width: 10, height: 1, background: C.line }} />}
            <div style={{ border: `1px solid ${C.line}`, background: C.card, borderRadius: 14, padding: 14, marginBottom: 10 }}>
                <div onClick={() => onResume(wl)} style={{ cursor: 'pointer' }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: C.ink }}>{wl.sceneEmoji} {wl.title}</div>
                    <div style={{ fontSize: 11, color: C.accent2, marginTop: 4 }}>
                        {wl.sceneName} · {wl.turnCount} 回合{wl.parentId ? `${wl.forkedAtTurn != null ? ` · 从第 ${wl.forkedAtTurn} 回合分出` : ' · 分叉'}` : ''} · {new Date(wl.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </div>
                    {wl.vibe && <div style={{ fontSize: 11, color: C.accent, marginTop: 4 }}>♪ 此刻氛围：{wl.vibe}</div>}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <Pill onClick={() => onResume(wl)} active>继续</Pill>
                    <Pill onClick={() => onDelete(wl)}>删除</Pill>
                </div>
            </div>
            {node.children.map(c => <WorldlineNode key={c.wl.id} node={c} depth={depth + 1} onResume={onResume} onDelete={onDelete} />)}
        </div>
    );
};

const Overlay: React.FC<{ children: React.ReactNode; onClose: () => void; title?: string; onBack?: () => void; right?: React.ReactNode }> = ({ children, onClose, title, onBack, right }) => (
    <div style={{ position: 'absolute', inset: 0, zIndex: 60, background: '#1c1822', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,0.12)' }}>
            <button onClick={onBack || onClose} style={{ background: 'none', border: 'none', color: '#f3ecf5', fontSize: 18, cursor: 'pointer' }}>‹</button>
            <div style={{ flex: 1, color: '#f3ecf5', fontSize: 15, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title || '约会'}</div>
            {right}
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#9b8fae', fontSize: 16, cursor: 'pointer' }}>✕</button>
        </div>
        {children}
    </div>
);

const inputStyle = (w?: number, center?: boolean): React.CSSProperties => ({
    flex: w ? undefined : 1, width: w, textAlign: center ? 'center' : 'left',
    padding: '9px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.14)',
    background: 'rgba(255,255,255,0.06)', color: '#f3ecf5', fontSize: 13, outline: 'none', boxSizing: 'border-box',
});

const primaryBtn: React.CSSProperties = {
    width: '100%', marginTop: 10, padding: '10px 0', borderRadius: 10, border: 'none', cursor: 'pointer',
    background: 'linear-gradient(135deg, #e8a0b8, #a78bdc)', color: '#1c1822', fontSize: 13, fontWeight: 700,
};

export default DateView;
