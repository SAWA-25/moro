import React from 'react';

/**
 * 简笔天气图标。OpenWeatherMap icon code 前缀 → 晴/雨/雷/雪/雾/云 六类线描图标。
 * 桌面天气小组件、天气预报详情页共用，避免重复定义（也防止两者循环依赖）。
 */
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

export default WeatherGlyph;
