import React, { useEffect, useState } from 'react';
import { useOS } from '../../context/OSContext';
import { RealtimeContextManager, WeatherData } from '../../utils/realtimeContext';
import { AppID } from '../../types';
import WeatherGlyph from './WeatherGlyph';
import WeatherDetail from './WeatherDetail';

/**
 * 桌面天气小组件（参照手帐桌面设计稿：浅灰圆角卡 + 大号温度 + 灰色天气图标）。
 * 数据走 文具盒 → 风向标（实时感知）的天气配置：默认「定位 + Open-Meteo」免密钥取
 * 用户所在地实时天气，也兼容旧版手填 OpenWeatherMap Key（RealtimeContextManager 内置缓存）。
 * 未开启时点击直达文具盒；已开启时点击展开「天气预报」详情页（未来七天）。
 */

const WeatherWidget: React.FC<{ contentColor: string }> = React.memo(({ contentColor }) => {
    const { realtimeConfig, openApp } = useOS();
    const [weather, setWeather] = useState<WeatherData | null>(null);
    const [detailOpen, setDetailOpen] = useState(false);
    // geo 模式免密钥；manual 模式仍需 Key
    const mode = realtimeConfig.weatherMode || 'geo';
    const configured = !!(realtimeConfig.weatherEnabled && (mode !== 'manual' || realtimeConfig.weatherApiKey));

    useEffect(() => {
        let alive = true;
        if (!configured) { setWeather(null); return; }
        RealtimeContextManager.fetchWeather(realtimeConfig).then(w => { if (alive) setWeather(w); });
        return () => { alive = false; };
    }, [configured, mode, realtimeConfig.weatherApiKey, realtimeConfig.weatherCity]);

    // 天气描述：首字母大写的英文/中文描述（OpenWeatherMap zh_cn 直接给中文）
    const desc = weather?.description
        ? weather.description.charAt(0).toUpperCase() + weather.description.slice(1)
        : 'Cloudy';

    return (
        <>
        {detailOpen && <WeatherDetail onClose={() => setDetailOpen(false)} />}
        <div
            className="moro-widget-weather glass-card relative h-full w-full rounded-[1.75rem] px-5 py-4 cursor-pointer press-soft animate-rise-in overflow-hidden flex flex-col justify-between"
            style={{ color: contentColor, animationDelay: '40ms' }}
            onClick={() => {
                if (!configured) openApp(AppID.Settings);
                else setDetailOpen(true);
            }}
        >
            <div className="flex items-start justify-between gap-2">
                <div className="text-[2rem] leading-none font-bold tracking-tight" style={{ fontFamily: 'var(--font-hand)' }}>
                    {weather ? `${weather.temp}°` : '—°'}
                </div>
                <WeatherGlyph icon={weather?.icon} className="w-10 h-10 opacity-45 shrink-0" />
            </div>
            <div className="min-w-0">
                <div className="font-hand text-[17px] leading-none opacity-70 truncate">{weather ? desc : 'Cloudy'}</div>
                {!configured && (
                    <div className="text-[8.5px] opacity-40 mt-1 leading-tight truncate">点这里去 设置 配置天气</div>
                )}
                {configured && weather?.city && (
                    <div className="text-[8.5px] label-mono opacity-40 mt-1 truncate">{weather.city}</div>
                )}
            </div>
        </div>
        </>
    );
});

export default WeatherWidget;
