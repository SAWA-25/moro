import { describe, it, expect } from 'vitest';
import { substituteMacros } from './macros';

const CTX = { charName: '小明', userName: '阿罗' };

describe('substituteMacros', () => {
    it('替换 {{char}} / {{user}}，大小写不敏感', () => {
        expect(substituteMacros('{{char}}和{{user}}', CTX)).toBe('小明和阿罗');
        expect(substituteMacros('{{CHAR}}和{{User}}', CTX)).toBe('小明和阿罗');
    });

    it('支持 ST 旧版 <char> / <user> / <bot> 标记', () => {
        expect(substituteMacros('<char>对<user>说', CTX)).toBe('小明对阿罗说');
        expect(substituteMacros('<BOT>在线', CTX)).toBe('小明在线');
        expect(substituteMacros('<USER>你好', CTX)).toBe('阿罗你好');
    });

    it('未知宏与普通标签原样保留', () => {
        expect(substituteMacros('{{unknown}}<div>{{char}}</div>', CTX)).toBe('{{unknown}}<div>小明</div>');
    });

    it('{{newline}} 替换为换行', () => {
        expect(substituteMacros('a{{newline}}b', CTX)).toBe('a\nb');
    });

    it('空串直接返回', () => {
        expect(substituteMacros('', CTX)).toBe('');
    });
});
