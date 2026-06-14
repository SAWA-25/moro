import React, { useState } from 'react';
import { useOS } from '../context/OSContext';
import { MaskHappy, Crosshair, GameController, Heart, Sparkle, Footprints, Users, ChatCircleDots } from '@phosphor-icons/react';
import GuidebookApp from './GuidebookApp';
import GameApp from './GameApp';
import TrajectoryApp from './theater/TrajectoryApp';
import ReflectionApp from './theater/ReflectionApp';
import TalkTherapyApp from './theater/TalkTherapyApp';

/**
 * 小剧场：原「攻略本」（galgame 恋爱攻略，apps/GuidebookApp.tsx）与「TRPG」（跑团
 * 冒险，apps/GameApp.tsx）的统一入口。桌面只保留一个「小剧场」图标，点开是封面页，
 * 先挑一出戏：
 *   - 攻略本 → 和角色谈一场有回合、有好感度的恋爱小游戏
 *   - TRPG  → 拉上熟人开团，世界观 + 骰子 + 自由行动的跑团冒险
 * 两个子页通过 onExit 回到本封面页（不直接回桌面）。两边各自保留玩法、数据与名字，
 * 合并后只占一个入口。
 */

const TheaterApp: React.FC = () => {
    const { closeApp } = useOS();
    const [section, setSection] = useState<'home' | 'guide' | 'trpg' | 'trajectory' | 'reflection' | 'talk'>('home');

    if (section === 'guide') return <GuidebookApp onExit={() => setSection('home')} />;
    if (section === 'trpg') return <GameApp onExit={() => setSection('home')} />;
    if (section === 'trajectory') return <TrajectoryApp onExit={() => setSection('home')} />;
    if (section === 'reflection') return <ReflectionApp onExit={() => setSection('home')} />;
    if (section === 'talk') return <TalkTherapyApp onExit={() => setSection('home')} />;

    return (
        <div
            className="absolute inset-0 flex flex-col bg-[#14101c] text-white animate-fade-in overflow-hidden"
            style={{ paddingTop: 'var(--safe-top)' }}
        >
            {/* 舞台暖光氛围 */}
            <div aria-hidden className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-[140%] h-72 rounded-full blur-3xl opacity-40 bg-gradient-to-b from-amber-400/50 via-rose-500/20 to-transparent" />
            <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.06]" style={{ backgroundImage: 'repeating-linear-gradient(90deg, #fff 0 1px, transparent 1px 14px)' }} />

            {/* 顶栏：回桌面 + 居中小字 */}
            <div className="relative flex items-center px-4 pt-3 pb-2 shrink-0 z-10">
                <button
                    onClick={closeApp}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-[11px] font-bold bg-white/10 hover:bg-white/15 text-white/80 active:scale-95 transition-all backdrop-blur-sm border border-white/10"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-3.5 h-3.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
                    </svg>
                    回桌面
                </button>
                <div className="absolute left-1/2 -translate-x-1/2 text-center select-none">
                    <div className="text-[9px] tracking-[0.35em] text-white/40 font-mono">LITTLE THEATER</div>
                    <div className="text-[11px] tracking-[0.3em] text-white/45 mt-0.5">挑 一 出 戏</div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto no-scrollbar px-5 pb-10 space-y-6 pt-3 z-10">
                {/* 封面：剧场招牌 */}
                <div className="relative rounded-3xl px-7 py-8 select-none overflow-hidden border border-white/10 bg-gradient-to-br from-white/[0.08] to-white/[0.02] shadow-2xl">
                    <div className="text-[9px] tracking-[0.3em] text-amber-300/70 font-mono mb-2">TONIGHT'S PROGRAMME · 今夜上演</div>
                    <div className="flex items-end gap-3">
                        <div className="text-5xl font-black tracking-wide bg-clip-text text-transparent bg-gradient-to-r from-amber-200 via-rose-200 to-amber-300">小剧场</div>
                        <MaskHappy size={30} weight="fill" className="mb-2 text-amber-300/90 rotate-[-8deg]" />
                    </div>
                    <div className="text-[13px] text-white/55 mt-2 leading-relaxed">找个角色登台，演一场恋爱攻略，或者拉队开一局跑团。</div>
                    <Sparkle size={18} weight="fill" className="absolute top-4 right-5 text-amber-300/40" />
                </div>

                {/* 攻略本 */}
                <button
                    onClick={() => setSection('guide')}
                    className="relative w-full text-left rounded-3xl px-7 py-9 overflow-hidden border border-rose-300/15 bg-gradient-to-br from-rose-500/15 to-fuchsia-500/[0.07] active:scale-[0.98] transition-transform select-none shadow-lg"
                >
                    <div className="text-[9px] tracking-[0.3em] text-rose-200/70 font-mono mb-2">DATE — 谈一场恋爱</div>
                    <div className="flex items-center gap-2.5">
                        <Crosshair size={26} weight="bold" className="text-rose-200/90" />
                        <div className="text-3xl font-black tracking-wide text-rose-50">攻略本</div>
                    </div>
                    <div className="text-[11px] text-white/55 mt-3 leading-relaxed">和角色玩一局 galgame：定场景、挑选项、攒好感度，结局生成攻略结算卡。</div>
                    <Heart size={64} weight="fill" className="absolute -bottom-3 -right-2 text-rose-300/10 rotate-[12deg]" />
                </button>

                {/* 谈心 */}
                <button
                    onClick={() => setSection('talk')}
                    className="relative w-full text-left rounded-3xl px-7 py-9 overflow-hidden border border-pink-300/15 bg-gradient-to-br from-pink-500/15 to-violet-500/[0.07] active:scale-[0.98] transition-transform select-none shadow-lg"
                >
                    <div className="text-[9px] tracking-[0.3em] text-pink-200/70 font-mono mb-2">HEART-TO-HEART — 好好被听一次</div>
                    <div className="flex items-center gap-2.5">
                        <ChatCircleDots size={26} weight="bold" className="text-pink-200/90" />
                        <div className="text-3xl font-black tracking-wide text-pink-50">谈心</div>
                    </div>
                    <div className="text-[11px] text-white/55 mt-3 leading-relaxed">心里堵得慌时，找个角色把话放下来。这里只负责好好听你说、轻轻抱住你——一个被美化过的、安全的安慰角落。</div>
                    <Heart size={64} weight="fill" className="absolute -bottom-3 -right-2 text-pink-300/10 rotate-[10deg]" />
                </button>

                {/* TRPG */}
                <button
                    onClick={() => setSection('trpg')}
                    className="relative w-full text-left rounded-3xl px-7 py-9 overflow-hidden border border-purple-300/15 bg-gradient-to-br from-purple-500/15 to-indigo-500/[0.07] active:scale-[0.98] transition-transform select-none shadow-lg"
                >
                    <div className="text-[9px] tracking-[0.3em] text-purple-200/70 font-mono mb-2">TRPG — 开一局跑团</div>
                    <div className="flex items-center gap-2.5">
                        <GameController size={26} weight="bold" className="text-purple-200/90" />
                        <div className="text-3xl font-black tracking-wide text-purple-50">TRPG</div>
                    </div>
                    <div className="text-[11px] text-white/55 mt-3 leading-relaxed">拉上熟人开团：AI 生成世界观、骰子判定、自由行动，剧情可转发回聊天一起回味。</div>
                    <GameController size={64} weight="fill" className="absolute -bottom-3 -right-2 text-purple-300/10 rotate-[-12deg]" />
                </button>

                {/* 轨迹 */}
                <button
                    onClick={() => setSection('trajectory')}
                    className="relative w-full text-left rounded-3xl px-7 py-9 overflow-hidden border border-indigo-300/15 bg-gradient-to-br from-indigo-500/15 to-violet-500/[0.07] active:scale-[0.98] transition-transform select-none shadow-lg"
                >
                    <div className="text-[9px] tracking-[0.3em] text-indigo-200/70 font-mono mb-2">TRAJECTORY — 那些还未曾相遇的日子</div>
                    <div className="flex items-center gap-2.5">
                        <Footprints size={26} weight="bold" className="text-indigo-200/90" />
                        <div className="text-3xl font-black tracking-wide text-indigo-50">轨迹</div>
                    </div>
                    <div className="text-[11px] text-white/55 mt-3 leading-relaxed">回到过去的时间节点，看看角色原本走过的路——一个人不是从被看见的那一刻才开始存在的。也看见你是从什么时候，慢慢走进 TA 的人生。</div>
                    <Footprints size={64} weight="fill" className="absolute -bottom-3 -right-2 text-indigo-300/10 rotate-[12deg]" />
                </button>

                {/* 对影 */}
                <button
                    onClick={() => setSection('reflection')}
                    className="relative w-full text-left rounded-3xl px-7 py-9 overflow-hidden border border-amber-300/15 bg-gradient-to-br from-amber-500/15 to-rose-500/[0.07] active:scale-[0.98] transition-transform select-none shadow-lg"
                >
                    <div className="text-[9px] tracking-[0.3em] text-amber-200/70 font-mono mb-2">REFLECTION — 对影成几人</div>
                    <div className="flex items-center gap-2.5">
                        <Users size={26} weight="bold" className="text-amber-200/90" />
                        <div className="text-3xl font-black tracking-wide text-amber-50">对影</div>
                    </div>
                    <div className="text-[11px] text-white/55 mt-3 leading-relaxed">同一个人，在不同时间里的相逢。看见 TA 并非突然变成今天的样子，也看见——是谁让命运偏离过原本的方向。举杯邀明月，对影成几人。</div>
                    <Users size={64} weight="fill" className="absolute -bottom-3 -right-2 text-amber-300/10 rotate-[-12deg]" />
                </button>
            </div>
        </div>
    );
};

export default TheaterApp;
