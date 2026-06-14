import React, { useState } from 'react';
import { useOS } from '../context/OSContext';
import { MaskHappy, Heart, BookBookmark, ChatTeardropDots, Cards, Path, MoonStars } from '@phosphor-icons/react';
import GuidebookApp from './GuidebookApp';
import GameApp from './GameApp';
import TrajectoryApp from './theater/TrajectoryApp';
import ReflectionApp from './theater/ReflectionApp';
import TalkTherapyApp from './theater/TalkTherapyApp';
import ExtraApp from './theater/ExtraApp';
import { PaperShell, ScrapScroll, ScrapHeader, PaperCard, Stamp, WashiTape, WASHI, INK, INK_SOFT, type WashiColor } from './theater/scrapbook';

/**
 * 小剧场：原「攻略本」（galgame 恋爱攻略，apps/GuidebookApp.tsx）与「TRPG」（跑团
 * 冒险，apps/GameApp.tsx）的统一入口。桌面只保留一个「小剧场」图标，点开是封面页，
 * 先挑一出戏：
 *   - 攻略本 → 和角色谈一场有回合、有好感度的恋爱小游戏
 *   - TRPG  → 拉上熟人开团，世界观 + 骰子 + 自由行动的跑团冒险
 * 两个子页通过 onExit 回到本封面页（不直接回桌面）。两边各自保留玩法、数据与名字，
 * 合并后只占一个入口。
 *
 * 界面＝拼贴手账「今夜节目单」：每出戏是一张贴在内页上的票根剪贴。
 */

type Section = 'home' | 'guide' | 'trpg' | 'trajectory' | 'reflection' | 'talk' | 'extra';

interface Programme {
    section: Exclude<Section, 'home'>;
    cn: string;
    en: string;
    kicker: string;
    desc: string;
    icon: React.ReactNode;
    color: WashiColor;
    tilt: number;
}

const PROGRAMMES: Programme[] = [
    { section: 'guide', cn: '攻略本', en: 'DATE', kicker: '谈一场恋爱', color: 'rose', tilt: -0.8,
      icon: <Heart size={22} weight="fill" />,
      desc: '和角色玩一局 galgame：定场景、挑选项、攒好感度，结局生成攻略结算卡。' },
    { section: 'extra', cn: '番外', en: 'SIDE STORY', kicker: '一起做点别的', color: 'amber', tilt: 0.9,
      icon: <BookBookmark size={22} weight="fill" />,
      desc: '挑个角色做问卷（相性100问 / MBTI / 价值观…），或生成贴吧帖、聊天记录、热梗等主题番外。' },
    { section: 'talk', cn: '谈心', en: 'HEART TO HEART', kicker: '好好被听一次', color: 'lilac', tilt: -1.1,
      icon: <ChatTeardropDots size={22} weight="fill" />,
      desc: '心里堵得慌时，找个角色把话放下来——只负责好好听你说、轻轻抱住你。' },
    { section: 'trpg', cn: 'TRPG', en: 'TABLETOP', kicker: '开一局跑团', color: 'sage', tilt: 1.0,
      icon: <Cards size={22} weight="fill" />,
      desc: '拉上熟人开团：AI 生成世界观、骰子判定、自由行动，剧情可转发回聊天一起回味。' },
    { section: 'trajectory', cn: '轨迹', en: 'TRAJECTORY', kicker: '还未相遇的日子', color: 'sky', tilt: -0.9,
      icon: <Path size={22} weight="bold" />,
      desc: '回到过去的时间节点，看看角色原本走过的路——也看见你是从什么时候慢慢走进 TA 的人生。' },
    { section: 'reflection', cn: '对影', en: 'REFLECTION', kicker: '对影成几人', color: 'butter', tilt: 0.8,
      icon: <MoonStars size={22} weight="fill" />,
      desc: '同一个人在不同时间里的相逢。看见 TA 并非突然变成今天的样子。举杯邀明月，对影成几人。' },
];

/** 票根撕口处垫的小圆缺（同页底色，做出咬掉一口的视觉） */
const PAGE_NOTCH = 'radial-gradient(circle, #efe5d0 60%, transparent 62%)';

