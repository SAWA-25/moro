/**
 * 街角 · 约会世界引擎 (Date World Engine)
 * =======================================
 * char 带着 user 在场景里溜达的日常陪伴向约会。**副 API 当世界引擎**：每回合在角色的
 * 回应之外，还负责"场景调度"（让街角活起来：光线变化、路过的小贩、天气、走到了哪里），
 * 并给出一个"当前氛围"关键词供生成专属 BGM。
 *
 * 设计要点：
 * - 日常陪伴向，不强行制造大戏；节奏松弛、有生活质感。
 * - user 的「话」和「动作」分开输入，角色要**一一回应**（先接话、再接动作，或交织着接）。
 * - 每 20 回合把上文总结成 recap、隐藏旧消息，保证低 token 的灵动感。
 */

import { CharacterProfile, UserProfile, DateScene, DateWorldline, DateMessage } from '../types';
import { safeFetchJson, extractJson } from './safeApi';

export interface DateApiConfig { baseUrl: string; apiKey: string; model: string }

/** 每多少回合做一次总结 + 隐藏上文 */
export const DATE_RECAP_EVERY = 20;
/** 总结后可见区保留的尾部回合数（保上下文连续） */
export const DATE_KEEP_TAIL = 6;

const genId = () => `d_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

// ── 内置场景 ──────────────────────────────────────────────
export const BUILTIN_DATE_SCENES: DateScene[] = [
    { id: 'sc_cafe', name: '午后咖啡馆', emoji: '☕', builtin: true, vibe: '午后斜光、咖啡香、低声细语的慵懒', opening: '推开门，铃铛轻响。靠窗的位置空着，阳光斜斜地铺在木桌上，咖啡机在低声咕哝。' },
    { id: 'sc_seaside', name: '海边栈道', emoji: '🌊', builtin: true, vibe: '海风、浪声、咸湿的黄昏暖光', opening: '木栈道一直伸向海里，风把头发吹乱。远处的太阳正往海平面沉，把云染成橘子味。' },
    { id: 'sc_nightmarket', name: '夜市', emoji: '🏮', builtin: true, vibe: '暖黄灯串、人声鼎沸、热腾腾的烟火气', opening: '灯串一盏接一盏亮起来，烤串的烟混着糖炒栗子的甜。人很多，你们被人流推着挨得很近。' },
    { id: 'sc_bookstore', name: '旧书店', emoji: '📚', builtin: true, vibe: '旧纸页味、安静、并肩翻书的默契', opening: '木梯靠在高高的书架上，空气里全是旧纸的味道。店里只有你们和打盹的店猫。' },
    { id: 'sc_rain', name: '雨天街角', emoji: '🌧️', builtin: true, vibe: '一把伞、湿漉漉的街、不得不靠近的暧昧', opening: '雨突然大了。屋檐下只够站两个人，一把伞撑开，你们的肩膀不可避免地贴在一起。' },
    { id: 'sc_rooftop', name: '天台夜景', emoji: '🌃', builtin: true, vibe: '晚风、远处霓虹、整座城在脚下的辽阔', opening: '天台没什么人。晚风很凉，远处的霓虹一片一片亮着，整座城像摊开的星海。' },
    { id: 'sc_sakura', name: '樱花树下', emoji: '🌸', builtin: true, vibe: '花瓣纷飞、春日微暖、慢慢走的温柔', opening: '一整条路都是樱花。风一过，花瓣纷纷往下落，落在肩上、发间。你们走得很慢。' },
    { id: 'sc_konbini', name: '深夜便利店', emoji: '🌙', builtin: true, vibe: '冷白灯、关东煮的热气、深夜独属两个人的安静', opening: '凌晨的便利店只有你们。关东煮的热气糊在玻璃上，店里循环着不知名的轻音乐。' },
];

export function makeCustomScene(name: string, vibe: string, emoji = '✨'): DateScene {
    return { id: `sc_custom_${genId()}`, name: name.trim() || '自定义场景', emoji: emoji || '✨', vibe: vibe.trim() || '随心所欲的氛围', opening: '', builtin: false };
}

// ── 消息格式化 ────────────────────────────────────────────
function fmtMessages(messages: DateMessage[], char: CharacterProfile, user: UserProfile): string {
    return messages.map(m => {
        if (m.role === 'world') return `〔场景〕${m.action || ''}`.trim();
        const who = m.role === 'user' ? user.name : char.name;
        const parts: string[] = [];
        if (m.speech) parts.push(`说："${m.speech}"`);
        if (m.action) parts.push(`（${m.action}）`);
        return `${who} ${parts.join(' ')}`.trim();
    }).filter(Boolean).join('\n');
}

// ── 回合 prompt ───────────────────────────────────────────
function personaBlock(char: CharacterProfile): string {
    return [
        char.systemPrompt ? `角色性格/设定：\n${char.systemPrompt}` : '',
        char.worldview ? `世界观：\n${char.worldview}` : '',
        char.lifeProfile?.content ? `角色生活侧写：\n${char.lifeProfile.content}` : '',
    ].filter(Boolean).join('\n\n');
}

export function buildDateTurnPrompt(
    char: CharacterProfile,
    user: UserProfile,
    scene: DateScene,
    worldline: DateWorldline,
    userSpeech: string,
    userAction: string,
    isFirstTurn: boolean,
): string {
    const recent = fmtMessages(worldline.messages.slice(-(DATE_KEEP_TAIL * 4)), char, user);
    const recapBlock = worldline.recap ? `\n## 之前发生了什么（已浓缩）\n${worldline.recap}\n` : '';
    const userTurn = [
        userSpeech ? `${user.name} 说："${userSpeech}"` : '',
        userAction ? `${user.name} 的动作：（${userAction}）` : '',
    ].filter(Boolean).join('\n') || `${user.name} 只是安静地看着你。`;

    return `你是这场约会的**世界引擎**，同时扮演角色「${char.name}」。这是 ${char.name} 带着「${user.name}」的一次日常陪伴向约会——不是要演大戏，是松弛、有生活质感地待在一起。

${personaBlock(char)}

## 当前场景：${scene.emoji} ${scene.name}
基调：${scene.vibe}
${recapBlock}${recent ? `\n## 最近的来往\n${recent}\n` : (isFirstTurn ? `\n（约会刚开始：${scene.opening}）\n` : '')}

