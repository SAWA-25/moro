import type { APIConfig, ApiPreset } from '../types';

export const DEFAULT_MAIN_API_STREAM = true;
export const DEFAULT_MAIN_API_TEMPERATURE = 0.85;

export const DEFAULT_MAIN_API_CONFIG: APIConfig = {
  baseUrl: '',
  apiKey: '',
  minimaxApiKey: '',
  minimaxGroupId: '',
  minimaxRegion: 'domestic',
  model: 'gpt-4o-mini',
  stream: DEFAULT_MAIN_API_STREAM,
  temperature: DEFAULT_MAIN_API_TEMPERATURE,
};

export function isMainApiStreamEnabled(config?: Pick<APIConfig, 'stream'> | null): boolean {
  return config?.stream ?? DEFAULT_MAIN_API_STREAM;
}

export function normalizeMainApiConfig(config?: Partial<APIConfig> | null): APIConfig {
  const input = config ?? {};
  return {
    ...DEFAULT_MAIN_API_CONFIG,
    ...input,
    minimaxRegion: input.minimaxRegion ?? DEFAULT_MAIN_API_CONFIG.minimaxRegion,
    stream: input.stream ?? DEFAULT_MAIN_API_STREAM,
    temperature: typeof input.temperature === 'number'
      ? input.temperature
      : DEFAULT_MAIN_API_TEMPERATURE,
  };
}

export function normalizeApiPresetConfig(config: APIConfig): APIConfig {
  return {
    ...config,
    stream: config.stream ?? DEFAULT_MAIN_API_STREAM,
  };
}

export function normalizeApiPreset(preset: ApiPreset): ApiPreset {
  return {
    ...preset,
    config: normalizeApiPresetConfig(preset.config),
  };
}

export function normalizeApiPresets(presets: unknown): ApiPreset[] {
  if (!Array.isArray(presets)) return [];
  return presets
    .filter((preset): preset is ApiPreset => !!preset && typeof preset === 'object' && !!(preset as ApiPreset).config)
    .map(normalizeApiPreset);
}
