import React, { useEffect, useState } from 'react';
import { ApiPreset, APIConfig, CharacterProfile } from '../../types';
import { CheckCircle, Circle, FloppyDisk, X } from '@phosphor-icons/react';

type LifeSimApiDraft = Pick<APIConfig, 'baseUrl' | 'apiKey' | 'model'>;

const EMPTY_API_DRAFT: LifeSimApiDraft = { baseUrl: '', apiKey: '', model: '' };
const INK = '#2b2933';

const LifeSimSettingsPanel: React.FC<{
    characters: CharacterProfile[];
    selectedCharIds: string[];
    apiPresets: ApiPreset[];
    useIndependentApiConfig: boolean;
    independentApiConfig?: Partial<APIConfig>;
    onToggleChar: (charId: string) => void;
    onSelectAll: () => void;
    onSelectNone: () => void;
    onSaveApiSettings: (payload: { enabled: boolean; config: LifeSimApiDraft }) => Promise<void> | void;
    onClose: () => void;
}> = ({
    characters,
    selectedCharIds,
    apiPresets,
    useIndependentApiConfig,
    independentApiConfig,
    onToggleChar,
    onSelectAll,
    onSelectNone,
    onSaveApiSettings,
    onClose,
}) => {
    const [useIndependentApi, setUseIndependentApi] = useState(useIndependentApiConfig);
    const [draft, setDraft] = useState<LifeSimApiDraft>(EMPTY_API_DRAFT);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        setUseIndependentApi(useIndependentApiConfig);
        setDraft({
            baseUrl: independentApiConfig?.baseUrl || '',
            apiKey: independentApiConfig?.apiKey || '',
            model: independentApiConfig?.model || '',
        });
    }, [independentApiConfig, useIndependentApiConfig]);

    const patchDraft = (updates: Partial<LifeSimApiDraft>) => setDraft(prev => ({ ...prev, ...updates }));

    const handleLoadPreset = (preset: ApiPreset) => {
        setDraft({
            baseUrl: preset.config.baseUrl || '',
            apiKey: preset.config.apiKey || '',
            model: preset.config.model || '',
        });
        setUseIndependentApi(true);
    };

    const handleSaveAndClose = async () => {
        if (isSaving) return;
        setIsSaving(true);
        try {
            await onSaveApiSettings({
                enabled: useIndependentApi,
                config: { baseUrl: draft.baseUrl.trim(), apiKey: draft.apiKey.trim(), model: draft.model.trim() },
            });
            onClose();
        } finally {
            setIsSaving(false);
        }
    };

    const fieldStyle: React.CSSProperties = {
        width: '100%', background: '#fbfaf7', border: '1px solid rgba(236,233,226,0.95)',
        outline: '1px dashed rgba(167,162,151,0.4)', outlineOffset: -3,
        borderRadius: 10, padding: '9px 11px', fontSize: 11, fontFamily: 'var(--font-label)',
        color: '#2b2933',
    };

    return (
        <div className="absolute inset-0 z-40 flex items-end justify-center"
            style={{ background: 'rgba(43,41,51,0.34)', animation: 'fadeIn 0.25s ease' }}
            onClick={event => { if (event.target === event.currentTarget) void handleSaveAndClose(); }}>
            <div className="scrap-card w-full mx-2 mb-2 relative" style={{
                maxHeight: '84vh', display: 'flex', flexDirection: 'column', minWidth: 0, borderRadius: 18,
                animation: 'slideUp 0.3s cubic-bezier(0.25,1,0.5,1)',
            }}>
                <span style={{
                    position: 'absolute', top: -11, left: '50%', transform: 'translateX(-50%) rotate(-2deg)',
                    width: 120, height: 20, background: 'rgba(255,255,255,0.6)',
                    borderLeft: '1px dashed rgba(160,156,146,0.5)', borderRight: '1px dashed rgba(160,156,146,0.5)',
                    pointerEvents: 'none',
                }} />
                <div className="flex items-center justify-between px-4 pt-4 pb-2">
                    <span className="font-hand" style={{ fontSize: 18, fontWeight: 700, color: '#2b2933' }}>街角 · 设定</span>
                    <button onClick={() => void handleSaveAndClose()} className="scrap-btn-paper flex items-center justify-center" style={{ width: 30, height: 30 }}>
                        <X size={14} weight="bold" />
                    </button>
                </div>
                <div className="lace-edge mx-4" />

                <div className="overflow-y-auto overflow-x-hidden no-scrollbar flex-1" style={{ padding: '12px 16px' }}>
                    <p className="font-hand" style={{ fontSize: 13, color: '#a79c8e', lineHeight: 1.6, marginBottom: 12 }}>
                        在这里挑这一本里允许哪些角色登场，也能单独给街角配一套 API ✎
                    </p>

                    <div className="drawer-tag" style={{ marginBottom: 8 }}><span>登场角色</span></div>

                    <div className="flex gap-2 mb-2.5">
                        <button onClick={onSelectAll} className="scrap-btn-paper font-hand" style={{ padding: '4px 14px', fontSize: 13, fontWeight: 700 }}>全选</button>
                        <button onClick={onSelectNone} className="scrap-btn-paper font-hand" style={{ padding: '4px 14px', fontSize: 13, fontWeight: 700 }}>清空</button>
                    </div>

                    <div className="space-y-2">
                        {characters.map(char => {
                            const active = selectedCharIds.includes(char.id);
                            return (
                                <button key={char.id} onClick={() => onToggleChar(char.id)} className="w-full text-left press-soft" style={{
                                    display: 'flex', alignItems: 'center', gap: 10, padding: 9, borderRadius: 12,
                                    border: active ? `1px solid ${INK}` : '1px solid rgba(236,233,226,0.95)',
                                    outline: active ? `1px dashed rgba(255,255,255,0.3)` : '1px dashed rgba(167,162,151,0.34)',
                                    outlineOffset: -4,
                                    background: active ? INK : 'rgba(255,255,255,0.95)',
                                    minWidth: 0,
                                }}>
                                    <img src={char.avatar} alt={char.name} style={{ width: 34, height: 34, borderRadius: 9, objectFit: 'cover', flexShrink: 0 }} />
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div className="font-hand" style={{ fontSize: 14, fontWeight: 700, color: active ? '#fbfaf7' : '#2b2933' }}>{char.name}</div>
                                        <div style={{ fontSize: 10, color: active ? 'rgba(255,255,255,0.65)' : '#a79c8e', lineHeight: 1.5, overflowWrap: 'anywhere' }}>
                                            {char.description || '暂无描述'}
                                        </div>
                                    </div>
                                    <div style={{ color: active ? '#fbfaf7' : '#bcb5a8', flexShrink: 0 }}>
                                        {active ? <CheckCircle size={20} weight="fill" /> : <Circle size={20} weight="bold" />}
                                    </div>
                                </button>
                            );
                        })}
                    </div>

                    <div className="lace-edge" style={{ margin: '16px 0 12px' }} />

                    <div className="flex items-center justify-between" style={{ marginBottom: 8, gap: 10 }}>
                        <div style={{ minWidth: 0 }}>
                            <div className="drawer-tag"><span>独立 API</span></div>
                            <div className="font-hand" style={{ fontSize: 11, color: '#a79c8e', lineHeight: 1.5, marginTop: 6 }}>
                                推荐 Gemini Flash 系列，便宜又快，适合这种高频轻剧情。
                            </div>
                        </div>
                        <button onClick={() => setUseIndependentApi(value => !value)} style={{
                            width: 46, height: 25, borderRadius: 999, border: '1px solid rgba(167,162,151,0.4)',
                            background: useIndependentApi ? INK : 'rgba(120,116,106,0.18)', position: 'relative', flexShrink: 0,
                            transition: 'background 0.2s',
                        }}>
                            <span style={{
                                position: 'absolute', top: 2, left: useIndependentApi ? 23 : 2,
                                width: 19, height: 19, borderRadius: 999, background: '#fbfaf7',
                                boxShadow: '0 1px 2px rgba(0,0,0,0.18)', transition: 'left 0.18s ease',
                            }} />
                        </button>
                    </div>

                    <div style={{ padding: '7px 10px', marginBottom: 10, background: 'rgba(120,116,106,0.05)', borderRadius: 10, border: '1px dashed rgba(167,162,151,0.4)' }}>
                        <p className="font-hand" style={{ fontSize: 11.5, color: '#6b665d', lineHeight: 1.6 }}>
                            {useIndependentApi
                                ? '开启后，街角会优先用下面这套；没填的字段回退到全局 API。'
                                : '关闭时，街角沿用系统全局 API。'}
                        </p>
                    </div>

                    {useIndependentApi && (
                        <>
                            {apiPresets.length > 0 && (
                                <div style={{ marginBottom: 10 }}>
                                    <div className="label-mono" style={{ fontSize: 8.5, color: '#a79c8e', marginBottom: 6 }}>presets</div>
                                    <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                                        {apiPresets.map(preset => (
                                            <button key={preset.id} onClick={() => handleLoadPreset(preset)}
                                                className="scrap-btn-paper font-hand" style={{ padding: '4px 12px', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0 }}>
                                                {preset.name} · {preset.config.model}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="space-y-3">
                                <div>
                                    <label className="label-mono" style={{ fontSize: 8.5, color: '#a79c8e', marginBottom: 5, display: 'block' }}>URL</label>
                                    <input type="text" value={draft.baseUrl} onChange={event => patchDraft({ baseUrl: event.target.value })} placeholder="https://..." style={fieldStyle} />
                                </div>
                                <div>
                                    <label className="label-mono" style={{ fontSize: 8.5, color: '#a79c8e', marginBottom: 5, display: 'block' }}>API KEY</label>
                                    <input type="password" value={draft.apiKey} onChange={event => patchDraft({ apiKey: event.target.value })} placeholder="sk-..." style={fieldStyle} />
                                </div>
                                <div>
                                    <label className="label-mono" style={{ fontSize: 8.5, color: '#a79c8e', marginBottom: 5, display: 'block' }}>MODEL</label>
                                    <input type="text" value={draft.model} onChange={event => patchDraft({ model: event.target.value })} placeholder="gemini-2.0-flash / gemini-2.5-flash-lite / ..." style={fieldStyle} />
                                </div>
                            </div>
                        </>
                    )}
                </div>

                <div style={{ padding: '10px 16px 14px' }}>
                    <button onClick={() => void handleSaveAndClose()} disabled={isSaving}
                        className="scrap-btn w-full flex items-center justify-center gap-1.5"
                        style={{ padding: '11px', fontFamily: 'var(--font-hand)', fontSize: 15, fontWeight: 700, opacity: isSaving ? 0.6 : 1 }}>
                        <FloppyDisk size={15} weight="bold" /> {isSaving ? '收进抽屉…' : '收好，合上设定'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default LifeSimSettingsPanel;