## ${user.name} 这一回合
${userTurn}

## 你要做两件事
1. **以 ${char.name} 的口吻回应**——${user.name} 的「话」和「动作」都要照顾到（先接住话，再回应动作，或自然交织），贴着人设的语气、分寸、棱角。日常、具体、有温度，别套话别浮夸。
2. **作为世界引擎，轻轻调度场景**（可选）——让街角活着：光线/天气的变化、路过的人或小动物、走到了新的地方、一个可以延续的小契机。**克制**，不喧宾夺主，没必要就留空。

另外给出此刻的**氛围关键词**（用于生成专属 BGM），如"微醺暖黄""雨后清冷""暧昧涌动""安静依偎"。${isFirstTurn ? '并取一个 6-12 字的世界线标题。' : ''}

只输出 JSON：
{
  "char_speech": "${char.name} 说出口的话（没有就空字符串）",
  "char_action": "${char.name} 的动作/神态/旁白（第三人称，简短）",
  "world": "世界引擎的场景旁白（可选，没有就空字符串）",
  "vibe": "此刻氛围关键词（≤8字）"${isFirstTurn ? ',\n  "title": "世界线标题（6-12字）"' : ''}
}`;
}

export interface DateTurnResult {
    charSpeech: string;
    charAction: string;
    world: string;
    vibe: string;
    title?: string;
}

export async function runDateTurn(
    api: DateApiConfig,
    char: CharacterProfile,
    user: UserProfile,
    scene: DateScene,
    worldline: DateWorldline,
    userSpeech: string,
    userAction: string,
): Promise<DateTurnResult | null> {
    const isFirstTurn = worldline.messages.length === 0;
    const prompt = buildDateTurnPrompt(char, user, scene, worldline, userSpeech, userAction, isFirstTurn);
    try {
        const data = await safeFetchJson(
            `${api.baseUrl.replace(/\/+$/, '')}/chat/completions`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${api.apiKey || 'sk-none'}` },
                body: JSON.stringify({
                    model: api.model,
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.9,
                    max_tokens: 1500,
                    stream: false,
                }),
            },
            2, 0, { appName: '街角', charId: char.id, charName: char.name, purpose: '约会世界引擎' },
        );
        const raw = data.choices?.[0]?.message?.content || '';
        const parsed = extractJson(raw);
        if (!parsed) return null;
        const charSpeech = typeof parsed.char_speech === 'string' ? parsed.char_speech.trim() : '';
        const charAction = typeof parsed.char_action === 'string' ? parsed.char_action.trim() : '';
        const world = typeof parsed.world === 'string' ? parsed.world.trim() : '';
        const vibe = typeof parsed.vibe === 'string' ? parsed.vibe.trim().slice(0, 16) : '';
        const title = typeof parsed.title === 'string' ? parsed.title.trim().slice(0, 24) : undefined;
        if (!charSpeech && !charAction && !world) return null;
        return { charSpeech, charAction, world, vibe, title };
    } catch (e: any) {
        console.warn('💞 [DateEngine] turn failed:', e?.message || e);
        return null;
    }
}

