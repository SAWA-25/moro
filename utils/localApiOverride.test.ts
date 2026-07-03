import { beforeEach, describe, expect, it } from 'vitest';
import {
    clearLocalApiOverride,
    isLocalApiOverrideComplete,
    loadLocalApiOverride,
    resolveLocalApiOverride,
    resolveScopedLocalApi,
    saveLocalApiOverride,
    SOCIAL_API_OVERRIDE_STORAGE_KEY,
    THEATER_EXTRA_API_OVERRIDE_STORAGE_KEY,
} from './localApiOverride';
import type { AuxApiConfig } from '../types';

const fallback = {
    baseUrl: 'https://main.example.test/v1',
    apiKey: 'main-key',
    model: 'main-model',
    apiRole: 'main' as const,
    apiBinding: 'fallback',
};

beforeEach(() => {
    localStorage.clear();
});

describe('local API overrides', () => {
    it('uses complete social override before the fallback API', () => {
        saveLocalApiOverride('social', {
            baseUrl: ' https://custom.example.test/v1 ',
            apiKey: ' custom-key ',
            model: ' custom-model ',
        });

        const api = resolveLocalApiOverride('social', fallback);

        expect(api).toEqual({
            baseUrl: 'https://custom.example.test/v1',
            apiKey: 'custom-key',
            model: 'custom-model',
            apiRole: 'custom',
            apiBinding: '见闻簿专用 API',
        });
    });

    it('allows an empty API key but requires base URL and model', () => {
        const saved = saveLocalApiOverride('theaterExtra', {
            baseUrl: 'https://custom.example.test/v1',
            apiKey: '',
            model: 'cheap-model',
        });

        expect(isLocalApiOverrideComplete(saved)).toBe(true);
        expect(resolveLocalApiOverride('theaterExtra', fallback)).toMatchObject({
            baseUrl: 'https://custom.example.test/v1',
            apiKey: '',
            model: 'cheap-model',
            apiRole: 'custom',
            apiBinding: '折子戏番外专用 API',
        });
    });

    it('rejects partial non-empty configs without replacing a saved config', () => {
        saveLocalApiOverride('social', {
            baseUrl: 'https://old.example.test/v1',
            apiKey: 'old',
            model: 'old-model',
        });

        expect(() => saveLocalApiOverride('social', { baseUrl: 'https://missing-model.test/v1', model: '' }))
            .toThrow('专用 API 需要填写 Base URL 和模型名');

        expect(loadLocalApiOverride('social')).toMatchObject({
            baseUrl: 'https://old.example.test/v1',
            apiKey: 'old',
            model: 'old-model',
        });
    });

    it('clears overrides and falls back to aux then main resolution', () => {
        const aux: AuxApiConfig = {
            enabled: true,
            baseUrl: 'https://aux.example.test/v1',
            apiKey: 'aux-key',
            model: 'aux-model',
        };

        saveLocalApiOverride('social', {
            baseUrl: 'https://custom.example.test/v1',
            apiKey: 'custom',
            model: 'custom-model',
        });
        clearLocalApiOverride('social');

        expect(localStorage.getItem(SOCIAL_API_OVERRIDE_STORAGE_KEY)).toBeNull();
        expect(resolveScopedLocalApi('social', aux, fallback)).toMatchObject({
            baseUrl: 'https://aux.example.test/v1',
            apiKey: 'aux-key',
            model: 'aux-model',
            apiRole: 'aux',
        });
    });

    it('removes storage when saving an empty config', () => {
        saveLocalApiOverride('theaterExtra', {
            baseUrl: 'https://custom.example.test/v1',
            apiKey: 'k',
            model: 'm',
        });

        saveLocalApiOverride('theaterExtra', { baseUrl: '', apiKey: '', model: '' });

        expect(localStorage.getItem(THEATER_EXTRA_API_OVERRIDE_STORAGE_KEY)).toBeNull();
        expect(loadLocalApiOverride('theaterExtra')).toEqual({ baseUrl: '', apiKey: '', model: '' });
    });
});
