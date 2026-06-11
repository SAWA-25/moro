
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

const AppIcon: React.FC<AppIconProps> = React.memo(({ app, onClick, size = 'md', hideLabel = false, variant = 'default' }) => {
  const { customIcons, theme } = useOS();
  const IconComponent = Icons[app.icon] || Icons.Settings;
  const customIconUrl = customIcons[app.id];
  const contentColor = theme.contentColor || '#3f3d49';

  // Standard sizes
  const sizeClasses =
    size === 'lg' ? 'w-[4.25rem] h-[4.25rem]' :
    size === 'sm' ? 'w-[2.75rem] h-[2.75rem]' :
    'w-[3.5rem] h-[3.5rem]';

  // Dock 变体：描边圆形按钮（编辑部纸感 — 细线圈 + 墨色线性图标）
  if (variant === 'dock') {
    return (
      <button
        onClick={onClick}
        onPointerDown={() => preloadApp(app.id)}
        className="flex flex-col items-center group relative press-soft"
        style={{ WebkitTapHighlightColor: 'transparent' }}
      >
        <div className={`moro-dock-icon ${sizeClasses} relative flex items-center justify-center rounded-full
          bg-white/55 border border-[#e4e3ec]
          shadow-[0_6px_16px_-8px_rgba(63,61,86,0.25)]
          transition-colors duration-300 group-hover:bg-white group-hover:border-[#d6d4e2]
        `}>
          {customIconUrl ? (
            <img src={customIconUrl} className="w-full h-full object-cover rounded-full" alt={app.name} loading="lazy" />
          ) : (
            <div className="w-[46%] h-[46%] opacity-75" style={{ color: contentColor }}>
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
      {/* 纸感瓦片：白色微透卡片 + 细边 + 柔影（blur 不放在图标上 — 8+ 个图标会卡启动器） */}
      <div className={`moro-app-tile ${sizeClasses} relative flex items-center justify-center
        bg-white/72 rounded-[1.25rem]
        border border-[#ececf2]
        shadow-[0_10px_24px_-12px_rgba(63,61,86,0.28)]
        transition-colors duration-300
        group-hover:bg-white group-hover:border-[#e0dfe9]
      `}>

        {customIconUrl ? (
            <img src={customIconUrl} className="w-full h-full object-cover rounded-[1.25rem]" alt={app.name} loading="lazy" />
        ) : (
            <div
                className="w-[46%] h-[46%] opacity-80 transition-transform duration-300 group-hover:scale-110"
                style={{ color: contentColor }}
            >
                 <IconComponent className="w-full h-full" />
            </div>
        )}
      </div>

      {!hideLabel && (
        <span
            className={`moro-app-label ${size === 'sm' ? 'text-[8px]' : 'text-[9px]'} label-mono font-bold opacity-60 transition-opacity group-hover:opacity-90 max-w-full truncate block`}
            style={{ color: contentColor }}
        >
          {app.name}
        </span>
      )}
    </button>
  );
}, (prev, next) => {
    // Custom comparison to prevent re-render unless specific props change
    // We don't check 'onClick' deeply assuming it's stable or we want to ignore function ref changes
    return prev.app.id === next.app.id &&
           prev.size === next.size &&
           prev.hideLabel === next.hideLabel &&
           prev.variant === next.variant;
});

export default AppIcon;
