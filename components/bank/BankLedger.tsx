import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { BankTransaction, CharLedgerEntry, CharacterProfile, APIConfig, UserProfile, LedgerComment } from '../../types';
import { DB } from '../../utils/db';
import { ContextBuilder } from '../../utils/context';
import { extractContent } from '../../utils/safeApi';
import { injectMemoryPalace } from '../../utils/memoryPalace/pipeline';
import { makeApiUsageMeta } from '../../utils/apiUsageCatalog';
import { callChatCompletion } from '../../utils/llmClient';
import { HAND_FONT, tinyRotate } from '../../apps/almanac/handbookKit';

/**
 * 人生拟 · 互评账本
 * ------------------------------------------------------------
 * 「记账」记录的是用户**现实**的金钱（进账/支出），与店铺经营的钱（钱包）完全独立。
 *  - 我的流水：用户每笔现实账目，角色可按人设点评（AI）
 *  - 角色的账本：角色按人设给自己记账（AI 生成进账/支出），用户可留言，角色会回复（AI）
 */

interface Props {
    transactions: BankTransaction[];
    onTxUpdated: (tx: BankTransaction) => void;
    characters: CharacterProfile[];
    apiConfig: APIConfig;
    userProfile: UserProfile;
    addToast: (m: string, t?: 'success' | 'error' | 'info') => void;
    currency: string;
}

const todayStr = () => new Date().toISOString().split('T')[0];

