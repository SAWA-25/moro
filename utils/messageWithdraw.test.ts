import { describe, it, expect } from 'vitest';
import { extractWithdrawDirective, stripFakeWithdrawNotice } from './messageWithdraw';

describe('extractWithdrawDirective', () => {
    it('命中 [[WITHDRAW]] 时剥离指令并返回 withdraw=true', () => {
        const r = extractWithdrawDirective('啊，当我没说\n[[WITHDRAW]]');
        expect(r.withdraw).toBe(true);
        expect(r.content).toBe('啊，当我没说');
    });

    it('大小写 / 空格不敏感', () => {
        expect(extractWithdrawDirective('[[ withdraw ]]').withdraw).toBe(true);
        expect(extractWithdrawDirective('[[Withdraw]]').withdraw).toBe(true);
    });

    it('没有指令时原样返回、withdraw=false', () => {
        const r = extractWithdrawDirective('正常说话，没有指令');
        expect(r.withdraw).toBe(false);
        expect(r.content).toBe('正常说话，没有指令');
    });

    it('空串安全', () => {
        const r = extractWithdrawDirective('');
        expect(r.withdraw).toBe(false);
        expect(r.content).toBe('');
    });

    it('不会把记忆指令 [[RECALL: 2024-05]] 误判为撤回', () => {
        const r = extractWithdrawDirective('我想想那个月 [[RECALL: 2024-05]]');
        expect(r.withdraw).toBe(false);
        expect(r.content).toContain('[[RECALL: 2024-05]]');
    });
});

describe('stripFakeWithdrawNotice（模型自己打字模仿系统撤回播报的兜底）', () => {
    it('剥掉「条新消息 + 【系统消息】X + 撤回了一条消息」三件套，只留打岔台词', () => {
        const raw = '条新消息\n【系统消息】流浪者\n撤回了一条消息\n啊，当我没说。你刚才什么都没看到吧？';
        const r = stripFakeWithdrawNotice(raw, '流浪者');
        expect(r.withdraw).toBe(true);
        expect(r.content).toBe('啊，当我没说。你刚才什么都没看到吧？');
        expect(r.content).not.toContain('撤回');
        expect(r.content).not.toContain('系统');
    });

    it('系统标记与撤回在同一行也命中', () => {
        const r = stripFakeWithdrawNotice('【系统消息】流浪者撤回了一条消息\n啊，当我没说', '流浪者');
        expect(r.withdraw).toBe(true);
        expect(r.content).toBe('啊，当我没说');
    });

    it('纯系统口吻「对方撤回了一条消息」即使没有系统标记也命中', () => {
        const r = stripFakeWithdrawNotice('对方撤回了一条消息\n刚才发错了', '某人');
        expect(r.withdraw).toBe(true);
        expect(r.content).toBe('刚才发错了');
    });

    it('「<角色名>撤回了一条消息」单行命中（按传入角色名识别）', () => {
        const r = stripFakeWithdrawNotice('流浪者 撤回了一条消息', '流浪者');
        expect(r.withdraw).toBe(true);
        expect(r.content).toBe('');
    });

    it('不误伤正常叙述里出现的「撤回」字样', () => {
        const raw = '我刚想撤回那句话，但还是算了，就这样吧。';
        const r = stripFakeWithdrawNotice(raw, '流浪者');
        expect(r.withdraw).toBe(false);
        expect(r.content).toBe(raw);
    });

    it('没有任何撤回字样时原样返回', () => {
        const r = stripFakeWithdrawNotice('今天天气真好，一起出去走走？', '流浪者');
        expect(r.withdraw).toBe(false);
        expect(r.content).toBe('今天天气真好，一起出去走走？');
    });
});
