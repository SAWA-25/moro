import { CharacterProfile, UserProfile, Message } from '../types';
import { DB } from './db';
import { ContextBuilder } from './context';
import { RealtimeContextManager } from './realtimeContext';
import { completeText } from './llmClient';
import { makeApiUsageMeta } from './apiUsageCatalog';
import { extractTakeoutOrderDirective } from './takeout';
import type { PresetMacroCtx } from './presets';

/**
 * 线下模式（自动线下）。
 *
 * 触发：会话设置开启「自动线下」后，system prompt 授权角色在对话发展到见面情境时
 * 输出 `[[OFFLINE_START]]` 指令（见 utils/context.ts 会话设定段）。
 * applyAssistantPostProcessing 在渲染前剥离该指令并广播 OFFLINE_START_EVENT；
 * Chat.tsx 监听后弹出线下场景窗口（OfflineModeModal）。用户不在该角色聊天页时
 * 用 pending 标记兜底，下次进入聊天时再弹。
 *
 * 结束：线下窗口内的全部情景（旁白/对话/用户行动）合成一条 system 消息落库进入
 * 上下文，宿主稍等一段时间后才会酌情收尾；期间若已经有新消息或事件，就不再抢话。
 *
 * 线上 ↔ 线下「关联」：本模块做了两头桥接，让见面不是和线上聊天割裂的独立剧情——
 *  · 线上 → 线下：buildOfflineBase 把最近的线上聊天喂进开场/推进 prompt，并明确要求
 *    这场见面承接线上聊到的话题/约定/心情，是同一段关系的延续；
 *  · 线下 → 线上：commitOfflineSessionToContext 把现场情景落成 system 记录，并提示角色
 *    回到线上后记得这次见面、可自然提起，但不能把未发生的外卖/快递/电话等推进成已完成。
 * API：线下场景默认走文具盒主 API / 主模型，让面对面现场和主聊天保持同一套角色声音。
 */

export const OFFLINE_START_RE = /\[\[\s*OFFLINE_START\s*(?:[:：]\s*[^\]]*?)?\]\]/gi;
export const OFFLINE_START_EVENT = 'moro-offline-start';

const pendingKey = (charId: string) => `moro_offline_pending_${charId}`;
const pendingScenarioKey = (charId: string) => `moro_offline_pending_scenario_${charId}`;
const scheduledStartsKey = 'moro_offline_scheduled_starts_v1';
const sessionKey = (charId: string) => `moro_offline_session_${charId}`;
const activeKey = (charId: string) => `moro_offline_active_${charId}`;
export const OFFLINE_FOLLOWUP_DELAY_MS = 5 * 60 * 1000;
export const OFFLINE_SESSION_STATE_EVENT = 'moro-offline-session-state';

const emitOfflineSessionState = (charId: string, active: boolean): void => {
    try {
        if (typeof window === 'undefined') return;
        window.dispatchEvent(new CustomEvent(OFFLINE_SESSION_STATE_EVENT, { detail: { charId, active } }));
    } catch { /* ignore */ }
};

/** 从 AI 输出中剥离 [[OFFLINE_START]] 指令并返回是否命中 */
export const extractOfflineStartDirective = (content: string): { content: string; offline: boolean } => {
    if (!content) return { content, offline: false };
    OFFLINE_START_RE.lastIndex = 0;
    const offline = OFFLINE_START_RE.test(content);
    if (!offline) return { content, offline: false };
    return { content: content.replace(OFFLINE_START_RE, '').trim(), offline: true };
};

export type OfflineAutoStartMode = 'private' | 'group';

export interface OfflineAutoStartDetection {
    offline: boolean;
    scenario?: string;
    reason?: string;
    matchedText?: string;
}

export interface OfflineScheduledStartDetection {
    scheduled: boolean;
    dueAt?: number;
    scenario?: string;
    reason?: string;
    matchedText?: string;
}

export interface OfflineAutoStartSchedule {
    id: string;
    mode: OfflineAutoStartMode;
    targetId: string;
    dueAt: number;
    scenario: string;
    createdAt: number;
    matchedText?: string;
}

export interface OfflineAutoStartInput {
    mode?: OfflineAutoStartMode;
    latestText?: string;
    recentTexts?: string[];
    userName?: string;
    charName?: string;
    groupName?: string;
}

