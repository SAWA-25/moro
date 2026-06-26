import React, { useState } from 'react';
import { useOS } from '../context/OSContext';
import { MaskHappy, UserFocus, Scissors } from '@phosphor-icons/react';
import Character from './Character';
import PersonaApp from './PersonaApp';

/**
 * 剪影集：原「神经链接」（角色档案，apps/Character.tsx）与「扮相手账」（用户人设，
 * apps/PersonaApp.tsx）的统一入口。桌面只保留一个「剪影集」图标，点开是黑白拼贴
 * 手账风的封面页，先翻一边：
 *   - CAST  登场人物 → 角色管理/编辑器
 *   - GUISE 扮相手账 → 用户人设管理
 * 两个子页通过 onExit 回到本封面页（不直接回桌面）。
 */

const INK = '#26242a';
const CARD = 'bg-white press-soft';
const CARD_STYLE: React.CSSProperties = { borderRadius: 22, border: '1px solid rgba(0,0,0,0.05)', boxShadow: '0 1px 2px rgba(38,36,42,0.04), 0 18px 38px -24px rgba(38,36,42,0.32)' };
const STICKER = 'rounded-full bg-white press-soft border border-black/[0.05] shadow-[0_6px_16px_-8px_rgba(38,36,42,0.35)]';
const HAND_CN: React.CSSProperties = { fontFamily: "'Long Cang', 'Caveat', cursive" };
const DOT_BG: React.CSSProperties = { background: 'radial-gradient(120% 80% at 50% -10%, rgba(139,92,246,0.06), transparent 60%)' };
const BARCODE_BG: React.CSSProperties = {
    backgroundImage: 'repeating-linear-gradient(90deg, rgba(38,36,42,0.5) 0 2px, transparent 2px 4px, rgba(38,36,42,0.5) 4px 5px, transparent 5px 9px, rgba(38,36,42,0.5) 9px 12px, transparent 12px 14px)',
};

const Tape: React.FC<{ className?: string }> = ({ className }) => (
    <div aria-hidden className={`pointer-events-none absolute h-5 w-16 ${className || ''}`}
        style={{ background: 'rgba(255,255,255,0.75)', backgroundImage: 'repeating-linear-gradient(90deg, rgba(255,255,255,0.4) 0 5px, transparent 5px 11px)', borderRadius: 2, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }} />
);

const PersonaHubApp: React.FC = () => {
    const { closeApp } = useOS();
    const [section, setSection] = useState<'library' | 'char' | 'user'>('library');

    if (section === 'char') return <Character onExit={() => setSection('library')} />;
    if (section === 'user') return <PersonaApp onExit={() => setSection('library')} />;

    return (
        <div
            className="absolute inset-0 flex flex-col text-[#26242a] animate-fade-in"
            style={{ background: '#f7f5f2', ...DOT_BG, paddingTop: 'var(--safe-top)' }}
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
                    <div className="text-[11px] tracking-[0.3em] text-[#1c1b1a]/45 mt-0.5">先 翻 一 边</div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto no-scrollbar px-4 pb-10 space-y-6 pt-2">
                {/* 封面：撕边大卡 + 胶带 + 条形码 */}
                <div className="relative bg-white px-7 py-8 select-none rotate-[-0.5deg]" style={{ borderRadius: 24, border: '1px solid rgba(0,0,0,0.05)', boxShadow: '0 1px 2px rgba(38,36,42,0.04), 0 22px 44px -26px rgba(38,36,42,0.35)' }}>
                    <Tape className="-top-2.5 left-1/2 -translate-x-1/2 rotate-[-3deg] w-20" />
                    <div className="label-mono text-[9px] text-[#1c1b1a]/45 mb-2">SILHOUETTE SCRAPBOOK · 黑白拼贴</div>
                    <div className="flex items-end gap-3">
                        <div className="font-display-italic text-5xl font-semibold tracking-wide">剪影集</div>
                        <Scissors size={26} weight="bold" color={INK} className="mb-2 rotate-[-12deg]" />
                    </div>
                    <div className="text-[14px] text-[#1c1b1a]/55 mt-2" style={HAND_CN}>对面的人，和镜子里的你，都剪一份贴进来。</div>
                    <div aria-hidden className="absolute bottom-4 right-6 w-20 h-6 opacity-50" style={BARCODE_BG} />
                </div>

                {/* CAST 登场人物（角色档案） */}
                <button
                    onClick={() => setSection('char')}
                    className={`relative w-full px-7 py-10 text-left select-none rotate-[0.6deg] ${CARD}`}
                    style={CARD_STYLE}
                >
                    <Tape className="-top-2.5 left-8 rotate-[4deg] w-14" />
                    <div className="label-mono text-[9px] text-[#1c1b1a]/45 mb-2">CAST — 对面的人</div>
                    <div className="font-display-italic text-4xl font-semibold tracking-wide">登场人物</div>
                    <div className="text-[11px] text-[#1c1b1a]/55 mt-3 leading-relaxed">角色的身份与记忆档案：新建 / 编辑 / 导入 SillyTavern 角色卡</div>
                    <MaskHappy className="absolute bottom-5 right-5 w-10 h-10 text-[#1c1b1a]/30 rotate-[8deg]" weight="bold" />
                    <span aria-hidden className="absolute top-3 right-4 w-8 h-8 rounded-full border-2 border-dashed border-[#1c1b1a]/40 rotate-[10deg] flex items-center justify-center label-mono text-[7px] text-[#1c1b1a]/50">TA</span>
                </button>

                {/* GUISE 扮相手账（用户人设） */}
                <button
                    onClick={() => setSection('user')}
                    className={`relative w-full px-7 py-10 text-left select-none rotate-[-0.6deg] ${CARD}`}
                    style={CARD_STYLE}
                >
                    <Tape className="-top-2.5 right-8 rotate-[-4deg] w-14" />
                    <div className="label-mono text-[9px] text-[#1c1b1a]/45 mb-2">GUISE — 镜中的我</div>
                    <div className="font-display-italic text-4xl font-semibold tracking-wide">扮相手账</div>
                    <div className="text-[11px] text-[#1c1b1a]/55 mt-3 leading-relaxed">你的多页身份：换页佩戴、别在角色上自动切换、自述寄送方式</div>
                    <UserFocus className="absolute bottom-5 right-5 w-10 h-10 text-[#1c1b1a]/30 rotate-[-8deg]" weight="bold" />
                    <span aria-hidden className="absolute top-3 right-4 w-8 h-8 rounded-full border-2 border-dashed border-[#1c1b1a]/40 rotate-[-10deg] flex items-center justify-center label-mono text-[7px] text-[#1c1b1a]/50">ME</span>
                </button>
            </div>
        </div>
    );
};

export default PersonaHubApp;
