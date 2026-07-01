/**
 * Folded Theater TRPG campaign helpers.
 *
 * This file intentionally keeps the expanded campaign rules pure: UI and API
 * code can call these helpers without knowing how quests, clues, checks, and
 * threats are merged.
 */

import {
    CharacterProfile,
    GameSession,
    TrpgActionCheck,
    TrpgAttribute,
    TrpgCheckMode,
    TrpgClue,
    TrpgEncounter,
    TrpgMilestone,
    TrpgNpc,
    TrpgPartySheet,
    TrpgQuest,
    TrpgThreat,
    TrpgWorldClock,
    UserProfile,
} from '../types';

export const TRPG_ATTRIBUTES: TrpgAttribute[] = ['body', 'mind', 'heart', 'craft', 'luck'];

export const TRPG_ATTRIBUTE_LABELS: Record<TrpgAttribute, string> = {
    body: '体魄',
    mind: '理性',
    heart: '心魂',
    craft: '技艺',
    luck: '命运',
};

export interface NarrativeCheckInput {
    sheet: TrpgPartySheet;
    check: TrpgActionCheck;
    rolls?: number[];
}

export interface NarrativeCheckResult {
    label: string;
    attribute: TrpgAttribute;
    skill?: string;
    dc: number;
    mode: TrpgCheckMode;
    rolls: number[];
    chosenRoll: number;
    attributeMod: number;
    skillBonus: number;
    total: number;
    success: boolean;
    critical: 'success' | 'failure' | null;
}

export interface TrpgStateUpdatePayload {
    newLocation?: string;
    hpChange?: number;
    sanityChange?: number;
    goldChange?: number;
    newItem?: string;
    scene?: {
        location?: string;
        time?: string;
        weather?: string;
        mood?: string;
    };
    chapter?: Partial<NonNullable<GameSession['chapter']>>;
    questUpdates?: Array<Partial<TrpgQuest> & { id?: string; title: string }>;
    clueUpdates?: Array<Partial<TrpgClue> & { id?: string; title: string; detail?: string }>;
    npcUpdates?: Array<Partial<TrpgNpc> & { id?: string; name: string }>;
    threatUpdates?: Array<Partial<TrpgThreat> & { id?: string; title: string }>;
    encounterUpdates?: Array<Partial<TrpgEncounter> & { id?: string; title: string }>;
    sheetUpdates?: Array<Partial<TrpgPartySheet> & {
        ownerId?: string;
        charId?: string;
        name?: string;
        hpChange?: number;
        sanityChange?: number;
        xpChange?: number;
        bondChange?: number;
        addSkills?: string[];
        addItems?: string[];
        addNotes?: string[];
    }>;
    worldClock?: Partial<TrpgWorldClock> & { tick?: number };
    milestone?: string | Partial<TrpgMilestone> | null;
}

type TrpgSheetUpdate = NonNullable<TrpgStateUpdatePayload['sheetUpdates']>[number];

const USER_OWNER_ID = 'user';
const DEFAULT_DC = 12;

const now = () => Date.now();
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const safeNumber = (n: any, fallback: number) => Number.isFinite(Number(n)) ? Number(n) : fallback;

const makeId = (prefix: string, label?: string) => {
    const slug = String(label || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9\u4e00-\u9fa5_-]/g, '')
        .slice(0, 24);
    return `${prefix}_${slug || Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36)}`;
};

const uniqueStrings = (items: Array<string | undefined | null>) =>
    Array.from(new Set(items.map(s => String(s || '').trim()).filter(Boolean)));

export function defaultAttributes(seed = 0): Record<TrpgAttribute, number> {
    return {
        body: seed === 1 ? 2 : 1,
        mind: seed === 2 ? 2 : 1,
        heart: seed === 3 ? 2 : 1,
        craft: seed === 4 ? 2 : 1,
        luck: 1,
    };
}