const cleanOfflineDetectionText = (text: string): string =>
    String(text || '')
        .replace(OFFLINE_START_RE, ' ')
        .replace(/\[\[[\s\S]*?\]\]/g, ' ')
        .replace(/https?:\/\/\S+/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();

const offlineBlockingNegativeRe = /(?:如果|假如|要是|以后|未来|改天|下次|哪天|有空|找时间|约个|约一下|要不要|想不想|可以.*见|明天|后天|周[一二三四五六日天末]|星期[一二三四五六日天]|上次|之前|以前|回忆|记得.*见|梦里|模拟|番外|假设|还没|没有|没到|不到|别来|不用来|不要来)/;
const offlineEmotionOnlyRe = /(?:想见|好想见|想你)/;
const offlineProposalOnlyRe = /(?:一起|出来|出门|见面|碰面|吃饭|喝咖啡|逛街|看电影).{0,12}(?:吗|嘛|吧|不|好不好|怎么样|\?)/;

const privateOfflinePositiveRes: RegExp[] = [
    /(?:我|你|他|她|ta|TA|咱们|我们).{0,10}(?:到|到了|刚到|已经到|快到).{0,16}(?:楼下|门口|路口|店门口|校门|公司楼下|家门口|你家|我家|现场|约定地点|咖啡馆|餐厅|车站|地铁口)/i,
    /(?:我|你|他|她|ta|TA|咱们|我们).{0,10}(?:在|已经在|就在).{0,14}(?:楼下|门口|路口|店门口|校门|公司楼下|家门口|你家|我家|现场|约定地点|咖啡馆|餐厅|车站|地铁口)/i,
    /(?:楼下|门口|路口|店门口|家门口|电梯口|地铁口).{0,12}(?:等你|等我|见|碰头|汇合|会合|到了|到啦|开门)/,
    /(?:已经|刚刚|现在|终于).{0,8}(?:见面|碰面|碰头|汇合|会合|碰上|遇见)/,
    /(?:开门|推门|敲门|按门铃|下楼|上楼|进门|出门).{0,18}(?:看见|见到|看到|碰见|碰头|遇见|迎上)/,
    /(?:开门|推门|进门).{0,8}(?:进来|进去|走进|进了)/,
    /(?:见面|碰面|碰头|汇合|会合|碰上|遇见).{0,10}(?:了|啦|到了|终于|现在|刚刚|已经)/,
    /(?:面对面|同处一地|同处一室|同一个房间|同一张桌|坐在.*旁边|站在.*面前|就在.*身边)/,
    /(?:一起|现在).{0,10}(?:出门|走吧|进店|上车|落座|坐下|进去|下楼)/,
];

const groupOfflinePositiveRes: RegExp[] = [
    /(?:大家|人|我们|咱们).{0,10}(?:到齐|到场|集合|碰头|汇合|会合|落座|坐下|进店|出门|上车|开门)/,
    /(?:大家|我们|咱们).{0,10}(?:已经在|就在|同处).{0,14}(?:现场|包厢|桌边|餐厅|咖啡馆|门口|楼下|约定地点)/,
    /(?:群里|群友|成员|他们|她们).{0,12}(?:到齐|碰头|汇合|会合|见上|见面|到场)/,
    /(?:包厢|桌边|餐厅|咖啡馆|现场|门口|楼下|车站|地铁口).{0,14}(?:到齐|碰头|汇合|坐下|落座|见面|等人)/,
    /(?:线下|现场|赴约|聚会|饭局).{0,12}(?:开始|到了|到齐|碰头|落地|开场)/,
];

const futureAppointmentTimeRe = /(?:今天|今晚|明天|明早|明晚|明儿|明日|后天|周[一二三四五六日天末]|星期[一二三四五六日天]|礼拜[一二三四五六日天]|下周[一二三四五六日天末])/;
const futureAppointmentActionRe = /(?:见|见面|碰面|碰头|汇合|会合|赴约|约定|聚|聚会|楼下|门口|路口|店门口|校门|地铁口|车站|餐厅|咖啡馆|包厢|现场|一起出门|一起吃饭|一起走)/;
const futureAppointmentBlockingRe = /(?:如果|假如|要是|要不要|想不想|可不可以|可以吗|好吗|好不好|怎么样|吗|嘛|么|也许|可能|大概|改天|下次|哪天|有空|找时间|再说|上次|之前|以前|回忆|记得.*见|梦里|模拟|番外)/;

const cnDigitMap: Record<string, number> = {
    零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};

const parseChineseNumber = (raw: string): number | undefined => {
    const text = raw.trim();
    if (!text) return undefined;
    if (/^\d+$/.test(text)) return parseInt(text, 10);
    if (text === '十') return 10;
    const tenIdx = text.indexOf('十');
    if (tenIdx >= 0) {
        const left = text.slice(0, tenIdx);
        const right = text.slice(tenIdx + 1);
        const tens = left ? cnDigitMap[left] : 1;
        const ones = right ? cnDigitMap[right] : 0;
        if (typeof tens === 'number' && typeof ones === 'number') return tens * 10 + ones;
        return undefined;
    }
    if (text.length === 1) return cnDigitMap[text];
    return undefined;
};

const defaultFutureHourOf = (text: string): number => {
    if (/(?:明早|早上|上午)/.test(text)) return 8;
    if (/(?:中午)/.test(text)) return 12;
    if (/(?:明晚|今晚|晚上|傍晚|夜里)/.test(text)) return 19;
    if (/(?:下午)/.test(text)) return 15;
    return 9;
};

const parseFutureTimeOfDay = (text: string): { hour: number; minute: number; explicit: boolean } => {
    const colon = /(?:^|[^\d])([01]?\d|2[0-3])\s*[:：]\s*([0-5]\d)(?:[^\d]|$)/.exec(text);
    if (colon) return { hour: parseInt(colon[1], 10), minute: parseInt(colon[2], 10), explicit: true };

    const point = /([零〇一二两三四五六七八九十\d]{1,3})\s*点(?:\s*([零〇一二两三四五六七八九十\d]{1,3})\s*分?)?(\s*半)?/.exec(text);
    if (point) {
        let hour = parseChineseNumber(point[1]) ?? defaultFutureHourOf(text);
        let minute = point[3] ? 30 : (point[2] ? (parseChineseNumber(point[2]) ?? 0) : 0);
        if (/(?:下午|晚上|傍晚|今晚|明晚|夜里)/.test(text) && hour >= 1 && hour < 12) hour += 12;
        if (/(?:中午)/.test(text) && hour >= 1 && hour < 11) hour += 12;
        hour = Math.max(0, Math.min(23, hour));
        minute = Math.max(0, Math.min(59, minute));
        return { hour, minute, explicit: true };
    }

    return { hour: defaultFutureHourOf(text), minute: 0, explicit: false };
};

const weekdayIndexOf = (text: string): number | undefined => {
    const hit = /(?:下?周|星期|礼拜)([一二三四五六日天末])/.exec(text);
    if (!hit) return undefined;
    const char = hit[1];
    if (char === '一') return 1;
    if (char === '二') return 2;
    if (char === '三') return 3;
    if (char === '四') return 4;
    if (char === '五') return 5;
    if (char === '六') return 6;
    return 0;
};

const resolveFutureOfflineDueAt = (text: string, nowMs: number): number | undefined => {
    const now = new Date(nowMs);
    let dayOffset: number | undefined;
    if (/(?:后天)/.test(text)) dayOffset = 2;
    else if (/(?:明天|明早|明晚|明儿|明日)/.test(text)) dayOffset = 1;
    else {
        const weekday = weekdayIndexOf(text);
        if (typeof weekday === 'number') {
            const today = now.getDay();
            const wantsNextWeek = /下周/.test(text);
            let delta = (weekday - today + 7) % 7;
            if (delta === 0 || wantsNextWeek) delta += 7;
            dayOffset = delta;
        } else if (/(?:今天|今晚)/.test(text)) {
            dayOffset = 0;
        }
    }
    if (typeof dayOffset !== 'number') return undefined;

    const time = parseFutureTimeOfDay(text);
    const due = new Date(now);
    due.setDate(now.getDate() + dayOffset);
    due.setHours(time.hour, time.minute, 0, 0);
    if (due.getTime() <= nowMs + 5 * 60 * 1000) return undefined;
    return due.getTime();
};

const formatOfflineDueAt = (dueAt: number): string => {
    try {
        return new Date(dueAt).toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch {
        return '约定时间';
    }
};

const isOfflineLineNegative = (text: string, hasPositiveSignal: boolean): boolean =>
    offlineBlockingNegativeRe.test(text)
    || offlineProposalOnlyRe.test(text)
    || (!hasPositiveSignal && offlineEmotionOnlyRe.test(text));

export const buildOfflineAutoStartScenario = ({
    mode = 'private',
    latestText,
    recentTexts,
    userName,
    charName,
    groupName,
}: OfflineAutoStartInput): string => {
    const recent = (recentTexts || [])
        .map(cleanOfflineDetectionText)
        .filter(Boolean)
        .slice(-6);
    const latest = cleanOfflineDetectionText(latestText || '');
    const lines = [...recent, latest].filter(Boolean).slice(-7);
    const title = mode === 'group'
        ? `群聊「${groupName || '当前群聊'}」已经从线上聊到线下现场`
        : `${userName || '用户'} 和 ${charName || 'TA'} 已经从线上聊到线下现场`;
    const body = lines.length ? lines.map(line => `- ${line.slice(0, 180)}`).join('\n') : '- 最近聊天已经明确进入见面现场。';
    return `${title}。请承接下面最近几句，直接从已经碰头/同处现场的那一刻开始，不要重新安排很久以后的约定：\n${body}`;
};

export const detectOfflineAutoStart = (input: OfflineAutoStartInput): OfflineAutoStartDetection => {
    const mode = input.mode || 'private';
    const candidates = [
        ...(input.recentTexts || []).slice(-6),
        input.latestText || '',
    ]
        .map(cleanOfflineDetectionText)
        .filter(Boolean);
    const positiveRes = mode === 'group'
        ? [...privateOfflinePositiveRes, ...groupOfflinePositiveRes]
        : privateOfflinePositiveRes;
    for (const line of candidates) {
        const hit = positiveRes.find(re => re.test(line));
        if (!hit || isOfflineLineNegative(line, true)) continue;
        if (hit) {
            return {
                offline: true,
                matchedText: line,
                reason: hit.source,
                scenario: buildOfflineAutoStartScenario(input),
            };
        }
    }
    return { offline: false };
};

export const buildOfflineScheduledStartScenario = (
    input: OfflineAutoStartInput,
    dueAt: number,
): string => {
    const recent = (input.recentTexts || [])
        .map(cleanOfflineDetectionText)
        .filter(Boolean)
        .slice(-6);
    const latest = cleanOfflineDetectionText(input.latestText || '');
    const lines = [...recent, latest].filter(Boolean).slice(-7);
    const title = input.mode === 'group'
        ? `群聊「${input.groupName || '当前群聊'}」此前已经约好线下赴约`
        : `${input.userName || '用户'} 和 ${input.charName || 'TA'} 此前已经约好见面`;
    const body = lines.length ? lines.map(line => `- ${line.slice(0, 180)}`).join('\n') : '- 最近聊天里已经约好了线下见面。';
    return `${title}，现在已经到了约定时间（${formatOfflineDueAt(dueAt)}）。请承接下面最近几句，直接从抵达/碰头/同处现场的那一刻开始，不要重新询问要不要见面，也不要改成未来约定：\n${body}`;
};

export const detectOfflineScheduledStart = (
    input: OfflineAutoStartInput,
    nowMs = Date.now(),
): OfflineScheduledStartDetection => {
    const candidates = [
        input.latestText || '',
        ...(input.recentTexts || []).slice(-6).reverse(),
    ]
        .map(cleanOfflineDetectionText)
        .filter(Boolean);
    for (const line of candidates) {
        if (!futureAppointmentTimeRe.test(line) || !futureAppointmentActionRe.test(line)) continue;
        if (futureAppointmentBlockingRe.test(line) || /[?？]$/.test(line.trim())) continue;
        const dueAt = resolveFutureOfflineDueAt(line, nowMs);
        if (!dueAt) continue;
        return {
            scheduled: true,
            dueAt,
            matchedText: line,
            reason: 'future-appointment',
            scenario: buildOfflineScheduledStartScenario({ ...input, latestText: input.latestText || line }, dueAt),
        };
    }
    return { scheduled: false };
};

const readOfflineAutoStartSchedules = (): OfflineAutoStartSchedule[] => {
    try {
        const raw = localStorage.getItem(scheduledStartsKey);
        const parsed = raw ? JSON.parse(raw) : null;
        if (!Array.isArray(parsed)) return [];
        return parsed
            .filter((item: any) =>
                item
                && (item.mode === 'private' || item.mode === 'group')
                && typeof item.targetId === 'string'
                && typeof item.dueAt === 'number'
                && typeof item.scenario === 'string'
            )
            .map((item: any) => ({
                id: String(item.id || `${item.mode}_${item.targetId}_${item.dueAt}`),
                mode: item.mode,
                targetId: item.targetId,
                dueAt: item.dueAt,
                scenario: item.scenario,
                createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now(),
                matchedText: typeof item.matchedText === 'string' ? item.matchedText : undefined,
            }));
    } catch {
        return [];
    }
};

const writeOfflineAutoStartSchedules = (items: OfflineAutoStartSchedule[]): void => {
    try {
        const clean = items
            .filter(item => item.dueAt > Date.now() - 24 * 60 * 60 * 1000)
            .sort((a, b) => a.dueAt - b.dueAt)
            .slice(0, 80);
        if (clean.length) localStorage.setItem(scheduledStartsKey, JSON.stringify(clean));
        else localStorage.removeItem(scheduledStartsKey);
    } catch { /* ignore */ }
};

export const scheduleOfflineAutoStart = (item: Omit<OfflineAutoStartSchedule, 'id' | 'createdAt'>): OfflineAutoStartSchedule | undefined => {
    if (!item.targetId || !item.scenario.trim() || item.dueAt <= Date.now() + 5 * 60 * 1000) return undefined;
    const current = readOfflineAutoStartSchedules();
    const existingIdx = current.findIndex(old =>
        old.mode === item.mode
        && old.targetId === item.targetId
        && (Math.abs(old.dueAt - item.dueAt) <= 30 * 60 * 1000 || (!!item.matchedText && old.matchedText === item.matchedText))
    );
    const next: OfflineAutoStartSchedule = {
        ...item,
        scenario: item.scenario.slice(0, 1800),
        matchedText: item.matchedText?.slice(0, 240),
        id: `${item.mode}_${item.targetId}_${Math.round(item.dueAt / 60000)}`,
        createdAt: Date.now(),
    };
    if (existingIdx >= 0) current[existingIdx] = { ...current[existingIdx], ...next };
    else current.push(next);
    writeOfflineAutoStartSchedules(current);
    return next;
};

export const consumeDueOfflineAutoStarts = ({
    mode,
    targetId,
    nowMs = Date.now(),
}: {
    mode: OfflineAutoStartMode;
    targetId: string;
    nowMs?: number;
}): OfflineAutoStartSchedule[] => {
    const current = readOfflineAutoStartSchedules();
    const due: OfflineAutoStartSchedule[] = [];
    const rest: OfflineAutoStartSchedule[] = [];
    for (const item of current) {
        if (item.mode === mode && item.targetId === targetId && item.dueAt <= nowMs) due.push(item);
        else rest.push(item);
    }
    if (due.length > 0) writeOfflineAutoStartSchedules(rest);
    return due.sort((a, b) => a.dueAt - b.dueAt);
};

/** 用户不在该角色聊天页时标记 pending，进聊天时兜底弹窗 */
export const setOfflinePending = (charId: string, scenario?: string): void => {
    try {
        localStorage.setItem(pendingKey(charId), '1');
        const cleanScenario = String(scenario || '').trim();
        if (cleanScenario) localStorage.setItem(pendingScenarioKey(charId), cleanScenario.slice(0, 1600));
        else localStorage.removeItem(pendingScenarioKey(charId));
    } catch { /* ignore */ }
};
export const consumeOfflinePending = (charId: string): boolean => {
    try {
        const hit = localStorage.getItem(pendingKey(charId)) === '1';
        if (hit) localStorage.removeItem(pendingKey(charId));
        return hit;
    } catch { return false; }
};
export const consumeOfflinePendingScenario = (charId: string): string | undefined => {
    try {
        const raw = localStorage.getItem(pendingScenarioKey(charId));
        localStorage.removeItem(pendingScenarioKey(charId));
        const text = raw?.trim();
        return text || undefined;
    } catch { return undefined; }
};

// ── 线下场景会话（窗口内的情景记录，落 localStorage 防误关丢失）──

export interface OfflineEntry {
    /** scene = 场景旁白；char = 角色言行；user = 用户言行 */
    role: 'scene' | 'char' | 'user';
    text: string;
    at: number;
}

export interface OfflineCommitInfo {
    messageId: number;
    timestamp: number;
}

export interface OfflineGeneratedTextResult {
    /** 可写入线下情景记录的正文 */
    content: string;
    /** 命中的主动点饭票描述；undefined 表示未命中 */
    takeoutDesc?: string;
}

/** 线下模式生成文本入记录前的轻量业务指令处理。 */
export const prepareOfflineGeneratedText = (content: string): OfflineGeneratedTextResult => {
    const takeout = extractTakeoutOrderDirective(content);
    return { content: takeout.content, takeoutDesc: takeout.desc };
};

export const loadOfflineSession = (charId: string): OfflineEntry[] => {
    try {
        const raw = localStorage.getItem(sessionKey(charId));
        const parsed = raw ? JSON.parse(raw) : null;
        return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
};

export const saveOfflineSession = (charId: string, entries: OfflineEntry[]): void => {
    try { localStorage.setItem(sessionKey(charId), JSON.stringify(entries)); } catch { /* ignore */ }
    if (entries.length > 0) markOfflineSessionActive(charId);
};

export const clearOfflineSession = (charId: string): void => {
    try {
        localStorage.removeItem(sessionKey(charId));
        localStorage.removeItem(activeKey(charId));
        // 结束线下后也清掉兜底 pending，避免旧自动开场在下次进聊天时把已结束的现场重新弹出来。
        localStorage.removeItem(pendingKey(charId));
        localStorage.removeItem(pendingScenarioKey(charId));
    } catch { /* ignore */ }
    emitOfflineSessionState(charId, false);
};

export const hasOfflineSession = (charId: string): boolean => loadOfflineSession(charId).length > 0;

export const markOfflineSessionActive = (charId: string): void => {
    let wasActive = false;
    try {
        wasActive = localStorage.getItem(activeKey(charId)) === '1';
        localStorage.setItem(activeKey(charId), '1');
    } catch { /* ignore */ }
    if (!wasActive) emitOfflineSessionState(charId, true);
};

export const isOfflineSessionActive = (charId: string): boolean => {
    try {
        return localStorage.getItem(activeKey(charId)) === '1' || hasOfflineSession(charId);
    } catch {
        return hasOfflineSession(charId);
    }
};

// ── 线下叙述人称（POV）：角色 / 用户 各可选 第一/第二/第三人称，自由组合 ──

export type OfflinePovPerson = 'first' | 'second' | 'third';
export interface OfflinePov { char: OfflinePovPerson; user: OfflinePovPerson }

/** 默认：双方都第三人称（沿用旧的「第三人称旁白」行为）。 */
export const DEFAULT_OFFLINE_POV: OfflinePov = { char: 'third', user: 'third' };
const povKey = (charId: string) => `moro_offline_pov_${charId}`;
const isPerson = (v: any): v is OfflinePovPerson => v === 'first' || v === 'second' || v === 'third';

// ── 线下字数上限：默认 1200；用户填多少就按多少传给模型，不设额外上限 ──

export interface OfflineWordLimit { maxChars?: number }

export const DEFAULT_OFFLINE_WORD_LIMIT = 1200;
export const OFFLINE_WORD_LIMIT_MIN = 20;
const OFFLINE_REASONING_TOKEN_HEADROOM_MIN = 1200;

const wordLimitKey = (charId: string) => `moro_offline_word_limit_${charId}`;

export const normalizeOfflineWordLimitValue = (value: unknown): number | undefined => {
    if (value === '' || value === null || value === undefined) return undefined;
    const n = typeof value === 'number' ? value : parseInt(String(value), 10);
    if (!Number.isFinite(n) || n <= 0) return undefined;
    return Math.max(OFFLINE_WORD_LIMIT_MIN, Math.round(n));
};

export const normalizeOfflineWordLimit = (limit?: OfflineWordLimit | null): OfflineWordLimit => {
    const maxChars = normalizeOfflineWordLimitValue(limit?.maxChars);
    return maxChars ? { maxChars } : {};
};

export const loadOfflineWordLimit = (charId: string): OfflineWordLimit => {
    try {
        const raw = localStorage.getItem(wordLimitKey(charId));
        const parsed = raw ? JSON.parse(raw) : null;
        return normalizeOfflineWordLimit(parsed);
    } catch { /* ignore */ }
    return {};
};

export const saveOfflineWordLimit = (charId: string, limit: OfflineWordLimit): void => {
    try {
        const normalized = normalizeOfflineWordLimit(limit);
        if (normalized.maxChars) localStorage.setItem(wordLimitKey(charId), JSON.stringify(normalized));
        else localStorage.removeItem(wordLimitKey(charId));
    } catch { /* ignore */ }
};

export const formatOfflineLengthRange = (limit: OfflineWordLimit | undefined, defaultRange: string): string => {
    const maxChars = normalizeOfflineWordLimit(limit).maxChars;
    return maxChars ? `不超过${maxChars}字` : defaultRange;
};

export const offlineWordLimitRule = (limit?: OfflineWordLimit): string => {
    const maxChars = normalizeOfflineWordLimit(limit).maxChars;
    return maxChars ? `- 字数上限是 ${maxChars} 字，宁可短一点，也不要超过这个上限；\n` : '';
};

export const resolveOfflineVisibleCharLimit = (limit?: OfflineWordLimit): number =>
    normalizeOfflineWordLimit(limit).maxChars ?? DEFAULT_OFFLINE_WORD_LIMIT;

export const resolveOfflineRequestTokenBudget = (limit?: OfflineWordLimit): number => {
    const visibleChars = resolveOfflineVisibleCharLimit(limit);
    const reasoningHeadroom = Math.max(OFFLINE_REASONING_TOKEN_HEADROOM_MIN, Math.ceil(visibleChars * 0.75));
    return visibleChars + reasoningHeadroom;
};

export const loadOfflinePov = (charId: string): OfflinePov => {
    try {
        const raw = localStorage.getItem(povKey(charId));
        const parsed = raw ? JSON.parse(raw) : null;
        if (parsed && isPerson(parsed.char) && isPerson(parsed.user)) return parsed;
    } catch { /* ignore */ }
    return DEFAULT_OFFLINE_POV;
};

export const saveOfflinePov = (charId: string, pov: OfflinePov): void => {
    try { localStorage.setItem(povKey(charId), JSON.stringify(pov)); } catch { /* ignore */ }
};

const refWord = (p: OfflinePovPerson, name: string): string => {
    if (p === 'first') return `第一人称「我」`;
    if (p === 'second') return `第二人称「你」`;
    return `第三人称「${name}」（或 TA）`;
};

/** 生成「叙述人称」段，告诉模型如何指代角色与用户，全程保持一致。 */
export const buildPovInstruction = (pov: OfflinePov, charName: string, userName: string): string =>
    `### [叙述人称]
这段线下情景请严格用以下人称叙述，全程保持一致：
- 指代「${charName}」时，用${refWord(pov.char, charName)}；
- 指代「${userName}」时，用${refWord(pov.user, userName)}。
动作、神态、台词和场景旁白都遵循这个人称视角（例如角色用第一人称时，TA 的动作写成「我……」）。`;

const formatEntries = (entries: OfflineEntry[], charName: string, userName: string): string =>
    entries.map(e => {
        if (e.role === 'scene') return `（旁白）${e.text}`;
        return `${e.role === 'char' ? charName : userName}：${e.text}`;
    }).join('\n');

interface OfflineApi {
    baseUrl: string;
    apiKey: string;
    model: string;
    apiRole?: 'main' | 'aux' | 'custom';
    apiBinding?: string;
}

const OFFLINE_DIRECT_OUTPUT_USER = '请根据上面的全部规则，直接输出本轮线下现场正文，不要前缀或解释。';
const OFFLINE_LLM_CONTINUE_ROUNDS = 2;

const callLLM = async (
    api: OfflineApi,
    prompt: string,
    temperature = 0.9,
    presetMacros?: PresetMacroCtx,
    char?: Pick<CharacterProfile, 'id' | 'name'>,
    maxTokens = resolveOfflineRequestTokenBudget(),
): Promise<string> => {
    return (await completeText(api, [
        { role: 'system', content: prompt },
        { role: 'user', content: OFFLINE_DIRECT_OUTPUT_USER },
    ], {
        temperature,
        maxTokens,
        preserveMaxTokens: true,
        continueRounds: OFFLINE_LLM_CONTINUE_ROUNDS,
        presetScope: 'creative.text',
        presetMacros,
        meta: makeApiUsageMeta('chat.offlineMode', {
            apiRole: api.apiRole || 'main',
            apiBinding: api.apiBinding,
            charId: char?.id,
            charName: char?.name,
        }),
    })).trim();
};

const buildOfflineBase = async (char: CharacterProfile, userProfile: UserProfile): Promise<string> => {
    const core = await ContextBuilder.buildFullCoreContext(char, userProfile, true);
    const recent = await DB.getRecentMessagesByCharId(char.id, 30).catch(() => [] as Message[]);
    const recentLines = recent
        .filter(m => m.role !== 'system' && typeof m.content === 'string')
        .slice(-20)
        .map(m => `${m.role === 'user' ? userProfile.name : char.name}: ${String(m.content).slice(0, 200)}`)
        .join('\n');
    // 实时感知·线下（会话设置）：开启后把当前真实时间告诉模型，让线下场景贴着现实钟点。
    let clockBlock = '';
    if (char.convoSettings?.realtimeClockOffline) {
        try {
            const t = RealtimeContextManager.getTimeContext();
            clockBlock = `\n\n### [当前真实时间]\n现在是 ${t.dateStr} ${t.dayOfWeek} ${t.timeOfDay} ${t.timeStr}，这场见面就发生在此刻，请让环境、光线和你们的状态贴合这个时间。`;
        } catch { /* 取时间失败时静默跳过 */ }
    }
    return `${core}

### [最近的线上聊天]
${recentLines || '（你们还没怎么聊过）'}

### [线下模式]
你们刚刚还在线上聊天（见上面[最近的线上聊天]），现在对话发展到了见面情境，切换成线下面对面模式。
**这场见面是上面那段线上聊天的直接延续**，请把它当成同一段关系、同一条时间线上的事：
- 承接线上聊到的话题、约定、心情和未说完的话，自然延续，而不是另起一段毫无关联的剧情；
- 记得你们线上是什么关系、聊到哪儿了，见面时的熟悉度、语气、称呼都要和线上一致；
- 线上挖的坑（约好要做的事、想问的话、暧昧或别扭的气氛）可以在见面时被自然地呼应或解开；
- 现场反应要像真人刚碰面：先看见对方、听见周围声音、注意到衣着/气味/天气/手里的东西，再决定怎么开口或靠近，不要直接跳成总结、告白或大段独白；
- 关系没到的地方不要硬亲密，性格克制的人可以尴尬、嘴硬、岔开，熟悉的人也可以用玩笑、沉默或顺手的小动作表达。
- 如果确实需要使用系统指令（例如主动点饭票的 [[TAKEOUT_ORDER: ...]]），必须放在整段输出最后单独一行，不要写进角色台词或场景旁白里，也不要解释指令本身。
接下来的内容是你们真实见面时发生的现场互动，以「对话 + 动作/场景旁白」推进。文字要自然、具体、有生活气，避免舞台剧报幕、小说腔排比和过度煽情。${clockBlock}`;
};

// ── 线下开场白方式（见面是怎么开始的）──────────────────────────────
// 同一个「见面」可以有不同的起手式：是 user 找上门、char 找上门、还是不期而遇…
// 选一种，开场情景就按那种方式来写。纯手动选择，无开关。

export type OfflineOpeningPreset = 'approach' | 'visit' | 'encounter' | 'appointment' | 'custom';

export const OFFLINE_OPENING_PRESETS: {
    key: OfflineOpeningPreset; label: string; emoji: string; desc: string; frame: string;
}[] = [
    {
        key: 'approach', label: '靠近', emoji: '🚶', desc: '{user} 去找 {char} 见面',
        frame: '这场见面由 {user} 主动发起：{user} 出门去找 {char}。开场写 {user} 抵达 {char} 所在的地方、出现在 TA 面前的那一刻——{char} 没料到（或正盼着）{user} 来时的第一反应。',
    },
    {
        key: 'visit', label: '造访', emoji: '🚪', desc: '{char} 来找 {user}',
        frame: '这场见面由 {char} 主动登门：{char} 来找 {user}（敲门、等在楼下、忽然出现等）。开场写 TA 出现在 {user} 面前的样子，以及 TA 上门的理由与神态。',
    },
    {
        key: 'encounter', label: '偶遇', emoji: '✨', desc: '哇好巧，不期而遇',
        frame: '这是一场毫无预约的偶遇：两人在某个公共场合（街角、便利店、地铁、书店、雨檐下等）撞了个正着，谁都没想到会在这里遇见对方。开场写那份「怎么会是你」的意外，和心照不宣的惊喜。',
    },
    {
        key: 'appointment', label: '赴约', emoji: '🤝', desc: '之前约好了，双向奔赴',
        frame: '两人此前在线上就约好了要见面（请参考最近聊天里关于见面的约定/暗示）。现在到了约定的时间地点，双方都赶来赴约、终于碰头。开场写那份期待落地、向彼此奔去的心情。',
    },
    {
        key: 'custom', label: '自定义', emoji: '✍️', desc: '自己写这场见面怎么开始',
        frame: '',
    },
];

/** 把某个开场白方式解析成喂给模型的「开场设定」文字（替换好 user/char 名）。 */
export const resolveOpeningFrame = (
    preset: OfflineOpeningPreset, customText: string | undefined, charName: string, userName: string,
): string => {
    if (preset === 'custom') return (customText || '').trim();
    const def = OFFLINE_OPENING_PRESETS.find(p => p.key === preset);
    if (!def) return '';
    return def.frame.replace(/\{char\}/g, charName).replace(/\{user\}/g, userName);
};

/** 线下开场：生成见面的开场情景（旁白 + 角色的第一句话/动作） */
export const generateOfflineOpening = async (
    char: CharacterProfile, userProfile: UserProfile, api: OfflineApi, pov?: OfflinePov, scenario?: string, rerollPrevious?: string, wordLimit?: OfflineWordLimit,
): Promise<string> => {
    const base = await buildOfflineBase(char, userProfile);
    const povText = buildPovInstruction(pov ?? loadOfflinePov(char.id), char.name, userProfile.name);
    const lengthRange = formatOfflineLengthRange(wordLimit, '120-250字');
    const lengthRule = offlineWordLimitRule(wordLimit);
    const outputBudget = resolveOfflineRequestTokenBudget(wordLimit);
    const sceneFrame = scenario && scenario.trim()
        ? `\n### [这场见面是怎么开始的]\n${scenario.trim()}\n请严格按这个方式来安排开场。\n`
        : '';
    const rerollBlock = rerollPrevious?.trim()
        ? `\n### [这次是重写]\n上一版开场已经被用户撤回：\n${rerollPrevious.trim().slice(0, 1200)}\n请保留同一场见面的基本关系和时间线，但换一种角度、动作和措辞重新写，不要照抄上一版，也不要故意反着写成突兀剧情。\n`
        : '';
    return callLLM(api, `${base}

${povText}
${sceneFrame}
${rerollBlock}
### [任务]
写出见面那一刻的开场（${lengthRange}）：
${lengthRule}
- 交代你们在哪里见面、现场的环境氛围${sceneFrame ? '（按上面「这场见面是怎么开始的」来安排，地点要与之相符）' : '（基于最近聊天里约定/暗示的地点，没有就合理推断一个）'}，但只写会被当场注意到的细节；
- 承接最近线上聊天里的约定、情绪或未说完的话，让这场见面像顺着上一句聊天自然发生；
- 写「${char.name}」见到 ${userProfile.name} 的第一反应：一个具体动作/神态 + 一句贴合人设的开口，可以短、可以别扭、可以有停顿；
- 不要替 ${userProfile.name} 说话或行动，不要把双方关系突然推进到人设不支持的亲密程度。
按上面 [叙述人称] 的要求叙述，旁白 + 角色台词混排，直接输出正文，不要任何前缀或解释。`, 0.9, { charName: char.name, userName: userProfile.name || '你' }, char, outputBudget);
};

/** 线下推进：根据用户的行动/发言（或无输入时角色自主行动）生成角色的下一段现场反应 */
export const generateOfflineTurn = async (
    char: CharacterProfile, userProfile: UserProfile, api: OfflineApi,
    entries: OfflineEntry[], userInput?: string, pov?: OfflinePov, rerollPrevious?: string, wordLimit?: OfflineWordLimit,
): Promise<string> => {
    const base = await buildOfflineBase(char, userProfile);
    const povText = buildPovInstruction(pov ?? loadOfflinePov(char.id), char.name, userProfile.name);
    const lengthRange = formatOfflineLengthRange(wordLimit, '80-200字');
    const lengthRule = offlineWordLimitRule(wordLimit);
    const outputBudget = resolveOfflineRequestTokenBudget(wordLimit);
    const transcript = formatEntries(entries, char.name, userProfile.name);
    const tail = userInput
        ? `刚刚 ${userProfile.name} 的行动/发言：${userInput}`
        : `${userProfile.name} 暂时没有行动，由「${char.name}」主动推进现场（说点什么、做点什么、或带着对方做点什么）。`;
    const rerollBlock = rerollPrevious?.trim()
        ? `\n### [这次是重写]\n上一版续写已经被用户撤回：\n${rerollPrevious.trim().slice(0, 1200)}\n请基于同一个现场重新接这一拍，保留前文事实和用户刚刚的行动/发言，但换一种更自然的反应、动作和措辞，不要照抄上一版。\n`
        : '';
    return callLLM(api, `${base}

${povText}

### [线下现场已发生的情景]
${transcript || '（刚见面）'}

${tail}
${rerollBlock}

### [任务]
以「${char.name}」的身份续写现场接下来的一小段（${lengthRange}）：
${lengthRule}
- 先回应 ${userProfile.name} 刚刚的行动/发言，再用一个很小的动作、神态或环境细节把现场往前推；
- 台词像真人面对面说话，可以短句、停顿、没说完、临时改口，不要每次都工整抒情；
- 可以让「${char.name}」主动做点符合人设的事（递东西、让路、靠近/退开、转移话题、带着走），但不要替 ${userProfile.name} 说话或行动；
- 保持当前关系的边界和熟悉度，不要硬转暧昧、硬制造冲突，也不要把现场写成剧情总结。
按上面 [叙述人称] 的要求叙述，直接输出正文，不要任何前缀或解释。`, 0.9, { charName: char.name, userName: userProfile.name || '你' }, char, outputBudget);
};

/** 结束线下模式：把窗口内全部情景合成一条 system 消息落库（进入上下文） */
export const commitOfflineSessionToContext = async (
    char: CharacterProfile, userName: string, entries: OfflineEntry[],
): Promise<OfflineCommitInfo | null> => {
    if (!entries.length) return null;
    const transcript = formatEntries(entries, char.name, userName);
    const timestamp = Date.now();
    const messageId = await DB.saveMessage({
        charId: char.id,
        role: 'system',
        type: 'text',
        content: `[线下模式记录] 你（${char.name}）和 ${userName} 刚刚线下见面。现场简记如下：\n${transcript}`,
        metadata: { offlineSession: true },
        timestamp,
    } as any);
    return { messageId, timestamp };
};
