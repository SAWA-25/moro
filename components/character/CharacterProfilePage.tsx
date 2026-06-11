import React, { useEffect, useRef, useState } from 'react';
import { CharacterProfile } from '../../types';
import { DB } from '../../utils/db';
import { useOS } from '../../context/OSContext';
import { generateSocialProfile } from '../../utils/socialProfileGen';

/**
 * 角色主页（微信好友资料页风格）：
 * 头像/名字/微信号/地区 → 朋友资料 → 朋友圈照片条 → 发消息 / 音视频通话。
 * 聊天界面单击角色头像进入；原「进入角色设置」入口移到右上角 ··· 和「朋友资料」行。
 * 微信号/地区/签名由 AI 按人设自动生成：首次进入缺啥补啥并持久化，也可手动「换一换」。
 */

interface CharacterProfilePageProps {
    char: CharacterProfile;
    onBack: () => void;
    onSendMessage: () => void;
    onVoiceCall: () => void;
    onOpenSettings: () => void;
    onOpenMoments: () => void;
}

const CharacterProfilePage: React.FC<CharacterProfilePageProps> = ({
    char, onBack, onSendMessage, onVoiceCall, onOpenSettings, onOpenMoments,
}) => {
    const { apiConfig, updateCharacter, addToast } = useOS();
    const [momentImages, setMomentImages] = useState<string[]>([]);
    const [generating, setGenerating] = useState(false);
    const generatingRef = useRef(false);
    const autoGenCharRef = useRef<string | null>(null);

    // force=false：只补空缺字段（首次进入自动触发）；force=true：三项全部重新生成（手动「换一换」）
    const runGenerate = async (force: boolean) => {
        if (generatingRef.current) return;
        if (!apiConfig?.apiKey || !apiConfig?.baseUrl) {
            if (force) addToast('请先在设置中配置 API 后再生成资料', 'error');
            return;
        }
        generatingRef.current = true;
        setGenerating(true);
        try {
            const gen = await generateSocialProfile(apiConfig, char);
            const prev = char.socialProfile;
            updateCharacter(char.id, {
                socialProfile: {
                    handle: force ? gen.handle : (prev?.handle || gen.handle),
                    region: force ? gen.region : (prev?.region || gen.region),
                    bio: force ? gen.bio : (prev?.bio || gen.bio),
                },
            });
        } catch (e: any) {
            if (force) addToast(e?.message || '资料生成失败', 'error');
        } finally {
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
        runGenerate(false);
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
            {/* 顶栏：返回 / 更多（进角色设置） */}
            <div className="flex items-center justify-between px-2 py-2 shrink-0">
                <button onClick={onBack} className="p-2 active:opacity-50" aria-label="返回">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.2} stroke="currentColor" className="w-6 h-6">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                    </svg>
                </button>
                <button onClick={onOpenSettings} className="p-2 active:opacity-50" aria-label="更多（角色设置）">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
                        <path d="M6 12a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm7.5 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm7.5 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z" />
                    </svg>
                </button>
            </div>

            <div className="flex-1 overflow-y-auto no-scrollbar">
                {/* 基本信息 */}
                <div className="px-6 pt-2 pb-6 flex items-start gap-4">
                    <img
                        src={char.avatar}
                        alt={char.name}
                        className="w-16 h-16 rounded-lg object-cover shrink-0 shadow-sm"
                    />
                    <div className="flex-1 min-w-0 pt-0.5">
                        <div className="text-[22px] font-bold leading-tight truncate">{char.name}</div>
                        <div className="text-[14px] text-[#7f7f7f] mt-1.5 truncate">微信号：{wechatId}</div>
                        {region && <div className="text-[14px] text-[#7f7f7f] mt-0.5 truncate">地区：{region}</div>}
                        {bio && <div className="text-[13px] text-[#9b9b9b] mt-0.5 line-clamp-2">{bio}</div>}
                        {/* AI 重新生成微信号/地区/签名 */}
                        <button
                            onClick={() => runGenerate(true)}
                            disabled={generating}
                            className="mt-2 inline-flex items-center gap-1 text-[12px] text-[#9b9b9b] active:opacity-50 disabled:opacity-40"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
                                className={`w-3.5 h-3.5 ${generating ? 'animate-spin' : ''}`}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                            </svg>
                            {generating ? '正在生成资料…' : '换一换'}
                        </button>
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
        </div>
    );
};

export default CharacterProfilePage;