// ── 20 回合总结（隐藏上文） ────────────────────────────────
export async function runDateRecap(
    api: DateApiConfig,
    char: CharacterProfile,
    user: UserProfile,
    scene: DateScene,
    worldline: DateWorldline,
): Promise<string | null> {
    const prior = fmtMessages(worldline.messages.slice(0, -DATE_KEEP_TAIL), char, user);
    if (!prior.trim()) return null;
    const prevRecap = worldline.recap ? `已有的浓缩：\n${worldline.recap}\n\n` : '';
    const prompt = `把「${char.name}」和「${user.name}」这场约会到目前为止的经过，浓缩成一段简明的剧情记录，供世界引擎接着往下写时参考。

场景：${scene.emoji} ${scene.name}（${scene.vibe}）

${prevRecap}这一段的来往：
${prior}

要求：120-220 字，写清楚——他们去了哪/做了什么、关系/情绪推进到哪一步、有没有埋下能延续的小线索。第三人称、客观、别加评价。只输出这段记录。`;
    try {
        const data = await safeFetchJson(
            `${api.baseUrl.replace(/\/+$/, '')}/chat/completions`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${api.apiKey || 'sk-none'}` },
                body: JSON.stringify({ model: api.model, messages: [{ role: 'user', content: prompt }], temperature: 0.5, max_tokens: 600, stream: false }),
            },
            2, 0, { appName: '街角', charId: char.id, charName: char.name, purpose: '约会总结' },
        );
        const txt = (data.choices?.[0]?.message?.content || '').trim();
        return txt.length >= 10 ? txt : null;
    } catch (e: any) {
        console.warn('💞 [DateEngine] recap failed:', e?.message || e);
        return null;
    }
}

/** 由场景 + 当前氛围拼一段 MiniMax 纯音乐 BGM 的风格描述 */
export function buildDateBgmPrompt(scene: DateScene, vibe: string): string {
    const v = (vibe || scene.vibe || '').replace(/[，。、]/g, ', ');
    return [
        'romantic, warm, intimate, gentle, cinematic ambient',
        'soft piano, mellow strings, lo-fi, slow tempo',
        scene.name,
        v,
        'instrumental, no vocals, loopable background music for a quiet date',
    ].filter(Boolean).join(', ').slice(0, 480);
}
