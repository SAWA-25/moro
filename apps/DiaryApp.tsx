import React, { useState } from 'react';
import JournalApp from './JournalApp';
import ExchangeDiaryApp from './ExchangeDiaryApp';

// 合并后的「日记」App：一个图标进来，顶部 Tab 在两种体验间切换 ——
//   · 交换日记：按角色 / 按日历的双页（信纸 + 贴纸）私密交换日记，可归档进记忆宫殿 / 神经链接。
//   · 日记社：多角色共用的日记本，时间线信息流，含心情 / 印章 / AI 起头 / 今日对话总结。
// 两种模式的数据模型各自独立保留，底层 LLM 调用 / 取日期 / 抠 JSON 等共用逻辑收在 diaryShared.ts。
type DiaryTab = 'journal' | 'club';

const TABS: { key: DiaryTab; label: string }[] = [
    { key: 'journal', label: '交换日记' },
    { key: 'club', label: '日记社' },
];

const DiaryApp: React.FC = () => {
    const [tab, setTab] = useState<DiaryTab>('journal');

    // 切换器渲染在各模式根页头部（交换日记的「选择日记本」页 / 日记社的书架页），
    // 进入某本日记 / 某个角色的日历后自然隐藏，返回根页即可再切换模式。
    const tabSwitcher = (
        <div className="flex items-center gap-1 p-1 rounded-full bg-amber-100/70 border border-amber-200/70 shadow-inner">
            {TABS.map(({ key, label }) => (
                <button
                    key={key}
                    onClick={() => setTab(key)}
                    className={`px-3.5 py-1 rounded-full text-xs font-bold transition-all active:scale-95 ${
                        tab === key ? 'bg-amber-500 text-white shadow-sm' : 'text-amber-700/70 hover:text-amber-800'
                    }`}
                >
                    {label}
                </button>
            ))}
        </div>
    );

    return tab === 'journal'
        ? <JournalApp tabSwitcher={tabSwitcher} />
        : <ExchangeDiaryApp tabSwitcher={tabSwitcher} />;
};

export default DiaryApp;
