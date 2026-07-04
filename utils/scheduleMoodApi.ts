import type { APIConfig, CharacterProfile } from '../types';
import { resolveOptionalCustomApi, type OptionalCustomApiConfig, type ResolvedApi } from './auxApi';

export type ScheduleMoodApiConfig = {
    baseUrl: string;
    apiKey: string;
    model: string;
};

type EmotionConfig = NonNullable<CharacterProfile['emotionConfig']>;
type ApiKey = 'scheduleApi' | 'moodApi';

export function cleanScheduleMoodApi(api: OptionalCustomApiConfig | null | undefined): ScheduleMoodApiConfig | undefined {
    const baseUrl = (api?.baseUrl || '').trim();
    if (!baseUrl) return undefined;
    return {
        baseUrl,
        apiKey: (api?.apiKey || '').trim(),
        model: (api?.model || '').trim(),
    };
}

function hasSplitApi(config: EmotionConfig | null | undefined): boolean {
    return !!config && (config.scheduleApi !== undefined || config.moodApi !== undefined);
}

function getSplitAwareApi(
    config: EmotionConfig | null | undefined,
    key: ApiKey,
): OptionalCustomApiConfig | undefined {
    if (!config) return undefined;
    const split = config[key];
    if (split !== undefined) return split;
    return hasSplitApi(config) ? undefined : config.api;
}

export function getScheduleApiConfig(
    char: Pick<CharacterProfile, 'emotionConfig'> | null | undefined,
): OptionalCustomApiConfig | undefined {
    return getSplitAwareApi(char?.emotionConfig, 'scheduleApi');
}

export function getMoodApiConfig(
    char: Pick<CharacterProfile, 'emotionConfig'> | null | undefined,
): OptionalCustomApiConfig | undefined {
    return getSplitAwareApi(char?.emotionConfig, 'moodApi');
}

export function resolveScheduleApi(
    char: Pick<CharacterProfile, 'emotionConfig'> | null | undefined,
    main: Pick<APIConfig, 'baseUrl' | 'apiKey' | 'model'>,
): ResolvedApi {
    return resolveOptionalCustomApi(getScheduleApiConfig(char), main, {
        customBinding: '今日日程 API',
        mainBinding: '今日日程 API 留空，使用主 API',
    });
}

export function resolveMoodApi(
    char: Pick<CharacterProfile, 'emotionConfig'> | null | undefined,
    main: Pick<APIConfig, 'baseUrl' | 'apiKey' | 'model'>,
): ResolvedApi {
    return resolveOptionalCustomApi(getMoodApiConfig(char), main, {
        customBinding: '心情 API',
        mainBinding: '心情 API 留空，使用主 API',
    });
}
