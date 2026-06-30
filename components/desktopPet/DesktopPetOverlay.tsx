import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowsOut, ArrowLineLeft, ArrowLineRight, BowlFood, Minus, PawPrint } from '@phosphor-icons/react';
import { AppID, type DesktopPetState } from '../../types';
import { useOS } from '../../context/OSContext';
import { useDesktopPet } from '../../context/DesktopPetContext';
import {
  DESKTOP_PET_FV_MAX,
  DESKTOP_PET_HP_MAX,
  advanceDesktopPetFallOverlay,
  advanceDesktopPetWalkOverlay,
  canDesktopPetAutoWalkDuringAction,
  clampDesktopPetOverlay,
  dockDesktopPetOverlay,
  getDesktopPetActionHoldLoops,
  getDesktopPetFallTargetY,
  getDesktopPetRoleState,
  isDesktopPetIdleAction,
  selectDesktopPetRandomAction,
  shouldPlaceDesktopPetControlsOnLeft,
  type DesktopPetWalkDirection,
} from '../../utils/desktopPet';
import DesktopPetFoodEffect from './DesktopPetFoodEffect';
import DesktopPetSprite from './DesktopPetSprite';

const AUTO_RANDOM_IDLE_DELAY_MS = 12000;
const AUTO_RANDOM_MIN_INTERVAL_MS = 24000;
const LONG_PRESS_CONTROLS_MS = 560;
const OVERLAY_SPEECH_SOURCES = new Set(['feed', 'pat', 'reminder']);
const FALL_STEP_DISTANCE = 36;
const CONTROLS_PANEL_WIDTH = 176;
const CONTROLS_PANEL_MARGIN = 8;
const CONTROLS_PANEL_ESTIMATED_HEIGHT = 248;
const WALK_OVERLAY_COMMIT_MS = 1200;
const PET_HITBOX_PARTS = [
  { width: 0.34, height: 0.24, bottom: 0.5 },
  { width: 0.24, height: 0.36, bottom: 0.19 },
  { width: 0.18, height: 0.2, bottom: 0.02 },
];

const overlayTransform = (overlay: DesktopPetState['overlay']) => (
  `translate3d(${overlay.x.toFixed(1)}px, ${overlay.y.toFixed(1)}px, 0)`
);

