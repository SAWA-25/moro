import React, { useState } from 'react';
import { useOS } from '../context/OSContext';
import { CalendarHeart, SealCheck, Sparkle, Heart } from '@phosphor-icons/react';
import ScheduleApp from './ScheduleApp';
import { SpecialMomentsApp } from '../components/ValentineEvent';

/**
 * 岁时记：原「时光契约」（日程 / 心愿单 / 纪念日倒数，apps/ScheduleApp.tsx）与
 * 「特别时光」（情人节 / 白色情人节 / 520 等节日记忆活动，components/ValentineEvent.tsx
 * 的 SpecialMomentsApp）的统一入口。桌面只保留一个「岁时记」图标，点开是封面页，
 * 先翻到哪一页：
 *   - 时光契约 → 记心愿、立约定、数着纪念日的倒计时
 *   - 特别时光 → 节日里和角色一起留下的那些瞬间
 * 两个子页通过 onExit 回到本封面页（不直接回桌面）。两边各自保留玩法、数据与名字，
 * 合并后只占一个入口。
 */

const AlmanacApp: React.FC = () => {
    const { closeApp } = useOS();
    const [section, setSection] = useState<'home' | 'schedule' | 'moments'>('home');

    if (section === 'schedule') return <ScheduleApp onExit={() => setSection('home')} />;
    if (section === 'moments') return <SpecialMomentsApp onExit={() => setSection('home')} />;

    return (
        <div
            className="absolute inset-0 flex flex-col bg-[#fbf3f1] text-[#4a3942] animate-fade-in overflow-hidden"
            style={{ paddingTop: 'var(--safe-top)' }}
        >
            {/* 暖色氛围 */}
            <div aria-hidden className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-[140%] h-72 rounded-full blur-3xl opacity-50 bg-gradient-to-b from-rose-200/70 via-amber-100/40 to-transparent" />

            {/* 顶栏：回桌面 + 居中小字 */}
            <div className="relative flex items-center px-4 pt-3 pb-2 shrink-0 z-10">
                <button
                    onClick={closeApp}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-[11px] font-bold bg-white/70 hover:bg-white text-[#a87a86] active:scale-95 transition-all shadow-sm border border-rose-100"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-3.5 h-3.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
                    </svg>
                    回桌面
                </button>
                <div className="absolute left-1/2 -translate-x-1/2 text-center select-none">
                    <div className="text-[9px] tracking-[0.35em] text-[#a87a86]/60 font-mono">ALMANAC</div>
                    <div className="text-[11px] tracking-[0.3em] text-[#a87a86]/70 mt-0.5">翻 一 页</div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto no-scrollbar px-5 pb-10 space-y-6 pt-3 z-10">
                {/* 封面：岁时记招牌 */}
                <div className="relative rounded-3xl px-7 py-8 select-none overflow-hidden border border-rose-100 bg-white/70 shadow-[0_8px_30px_rgba(190,120,140,0.12)]">
                    <div className="text-[9px] tracking-[0.3em] text-rose-400/70 font-mono mb-2">岁 时 记 · 日子里的小事</div>
                    <div className="flex items-end gap-3">
                        <div className="text-5xl font-black tracking-wide bg-clip-text text-transparent bg-gradient-to-r from-rose-400 via-pink-400 to-amber-400">岁时记</div>
                        <CalendarHeart size={30} weight="fill" className="mb-2 text-rose-400/90 rotate-[-6deg]" />
                    </div>
                    <div className="text-[13px] text-[#7a606a] mt-2 leading-relaxed">把约定、倒数的日子，和节日里的那些瞬间，都收进同一本册子。</div>
                    <Sparkle size={18} weight="fill" className="absolute top-4 right-5 text-amber-300/70" />
                </div>

                {/* 时光契约 */}
                <button
                    onClick={() => setSection('schedule')}
                    className="relative w-full text-left rounded-3xl px-7 py-9 overflow-hidden border border-cyan-200/50 bg-gradient-to-br from-cyan-50 to-teal-50/60 active:scale-[0.98] transition-transform select-none shadow-sm"
                >
                    <div className="text-[9px] tracking-[0.3em] text-cyan-600/70 font-mono mb-2">PROMISE — 记下约定</div>
                    <div className="flex items-center gap-2.5">
                        <SealCheck size={26} weight="bold" className="text-cyan-600/90" />
                        <div className="text-3xl font-black tracking-wide text-cyan-800">时光契约</div>
                    </div>
                    <div className="text-[11px] text-[#5a7077] mt-3 leading-relaxed">立心愿、记任务、数着纪念日的倒计时，让角色陪你把日子过成约定。</div>
                    <SealCheck size={64} weight="fill" className="absolute -bottom-3 -right-2 text-cyan-300/15 rotate-[12deg]" />
                </button>

                {/* 特别时光 */}
                <button
                    onClick={() => setSection('moments')}
                    className="relative w-full text-left rounded-3xl px-7 py-9 overflow-hidden border border-rose-200/60 bg-gradient-to-br from-rose-50 to-pink-50/70 active:scale-[0.98] transition-transform select-none shadow-sm"
                >
                    <div className="text-[9px] tracking-[0.3em] text-rose-500/70 font-mono mb-2">MOMENTS — 节日的瞬间</div>
                    <div className="flex items-center gap-2.5">
                        <Sparkle size={26} weight="bold" className="text-rose-500/90" />
                        <div className="text-3xl font-black tracking-wide text-rose-700">特别时光</div>
                    </div>
                    <div className="text-[11px] text-[#8a606a] mt-3 leading-relaxed">情人节、白色情人节、520……节日里和角色一起留下的那些特别瞬间，随时回看。</div>
                    <Heart size={64} weight="fill" className="absolute -bottom-3 -right-2 text-rose-300/20 rotate-[-12deg]" />
                </button>
            </div>
        </div>
    );
};

export default AlmanacApp;
