import React, { useEffect, useMemo, useRef, useState } from 'react';

// 角色「登场」过场 —— 全新「拍立得显影登场」（Ins + 拍立得 主题）。
// 设计：以即将见到的人的头像虚化铺底（ta 的色彩世界 + 极缓 ken-burns），其上一张**拍立得**
//   像刚从相机摇出来一样旋转着甩入、从泛白「显影」到彩色，白框下沿浮起手写的名字，
//   几点 ✦ 火花蹦出收束仪式，停一拍看清脸与名字，再把整张拍立得「托起穿过」揭开聊天界面。
//   亮调暖底（区别于旧版暗调电影感），更有新意、更贴整体拍立得语言。
//
// 性能（修「数据多时卡顿」）：全程只动 transform / opacity（走合成器线程，主线程挂载大量带图
//   消息时也不掉帧）。**显影不动 filter:blur** —— 用一层白罩淡出模拟「泛白→显影」，只动 opacity；
//   底图 blur 是静态的、只栅格化一次，其上 ken-burns 只动 transform。可轻触跳过；尊重 reduced-motion。

interface Props {
  name: string;
  avatar?: string;
  onDone: () => void;
}

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  !!window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const CharacterEntryTransition: React.FC<Props> = ({ name, avatar, onDone }) => {
  const reduced = useMemo(prefersReducedMotion, []);
  // 拍立得甩入 ~640ms、显影 ~1000ms、名字 ~520ms → 停到 REVEAL_AT 看清，再托起退场。
  const REVEAL_AT = reduced ? 220 : 1040;
  const EXIT = reduced ? 180 : 420;
  const TOTAL = REVEAL_AT + EXIT;

  const [exiting, setExiting] = useState(false);
  const doneRef = useRef(false);
  const finish = () => { if (!doneRef.current) { doneRef.current = true; onDone(); } };

  useEffect(() => {
    const tExit = setTimeout(() => setExiting(true), REVEAL_AT);
    const tDone = setTimeout(finish, TOTAL);
    return () => { clearTimeout(tExit); clearTimeout(tDone); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const skip = () => { if (!exiting) { setExiting(true); window.setTimeout(finish, EXIT); } };

  const avatarBg = avatar ? `url(${avatar})` : '';

  return (
    <div
      onClick={skip}
      aria-hidden
      className="absolute inset-0 z-[140] overflow-hidden flex items-center justify-center cursor-pointer"
      style={{ opacity: exiting ? 0 : 1, transition: `opacity ${EXIT}ms ease-in`, willChange: 'opacity' }}
    >
      <style>{`
        @keyframes ceVeilIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes ceKenBurns { from { transform: scale(1.16) translateY(0) } to { transform: scale(1.26) translateY(-2%) } }
        /* 拍立得甩入：从下方旋转着甩上来落定（轻微 overshoot） */
        @keyframes cePolaroidDeal {
          0%   { opacity: 0; transform: translateY(70px) rotate(-13deg) scale(0.7) }
          58%  { opacity: 1; transform: translateY(-8px) rotate(3deg) scale(1.05) }
          100% { opacity: 1; transform: translateY(0) rotate(0deg) scale(1) }
        }
        /* 显影：白罩从不透明淡出（只动 opacity，模拟泛白→显影） */
        @keyframes ceDevelop { 0% { opacity: 0.92 } 45% { opacity: 0.7 } 100% { opacity: 0 } }
        @keyframes ceNameIn { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: translateY(0) } }
        @keyframes ceCapIn { from { opacity: 0 } to { opacity: 0.8 } }
        @keyframes ceSpark { 0% { opacity: 0; transform: scale(0) rotate(-30deg) } 65% { opacity: 1; transform: scale(1.25) rotate(10deg) } 100% { opacity: 1; transform: scale(1) rotate(0) } }
      `}</style>

      {/* 氛围底：虚化头像 = ta 的色彩世界（静态 blur，ken-burns 只动 transform）。立刻铺满盖住聊天。 */}
      {avatarBg ? (
        <div className="absolute inset-0 bg-cover bg-center" style={{
          background: avatarBg, backgroundSize: 'cover', backgroundPosition: 'center',
          filter: 'blur(30px)', transform: 'scale(1.16)',
          animation: reduced ? undefined : 'ceKenBurns 5.5s ease-out both', willChange: 'transform',
        }} />
      ) : (
        <div className="absolute inset-0" style={{ background: 'radial-gradient(120% 100% at 50% 38%, hsla(var(--primary-hue),60%,72%,0.95), #efe7df 72%)' }} />
      )}
      {/* 暖调亮罩：让拍立得在明亮温暖的底上浮出（区别旧暗调；静态） */}
      <div className="absolute inset-0" style={{ background: 'radial-gradient(120% 100% at 50% 40%, rgba(252,250,246,0.62) 0%, rgba(250,246,240,0.8) 55%, rgba(244,238,230,0.9) 100%)' }} />

      {/* 中心：退场时整张拍立得托起穿过（无 filter，缩放廉价） */}
      <div
        className="relative flex flex-col items-center"
        style={{
          transform: exiting ? 'translateY(-18px) scale(1.18) rotate(-2deg)' : 'translateY(0) scale(1) rotate(0)',
          transition: `transform ${EXIT}ms cubic-bezier(0.4,0,0.2,1)`,
          willChange: 'transform',
        }}
      >
        {/* 拍立得相框 */}
        <div
          className="relative"
          style={{
            background: '#ffffff', borderRadius: 12, padding: '12px 12px 44px',
            boxShadow: '0 30px 64px -22px rgba(40,36,30,0.5), 0 2px 4px rgba(40,36,30,0.12)',
            animation: reduced ? 'ceVeilIn 280ms ease-out both' : 'cePolaroidDeal 640ms cubic-bezier(0.34,1.56,0.64,1) 60ms both',
            willChange: 'transform, opacity',
          }}
        >
          {/* 照片区（彩色） + 显影白罩 */}
          <div className="relative overflow-hidden" style={{ width: 188, height: 188, borderRadius: 6, background: avatarBg ? '#e9e4dc' : 'hsla(var(--primary-hue),50%,60%,0.6)' }}>
            {avatarBg && <div className="absolute inset-0 bg-cover bg-center" style={{ background: avatarBg, backgroundSize: 'cover', backgroundPosition: 'center' }} />}
            {/* 显影白罩：盖在照片上从不透明淡出 */}
            <div className="absolute inset-0" style={{
              background: 'linear-gradient(135deg, #fffdf9, #f3efe8)',
              animation: reduced ? 'ceDevelop 260ms ease-out both' : 'ceDevelop 1000ms cubic-bezier(0.4,0,0.2,1) 360ms both',
              willChange: 'opacity',
            }} />
          </div>
          {/* 白框下沿手写名字 */}
          <div className="absolute left-0 right-0 bottom-2.5 px-3 text-center">
            <span className="block truncate font-bold" style={{
              fontFamily: 'var(--font-hand)', fontSize: 22, color: '#3a352e',
              animation: reduced ? 'ceNameIn 280ms ease-out both' : 'ceNameIn 520ms cubic-bezier(0.22,1,0.36,1) 720ms both',
            }}>{name}</span>
          </div>

          {/* ✦ 火花贴纸（点睛，蹦出） */}
          {!reduced && (
            <>
              <span aria-hidden className="absolute text-[22px]" style={{ top: -14, right: -8, color: '#fbbf24', animation: 'ceSpark 460ms cubic-bezier(0.34,1.56,0.64,1) 820ms both' }}>✦</span>
              <span aria-hidden className="absolute text-[15px]" style={{ bottom: 40, left: -12, color: '#f472b6', animation: 'ceSpark 460ms cubic-bezier(0.34,1.56,0.64,1) 940ms both' }}>✦</span>
            </>
          )}
        </div>

        {/* 收束小字 */}
        {!reduced && (
          <div className="mt-5 text-[10px] uppercase" style={{
            fontFamily: 'var(--font-label)', letterSpacing: '0.4em', color: '#6b6358',
            animation: 'ceCapIn 520ms ease-out 900ms both',
          }}>
            进入对话
          </div>
        )}
      </div>
    </div>
  );
};

export default CharacterEntryTransition;
