import React, { useEffect, useMemo, useState } from 'react';
import { useOS } from '../../context/OSContext';
import { APIConfig } from '../../types';
import { makeApiUsageMeta } from '../../utils/apiUsageCatalog';
import { fetchModelList } from '../../utils/llmClient';

export type LlmApiDraft = Pick<APIConfig, 'baseUrl' | 'apiKey' | 'model'>;

interface LlmApiConfigFieldsProps {
  value: LlmApiDraft;
  onChange: (value: LlmApiDraft) => void;
  label?: string;
  hint?: React.ReactNode;
  className?: string;
  inputClassName?: string;
  buttonClassName?: string;
  primaryButtonClassName?: string;
  onSaveConfig?: () => void | Promise<void>;
  saveConfigLabel?: string;
  onClearConfig?: () => void;
  clearConfigLabel?: string;
  urlPlaceholder?: string;
  keyPlaceholder?: string;
  modelPlaceholder?: string;
  savePresetDefaultName?: string;
  compact?: boolean;
  showPresets?: boolean;
  showSavePreset?: boolean;
  modelFetchFeatureId?: string;
  apiRole?: 'main' | 'aux' | 'custom';
  apiBinding?: string;
  modelCacheKey?: string;
}

const defaultInputClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none font-mono text-slate-700 placeholder:text-slate-400';
const defaultButtonClass =
  'rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 active:scale-95 transition-transform disabled:opacity-50';
const defaultPrimaryButtonClass =
  'rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white active:scale-95 transition-transform disabled:opacity-50';

