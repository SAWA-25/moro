import React, { useState } from 'react';
import { useOS } from '../context/OSContext';
import { UserCircle, IdentificationCard } from '@phosphor-icons/react';
import Character from './Character';
import PersonaApp from './PersonaApp';

/**
 * 人设库：原「神经链接」（角色档案，apps/Character.tsx）与「人设」（主控面具，
 * apps/PersonaApp.tsx）的统一入口。桌面只保留一个「人设」图标，点开先选一类：
 *   - CHAR 角色档案 → 角色管理/编辑器
 *   - USER 主控面具 → 用户人设管理
 * 两个子页通过 onExit 回到本选择页（不直接回桌面）。
 */
const PersonaHubApp: React.FC = () => {
    const { closeApp } = useOS();
    const [section, setSection] = useState<'library' | 'char' | 'user'>('library');

    if (section === 'char') return <Character onExit={() => setSection('library')} />;
    if (section === 'user') return <PersonaApp onExit={() => setSection('library')} />;

    return (
        <div className="absolute inset-0 flex flex-col bg-[#fafafa] text-slate-900 animate-fade-in" style={{ paddingTop: 'var(--safe-top)' }}>
            {/* 顶栏：返回桌面 + 居中标题 */}
            <div className="relative flex items-center px-4 pt-3 pb-2 shrink-0">
                <button
                    onClick={closeApp}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-white border border-slate-200 shadow-sm text-[12px] font-bold text-slate-600 active:scale-95 transition-transform"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.2} stroke="currentColor" className="w-3.5 h-3.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
                    </svg>
                    桌面
                </button>
                <div className="absolute left-1/2 -translate-x-1/2 text-center select-none">
                    <div className="text-[10px] font-bold tracking-[0.35em] text-slate-400">LIBRARY</div>
                    <div className="text-[11px] tracking-[0.3em] text-slate-400 mt-0.5">选 一 类</div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto no-scrollbar px-4 pb-10 space-y-5">
                {/* 标题卡 */}
                <div className="relative rounded-3xl bg-white border border-slate-100 shadow-sm px-7 py-9 select-none">
                    <div className="absolute left-1/2 -translate-x-1/2 -top-2 w-20 h-5 bg-slate-100/90 rounded-sm shadow-sm" />
                    <div className="text-[11px] font-bold tracking-[0.35em] text-slate-400 mb-3">PERSONA LIBRARY</div>
                    <div className="font-display-italic text-5xl font-semibold tracking-wide">人设库</div>
                </div>

                {/* CHAR 角色档案 */}
                <button
                    onClick={() => setSection('char')}
                    className="relative w-full rounded-3xl bg-white border border-slate-100 shadow-sm px-7 py-12 text-left active:scale-[0.99] transition-transform select-none"
                >
                    <div className="absolute left-1/2 -translate-x-1/2 -top-2 w-20 h-5 bg-slate-100/90 rounded-sm shadow-sm" />
                    <div className="text-[11px] font-bold tracking-[0.35em] text-slate-400 mb-3">CHAR</div>
                    <div className="font-display-italic text-4xl font-semibold tracking-wide">角色档案</div>
                    <div className="text-[11px] text-slate-400 mt-3 leading-relaxed">角色的身份与记忆档案 —— 新建 / 编辑 / 导入 SillyTavern 卡</div>
                    <IdentificationCard className="absolute bottom-6 right-6 w-9 h-9 text-slate-300" weight="regular" />
                </button>

                {/* USER 主控面具 */}
                <button
                    onClick={() => setSection('user')}
                    className="relative w-full rounded-3xl bg-white border border-slate-100 shadow-sm px-7 py-12 text-left active:scale-[0.99] transition-transform select-none"
                >
                    <div className="absolute left-1/2 -translate-x-1/2 -top-2 w-20 h-5 bg-slate-100/90 rounded-sm shadow-sm" />
                    <div className="text-[11px] font-bold tracking-[0.35em] text-slate-400 mb-3">USER</div>
                    <div className="font-display-italic text-4xl font-semibold tracking-wide">主控面具</div>
                    <div className="text-[11px] text-slate-400 mt-3 leading-relaxed">你的多套用户身份 —— 切换面具、绑定角色、描述注入</div>
                    <UserCircle className="absolute bottom-6 right-6 w-9 h-9 text-slate-300" weight="regular" />
                </button>
            </div>
        </div>
    );
};

export default PersonaHubApp;
