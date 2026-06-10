import React from 'react';
import { useOS } from '../context/OSContext';

// 日记社 — 多角色交换日记本（角色视角日记 + 每日对话总结）。实现见后续提交。
const ExchangeDiaryApp: React.FC = () => {
    const { closeApp } = useOS();
    return (
        <div className="w-full h-full flex flex-col items-center justify-center gap-4 bg-amber-50">
            <p className="text-sm text-amber-500">日记社建设中…</p>
            <button onClick={closeApp} className="px-4 py-2 rounded-xl bg-amber-100 text-sm">返回</button>
        </div>
    );
};

export default ExchangeDiaryApp;
