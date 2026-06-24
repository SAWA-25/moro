
import React, { useState, useEffect } from 'react';
import JournalSheet, { SealBtn, CandyToggle, StickerChip, LinedInput, NoteStrip } from './JournalSheet';
import { MONO_STACK, CUTE_STACK, PAPER_TONES } from '../handbook/paper';
import { CharacterProfile } from '../../types';
import { getNotifyPermission, requestNotifyPermission, detectBrowser, isRecommendedForWebNotify, type NotifyPermission } from '../../utils/browserNotify';

interface ProactiveSettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    char: CharacterProfile;
    isProactiveActive: boolean;
    onSave: (config: NonNullable<CharacterProfile['proactiveConfig']>) => void;
    onStop: () => void;
}

const INTERVAL_OPTIONS = [
    { label: '半小时', value: 30 },
    { label: '1 小时', value: 60 },
    { label: '2 小时', value: 120 },
    { label: '4 小时', value: 240 },
    { label: '8 小时', value: 480 },
    { label: '12 小时', value: 720 },
    { label: '一整天', value: 1440 },
];

const ProactiveSettingsModal: React.FC<ProactiveSettingsModalProps> = ({
    isOpen, onClose, char, isProactiveActive, onSave, onStop
}) => {
    const saved = char.proactiveConfig;
    const [enabled, setEnabled] = useState(saved?.enabled ?? false);
    const [interval, setInterval_] = useState(saved?.intervalMinutes ?? 60);
    const [randomMode, setRandomMode] = useState(saved?.randomMode ?? false);
    const [autonomousLife, setAutonomousLife] = useState(saved?.autonomousLifeEnabled ?? true);
    const [notifyPerm, setNotifyPerm] = useState<NotifyPermission>(() => getNotifyPermission());
    const [useSecondaryApi, setUseSecondaryApi] = useState(saved?.useSecondaryApi ?? false);
    const [secUrl, setSecUrl] = useState(saved?.secondaryApi?.baseUrl ?? '');
    const [secKey, setSecKey] = useState(saved?.secondaryApi?.apiKey ?? '');
    const [secModel, setSecModel] = useState(saved?.secondaryApi?.model ?? '');
    const [showApiSection, setShowApiSection] = useState(saved?.useSecondaryApi ?? false);

    // Reset form when modal opens with new char data
    useEffect(() => {
        if (isOpen) {
            const s = char.proactiveConfig;
            setEnabled(s?.enabled ?? false);
            setInterval_(s?.intervalMinutes ?? 60);
            setRandomMode(s?.randomMode ?? false);
            setAutonomousLife(s?.autonomousLifeEnabled ?? true);
            setNotifyPerm(getNotifyPermission());
            setUseSecondaryApi(s?.useSecondaryApi ?? false);
            setSecUrl(s?.secondaryApi?.baseUrl ?? '');
            setSecKey(s?.secondaryApi?.apiKey ?? '');
            setSecModel(s?.secondaryApi?.model ?? '');
            setShowApiSection(s?.useSecondaryApi ?? false);
        }
    }, [isOpen, char.id]);

    const handleRequestNotify = async () => {
        const perm = await requestNotifyPermission();
        setNotifyPerm(perm);
    };

    const handleSave = () => {
        onSave({
            enabled,
            intervalMinutes: interval,
            randomMode,
            autonomousLifeEnabled: autonomousLife,
            useSecondaryApi: useSecondaryApi && !!secUrl,
            secondaryApi: useSecondaryApi && secUrl ? {
                baseUrl: secUrl,
                apiKey: secKey,
                model: secModel,
            } : undefined,
        });
        onClose();
    };

    const handleStop = () => {
        onStop();
        setEnabled(false);
        onClose();
    };

    return (
        <JournalSheet
            open={isOpen} title="悄悄来信" en="Surprise Mail"
            sub={`让 ${char.name} 隔三差五先想起你`}
            tape="lavender" pattern="heart" paper="dot"
            onClose={onClose}
            footer={<>
                <SealBtn kind="ghost" onClick={onClose}>先不安排</SealBtn>
                {isProactiveActive && <SealBtn kind="berry" onClick={handleStop}>叫停信差</SealBtn>}
                <SealBtn kind="rose" onClick={handleSave}>{enabled ? '派出信差' : '记下安排'}</SealBtn>
            </>}
        >
            <div className="space-y-4">
                {/* 总开关 */}
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                            <span className="text-[11px] leading-none" style={{ color: PAPER_TONES.accentBlush }} aria-hidden>✉</span>
                            <span className="text-[12.5px] font-bold" style={{ ...CUTE_STACK, color: '#1f1d1a' }}>开启悄悄来信</span>
                        </div>
                        <p className="text-[10px] mt-1 leading-relaxed" style={{ color: '#857f74' }}>
                            开了之后，{char.name} 会按下面的安排自己先发消息来——就像真人忽然想起你，随手敲来一句。
                        </p>
                    </div>
                    <CandyToggle on={enabled} onToggle={() => setEnabled(!enabled)} candy="#bfa3dd" />
                </div>

                {/* 进行中提示 */}
                {isProactiveActive && (
                    <div className="flex items-center gap-2 rounded-[8px] px-3 py-2" style={{ background: 'rgba(240,250,245,0.9)', border: '1px dashed #bfe1cf' }}>
                        <span className="w-2 h-2 rounded-full animate-pulse shrink-0" style={{ background: '#5ca57f' }} />
                        <span className="text-[11px] font-bold" style={{ ...CUTE_STACK, color: '#3f7d5c' }}>信差已经在路上，TA 会挑时候来信</span>
                    </div>
                )}

                {enabled && (
                    <>
                        {/* 离线自主生活 */}
                        <div className="flex items-start justify-between gap-3 rounded-[8px] px-3 py-2.5" style={{ background: 'rgba(250,245,255,0.85)', border: '1px dashed #ddc9e8' }}>
                            <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                    <span className="text-[11px] leading-none" aria-hidden>🌱</span>
                                    <span className="text-[12.5px] font-bold" style={{ ...CUTE_STACK, color: '#1f1d1a' }}>让 TA 过自己的生活</span>
                                </div>
                                <p className="text-[10px] mt-1 leading-relaxed" style={{ color: '#857f74' }}>
                                    开了之后，{char.name} 在你不在时会有自己的日常（上班、吃饭、追剧、和朋友出门…）。
                                    来信会从 TA 正在经历的事里取材——分享自己的生活，而不是每次都催你回复。
                                    你离开一阵子再回来，还能看到「你不在时 TA 经历了…」的回顾。
                                </p>
                            </div>
                            <CandyToggle on={autonomousLife} onToggle={() => setAutonomousLife(!autonomousLife)} candy="#c8a3dd" />
                        </div>

                        {/* 触发方式 */}
                        <div className="pt-1">
                            <div className="text-[9px] mb-2 tracking-[0.22em] uppercase select-none" style={{ ...MONO_STACK, color: '#857f74' }}>什么时候来信</div>
                            <div className="flex gap-2 mb-3">
                                <StickerChip seed="pm-fixed" active={!randomMode} candy="#d6c8e8" onClick={() => setRandomMode(false)}>掐着点来</StickerChip>
                                <StickerChip seed="pm-random" active={randomMode} candy="#d6c8e8" onClick={() => setRandomMode(true)}>凭 TA 心情</StickerChip>
                            </div>
                            {randomMode ? (
                                <NoteStrip>
                                    时机交给 TA：系统会在后台悄悄安排（不告诉你具体时间）。当你有一阵子没回消息，
                                    {char.name} 会照着自己的性子决定要不要先开口、说点什么——全凭人设来。
                                </NoteStrip>
                            ) : (
                                <>
                                    <div className="text-[9px] mb-2 tracking-[0.22em] uppercase select-none" style={{ ...MONO_STACK, color: '#857f74' }}>隔多久寄一封</div>
                                    <div className="flex flex-wrap gap-2">
                                        {INTERVAL_OPTIONS.map(opt => (
                                            <StickerChip
                                                key={opt.value} seed={`iv-${opt.value}`}
                                                active={interval === opt.value}
                                                onClick={() => setInterval_(opt.value)}
                                            >{opt.label}</StickerChip>
                                        ))}
                                    </div>
                                    {/* 自定义分钟数：与预设档互斥高亮 */}
                                    <div className="flex items-center gap-2 mt-2.5">
                                        <StickerChip
                                            seed="iv-custom"
                                            active={!INTERVAL_OPTIONS.some(o => o.value === interval)}
                                            onClick={() => { /* 输入框改值即生效 */ }}
                                        >自己定</StickerChip>
                                        <input
                                            type="number"
                                            min={5}
                                            value={interval}
                                            onChange={e => setInterval_(Math.max(5, parseInt(e.target.value) || 5))}
                                            className="w-16 px-1 py-0.5 text-[12px] text-center bg-transparent outline-none border-0 border-b border-dashed border-[#b0aa9e] focus:border-[#857f74]"
                                            style={{ color: '#1f1d1a', caretColor: '#857f74' }}
                                        />
                                        <span className="text-[10px]" style={{ color: '#857f74' }}>分钟一封（最少 5 分钟）</span>
                                    </div>
                                </>
                            )}
                        </div>

                        {/* 副 API */}
                        <div className="pt-3 border-t border-dashed" style={{ borderColor: 'rgba(122,90,114,0.18)' }}>
                            <div className="flex items-start justify-between gap-3 mb-1">
                                <div className="min-w-0">
                                    <span className="text-[12.5px] font-bold" style={{ ...CUTE_STACK, color: '#1f1d1a' }}>走另一条邮路（副 API）</span>
                                    <p className="text-[10px] mt-1 leading-relaxed" style={{ color: '#857f74' }}>
                                        来信单独走一条 API，不占主线路的额度；不开就还走主 API。
                                    </p>
                                </div>
                                <CandyToggle
                                    on={useSecondaryApi}
                                    onToggle={() => { setUseSecondaryApi(!useSecondaryApi); setShowApiSection(!useSecondaryApi); }}
                                />
                            </div>

                            {showApiSection && (
                                <div className="space-y-3 rounded-[8px] p-3 mt-2" style={{ background: 'rgba(255,253,250,0.7)', border: '1px dashed #ddc9d3' }}>
                                    <LinedInput
                                        tag="POST ROAD · URL"
                                        type="text"
                                        value={secUrl}
                                        onChange={e => setSecUrl(e.target.value)}
                                        placeholder="https://api.example.com/v1"
                                    />
                                    <LinedInput
                                        tag="KEY"
                                        type="password"
                                        value={secKey}
                                        onChange={e => setSecKey(e.target.value)}
                                        placeholder="sk-..."
                                    />
                                    <LinedInput
                                        tag="MODEL"
                                        type="text"
                                        value={secModel}
                                        onChange={e => setSecModel(e.target.value)}
                                        placeholder="gpt-4o-mini"
                                    />
                                </div>
                            )}
                        </div>

                        {/* 离线消息弹窗 · 浏览器授权 */}
                        <div className="pt-3 border-t border-dashed" style={{ borderColor: 'rgba(122,90,114,0.18)' }}>
                            <div className="flex items-center gap-1.5">
                                <span className="text-[11px] leading-none" aria-hidden>📣</span>
                                <span className="text-[12.5px] font-bold" style={{ ...CUTE_STACK, color: '#1f1d1a' }}>离线也能收到弹窗</span>
                            </div>
                            <p className="text-[10px] mt-1 leading-relaxed" style={{ color: '#857f74' }}>
                                授权一次浏览器通知，{char.name} 来信时即使你切到别的标签或最小化，也会弹出系统通知。电脑版 Chrome / Edge 体验最好。
                            </p>
                            <div className="mt-2.5">
                                {notifyPerm === 'granted' && (
                                    <div className="inline-flex items-center gap-1.5 rounded-[8px] px-3 py-1.5" style={{ background: 'rgba(240,250,245,0.9)', border: '1px dashed #bfe1cf' }}>
                                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: '#5ca57f' }} />
                                        <span className="text-[11px] font-bold" style={{ ...CUTE_STACK, color: '#3f7d5c' }}>浏览器通知已开启</span>
                                    </div>
                                )}
                                {notifyPerm === 'default' && (
                                    <button type="button" onClick={handleRequestNotify}
                                        className="rounded-[10px] px-3.5 py-1.5 text-[11.5px] font-bold transition active:scale-95"
                                        style={{ ...CUTE_STACK, color: '#fff', background: 'linear-gradient(135deg,#c8a3dd,#857f74)', boxShadow: '0 2px 6px rgba(200,140,180,0.35)' }}>
                                        开启浏览器通知
                                    </button>
                                )}
                                {notifyPerm === 'denied' && (
                                    <NoteStrip>
                                        浏览器已拒绝通知权限。请点地址栏左侧的 🔒 / ⓘ 图标 →「通知」改为「允许」，再回到这里即可。
                                    </NoteStrip>
                                )}
                                {notifyPerm === 'unsupported' && (
                                    <NoteStrip>
                                        当前环境不支持网页通知。建议用电脑版 Chrome 或 Edge 打开；iOS 需先把 Moro「添加到主屏幕」装成 App。
                                    </NoteStrip>
                                )}
                            </div>
                            {notifyPerm !== 'granted' && notifyPerm !== 'unsupported' && !isRecommendedForWebNotify() && (
                                <p className="text-[9.5px] mt-2 leading-relaxed" style={{ color: '#857f74' }}>
                                    提示：当前是 {detectBrowser().name}。离线弹窗在电脑版 Chrome / Edge 上最稳定。
                                </p>
                            )}
                        </div>
                    </>
                )}
            </div>
        </JournalSheet>
    );
};

export default React.memo(ProactiveSettingsModal);
