import React from 'react';
import { Buildings, Compass, MapPin, NavigationArrow } from '@phosphor-icons/react';
import { ChatLocationMapKind, resolveChatLocationMap } from '../../utils/chatLocationMap';

const INK = '#5a3140';
const INK_SOFT = '#a892a3';
const EDGE = '#eed6df';

const KIND_TONE: Record<ChatLocationMapKind, { bg: string; fg: string; border: string }> = {
  building: { bg: 'rgba(255,255,255,0.92)', fg: '#5a3140', border: 'rgba(238,214,223,0.9)' },
  shop: { bg: 'rgba(255,244,247,0.92)', fg: '#8b5268', border: 'rgba(216,165,183,0.55)' },
  park: { bg: 'rgba(236,253,245,0.88)', fg: '#487364', border: 'rgba(148,191,174,0.5)' },
  transport: { bg: 'rgba(239,246,255,0.9)', fg: '#526a91', border: 'rgba(147,177,215,0.52)' },
};

const mapBg: React.CSSProperties = {
  backgroundColor: '#fbfaf7',
  backgroundImage: [
    'radial-gradient(circle, rgba(90,49,64,0.18) 1px, transparent 1.4px)',
    'linear-gradient(26deg, transparent 0 34%, rgba(221,225,216,0.58) 34% 38%, transparent 38% 100%)',
    'linear-gradient(116deg, transparent 0 42%, rgba(224,231,235,0.58) 42% 46%, transparent 46% 100%)',
    'linear-gradient(180deg, rgba(255,255,255,0.88), rgba(246,248,245,0.86))',
  ].join(','),
  backgroundSize: '22px 22px, 100% 100%, 100% 100%, 100% 100%',
};

const clampLabel = (value: string, fallback: string) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text || fallback;
};

const LandmarkIcon: React.FC<{ kind: ChatLocationMapKind; size?: number }> = ({ kind, size = 13 }) => {
  if (kind === 'transport') return <NavigationArrow size={size} weight="fill" />;
  if (kind === 'park') return <Compass size={size} weight="bold" />;
  return <Buildings size={size} weight="bold" />;
};

