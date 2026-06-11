/**
 * 人设系统 —— SillyTavern Persona Management 的 Moro 移植。
 *
 * 与 ST 的对应关系：
 *  - power_user.personas / persona_descriptions → IndexedDB `personas` store（Persona 记录）
 *  - user_avatar（当前人设）                    → localStorage os_active_persona_id
 *  - default_persona                            → localStorage os_default_persona_id
 *  - 角色锁（connections）                       → Persona.connections，进聊天时自动切换
 *  - persona_description_position / depth / role → Persona.position / depth / role，
 *    由 buildChatRequestPayload 解析（IN_PROMPT 进核心上下文，AT_DEPTH 插历史，NONE 不注入）
 *  - persona lorebook                           → Persona.lorebookCategory（世界书分组名），
 *    经 WorldbookRuntime.setExtraCategories 在主聊天链路注入
 *
 * 激活人设时把 name/avatar/description 同步写入 UserProfile（档案）——
 * 聊天气泡头像、群聊、Instant Push 等所有读 userProfile 的链路立即生效；
 * 位置/深度等高级语义只影响主聊天 prompt 组装。
 */

import type { Persona, PersonaConnection } from '../types';
import { PERSONA_POSITION } from '../types';
import { DB } from './db';

const ACTIVE_ID_KEY = 'os_active_persona_id';
const DEFAULT_ID_KEY = 'os_default_persona_id';

/** 位置选项（UI 用）。ST 的作者注释位（2/3）在 Moro 无对应锚点，归一到 IN_PROMPT */
export const PERSONA_POSITION_OPTIONS: { value: number; label: string; hint: string }[] = [
    { value: PERSONA_POSITION.IN_PROMPT, label: '嵌入提示词', hint: '进核心上下文的「互动对象」块；启用预设时落在 Persona Description 占位（ST: In Prompt）' },
    { value: PERSONA_POSITION.AT_DEPTH, label: '@Depth 注入', hint: '以指定 role 插到聊天历史的对应深度（ST: In Chat @Depth）' },
    { value: PERSONA_POSITION.NONE, label: '不注入', hint: '描述不进 prompt，名字仍然生效（ST: None）' },
];

/** 兼容 ST 备份里的 1（已废弃）/ 2 / 3（作者注释）：Moro 无对应锚点，按嵌入提示词处理 */
export function normalizePersonaPosition(position: number | undefined): number {
    if (position === PERSONA_POSITION.AT_DEPTH || position === PERSONA_POSITION.NONE) return position;
    return PERSONA_POSITION.IN_PROMPT;
}

export function createPersona(partial: Partial<Persona> & { name: string; avatar: string }): Persona {
    const now = Date.now();
    // 过滤显式 undefined：复制（id: undefined）/ 恢复（缺字段的旧备份）时
    // 不能让 undefined 覆盖生成的默认值
    const clean = Object.fromEntries(
        Object.entries(partial).filter(([, v]) => v !== undefined),
    ) as Partial<Persona> & { name: string; avatar: string };
    return {
        id: `persona-${now}-${Math.random().toString(36).slice(2, 9)}`,
        description: '',
        position: PERSONA_POSITION.IN_PROMPT,
        depth: 2,
        role: 0,
        createdAt: now,
        updatedAt: now,
        ...clean,
    };
}

/**
 * 按 ST 的自动选择优先级挑选进入某个聊天时应当激活的人设：
 * 绑定（connections 命中当前角色/群）> 默认人设 > 维持当前激活。
 * 纯函数，便于测试；返回 null 表示「不切换」。
 */
export function pickPersonaForConnection(
    personas: Persona[],
    conn: PersonaConnection,
    activeId: string | null,
    defaultId: string | null,
): Persona | null {
    const isConnected = (p: Persona) =>
        (p.connections || []).some(c => c.type === conn.type && c.id === conn.id);

    const active = activeId ? personas.find(p => p.id === activeId) : undefined;
    // 当前激活的就绑定在这个聊天上 → 不动
    if (active && isConnected(active)) return null;

    const locked = personas.find(isConnected);
    if (locked) return locked;

    // 没有绑定时回落默认人设（同 ST：无锁聊天用 default persona）
    if (defaultId && defaultId !== activeId) {
        const def = personas.find(p => p.id === defaultId);
        if (def) return def;
    }
    return null;
}

export const PersonaRuntime = {
    getActiveId(): string | null {
        try { return localStorage.getItem(ACTIVE_ID_KEY); } catch { return null; }
    },
    setActiveId(id: string | null): void {
        try {
            if (id) localStorage.setItem(ACTIVE_ID_KEY, id);
            else localStorage.removeItem(ACTIVE_ID_KEY);
        } catch { /* ignore */ }
    },
    getDefaultId(): string | null {
        try { return localStorage.getItem(DEFAULT_ID_KEY); } catch { return null; }
    },
    setDefaultId(id: string | null): void {
        try {
            if (id) localStorage.setItem(DEFAULT_ID_KEY, id);
            else localStorage.removeItem(DEFAULT_ID_KEY);
        } catch { /* ignore */ }
    },

    /** 当前激活的人设记录（无激活 / 已被删除时返回 null，调用方回落 userProfile） */
    async getActivePersona(): Promise<Persona | null> {
        const id = PersonaRuntime.getActiveId();
        if (!id) return null;
        try {
            return (await DB.getPersona(id)) ?? null;
        } catch (e) {
            console.error('[Personas] 读取激活人设失败:', e);
            return null;
        }
    },

    /**
     * 进入某个角色/群的聊天时调用：按 绑定 > 默认 的优先级决定是否自动切换人设。
     * 返回需要切换到的人设（调用方负责写 userProfile + setActiveId），不需要切换时返回 null。
     */
    async resolveForConnection(conn: PersonaConnection): Promise<Persona | null> {
        try {
            const personas = await DB.getAllPersonas();
            if (personas.length === 0) return null;
            return pickPersonaForConnection(
                personas,
                conn,
                PersonaRuntime.getActiveId(),
                PersonaRuntime.getDefaultId(),
            );
        } catch (e) {
            console.error('[Personas] 解析聊天人设失败:', e);
            return null;
        }
    },
};
