import React, { useState } from 'react';
import { useOS } from '../context/OSContext';
import { Path, Scroll, Cards, Quotes, DiceFive, FilmReel, MaskSad, MaskHappy, Sparkle, type Icon } from '@phosphor-icons/react';
import GuidebookApp from './GuidebookApp';
import GameApp from './GameApp';
import TrajectoryApp from './theater/TrajectoryApp';
import ReflectionApp from './theater/ReflectionApp';
import TalkTherapyApp from './theater/TalkTherapyApp';
import ExtraApp from './theater/ExtraApp';
import DivinationApp from './theater/DivinationApp';
import { PaperShell, ScrapScroll, ScrapHeader, PaperCard, Stamp, SectionTag, WashiTape, HALFTONE, INK, INK_SOFT } from './theater/scrapbook';

/**
 * 折子戏（原「小剧场」）：一个图标、一张戏单，先挑一折戏。
 * 黑白拼贴手账皮肤——米白报纸 + 墨黑 + 牛皮胶带 + 邮票 + 网点半调，由 theater/scrapbook 套件统一。
 * 七折各自保留原玩法、数据与名字（攻略本 / 番外 / 占卜 / 谈心 / TRPG / 轨迹 / 对影），
 * 合并后只占一个入口；子页通过 onExit 回到本戏单页（不直接回桌面）。换肤不改、不减任何功能。
 */

type Section = 'home' | 'guide' | 'trpg' | 'trajectory' | 'reflection' | 'talk' | 'extra' | 'divination';

interface Zhe {
    section: Exclude<Section, 'home'>;
    no: string;       // 折次（壹贰叁…）
    name: string;     // 折名（保留原功能名）
    en: string;       // 英文小标
    tagline: string;  // 戏文式一句
    desc: string;     // 介绍
    Icon: Icon;
}

const PROGRAMME: Zhe[] = [
    { section: 'guide',      no: '壹', name: '攻略本', en: 'THE COURTSHIP',  tagline: '择一言，赌一段心动',     desc: '和角色排一出恋爱戏：定场、择言、攒心动，落幕收一张攻略结算卡。', Icon: Path },
    { section: 'extra',      no: '贰', name: '番外',   en: 'SIDE LEAVES',    tagline: '正传之外的边角料',       desc: '拉个角色做问卷（恋爱百问 / MBTI / 性癖…），或现搓贴吧帖、聊天截图、热梗等仿真番外。', Icon: Scroll },
    { section: 'divination', no: '叁', name: '占卜',   en: 'THE READING',    tagline: '向纸牌问一问前路',       desc: '塔罗78 / 雷诺曼36 / 六爻金钱卦 / 梅花易数，抽牌起卦，自解或请 TA 以本人口吻为你解读。', Icon: Cards },
    { section: 'talk',       no: '肆', name: '谈心',   en: 'HEART TO HEART', tagline: '把心里的话，轻轻放下',   desc: '心里堵时，找个角色好好被听一次——只负责接住你、抱住你的安全角落。', Icon: Quotes },
    { section: 'trpg',       no: '伍', name: 'TRPG',   en: 'THE CAMPAIGN',   tagline: '掷一颗骰子，闯一段故事', desc: '拉熟人开团：AI 现搓世界观、骰子判定、自由行动，剧情可转回聊天一起回味。', Icon: DiceFive },
    { section: 'trajectory', no: '陆', name: '轨迹',   en: 'BEFORE WE MET',  tagline: '那些还没遇见你的日子',   desc: '回到过去的节点，看 TA 原本走过的路——也看你，从哪一天起慢慢走进 TA 的人生。', Icon: FilmReel },
    { section: 'reflection', no: '柒', name: '对影',   en: 'BY MOONLIGHT',   tagline: '举杯邀明月，对影成三人', desc: '同一个人，在不同时间里重逢——是谁，让命运偏离了原本的方向。', Icon: MaskSad },
];

