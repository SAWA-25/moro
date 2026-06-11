import { describe, it, expect } from 'vitest';
import { pickPersonaForConnection, normalizePersonaPosition, createPersona } from './personas';
import { PERSONA_POSITION, Persona } from '../types';

const mk = (id: string, connections: Persona['connections'] = undefined): Persona =>
    createPersona({ name: id, avatar: '', id, connections } as any);

const conn = { type: 'character' as const, id: 'char-1' };

describe('pickPersonaForConnection（ST 自动选择优先级：绑定 > 默认 > 不切换）', () => {
    it('角色绑定的人设优先', () => {
        const personas = [mk('a'), mk('b', [conn])];
        expect(pickPersonaForConnection(personas, conn, 'a', null)?.id).toBe('b');
    });

    it('当前激活的就绑定在该角色上 → 不切换', () => {
        const personas = [mk('a', [conn]), mk('b')];
        expect(pickPersonaForConnection(personas, conn, 'a', 'b')).toBeNull();
    });

    it('无绑定时回落默认人设', () => {
        const personas = [mk('a'), mk('b')];
        expect(pickPersonaForConnection(personas, conn, 'a', 'b')?.id).toBe('b');
    });

    it('默认人设已是当前激活 → 不切换', () => {
        const personas = [mk('a'), mk('b')];
        expect(pickPersonaForConnection(personas, conn, 'b', 'b')).toBeNull();
    });

    it('无绑定也无默认 → 不切换', () => {
        const personas = [mk('a'), mk('b')];
        expect(pickPersonaForConnection(personas, conn, 'a', null)).toBeNull();
    });

    it('群绑定与角色绑定按 type 区分', () => {
        const groupConn = { type: 'group' as const, id: 'char-1' };
        const personas = [mk('a', [groupConn])];
        // 同 id 但 type=group，不应命中 character 连接
        expect(pickPersonaForConnection(personas, conn, null, null)).toBeNull();
        expect(pickPersonaForConnection(personas, groupConn, null, null)?.id).toBe('a');
    });
});

describe('normalizePersonaPosition（ST 数值兼容）', () => {
    it('保留 IN_PROMPT / AT_DEPTH / NONE', () => {
        expect(normalizePersonaPosition(PERSONA_POSITION.IN_PROMPT)).toBe(0);
        expect(normalizePersonaPosition(PERSONA_POSITION.AT_DEPTH)).toBe(4);
        expect(normalizePersonaPosition(PERSONA_POSITION.NONE)).toBe(9);
    });

    it('ST 的作者注释位（2/3）与废弃位（1）/ 未知值归一为 IN_PROMPT', () => {
        expect(normalizePersonaPosition(1)).toBe(0);
        expect(normalizePersonaPosition(2)).toBe(0);
        expect(normalizePersonaPosition(3)).toBe(0);
        expect(normalizePersonaPosition(undefined)).toBe(0);
        expect(normalizePersonaPosition(42)).toBe(0);
    });
});

describe('createPersona', () => {
    it('补全默认字段（位置=嵌入提示词，深度 2，role=system）', () => {
        const p = createPersona({ name: 'x', avatar: '' });
        expect(p.position).toBe(PERSONA_POSITION.IN_PROMPT);
        expect(p.depth).toBe(2);
        expect(p.role).toBe(0);
        expect(p.id).toMatch(/^persona-/);
    });

    it('显式 undefined 不覆盖生成的默认值（复制人设场景）', () => {
        const p = createPersona({ name: 'x', avatar: '', id: undefined, connections: undefined } as any);
        expect(p.id).toMatch(/^persona-/);
        expect(p.position).toBe(PERSONA_POSITION.IN_PROMPT);
    });
});
