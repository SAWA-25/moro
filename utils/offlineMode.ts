import { CharacterProfile, UserProfile, Message } from '../types';
import { DB } from './db';
import { ContextBuilder } from './context';
import { safeResponseJson, extractContent } from './safeApi';

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
 * 上下文，随后触发角色主动发一条线上消息收尾。
 */

export const OFFLINE_START_RE = /\[\[\s*OFFLINE_START\s*\]\]/gi;
export const OFFLINE_START_EVENT = 'moro-offline-start';

const pendingKey = (charId: string) => `moro_offline_pending_${charId}`;
const sessionKey = (charId: string) => `moro_offline_session_${charId}`;

/** 从 AI 输出中剥离 [[OFFLINE_START]] 指令并返回是否命中 */
export const extractOfflineStartDirective = (content: string): { content: string; offline: boolean } => {
    if (!content) return { content, offline: false };
    OFFLINE_START_RE.lastIndex = 0;
    const offline = OFFLINE_START_RE.test(content);
    if (!offline) return { content, offline: false };
    return { content: content.replace(OFFLINE_START_RE, '').trim(), offline: true };
};

/** 用户不在该角色聊天页时标记 pending，进聊天时兜底弹窗 */
export const setOfflinePending = (charId: string): void => {
    try { localStorage.setItem(pendingKey(charId), '1'); } catch { /* ignore */ }
};
export const consumeOfflinePending = (charId: string): boolean => {
    try {
        const hit = localStorage.getItem(pendingKey(charId)) === '1';
        if (hit) localStorage.removeItem(pendingKey(charId));
        return hit;
    } catch { return false; }
};

// ── 线下场景会话（窗口内的情景记录，落 localStorage 防误关丢失）──

export interface OfflineEntry {
    /** scene = 场景旁白；char = 角色言行；user = 用户言行 */
    role: 'scene' | 'char' | 'user';
    text: string;
    at: number;
}

export const loadOfflineSession = (charId: string): OfflineEntry[] => {
    try {
        const raw = localStorage.getItem(sessionKey(charId));
        const parsed = raw ? JSON.parse(raw) : null;
        return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
};

export const saveOfflineSession = (charId: string, entries: OfflineEntry[]): void => {
    try { localStorage.setItem(sessionKey(charId), JSON.stringify(entries)); } catch { /* ignore */ }
};

export const clearOfflineSession = (charId: string): void => {
    try { localStorage.removeItem(sessionKey(charId)); } catch { /* ignore */ }
};

export const hasOfflineSession = (charId: string): boolean => loadOfflineSession(charId).length > 0;

// ── 线下叙述人称（POV）：角色 / 用户 各可选 第一/第二/第三人称，自由组合 ──

export type OfflinePovPerson = 'first' | 'second' | 'third';
export interface OfflinePov { char: OfflinePovPerson; user: OfflinePovPerson }

/** 默认：双方都第三人称（沿用旧的「第三人称旁白」行为）。 */
export const DEFAULT_OFFLINE_POV: OfflinePov = { char: 'third', user: 'third' };
const povKey = (charId: string) => `moro_offline_pov_${charId}`;
const isPerson = (v: any): v is OfflinePovPerson => v === 'first' || v === 'second' || v === 'third';

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

interface OfflineApi { baseUrl: string; apiKey: string; model: string }

const callLLM = async (api: OfflineApi, prompt: string, temperature = 0.9): Promise<string> => {
    const response = await fetch(`${api.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${api.apiKey}` },
        body: JSON.stringify({
            model: api.model,
            messages: [{ role: 'user', content: prompt }],
            temperature,
        }),
    });
    if (!response.ok) throw new Error(`API ${response.status}`);
    const data = await safeResponseJson(response);
    return (extractContent(data) || '').trim();
};

const buildOfflineBase = async (char: CharacterProfile, userProfile: UserProfile): Promise<string> => {
    const core = ContextBuilder.buildCoreContext(char, userProfile, true);
    const recent = await DB.getRecentMessagesByCharId(char.id, 30).catch(() => [] as Message[]);
    const recentLines = recent
        .filter(m => m.role !== 'system' && typeof m.content === 'string')
        .slice(-20)
        .map(m => `${m.role === 'user' ? userProfile.name : char.name}: ${String(m.content).slice(0, 200)}`)
        .join('\n');
    return `${core}

### [最近的线上聊天]
${recentLines || '（你们还没怎么聊过）'}

### [线下模式]
你们的对话已经发展到见面情境，现在切换到线下面对面模式。接下来的内容是你们真实见面时发生的现场互动，以「对话 + 动作/场景旁白」推进。`;
};

/** 线下开场：生成见面的开场情景（旁白 + 角色的第一句话/动作） */
export const generateOfflineOpening = async (
    char: CharacterProfile, userProfile: UserProfile, api: OfflineApi, pov?: OfflinePov,
): Promise<string> => {
    const base = await buildOfflineBase(char, userProfile);
    const povText = buildPovInstruction(pov ?? loadOfflinePov(char.id), char.name, userProfile.name);
    return callLLM(api, `${base}

${povText}

### [任务]
写出见面那一刻的开场（120-250字）：交代你们在哪里见面、现场的环境氛围（基于最近聊天里约定/暗示的地点，没有就合理推断一个），以及「${char.name}」见到 ${userProfile.name} 的第一反应——动作、神态、说的第一句话，必须完全贴合人设。
按上面 [叙述人称] 的要求叙述，旁白 + 角色台词混排，直接输出正文，不要任何前缀或解释。`);
};

/** 线下推进：根据用户的行动/发言（或无输入时角色自主行动）生成角色的下一段现场反应 */
export const generateOfflineTurn = async (
    char: CharacterProfile, userProfile: UserProfile, api: OfflineApi,
    entries: OfflineEntry[], userInput?: string, pov?: OfflinePov,
): Promise<string> => {
    const base = await buildOfflineBase(char, userProfile);
    const povText = buildPovInstruction(pov ?? loadOfflinePov(char.id), char.name, userProfile.name);
    const transcript = formatEntries(entries, char.name, userProfile.name);
    const tail = userInput
        ? `刚刚 ${userProfile.name} 的行动/发言：${userInput}`
        : `${userProfile.name} 暂时没有行动，由「${char.name}」主动推进现场（说点什么、做点什么、或带着对方做点什么）。`;
    return callLLM(api, `${base}

${povText}

### [线下现场已发生的情景]
${transcript || '（刚见面）'}

${tail}

### [任务]
以「${char.name}」的身份续写现场接下来的一小段（80-200字）：TA 的动作、神态、台词，可穿插简短场景旁白。按上面 [叙述人称] 的要求叙述，节奏自然、贴合人设，不要替 ${userProfile.name} 说话或行动。直接输出正文，不要任何前缀或解释。`);
};

/** 结束线下模式：把窗口内全部情景合成一条 system 消息落库（进入上下文） */
export const commitOfflineSessionToContext = async (
    char: CharacterProfile, userName: string, entries: OfflineEntry[],
): Promise<void> => {
    if (!entries.length) return;
    const transcript = formatEntries(entries, char.name, userName);
    await DB.saveMessage({
        charId: char.id,
        role: 'system',
        type: 'text',
        content: `[线下模式记录] 你们刚刚线下见面了，以下是现场发生的全部情景（已结束，现在回到线上聊天）：\n${transcript}`,
        metadata: { offlineSession: true },
    } as any);
};
