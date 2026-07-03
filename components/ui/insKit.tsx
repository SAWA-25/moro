import React from 'react';
import { CaretLeft, X } from '@phosphor-icons/react';

/**
 * Moro · Ins 风 + 拍立得 设计套件（Insta / Polaroid Kit）
 * ──────────────────────────────────────────────────────────
 * 全局换肤的新基调：告别「黑白拼贴手账」（网点纸纹 / 牛皮胶带 / 虚线缝线 / 去色照片），
 * 转向「照片当主角」的清爽暖白 —— 纯白大圆角卡片 + 极柔投影 + 彩色 IG 故事环 + 拍立得显影。
 *
 * 与 apps/theater/scrapbook.tsx 同位：那是折子戏专属的黑白手账积木，本文件是全系统通用的 ins 积木。
 * 各 App 逐一换肤时从这里取用，保证「结构语言一致、各家用自己的强调色」。
 *
 * 约束：这一层只管「长什么样」。业务逻辑 / 数据 / handler 仍留在各 App，换肤不改功能。
 *
 * 配套全局 CSS 见 index.html「Ins 风 + 拍立得 设计层」：.ins-ring / .animate-develop /
 * .animate-photo-develop / .animate-ins-card / .ins-card / .ins-gradient-text / .ins-canvas。
 */

// ── 基调色：暖白画布 + 暖墨字 ────────────────────────────────
export const CANVAS = '#f7f5f2';     // App 外壳暖白底
export const CANVAS_SOFT = '#fbfaf8';
export const INK = '#2b2933';        // 暖墨主字
export const INK_SOFT = '#8b8996';   // 次级字
export const HAIRLINE = 'rgba(0,0,0,0.06)';

/** IG 日落渐变（故事环 / 点睛强调） */
export const SUNSET = 'linear-gradient(120deg, #feda75, #fa7e1e 30%, #d62976 62%, #962fbf 100%)';

export type AccentName =
  | 'orange' | 'rose' | 'red' | 'violet' | 'indigo' | 'sky' | 'teal'
  | 'slate' | 'amber' | 'lime' | 'emerald' | 'pink' | 'fuchsia' | 'purple'
  | 'green' | 'blue' | 'typepress';

export interface Accent { solid: string; soft: string; ink: string; }

/** 各 App 强调色（取自 constants 里每个 App 的 color）→ 实色 / 浅底 / 浅底上的字色 */
export const ACCENTS: Record<AccentName, Accent> = {
  orange:  { solid: '#f97316', soft: '#fff1e6', ink: '#9a3d05' },
  rose:    { solid: '#f43f5e', soft: '#ffe9ee', ink: '#9f1239' },
  red:     { solid: '#ef4444', soft: '#fee9e9', ink: '#991b1b' },
  violet:  { solid: '#8b5cf6', soft: '#f1ebff', ink: '#5b21b6' },
  indigo:  { solid: '#6366f1', soft: '#ebebfe', ink: '#3730a3' },
  sky:     { solid: '#0ea5e9', soft: '#e6f6fe', ink: '#075985' },
  teal:    { solid: '#14b8a6', soft: '#e2f7f3', ink: '#115e59' },
  slate:   { solid: '#64748b', soft: '#eef1f5', ink: '#334155' },
  amber:   { solid: '#f59e0b', soft: '#fef3e0', ink: '#92400e' },
  lime:    { solid: '#65a30d', soft: '#f1fae0', ink: '#3f6212' },
  emerald: { solid: '#10b981', soft: '#e3f8f0', ink: '#065f46' },
  pink:    { solid: '#ec4899', soft: '#fde8f3', ink: '#9d174d' },
  fuchsia: { solid: '#d946ef', soft: '#fbeafe', ink: '#86198f' },
  purple:  { solid: '#a855f7', soft: '#f5ebfe', ink: '#6b21a8' },
  green:   { solid: '#22c55e', soft: '#e6f9ee', ink: '#166534' },
  blue:    { solid: '#3b82f6', soft: '#e9f1fe', ink: '#1e40af' },
  typepress: { solid: '#4057c8', soft: '#edf1ff', ink: '#293985' },
};

