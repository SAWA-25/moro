/**
 * 折子戏·谈心（heart-to-heart）。
 * ================================
 * 给 user 一个被认真倾听、被安慰的地方：选一个角色，把心里话说出来，
 * 角色以格外温柔、专注、共情的姿态陪着 TA。重点是「被接住」，不是被说教。
 *
 * 复用主/副 API（调用方用 resolveAuxApi 解析好），失败抛错由调用方兜底。
 * 📌 prompt 文案集中在 utils/theaterPrompts.ts（[肆] 谈心 区段），改文案去那里。
 */

import { CharacterProfile, UserProfile, TalkTurn } from '../types';
import type { ResolvedApi } from './auxApi';
import { ContextBuilder } from './context';
import { safeResponseJson, extractContent } from './safeApi';
import { talkSystemPrompt, talkOpeningUser, talkReplyUser } from './theaterPrompts';

const talkSystem = (char: CharacterProfile, userProfile: UserProfile, mood?: string): string => {
    const core = ContextBuilder.buildCoreContext(char, userProfile, true);
    const userName = (userProfile.name || '').trim() || '对方';
    return talkSystemPrompt({ core, charName: char.name, userName, mood });
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
    const user = talkOpeningUser({ userName, charName: char.name, mood });
    return callLLM(api, talkSystem(char, userProfile, mood), user);
};

/** 谈心推进：根据已有对话与 user 这次说的话，生成角色温柔的回应。 */
export const generateTalkReply = async (
    char: CharacterProfile, userProfile: UserProfile, api: ResolvedApi,
    turns: TalkTurn[], userInput: string, mood?: string,
): Promise<string> => {
    const userName = (userProfile.name || '').trim() || '对方';
    const hist = transcript(turns, char.name, userName);
    const user = talkReplyUser({ hist, userName, charName: char.name, userInput });
    return callLLM(api, talkSystem(char, userProfile, mood), user);
};
