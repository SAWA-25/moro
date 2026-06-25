import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { useOS } from '../../context/OSContext';
import { AppID } from '../../types';
import { INSTALLED_APPS, Icons } from '../../constants';
import { Lightning, X, House, EyeSlash } from '@phosphor-icons/react';

/**
 * 悬浮窗快捷菜单 —— 全局可拖动的悬浮球，点开是一排常用 App 快捷入口。
 *  - 拖动可挪位（位置存 localStorage）；轻点展开/收起菜单；长按收起整个悬浮窗。
 *  - 由 OSTheme.floatingQuickMenu 控制（默认开，拼贴册里可关）。锁屏时不显示（PhoneShell 已过滤）。
 *
 * 自包含：自己读 useOS（openApp / updateTheme / addToast），不需要父组件传参。
 */

const POS_KEY = 'moro_fqm_pos';
const BUBBLE = 48;
const DRAG_THRESHOLD = 6;

// 快捷入口：常用 App + 回桌面 + 收起。App 的名字/图标从 INSTALLED_APPS 取。
const SHORTCUT_APPS: AppID[] = [AppID.GroupChat, AppID.Shop, AppID.Gallery, AppID.Settings];

interface Pos { x: number; y: number; }

const FloatingQuickMenu: React.FC = () => {
    const { openApp, updateTheme, addToast } = useOS();
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState<Pos | null>(null);
    const wrapRef = useRef<HTMLDivElement>(null);
    const posRef = useRef<Pos | null>(null);
    const frameRef = useRef<number | null>(null);
    const drag = useRef<{ active: boolean; startX: number; startY: number; baseX: number; baseY: number; moved: boolean; longTimer: number | null }>({ active: false, startX: 0, startY: 0, baseX: 0, baseY: 0, moved: false, longTimer: null });

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

    // 初始位置：读存档，否则默认右下角（避开底部 dock 区）
    useLayoutEffect(() => {
        let initial: Pos | null = null;
        try {
            const raw = localStorage.getItem(POS_KEY);
            if (raw) initial = clamp(JSON.parse(raw));
        } catch { /* ignore */ }
        if (!initial) {
            const r = parentRect();
            initial = clamp({ x: r.width - BUBBLE - 14, y: r.height - BUBBLE - 120 });
        }
        posRef.current = initial;
        setPos(initial);
        applyVisualPos(initial);
    }, []);

    useEffect(() => {
        return () => {
            if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
        };
    }, []);

    const clamp = (p: Pos): Pos => {
        const r = parentRect();
        const x = Number.isFinite(Number(p.x)) ? Number(p.x) : r.width - BUBBLE - 14;
        const y = Number.isFinite(Number(p.y)) ? Number(p.y) : r.height - BUBBLE - 120;
        return { x: Math.max(6, Math.min(r.width - BUBBLE - 6, x)), y: Math.max(40, Math.min(r.height - BUBBLE - 6, y)) };
    };

    const onPointerDown = (e: React.PointerEvent) => {
        try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
        const d = drag.current;
        const current = posRef.current || pos || { x: 0, y: 0 };
        d.active = true;
        d.startX = e.clientX; d.startY = e.clientY; d.baseX = current.x; d.baseY = current.y; d.moved = false;
        if (wrapRef.current) wrapRef.current.style.transition = 'none';
        d.longTimer = window.setTimeout(() => { if (!d.moved) hideSelf(); }, 600);
    };

    const onPointerMove = (e: React.PointerEvent) => {
        const d = drag.current;
        if (!d.active) return;
        const dx = e.clientX - d.startX, dy = e.clientY - d.startY;
        if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        d.moved = true;
        if (d.longTimer) { clearTimeout(d.longTimer); d.longTimer = null; }
        if (open) setOpen(false);
        setVisualPos(clamp({ x: d.baseX + dx, y: d.baseY + dy }));
    };

    const finishPointer = (e: React.PointerEvent, commitTap = true) => {
        const d = drag.current;
        if (d.longTimer) { clearTimeout(d.longTimer); d.longTimer = null; }
        if (!d.active) return;
        d.active = false;
        if (wrapRef.current) wrapRef.current.style.transition = 'transform 220ms cubic-bezier(0.22,1,0.36,1)';
        try { (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId); } catch { /* ignore */ }
        if (!d.moved && commitTap) {
            setOpen(o => !o);
        } else {
            const settled = posRef.current || pos;
            if (settled) {
                setPos(settled);
                try { localStorage.setItem(POS_KEY, JSON.stringify(settled)); } catch { /* ignore */ }
            }
        }
        d.startX = 0; d.startY = 0; d.moved = false;
    };

    const hideSelf = () => {
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

    const items: { key: string; label: string; render: () => React.ReactNode; onClick: () => void }[] = [
        ...SHORTCUT_APPS.map(id => {
            const app = INSTALLED_APPS.find(a => a.id === id);
            const Ico = (app && Icons[app.icon]) || Icons.Settings;
            return { key: id, label: app?.name || id, render: () => <Ico className="w-5 h-5" />, onClick: () => go(id) };
        }),
        { key: 'home', label: '回桌面', render: () => <House className="w-5 h-5" weight="bold" />, onClick: () => go(AppID.Launcher) },
        { key: 'hide', label: '收起悬浮窗', render: () => <EyeSlash className="w-5 h-5" weight="bold" />, onClick: hideSelf },
    ];

    return (
        <div
            ref={wrapRef}
            className="absolute left-0 top-0 z-[55] select-none will-change-transform transform-gpu"
            style={{
                touchAction: 'none',
                transform: `translate3d(${pos.x}px, ${pos.y}px, 0)`,
                transition: 'transform 220ms cubic-bezier(0.22,1,0.36,1)',
            }}
        >
            {/* 菜单 */}
            {open && (
                <div
                    className="absolute flex flex-col gap-1.5 rounded-[1.35rem] bg-white/88 p-2 shadow-[0_18px_46px_-22px_rgba(24,22,32,0.55)] ring-1 ring-white/70 backdrop-blur-xl"
                    style={{
                        [openUp ? 'bottom' : 'top']: BUBBLE + 12,
                        [alignRight ? 'right' : 'left']: 0,
                        flexDirection: openUp ? 'column-reverse' : 'column',
                    } as React.CSSProperties}
                >
                    {items.map((it, i) => (
                        <button
                            key={it.key}
                            onClick={it.onClick}
                            className={`group flex items-center gap-2 rounded-full p-0.5 ${alignRight ? 'flex-row-reverse' : ''} animate-slide-up`}
                            style={{ animationDelay: `${i * 28}ms` }}
                        >
                            <span className="w-10 h-10 rounded-full bg-[#2b2933] text-white flex items-center justify-center shadow-lg shadow-black/20 transition-transform duration-200 group-active:scale-90 group-hover:scale-105">
                                {it.render()}
                            </span>
                            <span className="px-2.5 py-1 rounded-full bg-[#2b2933]/88 text-white text-[11px] font-bold whitespace-nowrap shadow">{it.label}</span>
                        </button>
                    ))}
                </div>
            )}

            {/* 悬浮球 */}
            <button
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={finishPointer}
                onPointerCancel={(e) => finishPointer(e, false)}
                className="relative rounded-full flex items-center justify-center shadow-xl shadow-black/30 transition-transform duration-200 active:scale-95"
                style={{
                    width: BUBBLE, height: BUBBLE,
                    background: open
                        ? 'linear-gradient(135deg,#3a3744 0%,#23212b 100%)'
                        : 'radial-gradient(circle at 32% 24%, rgba(255,255,255,0.42), transparent 26%), linear-gradient(135deg,#6d6a7a 0%,#2b2933 100%)',
                    color: '#fff',
                    boxShadow: open
                        ? '0 18px 38px -18px rgba(26,24,34,0.72), 0 0 0 1px rgba(255,255,255,0.18)'
                        : '0 18px 38px -18px rgba(26,24,34,0.68), 0 0 0 1px rgba(255,255,255,0.20)',
                }}
                title="快捷菜单（长按收起）"
            >
                <span className="absolute inset-1 rounded-full border border-white/18 pointer-events-none" />
                {open ? <X size={22} weight="bold" /> : <Lightning size={22} weight="fill" />}
            </button>
        </div>
    );
};

export default FloatingQuickMenu;