export const accent = (name?: AccentName | string): Accent =>
  (name && (ACCENTS as Record<string, Accent>)[name]) || ACCENTS.rose;

// ── 满屏外壳：暖白画布 + 顶部彩色微光 + 安全区 ────────────────
export const InsShell: React.FC<{
  children: React.ReactNode;
  accent?: AccentName;
  /** 顶部是否染一层强调色微光（默认开） */
  wash?: boolean;
  className?: string;
  style?: React.CSSProperties;
}> = ({ children, accent: ac, wash = true, className = '', style }) => {
  const a = accent(ac);
  return (
    <div
      className={`absolute inset-0 flex min-h-0 flex-col overflow-hidden animate-fade-in ${className}`}
      style={{ color: INK, background: CANVAS, ...style }}
    >
      {wash && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-56"
          style={{ background: `radial-gradient(120% 90% at 50% -28%, ${a.soft}, transparent 70%)` }}
        />
      )}
      {children}
    </div>
  );
};

/** 滚动内容区 */
export const InsScroll: React.FC<{ children: React.ReactNode; className?: string; innerRef?: React.Ref<HTMLDivElement> }> = ({ children, className = '', innerRef }) => (
  <div
    ref={innerRef}
    className={`relative z-10 flex-1 min-h-0 overflow-y-auto overscroll-contain no-scrollbar ${className}`}
    style={{ WebkitOverflowScrolling: 'touch' }}
  >
    {children}
  </div>
);

// ── 软圆图标钮（返回 / 关闭 / 操作）────────────────────────────
export const IconCircle: React.FC<{
  children: React.ReactNode;
  onClick?: () => void;
  size?: number;
  tone?: 'paper' | 'ink' | 'glass';
  className?: string;
  title?: string;
}> = ({ children, onClick, size = 38, tone = 'paper', className = '', title }) => {
  const tones: Record<string, React.CSSProperties> = {
    paper: { background: '#fff', color: INK, boxShadow: '0 4px 14px -6px rgba(38,38,38,0.28)', border: `1px solid ${HAIRLINE}` },
    ink: { background: INK, color: '#fff', boxShadow: '0 8px 18px -8px rgba(38,38,38,0.5)' },
    glass: { background: 'rgba(255,255,255,0.78)', color: INK, backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.6)', boxShadow: '0 6px 16px -8px rgba(0,0,0,0.4)' },
  };
  return (
    <button onClick={onClick} title={title}
      className={`shrink-0 inline-flex items-center justify-center rounded-full press-soft ${className}`}
      style={{ width: size, height: size, ...tones[tone] }}>
      {children}
    </button>
  );
};

// ── 顶栏：软圆返回 + 标题（中文粗体 + 等宽英文小标）+ 右槽 ──────
export const InsHeader: React.FC<{
  title: string;
  en?: string;
  onBack?: () => void;
  right?: React.ReactNode;
  accent?: AccentName;
  /** 标题居中（默认左对齐紧贴返回钮） */
  center?: boolean;
}> = ({ title, en, onBack, right, accent: ac, center = false }) => {
  const a = accent(ac);
  return (
    <div className="relative z-20 shrink-0" style={{ paddingTop: 'var(--safe-top)' }}>
      <div className="flex items-center gap-2.5 px-3.5 pt-2.5 pb-2.5">
        {onBack
          ? <IconCircle onClick={onBack} title="返回"><CaretLeft size={18} weight="bold" /></IconCircle>
          : <span className="w-[38px]" />}
        <div className={`leading-tight min-w-0 ${center ? 'absolute left-1/2 -translate-x-1/2 text-center pointer-events-none' : ''}`}>
          <div className="text-[17px] font-extrabold tracking-tight truncate" style={{ color: INK }}>{title}</div>
          {en && <div className="text-[8px] tracking-[0.34em] uppercase mt-0.5" style={{ fontFamily: 'var(--font-label)', color: a.solid }}>{en}</div>}
        </div>
        <div className="flex-1" />
        {right}
      </div>
    </div>
  );
};

