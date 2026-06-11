import React, { useEffect, useRef, useState } from 'react';
import { CharacterProfile } from '../../types';
import { DB } from '../../utils/db';
import { useOS } from '../../context/OSContext';
import { generateSocialProfile } from '../../utils/socialProfileGen';

/**
 * 角色主页（微信好友资料页风格）：
 * 头像/名字/微信号/地区 → 朋友资料 → 朋友圈照片条 → 发消息 / 音视频通话。
 * 聊天界面单击角色头像进入；右上角 ··· 进入「朋友设置」（星标 / 黑名单 / 删除好友等）。
 * 微信号/地区/签名由 AI 按人设生成：首次进入缺啥补啥并持久化，之后固定不再变化。
 */

interface CharacterProfilePageProps {
    char: CharacterProfile;
    onBack: () => void;
    onSendMessage: () => void;
    onVoiceCall: () => void;
    onOpenSettings: () => void;
    onOpenMoments: () => void;
    /** 在朋友设置里删除好友后回调（由宿主收起本页并返回聊天列表） */
    onDeleted?: () => void;
}

/** 仿微信开关 */
const ToggleSwitch: React.FC<{ on: boolean; onToggle: () => void }> = ({ on, onToggle }) => (
    <button
        onClick={onToggle}
        role="switch"
        aria-checked={on}
        className={`relative w-[51px] h-[31px] rounded-full transition-colors duration-200 shrink-0 ${on ? 'bg-[#07c160]' : 'bg-[#e5e5e5]'}`}
    >
        <span
            className="absolute top-[2px] w-[27px] h-[27px] rounded-full bg-white shadow transition-transform duration-200"
            style={{ left: '2px', transform: on ? 'translateX(20px)' : 'translateX(0)' }}
        />
    </button>
);

