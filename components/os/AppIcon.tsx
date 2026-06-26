import React from 'react';
import { AppConfig } from '../../types';
import { Icons } from '../../constants';
import { useOS } from '../../context/OSContext';
import { preloadApp } from './appPreload';

interface AppIconProps {
  app: AppConfig;
  onClick: () => void;
  size?: 'sm' | 'md' | 'lg';
  hideLabel?: boolean;
  variant?: 'default' | 'minimal' | 'dock';
}

// Ins 风彩色瓦片：每个 app 自己的颜色，明快现代的 160° 渐变方块（白色图标）
const APP_TILE_BG: Record<string, string> = {
  green: 'linear-gradient(160deg, #4ade80 0%, #16a34a 100%)',
  orange: 'linear-gradient(160deg, #fdba74 0%, #f97316 100%)',
  rose: 'linear-gradient(160deg, #fda4b8 0%, #f43f5e 100%)',
  red: 'linear-gradient(160deg, #fca5a5 0%, #ef4444 100%)',
  violet: 'linear-gradient(160deg, #c4b5fd 0%, #8b5cf6 100%)',
  indigo: 'linear-gradient(160deg, #a5b4fc 0%, #6366f1 100%)',
  sky: 'linear-gradient(160deg, #7dd3fc 0%, #0ea5e9 100%)',
  teal: 'linear-gradient(160deg, #5eead4 0%, #14b8a6 100%)',
  slate: 'linear-gradient(160deg, #cbd5e1 0%, #64748b 100%)',
  lime: 'linear-gradient(160deg, #bef264 0%, #65a30d 100%)',
  amber: 'linear-gradient(160deg, #fcd34d 0%, #f59e0b 100%)',
  emerald: 'linear-gradient(160deg, #6ee7b7 0%, #10b981 100%)',
  fuchsia: 'linear-gradient(160deg, #f0abfc 0%, #d946ef 100%)',
  pink: 'linear-gradient(160deg, #f9a8d4 0%, #ec4899 100%)',
  blue: 'linear-gradient(160deg, #93c5fd 0%, #3b82f6 100%)',
  purple: 'linear-gradient(160deg, #d8b4fe 0%, #a855f7 100%)',
};

