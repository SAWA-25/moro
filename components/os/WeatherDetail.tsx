import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useOS } from '../../context/OSContext';
import { RealtimeContextManager, WeatherForecast } from '../../utils/realtimeContext';
import { AppID } from '../../types';
import WeatherGlyph from './WeatherGlyph';

/**
 * 天气预报详情页（点桌面天气小组件展开）。
 * 顶部当前实况 + 出行建议，下方未来七天逐日预报（最高/最低温、降水概率、温度条）。
 * 数据走 RealtimeContextManager.fetchWeatherForecast（免密钥 Open-Meteo）。
 * 用 createPortal 挂到 body：绕开桌面 App 容器的 contain 裁剪，铺满整机。
 */

// 天气类别 → 详情页天空渐变背景（与简笔图标同一套 icon code 前缀判断）
const skyBackground = (icon?: string): string => {
    const i = icon || '03d';
    if (i.startsWith('01')) return 'linear-gradient(170deg, #6ba8e0 0%, #9ec4e6 48%, #e7d7bd 100%)';
    if (i.startsWith('09') || i.startsWith('10')) return 'linear-gradient(170deg, #5b6b80 0%, #8294a6 52%, #b8c2cc 100%)';
    if (i.startsWith('11')) return 'linear-gradient(170deg, #3f4659 0%, #5d6678 52%, #8b8fa0 100%)';
    if (i.startsWith('13')) return 'linear-gradient(170deg, #9fb6c9 0%, #cdd9e4 50%, #eef3f7 100%)';
    if (i.startsWith('50')) return 'linear-gradient(170deg, #8b94a0 0%, #aab1ba 52%, #d6dadf 100%)';
    return 'linear-gradient(170deg, #7e93ad 0%, #a8b6c6 52%, #d9ddDF 100%)';
};

interface WeatherDetailProps {
    onClose: () => void;
}