export function createDefaultPartySheets(userProfile: UserProfile, chars: CharacterProfile[]): TrpgPartySheet[] {
    const t = now();
    const userName = (userProfile?.name || '').trim() || '你';
    const sheets: TrpgPartySheet[] = [{
        ownerId: USER_OWNER_ID,
        name: userName,
        isUser: true,
        role: '主角',
        attributes: defaultAttributes(0),
        skills: ['观察', '交涉'],
        hp: 100,
        sanity: 100,
        xp: 0,
        bond: 0,
        inventory: [],
        notes: ['战役扩展模式会记录任务、线索、NPC 与成长。'],
        updatedAt: t,
    }];

    chars.forEach((char, idx) => {
        sheets.push({
            ownerId: char.id,
            name: char.name,
            role: idx % 3 === 0 ? '前锋' : idx % 3 === 1 ? '策士' : '支援',
            attributes: defaultAttributes((idx % 4) + 1),
            skills: idx % 3 === 0 ? ['护卫', '强行突破'] : idx % 3 === 1 ? ['调查', '推理'] : ['安抚', '急救'],
            hp: 100,
            sanity: 100,
            xp: 0,
            bond: 0,
            inventory: [],
            notes: [],
            updatedAt: t,
        });
    });

    return sheets;
}

export function createExpandedDefaults(
    game: Pick<GameSession, 'title' | 'status'>,
    userProfile: UserProfile,
    chars: CharacterProfile[],
): Pick<GameSession, 'campaignMode' | 'chapter' | 'quests' | 'clues' | 'npcs' | 'partySheets' | 'threats' | 'encounters' | 'worldClock' | 'milestones'> {
    return {
        campaignMode: 'expanded',
        chapter: {
            no: 1,
            title: '第一幕',
            summary: `${game.title} 的战役刚刚开场。`,
            goal: '确认当前危机，找到第一条可靠线索。',
            status: 'active',
        },
        quests: [],
        clues: [],
        npcs: [],
        partySheets: createDefaultPartySheets(userProfile, chars),
        threats: [],
        encounters: [],
        worldClock: { day: 1, phase: '开场', ticks: 0 },
        milestones: [],
    };
}

export function normalizeTrpgSession(
    game: GameSession,
    userProfile?: UserProfile,
    chars: CharacterProfile[] = [],
): GameSession {
    const campaignMode = game.campaignMode || 'classic';
    if (campaignMode !== 'expanded') return { ...game, campaignMode };

    const defaults = createExpandedDefaults(
        game,
        userProfile || ({ name: '你' } as UserProfile),
        chars.filter(c => game.playerCharIds.includes(c.id)),
    );
    const knownSheets = game.partySheets || [];
    const sheetIds = new Set(knownSheets.map(s => s.ownerId));
    const missingSheets = (defaults.partySheets || []).filter(s => !sheetIds.has(s.ownerId));

    return {
        ...game,
        campaignMode: 'expanded',
        campaignDifficulty: game.campaignDifficulty || 'normal',
        growthSpeed: game.growthSpeed || 'standard',
        chapter: { ...defaults.chapter!, ...(game.chapter || {}) },
        quests: game.quests || [],
        clues: game.clues || [],
        npcs: game.npcs || [],
        partySheets: [...knownSheets, ...missingSheets],
        threats: game.threats || [],
        encounters: game.encounters || [],
        worldClock: { ...defaults.worldClock!, ...(game.worldClock || {}) },
        milestones: game.milestones || [],
    };
}

