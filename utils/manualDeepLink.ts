import { useEffect } from 'react';
import { AppID } from '../types';

export interface ManualDeepLinkTarget {
  appId: AppID;
  route?: string;
  anchorId?: string;
  payload?: Record<string, unknown>;
  createdAt?: number;
}

const STORAGE_KEY = 'moro_manual_deep_link_target_v1';
const EVENT_NAME = 'moro:manual-deep-link';
const DEFAULT_TTL_MS = 2 * 60 * 1000;
const HIGHLIGHT_CLASS = 'manual-anchor-highlight';
const HIGHLIGHT_STYLE_ID = 'moro-manual-anchor-highlight-style';

const now = () => Date.now();

const isBrowser = () => typeof window !== 'undefined' && typeof localStorage !== 'undefined';

const isManualDeepLinkTarget = (value: unknown): value is ManualDeepLinkTarget => {
  if (!value || typeof value !== 'object') return false;
  const target = value as Partial<ManualDeepLinkTarget>;
  return typeof target.appId === 'string';
};

export const queueManualDeepLink = (target: ManualDeepLinkTarget): ManualDeepLinkTarget | null => {
  if (!isBrowser()) return null;
  const next: ManualDeepLinkTarget = { ...target, createdAt: now() };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: next }));
    return next;
  } catch {
    return null;
  }
};

export const peekManualDeepLink = (): ManualDeepLinkTarget | null => {
  if (!isBrowser()) return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isManualDeepLinkTarget(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export const consumeManualDeepLink = (
  appId: AppID,
  options: { ttlMs?: number } = {},
): ManualDeepLinkTarget | null => {
  if (!isBrowser()) return null;
  const target = peekManualDeepLink();
  if (!target) return null;
  const createdAt = typeof target.createdAt === 'number' ? target.createdAt : 0;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  if (createdAt && now() - createdAt > ttlMs) {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    return null;
  }
  if (target.appId !== appId) return null;
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  return target;
};

const ensureHighlightStyle = () => {
  if (typeof document === 'undefined' || document.getElementById(HIGHLIGHT_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = HIGHLIGHT_STYLE_ID;
  style.textContent = `
@keyframes moroManualAnchorPulse {
  0% { box-shadow: 0 0 0 0 rgba(127,168,179,0.55); outline-color: rgba(127,168,179,0.95); }
  45% { box-shadow: 0 0 0 10px rgba(127,168,179,0.16); outline-color: rgba(127,168,179,0.95); }
  100% { box-shadow: 0 0 0 0 rgba(127,168,179,0); outline-color: rgba(127,168,179,0); }
}
.${HIGHLIGHT_CLASS} {
  position: relative;
  outline: 2px solid rgba(127,168,179,0.95) !important;
  outline-offset: 3px;
  animation: moroManualAnchorPulse 1.4s ease-in-out 2;
  transition: outline-color 180ms ease, box-shadow 180ms ease;
}
`;
  document.head.appendChild(style);
};

export const scrollToManualAnchor = (anchorId?: string, options: ScrollIntoViewOptions = {}): boolean => {
  if (!anchorId || typeof document === 'undefined') return false;
  const escapedAnchor = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(anchorId)
    : anchorId.replace(/["\\]/g, '\\$&');
  const selector = `[data-manual-anchor="${escapedAnchor}"]`;
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) return false;

  ensureHighlightStyle();
  element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest', ...options });
  element.classList.remove(HIGHLIGHT_CLASS);
  void element.offsetWidth;
  element.classList.add(HIGHLIGHT_CLASS);
  window.setTimeout(() => {
    element.classList.remove(HIGHLIGHT_CLASS);
  }, 3200);
  return true;
};

export const useManualDeepLink = (
  appId: AppID,
  handler: (target: ManualDeepLinkTarget) => void,
  options: { ttlMs?: number; enabled?: boolean } = {},
) => {
  useEffect(() => {
    const enabled = options.enabled ?? true;
    const consume = (target?: ManualDeepLinkTarget | null) => {
      if (!enabled) return;
      const next = target && target.appId === appId
        ? consumeManualDeepLink(appId, options)
        : consumeManualDeepLink(appId, options);
      if (next) handler(next);
    };

    const onQueued = (event: Event) => {
      const detail = (event as CustomEvent<ManualDeepLinkTarget>).detail;
      if (!detail || detail.appId !== appId) return;
      consume(detail);
    };

    consume();
    window.addEventListener(EVENT_NAME, onQueued);
    return () => window.removeEventListener(EVENT_NAME, onQueued);
  }, [appId, handler, options.ttlMs, options.enabled]);
};

export const manualAnchorProps = (anchorId?: string) => (
  anchorId ? { 'data-manual-anchor': anchorId } : {}
);
