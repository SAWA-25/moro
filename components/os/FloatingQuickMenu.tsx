import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { useOS } from '../../context/OSContext';
import { AppID } from '../../types';
import { INSTALLED_APPS, Icons } from '../../constants';
import { House, EyeSlash } from '@phosphor-icons/react';

/**
 * 悬浮窗快捷菜单 —— 全局可拖动的「萌猫爪」悬浮球，点开是一排常用 App 快捷入口。
 *  - 拖动可挪位（位置存 localStorage）；轻点展开/收起菜单；点开时有猫爪「boop」互动动画。
 *  - 可隐藏至屏幕侧边：长按 / 拖到屏幕边缘 / 菜单「贴边」→ 收成边上的半只猫爪；轻点贴边的猫爪即「回到桌面」。
 *  - 菜单「收起」彻底关闭（OSTheme.floatingQuickMenu=false，拼贴册里可重新打开）。锁屏时不显示（PhoneShell 已过滤）。
 *
 * 自包含：自己读 useOS（openApp / updateTheme / addToast），不需要父组件传参。
 */

const POS_KEY = 'moro_fqm_pos';
const TUCK_KEY = 'moro_fqm_tuck';
const BUBBLE = 54;
// 极简 ins 风配色：雾面白底 + 细描边 + 奶杏粉点缀
const PAW = '#e0a191';          // 奶杏粉猫爪
const INK = '#6f615a';          // 标签文字（暖灰）
const HAIR = 'rgba(120,96,86,0.14)';  // 细描边
const DRAG_THRESHOLD = 6;
const EDGE_TUCK = 18;           // 拖拽落点离边缘多近就贴边
const PEEK = 0.52;              // 贴边时露出多少（其余藏到屏幕外）

// 快捷入口：常用 App。App 的名字/图标从 INSTALLED_APPS 取。
const SHORTCUT_APPS: AppID[] = [AppID.GroupChat, AppID.Shop, AppID.Gallery, AppID.Settings];

type Tuck = 'left' | 'right' | null;
interface Pos { x: number; y: number; }

// 可爱猫爪印（四颗肉垫 + 大脚掌），颜色用 currentColor，由外层决定奶白/粉。
const CatPaw: React.FC<{ className?: string }> = ({ className }) => (
    <svg viewBox="0 0 64 64" className={className} fill="currentColor" aria-hidden="true">
        <ellipse cx="15.5" cy="27.5" rx="5.6" ry="7" />
        <ellipse cx="26" cy="18.5" rx="6" ry="7.7" />
        <ellipse cx="38" cy="18.5" rx="6" ry="7.7" />
        <ellipse cx="48.5" cy="27.5" rx="5.6" ry="7" />
        <path d="M32 31.5c-9.2 0-15.4 6.5-15.4 13.6 0 6.2 5.9 9.9 15.4 9.9s15.4-3.7 15.4-9.9C47.4 38 41.2 31.5 32 31.5Z" />
    </svg>
);

