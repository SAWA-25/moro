import React from 'react';
import { useOS } from '../context/OSContext';

// 电话 App — 拨号键盘 / 通话记录（拨出·接听·未接）/ 通话录音与逐字稿。实现见后续提交。
const PhoneApp: React.FC = () => {
    const { closeApp } = useOS();
    return (
        <div className="w-full h-full flex flex-col items-center justify-center gap-4 bg-slate-50">
            <p className="text-sm text-slate-400">电话 App 建设中…</p>
            <button onClick={closeApp} className="px-4 py-2 rounded-xl bg-slate-200 text-sm">返回</button>
        </div>
    );
};

export default PhoneApp;
