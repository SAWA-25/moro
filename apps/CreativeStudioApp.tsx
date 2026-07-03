import React, { useState } from 'react';
import { useOS } from '../context/OSContext';
import { PenNib, MusicNotes, Feather } from '@phosphor-icons/react';
import NovelApp from './NovelApp';
import SongwritingApp from './SongwritingApp';
import { INK, PAPER, PAPER_CARD, HAND, BRUSH, DOT_BG, BARCODE_BG, Tape, BackSticker } from './creative/collage';

/**
 * 创作社：原「笔友会」（共创小说，apps/NovelApp.tsx）与「写歌」（共创歌曲，
 * apps/SongwritingApp.tsx）的统一入口。桌面只保留一个「创作社」图标，点开是
 * 封面页，先挑一桌坐：
 *   - PROSE 笔友会 → 与角色共创小说
 *   - LYRIC 写歌   → 与角色共创歌曲
 * 两个子页通过 onExit 回到本封面页（不直接回桌面）。两边都吃同一套角色名册 /
 * AI 配置 / 共创者概念，合并后只占一个入口。
 * 视觉统一走 apps/creative/collage.tsx 的「黑白拼贴手账」设计系统。
 */

const CreativeStudioApp: React.FC = () => {
    const { closeApp } = useOS();
    const [section, setSection] = useState<'home' | 'novel' | 'song'>('home');

    if (section === 'novel') return <NovelApp onExit={() => setSection('home')} />;
    if (section === 'song') return <SongwritingApp onExit={() => setSection('home')} />;

    return (
        <div
            className="absolute inset-0 flex flex-col text-[#1c1b1a] animate-fade-in"
            style={{ background: PAPER, ...DOT_BG }}
        >
            {/* 顶栏：回桌面贴纸 + 居中小字 */}
            <div className="relative flex items-center px-4 pt-3 pb-2 shrink-0">
                <BackSticker onClick={closeApp} label="回桌面" />
                <div className="absolute left-1/2 -translate-x-1/2 text-center select-none">
                    <div className="label-mono text-[9px] text-[#1c1b1a]/45">PAPER &amp; INK</div>
                    <div className="text-[11px] tracking-[0.3em] text-[#1c1b1a]/45 mt-0.5">挑 一 桌 坐</div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto no-scrollbar px-4 pb-10 space-y-6 pt-2">
                {/* 封面：撕边大卡 + 胶带 + 条形码 */}
                <div className="relative px-7 py-8 select-none rotate-[-0.5deg]" style={{ background: PAPER_CARD, borderRadius: 24, border: '1px solid rgba(0,0,0,0.05)', boxShadow: '0 1px 2px rgba(38,36,42,0.04), 0 22px 44px -26px rgba(38,36,42,0.35)' }}>
                    <Tape className="-top-2.5 left-1/2 -translate-x-1/2 rotate-[-3deg] w-20" />
                    <div className="label-mono text-[9px] text-[#1c1b1a]/45 mb-2">CREATIVE GUILD · 黑白拼贴</div>
                    <div className="flex items-end gap-3">
                        <div className="text-5xl font-black tracking-wide leading-none" style={BRUSH}>创作社</div>
                        <Feather size={26} weight="bold" color={INK} className="mb-1 rotate-[-12deg]" />
                    </div>
                    <div className="text-[15px] text-[#1c1b1a]/55 mt-3" style={HAND}>找个角色搭把手，写本书，或者凑首歌。</div>
                    <div aria-hidden className="absolute bottom-4 right-6 w-20 h-6 opacity-50" style={BARCODE_BG} />
                </div>

                {/* PROSE 笔友会（共创小说） */}
                <button
                    onClick={() => setSection('novel')}
                    className="relative w-full bg-white px-7 py-10 text-left press-soft select-none rotate-[0.6deg]"
                    style={{ borderRadius: 22, border: '1px solid rgba(0,0,0,0.05)', boxShadow: '0 1px 2px rgba(38,36,42,0.04), 0 18px 38px -24px rgba(38,36,42,0.32)' }}
                >
                    <Tape className="-top-2.5 left-8 rotate-[4deg] w-14" />
                    <div className="label-mono text-[9px] text-[#1c1b1a]/45 mb-2">PROSE — 一起写本书</div>
                    <div className="text-4xl font-black tracking-wide" style={BRUSH}>笔友会</div>
                    <div className="text-[12px] text-[#1c1b1a]/55 mt-3 leading-relaxed" style={HAND}>和角色接力共创小说：设世界观、排剧中人、轮流落笔成稿</div>
                    <PenNib className="absolute bottom-5 right-5 w-10 h-10 text-[#1c1b1a]/30 rotate-[8deg]" weight="bold" />
                    <span aria-hidden className="absolute top-3 right-4 w-8 h-8 rounded-full border-2 border-dashed border-[#1c1b1a]/40 rotate-[10deg] flex items-center justify-center label-mono text-[7px] text-[#1c1b1a]/50">书</span>
                </button>

                {/* LYRIC 写歌（共创歌曲） */}
                <button
                    onClick={() => setSection('song')}
                    className="relative w-full bg-white px-7 py-10 text-left press-soft select-none rotate-[-0.6deg]"
                    style={{ borderRadius: 22, border: '1px solid rgba(0,0,0,0.05)', boxShadow: '0 1px 2px rgba(38,36,42,0.04), 0 18px 38px -24px rgba(38,36,42,0.32)' }}
                >
                    <Tape className="-top-2.5 right-8 rotate-[-4deg] w-14" />
                    <div className="label-mono text-[9px] text-[#1c1b1a]/45 mb-2">LYRIC — 一起凑首歌</div>
                    <div className="text-4xl font-black tracking-wide" style={BRUSH}>写歌</div>
                    <div className="text-[12px] text-[#1c1b1a]/55 mt-3 leading-relaxed" style={HAND}>找角色当词曲搭子：定调子、攒歌词、出整首歌投进音乐库</div>
                    <MusicNotes className="absolute bottom-5 right-5 w-10 h-10 text-[#1c1b1a]/30 rotate-[-8deg]" weight="bold" />
                    <span aria-hidden className="absolute top-3 right-4 w-8 h-8 rounded-full border-2 border-dashed border-[#1c1b1a]/40 rotate-[-10deg] flex items-center justify-center label-mono text-[7px] text-[#1c1b1a]/50">歌</span>
                </button>
            </div>
        </div>
    );
};

export default CreativeStudioApp;