const LlmApiConfigFields: React.FC<LlmApiConfigFieldsProps> = ({
  value,
  onChange,
  label,
  hint,
  className = '',
  inputClassName,
  buttonClassName,
  primaryButtonClassName,
  onSaveConfig,
  saveConfigLabel = '保存 API',
  onClearConfig,
  clearConfigLabel = '清空',
  urlPlaceholder = 'https://api.example.com/v1',
  keyPlaceholder = 'sk-...',
  modelPlaceholder = 'gpt-4o-mini',
  savePresetDefaultName = '',
  compact = false,
  showPresets = true,
  showSavePreset = true,
  modelFetchFeatureId = 'chat.emotionApi.fetchModels',
  apiRole = 'custom',
  apiBinding,
  modelCacheKey = 'os_available_models',
}) => {
  const { apiPresets, addApiPreset, availableModels, setAvailableModels, addToast } = useOS();
  const [isFetching, setIsFetching] = useState(false);
  const [status, setStatus] = useState('');
  const [showModelList, setShowModelList] = useState(false);
  const [modelFilter, setModelFilter] = useState('');
  const [showPresetName, setShowPresetName] = useState(false);
  const [presetName, setPresetName] = useState(savePresetDefaultName);
  const [isSavingConfig, setIsSavingConfig] = useState(false);

  const inputCls = inputClassName || defaultInputClass;
  const buttonCls = buttonClassName || defaultButtonClass;
  const primaryButtonCls = primaryButtonClassName || defaultPrimaryButtonClass;

  useEffect(() => {
    if (!showPresetName) setPresetName(savePresetDefaultName);
  }, [savePresetDefaultName, showPresetName]);

  const patch = (updates: Partial<LlmApiDraft>) => onChange({ ...value, ...updates });

  const filteredModels = useMemo(() => {
    const query = modelFilter.trim().toLowerCase();
    const models = availableModels || [];
    return query ? models.filter(model => model.toLowerCase().includes(query)) : models;
  }, [availableModels, modelFilter]);

  const handleFetchModels = async () => {
    if (!value.baseUrl.trim()) {
      setStatus('请先填写 Base URL');
      addToast('请先填写 Base URL，再拉取模型', 'info');
      return;
    }

    setIsFetching(true);
    setStatus('正在拉取模型...');
    try {
      const models = await fetchModelList(
        { baseUrl: value.baseUrl, apiKey: value.apiKey },
        {
          meta: makeApiUsageMeta(modelFetchFeatureId, {
            apiRole,
            apiBinding: apiBinding || label || '独立 API 配置',
          }),
        },
      );
      if (!models.length) {
        setStatus('没有识别到模型列表，可以先手动填写模型名');
        addToast('没有识别到模型列表，可以先手动填写模型名', 'info');
        return;
      }

      setAvailableModels(models);
      try { localStorage.setItem(modelCacheKey, JSON.stringify(models)); } catch { /* ignore */ }
      if (!models.includes(value.model.trim())) patch({ model: models[0] });
      setShowModelList(true);
      setModelFilter('');
      setStatus(`已拉取 ${models.length} 个模型`);
      addToast(`已拉取 ${models.length} 个模型`, 'success');
    } catch (error: any) {
      const message = error?.message || '请检查 Base URL 和 API Key';
      setStatus(`拉取失败：${message}；也可以先手动填写模型名`);
      addToast(`拉取模型失败：${message}`, 'error');
    } finally {
      setIsFetching(false);
    }
  };

  const handleSavePreset = () => {
    const name = presetName.trim();
    const baseUrl = value.baseUrl.trim();
    const model = value.model.trim();
    if (!name) {
      setStatus('请先填写预设名称');
      return;
    }
    if (!baseUrl || !model) {
      setStatus('保存预设需要 Base URL 和模型名');
      return;
    }

    addApiPreset(name, {
      baseUrl,
      apiKey: value.apiKey.trim(),
      model,
    } as APIConfig);
    setShowPresetName(false);
    setStatus(`已保存预设「${name}」`);
    addToast(`已保存 API 预设「${name}」`, 'success');
  };

  const handleSaveConfig = async () => {
    if (!onSaveConfig) return;
    setIsSavingConfig(true);
    try {
      await onSaveConfig();
      setStatus('API 已保存');
    } finally {
      setIsSavingConfig(false);
    }
  };

  return (
    <div className={`space-y-3 ${className}`}>
      {(label || hint) && (
        <div className="space-y-1">
          {label && <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</div>}
          {hint && <div className="text-[11px] leading-relaxed text-slate-500">{hint}</div>}
        </div>
      )}

      {showPresets && apiPresets.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">已保存预设</div>
          <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
            {apiPresets.map(preset => (
              <button
                key={preset.id}
                type="button"
                onClick={() => {
                  patch({
                    baseUrl: preset.config.baseUrl || '',
                    apiKey: preset.config.apiKey || '',
                    model: preset.config.model || '',
                  });
                  setStatus(`已载入「${preset.name}」`);
                }}
                className={`${buttonCls} shrink-0 max-w-[12rem] truncate`}
                title={`${preset.name} · ${preset.config.model || '未命名模型'}`}
              >
                {preset.name}
                {preset.config.model && <span className="ml-1 opacity-60">{preset.config.model}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={compact ? 'space-y-2' : 'space-y-3'}>
        <input
          type="text"
          value={value.baseUrl}
          onChange={event => patch({ baseUrl: event.target.value })}
          placeholder={urlPlaceholder}
          className={inputCls}
          spellCheck={false}
        />
        <input
          type="password"
          value={value.apiKey}
          onChange={event => patch({ apiKey: event.target.value })}
          placeholder={keyPlaceholder}
          className={inputCls}
          autoComplete="new-password"
          spellCheck={false}
        />
        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <input
              type="text"
              value={value.model}
              onChange={event => patch({ model: event.target.value })}
              placeholder={modelPlaceholder}
              className={`${inputCls} min-w-0`}
              spellCheck={false}
            />
            <button type="button" onClick={() => setShowModelList(current => !current)} className={buttonCls}>
              选择
            </button>
          </div>
          {showModelList && (
            <div className="rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
              <div className="flex gap-2">
                <input
                  value={modelFilter}
                  onChange={event => setModelFilter(event.target.value)}
                  placeholder="搜索模型"
                  className={`${inputCls} min-w-0 flex-1 py-2 text-xs`}
                />
                <button type="button" onClick={handleFetchModels} disabled={isFetching} className={buttonCls}>
                  {isFetching ? '拉取中...' : '拉取'}
                </button>
              </div>
              <div className="mt-2 max-h-40 space-y-1 overflow-y-auto no-scrollbar">
                {filteredModels.length > 0 ? filteredModels.map(model => (
                  <button
                    key={model}
                    type="button"
                    onClick={() => { patch({ model }); setShowModelList(false); }}
                    className={`w-full rounded-lg px-3 py-2 text-left text-xs font-mono transition-colors ${
                      model === value.model ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
                    }`}
                    title={model}
                  >
                    <span className="break-all">{model}</span>
                  </button>
                )) : (
                  <div className="px-2 py-3 text-center text-[11px] text-slate-400">
                    {availableModels.length ? '没有匹配的模型' : '还没有模型列表，请先拉取或手动输入'}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={handleFetchModels} disabled={isFetching} className={buttonCls}>
          {isFetching ? '正在拉取...' : '拉取模型'}
        </button>
        {onSaveConfig ? (
          <button type="button" onClick={handleSaveConfig} disabled={isSavingConfig} className={primaryButtonCls}>
            {isSavingConfig ? '保存中...' : saveConfigLabel}
          </button>
        ) : showSavePreset ? (
          <button type="button" onClick={() => setShowPresetName(current => !current)} className={primaryButtonCls}>
            保存为预设
          </button>
        ) : null}
      </div>

      {onSaveConfig && showSavePreset && (
        <button type="button" onClick={() => setShowPresetName(current => !current)} className={`${buttonCls} w-full`}>
          保存为 API 预设
        </button>
      )}

      {onClearConfig && (
        <button type="button" onClick={onClearConfig} className={`${buttonCls} w-full`}>
          {clearConfigLabel}
        </button>
      )}

      {showPresetName && (
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <input
            type="text"
            value={presetName}
            onChange={event => setPresetName(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') handleSavePreset(); }}
            placeholder="给这套 API 起个名字"
            className={inputCls}
            autoFocus
          />
          <button type="button" onClick={handleSavePreset} className={primaryButtonCls}>
            保存
          </button>
        </div>
      )}

      {status && <div className="text-[11px] leading-relaxed text-slate-500">{status}</div>}
    </div>
  );
};

export default LlmApiConfigFields;
