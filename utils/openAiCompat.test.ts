import { describe, expect, it } from 'vitest';
import { buildOpenAiEndpoint, buildOpenAiHeaders, extractApiErrorMessage, normalizeModelList, normalizeOpenAiBaseUrl } from './openAiCompat';

describe('openAiCompat', () => {
    it('normalizes base urls from common endpoint shapes', () => {
        expect(normalizeOpenAiBaseUrl('https://api.example.com')).toBe('https://api.example.com/v1');
        expect(normalizeOpenAiBaseUrl('https://api.example.com/v1/')).toBe('https://api.example.com/v1');
        expect(normalizeOpenAiBaseUrl('https://api.example.com/v1/chat/completions')).toBe('https://api.example.com/v1');
        expect(normalizeOpenAiBaseUrl('https://api.example.com/v1/models')).toBe('https://api.example.com/v1');
        expect(normalizeOpenAiBaseUrl('https://api.example.com/v1/images/generations')).toBe('https://api.example.com/v1');
        expect(normalizeOpenAiBaseUrl('https://api.example.com/proxy')).toBe('https://api.example.com/proxy');
    });

    it('builds OpenAI-compatible endpoints without double suffixes', () => {
        expect(buildOpenAiEndpoint('https://api.example.com', 'chat.completions'))
            .toBe('https://api.example.com/v1/chat/completions');
        expect(buildOpenAiEndpoint('https://api.example.com/v1/chat/completions', 'chat.completions'))
            .toBe('https://api.example.com/v1/chat/completions');
        expect(buildOpenAiEndpoint('https://api.example.com/v1/models', 'models'))
            .toBe('https://api.example.com/v1/models');
        expect(buildOpenAiEndpoint('https://api.example.com/v1/images/generations', 'embeddings'))
            .toBe('https://api.example.com/v1/embeddings');
        expect(buildOpenAiEndpoint('https://api.example.com/v1/chat/completions', 'images.generations'))
            .toBe('https://api.example.com/v1/images/generations');
    });

    it('uses sk-none for local or no-auth endpoints', () => {
        expect(buildOpenAiHeaders('').Authorization).toBe('Bearer sk-none');
        expect(buildOpenAiHeaders('  sk-real  ').Authorization).toBe('Bearer sk-real');
    });

    it('normalizes model list response variants', () => {
        expect(normalizeModelList({ data: [{ id: 'a' }, { name: 'b' }, { model: 'c' }, { id: 'a' }] }))
            .toEqual(['a', 'b', 'c']);
        expect(normalizeModelList({ models: ['x', ' y '] })).toEqual(['x', 'y']);
    });

    it('extracts common provider error messages', () => {
        expect(extractApiErrorMessage({ error: { message: 'bad key' } }, 'fallback')).toBe('bad key');
        expect(extractApiErrorMessage({ error: 'quota exceeded' }, 'fallback')).toBe('quota exceeded');
        expect(extractApiErrorMessage({ message: 'rate limited' }, 'fallback')).toBe('rate limited');
        expect(extractApiErrorMessage({ detail: 'not found' }, 'fallback')).toBe('not found');
        expect(extractApiErrorMessage({}, 'fallback')).toBe('fallback');
    });
});
