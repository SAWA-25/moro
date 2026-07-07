import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
    buildShopCompanionPrompt,
    buildShopCoPresenceLogEntry,
    buildShopCoPresencePaymentNotice,
    buildShopCompanionSpeechPrompt,
    getShopCoPresenceCue,
    pickShopCompanionFallbackItem,
    resolveShopCompanionVisibleItems,
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
        expect(p.user).toContain('选品脚本原则');
        expect(p.user).toContain('自己挑真正想看/想要/想送的一件');
        expect(p.user).toContain('完整角色设定、审美、习惯、雷点、关系和当下心情');
        expect(p.user).toContain('steps 就是这次陪逛带看的执行脚本');
        expect(p.user).toContain('你为什么被这件商品吸引');
        expect(p.user).toContain('itemId 必须来自屏幕上可见商品');
        expect(p.user).toContain('强制付款触发状态');
        expect(p.user).toContain('本轮不允许强势结账');
        expect(p.user).toContain('char_pay');
        expect(p.user).toContain('auto_user_pay');
        expect(p.user).toContain('steps');
    });

    it('keeps an explicitly empty companion shelf empty in prompts', () => {
        const p = buildShopCompanionPrompt(
            { name: '阿白', personaText: '喜欢甜食', affection: 70 },
            '我',
            { surface: 'cart', visibleItems: [], cart: [], userAction: '打开空篮子' },
        );

        expect(p.user).toContain('（当前界面没有可见商品）');
        expect(p.user).toContain('只能输出 "say" 动作');
        expect(p.user).not.toContain('- rose |');
        expect(p.user).not.toContain('- camera |');
    });

    it('resolves companion visible items from the target surface state', () => {
        const rose = getShopItem('rose')!;
        const cake = getShopItem('cake')!;
        const camera = getShopItem('camera')!;
        const catalog = [rose, cake, camera];

        expect(resolveShopCompanionVisibleItems({ catalog, surface: 'cart', cart: [] })).toEqual([]);
        expect(resolveShopCompanionVisibleItems({ catalog, surface: 'my' })).toEqual([]);
        expect(resolveShopCompanionVisibleItems({ catalog, surface: 'home', homeCategory: 'food' }).map(item => item.id)).toEqual(['cake']);
        expect(resolveShopCompanionVisibleItems({ catalog, surface: 'home', search: '拍立得' }).map(item => item.id)).toEqual(['camera']);
        expect(resolveShopCompanionVisibleItems({ catalog, surface: 'category', categoryCategory: 'tech' }).map(item => item.id)).toEqual(['camera']);
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

    it('keeps companion item actions on the currently visible shelf', () => {
        const got = parseShopCompanionScript(
            JSON.stringify({ steps: [{ action: 'open_item', itemId: 'camera', speech: '看这个。' }] }),
            'rose',
            ['rose'],
        );
        expect(got).toEqual({ steps: [{ action: 'open_item', itemId: 'rose', speech: '看这个。' }] });
        expect(parseShopCompanionReaction('{"action":"want","itemId":"camera","speech":"这个。"}', undefined, ['rose'])).toBeNull();
    });

    it('rejects item actions when the current visible shelf is explicitly empty', () => {
        expect(parseShopCompanionScript(
            JSON.stringify({ steps: [{ action: 'open_item', itemId: 'rose', speech: '看这个。' }] }),
            undefined,
            [],
        )).toBeNull();
        expect(parseShopCompanionScript(
            JSON.stringify({ steps: [{ action: 'open_item', itemId: 'camera', speech: '看这个。' }] }),
            'rose',
            [],
        )).toBeNull();
        expect(parseShopCompanionReaction('{"action":"want","itemId":"rose","speech":"这个。"}', undefined, [])).toBeNull();
    });

    it('picks a deterministic companion fallback from visible items only', () => {
        const rose = getShopItem('rose')!;
        const cake = getShopItem('cake')!;
        const picked = pickShopCompanionFallbackItem([rose, cake], { name: '阿白', personaText: '喜欢甜食', affection: 70 });
        expect([rose.id, cake.id]).toContain(picked?.id);
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

    it('builds a free-chat prompt for the in-shop companion dialogue sheet', () => {
        const rose = getShopItem('rose')!;
        const cake = getShopItem('cake')!;
        const prompt = buildShopCompanionSpeechPrompt(
            { name: '阿白', personaText: '完整角色设定：嘴硬心软，喜欢甜食', affection: 72 },
            '小雨',
            'free_chat',
            {
                surface: 'item',
                item: rose,
                visibleItems: [rose, cake],
                cart: [{ itemId: 'cake', qty: 1 }],
                userAction: '用户在陪逛对话里说：这件适合我吗？',
            },
            '完整用户设定：小雨怕浪费钱',
        );
        expect(prompt.system).toContain('完整角色设定');
        expect(prompt.system).toContain('完整用户设定');
        expect(prompt.user).toContain('free_chat');
        expect(prompt.user).toContain('心意铺内同屏陪逛对话');
        expect(prompt.user).toContain('用户在陪逛对话里说');
        expect(prompt.user).toContain('屏幕上可见商品');
        expect(prompt.user).toContain('草莓蛋糕×1');
        expect(prompt.user).toContain('只输出一句角色回复');
    });

    it('buildShopCompanionPrompt constrains forced payment to repeated refusal pressure', () => {
        const rose = getShopItem('rose')!;
        const prompt = buildShopCompanionPrompt(
            { name: '阿白', personaText: '完整角色设定：喜欢仪式感', affection: 80 },
            '小雨',
            {
                surface: 'item',
                item: rose,
                visibleItems: [rose],
                cart: [],
                userAction: '用户拒绝后滑到别的商品',
                paymentPressure: {
                    declinedCount: 3,
                    lastDeclinedItemName: '草莓蛋糕',
                    viewedOtherItemAfterDecline: true,
                    forcedPayEligible: true,
                    forcedPayChancePct: 52,
                },
            },
            '完整用户设定：小雨怕浪费钱',
        );
        expect(prompt.user).toContain('用户已连续拒绝 3 次');
        expect(prompt.user).toContain('刚拒绝的是「草莓蛋糕」');
        expect(prompt.user).toContain('已经滑开/看了别的商品');
        expect(prompt.user).toContain('允许小概率强势结账');
        expect(prompt.user).toContain('"auto_user_pay" 只允许在用户连续拒绝');
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

    it('ShopApp gates co-presence product marks behind the active companion session', () => {
        const source = readFileSync('apps/ShopApp.tsx', 'utf8');
        expect(source).toContain('const companionSessionRef = useRef(0)');
        expect(source).toContain('const requestSession = companionSessionRef.current');
        expect(source).toContain('if (!isCurrentSession()) return;');
        expect(source).toContain('const activeCompanionCue = companion ? companionCue : null');
        expect(source).toContain('companionCue={activeCompanionCue} companionAvatar={activeCompanionAvatar}');
        expect(source).toContain('companionSessionRef.current === stopSession && line');
    });

    it('ShopApp computes companion shelves from target navigation state', () => {
        const source = readFileSync('apps/ShopApp.tsx', 'utf8');
        expect(source).toContain('resolveShopCompanionVisibleItems({');
        expect(source).toContain('visibleItemsForCompanion(undefined, { tab: t })');
        expect(source).toContain("visibleItemsForCompanion(undefined, { tab: 'home', cat: next })");
        expect(source).toContain("visibleItemsForCompanion(undefined, { tab: 'category', categoryTabCat: next })");
        expect(source).toContain('activeCategory={categoryTabCat} onCategoryChange={setCategoryPageCategory}');
    });

    it('ShopApp opens the payment request when the companion only says they want an item', () => {
        const source = readFileSync('apps/ShopApp.tsx', 'utf8');
        const start = source.indexOf("if (step.action === 'want')");
        const end = source.indexOf("if (step.action === 'ask_user_pay')");
        expect(start).toBeGreaterThan(-1);
        expect(end).toBeGreaterThan(start);
        const block = source.slice(start, end);
        expect(block).toContain('setCompanionRequest({ charId: char.id, item, speech })');
        expect(block).not.toContain('updateCharacter(char.id, { shopCart: addToCart(char.shopCart, item.id) })');
    });

    it('ShopApp lets auto_user_pay go directly to payment instead of the hijack confirmation', () => {
        const source = readFileSync('apps/ShopApp.tsx', 'utf8');
        const start = source.indexOf("if (step.action === 'auto_user_pay')");
        const end = source.indexOf("if (step.action === 'char_pay')");
        expect(start).toBeGreaterThan(-1);
        expect(end).toBeGreaterThan(start);
        const block = source.slice(start, end);
        expect(block).toContain('shouldTriggerCompanionForcedPay(char, item)');
        expect(block).toContain('await companionAutoUserPay(char, item, speech)');
        expect(block).not.toContain('waitForCompanionHijack');
    });
});