const TheaterApp: React.FC = () => {
    const { closeApp } = useOS();
    const [section, setSection] = useState<Section>('home');

    if (section === 'guide') return <GuidebookApp onExit={() => setSection('home')} />;
    if (section === 'trpg') return <GameApp onExit={() => setSection('home')} />;
    if (section === 'trajectory') return <TrajectoryApp onExit={() => setSection('home')} />;
    if (section === 'reflection') return <ReflectionApp onExit={() => setSection('home')} />;
    if (section === 'talk') return <TalkTherapyApp onExit={() => setSection('home')} />;
    if (section === 'extra') return <ExtraApp onExit={() => setSection('home')} />;

    return (
        <PaperShell>
            <ScrapHeader title="小剧场" en="LITTLE THEATER" onBack={closeApp} backLabel="回桌面" />

            <ScrapScroll className="px-5 pb-12 pt-1">
                {/* 节目单招牌 */}
                <div className="relative mb-6">
                    <PaperCard tilt={-0.6} className="px-6 py-6 overflow-hidden">
                        <WashiTape color="rose" rotate={-22} className="absolute -top-3 -left-5 w-24 h-6 rounded-[2px]" />
                        <WashiTape color="sky" rotate={16} className="absolute -top-3 -right-5 w-20 h-6 rounded-[2px]" />
                        <div className="text-[9px] tracking-[0.3em] uppercase" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>
                            Tonight's Programme · 今夜上演
                        </div>
                        <div className="flex items-end gap-2.5 mt-2">
                            <span className="text-[44px] font-black leading-none" style={{ color: INK }}>小剧场</span>
                            <span aria-hidden className="text-3xl -mb-0.5 -rotate-12 select-none">🎭</span>
                        </div>
                        <div className="leading-none mt-1.5" style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 22, color: '#8a7c5e' }}>
                            Little Theater
                        </div>
                        <p className="text-[12.5px] leading-relaxed mt-3" style={{ color: '#6b6456' }}>
                            找个角色登台，演一场恋爱攻略，或者拉队开一局跑团——
                            <br className="hidden sm:block" />今晚想看哪一出，撕下票根入场就好。
                        </p>
                        {/* 票根装饰 */}
                        <div className="flex items-center gap-1.5 mt-4 select-none">
                            <span className="text-[8px] tracking-[0.35em]" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>ADMIT ONE</span>
                            <span className="flex-1 h-px" style={{ backgroundImage: 'repeating-linear-gradient(90deg, rgba(150,140,120,0.5) 0 5px, transparent 5px 10px)' }} />
                            <span aria-hidden className="text-base -rotate-6">🎟️</span>
                        </div>
                    </PaperCard>
                </div>

                {/* 节目票根列表 */}
                <div className="space-y-4">
                    {PROGRAMMES.map((p) => {
                        const c = WASHI[p.color];
                        return (
                            <PaperCard key={p.section} onClick={() => setSection(p.section)} tilt={p.tilt} tape={p.color} className="overflow-hidden">
                                <div className="flex items-stretch">
                                    <div className="flex-1 min-w-0 pl-5 pr-3 py-5">
                                        <div className="text-[9px] tracking-[0.3em] uppercase mb-1.5" style={{ fontFamily: 'var(--font-label)', color: c.ink }}>
                                            {p.en} — {p.kicker}
                                        </div>
                                        <div className="flex items-center gap-2.5">
                                            <Stamp color={p.color} size={38}>{p.icon}</Stamp>
                                            <span className="text-[26px] font-black tracking-wide" style={{ color: INK }}>{p.cn}</span>
                                        </div>
                                        <p className="text-[11.5px] leading-relaxed mt-2.5" style={{ color: '#6b6456' }}>{p.desc}</p>
                                    </div>
                                    {/* 票根撕口 */}
                                    <div className="relative w-9 shrink-0 flex flex-col items-center justify-center">
                                        <span aria-hidden className="absolute inset-y-2 left-0 w-px" style={{ backgroundImage: 'repeating-linear-gradient(0deg, rgba(150,140,120,0.55) 0 5px, transparent 5px 10px)' }} />
                                        <span aria-hidden className="absolute -left-2 top-0 w-4 h-4 rounded-full" style={{ background: PAGE_NOTCH }} />
                                        <span aria-hidden className="absolute -left-2 bottom-0 w-4 h-4 rounded-full" style={{ background: PAGE_NOTCH }} />
                                        <span className="text-[9px] font-black tracking-[0.2em] -rotate-90 whitespace-nowrap select-none" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>ADMIT&nbsp;ONE</span>
                                    </div>
                                </div>
                            </PaperCard>
                        );
                    })}
                </div>

                <div className="flex items-center justify-center gap-2 mt-8 select-none">
                    <span aria-hidden className="text-sm opacity-70">✶</span>
                    <span className="text-[10px] tracking-[0.3em]" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>ENJOY THE SHOW</span>
                    <span aria-hidden className="text-sm opacity-70">✶</span>
                </div>
            </ScrapScroll>
        </PaperShell>
    );
};

export default TheaterApp;
