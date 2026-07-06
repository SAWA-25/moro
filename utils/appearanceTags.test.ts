import { describe, it, expect } from 'vitest';
import { buildAppearanceSourceText, normalizeTags } from './appearanceTags';
import { CharacterProfile } from '../types';

const baseChar = (over: Partial<CharacterProfile>): CharacterProfile => ({
    id: 'c1', name: '阿狸', avatar: '', description: '', systemPrompt: '',
    ...over,
} as CharacterProfile);

describe('buildAppearanceSourceText', () => {
    it('拼入完整角色设定与已启用的绑定世界书', () => {
        const char = baseChar({
            description: '银发红瞳的少女',
            systemPrompt: '设定正文',
            mountedWorldbooks: [
                { id: 'w1', title: '外貌', content: '常穿黑色长外套', enabled: true },
                { id: 'w2', title: '禁用条', content: '不该出现', enabled: false },
            ],
        });
        const text = buildAppearanceSourceText(char);
        expect(text).toContain('银发红瞳');
        expect(text).toContain('设定正文');
        expect(text).toContain('黑色长外套');
        expect(text).not.toContain('不该出现'); // 禁用条目被过滤
    });

    it('完整角色设定不在外貌辅助入口裁剪', () => {
        const big = 'x'.repeat(5000);
        const char = baseChar({ systemPrompt: big });
        const text = buildAppearanceSourceText(char, 600, 1000);
        expect(text).toContain(big);
        expect(text.length).toBeGreaterThan(1000);
    });

    it('资料很少时仍保留角色名作为最低限度身份锚', () => {
        expect(buildAppearanceSourceText(baseChar({}))).toContain('角色名：阿狸');
    });
});

describe('normalizeTags', () => {
    it('逗号/换行/顿号分隔统一成一行、去重、转小写', () => {
        const out = normalizeTags('Long_Hair, silver eyes\n红瞳、Long_Hair');
        expect(out).toBe('long_hair, silver eyes, 红瞳');
    });

    it('剥离代码块与行首编号/符号/引号', () => {
        const out = normalizeTags('```\n1. "black coat"\n- white_gloves\n```');
        expect(out).toBe('black coat, white_gloves');
    });

    it('空输入返回空串', () => {
        expect(normalizeTags('')).toBe('');
    });
});
