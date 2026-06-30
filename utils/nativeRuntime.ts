import { Capacitor } from '@capacitor/core';

export function isNativeAppRuntime(): boolean {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
}

export function installNativeAppRuntimeClass(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (!isNativeAppRuntime()) return false;

  document.documentElement.classList.add('moro-native-app');
  document.body.classList.add('moro-native-app');

  const syncViewportVars = () => {
    const viewportHeight = Math.round(window.visualViewport?.height || window.innerHeight);
    const viewportOffsetTop = Math.round(window.visualViewport?.offsetTop || 0);
    const innerHeight = Math.round(window.innerHeight);
    const keyboardOverlap = Math.max(0, innerHeight - viewportHeight - viewportOffsetTop);
    const keyboardInset = keyboardOverlap > 120 ? keyboardOverlap : 0;

    document.documentElement.style.setProperty('--app-height', `${viewportHeight}px`);
    document.documentElement.style.setProperty('--visual-viewport-height', `${viewportHeight}px`);
    document.documentElement.style.setProperty('--keyboard-inset', `${keyboardInset}px`);
    document.documentElement.style.setProperty('--standalone-safe-area-top', '0px');
    document.documentElement.style.setProperty('--standalone-safe-area-bottom', '0px');
  };

  syncViewportVars();
  window.addEventListener('resize', syncViewportVars, { passive: true });
  window.visualViewport?.addEventListener('resize', syncViewportVars, { passive: true });
  window.visualViewport?.addEventListener('scroll', syncViewportVars, { passive: true });
  return true;
}
