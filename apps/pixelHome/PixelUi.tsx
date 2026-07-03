import React from 'react';

export const pixelSurface =
  'border-2 border-[#3f3730] bg-[#efe2c5] text-[#302b26] shadow-[4px_4px_0_#3f3730]';

export const pixelInset =
  'border-2 border-[#3f3730] bg-[#5b5148] shadow-[inset_0_0_0_2px_rgba(239,226,197,0.18)]';

export const pixelFont = 'font-mono tracking-normal';

export const PixelShell: React.FC<{
  children: React.ReactNode;
  className?: string;
}> = ({ children, className = '' }) => (
  <div
    className={`h-full w-full overflow-hidden text-[#302b26] ${pixelFont} ${className}`}
    style={{
      backgroundColor: '#38302a',
      backgroundImage:
        'linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)',
      backgroundSize: '16px 16px',
      imageRendering: 'pixelated',
    }}
  >
    {children}
  </div>
);

export const PixelPanel: React.FC<{
  children: React.ReactNode;
  className?: string;
  title?: string;
  right?: React.ReactNode;
}> = ({ children, className = '', title, right }) => (
  <section className={`${pixelSurface} ${className}`}>
    {(title || right) && (
      <div className="flex items-center justify-between gap-3 border-b-2 border-[#3f3730] bg-[#dccaa3] px-3 py-2">
        {title && <h3 className="text-xs font-black uppercase text-[#302b26]">{title}</h3>}
        {right}
      </div>
    )}
    {children}
  </section>
);

export const PixelButton: React.FC<{
  children: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  className?: string;
  type?: 'button' | 'submit';
  title?: string;
}> = ({ children, onClick, active, disabled, className = '', type = 'button', title }) => (
  <button
    type={type}
    title={title}
    disabled={disabled}
    onClick={onClick}
    className={`border-2 border-[#3f3730] px-3 py-2 text-[10px] font-black uppercase transition-transform active:translate-x-[2px] active:translate-y-[2px] disabled:opacity-50 disabled:active:translate-x-0 disabled:active:translate-y-0 ${
      active ? 'bg-[#a86d6d] text-white shadow-[2px_2px_0_#3f3730]' : 'bg-[#dccaa3] text-[#302b26] shadow-[3px_3px_0_#3f3730]'
    } ${className}`}
  >
    {children}
  </button>
);

export const PixelBadge: React.FC<{
  children: React.ReactNode;
  className?: string;
}> = ({ children, className = '' }) => (
  <span className={`inline-flex items-center border-2 border-[#3f3730] bg-[#b9c7c1] px-2 py-0.5 text-[9px] font-black uppercase text-[#302b26] ${className}`}>
    {children}
  </span>
);

export const PixelInput: React.FC<React.InputHTMLAttributes<HTMLInputElement>> = ({ className = '', ...props }) => (
  <input
    {...props}
    className={`w-full border-2 border-[#3f3730] bg-[#f7efda] px-3 py-2 text-xs font-bold text-[#302b26] outline-none placeholder:text-[#8f8173] focus:bg-white ${className}`}
  />
);

export const PixelTextarea: React.FC<React.TextareaHTMLAttributes<HTMLTextAreaElement>> = ({ className = '', ...props }) => (
  <textarea
    {...props}
    className={`w-full resize-none border-2 border-[#3f3730] bg-[#f7efda] px-3 py-2 text-xs font-bold leading-relaxed text-[#302b26] outline-none placeholder:text-[#8f8173] focus:bg-white ${className}`}
  />
);
