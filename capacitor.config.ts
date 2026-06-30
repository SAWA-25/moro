import type { CapacitorConfig } from '@capacitor/cli';

const liveUpdatesAppId = process.env.VITE_MORO_APPFLOW_APP_ID?.trim() || '';
const liveUpdatesChannel = process.env.VITE_MORO_APPFLOW_CHANNEL?.trim() || 'Production';
const liveUpdatesMaxVersions = Number(process.env.VITE_MORO_APPFLOW_MAX_VERSIONS || 2);

const config: CapacitorConfig = {
  appId: 'com.moro.app',
  appName: 'Moro',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    cleartext: true,
  },
  android: {
    backgroundColor: '#f4f2ed',
    initialFocus: false,
    zoomEnabled: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 0,
    },
    Keyboard: {
      resize: 'native',
      style: 'dark',
      resizeOnFullScreen: true,
    },
    LiveUpdates: {
      appId: liveUpdatesAppId || 'unset',
      channel: liveUpdatesChannel,
      autoUpdateMethod: process.env.VITE_MORO_APPFLOW_AUTO_UPDATE_METHOD === 'none' ? 'none' : 'background',
      strategy: 'differential',
      enabled: !!liveUpdatesAppId && process.env.VITE_MORO_APPFLOW_ENABLED !== '0',
      maxVersions: Number.isFinite(liveUpdatesMaxVersions) && liveUpdatesMaxVersions > 0 ? Math.floor(liveUpdatesMaxVersions) : 2,
    },
  },
};

export default config;
