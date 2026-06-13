import React, { useState } from 'react';
import JournalApp from './JournalApp';
import ExchangeDiaryApp from './ExchangeDiaryApp';

// 合并后的「日记」App：一个图标进来，顶部两张手账标签卡在两种体验间切换 ——
//   · 对页信笺（JournalApp）：按角色 / 按日历的双页（信纸 + 贴纸）私密交换日记，可收进回忆标本馆 / 往事柜。
//   · 合写本子（ExchangeDiaryApp）：多角色共用的日记本，时间线信息流，含心情 / 印章 / AI 起头 / 今日对话总结。
// 两种模式的数据模型各自独立保留，底层 LLM 调用 / 取日期 / 抠 JSON 等共用逻辑收在 diaryShared.ts。
type DiaryTab = 'journal' | 'club';

const TABS: { key: DiaryTab; label: string }[] = [
    { key: 'journal', label: '对页信笺' },
    { key: 'club', label: '合写本子' },
];

const DiaryApp: React.FC = () => {
    const [tab, setTab] = useState<DiaryTab>('journal');

    // 切换器渲染在各模式根页头部（对页信笺的「书架」页 / 合写本子的书架页），
    // 进入某本日记 / 某个角色的日历后自然隐藏，返回根页即可再切换模式。
    // 视觉：两张手账分隔标签卡，激活的一张墨色实底压在上层，未激活的牛皮纸色微微歪出去。
    const tabSwitcher = (
        <div className="flex items-end gap-0.5">
            {TABS.map(({ key, label }) => {
                const on = tab === key;
                return (
                    <button
                        key={key}
                        onClick={() => setTab(key)}
                        className="relative px-3.5 pt-2 pb-1.5 active:scale-95 transition-transform"
                        style={{
                            background: on ? '#2b2933' : 'rgba(255,255,255,0.92)',
                            color: on ? '#ffffff' : '#8b8996',
                            borderRadius: '11px 11px 3px 3px',
                            border: '1px solid rgba(236,233,226,0.95)',
                            outline: on ? '1px dashed rgba(255,255,255,0.35)' : '1px dashed rgba(167,162,151,0.45)',
                            outlineOffset: '-4px',
                            rotate: on ? '0deg' : key === 'journal' ? '-2deg' : '2deg',
                            boxShadow: on ? '0 10px 20px -12px rgba(43,41,51,0.55)' : 'none',
                            zIndex: on ? 2 : 1,
                        }}
                    >
                        <span className="font-hand text-base font-bold leading-none whitespace-nowrap">{label}</span>
                    </button>
                );
            })}
        </div>
    );

    return tab === 'journal'
        ? <JournalApp tabSwitcher={tabSwitcher} />
        : <ExchangeDiaryApp tabSwitcher={tabSwitcher} />;
};

export default DiaryApp;
