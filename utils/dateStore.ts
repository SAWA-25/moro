/**
 * 街角 · 约会世界线存储 (localStorage)
 * 多世界线 = 同一角色下多条 DateWorldline，可分叉（fork）出新剧情走向。
 * 每条世界线靠 20 回合总结 + 隐藏上文保持体量有界，localStorage 足矣。
 */

import { DateScene, DateWorldline, DateMessage } from '../types';

const KEY = (charId: string) => `moro_date_worldlines_${charId}`;
const genId = () => `wl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const msgId = () => `dm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export function listWorldlines(charId: string): DateWorldline[] {
    try {
        const raw = localStorage.getItem(KEY(charId));
        const arr = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(arr)) return [];
        return arr.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    } catch { return []; }
}

function writeAll(charId: string, list: DateWorldline[]): void {
    try { localStorage.setItem(KEY(charId), JSON.stringify(list)); }
    catch (e) { console.warn('[dateStore] write failed:', e); }
}

export function getWorldline(charId: string, id: string): DateWorldline | null {
    return listWorldlines(charId).find(w => w.id === id) || null;
}

/** upsert 一条世界线（按 id） */
export function saveWorldline(wl: DateWorldline): void {
    const list = listWorldlines(wl.charId).filter(w => w.id !== wl.id);
    list.push({ ...wl, updatedAt: Date.now() });
    writeAll(wl.charId, list);
}

export function createWorldline(charId: string, scene: DateScene): DateWorldline {
    const now = Date.now();
    const opening: DateMessage[] = scene.opening
        ? [{ id: msgId(), role: 'world', action: scene.opening, ts: now }]
        : [];
    const wl: DateWorldline = {
        id: genId(),
        charId,
        sceneId: scene.id,
        sceneName: scene.name,
        sceneEmoji: scene.emoji,
        vibe: scene.vibe,
        title: `${scene.emoji} ${scene.name}`,
        createdAt: now,
        updatedAt: now,
        turnCount: 0,
        messages: opening,
    };
    saveWorldline(wl);
    return wl;
}

/** 从某条世界线在第 atTurn 条消息处分叉出一条新世界线（复制到该点为止的消息） */
export function forkWorldline(source: DateWorldline, atMessageIndex: number): DateWorldline {
    const now = Date.now();
    const cut = Math.max(0, Math.min(source.messages.length, atMessageIndex + 1));
    const copied = source.messages.slice(0, cut).map(m => ({ ...m }));
    const wl: DateWorldline = {
        ...source,
        id: genId(),
        title: `${source.title}・分叉`,
        createdAt: now,
        updatedAt: now,
        messages: copied,
        // turnCount 按复制下来的用户回合重新估；侧幕描写可能没有 char 消息。
        turnCount: copied.filter(m => m.role === 'user').length,
        parentId: source.id,
        forkedAtTurn: source.turnCount,
        // BGM 不继承（氛围会因分叉而不同）
        bgmAssetKey: undefined,
        bgmVibe: undefined,
    };
    saveWorldline(wl);
    return wl;
}

export function deleteWorldline(charId: string, id: string): void {
    writeAll(charId, listWorldlines(charId).filter(w => w.id !== id));
}

export function renameWorldline(charId: string, id: string, title: string): void {
    const list = listWorldlines(charId);
    const wl = list.find(w => w.id === id);
    if (!wl) return;
    wl.title = title.trim() || wl.title;
    wl.updatedAt = Date.now();
    writeAll(charId, list);
}

export const newDateMessageId = msgId;
