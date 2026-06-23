import { describe, it, expect } from 'vitest';
import { extractWithdrawDirective } from './messageWithdraw';

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