// ── 拍立得相框（照片保留彩色 + 显影动画 + 手写题字）────────────
export const Polaroid: React.FC<{
  src?: string;
  caption?: string;
  /** 右上角小日期戳 */
  date?: string;
  selected?: boolean;
  onClick?: () => void;
  onPointerDown?: (e: React.PointerEvent) => void;
  onPointerUp?: (e: React.PointerEvent) => void;
  onPointerLeave?: (e: React.PointerEvent) => void;
  rotate?: number;
  /** 照片区宽高比，1=方（默认），>1 更宽 */
  ratio?: number;
  accent?: AccentName;
  fallback?: React.ReactNode;
  /** 入场显影动画（默认开） */
  develop?: boolean;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode; // 照片层叠加内容（角标等）
}> = ({ src, caption, date, selected = false, onClick, onPointerDown, onPointerUp, onPointerLeave, rotate = 0, ratio = 1, accent: ac, fallback, develop = true, className = '', style, children }) => {
  const a = accent(ac);
  return (
    <button
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
      className={`relative shrink-0 press-soft ${develop ? 'animate-develop' : ''} ${className}`}
      style={{ ['--pl-rot' as any]: `${rotate}deg`, transform: develop ? undefined : `rotate(${rotate}deg)`, ...style }}
    >
      <div
        className="p-2 pb-7"
        style={{
          background: '#ffffff',
          borderRadius: 10,
          boxShadow: selected
            ? `0 14px 30px -12px ${a.solid}88, 0 0 0 2px ${a.solid}`
            : '0 14px 30px -16px rgba(38,38,38,0.42), 0 1px 2px rgba(38,38,38,0.05)',
        }}
      >
        <div className="relative w-full overflow-hidden" style={{ paddingBottom: `${100 / ratio}%`, borderRadius: 4, background: `linear-gradient(135deg, ${a.soft}, #e9e6e1)` }}>
          {src
            ? <img src={src} alt={caption || ''} className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
            : <div className="absolute inset-0 flex items-center justify-center text-2xl" style={{ color: a.solid }}>{fallback}</div>}
          {children}
          {date && (
            <span className="absolute bottom-1 right-1 text-[8px] px-1.5 py-0.5 rounded-md font-bold tabular-nums"
              style={{ background: 'rgba(255,180,80,0.92)', color: '#5a3000', fontFamily: 'var(--font-label)' }}>{date}</span>
          )}
        </div>
        {caption !== undefined && (
          <div className="absolute left-0 right-0 bottom-1 text-center px-2">
            <span className="text-[13px] font-bold truncate block" style={{ color: '#4a463f', fontFamily: 'var(--font-hand)' }}>{caption}</span>
          </div>
        )}
      </div>
      {selected && (
        <span aria-hidden className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center text-[11px] text-white z-10" style={{ background: a.solid, boxShadow: '0 2px 6px rgba(0,0,0,0.3)' }}>✓</span>
      )}
    </button>
  );
};

// ── IG 故事环头像（彩色旋转环；活跃态用）────────────────────────
export const StoryRing: React.FC<{
  src?: string;
  size?: number;
  active?: boolean;       // true=彩环，false=灰边
  spin?: boolean;         // 是否旋转（成片出现时建议关）
  onClick?: () => void;
  fallback?: React.ReactNode;
  className?: string;
}> = ({ src, size = 56, active = true, spin = false, onClick, fallback, className = '' }) => {
  const inner = (
    <div className="rounded-full overflow-hidden bg-white flex items-center justify-center" style={{ width: size, height: size, border: '2.5px solid #fff' }}>
      {src ? <img src={src} alt="" className="w-full h-full object-cover" loading="lazy" /> : <span className="text-lg" style={{ color: INK_SOFT }}>{fallback}</span>}
    </div>
  );
  if (!active) {
    return (
      <button onClick={onClick} className={`shrink-0 press-soft rounded-full p-[2.5px] ${className}`} style={{ background: '#e6e3dd' }}>{inner}</button>
    );
  }
  return (
    <button onClick={onClick} className={`shrink-0 press-soft ins-ring ${spin ? '' : 'ins-ring-static'} ${className}`}>{inner}</button>
  );
};

