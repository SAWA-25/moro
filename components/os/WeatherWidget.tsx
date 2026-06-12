import React, { useEffect, useState } from 'react';
import { useOS } from '../../context/OSContext';
import { RealtimeContextManager, WeatherData } from '../../utils/realtimeContext';
import { AppID } from '../../types';

/**
 * 桌面天气小组件（参照手帐桌面设计稿：浅灰圆角卡 + 大号温度 + 灰色天气图标）。
 * 数据走 系统设置 → 实时感知 的 OpenWeatherMap 配置（RealtimeContextManager 内置缓存）；
 * 未配置时显示占位云朵，点击直达系统设置。
 */

// OpenWeatherMap icon code 前缀 → 简笔天气图标
const WeatherGlyph: React.FC<{ icon?: string; className?: string }> = ({ icon = '03d', className }) => {
    const kind = icon.startsWith('01') ? 'sun'
        : icon.startsWith('09') || icon.startsWith('10') ? 'rain'
        : icon.startsWith('11') ? 'storm'
        : icon.startsWith('13') ? 'snow'
        : icon.startsWith('50') ? 'mist'
        : 'cloud';
    const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
    if (kind === 'sun') return (
        <svg viewBox="0 0 24 24" className={className} {...stroke}><circle cx="12" cy="12" r="4.2" /><path d="M12 2.8v2.2M12 19v2.2M2.8 12H5M19 12h2.2M5.5 5.5l1.6 1.6M16.9 16.9l1.6 1.6M18.5 5.5l-1.6 1.6M7.1 16.9l-1.6 1.6" /></svg>
    );
    if (kind === 'rain') return (
        <svg viewBox="0 0 24 24" className={className} {...stroke}><path d="M7 15a4.5 4.5 0 1 1 .8-8.9A5.5 5.5 0 0 1 18.6 8 3.8 3.8 0 0 1 17.5 15Z" /><path d="M9 18l-.8 2.2M13 18l-.8 2.2M17 18l-.8 2.2" /></svg>
    );
    if (kind === 'storm') return (
        <svg viewBox="0 0 24 24" className={className} {...stroke}><path d="M7 14a4.5 4.5 0 1 1 .8-8.9A5.5 5.5 0 0 1 18.6 7 3.8 3.8 0 0 1 17.5 14Z" /><path d="M12.5 14.5 10 18.5h3l-1.8 3.5" /></svg>
    );
    if (kind === 'snow') return (
        <svg viewBox="0 0 24 24" className={className} {...stroke}><path d="M7 15a4.5 4.5 0 1 1 .8-8.9A5.5 5.5 0 0 1 18.6 8 3.8 3.8 0 0 1 17.5 15Z" /><path d="M9 18.5h.01M12.5 20h.01M16 18.5h.01" /></svg>
    );
    if (kind === 'mist') return (
        <svg viewBox="0 0 24 24" className={className} {...stroke}><path d="M4 10h13M7 14h13M4.5 18h12" /></svg>
    );
    return (
        <svg viewBox="0 0 24 24" className={className} {...stroke}><path d="M6.5 18a4.5 4.5 0 1 1 .8-8.9A5.5 5.5 0 0 1 18.1 11 3.8 3.8 0 0 1 17 18.4Z" /></svg>
    );
};

const WeatherWidget: React.FC<{ contentColor: string }> = React.memo(({ contentColor }) => {
    const { realtimeConfig, openApp } = useOS();
    const [weather, setWeather] = useState<WeatherData | null>(null);
    const configured = !!(realtimeConfig.weatherEnabled && realtimeConfig.weatherApiKey);

    useEffect(() => {
        let alive = true;
        if (!configured) { setWeather(null); return; }
        RealtimeContextManager.fetchWeather(realtimeConfig).then(w => { if (alive) setWeather(w); });
        return () => { alive = false; };
    }, [configured, realtimeConfig.weatherApiKey, realtimeConfig.weatherCity]);

    // 天气描述：首字母大写的英文/中文描述（OpenWeatherMap zh_cn 直接给中文）
    const desc = weather?.description
        ? weather.description.charAt(0).toUpperCase() + weather.description.slice(1)
        : 'Cloudy';

    return (
        <div
            className="moro-widget-weather glass-card relative h-full w-full rounded-[1.75rem] px-5 py-4 cursor-pointer press-soft animate-rise-in overflow-hidden flex flex-col justify-between"
            style={{ color: contentColor, animationDelay: '40ms' }}
            onClick={() => {
                if (!configured) openApp(AppID.Settings);
                else RealtimeContextManager.fetchWeather(realtimeConfig).then(setWeather);
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
    );
});

export default WeatherWidget;
