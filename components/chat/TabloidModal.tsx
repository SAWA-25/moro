import React, { useMemo, useState } from 'react';
import { CharacterProfile, Tabloid } from '../../types';
import { useOS } from '../../context/OSContext';
import { resolveAuxApi } from '../../utils/auxApi';
import { generateTabloid, tabloidKey, TABLOID_META, TabloidPeriod } from '../../utils/tabloid';
import { JournalSheet, SealBtn, StickerChip } from './JournalSheet';
import { MONO_STACK, CUTE_STACK, SERIF_STACK } from '../handbook/paper';

/**
 * 回顾摘要弹层（日回顾 / 周回顾 / 月回顾）。
 * 选周期 → 生成（或读缓存）→ 整理这段时间的聊天与日常。详见 utils/tabloid.ts。
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
            addToast(`《${TABLOID_META[period].label}》已生成`, 'success');
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
            sub={`${char.name} 的回顾 · ${meta.sub}`}
            tape="blush"
            pattern="dot"
            paper="plain"
            tall
            onClose={onClose}
            footer={
                <>
                    <SealBtn kind="ghost" onClick={onClose}>关闭</SealBtn>
                    <SealBtn kind="berry" onClick={run} disabled={busy}>
                        {busy ? '生成中…' : (cached ? '重新生成' : '生成回顾')}
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
                <div className="flex flex-col items-center justify-center gap-3 py-12" style={{ color: '#857f74' }}>
                    <div className="w-7 h-7 border-2 rounded-full animate-spin" style={{ borderColor: '#eed6df', borderTopColor: '#d8a5b7' }} />
                    <div className="text-[12px]">正在生成{meta.windowLabel}回顾…</div>
                </div>
            )}

            {!busy && !cached && (
                <div className="flex flex-col items-center justify-center gap-2 py-12 text-center" style={{ color: '#857f74' }}>
                    <div className="w-10 h-10 rounded-full flex items-center justify-center text-[18px]" style={{ color: '#d8a5b7', border: '1px solid #eed6df', background: '#fffdfa' }}>♡</div>
                    <div className="text-[12px] leading-relaxed px-6">
                        还没有这一期。点下面「生成回顾」，整理{meta.windowLabel}里你们之间发生的事。
                    </div>
                </div>
            )}

            {!busy && cached && <TabloidSheet tab={cached} charName={char.name} />}
        </JournalSheet>
    );
};

const TabloidSheet: React.FC<{ tab: Tabloid; charName: string }> = ({ tab, charName }) => (
    <div className="animate-fade-in">
        {/* 摘要标题 */}
        <div className="text-center pb-2 mb-3 border-b-2" style={{ borderColor: '#eed6df' }}>
            <div className="flex items-center justify-center gap-2 text-[8px] tracking-[0.2em] uppercase mb-1.5" style={{ ...MONO_STACK, color: '#857f74' }}>
                <span>VOL.{new Date(tab.generatedAt).getFullYear()}</span>
                <span>·</span>
                <span>{charName} 回顾</span>
                <span>·</span>
                <span>{new Date(tab.rangeFrom).toLocaleDateString()} – {new Date(tab.rangeTo).toLocaleDateString()}</span>
            </div>
            <h1 className="text-[22px] leading-tight font-black" style={{ ...SERIF_STACK, color: '#5a3140' }}>{tab.headline}</h1>
            {tab.subhead && <div className="text-[11px] mt-1.5" style={{ color: '#857f74' }}>{tab.subhead}</div>}
        </div>

        {/* 开场摘要 */}
        {tab.editorNote && (
            <p className="text-[12.5px] leading-relaxed italic mb-4 px-1" style={{ color: '#857f74' }}>
                {tab.editorNote}
            </p>
        )}

        {/* 栏目 */}
        <div className="space-y-4">
            {tab.sections.map((s, i) => (
                <div key={i} className="pb-3 border-b" style={{ borderColor: 'rgba(216,165,183,0.35)' }}>
                    <div className="flex items-center gap-2 mb-1">
                        <span className="text-[8.5px] font-bold px-1.5 py-0.5 rounded" style={{ ...MONO_STACK, background: '#fff4f7', color: '#5a3140', border: '1px solid #eed6df' }}>{s.tag}</span>
                        <span className="text-[14px] font-black" style={{ ...SERIF_STACK, color: '#5a3140' }}>{s.title}</span>
                    </div>
                    <p className="text-[12px] leading-relaxed whitespace-pre-wrap" style={{ color: '#5a3140' }}>{s.body}</p>
                    {s.quote && (
                        <div className="mt-2 pl-3 border-l-2 text-[12px] italic" style={{ borderColor: '#d8a5b7', color: '#8b5b6b' }}>
                            “{s.quote}”
                        </div>
                    )}
                </div>
            ))}
        </div>

        {/* 补充记录 */}
        {tab.sidebar && tab.sidebar.length > 0 && (
            <div className="mt-4 rounded-[10px] p-3" style={{ background: 'rgba(255,248,251,0.85)', border: '1px solid #eed6df' }}>
                <div className="text-[8.5px] tracking-[0.18em] uppercase mb-1.5" style={{ ...MONO_STACK, color: '#a892a3' }}>补充记录 · NOTES</div>
                <ul className="space-y-1">
                    {tab.sidebar.map((s, i) => (
                        <li key={i} className="text-[11.5px] leading-relaxed flex gap-1.5" style={{ color: '#857f74' }}>
                            <span style={{ color: '#d8a5b7' }}>✦</span>
                            <span>{s}</span>
                        </li>
                    ))}
                </ul>
            </div>
        )}

        {/* 签名 */}
        {tab.signoff && (
            <div className="text-right mt-4 text-[15px]" style={{ ...CUTE_STACK, color: '#5a3140' }}>{tab.signoff}</div>
        )}

        <div className="text-center mt-3 text-[8px] tracking-[0.2em] uppercase" style={{ ...MONO_STACK, color: '#857f74' }}>— 回顾生成于 {new Date(tab.generatedAt).toLocaleString()} —</div>
    </div>
);

export default TabloidModal;
