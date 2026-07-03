import React, { useEffect, useRef, useState } from 'react';
import { CaretDown, CaretUp, Lightning, MonitorPlay, Pause, Play, Stop } from '@phosphor-icons/react';
import { useOS } from '../../context/OSContext';
import { useUserScreenWatch } from '../../context/UserScreenWatchContext';

const POS_KEY = 'moro_user_screen_watch_overlay_pos';
const WIDTH = 288;
const HEADER_HEIGHT = 58;

interface Pos { x: number; y: number }

const clamp = (pos: Pos, parent?: DOMRect): Pos => {
  const w = parent?.width || window.innerWidth || 390;
  const h = parent?.height || window.innerHeight || 844;
  return {
    x: Math.max(8, Math.min(w - WIDTH - 8, pos.x)),
    y: Math.max(44, Math.min(h - HEADER_HEIGHT - 8, pos.y)),
  };
};

const UserScreenWatchOverlay: React.FC = () => {
  const { session, pauseSampling, resumeSampling, stopWatch, requestCommentNow, isCommenting } = useUserScreenWatch();
  const { characters } = useOS();
  const [collapsed, setCollapsed] = useState(false);
  const [pos, setPos] = useState<Pos>(() => {
    try {
      const raw = localStorage.getItem(POS_KEY);
      if (raw) return JSON.parse(raw);
    } catch { /* ignore */ }
    return { x: 76, y: 118 };
  });
  const rootRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; base: Pos; moved: boolean } | null>(null);

  const visible = !!session && session.settings.floatingEnabled;
  const char = session ? characters.find(c => c.id === session.charId) : undefined;
  const latest = session?.comments?.slice(-1)[0]?.text || (session?.status === 'paused' ? '采样暂停中。' : '我在看。');
  const isPaused = session?.status === 'paused';

  useEffect(() => {
    try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch { /* ignore */ }
  }, [pos]);

  useEffect(() => {
    const parent = rootRef.current?.offsetParent?.getBoundingClientRect();
    setPos(prev => clamp(prev, parent));
  }, [visible]);

  if (!visible || !session) return null;

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, base: pos, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.hypot(dx, dy) > 3) drag.moved = true;
    const parent = rootRef.current?.offsetParent?.getBoundingClientRect();
    setPos(clamp({ x: drag.base.x + dx, y: drag.base.y + dy }, parent));
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* ignore */ }
  };

  return (
    <div
      ref={rootRef}
      className="absolute z-[68] select-none text-slate-950"
      style={{ width: WIDTH, transform: `translate3d(${pos.x}px, ${pos.y}px, 0)` }}
    >
      <div className="overflow-hidden rounded-2xl border border-white/70 bg-white/90 shadow-[0_18px_60px_rgba(15,23,42,0.24)] backdrop-blur-xl">
        <div
          className="flex cursor-grab items-center gap-2 px-3 py-2 active:cursor-grabbing"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {char?.avatar ? (
            <img src={char.avatar} alt="" className="h-10 w-10 shrink-0 rounded-xl object-cover" draggable={false} />
          ) : (
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-sm font-black text-emerald-700">
              {session.charName.slice(0, 1)}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[11px] font-black text-emerald-700">
              <MonitorPlay size={14} weight="bold" />
              <span>{isPaused ? '已暂停' : '观屏中'}</span>
            </div>
            <div className="truncate text-sm font-black">{session.charName}</div>
          </div>
          <button
            type="button"
            onPointerDown={event => event.stopPropagation()}
            onClick={() => setCollapsed(v => !v)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700 active:scale-95"
            title={collapsed ? '展开' : '收起'}
            aria-label={collapsed ? '展开观屏评论' : '收起观屏评论'}
          >
            {collapsed ? <CaretDown size={16} weight="bold" /> : <CaretUp size={16} weight="bold" />}
          </button>
        </div>

        {!collapsed && (
          <div className="border-t border-slate-200/70 px-3 pb-3 pt-2">
            <div className="min-h-[44px] rounded-xl bg-slate-50 px-3 py-2 text-[13px] leading-snug text-slate-800">
              {latest}
            </div>
            <div className="mt-2 grid grid-cols-4 gap-2">
              <button
                type="button"
                onClick={isPaused ? resumeSampling : pauseSampling}
                className="flex h-9 items-center justify-center rounded-xl bg-slate-100 text-slate-800 active:scale-95 disabled:opacity-50"
                title={isPaused ? '继续采样' : '暂停采样'}
                aria-label={isPaused ? '继续采样' : '暂停采样'}
              >
                {isPaused ? <Play size={17} weight="bold" /> : <Pause size={17} weight="bold" />}
              </button>
              <button
                type="button"
                onClick={requestCommentNow}
                disabled={isCommenting}
                className="flex h-9 items-center justify-center rounded-xl bg-emerald-500 text-white active:scale-95 disabled:opacity-50"
                title="评这一眼"
                aria-label="评这一眼"
              >
                <Lightning size={17} weight="bold" />
              </button>
              <button
                type="button"
                onClick={stopWatch}
                className="col-span-2 flex h-9 items-center justify-center gap-1.5 rounded-xl bg-slate-950 px-3 text-xs font-black text-white active:scale-95"
                title="停止共享"
                aria-label="停止共享"
              >
                <Stop size={15} weight="fill" />
                停止
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default UserScreenWatchOverlay;
