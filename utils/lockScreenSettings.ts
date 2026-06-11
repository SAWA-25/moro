/**
 * 锁屏密码设置（设置 App「锁屏与密码」区管理）。
 * 默认密码 0103；可关闭密码（点按直接解锁，与旧行为一致）。
 */

const PASSCODE_KEY = 'moro_lock_passcode';
const ENABLED_KEY = 'moro_lock_passcode_enabled';

export const DEFAULT_LOCK_PASSCODE = '0103';

export const getLockPasscode = (): string => {
    try { return localStorage.getItem(PASSCODE_KEY) || DEFAULT_LOCK_PASSCODE; } catch { return DEFAULT_LOCK_PASSCODE; }
};

export const setLockPasscode = (passcode: string): void => {
    try { localStorage.setItem(PASSCODE_KEY, passcode); } catch { /* ignore */ }
};

export const isLockPasscodeEnabled = (): boolean => {
    try { return localStorage.getItem(ENABLED_KEY) !== '0'; } catch { return true; }
};

export const setLockPasscodeEnabled = (enabled: boolean): void => {
    try { localStorage.setItem(ENABLED_KEY, enabled ? '1' : '0'); } catch { /* ignore */ }
};
