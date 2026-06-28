import React, { useState } from 'react';
import { useOS } from '../context/OSContext';
import Character from './Character';
import PersonaApp from './PersonaApp';
import { PAPER_TONES, MONO_STACK } from '../components/handbook/paper';

/**
 * 剪影集：角色资料与用户身份的统一入口。
 * 两个子页通过 onExit 回到本页，不直接回桌面。
 */

const INK = '#2f3432';
const CARD = 'bg-white press-soft';
const CARD_STYLE: React.CSSProperties = { borderRadius: 18, border: '1px solid #e6ece8', boxShadow: '0 1px 2px rgba(47,64,60,0.08), 0 14px 30px -24px rgba(47,64,60,0.34)' };
const STICKER = 'rounded-full bg-[#fbfcf8] press-soft border border-[#dfe7e1] shadow-[0_1px_2px_rgba(47,64,60,0.10)]';
const DOT_BG: React.CSSProperties = {
    background: '#f5f7f4',
};

const EntryCard: React.FC<{
    title: string;
    eyebrow: string;
    desc: string;
    countLabel: string;
    tone: 'sage' | 'blue';
    onClick: () => void;
}> = ({ title, eyebrow, desc, countLabel, tone, onClick }) => (
    <button
        onClick={onClick}
        className={`relative w-full p-4 text-left select-none ${CARD}`}
        style={CARD_STYLE}
    >
        <div className="text-[8px] tracking-[0.16em] uppercase" style={{ ...MONO_STACK, color: PAPER_TONES.inkFaint }}>{eyebrow}</div>
        <div className="text-xl font-black tracking-normal mt-0.5">{title}</div>
        <div className="text-[11px] mt-1.5 leading-relaxed" style={{ color: PAPER_TONES.inkSoft }}>{desc}</div>
        <span aria-hidden className="absolute top-4 right-4 h-8 min-w-8 px-2 rounded-full border bg-white/88 flex items-center justify-center text-[7px]" style={{ ...MONO_STACK, borderColor: tone === 'blue' ? '#dbe5e8' : '#dfe7e1', color: tone === 'blue' ? '#3f6375' : '#405f56' }}>{countLabel}</span>
    </button>
);

const PersonaHubApp: React.FC = () => {
    const { closeApp, characters } = useOS();
    const [section, setSection] = useState<'library' | 'char' | 'user'>('library');

    if (section === 'char') return <Character onExit={() => setSection('library')} />;
    if (section === 'user') return <PersonaApp onExit={() => setSection('library')} />;

    return (
        <div
            className="absolute inset-0 flex flex-col text-[#2f3432] animate-fade-in"
            style={{ ...DOT_BG, paddingTop: 'var(--safe-top)' }}
        >
            {/* 顶栏 */}
            <div className="relative flex items-center px-4 pt-3 pb-2 shrink-0 bg-[#f5f7f4]/95 backdrop-blur border-b border-[#e6ece8]">
                <button
                    onClick={closeApp}
                    className={`inline-flex items-center gap-1.5 px-3 py-2 text-[10px] font-black ${STICKER}`}
                    style={{ color: '#405f56' }}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-3.5 h-3.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
                    </svg>
                    回桌面
                </button>
                <div className="absolute left-1/2 -translate-x-1/2 text-center select-none">
                    <div className="text-[9px] tracking-[0.18em] uppercase" style={{ ...MONO_STACK, color: PAPER_TONES.inkFaint }}>PROFILE CENTER</div>
                    <div className="text-[11px] mt-0.5" style={{ color: PAPER_TONES.inkSoft }}>资料管理</div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto no-scrollbar px-4 pb-10 space-y-5 pt-2">
                {/* 概览 */}
                <div className="relative bg-white px-5 py-5 select-none overflow-hidden" style={CARD_STYLE}>
                    <div className="min-w-0">
                        <div className="text-[9px] tracking-[0.18em] uppercase mb-2" style={{ ...MONO_STACK, color: PAPER_TONES.inkFaint }}>SILHOUETTE PROFILE</div>
                        <div className="flex items-end gap-3 mb-3">
                            <div className="text-4xl font-black tracking-normal">剪影集</div>
                        </div>
                        <div className="text-[13px] leading-relaxed" style={{ color: PAPER_TONES.inkSoft }}>集中管理角色资料和用户身份，供聊天与提示词调用。</div>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <EntryCard
                        title="登场人物"
                        eyebrow="CHARACTERS"
                        desc="角色卡、开场白、记忆、语音。"
                        countLabel={`${characters.length}`}
                        tone="sage"
                        onClick={() => setSection('char')}
                    />
                    <EntryCard
                        title="用户身份"
                        eyebrow="USER PERSONAS"
                        desc="默认身份、角色绑定、注入设置。"
                        countLabel="ME"
                        tone="blue"
                        onClick={() => setSection('user')}
                    />
                </div>
            </div>
        </div>
    );
};

export default PersonaHubApp;
