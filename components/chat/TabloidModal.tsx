import React, { useMemo, useState } from 'react';
import { CharacterProfile, Tabloid } from '../../types';
import { useOS } from '../../context/OSContext';
import { resolveAuxApi } from '../../utils/auxApi';
import { generateTabloid, tabloidKey, TABLOID_META, TabloidPeriod } from '../../utils/tabloid';
import { JournalSheet, SealBtn, StickerChip } from './JournalSheet';
import { PAPER_TONES, MONO_STACK, CUTE_STACK, SERIF_STACK } from '../handbook/paper';

/**
 * 回望小报弹层（昨日来信 / 回望·周章 / 回望·月章）。
 * 选周期 → 生成（或读缓存）→ 用娱乐小报的版式呈现这段日子。详见 utils/tabloid.ts。
 */

const PERIODS: TabloidPeriod[] = ['day', 'week', 'month'];

const TabloidModal: React.FC<{ char: CharacterProfile; isOpen: boolean; onClose: () => void }> = ({ char, isOpen, onClose }) => {
    const { apiConfig, auxApiConfig, userProfile, updateCharacter, addToast } = useOS();
    const [period, setPeriod] = useState<TabloidPeriod>('day');
    const [busy, setBusy] = useState(false);

    const key = useMemo(() => tabloidKey(period), [period]);
    const cached: Tabloid | undefined = char.generatedTabloids?.[key];

    const run = async () => {
        const api = resolveAuxApi(auxApiConfig, apiConfig);
        if (!api?.apiKey || !api?.baseUrl) { addToast('请先配置 API', 'error'); return; }
        setBusy(true);
        try {
            const tab = await generateTabloid(char, userProfile, api, period);
            await updateCharacter(char.id, { generatedTabloids: { ...(char.generatedTabloids || {}), [key]: tab } });
            addToast(`《${TABLOID_META[period].label}》出炉啦`, 'success');
        } catch (e: any) {
            addToast(e?.message || '生成失败，请重试', 'error');
        } finally {
            setBusy(false);
        }
    };

    const meta = TABLOID_META[period];

    return (
        <JournalSheet
            open={isOpen}
            title={meta.label}
            en={meta.en}
            sub={`${char.name} 主笔 · ${meta.sub}`}
            tape="blush"
            pattern="dot"
            paper="plain"
            tall
            onClose={onClose}
            footer={
                <>
                    <SealBtn kind="ghost" onClick={onClose}>收好了</SealBtn>
                    <SealBtn kind="berry" onClick={run} disabled={busy}>
                        {busy ? '主笔赶稿中…' : (cached ? '↻ 重出一期' : '✎ 出这期小报')}
                    </SealBtn>
                </>
            }
        >
            {/* 周期选择 */}
            <div className="flex flex-wrap gap-2 mb-4">
                {PERIODS.map(p => (
                    <StickerChip key={p} seed={`tab-${p}`} candy="#f3b6c6" active={period === p} disabled={busy} onClick={() => setPeriod(p)}>
                        {TABLOID_META[p].label}
                    </StickerChip>
                ))}
            </div>

            {busy && (
                <div className="flex flex-col items-center justify-center gap-3 py-12" style={{ color: PAPER_TONES.inkSoft }}>
                    <div className="w-7 h-7 border-2 rounded-full animate-spin" style={{ borderColor: '#e8c4d0', borderTopColor: '#c14a64' }} />
                    <div className="text-[12px]">{char.name} 正在把{meta.windowLabel}剪成一份小报…</div>
                </div>
            )}

            {!busy && !cached && (
                <div className="flex flex-col items-center justify-center gap-2 py-12 text-center" style={{ color: PAPER_TONES.inkFaint }}>
                    <div className="text-3xl">🗞️</div>
                    <div className="text-[12px] leading-relaxed px-6">
                        还没有这一期。点下面「✎ 出这期小报」，让 {char.name} 把{meta.windowLabel}里你们之间的事，<br />揉成一份俏皮的娱乐小报。
                    </div>
                </div>
            )}

            {!busy && cached && <TabloidSheet tab={cached} charName={char.name} />}
        </JournalSheet>
    );
};

