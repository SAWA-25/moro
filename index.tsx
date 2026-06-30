import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ActiveMsgRuntime } from './utils/activeMsgRuntime';
import { KeepAlive } from './utils/keepAlive';
import { ProactiveChat } from './utils/proactiveChat';
import { VRScheduler } from './utils/vrWorld/scheduler';
import { installIOSStandaloneWorkaround } from './utils/iosStandalone';
import { installNativeAppRuntimeClass, isNativeAppRuntime } from './utils/nativeRuntime';
import { installWakeListener } from './utils/proactivePushConfig';

const nativeRuntime = installNativeAppRuntimeClass();
if (!nativeRuntime) installIOSStandaloneWorkaround();

// Register the keep-alive Service Worker early so it's ready before any AI calls.
// Native Android WebView does not need the browser SW wake path; keeping it out
// avoids startup work and web-only side effects inside the packaged app.
const runtimeReady = isNativeAppRuntime() ? Promise.resolve() : KeepAlive.init();
runtimeReady.then(() => {
  // Resume any active proactive schedule after SW is ready
  ProactiveChat.resume();
  // Resume 「页外」 autonomous-login schedules
  VRScheduler.resume();
  void ActiveMsgRuntime.init();
  // Record every wake the SW reports so the diagnostic panel can show "last received".
  installWakeListener();
});

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
