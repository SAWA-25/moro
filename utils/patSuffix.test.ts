import { describe, it, expect } from 'vitest';
import { extractPatSuffixDirective, extractPatDirective } from './patSuffix';

describe('extractPatSuffixDirective', () => {
    it('剥离 [[PAT_SUFFIX: 小脑袋]] 并返回后缀', () => {
        const r = extractPatSuffixDirective('我改个后缀 [[PAT_SUFFIX: 小脑袋]]');
        expect(r.suffix).toBe('小脑袋');
        expect(r.content).toBe('我改个后缀');
    });
    it('中文冒号 + 截断到 20 字', () => {
        expect(extractPatSuffixDirective('[[PAT_SUFFIX：狗头]]').suffix).toBe('狗头');
    });
    it('无指令时 suffix=null', () => {
        expect(extractPatSuffixDirective('普通').suffix).toBeNull();
    });
});

describe('extractPatDirective', () => {
    it('命中 [[PAT]] 时 pat=true 并剥离', () => {
        const r = extractPatDirective('来 [[PAT]]');
        expect(r.pat).toBe(true);
        expect(r.content).toBe('来');
    });
    it('不把 [[PAT_SUFFIX: x]] 误判为 [[PAT]]', () => {
        const r = extractPatDirective('[[PAT_SUFFIX: 头]]');
        expect(r.pat).toBe(false);
        expect(r.content).toContain('[[PAT_SUFFIX: 头]]');
    });
    it('无指令时 pat=false', () => {
        expect(extractPatDirective('普通').pat).toBe(false);
    });
});
