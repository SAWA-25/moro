/**
 * 小剧场·谈心（heart-to-heart）。
 * ================================
 * 给 user 一个被认真倾听、被安慰的地方：选一个角色，把心里话说出来，
 * 角色以格外温柔、专注、共情的姿态陪着 TA。重点是「被接住」，不是被说教。
 *
 * 复用主/副 API（调用方用 resolveAuxApi 解析好），prompt 短、失败抛错由调用方兜底。
 */

import { CharacterProfile, UserProfile, TalkTurn } from '../types';
import type { ResolvedApi } from './auxApi';
import { ContextBuilder } from './context';
import { safeResponseJson, extractContent } from './safeApi';

const talkSystem = (char: CharacterProfile, userProfile: UserProfile, mood?: string): string => {
    const core = ContextBuilder.buildCoreContext(char, userProfile, true);
    const userName = (userProfile.name || '').trim() || '对方';
    const moodLine = mood ? `\n${userName} 此刻的状态：${mood}。请贴着这个情绪来接。` : '';
    return `${core}

### [谈心模式]
现在是一个安静、安全、被柔光包裹的「谈心」空间。${userName} 来找你说说心里话，需要被倾听、被理解、被安慰。${moodLine}
请以「${char.name}」的身份，做一个温柔、专注、共情的倾听者：
- 先接住 ${userName} 的情绪（认可、共情、不评判、不讲大道理、不急着给一堆"你应该…"的建议），再轻轻回应。
- 多倾听、少灌输；语气保持你的人设，但格外柔软、有耐心，像真的在面对面陪着 TA。
- 可有极少量轻柔的动作/神态描写（最多一两处），但重点永远是话语本身。
- 一次只说一小段（大约 2-5 句）。
- 如果 ${userName} 流露出强烈的自我伤害念头，温柔地表达担心、陪伴，并轻轻鼓励 TA 向身边信任的人或专业求助热线倾诉，不要说教。
直接输出你此刻想对 ${userName} 说的话，不要任何前缀、不要 JSON、不要旁白标签。`;
};

const callLLM = async (api: ResolvedApi, system: string, user: string): Promise<string> => {
    const baseUrl = (api.baseUrl || '').replace(/\/+$/, '');
    if (!baseUrl || !api.model) throw new Error('请先在「文具盒」里配置 API');
    const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${api.apiKey || 'sk-none'}` },
        body: JSON.stringify({
            model: api.model,
            messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
            temperature: 0.85,
            max_tokens: 500,
            stream: false,
        }),
    });
    if (!res.ok) throw new Error(`API ${res.status}`);
    const data = await safeResponseJson(res);
    return (extractContent(data) || '').trim();
};

const transcript = (turns: TalkTurn[], charName: string, userName: string): string =>
    turns.map(t => `${t.role === 'user' ? userName : charName}：${t.text}`).join('\n');

/** 谈心开场：角色温柔地把这个空间打开（接住此刻的心情，邀请 user 慢慢说）。 */
export const generateTalkOpening = async (
    char: CharacterProfile, userProfile: UserProfile, api: ResolvedApi, mood?: string,
): Promise<string> => {
    const userName = (userProfile.name || '').trim() || '对方';
    const user = `${userName} 刚刚走进这个谈心空间，还没开口${mood ? `，看起来${mood}` : ''}。请以「${char.name}」的身份，先温柔地把这个空间打开——让 TA 感到安全、被欢迎，可以慢慢说。简短、自然、贴合人设。`;
    return callLLM(api, talkSystem(char, userProfile, mood), user);
};

/** 谈心推进：根据已有对话与 user 这次说的话，生成角色温柔的回应。 */
export const generateTalkReply = async (
    char: CharacterProfile, userProfile: UserProfile, api: ResolvedApi,
    turns: TalkTurn[], userInput: string, mood?: string,
): Promise<string> => {
    const userName = (userProfile.name || '').trim() || '对方';
    const hist = transcript(turns, char.name, userName);
    const user = `### [谈心记录]
${hist || '（刚开始）'}

${userName} 刚刚说：${userInput}

请以「${char.name}」的身份，温柔地回应这句话。`;
    return callLLM(api, talkSystem(char, userProfile, mood), user);
};
