import React, { useEffect, useMemo, useState } from 'react';
import type { DesktopPetRoleManifest } from '../../utils/desktopPet';
import { sortFrameNames } from '../../utils/desktopPet';

interface Props {
  role?: DesktopPetRoleManifest;
  actionId: string;
  className?: string;
  scale?: number;
  onLoop?: () => void;
}

const emptyFrames: string[] = [];

const DesktopPetSprite: React.FC<Props> = ({ role, actionId, className = '', scale = 1, onLoop }) => {
  const action = role?.actions[actionId] || (role ? role.actions[role.defaultAction] : undefined);
  const frames = useMemo(() => sortFrameNames(action?.frames || emptyFrames), [action?.frames]);
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    setFrameIndex(0);
  }, [actionId, role?.id]);

  useEffect(() => {
    if (frames.length <= 1) return undefined;
    const ms = Math.max(35, (action?.frameRefresh || 0.08) * 1000);
    let timer: number | null = null;
    const stop = () => {
      if (timer === null) return;
      window.clearInterval(timer);
      timer = null;
    };
    const tick = () => {
      setFrameIndex(prev => {
        const next = (prev + 1) % frames.length;
        if (next === 0) onLoop?.();
        return next;
      });
    };
    const start = () => {
      if (timer !== null || document.hidden) return;
      timer = window.setInterval(tick, ms);
    };
    const onVisibilityChange = () => {
      if (document.hidden) stop();
      else start();
    };
    start();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [action?.frameRefresh, frames, frames.length, onLoop]);

  const width = Math.max(120, (role?.width || 300) * scale);
  const height = Math.max(128, (role?.height || 320) * scale);
  const src = frames[frameIndex] || frames[0];

  return (
    <div
      className={`relative flex items-end justify-center ${className}`}
      style={{ width, height, minWidth: width, minHeight: height }}
      aria-label={role ? `${role.name} 桌宠` : '桌宠'}
    >
      {src ? (
        <img
          src={src}
          alt=""
          draggable={false}
          decoding="async"
          className="max-w-full max-h-full object-contain select-none pointer-events-none"
          style={{ imageRendering: 'auto' }}
        />
      ) : (
        <div className="w-full h-full rounded-[28px] border-2 border-dashed border-slate-300 bg-white/70 grid place-items-center text-xs font-bold text-slate-400">
          缺少桌宠资源
        </div>
      )}
    </div>
  );
};

export default React.memo(DesktopPetSprite);
