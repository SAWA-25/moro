
import React, { useState, useEffect } from 'react';
import JournalSheet, { SealBtn, CandyToggle, StickerChip, NoteStrip } from './JournalSheet';
import { MONO_STACK, CUTE_STACK, PAPER_TONES } from '../handbook/paper';
import { CharacterProfile } from '../../types';
import { getNotifyPermission, requestNotifyPermission, detectBrowser, isNativeNotificationRuntime, isRecommendedForWebNotify, type NotifyPermission } from '../../utils/browserNotify';
import LlmApiConfigFields from '../settings/LlmApiConfigFields';

interface ProactiveSettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    char: CharacterProfile;
    isProactiveActive: boolean;
    onSave: (config: NonNullable<CharacterProfile['proactiveConfig']>) => void;
    onStop: () => void;
}

type ProactiveConfig = NonNullable<CharacterProfile['proactiveConfig']>;
type ProactiveIntensity = NonNullable<ProactiveConfig['intensity']>;
type LifeDensity = NonNullable<ProactiveConfig['lifeDensity']>;
type MessageFlavor = NonNullable<ProactiveConfig['messageFlavor']>;
type MaterialSource = NonNullable<ProactiveConfig['materialSources']>[number];
type QuietBehavior = NonNullable<NonNullable<ProactiveConfig['quietHours']>['behavior']>;

const INTERVAL_OPTIONS = [
    { label: '半小时', value: 30 },
    { label: '1 小时', value: 60 },
    { label: '2 小时', value: 120 },
    { label: '4 小时', value: 240 },
    { label: '8 小时', value: 480 },
    { label: '12 小时', value: 720 },
    { label: '一整天', value: 1440 },
];

const INTENSITY_OPTIONS: Array<{ id: ProactiveIntensity; label: string; desc: string }> = [
    { id: 'quiet', label: '克制', desc: '更少打扰' },
    { id: 'balanced', label: '自然', desc: '默认节奏' },
    { id: 'chatty', label: '热络', desc: '更容易来信' },
    { id: 'unfiltered', label: '随性', desc: '冲动也会发' },
];

const DENSITY_OPTIONS: Array<{ id: LifeDensity; label: string; desc: string }> = [
    { id: 'sparse', label: '稀疏', desc: '只记关键片段' },
    { id: 'normal', label: '普通', desc: '日常连贯' },
    { id: 'busy', label: '忙碌', desc: '更多碎片' },
];

const FLAVOR_OPTIONS: Array<{ id: MessageFlavor; label: string }> = [
    { id: 'natural', label: '自然' },
    { id: 'self', label: '自我' },
    { id: 'warm', label: '温软' },
    { id: 'playful', label: '俏皮' },
    { id: 'moody', label: '情绪化' },
];

const MATERIAL_OPTIONS: Array<{ id: MaterialSource; label: string }> = [
    { id: 'life', label: '生活' },
    { id: 'recentChat', label: '近聊' },
    { id: 'schedule', label: '作息' },
    { id: 'realtime', label: '实时' },
];

