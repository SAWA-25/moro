import { describe, it, expect } from 'vitest';
import { parseOpenMeteoForecast, forecastDayLabel } from './realtimeContext';

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
