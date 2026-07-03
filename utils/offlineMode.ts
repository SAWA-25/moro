import { CharacterProfile, UserProfile, Message } from '../types';
import { DB } from './db';
import { ContextBuilder } from './context';
import { extractContent } from './safeApi';
import { RealtimeContextManager } from './realtimeContext';
import { callChatCompletion } from './llmClient';
import { makeApiUsageMeta } from './apiUsageCatalog';
import { extractTakeoutOrderDirective } from './takeout';

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

export const OFFLINE_START_RE = /\[\[\s*OFFLINE_START\s*\]\]/gi;
export const OFFLINE_START_EVENT = 'moro-offline-start';

const pendingKey = (charId: string) => `moro_offline_pending_${charId}`;
const sessionKey = (charId: string) => `moro_offline_session_${charId}`;
export const OFFLINE_FOLLOWUP_DELAY_MS = 5 * 60 * 1000;

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

interface OfflineApi {
    baseUrl: string;
    apiKey: string;
    model: string;
    apiRole?: 'main' | 'aux' | 'custom';
    apiBinding?: string;
}

const callLLM = async (api: OfflineApi, prompt: string, temperature = 0.9): Promise<string> => {
    const data = await callChatCompletion(api, {
        model: api.model,
        messages: [{ role: 'user', content: prompt }],
        temperature,
    }, {
        meta: makeApiUsageMeta('chat.offlineMode', {
            apiRole: api.apiRole || 'main',
            apiBinding: api.apiBinding,
        }),
    });
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
    char: CharacterProfile, userProfile: UserProfile, api: OfflineApi, pov?: OfflinePov, scenario?: string,
): Promise<string> => {
    const base = await buildOfflineBase(char, userProfile);
    const povText = buildPovInstruction(pov ?? loadOfflinePov(char.id), char.name, userProfile.name);
    const sceneFrame = scenario && scenario.trim()
        ? `\n### [这场见面是怎么开始的]\n${scenario.trim()}\n请严格按这个方式来安排开场。\n`
        : '';
    return callLLM(api, `${base}

${povText}
${sceneFrame}
### [任务]
写出见面那一刻的开场（120-250字）：
- 交代你们在哪里见面、现场的环境氛围${sceneFrame ? '（按上面「这场见面是怎么开始的」来安排，地点要与之相符）' : '（基于最近聊天里约定/暗示的地点，没有就合理推断一个）'}，但只写会被当场注意到的细节；
- 承接最近线上聊天里的约定、情绪或未说完的话，让这场见面像顺着上一句聊天自然发生；
- 写「${char.name}」见到 ${userProfile.name} 的第一反应：一个具体动作/神态 + 一句贴合人设的开口，可以短、可以别扭、可以有停顿；
- 不要替 ${userProfile.name} 说话或行动，不要把双方关系突然推进到人设不支持的亲密程度。
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
以「${char.name}」的身份续写现场接下来的一小段（80-200字）：
- 先回应 ${userProfile.name} 刚刚的行动/发言，再用一个很小的动作、神态或环境细节把现场往前推；
- 台词像真人面对面说话，可以短句、停顿、没说完、临时改口，不要每次都工整抒情；
- 可以让「${char.name}」主动做点符合人设的事（递东西、让路、靠近/退开、转移话题、带着走），但不要替 ${userProfile.name} 说话或行动；
- 保持当前关系的边界和熟悉度，不要硬转暧昧、硬制造冲突，也不要把现场写成剧情总结。
按上面 [叙述人称] 的要求叙述，直接输出正文，不要任何前缀或解释。`);
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
        content: `[线下模式记录] 你（${char.name}）和 ${userName} 刚刚线下见面了，下面是这次见面现场发生的全部情景。`
            + `见面已经结束，这段经历已经写入你们共同的上下文，但这不是要求你立刻补一条线上消息。`
            + `之后线上接着聊时，可以自然提起见面时的细节、延续当时的心情和话题；如果刚才有尴尬、未说完、好笑或亲近的瞬间，可以像真人事后回味那样轻轻带到聊天里。`
            + `严格保持时间边界：没有在下面记录中明确发生的外卖送达、快递到达、电话接通、约定完成等事件，都还不能说成已经发生。不要表现得好像没见过面，也不要把这段经历硬写成总结报告。\n${transcript}`,
        metadata: { offlineSession: true },
        timestamp,
    } as any);
    return { messageId, timestamp };
};