export const LocationMapCard: React.FC<{
  name: string;
  address?: string;
  locationMap?: any;
  variant?: 'message' | 'preview';
  className?: string;
}> = ({ name, address, locationMap, variant = 'message', className = '' }) => {
  const title = clampLabel(name, '落脚点');
  const detail = clampLabel(address || '', '');
  const map = resolveChatLocationMap(title, detail, locationMap);
  const preview = variant === 'preview';
  const labelBelow = map.anchor.y < 38;
  const mapHeight = preview ? 238 : 132;

  return (
    <div
      className={`${preview ? 'w-full' : 'w-[17.5rem] max-w-[calc(100vw-5.5rem)]'} overflow-hidden ${className}`}
      style={{
        borderRadius: preview ? 24 : 18,
        background: 'linear-gradient(180deg,#ffffff 0%,#fffdfa 100%)',
        border: `1px solid ${EDGE}`,
        boxShadow: preview ? '0 18px 36px -26px rgba(122,90,114,0.45)' : '0 14px 26px -20px rgba(122,90,114,0.42)',
        color: INK,
      }}
    >
      <div className="relative overflow-hidden" style={{ height: mapHeight, ...mapBg }}>
        <div aria-hidden className="absolute rounded-[24px]" style={{ left: '5%', top: '9%', width: '30%', height: '22%', background: 'rgba(202,228,214,0.34)', filter: 'blur(0.2px)' }} />
        <div aria-hidden className="absolute rounded-[28px]" style={{ right: '7%', bottom: '10%', width: '28%', height: '22%', background: 'rgba(209,230,241,0.38)', filter: 'blur(0.2px)' }} />
        <div aria-hidden className="absolute rounded-[18px]" style={{ left: '41%', bottom: '8%', width: '16%', height: '15%', background: 'rgba(217,226,207,0.35)' }} />

        <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          <line
            x1={map.user.x}
            y1={map.user.y}
            x2={map.anchor.x}
            y2={map.anchor.y}
            stroke="rgba(90,49,64,0.38)"
            strokeWidth={preview ? 0.75 : 0.95}
            strokeDasharray="3 3"
            strokeLinecap="round"
          />
        </svg>

        {map.landmarks.slice(0, preview ? 4 : 3).map((landmark, index) => {
          const tone = KIND_TONE[landmark.kind];
          return (
            <div
              key={landmark.id || index}
              className="absolute flex items-center gap-1.5 px-2 py-1 rounded-[13px] max-w-[122px]"
              style={{
                left: `${landmark.x}%`,
                top: `${landmark.y}%`,
                transform: 'translate(-50%, -50%)',
                background: tone.bg,
                color: tone.fg,
                border: `1px solid ${tone.border}`,
                boxShadow: '0 8px 18px -16px rgba(90,49,64,0.55)',
              }}
            >
              <span className="shrink-0 leading-none"><LandmarkIcon kind={landmark.kind} /></span>
              <span className="min-w-0 truncate text-[10px] font-bold leading-none">{landmark.label}</span>
            </div>
          );
        })}

        <div
          className="absolute flex flex-col items-center"
          style={{ left: `${map.user.x}%`, top: `${map.user.y}%`, transform: 'translate(-50%, -50%)' }}
        >
          <span className="absolute -inset-2 rounded-full animate-ping" style={{ background: 'rgba(216,165,183,0.15)' }} />
          <span
            className="relative h-9 w-9 rounded-full flex items-center justify-center text-[14px] font-black"
            style={{ background: '#ffffff', color: '#8791c7', border: `1px solid ${EDGE}`, boxShadow: '0 8px 18px -13px rgba(90,49,64,0.5)' }}
          >
            我
          </span>
        </div>

        <div
          className="absolute flex flex-col items-center"
          style={{ left: `${map.anchor.x}%`, top: `${map.anchor.y}%`, transform: 'translate(-50%, -100%)' }}
        >
          <MapPin size={preview ? 34 : 29} weight="fill" color="#d96f91" style={{ filter: 'drop-shadow(0 4px 6px rgba(90,49,64,0.25))' }} />
        </div>

        <div
          className="absolute px-3 py-2 rounded-[18px] min-w-0 max-w-[72%]"
          style={{
            left: `${map.anchor.x}%`,
            top: labelBelow ? `calc(${map.anchor.y}% + 14px)` : `calc(${map.anchor.y}% - 20px)`,
            transform: labelBelow ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
            background: 'rgba(255,255,255,0.94)',
            border: `1px solid ${EDGE}`,
            boxShadow: '0 14px 28px -20px rgba(90,49,64,0.55)',
          }}
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <MapPin size={preview ? 15 : 13} weight="bold" color="#9a6f80" className="shrink-0" />
            <div className="truncate text-[12px] font-black" style={{ color: INK }}>{title}</div>
          </div>
          {detail && preview && (
            <div className="mt-1 truncate text-[10px] font-bold" style={{ color: INK_SOFT }}>{detail}</div>
          )}
        </div>

        <div
          className="absolute px-2 py-1 rounded-full text-[11px] font-black"
          style={{
            left: `${(map.user.x + map.anchor.x) / 2}%`,
            top: `${(map.user.y + map.anchor.y) / 2}%`,
            transform: 'translate(-50%, -50%)',
            background: 'rgba(255,255,255,0.88)',
            color: INK,
            boxShadow: '0 7px 16px -13px rgba(90,49,64,0.48)',
          }}
        >
          {map.distanceKm.toFixed(1)}km
        </div>
      </div>

      <div className={preview ? 'px-4 py-3' : 'px-3.5 py-3'}>
        <div className="flex items-start gap-2">
          <span className="mt-0.5 h-7 w-7 rounded-full flex items-center justify-center shrink-0" style={{ background: '#fff4f7', color: '#8b5268', border: `1px solid ${EDGE}` }}>
            <MapPin size={15} weight="fill" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-black" style={{ color: INK }}>{title}</div>
            {detail && <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug" style={{ color: INK_SOFT }}>{detail}</div>}
            <div className="mt-2 flex items-center gap-1.5 text-[10px] font-bold" style={{ color: '#7aa3b8' }}>
              <NavigationArrow size={12} weight="fill" />
              <span>落脚点 · 本地虚拟小地图</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LocationMapCard;