// ── 清爽白卡 ──────────────────────────────────────────────────
export const InsCard: React.FC<{
  children: React.ReactNode;
  onClick?: () => void;
  accent?: AccentName;
  /** 左缘强调色细条 */
  edge?: boolean;
  className?: string;
  style?: React.CSSProperties;
}> = ({ children, onClick, accent: ac, edge = false, className = '', style }) => {
  const a = accent(ac);
  return (
    <div
      onClick={onClick}
      className={`relative overflow-hidden ${onClick ? 'press-soft cursor-pointer' : ''} ${className}`}
      style={{
        background: '#ffffff',
        border: `1px solid ${HAIRLINE}`,
        borderRadius: 22,
        boxShadow: '0 1px 2px rgba(38,38,38,0.04), 0 18px 40px -28px rgba(38,38,38,0.30)',
        ...style,
      }}
    >
      {edge && <span aria-hidden className="absolute left-0 top-0 bottom-0 w-1" style={{ background: a.solid }} />}
      {children}
    </div>
  );
};

// ── 按钮（实色 / 浅底 / 幽灵 / 渐变）──────────────────────────
export const InsButton: React.FC<{
  children: React.ReactNode;
  variant?: 'solid' | 'soft' | 'ghost' | 'gradient';
  accent?: AccentName;
  onClick?: () => void;
  disabled?: boolean;
  icon?: React.ReactNode;
  type?: 'button' | 'submit';
  className?: string;
  title?: string;
}> = ({ children, variant = 'solid', accent: ac, onClick, disabled, icon, type = 'button', className = '', title }) => {
  const a = accent(ac);
  const base = 'inline-flex items-center justify-center gap-1.5 font-bold rounded-full press-soft disabled:opacity-45 disabled:active:scale-100';
  const styles: Record<string, React.CSSProperties> = {
    solid: { background: a.solid, color: '#fff', boxShadow: `0 12px 24px -12px ${a.solid}bb` },
    soft: { background: a.soft, color: a.ink },
    ghost: { background: 'transparent', color: a.ink, border: `1.5px solid ${a.solid}40` },
    gradient: { background: SUNSET, color: '#fff', boxShadow: '0 12px 26px -12px rgba(214,41,118,0.55)' },
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={title} className={`${base} ${className}`} style={styles[variant]}>
      {icon}{children}
    </button>
  );
};

// ── 分区小标（强调色圆点 + 中文标题 + 等宽英文）────────────────
export const SectionLabel: React.FC<{ children: React.ReactNode; en?: string; accent?: AccentName; className?: string }> = ({ children, en, accent: ac, className = '' }) => {
  const a = accent(ac);
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: a.solid }} />
      <span className="text-[13px] font-extrabold tracking-tight" style={{ color: INK }}>{children}</span>
      {en && <span className="text-[8px] tracking-[0.3em] uppercase" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>{en}</span>}
    </div>
  );
};

// ── 标签胶囊 ──────────────────────────────────────────────────
export const Chip: React.FC<{ children: React.ReactNode; active?: boolean; accent?: AccentName; onClick?: () => void; className?: string }> = ({ children, active, accent: ac, onClick, className = '' }) => {
  const a = accent(ac);
  return (
    <button onClick={onClick}
      className={`px-3.5 py-1.5 rounded-full text-[12px] font-bold press-soft whitespace-nowrap ${className}`}
      style={active
        ? { background: a.solid, color: '#fff', boxShadow: `0 8px 18px -10px ${a.solid}cc` }
        : { background: '#fff', color: INK_SOFT, border: `1px solid ${HAIRLINE}` }}>
      {children}
    </button>
  );
};

