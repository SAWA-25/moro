import React, { useEffect, useState } from 'react';
import { CharacterProfile } from '../../types';
import { DB } from '../../utils/db';
import { useOS } from '../../context/OSContext';
import { initUnblockAppeal } from '../../utils/unblockAppeal';

/**
 * 角色档案页（原创手帐拼贴风）：
 * 纸面底色 + 居中档案卡（渐变圆环头像 / ID / 地区 / 签名）→ 档案入口 → 此刻动态照片条
 * → 写信（发消息）/ 通话 双贴纸按钮。
 * 聊天界面单击角色头像进入；右上角 ··· 进入「相处设置」（星标 / 黑名单 / 删除等）。
 * ID/地区/签名由用户在聊天设置 →「会话信息」里自行填写（char.socialProfile）。
 */

interface CharacterProfilePageProps {
    char: CharacterProfile;
    onBack: () => void;
    onSendMessage: () => void;
    onVoiceCall: () => void;
    onVideoCall?: () => void;
    onOpenSettings: () => void;
    onOpenMoments: () => void;
    /** 在相处设置里删除角色后回调（由宿主收起本页并返回聊天列表） */
    onDeleted?: () => void;
}

/** 墨色开关（手帐风：墨色实底 + 大滑钮） */
const ToggleSwitch: React.FC<{ on: boolean; onToggle: () => void }> = ({ on, onToggle }) => (
    <button
        onClick={onToggle}
        role="switch"
        aria-checked={on}
        className={`relative w-11 h-[26px] rounded-full transition-colors duration-300 shrink-0 ${on ? 'bg-slate-900' : 'bg-slate-200'}`}
    >
        <span
            className="absolute top-[3px] w-5 h-5 rounded-full bg-white shadow-[0_2px_5px_rgba(30,28,40,0.3)] transition-transform duration-300"
            style={{ left: '3px', transform: on ? 'translateX(18px)' : 'translateX(0)' }}
        />
    </button>
);

