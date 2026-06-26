import React from 'react';
import { Play, Pause, SkipForward, MusicNote } from '@phosphor-icons/react';
import { useOS } from '../../context/OSContext';
import { useMusic } from '../../context/MusicContext';
import { AppID } from '../../types';

const NowPlayingSquareWidget: React.FC<{ contentColor: string }> = ({ contentColor }) => {
  const { openApp } = useOS();
  const { current, playing, progress, duration, togglePlay, nextSong } = useMusic();
  void contentColor;

  const pct = duration > 0 ? (progress / duration) * 100 : 0;
  const hasSong = !!current;
  const albumPic = current?.albumPic;
  const title = current?.name || 'Music';
  const subtitle = hasSong ? (current?.artists || '') : 'Tap to open';

  const stopProp = (e: React.MouseEvent) => { e.stopPropagation(); };
  const handlePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (hasSong) togglePlay();
    else openApp(AppID.Music);
  };
  const handleNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (hasSong) nextSong();
  };

  return (
    <div
      onClick={() => openApp(AppID.Music)}
      className="moro-music-widget moro-vinyl-widget relative w-full h-full rounded-[2rem] overflow-hidden cursor-pointer animate-fade-in group press-soft text-[#2f302d]"
    >
      <div className="moro-vinyl-sheen pointer-events-none absolute inset-0" />
      {albumPic && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `url(${albumPic})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            filter: 'saturate(0.08) contrast(0.86) brightness(1.12)',
            opacity: 0.08,
          }}
        />
      )}

      <div className="moro-vinyl-body relative z-10 flex h-full items-center gap-4 px-4 py-3.5">
        <div className="moro-vinyl-wrap shrink-0">
          <div
            className="moro-vinyl-disc"
            style={{ animation: playing ? 'moroVinylSpin 16s linear infinite' : 'none' }}
          >
            <div
              className="moro-vinyl-label"
              style={albumPic ? {
                backgroundImage: `linear-gradient(rgba(255,255,255,0.16), rgba(255,255,255,0.16)), url(${albumPic})`,
              } : undefined}
            >
              {!albumPic && <MusicNote size={16} weight="fill" />}
            </div>
            <span className="moro-vinyl-hole" />
          </div>
          <button
            aria-label={playing ? 'Pause' : 'Play'}
            onClick={handlePlay}
            onMouseDown={stopProp}
            className="moro-vinyl-play active:scale-95 transition"
          >
            {playing ? <Pause size={15} weight="fill" /> : <Play size={15} weight="fill" className="translate-x-[1px]" />}
          </button>
        </div>

        <div className="moro-vinyl-info min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="moro-vinyl-chip">Music</span>
            <span className="moro-vinyl-tiny">CosmicPhone</span>
          </div>
          <div className="mt-2 min-w-0">
            <div className="truncate text-[17px] font-black leading-tight">{title}</div>
            <div className="mt-0.5 truncate text-[10px] font-semibold opacity-45">{subtitle}</div>
          </div>
          <div className="moro-waveform mt-3" aria-hidden="true">
            {Array.from({ length: 18 }).map((_, i) => (
              <span key={i} style={{ height: `${8 + ((i * 7) % 18)}px`, opacity: playing ? 0.78 : 0.38 }} />
            ))}
          </div>
          <div className="moro-vinyl-controls mt-3 flex items-center gap-3">
            <div className="moro-vinyl-progress">
              <i style={{ width: `${pct}%` }} />
            </div>
            <button
              aria-label="Next"
              onClick={handleNext}
              onMouseDown={stopProp}
              className="moro-vinyl-next active:scale-90 transition disabled:opacity-25"
              disabled={!hasSong}
            >
              <SkipForward size={13} weight="fill" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NowPlayingSquareWidget;