export function rollNarrativeCheck(input: NarrativeCheckInput): NarrativeCheckResult {
    const check = input.check;
    const mode: TrpgCheckMode = check.mode || 'normal';
    const rolls = (input.rolls && input.rolls.length ? input.rolls : [
        Math.floor(Math.random() * 20) + 1,
        ...(mode === 'normal' ? [] : [Math.floor(Math.random() * 20) + 1]),
    ]).map(n => clamp(Math.round(n), 1, 20));
    const chosenRoll = mode === 'advantage'
        ? Math.max(...rolls)
        : mode === 'disadvantage'
            ? Math.min(...rolls)
            : rolls[0];
    const attribute = TRPG_ATTRIBUTES.includes(check.attribute as TrpgAttribute) ? check.attribute : 'luck';
    const attributeMod = safeNumber(input.sheet.attributes?.[attribute], 0);
    const skill = check.skill?.trim();
    const skillBonus = skill && input.sheet.skills.some(s => s.trim() === skill) ? 2 : 0;
    const dc = clamp(Math.round(check.dc || DEFAULT_DC), 5, 30);
    const total = chosenRoll + attributeMod + skillBonus;
    const critical = chosenRoll === 20 ? 'success' : chosenRoll === 1 ? 'failure' : null;
    const success = critical === 'success' ? true : critical === 'failure' ? false : total >= dc;

    return {
        label: `${TRPG_ATTRIBUTE_LABELS[attribute]}${skill ? `/${skill}` : ''} DC${dc}`,
        attribute,
        skill,
        dc,
        mode,
        rolls,
        chosenRoll,
        attributeMod,
        skillBonus,
        total,
        success,
        critical,
    };
}

const mergeById = <T extends { id: string }>(
    current: T[] | undefined,
    incoming: Array<Partial<T> & { id?: string }>,
    idPrefix: string,
    labelKey: keyof T,
    normalize: (item: Partial<T> & { id?: string }, existing?: T) => T,
) => {
    const byId = new Map((current || []).map(item => [item.id, item]));
    for (const raw of incoming || []) {
        const label = String(raw[labelKey] || '').trim();
        const id = raw.id || makeId(idPrefix, label);
        const existing = byId.get(id);
        byId.set(id, normalize({ ...raw, id }, existing));
    }
    return Array.from(byId.values());
};

function sheetKey(update: TrpgSheetUpdate, sheets: TrpgPartySheet[]) {
    if (update.ownerId) return update.ownerId;
    if (update.charId) return update.charId;
    if (update.name) return sheets.find(s => s.name === update.name)?.ownerId || update.name;
    return USER_OWNER_ID;
}

