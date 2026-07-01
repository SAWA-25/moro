import React from 'react';
import type { LiuyaoResult, MeihuaResult, YaoLine } from '../../../utils/divination/engines';

/**
 * 卦象渲染 —— 六爻金钱卦 / 梅花易数共用爻线图。
 * 阳爻 ▅▅▅▅▅（实），阴爻 ▅▅ ▅▅（断），动爻高亮 + 标「○/×」。
 */

const YaoBar: React.FC<{ yang: boolean; moving?: boolean; idx: number; coins?: YaoLine['coins'] }> = ({ yang, moving, idx, coins }) => (
    <div className="flex items-center gap-2">
        <span className="text-[8px] text-white/35 w-8 text-right font-mono">{['初', '二', '三', '四', '五', '上'][idx]}爻</span>
        <div className="flex items-center gap-1.5 w-28">
            {yang ? (
                <div className={`h-2 w-full rounded-sm ${moving ? 'bg-amber-300' : 'bg-white/75'}`} />
            ) : (
                <>
                    <div className={`h-2 w-[45%] rounded-sm ${moving ? 'bg-amber-300' : 'bg-white/75'}`} />
                    <div className={`h-2 w-[45%] rounded-sm ${moving ? 'bg-amber-300' : 'bg-white/75'}`} />
                </>
            )}
        </div>
        {coins && <span className="text-[9px] text-white/35 font-mono w-12">{coins.map(c => c === 3 ? '字' : '背').join('')}</span>}
        {moving && <span className="text-[9px] text-amber-300 font-bold">{yang ? '○ 动' : '× 动'}</span>}
    </div>
);

/** 自上而下渲染六爻（传入自下而上的 yang 数组 + 动爻位 1~6）。 */
const Lines: React.FC<{ yang: boolean[]; movingPositions: number[]; coins?: YaoLine['coins'][] }> = ({ yang, movingPositions, coins }) => (
    <div className="flex flex-col gap-1.5">
        {yang.map((_, i) => 5 - i).map(i => (
            <YaoBar key={i} idx={i} yang={yang[i]} moving={movingPositions.includes(i + 1)} coins={coins?.[i]} />
        ))}
    </div>
);

export const LiuyaoView: React.FC<{ r: LiuyaoResult }> = ({ r }) => {
    const yang = r.lines.map(l => l.yang);
    return (
        <div className="space-y-3">
            <div className="flex items-start justify-between gap-4">
                <div className="space-y-2">
                    <div className="text-[10px] text-amber-200/70 font-mono">本卦</div>
                    <Lines yang={yang} movingPositions={r.movingPositions} coins={r.lines.map(l => l.coins)} />
                </div>
                <div className="flex-1 text-right space-y-1">
                    <div className="text-lg font-black text-white">{r.primary?.name || '—'}</div>
                    {r.changed && <div className="text-[11px] text-white/55">变卦 → {r.changed.name}</div>}
                    <div className="text-[10px] text-white/45">
                        {r.movingPositions.length ? `动爻：第 ${r.movingPositions.join('、')} 爻` : '静卦（无动爻）'}
                    </div>
                </div>
            </div>
            {r.primary?.judgement && (
                <div className="text-[11px] text-white/60 leading-relaxed bg-white/[0.04] rounded-lg p-2.5 border border-white/10">{r.primary.judgement}</div>
            )}
        </div>
    );
};

export const MeihuaView: React.FC<{ r: MeihuaResult }> = ({ r }) => {
    // 由上下卦先天数还原六爻 yang（仅用于展示）
    const bits = (n: number) => {
        const map: Record<number, number> = { 1: 0b111, 2: 0b110, 3: 0b101, 4: 0b100, 5: 0b011, 6: 0b010, 7: 0b001, 8: 0b000 };
        return map[n];
    };
    const lb = bits(r.lowerNum), ub = bits(r.upperNum);
    const yang = [!!(lb & 1), !!(lb & 2), !!(lb & 4), !!(ub & 1), !!(ub & 2), !!(ub & 4)];
    const ti = r.bodyTrigram === 'upper' ? r.upperName : r.lowerName;
    const yong = r.bodyTrigram === 'upper' ? r.lowerName : r.upperName;
    return (
        <div className="space-y-3">
            <div className="flex items-start justify-between gap-4">
                <div className="space-y-2">
                    <div className="text-[10px] text-amber-200/70 font-mono">本卦（上{r.upperName}下{r.lowerName}）</div>
                    <Lines yang={yang} movingPositions={[r.movingYao]} />
                </div>
                <div className="flex-1 text-right space-y-1">
                    <div className="text-lg font-black text-white">{r.primary?.name || '—'}</div>
                    <div className="text-[11px] text-white/55">变卦 → {r.changed?.name || '—'}</div>
                    <div className="text-[10px] text-white/45">互卦：{r.mutual?.name || '—'}</div>
                    <div className="text-[10px] text-amber-200/70">体：{ti}　用：{yong}　动爻：第 {r.movingYao} 爻</div>
                </div>
            </div>
            {r.primary?.judgement && (
                <div className="text-[11px] text-white/60 leading-relaxed bg-white/[0.04] rounded-lg p-2.5 border border-white/10">{r.primary.judgement}</div>
            )}
        </div>
    );
};

export type { YaoLine };
