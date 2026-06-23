import { describe, it, expect, beforeEach } from 'vitest';
import {
    recordUserUnlockFail, getRecentUserUnlockFails, clearUserUnlockFails,
    formatUserFailsForPrompt, buildUserFailAwareness,
    recordCharUnlockFail, consumeCharUnlockReminders, peekCharUnlockReminders,
} from './lockAttempts';

beforeEach(() => {
    try { localStorage.clear(); } catch { /* ignore */ }
});

describe('用户试错（→ 角色感知）', () => {
    it('记录并按时间窗口取回', () => {
        const now = 1_000_000_000_000;
        recordUserUnlockFail(now - 60_000);        // 1 分钟前
        recordUserUnlockFail(now - 20 * 3600_000);  // 20 小时前（超 12h 窗口）
        const recent = getRecentUserUnlockFails(12 * 3600_000, now);
        expect(recent.length).toBe(1);
    });

    it('clear 清空', () => {
        recordUserUnlockFail();
        clearUserUnlockFails();
        expect(getRecentUserUnlockFails()).toEqual([]);
    });

    it('formatUserFailsForPrompt：无失败返回空串', () => {
        expect(formatUserFailsForPrompt([])).toBe('');
    });

    it('formatUserFailsForPrompt：含次数与相对时间', () => {
        const now = 2_000_000_000_000;
        const s = formatUserFailsForPrompt([now - 120_000, now - 60_000], now);
        expect(s).toContain('2 次');
        expect(s).toContain('1 分钟前');
        expect(s).toContain('手机动静');
    });

    it('buildUserFailAwareness 端到端', () => {
        const now = 3_000_000_000_000;
        recordUserUnlockFail(now - 30_000);
        const s = buildUserFailAwareness(12 * 3600_000, now);
        expect(s).toContain('输错锁屏密码 1 次');
    });
});

describe('角色试错（→ 用户提醒）', () => {
    it('记录并消费即清空', () => {
        recordCharUnlockFail('阿狸', 'c1', 111);
        recordCharUnlockFail('小蓝', 'c2', 222);
        expect(peekCharUnlockReminders().length).toBe(2);
        const consumed = consumeCharUnlockReminders();
        expect(consumed.map(r => r.name)).toEqual(['阿狸', '小蓝']);
        expect(peekCharUnlockReminders()).toEqual([]); // 消费后清空
    });

    it('无事件时消费返回空', () => {
        expect(consumeCharUnlockReminders()).toEqual([]);
    });
});