const AppIcon: React.FC<AppIconProps> = React.memo(({ app, onClick, size = 'md', hideLabel = false, variant = 'default' }) => {
  const { customIcons, theme } = useOS();
  const IconComponent = Icons[app.icon] || Icons.Settings;
  const customIconUrl = customIcons[app.id];
  const contentColor = theme.contentColor || '#2b2933';
  const isInverseTile = app.id === 'settings';

  const shape = theme.desktopIconShape || 'squircle';
  const surface = theme.desktopIconSurface || 'solid';
  const dockStyle = theme.desktopDockStyle || 'glass';
  const iconScale = theme.desktopIconScale || 'md';
  const labelMode = theme.desktopIconLabelMode || 'fade';
  const roundedClass =
    shape === 'circle' ? 'rounded-full' :
    shape === 'squircle' ? 'rounded-[1.7rem]' :
    shape === 'stamp' ? 'rounded-[1rem]' :
    'rounded-[1.35rem]';

  const sizeClasses =
    size === 'lg' ? 'w-[4.25rem] h-[4.25rem]' :
    size === 'sm' ? 'w-[2.75rem] h-[2.75rem]' :
    'w-[3.5rem] h-[3.5rem]';

  const visualScaleClass =
    iconScale === 'lg' ? 'scale-[1.08]' :
    iconScale === 'sm' ? 'scale-[0.94]' :
    'scale-100';

  const iconInnerSize =
    shape === 'circle' ? 'w-[50%] h-[50%]' :
    iconScale === 'lg' ? 'w-[50%] h-[50%]' :
    iconScale === 'sm' ? 'w-[42%] h-[42%]' :
    'w-[46%] h-[46%]';

  const labelClass =
    labelMode === 'hide' ? 'hidden' :
    labelMode === 'show' ? 'opacity-90' :
    'opacity-60 transition-opacity group-hover:opacity-90';

  const defaultTileStyle: React.CSSProperties = customIconUrl ? {} : (
    surface === 'minimal' ? {
      background: 'transparent',
      border: '1px solid rgba(43, 41, 51, 0.08)',
      boxShadow: 'none',
    } : surface === 'glass' ? {
      background: 'linear-gradient(180deg, rgba(255,255,255,0.68) 0%, rgba(255,255,255,0.36) 100%)',
      border: '1px solid rgba(255,255,255,0.58)',
      boxShadow: '0 18px 34px -20px rgba(43,41,51,0.4)',
      backdropFilter: 'blur(14px)',
    } : surface === 'solid' ? {
      background: APP_TILE_BG[app.color] || 'linear-gradient(180deg, #d8d5de 0%, #aaa7b2 100%)',
      border: '1px solid rgba(43,41,51,0.08)',
      boxShadow: '0 16px 28px -18px rgba(43,41,51,0.45)',
    } : {
      background: isInverseTile ? '#1c1b22' : '#ffffff',
      border: `1px solid ${isInverseTile ? '#1c1b22' : '#efece5'}`,
      boxShadow: isInverseTile
        ? '0 12px 26px -12px rgba(28,27,34,0.6)'
        : '0 12px 26px -14px rgba(50,48,60,0.3)',
    }
  );

  const iconColor = customIconUrl
    ? contentColor
    : surface === 'solid'
      ? '#ffffff'
      : isInverseTile
        ? '#ffffff'
        : contentColor;

  const dockShellStyle: React.CSSProperties = customIconUrl ? {} : (
    dockStyle === 'minimal' ? {
      background: 'transparent',
      boxShadow: 'none',
      border: 'none',
    } : dockStyle === 'solid' ? {
      background: 'rgba(43,41,51,0.9)',
      border: '1px solid rgba(255,255,255,0.08)',
      boxShadow: '0 10px 22px -16px rgba(20,18,28,0.55)',
    } : dockStyle === 'paper' ? {
      background: 'rgba(251,250,247,0.98)',
      border: '1px solid rgba(224,220,213,0.95)',
      boxShadow: '0 10px 20px -16px rgba(43,41,51,0.28)',
    } : {
      background: 'rgba(255,255,255,0.34)',
      border: '1px solid rgba(255,255,255,0.42)',
      boxShadow: '0 10px 22px -16px rgba(43,41,51,0.35)',
      backdropFilter: 'blur(10px)',
    }
  );

  const dockIconColor = customIconUrl ? contentColor : dockStyle === 'solid' ? '#ffffff' : contentColor;

  if (variant === 'dock') {
    return (
      <button
        onClick={onClick}
        onPointerDown={() => preloadApp(app.id)}
        className="flex flex-col items-center group relative press-soft"
        style={{ WebkitTapHighlightColor: 'transparent' }}
      >
        <div
          className={`moro-dock-icon ${sizeClasses} ${shape === 'circle' ? 'rounded-full' : 'rounded-[1.25rem]'} relative flex items-center justify-center transition-transform duration-300 group-hover:scale-110 will-change-transform`}
          style={dockShellStyle}
        >
          {customIconUrl ? (
            <img
              src={customIconUrl}
              className={`w-full h-full object-cover ${shape === 'circle' ? 'rounded-full' : 'rounded-[1.25rem]'}`}
              alt={app.name}
              loading="lazy"
            />
          ) : (
            <div className="w-[52%] h-[52%]" style={{ color: dockIconColor }}>
              <IconComponent className="w-full h-full" />
            </div>
          )}
        </div>
      </button>
    );
  }

  return (
    <button
      onClick={onClick}
      onPointerDown={() => preloadApp(app.id)}
      className="flex flex-col items-center gap-1.5 group relative press-soft"
      style={{ WebkitTapHighlightColor: 'transparent' }}
    >
      <div
        className={`moro-app-tile ${sizeClasses} ${roundedClass} ${visualScaleClass} relative flex items-center justify-center transition-[transform,border-color,box-shadow,background] duration-300 will-change-transform ${surface !== 'minimal' && !customIconUrl ? 'group-hover:-translate-y-[1px]' : ''} ${shape === 'stamp' ? 'rotate-[-1.6deg] group-hover:rotate-0' : ''}`}
        style={defaultTileStyle}
      >
        {customIconUrl ? (
          <img
            src={customIconUrl}
            className={`w-full h-full object-cover ${roundedClass}`}
            alt={app.name}
            loading="lazy"
          />
        ) : (
          <div
            className={`${iconInnerSize} transition-transform duration-300 group-hover:scale-110`}
            style={{ color: iconColor }}
          >
            <IconComponent className="w-full h-full" />
          </div>
        )}

        {shape === 'stamp' && !customIconUrl && (
          <div
            className="pointer-events-none absolute inset-[5px] rounded-[0.8rem] border border-dashed opacity-35"
            style={{ borderColor: iconColor }}
          />
        )}
      </div>

      {!hideLabel && labelMode !== 'hide' && (
        <span
          className={`moro-app-label ${size === 'sm' ? 'text-[9px]' : 'text-[10.5px]'} ${labelClass} font-semibold tracking-tight max-w-full truncate block`}
          style={{ color: contentColor, letterSpacing: '-0.01em' }}
        >
          {app.name}
        </span>
      )}
    </button>
  );
}, (prev, next) => {
  return prev.app.id === next.app.id &&
         prev.size === next.size &&
         prev.hideLabel === next.hideLabel &&
         prev.variant === next.variant;
});

export default AppIcon;