const avatarNode = (c?: CharacterProfile, size = 28) => {
    const cls = 'rounded-full object-cover shrink-0';
    const a = c?.avatar;
    // 头像可能是 http/data/blob 链接，也可能是本地资源路径（如 Moro 的 /moro-avatars/calm.jpg）。
    // 只判 http/data 会把本地路径当成 emoji 文本渲染 → 头像失效，这里补上 / 与 blob: 前缀。
    const isImg = !!a && (/^https?:\/\//i.test(a) || a.startsWith('data:') || a.startsWith('blob:') || a.startsWith('/'));
    if (isImg) {
        return <img src={a} className={cls} style={{ width: size, height: size }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />;
    }
    return <span className="rounded-full flex items-center justify-center shrink-0" style={{ width: size, height: size, background: '#F0E2CC', fontSize: size * 0.5 }}>{a || '🙂'}</span>;
};

async function llmOnce(apiConfig: APIConfig, system: string, user: string, temp = 0.85): Promise<string> {
    const api = apiConfig as APIConfig & { apiRole?: string; apiBinding?: string };
    const data = await callChatCompletion(api, {
        model: api.model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        temperature: temp,
        max_tokens: 8000,
        stream: false,
    }, {
        meta: makeApiUsageMeta('bank.lifeAi', { apiRole: api.apiRole || 'aux', apiBinding: api.apiBinding || '互评账本' }),
    });
    return (extractContent(data) || '').trim();
}

const stripQuotes = (s: string) => s.replace(/^["'「」\s]+|["'「」\s]+$/g, '');

const parseEntryJson = (raw: string): { type: 'income' | 'expense'; amount: number; note: string } | null => {
    if (!raw) return null;
    const s = raw.replace(/```json/gi, '').replace(/```/g, '');
    const start = s.indexOf('{'); const end = s.lastIndexOf('}');
    if (start === -1 || end === -1) return null;
    try {
        const o = JSON.parse(s.slice(start, end + 1));
        const amount = Math.abs(Math.round(Number(o.amount)));
        const type = o.type === 'income' ? 'income' : 'expense';
        const note = String(o.note || '').trim().slice(0, 24);
        if (!amount || !note) return null;
        return { type, amount, note };
    } catch { return null; }
};

const BankLedger: React.FC<Props> = ({ transactions, onTxUpdated, characters, apiConfig, userProfile, addToast, currency }) => {
    const [view, setView] = useState<'mine' | 'chars'>('mine');
    const [commenterId, setCommenterId] = useState<string>(characters[0]?.id || '');
    const [busyTxId, setBusyTxId] = useState<string | null>(null);

    const [charEntries, setCharEntries] = useState<CharLedgerEntry[]>([]);
    const [activeCharId, setActiveCharId] = useState<string>(characters[0]?.id || '');
    const [genBusy, setGenBusy] = useState(false);
    const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
    const [replyBusyId, setReplyBusyId] = useState<string | null>(null);

    useEffect(() => { DB.getAllCharLedgerEntries().then(setCharEntries).catch(() => {}); }, []);
    useEffect(() => { if (!commenterId && characters[0]) setCommenterId(characters[0].id); if (!activeCharId && characters[0]) setActiveCharId(characters[0].id); }, [characters]);

    const recentTx = useMemo(() => transactions.slice(0, 40), [transactions]);
    const activeCharEntries = useMemo(
        () => charEntries.filter(e => e.charId === activeCharId).sort((a, b) => b.ts - a.ts),
        [charEntries, activeCharId],
    );
    const charById = (id: string) => characters.find(c => c.id === id);

    // 角色点评用户的某笔现实账目
    const commentOnTx = useCallback(async (tx: BankTransaction) => {
        const char = charById(commenterId) || characters[0];
        if (!char) { addToast('还没有角色', 'info'); return; }
        if (!apiConfig.baseUrl || !apiConfig.model) { addToast('还没配置 API', 'info'); return; }
        setBusyTxId(tx.id);
        try {
            await injectMemoryPalace(char, undefined, tx.note);
            const base = ContextBuilder.buildCoreContext(char, userProfile);
            const kind = tx.type === 'income' ? '进账(收入)' : '支出(花钱)';
            const prompt = `### 场景：翻看 ${userProfile.name} 的现实记账
${userProfile.name} 刚记了一笔${kind}：「${tx.note}」，金额 ${currency}${tx.amount}。

### 任务
以你的人设，对这笔账说一句简短的点评/反应（关心、吐槽、调侃、心疼钱包都行）。
- 只输出一句话，不超过 24 个字，第一人称，不要引号。
- **必须使用用户常用语言**。`;
            const text = stripQuotes(await llmOnce(apiConfig, base, prompt, 0.9));
            if (!text) { addToast(`${char.name} 没说话`, 'info'); return; }
            const updated: BankTransaction = { ...tx, charComment: { charId: char.id, charName: char.name, text, ts: Date.now() } };
            await DB.saveTransaction(updated);
            onTxUpdated(updated);
        } catch (e: any) {
            addToast(`点评失败：${e?.message || '未知'}`, 'error');
        } finally {
            setBusyTxId(null);
        }
    }, [commenterId, characters, apiConfig, userProfile, currency, addToast, onTxUpdated]);

    // 角色给自己记一笔账
    const genCharEntry = useCallback(async (char: CharacterProfile) => {
        if (!apiConfig.baseUrl || !apiConfig.model) { addToast('还没配置 API', 'info'); return; }
        setGenBusy(true);
        try {
            await injectMemoryPalace(char, undefined, '记账');
            const base = ContextBuilder.buildCoreContext(char, userProfile);
            const prompt = `### 场景：你在自己的账本上记一笔账
请按你的人设、你的生活，给**你自己**记一笔今天的账（进账或支出都行，要符合你的身份与处境）。

**输出要求**（严格遵守）：
- 只输出一个 JSON 对象，不要任何多余文字或代码块标记。
- 形如 {"type":"expense","amount":68,"note":"买了画材"}。
- type 取 "income"(进账) 或 "expense"(支出)；amount 为正整数；note 不超过 12 字。
- **必须使用用户常用语言**。`;
            const parsed = parseEntryJson(await llmOnce(apiConfig, base, prompt, 0.95));
            if (!parsed) { addToast(`${char.name} 这次没记成`, 'info'); return; }
            const entry: CharLedgerEntry = {
                id: `cl-${char.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                charId: char.id, type: parsed.type, amount: parsed.amount, note: parsed.note,
                dateStr: todayStr(), ts: Date.now(), comments: [],
            };
            await DB.saveCharLedgerEntry(entry);
            setCharEntries(prev => [...prev, entry]);
            addToast(`${char.name} 记了一笔：${parsed.type === 'income' ? '+' : '-'}${currency}${parsed.amount}`, 'success');
        } catch (e: any) {
            addToast(`记账失败：${e?.message || '未知'}`, 'error');
        } finally {
            setGenBusy(false);
        }
    }, [apiConfig, userProfile, currency, addToast]);

    // 用户对角色账目留言 → 角色 AI 回复
    const sendComment = useCallback(async (entry: CharLedgerEntry) => {
        const draft = (commentDrafts[entry.id] || '').trim();
        if (!draft) return;
        const char = charById(entry.charId);
        const userComment: LedgerComment = { author: 'user', text: draft, ts: Date.now() };
        let updated: CharLedgerEntry = { ...entry, comments: [...(entry.comments || []), userComment] };
        await DB.saveCharLedgerEntry(updated);
        setCharEntries(prev => prev.map(e => e.id === entry.id ? updated : e));
        setCommentDrafts(prev => ({ ...prev, [entry.id]: '' }));

        if (!char || !apiConfig.baseUrl || !apiConfig.model) return;
        setReplyBusyId(entry.id);
        try {
            await injectMemoryPalace(char, undefined, entry.note);
            const base = ContextBuilder.buildCoreContext(char, userProfile);
            const kind = entry.type === 'income' ? '进账' : '支出';
            const thread = (updated.comments || []).map(c => `${c.author === 'user' ? userProfile.name : char.name}：${c.text}`).join('\n');
            const prompt = `### 场景：你账本上的一笔账下面，${userProfile.name} 给你留言了
你记的账：${kind} ${currency}${entry.amount} —「${entry.note}」
留言往来：
${thread}

### 任务
以你的人设，回复 ${userProfile.name} 最新这条留言，一句话即可。
- 只输出一句话，不超过 26 个字，第一人称，不要引号。
- **必须使用用户常用语言**。`;
            const text = stripQuotes(await llmOnce(apiConfig, base, prompt, 0.9));
            if (text) {
                const reply: LedgerComment = { author: 'character', text, ts: Date.now() };
                updated = { ...updated, comments: [...(updated.comments || []), reply] };
                await DB.saveCharLedgerEntry(updated);
                setCharEntries(prev => prev.map(e => e.id === entry.id ? updated : e));
            }
        } catch {
            // 回复失败不打扰
        } finally {
            setReplyBusyId(null);
        }
    }, [commentDrafts, characters, apiConfig, userProfile, currency]);

    const removeCharEntry = async (id: string) => {
        await DB.deleteCharLedgerEntry(id);
        setCharEntries(prev => prev.filter(e => e.id !== id));
    };

    return (
        <div className="flex-1 overflow-y-auto no-scrollbar px-4 pt-3 pb-8" style={{ color: '#5D4037' }}>
            {/* 子视图切换 —— 两枚纸签 */}
            <div className="flex gap-2.5 mb-4">
                {([['mine', '我的流水'], ['chars', '角色的账本']] as const).map(([k, label], i) => (
                    <button key={k} onClick={() => setView(k)} className="flex-1 py-2 text-[14px] font-black active:scale-95 transition-transform"
                        style={{ fontFamily: HAND_FONT, borderRadius: '8px 11px 7px 10px', transform: `rotate(${i === 0 ? -1 : 1}deg)`,
                            ...(view === k
                                ? { background: '#fffdf7', color: '#5b4636', boxShadow: '0 4px 12px rgba(96,66,40,0.18)' }
                                : { background: '#efe2cd', color: '#a98e6f' }) }}>
                        {label}
                    </button>
                ))}
            </div>

            {view === 'mine' && (
                <div>
                    {/* 点评人选择 */}
                    {characters.length > 0 && (
                        <div className="flex items-center gap-2 mb-3 px-1 overflow-x-auto no-scrollbar">
                            <span className="text-[11px] text-[#A1887F] shrink-0">点评人</span>
                            {characters.map(c => (
                                <button key={c.id} onClick={() => setCommenterId(c.id)} className="flex items-center gap-1 px-2 py-1 rounded-full shrink-0 active:scale-95 transition-all"
                                    style={{ background: commenterId === c.id ? '#6D4C41' : '#F3E9D6', color: commenterId === c.id ? '#fff' : '#8D6E63' }}>
                                    {avatarNode(c, 20)}
                                    <span className="text-[11px] font-bold whitespace-nowrap">{c.name}</span>
                                </button>
                            ))}
                        </div>
                    )}

                    {recentTx.length === 0 && (
                        <div className="text-center py-12 text-[13px] text-[#A1887F]">
                            还没有现实记账。点右上角「记账」记一笔，让角色来点评吧
                        </div>
                    )}

                    <div className="space-y-2.5">
                        {recentTx.map(tx => {
                            const income = tx.type === 'income';
                            const cc = tx.charComment;
                            const ccChar = cc ? charById(cc.charId) : undefined;
                            return (
                                <div key={tx.id} className="rounded-2xl p-3.5 border border-[#EADFC8]" style={{ background: '#FFFDF7', boxShadow: '0 3px 10px rgba(96,66,40,0.12)', transform: `rotate(${tinyRotate(tx.id)}deg)` }}>
                                    <div className="flex items-center gap-2">
                                        <span className="w-9 h-9 rounded-xl flex items-center justify-center text-base shrink-0" style={{ background: income ? '#E3F2E5' : '#FCE9E4' }}>{income ? '📥' : '📤'}</span>
                                        <div className="flex-1 min-w-0">
                                            <div className="text-[14px] font-bold truncate">{tx.note}</div>
                                            <div className="text-[10px] text-[#A1887F]">{tx.dateStr} · {income ? '进账' : '支出'}</div>
                                        </div>
                                        <div className="text-[16px] font-black shrink-0" style={{ color: income ? '#43A047' : '#E07A5F' }}>{income ? '+' : '-'}{currency}{tx.amount}</div>
                                    </div>
                                    {cc ? (
                                        <div className="mt-2.5 flex items-start gap-2 pl-1">
                                            {avatarNode(ccChar, 24)}
                                            <div className="flex-1 px-3 py-1.5 rounded-xl rounded-tl-sm text-[12px]" style={{ background: '#F3ECDD', color: '#6D5142' }}>
                                                <span className="font-bold text-[#8D6E63]">{cc.charName}</span>：{cc.text}
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="mt-2 flex justify-end">
                                            <button onClick={() => commentOnTx(tx)} disabled={busyTxId === tx.id || characters.length === 0}
                                                className="text-[11px] font-bold px-3 py-1.5 rounded-full active:scale-95 transition-all disabled:opacity-50"
                                                style={{ background: '#F3E9D6', color: '#8D6E63' }}>
                                                {busyTxId === tx.id ? '点评中…' : '💬 让 ta 点评'}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {view === 'chars' && (
                <div>
                    {characters.length === 0 ? (
                        <div className="text-center py-12 text-[13px] text-[#A1887F]">还没有角色</div>
                    ) : (
                        <>
                            {/* 角色选择 */}
                            <div className="flex items-center gap-2 mb-3 overflow-x-auto no-scrollbar">
                                {characters.map(c => (
                                    <button key={c.id} onClick={() => setActiveCharId(c.id)} className="flex flex-col items-center gap-1 shrink-0 active:scale-95 transition-all px-1">
                                        <span style={{ outline: activeCharId === c.id ? '2.5px solid #6D4C41' : '2.5px solid transparent', borderRadius: 999, opacity: activeCharId === c.id ? 1 : 0.55 }}>{avatarNode(c, 40)}</span>
                                        <span className="text-[10px] font-bold" style={{ color: activeCharId === c.id ? '#6D4C41' : '#A1887F' }}>{c.name}</span>
                                    </button>
                                ))}
                            </div>

                            <div className="flex items-center justify-between mb-3">
                                <span className="text-[15px] font-black" style={{ fontFamily: HAND_FONT, color: '#5b4636' }}>{charById(activeCharId)?.name} 的账本</span>
                                <button onClick={() => { const c = charById(activeCharId); if (c) genCharEntry(c); }} disabled={genBusy}
                                    className="text-[12px] font-bold px-3.5 py-1.5 rounded-full active:scale-95 transition-all disabled:opacity-50"
                                    style={{ background: 'linear-gradient(135deg,#8D6E63,#6D4C41)', color: '#fff' }}>
                                    {genBusy ? '记账中…' : '✍️ 让 ta 记一笔'}
                                </button>
                            </div>

                            {activeCharEntries.length === 0 && (
                                <div className="text-center py-10 text-[13px] text-[#A1887F]">ta 还没记过账，点上面让 ta 记一笔</div>
                            )}

                            <div className="space-y-3">
                                {activeCharEntries.map(entry => {
                                    const income = entry.type === 'income';
                                    const ch = charById(entry.charId);
                                    return (
                                        <div key={entry.id} className="rounded-2xl p-3.5 border border-[#EADFC8]" style={{ background: '#FFFDF7', boxShadow: '0 3px 10px rgba(96,66,40,0.12)', transform: `rotate(${tinyRotate(entry.id)}deg)` }}>
                                            <div className="flex items-center gap-2">
                                                <span className="w-9 h-9 rounded-xl flex items-center justify-center text-base shrink-0" style={{ background: income ? '#E3F2E5' : '#FCE9E4' }}>{income ? '📥' : '📤'}</span>
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-[14px] font-bold truncate">{entry.note}</div>
                                                    <div className="text-[10px] text-[#A1887F]">{entry.dateStr} · {income ? '进账' : '支出'}</div>
                                                </div>
                                                <div className="text-[16px] font-black shrink-0" style={{ color: income ? '#43A047' : '#E07A5F' }}>{income ? '+' : '-'}{currency}{entry.amount}</div>
                                                <button onClick={() => removeCharEntry(entry.id)} className="text-[#C9B79C] text-sm px-1 active:scale-90 shrink-0">✕</button>
                                            </div>

                                            {/* 评论区 */}
                                            {(entry.comments && entry.comments.length > 0) && (
                                                <div className="mt-2.5 space-y-1.5 pl-1">
                                                    {entry.comments.map((cm, i) => (
                                                        <div key={i} className={`flex items-start gap-2 ${cm.author === 'user' ? 'flex-row-reverse' : ''}`}>
                                                            {cm.author === 'user' ? avatarNode(undefined, 22) : avatarNode(ch, 22)}
                                                            <div className="max-w-[78%] px-3 py-1.5 rounded-xl text-[12px]"
                                                                style={cm.author === 'user'
                                                                    ? { background: '#6D4C41', color: '#fff', borderTopRightRadius: 2 }
                                                                    : { background: '#F3ECDD', color: '#6D5142', borderTopLeftRadius: 2 }}>
                                                                {cm.text}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                            {replyBusyId === entry.id && <div className="text-[11px] text-[#A1887F] mt-1.5 pl-1">{ch?.name} 正在回复…</div>}

                                            {/* 留言输入 */}
                                            <div className="mt-2.5 flex items-center gap-2">
                                                <input
                                                    value={commentDrafts[entry.id] || ''}
                                                    onChange={e => setCommentDrafts(prev => ({ ...prev, [entry.id]: e.target.value }))}
                                                    onKeyDown={e => { if (e.key === 'Enter') sendComment(entry); }}
                                                    placeholder={`对 ${ch?.name || 'ta'} 这笔账说点什么…`}
                                                    className="flex-1 px-3 py-2 rounded-full text-[12px] outline-none border border-[#EADFC8]"
                                                    style={{ background: '#FAF4E8', color: '#5D4037' }}
                                                />
                                                <button onClick={() => sendComment(entry)} disabled={!(commentDrafts[entry.id] || '').trim()}
                                                    className="text-[12px] font-bold px-3 py-2 rounded-full active:scale-95 transition-all disabled:opacity-40"
                                                    style={{ background: '#FF7043', color: '#fff' }}>评</button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
};

export default BankLedger;
