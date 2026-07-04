import React, { useCallback, useState } from 'react';
import { useOS } from '../context/OSContext';
import Character from './Character';
import PersonaApp from './PersonaApp';
import { AppID } from '../types';
import { PAPER_TONES, MONO_STACK } from '../components/handbook/paper';
import { CaretLeft } from '@phosphor-icons/react';
import { scrollToManualAnchor, useManualDeepLink, type ManualDeepLinkTarget } from '../utils/manualDeepLink';

/**
 * 剪影集：角色资料与用户身份的统一入口。
 * 两个子页通过 onExit 回到本页，不直接回桌面。
 */

const INK = '#2f3432';
const CARD = 'bg-white press-soft';
const CARD_STYLE: React.CSSProperties = { borderRadius: 18, border: '1px solid #e6ece8', boxShadow: '0 1px 2px rgba(47,64,60,0.08), 0 14px 30px -24px rgba(47,64,60,0.34)' };
const DOT_BG: React.CSSProperties = {
    background: '#f5f7f4',
};

const isGeneratedLetterAvatar = (src?: string) => {
    if (!src?.startsWith('data:image/svg+xml')) return false;
    let decoded = src;
    try { decoded = decodeURIComponent(src); } catch {}
    return decoded.includes('<text') && decoded.includes('font-size="50"');
};

const usablePhoto = (src?: string) => (src && !isGeneratedLetterAvatar(src) ? src : '');

const PhotoSilhouette: React.FC<{ tone?: 'sage' | 'blue' }> = ({ tone = 'sage' }) => (
    <div className="h-full w-full flex items-center justify-center" style={{ background: tone === 'blue' ? '#edf5f7' : '#eef5ef' }}>
        <div className="w-[64%] h-[68%] rounded-[10px] border" style={{ borderColor: tone === 'blue' ? '#cbdde3' : '#d5e1da', background: 'rgba(255,255,255,0.34)' }} />
    </div>
);

const MiniPolaroid: React.FC<{
    src?: string;
    label: string;
    tone?: 'sage' | 'blue';
    className?: string;
}> = ({ src, label, tone = 'sage', className }) => {
    const photo = usablePhoto(src);
    return (
        <div className={`absolute bg-white rounded-[15px] p-2 pb-6 w-[112px] shadow-[0_14px_28px_-18px_rgba(47,64,60,0.46)] ${className || ''}`} style={{ border: '1px solid #e6ece8' }}>
            <div className="aspect-[4/5] rounded-[11px] overflow-hidden">
                {photo ? <img src={photo} alt={label} className="w-full h-full object-cover" /> : <PhotoSilhouette tone={tone} />}
            </div>
            <div className="absolute bottom-2 inset-x-3 text-[9px] font-black text-center truncate" style={{ color: INK }}>{label}</div>
        </div>
    );
};

const MiniPhotoStack: React.FC<{
    photos: { id: string; src?: string; label: string }[];
    fallbackLabel: string;
    tone?: 'sage' | 'blue';
}> = ({ photos, fallbackLabel, tone = 'sage' }) => {
    const list = photos.length > 0 ? photos.slice(0, 2) : [{ id: 'fallback', label: fallbackLabel }];
    const hasSecond = list.length > 1;
    return (
        <div className="relative h-[168px] w-[164px]">
            {list[1] && <MiniPolaroid src={list[1].src} label={list[1].label} tone={tone} className="left-12 top-4 rotate-[7deg] opacity-95" />}
            <MiniPolaroid
                src={list[0].src}
                label={list[0].label}
                tone={tone}
                className={hasSecond ? "left-0 top-0 rotate-[-4deg]" : "left-1/2 top-0 -translate-x-1/2 rotate-[-4deg]"}
            />
        </div>
    );
};

const EntryCard: React.FC<{
    title: string;
    eyebrow: string;
    desc: string;
    tone: 'sage' | 'blue';
    photos: { id: string; src?: string; label: string }[];
    fallbackLabel: string;
    manualAnchor?: string;
    onClick: () => void;
}> = ({ title, eyebrow, desc, tone, photos, fallbackLabel, manualAnchor, onClick }) => (
    <button
        data-manual-anchor={manualAnchor}
        onClick={onClick}
        className={`relative w-full min-h-[332px] p-6 max-[420px]:p-5 text-left select-none overflow-hidden flex flex-col justify-between gap-4 ${CARD}`}
        style={CARD_STYLE}
    >
        <div className="relative z-10">
            <div className="text-[9px] tracking-[0.18em] uppercase" style={{ ...MONO_STACK, color: PAPER_TONES.inkFaint }}>{eyebrow}</div>
            <div className="text-[28px] max-[420px]:text-2xl font-black tracking-normal mt-1 leading-tight">{title}</div>
            <div className="text-[13px] max-[420px]:text-[12px] mt-2 leading-relaxed" style={{ color: PAPER_TONES.inkSoft }}>{desc}</div>
        </div>
        <div className="relative z-0 mx-auto shrink-0">
            <MiniPhotoStack photos={photos} fallbackLabel={fallbackLabel} tone={tone} />
        </div>
    </button>
);

