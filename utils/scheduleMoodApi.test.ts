import { describe, expect, it } from 'vitest';
import type { CharacterProfile } from '../types';
import { cleanScheduleMoodApi, resolveMoodApi, resolveScheduleApi } from './scheduleMoodApi';

const mainApi = {
    baseUrl: 'https://main.example.test/v1',
    apiKey: 'main-key',
    model: 'main-model',
};

const legacyApi = {
    baseUrl: 'https://legacy.example.test/v1',
    apiKey: 'legacy-key',
    model: 'legacy-model',
};

const scheduleApi = {
    baseUrl: 'https://schedule.example.test/v1',
    apiKey: 'schedule-key',
    model: 'schedule-model',
};

const moodApi = {
    baseUrl: 'https://mood.example.test/v1',
    apiKey: 'mood-key',
    model: 'mood-model',
};

describe('split schedule / mood API resolution', () => {
    it('uses the legacy combined API for both sides before split settings are saved', () => {
        const char = { emotionConfig: { enabled: true, api: legacyApi } } as Pick<CharacterProfile, 'emotionConfig'>;

        expect(resolveScheduleApi(char, mainApi)).toMatchObject({
            ...legacyApi,
            apiRole: 'custom',
            apiBinding: '今日日程 API',
        });
        expect(resolveMoodApi(char, mainApi)).toMatchObject({
            ...legacyApi,
            apiRole: 'custom',
            apiBinding: '心情 API',
        });
    });

    it('keeps schedule and mood API lines independent after split settings exist', () => {
        const char = {
            emotionConfig: {
                enabled: true,
                api: legacyApi,
                scheduleApi,
                moodApi,
            },
        } as Pick<CharacterProfile, 'emotionConfig'>;

        expect(resolveScheduleApi(char, mainApi)).toMatchObject({
            ...scheduleApi,
            apiRole: 'custom',
            apiBinding: '今日日程 API',
        });
        expect(resolveMoodApi(char, mainApi)).toMatchObject({
            ...moodApi,
            apiRole: 'custom',
            apiBinding: '心情 API',
        });
    });

    it('does not fall back to the legacy combined API for a cleared side after split settings exist', () => {
        const char = {
            emotionConfig: {
                enabled: true,
                api: legacyApi,
                moodApi,
            },
        } as Pick<CharacterProfile, 'emotionConfig'>;

        expect(resolveScheduleApi(char, mainApi)).toMatchObject({
            ...mainApi,
            apiRole: 'main',
            apiBinding: '今日日程 API 留空，使用主 API',
        });
        expect(resolveMoodApi(char, mainApi)).toMatchObject({
            ...moodApi,
            apiRole: 'custom',
            apiBinding: '心情 API',
        });
    });

    it('cleans saved drafts by URL so blank config means main API fallback', () => {
        expect(cleanScheduleMoodApi({ baseUrl: ' ', apiKey: 'keep?', model: 'm' })).toBeUndefined();
        expect(cleanScheduleMoodApi({ baseUrl: ' https://api.example.test/v1 ', apiKey: ' sk ', model: ' qwen ' })).toEqual({
            baseUrl: 'https://api.example.test/v1',
            apiKey: 'sk',
            model: 'qwen',
        });
    });
});
