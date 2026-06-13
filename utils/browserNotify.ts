/**
 * 浏览器通知授权 / 弹窗小助手
 * ================================
 * 给「离线主动消息弹窗」用：统一封装通知权限的查询 / 申请、浏览器识别（Chrome / Edge），
 * 以及一条稳妥的本地系统通知发送路径。
 *
 * 设计取舍（对应需求「强化现有 + 授权引导，支持 Chrome/Edge」）：
 *  - 只管「浏览器本地通知权限 + 弹窗」，不碰 Web Push 订阅（那条在 pushSubscribeShared.ts）。
 *  - 弹窗优先走 Service Worker registration.showNotification —— 页面级 `new Notification()`
 *    在后台标签 / PWA / 移动端会静默失败，SW 路径在桌面 Chrome/Edge 上最稳。
 *  - 仅做能力探测与文案，不强制部署任何 worker，本地标签页活着即可收到弹窗。
 */

export type NotifyPermission = 'unsupported' | 'default' | 'granted' | 'denied';

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator;
}

export function getNotifyPermission(): NotifyPermission {
  if (!notificationsSupported()) return 'unsupported';
  return Notification.permission as NotifyPermission;
}

/**
 * 申请通知权限。返回最终状态。
 * 已 granted 直接返回；denied 无法再弹（浏览器记住了），需用户去站点设置里手动改。
 */
export async function requestNotifyPermission(): Promise<NotifyPermission> {
  if (!notificationsSupported()) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  try {
    const perm = await Notification.requestPermission();
    return perm as NotifyPermission;
  } catch {
    return getNotifyPermission();
  }
}

export interface BrowserInfo {
  name: string;
  isEdge: boolean;
  isChrome: boolean;
  /** Chromium 内核（Chrome / Edge / Brave / Opera 等），桌面端 Web 通知支持最好。 */
  isChromium: boolean;
  isFirefox: boolean;
  isSafari: boolean;
  isMobile: boolean;
}

export function detectBrowser(): BrowserInfo {
  const ua = (typeof navigator !== 'undefined' ? navigator.userAgent : '') || '';
  const isEdge = /\bEdg(e|A|iOS)?\//i.test(ua);
  const isOpera = /\bOPR\//i.test(ua) || /\bOpera\//i.test(ua);
  const isFirefox = /\bFirefox\//i.test(ua);
  // Chrome：含 Chrome 标识，且不是套壳的 Edge / Opera。
  const isChrome = /\bChrome\//i.test(ua) && !isEdge && !isOpera;
  const isChromium = /\bChrom(e|ium)\//i.test(ua) || isEdge || isOpera;
  const isSafari = /\bSafari\//i.test(ua) && !isChromium && !isFirefox;
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  let name = '浏览器';
  if (isEdge) name = 'Edge';
  else if (isChrome) name = 'Chrome';
  else if (isOpera) name = 'Opera';
  else if (isFirefox) name = 'Firefox';
  else if (isSafari) name = 'Safari';
  return { name, isEdge, isChrome, isChromium, isFirefox, isSafari, isMobile };
}

/** Chrome / Edge 桌面端是本特性的最佳目标：开箱即用、无需 PWA 安装。 */
export function isRecommendedForWebNotify(): boolean {
  const b = detectBrowser();
  return b.isChromium && !b.isMobile;
}

export interface LocalNotificationOptions {
  body?: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: any;
  /** 同 tag 时是否替换而不是叠加（默认 true）。 */
  renotify?: boolean;
  silent?: boolean;
}

/**
 * 发一条本地系统通知。优先 SW registration.showNotification，回退到页面级 Notification。
 * 仅在 permission === 'granted' 时有效；其余情况静默返回 false。
 */
export async function showLocalNotification(title: string, opts: LocalNotificationOptions = {}): Promise<boolean> {
  if (getNotifyPermission() !== 'granted') return false;
  const notifOpts: NotificationOptions & { renotify?: boolean } = {
    body: opts.body,
    icon: opts.icon || './icons/icon-192.png',
    badge: opts.badge || './icons/icon-192.png',
    tag: opts.tag,
    data: opts.data,
    silent: opts.silent,
    renotify: opts.tag ? (opts.renotify ?? true) : undefined,
  };
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(title, notifOpts);
      return true;
    }
  } catch {
    /* SW 路径失败，落到页面级兜底 */
  }
  try {
    // eslint-disable-next-line no-new
    new Notification(title, notifOpts);
    return true;
  } catch {
    return false;
  }
}