/** 相处设置（右上角 ··· 进入）：星标 / 黑名单 / 删除等，纸面卡片分组排版 */
const FriendSettingsPage: React.FC<{
    char: CharacterProfile;
    onBack: () => void;
    onOpenSettings: () => void;
    onDeleted?: () => void;
}> = ({ char, onBack, onOpenSettings, onDeleted }) => {
    const { updateCharacter, deleteCharacter, addToast } = useOS();
    const [confirmDelete, setConfirmDelete] = useState(false);

    // 行容器用 div：开关行内部有自己的 <button>，嵌套 button 是非法 HTML
    const Row: React.FC<{ label: string; onClick?: () => void; toggle?: React.ReactNode; divider?: boolean }> = ({ label, onClick, toggle, divider }) => (
        <>
            <div
                onClick={onClick}
                role={onClick ? 'button' : undefined}
                className={`w-full px-5 py-4 flex items-center justify-between text-left ${onClick ? 'cursor-pointer active:bg-slate-50' : ''}`}
            >
                <span className="text-[14px] font-medium text-slate-700">{label}</span>
                {toggle || (
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-slate-300 shrink-0">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                    </svg>
                )}
            </div>
            {divider && <div className="h-px bg-slate-50 mx-5" />}
        </>
    );

    const Card: React.FC<{ children: React.ReactNode }> = ({ children }) => (
        <div className="bg-white rounded-3xl border border-slate-100 shadow-[0_14px_28px_-22px_rgba(50,48,60,0.4)] overflow-hidden">{children}</div>
    );

    return (
        <div
            className="absolute inset-0 z-[310] flex flex-col text-slate-800 animate-fade-in"
            style={{ paddingTop: 'max(8px, var(--safe-top))', background: 'linear-gradient(165deg, #f4f2ed 0%, #eee9e1 100%)' }}
        >
            <div className="relative flex items-center justify-center px-2 py-2 shrink-0">
                <button onClick={onBack} className="absolute left-2 p-2 active:opacity-50" aria-label="返回">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.2} stroke="currentColor" className="w-6 h-6">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                    </svg>
                </button>
                <span className="text-[12px] font-mono font-bold tracking-[0.35em] uppercase text-slate-500">相处设置</span>
            </div>

            <div className="flex-1 overflow-y-auto no-scrollbar px-4 pt-2 pb-8 space-y-3">
                <Card>
                    <Row label="编辑 TA 的档案" onClick={onOpenSettings} divider />
                    <Row label="互动权限" onClick={() => addToast('互动权限暂未开放', 'info')} />
                </Card>

                <Card>
                    <Row label={`把 ${char.name} 介绍给别人`} onClick={() => addToast('介绍功能暂未开放', 'info')} divider />
                    <Row label="贴到桌面" onClick={() => addToast('贴到桌面暂未开放', 'info')} />
                </Card>

                <Card>
                    <Row
                        label="星标 TA（置顶心意）"
                        toggle={<ToggleSwitch on={!!char.starredFriend} onToggle={() => updateCharacter(char.id, { starredFriend: !char.starredFriend })} />}
                    />
                </Card>

                <Card>
                    <Row
                        label="加入黑名单"
                        toggle={<ToggleSwitch on={!!char.blacklisted} onToggle={() => {
                            const next = !char.blacklisted;
                            // blacklistedAt 标记拉黑时刻：此后角色发来的消息气泡旁带红色感叹号。
                            // 拉黑同时开启「解除拉黑申诉」：角色稍后会主动发来求解封的验证消息；
                            // 移出黑名单则停止申诉。
                            updateCharacter(char.id, {
                                blacklisted: next,
                                blacklistedAt: next ? Date.now() : undefined,
                                unblockAppeal: next ? initUnblockAppeal() : { active: false, awaiting: false, nextAt: 0, rejectedCount: 0 },
                            });
                            addToast(next ? `已将 ${char.name} 加入黑名单` : `已将 ${char.name} 移出黑名单`, 'info');
                        }} />}
                    />
                    <div className="h-px bg-slate-50 mx-5" />
                    <Row label="悄悄抱怨一下" onClick={() => addToast('已收到抱怨（彩蛋：TA 表示很无辜）', 'info')} />
                </Card>

                <Card>
                    <button
                        onClick={() => setConfirmDelete(true)}
                        className="w-full py-4 text-center text-[14px] text-rose-500 font-bold active:bg-rose-50"
                    >
                        删除这段关系
                    </button>
                </Card>
            </div>

            {/* 删除二次确认 */}
            {confirmDelete && (
                <div className="absolute inset-0 z-[320] flex items-center justify-center animate-fade-in" style={{ background: 'rgba(20,20,28,0.4)', backdropFilter: 'blur(4px)' }} onClick={() => setConfirmDelete(false)}>
                    <div className="w-[min(80vw,300px)] bg-white rounded-[1.6rem] overflow-hidden shadow-2xl relative" onClick={e => e.stopPropagation()}>
                        <div className="absolute top-0 right-6 w-4 h-7 bg-slate-900" style={{ clipPath: 'polygon(0 0, 100% 0, 100% 100%, 50% 70%, 0 100%)' }} />
                        <div className="px-6 pt-6 pb-5 text-center">
                            <div className="text-[15px] font-bold text-slate-800">删除这段关系</div>
                            <div className="text-[13px] text-slate-500 mt-2 leading-relaxed">
                                将删除角色「{char.name}」及其全部聊天记录与记忆，此操作不可恢复。
                            </div>
                        </div>
                        <div className="flex gap-2.5 px-5 pb-5">
                            <button onClick={() => setConfirmDelete(false)} className="flex-1 py-2.5 rounded-2xl bg-slate-100 text-slate-600 text-[13px] font-bold active:scale-95 transition-transform">再想想</button>
                            <button
                                onClick={async () => {
                                    setConfirmDelete(false);
                                    await deleteCharacter(char.id);
                                    addToast(`已删除「${char.name}」`, 'success');
                                    onDeleted?.();
                                }}
                                className="flex-1 py-2.5 rounded-2xl bg-rose-500 text-white text-[13px] font-bold shadow-lg shadow-rose-200 active:scale-95 transition-transform"
                            >
                                删除
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const CharacterProfilePage: React.FC<CharacterProfilePageProps> = ({
    char, onBack, onSendMessage, onVoiceCall, onVideoCall, onOpenSettings, onOpenMoments, onDeleted,
}) => {
    const [momentImages, setMomentImages] = useState<string[]>([]);
    const [showFriendSettings, setShowFriendSettings] = useState(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const posts = await DB.getSocialPosts();
                const images = posts
                    .filter(p => p.authorCharId === char.id)
                    .sort((a, b) => b.timestamp - a.timestamp)
                    .flatMap(p => p.images || [])
                    .slice(0, 4);
                if (!cancelled) setMomentImages(images);
            } catch { /* 动态取不到就空着 */ }
        })();
        return () => { cancelled = true; };
    }, [char.id]);

    const handleId = char.socialProfile?.handle || `moro_${char.id.slice(0, 10)}`;
    const region = char.socialProfile?.region || '';
    const bio = char.socialProfile?.bio || '';

    return (
        <div
            className="absolute inset-0 z-[300] flex flex-col text-slate-800 animate-fade-in"
            style={{ paddingTop: 'max(8px, var(--safe-top))', background: 'linear-gradient(165deg, #f4f2ed 0%, #eee9e1 100%)' }}
        >
            {/* 顶栏：返回 / ···（相处设置：星标、黑名单、删除等） */}
            <div className="relative flex items-center justify-center px-2 py-2 shrink-0">
                <button onClick={onBack} className="absolute left-2 p-2 active:opacity-50" aria-label="返回">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.2} stroke="currentColor" className="w-6 h-6">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                    </svg>
                </button>
                <span className="text-[12px] font-mono font-bold tracking-[0.4em] uppercase text-slate-400">Profile</span>
                <button onClick={() => setShowFriendSettings(true)} className="absolute right-2 p-2 active:opacity-50" aria-label="相处设置">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
                        <path d="M6 12a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm7.5 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm7.5 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z" />
                    </svg>
                </button>
            </div>

            <div className="flex-1 overflow-y-auto no-scrollbar px-4 pt-2 pb-10 space-y-3">
                {/* 档案卡：渐变圆环头像 + 名字 + ID / 地区 / 签名；
                    会话设置「身份卡画板」作为卡片顶部画框 */}
                <div className="bg-white rounded-[1.8rem] border border-slate-100 shadow-[0_18px_36px_-24px_rgba(50,48,60,0.45)] overflow-hidden relative">
                    {/* 右上书签缎带 */}
                    <div className="absolute top-0 right-7 w-5 h-9 bg-slate-900 z-10" style={{ clipPath: 'polygon(0 0, 100% 0, 100% 100%, 50% 72%, 0 100%)' }} />
                    {char.convoSettings?.idCardImage && (
                        <div
                            className="h-24 w-full"
                            style={{ backgroundImage: `url(${char.convoSettings.idCardImage})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
                        />
                    )}
                    <div className={`px-6 pb-6 flex flex-col items-center text-center ${char.convoSettings?.idCardImage ? '-mt-10' : 'pt-7'}`}>
                        <div className="p-[3px] rounded-full shadow-md" style={{ background: 'conic-gradient(from 210deg, #2b2933, #8b8996, #2b2933)' }}>
                            <img src={char.avatar} alt={char.name} className="w-20 h-20 rounded-full object-cover border-[3px] border-white" />
                        </div>
                        <div className="mt-3 text-[20px] font-bold leading-tight flex items-center gap-1.5 max-w-full">
                            <span className="truncate">{char.name}</span>
                            {char.starredFriend && <span className="text-amber-400 text-[15px] shrink-0">★</span>}
                        </div>
                        <div className="mt-1 text-[11px] font-mono text-slate-400 tracking-wider truncate max-w-full">ID · {handleId}</div>
                        {region && <div className="mt-0.5 text-[11px] text-slate-400 truncate max-w-full">📍 {region}</div>}
                        {bio && (
                            <div className="mt-3 px-4 py-2.5 rounded-2xl bg-slate-50 border border-dashed border-slate-200 text-[12px] text-slate-500 leading-relaxed line-clamp-3 max-w-full">
                                「{bio}」
                            </div>
                        )}
                        {/* 双贴纸按钮：写信（发消息）/ 通话 */}
                        <div className="mt-5 flex gap-2.5 w-full">
                            <button
                                onClick={onSendMessage}
                                className="flex-1 py-3 rounded-2xl bg-slate-900 text-white text-[13px] font-bold shadow-lg shadow-slate-300 active:scale-[0.97] transition-transform flex items-center justify-center gap-2"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-4 h-4">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
                                </svg>
                                去聊天
                            </button>
                            <button
                                onClick={onVoiceCall}
                                className="flex-1 py-3 rounded-2xl bg-white text-slate-700 text-[13px] font-bold border border-slate-200 shadow-[0_10px_22px_-14px_rgba(50,48,60,0.4)] active:scale-[0.97] transition-transform flex items-center justify-center gap-2"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-4 h-4">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" />
                                </svg>
                                打个电话
                            </button>
                            {onVideoCall && (
                                <button
                                    onClick={onVideoCall}
                                    title="视频通话"
                                    className="shrink-0 px-4 py-3 rounded-2xl bg-white text-slate-700 border border-slate-200 shadow-[0_10px_22px_-14px_rgba(50,48,60,0.4)] active:scale-[0.97] transition-transform flex items-center justify-center"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-4 h-4">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
                                    </svg>
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                {/* 档案入口（保留原角色设置入口） */}
                <button
                    onClick={onOpenSettings}
                    className="w-full bg-white rounded-3xl border border-slate-100 shadow-[0_14px_28px_-22px_rgba(50,48,60,0.4)] px-5 py-4 text-left active:scale-[0.99] transition-transform"
                >
                    <div className="flex items-center justify-between">
                        <span className="text-[14px] font-bold text-slate-700">TA 的档案手记</span>
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-slate-300 shrink-0">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                        </svg>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
                        翻看与编辑 TA 的人设与记忆，并设置相处方式。
                    </p>
                </button>

                {/* 此刻动态照片条 */}
                <button
                    onClick={onOpenMoments}
                    className="w-full bg-white rounded-3xl border border-slate-100 shadow-[0_14px_28px_-22px_rgba(50,48,60,0.4)] px-5 py-4 text-left active:scale-[0.99] transition-transform"
                >
                    <div className="flex items-center justify-between mb-2.5">
                        <span className="text-[14px] font-bold text-slate-700">TA 的此刻</span>
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-slate-300 shrink-0">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                        </svg>
                    </div>
                    {momentImages.length > 0 ? (
                        <div className="flex items-center gap-1.5 overflow-hidden">
                            {momentImages.map((img, i) => (
                                <img key={i} src={img} alt="" className={`w-[68px] h-[68px] rounded-xl object-cover shrink-0 border border-slate-100 ${i % 2 === 0 ? 'tilt-l' : 'tilt-r'}`} loading="lazy" />
                            ))}
                        </div>
                    ) : (
                        <p className="text-[11px] text-slate-300">TA 还没有贴出任何瞬间。</p>
                    )}
                </button>
            </div>

            {/* 相处设置子页 */}
            {showFriendSettings && (
                <FriendSettingsPage
                    char={char}
                    onBack={() => setShowFriendSettings(false)}
                    onOpenSettings={() => { setShowFriendSettings(false); onOpenSettings(); }}
                    onDeleted={onDeleted}
                />
            )}
        </div>
    );
};

export default CharacterProfilePage;
