import { describe, it, expect } from 'vitest';
import {
    buildShopCompanionPrompt,
    buildShopCoPresenceLogEntry,
    buildShopCoPresencePaymentNotice,
    buildShopCompanionSpeechPrompt,
    getShopCoPresenceCue,
    parseShopCompanionReaction,
    parseShopCompanionScript,
    parseShopCompanionSpeech,
    getShopItem,
} from './shop';

describe('shop companion helpers', () => {
    it('buildShopCompanionPrompt includes surface, watched item, cart, and visible shelf', () => {
        const rose = getShopItem('rose')!;
        const cake = getShopItem('cake')!;
        const p = buildShopCompanionPrompt(
            { name: '阿白', personaText: '喜欢甜食', affection: 70 },
            '我',
            { surface: 'item', item: rose, visibleItems: [rose, cake], cart: [{ itemId: 'cake', qty: 2 }], userAction: '打开商品详情' },
        );
        expect(p.system).toContain('阿白');
        expect(p.user).toContain('当前界面：item');
        expect(p.user).toContain('rose');
        expect(p.user).toContain('草莓蛋糕×2');
        expect(p.user).toContain('自己挑真正想看/想要/想送的一件');
        expect(p.user).toContain('itemId 必须来自屏幕上可见商品');
        expect(p.user).toContain('char_pay');
        expect(p.user).toContain('auto_user_pay');
        expect(p.user).toContain('steps');
    });

    it('parseShopCompanionReaction parses fenced JSON and validates item actions', () => {
        const got = parseShopCompanionReaction('```json\n{"action":"ask_user_pay","itemId":"rose","speech":"我想要这个。"}\n```');
        expect(got).toEqual({ action: 'ask_user_pay', itemId: 'rose', speech: '我想要这个。' });
        expect(parseShopCompanionReaction('{"action":"want","itemId":"missing","speech":"想要"}')).toBeNull();
    });

    it('parseShopCompanionReaction downgrades unknown actions to comment', () => {
        const got = parseShopCompanionReaction('{"action":"dance","itemId":"rose","speech":"这个好看。"}');
        expect(got).toEqual({ action: 'comment', itemId: 'rose', speech: '这个好看。' });
    });

    it('parseShopCompanionScript accepts multi-step immersive scripts', () => {
        const got = parseShopCompanionScript(JSON.stringify({
            steps: [
                { action: 'say', speech: '陪你看。' },
                { action: 'scroll_to_item', itemId: 'rose', speech: '往上看这个。' },
                { action: 'open_item', itemId: 'cake', speech: '点开看看。' },
                { action: 'auto_user_pay', itemId: 'rose', speech: '我替你点了。' },
            ],
        }));
        expect(got?.steps.map(s => s.action)).toEqual(['say', 'scroll_to_item', 'open_item', 'auto_user_pay']);
        expect(got?.steps[1].itemId).toBe('rose');
    });

    it('parseShopCompanionScript keeps old one-action JSON compatible', () => {
        const got = parseShopCompanionScript('{"action":"want","itemId":"rose","speech":"先记下来。"}');
        expect(got).toEqual({ steps: [{ action: 'want', itemId: 'rose', speech: '先记下来。' }] });
    });

    it('parseShopCompanionScript filters illegal item actions and downgrades unknown actions to say', () => {
        const got = parseShopCompanionScript(JSON.stringify({
            steps: [
                { action: 'scroll_to_item', itemId: 'missing', speech: '不存在。' },
                { action: 'dance', itemId: 'rose', speech: '这个好看。' },
            ],
        }));
        expect(got).toEqual({ steps: [{ action: 'say', itemId: 'rose', speech: '这个好看。' }] });
    });

    it('parseShopCompanionScript limits scripts to five validated steps', () => {
        const got = parseShopCompanionScript(JSON.stringify({
            steps: Array.from({ length: 8 }).map(() => ({ action: 'point', itemId: 'rose', speech: '看这个。' })),
        }));
        expect(got?.steps).toHaveLength(5);
    });

    it('builds a dedicated model prompt for one-off companion speech instead of hardcoded character lines', () => {
        const rose = getShopItem('rose')!;
        const prompt = buildShopCompanionSpeechPrompt(
            { name: '阿白', personaText: '完整角色设定：嘴硬心软，喜欢甜食', affection: 72 },
            '小雨',
            'decline_hijack',
            { surface: 'item', item: rose, userAction: '用户拒绝了强势拦停' },
            '完整用户设定：小雨怕浪费钱',
        );
        expect(prompt.system).toContain('完整角色设定');
        expect(prompt.system).toContain('完整用户设定');
        expect(prompt.user).toContain('decline_hijack');
        expect(prompt.user).toContain('用户拒绝了强势拦停');
        expect(prompt.user).toContain('只输出 JSON');
        expect(prompt.user).toContain('speech');
        expect(prompt.user).toContain('不要用固定模板');

        expect(parseShopCompanionSpeech('```json\n{"speech":"那好，我陪你再看一圈。"}\n```')).toBe('那好，我陪你再看一圈。');
        expect(parseShopCompanionSpeech('{"speech":""}', '先停一下。')).toBe('先停一下。');
    });

    it('maps companion actions to video-style co-presence cue copy', () => {
        expect(getShopCoPresenceCue('point', '燃')).toMatchObject({
            eyebrow: 'CO-PRESENCE',
            title: 'TA 正在盯这件',
            locked: false,
        });
        expect(getShopCoPresenceCue('want', '燃')).toMatchObject({
            eyebrow: 'NEW',
            title: 'TA 记住了这件',
            locked: false,
        });
        expect(getShopCoPresenceCue('auto_user_pay', '燃')).toMatchObject({
            eyebrow: 'HIJACK',
            title: '燃，不想让你滑过去',
            locked: true,
        });
    });

    it('builds payment notice and shopping log entries for the co-presence overlay', () => {
        const item = getShopItem('rose')!;
        const notice = buildShopCoPresencePaymentNotice(item, 'char', '放这儿，别躲。');
        expect(notice.eyebrow).toBe('PAYMENT NOTICE');
        expect(notice.title).toBe('支付凭证');
        expect(notice.account).toBe('角色私人账户');
        expect(notice.amount).toBe(item.price);
        expect(notice.message).toBe('放这儿，别躲。');

        const log = buildShopCoPresenceLogEntry('char_pay', item, '放这儿，别躲。');
        expect(log.eyebrow).toBe('PAYMENT NOTIFICATION');
        expect(log.title).toBe(item.name);
        expect(log.detail).toBe('放这儿，别躲。');
    });
});
