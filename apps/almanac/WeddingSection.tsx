import React from 'react';
import { useOS } from '../../context/OSContext';
import { PaperPage, PaperNote, WashiTape, TapeLabel, Postmark, HAND_FONT } from './handbookKit';
import { MARRIAGE_STAGE_LABEL } from '../../utils/relationship';
import type { MarriageMilestone } from '../../types';

/**
 * 岁时记 · 喜事页（婚姻筹备期）。
 * 求婚成功后，与角色进入婚姻筹备期 —— 这里按角色汇总：订婚日、关系、当前阶段、
 * 商定的婚期（与现实匹配的倒计时）、以及一路走来的婚事里程碑时间线。
 */

const KIND_EMOJI: Record<MarriageMilestone['kind'], string> = {
    proposal: '💍', plan: '📅', register: '📜', wedding: '💒', custom: '✨',
};

const daysUntil = (date?: string): number | null => {
    if (!date) return null;
    const t = new Date(`${date}T00:00:00`).getTime();
    if (!Number.isFinite(t)) return null;
    return Math.ceil((t - Date.now()) / 86400000);
};

const WeddingSection: React.FC<{ onExit: () => void }> = ({ onExit }) => {
    const { characters } = useOS();
    const engaged = characters.filter(c => c.marriage?.active);

    return (
        <PaperPage kind="kraft" className="animate-fade-in" style={{ paddingTop: 'var(--safe-top)' }}>
            <div className="h-full flex flex-col" style={{ color: '#5b3b4a' }}>
                <div className="relative flex items-center justify-between px-4 pt-3 pb-1 shrink-0 z-10">
                    <button
                        onClick={onExit}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-[12px] font-bold active:scale-95 transition-transform"
                        style={{ background: '#fffdf7', boxShadow: '0 2px 6px rgba(120,60,80,0.18)', transform: 'rotate(-1.5deg)', color: '#9a5a72' }}
                    >
                        ← 合上本子
                    </button>
                    <Postmark size={50} color="#c2557a" rotate={9}>喜事</Postmark>
                </div>

                <div className="flex-1 overflow-y-auto no-scrollbar px-5 pb-10 z-10">
                    <div className="relative mt-3 mb-6 select-none">
                        <WashiTape className="-top-1 left-6" color="rgba(231,163,180,0.72)" rotate={-14} width={84} height={26} />
                        <div className="pt-6 pl-1" style={{ fontFamily: HAND_FONT }}>
                            <div className="text-[11px] tracking-[0.4em]" style={{ color: '#bb8a9c' }}>HAPPY · EVENT</div>
                            <div className="text-[52px] leading-none font-black mt-1" style={{ color: '#a83a5e', textShadow: '2px 2px 0 rgba(177,84,107,0.14)' }}>喜事</div>
                            <div className="text-[13px] mt-2 leading-relaxed" style={{ color: '#8a6473' }}>
                                从一句"我愿意"开始，把筹备婚礼的每一步都贴进这一页。
                            </div>
                        </div>
                    </div>

                    {engaged.length === 0 ? (
                        <div className="text-center text-[13px] py-16" style={{ color: '#b48a98' }}>
                            还没有喜事呀～<br />
                            <span className="text-[12px]">当你和某位角色求婚成功后，这里会记下你们的婚事筹备。</span>
                        </div>
                    ) : (
                        <div className="space-y-6">
                            {engaged.map(c => {
                                const m = c.marriage!;
                                const dleft = daysUntil(m.weddingDate);
                                const milestones = [...(m.milestones || [])].sort((a, b) => {
                                    const ad = a.date ? new Date(`${a.date}T00:00:00`).getTime() : a.at;
                                    const bd = b.date ? new Date(`${b.date}T00:00:00`).getTime() : b.at;
                                    return ad - bd;
                                });
                                return (
                                    <PaperNote key={c.id} rotate={-0.8} bg="#fdf3f6" className="px-5 py-5">
                                        <WashiTape className="-top-2 right-8" color="rgba(231,180,196,0.7)" rotate={12} width={76} />
                                        <div className="flex items-center gap-3">
                                            {c.avatar && <img src={c.avatar} alt={c.name} className="w-12 h-12 rounded-full object-cover border-2 border-white shadow" />}
                                            <div className="min-w-0">
                                                <TapeLabel color="#eec7d2" textColor="#a83a5e">{MARRIAGE_STAGE_LABEL[m.stage]}</TapeLabel>
                                                <div className="text-[22px] font-black mt-1 truncate" style={{ fontFamily: HAND_FONT, color: '#a83a5e' }}>
                                                    💍 和 {c.name}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="text-[12px] mt-3 space-y-1" style={{ color: '#7a5663' }}>
                                            <div>关系：{c.relationship?.label || '未婚夫妻'}</div>
                                            <div>订婚于：{new Date(m.engagedAt).toLocaleDateString('zh-CN')}（{m.proposalBy === 'user' ? '你' : c.name}求的婚）</div>
                                            <div>
                                                婚期：{m.weddingDate || '还没定下'}
                                                {dleft !== null && dleft >= 0 && <span className="ml-1 font-black" style={{ color: '#c2557a' }}>· 还有 {dleft} 天</span>}
                                                {dleft !== null && dleft < 0 && <span className="ml-1" style={{ color: '#9a7a84' }}>· 已过</span>}
                                            </div>
                                        </div>

                                        {/* 婚事时间线 */}
                                        <div className="mt-4 pl-1 border-l-2 border-dashed" style={{ borderColor: '#e7c4d0' }}>
                                            {milestones.map(ms => (
                                                <div key={ms.id} className="relative pl-4 pb-3 last:pb-0">
                                                    <span className="absolute -left-[9px] top-0 text-[13px]">{KIND_EMOJI[ms.kind]}</span>
                                                    <div className="text-[12.5px] font-bold" style={{ color: '#5b3b4a' }}>{ms.title}</div>
                                                    <div className="text-[10.5px]" style={{ color: '#a98a96' }}>
                                                        {ms.date || new Date(ms.at).toLocaleDateString('zh-CN')}{ms.by ? ` · ${ms.by === 'user' ? '你' : c.name}` : ''}
                                                    </div>
                                                    {ms.note && ms.note !== ms.title && <div className="text-[11px] mt-0.5" style={{ color: '#8a6473' }}>{ms.note}</div>}
                                                </div>
                                            ))}
                                        </div>
                                    </PaperNote>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </PaperPage>
    );
};

export default WeddingSection;
