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

const APP_TILE_BG: Record<string, string> = {
  green: 'linear-gradient(180deg, #9fd7b2 0%, #6fb88a 100%)',
  orange: 'linear-gradient(180deg, #f6c38d 0%, #ee9d63 100%)',
  rose: 'linear-gradient(180deg, #f4b0b9 0%, #dd7b91 100%)',
  red: 'linear-gradient(180deg, #ee9b98 0%, #d56569 100%)',
  violet: 'linear-gradient(180deg, #c8b6eb 0%, #9b83ca 100%)',
  indigo: 'linear-gradient(180deg, #aeb9eb 0%, #7a89c7 100%)',
  sky: 'linear-gradient(180deg, #b8d7ef 0%, #7fb7dc 100%)',
  teal: 'linear-gradient(180deg, #a6d8d2 0%, #72b8b1 100%)',
  slate: 'linear-gradient(180deg, #c8c7cf 0%, #92919d 100%)',
  lime: 'linear-gradient(180deg, #dbe6a6 0%, #b3c766 100%)',
  amber: 'linear-gradient(180deg, #f3d09a 0%, #d7a864 100%)',
  emerald: 'linear-gradient(180deg, #a7dfc4 0%, #63b58b 100%)',
  fuchsia: 'linear-gradient(180deg, #ecb6d9 0%, #cf7cb2 100%)',
  pink: 'linear-gradient(180deg, #efbfd3 0%, #d988a9 100%)',
  blue: 'linear-gradient(180deg, #b6cff4 0%, #759edd 100%)',
  purple: 'linear-gradient(180deg, #cbb8f2 0%, #9377d5 100%)',
};

const AppIcon: React.FC<AppIconProps> = React.memo(({ app, onClick, size = 'md', hideLabel = false, variant = 'default' }) => {
  const { customIcons, theme } = useOS();
  const IconComponent = Icons[app.icon] || Icons.Settings;
  const customIconUrl = customIcons[app.id];
  const contentColor = theme.contentColor || '#2b2933';
  const isInverseTile = app.id === 'settings';

  const shape = theme.desktopIconShape || 'rounded';
  const surface = theme.desktopIconSurface || 'paper';
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
          className={`moro-app-label ${size === 'sm' ? 'text-[8px]' : 'text-[9px]'} ${labelClass} label-mono font-bold max-w-full truncate block`}
          style={{ color: contentColor }}
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
