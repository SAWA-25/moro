/**
 * 锁手机·双向试错记录。
 *
 * - 用户那边输错锁屏密码 → 记一笔 user fail；角色聊天上下文里会被告知（"有人试图解锁你的手机"），
 *   角色可自然地起疑/吃醋/调侃。
 * - 角色那边偷看手机时试错密码 → 记一笔 char 提醒；下次回到锁屏会给用户一条提示横幅。
 *
 * 纯 localStorage 存取 + 纯格式化函数，便于单测（test-setup 提供 localStorage stub）。
 */

const USER_FAILS_KEY = 'moro_lock_user_fails';        // number[]（失败时间戳）
const CHAR_REMINDERS_KEY = 'moro_lock_char_reminders'; // { charId?, name, at }[]
const MAX = 30;

export interface CharUnlockReminder { charId?: string; name: string; at: number; }

const readArr = <T>(key: string): T[] => {
    try {
        const raw = localStorage.getItem(key);
        const v = raw ? JSON.parse(raw) : [];
        return Array.isArray(v) ? v : [];
    } catch { return []; }
};
const writeArr = (key: string, v: unknown[]): void => {
    try { localStorage.setItem(key, JSON.stringify(v.slice(-MAX))); } catch { /* ignore */ }
};

// ── 用户试错（→ 角色感知） ──

export function recordUserUnlockFail(now: number = Date.now()): void {
    const fails = readArr<number>(USER_FAILS_KEY).filter(n => typeof n === 'number');
    fails.push(now);
    writeArr(USER_FAILS_KEY, fails);
}

/** 取窗口期内（默认 12h）的用户试错时间戳。 */
export function getRecentUserUnlockFails(windowMs: number = 12 * 60 * 60 * 1000, now: number = Date.now()): number[] {
    return readArr<number>(USER_FAILS_KEY).filter(n => typeof n === 'number' && now - n <= windowMs && n <= now);
}

export function clearUserUnlockFails(): void {
    try { localStorage.removeItem(USER_FAILS_KEY); } catch { /* ignore */ }
}

/** 把窗口期内的用户试错拼成给角色看的系统行；没有则空串（纯函数，便于测试）。 */
export function formatUserFailsForPrompt(fails: number[], now: number = Date.now()): string {
    if (!fails.length) return '';
    const last = Math.max(...fails);
    const mins = Math.max(0, Math.round((now - last) / 60000));
    const when = mins < 1 ? '刚刚' : mins < 60 ? `${mins} 分钟前` : `${Math.round(mins / 60)} 小时前`;
    return `\n### 【手机动静】\n[系统: 你注意到 TA 的手机最近被人输错锁屏密码 ${fails.length} 次（最近一次约 ${when}）。可以按你的性格自然地起个疑、关心或调侃一句——也可以装作没看见，别生硬复述本提示。]\n`;
}

/** 一步到位：取窗口期内用户试错并格式化（聊天上下文注入用）。 */
export function buildUserFailAwareness(windowMs?: number, now: number = Date.now()): string {
    return formatUserFailsForPrompt(getRecentUserUnlockFails(windowMs, now), now);
}

// ── 角色试错（→ 用户提醒） ──

export function recordCharUnlockFail(name: string, charId?: string, now: number = Date.now()): void {
    const list = readArr<CharUnlockReminder>(CHAR_REMINDERS_KEY);
    list.push({ charId, name, at: now });
    writeArr(CHAR_REMINDERS_KEY, list);
}

/** 读取并清空待提醒的「角色试错解锁」事件（锁屏横幅用，消费即清）。 */
export function consumeCharUnlockReminders(): CharUnlockReminder[] {
    const list = readArr<CharUnlockReminder>(CHAR_REMINDERS_KEY);
    if (list.length) { try { localStorage.removeItem(CHAR_REMINDERS_KEY); } catch { /* ignore */ } }
    return list;
}

export function peekCharUnlockReminders(): CharUnlockReminder[] {
    return readArr<CharUnlockReminder>(CHAR_REMINDERS_KEY);
}
