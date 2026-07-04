import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAIN_API_CONFIG,
  isMainApiStreamEnabled,
  normalizeApiPresets,
  normalizeMainApiConfig,
} from './apiConfigDefaults';

describe('apiConfigDefaults', () => {
  it('defaults the main API stream switch on when the field is missing', () => {
    expect(DEFAULT_MAIN_API_CONFIG.stream).toBe(true);
    expect(normalizeMainApiConfig({ baseUrl: 'https://api.test/v1', apiKey: 'k', model: 'm' }).stream).toBe(true);
    expect(isMainApiStreamEnabled({})).toBe(true);
  });

  it('preserves an explicit non-streaming choice', () => {
    const config = normalizeMainApiConfig({ baseUrl: 'https://api.test/v1', apiKey: 'k', model: 'm', stream: false });
    expect(config.stream).toBe(false);
    expect(isMainApiStreamEnabled(config)).toBe(false);
  });

  it('normalizes old API presets without overwriting explicit stream settings', () => {
    const presets = normalizeApiPresets([
      { id: 'old', name: 'old preset', config: { baseUrl: 'https://a.test/v1', apiKey: '', model: 'a' } },
      { id: 'off', name: 'non-stream preset', config: { baseUrl: 'https://b.test/v1', apiKey: '', model: 'b', stream: false } },
    ]);

    expect(presets[0].config.stream).toBe(true);
    expect(presets[1].config.stream).toBe(false);
  });
});
