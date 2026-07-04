import React, { useEffect, useState } from 'react';
import { APIConfig, ApiPreset, CharacterBuff, CharacterProfile } from '../../types';
import { isEmotionBuffFeatureOn } from '../../utils/scheduleGenerator';
import { getMoodApiConfig, getScheduleApiConfig } from '../../utils/scheduleMoodApi';
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
    const [scheduleDraft, setScheduleDraft] = useState({ baseUrl: '', apiKey: '', model: '' });
    const [moodDraft, setMoodDraft] = useState({ baseUrl: '', apiKey: '', model: '' });
    const [scheduleDirty, setScheduleDirty] = useState(false);
    const [moodDirty, setMoodDirty] = useState(false);

    useEffect(() => {
        const scheduleApi = getScheduleApiConfig(char);
        const moodApi = getMoodApiConfig(char);
        setScheduleDraft({
            baseUrl: scheduleApi?.baseUrl ?? '',
            apiKey: scheduleApi?.apiKey ?? '',
            model: scheduleApi?.model ?? '',
        });
        setMoodDraft({
            baseUrl: moodApi?.baseUrl ?? '',
            apiKey: moodApi?.apiKey ?? '',
            model: moodApi?.model ?? '',
        });
        setScheduleDirty(false);
        setMoodDirty(false);
    }, [char.id, char.emotionConfig]);

    const handleSave = () => {
        onSave({
            enabled: char.emotionConfig?.enabled !== false,
            ...(scheduleDraft.baseUrl.trim() ? { scheduleApi: scheduleDraft } : {}),
            ...(moodDraft.baseUrl.trim() ? { moodApi: moodDraft } : {}),
        });
        setScheduleDirty(false);
        setMoodDirty(false);
    };

    const buffs: CharacterBuff[] = char.activeBuffs || [];
    const buffOn = isEmotionBuffFeatureOn(char);

    return (
        <div className="space-y-4 pt-4 border-t border-[#eed6df]">
            <div>
                <div className="text-xs font-bold text-[#5a3140] mb-1">日程 API / 心情 API</div>
                <div className="text-[11px] text-[#8b6d79] leading-relaxed space-y-1">
                    <p>
                        今日作息排表和聊天里的日程调整走日程 API；心情 buff 和意识流评估走心情 API。
                    </p>
                    <p className="text-[#8b5b6b] bg-[#fff4f7] border border-[#eed6df] rounded-lg px-2 py-1.5">
                        任一项不填 = 该项使用文具盒主 API。旧版合并配置会自动带入两边，保存后就会分开。
                    </p>
                </div>
            </div>

            <div className="space-y-3">
                <LlmApiConfigFields
                    label="日程 API 配置"
                    value={scheduleDraft}
                    onChange={next => {
                        setScheduleDraft(next);
                        setScheduleDirty(true);
                    }}
                    onSaveConfig={handleSave}
                    saveConfigLabel={scheduleDirty || moodDirty ? '保存 API 设置' : '✓ 已保存'}
                    savePresetDefaultName={`${char.name} 日程 API`}
                    apiBinding="今日日程 API"
                    modelFetchFeatureId="chat.scheduleApi.fetchModels"
                    modelCacheKey="os_schedule_api_models"
                    urlPlaceholder="留空 = 使用主 API"
                    modelPlaceholder="claude-haiku-4-5 / gpt-4o-mini / ..."
                    inputClassName="w-full bg-[#fffdfa] border border-[#eed6df] rounded-xl px-4 py-2.5 text-sm font-mono focus:bg-white transition-all"
                    buttonClassName="rounded-full bg-[#fff4f7] text-[#5a3140] border border-[#eed6df] px-3 py-2 text-xs font-bold shadow-sm active:scale-95 transition-transform disabled:opacity-50"
                    primaryButtonClassName="rounded-xl bg-[#d8a5b7] text-[#fffdfa] px-3 py-2 text-xs font-bold shadow-sm active:scale-95 transition-transform disabled:opacity-50"
                />

                {!buffOn && (
                    <div className="text-[11px] text-[#a892a3] bg-[#fffdfa] border border-[#eed6df] rounded-lg px-3 py-2">
                        心情 buff 已关闭。可以先配置心情 API；重新打开后，之后的新聊天才会继续更新状态。
                    </div>
                )}

                <LlmApiConfigFields
                    label="心情 API 配置"
                    value={moodDraft}
                    onChange={next => {
                        setMoodDraft(next);
                        setMoodDirty(true);
                    }}
                    onSaveConfig={handleSave}
                    saveConfigLabel={scheduleDirty || moodDirty ? '保存 API 设置' : '✓ 已保存'}
                    savePresetDefaultName={`${char.name} 心情 API`}
                    apiBinding="心情 API"
                    modelFetchFeatureId="chat.moodApi.fetchModels"
                    modelCacheKey="os_mood_api_models"
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
            ) : buffOn ? (
                <div className="text-xs text-slate-400 text-center py-2">
                    暂无情绪状态 — 发几条消息后会自动生成
                </div>
            ) : null}
        </div>
    );
};

export default React.memo(EmotionSettingsPanel);
