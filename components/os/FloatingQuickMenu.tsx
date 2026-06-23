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
    const drag = useRef<{ startX: number; startY: number; baseX: number; baseY: number; moved: boolean; longTimer: number | null }>({ startX: 0, startY: 0, baseX: 0, baseY: 0, moved: false, longTimer: null });

    const parentRect = () => wrapRef.current?.offsetParent?.getBoundingClientRect() || { width: window.innerWidth, height: window.innerHeight, left: 0, top: 0 } as DOMRect;

    // 初始位置：读存档，否则默认右下角（避开底部 dock 区）
    useLayoutEffect(() => {
        try {
            const raw = localStorage.getItem(POS_KEY);
            if (raw) { setPos(JSON.parse(raw)); return; }
        } catch { /* ignore */ }
        const r = parentRect();
        setPos({ x: r.width - BUBBLE - 14, y: r.height - BUBBLE - 120 });
    }, []);

    const clamp = (p: Pos): Pos => {
        const r = parentRect();
        return { x: Math.max(6, Math.min(r.width - BUBBLE - 6, p.x)), y: Math.max(40, Math.min(r.height - BUBBLE - 6, p.y)) };
    };

    const onPointerDown = (e: React.PointerEvent) => {
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        const d = drag.current;
        d.startX = e.clientX; d.startY = e.clientY; d.baseX = pos?.x ?? 0; d.baseY = pos?.y ?? 0; d.moved = false;
        d.longTimer = window.setTimeout(() => { if (!d.moved) hideSelf(); }, 600);
    };
    const onPointerMove = (e: React.PointerEvent) => {
        const d = drag.current;
        if (!d.startX && !d.startY) return;
        const dx = e.clientX - d.startX, dy = e.clientY - d.startY;
        if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        d.moved = true;
        if (d.longTimer) { clearTimeout(d.longTimer); d.longTimer = null; }
        if (open) setOpen(false);
        setPos(clamp({ x: d.baseX + dx, y: d.baseY + dy }));
    };
    const onPointerUp = (e: React.PointerEvent) => {
        const d = drag.current;
        if (d.longTimer) { clearTimeout(d.longTimer); d.longTimer = null; }
        if (!d.moved) {
            setOpen(o => !o);
        } else if (pos) {
            try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch { /* ignore */ }
        }
        d.startX = 0; d.startY = 0;
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
            className="absolute z-[55] select-none"
            style={{ left: pos.x, top: pos.y, touchAction: 'none' }}
        >
            {/* 菜单 */}
            {open && (
                <div
                    className="absolute flex flex-col gap-2"
                    style={{
                        [openUp ? 'bottom' : 'top']: BUBBLE + 10,
                        [alignRight ? 'right' : 'left']: 0,
                        flexDirection: openUp ? 'column-reverse' : 'column',
                    } as React.CSSProperties}
                >
                    {items.map((it, i) => (
                        <button
                            key={it.key}
                            onClick={it.onClick}
                            className={`flex items-center gap-2 ${alignRight ? 'flex-row-reverse' : ''} animate-slide-up`}
                            style={{ animationDelay: `${i * 28}ms` }}
                        >
                            <span className="w-10 h-10 rounded-full bg-[#2b2933] text-white flex items-center justify-center shadow-lg shadow-black/20 active:scale-90 transition-transform">
                                {it.render()}
                            </span>
                            <span className="px-2 py-0.5 rounded-full bg-black/70 text-white text-[11px] font-bold whitespace-nowrap shadow">{it.label}</span>
                        </button>
                    ))}
                </div>
            )}

            {/* 悬浮球 */}
            <button
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                className="rounded-full flex items-center justify-center shadow-xl shadow-black/30 transition-transform active:scale-95"
                style={{
                    width: BUBBLE, height: BUBBLE,
                    background: open ? 'linear-gradient(135deg,#3a3744,#23212b)' : 'linear-gradient(135deg,#6d6a7a,#2b2933)',
                    color: '#fff',
                }}
                title="快捷菜单（长按收起）"
            >
                {open ? <X size={22} weight="bold" /> : <Lightning size={22} weight="fill" />}
            </button>
        </div>
    );
};

export default FloatingQuickMenu;