export function applyTrpgStateUpdates(
    game: GameSession,
    payload: TrpgStateUpdatePayload | null | undefined,
    opts: { sanityLocked?: boolean } = {},
): GameSession {
    if (!payload) return game;

    const status = { ...game.status };
    if (payload.newLocation || payload.scene?.location) status.location = payload.newLocation || payload.scene!.location!;
    if (payload.hpChange) status.health = clamp((status.health || 100) + safeNumber(payload.hpChange, 0), 0, 100);
    if (payload.sanityChange && !opts.sanityLocked) status.sanity = clamp((status.sanity || 100) + safeNumber(payload.sanityChange, 0), 0, 100);
    if (payload.goldChange) status.gold = Math.max(0, (status.gold || 0) + safeNumber(payload.goldChange, 0));
    if (payload.newItem) status.inventory = uniqueStrings([...(status.inventory || []), payload.newItem]);

    if (game.campaignMode !== 'expanded') return { ...game, status };

    const t = now();
    const quests = mergeById<TrpgQuest>(game.quests, payload.questUpdates || [], 'quest', 'title', (raw, existing) => ({
        id: raw.id!,
        title: String(raw.title || existing?.title || '未命名任务'),
        status: raw.status || existing?.status || 'active',
        summary: raw.summary ?? existing?.summary,
        steps: uniqueStrings([...(existing?.steps || []), ...(raw.steps || [])]),
        updatedAt: t,
    }));
    const clues = mergeById<TrpgClue>(game.clues, payload.clueUpdates || [], 'clue', 'title', (raw, existing) => ({
        id: raw.id!,
        title: String(raw.title || existing?.title || '未命名线索'),
        detail: String(raw.detail || existing?.detail || ''),
        source: raw.source ?? existing?.source,
        tags: uniqueStrings([...(existing?.tags || []), ...(raw.tags || [])]),
        discoveredAt: existing?.discoveredAt || t,
    }));
    const npcs = mergeById<TrpgNpc>(game.npcs, payload.npcUpdates || [], 'npc', 'name', (raw, existing) => ({
        id: raw.id!,
        name: String(raw.name || existing?.name || '无名 NPC'),
        role: raw.role ?? existing?.role,
        attitude: raw.attitude ?? existing?.attitude,
        location: raw.location ?? existing?.location,
        notes: raw.notes ?? existing?.notes,
        updatedAt: t,
    }));
    const threats = mergeById<TrpgThreat>(game.threats, payload.threatUpdates || [], 'threat', 'title', (raw, existing) => {
        const max = Math.max(1, safeNumber(raw.max, existing?.max || 6));
        return {
            id: raw.id!,
            title: String(raw.title || existing?.title || '未命名危机'),
            danger: raw.danger || existing?.danger || 'medium',
            progress: clamp(safeNumber(raw.progress, existing?.progress || 0), 0, max),
            max,
            status: raw.status || existing?.status || 'active',
            note: raw.note ?? existing?.note,
            updatedAt: t,
        };
    });
    const encounters = mergeById<TrpgEncounter>(game.encounters, payload.encounterUpdates || [], 'encounter', 'title', (raw, existing) => ({
        id: raw.id!,
        title: String(raw.title || existing?.title || '未命名遭遇'),
        status: raw.status || existing?.status || 'active',
        threatIds: uniqueStrings([...(existing?.threatIds || []), ...(raw.threatIds || [])]),
        summary: raw.summary ?? existing?.summary,
        updatedAt: t,
    }));

    let partySheets = (game.partySheets || []).map(s => ({ ...s }));
    for (const update of payload.sheetUpdates || []) {
        const ownerId = sheetKey(update, partySheets);
        let sheet = partySheets.find(s => s.ownerId === ownerId);
        if (!sheet) {
            sheet = {
                ownerId,
                name: update.name || ownerId,
                attributes: defaultAttributes(),
                skills: [],
                hp: 100,
                sanity: 100,
                xp: 0,
                bond: 0,
                inventory: [],
                notes: [],
                updatedAt: t,
            };
            partySheets.push(sheet);
        }
        sheet.role = update.role ?? sheet.role;
        sheet.attributes = { ...sheet.attributes, ...(update.attributes || {}) };
        sheet.skills = uniqueStrings([...(sheet.skills || []), ...(update.skills || []), ...(update.addSkills || [])]);
        sheet.hp = clamp(safeNumber(update.hp, sheet.hp) + safeNumber(update.hpChange, 0), 0, 100);
        sheet.sanity = clamp(safeNumber(update.sanity, sheet.sanity) + safeNumber(update.sanityChange, 0), 0, 100);
        sheet.xp = Math.max(0, safeNumber(update.xp, sheet.xp) + safeNumber(update.xpChange, 0));
        sheet.bond = clamp(safeNumber(update.bond, sheet.bond) + safeNumber(update.bondChange, 0), -10, 10);
        sheet.inventory = uniqueStrings([...(sheet.inventory || []), ...(update.inventory || []), ...(update.addItems || [])]);
        sheet.notes = uniqueStrings([...(sheet.notes || []), ...(update.notes || []), ...(update.addNotes || [])]);
        sheet.updatedAt = t;
    }

    let worldClock = game.worldClock || { day: 1, phase: '开场', ticks: 0 };
    if (payload.worldClock) {
        worldClock = {
            day: Math.max(1, safeNumber(payload.worldClock.day, worldClock.day)),
            phase: payload.worldClock.phase || worldClock.phase,
            ticks: Math.max(0, safeNumber(payload.worldClock.ticks, worldClock.ticks) + safeNumber(payload.worldClock.tick, 0)),
        };
    } else {
        worldClock = { ...worldClock, ticks: worldClock.ticks + 1 };
    }

    const milestones = [...(game.milestones || [])];
    if (payload.milestone) {
        const raw = typeof payload.milestone === 'string' ? { title: payload.milestone } : payload.milestone;
        if (raw.title) {
            milestones.push({
                id: raw.id || makeId('mile', raw.title),
                title: raw.title,
                reward: raw.reward,
                createdAt: raw.createdAt || t,
            });
        }
    }

    return {
        ...game,
        status,
        chapter: payload.chapter ? { ...(game.chapter || { no: 1, title: '第一幕' }), ...payload.chapter } : game.chapter,
        quests,
        clues,
        npcs,
        threats,
        encounters,
        partySheets,
        worldClock,
        milestones,
    };
}

