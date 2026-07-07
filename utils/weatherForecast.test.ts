import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultRealtimeConfig, forecastDayLabel, parseOpenMeteoForecast, RealtimeContextManager } from './realtimeContext';

/** Open-Meteo forecast 响应样例（裁剪到我们用到的字段）。 */
const sample = {
    current: {
        temperature_2m: 18.4,
        apparent_temperature: 17.2,
        relative_humidity_2m: 63,
        weather_code: 61, // 小雨
    },
    daily: {
        time: ['2026-06-23', '2026-06-24', '2026-06-25', '2026-06-26'],
        weather_code: [3, 0, 80, 95],          // 阴 / 晴 / 阵雨 / 雷阵雨
        temperature_2m_max: [24.6, 28.1, 22.9, 20.0],
        temperature_2m_min: [16.1, 17.7, 15.2, 14.8],
        precipitation_probability_max: [20, 0, 60, 90],
    },
};

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

afterEach(() => {
    RealtimeContextManager.clearCache();
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('parseOpenMeteoForecast', () => {
    it('解析当前实况：温度/体感/湿度四舍五入，天气码映射中文', () => {
        const f = parseOpenMeteoForecast(sample, '上海', 1_700_000_000_000)!;
        expect(f).not.toBeNull();
        expect(f.city).toBe('上海');
        expect(f.current.temp).toBe(18);
        expect(f.current.feelsLike).toBe(17);
        expect(f.current.humidity).toBe(63);
        expect(f.current.description).toBe('小雨');
        expect(f.updatedAt).toBe(1_700_000_000_000);
    });

    it('逐日预报：天数、最高/最低温、降水概率、天气描述都对上', () => {
        const f = parseOpenMeteoForecast(sample, '上海', Date.now())!;
        expect(f.days.length).toBe(4);
        expect(f.days[1]).toMatchObject({
            date: '2026-06-24',
            tempMax: 28,
            tempMin: 18,
            desc: '晴',
            precipProb: 0,
        });
        expect(f.days[3].precipProb).toBe(90);
        expect(f.days[3].desc).toBe('雷阵雨');
    });

    it('前三天用 今天/明天/后天，之后用周几', () => {
        const f = parseOpenMeteoForecast(sample, '上海', Date.now())!;
        expect(f.days[0].label).toBe('今天');
        expect(f.days[1].label).toBe('明天');
        expect(f.days[2].label).toBe('后天');
        // 第 4 天（index 3）走周几分支
        expect(f.days[3].label).toMatch(/^周[日一二三四五六]$/);
    });

    it('缺少 current 或 daily 时返回 null', () => {
        expect(parseOpenMeteoForecast({ daily: sample.daily }, '', Date.now())).toBeNull();
        expect(parseOpenMeteoForecast({ current: sample.current }, '', Date.now())).toBeNull();
        expect(parseOpenMeteoForecast({ current: sample.current, daily: { time: [] } }, '', Date.now())).toBeNull();
    });

    it('空城市名回退到「当前位置」', () => {
        const f = parseOpenMeteoForecast(sample, '', Date.now())!;
        expect(f.city).toBe('当前位置');
        expect(f.current.city).toBe('当前位置');
    });
});

describe('fetchWeather geolocation permission', () => {
    it('优先使用免密钥实况观测，减少当前天气和实际体感错位', async () => {
        const getCurrentPosition = vi.fn();
        vi.stubGlobal('navigator', {
            permissions: { query: vi.fn().mockResolvedValue({ state: 'prompt' }) },
            geolocation: { getCurrentPosition },
        });
        vi.stubGlobal('fetch', vi.fn(async (url: string) => {
            if (url.includes('get.geojs.io')) return jsonResponse({ latitude: '30.67', longitude: '104.07' });
            if (url.includes('bigdatacloud.net')) return jsonResponse({ city: '成都' });
            if (url.includes('wttr.in')) return jsonResponse({
                current_condition: [{
                    temp_C: '32',
                    FeelsLikeC: '36',
                    humidity: '58',
                    weatherCode: '149',
                    weatherDesc: [{ value: 'Smoky haze' }],
                }],
            });
            if (url.includes('open-meteo.com')) return jsonResponse({ current: sample.current });
            return jsonResponse({}, 404);
        }));

        const weather = await RealtimeContextManager.fetchWeather({
            ...defaultRealtimeConfig,
            weatherEnabled: true,
            weatherMode: 'geo',
        });

        expect(getCurrentPosition).not.toHaveBeenCalled();
        expect(weather).toMatchObject({
            city: '成都',
            temp: 32,
            feelsLike: 36,
            humidity: 58,
            description: '霾',
            source: 'wttr.in',
        });
    });

    it('天气缓存按定位坐标隔离，坐标变化时不会复用上一处天气', async () => {
        const coords = [
            { latitude: 30, longitude: 104 },
            { latitude: 31, longitude: 105 },
        ];
        const getCurrentPosition = vi.fn((success: PositionCallback) => {
            const next = coords.shift()!;
            success({
                coords: next as GeolocationCoordinates,
                timestamp: Date.now(),
            } as GeolocationPosition);
        });
        let openMeteoCalls = 0;
        vi.stubGlobal('navigator', {
            permissions: { query: vi.fn().mockResolvedValue({ state: 'granted' }) },
            geolocation: { getCurrentPosition },
        });
        vi.stubGlobal('fetch', vi.fn(async (url: string) => {
            if (url.includes('wttr.in')) return jsonResponse({}, 404);
            if (url.includes('bigdatacloud.net')) {
                return jsonResponse({ city: url.includes('latitude=31') ? '新城' : '旧城' });
            }
            if (url.includes('open-meteo.com')) {
                openMeteoCalls += 1;
                const isNew = url.includes('latitude=31');
                return jsonResponse({
                    current: {
                        temperature_2m: isNew ? 31.4 : 18.4,
                        apparent_temperature: isNew ? 35.2 : 17.2,
                        relative_humidity_2m: isNew ? 55 : 63,
                        weather_code: isNew ? 2 : 61,
                    },
                });
            }
            return jsonResponse({}, 404);
        }));

        const config = {
            ...defaultRealtimeConfig,
            weatherEnabled: true,
            weatherMode: 'geo' as const,
            cacheMinutes: 30,
        };
        const first = await RealtimeContextManager.fetchWeather(config);
        const second = await RealtimeContextManager.fetchWeather(config);

        expect(first?.city).toBe('旧城');
        expect(first?.temp).toBe(18);
        expect(second?.city).toBe('新城');
        expect(second?.temp).toBe(31);
        expect(getCurrentPosition).toHaveBeenCalledTimes(2);
        expect(openMeteoCalls).toBe(2);
    });

    it('自动取天气时，定位权限未决定也不会弹浏览器定位授权', async () => {
        const getCurrentPosition = vi.fn();
        vi.stubGlobal('navigator', {
            permissions: { query: vi.fn().mockResolvedValue({ state: 'prompt' }) },
            geolocation: { getCurrentPosition },
        });
        vi.stubGlobal('fetch', vi.fn(async (url: string) => {
            if (url.includes('get.geojs.io')) return jsonResponse({ latitude: '31.23', longitude: '121.47' });
            if (url.includes('open-meteo.com')) return jsonResponse({ current: sample.current });
            if (url.includes('bigdatacloud.net')) return jsonResponse({ city: '上海' });
            return jsonResponse({}, 404);
        }));

        const weather = await RealtimeContextManager.fetchWeather({
            ...defaultRealtimeConfig,
            weatherEnabled: true,
            weatherMode: 'geo',
            cacheMinutes: 0,
        });

        expect(getCurrentPosition).not.toHaveBeenCalled();
        expect(weather?.city).toBe('上海');
        expect(weather?.description).toBe('小雨');
    });

    it('主动测试天气时，仍允许请求浏览器定位', async () => {
        const getCurrentPosition = vi.fn((success: PositionCallback) => success({
            coords: { latitude: 31.23, longitude: 121.47 } as GeolocationCoordinates,
            timestamp: Date.now(),
        } as GeolocationPosition));
        vi.stubGlobal('navigator', {
            permissions: { query: vi.fn().mockResolvedValue({ state: 'prompt' }) },
            geolocation: { getCurrentPosition },
        });
        vi.stubGlobal('fetch', vi.fn(async (url: string) => {
            if (url.includes('open-meteo.com')) return jsonResponse({ current: sample.current });
            if (url.includes('bigdatacloud.net')) return jsonResponse({ city: '上海' });
            return jsonResponse({}, 404);
        }));

        const weather = await RealtimeContextManager.fetchWeather({
            ...defaultRealtimeConfig,
            weatherEnabled: true,
            weatherMode: 'geo',
            cacheMinutes: 0,
        }, { requestLocationPermission: true });

        expect(getCurrentPosition).toHaveBeenCalledTimes(1);
        expect(weather?.city).toBe('上海');
    });
});

describe('forecastDayLabel', () => {
    it('idx 0/1/2 固定为 今天/明天/后天', () => {
        expect(forecastDayLabel('2026-06-23', 0)).toBe('今天');
        expect(forecastDayLabel('2026-06-23', 1)).toBe('明天');
        expect(forecastDayLabel('2026-06-23', 2)).toBe('后天');
    });

    it('idx>=3 给出周几（2026-06-26 为周五）', () => {
        expect(forecastDayLabel('2026-06-26', 3)).toBe('周五');
    });

    it('非法日期回退到 dateStr.slice(5)', () => {
        // 'not-a-date'.slice(5) === '-date'
        expect(forecastDayLabel('not-a-date', 5)).toBe('-date');
    });
});
