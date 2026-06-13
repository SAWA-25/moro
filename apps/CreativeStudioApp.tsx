import React, { useState } from 'react';
import { useOS } from '../context/OSContext';
import { PenNib, MusicNotes, Feather } from '@phosphor-icons/react';
import NovelApp from './NovelApp';
import SongwritingApp from './SongwritingApp';

/**
 * 创作社：原「笔友会」（共创小说，apps/NovelApp.tsx）与「写歌」（共创歌曲，
 * apps/SongwritingApp.tsx）的统一入口。桌面只保留一个「创作社」图标，点开是
 * 封面页，先挑一桌坐：
 *   - PROSE 笔友会 → 与角色共创小说
 *   - LYRIC 写歌   → 与角色共创歌曲
 * 两个子页通过 onExit 回到本封面页（不直接回桌面）。两边都吃同一套角色名册 /
 * AI 配置 / 共创者概念，合并后只占一个入口。
 */

const INK = '#1c1b1a';
const STICKER = 'border-2 border-[#1c1b1a] bg-white shadow-[2px_2px_0_#1c1b1a] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all';
const HAND_CN: React.CSSProperties = { fontFamily: "'Long Cang', 'Caveat', cursive" };
const DOT_BG: React.CSSProperties = {
    backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(28,27,26,0.10) 1px, transparent 0)',
    backgroundSize: '16px 16px',
};
const BARCODE_BG: React.CSSProperties = {
    backgroundImage: 'repeating-linear-gradient(90deg, #1c1b1a 0 2px, transparent 2px 4px, #1c1b1a 4px 5px, transparent 5px 9px, #1c1b1a 9px 12px, transparent 12px 14px)',
};

const Tape: React.FC<{ className?: string }> = ({ className }) => (
    <div
        aria-hidden
        className={`pointer-events-none absolute h-5 w-16 bg-white/60 border-x border-dashed border-[#1c1b1a]/30 shadow-sm backdrop-blur-[1px] ${className || ''}`}
    />
);

const CreativeStudioApp: React.FC = () => {
    const { closeApp } = useOS();
    const [section, setSection] = useState<'home' | 'novel' | 'song'>('home');

    if (section === 'novel') return <NovelApp onExit={() => setSection('home')} />;
    if (section === 'song') return <SongwritingApp onExit={() => setSection('home')} />;

    return (
        <div
            className="absolute inset-0 flex flex-col bg-[#f2f0e9] text-[#1c1b1a] animate-fade-in"
            style={{ ...DOT_BG, paddingTop: 'var(--safe-top)' }}
        >
            {/* 顶栏：回桌面贴纸 + 居中小字 */}
            <div className="relative flex items-center px-4 pt-3 pb-2 shrink-0">
                <button
                    onClick={closeApp}
                    className={`inline-flex items-center gap-1.5 px-3 py-2 rotate-[-2deg] text-[10px] font-black ${STICKER}`}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-3.5 h-3.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
                    </svg>
                    回桌面
                </button>
                <div className="absolute left-1/2 -translate-x-1/2 text-center select-none">
                    <div className="label-mono text-[9px] text-[#1c1b1a]/45">PAPER &amp; INK</div>
                    <div className="text-[11px] tracking-[0.3em] text-[#1c1b1a]/45 mt-0.5">挑 一 桌 坐</div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto no-scrollbar px-4 pb-10 space-y-6 pt-2">
                {/* 封面：撕边大卡 + 胶带 + 条形码 */}
                <div className="relative bg-[#fbfaf6] border-2 border-[#1c1b1a] shadow-[5px_5px_0_#1c1b1a] px-7 py-8 select-none rotate-[-0.5deg]">
                    <Tape className="-top-2.5 left-1/2 -translate-x-1/2 rotate-[-3deg] w-20" />
                    <div className="label-mono text-[9px] text-[#1c1b1a]/45 mb-2">CREATIVE GUILD · 黑白拼贴</div>
                    <div className="flex items-end gap-3">
                        <div className="font-display-italic text-5xl font-semibold tracking-wide">创作社</div>
                        <Feather size={26} weight="bold" color={INK} className="mb-2 rotate-[-12deg]" />
                    </div>
                    <div className="text-[14px] text-[#1c1b1a]/55 mt-2" style={HAND_CN}>找个角色搭把手，写本书，或者凑首歌。</div>
                    <div aria-hidden className="absolute bottom-4 right-6 w-20 h-6 opacity-50" style={BARCODE_BG} />
                </div>

                {/* PROSE 笔友会（共创小说） */}
                <button
                    onClick={() => setSection('novel')}
                    className="relative w-full bg-white border-2 border-[#1c1b1a] shadow-[4px_4px_0_#1c1b1a] px-7 py-10 text-left active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all select-none rotate-[0.6deg]"
                >
                    <Tape className="-top-2.5 left-8 rotate-[4deg] w-14" />
                    <div className="label-mono text-[9px] text-[#1c1b1a]/45 mb-2">PROSE — 一起写本书</div>
                    <div className="font-display-italic text-4xl font-semibold tracking-wide">笔友会</div>
                    <div className="text-[11px] text-[#1c1b1a]/55 mt-3 leading-relaxed">和角色接力共创小说：设世界观、排剧中人、轮流落笔成稿</div>
                    <PenNib className="absolute bottom-5 right-5 w-10 h-10 text-[#1c1b1a]/30 rotate-[8deg]" weight="bold" />
                    <span aria-hidden className="absolute top-3 right-4 w-8 h-8 rounded-full border-2 border-dashed border-[#1c1b1a]/40 rotate-[10deg] flex items-center justify-center label-mono text-[7px] text-[#1c1b1a]/50">书</span>
                </button>

                {/* LYRIC 写歌（共创歌曲） */}
                <button
                    onClick={() => setSection('song')}
                    className="relative w-full bg-white border-2 border-[#1c1b1a] shadow-[4px_4px_0_#1c1b1a] px-7 py-10 text-left active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all select-none rotate-[-0.6deg]"
                >
                    <Tape className="-top-2.5 right-8 rotate-[-4deg] w-14" />
                    <div className="label-mono text-[9px] text-[#1c1b1a]/45 mb-2">LYRIC — 一起凑首歌</div>
                    <div className="font-display-italic text-4xl font-semibold tracking-wide">写歌</div>
                    <div className="text-[11px] text-[#1c1b1a]/55 mt-3 leading-relaxed">找角色当词曲搭子：定调子、攒歌词、出整首歌投进音乐库</div>
                    <MusicNotes className="absolute bottom-5 right-5 w-10 h-10 text-[#1c1b1a]/30 rotate-[-8deg]" weight="bold" />
                    <span aria-hidden className="absolute top-3 right-4 w-8 h-8 rounded-full border-2 border-dashed border-[#1c1b1a]/40 rotate-[-10deg] flex items-center justify-center label-mono text-[7px] text-[#1c1b1a]/50">歌</span>
                </button>
            </div>
        </div>
    );
};

export default CreativeStudioApp;