const ProactiveSettingsModal: React.FC<ProactiveSettingsModalProps> = ({
    isOpen, onClose, char, isProactiveActive, onSave, onStop
}) => {
    const saved = char.proactiveConfig;
    const [enabled, setEnabled] = useState(saved?.enabled ?? false);
    const [interval, setInterval_] = useState(saved?.intervalMinutes ?? 60);
    const [randomMode, setRandomMode] = useState(saved?.randomMode ?? false);
    const [autonomousLife, setAutonomousLife] = useState(saved?.autonomousLifeEnabled ?? true);
    const [intensity, setIntensity] = useState<ProactiveIntensity>(saved?.intensity ?? 'balanced');
    const [lifeDensity, setLifeDensity] = useState<LifeDensity>(saved?.lifeDensity ?? 'normal');
    const [messageFlavor, setMessageFlavor] = useState<MessageFlavor>(saved?.messageFlavor ?? 'natural');
    const [materialSources, setMaterialSources] = useState<MaterialSource[]>(saved?.materialSources?.length ? saved.materialSources : ['life', 'recentChat', 'schedule', 'realtime']);
    const [smartSkipEnabled, setSmartSkipEnabled] = useState(saved?.smartSkipEnabled ?? true);
    const [quietEnabled, setQuietEnabled] = useState(saved?.quietHours?.enabled ?? false);
    const [quietStart, setQuietStart] = useState(saved?.quietHours?.start ?? '23:00');
    const [quietEnd, setQuietEnd] = useState(saved?.quietHours?.end ?? '07:00');
    const [quietBehavior, setQuietBehavior] = useState<QuietBehavior>(saved?.quietHours?.behavior ?? 'life_only');
    const [notifyPerm, setNotifyPerm] = useState<NotifyPermission>(() => getNotifyPermission());
    const [useSecondaryApi, setUseSecondaryApi] = useState(saved?.useSecondaryApi ?? false);
    const [secUrl, setSecUrl] = useState(saved?.secondaryApi?.baseUrl ?? '');
    const [secKey, setSecKey] = useState(saved?.secondaryApi?.apiKey ?? '');
    const [secModel, setSecModel] = useState(saved?.secondaryApi?.model ?? '');
    const [showApiSection, setShowApiSection] = useState(saved?.useSecondaryApi ?? false);
    const nativeNotify = isNativeNotificationRuntime();

    // Reset form when modal opens with new char data
    useEffect(() => {
        if (isOpen) {
            const s = char.proactiveConfig;
            setEnabled(s?.enabled ?? false);
            setInterval_(s?.intervalMinutes ?? 60);
            setRandomMode(s?.randomMode ?? false);
            setAutonomousLife(s?.autonomousLifeEnabled ?? true);
            setIntensity(s?.intensity ?? 'balanced');
            setLifeDensity(s?.lifeDensity ?? 'normal');
            setMessageFlavor(s?.messageFlavor ?? 'natural');
            setMaterialSources(s?.materialSources?.length ? s.materialSources : ['life', 'recentChat', 'schedule', 'realtime']);
            setSmartSkipEnabled(s?.smartSkipEnabled ?? true);
            setQuietEnabled(s?.quietHours?.enabled ?? false);
            setQuietStart(s?.quietHours?.start ?? '23:00');
            setQuietEnd(s?.quietHours?.end ?? '07:00');
            setQuietBehavior(s?.quietHours?.behavior ?? 'life_only');
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
            intensity,
            lifeDensity,
            messageFlavor,
            materialSources,
            smartSkipEnabled,
            quietHours: {
                enabled: quietEnabled,
                start: quietStart,
                end: quietEnd,
                behavior: quietBehavior,
            },
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

    const toggleMaterial = (id: MaterialSource) => {
        setMaterialSources(prev => {
            const has = prev.includes(id);
            const next = has ? prev.filter(x => x !== id) : [...prev, id];
            return next.length ? next : prev;
        });
    };

    return (
        <JournalSheet
            open={isOpen} title="主动消息" en="Proactive Messages"
            sub={`设置 ${char.name} 主动发消息的频率和通知方式`}
            tape="lavender" pattern="heart" paper="dot"
            onClose={onClose}
            footer={<>
                <SealBtn kind="ghost" onClick={onClose}>取消</SealBtn>
                {isProactiveActive && <SealBtn kind="berry" onClick={handleStop}>停止主动消息</SealBtn>}
                <SealBtn kind="rose" onClick={handleSave}>{enabled ? '保存设置' : '保存'}</SealBtn>
            </>}
        >
            <div className="space-y-4">
                {/* 总开关 */}
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                            <span className="text-[11px] leading-none" style={{ color: PAPER_TONES.accentBlush }} aria-hidden>✉</span>
                            <span className="text-[12.5px] font-bold" style={{ ...CUTE_STACK, color: '#5a3140' }}>启用主动消息</span>
                        </div>
                        <p className="text-[10px] mt-1 leading-relaxed" style={{ color: '#857f74' }}>
                            开启后，{char.name} 会按下面的触发规则主动发消息。
                        </p>
                    </div>
                    <CandyToggle on={enabled} onToggle={() => setEnabled(!enabled)} candy="#d8a5b7" />
                </div>

                {/* 进行中提示 */}
                {isProactiveActive && (
                    <div className="flex items-center gap-2 rounded-[8px] px-3 py-2" style={{ background: '#fff4f7', border: '1px solid #eed6df' }}>
                        <span className="w-2 h-2 rounded-full animate-pulse shrink-0" style={{ background: '#5ca57f' }} />
                        <span className="text-[11px] font-bold" style={{ ...CUTE_STACK, color: '#5a3140' }}>主动消息已启用，系统会按设置触发</span>
                    </div>
                )}

                {enabled && (
                    <>
                        {/* 离线自主生活 */}
                        <div className="flex items-start justify-between gap-3 rounded-[8px] px-3 py-2.5" style={{ background: '#fffdfa', border: '1px solid #eed6df' }}>
                            <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                    <span className="text-[11px] leading-none" aria-hidden>🌱</span>
                                    <span className="text-[12.5px] font-bold" style={{ ...CUTE_STACK, color: '#5a3140' }}>启用离线生活取材</span>
                                </div>
                                <p className="text-[10px] mt-1 leading-relaxed" style={{ color: '#857f74' }}>
                                    开了之后，{char.name} 在你不在时会有自己的日常（上班、吃饭、追剧、和朋友出门…）。
                                    来信会从 TA 正在经历的事里取材——分享自己的生活，而不是每次都催你回复。
                                    你离开一阵子再回来，还能看到「你不在时 TA 经历了…」的回顾。
                                </p>
                            </div>
                            <CandyToggle on={autonomousLife} onToggle={() => setAutonomousLife(!autonomousLife)} candy="#d8a5b7" />
                        </div>

                        {autonomousLife && (
                            <div className="space-y-3 rounded-[8px] px-3 py-3" style={{ background: '#fffdfa', border: '1px solid #eed6df' }}>
                                <div>
                                    <div className="text-[9px] mb-2 tracking-[0.22em] uppercase select-none" style={{ ...MONO_STACK, color: '#857f74' }}>主动强度</div>
                                    <div className="flex flex-wrap gap-2">
                                        {INTENSITY_OPTIONS.map(opt => (
                                            <StickerChip key={opt.id} seed={`int-${opt.id}`} active={intensity === opt.id} candy="#f3d7e1" onClick={() => setIntensity(opt.id)}>
                                                {opt.label}
                                            </StickerChip>
                                        ))}
                                    </div>
                                    <p className="text-[9.5px] mt-1.5 leading-relaxed" style={{ color: '#857f74' }}>
                                        {INTENSITY_OPTIONS.find(o => o.id === intensity)?.desc}
                                    </p>
                                </div>

                                <div>
                                    <div className="text-[9px] mb-2 tracking-[0.22em] uppercase select-none" style={{ ...MONO_STACK, color: '#857f74' }}>生活密度</div>
                                    <div className="flex flex-wrap gap-2">
                                        {DENSITY_OPTIONS.map(opt => (
                                            <StickerChip key={opt.id} seed={`den-${opt.id}`} active={lifeDensity === opt.id} candy="#d9eadf" onClick={() => setLifeDensity(opt.id)}>
                                                {opt.label}
                                            </StickerChip>
                                        ))}
                                    </div>
                                    <p className="text-[9.5px] mt-1.5 leading-relaxed" style={{ color: '#857f74' }}>
                                        {DENSITY_OPTIONS.find(o => o.id === lifeDensity)?.desc}
                                    </p>
                                </div>

                                <div>
                                    <div className="text-[9px] mb-2 tracking-[0.22em] uppercase select-none" style={{ ...MONO_STACK, color: '#857f74' }}>来信口味</div>
                                    <div className="flex flex-wrap gap-2">
                                        {FLAVOR_OPTIONS.map(opt => (
                                            <StickerChip key={opt.id} seed={`flv-${opt.id}`} active={messageFlavor === opt.id} candy="#f3d7e1" onClick={() => setMessageFlavor(opt.id)}>
                                                {opt.label}
                                            </StickerChip>
                                        ))}
                                    </div>
                                </div>

                                <div>
                                    <div className="text-[9px] mb-2 tracking-[0.22em] uppercase select-none" style={{ ...MONO_STACK, color: '#857f74' }}>取材来源</div>
                                    <div className="flex flex-wrap gap-2">
                                        {MATERIAL_OPTIONS.map(opt => (
                                            <StickerChip key={opt.id} seed={`mat-${opt.id}`} active={materialSources.includes(opt.id)} candy="#d9eadf" onClick={() => toggleMaterial(opt.id)}>
                                                {opt.label}
                                            </StickerChip>
                                        ))}
                                    </div>
                                </div>

                                <div className="flex items-start justify-between gap-3 pt-1">
                                    <div className="min-w-0">
                                        <div className="text-[11.5px] font-bold" style={{ ...CUTE_STACK, color: '#5a3140' }}>智能触发可跳过</div>
                                        <p className="text-[9.5px] leading-relaxed mt-0.5" style={{ color: '#857f74' }}>事件冲动太低时，只写进 TA 的日常，不硬发消息。</p>
                                    </div>
                                    <CandyToggle on={smartSkipEnabled} onToggle={() => setSmartSkipEnabled(!smartSkipEnabled)} candy="#d8a5b7" />
                                </div>

                                <div className="pt-2 border-t" style={{ borderColor: 'rgba(216,165,183,0.35)' }}>
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="text-[11.5px] font-bold" style={{ ...CUTE_STACK, color: '#5a3140' }}>勿扰时段</div>
                                            <p className="text-[9.5px] leading-relaxed mt-0.5" style={{ color: '#857f74' }}>这段时间可以继续过生活，但不一定弹来信。</p>
                                        </div>
                                        <CandyToggle on={quietEnabled} onToggle={() => setQuietEnabled(!quietEnabled)} candy="#d8a5b7" />
                                    </div>
                                    {quietEnabled && (
                                        <div className="mt-2 space-y-2">
                                            <div className="flex items-center gap-2">
                                                <input type="time" value={quietStart} onChange={e => setQuietStart(e.target.value)} className="px-2 py-1 text-[12px] rounded-[8px] bg-white border border-[#eed6df]" style={{ color: '#5a3140' }} />
                                                <span className="text-[10px]" style={{ color: '#857f74' }}>到</span>
                                                <input type="time" value={quietEnd} onChange={e => setQuietEnd(e.target.value)} className="px-2 py-1 text-[12px] rounded-[8px] bg-white border border-[#eed6df]" style={{ color: '#5a3140' }} />
                                            </div>
                                            <div className="flex flex-wrap gap-2">
                                                <StickerChip seed="qh-life" active={quietBehavior === 'life_only'} candy="#f3d7e1" onClick={() => setQuietBehavior('life_only')}>只记生活</StickerChip>
                                                <StickerChip seed="qh-send" active={quietBehavior === 'send'} candy="#f3d7e1" onClick={() => setQuietBehavior('send')}>照常来信</StickerChip>
                                                <StickerChip seed="qh-skip" active={quietBehavior === 'skip'} candy="#f3d7e1" onClick={() => setQuietBehavior('skip')}>完全跳过</StickerChip>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* 触发方式 */}
                        <div className="pt-1">
                            <div className="text-[9px] mb-2 tracking-[0.22em] uppercase select-none" style={{ ...MONO_STACK, color: '#857f74' }}>什么时候来信</div>
                            <div className="flex gap-2 mb-3">
                                <StickerChip seed="pm-fixed" active={!randomMode} candy="#f3d7e1" onClick={() => setRandomMode(false)}>固定间隔</StickerChip>
                                <StickerChip seed="pm-random" active={randomMode} candy="#f3d7e1" onClick={() => setRandomMode(true)}>智能触发</StickerChip>
                            </div>
                            {randomMode ? (
                                <NoteStrip>
                                    系统会根据最近聊天、角色状态和你的离线时间决定是否触发主动消息，不显示固定倒计时；若 24 小时内一直没有可见来信，会在下一次合适触发时兜底发出一封。
                                </NoteStrip>
                            ) : (
                                <>
                                    <div className="text-[9px] mb-2 tracking-[0.22em] uppercase select-none" style={{ ...MONO_STACK, color: '#a892a3' }}>发送间隔</div>
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
                                        >自定义</StickerChip>
                                        <input
                                            type="number"
                                            min={5}
                                            value={interval}
                                            onChange={e => setInterval_(Math.max(5, parseInt(e.target.value) || 5))}
                                            className="w-16 px-1 py-0.5 text-[12px] text-center bg-transparent outline-none border-0 border-b border-[#eed6df] focus:border-[#d8a5b7]"
                                            style={{ color: '#5a3140', caretColor: '#d8a5b7' }}
                                        />
                                        <span className="text-[10px]" style={{ color: '#857f74' }}>分钟一封（最少 5 分钟）</span>
                                    </div>
                                </>
                            )}
                        </div>

                        {/* 副 API */}
                        <div className="pt-3 border-t" style={{ borderColor: 'rgba(216,165,183,0.35)' }}>
                            <div className="flex items-start justify-between gap-3 mb-1">
                                <div className="min-w-0">
                                    <span className="text-[12.5px] font-bold" style={{ ...CUTE_STACK, color: '#5a3140' }}>使用副 API</span>
                                    <p className="text-[10px] mt-1 leading-relaxed" style={{ color: '#857f74' }}>
                                        主动消息单独走副 API；关闭后使用当前主 API。
                                    </p>
                                </div>
                                <CandyToggle
                                    on={useSecondaryApi}
                                    onToggle={() => { setUseSecondaryApi(!useSecondaryApi); setShowApiSection(!useSecondaryApi); }}
                                />
                            </div>

                            {showApiSection && (
                                <div className="space-y-3 rounded-[8px] p-3 mt-2" style={{ background: '#fffdfa', border: '1px solid #eed6df' }}>
                                    <LlmApiConfigFields
                                        value={{ baseUrl: secUrl, apiKey: secKey, model: secModel }}
                                        onChange={next => {
                                            setSecUrl(next.baseUrl);
                                            setSecKey(next.apiKey);
                                            setSecModel(next.model);
                                        }}
                                        savePresetDefaultName={`${char.name} 主动消息 API`}
                                        modelFetchFeatureId="chat.proactiveApi.fetchModels"
                                        compact
                                        inputClassName="w-full px-3 py-2 text-[13px] outline-none placeholder:text-slate-400 rounded-[16px] bg-white border border-[#eed6df] font-mono"
                                        buttonClassName="rounded-full border border-[#eed6df] bg-white px-3 py-2 text-[11px] font-bold text-[#5a3140] active:scale-95 transition-transform disabled:opacity-50"
                                        primaryButtonClassName="rounded-full bg-[#d8a5b7] px-3 py-2 text-[11px] font-bold text-white active:scale-95 transition-transform disabled:opacity-50"
                                    />
                                </div>
                            )}
                        </div>

                        {/* 离线消息弹窗 · 通知授权 */}
                        <div className="pt-3 border-t" style={{ borderColor: 'rgba(216,165,183,0.35)' }}>
                            <div className="flex items-center gap-1.5">
                                <span className="text-[11px] leading-none" aria-hidden>📣</span>
                                <span className="text-[12.5px] font-bold" style={{ ...CUTE_STACK, color: '#5a3140' }}>{nativeNotify ? '启用手机通知' : '启用浏览器通知'}</span>
                            </div>
                            <p className="text-[10px] mt-1 leading-relaxed" style={{ color: '#857f74' }}>
                                {nativeNotify
                                    ? `授权一次手机系统通知，${char.name} 来信时即使 Moro 切到后台，也会进入通知栏。`
                                    : `授权一次浏览器通知，${char.name} 来信时即使你切到别的标签或最小化，也会弹出系统通知。电脑版 Chrome / Edge 体验最好。`}
                            </p>
                            <div className="mt-2.5">
                                {notifyPerm === 'granted' && (
                                    <div className="inline-flex items-center gap-1.5 rounded-[8px] px-3 py-1.5" style={{ background: '#fff4f7', border: '1px solid #eed6df' }}>
                                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: '#5ca57f' }} />
                                        <span className="text-[11px] font-bold" style={{ ...CUTE_STACK, color: '#3f7d5c' }}>{nativeNotify ? '手机通知已开启' : '浏览器通知已开启'}</span>
                                    </div>
                                )}
                                {notifyPerm === 'default' && (
                                    <button type="button" onClick={handleRequestNotify}
                                        className="rounded-[10px] px-3.5 py-1.5 text-[11.5px] font-bold transition active:scale-95"
                                        style={{ ...CUTE_STACK, color: '#fff', background: 'linear-gradient(135deg,#c8a3dd,#857f74)', boxShadow: '0 2px 6px rgba(200,140,180,0.35)' }}>
                                        {nativeNotify ? '开启手机通知' : '开启浏览器通知'}
                                    </button>
                                )}
                                {notifyPerm === 'denied' && (
                                    <NoteStrip>
                                        {nativeNotify
                                            ? '手机系统已拒绝通知权限。请到系统设置 → 应用 → Moro → 通知里改为允许，再回到这里。'
                                            : '浏览器已拒绝通知权限。请点地址栏左侧的 🔒 / ⓘ 图标 →「通知」改为「允许」，再回到这里即可。'}
                                    </NoteStrip>
                                )}
                                {notifyPerm === 'unsupported' && (
                                    <NoteStrip>
                                        {nativeNotify
                                            ? '当前手机系统没有开放通知能力，请检查系统版本或应用通知设置。'
                                            : '当前环境不支持网页通知。建议用电脑版 Chrome 或 Edge 打开；iOS 需先把 Moro「添加到主屏幕」装成 App。'}
                                    </NoteStrip>
                                )}
                            </div>
                            {!nativeNotify && notifyPerm !== 'granted' && notifyPerm !== 'unsupported' && !isRecommendedForWebNotify() && (
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