export function summarizeCampaignState(game: GameSession): string {
    if (game.campaignMode !== 'expanded') return '';
    const chapter = game.chapter ? `章节：第${game.chapter.no}幕「${game.chapter.title}」${game.chapter.goal ? `，目标：${game.chapter.goal}` : ''}` : '';
    const quests = (game.quests || []).filter(q => q.status === 'active').slice(0, 4).map(q => `- ${q.title}${q.summary ? `：${q.summary}` : ''}`).join('\n');
    const clues = (game.clues || []).slice(-5).map(c => `- ${c.title}：${c.detail}`).join('\n');
    const npcs = (game.npcs || []).slice(-5).map(n => `- ${n.name}${n.role ? `（${n.role}）` : ''}${n.attitude ? `，态度：${n.attitude}` : ''}${n.location ? `，地点：${n.location}` : ''}`).join('\n');
    const threats = (game.threats || []).filter(t => t.status === 'active').map(t => `- ${t.title}：${t.progress}/${t.max}，危险度 ${t.danger}${t.note ? `，${t.note}` : ''}`).join('\n');
    const sheets = (game.partySheets || []).map(s => `- ${s.name}${s.role ? `/${s.role}` : ''} HP${s.hp} SAN${s.sanity} XP${s.xp} 羁绊${s.bond} 技能:${s.skills.join('、') || '无'}`).join('\n');
    const clock = game.worldClock ? `时间：第${game.worldClock.day}日 ${game.worldClock.phase}，推进 ${game.worldClock.ticks} 格` : '';

    return [
        '### 战役扩展状态',
        chapter,
        clock,
        quests ? `当前任务:\n${quests}` : '当前任务：暂无',
        clues ? `线索墙:\n${clues}` : '线索墙：暂无',
        npcs ? `NPC名录:\n${npcs}` : 'NPC名录：暂无',
        threats ? `危机/战斗:\n${threats}` : '危机/战斗：暂无',
        sheets ? `角色卡:\n${sheets}` : '',
    ].filter(Boolean).join('\n');
}

export function checkResultToText(result?: NarrativeCheckResult | null): string {
    if (!result) return '';
    const mode = result.mode === 'advantage' ? '优势' : result.mode === 'disadvantage' ? '劣势' : '普通';
    const crit = result.critical === 'success' ? '，大成功' : result.critical === 'failure' ? '，大失败' : '';
    return `${result.label}：${mode} D20 ${result.rolls.join('/')} -> ${result.chosenRoll} + 属性${result.attributeMod} + 技能${result.skillBonus} = ${result.total}/${result.dc}，${result.success ? '成功' : '失败'}${crit}`;
}

export function actionCheckHint(check?: TrpgActionCheck): string {
    if (!check) return '';
    const attribute = TRPG_ATTRIBUTES.includes(check.attribute as TrpgAttribute) ? check.attribute : 'luck';
    const attr = TRPG_ATTRIBUTE_LABELS[attribute];
    const dc = check.dc || DEFAULT_DC;
    const mode = check.mode === 'advantage' ? '优势' : check.mode === 'disadvantage' ? '劣势' : '';
    return `${attr}${check.skill ? `/${check.skill}` : ''} DC${dc}${mode ? ` ${mode}` : ''}`;
}