const TheaterApp: React.FC = () => {
    const { closeApp } = useOS();
    const [section, setSection] = useState<Section>('home');

    if (section === 'guide') return <GuidebookApp onExit={() => setSection('home')} />;
    if (section === 'trpg') return <GameApp onExit={() => setSection('home')} />;
    if (section === 'trajectory') return <TrajectoryApp onExit={() => setSection('home')} />;
    if (section === 'reflection') return <ReflectionApp onExit={() => setSection('home')} />;
    if (section === 'talk') return <TalkTherapyApp onExit={() => setSection('home')} />;
    if (section === 'extra') return <ExtraApp onExit={() => setSection('home')} />;
    if (section === 'divination') return <DivinationApp onExit={() => setSection('home')} />;

    return (
        <PaperShell>
            <ScrapHeader title="折子戏" en="ZHE ZI XI" onBack={closeApp} backLabel="回桌面" />

            <ScrapScroll className="px-5 pb-12 pt-1">
                {/* ── 戏单招牌 ── */}
                <PaperCard tilt={-0.8} className="px-6 py-7 mt-2 overflow-hidden">
                    {/* 网点半调底纹 */}
                    <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.10]" style={{ backgroundImage: HALFTONE, backgroundSize: '7px 7px' }} />
                    {/* 角落戏票印 */}
                    <WashiTape color="ink" rotate={-7} className="absolute -top-2 right-6 w-20 h-6 rounded-[2px] text-[8px] tracking-[0.35em]" style={{ fontFamily: 'var(--font-label)' }}>TICKET</WashiTape>
                    <div className="relative">
                        <div className="text-[9px] tracking-[0.42em] mb-2" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>TONIGHT'S BILL · 今 日 戏 单</div>
                        <div className="flex items-end gap-2.5">
                            <div className="text-[52px] leading-[0.9] font-black tracking-tight" style={{ color: INK }}>折子戏</div>
                            <MaskHappy size={30} weight="fill" className="mb-2 -rotate-[8deg]" style={{ color: INK }} />
                            <MaskSad size={22} weight="regular" className="mb-2.5 rotate-[6deg]" style={{ color: INK_SOFT }} />
                        </div>
                        <div className="mt-3 flex items-center gap-2">
                            <span className="h-px flex-1" style={{ backgroundImage: 'repeating-linear-gradient(90deg, rgba(140,132,118,0.6) 0 5px, transparent 5px 10px)' }} />
                            <Sparkle size={12} weight="fill" style={{ color: INK_SOFT }} />
                            <span className="h-px flex-1" style={{ backgroundImage: 'repeating-linear-gradient(90deg, rgba(140,132,118,0.6) 0 5px, transparent 5px 10px)' }} />
                        </div>
                        <div className="text-[12.5px] mt-2.5 leading-relaxed" style={{ color: '#54504a' }}>
                            一张戏单，七出折子。挑个角色登台，演一折就散场——不必从头看到尾。
                        </div>
                    </div>
                </PaperCard>

                {/* ── 折目 ── */}
                <SectionTag en="THE PROGRAMME" className="mt-7 mb-3.5">今日折目</SectionTag>

                <div className="space-y-4">
                    {PROGRAMME.map((z, i) => {
                        const tilt = i % 2 === 0 ? -0.7 : 0.6;
                        const tape = (['amber', 'sage', 'butter', 'lilac'] as const)[i % 4];
                        return (
                            <PaperCard
                                key={z.section}
                                tilt={tilt}
                                tape={tape}
                                onClick={() => setSection(z.section)}
                                className="px-4 py-4"
                            >
                                <div className="flex items-stretch gap-3.5">
                                    {/* 折次票根 */}
                                    <div className="shrink-0 flex flex-col items-center justify-center px-2.5 py-1 self-stretch" style={{ borderRight: '1px dashed rgba(150,144,132,0.6)' }}>
                                        <div className="text-[8px] tracking-[0.2em]" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>折</div>
                                        <div className="text-[26px] leading-none font-black" style={{ color: INK }}>{z.no}</div>
                                        <div className="text-[7px] mt-1" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>No.{i + 1}</div>
                                    </div>

                                    {/* 邮票图标 */}
                                    <Stamp size={46} className="self-center">
                                        <z.Icon size={24} weight="duotone" />
                                    </Stamp>

                                    {/* 折名 + 戏文 + 介绍 */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-baseline gap-2">
                                            <div className="text-[21px] font-black tracking-wide" style={{ color: INK }}>{z.name}</div>
                                            <div className="text-[8px] tracking-[0.28em] uppercase truncate" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>{z.en}</div>
                                        </div>
                                        <div className="text-[12px] font-bold mt-0.5" style={{ color: '#4a463e' }}>「{z.tagline}」</div>
                                        <div className="text-[11px] mt-1.5 leading-relaxed" style={{ color: '#6b6558' }}>{z.desc}</div>
                                    </div>

                                    {/* 开演 */}
                                    <div className="shrink-0 self-center flex flex-col items-center gap-1" style={{ color: INK }}>
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
                                        <span className="text-[8px] tracking-[0.16em]" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>OPEN</span>
                                    </div>
                                </div>
                            </PaperCard>
                        );
                    })}
                </div>

                {/* 落款 */}
                <div className="mt-8 text-center text-[9px] tracking-[0.34em]" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>— 散 场 不 谢 幕 —</div>
            </ScrapScroll>
        </PaperShell>
    );
};

export default TheaterApp;
