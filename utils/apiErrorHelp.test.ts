import { describe, expect, it } from 'vitest';
import type { ApiCallLogEntry } from './apiCallLog';
import { resolveApiErrorHelp, summarizeApiErrorHelps } from './apiErrorHelp';

const entry = (patch: Partial<ApiCallLogEntry>): ApiCallLogEntry => ({
    id: 'test',
    timestamp: 1000,
    presetName: 'test',
    baseUrl: 'https://api.example.test/v1',
    model: 'test-model',
    ok: false,
    ...patch,
});

describe('API 报错说明书跳转诊断', () => {
    it('把 401 / 403 归到密钥或权限说明', () => {
        const help = resolveApiErrorHelp(entry({
            status: 401,
            errorMessage: 'Invalid API key provided',
        }));

        expect(help?.kind).toBe('auth');
        expect(help?.manualSettingId).toBe('settings-error-401-403');
        expect(help?.manualAnchorId).toBe('manual-guide-setting-文具盒-settings-error-401-403');
    });

    it('把模型不存在归到模型名说明', () => {
        const help = resolveApiErrorHelp(entry({
            status: 404,
            errorMessage: 'model_not_found: The model does not exist',
        }));

        expect(help?.kind).toBe('model-not-found');
        expect(help?.manualSettingId).toBe('settings-error-404-model');
    });

    it('429 中出现额度不足时优先跳余额说明', () => {
        const help = resolveApiErrorHelp(entry({
            status: 429,
            errorMessage: 'insufficient_quota: You exceeded your current quota',
        }));

        expect(help?.kind).toBe('quota');
        expect(help?.manualSettingId).toBe('settings-error-insufficient-balance');
    });

    it('识别 HTML / JSON 格式错误', () => {
        const help = resolveApiErrorHelp(entry({
            status: 200,
            errorMessage: 'API返回了HTML而非JSON (HTTP 200): <!doctype html>',
        }));

        expect(help?.kind).toBe('json-format');
        expect(help?.manualSettingId).toBe('settings-error-json');
    });

    it('HTML 错误页即使是 404 也优先归到格式错误', () => {
        const help = resolveApiErrorHelp(entry({
            status: 404,
            errorMessage: 'API返回了HTML而非JSON (HTTP 404): <!doctype html><title>Not Found</title>',
        }));

        expect(help?.kind).toBe('json-format');
        expect(help?.manualSettingId).toBe('settings-error-json');
    });

    it('识别上下文过长', () => {
        const help = resolveApiErrorHelp(entry({
            status: 400,
            errorMessage: "This model's maximum context length is 8192 tokens.",
        }));

        expect(help?.kind).toBe('context-length');
        expect(help?.manualSettingId).toBe('settings-error-context');
    });

    it('按类型汇总失败诊断并按次数排序', () => {
        const summaries = summarizeApiErrorHelps([
            entry({ id: '1', timestamp: 1, status: 401, errorMessage: 'invalid api key' }),
            entry({ id: '2', timestamp: 2, status: 401, errorMessage: 'invalid api key' }),
            entry({ id: '3', timestamp: 3, status: 404, errorMessage: 'model not found' }),
            entry({ id: 'ok', ok: true, timestamp: 4 }),
        ]);

        expect(summaries.map(item => [item.kind, item.count])).toEqual([
            ['auth', 2],
            ['model-not-found', 1],
        ]);
    });
});
