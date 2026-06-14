/**
 * 「后台回复通知」开关（自律代理 · 系统通知的一部分）。
 *
 * 场景：普通聊天发出后把页面切到后台，等回复生成期间页面靠 Service Worker keep-alive
 * 保活；回复落定时，如果页面仍在后台，就把这条回复送进系统通知栏——无需悬浮窗。
 *
 * 实现上不新开链路：本地 fetch 路径回复落库后本就会派发 `proactive-message-sent`
 * （hooks/useChatAI.ts），OSContext 的监听器据此在「页面不可见」时走 SW
 * registration.showNotification。这里只提供一个用户可控的开关，默认开启。
 *
 * 存 localStorage 以便主线程同步读取。
 */

const KEY = 'background_reply_notify_v1';

export function isBackgroundReplyNotifyEnabled(): boolean {
    try {
        const v = localStorage.getItem(KEY);
        return v === null ? true : v === 'true'; // 默认开启
    } catch {
        return true;
    }
}

export function setBackgroundReplyNotify(on: boolean): void {
    try { localStorage.setItem(KEY, on ? 'true' : 'false'); } catch { /* ignore */ }
}
