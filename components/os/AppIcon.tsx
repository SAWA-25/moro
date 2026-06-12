
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
  const contentColor = theme.contentColor || '#2b2933';
  // 黑白手帐桌面：设置 App 反色成墨色方块（呼应参考图右下角黑色齿轮卡）
  const isInverseTile = app.id === 'settings';

  // Standard sizes
  const sizeClasses =
    size === 'lg' ? 'w-[4.25rem] h-[4.25rem]' :
    size === 'sm' ? 'w-[2.75rem] h-[2.75rem]' :
    'w-[3.5rem] h-[3.5rem]';

  // Dock 变体：白色胶囊上的裸墨色图标（黑白手帐 — 无圈无底，仅线性图标）
  if (variant === 'dock') {
    return (
      <button
        onClick={onClick}
        onPointerDown={() => preloadApp(app.id)}
        className="flex flex-col items-center group relative press-soft"
        style={{ WebkitTapHighlightColor: 'transparent' }}
      >
        <div className={`moro-dock-icon ${sizeClasses} relative flex items-center justify-center rounded-full transition-transform duration-300 group-hover:scale-110`}>
          {customIconUrl ? (
            <img src={customIconUrl} className="w-full h-full object-cover rounded-full" alt={app.name} loading="lazy" />
          ) : (
            <div className="w-[52%] h-[52%]" style={{ color: contentColor }}>
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
      {/* 手帐贴纸瓦片：纯白圆角卡 + 米灰细边 + 柔影；设置 App 反色为墨块（blur 不放在图标上 — 8+ 个图标会卡启动器） */}
      <div className={`moro-app-tile ${sizeClasses} relative flex items-center justify-center rounded-[1.35rem]
        transition-colors duration-300
        ${isInverseTile && !customIconUrl
            ? 'bg-[#1c1b22] border border-[#1c1b22] shadow-[0_12px_26px_-12px_rgba(28,27,34,0.6)]'
            : 'bg-white border border-[#efece5] shadow-[0_12px_26px_-14px_rgba(50,48,60,0.3)] group-hover:border-[#e4e1d8]'}
      `}>

        {customIconUrl ? (
            <img src={customIconUrl} className="w-full h-full object-cover rounded-[1.35rem]" alt={app.name} loading="lazy" />
        ) : (
            <div
                className="w-[46%] h-[46%] transition-transform duration-300 group-hover:scale-110"
                style={{ color: isInverseTile ? '#ffffff' : contentColor }}
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