const WeatherDetail: React.FC<WeatherDetailProps> = ({ onClose }) => {
    const { realtimeConfig, openApp } = useOS();
    const [forecast, setForecast] = useState<WeatherForecast | null>(null);
    const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

    const load = React.useCallback((force = false) => {
        setStatus('loading');
        if (force) RealtimeContextManager.clearWeatherCache();
        RealtimeContextManager.fetchWeatherForecast(
            realtimeConfig,
            force ? { requestLocationPermission: true } : undefined,
        )
            .then(f => {
                if (f) { setForecast(f); setStatus('ready'); }
                else setStatus('error');
            })
            .catch(() => setStatus('error'));
    }, [realtimeConfig]);

    useEffect(() => { load(); }, [load]);

    const advice = forecast ? RealtimeContextManager.generateWeatherAdvice(forecast.current) : '';

    // 温度条：用七天里的整体最低/最高温做区间，给每天画一段相对位置的细条
    const tempRange = useMemo(() => {
        const days = forecast?.days || [];
        if (days.length === 0) return { lo: 0, hi: 1 };
        let lo = Infinity, hi = -Infinity;
        for (const d of days) { lo = Math.min(lo, d.tempMin); hi = Math.max(hi, d.tempMax); }
        if (!isFinite(lo) || !isFinite(hi) || hi === lo) return { lo, hi: lo + 1 };
        return { lo, hi };
    }, [forecast]);

    const span = tempRange.hi - tempRange.lo;
    const bg = skyBackground(forecast?.current.icon);

    const overlay = (
        <div className="fixed inset-0 z-[9998] flex flex-col text-white animate-fade-in"
            style={{ background: bg, paddingTop: 'max(10px, var(--safe-top))' }}>
            {/* 顶栏：城市 + 关闭 */}
            <div className="shrink-0 px-5 py-3 flex items-center justify-between">
                <div className="min-w-0">
                    <div className="text-[15px] font-bold truncate" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.25)' }}>
                        {forecast?.city || '天气预报'}
                    </div>
                    <div className="text-[10px] opacity-70 label-mono">天气预报</div>
                </div>
                <button onClick={onClose}
                    className="shrink-0 w-9 h-9 rounded-full bg-white/20 backdrop-blur flex items-center justify-center text-white text-lg active:scale-90 transition-transform"
                    aria-label="关闭">✕</button>
            </div>

            {status === 'loading' && (
                <div className="flex-1 flex flex-col items-center justify-center gap-4 opacity-90">
                    <div className="w-9 h-9 border-4 border-white/30 border-t-white rounded-full animate-spin" />
                    <div className="text-xs">正在获取天气预报…</div>
                </div>
            )}

            {status === 'error' && (
                <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8 text-center">
                    <WeatherGlyph icon="03d" className="w-14 h-14 opacity-70" />
                    <div className="text-sm opacity-90">暂时取不到天气预报</div>
                    <div className="text-[11px] opacity-60 leading-relaxed">
                        可能是定位被拒绝或网络问题。可在「设置 → 风向标」里改用手填城市，或检查网络后重试。
                    </div>
                    <div className="flex gap-2 mt-1">
                        <button onClick={() => load()} className="px-4 py-2 rounded-full bg-white/25 backdrop-blur text-xs font-bold active:scale-95 transition-transform">重试</button>
                        <button onClick={() => { onClose(); openApp(AppID.Settings); }} className="px-4 py-2 rounded-full bg-white/15 text-xs font-bold active:scale-95 transition-transform">去配置</button>
                    </div>
                </div>
            )}

            {status === 'ready' && forecast && (
                <div className="flex-1 overflow-y-auto no-scrollbar px-5 pb-8">
                    {/* 当前实况 hero */}
                    <div className="flex items-center justify-between gap-3 pt-2 pb-4">
                        <div>
                            <div className="text-[5rem] leading-none font-bold tracking-tight" style={{ fontFamily: 'var(--font-hand)', textShadow: '0 2px 10px rgba(0,0,0,0.18)' }}>
                                {forecast.current.temp}°
                            </div>
                            <div className="text-[15px] font-medium mt-1 opacity-95">{forecast.current.description}</div>
                            <div className="text-[11px] opacity-75 mt-0.5">
                                体感 {forecast.current.feelsLike}° · 湿度 {forecast.current.humidity}%
                            </div>
                        </div>
                        <WeatherGlyph icon={forecast.current.icon} className="w-24 h-24 opacity-80 shrink-0" />
                    </div>

                    {/* 出行建议 */}
                    {advice && (
                        <div className="rounded-2xl bg-white/15 backdrop-blur px-4 py-3 text-[13px] leading-relaxed mb-5">
                            {advice}
                        </div>
                    )}

                    {/* 未来七天 */}
                    <div className="text-[11px] font-bold opacity-70 tracking-wider mb-2 px-1">未来七天</div>
                    <div className="rounded-2xl bg-white/12 backdrop-blur overflow-hidden">
                        {forecast.days.map((d, i) => {
                            const lPct = Math.round(((d.tempMin - tempRange.lo) / span) * 100);
                            const wPct = Math.max(8, Math.round(((d.tempMax - d.tempMin) / span) * 100));
                            return (
                                <div key={d.date} className={`flex items-center gap-3 px-4 py-2.5 ${i > 0 ? 'border-t border-white/10' : ''}`}>
                                    <div className="w-10 shrink-0 text-[13px] font-medium">{d.label}</div>
                                    <WeatherGlyph icon={d.icon} className="w-6 h-6 opacity-85 shrink-0" />
                                    <div className="w-9 shrink-0 text-[10px] opacity-70 text-center leading-tight">
                                        {d.precipProb > 0 ? `${d.precipProb}%` : ''}
                                    </div>
                                    <div className="flex-1 flex items-center gap-2 min-w-0">
                                        <span className="text-[12px] opacity-70 w-7 text-right shrink-0">{d.tempMin}°</span>
                                        <div className="flex-1 h-1.5 rounded-full bg-white/15 relative overflow-hidden">
                                            <div className="absolute top-0 bottom-0 rounded-full bg-white/70"
                                                style={{ left: `${lPct}%`, width: `${wPct}%` }} />
                                        </div>
                                        <span className="text-[12px] font-medium w-7 shrink-0">{d.tempMax}°</span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* 数据来源 + 刷新 */}
                    <div className="flex items-center justify-between mt-5 px-1 text-[10px] opacity-55 label-mono">
                        <span>实时 · {forecast.current.source || 'Open-Meteo'} · 预报 · Open-Meteo</span>
                        <button onClick={() => load(true)} className="underline active:opacity-70">刷新</button>
                    </div>
                </div>
            )}
        </div>
    );

    if (typeof document === 'undefined') return overlay;
    return createPortal(overlay, document.body);
};

export default WeatherDetail;
