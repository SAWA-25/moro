import React, { useEffect, useState } from 'react';
import { useOS } from '../../context/OSContext';
import { PaperPage, PaperNote, TapeLabel, HAND_FONT } from './handbookKit';
import { CollectionItem } from '../../types';
import { DB } from '../../utils/db';
import {
    CollectibleCandidate,
    listCollectibles,
    candidateToItem,
    collectionId,
    forwardCollectionItem,
    SOURCE_LABEL,
} from '../../utils/collection';

/**
 * 岁时记·典藏馆：把「谈心 / 创作社 / 自习室 / 折子戏」里完成的内容收进来一处珍藏。
 * 已收藏的剧场内容与谈心可以转发给任意角色——也就是说，能给 char B 看 user & char A 的同人 / 谈心记录。
 */

interface Props { onExit: () => void; }

const CollectionHall: React.FC<Props> = ({ onExit }) => {
    const { characters, userProfile, addToast } = useOS();
    const nameOf = (id: string) => characters.find(c => c.id === id)?.name || '';
    const userName = (userProfile?.name || '').trim() || '我';

    const [tab, setTab] = useState<'collected' | 'all'>('collected');
    const [candidates, setCandidates] = useState<CollectibleCandidate[]>([]);
    const [collected, setCollected] = useState<CollectionItem[]>([]);
    const [collectedIds, setCollectedIds] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(true);
    const [forwardItem, setForwardItem] = useState<CollectionItem | null>(null);

    const reload = async () => {
        setLoading(true);
        try {
            const [cands, items] = await Promise.all([listCollectibles(nameOf), DB.getCollectionItems()]);
            setCandidates(cands);
            setCollected(items);
            setCollectedIds(new Set(items.map(i => i.id)));
        } finally { setLoading(false); }
    };
    useEffect(() => { void reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

    const toggleCollect = async (c: CollectibleCandidate) => {
        const id = collectionId(c.sourceType, c.sourceId);
        if (collectedIds.has(id)) await DB.deleteCollectionItem(id);
        else await DB.saveCollectionItem(candidateToItem(c));
        await reload();
    };

    const uncollect = async (item: CollectionItem) => { await DB.deleteCollectionItem(item.id); await reload(); };

    const doForward = async (targetId: string) => {
        if (!forwardItem) return;
        try {
            await forwardCollectionItem(forwardItem, targetId, userName, nameOf);
            addToast(`已把《${forwardItem.title}》转给 ${nameOf(targetId)} 啦`, 'success');
        } catch (e: any) {
            addToast(`转发失败：${e?.message || e}`, 'error');
        } finally { setForwardItem(null); }
    };

    const renderCard = (
        cover: string | undefined, title: string, subtitle: string | undefined, excerpt: string | undefined,
        actions: React.ReactNode, rotate: number,
    ) => (
        <PaperNote rotate={rotate} bg="#fffdf7" className="px-4 py-3.5">
            <div className="flex items-start gap-3">
                <span className="text-[26px] leading-none mt-0.5 shrink-0">{cover || '📎'}</span>
                <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-black leading-tight truncate" style={{ fontFamily: HAND_FONT, color: '#5b4636' }}>{title || '无题'}</div>
                    {subtitle && <div className="text-[10.5px] mt-0.5 truncate" style={{ color: '#a98e6f' }}>{subtitle}</div>}
                    {excerpt && <div className="text-[11.5px] mt-1.5 leading-snug line-clamp-2" style={{ color: '#7a624c' }}>{excerpt}</div>}
                    <div className="flex items-center gap-2 mt-2.5">{actions}</div>
                </div>
            </div>
        </PaperNote>
    );

    return (
        <PaperPage kind="sticky" className="animate-fade-in" style={{ paddingTop: 'var(--safe-top)' }}>
            <div className="h-full flex flex-col" style={{ color: '#4a3b2e' }}>
                {/* 顶栏 */}
                <div className="flex items-center justify-between px-4 pt-3 pb-1 shrink-0 z-10">
                    <button onClick={onExit} className="inline-flex items-center gap-1 px-3 py-1.5 text-[12px] font-bold active:scale-95 transition-transform" style={{ background: '#fffdf7', boxShadow: '0 2px 6px rgba(96,66,40,0.18)', transform: 'rotate(-1.5deg)', color: '#7a5c44' }}>
                        ← 翻回封面
                    </button>
                    <TapeLabel color="#d9bfe3" textColor="#6a4b78" rotate={3}>典 藏 馆</TapeLabel>
                </div>

                {/* 标题 */}
                <div className="px-5 pt-3 pb-2 shrink-0 relative">
                    <div style={{ fontFamily: HAND_FONT }}>
                        <div className="text-[11px] tracking-[0.35em]" style={{ color: '#a98e6f' }}>COLLECTION · 珍藏</div>
                        <div className="text-[34px] font-black leading-none mt-1" style={{ color: '#5b4636' }}>典藏馆</div>
                        <div className="text-[11.5px] mt-1.5" style={{ color: '#7a624c' }}>把谈心、同人、课业、剧目都收进这里，挑一份转给想分享的人。</div>
                    </div>
                </div>

                {/* 切换 */}
                <div className="px-5 pt-2 pb-3 shrink-0 flex gap-2">
                    {([['collected', `收藏夹 ${collected.length ? `· ${collected.length}` : ''}`], ['all', '去收录']] as const).map(([k, label]) => (
                        <button key={k} onClick={() => setTab(k)} className="px-4 py-1.5 rounded-full text-[12px] font-bold transition active:scale-95" style={tab === k ? { background: '#c89be0', color: '#fff', boxShadow: '0 2px 6px rgba(150,110,180,0.3)' } : { background: '#fffdf7', color: '#a98e6f', border: '1px dashed #d8c3b0' }}>
                            {label}
                        </button>
                    ))}
                </div>

                <div className="flex-1 overflow-y-auto no-scrollbar px-5 pb-10 space-y-3.5 z-10">
                    {loading ? (
                        <div className="py-10 text-center text-[12px]" style={{ color: '#a98e6f' }}>翻找中…</div>
                    ) : tab === 'collected' ? (
                        collected.length === 0 ? (
                            <div className="py-10 px-3 text-center">
                                <div className="text-[28px] mb-2">🗂️</div>
                                <p className="text-[12px] leading-relaxed" style={{ color: '#7a624c' }}>还没有收藏。<br />去「去收录」里把喜欢的谈心 / 同人 / 剧目收进来吧。</p>
                            </div>
                        ) : (
                            collected.map((item, i) => renderCard(
                                item.cover, item.title, `${SOURCE_LABEL[item.sourceType]}${item.subtitle ? ` · ${item.subtitle.replace(/^.*?·\s*/, '')}` : ''}`, item.excerpt,
                                <>
                                    <button onClick={() => setForwardItem(item)} className="px-3 py-1 rounded-full text-[11px] font-bold text-white active:scale-95 transition" style={{ background: 'linear-gradient(135deg,#f0a6c0,#c89be0)' }}>转发给…</button>
                                    <button onClick={() => void uncollect(item)} className="px-3 py-1 rounded-full text-[11px] font-medium active:scale-95 transition" style={{ background: '#fff', color: '#b08a6a', border: '1px dashed #d8c3b0' }}>移出</button>
                                </>,
                                i % 2 === 0 ? -0.8 : 1,
                            ))
                        )
                    ) : (
                        candidates.length === 0 ? (
                            <div className="py-10 px-3 text-center">
                                <div className="text-[28px] mb-2">🌱</div>
                                <p className="text-[12px] leading-relaxed" style={{ color: '#7a624c' }}>还没有可收录的内容。<br />先去谈心、写同人、做课业或开一出戏吧。</p>
                            </div>
                        ) : (
                            candidates.map((c, i) => {
                                const isIn = collectedIds.has(collectionId(c.sourceType, c.sourceId));
                                return (
                                    <div key={`${c.sourceType}:${c.sourceId}`}>
                                        {renderCard(
                                            c.cover, c.title, `${SOURCE_LABEL[c.sourceType]}${c.subtitle ? ` · ${c.subtitle.replace(/^.*?·\s*/, '')}` : ''}`, c.excerpt,
                                            <button onClick={() => void toggleCollect(c)} className="px-3 py-1 rounded-full text-[11px] font-bold active:scale-95 transition" style={isIn ? { background: '#efe2f3', color: '#9a78c0' } : { background: 'linear-gradient(135deg,#f0a6c0,#c89be0)', color: '#fff' }}>
                                                {isIn ? '✓ 已收录' : '＋ 收录'}
                                            </button>,
                                            i % 2 === 0 ? 0.6 : -1,
                                        )}
                                    </div>
                                );
                            })
                        )
                    )}
                </div>
            </div>

            {/* 转发对象选择 */}
            {forwardItem && (
                <div className="absolute inset-0 z-[60] flex flex-col justify-end" style={{ background: 'rgba(60,45,40,0.4)' }} onClick={() => setForwardItem(null)}>
                    <div className="bg-[#fffdf7] rounded-t-[20px] px-5 pt-4 pb-6 shadow-2xl max-h-[70%] flex flex-col" onClick={e => e.stopPropagation()} style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 16px)' }}>
                        <div className="flex items-center justify-between mb-1 shrink-0">
                            <div className="text-[15px] font-black" style={{ fontFamily: HAND_FONT, color: '#5b4636' }}>转发给谁？</div>
                            <button onClick={() => setForwardItem(null)} className="w-7 h-7 rounded-full bg-[#f0e6d8] text-[#a98e6f] text-[14px] flex items-center justify-center active:scale-90">✕</button>
                        </div>
                        <div className="text-[11px] mb-3 shrink-0" style={{ color: '#a98e6f' }}>把《{forwardItem.title}》当作一条消息发给 TA，TA 会看到并回应你。</div>
                        <div className="flex-1 overflow-y-auto no-scrollbar grid grid-cols-4 gap-x-2 gap-y-4">
                            {characters.length === 0 && <div className="col-span-4 text-center text-[12px] py-6" style={{ color: '#a98e6f' }}>还没有角色可以转发。</div>}
                            {characters.map(c => (
                                <button key={c.id} onClick={() => void doForward(c.id)} className="flex flex-col items-center gap-1 active:scale-95 transition">
                                    <img src={c.avatar} className="w-13 h-13 w-[52px] h-[52px] rounded-2xl object-cover shadow-sm" alt="" />
                                    <span className="text-[10.5px] max-w-[56px] truncate" style={{ color: '#7a624c' }}>{c.name}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </PaperPage>
    );
};

export default CollectionHall;