const FloatingQuickMenu: React.FC = () => {
    const { openApp, updateTheme, addToast, theme } = useOS();
    const floatingStyle = theme.floatingQuickMenuStyle || {};
    const pawColor = floatingStyle.pawColor || PAW;
    const textColor = floatingStyle.textColor || INK;
    const borderColor = floatingStyle.borderColor || HAIR;
    const menuBackground = floatingStyle.menuBackground || 'rgba(255,255,255,0.8)';
    const bubbleBackground = floatingStyle.bubbleBackground;
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState<Pos | null>(null);
    const [tuck, setTuck] = useState<Tuck>(null);
    const [boop, setBoop] = useState(0);          // 每次点击 +1，触发猫爪互动动画
    const wrapRef = useRef<HTMLDivElement>(null);
    const posRef = useRef<Pos | null>(null);
    const tuckRef = useRef<Tuck>(null);
    const frameRef = useRef<number | null>(null);
    const boopTimer = useRef<number | null>(null);
    const drag = useRef<{ active: boolean; startX: number; startY: number; baseX: number; baseY: number; moved: boolean; longTimer: number | null }>({ active: false, startX: 0, startY: 0, baseX: 0, baseY: 0, moved: false, longTimer: null });

    useEffect(() => { tuckRef.current = tuck; }, [tuck]);

    const parentRect = () => wrapRef.current?.offsetParent?.getBoundingClientRect() || { width: window.innerWidth, height: window.innerHeight, left: 0, top: 0 } as DOMRect;

    const applyVisualPos = (next: Pos) => {
        const el = wrapRef.current;
        if (!el) return;
        el.style.transform = `translate3d(${next.x}px, ${next.y}px, 0)`;
    };

    const setVisualPos = (next: Pos) => {
        posRef.current = next;
        if (frameRef.current !== null) return;
        frameRef.current = window.requestAnimationFrame(() => {
            frameRef.current = null;
            if (posRef.current) applyVisualPos(posRef.current);
        });
    };

    const clamp = (p: Pos): Pos => {
        const r = parentRect();
        const x = Number.isFinite(Number(p.x)) ? Number(p.x) : r.width - BUBBLE - 14;
        const y = Number.isFinite(Number(p.y)) ? Number(p.y) : r.height - BUBBLE - 120;
        return { x: Math.max(6, Math.min(r.width - BUBBLE - 6, x)), y: Math.max(40, Math.min(r.height - BUBBLE - 6, y)) };
    };

    // 贴边时的视觉落点（大半藏到屏幕外，只露 PEEK）
    const tuckedPos = (side: 'left' | 'right', y: number): Pos => {
        const r = parentRect();
        const yy = Math.max(40, Math.min(r.height - BUBBLE - 6, y));
        return side === 'left'
            ? { x: -Math.round(BUBBLE * (1 - PEEK)), y: yy }
            : { x: r.width - Math.round(BUBBLE * PEEK), y: yy };
    };

    // 落点离哪条边够近 → 该贴哪边（贴边后不再显示菜单）
    const edgeSide = (p: Pos): Tuck => {
        const r = parentRect();
        if (p.x <= EDGE_TUCK) return 'left';
        if (p.x >= r.width - BUBBLE - EDGE_TUCK) return 'right';
        return null;
    };

    // 初始位置：读存档（含贴边状态），否则默认右下角（避开底部 dock 区）
    useLayoutEffect(() => {
        let storedTuck: Tuck = null;
        try { const t = localStorage.getItem(TUCK_KEY); if (t === 'left' || t === 'right') storedTuck = t; } catch { /* ignore */ }
        let base: Pos | null = null;
        try { const raw = localStorage.getItem(POS_KEY); if (raw) base = clamp(JSON.parse(raw)); } catch { /* ignore */ }
        if (!base) { const r = parentRect(); base = clamp({ x: r.width - BUBBLE - 14, y: r.height - BUBBLE - 120 }); }
        const initial = storedTuck ? tuckedPos(storedTuck, base.y) : base;
        tuckRef.current = storedTuck;
        setTuck(storedTuck);
        posRef.current = initial;
        setPos(initial);
        applyVisualPos(initial);
    }, []);

    useEffect(() => () => {
        if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
        if (boopTimer.current !== null) window.clearTimeout(boopTimer.current);
    }, []);

    const persistPos = (p: Pos) => { try { localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch { /* ignore */ } };
    const persistTuck = (t: Tuck) => { try { t ? localStorage.setItem(TUCK_KEY, t) : localStorage.removeItem(TUCK_KEY); } catch { /* ignore */ } };

    const triggerBoop = () => {
        setBoop(b => b + 1);
        try { (navigator as any).vibrate?.(6); } catch { /* ignore */ }
        if (boopTimer.current !== null) window.clearTimeout(boopTimer.current);
        boopTimer.current = window.setTimeout(() => { boopTimer.current = null; }, 720);
    };

    // 贴边收起到某一侧（长按 / 拖到边 / 菜单「贴边」都走这）
    const tuckTo = (side: 'left' | 'right') => {
        const cur = posRef.current || pos || { x: 0, y: 0 };
        const next = tuckedPos(side, cur.y);
        if (wrapRef.current) wrapRef.current.style.transition = 'transform 280ms cubic-bezier(0.22,1,0.36,1)';
        setOpen(false);
        tuckRef.current = side;
        setTuck(side);
        persistTuck(side);
        posRef.current = next;
        setPos(next);
        applyVisualPos(next);
        try { (navigator as any).vibrate?.(8); } catch { /* ignore */ }
    };

    const tuckNearest = () => {
        const cur = posRef.current || pos;
        if (!cur) return;
        const r = parentRect();
        tuckTo(cur.x + BUBBLE / 2 < r.width / 2 ? 'left' : 'right');
        addToast('猫咪去屏幕边上躲着啦，轻点它就回来 🐾', 'success');
    };

    // 回到桌面：把贴边的猫爪拎回屏内
    const restoreToDesktop = () => {
        const side = tuckRef.current;
        const cur = posRef.current || pos || { x: 0, y: 0 };
        const r = parentRect();
        const next = clamp({ x: side === 'right' ? r.width - BUBBLE - 16 : 16, y: cur.y });
        if (wrapRef.current) wrapRef.current.style.transition = 'transform 300ms cubic-bezier(0.34,1.56,0.64,1)';
        tuckRef.current = null;
        setTuck(null);
        persistTuck(null);
        posRef.current = next;
        setPos(next);
        applyVisualPos(next);
        persistPos(next);
        triggerBoop();
    };

    const onPointerDown = (e: React.PointerEvent) => {
        try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
        const d = drag.current;
        const current = posRef.current || pos || { x: 0, y: 0 };
        d.active = true;
        d.startX = e.clientX; d.startY = e.clientY; d.baseX = current.x; d.baseY = current.y; d.moved = false;
        if (wrapRef.current) wrapRef.current.style.transition = 'none';
        // 长按贴边（已贴边时长按无意义）
        d.longTimer = window.setTimeout(() => { if (!d.moved && !tuckRef.current) tuckNearest(); }, 600);
    };

    const onPointerMove = (e: React.PointerEvent) => {
        const d = drag.current;
        if (!d.active) return;
        const dx = e.clientX - d.startX, dy = e.clientY - d.startY;
        if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        d.moved = true;
        if (d.longTimer) { clearTimeout(d.longTimer); d.longTimer = null; }
        if (open) setOpen(false);
        // 拖动贴边的猫爪 → 先脱离贴边，跟随手指
        if (tuckRef.current) { tuckRef.current = null; setTuck(null); }
        setVisualPos(clamp({ x: d.baseX + dx, y: d.baseY + dy }));
    };

    const finishPointer = (e: React.PointerEvent, commitTap = true) => {
        const d = drag.current;
        if (d.longTimer) { clearTimeout(d.longTimer); d.longTimer = null; }
        if (!d.active) return;
        d.active = false;
        if (wrapRef.current) wrapRef.current.style.transition = 'transform 240ms cubic-bezier(0.34,1.56,0.64,1)';
        try { (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId); } catch { /* ignore */ }
        if (!d.moved && commitTap) {
            if (tuckRef.current) { restoreToDesktop(); }    // 轻点贴边猫爪 → 回桌面
            else { triggerBoop(); setOpen(o => !o); }
        } else if (d.moved) {
            const settled = posRef.current || pos;
            if (settled) {
                const side = edgeSide(settled);
                if (side) { tuckTo(side); }                 // 拖到边缘 → 贴边
                else {
                    persistTuck(null);
                    setPos(settled);
                    persistPos(settled);
                }
            }
        }
        d.startX = 0; d.startY = 0; d.moved = false;
    };

    const disableSelf = () => {
        setOpen(false);
        updateTheme({ floatingQuickMenu: false });
        addToast('悬浮窗已收起，可在「拼贴册」重新打开', 'success');
    };

    const go = (id: AppID) => { setOpen(false); openApp(id); };

    // 点击外部收起菜单
    useEffect(() => {
        if (!open) return;
        const onDoc = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
        document.addEventListener('mousedown', onDoc);
        return () => document.removeEventListener('mousedown', onDoc);
    }, [open]);

    if (!pos) return null;

    const r = parentRect();
    const openUp = pos.y > r.height / 2;          // 在下半屏则向上展开
    const alignRight = pos.x > r.width / 2;        // 在右半屏则菜单右对齐
    const isTucked = !!tuck;

    const items: { key: string; label: string; render: () => React.ReactNode; onClick: () => void }[] = [
        ...SHORTCUT_APPS.map(id => {
            const app = INSTALLED_APPS.find(a => a.id === id);
            const Ico = (app && Icons[app.icon]) || Icons.Settings;
            return { key: id, label: app?.name || id, render: () => <Ico className="w-5 h-5" />, onClick: () => go(id) };
        }),
        { key: 'home', label: '回桌面', render: () => <House className="w-5 h-5" weight="bold" />, onClick: () => go(AppID.Launcher) },
        {
            key: 'tuck', label: '贴边收起',
            render: () => (
                <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
                    <path d={alignRight ? 'M14 6l-6 6 6 6' : 'M10 6l6 6-6 6'} />
                    <path d={alignRight ? 'M19 5v14' : 'M5 5v14'} />
                </svg>
            ),
            onClick: () => { const side = alignRight ? 'right' : 'left'; tuckTo(side); },
        },
        { key: 'hide', label: '收起悬浮窗', render: () => <EyeSlash className="w-5 h-5" weight="bold" />, onClick: disableSelf },
    ];

    return (
        <div
            ref={wrapRef}
            className="moro-floating-quick-menu absolute left-0 top-0 z-[55] select-none will-change-transform transform-gpu"
            style={{
                touchAction: 'none',
                transform: `translate3d(${pos.x}px, ${pos.y}px, 0)`,
                transition: 'transform 240ms cubic-bezier(0.22,1,0.36,1)',
            }}
        >
            {/* 猫爪悬浮窗局部样式与动画 */}
            <style>{`
                @keyframes fqmBreathe { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-1.6px); } }
                @keyframes fqmBoop { 0% { transform: scale(1,1); } 28% { transform: scale(1.14,0.86); } 56% { transform: scale(0.94,1.06); } 100% { transform: scale(1,1); } }
                @keyframes fqmRipple { 0% { transform: scale(0.4); opacity: 0.5; } 100% { transform: scale(2.5); opacity: 0; } }
                @keyframes fqmHeart { 0% { transform: translate(-50%,0) scale(0.3); opacity: 0; } 25% { opacity: 1; } 100% { transform: translate(-50%,-42px) scale(1); opacity: 0; } }
                .fqm-paw-idle { animation: fqmBreathe 3.6s ease-in-out infinite; }
                .fqm-paw-boop { animation: fqmBoop 0.42s cubic-bezier(0.34,1.56,0.64,1); }
            `}</style>
            {floatingStyle.customCss && <style>{floatingStyle.customCss}</style>}

            {/* 菜单（贴边时不显示） */}
            {open && !isTucked && (
                <div
                    className="moro-floating-quick-menu-panel absolute flex flex-col gap-2 rounded-[1.5rem] p-2.5 shadow-[0_18px_44px_-22px_rgba(120,92,82,0.42)] backdrop-blur-xl"
                    style={{
                        [openUp ? 'bottom' : 'top']: BUBBLE + 12,
                        [alignRight ? 'right' : 'left']: 0,
                        flexDirection: openUp ? 'column-reverse' : 'column',
                        background: menuBackground,
                        border: `1px solid ${borderColor}`,
                    } as React.CSSProperties}
                >
                    {items.map((it, i) => (
                        <button
                            key={it.key}
                            onClick={it.onClick}
                            className={`group flex items-center gap-2.5 rounded-full p-0.5 ${alignRight ? 'flex-row-reverse' : ''} animate-slide-up`}
                            style={{ animationDelay: `${i * 30}ms` }}
                        >
                            <span
                                className="w-10 h-10 rounded-full bg-white flex items-center justify-center shadow-[0_6px_16px_-10px_rgba(120,92,82,0.5)] transition-transform duration-200 group-active:scale-90 group-hover:scale-105"
                                style={{ color: pawColor, border: `1px solid ${borderColor}` }}
                            >
                                {it.render()}
                            </span>
                            <span
                                className="px-2.5 py-1 rounded-full bg-white/90 text-[11px] font-semibold whitespace-nowrap shadow-sm"
                                style={{ color: textColor, border: `1px solid ${borderColor}` }}
                            >{it.label}</span>
                        </button>
                    ))}
                </div>
            )}

            {/* 互动迸发：水波 + 小心心（每次 boop 重挂以重放动画） */}
            {boop > 0 && !isTucked && (
                <div key={boop} className="absolute inset-0 pointer-events-none" style={{ width: BUBBLE, height: BUBBLE }}>
                    <span className="absolute inset-0 rounded-full" style={{ border: `1.5px solid ${pawColor}`, animation: 'fqmRipple 0.62s ease-out forwards' }} />
                    {[-1, 0, 1].map((dx, k) => (
                        <span
                            key={k}
                            className="absolute"
                            style={{ color: pawColor, left: `calc(50% + ${dx * 13}px)`, top: 4, fontSize: 12 + k, animation: `fqmHeart ${0.72 + k * 0.08}s ease-out ${k * 0.05}s forwards` }}
                        >♥</span>
                    ))}
                </div>
            )}

            {/* 猫爪悬浮球 */}
            <button
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={finishPointer}
                onPointerCancel={(e) => finishPointer(e, false)}
                className="moro-floating-quick-menu-button relative rounded-full flex items-center justify-center active:scale-95 transition-transform duration-150"
                style={{
                    width: BUBBLE, height: BUBBLE,
                    background: bubbleBackground || (open
                        ? 'linear-gradient(160deg, rgba(255,255,255,0.96), rgba(249,237,233,0.92))'
                        : 'rgba(255,255,255,0.86)'),
                    backdropFilter: 'blur(10px)',
                    WebkitBackdropFilter: 'blur(10px)',
                    border: `1px solid ${borderColor}`,
                    ...(typeof floatingStyle.radius === 'number' ? { borderRadius: `${floatingStyle.radius}px` } : {}),
                    boxShadow: '0 12px 28px -16px rgba(150,112,100,0.45), inset 0 1px 0 rgba(255,255,255,0.85)',
                    opacity: isTucked ? 0.9 : 1,
                }}
                title="猫爪快捷菜单（轻点展开 · 长按贴边）"
            >
                {/* 猫爪印：固定尺寸、居中正立（不再随呼吸动画歪斜） */}
                <span className={`flex items-center justify-center ${boop > 0 ? 'fqm-paw-boop' : 'fqm-paw-idle'}`} style={{ color: pawColor }}>
                    <CatPaw className="block w-[26px] h-[26px]" />
                </span>
                {/* 贴边时的小提手 */}
                {isTucked && (
                    <span
                        className="absolute top-1/2 -translate-y-1/2 w-1 h-5 rounded-full"
                        style={{ [tuck === 'left' ? 'right' : 'left']: 5, background: borderColor } as React.CSSProperties}
                    />
                )}
            </button>
        </div>
    );
};

export default FloatingQuickMenu;