const PersonaHubApp: React.FC = () => {
    const { closeApp, characters, userProfile, activeApp } = useOS();
    const [section, setSection] = useState<'library' | 'char' | 'user'>('library');
    const [manualChildTarget, setManualChildTarget] = useState<{ anchorId?: string; nonce: number } | null>(null);
    const previewCharacters = characters.slice(0, 2);
    const userPhotos = [{ id: 'user', src: userProfile.avatar, label: userProfile.name || '你' }];

    const openManualTarget = useCallback((target: ManualDeepLinkTarget) => {
        const anchorId = target.anchorId;
        const route = target.route || '';
        const payloadSection = typeof target.payload?.section === 'string' ? target.payload.section : '';
        const wantsUser = payloadSection === 'user' || route.includes('user') || anchorId === 'manual-personas-user';
        const wantsChar = payloadSection === 'char'
            || route.includes('char')
            || anchorId === 'manual-personas-characters'
            || anchorId === 'manual-personas-character-export';

        if (wantsUser) {
            setManualChildTarget(null);
            setSection('user');
            window.setTimeout(() => {
                if (!scrollToManualAnchor(anchorId)) scrollToManualAnchor('manual-personas-user');
            }, 220);
            return;
        }

        if (wantsChar) {
            setManualChildTarget({ anchorId, nonce: Date.now() });
            setSection('char');
            return;
        }

        setManualChildTarget(null);
        setSection('library');
        window.setTimeout(() => {
            if (!scrollToManualAnchor(anchorId)) scrollToManualAnchor('manual-personas-root');
        }, 120);
    }, []);

    useManualDeepLink(AppID.Personas, openManualTarget, { enabled: activeApp === AppID.Personas });

    if (section === 'char') return <Character onExit={() => { setManualChildTarget(null); setSection('library'); }} manualTarget={manualChildTarget || undefined} />;
    if (section === 'user') return <PersonaApp onExit={() => { setManualChildTarget(null); setSection('library'); }} />;

    return (
        <div
            data-manual-anchor="manual-personas-root"
            className="absolute inset-0 flex flex-col text-[#2f3432] animate-fade-in"
            style={DOT_BG}
        >
            {/* 顶栏 */}
            <div className="relative flex items-center px-4 pt-3 pb-2 shrink-0 bg-[#f5f7f4]/95 backdrop-blur border-b border-[#e6ece8]">
                <button
                    onClick={closeApp}
                    className="w-9 h-9 rounded-full bg-white flex items-center justify-center active:scale-90 transition-transform shrink-0"
                    style={{ color: '#405f56', border: '1px solid #dfe7e1', boxShadow: '0 1px 3px rgba(47,64,60,0.14)' }}
                    aria-label="返回"
                >
                    <CaretLeft size={18} weight="bold" />
                </button>
                <div className="min-w-0 text-left select-none">
                    <div className="text-[9px] tracking-[0.18em] uppercase" style={{ ...MONO_STACK, color: PAPER_TONES.inkFaint }}>PROFILE CENTER</div>
                    <div className="text-[11px] mt-0.5" style={{ color: PAPER_TONES.inkSoft }}>资料管理</div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto no-scrollbar px-4 pb-6 pt-2 flex flex-col gap-5">
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

                <div className="grid grid-cols-2 max-[420px]:grid-cols-1 gap-4 min-h-[332px] max-[420px]:min-h-[684px]">
                    <EntryCard
                        title="登场人物"
                        eyebrow="CHARACTERS"
                        desc="角色卡、开场白、记忆、语音。"
                        tone="sage"
                        photos={previewCharacters.map(c => ({ id: c.id, src: c.avatar, label: c.name }))}
                        fallbackLabel="角色"
                        manualAnchor="manual-personas-characters"
                        onClick={() => { setManualChildTarget(null); setSection('char'); }}
                    />
                    <EntryCard
                        title="用户身份"
                        eyebrow="USER PERSONAS"
                        desc="默认身份、角色绑定、注入设置。"
                        tone="blue"
                        photos={userPhotos}
                        fallbackLabel="身份"
                        manualAnchor="manual-personas-user"
                        onClick={() => { setManualChildTarget(null); setSection('user'); }}
                    />
                </div>
            </div>
        </div>
    );
};

export default PersonaHubApp;
