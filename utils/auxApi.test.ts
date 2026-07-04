import { describe, expect, it } from 'vitest';
import { isOptionalCustomApiReady, resolveOptionalCustomApi } from './auxApi';

const mainApi = {
    baseUrl: 'https://main.example.test/v1',
    apiKey: 'main-key',
    model: 'main-model',
};

describe('optional custom API resolution', () => {
    it('uses the custom API when base URL and model are present', () => {
        const api = resolveOptionalCustomApi(
            { baseUrl: ' https://custom.example.test/v1 ', apiKey: ' custom-key ', model: ' cheap-model ' },
            mainApi,
            { customBinding: '今日日程 API' },
        );

        expect(api).toEqual({
            baseUrl: 'https://custom.example.test/v1',
            apiKey: 'custom-key',
            model: 'cheap-model',
            apiRole: 'custom',
            apiBinding: '今日日程 API',
        });
    });

    it('allows a blank custom API key for local providers', () => {
        expect(isOptionalCustomApiReady({ baseUrl: 'http://localhost:11434/v1', apiKey: '', model: 'qwen' })).toBe(true);
    });

    it('falls back to the main API when the custom URL is blank', () => {
        const api = resolveOptionalCustomApi(
            { baseUrl: ' ', apiKey: 'custom-key', model: 'cheap-model' },
            mainApi,
            { mainBinding: '今日日程 API 留空，使用主 API' },
        );

        expect(api).toEqual({
            ...mainApi,
            apiRole: 'main',
            apiBinding: '今日日程 API 留空，使用主 API',
        });
    });

    it('falls back to the main API when the custom model is blank', () => {
        const api = resolveOptionalCustomApi(
            { baseUrl: 'https://custom.example.test/v1', apiKey: 'custom-key', model: '' },
            mainApi,
        );

        expect(api).toMatchObject({
            baseUrl: mainApi.baseUrl,
            apiKey: mainApi.apiKey,
            model: mainApi.model,
            apiRole: 'main',
        });
    });
});