const DesktopPetOverlay: React.FC = () => {
  const { openApp, activeApp, isLocked } = useOS();
  const { manifest, state, activeRoleId, currentActionId, foods, updateOverlay, setFloatingEnabled, playAction, patActivePet, feedActivePet } = useDesktopPet();
  const [dragging, setDragging] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [speechVisible, setSpeechVisible] = useState(false);
  const [settling, setSettling] = useState(false);
  const [feedBusy, setFeedBusy] = useState(false);
  const [feedHint, setFeedHint] = useState('');
  const [overlayFoodId, setOverlayFoodId] = useState('');
  const [feedingEffect, setFeedingEffect] = useState<{ id: number; image: string; name: string } | null>(null);
  const overlayRootRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    dx: number;
    dy: number;
    startX: number;
    startY: number;
    moved: boolean;
    startedAt: number;
    longPressed: boolean;
  } | null>(null);
  const latestOverlayRef = useRef(state.overlay);
  const currentActionRef = useRef(currentActionId);
  const mountedAtRef = useRef(Date.now());
  const controlsTimerRef = useRef<number | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const settleTimerRef = useRef<number | null>(null);
  const fallFrameRef = useRef<number | null>(null);
  const randomIdleTimerRef = useRef<number | null>(null);
  const lastOverlayCommitAtRef = useRef(0);
  const actionLoopCountRef = useRef(0);
  const lastRandomActionAtRef = useRef(0);
  const walkDirectionRef = useRef<DesktopPetWalkDirection>('right');
  const walkingActionRef = useRef<'left_walk' | 'right_walk' | null>(null);
  const role = manifest?.roles[activeRoleId];
  const spriteSize = useMemo(() => ({
    width: Math.max(120, (role?.width || 300) * state.overlay.scale),
    height: Math.max(128, (role?.height || 320) * state.overlay.scale),
  }), [role?.height, role?.width, state.overlay.scale]);
  const leftWalkFrameMove = role?.actions.left_walk?.frameMove || 3;
  const rightWalkFrameMove = role?.actions.right_walk?.frameMove || 3;
  const walkFrameRefresh = role?.actions.left_walk?.frameRefresh || role?.actions.right_walk?.frameRefresh || 0.06;
  const roleState = getDesktopPetRoleState(state, activeRoleId);
  const hpPercent = Math.round((roleState.hp / DESKTOP_PET_HP_MAX) * 100);
  const fvPercent = Math.round((roleState.fv / DESKTOP_PET_FV_MAX) * 100);
  const quickFood = foods.find(food => food.id === overlayFoodId) || foods[0];
  const visualOverlay = latestOverlayRef.current;
  const viewportWidth = typeof window === 'undefined' ? 390 : window.innerWidth;
  const viewportHeight = typeof window === 'undefined' ? 844 : window.innerHeight;
  const controlsOnLeft = shouldPlaceDesktopPetControlsOnLeft(visualOverlay, viewportWidth, spriteSize, CONTROLS_PANEL_WIDTH);
  const entryButtonStyle = controlsOpen ? {
    left: Math.min(Math.max(spriteSize.width / 2, 44 - visualOverlay.x), viewportWidth - visualOverlay.x - 44),
  } : undefined;
  const controlsPanelStyle = controlsOpen ? {
    left: Math.min(
      Math.max(
        controlsOnLeft ? -CONTROLS_PANEL_WIDTH - 12 : spriteSize.width + 12,
        CONTROLS_PANEL_MARGIN - visualOverlay.x,
      ),
      viewportWidth - visualOverlay.x - CONTROLS_PANEL_WIDTH - CONTROLS_PANEL_MARGIN,
    ),
    top: Math.min(
      Math.max(32, CONTROLS_PANEL_MARGIN - visualOverlay.y),
      viewportHeight - visualOverlay.y - CONTROLS_PANEL_ESTIMATED_HEIGHT - CONTROLS_PANEL_MARGIN,
    ),
    maxHeight: Math.max(168, viewportHeight - (CONTROLS_PANEL_MARGIN * 2)),
  } : undefined;
  const spriteHitboxStyles = PET_HITBOX_PARTS.map(part => ({
    width: Math.max(28, spriteSize.width * part.width),
    height: Math.max(30, spriteSize.height * part.height),
    bottom: Math.max(2, spriteSize.height * part.bottom),
    clipPath: 'ellipse(48% 48% at 50% 50%)',
  }));
  const canAutoWalk = !!(
    state.floatingEnabled
    && manifest
    && activeApp !== AppID.DesktopPet
    && !isLocked
    && !controlsOpen
    && !dragging
    && !settling
    && state.overlay.dockSide !== 'left'
    && state.overlay.dockSide !== 'right'
    && canDesktopPetAutoWalkDuringAction(currentActionId, role?.defaultAction)
    && role?.actions.left_walk
    && role?.actions.right_walk
  );
  const canScheduleAutoRandom = !!(
    state.floatingEnabled
    && activeApp !== AppID.DesktopPet
    && !isLocked
    && !controlsOpen
    && !dragging
    && !settling
    && role
    && canDesktopPetAutoWalkDuringAction(currentActionId, role.defaultAction)
  );

  const applyVisualOverlay = useCallback((overlay: DesktopPetState['overlay']) => {
    latestOverlayRef.current = overlay;
    const root = overlayRootRef.current;
    if (root) root.style.transform = overlayTransform(overlay);
  }, []);

  const commitOverlay = useCallback((overlay = latestOverlayRef.current) => {
    applyVisualOverlay(overlay);
    lastOverlayCommitAtRef.current = Date.now();
    void updateOverlay(overlay);
  }, [applyVisualOverlay, updateOverlay]);

  const commitOverlayIfDue = useCallback((overlay: DesktopPetState['overlay']) => {
    applyVisualOverlay(overlay);
    const now = Date.now();
    if (now - lastOverlayCommitAtRef.current < WALK_OVERLAY_COMMIT_MS) return;
    lastOverlayCommitAtRef.current = now;
    void updateOverlay(overlay);
  }, [applyVisualOverlay, updateOverlay]);

  const showControls = () => {
    walkingActionRef.current = null;
    commitOverlay(latestOverlayRef.current);
    setControlsOpen(true);
    if (controlsTimerRef.current) window.clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = window.setTimeout(() => setControlsOpen(false), 5000);
  };

  const clearLongPressTimer = () => {
    if (!longPressTimerRef.current) return;
    window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  };

  useEffect(() => { applyVisualOverlay(state.overlay); }, [applyVisualOverlay, state.overlay]);
  useEffect(() => { currentActionRef.current = currentActionId; }, [currentActionId]);
  useEffect(() => { actionLoopCountRef.current = 0; }, [activeRoleId, currentActionId]);

  useEffect(() => {
    const speech = state.lastSpeech;
    if (
      !speech?.id
      || speech.role !== 'pet'
      || !speech.source
      || !OVERLAY_SPEECH_SOURCES.has(speech.source)
      || speech.createdAt < mountedAtRef.current
    ) {
      setSpeechVisible(false);
      return undefined;
    }
    setSpeechVisible(true);
    const timer = window.setTimeout(() => setSpeechVisible(false), 8000);
    return () => window.clearTimeout(timer);
  }, [state.lastSpeech?.createdAt, state.lastSpeech?.id, state.lastSpeech?.role, state.lastSpeech?.source]);

  useEffect(() => () => {
    if (controlsTimerRef.current) window.clearTimeout(controlsTimerRef.current);
    if (longPressTimerRef.current) window.clearTimeout(longPressTimerRef.current);
    if (settleTimerRef.current) window.clearTimeout(settleTimerRef.current);
    if (fallFrameRef.current) window.cancelAnimationFrame(fallFrameRef.current);
    if (randomIdleTimerRef.current) window.clearTimeout(randomIdleTimerRef.current);
  }, []);

  const playSettleAction = () => {
    if (!role) return;
    if (settleTimerRef.current) window.clearTimeout(settleTimerRef.current);
    if (fallFrameRef.current) window.cancelAnimationFrame(fallFrameRef.current);
    setSettling(true);

    const finishOnFloor = () => {
      if (!role) return;
      if (role.actions.onfloor) {
        playAction('onfloor');
        settleTimerRef.current = window.setTimeout(() => {
          playAction(role.defaultAction);
          setSettling(false);
        }, Math.max(260, (role.actions.onfloor.frames.length * role.actions.onfloor.frameRefresh * 1000) || 650));
        return;
      }
      playAction(role.defaultAction);
      setSettling(false);
    };

    if (!role.actions.fall) {
      commitOverlay(latestOverlayRef.current);
      finishOnFloor();
      return;
    }

    playAction('fall');
    const targetY = getDesktopPetFallTargetY(
      latestOverlayRef.current,
      { width: window.innerWidth, height: window.innerHeight },
      spriteSize,
      FALL_STEP_DISTANCE,
    );
    let lastTs = performance.now();
    const step = (ts: number) => {
      const deltaSeconds = (ts - lastTs) / 1000;
      lastTs = ts;
      const next = advanceDesktopPetFallOverlay(
        latestOverlayRef.current,
        { width: window.innerWidth, height: window.innerHeight },
        spriteSize,
        deltaSeconds,
        state.fallSpeed,
        targetY,
      );
      applyVisualOverlay(next.overlay);
      if (next.landed) {
        fallFrameRef.current = null;
        commitOverlay(next.overlay);
        finishOnFloor();
        return;
      }
      fallFrameRef.current = window.requestAnimationFrame(step);
    };
    fallFrameRef.current = window.requestAnimationFrame(step);
  };

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (drag.pointerId !== event.pointerId) return;
      if (drag.longPressed) return;
      const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
      if (!drag.moved && distance < 8) return;
      if (!drag.moved) {
        drag.moved = true;
        clearLongPressTimer();
        setDragging(true);
        setControlsOpen(false);
        setSpeechVisible(false);
        walkingActionRef.current = null;
        if (fallFrameRef.current) {
          window.cancelAnimationFrame(fallFrameRef.current);
          fallFrameRef.current = null;
        }
        if (settleTimerRef.current) window.clearTimeout(settleTimerRef.current);
        setSettling(false);
        if (role?.actions.drag) playAction('drag');
      }
      const next = clampDesktopPetOverlay({
        ...latestOverlayRef.current,
        x: event.clientX - drag.dx,
        y: event.clientY - drag.dy,
        dockSide: 'none',
      }, { width: window.innerWidth, height: window.innerHeight }, spriteSize);
      applyVisualOverlay(next);
    };
    const onUp = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (drag && drag.pointerId !== event.pointerId) return;
      clearLongPressTimer();
      dragRef.current = null;
      if (drag?.moved) {
        setDragging(false);
        const docked = dockDesktopPetOverlay(latestOverlayRef.current, { width: window.innerWidth, height: window.innerHeight }, spriteSize);
        applyVisualOverlay(docked);
        if (docked.dockSide === 'left' || docked.dockSide === 'right') {
          commitOverlay(docked);
        }
        if (role?.actions.fall || role?.actions.onfloor) playSettleAction();
        else {
          commitOverlay(latestOverlayRef.current);
          playAction(role?.defaultAction || 'default');
        }
      } else if (drag?.longPressed) {
        setDragging(false);
      } else {
        setDragging(false);
        setSpeechVisible(false);
        walkingActionRef.current = null;
        void patActivePet();
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [applyVisualOverlay, commitOverlay, patActivePet, playAction, role, spriteSize]);

  useEffect(() => {
    if (!canAutoWalk) return undefined;
    walkingActionRef.current = walkDirectionRef.current === 'right' ? 'right_walk' : 'left_walk';
    currentActionRef.current = walkingActionRef.current;
    playAction(walkingActionRef.current);
    const timer = window.setInterval(() => {
      if (!walkingActionRef.current || currentActionRef.current !== walkingActionRef.current) return;
      const direction = walkDirectionRef.current;
      const next = advanceDesktopPetWalkOverlay(
        latestOverlayRef.current,
        direction,
        { width: window.innerWidth, height: window.innerHeight },
        spriteSize,
        direction === 'right' ? rightWalkFrameMove : leftWalkFrameMove,
      );
      walkDirectionRef.current = next.direction;
      applyVisualOverlay(next.overlay);
      if (walkingActionRef.current !== next.actionId) {
        walkingActionRef.current = next.actionId;
        currentActionRef.current = next.actionId;
        playAction(next.actionId);
      }
      commitOverlayIfDue(next.overlay);
    }, Math.max(50, (walkFrameRefresh * 1000) + 20));
    return () => {
      window.clearInterval(timer);
      commitOverlay(latestOverlayRef.current);
      walkingActionRef.current = null;
    };
  }, [applyVisualOverlay, canAutoWalk, commitOverlay, commitOverlayIfDue, currentActionId, leftWalkFrameMove, playAction, rightWalkFrameMove, spriteSize, walkFrameRefresh]);

  useEffect(() => {
    if (randomIdleTimerRef.current) {
      window.clearTimeout(randomIdleTimerRef.current);
      randomIdleTimerRef.current = null;
    }
    if (
      !canScheduleAutoRandom
    ) {
      return undefined;
    }
    const wait = Math.max(
      AUTO_RANDOM_IDLE_DELAY_MS,
      AUTO_RANDOM_MIN_INTERVAL_MS - (Date.now() - lastRandomActionAtRef.current),
    );
    randomIdleTimerRef.current = window.setTimeout(() => {
      if (!role) return;
      const actionId = selectDesktopPetRandomAction(role);
      lastRandomActionAtRef.current = Date.now();
      if (!canDesktopPetAutoWalkDuringAction(actionId, role.defaultAction)) {
        walkingActionRef.current = null;
      }
      playAction(actionId);
    }, wait);
    return () => {
      if (randomIdleTimerRef.current) {
        window.clearTimeout(randomIdleTimerRef.current);
        randomIdleTimerRef.current = null;
      }
    };
  }, [canScheduleAutoRandom, playAction, role]);

  const handleSpriteLoop = useCallback(() => {
    if (!role || dragging || settling || canAutoWalk) return;
    if (!isDesktopPetIdleAction(currentActionId, role.defaultAction)) {
      actionLoopCountRef.current += 1;
      if (actionLoopCountRef.current < getDesktopPetActionHoldLoops(currentActionId)) return;
      actionLoopCountRef.current = 0;
      playAction(role.defaultAction);
    }
  }, [canAutoWalk, currentActionId, dragging, playAction, role, settling]);

  useEffect(() => {
    if (controlsOpen) setSpeechVisible(false);
  }, [controlsOpen]);

  useEffect(() => {
    if (!foods.length) {
      if (overlayFoodId) setOverlayFoodId('');
      return;
    }
    if (!foods.some(food => food.id === overlayFoodId)) {
      setOverlayFoodId(foods[0].id);
    }
  }, [foods, overlayFoodId]);

  const handleQuickFeed = async () => {
    if (!quickFood || feedBusy) return;
    showControls();
    if (quickFood.image) {
      const effect = { id: Date.now(), image: quickFood.image, name: quickFood.name };
      setFeedingEffect(effect);
      window.setTimeout(() => {
        setFeedingEffect(current => current?.id === effect.id ? null : current);
      }, 950);
    }
    setFeedBusy(true);
    try {
      const result = await feedActivePet(quickFood.id);
      setFeedHint(result.message);
      showControls();
    } finally {
      setFeedBusy(false);
    }
  };

  const handlePetPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const root = overlayRootRef.current?.getBoundingClientRect();
    if (!root) return;
    dragRef.current = {
      pointerId: event.pointerId,
      dx: event.clientX - root.left,
      dy: event.clientY - root.top,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      startedAt: Date.now(),
      longPressed: false,
    };
    clearLongPressTimer();
    longPressTimerRef.current = window.setTimeout(() => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId || drag.moved) return;
      drag.longPressed = true;
      setDragging(false);
      setSpeechVisible(false);
      showControls();
    }, LONG_PRESS_CONTROLS_MS);
  };

  if (!state.floatingEnabled || !manifest || activeApp === AppID.DesktopPet || isLocked) return null;

  const lastSpeech = state.lastSpeech;

  return (
    <div
      ref={overlayRootRef}
      className="absolute z-[58] pointer-events-none touch-none will-change-transform"
      style={{
        left: 0,
        top: 0,
        transform: overlayTransform(latestOverlayRef.current),
        transition: dragging || canAutoWalk || settling ? 'none' : 'transform 120ms ease-out',
      }}
    >
      <div className="relative">
        {lastSpeech && speechVisible && !controlsOpen && (
          <div className="absolute -top-11 left-1/2 -translate-x-1/2 max-w-[220px] rounded-lg bg-white/95 border border-slate-200 shadow-lg px-3 py-2 text-[11px] leading-snug text-slate-700 font-bold pointer-events-none">
            {lastSpeech.text}
          </div>
        )}

        {controlsOpen && (
          <button
            className="absolute -top-8 -translate-x-1/2 h-7 px-2 rounded-full bg-white/90 border border-slate-200 shadow-lg flex items-center gap-1 text-[11px] font-black text-slate-700 active:scale-95 pointer-events-auto"
            style={entryButtonStyle}
            onClick={() => openApp(AppID.DesktopPet)}
            title="打开桌宠"
          >
            <PawPrint size={14} weight="fill" />
            桌宠
          </button>
        )}

        <div
          className="relative pointer-events-none"
        >
          {feedingEffect && (
            <DesktopPetFoodEffect
              key={feedingEffect.id}
              src={feedingEffect.image}
              name={feedingEffect.name}
              size={48}
              className="absolute left-1/2 top-1/2 z-20"
              style={{ marginLeft: -14, marginTop: -18 }}
            />
          )}
          <DesktopPetSprite role={role} actionId={currentActionId} scale={state.overlay.scale} onLoop={handleSpriteLoop} />
          {spriteHitboxStyles.slice(1).map((style, index) => (
            <div
              key={index}
              className="absolute left-1/2 z-30 -translate-x-1/2 cursor-grab active:cursor-grabbing pointer-events-auto rounded-full"
              style={style}
              onPointerDown={handlePetPointerDown}
            />
          ))}
          <div
            className="absolute left-1/2 z-30 -translate-x-1/2 cursor-grab active:cursor-grabbing pointer-events-auto"
            style={spriteHitboxStyles[0]}
            onPointerDown={handlePetPointerDown}
            aria-label={role ? `${role.name} 桌宠互动区域` : '桌宠互动区域'}
          />
        </div>

        {controlsOpen && (
          <div
            className="absolute w-44 rounded-lg bg-white/95 border border-slate-200 shadow-xl p-2 text-slate-800 overflow-y-auto no-scrollbar pointer-events-auto"
            style={controlsPanelStyle}
          >
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="min-w-0">
                <div className="text-[10px] font-black text-slate-400 leading-none">桌宠状态</div>
                <div className="text-xs font-black truncate mt-1">{role?.name || activeRoleId}</div>
              </div>
              <button
                className="shrink-0 h-7 px-2 rounded-full bg-slate-950 text-white flex items-center gap-1 text-[11px] font-black active:scale-95"
                title={quickFood ? `喂食：${quickFood.name}` : '没有可喂食物'}
                disabled={!quickFood || feedBusy}
                onClick={() => { void handleQuickFeed(); }}
              >
                <BowlFood size={14} weight="bold" />
                {feedBusy ? '喂...' : '喂食'}
              </button>
            </div>

            <div className="space-y-1.5">
              <div>
                <div className="flex items-center justify-between text-[10px] font-black text-slate-500">
                  <span>饱腹</span>
                  <span>{roleState.hp}/{DESKTOP_PET_HP_MAX}</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full rounded-full bg-emerald-500" style={{ width: `${hpPercent}%` }} />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between text-[10px] font-black text-slate-500">
                  <span>好感</span>
                  <span>{roleState.fv}/{DESKTOP_PET_FV_MAX}</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full rounded-full bg-pink-500" style={{ width: `${fvPercent}%` }} />
                </div>
              </div>
            </div>

            <div className="mt-2 h-4 text-[10px] leading-4 font-bold text-slate-400 truncate">
              {feedHint || (quickFood ? `默认投喂：${quickFood.name}` : '先在桌宠 App 导入食物包')}
            </div>

            {quickFood && (
              <div className="mt-1 grid grid-cols-[38px_1fr] gap-2 items-center rounded-md bg-slate-50 border border-slate-100 p-1.5">
                <div className="w-9 h-9 rounded-md bg-white border border-slate-100 grid place-items-center overflow-hidden">
                  {quickFood.image ? (
                    <img src={quickFood.image} alt={quickFood.name} className="w-8 h-8 object-contain" />
                  ) : (
                    <BowlFood size={18} className="text-slate-300" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] font-black truncate">{quickFood.name}</div>
                  <div className="text-[9px] font-bold text-slate-400 truncate">
                    饱腹 +{quickFood.effectHP} · 好感 +{quickFood.effectFV + (quickFood.fvReward || 0)}
                  </div>
                </div>
              </div>
            )}

            {foods.length > 0 && (
              <select
                value={quickFood?.id || ''}
                onChange={(event) => {
                  showControls();
                  setFeedHint('');
                  setOverlayFoodId(event.target.value);
                }}
                className="mt-1 w-full h-7 rounded-md border border-slate-200 bg-slate-50 px-2 text-[11px] font-bold text-slate-700 outline-none"
              >
                {foods.slice(0, 24).map(food => (
                  <option key={food.id} value={food.id}>{food.name}</option>
                ))}
              </select>
            )}

            <div className="mt-2 grid grid-cols-4 gap-1">
              <button
                className="h-7 rounded-full bg-slate-100 border border-slate-200 shadow-sm flex items-center justify-center text-slate-700 active:scale-95"
                title="缩放桌宠"
                onClick={() => {
                  showControls();
                  const scale = state.overlay.scale >= 1.1 ? 0.62 : state.overlay.scale + 0.16;
                  const nextSize = {
                    width: Math.max(120, (role?.width || 300) * scale),
                    height: Math.max(128, (role?.height || 320) * scale),
                  };
                  const next = clampDesktopPetOverlay({ ...state.overlay, scale }, { width: window.innerWidth, height: window.innerHeight }, nextSize);
                  latestOverlayRef.current = next;
                  void updateOverlay(next);
                }}
              >
                <ArrowsOut size={15} weight="bold" />
              </button>
              <button
                className="h-7 rounded-full bg-slate-100 border border-slate-200 shadow-sm flex items-center justify-center text-slate-700 active:scale-95"
                title="贴左侧"
                onClick={() => {
                  showControls();
                  void updateOverlay(dockDesktopPetOverlay(state.overlay, { width: window.innerWidth, height: window.innerHeight }, spriteSize, 'left'));
                }}
              >
                <ArrowLineLeft size={15} weight="bold" />
              </button>
              <button
                className="h-7 rounded-full bg-slate-100 border border-slate-200 shadow-sm flex items-center justify-center text-slate-700 active:scale-95"
                title="贴右侧"
                onClick={() => {
                  showControls();
                  void updateOverlay(dockDesktopPetOverlay(state.overlay, { width: window.innerWidth, height: window.innerHeight }, spriteSize, 'right'));
                }}
              >
                <ArrowLineRight size={15} weight="bold" />
              </button>
              <button
                className="h-7 rounded-full bg-slate-100 border border-slate-200 shadow-sm flex items-center justify-center text-slate-700 active:scale-95"
                title="隐藏桌宠"
                onClick={() => { void setFloatingEnabled(false); }}
              >
                <Minus size={15} weight="bold" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DesktopPetOverlay;