// ── 空状态 ────────────────────────────────────────────────────
export const InsEmpty: React.FC<{ icon?: React.ReactNode; title: string; hint?: string; className?: string }> = ({ icon, title, hint, className = '' }) => (
  <div className={`h-full flex flex-col items-center justify-center gap-3 py-20 px-8 text-center ${className}`}>
    {icon && <div className="opacity-40" style={{ color: INK_SOFT }}>{icon}</div>}
    <div className="text-[15px] font-bold" style={{ color: INK }}>{title}</div>
    {hint && <div className="text-[12px] leading-relaxed" style={{ color: INK_SOFT }}>{hint}</div>}
  </div>
);

// ── 居中弹窗（清爽白卡 + 弹入）────────────────────────────────
export const InsDialog: React.FC<{
  open: boolean;
  onClose?: () => void;
  title?: string;
  en?: string;
  accent?: AccentName;
  children: React.ReactNode;
  actions?: React.ReactNode;
  maxWidth?: number;
}> = ({ open, onClose, title, en, accent: ac, children, actions, maxWidth = 340 }) => {
  if (!open) return null;
  const a = accent(ac);
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-6 animate-fade-in">
      <div className="absolute inset-0" style={{ background: 'rgba(28,26,24,0.42)', backdropFilter: 'blur(4px)' }} onClick={onClose} />
      <div className="relative w-full animate-pop-in" style={{ maxWidth, background: '#fff', borderRadius: 26, boxShadow: '0 40px 80px -28px rgba(20,18,16,0.5)' }}>
        <div className="px-6 pt-7 pb-5">
          {(title || en) && (
            <div className="text-center mb-3">
              {en && <div className="text-[9px] tracking-[0.32em] uppercase mb-1.5" style={{ fontFamily: 'var(--font-label)', color: a.solid }}>{en}</div>}
              {title && <h3 className="text-[19px] font-extrabold" style={{ color: INK }}>{title}</h3>}
            </div>
          )}
          <div className="text-[13.5px] leading-relaxed text-center" style={{ color: '#5a5660' }}>{children}</div>
        </div>
        {actions && <div className="px-6 pb-6 flex gap-2.5">{actions}</div>}
      </div>
    </div>
  );
};

// ── 底部抽屉（从下滑出的白卡）─────────────────────────────────
export const InsSheet: React.FC<{
  open: boolean;
  onClose?: () => void;
  title?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}> = ({ open, onClose, title, right, children }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center animate-fade-in">
      <div className="absolute inset-0" style={{ background: 'rgba(28,26,24,0.42)', backdropFilter: 'blur(4px)' }} onClick={onClose} />
      <div
        className="relative w-full animate-slide-up flex flex-col min-h-0"
        style={{
          maxWidth: 460,
          maxHeight: 'min(88vh, calc(var(--visual-viewport-height, 100vh) - var(--safe-top, 0px) - 12px))',
          background: '#fff',
          borderTopLeftRadius: 28,
          borderTopRightRadius: 28,
          boxShadow: '0 -22px 60px -24px rgba(20,18,16,0.45)',
          paddingBottom: 'max(var(--safe-bottom, 0px), 16px)',
        }}
      >
        <div className="flex justify-center pt-3"><span className="w-10 h-1.5 rounded-full" style={{ background: '#e3e0da' }} /></div>
        {(title || right) && (
          <div className="px-5 pt-3 flex items-center">
            {title && <div className="text-[15px] font-extrabold" style={{ color: INK }}>{title}</div>}
            <div className="ml-auto flex items-center gap-2">
              {right}
              {onClose && <IconCircle size={30} onClick={onClose} title="关闭"><X size={15} weight="bold" /></IconCircle>}
            </div>
          </div>
        )}
        <div className="min-h-0 overflow-y-auto no-scrollbar px-5 pt-3 pb-4" style={{ WebkitOverflowScrolling: 'touch' }}>{children}</div>
      </div>
    </div>
  );
};
