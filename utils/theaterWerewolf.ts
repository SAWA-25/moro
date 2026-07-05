/**
 * 折子戏·狼人杀（捌）——引擎。
 * ================================
 * 拉一桌熟人开一局狼人杀：user 与选中的角色各占一座，AI 玩家按各自隐藏身份
 * 在夜里行动（狼刀 / 预言家查验 / 女巫用药 / 守卫守护）、白天发言、投票放逐。
 *
 * 本文件只管「规则 + 牌桌状态的纯函数」与「三类 AI 调用」（夜晚结算 / 白天发言 / 投票）；
 * UI 流程（逐步收集 user 行动、落库、动画）在 apps/theater/WerewolfApp.tsx。
 * 复用主/副 API（调用方用 resolveAuxApi 解析好），AI 解析失败时本文件用启发式兜底、绝不卡死。
 * 📌 全部 prompt 文案集中在 utils/theaterPrompts.ts（[捌] 狼人杀 区段），改文案去那里。
 */

import { CharacterProfile, WerewolfGame, WerewolfPlayer, WerewolfRole, WerewolfLogEntry } from '../types';
import type { ResolvedApi } from './auxApi';
import { extractContent, extractJson } from './safeApi';
import { callChatCompletion } from './llmClient';
import { makeApiUsageMeta } from './apiUsageCatalog';
import { buildFullCharacterSetting } from './characterPromptProfile';
import {
    werewolfRosterText, werewolfNightSys, werewolfNightUser,
    werewolfSpeechSys, werewolfSpeechUser, werewolfVoteSys, werewolfVoteUser,
} from './theaterPrompts';

export const WEREWOLF_ROLE_CN: Record<WerewolfRole, string> = {
    wolf: '狼人', seer: '预言家', witch: '女巫', hunter: '猎人', guard: '守卫', idiot: '白痴', villager: '平民',
};
export const WEREWOLF_ROLE_EMOJI: Record<WerewolfRole, string> = {
    wolf: '🐺', seer: '🔮', witch: '🧪', hunter: '🏹', guard: '🛡️', idiot: '🃏', villager: '🧑‍🌾',
};
export const isWolf = (r: WerewolfRole) => r === 'wolf';

