import React, { useState, useEffect } from 'react';
import { useOS } from '../context/OSContext';
import CardMode from './harem/CardMode';
import StoryMode from './harem/StoryMode';
import {
    PaperBackdrop, ScrapHeader, PaperCard, WashiTape, ScrapButton, SectionTag, Stamp,
    INK, INK_SOFT, PAPER, PAGE_BG, HALFTONE,
} from './theater/scrapbook';
import { Crown, BookOpen, Cardholder, CaretRight } from '@phosphor-icons/react';

type Mode = 'story' | 'card';
const MODE_KEY = 'moro_harem_mode';
const STORY_LIVE = 'moro_harem_story';
const CARD_LIVE = 'moro_harem_game';

/**
 * 椒房记入口：选「文游模式」(AI 实时生成后宫恋爱剧情) 或「经营模式」(翻牌养成)。
 * 两套玩法各自独立存档，互不干扰。返回键回到这张戏单。
 */
const HaremApp: React.FC = () => {
    const { closeApp } = useOS();
    const [mode, setMode] = useState<Mode | null>(null);
    const [hasStory, setHasStory] = useState(false);
    const [hasCard, setHasCard] = useState(false);

    useEffect(() => {
        try {
            setHasStory(!!localStorage.getItem(STORY_LIVE));
            setHasCard(!!localStorage.getItem(CARD_LIVE));
            const last = localStorage.getItem(MODE_KEY);
            if (last === 'story' || last === 'card') { /* 仅记住，不自动进入，留在戏单让玩家选 */ }
        } catch { /* ignore */ }
    }, []);

    const enter = (m: Mode) => { try { localStorage.setItem(MODE_KEY, m); } catch { /* ignore */ } setMode(m); };
    const back = () => setMode(null);

    if (mode === 'story') return <StoryMode onBack={back} />;
    if (mode === 'card') return <CardMode onBack={back} />;

    // ───────── 戏单：择玩法 ─────────
    return (
        <div className="relative h-full w-full flex flex-col overflow-hidden animate-fade-in" style={{ color: INK, background: PAGE_BG }}>
            <PaperBackdrop />
            <ScrapHeader title="椒房记" en="THE PEPPER HALL" onBack={closeApp} />
            <div className="relative z-10 flex-1 overflow-y-auto no-scrollbar px-4 pb-4">
                <div className="relative px-5 py-5 mb-5 text-center overflow-hidden" style={heroPanel}>
                    <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.07]" style={{ backgroundImage: HALFTONE, backgroundSize: '7px 7px' }} />
                    <WashiTape color="ink" rotate={-4} className="absolute -top-2.5 left-1/2 -translate-x-1/2 w-24 h-5 rounded-[2px]" />
                    <Crown size={36} weight="fill" className="relative mx-auto mb-2" style={{ color: INK }} />
                    <div className="relative text-[15px] font-black tracking-wide" style={{ color: INK }}>椒 房 记</div>
                    <p className="relative text-[11.5px] mt-1.5 leading-relaxed" style={{ color: '#54504a' }}>选一种方式，开启你的后宫。<br />两套玩法各自存档，互不相扰。</p>
                </div>

                <SectionTag en="CHOOSE A WAY TO PLAY" className="mb-3">择玩法</SectionTag>

                <ModeCard
                    onClick={() => enter('story')}
                    tape
                    icon={<BookOpen size={26} weight="fill" />}
                    title="文游模式"
                    en="A HAREM TALE · AI"
                    desc="一卷由 AI 现写的后宫恋爱文字游戏。每一回合实时生成剧情与对白，给你 3 个选择；好感·信任·嫉妒·记忆随抉择而变，剧情顺你而长，绝不重来同一段。含长期记忆 / 角色独立记忆 / 多周目。"
                    badge={hasStory ? '有进度' : '新'}
                />
                <div className="h-3" />
                <ModeCard
                    onClick={() => enter('card')}
                    icon={<Cardholder size={26} weight="fill" />}
                    title="经营模式"
                    en="THE PEPPER HALL · CARDS"
                    desc="翻牌养成的后宫经营：择妃组宫，日日打文字卡（同游 / 夜话 / 赐礼 / 独宠…）涨宠爱晋位分，夜夜应对争宠 / 吃醋 / 谗言等宫闱事件，开枝散叶、封笔修史。"
                    badge={hasCard ? '有进度' : '新'}
                />
                <div className="h-2" />
            </div>
        </div>
    );
};

const ModeCard: React.FC<{ onClick: () => void; icon: React.ReactNode; title: string; en: string; desc: string; badge?: string; tape?: boolean }> = ({ onClick, icon, title, en, desc, badge, tape }) => (
    <button onClick={onClick} className="w-full text-left active:scale-[0.985] transition-transform">
        <PaperCard className="relative px-4 py-4 overflow-hidden">
            {tape && <WashiTape color="butter" rotate={-3} className="absolute -top-2 right-6 w-16 h-4 rounded-[2px]" />}
            <div className="flex items-start gap-3">
                <Stamp color="ink" size={48}>{icon}</Stamp>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="text-[16px] font-black" style={{ color: INK }}>{title}</span>
                        {badge && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold" style={{ background: badge === '有进度' ? INK : 'rgba(31,29,26,0.1)', color: badge === '有进度' ? PAPER : INK_SOFT }}>{badge}</span>}
                        <CaretRight size={16} weight="bold" className="ml-auto" style={{ color: INK_SOFT }} />
                    </div>
                    <div className="text-[8px] tracking-[0.3em] uppercase mt-0.5" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>{en}</div>
                    <p className="text-[11.5px] leading-relaxed mt-2" style={{ color: '#54504a' }}>{desc}</p>
                </div>
            </div>
        </PaperCard>
    </button>
);

const heroPanel: React.CSSProperties = {
    background: 'linear-gradient(180deg,#fbf9f2,#f1eee4)',
    border: '1px solid rgba(176,170,158,0.7)', outline: '1px dashed rgba(150,144,132,0.5)', outlineOffset: '-5px',
    borderRadius: 18, boxShadow: '0 14px 28px -18px rgba(31,29,26,0.5)',
};

export default HaremApp;
