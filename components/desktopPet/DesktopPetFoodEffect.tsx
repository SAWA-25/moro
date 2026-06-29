import React from 'react';

interface DesktopPetFoodEffectProps {
  src?: string;
  name: string;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

const DesktopPetFoodEffect: React.FC<DesktopPetFoodEffectProps> = ({
  src,
  name,
  size = 56,
  className = '',
  style,
}) => {
  if (!src) return null;
  return (
    <>
      <style>
        {`
          @keyframes desktopPetFoodToss {
            0% { opacity: 0; transform: translate3d(84px, 48px, 0) scale(0.72) rotate(-14deg); }
            16% { opacity: 1; }
            52% { opacity: 1; transform: translate3d(18px, -18px, 0) scale(1.08) rotate(8deg); }
            100% { opacity: 0; transform: translate3d(-28px, -78px, 0) scale(0.42) rotate(0deg); }
          }
        `}
      </style>
      <img
        src={src}
        alt={name}
        className={`pointer-events-none select-none object-contain drop-shadow-[0_10px_14px_rgba(15,23,42,0.28)] ${className}`}
        style={{
          width: size,
          height: size,
          animation: 'desktopPetFoodToss 900ms cubic-bezier(0.2, 0.8, 0.2, 1) forwards',
          ...style,
        }}
      />
    </>
  );
};

export default DesktopPetFoodEffect;
