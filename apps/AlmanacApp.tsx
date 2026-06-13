import React, { useState } from 'react';
import { useOS } from '../context/OSContext';
import ScheduleApp from './ScheduleApp';
import { SpecialMomentsApp } from '../components/ValentineEvent';
import AlmanacCalendar from './almanac/AlmanacCalendar';
import { PaperPage, PaperNote, WashiTape, TapeLabel, Postmark, PaperClip, HAND_FONT } from './almanac/handbookKit';

/**
 * 岁时记 · 封面页（拼贴手账风）
 * ------------------------------------------------------------
 * 一本贴满胶带和便签的本子。翻开能去三页：
 *   时光契约（ScheduleApp）  —— 要做的事 + 要数的日子
 *   特别时光（SpecialMomentsApp）—— 节日里一起留下的瞬间
 *   日历（AlmanacCalendar）   —— 这个月，你和角色都能往某天贴便签（新增）
 * 三页都通过 onExit 翻回这张封面，不直接关到桌面。各页玩法、数据、名字照旧。
 */

const MONTHS_CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六'];

const AlmanacApp: React.FC = () => {
    const { closeApp } = useOS();
    const [section, setSection] = useState<'home' | 'schedule' | 'moments' | 'calendar'>('home');

    if (section === 'schedule') return <ScheduleApp onExit={() => setSection('home')} />;
    if (section === 'moments') return <SpecialMomentsApp onExit={() => setSection('home')} />;
    if (section === 'calendar') return <AlmanacCalendar onExit={() => setSection('home')} />;

    const now = new Date();

    return (
        <PaperPage kind="kraft" className="animate-fade-in" style={{ paddingTop: 'var(--safe-top)' }}>
            <div className="h-full flex flex-col" style={{ color: '#4a3b2e' }}>
                {/* 顶栏：回桌面 + 今天的小邮戳 */}
                <div className="relative flex items-center justify-between px-4 pt-3 pb-1 shrink-0 z-10">
                    <button
                        onClick={closeApp}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-[12px] font-bold active:scale-95 transition-transform"
                        style={{ background: '#fffdf7', boxShadow: '0 2px 6px rgba(96,66,40,0.18)', transform: 'rotate(-1.5deg)', color: '#7a5c44' }}
                    >
                        ← 合上本子
                    </button>
                    <Postmark size={50} color="#7a8b5a" rotate={9}>
                        {MONTHS_CN[now.getMonth()]}月{now.getDate()}
                    </Postmark>
                </div>

                <div className="flex-1 overflow-y-auto no-scrollbar px-5 pb-10 z-10">
                    {/* 封面招牌 */}
                    <div className="relative mt-3 mb-7 select-none">
                        <WashiTape className="-top-1 left-6" color="rgba(231,163,156,0.72)" rotate={-16} width={84} height={26} />
                        <WashiTape className="-top-1 right-10" color="rgba(158,201,163,0.7)" rotate={14} width={70} height={24} />
                        <div className="pt-6 pl-1" style={{ fontFamily: HAND_FONT }}>
                            <div className="text-[11px] tracking-[0.4em]" style={{ color: '#a98e6f' }}>SEASONS · 私人手账</div>
                            <div className="flex items-end gap-3 mt-1">
                                <div className="text-[64px] leading-none font-black" style={{ color: '#5b4636', textShadow: '2px 2px 0 rgba(177,84,63,0.14)' }}>岁时记</div>
                            </div>
                            <div className="text-[13px] mt-2 leading-relaxed" style={{ color: '#7a624c' }}>
                                把要做的事、要数的日子，和节日里那几页，全贴进同一本里。
                            </div>
                        </div>
                    </div>

                    {/* 三页入口 */}
                    <div className="space-y-5">
                        {/* 时光契约 */}
                        <PaperNote rotate={-1.4} bg="#fbf6ea" className="px-5 py-5" onClick={() => setSection('schedule')}>
                            <WashiTape className="-top-2 left-8" color="rgba(120,180,200,0.62)" rotate={-12} width={76} />
                            <PaperClip className="-top-3 right-6" color="#8fa0ae" />
                            <div className="flex items-center gap-3">
                                <span className="text-[34px] leading-none">🧷</span>
                                <div>
                                    <TapeLabel color="#bcd6dd" textColor="#33606b">第 一 页</TapeLabel>
                                    <div className="text-[26px] font-black mt-1" style={{ fontFamily: HAND_FONT, color: '#33606b' }}>时光契约</div>
                                </div>
                            </div>
                            <div className="text-[12px] mt-3 leading-relaxed" style={{ color: '#6a5a48' }}>
                                把要做的事钉成约定，让角色当监督人；再把在意的日子一天天数着倒计时。
                            </div>
                        </PaperNote>

                        {/* 日历（新增）*/}
                        <PaperNote rotate={1.2} bg="#f3f7ef" className="px-5 py-5" onClick={() => setSection('calendar')}>
                            <WashiTape className="-top-2 right-8" color="rgba(231,196,120,0.66)" rotate={12} width={76} />
                            <div className="absolute top-3 right-4">
                                <Postmark size={40} color="#b1543f" rotate={-10}>NEW</Postmark>
                            </div>
                            <div className="flex items-center gap-3">
                                <span className="text-[34px] leading-none">🗓️</span>
                                <div>
                                    <TapeLabel color="#cfe3c6" textColor="#4a6b3c">第 二 页</TapeLabel>
                                    <div className="text-[26px] font-black mt-1" style={{ fontFamily: HAND_FONT, color: '#4a6b3c' }}>这个月</div>
                                </div>
                            </div>
                            <div className="text-[12px] mt-3 leading-relaxed" style={{ color: '#5d6a4d' }}>
                                一整页真实月历。点哪天都能贴张便签；角色也会自己往某些日子贴上惦记的事。
                            </div>
                        </PaperNote>

                        {/* 特别时光 */}
                        <PaperNote rotate={-0.8} bg="#fbf0f1" className="px-5 py-5" onClick={() => setSection('moments')}>
                            <WashiTape className="-top-2 left-10" color="rgba(231,163,156,0.7)" rotate={-10} width={76} />
                            <div className="flex items-center gap-3">
                                <span className="text-[34px] leading-none">💌</span>
                                <div>
                                    <TapeLabel color="#eec7cb" textColor="#8a3b4c">第 三 页</TapeLabel>
                                    <div className="text-[26px] font-black mt-1" style={{ fontFamily: HAND_FONT, color: '#8a3b4c' }}>特别时光</div>
                                </div>
                            </div>
                            <div className="text-[12px] mt-3 leading-relaxed" style={{ color: '#7a5560' }}>
                                情人节、白色情人节、520……那些节日里和角色一起留下的页面，随时翻回去看。
                            </div>
                        </PaperNote>
                    </div>

                    {/* 页脚手写小字 + 今天 */}
                    <div className="text-center mt-8 text-[11px] select-none" style={{ color: '#a98e6f', fontFamily: HAND_FONT }}>
                        {now.getFullYear()} 年 · 周{WEEK_CN[now.getDay()]} · 又翻开了这一页
                    </div>
                </div>
            </div>
        </PaperPage>
    );
};

export default AlmanacApp;
