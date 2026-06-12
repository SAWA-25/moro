/**
 * 方形「正在播放」组件 — 用于桌面第二页的风车布局
 * — 全局 Music Context 驱动，点击跳到 Music App。
 * — 填满父容器（由父的 aspect-square 约束成方形）。
 * — 黑白手帐桌面风：黑色胶囊卡 + 手写体 Music 标签 + 白色圆形播放钮。
 */
import React from 'react';
import { Play, Pause, SkipForward, MusicNote } from '@phosphor-icons/react';
import { useOS } from '../../context/OSContext';
import { useMusic } from '../../context/MusicContext';
import { AppID } from '../../types';

const NowPlayingSquareWidget: React.FC<{ contentColor: string }> = ({ contentColor }) => {
  const { openApp } = useOS();
  const { current, playing, progress, duration, togglePlay, nextSong } = useMusic();
  void contentColor; // 黑胶囊固定白字，但保留 prop 兼容旧调用

  const pct = duration > 0 ? (progress / duration) * 100 : 0;
  const hasSong = !!current;

  const albumPic = current?.albumPic;
  const title = current?.name || 'Music';
  const subtitle = hasSong ? (current?.artists || '') : 'Tap to ...';

  const stopProp = (e: React.MouseEvent) => { e.stopPropagation(); };
  const handlePlay = (e: React.MouseEvent) => { e.stopPropagation(); if (hasSong) togglePlay(); else openApp(AppID.Music); };
  const handleNext = (e: React.MouseEvent) => { e.stopPropagation(); if (hasSong) nextSong(); };

  return (
    <div
      onClick={() => openApp(AppID.Music)}
      className="relative w-full h-full rounded-[2.4rem] overflow-hidden cursor-pointer animate-fade-in group press-soft flex flex-col items-center justify-between px-4 py-5 text-white"
      style={{
        background: 'linear-gradient(180deg, #232229 0%, #17161c 100%)',
        boxShadow: '0 18px 38px -16px rgba(23,22,28,0.65)',
      }}
    >
      {/* 背景封面：低透明度铺底，保持黑胶囊质感 */}
      {albumPic && (
        <div className="absolute inset-0 opacity-20 pointer-events-none"
          style={{
            backgroundImage: `url(${albumPic})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            transform: 'scale(1.1)',
          }}
        />
      )}

      {/* 顶部：暗色内圈唱片 / 封面 */}
      <div
        className="relative z-10 w-12 h-12 shrink-0 rounded-full overflow-hidden flex items-center justify-center"
        style={{
          background: 'rgba(255,255,255,0.08)',
          border: '1px solid rgba(255,255,255,0.12)',
        }}
      >
        {albumPic ? (
          <img src={albumPic} alt="" className="w-full h-full object-cover rounded-full"
            style={{ animation: playing ? 'spin 14s linear infinite' : 'none' }} />
        ) : (
          <MusicNote size={18} weight="fill" className="opacity-80" />
        )}
      </div>

      {/* 中部：手写体 Music 标签 + 歌名 */}
      <div className="relative z-10 flex flex-col items-center min-w-0 w-full px-1 gap-0.5">
        <div className="font-hand text-[22px] leading-none truncate max-w-full">{hasSong ? 'Music' : title}</div>
        <div className="font-hand text-[13px] opacity-60 truncate max-w-full">{hasSong ? title : subtitle}</div>
        {hasSong && subtitle && (
          <div className="text-[8.5px] opacity-40 truncate max-w-full">{subtitle}</div>
        )}
      </div>

      {/* 底部：白色播放圆钮 + 下一首小箭头 + 细进度条 */}
      <div className="relative z-10 w-full flex flex-col items-center gap-2.5">
        <div className="flex items-center justify-center gap-3 w-full">
          <button
            aria-label={playing ? 'Pause' : 'Play'}
            onClick={handlePlay}
            onMouseDown={stopProp}
            className="w-11 h-11 flex items-center justify-center rounded-full active:scale-95 transition"
            style={{
              background: '#ffffff',
              color: '#17161c',
              boxShadow: '0 8px 20px -8px rgba(0,0,0,0.6)',
            }}
          >
            {playing ? <Pause size={16} weight="fill" /> : <Play size={16} weight="fill" className="translate-x-[1px]" />}
          </button>
          <button
            aria-label="Next"
            onClick={handleNext}
            onMouseDown={stopProp}
            className="w-7 h-7 flex items-center justify-center rounded-full opacity-60 hover:opacity-100 active:scale-90 transition disabled:opacity-25"
            style={{ border: '1px solid rgba(255,255,255,0.25)' }}
            disabled={!hasSong}
          >
            <SkipForward size={12} weight="fill" />
          </button>
        </div>
        <div className="h-[3px] w-3/4 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.14)' }}>
          <div className="h-full rounded-full transition-[width] duration-150"
            style={{ width: `${pct}%`, background: 'rgba(255,255,255,0.85)' }} />
        </div>
      </div>
    </div>
  );
};

export default NowPlayingSquareWidget;
