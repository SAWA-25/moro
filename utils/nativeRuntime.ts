import { Capacitor } from '@capacitor/core';

export function isNativeAppRuntime(): boolean {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
}

export function installNativeAppRuntimeClass(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (!isNativeAppRuntime()) return false;

  document.documentElement.classList.add('moro-native-app');
  document.body.classList.add('moro-native-app');
  document.documentElement.dataset.moroRuntime = 'native';

  let frame = 0;
  const syncViewportVars = () => {
    if (frame) window.cancelAnimationFrame(frame);
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      const viewportHeight = Math.round(window.innerHeight || window.visualViewport?.height || 0);

      document.documentElement.style.setProperty('--app-height', `${viewportHeight}px`);
      document.documentElement.style.setProperty('--visual-viewport-height', `${viewportHeight}px`);
      document.documentElement.style.setProperty('--keyboard-inset', '0px');
      document.documentElement.style.setProperty('--standalone-safe-area-top', '0px');
      document.documentElement.style.setProperty('--standalone-safe-area-bottom', '0px');
    });
  };

  syncViewportVars();
  window.addEventListener('resize', syncViewportVars, { passive: true });
  window.addEventListener('orientationchange', syncViewportVars, { passive: true });
  document.addEventListener('visibilitychange', syncViewportVars, { passive: true });
  return true;
}
