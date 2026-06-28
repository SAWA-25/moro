import React, { useEffect, useRef } from 'react';

interface PhoneLockExitUnlockSheetProps {
    open: boolean;
    charName?: string;
    clue?: string;
    value: string;
    error?: string;
    disabledReason?: string;
    busy?: boolean;
    onChange: (value: string) => void;
    onCancel: () => void;
    onSubmit: () => void;
}

const PhoneLockExitUnlockSheet: React.FC<PhoneLockExitUnlockSheetProps> = ({
    open,
    charName,
    clue,
    value,
    error,
    disabledReason,
    busy,
    onChange,
    onCancel,
    onSubmit,
}) => {
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!open) return;
        const timer = window.setTimeout(() => inputRef.current?.focus(), 80);
        return () => window.clearTimeout(timer);
    }, [open]);

    if (!open) return null;

    const displayName = charName || 'TA';
    const submitDisabled = busy || !!disabledReason || !value.trim();

    return (
        <div
            data-phone-lock-exit
            className="fixed inset-0 z-[180] flex items-center justify-center px-6 py-8"
            style={{ background: 'rgba(3,5,8,0.62)', backdropFilter: 'blur(10px)' }}
            onClick={e => {
                e.stopPropagation();
                onCancel();
            }}
            role="dialog"
            aria-modal="true"
            aria-label="Ta 试解锁"
        >
            <form
                className="w-full max-w-[350px] rounded-[28px] px-5 py-5"
                style={{
                    background: 'rgba(35,36,42,0.96)',
                    border: '1px solid rgba(255,255,255,0.15)',
                    boxShadow: '0 24px 80px rgba(0,0,0,0.48), inset 0 1px 0 rgba(255,255,255,0.08)',
                    color: '#f7f7f7',
                }}
                onClick={e => e.stopPropagation()}
                onSubmit={e => {
                    e.preventDefault();
                    if (!submitDisabled) onSubmit();
                }}
            >
                <div className="flex items-start gap-3">
                    <div
                        className="shrink-0 w-10 h-10 rounded-[14px] flex items-center justify-center text-[24px] font-serif"
                        style={{
                            background: 'rgba(214,204,122,0.16)',
                            border: '1px solid rgba(214,204,122,0.28)',
                            color: '#d6cc7a',
                        }}
                    >
                        锁
                    </div>
                    <div className="min-w-0">
                        <div className="text-[11px] font-black tracking-[0.16em] uppercase" style={{ color: '#d6cc7a' }}>专注锁屏</div>
                        <h2 className="mt-1 text-[25px] leading-tight font-black">Ta 试解锁</h2>
                    </div>
                </div>

                <p className="mt-5 text-[15px] leading-[1.7]" style={{ color: 'rgba(247,247,247,0.66)' }}>
                    {displayName} 在试解锁自己的手机。你可代 Ta 输入口令；正确则 Ta 解锁并回到密谈。
                </p>

                <div
                    className="mt-5 rounded-[18px] px-4 py-4"
                    style={{
                        background: 'rgba(214,204,122,0.09)',
                        border: '1px solid rgba(214,204,122,0.24)',
                    }}
                >
                    <div className="text-[12px] font-black tracking-[0.16em]" style={{ color: '#d6cc7a' }}>口令提示</div>
                    <div className="mt-2 text-[20px] leading-snug font-serif font-bold text-white whitespace-pre-wrap">
                        {clue?.trim() || '没有提示，只能凭直觉猜。'}
                    </div>
                </div>

                <label className="mt-5 block">
                    <span className="block text-[12px] font-black tracking-[0.16em] mb-2" style={{ color: 'rgba(247,247,247,0.58)' }}>TA 的口令</span>
                    <input
                        ref={inputRef}
                        value={value}
                        onChange={e => onChange(e.target.value)}
                        placeholder="代 Ta 输入解锁口令"
                        disabled={busy || !!disabledReason}
                        className="w-full rounded-[18px] px-4 py-3.5 text-[16px] outline-none disabled:opacity-45"
                        style={{
                            background: 'rgba(255,255,255,0.035)',
                            border: `1px solid ${error ? 'rgba(248,113,113,0.62)' : 'rgba(214,204,122,0.28)'}`,
                            color: '#fff',
                            caretColor: '#d6cc7a',
                            boxShadow: error ? '0 0 0 3px rgba(248,113,113,0.12)' : '0 0 0 3px rgba(214,204,122,0.08)',
                        }}
                    />
                </label>

                {(error || disabledReason) && (
                    <div className="mt-3 text-[12px] leading-relaxed" style={{ color: error ? '#fca5a5' : 'rgba(247,247,247,0.58)' }}>
                        {error || disabledReason}
                    </div>
                )}

                <div className="mt-5 grid grid-cols-[0.9fr_1.1fr] gap-3">
                    <button
                        type="button"
                        onClick={onCancel}
                        disabled={busy}
                        className="min-h-[46px] rounded-full text-[15px] font-black active:scale-95 disabled:opacity-45"
                        style={{ background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.06)', color: '#fff' }}
                    >
                        再待一会儿
                    </button>
                    <button
                        type="submit"
                        disabled={submitDisabled}
                        className="min-h-[46px] rounded-full text-[15px] font-black active:scale-95 disabled:opacity-40"
                        style={{ background: '#f7f7f7', color: '#202124', boxShadow: '0 16px 34px -26px rgba(255,255,255,0.8)' }}
                    >
                        {busy ? '解锁中...' : 'TA 解锁离开'}
                    </button>
                </div>
            </form>
        </div>
    );
};

export default PhoneLockExitUnlockSheet;