const genId = () => `ww_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const shuffle = <T,>(arr: T[]): T[] => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
};
const pick = <T,>(arr: T[]): T | undefined => arr[Math.floor(Math.random() * arr.length)];

/** 按总人数发牌：6~9 人固定扩展板子，>9 自动扩展（狼≈1/3，五神，余平民）。 */
export function rolesFor(total: number): WerewolfRole[] {
    switch (total) {
        case 4: return ['wolf', 'seer', 'witch', 'villager'];
        case 5: return ['wolf', 'seer', 'witch', 'hunter', 'villager'];
        case 6: return ['wolf', 'wolf', 'seer', 'witch', 'guard', 'idiot'];
        case 7: return ['wolf', 'wolf', 'seer', 'witch', 'guard', 'idiot', 'villager'];
        case 8: return ['wolf', 'wolf', 'seer', 'witch', 'guard', 'idiot', 'hunter', 'villager'];
        case 9: return ['wolf', 'wolf', 'wolf', 'seer', 'witch', 'guard', 'idiot', 'hunter', 'villager'];
    }
    const wolves = Math.max(1, Math.floor(total / 3));
    const roles: WerewolfRole[] = [];
    for (let i = 0; i < wolves; i++) roles.push('wolf');
    roles.push('seer', 'witch', 'guard', 'idiot', 'hunter');
    while (roles.length < total) roles.push('villager');
    return roles.slice(0, total);
}

/** 开局：随机座次 + 随机发牌，user 与所选角色各占一座。 */
export function createWerewolfGame(userName: string, userAvatar: string | undefined, chars: CharacterProfile[]): WerewolfGame {
    const total = chars.length + 1;
    const roles = shuffle(rolesFor(total));
    const seats = shuffle<{ isUser: boolean; name: string; avatar?: string; charId?: string }>([
        { isUser: true, name: userName || '你', avatar: userAvatar },
        ...chars.map(c => ({ isUser: false, name: c.name, avatar: c.avatar, charId: c.id })),
    ]);
    const players: WerewolfPlayer[] = seats.map((s, i) => ({
        seat: i + 1, name: s.name, isUser: s.isUser, charId: s.charId, avatar: s.avatar,
        role: roles[i], alive: true,
    }));
    const now = Date.now();
    return {
        id: genId(),
        title: `${new Date(now).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })} 的一局`,
        createdAt: now, lastActiveAt: now,
        players, round: 1, phase: 'night', log: [],
        witchHealUsed: false, witchPoisonUsed: false, lastGuardedSeat: null, pendingKill: null, winner: null,
    };
}

/** 旧存档补齐新增字段；不改 IndexedDB 结构，读出来时兼容即可。 */
export function normalizeWerewolfGame(g: WerewolfGame): WerewolfGame {
    return {
        ...g,
        lastGuardedSeat: g.lastGuardedSeat ?? null,
        pendingKill: g.pendingKill ?? null,
        winner: g.winner ?? null,
        players: g.players.map(p => ({
            ...p,
            idiotRevealed: p.idiotRevealed ?? false,
        })),
    };
}

// ── 牌桌读函数 ──────────────────────────────────────────────────────────────
export const playerBySeat = (g: WerewolfGame, seat: number) => g.players.find(p => p.seat === seat);
export const userPlayer = (g: WerewolfGame) => g.players.find(p => p.isUser);
export const livingPlayers = (g: WerewolfGame) => g.players.filter(p => p.alive);
export const livingWolves = (g: WerewolfGame) => g.players.filter(p => p.alive && p.role === 'wolf');
export const livingGood = (g: WerewolfGame) => g.players.filter(p => p.alive && p.role !== 'wolf');
export const votingPlayers = (g: WerewolfGame) => g.players.filter(p => p.alive && !p.idiotRevealed);
export const voteTargetPlayers = (g: WerewolfGame, voterSeat?: number) =>
    g.players.filter(p => p.alive && !p.idiotRevealed && p.seat !== voterSeat);
export const guardablePlayers = (g: WerewolfGame) =>
    livingPlayers(g).filter(p => p.seat !== (g.lastGuardedSeat ?? null));
export const canGuardSeat = (g: WerewolfGame, seat: number) =>
    guardablePlayers(g).some(p => p.seat === seat);
export const voteTargetSeat = (g: WerewolfGame, seat: any, voterSeat?: number): number | null => {
    const n = Number(seat);
    return Number.isFinite(n) && voteTargetPlayers(g, voterSeat).some(p => p.seat === n) ? n : null;
};

/** 胜负判定：狼全灭＝好人胜；存活狼≥存活好人＝狼胜；否则继续。 */
export function checkWinner(g: WerewolfGame): 'good' | 'wolf' | null {
    const w = livingWolves(g).length;
    const good = livingGood(g).length;
    if (w === 0) return 'good';
    if (w >= good) return 'wolf';
    return null;
}

let logSeq = 0;
export function mkLog(round: number, kind: WerewolfLogEntry['kind'], text: string, extra?: Partial<WerewolfLogEntry>): WerewolfLogEntry {
    return { round, kind, text, at: Date.now() + (logSeq++ % 1000), ...extra };
}

/** 给 prompt 用的公开局势文本（剔除仅 user 可见的私密项，按时间，末尾截断）。 */
export function publicLogText(g: WerewolfGame, limit = 40): string {
    const lines = g.log
        .filter(e => !e.privateToUser && (e.kind === 'speech' || e.kind === 'vote' || e.kind === 'death' || e.kind === 'result'))
        .slice(-limit)
        .map(e => {
            const who = e.name ? `${e.seat}号 ${e.name}` : '';
            if (e.kind === 'speech') return `第${e.round}天 ${who}：${e.text}`;
            if (e.kind === 'vote') return `[投票] ${e.text}`;
            return e.text;
        });
    return lines.join('\n');
}

const personaOf = (p: WerewolfPlayer, chars: CharacterProfile[], userSetting?: string) => {
    if (p.isUser) return userSetting || '';
    const char = chars.find(c => c.id === p.charId);
    return char ? buildFullCharacterSetting(char, { includeMemos: true }) : '';
};

const rosterText = (g: WerewolfGame, chars: CharacterProfile[], userSetting?: string) =>
    werewolfRosterText(g.players.map(p => ({
        seat: p.seat, name: p.name, role: p.role, alive: p.alive, isUser: p.isUser, persona: personaOf(p, chars, userSetting), idiotRevealed: !!p.idiotRevealed,
    })));

// ── LLM 调用 ────────────────────────────────────────────────────────────────
async function callJSON(api: ResolvedApi, system: string, user: string, maxTokens = 900): Promise<any | null> {
    if (!api.baseUrl || !api.model) throw new Error('请先在「文具盒」里配置 API');
    const data = await callChatCompletion(api, {
        model: api.model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        temperature: 0.9,
        max_tokens: maxTokens,
        stream: false,
    }, {
        meta: makeApiUsageMeta('theater.werewolf', {
            apiRole: api.apiRole || 'aux',
            apiBinding: api.apiBinding,
        }),
    });
    return extractJson(extractContent(data) || '');
}

const aliveSeat = (g: WerewolfGame, seat: any): number | null => {
    const n = Number(seat);
    return Number.isFinite(n) && playerBySeat(g, n)?.alive ? n : null;
};

// ── 夜晚·AI 结算 ────────────────────────────────────────────────────────────
export interface NightAIOpts {
    needWolfKill: boolean;   // 狼队是否由 AI 决定刀人（user 不是狼时为 true）
    needWitch: boolean;      // 存活女巫是 AI（非 user）
    needSeer: boolean;       // 存活预言家是 AI（非 user）
    needGuard: boolean;      // 存活守卫是 AI（非 user）
    knownKill?: number | null; // user 是狼时已选的刀（让 AI 女巫据此决策）
    knownGuardProtect?: number | null; // user 是守卫时已选的守护目标
}
export interface NightAIResult {
    wolfKill: number | null;
    seerCheck: number | null;
    witchHeal: boolean;
    witchPoison: number | null;
    guardProtect: number | null;
    narration: string;
}

function heuristicWolfKill(g: WerewolfGame): number | null {
    const targets = livingGood(g);
    if (!targets.length) return null;
    const gods = targets.filter(p => p.role !== 'villager' && p.role !== 'idiot');
    return (pick(gods.length ? gods : targets) as WerewolfPlayer).seat;
}

function heuristicGuardProtect(g: WerewolfGame): number | null {
    const targets = guardablePlayers(g);
    if (!targets.length) return null;
    const good = targets.filter(p => p.role !== 'wolf');
    const gods = good.filter(p => p.role !== 'villager' && p.role !== 'idiot');
    return (pick(gods.length ? gods : good.length ? good : targets) as WerewolfPlayer).seat;
}

export interface NightDeathInput {
    wolfKill: number | null;
    witchHeal: boolean;
    witchPoison: number | null;
    guardProtect: number | null;
}

/** 守卫挡狼刀、不挡毒；同守同救会让被刀者仍出局。 */
export function resolveNightDeathReasons(input: NightDeathInput): Record<number, NonNullable<WerewolfPlayer['deadReason']>> {
    const deaths: Record<number, NonNullable<WerewolfPlayer['deadReason']>> = {};
    const kill = input.wolfKill;
    const guarded = kill != null && input.guardProtect === kill;
    const healed = kill != null && input.witchHeal;
    if (kill != null) {
        if (guarded && healed) deaths[kill] = 'guard_heal_conflict';
        else if (!guarded && !healed) deaths[kill] = 'wolf';
    }
    if (input.witchPoison != null) deaths[input.witchPoison] = 'poison';
    return deaths;
}

export function applyVoteExile(g: WerewolfGame, target: number): 'dead' | 'idiot-revealed' | null {
    const p = playerBySeat(g, target);
    if (!p || !p.alive) return null;
    if (p.role === 'idiot' && !p.idiotRevealed) {
        p.idiotRevealed = true;
        delete p.deadRound;
        delete p.deadReason;
        return 'idiot-revealed';
    }
    p.alive = false;
    p.deadRound = g.round;
    p.deadReason = 'vote';
    return 'dead';
}

/** 夜晚结算：让 AI 法官给出需要的字段，解析失败用启发式补齐。 */
export async function resolveNightAI(g: WerewolfGame, chars: CharacterProfile[], api: ResolvedApi, opts: NightAIOpts, userSetting?: string): Promise<NightAIResult> {
    const defaultNarration = '夜风掠过屋檐，村庄陷入沉睡，有人却在黑暗里悄悄睁开了眼……';
    // 没有任何 AI 夜间动作要决定时（仅缺氛围旁白），不必发起请求。
    if (!opts.needWolfKill && !opts.needWitch && !opts.needSeer && !opts.needGuard) {
        return { wolfKill: opts.knownKill ?? null, seerCheck: null, witchHeal: false, witchPoison: null, guardProtect: opts.knownGuardProtect ?? null, narration: defaultNarration };
    }
    const sys = werewolfNightSys({ roster: rosterText(g, chars, userSetting), round: g.round });
    const user = werewolfNightUser({
        round: g.round, needWolfKill: opts.needWolfKill, needWitch: opts.needWitch, needSeer: opts.needSeer, needGuard: opts.needGuard,
        knownKill: opts.knownKill, knownGuardProtect: opts.knownGuardProtect, lastGuardedSeat: g.lastGuardedSeat ?? null,
        witchHealLeft: !g.witchHealUsed, witchPoisonLeft: !g.witchPoisonUsed,
    });
    // 解析失败 / 网络抖动都退回启发式（各需求字段下方都有兜底），绝不卡死整局。
    let j: any = null;
    try { j = await callJSON(api, sys, user); } catch { j = null; }

    const res: NightAIResult = {
        wolfKill: opts.knownKill ?? null, seerCheck: null, witchHeal: false, witchPoison: null, guardProtect: opts.knownGuardProtect ?? null,
        narration: (j && typeof j.narration === 'string' && j.narration.trim()) || defaultNarration,
    };
    if (opts.needWolfKill) res.wolfKill = aliveSeat(g, j?.wolfKill) ?? heuristicWolfKill(g);
    if (opts.needSeer) {
        let s = aliveSeat(g, j?.seerCheck);
        if (s == null) { const others = livingPlayers(g).filter(p => p.role !== 'seer'); s = (pick(others) as WerewolfPlayer)?.seat ?? null; }
        res.seerCheck = s;
    }
    if (opts.needWitch) {
        // 女巫掌握今晚刀的是谁，再决定是否解救 / 是否下毒
        res.witchHeal = !g.witchHealUsed && j?.witchHeal === true && res.wolfKill != null;
        res.witchPoison = !g.witchPoisonUsed ? aliveSeat(g, j?.witchPoison) : null;
        // 救人和毒人通常不同夜全下；若 AI 又救又毒同一人，取消毒
        if (res.witchHeal && res.witchPoison != null && res.witchPoison === res.wolfKill) res.witchPoison = null;
    }
    if (opts.needGuard) res.guardProtect = (j?.guardProtect != null && canGuardSeat(g, Number(j.guardProtect))) ? Number(j.guardProtect) : heuristicGuardProtect(g);
    return res;
}

// ── 白天·AI 逐位发言 ────────────────────────────────────────────────────────
export async function generateDaySpeeches(g: WerewolfGame, chars: CharacterProfile[], api: ResolvedApi, deathNote: string, userSetting?: string): Promise<{ seat: number; speech: string }[]> {
    const speakers = g.players.filter(p => p.alive && !p.isUser);
    if (!speakers.length) return [];
    const sys = werewolfSpeechSys({ roster: rosterText(g, chars, userSetting) });
    const user = werewolfSpeechUser({
        round: g.round, speakers: speakers.map(s => ({ seat: s.seat, name: s.name })),
        log: publicLogText(g), deathNote,
    });
    let arr: any = null;
    try { arr = await callJSON(api, sys, user, 1300); } catch { arr = null; }
    const out: { seat: number; speech: string }[] = [];
    if (Array.isArray(arr)) {
        for (const it of arr) {
            const seat = Number(it?.seat);
            const sp = String(it?.speech || '').trim();
            if (speakers.some(s => s.seat === seat) && sp && !out.some(o => o.seat === seat)) out.push({ seat, speech: sp });
        }
    }
    for (const s of speakers) if (!out.some(o => o.seat === s.seat)) out.push({ seat: s.seat, speech: '（安静地观察着众人，没有多说什么。）' });
    out.sort((a, b) => speakers.findIndex(s => s.seat === a.seat) - speakers.findIndex(s => s.seat === b.seat));
    return out;
}

// ── 投票·AI 唱票 ────────────────────────────────────────────────────────────
export async function collectVotes(g: WerewolfGame, chars: CharacterProfile[], api: ResolvedApi, userSetting?: string): Promise<{ seat: number; target: number; reason?: string }[]> {
    const voters = votingPlayers(g).filter(p => !p.isUser);
    const targetSeats = voteTargetPlayers(g).map(p => p.seat);
    if (!voters.length) return [];
    const sys = werewolfVoteSys({ roster: rosterText(g, chars, userSetting) });
    const user = werewolfVoteUser({ round: g.round, voters: voters.map(v => ({ seat: v.seat, name: v.name })), aliveSeats: targetSeats, log: publicLogText(g) });
    let arr: any = null;
    try { arr = await callJSON(api, sys, user, 700); } catch { arr = null; }
    const byVoter = new Map<number, { seat: number; target: number; reason?: string }>();
    if (Array.isArray(arr)) {
        for (const it of arr) {
            const seat = Number(it?.seat);
            const target = voteTargetSeat(g, it?.target, seat);
            if (voters.some(v => v.seat === seat) && target != null && target !== seat) {
                byVoter.set(seat, { seat, target, reason: typeof it?.reason === 'string' ? it.reason.slice(0, 40) : undefined });
            }
        }
    }
    // 兜底：没拿到票的 AI 随机投一个存活的别人
    for (const v of voters) {
        if (!byVoter.has(v.seat)) {
            const others = targetSeats.filter(s => s !== v.seat);
            const t = pick(others);
            if (t != null) byVoter.set(v.seat, { seat: v.seat, target: t });
        }
    }
    return [...byVoter.values()];
}

/** 统计票数，返回得票最高者（平票随机其一）；可附 user 一票。 */
export function tallyVotes(votes: { seat: number; target: number }[]): { target: number | null; counts: Record<number, number> } {
    const counts: Record<number, number> = {};
    for (const v of votes) counts[v.target] = (counts[v.target] || 0) + 1;
    let max = 0;
    for (const k in counts) max = Math.max(max, counts[k]);
    if (max === 0) return { target: null, counts };
    const top = Object.keys(counts).filter(k => counts[+k] === max).map(Number);
    return { target: pick(top) ?? null, counts };
}

/** 猎人开枪的 AI 目标（启发式：随机带走一名存活的别人，略偏好神/狼怀疑对象由上层不可知，故随机）。 */
export function hunterShotTarget(g: WerewolfGame, hunterSeat: number): number | null {
    const others = livingPlayers(g).filter(p => p.seat !== hunterSeat);
    return (pick(others) as WerewolfPlayer)?.seat ?? null;
}
