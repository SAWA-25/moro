import React, { useEffect, useState } from 'react';
import { APIConfig, ApiPreset, CharacterBuff, CharacterProfile } from '../../types';
import { isScheduleFeatureOn } from '../../utils/scheduleGenerator';
import LlmApiConfigFields from '../settings/LlmApiConfigFields';

interface EmotionSettingsPanelProps {
    char: CharacterProfile;
    apiPresets: ApiPreset[];
    addApiPreset: (name: string, config: APIConfig) => void;
    onSave: (config: NonNullable<CharacterProfile['emotionConfig']>) => void;
    onClearBuffs: () => void;
}

const normalizeIntensity = (n: number | undefined | null): 1 | 2 | 3 => {
    const parsed = Number.isFinite(n) ? Math.round(Number(n)) : 2;
    if (parsed <= 1) return 1;
    if (parsed >= 3) return 3;
    return 2;
};

const INTENSITY_DOTS = (n: number | undefined | null) => {
    const safe = normalizeIntensity(n);
    return '●'.repeat(safe) + '○'.repeat(3 - safe);
};

const EmotionSettingsPanel: React.FC<EmotionSettingsPanelProps> = ({
    char, onSave, onClearBuffs
}) => {
    const [url, setUrl] = useState('');
    const [key, setKey] = useState('');
    const [model, setModel] = useState('');
    const [dirty, setDirty] = useState(false);

    useEffect(() => {
        const s = char.emotionConfig;
        setUrl(s?.api?.baseUrl ?? '');
        setKey(s?.api?.apiKey ?? '');
        setModel(s?.api?.model ?? '');
        setDirty(false);
    }, [char.id]);

    const handleSave = () => {
        const api = url ? { baseUrl: url, apiKey: key, model } : undefined;
        // 与日程强制同步：日程/情绪总开关开启时情绪必跑。
        // 注意 scheduleFeatureEnabled=true 时即使还没选 scheduleStyle，也应保持情绪开启。
        onSave({ enabled: isScheduleFeatureOn(char), api });
        setDirty(false);
    };

    const buffs: CharacterBuff[] = char.activeBuffs || [];
    const scheduleOn = isScheduleFeatureOn(char);

    return (
        <div className="space-y-4 pt-4 border-t border-[#eed6df]">
            <div>
                <div className="text-xs font-bold text-[#5a3140] mb-1">情绪 / 意识流 API</div>
                <div className="text-[11px] text-[#8b6d79] leading-relaxed space-y-1">
                    <p>
                        原版情绪 buff 就在这里。与日程<b>强制同步</b>：日程开 → 自动启用；日程关 → 一起停。
                    </p>
                    <p className="text-[#8b5b6b] bg-[#fff4f7] border border-[#eed6df] rounded-lg px-2 py-1.5">
                        下方不填 = 自动用主 API。想细腻点就填个 <b>Claude 系列</b>模型。
                    </p>
                </div>
            </div>

            {!scheduleOn && (
                <div className="text-[11px] text-[#a892a3] bg-[#fffdfa] border border-[#eed6df] rounded-lg px-3 py-2">
                    尚未选择日程风格。选择「生活系」或「意识系」后，情绪/意识流会自动启用。
                </div>
            )}

            <div className="space-y-3">
                <LlmApiConfigFields
                    label="副 API 配置"
                    value={{ baseUrl: url, apiKey: key, model }}
                    onChange={next => {
                        setUrl(next.baseUrl);
                        setKey(next.apiKey);
                        setModel(next.model);
                        setDirty(true);
                    }}
                    onSaveConfig={handleSave}
                    saveConfigLabel={dirty ? '保存副 API 配置' : '✓ 已保存'}
                    savePresetDefaultName={`${char.name} 情绪 API`}
                    urlPlaceholder="留空 = 使用主 API"
                    modelPlaceholder="claude-haiku-4-5 / gpt-4o-mini / ..."
                    inputClassName="w-full bg-[#fffdfa] border border-[#eed6df] rounded-xl px-4 py-2.5 text-sm font-mono focus:bg-white transition-all"
                    buttonClassName="rounded-full bg-[#fff4f7] text-[#5a3140] border border-[#eed6df] px-3 py-2 text-xs font-bold shadow-sm active:scale-95 transition-transform disabled:opacity-50"
                    primaryButtonClassName="rounded-xl bg-[#d8a5b7] text-[#fffdfa] px-3 py-2 text-xs font-bold shadow-sm active:scale-95 transition-transform disabled:opacity-50"
                />
            </div>

            {buffs.length > 0 ? (
                <div>
                    <div className="flex items-center justify-between mb-2">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest pl-1">当前情绪状态</label>
                        <button onClick={onClearBuffs} className="text-xs text-[#a892a3] hover:text-[#5a3140] transition-colors">清除</button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {buffs.map(buff => (
                            <div
                                key={buff.id}
                                className="flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-bold"
                                style={{
                                    backgroundColor: '#fff4f7',
                                    color: '#5a3140',
                                    border: '1px solid #eed6df'
                                }}
                            >
                                {buff.emoji && <span>{buff.emoji}</span>}
                                <span>{buff.label}</span>
                                <span className="opacity-60">{INTENSITY_DOTS(buff.intensity)}</span>
                            </div>
                        ))}
                    </div>
                </div>
            ) : scheduleOn ? (
                <div className="text-xs text-slate-400 text-center py-2">
                    暂无情绪状态 — 发几条消息后会自动生成
                </div>
            ) : null}
        </div>
    );
};

export default React.memo(EmotionSettingsPanel);