/** 朋友设置（右上角 ··· 进入）：仿微信好友设置页，含星标 / 黑名单 / 删除好友 */
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
                className={`w-full bg-white px-5 py-4 flex items-center justify-between text-left ${onClick ? 'cursor-pointer active:bg-[#f5f5f5]' : ''}`}
            >
                <span className="text-[16px]">{label}</span>
                {toggle || (
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-[#c7c7c7] shrink-0">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                    </svg>
                )}
            </div>
            {divider && <div className="h-px bg-[#ededed] ml-5" />}
        </>
    );

    return (
        <div
            className="absolute inset-0 z-[310] flex flex-col bg-[#ededed] text-[#191919] animate-fade-in"
            style={{ paddingTop: 'max(8px, var(--safe-top))' }}
        >
            <div className="relative flex items-center justify-center px-2 py-2 shrink-0">
                <button onClick={onBack} className="absolute left-2 p-2 active:opacity-50" aria-label="返回">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.2} stroke="currentColor" className="w-6 h-6">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                    </svg>
                </button>
                <span className="text-[17px] font-medium">朋友设置</span>
            </div>

            <div className="flex-1 overflow-y-auto no-scrollbar pt-2">
                <div className="bg-white">
                    <Row label="设置朋友资料" onClick={onOpenSettings} divider />
                    <Row label="朋友权限" onClick={() => addToast('朋友权限暂未开放', 'info')} />
                </div>

                <div className="bg-white mt-2">
                    <Row label={`把${char.name}推荐给朋友`} onClick={() => addToast('推荐功能暂未开放', 'info')} divider />
                    <Row label="添加到桌面" onClick={() => addToast('添加到桌面暂未开放', 'info')} />
                </div>

                <div className="bg-white mt-2">
                    <Row
                        label="设为星标朋友"
                        toggle={<ToggleSwitch on={!!char.starredFriend} onToggle={() => updateCharacter(char.id, { starredFriend: !char.starredFriend })} />}
                    />
                </div>

                <div className="bg-white mt-2">
                    <Row
                        label="加入黑名单"
                        toggle={<ToggleSwitch on={!!char.blacklisted} onToggle={() => {
                            const next = !char.blacklisted;
                            // blacklistedAt 标记拉黑时刻：此后角色发来的消息气泡旁带红色感叹号
                            updateCharacter(char.id, { blacklisted: next, blacklistedAt: next ? Date.now() : undefined });
                            addToast(next ? `已将 ${char.name} 加入黑名单` : `已将 ${char.name} 移出黑名单`, 'info');
                        }} />}
                    />
                    <div className="h-px bg-[#ededed] ml-5" />
                    <Row label="投诉" onClick={() => addToast('已收到投诉（彩蛋：TA 表示很无辜）', 'info')} />
                </div>

                <div className="bg-white mt-2">
                    <button
                        onClick={() => setConfirmDelete(true)}
                        className="w-full py-4 text-center text-[16px] text-[#fa5151] font-medium active:bg-[#f5f5f5]"
                    >
                        删除
                    </button>
                </div>
            </div>

            {/* 删除好友二次确认 */}
            {confirmDelete && (
                <div className="absolute inset-0 z-[320] flex items-center justify-center bg-black/40 animate-fade-in" onClick={() => setConfirmDelete(false)}>
                    <div className="w-[min(80vw,300px)] bg-white rounded-xl overflow-hidden" onClick={e => e.stopPropagation()}>
                        <div className="px-6 pt-6 pb-5 text-center">
                            <div className="text-[16px] font-medium">删除好友</div>
                            <div className="text-[14px] text-[#7f7f7f] mt-2 leading-relaxed">
                                将删除角色「{char.name}」及其全部聊天记录与记忆，此操作不可恢复。
                            </div>
                        </div>
                        <div className="grid grid-cols-2 border-t border-[#ededed]">
                            <button onClick={() => setConfirmDelete(false)} className="py-3.5 text-[16px] text-[#576b95] active:bg-[#f5f5f5]">取消</button>
                            <button
                                onClick={async () => {
                                    setConfirmDelete(false);
                                    await deleteCharacter(char.id);
                                    addToast(`已删除好友「${char.name}」`, 'success');
                                    onDeleted?.();
                                }}
                                className="py-3.5 text-[16px] text-[#fa5151] font-medium border-l border-[#ededed] active:bg-[#f5f5f5]"
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
    char, onBack, onSendMessage, onVoiceCall, onOpenSettings, onOpenMoments, onDeleted,
}) => {
    const { apiConfig, updateCharacter } = useOS();
    const [momentImages, setMomentImages] = useState<string[]>([]);
    const [generating, setGenerating] = useState(false);
    const [showFriendSettings, setShowFriendSettings] = useState(false);
    const generatingRef = useRef(false);
    const autoGenCharRef = useRef<string | null>(null);

    // 微信号/地区/签名只生成一次：仅补空缺字段并持久化，之后固定不可刷新
    const runGenerate = async () => {
        if (generatingRef.current) return;
        if (!apiConfig?.apiKey || !apiConfig?.baseUrl) return;
        generatingRef.current = true;
        setGenerating(true);
        try {
            const gen = await generateSocialProfile(apiConfig, char);
            const prev = char.socialProfile;
            updateCharacter(char.id, {
                socialProfile: {
                    handle: prev?.handle || gen.handle,
                    region: prev?.region || gen.region,
                    bio: prev?.bio || gen.bio,
                },
            });
        } catch { /* 生成失败下次进入再补 */ } finally {
            generatingRef.current = false;
            setGenerating(false);
        }
    };

    // 首次进入该角色主页：微信号/地区/签名有空缺就 AI 补全（每个角色只自动触发一次；
    // API 配置未就绪时不消耗机会，等配置加载后再触发）
    useEffect(() => {
        const sp = char.socialProfile;
        const missing = !sp?.handle || !sp?.region || !sp?.bio;
        if (!missing || !apiConfig?.apiKey || !apiConfig?.baseUrl) return;
        if (autoGenCharRef.current === char.id) return;
        autoGenCharRef.current = char.id;
        runGenerate();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [char.id, apiConfig?.apiKey, apiConfig?.baseUrl]);

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
            } catch { /* 朋友圈取不到就空着 */ }
        })();
        return () => { cancelled = true; };
    }, [char.id]);

    const pendingText = generating ? '生成中…' : '';
    const wechatId = char.socialProfile?.handle || pendingText || `moro_${char.id.slice(0, 10)}`;
    const region = char.socialProfile?.region || pendingText;
    const bio = char.socialProfile?.bio || pendingText;

    return (
        <div
            className="absolute inset-0 z-[300] flex flex-col bg-[#ededed] text-[#191919] animate-fade-in"
            style={{ paddingTop: 'max(8px, var(--safe-top))' }}
        >
            {/* 顶栏：返回 / 更多（朋友设置：星标、黑名单、删除好友等） */}
            <div className="flex items-center justify-between px-2 py-2 shrink-0">
                <button onClick={onBack} className="p-2 active:opacity-50" aria-label="返回">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.2} stroke="currentColor" className="w-6 h-6">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                    </svg>
                </button>
                <button onClick={() => setShowFriendSettings(true)} className="p-2 active:opacity-50" aria-label="朋友设置">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
                        <path d="M6 12a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm7.5 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm7.5 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z" />
                    </svg>
                </button>
            </div>

            <div className="flex-1 overflow-y-auto no-scrollbar">
                {/* 基本信息：微信号/地区/签名首次生成后固定展示；
                    会话设置「身份卡画板」作为顶部背景 */}
                <div
                    className="px-6 pt-2 pb-6 flex items-start gap-4 relative"
                    style={char.convoSettings?.idCardImage ? {
                        backgroundImage: `linear-gradient(rgba(237,237,237,0.55), rgba(237,237,237,0.88)), url(${char.convoSettings.idCardImage})`,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                    } : undefined}
                >
                    <img
                        src={char.avatar}
                        alt={char.name}
                        className="w-16 h-16 rounded-lg object-cover shrink-0 shadow-sm"
                    />
                    <div className="flex-1 min-w-0 pt-0.5">
                        <div className="text-[22px] font-bold leading-tight truncate flex items-center gap-1.5">
                            <span className="truncate">{char.name}</span>
                            {char.starredFriend && <span className="text-[#f7ba2a] text-[16px] shrink-0">★</span>}
                        </div>
                        <div className="text-[14px] text-[#7f7f7f] mt-1.5 truncate">微信号：{wechatId}</div>
                        {region && <div className="text-[14px] text-[#7f7f7f] mt-0.5 truncate">地区：{region}</div>}
                        {bio && <div className="text-[13px] text-[#9b9b9b] mt-0.5 line-clamp-2">{bio}</div>}
                    </div>
                </div>

                {/* 朋友资料（保留原角色设置入口） */}
                <button
                    onClick={onOpenSettings}
                    className="w-full bg-white px-5 py-4 text-left active:bg-[#f5f5f5] border-t border-[#e3e3e3]"
                >
                    <div className="flex items-center justify-between">
                        <span className="text-[17px] font-medium">朋友资料</span>
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-[#c7c7c7] shrink-0">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                        </svg>
                    </div>
                    <p className="text-[13px] text-[#b0b0b0] mt-1.5 leading-relaxed">
                        查看与编辑 TA 的人设、记忆与印象，并设置相处方式。
                    </p>
                </button>

                {/* 朋友圈照片条 */}
                <button
                    onClick={onOpenMoments}
                    className="w-full bg-white px-5 py-4 mt-2 text-left active:bg-[#f5f5f5] flex items-center gap-4"
                >
                    <span className="text-[17px] font-medium shrink-0">朋友圈</span>
                    <div className="flex-1 flex items-center gap-1.5 overflow-hidden justify-start min-w-0">
                        {momentImages.map((img, i) => (
                            <img key={i} src={img} alt="" className="w-[68px] h-[68px] rounded object-cover shrink-0" loading="lazy" />
                        ))}
                    </div>
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-[#c7c7c7] shrink-0">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                    </svg>
                </button>

                {/* 操作区：发消息 / 音视频通话 */}
                <div className="mt-2 bg-white">
                    <button
                        onClick={onSendMessage}
                        className="w-full py-4 flex items-center justify-center gap-2.5 text-[#576b95] text-[17px] font-medium active:bg-[#f5f5f5]"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-5 h-5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
                        </svg>
                        发消息
                    </button>
                    <div className="h-px bg-[#ededed] mx-5" />
                    <button
                        onClick={onVoiceCall}
                        className="w-full py-4 flex items-center justify-center gap-2.5 text-[#576b95] text-[17px] font-medium active:bg-[#f5f5f5]"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-5 h-5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
                        </svg>
                        音视频通话
                    </button>
                </div>
            </div>

            {/* 朋友设置子页（仿微信） */}
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
