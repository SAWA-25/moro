/**
 * 折子戏·谈心（heart-to-heart）。
 * ================================
 * 给 user 一个被认真倾听、被安慰的地方：选一个角色，把心里话说出来，
 * 角色以格外温柔、专注、共情的姿态陪着 TA。重点是「被接住」，不是被说教。
 *
 * 复用主/副 API（调用方用 resolveAuxApi 解析好），失败抛错由调用方兜底。
 * 📌 prompt 文案集中在 utils/theaterPrompts.ts（[肆] 谈心 区段），改文案去那里。
 */

import { CharacterProfile, UserProfile, TalkMode, TalkTurn } from '../types';
import type { ResolvedApi } from './auxApi';
import { ContextBuilder } from './context';
import { extractContent } from './safeApi';
import { talkSystemPrompt, talkOpeningUser, talkReplyUser, talkInsightUser } from './theaterPrompts';
import { callChatCompletion } from './llmClient';
import { makeApiUsageMeta } from './apiUsageCatalog';

const talkSystem = (char: CharacterProfile, userProfile: UserProfile, mood?: string, mode?: TalkMode, intention?: string): string => {
    const core = ContextBuilder.buildCoreContext(char, userProfile, true);
    const userName = (userProfile.name || '').trim() || '对方';
    return talkSystemPrompt({ core, charName: char.name, userName, mood, mode, intention });
};

const callLLM = async (api: ResolvedApi, system: string, user: string): Promise<string> => {
    if (!api.baseUrl || !api.model) throw new Error('请先在「文具盒」里配置 API');
    const data = await callChatCompletion(api, {
        model: api.model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        temperature: 0.85,
        max_tokens: 500,
        stream: false,
    }, {
        meta: makeApiUsageMeta('theater.talkTherapy', {
            apiRole: api.apiRole || 'aux',
            apiBinding: api.apiBinding,
        }),
    });
    return (extractContent(data) || '').trim();
};

const transcript = (turns: TalkTurn[], charName: string, userName: string): string =>
    turns.map(t => `${t.role === 'user' ? userName : charName}：${t.text}`).join('\n');

/** 谈心开场：角色温柔地把这个空间打开（接住此刻的心情，邀请 user 慢慢说）。 */
export const generateTalkOpening = async (
    char: CharacterProfile, userProfile: UserProfile, api: ResolvedApi, mood?: string, mode?: TalkMode, intention?: string,
): Promise<string> => {
    const userName = (userProfile.name || '').trim() || '对方';
    const user = talkOpeningUser({ userName, charName: char.name, mood, mode, intention });
    return callLLM(api, talkSystem(char, userProfile, mood, mode, intention), user);
};

/** 谈心推进：根据已有对话与 user 这次说的话，生成角色温柔的回应。 */
export const generateTalkReply = async (
    char: CharacterProfile, userProfile: UserProfile, api: ResolvedApi,
    turns: TalkTurn[], userInput: string, mood?: string, mode?: TalkMode, intention?: string,
): Promise<string> => {
    const userName = (userProfile.name || '').trim() || '对方';
    const hist = transcript(turns, char.name, userName);
    const user = talkReplyUser({ hist, userName, charName: char.name, userInput });
    return callLLM(api, talkSystem(char, userProfile, mood, mode, intention), user);
};

/** 谈心安放卡：把当前记录收束成一张可收藏的小结。 */
export const generateTalkInsight = async (
    char: CharacterProfile, userProfile: UserProfile, api: ResolvedApi,
    turns: TalkTurn[], mood?: string, mode?: TalkMode, intention?: string,
): Promise<{ title: string; body: string }> => {
    const userName = (userProfile.name || '').trim() || '对方';
    const hist = transcript(turns, char.name, userName);
    const raw = await callLLM(
        api,
        talkSystem(char, userProfile, mood, mode, intention),
        talkInsightUser({ hist, userName, charName: char.name, mood, mode }),
    );
    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
    const titleLine = lines[0]?.replace(/^标题[:：]\s*/, '').trim();
    const title = (titleLine || '把这一刻收好').slice(0, 18);
    const body = (lines[0]?.startsWith('标题') ? lines.slice(1) : lines).join('\n').trim() || raw.trim();
    return { title, body };
};