const TabloidSheet: React.FC<{ tab: Tabloid; charName: string }> = ({ tab, charName }) => (
    <div className="animate-fade-in">
        {/* 报头 */}
        <div className="text-center pb-2 mb-3 border-b-2" style={{ borderColor: PAPER_TONES.ink }}>
            <div className="flex items-center justify-center gap-2 text-[8px] tracking-[0.2em] uppercase mb-1.5" style={{ ...MONO_STACK, color: PAPER_TONES.inkFaint }}>
                <span>VOL.{new Date(tab.generatedAt).getFullYear()}</span>
                <span>·</span>
                <span>{charName} 编辑部</span>
                <span>·</span>
                <span>{new Date(tab.rangeFrom).toLocaleDateString()} – {new Date(tab.rangeTo).toLocaleDateString()}</span>
            </div>
            <h1 className="text-[22px] leading-tight font-black" style={{ ...SERIF_STACK, color: PAPER_TONES.ink }}>{tab.headline}</h1>
            {tab.subhead && <div className="text-[11px] mt-1.5" style={{ color: PAPER_TONES.inkSoft }}>{tab.subhead}</div>}
        </div>

        {/* 主笔手记 */}
        {tab.editorNote && (
            <p className="text-[12.5px] leading-relaxed italic mb-4 px-1" style={{ color: PAPER_TONES.inkSoft }}>
                {tab.editorNote}
            </p>
        )}

        {/* 栏目 */}
        <div className="space-y-4">
            {tab.sections.map((s, i) => (
                <div key={i} className="pb-3 border-b border-dashed" style={{ borderColor: 'rgba(122,90,114,0.2)' }}>
                    <div className="flex items-center gap-2 mb-1">
                        <span className="text-[8.5px] font-bold px-1.5 py-0.5 rounded" style={{ ...MONO_STACK, background: '#f3d3dc', color: '#8a3450' }}>{s.tag}</span>
                        <span className="text-[14px] font-black" style={{ ...SERIF_STACK, color: PAPER_TONES.ink }}>{s.title}</span>
                    </div>
                    <p className="text-[12px] leading-relaxed whitespace-pre-wrap" style={{ color: PAPER_TONES.ink }}>{s.body}</p>
                    {s.quote && (
                        <div className="mt-2 pl-3 border-l-2 text-[12px] italic" style={{ borderColor: '#e26b84', color: '#9c4a60' }}>
                            “{s.quote}”
                        </div>
                    )}
                </div>
            ))}
        </div>

        {/* 边栏花絮 */}
        {tab.sidebar && tab.sidebar.length > 0 && (
            <div className="mt-4 rounded-[10px] p-3" style={{ background: 'rgba(255,248,251,0.85)', border: '1px dashed #eab6c6' }}>
                <div className="text-[8.5px] tracking-[0.18em] uppercase mb-1.5" style={{ ...MONO_STACK, color: '#c07a90' }}>花絮 · GOSSIP</div>
                <ul className="space-y-1">
                    {tab.sidebar.map((s, i) => (
                        <li key={i} className="text-[11.5px] leading-relaxed flex gap-1.5" style={{ color: PAPER_TONES.inkSoft }}>
                            <span style={{ color: '#e26b84' }}>✦</span>
                            <span>{s}</span>
                        </li>
                    ))}
                </ul>
            </div>
        )}

        {/* 签名 */}
        {tab.signoff && (
            <div className="text-right mt-4 text-[15px]" style={{ ...CUTE_STACK, color: PAPER_TONES.ink }}>{tab.signoff}</div>
        )}

        <div className="text-center mt-3 text-[8px] tracking-[0.2em] uppercase" style={{ ...MONO_STACK, color: PAPER_TONES.inkFaint }}>— 本期完 · {new Date(tab.generatedAt).toLocaleString()} —</div>
    </div>
);

export default TabloidModal;
